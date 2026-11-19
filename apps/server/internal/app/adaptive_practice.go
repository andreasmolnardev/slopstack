package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const maxPracticeUnits = 20

type practiceQuestion struct {
	ID            string   `json:"id"`
	UnitID        string   `json:"unit_id"`
	UnitTitle     string   `json:"unit_title"`
	Prompt        string   `json:"prompt"`
	Options       []string `json:"options"`
	Hints         []string `json:"hints"`
	Remediation   string   `json:"remediation"`
	CorrectChoice string   `json:"-"`
}

type practiceQuestionPublic struct {
	ID        string   `json:"id"`
	UnitID    string   `json:"unit_id"`
	UnitTitle string   `json:"unit_title"`
	Prompt    string   `json:"prompt"`
	Options   []string `json:"options"`
	Hints     []string `json:"hints"`
}

type adaptivePracticeCreateInput struct {
	Body struct {
		Mode    string   `json:"mode"`
		UnitIDs []string `json:"unit_ids,omitempty"`
	} `json:"body"`
}

type adaptivePracticeIDInput struct {
	ID   string `path:"id"`
	Body struct {
		Answers map[string]string `json:"answers"`
	} `json:"body"`
}

type adaptivePracticeOutput struct{ Body map[string]any }

func registerAdaptivePracticeAPI(api huma.API) {
	security := []map[string][]string{{"pocketbaseAuth": {}}}
	huma.Register(api, huma.Operation{OperationID: "createAdaptivePracticeQuiz", Method: http.MethodPost, Path: "/api/learning/practice/quizzes", Tags: []string{"Learning"}, Summary: "Create a private adaptive practice quiz", Security: security, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized}, DefaultStatus: http.StatusCreated}, func(context.Context, *adaptivePracticeCreateInput) (*adaptivePracticeOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{OperationID: "submitAdaptivePracticeQuiz", Method: http.MethodPost, Path: "/api/learning/practice/quizzes/{id}/submit", Tags: []string{"Learning"}, Summary: "Score an adaptive practice quiz", Security: security, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound}}, func(context.Context, *adaptivePracticeIDInput) (*adaptivePracticeOutput, error) { return nil, nil })
}

// registerAdaptivePracticeRoutes is called from the app's PocketBase route setup.
func registerAdaptivePracticeRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/learning/practice/quizzes", createAdaptivePracticeQuizRoute)
	e.Router.POST("/api/learning/practice/quizzes/{id}/submit", submitAdaptivePracticeQuizRoute)
}

func EnsureAdaptivePracticeCollection(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("adaptive_practice_quizzes")
	if err != nil {
		collection = core.NewBaseCollection("adaptive_practice_quizzes")
	}
	changed := false
	fields := []struct {
		name     string
		required bool
		json     bool
	}{
		{name: "owner", required: true}, {name: "unit_ids", required: true, json: true},
		{name: "questions", required: true, json: true}, {name: "answer_keys", required: true, json: true},
		{name: "attempts", json: true}, {name: "mode", required: true}, {name: "status", required: true},
	}
	for _, field := range fields {
		if collection.Fields.GetByName(field.name) != nil {
			continue
		}
		if field.json {
			collection.Fields.Add(&core.JSONField{Name: field.name, Required: field.required})
		} else {
			collection.Fields.Add(&core.TextField{Name: field.name, Required: field.required})
		}
		changed = true
	}
	if collection.GetIndex("idx_adaptive_practice_owner_created") == "" {
		collection.AddIndex("idx_adaptive_practice_owner_created", false, "owner, status", "")
		changed = true
	}
	if changed {
		return app.Save(collection)
	}
	return nil
}

func createAdaptivePracticeQuizRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	var input adaptivePracticeCreateInput
	decoder := json.NewDecoder(io.LimitReader(event.Request.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input.Body); err != nil {
		return event.BadRequestError("invalid practice quiz request", err)
	}
	mode := strings.ToLower(strings.TrimSpace(input.Body.Mode))
	if mode == "" {
		mode = "selected"
	}
	units, err := selectPracticeUnits(event.App, user.Id, mode, input.Body.UnitIDs)
	if err != nil {
		return event.BadRequestError("invalid practice selection", err)
	}
	if len(units) == 0 {
		return event.BadRequestError("no knowledge items match this practice selection", nil)
	}
	if len(units) > maxPracticeUnits {
		return event.BadRequestError(fmt.Sprintf("select no more than %d knowledge items", maxPracticeUnits), nil)
	}
	questions := makePracticeQuestions(units)
	if len(questions) == 0 {
		return event.BadRequestError("could not create practice questions", nil)
	}
	collection, err := event.App.FindCollectionByNameOrId("adaptive_practice_quizzes")
	if err != nil {
		return event.InternalServerError("adaptive practice is unavailable", err)
	}
	quiz := core.NewRecord(collection)
	quiz.Set("owner", user.Id)
	quiz.Set("mode", mode)
	quiz.Set("status", "open")
	unitIDs := make([]string, 0, len(units))
	answerKeys := make(map[string]string, len(questions))
	publicQuestions := make([]practiceQuestionPublic, 0, len(questions))
	for _, unit := range units {
		unitIDs = append(unitIDs, unit.Id)
	}
	for _, question := range questions {
		answerKeys[question.ID] = question.CorrectChoice
		publicQuestions = append(publicQuestions, practiceQuestionPublic{ID: question.ID, UnitID: question.UnitID, UnitTitle: question.UnitTitle, Prompt: question.Prompt, Options: question.Options, Hints: question.Hints})
		question.CorrectChoice = ""
	}
	quiz.Set("unit_ids", unitIDs)
	quiz.Set("questions", questions)
	quiz.Set("answer_keys", answerKeys)
	quiz.Set("attempts", []any{})
	if err := event.App.Save(quiz); err != nil {
		return event.InternalServerError("could not save practice quiz", err)
	}
	return event.JSON(http.StatusCreated, map[string]any{"id": quiz.Id, "mode": mode, "questions": publicQuestions})
}

func selectPracticeUnits(app core.App, ownerID, mode string, requestedIDs []string) ([]*core.Record, error) {
	if len(requestedIDs) > maxPracticeUnits {
		return nil, fmt.Errorf("select no more than %d knowledge items", maxPracticeUnits)
	}
	switch mode {
	case "selected":
		if len(requestedIDs) == 0 {
			return nil, errors.New("select at least one knowledge item")
		}
		seen := make(map[string]struct{}, len(requestedIDs))
		units := make([]*core.Record, 0, len(requestedIDs))
		for _, id := range requestedIDs {
			if _, duplicate := seen[id]; duplicate || strings.TrimSpace(id) == "" {
				return nil, errors.New("knowledge item IDs must be unique and non-empty")
			}
			seen[id] = struct{}{}
			unit, err := ownedPracticeUnit(app, ownerID, id)
			if err != nil {
				return nil, err
			}
			units = append(units, unit)
		}
		return units, nil
	case "due", "weak":
		return selectPracticeByMastery(app, ownerID, mode)
	case "mixed":
		units, err := selectPracticeByMastery(app, ownerID, "due")
		if err != nil {
			return nil, err
		}
		seen := map[string]bool{}
		for _, unit := range units {
			seen[unit.Id] = true
		}
		for _, id := range requestedIDs {
			if seen[id] {
				continue
			}
			unit, err := ownedPracticeUnit(app, ownerID, id)
			if err != nil {
				return nil, err
			}
			units = append(units, unit)
			seen[id] = true
			if len(units) == maxPracticeUnits {
				break
			}
		}
		if len(units) > maxPracticeUnits {
			units = units[:maxPracticeUnits]
		}
		return units, nil
	default:
		return nil, errors.New("mode must be selected, due, weak, or mixed")
	}
}

func selectPracticeByMastery(app core.App, ownerID, mode string) ([]*core.Record, error) {
	filter := "owner = {:owner}"
	params := dbx.Params{"owner": ownerID}
	if mode == "due" {
		filter += " && next_review <= {:now}"
		params["now"] = time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
	}
	records, err := app.FindRecordsByFilter("knowledge_mastery", filter, "mastery, next_review", 200, 0, params)
	if err != nil {
		return nil, err
	}
	units := make([]*core.Record, 0, maxPracticeUnits)
	for _, mastery := range records {
		if mode == "weak" && mastery.GetFloat("mastery") > 0.6 {
			continue
		}
		unit, findErr := ownedPracticeUnit(app, ownerID, mastery.GetString("unit"))
		if findErr == nil {
			units = append(units, unit)
			if len(units) == maxPracticeUnits {
				break
			}
		}
	}
	return units, nil
}

func ownedPracticeUnit(app core.App, ownerID, id string) (*core.Record, error) {
	if strings.TrimSpace(id) == "" {
		return nil, errors.New("knowledge item ID is required")
	}
	units, err := app.FindRecordsByFilter("knowledge_units", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": id, "owner": ownerID})
	if err != nil {
		return nil, err
	}
	if len(units) == 0 {
		return nil, errors.New("knowledge item is unavailable")
	}
	return units[0], nil
}

func makePracticeQuestions(units []*core.Record) []practiceQuestion {
	questions := make([]practiceQuestion, 0, len(units))
	for index, unit := range units {
		title := strings.TrimSpace(unit.GetString("title"))
		if title == "" {
			continue
		}
		definition := strings.TrimSpace(unit.GetString("description"))
		question := practiceQuestion{
			ID: fmt.Sprintf("question-%d", index+1), UnitID: unit.Id, UnitTitle: title,
			Hints: []string{
				fmt.Sprintf("Recall the main idea of %q before comparing the choices.", title),
				"Look for the choice that captures the central idea, not just a related word.",
			},
			Remediation: definition,
		}
		if definition == "" {
			question.Prompt = fmt.Sprintf("Which concept are you reviewing? Choose the exact title: %q.", title)
			question.Options = []string{title, "A different concept", "An unrelated topic"}
			question.CorrectChoice = title
			questions = append(questions, question)
			continue
		}
		question.Prompt = fmt.Sprintf("Which saved explanation best describes %q?", title)
		question.CorrectChoice = definition
		question.Options = append(question.Options, definition)
		for _, candidate := range units {
			if candidate.Id == unit.Id {
				continue
			}
			choice := strings.TrimSpace(candidate.GetString("description"))
			if choice == "" || choice == definition || containsString(question.Options, choice) {
				continue
			}
			question.Options = append(question.Options, choice)
			if len(question.Options) == 4 {
				break
			}
		}
		for len(question.Options) < 4 {
			question.Options = append(question.Options, "A different idea not described by this knowledge item.")
		}
		question.Options = stablePracticeShuffle(question.Options, unit.Id)
		questions = append(questions, question)
	}
	return questions
}

func stablePracticeShuffle(values []string, seed string) []string {
	result := append([]string(nil), values...)
	seedBytes := []byte(seed)
	sort.SliceStable(result, func(left, right int) bool {
		leftHash := sha256.Sum256(append(append([]byte(nil), seedBytes...), []byte(result[left])...))
		rightHash := sha256.Sum256(append(append([]byte(nil), seedBytes...), []byte(result[right])...))
		return string(leftHash[:]) < string(rightHash[:])
	})
	return result
}

func submitAdaptivePracticeQuizRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	quizID := event.Request.PathValue("id")
	records, err := event.App.FindRecordsByFilter("adaptive_practice_quizzes", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": quizID, "owner": user.Id})
	if err != nil {
		return event.InternalServerError("could not load practice quiz", err)
	}
	if len(records) == 0 {
		return event.NotFoundError("practice quiz not found", nil)
	}
	quiz := records[0]
	if quiz.GetString("status") != "open" {
		return event.BadRequestError("practice quiz is already submitted", nil)
	}
	var input struct {
		Answers map[string]string `json:"answers"`
	}
	decoder := json.NewDecoder(io.LimitReader(event.Request.Body, 32<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return event.BadRequestError("invalid practice answers", err)
	}
	var questions []practiceQuestion
	var answerKeys map[string]string
	if err := quiz.UnmarshalJSONField("questions", &questions); err != nil {
		return event.InternalServerError("could not load practice questions", err)
	}
	if err := quiz.UnmarshalJSONField("answer_keys", &answerKeys); err != nil {
		return event.InternalServerError("could not load practice answers", err)
	}
	knownQuestions := make(map[string]struct{}, len(questions))
	for _, question := range questions {
		knownQuestions[question.ID] = struct{}{}
	}
	if len(input.Answers) > len(questions) {
		return event.BadRequestError("answers include unknown questions", nil)
	}
	for questionID := range input.Answers {
		if _, ok := knownQuestions[questionID]; !ok {
			return event.BadRequestError("answers include unknown questions", nil)
		}
	}
	results := make([]map[string]any, 0, len(questions))
	correct := 0
	for _, question := range questions {
		answer, known := input.Answers[question.ID]
		if known && !containsString(question.Options, answer) {
			return event.BadRequestError("answer is not a choice for this question", nil)
		}
		isCorrect := known && answer == answerKeys[question.ID]
		if isCorrect {
			correct++
		}
		results = append(results, map[string]any{"question_id": question.ID, "unit_id": question.UnitID, "correct": isCorrect, "feedback": practiceFeedback(isCorrect, question.Remediation), "remediation": question.Remediation})
		if err := savePracticeEvidence(event.App, user.Id, quiz.Id, question, isCorrect); err != nil {
			return event.InternalServerError("could not save practice evidence", err)
		}
	}
	score := 0.0
	if len(questions) > 0 {
		score = float64(correct) / float64(len(questions))
	}
	attempts := make([]map[string]any, 0)
	_ = quiz.UnmarshalJSONField("attempts", &attempts)
	attempts = append(attempts, map[string]any{"score": score, "submitted_at": time.Now().UTC(), "answers": input.Answers})
	quiz.Set("attempts", attempts)
	quiz.Set("status", "submitted")
	if err := event.App.Save(quiz); err != nil {
		return event.InternalServerError("could not save practice results", err)
	}
	return event.JSON(http.StatusOK, map[string]any{"score": score, "correct": correct, "total": len(questions), "results": results})
}

func practiceFeedback(correct bool, remediation string) string {
	if correct {
		return "Correct. The saved explanation confirms your understanding."
	}
	if strings.TrimSpace(remediation) == "" {
		return "Review the concept title and try another practice round."
	}
	return "Review the alternative explanation below, then try this concept again in a new round."
}

func savePracticeEvidence(app core.App, ownerID, quizID string, question practiceQuestion, correct bool) error {
	collection, err := app.FindCollectionByNameOrId("learner_evidence")
	if err != nil {
		return err
	}
	evidence := core.NewRecord(collection)
	evidence.Set("owner", ownerID)
	evidence.Set("unit", question.UnitID)
	evidence.Set("evidence_type", "adaptive_practice")
	score := 0.0
	quality := 2
	if correct {
		score = 1
		quality = 4
	}
	evidence.Set("score", score)
	evidence.Set("details", map[string]any{"quiz_id": quizID, "question_id": question.ID, "correct": correct})
	if err := app.Save(evidence); err != nil {
		return err
	}
	return updatePracticeMastery(app, ownerID, question.UnitID, quality)
}

func updatePracticeMastery(app core.App, ownerID, unitID string, quality int) error {
	records, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner} && unit = {:unit}", "", 1, 0, dbx.Params{"owner": ownerID, "unit": unitID})
	if err != nil {
		return err
	}
	collection, err := app.FindCollectionByNameOrId("knowledge_mastery")
	if err != nil {
		return err
	}
	var mastery *core.Record
	if len(records) > 0 {
		mastery = records[0]
	} else {
		mastery = core.NewRecord(collection)
		mastery.Set("owner", ownerID)
		mastery.Set("unit", unitID)
		mastery.Set("review_interval_days", 0)
		mastery.Set("ease_factor", 2.5)
	}
	interval, ease, repetitions, value := nextReviewSchedule(mastery.GetFloat("review_interval_days"), mastery.GetFloat("ease_factor"), int(mastery.GetFloat("repetitions")), mastery.GetFloat("mastery"), quality)
	now := time.Now().UTC()
	mastery.Set("review_interval_days", interval)
	mastery.Set("ease_factor", ease)
	mastery.Set("repetitions", repetitions)
	mastery.Set("mastery", value)
	mastery.Set("confidence", float64(quality)/5)
	mastery.Set("last_practice", now)
	mastery.Set("next_review", now.Add(time.Duration(interval*24)*time.Hour))
	return app.Save(mastery)
}
