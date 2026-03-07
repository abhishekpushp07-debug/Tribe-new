# Tribe Changelog

## 2026-03-07 — v2.0 Complete Backend Rewrite

### Architecture
- Modular handler pattern: monolithic route.js → 9 handler files
- Clean router with dispatch in `/app/app/api/[[...path]]/route.js`
- Infrastructure in `/app/lib/` (db, constants, auth-utils)

### New Features
- **12 House System**: Aryabhatta, Chanakya, Veer Shivaji, Saraswati, Dhoni, Kalpana, Raman, Rani Lakshmibai, Tagore, APJ Kalam, Shakuntala, Vikram
- **Deterministic house assignment**: SHA256(userId) mod 12, permanent
- **House feed**: GET /api/feed/house/:houseId
- **House leaderboard**: GET /api/houses/leaderboard
- **Stories**: 24h TTL with MongoDB TTL index, story rail grouped by author
- **Reels**: Dedicated feed endpoint
- **Notifications**: Real-time activity (follow, like, comment) with actor enrichment
- **Moderation backbone**: Queue, strikes, auto-suspend at 3 strikes
- **Appeals system**: PENDING → APPROVED/DENIED workflow
- **Grievance tickets**: SLA-driven (3h for legal notices, 72h general)
- **Rate limiting**: In-memory, 120 req/min per IP
- **Comprehensive indexes**: 50+ MongoDB indexes for all query patterns

### Security Improvements
- PBKDF2 iterations: 10,000 → 100,000
- Timing-safe PIN comparison (crypto.timingSafeEqual)
- Suspension/ban checks on login and auth middleware
- Duplicate report prevention
- Auto-hold content at 3+ reports

### API Improvements
- Consistent error format: `{ error, code }` with proper HTTP status codes
- Error codes enum (VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, etc.)
- All responses exclude MongoDB _id
- View count tracking on content access

## 2026-03-07 — v1.0 (Rejected)
- Initial web app built (Next.js website)
- Rejected by user — wanted mobile app
- Backend logic preserved and enhanced in v2.0
