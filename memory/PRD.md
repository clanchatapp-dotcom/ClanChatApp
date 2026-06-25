# ClanChat — Product Requirements

## Tagline
Your Personal Clubhouse.

## Vision
A privacy-first social space with three visibility tiers (Public / Followers / Inner Circle), no algorithm, # handles, anonymous likes, and hardcoded minor protections. "My"-style language throughout. Cross-device: web (desktop + mobile) today, native app (Capacitor wrap) Phase B.

## Personas
- Adult creator who values privacy & inner-circle sharing
- Minor (13–17) needing strict protective defaults
- Casual user who wants chronological feed without algorithm

## Implemented (V1 — Feb 2026)
- JWT email/password + Emergent Google OAuth
- DOB at signup -> is_minor flag
- 3-tier posting with tier visibility filtering
- Tags: lowercase chips, max 10, banned-word block, no tags on inner posts
- Tier 1 NSFW hardcoded block
- Chronological feed with Words/Gallery toggle
- Profile: avatar, handle, bio, links, Shop placeholder, max 3 pinned
- Follow open/approval modes
- Inner Circle invite-only with per-member permissions
- Adult-minor hardcoded restrictions
- Search by # handle only with minor & NSFW invisibility rules
- Wall, Discussion Boards per tier, DMs tier-respecting
- Block, mute, report endpoints; strike fields
- Comfort Zone settings
- Emergent object storage for media upload
- Dark default true-black + light theme toggle

## Implemented (Iter 1)
- Comments gated to Inner Circle only
- AI label hardcoded enforcement: real-person + 18+ = permanent ban; no consent = 48h ban + strike
- Strike history + soft warning system

## Implemented (Iter 2-6)
- Tagging others (max 10) with approval queue; hardcoded approval for media + 18+ tags
- Group chats (Inner Circle only, ≤15, accept-required, silent decline/leave)
- Restrict feature
- Audio tab posts (`is_audio_track`) with dedicated profile tab
- Admin moderation panel (stats, reports queue, strike 1/2/3, dismiss)
- Real name field with visibility tiers
- Profile tab restructure: Feed (media) · Wall (text + wall notes) · Audio · Boards · Pinned
- "My" language: My Feed, My Inner Circle, My Groups, My Comfort Zone

## Implemented (Iter 7 — Phase A cross-device, Feb 2026)
- **OnboardingTour.jsx** — 4-step modal on first login (Tiers · Comfort Zone · Inner Circle · Tag approvals); persisted in localStorage per user
- **DesktopSidebar.jsx** — full desktop navigation (Feed/Search/Messages/Groups/Activity/Profile/Settings/Admin + New Post CTA + user chip) — visible at lg+ only
- **Responsive AppShell** — desktop = sidebar + center column; mobile = bottom nav (unchanged)
- **PWA manifest.json** — installable to home screen, branded SVG icon, standalone display, theme color #000
- **SEO + social cards** — proper `<title>`, description, Open Graph + Twitter Card meta tags

## Backlog — P0 next
- **Iteration 8 (CEOP/CSAM pipeline)**: internal flag flow, quarantine, automated handoff queue, audit logs

## Backlog — Phase B (Mobile App)
- Capacitor wrap for iOS / Android app stores (~1 week of work)
- Switch auth to bearer tokens in secure storage (httpOnly cookies don't work in native webviews)
- Push notifications (FCM/APNs)
- Deep linking (`clanchat://u/<handle>`, `clanchat://p/<post_id>`)

## Backlog — Phase 2 (P1/P2)
- Hive Moderation AI scan (replace manual is_ai)
- Yoti / Veriff age verification
- WebRTC audio/video calls + screenshot protection
- Verified accounts + shield colours
- E2E encryption (Signal Protocol) for DMs & group chats
- Creator monetization

## Refactor backlog
- Split `backend/server.py` (~1974 lines) into routers
- Use `payload.model_dump()` in `create_post` instead of hand-built dicts (prevents drift bugs)

## Test Credentials
See /app/memory/test_credentials.md
