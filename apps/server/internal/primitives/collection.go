package primitives

import (
	"fmt"
	"sort"

	"github.com/pocketbase/pocketbase/core"
)

// FieldType is a descriptive PocketBase field type.
type FieldType string

const (
	FieldText     FieldType = "text"
	FieldBool     FieldType = "bool"
	FieldNumber   FieldType = "number"
	FieldDate     FieldType = "date"
	FieldJSON     FieldType = "json"
	FieldEmail    FieldType = "email"
	FieldURL      FieldType = "url"
	FieldSelect   FieldType = "select"
	FieldRelation FieldType = "relation"
	FieldFile     FieldType = "file"
)

// Field describes one collection field. Options carry type-specific
// PocketBase settings verbatim so new PocketBase capabilities stay usable
// without a primitives change.
type Field struct {
	Name     string
	Type     FieldType
	Required bool
	Options  map[string]any
}

// CollectionDefinition describes a collection in a generation-friendly way:
// plain names, typed fields, no built-in schema mutation. Fields are declared
// with matchers so every generated field has stable metadata.
type CollectionDefinition struct {
	// Name is the PocketBase collection name.
	Name string
	// Auth marks an auth collection such as the users collection.
	Auth bool
	// Fields lists the fields in declaration order.
	Fields []Field
}

// fieldByName returns the field with the given name, if declared.
func (c CollectionDefinition) fieldByName(name string) (Field, bool) {
	for _, field := range c.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return Field{}, false
}

func (c CollectionDefinition) validate() error {
	if !namePattern.MatchString(c.Name) {
		return fmt.Errorf("collection %q: name must match %s", c.Name, namePattern)
	}
	seen := map[string]bool{}
	for _, field := range c.Fields {
		if seen[field.Name] {
			return fmt.Errorf("collection %s: duplicate field %s", c.Name, field.Name)
		}
		seen[field.Name] = true
		if !namePattern.MatchString(field.Name) {
			return fmt.Errorf("collection %s: field %q: name must match %s", c.Name, field.Name, namePattern)
		}
		if err := field.validate(); err != nil {
			return fmt.Errorf("collection %s: %v", c.Name, err)
		}
	}
	return nil
}

// newCollection builds an empty PocketBase collection of the declared kind.
func (c CollectionDefinition) newCollection() *core.Collection {
	if c.Auth {
		return core.NewAuthCollection(c.Name)
	}
	return core.NewBaseCollection(c.Name)
}

// applyFields adds typed descriptors to the collection.
func (c CollectionDefinition) applyFields(collection *core.Collection) error {
	for _, field := range c.Fields {
		pbField, err := field.pocketBaseField()
		if err != nil {
			return err
		}
		collection.Fields.Add(pbField)
	}
	return nil
}

// sortDefinitions orders collections by name so repeated registrations and
// repeated process starts build the schema seed in one stable order.
func sortDefinitions(definitions []CollectionDefinition) []CollectionDefinition {
	sorted := append([]CollectionDefinition(nil), definitions...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})
	return sorted
}
