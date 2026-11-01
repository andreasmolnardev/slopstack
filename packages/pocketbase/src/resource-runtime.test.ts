import { describe, expect, it } from 'vitest';
import { defineResource } from '@slopstack/core';
import { createDefaultResourceClient } from './resource-runtime.js';
import { createResourceClient, type ResourceAdapter } from '@slopstack/core';

type Entry = { id: string; title: string };
const entries = defineResource<Entry, { title: string }, { title?: string }>({
  id: 'entries', label: 'Entry', source: { kind: 'endpoint', list: '/entries', get: '/entries/{id}', create: '/entries', update: '/entries/{id}', delete: '/entries/{id}' },
  fields: [{ name: 'title', label: 'Title', kind: 'text', required: true }],
});

describe('default resource runtime', () => {
  it('builds an endpoint-backed client from its resource source', async () => {
    const client = createDefaultResourceClient(entries, { endpoint: { fetcher: async () => Response.json([{ id: '1', title: 'One' }]) } });
    await expect(client.list()).resolves.toMatchObject({ total: 1, items: [{ title: 'One' }] });
  });

  it('requires a PocketBase client for PocketBase resources', () => {
    const pbEntries = defineResource<Entry, { title: string }, { title?: string }>({
      ...entries,
      source: { kind: 'pocketbase', collection: 'entries' },
    });
    expect(() => createDefaultResourceClient(pbEntries)).toThrow('needs a PocketBase client');
  });

  it('still allows app supplied custom resource adapters', async () => {
    const adapter: ResourceAdapter<Entry, { title: string }, { title?: string }> = {
      list: async () => [{ id: 'custom', title: 'Custom' }],
    };
    const client = createResourceClient(entries, adapter);
    await expect(client.list()).resolves.toMatchObject({ items: [{ id: 'custom' }] });
  });
});
