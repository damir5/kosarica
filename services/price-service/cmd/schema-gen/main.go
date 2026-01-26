// Schema Generator
//
// Generates JSON Schema files from Go types for use in Node.js Zod schema generation.
// Go is the source of truth for shared API types between services.
//
// Usage:
//
//	go run cmd/schema-gen/main.go
//
// Output:
//
//	../../shared/schemas/basket.json
//	../../shared/schemas/prices.json
//	../../shared/schemas/ingestion.json
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/invopop/jsonschema"
	"github.com/kosarica/price-service/internal/handlers"
)

// SchemaGroup represents a group of related schemas
type SchemaGroup struct {
	Name   string
	Types  []any
	Output string
}

func main() {
	// Output directory (relative to services/price-service)
	outputDir := "../../shared/schemas"

	// Ensure output directory exists
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create output directory: %v\n", err)
		os.Exit(1)
	}

	// Define schema groups
	groups := []SchemaGroup{
		{
			Name: "basket",
			Types: []any{
				// Request types
				handlers.BasketItem{},
				handlers.Location{},
				handlers.OptimizeRequest{},
				// Response types
				handlers.MissingItem{},
				handlers.ItemPriceInfo{},
				handlers.SingleStoreResult{},
				handlers.StoreAllocation{},
				handlers.MultiStoreResult{},
			},
			Output: "basket.json",
		},
		{
			Name: "prices",
			Types: []any{
				// Request types
				handlers.GetStorePricesRequest{},
				handlers.SearchItemsRequest{},
				handlers.GetHistoricalPriceRequest{},
				handlers.ListPriceGroupsRequest{},
				// Response types
				handlers.StorePrice{},
				handlers.GetStorePricesResponse{},
				handlers.SearchItem{},
				handlers.SearchItemsResponse{},
				handlers.PriceGroupSummary{},
			},
			Output: "prices.json",
		},
		{
			Name: "ingestion",
			Types: []any{
				// Request types
				handlers.ListRunsRequest{},
				handlers.ListFilesRequest{},
				handlers.ListErrorsRequest{},
				handlers.GetStatsRequest{},
				handlers.RerunRunRequest{},
				// Response types
				handlers.IngestionRun{},
				handlers.ListRunsResponse{},
				handlers.IngestionFile{},
				handlers.ListFilesResponse{},
				handlers.IngestionError{},
				handlers.ListErrorsResponse{},
				handlers.StatsBucket{},
				handlers.GetStatsResponse{},
				handlers.ListChainsResponse{},
			},
			Output: "ingestion.json",
		},
	}

	// Generate schemas for each group
	for _, group := range groups {
		schema := generateGroupSchema(group)
		outputPath := filepath.Join(outputDir, group.Output)

		if err := writeSchema(schema, outputPath); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to write %s: %v\n", group.Output, err)
			os.Exit(1)
		}

		fmt.Printf("Generated %s\n", outputPath)
	}

	fmt.Println("Schema generation complete!")
}

// generateGroupSchema creates a combined schema with all types in a group
func generateGroupSchema(group SchemaGroup) map[string]any {
	reflector := &jsonschema.Reflector{
		DoNotReference: false,
		ExpandedStruct: false,
	}

	// Create combined definitions
	definitions := make(map[string]any)

	for _, t := range group.Types {
		schema := reflector.Reflect(t)

		// Get the type name from the schema
		typeName := ""
		if schema.Ref != "" {
			// Extract type name from $ref like "#/$defs/BasketItem"
			typeName = filepath.Base(schema.Ref)
		}

		// Add all definitions from this type's schema
		for name, def := range schema.Definitions {
			definitions[name] = def
		}

		// If there's a main type, add it to definitions too
		if typeName != "" && schema.Definitions[typeName] != nil {
			definitions[typeName] = schema.Definitions[typeName]
		}
	}

	return map[string]any{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"$id":         fmt.Sprintf("https://kosarica.hr/schemas/%s.json", group.Name),
		"title":       fmt.Sprintf("%s API Types", capitalize(group.Name)),
		"description": fmt.Sprintf("JSON Schema for %s API types generated from Go structs", group.Name),
		"$defs":       definitions,
	}
}

// writeSchema writes a schema to a JSON file
func writeSchema(schema map[string]any, path string) error {
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal schema: %w", err)
	}

	return os.WriteFile(path, data, 0644)
}

func capitalize(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
