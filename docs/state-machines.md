# Tribe — State Machines

## 1. User Onboarding State Machine

```
[REGISTER] → AGE → COLLEGE → CONSENT → DONE
                ↑                        |
                └── can skip college ─────┘
```

Steps:
- `AGE`: Set birth year → classifies as ADULT or CHILD
- `COLLEGE`: Search and link to a college (optional, can skip)
- `CONSENT`: Accept DPDP consent notice
- `DONE`: onboardingComplete = true

Child users get restricted features immediately at AGE step.

## 2. Content Visibility State Machine

```
[CREATE] → PUBLIC
              |
              ├──→ HELD_FOR_REVIEW (3+ reports auto-trigger)
              │         |
              │         ├──→ PUBLIC (moderator APPROVE)
              │         ├──→ REMOVED (moderator REMOVE)
              │         └──→ SHADOW_LIMITED (moderator SHADOW_LIMIT)
              │
              ├──→ SHADOW_LIMITED (moderator action)
              │         |
              │         └──→ REMOVED (further violation)
              │
              ├──→ LIMITED (moderator action)
              │
              └──→ REMOVED (author delete OR moderator REMOVE)
                       |
                       └──→ [APPEAL] → PUBLIC (if approved)
```

## 3. Report State Machine

```
[CREATE] → OPEN
              |
              ├──→ REVIEWING (moderator picks up)
              │         |
              │         ├──→ RESOLVED (action taken)
              │         └──→ DISMISSED (no violation)
              │
              └──→ RESOLVED (auto-resolved when moderation action taken on target)
```

Auto-hold trigger: When a content item accumulates 3+ OPEN reports,
visibility automatically changes from PUBLIC to HELD_FOR_REVIEW.

## 4. Strike / Suspension State Machine

```
Strike issued (moderation REMOVE or STRIKE action)
    |
    └──→ strikeCount incremented on user
              |
              ├── strikeCount < 3 → warning only
              └── strikeCount >= 3 → AUTO-SUSPEND (7 days)
                       |
                       └──→ suspendedUntil set
                                |
                                └──→ User cannot login/post during suspension
```

Strikes expire after 90 days.
Suspension blocks: login, post, comment, follow actions.

## 5. Appeal State Machine

```
[CREATE] → PENDING
              |
              ├──→ REVIEWING (moderator picks up)
              │         |
              │         ├──→ APPROVED → content restored to PUBLIC
              │         └──→ DENIED → no change
              │
              └──→ duplicate prevention: one active appeal per target per user
```

## 6. Grievance Ticket State Machine

```
[CREATE] → OPEN (SLA timer starts)
              |
              ├──→ LEGAL_NOTICE: 3 hours SLA, priority CRITICAL
              ├──→ GOVERNMENT_ORDER: 3 hours SLA, priority CRITICAL
              └──→ GENERAL: 72 hours SLA, priority NORMAL
              |
              └──→ dueAt = createdAt + SLA hours
```

## 7. Login Brute Force State Machine

```
Login attempt
    |
    ├── Success → clear failure counter
    └── Failure → increment counter
                    |
                    ├── count < 5 → allow retry
                    └── count >= 5 → LOCKED (15 min)
                                        |
                                        └──→ returns 429 with Retry-After
                                        └──→ auto-unlocks after 15 min
```

## 8. Session / Token Lifecycle

```
[REGISTER/LOGIN] → token created (96-char hex)
                        |
                        ├── TTL: 30 days (MongoDB TTL index auto-expires)
                        ├── Revoke single: POST /auth/logout
                        ├── Revoke all: DELETE /auth/sessions
                        ├── PIN change: revokes all EXCEPT current session
                        └── Ban/Suspend: token still exists but auth middleware rejects
```

## 9. House Assignment (Deterministic, One-Way)

```
[REGISTER] → SHA256(userId) → take first 8 hex chars → parseInt(hex, 16) → mod 12 → HOUSE[index]
                                                                                        |
                                                                                        └── permanent, immutable
```

12 Houses: Aryabhatta, Chanakya, Veer Shivaji, Saraswati, Dhoni, Kalpana, Raman, Rani Lakshmibai, Tagore, APJ Kalam, Shakuntala, Vikram
