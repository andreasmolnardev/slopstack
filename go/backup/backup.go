// Package backup provides PocketBase archive commands and key management with
// authenticated encryption for backup data.
package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	keyFileName = ".backup-encryption-key"
	formatMagic = "SLBK1"
	formatAAD   = "slopstack-backup-v1"
	keySize     = 32
)

// CreateKey creates a new random 256-bit key in dataDir and returns it in
// unpadded base64 URL encoding. It fails if a key file already exists.
func CreateKey(dataDir string) (string, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", fmt.Errorf("create data directory: %w", err)
	}

	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return "", fmt.Errorf("generate encryption key: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(key)
	if err := writeKey(dataDir, encoded); err != nil {
		return "", err
	}
	return encoded, nil
}

// ImportKey stores an existing unpadded base64 URL encoded 256-bit key in
// dataDir. It fails if a key file already exists.
func ImportKey(dataDir, encoded string) error {
	encoded = strings.TrimSpace(encoded)
	key, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(key) != keySize {
		return errors.New("recovery key is invalid")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	return writeKey(dataDir, encoded)
}

// LoadKey reads and decodes the key stored in dataDir.
func LoadKey(dataDir string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(dataDir, keyFileName))
	if err != nil {
		return nil, fmt.Errorf("read encryption key: %w", err)
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(key) != keySize {
		return nil, errors.New("encryption key is invalid")
	}
	return key, nil
}

// Encrypt encrypts plaintext with AES-GCM and returns the versioned SLBK1
// envelope used by Slopstack backup consumers.
func Encrypt(key, plaintext []byte) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate encryption nonce: %w", err)
	}
	envelope := append([]byte(formatMagic), gcm.Seal(nonce, nonce, plaintext, []byte(formatAAD))...)
	return envelope, nil
}

// Decrypt opens an SLBK1 AES-GCM envelope produced by Encrypt.
func Decrypt(key, encrypted []byte) ([]byte, error) {
	if len(encrypted) < len(formatMagic) || string(encrypted[:len(formatMagic)]) != formatMagic {
		return nil, errors.New("unsupported or invalid encrypted data")
	}
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	payload := encrypted[len(formatMagic):]
	if len(payload) < gcm.NonceSize() {
		return nil, errors.New("invalid encrypted data")
	}
	nonce := payload[:gcm.NonceSize()]
	plaintext, err := gcm.Open(nil, nonce, payload[gcm.NonceSize():], []byte(formatAAD))
	if err != nil {
		return nil, errors.New("could not decrypt data; check the key and file integrity")
	}
	return plaintext, nil
}

func writeKey(dataDir, encoded string) error {
	path := filepath.Join(dataDir, keyFileName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return errors.New("encryption key already exists")
		}
		return fmt.Errorf("save encryption key: %w", err)
	}
	if _, err := io.WriteString(file, encoded+"\n"); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return fmt.Errorf("write encryption key: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("close encryption key: %w", err)
	}
	return nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create AES-GCM: %w", err)
	}
	return gcm, nil
}
