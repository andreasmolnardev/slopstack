package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/andreasmolnardev/slopstack/go/httpapi"
	"github.com/pocketbase/pocketbase/core"
)

func TestStaticFrontendServesAssetsAndSpaRoutesWithoutCapturingReservedPaths(t *testing.T) {
	app := newTestApp(t)
	serveEvent := &core.ServeEvent{App: app, Router: newTestRouter(app, nil)}
	for _, path := range []string{"/api/todos", "/api/todos/{id}"} {
		serveEvent.Router.Any(path, func(event *core.RequestEvent) error {
			return event.String(http.StatusOK, "todo route")
		})
	}
	files := fstest.MapFS{
		"index.html":    {Data: []byte("<main>starter app</main>")},
		"assets/app.js": {Data: []byte("console.log('app')")},
	}
	httpapi.RegisterStaticRoutes(serveEvent, files)
	handler, err := serveEvent.Router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/", "/projects/42"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Body.String() != "<main>starter app</main>" {
			t.Errorf("GET %s = %d %q, want SPA index", path, response.Code, response.Body.String())
		}
	}

	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
	if asset.Code != http.StatusOK || asset.Body.String() != "console.log('app')" {
		t.Errorf("GET /assets/app.js = %d %q, want JS asset", asset.Code, asset.Body.String())
	}

	apiResponse := httptest.NewRecorder()
	handler.ServeHTTP(apiResponse, httptest.NewRequest(http.MethodGet, "/api/todos/abc", nil))
	if apiResponse.Code != http.StatusOK || apiResponse.Body.String() != "todo route" {
		t.Errorf("GET /api/todos/abc = %d %q, want todo route", apiResponse.Code, apiResponse.Body.String())
	}

	postResponse := httptest.NewRecorder()
	handler.ServeHTTP(postResponse, httptest.NewRequest(http.MethodPost, "/projects/42", nil))
	if postResponse.Code != http.StatusNotFound {
		t.Errorf("POST /projects/42 = %d, want 404", postResponse.Code)
	}

	for _, path := range []string{"/api/missing", "/_/missing", "/openapi.json"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, response.Code)
		}
	}
}
