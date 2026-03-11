# Reel Processing Policy
**Last Updated**: 2026-03-11

## Processing Pipeline

### Status Lifecycle
```
UPLOADING → PROCESSING → READY | FAILED
```

### Processing Steps
1. **Upload**: Media uploaded to Supabase Storage via chunked upload API
2. **Trigger**: Processing job created on upload completion
3. **Transcode**: ffmpeg normalizes video to MP4 (H.264, AAC)
   - Target: 720p, 30fps, crf 23
   - Audio: AAC 128k stereo
   - Max duration: enforced on upload
4. **Thumbnail**: First frame extracted as poster image
5. **Upload Output**: Transcoded video + thumbnail uploaded to Supabase
6. **Status Update**: Reel status set to READY with playbackUrl and thumbnailUrl

### Failure Handling
- ffmpeg failures → mediaStatus = FAILED, reel stays unpublished
- Upload failures → Retry up to 3 times
- Timeout → Job marked FAILED after 10 minutes

### Current Limitation
- MP4-first path only (no HLS/DASH adaptive streaming yet)
- Single quality output (720p)
- Designed for upgrade to multi-bitrate when infrastructure supports it

### Media Contract
```json
{
  "playbackUrl": "https://supabase.co/.../reels/transcoded-{id}.mp4",
  "thumbnailUrl": "https://supabase.co/.../reels/thumb-{id}.jpg",
  "durationMs": 15000,
  "mediaStatus": "READY",
  "variants": []
}
```

### Reel Feed Types
| Feed | Endpoint | Description |
|------|----------|-------------|
| Default | GET /reels/feed | Score-based, chronological |
| Trending | GET /reels/trending | Engagement velocity / age ratio |
| Personalized | GET /reels/personalized | User-aware re-ranking |
| Following | GET /reels/following | Only from followed users |
| Audio | GET /reels/audio/:audioId | Same audio track |

### Trending Score Formula
```
trendingScore = engagementTotal / ageHours
engagementTotal = (likes * 2) + (comments * 3) + (shares * 5) + views
ageHours = max(1, hours since publish)
```
Time windows: 1h, 6h, 24h (default), 7d, 30d

### Personalized Scoring
Base score + multipliers:
- Following creator: +30%
- Preferred creator (liked before): up to +20%
- Same tribe: +10%
- Same college: +10%
- Already viewed: -50%
