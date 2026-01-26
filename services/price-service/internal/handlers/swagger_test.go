package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	_ "github.com/kosarica/price-service/docs" // Import generated docs
)

// TestSwaggerDependenciesImportable verifies that swaggo packages can be imported
// and that the gin-swagger handler can be created.
// This is a compile-time check ensured by the imports above plus runtime verification.
func TestSwaggerDependenciesImportable(t *testing.T) {
	// If this test compiles, the swaggo dependencies are properly installed.
	// We verify by checking that the handler wrapper is not nil.
	handler := ginSwagger.WrapHandler(swaggerFiles.Handler)
	assert.NotNil(t, handler, "ginSwagger.WrapHandler should return a non-nil handler")
}

// TestSwaggerRouteRegistration verifies that swagger routes can be registered on a Gin router.
func TestSwaggerRouteRegistration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	// Verify that registering the swagger handler doesn't panic
	assert.NotPanics(t, func() {
		router.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	}, "Registering swagger handler should not panic")

	// Verify router has the route registered
	routes := router.Routes()
	found := false
	for _, route := range routes {
		if route.Path == "/docs/*any" && route.Method == "GET" {
			found = true
			break
		}
	}
	assert.True(t, found, "Swagger route should be registered")
}

// setupSwaggerRouter creates a test router with swagger endpoint configured.
func setupSwaggerRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/docs/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	return router
}

// TestSwaggerUIEndpoint verifies that /docs/index.html serves the Swagger UI HTML page.
func TestSwaggerUIEndpoint(t *testing.T) {
	router := setupSwaggerRouter()

	// Use httptest.NewRequest (not http.NewRequest) for proper URL parsing
	req := httptest.NewRequest(http.MethodGet, "/docs/index.html", nil)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code, "Swagger UI should return 200 OK")
	assert.Contains(t, w.Header().Get("Content-Type"), "text/html", "Swagger UI should return HTML content")

	body := w.Body.String()
	assert.Contains(t, body, "swagger", "Response should contain swagger reference")
}

// TestSwaggerJSONEndpoint verifies that /docs/doc.json serves the OpenAPI spec.
func TestSwaggerJSONEndpoint(t *testing.T) {
	router := setupSwaggerRouter()

	req := httptest.NewRequest(http.MethodGet, "/docs/doc.json", nil)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code, "Swagger JSON should return 200 OK")
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json", "Swagger JSON should return JSON content")

	// Verify it's valid JSON with expected structure
	var spec map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &spec)
	require.NoError(t, err, "Response should be valid JSON")

	// Verify swagger version
	assert.Equal(t, "2.0", spec["swagger"], "Swagger spec should be version 2.0")

	// Verify API metadata
	info, ok := spec["info"].(map[string]interface{})
	require.True(t, ok, "Spec should have info section")
	assert.Equal(t, "Price Service API", info["title"], "API title should match")
	assert.Equal(t, "1.0", info["version"], "API version should match")

	// Verify basePath
	assert.Equal(t, "/internal", spec["basePath"], "BasePath should be /internal")

	// Verify paths exist
	paths, ok := spec["paths"].(map[string]interface{})
	require.True(t, ok, "Spec should have paths section")
	assert.Greater(t, len(paths), 0, "Spec should have at least one path")
}

// TestSwaggerSpecEndpoints verifies that the OpenAPI spec contains expected endpoints.
func TestSwaggerSpecEndpoints(t *testing.T) {
	router := setupSwaggerRouter()

	req := httptest.NewRequest(http.MethodGet, "/docs/doc.json", nil)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var spec map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &spec)
	require.NoError(t, err)

	paths, ok := spec["paths"].(map[string]interface{})
	require.True(t, ok)

	expectedEndpoints := []string{
		"/internal/prices/{chainSlug}/{storeId}",
		"/internal/items/search",
		"/internal/ingestion/runs",
		"/internal/ingestion/runs/{runId}",
		"/internal/ingestion/runs/{runId}/files",
		"/internal/ingestion/runs/{runId}/errors",
		"/internal/ingestion/stats",
		"/internal/basket/optimize/single",
		"/internal/basket/optimize/multi",
		"/internal/basket/cache/warmup",
		"/internal/basket/cache/refresh/{chainSlug}",
		"/internal/basket/cache/health",
	}

	for _, endpoint := range expectedEndpoints {
		_, exists := paths[endpoint]
		assert.True(t, exists, "Endpoint %s should be documented in OpenAPI spec", endpoint)
	}
}

// TestSwaggerSpecDefinitions verifies that the OpenAPI spec contains expected type definitions.
func TestSwaggerSpecDefinitions(t *testing.T) {
	router := setupSwaggerRouter()

	req := httptest.NewRequest(http.MethodGet, "/docs/doc.json", nil)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var spec map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &spec)
	require.NoError(t, err)

	definitions, ok := spec["definitions"].(map[string]interface{})
	require.True(t, ok, "Spec should have definitions section")

	expectedDefinitions := []string{
		"handlers.GetStorePricesResponse",
		"handlers.SearchItemsResponse",
		"handlers.ListRunsResponse",
		"handlers.ListFilesResponse",
		"handlers.ListErrorsResponse",
		"handlers.GetStatsResponse",
		"handlers.OptimizeRequest",
		"handlers.MultiStoreResult",
	}

	for _, def := range expectedDefinitions {
		_, exists := definitions[def]
		assert.True(t, exists, "Definition %s should exist in OpenAPI spec", def)
	}
}

// TestSwaggerDocsCSSEndpoint verifies that swagger CSS assets are served.
func TestSwaggerDocsCSSEndpoint(t *testing.T) {
	router := setupSwaggerRouter()

	req := httptest.NewRequest(http.MethodGet, "/docs/swagger-ui.css", nil)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code, "Swagger CSS should return 200 OK")
	assert.Contains(t, w.Header().Get("Content-Type"), "text/css", "Swagger CSS should return CSS content")
}
