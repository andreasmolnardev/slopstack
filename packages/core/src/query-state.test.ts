import { describe, expect, it } from 'vitest';
import { parseResourceQuery, writeResourceQuery } from './query-state.js';

describe('resource query URL state', () => {
  it('parses search, sorting, paging, and declared filters', () => {
    expect(parseResourceQuery('?q=coffee&sort=-created&page=3&size=20&filter.status=open&filter.hidden=yes', {
      pageSize: 10,
      defaultSort: 'created',
      filters: [{ id: 'status', label: 'Status', field: 'status', operator: 'equals' }],
    })).toEqual({
      search: 'coffee',
      sort: '-created',
      page: 3,
      pageSize: 20,
      filters: { status: 'open' },
    });
  });

  it('uses safe defaults for malformed paging values', () => {
    expect(parseResourceQuery('?page=-2&size=zero', { pageSize: 40 })).toMatchObject({ page: 1, pageSize: 40 });
  });

  it('updates query-owned keys while preserving unrelated route state', () => {
    expect(writeResourceQuery('?tab=activity&q=old&filter.status=open', {
      search: 'new search',
      sort: '-created',
      page: 2,
      pageSize: 15,
      filters: { owner: 'me', labels: ['red', 'blue'] },
    }).toString()).toBe('tab=activity&q=new+search&sort=-created&page=2&size=15&filter.owner=me&filter.labels=red%2Cblue');
  });
});
