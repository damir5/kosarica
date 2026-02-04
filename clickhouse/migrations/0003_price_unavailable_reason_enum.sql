-- Make price_unavailable_reason strongly typed as enum.
ALTER TABLE prices
    MODIFY COLUMN price_unavailable_reason Nullable(
        Enum8('missing' = 1, 'invalid' = 2, 'non_positive' = 3)
    );
