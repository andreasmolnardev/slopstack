# Data Model

## Embedded collections

Collections are created by `apps/server/internal/app/schema.go` on first boot and persisted by PocketBase.

| Collection | Purpose |
| --- | --- |
| `users` | Auth records and profile fields |
| `organizations` | Optional tenant records; unused by single-user apps |
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

Organizations and groups are optional. A single-user app can use owner-scoped records and leave both unused. Multi-user apps can assign users to groups, optionally scope groups to an organization, and grant named permissions to groups. An explicit user permission overrides group rules; explicit user denies always win, and a deny from any group beats grants from other groups.

Personal locale, time zone, date/time format, theme, and navigation choices live in the `users.preferences` JSON field and are read or updated through `/api/me/preferences`.
