package backup

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestKeyCreateLoadAndImport(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")
	encoded, err := CreateKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encoded, "=") {
		t.Fatal("key encoding must be unpadded")
	}
	key, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(key) != keySize {
		t.Fatalf("created key is not a raw URL encoded 32-byte key: %v", err)
	}
	loaded, err := LoadKey(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, loaded) {
		t.Fatal("loaded key differs from created key")
	}
	info, err := os.Stat(filepath.Join(dataDir, keyFileName))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("key file mode is %o, want 600", got)
	}
	if _, err := CreateKey(dataDir); err == nil {
		t.Fatal("creating a second key should fail")
	}

	importDir := filepath.Join(t.TempDir(), "imported")
	if err := ImportKey(importDir, "\n"+encoded+" \n"); err != nil {
		t.Fatal(err)
	}
	imported, err := LoadKey(importDir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, imported) {
		t.Fatal("imported key differs from source key")
	}
	if err := ImportKey(importDir, encoded); err == nil {
		t.Fatal("importing over an existing key should fail")
	}
}

func TestImportAndLoadRejectInvalidKeys(t *testing.T) {
	for _, encoded := range []string{"", "not-base64", base64.RawURLEncoding.EncodeToString(make([]byte, 31))} {
		if err := ImportKey(t.TempDir(), encoded); err == nil {
			t.Errorf("ImportKey(%q) succeeded, want error", encoded)
		}
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, keyFileName), []byte("bad\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKey(dataDir); err == nil {
		t.Fatal("LoadKey accepted invalid key data")
	}
}

func TestEncryptedEnvelopeIsWireCompatible(t *testing.T) {
	key := bytes.Repeat([]byte{7}, keySize)
	plaintext := []byte("backup contents")
	ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(ciphertext[:len(formatMagic)]); got != "SLBK1" {
		t.Fatalf("envelope magic is %q, want SLBK1", got)
	}
	if bytes.Contains(ciphertext, plaintext) {
		t.Fatal("ciphertext contains plaintext")
	}

	// Decode with the original envelope contract: magic, nonce-prefixed
	// ciphertext, and the slopstack-backup-v1 authenticated data.
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	payload := ciphertext[len("SLBK1"):]
	decoded, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], []byte("slopstack-backup-v1"))
	if err != nil || !bytes.Equal(decoded, plaintext) {
		t.Fatalf("wire-format decrypt failed: %v", err)
	}

	got, err := Decrypt(key, ciphertext)
	if err != nil || !bytes.Equal(got, plaintext) {
		t.Fatalf("Decrypt returned %q, %v", got, err)
	}
	if _, err := Decrypt(bytes.Repeat([]byte{8}, keySize), ciphertext); err == nil {
		t.Fatal("Decrypt accepted wrong key")
	}
	ciphertext[len(ciphertext)-1] ^= 0xff
	if _, err := Decrypt(key, ciphertext); err == nil {
		t.Fatal("Decrypt accepted tampered data")
	}
	if _, err := Decrypt(key, []byte("invalid")); err == nil {
		t.Fatal("Decrypt accepted an unknown envelope")
	}
}
