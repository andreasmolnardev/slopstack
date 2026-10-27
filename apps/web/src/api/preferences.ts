import { getMyPreferences, updateMyPreferences } from './generated';
import { createClient } from './generated/client';
import type { UserPreferences, UserPreferencesPatchInputBodyWritable } from './generated/types.gen';
import { pb } from './pocketbase';

const baseUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
const api = createClient({ baseUrl, auth: () => pb.authStore.token });

export async function getPreferences(): Promise<UserPreferences> {
  const { data } = await getMyPreferences({ client: api, throwOnError: true });
  return data;
}

export async function savePreferences(input: UserPreferencesPatchInputBodyWritable) {
  const { data } = await updateMyPreferences({ client: api, body: input, throwOnError: true });
  return data;
}
