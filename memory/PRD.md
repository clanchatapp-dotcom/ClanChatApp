# ClanChat — Product Requirements

## Tagline
Your Personal Clubhouse.

## Vision
Privacy-first social with three tiers (Public / Followers / Inner Circle), no algorithm, # handles, anonymous likes, hardcoded minor protections. Cross-device: web (desktop + mobile) + native (Capacitor) when ready.

## Personas
- Adult creator who values privacy & inner-circle sharing
- Minor (13–17) with strict protective defaults
- Casual user wanting a chronological feed

## Implemented

### V1 — Feb 2026
- JWT email/password + Emergent Google OAuth
- DOB → is_minor flag
- 3-tier posting with strict tier visibility
- Tags: lowercase, max 10, banned-word block, no tags on inner
- Tier 1 NSFW hardcoded block; comfort zone overrides
- Chronological feed (Words/Gallery toggle)
- Profile: avatar, handle, bio, links, pinned (max 3)
- Follow open/approval modes
- Inner Circle invite-only + per-member permissions
- Adult↔minor hardcoded restrictions (follow/DM/invite/search)
- Search by # handle (minor + NSFW invisibility)
- Wall, Discussion Boards, DMs (all tier-respecting)
- Block, mute, report
- Emergent object storage for media
- Dark/light theme (true-black default)

### Iter 1 — Comments + AI rules
- Comments gated to Inner Circle only
- AI label hardcoded: real-person + 18+ = permanent ban; no consent = 48h ban + strike
- Strike system + soft warnings

### Iter 2–6 — Tagging, Groups, Audio, Admin
- Tagging others (max 10) with approval queue; hardcoded approval for media + 18+ tags
- Group chats (Inner Circle only, ≤15, accept-required)
- Restrict feature (silent hide)
- Audio tab posts (`is_audio_track`)
- Admin moderation panel (stats, reports queue, strike 1/2/3, dismiss)
- Real name with visibility tiers
- Profile tab restructure: Feed (media) · Wall (text + notes) · Audio · Boards · Pinned
- "My" language across surfaces

### Iter 7 — Cross-device polish
- 4-step OnboardingTour (Esc / backdrop / button to dismiss)
- DesktopSidebar (lg+) — full nav + brand + user chip + New Post CTA
- Responsive AppShell — mobile bottom nav unchanged; desktop sidebar
- PWA manifest, installable, branded SVG icon
- SEO + Open Graph + Twitter Card meta

### Iter 8 — CEOP/CSAM Compliance + Discovery (Feb 2026)
- `can_view_post` enforces quarantine globally (only admin sees flagged content)
- `/posts/feed` also adds mongo-level `quarantined: {$ne: true}` filter, gated to non-admins
- Auto-quarantine on CSAM report — content hidden before any human review
- `csam_reports` collection (separate from regular reports)
- `audit_events` collection — append-only compliance trail
- Admin endpoints: `GET /admin/csam/queue`, `POST /admin/csam/{id}/confirm` (escalate + Strike 3 + delete), `POST /admin/csam/{id}/clear` (false alarm + restore), `GET /admin/audit`
- Optional `CEOP_ENDPOINT` env var for automated NCMEC/IWF handoff
- Admin UI: 3 tabs (Reports · CSAM queue · Audit log) with severity styling
- Report dialog on PostCard with 7 categories incl. CSAM-flagged red treatment
- TrendingRail right-rail at 2xl+ (1536+) — top 10 tags last 24h, public-only, NSFW hidden for minors
- Capacitor scaffold (`capacitor.config.js`) + `CAPACITOR.md` build guide
- Pre-commit hooks (`.pre-commit-config.yaml`) — Ruff + ESLint + safety nets

### Tooling
- `frontend/eslint.config.mjs` (ESLint 9 flat config) — real-bug rules only, noise off
- `backend/pyproject.toml` (Ruff) — focused selection + explicit ignores for false positives

## Backlog — Phase B (Mobile App)
- Capacitor first build + `cap add ios` / `cap add android` (config ready)
- Auth migration: cookies → bearer tokens in secure storage
- Push notifications (FCM + APNs)
- Deep linking (`clanchat://u/<handle>`, `clanchat://p/<post_id>`)
- App Store + Play Store listings

## Backlog — Phase 2 (P1/P2)
- Hive Moderation AI scan (replace manual is_ai)
- Yoti / Veriff age verification
- WebRTC audio/video calls + screenshot protection in DMs
- Verified accounts + shield colours
- E2E encryption (Signal Protocol)
- Creator monetization (premium subs, paid IC, tips)

## Refactor backlog
- Split `backend/server.py` (~2100 lines) into routers
- Switch `create_post` to `payload.model_dump()`

## Test Credentials
See /app/memory/test_credentials.md
