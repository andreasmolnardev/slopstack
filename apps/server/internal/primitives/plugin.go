// Package primitives holds the typed contracts a Slopstack backend extension
// uses to extend the embedded PocketBase server: collection definitions, Huma
// v2 endpoints, lifecycle hooks, background jobs, and the plugin that groups
// them.
//
// The contracts are descriptive. Registration validates everything up front
// and applies it in a deterministic order, so the same set of plugins always
// produces the same schema seed, OpenAPI contract, and boot sequence.
package primitives

import (
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Hook binds handlers to PocketBase event hooks during bootstrap.
type Hook struct {
	// Name identifies the hook; it must be unique inside its plugin.
	Name string
	// Description explains when the hook runs.
	Description string
	// Bind registers the handlers on the event hooks of app. It runs once
	// per process, in registry order, during bootstrap.
	Bind func(app core.App) error
}

// Job is a background task the plugin wants to run.
type Job struct {
	// Name identifies the job; it must be unique inside its plugin.
	Name string
	// Description explains what the job does.
	Description string
	// Every is the repeat interval. Zero means the job runs once, in
	// deterministic order, right after the hooks are bound.
	Every time.Duration
	// Handler runs the job.
	Handler func(app core.App) error
}

// BackendPlugin groups the contracts one backend extension contributes.
// A plugin is descriptive: it names its schema seed, API surface, hooks, and
// jobs, and the Registry turns all registered plugins into validated,
// deterministically ordered registration calls.
type BackendPlugin struct {
	// Name identifies the plugin; it must be unique across the registry.
	// Registration runs plugins in name order.
	Name string
	// Description explains what the extension contributes.
	Description string
	// Collections lists the schema seed in declaration order. The registry
	// creates missing collections in name order across all plugins.
	Collections []CollectionDefinition
	// Endpoints lists the Huma v2 operations in declaration order. The
	// registry registers them sorted by method and path.
	Endpoints []Endpoint
	// Hooks lists the event bindings in declaration order. The registry
	// binds them sorted by name.
	Hooks []Hook
	// Jobs lists the background tasks in declaration order. The registry
	// runs one-shot jobs sorted by name after the hooks are bound.
	Jobs []Job
}

func (p BackendPlugin) validate() error {
	if !namePattern.MatchString(p.Name) {
		return fmt.Errorf("plugin %q: name must match %s", p.Name, namePattern)
	}
	seen := map[string]bool{}
	for _, hook := range p.Hooks {
		if hook.Name == "" || hook.Bind == nil {
			return fmt.Errorf("plugin %s: hook %q needs a name and a bind function", p.Name, hook.Name)
		}
		if seen[hook.Name] {
			return fmt.Errorf("plugin %s: duplicate hook %s", p.Name, hook.Name)
		}
		seen[hook.Name] = true
	}
	clear(seen)
	for _, job := range p.Jobs {
		if job.Name == "" || job.Handler == nil {
			return fmt.Errorf("plugin %s: job %q needs a name and a handler", p.Name, job.Name)
		}
		if job.Every < 0 {
			return fmt.Errorf("plugin %s: job %s: every must be >= 0", p.Name, job.Name)
		}
		if seen[job.Name] {
			return fmt.Errorf("plugin %s: duplicate job %s", p.Name, job.Name)
		}
		seen[job.Name] = true
	}
	clear(seen)
	for _, endpoint := range p.Endpoints {
		if err := endpoint.validate(); err != nil {
			return fmt.Errorf("plugin %s: %w", p.Name, err)
		}
		key := endpoint.endpointKey()
		if seen[key] {
			return fmt.Errorf("plugin %s: duplicate endpoint %s", p.Name, key)
		}
		seen[key] = true
	}
	clear(seen)
	for _, definition := range p.Collections {
		if err := definition.validate(); err != nil {
			return fmt.Errorf("plugin %s: %w", p.Name, err)
		}
		key := definition.Name
		if seen[key] {
			return fmt.Errorf("plugin %s: duplicate collection %s", p.Name, key)
		}
		seen[key] = true
	}
	return nil
}
