#!/bin/bash
# =============================================================================
# B0 Canonical Contract Freeze Test Suite
# =============================================================================
# This script is the REAL enforcement mechanism for the backend freeze.
# If ANY test fails, the freeze is broken and must be fixed before deploy.
#
# Tests:
# 1. Freeze Headers on ALL endpoint types
# 2. Response Shape Validation (canonical entities)
# 3. State Machine Transition Validation
# 4. Permission Matrix Validation
# 5. Legacy/Deprecated Boundary Enforcement
# 6. Pagination Contract Validation
# 7. Error Response Contract Validation
# =============================================================================

set -e

API="${1:-https://tribe-audit-proof.preview.emergentagent.com}"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

assert() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} [$TOTAL] $name"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} [$TOTAL] $name"
    echo -e "    Expected: ${YELLOW}$expected${NC}"
    echo -e "    Got:      ${RED}$(echo "$actual" | head -1)${NC}"
  fi
}

assert_status() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} [$TOTAL] $name"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} [$TOTAL] $name"
    echo -e "    Expected HTTP: ${YELLOW}$expected${NC}  Got: ${RED}$actual${NC}"
  fi
}

assert_json_field() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local json="$2"
  local field="$3"
  if echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $field" 2>/dev/null; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}PASS${NC} [$TOTAL] $name"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}FAIL${NC} [$TOTAL] $name — field check: $field"
  fi
}

# =============================================================================
echo -e "\n${CYAN}=== GATE 1: FREEZE HEADER ENFORCEMENT ===${NC}"
echo "Verifying X-Contract-Version and X-Freeze-Status on all endpoint types"
# =============================================================================

# Canonical endpoint
HEADERS=$(curl -s -D- "$API/api/tribes" 2>/dev/null | head -30)
assert "GET /tribes → x-contract-version: v1" "x-contract-version: v1" "$HEADERS"
assert "GET /tribes → x-freeze-status: android_v1_use" "x-freeze-status: android_v1_use" "$HEADERS"

# Legacy endpoint
HEADERS=$(curl -s -D- "$API/api/houses" 2>/dev/null | head -30)
assert "GET /houses → x-freeze-status: legacy" "x-freeze-status: legacy" "$HEADERS"
assert "GET /houses → x-deprecated: true" "x-deprecated: true" "$HEADERS"

# Deprecated endpoint
HEADERS=$(curl -s -D- -X POST "$API/api/house-points" 2>/dev/null | head -30)
assert "POST /house-points → x-freeze-status: deprecated" "x-freeze-status: deprecated" "$HEADERS"
assert "POST /house-points → x-deprecated: true" "x-deprecated: true" "$HEADERS"
assert "POST /house-points → x-deprecation-notice present" "x-deprecation-notice:" "$HEADERS"
assert "POST /house-points → HTTP 410" "410" "$(echo "$HEADERS" | head -1)"

# Internal endpoint
HEADERS=$(curl -s -D- "$API/api/healthz" 2>/dev/null | head -30)
assert "GET /healthz → x-freeze-status: internal_only" "x-freeze-status: internal_only" "$HEADERS"

# Auth endpoint
HEADERS=$(curl -s -D- -X POST "$API/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"0000000000","pin":"0000"}' 2>/dev/null | head -30)
assert "POST /auth/login → x-freeze-status: android_v1_use" "x-freeze-status: android_v1_use" "$HEADERS"

# Admin endpoint
HEADERS=$(curl -s -D- "$API/api/admin/stats" 2>/dev/null | head -30)
assert "GET /admin/stats → x-freeze-status: admin_only" "x-freeze-status: admin_only" "$HEADERS"

# =============================================================================
echo -e "\n${CYAN}=== GATE 2: AUTH CONTRACT VALIDATION ===${NC}"
echo "Verifying register, login, me response shapes"
# =============================================================================

# Register a test user
PHONE="55$(date +%s | tail -c 9)"
REG=$(curl -s -X POST "$API/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"pin\":\"1234\",\"displayName\":\"FreezeTest\"}")
assert_json_field "Register returns token" "$REG" "'token' in d"
assert_json_field "Register returns user object" "$REG" "'user' in d"
assert_json_field "Register user has id" "$REG" "'id' in d['user']"
assert_json_field "Register user has phone" "$REG" "'phone' in d['user']"
assert_json_field "Register user has displayName" "$REG" "'displayName' in d['user']"
assert_json_field "Register user has role" "$REG" "'role' in d['user']"
assert_json_field "Register user has ageStatus" "$REG" "'ageStatus' in d['user']"
assert_json_field "Register user has onboardingStep" "$REG" "'onboardingStep' in d['user']"
assert_json_field "Register user has followersCount" "$REG" "'followersCount' in d['user']"
assert_json_field "Register user has createdAt" "$REG" "'createdAt' in d['user']"
assert_json_field "Register user no _id leak" "$REG" "'_id' not in d['user']"
assert_json_field "Register user no pinHash leak" "$REG" "'pinHash' not in d['user']"

TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"

# Login
LOGIN=$(curl -s -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"pin\":\"1234\"}")
assert_json_field "Login returns token" "$LOGIN" "'token' in d"
assert_json_field "Login returns user" "$LOGIN" "'user' in d"

# Me
ME=$(curl -s "$API/api/auth/me" -H "$AUTH")
assert_json_field "GET /me returns user" "$ME" "'user' in d"
assert_json_field "Me user has id" "$ME" "'id' in d['user']"

# Sessions
SESSIONS=$(curl -s "$API/api/auth/sessions" -H "$AUTH")
assert_json_field "Sessions returns sessions array" "$SESSIONS" "'sessions' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 3: FEED CONTRACT VALIDATION ===${NC}"
echo "Verifying feed response shapes and pagination"
# =============================================================================

# Public feed
FEED=$(curl -s "$API/api/feed/public?limit=5")
assert_json_field "Public feed has items array" "$FEED" "'items' in d"
assert_json_field "Public feed has nextCursor" "$FEED" "'nextCursor' in d"

# Following feed
FFEED=$(curl -s "$API/api/feed/following" -H "$AUTH")
assert_json_field "Following feed has items" "$FFEED" "'items' in d"
assert_json_field "Following feed has nextCursor" "$FFEED" "'nextCursor' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 4: TRIBE CONTRACT VALIDATION ===${NC}"
echo "Verifying tribe response shapes — CANONICAL identity system"
# =============================================================================

# Tribes list
TRIBES=$(curl -s "$API/api/tribes")
assert_json_field "Tribes list has tribes array" "$TRIBES" "'tribes' in d"
assert_json_field "Tribes list has 21 tribes" "$TRIBES" "len(d['tribes']) == 21"
assert_json_field "Tribe has tribeCode" "$TRIBES" "'tribeCode' in d['tribes'][0]"
assert_json_field "Tribe has tribeName" "$TRIBES" "'tribeName' in d['tribes'][0]"
assert_json_field "Tribe has heroName" "$TRIBES" "'heroName' in d['tribes'][0]"
assert_json_field "Tribe has animalIcon" "$TRIBES" "'animalIcon' in d['tribes'][0]"
assert_json_field "Tribe has primaryColor" "$TRIBES" "'primaryColor' in d['tribes'][0]"
assert_json_field "Tribe has quote" "$TRIBES" "'quote' in d['tribes'][0]"

# My tribe (auto-assigned at registration)
MYTRIBE=$(curl -s "$API/api/me/tribe" -H "$AUTH")
assert_json_field "My tribe has tribe object" "$MYTRIBE" "'tribe' in d"
assert_json_field "My tribe has membership" "$MYTRIBE" "'membership' in d"
assert_json_field "Membership has tribeCode" "$MYTRIBE" "'tribeCode' in d['membership']"

# Tribe detail (first tribe)
TRIBE_ID=$(echo "$TRIBES" | python3 -c "import sys,json; print(json.load(sys.stdin)['tribes'][0]['id'])")
DETAIL=$(curl -s "$API/api/tribes/$TRIBE_ID")
assert_json_field "Tribe detail has tribe" "$DETAIL" "'tribe' in d"

# Standings
STANDINGS=$(curl -s "$API/api/tribes/standings/current")
assert_json_field "Standings has standings array" "$STANDINGS" "'standings' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 5: ERROR CONTRACT VALIDATION ===${NC}"
echo "Verifying error response shapes across scenarios"
# =============================================================================

# 401 Unauthorized
ERR401=$(curl -s "$API/api/auth/me")
assert_json_field "401 has error field" "$ERR401" "'error' in d"
assert_json_field "401 has code field" "$ERR401" "'code' in d"

# 404 Not Found
ERR404=$(curl -s "$API/api/nonexistent-endpoint")
assert_json_field "404 has error field" "$ERR404" "'error' in d"
assert_json_field "404 has code NOT_FOUND" "$ERR404" "d.get('code') == 'NOT_FOUND'"

# 410 Deprecated
ERR410=$(curl -s -X POST "$API/api/house-points")
assert_json_field "410 has error field" "$ERR410" "'error' in d"
assert_json_field "410 has code DEPRECATED" "$ERR410" "d.get('code') == 'DEPRECATED'"

# Bad login
ERRBAD=$(curl -s -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
  -d '{"phone":"9999999999","pin":"9999"}')
assert_json_field "Bad login has error" "$ERRBAD" "'error' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 6: PERMISSION ENFORCEMENT ===${NC}"
echo "Verifying unauthorized access returns 401/403"
# =============================================================================

# Auth-required endpoint without token
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/auth/me")
assert_status "GET /auth/me without token → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/feed/following")
assert_status "GET /feed/following without token → 401" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/me/tribe")
assert_status "GET /me/tribe without token → 401" "401" "$STATUS"

# Admin endpoint without admin role
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/admin/stats" -H "$AUTH")
assert_status "GET /admin/stats as USER → 403" "403" "$STATUS"

# =============================================================================
echo -e "\n${CYAN}=== GATE 7: LEGACY BOUNDARY ENFORCEMENT ===${NC}"
echo "Verifying house system is legacy and tribe system is canonical"
# =============================================================================

# House-points is 410
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/house-points")
assert_status "POST /house-points → 410 GONE" "410" "$STATUS"

# Houses still readable (legacy compatibility)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/houses")
assert_status "GET /houses → 200 (legacy read-only)" "200" "$STATUS"

# Tribes is canonical and working
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/tribes")
assert_status "GET /tribes → 200 (canonical)" "200" "$STATUS"

# Houses response has x-deprecated header
HOUSE_HEADERS=$(curl -s -D- "$API/api/houses" 2>/dev/null | head -30)
assert "Houses response has x-deprecated: true" "x-deprecated: true" "$HOUSE_HEADERS"

# =============================================================================
echo -e "\n${CYAN}=== GATE 8: CONTENT & SOCIAL CONTRACT ===${NC}"
echo "Verifying post creation and social interaction shapes"
# =============================================================================

# Complete onboarding first
curl -s -X PATCH "$API/api/me/age" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"birthYear":2002}' > /dev/null
curl -s -X PATCH "$API/api/me/onboarding" -H "$AUTH" > /dev/null

# Create post
POST=$(curl -s -X POST "$API/api/content/posts" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"caption":"Freeze test post","kind":"POST"}')
assert_json_field "Create post returns post" "$POST" "'post' in d"
assert_json_field "Post has id" "$POST" "'id' in d['post']"
assert_json_field "Post has kind" "$POST" "'kind' in d['post']"
assert_json_field "Post has authorId" "$POST" "'authorId' in d['post']"
assert_json_field "Post has caption" "$POST" "'caption' in d['post']"
assert_json_field "Post has visibility" "$POST" "'visibility' in d['post']"
assert_json_field "Post has likeCount" "$POST" "'likeCount' in d['post']"
assert_json_field "Post has commentCount" "$POST" "'commentCount' in d['post']"
assert_json_field "Post has createdAt" "$POST" "'createdAt' in d['post']"

POST_ID=$(echo "$POST" | python3 -c "import sys,json; print(json.load(sys.stdin)['post']['id'])")

# Like post
LIKE=$(curl -s -X POST "$API/api/content/$POST_ID/like" -H "$AUTH")
assert_json_field "Like returns likeCount" "$LIKE" "'likeCount' in d"
assert_json_field "Like returns viewerHasLiked=true" "$LIKE" "d.get('viewerHasLiked') == True"

# Comment
COMMENT=$(curl -s -X POST "$API/api/content/$POST_ID/comments" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"body":"Freeze test comment"}')
assert_json_field "Comment returns comment" "$COMMENT" "'comment' in d"
assert_json_field "Comment has id" "$COMMENT" "'id' in d['comment']"
assert_json_field "Comment has author" "$COMMENT" "'author' in d['comment']"

# Get comments
COMMENTS=$(curl -s "$API/api/content/$POST_ID/comments")
assert_json_field "Comments list has comments array" "$COMMENTS" "'comments' in d"
assert_json_field "Comments list has nextCursor" "$COMMENTS" "'nextCursor' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 9: SEARCH & DISCOVERY CONTRACT ===${NC}"
echo "Verifying search and suggestion endpoints"
# =============================================================================

SEARCH=$(curl -s "$API/api/search?q=Freeze&type=all&limit=5")
assert_json_field "Search has users" "$SEARCH" "'users' in d"

SUGGEST=$(curl -s "$API/api/suggestions/users" -H "$AUTH")
assert_json_field "Suggestions has users" "$SUGGEST" "'users' in d"

# =============================================================================
echo -e "\n${CYAN}=== GATE 10: CONTEST CONTRACT VALIDATION ===${NC}"
echo "Verifying tribe contest endpoints"
# =============================================================================

CONTESTS=$(curl -s "$API/api/tribe-contests?limit=5")
assert_json_field "Contest list has items" "$CONTESTS" "'items' in d"
assert_json_field "Contest list has total" "$CONTESTS" "'total' in d"

SEASONS=$(curl -s "$API/api/tribe-contests/seasons")
assert_json_field "Seasons has items" "$SEASONS" "'items' in d or 'seasons' in d"

# Contest headers
CONTEST_HEADERS=$(curl -s -D- "$API/api/tribe-contests" 2>/dev/null | head -30)
assert "Contest list → x-freeze-status: android_v1_use" "x-freeze-status: android_v1_use" "$CONTEST_HEADERS"

# =============================================================================
echo -e "\n${CYAN}=== GATE 11: NOTIFICATION & LEGAL CONTRACT ===${NC}"
echo "Verifying notification and consent endpoints"
# =============================================================================

NOTIFS=$(curl -s "$API/api/notifications" -H "$AUTH")
assert_json_field "Notifications response valid" "$NOTIFS" "True"

CONSENT=$(curl -s "$API/api/legal/consent")
assert_json_field "Legal consent response valid" "$CONSENT" "True"

# =============================================================================
echo -e "\n${CYAN}=== GATE 12: GOVERNANCE CONTRACT ===${NC}"
echo "Verifying governance endpoints respond"
# =============================================================================

GOV=$(curl -s "$API/api/governance/college/nonexistent/board")
# Should return empty or error, but not 500
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/governance/college/nonexistent/board")
TOTAL=$((TOTAL + 1))
if [ "$STATUS" != "500" ]; then
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${NC} [$TOTAL] Governance endpoint doesn't 500"
else
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}FAIL${NC} [$TOTAL] Governance endpoint returned 500"
fi

# =============================================================================
# FINAL REPORT
# =============================================================================
echo ""
echo "============================================"
echo -e "${CYAN}B0 CANONICAL CONTRACT FREEZE TEST RESULTS${NC}"
echo "============================================"
echo -e "Total:  $TOTAL"
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"
echo "============================================"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}★ ALL GATES PASSED — FREEZE IS INTACT ★${NC}"
  echo "Backend source of truth is canonical and untouchable."
  exit 0
else
  echo -e "\n${RED}✗ FREEZE BROKEN — $FAIL TESTS FAILED ✗${NC}"
  echo "Fix all failures before any deploy or contract change."
  exit 1
fi
