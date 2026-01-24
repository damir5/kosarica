# Multi-stage Dockerfile for Price Service
# Stage 1: Build
FROM ubuntu:24.04 AS builder

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies and Go
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        tzdata \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Install Go 1.25 (matching go.mod)
RUN wget -q https://go.dev/dl/go1.25.0.linux-amd64.tar.gz -O /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz

# Set Go environment
ENV PATH=/usr/local/go/bin:$PATH
ENV GOPATH=/go
ENV GOBIN=/go/bin

# Set working directory
WORKDIR /build

# Copy go mod files first (for layer caching)
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the server binary
# -w -s flags reduce binary size by removing debug info
# -trimpath removes file system paths from binary
ARG BUILD_TIME
ARG GIT_COMMIT
ARG VERSION=1.0.0

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X 'main.Version=${VERSION}' -X 'main.BuildTime=${BUILD_TIME}' -X 'main.GitCommit=${GIT_COMMIT}'" \
    -trimpath \
    -o price-service ./cmd/server

# Verify binary was created
RUN ./price-service --version || true

# Stage 2: Runtime
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        tzdata \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r price-service -g 1000 && \
    useradd -r -g price-service -u 1000 -m -s /sbin/nologin price-service

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/price-service .

# Copy config files
COPY --from=builder /build/config ./config

# Create storage directory
RUN mkdir -p /app/data/archives && \
    chown -R price-service:price-service /app

# Switch to non-root user
USER price-service

# Expose port (changed from 3000 to 8080 to match plan)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Set default environment variables
ENV PORT=8080
ENV LOG_LEVEL=info
ENV STORAGE_PATH=/app/data/archives

# Run the binary
ENTRYPOINT ["/app/price-service"]
CMD []
