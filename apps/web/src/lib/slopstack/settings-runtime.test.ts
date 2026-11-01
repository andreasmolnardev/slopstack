import { describe, expect, it, vi } from 'vitest';
import { createLocalStorageSettingsAdapter, createSettingsStore } from './settings-runtime';
import type { SettingsDefinition } from './types';

type Preferences = { locale: string; timeZone: string; dateFormat: string };
const preferences: SettingsDefinition<Preferences> = {
  id: 'preferences',
  label: 'Preferences',
  scope: 'user',
  defaults: { locale: 'en', timeZone: 'UTC', dateFormat: 'yyyy-MM-dd' },
  fields: [
    { name: 'locale', label: 'Language', kind: 'text' },
    { name: 'timeZone', label: 'Time zone', kind: 'text' },
    { name: 'dateFormat', label: 'Date format', kind: 'text' },
  ],
};

describe('settings runtime', () => {
  it('merges saved settings with defaults, updates and resets through an adapter', async () => {
    const save = vi.fn(async () => undefined);
    const store = createSettingsStore(preferences, { load: async () => ({ locale: 'fr' }), save });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', value: { locale: 'fr', timeZone: 'UTC' } });
    await store.update({ timeZone: 'Europe/Paris' });
    expect(save).toHaveBeenLastCalledWith({ locale: 'fr', timeZone: 'Europe/Paris', dateFormat: 'yyyy-MM-dd' });
    await store.reset();
    expect(store.getSnapshot().value).toEqual(preferences.defaults);
  });

  it('shares an in-flight load and reports load errors', async () => {
    let finish!: (value: Partial<Preferences> | null) => void;
    const load = vi.fn(() => new Promise<Partial<Preferences> | null>((resolve) => { finish = resolve; }));
    const store = createSettingsStore(preferences, { load, save: async () => undefined });
    const first = store.load();
    const second = store.load();
    expect(load).toHaveBeenCalledOnce();
    finish({ dateFormat: 'dd/MM/yyyy' });
    await Promise.all([first, second]);
    expect(store.getSnapshot().value.dateFormat).toBe('dd/MM/yyyy');
  });

  it('persists settings under the selected browser storage key', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const adapter = createLocalStorageSettingsAdapter<Preferences>('user-prefs', storage);
    await adapter.save(preferences.defaults);
    expect(storage.setItem).toHaveBeenCalledWith('user-prefs', JSON.stringify(preferences.defaults));
  });
});
