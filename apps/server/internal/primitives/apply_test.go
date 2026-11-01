package primitives

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestBindHooksRunsInRegistryOrder(t *testing.T) {
	var hookMutex sync.Mutex
	var hookCalls []string
	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name:  "zeta",
		Hooks: []Hook{recordingHook("zetaHook", &hookMutex, &hookCalls)},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(BackendPlugin{
		Name:  "alpha",
		Hooks: []Hook{recordingHook("alphaHook", &hookMutex, &hookCalls)},
	}); err != nil {
		t.Fatal(err)
	}

	app := newPrimitivesTestApp(t)
	if err := registry.BindHooks(app); err != nil {
		t.Fatal(err)
	}

	if got := strings.Join(hookCalls, ","); got != "alphaHook,zetaHook" {
		t.Fatalf("hooks bound out of order: %s", got)
	}
}

func TestRunJobsRunsOneShotsInOrderAndReportsFailures(t *testing.T) {
	var mutex sync.Mutex
	var calls []string
	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name: "zeta",
		Jobs: []Job{{Name: "sweep", Handler: func(app core.App) error {
			mutex.Lock()
			defer mutex.Unlock()
			calls = append(calls, "zeta/sweep")
			return nil
		}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(BackendPlugin{
		Name: "alpha",
		Jobs: []Job{{
			Name: "once", Handler: func(app core.App) error {
				mutex.Lock()
				defer mutex.Unlock()
				calls = append(calls, "alpha/once")
				return nil
			},
		}},
	}); err != nil {
		t.Fatal(err)
	}

	app := newPrimitivesTestApp(t)
	stop, err := registry.RunJobs(app)
	if err != nil {
		t.Fatal(err)
	}
	if stop != nil {
		t.Fatal("registry without interval jobs must return nil stop")
	}
	mutex.Lock()
	captured := append([]string(nil), calls...)
	mutex.Unlock()
	if got := strings.Join(captured, ","); got != "alpha/once,zeta/sweep" {
		t.Fatalf("one-shot jobs ran out of order: %s", got)
	}

	// A failing one-shot reports the plugin and job and stops startup work.
	failing := NewRegistry()
	if err := failing.Register(BackendPlugin{
		Name: "alpha",
		Jobs: []Job{
			jobFor("fine"),
			{Name: "boom", Handler: func(app core.App) error { return fmt.Errorf("snap") }},
		},
	}); err != nil {
		t.Fatal(err)
	}
	stop, err = failing.RunJobs(app)
	if stop != nil {
		t.Fatal("failed startup must not start interval jobs")
	}
	if err == nil || !strings.Contains(err.Error(), "job alpha/boom") {
		t.Fatalf("want job error with plugin context, got %v", err)
	}
}

func TestJobDefineWorksWithStructShape(t *testing.T) {
	job := jobFor("shape")
	if job.Name != "shape" {
		t.Fatal("unexpected job")
	}
}

func TestRunJobsStartsAndStopsIntervalJobs(t *testing.T) {
	var ticks int64
	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name: "alpha",
		Jobs: []Job{{
			Name:  "tick",
			Every: 2 * time.Millisecond,
			Handler: func(app core.App) error {
				atomic.AddInt64(&ticks, 1)
				return nil
			},
		}},
	}); err != nil {
		t.Fatal(err)
	}

	app := newPrimitivesTestApp(t)
	stop, err := registry.RunJobs(app)
	if err != nil {
		t.Fatal(err)
	}
	if stop == nil {
		t.Fatal("interval jobs must return a stop function")
	}
	defer stop()

	if err := waitFor(t, 2*time.Second, func() bool { return atomic.LoadInt64(&ticks) >= 2 }); err != nil {
		t.Fatalf("interval job did not tick: %v", err)
	}

	stop()
	before := atomic.LoadInt64(&ticks)
	time.Sleep(10 * time.Millisecond)
	if after := atomic.LoadInt64(&ticks); after != before {
		t.Fatalf("stop did not halt the job: %d -> %d", before, after)
	}
}

func waitFor(t *testing.T, timeout time.Duration, ready func() bool) error {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ready() {
			return nil
		}
		time.Sleep(2 * time.Millisecond)
	}
	return fmt.Errorf("timeout after %s", timeout)
}
