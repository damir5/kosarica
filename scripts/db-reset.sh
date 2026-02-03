#!/usr/bin/env bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load environment variables
ENV_FILE="${NODE_ENV:+.env.$NODE_ENV}"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
elif [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

# Check DATABASE_URL
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    exit 1
fi

# Check CLICKHOUSE_URL (optional - warn if not set)
CLICKHOUSE_URL="${CLICKHOUSE_URL:-}"
if [[ -z "$CLICKHOUSE_URL" ]]; then
    echo -e "${YELLOW}Warning: CLICKHOUSE_URL not set - ClickHouse data will not be reset${NC}"
    SKIP_CLICKHOUSE=true
else
    SKIP_CLICKHOUSE=false
fi

# Defaults
CONFIRM=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --yes|-y)
            CONFIRM=false
            shift
            ;;
        --help|-h)
            echo "Usage: db-reset.sh [OPTIONS]"
            echo ""
            echo "Reset database and create default admin user"
            echo ""
            echo "Options:"
            echo "  --yes, -y         Skip confirmation prompt"
            echo "  --help, -h        Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  NODE_ENV          Environment (loads .env.\$NODE_ENV if exists)"
            echo "  DATABASE_URL      PostgreSQL connection string (required)"
            echo "  CLICKHOUSE_URL    ClickHouse HTTP URL (optional)"
            echo ""
            echo "This script:"
            echo "  • Drops all PostgreSQL tables and runs migrations from scratch"
            echo "  • Truncates ClickHouse prices table (if CLICKHOUSE_URL is set)"
            echo "  • Creates dev admin user: admin@dev.local / admin123456"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Confirmation prompt
if [[ "$CONFIRM" == "true" ]]; then
    echo -e "${YELLOW}⚠️  This will delete ALL database data and recreate it.${NC}"
    echo -e "  PostgreSQL: ${DATABASE_URL%%@*}@***  # ${DATABASE_URL##*/}"
    if [[ "$SKIP_CLICKHOUSE" == "false" ]]; then
        echo -e "  ClickHouse:  $CLICKHOUSE_URL"
    fi
    echo ""
    echo -e "  This will:"
    echo -e "    • Drop all PostgreSQL tables and recreate from migrations"
    if [[ "$SKIP_CLICKHOUSE" == "false" ]]; then
        echo -e "    • Truncate ClickHouse prices table"
    fi
    echo -e "    • Create dev admin user: admin@dev.local / admin123456"
    echo ""
    read -p "Type 'yes' to confirm: " response
    if [[ "$response" != "yes" ]]; then
        echo -e "${YELLOW}Cancelled.${NC}"
        exit 0
    fi
fi

echo -e "${GREEN}Resetting database...${NC}"

# Drop schemas and recreate
if psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;" 2>/dev/null; then
    echo -e "${GREEN}✓ Dropped public and drizzle schemas${NC}"
else
    echo -e "${RED}✗ Failed to drop schema. Check DATABASE_URL and permissions.${NC}"
    exit 1
fi

# Run migrations
echo -e "${GREEN}Running migrations...${NC}"
if ! pnpm db:migrate; then
    echo -e "${RED}✗ Migrations failed${NC}"
    exit 1
fi

# Create dev admin user
echo -e "${GREEN}Creating dev admin user...${NC}"
if ! node --import ./scripts/node/register-aliases.mjs scripts/ensure-admin.ts; then
    echo -e "${RED}✗ Failed to create admin user${NC}"
    exit 1
fi

# Reset ClickHouse if configured
if [[ "$SKIP_CLICKHOUSE" == "false" ]]; then
    echo -e "${GREEN}Resetting ClickHouse...${NC}"

    # Check if ClickHouse is accessible
    if ! curl -sSf "$CLICKHOUSE_URL/ping" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  ClickHouse is not accessible, skipping ClickHouse reset${NC}"
    else
        # Truncate the prices table
        if curl -sS "$CLICKHOUSE_URL" --data "TRUNCATE TABLE IF EXISTS prices" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Truncated ClickHouse prices table${NC}"
        else
            echo -e "${YELLOW}⚠️  Failed to truncate ClickHouse prices table${NC}"
        fi
    fi
fi

echo ""
echo -e "${GREEN}✅ Database reset complete!${NC}"
echo -e "  Admin user: admin@dev.local / admin123456"
