# Mise Configuration Consolidation and Test-All Refactor

## Context

### Original Request
User wants to:
1. Merge `mise.toml` and `.mise.toml` into a single configuration file
2. Fix `test-all` task to coordinate starting both Node.js and Go services directly (not using docker-compose)
3. Run full test suite (unit + integration + e2e) after services are ready

### Interview Summary

**Key Discussions**:
- **Mise files found**: Three config files exist:
  - `/workspace/mise.toml` - Basic Node.js tasks (dev, build, test, lint, format, db:*)
  - `/.mise.toml` - Contains `test-all` task that runs unit tests only
  - `services/price-service/.mise.toml` - Go service specific tasks
- **User decision**: Keep `/.mise.toml` only, delete `/workspace/mise.toml`
- **Test composition**: Run Unit + Integration + E2E (full test suite)
- **Service startup**: Background processes with PID tracking (no docker-compose)
- **Database**: Use `DATABASE_URL` for tests and runtime (remove `TEST_DATABASE_URL`)
- **Ports**: Go service on 8081, Node.js on 3002 (from `.env.development`)

**Research Findings**:
- Current `test-all` runs: `pnpm test` then `cd services/price-service && mise run test` - does NOT start services, does NOT run integration/e2e tests
- Current integration test setup: `src/test/setup.ts` uses `docker compose up -d price-service` and `docker compose down price-service`
- Integration tests found: `src/orpc/router/__tests__/price-service.integration.test.ts`, `src/orpc/router/__tests__/stores-integration.test.ts`
- E2E tests found: `services/price-service/tests/e2e/pipeline_test.go`
  - Environment variables: `START_GO_SERVICE_FOR_TESTS`, `GO_SERVICE_URL`

### Metis Review
**Identified Gaps** (addressed in this plan):
- **Service orchestration**: Added startup order (Go first, then Node), health checks with 30s timeout
- **Health check criteria**: Defined - Go: `/health` endpoint, Node: HTTP on port 3002
- **Failure handling**: Abort on first failure with cleanup, graceful shutdown (SIGTERM + wait, then SIGKILL)
- **Port conflict detection**: Check ports availability before starting services, abort if occupied
- **Graceful shutdown**: Use trap handlers for cleanup on success, failure, or interruption
- **Process cleanup**: Ensure background processes die even on failure, verify no zombie processes

**Guardrails Applied** (from Metis review):
- ❌ MUST NOT modify actual test files - only infrastructure (mise config, setup.ts)
- ❌ MUST NOT change test behavior or test logic - only how tests are invoked
- ❌ MUST NOT modify service code (Node.js or Go) - only orchestration
- ❌ MUST NOT change environment variable naming or values
- ✅ MUST keep all existing mise tasks from both files (don't lose tasks)
- ✅ MUST preserve test behavior - same tests, same assertions, same expectations
- ✅ MUST clean up processes even on failure (no zombie processes)

---

## Work Objectives

### Core Objective
Consolidate mise configuration into single file and refactor test-all task to coordinate starting Node.js and Go services directly, then run full test suite.

### Concrete Deliverables
- Merged mise configuration in `/.mise.toml` containing all tasks from both files
- Updated `test-all` task that starts services, runs tests, and cleans up
- Updated `src/test/setup.ts` to remove docker-compose dependency
- Deleted `/workspace/mise.toml` (merged content preserved in `/.mise.toml`)

### Definition of Done
- [ ] `mise run test-all` starts Go service (port 8081) and Node.js (port 3002)
- [ ] Both services become healthy (health checks pass)
- [ ] Unit tests run and pass
- [ ] Integration tests run and pass
- [ ] E2E tests run and pass
- [ ] Both background services are killed (success or failure)
- [ ] No zombie processes remain
- [ ] `mise tasks list` shows all original tasks present

### Must Have
- Non-negotiable: All existing mise tasks preserved
- Non-negotiable: Test behavior unchanged (same tests, same expectations)
- Non-negotiable: Services coordinate directly (no docker-compose)
- Non-negotiable: Background processes cleaned up in all exit paths

### Must NOT Have (Guardrails)
- Must NOT modify test logic or test files (only orchestration)
- Must NOT modify service code (Node.js or Go)
- Must NOT change environment variable names or values
- Must NOT change ports (8081 for Go, 3002 for Node)
- Must NOT lose any existing mise tasks during merge

---

## Verification Strategy (MANDATORY)

> This section determines how the executor will verify work is complete.
> Since this is infrastructure refactoring, manual verification is appropriate.

### Test Decision
- **Infrastructure exists**: YES (mise tasks, test commands)
- **User wants tests**: MANUAL verification only
- **Framework**: None (infrastructure task)

### Manual QA Procedures (ALL TODOs)

Each TODO includes detailed verification procedures:

**For Mise Configuration Changes**:
- [ ] Verify merged config with `mise tasks list` → shows all tasks from both files
- [ ] Verify config syntax with `mise doctor` → no errors
- [ ] Verify deletion with `ls /workspace/mise.toml` → file does not exist

**For Service Coordination (test-all)**:
- [ ] Run `mise run test-all`:
  - Verify Go service starts: `curl http://localhost:8081/health` → 200 OK
  - Verify Node.js starts: `curl http://localhost:3002/` → response received
  - Verify unit tests run: output shows vitest execution
  - Verify integration tests run: output shows Go service tests
  - Verify E2E tests run: output shows e2e test execution
- [ ] Verify cleanup after success: `ps aux | grep -E "(node|price-service)"` → no background processes
- [ ] Verify cleanup after failure: Run failing test, check `ps aux` → no zombie processes

**For Test Setup Changes**:
- [ ] Review `src/test/setup.ts`: verify `docker compose` commands removed
- [ ] Verify tests can still be run manually: `pnpm test:integration` → works
- [ ] Verify environment variable still works: `START_GO_SERVICE_FOR_TESTS=1 pnpm test:integration` → works

---

## Task Flow

```
Verify Commands → Merge Mise Configs → Implement test-all → Update Setup → Validate → Cleanup
```

## Parallelization

None - tasks must run sequentially to verify before implementing.

---

## TODOs

- [ ] 1. Verify current test commands work

  **What to do**:
  - Run `pnpm test` to verify it runs and passes
  - Run `pnpm test:integration` to verify integration test command exists
  - Run `cd services/price-service && mise run test` to verify Go tests work
  - Check if `pnpm test:e2e` or similar exists for E2E tests
  - Document which commands run which test types

  **Must NOT do**:
  - Do NOT modify test commands or add new ones
  - Do NOT change test logic

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/package.json:10` - Test script definitions
  - `/workspace/.mise.toml:8-29` - Current test-all task structure

  **API/Type References** (contracts to implement against):
  - None (verification task)

  **Test References** (testing patterns to follow):
  - N/A (this is verification, not test implementation)

  **Documentation References** (specs and requirements):
  - `/workspace/docs/testing-guide.md:19-128` - Test command documentation

  **External References** (libraries and frameworks):
  - Vitest docs: https://vitest.dev/guide/cli - Test command reference

  **WHY Each Reference Matters** (explain the relevance):
  - `package.json` scripts: To understand what each test command actually runs (unit vs integration vs e2e)
  - `.mise.toml` test-all: Current implementation structure to understand what to replace
  - `testing-guide.md`: To understand expected test command behavior and workflow

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `pnpm test` → shows vitest execution, tests pass
  - [ ] Command: `pnpm test:integration` → executes integration tests (or error if doesn't exist)
  - [ ] Command: `cd services/price-service && mise run test` → Go unit tests run and pass
  - [ ] Document findings: Which commands exist? What test types do they run?
  - [ ] Evidence: Copy terminal output for each command

  **Commit**: NO

- [ ] 2. Verify Go service startup method and health endpoint

  **What to do**:
  - Check how Go service is normally started (binary vs `go run`)
  - Verify Go service has a `/health` or `/internal/health` endpoint
  - Test Go service startup manually: `cd services/price-service && go run cmd/server/main.go`
  - Test health endpoint: `curl http://localhost:8081/health` or `curl http://localhost:8080/internal/health`
  - Document exact startup command and health check endpoint

  **Must NOT do**:
  - Do NOT modify Go service code
  - Do NOT add new health endpoints

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/services/price-service/cmd/server/main.go` - Go service entry point
  - `/workspace/services/price-service/.mise.toml:14` - Go service run task

  **API/Type References** (contracts to implement against):
  - `/workspace/services/price-service/README.md:45-58` - API endpoints documentation (health endpoint at line 55)

  **Test References** (testing patterns to follow):
  - `/workspace/src/test/setup.ts:24` - Health check implementation pattern

  **Documentation References** (specs and requirements):
  - `/workspace/services/price-service/README.md:52-71` - Running the Server instructions

  **External References** (libraries and frameworks):
  - Go HTTP server: https://pkg.go.dev/net/http - Server listening behavior

  **WHY Each Reference Matters** (explain the relevance):
  - `main.go`: To understand how the Go service is started (binary path, dependencies)
  - `mise.toml run task`: To see the standard startup command used by mise
  - `API endpoints`: To find documented health check endpoint for Go service
  - `setup.ts health check`: To see the pattern used for checking Go service health in tests

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `cd services/price-service && go run cmd/server/main.go` → service starts
  - [ ] Command: `curl -f http://localhost:8080/health` OR `curl -f http://localhost:8080/internal/health` → 200 OK response
  - [ ] Document: Exact startup command, health endpoint URL, default port (8080), response body (if any)
  - [ ] Document: Note that .env.development uses 8081 for manual dev work to avoid conflict with 8080 default
  - [ ] Evidence: Copy terminal output showing service startup and health check

  **Commit**: NO

- [ ] 3. Verify Node.js dev server startup and port

  **What to do**:
  - Verify Node.js dev server startup command (`pnpm dev`)
  - Check which port it uses (from `.env.development` BETTER_AUTH_URL)
  - Test Node.js startup manually: `pnpm dev`
  - Verify server becomes responsive on port 3002
  - Check if there's a health or root endpoint

  **Must NOT do**:
  - Do NOT modify Node.js server code
  - Do NOT change port configuration

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/.env.development:14` - BETTER_AUTH_URL (port 3002)
  - `/workspace/.mise.toml:5-7` - Node.js dev task

  **API/Type References** (contracts to implement against):
  - None (verification task)

  **Test References** (testing patterns to follow):
  - N/A (verification task)

  **Documentation References** (specs and requirements):
  - `/workspace/docs/testing-guide.md` - Development server documentation

  **External References** (libraries and frameworks):
  - Vite docs: https://vitejs.dev/guide/cli - Dev server behavior

  **WHY Each Reference Matters** (explain the relevance):
  - `.env.development`: To confirm Node.js server port (3002 from BETTER_AUTH_URL)
  - `mise.toml dev task`: To see the standard Node.js startup command
  - `testing-guide.md`: To understand expected dev server behavior

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `pnpm dev` → server starts, shows "Vite ready at http://localhost:3002" or similar
  - [ ] Command: `curl -f http://localhost:3002/` → response received (200 OK or redirect)
  - [ ] Document: Startup command, port, how to verify server is ready
  - [ ] Evidence: Copy terminal output showing server startup and HTTP response

  **Commit**: NO

- [ ] 4. Read and document all mise config tasks

  **What to do**:
  - Read `/workspace/mise.toml` and list all tasks
  - Read `/.mise.toml` and list all tasks
  - Read `/workspace/services/price-service/.mise.toml` and list all tasks
  - Identify any duplicate task names between files
  - Identify any conflicting environment variable definitions
  - Document complete task list to ensure none are lost during merge

  **Must NOT do**:
  - Do NOT modify files yet (documentation only)
  - Do NOT lose track of any tasks or configurations

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/mise.toml` - Root Node.js mise config
  - `/.mise.toml` - Root mise config with test-all
  - `/workspace/services/price-service/.mise.toml` - Go service mise config

  **API/Type References** (contracts to implement against):
  - Mise config schema: https://mise.jdx.dev/configuration.html - Valid TOML structure

  **Test References** (testing patterns to follow):
  - N/A (documentation task)

  **Documentation References** (specs and requirements):
  - Mise documentation: https://mise.jdx.dev/tasks.html - Task definition syntax

  **External References** (libraries and frameworks):
  - TOML spec: https://toml.io/en/v1.0.0 - TOML file format

  **WHY Each Reference Matters** (explain the relevance):
  - Three mise files: To understand complete configuration before merging
  - Mise config schema: To ensure merged file is syntactically valid
  - Mise task docs: To understand task dependencies and composition features

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Documented list of tasks from `/workspace/mise.toml`
  - [ ] Documented list of tasks from `/.mise.toml`
  - [ ] Documented list of tasks from `services/price-service/.mise.toml`
  - [ ] Identified duplicates or conflicts
  - [ ] Evidence: Created task list in draft or notes

  **Commit**: NO

- [ ] 5. Merge mise configurations into /.mise.toml

  **What to do**:
  - Merge all tasks from `/workspace/mise.toml` into `/.mise.toml`
  - Preserve exact task names, descriptions, and commands
  - Keep `[tools]` section from `/.mise.toml` (node = "24.13.0")
  - Add `[tools]` section from `/workspace/mise.toml` if different (node = "24", go = "latest")
  - Resolve any duplicate task names (keep the more specific or comprehensive one)
  - Resolve any conflicting environment variables (use values from `/.mise.toml`)
  - Keep `services/price-service/.mise.toml` unchanged (Go-specific tasks)

  **Must NOT do**:
  - Do NOT delete any tasks during merge (preserve all)
  - Do NOT modify task commands (only merge, don't refactor yet)
  - Do NOT modify `services/price-service/.mise.toml`

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/mise.toml:1-51` - All tasks to merge
  - `/.mise.toml:1-29` - Target file with existing tasks
  - `/workspace/services/price-service/.mise.toml:1-502` - Go-specific tasks (keep separate)

  **API/Type References** (contracts to implement against):
  - Mise config schema: https://mise.jdx.dev/configuration.html

  **Test References** (testing patterns to follow):
  - N/A (configuration merge task)

  **Documentation References** (specs and requirements):
  - Mise docs: https://mise.jdx.dev/tasks.html - Task composition

  **External References** (libraries and frameworks):
  - TOML spec: https://toml.io/en/v1.0.0

  **WHY Each Reference Matters** (explain the relevance):
  - Source files: To extract exact task configurations for merge
  - Mise config schema: To ensure merged file is valid TOML
  - Go service mise file: To know which tasks are already in separate file (don't merge those)

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] File exists: `/.mise.toml` (updated)
  - [ ] Command: `mise tasks list` → shows all tasks from both source files
  - [ ] Command: `mise doctor` → no configuration errors
  - [ ] Evidence: Count tasks before merge, count after merge → same or higher count

  **Commit**: NO

- [ ] 6. Delete /workspace/mise.toml

  **What to do**:
  - Delete `/workspace/mise.toml` after verifying merge is complete
  - Verify file is deleted with `ls` command
  - Keep `.mise.toml` file (this is now the primary config)

  **Must NOT do**:
  - Do NOT delete `/.mise.toml` (this is the merged file)
  - Do NOT delete `services/price-service/.mise.toml`

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - None (simple deletion)

  **API/Type References** (contracts to implement against):
  - None

  **Test References** (testing patterns to follow):
  - N/A (deletion task)

  **Documentation References** (specs and requirements):
  - N/A

  **External References** (libraries and frameworks):
  - Bash rm command: https://linux.die.net/man/1/rm - File deletion

  **WHY Each Reference Matters** (explain the relevance):
  - None (simple file deletion task)

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `ls /workspace/mise.toml` → error: No such file or directory
  - [ ] Command: `ls /.mise.toml` → file exists (not deleted)
  - [ ] Evidence: Copy `ls` output showing deletion

  **Commit**: NO

- [ ] 7. Implement new test-all task in /.mise.toml

  **What to do**:
  - Replace existing `test-all` task in `/.mise.toml` (lines 8-29)
  - Implement new `test-all` with following workflow:
    1. Check port availability: `lsof -i :8080` fails (port free) OR abort if occupied
    2. Check port availability: `lsof -i :3002` fails (port free) OR abort if occupied
    3. Start Go service in background: `PORT=8080 cd services/price-service && go run cmd/server/main.go &`
    4. Capture Go service PID: `go_pid=$!`
    5. Wait for Go service health: `curl -f http://localhost:8080/health` (max 30s, retry every 1s)
    6. Start Node.js dev server in background: `pnpm dev &`
    7. Capture Node.js PID: `node_pid=$!`
    8. Wait for Node.js ready: `curl -f -s -o /dev/null -w "%{http_code}" http://localhost:3002/` (expect 200 or 302, max 30s, retry every 1s)
    9. Run unit tests: `pnpm test`
    10. Run integration tests: `pnpm test:integration` (or appropriate command from step 1)
    11. Run E2E tests: `cd services/price-service && go test ./tests/e2e/...` (run directly, not via mise to avoid testcontainers)
    12. Kill Node.js process: `kill $node_pid; sleep 5; ps -p $node_pid >/dev/null || kill -9 $node_pid`
    13. Kill Go service process: `kill $go_pid; sleep 5; ps -p $go_pid >/dev/null || kill -9 $go_pid`
    14. Report success/failure
  - Use bash trap handlers to ensure cleanup happens on failure or interruption (Ctrl+C): `trap 'cleanup; exit 1' INT TERM`
  - Set environment variables: `DATABASE_URL` (use existing value from .env), `GO_SERVICE_URL=http://localhost:8080`
  - Exit code: 0 if all tests pass, 1 if any test fails
  - **NOTE on ports**:
    - Port 3000: Go service default (from config.go), not used in tests
    - Port 8080: Docker/test environment (from docker-compose), used by integration tests and test-all
    - Port 8081: Manual dev environment (from .env.development), to avoid conflict with 8080
    - test-all uses port 8080 (set via PORT=8080 env var) to match integration tests expectations
  - **NOTE on E2E tests**: Run directly with `go test ./tests/e2e/...` instead of `mise run test-e2e` to avoid testcontainers creating duplicate postgres containers

  **Must NOT do**:
  - Do NOT use docker-compose commands
  - Do NOT modify test logic or test files
  - Do NOT change test behavior or test expectations
  - Do NOT change environment variable names (use `DATABASE_URL`, `GO_SERVICE_URL`)
  - Do NOT change ports (8081 for Go, 3002 for Node)

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/.mise.toml:8-29` - Current test-all task (to replace)
  - `/workspace/src/test/setup.ts:7-49` - Background process with health check pattern
  - `/workspace/src/test/setup.ts:44-47` - Process cleanup pattern

  **API/Type References** (contracts to implement against):
  - None

  **Test References** (testing patterns to follow):
  - `/workspace/src/test/setup.ts:22-28` - Health check retry pattern with interval
  - `/workspace/src/test/setup.ts:44-47` - Process cleanup pattern

  **Documentation References** (specs and requirements):
  - `/workspace/docs/testing-guide.md:19-128` - Test command reference and expectations

  **External References** (libraries and frameworks):
  - Bash traps: https://tldp.org/LDP/Bash-Beginners-Guide/html/sect_12_02.html - Signal handling
  - Bash background processes: https://tldp.org/HOWTO/Bash-Prog-Intro-HOWTO-4.html - Process management
  - curl exit codes: https://curl.se/docs/manpage.html - Use `-f` for fail on HTTP errors
  - lsof command: https://linux.die.net/man/8/lsof - Port checking
  - curl HTTP status code output: https://curl.se/docs/manpage.html - Use `-w "%{http_code}"` to get status code

  **WHY Each Reference Matters** (explain the relevance):
  - Current test-all: To understand what task to replace
  - setup.ts health check: To see the pattern for waiting for Go service to be ready
  - setup.ts cleanup: To see how to kill background processes gracefully
  - lsof command: To check if ports 8080 and 3002 are available before starting services
  - curl HTTP status: To reliably verify Node.js is ready (check for 200 or 302, not just any HTTP response)
  - **NOTE on ports**:
    - Port 3000: Go service default (from config.go and config.yaml), not used in tests
    - Port 8080: Docker/test environment (from docker-compose), used by integration tests and test-all
    - Port 8081: Manual dev environment (from .env.development), to avoid conflict with 8080
    - test-all uses port 8080 (set via `PORT=8080` env var) to match integration tests expectations
  - **NOTE on E2E tests**: Run directly with `go test ./tests/e2e/...` to avoid testcontainers creating duplicate postgres containers

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `mise run test-all` → executes full workflow
  - [ ] Verify port check: Command checks ports 8080 and 3002 before starting services
  - [ ] Verify Go service starts: Check output shows "Starting Go price service..." or similar
  - [ ] Verify Go health: `curl http://localhost:8080/health` during test execution → 200 OK
  - [ ] Verify Node.js starts: Check output shows "Vite ready at http://localhost:3002" or similar
  - [ ] Verify Node ready: `curl -f -s -o /dev/null -w "%{http_code}" http://localhost:3002/` during test execution → 200 or 302
  - [ ] Verify unit tests run: Output shows vitest unit test execution
  - [ ] Verify integration tests run: Output shows integration test execution
  - [ ] Verify E2E tests run: Output shows `go test ./tests/e2e/...` execution
  - [ ] Verify cleanup on success: After completion, `ps aux | grep -E "(node|price-service)" | grep -v grep` → no processes
  - [ ] Verify cleanup on failure: Intentionally break test (e.g., add failing test), run `mise run test-all`, check `ps aux` after → no zombie processes
  - [ ] Evidence: Copy full terminal output showing service startup, test execution, and cleanup

  **Commit**: YES
  - Message: `refactor(mise): merge configs and implement service-coordinated test-all`
  - Files: `/.mise.toml`, `/workspace/mise.toml` (deleted)
  - Pre-commit: `mise tasks list` (verify all tasks present)

- [ ] 8. Update src/test/setup.ts to remove docker-compose dependency

  **What to do**:
  - Remove `startGoService()` function (lines 7-49 in current file)
  - Remove `stopGoService()` function (lines 51-61 in current file)
  - Remove `isGoServiceRunning()` function (lines 63-65 in current file) if not used elsewhere
  - Keep all other functions intact: `getTestDb()`, `closeTestDb()`, `cleanupTestDatabase()`, `applyMigrations()`
  - Ensure existing tests that use `START_GO_SERVICE_FOR_TESTS=1` environment variable still work (they should use mise test-all instead)
  - Add comment explaining that service coordination is now handled by mise test-all

  **Must NOT do**:
  - Do NOT modify test logic or test behavior
  - Do NOT modify test files (only setup.ts infrastructure)
  - Do NOT change database connection logic
  - Do NOT change how tests connect to database

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - `/workspace/src/test/setup.ts:7-65` - Functions to remove
  - `/workspace/src/test/setup.ts:70-191` - Functions to keep intact

  **API/Type References** (contracts to implement against):
  - None

  **Test References** (testing patterns to follow):
  - `/workspace/src/orpc/router/__tests__/price-service.integration.test.ts` - Check if it uses setup functions
  - `/workspace/src/orpc/router/__tests__/stores-integration.test.ts` - Check if it uses setup functions

  **Documentation References** (specs and requirements):
  - N/A

  **External References** (libraries and frameworks):
  - Vitest setup docs: https://vitest.dev/guide/in-source.html - Test setup patterns

  **WHY Each Reference Matters** (explain the relevance):
  - setup.ts: To identify which functions to remove and which to keep
  - Integration test files: To verify they don't depend on removed setup functions

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] File review: `src/test/setup.ts` → docker-compose functions removed, database functions intact
  - [ ] Command: `grep -n "docker compose" src/test/setup.ts` → no results (removed all references)
  - [ ] Command: `grep -n "startGoService\|stopGoService" src/test/setup.ts` → no results (functions removed)
  - [ ] Command: `grep -n "getTestDb\|closeTestDb" src/test/setup.ts` → functions still present (kept)
  - [ ] Evidence: Copy relevant sections of modified file

  **Commit**: YES
  - Message: `refactor(test): remove docker-compose dependency from test setup`
  - Files: `src/test/setup.ts`
  - Pre-commit: `pnpm test:unit` (verify basic tests still pass)

- [ ] 9. Validate merged mise configuration

  **What to do**:
  - Run `mise tasks list` to verify all tasks are present
  - Run `mise doctor` to check for configuration errors
  - Verify count of tasks matches or exceeds count from step 4
  - Verify `test-all` task exists in task list
  - Verify no duplicate task names
  - Check for any syntax errors in merged config

  **Must NOT do**:
  - Do NOT modify mise configuration (validation only)

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - None (validation task)

  **API/Type References** (contracts to implement against):
  - Mise CLI: https://mise.jdx.dev/cli/tasks.html - `mise tasks list` command

  **Test References** (testing patterns to follow):
  - N/A (validation task)

  **Documentation References** (specs and requirements):
  - Mise docs: https://mise.jdx.dev/cli/doctor.html - Configuration validation

  **External References** (libraries and frameworks):
  - N/A

  **WHY Each Reference Matters** (explain the relevance):
  - mise tasks list: To verify all tasks from both files are present after merge
  - mise doctor: To ensure merged configuration has no syntax errors

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `mise tasks list` → shows all tasks from original files
  - [ ] Command: `mise doctor` → no errors reported
  - [ ] Evidence: Copy terminal output showing task list and doctor results

  **Commit**: NO

- [ ] 10. Full test run verification

  **What to do**:
  - Run `mise run test-all` to execute complete workflow
  - Monitor service startup (Go and Node)
  - Monitor test execution (unit, integration, E2E)
  - Verify all tests pass
  - Verify services are killed after tests complete
  - Check for zombie processes with `ps aux`
  - Document any issues or anomalies

  **Must NOT do**:
  - Do NOT modify any files (verification only)
  - Do NOT change test behavior

  **Parallelizable**: NO

  **References**:

  **Pattern References** (existing code to follow):
  - None (verification task)

  **API/Type References** (contracts to implement against):
  - None

  **Test References** (testing patterns to follow):
  - N/A (verification task)

  **Documentation References** (specs and requirements):
  - `/workspace/docs/testing-guide.md` - Expected test behavior

  **External References** (libraries and frameworks):
  - N/A

  **WHY Each Reference Matters** (explain the relevance):
  - testing-guide.md: To understand what successful test execution should look like

  **Acceptance Criteria**:

  **Manual Execution Verification**:
  - [ ] Command: `mise run test-all` → completes successfully
  - [ ] Verify: All unit tests pass (output shows X passed, 0 failed)
  - [ ] Verify: All integration tests pass (output shows X passed, 0 failed)
  - [ ] Verify: All E2E tests pass (output shows X passed, 0 failed)
  - [ ] Verify cleanup: `ps aux | grep -E "(node|price-service)" | grep -v grep` → no processes
  - [ ] Verify no errors in output (service startup, health checks, test execution)
  - [ ] Evidence: Copy full terminal output showing complete workflow

  **Commit**: NO

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 7 | `refactor(mise): merge configs and implement service-coordinated test-all` | `/.mise.toml`, `/workspace/mise.toml` | `mise tasks list` |
| 8 | `refactor(test): remove docker-compose dependency from test setup` | `src/test/setup.ts` | `pnpm test:unit` |

---

## Success Criteria

### Verification Commands
```bash
# Verify merged config
mise tasks list                    # Should show all tasks from both files
mise doctor                        # Should report no errors

# Verify test-all workflow
mise run test-all                   # Should start services, run tests, kill services

# Verify service health during tests
curl http://localhost:8080/health  # Should return 200 OK during test execution
curl -f -s -o /dev/null -w "%{http_code}" http://localhost:3002/  # Should return 200 or 302 during test execution

# Verify cleanup (after test-all completes)
ps aux | grep -E "(node|price-service)" | grep -v grep  # Should show no processes

# Verify file deletion
ls /workspace/mise.toml           # Should fail: No such file
ls /.mise.toml                   # Should succeed: file exists
```

### Final Checklist
- [ ] All existing mise tasks present in merged config
- [ ] `/workspace/mise.toml` deleted
- [ ] `test-all` starts Go (8080) and Node (3002) services
- [ ] `test-all` runs unit + integration + E2E tests
- [ ] All tests pass (unit, integration, E2E)
- [ ] Services killed after tests complete (success or failure)
- [ ] No zombie processes remain
- [ ] `src/test/setup.ts` docker-compose functions removed
- [ ] Manual test runs still work (`pnpm test`, `go test`)
- [ ] Environment variables unchanged (DATABASE_URL, GO_SERVICE_URL)
