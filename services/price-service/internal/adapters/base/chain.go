package base

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/kosarica/price-service/internal/adapters/config"
	httpclient "github.com/kosarica/price-service/internal/http"
	"github.com/kosarica/price-service/internal/http/ratelimit"
	"github.com/kosarica/price-service/internal/types"
)

// BaseAdapterConfig contains configuration for base chain adapter
type BaseAdapterConfig struct {
	Slug                   string
	Name                   string
	SupportedTypes         []types.FileType
	ChainConfig            config.ChainConfig
	FilenamePrefixPatterns []string
	FileExtensionPattern   *regexp.Regexp
	RateLimitOverrides     *ratelimit.PartialConfig
}

// ChainAdapter interface defines the contract for all chain adapters
type ChainAdapter interface {
	Slug() string
	Name() string
	SupportedTypes() []types.FileType
	Discover(targetDate string) ([]types.DiscoveredFile, error)
	Fetch(file types.DiscoveredFile) (*types.FetchedFile, error)
	Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier
	ValidateRow(row types.NormalizedRow) types.NormalizedRowValidation
	ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata
}

// BaseChainAdapter provides common implementations for all chain adapters
type BaseChainAdapter struct {
	slug                   string
	name                   string
	supportedTypes         []types.FileType
	config                 config.ChainConfig
	filenamePrefixPatterns []*regexp.Regexp
	fileExtensionPattern   *regexp.Regexp
	rateLimiter            *ratelimit.RateLimiter
	rateLimitConfig        ratelimit.Config
	httpClient             *httpclient.Client
}

// NewBaseChainAdapter creates a new base chain adapter
func NewBaseChainAdapter(cfg BaseAdapterConfig) (*BaseChainAdapter, error) {
	// Validate supported types is not empty
	if len(cfg.SupportedTypes) == 0 {
		return nil, fmt.Errorf("%s: SupportedTypes cannot be empty", cfg.Slug)
	}

	fileExtensionPattern := cfg.FileExtensionPattern
	if fileExtensionPattern == nil {
		fileExtensionPattern = regexp.MustCompile(`\.(csv|CSV)$`)
	}

	filenamePrefixPatterns := make([]*regexp.Regexp, 0, len(cfg.FilenamePrefixPatterns)+2)
	for _, pattern := range cfg.FilenamePrefixPatterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("invalid filename prefix pattern %q: %w", pattern, err)
		}
		filenamePrefixPatterns = append(filenamePrefixPatterns, re)
	}

	// Add default patterns
	if len(filenamePrefixPatterns) == 0 {
		defaultPatterns := []string{
			`(?i)^` + regexp.QuoteMeta(cfg.Name) + `[_-]?`,
			`(?i)^cjenik[_-]?`,
		}
		for _, pattern := range defaultPatterns {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return nil, fmt.Errorf("invalid default filename prefix pattern %q: %w", pattern, err)
			}
			filenamePrefixPatterns = append(filenamePrefixPatterns, re)
		}
	}

	var rateLimitConfig ratelimit.Config
	if cfg.RateLimitOverrides != nil {
		rateLimitConfig = ratelimit.WithOverrides(*cfg.RateLimitOverrides)
	} else {
		rateLimitConfig = ratelimit.DefaultConfig()
	}

	return &BaseChainAdapter{
		slug:                   cfg.Slug,
		name:                   cfg.Name,
		supportedTypes:         cfg.SupportedTypes,
		config:                 cfg.ChainConfig,
		filenamePrefixPatterns: filenamePrefixPatterns,
		fileExtensionPattern:   fileExtensionPattern,
		rateLimiter:            ratelimit.NewRateLimiter(rateLimitConfig),
		rateLimitConfig:        rateLimitConfig,
		httpClient:             httpclient.NewClient(rateLimitConfig),
	}, nil
}

// Slug returns the chain slug
func (a *BaseChainAdapter) Slug() string {
	return a.slug
}

// Name returns the chain name
func (a *BaseChainAdapter) Name() string {
	return a.name
}

// SupportedTypes returns supported file types
func (a *BaseChainAdapter) SupportedTypes() []types.FileType {
	return a.supportedTypes
}

// BaseURL returns the base URL for the chain's portal
func (a *BaseChainAdapter) BaseURL() string {
	return a.config.BaseURL
}

// HTTPClient returns the HTTP client for making requests
func (a *BaseChainAdapter) HTTPClient() *httpclient.Client {
	return a.httpClient
}

// Discover discovers available price files from the chain's portal
// targetDate is optional (can be empty string) - subclasses may use it for date-specific discovery
func (a *BaseChainAdapter) Discover(targetDate string) ([]types.DiscoveredFile, error) {
	baseURL := a.config.BaseURL
	discoveredFiles := make([]types.DiscoveredFile, 0)

	resp, err := a.httpClient.Get(baseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch %s portal: %w", a.name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch %s portal: status %d", a.name, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	html := string(body)

	// Get file extensions to look for
	extensions := a.getDiscoverableExtensions()
	extensionPattern := strings.Join(extensions, "|")
	linkPattern := regexp.MustCompile(`(?i)href=["']([^"']*\.(` + extensionPattern + `)(?:\?[^"']*)?)["']`)

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

		var fileURL string
		if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
			fileURL = href
		} else {
			parsedURL, err := url.Parse(baseURL)
			if err != nil {
				continue
			}
			if strings.HasPrefix(href, "/") {
				fileURL = fmt.Sprintf("%s://%s%s", parsedURL.Scheme, parsedURL.Host, href)
			} else {
				basePath := parsedURL.Path
				if idx := strings.LastIndex(basePath, "/"); idx >= 0 {
					fileURL = fmt.Sprintf("%s://%s%s%s", parsedURL.Scheme, parsedURL.Host, basePath[:idx+1], href)
				} else {
					fileURL = fmt.Sprintf("%s://%s/%s", parsedURL.Scheme, parsedURL.Host, href)
				}
			}
		}

		filename := a.extractFilenameFromURL(fileURL)
		fileType := a.detectFileType(filename)

		discoveredFiles = append(discoveredFiles, types.DiscoveredFile{
			URL:      fileURL,
			Filename: filename,
			Type:     fileType,
			Size:     nil,
			LastModified: nil,
			Metadata: map[string]string{
				"source":       fmt.Sprintf("%s_portal", a.slug),
				"discoveredAt": time.Now().Format(time.RFC3339),
			},
		})
	}

	return discoveredFiles, nil
}

// getDiscoverableExtensions returns file extensions to look for during discovery
func (a *BaseChainAdapter) getDiscoverableExtensions() []string {
	extensions := make([]string, 0)
	for _, fileType := range a.supportedTypes {
		switch fileType {
		case types.FileTypeCSV:
			extensions = append(extensions, "csv")
		case types.FileTypeXLSX:
			extensions = append(extensions, "xlsx", "xls")
		case types.FileTypeXML:
			extensions = append(extensions, "xml")
		case types.FileTypeZIP:
			extensions = append(extensions, "zip")
		}
	}
	return extensions
}

// extractFilenameFromURL extracts filename from URL
func (a *BaseChainAdapter) extractFilenameFromURL(urlStr string) string {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return fmt.Sprintf("unknown.%s", a.supportedTypes[0])
	}

	pathname := parsedURL.Path
	parts := strings.Split(pathname, "/")
	filename := parts[len(parts)-1]

	if filename == "" {
		return fmt.Sprintf("unknown.%s", a.supportedTypes[0])
	}

	return strings.Split(filename, "?")[0]
}

// detectFileType detects file type from filename
func (a *BaseChainAdapter) detectFileType(filename string) types.FileType {
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
	return a.supportedTypes[0]
}

// Fetch fetches a discovered file with rate limiting and retry logic
func (a *BaseChainAdapter) Fetch(file types.DiscoveredFile) (*types.FetchedFile, error) {
	content, err := a.httpClient.GetBytes(file.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch file: %w", err)
	}

	hash := httpclient.ComputeSha256(content)

	return &types.FetchedFile{
		Discovered: file,
		Content:    content,
		Hash:       hash,
	}, nil
}

// Parse must be implemented by subclasses
func (a *BaseChainAdapter) Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error) {
	return nil, fmt.Errorf("Parse method must be implemented by subclass")
}

// ExtractStoreIdentifier extracts store identifier from discovered file
func (a *BaseChainAdapter) ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier {
	identifier := a.extractStoreIdentifierFromFilename(file.Filename)
	if identifier == "" {
		return nil
	}

	return &types.StoreIdentifier{
		Type:  "filename_code",
		Value: identifier,
	}
}

// extractStoreIdentifierFromFilename extracts store identifier string from filename
func (a *BaseChainAdapter) extractStoreIdentifierFromFilename(filename string) string {
	baseName := a.fileExtensionPattern.ReplaceAllString(filename, "")

	cleanName := baseName
	for _, pattern := range a.filenamePrefixPatterns {
		cleanName = pattern.ReplaceAllString(cleanName, "")
	}

	cleanName = strings.TrimSpace(cleanName)

	if cleanName == "" {
		return a.fileExtensionPattern.ReplaceAllString(filename, "")
	}

	return cleanName
}

// ValidateRow validates a normalized row
func (a *BaseChainAdapter) ValidateRow(row types.NormalizedRow) types.NormalizedRowValidation {
	var errors, warnings []string

	if strings.TrimSpace(row.Name) == "" {
		errors = append(errors, "Missing product name")
	}

	if row.Price <= 0 {
		errors = append(errors, "Price must be positive")
	}

	if row.Price > 100000000 {
		warnings = append(warnings, "Price seems unusually high")
	}

	if row.DiscountPrice != nil && *row.DiscountPrice >= row.Price {
		warnings = append(warnings, "Discount price is not less than regular price")
	}

	for _, barcode := range row.Barcodes {
		if !isValidBarcode(barcode) {
			warnings = append(warnings, fmt.Sprintf("Invalid barcode format: %s", barcode))
		}
	}

	return types.NormalizedRowValidation{
		IsValid:  len(errors) == 0,
		Errors:   errors,
		Warnings: warnings,
	}
}

// isValidBarcode checks if barcode is valid format
func isValidBarcode(barcode string) bool {
	if len(barcode) < 8 || len(barcode) > 14 {
		return false
	}
	for _, c := range barcode {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ExtractStoreMetadata extracts store metadata from file for auto-registration
func (a *BaseChainAdapter) ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata {
	identifier := a.extractStoreIdentifierFromFilename(file.Filename)
	if identifier == "" {
		return nil
	}

	return &types.StoreMetadata{
		Name: fmt.Sprintf("%s %s", a.name, identifier),
	}
}
