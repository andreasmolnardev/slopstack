package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

var archiveNamePattern = regexp.MustCompile(`^@?[a-z0-9_-]+\.zip(\.enc)?$`)

// KeyImportMode controls how the shared backup command receives recovery keys.
type KeyImportMode int

const (
	// KeyImportStdin reads the recovery key from standard input.
	KeyImportStdin KeyImportMode = iota
	// KeyImportArgument accepts one positional recovery key argument.
	KeyImportArgument
	// KeyImportEither accepts one positional key or reads standard input.
	KeyImportEither
)

// CommandOptions customize the shared command tree for applications with
// established CLI contracts. Empty prefixes use the Slopstack defaults.
type CommandOptions struct {
	DataDir               string
	Store                 Store
	EncryptedCreateOnly   bool
	KeyImportMode         KeyImportMode
	KeyInitMessage        string
	KeyImportMessage      string
	RestartGuardEnv       string
	LegacyRestartGuardEnv string
	CreateTempPrefix      string
	RestoreTempPrefix     string
	AdditionalCommands    []*cobra.Command
}

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

// NewCommand returns the shared backup command tree with Slopstack defaults.
func NewCommand(dataDir string, store Store) *cobra.Command {
	return NewCommandWithOptions(CommandOptions{DataDir: dataDir, Store: store})
}

// NewCommandWithOptions returns the shared backup command tree with explicit
// compatibility options for applications that already expose backup commands.
func NewCommandWithOptions(options CommandOptions) *cobra.Command {
	if options.CreateTempPrefix == "" {
		options.CreateTempPrefix = "slopstack_backup_"
	}
	if options.RestoreTempPrefix == "" {
		options.RestoreTempPrefix = "slopstack_restore_"
	}
	if options.KeyInitMessage == "" {
		options.KeyInitMessage = "Save this recovery key now. It is shown only once:"
	}
	if options.KeyImportMessage == "" && options.KeyImportMode != KeyImportArgument {
		options.KeyImportMessage = "Recovery key installed."
	}
	command := &cobra.Command{Use: "backup", Short: "Manage PocketBase backups"}
	command.AddCommand(
		createCommand(options),
		keyInitCommand(options),
		keyImportCommand(options),
		listCommand(options.Store),
		restoreCommand(options),
	)
	command.AddCommand(options.AdditionalCommands...)
	return command
}

func createCommand(options CommandOptions) *cobra.Command {
	encrypted := options.EncryptedCreateOnly
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a manual backup",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			prefix := "manual_" + time.Now().UTC().Format("20060102_150405_000000000")
			if !encrypted {
				name := prefix + ".zip"
				if err := options.Store.Create(cmd.Context(), name, false); err != nil {
					return fmt.Errorf("create backup: %w", err)
				}
				_, err := fmt.Fprintln(cmd.OutOrStdout(), name)
				return err
			}
			name, err := CreateEncryptedArchive(cmd.Context(), options.DataDir, options.Store, options.CreateTempPrefix, prefix)
			if err != nil {
				return fmt.Errorf("create encrypted backup: %w", err)
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), name)
			return err
		},
	}
	if !options.EncryptedCreateOnly {
		command.Flags().BoolVar(&encrypted, "encrypt", false, "encrypt the archive with the local backup key")
	}
	return command
}

// CreateEncryptedArchive creates a PocketBase ZIP locally, encrypts it, and
// stores only the encrypted archive in the configured backup store. Prefix
// may include or omit a .zip or .zip.enc suffix.
func CreateEncryptedArchive(ctx context.Context, dataDir string, store Store, tempPrefix, prefix string) (string, error) {
	key, err := LoadKey(dataDir)
	if err != nil {
		return "", fmt.Errorf("load backup encryption key: %w", err)
	}
	archivePrefix := strings.TrimSuffix(strings.TrimSuffix(prefix, ".zip.enc"), ".zip")
	if archivePrefix == "" {
		return "", errors.New("encrypted backup prefix cannot be empty")
	}
	archiveName := archivePrefix + ".zip.enc"
	if len(archiveName) > 150 || !archiveNamePattern.MatchString(archiveName) {
		return "", fmt.Errorf("unsafe encrypted backup name %q", archiveName)
	}
	if tempPrefix == "" {
		tempPrefix = "slopstack_backup_"
	}
	tempName := tempPrefix + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
	if len(tempName) > 150 || !archiveNamePattern.MatchString(tempName) {
		return "", fmt.Errorf("unsafe temporary backup name %q", tempName)
	}
	if err := store.Create(ctx, tempName, true); err != nil {
		return "", fmt.Errorf("create temporary backup: %w", err)
	}
	defer func() { _ = store.Delete(context.Background(), tempName, true) }()
	plain, err := store.Read(ctx, tempName, true)
	if err != nil {
		return "", fmt.Errorf("read temporary backup: %w", err)
	}
	ciphertext, err := Encrypt(key, plain)
	if err != nil {
		return "", fmt.Errorf("encrypt backup: %w", err)
	}
	if err := store.Write(ctx, archiveName, ciphertext, false); err != nil {
		return "", fmt.Errorf("store encrypted backup: %w", err)
	}
	return archiveName, nil
}

func keyInitCommand(options CommandOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "key-init",
		Short: "Create a backup encryption key and show it once",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			key, err := CreateKey(options.DataDir)
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintln(cmd.OutOrStdout(), options.KeyInitMessage); err != nil {
				return err
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), key)
			return err
		},
	}
}

func keyImportCommand(options CommandOptions) *cobra.Command {
	use := "key-import"
	args := cobra.NoArgs
	if options.KeyImportMode == KeyImportArgument {
		use += " <recovery-key>"
		args = cobra.ExactArgs(1)
	} else if options.KeyImportMode == KeyImportEither {
		use += " [recovery-key]"
		args = cobra.MaximumNArgs(1)
	}
	return &cobra.Command{
		Use:   use,
		Short: "Install a saved recovery key",
		Args:  args,
		RunE: func(cmd *cobra.Command, commandArgs []string) error {
			var value string
			if len(commandArgs) == 1 {
				value = commandArgs[0]
			} else {
				input, err := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 1025))
				if err != nil {
					return fmt.Errorf("read recovery key: %w", err)
				}
				if len(input) > 1024 {
					return errors.New("recovery key input is too large")
				}
				value = string(input)
			}
			if err := ImportKey(options.DataDir, value); err != nil {
				return err
			}
			if options.KeyImportMessage == "" {
				return nil
			}
			_, err := fmt.Fprintln(cmd.OutOrStdout(), options.KeyImportMessage)
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

func restoreCommand(options CommandOptions) *cobra.Command {
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
			if restartGuardAlreadySet(options.RestartGuardEnv, options.LegacyRestartGuardEnv) {
				return nil
			}
			if options.RestartGuardEnv != "" {
				if err := os.Setenv(options.RestartGuardEnv, "1"); err != nil {
					return fmt.Errorf("prepare backup restore restart: %w", err)
				}
				defer func() { _ = os.Unsetenv(options.RestartGuardEnv) }()
			}
			if !strings.HasSuffix(name, ".enc") {
				return options.Store.Restore(cmd.Context(), name, false)
			}
			key, err := LoadKey(options.DataDir)
			if err != nil {
				return fmt.Errorf("load backup encryption key: %w", err)
			}
			ciphertext, err := options.Store.Read(cmd.Context(), name, false)
			if err != nil {
				return fmt.Errorf("read encrypted backup: %w", err)
			}
			plain, err := Decrypt(key, ciphertext)
			if err != nil {
				return err
			}
			tempName := options.RestoreTempPrefix + time.Now().UTC().Format("20060102_150405_000000000") + ".zip"
			if len(tempName) > 150 || !archiveNamePattern.MatchString(tempName) {
				return fmt.Errorf("unsafe temporary restore name %q", tempName)
			}
			if err := options.Store.Write(cmd.Context(), tempName, plain, true); err != nil {
				return fmt.Errorf("prepare temporary restore archive: %w", err)
			}
			defer func() { _ = options.Store.Delete(context.Background(), tempName, true) }()
			return options.Store.Restore(cmd.Context(), tempName, true)
		},
	}
	command.Flags().BoolVar(&confirmed, "confirm", false, "confirm destructive restore")
	return command
}

func restartGuardAlreadySet(primary, legacy string) bool {
	if primary != "" {
		if value, ok := os.LookupEnv(primary); ok && value != "" {
			return value == "1"
		}
	}
	return legacy != "" && os.Getenv(legacy) == "1"
}
