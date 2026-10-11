package ownership

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

func TestIsOwner(t *testing.T) {
	collection := core.NewBaseCollection("records")
	collection.Fields.Add(&core.TextField{Name: "owner"})
	record := core.NewRecord(collection)
	record.Set("owner", "user-1")

	for _, testCase := range []struct {
		name      string
		record    *core.Record
		field     string
		ownerID   string
		wantOwned bool
	}{
		{name: "same owner", record: record, field: "owner", ownerID: "user-1", wantOwned: true},
		{name: "different owner", record: record, field: "owner", ownerID: "user-2"},
		{name: "empty owner", record: record, field: "owner"},
		{name: "nil record", field: "owner", ownerID: "user-1"},
		{name: "empty field", record: record, ownerID: "user-1"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsOwner(testCase.record, testCase.field, testCase.ownerID); got != testCase.wantOwned {
				t.Fatalf("IsOwner() = %v, want %v", got, testCase.wantOwned)
			}
		})
	}
}

func TestCreateAssignsAuthenticatedOwner(t *testing.T) {
	collection := core.NewBaseCollection("ownership_records")
	collection.Fields.Add(&core.TextField{Name: "owner"})
	record := core.NewRecord(collection)
	assignOwner(record, "owner", "user-1")
	if got := record.GetString("owner"); got != "user-1" {
		t.Fatalf("owner = %q, want authenticated user", got)
	}
}

func TestUpdateRestoresOwnerAndProtectedFields(t *testing.T) {
	app := ownershipTestApp(t)
	collection := ownershipTestCollection(t, app)
	original := core.NewRecord(collection)
	original.Set("owner", "user-1")
	original.Set("created_by", "user-1")
	original.Set("external_id", "original")
	if err := app.Save(original); err != nil {
		t.Fatal(err)
	}
	update, err := app.FindRecordById(collection.Name, original.Id)
	if err != nil {
		t.Fatal(err)
	}
	update.Set("owner", "user-2")
	update.Set("created_by", "user-2")
	update.Set("external_id", "replacement")
	restoreProtectedFields(update, "owner", []string{"created_by", "external_id"})

	for field, want := range map[string]string{"owner": "user-1", "created_by": "user-1", "external_id": "original"} {
		if got := update.GetString(field); got != want {
			t.Errorf("%s = %q, want %q", field, got, want)
		}
	}
}

func TestRegisterRequestHooksValidatesPoliciesBeforeRegistration(t *testing.T) {
	app := ownershipTestApp(t)
	for _, testCase := range []struct {
		name     string
		policies []Policy
	}{
		{name: "empty policies"},
		{name: "missing collection", policies: []Policy{{OwnerField: "owner"}}},
		{name: "missing owner field", policies: []Policy{{Collection: "records"}}},
		{name: "duplicate collection", policies: []Policy{{Collection: "records", OwnerField: "owner"}, {Collection: "records", OwnerField: "owner"}}},
		{name: "duplicate owner protection", policies: []Policy{{Collection: "records", OwnerField: "owner", ProtectedFields: []string{"owner"}}}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if err := RegisterRequestHooks(app, testCase.policies...); err == nil {
				t.Fatal("RegisterRequestHooks() succeeded, want validation error")
			}
		})
	}
}

func TestRequestHooksAssignOwnerOnCreate(t *testing.T) {
	var ownerID string
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "ownership create assigns authenticated user",
		Method:         http.MethodPost,
		URL:            "/api/collections/slopstack_ownership_test_records/records",
		Body:           strings.NewReader(`{"title":"created","owner":"spoofed-user"}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := newOwnershipAPITestApp(t)
			userToken, currentOwner := setupOwnershipAPITest(t, app)
			ownerID = currentOwner
			scenario.Headers = map[string]string{"Authorization": "Bearer " + userToken}
			if err := RegisterRequestHooks(app, Policy{Collection: "slopstack_ownership_test_records", OwnerField: "owner"}); err != nil {
				t.Fatal(err)
			}
			return app
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, response *http.Response) {
			var result struct {
				ID string `json:"id"`
			}
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			record, err := app.FindRecordById("slopstack_ownership_test_records", result.ID)
			if err != nil {
				t.Fatal(err)
			}
			if record.GetString("owner") != ownerID {
				t.Fatalf("created owner = %q, want authenticated user %q", record.GetString("owner"), ownerID)
			}
		},
	}
	scenario.Test(t)
}

func TestRequestHooksProtectOwnerAndConfiguredFieldsOnUpdate(t *testing.T) {
	var recordID string
	var ownerID string
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "ownership update preserves owner and protected fields",
		Method:         http.MethodPatch,
		URL:            "/api/collections/slopstack_ownership_test_records/records/ownedrecord0001",
		Body:           strings.NewReader(`{"title":"updated","owner":"spoofed-user","created_by":"spoofed-user"}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"title":"updated"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := newOwnershipAPITestApp(t)
			userToken, currentOwner := setupOwnershipAPITest(t, app)
			ownerID = currentOwner
			scenario.Headers = map[string]string{"Authorization": "Bearer " + userToken}
			collection, err := app.FindCollectionByNameOrId("slopstack_ownership_test_records")
			if err != nil {
				t.Fatal(err)
			}
			record := core.NewRecord(collection)
			record.Id = "ownedrecord0001"
			record.Set("owner", currentOwner)
			record.Set("created_by", currentOwner)
			record.Set("title", "original")
			if err := app.Save(record); err != nil {
				t.Fatal(err)
			}
			recordID = record.Id
			if err := RegisterRequestHooks(app, Policy{
				Collection: "slopstack_ownership_test_records", OwnerField: "owner", ProtectedFields: []string{"created_by"},
			}); err != nil {
				t.Fatal(err)
			}
			return app
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindRecordById("slopstack_ownership_test_records", recordID)
			if err != nil {
				t.Fatal(err)
			}
			if record.GetString("owner") != ownerID || record.GetString("created_by") != ownerID {
				t.Fatalf("protected fields changed: owner=%q created_by=%q", record.GetString("owner"), record.GetString("created_by"))
			}
		},
	}
	scenario.Test(t)
}

func TestRequestHooksRejectUpdatesToAnotherOwner(t *testing.T) {
	var scenario tests.ApiScenario
	scenario = tests.ApiScenario{
		Name:           "ownership update rejects another owner",
		Method:         http.MethodPatch,
		URL:            "/api/collections/slopstack_ownership_test_records/records/ownedrecord0001",
		Body:           strings.NewReader(`{"title":"stolen"}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			"Record is not owned by the current user.",
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := newOwnershipAPITestApp(t)
			userToken, _ := setupOwnershipAPITest(t, app)
			scenario.Headers = map[string]string{"Authorization": "Bearer " + userToken}
			collection, err := app.FindCollectionByNameOrId("slopstack_ownership_test_records")
			if err != nil {
				t.Fatal(err)
			}
			record := core.NewRecord(collection)
			record.Id = "ownedrecord0001"
			record.Set("owner", "another-user")
			record.Set("title", "private")
			if err := app.Save(record); err != nil {
				t.Fatal(err)
			}
			if err := RegisterRequestHooks(app, Policy{Collection: "slopstack_ownership_test_records", OwnerField: "owner"}); err != nil {
				t.Fatal(err)
			}
			return app
		},
	}
	scenario.Test(t)
}

func ownershipTestCollection(t *testing.T, app core.App) *core.Collection {
	t.Helper()
	collection := core.NewBaseCollection("ownership_records")
	collection.Fields.Add(&core.TextField{Name: "owner"})
	collection.Fields.Add(&core.TextField{Name: "created_by"})
	collection.Fields.Add(&core.TextField{Name: "external_id"})
	if err := app.Save(collection); err != nil {
		t.Fatal(err)
	}
	return collection
}

func newOwnershipAPITestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func setupOwnershipAPITest(t testing.TB, app core.App) (token, userID string) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("owner@example.com")
	user.SetPassword("a-long-test-password")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	collection := core.NewBaseCollection("slopstack_ownership_test_records")
	collection.ListRule = types.Pointer("")
	collection.ViewRule = types.Pointer("")
	collection.CreateRule = types.Pointer("")
	collection.UpdateRule = types.Pointer("")
	collection.DeleteRule = types.Pointer("")
	collection.Fields.Add(&core.TextField{Name: "owner"})
	collection.Fields.Add(&core.TextField{Name: "created_by"})
	collection.Fields.Add(&core.TextField{Name: "title", Required: true})
	if err := app.Save(collection); err != nil {
		t.Fatal(err)
	}
	userToken, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return userToken, user.Id
}

func ownershipTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app
}
