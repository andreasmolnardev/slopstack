package primitives

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/tools/types"
)

// Option keys carry type-specific PocketBase settings for one Field.
const (
	optionMin            = "min"
	optionMax            = "max"
	optionMaxSelect      = "maxSelect"
	optionMinSelect      = "minSelect"
	optionValues         = "values"
	optionCollection     = "collection"
	optionCascadeDelete  = "cascadeDelete"
	optionMimeTypes      = "mimetypes"
	optionMaxSize        = "maxSize"
	optionPattern        = "pattern"
	optionOnlyInt        = "onlyInt"
	optionDefaultMaxSize = int64(5 << 20) // PocketBase default limit, mirrored for clarity
)

func (f Field) textMax() (int, error) {
	raw, present := f.Options[optionMax]
	if !present {
		return 0, nil
	}
	value, err := asInt(raw)
	if err != nil {
		return 0, fmt.Errorf("text %q: %w", optionMax, err)
	}
	if value < 0 {
		return 0, fmt.Errorf("text %q must be >= 0", optionMax)
	}
	return value, nil
}

func (f Field) numberRange() (*float64, *float64, error) {
	min, err := f.floatOption(optionMin)
	if err != nil {
		return nil, nil, err
	}
	max, err := f.floatOption(optionMax)
	if err != nil {
		return nil, nil, err
	}
	return min, max, nil
}

func (f Field) dateRange() (types.DateTime, types.DateTime, error) {
	var min, max types.DateTime
	if raw, present := f.Options[optionMin]; present {
		value, err := asDate(raw)
		if err != nil {
			return min, max, fmt.Errorf("date %q: %w", optionMin, err)
		}
		min = value
	}
	if raw, present := f.Options[optionMax]; present {
		value, err := asDate(raw)
		if err != nil {
			return min, max, fmt.Errorf("date %q: %w", optionMax, err)
		}
		max = value
	}
	return min, max, nil
}

// maxSelect decodes the multi-value limit; the fallback is PocketBase's
// single-value default of one.
func (f Field) maxSelect(fallback int) (bool, int, error) {
	raw, present := f.Options[optionMaxSelect]
	if !present {
		return false, fallback, nil
	}
	value, err := asInt(raw)
	if err != nil {
		return false, 0, fmt.Errorf("%q: %w", optionMaxSelect, err)
	}
	if value <= 0 {
		return false, 0, fmt.Errorf("%q must be > 0", optionMaxSelect)
	}
	return true, value, nil
}

func (f Field) minSelect() (int, error) {
	raw, present := f.Options[optionMinSelect]
	if !present {
		return 0, nil
	}
	value, err := asInt(raw)
	if err != nil {
		return 0, fmt.Errorf("%q: %w", optionMinSelect, err)
	}
	if value < 0 {
		return 0, fmt.Errorf("%q must be >= 0", optionMinSelect)
	}
	return value, nil
}

func (f Field) selectValues() ([]string, error) {
	raw, present := f.Options[optionValues]
	if !present {
		return nil, nil
	}
	return decodeStrings(raw)
}

func (f Field) relationCollection() string {
	value, ok := f.Options[optionCollection].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func (f Field) fileMimeTypes() ([]string, error) {
	raw, present := f.Options[optionMimeTypes]
	if !present {
		return nil, nil
	}
	return decodeStrings(raw)
}

func (f Field) fileMaxSize() (int64, error) {
	raw, present := f.Options[optionMaxSize]
	if !present {
		return optionDefaultMaxSize, nil
	}
	value, err := asInt(raw)
	if err != nil {
		return 0, fmt.Errorf("file %q: %w", optionMaxSize, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("file %q must be > 0", optionMaxSize)
	}
	return int64(value), nil
}

func minOption(options map[string]any) int {
	value, err := asInt(options[optionMin])
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func boolOption(options map[string]any, key string) bool {
	value, ok := options[key].(bool)
	return ok && value
}

func stringOption(options map[string]any, key string) string {
	value, ok := options[key].(string)
	if !ok {
		return ""
	}
	return value
}

func (f Field) floatOption(key string) (*float64, error) {
	raw, present := f.Options[key]
	if !present {
		return nil, nil
	}
	value, err := asFloat(raw)
	if err != nil {
		return nil, fmt.Errorf("%q: %w", key, err)
	}
	return &value, nil
}

func asFloat(raw any) (float64, error) {
	switch value := raw.(type) {
	case float64:
		return value, nil
	case float32:
		return float64(value), nil
	case int:
		return float64(value), nil
	case int64:
		return float64(value), nil
	case string:
		return strconv.ParseFloat(value, 64)
	}
	return 0, fmt.Errorf("expected a number, got %T", raw)
}

func asInt(raw any) (int, error) {
	switch value := raw.(type) {
	case int:
		return value, nil
	case int64:
		return int(value), nil
	case float64:
		if value != float64(int(value)) {
			return 0, fmt.Errorf("expected a whole number, got %v", value)
		}
		return int(value), nil
	case string:
		return strconv.Atoi(value)
	}
	return 0, fmt.Errorf("expected a whole number, got %T", raw)
}

func asDate(raw any) (types.DateTime, error) {
	value, ok := raw.(string)
	if !ok {
		return types.DateTime{}, fmt.Errorf("expected a date string, got %T", raw)
	}
	return types.ParseDateTime(value)
}

// decodeStrings normalizes a list-of-strings option so callers can pass
// []string, a JSON-style []any, or a comma-separated string.
func decodeStrings(raw any) ([]string, error) {
	switch value := raw.(type) {
	case []string:
		return value, nil
	case []any:
		values := make([]string, 0, len(value))
		for _, item := range value {
			text, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("expected a list of strings, got %T", item)
			}
			values = append(values, text)
		}
		return values, nil
	case string:
		return strings.Split(value, ","), nil
	}
	return nil, fmt.Errorf("expected a list of strings, got %T", raw)
}
