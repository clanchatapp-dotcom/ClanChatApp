"""
Iteration 11 — DM Media attachments + Searchable thread support backend tests.

Covers:
- POST /api/upload returns {path}
- POST /api/dms accepts media-only (no text), text-only, text+media combos.
- Empty (no content and no media) -> 400 with specific error message.
- Server caps media to 4 per message (or rejects >4 with 422).
- Regular bob->alice DM with media (with permission gating).
- Group chat send/receive unaffected.
- Self-DM with media still works.
"""

import io
import os
import re
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@clanchat.app", "password": "Password123!"}
BOB = {"email": "bob@clanchat.app", "password": "Password123!"}


def _login(s, creds):
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    me = s.get(f"{API}/auth/me", timeout=30).json()
    return me


@pytest.fixture(scope="module")
def alice_session():
    s = requests.Session()
    me = _login(s, ALICE)
    return s, me


@pytest.fixture(scope="module")
def bob_session():
    s = requests.Session()
    me = _login(s, BOB)
    return s, me


def _make_png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (255, 128, 0)).save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _upload(session, filename="test.png", content_type="image/png", data=None):
    if data is None:
        data = _make_png_bytes()
    files = {"file": (filename, data, content_type)}
    r = session.post(f"{API}/upload", files=files, timeout=60)
    assert r.status_code == 200, f"upload failed {r.status_code} {r.text}"
    body = r.json()
    assert "path" in body and body["path"], f"upload missing path: {body}"
    return body["path"]


# ---------------- 1. media-only DM ----------------

def test_send_media_only_self_dm(alice_session):
    s, alice = alice_session
    path = _upload(s)
    r = s.post(f"{API}/dms", json={
        "recipient_id": alice["user_id"], "content": "", "media_paths": [path]
    }, timeout=30)
    assert r.status_code == 200, f"media-only DM rejected: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("content") == ""
    assert body.get("media_paths") == [path], body

    # Verify via history
    h = s.get(f"{API}/dms/with/{alice['user_id']}", timeout=30).json()
    msgs = h.get("messages", []) if isinstance(h, dict) else h
    assert any(m.get("message_id") == body["message_id"] and m.get("media_paths") == [path] for m in msgs), \
        f"message not in history with media: {msgs[-3:]}"


# ---------------- 2. text + media ----------------

def test_send_text_plus_media(alice_session):
    s, alice = alice_session
    path = _upload(s)
    r = s.post(f"{API}/dms", json={
        "recipient_id": alice["user_id"], "content": "a photo!", "media_paths": [path]
    }, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content"] == "a photo!"
    assert body["media_paths"] == [path]


# ---------------- 3. empty rejected ----------------

def test_empty_message_rejected(alice_session):
    s, alice = alice_session
    r = s.post(f"{API}/dms", json={
        "recipient_id": alice["user_id"], "content": "", "media_paths": []
    }, timeout=30)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
    body = r.json()
    detail = body.get("detail") or body.get("message") or ""
    assert "empty" in str(detail).lower(), f"unexpected error msg: {detail}"
    assert "add text or attach media" in str(detail).lower(), f"missing guidance text: {detail}"


# ---------------- 4. media cap of 4 ----------------

def test_media_cap_of_four(alice_session):
    """
    Spec says: POSTing 5 media_paths -> response.media_paths length is exactly 4 (server-side [:4]).
    Note: DMIn has Field(max_length=4) which under pydantic v2 will REJECT >4 with 422
    before reaching the slice. We test both behaviours - either truncate-to-4 OR a clean
    422 are acceptable; failure is "stored 5".
    """
    s, alice = alice_session
    paths = [_upload(s, filename=f"cap{i}.png") for i in range(5)]
    r = s.post(f"{API}/dms", json={
        "recipient_id": alice["user_id"], "content": "many", "media_paths": paths
    }, timeout=60)
    if r.status_code == 200:
        body = r.json()
        assert len(body["media_paths"]) == 4, f"expected cap=4, got {len(body['media_paths'])}"
    else:
        # Pydantic rejection is also acceptable behaviour for cap enforcement
        assert r.status_code in (400, 422), f"unexpected status {r.status_code}: {r.text}"


# ---------------- 5. regular bob -> alice with media ----------------

def test_bob_to_alice_dm_with_media(alice_session, bob_session):
    sa, alice = alice_session
    sb, bob = bob_session

    # Ensure bob follows alice
    sb.post(f"{API}/follow/{alice['user_id']}", timeout=30)
    # Ensure alice has dms_enabled_followers=true
    sa.put(f"{API}/settings", json={"dms_enabled_followers": True}, timeout=30)

    path = _upload(sb, filename="bob.png")
    r = sb.post(f"{API}/dms", json={
        "recipient_id": alice["user_id"], "content": "check this", "media_paths": [path]
    }, timeout=30)
    assert r.status_code == 200, f"bob->alice DM with media failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["media_paths"] == [path]

    # Alice can see it
    h = sa.get(f"{API}/dms/with/{bob['user_id']}", timeout=30).json()
    msgs = h.get("messages", []) if isinstance(h, dict) else h
    assert any(m.get("message_id") == body["message_id"] and m.get("media_paths") == [path] for m in msgs)


def test_dm_unknown_recipient_404(alice_session):
    sa, _ = alice_session
    r = sa.post(f"{API}/dms", json={
        "recipient_id": "user_doesnotexistxxx", "content": "hi", "media_paths": []
    }, timeout=30)
    assert r.status_code == 404, f"expected 404 for unknown recipient, got {r.status_code} {r.text}"


# ---------------- 6. group chats unaffected ----------------

def test_group_chats_unaffected(alice_session):
    """Owner-only group send + read still works. /api/dms changes shouldn't touch /api/groups."""
    sa, alice = alice_session
    # Solo group (alice only, auto-accepted as owner)
    r = sa.post(f"{API}/groups", json={"name": "TEST_iter11_grp", "member_ids": []}, timeout=30)
    assert r.status_code in (200, 201), r.text
    grp = r.json()
    gid = grp.get("group_id") or grp.get("id")
    assert gid

    # alice sends a text message
    r = sa.post(f"{API}/groups/{gid}/messages", json={"content": "hello group iter11"}, timeout=30)
    assert r.status_code == 200, f"group msg failed: {r.text}"

    # alice can read it back
    r = sa.get(f"{API}/groups/{gid}/messages", timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    msgs = body.get("messages", []) if isinstance(body, dict) else body
    assert any(m.get("content") == "hello group iter11" for m in msgs)

    # Empty content rejected (group msg validation untouched)
    r = sa.post(f"{API}/groups/{gid}/messages", json={"content": ""}, timeout=30)
    assert r.status_code in (400, 422), f"empty group msg should fail, got {r.status_code}"
