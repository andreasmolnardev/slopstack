# Data Model

## Embedded collections

Collections are created by `apps/server/internal/app/schema.go` on first boot and persisted by PocketBase.

| Collection | Purpose |
| --- | --- |
| `users` | Auth records and profile fields |
| `groups` | Team or role groups |
| `permissions` | Named capability definitions |
| `group_permissions` | Group capability assignments |
| `user_permissions` | User overrides and denies |
| `group_members` | User membership relationships |
| `todos` | Example task records owned by a user |
| `audit_logs` | Security and activity history |

## Example task fields

The starter `todos` collection has `owner`, `title`, `description`, `priority`, `completed`, and `due_date`. Each task belongs to one user. Priority accepts `High`, `Medium`, or `Low`; an empty due date means no due date is set.

When making schema changes, add a new PocketBase migration. Do not rewrite an applied migration.
