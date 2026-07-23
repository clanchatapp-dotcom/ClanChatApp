"""Iteration 21 — Regression check after frontend Supabase JS downgrade.

Backend code is unchanged. This suite confirms the two auth paths co-exist:

1. Legacy /api/auth/login still returns 200 + access_token for a valid
   email/password (audiotester@clanchat.app).
2. Legacy /api/auth/register still returns 200 for a fresh email/handle.
3. /api/auth/supabase-login exists (returns 401 on a bogus token — the
   endpoint is wired, not 404).
4. /api/supabase/config returns non-empty url + anonKey + bucket=ClanChatApp
   (frontend uses this to init the Supabase JS client).

The iter17 + iter20 pytest suites cover the broader regression surface
and are executed alongside this file.
"""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADULT_EMAIL = "audiotester@clanchat.app"
ADULT_PW = "AudioTest123!"
ADULT_UID = "user_81ace9a329a7"


# --------------------------------------------------------------------
# 1. Legacy /api/auth/login STILL works
# --------------------------------------------------------------------
class TestLegacyLogin:
    def test_login_valid_credentials_returns_token(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADULT_EMAIL, "password": ADULT_PW})
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        d = r.json()
        assert d.get("access_token"), f"missing access_token: {d}"
        assert isinstance(d["access_token"], str) and len(d["access_token"]) > 20
        user = d.get("user") or {}
        assert user.get("user_id") == ADULT_UID, f"user_id mismatch: {user}"
        assert user.get("email") == ADULT_EMAIL

    def test_login_invalid_credentials_returns_4xx(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADULT_EMAIL, "password": "wrongpw"})
        assert r.status_code in (400, 401, 403), r.text

    def test_login_endpoint_is_not_404(self):
        """Guard against a redeploy that drops the legacy route — the exact
        symptom the user reported ('Request failed with status code 404')."""
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADULT_EMAIL, "password": ADULT_PW})
        assert r.status_code != 404, "legacy /api/auth/login is missing!"


# --------------------------------------------------------------------
# 2. Legacy /api/auth/register STILL works
# --------------------------------------------------------------------
class TestLegacyRegister:
    def test_register_new_user_returns_token(self):
        email = f"iter21_{uuid.uuid4().hex[:8]}@clanchat.app"
        handle = f"iter21{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!", "handle": handle,
            "display_name": "Iter21 regression", "dob": "1995-01-01",
        })
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        d = r.json()
        assert d.get("access_token"), f"missing access_token: {d}"
        user = d.get("user") or {}
        assert user.get("email") == email
        assert user.get("handle") == handle
        assert user.get("user_id"), f"missing user_id: {user}"

        # And the new token actually works against a protected endpoint.
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {d['access_token']}"})
        me = s.get(f"{API}/activity/unread-count")
        assert me.status_code == 200, me.text

    def test_register_endpoint_is_not_404(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": f"probe_{uuid.uuid4().hex[:6]}@clanchat.app",
            "password": "TestPass123!",
            "handle": f"probe{uuid.uuid4().hex[:5]}",
            "display_name": "probe",
            "dob": "1995-01-01",
        })
        assert r.status_code != 404, "legacy /api/auth/register is missing!"


# --------------------------------------------------------------------
# 3. Supabase-login endpoint is wired (401 on bogus token, not 404)
# --------------------------------------------------------------------
class TestSupabaseLoginCoexists:
    def test_supabase_login_bogus_token_is_not_404(self):
        r = requests.post(f"{API}/auth/supabase-login",
                          json={"access_token": "bogus.supabase.token"})
        # The route MUST exist — either 401 (invalid token) or 400/422
        # (validation). A 404 here means the new route regressed.
        assert r.status_code != 404, (
            f"/api/auth/supabase-login is missing on preview backend! "
            f"status={r.status_code} body={r.text[:200]}"
        )
        assert r.status_code in (400, 401, 403, 422), (
            f"expected 4xx for bogus token, got {r.status_code}: {r.text[:200]}"
        )

    def test_supabase_login_missing_body_is_4xx(self):
        r = requests.post(f"{API}/auth/supabase-login", json={})
        assert r.status_code in (400, 401, 422), r.text
        assert r.status_code != 404


# --------------------------------------------------------------------
# 4. /api/supabase/config for JS-client init
# --------------------------------------------------------------------
class TestSupabaseConfig:
    def test_config_returns_url_anonkey_and_bucket(self):
        r = requests.get(f"{API}/supabase/config")
        assert r.status_code == 200, f"config failed: {r.status_code} {r.text}"
        d = r.json()
        # url + anonKey non-empty
        assert d.get("url"), f"missing url: {d}"
        assert isinstance(d["url"], str) and d["url"].startswith("http"), d
        # anonKey key naming: preview backend has historically used both
        # 'anonKey' and 'anon_key' — accept either.
        anon = d.get("anonKey") or d.get("anon_key")
        assert anon, f"missing anonKey/anon_key: {d}"
        assert isinstance(anon, str) and len(anon) > 20
        # bucket must be ClanChatApp (capital C)
        assert d.get("bucket") == "ClanChatApp", f"bucket mismatch: {d}"
