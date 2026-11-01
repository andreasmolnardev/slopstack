# Backend extensions

Backend extensions are Go plugins that extend the embedded PocketBase server with collections, Huma v2 API endpoints, event hooks, and background jobs. The contracts live in `apps/server/internal/primitives`.

PocketBase is the default data backend and Huma v2 is the API layer: endpoint registrations are what produce the served OpenAPI 3.1 contract and, from it, the generated TypeScript client.

## The contracts

| Contract             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `BackendPlugin`      | Groups one extension's collections, endpoints, hooks, and jobs  |
| `CollectionDefinition` | Describes one PocketBase collection with typed fields         |
| `Endpoint`           | Describes one Huma v2 operation with a typed `huma.Register` closure |
| `Hook`               | Binds a handler to PocketBase event hooks during bootstrap      |
| `Job`                | Runs a one-shot task during bootstrap or repeats on an interval |

## Defining a plugin

```go
package workspace

import "github.com/slopstack/slopstack/apps/server/internal/primitives"

var Plugin = primitives.BackendPlugin{
	Name:        "workspace",
	Description: "Team notes and shopping lists for Slopstack.",
	Collections: []primitives.CollectionDefinition{{
		Name:   "projects",
		Fields: []primitives.Field{
			{Name: "title", Type: primitives.FieldText, Required: true, Options: map[string]any{"max": 120}},
			{Name: "audience", Type: primitives.FieldSelect, Options: map[string]any{"values": []string{"team", "public"}}},
			{Name: "owner", Type: primitives.FieldRelation, Options: map[string]any{"collection": "users", "maxSelect": 1}},
			{Name: "settings", Type: primitives.FieldJSON},
		},
	}},
	Endpoints: []primitives.Endpoint{{
		Name: "listProjects", Method: http.MethodGet, Path: "/api/projects",
		Summary:  "List projects",
		Tags:     []string{"Projects"},
		Security: []map[string][]string{{"pocketbaseAuth": {}}},
		Errors:   []int{http.StatusUnauthorized},
		Register: func(api huma.API) error {
			huma.Register(api, huma.Operation{
				OperationID: "listProjects", Method: http.MethodGet, Path: "/api/projects", Summary: "List projects",
			}, func(context.Context, *listInput) (*listOutput, error) {
				return &listOutput{}, nil
			})
			return nil
		},
	}},
	Hooks: []primitives.Hook{{
		Name: "trimProjectTitle",
		Bind: func(app core.App) error {
			app.OnRecordCreateRequest("projects").BindFunc(func(e *core.RecordRequestEvent) error {
				// normalize inputs here
				return e.Next()
			})
			return nil
		},
	}},
	Jobs: []primitives.Job{
		{Name: "archiveOldProjects", Handler: func(app core.App) error { return nil }},
		{Name: "refreshSlugs", Every: time.Hour, Handler: func(app core.App) error { return nil }},
	},
}
```

## Registration order

The `primitives.Registry` validates every contract at registration. It rejects bad names, unknown field types, duplicate fields, duplicate plugins and plugins that redeclare a collection or `METHOD /path` already present. `MustRegister` panics for static plugin tables; use `Register` when plugins are dynamic.

Registration then applies:

1. **Collections** — missing collections are created, sorted by name across all plugins. Existing collections are never touched on startup: definitions are a descriptive seed, not a schema migration. Evolve real schema changes in `apps/server/pb_migrations`.
2. **Hooks** — bound in plugin, name order during bootstrap.
3. **Endpoints** — declared on the Huma API in method and path order.
4. **Jobs** — one-shot jobs run in name order after the hooks are bound; interval jobs start after them and keep running until the returned stop function is called.

Because the order comes from names, the schema seed, boot sequence, and OpenAPI contract are stable from process to process.

## Wiring a registry in

Compose the registry in your server entrypoint, then hook it into the existing bootstrap flow the way the template composes `app.Register`:

```go
registry := primitives.NewRegistry()
for _, plugin := range []primitives.BackendPlugin{workspace.Plugin} {
	if err := registry.Register(plugin); err != nil {
		return err
	}
}

// Contract side: declare the OpenAPI surface right after your own huma
// definitions.
if err := registry.RegisterEndpoints(api); err != nil {
	return err
}

// Boot side, inside pb.OnBootstrap after e.Next() and EnsureCollections:
if err := registry.EnsureCollections(e.App); err != nil {
	return err
}
if err := registry.BindHooks(e.App); err != nil {
	return err
}
stopJobs, err := registry.RunJobs(e.App)
// ... then call stopJobs when the process shuts down.
```

Nothing applies until you call these functions, so an invalid plugin fails fast instead of half-booting.

## Rules

- Collection and field names follow `[A-Za-z][A-Za-z0-9_]*`; endpoint names are Huma `OperationID`s and must be unique across the registry.
- Never mutate an existing collection from a definition; add a PocketBase migration when a shipped schema must change.
- Keep auth enforcement in the registered handler; the `Security` metadata documents it and the generated client passes PocketBase tokens.
- Run `pnpm generate:api` and `pnpm generate:client` after adding endpoints so the exported contract and generated client stay in sync.
