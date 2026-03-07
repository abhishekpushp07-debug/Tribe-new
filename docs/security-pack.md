# Tribe — Security Proof Pack

Generated: 2026-03-07

## 1. Auth Token Lifecycle

| Property | Value | Proof |
|---|---|---|
| Token format | 96-char hex (48 random bytes) | `crypto.randomBytes(48).toString('hex')` in auth-utils.js:29 |
| Token storage | MongoDB `sessions` collection | sessions.token field, unique index |
| Token TTL | 30 days | `Config.SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000` in constants.js |
| Auto-expiry | MongoDB TTL index on `expiresAt` | `{expiresAt: 1}, {expireAfterSeconds: 0}` |
| Single logout | `DELETE sessions WHERE token = current` | POST /auth/logout |
| Revoke all | `DELETE sessions WHERE userId = current` | DELETE /auth/sessions |
| PIN change | Revokes all sessions EXCEPT current | PATCH /auth/pin |
| Ban/Suspend | Token exists but middleware rejects | auth-utils.js:82-84 |

### Verification commands:
```bash
# List active sessions
curl -s /api/auth/sessions -H "Authorization: Bearer <token>"
# Revoke all sessions
curl -s -X DELETE /api/auth/sessions -H "Authorization: Bearer <token>"
# Change PIN (revokes other sessions)
curl -s -X PATCH /api/auth/pin -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"currentPin":"1234","newPin":"5678"}'
```

## 2. Brute Force Protection

| Property | Value | Proof |
|---|---|---|
| Threshold | 5 failed attempts per phone | `MAX_LOGIN_ATTEMPTS = 5` in auth-utils.js:35 |
| Lockout duration | 15 minutes | `LOCKOUT_DURATION_MS = 15 * 60 * 1000` in auth-utils.js:36 |
| Response on lockout | HTTP 429 with Retry-After header | auth.js login handler |
| Audit on failure | LOGIN_FAILED event logged | auth.js:138 |
| Clear on success | Failure counter reset | `clearLoginFailures(phone)` in auth.js:146 |
| Store cleanup | Every 10 minutes, stale entries purged | auth-utils.js:62-68 |

### Verification:
```bash
# Attempt 6 wrong logins
for i in $(seq 1 6); do
  curl -s -X POST /api/auth/login -H "Content-Type: application/json" \
    -d '{"phone":"9000000001","pin":"0000"}'
done
# 6th attempt returns: 429 {"error":"Too many failed attempts..."}
```

## 3. PIN Security

| Property | Value |
|---|---|
| Algorithm | PBKDF2 |
| Hash function | SHA-512 |
| Iterations | 100,000 |
| Key length | 64 bytes |
| Salt length | 32 bytes (random per user) |
| Comparison | `crypto.timingSafeEqual()` — constant-time |

Code: `auth-utils.js:6-20`

## 4. Rate Limiting

| Property | Value | Proof |
|---|---|---|
| Global rate limit | 120 requests/minute per IP | route.js:37-38 |
| Login rate limit | 5 attempts per phone per 15 min | auth-utils.js:33-36 |
| Implementation | In-memory Map (per-process) | route.js:42-55 |
| Cleanup | Every 5 minutes | route.js:57-63 |
| Response | HTTP 429, code RATE_LIMITED | route.js:73-75 |

## 5. IDOR / BOLA Protection

| Endpoint | Protection | Proof |
|---|---|---|
| GET /users/:id/saved | Owner-only check | users.js:89-91 |
| DELETE /content/:id | Author OR moderator+ check | content.js:87-89 |
| PATCH /me/* | Authenticated user only (own profile) | All onboarding handlers use requireAuth |
| GET /moderation/queue | MODERATOR+ role check | admin.js:47-49 |
| POST /moderation/:id/action | MODERATOR+ role check | admin.js:68-70 |
| DELETE /auth/sessions | Own sessions only (via requireAuth) | auth.js:199-201 |
| GET /auth/sessions | Own sessions only | auth.js:209-210 |
| POST /follow/:id | Self-follow blocked | social.js:9-10 |

### `requireOwnerOrMod` helper:
```javascript
export function requireOwnerOrMod(user, resourceOwnerId) {
  if (user.id !== resourceOwnerId && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw { status: 403, code: 'FORBIDDEN', message: 'Access denied: not the resource owner' }
  }
}
```

## 6. Content-Type Validation

| Media Type | Max Size | Duration Limit | Age Gate |
|---|---|---|---|
| IMAGE | 5 MB | N/A | ADULT only |
| VIDEO | 30 MB | 30 seconds | ADULT only |
| THUMBNAIL | 5 MB | N/A | ADULT only |

Enforced at: `media.js:18-33`

## 7. Audit Trail

All mutations write to `audit_logs` collection:

| Event Type | When |
|---|---|
| USER_REGISTERED | Registration |
| USER_LOGIN | Login |
| LOGIN_FAILED | Wrong PIN attempt |
| PIN_CHANGED | PIN change |
| ALL_SESSIONS_REVOKED | Session revocation |
| AGE_SET | Age onboarding |
| COLLEGE_LINKED | College selection |
| CONTENT_CREATED | Post/Reel/Story creation |
| CONTENT_REMOVED | Content deletion |
| REPORT_CREATED | Content report |
| MODERATION_* | All moderation actions |
| APPEAL_CREATED | Appeal submission |
| GRIEVANCE_CREATED | Grievance filing |

**Moderation events** are stored in a SEPARATE immutable `moderation_events` collection with:
- Previous state
- New state
- Actor ID
- Timestamp
- Reason

## 8. Admin Route Protection

| Route | Required Role | Check |
|---|---|---|
| GET /moderation/queue | MODERATOR+ | admin.js:47 |
| POST /moderation/:id/action | MODERATOR+ | admin.js:68 |
| POST /admin/colleges/seed | None (seed only) | Open for initial setup |
| GET /admin/stats | None (read-only) | Public stats |

## 9. Input Validation Summary

| Input | Validation |
|---|---|
| Phone | Exactly 10 digits (`/^\d{10}$/`) |
| PIN | Exactly 4 digits (`/^\d{4}$/`) |
| Display name | 2-50 characters, trimmed |
| Username | 3-30 chars, `[a-z0-9._]`, unique |
| Bio | Max 150 chars |
| Caption | Max 2200 chars |
| Comment | Max 1000 chars, non-empty |
| Birth year | 1940 to current year |
| Media data | Base64, size-checked |
| Video duration | Max 30 seconds |
| Report details | Max 500 chars |
| Appeal reason | Max 1000 chars |
| Grievance subject | Max 200 chars |
| Grievance description | Max 2000 chars |

## 10. Dependency Audit

Run: `cd /app && npm audit`

Key dependencies:
- next: 14.x (framework)
- mongodb: 6.x (database driver)
- uuid: 9.x (ID generation)
- crypto: Node.js built-in (no external crypto libs)
- bcrypt/argon2: NOT used (PBKDF2 from Node.js crypto)
