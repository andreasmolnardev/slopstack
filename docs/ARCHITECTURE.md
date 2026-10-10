# Architecture

This document describes the Slopstack template as it exists today. It is a
description, not a proposal.

## Repository layout

```
slopstack/
  apps/
    server/                Go module directory (single module, repo root go.mod)
      cmd/slopstack/       main package: cobra root command, Huma OpenAPI, wiring
      internal/app/        monolith package: bootstrap, schema, auth, routes, config
      pb_migrations/       PocketBase migration files (Go)
      .air.toml            dev hot-reload config
      pb_data/             local database (gitignored)
    web/                   Vite + React app
      src/app.tsx          the entire reference UI and example module
      src/components/ui/   shadcn/ui primitives
      src/api/pocketbase.ts PocketBase JS client instance
      src/api/generated/   Hey API output (gitignored, generated)
  docs/                    this documentation set
  .github/workflows/       CI and release workflows
  go.mod                   the single Go module
  pnpm-workspace.yaml      the pnpm workspace
  Makefile                 dev/build/test/lint/migrate wrapper targets
  Dockerfile               three-stage production image
  docker-compose.yml       single-service compose file
```

There is no `packages/` directory today even though `pnpm-workspace.yaml`
declares `apps/*` and `packages/*`. Adding a workspace package only requires
creating `packages/<name>`.

## Module and workspace boundaries

- One Go module: `github.com/slopstack/slopstack`. All Go code, including
  `apps/server`, is compiled from the root `go.mod`. Import paths mirror the
  directory layout, e.g. `github.com/slopstack/slopstack/apps/server/internal/app`.
- `internal/app` is an `internal` package, so it cannot be imported from
  outside this module. Any extraction into shared packages must create
  top-level non-internal packages (e.g. `pkg/...` or a separate module) or the
  import path has to change.
- pnpm workspace root `package.json` holds the orchestration scripts and
  workspace dev dependencies. `apps/web` is the only workspace package
  (`@slopstack/web`).

## apps/server

`cmd/slopstack/main.go` is the only entry point. It:

1. loads configuration from the environment (`app.LoadConfig`),
2. builds a `pocketbase.PocketBase` with `DefaultDataDir` from
   `SLOPSTACK_STORAGE_PATH` and `DefaultDev` from `SLOPSTACK_DEVELOPMENT`,
3. renames the cobra root command to `slopstack` and pre-sets the persistent
   `--http` flag from config,
4. constructs the Huma API, calls `app.Register`, and adds the
   `openapi export` cobra subcommand,
5. calls `pb.Start()`.

The cobra command tree is PocketBase's, with extra commands added by the
template. That means `serve`, `migrate up`, `superuser`, `migrate collections`,
`backup`, and friends all come from PocketBase unchanged.

### Huma and the OpenAPI surface

Huma is used for **schema and documentation only**. `main.go` creates the
adapter with a throwaway `http.NewServeMux()`:

```go
api := humago.New(http.NewServeMux(), huma.DefaultConfig("Slopstack API", "0.1.0"))
```

That mux is never served. The OpenAPI document is collected from
`huma.Register` calls and then exposed two ways:

- over HTTP, by `registerRoutes` in `internal/app/app.go`:
  - `GET /openapi.json`
  - `GET /openapi.yaml`
  - `GET /docs` (a ReCDoc HTML page pointing at `/openapi.json`)
- offline, by the cobra command `slopstack openapi export`, which writes
  `openapi/openapi.json` (gitignored). Wired via
  `pnpm generate:api`, then `pnpm generate:client` runs
  `openapi-ts -i ../../openapi/openapi.json -o src/api/generated`.

The document declares OpenAPI `3.1.0`, a `bearer`/JWT security scheme named
`pocketbaseAuth`, and a single server entry from `SLOPSTACK_PUBLIC_URL`.

Because Huma never owns the live router, a Huma operation that is registered
but not also bound to `e.Router` documents a route that does not exist. In the
current template `GET /api/todos` exists twice: once as a Huma operation in
`registerTodoAPI` (documentation) and once as a real PocketBase route in
`registerTodoRoutes` (behaviour).

### HTTP surface

Verified against a running `slopstack serve` on a scratch data directory
during the Phase 0 baseline:

| Path        | Status | Owner                            |
| ----------- | ------ | -------------------------------- |
| `/api/health` | 200 | PocketBase                       |
| `/_/`       | 200    | PocketBase admin UI (superusers) |
| `/openapi.json` | 200 | template                          |
| `/openapi.yaml` | 200 | template                          |
| `/docs`      | 200    | template                          |
| `/api/todos` | 401 unauthenticated | template               |
| `/`          | 404    | nothing serves the SPA           |

PocketBase additionally serves its full standard API under `/api`
(`/api/collections`, `/api/records`, `/api/auth-*`, `/api/realtime`,
`/api/settings`, `/api/backups`, ...). `/api/settings`, `/api/collections`,
`/api/records`, `/api/backups`, and `/api/admins` are superuser-only.

Note that `/` returns 404 in the container image too: the image copies
`apps/web/dist` to `/app/public`, but nothing registers a static file handler
for it. `PATCH.md` lists "verify static frontend serving through the Go
runtime" as an open bug.

## Schema definition

The schema has two sources that must be kept in sync.

1. `apps/server/internal/app/schema.go` — `EnsureCollections` is a bootstrap
   hook. On `OnBootstrap` it creates the base collections if they are absent,
   adds any missing declared field to a collection that already exists, and
   then runs `app.RunAppMigrations()`. Field definitions are materialized into
   typed `core.Field` values; the JSON round-trip that was used previously
   recursed infinitely under `encoding/json/v2` (go1.27) and has been removed.
2. `apps/server/pb_migrations/` — ordinary PocketBase migrations, registered
   through the blank import in `main.go`. The template ships one,
   `20260824000000_add_user_is_admin.go`.

Collections created by `EnsureCollections`:

| Collection          | Auth | Fields |
| ------------------- | ---- | ------ |
| `users`             | yes  | `display_name` text, `disabled` bool, `isAdmin` bool |
| `groups`            | no   | `name` text (required), `description` text |
| `permissions`       | no   | `name` text (required), `category` text |
| `group_permissions` | no   | `group` text (required), `permission` text (required) |
| `user_permissions`  | no   | `user` text (required), `permission` text (required), `denied` bool |
| `group_members`     | no   | `group` text (required), `user` text (required) |
| `todos`             | no   | `owner` text (required), `title` text (required), `completed` bool, `due_date` date |
| `audit_logs`        | no   | `actor` text, `action` text (required), `metadata` json |

No collection created by the template sets API rules, so all records are
superuser-only through PocketBase's own API. Access control for app routes is
done in Go instead.

## Auth and authorization

- PocketBase owns sessions: login, logout, refresh, password reset, email
  verification, OAuth2, and the `_superusers` collection.
- `internal/app/auth.go` exposes `RegistrationAllowed` (reads
  `SLOPSTACK_REGISTRATION_ENABLED`) and `CurrentUser`.
- `internal/app/authorization.go` exposes `Authorize`, the single backend
  enforcement point: unauthenticated is `401`, superuser passes, everyone else
  is `403`. It takes a permission name for the error message only; it does not
  yet consult the `permissions` / `group_permissions` tables, and no route
  calls it.
- `internal/app/app.go` registers `OnRecordCreateRequest`/`OnRecordUpdateRequest`
  hooks on `users` so `isAdmin` can only be set by a superuser.

## apps/web

- Vite 7 + React 19, TypeScript, ESM, Tailwind v4 via `@tailwindcss/vite`.
- `src/main.tsx` mounts the app with `QueryClientProvider` (TanStack Query),
  `ThemeProvider` (next-themes), and `TooltipProvider`.
- `src/app.tsx` is a 2765-line single file containing the router, auth pages,
  admin dashboard, the example task module, the component gallery, and the
  icon gallery. Routing is hand-rolled: `routeForPath` maps
  `window.location.pathname` to a `Route` union and `useNavigation` wraps
  `history.pushState` plus a `popstate` listener. There is no file-based route
  tree, even though `@tanstack/react-router` is a dependency.
- `src/api/pocketbase.ts` exports a single `PocketBase` instance bound to
  `import.meta.env.VITE_API_URL ?? window.location.origin`.
- `src/components/ui/` holds the shadcn/ui primitive set (60 files).
  `components.json` at the repo root carries the shadcn config.
- Data fetching uses the PocketBase JS SDK directly. `src/api/generated/`
  exists but is gitignored and not present in a fresh checkout.

## Dev loop

`pnpm dev` runs `concurrently` with two children:

- `pnpm dev:server` → `go run github.com/air-verse/air@latest -c .air.toml`
- `pnpm dev:web` → `vite`

`.air.toml` builds `./cmd/slopstack` into `apps/server/tmp/slopstack` and runs
it as
`SLOPSTACK_DEVELOPMENT=true ./tmp/slopstack serve --http=${SLOPSTACK_HTTP_ADDRESS:-0.0.0.0:8090}`.
It rebuilds on `.go`, `.json`, `.yaml`, `.yml`, `.toml` and excludes `tmp`,
`pb_data`, `node_modules`. Air is fetched at `latest` on every run, so the dev
build is not reproducible.

Vite serves on `5173` and proxies `/api` to `http://localhost:8090`.

## Build and deploy

- `Makefile`: `dev`, `build`, `test`, `lint`, `generate`, `docker`, `migrate`.
  `make test` runs `pnpm test` then `go test ./...` from the repo root.
  `make migrate` runs `go run ./apps/server/cmd/slopstack migrate up`.
- `Dockerfile`: `node:24-alpine` builds the web app, `golang:1.26-alpine`
  builds a `CGO_ENABLED=0` binary, and the runtime is `alpine:3.22` with a
  non-root `slopstack` user, `/app/pb_data` as a volume, and port 8090
  exposed. `HEALTHCHECK` polls `/api/health`.
- `docker-compose.yml`: one service on `8090`, `SLOPSTACK_PUBLIC_URL` and
  `SLOPSTACK_STORAGE_PATH` set, data in the `slopstack-data` volume.

## Data locations

| What | Where |
| ---- | ----- |
| PocketBase database | `<SLOPSTACK_STORAGE_PATH>/data.db` and `auxiliary.db`, default `pb_data` next to the process working directory |
| Local uploads | `<SLOPSTACK_STORAGE_PATH>/storage` |
| Air build output | `apps/server/tmp/` (gitignored) |
| OpenAPI export | `openapi/openapi.json` (gitignored) |
| Generated TS client | `apps/web/src/api/generated/` (gitignored) |
| Web build output | `apps/web/dist/` (gitignored) |

A checkout with `apps/server/pb_data/` present has a pre-existing database;
the data files themselves are gitignored.

## Known inconsistencies

1. `go.mod` declares `go 1.26.0`; the Dockerfile pins `golang:1.26-alpine`.
   The machine toolchain used for the baseline was go1.27.1, where
   `encoding/json/v2` is active. This is the root cause of the stack overflow
   that the `EnsureCollections` rewrite fixed.
2. Every direct dependency in `go.mod`, including `pocketbase`, `huma`, and
   `cobra`, is marked `// indirect`. Nothing imports them through a direct
   require block, so `go mod tidy` will not clean this up correctly.
3. `go test ./...` is run from the repo root in CI, and works, because there is
   a single module. `Makefile`'s `make build` uses
   `go build ./apps/server/cmd/slopstack`, which also works from the root.
4. Huma's adapter is constructed with a `http.ServeMux` that is discarded. It
   is documentation-only, but the code reads as if Huma served traffic.
5. `GET /api/todos` returns `[]` and ignores the `Config` argument
   (`_ = config` in `registerTodoRoutes`). It exists as a shape example.
6. The generated API client directory is gitignored while `AGENTS.md` and
   `docs/DEVELOPMENT.md` instruct developers to regenerate it after API
   changes and never edit it by hand. CI runs `pnpm generate:client` and then
   `git diff --exit-code`, which cannot detect a missing or stale client
   because the output is ignored.
7. The production image serves the SPA at `/app/public`, but no static handler
   is registered, so `/` returns 404 in Docker. Listed as an open bug in
   `PATCH.md`.
8. `pnpm-workspace.yaml` declares `packages/*` but no such directory exists.
9. `@tanstack/react-router` is a dependency but `app.tsx` implements routing
   by hand and never imports it. TanStack Query is used only for its
   `QueryClientProvider`.
10. `apps/web/src/app.tsx` mixes the reference module, the router, the auth
    pages, and the admin console. Any change is a single large-file conflict.
11. `.air.toml` uses `air@latest`, so the dev loop is not version-pinned,
    while CI pins Node and pnpm explicitly (though not Go — CI uses
    `go-version: stable`).
12. `SLOPSTACK_SECURE_COOKIES`, `SLOPSTACK_REGISTRATION_ENABLED`, and
    `SLOPSTACK_LOG_LEVEL` are read into `Config`, but nothing consumes them
    except `RegistrationAllowed`, which no route calls.
13. `docs/DATA-MODEL.md` and `docs/AUTH.md` describe the collections and auth
    model; the permission tables (`permissions`, `group_permissions`,
    `user_permissions`) exist in the schema but have no read or enforcement
    path yet.