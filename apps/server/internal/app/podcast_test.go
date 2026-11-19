package app

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/slopstack/slopstack/apps/server/internal/wyoming"
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

func TestCancelPodcastScriptJobCancelsItsEpisode(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "podcast-cancel@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	episode, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Cancel", Topic: "A test"}, podcastOutline{}, podcastTranscript{})
	if err != nil {
		t.Fatal(err)
	}
	episode.Set("status", "generating")
	if err := app.Save(episode); err != nil {
		t.Fatal(err)
	}
	job := createTestRecord(t, app, "learning_jobs", map[string]any{"owner": owner.Id, "kind": "podcast_script", "status": "queued", "payload": map[string]any{"episode_id": episode.Id}})
	request := httptest.NewRequest(http.MethodPost, "/api/learning/jobs/"+job.Id+"/cancel", strings.NewReader(`{}`))
	request.SetPathValue("id", job.Id)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := cancelLearningJobRoute(event); err != nil {
		t.Fatal(err)
	}
	job, err = app.FindRecordById("learning_jobs", job.Id)
	if err != nil {
		t.Fatal(err)
	}
	if job.GetString("status") != "cancelled" {
		t.Fatalf("job status=%q", job.GetString("status"))
	}
	episode, err = app.FindRecordById("podcast_episodes", episode.Id)
	if err != nil {
		t.Fatal(err)
	}
	if episode.GetString("status") != "cancelled" {
		t.Fatalf("episode status=%q", episode.GetString("status"))
	}
}

func TestRecoverLearningJobsResumesPodcastScriptSnapshot(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "podcast-recover@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	episode, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Resume", Topic: "A saved snapshot"}, podcastOutline{}, podcastTranscript{})
	if err != nil {
		t.Fatal(err)
	}
	episode.Set("status", "generating")
	if err := app.Save(episode); err != nil {
		t.Fatal(err)
	}
	job := createTestRecord(t, app, "learning_jobs", map[string]any{
		"owner": owner.Id, "kind": "podcast_script", "status": "running", "progress": 40,
		"payload": map[string]any{"episode_id": episode.Id, "title": "Resume", "topic": "A saved snapshot", "references": podcastContext{Gaps: []podcastReference{{Title: "Saved concept", Content: "A saved definition."}}}},
	})
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	if err := recoverLearningJobs(app); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job, err = app.FindRecordById("learning_jobs", job.Id)
		if err == nil && (job.GetString("status") == "completed" || job.GetString("status") == "failed") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || job == nil || job.GetString("status") != "completed" {
		t.Fatalf("recovered podcast job did not complete: %v", err)
	}
	episode, err = app.FindRecordById("podcast_episodes", episode.Id)
	if err != nil || episode.GetString("status") != "ready" {
		t.Fatalf("recovered podcast episode status=%v err=%v", episode, err)
	}
	var transcript podcastTranscript
	err = episode.UnmarshalJSONField("transcript", &transcript)
	transcriptData, marshalErr := json.Marshal(transcript)
	if err != nil || marshalErr != nil || len(transcript.Turns) == 0 || !strings.Contains(string(transcriptData), "Saved concept") {
		t.Fatalf("recovery did not use the persisted context snapshot: %#v err=%v marshalErr=%v", transcript, err, marshalErr)
	}
}

func TestPodcastGenerationUsesOwnerScopedDueKnowledgeGapsAndKeepsSnapshotOnRegeneration(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "podcast-gap-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "podcast-gap-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	unit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Fraction equivalence", "description": "Recognize equivalent fractions.", "unit_type": "concept"})
	mastery := createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": owner.Id, "unit": unit.Id, "mastery": 0.35, "next_review": time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)})
	references, err := loadPodcastReferences(app, owner.Id, nil, nil, []string{unit.Id})
	if err != nil || len(references.Gaps) != 1 || references.Gaps[0].Title != "Fraction equivalence" {
		t.Fatalf("due knowledge gap was not loaded: %#v %v", references.Gaps, err)
	}
	if _, err := loadPodcastReferences(app, other.Id, nil, nil, []string{unit.Id}); err == nil {
		t.Fatal("another learner's due knowledge gap was accepted")
	}
	notDue := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Not due", "description": "Not due yet.", "unit_type": "concept"})
	if _, err := loadPodcastReferences(app, owner.Id, nil, nil, []string{notDue.Id}); err == nil {
		t.Fatal("a concept that is not due should not be accepted as a review gap")
	}
	futureUnit := createTestRecord(t, app, "knowledge_units", map[string]any{"owner": owner.Id, "title": "Future review", "description": "Not due yet.", "unit_type": "concept"})
	createTestRecord(t, app, "knowledge_mastery", map[string]any{"owner": owner.Id, "unit": futureUnit.Id, "mastery": 0.8, "next_review": time.Now().UTC().Add(time.Hour).Format("2006-01-02 15:04:05.000Z")})
	if _, err := loadPodcastReferences(app, owner.Id, nil, nil, []string{futureUnit.Id}); err == nil {
		t.Fatal("a future review must not be accepted as a due knowledge gap")
	}
	t.Setenv("STARBURST_LLM_BASE_URL", "")
	t.Setenv("STARBURST_LLM_API_KEY", "")
	t.Setenv("STARBURST_LLM_MODEL", "")
	body, _ := json.Marshal(podcastCreateBody{Title: "Review fractions", Topic: "equivalent fractions", KnowledgeGapIDs: []string{unit.Id}})
	request := httptest.NewRequest(http.MethodPost, "/api/audio/episodes", strings.NewReader(string(body)))
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createPodcastEpisodeRoute(event); err != nil {
		t.Fatalf("due-gap episode generation failed: %v", err)
	}
	if event.Response.(*httptest.ResponseRecorder).Code != http.StatusAccepted {
		t.Fatalf("podcast creation must return an accepted job, got %d", event.Response.(*httptest.ResponseRecorder).Code)
	}
	var queued map[string]any
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &queued); err != nil {
		t.Fatal(err)
	}
	jobID := queued["id"].(string)
	deadline := time.Now().Add(5 * time.Second)
	var job *core.Record
	for time.Now().Before(deadline) {
		job, err = app.FindRecordById("learning_jobs", jobID)
		if err == nil && (job.GetString("status") == "completed" || job.GetString("status") == "failed") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || job == nil || job.GetString("status") != "completed" {
		t.Fatalf("podcast script job did not complete: %v status=%v", err, job)
	}
	var jobResult map[string]any
	if err := job.UnmarshalJSONField("result", &jobResult); err != nil {
		t.Fatal(err)
	}
	episodeID, _ := jobResult["episode_id"].(string)
	episode, err := app.FindRecordById("podcast_episodes", episodeID)
	if err != nil || episode.GetString("status") != "ready" {
		t.Fatalf("completed job did not publish its episode: %v", err)
	}
	if !strings.Contains(fmt.Sprint(episode.Get("transcript")), "Fraction equivalence") {
		t.Fatal("generated podcast did not use its selected due-gap context")
	}
	responseBytes, err := json.Marshal(podcastEpisodeExport(episode))
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(responseBytes, &response); err != nil {
		t.Fatal(err)
	}
	if got := response["knowledge_gap_ids"].([]any); len(got) != 1 || got[0] != unit.Id {
		t.Fatalf("episode response omitted its knowledge gap: %#v", response["knowledge_gap_ids"])
	}
	if err := episode.UnmarshalJSONField("knowledge_gap_context", &references.Gaps); err != nil || len(references.Gaps) != 1 {
		t.Fatalf("episode did not preserve the gap context snapshot: %#v %v", references.Gaps, err)
	}
	mastery.Set("next_review", time.Now().UTC().Add(time.Hour).Format(time.RFC3339))
	if err := app.Save(mastery); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/audio/episodes/"+episode.Id+"/regenerate", nil)
	request.SetPathValue("id", episode.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := regeneratePodcastEpisodeRoute(event); err != nil {
		t.Fatalf("regeneration should use the saved knowledge gap snapshot: %v", err)
	}
	if event.Response.(*httptest.ResponseRecorder).Code != http.StatusAccepted {
		t.Fatalf("regeneration should return an accepted job, got %d", event.Response.(*httptest.ResponseRecorder).Code)
	}
	var regeneration map[string]any
	if err := json.Unmarshal(event.Response.(*httptest.ResponseRecorder).Body.Bytes(), &regeneration); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job, err = app.FindRecordById("learning_jobs", regeneration["id"].(string))
		if err == nil && (job.GetString("status") == "completed" || job.GetString("status") == "failed") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || job == nil || job.GetString("status") != "completed" {
		t.Fatalf("podcast regeneration did not complete: %v", err)
	}
	episode, err = app.FindRecordById("podcast_episodes", episode.Id)
	if err != nil || !strings.Contains(fmt.Sprint(episode.Get("transcript")), "Fraction equivalence") {
		t.Fatal("regenerated podcast did not use its saved due-gap snapshot")
	}

	tooMany := make([]string, maxPodcastGaps+1)
	for index := range tooMany {
		tooMany[index] = unit.Id
	}
	body, _ = json.Marshal(podcastCreateBody{Title: "Too many gaps", Topic: "fractions", KnowledgeGapIDs: tooMany})
	request = httptest.NewRequest(http.MethodPost, "/api/audio/episodes", strings.NewReader(string(body)))
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createPodcastEpisodeRoute(event); err == nil {
		t.Fatal("API route should reject over-limit knowledge gap selections")
	}

	body, _ = json.Marshal(podcastCreateBody{Title: "Duplicate gaps", Topic: "fractions", KnowledgeGapIDs: []string{unit.Id, unit.Id}})
	request = httptest.NewRequest(http.MethodPost, "/api/audio/episodes", strings.NewReader(string(body)))
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := createPodcastEpisodeRoute(event); err == nil {
		t.Fatal("API route should reject duplicate knowledge gap selections")
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
		{"POST", "/api/audio/episodes/{id}/audio"}, {"GET", "/api/audio/episodes/{id}/audio"},
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

func TestPodcastAudioIsOwnerScopedAndServesStoredWAV(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "audio-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "audio-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	outline := fixturePodcastScript("Audio", "a topic", podcastContext{})
	transcript := fixturePodcastTranscript("Audio", "a topic", podcastContext{})
	record, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Audio", Topic: "a topic"}, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := getPodcastAudioRoute(event); err == nil {
		t.Fatal("missing audio should return not found")
	}
	file, err := filesystem.NewFileFromBytes([]byte("RIFF-test-wav"), "episode.wav")
	if err != nil {
		t.Fatal(err)
	}
	record.Set("audio", file)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	response = httptest.NewRecorder()
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := getPodcastAudioRoute(event); err != nil {
		t.Fatalf("stored audio read failed: %v", err)
	}
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "audio/wav" || response.Body.String() != "RIFF-test-wav" {
		t.Fatalf("unexpected audio response: status=%d content-type=%q body=%q", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	response = httptest.NewRecorder()
	event = &core.RequestEvent{App: app, Auth: other, Event: router.Event{Request: request, Response: response}}
	if err := getPodcastAudioRoute(event); err == nil {
		t.Fatal("another owner's stored audio should not be readable")
	}
}

func TestPodcastAudioGenerationReturnsSavedAudioAndRejectsMissingPiper(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "audio-generate@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	outline := fixturePodcastScript("Audio", "a topic", podcastContext{})
	transcript := fixturePodcastTranscript("Audio", "a topic", podcastContext{})
	record, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Audio", Topic: "a topic"}, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := generatePodcastAudioRoute(Config{})(event); err == nil {
		t.Fatal("audio generation should require configured Piper")
	}
	file, err := filesystem.NewFileFromBytes([]byte("RIFF-test-wav"), "episode.wav")
	if err != nil {
		t.Fatal(err)
	}
	record.Set("audio", file)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	event = &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: httptest.NewRecorder()}}
	if err := generatePodcastAudioRoute(Config{})(event); err != nil {
		t.Fatalf("saved audio should be idempotently returned without Piper: %v", err)
	}
	if event.Response.(*httptest.ResponseRecorder).Code != http.StatusOK {
		t.Fatalf("saved audio response status = %d", event.Response.(*httptest.ResponseRecorder).Code)
	}
}

func TestPodcastAudioGenerationRunsAsRecoverableJob(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "audio-job@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	host, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	serverErr := make(chan error, 1)
	go func() {
		for index := 0; index < 11; index++ {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				serverErr <- acceptErr
				return
			}
			request, readErr := wyoming.ReadEvent(bufio.NewReader(conn))
			if readErr != nil {
				conn.Close()
				serverErr <- readErr
				return
			}
			if request.Type == "describe" {
				_ = wyoming.WriteEvent(conn, wyoming.Event{Type: "info", Data: map[string]any{"tts": map[string]any{"models": []any{map[string]any{"name": "en_US-sample-medium", "installed": true, "speakers": []any{map[string]any{"name": "speaker-1"}}}}}}})
			} else if request.Type == "synthesize" {
				_ = wyoming.WriteEvent(conn, wyoming.Event{Type: "audio-start", Data: map[string]any{"rate": 22050, "width": 2, "channels": 1}})
				_ = wyoming.WriteEvent(conn, wyoming.Event{Type: "audio-chunk", Payload: []byte{1, 2, 3, 4}})
				_ = wyoming.WriteEvent(conn, wyoming.Event{Type: "audio-stop"})
			} else {
				conn.Close()
				serverErr <- fmt.Errorf("unexpected Wyoming request %q", request.Type)
				return
			}
			_ = conn.Close()
		}
		serverErr <- nil
	}()
	outline := fixturePodcastScript("Audio", "a topic", podcastContext{})
	transcript := fixturePodcastTranscript("Audio", "a topic", podcastContext{})
	record, err := savePodcastEpisode(app, owner.Id, podcastCreateBody{Title: "Audio", Topic: "a topic"}, outline, transcript)
	if err != nil {
		t.Fatal(err)
	}
	record.Set("voice_assignments", podcastVoiceAssignments{Host: podcastRoleVoice{Voice: "en_US-sample-medium", Speaker: "speaker-1"}, Guest: podcastRoleVoice{Voice: "en_US-sample-medium", Speaker: "speaker-1"}})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/audio/episodes/"+record.Id+"/audio", nil)
	request.SetPathValue("id", record.Id)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: owner, Event: router.Event{Request: request, Response: response}}
	if err := generatePodcastAudioRoute(Config{WyomingPiperHost: host, WyomingPiperPort: port})(event); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusAccepted {
		t.Fatalf("audio generation should return an accepted job, got %d", response.Code)
	}
	var queued map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &queued); err != nil {
		t.Fatal(err)
	}
	jobID := queued["id"].(string)
	deadline := time.Now().Add(10 * time.Second)
	var job *core.Record
	for time.Now().Before(deadline) {
		job, err = app.FindRecordById("learning_jobs", jobID)
		if err == nil && (job.GetString("status") == "completed" || job.GetString("status") == "failed") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || job == nil || job.GetString("status") != "completed" {
		t.Fatalf("podcast audio job did not complete: err=%v job=%v", err, job)
	}
	record, err = app.FindRecordById("podcast_episodes", record.Id)
	if err != nil || record.GetString("audio") == "" {
		t.Fatalf("audio job did not persist its WAV: err=%v", err)
	}
	if err := <-serverErr; err != nil {
		t.Fatal(err)
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
