# B0.1 — Route Census Coverage Note
> Generated: 2026-03-10 | Honesty file — what was observed vs what was inferred

---

## Scan Summary

| Metric | Value |
|---|---|
| Handler files scanned | 18 of 18 |
| Active handler files (imported in route.js) | 16 |
| Dead handler files (not imported) | 1 (`house-points.js`) |
| Dead code blocks in active files | 1 (stages.js lines 2247-2623) |
| Router file scanned | route.js (632 lines) |
| Moderation routes file scanned | moderation.routes.js |
| Total handler code lines | 13,766 |

---

## Final Callable Route Count

| Category | Count |
|---|---|
| **Live callable routes** | **266** |
| Dead routes (house-points.js) | 5 |
| Deprecated route (410) | 1 |
| **Total documented** | **272** |

### Method Breakdown (live routes)

| Method | Count |
|---|---|
| GET | 117 |
| POST | 107 |
| DELETE | 22 |
| PATCH | 20 |
| **Total** | **266** |

### Auth Breakdown

| Level | Count |
|---|---|
| Public (no auth required) | 36 |
| Optional auth (enriches response) | 14 |
| Required auth (logged-in user) | 142 |
| MOD/ADMIN required | 74 |

### Domain Distribution

| Domain | Routes |
|---|---|
| System/Health/Ops | 11 |
| Auth | 9 |
| Me/Profile/Onboarding | 4 |
| Content/Posts | 3 |
| Feed | 6 |
| Social Interactions | 10 |
| Users | 5 |
| Discovery/Colleges/Houses/Search | 11 |
| Media | 2 |
| Stories | 33 |
| Reels | 36 |
| Tribes | 19 |
| Tribe Contests | 28 |
| Events | 22 |
| Board Notices + Authenticity | 17 |
| Reports/Appeals/Notifications/Legal/Grievances | 14 |
| College Claims | 7 |
| Distribution Ladder | 7 |
| Resources/PYQs | 14 |
| Governance | 8 |
| **Total** | **266** |

### Business Criticality

| Priority | Count |
|---|---|
| P0 (critical path) | 58 |
| P1 (important) | 106 |
| P2 (nice-to-have/admin) | 102 |

### Route Type

| Type | Count |
|---|---|
| JSON_READ | 100 |
| JSON_WRITE | 107 |
| ADMIN_ACTION | 56 |
| STREAM_SSE | 1 |
| MEDIA_UPLOAD | 1 |
| MEDIA_BINARY | 1 |

---

## Confidence Assessment

### What was directly observed (code-read-confirmed):
- ✅ All route.js dispatch logic (632 lines read line-by-line)
- ✅ All 18 handler files read in full
- ✅ Import chain verified (which handlers are actually imported and callable)
- ✅ Path resolution from router dispatch to handler `if` statements
- ✅ Auth middleware presence (`requireAuth`, `authenticate`) per handler
- ✅ Role guards (admin/mod checks) per handler
- ✅ Upload/stream/binary flags per handler

### What was inferred (high confidence):
- Handler function names are correct based on import statements
- Domain classification is based on path semantics + handler grouping
- Business criticality (P0/P1/P2) is based on social media app conventions

### What was NOT verified at runtime:
- Exact request body validation rules (will be captured in B0.4)
- Exact response shapes (will be captured in B0.5)
- Error codes and messages per endpoint (will be captured in B0.6)
- Pagination parameter names and cursor format (will be captured in B0.7)
- Whether some routes have runtime bugs (known: reel comment/report 400 errors)

### Known unknowns:
1. **Reel comment/report runtime behavior**: Routes exist in code but have been reported as returning 400 errors. Confidence: `runtime-bug-observed`.
2. **Feed story source collection confusion**: `/api/feed/stories` reads from `content_items` while `/api/stories` writes to `stories` collection. Integration behavior unverified at runtime.
3. **Exact middleware chain per route**: Some handlers call `requireAuth()` internally rather than via middleware. The census captures auth presence but not the exact middleware chain order.

---

## Spot Verification Checklist

| Known Route | Found in Census? | Status |
|---|---|---|
| POST /api/auth/register | ✅ #12 | code-read-confirmed |
| POST /api/auth/login | ✅ #13 | runtime-hit-confirmed |
| GET /api/healthz | ✅ #1 | runtime-hit-confirmed |
| POST /api/content/posts | ✅ #25 | code-read-confirmed |
| GET /api/feed/public | ✅ #28 | code-read-confirmed |
| POST /api/stories | ✅ #62 | code-read-confirmed |
| POST /api/reels | ✅ #94 | code-read-confirmed |
| GET /api/tribes | ✅ #130 | code-read-confirmed |
| POST /api/tribe-contests/:id/enter | ✅ #154 | code-read-confirmed |
| POST /api/media/upload | ✅ #59 | code-read-confirmed |
| GET /api/notifications | ✅ #222 | code-read-confirmed |
| POST /api/events | ✅ #177 | code-read-confirmed |
| POST /api/resources | ✅ #244 | code-read-confirmed |
| GET /api/search | ✅ #57 | code-read-confirmed |
| POST /api/reports | ✅ #216 | code-read-confirmed |

**All 15 spot checks passed.** ✅

---

## Quality Gates

| Gate | Status |
|---|---|
| All top-level router entry points identified | ✅ |
| Nested mounts resolved | ✅ (path-prefix dispatch in route.js) |
| Final callable method+path inventory generated | ✅ (266 routes) |
| Handler source mapping captured | ✅ |
| Middleware/auth presence captured | ✅ |
| Route type tagging done | ✅ |
| Anomaly report created | ✅ (11 anomalies) |
| Known-route spot verification passed | ✅ (15/15) |
| Unresolved/suspect routes honestly marked | ✅ |
| Admin vs user namespace clarity | ✅ |
| SSE routes identified | ✅ (1: stories/events/stream) |
| Upload routes identified | ✅ (1: media/upload) |
| Binary routes identified | ✅ (1: media/:id) |
| Deprecated routes flagged | ✅ (house-points 410) |
| Dead code identified | ✅ (house-points.js + stages.js dead block) |

---

## B0.1 EXIT GATE: **PASS** ✅

All exit criteria met. Census is trusted and ready for B0.2+ consumption.
