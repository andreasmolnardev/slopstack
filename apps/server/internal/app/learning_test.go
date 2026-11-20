package app

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestLearningOpenAPIContractsCoverPocketBaseRoutes(t *testing.T) {
	api := humago.New(http.NewServeMux(), huma.DefaultConfig("Starburst API", "test"))
	api.OpenAPI().Components.SecuritySchemes = map[string]*huma.SecurityScheme{"pocketbaseAuth": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"}}
	registerLearningAPI(api)
	registerLessonAssistantAPI(api)
	registerSourceWebImportAPI(api)
	expected := []struct{ method, path string }{
		{"GET", "/api/learning/courses"}, {"POST", "/api/learning/courses"},
		{"GET", "/api/learning/courses/{id}"}, {"PATCH", "/api/learning/courses/{id}"}, {"DELETE", "/api/learning/courses/{id}"},
		{"GET", "/api/learning/knowledge-units"}, {"POST", "/api/learning/knowledge-units"},
		{"GET", "/api/learning/knowledge-units/{id}"}, {"PATCH", "/api/learning/knowledge-units/{id}"}, {"DELETE", "/api/learning/knowledge-units/{id}"},
		{"GET", "/api/learning/courses/{id}/export"}, {"POST", "/api/learning/courses/import"},
		{"GET", "/api/account/learning-export"}, {"GET", "/api/account/learning-export/archive"}, {"POST", "/api/account/learning-import"},
		{"GET", "/api/learning/sources"}, {"POST", "/api/learning/sources"}, {"DELETE", "/api/learning/sources/{id}"},
		{"GET", "/api/languages/vocabulary"}, {"POST", "/api/languages/vocabulary"},
		{"POST", "/api/languages/vocabulary/{id}/context-attempt"},
		{"GET", "/api/languages/grammar"}, {"POST", "/api/languages/grammar"}, {"POST", "/api/languages/grammar/{id}/answer"},
		{"GET", "/api/speech/piper"}, {"POST", "/api/speech/synthesize"}, {"POST", "/api/speech/transcribe"},
		{"POST", "/api/learning/courses/{id}/narration"},
		{"POST", "/api/learning/courses/{id}/generate"}, {"GET", "/api/learning/jobs/{id}"}, {"POST", "/api/learning/jobs/{id}/cancel"},
		{"GET", "/api/learning/courses/{id}/versions"}, {"POST", "/api/learning/courses/{id}/versions/{version}/restore"},
		{"POST", "/api/learning/courses/{id}/evidence"}, {"POST", "/api/learning/courses/{id}/assess"},
		{"GET", "/api/learning/courses/{id}/progress"}, {"PUT", "/api/learning/courses/{id}/progress"},
		{"GET", "/api/learning/edges"}, {"POST", "/api/learning/edges"},
		{"GET", "/api/learning/reviews/due"}, {"POST", "/api/learning/reviews/{unitId}"},
		{"GET", "/api/learning/knowledge-units/{id}/evidence"},
		{"POST", "/api/learning/courses/{id}/assistant"},
		{"POST", "/api/learning/sources/web"},
	}
	for _, route := range expected {
		item := api.OpenAPI().Paths[route.path]
		if item == nil {
			t.Errorf("OpenAPI is missing route %s %s", route.method, route.path)
			continue
		}
		operations := map[string]*huma.Operation{"GET": item.Get, "POST": item.Post, "PUT": item.Put, "PATCH": item.Patch, "DELETE": item.Delete}
		operation := operations[route.method]
		if operation == nil {
			t.Errorf("OpenAPI is missing method %s for %s", route.method, route.path)
			continue
		}
		if len(operation.Security) == 0 {
			t.Errorf("route %s %s is missing authentication", route.method, route.path)
		}
	}
	contract, err := json.Marshal(api.OpenAPI())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(contract), "LessonAssistantOutputBody") || !strings.Contains(string(contract), `"scene_index"`) || !strings.Contains(string(contract), `"practice"`) {
		t.Fatal("lesson assistant request and response schemas must be present in OpenAPI")
	}
	response := api.OpenAPI().Paths["/api/speech/synthesize"].Post.Responses["200"]
	if response == nil || response.Content["audio/wav"] == nil {
		t.Fatal("speech synthesis response must be documented as audio/wav")
	}
	narration := api.OpenAPI().Paths["/api/learning/courses/{id}/narration"].Post.Responses["200"]
	if narration == nil || narration.Content["audio/wav"] == nil {
		t.Fatal("lesson narration response must be documented as audio/wav")
	}
}

func TestFixtureCourseContentUsesSupportedScenes(t *testing.T) {
	content := fixtureCourseContent("Fractions")
	if err := validateGeneratedCourse(content); err != nil {
		t.Fatalf("fixture rejected: %v", err)
	}
	if err := validateAssessmentQuestions(content, true); err != nil {
		t.Fatalf("fixture assessment rejected: %v", err)
	}
	applyFixtureLearningContext(content, map[string]any{"sources": []map[string]any{{"id": "source-one", "title": "Notebook", "content": "Compare fractions with shaded strips."}}, "concepts": []map[string]any{{"id": "concept-one", "title": "Equivalent fractions", "description": "Different forms can represent the same amount."}}})
	module := content["modules"].([]any)[0].(map[string]any)
	scene := module["scenes"].([]any)[0].(map[string]any)
	config := scene["widget"].(map[string]any)["config"].(map[string]any)
	if !strings.Contains(config["body"].(string), "Compare fractions with shaded strips") || scene["source_ids"].([]string)[0] != "source-one" {
		t.Fatalf("fixture did not use selected learner context: %#v", scene)
	}
}

func TestPiperVoicesUsesWyomingTTSCapabilities(t *testing.T) {
	info := map[string]any{"tts": map[string]any{"models": []any{
		map[string]any{"name": "en_US-sample-medium", "languages": []any{"en_US"}, "speakers": []any{map[string]any{"name": "speaker-1"}}, "installed": true, "description": "Sample voice", "supports_synthesize_streaming": true},
		map[string]any{"name": "", "languages": []any{"en"}},
		"invalid",
	}}}
	voices := piperVoices(info)
	if len(voices) != 1 || voices[0]["name"] != "en_US-sample-medium" || voices[0]["installed"] != true || len(voices[0]["speakers"].([]any)) != 1 {
		t.Fatalf("unexpected advertised voices: %#v", voices)
	}
	if _, leakedUnsupportedCapability := voices[0]["supports_synthesize_streaming"]; leakedUnsupportedCapability {
		t.Fatal("voice projection should expose only advertised voice metadata")
	}
}

func TestValidatePiperSelectionRejectsUnavailableCapabilities(t *testing.T) {
	info := map[string]any{"tts": map[string]any{"models": []any{
		map[string]any{"name": "voice-a", "installed": true, "speakers": []any{map[string]any{"name": "speaker-a"}}},
		map[string]any{"name": "voice-b", "installed": false},
	}}}
	cases := []struct {
		voice, speaker string
		wantErr        bool
	}{{"", "", false}, {"voice-a", "", false}, {"voice-a", "speaker-a", false}, {"voice-a", "missing", true}, {"voice-b", "", true}, {"missing", "", true}, {"", "speaker-a", true}}
	for _, test := range cases {
		err := validatePiperSelection(info, test.voice, test.speaker)
		if (err != nil) != test.wantErr {
			t.Errorf("validatePiperSelection(%q, %q) error=%v, want error %v", test.voice, test.speaker, err, test.wantErr)
		}
	}
}

func TestAssessmentAnswerEvaluationTypes(t *testing.T) {
	cases := []struct {
		name     string
		question map[string]any
		answer   any
		correct  bool
	}{
		{"choice", map[string]any{"type": "multiple_choice", "correct_answer": "a"}, "a", true},
		{"listening choice", map[string]any{"type": "listening", "correct_answer": "the train arrives at noon"}, "the train arrives at noon", true},
		{"listening wrong choice", map[string]any{"type": "listening", "correct_answer": "the train arrives at noon"}, "the train arrives at two", false},
		{"multi select order independent", map[string]any{"type": "multiple_select", "correct_answers": []string{"a", "b"}}, []any{"b", "a"}, true},
		{"multi select exact set", map[string]any{"type": "multiple_select", "correct_answers": []string{"a", "b"}}, []any{"a"}, false},
		{"boolean", map[string]any{"type": "true_false", "correct_answer": true}, true, true},
		{"numeric tolerance", map[string]any{"type": "numeric", "correct_answer": 3.14, "tolerance": 0.02}, "3.15", true},
		{"short text normalized", map[string]any{"type": "short_text", "accepted_answers": []string{"the central idea"}}, "  THE   central idea ", true},
		{"fill in the blank normalized", map[string]any{"type": "fill_blank", "accepted_answers": []string{"plants"}}, " PLANTS ", true},
		{"grammar transformation accepts normalized form", map[string]any{"type": "grammar_transform", "accepted_answers": []string{"She has gone home."}}, "  SHE   HAS GONE HOME. ", true},
		{"grammar transformation rejects a different conjugation", map[string]any{"type": "grammar_transform", "accepted_answers": []string{"She has gone home."}}, "She have go home.", false},
		{"ordering exact sequence", map[string]any{"type": "ordering", "correct_order": []string{"observe", "model", "test"}}, []any{"observe", "model", "test"}, true},
		{"ordering rejects reversed sequence", map[string]any{"type": "ordering", "correct_order": []string{"observe", "model", "test"}}, []any{"test", "model", "observe"}, false},
		{"matching exact pairs", map[string]any{"type": "matching", "correct_matches": map[string]any{"term": "definition", "example": "application"}}, map[string]any{"example": "application", "term": "definition"}, true},
		{"matching rejects wrong pair", map[string]any{"type": "matching", "correct_matches": map[string]any{"term": "definition", "example": "application"}}, map[string]any{"example": "definition", "term": "application"}, false},
		{"formula normalizes operators and spaces", map[string]any{"type": "formula", "correct_answer": "x*(x+1)"}, "x × (x + 1)", true},
		{"formula can accept equivalent authored forms", map[string]any{"type": "formula", "correct_answer": "a/b", "accepted_answers": []string{"a÷b"}}, " a ÷ b ", true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := evaluateAssessmentAnswer(test.question, test.answer); got != test.correct {
				t.Fatalf("got %v, want %v", got, test.correct)
			}
		})
	}
}

func TestExpandedAssessmentTypesValidateAndKeepAnswerKeysPrivate(t *testing.T) {
	content := map[string]any{"modules": []any{map[string]any{
		"id": "module-one", "objectives": []any{"Apply the idea"},
		"assessment": map[string]any{"questions": []any{
			map[string]any{"id": "fill", "type": "fill_blank", "prompt": "Fill the missing word.", "objective": "Apply the idea", "accepted_answers": []any{"answer"}, "points": float64(1)},
			map[string]any{"id": "listen", "type": "listening", "prompt": "Listen and choose the arrival time.", "objective": "Apply the idea", "audio_text": "The train arrives at noon.", "choices": []any{"At noon", "At two"}, "correct_answer": "At noon", "rationale": "The speaker says noon.", "points": float64(1)},
			map[string]any{"id": "grammar", "type": "grammar_transform", "prompt": "Change the sentence to the present perfect: She goes home.", "objective": "Apply the idea", "accepted_answers": []any{"She has gone home."}, "points": float64(1)},
			map[string]any{"id": "formula", "type": "formula", "prompt": "Enter the simplified expression.", "objective": "Apply the idea", "correct_answer": "x*(x+1)", "accepted_answers": []any{"x^2+x"}, "solution": "x squared plus x", "points": float64(1)},
			map[string]any{"id": "order", "type": "ordering", "prompt": "Order the process.", "objective": "Apply the idea", "items": []any{"observe", "model", "test"}, "correct_order": []any{"observe", "model", "test"}, "points": float64(1)},
			map[string]any{"id": "match", "type": "matching", "prompt": "Match each term.", "objective": "Apply the idea", "left_items": []any{"term", "example"}, "right_items": []any{"definition", "application"}, "correct_matches": map[string]any{"term": "definition", "example": "application"}, "points": float64(1)},
		}},
	}}}
	if err := validateAssessmentQuestions(content, true); err != nil {
		t.Fatalf("valid structured questions were rejected: %v", err)
	}
	public, groups, err := splitCourseAssessments(content)
	if err != nil {
		t.Fatal(err)
	}
	publicQuestions := public["modules"].([]any)[0].(map[string]any)["assessment"].(map[string]any)["questions"].([]any)
	for _, indexAndKey := range []struct {
		index int
		key   string
	}{{0, "accepted_answers"}, {1, "correct_answer"}, {1, "accepted_answers"}, {4, "correct_order"}, {5, "correct_matches"}} {
		question := publicQuestions[indexAndKey.index].(map[string]any)
		if _, leaked := question[indexAndKey.key]; leaked {
			t.Fatalf("public question %q exposed private field %q", question["id"], indexAndKey.key)
		}
	}
	listening := publicQuestions[1].(map[string]any)
	if listening["audio_text"] != "The train arrives at noon." || listening["choices"] == nil {
		t.Fatalf("listening prompt fields were not published: %#v", listening)
	}
	if _, leaked := listening["correct_answer"]; leaked {
		t.Fatal("listening answer key was exposed")
	}
	privateQuestions := groups[0]["questions"].([]map[string]any)
	if _, leaked := publicQuestions[1].(map[string]any)["solution"]; leaked {
		t.Fatal("public question renderer allowed an unknown private field through")
	}
	publicOrder := assessmentStrings(publicQuestions[4].(map[string]any)["items"])
	correctOrder := assessmentStrings(privateQuestions[4]["correct_order"])
	if equalStringOrder(publicOrder, correctOrder) {
		t.Fatal("public ordering items still reveal the answer order")
	}
	if _, exists := privateQuestions[5]["correct_matches"]; !exists {
		t.Fatal("private matching key was not preserved")
	}
	bad := map[string]any{"modules": []any{map[string]any{"objectives": []any{"Apply the idea"}, "assessment": map[string]any{"questions": []any{map[string]any{"id": "broken", "type": "matching", "prompt": "Match.", "objective": "Apply the idea", "left_items": []any{"a", "b"}, "right_items": []any{"x", "y"}, "correct_matches": map[string]any{"a": "x"}, "points": float64(1)}}}}}}
	if err := validateAssessmentQuestions(bad, true); err == nil {
		t.Fatal("incomplete matching key should fail validation")
	}
}

func TestAssessmentKnowledgeUnitReferencesStayWithinModule(t *testing.T) {
	content := map[string]any{"modules": []any{map[string]any{
		"knowledge_unit_ids": []string{"concept-a", "concept-b"},
		"objectives":         []string{"Apply the idea"},
		"assessment": map[string]any{"questions": []any{map[string]any{
			"id": "q1", "type": "true_false", "prompt": "Check the concept.", "objective": "Apply the idea",
			"knowledge_unit_ids": []string{"concept-a"}, "correct_answer": true, "points": float64(1),
		}}},
	}}}
	if err := validateAssessmentQuestions(content, true); err != nil {
		t.Fatalf("valid question concept binding was rejected: %v", err)
	}
	question := content["modules"].([]any)[0].(map[string]any)["assessment"].(map[string]any)["questions"].([]any)[0].(map[string]any)
	question["knowledge_unit_ids"] = []string{"other-module-concept"}
	if err := validateAssessmentQuestions(content, true); err == nil {
		t.Fatal("question binding outside the module must be rejected")
	}
}

func TestCourseAssessmentScoresAnswersAndKeepsKeysPrivate(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "assessment@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	course := createTestRecord(t, app, "courses", map[string]any{"owner": user.Id, "title": "Fractions", "status": "draft"})
	job := createTestRecord(t, app, "learning_jobs", map[string]any{"owner": user.Id, "kind": "course_generation", "status": "queued", "course": course.Id})
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	runCourseGenerationJob(t.Context(), app, job.Id, course.Id, user.Id, course.GetString("title"))
	course, err = app.FindRecordById("courses", course.Id)
	if err != nil {
		t.Fatal(err)
	}
	var publicContent map[string]any
	if err := course.UnmarshalJSONField("content", &publicContent); err != nil {
		t.Fatal(err)
	}
	module := publicContent["modules"].([]any)[0].(map[string]any)
	question := module["assessment"].(map[string]any)["questions"].([]any)[0].(map[string]any)
	if _, leaked := question["correct_answer"]; leaked {
		t.Fatal("published course content exposed its answer key")
	}
	keys, err := app.FindRecordsByFilter("course_assessments", "owner = {:owner} && course = {:course} && version = {:version}", "", 10, 0, dbx.Params{"owner": user.Id, "course": course.Id, "version": course.GetFloat("version")})
	if err != nil || len(keys) != 1 {
		t.Fatalf("private assessment keys missing: %v (%d)", err, len(keys))
	}
	var questions []map[string]any
	if err := keys[0].UnmarshalJSONField("questions", &questions); err != nil {
		t.Fatal(err)
	}
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{
		"owner": user.Id, "title": "Fraction model", "description": "A fraction model shows equal parts.",
		"unit_type": "concept", "metadata": map[string]any{"course_id": course.Id, "outline_unit_id": "assessment-unit", "generated": true},
	})
	questions[0]["knowledge_unit_ids"] = []string{"assessment-unit"}
	keys[0].Set("questions", questions)
	if err := app.Save(keys[0]); err != nil {
		t.Fatal(err)
	}
	answers := map[string]any{"explain-sequence": "Name the parts, explain their relationship, and test an example", "explanation-components": []string{"Identify relevant parts", "Explain how the parts relate"}, "model-test": true}
	if _, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = {:type}", "", 0, 0, dbx.Params{"owner": user.Id, "unit": "assessment:" + course.Id, "type": "module_assessment"}); err != nil {
		t.Fatalf("assessment retry filter failed: %v", err)
	}
	body, _ := json.Marshal(map[string]any{"answers": answers, "request_id": "offline-attempt-001"})
	request := httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/assess", strings.NewReader(string(body)))
	request.SetPathValue("id", course.Id)
	recorder := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: recorder}}
	if err := assessCourseRoute(event); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["score"] != float64(1) {
		t.Fatalf("expected exact answers to score 1, got %#v", result)
	}
	firstEvidenceID := result["evidence_id"]
	request = httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/assess", strings.NewReader(string(body)))
	request.SetPathValue("id", course.Id)
	recorder = httptest.NewRecorder()
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: recorder}}
	if err := assessCourseRoute(event); err != nil {
		t.Fatal(err)
	}
	var retryResult map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &retryResult); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK || retryResult["evidence_id"] != firstEvidenceID {
		t.Fatalf("retry must return the original assessment result: status=%d result=%#v", recorder.Code, retryResult)
	}
	attemptEvidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = 'module_assessment'", "", 10, 0, dbx.Params{"owner": user.Id, "unit": "assessment:" + course.Id})
	if err != nil || len(attemptEvidence) != 1 {
		t.Fatalf("offline retry should create one evidence record: count=%d err=%v", len(attemptEvidence), err)
	}
	unitEvidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = {:type}", "", 10, 0, dbx.Params{"owner": user.Id, "unit": unit.Id, "type": "module_assessment"})
	if err != nil || len(unitEvidence) != 1 {
		t.Fatalf("assessment should record evidence for its linked knowledge unit: count=%d err=%v", len(unitEvidence), err)
	}
	mastery, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner} && unit = {:unit}", "", 1, 0, dbx.Params{"owner": user.Id, "unit": unit.Id})
	if err != nil || len(mastery) != 1 || mastery[0].GetFloat("mastery") <= 0 {
		t.Fatalf("assessment should update mastery for its linked knowledge unit: records=%d err=%v", len(mastery), err)
	}
	other := createTestRecord(t, app, "users", map[string]any{"email": "assessment-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	request = httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/assess", strings.NewReader(string(body)))
	request.SetPathValue("id", course.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	err = assessCourseRoute(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 404 {
		t.Fatalf("foreign assessment must be hidden: %v", err)
	}
	request = httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/assess", strings.NewReader(`{"answers":{"explain-sequence":"wrong"}}`))
	request.SetPathValue("id", course.Id)
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := assessCourseRoute(event); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/assess", strings.NewReader(`{"answers":{"unknown-question":"answer"}}`))
	request.SetPathValue("id", course.Id)
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	err = assessCourseRoute(event)
	apiErr, ok = err.(*router.ApiError)
	if !ok || apiErr.Status != 400 {
		t.Fatalf("unknown question IDs must be rejected: %v", err)
	}
}

func TestCourseVersionRestoreCopiesPrivateAssessmentKeys(t *testing.T) {
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "assessment-restore@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	course := createTestRecord(t, app, "courses", map[string]any{"owner": user.Id, "title": "Fractions"})
	for i := 0; i < 2; i++ {
		job := createTestRecord(t, app, "learning_jobs", map[string]any{"owner": user.Id, "kind": "course_generation", "status": "queued", "course": course.Id})
		runCourseGenerationJob(t.Context(), app, job.Id, course.Id, user.Id, course.GetString("title"))
	}
	versionsBefore, versionErr := app.FindRecordsByFilter("course_versions", "owner = {:owner} && course = {:course}", "", 0, 0, dbx.Params{"owner": user.Id, "course": course.Id})
	if versionErr != nil || len(versionsBefore) == 0 {
		t.Fatalf("expected course snapshot: %v (%d)", versionErr, len(versionsBefore))
	}
	request := httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/versions/1/restore", strings.NewReader(`{}`))
	request.SetPathValue("id", course.Id)
	request.SetPathValue("version", "1")
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := restoreCourseVersionRoute(event); err != nil {
		t.Fatal(err)
	}
	current, err := app.FindRecordById("courses", course.Id)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := app.FindRecordsByFilter("course_assessments", "owner = {:owner} && course = {:course} && version = {:version}", "", 10, 0, dbx.Params{"owner": user.Id, "course": course.Id, "version": current.GetFloat("version")})
	if err != nil || len(keys) != 1 {
		t.Fatalf("restored version lost its private answer keys: %v (%d)", err, len(keys))
	}
}

func TestManualCourseWritesKeepAnswerKeysPrivateAndVersionEdits(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "manual-assessment@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	content, _ := json.Marshal(fixtureCourseContent("Fractions"))
	request := httptest.NewRequest("POST", "/api/learning/courses", strings.NewReader(`{"title":"Manual course","content":`+string(content)+`}`))
	createResponse := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: createResponse}}
	if err := createLearningRoute("courses")(event); err != nil {
		t.Fatal(err)
	}
	var created map[string]any
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	courseID, _ := created["id"].(string)
	if courseID == "" || created["version"] != float64(1) {
		t.Fatalf("manual assessed course was not published as version 1: %#v", created)
	}
	contentRecord := created["content"].(map[string]any)
	module := contentRecord["modules"].([]any)[0].(map[string]any)
	question := module["assessment"].(map[string]any)["questions"].([]any)[0].(map[string]any)
	if _, leaked := question["correct_answer"]; leaked {
		t.Fatal("manual course creation exposed its answer key")
	}
	request = httptest.NewRequest("PATCH", "/api/learning/courses/"+courseID, strings.NewReader(`{"title":"Edited course","content":`+string(content)+`}`))
	request.SetPathValue("id", courseID)
	updateResponse := httptest.NewRecorder()
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: updateResponse}}
	if err := updateLearningRoute("courses")(event); err != nil {
		t.Fatal(err)
	}
	updated, err := app.FindRecordById("courses", courseID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetFloat("version") != 2 || updated.GetString("title") != "Edited course" {
		t.Fatalf("course edit did not create version 2: version=%v title=%q", updated.GetFloat("version"), updated.GetString("title"))
	}
	history, err := app.FindRecordsByFilter("course_versions", "owner = {:owner} && course = {:course} && version = 1", "", 1, 0, dbx.Params{"owner": user.Id, "course": courseID})
	if err != nil || len(history) != 1 {
		t.Fatalf("course edit did not preserve version 1: %v (%d)", err, len(history))
	}
	keys, err := app.FindRecordsByFilter("course_assessments", "owner = {:owner} && course = {:course} && version = 2", "", 10, 0, dbx.Params{"owner": user.Id, "course": courseID})
	if err != nil || len(keys) != 1 {
		t.Fatalf("course edit did not save private answer keys: %v (%d)", err, len(keys))
	}
}

func TestGeneratedCourseAcceptsRegisteredWidgetTypes(t *testing.T) {
	for _, kind := range []string{"explanation", "model", "reflection", "number_line", "binary_explorer", "matching", "timeline", "function_plotter", "vector_visualizer", "logic_gates", "algorithm_step_visualizer", "probability_simulation", "state_machine_visualizer", "classification"} {
		widget := map[string]any{"type": kind}
		switch kind {
		case "vector_visualizer":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"vector_x": float64(3), "vector_y": float64(4), "axis_limit": float64(5)}
		case "logic_gates":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"gate": "AND"}
		case "algorithm_step_visualizer":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"items": []any{float64(1), float64(2), float64(3)}, "target": float64(2)}
		case "probability_simulation":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"experiment": "coin_flip", "trials": float64(40), "seed": float64(17)}
		case "state_machine_visualizer":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"states": []any{"even", "odd"}, "initial_state": "even", "transitions": []any{map[string]any{"from": "even", "input": "1", "to": "odd"}, map[string]any{"from": "odd", "input": "1", "to": "even"}}}
		case "classification":
			widget["version"] = float64(1)
			widget["config"] = map[string]any{"categories": []any{map[string]any{"name": "Mammal"}, map[string]any{"name": "Bird"}}, "classify_items": []any{map[string]any{"label": "Whale", "category": "Mammal"}, map[string]any{"label": "Robin", "category": "Bird"}, map[string]any{"label": "Bat", "category": "Mammal"}}}
		}
		content := map[string]any{"modules": []any{map[string]any{"scenes": []any{map[string]any{"id": "scene-1", "title": "Scene", "duration_seconds": float64(30), "widget": widget}}}}}
		if err := validateGeneratedCourse(content); err != nil {
			t.Errorf("registered widget %q rejected: %v", kind, err)
		}
	}
}

func TestScienceAndLearningWidgetConfigsAreStrictAndBounded(t *testing.T) {
	valid := []map[string]any{
		{"type": "probability_simulation", "version": float64(1), "config": map[string]any{"experiment": "die_roll", "trials": float64(100), "seed": float64(42)}},
		{"type": "state_machine_visualizer", "version": float64(1), "config": map[string]any{"states": []any{"ready", "done"}, "initial_state": "ready", "transitions": []any{map[string]any{"from": "ready", "input": "finish", "to": "done"}}}},
		{"type": "classification", "version": float64(1), "config": map[string]any{"categories": []any{map[string]any{"name": "Solid", "description": "Fixed shape"}, map[string]any{"name": "Liquid"}}, "classify_items": []any{map[string]any{"label": "Ice", "category": "Solid"}, map[string]any{"label": "Water", "category": "Liquid"}, map[string]any{"label": "Steam", "category": "Liquid"}}}},
	}
	for _, widget := range valid {
		if err := validateWidgetConfig(widget["type"].(string), widget); err != nil {
			t.Errorf("valid %s config rejected: %v", widget["type"], err)
		}
	}
	invalid := []map[string]any{
		{"type": "probability_simulation", "version": float64(1), "config": map[string]any{"experiment": "coin_flip", "trials": float64(9), "seed": float64(42)}},
		{"type": "probability_simulation", "version": float64(1), "config": map[string]any{"experiment": "coin_flip", "trials": float64(100), "seed": float64(42), "code": "bad"}},
		{"type": "state_machine_visualizer", "version": float64(1), "config": map[string]any{"states": []any{"ready", "done"}, "initial_state": "missing", "transitions": []any{map[string]any{"from": "ready", "input": "finish", "to": "done"}}}},
		{"type": "state_machine_visualizer", "version": float64(1), "config": map[string]any{"states": []any{"ready", "done"}, "initial_state": "ready", "transitions": []any{map[string]any{"from": "ready", "input": "x", "to": "done"}, map[string]any{"from": "ready", "input": "x", "to": "ready"}}}},
		{"type": "classification", "version": float64(1), "config": map[string]any{"categories": []any{map[string]any{"name": "Solid"}, map[string]any{"name": "Liquid"}}, "classify_items": []any{map[string]any{"label": "Ice", "category": "Other"}, map[string]any{"label": "Water", "category": "Liquid"}, map[string]any{"label": "Steam", "category": "Liquid"}}}},
	}
	for _, widget := range invalid {
		if err := validateWidgetConfig(widget["type"].(string), widget); err == nil {
			t.Errorf("invalid %s config accepted: %#v", widget["type"], widget)
		}
	}
}

func TestTrustedInteractiveWidgetConfigsAreStrictAndBounded(t *testing.T) {
	valid := []map[string]any{
		{"type": "vector_visualizer", "version": float64(1), "config": map[string]any{"vector_x": float64(3), "vector_y": float64(-4), "axis_limit": float64(5)}},
		{"type": "logic_gates", "version": float64(1), "config": map[string]any{"gate": "XOR"}},
		{"type": "algorithm_step_visualizer", "version": float64(1), "config": map[string]any{"items": []any{float64(2), float64(5), float64(8)}, "target": float64(5)}},
	}
	for _, widget := range valid {
		if err := validateWidgetConfig(widget["type"].(string), widget); err != nil {
			t.Errorf("valid %s config rejected: %v", widget["type"], err)
		}
	}
	invalid := []map[string]any{
		{"type": "vector_visualizer", "version": float64(2), "config": map[string]any{"vector_x": float64(3), "vector_y": float64(4), "axis_limit": float64(5)}},
		{"type": "vector_visualizer", "version": float64(1), "config": map[string]any{"vector_x": float64(8), "vector_y": float64(4), "axis_limit": float64(5)}},
		{"type": "vector_visualizer", "version": float64(1), "config": map[string]any{"vector_x": float64(3), "vector_y": float64(4), "axis_limit": float64(5), "callback": "evil"}},
		{"type": "logic_gates", "version": float64(1), "config": map[string]any{"gate": "CUSTOM"}},
		{"type": "algorithm_step_visualizer", "version": float64(1), "config": map[string]any{"items": []any{float64(2), float64(8), float64(5)}, "target": float64(5)}},
		{"type": "algorithm_step_visualizer", "version": float64(1), "config": map[string]any{"items": []any{float64(2), float64(5)}, "target": float64(5)}},
	}
	for _, widget := range invalid {
		if err := validateWidgetConfig(widget["type"].(string), widget); err == nil {
			t.Errorf("invalid %s config accepted: %#v", widget["type"], widget)
		}
	}
}

func TestLearningListAndDetailAreOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	first := createTestRecord(t, app, "users", map[string]any{"email": "first@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	second := createTestRecord(t, app, "users", map[string]any{"email": "second@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	owned := createTestRecord(t, app, "courses", map[string]any{"owner": first.Id, "title": "Owned course"})
	_, queryErr := app.FindRecordsByFilter("courses", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": first.Id})
	if queryErr != nil {
		t.Fatalf("query: %v", queryErr)
	}
	createTestRecord(t, app, "courses", map[string]any{"owner": second.Id, "title": "Private course"})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/api/learning/courses", nil)
	event := &core.RequestEvent{App: app, Auth: first, Event: router.Event{Request: request, Response: recorder}}
	if err := listLearningRoute("courses")(event); err != nil {
		t.Fatalf("%#v", err)
	}
	var listed []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0]["id"] != owned.Id {
		t.Fatalf("list leaked or omitted courses: %#v", listed)
	}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest("GET", "/api/learning/courses/"+owned.Id, nil)
	request.SetPathValue("id", owned.Id)
	event = &core.RequestEvent{App: app, Auth: second, Event: router.Event{Request: request, Response: recorder}}
	err = getLearningRoute("courses")(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 404 {
		t.Fatalf("other user's course should be hidden; err=%v", err)
	}
}

func TestKnowledgeEvidenceHistoryIsOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "evidence-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "evidence-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Cell division", "unit_type": "concept"})
	createTestRecord(t, app, "learner_evidence", map[string]any{"owner": owner.Id, "unit": unit.Id, "evidence_type": "assessment", "score": 0.75, "details": map[string]any{"question": "Which stage?"}})
	request := httptest.NewRequest(http.MethodGet, "/api/learning/knowledge-units/"+unit.Id+"/evidence", nil)
	request.SetPathValue("id", unit.Id)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := listKnowledgeEvidenceRoute(event); err != nil {
		t.Fatal(err)
	}
	var result []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result[0]["owner"] != nil || result[0]["evidence_type"] != "assessment" {
		t.Fatalf("unexpected evidence history: %#v", result)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/learning/knowledge-units/"+unit.Id+"/evidence", nil)
	request.SetPathValue("id", unit.Id)
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := listKnowledgeEvidenceRoute(event); err == nil {
		t.Fatal("another user's evidence should not be readable")
	}
}

func TestCourseProgressPersistsAndIsOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	first := createTestRecord(t, app, "users", map[string]any{"email": "progress-a@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	second := createTestRecord(t, app, "users", map[string]any{"email": "progress-b@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	course := createTestRecord(t, app, "courses", map[string]any{"owner": first.Id, "title": "Progress", "content": fixtureCourseContent("Progress")})
	if _, queryErr := app.FindRecordsByFilter("course_progress", "owner = {:owner} && course = {:course}", "", 1, 0, dbx.Params{"owner": first.Id, "course": course.Id}); queryErr != nil {
		t.Fatalf("preflight query course_progress: %v", queryErr)
	}
	request := httptest.NewRequest("PUT", "/api/learning/courses/"+course.Id+"/progress", strings.NewReader(`{"scene_index":1,"position_seconds":12.5,"completed":false}`))
	request.SetPathValue("id", course.Id)
	event := &core.RequestEvent{App: app, Auth: first, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := saveCourseProgressRoute(event); err != nil {
		t.Fatalf("save progress failed: %#v", err)
	}
	request = httptest.NewRequest("PUT", "/api/learning/courses/"+course.Id+"/progress", strings.NewReader(`{"scene_index":1,"position_seconds":72.5,"completed":false}`))
	request.SetPathValue("id", course.Id)
	event = &core.RequestEvent{App: app, Auth: first, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := saveCourseProgressRoute(event); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest("GET", "/api/learning/courses/"+course.Id+"/progress", nil)
	request.SetPathValue("id", course.Id)
	recorder := httptest.NewRecorder()
	event = &core.RequestEvent{App: app, Auth: first, Event: router.Event{Request: request, Response: recorder}}
	if err := getCourseProgressRoute(event); err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved["scene_index"] != float64(1) || saved["position_seconds"] != 72.5 {
		t.Fatalf("progress did not resume at saved position: %#v", saved)
	}
	progressRecords, findErr := app.FindRecordsByFilter("course_progress", "owner = {:owner} && course = {:course}", "", 0, 0, dbx.Params{"owner": first.Id, "course": course.Id})
	if findErr != nil || len(progressRecords) != 1 {
		t.Fatalf("progress should upsert one row: %v (%d)", findErr, len(progressRecords))
	}
	request = httptest.NewRequest("GET", "/api/learning/courses/"+course.Id+"/progress", nil)
	request.SetPathValue("id", course.Id)
	event = &core.RequestEvent{App: app, Auth: second, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	err = getCourseProgressRoute(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 404 {
		t.Fatalf("another user must not read course progress: %v", err)
	}
}

func TestImportSourceCreatesProvenanceAndDeleteCleansDependents(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "source@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/learning/sources", strings.NewReader(`{"title":"Cell notes","content":"Cells store information.","source_type":"text/markdown"}`))
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: recorder}}
	if err := importLearningSourceRoute(event); err != nil {
		t.Fatal(err)
	}
	sources, err := app.FindRecordsByFilter("learning_sources", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil || len(sources) != 1 {
		t.Fatalf("source was not saved: %v (%d)", err, len(sources))
	}
	units, err := app.FindRecordsByFilter("knowledge_units", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil || len(units) != 1 {
		t.Fatalf("linked concept missing: %v (%d)", err, len(units))
	}
	var meta map[string]any
	if err := units[0].UnmarshalJSONField("metadata", &meta); err != nil {
		t.Fatal(err)
	}
	if meta["source_id"] != sources[0].Id {
		t.Fatalf("missing provenance: %#v", meta)
	}
	createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": user.Id, "unit": units[0].Id, "mastery": 0.5})
	job := createTestRecord(t, app, "learning_jobs", map[string]any{"owner": user.Id, "kind": "course_generation", "status": "completed", "payload": map[string]any{"generation_context": map[string]any{"sources": []any{map[string]any{"id": sources[0].Id, "content": "Cells store information."}}, "concepts": []any{map[string]any{"id": units[0].Id, "description": "Cells store information."}}, "weak_concepts": []any{map[string]any{"id": units[0].Id, "title": "Cell theory"}}}}})
	episode := createTestRecord(t, app, "podcast_episodes", map[string]any{"owner": user.Id, "title": "Cell notes", "topic": "Cell information", "status": "ready", "source_ids": []string{sources[0].Id}, "concept_ids": []string{units[0].Id}, "outline": map[string]any{"title": "Cell notes"}, "transcript": map[string]any{"turns": []any{}}})
	request = httptest.NewRequest("DELETE", "/api/learning/sources/"+sources[0].Id, nil)
	request.SetPathValue("id", sources[0].Id)
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := deleteLearningSourceRoute(event); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("learning_sources", sources[0].Id); err == nil {
		t.Fatal("source still exists")
	}
	if _, err := app.FindRecordById("knowledge_units", units[0].Id); err == nil {
		t.Fatal("source-derived concept still exists")
	}
	job, err = app.FindRecordById("learning_jobs", job.Id)
	if err != nil {
		t.Fatal(err)
	}
	var jobPayload map[string]any
	if err := job.UnmarshalJSONField("payload", &jobPayload); err != nil {
		t.Fatal(err)
	}
	jobContext := jobPayload["generation_context"].(map[string]any)
	if len(contextRows(jobContext["sources"])) != 0 || len(contextRows(jobContext["concepts"])) != 0 || len(contextRows(jobContext["weak_concepts"])) != 0 {
		t.Fatalf("deleted source content remained in a generation job: %#v", jobContext)
	}
	if _, err := app.FindRecordById("podcast_episodes", episode.Id); err == nil {
		t.Fatal("source-derived podcast episode still exists")
	}
	remaining, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil || len(remaining) != 0 {
		t.Fatalf("dependent mastery was not removed: %v (%d)", err, len(remaining))
	}
}

func TestKnowledgeEdgeRejectsAnotherUsersConcept(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "edge-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "edge-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	from := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "A", "unit_type": "concept"})
	to := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": other.Id, "title": "B", "unit_type": "concept"})
	request := httptest.NewRequest("POST", "/api/learning/edges", strings.NewReader(`{"from_unit":"`+from.Id+`","to_unit":"`+to.Id+`","relationship":"requires"}`))
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	err = createKnowledgeEdgeRoute(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 400 {
		t.Fatalf("cross-user edge should be rejected: %v", err)
	}
}

func TestVocabularySetCreatesSharedKnowledgeUnits(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "vocab@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	request := httptest.NewRequest("POST", "/api/languages/vocabulary", strings.NewReader(`{"language":"Spanish","set_name":"Travel","words":[{"term":"hola","translation":"hello","example_sentence":"Hola, buenos días."},{"term":"gracias","translation":"thank you"}]}`))
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createVocabularyRoute(event); err != nil {
		t.Fatal(err)
	}
	records, err := app.FindRecordsByFilter("knowledge_units", "owner = {:owner} && unit_type = {:type}", "", 0, 0, dbx.Params{"owner": user.Id, "type": "vocabulary"})
	if err != nil || len(records) != 2 {
		t.Fatalf("expected two shared vocabulary units: %v (%d)", err, len(records))
	}
	var metadata map[string]any
	if err := records[0].UnmarshalJSONField("metadata", &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["language"] != "Spanish" || metadata["set_name"] != "Travel" || metadata["example_sentence"] != "Hola, buenos días." {
		t.Fatalf("vocabulary provenance missing: %#v", metadata)
	}
}

func TestVocabularyContextAndListeningAttemptsRecordOwnedEvidence(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "language-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "language-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "bonjour", "unit_type": "vocabulary", "metadata": map[string]any{"language": "French", "example_sentence": "Bonjour, madame."}})
	for _, test := range []struct{ mode, answer, evidenceType string }{
		{"listening", " BONJOUR! ", "vocabulary_listening_attempt"},
		{"context", "Je dis bonjour à mon voisin.", "vocabulary_context_attempt"},
		{"context", "Je dis merci à mon voisin.", "vocabulary_context_attempt"},
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/languages/vocabulary/"+unit.Id+"/context-attempt", strings.NewReader(`{"mode":"`+test.mode+`","answer":"`+test.answer+`"}`))
		request.SetPathValue("id", unit.Id)
		response := httptest.NewRecorder()
		event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
		if err := submitVocabularyContextAttemptRoute(event); err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		wantCorrect := !strings.Contains(test.answer, "merci")
		if result["correct"] != wantCorrect || result["example_sentence"] != "Bonjour, madame." {
			t.Fatalf("unexpected %s result: %#v", test.mode, result)
		}
		evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit} && evidence_type = {:type}", "", 10, 0, dbx.Params{"owner": owner.Id, "unit": unit.Id, "type": test.evidenceType})
		found := false
		for _, record := range evidence {
			var details map[string]any
			if err := record.UnmarshalJSONField("details", &details); err == nil && details["answer"] == strings.TrimSpace(test.answer) {
				found = record.GetFloat("score") == map[bool]float64{true: 1, false: 0}[wantCorrect]
			}
		}
		if err != nil || !found {
			t.Fatalf("unexpected %s evidence: count=%d err=%v", test.evidenceType, len(evidence), err)
		}
	}
	foreignRequest := httptest.NewRequest(http.MethodPost, "/api/languages/vocabulary/"+unit.Id+"/context-attempt", strings.NewReader(`{"mode":"listening","answer":"bonjour"}`))
	foreignRequest.SetPathValue("id", unit.Id)
	foreignEvent := &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: foreignRequest, Response: httptest.NewRecorder()}}
	if err := submitVocabularyContextAttemptRoute(foreignEvent); err == nil {
		t.Fatal("other user's vocabulary should not be available")
	}
}

func TestNextReviewScheduleUsesRecallQuality(t *testing.T) {
	interval, ease, reps, mastery := nextReviewSchedule(0, 2.5, 0, 0.4, 4)
	if interval != 1 || reps != 1 || ease != 2.5 || mastery <= 0.4 {
		t.Fatalf("first success schedule: %v %v %d %v", interval, ease, reps, mastery)
	}
	interval, ease, reps, mastery = nextReviewSchedule(interval, ease, reps, mastery, 5)
	if interval != 6 || reps != 2 {
		t.Fatalf("second success schedule: interval=%v repetitions=%d", interval, reps)
	}
	interval, ease, reps, mastery = nextReviewSchedule(interval, ease, reps, mastery, 2)
	if interval != 1 || reps != 0 || ease >= 2.5 || mastery >= 0.5 {
		t.Fatalf("failed recall should reset interval and lower mastery: %v %v %d %v", interval, ease, reps, mastery)
	}
}

func TestGrammarAnswerRecordsDeterministicEvidence(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "grammar@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": user.Id, "title": "She ___ to school.", "unit_type": "grammar", "metadata": map[string]any{"language": "English", "answer": "goes", "explanation": "Third-person singular uses -s."}})
	request := httptest.NewRequest("POST", "/api/languages/grammar/"+unit.Id+"/answer", strings.NewReader(`{"answer":"Goes."}`))
	request.SetPathValue("id", unit.Id)
	recorder := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: recorder}}
	if err := answerGrammarRoute(event); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Correct bool `json:"correct"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Correct {
		t.Fatal("case/punctuation-normalized correct answer was rejected")
	}
	evidence, err := app.FindRecordsByFilter("learner_evidence", "owner = {:owner} && unit = {:unit}", "", 0, 0, dbx.Params{"owner": user.Id, "unit": unit.Id})
	if err != nil || len(evidence) != 1 || evidence[0].GetFloat("score") != 1 {
		t.Fatalf("grammar evidence not saved: %v", err)
	}
}

func TestImportCourseValidatesAndCreatesOwnedCourse(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "import-course@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	payload := `{"format":"starburst-course","format_version":1,"course":{"title":"Imported","description":"Test","content":{"modules":[{"scenes":[{"id":"scene-1","title":"Scene","duration_seconds":30,"widget":{"type":"explanation"}}]}]}}}`
	request := httptest.NewRequest("POST", "/api/learning/courses/import", strings.NewReader(payload))
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := importCourseRoute(event); err != nil {
		t.Fatal(err)
	}
	records, err := app.FindRecordsByFilter("courses", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil || len(records) != 1 {
		t.Fatalf("course import did not create an owned record: %v (%d)", err, len(records))
	}
	request = httptest.NewRequest("POST", "/api/learning/courses/import", strings.NewReader(strings.Replace(payload, `"explanation"`, `"arbitrary_code"`, 1)))
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	err = importCourseRoute(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 400 {
		t.Fatalf("unregistered widget should be rejected: %v", err)
	}
}

func TestCourseExportRoundTripsResumeProgress(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "course-progress-export@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Equivalent fractions", "description": "Equal values can have different forms.", "unit_type": "concept", "metadata": map[string]any{"generated": true}})
	unit2 := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Common denominator", "description": "A shared denominator helps compare fractions.", "unit_type": "concept"})
	content := map[string]any{"version": 1, "modules": []any{map[string]any{"id": "module-1", "title": "Fractions", "objectives": []string{"Compare values"}, "knowledge_unit_ids": []string{unit.Id, unit2.Id}, "scenes": []any{map[string]any{"id": "scene-1", "title": "Compare", "duration_seconds": 30, "widget": map[string]any{"type": "explanation", "version": 1, "config": map[string]any{"body": "Compare equal values."}}}}}}}
	course := createTestRecord(t, app, "courses", map[string]any{"owner": owner.Id, "title": "Progress course", "description": "resume me", "status": "published", "version": 1, "content": content})
	createTestRecord(t, app, "course_progress", map[string]any{"owner": owner.Id, "course": course.Id, "scene_index": 2, "position_seconds": 18.5, "completed": false})
	createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": owner.Id, "unit": unit.Id, "mastery": 0.7, "confidence": 0.6, "review_interval_days": 3, "ease_factor": 2.4, "repetitions": 2})
	createTestRecord(t, app, "knowledge_edges", map[string]any{"owner": owner.Id, "from_unit": unit.Id, "to_unit": unit2.Id, "relationship": "builds_on"})
	exportRequest := httptest.NewRequest("GET", "/api/learning/courses/"+course.Id+"/export", nil)
	exportRequest.SetPathValue("id", course.Id)
	exportResponse := httptest.NewRecorder()
	if err := exportCourseRoute(&core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: exportRequest, Response: exportResponse}}); err != nil {
		t.Fatal(err)
	}
	var export map[string]any
	if err := json.Unmarshal(exportResponse.Body.Bytes(), &export); err != nil {
		t.Fatal(err)
	}
	if export["format_version"] != float64(2) || export["progress"].(map[string]any)["scene_index"] != float64(2) || len(export["knowledge_units"].([]any)) != 2 || len(export["knowledge_edges"].([]any)) != 1 {
		t.Fatalf("course export omitted progress: %#v", export)
	}
	importRequest := httptest.NewRequest("POST", "/api/learning/courses/import", bytes.NewReader(exportResponse.Body.Bytes()))
	importResponse := httptest.NewRecorder()
	if err := importCourseRoute(&core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: importRequest, Response: importResponse}}); err != nil {
		t.Fatal(err)
	}
	var imported map[string]any
	if err := json.Unmarshal(importResponse.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	importedCourse := imported["id"].(string)
	progress, err := app.FindRecordsByFilter("course_progress", "owner = {:owner} && course = {:course}", "", 1, 0, dbx.Params{"owner": owner.Id, "course": importedCourse})
	if err != nil || len(progress) != 1 || progress[0].GetInt("scene_index") != 2 || progress[0].GetFloat("position_seconds") != 18.5 {
		t.Fatalf("progress did not round trip: %v (%v)", err, progress)
	}
	importedRecord, err := app.FindRecordById("courses", importedCourse)
	if err != nil {
		t.Fatal(err)
	}
	var importedContent map[string]any
	if err := importedRecord.UnmarshalJSONField("content", &importedContent); err != nil {
		t.Fatal(err)
	}
	importedModule := importedContent["modules"].([]any)[0].(map[string]any)
	importedUnitID := assessmentStrings(importedModule["knowledge_unit_ids"])[0]
	if importedUnitID == unit.Id {
		t.Fatal("course import reused the source knowledge ID")
	}
	importedUnits, err := app.FindRecordsByFilter("knowledge_units", "owner = {:owner} && id = {:id}", "", 1, 0, dbx.Params{"owner": owner.Id, "id": importedUnitID})
	if err != nil || len(importedUnits) != 1 || importedUnits[0].GetString("title") != "Equivalent fractions" {
		t.Fatalf("linked knowledge did not import: %v (%d)", err, len(importedUnits))
	}
	importedMastery, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner} && unit = {:unit}", "", 1, 0, dbx.Params{"owner": owner.Id, "unit": importedUnitID})
	if err != nil || len(importedMastery) != 1 || importedMastery[0].GetFloat("mastery") != 0.7 {
		t.Fatalf("linked mastery did not import: %v (%d)", err, len(importedMastery))
	}
	importedEdges, err := app.FindRecordsByFilter("knowledge_edges", "owner = {:owner} && from_unit = {:from} && to_unit = {:to}", "", 1, 0, dbx.Params{"owner": owner.Id, "from": importedUnitID, "to": assessmentStrings(importedModule["knowledge_unit_ids"])[1]})
	if err != nil || len(importedEdges) != 1 || importedEdges[0].GetString("relationship") != "builds_on" {
		t.Fatalf("linked relationship did not import: %v (%d)", err, len(importedEdges))
	}
}

func TestLearningArchiveExportIsOwnerScoped(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	first := createTestRecord(t, app, "users", map[string]any{"email": "archive-a@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	second := createTestRecord(t, app, "users", map[string]any{"email": "archive-b@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	own := createTestRecord(t, app, "courses", map[string]any{"owner": first.Id, "title": "Mine"})
	createTestRecord(t, app, "courses", map[string]any{"owner": second.Id, "title": "Not mine"})
	createTestRecord(t, app, "podcast_episodes", map[string]any{"owner": first.Id, "title": "My episode", "topic": "Learning", "status": "ready", "source_ids": []string{}, "concept_ids": []string{}, "outline": map[string]any{}, "transcript": map[string]any{}})
	createTestRecord(t, app, "podcast_episodes", map[string]any{"owner": second.Id, "title": "Not my episode", "topic": "Learning", "status": "ready", "source_ids": []string{}, "concept_ids": []string{}, "outline": map[string]any{}, "transcript": map[string]any{}})
	preferences := defaultUserPreferences()
	preferences.LearningGoals = []string{"Learn more"}
	first.Set("preferences", preferences)
	if err := app.Save(first); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: first, Event: router.Event{Request: httptest.NewRequest("GET", "/api/account/learning-export", nil), Response: recorder}}
	if err := exportLearningDataRoute(event); err != nil {
		t.Fatal(err)
	}
	var archive map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &archive); err != nil {
		t.Fatal(err)
	}
	courses, ok := archive["courses"].([]any)
	if !ok || len(courses) != 1 || courses[0].(map[string]any)["id"] != own.Id {
		t.Fatalf("archive leaked or omitted course data: %#v", archive["courses"])
	}
	if archive["format"] != "starburst-learning-archive" {
		t.Fatalf("unexpected archive format: %#v", archive["format"])
	}
	podcasts, ok := archive["podcast_episodes"].([]any)
	if !ok || len(podcasts) != 1 || podcasts[0].(map[string]any)["title"] != "My episode" {
		t.Fatalf("archive leaked or omitted podcast data: %#v", archive["podcast_episodes"])
	}
	exportedPreferences, ok := archive["preferences"].(map[string]any)
	if !ok || len(exportedPreferences["learningGoals"].([]any)) != 1 {
		t.Fatalf("archive omitted account preferences: %#v", archive["preferences"])
	}
}

func TestLearningArchiveZipRoundTripsPodcastWAV(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-wav@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "archive-wav-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	outline := fixturePodcastScript("Archive audio", "portable WAV", podcastContext{})
	transcript := fixturePodcastTranscript("Archive audio", "portable WAV", podcastContext{})
	episode, err := savePodcastEpisode(app, user.Id, podcastCreateBody{Title: "Archive audio", Topic: "portable WAV"}, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	wav := testPCM16WAV()
	file, err := filesystem.NewFileFromBytes(wav, "episode.wav")
	if err != nil {
		t.Fatal(err)
	}
	episode.Set("audio", file)
	episode.Set("audio_metadata", map[string]any{"format": "audio/wav", "bytes": len(wav)})
	if err := app.Save(episode); err != nil {
		t.Fatal(err)
	}
	otherEpisode, err := savePodcastEpisode(app, other.Id, podcastCreateBody{Title: "Private audio", Topic: "not exportable"}, fixturePodcastScript("Private audio", "not exportable", podcastContext{}), fixturePodcastTranscript("Private audio", "not exportable", podcastContext{}))
	if err != nil {
		t.Fatal(err)
	}
	otherFile, err := filesystem.NewFileFromBytes(wav, "episode.wav")
	if err != nil {
		t.Fatal(err)
	}
	otherEpisode.Set("audio", otherFile)
	if err := app.Save(otherEpisode); err != nil {
		t.Fatal(err)
	}
	course := createTestRecord(t, app, "courses", map[string]any{"owner": user.Id, "title": "Narrated lesson", "description": "Archive narration", "status": "published", "version": 1, "content": map[string]any{"version": 1, "modules": []any{map[string]any{"scenes": []any{map[string]any{"id": "scene-1", "title": "Scene", "duration_seconds": 30, "widget": map[string]any{"type": "explanation"}}}}}}})
	narration, err := app.FindCollectionByNameOrId("lesson_narrations")
	if err != nil {
		t.Fatal(err)
	}
	narrationRecord := core.NewRecord(narration)
	narrationRecord.Set("owner", user.Id)
	narrationRecord.Set("course", course.Id)
	narrationRecord.Set("version", 1)
	narrationRecord.Set("scene_id", "scene-1")
	narrationRecord.Set("text_hash", strings.Repeat("a", 64))
	narrationRecord.Set("voice", "en_US-test-medium")
	narrationRecord.Set("speaker", "speaker-1")
	narrationFile, err := filesystem.NewFileFromBytes(wav, "narration.wav")
	if err != nil {
		t.Fatal(err)
	}
	narrationRecord.Set("audio", narrationFile)
	narrationRecord.Set("audio_metadata", map[string]any{"format": "audio/wav", "bytes": len(wav)})
	if err := app.Save(narrationRecord); err != nil {
		t.Fatal(err)
	}
	exportResponse := httptest.NewRecorder()
	exportEvent := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest(http.MethodGet, "/api/account/learning-export/archive", nil), Response: exportResponse}}
	if err := exportLearningArchiveZipRoute(exportEvent); err != nil {
		t.Fatalf("archive export failed: %v", err)
	}
	if exportResponse.Code != http.StatusOK || exportResponse.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("unexpected export response: %d %q", exportResponse.Code, exportResponse.Header().Get("Content-Type"))
	}
	manifestBytes, files, isZip, err := decodeLearningArchiveContainer(exportResponse.Body.Bytes())
	if err != nil || !isZip {
		t.Fatalf("export was not a readable ZIP: isZip=%v err=%v", isZip, err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest["format_version"] != float64(2) || len(files) != 2 || !bytes.Equal(files["media/podcasts/"+episode.Id+".wav"], wav) || !bytes.Equal(files["media/narrations/"+narrationRecord.Id+".wav"], wav) {
		t.Fatalf("ZIP did not include the episode WAV: version=%v files=%v", manifest["format_version"], len(files))
	}
	importResponse := httptest.NewRecorder()
	importEvent := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest(http.MethodPost, "/api/account/learning-import", bytes.NewReader(exportResponse.Body.Bytes())), Response: importResponse}}
	if err := importLearningDataRoute(importEvent); err != nil {
		t.Fatalf("archive import failed: %v", err)
	}
	importedNarrations, err := app.FindRecordsByFilter("lesson_narrations", "owner = {:owner} && course != {:course}", "", 0, 0, map[string]any{"owner": user.Id, "course": course.Id})
	if err != nil || len(importedNarrations) != 1 || importedNarrations[0].GetString("audio") == "" {
		t.Fatalf("lesson narration did not round trip with fresh course link and audio: %v (%d)", err, len(importedNarrations))
	}
	episodes, err := app.FindRecordsByFilter("podcast_episodes", "owner = {:owner} && title = {:title}", "", 0, 0, map[string]any{"owner": user.Id, "title": "Archive audio"})
	if err != nil || len(episodes) != 2 {
		t.Fatalf("expected original and imported episode, got %d records: %v", len(episodes), err)
	}
	var imported *core.Record
	for _, record := range episodes {
		if record.Id != episode.Id {
			imported = record
		}
	}
	if imported == nil || imported.GetString("audio") == "" || imported.Get("audio_metadata") == nil {
		t.Fatalf("imported episode lost its audio metadata: %#v", imported)
	}
	storage, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer storage.Close()
	reader, err := storage.GetReader(imported.BaseFilesPath() + "/" + imported.GetString("audio"))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	restored, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(restored, wav) {
		t.Fatalf("restored audio differs from export: err=%v bytes=%d", err, len(restored))
	}
}

func testPCM16WAV() []byte {
	pcm := []byte{0, 0, 1, 0, 2, 0, 3, 0}
	data := make([]byte, 44+len(pcm))
	copy(data[0:4], "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:12], "WAVE")
	copy(data[12:16], "fmt ")
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], 1)
	binary.LittleEndian.PutUint32(data[24:28], 16000)
	binary.LittleEndian.PutUint32(data[28:32], 32000)
	binary.LittleEndian.PutUint16(data[32:34], 2)
	binary.LittleEndian.PutUint16(data[34:36], 16)
	copy(data[36:40], "data")
	binary.LittleEndian.PutUint32(data[40:44], uint32(len(pcm)))
	copy(data[44:], pcm)
	return data
}

func TestLearningArchiveZipRejectsUnsafeAndUnreferencedMedia(t *testing.T) {
	for _, path := range []string{"../outside.wav", "media/podcasts/orphan.wav"} {
		t.Run(path, func(t *testing.T) {
			var output bytes.Buffer
			writer := zip.NewWriter(&output)
			manifest, err := writer.Create("manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := manifest.Write([]byte(`{"format":"starburst-learning-archive","format_version":2,"podcast_episodes":[]}`)); err != nil {
				t.Fatal(err)
			}
			media, err := writer.Create(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := media.Write(testPCM16WAV()); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			manifestBytes, files, _, err := decodeLearningArchiveContainer(output.Bytes())
			if strings.Contains(path, "..") {
				if err == nil {
					t.Fatal("unsafe ZIP path should fail during extraction")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var parsed struct {
				Format        string           `json:"format"`
				FormatVersion int              `json:"format_version"`
				Podcasts      []map[string]any `json:"podcast_episodes"`
				Narrations    []map[string]any `json:"lesson_narrations"`
			}
			if err := json.Unmarshal(manifestBytes, &parsed); err != nil {
				t.Fatal(err)
			}
			if _, _, err := validateLearningArchiveAssets(parsed.Podcasts, parsed.Narrations, files, parsed.FormatVersion); err == nil {
				t.Fatal("unreferenced media should fail manifest validation")
			}
		})
	}
}

func TestLearningArchiveImportIncludesPodcastAndPreferencesAndRemapsLinks(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-podcast-import@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "archive-podcast-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	preferences := defaultUserPreferences()
	preferences.LearningInterests = []string{"Astronomy"}
	preferences.LearningGoals = []string{"Read the night sky"}
	preferences.NarrationVoice = "en_US-sample-medium"
	preferences.NarrationSpeaker = "speaker-a"
	outline := fixturePodcastScript("Space notes", "Stars and galaxies", podcastContext{})
	transcript := fixturePodcastTranscript("Space notes", "Stars and galaxies", podcastContext{})
	archive := map[string]any{
		"format": "starburst-learning-archive", "format_version": 1, "user_id": "untrusted-owner",
		"preferences":      preferences,
		"learning_sources": []any{map[string]any{"id": "source-old", "title": "Star notes", "source_type": "text/plain", "content": "Stars emit light."}},
		"knowledge_units":  []any{map[string]any{"id": "unit-old", "title": "Star", "unit_type": "concept", "description": "A luminous sphere."}},
		"podcast_episodes": []any{map[string]any{
			"id": "episode-old", "title": "Space notes", "topic": "Stars and galaxies", "status": "ready",
			"source_ids": []string{"source-old", "foreign-source"}, "concept_ids": []string{"unit-old", "foreign-unit"},
			"knowledge_gap_ids": []string{"unit-old"}, "knowledge_gap_context": []map[string]any{{"title": "Star", "content": "A luminous sphere."}},
			"outline": outline, "transcript": transcript, "duration_seconds": 1,
			"course_context": map[string]any{"title": "Imported course — Module", "content": "Grounded objective."},
		}},
	}
	body, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest("POST", "/api/account/learning-import", bytes.NewReader(body)), Response: httptest.NewRecorder()}}
	if err := importLearningDataRoute(event); err != nil {
		t.Fatal(err)
	}
	podcasts, err := app.FindRecordsByFilter("podcast_episodes", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil || len(podcasts) != 1 {
		t.Fatalf("expected one podcast for the importing user: %v (%d)", err, len(podcasts))
	}
	var sourceIDs, conceptIDs []string
	if err := podcasts[0].UnmarshalJSONField("source_ids", &sourceIDs); err != nil {
		t.Fatal(err)
	}
	if err := podcasts[0].UnmarshalJSONField("concept_ids", &conceptIDs); err != nil {
		t.Fatal(err)
	}
	var gapIDs []string
	var gapContext []podcastReference
	if err := podcasts[0].UnmarshalJSONField("knowledge_gap_ids", &gapIDs); err != nil {
		t.Fatal(err)
	}
	if err := podcasts[0].UnmarshalJSONField("knowledge_gap_context", &gapContext); err != nil {
		t.Fatal(err)
	}
	if len(sourceIDs) != 1 || sourceIDs[0] == "source-old" || len(conceptIDs) != 1 || conceptIDs[0] == "unit-old" {
		t.Fatalf("podcast links were not remapped or unmapped links were retained: %v %v", sourceIDs, conceptIDs)
	}
	if len(gapIDs) != 1 || gapIDs[0] != conceptIDs[0] || len(gapContext) != 1 || gapContext[0].Title != "Star" {
		t.Fatalf("podcast knowledge gap was not remapped and restored: %v %#v", gapIDs, gapContext)
	}
	if _, err := app.FindRecordById("learning_sources", sourceIDs[0]); err != nil {
		t.Fatalf("podcast source link does not resolve: %v", err)
	}
	if _, err := app.FindRecordById("knowledge_units", conceptIDs[0]); err != nil {
		t.Fatalf("podcast concept link does not resolve: %v", err)
	}
	if podcasts[0].GetString("owner") != user.Id || podcasts[0].GetString("status") != "ready" || podcasts[0].GetFloat("duration_seconds") == 1 {
		t.Fatalf("podcast archive data was not safely restored: %#v", podcasts[0].PublicExport())
	}
	var restoredContext podcastReference
	if err := podcasts[0].UnmarshalJSONField("course_context", &restoredContext); err != nil || restoredContext.Title != "Imported course — Module" || restoredContext.Content != "Grounded objective." {
		t.Fatalf("podcast course context was not restored: %#v err=%v", restoredContext, err)
	}
	otherPodcasts, err := app.FindRecordsByFilter("podcast_episodes", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": other.Id})
	if err != nil || len(otherPodcasts) != 0 {
		t.Fatalf("archive import changed another account's podcasts: %v (%d)", err, len(otherPodcasts))
	}
	restoredUser, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	restoredPreferences := readUserPreferences(restoredUser)
	if restoredPreferences.LearningGoals[0] != "Read the night sky" || restoredPreferences.NarrationVoice != preferences.NarrationVoice || restoredPreferences.NarrationSpeaker != preferences.NarrationSpeaker {
		t.Fatalf("account preferences were not restored: %#v", restoredPreferences)
	}
}

func TestLearningArchiveImportRollsBackInvalidPodcastAndPreferences(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-podcast-rollback@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	preferences := defaultUserPreferences()
	preferences.LearningGoals = []string{"Must not apply"}
	outline := fixturePodcastScript("Invalid notes", "Broken transcript", podcastContext{})
	transcript := fixturePodcastTranscript("Invalid notes", "Broken transcript", podcastContext{})
	transcript.Turns[0].Speaker = "alien"
	archive := map[string]any{
		"format": "starburst-learning-archive", "format_version": 1, "preferences": preferences,
		"learning_sources": []any{map[string]any{"id": "source-old", "title": "Source", "source_type": "text/plain", "content": "text"}},
		"podcast_episodes": []any{map[string]any{"title": "Invalid notes", "topic": "Broken transcript", "outline": outline, "transcript": transcript}},
	}
	body, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest("POST", "/api/account/learning-import", bytes.NewReader(body)), Response: httptest.NewRecorder()}}
	if err := importLearningDataRoute(event); err == nil {
		t.Fatal("invalid podcast transcript should reject the archive")
	}
	sources, findErr := app.FindRecordsByFilter("learning_sources", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if findErr != nil || len(sources) != 0 {
		t.Fatalf("failed podcast import left partial sources: %v (%d)", findErr, len(sources))
	}
	unchanged, findErr := app.FindRecordById("users", user.Id)
	if findErr != nil {
		t.Fatal(findErr)
	}
	for _, goal := range readUserPreferences(unchanged).LearningGoals {
		if goal == "Must not apply" {
			t.Fatal("failed podcast import changed account preferences")
		}
	}
}

func TestLearningArchiveImportRejectsInvalidPreferences(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-invalid-preferences@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	preferences := defaultUserPreferences()
	preferences.TargetMinutes = 500
	archive := map[string]any{
		"format": "starburst-learning-archive", "format_version": 1, "preferences": preferences,
		"learning_sources": []any{map[string]any{"id": "source-old", "title": "Source", "source_type": "text/plain", "content": "text"}},
	}
	body, err := json.Marshal(archive)
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest("POST", "/api/account/learning-import", bytes.NewReader(body)), Response: httptest.NewRecorder()}}
	if err := importLearningDataRoute(event); err == nil {
		t.Fatal("invalid account preferences should reject the archive")
	}
	sources, findErr := app.FindRecordsByFilter("learning_sources", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if findErr != nil || len(sources) != 0 {
		t.Fatalf("invalid archive preferences caused partial import: %v (%d)", findErr, len(sources))
	}
}

func TestLearningArchiveImportRemapsRecordsAndScopesOwnership(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-import@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "archive-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	content, _ := json.Marshal(fixtureCourseContent("Imported"))
	payload := `{"format":"starburst-learning-archive","format_version":1,"user_id":"forged-owner","learning_sources":[{"id":"source-old","title":"Notes","source_type":"text/plain","content":"Source text"}],"knowledge_units":[{"id":"unit-old","title":"Fractions","unit_type":"concept","metadata":{"source_id":"source-old"}},{"id":"unit-old-2","title":"Numerators","unit_type":"concept"}],"courses":[{"id":"course-old","title":"Fractions","status":"published","version":2,"content":` + string(content) + `}],"course_versions":[{"course":"course-old","version":1,"title":"Fractions","content":` + string(content) + `}],"course_progress":[{"course":"course-old","scene_index":1,"position_seconds":72.5,"completed":false}],"knowledge_edges":[{"from_unit":"unit-old","to_unit":"unit-old-2","relationship":"prerequisite"}],"learner_evidence":[{"unit":"unit-old","evidence_type":"assessment","score":0.8,"details":{"course_id":"course-old"}}],"knowledge_mastery":[{"unit":"unit-old","mastery":0.7,"confidence":0.8,"review_interval_days":3,"ease_factor":2.5,"repetitions":2}]}`
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest("POST", "/api/account/learning-import", strings.NewReader(payload)), Response: httptest.NewRecorder()}}
	if err := importLearningDataRoute(event); err != nil {
		t.Fatal(err)
	}
	for _, collection := range []string{"courses", "course_versions", "course_progress", "course_assessments", "knowledge_units", "knowledge_edges", "learning_sources", "learner_evidence", "knowledge_mastery"} {
		owned, findErr := app.FindRecordsByFilter(collection, "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
		if findErr != nil || len(owned) == 0 {
			t.Fatalf("expected imported %s: %v (%d)", collection, findErr, len(owned))
		}
		foreign, findErr := app.FindRecordsByFilter(collection, "owner = {:owner}", "", 0, 0, dbx.Params{"owner": other.Id})
		if findErr != nil || len(foreign) != 0 {
			t.Fatalf("archive import affected another user in %s", collection)
		}
	}
	units, _ := app.FindRecordsByFilter("knowledge_units", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	var metadata map[string]any
	_ = units[0].UnmarshalJSONField("metadata", &metadata)
	if metadata["source_id"] == "source-old" {
		t.Fatal("source reference retained its untrusted archive ID")
	}
	evidence, _ := app.FindRecordsByFilter("learner_evidence", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	var details map[string]any
	_ = evidence[0].UnmarshalJSONField("details", &details)
	if details["course_id"] == "course-old" {
		t.Fatal("evidence course reference retained its archive ID")
	}
}

func TestLearningArchiveImportRollsBackInvalidCourse(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "archive-rollback@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	payload := `{"format":"starburst-learning-archive","format_version":1,"learning_sources":[{"id":"source","title":"Notes","source_type":"text/plain","content":"x"}],"courses":[{"id":"course","title":"Broken","content":{"modules":[]}}]}`
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: httptest.NewRequest("POST", "/api/account/learning-import", strings.NewReader(payload)), Response: httptest.NewRecorder()}}
	err = importLearningDataRoute(event)
	apiErr, ok := err.(*router.ApiError)
	if !ok || apiErr.Status != 400 {
		t.Fatalf("invalid course should reject archive: %v", err)
	}
	sources, findErr := app.FindRecordsByFilter("learning_sources", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": user.Id})
	if findErr != nil || len(sources) != 0 {
		t.Fatalf("failed import left partial source records: %v (%d)", findErr, len(sources))
	}
}

func TestValidateGeneratedCourseRejectsUnsupportedWidget(t *testing.T) {
	content := map[string]any{"modules": []any{map[string]any{"scenes": []any{map[string]any{"widget": map[string]any{"type": "arbitrary-code"}}}}}}
	if err := validateGeneratedCourse(content); err == nil {
		t.Fatal("expected unsupported widget to fail validation")
	}
}

func TestGeometryExplorerConfigIsTypedAndBounded(t *testing.T) {
	validWidget := map[string]any{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{
		"side_a": float64(6), "side_b": float64(8), "angle_degrees": float64(90), "prompt": "Explore the triangle.",
	}}
	content := map[string]any{"modules": []any{map[string]any{"scenes": []any{map[string]any{"id": "scene-1", "title": "Geometry", "duration_seconds": float64(30), "widget": validWidget}}}}}
	if err := validateGeneratedCourse(content); err != nil {
		t.Fatalf("valid geometry explorer widget rejected: %v", err)
	}
	invalidWidgets := []map[string]any{
		{"type": "geometry_explorer", "version": float64(2), "config": map[string]any{"side_a": float64(6), "side_b": float64(8), "angle_degrees": float64(90)}},
		{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{"side_a": float64(0.4), "side_b": float64(8), "angle_degrees": float64(90)}},
		{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{"side_a": float64(6), "side_b": float64(8), "angle_degrees": float64(180)}},
		{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{"side_a": "6", "side_b": float64(8), "angle_degrees": float64(90)}},
		{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{"side_a": float64(6), "side_b": float64(8), "angle_degrees": float64(90), "script": "arbitrary"}},
		{"type": "geometry_explorer", "version": float64(1), "config": map[string]any{"side_a": float64(6), "side_b": float64(8), "angle_degrees": float64(90), "prompt": strings.Repeat("x", 241)}},
	}
	for _, widget := range invalidWidgets {
		invalidContent := map[string]any{"modules": []any{map[string]any{"scenes": []any{map[string]any{"widget": widget}}}}}
		if err := validateGeneratedCourse(invalidContent); err == nil {
			t.Errorf("invalid geometry explorer config was accepted: %#v", widget)
		}
	}
}

func TestValidateGeneratedCourseRejectsEmptyModules(t *testing.T) {
	if err := validateGeneratedCourse(map[string]any{"modules": []any{}}); err == nil {
		t.Fatal("expected empty course to fail validation")
	}
}

func TestValidateGeneratedCourseRequiresBoundedUniqueSceneFields(t *testing.T) {
	baseScene := map[string]any{"id": "scene-1", "title": "A scene", "duration_seconds": float64(30), "widget": map[string]any{"type": "explanation"}}
	valid := map[string]any{"modules": []any{map[string]any{"title": "Module", "scenes": []any{baseScene}}}}
	if err := validateGeneratedCourse(valid); err != nil {
		t.Fatalf("valid scene rejected: %v", err)
	}
	invalidScenes := []map[string]any{
		{"title": "Missing ID", "duration_seconds": float64(30), "widget": map[string]any{"type": "explanation"}},
		{"id": "scene-1", "title": " ", "duration_seconds": float64(30), "widget": map[string]any{"type": "explanation"}},
		{"id": "scene-1", "title": "Too long", "duration_seconds": float64(3601), "widget": map[string]any{"type": "explanation"}},
	}
	for _, scene := range invalidScenes {
		content := map[string]any{"modules": []any{map[string]any{"scenes": []any{scene}}}}
		if err := validateGeneratedCourse(content); err == nil {
			t.Errorf("invalid scene was accepted: %#v", scene)
		}
	}
	duplicate := map[string]any{"modules": []any{map[string]any{"scenes": []any{baseScene, map[string]any{"id": "scene-1", "title": "Duplicate", "duration_seconds": float64(10), "widget": map[string]any{"type": "explanation"}}}}}}
	if err := validateGeneratedCourse(duplicate); err == nil {
		t.Fatal("duplicate scene IDs were accepted")
	}
}

func TestSceneCaptionSegmentsRequireOrderedBoundedTimestamps(t *testing.T) {
	valid := map[string]any{"duration_seconds": float64(8), "captions": []any{
		map[string]any{"start_seconds": float64(0), "end_seconds": float64(2), "text": "First line."},
		map[string]any{"start_seconds": float64(2.5), "end_seconds": float64(8), "text": "Second line."},
	}}
	if err := validateSceneCaptions(valid); err != nil {
		t.Fatalf("valid caption segments rejected: %v", err)
	}
	invalid := []map[string]any{
		{"duration_seconds": float64(5), "captions": []any{map[string]any{"start_seconds": float64(2), "end_seconds": float64(1), "text": "Reversed"}}},
		{"duration_seconds": float64(5), "captions": []any{map[string]any{"start_seconds": float64(0), "end_seconds": float64(6), "text": "Too long"}}},
		{"duration_seconds": float64(5), "captions": []any{map[string]any{"start_seconds": float64(0), "end_seconds": float64(1), "text": "First"}, map[string]any{"start_seconds": float64(0.5), "end_seconds": float64(2), "text": "Overlap"}}},
	}
	for _, scene := range invalid {
		if err := validateSceneCaptions(scene); err == nil {
			t.Errorf("invalid caption timing was accepted: %#v", scene)
		}
	}
}

func TestRecoverableLearningJobStates(t *testing.T) {
	for _, test := range []struct {
		kind, status string
		want         bool
	}{{"course_generation", "queued", true}, {"course_generation", "running", true}, {"course_generation", "failed", false}, {"podcast_script", "queued", true}, {"podcast_script", "running", true}, {"podcast_script", "completed", false}, {"podcast_audio", "queued", true}, {"podcast_audio", "running", true}, {"podcast_audio", "completed", false}, {"podcast_generation", "queued", false}} {
		if got := isRecoverableLearningJob(test.kind, test.status); got != test.want {
			t.Errorf("isRecoverableLearningJob(%q,%q)=%v want %v", test.kind, test.status, got, test.want)
		}
	}
}

func TestCourseGenerationBuildsValidatedMultiModuleCurriculumFromGoal(t *testing.T) {
	outline := map[string]any{
		"prerequisites": []any{"whole-number multiplication"},
		"knowledge_units": []any{
			map[string]any{"id": "fraction-basics", "title": "Fraction basics", "definition": "Fractions represent equal parts of a whole."},
			map[string]any{"id": "equivalent-fractions", "title": "Equivalent fractions", "definition": "Equivalent fractions name the same quantity with different terms."},
			map[string]any{"id": "fraction-models", "title": "Fraction models", "definition": "Area and number-line models can represent fractions."},
			map[string]any{"id": "fraction-comparison", "title": "Comparing fractions", "definition": "Fractions can be compared using a common unit or model."},
		},
		"modules": []any{
			map[string]any{"id": "fraction-foundations", "title": "Build fraction models", "objectives": []any{"Interpret a fraction as equal parts", "Represent a fraction on an area model"}, "knowledge_unit_ids": []any{"fraction-basics", "fraction-models"}},
			map[string]any{"id": "fraction-equivalence", "title": "Compare equivalent fractions", "objectives": []any{"Generate an equivalent fraction", "Compare two fractions using a shared unit"}, "knowledge_unit_ids": []any{"equivalent-fractions", "fraction-comparison"}},
		},
	}
	modules := make([]any, 0, 2)
	for _, raw := range outline["modules"].([]any) {
		module := raw.(map[string]any)
		objectives := module["objectives"].([]any)
		questions := make([]any, 0, 3)
		for index := 0; index < 3; index++ {
			questions = append(questions, map[string]any{"id": module["id"].(string) + "-q" + strconv.Itoa(index+1), "type": "multiple_choice", "prompt": "Choose the correct mathematical claim.", "objective": objectives[index%len(objectives)], "knowledge_unit_ids": module["knowledge_unit_ids"], "choices": []any{"answer", "distractor"}, "correct_answer": "answer", "rationale": "The answer follows from the model shown in the lesson.", "points": float64(1)})
		}
		scenes := []any{}
		for index := 0; index < 3; index++ {
			scenes = append(scenes, map[string]any{"id": module["id"].(string) + "-scene-" + strconv.Itoa(index+1), "title": "Explore the model", "duration_seconds": 30, "widget": map[string]any{"type": "explanation", "version": 1, "config": map[string]any{"body": "A fraction model"}}, "checkpoints": []any{}})
		}
		modules = append(modules, map[string]any{"id": module["id"], "title": module["title"], "objectives": objectives, "knowledge_unit_ids": module["knowledge_unit_ids"], "scenes": scenes, "assessment": map[string]any{"questions": questions}})
	}
	lesson := map[string]any{"version": 1, "modules": modules}
	var call int
	var prompts []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" || request.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(writer, "invalid provider request", http.StatusBadRequest)
			return
		}
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || len(payload.Messages) != 2 {
			http.Error(writer, "invalid chat payload", http.StatusBadRequest)
			return
		}
		prompts = append(prompts, payload.Messages[1].Content)
		var result any = outline
		call++
		if call == 2 {
			result = lesson
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(encoded)}}}})
	}))
	defer server.Close()
	t.Setenv("STARBURST_LLM_BASE_URL", server.URL)
	t.Setenv("STARBURST_LLM_API_KEY", "test-key")
	t.Setenv("STARBURST_LLM_MODEL", "test-model")
	var generationProgress []int
	generationContext := map[string]any{"sources": []map[string]any{{"id": "source-1", "title": "Class notes", "content": "Use shaded strips to compare unlike fractions."}}, "concepts": []map[string]any{{"id": "concept-1", "title": "Equivalent fractions", "description": "Different numerators and denominators can represent the same quantity."}}, "weak_concepts": []map[string]any{{"id": "weak-1", "title": "Common denominator", "description": "A shared denominator helps compare fractions.", "mastery": 0.3}}, "preferences": map[string]any{"difficulty": "advanced", "target_minutes": 30, "learner_context": map[string]any{"interests": []string{"astronomy"}, "goals": []string{"explain clearly"}, "prior_knowledge": []string{"basic algebra"}, "preferred_language": "fr-CA"}}}
	content, err := generateCourseContent(t.Context(), "Fractions", "Compare fractions using visual models", func(value int) { generationProgress = append(generationProgress, value) }, generationContext)
	if err != nil {
		t.Fatal(err)
	}
	if call != 2 || len(prompts) != 2 {
		t.Fatalf("expected planning and lesson-generation calls, got %d", call)
	}
	if len(generationProgress) < 3 || generationProgress[0] < 1 || generationProgress[len(generationProgress)-1] != 88 {
		t.Fatalf("expected progress updates for outline and lesson validation, got %v", generationProgress)
	}
	for _, prompt := range prompts {
		if !strings.Contains(prompt, "Compare fractions using visual models") {
			t.Fatalf("learner goal was omitted from generation prompt %q", prompt)
		}
		if !strings.Contains(prompt, "Use shaded strips to compare unlike fractions") || !strings.Contains(prompt, "Equivalent fractions") {
			t.Fatalf("selected source or concept context was omitted from prompt %q", prompt)
		}
		if !strings.Contains(prompt, `"difficulty":"advanced"`) || !strings.Contains(prompt, `"target_minutes":30`) {
			t.Fatalf("course preferences were omitted from prompt %q", prompt)
		}
		if !strings.Contains(prompt, "astronomy") || !strings.Contains(prompt, "fr-CA") {
			t.Fatalf("learner profile context was omitted from prompt %q", prompt)
		}
		if !strings.Contains(prompt, "weak_concepts") || !strings.Contains(prompt, "Common denominator") {
			t.Fatalf("weak concept context was omitted from prompt %q", prompt)
		}
	}
	if len(content["modules"].([]any)) != 2 || content["generator"] != "openai-compatible" {
		t.Fatalf("generated course did not preserve the multi-module outline: %#v", content)
	}
	if err := validateGeneratedCourseMatchesOutline(content, outline); err != nil {
		t.Fatalf("generated course did not match its outline: %v", err)
	}
}

func TestCurriculumOutlineRejectsUnknownKnowledgeReferences(t *testing.T) {
	outline := map[string]any{
		"knowledge_units": []any{map[string]any{"id": "known-unit", "title": "Known", "definition": "A known idea."}, map[string]any{"id": "other-unit", "title": "Other", "definition": "Another idea."}},
		"modules": []any{
			map[string]any{"id": "module-one", "title": "One", "objectives": []any{"First objective", "Second objective"}, "knowledge_unit_ids": []any{"unknown-unit"}},
			map[string]any{"id": "module-two", "title": "Two", "objectives": []any{"First objective", "Second objective"}, "knowledge_unit_ids": []any{"known-unit"}},
		},
	}
	if err := validateCurriculumOutline(outline); err == nil {
		t.Fatal("outline with a dangling knowledge-unit reference should fail validation")
	}
}

func TestCurriculumContextRejectsInventedCitations(t *testing.T) {
	outline := map[string]any{"knowledge_units": []any{map[string]any{"source_ids": []any{"not-selected"}}}}
	context := map[string]any{"sources": []map[string]any{{"id": "selected-source"}}}
	if err := validateCurriculumContextRefs(outline, context); err == nil {
		t.Fatal("outline cited a source the learner did not select")
	}
}

func TestCourseGenerationContextIsOwnerScopedAndBounded(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "context-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "context-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	source := createTestRecord(t, app, "learning_sources", map[string]any{"owner": owner.Id, "title": "My notes", "source_type": "text/plain", "content": "Private source content"})
	concept := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "My concept", "description": "Private concept detail", "unit_type": "concept"})
	selected, err := loadCourseGenerationContext(app, owner.Id, []string{source.Id}, []string{concept.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected["sources"].([]map[string]any)) != 1 || len(selected["concepts"].([]map[string]any)) != 1 {
		t.Fatalf("selected context missing: %#v", selected)
	}
	if _, err := loadCourseGenerationContext(app, other.Id, []string{source.Id}, nil); err == nil {
		t.Fatal("other user could select a source")
	}
	if _, err := loadCourseGenerationContext(app, other.Id, nil, []string{concept.Id}); err == nil {
		t.Fatal("other user could select a concept")
	}
	if _, err := loadCourseGenerationContext(app, owner.Id, []string{source.Id, source.Id}, nil); err == nil {
		t.Fatal("duplicate source IDs should be rejected")
	}
}

func TestCourseGenerationPreferencesAreValidatedAndDefaulted(t *testing.T) {
	defaults, err := normalizeCourseGenerationPreferences("", 0)
	if err != nil || defaults["difficulty"] != "beginner" || defaults["target_minutes"] != 15 {
		t.Fatalf("unexpected defaults: %#v, %v", defaults, err)
	}
	preferences, err := normalizeCourseGenerationPreferences("ADVANCED", 30)
	if err != nil || preferences["difficulty"] != "advanced" || preferences["target_minutes"] != 30 {
		t.Fatalf("unexpected preferences: %#v, %v", preferences, err)
	}
	for _, test := range []struct {
		difficulty string
		minutes    int
	}{{"expert", 10}, {"beginner", 4}, {"beginner", 61}} {
		if _, err := normalizeCourseGenerationPreferences(test.difficulty, test.minutes); err == nil {
			t.Errorf("invalid preferences were accepted: %#v", test)
		}
	}
}

func TestGenerateRoutePersistsLearnerGoalInRecoverableJob(t *testing.T) {
	learningWorkerSlots <- struct{}{}
	learningWorkerSlots <- struct{}{}
	defer func() { <-learningWorkerSlots; <-learningWorkerSlots }()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "generation-goal@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	user.Set("preferences", map[string]any{
		"learningInterests": []string{"astronomy"}, "learningGoals": []string{"explain ideas clearly"},
		"priorKnowledge": []string{"basic algebra"}, "preferredLanguage": "fr-CA",
		"defaultDifficulty": "advanced", "targetMinutes": 35, "narration": false, "captions": true,
	})
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	course := createTestRecord(t, app, "courses", map[string]any{"owner": user.Id, "title": "Fractions", "description": "Compare fractions using visual models", "status": "draft"})
	source := createTestRecord(t, app, "learning_sources", map[string]any{"owner": user.Id, "title": "Fraction notes", "source_type": "text/plain", "content": "Use strip diagrams to compare fractions."})
	concept := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": user.Id, "title": "Equivalent fractions", "description": "Different forms can show the same quantity.", "unit_type": "concept"})
	weakUnit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": user.Id, "title": "Common denominator", "description": "A shared denominator helps compare fractions.", "unit_type": "concept"})
	strongUnit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": user.Id, "title": "Fraction parts", "description": "A fraction names equal parts of a whole.", "unit_type": "concept"})
	createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": user.Id, "unit": weakUnit.Id, "mastery": 0.3, "confidence": 0.5, "review_interval_days": 1, "ease_factor": 2.3, "repetitions": 1})
	createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": user.Id, "unit": strongUnit.Id, "mastery": 0.9, "confidence": 0.8, "review_interval_days": 12, "ease_factor": 2.5, "repetitions": 4})
	request := httptest.NewRequest("POST", "/api/learning/courses/"+course.Id+"/generate", strings.NewReader(`{"source_ids":["`+source.Id+`"],"concept_ids":["`+concept.Id+`"]}`))
	request.SetPathValue("id", course.Id)
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := generateCourseRoute(event); err != nil {
		t.Fatal(err)
	}
	jobs, err := app.FindRecordsByFilter("learning_jobs", "owner = {:owner} && course = {:course}", "", 1, 0, dbx.Params{"owner": user.Id, "course": course.Id})
	if err != nil || len(jobs) != 1 {
		t.Fatalf("expected one generation job: %v (%d)", err, len(jobs))
	}
	var payload map[string]any
	if err := jobs[0].UnmarshalJSONField("payload", &payload); err != nil {
		t.Fatal(err)
	}
	if payload["learning_goal"] != "Compare fractions using visual models" {
		t.Fatalf("generation job did not persist the learner's goal: %#v", payload)
	}
	generationContext, ok := payload["generation_context"].(map[string]any)
	if !ok || len(generationContext["sources"].([]any)) != 1 || len(generationContext["concepts"].([]any)) != 1 {
		t.Fatalf("generation job did not persist its selected source and concept context: %#v", payload["generation_context"])
	}
	preferences, ok := generationContext["preferences"].(map[string]any)
	if !ok || preferences["difficulty"] != "advanced" || preferences["target_minutes"] != float64(35) {
		t.Fatalf("learner profile defaults were not persisted: %#v", generationContext["preferences"])
	}
	learnerContext, ok := preferences["learner_context"].(map[string]any)
	if !ok || learnerContext["preferred_language"] != "fr-CA" || learnerContext["narration"] != false {
		t.Fatalf("learner profile context was not persisted: %#v", preferences["learner_context"])
	}
	if got := learnerContext["interests"].([]any); len(got) != 1 || got[0] != "astronomy" {
		t.Fatalf("learner interests missing from generation context: %#v", learnerContext["interests"])
	}
	weakConcepts, ok := generationContext["weak_concepts"].([]any)
	if !ok || len(weakConcepts) != 1 || weakConcepts[0].(map[string]any)["id"] != weakUnit.Id {
		t.Fatalf("weak concepts missing from generation context: %#v", generationContext["weak_concepts"])
	}
	request = httptest.NewRequest("POST", "/api/learning/jobs/"+jobs[0].Id+"/cancel", strings.NewReader(`{}`))
	request.SetPathValue("id", jobs[0].Id)
	event = &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := cancelLearningJobRoute(event); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		learningWorkerMu.Lock()
		_, workerRunning := learningWorkerCancels[jobs[0].Id]
		learningWorkerMu.Unlock()
		if !workerRunning {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancelled generation worker did not stop")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCourseGenerationJobPersistsPublishedFixture(t *testing.T) {
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "learner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	course := createTestRecord(t, app, "courses", map[string]any{"owner": user.Id, "title": "Fractions", "status": "draft"})
	job := createTestRecord(t, app, "learning_jobs", map[string]any{"owner": user.Id, "kind": "course_generation", "status": "queued", "course": course.Id})
	runCourseGenerationJob(t.Context(), app, job.Id, course.Id, user.Id, course.GetString("title"))
	updated, err := app.FindRecordById("courses", course.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetString("status") != "published" {
		t.Fatalf("status=%q", updated.GetString("status"))
	}
	if updated.GetFloat("version") != 1 {
		t.Fatalf("version=%v", updated.GetFloat("version"))
	}
	job, err = app.FindRecordById("learning_jobs", job.Id)
	if err != nil {
		t.Fatal(err)
	}
	if job.GetString("status") != "completed" || job.GetFloat("progress") != 100 {
		t.Fatalf("job did not complete: %s at %v", job.GetString("status"), job.GetFloat("progress"))
	}
}
