# Compatibility Baseline and Current Runtime

This document records the Phase 0 baseline of the **Slopstack template**: what
the toolchain was, what passed, and what later phases must not break. It is a
description of the measured baseline followed by the current runtime contract.
The historical Phase 0 measurements below are retained for migration context;
the HTTP surface section documents the implemented template now.

The machine-readable companion is [`docs/baseline.json`](baseline.json).
`scripts/check-baseline.py` fails CI if the two disagree.

## Toolchain as measured

Recorded on darwin/arm64 during the Phase 0 audit.

| Tool | Version | Source |
| ---- | ------- | ------ |
| Go | `go1.27.1 darwin/arm64` | `go version` |
| Node | `v22.23.2` | `node -v` |
| pnpm (installed) | `12.8.1` | `pnpm -v` |
| pnpm (declared) | `11.8.0` | `package.json` → `packageManager` |
| PocketBase | `v0.39.6` | `go.mod` |
| Huma | `v2.38.0` | `go.mod` |
| Vitest | `4.1.10` | `apps/web/node_modules/vitest` |
| React | `19.2.7` | `apps/web/node_modules/react` |
| Vite | `7.3.6` | `apps/web/node_modules/vite` |
| TypeScript | `5.9.3` | `apps/web/node_modules/typescript` |

### The pnpm discrepancy

`package.json` declares `"packageManager": "pnpm@11.8.0"`, but the machine that
produced this baseline had pnpm `12.8.1` on `PATH`. Corepack was not in play and
there is no `.npmrc`, so nothing enforced the declared version. Both are recorded
rather than reconciled: CI now pins `PNPM_VERSION: 11.8.0` to match
`package.json`, so CI and the declaration agree even though the local machine
did not. `pnpm-lock.yaml` is `lockfileVersion: '9.0'`, which both majors read.

Two related version facts, recorded because they caused a real bug:

- `go.mod` declares `go 1.26.0`, and the `Dockerfile` pins `golang:1.26-alpine`.
  The audit toolchain was go1.27.1, where `encoding/json/v2` is the active JSON
  implementation. That mismatch is the root cause of the stack overflow fixed in
  `0b6ea41`; see "Command results" below.
- CI previously ran `go-version: stable` and `node-version: 24` and
  `pnpm version: 11`, none of which matched the measured local toolchain. CI now
  pins the versions above.

## Command results

### Before the fix (`0b6ea41^`)

Reproduced by restoring the pre-fix `apps/server/internal/app/schema.go` and
`schema_test.go` on a clean tree, then re-running the commands.

| Command | Result |
| ------- | ------ |
| `go build ./...` | PASS |
| `go test ./...` | **FAIL** |
| `pnpm -r lint` | PASS |
| `pnpm -r test` | PASS, zero test files |

The `go test` failure is a hard runtime crash, not a test assertion failure:

```
runtime: goroutine stack exceeds 1000000000-byte limit
fatal error: stack overflow
```

The repeating frame is `core.(*Collection).UnmarshalJSON`, called from
`internal/app.EnsureCollections`. `EnsureCollections` marshalled its field
descriptions and unmarshalled them back into the `*core.Collection`; under
`encoding/json/v2` on go1.27 that recursion never terminates.

`pnpm -r test` passed only because `apps/web` runs
`vitest run --passWithNoTests` and no test file existed. The green was empty.

### After the fix (`0b6ea41` onwards, HEAD of this audit)

Re-run locally immediately before this file was written.

| Command | Result |
| ------- | ------ |
| `go build ./...` | PASS |
| `go test -count=1 ./...` | PASS — `internal/app` ok, 5 tests |
| `pnpm -r lint` | PASS |
| `pnpm -r test` | PASS — 3 files, 19 tests |
| `gofmt -l apps/server` | clean, no output |

Go test detail:

```
?   github.com/slopstack/slopstack/apps/server/cmd/slopstack   [no test files]
ok  github.com/slopstack/slopstack/apps/server/internal/app
?   github.com/slopstack/slopstack/apps/server/pb_migrations  [no test files]
```

The five Go tests are `TestDefaultConfiguration` (`openapi_test.go`) and
`TestEnsureCollectionsCreatesCoreCollections`,
`TestEnsureCollectionsAddsAdminFlagToUsers`,
`TestEnsureCollectionsRepairsUsersMissingAdminFlag`,
`TestEnsureCollectionsIsIdempotent` (`schema_test.go`).

The three vitest files are `src/app.smoke.test.tsx`, `src/app.helpers.test.ts`,
`src/lib/utils.test.ts`.

### Working directory

All Go commands pass from the repo root, because the repository is a single Go
module rooted at `go.mod` with no nested `go.mod`. `go build ./...` and
`go test ./...` from `apps/server` also pass and cover the same packages, since
all Go code lives there today.

CI still runs the Go steps from the repo root, matching `Makefile`'s
`make test` and `make build`. This is correct for the current layout and is
deliberate: if Go code is ever added outside `apps/server`, root-level `./...`
picks it up automatically. The `working-directory` is now pinned explicitly to
`.` rather than left implicit.

## HTTP surface

### Template-registered routes

The template registers OpenAPI documentation routes, mounts Huma operations
through PocketBase's live router, and serves the built frontend when the
configured public directory exists. The SPA wildcard is registered for all
methods so it can coexist with PocketBase's all-method API routes; it only
serves frontend content for `GET` and returns 404 for other methods.

| Method | Path | Auth | Source | Line |
| ------ | ---- | ---- | ------ | ---- |
| GET | `/openapi.json` | none | `app.go` | 54 |
| GET | `/openapi.yaml` | none | `app.go` | 55 |
| GET | `/docs` | none | `app.go` | 62 |
| GET | `/api/todos` | required | `todos.go` | `listTodos` |
| POST | `/api/todos` | required | `todos.go` | `createTodo` |
| GET | `/api/todos/{id}` | required | `todos.go` | `getTodo` |
| PATCH | `/api/todos/{id}` | required | `todos.go` | `updateTodo` |
| DELETE | `/api/todos/{id}` | required | `todos.go` | `deleteTodo` |
| GET | `/{path...}` | none | `go/httpapi/static.go` | `RegisterStaticRoutes` |

Todo operations use the authenticated PocketBase request event, store records
in the `todos` collection, and scope reads, updates, and deletes to the current
user. The static route serves assets and falls back to `index.html` for
client-side routes. It excludes API, admin, OpenAPI, and docs paths from the
frontend fallback.

PocketBase itself additionally serves `/api/health`, `/_/` (admin UI),
`/api/collections`, `/api/records`, `/api/auth-*`, `/api/realtime`,
`/api/settings`, `/api/backups`, and `/api/admins`. These PocketBase-owned
routes are not registered by template code and do not appear in the route table
above. The template's conditional SPA fallback is listed separately.

### Huma-declared operations

The five Todo operations above are declared in `registerTodoAPI`
(`apps/server/internal/app/todos.go`).

| operationId | Method | Path | Schema | Security |
| ----------- | ------ | ---- | ------ | -------- |
| `listTodos` | GET | `/api/todos` | `Todo{id,title,completed,due_date,created,updated}` | `pocketbaseAuth` |
| `createTodo` | POST | `/api/todos` | `Todo` | `pocketbaseAuth` |
| `getTodo` | GET | `/api/todos/{id}` | `Todo` | `pocketbaseAuth` |
| `updateTodo` | PATCH | `/api/todos/{id}` | `Todo` | `pocketbaseAuth` |
| `deleteTodo` | DELETE | `/api/todos/{id}` | empty | `pocketbaseAuth` |

The document is OpenAPI `3.1.0`, title `Slopstack API`, version `0.1.0`, with a
single server entry taken from `SLOPSTACK_PUBLIC_URL` and a bearer/JWT security
scheme named `pocketbaseAuth`. The Huma adapter is mounted into PocketBase's
router for each declared operation, so the documented operations are the live
handlers.

### Frontend serving

When `SLOPSTACK_PUBLIC_DIR` (default `public`) exists, PocketBase serves its
files and SPA fallback from that directory. The container image copies the
Vite build to `/app/public`, so the packaged image serves both the API and
frontend from one process. During local development Vite serves the frontend
and proxies API calls to PocketBase.

## Environment variables

The Go runtime reads the following variables, plus `SLOPSTACK_PUBLIC_DIR` for
the optional built frontend.

| Variable | Type | Default | Consumed by |
| -------- | ---- | ------- | ----------- |
| `SLOPSTACK_HTTP_ADDRESS` | string | `0.0.0.0:8090` | `--http` flag default (`app.go:13`, `main.go:23`) |
| `SLOPSTACK_PUBLIC_URL` | string | `http://localhost:8090` | OpenAPI server entry (`main.go:41`) |
| `SLOPSTACK_SECURE_COOKIES` | bool | `false` | parsed into `Config`, read by nothing |
| `SLOPSTACK_REGISTRATION_ENABLED` | bool | `true` | `RegistrationAllowed` in `internal/app/auth.go`; no route calls it |
| `SLOPSTACK_LOG_LEVEL` | string | `info` | parsed into `Config`, read by nothing |
| `SLOPSTACK_STORAGE_PATH` | string | `pb_data` | `pocketbase.Config.DefaultDataDir` (`main.go:20`) |
| `SLOPSTACK_DEVELOPMENT` | bool | `false` | `pocketbase.Config.DefaultDev` (`main.go:20`) |
| `SLOPSTACK_PUBLIC_DIR` | path | `public` | Optional static frontend directory (`app.go`) |

`SLOPSTACK_DEVELOPMENT` is also set to `true` by `.air.toml` for the dev loop.
`VITE_API_URL` appears in `.env.example` and is read by
`apps/web/src/api/pocketbase.ts`, but it is a frontend build variable, not part
of the Go configuration surface.

Note the bool parsing: `envBool` uses `os.LookupEnv`, so an empty-but-set
variable parses as `false`, not as the fallback. `env` uses the empty string as
"unset". The two helpers disagree on that edge case.

## Compatibility rules for later phases

The following must not break without an explicit, documented decision and a
migration note. Breaking one of these invalidates an existing installation.

### Data

1. **The PocketBase data directory.** `SLOPSTACK_STORAGE_PATH`, default
   `pb_data`, holds `data.db`, `auxiliary.db`, `storage/`, and `.notify/`. Its
   default value and its meaning must not change. Note it is resolved relative
   to the process working directory, so it is CWD-dependent by construction.
2. **Collection names.** `users`, `groups`, `permissions`, `group_permissions`,
   `user_permissions`, `group_members`, `todos`, `audit_logs`. `users` must stay
   an auth collection. Renaming any of these orphans existing records and breaks
   every stored reference.
3. **Collection IDs.** The PocketBase-generated IDs in `_collections.id`
   (`_pb_users_auth_` for `users`, `pbc_*` for the rest). These are minted at
   creation and are not reproducible from source, so a data-directory rename or
   a drop-and-recreate destroys every record that points at a collection.
4. **Existing user credentials and auth records.** `_superusers`, `users`
   passwords, `tokenKey` values, and OAuth/OTP/MFA rows. Any change that
   invalidates tokens logs every user out.
5. **Applied migrations.** `apps/server/pb_migrations/`. Per `AGENTS.md`,
   applied migrations are preserved; schema changes are added as new migration
   files. The one applied here is
   `20260824000000_add_user_is_admin.go`.

### HTTP

6. **The `/api/*` request and response shapes.** Field names, types, and status
   codes. `GET /api/todos` returning `200` with a JSON array is part of the
   contract today.
7. **The PocketBase admin UI at `/_/`.** It is the only superuser console.
8. **The OpenAPI endpoints `/openapi.json`, `/openapi.yaml`, and `/docs`.** These
   are how consumers discover the API, and `pnpm generate:api` and
   `pnpm generate:client` both depend on the export path.
9. **The `slopstack openapi export` CLI command.** `pnpm generate:api` invokes
   `go run ./apps/server/cmd/slopstack openapi export`, which writes
   `openapi/openapi.json`. CI runs it on every push. Renaming the root command,
   the subcommand, or the output path breaks both the script and CI.

### Phase 1 caveat: renaming the Go module

Phase 1 renames the module identity. The rename must be **code-only**:

- `github.com/andreasmolnardev/slopstack` is the current canonical upstream
  module path; generated apps replace it with their own path in `go.mod` and
  imports.
- `@slopstack/web` → the target package name in `apps/web/package.json`.
- `SLOPSTACK_` → the target env prefix, in `config.go`, `.env.example`,
  `docker-compose.yml`, `README.md`, and `docs/`.

It must **not**:

- rename the PocketBase database or move `pb_data`;
- change any collection ID or collection name;
- change any env var default;
- change the `slopstack` cobra root command `Use` string in a way that breaks
  `slopstack openapi export` without a matching script change.

A module rename that touches the data directory is a silent data-loss bug: the
server starts cleanly against an empty database and every user appears to have
disappeared.

## Local database caveat

`apps/server/pb_data/` exists in this checkout and is gitignored. Its
`_collections` table was read read-only to record IDs. It is **stale** relative
to the current `schema.go`:

- present: `users` without `display_name` or `disabled`;
- declared in `schema.go`: `users` with `display_name`, `disabled`, `isAdmin`.

`EnsureCollections` repairs exactly this case — it adds any declared field that
is missing from an existing collection — and
`TestEnsureCollectionsRepairsUsersMissingAdminFlag` covers the `isAdmin` case.
So the drift is expected and self-healing. It does mean the IDs recorded in
`baseline.json` describe this one database, not a guaranteed set. A fresh
`EnsureCollections` run on a new data directory mints different `pbc_*` IDs.

The database holds 1 user record. Collection access rules were not verified from
the live database; the table below records what the code declares, which is that
no template collection sets any API rule.

## Provenance

`docs/baseline.json` was generated by the Phase 0 audit on the commit recorded
in its `git_commit` field. Tool versions were read from the live toolchain;
command results were actually executed, not inferred; route and collection
entries were read from source and from a read-only SQLite query against
`apps/server/pb_data/data.db`.

To regenerate after an intentional change: update `docs/baseline.json` in the
same commit as the change, then run `python3 scripts/check-baseline.py`. It
compares the route table against direct named-method PocketBase routes, Huma
operation methods and paths, and the effective GET-only SPA fallback in
`go/httpapi`; PocketBase `Any` adapter bridges are represented by their Huma
operations. It also compares the recorded toolchain against the pins in
`.github/workflows/ci.yml`.
