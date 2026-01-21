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
│                      Go Price Service                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   11 Chain  │  │   Basket    │  │  Product            │  │
│  │  Adapters   │  │  Optimizer  │  │  Matching           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌──────────┐
                    │PostgreSQL│
                    └──────────┘
```

## Quick Start

### Prerequisites

- Go 1.21+
- Node.js 20+
- PostgreSQL 15+
- pnpm

### Setup

```bash
# Clone and install
cp .env.example .env
pnpm install

# Setup database
pnpm db:migrate

# Run services (two terminals)
pnpm dev                                    # Terminal 1: Node.js
cd services/price-service && go run cmd/server/main.go  # Terminal 2: Go
```

Visit `http://localhost:3000` to access the application.

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](doc/planning/codebase/ARCHITECTURE.md) | System architecture, data flow, state machines |
| [STRUCTURE.md](doc/planning/codebase/STRUCTURE.md) | Directory layout and file organization |
| [STACK.md](doc/planning/codebase/STACK.md) | Technology stack and tooling |
| [INTEGRATIONS.md](doc/planning/codebase/INTEGRATIONS.md) | Go service integration and circuit breaker |
| [API.md](doc/planning/API.md) | Complete API endpoint reference |
| [DATABASE.md](doc/planning/DATABASE.md) | Schema authority and migration workflow |
| [DEPLOYMENT.md](doc/planning/DEPLOYMENT.md) | Deployment and operations runbooks |

## Supported Chains

Konzum, Lidl, Plodine, Interspar, Studenac, Kaufland, Eurospin, DM, KTC, Metro, Trgocentar

## License

MIT
