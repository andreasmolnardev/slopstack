# Deployment

## Project config

`slopstack.yaml` is the checked-in source for project identity, runtime defaults,
tool versions, container image, target platforms, registry host, and release
version. It must contain identifiers and settings only. Never put registry
passwords, tokens, private keys, or other secrets in this file; Docker Buildx
uses the local Docker credential store.

The supported schema is version 1:

```yaml
schemaVersion: 1
app:
  name: sample-app
  goModule: github.com/your-org/sample-app
  envPrefix: SAMPLE_APP
runtime:
  port: 8090
  storagePath: pb_data
development:
  webPort: 5173
  apiProxyTarget: http://127.0.0.1:8090
tools:
  go: 1.27.1
  node: 22.23.2
  pnpm: 11.8.0
  air: 1.67.4
  dockerBuildx: 0.30.0
image:
  repository: ghcr.io/your-org/sample-app
  tag: latest
  platforms: linux/amd64,linux/arm64
registry:
  host: ghcr.io
release:
  version: 0.1.0
```

The config reader rejects unknown YAML syntax, duplicate keys, invalid versions,
and keys that look like stored credentials. `image.platforms` must list both
`linux/amd64` and `linux/arm64` in that order.

## Docker

```sh
docker compose up --build
```

PocketBase data persists in the `slopstack-data` volume.

Preview the configured multi-platform build and push command with:

```sh
pnpm deploy
```

`pnpm deploy` is a dry run. To run the Buildx command and push the configured
image, explicitly use `pnpm deploy --push` after setting up Docker credentials.
The command uses `docker buildx build --platform linux/amd64,linux/arm64` and
the repository and tag in `slopstack.yaml`.

Prepare a version change with:

```sh
pnpm release --version 1.2.3
```

This is also a dry run. `pnpm release --version 1.2.3 --apply` updates only
`release.version` and `image.tag` in `slopstack.yaml`. It does not create Git
tags, publish packages, or push images. Review and commit the config change,
then deploy separately.

## Required production settings

- Set `SLOPSTACK_PUBLIC_URL` to the public origin.
- Set `SLOPSTACK_SECURE_COOKIES=true` behind HTTPS.
- Set a durable `SLOPSTACK_STORAGE_PATH`.
- Keep PocketBase data outside ephemeral container storage.

## Frontend

The frontend is a static Vite build. Keep `/api` proxied to the Go runtime or set `VITE_API_URL` to the deployed API origin.
