package app

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/slopstack/slopstack/apps/server/internal/primitives"
)

func Register(pb *pocketbase.PocketBase, config Config, api huma.API, plugins ...primitives.BackendPlugin) error {
	registry := primitives.NewRegistry()
	for _, plugin := range plugins {
		if err := registry.Register(plugin); err != nil {
			return err
		}
	}
	if err := registry.RegisterEndpoints(api); err != nil {
		return err
	}
	pb.RootCmd.PersistentFlags().StringVar(&config.HTTPAddress, "http", config.HTTPAddress, "HTTP address")
	registerTodoAPI(api)
	registerPreferencesAPI(api)
	pb.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if err := EnsureCollections(e.App); err != nil {
			return err
		}
		if err := registry.EnsureCollections(e.App); err != nil {
			return err
		}
		if err := registry.BindHooks(e.App); err != nil {
			return err
		}
		if err := ownership.RegisterRequestHooks(e.App, ownership.Policy{
			Collection: "todos", OwnerField: "owner", ProtectedFields: []string{"created", "updated"}, AllowSuperusers: true,
		}); err != nil {
			return err
		}
		if err := e.App.RunAppMigrations(); err != nil {
			return err
		}
		stopJobs, err := registry.RunJobs(e.App)
		if err != nil {
			return err
		}
		if stopJobs != nil {
			e.App.OnTerminate().BindFunc(func(_ *core.TerminateEvent) error {
				stopJobs()
				return nil
			})
		}
		return nil
	})
	protectUserAdminFlag(pb, config)

	pb.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.BindFunc(func(event *core.RequestEvent) error {
			if event.Auth == nil || event.Auth.Collection().Name != "users" {
				return event.Next()
			}
			latest, err := event.App.FindRecordById("users", event.Auth.Id)
			if err != nil || latest.GetBool("disabled") {
				return event.UnauthorizedError("account is disabled", err)
			}
			return event.Next()
		})
		registerRoutes(e, config, api)
		return e.Next()
	})
	return nil
}

func protectUserAdminFlag(pb *pocketbase.PocketBase, config Config) {
	pb.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			info, _ := e.RequestInfo()
			if !config.RegistrationEnabled && (info == nil || info.Context != core.RequestInfoContextOAuth2) {
				return e.ForbiddenError("registration is disabled", nil)
			}
			e.Record.Set("isAdmin", false)
			e.Record.Set("disabled", false)
		}
		e.Record.SetEmail(strings.ToLower(strings.TrimSpace(e.Record.Email())))
		if collision, err := userEmailCollision(e.App, e.Record); err != nil {
			return e.InternalServerError("could not check email uniqueness", err)
		} else if collision {
			return e.BadRequestError("an account already uses this email address", nil)
		}
		return e.Next()
	})
	pb.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() {
			if e.Record.GetBool("disabled") != e.Record.Original().GetBool("disabled") {
				return e.ForbiddenError("only an administrator can change account access", nil)
			}
			e.Record.Set("isAdmin", e.Record.Original().GetBool("isAdmin"))
		}
		if !strings.EqualFold(e.Record.Email(), e.Record.Original().Email()) {
			e.Record.SetEmail(strings.ToLower(strings.TrimSpace(e.Record.Email())))
			if collision, err := userEmailCollision(e.App, e.Record); err != nil {
				return e.InternalServerError("could not check email uniqueness", err)
			} else if collision {
				return e.BadRequestError("an account already uses this email address", nil)
			}
		}
		return e.Next()
	})
	pb.OnRecordAuthWithOAuth2Request().BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if !publicOAuthSignupAllowed(config, e.IsNewRecord, e.HasSuperuserAuth()) {
			return e.ForbiddenError("registration is disabled", nil)
		}
		// OAuth linking must never silently replace the currently authenticated
		// account when this provider identity already belongs to another record.
		if e.Auth != nil && e.Auth.Collection().Name == "users" && e.Record != nil && e.Record.Id != e.Auth.Id {
			return e.ForbiddenError("this identity is linked to another account", nil)
		}
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			intent := e.Request.Header.Get("X-Slopstack-Link-Intent")
			if !consumeSsoLinkIntent(e.App, e.Auth.Id, intent) {
				return e.ForbiddenError("reauthenticate and confirm linking before adding an identity", nil)
			}
		}
		return e.Next()
	})
	pb.OnRecordAuthWithPasswordRequest("users").BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		collection, err := e.App.FindCollectionByNameOrId("users")
		if err != nil || !ssoOnlyBlocksPassword(config, collection.OAuth2.Enabled, len(collection.OAuth2.Providers)) {
			// Fail open if provider configuration is absent so an SSO-only
			// setting can never lock every account out.
			return e.Next()
		}
		return e.ForbiddenError("password sign-in is disabled by workspace policy", nil)
	})
	pb.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("account is disabled", nil)
		}
		if config.RequireVerifiedEmail && !e.Record.Verified() {
			return e.ForbiddenError("verify your email before signing in", nil)
		}
		return e.Next()
	})
	pb.OnRecordAuthRefreshRequest("users").BindFunc(func(e *core.RecordAuthRefreshRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("account is disabled", nil)
		}
		return e.Next()
	})
}

func userEmailCollision(app core.App, record *core.Record) (bool, error) {
	email := strings.TrimSpace(record.Email())
	if email == "" {
		return false, nil
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return false, err
	}
	var exists int
	err = app.RecordQuery(users).Select("(1)").AndWhere(dbx.NewExp("lower([[email]]) = lower({:email}) AND [[id]] != {:id}", dbx.Params{"email": email, "id": record.Id})).Limit(1).Row(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func publicOAuthSignupAllowed(config Config, isNewRecord, superuser bool) bool {
	return superuser || !isNewRecord || config.RegistrationEnabled
}

func ssoOnlyBlocksPassword(config Config, oauthEnabled bool, providerCount int) bool {
	return config.SSOOnly && oauthEnabled && providerCount > 0
}

func registerRoutes(e *core.ServeEvent, config Config, api huma.API) {
	e.Router.POST("/api/me/sso/link-intent", createSsoLinkIntent)
	e.Router.GET("/api/auth/policy", func(event *core.RequestEvent) error {
		return event.JSON(http.StatusOK, map[string]any{"registrationEnabled": config.RegistrationEnabled, "requireVerifiedEmail": config.RequireVerifiedEmail})
	})
	e.Router.GET("/openapi.json", func(event *core.RequestEvent) error { return event.JSON(http.StatusOK, api.OpenAPI()) })
	e.Router.GET("/openapi.yaml", func(event *core.RequestEvent) error {
		data, err := api.OpenAPI().YAML()
		if err != nil {
			return err
		}
		return event.Blob(http.StatusOK, "application/yaml", data)
	})
	e.Router.GET("/docs", func(event *core.RequestEvent) error {
		return event.HTML(http.StatusOK, "<!doctype html><html><body><redoc spec-url=\"/openapi.json\"></redoc><script src=\"https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js\"></script></body></html>")
	})
	registerTodoRoutes(e, config)
	registerPreferencesRoutes(e)
	registerStaticFrontend(e, config)
}

type ssoLinkIntent struct {
	UserID    string
	ExpiresAt time.Time
}

var ssoLinkIntentMu sync.Mutex

func consumeSsoLinkIntent(app core.App, userID, intent string) bool {
	if intent == "" {
		return false
	}
	ssoLinkIntentMu.Lock()
	defer ssoLinkIntentMu.Unlock()
	key := "sso-link-intent:" + intent
	entry, ok := app.Store().Get(key).(ssoLinkIntent)
	app.Store().Remove(key)
	return ok && entry.UserID == userID && time.Now().Before(entry.ExpiresAt)
}

func createSsoLinkIntent(event *core.RequestEvent) error {
	if event.Auth == nil || event.Auth.Collection().Name != "users" {
		return event.UnauthorizedError("sign in first", nil)
	}
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(event.Request.Body).Decode(&input); err != nil || input.Password == "" || !event.Auth.ValidatePassword(input.Password) {
		return event.ForbiddenError("confirm your password to link a sign-in method", nil)
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return event.InternalServerError("could not create link intent", err)
	}
	intent := hex.EncodeToString(random)
	event.App.Store().Set("sso-link-intent:"+intent, ssoLinkIntent{UserID: event.Auth.Id, ExpiresAt: time.Now().Add(5 * time.Minute)})
	return event.JSON(http.StatusOK, map[string]string{"intent": intent})
}

func registerStaticFrontend(e *core.ServeEvent, config Config) {
	e.Router.GET("/{path...}", apis.Static(os.DirFS(config.PublicDirectory), true))
}
