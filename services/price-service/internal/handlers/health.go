package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/database"
)

// HealthResponse represents the health check response
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
}

// HealthCheck handles the health check endpoint
func HealthCheck(c *gin.Context) {
	response := HealthResponse{
		Status: "ok",
	}

	// Check database connection
	if database.Pool() != nil {
		err := database.Status(c.Request.Context())
		if err != nil {
			response.Database = "disconnected"
			c.JSON(http.StatusServiceUnavailable, response)
			return
		}
		response.Database = "connected"
	} else {
		response.Database = "not configured"
	}

	c.JSON(http.StatusOK, response)
}
