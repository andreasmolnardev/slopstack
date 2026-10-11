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
`NewCommandWithOptions` preserves existing app contracts such as encrypted-only
creation, positional or stdin key import, one-time key guidance, restore restart
guards, transient archive prefixes, and app-supplied subcommands. The apps keep
domain-specific JSON export formats and scheduling. Encrypted archives retain
the `SLBK1` AES-GCM envelope, and the PocketBase adapter supports local and
configured remote stores. Restore replaces live data and restarts the process,
so it requires the explicit `--confirm` flag. Save the one-time recovery key
outside the app data directory.

The first shared runtime release is
[`github.com/andreasmolnardev/slopstack v0.1.0`](https://github.com/andreasmolnardev/slopstack/releases/tag/v0.1.0).
The backup compatibility additions are being prepared for v0.2.0. During
integration, each app uses a temporary sibling `replace`; it will be removed
after v0.2.0 is published and both apps pin that immutable version. Updating
Slopstack does not silently change either application. Follow
`docs/COMPATIBILITY.md` for the cross-app test matrix and remaining historical
database validation.
