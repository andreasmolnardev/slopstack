package app

import (
	"context"
	"net/http"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/andreasmolnardev/slopstack/go/backup"
	"github.com/andreasmolnardev/slopstack/go/httpapi"
	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func Register(pb *pocketbase.PocketBase, config Config, api huma.API) error {
	pb.RootCmd.PersistentFlags().StringVar(&config.HTTPAddress, "http", config.HTTPAddress, "HTTP address")
	registerTodoAPI(api)
	if err := audit.RegisterRequestHooks(pb, audit.PocketBaseRecorder{App: pb}, audit.RequestHookConfig{
		Collections: []string{"todos"},
	}); err != nil {
		return err
	}
	if err := ownership.RegisterRequestHooks(pb, ownership.Policy{
		Collection: "todos", OwnerField: "owner", AllowSuperusers: true,
	}); err != nil {
		return err
	}

	pb.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := backup.CleanupRestoreArchives(e.App.DataDir()); err != nil {
			return err
		}
		if err := EnsureCollections(e.App); err != nil {
			return err
		}
		return e.App.RunAppMigrations()
	})
	protectUserAdminFlag(pb)

	pb.OnServe().BindFunc(func(e *core.ServeEvent) error {
		registerRoutes(e, api)
		return e.Next()
	})
	return nil
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

func registerRoutes(e *core.ServeEvent, api huma.API) {
	httpapi.RegisterOpenAPIDocs(e, api)
	httpapi.RegisterHumaRoutes(e, api, []string{"/api/todos", "/api/todos/{id}"}, func(request *http.Request, event *core.RequestEvent) *http.Request {
		return request.WithContext(context.WithValue(request.Context(), requestEventContextKey{}, event))
	})
	httpapi.RegisterStaticDirectory(e, env("SLOPSTACK_PUBLIC_DIR", "public"))
}

type requestEventContextKey struct{}

func requestEvent(ctx context.Context) *core.RequestEvent {
	event, _ := ctx.Value(requestEventContextKey{}).(*core.RequestEvent)
	return event
}
