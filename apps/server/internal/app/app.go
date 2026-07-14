package app

import (
	"context"
	"net/http"

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
