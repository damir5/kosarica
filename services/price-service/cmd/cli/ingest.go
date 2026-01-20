package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/adapters/registry"
	"github.com/kosarica/price-service/internal/pipeline"
	"github.com/spf13/cobra"
)

var (
	ingestDate string
	ingestAll  bool
)

// ingestCmd represents the ingest command
var ingestCmd = &cobra.Command{
	Use:   "ingest <chain>",
	Short: "Run full ingestion pipeline for a chain",
	Long: `Run the complete ingestion pipeline (discover, fetch, parse, persist) for a specific
retail chain. The pipeline will discover available files, download them, parse the content,
and persist the normalized data to the database.

Use --all to ingest all chains at once.`,
	Example: `  price-service ingest konzum
  price-service ingest lidl --date 2026-01-19
  price-service ingest --all`,
	Args: cobra.MaximumNArgs(1),
	RunE: runIngest,
}

func init() {
	rootCmd.AddCommand(ingestCmd)

	ingestCmd.Flags().StringVar(&ingestDate, "date", "", "Target date for discovery (format: YYYY-MM-DD, defaults to today)")
	ingestCmd.Flags().BoolVar(&ingestAll, "all", false, "Ingest all chains")
}

func runIngest(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Determine which chains to process
	var chains []config.ChainID

	if ingestAll {
		chains = config.ChainIDs
		logger.Info().Msgf("Ingesting all %d chains", len(chains))
	} else {
		if len(args) == 0 {
			return fmt.Errorf("either specify <chain> or use --all flag")
		}
		chainID := args[0]
		if !config.IsValidChainID(chainID) {
			return fmt.Errorf("invalid chain ID: %s\nValid chains: %s", chainID, strings.Join(validChains(), ", "))
		}
		chains = []config.ChainID{config.ChainID(chainID)}
	}

	// Initialize chain registry
	if err := registry.InitializeDefaultAdapters(); err != nil {
		return fmt.Errorf("failed to initialize chain registry: %w", err)
	}

	// Track results
	results := make([]ingestResult, 0, len(chains))

	// Process each chain
	for _, chainID := range chains {
		logger.Info().Str("chain", string(chainID)).Msg("Starting ingestion")
		result, err := pipeline.Run(ctx, string(chainID), ingestDate)
		if err != nil {
			logger.Error().Str("chain", string(chainID)).Err(err).Msg("Ingestion failed")
			results = append(results, ingestResult{
				Chain:   string(chainID),
				Success: false,
				Error:   err.Error(),
			})
			continue
		}
		results = append(results, ingestResult{
			Chain:            string(chainID),
			Success:          result.Success,
			RunID:            result.RunID,
			FilesProcessed:   result.FilesProcessed,
			EntriesPersisted: result.EntriesPersisted,
			ErrorCount:       len(result.Errors),
		})
	}

	// Display results table
	displayIngestResults(results)

	// Return error if any chain failed
	for _, r := range results {
		if !r.Success {
			return fmt.Errorf("some ingestions failed")
		}
	}

	return nil
}

type ingestResult struct {
	Chain            string
	Success          bool
	RunID            string
	FilesProcessed   int
	EntriesPersisted int
	ErrorCount       int
	Error            string
}

func displayIngestResults(results []ingestResult) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "CHAIN\tSTATUS\tRUN ID\tFILES\tENTRIES\tERRORS")
	fmt.Fprintln(w, "------\t------\t------\t-----\t-------\t------")

	for _, r := range results {
		status := "SUCCESS"
		if !r.Success {
			status = "FAILED"
		}
		runID := r.RunID
		if runID == "" {
			runID = "-"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%d\t%d\n", r.Chain, status, runID, r.FilesProcessed, r.EntriesPersisted, r.ErrorCount)
	}

	w.Flush()
}

func validChains() []string {
	chains := make([]string, len(config.ChainIDs))
	for i, c := range config.ChainIDs {
		chains[i] = string(c)
	}
	return chains
}
