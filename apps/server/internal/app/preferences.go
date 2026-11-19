package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase/core"
)

type UserPreferences struct {
	Locale            string            `json:"locale"`
	TimeZone          string            `json:"timeZone"`
	DateFormat        string            `json:"dateFormat"`
	TimeFormat        string            `json:"timeFormat"`
	Theme             string            `json:"theme"`
	Navigation        string            `json:"navigation"`
	ThemeTokens       ThemeTokens       `json:"themeTokens"`
	Motion            MotionPreferences `json:"motion"`
	LearningInterests []string          `json:"learningInterests"`
	LearningGoals     []string          `json:"learningGoals"`
	PriorKnowledge    []string          `json:"priorKnowledge"`
	PreferredLanguage string            `json:"preferredLanguage"`
	DefaultDifficulty string            `json:"defaultDifficulty"`
	TargetMinutes     int               `json:"targetMinutes"`
	Narration         bool              `json:"narration"`
	Captions          bool              `json:"captions"`
}

type ThemeTokens struct {
	Primary string `json:"primary"`
	Accent  string `json:"accent"`
	Radius  string `json:"radius"`
}

type MotionPreferences struct {
	Style    string `json:"style"`
	Duration string `json:"duration"`
	Easing   string `json:"easing"`
}

type userPreferencesPatchInput struct {
	Body struct {
		Locale            *string            `json:"locale,omitempty"`
		TimeZone          *string            `json:"timeZone,omitempty"`
		DateFormat        *string            `json:"dateFormat,omitempty"`
		TimeFormat        *string            `json:"timeFormat,omitempty"`
		Theme             *string            `json:"theme,omitempty"`
		Navigation        *string            `json:"navigation,omitempty"`
		ThemeTokens       *ThemeTokens       `json:"themeTokens,omitempty"`
		Motion            *MotionPreferences `json:"motion,omitempty"`
		LearningInterests *[]string          `json:"learningInterests,omitempty"`
		LearningGoals     *[]string          `json:"learningGoals,omitempty"`
		PriorKnowledge    *[]string          `json:"priorKnowledge,omitempty"`
		PreferredLanguage *string            `json:"preferredLanguage,omitempty"`
		DefaultDifficulty *string            `json:"defaultDifficulty,omitempty"`
		TargetMinutes     *int               `json:"targetMinutes,omitempty"`
		Narration         *bool              `json:"narration,omitempty"`
		Captions          *bool              `json:"captions,omitempty"`
	} `json:"body"`
}
type userPreferencesOutput struct{ Body UserPreferences }

func registerPreferencesAPI(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "getMyPreferences", Method: http.MethodGet, Path: "/api/me/preferences",
		Tags: []string{"Account"}, Summary: "Get the current user's preferences",
		Security: []map[string][]string{{"pocketbaseAuth": {}}}, Errors: []int{http.StatusUnauthorized},
	}, func(context.Context, *struct{}) (*userPreferencesOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "updateMyPreferences", Method: http.MethodPatch, Path: "/api/me/preferences",
		Tags: []string{"Account"}, Summary: "Update the current user's preferences",
		Security: []map[string][]string{{"pocketbaseAuth": {}}}, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized},
	}, func(context.Context, *userPreferencesPatchInput) (*userPreferencesOutput, error) { return nil, nil })
}

func registerPreferencesRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/me/preferences", getMyPreferencesRoute)
	e.Router.PATCH("/api/me/preferences", patchMyPreferencesRoute)
}

func defaultUserPreferences() UserPreferences {
	return UserPreferences{Locale: "en-US", TimeZone: "UTC", DateFormat: "MMM d, yyyy", TimeFormat: "12h", Theme: "light", Navigation: "sidebar", ThemeTokens: ThemeTokens{Primary: "#007acc", Accent: "#dbeeff", Radius: "0.75rem"}, Motion: MotionPreferences{Style: "scale", Duration: "normal", Easing: "standard"}, LearningInterests: []string{}, LearningGoals: []string{}, PriorKnowledge: []string{}, PreferredLanguage: "en", DefaultDifficulty: "intermediate", TargetMinutes: 20, Narration: true, Captions: true}
}

func getMyPreferencesRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, readUserPreferences(user))
}

func patchMyPreferencesRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	var patch userPreferencesPatchInput
	if err := json.NewDecoder(event.Request.Body).Decode(&patch.Body); err != nil {
		return event.BadRequestError("invalid preferences body", err)
	}
	prefs := readUserPreferences(user)
	if patch.Body.Locale != nil {
		prefs.Locale = *patch.Body.Locale
	}
	if patch.Body.TimeZone != nil {
		prefs.TimeZone = *patch.Body.TimeZone
	}
	if patch.Body.DateFormat != nil {
		prefs.DateFormat = *patch.Body.DateFormat
	}
	if patch.Body.TimeFormat != nil {
		prefs.TimeFormat = *patch.Body.TimeFormat
	}
	if patch.Body.Theme != nil {
		prefs.Theme = *patch.Body.Theme
	}
	if patch.Body.Navigation != nil {
		prefs.Navigation = *patch.Body.Navigation
	}
	if patch.Body.ThemeTokens != nil {
		prefs.ThemeTokens = *patch.Body.ThemeTokens
	}
	if patch.Body.Motion != nil {
		prefs.Motion = *patch.Body.Motion
	}
	if patch.Body.LearningInterests != nil {
		prefs.LearningInterests = *patch.Body.LearningInterests
	}
	if patch.Body.LearningGoals != nil {
		prefs.LearningGoals = *patch.Body.LearningGoals
	}
	if patch.Body.PriorKnowledge != nil {
		prefs.PriorKnowledge = *patch.Body.PriorKnowledge
	}
	if patch.Body.PreferredLanguage != nil {
		prefs.PreferredLanguage = *patch.Body.PreferredLanguage
	}
	if patch.Body.DefaultDifficulty != nil {
		prefs.DefaultDifficulty = *patch.Body.DefaultDifficulty
	}
	if patch.Body.TargetMinutes != nil {
		prefs.TargetMinutes = *patch.Body.TargetMinutes
	}
	if patch.Body.Narration != nil {
		prefs.Narration = *patch.Body.Narration
	}
	if patch.Body.Captions != nil {
		prefs.Captions = *patch.Body.Captions
	}
	if err := validateUserPreferences(prefs); err != nil {
		return event.BadRequestError("invalid preferences", err)
	}
	user.Set("preferences", prefs)
	if err := event.App.Save(user); err != nil {
		return event.InternalServerError("could not save preferences", err)
	}
	return event.JSON(http.StatusOK, prefs)
}

func readUserPreferences(user *core.Record) UserPreferences {
	prefs := defaultUserPreferences()
	data, err := json.Marshal(user.Get("preferences"))
	if err == nil {
		_ = json.Unmarshal(data, &prefs)
	}
	defaults := defaultUserPreferences()
	if prefs.Locale == "" {
		prefs.Locale = defaults.Locale
	}
	if prefs.TimeZone == "" {
		prefs.TimeZone = defaults.TimeZone
	}
	if prefs.DateFormat == "" {
		prefs.DateFormat = defaults.DateFormat
	}
	if prefs.TimeFormat == "" {
		prefs.TimeFormat = defaults.TimeFormat
	}
	if prefs.Theme == "" {
		prefs.Theme = defaults.Theme
	}
	if prefs.Navigation == "" {
		prefs.Navigation = defaults.Navigation
	}
	if prefs.ThemeTokens.Primary == "" {
		prefs.ThemeTokens.Primary = defaults.ThemeTokens.Primary
	}
	if prefs.ThemeTokens.Accent == "" {
		prefs.ThemeTokens.Accent = defaults.ThemeTokens.Accent
	}
	if prefs.ThemeTokens.Radius == "" {
		prefs.ThemeTokens.Radius = defaults.ThemeTokens.Radius
	}
	if prefs.Motion.Style == "" {
		prefs.Motion.Style = defaults.Motion.Style
	}
	if prefs.Motion.Duration == "" {
		prefs.Motion.Duration = defaults.Motion.Duration
	}
	if prefs.Motion.Easing == "" {
		prefs.Motion.Easing = defaults.Motion.Easing
	}
	if prefs.LearningInterests == nil {
		prefs.LearningInterests = defaults.LearningInterests
	}
	if prefs.LearningGoals == nil {
		prefs.LearningGoals = defaults.LearningGoals
	}
	if prefs.PriorKnowledge == nil {
		prefs.PriorKnowledge = defaults.PriorKnowledge
	}
	if prefs.PreferredLanguage == "" {
		prefs.PreferredLanguage = defaults.PreferredLanguage
	}
	if prefs.DefaultDifficulty == "" {
		prefs.DefaultDifficulty = defaults.DefaultDifficulty
	}
	if prefs.TargetMinutes == 0 {
		prefs.TargetMinutes = defaults.TargetMinutes
	}
	return prefs
}

func validateUserPreferences(p UserPreferences) error {
	colorToken := regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	if !colorToken.MatchString(p.ThemeTokens.Primary) || !colorToken.MatchString(p.ThemeTokens.Accent) {
		return fmt.Errorf("theme color tokens must be six-digit hex colors")
	}
	if p.ThemeTokens.Radius != "0.5rem" && p.ThemeTokens.Radius != "0.75rem" && p.ThemeTokens.Radius != "1rem" {
		return fmt.Errorf("unsupported theme radius")
	}
	if p.Motion.Style != "fade" && p.Motion.Style != "scale" && p.Motion.Style != "slide" && p.Motion.Style != "none" {
		return fmt.Errorf("unsupported motion style")
	}
	if p.Motion.Duration != "fast" && p.Motion.Duration != "normal" && p.Motion.Duration != "slow" {
		return fmt.Errorf("unsupported motion duration")
	}
	if p.Motion.Easing != "standard" && p.Motion.Easing != "smooth" && p.Motion.Easing != "snappy" {
		return fmt.Errorf("unsupported motion easing")
	}
	if _, err := time.LoadLocation(p.TimeZone); err != nil {
		return fmt.Errorf("timeZone must be a valid IANA time zone")
	}
	if p.DateFormat != "MMM d, yyyy" && p.DateFormat != "yyyy-MM-dd" && p.DateFormat != "MM/dd/yyyy" && p.DateFormat != "dd/MM/yyyy" {
		return fmt.Errorf("unsupported dateFormat")
	}
	if p.TimeFormat != "12h" && p.TimeFormat != "24h" {
		return fmt.Errorf("timeFormat must be 12h or 24h")
	}
	if p.Theme != "light" && p.Theme != "dark" && p.Theme != "system" {
		return fmt.Errorf("theme must be light, dark, or system")
	}
	if p.Navigation != "sidebar" && p.Navigation != "topbar" && p.Navigation != "rail" && p.Navigation != "bottom" {
		return fmt.Errorf("navigation must be sidebar, topbar, rail, or bottom")
	}
	if len(p.Locale) < 2 || len(p.Locale) > 35 {
		return fmt.Errorf("locale must be a valid locale tag")
	}
	if err := validatePreferenceList("learningInterests", p.LearningInterests); err != nil {
		return err
	}
	if err := validatePreferenceList("learningGoals", p.LearningGoals); err != nil {
		return err
	}
	if err := validatePreferenceList("priorKnowledge", p.PriorKnowledge); err != nil {
		return err
	}
	if !regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`).MatchString(p.PreferredLanguage) {
		return fmt.Errorf("preferredLanguage must be a valid language tag")
	}
	if p.DefaultDifficulty != "beginner" && p.DefaultDifficulty != "intermediate" && p.DefaultDifficulty != "advanced" {
		return fmt.Errorf("defaultDifficulty must be beginner, intermediate, or advanced")
	}
	if p.TargetMinutes < 5 || p.TargetMinutes > 60 {
		return fmt.Errorf("targetMinutes must be between 5 and 60")
	}
	return nil
}

func validatePreferenceList(name string, values []string) error {
	if len(values) > 20 {
		return fmt.Errorf("%s can contain at most 20 entries", name)
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "" || len([]rune(strings.TrimSpace(value))) > 100 {
			return fmt.Errorf("%s entries must contain between 1 and 100 characters", name)
		}
	}
	return nil
}
