# B0.11 — Contract Governance Rules
> Generated: 2026-03-10
> Purpose: Prevent B0 contract from going stale when code changes

---

## Rule 1: Route Addition Requires Doc Update

When a new route is added to ANY handler file:
1. Update `route_inventory_raw.json` via `generate_route_json.mjs`
2. Update `route_inventory_human.md` (add to correct domain section)
3. Update `API_REFERENCE.md` (add to correct domain)
4. Update `route_manifest.json` (regenerate)
5. Update `domain_map.md` (if new domain created)
6. Update `auth_actor_matrix.md` (add auth entry)

## Rule 2: Request/Response Shape Change Requires Doc Update

When body fields change on any write endpoint:
1. Update `request_contracts.md`
2. Update `API_REFERENCE.md`

When response shape changes on any read endpoint:
1. Update `response_contracts.md`
2. Update `API_REFERENCE.md`

## Rule 3: Error Code Change Requires Doc Update

When new error codes are added or error behavior changes:
1. Update `error_contracts.md`
2. Update `API_REFERENCE.md` (Error Semantics section)

## Rule 4: New Quirk Discovery

When a non-obvious behavior is found:
1. Add to `quirk_ledger.md`
2. Update `API_REFERENCE.md` (Quirks section)

---

## Snapshot Baseline for Drift Detection

| Metric | Value at B0 Freeze |
|---|---|
| Total live routes | 266 |
| Handler files | 16 active + 1 dead |
| Handler code lines | 13,766 |
| GET routes | 124 |
| POST routes | 98 |
| DELETE routes | 25 |
| PATCH routes | 19 |
| Public routes | 36 |
| Auth required routes | 119 |
| Admin routes | 71 |
| SSE endpoints | 1 |
| Upload endpoints | 1 |
| Binary endpoints | 1 |
| Known bugs | 2 (reel comment, reel report) |
| Known gaps | 3 (post search, visibility enforcement, avatar URL) |

---

## Drift Check Script

To verify contract hasn't drifted, run:
```bash
node scripts/generate_route_json.mjs
# Compare output route count against baseline (266)
# Check for new routes not in API_REFERENCE.md
```

---

## Contract File Index

| File | Purpose | Size |
|---|---|---|
| `route_inventory_raw.json` | Machine-readable full inventory | 4602 lines |
| `route_inventory_human.md` | Human-readable census | 266 routes |
| `route_anomalies.md` | 11 anomalies documented | — |
| `route_census_coverage.md` | Quality gate + honesty file | — |
| `domain_map.md` | Domain classification + screen map | — |
| `auth_actor_matrix.md` | Per-endpoint auth detail | — |
| `request_contracts.md` | Write endpoint body specs | — |
| `response_contracts.md` | Read endpoint response shapes | — |
| `error_contracts.md` | Error codes + edge cases | — |
| `pagination_and_streams.md` | Cursor/offset/SSE details | — |
| `quirk_ledger.md` | 17 frontend gotchas | — |
| `API_REFERENCE.md` | **Master reference** (consolidation) | — |
| `route_manifest.json` | Lightweight manifest for tooling | — |
| `B0_FREEZE.md` | Freeze package + known unknowns | — |
