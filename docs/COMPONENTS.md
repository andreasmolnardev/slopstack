# Components

## Source

Reusable UI primitives are published by `@slopstack/ui` at `@slopstack/ui/components/ui/<name>`. They are customizable shadcn components backed by Radix primitives where interaction behavior needs accessibility and keyboard support.
Reusable compositions are published under `@slopstack/ui/patterns/<name>`: `PageHeading`, `DataTable`, `FormDialog`, and `NavigationLinks` provide app-ready page, table, dialog, and navigation patterns.

## Common composition

- `Card`: page panels, metrics, profiles, and grouped settings.
- `Button`: navigation, primary actions, icon actions, and secondary actions.
- `Dialog`: create and edit workflows.
- `Input`, `Textarea`, `Select`, `Label`: forms.
- `Checkbox`: task completion.
- `Tabs`: task filters.
- `Badge`: module labels, priority, and status.
- `Avatar`: people and assignee stacks.
- `Progress`: delivery metrics.
- `Separator`: visual grouping.

## Rules

- Import `@slopstack/ui/styles.css` once in the app entry point.
- Import shared primitives through `@slopstack/ui/components/ui/*`.
- Import shared compositions through `@slopstack/ui/patterns/*`.
- Use `cn` from `@slopstack/ui/utils` for conditional classes, or keep an app-local class helper.
- Keep product-specific composition in feature files, not inside primitives.
- Add new primitives with shadcn CLI when available.
- Wrap the app with `TooltipProvider` before using tooltip primitives.
- Generated components may be adjusted for project lint rules, but preserve their public API.

## Adding a component

```sh
pnpm dlx shadcn@latest add dialog
```

Run this from a consuming app configured for shadcn to create an app-owned component. To add a shared Slopstack component, update `packages/ui/src/components/ui` and export it through the UI package instead. The current registry has some unavailable legacy names. Use `sonner` instead of Base UI-only `toast` in this Radix setup.
