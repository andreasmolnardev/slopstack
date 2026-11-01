package primitives

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// validate checks one typed field and its options.
func (f Field) validate() error {
	if !knownFieldType(f.Type) {
		return fmt.Errorf("field %s: unknown type %q", f.Name, f.Type)
	}
	switch f.Type {
	case FieldText:
		if max, err := f.textMax(); err != nil {
			return err
		} else if max != 0 && minOption(f.Options) > max {
			return fmt.Errorf("field %s: text min must be <= max", f.Name)
		}
	case FieldNumber:
		min, max, err := f.numberRange()
		if err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
		if min != nil && max != nil && *min > *max {
			return fmt.Errorf("field %s: number min must be <= max", f.Name)
		}
	case FieldDate:
		min, max, err := f.dateRange()
		if err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
		if !min.IsZero() && !max.IsZero() && min.After(max) {
			return fmt.Errorf("field %s: date min must be <= max", f.Name)
		}
	case FieldSelect:
		values, err := f.selectValues()
		if err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
		if len(values) == 0 {
			return fmt.Errorf("field %s: select needs a non-empty values option", f.Name)
		}
		if _, _, err := f.maxSelect(1); err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
	case FieldRelation:
		if f.relationCollection() == "" {
			return fmt.Errorf("field %s: relation needs a non-empty collection option", f.Name)
		}
		_, maxSelect, err := f.maxSelect(1)
		if err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
		minSelect, err := f.minSelect()
		if err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
		if minSelect > maxSelect {
			return fmt.Errorf("field %s: relation minSelect must be <= maxSelect", f.Name)
		}
	case FieldFile:
		if _, err := f.fileMimeTypes(); err != nil {
			return fmt.Errorf("field %s: %w", f.Name, err)
		}
	}
	return nil
}

func knownFieldType(t FieldType) bool {
	switch t {
	case FieldText, FieldBool, FieldNumber, FieldDate, FieldJSON,
		FieldEmail, FieldURL, FieldSelect, FieldRelation, FieldFile:
		return true
	}
	return false
}

// pocketBaseField converts one descriptor into its PocketBase field.
func (f Field) pocketBaseField() (core.Field, error) {
	if err := f.validate(); err != nil {
		return nil, err
	}
	switch f.Type {
	case FieldText:
		max, _ := f.textMax()
		return &core.TextField{
			Name: f.Name, Required: f.Required,
			Min:     minOption(f.Options),
			Max:     max,
			Pattern: stringOption(f.Options, optionPattern),
		}, nil
	case FieldBool:
		return &core.BoolField{Name: f.Name, Required: f.Required}, nil
	case FieldNumber:
		min, max, _ := f.numberRange()
		return &core.NumberField{
			Name: f.Name, Required: f.Required,
			OnlyInt: boolOption(f.Options, optionOnlyInt),
			Min:     min,
			Max:     max,
		}, nil
	case FieldDate:
		min, max, _ := f.dateRange()
		return &core.DateField{Name: f.Name, Required: f.Required, Min: min, Max: max}, nil
	case FieldJSON:
		return &core.JSONField{Name: f.Name, Required: f.Required}, nil
	case FieldEmail:
		return &core.EmailField{Name: f.Name, Required: f.Required}, nil
	case FieldURL:
		return &core.URLField{Name: f.Name, Required: f.Required}, nil
	case FieldSelect:
		values, _ := f.selectValues()
		_, maxSelect, _ := f.maxSelect(1)
		return &core.SelectField{Name: f.Name, Required: f.Required, Values: values, MaxSelect: maxSelect}, nil
	case FieldRelation:
		_, maxSelect, _ := f.maxSelect(1)
		minSelect, _ := f.minSelect()
		return &core.RelationField{
			Name:          f.Name,
			Required:      f.Required,
			CollectionId:  f.relationCollection(),
			CascadeDelete: boolOption(f.Options, optionCascadeDelete),
			MinSelect:     minSelect,
			MaxSelect:     maxSelect,
		}, nil
	case FieldFile:
		mimetypes, _ := f.fileMimeTypes()
		_, maxSelect, _ := f.maxSelect(1)
		maxSize, _ := f.fileMaxSize()
		return &core.FileField{
			Name: f.Name, Required: f.Required,
			MaxSize:   maxSize,
			MaxSelect: maxSelect,
			MimeTypes: mimetypes,
		}, nil
	}
	return nil, fmt.Errorf("field %s: unknown type %q", f.Name, f.Type)
}
