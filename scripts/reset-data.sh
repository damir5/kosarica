#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Defaults
STORAGE_PATH="${STORAGE_PATH:-./data/storage}"
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
            echo "Reset all application data (preserves admin user registration)"
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
            echo "  STORAGE_PATH      Path to local storage (default: ./data/storage)"
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

# Confirmation prompt
if [[ "$CONFIRM" == "true" ]] && [[ "$DRY_RUN" == "false" ]]; then
    echo -e "${YELLOW}⚠️  This will delete ALL data except admin users.${NC}"
    echo -e "  Database: ${DATABASE_URL%%@*}@***  # ${DATABASE_URL##*/}"
    echo -e "  Storage:  $STORAGE_PATH"
    echo ""
    if [[ "$KEEP_DB" == "false" ]] && [[ "$KEEP_STORAGE" == "false" ]]; then
        echo -e "  This will:"
        echo -e "    • Truncate all database tables (except user, session, account, verification, passkey)"
        echo -e "    • Delete all files from storage directory"
    elif [[ "$KEEP_DB" == "true" ]]; then
        echo -e "  This will delete all files from storage directory only"
    else
        echo -e "  This will truncate all database tables only"
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

# Get all tables from information_schema (excluding Better Auth tables)
# Then sort by foreign key dependencies to handle CASCADE correctly

# Better Auth tables to preserve (matching pattern)
PRESERVE_PATTERNS=(
    "user"
    "session"
    "account"
    "verification"
    "passkey"
)

# Get all tables in public schema, excluding preserved tables
TABLES=$(
    psql "$DATABASE_URL" -t -c "
        WITH table_dependencies AS (
            SELECT
                t.table_name,
                COUNT(fk.foreign_table_name) as has_dependents
            FROM information_schema.tables t
            LEFT JOIN (
                SELECT
                    tc.table_name,
                    ccu.table_name AS foreign_table_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu
                    ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
            ) fk ON fk.table_name = t.table_name
            WHERE t.table_schema = 'public'
                AND t.table_type = 'BASE TABLE'
                AND t.table_name NOT IN ('user', 'session', 'account', 'verification', 'passkey')
            GROUP BY t.table_name
        )
        SELECT table_name
        FROM table_dependencies
        ORDER BY has_dependents ASC, table_name ASC;
    " | xargs
)

# Reset database
if [[ "$KEEP_DB" == "false" ]]; then
    echo -e "${GREEN}Resetting database...${NC}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}Would truncate the following tables:${NC}"
        echo "$TABLES" | tr ' ' '\n' | while read -r table; do
            echo "  • $table"
        done
        echo ""
        echo -e "${YELLOW}Would preserve the following tables:${NC}"
        for pattern in "${PRESERVE_PATTERNS[@]}"; do
            echo "  • $pattern"
        done
    else
        # Execute TRUNCATE with CASCADE for proper dependency handling
        if [[ -n "$TABLES" ]]; then
            if psql "$DATABASE_URL" -c "TRUNCATE TABLE $TABLES CASCADE;" >/dev/null 2>&1; then
                echo -e "${GREEN}✓ Database reset complete (${TABLES// /, } tables truncated, admin users preserved)${NC}"
            else
                echo -e "${RED}✗ Database reset failed${NC}"
                exit 1
            fi
        else
            echo -e "${YELLOW}No tables to truncate${NC}"
        fi
    fi
fi

# Reset storage
if [[ "$KEEP_STORAGE" == "false" ]]; then
    echo -e "${GREEN}Resetting storage...${NC}"

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
        echo -e "${GREEN}✓ Storage reset complete (all files deleted)${NC}"
    fi
fi

if [[ "$DRY_RUN" == "false" ]]; then
    echo ""
    echo -e "${GREEN}✅ Reset complete!${NC}"
fi
