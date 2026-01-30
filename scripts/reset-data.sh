#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Defaults
STORAGE_PATHS=("./data/storage" "./services/price-service/data")
CONFIRM=true
KEEP_DB=false
KEEP_STORAGE=false
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --yes|-y)
            CONFIRM=false
            shift
            ;;
        --keep-db)
            KEEP_DB=true
            shift
            ;;
        --keep-storage)
            KEEP_STORAGE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "Usage: reset-data.sh [OPTIONS]"
            echo ""
            echo "Reset all application data and recreate the database"
            echo ""
            echo "Options:"
            echo "  --yes, -y         Skip confirmation prompt"
            echo "  --keep-db         Only reset storage, keep database"
            echo "  --keep-storage    Only reset database, keep storage"
            echo "  --dry-run         Show what would be deleted without deleting"
            echo "  --help, -h        Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  DATABASE_URL      PostgreSQL connection string (required)"
            echo "  PGSUPERUSER       Superuser name for schema drop (default: damir)"
            echo ""
            echo "This script:"
            echo "  • Drops all tables and runs migrations from scratch"
            echo "  • Creates dev admin user: admin@dev.local / admin123456"
            echo "  • Deletes all files from storage directories"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Check DATABASE_URL
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    echo "Usage: DATABASE_URL='postgres://...' ./scripts/reset-data.sh"
    exit 1
fi

# Extract connection details from DATABASE_URL
DB_NAME="${DATABASE_URL##*/}"
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
if [[ -z "$DB_USER" ]]; then
    # Try alternative format
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^@]*\)@.*|\1|p' | sed 's|:.*||')
fi
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*:\([^@]*\)@.*|\1|p')

# Default superuser for schema operations (can be overridden via env)
PG_SUPERUSER="${PGSUPERUSER:-damir}"

# Confirmation prompt
if [[ "$CONFIRM" == "true" ]] && [[ "$DRY_RUN" == "false" ]]; then
    echo -e "${YELLOW}⚠️  This will delete ALL data and recreate the database.${NC}"
    echo -e "  Database: ${DATABASE_URL%%@*}@***  # ${DATABASE_URL##*/}"
    echo -e "  Storage paths:"
    for path in "${STORAGE_PATHS[@]}"; do
        echo -e "    • $path"
    done
    echo ""
    if [[ "$KEEP_DB" == "false" ]] && [[ "$KEEP_STORAGE" == "false" ]]; then
        echo -e "  This will:"
        echo -e "    • Drop all tables and recreate from migrations"
        echo -e "    • Create dev admin user: admin@dev.local / admin123456"
        echo -e "    • Delete all files from storage directories"
    elif [[ "$KEEP_DB" == "true" ]]; then
        echo -e "  This will delete all files from storage directories only"
    else
        echo -e "  This will drop and recreate the database schema"
    fi
    echo ""
    read -p "Type 'yes' to confirm: " response
    if [[ "$response" != "yes" ]]; then
        echo -e "${YELLOW}Cancelled.${NC}"
        exit 0
    fi
fi

# Dry-run banner
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}=== DRY RUN MODE - No changes will be made ===${NC}"
    echo ""
fi

# Reset database
if [[ "$KEEP_DB" == "false" ]]; then
    echo -e "${GREEN}Resetting database...${NC}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}Would drop and recreate public schema, then run migrations${NC}"
        echo -e "${YELLOW}Would create admin user: admin@dev.local / admin123456${NC}"
    else
        # Try to drop schema as current user first
        if psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Dropped public and drizzle schemas${NC}"
        else
            # Current user doesn't own the schema, try with superuser
            echo -e "${YELLOW}⚠ Current user doesn't own public schema, trying with ${PG_SUPERUSER}...${NC}"
            if ! PGPASSWORD="$DB_PASS" psql -U "$PG_SUPERUSER" -h "$DB_HOST" -d "$DB_NAME" \
                -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA PUBLIC AUTHORIZATION ${DB_USER};" >/dev/null 2>&1; then
                echo -e "${RED}✗ Failed to drop schema. Please ensure ${PG_SUPERUSER} has necessary privileges.${NC}"
                echo -e "${YELLOW}You can set a different superuser via: PGSUPERUSER=username ./scripts/reset-data.sh${NC}"
                exit 1
            fi
            echo -e "${GREEN}✓ Dropped public and drizzle schemas as ${PG_SUPERUSER}${NC}"
        fi

        # Run all migrations
        echo -e "${GREEN}Running migrations...${NC}"
        pnpm db:migrate

        # Create dev admin user (uses Better Auth for proper password hashing)
        echo -e "${GREEN}Creating dev admin user...${NC}"
        npx tsx scripts/ensure-admin.ts

        echo -e "${GREEN}✓ Database reset complete${NC}"
    fi
fi

# Reset storage
if [[ "$KEEP_STORAGE" == "false" ]]; then
    echo -e "${GREEN}Resetting storage...${NC}"

    for STORAGE_PATH in "${STORAGE_PATHS[@]}"; do
        if [[ ! -d "$STORAGE_PATH" ]]; then
            echo -e "${YELLOW}Storage directory does not exist: $STORAGE_PATH${NC}"
        elif [[ "$DRY_RUN" == "true" ]]; then
            echo -e "${YELLOW}Would delete all files from: $STORAGE_PATH${NC}"
            find "$STORAGE_PATH" -type f 2>/dev/null | head -20 | while read -r file; do
                echo "  • $file"
            done
            file_count=$(find "$STORAGE_PATH" -type f 2>/dev/null | wc -l)
            if [[ $file_count -gt 20 ]]; then
                echo "  ... and $((file_count - 20)) more files"
            fi
        else
            # Delete all files in storage
            find "$STORAGE_PATH" -type f -delete 2>/dev/null || true
            # Clean up empty directories
            find "$STORAGE_PATH" -type d -empty -delete 2>/dev/null || true
            echo -e "${GREEN}✓ Storage reset complete: $STORAGE_PATH${NC}"
        fi
    done
fi

if [[ "$DRY_RUN" == "false" ]]; then
    echo ""
    echo -e "${GREEN}✅ Reset complete!${NC}"
fi
