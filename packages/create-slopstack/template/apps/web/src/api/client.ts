import { client } from './generated/client.gen';
import { pb } from './pocketbase';

client.setConfig({
  baseUrl: import.meta.env.VITE_API_URL ?? window.location.origin,
  auth: () => pb.authStore.token,
});

export { client };
