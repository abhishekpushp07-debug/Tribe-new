# TRIBE — MEDIA CONTRACT FREEZE
## Version: 2.0 | Date: 2026-03-11

---

## 1. MEDIA ASSET LIFECYCLE

### Statuses
| Status | Meaning | Transitions To |
|--------|---------|----------------|
| `PENDING_UPLOAD` | Upload session created, waiting for client file upload | `READY`, `EXPIRED`, `ORPHAN_CLEANED` |
| `READY` | File uploaded successfully, available for use | `DELETED` |
| `EXPIRED` | Upload session expired (2h TTL passed) | `ORPHAN_CLEANED` |
| `DELETED` | Soft-deleted by owner or admin | Terminal |
| `ORPHAN_CLEANED` | Cleaned by background worker or admin cleanup | Terminal |
| `FAILED` | Processing/upload failed | `ORPHAN_CLEANED` |

### Upload TTL
- **2 hours** from `upload-init` call
- `expiresAt` field set explicitly at creation
- `upload-complete` after expiry returns `410 UPLOAD_EXPIRED`
- Cleanup worker only touches rows where `expiresAt < NOW`

---

## 2. THUMBNAIL LIFECYCLE

### Statuses
| thumbnailStatus | Meaning | Frontend Action |
|-----------------|---------|-----------------|
| `NONE` | No thumbnail applicable or not yet requested | Show placeholder |
| `PENDING` | Thumbnail generation in progress | Show spinner/loading |
| `READY` | Thumbnail available at `thumbnailUrl` | Display thumbnail |
| `FAILED` | Generation failed, `thumbnailError` has reason | Show fallback + retry option |

### Fields
```json
{
  "thumbnailStatus": "NONE | PENDING | READY | FAILED",
  "thumbnailUrl": "https://... | null",
  "thumbnailMediaId": "uuid | null",
  "thumbnailError": "string | null",
  "thumbnailUpdatedAt": "ISO8601 | null"
}
```

### Rules
- Image media: `thumbnailStatus = NONE` (source IS the thumbnail)
- Video media: thumbnail generated async, starts as `PENDING`
- `thumbnailUrl: null` + `thumbnailStatus: NONE` = not applicable
- `thumbnailUrl: null` + `thumbnailStatus: PENDING` = still processing
- `thumbnailUrl: null` + `thumbnailStatus: FAILED` = generation failed

---

## 3. UPLOAD LIFECYCLE

### Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/media/upload-init` | POST | Create upload session, returns signed URL |
| `/api/media/upload-complete` | POST | Finalize after client uploads to storage |
| `/api/media/upload-status/:id` | GET | Check current upload status |
| `/api/media/:id` | GET | Get media asset details |
| `/api/media/:id` | DELETE | Soft-delete media asset |

### Upload-Init Response
```json
{
  "mediaId": "uuid",
  "uploadUrl": "https://supabase.co/storage/v1/object/upload/sign/...",
  "publicUrl": "https://supabase.co/storage/v1/object/public/...",
  "expiresIn": 7200,
  "expiresAt": "2026-03-11T20:00:00.000Z",
  "thumbnailStatus": "NONE"
}
```

### Upload-Complete Responses
- **200**: Already completed (idempotent)
- **200**: Successfully finalized
- **410**: Upload session expired: `{ "error": "Upload session expired", "code": "UPLOAD_EXPIRED" }`
- **400**: Invalid status transition

---

## 4. CLEANUP / EXPIRATION

### Background Worker
- Runs every **30 minutes**
- Targets: `status: PENDING_UPLOAD` AND (`expiresAt < NOW` OR no `expiresAt` + `createdAt < 24h ago`)
- Batch limit: **100 per run**
- Sets status to `ORPHAN_CLEANED`, `isDeleted: true`, `cleanedAt: NOW`
- **Never touches**: `READY`, `DELETED`, or `isDeleted: true` records

### Admin Cleanup: `POST /api/admin/media/cleanup`
- Uses same `expiresAt`-first logic as background worker
- Batch limit: 500 per call
- Dry-run mode available

### Race Safety
- Active uploads protected by `expiresAt` (2h)
- `upload-complete` rejects expired sessions with `410`
- Legacy records: `createdAt + 24h` fallback

---

## 5. MEDIA DELETION

### `DELETE /api/media/:id`

### Authorization
- **Owner**: Own media only
- **ADMIN/SUPER_ADMIN**: Any media

### Attachment Safety
Checks `content_items`, `reels`, `stories`. If attached: `409 MEDIA_ATTACHED`

### Idempotency
- First delete: `200 { status: "DELETED" }`
- Re-delete: `200 { status: "ALREADY_DELETED", deletedAt }`
- Non-existent: `404 NOT_FOUND`

---

## 6. BATCH SEED / BACKFILL

### `POST /api/admin/media/batch-seed`
- Max 1000 assets per batch, idempotent (skips existing IDs)
- Bulk insertMany in 500-item chunks
- Records tagged with `batchImport: true`

### `POST /api/admin/media/backfill-legacy`
- Adds `thumbnailStatus` to records missing it
- Sets `expiresAt` for PENDING_UPLOAD records missing it

---

## 7. ADMIN METRICS: `GET /api/admin/media/metrics`

Returns lifecycle counts, thumbnail state counts, 24h activity, storage breakdown, health indicators (oldest stale pending, legacy records count, pollution risk level).

---

## 8. ERROR SEMANTICS

| Code | HTTP | Meaning |
|------|------|---------|
| `UPLOAD_EXPIRED` | 410 | Upload session TTL passed |
| `MEDIA_ATTACHED` | 409 | Cannot delete, media in use |
| `NOT_FOUND` | 404 | Media doesn't exist |
| `ALREADY_DELETED` | 200 | Idempotent re-delete |
| `FORBIDDEN` | 403 | Not owner and not admin |

---

## 9. DB INDEXES

```
media_assets.id (unique)
media_assets.ownerId + createdAt (compound)
media_assets.status + expiresAt (compound, cleanup worker)
media_assets.status + isDeleted + createdAt (compound, metrics)
media_assets.thumbnailStatus + isDeleted (compound, thumbnail queries)
media_assets.parentMediaId (thumbnail → parent lookup)
```
