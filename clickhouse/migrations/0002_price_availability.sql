-- Make current price nullable and add explicit availability fields.
ALTER TABLE prices
    MODIFY COLUMN price_cents Nullable(Int32);

ALTER TABLE prices
    ADD COLUMN IF NOT EXISTS price_status LowCardinality(String) DEFAULT 'available' AFTER price_cents;

ALTER TABLE prices
    ADD COLUMN IF NOT EXISTS price_unavailable_reason Nullable(String) AFTER price_status;

-- Backfill status for existing data.
ALTER TABLE prices
    UPDATE
        price_status = if(price_cents IS NULL OR price_cents <= 0, 'unavailable', 'available'),
        price_unavailable_reason = if(
            price_cents IS NULL,
            'missing',
            if(price_cents <= 0, 'non_positive', NULL)
        )
    WHERE 1;
