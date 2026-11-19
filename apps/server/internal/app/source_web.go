package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/html"
	"golang.org/x/net/idna"
)

const (
	maxWebImportURLBytes = 2048
	maxWebImportBody     = 16 << 10
	maxWebPageBytes      = 5 << 20
	maxWebPageTextBytes  = 1 << 20
	webImportTimeout     = 15 * time.Second
)

type sourceWebImportInput struct {
	Body struct {
		URL   string `json:"url"`
		Title string `json:"title,omitempty"`
	}
}

type fetchedWebPage struct {
	Title   string
	Content string
}

type webPageFetcher func(context.Context, string) (fetchedWebPage, error)

type sourceWebResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type systemSourceWebResolver struct{}

func (systemSourceWebResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

func registerSourceWebImportAPI(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "importLearningWebSource", Method: http.MethodPost, Path: "/api/learning/sources/web",
		Tags: []string{"Learning"}, Summary: "Import text from a public web page as an owned source",
		Description: "Fetches a public HTTP or HTTPS page with SSRF protections, extracts visible text, and stores it for the authenticated owner.",
		Security:    []map[string][]string{{"pocketbaseAuth": {}}},
		Errors:      []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusRequestTimeout, http.StatusNotFound, http.StatusInternalServerError},
	}, func(context.Context, *sourceWebImportInput) (*sourceOutput, error) { return nil, nil })
}

func registerSourceWebImportRoute(event *core.ServeEvent) {
	event.Router.POST("/api/learning/sources/web", sourceWebImportRoute)
}

func sourceWebImportRoute(event *core.RequestEvent) error {
	return sourceWebImportRouteWith(event, fetchPublicWebPage)
}

func sourceWebImportRouteWith(event *core.RequestEvent, fetch webPageFetcher) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	var input sourceWebImportInput
	requestBody, err := io.ReadAll(io.LimitReader(event.Request.Body, maxWebImportBody+1))
	if err != nil || len(requestBody) > maxWebImportBody {
		return event.BadRequestError("web source request exceeds the size limit", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(requestBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input.Body); err != nil {
		return event.BadRequestError("invalid web source request", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return event.BadRequestError("request must contain one JSON object", err)
	}
	if input.Body.URL == "" || len(input.Body.URL) > maxWebImportURLBytes {
		return event.BadRequestError("web page URL is required and must be at most 2048 bytes", nil)
	}
	if input.Body.Title = strings.TrimSpace(input.Body.Title); len([]rune(input.Body.Title)) > 200 {
		return event.BadRequestError("source title must be at most 200 characters", nil)
	}
	page, err := fetch(event.Request.Context(), input.Body.URL)
	if err != nil {
		return event.BadRequestError("could not import this web page", err)
	}
	content := strings.TrimSpace(page.Content)
	if content == "" {
		return event.BadRequestError("web page has no readable text", nil)
	}
	if len(content) > maxLearningBody {
		return event.BadRequestError("extracted page text exceeds the 1 MiB source limit", nil)
	}
	title := input.Body.Title
	if title == "" {
		title = strings.TrimSpace(page.Title)
	}
	if title == "" {
		parsed, _ := url.Parse(input.Body.URL)
		title = parsed.Hostname()
	}
	if len([]rune(title)) > 200 {
		title = truncateRunes(title, 200)
	}

	sources, err := event.App.FindCollectionByNameOrId("learning_sources")
	if err != nil {
		return event.InternalServerError("source collection unavailable", err)
	}
	source := core.NewRecord(sources)
	source.Set("owner", user.Id)
	source.Set("title", title)
	source.Set("source_type", "text/markdown")
	source.Set("content", content)
	source.Set("metadata", map[string]any{"bytes": len(content), "imported_from": "web", "url": input.Body.URL})
	if err := event.App.Save(source); err != nil {
		return event.InternalServerError("could not save web source", err)
	}
	units, err := event.App.FindCollectionByNameOrId("knowledge_units")
	if err != nil {
		_ = event.App.Delete(source)
		return event.InternalServerError("knowledge collection unavailable", err)
	}
	unit := core.NewRecord(units)
	unit.Set("owner", user.Id)
	unit.Set("title", title)
	unit.Set("description", truncateRunes(content, 500))
	unit.Set("unit_type", "concept")
	unit.Set("metadata", map[string]any{"source_id": source.Id, "provenance": "web"})
	if err := event.App.Save(unit); err != nil {
		_ = event.App.Delete(source)
		return event.InternalServerError("could not create source concept", err)
	}
	return event.JSON(http.StatusCreated, map[string]any{"source": source.PublicExport(), "knowledge_unit": unit.PublicExport()})
}

func fetchPublicWebPage(ctx context.Context, rawURL string) (fetchedWebPage, error) {
	return fetchPublicWebPageWith(ctx, rawURL, systemSourceWebResolver{}, (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 20 * time.Second}).DialContext)
}

func fetchPublicWebPageWith(ctx context.Context, rawURL string, resolver sourceWebResolver, dial func(context.Context, string, string) (net.Conn, error)) (fetchedWebPage, error) {
	target, host, port, err := validateWebImportURL(rawURL)
	if err != nil {
		return fetchedWebPage{}, err
	}
	ips, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 || len(ips) > 32 {
		return fetchedWebPage{}, fmt.Errorf("could not resolve a public web host")
	}
	for _, ip := range ips {
		if !isPublicWebIP(ip.IP) {
			return fetchedWebPage{}, fmt.Errorf("web host resolves to a non-public address")
		}
	}
	validatedIPs := append([]net.IPAddr(nil), ips...)

	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 7 * time.Second,
		DisableCompression:    true,
		DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
			requestedHost, requestedPort, splitErr := net.SplitHostPort(address)
			if splitErr != nil || !strings.EqualFold(strings.TrimSuffix(requestedHost, "."), strings.TrimSuffix(host, ".")) || requestedPort != port {
				return nil, fmt.Errorf("unexpected dial target")
			}
			var lastErr error
			for _, ip := range validatedIPs {
				if network == "tcp4" && ip.IP.To4() == nil || network == "tcp6" && ip.IP.To4() != nil {
					continue
				}
				conn, dialErr := dial(dialCtx, network, net.JoinHostPort(ip.IP.String(), port))
				if dialErr == nil {
					return conn, nil
				}
				lastErr = dialErr
			}
			if lastErr == nil {
				lastErr = fmt.Errorf("no address for requested network")
			}
			return nil, lastErr
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   webImportTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return fetchedWebPage{}, fmt.Errorf("invalid web page URL")
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9")
	request.Header.Set("Accept-Encoding", "identity")
	request.Header.Set("User-Agent", "StarburstSourceImporter/1.0 (+self-hosted learning platform)")
	response, err := client.Do(request)
	if err != nil {
		return fetchedWebPage{}, fmt.Errorf("web page request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fetchedWebPage{}, fmt.Errorf("web page returned HTTP %d; redirects are not followed", response.StatusCode)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "text/html" && mediaType != "application/xhtml+xml" && mediaType != "text/plain" {
		return fetchedWebPage{}, fmt.Errorf("web page must return HTML or plain text")
	}
	if encoding := strings.TrimSpace(strings.ToLower(response.Header.Get("Content-Encoding"))); encoding != "" && encoding != "identity" {
		return fetchedWebPage{}, fmt.Errorf("compressed web pages are not supported")
	}
	if response.ContentLength > maxWebPageBytes {
		return fetchedWebPage{}, fmt.Errorf("web page exceeds the 5 MiB response limit")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxWebPageBytes+1))
	if err != nil {
		return fetchedWebPage{}, fmt.Errorf("could not read web page")
	}
	if len(body) > maxWebPageBytes {
		return fetchedWebPage{}, fmt.Errorf("web page exceeds the 5 MiB response limit")
	}
	var page fetchedWebPage
	if mediaType == "text/plain" {
		page.Content = strings.ToValidUTF8(string(body), "�")
	} else {
		page.Title, page.Content, err = extractVisibleWebText(body)
		if err != nil {
			return fetchedWebPage{}, err
		}
	}
	page.Content = strings.TrimSpace(page.Content)
	if len(page.Content) > maxWebPageTextBytes {
		return fetchedWebPage{}, fmt.Errorf("extracted page text exceeds the 1 MiB source limit")
	}
	return page, nil
}

func validateWebImportURL(raw string) (*url.URL, string, string, error) {
	if len(raw) == 0 || len(raw) > maxWebImportURLBytes {
		return nil, "", "", fmt.Errorf("web page URL is required and must be at most 2048 bytes")
	}
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !target.IsAbs() || target.Opaque != "" || target.User != nil || target.Fragment != "" {
		return nil, "", "", fmt.Errorf("enter a valid HTTP or HTTPS URL without credentials or a fragment")
	}
	scheme := strings.ToLower(target.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, "", "", fmt.Errorf("only HTTP and HTTPS pages can be imported")
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "" || strings.Contains(host, "%") {
		return nil, "", "", fmt.Errorf("web page URL has an invalid host")
	}
	port := "80"
	if scheme == "https" {
		port = "443"
	}
	if explicitPort := target.Port(); explicitPort != "" {
		if explicitPort != port {
			return nil, "", "", fmt.Errorf("web page import supports only the standard HTTP or HTTPS port")
		}
	}
	if ip := net.ParseIP(host); ip == nil {
		asciiHost, idnaErr := idna.Lookup.ToASCII(host)
		if idnaErr != nil || asciiHost == "" {
			return nil, "", "", fmt.Errorf("web page URL has an invalid hostname")
		}
		host = strings.ToLower(asciiHost)
		if strings.Contains(host, ".") == false || isBlockedWebHostname(host) {
			return nil, "", "", fmt.Errorf("web page host must be a public DNS name")
		}
		for _, label := range strings.Split(host, ".") {
			if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return nil, "", "", fmt.Errorf("web page URL has an invalid hostname")
			}
			for _, char := range label {
				if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-') {
					return nil, "", "", fmt.Errorf("web page URL has an invalid hostname")
				}
			}
		}
	} else {
		if !isPublicWebIP(ip) {
			return nil, "", "", fmt.Errorf("web page host must be a public IP address")
		}
	}
	target.Scheme = scheme
	if target.Port() == "" {
		target.Host = host
		if strings.Contains(host, ":") {
			target.Host = "[" + host + "]"
		}
	} else {
		target.Host = net.JoinHostPort(host, port)
	}
	return target, host, port, nil
}

func isBlockedWebHostname(host string) bool {
	for _, suffix := range []string{".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid", ".example", ".onion"} {
		if host == strings.TrimPrefix(suffix, ".") || strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func isPublicWebIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	if !addr.IsValid() || !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsMulticast() || addr.IsUnspecified() {
		return false
	}
	if addr.Is4() {
		for _, block := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4"} {
			prefix := netip.MustParsePrefix(block)
			if prefix.Contains(addr) {
				return false
			}
		}
		return true
	}
	globalV6 := netip.MustParsePrefix("2000::/3")
	if !globalV6.Contains(addr) || netip.MustParsePrefix("2001:db8::/32").Contains(addr) || netip.MustParsePrefix("2001::/23").Contains(addr) {
		return false
	}
	return true
}

func extractVisibleWebText(body []byte) (string, string, error) {
	document, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("could not parse web page HTML")
	}
	title := extractWebPageTitle(document)
	var text strings.Builder
	var visit func(*html.Node, bool)
	visit = func(node *html.Node, hidden bool) {
		if node.Type == html.ElementNode {
			tag := strings.ToLower(node.Data)
			if tag == "script" || tag == "style" || tag == "noscript" || tag == "template" || tag == "svg" || tag == "head" || tag == "iframe" || tag == "canvas" {
				return
			}
			for _, attr := range node.Attr {
				if strings.EqualFold(attr.Key, "hidden") || strings.EqualFold(attr.Key, "aria-hidden") && strings.EqualFold(attr.Val, "true") {
					hidden = true
				}
				if strings.EqualFold(attr.Key, "style") {
					style := strings.ToLower(strings.ReplaceAll(attr.Val, " ", ""))
					if strings.Contains(style, "display:none") || strings.Contains(style, "visibility:hidden") {
						hidden = true
					}
				}
			}
			if !hidden && isWebBlockTag(tag) {
				text.WriteByte('\n')
			}
		}
		if node.Type == html.TextNode && !hidden {
			value := strings.Join(strings.Fields(node.Data), " ")
			if value != "" {
				text.WriteString(value)
				text.WriteByte(' ')
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child, hidden)
		}
		if node.Type == html.ElementNode && !hidden && isWebBlockTag(strings.ToLower(node.Data)) {
			text.WriteByte('\n')
		}
	}
	visit(document, false)
	content := strings.TrimSpace(strings.Join(strings.Fields(text.String()), " "))
	if len(content) > maxWebPageTextBytes {
		return "", "", fmt.Errorf("extracted page text exceeds the 1 MiB source limit")
	}
	return title, content, nil
}

func extractWebPageTitle(document *html.Node) string {
	var title strings.Builder
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode && strings.EqualFold(node.Data, "title") {
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				if child.Type == html.TextNode {
					title.WriteString(child.Data)
					title.WriteByte(' ')
				}
			}
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(document)
	return strings.TrimSpace(strings.Join(strings.Fields(title.String()), " "))
}

func isWebBlockTag(tag string) bool {
	switch tag {
	case "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul":
		return true
	default:
		return false
	}
}
