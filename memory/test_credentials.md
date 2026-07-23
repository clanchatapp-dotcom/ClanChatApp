# Test credentials — ClanChat preview environment

Both accounts live in the current preview Mongo database.

## Adult account
- email: `audiotester@clanchat.app`
- password: `AudioTest123!`
- handle: `audiotester`
- user_id: `user_81ace9a329a7`
- role: user (regular adult)

## Minor account (for testing minor-protection rules)
- email: `minortest@clanchat.app`
- password: `MinorTest123!`
- handle: `minortestuser`
- user_id: `user_1ebafbfee536`
- role: user (minor, DOB 2012-01-01)

## Auth provider
- Legacy JWT auth is still the primary session mechanism.
- Supabase Auth is now available (email/password + Google OAuth) at
  `/api/auth/supabase-login`. New users go through Supabase; legacy accounts
  above still work via `/api/auth/login`.
- Firebase Auth code was removed — Firebase is now used only for FCM push.

## Notes for testers
- `get_current_user()` prefers the `access_token` cookie over the
  `Authorization: Bearer` header. Use a fresh cookie-less client per user
  when scripting cross-user tests.
- Bucket name for Supabase Storage is `ClanChatApp` (capital C, on purpose).
- Seeded demo accounts (alice, bob, ...) were purged. Only the two above
  are guaranteed to exist.
