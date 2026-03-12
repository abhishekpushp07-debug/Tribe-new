# Tribe API — Complete Documentation Suite
## Master Index & Navigation Guide

**Version**: 3.0.0 | **Last Updated**: March 2026 | **Total Endpoints**: 464+ | **Collections**: 95+

---

## Quick Links

| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 01 | [Architecture Overview](./01_ARCHITECTURE_OVERVIEW.md) | ~800 | System design, routing, request lifecycle, folder structure |
| 02 | [Auth System](./02_AUTH_SYSTEM.md) | ~900 | PIN auth, token rotation, sessions, brute force, IDOR |
| 03 | [Feed Algorithm](./03_FEED_ALGORITHM.md) | ~800 | Multi-signal ranking, 8 feed types, scoring formula |
| 04 | [Caching Strategy](./04_CACHING_STRATEGY.md) | ~700 | Redis layer, TTLs, stampede protection, invalidation |
| 05 | [Content Pipeline](./05_CONTENT_PIPELINE.md) | ~900 | Posts, polls, threads, carousels, drafts, scheduling |
| 06 | [Stories System](./06_STORIES_SYSTEM.md) | ~1000 | Story lifecycle, 10 sticker types, close friends, highlights |
| 07 | [Reels System](./07_REELS_SYSTEM.md) | ~1000 | Reel processing, HLS, series, duets, remixes, creator tools |
| 08 | [Social Interactions](./08_SOCIAL_INTERACTIONS.md) | ~800 | Likes, saves, shares, comments, follows, blocks/mutes |
| 09 | [Search System](./09_SEARCH_SYSTEM.md) | ~700 | Full-text search, autocomplete, indexing, recent searches |
| 10 | [Notifications System](./10_NOTIFICATIONS_SYSTEM.md) | ~700 | 16 types, push tokens, preferences, delivery pipeline |
| 11 | [Media Infrastructure](./11_MEDIA_INFRASTRUCTURE.md) | ~800 | Upload flow, Supabase storage, signed URLs, transcoding |
| 12 | [Tribes & Houses](./12_TRIBES_AND_HOUSES.md) | ~800 | 21 tribes, points, salutes, seasons, leaderboards |
| 13 | [Contests System](./13_CONTESTS_SYSTEM.md) | ~800 | Contest lifecycle, judging, voting, SSE live feeds |
| 14 | [Pages System](./14_PAGES_SYSTEM.md) | ~700 | Pages CRUD, RBAC roles, follow, analytics, verification |
| 15 | [Events System](./15_EVENTS_SYSTEM.md) | ~600 | Events CRUD, RSVP, reminders, calendar integration |
| 16 | [Moderation & Safety](./16_MODERATION_AND_SAFETY.md) | ~900 | Reports, appeals, auto-moderation, anti-abuse |
| 17 | [Analytics System](./17_ANALYTICS_SYSTEM.md) | ~700 | User/content/audience analytics, reach metrics |
| 18 | [Realtime SSE](./18_REALTIME_SSE.md) | ~600 | Server-Sent Events, Redis Pub/Sub, live channels |
| 19 | [Onboarding Flow](./19_ONBOARDING_FLOW.md) | ~600 | Registration, profile setup, interests, college claims |
| 20 | [Governance System](./20_GOVERNANCE_SYSTEM.md) | ~600 | Board elections, proposals, voting |
| 21 | [Error Catalog](./21_ERROR_CATALOG.md) | ~700 | All error codes, response formats, retry strategies |
| 22 | [Security & Permissions](./22_SECURITY_AND_PERMISSIONS.md) | ~800 | Access policies, rate limiting, permissions matrix |
| 23 | [Testing Guide](./23_TESTING_GUIDE.md) | ~600 | Regression suite, test accounts, CI setup |
| 24 | [Android Integration Cookbook](./24_ANDROID_INTEGRATION_COOKBOOK.md) | ~1000 | Screen-by-screen Kotlin/Retrofit code, auth interceptors |
| 25 | [API Quick Reference](./25_API_QUICK_REFERENCE.md) | ~800 | Cheatsheet of all 464+ endpoints with HTTP methods |

---

## Existing Reference Documents

These files are at the project root and remain as-is:

| Document | Lines | Description |
|----------|-------|-------------|
| [API_DOCS.md](../API_DOCS.md) | 4,439 | Exhaustive endpoint-by-endpoint documentation |
| [DATA_MODELS.md](../DATA_MODELS.md) | 1,082 | All 95 MongoDB collection schemas |
| [ANDROID_GUIDE.md](../ANDROID_GUIDE.md) | 905 | Android developer quickstart |
| [CONSTANTS_REFERENCE.md](../CONSTANTS_REFERENCE.md) | 754 | All enums, configs, and magic numbers |
| [FEATURE_SPECS.md](../FEATURE_SPECS.md) | 625 | Feature specifications and business logic |

---

## How to Use This Suite

### For Android Developers
Start with → `24_ANDROID_INTEGRATION_COOKBOOK.md` → then `02_AUTH_SYSTEM.md` → then feature docs as needed.

### For Frontend Developers
Start with → `01_ARCHITECTURE_OVERVIEW.md` → `21_ERROR_CATALOG.md` → `25_API_QUICK_REFERENCE.md` → feature docs.

### For New Team Members
Start with → `01_ARCHITECTURE_OVERVIEW.md` → `22_SECURITY_AND_PERMISSIONS.md` → `19_ONBOARDING_FLOW.md`.

### For QA Engineers
Start with → `23_TESTING_GUIDE.md` → `21_ERROR_CATALOG.md` → feature docs for test cases.

---

## Base URL

```
Production: https://dev-hub-39.preview.emergentagent.com/api
```

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <accessToken>
```

Tokens are obtained via `POST /api/auth/login` or `POST /api/auth/register`.

---

## API Versioning

- Current version: **v3.0.0**
- Response header: `x-contract-version: v2`
- All endpoints are under `/api/`

## Response Format

### Success
```json
{
  "field1": "value1",
  "field2": "value2"
}
```

### Error
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

### Pagination
```json
{
  "items": [...],
  "pagination": {
    "nextCursor": "2026-03-01T00:00:00.000Z",
    "hasMore": true
  }
}
```

---

*This documentation suite contains 25 new documents + 5 existing documents = 30 total files covering every subsystem of the Tribe API.*
