package database

import (
	"time"
)

// PriceGroup represents a content-addressable group of prices
// Multiple stores with identical price sets share the same PriceGroup
type PriceGroup struct {
	ID          string    `json:"id"`           // UUID (using google/uuid)
	ChainSlug   string    `json:"chain_slug"`   // FK to chains.slug
	PriceHash   string    `json:"price_hash"`   // SHA-256 hex of sorted prices
	HashVersion int       `json:"hash_version"` // Hash algorithm version
	StoreCount  int       `json:"store_count"`  // Number of stores using this group
	ItemCount   int       `json:"item_count"`   // Number of items in this group
	FirstSeenAt time.Time `json:"first_seen_at"` // First time this price set was seen
	LastSeenAt  time.Time `json:"last_seen_at"`  // Last time this price set was seen
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// GroupPrice represents a single item's price within a price group
type GroupPrice struct {
	PriceGroupID   string  `json:"price_group_id"`   // FK to price_groups.id
	RetailerItemID string  `json:"retailer_item_id"` // FK to retailer_items.id
	Price          int     `json:"price"`            // cents/lipa, NOT NULL
	DiscountPrice  *int    `json:"discount_price"`   // NULL = no discount (distinct from 0!)
	UnitPrice      *int    `json:"unit_price"`       // price per unit in cents (e.g., per kg/l)
	AnchorPrice    *int    `json:"anchor_price"`     // "sidrena cijena" anchor/reference price in cents
	CreatedAt      time.Time `json:"created_at"`
}

// StoreGroupHistory represents the temporal history of store->group mappings
// A store can be assigned to different price groups over time
type StoreGroupHistory struct {
	ID           string     `json:"id"`            // UUID
	StoreID      string     `json:"store_id"`      // FK to stores.id
	PriceGroupID string     `json:"price_group_id"` // FK to price_groups.id
	ValidFrom    time.Time  `json:"valid_from"`    // When this membership started
	ValidTo      *time.Time `json:"valid_to"`      // NULL = current membership, set = historical
	CreatedAt    time.Time  `json:"created_at"`
}

// StorePriceException represents a rare price override for a specific store/item
// Exceptions MUST have an expiration date for audit compliance
type StorePriceException struct {
	StoreID        string    `json:"store_id"`        // FK to stores.id
	RetailerItemID string    `json:"retailer_item_id"` // FK to retailer_items.id
	Price          int       `json:"price"`           // cents/lipa
	DiscountPrice  *int      `json:"discount_price"`   // NULL = no discount (distinct from 0!)
	Reason         string    `json:"reason"`          // Why this exception exists
	ExpiresAt      time.Time `json:"expires_at"`      // Exceptions MUST expire
	CreatedAt      time.Time `json:"created_at"`
	CreatedBy      *string   `json:"created_by"`      // FK to user.id (optional)
}

// PriceGroupDetail is a view combining PriceGroup with its GroupPrices
type PriceGroupDetail struct {
	PriceGroup
	Prices []GroupPrice `json:"prices"`
}

// StorePriceResult represents the result of a price lookup for a store
type StorePriceResult struct {
	RetailerItemID string  `json:"retailer_item_id"`
	Price          int     `json:"price"`
	DiscountPrice  *int    `json:"discount_price"`
	UnitPrice      *int    `json:"unit_price"`
	AnchorPrice    *int    `json:"anchor_price"`
	IsException    bool    `json:"is_exception"` // True if price comes from store_price_exceptions
}
