#!/usr/bin/env python3
"""
Tribe — Concurrent Load Test & Performance Methodology Pack
Tests p50/p95/p99 under concurrent load with full methodology documentation.
"""
import asyncio
import httpx
import time
import json
import statistics
import sys

API_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
CONCURRENCY = int(sys.argv[2]) if len(sys.argv) > 2 else 20
REQUESTS_PER_ENDPOINT = int(sys.argv[3]) if len(sys.argv) > 3 else 50

# Get token
def get_token():
    import urllib.request
    data = json.dumps({"phone": "9000000001", "pin": "1234"}).encode()
    req = urllib.request.Request(f"{API_URL}/api/auth/login", data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["token"]

TOKEN = get_token()

# Get context IDs
def get_context():
    import urllib.request
    headers = {"Authorization": f"Bearer {TOKEN}"}
    req = urllib.request.Request(f"{API_URL}/api/auth/me", headers=headers)
    with urllib.request.urlopen(req) as r:
        user = json.loads(r.read())["user"]
    
    req2 = urllib.request.Request(f"{API_URL}/api/feed/public?limit=1")
    with urllib.request.urlopen(req2) as r:
        items = json.loads(r.read())["items"]
    
    return {
        "user_id": user["id"],
        "college_id": user.get("collegeId", ""),
        "house_id": user.get("houseId", ""),
        "post_id": items[0]["id"] if items else "",
    }

CTX = get_context()

ENDPOINTS = [
    ("GET", "/api/healthz", None, False, "Health Check"),
    ("GET", "/api/readyz", None, False, "Readiness Check"),
    ("POST", "/api/auth/login", json.dumps({"phone": "9000000001", "pin": "1234"}), False, "Login (PBKDF2 100K)"),
    ("GET", "/api/auth/me", None, True, "Auth Me"),
    ("GET", "/api/feed/public", None, False, "Public Feed"),
    ("GET", "/api/feed/following", None, True, "Following Feed"),
    ("GET", "/api/feed/stories", None, True, "Stories Rail"),
    ("GET", "/api/feed/reels", None, False, "Reels Feed"),
    ("GET", f"/api/feed/college/{CTX['college_id']}", None, False, "College Feed") if CTX['college_id'] else None,
    ("GET", f"/api/feed/house/{CTX['house_id']}", None, False, "House Feed") if CTX['house_id'] else None,
    ("GET", f"/api/content/{CTX['post_id']}", None, False, "Get Content") if CTX['post_id'] else None,
    ("GET", f"/api/content/{CTX['post_id']}/comments", None, False, "Get Comments") if CTX['post_id'] else None,
    ("GET", "/api/notifications", None, True, "Notifications"),
    ("GET", "/api/colleges/search?q=IIT", None, False, "College Search"),
    ("GET", "/api/houses", None, False, "All Houses"),
    ("GET", "/api/houses/leaderboard", None, False, "House Leaderboard"),
    ("GET", "/api/search?q=Priya", None, False, "Global Search"),
    ("GET", "/api/suggestions/users", None, True, "User Suggestions"),
    ("GET", "/api/admin/stats", None, False, "Admin Stats"),
]
ENDPOINTS = [e for e in ENDPOINTS if e is not None]

async def bench_endpoint(client, method, path, body, auth, name, results):
    headers = {}
    if auth:
        headers["Authorization"] = f"Bearer {TOKEN}"
    if body:
        headers["Content-Type"] = "application/json"
    
    start = time.perf_counter()
    try:
        if method == "GET":
            r = await client.get(f"{API_URL}{path}", headers=headers, timeout=10)
        else:
            r = await client.post(f"{API_URL}{path}", content=body, headers=headers, timeout=10)
        elapsed_ms = (time.perf_counter() - start) * 1000
        results.append({"name": name, "ms": elapsed_ms, "status": r.status_code, "ok": r.status_code < 400})
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start) * 1000
        results.append({"name": name, "ms": elapsed_ms, "status": 0, "ok": False, "error": str(e)})

async def run_load_test():
    results = []
    
    async with httpx.AsyncClient() as client:
        for method, path, body, auth, name in ENDPOINTS:
            # Cold request first
            cold_start = time.perf_counter()
            if method == "GET":
                headers = {"Authorization": f"Bearer {TOKEN}"} if auth else {}
                await client.get(f"{API_URL}{path}", headers=headers, timeout=10)
            cold_ms = (time.perf_counter() - cold_start) * 1000
            
            # Concurrent warm requests
            tasks = []
            for _ in range(REQUESTS_PER_ENDPOINT):
                tasks.append(bench_endpoint(client, method, path, body, auth, name, results))
                if len(tasks) >= CONCURRENCY:
                    await asyncio.gather(*tasks)
                    tasks = []
            if tasks:
                await asyncio.gather(*tasks)
    
    return results

def compute_stats(results):
    by_name = {}
    for r in results:
        if r["name"] not in by_name:
            by_name[r["name"]] = {"times": [], "ok": 0, "fail": 0}
        by_name[r["name"]]["times"].append(r["ms"])
        if r["ok"]:
            by_name[r["name"]]["ok"] += 1
        else:
            by_name[r["name"]]["fail"] += 1
    
    stats = []
    for name, data in by_name.items():
        times = sorted(data["times"])
        n = len(times)
        stats.append({
            "name": name,
            "count": n,
            "ok": data["ok"],
            "fail": data["fail"],
            "p50": times[int(n * 0.50)] if n else 0,
            "p95": times[int(n * 0.95)] if n else 0,
            "p99": times[int(n * 0.99)] if n else 0,
            "min": times[0] if times else 0,
            "max": times[-1] if times else 0,
            "mean": statistics.mean(times) if times else 0,
        })
    return stats

def main():
    # Get dataset size
    import urllib.request
    req = urllib.request.Request(f"{API_URL}/api/admin/stats")
    with urllib.request.urlopen(req) as r:
        db_stats = json.loads(r.read())
    
    college_count = 0
    try:
        req2 = urllib.request.Request(f"{API_URL}/api/colleges/search?q=&limit=1")
        with urllib.request.urlopen(req2) as r:
            college_count = json.loads(r.read()).get("total", 0)
    except:
        pass
    
    print("=" * 80)
    print("TRIBE BACKEND — CONCURRENT LOAD TEST & PERFORMANCE METHODOLOGY")
    print("=" * 80)
    print()
    print("## METHODOLOGY")
    print(f"  API URL:            {API_URL}")
    print(f"  Concurrency:        {CONCURRENCY} simultaneous requests")
    print(f"  Requests/endpoint:  {REQUESTS_PER_ENDPOINT}")
    print(f"  Auth:               Bearer token (pre-authenticated)")
    print(f"  Environment:        Kubernetes pod (Next.js dev server)")
    print()
    print("## DATASET SIZE")
    print(f"  Users:              {db_stats.get('users', '?')}")
    print(f"  Posts:              {db_stats.get('posts', '?')}")
    print(f"  Reels:              {db_stats.get('reels', '?')}")
    print(f"  Stories:            {db_stats.get('stories', '?')}")
    print(f"  Colleges:           {college_count or db_stats.get('colleges', '?')}")
    print(f"  Houses:             {db_stats.get('houses', '?')}")
    print(f"  Open Reports:       {db_stats.get('openReports', '?')}")
    print()
    
    print(f"Running {len(ENDPOINTS)} endpoints × {REQUESTS_PER_ENDPOINT} requests × {CONCURRENCY} concurrency...")
    print()
    
    results = asyncio.run(run_load_test())
    stats = compute_stats(results)
    
    # Print table
    print(f"{'Endpoint':<35} {'Count':>5} {'OK':>4} {'Fail':>4} {'p50':>8} {'p95':>8} {'p99':>8} {'Min':>8} {'Max':>8}")
    print("-" * 100)
    for s in stats:
        status = "✅" if s["fail"] == 0 else "⚠️"
        print(f"{status} {s['name']:<33} {s['count']:>5} {s['ok']:>4} {s['fail']:>4} {s['p50']:>7.1f}ms {s['p95']:>7.1f}ms {s['p99']:>7.1f}ms {s['min']:>7.1f}ms {s['max']:>7.1f}ms")
    
    print()
    total_requests = sum(s["count"] for s in stats)
    total_ok = sum(s["ok"] for s in stats)
    total_fail = sum(s["fail"] for s in stats)
    print(f"TOTAL: {total_requests} requests | {total_ok} OK | {total_fail} FAIL | Success rate: {total_ok/total_requests*100:.1f}%")
    
    # JSON output for documentation
    output = {
        "methodology": {
            "api_url": API_URL,
            "concurrency": CONCURRENCY,
            "requests_per_endpoint": REQUESTS_PER_ENDPOINT,
            "auth": "Bearer token (pre-authenticated)",
            "environment": "Kubernetes pod, Next.js dev server",
        },
        "dataset": db_stats,
        "results": [{k: round(v, 2) if isinstance(v, float) else v for k, v in s.items()} for s in stats],
        "summary": {
            "total_requests": total_requests,
            "total_ok": total_ok,
            "total_fail": total_fail,
            "success_rate": round(total_ok / total_requests * 100, 2),
        }
    }
    
    with open("/app/docs/load-test-results.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nDetailed results saved to /app/docs/load-test-results.json")

if __name__ == "__main__":
    main()
