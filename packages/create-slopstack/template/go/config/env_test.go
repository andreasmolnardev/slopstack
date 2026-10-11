package config

import "testing"

func TestLookupPrefersPrimaryAndFallsBack(t *testing.T) {
	t.Setenv("TEST_PRIMARY", "new")
	t.Setenv("TEST_LEGACY", "old")
	if got := Lookup("TEST_PRIMARY", "TEST_LEGACY", "fallback"); got != "new" {
		t.Fatalf("Lookup() = %q, want primary value", got)
	}
	t.Setenv("TEST_PRIMARY", "")
	if got := Lookup("TEST_PRIMARY", "TEST_LEGACY", "fallback"); got != "old" {
		t.Fatalf("Lookup() = %q, want legacy value", got)
	}
	t.Setenv("TEST_LEGACY", "")
	if got := Lookup("TEST_PRIMARY", "TEST_LEGACY", "fallback"); got != "fallback" {
		t.Fatalf("Lookup() = %q, want fallback", got)
	}
}

func TestTypedValuesUseFallbackForInvalidInput(t *testing.T) {
	t.Setenv("TEST_BOOL", "not-a-bool")
	t.Setenv("TEST_INT", "not-an-int")
	if got := Bool("TEST_BOOL", "", true); !got {
		t.Fatal("Bool() should use fallback for malformed input")
	}
	if got := Int("TEST_INT", "", 17); got != 17 {
		t.Fatalf("Int() = %d, want fallback 17", got)
	}
}
