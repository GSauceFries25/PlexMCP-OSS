// PlexMCP Docker Bake Configuration
// Build multi-architecture images for linux/amd64 and linux/arm64
//
// Usage:
//   docker buildx bake                    # Build all targets
//   docker buildx bake api                # Build only API
//   docker buildx bake web                # Build only web
//   docker buildx bake --push             # Build and push to registry
//   VERSION=v1.0.0 docker buildx bake     # Build with specific version tag

// =============================================================================
// Variables
// =============================================================================

variable "REGISTRY" {
  default = "ghcr.io/plexmcp"
}

variable "VERSION" {
  default = "latest"
}

// =============================================================================
// Groups
// =============================================================================

group "default" {
  targets = ["api", "web"]
}

group "ci" {
  targets = ["api", "web"]
}

// =============================================================================
// Targets
// =============================================================================

target "api" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags = [
    "${REGISTRY}/plexmcp-api:${VERSION}",
    VERSION != "latest" ? "${REGISTRY}/plexmcp-api:latest" : "",
  ]
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
  labels = {
    "org.opencontainers.image.title"       = "PlexMCP API"
    "org.opencontainers.image.description" = "PlexMCP API Server - Unified MCP Gateway"
    "org.opencontainers.image.source"      = "https://github.com/plexmcp/plexmcp"
    "org.opencontainers.image.licenses"    = "FSL-1.1-Apache-2.0"
  }
}

target "web" {
  context    = "./web"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags = [
    "${REGISTRY}/plexmcp-web:${VERSION}",
    VERSION != "latest" ? "${REGISTRY}/plexmcp-web:latest" : "",
  ]
  cache-from = ["type=gha"]
  cache-to   = ["type=gha,mode=max"]
  labels = {
    "org.opencontainers.image.title"       = "PlexMCP Web"
    "org.opencontainers.image.description" = "PlexMCP Web Dashboard"
    "org.opencontainers.image.source"      = "https://github.com/plexmcp/plexmcp"
    "org.opencontainers.image.licenses"    = "FSL-1.1-Apache-2.0"
  }
}

// =============================================================================
// Development Targets (single architecture for faster local builds)
// =============================================================================

target "api-dev" {
  inherits  = ["api"]
  platforms = []  // Use native platform
  tags      = ["plexmcp-api:dev"]
  cache-from = ["type=local,src=/tmp/.buildx-cache"]
  cache-to   = ["type=local,dest=/tmp/.buildx-cache-new,mode=max"]
}

target "web-dev" {
  inherits  = ["web"]
  platforms = []  // Use native platform
  tags      = ["plexmcp-web:dev"]
  cache-from = ["type=local,src=/tmp/.buildx-cache"]
  cache-to   = ["type=local,dest=/tmp/.buildx-cache-new,mode=max"]
}

group "dev" {
  targets = ["api-dev", "web-dev"]
}
