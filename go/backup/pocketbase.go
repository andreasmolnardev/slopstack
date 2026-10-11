package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// PocketBaseStore adapts a PocketBase app to the shared backup command.
type PocketBaseStore struct {
	App core.App
}

func (s PocketBaseStore) Create(ctx context.Context, name string, local bool) error {
	settings := s.App.Settings()
	remote := settings.Backups.S3
	if local {
		settings.Backups.S3.Enabled = false
		defer func() { settings.Backups.S3 = remote }()
	}
	return s.App.CreateBackup(ctx, name)
}

func (s PocketBaseStore) List(ctx context.Context) ([]Archive, error) {
	fsys, err := s.App.NewBackupsFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()
	fsys.SetContext(ctx)
	objects, err := fsys.List("")
	if err != nil {
		return nil, err
	}
	files := make([]Archive, 0, len(objects))
	for _, object := range objects {
		if object.IsDir {
			continue
		}
		files = append(files, Archive{Name: object.Key, Size: object.Size, Modified: object.ModTime})
	}
	return files, nil
}

func (s PocketBaseStore) Read(ctx context.Context, name string, local bool) ([]byte, error) {
	settings := s.App.Settings()
	remote := settings.Backups.S3
	if local {
		settings.Backups.S3.Enabled = false
		defer func() { settings.Backups.S3 = remote }()
	}
	fsys, err := s.App.NewBackupsFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()
	fsys.SetContext(ctx)
	reader, err := fsys.GetReader(name)
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	return data, nil
}

func (s PocketBaseStore) Write(ctx context.Context, name string, data []byte, local bool) error {
	settings := s.App.Settings()
	remote := settings.Backups.S3
	if local {
		settings.Backups.S3.Enabled = false
		defer func() { settings.Backups.S3 = remote }()
	}
	fsys, err := s.App.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	fsys.SetContext(ctx)
	return fsys.Upload(data, name)
}

func (s PocketBaseStore) Delete(ctx context.Context, name string, local bool) error {
	settings := s.App.Settings()
	remote := settings.Backups.S3
	if local {
		settings.Backups.S3.Enabled = false
		defer func() { settings.Backups.S3 = remote }()
	}
	fsys, err := s.App.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	fsys.SetContext(ctx)
	return fsys.Delete(name)
}

func (s PocketBaseStore) Restore(ctx context.Context, name string, local bool) error {
	settings := s.App.Settings()
	remote := settings.Backups.S3
	if local {
		settings.Backups.S3.Enabled = false
		defer func() { settings.Backups.S3 = remote }()
	}
	return s.App.RestoreBackup(ctx, name)
}

// CleanupRestoreArchives removes plaintext archives left behind when an
// encrypted restore restarts the PocketBase process. Prefixes defaults to
// Slopstack's transient prefix; applications can pass their legacy prefixes.
func CleanupRestoreArchives(dataDir string, prefixes ...string) error {
	backupDir := filepath.Join(dataDir, core.LocalBackupsDirName)
	if len(prefixes) == 0 {
		prefixes = []string{"slopstack_restore_"}
	}
	entries, err := os.ReadDir(backupDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read backup directory: %w", err)
	}
	for _, entry := range entries {
		matchesPrefix := false
		for _, prefix := range prefixes {
			if prefix != "" && strings.HasPrefix(entry.Name(), prefix) {
				matchesPrefix = true
				break
			}
		}
		if !entry.IsDir() && matchesPrefix && strings.HasSuffix(entry.Name(), ".zip") {
			if err := os.Remove(filepath.Join(backupDir, entry.Name())); err != nil {
				return fmt.Errorf("remove transient restore archive %q: %w", entry.Name(), err)
			}
		}
	}
	return nil
}
