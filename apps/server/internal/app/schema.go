package app

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
)

// EnsureCollections creates the small core schema on first boot. PocketBase
// persists collection definitions, so subsequent starts leave it unchanged.
func EnsureCollections(app core.App) error {
	collections := []struct {
		Name   string
		Auth   bool
		Fields []map[string]any
	}{
		{"users", true, []map[string]any{{"name": "display_name", "type": "text"}, {"name": "disabled", "type": "bool"}}},
		{"groups", false, []map[string]any{{"name": "name", "type": "text", "required": true}, {"name": "description", "type": "text"}}},
		{"permissions", false, []map[string]any{{"name": "name", "type": "text", "required": true}, {"name": "category", "type": "text"}}},
		{"group_permissions", false, []map[string]any{{"name": "group", "type": "text", "required": true}, {"name": "permission", "type": "text", "required": true}}},
		{"user_permissions", false, []map[string]any{{"name": "user", "type": "text", "required": true}, {"name": "permission", "type": "text", "required": true}, {"name": "denied", "type": "bool"}}},
		{"group_members", false, []map[string]any{{"name": "group", "type": "text", "required": true}, {"name": "user", "type": "text", "required": true}}},
		{"todos", false, []map[string]any{{"name": "owner", "type": "text", "required": true}, {"name": "title", "type": "text", "required": true}, {"name": "completed", "type": "bool"}, {"name": "due_date", "type": "date"}}},
		{"audit_logs", false, []map[string]any{{"name": "actor", "type": "text"}, {"name": "action", "type": "text", "required": true}, {"name": "metadata", "type": "json"}}},
	}

	for _, definition := range collections {
		if _, err := app.FindCollectionByNameOrId(definition.Name); err == nil {
			continue
		}
		collection := core.NewBaseCollection(definition.Name)
		if definition.Auth {
			collection = core.NewAuthCollection(definition.Name)
		}
		data, err := json.Marshal(map[string]any{"fields": definition.Fields})
		if err != nil {
			return err
		}
		if err := json.Unmarshal(data, collection); err != nil {
			return err
		}
		if err := app.Save(collection); err != nil {
			return err
		}
	}
	return nil
}
