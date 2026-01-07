/**
 * Tests for Price Signature Deduplication in Persist Module
 *
 * Verifies that:
 * 1. Running same data twice doesn't create duplicate price_periods
 * 2. Price changes are detected and create new periods
 * 3. Discount changes trigger new periods
 * 4. Signature computation is stable and deterministic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computePriceSignature } from './persist'
import type { NormalizedRow, StoreDescriptor } from './types'

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_CHAIN_SLUG = 'test-chain'
const TEST_STORE_ID = 'sto_test123'

function createTestStore(): StoreDescriptor {
  return {
    id: TEST_STORE_ID,
    chainSlug: TEST_CHAIN_SLUG,
    name: 'Test Store',
    address: '123 Test St',
    city: 'Test City',
    postalCode: '10000',
    latitude: '45.0',
    longitude: '15.0',
  }
}

function createTestRow(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    storeIdentifier: 'TEST001',
    externalId: 'EXT123',
    name: 'Test Product',
    description: 'A test product description',
    category: 'Test Category',
    subcategory: null,
    brand: 'Test Brand',
    unit: 'kg',
    unitQuantity: '1',
    price: 1999, // 19.99 in cents
    discountPrice: null,
    discountStart: null,
    discountEnd: null,
    barcodes: ['3850123456789'],
    imageUrl: null,
    rowNumber: 1,
    rawData: '{}',
    // Croatian price transparency fields
    unitPrice: null,
    unitPriceBaseQuantity: null,
    unitPriceBaseUnit: null,
    lowestPrice30d: null,
    anchorPrice: null,
    anchorPriceAsOf: null,
    ...overrides,
  }
}

// ============================================================================
// Signature Stability Tests
// ============================================================================

describe('computePriceSignature', () => {
  it('produces same signature for identical fields', async () => {
    const fields1 = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const fields2 = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(fields1)
    const sig2 = await computePriceSignature(fields2)

    expect(sig1).toBe(sig2)
  })

  it('produces different signature for different prices', async () => {
    const fields1 = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const fields2 = {
      price: 2999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(fields1)
    const sig2 = await computePriceSignature(fields2)

    expect(sig1).not.toBe(sig2)
  })

  it('produces different signature when discount is added', async () => {
    const withoutDiscount = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const withDiscount = {
      price: 1999,
      discountPrice: 1499,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(withoutDiscount)
    const sig2 = await computePriceSignature(withDiscount)

    expect(sig1).not.toBe(sig2)
  })

  it('produces different signature for different discount values', async () => {
    const discount1 = {
      price: 1999,
      discountPrice: 1499,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const discount2 = {
      price: 1999,
      discountPrice: 1299,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(discount1)
    const sig2 = await computePriceSignature(discount2)

    expect(sig1).not.toBe(sig2)
  })

  it('produces different signature for different discount dates', async () => {
    const date1 = new Date('2024-01-01T00:00:00Z')
    const date2 = new Date('2024-01-15T00:00:00Z')

    const fields1 = {
      price: 1999,
      discountPrice: 1499,
      discountStart: date1,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const fields2 = {
      price: 1999,
      discountPrice: 1499,
      discountStart: date2,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(fields1)
    const sig2 = await computePriceSignature(fields2)

    expect(sig1).not.toBe(sig2)
  })

  it('produces same signature regardless of field order', async () => {
    // The implementation uses a specific order in JSON.stringify
    // but we should test that the same logical data produces same hash
    const fields1 = {
      price: 1999,
      discountPrice: 1499,
      discountStart: new Date('2024-01-01'),
      discountEnd: new Date('2024-01-31'),
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const fields2 = {
      discountEnd: new Date('2024-01-31'),
      discountStart: new Date('2024-01-01'),
      discountPrice: 1499,
      price: 1999,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const sig1 = await computePriceSignature(fields1)
    const sig2 = await computePriceSignature(fields2)

    expect(sig1).toBe(sig2)
  })

  it('produces valid SHA256 hex string', async () => {
    const fields = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const signature = await computePriceSignature(fields)

    // SHA256 produces 64 hex characters
    expect(signature).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles zero price', async () => {
    const fields = {
      price: 0,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const signature = await computePriceSignature(fields)
    expect(signature).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles very large prices', async () => {
    const fields = {
      price: 999999999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
      unitPrice: null,
      unitPriceBaseQuantity: null,
      unitPriceBaseUnit: null,
      lowestPrice30d: null,
      anchorPrice: null,
      anchorPriceAsOf: null,
    }

    const signature = await computePriceSignature(fields)
    expect(signature).toMatch(/^[a-f0-9]{64}$/)
  })

  it('discount equal to price produces unique signature', async () => {
    const withoutDiscount = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
    }

    const discountEqualsPrice = {
      price: 1999,
      discountPrice: 1999,
      discountStart: null,
      discountEnd: null,
    }

    const sig1 = await computePriceSignature(withoutDiscount)
    const sig2 = await computePriceSignature(discountEqualsPrice)

    expect(sig1).not.toBe(sig2)
  })
})

// ============================================================================
// Signature-Based Deduplication Logic Tests
// These tests verify the deduplication rules through signature comparison
// ============================================================================

describe('price signature deduplication rules', () => {
  describe('running same data twice', () => {
    it('same price data produces same signature - no duplicate period should be created', async () => {
      const row1 = createTestRow({ price: 1999 })
      const row2 = createTestRow({ price: 1999 })

      const sig1 = await computePriceSignature({
        price: row1.price,
        discountPrice: row1.discountPrice,
        discountStart: row1.discountStart,
        discountEnd: row1.discountEnd,
      })

      const sig2 = await computePriceSignature({
        price: row2.price,
        discountPrice: row2.discountPrice,
        discountStart: row2.discountStart,
        discountEnd: row2.discountEnd,
      })

      // When signatures match, persistPrice should NOT create a new period
      expect(sig1).toBe(sig2)
    })

    it('same data including discount produces same signature', async () => {
      const row1 = createTestRow({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-01'),
        discountEnd: new Date('2024-01-31'),
      })

      const row2 = createTestRow({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-01'),
        discountEnd: new Date('2024-01-31'),
      })

      const sig1 = await computePriceSignature({
        price: row1.price,
        discountPrice: row1.discountPrice,
        discountStart: row1.discountStart,
        discountEnd: row1.discountEnd,
      })

      const sig2 = await computePriceSignature({
        price: row2.price,
        discountPrice: row2.discountPrice,
        discountStart: row2.discountStart,
        discountEnd: row2.discountEnd,
      })

      expect(sig1).toBe(sig2)
    })
  })

  describe('price change detection', () => {
    it('different price produces different signature - new period should be created', async () => {
      const row1 = createTestRow({ price: 1999 })
      const row2 = createTestRow({ price: 2499 })

      const sig1 = await computePriceSignature({
        price: row1.price,
        discountPrice: row1.discountPrice,
        discountStart: row1.discountStart,
        discountEnd: row1.discountEnd,
      })

      const sig2 = await computePriceSignature({
        price: row2.price,
        discountPrice: row2.discountPrice,
        discountStart: row2.discountStart,
        discountEnd: row2.discountEnd,
      })

      // When signatures differ, persistPrice should create a new period
      expect(sig1).not.toBe(sig2)
    })

    it('price returning to previous value produces same signature as before', async () => {
      // Simulating: 1999 -> 2499 -> 1999
      const price1999sig = await computePriceSignature({
        price: 1999,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })

      const price2499sig = await computePriceSignature({
        price: 2499,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })

      const price1999sigAgain = await computePriceSignature({
        price: 1999,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })

      // First and third should match
      expect(price1999sig).toBe(price1999sigAgain)
      // But middle should be different
      expect(price1999sig).not.toBe(price2499sig)
    })
  })

  describe('discount changes', () => {
    it('adding discount produces different signature', async () => {
      const noDiscount = await computePriceSignature({
        price: 1999,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })

      const withDiscount = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: null,
        discountEnd: null,
      })

      expect(noDiscount).not.toBe(withDiscount)
    })

    it('removing discount produces different signature', async () => {
      const withDiscount = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: null,
        discountEnd: null,
      })

      const noDiscount = await computePriceSignature({
        price: 1999,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })

      expect(withDiscount).not.toBe(noDiscount)
    })

    it('changing discount value produces different signature', async () => {
      const discount1499 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: null,
        discountEnd: null,
      })

      const discount1299 = await computePriceSignature({
        price: 1999,
        discountPrice: 1299,
        discountStart: null,
        discountEnd: null,
      })

      expect(discount1499).not.toBe(discount1299)
    })

    it('changing discountStart produces different signature', async () => {
      const start1 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-01'),
        discountEnd: null,
      })

      const start2 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-15'),
        discountEnd: null,
      })

      expect(start1).not.toBe(start2)
    })

    it('changing discountEnd produces different signature', async () => {
      const end1 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: null,
        discountEnd: new Date('2024-01-31'),
      })

      const end2 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: null,
        discountEnd: new Date('2024-02-15'),
      })

      expect(end1).not.toBe(end2)
    })

    it('same discount dates produce same signature', async () => {
      const sig1 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-01'),
        discountEnd: new Date('2024-01-31'),
      })

      const sig2 = await computePriceSignature({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-01'),
        discountEnd: new Date('2024-01-31'),
      })

      expect(sig1).toBe(sig2)
    })
  })
})

// ============================================================================
// Signature Determinism Tests
// ============================================================================

describe('computePriceSignature determinism', () => {
  it('is deterministic across multiple calls', async () => {
    const fields = {
      price: 1999,
      discountPrice: 1499,
      discountStart: new Date('2024-01-01'),
      discountEnd: new Date('2024-01-31'),
    }

    const signatures: string[] = []
    for (let i = 0; i < 10; i++) {
      signatures.push(await computePriceSignature(fields))
    }

    // All signatures should be identical
    const firstSig = signatures[0]
    expect(signatures.every((s) => s === firstSig)).toBe(true)
  })

  it('handles millisecond-level date precision correctly', async () => {
    // Dates with same millisecond value should produce same signature
    const date1 = new Date('2024-01-01T12:00:00.123Z')
    const date2 = new Date(date1.getTime())

    const sig1 = await computePriceSignature({
      price: 1999,
      discountPrice: null,
      discountStart: date1,
      discountEnd: null,
    })

    const sig2 = await computePriceSignature({
      price: 1999,
      discountPrice: null,
      discountStart: date2,
      discountEnd: null,
    })

    expect(sig1).toBe(sig2)
  })

  it('dates differing by 1ms produce different signatures', async () => {
    const date1 = new Date('2024-01-01T12:00:00.000Z')
    const date2 = new Date(date1.getTime() + 1)

    const sig1 = await computePriceSignature({
      price: 1999,
      discountPrice: null,
      discountStart: date1,
      discountEnd: null,
    })

    const sig2 = await computePriceSignature({
      price: 1999,
      discountPrice: null,
      discountStart: date2,
      discountEnd: null,
    })

    expect(sig1).not.toBe(sig2)
  })
})

// ============================================================================
// Complex Scenario Tests
// ============================================================================

describe('complex deduplication scenarios', () => {
  it('simulates weekly price updates with no changes', async () => {
    // Simulate 4 weeks of the same price data
    const baseFields = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
    }

    const week1Sig = await computePriceSignature(baseFields)
    const week2Sig = await computePriceSignature(baseFields)
    const week3Sig = await computePriceSignature(baseFields)
    const week4Sig = await computePriceSignature(baseFields)

    // All weeks should have same signature - only 1 price period needed
    expect(week1Sig).toBe(week2Sig)
    expect(week2Sig).toBe(week3Sig)
    expect(week3Sig).toBe(week4Sig)
  })

  it('simulates promotional cycle: regular -> discount -> regular', async () => {
    const regularPrice = {
      price: 1999,
      discountPrice: null,
      discountStart: null,
      discountEnd: null,
    }

    const discountPrice = {
      price: 1999,
      discountPrice: 1499,
      discountStart: new Date('2024-01-15'),
      discountEnd: new Date('2024-01-31'),
    }

    const sigBefore = await computePriceSignature(regularPrice)
    const sigDuring = await computePriceSignature(discountPrice)
    const sigAfter = await computePriceSignature(regularPrice)

    // Before and after should be same (both regular price)
    expect(sigBefore).toBe(sigAfter)
    // During should be different (discount active)
    expect(sigBefore).not.toBe(sigDuring)
    // This means 3 price periods: regular -> discount -> regular
  })

  it('simulates price war scenario with rapid changes', async () => {
    const prices = [1999, 1899, 1799, 1799, 1699, 1799, 1899]
    const signatures: string[] = []

    for (const price of prices) {
      const sig = await computePriceSignature({
        price,
        discountPrice: null,
        discountStart: null,
        discountEnd: null,
      })
      signatures.push(sig)
    }

    // Check uniqueness of transitions
    // 1999 -> 1899 (different)
    expect(signatures[0]).not.toBe(signatures[1])
    // 1899 -> 1799 (different)
    expect(signatures[1]).not.toBe(signatures[2])
    // 1799 -> 1799 (same)
    expect(signatures[2]).toBe(signatures[3])
    // 1799 -> 1699 (different)
    expect(signatures[3]).not.toBe(signatures[4])
    // 1699 -> 1799 (different)
    expect(signatures[4]).not.toBe(signatures[5])
    // 1799 -> 1899 (different)
    expect(signatures[5]).not.toBe(signatures[6])

    // With deduplication, we should have 6 periods instead of 7
    // because 1799 appears twice consecutively
    const uniqueTransitions = new Set()
    let lastSig = signatures[0]
    uniqueTransitions.add(lastSig)
    for (let i = 1; i < signatures.length; i++) {
      if (signatures[i] !== lastSig) {
        uniqueTransitions.add(signatures[i])
        lastSig = signatures[i]
      }
    }

    // Count actual periods needed (transitions + 1 for initial)
    expect(signatures.filter((s, i) => i === 0 || s !== signatures[i - 1]).length).toBe(6)
  })

  it('simulates discount with changing end dates (extension)', async () => {
    const discount1 = {
      price: 1999,
      discountPrice: 1499,
      discountStart: new Date('2024-01-01'),
      discountEnd: new Date('2024-01-31'),
    }

    const discountExtended = {
      price: 1999,
      discountPrice: 1499,
      discountStart: new Date('2024-01-01'),
      discountEnd: new Date('2024-02-15'),
    }

    const sig1 = await computePriceSignature(discount1)
    const sig2 = await computePriceSignature(discountExtended)

    // Extended discount should have different signature
    expect(sig1).not.toBe(sig2)
  })
})

// ============================================================================
// Integration Scenario Tests (using signature logic)
// ============================================================================

describe('integration scenarios - deduplication verification', () => {
  /**
   * Helper to simulate the deduplication logic that persistPrice uses
   */
  async function simulatePersist(
    existingSignature: string | null,
    row: NormalizedRow,
  ): Promise<{ priceChanged: boolean; newSignature: string }> {
    const newSignature = await computePriceSignature({
      price: row.price,
      discountPrice: row.discountPrice,
      discountStart: row.discountStart,
      discountEnd: row.discountEnd,
    })

    // If no existing signature, this is first insert
    if (existingSignature === null) {
      return { priceChanged: true, newSignature }
    }

    // Compare signatures
    const priceChanged = existingSignature !== newSignature
    return { priceChanged, newSignature }
  }

  it('first insert always creates a new period', async () => {
    const row = createTestRow({ price: 1999 })
    const result = await simulatePersist(null, row)

    expect(result.priceChanged).toBe(true)
  })

  it('same data on second run does not create new period', async () => {
    const row = createTestRow({ price: 1999 })

    // First run
    const result1 = await simulatePersist(null, row)
    expect(result1.priceChanged).toBe(true)

    // Second run with same data
    const result2 = await simulatePersist(result1.newSignature, row)
    expect(result2.priceChanged).toBe(false)
  })

  it('price change creates new period', async () => {
    const row1 = createTestRow({ price: 1999 })
    const row2 = createTestRow({ price: 2499 })

    const result1 = await simulatePersist(null, row1)
    const result2 = await simulatePersist(result1.newSignature, row2)

    expect(result2.priceChanged).toBe(true)
  })

  it('multiple runs with mixed changes', async () => {
    const rows = [
      createTestRow({ price: 1000 }),
      createTestRow({ price: 1000 }), // Same - no new period
      createTestRow({ price: 1500 }), // Changed - new period
      createTestRow({ price: 1500 }), // Same - no new period
      createTestRow({ price: 2000 }), // Changed - new period
    ]

    let currentSignature: string | null = null
    let newPeriodsCount = 0

    for (const row of rows) {
      const result = await simulatePersist(currentSignature, row)
      if (result.priceChanged) {
        newPeriodsCount++
      }
      currentSignature = result.newSignature
    }

    // Should have 3 periods: 1000, 1500, 2000
    expect(newPeriodsCount).toBe(3)
  })

  it('discount cycle creates correct number of periods', async () => {
    const rows = [
      // Regular price
      createTestRow({ price: 1999, discountPrice: null }),
      // Same regular price
      createTestRow({ price: 1999, discountPrice: null }),
      // Discount starts
      createTestRow({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-15'),
        discountEnd: new Date('2024-01-31'),
      }),
      // Discount continues
      createTestRow({
        price: 1999,
        discountPrice: 1499,
        discountStart: new Date('2024-01-15'),
        discountEnd: new Date('2024-01-31'),
      }),
      // Discount ends, back to regular
      createTestRow({ price: 1999, discountPrice: null }),
    ]

    let currentSignature: string | null = null
    let newPeriodsCount = 0

    for (const row of rows) {
      const result = await simulatePersist(currentSignature, row)
      if (result.priceChanged) {
        newPeriodsCount++
      }
      currentSignature = result.newSignature
    }

    // Should have 3 periods: regular, discount, regular
    expect(newPeriodsCount).toBe(3)
  })
})
