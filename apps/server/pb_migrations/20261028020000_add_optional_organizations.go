package migrations

import "github.com/pocketbase/pocketbase/core"

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		groups, err := txApp.FindCollectionByNameOrId("groups")
		if err != nil {
			return err
		}
		if groups.Fields.GetByName("organization") == nil {
			groups.Fields.Add(&core.TextField{Name: "organization"})
			return txApp.Save(groups)
		}
		return nil
	}, func(core.App) error {
		return nil
	}, "20261028020000_add_optional_organizations.go")
}
