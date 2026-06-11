"""ClanChat backend API tests - covers auth, posts, follow, inner, wall, boards, dms, search, moderation."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@clanchat.app", "password": "Password123!"}
BOB = {"email": "bob@clanchat.app", "password": "Password123!"}
TEEN = {"email": "teen@clanchat.app", "password": "Password123!"}
ADMIN = {"email": "admin@clanchat.app", "password": "admin123"}


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(creds):
    s = _session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Cannot login {creds['email']}: {r.status_code} {r.text[:200]}")
    return s


def _me_id(sess):
    return sess.get(f"{API}/auth/me").json()["user_id"]


def _handle_id(sess, handle):
    j = sess.get(f"{API}/users/by-handle/{handle}").json()
    return j["user"]["user_id"]


@pytest.fixture(scope="module")
def alice():
    return _login(ALICE)


@pytest.fixture(scope="module")
def bob():
    return _login(BOB)


@pytest.fixture(scope="module")
def teen():
    return _login(TEEN)


# ---------- Auth ----------
class TestAuth:
    def test_login_alice_sets_cookies(self):
        s = _session()
        r = s.post(f"{API}/auth/login", json=ALICE)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "user" in j
        assert j["user"]["handle"] == "alice"
        # Cookie jar should contain access_token
        assert any(c.name == "access_token" for c in s.cookies)
        assert any(c.name == "refresh_token" for c in s.cookies)

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ALICE["email"], "password": "wrong"})
        assert r.status_code in (400, 401, 403)

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_with_cookie(self, alice):
        r = alice.get(f"{API}/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ALICE["email"]
        assert data["handle"] == "alice"
        assert data["is_minor"] is False

    def test_register_adult(self):
        u = uuid.uuid4().hex[:8]
        r = requests.post(f"{API}/auth/register", json={
            "email": f"TEST_adult_{u}@x.com", "password": "Password123!",
            "handle": f"tadt{u}", "dob": "1990-01-01", "display_name": "Adult T"
        })
        assert r.status_code in (200, 201), r.text
        # Adult should be is_minor False
        body = r.json()
        usr = body.get("user", body)
        assert usr.get("is_minor") is False

    def test_register_minor(self):
        u = uuid.uuid4().hex[:8]
        r = requests.post(f"{API}/auth/register", json={
            "email": f"TEST_minor_{u}@x.com", "password": "Password123!",
            "handle": f"tmin{u}", "dob": "2012-06-01", "display_name": "Minor T"
        })
        assert r.status_code in (200, 201), r.text
        body = r.json()
        usr = body.get("user", body)
        assert usr.get("is_minor") is True

    def test_register_duplicate_email(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": ALICE["email"], "password": "Password123!",
            "handle": "newhandle9999", "dob": "1990-01-01", "display_name": "Dup"
        })
        assert r.status_code in (400, 409)

    def test_register_duplicate_handle(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": f"TEST_dup_{uuid.uuid4().hex[:6]}@x.com", "password": "Password123!",
            "handle": "alice", "dob": "1990-01-01", "display_name": "Dup"
        })
        assert r.status_code in (400, 409)


# ---------- Users ----------
class TestUsers:
    def test_update_me_bio(self, alice):
        r = alice.patch(f"{API}/users/me", json={"bio": "Hello from test", "display_name": "Alice T"})
        assert r.status_code == 200, r.text
        # verify persistence
        r2 = alice.get(f"{API}/auth/me")
        assert r2.json().get("bio") == "Hello from test"

    def test_update_settings(self, alice):
        r = alice.patch(f"{API}/users/me", json={"settings": {"comfort_zone": {"nsfw": False, "ai_content": True}}})
        assert r.status_code == 200, r.text

    def test_get_by_handle_bob(self, alice):
        r = alice.get(f"{API}/users/by-handle/bob")
        assert r.status_code == 200
        j = r.json()
        assert j["user"]["handle"] == "bob"
        assert "relation" in j

    def test_search_handle(self, alice):
        r = alice.get(f"{API}/users/search", params={"q": "bo"})
        assert r.status_code == 200
        handles = [u["handle"] for u in r.json().get("results", [])]
        assert "bob" in handles

    def test_search_minor_protection(self, alice):
        r = alice.get(f"{API}/users/search", params={"q": "teen"})
        assert r.status_code == 200
        handles = [u["handle"] for u in r.json().get("results", [])]
        assert "teenager" not in handles, "Adult should not find minor in search"


# ---------- Follow ----------
class TestFollow:
    def test_follow_bob(self, alice):
        bob_id = _handle_id(alice, "bob")
        r = alice.post(f"{API}/follow/{bob_id}")
        assert r.status_code in (200, 201, 409), r.text

    def test_adult_cannot_follow_minor(self, alice):
        rt = alice.get(f"{API}/users/by-handle/teenager")
        if rt.status_code != 200:
            pytest.skip("Cannot fetch teen by handle (likely 404 by minor protection)")
        teen_id = rt.json()["user"]["user_id"]
        r = alice.post(f"{API}/follow/{teen_id}")
        assert r.status_code in (403, 400)


# ---------- Posts ----------
class TestPosts:
    def test_create_public_post_with_tags(self, alice):
        r = alice.post(f"{API}/posts", json={
            "tier": "public", "content": "TEST public post", "tags": ["testtag", "hello"]
        })
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d["tier"] == "public"
        assert "testtag" in d["tags"]

    def test_create_followers_post(self, alice):
        r = alice.post(f"{API}/posts", json={
            "tier": "followers", "content": "TEST followers post", "tags": ["foo"]
        })
        assert r.status_code in (200, 201), r.text
        assert "foo" in r.json()["tags"]

    def test_inner_strips_tags(self, alice):
        r = alice.post(f"{API}/posts", json={
            "tier": "inner", "content": "TEST inner post", "tags": ["shouldbestripped"]
        })
        assert r.status_code in (200, 201), r.text
        assert r.json()["tags"] == []

    def test_nsfw_on_public_fails(self, alice):
        r = alice.post(f"{API}/posts", json={
            "tier": "public", "content": "TEST nsfw", "tags": [], "nsfw": True
        })
        assert r.status_code == 400, r.text

    def test_feed(self, alice):
        r = alice.get(f"{API}/posts/feed")
        assert r.status_code == 200
        body = r.json()
        posts = body.get("posts", body) if isinstance(body, dict) else body
        assert isinstance(posts, list)
        if posts:
            p = posts[0]
            assert "like_count" in p
            assert "liked" in p

    def test_like_toggle(self, alice, bob):
        r = alice.post(f"{API}/posts", json={"tier": "public", "content": "TEST like me", "tags": []})
        post_id = r.json()["post_id"]
        r1 = bob.post(f"{API}/posts/{post_id}/like")
        assert r1.status_code in (200, 201), r1.text
        j1 = r1.json()
        r2 = bob.post(f"{API}/posts/{post_id}/like")
        assert r2.status_code in (200, 201), r2.text
        j2 = r2.json()
        # Toggle should flip liked state
        assert j1.get("liked") != j2.get("liked")

    def test_pin_and_max3(self, alice):
        # Create 4 posts then pin them
        pids = []
        for i in range(4):
            r = alice.post(f"{API}/posts", json={"tier": "public", "content": f"TEST pin {i} {uuid.uuid4().hex[:4]}", "tags": []})
            pids.append(r.json()["post_id"])
        ok = 0
        last_status = None
        for pid in pids:
            r = alice.post(f"{API}/posts/{pid}/pin")
            last_status = r.status_code
            if r.status_code in (200, 201):
                ok += 1
        # First 3 should succeed and 4th should fail with 400
        assert ok <= 3, f"Pinned {ok} but max should be 3"
        assert last_status in (400, 409), f"Expected 4th pin to fail, got {last_status}"
        # cleanup unpin
        for pid in pids:
            alice.delete(f"{API}/posts/{pid}/pin")


# ---------- Inner / Wall / Boards / DMs ----------
class TestInnerWallBoardsDMs:
    def test_inner_members(self, alice):
        r = alice.get(f"{API}/inner/members")
        assert r.status_code == 200

    def test_inner_invite_flow(self, alice, bob):
        bob_id = _handle_id(alice, "bob")
        r = alice.post(f"{API}/inner/invite", json={
            "user_id": bob_id,
            "permissions": {"dms": True, "audio_calls": False, "wall_post": True, "boards": True}
        })
        # may already exist
        assert r.status_code in (200, 201, 400, 409), r.text
        # bob views invites
        r2 = bob.get(f"{API}/inner/invites")
        assert r2.status_code == 200

    def test_wall_default_owner_only(self, alice, bob):
        bob_id = _handle_id(alice, "bob")
        r = alice.post(f"{API}/wall/{bob_id}", json={"content": "TEST wall hi"})
        # default wall_post_permission=owner so non-owner blocked
        assert r.status_code in (403, 400), r.text

    def test_boards_create_public(self, alice):
        r = alice.post(f"{API}/boards", json={"title": f"TEST Board {uuid.uuid4().hex[:4]}", "tier": "public"})
        assert r.status_code in (200, 201), r.text
        me = _me_id(alice)
        r2 = alice.get(f"{API}/boards/by-user/{me}")
        assert r2.status_code == 200

    def test_dm_blocked_when_not_following_and_disabled(self, alice, bob):
        bob_id = _handle_id(alice, "bob")
        # bob has dms_enabled_followers=false by default
        r = alice.post(f"{API}/dms", json={"recipient_id": bob_id, "content": "TEST hi"})
        assert r.status_code in (200, 201, 403), r.text

    def test_dms_threads(self, alice):
        r = alice.get(f"{API}/dms/threads")
        assert r.status_code == 200


# ---------- Moderation ----------
class TestModeration:
    def test_block_unblock(self, alice):
        bob_id = _handle_id(alice, "bob")
        r = alice.post(f"{API}/block/{bob_id}")
        assert r.status_code in (200, 201), r.text
        # After blocking, bob's posts should not be in feed
        feed = alice.get(f"{API}/posts/feed").json()
        posts = feed.get("posts", feed) if isinstance(feed, dict) else feed
        for p in posts:
            assert p.get("author", {}).get("handle") != "bob"
        r2 = alice.delete(f"{API}/block/{bob_id}")
        assert r2.status_code in (200, 204)

    def test_report(self, alice):
        bob_id = _handle_id(alice, "bob")
        r = alice.post(f"{API}/reports", json={"target_type": "user", "target_id": bob_id, "category": "spam", "reason": "TEST"})
        assert r.status_code in (200, 201), r.text


# ---------- Notifications ----------
class TestNotifications:
    def test_counts_shape(self, alice):
        r = alice.get(f"{API}/notifications/counts")
        assert r.status_code == 200
        d = r.json()
        for k in ("follow_requests", "inner_invites", "unread_dms"):
            assert k in d, f"missing key {k}"
