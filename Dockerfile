# Multi-stage Dockerfile for Kosarica Node.js Application
# Stage 1: Dependencies
FROM ubuntu:24.04 AS dependencies

# Install Node.js 24 via NodeSource repository
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
    && rm -rf /var/lib/apt/lists/*

# Add NodeSource repository for Node.js 24
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repokey.gpg | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
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

# Copy Node.js and pnpm from dependencies stage
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=dependencies /usr/local/bin/pnpm /usr/local/bin/pnpm
COPY --from=dependencies /usr/local/bin/npm /usr/local/bin/npm
COPY --from=dependencies /usr/local/bin/npx /usr/local/bin/npx

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependencies and source
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Build arguments
ARG BUILD_TIME
ARG GIT_COMMIT
ARG BUILD_ENV=production

# Set build environment variables
ENV BUILD_TIME=${BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_ENV=${BUILD_ENV}

# Build application
RUN pnpm build

# Stage 3: Runtime
FROM ubuntu:24.04 AS runtime

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
    && rm -rf /var/lib/apt/lists/*

# Add NodeSource repository for Node.js 24
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repokey.gpg | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
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

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./

# Install production dependencies only using pnpm for consistency
RUN pnpm install --frozen-lockfile --prod && \
    pnpm store prune

# Create storage directory for logs and temporary files
RUN mkdir -p /app/logs && \
    chown -R kosarica:kosarica /app

# Switch to non-root user
USER kosarica

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info

# Start application
CMD ["node", "dist/server/index.js"]
