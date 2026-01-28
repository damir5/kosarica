package handlers

import (
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kosarica/price-service/internal/database"
	"github.com/kosarica/price-service/internal/database/sqlcgen"
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
	queries := sqlcgen.New(database.Pool())
	ctx := c.Request.Context()

	// Query error summary using sqlc
	rows, err := queries.GetErrorSummaryByChain(ctx, pgtype.Timestamp{Time: since, Valid: true})
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to query error statistics"})
		return
	}

	chains := make([]ChainError, 0, len(rows))
	var overallTotalRows int
	var overallFailedRows int

	for _, row := range rows {
		totalRows := int(row.TotalRows)
		failedRows := int(row.FailedRows)

		chainName := getChainName(row.ChainSlug)
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
			ChainSlug:  row.ChainSlug,
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
