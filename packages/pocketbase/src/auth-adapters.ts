import PocketBase from 'pocketbase';
import type { AuthSession, AuthUser, AuthenticationAdapter } from '@slopstack/core';

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
