# ClanChat — Render Deploy Fix + Android Google Sign-In (Phase 1 & 2)

## Repo
https://github.com/clanchatapp-dotcom/ClanChatApp.git (main branch). Note: this Emergent workspace's local git history is disconnected from the real repo's history ("unrelated histories") — all fixes were applied directly on GitHub (branch-off-main + web edits/uploads) rather than via this workspace's "Save to GitHub", to avoid history-merge conflicts. `/app` now mirrors the real app (pulled from the repo) for local build verification only.

## Track 1 — Render Static Deploy (COMPLETE)
- `frontend/package.json`: `date-fns` `4.1.0` → `^3.6.0` (react-day-picker@8.10.1 peer range), added `engines.node: "20.x"`.
- `frontend/yarn.lock`: generated and correctly placed at `frontend/yarn.lock` on main (first attempt mistakenly landed at repo root as `yarn.lock.txt` — corrected).
- `frontend/.node-version` = `20`.
- `frontend/.npmrc` (`legacy-peer-deps=true`, an unwanted band-aid) — removed.
- Render Settings: Build Command set to `yarn install --frozen-lockfile && yarn build`, Root Directory `frontend`, Publish Directory `frontend/build`.
- Stray empty `.github/workflows/main.yml` (unrelated broken CI file, pre-existing) — deleted.
- Verified locally (sandbox + testing_agent): clean `yarn install --frozen-lockfile && yarn build` on Node 20, no ERESOLVE, no engine errors, frontend renders with no date-fns/react-day-picker console errors.
- User confirmed Render deploy succeeded.

## Track 2 — Android Google Sign-In (COMPLETE)
- Debug keystore SHA-1 registered in Firebase (`2c:6f:93:26:b3:15:03:7d:77:6d:e4:01:de:c4:5c:94:ad:c6:b3:7c`); fresh `google-services.json` (project `clanchat-66513`) placed at `frontend/android-resources/google-services.json` on main.
- Supabase → Authentication → URL Configuration: user confirmed `clanchat://auth-callback` + web origins in redirect allow-list, Google provider Client ID matches Firebase's Web OAuth client.
- Fixed a self-inflicted regression: `.github/workflows/android-apk.yml`'s "Setup Node 22" step conflicted with the new `engines.node: "20.x"` in package.json (yarn v1 enforces engines strictly) → changed workflow to Node 20.
- User confirmed: GitHub Actions "Build Android APK" succeeded.
- Deferred (not done): release keystore signing (user is currently debug-signed only), CI lockfile-guard GitHub Action (explicitly deferred earlier).

## Notes for next session
- Backend (`/app/backend`) cannot fully `pip install` in this sandbox due to a pre-existing `emergentintegrations`/`litellm` version conflict — unrelated to these fixes, not yet resolved, only relevant if in-sandbox backend testing is needed later.
- This workspace's git history remains disconnected from the real GitHub repo; continue applying repo edits directly on GitHub (branch off main) rather than via "Save to GitHub" until/unless that's reconciled.
