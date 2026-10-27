package app

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Authorize is the single backend enforcement point for named permissions.
// A direct user deny always wins; otherwise a direct user rule overrides group
// rules, and an administrator bypasses group rules.
func Authorize(event *core.RequestEvent, permission string) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	allowed, err := HasPermission(event.App, user, event.HasSuperuserAuth(), permission)
	if err != nil {
		return event.InternalServerError("could not load permissions", err)
	}
	if !allowed {
		return event.ForbiddenError("missing permission: "+permission, nil)
	}
	return nil
}

// HasPermission resolves direct user rules before group rules. A direct allow
// or deny is an explicit override; group denies take precedence over group
// allows. PocketBase superusers and users with isAdmin bypass group rules.
func HasPermission(app core.App, user *core.Record, superuser bool, permission string) (bool, error) {
	direct, err := app.FindRecordsByFilter("user_permissions", "user = {:user} && permission = {:permission}", "", 0, 0, dbx.Params{
		"user": user.Id, "permission": permission,
	})
	if err != nil {
		return false, err
	}
	for _, rule := range direct {
		if rule.GetBool("denied") {
			return false, nil
		}
	}
	if len(direct) > 0 {
		return true, nil
	}
	if superuser || user.GetBool("isAdmin") {
		return true, nil
	}

	memberships, err := app.FindRecordsByFilter("group_members", "user = {:user}", "", 0, 0, dbx.Params{"user": user.Id})
	if err != nil {
		return false, err
	}
	groupIDs := make(map[string]struct{}, len(memberships))
	for _, membership := range memberships {
		groupIDs[membership.GetString("group")] = struct{}{}
	}
	if len(groupIDs) == 0 {
		return false, nil
	}
	rules, err := app.FindRecordsByFilter("group_permissions", "permission = {:permission}", "", 0, 0, dbx.Params{"permission": permission})
	if err != nil {
		return false, err
	}
	allowed := false
	for _, rule := range rules {
		if _, member := groupIDs[rule.GetString("group")]; !member {
			continue
		}
		if rule.GetBool("denied") {
			return false, nil
		}
		allowed = true
	}
	return allowed, nil
}
