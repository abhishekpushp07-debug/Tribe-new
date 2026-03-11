# Pages — Contract Freeze
**Last Updated**: 2026-03-11

## Endpoints (25+ total)

### Page CRUD
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /pages | User | Create page |
| GET | /pages | Any | Search/list pages (category, college, text) |
| GET | /pages/:idOrSlug | Any | Get page detail |
| PATCH | /pages/:id | Owner/Admin/Mod | Update page |
| POST | /pages/:id/archive | Owner/Admin | Archive page |
| POST | /pages/:id/restore | Owner/Admin | Restore archived page |
| DELETE | /pages/:id | Owner/Admin | Delete page (soft delete) |

### Page Identity & Verification
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /pages/:id/request-verification | Owner/Admin | Request page verification |
| GET | /admin/pages/verification-requests | ADMIN | List pending verification requests |
| POST | /admin/pages/verification-decide | ADMIN | Approve/reject verification |

### Page Audience
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /pages/:id/members | Any | List page members |
| POST | /pages/:id/members | Owner/Admin | Add member with role |
| PATCH | /pages/:id/members/:userId | Owner/Admin | Change member role |
| DELETE | /pages/:id/members/:userId | Owner/Admin | Remove member |
| POST | /pages/:id/invite | Owner/Admin/Mod | Invite user to page |
| POST | /pages/:id/follow | User | Follow page |
| DELETE | /pages/:id/follow | User | Unfollow page |
| GET | /pages/:id/followers | Any | List followers |
| POST | /pages/:id/transfer | Owner | Transfer ownership |

### Page Content
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /pages/:id/posts | Any | Page posts |
| POST | /pages/:id/posts | Owner/Admin/Mod/Editor | Create post as page |

### Page Safety
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /pages/:id/report | User | Report page |

### Page Analytics
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /pages/:id/analytics | Owner/Admin | Page analytics (daily activity, follower growth, top posts) |

### Page Admin
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /me/pages | User | My managed pages |
| PATCH | /admin/pages/:id | ADMIN | Admin page control (suspend, verify, etc.) |

## Page Schema
```json
{
  "id": "uuid",
  "name": "string",
  "slug": "string (unique, URL-safe)",
  "description": "string",
  "category": "STUDY_GROUP | CLUB | MEME | DEPARTMENT | EVENT | GENERAL",
  "status": "ACTIVE | ARCHIVED | SUSPENDED | DELETED",
  "isOfficial": false,
  "verificationStatus": "NONE | PENDING | VERIFIED | REJECTED",
  "profileImageMediaId": "uuid | null",
  "coverImageMediaId": "uuid | null",
  "collegeId": "uuid | null",
  "memberCount": 0,
  "followerCount": 0,
  "postCount": 0,
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## Page Roles
| Role | Can Post | Can Manage Members | Can Edit Page | Can Delete |
|------|----------|-------------------|---------------|------------|
| OWNER | Yes | Yes | Yes | Yes |
| ADMIN | Yes | Yes | Yes | No |
| MODERATOR | Yes | Limited | No | No |
| EDITOR | Yes | No | No | No |
| MEMBER | No | No | No | No |

## Verification Workflow
1. Page owner/admin submits request: `POST /pages/:id/request-verification`
2. Admin reviews list: `GET /admin/pages/verification-requests`
3. Admin decides: `POST /admin/pages/verification-decide` with {requestId, decision: APPROVED|REJECTED}
4. Page verificationStatus updated, notification sent to requester
5. Verified pages get badge display and search boost

## Visibility Rules
- ACTIVE pages: Visible in search, feeds, and direct access
- ARCHIVED pages: Hidden from search, accessible via direct link
- SUSPENDED pages: Hidden from all non-admin queries
- DELETED pages: Hidden from all queries, members removed

## Page Invite System
- Owners, Admins, and Moderators can invite users
- Invited user gets PAGE_INVITE notification
- Default role: MEMBER (can be specified)
- Duplicate invite check: existing active members cannot be re-invited
