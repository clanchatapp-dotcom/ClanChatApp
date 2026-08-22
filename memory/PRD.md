# ClanChat — MVP

## What it is
Real-time group ("clan") chat with media sharing. React (Vite+TS) SPA + FastAPI backend. Auth & Storage on Supabase. Firebase fully removed. SPA is Capacitor-ready for Android (app.clanchat.mobile).

## Architecture (this sandbox)
- Frontend: Vite React SPA on :3000 (proxies /api -> :8001, incl. websockets).
- Backend: FastAPI on :8001, all routes under /api.
- Auth: Supabase Google OAuth (web PKCE + native Capgo idToken). Backend verifies Supabase JWT (HS256, aud=authenticated) via SUPABASE_JWT_SECRET.
- Storage: Supabase bucket `clanchat-media` (private) + signed URLs, uploaded server-side with service role.
- Messages/clans: MongoDB (local) — chosen for the sandbox because Supabase Postgres tables/RLS require manual dashboard SQL. Auth+Storage are real Supabase.

## Key endpoints
- POST /api/dev/token  (sandbox login -> real HS256 JWT)
- GET  /api/me
- GET/POST /api/clans, POST /api/clans/join, POST /api/clans/{id}/join
- GET/POST /api/clans/{id}/messages
- POST /api/upload  (multipart -> {path, signed_url})
- WS   /api/ws/{clan_id}?token=JWT  (broadcast)

## Status
Backend: 20/20 automated tests passing (incl. real storage + websocket). Frontend: manual screenshot OK; not yet agent-tested.

## Known / MOCKED-for-sandbox
- "Quick sandbox sign-in" mints a REAL Supabase-signed JWT (valid for our backend) so the app is usable without a live Google redirect. Real Google sign-in is fully wired for localhost/Render (see SETUP.md steps A-D).
- Clan/message data uses MongoDB in this sandbox instead of Supabase Postgres.
