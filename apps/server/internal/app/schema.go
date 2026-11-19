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
		{"courses", false, []schemaField{{"owner", "text", true}, {"title", "text", true}, {"description", "text", false}, {"status", "text", false}, {"content", "json", false}, {"version", "number", false}}},
		{"course_versions", false, []schemaField{{"owner", "text", true}, {"course", "text", true}, {"version", "number", true}, {"content", "json", true}, {"title", "text", true}, {"description", "text", false}}},
		{"course_progress", false, []schemaField{{"owner", "text", true}, {"course", "text", true}, {"scene_index", "number", false}, {"position_seconds", "number", false}, {"completed", "bool", false}}},
		{"course_assessments", false, []schemaField{{"owner", "text", true}, {"course", "text", true}, {"version", "number", true}, {"module_id", "text", true}, {"questions", "json", true}}},
		{"lesson_narrations", false, []schemaField{{"owner", "text", true}, {"course", "text", true}, {"version", "number", true}, {"scene_id", "text", true}, {"text_hash", "text", true}, {"voice", "text", false}, {"speaker", "text", false}, {"audio", "file", false}, {"audio_metadata", "json", false}}},
		{"knowledge_units", false, []schemaField{{"owner", "text", true}, {"title", "text", true}, {"description", "text", false}, {"unit_type", "text", true}, {"metadata", "json", false}}},
		{"learning_sources", false, []schemaField{{"owner", "text", true}, {"title", "text", true}, {"source_type", "text", true}, {"content", "text", true}, {"metadata", "json", false}}},
		{"knowledge_edges", false, []schemaField{{"owner", "text", true}, {"from_unit", "text", true}, {"to_unit", "text", true}, {"relationship", "text", true}}},
		{"learner_evidence", false, []schemaField{{"owner", "text", true}, {"unit", "text", true}, {"evidence_type", "text", true}, {"score", "number", false}, {"details", "json", false}}},
		{"knowledge_mastery", false, []schemaField{{"owner", "text", true}, {"unit", "text", true}, {"mastery", "number", false}, {"confidence", "number", false}, {"review_interval_days", "number", false}, {"ease_factor", "number", false}, {"repetitions", "number", false}, {"last_practice", "date", false}, {"next_review", "date", false}}},
		{"learning_jobs", false, []schemaField{{"owner", "text", true}, {"kind", "text", true}, {"status", "text", true}, {"progress", "number", false}, {"attempts", "number", false}, {"payload", "json", false}, {"result", "json", false}, {"course", "text", false}, {"error", "text", false}}},
		{"podcast_episodes", false, []schemaField{{"owner", "text", true}, {"title", "text", true}, {"topic", "text", true}, {"status", "text", true}, {"source_ids", "json", false}, {"concept_ids", "json", false}, {"knowledge_gap_ids", "json", false}, {"knowledge_gap_context", "json", false}, {"outline", "json", true}, {"transcript", "json", true}, {"duration_seconds", "number", false}, {"voice_assignments", "json", false}, {"course_context", "json", false}, {"audio", "file", false}, {"audio_metadata", "json", false}}},
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
	progress, err := app.FindCollectionByNameOrId("course_progress")
	if err != nil {
		return err
	}
	if progress.GetIndex("idx_course_progress_owner_course") == "" {
		progress.AddIndex("idx_course_progress_owner_course", true, "owner, course", "")
		if err := app.Save(progress); err != nil {
			return fmt.Errorf("could not index course progress: %w", err)
		}
	}
	assessments, err := app.FindCollectionByNameOrId("course_assessments")
	if err != nil {
		return err
	}
	if assessments.GetIndex("idx_course_assessments_course_version_module") == "" {
		assessments.AddIndex("idx_course_assessments_course_version_module", true, "owner, course, version, module_id", "")
		if err := app.Save(assessments); err != nil {
			return fmt.Errorf("could not index course assessments: %w", err)
		}
	}
	narrations, err := app.FindCollectionByNameOrId("lesson_narrations")
	if err != nil {
		return err
	}
	if narrations.GetIndex("idx_lesson_narrations_cache") == "" {
		narrations.AddIndex("idx_lesson_narrations_cache", true, "owner, course, version, scene_id, text_hash, voice, speaker", "")
		if err := app.Save(narrations); err != nil {
			return fmt.Errorf("could not index lesson narrations: %w", err)
		}
	}
	podcasts, err := app.FindCollectionByNameOrId("podcast_episodes")
	if err != nil {
		return err
	}
	if podcasts.GetIndex("idx_podcast_episodes_owner_id") == "" {
		podcasts.AddIndex("idx_podcast_episodes_owner_id", false, "owner, id", "")
		if err := app.Save(podcasts); err != nil {
			return fmt.Errorf("could not index podcast episodes: %w", err)
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
	case "number":
		collection.Fields.Add(&core.NumberField{Name: field.Name})
	case "json":
		collection.Fields.Add(&core.JSONField{Name: field.Name})
	case "date":
		collection.Fields.Add(&core.DateField{Name: field.Name})
	case "file":
		maxSize := int64(core.DefaultFileFieldMaxSize)
		if field.Name == "audio" {
			maxSize = 25 << 20
		}
		collection.Fields.Add(&core.FileField{Name: field.Name, MaxSelect: 1, MaxSize: maxSize})
	default:
		return fmt.Errorf("unsupported schema field type %q", field.Type)
	}
	return nil
}

type schemaField struct {
	Name, Type string
	Required   bool
}
