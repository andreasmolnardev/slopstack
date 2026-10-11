// Package authorization provides a small, storage-agnostic permission evaluator.
// Applications remain responsible for loading rules and mapping their own roles.
package authorization

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Effect describes whether a matching rule grants or denies an operation.
type Effect string

const (
	Allow Effect = "allow"
	Deny  Effect = "deny"
)

// Principal is the authenticated identity presented to the evaluator.
type Principal struct {
	ID        string
	Roles     []string
	Superuser bool
}

// Rule grants or denies one permission to a user or role. Set exactly one of
// SubjectID and Role. Explicit denies take precedence over every grant.
type Rule struct {
	SubjectID  string
	Role       string
	Permission string
	Effect     Effect
}

// Allows reports whether principal may perform permission under rules.
// Unauthenticated principals and unknown permissions are denied by default.
func Allows(principal Principal, permission string, rules []Rule) bool {
	if principal.ID == "" || permission == "" {
		return false
	}
	allowed := principal.Superuser
	for _, rule := range rules {
		if rule.Permission != permission || (rule.Effect != Allow && rule.Effect != Deny) {
			continue
		}
		matches := rule.SubjectID != "" && rule.SubjectID == principal.ID
		if rule.Role != "" {
			for _, role := range principal.Roles {
				if role == rule.Role {
					matches = true
					break
				}
			}
		}
		if !matches {
			continue
		}
		if rule.Effect == Deny {
			return false
		}
		allowed = true
	}
	return allowed
}

// LoadPocketBaseRules reads the shared Slopstack permission collections for a
// user. Application code owns collection lifecycle and must ensure the core
// collections exist before invoking this helper.
func LoadPocketBase(app core.App, userID string) ([]string, []Rule, error) {
	if userID == "" {
		return nil, nil, nil
	}
	roles := make([]string, 0)
	rules := make([]Rule, 0)
	userRecords, err := app.FindRecordsByFilter("user_permissions", "user = {:user}", "", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil, nil, err
	}
	for _, record := range userRecords {
		effect := Allow
		if record.GetBool("denied") {
			effect = Deny
		}
		rules = append(rules, Rule{SubjectID: userID, Permission: record.GetString("permission"), Effect: effect})
	}

	memberships, err := app.FindRecordsByFilter("group_members", "user = {:user}", "", 0, 0, dbx.Params{"user": userID})
	if err != nil {
		return nil, nil, err
	}
	for _, membership := range memberships {
		groupID := membership.GetString("group")
		if groupID == "" {
			continue
		}
		roles = append(roles, groupID)
		groupRecords, findErr := app.FindRecordsByFilter("group_permissions", "group = {:group}", "", 0, 0, dbx.Params{"group": groupID})
		if findErr != nil {
			return nil, nil, findErr
		}
		for _, record := range groupRecords {
			rules = append(rules, Rule{Role: groupID, Permission: record.GetString("permission"), Effect: Allow})
		}
	}
	return roles, rules, nil
}
