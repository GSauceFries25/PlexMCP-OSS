#!/bin/bash
# PlexMCP Health Check Script
# Verifies all services are running and healthy
#
# Usage: ./scripts/health-check.sh [OPTIONS]
#
# Options:
#   --api-url URL     API URL to check (default: http://localhost:8080)
#   --web-url URL     Web URL to check (default: http://localhost:3000)
#   --timeout SECS    Timeout in seconds (default: 60)
#   --verbose         Show detailed output
#   -h, --help        Show this help message

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
API_URL="${API_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
TIMEOUT=60
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --web-url)
            WEB_URL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            head -16 "$0" | tail -14
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       PlexMCP Health Check                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Function to check endpoint
check_endpoint() {
    local name=$1
    local url=$2
    local max_attempts=$((TIMEOUT / 5))
    local attempt=1

    echo -e "${YELLOW}Checking $name at $url...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if [ "$VERBOSE" = true ]; then
            echo "  Attempt $attempt/$max_attempts"
        fi

        response=$(curl -sf -w "%{http_code}" -o /tmp/health_response.json "$url" 2>/dev/null || echo "000")

        if [ "$response" = "200" ]; then
            echo -e "${GREEN}  ✓ $name is healthy${NC}"
            if [ "$VERBOSE" = true ]; then
                echo "  Response:"
                cat /tmp/health_response.json | head -5
            fi
            return 0
        fi

        if [ "$VERBOSE" = true ]; then
            echo "  HTTP Status: $response"
        fi

        sleep 5
        ((attempt++))
    done

    echo -e "${RED}  ✗ $name is not responding${NC}"
    return 1
}

# Track failures
FAILURES=0

# Check API health
if ! check_endpoint "API Server" "${API_URL}/health"; then
    ((FAILURES++))
fi

echo ""

# Check Web health
if ! check_endpoint "Web Dashboard" "${WEB_URL}/api/health"; then
    ((FAILURES++))
fi

echo ""

# Check Docker containers (if Docker is available)
if command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker Container Status:${NC}"

    containers=$(docker ps --filter "name=plexmcp" --format "{{.Names}}\t{{.Status}}" 2>/dev/null || echo "")

    if [ -n "$containers" ]; then
        while IFS=$'\t' read -r name status; do
            if [[ "$status" == *"healthy"* ]]; then
                echo -e "  ${GREEN}✓${NC} $name: $status"
            elif [[ "$status" == *"unhealthy"* ]]; then
                echo -e "  ${RED}✗${NC} $name: $status"
                ((FAILURES++))
            else
                echo -e "  ${YELLOW}○${NC} $name: $status"
            fi
        done <<< "$containers"
    else
        echo "  No PlexMCP containers found"
    fi
    echo ""
fi

# Summary
echo -e "${BLUE}════════════════════════════════════════════${NC}"
if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}All health checks passed!${NC}"
    exit 0
else
    echo -e "${RED}$FAILURES health check(s) failed${NC}"
    exit 1
fi
