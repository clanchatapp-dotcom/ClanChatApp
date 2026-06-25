"""Iter7 tests — expanded notification counts, followers/following privacy,
admin promote & purge-demo-accounts. Run order matters: purge LAST.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@clanchat.app", "password": "Password123!"}
BOB = {"email": "bob@clanchat.app", "password": "Password123!"}
TEEN = {"email": "teen@clanchat.app", "password": "Password123!"}
ADMIN = {"email": "admin@clanchat.app", "password": "admin123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def alice_sess():
    return _login(ALICE)


@pytest.fixture(scope="module")
def bob_sess():
    return _login(BOB)


@pytest.fixture(scope="module")
def admin_sess():
    return _login(ADMIN)


# ---------------------------------------------------------------------------
# Notifications counts shape
# ---------------------------------------------------------------------------
class TestNotificationsCounts:
    EXPECTED_KEYS = {
        "follow_requests", "inner_invites", "unread_dms",
        "new_followers", "tag_pending", "group_invites", "warnings", "total",
    }

    def test_counts_shape(self, alice_sess):
        r = alice_sess.get(f"{API}/notifications/counts")
        assert r.status_code == 200, r.text
        data = r.json()
        assert self.EXPECTED_KEYS.issubset(data.keys()), f"Missing keys: {self.EXPECTED_KEYS - set(data.keys())}"
        for k in self.EXPECTED_KEYS:
            assert isinstance(data[k], int), f"{k} is not int: {data[k]!r}"

    def test_counts_unauth_401(self):
        r = requests.get(f"{API}/notifications/counts", timeout=10)
        assert r.status_code in (401, 403)

    def test_follow_increments_new_followers(self, alice_sess, bob_sess):
        # Get alice's user_id
        r = alice_sess.get(f"{API}/auth/me")
        assert r.status_code == 200
        alice_id = r.json()["user_id"]

        # Mark seen baseline for alice
        alice_sess.post(f"{API}/notifications/mark-seen")
        time.sleep(0.5)
        before = alice_sess.get(f"{API}/notifications/counts").json()

        # Ensure bob is not already following alice (best-effort unfollow)
        bob_sess.delete(f"{API}/follow/{alice_id}")
        time.sleep(0.3)

        # Bob follows alice (open mode)
        rf = bob_sess.post(f"{API}/follow/{alice_id}")
        assert rf.status_code == 200, rf.text

        time.sleep(0.5)
        after = alice_sess.get(f"{API}/notifications/counts").json()
        assert after["new_followers"] >= 1, f"new_followers did not increment: before={before}, after={after}"
        assert after["total"] >= before["total"]

    def test_dm_increments_unread_dms(self, alice_sess, bob_sess):
        r = alice_sess.get(f"{API}/auth/me")
        alice_id = r.json()["user_id"]

        # Enable follower-DMs on alice so bob (who follows alice) can DM
        alice_sess.patch(f"{API}/users/me", json={"settings": {"dms_enabled_followers": True}})

        before = alice_sess.get(f"{API}/notifications/counts").json()
        # Bob DMs alice
        rd = bob_sess.post(f"{API}/dms", json={"recipient_id": alice_id, "content": "TEST iter7 dm"})
        assert rd.status_code == 200, rd.text
        time.sleep(0.5)
        after = alice_sess.get(f"{API}/notifications/counts").json()
        assert after["unread_dms"] >= before["unread_dms"] + 1, f"unread_dms did not increment: {before} -> {after}"

    def test_mark_seen_resets_new_followers(self, alice_sess):
        r = alice_sess.post(f"{API}/notifications/mark-seen")
        assert r.status_code == 200
        time.sleep(0.3)
        counts = alice_sess.get(f"{API}/notifications/counts").json()
        assert counts["new_followers"] == 0, f"new_followers should reset: {counts}"


# ---------------------------------------------------------------------------
# Followers / Following lists - privacy
# ---------------------------------------------------------------------------
class TestFollowersFollowingLists:
    def test_me_followers_requires_auth(self):
        r = requests.get(f"{API}/users/me/followers", timeout=10)
        assert r.status_code in (401, 403)

    def test_me_following_requires_auth(self):
        r = requests.get(f"{API}/users/me/following", timeout=10)
        assert r.status_code in (401, 403)

    def test_alice_followers_contains_bob(self, alice_sess):
        # Bob has followed alice in earlier test; ensure here too
        r = alice_sess.get(f"{API}/users/me/followers")
        assert r.status_code == 200
        data = r.json()
        assert "followers" in data and "count" in data
        assert data["count"] == len(data["followers"])
        handles = [f["handle"] for f in data["followers"]]
        assert "bob" in handles, f"bob not in alice's followers: {handles}"
        # ensure each entry has expected keys
        for f in data["followers"]:
            assert "user_id" in f and "handle" in f

    def test_bob_following_contains_alice(self, bob_sess):
        r = bob_sess.get(f"{API}/users/me/following")
        assert r.status_code == 200
        data = r.json()
        assert "following" in data and "count" in data
        assert data["count"] == len(data["following"])
        handles = [f["handle"] for f in data["following"]]
        assert "alice" in handles, f"alice missing from bob's following: {handles}"

    def test_by_handle_does_not_leak_counts(self, bob_sess):
        # Privacy: counts must NOT be in /users/by-handle response
        r = bob_sess.get(f"{API}/users/by-handle/alice")
        assert r.status_code == 200, r.text
        body = r.json()
        user = body.get("user", {})
        assert "follower_count" not in user, f"follower_count leaked: {user}"
        assert "following_count" not in user, f"following_count leaked: {user}"
        # Whole-body sanity check (no nested counts)
        assert "follower_count" not in body
        assert "following_count" not in body

    def test_me_followers_scoped_to_self(self, alice_sess, bob_sess):
        """/me/followers must return YOUR list, never another user's."""
        a = alice_sess.get(f"{API}/users/me/followers").json()
        b = bob_sess.get(f"{API}/users/me/followers").json()
        # They should differ — bob has no followers from alice in this run
        a_handles = sorted([f["handle"] for f in a["followers"]])
        b_handles = sorted([f["handle"] for f in b["followers"]])
        # Alice should include bob; bob's list should not include itself
        assert "bob" in a_handles
        assert "bob" not in b_handles


# ---------------------------------------------------------------------------
# Admin promote
# ---------------------------------------------------------------------------
class TestAdminPromote:
    def test_promote_bob_to_admin(self, admin_sess, bob_sess):
        r = admin_sess.post(f"{API}/admin/promote", json={"email": "bob@clanchat.app"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        # Bob can now call admin endpoint
        time.sleep(0.3)
        rs = bob_sess.get(f"{API}/admin/stats")
        assert rs.status_code == 200, f"bob promoted but /admin/stats={rs.status_code}: {rs.text}"

    def test_promote_requires_admin(self, alice_sess):
        # alice is non-admin → 403
        r = alice_sess.post(f"{API}/admin/promote", json={"email": "alice@clanchat.app"})
        assert r.status_code in (401, 403)

    def test_promote_missing_email_400(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/promote", json={})
        assert r.status_code == 400

    def test_promote_unknown_email_404(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/promote", json={"email": "noone-xyz@clanchat.app"})
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Purge demo accounts — RUN LAST. Re-seed via supervisor restart afterwards.
# ---------------------------------------------------------------------------
class TestZZZPurgeDemoLast:
    def test_purge_demo_accounts(self, admin_sess):
        # Count users before
        before = admin_sess.get(f"{API}/admin/stats").json()
        users_before = before.get("users", before.get("total_users", 0))

        r = admin_sess.post(f"{API}/admin/purge-demo-accounts", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        purged_emails = body.get("purged", [])
        # alice & teen must be purged; admin (caller) must NOT; bob is now admin not demo
        assert "alice@clanchat.app" in purged_emails
        assert "teen@clanchat.app" in purged_emails
        assert "admin@clanchat.app" not in purged_emails

        time.sleep(0.4)
        after = admin_sess.get(f"{API}/admin/stats").json()
        users_after = after.get("users", after.get("total_users", 0))
        assert users_after < users_before, f"users count did not drop: {users_before} -> {users_after}"

    def test_purge_self_protection_include_seeded_admin(self, admin_sess):
        # caller is admin@clanchat.app and passes include_seeded_admin=true.
        # Self-protection: caller (the seeded admin) must still be alive.
        r = admin_sess.post(f"{API}/admin/purge-demo-accounts", json={"include_seeded_admin": True})
        assert r.status_code == 200, r.text
        # The caller must still be authenticated (their user still exists)
        me = admin_sess.get(f"{API}/auth/me")
        assert me.status_code == 200, f"Seeded admin (caller) was purged! /auth/me={me.status_code}"
        assert me.json().get("email") == "admin@clanchat.app"

    def test_zzz_reseed_via_restart(self, admin_sess):
        """After purge → supervisor restart with SEED_DEMO_DATA=1 must re-create demo users."""
        import subprocess
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, timeout=30)
        # Wait for backend to come back
        deadline = time.time() + 30
        ok = False
        while time.time() < deadline:
            try:
                r = requests.post(f"{API}/auth/login", json=ALICE, timeout=5)
                if r.status_code == 200:
                    ok = True
                    break
            except Exception:
                pass
            time.sleep(1.5)
        assert ok, "alice could not log in after restart — seed gate failed"
