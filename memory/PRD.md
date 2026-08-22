# ClanChat v4.0 — MVP (spec-aligned)

## What it is
Privacy-first social network ("Your Personal Clubhouse"). React (Vite + TS) SPA + FastAPI. Capacitor-ready for Android. Auth & Storage on Supabase; Firebase removed. Theme: true-black + indigo/violet (orange #FF5A00 CTA replaced per user).

## Core architecture — the three tiers (enforced server-side)
- **Public** (green): anyone with an account; only tier that is searchable & likeable (anonymous).
- **Followers** (amber): approved followers only; follow modes open/approval.
- **Inner Circle** (violet): invite-only (owner invites, member accepts); DMs always open; no tags on Tier-3 posts.
`can_view()` gates every post; `can_dm()` gates DMs.

## Built & tested (39/39 backend tests pass)
- Auth: Supabase Google (web PKCE + Android native Capgo idToken) + sandbox dev-login (real HS256 JWT). Backend verifies Supabase JWT (aud=authenticated).
- Profiles: auto unique #handle, display name, bio (editable), links; follower count private (owner-only).
- My Feed: chronological, scope General/Followers, Words/Gallery toggle, tier selector composer, image/video upload (Supabase Storage), #tags.
- Social graph: follow (open/approval) + requests/accept; Inner Circle invite/accept.
- DMs: tier-gated, **AES-256-GCM encrypted at rest** (interim before Signal), realtime via WebSocket.
- Calls: LiveKit token endpoint + in-DM audio/video call (LiveKit components).
- Likes (public only, anonymous), Search (public only), Trending tags (24h), Activity feed.

## Key endpoints
/api/dev/token, /api/me, /api/profile(PUT), /api/users/{h}(+/posts), /api/follow/{h}, /api/follow-requests(+/{h}/accept), /api/inner/invite|accept/{h}, /api/inner, /api/feed?scope=, /api/posts(+/{id}/like,DELETE), /api/dms(+/{h}), /api/ws/dm/{h}, /api/search, /api/trending, /api/activity, /api/upload, /api/livekit/token

## Env (all in /app/.env)
Supabase (URL/anon/service-role/JWT secret/bucket), DM_ENC_KEY (AES-256), LiveKit (URL/key/secret).

## Known / MOCKED-for-sandbox
- "Quick sandbox sign-in" = real Supabase-signed JWT so app is usable without live Google redirect. Real Google works on localhost/Render after console steps A–D (SETUP.md).
- App data (posts, follows, DMs) in local MongoDB; Auth + Storage + Calls are real 3rd-party (Supabase, LiveKit). Spec's Supabase-Postgres DB can be migrated later.
- LiveKit subdomain in URL (rlnieg0m) should be verified by user against console (O vs 0 ambiguity in the paste).

## NOT yet built (spec P2/P3 — next candidates)
Discussion Boards, group chats (T3 max 15), comments, 18+/NSFW + age verification (Yoti/Veriff/Hive), Choices discovery+ads, Premium/verified shields, payments (Stripe/Xsolla/YooMoney/Printful), screenshot protection, FCM push, Giphy, moderation/CSAM pipeline, Signal Protocol E2E.
