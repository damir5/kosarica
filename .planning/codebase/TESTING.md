# Testing Patterns

**Analysis Date:** 2026-01-14

## Test Framework

**Runner:**
- Vitest 4.0.16
- Config: `vitest.config.ts` in project root

**Assertion Library:**
- Vitest built-in expect
- Matchers: toBe, toEqual, toThrow, toMatch, toMatchObject

**Run Commands:**
```bash
pnpm test                              # Run all tests
pnpm test -- --watch                   # Watch mode
pnpm test -- path/to/file.test.ts     # Single file
```

## Test File Organization

**Location:**
- Co-located with source using `.test.ts` suffix
- Alternative: `__tests__/` directory for complex test suites

**Naming:**
- `{module}.test.ts` - Standard test file
- `{feature}.test.ts` - Feature-level tests

**Structure:**
```
src/
  ingestion/
    core/
      persist.ts
      persist.test.ts
      store-resolution.test.ts
    chains/
      chains.test.ts
    __tests__/
      worker-zip-fanout.test.ts
  db/
    queries/
      stores.ts
      stores.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
/**
 * Tests for Price Signature Deduplication
 *
 * Verifies that:
 * 1. Running same data twice doesn't create duplicates
 * 2. Price changes are detected and create new periods
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('ModuleName', () => {
  describe('functionName', () => {
    beforeEach(() => {
      // reset state
    })

    it('should handle valid input', () => {
      // arrange
      const input = createTestInput()

      // act
      const result = functionName(input)

      // assert
      expect(result).toEqual(expectedOutput)
    })

    it('should throw on invalid input', () => {
      expect(() => functionName(null)).toThrow('error message')
    })
  })
})
```

**Patterns:**
- Globals enabled: `describe`, `it`, `expect`, `beforeEach`, `vi` available without import
- `beforeEach` for per-test setup
- Section markers for logical groupings
- Arrange/act/assert pattern

## Mocking

**Framework:**
- Vitest built-in mocking (`vi`)

**Patterns:**
```typescript
import { vi } from 'vitest'

// Mock function
const mockFn = vi.fn()
mockFn.mockReturnValue('result')
mockFn.mockResolvedValue('async result')

// Verify calls
expect(mockFn).toHaveBeenCalledWith('expected arg')

// Mock database
function createMockDb() {
  return {
    query: {
      stores: {
        findFirst: vi.fn(),
      },
    },
  }
}
```

**What to Mock:**
- External APIs (geocoding, chain portals)
- Database operations in unit tests
- Cloudflare bindings (R2, Queues, D1)
- Time/dates when testing time-dependent logic

**What NOT to Mock:**
- Pure functions and utilities
- Internal business logic being tested
- Type definitions

## Fixtures and Factories

**Test Data:**
```typescript
// Factory functions
function createTestStore(overrides?: Partial<Store>): Store {
  return {
    id: 'store_test123',
    name: 'Test Store',
    chainId: 'chain_test',
    status: 'approved',
    ...overrides
  }
}

function createTestRow(overrides?: Partial<NormalizedRow>): NormalizedRow {
  return {
    itemName: 'Test Item',
    price: 1.99,
    storeIdentifier: 'test_store_1',
    ...overrides
  }
}

// Constants
const TEST_RUN_ID = 'run_test123'
const TEST_CHAIN_SLUG = 'lidl'
```

**Location:**
- Factory functions at top of test file
- Shared fixtures in test file (not separate fixtures/ directory)

## Coverage

**Requirements:**
- No enforced coverage target
- Focus on critical paths (persistence, parsing, deduplication)

**View Coverage:**
```bash
pnpm test -- --coverage
```

## Test Types

**Unit Tests:**
- Test single function in isolation
- Mock all external dependencies
- Fast: <100ms per test
- Examples: `persist.test.ts` (1093 lines, 69 test cases)

**Integration Tests:**
- Test multiple modules together
- Mock only external boundaries
- Examples: `stores.test.ts` (database query helpers)

**Worker Tests:**
- Test Cloudflare Queue processing
- Mock queue, storage, database
- Examples: `worker-zip-fanout.test.ts` (968 lines)

**E2E Tests:**
- Playwright available but not extensively used
- Browser automation for critical flows

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction()
  expect(result).toBe('expected')
})
```

**Error Testing:**
```typescript
it('should throw on invalid input', () => {
  expect(() => parse(null)).toThrow('Cannot parse null')
})

// Async error
it('should reject on failure', async () => {
  await expect(asyncCall()).rejects.toThrow('error message')
})
```

**Signature Testing:**
```typescript
it('should produce consistent signatures', () => {
  const sig1 = computeSignature(data)
  const sig2 = computeSignature(data)
  expect(sig1).toBe(sig2)
  expect(sig1).toMatch(/^[a-f0-9]{64}$/)
})
```

**Cloudflare Workers Testing:**
```typescript
// vitest.config.ts
poolOptions: {
  workers: {
    wrangler: { configPath: './wrangler.test.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
  },
}
```

**Snapshot Testing:**
- Not currently used in this codebase
- Prefer explicit assertions

## Test Setup

**Global Setup:**
- `src/test/setup.ts` - Database migrations, environment setup
- `src/test/env.d.ts` - Type declarations for test environment

**Per-Test Setup:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  mockDb = createMockDb()
})
```

---

*Testing analysis: 2026-01-14*
*Update when test patterns change*
