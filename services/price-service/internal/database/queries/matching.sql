-- name: CountProductMatchQueueByStatus :one
SELECT COUNT(*) FROM product_match_queue WHERE status = $1;

-- name: CountProductMatchCandidates :one
SELECT COUNT(*) FROM product_match_candidates;

-- name: CountProductLinks :one
SELECT COUNT(*) FROM product_links;

-- name: GetMatchingStatus :one
SELECT
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'pending') as pending_count,
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'approved') as approved_count,
    (SELECT COUNT(*) FROM product_match_queue WHERE status = 'rejected') as rejected_count,
    (SELECT COUNT(*) FROM product_match_candidates) as candidate_count,
    (SELECT COUNT(*) FROM product_links) as total_links;
