# Authentication

PocketBase owns the auth lifecycle.

The browser primitives expose a provider-neutral `AuthenticationAdapter` contract. The reference app uses PocketBase; apps behind an identity-aware proxy can use `createTrustedProxyAuthAdapter`, which reads a server-verified session endpoint and redirects to the external sign-in flow. `createBearerAuthAdapter` accepts app-owned token storage and a JSON login/session API. Both can supply token-aware `headers` to `createEndpointResourceAdapter`. Do not infer identity from arbitrary browser headers or treat client route checks as authorization.

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

The SSO screen saves credentials only on the server and never reads provider secrets back. Login and signup discover the enabled providers from PocketBase's public auth-method response. Microsoft and custom OIDC are supported as configured providers. For OIDC, use the discovery helper or enter authorization, token, and user-info endpoints; issuer and JWKS settings enable issuer and ID-token signature validation. Set `SLOPSTACK_PUBLIC_URL` to the externally reachable PocketBase origin because that origin serves the OAuth callback.

`SLOPSTACK_REGISTRATION_ENABLED=false` rejects public password account creation and first-time OAuth account creation. Existing accounts can still authenticate and link providers. Superuser-created accounts remain allowed. `SLOPSTACK_SSO_ONLY=true` disables password sign-in only while at least one OAuth provider is active; if OAuth is unavailable or unconfigured, password sign-in remains available to prevent lockout. Neither setting resets live OAuth configuration.

`SLOPSTACK_REQUIRE_VERIFIED_EMAIL=true` blocks authentication for unverified users. Password signup sends the standard PocketBase verification email and waits for confirmation before login; OAuth users are marked verified only when PocketBase accepts a verified provider email.

Account settings list linked OAuth identities. Linking requires the current password and a short-lived, one-use server intent; users without a password must use password recovery first. An identity already attached to another account is rejected, and the OAuth callback cannot switch the signed-in user to that other account. The UI prevents removing the last linked OAuth identity. PocketBase still permits password recovery for OAuth-created accounts with a usable email address.

Disabled users are rejected at password/OAuth authentication and token refresh. A request middleware also reloads the current account on each authenticated request and rejects disabled users, including requests made with an older token. Users cannot set their own `disabled` or `isAdmin` fields; superusers retain recovery access. The app clears its local PocketBase token on logout; it does not terminate the upstream identity-provider session.

## Backend pattern

Protected routes must reject missing `event.Auth` and apply `Authorize` for permission checks. Direct user rules override group rules, explicit user denies win, and group denies beat group grants. Frontend navigation and conditional rendering are not security controls. Personal preferences are read and updated through `/api/me/preferences` and are scoped to the authenticated account.
