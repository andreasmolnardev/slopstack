package app

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConsumeSsoLinkIntentIsBoundAndOneTime(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()

	testApp.Store().Set("sso-link-intent:valid", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(time.Minute)})
	if !consumeSsoLinkIntent(testApp, "user-a", "valid") {
		t.Fatal("valid user should consume their intent")
	}
	if consumeSsoLinkIntent(testApp, "user-a", "valid") {
		t.Fatal("intent must be one-time")
	}

	testApp.Store().Set("sso-link-intent:other", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(time.Minute)})
	if consumeSsoLinkIntent(testApp, "user-b", "other") {
		t.Fatal("another account must not consume the intent")
	}
	if consumeSsoLinkIntent(testApp, "user-a", "other") {
		t.Fatal("failed ownership check must consume the intent")
	}

	testApp.Store().Set("sso-link-intent:expired", ssoLinkIntent{UserID: "user-a", ExpiresAt: time.Now().Add(-time.Minute)})
	if consumeSsoLinkIntent(testApp, "user-a", "expired") {
		t.Fatal("expired intents must be rejected")
	}
}

func TestOAuthSignupPolicyBlocksNewPublicAccountsOnly(t *testing.T) {
	config := Config{RegistrationEnabled: false}
	if publicOAuthSignupAllowed(config, true, false) {
		t.Fatal("public first-time OAuth signup should be blocked")
	}
	if !publicOAuthSignupAllowed(config, false, false) {
		t.Fatal("existing users should still be able to sign in")
	}
	if !publicOAuthSignupAllowed(config, true, true) {
		t.Fatal("superusers should retain account recovery")
	}
}

func TestSsoOnlyPasswordPolicyHasLockoutFallback(t *testing.T) {
	config := Config{SSOOnly: true}
	if !ssoOnlyBlocksPassword(config, true, 1) {
		t.Fatal("configured SSO-only policy should block password login")
	}
	if ssoOnlyBlocksPassword(config, false, 1) || ssoOnlyBlocksPassword(config, true, 0) {
		t.Fatal("password login should remain available without a usable OAuth provider")
	}
}

func TestUserEmailCollisionIgnoresCase(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	createTestRecord(t, testApp, "users", map[string]any{"email": "member@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	candidate := core.NewRecord(users)
	candidate.SetEmail("MEMBER@EXAMPLE.COM")
	collision, err := userEmailCollision(testApp, candidate)
	if err != nil || !collision {
		t.Fatalf("case variant should collide: collision=%v err=%v", collision, err)
	}
}
