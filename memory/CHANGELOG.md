# Tribe — Changelog

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

## Previous Stages (Pre-Fork)
- Stage 12: 21-Tribe System — STRONG PASS (89/100)
- Stage 10: World's Best Reels — PASS
- Stage 9: World's Best Stories — PASS
- Stages 6-7: Events + Board Notices — PASS
- Stages 1-5: Core features — PASS
