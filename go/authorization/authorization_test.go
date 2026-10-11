package authorization

import "testing"

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
