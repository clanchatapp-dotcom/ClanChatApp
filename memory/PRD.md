# ClanChat — PRD & Restoration Log

## Original problem (restoration task)
User's ClanChat app (React + FastAPI + MongoDB, privacy-first social platform) was broken after
losing access to the previous Emergent account. Symptoms: existing users couldn't log in; Google
sign-in bounced back to the signup screen or said "you're in" but did nothing; admin accounts
inaccessible. User provided two zips (a broken Next.js variant + a last-known-working React/FastAPI
build) and asked to restore the working behavior. User has their own Supabase + Firebase/Google
setup; old MongoDB data is unrecoverable (fresh DB), OK to start fresh on data.

## Architecture
- **Frontend**: React 19 (CRA + craco), react-router 7, Tailwind, Radix UI, framer-motion, sonner.
- **Backend**: FastAPI (single large server.py ~5300 lines), Motor/MongoDB.
- **Auth**: ClanChat-issued JWT is the runtime session. Email/password tries Supabase first then
  falls back to legacy JWT (`/api/auth/login`). Google = Supabase OAuth → `/api/auth/supabase-login`
  exchanges the Supabase token for a ClanChat JWT.
- **Storage**: Supabase Storage (bucket `ClanChatApp`) via backend-issued signed upload URLs.
- **Push**: Firebase FCM (optional; disabled unless FCM_SERVICE_ACCOUNT_JSON_B64 set).
- **Calls**: LiveKit (optional; disabled unless LIVEKIT_* set).

## What was done (restoration — this session)
- Deployed the last-known-working codebase into /app (backend + frontend).
- Installed deps (dropped unused emergentintegrations/litellm lines that had a hard version conflict;
  neither is imported).
- Configured backend/.env: MONGO_URL, DB_NAME=clanchat, generated JWT_SECRET + DM_ENCRYPTION_KEY,
  SEED_DEMO_DATA=1, and the user's Supabase URL / anon / service_role keys + bucket ClanChatApp.
- Made Supabase bootstrap degrade gracefully when unconfigured (no more CRA unhandled-rejection
  overlay) — `onSupabaseAuth` now swallows client-init failure.
- **Fixed the "signed in but nothing happens" Google bug**: the Supabase Google flow returned
  `needs_profile` (new users must set # handle + DOB) but nothing collected it. Added a global
  `CompleteProfile` screen (src/pages/CompleteProfile.jsx) wired via AuthContext
  (`pendingProfile` + `completeSupabaseProfile`) and mounted in App.js.
- Verified end-to-end: email/password login (admin + bob), registration, admin panel, feed,
  Supabase config, signed upload URL, and the supabase-login needs_profile→create contract.
  Backend 10/10 + frontend 4/4 tests pass.

## Verified working
- admin@clanchat.app / admin123 → /feed with Admin panel (role=admin). ✅
- Email/password login + registration (legacy JWT fallback). ✅
- Supabase Storage signed uploads (bucket ClanChatApp). ✅
- Supabase Google provider enabled; new-user onboarding screen works. ✅ (code + backend verified)

## Remaining user-side step (for Google to fully round-trip)
- In Supabase → Authentication → URL Configuration:
  - Site URL: `https://clan-chat-fix.preview.emergentagent.com`
  - Add redirect URL (allow list): `https://clan-chat-fix.preview.emergentagent.com/**`
  (Old account's redirect list likely still points to the old domain — this is why Google
  "shot back to signup". Must be updated to the current URL; and updated again at deploy time.)

## Backlog / future
- Split server.py into routers (auth/feed/admin/moderation).

## PRODUCTION LOGIN BUG — diagnosed & fixed (this session)
Symptom: login worked in preview but failed on the live deploy (spins / bounces / error).
Root cause (from production console logs): the app sent **credentialed (cookie) requests**, and
cross-origin production responses carry `Access-Control-Allow-Origin: *` (injected by the Emergent
ingress). Browsers FORBID wildcard ACAO with credentials mode 'include', so every authenticated
call was blocked — but ONLY cross-origin: the deployed frontend calls `https://clanchat.app/api`,
so visiting via `*.emergent.host` (or the Android APK WebView at `https://localhost`) is
cross-origin and blocked, while visiting via `clanchat.app` is same-origin and works.
Verified: production backend + admin seed are fine (POST /api/auth/login returns 200 role=admin);
logging in via https://clanchat.app reaches /feed successfully.

Fix (needs REDEPLOY to reach production):
- frontend/src/lib/api.js: axios `withCredentials:false` (+ refresh call). Auth is carried purely by
  the `Authorization: Bearer` token (localStorage / Capacitor Preferences), which works same-origin
  AND cross-origin, so wildcard ACAO no longer blocks it. Fixes emergent.host web + the APK.
- backend/server.py: CORS now echoes specific origins via allow_origin_regex
  (preview / *.emergent.host / clanchat.app / localhost / capacitor) instead of wildcard.
Verified in preview: iteration_3 — backend 14/14, frontend 100%, zero CORS/credentials console errors.

Regression suite: /app/backend/tests/test_auth_restoration.py (14 tests).

## Backlog / future (cont.)
- Optional: enable FCM push (FCM_SERVICE_ACCOUNT_JSON_B64) and LiveKit calls (LIVEKIT_*).
- Optional: TENOR_API_KEY / GIPHY_API_KEY for the sticker/GIF picker.
- Suppress the expected Supabase 400 console.error on legacy-fallback login (cosmetic).
