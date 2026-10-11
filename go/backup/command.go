package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

var archiveNamePattern = regexp.MustCompile(`^@?[a-z0-9_-]+\.zip(\.enc)?$`)

// Archive describes a backup object in the configured backup store.
type Archive struct {
	Name     string
	Size     int64
	Modified time.Time
}

// Store provides the PocketBase archive operations needed by the CLI. The
// local flag is used for temporary plaintext archives when encryption or
// restore requires a local file, even when the app's backup store is remote.
type Store interface {
	Create(context.Context, string, bool) error
	List(context.Context) ([]Archive, error)
	Read(context.Context, string, bool) ([]byte, error)
	Write(context.Context, string, []byte, bool) error
	Delete(context.Context, string, bool) error
	Restore(context.Context, string, bool) error
}

// NewCommand returns the shared backup command tree for a PocketBase app.
func NewCommand(dataDir string, store Store) *cobra.Command {
	command := &cobra.Command{Use: "backup", Short: "Manage PocketBase backups"}
	command.AddCommand(createCommand(dataDir, store), keyInitCommand(dataDir), keyImportCommand(dataDir), listCommand(store), restoreCommand(dataDir, store))
	return command
}

func createCommand(dataDir string, store Store) *cobra.Command {
	var encrypted bool
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a manual backup",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			name := "manual_" + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
			if !encrypted {
				if err := store.Create(cmd.Context(), name, false); err != nil {
					return fmt.Errorf("create backup: %w", err)
				}
				_, err := fmt.Fprintln(cmd.OutOrStdout(), name)
				return err
			}

			key, err := LoadKey(dataDir)
			if err != nil {
				return fmt.Errorf("load backup encryption key: %w", err)
			}
			tempName := "slopstack_backup_" + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
			if err := store.Create(cmd.Context(), tempName, true); err != nil {
				return fmt.Errorf("create temporary backup: %w", err)
			}
			defer func() { _ = store.Delete(context.Background(), tempName, true) }()

			plain, err := store.Read(cmd.Context(), tempName, true)
			if err != nil {
				return fmt.Errorf("read temporary backup: %w", err)
			}
			ciphertext, err := Encrypt(key, plain)
			if err != nil {
				return fmt.Errorf("encrypt backup: %w", err)
			}
			name = strings.TrimSuffix(name, ".zip") + ".zip.enc"
			if err := store.Write(cmd.Context(), name, ciphertext, false); err != nil {
				return fmt.Errorf("store encrypted backup: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), name)
			return err
		},
	}
	command.Flags().BoolVar(&encrypted, "encrypt", false, "encrypt the archive with the local backup key")
	return command
}

func keyInitCommand(dataDir string) *cobra.Command {
	return &cobra.Command{
		Use:   "key-init",
		Short: "Create a backup encryption key and show it once",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			key, err := CreateKey(dataDir)
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintln(cmd.OutOrStdout(), "Save this recovery key now. It is shown only once:"); err != nil {
				return err
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), key)
			return err
		},
	}
}

func keyImportCommand(dataDir string) *cobra.Command {
	return &cobra.Command{
		Use:   "key-import",
		Short: "Install a saved recovery key from standard input",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			value, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 1025))
			if err != nil {
				return fmt.Errorf("read recovery key: %w", err)
			}
			if len(value) > 1024 {
				return errors.New("recovery key input is too large")
			}
			if err := ImportKey(dataDir, string(value)); err != nil {
				return err
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), "Recovery key installed.")
			return err
		},
	}
}

func listCommand(store Store) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List backup archives",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			files, err := store.List(cmd.Context())
			if err != nil {
				return fmt.Errorf("list backups: %w", err)
			}
			sort.Slice(files, func(i, j int) bool { return files[i].Modified.After(files[j].Modified) })
			writer := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 4, 2, ' ', 0)
			if _, err := fmt.Fprintln(writer, "NAME\tSIZE\tMODIFIED"); err != nil {
				return err
			}
			for _, file := range files {
				if _, err := fmt.Fprintf(writer, "%s\t%d\t%s\n", file.Name, file.Size, file.Modified.UTC().Format(time.RFC3339)); err != nil {
					return err
				}
			}
			return writer.Flush()
		},
	}
}

func restoreCommand(dataDir string, store Store) *cobra.Command {
	var confirmed bool
	command := &cobra.Command{
		Use:   "restore <exact-name>",
		Short: "Restore a backup and restart the process",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			if len(name) > 150 || !archiveNamePattern.MatchString(name) {
				return fmt.Errorf("unsafe backup name %q: use an exact archive name from 'backup list'", name)
			}
			if !confirmed {
				return errors.New("restore requires --confirm")
			}
			if !strings.HasSuffix(name, ".enc") {
				return store.Restore(cmd.Context(), name, false)
			}
			key, err := LoadKey(dataDir)
			if err != nil {
				return fmt.Errorf("load backup encryption key: %w", err)
			}
			ciphertext, err := store.Read(cmd.Context(), name, false)
			if err != nil {
				return fmt.Errorf("read encrypted backup: %w", err)
			}
			plain, err := Decrypt(key, ciphertext)
			if err != nil {
				return err
			}
			tempName := "slopstack_restore_" + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
			if err := store.Write(cmd.Context(), tempName, plain, true); err != nil {
				return fmt.Errorf("prepare temporary restore archive: %w", err)
			}
			defer func() { _ = store.Delete(context.Background(), tempName, true) }()
			return store.Restore(cmd.Context(), tempName, true)
		},
	}
	command.Flags().BoolVar(&confirmed, "confirm", false, "confirm destructive restore")
	return command
}
