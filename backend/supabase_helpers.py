"""Supabase bootstrap + helpers for ClanChat.

Supabase handles two responsibilities:
  1. Auth (email/password + Google via `signInWithIdToken`/`signInWithOAuth`)
  2. Storage (all media — photos, videos, audio, avatars)

Firebase is retained ONLY for FCM push notifications (free tier, no upgrade
required). Everything else has moved off Firebase.

The client is created with the `service_role` key so backend operations
bypass RLS. NEVER ship this key to the browser — the `anon` key is what
the frontend uses.

Exposed helpers
---------------
- `client()` — singleton Supabase client.
- `verify_access_token(token)` — verify a Supabase Auth JWT locally
  (via the Supabase admin SDK) and return the decoded claims.
- `signed_upload_url(path, ...)` — returns a signed URL + token the
  client can use to POST/PUT bytes directly to Supabase Storage.
- `signed_download_url(path, expires_seconds)` — for private objects.
- `public_url(path)` — for public-read objects (the default for ClanChat
  media).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

# Guard the optional runtime dependency so a missing package produces a
# clear, diagnosable error instead of an uncaught ImportError that
# surfaces as a confusing 500.
try:
    from supabase import Client, create_client
except Exception as e:  # pragma: no cover - runtime guard
    class SupabaseConfigError(RuntimeError):
        """Raised when the supabase client lib is missing or env is misconfigured."""
        pass

    # Fail fast with a clear error type the server can catch and map to 500.
    raise SupabaseConfigError("Supabase client library not installed: please pip install supabase==2.31.0") from e
else:
    # If import succeeded, expose the exception name so callers can import it.
    class SupabaseConfigError(RuntimeError):
        """Raised when the supabase client lib is missing or env is misconfigured."""
        pass

log = logging.getLogger("clanchat.supabase")

_CLIENT: Optional[Client] = None


def client() -> Client:
    """Lazy-init singleton Supabase client (backend, service_role)."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        # Distinguish misconfiguration from an invalid token.
        raise SupabaseConfigError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
    _CLIENT = create_client(url, key)
    log.info("Supabase client initialised for %s", url)
    return _CLIENT


def bucket_name() -> str:
    return os.environ.get("SUPABASE_BUCKET", "clanchat")


# ---------------------------------------------------------------
# Auth token verification
# ---------------------------------------------------------------
def verify_access_token(access_token: str) -> dict:
    """Verify a Supabase-issued access token by asking Supabase to look it
    up. Called ONCE per login (frontend then uses our own JWT for subsequent
    calls), so the network hop is acceptable.

    Returns a dict shaped like:
        { "id": "<uuid>", "email": "...", "email_verified": bool,
          "provider": "email" | "google" | ..., "name": "...", "picture": "..." }

    Raises:
      - SupabaseConfigError on server misconfiguration (missing client/env).
      - RuntimeError on token rejection / verification failure.
    """
    supa = client()  # may raise SupabaseConfigError
    try:
        resp = supa.auth.get_user(access_token)
    except Exception as e:
        raise RuntimeError(f"Supabase token rejected: {e}") from e

    # SDK returns either a model-like object with attributes or a dict.
    user = getattr(resp, "user", None) or (resp.get("user") if isinstance(resp, dict) else None)
    if not user:
        raise RuntimeError("Supabase returned no user for token")

    # Helper to read from either an object-with-attrs or a dict.
    def g(obj, key, default=None):
        if not isinstance(obj, dict):
            return getattr(obj, key, default)
        return obj.get(key, default)

    md = g(user, "user_metadata") or {}
    identities = g(user, "identities") or []

    # Determine provider in a robust way.
    provider = None
    if identities and isinstance(identities[0], dict):
        provider = identities[0].get("provider")
    if not provider:
        app_meta = g(user, "app_metadata") or {}
        try:
            provider = app_meta.get("provider") if isinstance(app_meta, dict) else getattr(app_meta, "provider", None)
        except Exception:
            provider = None
    if not provider:
        provider = "email"

    return {
        "id": g(user, "id"),
        "email": (g(user, "email") or "").lower(),
        "email_verified": bool(g(user, "email_confirmed_at")),
        "provider": provider,
        "name": (md.get("full_name") or md.get("name") or "").strip(),
        "picture": md.get("avatar_url") or md.get("picture"),
    }


# ---------------------------------------------------------------
# Storage
# ---------------------------------------------------------------
def signed_upload_url(path: str) -> dict:
    """Create a v1 signed upload URL. The client PUTs bytes to `signed_url`
    directly. Returns a dict with path, signed_url, token, public_url.
    """
    b = bucket_name()
    supa = client()
    resp = supa.storage.from_(b).create_signed_upload_url(path)
    signed_url = (
        resp.get("signedUrl")
        or resp.get("signed_url")
        or resp.get("signedURL")
        or resp.get("signedURl")
    )
    token = resp.get("token")
    if not signed_url:
        raise RuntimeError(f"Supabase did not return a signed upload URL: keys={list(resp.keys())}")
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    return {
        "path": path,
        "signed_url": signed_url,
        "token": token,
        "public_url": f"{base}/storage/v1/object/public/{b}/{path}",
    }


def signed_download_url(path: str, expires_seconds: int = 3600) -> str:
    b = bucket_name()
    supa = client()
    resp = supa.storage.from_(b).create_signed_url(path, expires_seconds)
    return resp.get("signedUrl") or resp.get("signed_url") or resp.get("signedURL")


def public_url(path: str) -> str:
    b = bucket_name()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    return f"{base}/storage/v1/object/public/{b}/{path}"


def upload_bytes(path: str, data: bytes, content_type: str) -> str:
    """Direct server-side upload — used by the migration script + admin tooling."""
    b = bucket_name()
    supa = client()
    supa.storage.from_(b).upload(
        path=path,
        file=data,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return public_url(path)
