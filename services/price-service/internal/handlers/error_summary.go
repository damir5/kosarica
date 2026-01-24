package handlers

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kosarica/price-service/internal/database"
)

type ErrorSummary struct {
	ErrorRate  float64      `json:"errorRate"`
	TotalRows  int          `json:"totalRows"`
	FailedRows int          `json:"failedRows"`
	Chains     []ChainError `json:"chains"`
	TimeRange  string       `json:"timeRange"`
}

type ChainError struct {
	ChainSlug  string  `json:"chainSlug"`
	ChainName  string  `json:"chainName"`
	TotalRows  int     `json:"totalRows"`
	FailedRows int     `json:"failedRows"`
	ErrorRate  float64 `json:"errorRate"`
	Status     string  `json:"status"`
}

func getChainName(slug string) string {
	switch slug {
	case "konzum":
		return "Konzum"
	case "lidl":
		return "Lidl"
	case "plodine":
		return "Plodine"
	case "interspar":
		return "Interspar"
	case "eurospin":
		return "Eurospin"
	case "ktc":
		return "KTC"
	case "metro":
		return "Metro"
	case "studenac":
		return "Studenac"
	case "trgocentar":
		return "Trgocentar"
	case "kaufland":
		return "Kaufland"
	default:
		return slug
	}
}

// GetErrorSummary returns ingestion error statistics
// GET /internal/ingestion/error-summary?hours=24
func GetErrorSummary(c *gin.Context) {
	hoursStr := c.DefaultQuery("hours", "24")
	hours, err := strconv.Atoi(hoursStr)
	if err != nil {
		hours = 24
	}

	since := time.Now().Add(-time.Duration(hours) * time.Hour)
	pool := database.Pool()
	ctx := context.Background()

	const query = `
		SELECT
			chain_slug,
			COUNT(*) as total_rows,
			COUNT(*) as failed_rows,
			MIN(failed_at) as first_failed,
			MAX(failed_at) as last_failed
		FROM retailer_items_failed
		WHERE failed_at >= $1
		GROUP BY chain_slug
	`

	rows, err := pool.Query(ctx, query, since)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to query error statistics"})
		return
	}
	defer rows.Close()

	chains := make([]ChainError, 0)
	var overallTotalRows int
	var overallFailedRows int

	for rows.Next() {
		var chainSlug string
		var totalRows int
		var failedRows int
		var firstFailed, lastFailed *time.Time

		err := rows.Scan(&chainSlug, &totalRows, &failedRows, &firstFailed, &lastFailed)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to scan row"})
			return
		}

		chainName := getChainName(chainSlug)
		errorRate := 0.0
		if totalRows > 0 {
			errorRate = float64(failedRows) / float64(totalRows)
		}

		status := "healthy"
		if errorRate > 0.10 {
			status = "critical"
		} else if errorRate > 0.03 {
			status = "degraded"
		}

		chains = append(chains, ChainError{
			ChainSlug:  chainSlug,
			ChainName:  chainName,
			TotalRows:  totalRows,
			FailedRows: failedRows,
			ErrorRate:  errorRate,
			Status:     status,
		})

		overallTotalRows += totalRows
		overallFailedRows += failedRows
	}

	overallErrorRate := 0.0
	if overallTotalRows > 0 {
		overallErrorRate = float64(overallFailedRows) / float64(overallTotalRows)
	}

	c.JSON(200, ErrorSummary{
		ErrorRate:  overallErrorRate,
		TotalRows:  overallTotalRows,
		FailedRows: overallFailedRows,
		Chains:     chains,
		TimeRange:  fmt.Sprintf("Last %d hours", hours),
	})
}
