// Package auth adapts PocketBase request authentication to reusable helpers.
package auth

import (
	"github.com/pocketbase/pocketbase/core"
)

// CurrentUser returns the authenticated record or a standard unauthorized error.
func CurrentUser(event *core.RequestEvent) (*core.Record, error) {
	if event.Auth == nil {
		return nil, event.UnauthorizedError("authentication required", nil)
	}
	return event.Auth, nil
}

// UserID returns the authenticated record ID.
func UserID(event *core.RequestEvent) (string, error) {
	user, err := CurrentUser(event)
	if err != nil {
		return "", err
	}
	return user.Id, nil
}
