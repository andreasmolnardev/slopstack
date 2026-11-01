import { describe, expect, it, vi } from 'vitest';
import { createAuthenticationStore } from './auth-runtime';
import type { AuthSession, AuthenticationAdapter } from './types';

const session: AuthSession = { user: { id: 'user-1', name: 'Sam' }, accessToken: 'token' };

describe('authentication session store', () => {
  it('loads a session, follows adapter events, and disposes its subscription', async () => {
    let listener!: (session: AuthSession | null) => void;
    const unsubscribe = vi.fn();
    const adapter: AuthenticationAdapter<string> = {
      getSession: async () => session,
      subscribe(callback) { listener = callback; return unsubscribe; },
      signIn: async () => session,
      signOut: async () => undefined,
    };
    const store = createAuthenticationStore(adapter);
    await store.initialize();
    expect(store.getSnapshot()).toMatchObject({ status: 'authenticated', session });
    listener(null);
    expect(store.getSnapshot().status).toBe('anonymous');
    store.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses the adapter credential type and handles sign-in/out errors', async () => {
    const adapter: AuthenticationAdapter<{ email: string }> = {
      getSession: async () => null,
      subscribe: () => () => undefined,
      signIn: async ({ email }) => ({ user: { id: email } }),
      signOut: async () => undefined,
    };
    const store = createAuthenticationStore(adapter);
    await expect(store.signIn({ email: 'a@example.com' })).resolves.toMatchObject({ user: { id: 'a@example.com' } });
    expect(store.getSnapshot().status).toBe('authenticated');
    await store.signOut();
    expect(store.getSnapshot()).toMatchObject({ status: 'anonymous', session: null });

    const failing = createAuthenticationStore({
      ...adapter,
      signIn: async () => { throw new Error('denied'); },
    });
    await expect(failing.signIn({ email: 'a@example.com' })).rejects.toThrow('denied');
    expect(failing.getSnapshot().status).toBe('error');
  });

  it('shares concurrent initialization', async () => {
    const getSession = vi.fn(async () => null);
    const store = createAuthenticationStore({
      getSession,
      subscribe: () => () => undefined,
      signIn: async () => null,
      signOut: async () => undefined,
    });
    await Promise.all([store.initialize(), store.initialize()]);
    expect(getSession).toHaveBeenCalledOnce();
  });
});
