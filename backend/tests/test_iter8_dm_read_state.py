"""
Iter8 — DM read-state transitions bug fix.

Bug: GET /api/dms/with/{other_id} never marked recipient's unread DMs as read,
so the unread_dms counter on /notifications/counts stayed > 0 forever and the
Messages icon dot never cleared.

Fix: dm_history now calls db.dms.update_many(
        {from_id=other_id, to_id=me, read=False},
        {$set:{read:True, read_at:now}})
before returning the thread.

This test verifies:
 1. unread_dms increments when a DM is received
 2. opening the thread (GET /dms/with/{other}) drops unread_dms to 0
 3. the message row in db.dms has read:true + read_at set
 4. opening one's OWN sent thread does NOT mark those messages as read for
    the sender's side (read-flag is for recipient-perspective only)
 5. idempotent: calling GET /dms/with/{other} twice when no unread is a no-op
"""

import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------- helpers / fixtures ----------------

def _login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def alice():
    return _login("alice@clanchat.app", "Password123!")


@pytest.fixture(scope="module")
def bob():
    return _login("bob@clanchat.app", "Password123!")


@pytest.fixture(scope="module")
def alice_id(alice):
    r = alice.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200
    return r.json()["user_id"]


@pytest.fixture(scope="module")
def bob_id(bob):
    r = bob.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200
    return r.json()["user_id"]


@pytest.fixture(scope="module", autouse=True)
def _ensure_follow_and_dm_settings(alice, bob, alice_id, bob_id):
    """bob must follow alice + alice.dms_enabled_followers=true so bob can DM her."""
    # alice opens DMs to followers
    r = alice.patch(f"{API}/users/me", json={"settings": {"dms_enabled_followers": True}}, timeout=10)
    assert r.status_code == 200, r.text
    # bob follows alice (idempotent)
    bob.post(f"{API}/follow/{alice_id}", timeout=10)
    # alice follows bob so that she can DM bob back (mutual follow makes it trivial)
    # but we'll also flip bob's setting in case
    r = bob.patch(f"{API}/users/me", json={"settings": {"dms_enabled_followers": True}}, timeout=10)
    assert r.status_code == 200
    alice.post(f"{API}/follow/{bob_id}", timeout=10)
    yield


def _counts(session: requests.Session) -> dict:
    r = session.get(f"{API}/notifications/counts", timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- tests ----------------

class TestDmReadStateBugFix:
    """Core bug-fix tests."""

    def test_01_baseline_alice_drains_existing(self, alice, bob_id):
        # Drain any pre-existing unread from prior test runs by opening bob's thread.
        alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        c = _counts(alice)
        assert c["unread_dms"] == 0, f"baseline drain failed, unread_dms={c['unread_dms']}"

    def test_02_send_dm_bumps_unread(self, alice, bob, alice_id):
        # bob sends DM to alice
        r = bob.post(f"{API}/dms", json={"recipient_id": alice_id, "content": "TEST iter8 unread"}, timeout=10)
        assert r.status_code == 200, f"send dm failed: {r.status_code} {r.text}"
        c = _counts(alice)
        assert c["unread_dms"] >= 1, f"unread_dms did not increment: {c}"
        assert c["total"] >= c["unread_dms"], "total should include unread_dms"

    def test_03_open_thread_clears_unread(self, alice, bob_id):
        # alice GETs the thread → should mark bob→alice messages as read
        r = alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "messages" in body and isinstance(body["messages"], list)
        # Should contain at least one message
        assert len(body["messages"]) >= 1

        c = _counts(alice)
        assert c["unread_dms"] == 0, f"unread_dms should be 0 after opening thread, got {c}"

    def test_04_db_row_has_read_true(self, alice, bob_id):
        # Re-fetch the thread and check the most recent incoming msg from bob has read=True
        r = alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        assert r.status_code == 200
        msgs = r.json()["messages"]
        incoming = [m for m in msgs if m.get("from_id") == bob_id]
        assert incoming, "expected at least one incoming msg from bob"
        last = incoming[-1]
        assert last.get("read") is True, f"db row should be read:true, got {last}"
        assert last.get("read_at"), f"db row should have read_at timestamp, got {last}"

    def test_05_idempotent_reopen_no_error(self, alice, bob_id):
        r1 = alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        r2 = alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200
        assert len(r1.json()["messages"]) == len(r2.json()["messages"]), "idempotent count mismatch"
        c = _counts(alice)
        assert c["unread_dms"] == 0


class TestDmReadStateDoesNotMarkOutgoing:
    """Opening one's own thread must NOT mark messages I SENT as read.
    The read flag is recipient-perspective: only flips when the recipient opens it."""

    def test_01_alice_replies_to_bob(self, alice, bob, bob_id, alice_id):
        # Ensure bob's inbox is clear first
        bob.get(f"{API}/dms/with/{alice_id}", timeout=10)
        assert _counts(bob)["unread_dms"] == 0

        # alice sends a reply to bob
        r = alice.post(f"{API}/dms", json={"recipient_id": bob_id, "content": "TEST iter8 outgoing"}, timeout=10)
        assert r.status_code == 200, r.text

        # bob now has unread_dms=1
        assert _counts(bob)["unread_dms"] == 1, "bob should have 1 unread after alice's reply"

    def test_02_alice_reviewing_own_thread_does_not_clear_bobs_unread(self, alice, bob, bob_id):
        # alice GETs her thread with bob — these are outgoing (alice→bob), so it should NOT mark them read
        r = alice.get(f"{API}/dms/with/{bob_id}", timeout=10)
        assert r.status_code == 200
        # bob's unread MUST still be 1
        c = _counts(bob)
        assert c["unread_dms"] == 1, f"bob's unread should remain 1 (alice re-viewing own thread must not flip it), got {c}"

    def test_03_bob_opens_thread_clears_his_unread(self, bob, alice_id):
        r = bob.get(f"{API}/dms/with/{alice_id}", timeout=10)
        assert r.status_code == 200
        c = _counts(bob)
        assert c["unread_dms"] == 0, f"bob's unread should clear after he opens the thread, got {c}"


# ---------------- regression smoke ----------------

class TestRegressionNotifCountsShape:
    """Make sure /notifications/counts still returns the full 8-key shape."""

    def test_shape(self, alice):
        c = _counts(alice)
        for k in ("follow_requests", "inner_invites", "unread_dms", "new_followers",
                  "tag_pending", "group_invites", "warnings", "total"):
            assert k in c, f"missing key {k} in counts: {c}"
            assert isinstance(c[k], int), f"{k} not int: {type(c[k])}"
