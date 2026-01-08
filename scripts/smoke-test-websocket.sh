#!/bin/bash

# Real-Time Support WebSocket - Smoke Test
# Tests basic WebSocket functionality

set -e

echo "🧪 WebSocket Smoke Test"
echo "======================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

test_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Test 1: Backend compiles
echo "Test 1: Backend Compilation"
if cargo build --lib --quiet 2>/dev/null; then
    test_pass "Backend compiles successfully"
else
    test_fail "Backend compilation failed"
fi
echo ""

# Test 2: WebSocket unit tests
echo "Test 2: WebSocket Unit Tests"
if cargo test --lib websocket --quiet 2>/dev/null; then
    test_pass "WebSocket unit tests pass"
else
    test_fail "WebSocket unit tests failed"
fi
echo ""

# Test 3: Frontend builds
echo "Test 3: Frontend Build"
cd web
if npm run build --quiet >/dev/null 2>&1; then
    test_pass "Frontend builds successfully"
else
    test_fail "Frontend build failed"
fi
cd ..
echo ""

# Test 4: Migration file exists
echo "Test 4: Database Migration"
if [ -f "migrations/20251225000001_realtime_support.sql" ]; then
    test_pass "Real-time support migration exists"
else
    test_fail "Migration file not found"
fi
echo ""

# Test 5: WebSocket module files exist
echo "Test 5: WebSocket Module Files"
FILES=(
    "crates/api/src/websocket/mod.rs"
    "crates/api/src/websocket/events.rs"
    "crates/api/src/websocket/connection.rs"
    "crates/api/src/websocket/room.rs"
    "crates/api/src/websocket/state.rs"
    "crates/api/src/websocket/handler.rs"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        test_pass "$file exists"
    else
        test_fail "$file missing"
    fi
done
echo ""

# Test 6: Frontend WebSocket files exist
echo "Test 6: Frontend WebSocket Files"
FRONTEND_FILES=(
    "web/src/lib/websocket/manager.ts"
    "web/src/lib/websocket/hooks.ts"
)

for file in "${FRONTEND_FILES[@]}"; do
    if [ -f "$file" ]; then
        test_pass "$file exists"
    else
        test_fail "$file missing"
    fi
done
echo ""

# Test 7: Broadcasting integration
echo "Test 7: Broadcasting Integration"
if grep -q "ws_state.rooms.broadcast" crates/api/src/routes/support.rs; then
    test_pass "Broadcasting integrated in support handlers"
else
    test_fail "Broadcasting not found in support handlers"
fi
echo ""

# Test 8: WebSocket route registered
echo "Test 8: WebSocket Route Registration"
if grep -q "ws_handler" crates/api/src/routes/mod.rs; then
    test_pass "WebSocket route registered"
else
    test_fail "WebSocket route not registered"
fi
echo ""

# Test 9: Admin page WebSocket integration
echo "Test 9: Admin Page Integration"
if grep -q "useWebSocket" web/src/app/\(dashboard\)/admin/support/page.tsx; then
    test_pass "Admin page has WebSocket integration"
else
    test_fail "Admin page missing WebSocket integration"
fi
echo ""

# Test 10: User ticket page WebSocket integration
echo "Test 10: User Ticket Page Integration"
if grep -q "useTypingIndicator" web/src/app/\(dashboard\)/support/\[ticketId\]/page.tsx; then
    test_pass "User ticket page has typing indicators"
else
    test_fail "User ticket page missing typing indicators"
fi
echo ""

# Summary
echo "======================="
echo "Test Results:"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed! WebSocket implementation ready.${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review.${NC}"
    exit 1
fi
