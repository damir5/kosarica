# Technology Stack

## Primary Language
- **TypeScript** (ES2022 target)
- Strict mode enabled with noUnusedLocals/Parameters

## Runtime & Deployment
- **Cloudflare Workers** - Edge runtime for SSR and API routes
- **Vite 7** - Build tool and dev server
- **Node.js** - Local development (mise.toml for version management)

## Frontend Framework
- **React 19** with react-dom
- **TanStack Start** - Full-stack framework with SSR
- **TanStack Router** - File-based routing (`src/routes/`)
- **TanStack Query** - Server state management
- **TanStack Table** - Data table components

## Styling
- **Tailwind CSS 4** with `@tailwindcss/vite` plugin
- **tw-animate-css** - Animation utilities
- **Radix UI** - Unstyled accessible components (dialog, dropdown-menu, select, slot, switch)
- **shadcn/ui** - Component patterns (via `components.json`)
- **lucide-react** - Icon library
- **class-variance-authority** + **clsx** + **tailwind-merge** - Class utilities

## Backend / API
- **oRPC** - Type-safe RPC framework (`@orpc/server`, `@orpc/client`, `@orpc/tanstack-query`)
- **Better Auth** - Authentication with passkey support
- **Drizzle ORM** - SQL database toolkit

## Database
- **Cloudflare D1** - SQLite at the edge
- **Drizzle Kit** - Schema migrations (`drizzle/` directory)

## Storage & Queues
- **Cloudflare R2** - Object storage (`INGESTION_BUCKET`)
- **Cloudflare Queues** - Async job processing (`INGESTION_QUEUE`)

## Data Processing
- **xlsx** - Excel file parsing
- **fast-xml-parser** - XML parsing
- **fflate** - Compression (zip handling)
- **iconv-lite** - Character encoding conversion

## Validation
- **Zod 4** - Schema validation (via `@orpc/zod`)

## Dev Dependencies
- **Biome 2.2** - Linting and formatting
- **Vitest 3** - Unit testing
- **Testing Library** - React component testing
- **tsx** - TypeScript execution
- **wrangler** - Cloudflare CLI
