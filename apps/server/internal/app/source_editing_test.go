package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestUpdateLearningSourceValidatesAndPreservesOwner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "source-edit-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "source-edit-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	source := createTestRecord(t, app, "learning_sources", map[string]any{"owner": owner.Id, "title": "Old notes", "source_type": "text/markdown", "content": "old", "metadata": map[string]any{"bytes": 3, "imported": true}})

	request := httptest.NewRequest(http.MethodPatch, "/api/learning/sources/"+source.Id, strings.NewReader(`{"title":"  Revised notes  ","content":"  ## Updated source\nUseful details.  ","source_type":"text/plain"}`))
	request.SetPathValue("id", source.Id)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updateLearningSourceRoute(event); err != nil {
		t.Fatal(err)
	}
	updated, err := app.FindRecordById("learning_sources", source.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("owner") != owner.Id || updated.GetString("title") != "Revised notes" || updated.GetString("content") != "## Updated source\nUseful details." || updated.GetString("source_type") != "text/plain" {
		t.Fatalf("source was not updated safely: %#v", updated.PublicExport())
	}
	var metadata map[string]any
	if err := updated.UnmarshalJSONField("metadata", &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["bytes"] != float64(len(updated.GetString("content"))) || metadata["imported"] != true {
		t.Fatalf("source metadata was not preserved and refreshed: %#v", metadata)
	}

	request = httptest.NewRequest(http.MethodPatch, "/api/learning/sources/"+source.Id, strings.NewReader(`{"title":"Other learner edit"}`))
	request.SetPathValue("id", source.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updateLearningSourceRoute(event); err == nil {
		t.Fatal("another learner must not edit this source")
	}
	request = httptest.NewRequest(http.MethodGet, "/api/learning/sources/"+source.Id, nil)
	request.SetPathValue("id", source.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := getLearningSourceRoute(event); err == nil {
		t.Fatal("another learner must not read source text")
	}
	request = httptest.NewRequest(http.MethodGet, "/api/learning/sources/"+source.Id, nil)
	request.SetPathValue("id", source.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := getLearningSourceRoute(event); err != nil || !strings.Contains(event.Response.(*httptest.ResponseRecorder).Body.String(), "Updated source") {
		t.Fatalf("source owner could not read source text: %v", err)
	}
}

func TestUpdateLearningSourceRejectsInvalidPatch(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "source-edit-invalid@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	source := createTestRecord(t, app, "learning_sources", map[string]any{"owner": owner.Id, "title": "Notes", "source_type": "text/plain", "content": "Keep this."})
	for _, body := range []string{`{"title":"  "}`, `{"content":"  "}`, `{"source_type":"text/html"}`, `{"unexpected":"value"}`} {
		request := httptest.NewRequest(http.MethodPatch, "/api/learning/sources/"+source.Id, strings.NewReader(body))
		request.SetPathValue("id", source.Id)
		event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
		if err := updateLearningSourceRoute(event); err == nil {
			t.Errorf("invalid source update accepted: %s", body)
		}
	}
}

func TestSourceEditingOpenAPIContract(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Starburst API", "test"))
	registerSourceEditingAPI(api)
	item := api.OpenAPI().Paths["/api/learning/sources/{id}"]
	if item == nil || item.Get == nil || item.Patch == nil || len(item.Get.Security) == 0 || len(item.Patch.Security) == 0 {
		t.Fatal("source detail and update must be documented as authenticated routes")
	}
}
