# TRIBE Android App — Direction Lock + Backend Details

---

## BACKEND IS LIVE AND RUNNING

### Base URL
```
https://tribe-feed-engine-1.preview.emergentagent.com
```

All API endpoints are prefixed with `/api`. Example:
```
GET  https://tribe-feed-engine-1.preview.emergentagent.com/api/healthz
GET  https://tribe-feed-engine-1.preview.emergentagent.com/api/tribes
POST https://tribe-feed-engine-1.preview.emergentagent.com/api/auth/register
```

### Health Check (confirmed working right now):
```
GET /api/healthz → {"ok": true, "timestamp": "2026-03-08T21:59:54.962Z"}
GET /api/tribes  → 21 tribes returned (Somnath, Jadunath, Piru, ...)
```

### Auth Header Format
```
Authorization: Bearer {token}
Content-Type: application/json
```

### Key Configuration
- Backend handles ALL AI moderation (GPT-4o-mini) — no client-side LLM needed
- Backend handles ALL media storage (Emergent Object Storage with base64 fallback)
- Backend handles ALL tribe assignment (deterministic SHA256 hash at signup)
- Redis Pub/Sub powers real-time SSE — already configured
- CORS is `*` — open for development

### What Android App DOES NOT NEED
- No API keys on client
- No moderation logic on client
- No LLM integration on client
- No tribe assignment logic on client
- No ranking/scoring computation on client

---

## COMPLETE BACKEND FREEZE DOCUMENTATION

The following documents contain the COMPLETE canonical truth for all backend contracts. These are located at `/app/memory/freeze/`:

| Document | What It Contains |
|----------|-----------------|
| `B0-MASTER-INDEX.md` | Master index of all freeze docs |
| `B0-S1-domain-freeze.md` | 52 domain concepts, vocabulary rules |
| `B0-S2-endpoint-freeze.md` | ~186 endpoints with labels (CANONICAL/LEGACY/ADMIN/V1_USE) |
| `B0-S3-response-contract-freeze.md` | 26 entity JSON shapes, pagination, enrichment rules |
| `B0-S4-state-machine-freeze.md` | 13 lifecycle state machines with transitions |
| `B0-S5-permission-freeze.md` | 12 permission matrices, child restrictions, block rules |
| `B0-S6-sse-contract-freeze.md` | 4 SSE endpoints, 15 event types, snapshot/delta shapes |
| `B0-S7-media-upload-freeze.md` | Upload flow, size limits, processing pipeline |
| `B0-S8-deprecation-versioning-seal.md` | Legacy boundaries, versioning rules, error codes |

Additionally: `/app/memory/android_agent_handoff.md` — Full API reference (1,263 lines)

---

# DIRECTION LOCK — RESPONSES TO YOUR QUESTIONS

## 1) Backend Status — Final Answer

**Backend is deployed, running, and fully functional.** Do not rebuild it.

Base URL: `https://tribe-feed-engine-1.preview.emergentagent.com`

Keep it configurable in your codebase (env variable / build config), but you have a working backend RIGHT NOW to build against.

Backend is the source of truth. Your job is:
- Render data
- Manage client state
- Upload media
- Consume real-time SSE streams
- Surface backend truth accurately

Your job is NOT:
- Replace backend logic
- Compute contest rankings locally
- Decide moderation outcomes
- Invent tribe logic
- Mix house logic with tribe logic

---

## 2) MVP Priority — Final Build Order (Custom)

### Phase 0 — App shell + infra foundation
Root navigation, auth gate, token handling, session restore, API client, error handling, media/image/video foundation, deep links, feature module structure

### Phase 1 — Auth + onboarding
Register, login, lockout UI, profile setup, age/DOB, college selection, onboarding completion, tribe assignment reveal

### Phase 2 — Core social foundation
Home/public feed, following feed, post detail, create post, comments/replies, like/dislike/save, delete/report

### Phase 3 — Profile + social graph
My profile, other user profile, followers, following, saved posts, follow/unfollow, edit profile

### Phase 4 — Search/discovery + college identity
Global search, suggestions, college search, college detail, college members, claim flow, claim history

### Phase 5 — Stories
Stories tray, story viewer, create story, reactions, replies, stickers, close friends, highlights, archive, story settings

### Phase 6 — Reels
Reels feed, reel detail, interactions, watch tracking, audio page, remixes, series, draft/publish, processing state, analytics

### Phase 7 — Tribe identity layer
My tribe, tribe detail, tribe members, tribe board, standings, salute view, season context

### Phase 8 — Tribe contest layer
Contest list, contest detail, entry submission, vote flow, leaderboard, results, season standings, contest state handling

### Phase 9 — Real-time live layer
SSE contest scoreboard, SSE season standings, SSE live activity feed, reconnect, stale refresh, live state transitions

### Phase 10 — Utility layer
Resources/PYQ, events + RSVP, board notices + authenticity, reminders/acknowledgements

### Phase 11 — Trust/control layer
Notifications, reporting, appeals, legal consent, grievances, blocks

### Phase 12 — Hardening / launch quality
Upload resilience, retry logic, offline handling, performance tuning, animation polish, accessibility, crash-proofing

---

## 3) AI Moderation — Final Answer

**Client does NOT handle moderation.** Backend handles all AI moderation via GPT-4o-mini.

Android only renders moderation states:
- content submitted
- content pending moderation
- content flagged
- content hidden
- content removed
- appeal available/submitted/outcome

No LLM key needed on Android.

---

## 4) Media Upload — Final Answer

`POST /api/media/upload` is **real and functional**.

Upload flow:
1. Base64 encode the media
2. POST to `/api/media/upload` with `{ data, mimeType, type, width, height, duration }`
3. Get back `{ id, url, type, size, mimeType, storageType }`
4. Use the `id` (mediaId) in subsequent create calls

Limits:
- Images: 5MB max, types: jpeg/png/webp/gif
- Videos: 30MB max, 30 seconds max, types: mp4/quicktime
- Children (ageStatus=CHILD) blocked from uploading

Build a proper upload manager — this is a core subsystem, not a utility.

---

## 5) Design Preference — Final Answer

### Theme: Dark premium
- Cinematic, youth-facing, high-contrast but not harsh
- Content-first, fast and modern

### Accent: Emerald/green as global accent
- Tribe colors are **contextual only** (tribe pages, standings, contest pills, leaderboard rows, badges, winner states)
- Do NOT spray tribe colors as global app chrome

### Motion: Smooth, premium, clean
- Instagram-grade polish
- Performance-first
- Tactile and subtle
- NOT: over-flashy, hyper-bouncy, slow ornamental

### Vibe reference:
- **Instagram** — for media polish, stories/reels feel, visual hierarchy
- **Discord** — for belonging, identity grouping, tribe/community feel
- **Live sports/esports scoreboards** — for contest energy, standings, rank movement

### Avoid making it feel like:
- Twitter/X clone
- Generic student ERP
- Telegram utility app
- Gaming neon UI
- Copy-paste Instagram without TRIBE identity

---

## HARD RULES (Non-Negotiable)

1. **Backend truth is authoritative** — frontend never invents business truth
2. **Counts are backend-owned** — don't locally compute final counts/ranks/standings
3. **Houses are legacy, Tribes are canonical** — don't build house UI
4. **Like ≠ Vote ≠ Score ≠ Salute ≠ Fund** — never merge these
5. **Contest frontend must not fake ranking** — leaderboards come from backend
6. **Moderation stays server-side** — client only reflects state
7. **Real-time means contract discipline** — don't invent SSE event assumptions
8. **Utility layers (resources, events, notices) are NOT throwaway** — they're TRIBE's college platform differentiator

---

## WHAT YOU SHOULD DO NOW

Stop asking broad questions. Go into execution planning mode.

Return:
1. **App architecture** — module boundaries, navigation, state management, API layer, caching, SSE, media handling
2. **Screen map** — screen-by-screen breakdown for all phases
3. **Data/state model plan** — UI models, domain models, DTOs, pagination/error/loading/empty/permission/moderation states
4. **Real-time strategy** — SSE lifecycle, reconnect, stale recovery, background/foreground, dedup
5. **Upload strategy** — queue, progress, retry, failure recovery, image/video separation

That is the correct next step. Read the freeze documents, then plan.
