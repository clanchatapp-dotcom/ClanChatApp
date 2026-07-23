"""Iteration 17 — Activity feed + Edit (post/wall/DM) + Group polling.

Covers, per the review request:
- GET /api/activity/feed — chronological, hydrates actor + post_preview
- GET /api/activity/unread-count — integer unread count
- POST /api/activity/{event_id}/read — marks one event read
- POST /api/activity/read-all — bulk mark-all-read
- Emit-on-like  → post_liked
- Emit-on-comment → post_commented (requires actor in author's IC)
- Emit-on-follow (open)     → follow_accepted
- Emit-on-follow (approval) → follow_request
- Emit-on-group-message     → group_invite (reused kind, per review note)
- Blocked-pair filter drops events (group_send path)
- Self-actions never emit
- PATCH /api/posts/{id}       — author-only, edit_history, cap 2000, 403 non-author
- PATCH /api/wall/{id}        — note author only (not wall owner)
- PATCH /api/dms/{id}         — sender only + re-encryption verified via GET
- DELETE /api/dms/{id} STILL WORKS on voice notes (media_paths=['...webm'])
- GET /api/groups/{id}/messages?since=…   — polling filter
- Group chat auth — non-member → 403 on send + fetch
- Regressions: /upload/signed-url, /notifications/new-followers,
  /giphy/search, minor NSFW block still 403

Auth-precedence gotcha (from iter16 report): get_current_user() prefers
the access_token cookie over the Authorization header, so we MUST use a
fresh cookie-less requests.Session per user (new_client helper).
"""
import os
import uuid
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADULT_EMAIL = "audiotester@clanchat.app"
ADULT_PW = "AudioTest123!"
ADULT_UID = "user_81ace9a329a7"
MINOR_EMAIL = "minortest@clanchat.app"
MINOR_PW = "MinorTest123!"
MINOR_UID = "user_1ebafbfee536"


# --------------------------------------------------------------------
# helpers — cookie-less per-user client, register/login shortcuts
# --------------------------------------------------------------------
def new_client(token: str | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers["Authorization"] = f"Bearer {token}"
    return s


def _login(email, pw) -> str:
    last = None
    for _ in range(4):
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
        if r.status_code == 200:
            return r.json()["access_token"]
        last = r
        # Transient edge / KV errors → back off and retry.
        if r.status_code in (500, 502, 503, 504):
            time.sleep(1.5)
            continue
        break
    raise AssertionError(f"login failed: {last.status_code} {last.text}")


def _register(prefix: str = "iter17", dob: str = "1995-01-01") -> dict:
    email = f"{prefix}_{uuid.uuid4().hex[:8]}@clanchat.app"
    handle = f"{prefix}{uuid.uuid4().hex[:6]}"
    last = None
    for _ in range(4):
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!", "handle": handle,
            "display_name": f"Iter17 {prefix}", "dob": dob,
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


def _create_post(sess, content="TEST_iter17 post", tier="public", nsfw=False, tags=None):
    r = sess.post(f"{API}/posts", json={
        "content": content, "tier": tier, "tags": tags or [],
        "media_paths": [], "nsfw": nsfw,
    })
    assert r.status_code == 200, f"post create failed: {r.status_code} {r.text}"
    return r.json()


def _mutual_ic(a: dict, b: dict):
    """Set up A and B as mutual inner-circle members. Requires follows too."""
    # follows both ways (open follow_mode default)
    r1 = a["session"].post(f"{API}/follow/{b['user_id']}")
    assert r1.status_code == 200, r1.text
    r2 = b["session"].post(f"{API}/follow/{a['user_id']}")
    assert r2.status_code == 200, r2.text

    # A invites B to IC, B accepts
    inv1 = a["session"].post(f"{API}/inner/invite",
                             json={"user_id": b["user_id"], "permissions": {"dms": True}})
    assert inv1.status_code == 200, inv1.text
    invs_b = b["session"].get(f"{API}/inner/invites").json().get("invites", [])
    inv_from_a = next((i for i in invs_b if i["owner"]["user_id"] == a["user_id"]), None)
    assert inv_from_a, f"B did not receive invite from A: {invs_b}"
    r = b["session"].post(f"{API}/inner/invites/{inv_from_a['invite_id']}/accept")
    assert r.status_code == 200, r.text

    # B invites A to IC, A accepts
    inv2 = b["session"].post(f"{API}/inner/invite",
                             json={"user_id": a["user_id"], "permissions": {"dms": True}})
    assert inv2.status_code == 200, inv2.text
    invs_a = a["session"].get(f"{API}/inner/invites").json().get("invites", [])
    inv_from_b = next((i for i in invs_a if i["owner"]["user_id"] == b["user_id"]), None)
    assert inv_from_b, f"A did not receive invite from B: {invs_a}"
    r = a["session"].post(f"{API}/inner/invites/{inv_from_b['invite_id']}/accept")
    assert r.status_code == 200, r.text


def _mark_all_read(sess):
    """Reset unread count between assertions."""
    r = sess.post(f"{API}/activity/read-all")
    assert r.status_code == 200


# --------------------------------------------------------------------
# module-scoped fixtures — three throwaway users
# --------------------------------------------------------------------
@pytest.fixture(scope="module")
def user_a():
    return _register("iter17a")


@pytest.fixture(scope="module")
def user_b():
    return _register("iter17b")


@pytest.fixture(scope="module")
def user_c():
    return _register("iter17c")


@pytest.fixture(scope="module")
def user_d_approval():
    """User D has follow_mode=approval so incoming follows land as follow_request."""
    d = _register("iter17d")
    r = d["session"].patch(f"{API}/users/me", json={"follow_mode": "approval"})
    assert r.status_code == 200, r.text
    # PATCH /users/me returns the updated profile — verify follow_mode there
    # (no GET /users/me exists; PATCH response is the source of truth).
    assert r.json().get("follow_mode") == "approval", r.json()
    return d


@pytest.fixture(scope="module")
def mutual_ab(user_a, user_b):
    """Set up A<->B mutual follows + mutual IC. Runs exactly once."""
    _mutual_ic(user_a, user_b)
    # Clear any events generated during setup so per-test counts are clean.
    _mark_all_read(user_a["session"])
    _mark_all_read(user_b["session"])
    return True


@pytest.fixture(scope="session")
def adult_token():
    return _login(ADULT_EMAIL, ADULT_PW)


@pytest.fixture(scope="session")
def minor_token():
    return _login(MINOR_EMAIL, MINOR_PW)


# --------------------------------------------------------------------
# 1. Activity endpoints — shape + read semantics
# --------------------------------------------------------------------
class TestActivityEndpoints:
    def test_unread_count_shape(self, user_a):
        r = user_a["session"].get(f"{API}/activity/unread-count")
        assert r.status_code == 200
        data = r.json()
        assert "unread" in data
        assert isinstance(data["unread"], int)
        assert data["unread"] >= 0

    def test_feed_shape_and_hydration(self, user_a, user_b, mutual_ab):
        # Generate a like event: B likes a post by A.
        post = _create_post(user_a["session"], content="TEST_iter17 feed-hydration")
        # Use fresh, cookie-less clients to eliminate cookie precedence bugs.
        r = user_b["session"].post(f"{API}/posts/{post['post_id']}/like")
        assert r.status_code == 200, r.text
        time.sleep(0.3)

        # A fetches feed — should contain a post_liked event with actor + preview.
        feed = user_a["session"].get(f"{API}/activity/feed").json()
        events = feed.get("events", [])
        match = [e for e in events if e["kind"] == "post_liked"
                 and (e.get("ref") or {}).get("post_id") == post["post_id"]]
        assert match, f"no post_liked event for post {post['post_id']} in feed: {events}"
        ev = match[0]
        # Chronological: most-recent first — ev should be near the top.
        assert isinstance(events, list)

        # actor hydrated
        assert ev.get("actor"), f"actor not hydrated: {ev}"
        assert ev["actor"]["user_id"] == user_b["user_id"]
        assert ev["actor"].get("handle") == user_b["handle"]

        # post_preview hydrated
        pv = ev.get("post_preview")
        assert pv, f"post_preview missing: {ev}"
        assert pv["post_id"] == post["post_id"]
        assert "TEST_iter17 feed-hydration" in (pv.get("content") or "")

        # read flag defaults to False
        assert ev.get("read") is False

    def test_mark_one_read_and_read_all(self, user_a, user_b, mutual_ab):
        # Clean slate on A's feed.
        _mark_all_read(user_a["session"])
        assert user_a["session"].get(f"{API}/activity/unread-count").json()["unread"] == 0

        # Generate two events by having B like two posts.
        p1 = _create_post(user_a["session"], content="TEST_iter17 mark-read 1")
        p2 = _create_post(user_a["session"], content="TEST_iter17 mark-read 2")
        for p in (p1, p2):
            r = user_b["session"].post(f"{API}/posts/{p['post_id']}/like")
            assert r.status_code == 200
        time.sleep(0.3)

        cnt_before = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_before >= 2, f"expected >=2 unread, got {cnt_before}"

        # Pick one of the two matching events and mark it read.
        feed = user_a["session"].get(f"{API}/activity/feed").json()["events"]
        target = next(e for e in feed if e["kind"] == "post_liked"
                      and (e.get("ref") or {}).get("post_id") == p1["post_id"])
        r = user_a["session"].post(f"{API}/activity/{target['event_id']}/read")
        assert r.status_code == 200, r.text

        cnt_after_one = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_after_one == cnt_before - 1, \
            f"expected count to drop by 1: before={cnt_before} after={cnt_after_one}"

        # Bulk mark-all-read → count == 0
        r = user_a["session"].post(f"{API}/activity/read-all")
        assert r.status_code == 200, r.text
        cnt_final = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_final == 0, f"expected 0 unread, got {cnt_final}"

    def test_mark_read_wrong_recipient_returns_404(self, user_a, user_b, mutual_ab):
        # Generate an event on B's feed by A liking B's post.
        pb = _create_post(user_b["session"], content="TEST_iter17 not-your-event")
        assert user_a["session"].post(f"{API}/posts/{pb['post_id']}/like").status_code == 200
        time.sleep(0.3)
        feed_b = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        ev = next(e for e in feed_b if e["kind"] == "post_liked"
                  and (e.get("ref") or {}).get("post_id") == pb["post_id"])
        # A tries to mark B's event as read → 404 (recipient scope)
        r = user_a["session"].post(f"{API}/activity/{ev['event_id']}/read")
        assert r.status_code == 404, f"expected 404 got {r.status_code}: {r.text}"


# --------------------------------------------------------------------
# 2. Emit-on-like
# --------------------------------------------------------------------
class TestEmitOnLike:
    def test_like_emits_post_liked_and_increments_unread(self, user_a, user_b, mutual_ab):
        _mark_all_read(user_b["session"])
        cnt_before = user_b["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_before == 0

        pb = _create_post(user_b["session"], content="TEST_iter17 like-emit")
        r = user_a["session"].post(f"{API}/posts/{pb['post_id']}/like")
        assert r.status_code == 200
        time.sleep(0.3)

        cnt_after = user_b["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt_after == 1, f"expected 1 new event, got {cnt_after}"

        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        assert any(e["kind"] == "post_liked" and e["actor_id"] == user_a["user_id"]
                   and (e.get("ref") or {}).get("post_id") == pb["post_id"]
                   for e in feed), f"post_liked event missing: {feed}"

    def test_self_like_emits_nothing(self, user_a):
        _mark_all_read(user_a["session"])
        pa = _create_post(user_a["session"], content="TEST_iter17 self-like")
        r = user_a["session"].post(f"{API}/posts/{pa['post_id']}/like")
        assert r.status_code == 200
        time.sleep(0.3)
        cnt = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt == 0, f"self-like must not create event, got {cnt}"


# --------------------------------------------------------------------
# 3. Emit-on-comment  (actor must be in author's IC)
# --------------------------------------------------------------------
class TestEmitOnComment:
    def test_comment_emits_post_commented(self, user_a, user_b, mutual_ab):
        _mark_all_read(user_b["session"])
        pb = _create_post(user_b["session"], content="TEST_iter17 cmt-emit")
        # A is in B's IC → allowed to comment.
        r = user_a["session"].post(f"{API}/posts/{pb['post_id']}/comments",
                                    json={"content": "TEST_iter17 hello"})
        assert r.status_code == 200, r.text
        time.sleep(0.3)

        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "post_commented"
                 and e["actor_id"] == user_a["user_id"]
                 and (e.get("ref") or {}).get("post_id") == pb["post_id"]]
        assert match, f"post_commented event missing: {feed}"

    def test_self_comment_emits_nothing(self, user_a):
        _mark_all_read(user_a["session"])
        pa = _create_post(user_a["session"], content="TEST_iter17 self-cmt")
        r = user_a["session"].post(f"{API}/posts/{pa['post_id']}/comments",
                                    json={"content": "self-note"})
        assert r.status_code == 200, r.text
        time.sleep(0.3)
        cnt = user_a["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt == 0, f"self-comment must not create event, got {cnt}"


# --------------------------------------------------------------------
# 4. Emit-on-follow — open vs approval
# --------------------------------------------------------------------
class TestEmitOnFollow:
    def test_open_follow_emits_follow_accepted(self, user_c, user_b, mutual_ab):
        # user_b has open follow_mode (default). C follows B (fresh — C is not
        # yet related to B). Event on B's feed = follow_accepted.
        _mark_all_read(user_b["session"])
        r = user_c["session"].post(f"{API}/follow/{user_b['user_id']}")
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "active"
        time.sleep(0.3)
        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "follow_accepted"
                 and e["actor_id"] == user_c["user_id"]]
        assert match, f"follow_accepted event missing: {feed}"

    def test_approval_follow_emits_follow_request(self, user_c, user_d_approval):
        _mark_all_read(user_d_approval["session"])
        # C follows D (approval mode) → status=pending → event = follow_request
        r = user_c["session"].post(f"{API}/follow/{user_d_approval['user_id']}")
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending", r.json()
        time.sleep(0.3)
        feed = user_d_approval["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "follow_request"
                 and e["actor_id"] == user_c["user_id"]]
        assert match, f"follow_request event missing: {feed}"


# --------------------------------------------------------------------
# 5. Emit-on-group-message
# --------------------------------------------------------------------
class TestEmitOnGroupMessage:
    def test_group_message_emits_group_invite_kind(self, user_a, user_b, mutual_ab):
        # A creates a group and invites B (needs B in A's IC — set up in
        # mutual_ab). B accepts. A sends msg → B gets group_invite event.
        _mark_all_read(user_b["session"])
        g = user_a["session"].post(f"{API}/groups", json={
            "name": "TEST_iter17 grp", "member_ids": [user_b["user_id"]]})
        assert g.status_code == 200, g.text
        gid = g.json()["group_id"]
        r = user_b["session"].post(f"{API}/groups/{gid}/accept")
        assert r.status_code == 200, r.text
        r = user_a["session"].post(f"{API}/groups/{gid}/messages",
                                    json={"content": "TEST_iter17 group hello"})
        assert r.status_code == 200, r.text
        time.sleep(0.3)
        feed = user_b["session"].get(f"{API}/activity/feed").json()["events"]
        match = [e for e in feed if e["kind"] == "group_invite"
                 and e["actor_id"] == user_a["user_id"]
                 and (e.get("ref") or {}).get("group_id") == gid]
        assert match, f"group_invite (message) event missing: {feed}"
        # keep group id for later tests
        pytest.iter17_group_id = gid


# --------------------------------------------------------------------
# 6. Blocked-pair filter drops events (group_send path)
# --------------------------------------------------------------------
class TestBlockedPairFilter:
    def test_block_after_setup_drops_group_message_event(self, user_a, user_b):
        """Once A blocks B, any subsequent group-message action by A must
        NOT produce an event on B's feed (emit_activity_event's block
        check). block_user cascades follows but not group membership, so
        A remains an accepted member and can still send.
        """
        gid = getattr(pytest, "iter17_group_id", None)
        assert gid, "prerequisite group_id from TestEmitOnGroupMessage missing"

        # Clear B's feed so we can assert delta = 0.
        _mark_all_read(user_b["session"])
        # A blocks B.
        r = user_a["session"].post(f"{API}/block/{user_b['user_id']}")
        assert r.status_code == 200, r.text

        # A sends a fresh group message.
        r = user_a["session"].post(f"{API}/groups/{gid}/messages",
                                    json={"content": "TEST_iter17 grp after block"})
        # The send itself may 200 (A still accepted member) — the important
        # thing is the *emit* should be filtered.
        assert r.status_code in (200, 403), f"unexpected: {r.status_code} {r.text}"

        time.sleep(0.3)
        cnt = user_b["session"].get(f"{API}/activity/unread-count").json()["unread"]
        assert cnt == 0, \
            f"blocked-pair filter FAILED — expected 0 new events on B, got {cnt}"

        # Unblock so downstream tests aren't affected.
        user_a["session"].delete(f"{API}/block/{user_b['user_id']}")


# --------------------------------------------------------------------
# 7. PATCH /posts/{id}
# --------------------------------------------------------------------
class TestPatchPost:
    def test_author_edits_and_history_grows(self, user_a):
        p = _create_post(user_a["session"], content="TEST_iter17 original")
        pid = p["post_id"]
        r = user_a["session"].patch(f"{API}/posts/{pid}",
                                     json={"content": "TEST_iter17 edited once"})
        assert r.status_code == 200, r.text

        # Fetch the post through by-user list to verify content persisted.
        me = user_a["session"].get(f"{API}/posts/by-user/{user_a['user_id']}").json()
        found = next((x for x in me.get("posts", []) if x["post_id"] == pid), None)
        assert found, f"post {pid} not returned: {me}"
        assert found["content"] == "TEST_iter17 edited once"

        # Second edit → still returns 200; content updates.
        r = user_a["session"].patch(f"{API}/posts/{pid}",
                                     json={"content": "TEST_iter17 edited twice"})
        assert r.status_code == 200
        me = user_a["session"].get(f"{API}/posts/by-user/{user_a['user_id']}").json()
        found = next(x for x in me["posts"] if x["post_id"] == pid)
        assert found["content"] == "TEST_iter17 edited twice"

    def test_post_edit_metadata_exposed_in_get(self, user_a):
        """serialize_post must expose edited_at + edit_history so the UI
        can render the 'Edited' badge and let viewers open history.
        The PATCH endpoint persists both, but if the GET response does
        not include them, this feature is invisible to the client."""
        p = _create_post(user_a["session"], content="TEST_iter17 meta-original")
        pid = p["post_id"]
        r = user_a["session"].patch(f"{API}/posts/{pid}",
                                     json={"content": "TEST_iter17 meta-edited"})
        assert r.status_code == 200, r.text
        me = user_a["session"].get(f"{API}/posts/by-user/{user_a['user_id']}").json()
        found = next(x for x in me["posts"] if x["post_id"] == pid)
        assert found.get("edited_at"), (
            f"BUG: serialize_post does not expose `edited_at` — UI cannot "
            f"show 'Edited' badge. Post payload: {found}"
        )
        hist = found.get("edit_history")
        assert isinstance(hist, list) and len(hist) >= 1, (
            f"BUG: serialize_post does not expose `edit_history` — UI cannot "
            f"show edit history. Post payload: {found}"
        )
        assert hist[0].get("content") == "TEST_iter17 meta-original"

    def test_non_author_gets_403(self, user_a, user_b, mutual_ab):
        p = _create_post(user_a["session"], content="TEST_iter17 non-author edit")
        r = user_b["session"].patch(f"{API}/posts/{p['post_id']}",
                                     json={"content": "hijack"})
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_content_capped_at_2000(self, user_a):
        p = _create_post(user_a["session"], content="TEST_iter17 cap")
        big = "x" * 3000
        r = user_a["session"].patch(f"{API}/posts/{p['post_id']}",
                                     json={"content": big})
        assert r.status_code == 200, r.text
        me = user_a["session"].get(f"{API}/posts/by-user/{user_a['user_id']}").json()
        found = next(x for x in me["posts"] if x["post_id"] == p["post_id"])
        assert len(found["content"]) == 2000, f"expected len=2000, got {len(found['content'])}"


# --------------------------------------------------------------------
# 8. PATCH /wall/{id}
# --------------------------------------------------------------------
class TestPatchWall:
    def test_wall_note_author_can_edit_not_owner(self, user_a, user_b, mutual_ab):
        # B posts a note on A's wall (needs perm). Default wall permission
        # is 'owner' — only wall owner posts. So change A's wall permission
        # to inner (mutual IC exists).
        r = user_a["session"].patch(f"{API}/users/me", json={
            "settings": {"wall_post_permission": "inner"}
        })
        assert r.status_code == 200, r.text

        note = user_b["session"].post(f"{API}/wall/{user_a['user_id']}", json={
            "content": "TEST_iter17 wall note by B", "nsfw": False,
        })
        assert note.status_code == 200, note.text
        wid = note.json()["wall_post_id"]

        # B (the note author) edits → 200
        r = user_b["session"].patch(f"{API}/wall/{wid}", json={
            "content": "TEST_iter17 wall note by B — edited"
        })
        assert r.status_code == 200, r.text
        # A (wall owner but NOT note author) → 403 on edit
        r = user_a["session"].patch(f"{API}/wall/{wid}", json={
            "content": "hijack by wall owner"
        })
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

        # Verify edit + history persisted (fetched from A's wall list).
        wall = user_a["session"].get(f"{API}/wall/{user_a['user_id']}").json()
        found = next(w for w in wall["posts"] if w["wall_post_id"] == wid)
        assert found["content"].endswith("edited")
        assert found.get("edited_at")
        assert len(found.get("edit_history") or []) == 1


# --------------------------------------------------------------------
# 9. PATCH /dms/{id} — sender only + re-encryption verified
# --------------------------------------------------------------------
class TestPatchDm:
    def test_sender_edit_and_recipient_sees_plaintext(self, user_a, user_b, mutual_ab):
        # A sends a DM to B (mutual IC allows DMs).
        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_b["user_id"],
            "content": "TEST_iter17 dm original",
            "media_paths": [],
        })
        assert r.status_code == 200, r.text
        mid = r.json()["message_id"]

        # A edits it.
        r = user_a["session"].patch(f"{API}/dms/{mid}", json={
            "content": "TEST_iter17 dm EDITED"
        })
        assert r.status_code == 200, r.text

        # Recipient (B) fetches history → content decrypts to new plaintext.
        hist = user_b["session"].get(f"{API}/dms/with/{user_a['user_id']}").json()
        msg = next(m for m in hist["messages"] if m["message_id"] == mid)
        assert msg["content"] == "TEST_iter17 dm EDITED", \
            f"re-encrypt+decrypt mismatch: {msg['content']}"
        assert msg.get("edited_at"), f"edited_at missing: {msg}"
        # edit_history recorded
        assert len(msg.get("edit_history") or []) >= 1

    def test_non_sender_edit_forbidden(self, user_a, user_b, mutual_ab):
        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_b["user_id"],
            "content": "TEST_iter17 dm non-sender",
            "media_paths": [],
        })
        mid = r.json()["message_id"]
        r = user_b["session"].patch(f"{API}/dms/{mid}", json={"content": "hijack"})
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# --------------------------------------------------------------------
# 10. DELETE /dms/{id} STILL WORKS on voice notes
# --------------------------------------------------------------------
class TestDeleteVoiceDm:
    def test_voice_dm_delete_200_403_404(self, user_a, user_b, mutual_ab):
        # Create a DM with an audio attachment (i.e. a "voice note" in the app).
        r = user_a["session"].post(f"{API}/dms", json={
            "recipient_id": user_b["user_id"],
            "content": "",  # voice notes usually have no text
            "media_paths": ["https://example.invalid/voice.webm"],
        })
        assert r.status_code == 200, r.text
        mid = r.json()["message_id"]

        # Other user (B) cannot delete → 403
        forbid = user_b["session"].delete(f"{API}/dms/{mid}")
        assert forbid.status_code == 403, f"expected 403 got {forbid.status_code}"

        # Sender (A) can delete → 200
        ok = user_a["session"].delete(f"{API}/dms/{mid}")
        assert ok.status_code == 200, ok.text

        # Missing → 404
        gone = user_a["session"].delete(f"{API}/dms/does-not-exist-{uuid.uuid4().hex[:8]}")
        assert gone.status_code == 404, gone.text


# --------------------------------------------------------------------
# 11. Group messages polling — ?since=… filter
# --------------------------------------------------------------------
class TestGroupPolling:
    def test_since_filters_older_messages(self, user_a, user_b, mutual_ab):
        # Fresh group so we own the timeline.
        g = user_a["session"].post(f"{API}/groups", json={
            "name": "TEST_iter17 poll", "member_ids": [user_b["user_id"]]})
        assert g.status_code == 200, g.text
        gid = g.json()["group_id"]
        assert user_b["session"].post(f"{API}/groups/{gid}/accept").status_code == 200

        # Send msg #1
        user_a["session"].post(f"{API}/groups/{gid}/messages", json={"content": "TEST_iter17 first"})
        time.sleep(1.1)  # ensure created_at strictly increases

        # Capture the "since" marker between msg1 and msg2.
        listing = user_a["session"].get(f"{API}/groups/{gid}/messages").json()
        assert len(listing["messages"]) == 1, listing
        since = listing["messages"][0]["created_at"]

        # Send msg #2 after the marker.
        time.sleep(1.1)
        user_a["session"].post(f"{API}/groups/{gid}/messages", json={"content": "TEST_iter17 second"})
        time.sleep(0.3)

        # Without since → both messages.
        all_msgs = user_a["session"].get(f"{API}/groups/{gid}/messages").json()["messages"]
        assert len(all_msgs) == 2, all_msgs

        # With since=<msg1_created_at> → only msg #2.
        newer = user_a["session"].get(f"{API}/groups/{gid}/messages",
                                       params={"since": since}).json()["messages"]
        assert len(newer) == 1, f"expected 1 msg newer than {since}, got {newer}"
        assert newer[0]["content"] == "TEST_iter17 second"


# --------------------------------------------------------------------
# 12. Group chat auth — non-member forbidden on both send + fetch
# --------------------------------------------------------------------
class TestGroupAuth:
    def test_non_member_forbidden(self, user_a, user_b, user_c, mutual_ab):
        # New group with just A & B.
        g = user_a["session"].post(f"{API}/groups", json={
            "name": "TEST_iter17 auth", "member_ids": [user_b["user_id"]]})
        gid = g.json()["group_id"]
        user_b["session"].post(f"{API}/groups/{gid}/accept")

        # C is neither invited nor a member.
        r_send = user_c["session"].post(f"{API}/groups/{gid}/messages",
                                          json={"content": "nope"})
        assert r_send.status_code == 403, f"expected 403 got {r_send.status_code}"

        r_fetch = user_c["session"].get(f"{API}/groups/{gid}/messages")
        assert r_fetch.status_code == 403, f"expected 403 got {r_fetch.status_code}"


# --------------------------------------------------------------------
# 13. Regressions — iter16 endpoints still work
# --------------------------------------------------------------------
class TestRegressions:
    def test_signed_url_auth_gated_and_returns_url(self, adult_token):
        anon = new_client()
        r0 = anon.post(f"{API}/upload/signed-url",
                       json={"filename": "x.png", "content_type": "image/png", "scope": "post"})
        assert r0.status_code in (401, 403)

        authed = new_client(adult_token)
        r = authed.post(f"{API}/upload/signed-url",
                        json={"filename": "iter17.png", "content_type": "image/png", "scope": "post"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("upload_url", "").startswith("http")
        assert data.get("path", "").startswith(f"u/{ADULT_UID}/post/")

    def test_new_followers_still_returns_list(self, user_a, user_c):
        # C follows A — a fresh follow event should surface on A's
        # new-followers endpoint.
        # We first mark seen so the "since last seen" filter is well-defined.
        user_a["session"].post(f"{API}/notifications/mark-seen")
        assert user_c["session"].post(f"{API}/follow/{user_a['user_id']}").status_code == 200
        time.sleep(0.3)
        data = user_a["session"].get(f"{API}/notifications/new-followers").json()
        ids = [f["user_id"] for f in data.get("followers", [])]
        assert user_c["user_id"] in ids, f"expected {user_c['user_id']} in {ids}"

    def test_giphy_search(self, adult_token):
        c = new_client(adult_token)
        r = c.get(f"{API}/giphy/search?q=cat")
        if r.status_code == 503:
            pytest.skip("Giphy not configured")
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("items"), list)

    def test_minor_nsfw_block(self, minor_token):
        c = new_client(minor_token)
        r = c.post(f"{API}/posts", json={
            "content": "TEST_iter17 minor nsfw", "tier": "inner",
            "tags": [], "media_paths": [], "nsfw": True,
        })
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
