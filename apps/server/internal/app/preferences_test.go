package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

func TestValidateUserPreferences(t *testing.T) {
	prefs := defaultUserPreferences()
	if err := validateUserPreferences(prefs); err != nil {
		t.Fatalf("defaults should be valid: %v", err)
	}

	prefs.Navigation = "floating"
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("unsupported navigation style should fail validation")
	}

	prefs = defaultUserPreferences()
	prefs.TimeZone = "Mars/Olympus_Mons"
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("unknown time zone should fail validation")
	}

	prefs = defaultUserPreferences()
	prefs.ThemeTokens.Primary = "red; background:url(javascript:alert(1))"
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("unsafe theme values should fail validation")
	}

	prefs = defaultUserPreferences()
	prefs.Motion.Style = "bounce-forever"
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("unsupported motion style should fail validation")
	}

	prefs = defaultUserPreferences()
	prefs.LearningInterests = []string{"", "science"}
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("blank learning interest should fail validation")
	}
	prefs = defaultUserPreferences()
	prefs.DefaultDifficulty = "expert"
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("unsupported default difficulty should fail validation")
	}
	prefs = defaultUserPreferences()
	prefs.TargetMinutes = 120
	if err := validateUserPreferences(prefs); err == nil {
		t.Fatal("out of range target minutes should fail validation")
	}
}

func TestReadPreferencesFillsDefaultsForLegacyAndPartialRecords(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "profile-legacy@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	user.Set("preferences", map[string]any{
		"locale": "en-GB", "themeTokens": map[string]any{"primary": "#112233"},
		"motion": map[string]any{"style": "fade"}, "learningInterests": []string{"astronomy"},
	})
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	prefs := readUserPreferences(user)
	if prefs.Locale != "en-GB" || prefs.ThemeTokens.Primary != "#112233" || prefs.ThemeTokens.Accent == "" || prefs.Motion.Style != "fade" || prefs.Motion.Duration == "" {
		t.Fatalf("legacy nested settings lost defaults: %#v", prefs)
	}
	if prefs.TargetMinutes != 20 || prefs.DefaultDifficulty != "intermediate" || !prefs.Narration || !prefs.Captions || prefs.PreferredLanguage != "en" {
		t.Fatalf("new fields did not receive defaults: %#v", prefs)
	}
	if len(prefs.LearningInterests) != 1 || prefs.LearningInterests[0] != "astronomy" || prefs.PriorKnowledge == nil {
		t.Fatalf("existing and new lists were not preserved: %#v", prefs)
	}
	if prefs.LearningGoals == nil {
		t.Fatal("new goals list should default to empty")
	}
}

func TestPreferencesPartialPatchPreservesUnspecifiedFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := EnsureCollections(app); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, app, "users", map[string]any{"email": "profile-patch@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	prefs := defaultUserPreferences()
	prefs.LearningInterests = []string{"music", "history"}
	prefs.LearningGoals = []string{"write a novel"}
	prefs.Narration = false
	user.Set("preferences", prefs)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPatch, "/api/me/preferences", strings.NewReader(`{"targetMinutes":35,"captions":false}`))
	response := httptest.NewRecorder()
	event := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Request: request, Response: response}}
	if err := patchMyPreferencesRoute(event); err != nil {
		t.Fatal(err)
	}
	updated, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	got := readUserPreferences(updated)
	if got.TargetMinutes != 35 || got.Captions || got.Narration || len(got.LearningInterests) != 2 || got.LearningInterests[1] != "history" || len(got.LearningGoals) != 1 || got.LearningGoals[0] != "write a novel" {
		t.Fatalf("partial update changed unrelated preferences: %#v", got)
	}
}
