package app

import "testing"

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
}
