package app

import (
	"os"
	"strconv"
)

type Config struct {
	HTTPAddress         string
	PublicURL           string
	SecureCookies       bool
	RegistrationEnabled bool
	LogLevel            string
	StoragePath         string
	Development         bool
}

func LoadConfig() Config {
	return Config{
		HTTPAddress:         env("SLOPSTACK_HTTP_ADDRESS", "0.0.0.0:8090"),
		PublicURL:           env("SLOPSTACK_PUBLIC_URL", "http://localhost:8090"),
		SecureCookies:       envBool("SLOPSTACK_SECURE_COOKIES", false),
		RegistrationEnabled: envBool("SLOPSTACK_REGISTRATION_ENABLED", true),
		LogLevel:            env("SLOPSTACK_LOG_LEVEL", "info"),
		StoragePath:         env("SLOPSTACK_STORAGE_PATH", "pb_data"),
		Development:         envBool("SLOPSTACK_DEVELOPMENT", false),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}
