import PocketBase from 'pocketbase';
import { createPocketBaseAuthAdapter } from '@slopstack/pocketbase/auth';
import { client as generatedClient } from './generated/client.gen';

export const pb = new PocketBase(import.meta.env.VITE_API_URL ?? window.location.origin);
generatedClient.setConfig({ baseUrl: pb.baseURL, auth: () => pb.authStore.token });
export const pbAuth = createPocketBaseAuthAdapter(pb);
