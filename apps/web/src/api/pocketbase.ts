import PocketBase from 'pocketbase';
import { createPocketBaseAuthAdapter } from '@slopstack/pocketbase/auth';

export const pb = new PocketBase(import.meta.env.VITE_API_URL ?? window.location.origin);
export const pbAuth = createPocketBaseAuthAdapter(pb);
