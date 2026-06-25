"""
Iteration 8 backend tests:
- CSAM report -> immediate quarantine + audit + queue
- Quarantine enforcement on feed and profile feeds
- Admin CSAM endpoints (queue/clear/confirm)
- Trending tags

Uses cookie-based session auth via requests.Session.
"""
import os
import time
import uuid
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://private-posts-11.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")
ADMIN = ("admin@clanchat.app", "admin123")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def login_session(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def me(session):
    r = session.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def alice():
    return login_session(*ALICE)


@pytest.fixture(scope="module")
def bob():
    return login_session(*BOB)


@pytest.fixture(scope="module")
def admin():
    return login_session(*ADMIN)


@pytest.fixture(scope="module")
def alice_id(alice):
    return me(alice)["user_id"]


@pytest.fixture(scope="module")
def alice_posts(alice):
    """Create 2 alice posts to use as report targets."""
    posts = []
    for i in range(2):
        r = alice.post(f"{API}/posts", json={
            "content": f"alice csam-test target post {i} {uuid.uuid4().hex[:6]}",
            "tier": "public",
            "tags": [],
        }, timeout=15)
        assert r.status_code == 200, r.text
        posts.append(r.json())
    return posts


# ---------- Auth + smoke ----------
class TestAuthSmoke:
    def test_alice_login(self, alice):
        u = me(alice)
        assert u["email"] == "alice@clanchat.app"
        assert u["handle"] == "alice"

    def test_bob_login(self, bob):
        u = me(bob)
        assert u["handle"] == "bob"

    def test_admin_login(self, admin):
        u = me(admin)
        assert u["role"] == "admin"


# ---------- CSAM report flow ----------
class TestCsamReportFlow:
    def test_report_csam_quarantines_post(self, bob, alice_posts):
        target = alice_posts[0]
        pid = target["post_id"]

        r = bob.post(f"{API}/reports", json={
            "target_type": "post",
            "target_id": pid,
            "category": "csam",
            "notes": "test report - automated",
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "report_id" in body
        # store for later tests via class-level attr
        TestCsamReportFlow.reported_pid = pid

    def test_post_is_quarantined_in_db(self):
        """Verify quarantined=true via direct DB inspection."""
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            p = await db.posts.find_one({"post_id": TestCsamReportFlow.reported_pid}, {"_id": 0})
            client.close()
            return p
        p = asyncio.get_event_loop().run_until_complete(check())
        assert p is not None
        assert p.get("quarantined") is True, f"post quarantined flag missing: {p}"

    def test_csam_report_row_exists(self):
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            row = await db.csam_reports.find_one(
                {"target_id": TestCsamReportFlow.reported_pid, "status": "queued"},
                {"_id": 0}
            )
            client.close()
            return row
        row = asyncio.get_event_loop().run_until_complete(check())
        assert row is not None, "csam_reports row not found with status=queued"
        assert row["target_type"] == "post"
        TestCsamReportFlow.csam_id = row["csam_id"]

    def test_audit_event_logged(self):
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            row = await db.audit_events.find_one(
                {"event": "csam_report_received", "target_id": TestCsamReportFlow.reported_pid},
                {"_id": 0}
            )
            client.close()
            return row
        row = asyncio.get_event_loop().run_until_complete(check())
        assert row is not None, "audit_events row csam_report_received not found"


# ---------- Quarantine enforcement ----------
class TestQuarantineEnforcement:
    def test_quarantined_post_not_in_bob_feed(self, bob):
        pid = TestCsamReportFlow.reported_pid
        r = bob.get(f"{API}/posts/feed", timeout=15)
        assert r.status_code == 200
        ids = [p["post_id"] for p in r.json().get("posts", [])]
        assert pid not in ids, f"quarantined post {pid} leaked into bob feed"

    def test_quarantined_post_not_in_alice_profile_feed(self, bob, alice_id):
        pid = TestCsamReportFlow.reported_pid
        r = bob.get(f"{API}/posts/by-user/{alice_id}", timeout=15)
        assert r.status_code == 200, r.text
        ids = [p["post_id"] for p in r.json().get("posts", [])]
        assert pid not in ids

    def test_quarantined_post_hidden_from_author(self, alice, alice_id):
        pid = TestCsamReportFlow.reported_pid
        r = alice.get(f"{API}/posts/by-user/{alice_id}", timeout=15)
        assert r.status_code == 200, r.text
        ids = [p["post_id"] for p in r.json().get("posts", [])]
        assert pid not in ids, "author should not see their own quarantined post"


# ---------- Admin CSAM endpoints ----------
class TestAdminCsam:
    def test_csam_queue_has_report(self, admin):
        r = admin.get(f"{API}/admin/csam/queue?status=queued", timeout=15)
        assert r.status_code == 200, r.text
        queue = r.json().get("queue", [])
        ids = [item["csam_id"] for item in queue]
        assert TestCsamReportFlow.csam_id in ids, f"csam_id {TestCsamReportFlow.csam_id} not in queue {ids}"
        # find item and check target_meta populated
        item = next(x for x in queue if x["csam_id"] == TestCsamReportFlow.csam_id)
        assert item["target_meta"] is not None
        assert item["target_meta"].get("author_handle") == "alice"
        assert item["target_meta"].get("quarantined") is True

    def test_audit_endpoint_lists_received_event(self, admin):
        r = admin.get(f"{API}/admin/audit?limit=50", timeout=15)
        assert r.status_code == 200, r.text
        events = r.json().get("events", [])
        kinds = [e["event"] for e in events]
        assert "csam_report_received" in kinds

    def test_non_admin_cannot_access(self, bob):
        r = bob.get(f"{API}/admin/csam/queue", timeout=10)
        assert r.status_code == 403

    def test_csam_clear_restores_post(self, admin, bob):
        csam_id = TestCsamReportFlow.csam_id
        pid = TestCsamReportFlow.reported_pid
        r = admin.post(f"{API}/admin/csam/{csam_id}/clear", timeout=15)
        assert r.status_code == 200, r.text

        # post no longer quarantined → visible in feed to bob
        time.sleep(0.5)
        feed = bob.get(f"{API}/posts/feed", timeout=15).json().get("posts", [])
        ids = [p["post_id"] for p in feed]
        assert pid in ids, "cleared post not back in feed"

        # csam_reports row updated to cleared
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            row = await db.csam_reports.find_one({"csam_id": csam_id}, {"_id": 0})
            ev = await db.audit_events.find_one(
                {"event": "csam_cleared", "csam_id": csam_id}, {"_id": 0}
            )
            client.close()
            return row, ev
        row, ev = asyncio.get_event_loop().run_until_complete(check())
        assert row["status"] == "cleared"
        assert ev is not None
        assert ev.get("admin_id")


# ---------- Confirm path on throwaway user ----------
class TestCsamConfirmThrowaway:
    """Register throwaway user, create a post, bob reports it as csam, admin confirms.
    Expect: post deleted, throwaway user deleted=true."""

    def test_full_confirm_flow(self, bob, admin):
        # register throwaway
        handle = f"throwcsam{uuid.uuid4().hex[:6]}"
        email = f"{handle}@clanchat.app"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={
            "email": email,
            "password": "Password123!",
            "handle": handle,
            "display_name": "Throwaway",
            "dob": "1995-01-01",
        }, timeout=15)
        assert r.status_code == 200, r.text
        throwaway_uid = r.json().get("user", {}).get("user_id") or r.json().get("user_id")
        # try alt key
        if not throwaway_uid:
            throwaway_uid = me(s)["user_id"]

        # create a post
        pr = s.post(f"{API}/posts", json={
            "content": "throwaway target for confirm",
            "tier": "public",
            "tags": [],
        }, timeout=15)
        assert pr.status_code == 200, pr.text
        pid = pr.json()["post_id"]

        # bob reports csam
        rr = bob.post(f"{API}/reports", json={
            "target_type": "post", "target_id": pid,
            "category": "csam", "notes": "throwaway",
        }, timeout=15)
        assert rr.status_code == 200

        # fetch csam_id from queue
        q = admin.get(f"{API}/admin/csam/queue?status=queued", timeout=15).json()["queue"]
        match = [x for x in q if x["target_id"] == pid]
        assert match, "throwaway csam report not in queue"
        csam_id = match[0]["csam_id"]

        # confirm
        cr = admin.post(f"{API}/admin/csam/{csam_id}/confirm", timeout=15)
        assert cr.status_code == 200, cr.text

        # verify post deleted, user deleted=true, audit event
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            post = await db.posts.find_one({"post_id": pid})
            user = await db.users.find_one({"user_id": throwaway_uid}, {"_id": 0})
            ev = await db.audit_events.find_one(
                {"event": "csam_confirmed", "csam_id": csam_id}, {"_id": 0}
            )
            client.close()
            return post, user, ev
        post, user, ev = asyncio.get_event_loop().run_until_complete(check())
        assert post is None, "post should be permanently deleted"
        assert user is not None
        assert user.get("deleted") is True, f"user.deleted should be True: {user}"
        assert (user.get("strikes") or 0) >= 1
        assert ev is not None
        assert ev.get("admin_id")


# ---------- Trending tags ----------
class TestTrendingTags:
    def test_trending_endpoint_returns_valid_shape(self, alice):
        r = alice.get(f"{API}/tags/trending", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "trending" in body
        assert isinstance(body["trending"], list)
        # entries shape check (if any)
        for item in body["trending"]:
            assert "tag" in item
            assert "count" in item

    def test_new_public_tagged_post_appears_in_trending(self, alice):
        unique_tag = f"phototest{uuid.uuid4().hex[:6]}"
        r = alice.post(f"{API}/posts", json={
            "content": "trending tag test",
            "tier": "public",
            "tags": [unique_tag, "sunset"],
        }, timeout=15)
        assert r.status_code == 200, r.text

        time.sleep(0.5)
        t = alice.get(f"{API}/tags/trending", timeout=15).json()["trending"]
        tags_seen = [x["tag"] for x in t]
        assert unique_tag in tags_seen, f"new tag {unique_tag} not in trending: {tags_seen}"
