package storage

import (
	"fmt"

	"github.com/kosarica/price-service/config"
)

// NewStorageBackend creates a Storage implementation based on configuration
func NewStorageBackend(cfg *config.StorageConfig) (Storage, error) {
	switch cfg.Type {
	case "local", "":
		basePath := cfg.Local.BasePath
		if basePath == "" {
			basePath = "./data"
		}
		return NewLocalStorage(basePath)
	case "s3":
		return nil, fmt.Errorf("S3 storage not yet implemented")
	default:
		return nil, fmt.Errorf("unknown storage type: %q", cfg.Type)
	}
}
