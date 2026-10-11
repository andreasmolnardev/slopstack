// Package ownership provides opt-in PocketBase request hooks and helpers for
// enforcing record ownership and keeping selected fields immutable.
package ownership

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Policy describes ownership rules for one PocketBase collection. The package
// owns only owner assignment/checks and protected-field preservation. Apps may
// add their own validation through the callbacks.
type Policy struct {
	Collection      string
	OwnerField      string
	ProtectedFields []string
	AllowSuperusers bool
	ValidateCreate  func(*core.RecordRequestEvent) error
	ValidateUpdate  func(*core.RecordRequestEvent) error
	ValidateDelete  func(*core.RecordRequestEvent) error
}

// RegisterRequestHooks binds create, update, and delete checks for each policy.
// Create assigns the authenticated user as owner. Update and delete require the
// existing owner to match the authenticated user. Updates restore protected
// values from the original record, even when a client submits replacements.
//
// Superusers bypass the checks only when AllowSuperusers is true. Policies are
// validated before any hooks are registered.
func RegisterRequestHooks(app core.App, policies ...Policy) error {
	if app == nil {
		return errors.New("ownership: PocketBase app is nil")
	}
	if len(policies) == 0 {
		return errors.New("ownership: at least one policy is required")
	}

	seen := make(map[string]struct{}, len(policies))
	for _, policy := range policies {
		if strings.TrimSpace(policy.Collection) == "" {
			return errors.New("ownership: collection is required")
		}
		if strings.TrimSpace(policy.OwnerField) == "" {
			return fmt.Errorf("ownership: owner field is required for collection %q", policy.Collection)
		}
		if _, ok := seen[policy.Collection]; ok {
			return fmt.Errorf("ownership: duplicate policy for collection %q", policy.Collection)
		}
		seen[policy.Collection] = struct{}{}
		for _, field := range policy.ProtectedFields {
			if strings.TrimSpace(field) == "" {
				return fmt.Errorf("ownership: protected field cannot be empty for collection %q", policy.Collection)
			}
			if field == policy.OwnerField {
				return fmt.Errorf("ownership: owner field %q is already protected for collection %q", field, policy.Collection)
			}
		}
	}

	for _, policy := range policies {
		p := policy
		app.OnRecordCreateRequest(p.Collection).BindFunc(func(e *core.RecordRequestEvent) error {
			if p.AllowSuperusers && e.HasSuperuserAuth() {
				return e.Next()
			}
			if e.Auth == nil || e.Auth.Id == "" {
				return e.UnauthorizedError("authentication required", nil)
			}
			assignOwner(e.Record, p.OwnerField, e.Auth.Id)
			if p.ValidateCreate != nil {
				if err := p.ValidateCreate(e); err != nil {
					return err
				}
			}
			return e.Next()
		})

		app.OnRecordUpdateRequest(p.Collection).BindFunc(func(e *core.RecordRequestEvent) error {
			if p.AllowSuperusers && e.HasSuperuserAuth() {
				return e.Next()
			}
			if e.Auth == nil || e.Auth.Id == "" {
				return e.UnauthorizedError("authentication required", nil)
			}
			if !IsOwner(e.Record.Original(), p.OwnerField, e.Auth.Id) {
				return e.ForbiddenError("record is not owned by the current user", nil)
			}
			restoreProtectedFields(e.Record, p.OwnerField, p.ProtectedFields)
			if p.ValidateUpdate != nil {
				if err := p.ValidateUpdate(e); err != nil {
					return err
				}
			}
			return e.Next()
		})

		app.OnRecordDeleteRequest(p.Collection).BindFunc(func(e *core.RecordRequestEvent) error {
			if p.AllowSuperusers && e.HasSuperuserAuth() {
				return e.Next()
			}
			if e.Auth == nil || e.Auth.Id == "" {
				return e.UnauthorizedError("authentication required", nil)
			}
			if !IsOwner(e.Record, p.OwnerField, e.Auth.Id) {
				return e.ForbiddenError("record is not owned by the current user", nil)
			}
			if p.ValidateDelete != nil {
				if err := p.ValidateDelete(e); err != nil {
					return err
				}
			}
			return e.Next()
		})
	}

	return nil
}

// IsOwner reports whether record has the requested owner ID. Empty inputs are
// never considered owned.
func IsOwner(record *core.Record, ownerField, ownerID string) bool {
	return record != nil && ownerField != "" && ownerID != "" && record.GetString(ownerField) == ownerID
}

func assignOwner(record *core.Record, ownerField, ownerID string) {
	record.Set(ownerField, ownerID)
}

func restoreProtectedFields(record *core.Record, ownerField string, fields []string) {
	original := record.Original()
	record.SetRaw(ownerField, original.GetRaw(ownerField))
	for _, field := range fields {
		record.SetRaw(field, original.GetRaw(field))
	}
}
