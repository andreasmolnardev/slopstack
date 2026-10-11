// Package config contains small, reusable configuration loading helpers.
// Application-specific config structures and validation remain app-owned.
package config

import (
	"os"
	"strconv"
)

// Lookup returns the first non-empty value from primary, then legacy, then fallback.
func Lookup(primary, legacy, fallback string) string {
	if value, ok := LookupValue(primary, legacy); ok {
		return value
	}
	return fallback
}

// LookupValue returns the first configured non-empty value.
func LookupValue(primary, legacy string) (string, bool) {
	if value := os.Getenv(primary); value != "" {
		return value, true
	}
	if legacy != "" {
		if value := os.Getenv(legacy); value != "" {
			return value, true
		}
	}
	return "", false
}

// Bool parses a boolean setting and uses fallback when unset or malformed.
func Bool(primary, legacy string, fallback bool) bool {
	value, ok := LookupValue(primary, legacy)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

// Int parses an integer setting and uses fallback when unset or malformed.
func Int(primary, legacy string, fallback int) int {
	value, ok := LookupValue(primary, legacy)
	if !ok {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
