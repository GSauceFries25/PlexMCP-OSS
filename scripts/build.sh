#!/bin/bash
# PlexMCP Docker Build Script
# Usage: ./scripts/build.sh [OPTIONS]
#
# Options:
#   --platform PLATFORMS  Build for specific platforms (default: linux/arm64,linux/amd64)
#   --push                Push images to registry
#   --tag TAG            Tag for the images (default: dev)
#   --api-only           Build only the API image
#   --web-only           Build only the web image
#   --no-cache           Build without cache
#   -h, --help           Show this help message

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PLATFORMS="linux/arm64,linux/amd64"
TAG="dev"
PUSH=false
API_ONLY=false
WEB_ONLY=false
NO_CACHE=false
REGISTRY="${REGISTRY:-ghcr.io/plexmcp}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --platform)
            PLATFORMS="$2"
            shift 2
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --api-only)
            API_ONLY=true
            shift
            ;;
        --web-only)
            WEB_ONLY=true
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        -h|--help)
            head -17 "$0" | tail -15
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         PlexMCP Docker Build               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if ! docker buildx version &> /dev/null; then
    echo -e "${RED}Error: Docker Buildx is not available${NC}"
    exit 1
fi

# Create/use buildx builder for multi-platform builds
BUILDER_NAME="plexmcp-builder"
if ! docker buildx inspect "$BUILDER_NAME" &> /dev/null; then
    echo -e "${YELLOW}Creating buildx builder: $BUILDER_NAME${NC}"
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
fi
docker buildx use "$BUILDER_NAME"

# Build options
BUILD_OPTS="--platform $PLATFORMS"
if [ "$PUSH" = true ]; then
    BUILD_OPTS="$BUILD_OPTS --push"
else
    BUILD_OPTS="$BUILD_OPTS --load"
    # Can only load single platform locally
    if [[ "$PLATFORMS" == *","* ]]; then
        echo -e "${YELLOW}Warning: Multi-platform build without --push. Using native platform for local testing.${NC}"
        BUILD_OPTS="--load"
    fi
fi
if [ "$NO_CACHE" = true ]; then
    BUILD_OPTS="$BUILD_OPTS --no-cache"
fi

echo ""
echo -e "${GREEN}Build Configuration:${NC}"
echo "  Platforms: $PLATFORMS"
echo "  Tag: $TAG"
echo "  Push: $PUSH"
echo "  Registry: $REGISTRY"
echo ""

# Build API
if [ "$WEB_ONLY" = false ]; then
    echo -e "${BLUE}Building API image...${NC}"
    API_IMAGE="${REGISTRY}/plexmcp-api:${TAG}"

    time docker buildx build \
        $BUILD_OPTS \
        --tag "$API_IMAGE" \
        --file Dockerfile \
        --build-arg SQLX_OFFLINE=true \
        .

    echo -e "${GREEN}✓ API image built: $API_IMAGE${NC}"
    echo ""
fi

# Build Web
if [ "$API_ONLY" = false ]; then
    echo -e "${BLUE}Building Web image...${NC}"
    WEB_IMAGE="${REGISTRY}/plexmcp-web:${TAG}"

    time docker buildx build \
        $BUILD_OPTS \
        --tag "$WEB_IMAGE" \
        --file web/Dockerfile \
        ./web

    echo -e "${GREEN}✓ Web image built: $WEB_IMAGE${NC}"
    echo ""
fi

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Build Complete!                 ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"

if [ "$PUSH" = false ]; then
    echo ""
    echo "To test locally:"
    echo "  docker compose --profile dev up -d"
    echo ""
    echo "To push to registry:"
    echo "  ./scripts/build.sh --push --tag $TAG"
fi
