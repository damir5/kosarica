#!/bin/bash
set -euo pipefail

#############################################
# OrbStack Ubuntu VM Verification Script
# Checks all services are running correctly
#############################################

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}===>${NC} $1"; }

# Check if docker needs sudo
if groups "$USER" | grep -q docker; then
    DOCKER_CMD="docker"
else
    DOCKER_CMD="sudo docker"
fi

# Track results
PASSED=0
FAILED=0
WARNINGS=0

check_pass() {
    echo -e "${GREEN}[✓]${NC} $1"
    PASSED=$((PASSED + 1))
}

check_fail() {
    echo -e "${RED}[✗]${NC} $1"
    FAILED=$((FAILED + 1))
}

check_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

#############################################
# Docker Container Status
#############################################
log_step "Docker Container Status"
echo ""

# Get container status
CONTAINERS=$($DOCKER_CMD compose ps --format json 2>/dev/null || echo "[]")

if [ "$CONTAINERS" = "[]" ]; then
    check_fail "No containers found. Run 'docker compose up -d' first."
else
    echo "$($DOCKER_CMD ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'kosarica|NAMES')"
    echo ""

    # Check PostgreSQL
    if $DOCKER_CMD ps --format '{{.Names}}' | grep -q kosarica-postgres-dev; then
        POSTGRES_STATUS=$($DOCKER_CMD inspect kosarica-postgres-dev --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
        if [ "$POSTGRES_STATUS" = "healthy" ]; then
            check_pass "PostgreSQL container is healthy"
        else
            check_fail "PostgreSQL container status: $POSTGRES_STATUS"
        fi
    else
        check_fail "PostgreSQL container not found"
    fi

    # Check Price Service
    if $DOCKER_CMD ps --format '{{.Names}}' | grep -q kosarica-price-service-dev; then
        PRICE_STATUS=$($DOCKER_CMD inspect kosarica-price-service-dev --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
        if [ "$PRICE_STATUS" = "healthy" ] || [ "$PRICE_STATUS" = "starting" ]; then
            check_pass "Price Service container is $PRICE_STATUS"
        else
            check_warn "Price Service container status: $PRICE_STATUS"
        fi
    else
        check_fail "Price Service container not found"
    fi
fi

echo ""

#############################################
# PostgreSQL Health Check
#############################################
log_step "PostgreSQL Health Check"
echo ""

if $DOCKER_CMD ps --format '{{.Names}}' | grep -q kosarica-postgres-dev; then
    if $DOCKER_CMD exec kosarica-postgres-dev pg_isready -U kosarica &>/dev/null; then
        check_pass "PostgreSQL is accepting connections"

        # Check database exists
        DB_COUNT=$($DOCKER_CMD exec kosarica-postgres-dev psql -U kosarica -tAc "SELECT 1 FROM pg_database WHERE datname='kosarica'" 2>/dev/null || echo "0")
        if [ "$DB_COUNT" = "1" ]; then
            check_pass "Database 'kosarica' exists"

            # Check for tables
            TABLE_COUNT=$($DOCKER_CMD exec kosarica-postgres-dev psql -U kosarica -d kosarica -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "0")
            if [ "$TABLE_COUNT" -gt 0 ]; then
                check_pass "Database tables found ($TABLE_COUNT tables)"
            else
                check_warn "No tables found. Run migrations: pnpm db:migrate"
            fi

            # Check for drizzle migrations table
            if $DOCKER_CMD exec kosarica-postgres-dev psql -U kosarica -d kosarica -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='drizzle_migrations'" 2>/dev/null | grep -q 1; then
                MIGRATION_COUNT=$($DOCKER_CMD exec kosarica-postgres-dev psql -U kosarica -d kosarica -tAc "SELECT COUNT(*) FROM drizzle_migrations" 2>/dev/null || echo "0")
                check_pass "Drizzle migrations table exists ($MIGRATION_COUNT migrations applied)"
            else
                check_warn "Drizzle migrations table not found"
            fi
        else
            check_fail "Database 'kosarica' does not exist"
        fi
    else
        check_fail "PostgreSQL is not accepting connections"
    fi
else
    check_fail "PostgreSQL container is not running"
fi

echo ""

#############################################
# Go Price Service Health Check
#############################################
log_step "Go Price Service Health Check"
echo ""

if $DOCKER_CMD ps --format '{{.Names}}' | grep -q kosarica-price-service-dev; then
    # Check health endpoint
    if command -v curl &> /dev/null; then
        HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null || echo "000")
        if [ "$HEALTH_STATUS" = "200" ]; then
            check_pass "Go Price Service /health returns 200"

            # Try to get health response body
            HEALTH_BODY=$(curl -s http://localhost:8080/health 2>/dev/null || echo "{}")
            if echo "$HEALTH_BODY" | grep -q "ok\|healthy\|status"; then
                check_pass "Health endpoint response: $HEALTH_BODY"
            fi
        elif [ "$HEALTH_STATUS" = "000" ]; then
            check_warn "Could not connect to Go Price Service (port 8080)"
        else
            check_fail "Go Price Service /health returned $HEALTH_STATUS"
        fi
    else
        check_warn "curl not available, skipping HTTP health check"
    fi

    # Check container logs for errors
    LOG_ERRORS=$($DOCKER_CMD logs kosarica-price-service-dev 2>&1 | grep -i "error\|panic\|fatal" | tail -5 || true)
    if [ -n "$LOG_ERRORS" ]; then
        check_warn "Recent errors in price-service logs:"
        echo "$LOG_ERRORS" | sed 's/^/    /'
    fi
else
    check_fail "Go Price Service container is not running"
fi

echo ""

#############################################
# Node.js App Check (if running)
#############################################
log_step "Node.js App Check (Development Server)"
echo ""

if command -v curl &> /dev/null; then
    NODE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
    if [ "$NODE_STATUS" = "200" ] || [ "$NODE_STATUS" = "404" ]; then
        check_pass "Node.js app is responding on port 3000"
    elif [ "$NODE_STATUS" = "000" ]; then
        check_warn "Node.js app is not running. Start with: pnpm dev"
    else
        check_warn "Node.js app returned status $NODE_STATUS"
    fi
else
    check_warn "curl not available, skipping Node.js check"
fi

echo ""

#############################################
# Configuration Check
#############################################
log_step "Configuration Check"
echo ""

if [ -f ".env" ]; then
    check_pass ".env file exists"

    # Check for required variables
    if grep -q "BETTER_AUTH_SECRET=" .env && ! grep -q "BETTER_AUTH_SECRET=your-secret-here" .env; then
        check_pass "BETTER_AUTH_SECRET is set"
    else
        check_fail "BETTER_AUTH_SECRET not properly set"
    fi

    if grep -q "INTERNAL_API_KEY=" .env && ! grep -q "INTERNAL_API_KEY=dev-internal-api-key-change-in-production" .env; then
        check_pass "INTERNAL_API_KEY is set"
    else
        check_warn "INTERNAL_API_KEY using default value"
    fi

    if grep -q "DATABASE_URL=" .env; then
        check_pass "DATABASE_URL is set"
    else
        check_fail "DATABASE_URL not set"
    fi
else
    check_fail ".env file not found. Run installation script first."
fi

echo ""

#############################################
# Dependencies Check
#############################################
log_step "Dependencies Check"
echo ""

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    check_pass "Node.js installed: $NODE_VERSION"
else
    check_fail "Node.js not found"
fi

if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm -v)
    check_pass "pnpm installed: $PNPM_VERSION"
else
    check_fail "pnpm not found"
fi

if command -v go &> /dev/null; then
    GO_VERSION=$(go version)
    check_pass "Go installed: $GO_VERSION"
else
    check_warn "Go not found (required for price-service development)"
fi

if [ -d "node_modules" ]; then
    check_pass "node_modules directory exists"
else
    check_fail "node_modules not found. Run: pnpm install"
fi

echo ""

#############################################
# Summary Table
#############################################
log_step "Summary"
echo ""
printf "%-20s %-10s %-10s %-10s\n" "Check Type" "Passed" "Failed" "Warnings"
printf "%s\n" "------------------------------------------------------------"
printf "%-20s %-10s %-10s %-10s\n" "Overall" "$PASSED" "$FAILED" "$WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
    log_info "All critical checks passed!"
    if [ $WARNINGS -gt 0 ]; then
        log_warn "There are $WARNINGS warning(s) to review."
    fi
    exit 0
else
    log_error "$FAILED check(s) failed. Please review and fix."
    exit 1
fi
