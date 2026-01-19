package discovery

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/types"
)

// HTMLOptions contains options for HTML discovery
type HTMLOptions struct {
	Extensions        []string        // File extensions to look for (e.g., ["csv", "xml"])
	LinkPattern       *regexp.Regexp  // Custom pattern for matching links
	MaxPages          int             // Maximum pages to crawl (for pagination)
	PaginationPattern *regexp.Regexp  // Pattern for pagination links
	Headers           map[string]string // Custom HTTP headers
}

// HTMLOptionsDefault returns default HTML discovery options
func HTMLOptionsDefault() HTMLOptions {
	return HTMLOptions{
		Extensions: []string{"csv", "xml", "xlsx", "xls", "zip"},
		MaxPages:   1,
		Headers: map[string]string{
			"User-Agent": "Mozilla/5.0 (compatible; PriceTracker/1.0)",
			"Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		},
	}
}

// HTMLDiscoverer discovers files from HTML pages
type HTMLDiscoverer struct {
	client   *http.Client
	options  HTMLOptions
	baseURL  *url.URL
	chainSlug string
}

// NewHTMLDiscoverer creates a new HTML discoverer
func NewHTMLDiscoverer(baseURL string, chainSlug string, options HTMLOptions) (*HTMLDiscoverer, error) {
	parsedURL, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}

	return &HTMLDiscoverer{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		options:  options,
		baseURL:  parsedURL,
		chainSlug: chainSlug,
	}, nil
}

// Discover discovers files from the HTML page
func (d *HTMLDiscoverer) Discover() ([]types.DiscoveredFile, error) {
	discoveredFiles, err := d.discoverPage(d.baseURL.String())
	if err != nil {
		return nil, err
	}

	// Handle pagination if configured
	if d.options.MaxPages > 1 && d.options.PaginationPattern != nil {
		visited := make(map[string]bool)
		visited[d.baseURL.String()] = true
		queue := []string{d.baseURL.String()}

		for len(queue) > 0 && len(visited) < d.options.MaxPages {
			currentURL := queue[0]
			queue = queue[1:]

			files, err := d.discoverPage(currentURL)
			if err != nil {
				continue
			}

			// Merge discovered files
			discoveredFiles = mergeDiscoveredFiles(discoveredFiles, files)

			// Find pagination links (would need page content for this)
			// For now, this is a placeholder for pagination support
		}
	}

	return discoveredFiles, nil
}

// discoverPage discovers files from a single page
func (d *HTMLDiscoverer) discoverPage(pageURL string) ([]types.DiscoveredFile, error) {
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	for key, value := range d.options.Headers {
		req.Header.Set(key, value)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch page: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(body)
	return d.extractLinks(html, pageURL), nil
}

// extractLinks extracts file links from HTML content
func (d *HTMLDiscoverer) extractLinks(html, pageURL string) []types.DiscoveredFile {
	discoveredFiles := make([]types.DiscoveredFile, 0)

	// Build link pattern from extensions
	extensionPattern := strings.Join(d.options.Extensions, "|")
	linkPattern := d.options.LinkPattern
	if linkPattern == nil {
		linkPattern = regexp.MustCompile(`href=["']([^"']*\.(` + extensionPattern + `)(?:\?[^"']*)?)["']`)
	}

	matches := linkPattern.FindAllStringSubmatch(html, -1)
	seenURLs := make(map[string]bool)

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		href := match[1]
		if seenURLs[href] {
			continue
		}
		seenURLs[href] = true

		fileURL, err := d.resolveURL(href, pageURL)
		if err != nil {
			continue
		}

		filename := d.extractFilenameFromURL(fileURL)
		fileType := d.detectFileType(filename)

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:      fileURL,
			Filename: filename,
			Type:     fileType,
			Size:     nil,
			LastModified: nil,
			Metadata: map[string]string{
				"source":       fmt.Sprintf("%s_portal", d.chainSlug),
				"discoveredAt": time.Now().Format(time.RFC3339),
			},
		})
	}

	return discoveredFiles
}

// resolveURL resolves a potentially relative URL against the base URL
func (d *HTMLDiscoverer) resolveURL(href, contextURL string) (string, error) {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href, nil
	}

	contextParsed, err := url.Parse(contextURL)
	if err != nil {
		return "", err
	}

	if strings.HasPrefix(href, "/") {
		return fmt.Sprintf("%s://%s%s", contextParsed.Scheme, contextParsed.Host, href), nil
	}

	// Relative URL - resolve against context path
	contextPath := contextParsed.Path
	if idx := strings.LastIndex(contextPath, "/"); idx >= 0 {
		basePath := contextPath[:idx+1]
		return fmt.Sprintf("%s://%s%s%s", contextParsed.Scheme, contextParsed.Host, basePath, href), nil
	}

	return fmt.Sprintf("%s://%s/%s", contextParsed.Scheme, contextParsed.Host, href), nil
}

// extractFilenameFromURL extracts filename from URL
func (d *HTMLDiscoverer) extractFilenameFromURL(urlStr string) string {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return "unknown"
	}

	pathname := parsedURL.Path
	parts := strings.Split(pathname, "/")
	if len(parts) == 0 {
		return "unknown"
	}

	filename := parts[len(parts)-1]
	if filename == "" {
		return "unknown"
	}

	return strings.Split(filename, "?")[0]
}

// detectFileType detects file type from filename
func (d *HTMLDiscoverer) detectFileType(filename string) types.FileType {
	lowerFilename := strings.ToLower(filename)
	if strings.HasSuffix(lowerFilename, ".csv") {
		return types.FileTypeCSV
	}
	if strings.HasSuffix(lowerFilename, ".xlsx") || strings.HasSuffix(lowerFilename, ".xls") {
		return types.FileTypeXLSX
	}
	if strings.HasSuffix(lowerFilename, ".xml") {
		return types.FileTypeXML
	}
	if strings.HasSuffix(lowerFilename, ".zip") {
		return types.FileTypeZIP
	}
	return types.FileTypeCSV // Default
}

// mergeDiscoveredFiles merges two lists of discovered files, removing duplicates
func mergeDiscoveredFiles(a, b []types.DiscoveredFile) []types.DiscoveredFile {
	seen := make(map[string]bool)
	result := make([]types.DiscoveredFile, 0)

	for _, f := range a {
		if !seen[f.URL] {
			seen[f.URL] = true
			result = append(result, f)
		}
	}

	for _, f := range b {
		if !seen[f.URL] {
			seen[f.URL] = true
			result = append(result, f)
		}
	}

	return result
}

// ExtractLinksFromHTML is a helper function to extract links from raw HTML content
func ExtractLinksFromHTML(htmlContent, baseURL, chainSlug string, extensions []string) []types.DiscoveredFile {
	options := HTMLOptionsDefault()
	options.Extensions = extensions

	discoverer, err := NewHTMLDiscoverer(baseURL, chainSlug, options)
	if err != nil {
		return []types.DiscoveredFile{}
	}

	return discoverer.extractLinks(htmlContent, baseURL)
}

// FindLinksByPattern finds all links matching a custom regex pattern
func FindLinksByPattern(htmlContent, baseURL, chainSlug string, pattern *regexp.Regexp) []types.DiscoveredFile {
	options := HTMLOptionsDefault()
	options.LinkPattern = pattern

	discoverer, err := NewHTMLDiscoverer(baseURL, chainSlug, options)
	if err != nil {
		return []types.DiscoveredFile{}
	}

	return discoverer.extractLinks(htmlContent, baseURL)
}
