package app

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// EnsureCollections creates the small core schema on first boot and repairs
// required fields that may be missing from an older persisted database.
func EnsureCollections(app core.App) error {
	collections := []struct {
		Name   string
		Auth   bool
		Fields []schemaField
	}{
		{"users", true, []schemaField{{"display_name", "text", false}, {"disabled", "bool", false}, {"isAdmin", "bool", false}, {"preferences", "json", false}}},
		{"organizations", false, []schemaField{{"name", "text", true}, {"owner", "text", false}, {"settings", "json", false}}},
		{"groups", false, []schemaField{{"name", "text", true}, {"description", "text", false}, {"organization", "text", false}}},
		{"permissions", false, []schemaField{{"name", "text", true}, {"category", "text", false}}},
		{"group_permissions", false, []schemaField{{"group", "text", true}, {"permission", "text", true}, {"denied", "bool", false}}},
		{"user_permissions", false, []schemaField{{"user", "text", true}, {"permission", "text", true}, {"denied", "bool", false}}},
		{"group_members", false, []schemaField{{"group", "text", true}, {"user", "text", true}}},
		{"todos", false, []schemaField{{"owner", "text", true}, {"title", "text", true}, {"description", "text", false}, {"priority", "text", false}, {"completed", "bool", false}, {"due_date", "date", false}}},
		{"audit_logs", false, []schemaField{{"actor", "text", false}, {"action", "text", true}, {"metadata", "json", false}}},
	}

	for _, definition := range collections {
		collection, err := app.FindCollectionByNameOrId(definition.Name)
		if err == nil {
			changed := false
			for _, field := range definition.Fields {
				if collection.Fields.GetByName(field.Name) != nil {
					continue
				}
				if err := addSchemaField(collection, field); err != nil {
					return err
				}
				changed = true
			}
			if changed {
				if err := app.Save(collection); err != nil {
					return err
				}
			}
			continue
		}
		collection = core.NewBaseCollection(definition.Name)
		if definition.Auth {
			collection = core.NewAuthCollection(definition.Name)
		}
		for _, field := range definition.Fields {
			if err := addSchemaField(collection, field); err != nil {
				return err
			}
		}
		if err := app.Save(collection); err != nil {
			return err
		}
	}
	return nil
}

func addSchemaField(collection *core.Collection, field schemaField) error {
	switch field.Type {
	case "text":
		collection.Fields.Add(&core.TextField{Name: field.Name, Required: field.Required})
	case "bool":
		collection.Fields.Add(&core.BoolField{Name: field.Name})
	case "json":
		collection.Fields.Add(&core.JSONField{Name: field.Name})
	case "date":
		collection.Fields.Add(&core.DateField{Name: field.Name})
	default:
		return fmt.Errorf("unsupported schema field type %q", field.Type)
	}
	return nil
}

type schemaField struct {
	Name, Type string
	Required   bool
}
