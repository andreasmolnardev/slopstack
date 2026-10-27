package app

import (
	"os"
	"strings"
)

// Version returns the release identifier shared by the binary and OpenAPI.
// Packaging copies VERSION into the runtime image; the environment override is
// useful for source checkouts and development builds.
func Version() string {
	if version := strings.TrimSpace(os.Getenv("SLOPSTACK_VERSION")); version != "" {
		return version
	}
	data, err := os.ReadFile("VERSION")
	if err == nil {
		if version := strings.TrimSpace(string(data)); version != "" {
			return version
		}
	}
	return "dev"
}
