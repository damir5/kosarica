-- Make price_status strongly typed as enum.
ALTER TABLE prices
    MODIFY COLUMN price_status Enum8('available' = 1, 'unavailable' = 2) DEFAULT 'available';
