# Coding Conventions

**Analysis Date:** 2026-01-14

## Naming Patterns

**Files:**
- kebab-case for modules: `request-context.ts`, `rate-limit.ts`, `auth-client.ts`
- PascalCase for React components: `UserTable.tsx`, `LoginForm.tsx`, `AdminHeader.tsx`
- *.test.ts for tests alongside source: `persist.test.ts`, `stores.test.ts`
- index.ts for barrel exports

**Functions:**
- camelCase for all functions: `createTestStore()`, `getEffectivePriceStoreId()`
- `handle*` for event handlers: `handleSubmit`, `handleAuth`
- `create*` for factories: `createAuth()`, `createDb()`, `createCliDatabase()`
- `get*` for getters: `getAdapter()`, `getDb()`, `getServerConfig()`

**Variables:**
- camelCase for variables: `requestId`, `chainSlug`, `priceSource`
- UPPER_SNAKE_CASE for constants: `DEFAULT_BATCH_SIZE`, `MAX_BUSY_RETRIES`, `CHAIN_IDS`
- No underscore prefix for private (TypeScript visibility instead)

**Types:**
- PascalCase for interfaces: `NormalizedRow`, `StoreDescriptor`, `ChainAdapter`
- PascalCase for types: `UserRole`, `BaseAdapterConfig`
- No `I` prefix for interfaces: `User` not `IUser`
- Enums: PascalCase name, UPPER_CASE values (when used)

## Code Style

**Formatting:**
- Biome with `biome.json` configuration
- Indentation: Tabs (configured: `"indentStyle": "tab"`)
- Quotes: Double quotes (`"quoteStyle": "double"`)
- Semicolons: Required (default)
- Line length: No hard limit

**Linting:**
- Biome with recommended rules
- Available commands:
  - `pnpm lint` - Run linter
  - `pnpm format` - Format code
  - `pnpm check` - Full check

## Import Organization

**Order:**
1. External packages (`react`, `@tanstack/react-router`, `drizzle-orm`)
2. Internal modules (`@/lib`, `@/components`, `@/db`)
3. Relative imports (`./utils`, `../types`)
4. Type imports (`import type { ... }`)

**Grouping:**
- Blank line between groups
- Auto-organized by Biome (`"organizeImports": "on"`)

**Path Aliases:**
- `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- Use `@/` for all internal imports

## Error Handling

**Patterns:**
- Throw errors at source, catch at boundaries
- Retry logic for transient errors (SQLITE_BUSY)
- Structured error responses from ORPC handlers

**Error Types:**
- Extend Error class for custom errors
- Include context in error messages
- Log errors with request context

**Async:**
- Use async/await consistently
- try/catch in handlers and CLI commands
- Cleanup in finally blocks

## Logging

**Framework:**
- Custom logger: `src/utils/logger.ts`
- Contextual with request ID tracking
- Configurable via `LOG_LEVEL` env var

**Patterns:**
- Structured logging: `log.info('Message', { key: value })`
- Log at service boundaries
- Redact sensitive data in logs

**Levels:**
- error, warn, info, debug

## Comments

**When to Comment:**
- Explain why, not what
- Document business logic and algorithms
- Note workarounds with context

**JSDoc:**
- Required for public functions in ingestion core
- Format: `@param`, `@returns` tags
- File headers for complex modules

**Section Markers:**
```typescript
// ============================================================================
// Section Name
// ============================================================================
```

**TODO Comments:**
- Format: `// TODO: description`
- Include task ID if applicable: `// Task: main-4mn.33`

## Function Design

**Size:**
- Keep under 50 lines
- Extract helpers for complex logic

**Parameters:**
- Max 3-4 parameters
- Use options object for more: `function create(options: CreateOptions)`
- Destructure in parameter list

**Return Values:**
- Explicit return types where helpful
- Return early for guard clauses
- Consistent return shapes in handlers

## Module Design

**Exports:**
- Named exports preferred
- Default exports for React components and routers
- Barrel exports via `index.ts`

**Structure:**
- Types at top
- Constants
- Helper functions
- Main exports

**Dependencies:**
- Avoid circular imports
- Keep modules focused
- Use dependency injection for testability

## React Patterns

**Components:**
- Functional components only
- `forwardRef` for UI primitives
- Props interface above component

**Hooks:**
- Custom hooks in separate files
- Prefix with `use`

**State:**
- TanStack Query for server state
- useState for local UI state

## Database Patterns

**Schema:**
- Drizzle ORM with typed schema
- Prefixed IDs: `usr_*`, `store_*`, `run_*`
- Timestamps: `createdAt`, `updatedAt`

**Queries:**
- Use Drizzle query builder
- Batch operations for bulk inserts
- Respect D1's 100 parameter limit

---

*Convention analysis: 2026-01-14*
*Update when patterns change*
