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

## Changelog — Settings + APK/login fixes (this session)
- Android APK: fixed CI (compileSdk/targetSdk 36, AGP 8.9.1, android-36 SDK install, gradle.properties suppressUnsupportedCompileSdk) — prior fixes were uncommitted; user must "Save to GitHub".
- Fixed APK black screen: baked PUBLIC Supabase URL/anon key + Google web client id as fallbacks in supabase.ts/nativeGoogle.ts (createClient no longer crashes on empty key); added ErrorBoundary + boot guard in main.tsx (visible error instead of black screen).
- APK backend connectivity: baked Render backend https://clanchatapp-backend.onrender.com as native fallback in api.ts (computeApiBase) + workflow REACT_APP_API_URL fallback. Sandbox/web unchanged (relative /api).
- Google native sign-in fix: removed `scopes` from SocialLogin.login (capgo v7 "scopes without modifying main activity" error) + added MainActivity ModifiedMainActivityForSocialLoginPlugin bridge.
- Backend hardening: DM_ENC_KEY parsing wrapped (_load_dm_key) so bad/missing key can't crash startup (likely Render 502 cause).
- NEW Settings page (/settings): edit display name, privacy toggles (follow_mode approval, dm_open), sign out, delete account (typed-DELETE confirm). Added sidebar + mobile nav links.
- NEW backend endpoint: DELETE /api/account (wipes profile/auth/posts/follows/inner/dms/activity/reports). Tested 26/26 backend, 5/5 frontend.
- PENDING user: (a) Save to GitHub + redeploy Render backend (fixes 502) + rebuild APK; (b) provide shield logo file to integrate into header/login/favicon/Android icon.

## Changelog — Branding + Comfort Zone + Admin (this session, cont.)
- Brand logo (shield + gold C + sword) integrated: /app/public/logo.png (optimized 256px transparent, 53KB). Used on Login (desktop+mobile), sidebar header; favicon + apple-touch-icon + og:image in index.html.
- Android launcher icons regenerated at all densities (mipmap-mdpi..xxxhdpi): ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png; adaptive ic_launcher_background color set to #0B1020 (navy). Full-res source kept at /tmp only; app uses trimmed versions.
- Comfort Zone settings section added (NSFW/AI/Strong language/Violence/Drugs toggles), backend profile.comfort_zone + sanitizer + /api/me self-only exposure. Tested 42/42 backend.
- Admin: added thomasgallacher92@gmail.com to ADMIN_EMAILS (sandbox .env). Prod requires ADMIN_EMAILS env on Render. Admin link (Shield) shows in sidebar when is_admin.
- Google APK sign-in error [16] = needs Android OAuth client (pkg app.clanchat.mobile + SHA-1 23:C2:C4:7F:B8:6D:1B:4A:9F:5B:4F:21:20:C6:1E:F2:CD:6B:E0:9B) + stable keystore secret ANDROID_KEYSTORE_BASE64. Config only, no code change.
- Render backend was misconfigured as Node service running old CRA (craco start) -> 502; must be Python web service (rootDir backend, uvicorn start). User recreating it.
