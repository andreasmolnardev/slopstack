# Development

## Setup

```sh
pnpm install
cp .env.example .env
pnpm generate:api
pnpm generate:client
pnpm dev
```

Vite serves the web app on `5173`. Go and PocketBase serve the API on `8090`.

## Checks

```sh
pnpm --filter @slopstack/web lint
pnpm --filter @slopstack/web build
pnpm --filter @slopstack/web test
go test ./...
```

## Feature workflow

1. Add or update the backend schema and migration.
2. Add protected API operations.
3. Export OpenAPI and regenerate the client.
4. Build feature UI from shadcn primitives.
5. Add behavior tests.
6. Run client and server checks.

Generated output under `apps/web/src/api/generated` must not be edited manually.

## Create and update an app

```sh
pnpm slopstack init ../my-app
cd ../my-app
pnpm slopstack upgrade --from ../slopstack --preview
pnpm slopstack upgrade --from ../slopstack
pnpm slopstack rollback
```

The CLI records SHA-256 baselines for template-owned files in `.slopstack/state.json`. An upgrade stops before writing if a file changed both locally and in the new template. It snapshots changed files and the old manifest, runs `go test ./...` and the web production build, and restores the snapshot if validation fails. Keep domain code and data in app-owned files; upgrades never replace files with local edits silently.
