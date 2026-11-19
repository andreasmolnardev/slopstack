package app

import (
	"encoding/json"
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

func TestPodcastFixtureAndScriptValidation(t *testing.T) {
	outline, transcript := fixturePodcastScript("Learning by asking", "how questions guide learning", podcastContext{}), fixturePodcastTranscript("Learning by asking", "how questions guide learning", podcastContext{})
	if err := validatePodcastOutline(outline); err != nil {
		t.Fatalf("fixture outline rejected: %v", err)
	}
	if err := validatePodcastTranscript(transcript); err != nil {
		t.Fatalf("fixture transcript rejected: %v", err)
	}
	transcript.Turns[1].Speaker = "host"
	if err := validatePodcastTranscript(transcript); err == nil {
		t.Fatal("expected repeated speaker validation error")
	}
}

func TestPodcastCourseContextIsOwnerScopedAndModuleBounded(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "pod-course@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "pod-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	content := map[string]any{"modules": []any{
		map[string]any{"id": "m1", "title": "Foundations", "objectives": []any{"Name the parts"}, "scenes": []any{map[string]any{"title": "First scene", "widget": map[string]any{"config": map[string]any{"body": "Explain the key parts."}}}}},
		map[string]any{"id": "m2", "title": "Applications", "objectives": []any{"Apply the model"}, "scenes": []any{map[string]any{"title": "Second scene", "widget": map[string]any{"config": map[string]any{"body": "Test a new example."}}}}},
	}}
	course := createTestRecord(t, app, "courses", map[string]any{"owner": owner.Id, "title": "Learning models", "content": content})
	reference, err := loadPodcastCourseContext(app, owner.Id, course.Id, "m2")
	if err != nil {
		t.Fatal(err)
	}
	if reference.Title != "Learning models — Applications" || !strings.Contains(reference.Content, "Test a new example") || strings.Contains(reference.Content, "Explain the key parts") {
		t.Fatalf("module context was not bounded: %#v", reference)
	}
	if _, err := loadPodcastCourseContext(app, other.Id, course.Id, ""); err == nil {
		t.Fatal("another owner's course context was returned")
	}
	if _, err := loadPodcastCourseContext(app, owner.Id, course.Id, "missing"); err == nil {
		t.Fatal("missing module should fail")
	}
}

func TestPodcastOpenAPIContracts(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Starburst API", "test"))
	api.OpenAPI().Components.SecuritySchemes = map[string]*huma.SecurityScheme{"pocketbaseAuth": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"}}
	registerPodcastAPI(api)
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/audio/episodes"}, {"POST", "/api/audio/episodes"},
		{"GET", "/api/audio/episodes/{id}"}, {"DELETE", "/api/audio/episodes/{id}"},
		{"POST", "/api/audio/episodes/{id}/regenerate"},
		{"PUT", "/api/audio/episodes/{id}/script"},
		{"PUT", "/api/audio/episodes/{id}/voices"},
	} {
		item := api.OpenAPI().Paths[route.path]
		if item == nil {
			t.Fatalf("missing %s %s", route.method, route.path)
		}
		operations := map[string]*huma.Operation{"GET": item.Get, "POST": item.Post, "PUT": item.Put, "DELETE": item.Delete}
		if operation := operations[route.method]; operation == nil || len(operation.Security) == 0 {
			t.Fatalf("missing authenticated operation %s %s", route.method, route.path)
		}
	}
}

func TestPodcastVoiceAssignmentsAreOwnerScopedAndPersistAcrossScriptEdits(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "voice-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "voice-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	outline := fixturePodcastScript("Voices", "a topic", podcastContext{})
	transcript := fixturePodcastTranscript("Voices", "a topic", podcastContext{})
	record, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Voices", Topic: "a topic"}, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	assignments := podcastVoiceAssignments{Host: podcastRoleVoice{Voice: "host-model", Speaker: "0"}, Guest: podcastRoleVoice{Voice: "guest-model", Speaker: "1"}}
	body, _ := json.Marshal(assignments)
	request := httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/voices", strings.NewReader(string(body)))
	request.SetPathValue("id", record.Id)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updatePodcastVoicesRoute(event); err != nil {
		t.Fatalf("voice update failed: %v", err)
	}
	var exported map[string]any
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &exported); err != nil {
		t.Fatal(err)
	}
	if exported["voice_assignments"] == nil {
		t.Fatal("saved assignments missing from episode response")
	}
	request = httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/voices", strings.NewReader(string(body)))
	request.SetPathValue("id", record.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updatePodcastVoicesRoute(event); err == nil {
		t.Fatal("another learner's episode voices were editable")
	}
	record, err = app.FindRecordById("podcast_episodes", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	var saved podcastVoiceAssignments
	if err := record.UnmarshalJSONField("voice_assignments", &saved); err != nil {
		t.Fatal(err)
	}
	if saved != assignments {
		t.Fatalf("voice assignments not saved: %#v", saved)
	}
	updatedScript := podcastScriptBody{Outline: outline, Transcript: transcript}
	updatedScript.Outline.Summary = "Updated after voice selection."
	scriptBody, _ := json.Marshal(updatedScript)
	request = httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/script", strings.NewReader(string(scriptBody)))
	request.SetPathValue("id", record.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updatePodcastScriptRoute(event); err != nil {
		t.Fatalf("script edit after voice assignment failed: %v", err)
	}
	record, err = app.FindRecordById("podcast_episodes", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	saved = podcastVoiceAssignments{}
	if err := record.UnmarshalJSONField("voice_assignments", &saved); err != nil || saved != assignments {
		t.Fatalf("script edit dropped voice assignments: %#v, %v", saved, err)
	}
	if _, err := normalizePodcastVoiceAssignments(podcastVoiceAssignments{Host: podcastRoleVoice{Speaker: "0"}}); err == nil {
		t.Fatal("speaker without voice accepted")
	}
	if _, err := normalizePodcastVoiceAssignments(podcastVoiceAssignments{Host: podcastRoleVoice{Voice: strings.Repeat("x", 201)}}); err == nil {
		t.Fatal("oversized voice accepted")
	}
}

func TestPodcastScriptEditsAreValidatedAndOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "script-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "script-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	outline := fixturePodcastScript("Original title", "a topic", podcastContext{})
	transcript := fixturePodcastTranscript("Original title", "a topic", podcastContext{})
	input := podcastCreateBody{Title: "Original title", Topic: "a topic"}
	record, err := savePodcastEpisode(app, owner.Id, input, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	edited := podcastScriptBody{Outline: outline, Transcript: transcript}
	edited.Outline.Summary = "An edited summary."
	edited.Transcript.Turns[0].Text = "Welcome back to our edited episode."
	body, err := json.Marshal(edited)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/script", strings.NewReader(string(body)))
	request.SetPathValue("id", record.Id)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := updatePodcastScriptRoute(event); err != nil {
		t.Fatalf("valid edit was rejected: %v", err)
	}
	record, err = app.FindRecordById("podcast_episodes", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	var savedOutline podcastOutline
	if err := record.UnmarshalJSONField("outline", &savedOutline); err != nil {
		t.Fatal(err)
	}
	if savedOutline.Summary != "An edited summary." {
		t.Fatalf("updated outline was not saved: %q", savedOutline.Summary)
	}
	if record.GetString("title") != edited.Outline.Title {
		t.Fatalf("episode title did not follow the edited outline: %q", record.GetString("title"))
	}
	if err := record.UnmarshalJSONField("transcript", &transcript); err != nil {
		t.Fatal(err)
	}
	if transcript.Turns[0].Text != "Welcome back to our edited episode." {
		t.Fatalf("updated transcript was not saved: %q", transcript.Turns[0].Text)
	}

	bad := edited
	bad.Transcript.Turns[1].Speaker = "host"
	body, _ = json.Marshal(bad)
	request = httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/script", strings.NewReader(string(body)))
	request.SetPathValue("id", record.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updatePodcastScriptRoute(event); err == nil {
		t.Fatal("invalid repeated speaker edit was accepted")
	}

	request = httptest.NewRequest(http.MethodPut, "/api/audio/episodes/"+record.Id+"/script", strings.NewReader(string(body)))
	request.SetPathValue("id", record.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := updatePodcastScriptRoute(event); err == nil {
		t.Fatal("another learner's script was editable")
	}
}

func TestPodcastBodyRejectsUnknownFields(t *testing.T) {
	var decoded podcastCreateBody
	if err := decodePodcastJSON([]byte(`{"title":"x","unknown":true}`), &decoded); err == nil {
		t.Fatal("unknown provider fields must be rejected")
	}
}

func TestPodcastEpisodesAreOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "podcast-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "podcast-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	episodeRecord := func(user *core.Record, title string) *core.Record {
		return createTestRecord(t, app, "podcast_episodes", map[string]any{"owner": user.Id, "title": title, "topic": "Topic", "status": "ready", "source_ids": []string{}, "concept_ids": []string{}, "outline": map[string]any{"title": title, "summary": "Summary", "segments": []any{}}, "transcript": map[string]any{"turns": []any{}}, "duration_seconds": 10})
	}
	ownEpisode := episodeRecord(owner, "Mine")
	foreignEpisode := episodeRecord(other, "Not mine")
	request := httptest.NewRequest(http.MethodGet, "/api/audio/episodes", strings.NewReader(""))
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := listPodcastEpisodesRoute(event); err != nil {
		t.Fatal(err)
	}
	var listed []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0]["id"] != ownEpisode.Id {
		t.Fatalf("podcast list crossed owner boundary: %#v", listed)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/audio/episodes/"+foreignEpisode.Id, nil)
	request.SetPathValue("id", foreignEpisode.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := getPodcastEpisodeRoute(event); err == nil {
		t.Fatal("another learner's episode was readable")
	}
}
