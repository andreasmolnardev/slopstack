package app

import (
	"net/http"
	"os"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func Register(pb *pocketbase.PocketBase, config Config, api huma.API) {
	pb.RootCmd.PersistentFlags().StringVar(&config.HTTPAddress, "http", config.HTTPAddress, "HTTP address")
	registerTodoAPI(api)
	registerPreferencesAPI(api)
	pb.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := EnsureCollections(e.App); err != nil {
			return err
		}
		return e.App.RunAppMigrations()
	})
	protectUserAdminFlag(pb)

	pb.OnServe().BindFunc(func(e *core.ServeEvent) error {
		registerRoutes(e, config, api)
		return e.Next()
	})
}

func protectUserAdminFlag(pb *pocketbase.PocketBase) {
	pb.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			e.Record.Set("isAdmin", false)
		}
		return e.Next()
	})
	pb.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			e.Record.Set("isAdmin", e.Record.Original().GetBool("isAdmin"))
		}
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
	registerTodoRoutes(e, config)
	registerPreferencesRoutes(e)
	registerStaticFrontend(e, config)
}

func registerStaticFrontend(e *core.ServeEvent, config Config) {
	e.Router.GET("/{path...}", apis.Static(os.DirFS(config.PublicDirectory), true))
}
