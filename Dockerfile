# Multi-stage Dockerfile for Kosarica Node.js Application
# Stage 1: Dependencies
FROM ubuntu:24.04 AS dependencies

# Avoid tzdata interactive prompts during apt installs.
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install Node.js 24 via NodeSource repository
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gpg \
    && rm -rf /var/lib/apt/lists/*

# Add NodeSource repository for Node.js 24
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Build
FROM ubuntu:24.04 AS build

# Avoid tzdata interactive prompts during apt installs.
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gpg \
        python3 \
        build-essential \
        git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 and pnpm in build stage
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g pnpm && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependencies and source
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Build arguments
ARG BUILD_TIME
ARG GIT_COMMIT
ARG BUILD_ENV=production
ARG APP_VERSION=0.1.0
ARG APP_RELEASE

# Set build environment variables
ENV BUILD_TIME=${BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_ENV=${BUILD_ENV}
ENV APP_VERSION=${APP_VERSION}
ENV APP_RELEASE=${APP_RELEASE}

# Build application
RUN pnpm build

# Keep client sourcemaps private while preserving server sourcemaps for Node symbolication.
RUN RELEASE_DIR="/app/sourcemaps/${APP_RELEASE:-${GIT_COMMIT}}" && \
    mkdir -p "$RELEASE_DIR/client" && \
    find /app/dist/client -type f -name "*.map" | \
      while IFS= read -r map_file; do \
        relative_path="${map_file#/app/dist/client/}"; \
        mkdir -p "$RELEASE_DIR/client/$(dirname "$relative_path")"; \
        mv "$map_file" "$RELEASE_DIR/client/$relative_path"; \
      done

# Stage 3: Runtime
FROM ubuntu:24.04 AS runtime

ARG BUILD_TIME
ARG GIT_COMMIT
ARG BUILD_ENV=production
ARG APP_VERSION=0.1.0
ARG APP_RELEASE

# Avoid tzdata interactive prompts during apt installs.
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gpg \
    && rm -rf /var/lib/apt/lists/*

# Add NodeSource repository for Node.js 24
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g pnpm && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r kosarica -g 1001 && \
    useradd -r -g kosarica -u 1001 -m -s /sbin/nologin kosarica

# Set working directory
WORKDIR /app

# Categorization prompt is loaded from disk at runtime.
COPY --from=build /app/docs/categorization/categorization-prompt.md ./docs/categorization/categorization-prompt.md

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/sourcemaps ./sourcemaps

# Operational tooling: include scripts + drizzle + source schema so we can run
# admin/maintenance tasks directly on staging (not production-optimized).
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./

# Include dev dependencies in runtime image so `npx tsx scripts/*.ts` and
# `drizzle-kit` migrations can run on staging.
COPY --from=dependencies /app/node_modules ./node_modules

# Create storage directory for logs and temporary files
RUN mkdir -p /app/logs && \
    chown -R kosarica:kosarica /app

# Switch to non-root user
USER kosarica

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info
ENV NODE_OPTIONS=--enable-source-maps
ENV BUILD_TIME=${BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_ENV=${BUILD_ENV}
ENV APP_VERSION=${APP_VERSION}
ENV APP_RELEASE=${APP_RELEASE}
ENV SOURCEMAP_STORAGE_PATH=/app/sourcemaps

# Start application
# 1. @opentelemetry/instrumentation/hook.mjs registers the ESM loader hook so that
#    instrumentation-http can patch `import http from 'node:http'` in ESM modules.
# 2. ./scripts/instrumentation.mjs initializes the OTel SDK before any app code.
CMD ["node", "--import", "@opentelemetry/instrumentation/hook.mjs", "--import", "./scripts/instrumentation.mjs", "scripts/start-server.mjs"]
