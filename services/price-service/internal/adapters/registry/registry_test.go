package registry

import (
	"testing"

	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAllChainsRegistry verifies all chains can be registered.
func TestAllChainsRegistry(t *testing.T) {
	require.NoError(t, InitializeDefaultAdapters())

	// Verify all 11 chains are registered
	chains := []string{
		"konzum", "lidl", "plodine", "interspar", "studenac",
		"kaufland", "eurospin", "dm", "ktc", "metro", "trgocentar",
	}

	for _, chainID := range chains {
		t.Run(chainID, func(t *testing.T) {
			assert.True(t, config.IsValidChainID(chainID))

			adapter, err := GetAdapter(config.ChainID(chainID))
			require.NoError(t, err)
			assert.NotNil(t, adapter)
		})
	}
}
