# ClanChat Test Credentials

## Auth Endpoints
- POST /api/auth/register (body: email, password, handle, dob, display_name)
- POST /api/auth/login (body: email, password)
- POST /api/auth/logout
- GET  /api/auth/me
- POST /api/auth/google-session (body: session_id)  -- Emergent Google OAuth callback exchange

## Seeded Admin
- email: admin@clanchat.app
- password: admin123
- role: admin

## Pre-seeded Demo Users (created on first startup if missing)
- alice@clanchat.app / Password123! / handle: alice / role: user (adult, DOB 1995-04-12)
- bob@clanchat.app / Password123! / handle: bob / role: user (adult, DOB 1992-09-01)
- teen@clanchat.app / Password123! / handle: teenager / role: user (minor, DOB 2012-01-01)

All auth uses httpOnly cookies (access_token, refresh_token).
Send `withCredentials: true` from frontend or `-b cookies.txt` via curl.
