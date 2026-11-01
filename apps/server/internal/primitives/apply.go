package primitives

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase/core"
)

// EnsureCollections creates the registry's missing collections. An existing
// collection is left untouched: the definitions are a descriptive seed, not a
// schema migration, so no database schema is mutated on repeated startups.
// Schema evolution belongs in apps/server/pb_migrations.
func (r *Registry) EnsureCollections(app core.App) error {
	for _, definition := range r.Collections() {
		_, err := app.FindCollectionByNameOrId(definition.Name)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("collection %s: %w", definition.Name, err)
		}
		collection := definition.newCollection()
		if err := definition.applyFields(collection); err != nil {
			return fmt.Errorf("collection %s: %w", definition.Name, err)
		}
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("collection %s: %w", definition.Name, err)
		}
	}
	return nil
}

// RegisterEndpoints declares every registry endpoint on the Huma API, sorted
// by method and path. The OpenAPI contract, served docs, and generated
// TypeScript client all follow from this registration.
func (r *Registry) RegisterEndpoints(api huma.API) error {
	for _, endpoint := range r.Endpoints() {
		if err := endpoint.Register(api); err != nil {
			return fmt.Errorf("endpoint %s: %w", endpoint.Name, err)
		}
	}
	return nil
}

// BindHooks registers every hook handler on the app's event hooks, sorted by
// plugin and hook name.
func (r *Registry) BindHooks(app core.App) error {
	for _, item := range r.Hooks() {
		if err := item.Hook.Bind(app); err != nil {
			return fmt.Errorf("hook %s/%s: %w", item.Plugin, item.Hook.Name, err)
		}
	}
	return nil
}

// RunJobs runs one-shot jobs in deterministic order and starts one goroutine
// per interval job, also in deterministic order. Interval handler errors are
// logged, not fatal. The returned stop function halts every interval tick;
// calls without interval jobs return nil.
func (r *Registry) RunJobs(app core.App) (stop func(), err error) {
	for _, item := range r.Jobs() {
		if item.Job.Every == 0 {
			if err := item.Job.Handler(app); err != nil {
				return nil, fmt.Errorf("job %s/%s: %w", item.Plugin, item.Job.Name, err)
			}
		}
	}
	var intervals []runningJob
	for _, item := range r.Jobs() {
		if item.Job.Every > 0 {
			intervals = append(intervals, runningJob{job: item, cancel: make(chan struct{})})
		}
	}
	if len(intervals) == 0 {
		return nil, nil
	}
	var once sync.Once
	stops := make([]func(), 0, len(intervals))
	for _, runner := range intervals {
		runner := runner
		go func() {
			ticker := time.NewTicker(runner.job.Job.Every)
			defer ticker.Stop()
			for {
				select {
				case <-runner.cancel:
					return
				case <-ticker.C:
					// A queued tick can still be ready after cancellation;
					// prefer stopping over running one extra pass.
					select {
					case <-runner.cancel:
						return
					default:
					}
					if err := runner.job.Job.Handler(app); err != nil {
						app.Logger().Error("primitives job failed",
							slog.String("plugin", runner.job.Plugin),
							slog.String("job", runner.job.Job.Name),
							slog.String("error", err.Error()))
					}
				}
			}
		}()
		stops = append(stops, func() { close(runner.cancel) })
	}
	return func() {
		once.Do(func() {
			for _, halt := range stops {
				halt()
			}
		})
	}, nil
}

// runningJob is one live interval job.
type runningJob struct {
	job    PluginJob
	cancel chan struct{}
}
