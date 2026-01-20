# Multi-stage Dockerfile for Price Service
# Stage 1: Build
FROM golang:1.25-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

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
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X 'main.Version=1.0.0' -X 'main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)'" \
    -trimpath \
    -o price-service ./cmd/server

# Verify binary was created
RUN ./price-service --version || true

# Stage 2: Runtime
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    curl

# Create non-root user
RUN addgroup -g 1000 -S price-service && \
    adduser -u 1000 -S price-service -G price-service

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

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set default environment variables
ENV PORT=3000
ENV LOG_LEVEL=info
ENV STORAGE_PATH=/app/data/archives

# Run the binary
ENTRYPOINT ["/app/price-service"]
CMD []
