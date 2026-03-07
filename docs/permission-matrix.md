# Tribe — Role-Permission Matrix

## Roles

| Role | Description | Count |
|------|-------------|-------|
| `USER` | Default registered user | All users |
| `MODERATOR` | Content moderator | Appointed by admin |
| `ADMIN` | Platform administrator | Limited |
| `SUPER_ADMIN` | Full system access | 1-2 max |

## Permission Matrix

| Action | USER | MODERATOR | ADMIN | SUPER_ADMIN |
|--------|------|-----------|-------|-------------|
| Register/Login | ✅ | ✅ | ✅ | ✅ |
| View public content | ✅ | ✅ | ✅ | ✅ |
| Create post | ✅ | ✅ | ✅ | ✅ |
| Create reel/story (ADULT only) | ✅ | ✅ | ✅ | ✅ |
| Upload media (ADULT only) | ✅ | ✅ | ✅ | ✅ |
| Like/dislike/save | ✅ | ✅ | ✅ | ✅ |
| Comment | ✅ | ✅ | ✅ | ✅ |
| Follow/unfollow | ✅ | ✅ | ✅ | ✅ |
| Report content/user | ✅ | ✅ | ✅ | ✅ |
| Create appeal | ✅ | ✅ | ✅ | ✅ |
| File grievance | ✅ | ✅ | ✅ | ✅ |
| Delete own content | ✅ | ✅ | ✅ | ✅ |
| View own notifications | ✅ | ✅ | ✅ | ✅ |
| View own saved items | ✅ | ✅ | ✅ | ✅ |
| View moderation queue | ❌ | ✅ | ✅ | ✅ |
| Take moderation action | ❌ | ✅ | ✅ | ✅ |
| Delete other's content | ❌ | ✅ | ✅ | ✅ |
| Issue strikes | ❌ | ✅ | ✅ | ✅ |
| View admin stats | ❌ | ❌ | ✅ | ✅ |
| Seed colleges | ❌ | ❌ | ✅ | ✅ |
| Manage roles | ❌ | ❌ | ❌ | ✅ |

## Age-Based Feature Gates (DPDP Compliance)

| Feature | ADULT | CHILD (under 18) |
|---------|-------|-------------------|
| Text-only posts | ✅ | ✅ |
| Media upload | ✅ | ❌ |
| Create Reels | ✅ | ❌ |
| Create Stories | ✅ | ❌ |
| Personalized feed | ✅ | ❌ (disabled) |
| Targeted ads | ✅ | ❌ (disabled) |
| Behavioral tracking | ✅ | ❌ (disabled) |
| View public content | ✅ | ✅ |
| Follow/react/comment | ✅ | ✅ |

## Content Visibility States

| State | Visible in feeds? | Author sees? | Moderator sees? |
|-------|-------------------|--------------|------------------|
| `PUBLIC` | ✅ | ✅ | ✅ |
| `LIMITED` | Reduced reach | ✅ | ✅ |
| `SHADOW_LIMITED` | Not in feeds | ✅ (thinks it's public) | ✅ |
| `HELD_FOR_REVIEW` | ❌ | ❌ | ✅ |
| `REMOVED` | ❌ | ❌ | ✅ |
