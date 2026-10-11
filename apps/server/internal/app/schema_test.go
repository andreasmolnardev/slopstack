package app

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newTestApp(t *testing.T) core.App {
	t.Helper()
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(testApp.Cleanup)
	return testApp
}

func TestEnsureCollectionsCreatesCoreCollections(t *testing.T) {
	testApp := newTestApp(t)

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{
		"users", "groups", "permissions", "group_permissions",
		"user_permissions", "group_members", "todos", "audit_logs",
	} {
		if _, err := testApp.FindCollectionByNameOrId(name); err != nil {
			t.Fatalf("collection %q must exist: %v", name, err)
		}
	}

	todos, err := testApp.FindCollectionByNameOrId("todos")
	if err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]struct {
		kind     string
		required bool
	}{
		"owner":     {kind: "text", required: true},
		"title":     {kind: "text", required: true},
		"completed": {kind: "bool"},
		"due_date":  {kind: "date"},
	} {
		f := todos.Fields.GetByName(field)
		if f == nil {
			t.Fatalf("todos must include %q", field)
		}
		if f.Type() != want.kind {
			t.Fatalf("todos.%s type = %q, want %q", field, f.Type(), want.kind)
		}
		if fieldRequired(f) != want.required {
			t.Fatalf("todos.%s required = %v, want %v", field, fieldRequired(f), want.required)
		}
	}
}

func TestEnsureCollectionsAddsAdminFlagToUsers(t *testing.T) {
	testApp := newTestApp(t)

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if users.Fields.GetByName("isAdmin") == nil {
		t.Fatal("users collection must include isAdmin")
	}
}

func TestEnsureCollectionsRepairsUsersMissingAdminFlag(t *testing.T) {
	testApp := newTestApp(t)

	// The test fixture ships a users collection; strip isAdmin to emulate a
	// database created before the flag existed.
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.RemoveByName("isAdmin")
	if err := testApp.Save(users); err != nil {
		t.Fatal(err)
	}
	if users.Fields.GetByName("isAdmin") != nil {
		t.Fatal("precondition: users must not have isAdmin yet")
	}

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	repaired, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	admin := repaired.Fields.GetByName("isAdmin")
	if admin == nil {
		t.Fatal("repair must add the missing isAdmin flag")
	}
	if admin.Type() != "bool" {
		t.Fatalf("isAdmin type = %q, want bool", admin.Type())
	}
}

func TestLegacySchemaUpgradePreservesUserAndCollectionIdentity(t *testing.T) {
	testApp := newTestApp(t)

	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	collectionID := users.Id
	users.Fields.RemoveByName("display_name")
	users.Fields.RemoveByName("disabled")
	users.Fields.RemoveByName("isAdmin")
	if err := testApp.Save(users); err != nil {
		t.Fatal(err)
	}

	legacyUser, err := testApp.FindAuthRecordByEmail("users", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}
	userID := legacyUser.Id
	userEmail := legacyUser.Email()
	tokenKey := legacyUser.TokenKey()

	// Match the app's bootstrap sequence against a database from before the
	// declared user fields and migration were added. Both operations must be
	// safe to repeat without replacing the collection or its records.
	for range 2 {
		if err := EnsureCollections(testApp); err != nil {
			t.Fatal(err)
		}
		if err := testApp.RunAppMigrations(); err != nil {
			t.Fatal(err)
		}
	}

	upgradedUsers, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if upgradedUsers.Id != collectionID {
		t.Fatalf("users collection ID changed: got %q, want %q", upgradedUsers.Id, collectionID)
	}
	for _, field := range []string{"display_name", "disabled", "isAdmin"} {
		if upgradedUsers.Fields.GetByName(field) == nil {
			t.Errorf("upgraded users collection is missing %q", field)
		}
	}

	upgradedUser, err := testApp.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("legacy user %q was not preserved: %v", userID, err)
	}
	if upgradedUser.Email() != userEmail {
		t.Errorf("legacy user email changed: got %q, want %q", upgradedUser.Email(), userEmail)
	}
	if upgradedUser.TokenKey() != tokenKey {
		t.Error("legacy user token key changed during schema upgrade")
	}
}

func TestEnsureCollectionsIsIdempotent(t *testing.T) {
	testApp := newTestApp(t)

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	users, err := testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	before := len(users.Fields.FieldNames())

	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	users, err = testApp.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if got := len(users.Fields.FieldNames()); got != before {
		t.Fatalf("field count changed on second run: %d -> %d", before, got)
	}
}

// fieldRequired reports whether a field is declared required, without depending
// on the concrete field type.
func fieldRequired(field core.Field) bool {
	switch typed := field.(type) {
	case *core.TextField:
		return typed.Required
	case *core.BoolField:
		return typed.Required
	case *core.DateField:
		return typed.Required
	case *core.JSONField:
		return typed.Required
	}
	return false
}
