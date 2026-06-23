# ClanChat — Product Requirements

## Tagline
Your Personal Clubhouse.

## Vision
A privacy-first social space with three visibility tiers (Public / Followers / Inner Circle), no algorithm, # handles, anonymous likes, and hardcoded minor protections. "My"-style language throughout.

## Personas
- Adult creator who values privacy & inner-circle sharing
- Minor (13–17) needing strict protective defaults
- Casual user who wants chronological feed without algorithm

## Implemented (V1 — Feb 2026)
- JWT email/password + Emergent Google OAuth (both offered on login/register)
- DOB at signup -> is_minor flag
- 3-tier posting (public/followers/inner) with tier visibility filtering
- Tags: lowercase chips, max 10, banned-word block, no tags on inner posts
- Tier 1 NSFW hardcoded block
- Chronological feed with Words/Gallery toggle
- Profile: avatar, handle, bio, links, Shop placeholder, max 3 pinned
- Follow open/approval modes, request approve/decline
- Inner Circle invite-only with per-member permissions
- Adult-minor hardcoded restrictions (follow/DM/invite/search)
- Search by # handle only (minor invisibility, NSFW invisibility for minors)
- Wall, Discussion Boards per tier, DMs tier-respecting
- Block, mute, report endpoints; strike fields on user
- Comfort Zone settings
- Emergent object storage for media upload
- Dark default true-black + light theme toggle

## Implemented (Iter 1 — Feb 2026)
- Comments gated to Inner Circle only (author can always reply)
- AI label hardcoded enforcement: real-person + 18+ = permanent ban, no consent = 48h ban + strike
- Strike history tracked on user
- Soft warning system + dismissable warnings on Notifications

## Implemented (Iter 2-6 — Feb 2026)
- Tagging others on posts (max 10) with approval queue
  - Hardcoded approval required for media tags and 18+ tags (no override)
  - Per-user `taggable_by` (anyone / followers / inner / nobody) + `tag_approval_mode`
- Group chats (Inner Circle only, ≤15, accept-required, silent decline/leave)
- Restrict feature (silently hide comments/tags from a user)
- Audio tab posts (`is_audio_track` flag) — shown on dedicated profile Audio tab
- Admin moderation panel (stats grid, pending reports queue, strike 1/2/3, dismiss)
- Real name field (private by default) with visibility tiers (nobody/inner/followers/everyone)
- Profile tab restructure: Feed (media only) · Wall (text only + wall notes) · Audio · Boards · Pinned
- "My" language: My Feed, My Inner Circle, My Groups, My Comfort Zone

## Backlog (Iter 7 — P0 next)
- CEOP / CSAM pipeline: internal flag flow, quarantine, automated handoff queue, audit logs

## Backlog (Phase 2 — P1/P2)
- Hive Moderation AI scan (replace manual `is_ai` label)
- Yoti / Veriff age verification
- WebRTC audio/video calls + screenshot protection
- Verified accounts + shield colours
- E2E encryption (Signal Protocol) for DMs & group chats
- Creator monetization (premium subs, paid IC, tips)

## Refactor backlog
- Split `backend/server.py` (~1974 lines) into routers: auth, users, posts, inner, boards, groups, admin, moderation, tags
- Use `payload.model_dump()` in `create_post` instead of hand-building the dict (prevents drift like the is_audio_track bug)

## Endpoints (all /api prefixed)
auth/* posts/* posts/audio/{user_id} follow/* inner/* dms/* boards/* wall/* users/* upload files/* notifications/counts reports block/* mute/* tags/pending tags/{tag_id}/approve|reject groups/* restrict/* admin/stats admin/reports admin/reports/{id}/strike|dismiss me/warnings

## Test Credentials
See /app/memory/test_credentials.md
