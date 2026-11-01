---
name: slopstack-app-builder
description: Create a Slopstack application or extend an existing one with its resource, view, layout, auth, data, UI, and backend primitives. Use when building or modifying apps in a Slopstack template checkout.
---

# Build and modify Slopstack applications

Use Slopstack's existing primitives and conventions to build the requested application behavior while keeping each app's domain logic, migrations, UI, and deployment choices app-owned.

## Discover the project

- Identify the repository root. Read its `AGENTS.md`, `PATCH.md`, `README.md`, and relevant `docs/` pages before editing. If the repository has `slopstack.yaml`, use it to understand the app's configuration and enabled capabilities.
- Inspect `packages/cli/registry.json` and `docs/PRIMITIVES.md` for available primitives and their status. Prefer `implemented` contracts; treat `partial` and `contract` entries as building blocks that may need app-owned glue. Do not present `planned` entries as implemented.
- Inspect nearby resource, route, API, migration, and UI files. Piggybudget and Taskboard use many of the same patterns imperatively; do not assume they are already using the declarative Slopstack registry.

## Choose the smallest fitting primitive

- Define entities in typed resource modules with explicit fields, relationships, queries, operations, permissions, and a source. Use `createDefaultResourceClient` for PocketBase or endpoint sources, or provide an app-owned `ResourceAdapter` when the app uses another service.
- For a field kind not covered by the built-in field definitions, define a custom field with a renderer ID and register its `FieldRendererDefinition` through the application registry or a plugin. Keep validation in the field definition or backend contract.
- Compose data entry with `ResourceForm`, display with `ResourceDataView`, and search/filter/sort controls with `ResourceQueryControls`. Use `useResourceQueryState` when the URL should preserve query state. Use `useResourceQuery` and `useResourceMutations` when the screen should use TanStack Query.
- Use `ActionDefinition` and `runAction` for reusable operations that need access checks, confirmation, notifications, and error handling. Use registered search providers, shortcuts, and `CommandPalette` for cross-view discovery and commands.
- Use `defineView`, `resolveView`, `resolveAccessibleView`, `getAccessibleNavigation`, `defineLayout`, `renderLayout`, and `ShellDefinition` when a view or layout benefits from registry-driven composition. Keep app-specific routing or React composition when that is clearer; custom React is an intended extension point.
- Declare typed user or app preferences with `defineSettings`, then create a `createSettingsStore` with a provider-appropriate adapter. Use local storage for local appearance choices and server persistence for user preferences that should follow an account.
- Use `defineBackgroundOperation` and `createBackgroundOperationManager` for long-running work with progress, cancellation, status, and dismissal. Keep durable processing on the backend and adapt server progress into the operation manager.
- Build from the checked-in shadcn components in `apps/web/src/components/ui` and composed patterns in `apps/web/src/components/patterns`. Keep new theme, motion, navigation, and preference choices compatible with persisted user settings.
- Pick an auth adapter that fits the app: PocketBase, trusted proxy, bearer token, or an app-owned `AuthenticationAdapter`. The bearer adapter deliberately leaves token storage to the app. Protect data on the server; route visibility and client `canAccess` checks are not authorization.
- Use `createAuthenticationStore` and `useAuthentication` for shared session lifecycle state. Keep provider-specific SSO exchange, token storage, identity verification, and server authorization in the selected adapter and backend.
- For PocketBase backend extensions, group collections, Huma endpoints, hooks, and jobs into `BackendPlugin` definitions under `apps/server/internal/primitives`. Register them through `app.Register`. Keep shipped schema changes in `apps/server/pb_migrations`; plugin collection declarations only seed missing collections.

## Keep contracts and app data safe

- Keep domain behavior and migrations in the generated app. Do not move app-specific business rules into generic Slopstack runtime code without a clear reusable need.
- If an endpoint changes, export OpenAPI and regenerate the TypeScript client using the repository's documented commands. Confirm server permission checks match the frontend's access hints.
- Do not overwrite custom application files during template upgrades. Start with `pnpm slopstack upgrade --from <template> --preview`; review conflicts, then apply the upgrade only when the preview is clean. The upgrader snapshots changed files and rolls back if validation fails.
- Primitive generation preserves existing files unless `--force` is supplied. Prefer generating into the target app's source tree, then review and connect the output to that app's routes, backend, and manifest.

## Scaffold and validate

- Create a separate app with `pnpm slopstack create` for an interactive destination prompt or `pnpm slopstack create <directory>` for non-interactive setup.
- Inspect or generate primitive starters with `pnpm slopstack:primitive list` and `pnpm slopstack:primitive generate <kind> <name>` where kind is `resource`, `view`, `layout`, or `backend-plugin`. Review generated files before wiring them into runtime code; backend plugin scaffolds still require explicit app bootstrap registration.
- Run the checks relevant to the changes and the project instructions. For frontend work, use lint, TypeScript build, tests, and production build as appropriate. For backend work, run focused Go tests and regenerate API artifacts when needed. Avoid unrelated formatting or generated changes.
- Summarize which primitives the app uses, which pieces remain app-owned, the validation performed, and any partial or planned capabilities that affect the requested behavior.
