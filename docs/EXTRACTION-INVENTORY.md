# Extraction Inventory

Phase 0 audit of `apps/server/internal/app` in the Slopstack template, for the
three-repo migration where Taskboard and Piggybudget adopt versioned packages
from Slopstack.

## The package is a monolith

At the Phase 0 audit, `apps/server/internal/app` was one Go package with no
internal boundaries. Files were split by topic, not by package, so nothing in
it could be imported outside the module. Since then, the shared runtime has
been extracted into public packages under `github.com/andreasmolnardev/slopstack/go/`;
see [`SHARED-RUNTIME.md`](SHARED-RUNTIME.md) for the current package contract.
The classifications below record the original extraction decisions.

Current contents, 7 files, ~180 non-comment lines of Go:

| File | Lines | Topic |
| ---- | ----- | ----- |
| `app.go` | 79 | bootstrap hooks, user admin flag, route registration, `/api/todos` |
| `auth.go` | 16 | registration policy, current user |
| `authorization.go` | 15 | single enforcement point |
| `config.go` | 44 | env-backed config struct |
| `openapi.go` | 15 | cobra `openapi export` wrapper |
| `schema.go` | 132 | collection bootstrap and repair (rewritten in Phase 0) |
| `openapi_test.go` | 10 | config smoke test |
| `schema_test.go` | 150 | schema create/repair/idempotency tests |

## Classifications

### CORE

Should become a versioned Slopstack package consumed by all three repos.

| File | Symbol | Why core | Notes |
| ---- | ------ | -------- | ----- |
| `config.go` | `Config`, `LoadConfig`, `env`, `envBool` | Every app in the family needs the same env contract. The names are already prefixed `SLOPSTACK_` in both derived apps. | The struct is not yet stable. Taskboard adds `RegistrationMode`, backup settings, and an S3 block; Piggybudget does similar. Upstream needs a core struct with a documented extension point, not the union of both derived shapes. Ambiguous — see "Ambiguous classifications". |
| `auth.go` | `RegistrationAllowed`, `CurrentUser` | Trivially small, universally needed, and already identical in shape across all three repos. | The registration policy signature differs: template returns `Config.RegistrationEnabled`, Taskboard returns `RegistrationMode != disabled`. |
| `authorization.go` | `Authorize` | Documented as "the single backend enforcement point"; every derived app copied it verbatim and calls it where the template does not. | Template version is a stub: it never reads the `permissions` / `group_permissions` tables. Real resolution logic lives in the derived apps (or nowhere). |
| `schema.go` | `EnsureCollections`, `coreCollections`, `newCollection`, `repairRequiredFields`, `addFields`, `newField` | The base schema (`users`, `groups`, `permissions`, `group_permissions`, `user_permissions`, `group_members`, `todos`, `audit_logs`) is shared by all three repos today. The typed-field construction is now the proven implementation. | Needs splitting: the shared core collections vs. `todos`, which is an example module both derived apps replaced. See "Ambiguous classifications". |
| `openapi.go` | `OpenAPIExportCommand` | A cobra wrapper that both derived apps carry identically. Trivially extractable. | The `Run func() error` field is a closure-injection seam, not a general interface. Fine as-is. |

### OPTIONAL-SHARED

Real candidates, but the value is unproven and the API is not settled. Needs
review before being promoted to CORE.

| File | Symbol | Why it might be shared | Why it is not CORE yet |
| ---- | ------ | ----------------------- | ---------------------- |
| `app.go` (route registration half) | `registerRoutes`, `registerTodoAPI`, `registerTodoRoutes` | `/openapi.json`, `/openapi.yaml`, and `/docs` are identical in Taskboard and Piggybudget, and both derived apps keep the same `/api/todos` shape example. | The file is one function-per-concern grab bag. The OpenAPI-serving part is a clean candidate for a `slopstack/openapi` package; the `/api/todos` part is an example, not infrastructure. |
| `app.go` (bootstrap half) | `Register`, `protectUserAdminFlag` | Every app needs the bootstrap hook order (`EnsureCollections` then `RunAppMigrations`) and the `isAdmin` protection. Taskboard and Piggybudget both call the same-named `protectUserAdminFlag`. | `Register` takes `pb, config, api` — it is the composition root, and it is also where the derived apps hang their extra hooks. Upstream needs a hook/slot mechanism instead of a fixed signature. |
| `app.go` `protectUserAdminFlag` | request hooks on `users` | Identical intent in all three repos: `isAdmin` may only be set by a superuser. | Taskboard's version also takes `config` and applies activation-code logic, so the two are not yet the same code. |

### APP-OWNED

Belongs in a derived app, not in the template.

| File | Symbol | Why |
| ---- | ------ | --- |
| `app.go` `registerTodoRoutes` / `registerTodoAPI` | `GET /api/todos` | The README, `docs/README.md`, and `docs/API.md` all state the task workspace is an example module, not the product. Taskboard replaced it with CalDAV/CardDAV; Piggybudget replaced it with finance endpoints. Nothing should depend on this upstream. The route is nevertheless part of the compatibility surface today — see `COMPATIBILITY.md`. |
| `schema.go` `todos` collection definition | `owner`, `title`, `completed`, `due_date` | Same reasoning. It exists so a new user has something to click. |

### OBSOLETE

| File | Symbol | Why |
| ---- | ------ | --- |
| none | — | Nothing in the package is dead code. `authorize.go`'s `Authorize` and `auth.go`'s `RegistrationAllowed` are uncalled but are live API surface for derived apps to call, not obsolete. Flagged here so the decision is explicit rather than by omission. |

## Where the derived apps are already richer than the template

Measured by file comparison against `taskboard/apps/server/internal/app` and
`piggybudget/apps/server/internal/app`. The template is the *smallest* of the
three; nothing in the derived apps needs to move downstream.

| Concern | Template | Taskboard | Piggybudget |
| ------- | -------- | --------- | ----------- |
| `internal/app` file count | 8 | 39 | 40 |
| Registration policy | bool `SLOPSTACK_REGISTRATION_ENABLED` | 3-state `SLOPSTACK_REGISTRATION_MODE` (disabled/approval/otp) with `RegistrationRequiresApproval` / `RegistrationRequiresOTP` | same as Taskboard |
| Config surface | 7 `SLOPSTACK_*` vars | 20 `SLOPSTACK_*` vars incl. `SLOPSTACK_BACKUP_*`, S3 block | 19 `SLOPSTACK_*` vars |
| Backup | none | `backup_command.go`, `backup_encryption.go`, `backup_formats.go`, `backup_scheduler.go` + tests | `backup_command.go` |
| App passwords | none | `app_passwords.go`, `app_password_throttle.go` + tests | same |
| Guest access | none | `guest_auth.go` + test | same |
| Ownership enforcement | none (no hooks) | `ownership.go` — create/update hooks that force `owner` to the auth record and validate container fields | same |
| Search | none | `search.go` + test | same |
| Notifications | none | `notifications.go` + test | same |
| CalDAV / CardDAV | none | `caldav.go`, `caldav_changes.go`, `caldav_xml.go`, `carddav.go`, `calendar_io.go`, `vcard.go`, `occurrences.go` + tests | CalDAV/CardDAV subset |
| HTTP integration tests | none | `http_integration_test.go`, `openapi_registration_test.go` | same |
| Domain schema | `todos` only | `events`, `lists`, `calendars`, `contacts`, `address_books`, CalDAV/CardDAV change feeds | `finance_schema.go`, `asset_groups.go`, `transaction_attachments.go` |

Implication for the migration: the extraction direction is template → derived
apps for the CORE items only. Everything in the middle and right columns is
already implemented twice in derived code and should be reimplemented per app,
not centralized, unless a later phase finds a genuine shared seam.

## Ambiguous classifications

Flagged rather than forced into a bucket.

1. **`config.go` — CORE vs OPTIONAL-SHARED.** The env var names are already a
   de facto shared contract (`SLOPSTACK_*` appears unchanged in both derived
   repos), which argues CORE. But the two derived `Config` structs are supersets
   with different shapes for registration, so there is no single struct that is
   both correct and sufficient. Recommend: publish the env var *names* as the
   contract, and a `Config` struct with explicit extension fields.
2. **`schema.go` `coreCollections` — one unit or two.** The eight collections
   are declared in one slice, but seven are infrastructure and `todos` is an
   example. Taskboard kept the same eight names and added nine. If the slice
   moves upstream verbatim, every derived app inherits a `todos` collection it
   does not use. Recommend splitting the declaration into a core set and an
   example set before extraction.
3. **`authorization.go` `Authorize` — CORE or placeholder.** The template's
   version denies all non-superusers. Both derived apps carry the same stub.
   Centralizing a stub upstream locks in a permission model that does not exist
   yet. Recommend deferring until the `permissions` / `group_permissions`
   tables have a real resolution path.
4. **`app.go` `Register` signature.** It is the composition root for all three
   repos but has no extension point. This is the main blocker for extracting
   anything else from the package.
5. **`audit_logs`.** Present in all three schemas and written by nothing in the
   template. Classified CORE because both derived apps keep it, but its intended
   writer is unknown.

## Extraction blockers, independent of classification

- `internal/app` is unreachable outside the module (`internal/`).
- Single Go module; no `packages/` Go directory exists.
- `pnpm-workspace.yaml` already declares `packages/*`, so a JS shared package
  has a home with no tooling change, but no Go equivalent does.
- `AGENTS.md` requires schema changes to land as PocketBase migrations. An
  upstream schema package that runs `EnsureCollections` in derived apps must
  keep the migration history intact, not re-create collections.
