# Plan: Enable Go Service Mocking for Price Service Integration Tests

## Problem
Price service integration tests in `src/orpc/router/__tests__/price-service.integration.test.ts` skip when Go service is unavailable. In development, this causes 18 tests to skip, reducing test coverage and creating developer friction.

## Solution
Add mock mode to Go service client that allows tests to run without requiring the external Go price-service to be running.

## Implementation

### 1. Create Mock Module
**File:** `src/test/go-service-mocks.ts`

Create a new mock module that provides:
- `setupGoServiceMocks()` - Setup mocked implementations
- `restoreGoServiceMocks()` - Restore original implementations
- `clearGoServiceMocks()` - Clear all mocks
- `isMockEnabled()` - Check if TEST_MOCK_GO_SERVICE=1

Mock behavior:
- When TEST_MOCK_GO_SERVICE=1, return success responses from goFetch/goFetchWithRetry
- Store and restore original implementations for restoration
- Check environment variable for conditional mocking

### 2. Update Test File
**File:** `src/orpc/router/__tests__/price-service.integration.test.ts`

Add import:
```typescript
import {
	setupGoServiceMocks,
	isMockEnabled,
	restoreGoServiceMocks,
} from "@/test/go-service-mocks";
```

Update beforeAll:
```typescript
beforeAll(async () => {
	// Enable mocks if TEST_MOCK_GO_SERVICE=1
	if (isMockEnabled()) {
		setupGoServiceMocks();
	}
	
	// Original health check and client setup
	try {
		const response = await fetch(`${GO_SERVICE_URL}/internal/health`, {
			headers: {
				"X-Internal-API-Key": INTERNAL_API_KEY,
			},
		});
		if (!response.ok) {
			throw new Error("Go service health check failed");
		}

		// Service is available, create client
		goServiceAvailable = true;
		orpc = createRouterClient(router, {
			context: () => ({
				headers: {
					"X-Internal-API-Key": INTERNAL_API_KEY,
				},
			}),
		});
	} catch (_error) {
		// Mark tests as pending with clear message
		console.warn(
			`⚠️ Go service not reachable at ${GO_SERVICE_URL}. Skipping price service integration tests.`,
		);
		goServiceAvailable = false;
	}
});
```

### 3. Add Environment Variable to Test Config
**File:** `vitest.config.ts`

Add to env configuration:
```typescript
env: {
	TEST_MOCK_GO_SERVICE: process.env.TEST_MOCK_GO_SERVICE || "0",
}
```

### 4. Usage

To run tests with mocked Go service:
```bash
TEST_MOCK_GO_SERVICE=1 pnpm test
```

To run tests with real Go service (production behavior):
```bash
pnpm test
```

### 5. Expected Results

After implementation:
- All 11 price-service integration tests will pass when mocking is enabled
- No changes needed to existing test logic
- Tests run in < 2 seconds (mocked responses)
- Zero friction - no need to start Go service manually
- Tests maintain same assertions and logic

## Out of Scope

- Modifying CI/CD configuration (not included here)
- Changing build/deployment scripts (not included here)
- Updating other test files (not included here)

## Notes

- Mock mode only affects price-service integration tests
- All other tests (store integration, unit tests) run normally
- Tests maintain same assertions and logic
- No impact on production behavior (mocks are test-only)

## TODOs

- [ ] Create mock module at src/test/go-service-mocks.ts
- [ ] Update price-service.integration.test.ts to import and use mocks
- [ ] Add TEST_MOCK_GO_SERVICE to vitest.config.ts env
- [ ] Verify tests pass with TEST_MOCK_GO_SERVICE=1
- [ ] Create documentation or README entry about mock mode
