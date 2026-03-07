# Tribe Backend — Performance Methodology & Results

## Test Environment

| Parameter | Value |
|-----------|-------|
| **Runtime** | Next.js 14.2.3 dev server on Node.js |
| **Infrastructure** | Kubernetes pod (single container) |
| **Database** | MongoDB 7.x (localhost, same pod) |
| **Network** | Loopback (localhost:3000), eliminates network latency noise |
| **OS** | Linux container |
| **Rate Limiter** | Elevated to 5000 req/min for clean benchmark |

## Dataset Size at Test Time

| Collection | Count |
|------------|-------|
| Users | 17 |
| Posts (PUBLIC) | 28 |
| Reels | 0 |
| Stories (active) | 4 |
| Colleges | 1,366 |
| Houses | 12 |
| Open Reports | 9 |

## Load Test Parameters

| Parameter | Value |
|-----------|-------|
| **Concurrency** | 20 simultaneous requests |
| **Requests per endpoint** | 50 |
| **Total endpoints tested** | 19 |
| **Total requests fired** | 950 |
| **Auth method** | Pre-authenticated Bearer token |
| **Warmup** | 1 cold request per endpoint before measured run |
| **Tool** | Python httpx async client |

## Results: Latency by Endpoint (ms)

| Endpoint | p50 | p95 | p99 | Min | Max | OK/Total |
|----------|-----|-----|-----|-----|-----|----------|
| Health Check | 150 | 192 | 193 | 46 | 193 | 50/50 |
| Readiness Check | 197 | 284 | 287 | 53 | 287 | 50/50 |
| Login (PBKDF2 100K) | 1268 | 1873 | 1875 | 230 | 1875 | 50/50 |
| Auth Me | 207 | 297 | 334 | 64 | 334 | 50/50 |
| Public Feed | 204 | 348 | 352 | 54 | 352 | 50/50 |
| Following Feed | 388 | 494 | 503 | 87 | 503 | 50/50 |
| Stories Rail | 303 | 363 | 392 | 56 | 392 | 50/50 |
| Reels Feed | 255 | 393 | 395 | 99 | 395 | 50/50 |
| College Feed | 232 | 338 | 347 | 56 | 347 | 50/50 |
| House Feed | 212 | 1153 | 1204 | 64 | 1204 | 50/50 |
| Get Content | 247 | 332 | 336 | 23 | 336 | 50/50 |
| Get Comments | 197 | 259 | 293 | 56 | 293 | 50/50 |
| Notifications | 293 | 395 | 399 | 98 | 399 | 50/50 |
| College Search (1366 colleges) | 299 | 354 | 393 | 87 | 393 | 50/50 |
| All Houses | 161 | 207 | 241 | 59 | 241 | 50/50 |
| House Leaderboard | 159 | 201 | 239 | 54 | 239 | 50/50 |
| Global Search | 194 | 284 | 286 | 56 | 286 | 50/50 |
| User Suggestions | 238 | 310 | 311 | 99 | 311 | 50/50 |
| Admin Stats | 291 | 639 | 641 | 54 | 641 | 50/50 |

## Summary

| Metric | Value |
|--------|-------|
| **Total Requests** | 950 |
| **Success Rate** | 100.0% |
| **Failed Requests** | 0 |
| **Endpoints Tested** | 19 |

## Analysis

### Performance Profile
- **Fast tier** (p50 < 200ms): Health checks, House queries, Comments, Global Search
- **Standard tier** (p50 200-400ms): All feeds, Auth/Me, Content retrieval, Notifications, College Search, Suggestions, Admin Stats
- **Compute-heavy tier** (p50 > 1s): Login — expected due to PBKDF2 with 100,000 iterations (security trade-off)

### Login Latency Note
The login endpoint's high p50 (1268ms) is **by design**. PBKDF2 with 100K iterations provides strong brute-force resistance at the cost of per-login CPU time. This is a one-time cost per session (tokens last 30 days). In production, this can be improved with:
1. Dedicated auth worker
2. Session caching
3. Hardware-accelerated hashing

### No Errors Under Load
All 950 requests returned 2xx responses under 20x concurrent load — zero failures, zero timeouts.

## Reproduction Command

```bash
cd /app && python3 scripts/load-test.py "http://localhost:3000" 20 50
```

Raw JSON results: `/app/docs/load-test-results.json`

---

## With Caching (Post-Hardening)

### Results: Latency by Endpoint (ms) — Cached

| Endpoint | p50 | p95 | p99 | Improvement vs Cold |
|----------|-----|-----|-----|---------------------|
| Public Feed | 154 | 161 | 193 | 24% faster |
| Reels Feed | 137 | 189 | 190 | 46% faster |
| College Feed | 117 | 189 | 189 | 50% faster |
| House Feed | 147 | 205 | 207 | 31% faster |
| Houses List | 122 | 157 | 158 | 24% faster |
| House Leaderboard | 113 | 165 | 167 | 29% faster |
| Admin Stats | 111 | 183 | 185 | 62% faster |

### Cache Performance
- First request (cold): hits DB, stores result
- Subsequent requests (warm): served from memory in <5ms at handler level
- Overall p50 reduction: 24-62% across cached endpoints
