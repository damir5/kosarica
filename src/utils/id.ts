/**
 * ID Generation Utilities
 *
 * Time-sortable, prefixed CUID-like IDs for database records.
 * Uses native crypto APIs for Cloudflare Workers compatibility.
 *
 * Example IDs:
 * - Time-sortable: `usr_0CL2KwaB3cD5eF7gH9iJ1k`
 * - Pure random: `usr_8kJ2mN4pQ6rS0tU3vW5xY7zA`
 */

/** Base62 alphabet: 0-9, A-Z, a-z (62 characters) */
const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Encode a Unix timestamp (seconds) as a 6-character base62 string.
 * Produces lexicographically sortable output for timestamps.
 *
 * Range: 0 to ~56 billion seconds (~1800 years from Unix epoch)
 */
export function encodeTimestampBase62(timestampSeconds: number): string {
  let n = Math.floor(timestampSeconds)
  let result = ''
  for (let i = 0; i < 6; i++) {
    result = BASE62_ALPHABET[n % 62] + result
    n = Math.floor(n / 62)
  }
  return result
}

/**
 * Generate a CUID-like ID using native crypto APIs with base62 encoding.
 * Compatible with Cloudflare Workers without global scope initialization.
 *
 * Uses bit extraction with rejection sampling for uniform distribution:
 * - Extracts 6 bits at a time (values 0-63)
 * - Rejects values >= 62 to maintain uniform distribution
 * - ~5.95 bits of entropy per character (log2(62))
 */
export function generateCuidLikeId(length = 24): string {
  // Request extra bytes to account for rejection sampling (~3% rejection rate)
  const bytesNeeded = Math.ceil((length * 6) / 8) + 4
  const bytes = new Uint8Array(bytesNeeded)
  crypto.getRandomValues(bytes)

  let result = ''
  let bitBuffer = 0
  let bitsInBuffer = 0
  let byteIndex = 0

  while (result.length < length) {
    // Refill buffer if needed
    while (bitsInBuffer < 6 && byteIndex < bytes.length) {
      bitBuffer = (bitBuffer << 8) | bytes[byteIndex++]
      bitsInBuffer += 8
    }

    // Extract 6 bits
    const value = (bitBuffer >> (bitsInBuffer - 6)) & 0x3f
    bitsInBuffer -= 6

    // Rejection sampling: only accept values < 62 for uniform distribution
    if (value < 62) {
      result += BASE62_ALPHABET[value]
    }

    // If we run out of bytes (unlikely), get more
    if (byteIndex >= bytes.length && result.length < length) {
      crypto.getRandomValues(bytes)
      byteIndex = 0
      bitBuffer = 0
      bitsInBuffer = 0
    }
  }

  return result
}

/**
 * Options for generating prefixed IDs.
 */
export interface PrefixedIdOptions {
  /**
   * Include time-sortable prefix for B-tree index locality (default: true).
   * When true, adds a 6-char base62 timestamp prefix.
   */
  timeSortable?: boolean
  /**
   * Length of random portion (default: 18 if timeSortable, 24 otherwise).
   */
  randomLength?: number
}

/**
 * Generate a prefixed ID using CUID-like random strings.
 * By default, includes a time-sortable prefix for B-tree index locality.
 *
 * @param prefix - The prefix to prepend (e.g., 'usr', 'ses', 'acc')
 * @param options - Configuration options
 * @returns A prefixed ID like `usr_0CL2KwaB3cD5eF7gH9iJ1k`
 *
 * @example
 * generatePrefixedId("usr")                           // "usr_0CL2KwaB3cD5eF7gH9iJ1k" (time-sortable)
 * generatePrefixedId("usr", { timeSortable: false })  // "usr_8kJ2mN4pQ6rS0tU3vW5xY7zA" (pure random)
 */
export function generatePrefixedId(
  prefix: string,
  options: PrefixedIdOptions = {},
): string {
  const { timeSortable = true, randomLength } = options

  if (timeSortable) {
    const timestamp = encodeTimestampBase62(Math.floor(Date.now() / 1000))
    const randLen = randomLength ?? 18
    return `${prefix}_${timestamp}${generateCuidLikeId(randLen)}`
  }

  return `${prefix}_${generateCuidLikeId(randomLength ?? 24)}`
}
