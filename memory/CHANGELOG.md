# Tribe — Changelog

## 2026-03 (Feb): Stage S1 — Canonical Contract Freeze v2

### Goal
Push API Design & Consistency score from 82 to 90+ as part of the 12-stage 900+ plan.

### Changes
- **Error Code Centralization**: All 18 handler files migrated from raw string error codes to `ErrorCode.*` constants. ErrorCode registry expanded from 12 to 36 codes covering domain-specific errors (contests, moderation, media, state machines).
- **List Response Standardization**: All list endpoints now include canonical `items` key + `pagination` metadata object, with backward-compat aliases for v1 consumers.
- **Pagination Discipline**: All cursor-paginated endpoints now include `pagination: { nextCursor, hasMore }`. All offset-paginated endpoints include `pagination: { total, limit, offset, hasMore }`. Bounded lists include `count`.
- **Contract Version Header**: `x-contract-version: v2` on every API response.
- **Response Contract Builders**: New `/lib/response-contracts.js` with `cursorList()`, `offsetList()`, `simpleList()`, `mutationOk()`.
- **Zero Breaking Changes**: All modifications additive — legacy field names preserved.

### Files
- NEW: `/app/lib/response-contracts.js`
- NEW: `/app/memory/freeze/S1-contract-freeze-v2.md`
- MODIFIED: `/app/lib/constants.js` (ErrorCode 12→36)
- MODIFIED: `/app/lib/freeze-registry.js` (version v1→v2)
- MODIFIED: `/app/app/api/[[...path]]/route.js` (v2 header)
- MODIFIED: All 18 handlers in `/app/lib/handlers/`

### Tests
- 16/16 contract v2 tests PASS (testing agent)
- All existing B0 freeze tests remain compatible

---


## 2026-03-08: Stage 12X — Tribe Contest Engine

### Built
- Complete in-app Tribe Contest Module with 25+ API endpoints
- 7 new/upgraded collections: tribe_contests (upgraded), tribe_contest_rules, tribe_contest_entries (upgraded), tribe_contest_scores, tribe_contest_results, contest_votes, contest_judge_scores
- 27 new indexes across all contest collections
- Full contest lifecycle: DRAFT → PUBLISHED → ENTRY_OPEN → ENTRY_CLOSED → EVALUATING → LOCKED → RESOLVED
- 4 scoring models: reel_hybrid_v1, participation_v1, judge_only_v1, tribe_battle_v1
- Anti-cheat: duplicate vote/entry protection, self-vote blocking, vote caps, idempotent resolution
- Judge scoring system with rubric-based evaluation
- Versioned contest rules
- Auto tribe assignment on user registration
- Contest dashboard for admins

### Files Created/Modified
- NEW: `/app/lib/handlers/tribe-contests.js` (~800 lines)
- MODIFIED: `/app/app/api/[[...path]]/route.js` (new routes)
- MODIFIED: `/app/lib/db.js` (27 new indexes)
- MODIFIED: `/app/lib/handlers/auth.js` (auto tribe assignment)

### Test Results
- 12/15 automated tests passed (80% - 3 failures were network timeouts)
- 15/15 explain plans IXSCAN (zero COLLSCAN)
- Salute ledger integrity: 100% (standings match ledger for all tribes)
- Idempotent resolution: verified (double resolve returns same result)

## 2026-03-08: Stage 12X — Gold Freeze Gate PASSED (12/12)

### Gold Freeze Validation
- Built and ran comprehensive 69-test Gold Freeze proof suite
- All 12 gates passed: Timeout Closure, Replay/Idempotency, Concurrency, Ledger Integrity, Lifecycle State Machine, RBAC, Anti-Cheat, Load/Performance, Failure Recovery, Manual E2E, Legacy Cleanup, Post-Cleanup Health
- 18/18 explain plans IXSCAN post-cleanup (zero COLLSCAN)
- Ledger integrity: 11 checks, 0 drifts

### Legacy Cleanup (G11)
- Removed awardHousePoints from content.js
- Deprecated /api/house-points route (410 DEPRECATED)
- Removed handleHousePoints import from route.js
- Zero regression after cleanup

### Files Modified
- `/app/lib/handlers/content.js` — Removed house points call
- `/app/app/api/[[...path]]/route.js` — Deprecated house-points route
- `/app/tests/gold_freeze_gate.py` — Comprehensive 69-test proof suite
- `/app/memory/stage_12x_gold_freeze_proof_pack.md` — Full proof pack

## 2026-03-08: Stage 12X-RT — Real-Time Contest Scoreboard

### Built
- 3 SSE endpoints: per-contest live scoreboard, season standings, global activity feed
- Dual-mode transport: Redis Pub/Sub or in-memory EventEmitter (auto-detect)
- Snapshot-on-connect pattern: full state on connect, then streaming deltas
- 7 event types: entry.submitted, vote.cast, score.updated, rank.changed, contest.transition, contest.resolved, standings.updated
- All contest write paths (entry, vote, lifecycle, resolution) broadcast to SSE channels
- Auto-refresh snapshots (30s contests, 60s standings) for stale-client protection
- Heartbeat every 10s with 3s retry hint
- Rank change detection: old vs new ranks compared, direction + delta broadcasted

### Files Created/Modified
- NEW: `/app/lib/contest-realtime.js` (~310 lines)
- MODIFIED: `/app/lib/handlers/tribe-contests.js` (RT publish hooks + recompute-broadcast endpoint)

### Test Results
- 13/13 automated tests passed (100%)
- All 3 SSE endpoints verified with snapshot + delta events
- Real-time broadcasting verified: entry → vote → score → transition → resolution → standings
- Stage 12: 21-Tribe System — STRONG PASS (89/100)
- Stage 10: World's Best Reels — PASS
- Stage 9: World's Best Stories — PASS
- Stages 6-7: Events + Board Notices — PASS
- Stages 1-5: Core features — PASS
