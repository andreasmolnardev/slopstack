# Shared Go runtime

Slopstack owns the reusable packages under `go/`. Taskboard and Piggybudget
consume them through the `github.com/andreasmolnardev/slopstack` module; the apps keep
their PocketBase composition roots, config structs, database schemas, route
handlers, archive formats, and domain logic.

| Package | Responsibility | Current consumers |
| --- | --- | --- |
| `go/auth` | PocketBase authenticated-user and user-ID helpers | Slopstack, Taskboard, Piggybudget |
| `go/authorization` | Storage-agnostic user/role permission evaluation; explicit denies override grants | Slopstack, Taskboard, Piggybudget |
| `go/backup` | PocketBase backup CLI, encryption-key management, and authenticated encryption | Slopstack, Taskboard, Piggybudget |
| `go/config` | Environment lookup with legacy aliases and typed fallback parsing | Slopstack, Taskboard, Piggybudget |
| `go/httpapi` | Static frontend assets and SPA fallback routes | Slopstack, Taskboard, Piggybudget |

The authorization evaluator deliberately does not own a database schema. Its
PocketBase adapter reads the shared `user_permissions`, `group_members`, and
`group_permissions` collections; each application remains responsible for
creating those collections. Regular users are denied by default, explicit user
denies override grants, and superusers retain the existing bypass unless an
explicit deny is present.

`go/backup` provides the shared `backup` CLI for PocketBase ZIP archives:
`backup create [--encrypt]`, `backup list`, and
`backup restore <exact-name> --confirm`, plus `key-init` and `key-import`.
Encrypted archives retain the `SLBK1` AES-GCM envelope used by the existing
apps. The shared command handles local or configured PocketBase backup storage;
apps keep domain-specific JSON export formats and backup scheduling they need.
Restore replaces live data and restarts the process, so it requires the explicit
`--confirm` flag. Save the one-time recovery key outside the app data directory.

For local coordinated development, the two app modules currently use a Go
`replace` directive pointing at the sibling Slopstack checkout. That is a
workspace-only integration setting. Before a consumer release, replace it with
a released Slopstack module version and run the independent build and restore
matrix from `docs/COMPATIBILITY.md`. No release or registry publish is performed
by local development.
