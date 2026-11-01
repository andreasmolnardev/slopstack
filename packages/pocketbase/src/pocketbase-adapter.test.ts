import { describe, expect, it } from 'vitest';
import type PocketBase from 'pocketbase';
import { defineResource } from '@slopstack/core';
import { createPocketBaseResourceAdapter } from '@slopstack/pocketbase';

type Note = { id: string; title: string; archived: boolean };
const notes = defineResource<Note, { title: string }, { title?: string }>({
  id: 'notes',
  label: 'Note',
  source: { kind: 'pocketbase', collection: 'notes' },
  fields: [
    { name: 'title', label: 'Title', kind: 'text', required: true },
    { name: 'archived', label: 'Archived', kind: 'boolean' },
  ],
  query: {
    searchFields: ['title'],
    defaultSort: '-created',
    filters: [{ id: 'archived', label: 'Archived', field: 'archived', operator: 'equals' }],
  },
});

describe('PocketBase resource adapter', () => {
  it('applies safe declarative search/filter/sort and normalizes list paging', async () => {
    let options: Record<string, unknown> = {};
    let expression = '';
    const pb = {
      filter: (raw: string, params: Record<string, unknown>) => { expression = raw; expect(params).toEqual({ search0: 'budget', filter1: true }); return raw; },
      collection: () => ({
        getList: async (page: number, perPage: number, next: Record<string, unknown>) => {
          options = { page, perPage, ...next };
          return { items: [{ id: 'n1', title: 'Budget', archived: true }], totalItems: 3, page, perPage };
        },
      }),
    } as unknown as PocketBase;
    const adapter = createPocketBaseResourceAdapter<Note, { title: string }, { title?: string }>(pb, notes);

    await expect(adapter.list?.({ search: 'budget', filters: { archived: true }, page: 2, pageSize: 10 }))
      .resolves.toEqual({ items: [{ id: 'n1', title: 'Budget', archived: true }], total: 3, page: 2, pageSize: 10 });
    expect(expression).toContain('title ~ {:search0}');
    expect(expression).toContain('archived = {:filter1}');
    expect(options).toMatchObject({ page: 2, perPage: 10, sort: '-created' });
  });

  it('does not interpolate search or filter values into PocketBase expressions', async () => {
    let params: Record<string, unknown> = {};
    const pb = {
      filter: (_raw: string, values: Record<string, unknown>) => { params = values; return 'safe'; },
      collection: () => ({ getList: async () => ({ items: [], totalItems: 0, page: 1, perPage: 25 }) }),
    } as unknown as PocketBase;
    const adapter = createPocketBaseResourceAdapter<Note, { title: string }, { title?: string }>(pb, notes);
    await adapter.list?.({ search: `" || @request.auth.id != "`, filters: { archived: true } });
    expect(params.search0).toBe(`" || @request.auth.id != "`);
    expect(params.filter1).toBe(true);
  });

  it('rejects endpoint resources', () => {
    expect(() => createPocketBaseResourceAdapter({} as PocketBase, {
      ...notes,
      source: { kind: 'endpoint', list: '/notes' },
    })).toThrow('does not use a PocketBase source');
  });
});
