package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/types"
	"github.com/spf13/cobra"
)

var (
	discoverDate  string
	discoverOutput string
)

// discoverCmd represents the discover command
var discoverCmd = &cobra.Command{
	Use:   "discover <chain>",
	Short: "Discover available files from a chain's data source",
	Long: `Discover available data files from a retail chain's data source. This command will
scan the chain's website or API and return information about available files including
URL, filename, file type, size, and last modified date.

Output can be formatted as a human-readable table (default) or JSON.`,
	Example: `  price-service discover konzum
  price-service discover lidl --date 2026-01-19
  price-service discover studenac --output json`,
	Args: cobra.ExactArgs(1),
	RunE: runDiscover,
}

func init() {
	rootCmd.AddCommand(discoverCmd)

	discoverCmd.Flags().StringVar(&discoverDate, "date", "", "Target date for discovery (format: YYYY-MM-DD)")
	discoverCmd.Flags().StringVar(&discoverOutput, "output", "table", "Output format: table or json")
}

func runDiscover(cmd *cobra.Command, args []string) error {
	chainID := args[0]

	// Validate chain ID
	if !config.IsValidChainID(chainID) {
		return fmt.Errorf("invalid chain ID: %s\nValid chains: %s", chainID, strings.Join(validChains(), ", "))
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Get chain adapter
	adapter, err := registry.GetAdapter(config.ChainID(chainID))
	if err != nil {
		return fmt.Errorf("failed to get adapter for %s: %w", chainID, err)
	}

	logger.Info().Str("chain", chainID).Msg("Starting discovery")

	// Discover files
	files, err := adapter.Discover(discoverDate)
	if err != nil {
		return fmt.Errorf("discovery failed: %w", err)
	}

	logger.Info().Str("chain", chainID).Msgf("Found %d files", len(files))

	// Output results
	switch strings.ToLower(discoverOutput) {
	case "json":
		return outputDiscoverJSON(files)
	case "table":
		outputDiscoverTable(chainID, files)
	default:
		return fmt.Errorf("invalid output format: %s (use 'table' or 'json')", discoverOutput)
	}

	return nil
}

func outputDiscoverTable(chainID string, files []types.DiscoveredFile) {
	if len(files) == 0 {
		fmt.Printf("No files discovered for chain: %s\n", chainID)
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "FILENAME\tTYPE\tSIZE\tLAST MODIFIED\tURL")
	fmt.Fprintln(w, "--------\t----\t----\t-------------\t---")

	for _, f := range files {
		size := "-"
		if f.Size != nil {
			size = fmt.Sprintf("%d bytes", *f.Size)
		}
		modified := "-"
		if f.LastModified != nil {
			modified = f.LastModified.Format("2006-01-02 15:04:05")
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", f.Filename, f.Type, size, modified, f.URL)
	}

	w.Flush()
}

func outputDiscoverJSON(files []types.DiscoveredFile) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(files)
}
