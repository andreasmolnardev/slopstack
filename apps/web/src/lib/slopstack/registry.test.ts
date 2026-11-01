import { describe, expect, it, vi } from 'vitest';
import { createSlopstackRegistry } from './registry';
import type { ApplicationDefinition, ResourceDefinition } from './types';

const todoResource: ResourceDefinition = {
  id: 'todos',
  label: 'Todo',
  source: { kind: 'endpoint', list: '/api/todos' },
  fields: [
    { name: 'title', label: 'Title', kind: 'text', required: true },
    { name: 'completed', label: 'Completed', kind: 'boolean', defaultValue: false },
  ],
};

describe('Slopstack primitive registry', () => {
  it('registers application primitives and plugin contributions', () => {
    const app: ApplicationDefinition = {
      id: 'example',
      name: 'Example',
      resources: [todoResource],
      views: [{ id: 'todo-list', path: '/todos', label: 'Todos', component: () => null }],
      shell: {
        id: 'main',
        label: 'Main shell',
        navigation: [{ id: 'todos', label: 'Todos', view: 'todo-list' }],
        component: ({ children }) => children,
      },
      plugins: [{
        id: 'extra-action',
        version: '1.0.0',
        label: 'Extra action',
        register(context) {
          context.registerAction({ id: 'refresh', label: 'Refresh', execute: () => undefined });
        },
      }],
    };

    const { registry } = createSlopstackRegistry(app);
    expect(registry.resources.get('todos')).toBe(todoResource);
    expect(registry.actions.has('refresh')).toBe(true);
  });

  it('reports unresolved layout, relationship, and navigation references', () => {
    const app: ApplicationDefinition = {
      id: 'broken',
      name: 'Broken',
      resources: [{
        ...todoResource,
        relations: [{ field: 'project', resource: 'projects', cardinality: 'one' }],
      }],
      views: [{ id: 'todo-list', path: '/todos', label: 'Todos', layout: 'missing', component: () => null }],
      shell: {
        id: 'main',
        label: 'Main shell',
        navigation: [{ id: 'projects', label: 'Projects', view: 'missing-view' }],
        component: ({ children }) => children,
      },
    };

    expect(() => createSlopstackRegistry(app)).toThrow(/missing layout/);
    expect(() => createSlopstackRegistry(app)).toThrow(/missing relationship resource/);
    expect(() => createSlopstackRegistry(app)).toThrow(/missing view/);
  });

  it('rejects duplicate IDs and disposes plugin resources once in reverse order', () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const app: ApplicationDefinition = {
      id: 'plugins',
      name: 'Plugins',
      plugins: [
        { id: 'same', version: '1', label: 'First', register: () => firstDispose },
        { id: 'same', version: '1', label: 'Second', register: () => secondDispose },
      ],
    };
    expect(() => createSlopstackRegistry(app)).toThrow(/Duplicate plugin id/);

    const valid: ApplicationDefinition = {
      id: 'plugins',
      name: 'Plugins',
      plugins: [
        { id: 'first', version: '1', label: 'First', register: () => firstDispose },
        { id: 'second', version: '1', label: 'Second', register: () => secondDispose },
      ],
    };
    const instance = createSlopstackRegistry(valid);
    instance.dispose();
    instance.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();
  });

  it('detects route collisions that differ only by parameter names', () => {
    const app: ApplicationDefinition = {
      id: 'routes',
      name: 'Routes',
      views: [
        { id: 'project', path: '/projects/:projectId', label: 'Project', component: () => null },
        { id: 'other-project', path: '/projects/:id', label: 'Other project', component: () => null },
      ],
    };
    expect(() => createSlopstackRegistry(app)).toThrow(/conflicting route patterns/);
  });
});
