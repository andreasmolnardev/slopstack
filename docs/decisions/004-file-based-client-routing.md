# File-based client routing

## Decision

Starburst uses TanStack Router's Vite plugin to generate the route tree from `apps/web/src/routes/`. Route loaders use TanStack Query to cache owner-scoped course and knowledge data, and route guards send unauthenticated users to the login route with a validated return path.

## Rationale

File routes provide typed paths, search parameters, and route-level code splitting while preserving the existing React and Vite application. Query keys include the authenticated PocketBase user ID, and the cache is cleared when the account changes.

## Consequences

The generated route tree is build output and should not be edited by hand. The dashboard and course views are migrated first; many existing feature writes still use PocketBase directly and should move into typed mutation/query hooks as those views are decomposed.
