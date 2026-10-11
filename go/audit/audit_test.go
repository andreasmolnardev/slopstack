package audit_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/andreasmolnardev/slopstack/go/audit"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

const privateFixture = "do-not-copy-this-record-value"

func TestPocketBaseRecorderWritesOnlyIdentifiersAndSafeMetadata(t *testing.T) {
	app, cleanup := newAuditApp(t)
	defer cleanup()

	logger := audit.PocketBaseRecorder{App: app}
	err := logger.Log(t.Context(), audit.Event{
		ActorID:    "actor-id",
		Action:     "created",
		Resource:   "projects",
		ResourceID: "resource-id",
		Metadata:   map[string]any{"source": "import"},
	})
	if err != nil {
		t.Fatal(err)
	}

	assertAuditRow(t, app, "created", "projects", "resource-id", "actor-id", `"source":"import"`)
}

func TestRequestHooksLogSuccessfulNativeCRUDWithoutRecordValues(t *testing.T) {
	testsCases := []struct {
		name   string
		method string
		url    string
		body   string
		action string
		seed   bool
	}{
		{name: "create", method: http.MethodPost, url: "/api/collections/audit_target/records", body: `{"title":"` + privateFixture + `"}`, action: "create"},
		{name: "update", method: http.MethodPatch, url: "/api/collections/audit_target/records/targetrecord001", body: `{"title":"` + privateFixture + `"}`, action: "update", seed: true},
		{name: "delete", method: http.MethodDelete, url: "/api/collections/audit_target/records/targetrecord001", action: "delete", seed: true},
	}

	for _, testCase := range testsCases {
		t.Run(testCase.name, func(t *testing.T) {
			var responseID string
			scenario := tests.ApiScenario{
				Name:   testCase.name,
				Method: testCase.method,
				URL:    testCase.url,
				Body:   strings.NewReader(testCase.body),
				ExpectedStatus: func() int {
					if testCase.name == "delete" {
						return http.StatusNoContent
					}
					return http.StatusOK
				}(),
				ExpectedContent: func() []string {
					if testCase.name == "delete" {
						return nil
					}
					return []string{`"id"`}
				}(),
				TestAppFactory: func(t testing.TB) *tests.TestApp {
					app := makeTestApp(t)
					if err := createCollections(app); err != nil {
						t.Fatal(err)
					}
					if testCase.seed {
						record, err := app.FindCollectionByNameOrId("audit_target")
						if err != nil {
							t.Fatal(err)
						}
						target := core.NewRecord(record)
						target.Id = "targetrecord001"
						target.Set("title", "seed")
						if err := app.Save(target); err != nil {
							t.Fatal(err)
						}
					}
					if err := audit.RegisterRequestHooks(app, audit.PocketBaseRecorder{App: app}, audit.RequestHookConfig{
						Collections: []string{"audit_target"},
						Metadata: func(action, collection, resourceID string) map[string]any {
							return map[string]any{"origin": "native-api"}
						},
					}); err != nil {
						t.Fatal(err)
					}
					return app
				},
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, response *http.Response) {
					if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusNoContent {
						body, _ := io.ReadAll(response.Body)
						t.Fatalf("unexpected response status %d: %s", response.StatusCode, string(body))
					}
					if testCase.name == "create" {
						var result struct {
							ID string `json:"id"`
						}
						if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
							t.Fatal(err)
						}
						responseID = result.ID
					}
					if responseID == "" {
						responseID = "targetrecord001"
					}
					assertAuditRow(t, app, testCase.action, "audit_target", responseID, "", `"origin":"native-api"`)
				},
			}
			scenario.Test(t)
		})
	}
}

func TestRequestHooksIgnoreFailedRequestsAndUnselectedCollections(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		collection string
		body       string
		status     int
	}{
		{name: "failed create", collection: "audit_target", body: `{}`, status: http.StatusBadRequest},
		{name: "unselected create", collection: "unselected", body: `{"title":"` + privateFixture + `"}`, status: http.StatusOK},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			scenario := tests.ApiScenario{
				Name:           testCase.name,
				Method:         http.MethodPost,
				URL:            "/api/collections/" + testCase.collection + "/records",
				Body:           strings.NewReader(testCase.body),
				ExpectedStatus: testCase.status,
				ExpectedContent: func() []string {
					if testCase.status == http.StatusBadRequest {
						return []string{`"data"`}
					}
					return []string{`"id"`}
				}(),
				TestAppFactory: func(t testing.TB) *tests.TestApp {
					app := makeTestApp(t)
					if err := createCollections(app); err != nil {
						t.Fatal(err)
					}
					if err := audit.RegisterRequestHooks(app, audit.PocketBaseRecorder{App: app}, audit.RequestHookConfig{Collections: []string{"audit_target"}}); err != nil {
						t.Fatal(err)
					}
					return app
				},
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, response *http.Response) {
					rows, err := app.FindRecordsByFilter("audit_logs", "", "", 10, 0)
					if err != nil {
						t.Fatal(err)
					}
					if len(rows) != 0 {
						t.Fatalf("failed or unselected request wrote %d audit rows", len(rows))
					}
				},
			}
			scenario.Test(t)
		})
	}
}

func newAuditApp(t *testing.T) (*tests.TestApp, func()) {
	t.Helper()
	app := makeTestApp(t)
	if err := createCollections(app); err != nil {
		t.Fatal(err)
	}
	return app, app.Cleanup
}

func makeTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func createCollections(app *tests.TestApp) error {
	auditLogs := core.NewBaseCollection("audit_logs")
	auditLogs.Fields.Add(&core.TextField{Name: "actor"})
	auditLogs.Fields.Add(&core.TextField{Name: "action", Required: true})
	auditLogs.Fields.Add(&core.JSONField{Name: "metadata"})
	if err := app.Save(auditLogs); err != nil {
		return err
	}
	target := core.NewBaseCollection("audit_target")
	target.ListRule = types.Pointer("")
	target.ViewRule = types.Pointer("")
	target.CreateRule = types.Pointer("")
	target.UpdateRule = types.Pointer("")
	target.DeleteRule = types.Pointer("")
	target.Fields.Add(&core.TextField{Name: "title", Required: true})
	if err := app.Save(target); err != nil {
		return err
	}
	unselected := core.NewBaseCollection("unselected")
	unselected.ListRule = types.Pointer("")
	unselected.ViewRule = types.Pointer("")
	unselected.CreateRule = types.Pointer("")
	unselected.Fields.Add(&core.TextField{Name: "title", Required: true})
	return app.Save(unselected)
}

func assertAuditRow(t testing.TB, app *tests.TestApp, action, resource, resourceID, actor, expectedMetadata string) {
	t.Helper()
	rows, err := app.FindRecordsByFilter("audit_logs", "", "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d audit rows, want 1", len(rows))
	}
	row := rows[0]
	if got := row.GetString("action"); got != action {
		t.Errorf("action = %q, want %q", got, action)
	}
	if got := row.GetString("actor"); got != actor {
		t.Errorf("actor = %q, want %q", got, actor)
	}
	encoded, err := json.Marshal(row.Get("metadata"))
	if err != nil {
		t.Fatal(err)
	}
	metadata := string(encoded)
	for _, expected := range []string{`"resource":"` + resource + `"`, `"resource_id":"` + resourceID + `"`, expectedMetadata} {
		if !strings.Contains(metadata, expected) {
			t.Errorf("metadata %s does not contain %s", metadata, expected)
		}
	}
	if strings.Contains(metadata, privateFixture) {
		t.Errorf("metadata contains private record value: %s", metadata)
	}
}
