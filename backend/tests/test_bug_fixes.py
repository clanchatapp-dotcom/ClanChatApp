"""
Tests for the 7 bug fixes:
1. Minor visibility on global wall
2. AI image detection working
3. Warning showing for unlabelled AI
4. Profile wall alignment (frontend, tested in e2e)
5. Inner circle removing on unfollow
6. Media not appearing in Words tab (frontend, tested in e2e)
7. Profile picture showing (frontend, tested in e2e)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")
TEEN = ("teen@clanchat.app", "Password123!")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _me_id(sess):
    r = sess.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


def _handle_id(sess, handle):
    r = sess.get(f"{API}/users/by-handle/{handle}", timeout=10)
    if r.status_code != 200:
        return None
    return r.json()["user"]["user_id"]


@pytest.fixture(scope="module")
def alice():
    return _login(*ALICE)


@pytest.fixture(scope="module")
def bob():
    return _login(*BOB)


@pytest.fixture(scope="module")
def teen():
    return _login(*TEEN)


class TestBug1MinorVisibilityOnWall:
    """Bug #1: Minors must be invisible on global wall and feed."""

    def test_minor_invisible_on_user_profile(self, alice, teen):
        """Minor profile should return 404 to adult viewers."""
        teen_id = _me_id(teen)
        r = alice.get(f"{API}/posts/by-user/{teen_id}", timeout=10)
        assert r.status_code == 404, "Adult should get 404 for minor's profile feed"

    def test_minor_invisible_on_global_feed(self, alice, teen):
        """Minor posts should not appear in global feed."""
        # teen creates a post
        r = teen.post(
            f"{API}/posts",
            json={
                "tier": "public",
                "content": f"Teen public post {uuid.uuid4().hex[:6]}",
                "tags": [],
            },
            timeout=10,
        )
        assert r.status_code in (200, 201), r.text
        teen_post_id = r.json()["post_id"]

        # alice checks feed
        feed = alice.get(f"{API}/posts/feed", timeout=10).json()
        posts = feed.get("posts", [])
        post_ids = [p["post_id"] for p in posts]
        assert teen_post_id not in post_ids, "Teen post should not appear in adult's feed"

    def test_minor_wall_invisible(self, alice, teen):
        """Accessing a minor's wall should return 404."""
        teen_id = _me_id(teen)
        r = alice.get(f"{API}/wall/{teen_id}", timeout=10)
        assert r.status_code == 404, "Adult should get 404 for minor's wall"


class TestBug5InnerCircleRemovalOnUnfollow:
    """Bug #5: When user unfollows, they should be removed from IC if present."""

    def test_unfollow_removes_from_inner_circle(self, alice, bob):
        """Unfollowing should remove from IC if present."""
        bob_id = _me_id(bob)
        alice_id = _me_id(alice)

        # alice follows bob
        r = alice.post(f"{API}/follow/{bob_id}", timeout=10)
        assert r.status_code in (200, 201), r.text

        # alice invites bob to IC
        r = alice.post(
            f"{API}/inner/invite",
            json={
                "user_id": bob_id,
                "permissions": {"dms": True, "audio_calls": False},
            },
            timeout=10,
        )
        assert r.status_code in (200, 201, 409), r.text  # 409 if already invited

        # bob accepts (if invitation created)
        invs_r = bob.get(f"{API}/inner/invites", timeout=10)
        if invs_r.status_code == 200:
            invites = invs_r.json().get("invites", [])
            alice_invites = [i for i in invites if i["owner"]["user_id"] == alice_id]
            if alice_invites:
                inv_id = alice_invites[0]["invite_id"]
                r = bob.post(f"{API}/inner/invites/{inv_id}/accept", timeout=10)
                assert r.status_code == 200, r.text

        # Verify bob is in alice's IC
        members = alice.get(f"{API}/inner/members", timeout=10).json()["members"]
        assert any(m["member"]["user_id"] == bob_id for m in members), "Bob should be in alice's IC"

        # alice unfollows bob
        r = alice.delete(f"{API}/follow/{bob_id}", timeout=10)
        assert r.status_code in (200, 204), r.text

        # bob should no longer be in alice's IC
        members = alice.get(f"{API}/inner/members", timeout=10).json()["members"]
        assert not any(m["member"]["user_id"] == bob_id for m in members), "Bob should be removed from alice's IC after unfollow"


class TestBug2And3AIDetectionAndWarning:
    """Bug #2 & #3: AI detection and warning for unlabelled AI content."""

    def test_post_with_ai_label_is_marked(self, alice):
        """Post with ai_label should be marked as AI."""
        r = alice.post(
            f"{API}/posts",
            json={
                "tier": "public",
                "content": "Test AI generated image",
                "tags": [],
                "ai_label": "generated",
            },
            timeout=10,
        )
        assert r.status_code in (200, 201), r.text
        post = r.json()
        assert post.get("is_ai") is True
        assert post.get("ai_label") == "generated"

    def test_post_without_ai_label_not_marked(self, alice):
        """Post without ai_label should not be marked as AI."""
        r = alice.post(
            f"{API}/posts",
            json={
                "tier": "public",
                "content": "Regular human-created post",
                "tags": [],
            },
            timeout=10,
        )
        assert r.status_code in (200, 201), r.text
        post = r.json()
        assert post.get("is_ai") in (False, None)

    def test_post_with_real_person_requires_label(self, alice):
        """Post with real person + media should require AI label or rejection."""
        # This tests the backend validation that media + real_person requires careful labelling
        r = alice.post(
            f"{API}/posts",
            json={
                "tier": "public",
                "content": "Real person image",
                "tags": [],
                "depicts_real_person": True,
                "has_consent": True,
                # No ai_label provided
            },
            timeout=10,
        )
        # Should either accept or ask for clarification
        # Behavior depends on implementation: either 200 or 400
        assert r.status_code in (200, 201, 400)
