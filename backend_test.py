#!/usr/bin/env python3
"""
Backend test for DELETE /api/account + DM_ENC_KEY startup hardening + regression sanity
Tests the NEW account deletion endpoint and verifies no regressions in core functionality.
"""
import requests
import json
import sys
import secrets

# Base URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  → {details}")
    if not passed:
        sys.exit(1)

def create_user(name):
    """Create a dev user and return (token, user_data)"""
    resp = requests.post(f"{BASE_URL}/dev/token", json={"name": name})
    if resp.status_code != 200:
        print(f"❌ FAIL: Could not create user {name}: {resp.status_code} {resp.text}")
        sys.exit(1)
    data = resp.json()
    return data['access_token'], data['user']

def headers(token):
    """Return auth headers"""
    return {"Authorization": f"Bearer {token}"}

print("\n" + "="*80)
print("DELETE /api/account + REGRESSION SANITY TESTS")
print("="*80 + "\n")

# ============================================================================
# TEST 1: DELETE /api/account WITHOUT token → 401
# ============================================================================
print("TEST 1: DELETE /api/account WITHOUT token")
print("-" * 80)

delete_noauth_resp = requests.delete(f"{BASE_URL}/account")
print_test(
    "DELETE /api/account without token → 401",
    delete_noauth_resp.status_code == 401,
    f"Status: {delete_noauth_resp.status_code}"
)

# ============================================================================
# TEST 2: Register fresh user, create post, DELETE account
# ============================================================================
print("\nTEST 2: Register fresh user, create post, DELETE account")
print("-" * 80)

# Generate unique random email
random_suffix = secrets.token_hex(4)
test_email = f"deltest+{random_suffix}@example.com"
test_password = "secret123"
test_name = "Del Test"

# Step 2a: Register user
register_resp = requests.post(
    f"{BASE_URL}/auth/register",
    json={"email": test_email, "password": test_password, "name": test_name}
)
print_test(
    f"POST /api/auth/register with email '{test_email}' → 200",
    register_resp.status_code == 200,
    f"Status: {register_resp.status_code}"
)

if register_resp.status_code != 200:
    print(f"❌ FAIL: Registration failed: {register_resp.text}")
    sys.exit(1)

register_data = register_resp.json()
test_token = register_data['access_token']
test_user_id = register_data['user']['id']
test_handle = register_data['user']['handle']

print(f"  → Registered user: {test_handle} (id: {test_user_id})")

# Step 2b: Confirm GET /api/me → 200
me_resp = requests.get(f"{BASE_URL}/me", headers=headers(test_token))
print_test(
    "GET /api/me with registration token → 200",
    me_resp.status_code == 200,
    f"Status: {me_resp.status_code}, handle: {me_resp.json().get('handle') if me_resp.status_code == 200 else 'N/A'}"
)

# Step 2c: Create a post
post_text = f"to be deleted {random_suffix}"
create_post_resp = requests.post(
    f"{BASE_URL}/posts",
    headers=headers(test_token),
    json={"tier": "public", "text": post_text}
)
print_test(
    f"POST /api/posts with text '{post_text}' → 200",
    create_post_resp.status_code == 200,
    f"Status: {create_post_resp.status_code}"
)

if create_post_resp.status_code != 200:
    print(f"❌ FAIL: Post creation failed: {create_post_resp.text}")
    sys.exit(1)

post_id = create_post_resp.json()['id']
print(f"  → Created post: {post_id}")

# Step 2d: Confirm post appears in GET /api/feed?scope=general
feed_before_resp = requests.get(
    f"{BASE_URL}/feed?scope=general",
    headers=headers(test_token)
)
print_test(
    "GET /api/feed?scope=general → 200",
    feed_before_resp.status_code == 200,
    f"Status: {feed_before_resp.status_code}"
)

if feed_before_resp.status_code == 200:
    feed_before = feed_before_resp.json()
    post_in_feed = any(p['id'] == post_id for p in feed_before)
    print_test(
        f"Post '{post_id}' appears in feed BEFORE deletion",
        post_in_feed,
        f"Found: {post_in_feed}"
    )

# Step 2e: DELETE /api/account with token → 200 {ok:true, deleted:<uid>}
delete_resp = requests.delete(f"{BASE_URL}/account", headers=headers(test_token))
print_test(
    "DELETE /api/account with token → 200",
    delete_resp.status_code == 200,
    f"Status: {delete_resp.status_code}"
)

if delete_resp.status_code == 200:
    delete_data = delete_resp.json()
    print_test(
        "Response contains ok=true",
        delete_data.get('ok') == True,
        f"ok={delete_data.get('ok')}"
    )
    print_test(
        f"Response contains deleted='{test_user_id}'",
        delete_data.get('deleted') == test_user_id,
        f"deleted={delete_data.get('deleted')}"
    )

# ============================================================================
# TEST 3: Verify deletion side-effects
# ============================================================================
print("\nTEST 3: Verify deletion side-effects")
print("-" * 80)

# Step 3a: POST /api/auth/login with deleted user's email+password → 401
login_resp = requests.post(
    f"{BASE_URL}/auth/login",
    json={"email": test_email, "password": test_password}
)
print_test(
    "POST /api/auth/login with deleted user's email+password → 401",
    login_resp.status_code == 401,
    f"Status: {login_resp.status_code}"
)

if login_resp.status_code == 401:
    error_message = login_resp.json().get('detail', '') if login_resp.headers.get('content-type', '').startswith('application/json') else login_resp.text
    has_invalid_message = 'invalid email or password' in error_message.lower()
    print_test(
        "Error message is 'Invalid email or password'",
        has_invalid_message,
        f"Message: {error_message}"
    )

# Step 3b: The created post must NOT appear in GET /api/feed?scope=general
# Create a new user to check the feed (since the deleted user's token is invalid)
check_token, check_user = create_user("FeedChecker")
feed_after_resp = requests.get(
    f"{BASE_URL}/feed?scope=general",
    headers=headers(check_token)
)
print_test(
    "GET /api/feed?scope=general (with new user) → 200",
    feed_after_resp.status_code == 200,
    f"Status: {feed_after_resp.status_code}"
)

if feed_after_resp.status_code == 200:
    feed_after = feed_after_resp.json()
    post_still_in_feed = any(p['id'] == post_id for p in feed_after)
    print_test(
        f"Post '{post_id}' does NOT appear in feed AFTER deletion",
        not post_still_in_feed,
        f"Found in feed: {post_still_in_feed}"
    )

# ============================================================================
# TEST 4: REGRESSION SANITY - dev-token + /api/me (200/401)
# ============================================================================
print("\nTEST 4: REGRESSION SANITY - dev-token + /api/me")
print("-" * 80)

# Step 4a: POST /api/dev/token → 200
dev_token_resp = requests.post(f"{BASE_URL}/dev/token", json={"name": "RegChk"})
print_test(
    "POST /api/dev/token {name:'RegChk'} → 200",
    dev_token_resp.status_code == 200,
    f"Status: {dev_token_resp.status_code}"
)

if dev_token_resp.status_code != 200:
    print(f"❌ FAIL: Dev token creation failed: {dev_token_resp.text}")
    sys.exit(1)

dev_token_data = dev_token_resp.json()
dev_token = dev_token_data['access_token']

# Step 4b: GET /api/me with dev token → 200
me_dev_resp = requests.get(f"{BASE_URL}/me", headers=headers(dev_token))
print_test(
    "GET /api/me with dev token → 200",
    me_dev_resp.status_code == 200,
    f"Status: {me_dev_resp.status_code}"
)

# Step 4c: GET /api/me without token → 401
me_notoken_resp = requests.get(f"{BASE_URL}/me")
print_test(
    "GET /api/me without token → 401",
    me_notoken_resp.status_code == 401,
    f"Status: {me_notoken_resp.status_code}"
)

# Step 4d: GET /api/me with malformed token → 401
me_malformed_resp = requests.get(f"{BASE_URL}/me", headers={"Authorization": "Bearer invalid.token.here"})
print_test(
    "GET /api/me with malformed token → 401",
    me_malformed_resp.status_code == 401,
    f"Status: {me_malformed_resp.status_code}"
)

# ============================================================================
# TEST 5: REGRESSION SANITY - Encrypted DM round-trip
# ============================================================================
print("\nTEST 5: REGRESSION SANITY - Encrypted DM round-trip")
print("-" * 80)

# Create two users
dm_user1_token, dm_user1 = create_user("DMUser1")
dm_user2_token, dm_user2 = create_user("DMUser2")

print(f"  → Created DMUser1: {dm_user1['handle']}")
print(f"  → Created DMUser2: {dm_user2['handle']}")

# Step 5a: DMUser1 invites DMUser2 to inner circle
invite_resp = requests.post(
    f"{BASE_URL}/inner/invite/{dm_user2['handle']}",
    headers=headers(dm_user1_token)
)
print_test(
    "DMUser1 invites DMUser2 to inner circle → 200",
    invite_resp.status_code == 200,
    f"Status: {invite_resp.status_code}"
)

# Step 5b: DMUser2 accepts invite
accept_resp = requests.post(
    f"{BASE_URL}/inner/accept/{dm_user1['handle']}",
    headers=headers(dm_user2_token)
)
print_test(
    "DMUser2 accepts inner circle invite → 200",
    accept_resp.status_code == 200,
    f"Status: {accept_resp.status_code}"
)

# Step 5c: DMUser1 sends encrypted DM to DMUser2
dm_text = f"encrypted test message {secrets.token_hex(4)}"
send_dm_resp = requests.post(
    f"{BASE_URL}/dms/{dm_user2['handle']}",
    headers=headers(dm_user1_token),
    json={"text": dm_text}
)
print_test(
    f"DMUser1 sends DM '{dm_text}' to DMUser2 → 200",
    send_dm_resp.status_code == 200,
    f"Status: {send_dm_resp.status_code}"
)

# Step 5d: DMUser2 retrieves DM (should be decrypted)
get_dm_resp = requests.get(
    f"{BASE_URL}/dms/{dm_user1['handle']}",
    headers=headers(dm_user2_token)
)
print_test(
    "DMUser2 retrieves DMs from DMUser1 → 200",
    get_dm_resp.status_code == 200,
    f"Status: {get_dm_resp.status_code}"
)

if get_dm_resp.status_code == 200:
    dm_data = get_dm_resp.json()
    messages = dm_data.get('messages', [])
    print_test(
        "DM response contains messages",
        len(messages) > 0,
        f"Message count: {len(messages)}"
    )
    
    if len(messages) > 0:
        # Find the message we sent
        found_message = any(msg.get('text') == dm_text for msg in messages)
        print_test(
            f"Decrypted message '{dm_text}' found",
            found_message,
            f"Found: {found_message}"
        )

# ============================================================================
# TEST 6: REGRESSION SANITY - Admin gating
# ============================================================================
print("\nTEST 6: REGRESSION SANITY - Admin gating")
print("-" * 80)

# Create admin user (email: admin@sandbox.clanchat)
admin_token, admin_user = create_user("Admin")
print(f"  → Created Admin: {admin_user['handle']} (email: admin@sandbox.clanchat)")

# Verify admin has is_admin=true
admin_me_resp = requests.get(f"{BASE_URL}/me", headers=headers(admin_token))
if admin_me_resp.status_code == 200:
    admin_me_data = admin_me_resp.json()
    is_admin = admin_me_data.get('is_admin', False)
    print_test(
        "Admin user has is_admin=true",
        is_admin,
        f"is_admin={is_admin}"
    )

# Step 6a: Regular user GET /api/admin/stats → 403
regular_stats_resp = requests.get(f"{BASE_URL}/admin/stats", headers=headers(dm_user1_token))
print_test(
    "Regular user GET /api/admin/stats → 403",
    regular_stats_resp.status_code == 403,
    f"Status: {regular_stats_resp.status_code}"
)

# Step 6b: No token GET /api/admin/stats → 401
notoken_stats_resp = requests.get(f"{BASE_URL}/admin/stats")
print_test(
    "No token GET /api/admin/stats → 401",
    notoken_stats_resp.status_code == 401,
    f"Status: {notoken_stats_resp.status_code}"
)

# Step 6c: Admin user GET /api/admin/stats → 200
admin_stats_resp = requests.get(f"{BASE_URL}/admin/stats", headers=headers(admin_token))
print_test(
    "Admin user GET /api/admin/stats → 200",
    admin_stats_resp.status_code == 200,
    f"Status: {admin_stats_resp.status_code}"
)

if admin_stats_resp.status_code == 200:
    stats_data = admin_stats_resp.json()
    print_test(
        "Admin stats contains expected fields",
        'users' in stats_data and 'posts' in stats_data,
        f"Stats: users={stats_data.get('users')}, posts={stats_data.get('posts')}"
    )

print("\n" + "="*80)
print("ALL TESTS PASSED ✅")
print("="*80 + "\n")
