package app

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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

const (
	maxPracticeUnits       = 20
	maxCoursePracticeUnits = 40
	weakPracticeThreshold  = 0.6
	gapPracticeThreshold   = 0.5
)

type practiceQuestion struct {
	ID            string   `json:"id"`
	UnitID        string   `json:"unit_id"`
	UnitTitle     string   `json:"unit_title"`
	Reason        string   `json:"reason,omitempty"`
	Difficulty    string   `json:"difficulty"`
	Prompt        string   `json:"prompt"`
	Options       []string `json:"options"`
	Hints         []string `json:"hints"`
	Remediation   string   `json:"remediation"`
	CorrectChoice string   `json:"-"`
}

type practiceQuestionPublic struct {
	ID         string   `json:"id"`
	UnitID     string   `json:"unit_id"`
	UnitTitle  string   `json:"unit_title"`
	Reason     string   `json:"reason,omitempty"`
	Difficulty string   `json:"difficulty"`
	Prompt     string   `json:"prompt"`
	Options    []string `json:"options"`
	Hints      []string `json:"hints"`
}

type adaptivePracticeCreateInput struct {
	Body struct {
		Mode     string   `json:"mode"`
		UnitIDs  []string `json:"unit_ids,omitempty"`
		CourseID string   `json:"course_id,omitempty"`
		ModuleID string   `json:"module_id,omitempty"`
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
	huma.Register(api, huma.Operation{OperationID: "createAdaptivePracticeQuiz", Method: http.MethodPost, Path: "/api/learning/practice/quizzes", Tags: []string{"Learning"}, Summary: "Create a private adaptive practice quiz", Security: security, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound}, DefaultStatus: http.StatusCreated}, func(context.Context, *adaptivePracticeCreateInput) (*adaptivePracticeOutput, error) { return nil, nil })
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
	var units []*core.Record
	var reasonsByUnit map[string]string
	if mode == "gap" {
		if input.Body.CourseID != "" || input.Body.ModuleID != "" {
			return event.BadRequestError("course_id and module_id require course or module practice mode", nil)
		}
		units, reasonsByUnit, err = selectPracticeGapUnits(event.App, user.Id, input.Body.UnitIDs)
	} else if mode == "course" || mode == "module" {
		if len(input.Body.UnitIDs) > 0 {
			return event.BadRequestError("course and module practice do not accept unit_ids", nil)
		}
		units, err = selectCoursePracticeUnits(event.App, user.Id, input.Body.CourseID, input.Body.ModuleID, mode == "module")
	} else {
		if input.Body.CourseID != "" || input.Body.ModuleID != "" {
			return event.BadRequestError("course_id and module_id require course or module practice mode", nil)
		}
		units, err = selectPracticeUnits(event.App, user.Id, mode, input.Body.UnitIDs)
	}
	if err != nil {
		return event.BadRequestError("invalid practice selection", err)
	}
	if len(units) == 0 {
		return event.BadRequestError("no knowledge items match this practice selection", nil)
	}
	unitLimit := maxPracticeUnits
	if mode == "course" || mode == "module" {
		unitLimit = maxCoursePracticeUnits
	}
	if len(units) > unitLimit {
		return event.BadRequestError(fmt.Sprintf("practice is limited to %d knowledge items", unitLimit), nil)
	}
	masteryByUnit, err := loadPracticeMastery(event.App, user.Id)
	if err != nil {
		return event.InternalServerError("could not load practice history", err)
	}
	shuffleSeed, err := newPracticeShuffleSeed()
	if err != nil {
		return event.InternalServerError("could not prepare practice quiz", err)
	}
	questions := makePracticeQuestions(units, masteryByUnit, shuffleSeed)
	if len(questions) == 0 {
		return event.BadRequestError("could not create practice questions", nil)
	}
	for index := range questions {
		questions[index].Reason = reasonsByUnit[questions[index].UnitID]
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
		publicQuestions = append(publicQuestions, practiceQuestionPublic{ID: question.ID, UnitID: question.UnitID, UnitTitle: question.UnitTitle, Reason: question.Reason, Difficulty: question.Difficulty, Prompt: question.Prompt, Options: question.Options, Hints: question.Hints})
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

func selectCoursePracticeUnits(app core.App, ownerID, courseID, moduleID string, moduleOnly bool) ([]*core.Record, error) {
	courseID = strings.TrimSpace(courseID)
	moduleID = strings.TrimSpace(moduleID)
	if courseID == "" {
		return nil, errors.New("course_id is required")
	}
	if moduleOnly && moduleID == "" {
		return nil, errors.New("module_id is required for module practice")
	}
	if !moduleOnly && moduleID != "" {
		return nil, errors.New("module_id is only valid for module practice")
	}
	courses, err := app.FindRecordsByFilter("courses", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": courseID, "owner": ownerID})
	if err != nil {
		return nil, err
	}
	if len(courses) == 0 {
		return nil, errors.New("course is unavailable")
	}
	var content map[string]any
	if err := courses[0].UnmarshalJSONField("content", &content); err != nil {
		return nil, fmt.Errorf("course curriculum is invalid: %w", err)
	}
	curriculum, ok := content["curriculum"].(map[string]any)
	if !ok {
		return nil, errors.New("course has no knowledge curriculum")
	}
	rawModules, ok := curriculum["modules"].([]any)
	if !ok || len(rawModules) == 0 {
		return nil, errors.New("course has no knowledge modules")
	}
	outlineIDs := make([]string, 0)
	moduleFound := !moduleOnly
	seen := make(map[string]bool)
	for _, raw := range rawModules {
		module, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := module["id"].(string)
		if moduleOnly && id == moduleID {
			moduleFound = true
		}
		if moduleOnly && id != moduleID {
			continue
		}
		for _, outlineID := range assessmentStrings(module["knowledge_unit_ids"]) {
			if outlineID != "" && !seen[outlineID] {
				seen[outlineID] = true
				outlineIDs = append(outlineIDs, outlineID)
			}
		}
	}
	if !moduleFound {
		return nil, errors.New("module is unavailable in this course")
	}
	if len(outlineIDs) == 0 {
		return nil, errors.New("selected curriculum has no linked knowledge units")
	}
	if len(outlineIDs) > maxCoursePracticeUnits {
		return nil, fmt.Errorf("course practice is limited to %d knowledge items", maxCoursePracticeUnits)
	}
	ownedUnits, err := app.FindRecordsByFilter("knowledge_units", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": ownerID})
	if err != nil {
		return nil, err
	}
	unitByOutlineID := make(map[string]*core.Record, len(outlineIDs))
	for _, unit := range ownedUnits {
		var metadata map[string]any
		if err := unit.UnmarshalJSONField("metadata", &metadata); err != nil {
			continue
		}
		outlineID, _ := metadata["outline_unit_id"].(string)
		if metadata["generated"] == true && metadata["course_id"] == courseID && seen[outlineID] {
			unitByOutlineID[outlineID] = unit
		}
	}
	units := make([]*core.Record, 0, len(outlineIDs))
	for _, outlineID := range outlineIDs {
		if unit := unitByOutlineID[outlineID]; unit != nil {
			units = append(units, unit)
		}
	}
	if len(units) == 0 {
		return nil, errors.New("selected course has no available generated knowledge units")
	}
	return units, nil
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
	case "gap":
		units, _, err := selectPracticeGapUnits(app, ownerID, requestedIDs)
		return units, err
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
		return nil, errors.New("mode must be selected, due, weak, mixed, gap, course, or module")
	}
}

func selectPracticeGapUnits(app core.App, ownerID string, requestedIDs []string) ([]*core.Record, map[string]string, error) {
	if len(requestedIDs) > maxPracticeUnits {
		return nil, nil, fmt.Errorf("select no more than %d knowledge items", maxPracticeUnits)
	}
	for index := range requestedIDs {
		requestedIDs[index] = strings.TrimSpace(requestedIDs[index])
		if requestedIDs[index] == "" {
			return nil, nil, errors.New("knowledge item ID is required")
		}
	}
	units, err := app.FindRecordsByFilter("knowledge_units", "owner = {:owner}", "title", 0, 0, dbx.Params{"owner": ownerID})
	if err != nil {
		return nil, nil, err
	}
	masteryByUnit, err := loadPracticeMastery(app, ownerID)
	if err != nil {
		return nil, nil, err
	}
	unitByID := make(map[string]*core.Record, len(units))
	for _, unit := range units {
		unitByID[unit.Id] = unit
	}
	seeds := make([]*core.Record, 0, maxPracticeUnits)
	seedReasons := make(map[string]string)
	if len(requestedIDs) > 0 {
		seenSeeds := make(map[string]bool, len(requestedIDs))
		for _, id := range requestedIDs {
			if seenSeeds[id] {
				return nil, nil, errors.New("knowledge item IDs must be unique")
			}
			seenSeeds[id] = true
			unit, ok := unitByID[id]
			if !ok {
				return nil, nil, errors.New("knowledge item is unavailable")
			}
			seeds = append(seeds, unit)
			seedReasons[unit.Id] = "Selected focus"
		}
	} else {
		for _, unit := range units {
			mastery, practiced := masteryByUnit[unit.Id]
			if practiced && mastery.Score < gapPracticeThreshold {
				seeds = append(seeds, unit)
				seedReasons[unit.Id] = "Mastery below 50%"
			}
		}
		for _, unit := range units {
			if _, practiced := masteryByUnit[unit.Id]; !practiced {
				seeds = append(seeds, unit)
				seedReasons[unit.Id] = "Not practiced yet"
			}
		}
	}
	if len(seeds) > maxPracticeUnits {
		seeds = seeds[:maxPracticeUnits]
	}
	if len(seeds) == 0 {
		return nil, nil, errors.New("select a concept or create a knowledge gap first")
	}
	edges, err := app.FindRecordsByFilter("knowledge_edges", "owner = {:owner}", "id", 0, 0, dbx.Params{"owner": ownerID})
	if err != nil {
		return nil, nil, err
	}
	prerequisitesByUnit := make(map[string][]string)
	for _, edge := range edges {
		relationship := edge.GetString("relationship")
		if relationship == "requires" || relationship == "builds_on" {
			prerequisitesByUnit[edge.GetString("from_unit")] = append(prerequisitesByUnit[edge.GetString("from_unit")], edge.GetString("to_unit"))
		}
	}
	result := make([]*core.Record, 0, maxPracticeUnits)
	reasons := make(map[string]string, maxPracticeUnits)
	seen := make(map[string]bool, maxPracticeUnits)
	addUnit := func(unit *core.Record, reason string) {
		if unit != nil && !seen[unit.Id] && len(result) < maxPracticeUnits {
			seen[unit.Id] = true
			result = append(result, unit)
			reasons[unit.Id] = reason
		}
	}
	var addPrerequisites func(*core.Record, string, int, map[string]bool)
	addPrerequisites = func(unit *core.Record, rootTitle string, depth int, path map[string]bool) {
		if depth >= 3 || len(result) >= maxPracticeUnits {
			return
		}
		for _, prerequisiteID := range prerequisitesByUnit[unit.Id] {
			if path[prerequisiteID] {
				continue
			}
			prerequisite := unitByID[prerequisiteID]
			if prerequisite == nil {
				continue
			}
			mastery, practiced := masteryByUnit[prerequisite.Id]
			if practiced && mastery.Score >= 0.75 && mastery.Repetitions >= 2 {
				continue
			}
			addUnit(prerequisite, "Prerequisite for "+rootTitle)
			nextPath := make(map[string]bool, len(path)+1)
			for id := range path {
				nextPath[id] = true
			}
			nextPath[prerequisiteID] = true
			addPrerequisites(prerequisite, rootTitle, depth+1, nextPath)
		}
	}
	for _, seed := range seeds {
		addUnit(seed, seedReasons[seed.Id])
		addPrerequisites(seed, seed.GetString("title"), 0, map[string]bool{seed.Id: true})
		if len(result) == maxPracticeUnits {
			break
		}
	}
	return result, reasons, nil
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
		if mode == "weak" && mastery.GetFloat("mastery") > weakPracticeThreshold {
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

type practiceMastery struct {
	Score       float64
	Repetitions int
}

func loadPracticeMastery(app core.App, ownerID string) (map[string]practiceMastery, error) {
	records, err := app.FindRecordsByFilter("knowledge_mastery", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": ownerID})
	if err != nil {
		return nil, err
	}
	result := make(map[string]practiceMastery, len(records))
	for _, record := range records {
		result[record.GetString("unit")] = practiceMastery{Score: record.GetFloat("mastery"), Repetitions: int(record.GetFloat("repetitions"))}
	}
	return result, nil
}

func newPracticeShuffleSeed() (string, error) {
	seed := make([]byte, 16)
	if _, err := cryptorand.Read(seed); err != nil {
		return "", err
	}
	return hex.EncodeToString(seed), nil
}

func makePracticeQuestions(units []*core.Record, masteryByUnit map[string]practiceMastery, shuffleSeed string) []practiceQuestion {
	questions := make([]practiceQuestion, 0, len(units))
	for index, unit := range units {
		title := strings.TrimSpace(unit.GetString("title"))
		if title == "" {
			continue
		}
		definition := strings.TrimSpace(unit.GetString("description"))
		mastery := masteryByUnit[unit.Id]
		reverseRecall := mastery.Score >= 0.75 && mastery.Repetitions >= 2 && definition != ""
		difficulty := "recognition"
		if reverseRecall {
			difficulty = "recall"
		}
		question := practiceQuestion{
			ID: fmt.Sprintf("question-%d", index+1), UnitID: unit.Id, UnitTitle: title, Difficulty: difficulty,
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
		if reverseRecall {
			question.Prompt = fmt.Sprintf("Which concept is described by this explanation?\n\n%s", definition)
			question.CorrectChoice = title
			question.Hints = []string{"Look for the concept whose defining idea matches the explanation.", "Compare the key condition or relationship in the explanation to each concept title."}
			question.Options = append(question.Options, title)
			for _, candidate := range units {
				if candidate.Id == unit.Id {
					continue
				}
				choice := strings.TrimSpace(candidate.GetString("title"))
				if choice == "" || containsString(question.Options, choice) {
					continue
				}
				question.Options = append(question.Options, choice)
				if len(question.Options) == 4 {
					break
				}
			}
		} else {
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
		}
		for len(question.Options) < 4 {
			if reverseRecall {
				question.Options = append(question.Options, fmt.Sprintf("Another concept, different from %q (%d).", title, len(question.Options)))
			} else {
				question.Options = append(question.Options, fmt.Sprintf("A different explanation that does not describe %q (%d).", title, len(question.Options)))
			}
		}
		question.Options = stablePracticeShuffle(question.Options, shuffleSeed+unit.Id)
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
		if !known {
			return event.BadRequestError("answer every question before submitting", nil)
		}
		if !containsString(question.Options, answer) {
			return event.BadRequestError("answer is not a choice for this question", nil)
		}
		isCorrect := answer == answerKeys[question.ID]
		if isCorrect {
			correct++
		}
		results = append(results, map[string]any{"question_id": question.ID, "unit_id": question.UnitID, "correct": isCorrect, "feedback": practiceFeedback(isCorrect, question.Remediation), "remediation": question.Remediation})
	}
	score := 0.0
	if len(questions) > 0 {
		score = float64(correct) / float64(len(questions))
	}
	errAlreadySubmitted := errors.New("practice quiz is already submitted")
	err = event.App.RunInTransaction(func(tx core.App) error {
		current, findErr := tx.FindRecordsByFilter("adaptive_practice_quizzes", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": quiz.Id, "owner": user.Id})
		if findErr != nil {
			return findErr
		}
		if len(current) == 0 {
			return event.NotFoundError("practice quiz not found", nil)
		}
		if current[0].GetString("status") != "open" {
			return errAlreadySubmitted
		}
		for _, question := range questions {
			if saveErr := savePracticeEvidence(tx, user.Id, current[0].Id, question, input.Answers[question.ID] == answerKeys[question.ID]); saveErr != nil {
				return saveErr
			}
		}
		attempts := make([]map[string]any, 0)
		_ = current[0].UnmarshalJSONField("attempts", &attempts)
		attempts = append(attempts, map[string]any{"score": score, "submitted_at": time.Now().UTC(), "answers": input.Answers})
		current[0].Set("attempts", attempts)
		current[0].Set("status", "submitted")
		return tx.Save(current[0])
	})
	if errors.Is(err, errAlreadySubmitted) {
		return event.BadRequestError("practice quiz is already submitted", nil)
	}
	if err != nil {
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
