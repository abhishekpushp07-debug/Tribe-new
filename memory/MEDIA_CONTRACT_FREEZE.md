# TRIBE — MEDIA CONTRACT FREEZE v1.0

## 1. Upload Init Contract
```
POST /api/media/upload-init
Authorization: Bearer <token>

Request:
{
  "kind": "image" | "video",            // REQUIRED
  "mimeType": string,                    // REQUIRED — one of: image/jpeg, image/png, image/webp, video/mp4, video/quicktime
  "sizeBytes": number,                   // REQUIRED — 1 to 209715200 (200MB)
  "scope": "reels" | "stories" | "posts" | "thumbnails"  // OPTIONAL, defaults to "posts"
}

Response 201:
{
  "mediaId": uuid,
  "uploadUrl": string,     // Supabase signed URL — PUT binary data here
  "token": string,         // Supabase upload token
  "path": string,          // Storage path: {scope}/{userId}/{mediaId}.{ext}
  "publicUrl": string,     // CDN URL (available after upload)
  "expiresIn": 7200        // Signed URL TTL in seconds
}

Errors:
- 400: validation (invalid kind/mime/size, kind-mime mismatch)
- 401: not authenticated
- 403: CHILD user restricted
- 413: file too large (>200MB)
```

## 2. Upload Complete Contract
```
POST /api/media/upload-complete
Authorization: Bearer <token>

Request:
{
  "mediaId": uuid,         // REQUIRED
  "width": number,         // OPTIONAL
  "height": number,        // OPTIONAL
  "duration": number       // OPTIONAL (seconds, for video)
}

Response 200:
{
  "id": uuid,
  "url": string,           // Best playable URL (publicUrl or /api/media/:id)
  "publicUrl": string,     // Supabase CDN URL
  "thumbnailUrl": string | null,  // Auto-generated thumbnail for video
  "type": "IMAGE" | "VIDEO",
  "kind": "IMAGE" | "VIDEO",
  "mimeType": string,
  "size": number,
  "storageType": "SUPABASE",
  "status": "READY"
}

Notes:
- Idempotent: calling twice on same mediaId returns 200
- Video uploads trigger automatic thumbnail generation (ffmpeg)
- Thumbnail stored in thumbnails/ scope

Errors:
- 400: missing mediaId, wrong status
- 401: not authenticated
- 404: media not found or wrong owner
```

## 3. Upload Status Contract
```
GET /api/media/upload-status/:mediaId
Authorization: Bearer <token>

Response 200:
{
  "id": uuid,
  "status": "PENDING_UPLOAD" | "READY" | "ORPHAN_CLEANED",
  "publicUrl": string | null,
  "type": string,
  "kind": string,
  "mimeType": string,
  "size": number,
  "storageType": string
}
```

## 4. Media Serve Contract
```
GET /api/media/:id

Behavior by storageType:
- SUPABASE:        302 redirect to publicUrl (CDN)
- OBJECT_STORAGE:  200 with binary body streamed
- BASE64:          200 with decoded binary body

Headers:
- Content-Type: {mimeType}
- Cache-Control: public, max-age=31536000, immutable (for SUPABASE/OBJECT_STORAGE)
- Location: {publicUrl} (for 302)
```

## 5. Content Creation with mediaId

### Reels
```
POST /api/reels
{ "mediaId": uuid, "caption": string, ... }

- mediaId resolves to media_assets record
- MUST be VIDEO kind/mime
- MUST be status=READY
- MUST be owned by creator
- playbackUrl = publicUrl from media asset
- mediaId stored on reel record
- Legacy: mediaUrl still accepted for backward compatibility
```

### Stories
```
POST /api/stories
{ "mediaIds": [uuid, ...], "type": "IMAGE"|"VIDEO", ... }

- Each mediaId resolves to media_assets
- ALL must be owned by author
- url = publicUrl from media asset (direct CDN, no redirect hop)
```

### Posts
```
POST /api/content/posts
{ "mediaIds": [uuid, ...], "caption": string, ... }

- Each mediaId resolves to media_assets
- url = publicUrl from media asset (direct CDN, no redirect hop)
```

## 6. Media Object Shape (in serialized content)
```json
{
  "id": "uuid",
  "url": "https://xxx.supabase.co/storage/v1/object/public/tribe-media/...",
  "type": "IMAGE" | "VIDEO",
  "mimeType": "image/jpeg",
  "width": 1080,
  "height": 1920,
  "duration": 15.5,
  "storageType": "SUPABASE" | "OBJECT_STORAGE" | "BASE64"
}
```

## 7. Legacy Compatibility
- Old content with inline base64 `data` field still served via /api/media/:id
- Old content with OBJECT_STORAGE paths still streamed
- Mixed feeds with old+new media serialize safely
- Frontend does NOT need to distinguish old/new — `url` field always works

## 8. Media Deletion Contract (NEW)
```
DELETE /api/media/:id
Authorization: Bearer <token>

Response 200:
{
  "id": uuid,
  "status": "DELETED"
}

Rules:
- Owner-only (or ADMIN/SUPER_ADMIN)
- Attachment safety: returns 409 MEDIA_ATTACHED if media is used in any:
  - content_items (posts) → media[].id
  - reels → mediaId
  - stories → mediaIds[]
- Cascade: associated thumbnail also deleted
- Supabase file deleted (best-effort)
- Soft-delete: isDeleted=true, status=DELETED, deletedAt set

Errors:
- 401: not authenticated
- 403: FORBIDDEN (not your media)
- 404: media not found or already deleted
- 409: MEDIA_ATTACHED (media is referenced in content)
  Response: { "error": "Cannot delete...", "code": "MEDIA_ATTACHED", "attachments": [{ "type": "post|reel|story", "id": "..." }] }
```

## 9. Cleanup / Orphan Policy
- PENDING_UPLOAD records cleaned when `expiresAt` has passed (default 2h from upload-init)
- Legacy records without `expiresAt` cleaned after 24h via `createdAt` fallback
- Cleanup runs every 30 minutes via lazy-init worker
- Remote Supabase objects deleted for orphans
- DB records marked as `ORPHAN_CLEANED` + `isDeleted: true`
- READY media NEVER touched by cleanup
- Admin endpoint: `POST /api/admin/media/cleanup` (dry-run + execute modes)

## 10. Thumbnail Lifecycle
```
Status transitions: NONE → PENDING → READY | FAILED

Fields on media_assets:
- thumbnailStatus: "NONE" | "PENDING" | "READY" | "FAILED"
- thumbnailUrl: string | null (set when READY)
- thumbnailMediaId: string | null (ID of thumbnail media_asset)
- thumbnailError: string | null (reason when FAILED)

Behavior:
- Set to NONE on upload-init
- Transitions to PENDING when thumbnail generation starts (on upload-complete for videos)
- Transitions to READY with thumbnailUrl on success
- Transitions to FAILED with thumbnailError on failure
- Images never trigger thumbnail generation (stay NONE)
```

## 9. Allowed MIME Types
- image/jpeg, image/png, image/webp
- video/mp4, video/quicktime

## 10. Max File Size
- 200MB (Supabase Pro)
