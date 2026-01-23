#!/bin/bash
set -euo pipefail

#############################################
# OrbStack Ubuntu VM Installation Test Script
# Automates full Kosarica installation on fresh Ubuntu
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

# Repository path (use current directory if not specified)
REPO_PATH="${1:-$(pwd)}"
cd "$REPO_PATH" || {
    log_error "Failed to change directory to: $REPO_PATH"
    exit 1
}

log_info "Installing Kosarica in: $REPO_PATH"

#############################################
# 1. System Update & Prerequisites
#############################################
log_step "Step 1/10: Updating system and installing prerequisites..."

if [ ! -f /tmp/apt-updated ]; then
    sudo apt-get update -y
    sudo apt-get install -y curl git ca-certificates gnupg lsb-release
    touch /tmp/apt-updated
    log_info "System updated and prerequisites installed"
else
    log_info "Prerequisites already installed, skipping..."
fi

#############################################
# 2. Install Docker
#############################################
log_step "Step 2/10: Installing Docker..."

if ! command -v docker &> /dev/null; then
    # Add Docker's official GPG key
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Enable and start Docker
    sudo systemctl enable docker
    sudo systemctl start docker

    # Add user to docker group (requires re-login for effect)
    if ! groups "$USER" | grep -q docker; then
        sudo usermod -aG docker "$USER"
        log_warn "Added $USER to docker group. Log out and back in for this to take effect."
        log_warn "For now, running Docker with sudo..."
    fi

    log_info "Docker installed successfully"
else
    log_info "Docker already installed, skipping..."
fi

# Allow current user to use docker without sudo for this session
if groups "$USER" | grep -q docker; then
    DOCKER_CMD="docker"
else
    DOCKER_CMD="sudo docker"
fi

#############################################
# 3. Install mise
#############################################
log_step "Step 3/10: Installing mise..."

if ! command -v mise &> /dev/null; then
    curl https://mise.run | MISE_INSTALL=~/.local/bin sh
    export PATH="$HOME/.local/bin:$PATH"

    # Add mise to .bashrc if not already present
    if ! grep -q 'mise activate bash' ~/.bashrc 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
        echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
        log_info "Added mise to ~/.bashrc"
    fi

    log_info "mise installed successfully"
else
    log_info "mise already installed, skipping..."
fi

# Set PATH for this session
export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"

#############################################
# 4. Install pnpm
#############################################
log_step "Step 4/10: Installing pnpm..."

if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm || {
        # Fallback: standalone installer
        curl -fsSL https://get.pnpm.io/install.sh | sh -
        export PNPM_HOME="$HOME/.local/share/pnpm"
        export PATH="$PNPM_HOME:$PATH"
    }
    log_info "pnpm installed successfully"
else
    log_info "pnpm already installed, skipping..."
fi

#############################################
# 5. Verify Repository
#############################################
log_step "Step 5/10: Verifying repository..."

if [ ! -f "$REPO_PATH/package.json" ]; then
    log_error "package.json not found in $REPO_PATH. Is this a valid Kosarica repository?"
    exit 1
fi

if [ ! -f "$REPO_PATH/docker-compose.yml" ]; then
    log_error "docker-compose.yml not found in $REPO_PATH"
    exit 1
fi

log_info "Repository verified"

#############################################
# 6. Setup Environment Variables
#############################################
log_step "Step 6/10: Setting up environment variables..."

ENV_FILE="$REPO_PATH/.env"

if [ -f "$ENV_FILE" ]; then
    log_warn ".env file already exists. Backing up to .env.backup..."
    cp "$ENV_FILE" "$ENV_FILE.backup"
fi

# Generate secure random values
generate_secret() {
    openssl rand -hex 32 2>/dev/null || tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w 32 | head -n 1
}

BETTER_AUTH_SECRET=$(generate_secret)
INTERNAL_API_KEY=$(generate_secret)
DB_PASSWORD=$(generate_secret)

cat > "$ENV_FILE" << EOF
# Database
DATABASE_URL=postgresql://kosarica:${DB_PASSWORD}@localhost:5432/kosarica
TEST_DATABASE_URL=postgresql://kosarica:${DB_PASSWORD}@localhost:5432/kosarica_test

# Storage
STORAGE_PATH=./data/storage

# Authentication
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=http://localhost:3000

# Passkey Configuration
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=Kosarica App

# Logging
LOG_LEVEL=info

# Ingestion - comma-separated chain IDs to process on scheduled runs
INGESTION_CHAINS=

# Go Service Configuration
GO_SERVICE_URL=http://localhost:8080

# Internal API Key for service-to-service authentication
INTERNAL_API_KEY=${INTERNAL_API_KEY}
EOF

log_info "Environment file created at $ENV_FILE"
log_warn "Generated secrets (keep secure!):"
log_warn "  BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:0:8}..."
log_warn "  INTERNAL_API_KEY: ${INTERNAL_API_KEY:0:8}..."
log_warn "  DB_PASSWORD: ${DB_PASSWORD:0:8}..."

#############################################
# 7. Start Docker Services
#############################################
log_step "Step 7/10: Starting Docker services..."

# Stop any existing containers
$DOCKER_CMD compose down -v 2>/dev/null || true

# Start services
$DOCKER_CMD compose up -d

log_info "Waiting for PostgreSQL to be healthy..."

# Wait for PostgreSQL to be healthy
MAX_WAIT=60
WAIT_TIME=0
while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    if $DOCKER_CMD exec kosarica-postgres-dev pg_isready -U kosarica &>/dev/null; then
        log_info "PostgreSQL is ready!"
        break
    fi
    sleep 2
    WAIT_TIME=$((WAIT_TIME + 2))
    echo -n "."
done

if [ $WAIT_TIME -ge $MAX_WAIT ]; then
    log_error "PostgreSQL did not become ready in time"
    $DOCKER_CMD logs kosarica-postgres-dev
    exit 1
fi

# Check containers are running
log_info "Checking container status..."
$DOCKER_CMD compose ps

#############################################
# 8. Install Dependencies
#############################################
log_step "Step 8/10: Installing project dependencies..."

# Install Node.js dependencies
if [ ! -d "$REPO_PATH/node_modules" ]; then
    log_info "Installing Node.js dependencies with pnpm..."
    pnpm install
else
    log_info "Node.js dependencies already installed, skipping..."
fi

# Install Go dependencies
if [ -d "$REPO_PATH/services/price-service" ] && [ -f "$REPO_PATH/services/price-service/go.mod" ]; then
    log_info "Installing Go dependencies..."
    cd "$REPO_PATH/services/price-service"
    go mod download
    cd "$REPO_PATH"
else
    log_warn "Go service not found or no go.mod, skipping Go dependency installation"
fi

#############################################
# 9. Database Migration
#############################################
log_step "Step 9/10: Running database migrations..."

cd "$REPO_PATH"
pnpm db:migrate

log_info "Database migrations completed"

#############################################
# 10. Verify Installation
#############################################
log_step "Step 10/10: Verifying installation..."

log_info "Running verification script..."
"$REPO_PATH/scripts/orbstack-verify.sh"

#############################################
# Summary
#############################################
echo ""
log_info "============================================"
log_info "Installation completed successfully!"
log_info "============================================"
echo ""
log_info "Access URLs:"
echo "  - Go Price Service:  http://localhost:8080"
echo "  - Node.js App:       http://localhost:3000 (requires 'pnpm dev')"
echo "  - PostgreSQL:        localhost:5432"
echo ""
log_info "Useful commands:"
echo "  - View logs:         docker compose logs -f"
echo "  - Stop services:     docker compose down"
echo "  - Restart services:  docker compose restart"
echo "  - Start dev server:  pnpm dev"
echo ""
log_info "To start the Node.js development server:"
echo "  pnpm dev"
echo ""
log_warn "Note: If you just added the docker group, log out and back in for"
log_warn "      it to take effect. Otherwise use 'sudo docker' commands."
echo ""
