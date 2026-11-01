import { createSlopstackRegistry, defineApplication, defineSettings } from '@/lib/slopstack';
import { todoResource } from '@/resources/todos';

const userPreferences = defineSettings({
  id: 'user-preferences',
  label: 'User preferences',
  scope: 'user',
  defaults: { locale: 'en', timeZone: 'UTC', dateFormat: 'yyyy-MM-dd', timeFormat: '24h', theme: 'system' },
  fields: [
    { name: 'locale', label: 'Locale', kind: 'text', defaultValue: 'en' },
    { name: 'timeZone', label: 'Time zone', kind: 'text', defaultValue: 'UTC' },
    { name: 'dateFormat', label: 'Date format', kind: 'select', defaultValue: 'yyyy-MM-dd', options: [{ label: 'ISO', value: 'yyyy-MM-dd' }, { label: 'US', value: 'MM/dd/yyyy' }, { label: 'EU', value: 'dd/MM/yyyy' }] },
    { name: 'timeFormat', label: 'Time format', kind: 'select', defaultValue: '24h', options: [{ label: '24 hour', value: '24h' }, { label: '12 hour', value: '12h' }] },
    { name: 'theme', label: 'Appearance', kind: 'select', defaultValue: 'system', options: [{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] },
  ],
});

/** The reference module's declarative application manifest and runtime registry. */
export const slopstackApplication = defineApplication({
  id: 'slopstack',
  name: 'Slopstack',
  backend: {
    provider: 'pocketbase',
    capabilities: { database: true, realtime: true, uploads: true, admin: true },
  },
  authentication: {
    provider: 'pocketbase',
    enforcement: 'server',
    routes: { signIn: '/auth/login', signOut: '/auth/login', unauthorized: '/auth/login' },
  },
  resources: [todoResource],
  settings: [userPreferences],
});

export const slopstackRuntime = createSlopstackRegistry(slopstackApplication);
