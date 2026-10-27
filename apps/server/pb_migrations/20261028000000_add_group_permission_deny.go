package migrations

import "github.com/pocketbase/pocketbase/core"

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("group_permissions")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("denied") == nil {
			collection.Fields.Add(&core.BoolField{Name: "denied"})
			return txApp.Save(collection)
		}
		return nil
	}, func(core.App) error {
		return nil
	}, "20261028000000_add_group_permission_deny.go")
}
