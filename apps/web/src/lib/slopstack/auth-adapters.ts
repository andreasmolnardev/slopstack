import PocketBase from 'pocketbase';
import type { AuthSession, AuthUser, AuthenticationAdapter } from './types';

export type PocketBaseCredentials = { identity: string; password: string };

function pocketBaseSession(pb: PocketBase): AuthSession | null {
  const record = pb.authStore.record;
  if (!pb.authStore.isValid || !record) return null;
  const user = { ...record } as AuthUser;
  return { user, accessToken: pb.authStore.token };
}

/** Adapts PocketBase auth state to the provider-neutral Slopstack auth contract. */
export function createPocketBaseAuthAdapter(
  pb: PocketBase,
  collection = 'users',
): AuthenticationAdapter<PocketBaseCredentials> {
  return {
    async getSession() { return pocketBaseSession(pb); },
    subscribe(listener) {
      return pb.authStore.onChange(() => listener(pocketBaseSession(pb)), true);
    },
    async signIn({ identity, password }) {
      await pb.collection(collection).authWithPassword(identity, password);
      return pocketBaseSession(pb);
    },
    async signOut() { pb.authStore.clear(); },
  };
}

export type TrustedProxyAuthOptions = {
  sessionEndpoint: string;
  signInUrl: string;
  signOutEndpoint?: string;
  fetcher?: typeof fetch;
  navigate?: (url: string) => void;
};

/** Reads identity only from a server endpoint backed by trusted proxy middleware. */
export function createTrustedProxyAuthAdapter(
  options: TrustedProxyAuthOptions,
): AuthenticationAdapter<void> {
  const fetcher = options.fetcher ?? fetch;
  const readSession = async (): Promise<AuthSession | null> => {
    const response = await fetcher(options.sessionEndpoint, { credentials: 'include' });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error(`Could not read session (HTTP ${response.status}).`);
    const result = await response.json() as { user?: AuthUser; expiresAt?: number };
    if (!result.user?.id) throw new Error('The session endpoint returned no authenticated user.');
    return { user: result.user, expiresAt: result.expiresAt };
  };
  return {
    getSession: readSession,
    subscribe(listener) {
      if (typeof window === 'undefined') return () => undefined;
      let active = true;
      const refresh = () => { void readSession().then((session) => { if (active) listener(session); }).catch(() => { if (active) listener(null); }); };
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
      return () => {
        active = false;
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refresh);
      };
    },
    async signIn() {
      const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
      navigate(options.signInUrl);
      return null;
    },
    async signOut() {
      if (!options.signOutEndpoint) return;
      const response = await fetcher(options.signOutEndpoint, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error(`Could not sign out (HTTP ${response.status}).`);
    },
  };
}
