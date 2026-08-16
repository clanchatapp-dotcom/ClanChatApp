"""Firebase Admin SDK bootstrap + helpers for ClanChat.

Design notes
------------
Firebase Admin is initialised lazily from the base64-encoded service account
JSON that already lives in `backend/.env` (originally added for FCM push
notifications). We reuse it so there is a single source of Firebase truth.

The rest of the server continues to use ClanChat's own JWT sessions for
per-request auth — Firebase is a *login provider* + *storage backend*, not
the runtime session mechanism. That keeps the diff small: the ~200 sites in
server.py that use `Depends(get_current_user)` are untouched.

Exposed helpers
---------------
- `verify_id_token(id_token)` — verify a Firebase ID token from the client
  and return the decoded claims (uid, email, email_verified, provider, ...).
- `bucket()` — the default Cloud Storage bucket for signed URLs + reads.
- `admin_signed_upload_url(path, content_type, expires_seconds)` — generate
  a v4 signed URL that a browser can PUT to directly.
- `admin_signed_download_url(path, expires_seconds)` — for private reads.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from datetime import timedelta
from typing import Optional

log = logging.getLogger("clanchat.firebase")


_INITIALIZED = False
_BUCKET_NAME: Optional[str] = None


def _init() -> None:
    global _INITIALIZED, _BUCKET_NAME
    if _INITIALIZED:
        return
    # Import lazily so app import doesn't die if firebase-admin isn't
    # installed during a dev/test run without it.
    import firebase_admin
    from firebase_admin import credentials

    raw_b64 = os.environ.get("FCM_SERVICE_ACCOUNT_JSON_B64", "").strip()
    if not raw_b64:
        raise RuntimeError(
            "FCM_SERVICE_ACCOUNT_JSON_B64 not set — Firebase Admin cannot init"
        )
    try:
        raw = base64.b64decode(raw_b64).decode("utf-8")
        svc = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"FCM_SERVICE_ACCOUNT_JSON_B64 is not valid base64/JSON: {e}") from e

    bucket = os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip()
    if not bucket:
        # Derive from the project id if the operator forgot to set it.
        bucket = f"{svc.get('project_id', '')}.firebasestorage.app"
    _BUCKET_NAME = bucket

    if not firebase_admin._apps:
        cred = credentials.Certificate(svc)
        firebase_admin.initialize_app(cred, {"storageBucket": bucket})
        log.info("Firebase Admin initialised for project=%s bucket=%s",
                 svc.get("project_id"), bucket)
    _INITIALIZED = True


def verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token issued to a browser/APK client. Raises
    firebase_admin.auth exceptions if the token is invalid/expired."""
    _init()
    from firebase_admin import auth
    # check_revoked=True forces a fresh check against the auth backend so
    # sign-out on one device propagates to others within a minute.
    return auth.verify_id_token(id_token, check_revoked=True)


def bucket():
    """Default Cloud Storage bucket for the ClanChat project."""
    _init()
    from firebase_admin import storage
    return storage.bucket()


def admin_signed_upload_url(
    path: str,
    content_type: str,
    expires_seconds: int = 900,
) -> dict:
    """Generate a v4 signed URL a browser can PUT to directly. Returns
    the URL, the storage path, and the public-read URL (constructed once
    the upload completes — the actual object is set to public in the
    default bucket rules)."""
    b = bucket()
    blob = b.blob(path)
    upload_url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_seconds),
        method="PUT",
        content_type=content_type,
    )
    # For public buckets Firebase gives a canonical URL like:
    #   https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media
    # We construct that so the client doesn't need to know bucket routing.
    from urllib.parse import quote
    encoded_path = quote(path, safe="")
    public_url = (
        f"https://firebasestorage.googleapis.com/v0/b/{_BUCKET_NAME}/o/{encoded_path}?alt=media"
    )
    return {
        "upload_url": upload_url,
        "path": path,
        "public_url": public_url,
        "expires_in": expires_seconds,
    }


def admin_signed_download_url(path: str, expires_seconds: int = 3600) -> str:
    """Signed GET URL for private objects (e.g. DM media). For public read
    objects use the public_url returned by `admin_signed_upload_url`."""
    b = bucket()
    blob = b.blob(path)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_seconds),
        method="GET",
    )
