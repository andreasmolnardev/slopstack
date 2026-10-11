# API

## Runtime

- Backend: Go, Huma, and PocketBase.
- Default API address: `http://localhost:8090`.
- Vite proxies `/api` to the backend using `slopstack.yaml`.
- OpenAPI JSON: `/openapi.json`; YAML: `/openapi.yaml`; docs: `/docs`.
- Export the document with `pnpm generate:api` and regenerate the typed web
  client with `pnpm generate:client`.

## Todo example

All Todo routes require a PocketBase bearer token. Records are scoped to the
authenticated owner. Create and update bodies cannot set or change `owner` or
PocketBase managed fields.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/todos` | List the current user's todos |
| `POST` | `/api/todos` | Create a todo for the current user |
| `GET` | `/api/todos/{id}` | Read one of the current user's todos |
| `PATCH` | `/api/todos/{id}` | Update title, completion, or due date |
| `DELETE` | `/api/todos/{id}` | Delete one of the current user's todos |

Example:

```http
POST /api/todos
Authorization: Bearer <pocketbase-token>
Content-Type: application/json

{"title":"Review the migration","completed":false}
```

Missing authentication returns `401`. A record owned by another user is not
read or changed through the current user's routes.

## Extending a module

1. Define request and response types in the app server.
2. Register operations with Huma, including security metadata.
3. Authenticate in the handler and scope records to the current user.
4. Add a new PocketBase migration for persistent schema changes; keep applied
   migrations unchanged.
5. Export OpenAPI and regenerate the client.
6. Use generated calls from the React feature and test loading, errors, and
   mutations.

Never treat frontend visibility as authorization. Backend checks own access.
