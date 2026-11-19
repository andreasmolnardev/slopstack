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

func TestNormalizeSpeakingTranscript(t *testing.T) {
	if normalizeSpeakingTranscript("  Don't—STOP! ") != "don t stop" {
		t.Fatalf("unexpected normalization: %q", normalizeSpeakingTranscript("  Don't—STOP! "))
	}
	if normalizeSpeakingTranscript("café") != normalizeSpeakingTranscript("CAFÉ!") {
		t.Fatal("normalization should preserve and case-fold accented letters")
	}
	if err := validateSpeakingAttemptInput(strings.Repeat("x", maxSpeakingTranscriptRunes+1)); err == nil {
		t.Fatal("expected long transcript to be rejected")
	}
}

func TestSpeakingAttemptRecordsOwnedEvidence(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "speaking-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "speaking-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Good morning", "unit_type": "vocabulary", "metadata": map[string]any{"language": "English", "translation": "Buenos días"}})
	request := httptest.NewRequest(http.MethodPost, "/api/languages/vocabulary/"+unit.Id+"/speaking-attempt", strings.NewReader(`{"transcript":" GOOD, morning! "}`))
	request.SetPathValue("id", unit.Id)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := submitSpeakingAttemptRoute(event); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["correct"] != true || result["score"] != float64(1) {
		t.Fatalf("unexpected result: %#v", result)
	}
	evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit}", "", 10, 0, map[string]any{"owner": owner.Id, "unit": unit.Id})
	if err != nil || len(evidence) != 1 {
		t.Fatalf("expected one evidence row, found %d: %v", len(evidence), err)
	}
	if evidence[0].GetString("evidence_type") != "speaking_attempt" || evidence[0].GetFloat("score") != 1 {
		t.Fatalf("unexpected evidence: %#v", evidence[0].PublicExport())
	}

	foreignRequest := httptest.NewRequest(http.MethodPost, "/api/languages/vocabulary/"+unit.Id+"/speaking-attempt", strings.NewReader(`{"transcript":"Good morning"}`))
	foreignRequest.SetPathValue("id", unit.Id)
	foreignResponse := httptest.NewRecorder()
	foreignEvent := &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: foreignRequest, Response: foreignResponse}}
	if err := submitSpeakingAttemptRoute(foreignEvent); err == nil {
		t.Fatal("other user's vocabulary should not be available")
	}
}

func TestSpeakingOpenAPIContract(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Starburst API", "test"))
	api.OpenAPI().Components.SecuritySchemes = map[string]*huma.SecurityScheme{"pocketbaseAuth": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"}}
	registerSpeakingAPI(api)
	operation := api.OpenAPI().Paths["/api/languages/vocabulary/{id}/speaking-attempt"].Post
	if operation == nil || len(operation.Security) == 0 {
		t.Fatal("speaking attempt route must be documented and authenticated")
	}
}
