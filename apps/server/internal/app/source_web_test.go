package app

import (
	"net"
	"strings"
	"testing"
)

func TestValidateWebImportURLRestrictsSchemesHostsAndPorts(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://192.168.1.4/",
		"http://example.com:8080/", "https://user:pass@example.com/", "https://example.com/#fragment",
	} {
		if _, _, _, err := validateWebImportURL(raw); err == nil {
			t.Errorf("unsafe URL accepted: %s", raw)
		}
	}
	for _, raw := range []string{"https://example.org/article", "http://example.org/"} {
		if _, _, _, err := validateWebImportURL(raw); err != nil {
			t.Errorf("valid URL rejected (%s): %v", raw, err)
		}
	}
}

func TestWebImportRejectsNonPublicDNSAddresses(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "169.254.1.2", "100.64.0.1", "192.0.2.1", "::1", "fd00::1", "2001:db8::1"} {
		if isPublicWebIP(net.ParseIP(raw)) {
			t.Errorf("non-public IP accepted: %s", raw)
		}
	}
	if !isPublicWebIP(net.ParseIP("1.1.1.1")) {
		t.Fatal("public IP rejected")
	}
}

func TestExtractVisibleWebTextDropsActiveAndHiddenContent(t *testing.T) {
	title, content, err := extractVisibleWebText([]byte(`<html><head><title> A page </title><script>secret()</script></head><body><h1>Hello</h1><p>Visible <strong>text</strong></p><div hidden>hidden</div><p style="display: none">also hidden</p><iframe>frame text</iframe></body></html>`))
	if err != nil {
		t.Fatal(err)
	}
	if title != "A page" || !strings.Contains(content, "Hello") || !strings.Contains(content, "Visible text") {
		t.Fatalf("unexpected extraction title=%q content=%q", title, content)
	}
	for _, secret := range []string{"secret", "hidden", "also hidden", "frame text"} {
		if strings.Contains(content, secret) {
			t.Errorf("extracted non-visible content %q from %q", secret, content)
		}
	}
}
