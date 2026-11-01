package primitives

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestCollectionDefinitionValidate(t *testing.T) {
	cases := []struct {
		name       string
		definition CollectionDefinition
		wantErr    string
	}{
		{
			name: "ok base collection",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{
				{Name: "title", Type: FieldText, Required: true},
				{Name: "done", Type: FieldBool},
			}},
		},
		{
			name:       "bad collection name",
			definition: CollectionDefinition{Name: "1bad-name", Fields: []Field{{Name: "title", Type: FieldText}}},
			wantErr:    "name must match",
		},
		{
			name: "duplicate field",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{
				{Name: "title", Type: FieldText},
				{Name: "title", Type: FieldBool},
			}},
			wantErr: "duplicate field title",
		},
		{
			name:       "unknown field type",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "title", Type: "money"}}},
			wantErr:    "unknown type",
		},
		{
			name:       "select without values",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "level", Type: FieldSelect}}},
			wantErr:    "non-empty values",
		},
		{
			name:       "relation without collection",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "owner_ref", Type: FieldRelation}}},
			wantErr:    "non-empty collection",
		},
		{
			name:       "negative text max",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "title", Type: FieldText, Options: map[string]any{"max": -1}}}},
			wantErr:    "must be >= 0",
		},
		{
			name:       "number min above max",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "score", Type: FieldNumber, Options: map[string]any{"min": 5.0, "max": 1.0}}}},
			wantErr:    "min must be <= max",
		},
		{
			name:       "bad maxSelect",
			definition: CollectionDefinition{Name: "projects", Fields: []Field{{Name: "tags", Type: FieldSelect, Options: map[string]any{"values": []string{"a"}, "maxSelect": 0}}}},
			wantErr:    "must be > 0",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := test.definition.validate()
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("want no error, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("want error containing %q, got %v", test.wantErr, err)
			}
		})
	}
}

func TestFieldPocketBaseConversion(t *testing.T) {
	relations := Field{Name: "owner_ref", Type: FieldRelation, Options: map[string]any{
		"collection": "abc123", "cascadeDelete": true, "minSelect": 1, "maxSelect": 2,
	}}
	pbField, err := relations.pocketBaseField()
	if err != nil {
		t.Fatal(err)
	}
	relation, ok := pbField.(*core.RelationField)
	if !ok {
		t.Fatalf("want *core.RelationField, got %T", pbField)
	}
	if relation.CollectionId != "abc123" || !relation.CascadeDelete || relation.MinSelect != 1 || relation.MaxSelect != 2 {
		t.Fatalf("unexpected relation field %+v", relation)
	}

	numbers := Field{Name: "score", Type: FieldNumber, Options: map[string]any{"min": 1.5, "max": "9"}}
	pbField, err = numbers.pocketBaseField()
	if err != nil {
		t.Fatal(err)
	}
	number, ok := pbField.(*core.NumberField)
	if !ok {
		t.Fatalf("want *core.NumberField, got %T", pbField)
	}
	if number.Min == nil || *number.Min != 1.5 || number.Max == nil || *number.Max != 9 {
		t.Fatalf("unexpected number field %+v", number)
	}

	selects := Field{Name: "level", Type: FieldSelect, Options: map[string]any{"values": []any{"low", "high"}, "maxSelect": 3}}
	pbField, err = selects.pocketBaseField()
	if err != nil {
		t.Fatal(err)
	}
	selectField, ok := pbField.(*core.SelectField)
	if !ok {
		t.Fatalf("want *core.SelectField, got %T", pbField)
	}
	if len(selectField.Values) != 2 || selectField.Values[0] != "low" || selectField.MaxSelect != 3 {
		t.Fatalf("unexpected select field %+v", selectField)
	}

	texts := Field{Name: "code", Type: FieldText, Required: true, Options: map[string]any{"max": 12, "min": 2, "pattern": "^[a-z]+$"}}
	pbField, err = texts.pocketBaseField()
	if err != nil {
		t.Fatal(err)
	}
	text, ok := pbField.(*core.TextField)
	if !ok {
		t.Fatalf("want *core.TextField, got %T", pbField)
	}
	if text.Min != 2 || text.Max != 12 || text.Pattern != "^[a-z]+$" || !text.Required {
		t.Fatalf("unexpected text field %+v", text)
	}

	files := Field{Name: "attachment", Type: FieldFile, Options: map[string]any{"mimetypes": "text/plain,image/png"}}
	pbField, err = files.pocketBaseField()
	if err != nil {
		t.Fatal(err)
	}
	file, ok := pbField.(*core.FileField)
	if !ok {
		t.Fatalf("want *core.FileField, got %T", pbField)
	}
	if len(file.MimeTypes) != 2 || file.MaxSelect != 1 {
		t.Fatalf("unexpected file field %+v", file)
	}
}

func newPrimitivesTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

func TestEnsureCollectionsCreatesMissingAndSkipsExisting(t *testing.T) {
	app := newPrimitivesTestApp(t)

	// A pre-existing collection from the default test data: the definitions
	// are a seed and must not touch it.
	existing, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	fieldsBefore := len(existing.Fields.FieldNames())

	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name: "notebook",
		Collections: []CollectionDefinition{
			{Name: "users", Fields: []Field{{Name: "unusedMarker", Type: FieldText}}},
			{Name: "notes", Fields: []Field{
				{Name: "title", Type: FieldText, Required: true},
				{Name: "mood", Type: FieldSelect, Options: map[string]any{"values": []string{"calm", "busy"}}},
			}},
			{Name: "workspace_members", Auth: true, Fields: []Field{
				{Name: "displayHandle", Type: FieldText},
			}},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.EnsureCollections(app); err != nil {
		t.Fatal(err)
	}

	notes, err := app.FindCollectionByNameOrId("notes")
	if err != nil {
		t.Fatal(err)
	}
	if notes.Fields.GetByName("title") == nil || notes.Fields.GetByName("mood") == nil {
		t.Fatalf("notes collection is missing declared fields: %s", notes.Fields.String())
	}

	members, err := app.FindCollectionByNameOrId("workspace_members")
	if err != nil {
		t.Fatal(err)
	}
	if !members.IsAuth() {
		t.Fatal("workspace_members must be an auth collection")
	}
	if members.Fields.GetByName("displayHandle") == nil {
		t.Fatalf("workspace_members is missing the declared field: %s", members.Fields.String())
	}

	existing, err = app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	if existing.Fields.GetByName("unusedMarker") != nil {
		t.Fatal("existing collection received a declared field it must not have")
	}
	if got, want := len(existing.Fields.FieldNames()), fieldsBefore; got != want {
		t.Fatalf("existing collection was mutated: want %d fields, got %d", want, got)
	}
}
