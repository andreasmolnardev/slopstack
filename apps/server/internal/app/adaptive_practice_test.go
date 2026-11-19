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

func TestAdaptivePracticeCanTargetOwnedCourseAndModuleKnowledge(t *testing.T) {
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
	owner := createRecordForPracticeTest(t, app, "adaptive-course@example.com")
	other := createRecordForPracticeTest(t, app, "adaptive-course-other@example.com")
	unitOne := createCoursePracticeUnit(t, app, owner.Id, "Limits", "A limit describes a function's behavior near a point.", "course-a", "outline-one", []string{"module-one"})
	unitTwo := createCoursePracticeUnit(t, app, owner.Id, "Continuity", "Continuity means the function's value matches its nearby limit.", "course-a", "outline-two", []string{"module-two"})
	foreignUnit := createCoursePracticeUnit(t, app, other.Id, "Private concept", "A private explanation.", "course-a", "outline-three", []string{"module-one"})
	course := createTestRecord(t, app, "courses", map[string]any{
		"owner": owner.Id, "title": "Calculus", "status": "published", "version": 1,
		"content": map[string]any{"curriculum": map[string]any{
			"knowledge_units": []any{map[string]any{"id": "outline-one"}, map[string]any{"id": "outline-two"}, map[string]any{"id": "outline-three"}},
			"modules": []any{
				map[string]any{"id": "module-one", "knowledge_unit_ids": []string{"outline-one", "outline-three"}},
				map[string]any{"id": "module-two", "knowledge_unit_ids": []string{"outline-two"}},
			},
		}},
	})
	unitOne.Set("metadata", map[string]any{"course_id": course.Id, "generated": true, "outline_unit_id": "outline-one", "module_ids": []string{"module-one"}})
	unitTwo.Set("metadata", map[string]any{"course_id": course.Id, "generated": true, "outline_unit_id": "outline-two", "module_ids": []string{"module-two"}})
	foreignUnit.Set("metadata", map[string]any{"course_id": course.Id, "generated": true, "outline_unit_id": "outline-three", "module_ids": []string{"module-one"}})
	for _, unit := range []*core.Record{unitOne, unitTwo, foreignUnit} {
		if err := app.Save(unit); err != nil {
			t.Fatal(err)
		}
	}
	courseUnits, err := selectCoursePracticeUnits(app, owner.Id, course.Id, "", false)
	if err != nil || len(courseUnits) != 2 || courseUnits[0].Id != unitOne.Id || courseUnits[1].Id != unitTwo.Id {
		t.Fatalf("course practice did not resolve the ordered owner-scoped concepts: %v (%#v)", err, courseUnits)
	}
	moduleUnits, err := selectCoursePracticeUnits(app, owner.Id, course.Id, "module-one", true)
	if err != nil || len(moduleUnits) != 1 || moduleUnits[0].Id != unitOne.Id {
		t.Fatalf("module practice selected an invalid or foreign concept: %v (%#v; foreign=%s)", err, moduleUnits, foreignUnit.Id)
	}
	if _, err := selectCoursePracticeUnits(app, other.Id, course.Id, "", false); err == nil {
		t.Fatal("another learner's course must not be usable for practice")
	}
	if _, err := selectCoursePracticeUnits(app, owner.Id, course.Id, "missing-module", true); err == nil {
		t.Fatal("unknown module must not produce a practice set")
	}

	body := `{"mode":"module","course_id":"` + course.Id + `","module_id":"module-two"}`
	request := httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes", strings.NewReader(body))
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createAdaptivePracticeQuizRoute(event); err != nil {
		t.Fatalf("module quiz creation failed: %v", err)
	}
	var created struct {
		ID        string                   `json:"id"`
		Mode      string                   `json:"mode"`
		Questions []practiceQuestionPublic `json:"questions"`
	}
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Mode != "module" || len(created.Questions) != 1 || created.Questions[0].UnitID != unitTwo.Id {
		t.Fatalf("module quiz contained the wrong concepts: %#v", created)
	}
	stored, err := app.FindRecordById("adaptive_practice_quizzes", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	var answerKeys map[string]string
	if err := stored.UnmarshalJSONField("answer_keys", &answerKeys); err != nil || answerKeys[created.Questions[0].ID] == "" {
		t.Fatalf("module quiz did not keep its key privately: %#v (%v)", answerKeys, err)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes/"+created.ID+"/submit", strings.NewReader(`{"answers":{"`+created.Questions[0].ID+`":`+mustJSON(t, answerKeys[created.Questions[0].ID])+`}}`))
	request.SetPathValue("id", created.ID)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := submitAdaptivePracticeQuizRoute(event); err != nil {
		t.Fatalf("module quiz submission failed: %v", err)
	}
	evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = {:type}", "", 10, 0, dbx.Params{"owner": owner.Id, "unit": unitTwo.Id, "type": "adaptive_practice"})
	if err != nil || len(evidence) != 1 {
		t.Fatalf("module quiz did not record evidence for its concept: %v (%d)", err, len(evidence))
	}
}

func TestAdaptivePracticeGapModeIncludesNewAndWeakUnitsOnly(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createRecordForPracticeTest(t, app, "adaptive-gap@example.com")
	other := createRecordForPracticeTest(t, app, "adaptive-gap-other@example.com")
	newUnit := createPracticeUnit(t, app, owner.Id, "New concept", "This has never been practiced.")
	weakUnit := createPracticeUnit(t, app, owner.Id, "Weak concept", "Mastery is below the gap threshold.")
	strongUnit := createPracticeUnit(t, app, owner.Id, "Strong concept", "Mastery is already high.")
	createPracticeUnit(t, app, other.Id, "Foreign concept", "This belongs to another learner.")
	setPracticeMastery(t, app, owner.Id, weakUnit.Id, 0.2)
	setPracticeMastery(t, app, owner.Id, strongUnit.Id, 0.9)
	units, err := selectPracticeUnits(app, owner.Id, "gap", nil)
	if err != nil || len(units) != 2 || units[0].Id != weakUnit.Id || units[1].Id != newUnit.Id {
		t.Fatalf("gap mode selected the wrong concepts: %v (%#v)", err, units)
	}
}

func TestAdaptivePracticeGapModeAddsMissingPrerequisitesAndStopsAtMasteredUnits(t *testing.T) {
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
	owner := createRecordForPracticeTest(t, app, "adaptive-prerequisite@example.com")
	other := createRecordForPracticeTest(t, app, "adaptive-prerequisite-other@example.com")
	focus := createPracticeUnit(t, app, owner.Id, "Integration", "A method for accumulating change.")
	prerequisite := createPracticeUnit(t, app, owner.Id, "Antiderivative", "A function with the given derivative.")
	mastered := createPracticeUnit(t, app, owner.Id, "Derivative", "The instantaneous rate of change.")
	unrelated := createPracticeUnit(t, app, owner.Id, "Number theory", "Properties of integers.")
	foreign := createPracticeUnit(t, app, other.Id, "Private prerequisite", "This must not cross owners.")
	setPracticeMastery(t, app, owner.Id, focus.Id, 0.35)
	setPracticeMastery(t, app, owner.Id, mastered.Id, 0.95, 3)
	setPracticeMastery(t, app, owner.Id, unrelated.Id, 0.95, 3)
	createTestRecord(t, app, "knowledge_edges", map[string]any{"owner": owner.Id, "from_unit": focus.Id, "to_unit": prerequisite.Id, "relationship": "requires"})
	createTestRecord(t, app, "knowledge_edges", map[string]any{"owner": owner.Id, "from_unit": prerequisite.Id, "to_unit": mastered.Id, "relationship": "builds_on"})
	createTestRecord(t, app, "knowledge_edges", map[string]any{"owner": owner.Id, "from_unit": prerequisite.Id, "to_unit": focus.Id, "relationship": "requires"})
	createTestRecord(t, app, "knowledge_edges", map[string]any{"owner": owner.Id, "from_unit": focus.Id, "to_unit": foreign.Id, "relationship": "requires"})

	units, reasons, err := selectPracticeGapUnits(app, owner.Id, []string{focus.Id})
	if err != nil || len(units) != 2 || units[0].Id != focus.Id || units[1].Id != prerequisite.Id {
		t.Fatalf("gap practice did not add the missing prerequisite chain safely: %v (%#v)", err, units)
	}
	if reasons[focus.Id] != "Selected focus" || reasons[prerequisite.Id] != "Prerequisite for Integration" {
		t.Fatalf("gap practice did not explain why concepts were selected: %#v", reasons)
	}
	body, _ := json.Marshal(map[string]any{"mode": "gap", "unit_ids": []string{focus.Id}})
	request := httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes", strings.NewReader(string(body)))
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createAdaptivePracticeQuizRoute(event); err != nil {
		t.Fatalf("gap quiz request failed: %v", err)
	}
	var response struct {
		Questions []practiceQuestionPublic `json:"questions"`
	}
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Questions) != 2 || response.Questions[1].Reason != "Prerequisite for Integration" {
		t.Fatalf("gap quiz response omitted its prerequisite reason: %#v", response.Questions)
	}
}

func TestAdaptivePracticeRejectsUnansweredWithoutChangingMastery(t *testing.T) {
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
	owner := createRecordForPracticeTest(t, app, "adaptive-unanswered@example.com")
	unit := createPracticeUnit(t, app, owner.Id, "Single concept", "A saved explanation for the concept.")
	questions := makePracticeQuestions([]*core.Record{unit}, nil, "test-seed")
	if len(questions) != 1 || len(questions[0].Options) != 4 {
		t.Fatalf("expected four options: %#v", questions)
	}
	seen := map[string]bool{}
	for _, option := range questions[0].Options {
		if seen[option] {
			t.Fatalf("practice options must be distinct: %#v", questions[0].Options)
		}
		seen[option] = true
	}
	collection, err := app.FindCollectionByNameOrId("adaptive_practice_quizzes")
	if err != nil {
		t.Fatal(err)
	}
	quiz := core.NewRecord(collection)
	quiz.Set("owner", owner.Id)
	quiz.Set("mode", "selected")
	quiz.Set("status", "open")
	quiz.Set("unit_ids", []string{unit.Id})
	quiz.Set("questions", questions)
	quiz.Set("answer_keys", map[string]string{questions[0].ID: questions[0].CorrectChoice})
	quiz.Set("attempts", []any{})
	if err := app.Save(quiz); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/learning/practice/quizzes/"+quiz.Id+"/submit", strings.NewReader(`{"answers":{}}`))
	request.SetPathValue("id", quiz.Id)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := submitAdaptivePracticeQuizRoute(event); err == nil {
		t.Fatal("submission without answers should be rejected")
	}
	stored, err := app.FindRecordById("adaptive_practice_quizzes", quiz.Id)
	if err != nil || stored.GetString("status") != "open" {
		t.Fatalf("rejected submission should leave quiz open: %v (%v)", err, stored)
	}
	evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit}", "", 10, 0, dbx.Params{"owner": owner.Id, "unit": unit.Id})
	if err != nil || len(evidence) != 0 {
		t.Fatalf("rejected submission changed learner evidence: %v (%d)", err, len(evidence))
	}
	mastery, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner} && unit = {:unit}", "", 1, 0, dbx.Params{"owner": owner.Id, "unit": unit.Id})
	if err != nil || len(mastery) != 0 {
		t.Fatalf("rejected submission changed mastery: %v (%d)", err, len(mastery))
	}
}

func TestAdaptivePracticeDifficultyUsesMasteryAndRepetitionHistory(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createRecordForPracticeTest(t, app, "adaptive-difficulty@example.com")
	high := createPracticeUnit(t, app, owner.Id, "Integration", "Integration accumulates signed area across an interval.")
	low := createPracticeUnit(t, app, owner.Id, "Derivative", "A derivative measures an instantaneous rate of change.")
	masteryByUnit := map[string]practiceMastery{
		high.Id: {Score: 0.9, Repetitions: 3},
		low.Id:  {Score: 0.45, Repetitions: 1},
	}
	questions := makePracticeQuestions([]*core.Record{high, low}, masteryByUnit, "difficulty-test")
	if len(questions) != 2 {
		t.Fatalf("expected a question for each concept: %#v", questions)
	}
	if questions[0].Difficulty != "recall" || questions[0].CorrectChoice != high.GetString("title") || !strings.Contains(questions[0].Prompt, high.GetString("description")) {
		t.Fatalf("repeated high-mastery concept should use reverse recall: %#v", questions[0])
	}
	if questions[1].Difficulty != "recognition" || questions[1].CorrectChoice != low.GetString("description") || !strings.Contains(questions[1].Prompt, low.GetString("title")) {
		t.Fatalf("low-mastery concept should use definition recognition: %#v", questions[1])
	}
	for _, question := range questions {
		seen := map[string]bool{}
		for _, option := range question.Options {
			if seen[option] {
				t.Fatalf("difficulty %q produced duplicate choices: %#v", question.Difficulty, question.Options)
			}
			seen[option] = true
		}
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

func createCoursePracticeUnit(t *testing.T, app core.App, ownerID, title, description, courseID, outlineID string, moduleIDs []string) *core.Record {
	t.Helper()
	return createTestRecord(t, app, "knowledge_units", map[string]any{
		"owner": ownerID, "title": title, "description": description, "unit_type": "concept",
		"metadata": map[string]any{"course_id": courseID, "generated": true, "outline_unit_id": outlineID, "module_ids": moduleIDs},
	})
}

func setPracticeMastery(t *testing.T, app core.App, ownerID, unitID string, value float64, repetitions ...int) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("knowledge_mastery")
	if err != nil {
		t.Fatal(err)
	}
	mastery := core.NewRecord(collection)
	mastery.Set("owner", ownerID)
	mastery.Set("unit", unitID)
	mastery.Set("mastery", value)
	if len(repetitions) > 0 {
		mastery.Set("repetitions", repetitions[0])
	}
	mastery.Set("next_review", time.Now().UTC().Add(time.Hour))
	if err := app.Save(mastery); err != nil {
		t.Fatal(err)
	}
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
