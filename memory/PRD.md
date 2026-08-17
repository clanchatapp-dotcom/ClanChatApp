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

## ANDROID APK GOOGLE SIGN-IN BUG — diagnosed & fixed (this session)
Symptom: in the Android APK, "Continue with Google" opened Google then silently bounced back to
the sign-up page. Web Google works (a real Google user exists in Mongo). Verified all config is
correct: Supabase Google provider enabled (Web client 24500940599-hisa969...), Callback URL
https://fkhsijjwkrwbwjjaapbb.supabase.co/auth/v1/callback, redirect allow-list includes
`clanchat://auth-callback` + web/localhost/capacitor entries; production /api/auth/supabase-login
returns 200 with correct CORS from Origin https://localhost (the APK WebView origin); the
deep-link handler + clanchat:// intent-filter injection exist.
Root cause: the Supabase client used the default IMPLICIT OAuth flow → session returned in the URL
*fragment* (#access_token=...). Android strips the fragment when Chrome Custom Tabs fires the
`clanchat://` intent, so the app received an empty callback and bounced.
Fixes (need APK rebuild + web re-publish):
- frontend/src/lib/supabase.js: force `flowType: "pkce"` — OAuth now returns `?code=...` in the
  query string (preserved in the deep link); the AuthContext handler calls exchangeCodeForSession.
  PKCE is auto-handled on web via detectSessionInUrl. No regression to email/password.
- .github/workflows/android-apk.yml: hardened the clanchat:// intent-filter injection (tolerant
  MainActivity match) and made the build FAIL if the filter is missing, so a silently-broken APK
  can't ship.
Verified in preview: iteration_5 — backend 14/14, frontend 100%, no regression (Google OAuth not
auto-testable; requires a rebuilt APK on a device).

## APK GOOGLE — round 2 (likely true root cause): Capacitor version mismatch
The APK still bounced after PKCE. Found a MAJOR-VERSION MISMATCH in Capacitor plugins:
@capacitor/app@8.1.1 and @capacitor/browser@8.0.4 were installed on @capacitor/core@7.6.8
(also @capacitor-community/privacy-screen@8). Capacitor requires all packages share the same
major version — a v8 App plugin on the v7 Android bridge does not register, so its
`appUrlOpen` listener silently never fires and the clanchat:// deep-link is dropped -> bounce.
Fixes (need APK rebuild):
- package.json: pinned @capacitor/app@7.1.2, @capacitor/browser@7.0.5,
  @capacitor-community/privacy-screen@6.1.0 to match @capacitor/core@7.6.8.
- AuthContext deep-link handler rewritten: App.getLaunchUrl() cold-start support, parses
  ?code (PKCE) + #fragment, surfaces Supabase error params, shows on-screen toasts on failure.
- workflow: intent-filter injection hardened + build fails if the clanchat:// filter is missing.
Verified in preview: iteration_6 — backend 14/14, frontend 100%, no regression.


## Backlog / future
- Split server.py into routers.
- Clean up React hydration warning (<span> inside <option>) in AppShell (pre-existing, low pri).
- Optional: enable FCM push (FCM_SERVICE_ACCOUNT_JSON_B64) and LiveKit calls (LIVEKIT_*).
- Optional: TENOR_API_KEY / GIPHY_API_KEY for the sticker/GIF picker.
- Suppress the expected Supabase 400 console.error on legacy-fallback login (cosmetic).

## Two-step registration + Google robustness (this session)
- Register.jsx split into 2 steps: step 1 = email + password ("Continue"), step 2 = # handle +
  display name + DOB ("Create account"). Account created only on step 2 submit (single /register
  call). Back button preserves entries. Verified iteration_8 (frontend 100%).
- Google APK robustness (already in code): GoogleButton resets busy in finally (unsticks
  "Opening Google…" so retry works); deep-link handler retries the backend token exchange up to
  3x on transient/5xx/network errors (PKCE code exchange NOT retried — single-use); cold-start
  via App.getLaunchUrl(); failures surfaced as on-screen toasts.
- api.js getToken/getRefreshToken now time out the native Capacitor Preferences read (1200ms)
  and fall back to localStorage — fixes the APK "everything spins / can't log in" freeze.
- STATUS: email/password login confirmed working by user (web + APK). Google worked once in APK
  (pipeline correct) but is flaky; needs a fresh APK rebuild with the robustness fixes to confirm.
- ACTION for user: re-publish web + rebuild APK to ship these (both are bundled at build time).

## Login scan (this session) — findings + fixes
- Live-site email/password login VERIFIED WORKING in a clean browser (reached /feed, all 200s,
  no errors). So the user's "live site just sits there" = a STALE CACHED build on their device
  (PWA service worker / old APK), not a code bug. Bumped public/sw.js SHELL_CACHE v1->v2 (and
  dropped /feed from precache) so old caches purge on next load.
- Google web bug FIXED: signInWithOAuth redirectTo was `${origin}/feed` (a Protected route) — the
  guard redirected to /login and stripped the ?code= before Supabase read it => stuck on
  "Welcome back". Now redirects to PUBLIC `${origin}/login`; Login.jsx added
  useEffect(if user -> nav('/feed')) to forward once the session lands. (Also covers the preview
  "403 on sign up with Google" which was the same callback race.)
- APK "just sits there" for email/password = old APK lacking the getToken() native-storage
  timeout fix -> rebuild required.
- Verified iteration_9: frontend 100%, no regression/loops.
- ACTION for user: RE-PUBLISH web (purges stale SW, ships Google redirect fix) + REBUILD APK.
