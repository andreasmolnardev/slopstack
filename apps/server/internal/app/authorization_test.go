package app

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestHasPermissionResolvesDirectAndGroupRules(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	user := createTestRecord(t, testApp, "users", map[string]any{"email": "user@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	group := createTestRecord(t, testApp, "groups", map[string]any{"name": "editors"})
	createTestRecord(t, testApp, "group_members", map[string]any{"user": user.Id, "group": group.Id})
	createTestRecord(t, testApp, "group_permissions", map[string]any{"group": group.Id, "permission": "todos.read"})

	allowed, err := HasPermission(testApp, user, false, "todos.read")
	if err != nil || !allowed {
		t.Fatalf("group grant should allow access: allowed=%v err=%v", allowed, err)
	}

	createTestRecord(t, testApp, "group_permissions", map[string]any{"group": group.Id, "permission": "todos.read", "denied": true})
	allowed, err = HasPermission(testApp, user, false, "todos.read")
	if err != nil || allowed {
		t.Fatalf("group deny should override group grant: allowed=%v err=%v", allowed, err)
	}

	createTestRecord(t, testApp, "user_permissions", map[string]any{"user": user.Id, "permission": "todos.read"})
	allowed, err = HasPermission(testApp, user, false, "todos.read")
	if err != nil || !allowed {
		t.Fatalf("direct user allow should override group rules: allowed=%v err=%v", allowed, err)
	}

	createTestRecord(t, testApp, "user_permissions", map[string]any{"user": user.Id, "permission": "todos.read", "denied": true})
	allowed, err = HasPermission(testApp, user, true, "todos.read")
	if err != nil || allowed {
		t.Fatalf("direct user deny should override superuser: allowed=%v err=%v", allowed, err)
	}
}

func createTestRecord(t *testing.T, app core.App, collectionName string, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	for name, value := range fields {
		record.Set(name, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("save %s record: %v", collectionName, err)
	}
	return record
}
