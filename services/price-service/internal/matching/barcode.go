package matching

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BarcodeResult tracks the outcome of barcode matching
type BarcodeResult struct {
	NewProducts     int
	NewLinks        int
	SuspiciousFlags int
	Skipped         int // Invalid/placeholder barcodes
}

// RetailerItem represents a retailer item for barcode matching
type RetailerItem struct {
	ID           string
	Name         string
	Brand        string
	Unit         string
	UnitQuantity string
	Category     string
	Barcode      string
	ChainSlug    string
	ExternalID   string
	ImageURL     string
}

// AutoMatchByBarcode processes barcodes in batches with streaming from DB
// Uses advisory locks to prevent race conditions on barcode processing
func AutoMatchByBarcode(ctx context.Context, db *pgxpool.Pool, batchSize int) (*BarcodeResult, error) {
	result := &BarcodeResult{}

	// Stream barcodes from DB instead of loading all into memory
	rows, err := db.Query(ctx, `
		SELECT DISTINCT
			rib.barcode,
			ri.id,
			ri.name,
			ri.brand,
			ri.unit,
			ri.unit_quantity,
			ri.category,
			ri.image_url,
			c.slug as chain_slug,
			ri.external_id
		FROM retailer_item_barcodes rib
		JOIN retailer_items ri ON ri.id = rib.retailer_item_id
		JOIN chains c ON c.slug = ri.chain_slug
		WHERE rib.barcode IS NOT NULL AND rib.barcode != ''
		AND NOT EXISTS (
			SELECT 1 FROM product_links pl WHERE pl.retailer_item_id = ri.id
		)
		ORDER BY rib.barcode
	`)
	if err != nil {
		return nil, fmt.Errorf("query barcodes: %w", err)
	}
	defer rows.Close()

	// Group items by normalized barcode
	barcodeItems := make(map[string][]RetailerItem)
	for rows.Next() {
		var item RetailerItem
		if err := rows.Scan(
			&item.Barcode,
			&item.ID,
			&item.Name,
			&item.Brand,
			&item.Unit,
			&item.UnitQuantity,
			&item.Category,
			&item.ImageURL,
			&item.ChainSlug,
			&item.ExternalID,
		); err != nil {
			slog.Error("scan barcode row", "error", err)
			continue
		}

		normalized := NormalizeBarcode(item.Barcode)
		if normalized == "" {
			result.Skipped++
			continue
		}

		barcodeItems[normalized] = append(barcodeItems[normalized], item)
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate barcode rows: %w", rows.Err())
	}

	// Process each unique barcode
	for barcode, items := range barcodeItems {
		if err := processBarcodeItems(ctx, db, barcode, items, result); err != nil {
			slog.Error("barcode processing failed", "barcode", barcode[:4]+"...", "error", err)
			// Continue with other barcodes
		}
	}

	return result, nil
}

// processBarcodeItems processes all items sharing the same barcode
// Uses advisory lock for race safety
func processBarcodeItems(ctx context.Context, db *pgxpool.Pool, barcode string, items []RetailerItem, result *BarcodeResult) error {
	return pgx.BeginTxFunc(ctx, db, pgx.TxOptions{}, func(tx pgx.Tx) error {
		// 1. Advisory lock on barcode hash - works BEFORE row exists
		_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, barcode)
		if err != nil {
			return fmt.Errorf("advisory lock: %w", err)
		}

		// 2. Check if canonical barcode already exists and get product_id
		var productID *string
		err = tx.QueryRow(ctx, `
			SELECT product_id FROM canonical_barcodes WHERE barcode = $1
		`, barcode).Scan(&productID)

		if err == pgx.ErrNoRows {
			// 3a. No existing mapping - check sanity before creating
			flag := checkSuspiciousBarcode(items)
			if flag != "" {
				// Queue for review instead of auto-linking
				for _, item := range items {
					if err := queueForReview(ctx, tx, item.ID, flag); err != nil {
						return fmt.Errorf("queue for review: %w", err)
					}
				}
				result.SuspiciousFlags += len(items)
				return nil
			}

			// 3b. Create product and register barcode atomically
			best := pickBestItem(items)
			newProductID, err := createProduct(ctx, tx, best)
			if err != nil {
				return fmt.Errorf("create product: %w", err)
			}

			_, err = tx.Exec(ctx, `
				INSERT INTO canonical_barcodes (barcode, product_id)
				VALUES ($1, $2)
			`, barcode, newProductID)
			if err != nil {
				return fmt.Errorf("register barcode: %w", err)
			}

			productID = &newProductID
			result.NewProducts++
		} else if err != nil {
			return fmt.Errorf("query canonical barcode: %w", err)
		} else if productID == nil {
			// Placeholder row exists but no product yet (shouldn't happen with advisory lock)
			return fmt.Errorf("orphan barcode entry: %s", barcode)
		}

		// 4. Link all items to product
		for _, item := range items {
			_, err := tx.Exec(ctx, `
				INSERT INTO product_links (id, product_id, retailer_item_id, confidence, created_at)
				VALUES (gen_random_text(), $1, $2, 'auto', now())
				ON CONFLICT (retailer_item_id) DO NOTHING
			`, *productID, item.ID)
			if err != nil {
				return fmt.Errorf("create product link: %w", err)
			}
			result.NewLinks++
		}

		return nil
	})
}

// checkSuspiciousBarcode checks if items with same barcode should be flagged for review
// Returns flag reason if suspicious, empty string if OK
func checkSuspiciousBarcode(items []RetailerItem) string {
	if len(items) < 2 {
		return ""
	}

	// Check name similarity
	names := make([]string, len(items))
	for i, item := range items {
		names[i] = strings.ToLower(RemoveDiacritics(item.Name))
	}

	for i := 1; i < len(names); i++ {
		sim := stringSimilarity(names[0], names[i])
		if sim < 0.3 {
			return "suspicious_barcode_name_mismatch"
		}
	}

	// Check brand conflicts (private labels)
	brands := make(map[string]bool)
	for _, item := range items {
		if item.Brand != "" && !isGenericBrand(item.Brand) {
			brands[strings.ToLower(RemoveDiacritics(item.Brand))] = true
		}
	}
	if len(brands) > 1 {
		return "suspicious_barcode_brand_conflict"
	}

	// Check unit/quantity mismatch (e.g., 500ml vs 1.5L)
	units := make(map[string]bool)
	for _, item := range items {
		normalized := NormalizeUnit(item.Unit, item.UnitQuantity)
		if normalized != "" {
			units[normalized] = true
		}
	}
	if len(units) > 1 {
		return "suspicious_barcode_unit_mismatch"
	}

	return ""
}

// pickBestItem selects the best item to use as canonical product data
// Prefers: items with images -> items from larger chains -> first item
func pickBestItem(items []RetailerItem) RetailerItem {
	var best RetailerItem
	bestScore := -1

	chainPreference := map[string]int{
		"konzum":    10,
		"konto":     9,
		"plodine":   8,
		"lidl":      7,
		"kaufland":  6,
		"spar":      5,
		"interspar": 5,
	}

	for _, item := range items {
		score := 0

		// Has image
		if item.ImageURL != "" {
			score += 100
		}

		// Chain preference
		if pref, ok := chainPreference[strings.ToLower(item.ChainSlug)]; ok {
			score += pref
		}

		// Has brand
		if item.Brand != "" && !isGenericBrand(item.Brand) {
			score += 5
		}

		// Has category
		if item.Category != "" {
			score += 3
		}

		if score > bestScore {
			bestScore = score
			best = item
		}
	}

	return best
}

// createProduct creates a new product from a retailer item
func createProduct(ctx context.Context, tx pgx.Tx, item RetailerItem) (string, error) {
	var productID string

	err := tx.QueryRow(ctx, `
		INSERT INTO products (id, name, brand, category, subcategory, unit, unit_quantity, image_url, created_at, updated_at)
		VALUES (gen_random_text(), $1, $2, $3, $4, $5, $6, $7, now(), now())
		RETURNING id
	`, item.Name, item.Brand, item.Category, nil, item.Unit, item.UnitQuantity, item.ImageURL).Scan(&productID)

	if err != nil {
		return "", fmt.Errorf("insert product: %w", err)
	}

	return productID, nil
}

// queueForReview adds an item to the product match queue for manual review
func queueForReview(ctx context.Context, db interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, retailerItemID string, flag string) error {
	_, err := db.Exec(ctx, `
		INSERT INTO product_match_queue (id, retailer_item_id, status, created_at)
		VALUES (gen_random_text(), $1, 'pending', now())
		ON CONFLICT (retailer_item_id) DO NOTHING
	`, retailerItemID)

	if err != nil {
		return fmt.Errorf("insert into queue: %w", err)
	}

	// Also create a candidate with the flag for context
	// (candidate_product_id is NULL since we don't have a specific candidate)
	_, err = db.Exec(ctx, `
		INSERT INTO product_match_candidates (id, retailer_item_id, match_type, flags, created_at)
		VALUES (gen_random_text(), $1, 'barcode', $2, now())
		ON CONFLICT (retailer_item_id, candidate_product_id) DO NOTHING
	`, retailerItemID, flag)

	return err
}

// stringSimilarity computes simple Jaccard similarity between two strings
func stringSimilarity(a, b string) float64 {
	if a == b {
		return 1.0
	}
	if a == "" || b == "" {
		return 0.0
	}

	setA := make(map[rune]bool)
	setB := make(map[rune]bool)

	for _, r := range a {
		setA[r] = true
	}
	for _, r := range b {
		setB[r] = true
	}

	intersection := 0
	for r := range setA {
		if setB[r] {
			intersection++
		}
	}

	union := len(setA) + len(setB) - intersection
	if union == 0 {
		return 0.0
	}

	return float64(intersection) / float64(union)
}
