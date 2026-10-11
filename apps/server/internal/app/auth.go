package app

import (
	"github.com/andreasmolnardev/slopstack/go/auth"
	"github.com/pocketbase/pocketbase/core"
)

// RegistrationAllowed centralizes the registration policy for custom endpoints
// and hooks. PocketBase owns sessions, verification, and password reset flows.
func RegistrationAllowed(config Config) bool {
	return config.RegistrationEnabled
}

func CurrentUser(event *core.RequestEvent) (*core.Record, error) {
	return auth.CurrentUser(event)
}
