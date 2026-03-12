# 02 — Auth System

## Overview

Tribe uses a **PIN-based authentication system** with **split access/refresh token model**, brute-force protection, session management, and full security audit trail.

**Source files**: `lib/handlers/auth.js` (544 lines), `lib/auth-utils.js` (472 lines)

---

## Authentication Flow

```
┌─────────────────────────────────────────────────┐
│                  REGISTRATION                    │
│                                                  │
│  POST /api/auth/register                        │
│  Body: { phone, pin, displayName }              │
│                                                  │
│  1. Validate: phone=10 digits, pin=4 digits     │
│  2. Check uniqueness (phone)                     │
│  3. Hash PIN: PBKDF2(pin, salt, 100K iterations)│
│  4. Auto-assign tribe via SHA256(userId) mod 21  │
│  5. Create user document                        │
│  6. Create session (access + refresh tokens)    │
│  7. Record tribe membership                     │
│  8. Security audit: REGISTER_SUCCESS            │
│                                                  │
│  Returns: accessToken, refreshToken, user        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                    LOGIN                         │
│                                                  │
│  POST /api/auth/login                           │
│  Body: { phone, pin }                           │
│                                                  │
│  1. Brute force check (5 attempts → 15min lock) │
│  2. Find user by phone                          │
│  3. Check banned/suspended status               │
│  4. Verify PIN (timing-safe comparison)         │
│  5. Clear brute force tracker on success        │
│  6. Create new session                          │
│  7. Update lastActiveAt                         │
│  8. Security audit: LOGIN_SUCCESS               │
│                                                  │
│  Returns: accessToken, refreshToken, user        │
└─────────────────────────────────────────────────┘
```

---

## Token Architecture

### Access Token
- **Format**: `at_<64-char-hex>` (prefix `at_` for identification)
- **TTL**: 15 minutes (`Config.ACCESS_TOKEN_TTL_MS = 900,000ms`)
- **Usage**: Sent in `Authorization: Bearer at_xxx` header
- **Rotation**: Not rotatable — expires and requires refresh

### Refresh Token
- **Format**: `rt_<96-char-hex>` (prefix `rt_`)
- **TTL**: 30 days (`Config.REFRESH_TOKEN_TTL_MS = 2,592,000,000ms`)
- **Usage**: Sent to `POST /api/auth/refresh` endpoint only
- **Rotation**: Every refresh generates a new pair (access + refresh)
- **Reuse Detection**: Old refresh tokens tracked for replay attack detection

### Token Generation
```javascript
// Access token: 32 random bytes = 64 hex chars + "at_" prefix
generateAccessToken() → `at_${crypto.randomBytes(32).toString('hex')}`

// Refresh token: 48 random bytes = 96 hex chars + "rt_" prefix  
generateRefreshToken() → `rt_${crypto.randomBytes(48).toString('hex')}`
```

---

## PIN Hashing

| Parameter | Value |
|-----------|-------|
| Algorithm | PBKDF2 |
| Iterations | 100,000 |
| Key Length | 64 bytes |
| Digest | SHA-512 |
| Salt | 32 random bytes (per user) |

```javascript
// Hash: PBKDF2(pin, salt, 100000, 64, 'sha512')
hashPin(pin, salt) → crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha512').toString('hex')

// Verify: timing-safe comparison to prevent timing attacks
verifyPin(pin, salt, hash) → crypto.timingSafeEqual(
  Buffer.from(hashPin(pin, salt), 'hex'),
  Buffer.from(hash, 'hex')
)
```

---

## Session Management

### Session Document Schema
```json
{
  "id": "uuid-v4",
  "userId": "user-uuid",
  "token": "at_...",                       // Current access token
  "accessTokenExpiresAt": "2026-03-12T15:15:00Z",
  "refreshToken": "rt_...",               // Current refresh token
  "refreshTokenFamily": "uuid-v4",        // Family ID for rotation chain
  "refreshTokenVersion": 0,               // Incremented on each rotation
  "refreshTokenExpiresAt": "2026-04-11T15:00:00Z",
  "refreshTokenUsed": false,
  "rotatedRefreshTokens": ["rt_old1", "rt_old2"],  // Last 5 for reuse detection
  "ipAddress": "1.2.3.4",
  "deviceInfo": "Mozilla/5.0...",
  "lastAccessedAt": "2026-03-12T15:00:00Z",
  "lastRefreshedAt": null,
  "expiresAt": "2026-04-11T15:00:00Z",   // Legacy compat
  "createdAt": "2026-03-12T15:00:00Z"
}
```

### Session Limits
- **Max concurrent sessions per user**: 10 (`Config.MAX_SESSIONS_PER_USER`)
- **Eviction policy**: When limit reached, oldest session (by `lastAccessedAt`) is evicted
- **lastAccessedAt update**: Throttled to max once per 60 seconds to reduce writes

---

## Token Refresh Flow

```
POST /api/auth/refresh
Body: { "refreshToken": "rt_..." }

┌──────────────────────────────────────────────────┐
│  1. Find session by refresh token                │
│                                                   │
│  If NOT found:                                    │
│    → Check rotatedRefreshTokens[] for reuse       │
│    → If found → REPLAY ATTACK DETECTED            │
│    → Revoke ENTIRE token family                   │
│    → Return 401 REFRESH_TOKEN_REUSED              │
│    → Security audit: CRITICAL severity            │
│                                                   │
│  2. Check refresh token expiry                    │
│     → If expired → delete session → 401           │
│                                                   │
│  3. Check user status (banned/suspended)          │
│     → If banned → delete session → 403            │
│                                                   │
│  4. Generate new access + refresh tokens          │
│                                                   │
│  5. Update session:                               │
│     → Set new tokens                              │
│     → Increment refreshTokenVersion               │
│     → Push old refresh token to rotatedRefreshTokens│
│     → Keep only last 5 (sliding window)           │
│                                                   │
│  6. Return new token pair + user                  │
└──────────────────────────────────────────────────┘
```

### Replay Attack Protection
When a refresh token is reused (presented after it was already rotated), the system:
1. Detects the token in `rotatedRefreshTokens[]`
2. Identifies the `refreshTokenFamily`
3. Deletes ALL sessions in that family
4. Logs a CRITICAL security audit event

---

## Brute Force Protection

### Mechanism
In-memory `Map<phone, { count, lockedUntil }>` tracks failed login attempts.

| Parameter | Value |
|-----------|-------|
| Max attempts | 5 |
| Lockout duration | 15 minutes |
| Cleanup interval | Every 10 minutes (stale entries) |

### Flow
```
Login attempt:
  1. checkLoginThrottle(phone) → { allowed: true/false, retryAfterSec }
  2. If locked → Security audit: LOGIN_THROTTLED (WARN)
  3. If wrong PIN → recordLoginFailure(phone) → increment counter
  4. If 5th failure → lock for 15 minutes
  5. If correct PIN → clearLoginFailures(phone) → reset counter
```

---

## Endpoints

### `POST /api/auth/register`
Create a new account.

**Request:**
```json
{
  "phone": "7777099001",
  "pin": "1234",
  "displayName": "John Doe"
}
```

**Response (201):**
```json
{
  "accessToken": "at_1e80edfa...",
  "refreshToken": "rt_48411516...",
  "expiresIn": 900,
  "token": "at_1e80edfa...",
  "user": {
    "id": "514164c7-c889-4edf-b394-5a0985f4bc5a",
    "phone": "7777099001",
    "displayName": "John Doe",
    "username": null,
    "bio": "",
    "role": "USER",
    "tribeId": "...",
    "tribeName": "Aryabhatta",
    "onboardingComplete": false,
    "onboardingStep": "AGE"
  }
}
```

**Validations:**
- `phone`: Exactly 10 digits (`/^\d{10}$/`)
- `pin`: Exactly 4 digits (`/^\d{4}$/`)
- `displayName`: 2-50 characters (sanitized, trimmed)
- Phone must be unique (409 CONFLICT if exists)

### `POST /api/auth/login`
Authenticate and get tokens.

**Request:**
```json
{
  "phone": "7777099001",
  "pin": "1234"
}
```

**Response (200):**
```json
{
  "accessToken": "at_...",
  "refreshToken": "rt_...",
  "expiresIn": 900,
  "token": "at_...",
  "user": { ... }
}
```

**Error Responses:**
| Status | Code | Condition |
|--------|------|-----------|
| 400 | VALIDATION_ERROR | Missing phone/pin |
| 401 | UNAUTHORIZED | Wrong phone or PIN |
| 403 | BANNED | Account permanently banned |
| 403 | SUSPENDED | Account temporarily suspended |
| 429 | RATE_LIMITED | Too many failed attempts (5+) |

### `POST /api/auth/refresh`
Rotate refresh token and get new token pair.

**Request:**
```json
{
  "refreshToken": "rt_48411516..."
}
```

**Response (200):**
```json
{
  "accessToken": "at_new...",
  "refreshToken": "rt_new...",
  "expiresIn": 900,
  "token": "at_new...",
  "user": { ... }
}
```

### `POST /api/auth/logout`
Destroy current session.

**Headers:** `Authorization: Bearer at_xxx`

**Response:** `{ "message": "Logged out" }`

### `GET /api/auth/me`
Get current user profile.

**Response:** `{ "user": { ... } }`

### `GET /api/auth/sessions`
List all active sessions for current user.

**Response:**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "deviceInfo": "Mozilla/5.0...",
      "ipAddress": "1.2.3.4",
      "lastAccessedAt": "2026-03-12T15:00:00Z",
      "createdAt": "2026-03-12T14:50:00Z",
      "expiresAt": "2026-04-11T14:50:00Z",
      "isCurrent": true
    }
  ],
  "count": 1,
  "maxSessions": 10
}
```

### `DELETE /api/auth/sessions`
Revoke ALL sessions (force logout everywhere).

**Response:** `{ "message": "All sessions revoked", "revokedCount": 3 }`

### `DELETE /api/auth/sessions/:id`
Revoke a specific session by ID (cannot revoke current session).

### `PATCH /api/auth/pin`
Change PIN (requires re-authentication with current PIN).

**Request:**
```json
{
  "currentPin": "1234",
  "newPin": "5678"
}
```

**Side Effects:**
1. All OTHER sessions are revoked
2. A new session is created for current device
3. Old current session is deleted

---

## Authentication Middleware

### `authenticate(request, db)` — Optional Auth
Returns `user` object or `null`. Does not throw.

```javascript
const user = await authenticate(request, db)
// user can be null if not logged in
```

### `requireAuth(request, db)` — Required Auth
Returns `user` object or throws `{ status: 401, code: 'UNAUTHORIZED' }`.

```javascript
const user = await requireAuth(request, db)
// Guaranteed to have a valid user
```

### `requireRole(user, ...roles)` — Role Check
Throws `{ status: 403, code: 'FORBIDDEN' }` if user's role is not in the allowed list.

```javascript
requireRole(user, 'ADMIN', 'SUPER_ADMIN')
```

### `requireOwnerOrMod(user, resourceOwnerId)` — IDOR Protection
Ensures user is either the resource owner or a moderator+.

---

## Security Audit Trail

Every auth event is logged to both `audit_log` and `security_audit_log` collections:

| Event | Severity | Trigger |
|-------|----------|---------|
| REGISTER_SUCCESS | INFO | Successful registration |
| LOGIN_SUCCESS | INFO | Successful login |
| LOGIN_FAILED | WARN | Wrong PIN or unknown phone |
| LOGIN_THROTTLED | WARN | Brute force lockout triggered |
| LOGIN_BLOCKED_BANNED | WARN | Banned user tried to login |
| REFRESH_SUCCESS | INFO | Token refresh |
| REFRESH_FAILED | WARN | Invalid/expired refresh token |
| REFRESH_TOKEN_REUSE_DETECTED | CRITICAL | Replay attack detected |
| LOGOUT_CURRENT | INFO | User logged out |
| REVOKE_ALL_SESSIONS | INFO | Force logout all devices |
| REVOKE_ONE_SESSION | INFO | Revoke specific session |
| PIN_CHANGED | INFO | PIN changed successfully |
| PIN_CHANGE_FAILED | WARN | Wrong current PIN during change |

---

## Android Implementation Guide

### Token Storage (EncryptedSharedPreferences)
```kotlin
class TokenStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "tribe_tokens",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    
    var accessToken: String?
        get() = prefs.getString("access_token", null)
        set(value) = prefs.edit().putString("access_token", value).apply()
    
    var refreshToken: String?
        get() = prefs.getString("refresh_token", null)
        set(value) = prefs.edit().putString("refresh_token", value).apply()
}
```

### OkHttp Auth Interceptor
```kotlin
class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = tokenStore.accessToken ?: return chain.proceed(request)
        
        val authedRequest = request.newBuilder()
            .addHeader("Authorization", "Bearer $token")
            .build()
        
        val response = chain.proceed(authedRequest)
        
        // If 401 with ACCESS_TOKEN_EXPIRED, try refresh
        if (response.code == 401) {
            val body = response.peekBody(1024).string()
            if (body.contains("ACCESS_TOKEN_EXPIRED")) {
                response.close()
                return refreshAndRetry(chain, request)
            }
        }
        
        return response
    }
    
    @Synchronized
    private fun refreshAndRetry(chain: Interceptor.Chain, original: Request): Response {
        val refreshToken = tokenStore.refreshToken ?: return chain.proceed(original)
        
        val refreshRequest = Request.Builder()
            .url("${BASE_URL}/api/auth/refresh")
            .post("""{"refreshToken":"$refreshToken"}""".toRequestBody("application/json".toMediaType()))
            .build()
        
        val refreshResponse = OkHttpClient().newCall(refreshRequest).execute()
        if (refreshResponse.isSuccessful) {
            val json = JSONObject(refreshResponse.body!!.string())
            tokenStore.accessToken = json.getString("accessToken")
            tokenStore.refreshToken = json.getString("refreshToken")
            
            return chain.proceed(
                original.newBuilder()
                    .header("Authorization", "Bearer ${tokenStore.accessToken}")
                    .build()
            )
        }
        
        // Refresh failed — force re-login
        tokenStore.accessToken = null
        tokenStore.refreshToken = null
        return chain.proceed(original)
    }
}
```

---

## Source Files
- `/app/lib/handlers/auth.js` — Auth endpoints
- `/app/lib/auth-utils.js` — Auth utilities, session management, token generation
- `/app/lib/security.js` — Security audit logging
- `/app/lib/constants.js` — Error codes, config values
