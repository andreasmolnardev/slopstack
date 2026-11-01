import { describe, expect, it } from 'vitest';
import { getAccessibleNavigation, renderView, resolveAccessibleView, resolveView } from './view-runtime';
import { defineShell, defineView } from './define';

const views = [
  defineView({ id: 'tasks', path: '/tasks', label: 'Tasks', component: () => null }),
  defineView({ id: 'task', path: '/tasks/:taskId', label: 'Task', component: () => null }),
  defineView({ id: 'files', path: '/files/*', label: 'Files', component: () => null }),
];

describe('view route resolver', () => {
  it('matches static and parameterized paths with decoded params', () => {
    expect(resolveView(views, '/tasks/')?.view.id).toBe('tasks');
    expect(resolveView(views, '/tasks/a%20b')).toMatchObject({ view: { id: 'task' }, params: { taskId: 'a b' } });
  });

  it('captures wildcard paths and rejects unmatched routes', () => {
    expect(resolveView(views, '/files/2026/receipt.pdf')?.params['*']).toBe('2026/receipt.pdf');
    expect(resolveView(views, '/not-found')).toBeUndefined();
    expect(resolveView(views, '/tasks/extra/segment')).toBeUndefined();
  });

  it('applies view access and supplies the configured sign-in redirect', () => {
    const protectedViews = [defineView({
      id: 'private', path: '/private', label: 'Private',
      access: { authenticated: true }, component: () => null,
    })];
    expect(resolveAccessibleView(protectedViews, '/private', { authenticated: false }, '/login')).toMatchObject({
      status: 'denied', redirectTo: '/login',
    });
    expect(resolveAccessibleView(protectedViews, '/private', { authenticated: true })?.status).toBe('allowed');
  });

  it('filters navigation and renders a view with its route context', () => {
    const view = defineView({ id: 'tasks', path: '/tasks', label: 'Tasks', component: () => null });
    const shell = defineShell({
      id: 'main', label: 'Main', component: ({ children }) => children,
      navigation: [
        { id: 'tasks', label: 'Tasks', view: 'tasks' },
        { id: 'admin', label: 'Admin', view: 'tasks', access: { roles: ['admin'] } },
      ],
    });
    expect(getAccessibleNavigation(shell, { authenticated: true }).map((item) => item.id)).toEqual(['tasks']);
    expect(renderView(view, { params: {}, search: new URLSearchParams('q=hello'), navigate: () => undefined }).props.context.search.get('q')).toBe('hello');
  });
});
