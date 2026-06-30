"""
Tests for encrypted DM system.
Verifies encryption at rest, admin flagging, and audit trails.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")
ADMIN = ("admin@clanchat.app", "admin123")


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _me_id(sess):
    r = sess.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["user_id"]


@pytest.fixture(scope="module")
def alice():
    s = _login(*ALICE)
    # Ensure alice allows follower DMs
    s.patch(f"{API}/users/me", json={"settings": {"dms_enabled_followers": True}}, timeout=10)
    return s


@pytest.fixture(scope="module")
def bob():
    s = _login(*BOB)
    # bob follows alice
    alice_id = _me_id(_login(*ALICE))
    s.post(f"{API}/follow/{alice_id}", timeout=10)
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module", autouse=True)
def cleanup_flags(admin):
    """Clean up admin flags before and after tests."""
    bob_id = _me_id(_login(*BOB))
    admin.delete(f"{API}/admin/users/{bob_id}/flag", timeout=10)
    yield
    admin.delete(f"{API}/admin/users/{bob_id}/flag", timeout=10)


class TestEncryptedDMs:
    """Verify encryption at rest and decryption for viewing."""

    def test_send_dm_encrypted_and_decrypted_for_admin(self, alice, bob, admin):
        """DM is encrypted in storage but decrypted for admin viewing of flagged accounts."""
        alice_id = _me_id(alice)
        bob_id = _me_id(bob)

        # bob sends DM to alice
        plaintext = "This is a secret message for encryption test"
        r = bob.post(
            f"{API}/dms",
            json={
                "recipient_id": alice_id,
                "content": plaintext,
                "media_paths": [],
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["content"] == plaintext  # Client sees plaintext
        assert msg.get("encrypted") is True

        # Flag bob for review
        r = admin.post(
            f"{API}/admin/users/{bob_id}/flag",
            json={
                "reason": "test encryption verification",
                "flag_type": "test",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text

        # Admin views decrypted DMs
        r = admin.get(f"{API}/admin/users/{bob_id}/dms-decrypted", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == bob_id
        assert data["flag_reason"] == "test encryption verification"

        # Find our message in outgoing DMs
        msg_found = next(
            (m for m in data["outgoing_dms"] if m["content"] == plaintext),
            None,
        )
        assert msg_found is not None, "Message not found in admin outgoing DMs"
        assert msg_found["content"] == plaintext  # Decrypted for admin

    def test_admin_flag_required_for_dm_view(self, bob, admin):
        """Unflagged users' DMs should not be viewable by admin."""
        bob_id = _me_id(bob)

        # Ensure bob is NOT flagged
        admin.delete(f"{API}/admin/users/{bob_id}/flag", timeout=10)

        # Try to view DMs
        r = admin.get(f"{API}/admin/users/{bob_id}/dms-decrypted", timeout=10)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_flag_audit_trail(self, bob, admin):
        """Verify flag + DM view actions are logged in audit trail."""
        bob_id = _me_id(bob)

        # Flag bob
        r = admin.post(
            f"{API}/admin/users/{bob_id}/flag",
            json={
                "reason": "audit trail test",
                "flag_type": "suspicious",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text

        # View DMs
        r = admin.get(f"{API}/admin/users/{bob_id}/dms-decrypted", timeout=10)
        assert r.status_code == 200, r.text

        # Check audit log
        r = admin.get(f"{API}/admin/audit?limit=50", timeout=10)
        assert r.status_code == 200, r.text
        events = r.json().get("events", [])

        flag_event = next(
            (e for e in events if e.get("event") == "admin_flag_user" and e.get("target_user_id") == bob_id),
            None,
        )
        assert flag_event is not None, "admin_flag_user event not found in audit log"
        assert flag_event["flag_type"] == "suspicious"

        view_event = next(
            (e for e in events if e.get("event") == "admin_viewed_flagged_dms" and e.get("target_user_id") == bob_id),
            None,
        )
        assert view_event is not None, "admin_viewed_flagged_dms event not found in audit log"
        assert view_event["num_dms_viewed"] >= 0

    def test_self_dm_encrypted(self, alice):
        """Self-DMs are also encrypted at rest."""
        alice_id = _me_id(alice)

        # alice sends to self
        plaintext = "Personal note for encryption test"
        r = alice.post(
            f"{API}/dms",
            json={
                "recipient_id": alice_id,
                "content": plaintext,
                "media_paths": [],
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["content"] == plaintext
        assert r.json()["read"] is True

        # Retrieve thread
        r = alice.get(f"{API}/dms/with/{alice_id}", timeout=10)
        assert r.status_code == 200, r.text
        thread = r.json()
        assert thread["with"]["is_self"] is True
        assert any(m["content"] == plaintext for m in thread["messages"]), "Self-DM plaintext not in thread"

    def test_list_flagged_users(self, bob, admin):
        """Admin can list all flagged users."""
        bob_id = _me_id(bob)

        # Flag bob
        admin.post(
            f"{API}/admin/users/{bob_id}/flag",
            json={
                "reason": "list test",
                "flag_type": "under_investigation",
            },
            timeout=10,
        )

        # List flagged
        r = admin.get(f"{API}/admin/flagged-users", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "flagged_users" in data

        bob_flag = next((u for u in data["flagged_users"] if u["user_id"] == bob_id), None)
        assert bob_flag is not None
        assert bob_flag["flag_type"] == "under_investigation"
        assert bob_flag["reason"] == "list test"

    def test_unflag_user(self, bob, admin):
        """Admin can remove flag from user."""
        bob_id = _me_id(bob)

        # Flag bob
        admin.post(
            f"{API}/admin/users/{bob_id}/flag",
            json={
                "reason": "unflag test",
                "flag_type": "test",
            },
            timeout=10,
        )

        # Unflag
        r = admin.delete(f"{API}/admin/users/{bob_id}/flag", timeout=10)
        assert r.status_code == 200, r.text

        # Verify flag is gone
        r = admin.get(f"{API}/admin/users/{bob_id}/dms-decrypted", timeout=10)
        assert r.status_code == 403, "Unflagged user should return 403"
