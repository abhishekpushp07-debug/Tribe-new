# Tribe — State & Permissions Guide for Frontend
Verified backend truth. FH1-U gate.

## User States
| State | Field | Values | Frontend Impact |
|-------|-------|--------|----------------|
| Age | ageStatus | NONE, MINOR, ADULT | Must be ADULT to create content |
| Onboarding | onboardingStep | null (complete), or step name | Show onboarding flow if not null |
| Role | role | USER, MODERATOR, ADMIN, SUPER_ADMIN | Gate admin screens |
| College | collegeId | null or id | Required for college-specific features |

## Content Visibility
| Visibility | Who Can See |
|-----------|------------|
| PUBLIC | Everyone |
| COLLEGE_ONLY | Same college users only |
| HOUSE_ONLY | Same house users only |
| PRIVATE | Author only |
| REMOVED | Nobody (soft-deleted) |

**Frontend rule**: Backend handles filtering. Frontend just renders what the API returns.

## Page Roles & Permissions
| Action | OWNER | ADMIN | EDITOR | MODERATOR | Outsider |
|--------|-------|-------|--------|-----------|----------|
| Update page | ✅ | ✅ | ❌ | ❌ | ❌ |
| Archive/Restore | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add member | ✅ | ✅ | ❌ | ❌ | ❌ |
| Change role | ✅ | ✅* | ❌ | ❌ | ❌ |
| Remove member | ✅ | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ | ❌ |
| Publish post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit page post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete page post | ✅ | ✅ | ✅ | ❌ | ❌ |
| View members | ✅ | ✅ | ✅ | ✅ | ❌ |
| View analytics | ✅ | ✅ | ❌ | ❌ | ❌ |
| Follow page | Anyone | Anyone | Anyone | Anyone | Anyone |

*ADMIN cannot promote to OWNER or mutate OWNER.

**Frontend detection**: Use `viewerRole` from PageProfile response. If null, viewer is an outsider.

## Content Edit Permissions (B4)
- User-authored post: Only the author (or ADMIN/MODERATOR platform role)
- Page-authored post: Page role OWNER, ADMIN, or EDITOR
- Cannot edit REMOVED/deleted content (404)
- Cannot edit if page is ARCHIVED (400)

## Comment Like Permissions (B4)
- Must be authenticated
- Must have access to parent content (B2 visibility)
- Cannot like comment on deleted/hidden parent post

## Share/Repost Permissions (B4)
- Must be authenticated
- Must have access to original content
- Cannot repost a repost (400)
- One repost per user per original (409 on duplicate)
- Cannot repost deleted/hidden content (404)
- Cannot repost blocked user's content (404)

## Page Status Effects
| Page Status | Browsable | Publishable | Editable | Members Manageable |
|-------------|-----------|-------------|----------|-------------------|
| ACTIVE | ✅ | ✅ | ✅ | ✅ |
| ARCHIVED | ✅ (read-only) | ❌ | ❌ | Limited |
| SUSPENDED | ✅ (read-only) | ❌ | ❌ | ❌ |

## Notification Types & Navigation
| Type | Navigate To | Preview |
|------|------------|--------|
| FOLLOW | User profile | "{actor} followed you" |
| LIKE | Post detail | "{actor} liked your post" |
| COMMENT | Comment sheet | "{actor} commented on your post" |
| COMMENT_LIKE | Comment sheet | "{actor} liked your comment" |
| SHARE | Post detail (original) | "{actor} shared your post" |
| MENTION | Post/Comment detail | "{actor} mentioned you" |
| REPORT_RESOLVED | N/A | "Your report has been resolved" |
| STRIKE_ISSUED | N/A | "You received a strike" |
| APPEAL_DECIDED | N/A | "Your appeal has been decided" |

## Optimistic UI Safety
| Action | Optimistic Safe? | Notes |
|--------|-----------------|-------|
| Like/Unlike post | ✅ Yes | Toggle immediately, rollback on error |
| Save/Unsave post | ✅ Yes | Toggle immediately |
| Follow/Unfollow | ✅ Yes | Toggle immediately |
| Comment like | ✅ Yes | Toggle immediately, update count |
| Edit post | ❌ No | Wait for server confirmation (moderation re-check) |
| Share/Repost | ❌ No | Wait for 201 (duplicate check server-side) |
| Create post | ❌ No | Wait for server (age check, moderation) |
| Page actions | ❌ No | Wait for server (role checks) |
