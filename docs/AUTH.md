# Authentication

PocketBase owns the auth lifecycle.

## Built-in flows

- Login and logout.
- Registration, controlled by `SLOPSTACK_REGISTRATION_ENABLED`.
- Password reset.
- Email verification.
- Persistent auth tokens.
- Auth record access through `pb.authStore`.

## Frontend pattern

```ts
await pb.collection('users').authWithPassword(email, password);
const user = pb.authStore.record;
pb.authStore.clear();
```

Reference routes are `/auth/login`, `/auth/register`, `/auth/forgot-password`, and `/auth/admin`. App routes require a valid PocketBase auth record and redirect back after login. Admin routes require a PocketBase superuser session. Logout clears `pb.authStore` and returns to `/auth/login`.

The admin console at `/admin/users` and `/admin/groups` manages users, optional organizations, groups, memberships, and permission rules through PocketBase collections with locked rules. Only a PocketBase superuser can use these operations. `/admin/sso` configures OAuth2 providers on the `users` auth collection. Register each provider with `{origin}/api/oauth2-redirect`.

## Backend pattern

Protected routes must reject missing `event.Auth` and apply `Authorize` for permission checks. Direct user rules override group rules, explicit user denies win, and group denies beat group grants. Frontend navigation and conditional rendering are not security controls. Personal preferences are read and updated through `/api/me/preferences` and are scoped to the authenticated account.
