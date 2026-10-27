# API

## Runtime

- Backend: Go and PocketBase.
- Default address: `http://localhost:8090`.
- Frontend proxy: Vite forwards `/api` to the backend.
- OpenAPI JSON: `/openapi.json`.
- OpenAPI YAML: `/openapi.yaml`.
- ReDoc: `/docs`.

## Todo example endpoints

The reference Todo module uses persisted PocketBase records through these authenticated endpoints:

```http
GET /api/todos
POST /api/todos
GET /api/todos/{id}
PATCH /api/todos/{id}
DELETE /api/todos/{id}
Authorization: Bearer <pocketbase-token>
```

Each user can list and change only their own todos. A missing or foreign todo returns `404`. Create and update bodies accept `title`, `description`, `priority`, `completed`, and `due_date`; priorities are `High`, `Medium`, or `Low`, and due dates use `YYYY-MM-DD`.

For example:

```json
{
  "title": "Design homepage mockups",
  "description": "Create the first round of homepage designs.",
  "priority": "High",
  "due_date": "2026-10-30"
}
```

Unauthenticated requests return `401`. The Huma operations define the OpenAPI contract; PocketBase routes implement the requests.

## Extending a module

1. Define request and response types in the Go module.
2. Register the operation with Huma and add security metadata.
3. Enforce auth and ownership checks in the route handler.
4. Read and write PocketBase records using the current user as owner.
5. Export OpenAPI with `pnpm generate:api`.
6. Generate the client with `pnpm generate:client`.
7. Use generated client calls from the React feature.

Never treat frontend visibility as authorization. Backend `Authorize` is the enforcement point.
