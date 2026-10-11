package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanupRestoreArchivesRemovesOnlyConfiguredPrefixes(t *testing.T) {
	dataDir := t.TempDir()
	backupDir := filepath.Join(dataDir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"slopstack_restore_old.zip",
		"piggybudget_restore_old.zip",
		"manual_backup.zip",
		"piggybudget_restore_keep.json",
	} {
		if err := os.WriteFile(filepath.Join(backupDir, name), []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := CleanupRestoreArchives(dataDir, "slopstack_restore_", "piggybudget_restore_"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"slopstack_restore_old.zip", "piggybudget_restore_old.zip"} {
		if _, err := os.Stat(filepath.Join(backupDir, name)); !os.IsNotExist(err) {
			t.Fatalf("transient archive %q remains, stat error = %v", name, err)
		}
	}
	for _, name := range []string{"manual_backup.zip", "piggybudget_restore_keep.json"} {
		if _, err := os.Stat(filepath.Join(backupDir, name)); err != nil {
			t.Fatalf("unrelated backup %q was removed: %v", name, err)
		}
	}
}
