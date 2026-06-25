"""
Iteration 10 — Self-DM ("Me, myself and I") backend tests + DM regression.

Covers:
- Send-to-self bypasses can_dm gate and is pre-read.
- /dms/threads always exposes self thread at top (even for brand-new users).
- /dms/with/{me} returns is_self=True, can_send=True, reason=''.
- Privacy: other users cannot see your self-messages.
- Regression: bob->alice still gated by followers+dms_enabled_followers,
  non-existent recipient 404s, unread badge increments/decrements.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@clanchat.app", "password": "Password123!"}
BOB = {"email": "bob@clanchat.app", "password": "Password123!"}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    me = s.get(f"{API}/auth/me", timeout=20).json()
    return s, me


@pytest.fixture(scope="module")
def alice():
    s, me = _login(**ALICE)
    return s, me


@pytest.fixture(scope="module")
def bob():
    s, me = _login(**BOB)
    return s, me


# --- Self-DM send -----------------------------------------------------------
class TestSelfDMSend:
    def test_alice_sends_to_self_bypasses_can_dm(self, alice):
        s, me = alice
        # Turn follower DMs OFF to prove can_dm is bypassed.
        s.put(f"{API}/settings", json={"dms_enabled_followers": False}, timeout=20)
        body = {"recipient_id": me["user_id"], "content": f"saved note {uuid.uuid4().hex[:6]}"}
        r = s.post(f"{API}/dms", json=body, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["from_id"] == me["user_id"]
        assert data["to_id"] == me["user_id"]
        assert data["read"] is True, "self-sent DM must be pre-marked read"
        assert data["content"].startswith("saved note")


# --- Threads listing --------------------------------------------------------
class TestSelfThreadAlwaysPresent:
    def test_alice_threads_self_first(self, alice):
        s, _ = alice
        r = s.get(f"{API}/dms/threads", timeout=20)
        assert r.status_code == 200
        threads = r.json()["threads"]
        assert len(threads) >= 1
        first = threads[0]
        assert first["with"].get("is_self") is True
        assert first["with"]["display_name"] == "Me, myself and I"

    def test_fresh_user_has_self_thread_with_null_last(self):
        # Register a brand-new user — no DMs yet.
        s = requests.Session()
        uid = uuid.uuid4().hex[:8]
        payload = {
            "email": f"fresh_{uid}@clanchat.app",
            "password": "Password123!",
            "handle": f"fresh{uid}",
            "display_name": "Fresh",
            "dob": "1995-01-01",
        }
        r = s.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        r = s.get(f"{API}/dms/threads", timeout=20)
        assert r.status_code == 200
        threads = r.json()["threads"]
        assert len(threads) >= 1
        first = threads[0]
        assert first["with"].get("is_self") is True
        assert first["with"]["display_name"] == "Me, myself and I"
        assert first["last"] is None, f"fresh user self-thread.last must be null, got {first['last']}"


# --- Self history -----------------------------------------------------------
class TestSelfHistory:
    def test_history_with_self_returns_self_flags(self, alice):
        s, me = alice
        # ensure at least one self-message exists
        s.post(f"{API}/dms", json={"recipient_id": me["user_id"], "content": "history seed"}, timeout=20)
        r = s.get(f"{API}/dms/with/{me['user_id']}", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["with"]["is_self"] is True
        assert data["can_send"] is True
        assert data["reason"] == ""
        assert isinstance(data["messages"], list)
        # idempotent on repeat
        r2 = s.get(f"{API}/dms/with/{me['user_id']}", timeout=20)
        assert r2.status_code == 200
        assert len(r2.json()["messages"]) == len(data["messages"])


# --- Privacy ----------------------------------------------------------------
class TestSelfDMPrivacy:
    def test_bob_cannot_see_alices_self_messages(self, alice, bob):
        sa, alice_me = alice
        sb, bob_me = bob
        marker = f"SECRET-{uuid.uuid4().hex[:8]}"
        # Alice writes a self note containing marker
        r = sa.post(f"{API}/dms", json={"recipient_id": alice_me["user_id"], "content": marker}, timeout=20)
        assert r.status_code == 200
        # Bob queries /dms/with/{alice_id}
        r = sb.get(f"{API}/dms/with/{alice_me['user_id']}", timeout=20)
        assert r.status_code == 200
        body = r.json()
        for m in body["messages"]:
            # cross-user view must never expose alice->alice messages
            assert not (m["from_id"] == alice_me["user_id"] and m["to_id"] == alice_me["user_id"]), \
                f"Privacy leak: bob saw alice self-DM {m}"
            assert marker not in m["content"], f"Privacy leak: marker visible to bob: {m}"


# --- Regression: cross-user gating + unread counts --------------------------
class TestDMRegression:
    def test_stranger_to_alice_blocked_when_not_follower(self, alice):
        # Use a fresh stranger account so we don't inherit state (follow/inner-circle)
        # from prior test iterations on bob.
        sa, alice_me = alice
        sa.put(f"{API}/settings", json={"dms_enabled_followers": False}, timeout=20)
        s_stranger = requests.Session()
        uid = uuid.uuid4().hex[:8]
        reg = s_stranger.post(f"{API}/auth/register", json={
            "email": f"stranger_{uid}@clanchat.app",
            "password": "Password123!",
            "handle": f"strn{uid}",
            "display_name": "Stranger",
            "dob": "1995-01-01",
        }, timeout=20)
        assert reg.status_code == 200, reg.text
        r = s_stranger.post(f"{API}/dms",
                            json={"recipient_id": alice_me["user_id"], "content": "hi from stranger"},
                            timeout=20)
        assert r.status_code == 403, f"expected gated 403, got {r.status_code}: {r.text}"

    def test_bob_to_alice_works_when_follower_dms_enabled(self, alice, bob):
        sa, alice_me = alice
        sb, bob_me = bob
        # Bob follows Alice
        sb.post(f"{API}/follow/{alice_me['user_id']}", timeout=20)
        # Alice opens follower DMs
        sa.put(f"{API}/settings", json={"dms_enabled_followers": True}, timeout=20)
        # Snapshot Alice's unread_dms
        c0 = sa.get(f"{API}/notifications/counts", timeout=20).json().get("unread_dms", 0)
        msg = f"hi alice {uuid.uuid4().hex[:6]}"
        r = sb.post(f"{API}/dms", json={"recipient_id": alice_me["user_id"], "content": msg}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["read"] is False
        # Unread bumped
        c1 = sa.get(f"{API}/notifications/counts", timeout=20).json().get("unread_dms", 0)
        assert c1 >= c0 + 1, f"unread_dms did not increment: before={c0} after={c1}"
        # Alice opens thread → read
        r = sa.get(f"{API}/dms/with/{bob_me['user_id']}", timeout=20)
        assert r.status_code == 200
        c2 = sa.get(f"{API}/notifications/counts", timeout=20).json().get("unread_dms", 0)
        assert c2 <= c1 - 1, f"unread_dms did not decrement after open: before={c1} after={c2}"

    def test_send_to_unknown_recipient_404(self, alice):
        s, _ = alice
        r = s.post(f"{API}/dms", json={"recipient_id": "user_doesnotexist_xyz", "content": "hi"}, timeout=20)
        assert r.status_code == 404
