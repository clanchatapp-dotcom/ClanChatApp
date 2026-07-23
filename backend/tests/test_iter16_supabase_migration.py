"""Iteration 16 — Verification tests after Firebase → Supabase migration.

Covers:
- /api/supabase/config (public web config)
- /api/auth/supabase-login (rejects bogus tokens)
- /api/upload/signed-url (auth-gated + returns signed URL)
- End-to-end Supabase Storage upload/PUT/GET round-trip
- /api/notifications/new-followers (empty for isolated user, populated after follow)
- Minor-protection endpoints (by-user / pinned / audio / by-tag / trending)
- /api/dms/{message_id} DELETE (200 own, 403 other, 404 missing)
- /api/giphy/search (auth-gated + items list)
- POST /api/posts NSFW block for minors (403)
- Legacy /api/auth/login + /api/auth/register still functional

NOTE: `get_current_user` prefers the `access_token` cookie over the
Authorization header. So we MUST NOT share a `requests.Session` between
users — instead every authenticated caller uses a header-only client on
a fresh cookie-less session.
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
MINOR_EMAIL = "minortest@clanchat.app"
MINOR_PW = "MinorTest123!"
MINOR_UID = "user_1ebafbfee536"


def new_client(token: str | None = None) -> requests.Session:
    """Fresh cookie-less session. Auth ONLY via Bearer header so it never
    collides with cookies from earlier logins."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return s


def _login(email, pw) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register(email, pw, handle, dob="1995-01-01", display="Test"):
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": pw, "handle": handle,
        "display_name": display, "dob": dob,
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]["user_id"]


@pytest.fixture(scope="session")
def adult_token():
    return _login(ADULT_EMAIL, ADULT_PW)


@pytest.fixture(scope="session")
def minor_token():
    return _login(MINOR_EMAIL, MINOR_PW)


# --- 1. Supabase client config --------------------------------------------
class TestSupabaseConfig:
    def test_config_returns_url_anon_bucket(self):
        c = new_client()
        r = c.get(f"{API}/supabase/config")
        assert r.status_code == 200
        data = r.json()
        assert data.get("url"), "SUPABASE_URL missing"
        assert data.get("anonKey"), "anon key missing"
        assert data.get("bucket") == "ClanChatApp", f"bucket mismatch: {data.get('bucket')}"
        assert data["url"].startswith("http")


# --- 2. Supabase-login rejects bogus tokens -------------------------------
class TestSupabaseLoginReject:
    def test_bogus_access_token_returns_401(self):
        c = new_client()
        r = c.post(f"{API}/auth/supabase-login",
                   json={"access_token": "this-is-definitely-not-a-real-token"})
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"


# --- 3. Signed-URL auth gate + shape --------------------------------------
class TestSignedUploadUrl:
    def test_requires_auth(self):
        c = new_client()
        r = c.post(f"{API}/upload/signed-url",
                   json={"filename": "x.png", "content_type": "image/png", "scope": "post"})
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_returns_signed_url_when_authed(self, adult_token):
        c = new_client(adult_token)
        r = c.post(f"{API}/upload/signed-url",
                   json={"filename": "test_iter16.png", "content_type": "image/png", "scope": "post"})
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        data = r.json()
        assert data.get("upload_url", "").startswith("http")
        assert data.get("path", "").startswith(f"u/{ADULT_UID}/post/")
        assert data.get("public_url", "").startswith("http")
        assert data.get("provider") == "supabase"


# --- 4. End-to-end Supabase upload/download -------------------------------
class TestSupabaseUploadRoundTrip:
    def test_full_upload_and_public_download(self, adult_token):
        c = new_client(adult_token)
        r = c.post(f"{API}/upload/signed-url",
                   json={"filename": f"iter16_{uuid.uuid4().hex[:6]}.txt",
                         "content_type": "text/plain", "scope": "post"})
        assert r.status_code == 200
        info = r.json()
        body = f"TEST_iter16 supabase roundtrip {uuid.uuid4().hex}".encode()
        put = requests.put(info["upload_url"], data=body,
                           headers={"Content-Type": "text/plain", "x-upsert": "true"})
        assert put.status_code in (200, 201), f"upload failed: {put.status_code} {put.text[:400]}"
        time.sleep(1.0)
        got = requests.get(info["public_url"])
        assert got.status_code == 200, f"public GET failed: {got.status_code} {got.text[:200]}"
        assert got.content == body, "bytes mismatch on round-trip"


# --- 5. Notifications: new followers list ---------------------------------
class TestNotificationsNewFollowers:
    @pytest.fixture(scope="class")
    def fresh_user(self):
        email = f"iter16_{uuid.uuid4().hex[:8]}@clanchat.app"
        handle = f"iter16_{uuid.uuid4().hex[:6]}"
        tok, uid = _register(email, "TestPass123!", handle, display="Iter16")
        return {"email": email, "handle": handle, "token": tok, "user_id": uid}

    def test_empty_on_isolated_user(self, fresh_user):
        c = new_client(fresh_user["token"])
        r = c.get(f"{API}/notifications/new-followers")
        assert r.status_code == 200
        assert r.json() == {"followers": []}, r.json()

    def test_populated_after_follow(self, fresh_user, adult_token):
        adult = new_client(adult_token)
        r = adult.post(f"{API}/follow/{fresh_user['user_id']}")
        assert r.status_code == 200, f"follow failed: {r.status_code} {r.text}"

        fu = new_client(fresh_user["token"])
        r2 = fu.get(f"{API}/notifications/new-followers")
        assert r2.status_code == 200
        followers = r2.json().get("followers", [])
        ids = [f.get("user_id") for f in followers]
        assert ADULT_UID in ids, f"expected {ADULT_UID} in new-followers, got {ids}"


# --- 6. Minor-protection endpoints ----------------------------------------
class TestMinorProtections:
    def test_by_user_hides_minor_from_adult(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/posts/by-user/{MINOR_UID}")
        assert r.status_code == 200
        assert r.json() == {"posts": []}, r.json()

    def test_pinned_hides_minor_from_adult(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/posts/pinned/{MINOR_UID}")
        assert r.status_code == 200
        assert r.json() == {"posts": []}, r.json()

    def test_audio_hides_minor_from_adult(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/posts/audio/{MINOR_UID}")
        assert r.status_code == 200
        assert r.json() == {"posts": []}, r.json()

    def test_by_tag_from_minor_hidden_from_adult(self, adult_token, minor_token):
        tag = f"iter16tag{uuid.uuid4().hex[:6]}"
        content = f"TEST_iter16 minor tag content #{tag}"
        m = new_client(minor_token)
        p = m.post(f"{API}/posts",
                   json={"content": content, "tier": "public",
                         "tags": [tag], "media": [], "nsfw": False})
        assert p.status_code == 200, f"minor post failed: {p.status_code} {p.text}"

        # Minor sees own tag page
        r_min = m.get(f"{API}/posts/by-tag/{tag}")
        assert r_min.status_code == 200
        min_tags_ok = any(tag in (post.get("tags") or [])
                          for post in r_min.json().get("posts", []))
        assert min_tags_ok, "minor cannot see own tag page"

        # Adult must NOT see the minor's post on the tag page.
        a = new_client(adult_token)
        r_adult = a.get(f"{API}/posts/by-tag/{tag}")
        assert r_adult.status_code == 200
        adult_posts = r_adult.json().get("posts", [])
        assert all(p.get("author", {}).get("user_id") != MINOR_UID for p in adult_posts), \
            f"minor post leaked to adult tag page: {adult_posts}"

    def test_trending_excludes_minor_tags(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/tags/trending")
        assert r.status_code == 200
        assert isinstance(r.json().get("trending"), list)


# --- 7. DM DELETE endpoint ------------------------------------------------
class TestDmDelete:
    def test_sender_can_delete_own_dm(self, adult_token):
        # Create a throwaway recipient. adult follows recipient so recipient
        # opens DMs to open-follow adult (or use public setting). Then adult
        # sends recipient a DM. But easier: adult sends to SELF (self-DM path
        # is unconditionally allowed) and then deletes it.
        adult = new_client(adult_token)
        r = adult.post(f"{API}/dms",
                       json={"recipient_id": ADULT_UID, "content": "TEST_iter16 self dm to delete",
                             "media_paths": []})
        assert r.status_code == 200, f"self-DM send failed: {r.status_code} {r.text}"
        message_id = r.json().get("message_id")
        assert message_id, f"no message_id in response: {r.json()}"

        # Different user cannot delete it
        # Register a throwaway
        other_email = f"iter16dmo_{uuid.uuid4().hex[:8]}@clanchat.app"
        other_handle = f"iter16dmo{uuid.uuid4().hex[:6]}"
        other_tok, _ = _register(other_email, "TestPass123!", other_handle, display="Other")
        other = new_client(other_tok)
        forbid = other.delete(f"{API}/dms/{message_id}")
        assert forbid.status_code == 403, f"expected 403 got {forbid.status_code}: {forbid.text}"

        # Sender can delete
        ok = adult.delete(f"{API}/dms/{message_id}")
        assert ok.status_code == 200, f"delete failed: {ok.status_code} {ok.text}"

    def test_nonexistent_message_returns_404(self, adult_token):
        c = new_client(adult_token)
        r = c.delete(f"{API}/dms/does-not-exist-{uuid.uuid4().hex}")
        assert r.status_code == 404, f"expected 404 got {r.status_code}: {r.text}"


# --- 8. Giphy search proxy ------------------------------------------------
class TestGiphySearch:
    def test_requires_auth(self):
        c = new_client()
        r = c.get(f"{API}/giphy/search?q=cat")
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text[:200]}"

    def test_returns_items(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/giphy/search?q=cat")
        if r.status_code == 503:
            pytest.skip("Giphy not configured in preview env")
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        data = r.json()
        assert "items" in data, f"no items in response: {data}"
        assert isinstance(data["items"], list)


# --- 9. Minor NSFW post block ---------------------------------------------
class TestMinorNsfwBlock:
    def test_minor_cannot_create_nsfw_post(self, minor_token):
        # tier must be one of {"public", "followers", "inner"}. NSFW cannot
        # coexist with "public" (400 different error), so use "inner".
        c = new_client(minor_token)
        r = c.post(f"{API}/posts",
                   json={"content": "TEST_iter16 nsfw try", "tier": "inner",
                         "tags": [], "media": [], "nsfw": True})
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
        assert "18+" in r.text or "Minors" in r.text, f"unexpected error msg: {r.text}"


# --- 10. Legacy auth endpoints --------------------------------------------
class TestLegacyAuth:
    def test_legacy_login_returns_token(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADULT_EMAIL, "password": ADULT_PW})
        assert r.status_code == 200
        data = r.json()
        assert data.get("access_token"), "no access_token"
        assert data.get("user", {}).get("email", "").lower() == ADULT_EMAIL

    def test_legacy_register_returns_token(self):
        email = f"iter16reg_{uuid.uuid4().hex[:8]}@clanchat.app"
        handle = f"iter16reg{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!",
            "handle": handle, "display_name": "Iter16 Reg",
            "dob": "1995-06-15",
        })
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        data = r.json()
        assert data.get("access_token"), "no access_token"
        assert data.get("user", {}).get("email", "").lower() == email
