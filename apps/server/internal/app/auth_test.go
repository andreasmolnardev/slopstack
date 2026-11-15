package app

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
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

func TestDisabledUserRequestMiddlewareRejectsExistingToken(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, testApp, "users", map[string]any{"email": "disabled@example.com", "password": "secret123456", "passwordConfirm": "secret123456", "disabled": true})
	if _, err := testApp.DB().NewQuery("UPDATE users SET disabled = 1 WHERE id = {:id}").Bind(map[string]any{"id": user.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	err = rejectDisabledUser(&core.RequestEvent{App: testApp, Auth: user})
	var apiError *router.ApiError
	if !errors.As(err, &apiError) || apiError.Status != 401 {
		t.Fatalf("disabled account request should be unauthorized, got %v", err)
	}
	client := subscriptions.NewDefaultClient()
	client.Set(apis.RealtimeClientAuthKey, user)
	testApp.SubscriptionsBroker().Register(client)
	if revoked := revokeDisabledRealtimeClients(testApp, user.Id); revoked != 1 || !client.IsDiscarded() {
		t.Fatalf("disabling an account must close its existing realtime client, revoked=%d discarded=%v", revoked, client.IsDiscarded())
	}
	if _, err := testApp.DB().NewQuery("UPDATE users SET disabled = 0 WHERE id = {:id}").Bind(map[string]any{"id": user.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	if err := rejectDisabledUser(&core.RequestEvent{App: testApp, Auth: user}); err != nil {
		t.Fatalf("enabled account should pass request middleware, got %v", err)
	}
}

func TestOAuthEmailMatchCannotSilentlyLinkExistingAccount(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, testApp, "users", map[string]any{"email": "member@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RecordAuthWithOAuth2RequestEvent{
		RequestEvent: &core.RequestEvent{App: testApp},
		ProviderName: "oidc2",
		OAuth2User:   &auth.AuthUser{Id: "provider-user-1", Email: "member@example.com"},
		Record:       user,
		IsNewRecord:  false,
	}
	event.Request = httptest.NewRequest("POST", "/api/collections/users/auth-with-oauth2", nil)
	event.Collection = users
	err = validateOAuthAssociation(event, Config{RegistrationEnabled: true})
	var apiError *router.ApiError
	if !errors.As(err, &apiError) || apiError.Status != 403 {
		t.Fatalf("matching provider email must not silently attach to an existing account, got %v", err)
	}

	linked := core.NewExternalAuth(testApp)
	linked.SetCollectionRef(users.Id)
	linked.SetRecordRef(user.Id)
	linked.SetProvider("oidc2")
	linked.SetProviderId("provider-user-1")
	if err := testApp.Save(linked); err != nil {
		t.Fatal(err)
	}
	if err := validateOAuthAssociation(event, Config{RegistrationEnabled: true}); err != nil {
		t.Fatalf("previously linked provider identity should remain usable: %v", err)
	}
}

func TestCannotDeleteLastExternalAuthThroughAPI(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, testApp, "users", map[string]any{"email": "last-auth@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	identity := core.NewExternalAuth(testApp)
	identity.SetCollectionRef(user.Collection().Id)
	identity.SetRecordRef(user.Id)
	identity.SetProvider("google")
	identity.SetProviderId("one")
	if err := testApp.Save(identity); err != nil {
		t.Fatal(err)
	}
	err = protectLastExternalAuth(&core.RecordRequestEvent{RequestEvent: &core.RequestEvent{App: testApp}, Record: identity.Record})
	var apiError *router.ApiError
	if !errors.As(err, &apiError) || apiError.Status != 403 {
		t.Fatalf("deleting the last provider must be forbidden, got %v", err)
	}
}

func TestOAuthSignupRequiresProviderVerifiedEmailWhenConfigured(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	event := &core.RecordAuthWithOAuth2RequestEvent{
		RequestEvent: &core.RequestEvent{App: testApp},
		ProviderName: "oidc2",
		OAuth2User:   &auth.AuthUser{Id: "provider-user-2"},
		IsNewRecord:  true,
	}
	event.Collection = users
	if err := validateOAuthAssociation(event, Config{RegistrationEnabled: true, RequireVerifiedEmail: true}); err == nil {
		t.Fatal("new OAuth accounts without a provider-verified email must be rejected")
	}
	event.OAuth2User.Email = "verified@example.com"
	if err := validateOAuthAssociation(event, Config{RegistrationEnabled: true, RequireVerifiedEmail: true}); err != nil {
		t.Fatalf("new OAuth account with a provider-verified email should pass: %v", err)
	}
}
