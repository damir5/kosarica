package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
	"github.com/spf13/cobra"
)

var (
	parseChain     string
	parseOutput    string
	parseEncoding  string
)

// parseCmd represents the parse command
var parseCmd = &cobra.Command{
	Use:   "parse <file>",
	Short: "Parse a local file using a chain's parser",
	Long: `Parse a local file using the specified retail chain's parser. This command reads
a local file (CSV, XML, or XLSX) and uses the chain's adapter to parse it into normalized
price data. The output shows parsing statistics including row counts and validation results.

Supported encodings: auto (default), utf-8, windows-1250`,
	Example: `  price-service parse ./data/konzum.csv --chain konzum
  price-service parse ./data/lidl.csv --chain lidl --encoding windows-1250
  price-service parse ./data/dm.xlsx --chain dm --output json`,
	Args: cobra.ExactArgs(1),
	RunE: runParse,
}

func init() {
	rootCmd.AddCommand(parseCmd)

	parseCmd.Flags().StringVar(&parseChain, "chain", "", "Chain ID (required)")
	parseCmd.Flags().StringVar(&parseOutput, "output", "table", "Output format: table or json")
	parseCmd.Flags().StringVar(&parseEncoding, "encoding", "auto", "File encoding: auto, utf-8, or windows-1250")
	parseCmd.MarkFlagRequired("chain")
}

func runParse(cmd *cobra.Command, args []string) error {
	filePath := args[0]

	// Validate chain ID
	if !config.IsValidChainID(parseChain) {
		return fmt.Errorf("invalid chain ID: %s\nValid chains: %s", parseChain, strings.Join(validChains(), ", "))
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Get chain adapter
	adapter, err := registry.GetAdapter(config.ChainID(parseChain))
	if err != nil {
		return fmt.Errorf("failed to get adapter for %s: %w", parseChain, err)
	}

	// Read file content
	logger.Info().Str("file", filePath).Msg("Reading file")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	logger.Info().Str("file", filePath).Msgf("Read %d bytes", len(content))

	// Determine encoding
	encoding := parseEncoding
	if encoding == "auto" {
		// Use chain's default encoding
		if chainCfg, ok := config.GetChainConfig(config.ChainID(parseChain)); ok && chainCfg.CSV != nil {
			switch chainCfg.CSV.Encoding {
			case csv.EncodingUTF8:
				encoding = "utf-8"
			case csv.EncodingWindows1250:
				encoding = "windows-1250"
			}
		} else {
			encoding = "utf-8" // Default fallback
		}
		logger.Info().Str("encoding", encoding).Msg("Auto-detected encoding")
	}

	// Prepare parse options
	parseOptions := &types.ParseOptions{}

	// Parse the file
	logger.Info().Str("chain", parseChain).Str("encoding", encoding).Msg("Parsing file")
	result, err := adapter.Parse(content, filePath, parseOptions)
	if err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	// Output results
	switch strings.ToLower(parseOutput) {
	case "json":
		return outputParseJSON(result)
	case "table":
		outputParseTable(parseChain, result)
	default:
		return fmt.Errorf("invalid output format: %s (use 'table' or 'json')", parseOutput)
	}

	return nil
}

func outputParseTable(chainID string, result *types.ParseResult) {
	fmt.Printf("\nParse Results for %s\n", chainID)
	fmt.Println(strings.Repeat("-", 60))

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintf(w, "Metric\tValue\n")
	fmt.Fprintf(w, "------\t-----\n")
	fmt.Fprintf(w, "Total Rows\t%d\n", result.TotalRows)
	fmt.Fprintf(w, "Valid Rows\t%d\n", result.ValidRows)
	fmt.Fprintf(w, "Invalid Rows\t%d\n", result.TotalRows-result.ValidRows)
	fmt.Fprintf(w, "Errors\t%d\n", len(result.Errors))
	fmt.Fprintf(w, "Warnings\t%d\n", len(result.Warnings))
	w.Flush()

	// Show first few errors if any
	if len(result.Errors) > 0 {
		fmt.Printf("\nFirst %d Errors:\n", min(len(result.Errors), 10))
		fmt.Println(strings.Repeat("-", 60))
		for i, err := range result.Errors {
			if i >= 10 {
				break
			}
			rowNum := "-"
			if err.RowNumber != nil {
				rowNum = fmt.Sprintf("%d", *err.RowNumber)
			}
			field := "-"
			if err.Field != nil {
				field = *err.Field
			}
			fmt.Printf("Row %s, Field '%s': %s\n", rowNum, field, err.Message)
		}
		if len(result.Errors) > 10 {
			fmt.Printf("... and %d more errors\n", len(result.Errors)-10)
		}
	}

	// Show sample of valid rows
	if len(result.Rows) > 0 {
		fmt.Printf("\nSample Rows (first %d):\n", min(len(result.Rows), 5))
		fmt.Println(strings.Repeat("-", 60))
		for i, row := range result.Rows {
			if i >= 5 {
				break
			}
			fmt.Printf("%d. %s - %s (Price: %d¢)\n", i+1, row.StoreIdentifier, row.Name, row.Price)
		}
	}
}

func outputParseJSON(result *types.ParseResult) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
