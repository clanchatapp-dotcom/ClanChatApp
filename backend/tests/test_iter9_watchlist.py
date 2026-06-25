"""
Iteration 9 — Admin Watchlist feature tests.

Covers:
- POST /api/admin/watch/{user_id}        — add to watchlist (requires reason)
- GET  /api/admin/watch                  — list active watched
- GET  /api/admin/watch/{user_id}/overview — full overview (posts, DMs, IC, groups, reports)
- DELETE /api/admin/watch/{user_id}      — remove (soft inactive)
- Audit trail in /api/admin/audit
- Silent-to-target invariant on bob's /auth/me, /users/me, /notifications/counts
- Cleanup leaves DB clean
"""

import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@clanchat.app", "admin123")
ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")


def _session_login(email: str, password: str):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


def _me(sess):
    r = sess.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_sess():
    return _session_login(*ADMIN)


@pytest.fixture(scope="module")
def alice_sess():
    return _session_login(*ALICE)


@pytest.fixture(scope="module")
def bob_sess():
    return _session_login(*BOB)


@pytest.fixture(scope="module")
def bob_id(bob_sess):
    me = _me(bob_sess)
    # Robustness: accept either user_id or id key
    return me.get("user_id") or me.get("id") or me.get("_id")


# ------------------------------------------------------------------
# Cleanup: ensure bob is NOT on the watchlist before running, then again after.
# ------------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup_watchlist(admin_sess, bob_id):
    # pre-clean
    admin_sess.delete(f"{API}/admin/watch/{bob_id}", timeout=15)
    yield
    # post-clean (best-effort)
    admin_sess.delete(f"{API}/admin/watch/{bob_id}", timeout=15)


# ------------------------------------------------------------------
# 1. ADD TO WATCHLIST
# ------------------------------------------------------------------
class TestWatchAdd:
    def test_add_missing_reason_400(self, admin_sess, bob_id):
        r = admin_sess.post(f"{API}/admin/watch/{bob_id}", json={}, timeout=15)
        assert r.status_code == 400
        assert "reason" in r.text.lower()

    def test_add_empty_reason_400(self, admin_sess, bob_id):
        r = admin_sess.post(f"{API}/admin/watch/{bob_id}", json={"reason": "   "}, timeout=15)
        assert r.status_code == 400

    def test_add_non_admin_forbidden(self, alice_sess, bob_id):
        r = alice_sess.post(f"{API}/admin/watch/{bob_id}", json={"reason": "should fail"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_add_success(self, admin_sess, bob_id):
        r = admin_sess.post(f"{API}/admin/watch/{bob_id}", json={"reason": "TEST iter9 investigation"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "watch_id" in body
        assert isinstance(body["watch_id"], str)
        assert body["watch_id"].startswith("watch_")

    def test_add_idempotent_returns_existing(self, admin_sess, bob_id):
        r = admin_sess.post(f"{API}/admin/watch/{bob_id}", json={"reason": "second add"}, timeout=15)
        assert r.status_code == 200
        assert "watch_id" in r.json()


# ------------------------------------------------------------------
# 2. LIST
# ------------------------------------------------------------------
class TestWatchList:
    def test_list_contains_bob(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/watch", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "watched" in data
        assert isinstance(data["watched"], list)
        ids = [w["target"]["user_id"] for w in data["watched"]]
        assert bob_id in ids
        # Validate shape
        row = next(w for w in data["watched"] if w["target"]["user_id"] == bob_id)
        for k in ("watch_id", "target", "reason", "added_at", "added_by"):
            assert k in row, f"missing key {k}"
        for tk in ("user_id", "handle"):
            assert tk in row["target"]

    def test_list_non_admin_forbidden(self, alice_sess):
        r = alice_sess.get(f"{API}/admin/watch", timeout=15)
        assert r.status_code in (401, 403)


# ------------------------------------------------------------------
# 3. OVERVIEW
# ------------------------------------------------------------------
class TestWatchOverview:
    def test_overview_requires_active_watch(self, admin_sess, alice_sess):
        # alice is NOT on watchlist
        alice_me = _me(alice_sess)
        alice_id = alice_me.get("user_id") or alice_me.get("id")
        r = admin_sess.get(f"{API}/admin/watch/{alice_id}/overview", timeout=15)
        assert r.status_code == 403
        assert "watchlist" in r.text.lower()

    def test_overview_shape(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/watch/{bob_id}/overview", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in (
            "target", "posts", "dms", "counterparts", "groups",
            "inner_circle_members", "inner_circle_of",
            "followers_count", "following_count", "reports_against",
        ):
            assert k in data, f"missing top-level key: {k}"
        assert data["target"]["user_id"] == bob_id
        assert isinstance(data["posts"], list)
        assert isinstance(data["dms"], list)
        assert isinstance(data["counterparts"], dict)
        # no password leakage
        assert "password_hash" not in data["target"]

    def test_overview_dms_both_directions(self, admin_sess, alice_sess, bob_sess, bob_id):
        # Generate one outgoing + one incoming DM for bob with alice
        alice_id = (_me(alice_sess)).get("user_id")
        bob_sess.post(f"{API}/dms", json={"recipient_id": alice_id, "content": "TEST iter9 watch-outgoing-bob"}, timeout=15)
        alice_sess.post(f"{API}/dms", json={"recipient_id": bob_id, "content": "TEST iter9 watch-incoming-bob"}, timeout=15)
        time.sleep(0.5)
        r = admin_sess.get(f"{API}/admin/watch/{bob_id}/overview", timeout=15)
        assert r.status_code == 200
        dms = r.json()["dms"]
        out = [m for m in dms if m.get("from_id") == bob_id and "TEST iter9 watch-outgoing-bob" in (m.get("content") or "")]
        inc = [m for m in dms if m.get("to_id") == bob_id and "TEST iter9 watch-incoming-bob" in (m.get("content") or "")]
        assert out, "outgoing DM from bob not captured in overview"
        assert inc, "incoming DM to bob not captured in overview"

    def test_overview_non_admin_forbidden(self, alice_sess, bob_id):
        r = alice_sess.get(f"{API}/admin/watch/{bob_id}/overview", timeout=15)
        assert r.status_code in (401, 403)


# ------------------------------------------------------------------
# 4. AUDIT TRAIL
# ------------------------------------------------------------------
class TestAuditTrail:
    def test_audit_has_add_and_view(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/audit", params={"limit": 50}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        events = body.get("events") or body.get("audit") or body if isinstance(body, list) else body.get("events", [])
        # Try multiple key conventions
        if isinstance(body, dict):
            events = body.get("events") or body.get("items") or body.get("audit") or []
        evt_types = [e.get("event") for e in events]
        assert "watchlist_add" in evt_types, f"watchlist_add missing in audit events: {evt_types}"
        assert "watchlist_view_overview" in evt_types
        add_row = next(e for e in events if e.get("event") == "watchlist_add")
        assert add_row.get("target_id") == bob_id
        assert add_row.get("admin_id")
        assert add_row.get("at")
        assert add_row.get("reason")


# ------------------------------------------------------------------
# 5. SILENT TO TARGET — bob must NOT see anything that hints he's watched
# ------------------------------------------------------------------
class TestSilentToTarget:
    FORBIDDEN_KEYS = {"watched", "watch_id", "under_investigation", "is_watched", "on_watchlist", "watch_reason"}

    def _scan(self, obj):
        bad = set()
        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in self.FORBIDDEN_KEYS:
                        bad.add(k)
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(obj)
        return bad

    def test_auth_me_silent(self, bob_sess):
        r = bob_sess.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        bad = self._scan(r.json())
        assert not bad, f"forbidden surveillance keys leaked to target in /auth/me: {bad}"

    def test_users_me_silent(self, bob_sess):
        r = bob_sess.get(f"{API}/users/me", timeout=15)
        # endpoint may or may not exist; if 404, skip; otherwise must be silent
        if r.status_code in (404, 405):
            pytest.skip("/users/me not a GET endpoint — surveillance leak not applicable")
        assert r.status_code == 200, r.text
        bad = self._scan(r.json())
        assert not bad, f"forbidden surveillance keys leaked to target in /users/me: {bad}"

    def test_notif_counts_silent(self, bob_sess):
        r = bob_sess.get(f"{API}/notifications/counts", timeout=15)
        assert r.status_code == 200
        bad = self._scan(r.json())
        assert not bad, f"forbidden surveillance keys leaked to target in /notifications/counts: {bad}"


# ------------------------------------------------------------------
# 6. REMOVE
# ------------------------------------------------------------------
class TestWatchRemove:
    def test_remove_non_admin_forbidden(self, alice_sess, bob_id):
        r = alice_sess.delete(f"{API}/admin/watch/{bob_id}", timeout=15)
        assert r.status_code in (401, 403)

    def test_remove_success(self, admin_sess, bob_id):
        r = admin_sess.delete(f"{API}/admin/watch/{bob_id}", timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_overview_403_after_remove(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/watch/{bob_id}/overview", timeout=15)
        assert r.status_code == 403

    def test_list_excludes_removed(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/watch", timeout=15)
        assert r.status_code == 200
        ids = [w["target"]["user_id"] for w in r.json()["watched"]]
        assert bob_id not in ids

    def test_audit_has_remove_event(self, admin_sess, bob_id):
        r = admin_sess.get(f"{API}/admin/audit", params={"limit": 50}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        events = body if isinstance(body, list) else (body.get("events") or body.get("items") or body.get("audit") or [])
        evt_types = [e.get("event") for e in events]
        assert "watchlist_remove" in evt_types
        rem = next(e for e in events if e.get("event") == "watchlist_remove" and e.get("target_id") == bob_id)
        assert rem.get("admin_id")
        assert rem.get("at")

    def test_remove_again_404(self, admin_sess, bob_id):
        r = admin_sess.delete(f"{API}/admin/watch/{bob_id}", timeout=15)
        assert r.status_code == 404
