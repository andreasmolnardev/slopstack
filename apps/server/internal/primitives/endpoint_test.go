package primitives

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
)

// emptyEndpoint is a valid endpoint with a no-op registration.
func emptyEndpoint(name, method, path string) Endpoint {
	return Endpoint{
		Name: name, Method: method, Path: path,
		Register: func(api huma.API) error { return nil },
	}
}

func TestEndpointValidate(t *testing.T) {
	cases := []struct {
		name     string
		endpoint Endpoint
		wantErr  string
	}{
		{name: "ok", endpoint: emptyEndpoint("getProjects", "GET", "/api/projects")},
		{name: "no name", endpoint: emptyEndpoint("", "GET", "/api/projects"), wantErr: "name is required"},
		{name: "lowercase method", endpoint: emptyEndpoint("list", "get", "/api/projects"), wantErr: "uppercase HTTP token"},
		{name: "relative path", endpoint: emptyEndpoint("list", "GET", "api/projects"), wantErr: "must start with /"},
		{name: "no register", endpoint: Endpoint{Name: "list", Method: "GET", Path: "/api/projects"}, wantErr: "register function"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := test.endpoint.validate()
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

func TestRegisterEndpointsDeclaresSortedContract(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(BackendPlugin{
		Name: "zeta",
		Endpoints: []Endpoint{
			deleteEndpoint("deleteTodo", "/api/todos/{id}"),
			getEndpoint("getZeta", "/api/zeta"),
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := registry.Register(BackendPlugin{
		Name:      "alpha",
		Endpoints: []Endpoint{getEndpoint("listAlpha", "/api/alpha")},
	}); err != nil {
		t.Fatal(err)
	}

	api := humago.New(http.NewServeMux(), huma.DefaultConfig("test", "test"))
	if err := registry.RegisterEndpoints(api); err != nil {
		t.Fatal(err)
	}

	paths := api.OpenAPI().Paths
	if count := len(paths); count != 3 {
		t.Fatalf("want 3 declared paths, got %d", count)
	}
	if _, ok := paths["/api/alpha"]; !ok {
		t.Fatal("missing /api/alpha in the OpenAPI contract")
	}
	if operation := paths["/api/zeta"].Get; operation == nil || operation.OperationID != "getZeta" {
		t.Fatal("missing getZeta operation on /api/zeta")
	}
	if operation := paths["/api/todos/{id}"].Delete; operation == nil || operation.OperationID != "deleteTodo" {
		t.Fatal("missing deleteTodo operation on /api/todos/{id}")
	}
}

func getEndpoint(name, path string) Endpoint {
	type input struct{}
	type output struct {
		Body struct {
			OK bool `json:"ok"`
		}
	}
	return Endpoint{
		Name: name, Method: http.MethodGet, Path: path,
		Summary: name, Tags: []string{"Example"},
		Register: func(api huma.API) error {
			huma.Register(api, huma.Operation{
				OperationID: name, Method: http.MethodGet, Path: path, Summary: name, Tags: []string{"Example"},
			}, func(context.Context, *input) (*output, error) { return nil, nil })
			return nil
		},
	}
}

func deleteEndpoint(name, path string) Endpoint {
	type input struct {
		ID string `path:"id"`
	}
	type output struct{}
	return Endpoint{
		Name: name, Method: http.MethodDelete, Path: path,
		DefaultStatus: http.StatusNoContent,
		Register: func(api huma.API) error {
			huma.Register(api, huma.Operation{
				OperationID: name, Method: http.MethodDelete, Path: path, DefaultStatus: http.StatusNoContent,
			}, func(context.Context, *input) (*output, error) { return nil, nil })
			return nil
		},
	}
}
