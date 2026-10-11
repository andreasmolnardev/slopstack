package backup

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

type memoryStore struct {
	archives     map[string][]byte
	created      []string
	createLocal  []bool
	restored     string
	restoreLocal bool
}

func (s *memoryStore) Create(_ context.Context, name string, local bool) error {
	if s.archives == nil {
		s.archives = make(map[string][]byte)
	}
	s.created = append(s.created, name)
	s.createLocal = append(s.createLocal, local)
	s.archives[name] = []byte("zip archive")
	return nil
}

func (s *memoryStore) List(context.Context) ([]Archive, error) {
	return []Archive{
		{Name: "older.zip", Size: 3, Modified: time.Unix(1, 0)},
		{Name: "newer.zip.enc", Size: 8, Modified: time.Unix(2, 0)},
	}, nil
}

func (s *memoryStore) Read(_ context.Context, name string, _ bool) ([]byte, error) {
	data, ok := s.archives[name]
	if !ok {
		return nil, errors.New("missing archive")
	}
	return append([]byte(nil), data...), nil
}

func (s *memoryStore) Write(_ context.Context, name string, data []byte, local bool) error {
	if s.archives == nil {
		s.archives = make(map[string][]byte)
	}
	s.archives[name] = append([]byte(nil), data...)
	return nil
}

func (s *memoryStore) Delete(_ context.Context, name string, _ bool) error {
	delete(s.archives, name)
	return nil
}

func (s *memoryStore) Restore(_ context.Context, name string, local bool) error {
	s.restored = name
	s.restoreLocal = local
	return nil
}

func executeCommand(t *testing.T, command *cobra.Command, args ...string) (string, error) {
	t.Helper()
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetErr(io.Discard)
	command.SetIn(strings.NewReader(""))
	command.SetArgs(args)
	err := command.Execute()
	return output.String(), err
}

func TestCommandCreateEncryptedArchive(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := CreateKey(dataDir); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{}
	output, err := executeCommand(t, NewCommand(dataDir, store), "create", "--encrypt")
	if err != nil {
		t.Fatal(err)
	}
	name := strings.TrimSpace(output)
	if !strings.HasSuffix(name, ".zip.enc") {
		t.Fatalf("created name = %q, want .zip.enc", name)
	}
	if len(store.created) != 1 || len(store.createLocal) != 1 || !store.createLocal[0] {
		t.Fatalf("temporary create calls = %v, local = %v", store.created, store.createLocal)
	}
	if _, ok := store.archives[name]; !ok {
		t.Fatalf("encrypted archive %q was not saved", name)
	}
	for archivedName := range store.archives {
		if strings.HasPrefix(archivedName, "slopstack_backup_") {
			t.Fatalf("temporary plaintext archive %q was not removed", archivedName)
		}
	}
}

func TestCommandRestoreRequiresConfirmationAndDecrypts(t *testing.T) {
	dataDir := t.TempDir()
	_, err := CreateKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := LoadKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := Encrypt(decoded, []byte("zip archive"))
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{archives: map[string][]byte{"backup.zip.enc": ciphertext}}
	if _, err := executeCommand(t, NewCommand(dataDir, store), "restore", "backup.zip.enc"); err == nil || !strings.Contains(err.Error(), "--confirm") {
		t.Fatalf("restore without confirmation error = %v", err)
	}
	if _, err := executeCommand(t, NewCommand(dataDir, store), "restore", "backup.zip.enc", "--confirm"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(store.restored, "slopstack_restore_") || !store.restoreLocal {
		t.Fatalf("restore used archive %q, local = %t", store.restored, store.restoreLocal)
	}
	if _, ok := store.archives[store.restored]; ok {
		t.Fatal("temporary restore archive was not removed after restore")
	}
}

func TestCommandRestoreRejectsUnsafeName(t *testing.T) {
	store := &memoryStore{}
	_, err := executeCommand(t, NewCommand(t.TempDir(), store), "restore", "../backup.zip", "--confirm")
	if err == nil || !strings.Contains(err.Error(), "unsafe backup name") {
		t.Fatalf("unsafe restore error = %v", err)
	}
}

func TestCommandListSortsNewestFirst(t *testing.T) {
	store := &memoryStore{}
	output, err := executeCommand(t, NewCommand(t.TempDir(), store), "list")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Index(output, "newer.zip.enc") > strings.Index(output, "older.zip") {
		t.Fatalf("backup list is not newest-first:\n%s", output)
	}
}

func TestCommandKeyImportReadsStandardInput(t *testing.T) {
	dataDir := t.TempDir()
	key, err := CreateKey(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	command := NewCommand(dataDir, &memoryStore{})
	_, err = executeCommandWithInput(t, command, strings.NewReader(key+"\n"), "key-import")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKey(dataDir); err != nil {
		t.Fatalf("imported key is not readable: %v", err)
	}
}

func executeCommandWithInput(t *testing.T, command *cobra.Command, input io.Reader, args ...string) (string, error) {
	t.Helper()
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetErr(io.Discard)
	command.SetIn(input)
	command.SetArgs(args)
	err := command.Execute()
	return output.String(), err
}
