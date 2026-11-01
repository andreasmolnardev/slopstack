package primitives

import (
	"errors"
	"fmt"
	"sort"
)

// Registry collects BackendPlugin contracts and applies them in one
// deterministic order:
//
//  1. plugins are validated at registration and kept sorted by name;
//  2. collection definitions create only missing collections, sorted by
//     collection name across all plugins, so an existing database schema is
//     never mutated on startup;
//  3. hooks are bound sorted by name;
//  4. endpoints are declared on the Huma API sorted by method and path;
//  5. one-shot jobs run sorted by name; interval jobs start after them.
type Registry struct {
	plugins []BackendPlugin
	seen    map[string]bool
}

// NewRegistry returns an empty plugin registry.
func NewRegistry() *Registry {
	return &Registry{seen: map[string]bool{}}
}

// Register validates a plugin and adds it to the registry. It fails on
// invalid contracts, duplicate plugin names, cross-plugin collection
// duplicates, and cross-plugin endpoint conflicts.
func (r *Registry) Register(plugin BackendPlugin) error {
	if err := plugin.validate(); err != nil {
		return err
	}
	if r.seen == nil {
		r.seen = map[string]bool{}
	}
	if r.seen[plugin.Name] {
		return fmt.Errorf("duplicate plugin %s", plugin.Name)
	}
	var problems []error
	for _, definition := range plugin.Collections {
		if other, found := r.collectionOwner(definition.Name); found {
			problems = append(problems, fmt.Errorf("plugin %s: collection %s is already declared by plugin %s", plugin.Name, definition.Name, other))
		}
	}
	registered := map[string]bool{}
	for _, endpoint := range r.Endpoints() {
		registered[endpoint.endpointKey()] = true
	}
	for _, endpoint := range plugin.Endpoints {
		key := endpoint.endpointKey()
		if registered[key] {
			problems = append(problems, fmt.Errorf("plugin %s: endpoint %s is already declared", plugin.Name, key))
		}
		registered[key] = true
	}
	if err := errors.Join(problems...); err != nil {
		return err
	}
	r.seen[plugin.Name] = true
	r.plugins = append(r.plugins, plugin)
	sort.Slice(r.plugins, func(i, j int) bool { return r.plugins[i].Name < r.plugins[j].Name })
	return nil
}

// MustRegister is Register for static plugin tables; it panics on the
// contract mistakes that are development errors.
func (r *Registry) MustRegister(plugin BackendPlugin) {
	if err := r.Register(plugin); err != nil {
		panic(err)
	}
}

func (r *Registry) collectionOwner(name string) (string, bool) {
	for _, plugin := range r.plugins {
		for _, definition := range plugin.Collections {
			if definition.Name == name {
				return plugin.Name, true
			}
		}
	}
	return "", false
}

// Plugins returns the plugins in registration order, which is name order.
func (r *Registry) Plugins() []BackendPlugin {
	return append([]BackendPlugin(nil), r.plugins...)
}

// Collections returns every declared collection definition, sorted by name.
func (r *Registry) Collections() []CollectionDefinition {
	var definitions []CollectionDefinition
	for _, plugin := range r.plugins {
		definitions = append(definitions, plugin.Collections...)
	}
	return sortDefinitions(definitions)
}

// Endpoints returns every declared endpoint, sorted by method and path.
func (r *Registry) Endpoints() []Endpoint {
	var endpoints []Endpoint
	for _, plugin := range r.plugins {
		endpoints = append(endpoints, plugin.Endpoints...)
	}
	sort.Slice(endpoints, func(i, j int) bool {
		a, b := endpoints[i], endpoints[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		return a.Method < b.Method
	})
	return endpoints
}

// Hooks returns every hook with its owning plugin, sorted by plugin and hook
// name.
func (r *Registry) Hooks() []PluginHook {
	var hooks []PluginHook
	for _, plugin := range r.plugins {
		for _, hook := range plugin.Hooks {
			hooks = append(hooks, PluginHook{Plugin: plugin.Name, Hook: hook})
		}
	}
	sort.Slice(hooks, func(i, j int) bool {
		if hooks[i].Plugin != hooks[j].Plugin {
			return hooks[i].Plugin < hooks[j].Plugin
		}
		return hooks[i].Hook.Name < hooks[j].Hook.Name
	})
	return hooks
}

// Jobs returns every job with its owning plugin, sorted by plugin and job
// name. One-shot jobs come first, then interval jobs, matching the run order.
func (r *Registry) Jobs() []PluginJob {
	var jobs []PluginJob
	for _, plugin := range r.plugins {
		for _, job := range plugin.Jobs {
			jobs = append(jobs, PluginJob{Plugin: plugin.Name, Job: job})
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		a, b := jobs[i], jobs[j]
		if (a.Job.Every == 0) != (b.Job.Every == 0) {
			return a.Job.Every == 0
		}
		if a.Plugin != b.Plugin {
			return a.Plugin < b.Plugin
		}
		return a.Job.Name < b.Job.Name
	})
	return jobs
}

// PluginHook pairs a hook with the plugin that declared it.
type PluginHook struct {
	Plugin string
	Hook   Hook
}

// PluginJob pairs a job with the plugin that declared it.
type PluginJob struct {
	Plugin string
	Job    Job
}
