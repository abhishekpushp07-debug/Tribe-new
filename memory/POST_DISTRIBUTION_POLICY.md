# Post Distribution Stage Policy
**Last Updated**: 2026-03-11

## Stage Definitions
| Stage | Name | Visibility | Description |
|-------|------|------------|-------------|
| 0 | New | Author only | Just created, pending evaluation |
| 1 | Community | Limited | Shown to followers and community |
| 2 | Wide | Full public | Shown in main ranked feed |

## Promotion Rules

### Automatic Promotion (on content creation)
1. Post passes moderation AND is PUBLIC → Promoted to stage 2 immediately
2. Post has HELD/ESCALATED moderation → Stays at stage 0
3. Draft posts → Stay at stage 0 with visibility DRAFT
4. Scheduled posts → Stay at stage 0 until publish time

### Signal-Based Re-evaluation (on engagement)
- Likes, comments, shares trigger `triggerAutoEval()` 
- Uses composite scoring: engagement signals, account age, content signals, trust signals
- Requirements for promotion: account age ≥ 7 days, min 1 engagement, no active moderation holds
- Demotion possible on report accumulation or moderation action

### Admin Overrides
- `POST /admin/content/:id/stage` — Override stage for specific post
- `POST /admin/content/batch-evaluate` — Batch re-evaluate multiple posts
- Feature flag `DISTRIBUTION_AUTO_EVAL` controls auto-evaluation globally

## Hard Rules
- REMOVED posts never appear in any feed
- HELD posts stay at stage 0 until manually approved
- Draft/scheduled posts invisible until published
- Published drafts get stage 2 immediately
- Block-filtered content excluded regardless of stage
