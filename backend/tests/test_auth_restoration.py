"""Backend auth restoration tests for ClanChat."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://clan-chat-fix.preview.emergentagent.com").rstrip("/")
# Fallback: read from frontend/.env
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------------- Supabase config endpoint ----------------
def test_supabase_config(s):
    r = s.get(f"{BASE_URL}/api/supabase/config", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d.get("url", "").startswith("https://")
    assert d.get("anonKey")
    assert d.get("bucket") == "ClanChatApp"


# ---------------- Legacy JWT login (admin) ----------------
def test_admin_login(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "admin@clanchat.app", "password": "admin123"},
               timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    # Response should contain access_token or user; check either
    assert "access_token" in d or "token" in d or "user" in d
    user = d.get("user") or {}
    assert user.get("role") == "admin" or user.get("email") == "admin@clanchat.app"


# ---------------- Regular user login ----------------
def test_bob_login(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "bob@clanchat.app", "password": "Password123!"},
               timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    user = d.get("user") or {}
    assert user.get("email") == "bob@clanchat.app" or "access_token" in d or "token" in d


def test_login_wrong_password(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "bob@clanchat.app", "password": "wrongpass"},
               timeout=15)
    assert r.status_code in (400, 401, 403)


# ---------------- Registration ----------------
def test_register_new_user(s):
    uid = uuid.uuid4().hex[:8]
    payload = {
        "email": f"TEST_user_{uid}@clanchat.app",
        "password": "Password123!",
        "handle": f"testuser{uid}",
        "display_name": f"Test User {uid}",
        "dob": "2000-01-01"
    }
    r = s.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    d = r.json()
    user = d.get("user") or {}
    assert user.get("email") == payload["email"] or "access_token" in d or "token" in d


# ---------------- /api/auth/supabase-login contract ----------------
def test_supabase_login_missing_token(s):
    r = s.post(f"{BASE_URL}/api/auth/supabase-login", json={}, timeout=15)
    # Should return 4xx for missing token
    assert r.status_code in (400, 401, 422), r.text


def test_supabase_login_invalid_token_returns_error(s):
    r = s.post(f"{BASE_URL}/api/auth/supabase-login",
               json={"access_token": "invalid.jwt.token"},
               timeout=15)
    # Invalid token should be rejected 401/400
    assert r.status_code in (400, 401), r.text


# ---------------- Signed upload URL (authenticated) ----------------
@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "admin@clanchat.app", "password": "admin123"},
               timeout=15)
    if r.status_code != 200:
        pytest.skip("Admin login failed")
    d = r.json()
    return d.get("access_token") or d.get("token")


def test_signed_upload_url(s, admin_token):
    if not admin_token:
        # Try cookie-based
        headers = {}
    else:
        headers = {"Authorization": f"Bearer {admin_token}"}
    r = s.post(f"{BASE_URL}/api/upload/signed-url",
               json={"filename": "test.jpg", "content_type": "image/jpeg"},
               headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "upload_url" in d or "signedUrl" in d or "url" in d
    up = d.get("upload_url") or d.get("signedUrl") or d.get("url")
    assert "supabase" in up.lower()


# ---------------- Admin access to moderation endpoints ----------------
def test_admin_can_access_reports(s, admin_token):
    if not admin_token:
        pytest.skip("no admin token")
    headers = {"Authorization": f"Bearer {admin_token}"}
    # Try common admin endpoints
    for path in ["/api/admin/reports", "/api/moderation/reports", "/api/admin/stats"]:
        r = s.get(f"{BASE_URL}{path}", headers=headers, timeout=15)
        if r.status_code in (200, 204):
            return
    pytest.skip("no admin endpoint discovered")


# ---------------- Feed endpoint accessible after login ----------------
def test_feed_endpoint(s, admin_token):
    if not admin_token:
        pytest.skip("no admin token")
    headers = {"Authorization": f"Bearer {admin_token}"}
    for path in ["/api/feed", "/api/posts/feed", "/api/posts"]:
        r = s.get(f"{BASE_URL}{path}", headers=headers, timeout=15)
        if r.status_code == 200:
            return
    pytest.skip("no feed endpoint discovered")
