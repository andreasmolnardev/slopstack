// Package audit records app supplied audit events without coupling the event
// contract to a particular application's domain models.
package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// Event contains identifiers and metadata that the caller has reviewed as
// safe to retain. Metadata must not contain record field values, credentials,
// tokens, or other secrets.
type Event struct {
	ActorID    string         `json:"actor_id,omitempty"`
	Action     string         `json:"action"`
	Resource   string         `json:"resource"`
	ResourceID string         `json:"resource_id"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

// Logger is the app-agnostic audit sink contract.
type Logger interface {
	Log(context.Context, Event) error
}

// PocketBaseRecorder writes events to the existing audit_logs collection.
// Resource and ResourceID are stored in metadata because the shared legacy
// collection schema contains actor, action, and metadata fields only.
type PocketBaseRecorder struct {
	App core.App
}

func (r PocketBaseRecorder) Log(ctx context.Context, event Event) error {
	if r.App == nil {
		return errors.New("audit: PocketBase app is nil")
	}
	if event.Action == "" {
		return errors.New("audit: action is required")
	}
	if event.ResourceID == "" {
		return errors.New("audit: resource ID is required")
	}
	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	if _, exists := event.Metadata["resource"]; exists {
		return errors.New("audit: metadata key \"resource\" is reserved")
	}
	if _, exists := event.Metadata["resource_id"]; exists {
		return errors.New("audit: metadata key \"resource_id\" is reserved")
	}

	metadata := make(map[string]any, len(event.Metadata)+2)
	metadata["resource"] = event.Resource
	metadata["resource_id"] = event.ResourceID
	for key, value := range event.Metadata {
		metadata[key] = value
	}
	if _, err := json.Marshal(metadata); err != nil {
		return fmt.Errorf("audit: encode metadata: %w", err)
	}

	collection, err := r.App.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		return fmt.Errorf("audit: find audit_logs collection: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("actor", event.ActorID)
	record.Set("action", event.Action)
	record.Set("metadata", metadata)

	return r.App.SaveWithContext(ctx, record)
}

// RequestHookConfig selects native PocketBase record API collections to audit.
// Metadata receives only the action and record identifiers; it has no access
// to request bodies or record fields.
type RequestHookConfig struct {
	Collections []string
	Metadata    func(action, collection, resourceID string) map[string]any
}

// RegisterRequestHooks logs successful native create, update, and delete
// requests for the selected collections. Audit write failures are reported to
// PocketBase's application logger and do not turn a completed data mutation
// into an HTTP error.
func RegisterRequestHooks(app core.App, logger Logger, config RequestHookConfig) error {
	if app == nil {
		return errors.New("audit: PocketBase app is nil")
	}
	if logger == nil {
		return errors.New("audit: logger is nil")
	}
	collections := uniqueCollections(config.Collections)
	if len(collections) == 0 {
		return errors.New("audit: at least one collection is required")
	}
	for _, collection := range collections {
		if collection == "audit_logs" {
			return errors.New("audit: audit_logs cannot be an audited collection")
		}
	}

	for _, collection := range collections {
		bind := func(action string, hook *hook.TaggedHook[*core.RecordRequestEvent]) {
			hook.BindFunc(func(e *core.RecordRequestEvent) error {
				if err := e.Next(); err != nil {
					return err
				}
				event := Event{
					Action:     action,
					Resource:   collection,
					ResourceID: e.Record.Id,
				}
				if e.Auth != nil {
					event.ActorID = e.Auth.Id
				}
				if config.Metadata != nil {
					event.Metadata = config.Metadata(action, collection, e.Record.Id)
				}
				if err := logger.Log(e.Request.Context(), event); err != nil {
					e.App.Logger().Error("write audit event", "action", action, "collection", collection, "resource_id", e.Record.Id, "error", err)
				}
				return nil
			})
		}
		bind("create", app.OnRecordCreateRequest(collection))
		bind("update", app.OnRecordUpdateRequest(collection))
		bind("delete", app.OnRecordDeleteRequest(collection))
	}

	return nil
}

func uniqueCollections(collections []string) []string {
	seen := make(map[string]struct{}, len(collections))
	result := make([]string, 0, len(collections))
	for _, collection := range collections {
		if collection == "" {
			continue
		}
		if _, ok := seen[collection]; ok {
			continue
		}
		seen[collection] = struct{}{}
		result = append(result, collection)
	}
	return result
}
