package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	starburst "github.com/slopstack/slopstack/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return starburst.EnsureCollections(txApp)
	}, func(core.App) error {
		return nil
	}, "20261119070000_add_podcast_knowledge_gaps.go")
}
