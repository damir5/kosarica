package middleware

import (
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// InternalAuthMiddleware validates service-to-service authentication
// using the X-Internal-API-Key header
func InternalAuthMiddleware() gin.HandlerFunc {
	apiKey := os.Getenv("INTERNAL_API_KEY")
	if apiKey == "" {
		// Return a middleware that always returns 500 if misconfigured
		return func(c *gin.Context) {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "server misconfigured: INTERNAL_API_KEY not set",
			})
		}
	}
	apiKeyBytes := []byte(apiKey)

	return func(c *gin.Context) {
		key := c.GetHeader("X-Internal-API-Key")
		// Use subtle.ConstantTimeCompare to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(key), apiKeyBytes) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized",
			})
			return
		}
		c.Next()
	}
}
