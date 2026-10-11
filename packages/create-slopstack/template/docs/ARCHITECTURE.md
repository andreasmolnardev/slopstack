# Architecture

This describes the current Slopstack starter. The Todo screens are an example
module; PocketBase, authentication, migrations, API generation, and shared Go
packages are the reusable runtime.

## Repository layout

```text
apps/server/                 PocketBase composition root and app handlers
  cmd/slopstack/             CLI and Huma/OpenAPI setup
  internal/app/              config, schema, auth adapter, Todo CRUD
  pb_migrations/             PocketBase migrations
apps/web/                    Vite + React reference UI
  src/api/client.ts          generated-client auth/base URL setup
  src/api/generated/         Hey API output
  src/hooks/useTodos.ts      TanStack Query Todo operations
docs/                        runtime and development guides
go/{auth,authorization,backup,config,httpapi}/ reusable Go runtime packages
packages/create-slopstack/   packaged starter and safe create/upgrade CLI
scripts/                     config validation, deploy, release, baseline checks
go.mod                       single Go module
slopstack.yaml               project identity, runtime, and release settings
```

The server and shared Go packages compile in the repository's single Go module.
The web app is the `@slopstack/web` pnpm workspace. The packaged generator
template includes the current Go runtime, Todo UI, and generated client.

## Server and API

`apps/server/cmd/slopstack/main.go` loads app config, creates PocketBase,
registers the Huma API, and adds `slopstack openapi export`. Huma registers the
Todo operation schemas and handlers. On serve, PocketBase routes for
`/api/todos` and `/api/todos/{id}` pass their request events to Huma's adapter,
which serves those same registered operations. `/openapi.json`, `/openapi.yaml`,
and `/docs` expose the generated API description.

The authenticated Todo API supports list, create, get, update, and delete.
Handlers set the owner from the authenticated PocketBase record, scope reads
and writes to that owner, and accept only title, completed, and due date as
mutable input. The Todo collection is created by the app schema setup; schema
changes with persisted-data implications belong in new PocketBase migrations.

The `openapi export` command writes `openapi/openapi.json`. The web package's
`generate:client` command consumes it and writes `apps/web/src/api/generated/`.
Regenerate after changing Huma operations; do not hand-edit generated files.

## Authentication and shared Go packages

PocketBase owns sessions, login, registration, verification, reset, and
superuser records. `go/auth` contains request authentication helpers;
`go/authorization` evaluates grants with explicit-deny precedence and loads
permission records through its PocketBase adapter. `go/config` reads typed
environment settings with optional legacy aliases. `go/backup` owns the
PocketBase ZIP backup command, key management, and `SLBK1` encryption envelope.
Apps may extend it with domain-specific exports or scheduling.
`go/httpapi` serves built frontend assets and client-side routes while keeping
API, admin, and documentation paths reserved for the backend.

App-specific composition, config structures, collection schema, route handlers,
and data formats stay in each app. See [Shared runtime](./SHARED-RUNTIME.md)
and [Authentication](./AUTH.md).

## Web client

`apps/web/src/api/client.ts` sets the generated Hey API client's base URL and
reads its bearer token from PocketBase's auth store. `useTodos` uses TanStack
Query for list and mutation state and invalidates the Todo cache after writes.
The Todo view handles loading, empty, error, and mutation states. Authentication
and local UI routing remain in the reference app.

## Development and deployment

`slopstack.yaml` defines the canonical camelCase project schema. Vite reads its
web port and API proxy target. `pnpm deploy` previews a multi-platform Buildx
command by default; `pnpm deploy --push` checks the pinned Buildx version and
pushes; `pnpm deploy --export PATH` writes a local OCI archive.
`pnpm release --version x.y.z` previews a version update, and `--apply` only
updates the version and image tag in the config. See [Deployment](./DEPLOYMENT.md)
and [Project tooling](./PROJECT-TOOLING.md).

CI pins Go, Node, and pnpm versions. Docker base images and the Air dev tool
also use explicit versions. Local PocketBase data stays under the configured
storage path and is not copied by the project generator or modified by the
release tooling.
