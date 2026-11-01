# Primitive registry and scaffolding

`packages/cli/registry.json` is the machine-readable catalog of Slopstack primitives. It lists each primitive's role, implementation status, runtime contract, and generator when one exists. `implemented` means a reusable runtime is available, `partial` means a slice exists but more integration is needed, `contract` means only the typed definition exists, and `planned` means it is not implemented yet. The catalog does not register application resources or routes at runtime.

Use the CLI to inspect the catalog and scaffold the common definitions:

```sh
pnpm slopstack:primitive list
pnpm slopstack:primitive list --json

pnpm slopstack:primitive generate resource projects \
  --field name:text \
  --field budget:number \
  --field archived:boolean
pnpm slopstack:primitive generate view projects
pnpm slopstack:primitive generate layout project-detail
pnpm slopstack:primitive generate backend-plugin billing
```

Frontend files go under `apps/web/src` by default: resources under `resources/`, views under `views/`, and layouts under `layouts/`. Backend plugin scaffolds go under `apps/server/internal/plugins/`. Choose another root with `--out <directory>`. Existing files are preserved unless `--force` is passed. The resource generator accepts `text`, `number`, `boolean`, `select`, `relation`, `date`, `datetime`, `time`, `slider`, and `file` field kinds. For example, use `--field description:text:multiline`, `--field status:select:open,closed`, `--field owner:relation:users:one`, or `--field score:slider:0,10,1`.

Scaffolding creates a starting definition; it does not edit a route table, register a collection migration, or generate domain-specific API handlers. Connect the new definition to the app registry and implement its backend source and permissions before exposing it to users. Backend primitive contracts are documented in [Backend extensions](backend-extensions.md).

Relation fields accept preloaded options through `relationOptions`, or an abortable `loadRelationOptions(resourceId, query, signal)` callback for large or access-controlled collections. The callback lets the app use the same PocketBase or endpoint adapter chosen for that relation.

File fields validate accepted MIME types/extensions, maximum file counts, and per-file size before submit. The form shows selected names and local image previews; endpoint resources encode `Blob` values as multipart form data. Upload progress remains adapter-specific.

Applications can declare typed `SettingsDefinition` entries in the manifest. `createSettingsStore` loads persisted values over declared defaults, publishes updates, and supports reset; connect it to a `SettingsAdapter` for a PocketBase/Huma preference endpoint or use `createLocalStorageSettingsAdapter` for local appearance preferences. This keeps persistence provider-specific while the settings schema and UI remain reusable.

`createSharedStateStore` exposes a stable snapshot, subscriptions, queued updates, and optional persistence for cross-view application state. Use it for selection, workspace context, or other state that should outlive a single component; use settings for user-configurable preferences.

Background operations declare an async runner and receive an `AbortSignal` plus a progress callback. `createBackgroundOperationManager` tracks running, succeeded, failed, and cancelled work, exposes snapshots to persistent shell UI, and lets the app cancel or dismiss completed entries. For server-side jobs, have the operation adapter relay server progress and cancellation to these same callbacks.

`InfiniteFeed` supports an optional fixed-height virtualization window with overscan for large uniform rows. Leave virtualization unset for variable-height cards and articles.

`DataChart` composes the checked-in shadcn chart container with Recharts line, bar, and area views. Supply a category key and series labels/colors; query and aggregation logic stay app-owned.

`ApplicationShell` composes responsive navigation with a route content area. Choose sidebar, icon rail, top bar, or mobile bottom navigation; each style includes mobile navigation and an optional account region.

The CLI generates frontend resource, view, and layout definitions plus a Go backend-plugin scaffold. The plugin scaffold leaves collections, endpoints, hooks, and jobs as explicit TODO slots, and the app still wires the plugin into bootstrap.

## Backend and authentication choices

Application manifests can declare `backend` and `authentication` without forcing the app to use PocketBase. Resource definitions can target PocketBase collections, custom endpoints, or custom adapters. `createEndpointResourceAdapter` implements endpoint resources and accepts a caller-provided `fetch` function and headers, so bearer-token APIs, cookie sessions, and test adapters can share the same resource and form primitives.

For a direct PocketBase collection resource, `createPocketBaseResourceAdapter(pb, resource)` maps list, get, create, update, and delete to the PocketBase SDK and turns declared search/filter/sort options into parameterized PocketBase queries.

`usePocketBaseResourceRealtime` invalidates cached resource queries for a PocketBase collection, and `subscribePocketBaseResource` is available when a screen keeps local state instead of using TanStack Query. Endpoint-backed resources can provide their own realtime adapter.

```ts
defineApplication({
  id: 'my-app',
  name: 'My App',
  backend: { provider: 'rest', apiBaseUrl: '/api', capabilities: { database: false } },
  authentication: {
    provider: 'trusted-proxy',
    sessionEndpoint: '/api/session',
    enforcement: 'server',
    routes: { signIn: '/login' },
  },
  resources: [myResource],
});
```

`authentication.enforcement` documents which server boundary enforces access. A route's `access` declaration only controls client navigation and rendering; authorization still belongs in PocketBase rules or authenticated server handlers. Trusted-proxy mode expects the server to verify the proxy identity and must not trust client-supplied identity headers.

`createAuthenticationStore(adapter)` supplies a shared session lifecycle for any `AuthenticationAdapter`: initialize, subscribe to session changes, sign in with the adapter's credential type, sign out, and expose state through `useAuthentication`. This leaves the sign-in UI and SSO/token exchange with the application while keeping session-aware UI consistent.

Search providers, actions, shortcuts, and `SearchFallbackDefinition` can all register in the app manifest or a frontend plugin. A fallback action receives the current query and appears when its minimum length and visibility rules match but the palette has no result.

`defineSearchAction` creates an action that sends its input to a target view as a URL query parameter while preserving any existing target parameters and hash.

Views use router-independent `resolveView` path matching with named parameters and wildcards. `resolveAccessibleView` applies client-side visibility rules and returns the configured unauthorized destination, while `getAccessibleNavigation` filters shell navigation with the same access context. `resolveApplicationRoute` composes matching, access, the view layout, and shell into a rendered route result that can be returned by React Router, TanStack Router, or an app-owned router. Client checks only shape navigation and rendering. PocketBase rules or server handlers remain responsible for authorization.
