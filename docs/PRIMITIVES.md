# Primitive registry and scaffolding

`packages/cli/registry.json` is the machine-readable catalog of Slopstack primitives. It lists each primitive's role, category, runtime contract, and generator when one exists. The registry describes the supported composition vocabulary; it does not register application resources or routes at runtime.

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

Generated files go under `apps/web/src` by default: resources under `resources/`, views under `views/`, and layouts under `layouts/`. Choose another root with `--out <directory>`. Existing files are preserved unless `--force` is passed. Resource field kinds are `text`, `number`, `boolean`, `date`, `datetime`, `time`, `slider`, and `file`. Slider fields accept a range, for example `--field score:slider:0,10,1`.

Scaffolding creates a starting definition; it does not edit a route table, register a collection migration, or generate domain-specific API handlers. Connect the new definition to the app registry and implement its backend source and permissions before exposing it to users. Backend primitive contracts are documented in [Backend extensions](backend-extensions.md).

## Backend and authentication choices

Application manifests can declare `backend` and `authentication` without forcing the app to use PocketBase. Resource definitions can target PocketBase collections, custom endpoints, or custom adapters. `createEndpointResourceAdapter` implements endpoint resources and accepts a caller-provided `fetch` function and headers, so bearer-token APIs, cookie sessions, and test adapters can share the same resource and form primitives.

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
