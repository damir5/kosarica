package docs

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSwaggerInfoMetadata verifies that the generated SwaggerInfo contains
// the correct API metadata from main.go annotations.
func TestSwaggerInfoMetadata(t *testing.T) {
	t.Run("title is set correctly", func(t *testing.T) {
		assert.Equal(t, "Price Service API", SwaggerInfo.Title)
	})

	t.Run("version is set correctly", func(t *testing.T) {
		assert.Equal(t, "1.0", SwaggerInfo.Version)
	})

	t.Run("basePath is set correctly", func(t *testing.T) {
		assert.Equal(t, "/internal", SwaggerInfo.BasePath)
	})

	t.Run("description is set correctly", func(t *testing.T) {
		assert.Equal(t, "Internal API for price data management, ingestion monitoring, and basket optimization.", SwaggerInfo.Description)
	})

	t.Run("instance name is swagger", func(t *testing.T) {
		assert.Equal(t, "swagger", SwaggerInfo.InfoInstanceName)
	})
}

// TestSwaggerTemplateIsValidJSON verifies that the swagger template
// can be rendered to valid JSON (when placeholders are replaced).
func TestSwaggerTemplateIsValidJSON(t *testing.T) {
	// The template uses Go text/template syntax with placeholders
	// We can't fully parse it as JSON without rendering, but we can verify
	// the template is not empty and contains expected structure markers
	template := SwaggerInfo.SwaggerTemplate
	require.NotEmpty(t, template, "Swagger template should not be empty")
	assert.Contains(t, template, `"swagger": "2.0"`, "Template should contain swagger version")
	assert.Contains(t, template, `"paths":`, "Template should contain paths section")
	assert.Contains(t, template, `"definitions":`, "Template should contain definitions section")
}

// TestSwaggerInfoReadDoc verifies that ReadDoc returns valid JSON.
func TestSwaggerInfoReadDoc(t *testing.T) {
	doc := SwaggerInfo.ReadDoc()
	require.NotEmpty(t, doc, "ReadDoc should return non-empty string")

	// Verify it's valid JSON
	var parsed map[string]interface{}
	err := json.Unmarshal([]byte(doc), &parsed)
	require.NoError(t, err, "ReadDoc should return valid JSON")

	// Verify key fields
	info, ok := parsed["info"].(map[string]interface{})
	require.True(t, ok, "JSON should have info section")
	assert.Equal(t, "Price Service API", info["title"])
	assert.Equal(t, "1.0", info["version"])

	assert.Equal(t, "/internal", parsed["basePath"])
	assert.Equal(t, "2.0", parsed["swagger"])
}

// TestSwaggerInfoHasEndpoints verifies that the generated spec
// contains the expected API endpoints.
func TestSwaggerInfoHasEndpoints(t *testing.T) {
	doc := SwaggerInfo.ReadDoc()

	var parsed map[string]interface{}
	err := json.Unmarshal([]byte(doc), &parsed)
	require.NoError(t, err)

	paths, ok := parsed["paths"].(map[string]interface{})
	require.True(t, ok, "JSON should have paths section")

	// Verify some expected endpoints exist
	expectedPaths := []string{
		"/internal/prices/{chainSlug}/{storeId}",
		"/internal/items/search",
		"/internal/ingestion/runs",
		"/internal/ingestion/stats",
		"/internal/basket/optimize/single",
		"/internal/basket/optimize/multi",
	}

	for _, path := range expectedPaths {
		_, exists := paths[path]
		assert.True(t, exists, "Path %s should exist in swagger spec", path)
	}
}

// TestSwaggerInfoHasDefinitions verifies that the generated spec
// contains type definitions for request/response objects.
func TestSwaggerInfoHasDefinitions(t *testing.T) {
	doc := SwaggerInfo.ReadDoc()

	var parsed map[string]interface{}
	err := json.Unmarshal([]byte(doc), &parsed)
	require.NoError(t, err)

	definitions, ok := parsed["definitions"].(map[string]interface{})
	require.True(t, ok, "JSON should have definitions section")

	// Verify some expected types exist
	expectedTypes := []string{
		"handlers.GetStorePricesResponse",
		"handlers.SearchItemsResponse",
		"handlers.ListRunsResponse",
		"handlers.OptimizeRequest",
	}

	for _, typeName := range expectedTypes {
		_, exists := definitions[typeName]
		assert.True(t, exists, "Type %s should exist in swagger definitions", typeName)
	}
}
