import { describe, expect, it, vi } from 'vitest';
import { createSharedStateStore } from './state-runtime.js';

type WorkspaceState = { selectedProject?: string; collapsedGroups: string[] };

describe('shared state runtime', () => {
  it('shares updates across subscribers and persists them through an adapter', async () => {
    let persisted: WorkspaceState | null = null;
    const save = vi.fn(async (value: WorkspaceState) => { persisted = value; });
    const store = createSharedStateStore<WorkspaceState>({ collapsedGroups: [] }, {
      load: async () => persisted,
      save,
    });
    const changed = vi.fn();
    store.subscribe(changed);
    await store.update((state) => ({ ...state, selectedProject: 'project-1' }));
    expect(store.getSnapshot()).toEqual({ collapsedGroups: [], selectedProject: 'project-1' });
    expect(save).toHaveBeenCalledWith(store.getSnapshot());
    expect(changed).toHaveBeenCalledOnce();
  });

  it('loads persisted state and shares a pending load', async () => {
    const load = vi.fn(async () => ({ collapsedGroups: ['archive'] }));
    const store = createSharedStateStore<WorkspaceState>({ collapsedGroups: [] }, { load, save: async () => undefined });
    await Promise.all([store.load(), store.load()]);
    expect(load).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ collapsedGroups: ['archive'] });
  });

  it('serializes concurrent updater calls so patches do not overwrite each other', async () => {
    const store = createSharedStateStore({ count: 0, label: '' });
    await Promise.all([
      store.update((state) => ({ ...state, count: state.count + 1 })),
      store.update((state) => ({ ...state, label: 'ready' })),
    ]);
    expect(store.getSnapshot()).toEqual({ count: 1, label: 'ready' });
  });
});
