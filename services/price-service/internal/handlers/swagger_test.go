package handlers

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
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
