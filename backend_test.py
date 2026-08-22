#!/usr/bin/env python3
"""
ClanChat v4 Backend API Test Suite
Tests FastAPI social network backend: auth, three-tier posts, follows, inner circle, DMs, etc.
"""
import asyncio
import json
import io
import base64
from pathlib import Path

import httpx
import websockets
from pymongo import MongoClient

# Base URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# MongoDB for encryption verification
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "clanchat"

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
}

# Global test users
alpha_token = None
alpha_user = None
beta_token = None
beta_user = None


def log_pass(test_name: str, details: str = ""):
    print(f"✅ PASS: {test_name}")
    if details:
        print(f"   {details}")
    test_results["passed"].append(test_name)


def log_fail(test_name: str, details: str):
    print(f"❌ FAIL: {test_name}")
    print(f"   {details}")
    test_results["failed"].append(test_name)


async def test_1_auth():
    """Test 1: Auth - dev login + /api/me with various token scenarios"""
    global alpha_token, alpha_user, beta_token, beta_user
    
    print("\n" + "="*80)
    print("TEST 1: AUTH (dev login + JWT validation)")
    print("="*80)
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 1a: Create Alpha user
        test_name = "1a: POST /api/dev/token - create Alpha user"
        try:
            resp = await client.post(f"{API_BASE}/dev/token", json={"name": "Alpha"})
            if resp.status_code == 200:
                data = resp.json()
                alpha_token = data.get("access_token")
                alpha_user = data.get("user")
                
                if alpha_token and alpha_user and alpha_user.get("handle"):
                    log_pass(test_name, f"Alpha: handle={alpha_user['handle']}, id={alpha_user['id']}")
                else:
                    log_fail(test_name, f"Missing token or user data: {data}")
                    return False
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
                return False
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
            return False
        
        # 1b: Create Beta user
        test_name = "1b: POST /api/dev/token - create Beta user"
        try:
            resp = await client.post(f"{API_BASE}/dev/token", json={"name": "Beta"})
            if resp.status_code == 200:
                data = resp.json()
                beta_token = data.get("access_token")
                beta_user = data.get("user")
                
                if beta_token and beta_user and beta_user.get("handle"):
                    log_pass(test_name, f"Beta: handle={beta_user['handle']}, id={beta_user['id']}")
                else:
                    log_fail(test_name, f"Missing token or user data: {data}")
                    return False
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
                return False
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
            return False
        
        # 1c: Same name twice -> same user id
        test_name = "1c: POST /api/dev/token - same name returns same user id"
        try:
            resp = await client.post(f"{API_BASE}/dev/token", json={"name": "Alpha"})
            data = resp.json()
            if data.get("user", {}).get("id") == alpha_user["id"]:
                log_pass(test_name, f"Deterministic: same id {alpha_user['id']}")
            else:
                log_fail(test_name, f"Different id: {data.get('user', {}).get('id')} vs {alpha_user['id']}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 1d: GET /api/me with valid token
        test_name = "1d: GET /api/me - valid token returns profile"
        try:
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": f"Bearer {alpha_token}"})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("handle") == alpha_user["handle"]:
                    log_pass(test_name, f"Profile: {data.get('display_name')} (@{data.get('handle')})")
                else:
                    log_fail(test_name, f"Handle mismatch: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 1e: GET /api/me without Authorization header -> 401
        test_name = "1e: GET /api/me - no auth header returns 401"
        try:
            resp = await client.get(f"{API_BASE}/me")
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 1f: GET /api/me with malformed token -> 401
        test_name = "1f: GET /api/me - malformed token returns 401"
        try:
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": "Bearer abc.def.ghi"})
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected malformed token")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 1g: GET /api/me with wrong signature -> 401
        test_name = "1g: GET /api/me - wrong signature returns 401"
        try:
            fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0.wrongsignature"
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": f"Bearer {fake_token}"})
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected wrong signature")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
    
    return True


async def test_2_three_tier_visibility():
    """Test 2: Three-tier posts + feed visibility (server-side enforcement)"""
    print("\n" + "="*80)
    print("TEST 2: THREE-TIER FEED VISIBILITY (public/followers/inner)")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    beta_headers = {"Authorization": f"Bearer {beta_token}"}
    
    post_ids = {}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 2a: Alpha creates 3 posts (public, followers, inner)
        test_name = "2a: POST /api/posts - Alpha creates public post"
        try:
            resp = await client.post(f"{API_BASE}/posts", headers=alpha_headers, 
                                    json={"tier": "public", "text": "Alpha public post", "tags": ["test", "public"]})
            if resp.status_code == 200:
                data = resp.json()
                post_ids["public"] = data.get("id")
                log_pass(test_name, f"Created public post: {post_ids['public']}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        test_name = "2b: POST /api/posts - Alpha creates followers post"
        try:
            resp = await client.post(f"{API_BASE}/posts", headers=alpha_headers,
                                    json={"tier": "followers", "text": "Alpha followers post", "tags": ["test"]})
            if resp.status_code == 200:
                data = resp.json()
                post_ids["followers"] = data.get("id")
                log_pass(test_name, f"Created followers post: {post_ids['followers']}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        test_name = "2c: POST /api/posts - Alpha creates inner post (no tags)"
        try:
            resp = await client.post(f"{API_BASE}/posts", headers=alpha_headers,
                                    json={"tier": "inner", "text": "Alpha inner post", "tags": ["should", "be", "stripped"]})
            if resp.status_code == 200:
                data = resp.json()
                post_ids["inner"] = data.get("id")
                # Verify tags are empty for inner posts
                if len(data.get("tags", [])) == 0:
                    log_pass(test_name, f"Created inner post: {post_ids['inner']}, tags correctly empty")
                else:
                    log_fail(test_name, f"Inner post has tags: {data.get('tags')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2d: Beta (NOT following Alpha) sees only public post in general feed
        test_name = "2d: GET /api/feed?scope=general - Beta sees only Alpha's public post"
        try:
            resp = await client.get(f"{API_BASE}/feed?scope=general", headers=beta_headers)
            if resp.status_code == 200:
                posts = resp.json()
                alpha_posts = [p for p in posts if p.get("author", {}).get("handle") == alpha_user["handle"]]
                alpha_tiers = [p.get("tier") for p in alpha_posts]
                
                if "public" in alpha_tiers and "followers" not in alpha_tiers and "inner" not in alpha_tiers:
                    log_pass(test_name, f"Beta sees only public post from Alpha (tiers: {alpha_tiers})")
                else:
                    log_fail(test_name, f"Beta sees wrong tiers from Alpha: {alpha_tiers}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2e: Beta views Alpha's profile posts - should see only public
        test_name = "2e: GET /api/users/{handle}/posts - Beta sees only Alpha's public post"
        try:
            resp = await client.get(f"{API_BASE}/users/{alpha_user['handle']}/posts", headers=beta_headers)
            if resp.status_code == 200:
                posts = resp.json()
                tiers = [p.get("tier") for p in posts]
                
                if "public" in tiers and "followers" not in tiers and "inner" not in tiers:
                    log_pass(test_name, f"Beta sees only public post (tiers: {tiers})")
                else:
                    log_fail(test_name, f"Beta sees wrong tiers: {tiers}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2f: Beta follows Alpha (should be auto-approved since Alpha's follow_mode is 'open')
        test_name = "2f: POST /api/follow/{handle} - Beta follows Alpha (auto-approved)"
        try:
            resp = await client.post(f"{API_BASE}/follow/{alpha_user['handle']}", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "approved":
                    log_pass(test_name, "Follow auto-approved (open mode)")
                else:
                    log_fail(test_name, f"Expected 'approved', got: {data.get('status')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2g: Beta now sees public + followers posts (but NOT inner)
        test_name = "2g: GET /api/users/{handle}/posts - Beta sees public + followers (NOT inner)"
        try:
            resp = await client.get(f"{API_BASE}/users/{alpha_user['handle']}/posts", headers=beta_headers)
            if resp.status_code == 200:
                posts = resp.json()
                tiers = [p.get("tier") for p in posts]
                
                if "public" in tiers and "followers" in tiers and "inner" not in tiers:
                    log_pass(test_name, f"Beta sees public + followers (tiers: {tiers})")
                else:
                    log_fail(test_name, f"Beta sees wrong tiers: {tiers}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2h: Alpha invites Beta to Inner Circle
        test_name = "2h: POST /api/inner/invite/{handle} - Alpha invites Beta"
        try:
            resp = await client.post(f"{API_BASE}/inner/invite/{beta_user['handle']}", headers=alpha_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "pending":
                    log_pass(test_name, "Inner Circle invite sent (pending)")
                else:
                    log_fail(test_name, f"Expected 'pending', got: {data.get('status')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2i: Beta accepts Inner Circle invite
        test_name = "2i: POST /api/inner/accept/{handle} - Beta accepts invite"
        try:
            resp = await client.post(f"{API_BASE}/inner/accept/{alpha_user['handle']}", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "accepted":
                    log_pass(test_name, "Inner Circle invite accepted")
                else:
                    log_fail(test_name, f"Expected 'accepted', got: {data.get('status')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 2j: Beta now sees ALL three tiers (public + followers + inner)
        test_name = "2j: GET /api/users/{handle}/posts - Beta sees all tiers (public + followers + inner)"
        try:
            resp = await client.get(f"{API_BASE}/users/{alpha_user['handle']}/posts", headers=beta_headers)
            if resp.status_code == 200:
                posts = resp.json()
                tiers = [p.get("tier") for p in posts]
                
                if "public" in tiers and "followers" in tiers and "inner" in tiers:
                    log_pass(test_name, f"Beta sees all tiers: {tiers}")
                else:
                    log_fail(test_name, f"Beta missing some tiers: {tiers}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
    
    return post_ids


async def test_3_approval_follow_mode():
    """Test 3: Approval follow mode"""
    print("\n" + "="*80)
    print("TEST 3: APPROVAL FOLLOW MODE")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    beta_headers = {"Authorization": f"Bearer {beta_token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 3a: Beta sets follow_mode to 'approval'
        test_name = "3a: PUT /api/profile - Beta sets follow_mode to 'approval'"
        try:
            resp = await client.put(f"{API_BASE}/profile", headers=beta_headers,
                                   json={"follow_mode": "approval"})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("follow_mode") == "approval":
                    log_pass(test_name, "Follow mode set to 'approval'")
                else:
                    log_fail(test_name, f"Expected 'approval', got: {data.get('follow_mode')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3b: Alpha follows Beta -> status should be 'pending'
        test_name = "3b: POST /api/follow/{handle} - Alpha follows Beta (pending)"
        try:
            resp = await client.post(f"{API_BASE}/follow/{beta_user['handle']}", headers=alpha_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "pending":
                    log_pass(test_name, "Follow request pending (approval mode)")
                else:
                    log_fail(test_name, f"Expected 'pending', got: {data.get('status')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3c: Beta gets follow requests - should see Alpha
        test_name = "3c: GET /api/follow-requests - Beta sees Alpha's request"
        try:
            resp = await client.get(f"{API_BASE}/follow-requests", headers=beta_headers)
            if resp.status_code == 200:
                requests = resp.json()
                handles = [r.get("handle") for r in requests]
                
                if alpha_user["handle"] in handles:
                    log_pass(test_name, f"Beta sees Alpha's follow request: {handles}")
                else:
                    log_fail(test_name, f"Alpha not in follow requests: {handles}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3d: Beta accepts Alpha's follow request
        test_name = "3d: POST /api/follow-requests/{handle}/accept - Beta accepts Alpha"
        try:
            resp = await client.post(f"{API_BASE}/follow-requests/{alpha_user['handle']}/accept", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "approved":
                    log_pass(test_name, "Follow request accepted")
                else:
                    log_fail(test_name, f"Expected 'approved', got: {data.get('status')}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")


async def test_4_dms_encrypted():
    """Test 4: Tier-gated encrypted DMs + WebSocket"""
    print("\n" + "="*80)
    print("TEST 4: TIER-GATED ENCRYPTED DMs + WEBSOCKET")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    beta_headers = {"Authorization": f"Bearer {beta_token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 4a: Alpha and Beta are in each other's inner circle, so DMs should be allowed
        test_name = "4a: POST /api/dms/{handle} - Alpha sends DM to Beta (allowed)"
        dm_text = "hey beta this is a secret message"
        try:
            resp = await client.post(f"{API_BASE}/dms/{beta_user['handle']}", headers=alpha_headers,
                                    json={"text": dm_text})
            if resp.status_code == 200:
                data = resp.json()
                if data.get("text") == dm_text:
                    log_pass(test_name, f"DM sent: {data.get('id')}")
                else:
                    log_fail(test_name, f"Text mismatch: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 4b: Beta retrieves DM history with Alpha
        test_name = "4b: GET /api/dms/{handle} - Beta retrieves DMs from Alpha"
        try:
            resp = await client.get(f"{API_BASE}/dms/{alpha_user['handle']}", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                messages = data.get("messages", [])
                can_dm = data.get("can_dm")
                
                if can_dm and len(messages) > 0 and messages[-1].get("text") == dm_text:
                    log_pass(test_name, f"Retrieved {len(messages)} messages, can_dm={can_dm}")
                else:
                    log_fail(test_name, f"can_dm={can_dm}, messages={messages}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 4c: GET /api/dms - Beta lists DM threads
        test_name = "4c: GET /api/dms - Beta lists DM threads"
        try:
            resp = await client.get(f"{API_BASE}/dms", headers=beta_headers)
            if resp.status_code == 200:
                threads = resp.json()
                alpha_thread = next((t for t in threads if t.get("user", {}).get("handle") == alpha_user["handle"]), None)
                
                if alpha_thread:
                    log_pass(test_name, f"Found thread with Alpha: {alpha_thread.get('last')[:30]}...")
                else:
                    log_fail(test_name, f"No thread with Alpha found: {threads}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 4d: ENCRYPTION AT REST - verify content_enc is encrypted
        test_name = "4d: MongoDB verification - DM content_enc is encrypted (not plaintext)"
        try:
            mongo_client = MongoClient(MONGO_URL)
            db = mongo_client[DB_NAME]
            dm_doc = db.dms.find_one({"participants": {"$all": [alpha_user["id"], beta_user["id"]]}})
            
            if dm_doc:
                content_enc = dm_doc.get("content_enc")
                if content_enc and dm_text not in content_enc:
                    # Verify it's base64
                    try:
                        base64.b64decode(content_enc)
                        log_pass(test_name, f"content_enc is encrypted base64: {content_enc[:40]}...")
                    except Exception:
                        log_fail(test_name, f"content_enc is not valid base64: {content_enc}")
                else:
                    log_fail(test_name, f"Plaintext found in content_enc: {content_enc}")
            else:
                log_fail(test_name, "No DM document found in MongoDB")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 4e: WebSocket - connect without token (should be rejected)
        test_name = "4e: WebSocket /api/ws/dm/{handle} - no token rejected"
        ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_base}/api/ws/dm/{alpha_user['handle']}"
        
        try:
            async with websockets.connect(ws_url, open_timeout=5) as ws:
                log_fail(test_name, "Connection accepted without token")
        except Exception as e:
            log_pass(test_name, f"Connection rejected: {type(e).__name__}")
        
        # 4f: WebSocket - connect with valid token and receive message
        test_name = "4f: WebSocket /api/ws/dm/{handle} - with token receives broadcast"
        try:
            async with websockets.connect(f"{ws_url}?token={beta_token}", open_timeout=10) as ws:
                print(f"   WebSocket connected successfully")
                
                # Alpha sends a new DM
                test_dm = f"websocket test message {asyncio.get_event_loop().time()}"
                resp = await client.post(f"{API_BASE}/dms/{beta_user['handle']}", headers=alpha_headers,
                                        json={"text": test_dm})
                
                if resp.status_code != 200:
                    log_fail(test_name, f"Failed to send DM: {resp.status_code}")
                else:
                    # Wait for WebSocket message
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=5)
                        data = json.loads(msg)
                        
                        if data.get("type") == "dm" and data.get("message", {}).get("text") == test_dm:
                            log_pass(test_name, f"Received DM via WebSocket: {test_dm[:30]}...")
                        else:
                            log_fail(test_name, f"Wrong message format: {data}")
                    except asyncio.TimeoutError:
                        log_fail(test_name, "Timeout waiting for WebSocket message")
        except websockets.exceptions.InvalidStatusCode as e:
            log_fail(test_name, f"WebSocket connection failed with status {e.status_code}. May be ingress routing issue - REST DM flow works.")
        except Exception as e:
            log_fail(test_name, f"Exception: {type(e).__name__}: {e}. May be ingress routing issue - REST DM flow works.")


async def test_5_likes():
    """Test 5: Likes (public tier only)"""
    print("\n" + "="*80)
    print("TEST 5: LIKES (public tier only)")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    beta_headers = {"Authorization": f"Bearer {beta_token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # Get Alpha's posts
        resp = await client.get(f"{API_BASE}/users/{alpha_user['handle']}/posts", headers=beta_headers)
        posts = resp.json()
        
        public_post = next((p for p in posts if p.get("tier") == "public"), None)
        followers_post = next((p for p in posts if p.get("tier") == "followers"), None)
        
        if not public_post:
            log_fail("Likes test setup", "No public post found")
            return
        
        # 5a: Beta likes Alpha's public post
        test_name = "5a: POST /api/posts/{id}/like - like public post"
        try:
            resp = await client.post(f"{API_BASE}/posts/{public_post['id']}/like", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("liked") is True and data.get("like_count", 0) >= 1:
                    log_pass(test_name, f"Liked: {data.get('liked')}, count: {data.get('like_count')}")
                else:
                    log_fail(test_name, f"Unexpected response: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 5b: Beta likes again (should toggle off)
        test_name = "5b: POST /api/posts/{id}/like - like again toggles off"
        try:
            resp = await client.post(f"{API_BASE}/posts/{public_post['id']}/like", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("liked") is False:
                    log_pass(test_name, f"Unliked: {data.get('liked')}, count: {data.get('like_count')}")
                else:
                    log_fail(test_name, f"Expected liked=false: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 5c: Beta tries to like followers post (should fail with 400)
        if followers_post:
            test_name = "5c: POST /api/posts/{id}/like - liking followers post returns 400"
            try:
                resp = await client.post(f"{API_BASE}/posts/{followers_post['id']}/like", headers=beta_headers)
                if resp.status_code == 400:
                    log_pass(test_name, "Correctly rejected non-public post like")
                else:
                    log_fail(test_name, f"Expected 400, got {resp.status_code}: {resp.text}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")


async def test_6_search_trending_activity():
    """Test 6: Search + trending tags + activity"""
    print("\n" + "="*80)
    print("TEST 6: SEARCH + TRENDING + ACTIVITY")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    beta_headers = {"Authorization": f"Bearer {beta_token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 6a: Search for Alpha by handle
        test_name = "6a: GET /api/search?q={handle} - find Alpha"
        try:
            resp = await client.get(f"{API_BASE}/search?q={alpha_user['handle']}", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                users = data.get("users", [])
                handles = [u.get("handle") for u in users]
                
                if alpha_user["handle"] in handles:
                    log_pass(test_name, f"Found Alpha in search: {handles}")
                else:
                    log_fail(test_name, f"Alpha not found: {handles}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 6b: Search for public tag
        test_name = "6b: GET /api/search?q={tag} - find public posts only"
        try:
            resp = await client.get(f"{API_BASE}/search?q=test", headers=beta_headers)
            if resp.status_code == 200:
                data = resp.json()
                posts = data.get("posts", [])
                tiers = [p.get("tier") for p in posts]
                
                # Should only return public posts
                if all(t == "public" for t in tiers):
                    log_pass(test_name, f"Found {len(posts)} public posts with tag 'test'")
                else:
                    log_fail(test_name, f"Non-public posts in search: {tiers}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 6c: Trending tags
        test_name = "6c: GET /api/trending - get trending tags"
        try:
            resp = await client.get(f"{API_BASE}/trending", headers=beta_headers)
            if resp.status_code == 200:
                tags = resp.json()
                if isinstance(tags, list):
                    log_pass(test_name, f"Trending tags: {[t.get('tag') for t in tags[:5]]}")
                else:
                    log_fail(test_name, f"Expected list, got: {tags}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 6d: Activity feed for Alpha
        test_name = "6d: GET /api/activity - Alpha's activity feed"
        try:
            resp = await client.get(f"{API_BASE}/activity", headers=alpha_headers)
            if resp.status_code == 200:
                activities = resp.json()
                types = [a.get("type") for a in activities]
                
                # Should have follow, inner_accepted, etc.
                log_pass(test_name, f"Activity types: {set(types)}, count: {len(activities)}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")


async def test_7_storage():
    """Test 7: Supabase Storage upload"""
    print("\n" + "="*80)
    print("TEST 7: SUPABASE STORAGE UPLOAD")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    
    async with httpx.AsyncClient(timeout=60) as client:
        # 7a: Upload without auth -> 401
        test_name = "7a: POST /api/upload - without auth returns 401"
        try:
            png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {"file": ("test.png", io.BytesIO(png_data), "image/png")}
            
            resp = await client.post(f"{API_BASE}/upload", files=files)
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected upload without auth")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 7b: Upload with auth
        test_name = "7b: POST /api/upload - with auth returns path and signed_url"
        signed_url = None
        try:
            png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {"file": ("test.png", io.BytesIO(png_data), "image/png")}
            
            resp = await client.post(f"{API_BASE}/upload", headers=alpha_headers, files=files)
            if resp.status_code == 200:
                data = resp.json()
                path = data.get("path")
                signed_url = data.get("signed_url")
                media_type = data.get("media_type")
                
                if path and signed_url and signed_url.startswith("http"):
                    log_pass(test_name, f"Upload successful: path={path}, media_type={media_type}")
                else:
                    log_fail(test_name, f"Missing or invalid data: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 7c: Verify signed URL is accessible
        if signed_url:
            test_name = "7c: GET signed_url - verify file is accessible"
            try:
                resp = await client.get(signed_url)
                if resp.status_code == 200 and len(resp.content) > 0:
                    log_pass(test_name, f"File accessible, size: {len(resp.content)} bytes")
                else:
                    log_fail(test_name, f"Status {resp.status_code}, size: {len(resp.content)}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")


async def test_8_livekit():
    """Test 8: LiveKit call token"""
    print("\n" + "="*80)
    print("TEST 8: LIVEKIT CALL TOKEN")
    print("="*80)
    
    alpha_headers = {"Authorization": f"Bearer {alpha_token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 8a: Without auth -> 401
        test_name = "8a: POST /api/livekit/token - without auth returns 401"
        try:
            resp = await client.post(f"{API_BASE}/livekit/token", json={"room": "test-room"})
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected without auth")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 8b: With auth -> returns server_url (wss://) and participant_token (JWT with 3 segments)
        test_name = "8b: POST /api/livekit/token - with auth returns valid token"
        try:
            resp = await client.post(f"{API_BASE}/livekit/token", headers=alpha_headers,
                                    json={"room": "dm-alpha-beta"})
            if resp.status_code == 200:
                data = resp.json()
                server_url = data.get("server_url")
                participant_token = data.get("participant_token")
                room = data.get("room")
                
                # Verify server_url starts with wss://
                # Verify participant_token is a JWT (3 segments separated by dots)
                token_segments = participant_token.split(".") if participant_token else []
                
                if server_url and server_url.startswith("wss://") and len(token_segments) == 3 and room:
                    log_pass(test_name, f"server_url={server_url}, token segments={len(token_segments)}, room={room}")
                else:
                    log_fail(test_name, f"Invalid response: server_url={server_url}, token_segments={len(token_segments)}, room={room}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")


async def main():
    print("=" * 80)
    print("ClanChat v4 Backend API Test Suite")
    print("=" * 80)
    
    # Test 1: Auth
    if not await test_1_auth():
        print("\n❌ Auth tests failed - cannot proceed")
        return
    
    # Test 2: Three-tier visibility
    await test_2_three_tier_visibility()
    
    # Test 3: Approval follow mode
    await test_3_approval_follow_mode()
    
    # Test 4: DMs + encryption + WebSocket
    await test_4_dms_encrypted()
    
    # Test 5: Likes
    await test_5_likes()
    
    # Test 6: Search/trending/activity
    await test_6_search_trending_activity()
    
    # Test 7: Storage
    await test_7_storage()
    
    # Test 8: LiveKit
    await test_8_livekit()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"✅ Passed: {len(test_results['passed'])}")
    print(f"❌ Failed: {len(test_results['failed'])}")
    print()
    
    if test_results["failed"]:
        print("Failed tests:")
        for test in test_results["failed"]:
            print(f"  - {test}")
    else:
        print("🎉 All tests passed!")
    print()


if __name__ == "__main__":
    asyncio.run(main())
