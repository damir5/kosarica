# Kosarica

Grocery price comparison platform for Croatian retail chains.

## Overview

Kosarica aggregates pricing data from 11 major Croatian retail chains, normalizes it, and provides price transparency tools for consumers. The platform includes:

- **Automatic ingestion** of daily price files from retail chain portals
- **Store enrichment workflow** for new store approval and management
- **Product matching** across retailers using barcode lookup
- **Basket optimization** to find the best combination of stores for a shopping list
- **Price history** tracking with 30-day low prices

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Node.js Frontend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  TanStack   │  │   oRPC      │  │  Better Auth        │  │
│  │  Start SSR  │  │   API       │  │  (Passkey support)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Service (unified)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Ingestion   │  │  Basket     │  │  Product            │  │
│  │ Pipeline    │  │ Optimizer   │  │  Matching           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
               │                          │
               ▼                          ▼
        ┌──────────┐                ┌──────────┐
        │PostgreSQL│                │ClickHouse│
        └──────────┘                └──────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for services)
- pnpm
- [mise](https://mise.jdx.dev/) (recommended, for task runners)

### Setup

```bash
# Clone and install
cp .env.example .env
pnpm install

# Start dev services (PostgreSQL + ClickHouse)
mise run services-up

# Setup database
pnpm db:migrate

# Run service
pnpm dev
```

Background worker runs in-process with the app.

Visit `http://localhost:3000` to access the application.

### Service Management

```bash
mise run services-up      # Start dev services
mise run services-down    # Stop dev services
mise run services-status  # Check status
mise run services-logs    # View logs
mise run services-reset   # Reset with fresh data
```

## Testing

### Run All Tests (CI Mode)

```bash
mise run test-ci
```

Automatically starts test containers, runs migrations, executes tests, and cleans up.

### Run Tests with Dev Services

```bash
# Ensure dev services are running
mise run services-up

# Run tests
mise run test-all
```

### Test Commands

| Command | Description |
|---------|-------------|
| `mise run test-ci` | Full CI mode (auto-manages containers) |
| `mise run test-all` | All tests (requires services running) |
| `mise run test-node-unit` | Unit tests only (no services needed) |

Run `mise run test` for all available test commands.

## Documentation

| Document | Description |
|----------|-------------|
| [Documentation Index](docs/README.md) | Entry point for all docs sections |
| [Roadmap](docs/product/roadmap.md) | Product priorities and milestones |
| [ARCHITECTURE.md](docs/architecture/codebase/ARCHITECTURE.md) | System architecture, data flow, state machines |
| [STRUCTURE.md](docs/architecture/codebase/STRUCTURE.md) | Directory layout and file organization |
| [STACK.md](docs/architecture/codebase/STACK.md) | Technology stack and tooling |
| [INTEGRATIONS.md](docs/architecture/codebase/INTEGRATIONS.md) | Go service integration and circuit breaker |
| [API.md](docs/architecture/API.md) | Complete API endpoint reference |
| [DATABASE.md](docs/architecture/DATABASE.md) | Schema authority and migration workflow |
| [DEPLOYMENT.md](docs/architecture/DEPLOYMENT.md) | Deployment and operations runbooks |
| [LIMITED-PROD-CHECKLIST.md](docs/architecture/LIMITED-PROD-CHECKLIST.md) | Limited-production server + secrets checklist |
| [RELEASE-AND-SOURCEMAPS.md](docs/architecture/RELEASE-AND-SOURCEMAPS.md) | Release metadata, sourcemap policy, blue/green runbook |
| [AI Ingestion Testing Playbook](docs/ai/testing-ingestion.md) | Repeatable AI-driven ingestion testing workflow |

## Supported Chains

Konzum, Lidl, Plodine, Interspar, Studenac, Kaufland, Eurospin, DM, KTC, Metro, Trgocentar

## License

MIT
