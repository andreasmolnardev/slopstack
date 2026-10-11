package authorization

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestAllows(t *testing.T) {
	tests := []struct {
		name       string
		principal  Principal
		permission string
		rules      []Rule
		want       bool
	}{
		{name: "unauthenticated denied", permission: "todo:read"},
		{name: "authenticated default denied", principal: Principal{ID: "u1"}, permission: "todo:read"},
		{name: "user grant", principal: Principal{ID: "u1"}, permission: "todo:read", rules: []Rule{{SubjectID: "u1", Permission: "todo:read", Effect: Allow}}, want: true},
		{name: "role grant", principal: Principal{ID: "u1", Roles: []string{"editor"}}, permission: "todo:write", rules: []Rule{{Role: "editor", Permission: "todo:write", Effect: Allow}}, want: true},
		{name: "unrelated permission", principal: Principal{ID: "u1"}, permission: "todo:write", rules: []Rule{{SubjectID: "u1", Permission: "todo:read", Effect: Allow}}},
		{name: "deny overrides user and role grants", principal: Principal{ID: "u1", Roles: []string{"editor"}}, permission: "todo:write", rules: []Rule{{Role: "editor", Permission: "todo:write", Effect: Allow}, {SubjectID: "u1", Permission: "todo:write", Effect: Deny}}},
		{name: "deny precedes later user and role grants", principal: Principal{ID: "u1", Roles: []string{"editor"}}, permission: "todo:write", rules: []Rule{{SubjectID: "u1", Permission: "todo:write", Effect: Deny}, {Role: "editor", Permission: "todo:write", Effect: Allow}, {SubjectID: "u1", Permission: "todo:write", Effect: Allow}}},
		{name: "deny overrides superuser", principal: Principal{ID: "root", Superuser: true}, permission: "todo:write", rules: []Rule{{SubjectID: "root", Permission: "todo:write", Effect: Deny}}},
		{name: "superuser allowed", principal: Principal{ID: "root", Superuser: true}, permission: "todo:write", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Allows(tt.principal, tt.permission, tt.rules); got != tt.want {
				t.Fatalf("Allows() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestLoadPocketBaseDirectUserGrantsAndDenies(t *testing.T) {
	app := newAuthorizationTestApp(t)
	createAuthorizationCollections(t, app)
	createAuthorizationRecord(t, app, "user_permissions", map[string]any{
		"user": "user-1", "permission": "todo:read", "denied": false,
	})
	createAuthorizationRecord(t, app, "user_permissions", map[string]any{
		"user": "user-1", "permission": "todo:delete", "denied": false,
	})
	createAuthorizationRecord(t, app, "user_permissions", map[string]any{
		"user": "user-1", "permission": "todo:delete", "denied": true,
	})

	roles, rules, err := LoadPocketBase(app, "user-1")
	if err != nil {
		t.Fatalf("LoadPocketBase() error = %v", err)
	}
	if len(roles) != 0 {
		t.Fatalf("roles = %v, want no roles", roles)
	}
	if got := Allows(Principal{ID: "user-1"}, "todo:read", rules); !got {
		t.Fatal("direct user grant should allow todo:read")
	}
	if got := Allows(Principal{ID: "user-1"}, "todo:delete", rules); got {
		t.Fatal("direct user deny should reject todo:delete")
	}
}

func TestLoadPocketBaseGroupMembershipAndGrant(t *testing.T) {
	app := newAuthorizationTestApp(t)
	createAuthorizationCollections(t, app)
	createAuthorizationRecord(t, app, "group_members", map[string]any{
		"user": "user-1", "group": "group-editors",
	})
	createAuthorizationRecord(t, app, "group_permissions", map[string]any{
		"group": "group-editors", "permission": "todo:write",
	})

	roles, rules, err := LoadPocketBase(app, "user-1")
	if err != nil {
		t.Fatalf("LoadPocketBase() error = %v", err)
	}
	if len(roles) != 1 || roles[0] != "group-editors" {
		t.Fatalf("roles = %v, want [group-editors]", roles)
	}
	if got := Allows(Principal{ID: "user-1", Roles: roles}, "todo:write", rules); !got {
		t.Fatal("group permission should allow todo:write for a member")
	}
}

func TestLoadPocketBaseMissingSubject(t *testing.T) {
	app := newAuthorizationTestApp(t)
	createAuthorizationCollections(t, app)
	createAuthorizationRecord(t, app, "user_permissions", map[string]any{
		"user": "user-1", "permission": "todo:read", "denied": false,
	})

	roles, rules, err := LoadPocketBase(app, "")
	if err != nil {
		t.Fatalf("LoadPocketBase() with empty subject error = %v", err)
	}
	if roles != nil || rules != nil {
		t.Fatalf("empty subject result = (%v, %v), want (nil, nil)", roles, rules)
	}

	roles, rules, err = LoadPocketBase(app, "missing-user")
	if err != nil {
		t.Fatalf("LoadPocketBase() with unknown subject error = %v", err)
	}
	if len(roles) != 0 || len(rules) != 0 {
		t.Fatalf("unknown subject result = (%v, %v), want empty roles and rules", roles, rules)
	}
}

func newAuthorizationTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatalf("create disposable PocketBase app: %v", err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

func createAuthorizationCollections(t *testing.T, app core.App) {
	t.Helper()

	collections := []*core.Collection{
		newAuthorizationCollection("user_permissions", "user", "permission", "denied"),
		newAuthorizationCollection("group_members", "user", "group"),
		newAuthorizationCollection("group_permissions", "group", "permission"),
	}
	for _, collection := range collections {
		if err := app.Save(collection); err != nil {
			t.Fatalf("create %s collection: %v", collection.Name, err)
		}
	}
}

func newAuthorizationCollection(name string, fields ...string) *core.Collection {
	collection := core.NewBaseCollection(name)
	for _, name := range fields {
		if name == "denied" {
			collection.Fields.Add(&core.BoolField{Name: name})
			continue
		}
		collection.Fields.Add(&core.TextField{Name: name})
	}
	return collection
}

func createAuthorizationRecord(t *testing.T, app core.App, collectionName string, values map[string]any) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatalf("find %s collection: %v", collectionName, err)
	}
	record := core.NewRecord(collection)
	for field, value := range values {
		record.Set(field, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("create record in %s: %v", collectionName, err)
	}
}
