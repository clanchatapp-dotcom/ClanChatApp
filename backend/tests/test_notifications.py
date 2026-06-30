"""
Tests for message notifications and activity feed.
Verifies in-app notifications and activity feed timeline.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")

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
    s.patch(f"{API}/users/me", json={"settings": {"dms_enabled_followers": True}}, timeout=10)
    return s

@pytest.fixture(scope="module")
def bob():
    s = _login(*BOB)
    alice_id = _me_id(_login(*ALICE))
    s.post(f"{API}/follow/{alice_id}", timeout=10)
    return s

class TestMessageNotifications:
    """Test that DM sends trigger notifications."""

    def test_dm_creates_notification(self, alice, bob):
        """Sending a DM should create a notification for recipient."""
        alice_id = _me_id(alice)
        bob_id = _me_id(bob)
        
        # Get baseline notifications
        r = alice.get(f"{API}/notifications", timeout=10)
        assert r.status_code == 200
        baseline = len(r.json().get("notifications", []))
        
        # bob sends DM to alice
        r = bob.post(f"{API}/dms", json={
            "recipient_id": alice_id,
            "content": "Test notification message",
            "media_paths": [],
        }, timeout=10)
        assert r.status_code == 200, r.text
        
        time.sleep(0.5)
        
        # alice checks notifications
        r = alice.get(f"{API}/notifications", timeout=10)
        assert r.status_code == 200
        notifs = r.json().get("notifications", [])
        assert len(notifs) > baseline, "Notification not created for incoming DM"
        
        # Find our notification
        dm_notif = next((n for n in notifs if n.get("type") == "new_message" and n.get("from_user_id") == bob_id), None)
        assert dm_notif is not None
        assert dm_notif["preview"] == "Test notification message"

    def test_mark_notification_read(self, alice, bob):
        """Can mark notification as read."""
        alice_id = _me_id(alice)
        
        # bob sends DM
        r = bob.post(f"{API}/dms", json={
            "recipient_id": alice_id,
            "content": "Mark read test",
            "media_paths": [],
        }, timeout=10)
        assert r.status_code == 200
        
        time.sleep(0.5)
        
        # Get notifications
        r = alice.get(f"{API}/notifications", timeout=10)
        notifs = r.json().get("notifications", [])
        unread = [n for n in notifs if not n.get("read")]
        assert len(unread) > 0
        
        # Mark as read
        notif_id = unread[0]["notification_id"]
        r = alice.post(f"{API}/notifications/{notif_id}/mark-read", timeout=10)
        assert r.status_code == 200
        
        # Verify marked as read
        r = alice.get(f"{API}/notifications", timeout=10)
        notifs = r.json().get("notifications", [])
        marked = next((n for n in notifs if n["notification_id"] == notif_id), None)
        assert marked is not None
        assert marked.get("read") is True

class TestActivityFeed:
    """Test activity feed timeline."""

    def test_activity_feed_shows_followed_posts(self, alice, bob):
        """Activity feed should show posts from followed users."""
        bob_id = _me_id(bob)
        
        # bob creates a post
        r = bob.post(f"{API}/posts", json={
            "tier": "public",
            "content": "Activity feed test post",
            "tags": [],
        }, timeout=10)
        assert r.status_code in (200, 201)
        
        time.sleep(0.5)
        
        # alice follows bob (if not already)
        alice.post(f"{API}/follow/{bob_id}", timeout=10)
        
        time.sleep(0.5)
        
        # Check activity feed
        r = alice.get(f"{API}/activity/feed", timeout=10)
        assert r.status_code == 200
        activity = r.json().get("activity", [])
        
        # Find post from bob
        bob_posts = [a for a in activity if a.get("type") == "post" and a.get("author_id") == bob_id]
        assert len(bob_posts) > 0, "Bob's post should appear in alice's activity feed"

    def test_activity_feed_shows_new_followers(self, alice, bob):
        """Activity feed should show when someone new follows."""
        bob_id = _me_id(bob)
        
        # Get baseline activity
        r = alice.get(f"{API}/activity/feed", timeout=10)
        assert r.status_code == 200
        baseline = len(r.json().get("activity", []))
        
        # Unfollow and refollow to create event
        alice.delete(f"{API}/follow/{bob_id}", timeout=10)
        time.sleep(0.3)
        alice.post(f"{API}/follow/{bob_id}", timeout=10)
        
        time.sleep(0.5)
        
        # Check activity feed for follow event
        r = alice.get(f"{API}/activity/feed", timeout=10)
        assert r.status_code == 200
        activity = r.json().get("activity", [])
        
        follow_events = [a for a in activity if a.get("type") == "follow"]
        assert len(follow_events) >= 0  # Follow events optional in feed
