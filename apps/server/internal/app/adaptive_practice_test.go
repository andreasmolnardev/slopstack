package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestAdaptivePracticeQuizHidesAnswerKeysAndRecordsOwnerEvidence(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAdaptivePracticeCollection(app); err != nil {
		t.Fatal(err)
	}
	owner := createRecordForPracticeTest(t, app, "adaptive-owner@example.com")
	other := createRecordForPracticeTest(t, app, "adaptive-other@example.com")
	unit := createPracticeUnit(t, app, owner.Id, "Binary search", "Binary search halves a sorted search range at each step.")
	distractor := createPracticeUnit(t, app, owner.Id, "Linear search", "Linear search checks each item one at a time.")
	_ = distractor

	request := httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes", strings.NewReader(`{"mode":"selected","unit_ids":["`+unit.Id+`"]}`))
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createAdaptivePracticeQuizRoute(event); err != nil {
		t.Fatal(err)
	}
	var created struct {
		ID        string                   `json:"id"`
		Questions []practiceQuestionPublic `json:"questions"`
	}
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || len(created.Questions) != 1 {
		t.Fatalf("unexpected quiz response: %#v", created)
	}
	publicBytes, _ := json.Marshal(created.Questions[0])
	if strings.Contains(string(publicBytes), "correct") || strings.Contains(string(publicBytes), "remediation") {
		t.Fatalf("private answer or remediation leaked to quiz response: %s", publicBytes)
	}
	quizRecords, err := app.FindRecordsByFilter("adaptive_practice_quizzes", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": created.ID, "owner": owner.Id})
	if err != nil || len(quizRecords) != 1 {
		t.Fatalf("quiz was not saved for its owner: %v (%d)", err, len(quizRecords))
	}
	var keys map[string]string
	if err := quizRecords[0].UnmarshalJSONField("answer_keys", &keys); err != nil || keys[created.Questions[0].ID] == "" {
		t.Fatalf("server did not retain the answer key: %#v (%v)", keys, err)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes/"+created.ID+"/submit", strings.NewReader(`{"answers":{"`+created.Questions[0].ID+`":`+mustJSON(t, keys[created.Questions[0].ID])+`}}`))
	request.SetPathValue("id", created.ID)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := submitAdaptivePracticeQuizRoute(event); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Score   float64 `json:"score"`
		Correct int     `json:"correct"`
		Total   int     `json:"total"`
	}
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Score != 1 || result.Correct != 1 || result.Total != 1 {
		t.Fatalf("correct response scored incorrectly: %#v", result)
	}
	evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = {:type}", "", 10, 0, dbx.Params{"owner": owner.Id, "unit": unit.Id, "type": "adaptive_practice"})
	if err != nil || len(evidence) != 1 {
		t.Fatalf("expected one owner-scoped learning-evidence record: %v (%d)", err, len(evidence))
	}
	mastery, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner} && unit = {:unit}", "", 1, 0, dbx.Params{"owner": owner.Id, "unit": unit.Id})
	if err != nil || len(mastery) != 1 || mastery[0].GetFloat("mastery") <= 0 {
		t.Fatalf("practice result did not update mastery: %v (%#v)", err, mastery)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes/"+created.ID+"/submit", strings.NewReader(`{"answers":{}}`))
	request.SetPathValue("id", created.ID)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := submitAdaptivePracticeQuizRoute(event); err == nil {
		t.Fatal("a different user should not submit this quiz")
	}
}

func TestAdaptivePracticeSelectionChecksOwnershipAndReviewState(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	if err := EnsureAdaptivePracticeCollection(app); err != nil {
		t.Fatal(err)
	}
	owner := createRecordForPracticeTest(t, app, "adaptive-selection@example.com")
	other := createRecordForPracticeTest(t, app, "adaptive-selection-other@example.com")
	weak := createPracticeUnit(t, app, owner.Id, "Fractions", "A fraction represents part of a whole.")
	foreign := createPracticeUnit(t, app, other.Id, "Private topic", "Private description.")
	if _, err := selectPracticeUnits(app, owner.Id, "selected", []string{foreign.Id}); err == nil {
		t.Fatal("selected practice must reject a unit owned by someone else")
	}
	masteryCollection, err := app.FindCollectionByNameOrId("knowledge_mastery")
	if err != nil {
		t.Fatal(err)
	}
	mastery := core.NewRecord(masteryCollection)
	mastery.Set("owner", owner.Id)
	mastery.Set("unit", weak.Id)
	mastery.Set("mastery", 0.2)
	mastery.Set("next_review", time.Now().UTC().Add(-time.Hour))
	if err := app.Save(mastery); err != nil {
		t.Fatal(err)
	}
	due, err := selectPracticeUnits(app, owner.Id, "due", nil)
	if err != nil || len(due) != 1 || due[0].Id != weak.Id {
		t.Fatalf("due mode selected unexpected concepts: %v (%#v)", err, due)
	}
	weakUnits, err := selectPracticeUnits(app, owner.Id, "weak", nil)
	if err != nil || len(weakUnits) != 1 || weakUnits[0].Id != weak.Id {
		t.Fatalf("weak mode selected unexpected concepts: %v (%#v)", err, weakUnits)
	}
}

func TestAdaptivePracticeOpenAPIContracts(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Starburst API", "test"))
	registerAdaptivePracticeAPI(api)
	for _, route := range []struct{ path, method string }{
		{path: "/api/learning/practice/quizzes", method: http.MethodPost},
		{path: "/api/learning/practice/quizzes/{id}/submit", method: http.MethodPost},
	} {
		item := api.OpenAPI().Paths[route.path]
		if item == nil || item.Post == nil || len(item.Post.Security) == 0 {
			t.Errorf("missing authenticated API contract for %s %s", route.method, route.path)
		}
	}
}

func createRecordForPracticeTest(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	return createTestRecord(t, app, "users", map[string]any{"email": email, "password": "secret123456", "passwordConfirm": "secret123456"})
}

func createPracticeUnit(t *testing.T, app core.App, ownerID, title, description string) *core.Record {
	t.Helper()
	return createTestRecord(t, app, "knowledge_units", map[string]any{"owner": ownerID, "title": title, "description": description, "unit_type": "concept"})
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
