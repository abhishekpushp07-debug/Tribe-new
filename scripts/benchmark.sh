#!/bin/bash
# Tribe — Performance Benchmark Script
# Measures p50/p95/p99 latency for all major endpoints
# Usage: bash scripts/benchmark.sh [api_url] [iterations]

API_URL=${1:-"http://localhost:3000"}
ITERATIONS=${2:-50}

echo "====================================="
echo "Tribe Performance Benchmark"
echo "API: $API_URL"
echo "Iterations per endpoint: $ITERATIONS"
echo "====================================="

# Login first
TOKEN=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000001","pin":"1234"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
USER_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
COLLEGE_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['user'].get('collegeId',''))")
HOUSE_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['user'].get('houseId',''))")
POST_ID=$(curl -s "$API_URL/api/feed/public?limit=1" | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; print(items[0]['id'] if items else '')")

bench() {
  local name="$1"
  local cmd="$2"
  local times=()

  for i in $(seq 1 $ITERATIONS); do
    local start=$(date +%s%N)
    eval "$cmd" > /dev/null 2>&1
    local end=$(date +%s%N)
    local duration_ms=$(( (end - start) / 1000000 ))
    times+=($duration_ms)
  done

  # Sort and compute percentiles
  IFS=$'\n' sorted=($(sort -n <<<"${times[*]}")); unset IFS

  local count=${#sorted[@]}
  local p50_idx=$(( count * 50 / 100 ))
  local p95_idx=$(( count * 95 / 100 ))
  local p99_idx=$(( count * 99 / 100 ))

  local p50=${sorted[$p50_idx]}
  local p95=${sorted[$p95_idx]}
  local p99=${sorted[$p99_idx]}
  local min=${sorted[0]}
  local max=${sorted[$((count-1))]}

  printf "  %-45s  p50=%3dms  p95=%3dms  p99=%3dms  min=%3dms  max=%3dms\n" "$name" "$p50" "$p95" "$p99" "$min" "$max"
}

echo ""
echo "--- Health ---"
bench "GET /healthz" "curl -s $API_URL/api/healthz"
bench "GET /readyz" "curl -s $API_URL/api/readyz"

echo ""
echo "--- Auth ---"
bench "POST /auth/login" "curl -s -X POST $API_URL/api/auth/login -H 'Content-Type: application/json' -d '{\"phone\":\"9000000001\",\"pin\":\"1234\"}'"
bench "GET /auth/me" "curl -s $API_URL/api/auth/me -H 'Authorization: Bearer $TOKEN'"

echo ""
echo "--- Feeds ---"
bench "GET /feed/public" "curl -s $API_URL/api/feed/public"
bench "GET /feed/following" "curl -s $API_URL/api/feed/following -H 'Authorization: Bearer $TOKEN'"
bench "GET /feed/stories" "curl -s $API_URL/api/feed/stories -H 'Authorization: Bearer $TOKEN'"
bench "GET /feed/reels" "curl -s $API_URL/api/feed/reels"
if [ -n "$COLLEGE_ID" ]; then
  bench "GET /feed/college/:id" "curl -s $API_URL/api/feed/college/$COLLEGE_ID"
fi
if [ -n "$HOUSE_ID" ]; then
  bench "GET /feed/house/:id" "curl -s $API_URL/api/feed/house/$HOUSE_ID"
fi

echo ""
echo "--- Content ---"
bench "POST /content/posts (create)" "curl -s -X POST $API_URL/api/content/posts -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '{\"caption\":\"Bench post\"}'"
if [ -n "$POST_ID" ]; then
  bench "GET /content/:id" "curl -s $API_URL/api/content/$POST_ID"
  bench "GET /content/:id/comments" "curl -s $API_URL/api/content/$POST_ID/comments"
  bench "POST /content/:id/like" "curl -s -X POST $API_URL/api/content/$POST_ID/like -H 'Authorization: Bearer $TOKEN'"
fi

echo ""
echo "--- Social ---"
bench "POST /content/:id/comments" "curl -s -X POST $API_URL/api/content/$POST_ID/comments -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '{\"body\":\"bench\"}'"
bench "GET /notifications" "curl -s $API_URL/api/notifications -H 'Authorization: Bearer $TOKEN'"

echo ""
echo "--- Discovery ---"
bench "GET /colleges/search?q=IIT" "curl -s '$API_URL/api/colleges/search?q=IIT'"
bench "GET /houses" "curl -s $API_URL/api/houses"
bench "GET /houses/leaderboard" "curl -s $API_URL/api/houses/leaderboard"
bench "GET /search?q=Priya" "curl -s '$API_URL/api/search?q=Priya'"
bench "GET /suggestions/users" "curl -s $API_URL/api/suggestions/users -H 'Authorization: Bearer $TOKEN'"

echo ""
echo "--- Admin ---"
bench "GET /admin/stats" "curl -s $API_URL/api/admin/stats"

echo ""
echo "====================================="
echo "Benchmark complete"
echo "====================================="
