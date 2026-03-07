#!/bin/bash
# Tribe — Smoke Test Script
# Runs quick validation of all critical paths
# Usage: bash scripts/smoke-test.sh [api_url]

API_URL=${1:-"http://localhost:3000"}
PASSED=0
FAILED=0
TOTAL=0

pass() {
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ✅ $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ❌ $1: $2"
}

check() {
  local name="$1"
  local expected_code="$2"
  local actual_code="$3"
  local body="$4"

  if [ "$actual_code" = "$expected_code" ]; then
    pass "$name (HTTP $actual_code)"
  else
    fail "$name" "expected $expected_code, got $actual_code. Body: ${body:0:100}"
  fi
}

echo "================================="
echo "Tribe Smoke Test"
echo "API: $API_URL"
echo "================================="

# Health
echo ""
echo "--- Health ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/healthz")
CODE=$(echo "$RES" | tail -1)
check "GET /healthz" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/readyz")
CODE=$(echo "$RES" | tail -1)
check "GET /readyz" "200" "$CODE"

# Auth - Register validation
echo ""
echo "--- Auth Validation ---"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{}')
CODE=$(echo "$RES" | tail -1)
check "Register empty body" "400" "$CODE"

RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{"phone":"123","pin":"1234","displayName":"Test"}')
CODE=$(echo "$RES" | tail -1)
check "Register invalid phone" "400" "$CODE"

# Auth - Login
echo ""
echo "--- Auth Login ---"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000001","pin":"1234"}')
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | head -1)
check "Login valid user" "200" "$CODE"
TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)

RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000001","pin":"0000"}')
CODE=$(echo "$RES" | tail -1)
check "Login wrong PIN" "401" "$CODE"

# Auth - Me
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RES" | tail -1)
check "GET /auth/me" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/auth/me")
CODE=$(echo "$RES" | tail -1)
check "GET /auth/me no token" "401" "$CODE"

# Feeds
echo ""
echo "--- Feeds ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/feed/public")
CODE=$(echo "$RES" | tail -1)
check "GET /feed/public" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/feed/following" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RES" | tail -1)
check "GET /feed/following" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/feed/reels")
CODE=$(echo "$RES" | tail -1)
check "GET /feed/reels" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/feed/stories" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RES" | tail -1)
check "GET /feed/stories" "200" "$CODE"

# Content
echo ""
echo "--- Content ---"
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"caption":"Smoke test post"}')
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | head -1)
check "POST /content/posts" "201" "$CODE"
POST_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['post']['id'])" 2>/dev/null)

if [ -n "$POST_ID" ]; then
  RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/content/$POST_ID")
  CODE=$(echo "$RES" | tail -1)
  check "GET /content/:id" "200" "$CODE"
fi

# Validation: empty post
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
CODE=$(echo "$RES" | tail -1)
check "POST empty post rejected" "400" "$CODE"

# Validation: story without media
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"kind":"STORY","caption":"test"}')
CODE=$(echo "$RES" | tail -1)
check "STORY without media rejected" "400" "$CODE"

# Social
echo ""
echo "--- Social ---"
if [ -n "$POST_ID" ]; then
  RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/content/$POST_ID/like" -H "Authorization: Bearer $TOKEN")
  CODE=$(echo "$RES" | tail -1)
  check "Like content" "200" "$CODE"

  RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/content/$POST_ID/comments" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"body":"Smoke comment"}')
  CODE=$(echo "$RES" | tail -1)
  check "Comment on content" "201" "$CODE"

  RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/content/$POST_ID/comments")
  CODE=$(echo "$RES" | tail -1)
  check "GET comments" "200" "$CODE"
fi

# Self-follow rejected
USER_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)
RES=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/follow/$USER_ID" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RES" | tail -1)
check "Self-follow rejected" "400" "$CODE"

# Discovery
echo ""
echo "--- Discovery ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/colleges/search?q=IIT")
CODE=$(echo "$RES" | tail -1)
check "College search" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/houses")
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | head -1)
HOUSE_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('houses',[])))" 2>/dev/null)
if [ "$CODE" = "200" ] && [ "$HOUSE_COUNT" = "12" ]; then
  pass "GET /houses (12 houses)"
else
  fail "GET /houses" "expected 12 houses, got $HOUSE_COUNT"
fi

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/houses/leaderboard")
CODE=$(echo "$RES" | tail -1)
check "House leaderboard" "200" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/search?q=Priya")
CODE=$(echo "$RES" | tail -1)
check "Global search" "200" "$CODE"

# Notifications
echo ""
echo "--- Notifications ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/notifications" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RES" | tail -1)
check "GET /notifications" "200" "$CODE"

# Legal
echo ""
echo "--- Legal ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/legal/consent")
CODE=$(echo "$RES" | tail -1)
check "GET /legal/consent" "200" "$CODE"

# 404
echo ""
echo "--- Error handling ---"
RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/nonexistent")
CODE=$(echo "$RES" | tail -1)
check "Nonexistent route" "404" "$CODE"

RES=$(curl -s -w "\n%{http_code}" "$API_URL/api/content/nonexistent-id")
CODE=$(echo "$RES" | tail -1)
check "Nonexistent content" "404" "$CODE"

# Summary
echo ""
echo "================================="
echo "RESULTS: $PASSED/$TOTAL passed ($FAILED failed)"
if [ $FAILED -eq 0 ]; then
  echo "STATUS: ALL PASS ✅"
else
  echo "STATUS: $FAILED FAILURES ❌"
fi
echo "================================="
exit $FAILED
