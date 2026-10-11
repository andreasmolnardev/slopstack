package httpapi

import (
	"io/fs"
	"net/http"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// RegisterStaticDirectory serves a built frontend from dir when it exists.
func RegisterStaticDirectory(e *core.ServeEvent, dir string) {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return
	}
	RegisterStaticRoutes(e, os.DirFS(dir))
}

// RegisterStaticRoutes serves frontend files and falls back to index.html for
// client-side routes. Non-GET requests and backend-reserved paths remain 404s.
func RegisterStaticRoutes(e *core.ServeEvent, files fs.FS) {
	e.Router.Any("/{path...}", func(event *core.RequestEvent) error {
		if event.Request.Method != http.MethodGet {
			return router.ErrFileNotFound
		}
		requestPath := strings.TrimPrefix(event.Request.URL.Path, "/")
		if requestPath == "" {
			return event.FileFS(files, "index.html")
		}
		if requestPath == "api" || strings.HasPrefix(requestPath, "api/") ||
			requestPath == "_" || strings.HasPrefix(requestPath, "_/") ||
			requestPath == "openapi.json" || requestPath == "openapi.yaml" || requestPath == "docs" {
			return router.ErrFileNotFound
		}
		return apis.Static(files, true)(event)
	})
}
