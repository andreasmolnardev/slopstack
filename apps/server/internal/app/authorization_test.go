package app

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
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

func TestTodoLookupRequiresOwnerMatch(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	owner := createTestRecord(t, testApp, "users", map[string]any{"email": "owner@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	other := createTestRecord(t, testApp, "users", map[string]any{"email": "other@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	todo := createTestRecord(t, testApp, "todos", map[string]any{"owner": owner.Id, "title": "private task"})

	got, err := findTodoForOwner(testApp, todo.Id, owner.Id)
	if err != nil || got == nil || got.Id != todo.Id {
		t.Fatalf("owner should read their todo: got=%v err=%v", got, err)
	}
	got, err = findTodoForOwner(testApp, todo.Id, other.Id)
	if err != nil || got != nil {
		t.Fatalf("another user must not find this todo: got=%v err=%v", got, err)
	}
}

func TestCurrentUserRejectsMissingAuthentication(t *testing.T) {
	_, err := CurrentUser(&core.RequestEvent{})
	if err == nil {
		t.Fatal("missing auth should be rejected")
	}
	var apiError *router.ApiError
	if !errors.As(err, &apiError) || apiError.Status != 401 {
		t.Fatalf("missing auth should return 401, got %v", err)
	}
}

func TestAuthorizeRequiresPermission(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}
	user := createTestRecord(t, testApp, "users", map[string]any{"email": "authorize@example.com", "password": "secret123456", "passwordConfirm": "secret123456"})
	event := &core.RequestEvent{App: testApp, Auth: user}

	err = Authorize(event, "admin.users.manage")
	var apiError *router.ApiError
	if !errors.As(err, &apiError) || apiError.Status != 403 {
		t.Fatalf("missing permission should return 403, got %v", err)
	}

	createTestRecord(t, testApp, "user_permissions", map[string]any{"user": user.Id, "permission": "admin.users.manage"})
	if err := Authorize(event, "admin.users.manage"); err != nil {
		t.Fatalf("direct permission grant should allow access, got %v", err)
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
