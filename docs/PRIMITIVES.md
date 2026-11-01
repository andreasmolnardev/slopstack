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
```

Generated files go under `apps/web/src` by default: resources under `resources/`, views under `views/`, and layouts under `layouts/`. Choose another root with `--out <directory>`. Existing files are preserved unless `--force` is passed. The resource generator accepts `text`, `number`, `boolean`, `select`, `relation`, `date`, `datetime`, `time`, `slider`, and `file` field kinds. For example, use `--field description:text:multiline`, `--field status:select:open,closed`, `--field owner:relation:users:one`, or `--field score:slider:0,10,1`.

Scaffolding creates a starting definition; it does not edit a route table, register a collection migration, or generate domain-specific API handlers. Connect the new definition to the app registry and implement its backend source and permissions before exposing it to users. Backend primitive contracts are documented in [Backend extensions](backend-extensions.md).

The current CLI generates frontend resource, view, and layout definitions. It does not yet generate backend collection definitions, Huma endpoints, hooks, jobs, or plugin registration. Those contracts are implemented in the runtime and documented separately; wiring them into app bootstrap remains app-owned.

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

Search providers, actions, shortcuts, and `SearchFallbackDefinition` can all register in the app manifest or a frontend plugin. A fallback action receives the current query and appears when its minimum length and visibility rules match but the palette has no result.

Views use router-independent `resolveView` path matching with named parameters and wildcards. `resolveAccessibleView` applies client-side visibility rules and returns the configured unauthorized destination, while `getAccessibleNavigation` filters shell navigation with the same access context. These helpers keep the manifest portable; wire them into the router your app uses. Client checks only shape navigation and rendering. PocketBase rules or server handlers remain responsible for authorization.
