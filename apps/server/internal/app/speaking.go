package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const maxSpeakingTranscriptRunes = 2_000

type speakingAttemptInput struct {
	ID   string `path:"id"`
	Body struct {
		Transcript string `json:"transcript"`
	}
}

type speakingAttemptOutput struct {
	Body struct {
		Correct    bool   `json:"correct"`
		Score      int    `json:"score"`
		Feedback   string `json:"feedback"`
		EvidenceID string `json:"evidence_id"`
		Transcript string `json:"transcript"`
		Expected   string `json:"expected"`
	}
}

func registerSpeakingAPI(api huma.API) {
	security := []map[string][]string{{"pocketbaseAuth": {}}}
	huma.Register(api, huma.Operation{
		OperationID: "submitVocabularySpeakingAttempt", Method: http.MethodPost,
		Path: "/api/languages/vocabulary/{id}/speaking-attempt", Tags: []string{"Language Learning"},
		Summary:     "Score an English speaking attempt for an owned vocabulary item",
		Description: "Compares a Whisper transcript to the saved vocabulary term after Unicode-aware case, whitespace, and punctuation normalization. This does not assess accent or pronunciation quality.",
		Security:    security, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound, http.StatusInternalServerError},
	}, func(_ context.Context, _ *speakingAttemptInput) (*speakingAttemptOutput, error) { return nil, nil })
}

func registerSpeakingRoutes(event *core.ServeEvent) {
	event.Router.POST("/api/languages/vocabulary/{id}/speaking-attempt", submitSpeakingAttemptRoute)
}

func submitSpeakingAttemptRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	var input struct {
		Transcript string `json:"transcript"`
	}
	decoder := json.NewDecoder(io.LimitReader(event.Request.Body, 8<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return event.BadRequestError("invalid speaking attempt", err)
	}
	input.Transcript = strings.TrimSpace(input.Transcript)
	if err := validateSpeakingAttemptInput(input.Transcript); err != nil {
		return event.BadRequestError("invalid speaking transcript", err)
	}
	id := event.Request.PathValue("id")
	items, err := event.App.FindRecordsByFilter("knowledge_units", "id = {:id} && owner = {:owner} && unit_type = 'vocabulary'", "", 1, 0, dbx.Params{"id": id, "owner": user.Id})
	if err != nil {
		return event.InternalServerError("could not load vocabulary item", err)
	}
	if len(items) == 0 {
		return event.NotFoundError("vocabulary item not found", nil)
	}
	unit := items[0]
	var metadata map[string]any
	if err := unit.UnmarshalJSONField("metadata", &metadata); err != nil {
		return event.InternalServerError("could not read vocabulary item", err)
	}
	language, _ := metadata["language"].(string)
	if !strings.EqualFold(strings.TrimSpace(language), "english") {
		return event.BadRequestError("speaking practice currently supports English vocabulary only", nil)
	}
	expected := strings.TrimSpace(unit.GetString("title"))
	correct := normalizeSpeakingTranscript(expected) == normalizeSpeakingTranscript(input.Transcript)
	score := 0
	feedback := "Not quite. Listen to the word again and try once more."
	if correct {
		score = 1
		feedback = "Correct. Your transcript matches the saved word."
	}
	collection, err := event.App.FindCollectionByNameOrId("learner_evidence")
	if err != nil {
		return event.InternalServerError("evidence collection unavailable", err)
	}
	evidence := core.NewRecord(collection)
	evidence.Set("owner", user.Id)
	evidence.Set("unit", unit.Id)
	evidence.Set("evidence_type", "speaking_attempt")
	evidence.Set("score", score)
	evidence.Set("details", map[string]any{
		"transcript": input.Transcript, "correct": correct,
		"expected": expected, "language": metadata["language"],
	})
	if err := event.App.Save(evidence); err != nil {
		return event.InternalServerError("could not save speaking evidence", err)
	}
	return event.JSON(http.StatusOK, map[string]any{
		"correct": correct, "score": score, "feedback": feedback,
		"evidence_id": evidence.Id, "transcript": input.Transcript, "expected": expected,
	})
}

func normalizeSpeakingTranscript(value string) string {
	var normalized strings.Builder
	space := true
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(character) || unicode.IsNumber(character) {
			normalized.WriteRune(character)
			space = false
			continue
		}
		if !space {
			normalized.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(normalized.String())
}

func validateSpeakingAttemptInput(transcript string) error {
	transcript = strings.TrimSpace(transcript)
	if transcript == "" || len([]rune(transcript)) > maxSpeakingTranscriptRunes {
		return fmt.Errorf("transcript must contain between 1 and %d characters", maxSpeakingTranscriptRunes)
	}
	return nil
}
