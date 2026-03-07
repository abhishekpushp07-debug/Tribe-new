# Tribe — Auth Flow Documentation

## Registration Flow

```
Client                           Server                    MongoDB
  |                                |                         |
  |  POST /auth/register           |                         |
  |  {phone, pin, displayName}     |                         |
  |------------------------------->|                         |
  |                                |  Validate inputs        |
  |                                |  - phone: 10 digits     |
  |                                |  - PIN: 4 digits        |
  |                                |  - name: 2-50 chars     |
  |                                |                         |
  |                                |  Check duplicate phone  |
  |                                |------------------------>|
  |                                |                         |
  |                                |  Generate salt (32 bytes random)
  |                                |  Hash PIN (PBKDF2-SHA512, 100K iterations, 64-byte key)
  |                                |                         |
  |                                |  Assign house:          |
  |                                |  SHA256(userId) mod 12  |
  |                                |  (deterministic, permanent)
  |                                |                         |
  |                                |  Insert user            |
  |                                |------------------------>|
  |                                |                         |
  |                                |  Generate session token |
  |                                |  (48 bytes random hex)  |
  |                                |  TTL: 30 days           |
  |                                |------------------------>|
  |                                |                         |
  |                                |  Write audit log        |
  |                                |------------------------>|
  |                                |                         |
  |  201 {token, user}             |                         |
  |<-------------------------------|                         |
```

## Login Flow (with Brute Force Protection)

```
Client                           Server                    In-Memory Store
  |                                |                         |
  |  POST /auth/login              |                         |
  |  {phone, pin}                  |                         |
  |------------------------------->|                         |
  |                                |  Check brute force      |
  |                                |  throttle for phone     |
  |                                |------------------------>|
  |                                |                         |
  |                                |  IF >= 5 failures in    |
  |                                |  last 15 min:           |
  |  429 {"Rate limited"}          |  → REJECT              |
  |<-------------------------------|                         |
  |                                |                         |
  |                                |  ELSE: proceed          |
  |                                |  Lookup user by phone   |
  |                                |  Verify PIN (PBKDF2     |
  |                                |  + timing-safe compare) |
  |                                |                         |
  |                                |  IF PIN wrong:          |
  |                                |  → Record failure       |
  |                                |  → Audit log            |
  |  401 {"Invalid"}               |                         |
  |<-------------------------------|                         |
  |                                |                         |
  |                                |  IF PIN correct:        |
  |                                |  → Clear failure count  |
  |                                |  → Create session       |
  |                                |  → Audit log            |
  |  200 {token, user}             |                         |
  |<-------------------------------|                         |
```

## Token Lifecycle

| Event | Effect on Sessions |
|-------|--------------------|
| Register | Creates 1 session (30-day TTL) |
| Login | Creates 1 session (30-day TTL) |
| Logout | Deletes current session only |
| PIN Change | Revokes all sessions EXCEPT current |
| Revoke All | Deletes ALL sessions (DELETE /auth/sessions) |
| Session Expiry | MongoDB TTL index auto-deletes after 30 days |
| Ban | Token still exists, but middleware rejects on every request |
| Suspend | Token still exists, but middleware rejects until suspendedUntil |

## Security Properties

| Property | Implementation |
|----------|----------------|
| PIN Storage | PBKDF2-SHA512, 100K iterations, 64-byte key, 32-byte random salt |
| PIN Comparison | `crypto.timingSafeEqual()` — constant-time |
| Token Generation | `crypto.randomBytes(48).toString('hex')` — 96 chars |
| Brute Force | 5 failures per phone number → 15 min lockout |
| Rate Limiting | 120 requests per minute per IP |
| Session Storage | MongoDB with TTL index (auto-expire) |
| Password Reset | PIN change via authenticated endpoint |

## Pagination Contract

All list endpoints use cursor-based pagination:

```
GET /endpoint?cursor=<ISO8601>&limit=<1-50>

Response:
{
  "items": [...],
  "nextCursor": "2026-03-07T18:35:23.666Z" | null
}
```

- `cursor`: ISO8601 timestamp of the last item from previous page
- `limit`: default 20, max 50
- `nextCursor`: null means no more pages
- Sort: always `createdAt DESC` (newest first)

## House Assignment Spec

```javascript
import crypto from 'crypto'

function assignHouse(userId) {
  const hash = crypto.createHash('sha256').update(userId).digest('hex')
  const index = parseInt(hash.slice(0, 8), 16) % 12
  return HOUSES[index]
}
```

Properties:
- **Deterministic**: Same userId always gives same house
- **Permanent**: Cannot be changed after assignment
- **Uniform**: SHA256 provides near-uniform distribution across 12 houses
- **Unforgeable**: Based on server-generated UUID, not user-controlled input
