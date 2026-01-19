package registry

import (
	"fmt"
	"sync"

	"github.com/kosarica/price-service/internal/adapters/chains"
	"github.com/kosarica/price-service/internal/adapters/config"
	"github.com/kosarica/price-service/internal/types"
)

// ChainAdapter interface defines the contract for all chain adapters
type ChainAdapter interface {
	Slug() string
	Name() string
	SupportedTypes() []types.FileType
	Discover(targetDate string) ([]types.DiscoveredFile, error)
	Fetch(file types.DiscoveredFile) (*types.FetchedFile, error)
	Parse(content []byte, filename string, options *types.ParseOptions) (*types.ParseResult, error)
	ExtractStoreIdentifier(file types.DiscoveredFile) *types.StoreIdentifier
	ValidateRow(row types.NormalizedRow) types.NormalizedRowValidation
	ExtractStoreMetadata(file types.DiscoveredFile) *types.StoreMetadata
}

// Registry manages chain adapter registration and retrieval
type Registry struct {
	mu       sync.RWMutex
	adapters map[config.ChainID]ChainAdapter
}

// DefaultRegistry is the global registry instance
var DefaultRegistry = NewRegistry()

// NewRegistry creates a new chain registry
func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[config.ChainID]ChainAdapter),
	}
}

// Register registers a chain adapter for a given chain ID
func (r *Registry) Register(chainID config.ChainID, adapter ChainAdapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[chainID] = adapter
}

// Get retrieves a chain adapter by chain ID
func (r *Registry) Get(chainID config.ChainID) (ChainAdapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapter, ok := r.adapters[chainID]
	return adapter, ok
}

// GetOrInit retrieves or initializes a chain adapter by chain ID
func (r *Registry) GetOrInit(chainID config.ChainID) (ChainAdapter, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check if already registered
	if adapter, ok := r.adapters[chainID]; ok {
		return adapter, nil
	}

	// Create new adapter based on chain ID
	var adapter ChainAdapter
	var err error

	switch chainID {
	case config.ChainKonzum:
		adapter, err = chains.NewKonzumAdapter()
	// Future chains will be added here
	// case config.ChainLidl:
	// 	adapter, err = chains.NewLidlAdapter()
	default:
		return nil, fmt.Errorf("no adapter implementation for chain: %s", chainID)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create adapter for %s: %w", chainID, err)
	}

	// Register the new adapter
	r.adapters[chainID] = adapter
	return adapter, nil
}

// List returns all registered chain IDs
func (r *Registry) List() []config.ChainID {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := make([]config.ChainID, 0, len(r.adapters))
	for id := range r.adapters {
		ids = append(ids, id)
	}
	return ids
}

// IsRegistered checks if a chain is registered
func (r *Registry) IsRegistered(chainID config.ChainID) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.adapters[chainID]
	return ok
}

// Unregister removes a chain adapter from the registry
func (r *Registry) Unregister(chainID config.ChainID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.adapters, chainID)
}

// GetAdapter is a convenience function to get an adapter from the default registry
func GetAdapter(chainID config.ChainID) (ChainAdapter, error) {
	return DefaultRegistry.GetOrInit(chainID)
}

// RegisterAdapter is a convenience function to register an adapter in the default registry
func RegisterAdapter(chainID config.ChainID, adapter ChainAdapter) {
	DefaultRegistry.Register(chainID, adapter)
}

// InitializeDefaultAdapters initializes all available chain adapters
func InitializeDefaultAdapters() error {
	// Register Konzum
	konzumAdapter, err := chains.NewKonzumAdapter()
	if err != nil {
		return fmt.Errorf("failed to initialize Konzum adapter: %w", err)
	}
	DefaultRegistry.Register(config.ChainKonzum, konzumAdapter)

	// Future chains will be initialized here as they are implemented
	return nil
}
