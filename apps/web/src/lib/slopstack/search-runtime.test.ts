import { describe, expect, it, vi } from 'vitest';
import { filterPaletteActions, matchesShortcut, normalizeShortcutKeys, searchProviders, ShortcutRegistry } from './search-runtime';
import type { SearchProvider, ShortcutDefinition } from './types';

describe('search providers', () => {
  it('runs eligible providers, limits results, and isolates provider failures', async () => {
    const first: SearchProvider = {
      id: 'tasks', label: 'Tasks', search: async (query) => [
        { id: '1', title: query, href: '/tasks/1' },
        { id: '2', title: 'Second', href: '/tasks/2' },
      ],
    };
    const second: SearchProvider = {
      id: 'projects', label: 'Projects', minQueryLength: 3,
      search: async () => { throw new Error('offline'); },
    };
    const skipped = { id: 'short', label: 'Short', minQueryLength: 5, search: vi.fn(async () => []) };
    const onProviderError = vi.fn();
    const groups = await searchProviders([first, second, skipped], 'abcd', { limitPerProvider: 1, onProviderError });

    expect(groups).toEqual([
      { providerId: 'tasks', label: 'Tasks', results: [{ id: '1', title: 'abcd', href: '/tasks/1' }] },
      { providerId: 'projects', label: 'Projects', results: [], error: 'offline' },
    ]);
    expect(skipped.search).not.toHaveBeenCalled();
    expect(onProviderError).toHaveBeenCalledOnce();
  });

  it('deduplicates duplicate result links and stops if cancelled', async () => {
    const provider: SearchProvider = {
      id: 'mixed', label: 'Mixed', search: async () => [
        { id: 'a', title: 'First', href: '/same' },
        { id: 'b', title: 'Duplicate', href: '/same' },
        { id: 'c', title: 'Third' },
      ],
    };
    expect(await searchProviders([provider], 'term')).toMatchObject([{ results: [{ title: 'First' }, { id: 'c' }] }]);
    const controller = new AbortController();
    controller.abort();
    await expect(searchProviders([provider], 'term', { signal: controller.signal })).resolves.toEqual([]);
  });
});

describe('command actions and shortcuts', () => {
  it('filters command actions by label, description, and keywords', () => {
    const actions = [
      { id: 'new', label: 'New task', execute: vi.fn() },
      { id: 'find', label: 'Search', description: 'Find an account', keywords: ['transactions'], execute: vi.fn() },
    ];
    expect(filterPaletteActions(actions, 'transaction')).toEqual([actions[1]]);
    expect(filterPaletteActions(actions, '')).toEqual(actions);
  });

  it('normalizes common modifier aliases and matches key chords', () => {
    const shortcut: ShortcutDefinition = { id: 'palette', keys: ['CMD', 'K'], label: 'Open search', execute: vi.fn() };
    expect(normalizeShortcutKeys(shortcut.keys)).toEqual(['mod', 'k']);
    expect(matchesShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, shortcut)).toBe(true);
    expect(matchesShortcut({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, shortcut)).toBe(false);
  });

  it('rejects duplicate shortcut IDs and key conflicts', () => {
    const first: ShortcutDefinition = { id: 'search', keys: ['mod', 'k'], label: 'Search', execute: vi.fn() };
    expect(() => new ShortcutRegistry([first, { ...first, label: 'Other' }])).toThrow(/Duplicate shortcut id/);
    expect(() => new ShortcutRegistry([first, { ...first, id: 'other', keys: ['cmd', 'K'] }])).toThrow(/conflicts/);
  });
});
