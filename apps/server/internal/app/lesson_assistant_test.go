package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestLessonAssistantFindsServerSideSceneByFlattenedIndex(t *testing.T) {
	content := map[string]any{"modules": []any{
		map[string]any{"title": "First", "scenes": []any{map[string]any{"title": "One"}}},
		map[string]any{"title": "Second", "scenes": []any{map[string]any{"title": "Two"}}},
	}}
	module, scene, err := lessonAssistantScene(content, 1)
	if err != nil || module["title"] != "Second" || scene["title"] != "Two" {
		t.Fatalf("unexpected scene lookup: module=%v scene=%v err=%v", module, scene, err)
	}
	if _, _, err := lessonAssistantScene(content, 2); err == nil {
		t.Fatal("out of range scene should fail")
	}
}

func TestLessonAssistantFixtureActionsUseCurrentScene(t *testing.T) {
	context := map[string]any{"scene": map[string]any{"title": "Fractions", "widget": map[string]any{"config": map[string]any{"body": "A half is one of two equal parts."}}}}
	for _, action := range []string{"explain", "example", "mistake", "hint", "practice"} {
		response := lessonAssistantFixture(context, action)
		if strings.TrimSpace(response) == "" {
			t.Fatalf("empty response for %s", action)
		}
	}
	if got := lessonAssistantFixture(context, "explain"); !strings.Contains(got, "A half is one of two equal parts") {
		t.Fatalf("fixture did not use scene: %s", got)
	}
}

func TestLessonAssistantCallsOpenAICompatibleProviderWithGroundedContext(t *testing.T) {
	var request struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer assistant-key" {
			t.Errorf("missing provider auth: %s", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"response":"Look for two equal parts."}`}}}})
	}))
	defer server.Close()
	t.Setenv("STARBURST_LLM_BASE_URL", server.URL)
	t.Setenv("STARBURST_LLM_MODEL", "assistant-model")
	t.Setenv("STARBURST_LLM_API_KEY", "assistant-key")

	response, err := generateLessonAssistantResponse(t.Context(), map[string]any{"scene": map[string]any{"title": "Halves"}, "knowledge_units": []any{map[string]any{"title": "Equal parts"}}}, "hint", "What do I check?", "")
	if err != nil || response != "Look for two equal parts." {
		t.Fatalf("assistant response=%q err=%v", response, err)
	}
	if request.Model != "assistant-model" || len(request.Messages) != 2 || !strings.Contains(request.Messages[1].Content, `"requested_help":"hint"`) || !strings.Contains(request.Messages[1].Content, "Equal parts") {
		t.Fatalf("provider request did not include grounded context: %#v", request)
	}
}

func TestLessonAssistantRequiresCourseOwnershipAndDoesNotChangeLesson(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "assistant-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "assistant-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	ownedUnit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Equal parts", "description": "A whole divided into matching amounts.", "unit_type": "concept"})
	privateUnit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": other.Id, "title": "Private note", "description": "Do not expose.", "unit_type": "concept"})
	request := httptest.NewRequest(http.MethodPost, "/api/learning/courses/unused/assistant", nil)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	linked, err := lessonAssistantKnowledge(event, map[string]any{"knowledge_unit_ids": []any{ownedUnit.Id, privateUnit.Id}})
	if err != nil || len(linked) != 1 || linked[0]["title"] != "Equal parts" {
		t.Fatalf("assistant leaked or omitted linked concepts: %#v err=%v", linked, err)
	}
	content := map[string]any{"version": 1, "modules": []any{map[string]any{"title": "Fractions", "scenes": []any{map[string]any{"id": "s1", "title": "Halves", "widget": map[string]any{"type": "explanation", "config": map[string]any{"body": "A half is one of two equal parts."}}}}}}}
	course := createTestRecord(t, app, "courses", map[string]any{"owner": owner.Id, "title": "Fractions", "content": content})
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	call := func(user *core.Record) (*httptest.ResponseRecorder, error) {
		request := httptest.NewRequest(http.MethodPost, "/api/learning/courses/"+course.Id+"/assistant", strings.NewReader(`{"scene_index":0,"action":"explain"}`))
		request.SetPathValue("id", course.Id)
		recorder := httptest.NewRecorder()
		event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: recorder}}
		return recorder, lessonAssistantRoute(event)
	}
	recorder, err := call(owner)
	if err != nil || recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "A half is one of two equal parts") {
		t.Fatalf("course owner did not receive scene help: status=%d body=%s err=%v", recorder.Code, recorder.Body.String(), err)
	}
	if _, err := call(other); err == nil {
		t.Fatal("another learner must not get help from this course")
	}
	unchanged, err := app.FindRecordById("courses", course.Id)
	if err != nil {
		t.Fatal(err)
	}
	var updated map[string]any
	if err := unchanged.UnmarshalJSONField("content", &updated); err != nil {
		t.Fatal(err)
	}
	if _, _, err := lessonAssistantScene(updated, 0); err != nil {
		t.Fatalf("assistant changed lesson content: %v", err)
	}
}
