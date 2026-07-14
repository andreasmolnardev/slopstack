# Slopstack

Slopstack is an API-first full-stack template with an embedded PocketBase backend and a static React frontend.

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

## OpenAPI

The server serves `/openapi.json`, `/openapi.yaml`, and `/docs`. Export offline with `go run ./apps/server/cmd/slopstack openapi export`.

## Docker And Deployment

`docker compose up --build` runs the production image and persists PocketBase data in `slopstack-data`. Set `SLOPSTACK_PUBLIC_URL` and secure-cookie values for your deployment.

## Customization

The Todo example is in `apps/web/src/app.tsx`. Replace it without changing backend infrastructure. Add modules through protected API routes, schemas, and generated client calls. Keep schema evolution in PocketBase migrations.
