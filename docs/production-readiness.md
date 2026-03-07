# Tribe — Production Readiness Pack

## 1. Environment Contract

| Variable | Required | Source | Purpose |
|---|---|---|---|
| `MONGO_URL` | YES | .env | MongoDB connection string |
| `DB_NAME` | YES | .env | Database name |
| `NEXT_PUBLIC_BASE_URL` | YES | .env | Public API URL |
| `CORS_ORIGINS` | YES | .env | Allowed CORS origins |

No fallback/default values. Missing config fails fast.

## 2. Health Endpoints

| Endpoint | Type | Checks |
|---|---|---|
| `GET /api/healthz` | Liveness | Returns `{ok: true}` if process is alive |
| `GET /api/readyz` | Readiness | Pings MongoDB, returns 503 if DB is down |
| `GET /api/admin/stats` | Monitoring | Document counts across all collections |

## 3. Deployment Guide

### Prerequisites
- Node.js 18+
- MongoDB 6+
- .env file with required variables

### Steps
```bash
# Install dependencies
yarn install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Build for production
yarn build

# Start
yarn start

# Seed initial data
curl -X POST http://localhost:3000/api/admin/colleges/seed
```

### First-time setup
1. Start server (indexes auto-created on first request)
2. Seed colleges: `POST /api/admin/colleges/seed`
3. Houses auto-seed on first registration
4. Consent notice auto-created on first `GET /api/legal/consent`

## 4. Rollback Plan

### Code rollback
- All changes tracked in git
- Rollback: `git revert HEAD` or deploy previous commit

### Database rollback
- MongoDB collections are append-only for audit/moderation
- Content uses soft-delete (visibility=REMOVED, not physical delete)
- Sessions have TTL auto-cleanup
- No destructive migrations — schema is additive only

## 5. Monitoring & Logging

### Current logging
- All API requests logged with method, path, status, duration
- Error stack traces to stderr
- Audit logs stored in MongoDB `audit_logs` collection
- Moderation events in `moderation_events` (immutable)

### Recommended additions for production
- Structured JSON logging (pino/winston)
- Request ID correlation
- Prometheus metrics endpoint
- Grafana dashboards for:
  - Request rate & latency (p50/p95/p99)
  - Error rate by endpoint
  - Active sessions count
  - Moderation queue depth
  - Report velocity

## 6. Backup & Restore

### MongoDB backup
```bash
# Full backup
mongodump --uri="$MONGO_URL" --db=your_database_name --out=/backups/$(date +%Y%m%d)

# Restore
mongorestore --uri="$MONGO_URL" --db=your_database_name /backups/20260307/
```

### Critical collections (must backup)
- users
- content_items
- follows
- moderation_events (immutable audit trail)
- audit_logs
- consent_acceptances (legal requirement)
- grievance_tickets (SLA-tracked)

## 7. Object Storage Migration Plan

### Current state
Media stored as base64 in MongoDB `media_assets.data` field.

### Migration path
1. **Phase 1**: Add S3/MinIO integration alongside base64
2. **Phase 2**: New uploads go to S3, serve via CDN
3. **Phase 3**: Background job migrates existing base64 to S3
4. **Phase 4**: Remove `data` field from media_assets, keep metadata

### Schema change
```json
// Before
{ "data": "base64...", "url": "/api/media/:id" }

// After
{ "storageType": "S3", "s3Key": "media/uuid.jpg", "cdnUrl": "https://cdn.tribe.app/media/uuid.jpg" }
```

## 8. Media CDN Plan

- Use CloudFront/Cloudflare for edge caching
- Current: `Cache-Control: public, max-age=31536000, immutable` on media responses
- CDN config: Origin = S3 bucket, TTL = 1 year for immutable assets
- Thumbnails: Generate on upload (not lazy)
- Video: Transcode to HLS for adaptive streaming

## 9. Incident Runbook

### High error rate
1. Check `/api/readyz` — if 503, DB is down
2. Check MongoDB connection: `mongosh --eval "db.adminCommand('ping')"`
3. Check logs: `tail -f /var/log/supervisor/nextjs*.log`
4. Restart: `sudo supervisorctl restart nextjs`

### High latency
1. Check DB explain plans for regression (scripts in docs/db-explain-plans.md)
2. Check if indexes were dropped: run app startup to recreate
3. Check MongoDB memory: `db.serverStatus().mem`
4. Check rate limit store size (in-memory)

### Moderation queue overflow
1. Check `GET /api/admin/stats` for openReports count
2. Check SLA timers: `db.grievance_tickets.find({status:"OPEN",dueAt:{$lt:new Date()}})`
3. Alert if any LEGAL_NOTICE tickets are overdue (3hr SLA)

### User account issues
1. Banned: `db.users.findOne({phone:"..."})`
2. Suspended: check `suspendedUntil` field
3. Strike count: `db.strikes.find({userId:"..."})`
4. Session issues: `db.sessions.find({userId:"..."})`

## 10. Rate Limit Policy

| Scope | Limit | Lockout | Reset |
|---|---|---|---|
| Global (per IP) | 120 req/min | No lockout, 429 response | Window resets every 60s |
| Login (per phone) | 5 attempts | 15 min lockout | Clear on success |
| Cleanup interval | - | - | Stale entries purged every 5-10 min |
