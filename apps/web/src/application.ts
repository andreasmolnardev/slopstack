import { createSlopstackRegistry, defineApplication } from '@/lib/slopstack';
import { todoResource } from '@/resources/todos';

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
});

export const slopstackRuntime = createSlopstackRegistry(slopstackApplication);
