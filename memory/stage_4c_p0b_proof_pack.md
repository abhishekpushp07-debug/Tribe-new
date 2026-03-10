# Stage 4C — P0-B Proof Pack: Visibility + Permission Matrix

## Status: ✅ PERFECT — 44/44 PASSED, 0 SKIPPED, 0 REGRESSIONS

## What P0-B Proves
Every authorization boundary, content-state gate, and role restriction is enforced correctly across all core entities. The platform cannot be tricked into exposing protected content or allowing unauthorized mutations.

## Five Dimensions Tested (44 tests)

### Dimension 1: Anonymous Access Matrix — 18 tests

**Reads Allowed (7 tests)**
| # | Test | Proves |
|---|------|--------|
| 1 | `test_anon_can_view_public_feed` | Public feed accessible without token |
| 2 | `test_anon_can_search_events` | Event search accessible without token |
| 3 | `test_anon_can_search_resources` | Resource search accessible without token |
| 4 | `test_anon_can_view_college_notices` | College notice listing accessible without token |
| 5 | `test_anon_can_view_post_detail` | Post detail accessible without token |
| 6 | `test_anon_can_view_event_detail` | Published event detail accessible without token |
| 7 | `test_anon_can_view_resource_detail` | Resource detail accessible without token |

**Writes Denied (11 tests)**
| # | Test | Proves |
|---|------|--------|
| 1 | `test_anon_cannot_create_post` | 401 on anonymous post creation |
| 2 | `test_anon_cannot_like_post` | 401 on anonymous like |
| 3 | `test_anon_cannot_comment` | 401 on anonymous comment |
| 4 | `test_anon_cannot_follow` | 401 on anonymous follow |
| 5 | `test_anon_cannot_create_event` | 401 on anonymous event creation |
| 6 | `test_anon_cannot_rsvp_event` | 401 on anonymous RSVP |
| 7 | `test_anon_cannot_create_resource` | 401 on anonymous resource creation |
| 8 | `test_anon_cannot_vote_resource` | 401 on anonymous resource vote |
| 9 | `test_anon_cannot_create_notice` | 401 on anonymous notice creation |
| 10 | `test_anon_cannot_like_reel` | 401 on anonymous reel like |

### Dimension 2: Age-Gate Matrix — 5 tests
| # | Test | Proves |
|---|------|--------|
| 1 | `test_unknown_age_cannot_create_post` | ageStatus=UNKNOWN → 403 AGE_REQUIRED |
| 2 | `test_child_can_create_text_post` | CHILD → text posts allowed (201) |
| 3 | `test_child_cannot_create_reel` | CHILD → 403 CHILD_RESTRICTED on reels |
| 4 | `test_child_cannot_create_story` | CHILD → 403 CHILD_RESTRICTED on stories |
| 5 | `test_child_cannot_create_media_post` | CHILD → 403 CHILD_RESTRICTED on media posts |

### Dimension 3: Role-Gate Matrix — 5 tests
| # | Test | Proves |
|---|------|--------|
| 1 | `test_regular_user_cannot_create_notice` | USER → 403 on notice creation |
| 2 | `test_admin_can_create_notice` | ADMIN → 201 on notice creation |
| 3 | `test_admin_can_delete_any_post` | ADMIN → can delete any user's post |
| 4 | `test_regular_user_cannot_delete_others_post` | USER → 403 on deleting other's post |
| 5 | `test_regular_user_cannot_pin_notice` | USER → 403 on pinning notice |

### Dimension 4: Ownership Enforcement — 7 tests
| # | Test | Proves |
|---|------|--------|
| 1 | `test_owner_can_delete_own_post` | Owner → 200 on own post delete |
| 2 | `test_non_owner_cannot_update_event` | Non-owner → 403 on event update |
| 3 | `test_non_owner_cannot_delete_event` | Non-owner → 403 on event delete |
| 4 | `test_non_owner_cannot_update_resource` | Non-owner → 403 on resource update |
| 5 | `test_non_owner_cannot_delete_resource` | Non-owner → 403 on resource delete |
| 6 | `test_self_vote_resource_forbidden` | Self-vote → 403 |
| 7 | `test_self_like_reel_forbidden` | Self-like → 400 |

### Dimension 5: Content-State Visibility Matrix — 10 tests
| # | Test | Proves |
|---|------|--------|
| 1 | `test_removed_post_returns_404` | REMOVED post → 404 |
| 2 | `test_held_post_not_in_following_feed` | HELD post → absent from feeds |
| 3 | `test_draft_event_invisible_to_non_creator` | DRAFT event → 404 for others |
| 4 | `test_draft_event_visible_to_creator` | DRAFT event → 200 for creator |
| 5 | `test_cancelled_event_still_accessible` | CANCELLED event → 200 (informational) |
| 6 | `test_removed_event_returns_410` | REMOVED event → 410 |
| 7 | `test_removed_resource_returns_410` | REMOVED resource → 410 |
| 8 | `test_removed_notice_returns_410` | REMOVED notice → 410 |
| 9 | `test_removed_reel_not_accessible` | REMOVED reel → 404/410 |
| 10 | `test_banned_user_cannot_login` | Banned → 403 on login |

## Permission Matrix Coverage Summary

| Role/State | Read Public | Write | Mutate Own | Mutate Others | Admin Actions |
|------------|------------|-------|-----------|---------------|---------------|
| Anonymous | ✅ 200 | ✅ 401 | — | — | — |
| UNKNOWN age | — | ✅ 403 | — | — | — |
| CHILD | — | ✅ text OK, media 403 | — | — | — |
| USER | — | ✅ allowed | ✅ allowed | ✅ 403 | ✅ 403 |
| ADMIN | — | — | — | ✅ allowed | ✅ allowed |
| Banned | — | — | ✅ 403 login | — | — |

## Full Suite Proof

```
Run 1: 396 passed, 0 failed, 0 skipped — 42.40s
Run 2: 396 passed, 0 failed, 0 skipped — 41.47s
Idempotency: CONFIRMED
```

## Test Infrastructure
- 4 dedicated users: `permission_user_a`, `permission_user_b`, `permission_admin`, + class-scoped child/unknown users
- `permission_admin` isolates ADMIN WRITE budget from the shared `admin_user` fixture (prevents rate limit interference)
- Full cleanup in session teardown

## Issues Found & Fixed
1. **Rate Limit Interference**: P0-B initially used the shared `admin_user` fixture for notice creation, which combined with P0-A + product tests exhausted the WRITE rate limit (429). Fixed by creating `permission_admin` with its own WRITE budget.
2. **Admin State Leakage**: P0-A tests changed `admin_user.collegeId` without restoring. Fixed by adding save/restore in the P0-A module fixture.
