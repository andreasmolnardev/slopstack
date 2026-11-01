package primitives

import "regexp"

// PocketBase collection and field names are identifier-like. Keeping a single
// shared pattern gives validation and generated tooling the same assumptions.
var namePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

// methodPattern accepts uppercase HTTP method tokens, including custom ones.
var methodPattern = regexp.MustCompile(`^[A-Z]+$`)
