# Shared Go runtime

Slopstack owns the reusable packages under `go/`. Taskboard and Piggybudget
consume them through the `github.com/andreasmolnardev/slopstack` module; the apps keep
their PocketBase composition roots, config structs, database schemas, route
handlers, archive formats, and domain logic.

| Package            | Responsibility                                                                    | Current consumers                 |
| ------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| `go/auth`          | PocketBase authenticated-user and user-ID helpers                                 | Slopstack, Taskboard, Piggybudget |
| `go/audit`         | App-agnostic audit event contract, PocketBase recorder, and opt-in native CRUD hooks | Slopstack, Taskboard, Piggybudget |
| `go/authorization` | Storage-agnostic user/role permission evaluation; explicit denies override grants | Slopstack, Taskboard, Piggybudget |
| `go/backup`        | PocketBase backup CLI, encryption-key management, and authenticated encryption    | Slopstack, Taskboard, Piggybudget |
| `go/config`        | Environment lookup with legacy aliases and typed fallback parsing                 | Slopstack, Taskboard, Piggybudget |
| `go/httpapi`       | Huma request bridging, OpenAPI/ReDoc docs, static frontend assets, and SPA fallback routes                                    | Slopstack, Taskboard, Piggybudget |
| `go/ownership`     | Opt-in PocketBase owner checks, assignment, and protected-field restoration       | Slopstack, Taskboard, Piggybudget |

`go/httpapi` mounts Huma operations through PocketBase and lets each app attach its request event to the request context. Huma keeps responsibility for operation validation and standardized success/error serialization; route handlers remain app-owned.

The authorization evaluator deliberately does not own a database schema. Its
PocketBase adapter reads the shared `user_permissions`, `group_members`, and
`group_permissions` collections; each application remains responsible for
creating those collections. Regular users are denied by default, explicit user
denies override grants, and superusers retain the existing bypass unless an
explicit deny is present.

`go/audit` writes actor IDs and action names into the existing `audit_logs`
collection and stores resource IDs plus caller-supplied safe metadata in its
JSON `metadata` field. The selected-collection request hooks record successful
native create, update, and delete requests without reading record fields.
Applications should use the hooks only for their chosen collections and call
the logger directly from custom routes or programmatic write paths. See
[`AUDIT.md`](./AUDIT.md) for the API and metadata guidance.

`go/ownership` supplies opt-in hooks for native PocketBase record requests and
an `IsOwner` helper for custom routes. Applications retain their own schema,
read rules, relationship validation, and domain-specific deletion behavior.
See [`OWNERSHIP.md`](./OWNERSHIP.md) for the policy contract.

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

The shared runtime is released as
The shared runtime is released as [`github.com/andreasmolnardev/slopstack v0.3.0`](https://github.com/andreasmolnardev/slopstack/releases/tag/v0.3.0). It adds audit and ownership packages plus shared OpenAPI and Huma routing. Taskboard and Piggybudget pin this immutable version in their app updates. Updating Slopstack does not silently change either application. Follow `docs/COMPATIBILITY.md` for the cross-app test matrix and
historical database validation status.
