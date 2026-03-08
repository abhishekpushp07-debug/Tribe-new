# Tribe — Trust-First College Social Platform for India

## Problem Statement
Build a world-class social media backend for Indian college students called **Tribe**. Backend-first approach: production-grade API + database + infra. Native Android client to be developed separately.

## Tech Stack
- **Backend**: Next.js 14 API Routes (modular handler architecture)
- **Database**: MongoDB (33 collections, 130+ indexes, zero COLLSCANs)
- **Cache**: Redis 7.x via ioredis (TTL jitter, stampede protection, event invalidation, auto-failover)
- **Storage**: Object Storage via Emergent Integrations (S3-compatible)
- **AI Moderation**: OpenAI Moderations API (omni-moderation-latest) via Provider-Adapter Pattern
- **Auth**: Phone + 4-digit PIN → Bearer token sessions (PBKDF2 100K, 30-day TTL)

## Architecture
```
Client → K8s Ingress → Next.js API Router → Handlers → MongoDB
                                    ├─→ Redis Cache
                                    ├─→ Object Storage (media)
                                    └─→ ModerationService (Provider-Adapter)
                                          ├─→ OpenAI Moderations API (primary)
                                          └─→ Keyword Fallback (secondary)
```

## 90+ API Endpoints (v3.1.0)
Auth(7) + Onboarding(6) + Content(4) + Feeds(6) + Social(8) + Discovery(6) + Admin(12) + Media(2) + House Points(5) + Governance(8) + Moderation(5) + Ops(4) + Resources(5) + Events(5) + Board Notices(4) + Authenticity(2) + Distribution(3) + College Claims(7) + Appeals(2)

## 12-Stage Master Plan Status

| Stage | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation Freeze | ✅ FROZEN | Contracts, collections, indexes documented |
| 1 | Appeal Decision Workflow | ✅ ACCEPTED | User accepted with proof pack |
| 2 | College Claim Workflow | ✅ ACCEPTED (97/100) | Policy frozen: ONE ACTIVE CLAIM PER USER GLOBALLY. Race guard at DB level. |
| 3 | Story Expiry Cleanup | ⏳ UPCOMING | TTL index + feed filter |
| 4 | Distribution Ladder | 🔧 IMPLEMENTED | Needs user acceptance |
| 5 | Notes/PYQs Library | 🔧 IMPLEMENTED | Needs user acceptance |
| 6 | Events + RSVP | 🔧 IMPLEMENTED | Needs user acceptance |
| 7 | Board Notices + Authenticity | 🔧 IMPLEMENTED | Needs user acceptance |
| 8 | OTP Challenge Flow | 📋 BACKLOG | |
| 9 | Post-Publish Signal Engine | 📋 BACKLOG | |
| 10 | Video Transcoding Pipeline | 📋 BACKLOG | |
| 11 | Scale/Reliability Excellence | 📋 BACKLOG | |
| 12 | Final Launch Gate | 📋 BACKLOG | |

## Stage 2 — College Claim Workflow (COMPLETE)

### Routes (7 endpoints)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/colleges/:id/claim | User | Submit claim with claimType + evidence |
| GET | /api/me/college-claims | User | User's claim history |
| DELETE | /api/me/college-claims/:id | User | Withdraw PENDING claim |
| GET | /api/admin/college-claims | Admin | Review queue (filter by status, fraudOnly) |
| GET | /api/admin/college-claims/:id | Admin | Claim detail with full context |
| PATCH | /api/admin/college-claims/:id/decide | Admin | Approve/Reject with reasonCodes |
| PATCH | /api/admin/college-claims/:id/flag-fraud | Admin | Move to FRAUD_REVIEW |

### Data Model (college_claims)
- id, userId, collegeId, collegeName
- claimType (STUDENT_ID, EMAIL, DOCUMENT, ENROLLMENT_NUMBER)
- evidence (blob key reference)
- status (PENDING, APPROVED, REJECTED, WITHDRAWN, FRAUD_REVIEW)
- fraudFlag (boolean), fraudReason (string)
- reviewedBy, reviewedAt, reviewReasonCodes (array), reviewNotes
- cooldownUntil (Date, set on rejection, 7 days)
- submittedAt, updatedAt

### Indexes (5)
- idx_user_status: {userId:1, status:1}
- idx_user_college_cooldown: {userId:1, collegeId:1, status:1, cooldownUntil:1}
- idx_admin_queue: {status:1, fraudFlag:-1, submittedAt:1}
- idx_claim_id_unique: {id:1} (UNIQUE)
- idx_one_active_claim_per_user: {userId:1} (UNIQUE, PARTIAL: status IN [PENDING, FRAUD_REVIEW]) — race-condition guard

### State Machine
```
PENDING → APPROVED | REJECTED | WITHDRAWN | FRAUD_REVIEW
FRAUD_REVIEW → APPROVED | REJECTED
```

## 33 MongoDB Collections
users, sessions, audit_logs, content_items, follows, reactions, comments, saves, reports, appeals, moderation_events, moderation_audit_logs, moderation_review_queue, strikes, suspensions, grievance_tickets, colleges, houses, house_ledger, board_seats, board_applications, board_proposals, board_notices, media_assets, consent_notices, consent_acceptances, notifications, feature_flags, college_claims, resources, events, event_rsvps, authenticity_tags

## Remaining Backlog

### P0 — Awaiting User Acceptance
- Stage 2 proof pack delivered → awaiting "Stage 2 = DONE / ACCEPTED"

### P1 — Upcoming (strict order)
- [ ] Stage 3: Story Expiry Cleanup
- [ ] Stage 4: Distribution Ladder (acceptance testing)
- [ ] Stage 5: Notes/PYQs Library (acceptance testing)
- [ ] Stage 6: Events + RSVP (acceptance testing)
- [ ] Stage 7: Board Notices + Authenticity (acceptance testing)

### P2 — Future
- [ ] Stage 8: OTP Challenge Flow
- [ ] Stage 9: Post-Publish Signal Processing
- [ ] Stage 10: Video Transcoding Pipeline
- [ ] Stage 11: Ops/Scale Excellence
- [ ] Stage 12: Final Launch Gate
- [ ] Admin Moderation Panel (UI)
- [ ] SSE real-time leaderboard
- [ ] Presigned URL uploads

### P3 — Backlog
- [ ] Live rooms, chat (WebSockets)
- [ ] Push notifications
- [ ] User blocking/muting
- [ ] Native Android app shell
