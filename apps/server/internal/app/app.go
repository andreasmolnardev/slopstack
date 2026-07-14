package app

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func Register(pb *pocketbase.PocketBase, config Config, api huma.API) {
	pb.RootCmd.PersistentFlags().StringVar(&config.HTTPAddress, "http", config.HTTPAddress, "HTTP address")
	pb.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return EnsureCollections(e.App)
	})

	pb.OnServe().BindFunc(func(e *core.ServeEvent) error {
		registerRoutes(e, config, api)
		return e.Next()
	})
}

func registerRoutes(e *core.ServeEvent, config Config, api huma.API) {
	var limiter = newIPRateLimiter()
	withRequest := func(next func(*core.RequestEvent) error) func(*core.RequestEvent) error {
		return func(event *core.RequestEvent) error {
			if !limiter.Allow(event.RealIP()) {
				return event.TooManyRequestsError("rate limit exceeded", nil)
			}
			event.Response.Header().Set("X-Request-ID", requestID())
			started := time.Now()
			err := next(event)
			slog.Info("request", "method", event.Request.Method, "path", event.Request.URL.Path, "status", event.Status(), "duration", time.Since(started))
			return err
		}
	}
	e.Router.GET("/api/health", withRequest(func(event *core.RequestEvent) error {
		return event.JSON(http.StatusOK, map[string]string{"status": "ok"})
	}))
	e.Router.GET("/openapi.json", func(event *core.RequestEvent) error { return event.JSON(http.StatusOK, api.OpenAPI()) })
	e.Router.GET("/openapi.yaml", func(event *core.RequestEvent) error {
		data, err := api.OpenAPI().YAML()
		if err != nil {
			return err
		}
		return event.Blob(http.StatusOK, "application/yaml", data)
	})
	e.Router.GET("/docs", func(event *core.RequestEvent) error {
		return event.HTML(http.StatusOK, "<!doctype html><html><body><redoc spec-url=\"/openapi.json\"></redoc><script src=\"https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js\"></script></body></html>")
	})
	registerTodoAPI(api)
	registerTodoRoutes(e, config)
}

func requestID() string { return time.Now().UTC().Format("20060102150405.000000000") }

type ipRateLimiter struct {
	mu      sync.Mutex
	clients map[string]*rateEntry
}
type rateEntry struct {
	count int
	reset time.Time
}

func newIPRateLimiter() *ipRateLimiter { return &ipRateLimiter{clients: map[string]*rateEntry{}} }
func (l *ipRateLimiter) Allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := l.clients[ip]
	if entry == nil || now.After(entry.reset) {
		l.clients[ip] = &rateEntry{count: 1, reset: now.Add(time.Minute)}
		return true
	}
	entry.count++
	return entry.count <= 120
}

func registerTodoAPI(api huma.API) {
	type todo struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		Completed bool   `json:"completed"`
	}
	huma.Register(api, huma.Operation{OperationID: "listTodos", Method: http.MethodGet, Path: "/api/todos", Tags: []string{"Todos"}, Summary: "List the current user's todos", Security: []map[string][]string{{"pocketbaseAuth": {}}}}, func(_ context.Context, _ *struct{}) (*struct{ Body []todo }, error) { return nil, nil })
}

func registerTodoRoutes(e *core.ServeEvent, config Config) {
	e.Router.GET("/api/todos", func(event *core.RequestEvent) error {
		if event.Auth == nil {
			return event.UnauthorizedError("authentication required", nil)
		}
		return event.JSON(http.StatusOK, []any{})
	})
	_ = config
}
