import { describe, expect, it } from 'vitest';
import { createTrustedProxyAuthAdapter } from './auth-adapters';

describe('trusted proxy auth adapter', () => {
  it('takes the identity from a server session endpoint and does not expose a browser token', async () => {
    const adapter = createTrustedProxyAuthAdapter({
      sessionEndpoint: '/api/session',
      signInUrl: '/oauth/start',
      fetcher: async () => Response.json({ user: { id: 'user-1', email: 'person@example.test', roles: ['member'] } }),
    });
    await expect(adapter.getSession()).resolves.toEqual({
      user: { id: 'user-1', email: 'person@example.test', roles: ['member'] },
      expiresAt: undefined,
    });
  });

  it('treats unauthenticated status as an empty session and redirects to external sign-in', async () => {
    let destination = '';
    const adapter = createTrustedProxyAuthAdapter({
      sessionEndpoint: '/api/session',
      signInUrl: 'https://login.example.test/start',
      fetcher: async () => new Response(null, { status: 401 }),
      navigate: (url) => { destination = url; },
    });
    await expect(adapter.getSession()).resolves.toBeNull();
    await expect(adapter.signIn(undefined)).resolves.toBeNull();
    expect(destination).toBe('https://login.example.test/start');
  });

  it('posts logout using the proxy cookie session', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const adapter = createTrustedProxyAuthAdapter({
      sessionEndpoint: '/api/session',
      signInUrl: '/login',
      signOutEndpoint: '/api/logout',
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(null, { status: 204 });
      },
    });
    await adapter.signOut();
    expect(calls[0].input).toBe('/api/logout');
    expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'include' });
  });
});
