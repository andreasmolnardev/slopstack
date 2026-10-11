package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/andreasmolnardev/slopstack/apps/server/pb_migrations"
	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

func newTodoTestServer(t *testing.T, app core.App, auth *core.Record) func(string, string, string) *httptest.ResponseRecorder {
	t.Helper()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	if err := audit.RegisterRequestHooks(app, audit.PocketBaseRecorder{App: app}, audit.RequestHookConfig{
		Collections: []string{"todos"},
	}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	api := humago.New(mux, huma.DefaultConfig("Test API", "0.1.0"))
	registerTodoAPI(api)
	serveEvent := &core.ServeEvent{App: app}
	serveEvent.Router = newTestRouter(app, auth)
	registerRoutes(serveEvent, api)
	handler, err := serveEvent.Router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	do := func(method, path, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		handler.ServeHTTP(recorder, request)
		return recorder
	}
	return do
}

func newTestRouter(app core.App, auth *core.Record) *router.Router[*core.RequestEvent] {
	return router.NewRouter(func(w http.ResponseWriter, req *http.Request) (*core.RequestEvent, router.EventCleanupFunc) {
		event := &core.RequestEvent{App: app, Auth: auth}
		event.Response = w
		event.Request = req
		return event, nil
	})
}

func TestTodoCRUDUsesAuthenticatedOwner(t *testing.T) {
	app := newTestApp(t)
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user, err := app.FindAuthRecordByEmail("users", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Fatal(err)
	}
	do := newTodoTestServer(t, app, user)

	spoofed := do(http.MethodPost, "/api/todos", `{"title":"Spoofed","owner":"`+other.Id+`"}`)
	if spoofed.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create with protected owner field status = %d; body: %s", spoofed.Code, spoofed.Body.String())
	}
	created := do(http.MethodPost, "/api/todos", `{"title":"  Ship the feature  ","completed":false}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d; body: %s", created.Code, created.Body.String())
	}
	var todo Todo
	if err := json.Unmarshal(created.Body.Bytes(), &todo); err != nil {
		t.Fatal(err)
	}
	if todo.Title != "Ship the feature" || todo.ID == "" {
		t.Fatalf("unexpected created todo: %#v", todo)
	}
	record, err := app.FindRecordById("todos", todo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("owner"); got != user.Id {
		t.Fatalf("stored owner = %q, want authenticated user %q", got, user.Id)
	}

	listed := do(http.MethodGet, "/api/todos", "")
	if listed.Code != http.StatusOK {
		t.Fatalf("list status = %d; body: %s", listed.Code, listed.Body.String())
	}
	var todos []Todo
	if err := json.Unmarshal(listed.Body.Bytes(), &todos); err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 || todos[0].ID != todo.ID {
		t.Fatalf("list returned %#v, want only the created todo", todos)
	}

	spoofedUpdate := do(http.MethodPatch, "/api/todos/"+todo.ID, `{"title":"Spoofed","owner":"`+other.Id+`"}`)
	if spoofedUpdate.Code != http.StatusUnprocessableEntity {
		t.Fatalf("update with protected owner field status = %d; body: %s", spoofedUpdate.Code, spoofedUpdate.Body.String())
	}
	updated := do(http.MethodPatch, "/api/todos/"+todo.ID, `{"title":"Ship it","completed":true}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d; body: %s", updated.Code, updated.Body.String())
	}
	if err := json.Unmarshal(updated.Body.Bytes(), &todo); err != nil {
		t.Fatal(err)
	}
	if todo.Title != "Ship it" || !todo.Completed {
		t.Fatalf("updated todo = %#v", todo)
	}
	record, err = app.FindRecordById("todos", todo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if record.GetString("owner") != user.Id {
		t.Fatal("update changed the protected owner field")
	}

	got := do(http.MethodGet, "/api/todos/"+todo.ID, "")
	if got.Code != http.StatusOK {
		t.Fatalf("get status = %d; body: %s", got.Code, got.Body.String())
	}
	deleted := do(http.MethodDelete, "/api/todos/"+todo.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d; body: %s", deleted.Code, deleted.Body.String())
	}
	if _, err := app.FindRecordById("todos", todo.ID); err == nil {
		t.Fatal("deleted todo still exists")
	}

	logs, err := app.FindRecordsByFilter("audit_logs", "", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 3 {
		t.Fatalf("audit log count = %d, want create/update/delete events", len(logs))
	}
	wantActions := map[string]bool{"todo.created": false, "todo.updated": false, "todo.deleted": false}
	for _, log := range logs {
		if log.GetString("actor") != user.Id {
			t.Errorf("audit actor = %q, want %q", log.GetString("actor"), user.Id)
		}
		action := log.GetString("action")
		if _, ok := wantActions[action]; !ok {
			t.Errorf("unexpected audit action %q", action)
			continue
		}
		wantActions[action] = true
		var metadata map[string]any
		if raw, ok := log.Get("metadata").(types.JSONRaw); !ok || json.Unmarshal(raw, &metadata) != nil || metadata["resource"] != "todos" || metadata["resource_id"] != todo.ID {
			t.Errorf("audit metadata = %#v, want only todo resource identifiers", log.Get("metadata"))
		}
	}
	for action, found := range wantActions {
		if !found {
			t.Errorf("missing audit action %q", action)
		}
	}
}

func TestTodoRequiresAuthAndHidesOtherUsersRecords(t *testing.T) {
	app := newTestApp(t)
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user, err := app.FindAuthRecordByEmail("users", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("todos")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Set("owner", other.Id)
	record.Set("title", "Private")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	unauthenticated := newTodoTestServer(t, app, nil)
	if got := unauthenticated(http.MethodGet, "/api/todos", ""); got.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list status = %d; body: %s", got.Code, got.Body.String())
	}
	asUser := newTodoTestServer(t, app, user)
	for _, request := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/todos/" + record.Id, ""},
		{http.MethodPatch, "/api/todos/" + record.Id, `{"title":"stolen"}`},
		{http.MethodDelete, "/api/todos/" + record.Id, ""},
	} {
		if got := asUser(request.method, request.path, request.body); got.Code != http.StatusNotFound {
			t.Errorf("%s %s status = %d, want 404; body: %s", request.method, request.path, got.Code, got.Body.String())
		}
	}
	if got := record.GetString("title"); got != "Private" {
		t.Fatalf("cross-user request changed title to %q", got)
	}
}

func TestTodoOpenAPIListsSameRuntimeOperations(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Test API", "0.1.0"))
	registerTodoAPI(api)
	paths := api.OpenAPI().Paths
	for _, key := range []string{"/api/todos", "/api/todos/{id}"} {
		if _, ok := paths[key]; !ok {
			t.Errorf("OpenAPI is missing %s", key)
		}
	}
	for _, operationID := range []string{"listTodos", "createTodo", "getTodo", "updateTodo", "deleteTodo"} {
		found := false
		for _, path := range paths {
			for _, operation := range []*huma.Operation{path.Get, path.Post, path.Patch, path.Delete} {
				if operation == nil {
					continue
				}
				if operation.OperationID == operationID {
					found = true
					if len(operation.Security) == 0 {
						t.Errorf("%s has no auth security declaration", operationID)
					}
				}
			}
		}
		if !found {
			t.Errorf("OpenAPI is missing operation %s", operationID)
		}
	}
}

func TestAppMigrationsCanRunMoreThanOnce(t *testing.T) {
	app := newTestApp(t)
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatalf("second migration run failed: %v", err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if users.Fields.GetByName("isAdmin") == nil {
		t.Fatal("isAdmin field was lost after replay")
	}
}
