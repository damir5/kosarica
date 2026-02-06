# Technical Concerns

## Technical Debt

### Debug Code in Production
- `src/ingestion/cli/run.ts:206` - Debug console.log present
- Consider structured logging with log levels

### Error Handling Patterns
- Mix of `throw new Error` and `console.error` across ingestion pipeline
- No centralized error aggregation or alerting
- DLQ exists but error recovery workflow not documented

### Test Coverage Gaps
- No component tests for React components (`src/components/`)
- No E2E tests configured
- No coverage reporting enabled
- Auth flows (`LoginForm.tsx`, `SetupWizard.tsx`) untested

## Known Issues

### Store Resolution
- Store identifiers must be pre-populated in database
- New stores from price files may fail to match
- Manual store mapping may be required for some chains

### Encoding Handling
- Windows-1250 encoded files (Plodine, KTC, Trgocentar) require special handling
- `iconv-lite` dependency for conversion
- Potential data corruption if encoding detection fails

### Rate Limiting
- Per-chain rate limiting configured but not monitored
- No backoff strategy for 429 responses documented
- Retry logic in `rate-limit.ts` but limits not tuned

## Security Considerations

### Authentication
- `BETTER_AUTH_SECRET` must be 32+ characters
- Passkey RP ID must match production domain
- No MFA beyond passkey support

### Environment Variables
- Secrets should use `wrangler secret put`, not `.dev.vars` in production
- No validation that required secrets are present at startup

### Input Validation
- Chain adapters validate parsed data but raw HTTP responses not sanitized
- HTML parsing for file discovery vulnerable to malformed HTML

### API Security
- oRPC endpoints need auth middleware for protected routes
- No rate limiting on API endpoints currently

## Performance Concerns

### Database
- D1 has row/query limits that may impact large ingestion runs
- No connection pooling (D1 handles this)
- Indexes defined but query performance not profiled

### Queue Processing
- Batch size of 10 may need tuning based on processing time
- No visibility into queue depth or processing latency

### R2 Storage
- No cleanup of old ingestion files configured
- Storage costs may grow unbounded

## Architectural Concerns

### Coupling
- Better Auth tables tightly coupled with application schema
- Chain adapter registry initialized on module load (cold start cost)

### Scalability
- Single worker handles both SSR and ingestion
- No separation of concerns for heavy ingestion workloads

### Observability
- Console logging only, no structured logs
- No metrics collection
- No distributed tracing

## Dependencies

### Version Pinning
- Major versions unpinned (e.g., `^19.2.0` for React)
- Lock file present but CI should verify

### Deprecated/Beta
- TanStack Start still evolving (breaking changes possible)
- Cloudflare Vite plugin relatively new

### Large Dependencies
- `xlsx` is 2MB+ (consider xlsx-populate or streaming)
- Bundle size not monitored

## Future Improvements

### Recommended
1. Add structured logging (pino or similar)
2. Configure coverage reporting in Vitest
3. Add component tests for auth flows
4. Implement R2 lifecycle policies for cleanup
5. Add health check endpoint
6. Document error recovery from DLQ

### Nice to Have
1. E2E tests with Playwright
2. OpenTelemetry integration
3. Split worker for SSR vs ingestion
4. Admin dashboard for ingestion monitoring
5. Automated store mapping suggestions
