package middleware

import (
	"crypto/subtle"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// InternalAuthMiddleware validates service-to-service authentication
// using the X-Internal-API-Key header
func InternalAuthMiddleware() gin.HandlerFunc {
	apiKey := os.Getenv("INTERNAL_API_KEY")
	if apiKey == "" {
		log.Fatal("INTERNAL_API_KEY not set")
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
