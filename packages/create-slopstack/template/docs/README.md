# Slopstack Reference Docs

Slopstack is a full-stack starter, not a task product. The task workspace in `apps/web/src/app.tsx` is an example module that shows how to compose a product UI on top of Slopstack infrastructure.

## Guides

- [Colors](./COLORS.md)
- [Navigation](./NAVIGATION.md)
- [Components](./COMPONENTS.md)
- [API](./API.md)
- [Data model](./DATA-MODEL.md)
- [Audit events](./AUDIT.md)
- [Authentication](./AUTH.md)
- [Development](./DEVELOPMENT.md)
- [Deployment](./DEPLOYMENT.md)
- [Architecture](./ARCHITECTURE.md) — repo layout, runtime topology, and known inconsistencies
- [Extraction inventory](./EXTRACTION-INVENTORY.md) — classification of `apps/server/internal/app` for the upstream split
- [Compatibility](./COMPATIBILITY.md) — Phase 0 baseline and the compatibility rules future changes must respect
- [Shared runtime](./SHARED-RUNTIME.md) — ownership, package contracts, and current consumer integration status
- [Baseline](./baseline.json) — machine-readable test, lint, build, and schema baseline

## Example module

The example demonstrates local task state, create and complete actions, filtering, schedule and analytics views, profile settings, responsive navigation, and shadcn component composition. Replace this module with your domain screens while keeping server, schema, auth, and generated-client patterns.
