# Slopstack

Slopstack is an API-first full-stack template with an embedded PocketBase backend and a static React frontend.

The task workspace is a reference module, not the product domain. Use it as a working example for replacing the React surface, adding protected API routes, evolving PocketBase schemas, and composing shadcn UI.

## What it does

Slopstack gives a new app a working frontend, backend, database, API contract, and deployment setup. The included task workspace is a replaceable example that demonstrates how those pieces fit together; it is not the product Slopstack is trying to build.

### Components and styling

The React app includes the checked-in shadcn component set, plus reusable patterns for page headings, data tables, form dialogs, and navigation. It demonstrates theme tokens, light/dark appearance, saved user styling, and responsive layouts. Unused UI components are tree-shaken from production builds.

### Routing and application shell

The example uses browser routes for its workspace, account, and admin screens. Protected routes send signed-out users to login and return them to their requested page afterward. The app shell supports sidebar, top-bar, rail, and mobile bottom navigation; apps can replace the example routes and layouts with their own.

### Authentication, permissions, and data

Embedded PocketBase provides user accounts, sessions, password recovery, verification, OAuth provider configuration, collections, migrations, and SQLite persistence. The example Todo API demonstrates authenticated CRUD scoped to the current user. Backend authorization supports direct user rules, group rules, and deny overrides; admin screens manage users, groups, memberships, and optional organizations.

Personal settings are stored with the user account and include locale, time zone, date/time formats, navigation choice, and appearance preferences.

### APIs and generated client

Go handlers use Huma and publish OpenAPI 3.1 documentation. The TypeScript client is generated from that contract, keeping frontend calls typed against the API. PocketBase remains available for auth and collection-backed data.

### Packaging, deployment, and upgrades

The Go runtime can serve the built frontend, and Docker packages the app with persistent PocketBase data. CI and release workflows check builds and publish version-tagged container images. The Slopstack CLI can initialize a project and apply template upgrades with previews, checksums, conflict detection, snapshots, rollback, and validation.

## What the template includes

- **Frontend:** React, TypeScript, Vite, route handling, account screens, responsive app shell, and the reference task workspace with overview, tasks, schedule, analytics, and component showcase screens.
- **UI library:** the full checked-in shadcn component set, color/theme tokens, and reusable table, form-dialog, page-heading, and navigation patterns.
- **Backend:** Go server, Huma API routes, embedded PocketBase, SQLite, migrations, owner-scoped Todo CRUD, preferences, and permission enforcement.
- **Authentication and administration:** PocketBase account flows, OAuth provider configuration, protected user/group administration, memberships, permission rules, and optional organizations.
- **API workflow:** OpenAPI export, served API docs, and generated TypeScript client.
- **Developer tooling:** Go and web development commands, tests, lint/build scripts, project initialization, and safe template upgrade/rollback commands.
- **Delivery:** Docker image and Compose setup, environment examples, CI checks, centralized app version, and a container publishing workflow.

This is the current template scope, not every possible Slopstack integration. PocketBase is currently the built-in auth and data backend. External OIDC or proxy authentication, non-PocketBase backends, and an interactive `create` wizard are not implemented yet; apps can replace or extend the existing patterns themselves.

## Installation

```sh
pnpm install
cp .env.example .env
pnpm generate:api
pnpm generate:client
pnpm dev
```

`pnpm dev` starts the backend and frontend together. The backend uses `air` for hot reload and serves on `0.0.0.0:8090`; the Vite app proxies `/api` there.
If `8090` is busy, set `SLOPSTACK_HTTP_ADDRESS=127.0.0.1:18090` before running `pnpm dev`.

## Development

- `make build`, `make test`, `make lint`, and `make docker` run the standard checks.
- `pnpm dev` runs both apps. `pnpm generate:api` writes `openapi/openapi.json`.
- `pnpm generate:client` writes the ignored Hey API output under `apps/web/src/api/generated`.

## Authentication And Permissions

PocketBase provides login, logout, registration, password reset, verification, and persistent tokens through its standard auth API. Set `SLOPSTACK_REGISTRATION_ENABLED=false` for custom registration endpoints. Enforce permissions in the backend with `Authorize`; frontend visibility is not authorization.

Shared Go auth and ownership helpers are pinned to `github.com/andreasmolnardev/slopstack v0.3.0`, the same version used by Piggybudget. Apps should upgrade that dependency explicitly after reviewing its release notes.

## OpenAPI

The server serves `/openapi.json`, `/openapi.yaml`, and `/docs`. Export offline with `go run ./apps/server/cmd/slopstack openapi export`.

## Docker And Deployment

`docker compose up --build` runs the production image and persists PocketBase data in `slopstack-data`. Set `SLOPSTACK_PUBLIC_URL` and secure-cookie values for your deployment.
The release workflow publishes `ghcr.io/<owner>/slopstack:<VERSION>` and `:latest` when a `v<VERSION>` tag is pushed. Keep the root `VERSION` file and tag in sync.

## Customization

The task workspace is in `apps/web/src/app.tsx`. Replace it without changing the backend infrastructure. Add modules through protected API routes, schemas, and generated client calls. Keep schema evolution in PocketBase migrations.

The complete checked-in shadcn component set is under `apps/web/src/components/ui`; unused components stay out of the production bundle. Reusable composed patterns are under `apps/web/src/components/patterns`.

See [`docs/README.md`](docs/README.md) for UI, navigation, API, auth, data model, development, and deployment guidance.
