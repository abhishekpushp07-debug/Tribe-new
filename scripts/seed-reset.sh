#!/bin/bash
# Tribe — Seed & Reset Script
# Usage: bash scripts/seed-reset.sh [seed|reset|both]

API_URL=${1:-"http://localhost:3000"}
ACTION=${2:-"both"}

echo "================================="
echo "Tribe Seed & Reset Script"
echo "API: $API_URL"
echo "Action: $ACTION"
echo "================================="

if [ "$ACTION" = "reset" ] || [ "$ACTION" = "both" ]; then
  echo ""
  echo "=== RESETTING DATABASE ==="
  mongosh --quiet --eval '
    const collections = db.getCollectionNames();
    collections.forEach(c => {
      if (c !== "colleges" && c !== "houses") {
        db.getCollection(c).deleteMany({});
        print("Cleared: " + c);
      }
    });
  ' your_database_name
  echo "Reset complete (colleges and houses preserved)"
fi

if [ "$ACTION" = "seed" ] || [ "$ACTION" = "both" ]; then
  echo ""
  echo "=== SEEDING DATA ==="

  # Seed colleges
  echo "Seeding colleges..."
  SEED_RESULT=$(curl -s -X POST "$API_URL/api/admin/colleges/seed")
  echo "  $SEED_RESULT"

  # Register test users
  echo ""
  echo "Creating test users..."

  # User 1: Adult, IIT Delhi
  REG1=$(curl -s -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{"phone":"9000000001","pin":"1234","displayName":"Priya Sharma"}')
  TOKEN1=$(echo "$REG1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$TOKEN1" ]; then
    TOKEN1=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000001","pin":"1234"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  fi
  echo "  User 1: Priya Sharma (9000000001)"

  # Set age, college, consent
  curl -s -X PATCH "$API_URL/api/me/age" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" -d '{"birthYear":2002}' > /dev/null
  COLLEGE_ID=$(curl -s "$API_URL/api/colleges/search?q=IIT+Delhi&limit=1" | python3 -c "import sys,json; print(json.load(sys.stdin)['colleges'][0]['id'])")
  curl -s -X PATCH "$API_URL/api/me/college" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" -d "{\"collegeId\":\"$COLLEGE_ID\"}" > /dev/null
  curl -s -X POST "$API_URL/api/legal/accept" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" -d '{"version":"1.0"}' > /dev/null
  curl -s -X PATCH "$API_URL/api/me/onboarding" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" > /dev/null
  echo "  User 1: Onboarded (ADULT, IIT Delhi)"

  # User 2: Adult, different college
  REG2=$(curl -s -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{"phone":"9000000002","pin":"5678","displayName":"Rahul Patel"}')
  TOKEN2=$(echo "$REG2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$TOKEN2" ]; then
    TOKEN2=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000002","pin":"5678"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  fi
  curl -s -X PATCH "$API_URL/api/me/age" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" -d '{"birthYear":2001}' > /dev/null
  curl -s -X PATCH "$API_URL/api/me/onboarding" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" > /dev/null
  echo "  User 2: Rahul Patel (9000000002)"

  # User 3: Child user
  REG3=$(curl -s -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{"phone":"9000000003","pin":"9999","displayName":"Student Minor"}')
  TOKEN3=$(echo "$REG3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$TOKEN3" ]; then
    TOKEN3=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"phone":"9000000003","pin":"9999"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  fi
  curl -s -X PATCH "$API_URL/api/me/age" -H "Authorization: Bearer $TOKEN3" -H "Content-Type: application/json" -d '{"birthYear":2015}' > /dev/null
  echo "  User 3: Student Minor (9000000003, CHILD)"

  # Create sample posts
  echo ""
  echo "Creating sample content..."
  curl -s -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" -d '{"caption":"First post from IIT Delhi! #tribe #college"}' > /dev/null
  curl -s -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN1" -H "Content-Type: application/json" -d '{"caption":"Excited to join this platform"}' > /dev/null
  curl -s -X POST "$API_URL/api/content/posts" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" -d '{"caption":"Hello Tribe from Rahul!"}' > /dev/null
  echo "  Created 3 posts"

  # Social interactions
  echo ""
  echo "Creating social interactions..."
  USER1_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN1" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
  USER2_ID=$(curl -s "$API_URL/api/auth/me" -H "Authorization: Bearer $TOKEN2" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
  curl -s -X POST "$API_URL/api/follow/$USER1_ID" -H "Authorization: Bearer $TOKEN2" > /dev/null
  echo "  User 2 follows User 1"

  POST_ID=$(curl -s "$API_URL/api/feed/public?limit=1" | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; print(items[0]['id'] if items else '')")
  if [ -n "$POST_ID" ]; then
    curl -s -X POST "$API_URL/api/content/$POST_ID/like" -H "Authorization: Bearer $TOKEN2" > /dev/null
    curl -s -X POST "$API_URL/api/content/$POST_ID/comments" -H "Authorization: Bearer $TOKEN2" -H "Content-Type: application/json" -d '{"body":"Great post!"}' > /dev/null
    echo "  User 2 liked and commented on a post"
  fi

  echo ""
  echo "=== SEED COMPLETE ==="
  echo "Credentials:"
  echo "  User 1: phone=9000000001, pin=1234 (ADULT, IIT Delhi)"
  echo "  User 2: phone=9000000002, pin=5678 (ADULT)"
  echo "  User 3: phone=9000000003, pin=9999 (CHILD)"
fi

echo ""
echo "=== FINAL STATE ==="
curl -s "$API_URL/api/admin/stats" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {k}: {v}') for k,v in d.items()]"
