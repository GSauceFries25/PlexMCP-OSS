# syntax=docker/dockerfile:1
# PlexMCP API Dockerfile
# Multi-stage build with mold linker for fast cross-platform builds
# Supports: linux/amd64, linux/arm64

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM --platform=$BUILDPLATFORM rust:1.92-slim-bookworm AS builder

# Install build dependencies including mold linker (5-10x faster than GNU ld)
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    mold \
    clang \
    && rm -rf /var/lib/apt/lists/*

# Configure mold as the linker for dramatically faster link times
ENV RUSTFLAGS="-C link-arg=-fuse-ld=mold"

WORKDIR /app

# Copy manifests first for better dependency caching
COPY Cargo.toml Cargo.lock ./
COPY crates/api/Cargo.toml crates/api/
COPY crates/billing/Cargo.toml crates/billing/
COPY crates/shared/Cargo.toml crates/shared/
COPY crates/worker/Cargo.toml crates/worker/

# Create dummy files for initial dependency build
RUN mkdir -p crates/api/src crates/billing/src crates/shared/src crates/worker/src \
    && echo "fn main() {}" > crates/api/src/main.rs \
    && echo "" > crates/billing/src/lib.rs \
    && echo "" > crates/shared/src/lib.rs \
    && echo "fn main() {}" > crates/worker/src/main.rs

# Build dependencies only with BuildKit cache mounts
# This dramatically speeds up rebuilds when only source code changes
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --profile docker --package plexmcp-api --package plexmcp-worker || true

# Remove dummy source files
RUN rm -rf crates/*/src

# Copy actual source code
COPY crates/ crates/
COPY migrations/ migrations/

# Copy SQLx query cache for offline mode (required for builds without DB access)
COPY .sqlx .sqlx
ENV SQLX_OFFLINE=true

# Build the actual applications with cache mounts
# Uses the 'docker' profile which has thin LTO for faster builds
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    touch crates/api/src/main.rs crates/billing/src/lib.rs crates/shared/src/lib.rs crates/worker/src/main.rs && \
    cargo build --profile docker --package plexmcp-api --package plexmcp-worker && \
    # Copy binaries out of the cache mount (they'd be lost otherwise)
    cp /app/target/docker/plexmcp-api /app/plexmcp-api && \
    cp /app/target/docker/plexmcp-worker /app/plexmcp-worker

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
# - ca-certificates: for HTTPS connections
# - libssl3: for OpenSSL
# - curl: for healthchecks
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binaries from builder
COPY --from=builder /app/plexmcp-api /app/plexmcp-api
COPY --from=builder /app/plexmcp-worker /app/plexmcp-worker

# Create non-root user for security
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appuser /app

USER appuser

# Environment configuration
ENV HOST=0.0.0.0
ENV PORT=8080
ENV RUST_LOG=info,plexmcp_api=debug

EXPOSE 8080

# Healthcheck using curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Default command - run the API server
CMD ["/app/plexmcp-api"]
