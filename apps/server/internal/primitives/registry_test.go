package primitives

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func recordingHook(name string, mutex *sync.Mutex, calls *[]string) Hook {
	return Hook{
		Name: name,
		Bind: func(app core.App) error {
			mutex.Lock()
			defer mutex.Unlock()
			*calls = append(*calls, name)
			return nil
		},
	}
}

func jobFor(name string) Job {
	return Job{Name: name, Handler: func(app core.App) error { return nil }}
}

func TestRegistrySortsPluginsEndpointsHooksJobs(t *testing.T) {
	var hookMutex sync.Mutex
	var hookCalls []string
	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name:        "zeta",
		Endpoints:   []Endpoint{emptyEndpoint("zeta", "GET", "/api/zeta")},
		Hooks:       []Hook{recordingHook("zetaHook", &hookMutex, &hookCalls)},
		Jobs:        []Job{jobFor("sweep"), jobFor("sync")},
		Collections: []CollectionDefinition{{Name: "zeta_notes", Fields: []Field{{Name: "title", Type: FieldText}}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(BackendPlugin{
		Name:        "alpha",
		Endpoints:   []Endpoint{emptyEndpoint("alpha", "GET", "/api/alpha")},
		Hooks:       []Hook{recordingHook("alphaHook", &hookMutex, &hookCalls)},
		Jobs:        []Job{{Name: "tick", Every: tenMillis, Handler: func(app core.App) error { return nil }}, jobFor("once")},
		Collections: []CollectionDefinition{{Name: "alpha_notes", Fields: []Field{{Name: "title", Type: FieldText}}}},
	}); err != nil {
		t.Fatal(err)
	}

	plugins := registry.Plugins()
	if plugins[0].Name != "alpha" || plugins[1].Name != "zeta" {
		t.Fatalf("plugins are not name-ordered: %v", pluginNames(plugins))
	}

	collections := registry.Collections()
	if collections[0].Name != "alpha_notes" || collections[1].Name != "zeta_notes" {
		t.Fatalf("collections are not name-ordered: %v", collectionNames(collections))
	}

	endpoints := registry.Endpoints()
	if endpoints[0].Path != "/api/alpha" || endpoints[1].Path != "/api/zeta" {
		t.Fatalf("endpoints are not path-ordered: %v", endpointKeys(endpoints))
	}

	hooks := registry.Hooks()
	if hooks[0].Plugin != "alpha" || hooks[0].Hook.Name != "alphaHook" || hooks[1].Plugin != "zeta" {
		t.Fatalf("hooks are not plugin/name-ordered: %+v", hookKeys(hooks))
	}

	jobs := registry.Jobs()
	wantJobs := []string{"alpha/once", "zeta/sweep", "zeta/sync", "alpha/tick"}
	if got := jobNames(jobs); strings.Join(got, ",") != strings.Join(wantJobs, ",") {
		t.Fatalf("jobs are not one-shot-first, name-ordered: got %v, want %v", got, wantJobs)
	}
}

// tenMillis is an interval barely above zero that keeps the test fast.
const tenMillis = 10 * time.Millisecond

func pluginNames(plugins []BackendPlugin) []string {
	names := make([]string, 0, len(plugins))
	for _, plugin := range plugins {
		names = append(names, plugin.Name)
	}
	return names
}

func collectionNames(definitions []CollectionDefinition) []string {
	names := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		names = append(names, definition.Name)
	}
	return names
}

func endpointKeys(endpoints []Endpoint) []string {
	keys := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		keys = append(keys, endpoint.endpointKey())
	}
	return keys
}

func hookKeys(hooks []PluginHook) []string {
	keys := make([]string, 0, len(hooks))
	for _, item := range hooks {
		keys = append(keys, item.Plugin+"/"+item.Hook.Name)
	}
	return keys
}

func jobNames(jobs []PluginJob) []string {
	names := make([]string, 0, len(jobs))
	for _, item := range jobs {
		names = append(names, item.Plugin+"/"+item.Job.Name)
	}
	return names
}

func TestRegistryRejectsInvalidAndDuplicateContracts(t *testing.T) {
	t.Run("bad plugin name", func(t *testing.T) {
		err := NewRegistry().Register(BackendPlugin{Name: "not ok"})
		if err == nil || !strings.Contains(err.Error(), "name must match") {
			t.Fatalf("want name error, got %v", err)
		}
	})
	t.Run("duplicate plugin name", func(t *testing.T) {
		registry := NewRegistry()
		if err := registry.Register(BackendPlugin{Name: "alpha"}); err != nil {
			t.Fatal(err)
		}
		err := registry.Register(BackendPlugin{Name: "alpha"})
		if err == nil || !strings.Contains(err.Error(), "duplicate plugin alpha") {
			t.Fatalf("want duplicate plugin error, got %v", err)
		}
	})
	t.Run("duplicate collection across plugins", func(t *testing.T) {
		registry := NewRegistry()
		if err := registry.Register(BackendPlugin{
			Name:        "alpha",
			Collections: []CollectionDefinition{{Name: "notes", Fields: []Field{{Name: "title", Type: FieldText}}}},
		}); err != nil {
			t.Fatal(err)
		}
		err := registry.Register(BackendPlugin{
			Name:        "zeta",
			Collections: []CollectionDefinition{{Name: "notes", Fields: []Field{{Name: "title", Type: FieldText}}}},
		})
		if err == nil || !strings.Contains(err.Error(), "already declared by plugin alpha") {
			t.Fatalf("want collection conflict error, got %v", err)
		}
	})
	t.Run("duplicate endpoint across plugins", func(t *testing.T) {
		registry := NewRegistry()
		if err := registry.Register(BackendPlugin{
			Name:      "alpha",
			Endpoints: []Endpoint{emptyEndpoint("getNotes", "GET", "/api/notes")},
		}); err != nil {
			t.Fatal(err)
		}
		err := registry.Register(BackendPlugin{
			Name:      "zeta",
			Endpoints: []Endpoint{emptyEndpoint("getNotesAgain", "GET", "/api/notes")},
		})
		if err == nil || !strings.Contains(err.Error(), "already declared") {
			t.Fatalf("want endpoint conflict error, got %v", err)
		}
	})
	t.Run("invalid hook is reported with plugin context", func(t *testing.T) {
		err := NewRegistry().Register(BackendPlugin{
			Name:  "alpha",
			Hooks: []Hook{{Name: "broken"}},
		})
		if err == nil || !strings.Contains(err.Error(), "plugin alpha") {
			t.Fatalf("want plugin-scoped error, got %v", err)
		}
	})
	t.Run("negative job interval", func(t *testing.T) {
		err := NewRegistry().Register(BackendPlugin{
			Name: "alpha",
			Jobs: []Job{{Name: "broken", Every: -1, Handler: jobFor("x").Handler}},
		})
		if err == nil || !strings.Contains(err.Error(), "every must be >= 0") {
			t.Fatalf("want interval error, got %v", err)
		}
	})
}
