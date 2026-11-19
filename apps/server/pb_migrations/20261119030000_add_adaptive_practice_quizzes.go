package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	starburst "github.com/slopstack/slopstack/apps/server/internal/app"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		return starburst.EnsureAdaptivePracticeCollection(txApp)
	}, func(core.App) error {
		return nil
	}, "20261119030000_add_adaptive_practice_quizzes.go")
}
