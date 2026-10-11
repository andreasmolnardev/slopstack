package backup

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// This smoke test uses only a fresh temporary data directory. It suppresses
// PocketBase's final exec-based process restart after RestoreBackup, then
// checks that the restored marker is back on disk.
func TestPocketBaseBackupCLISmoke(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			dataDir := t.TempDir()
			pb := pocketbase.NewWithConfig(pocketbase.Config{
				DefaultDataDir: dataDir,
				DefaultDev:     false,
			})
			if err := pb.Bootstrap(); err != nil {
				t.Fatalf("bootstrap disposable PocketBase app: %v", err)
			}
			t.Cleanup(func() { _ = pb.ResetBootstrapState() })

			// Do not exec the test binary when PocketBase finishes restoring.
			pb.OnTerminate().BindFunc(func(event *core.TerminateEvent) error {
				if event.IsRestart {
					return nil
				}
				return event.Next()
			})

			marker := filepath.Join(dataDir, "backup-smoke-marker.txt")
			before := "present in the archive"
			if err := os.WriteFile(marker, []byte(before), 0o600); err != nil {
				t.Fatal(err)
			}
			store := PocketBaseStore{App: pb}
			if encrypted {
				if _, err := CreateKey(dataDir); err != nil {
					t.Fatalf("create test recovery key: %v", err)
				}
			}

			output, err := executeCommand(t, NewCommand(dataDir, store), createArgs(encrypted)...)
			if err != nil {
				t.Fatalf("run backup create: %v", err)
			}
			archiveName := strings.TrimSpace(output)
			if encrypted && !strings.HasSuffix(archiveName, ".zip.enc") {
				t.Fatalf("encrypted create returned %q", archiveName)
			}
			if !encrypted && !strings.HasSuffix(archiveName, ".zip") {
				t.Fatalf("plain create returned %q", archiveName)
			}

			list, err := executeCommand(t, NewCommand(dataDir, store), "list")
			if err != nil {
				t.Fatalf("run backup list: %v", err)
			}
			if !strings.Contains(list, archiveName) {
				t.Fatalf("backup list does not contain %q:\n%s", archiveName, list)
			}

			plainArchive := filepath.Join(dataDir, "backups", archiveName)
			if encrypted {
				ciphertext, err := os.ReadFile(plainArchive)
				if err != nil {
					t.Fatalf("read encrypted archive: %v", err)
				}
				key, err := LoadKey(dataDir)
				if err != nil {
					t.Fatal(err)
				}
				plain, err := Decrypt(key, ciphertext)
				if err != nil {
					t.Fatalf("decrypt created archive: %v", err)
				}
				plainArchive = filepath.Join(dataDir, "smoke-decrypted.zip")
				if err := os.WriteFile(plainArchive, plain, 0o600); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(plainArchive)
			}
			assertArchiveHasMarker(t, plainArchive, before)

			if err := os.WriteFile(marker, []byte("changed after backup"), 0o600); err != nil {
				t.Fatal(err)
			}
			_, err = executeCommand(t, NewCommand(dataDir, store), "restore", archiveName, "--confirm")
			if err != nil {
				t.Fatalf("run backup restore: %v", err)
			}
			restored, err := os.ReadFile(marker)
			if err != nil {
				t.Fatalf("read restored marker: %v", err)
			}
			if string(restored) != before {
				t.Fatalf("restored marker = %q, want %q", restored, before)
			}
		})
	}
}

func createArgs(encrypted bool) []string {
	args := []string{"create"}
	if encrypted {
		args = append(args, "--encrypt")
	}
	return args
}

func assertArchiveHasMarker(t *testing.T, archivePath, expected string) {
	t.Helper()
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		t.Fatalf("open generated backup ZIP %q: %v", archivePath, err)
	}
	defer archive.Close()
	for _, file := range archive.File {
		if file.Name != "backup-smoke-marker.txt" {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		if !bytes.Equal(data, []byte(expected)) {
			t.Fatalf("archive marker = %q, want %q", data, expected)
		}
		return
	}
	t.Fatalf("archive %q has no backup-smoke-marker.txt entry", archivePath)
}
