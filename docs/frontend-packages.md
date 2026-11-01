# Frontend packages

Slopstack maintains four versioned JavaScript packages. Each is built as ESM with declaration files and packed with its `dist` output. `@slopstack/core` has no runtime dependency on React, PocketBase, router, styling, or a query library. Its component slots are structural callback types so core contracts stay usable from non-React code.

## Availability

The source packages are in this repository at version `0.1.0`. This commit does not publish to npm. A `packages-v0.1.0` tag runs the package release workflow, builds the packages, and attaches the four `.tgz` files plus `SHA256SUMS` to the GitHub Release. Use the release download URLs below only after those assets exist; a tag alone does not confirm the workflow succeeded. The package workflow uses the repository's GitHub Actions `GITHUB_TOKEN` with `contents: write`; it does not need npm credentials, but the repository must allow Actions to create releases.

After the `packages-vX.Y.Z` GitHub Release exists, apps can install the packages without a monorepo checkout or local path dependency. Replace `X.Y.Z` with the exact release version and select only the packages the app uses:

```sh
VERSION=0.1.0
npm install \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-core-${VERSION}.tgz" \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-react-${VERSION}.tgz"
```

For Docker builds, install the same release URLs in the app's normal `package.json` and commit its generated lockfile. Keep the packages as exact versions (no `workspace:`, `file:`, or relative path specifiers); the lockfile records the resolved tarball and integrity, so clean CI and Docker builds need only the lockfile and normal registry/release network access. For an explicit integrity check before install, download `SHA256SUMS` from the same release and run `sha256sum --check SHA256SUMS` in the directory containing the tarballs. GitHub release URLs are public read access when the repository and release are public; private repositories require a build credential with GitHub release asset read access.

To make the first package release after reviewing the release contents, push `packages-v0.1.0` from a commit whose four package manifests remain at `0.1.0`. The workflow rejects version mismatches and does not publish to npm. Subsequent package sets use a new matching `packages-vX.Y.Z` tag and manifest version. The existing `vX.Y.Z` tags remain reserved for container releases.

| Package | Use it for | Runtime requirements |
| --- | --- | --- |
| `@slopstack/core` | Resource/action/query definitions, validation, endpoint REST adapter, and framework-neutral contracts | None |
| `@slopstack/react` | React session/state stores, routing/layout composition, and hooks | React 18+; TanStack Query is optional and used only by `@slopstack/react/query` |
| `@slopstack/ui` | Optional shadcn-based controls, resource forms/data views, and shell patterns | React 18+, React DOM 18+; utility component dependencies are installed by the package |
| `@slopstack/pocketbase` | PocketBase resource/auth adapters and default client selection | PocketBase only when using its PocketBase adapter entry points; realtime subpath also uses React and TanStack Query |

Install only what the app needs:

```sh
VERSION=0.1.0
# Core alone:
npm install \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-core-${VERSION}.tgz"
# React hooks need core; forms also use UI:
npm install \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-core-${VERSION}.tgz" \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-react-${VERSION}.tgz" \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-ui-${VERSION}.tgz" \
  react react-dom
# Add PocketBase adapters only for PocketBase apps:
npm install \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-core-${VERSION}.tgz" \
  "https://github.com/andreasmolnardev/slopstack/releases/download/packages-v${VERSION}/slopstack-pocketbase-${VERSION}.tgz" \
  pocketbase
```

Use exact package versions together for a release set. Package versions are coordinated by the current release workflow; internal dependencies are packed with concrete semver ranges, and the starter workspace pins its compatible set explicitly.

## External REST adapter example

The generic `ResourceAdapter` contract lets an app map Slopstack resources to any API shape. This example targets an IP2MQTT Go service that returns a JSON device list and accepts JSON writes. Cookie sessions work through `credentials: 'include'`; a token API can instead supply an `Authorization` header. No PocketBase SDK, Slopstack router, or TanStack Query is needed by core.

```ts
import { createResourceClient, defineResource } from '@slopstack/core';
import type { ResourceAdapter } from '@slopstack/core';

type Device = { id: string; name: string; online: boolean };
type DeviceWrite = { name: string };

const devices = defineResource<Device, DeviceWrite, Partial<DeviceWrite>>({
  id: 'devices',
  label: 'Device',
  source: { kind: 'endpoint', list: '/api/devices' },
  fields: [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'online', label: 'Online', kind: 'boolean', readOnly: true },
  ],
});

const api = 'https://ip2mqtt.example.test';
const adapter: ResourceAdapter<Device, DeviceWrite, Partial<DeviceWrite>> = {
  async list(query) {
    const url = new URL('/api/devices', api);
    if (query.search) url.searchParams.set('q', query.search);
    const response = await fetch(url, { credentials: 'include', signal: query.signal });
    if (!response.ok) throw new Error(`Device API failed: ${response.status}`);
    const items = await response.json() as Device[];
    return { items, total: items.length };
  },
  async get(id) {
    const response = await fetch(`${api}/api/devices/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Device API failed: ${response.status}`);
    return await response.json() as Device;
  },
  async create(input) {
    const response = await fetch(`${api}/api/devices`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Device API failed: ${response.status}`);
    return await response.json() as Device;
  },
  async update(id, input) {
    const response = await fetch(`${api}/api/devices/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Device API failed: ${response.status}`);
    return await response.json() as Device;
  },
  async delete(id) {
    const response = await fetch(`${api}/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw new Error(`Device API failed: ${response.status}`);
  },
};

export const deviceClient = createResourceClient(devices, adapter);
```

`createEndpointResourceAdapter` in core is a ready-made fetch adapter for REST APIs that follow the declared endpoint paths and Slopstack query conventions. Implement `ResourceAdapter` directly when an API has a different wire shape. `AuthenticationAdapter` supports cookie-backed session endpoints, and resource clients can be connected to an app's existing TanStack Router and React Query setup without adopting Slopstack routing.

Apps can supply realtime without PocketBase through the `ResourceRealtimeAdapter` contract. A transport can publish server-sent events, WebSocket messages, polling updates, or no events at all; app code decides how those events update its existing query cache.

## Customization

`@slopstack/ui` exports component subpaths such as `@slopstack/ui/components/ui/button` and `@slopstack/ui/patterns/resource-data-view`. Components use Tailwind utility classes and accept `className`; install and configure Tailwind in the consuming app. Import `@slopstack/ui/styles.css` for the shared theme tokens, then override tokens in the app stylesheet or replace individual controls with app components.

Forms live at `@slopstack/react/forms` and consume UI controls from `@slopstack/ui`. The React package root does not import that form entry point, so apps that do not use the UI package can install React hooks alone.

## Versioning and release

Each package has its own `version` field. Keep internal package dependency ranges aligned with the lowest compatible released version. For a compatible change, update the package's patch or minor version. For a breaking public type, export, or runtime contract, increment that package's major version and document the migration.

Release steps:

1. Update the changed package version and any dependent package minimums.
2. Run `pnpm --filter @slopstack/core build`, `pnpm --filter @slopstack/react build`, `pnpm --filter @slopstack/ui build`, and `pnpm --filter @slopstack/pocketbase build` as needed.
3. Run `pnpm verify:packages` to pack all artifacts and compile an isolated Vite consumer.
4. Create and push the matching `packages-vX.Y.Z` tag to build the tarballs and attach them to the GitHub Release. Verify the workflow and release assets before updating consumers.
5. Update app package versions and lockfiles to the release tarball URLs; consumers upgrade package versions independently.

For an upgrade, review package changelogs, update only the packages used by the app, then run its typecheck and production build. UI package changes do not require apps that only install core or React hooks to upgrade.

## Auth, query cache, and realtime integration

A cookie session can use the core trusted-proxy adapter. The server owns login and authorization; the browser reads a verified session and sends cookies on session and logout requests.

```ts
import { createTrustedProxyAuthAdapter } from '@slopstack/core';
import { createAuthenticationStore } from '@slopstack/react';

const auth = createAuthenticationStore(createTrustedProxyAuthAdapter({
  sessionEndpoint: '/api/session',
  signInUrl: '/login',
  signOutEndpoint: '/api/session/logout',
}));
await auth.initialize();
```

Apps already using TanStack Query can use `useResourceQuery(deviceClient, query)` from `@slopstack/react/query` inside their existing `QueryClientProvider`. Slopstack does not create or own that provider. View resolution also accepts caller-supplied navigation functions, so a TanStack Router route component can render the resource directly and keep URL state in its own route search schema.

The realtime contract is transport-neutral. An app can adapt its server-sent events endpoint and decide how its existing query cache reacts:

```ts
import type { ResourceRealtimeAdapter, ResourceRealtimeEvent } from '@slopstack/core';

const realtime: ResourceRealtimeAdapter<Device> = {
  subscribe(resourceId, listener) {
    const events = new EventSource(`/api/${resourceId}/events`, { withCredentials: true });
    events.onmessage = (event) => listener(JSON.parse(event.data) as ResourceRealtimeEvent<Device>);
    return () => events.close();
  },
};
```
