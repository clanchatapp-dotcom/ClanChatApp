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

## Changelog — Real name visibility + Profile avatar + Admin DANGER ZONE (this session, cont.)
- Real name: profile.real_name + real_name_visibility (private|inner|followers|public). public_profile shows real_name to others only per visibility; self always sees own. Settings has real-name input + "who can see" selector. Profile shows real_name line under display name (backend-gated).
- Profile avatar upload: orange? NO — brand/violet camera button on avatar (self only) -> /api/upload -> updateProfile(avatar_url). Kept violet/indigo theme per user choice.
- Admin DANGER ZONE: POST /api/admin/promote {email} (promote to admin), POST /api/admin/purge-demo {include_admin} (purge alice/bob/teen + optional seeded admin, never self). Deleted counter (db.counters) + admin_stats 'deleted'. UI: DELETED stat card + DANGER ZONE section with 3 buttons + confirm dialogs.
- Accent color: user chose to KEEP violet/indigo (not switch to old orange).
- Verified: backend 38/38 passed. Frontend build clean. Frontend UI test pending user go-ahead.

## Changelog — Consolidated Google OAuth to ClanChatApp project
- Switched Google webClientId from old project (286762294730-2hu26...) to ClanChatApp Web client: 24500940599-ps9kauvvquoh2ldh2iacsb04piui40cs.apps.googleusercontent.com
- Updated in: src/lib/nativeGoogle.ts (PUBLIC_GOOGLE_WEB_CLIENT_ID), .github/workflows/android-apk.yml fallback, .env.
- Android client (same project): 24500940599-bbuca... pkg app.clanchat.mobile SHA-1 23:C2:C4:7F:B8:6D:1B:4A:9F:5B:4F:21:20:C6:1E:F2:CD:6B:E0:9B (matches keystore in GitHub secret, verified).
- USER TODO: add new Web client ID to Supabase Google provider Authorized Client IDs; ensure no stale GitHub secret REACT_APP_GOOGLE_WEB_CLIENT_ID overrides new value; Save to GitHub + rebuild APK.

## Changelog — Admin account + admin management (this session, cont.)
- Seeded super-admin login: admin@clanchat.app / ClanChatAdmin!2025 (env SEED_ADMIN_EMAIL/PASSWORD override on Render). is_admin + in ADMIN_EMAILS. Saved to memory/test_credentials.md.
- DB admin allowlist (db.admin_allow); ensure_profile grants is_admin on creation if email in ADMIN_EMAILS or allowlist.
- Endpoints: GET /api/admin/admins (admins[] with super flag + pending[]), POST /api/admin/admins (add: promote existing or allowlist), POST /api/admin/admins/remove (revoke; blocks env super-admins + self). Tested 32/32.
- Admin panel: new "Admins" tab -> add admin by email, list admins (super badge / protected), remove, pending allowlist section.

## Changelog — Change password
- POST /api/auth/change-password {current_password,new_password}: verifies current (pbkdf2), rotates salt+hash, 400 for Google-only accounts / wrong current / <6 chars. /api/me returns has_password (self).
- Settings: "Change password" card (current/new/confirm) shown only for email/password accounts. Tested 21/21.

## Changelog — "Me, Myself & I" self-DM (Saved Messages)
- Backend: can_dm(me,me)=True; self room dm:<id>:<id>, encrypted, isolated per user; dm_threads shows self thread. Tested 26/26.
- Frontend (Messages): pinned "Me, Myself & I" entry at top of thread list (Bookmark icon, gradient), opens /messages/<own handle>; self view header shows "Me, Myself & I / Your private space", hides call buttons, empty-state hint. Normal threads exclude the self entry (dedup).

## Changelog — Login hang fix (Render cold start)
- ROOT CAUSE of APK "Please wait..." hang: Render free-tier COLD START (~35s; backend returned HTTP 000 then 200 after 35s) + api.ts req() had no timeout -> button hung forever.
- FIX: api.ts req() now uses 60s AbortController timeout + friendly errors ("server waking up" / "could not reach server"). Verified backend login 21/21, avg 0.195s, seeded admin login OK.
- USER DEPLOY TODO for full resolution: (1) Save to GitHub so Render redeploys (creates seeded admin@clanchat.app on Atlas + carries all new features); (2) consider Render paid tier to avoid ~35s cold starts; (3) Google [16]: rebuild APK (bakes new webClientId 24500940599-ps9ka...) + add that Web client ID to Supabase > Auth > Providers > Google > Authorized Client IDs + ensure Android client 24500940599-bbuca (pkg app.clanchat.mobile, SHA-1 23:C2...) exists.
