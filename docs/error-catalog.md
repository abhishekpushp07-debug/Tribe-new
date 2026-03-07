# Tribe API — Error Catalog

## Error Response Format

All errors return:
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

HTTP status codes are always semantically correct.

## Error Codes

| Code | HTTP Status | Description | Example |
|------|-------------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Invalid input | Missing field, bad format, too long |
| `UNAUTHORIZED` | 401 | Auth required or invalid | No token, expired token, wrong PIN |
| `FORBIDDEN` | 403 | Insufficient permissions | User trying mod action, IDOR blocked |
| `NOT_FOUND` | 404 | Resource not found | Bad content ID, no such user |
| `CONFLICT` | 409 | Duplicate resource | Phone taken, duplicate report |
| `RATE_LIMITED` | 429 | Too many requests | >120 req/min IP, >5 failed logins |
| `PAYLOAD_TOO_LARGE` | 413 | Upload too big | Image >5MB, video >30MB |
| `INTERNAL_ERROR` | 500 | Server error | DB failure, unhandled exception |
| `AGE_REQUIRED` | 403 | Age not set | Trying to post before age onboarding |
| `CHILD_RESTRICTED` | 403 | Under-18 feature gate | Child trying media upload |
| `BANNED` | 403 | Permanent ban | Banned user trying to login |
| `SUSPENDED` | 403 | Temporary suspension | Suspended user trying to login |

## Validation Error Examples

```
POST /auth/register {}
→ 400 {"error": "phone, pin, and displayName are required", "code": "VALIDATION_ERROR"}

POST /auth/register {"phone": "123", "pin": "1234", "displayName": "A"}
→ 400 {"error": "Phone must be exactly 10 digits", "code": "VALIDATION_ERROR"}

POST /content/posts {"kind": "REEL"}
→ 400 {"error": "REEL requires at least one media attachment", "code": "VALIDATION_ERROR"}

POST /content/posts {} (empty post)
→ 400 {"error": "Post must have caption or media", "code": "VALIDATION_ERROR"}
```

## Auth Error Examples

```
GET /auth/me (no header)
→ 401 {"error": "Authentication required", "code": "UNAUTHORIZED"}

POST /auth/login {"phone": "9999999999", "pin": "0000"}
→ 401 {"error": "Invalid phone or PIN", "code": "UNAUTHORIZED"}

POST /auth/login (6th attempt in 15 min)
→ 429 {"error": "Too many failed attempts. Try again in 847 seconds", "code": "RATE_LIMITED"}
```

## IDOR / Permission Error Examples

```
GET /users/{otherId}/saved (trying to view someone else's saves)
→ 403 {"error": "Can only view your own saved items", "code": "FORBIDDEN"}

GET /moderation/queue (non-moderator)
→ 403 {"error": "Moderator access required", "code": "FORBIDDEN"}

DELETE /content/{id} (not author and not moderator)
→ 403 {"error": "Forbidden", "code": "FORBIDDEN"}
```
