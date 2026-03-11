# B5.1 — Search Quality Upgrade: PROOF REPORT

## Date: 2026-03-11
## Verdict: **PASS**

---

## 1. DISCOVERY REPORT

### Current Search Behavior Found (Pre-B5.1)
- All entity search used flat `$regex` contains-match
- No ranking differentiation (exact = prefix = contains)
- No pagination (only `limit`, no `offset`, no `total`)
- User search had no explicit sort order (DB default)
- Pages had `isOfficial DESC, followerCount DESC` but only as a DB sort, not tiered

### Gaps Confirmed
1. No pagination → frontend can't "load more"
2. No exact-match boosting → "seed_alpha" exact username match ranked same as substring
3. No user ordering → arbitrary MongoDB order
4. `$regex` bypasses text indexes (still true — documented as scale caveat)

### Indexes Found
- `hashtags.tag` unique, `hashtags.postCount DESC`
- `content_items.hashtags + createdAt`, `content_items.caption text`
- `users.displayName + username text`

---

## 2. ARCHITECTURE DECISION

### Ranking Strategy: 3-Tier In-App Sort
For users, pages, hashtags: fetch up to 100 matches via `$regex`, assign tier (exact=1, prefix=2, contains=3), sort in JavaScript with deterministic tie-breakers, then slice by offset+limit.

**Why in-app vs DB?** MongoDB `$regex` can't express "exact first, then prefix, then contains" in a single query sort. The alternatives (3 separate queries with `$unionWith`, or `$text` with score) either don't support the exact semantics needed or add complexity without matching the tier model. 100-item cap is safe for current scale and keeps response fast.

### Pagination Strategy: Offset-Based
`offset` + `limit` with `total` count. Offset-based (not cursor) because search results are ranked by tier, not by a monotonic field like `createdAt`.

### Tie-Breakers
- Users: `followersCount DESC` (social relevance)
- Pages: `isOfficial DESC`, then `followerCount DESC`
- Hashtags: `postCount DESC`
- Posts: `createdAt DESC` (recency) with DB-level `skip`/`limit`
- Colleges: `membersCount DESC`
- Houses: `totalPoints DESC`

---

## 3. FILES CHANGED

| File | Change | Why |
|------|--------|-----|
| `lib/handlers/discovery.js` | Rewrote search handler: 3-tier ranking, offset pagination, total/hasMore | Core B5.1 upgrade |
| `lib/seed.js` | Added `actingUserId`/`actingRole` to page posts | Fix B3 audit field regression |
| `tests/handlers/test_b51_search_ranking_pagination.py` | NEW — 27 tests | B5.1 proof |
| `memory/SEARCH_CONTRACT_FREEZE.md` | Updated to v2.0: pagination params, ranking policy | Contract update |
| `memory/B51_PROOF_REPORT.md` | NEW — this file | Deliverable |
| `memory/PRD.md` | Updated B5.1 status | Tracking |

---

## 4. CONTRACT REPORT

### New Request Parameters
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| offset | int | 0 | Skip N results for pagination |

### New Response Fields
```json
{
  "pagination": {
    "total": 15,
    "offset": 0,
    "limit": 10,
    "hasMore": true
  }
}
```

### Ranking Policy
Exact match (tier 1) > Prefix match (tier 2) > Contains match (tier 3)

Applies to: users, pages, hashtags.
Posts: recency-ranked (no tier model, `createdAt DESC`).

### Backward Compatibility
- All existing fields preserved: `items`, `users`, `pages`, `posts`, `hashtags`, `colleges`, `houses`
- `_resultType` markers unchanged
- `pagination` is a **new additive field** — old consumers can ignore it

---

## 5. INDEX / PERFORMANCE REPORT

### Indexes Used
| Index | Collection | Query |
|-------|-----------|-------|
| `tag: 1` UNIQUE | hashtags | Hashtag lookup |
| `postCount: -1, lastUsedAt: -1` | hashtags | Trending |
| `hashtags: 1, createdAt: -1` | content_items | Hashtag feed |
| `caption: text` | content_items | Post search (potential `$text` future) |
| `displayName: text, username: text` | users | User search (potential `$text` future) |

### Scale Caveats (Honest)
- **$regex still used** for flexibility (exact/prefix/contains detection). At current scale (<10K users) this is fast. At 100K+ users, consider switching to `$text` with score or MongoDB Atlas Search.
- **100-item fetch cap** for in-app ranking — prevents memory issues but means rankings beyond position 100 aren't tiered. Adequate for search UX (nobody scrolls past 100).

---

## 6. SAFETY REPORT

### Proof: No Search Leakage Introduced
- Safety filters applied BEFORE tier assignment and pagination slicing
- Blocked users excluded from raw query results (never reach ranking)
- `isBanned`, `moderationHold`, `isRemoved`, `isDeleted`, `visibility: PUBLIC` all enforced pre-ranking
- 4 dedicated safety-under-ranking tests prove no regression
- Pagination `total` counts only safe results — no phantom counts

---

## 7. TEST REPORT

### B5.1 Tests: `test_b51_search_ranking_pagination.py`

| Suite | Tests | Status |
|-------|-------|--------|
| TestUserRanking | 3 | ✅ PASS |
| TestPageRanking | 2 | ✅ PASS |
| TestHashtagRanking | 2 | ✅ PASS |
| TestSearchPagination | 7 | ✅ PASS |
| TestSafetyUnderRanking | 4 | ✅ PASS |
| TestPaginationContract | 4 | ✅ PASS |
| TestB51Regression | 5 | ✅ PASS |
| **TOTAL** | **27** | **27/27 PASS** |

### Combined B5 + B5.1: **104/104 PASS**
### Full Regression: **923/923 PASS**

---

## 8. FINAL VERDICT

### ✅ PASS

All 7 pass gates satisfied:
1. ✅ Search supports pagination (`offset`, `limit`, `total`, `hasMore`)
2. ✅ Exact > prefix > contains ranking implemented and proven
3. ✅ Users, pages, hashtags all have deterministic ordering
4. ✅ Safety intact on all pages (blocked/moderated/deleted excluded pre-ranking)
5. ✅ Contracts updated and frontend-safe (v2.0 freeze doc)
6. ✅ 27 tests prove ranking + pagination + regression safety
7. ✅ No old B5 capabilities regressed (77/77 original tests still pass)

None of the 7 hard-fail conditions present.
