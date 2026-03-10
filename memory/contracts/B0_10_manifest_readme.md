# B0.10 — Machine-Readable Route Manifest
> Generated: 2026-03-10 | Source: route_inventory_raw.json
> Purpose: Tooling, codegen, SDK generation, drift detection

---

## File: `/app/memory/contracts/route_inventory_raw.json`

Already generated with 266 routes. Each entry contains:
- `method`: HTTP method
- `final_path`: Full API path
- `handler_file`: Source handler file
- `handler_function`: Handler function name
- `domain`: Domain classification
- `route_type`: JSON_READ/JSON_WRITE/ADMIN_ACTION/STREAM_SSE/MEDIA_UPLOAD/MEDIA_BINARY/HEALTHCHECK/DEPRECATED
- `auth_present`: boolean
- `role_guard`: none/mod/admin
- `stream_flag`: boolean
- `upload_flag`: boolean
- `binary_flag`: boolean
- `deprecated_suspect`: boolean
- `runtime_confidence`: code-read-confirmed/runtime-hit-confirmed/runtime-bug-observed
- `business_criticality`: P0/P1/P2
- `notes`: Human-readable context

## File: `/app/memory/contracts/route_manifest.json`

Lightweight manifest for quick consumption:
