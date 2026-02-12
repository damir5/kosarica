/**
 * Escape LIKE pattern metacharacters (% and _) in user input.
 * Use before interpolating user search terms into SQL LIKE patterns.
 */
export function escapeLikePattern(input: string): string {
	return input.replace(/%/g, "\\%").replace(/_/g, "\\_");
}
