"""Iteration 20 — Polish batch: DM-received + Inner-invite emit activity events.

Two new event kinds were wired into emit_activity_event:
  1) POST /api/dms → emit kind='dm_received' (previously only fcm_push, no feed row)
  2) POST /api/inner/invite → emit kind='inner_invite' (previously only fcm_push, no feed row)

Also verifies:
- Self-DM does NOT emit dm_received (recipient == actor is skipped)
- Blocked-pair filter still applies to both new kinds
- DM send still returns 200 even if there is no FCM token (best-effort push)
- Idempotency: sending 2 DMs → 2 dm_received events on B's feed
"""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# --------------------------------------------------------------------
# helpers — same pattern as test_iter17
# --------------------------------------------------------------------
def new_client(token: str | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return s


def _register(prefix: str = "iter20", dob: str = "1995-01-01") -> dict:
    email = f"{prefix}_{uuid.uuid4().hex[:8]}@clanchat.app"
    handle = f"{prefix}{uuid.uuid4().hex[:6]}"
    last = None
    for _ in range(4):
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!", "handle": handle,
            "display_name": f"Iter20 {prefix}", "dob": dob,
        })
        if r.status_code == 200:
            d = r.json()
            return {
                "email": email, "handle": handle,
                "token": d["access_token"],
                "user_id": d["user"]["user_id"],
                "session": new_client(d["access_token"]),
            }
        last = r
        if r.status_code in (500, 502, 503, 504):
            time.sleep(1.5)
            continue
        break
    raise AssertionError(f"register failed: {last.status_code} {last.text}")


def _mutual_ic(a: dict, b: dict):
    r1 = a["session"].post(f"{API}/follow/{b['user_id']}")
    assert r1.status_code == 200, r1.text
    r2 = b["session"].post(f"{API}/follow/{a['user_id']}")
    assert r2.status_code == 200, r2.text
    inv1 = a["session"].post(f"{API}/inner/invite",
                             json={"user_id": b["user_id"], "permissions": {"dms": True}})
    assert inv1.status_code == 200, inv1.text
    invs_b = b["session"].get(f"{API}/inner/invites").json().get("invites", [])
    inv_from_a = next((i for i in invs_b if i["owner"]["user_id"] == a["user_id"]), None)
    assert inv_from_a, f"B did not receive invite from A: {invs_b}"
    r = b["session"].post(f"{API}/inner/invites/{inv_from_a['invite_id']}/accept")
    assert r.status_code == 200, r.text
    inv2 = b["session"].post(f"{API}/inner/invite",
                             json={"user_id": a["user_id"], "permissions": {"dms": True}})
    assert inv2.status_code == 200, inv2.text
    invs_a = a["session"].get(f"{API}/inner/invites").json().get("invites", [])
    inv_from_b = next((i for i in invs_a if i["owner"]["user_id"] == b["user_id"]), None)
    assert inv_from_b, f"A did not receive invite from B: {invs_a}"
    r = a["session"].post(f"{API}/inner/invites/{inv_from_b['invite_id']}/accept")
    assert r.status_code == 200, r.text


def _mark_all_read(sess):
    r = sess.post(f"{API}/activity/read-all")
    assert r.status_code == 200


# --------------------------------------------------------------------
# fixtures — three throwaway users
# --------------------------------------------------------------------
@pytest.fixture(scope="module")
def user_a():
    return _register("iter20a")


@pytest.fixture(scope="module")
def user_b():
    return _register("iter20b")


@pytest.fixture(scope="module")
def user_c():
    return _register("iter20c")


@pytest.fixture(scope="module")
def mutual_ab(user_a, user_b):
    _mutual_ic(user_a, user_b)
    _mark_all_read(user_a["session"])
    _mark_all_read(user_b["session"])
    return True


# --------------------------------------------------------------------
# 1. POST /api/dms emits kind='dm_received'
# --------------------------------------------------------------------
class TestDmReceivedEvent:
    def test_dm_send_emits_dm_received_event(self, user_a, user_b, mutual_ab):
        """A DMs B → B's /activity/feed contains kind='dm_received',
        actor.user_id=A, ref.message_id=<mid>."""
        _mark_all_read(user_b["session"])
        cnt_before = user_b["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_before == 0

        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_b["user_id"],
            "content": "TEST_iter20 dm-received event",
            "media_paths": [],
        })
        assert r.status_code == 200, r.text  # DM send must still work
        mid = r.json()["message_id"]

        time.sleep(0.3)

        # Unread count must have grown by exactly 1
        cnt_after = user_b["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_after == 1, f"expected 1 new event on B, got {cnt_after}"

        # Feed contains the dm_received row with the right actor + ref
        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "dm_received"
                 and e.get("actor_id") == user_a["user_id"]
                 and (e.get("ref") or {}).get("message_id") == mid]
        assert match, f"no dm_received event for message {mid} in feed: {feed}"
        ev = match[0]
        # Actor hydration
        assert ev.get("actor"), f"actor not hydrated: {ev}"
        assert ev["actor"]["user_id"] == user_a["user_id"]
        assert ev["actor"].get("handle") == user_a["handle"]
        # Read flag defaults to False
        assert ev.get("read") is False

    def test_multiple_dms_emit_multiple_events(self, user_a, user_b, mutual_ab):
        """Two DMs in a row → two dm_received events on B's feed."""
        _mark_all_read(user_b["session"])

        mids = []
        for i in range(2):
            r = user_a["session"].post(f"{API}/dms", json={
                "recipient_id": user_b["user_id"],
                "content": f"TEST_iter20 multi-dm-{i}",
                "media_paths": [],
            })
            assert r.status_code == 200, r.text
            mids.append(r.json()["message_id"])
        time.sleep(0.4)

        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        found_mids = {
            (e.get("ref") or {}).get("message_id")
            for e in feed
            if e["kind"] == "dm_received" and e.get("actor_id") == user_a["user_id"]
        }
        for mid in mids:
            assert mid in found_mids, f"missing dm_received event for {mid} in {found_mids}"

    def test_self_dm_does_not_emit_dm_received(self, user_a):
        """Sending a DM to yourself must NOT create a dm_received event."""
        _mark_all_read(user_a["session"])
        cnt_before = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_before == 0

        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_a["user_id"],  # self-DM
            "content": "TEST_iter20 self-dm should not emit",
            "media_paths": [],
        })
        assert r.status_code == 200, r.text

        time.sleep(0.3)
        cnt_after = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_after == 0, f"self-DM must NOT create an event, got {cnt_after}"

        # Extra: no dm_received row on the actor's own feed at all
        feed = user_a["session"].get(f"{API}/activity/feed").json()["events"]
        self_dms = [e for e in feed if e["kind"] == "dm_received"
                    and e.get("actor_id") == user_a["user_id"]]
        assert not self_dms, f"unexpected self-DM events on feed: {self_dms}"

    def test_blocked_recipient_drops_dm_received_event(self, user_a, user_c):
        """If C blocks A, A DMing C must NOT create a dm_received event.
        (The DM API itself may 200 or 403 depending on can_dm — the event
        row is what matters here.)"""
        # Set up mutual IC so DMs are permitted before blocking
        _mutual_ic(user_a, user_c)
        _mark_all_read(user_c["session"])

        # C blocks A
        r = user_c["session"].post(f"{API}/block/{user_a['user_id']}")
        assert r.status_code == 200, r.text

        # A attempts to DM C. Depending on can_dm semantics with blocks in
        # place, this may 200 (if the block hasn't cascaded IC) or 403.
        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_c["user_id"],
            "content": "TEST_iter20 blocked dm",
            "media_paths": [],
        })
        # We tolerate either — the emit-side filter is what we're asserting.
        assert r.status_code in (200, 403, 404), f"unexpected {r.status_code}: {r.text}"

        time.sleep(0.3)
        cnt = user_c["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt == 0, f"blocked-pair filter FAILED — expected 0 events on C, got {cnt}"

        # Unblock so other tests in this session aren't affected
        user_c["session"].delete(f"{API}/block/{user_a['user_id']}")


# --------------------------------------------------------------------
# 2. POST /api/inner/invite emits kind='inner_invite'
# --------------------------------------------------------------------
class TestInnerInviteEvent:
    def test_invite_emits_inner_invite_event(self, user_a):
        """A calls POST /api/inner/invite → recipient's feed contains
        kind='inner_invite', actor=A, ref.invite_id present."""
        # Fresh throwaway recipient so we can assert exact count.
        recip = _register("iter20inv")
        _mark_all_read(recip["session"])

        # Prerequisite for /inner/invite is that A follows recip (open follow_mode)
        r = user_a["session"].post(f"{API}/follow/{recip['user_id']}")
        assert r.status_code == 200, r.text

        # A invites recip to IC
        r = user_a["session"].post(f"{API}/inner/invite",
                                    json={"user_id": recip["user_id"],
                                          "permissions": {"dms": True}})
        assert r.status_code == 200, r.text

        time.sleep(0.3)
        feed = recip["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "inner_invite"
                 and e.get("actor_id") == user_a["user_id"]]
        assert match, f"no inner_invite event on recip feed: {feed}"
        ev = match[0]
        assert (ev.get("ref") or {}).get("invite_id"), \
            f"inner_invite event missing ref.invite_id: {ev}"
        # Actor is hydrated
        assert ev.get("actor"), f"actor not hydrated: {ev}"
        assert ev["actor"]["user_id"] == user_a["user_id"]
        assert ev.get("read") is False

    def test_blocked_recipient_drops_inner_invite_event(self, user_a):
        """If the target has blocked the actor, no inner_invite event is created."""
        recip = _register("iter20blk")
        # A must follow recip first for /inner/invite to succeed.
        assert user_a["session"].post(f"{API}/follow/{recip['user_id']}").status_code == 200

        # recip blocks A
        r = recip["session"].post(f"{API}/block/{user_a['user_id']}")
        assert r.status_code == 200, r.text
        _mark_all_read(recip["session"])

        # A attempts to invite recip — API may 200 or 403 depending on block-check
        # order. What matters is the emit-side filter.
        r = user_a["session"].post(f"{API}/inner/invite",
                                    json={"user_id": recip["user_id"],
                                          "permissions": {"dms": True}})
        assert r.status_code in (200, 403, 404), f"unexpected {r.status_code}: {r.text}"

        time.sleep(0.3)
        cnt = recip["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt == 0, f"blocked-pair filter FAILED — expected 0 events, got {cnt}"


# --------------------------------------------------------------------
# 3. DM send returns 200 even if FCM push is unreachable (best-effort)
# --------------------------------------------------------------------
class TestDmSendResilience:
    def test_dm_send_returns_200_and_creates_event_regardless_of_fcm(self, user_a, user_b, mutual_ab):
        """Recipient has no FCM token registered — DM send must still 200 and
        activity event must still be created. emit_activity_event is
        documented as idempotent-safe against push failures."""
        _mark_all_read(user_b["session"])
        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_b["user_id"],
            "content": "TEST_iter20 resilient dm",
            "media_paths": [],
        })
        # Send returned 200
        assert r.status_code == 200, r.text
        mid = r.json()["message_id"]
        time.sleep(0.3)
        # Activity row created either way
        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "dm_received"
                 and (e.get("ref") or {}).get("message_id") == mid]
        assert match, f"event row must exist even without FCM: feed={feed}"
