package app

import "github.com/pocketbase/pocketbase/core"

// collectionDefinition describes a collection created on first boot and the
// fields that must exist afterwards.
type collectionDefinition struct {
	Name   string
	Auth   bool
	Fields []fieldDefinition
}

// fieldDefinition is a minimal, framework independent description of a field.
// Fields are materialized into typed core.Field values by newField.
type fieldDefinition struct {
	Name     string
	Type     string
	Required bool
	Hidden   bool
}

// coreCollections is the base schema shared by every app built on this template.
var coreCollections = []collectionDefinition{
	{Name: "users", Auth: true, Fields: []fieldDefinition{
		{Name: "display_name", Type: "text"},
		{Name: "disabled", Type: "bool"},
		{Name: "isAdmin", Type: "bool"},
	}},
	{Name: "groups", Fields: []fieldDefinition{
		{Name: "name", Type: "text", Required: true},
		{Name: "description", Type: "text"},
	}},
	{Name: "permissions", Fields: []fieldDefinition{
		{Name: "name", Type: "text", Required: true},
		{Name: "category", Type: "text"},
	}},
	{Name: "group_permissions", Fields: []fieldDefinition{
		{Name: "group", Type: "text", Required: true},
		{Name: "permission", Type: "text", Required: true},
	}},
	{Name: "user_permissions", Fields: []fieldDefinition{
		{Name: "user", Type: "text", Required: true},
		{Name: "permission", Type: "text", Required: true},
		{Name: "denied", Type: "bool"},
	}},
	{Name: "group_members", Fields: []fieldDefinition{
		{Name: "group", Type: "text", Required: true},
		{Name: "user", Type: "text", Required: true},
	}},
	{Name: "todos", Fields: []fieldDefinition{
		{Name: "owner", Type: "text", Required: true},
		{Name: "title", Type: "text", Required: true},
		{Name: "completed", Type: "bool"},
		{Name: "due_date", Type: "date"},
	}},
	{Name: "audit_logs", Fields: []fieldDefinition{
		{Name: "actor", Type: "text"},
		{Name: "action", Type: "text", Required: true},
		{Name: "metadata", Type: "json"},
	}},
}

// EnsureCollections creates the small core schema on first boot and repairs
// required fields that may be missing from an older persisted database.
func EnsureCollections(app core.App) error {
	for _, definition := range coreCollections {
		collection, err := app.FindCollectionByNameOrId(definition.Name)
		if err == nil {
			if repairRequiredFields(collection, definition.Fields) {
				if err := app.Save(collection); err != nil {
					return err
				}
			}
			continue
		}
		collection = newCollection(definition)
		if err := app.Save(collection); err != nil {
			return err
		}
	}
	return nil
}

func newCollection(definition collectionDefinition) *core.Collection {
	var collection *core.Collection
	if definition.Auth {
		collection = core.NewAuthCollection(definition.Name)
	} else {
		collection = core.NewBaseCollection(definition.Name)
	}
	addFields(collection, definition.Fields)
	return collection
}

// repairRequiredFields adds fields that a database created by an older version
// of the template is missing. It reports whether the collection changed.
func repairRequiredFields(collection *core.Collection, definitions []fieldDefinition) bool {
	changed := false
	for _, definition := range definitions {
		if collection.Fields.GetByName(definition.Name) == nil {
			addFields(collection, []fieldDefinition{definition})
			changed = true
		}
	}
	return changed
}

// addFields builds typed core.Field values. Marshalling field descriptions back
// into a *core.Collection recurses infinitely under encoding/json v2.
func addFields(collection *core.Collection, definitions []fieldDefinition) {
	for _, definition := range definitions {
		field := newField(definition)
		if field == nil {
			continue
		}
		collection.Fields.Add(field)
	}
}

func newField(definition fieldDefinition) core.Field {
	switch definition.Type {
	case "text":
		return &core.TextField{Name: definition.Name, Required: definition.Required, Hidden: definition.Hidden}
	case "bool":
		return &core.BoolField{Name: definition.Name, Required: definition.Required}
	case "date":
		return &core.DateField{Name: definition.Name, Required: definition.Required}
	case "json":
		return &core.JSONField{Name: definition.Name, Required: definition.Required}
	}
	return nil
}
