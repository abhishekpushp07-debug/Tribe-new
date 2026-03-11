# Tribe — Anti-Abuse Policy (Phase C Freeze)
**Version**: 1.0 | **Date**: 2026-03-11

## Overview
The anti-abuse system provides foundational protection against engagement spam, velocity abuse, burst attacks, and sockpuppet-like behavior across all social engagement surfaces.

## Covered Action Surfaces
| Action | Handler | Collection Logged |
|--------|---------|-------------------|
| LIKE | social.js, reels.js | abuse_audit_log |
| COMMENT | social.js, reels.js | abuse_audit_log |
| SHARE | social.js, reels.js | abuse_audit_log |
| SAVE | social.js, reels.js | abuse_audit_log |
| FOLLOW | social.js | abuse_audit_log |
| STORY_REACTION | stories.js | abuse_audit_log |
| VIEW | (reserved for future) | - |

## Detection Checks (5-layer)
1. **Velocity Check**: Actions per minute exceeding threshold → flagged + warned
2. **Burst Detection**: 3+ identical actions on same target within window → blocked
3. **Same-Author Concentration**: >70% of recent actions targeting same author → flagged
4. **Rapid Diverse Targeting**: >5 unique targets in 30s → flagged (bot-like)
5. **Cumulative Escalation**: >10 flags in window → account temporarily restricted

## Thresholds
| Action | Per-Minute Limit |
|--------|------------------|
| LIKE | 15 |
| COMMENT | 8 |
| SHARE | 10 |
| SAVE | 12 |
| VIEW | 30 |
| STORY_REACTION | 20 |
| FOLLOW | 10 |

## Severity Levels
- **LOW**: Velocity warning (action allowed, logged)
- **MEDIUM**: Same-author concentration (action allowed, logged)
- **HIGH**: Rapid diverse targeting (action allowed, logged)
- **CRITICAL**: Burst or cumulative escalation (action BLOCKED)

## Behavior
- `allowed: true` + `flagged: true` → action proceeds, logged for admin review
- `allowed: false` → action rejected with 429, logged
- Normal users are never affected (thresholds set well above organic behavior)

## Admin Endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/abuse-dashboard` | GET | ADMIN+ | Summary: total flags, blocked actions, top offenders, by-severity breakdown |
| `/api/admin/abuse-log` | GET | ADMIN+ | Detailed audit log entries with severity/userId/hours filters |

### Query Parameters
- `hours` (default 24, max 168)
- `severity` (LOW/MEDIUM/HIGH/CRITICAL)
- `userId` (specific user filter)
- `limit` (default 50, max 200)

## Audit Collection Schema: `abuse_audit_log`
```json
{
  "userId": "string",
  "actionType": "LIKE|COMMENT|SHARE|SAVE|FOLLOW|STORY_REACTION",
  "targetId": "string",
  "severity": "LOW|MEDIUM|HIGH|CRITICAL",
  "reason": "string",
  "blocked": true|false,
  "timestamp": "Date"
}
```

## Honest Limitations
- In-memory sliding window (resets on server restart; suitable for current scale)
- No IP/device fingerprinting yet (architecture-ready, not implemented)
- No cross-account correlation yet
- Not a full bot-detection system — foundational heuristics only

## Frontend Impact
- Anti-abuse is transparent to normal users
- Abusive users receive 429 with `code: 'ABUSE_DETECTED'`
- Frontend should show a "slow down" message on 429 with ABUSE_DETECTED code
