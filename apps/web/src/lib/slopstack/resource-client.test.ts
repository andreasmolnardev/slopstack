import { describe, expect, it, vi } from 'vitest';
import { createResourceClient } from './resource-client';
import type { ResourceDefinition } from './types';

type Project = { id: string; name: string };
type ProjectWrite = { name: string };

const definition: ResourceDefinition<Project, ProjectWrite, Partial<ProjectWrite>> = {
  id: 'projects',
  label: 'Project',
  source: { kind: 'endpoint', list: '/api/projects' },
  fields: [{ name: 'name', label: 'Name', kind: 'text', required: true }],
};

describe('resource client', () => {
  it('normalizes list results and forwards query options to its adapter', async () => {
    const list = vi.fn(async () => [{ id: 'p1', name: 'Alpha' }]);
    const client = createResourceClient(definition, { list });
    const query = { search: 'alpha', page: 2, pageSize: 10 };

    await expect(client.list(query)).resolves.toEqual({
      items: [{ id: 'p1', name: 'Alpha' }],
      total: 1,
    });
    expect(list).toHaveBeenCalledWith(query);
  });

  it('supports all configured CRUD operations through one adapter', async () => {
    const adapter = {
      list: vi.fn(async () => ({ items: [{ id: 'p1', name: 'Alpha' }], total: 3, page: 1, pageSize: 1 })),
      get: vi.fn(async () => ({ id: 'p1', name: 'Alpha' })),
      create: vi.fn(async (input: ProjectWrite) => ({ id: 'p2', ...input })),
      update: vi.fn(async (id: string, input: Partial<ProjectWrite>) => ({ id, name: input.name ?? 'Alpha' })),
      delete: vi.fn(async () => undefined),
    };
    const client = createResourceClient(definition, adapter);

    await expect(client.list()).resolves.toMatchObject({ total: 3, pageSize: 1 });
    await expect(client.get('p1')).resolves.toEqual({ id: 'p1', name: 'Alpha' });
    await expect(client.create({ name: 'Beta' })).resolves.toEqual({ id: 'p2', name: 'Beta' });
    await expect(client.update('p1', { name: 'Updated' })).resolves.toEqual({ id: 'p1', name: 'Updated' });
    await expect(client.delete('p1')).resolves.toBeUndefined();
  });

  it('rejects disabled or unimplemented operations with a resource-specific error', async () => {
    const readOnly: ResourceDefinition<Project, ProjectWrite, Partial<ProjectWrite>> = {
      ...definition,
      operations: { list: true, create: false },
    };
    const client = createResourceClient(readOnly, { list: async () => [] });

    await expect(client.create({ name: 'New' })).rejects.toThrow('Resource "projects" does not support create.');
    await expect(client.update('p1', { name: 'New' })).rejects.toThrow('Resource "projects" does not support update.');
  });
});
