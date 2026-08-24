#!/usr/bin/env python3
"""
Phase 3 Backend Testing: Giphy GIF search + Reels (video) feed
Tests GIPHY endpoints and REELS endpoints with authentication
"""

import requests
import uuid
import json
from datetime import datetime

# Backend URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def register_user():
    """Register a throwaway user for testing"""
    unique_suffix = str(uuid.uuid4())[:8]
    email = f"phase3test+{unique_suffix}@example.com"
    password = "secret123"
    name = f"Phase3 Tester"
    
    log(f"Registering user: {email}")
    resp = requests.post(f"{BASE_URL}/auth/register", json={
        "email": email,
        "password": password,
        "name": name
    }, timeout=30)
    
    if resp.status_code != 200:
        log(f"❌ Registration failed: {resp.status_code} - {resp.text}")
        return None, None
    
    data = resp.json()
    token = data.get("access_token")
    handle = data.get("user", {}).get("handle")
    log(f"✅ Registered user: {handle} (token: {len(token)} chars)")
    return token, handle

def test_giphy_trending(token):
    """Test 1: GET /api/giphy/search (no q, auth) -> 200, returns trending gifs array"""
    log("\n=== TEST 1: GIPHY Trending (no q parameter) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/giphy/search", headers=headers, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    if not isinstance(data, list):
        log(f"❌ FAIL: Expected array, got {type(data)}")
        return False
    
    if len(data) == 0:
        log(f"❌ FAIL: Expected non-empty array (trending gifs), got empty array")
        return False
    
    # Check first item has required fields
    first_item = data[0]
    if not all(k in first_item for k in ['id', 'url', 'preview']):
        log(f"❌ FAIL: Missing required fields. Got: {first_item.keys()}")
        return False
    
    log(f"✅ PASS: Returned {len(data)} trending gifs")
    log(f"   Sample: id={first_item['id'][:20]}..., url={first_item['url'][:50]}...")
    return True

def test_giphy_search(token):
    """Test 2: GET /api/giphy/search?q=cat (auth) -> 200, array of gifs"""
    log("\n=== TEST 2: GIPHY Search with query (q=cat) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/giphy/search?q=cat", headers=headers, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    if not isinstance(data, list):
        log(f"❌ FAIL: Expected array, got {type(data)}")
        return False
    
    if len(data) == 0:
        log(f"❌ FAIL: Expected non-empty array (cat gifs), got empty array")
        return False
    
    # Check first item has required fields
    first_item = data[0]
    if not all(k in first_item for k in ['id', 'url', 'preview']):
        log(f"❌ FAIL: Missing required fields. Got: {first_item.keys()}")
        return False
    
    log(f"✅ PASS: Returned {len(data)} cat gifs")
    log(f"   Sample: id={first_item['id'][:20]}..., url={first_item['url'][:50]}...")
    return True

def test_giphy_no_auth():
    """Test 3: GET /api/giphy/search with NO auth token -> 401"""
    log("\n=== TEST 3: GIPHY Search without auth (expect 401) ===")
    
    resp = requests.get(f"{BASE_URL}/giphy/search", timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 401:
        log(f"❌ FAIL: Expected 401, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    log(f"✅ PASS: Correctly returned 401 without auth token")
    return True

def test_create_video_post(token):
    """Test 4: Create a VIDEO post"""
    log("\n=== TEST 4: Create VIDEO post (media_type=video) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/posts", headers=headers, json={
        "tier": "public",
        "text": "reel test",
        "media_url": "https://example.com/v.mp4",
        "media_type": "video"
    }, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False, None
    
    data = resp.json()
    post_id = data.get("id")
    
    log(f"✅ PASS: Created video post with id={post_id}")
    return True, post_id

def test_create_text_post(token):
    """Test 5: Create a non-video post (text only)"""
    log("\n=== TEST 5: Create TEXT-ONLY post (no media) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/posts", headers=headers, json={
        "tier": "public",
        "text": "not a reel"
    }, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False, None
    
    data = resp.json()
    post_id = data.get("id")
    
    log(f"✅ PASS: Created text-only post with id={post_id}")
    return True, post_id

def test_reels_endpoint(token, video_post_id, text_post_id):
    """Test 6: GET /api/reels (auth) -> 200, includes video post, excludes text post"""
    log("\n=== TEST 6: GET /api/reels (must include video, exclude text) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/reels", headers=headers, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    if not isinstance(data, list):
        log(f"❌ FAIL: Expected array, got {type(data)}")
        return False
    
    log(f"Returned {len(data)} reels")
    
    # Check if video post is in reels
    video_found = False
    text_found = False
    
    for reel in data:
        if reel.get("id") == video_post_id:
            video_found = True
            # Verify it has correct shape
            if reel.get("media_type") != "video":
                log(f"❌ FAIL: Video post has wrong media_type: {reel.get('media_type')}")
                return False
            if not reel.get("media_url"):
                log(f"❌ FAIL: Video post missing media_url")
                return False
            # Check post_out shape
            required_fields = ['id', 'media_url', 'media_type', 'author', 'reaction_total', 'comment_count']
            missing = [f for f in required_fields if f not in reel]
            if missing:
                log(f"❌ FAIL: Video post missing fields: {missing}")
                return False
            log(f"   ✓ Video post found with correct shape")
        
        if reel.get("id") == text_post_id:
            text_found = True
    
    if not video_found:
        log(f"❌ FAIL: Video post (id={video_post_id}) NOT found in reels")
        return False
    
    if text_found:
        log(f"❌ FAIL: Text-only post (id={text_post_id}) SHOULD NOT be in reels but was found")
        return False
    
    log(f"✅ PASS: Reels correctly includes video post and excludes text-only post")
    return True

def test_reels_no_auth():
    """Test 7: GET /api/reels with no token -> 401"""
    log("\n=== TEST 7: GET /api/reels without auth (expect 401) ===")
    
    resp = requests.get(f"{BASE_URL}/reels", timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 401:
        log(f"❌ FAIL: Expected 401, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    log(f"✅ PASS: Correctly returned 401 without auth token")
    return True

def test_feed_regression(token, video_post_id, text_post_id):
    """Test 8: Regression - GET /api/feed still works and includes both posts"""
    log("\n=== TEST 8: REGRESSION - GET /api/feed includes both posts ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers, timeout=30)
    
    log(f"Status: {resp.status_code}")
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    if not isinstance(data, list):
        log(f"❌ FAIL: Expected array, got {type(data)}")
        return False
    
    log(f"Feed returned {len(data)} posts")
    
    # Check if both posts are in feed
    video_found = False
    text_found = False
    
    for post in data:
        if post.get("id") == video_post_id:
            video_found = True
            log(f"   ✓ Video post found in feed")
        if post.get("id") == text_post_id:
            text_found = True
            log(f"   ✓ Text post found in feed")
    
    if not video_found:
        log(f"❌ FAIL: Video post (id={video_post_id}) NOT found in feed")
        return False
    
    if not text_found:
        log(f"❌ FAIL: Text post (id={text_post_id}) NOT found in feed")
        return False
    
    log(f"✅ PASS: Feed correctly includes both video and text posts")
    return True

def main():
    """Run all Phase 3 tests"""
    log("=" * 70)
    log("PHASE 3 BACKEND TESTING: Giphy GIF search + Reels (video) feed")
    log("=" * 70)
    
    # Register user
    token, handle = register_user()
    if not token:
        log("\n❌ CRITICAL: Failed to register user, cannot continue")
        return
    
    results = {}
    
    # GIPHY TESTS
    results['giphy_trending'] = test_giphy_trending(token)
    results['giphy_search'] = test_giphy_search(token)
    results['giphy_no_auth'] = test_giphy_no_auth()
    
    # REELS TESTS
    video_success, video_post_id = test_create_video_post(token)
    results['create_video_post'] = video_success
    
    text_success, text_post_id = test_create_text_post(token)
    results['create_text_post'] = text_success
    
    if video_success and text_success:
        results['reels_endpoint'] = test_reels_endpoint(token, video_post_id, text_post_id)
        results['reels_no_auth'] = test_reels_no_auth()
        results['feed_regression'] = test_feed_regression(token, video_post_id, text_post_id)
    else:
        log("\n❌ Skipping reels tests due to post creation failures")
        results['reels_endpoint'] = False
        results['reels_no_auth'] = False
        results['feed_regression'] = False
    
    # Summary
    log("\n" + "=" * 70)
    log("TEST SUMMARY")
    log("=" * 70)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, passed_flag in results.items():
        status = "✅ PASS" if passed_flag else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log(f"\nTotal: {passed}/{total} tests passed ({100*passed//total}% success rate)")
    
    if passed == total:
        log("\n🎉 ALL TESTS PASSED - Phase 3 backend is working correctly!")
    else:
        log(f"\n⚠️  {total - passed} test(s) failed - see details above")

if __name__ == "__main__":
    main()
