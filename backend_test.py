#!/usr/bin/env python3
"""
Test script for THREE new backend features:
(A) EDIT HISTORY - posts and wall posts
(B) PINNED posts (max 3, toggle, author-only)
(C) TAG-APPROVAL - people tags with approve/reject flow

Tests 20 numbered items from review_request.
Uses adult users (DOB 1990-01-01).
Backend at external URL with /api prefix.
"""

import requests
import uuid
import os
from datetime import datetime

# Backend URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

# Adult DOB (1990-01-01)
ADULT_DOB = "1990-01-01"

def register_user(email_prefix):
    """Register a new adult user and return (handle, token, user_id)."""
    rand = uuid.uuid4().hex[:8]
    email = f"{email_prefix}+{rand}@example.com"
    handle = f"{email_prefix}{rand}"
    
    payload = {
        "email": email,
        "password": "TestPass123!",
        "handle": handle,
        "display_name": f"Test {email_prefix.upper()}",
        "dob": ADULT_DOB
    }
    
    resp = requests.post(f"{BASE_URL}/auth/register", json=payload)
    if resp.status_code != 200:
        raise Exception(f"Registration failed: {resp.status_code} {resp.text}")
    
    data = resp.json()
    token = data.get('access_token')  # Changed from 'token' to 'access_token'
    user_id = data.get('user', {}).get('id')
    
    return handle, token, user_id

def headers(token):
    """Return auth headers."""
    return {"Authorization": f"Bearer {token}"}

def main():
    print("=" * 80)
    print("TESTING: Edit-history + Pinned posts + People tag-approval")
    print("=" * 80)
    
    # Register users
    print("\n[SETUP] Registering users...")
    a_handle, a_token, a_id = register_user("edita")
    print(f"✓ User A: {a_handle} (id={a_id})")
    
    b_handle, b_token, b_id = register_user("editb")
    print(f"✓ User B: {b_handle} (id={b_id})")
    
    c_handle, c_token, c_id = register_user("editc")
    print(f"✓ User C: {c_handle} (id={c_id})")
    
    s_handle, s_token, s_id = register_user("edits")
    print(f"✓ Stranger S: {s_handle} (id={s_id})")
    
    # Make B a follower of A (for wall test)
    print(f"\n[SETUP] Making B a follower of A...")
    resp = requests.post(f"{BASE_URL}/follow/{a_handle}", headers=headers(b_token))
    if resp.status_code != 200:
        print(f"✗ Follow failed: {resp.status_code} {resp.text}")
    else:
        print(f"✓ B follows A: {resp.json()}")
    
    # ========================================================================
    # (A) EDIT HISTORY
    # ========================================================================
    print("\n" + "=" * 80)
    print("(A) EDIT HISTORY")
    print("=" * 80)
    
    # Test 1: A creates PUBLIC post
    print("\n[TEST 1] A creates PUBLIC post with text='v1'")
    resp = requests.post(f"{BASE_URL}/posts", 
                        json={"tier": "public", "text": "v1"},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    post_data = resp.json()
    post_id = post_data.get('id')
    print(f"✓ PASS: Post created with id={post_id}")
    
    # Test 2: PUT /api/posts/{id} {text:'v2'} → 200
    print("\n[TEST 2] A edits post to text='v2'")
    resp = requests.put(f"{BASE_URL}/posts/{post_id}",
                       json={"text": "v2"},
                       headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    print(f"✓ PASS: Post edited to v2: {resp.json()}")
    
    # Test 2 continued: PUT /api/posts/{id} {text:'v3'} → 200
    print("\n[TEST 2 continued] A edits post to text='v3'")
    resp = requests.put(f"{BASE_URL}/posts/{post_id}",
                       json={"text": "v3"},
                       headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    print(f"✓ PASS: Post edited to v3: {resp.json()}")
    
    # Test 3: GET /api/posts/{id}/history → current.text=='v3' and history==[{text:'v2',...},{text:'v1',...}]
    print("\n[TEST 3] GET /api/posts/{id}/history → current.text=='v3' and history has 2 entries (v2, v1)")
    resp = requests.get(f"{BASE_URL}/posts/{post_id}/history", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    hist_data = resp.json()
    current_text = hist_data.get('current', {}).get('text')
    history = hist_data.get('history', [])
    
    if current_text != 'v3':
        print(f"✗ FAIL: current.text is '{current_text}', expected 'v3'")
        return
    if len(history) != 2:
        print(f"✗ FAIL: history length is {len(history)}, expected 2")
        return
    if history[0].get('text') != 'v2':
        print(f"✗ FAIL: history[0].text is '{history[0].get('text')}', expected 'v2' (newest first)")
        return
    if history[1].get('text') != 'v1':
        print(f"✗ FAIL: history[1].text is '{history[1].get('text')}', expected 'v1'")
        return
    print(f"✓ PASS: current.text='v3', history=[v2, v1] (newest first)")
    
    # Test 4: A GET /api/feed?scope=general → that post edited_count==2
    print("\n[TEST 4] A GET /api/feed?scope=general → post has edited_count==2")
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    feed = resp.json()
    found_post = next((p for p in feed if p.get('id') == post_id), None)
    if not found_post:
        print(f"✗ FAIL: Post {post_id} not found in feed")
        return
    edited_count = found_post.get('edited_count')
    if edited_count != 2:
        print(f"✗ FAIL: edited_count is {edited_count}, expected 2")
        return
    print(f"✓ PASS: Post in feed has edited_count=2")
    
    # Test 5: A creates a FOLLOWERS-tier post, Stranger S tries to GET history → 403
    print("\n[TEST 5] A creates FOLLOWERS-tier post, Stranger S GET history → 403")
    resp = requests.post(f"{BASE_URL}/posts",
                        json={"tier": "followers", "text": "secret v1"},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    followers_post_id = resp.json().get('id')
    print(f"✓ Created followers-tier post: {followers_post_id}")
    
    resp = requests.get(f"{BASE_URL}/posts/{followers_post_id}/history", headers=headers(s_token))
    if resp.status_code != 403:
        print(f"✗ FAIL: Expected 403, got {resp.status_code}")
        return
    print(f"✓ PASS: Stranger S got 403 (correctly blocked)")
    
    # Test 6: WALL edit history
    print("\n[TEST 6] WALL: A POST /api/wall/{A_handle} {text:'w1'}, PUT to 'w2', GET history")
    resp = requests.post(f"{BASE_URL}/wall/{a_handle}",
                        json={"text": "w1"},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    wall_id = resp.json().get('id')
    print(f"✓ Wall post created: {wall_id}")
    
    resp = requests.put(f"{BASE_URL}/wall/{wall_id}",
                       json={"text": "w2"},
                       headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    print(f"✓ Wall post edited to w2")
    
    resp = requests.get(f"{BASE_URL}/wall/{wall_id}/history", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    wall_hist = resp.json()
    if wall_hist.get('current', {}).get('text') != 'w2':
        print(f"✗ FAIL: current.text is '{wall_hist.get('current', {}).get('text')}', expected 'w2'")
        return
    if len(wall_hist.get('history', [])) != 1:
        print(f"✗ FAIL: history length is {len(wall_hist.get('history', []))}, expected 1")
        return
    if wall_hist.get('history', [])[0].get('text') != 'w1':
        print(f"✗ FAIL: history[0].text is '{wall_hist.get('history', [])[0].get('text')}', expected 'w1'")
        return
    print(f"✓ PASS: Wall history contains 'w1', current.text='w2'")
    
    # ========================================================================
    # (B) PINNED POSTS
    # ========================================================================
    print("\n" + "=" * 80)
    print("(B) PINNED POSTS")
    print("=" * 80)
    
    # Test 7: A creates 4 public posts p1,p2,p3,p4
    print("\n[TEST 7] A creates 4 public posts p1,p2,p3,p4")
    p1_resp = requests.post(f"{BASE_URL}/posts", json={"tier": "public", "text": "p1"}, headers=headers(a_token))
    p2_resp = requests.post(f"{BASE_URL}/posts", json={"tier": "public", "text": "p2"}, headers=headers(a_token))
    p3_resp = requests.post(f"{BASE_URL}/posts", json={"tier": "public", "text": "p3"}, headers=headers(a_token))
    p4_resp = requests.post(f"{BASE_URL}/posts", json={"tier": "public", "text": "p4"}, headers=headers(a_token))
    
    if any(r.status_code != 200 for r in [p1_resp, p2_resp, p3_resp, p4_resp]):
        print(f"✗ FAIL: Failed to create posts")
        return
    
    p1 = p1_resp.json().get('id')
    p2 = p2_resp.json().get('id')
    p3 = p3_resp.json().get('id')
    p4 = p4_resp.json().get('id')
    print(f"✓ PASS: Created p1={p1}, p2={p2}, p3={p3}, p4={p4}")
    
    # Test 8: POST /api/posts/{p1}/pin → pinned=true; {p2}/pin → true; {p3}/pin → true
    print("\n[TEST 8] A pins p1, p2, p3 → each returns pinned=true")
    for pid, name in [(p1, 'p1'), (p2, 'p2'), (p3, 'p3')]:
        resp = requests.post(f"{BASE_URL}/posts/{pid}/pin", headers=headers(a_token))
        if resp.status_code != 200:
            print(f"✗ FAIL: Pin {name} failed: {resp.status_code} {resp.text}")
            return
        if not resp.json().get('pinned'):
            print(f"✗ FAIL: Pin {name} returned pinned=false")
            return
        print(f"✓ {name} pinned")
    print(f"✓ PASS: p1, p2, p3 all pinned")
    
    # Test 9: POST /api/posts/{p4}/pin → 400 (max 3)
    print("\n[TEST 9] A tries to pin p4 (4th post) → 400 (max 3)")
    resp = requests.post(f"{BASE_URL}/posts/{p4}/pin", headers=headers(a_token))
    if resp.status_code != 400:
        print(f"✗ FAIL: Expected 400, got {resp.status_code}")
        return
    if 'You can pin up to 3 posts' not in resp.text:
        print(f"✗ FAIL: Expected error message about max 3 posts, got: {resp.text}")
        return
    print(f"✓ PASS: Got 400 with correct error message")
    
    # Test 10: GET /api/users/{A_handle} → pinned_posts length==3, each has pinned==true
    print("\n[TEST 10] GET /api/users/{A_handle} → pinned_posts length==3, each has pinned==true")
    resp = requests.get(f"{BASE_URL}/users/{a_handle}", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    profile = resp.json()
    pinned_posts = profile.get('pinned_posts', [])
    if len(pinned_posts) != 3:
        print(f"✗ FAIL: pinned_posts length is {len(pinned_posts)}, expected 3")
        return
    for pp in pinned_posts:
        if not pp.get('pinned'):
            print(f"✗ FAIL: Post {pp.get('id')} has pinned=false")
            return
    print(f"✓ PASS: pinned_posts length=3, each has pinned=true")
    
    # Test 11: POST /api/posts/{p1}/pin again → pinned=false (toggle). Then POST /api/posts/{p4}/pin → 200 pinned=true
    print("\n[TEST 11] A unpins p1 (toggle), then pins p4 → 200 pinned=true")
    resp = requests.post(f"{BASE_URL}/posts/{p1}/pin", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: Unpin p1 failed: {resp.status_code} {resp.text}")
        return
    if resp.json().get('pinned'):
        print(f"✗ FAIL: Unpin p1 returned pinned=true, expected false")
        return
    print(f"✓ p1 unpinned")
    
    resp = requests.post(f"{BASE_URL}/posts/{p4}/pin", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: Pin p4 failed: {resp.status_code} {resp.text}")
        return
    if not resp.json().get('pinned'):
        print(f"✗ FAIL: Pin p4 returned pinned=false")
        return
    print(f"✓ PASS: p4 now pinned")
    
    # Test 12: Non-author B: POST /api/posts/{p2}/pin → 403
    print("\n[TEST 12] Non-author B tries to pin A's post p2 → 403")
    resp = requests.post(f"{BASE_URL}/posts/{p2}/pin", headers=headers(b_token))
    if resp.status_code != 403:
        print(f"✗ FAIL: Expected 403, got {resp.status_code}")
        return
    print(f"✓ PASS: Non-author B got 403")
    
    # Test 13: A DELETE /api/posts/{p2} → then GET /api/users/{A_handle} pinned_posts no longer includes p2
    print("\n[TEST 13] A deletes p2 → pinned_posts no longer includes p2")
    resp = requests.delete(f"{BASE_URL}/posts/{p2}", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: Delete p2 failed: {resp.status_code} {resp.text}")
        return
    print(f"✓ p2 deleted")
    
    resp = requests.get(f"{BASE_URL}/users/{a_handle}", headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    pinned_posts = resp.json().get('pinned_posts', [])
    if any(pp.get('id') == p2 for pp in pinned_posts):
        print(f"✗ FAIL: p2 still in pinned_posts after deletion")
        return
    print(f"✓ PASS: p2 no longer in pinned_posts")
    
    # ========================================================================
    # (C) TAG-APPROVAL
    # ========================================================================
    print("\n" + "=" * 80)
    print("(C) TAG-APPROVAL")
    print("=" * 80)
    
    # Test 14: A creates PUBLIC post tagging B
    print("\n[TEST 14] A creates PUBLIC post tagging B: people_tags=['{B_handle}']")
    resp = requests.post(f"{BASE_URL}/posts",
                        json={"tier": "public", "text": "squad", "people_tags": [b_handle]},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    t1 = resp.json().get('id')
    print(f"✓ PASS: Post t1={t1} created tagging B")
    
    # Test 15: B GET /api/activity → contains an item type=='tag_request' with post_id==t1
    print("\n[TEST 15] B GET /api/activity → contains tag_request with post_id==t1")
    resp = requests.get(f"{BASE_URL}/activity", headers=headers(b_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    activity = resp.json()
    tag_req = next((a for a in activity if a.get('type') == 'tag_request' and a.get('post_id') == t1), None)
    if not tag_req:
        print(f"✗ FAIL: No tag_request activity found for post {t1}")
        print(f"Activity: {activity}")
        return
    print(f"✓ PASS: B has tag_request activity for post t1")
    
    # Test 16: THIRD viewer C GET the post → people_tags is empty/[] (pending hidden from others). B's own view → my_tag_status=='pending'
    print("\n[TEST 16] Viewer C GET post t1 → people_tags empty (pending hidden). B's view → my_tag_status='pending'")
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers(c_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    c_feed = resp.json()
    c_post = next((p for p in c_feed if p.get('id') == t1), None)
    if not c_post:
        print(f"✗ FAIL: Post t1 not found in C's feed")
        return
    if c_post.get('people_tags'):
        print(f"✗ FAIL: C sees people_tags={c_post.get('people_tags')}, expected empty")
        return
    print(f"✓ C sees people_tags empty (pending hidden from others)")
    
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers(b_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    b_feed = resp.json()
    b_post = next((p for p in b_feed if p.get('id') == t1), None)
    if not b_post:
        print(f"✗ FAIL: Post t1 not found in B's feed")
        return
    if b_post.get('my_tag_status') != 'pending':
        print(f"✗ FAIL: B's my_tag_status is '{b_post.get('my_tag_status')}', expected 'pending'")
        return
    print(f"✓ PASS: B's my_tag_status='pending'")
    
    # Test 17: B POST /api/posts/{t1}/tag/approve → 200. Now C's view of t1 → people_tags contains B with status 'approved'
    print("\n[TEST 17] B approves tag → C now sees B in people_tags with status='approved'")
    resp = requests.post(f"{BASE_URL}/posts/{t1}/tag/approve", headers=headers(b_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    print(f"✓ B approved tag")
    
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers(c_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    c_feed = resp.json()
    c_post = next((p for p in c_feed if p.get('id') == t1), None)
    if not c_post:
        print(f"✗ FAIL: Post t1 not found in C's feed")
        return
    people_tags = c_post.get('people_tags', [])
    if not people_tags:
        print(f"✗ FAIL: C sees people_tags empty after B approved")
        return
    b_tag = next((pt for pt in people_tags if pt.get('handle') == b_handle), None)
    if not b_tag:
        print(f"✗ FAIL: B not found in people_tags")
        return
    if b_tag.get('status') != 'approved':
        print(f"✗ FAIL: B's tag status is '{b_tag.get('status')}', expected 'approved'")
        return
    print(f"✓ PASS: C sees B in people_tags with status='approved'")
    
    # Test 18: A creates another PUBLIC post tagging C (t2). C POST /api/posts/{t2}/tag/reject → 200. Then any viewer of t2 → people_tags empty (C removed)
    print("\n[TEST 18] A tags C in new post t2, C rejects → people_tags empty (C removed)")
    resp = requests.post(f"{BASE_URL}/posts",
                        json={"tier": "public", "text": "another squad", "people_tags": [c_handle]},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    t2 = resp.json().get('id')
    print(f"✓ Post t2={t2} created tagging C")
    
    resp = requests.post(f"{BASE_URL}/posts/{t2}/tag/reject", headers=headers(c_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    print(f"✓ C rejected tag")
    
    resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers(b_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    b_feed = resp.json()
    b_post_t2 = next((p for p in b_feed if p.get('id') == t2), None)
    if not b_post_t2:
        print(f"✗ FAIL: Post t2 not found in B's feed")
        return
    if b_post_t2.get('people_tags'):
        print(f"✗ FAIL: B sees people_tags={b_post_t2.get('people_tags')}, expected empty after C rejected")
        return
    print(f"✓ PASS: B sees people_tags empty (C removed after rejection)")
    
    # Test 19: EDGE: A creates post people_tags:['{A_handle}'] (self) → response people_tags is empty (self ignored)
    print("\n[TEST 19] EDGE: A tags self → people_tags empty (self ignored)")
    resp = requests.post(f"{BASE_URL}/posts",
                        json={"tier": "public", "text": "self tag", "people_tags": [a_handle]},
                        headers=headers(a_token))
    if resp.status_code != 200:
        print(f"✗ FAIL: {resp.status_code} {resp.text}")
        return
    self_post = resp.json()
    if self_post.get('people_tags'):
        print(f"✗ FAIL: Self-tag post has people_tags={self_post.get('people_tags')}, expected empty")
        return
    print(f"✓ PASS: Self-tag ignored, people_tags empty")
    
    # Test 20: EDGE: A (not tagged) POST /api/posts/{t2}/tag/approve → 403. Bad decision: B POST /api/posts/{t1}/tag/foo → 400
    print("\n[TEST 20] EDGE: A (not tagged) tries to approve t2 → 403. B tries bad decision 'foo' on t1 → 400")
    resp = requests.post(f"{BASE_URL}/posts/{t2}/tag/approve", headers=headers(a_token))
    if resp.status_code != 403:
        print(f"✗ FAIL: Expected 403, got {resp.status_code}")
        return
    print(f"✓ A (not tagged) got 403")
    
    resp = requests.post(f"{BASE_URL}/posts/{t1}/tag/foo", headers=headers(b_token))
    if resp.status_code != 400:
        print(f"✗ FAIL: Expected 400 for bad decision, got {resp.status_code}")
        return
    print(f"✓ PASS: Bad decision 'foo' got 400")
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("\n" + "=" * 80)
    print("ALL 20 TESTS PASSED ✓")
    print("=" * 80)
    print("\nSUMMARY:")
    print("(A) EDIT HISTORY (Tests 1-6): ✓ PASS")
    print("    - Post edit with history tracking (v1→v2→v3)")
    print("    - History endpoint returns current + previous versions (newest first)")
    print("    - edited_count exposed in feed")
    print("    - 403 for followers-tier post history (stranger blocked)")
    print("    - Wall post edit history working")
    print("\n(B) PINNED POSTS (Tests 7-13): ✓ PASS")
    print("    - Pin/unpin toggle working")
    print("    - Max 3 pins enforced (400 on 4th)")
    print("    - pinned_posts in profile with pinned=true")
    print("    - Non-author blocked (403)")
    print("    - Delete post removes from pinned_posts")
    print("\n(C) TAG-APPROVAL (Tests 14-20): ✓ PASS")
    print("    - Tag request activity sent to tagged user")
    print("    - Pending tags hidden from others, visible to tagged user with my_tag_status='pending'")
    print("    - Approve makes tag visible to all with status='approved'")
    print("    - Reject removes tag entirely")
    print("    - Self-tag ignored")
    print("    - Non-tagged user blocked (403), bad decision blocked (400)")

if __name__ == "__main__":
    main()
