package app

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/slopstack/slopstack/apps/server/internal/wyoming"
)

func TestLessonNarrationCacheReusesOwnedSceneAudioAndInvalidatesOnChanges(t *testing.T) {
	host, port, synthesizeCalls := startLessonNarrationPiper(t, []byte{1, 2, 3, 4})
	config := Config{WyomingPiperHost: host, WyomingPiperPort: port}
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("lesson_narrations")
	if err != nil {
		t.Fatal(err)
	}
	if collection.GetIndex("idx_lesson_narrations_cache") == "" {
		t.Fatal("lesson narration cache index is missing")
	}
	owner := createTestRecord(t, app, "users", map[string]any{"email": "narration-owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, app, "users", map[string]any{"email": "narration-other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	course := createTestRecord(t, app, "courses", map[string]any{
		"owner": owner.Id, "title": "Fractions", "status": "published", "version": 1,
		"content": map[string]any{"version": 1, "modules": []any{map[string]any{
			"id": "module-a", "title": "Parts", "scenes": []any{
				map[string]any{"id": "scene-a", "title": "Compare parts", "duration_seconds": 30, "widget": map[string]any{"type": "explanation", "version": 1, "config": map[string]any{"body": "Equal parts can look different."}}},
				map[string]any{"id": "scene-b", "title": "Try it", "duration_seconds": 30, "widget": map[string]any{"type": "reflection", "version": 1, "config": map[string]any{"question": "Explain equal parts."}}},
			},
		}}},
	})

	body := map[string]any{"scene_id": "scene-a", "text": "Compare parts. Equal parts can look different.", "voice": "voice-a", "speaker": "speaker-a"}
	response, err := callLessonNarrationRoute(t, app, owner, course.Id, body, config)
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || response.Header().Get("X-Narration-Cache") != "miss" || response.Header().Get("X-Audio-Sample-Rate") != "22050" {
		t.Fatalf("unexpected first response: status=%d cache=%q sample-rate=%q", response.Code, response.Header().Get("X-Narration-Cache"), response.Header().Get("X-Audio-Sample-Rate"))
	}
	firstAudio := response.Body.Bytes()
	if !bytes.HasPrefix(firstAudio, []byte("RIFF")) || len(firstAudio) != 48 {
		t.Fatalf("unexpected synthesized WAV: %d bytes", len(firstAudio))
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 1 {
		t.Fatalf("first narration should synthesize once, got %d calls", calls)
	}
	records, err := app.FindRecordsByFilter("lesson_narrations", "owner = {:owner} && course = {:course} && version = 1", "", 10, 0, dbx.Params{"owner": owner.Id, "course": course.Id})
	if err != nil || len(records) != 1 {
		t.Fatalf("expected one cached narration: %v (%d)", err, len(records))
	}
	if hash := records[0].GetString("text_hash"); len(hash) != 64 || strings.Contains(hash, "Compare parts") {
		t.Fatalf("cache should store a text hash, got %q", hash)
	}

	response, err = callLessonNarrationRoute(t, app, owner, course.Id, body, config)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("X-Narration-Cache") != "hit" || !bytes.Equal(response.Body.Bytes(), firstAudio) {
		t.Fatal("matching narration request should reuse the stored WAV")
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 1 {
		t.Fatalf("cache hit should not synthesize again, got %d calls", calls)
	}

	body["text"] = "Compare parts. A changed explanation."
	response, err = callLessonNarrationRoute(t, app, owner, course.Id, body, config)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("X-Narration-Cache") != "miss" {
		t.Fatal("changed scene text should miss the cache")
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 2 {
		t.Fatalf("changed text should synthesize once, got %d calls", calls)
	}

	body["text"] = "Compare parts. Equal parts can look different."
	course.Set("version", 2)
	if err := app.Save(course); err != nil {
		t.Fatal(err)
	}
	response, err = callLessonNarrationRoute(t, app, owner, course.Id, body, config)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("X-Narration-Cache") != "miss" {
		t.Fatal("course version change should miss the cache")
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 3 {
		t.Fatalf("version change should synthesize once, got %d calls", calls)
	}

	body["voice"] = "voice-b"
	body["speaker"] = "speaker-b"
	response, err = callLessonNarrationRoute(t, app, owner, course.Id, body, config)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("X-Narration-Cache") != "miss" {
		t.Fatal("voice change should miss the cache")
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 4 {
		t.Fatalf("voice change should synthesize once, got %d calls", calls)
	}
	if _, err := callLessonNarrationRoute(t, app, owner, course.Id, body, config); err != nil {
		t.Fatal(err)
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 4 {
		t.Fatalf("voice-specific cache hit should reuse audio, got %d calls", calls)
	}

	body["scene_id"] = "scene-a"
	body["voice"] = "voice-a"
	body["speaker"] = "speaker-a"
	if _, err := callLessonNarrationRoute(t, app, other, course.Id, body, config); err == nil {
		t.Fatal("another owner should not read or create narration for this course")
	}
	if calls := atomic.LoadInt32(synthesizeCalls); calls != 4 {
		t.Fatalf("owner-isolation failure should not synthesize, got %d calls", calls)
	}
}

func TestLessonNarrationInputAndAudioBounds(t *testing.T) {
	cases := []struct{ sceneID, text, voice, speaker string }{
		{"", "Text", "", ""},
		{"scene-a", "", "", ""},
		{"scene-a", strings.Repeat("a", maxLessonNarrationTextRunes+1), "", ""},
		{"scene-a", "Text", "", "speaker-a"},
		{"scene-a", "Text", strings.Repeat("v", 201), ""},
	}
	for _, test := range cases {
		if err := validateLessonNarrationInput(test.sceneID, test.text, test.voice, test.speaker); err == nil {
			t.Errorf("invalid narration input was accepted: %#v", test)
		}
	}
	if _, _, _, _, err := validateLessonNarrationAudio(testPCM16WAV()); err != nil {
		t.Fatalf("valid PCM WAV was rejected: %v", err)
	}
	if _, _, _, _, err := validateLessonNarrationAudio(sizedPCM16WAV(maxLessonNarrationBytes)); err == nil {
		t.Fatal("oversized narration audio should be rejected")
	}
}

func callLessonNarrationRoute(t *testing.T, app core.App, auth *core.Record, courseID string, body map[string]any, config Config) (*httptest.ResponseRecorder, error) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/learning/courses/"+courseID+"/narration", bytes.NewReader(encoded))
	request.SetPathValue("id", courseID)
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: auth, Event: router.Event{Request: request, Response: response}}
	return response, lessonNarrationRoute(config)(event)
}

func startLessonNarrationPiper(t *testing.T, payload []byte) (string, int, *int32) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	var synthesizeCalls int32
	go func() {
		for {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func(connection net.Conn) {
				defer connection.Close()
				reader := bufio.NewReader(connection)
				event, readErr := wyoming.ReadEvent(reader)
				if readErr != nil {
					return
				}
				switch event.Type {
				case "describe":
					_ = wyoming.WriteEvent(connection, wyoming.Event{Type: "info", Data: map[string]any{"tts": map[string]any{"models": []any{
						map[string]any{"name": "voice-a", "installed": true, "speakers": []any{map[string]any{"name": "speaker-a"}}},
						map[string]any{"name": "voice-b", "installed": true, "speakers": []any{map[string]any{"name": "speaker-b"}}},
					}}}})
				case "synthesize":
					atomic.AddInt32(&synthesizeCalls, 1)
					_ = wyoming.WriteEvent(connection, wyoming.Event{Type: "audio-start", Data: map[string]any{"rate": 22050, "width": 2, "channels": 1}})
					_ = wyoming.WriteEvent(connection, wyoming.Event{Type: "audio-chunk", Payload: payload})
					_ = wyoming.WriteEvent(connection, wyoming.Event{Type: "audio-stop"})
				}
			}(connection)
		}
	}()
	host, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	return host, port, &synthesizeCalls
}

func sizedPCM16WAV(pcmBytes int) []byte {
	if pcmBytes%2 != 0 {
		pcmBytes++
	}
	pcm := make([]byte, pcmBytes)
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
	return data
}
