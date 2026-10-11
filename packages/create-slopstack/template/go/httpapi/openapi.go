package httpapi

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase/core"
)

const redocHTML = `<!doctype html><html><body><redoc spec-url="/openapi.json"></redoc><script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script></body></html>`

// RegisterOpenAPIDocs serves the Huma document as JSON and YAML with a small
// ReDoc page. Each application still owns API construction and operations.
func RegisterOpenAPIDocs(event *core.ServeEvent, api huma.API) {
	event.Router.GET("/openapi.json", func(request *core.RequestEvent) error {
		return request.JSON(http.StatusOK, api.OpenAPI())
	})
	event.Router.GET("/openapi.yaml", func(request *core.RequestEvent) error {
		data, err := api.OpenAPI().YAML()
		if err != nil {
			return err
		}
		return request.Blob(http.StatusOK, "application/yaml", data)
	})
	event.Router.GET("/docs", func(request *core.RequestEvent) error {
		return request.HTML(http.StatusOK, redocHTML)
	})
}

// RegisterHumaRoutes mounts the Huma adapter on PocketBase's router and lets
// each application attach its request-specific context before Huma handles it.
// Huma remains responsible for serializing success and error responses.
func RegisterHumaRoutes(event *core.ServeEvent, api huma.API, paths []string, withRequestEvent func(*http.Request, *core.RequestEvent) *http.Request) {
	for _, path := range paths {
		event.Router.Any(path, func(requestEvent *core.RequestEvent) error {
			request := requestEvent.Request
			if withRequestEvent != nil {
				request = withRequestEvent(request, requestEvent)
			}
			api.Adapter().ServeHTTP(requestEvent.Response, request)
			return nil
		})
	}
}
