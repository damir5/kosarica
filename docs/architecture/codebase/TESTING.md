# Testing

## Framework
- **Vitest 3** - Test runner
- **Testing Library** - React component testing (`@testing-library/react`, `@testing-library/dom`)
- **jsdom** - DOM environment for tests

## Configuration
File: `vitest.config.ts`
```typescript
{
  test: {
    globals: true,        // Global expect, describe, it
    environment: 'node',  // Default environment
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  }
}
```

## Running Tests
```bash
pnpm test         # Run all tests
pnpm test --watch # Watch mode (not configured but Vitest supports it)
```

## Test File Location
Tests are co-located with source files:
- `src/ingestion/chains/chains.test.ts`
- `src/ingestion/core/persist.test.ts`
- `src/ingestion/core/store-resolution.test.ts`
- `src/ingestion/__tests__/worker-zip-fanout.test.ts`

## Test Coverage Areas

### Chain Adapters (`chains.test.ts`)
- CSV/XML/XLSX parsing for each chain
- Column mapping validation
- Store identifier extraction
- Row validation rules
- Encoding handling (UTF-8, Windows-1250)

### Persistence (`persist.test.ts`)
- Store resolution from identifiers
- Price deduplication logic
- Item upsert operations
- Error handling

### Store Resolution (`store-resolution.test.ts`)
- Filename code matching
- Portal ID matching
- National store resolution

### Worker Tests (`worker-zip-fanout.test.ts`)
- ZIP file expansion
- Queue message handling
- Fan-out logic

## Mocking
- Uses Vitest's built-in mocking
- Database mocked with sql.js for SQLite compatibility
- No external service calls in tests

## Test Patterns
```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('ChainAdapter', () => {
  beforeEach(() => {
    // Setup
  })

  it('should parse CSV with correct encoding', async () => {
    // Arrange
    const adapter = new KonzumAdapter()
    const content = new TextEncoder().encode('...')

    // Act
    const result = await adapter.parse(content.buffer, 'test.csv')

    // Assert
    expect(result.rows).toHaveLength(10)
    expect(result.errors).toHaveLength(0)
  })
})
```

## Database Testing
For D1/SQLite testing:
- Uses `sql.js` (in-memory SQLite)
- Better-sqlite3 for local development
- Test fixtures with known data

## Future Improvements
- Component tests with Testing Library
- E2E tests (not yet configured)
- Coverage reporting
