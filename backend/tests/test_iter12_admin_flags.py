"""Iteration 12 - Admin manual flag overrides (minor lock + 18+ creator).

Tests:
- Lookup by handle (admin-only)
- Mark 18+ creator (set/unset, reason required only on enable)
- Mark as minor (set/unset, reason required only on enable)
- Mutual exclusion 409 guards
- Applied behaviours: locked-minor adult-follow guard, 18+ hidden from minors in search
- Audit trail contains admin_mark_minor + admin_mark_18plus events
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return login("admin@clanchat.app", "admin123")


@pytest.fixture(scope="module")
def alice():
    return login("alice@clanchat.app", "Password123!")


@pytest.fixture(scope="module")
def teen():
    return login("teen@clanchat.app", "Password123!")


@pytest.fixture(scope="module")
def bob_id(admin):
    r = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15)
    assert r.status_code == 200
    return r.json()["user_id"]


@pytest.fixture(scope="module", autouse=True)
def cleanup_bob(admin, bob_id):
    """Ensure bob starts and ends clean (no flags)."""
    admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": False}, timeout=15)
    admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": False}, timeout=15)
    yield
    admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": False}, timeout=15)
    admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": False}, timeout=15)


# ---------- LOOKUP ----------
class TestLookup:
    def test_lookup_bob_ok(self, admin):
        r = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in [
            "user_id", "handle", "display_name", "email", "dob",
            "is_minor", "dob_derived_minor", "minor_locked_by_admin",
            "minor_locked_reason", "nsfw_account", "flagged_18plus_by_admin",
            "flagged_18plus_reason", "role", "strikes",
        ]:
            assert k in d, f"missing key {k}"
        assert d["handle"] == "bob"
        assert d["dob_derived_minor"] is False
        assert d["is_minor"] is False
        assert d["nsfw_account"] is False

    def test_lookup_unknown_handle_404(self, admin):
        r = admin.get(f"{API}/admin/users/by-handle/nonexistent_handle_zzz", timeout=15)
        assert r.status_code == 404

    def test_lookup_non_admin_forbidden(self, alice):
        r = alice.get(f"{API}/admin/users/by-handle/bob", timeout=15)
        assert r.status_code in (401, 403)


# ---------- MARK 18+ ----------
class TestMark18Plus:
    def test_missing_reason_400(self, admin, bob_id):
        r = admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": True}, timeout=15)
        assert r.status_code == 400

    def test_flag_creator_ok(self, admin, bob_id):
        r = admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": True, "reason": "app approved"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["nsfw_account"] is True
        assert d["flagged_18plus_by_admin"] is True

        # verify state
        chk = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15).json()
        assert chk["nsfw_account"] is True
        assert chk["flagged_18plus_by_admin"] is True
        assert chk["flagged_18plus_reason"] == "app approved"

    def test_unflag_no_reason_required(self, admin, bob_id):
        r = admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        chk = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15).json()
        assert chk["nsfw_account"] is False
        assert chk["flagged_18plus_by_admin"] is False
        assert chk["flagged_18plus_reason"] in (None, "")


# ---------- MARK MINOR ----------
class TestMarkMinor:
    def test_missing_reason_400(self, admin, bob_id):
        r = admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": True}, timeout=15)
        assert r.status_code == 400

    def test_lock_minor_ok(self, admin, bob_id):
        r = admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": True, "reason": "safety hold"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_minor"] is True
        assert d["minor_locked_by_admin"] is True

        chk = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15).json()
        assert chk["is_minor"] is True  # admin-locked even though adult DOB
        assert chk["dob_derived_minor"] is False
        assert chk["minor_locked_by_admin"] is True
        assert chk["minor_locked_reason"] == "safety hold"

    def test_unlock_reverts_to_dob(self, admin, bob_id):
        r = admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": False},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        chk = admin.get(f"{API}/admin/users/by-handle/bob", timeout=15).json()
        assert chk["is_minor"] is False
        assert chk["minor_locked_by_admin"] is False
        assert chk["minor_locked_reason"] in (None, "")


# ---------- MUTUAL EXCLUSION ----------
class TestMutualExclusion:
    def test_cannot_lock_minor_when_18plus(self, admin, bob_id):
        # set 18+ first
        r1 = admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": True, "reason": "test"},
            timeout=15,
        )
        assert r1.status_code == 200
        # try to lock as minor
        r2 = admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": True, "reason": "test"},
            timeout=15,
        )
        assert r2.status_code == 409
        body = r2.json()
        detail = body.get("detail", "")
        assert "18+ creator" in detail and "Remove" in detail
        # cleanup
        admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": False}, timeout=15)

    def test_cannot_18plus_when_locked_minor(self, admin, bob_id):
        r1 = admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": True, "reason": "test"},
            timeout=15,
        )
        assert r1.status_code == 200
        r2 = admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": True, "reason": "test"},
            timeout=15,
        )
        assert r2.status_code == 409
        detail = r2.json().get("detail", "")
        assert "minor" in detail.lower() and "18+ creator" in detail
        # cleanup
        admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": False}, timeout=15)


# ---------- APPLIED BEHAVIOURS ----------
class TestAppliedBehaviours:
    def test_locked_minor_blocks_adult_follow(self, admin, alice, bob_id):
        # ensure alice is not following bob first
        alice.delete(f"{API}/follow/{bob_id}", timeout=15)
        # lock bob as minor
        admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": True, "reason": "test"},
            timeout=15,
        )
        # alice (adult) tries to follow bob (locked-minor) — expect 403
        r = alice.post(f"{API}/follow/{bob_id}", timeout=15)
        # unlock
        admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": False}, timeout=15)
        assert r.status_code == 403, f"expected 403 but got {r.status_code} {r.text}"

    def test_18plus_hidden_from_minor_search(self, admin, teen, bob_id):
        # flag bob as 18+
        admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": True, "reason": "test"},
            timeout=15,
        )
        # teen searches
        r = teen.get(f"{API}/users/search?q=bob", timeout=15)
        # cleanup
        admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": False}, timeout=15)

        assert r.status_code == 200
        data = r.json()
        users = data.get("users") or data.get("results") or data
        if isinstance(users, dict):
            users = users.get("users", [])
        handles = [u.get("handle") for u in users if isinstance(u, dict)]
        assert "bob" not in handles, f"bob should be hidden from minor search; got {handles}"


# ---------- AUDIT TRAIL ----------
class TestAudit:
    def test_audit_contains_mark_events(self, admin, bob_id):
        # trigger both events
        admin.post(
            f"{API}/admin/users/{bob_id}/mark-18plus",
            json={"is_creator": True, "reason": "audit-test"},
            timeout=15,
        )
        admin.post(f"{API}/admin/users/{bob_id}/mark-18plus", json={"is_creator": False}, timeout=15)
        admin.post(
            f"{API}/admin/users/{bob_id}/mark-minor",
            json={"locked": True, "reason": "audit-test"},
            timeout=15,
        )
        admin.post(f"{API}/admin/users/{bob_id}/mark-minor", json={"locked": False}, timeout=15)

        r = admin.get(f"{API}/admin/audit?limit=30", timeout=15)
        assert r.status_code == 200
        events = r.json()["events"]
        ev_names = [e.get("event") for e in events]
        assert "admin_mark_18plus" in ev_names
        assert "admin_mark_minor" in ev_names

        # validate fields on a mark_minor event
        mm = next(e for e in events if e.get("event") == "admin_mark_minor")
        for k in ["target_user_id", "target_handle", "reason", "admin_id", "at"]:
            assert k in mm, f"audit_mark_minor missing key {k}"
        assert mm["target_handle"] == "bob"
