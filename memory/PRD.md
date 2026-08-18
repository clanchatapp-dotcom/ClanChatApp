# ClanChat — Render Deploy Fix (Track 1)

## Context
Repo: https://github.com/clanchatapp-dotcom/ClanChatApp.git (cloned to /app/clanchat_repo for this session; NOT the /app-connected workspace).
Render static-site build was failing with ERESOLVE: `date-fns@4.1.0` conflicts with `react-day-picker@8.10.1` peer range (`^2.28.0 || ^3.0.0`).

## What was done (this session)
- `frontend/package.json`: `date-fns` pinned to `^3.6.0` (was `4.1.0`); added `"engines": { "node": "20.x" }`.
- Generated `frontend/yarn.lock` from scratch (none existed in repo before) — resolves `date-fns@3.6.0`.
- Added `frontend/.node-version` = `20`.
- Verified locally: `rm -rf node_modules && yarn install --frozen-lockfile` → succeeds, no ERESOLVE. `yarn build` → succeeds (CRA/craco build, only pre-existing eslint warnings, no errors).
- Confirmed no direct `date-fns` imports in `src/` — only transitive via `react-day-picker`'s Calendar UI component, which itself is not referenced anywhere in `src/pages` or `src/components` (unused shadcn primitive) — zero runtime risk from the version bump.
- Confirmed frontend env var usage: only `REACT_APP_BACKEND_URL` and `REACT_APP_APK_URL` are read via `process.env` in `src/`. Supabase URL/anon key are NOT baked at build time — they're fetched at runtime from the backend via `GET /api/supabase/config` (`src/lib/supabase.js`). So Render's frontend env vars only need `REACT_APP_BACKEND_URL=https://clanchat.app` (+ `REACT_APP_APK_URL` if used) — no Supabase secrets needed on the static site.

## Not done (out of scope / requires dashboard or user action)
- Render dashboard config (Root Directory/Build/Publish commands, env vars) — must be set by user in Render UI, not code.
- Actual deploy trigger + smoke test on live Render URL — needs user to trigger from their Render account.
- CI guard (`yarn install --frozen-lockfile` GitHub Action) — explicitly deferred by user.
- Track 2 (Android Google Sign-In: Firebase SHA fingerprints, google-services.json, Supabase redirect URLs) — explicitly deferred by user, needs release keystore + Firebase/Supabase access.

## Note on delivery
Changes exist locally in the cloned repo, not pushed (no push credentials for external repo, and per platform rules the agent doesn't perform git push). User needs to pull these 3 file changes into their repo (diff below) and push themselves.

## Backlog (deferred)
- Track 2: Android Google Sign-In fix.
- Optional CI guard on PRs.
