package migrations

import "github.com/pocketbase/pocketbase/core"

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("todos")
		if err != nil {
			return err
		}
		changed := false
		if collection.Fields.GetByName("description") == nil {
			collection.Fields.Add(&core.TextField{Name: "description"})
			changed = true
		}
		if collection.Fields.GetByName("priority") == nil {
			collection.Fields.Add(&core.TextField{Name: "priority"})
			changed = true
		}
		if !changed {
			return nil
		}
		return txApp.Save(collection)
	}, func(core.App) error {
		return nil
	}, "20261027000000_extend_todos.go")
}
