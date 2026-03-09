# Tribe — Changelog

## 2026-03-09: Stage 4B-1 Product Coverage — COMPLETE (86/100)

### What Was Added
- **49 new tests** bringing total from 139 → 188
- `tests/helpers/product.py`: Canonical product helpers (create_post, like_post, follow_user, etc.)
- `tests/integration/product/test_posts.py`: 11 tests — post lifecycle
- `tests/integration/product/test_feed.py`: 8 tests — feed behavior + distribution rules
- `tests/integration/product/test_social_actions.py`: 17 tests — like/save/comment/follow
- `tests/integration/product/test_visibility_safety.py`: 6 tests — visibility enforcement
- `tests/smoke/test_smoke_product.py`: 2 E2E product flows

### Fixture Changes
- `product_user_a`, `product_user_b`: New session-scoped fixtures (ADULT, dedicated WRITE budget)
- `test_user`, `test_user_2`: Now auto-set to `ageStatus: 'ADULT'`
- Cleanup extended: content_items, reactions, saves, comments, follows, blocks

### Discoveries
- `ErrorCode.VALIDATION` maps to string `'VALIDATION_ERROR'` (not `'VALIDATION'`)
- WRITE tier rate limit is per-user (not per-IP) — requires user separation strategy
- Feed handler does not implement block filtering (known code gap)

### Verification
- 188/188 passed, 2x idempotent
- Proof pack: `/app/memory/stage_4b1_proof_pack.md`

---

## 2026-03-09: Stage 4A Gold Closure — COMPLETE (87/100)

### Additions
- pytest-cov installed, 96% test code coverage baseline
- health.js (4 tests), constants.js (10 tests) unit tests
- Rate-limit STRICT 429 proof, OPTIONS observability, Redis degraded mode (10 tests)
- Makefile + package.json hooks, marker-based selection

---

## Earlier Stages
- Stage 3 + 3B: Observability — PASS (93/100)
- Stage 2: Security Hardening — PASS (88/100)
