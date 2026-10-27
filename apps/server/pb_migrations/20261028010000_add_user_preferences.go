package migrations

import "github.com/pocketbase/pocketbase/core"

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		users, err := txApp.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if users.Fields.GetByName("preferences") == nil {
			users.Fields.Add(&core.JSONField{Name: "preferences"})
			return txApp.Save(users)
		}
		return nil
	}, func(core.App) error {
		return nil
	}, "20261028010000_add_user_preferences.go")
}
