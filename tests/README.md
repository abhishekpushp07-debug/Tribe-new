# Tribe — Test Suite (Stage 4A + 4B-1)

## Overview

This is the canonical test system for the Tribe backend. It replaces all ad-hoc root-level test scripts.
**188 tests** | 78 unit + 104 integration + 6 smoke | 2x idempotent proven

### Architecture

```
tests/
  conftest.py          # Shared fixtures (api_url, db, test_user, admin_user, product_user_a/b, cleanup)
  pytest.ini           # pytest configuration + custom markers
  helpers/
    js_eval.py         # JS eval bridge (runs Node.js code from pytest)
    product.py         # Product test helpers (create_post, like, follow, etc.)
  unit/                # Pure function tests (no network, no DB)
    test_security.py   # sanitizeTextInput, deepSanitizeStrings, maskPII, getEndpointTier
    test_auth_utils.py # hashPin/verifyPin, generateToken, loginThrottle, sanitizeUser
    test_metrics.py    # recordRequest, recordError, getRouteFamily, percentiles, SLIs
    test_logger.py     # PII redaction, NDJSON format, stderr routing
    test_request_context.py # AsyncLocalStorage: isolation, mutation, nesting
    test_health.py     # checkLiveness shape/content (status, uptime, timestamp)
    test_constants.py  # assignHouse determinism, HOUSES completeness, ErrorCode, Role
  integration/         # API endpoint tests (requires running server + MongoDB)
    test_auth_flow.py  # register, login, refresh, replay, logout, pin change
    test_sessions.py   # list, revoke-one, revoke-all
    test_observability.py # healthz, readyz, ops/health, ops/metrics, ops/slis
    test_security_guards.py # XSS, payload size, auth boundaries, security headers
    test_correlation.py # requestId header, audit DB proof, error code metrics proof
    test_ratelimit_options_redis.py # Rate-limit STRICT 429 proof, OPTIONS observability, Redis degraded mode
    product/           # Stage 4B — Product-domain integration tests
      test_posts.py    # Create, get, delete posts — validation, auth, contract shape
      test_feed.py     # Public, following feed — visibility, pagination, distribution rules
      test_social_actions.py # Like, save, comment, follow/unfollow — idempotency, counters
      test_visibility_safety.py # Deleted/HELD/blocked content behavior, view counts
  smoke/               # End-to-end flow tests (minimal, critical paths)
    test_smoke_auth_ops.py  # register→login→me, admin→ops
    test_smoke_metrics.py   # 404→metrics, rate limit visibility
    test_smoke_product.py   # post→feed flow, follow→feed flow
  archive/             # 35+ legacy ad-hoc scripts (preserved, not run)
```

## Stage 4B-1 Product Coverage (NEW)

### Domains Covered
| Domain | File | Tests | What's Tested |
|---|---|---|---|
| Posts | test_posts.py | 11 | Create, get, delete, validation, auth, admin delete, contract shape |
| Feed | test_feed.py | 8 | Public/following feed, distributionStage rules, pagination, contract |
| Social | test_social_actions.py | 17 | Like/save/comment/follow — success, idempotency, counters, auth |
| Visibility | test_visibility_safety.py | 6 | Deleted/HELD/blocked content, view counts, removed content interactions |
| Product Smoke | test_smoke_product.py | 2 | Full register→post→feed flow, follow→post→feed flow |

### Rate Limit Isolation Strategy
Product tests use **4 dedicated test users** to stay within WRITE tier limits (30/min):
- `product_user_a`: Posts tests (heavier WRITE load)
- `product_user_b`: Feed + visibility tests
- `test_user` / `test_user_2`: Social action tests (lighter WRITE load)

### Known Product Behaviors Documented
1. **Block filtering**: Following feed does NOT filter blocked users' posts (query is authorId-based)
2. **Removed content interactions**: Like handler does NOT check `visibility` — soft-deleted posts can still be liked
3. **Distribution stage**: New posts have `distributionStage=0`, won't appear in public (requires 2) or college/house (requires ≥1) feeds

## Running Tests

### Full CI Gate
```bash
bash scripts/ci-gate.sh        # All layers (canonical command)
npm test                       # Same via package.json hook
make test                      # Same via Makefile hook
```

### By Directory (layer)
```bash
python -m pytest tests/unit -v --tb=short -c tests/pytest.ini
python -m pytest tests/integration -v --tb=short -c tests/pytest.ini
python -m pytest tests/smoke -v --tb=short -c tests/pytest.ini
```

### By Marker (selective)
```bash
python -m pytest tests/ -m unit -v -c tests/pytest.ini
python -m pytest tests/ -m integration -v -c tests/pytest.ini
python -m pytest tests/ -m smoke -v -c tests/pytest.ini
```

### Specific file/class
```bash
python -m pytest tests/unit/test_security.py -v --tb=short -c tests/pytest.ini
python -m pytest tests/unit/test_security.py::TestSanitizeTextInput -v -c tests/pytest.ini
```

### Coverage
```bash
# Full coverage report (term)
python -m pytest tests/ -v -c tests/pytest.ini --cov=tests --cov-report=term-missing

# Coverage with HTML report
make test-coverage

# Coverage baseline: 96% across test code (no fake threshold set)
```

### Makefile shortcuts
```bash
make test              # Full CI gate
make test-unit         # Unit layer only
make test-integration  # Integration layer only
make test-smoke        # Smoke layer only
make test-coverage     # Full run with coverage report
make test-collect      # Dry run (collect only)
```

## Test Isolation Strategy

- **Phone namespace**: All test users use phone numbers starting with `99999`
- **IP isolation**: Each test gets a unique `X-Forwarded-For` IP to prevent rate-limit collisions
- **Session cleanup**: `conftest.py::pytest_sessionfinish` removes ALL test-namespaced data
- **Idempotent**: Tests handle "already exists" gracefully—safe to re-run
- **No production pollution**: Only `99999*` phones are touched

## Unit Test Approach (JS Bridge)

Since the Tribe backend is JavaScript (Next.js), unit tests use a **JS eval bridge**:
- `tests/helpers/js_eval.py` creates temporary `.mjs` files
- Node.js executes them, importing real JS modules
- Results are returned as parsed JSON to pytest
- This gives us pytest-native test collection while testing actual JS functions

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TEST_API_URL` | `http://localhost:3000/api` | API base URL |
| `TEST_MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection |
| `TEST_DB_NAME` | `your_database_name` | Database name |

## CI Gate

`scripts/ci-gate.sh` runs all three layers in sequence. Exits non-zero if ANY layer fails.

```bash
./scripts/ci-gate.sh           # All layers
./scripts/ci-gate.sh unit      # Just unit
./scripts/ci-gate.sh integration # Just integration
./scripts/ci-gate.sh smoke     # Just smoke
```

## Known Limitations

1. **No separate test DB**: Tests use the same database as the app, relying on phone prefix namespace (`99999*`) for isolation. A physically separate test database is deferred to Stage 10.
2. **Redis recovery untestable**: Redis is unavailable in this environment, so the rate limiter runs in memory-fallback mode. Redis up→down→up recovery cannot be tested. The degraded-mode behavior IS directly asserted (4 tests in `test_ratelimit_options_redis.py`).
3. **Session-scoped cleanup only**: Cleanup runs after the full session, not per-test. A test failure mid-session may leave some data behind until the next run.
4. **Login throttle persistence**: The in-memory login throttle persists across rapid re-runs with the same phone. Mitigated by using random phone suffixes.
