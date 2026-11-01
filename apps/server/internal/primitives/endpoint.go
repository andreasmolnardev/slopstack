package primitives

import (
	"fmt"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// Endpoint is one typed Huma v2 API operation the extension adds. The
// Register closure declares the typed request and response with huma.Register,
// which is also how the OpenAPI contract and the generated TypeScript client
// are produced.
type Endpoint struct {
	// Name is the Huma OperationID; it must be unique across the registry.
	Name string
	// Method is the uppercase HTTP method, e.g. http.MethodGet.
	Method string
	// Path is the absolute route path, e.g. "/api/todos".
	Path string
	// Summary documents the operation in the OpenAPI contract.
	Summary string
	// Tags group the operation in the OpenAPI contract.
	Tags []string
	// Security declares auth schemes, e.g. pocketbaseAuth bearer.
	Security []map[string][]string
	// Errors lists possible HTTP error statuses.
	Errors []int
	// DefaultStatus overrides the success status, e.g. 201 for create.
	DefaultStatus int
	// Register declares the typed input and output and binds the handler
	// with huma.Register.
	Register func(api huma.API) error
}

// operation returns the Huma operation metadata for the contract. The
// registry uses it for validation and ordering checks; actual registration
// happens through the Register closure.
func (e Endpoint) operation() huma.Operation {
	return huma.Operation{
		OperationID:   e.Name,
		Method:        e.Method,
		Path:          e.Path,
		Summary:       e.Summary,
		Tags:          e.Tags,
		Security:      e.Security,
		Errors:        e.Errors,
		DefaultStatus: e.DefaultStatus,
	}
}

func (e Endpoint) validate() error {
	switch {
	case strings.TrimSpace(e.Name) == "":
		return fmt.Errorf("endpoint: name is required")
	case !methodPattern.MatchString(e.Method):
		return fmt.Errorf("endpoint %s: method %q must be an uppercase HTTP token", e.Name, e.Method)
	case !strings.HasPrefix(e.Path, "/"):
		return fmt.Errorf("endpoint %s: path %q must start with /", e.Name, e.Path)
	case e.Register == nil:
		return fmt.Errorf("endpoint %s: register function is required", e.Name)
	}
	return nil
}

// endpointKey orders and deduplicates endpoints.
func (e Endpoint) endpointKey() string {
	return e.Method + " " + e.Path
}
