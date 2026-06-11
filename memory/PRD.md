# ClanChat - Product Requirements

## Tagline
Your Personal Clubhouse.

## Vision
A privacy-first social space with three visibility tiers (Public / Followers / Inner Circle), no algorithm, # handles, anonymous likes, and hardcoded minor protections.

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
- Profile: avatar, handle, bio, links, Shop placeholder, tabs (Feed/Wall/Boards/Pinned), max 3 pinned
- Follow open/approval modes, request approve/decline
- Inner Circle invite-only with per-member permissions (DMs/audio msg/audio call/video call)
- Adult-minor hardcoded restrictions (follow/DM/invite/search)
- Search by # handle only (minor invisibility, NSFW invisibility for minors)
- Wall (owner/followers/inner perms)
- Discussion Boards per tier
- DMs tier-respecting (T1 none, T2 toggle, T3 per-member)
- Block, mute, report endpoints; strike fields on user
- Comfort Zone settings (NSFW, AI, strong language, violence/self-harm/gore)
- Emergent object storage for media upload
- Bottom nav (Feed/Search/Messages/Profile)
- Dark default true-black + light theme toggle

## Backlog (V2)
- P0: Audio messages, audio/video calls (WebRTC)
- P0: Group chats (Inner Circle only, ≤15, accept-required)
- P0: Real AI scan via Hive Moderation API (current: manual `is_ai` label)
- P0: Yoti age verification
- P1: Audio profile tab
- P1: Shop placeholder real implementation
- P1: Admin moderation panel for strikes (human review, suspend/delete)
- P2: Push notifications

## Endpoints (all /api prefixed)
auth/* posts/* follow/* inner/* dms/* boards/* wall/* users/* upload files/* notifications/counts reports block/* mute/*

## Test Credentials
See /app/memory/test_credentials.md
