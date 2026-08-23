#!/usr/bin/env python3
"""
Backend test for Comfort Zone content prefs + admin email allowlist
Tests the NEW comfort_zone feature and admin email allowlist changes.
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
print("COMFORT ZONE CONTENT PREFS + ADMIN EMAIL ALLOWLIST TESTS")
print("="*80 + "\n")

# ============================================================================
# TEST 1: Register fresh user with unique email
# ============================================================================
print("TEST 1: Register fresh user with unique email")
print("-" * 80)

# Generate unique random email
random_suffix = secrets.token_hex(4)
test_email = f"czqa+{random_suffix}@example.com"
test_password = "secret123"
test_name = "CZ QA"

# Register user
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
print(f"  → Token length: {len(test_token)} chars")

# ============================================================================
# TEST 2: GET /api/me → verify comfort_zone with defaults
# ============================================================================
print("\nTEST 2: GET /api/me → verify comfort_zone with defaults")
print("-" * 80)

me_resp = requests.get(f"{BASE_URL}/me", headers=headers(test_token))
print_test(
    "GET /api/me → 200",
    me_resp.status_code == 200,
    f"Status: {me_resp.status_code}"
)

if me_resp.status_code != 200:
    print(f"❌ FAIL: GET /api/me failed: {me_resp.text}")
    sys.exit(1)

me_data = me_resp.json()

# Verify comfort_zone exists
print_test(
    "Response includes 'comfort_zone' object",
    'comfort_zone' in me_data,
    f"comfort_zone present: {'comfort_zone' in me_data}"
)

if 'comfort_zone' not in me_data:
    print(f"❌ FAIL: comfort_zone not found in response: {json.dumps(me_data, indent=2)}")
    sys.exit(1)

comfort_zone = me_data['comfort_zone']

# Verify EXACTLY 5 keys
expected_keys = {'nsfw', 'ai', 'language', 'violence', 'drugs'}
actual_keys = set(comfort_zone.keys())
print_test(
    "comfort_zone has EXACTLY 5 keys: nsfw, ai, language, violence, drugs",
    actual_keys == expected_keys,
    f"Keys: {sorted(actual_keys)}"
)

# Verify default values
expected_defaults = {
    'nsfw': False,
    'ai': True,
    'language': True,
    'violence': False,
    'drugs': False
}

for key, expected_value in expected_defaults.items():
    actual_value = comfort_zone.get(key)
    print_test(
        f"comfort_zone.{key} = {expected_value}",
        actual_value == expected_value,
        f"Expected: {expected_value}, Got: {actual_value}"
    )

# Verify all values are booleans
all_bools = all(isinstance(v, bool) for v in comfort_zone.values())
print_test(
    "All comfort_zone values are booleans",
    all_bools,
    f"All bools: {all_bools}"
)

# ============================================================================
# TEST 3: PUT /api/profile with partial comfort_zone (nsfw:true, violence:true)
# ============================================================================
print("\nTEST 3: PUT /api/profile with partial comfort_zone")
print("-" * 80)

update_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(test_token),
    json={"comfort_zone": {"nsfw": True, "violence": True}}
)
print_test(
    "PUT /api/profile with {nsfw:true, violence:true} → 200",
    update_resp.status_code == 200,
    f"Status: {update_resp.status_code}"
)

if update_resp.status_code != 200:
    print(f"❌ FAIL: PUT /api/profile failed: {update_resp.text}")
    sys.exit(1)

# GET /api/me again to verify changes
me_resp2 = requests.get(f"{BASE_URL}/me", headers=headers(test_token))
print_test(
    "GET /api/me after update → 200",
    me_resp2.status_code == 200,
    f"Status: {me_resp2.status_code}"
)

if me_resp2.status_code != 200:
    print(f"❌ FAIL: GET /api/me failed: {me_resp2.text}")
    sys.exit(1)

me_data2 = me_resp2.json()
comfort_zone2 = me_data2.get('comfort_zone', {})

# Verify updated values with defaults merged
expected_after_update = {
    'nsfw': True,      # updated
    'ai': True,        # default (not changed)
    'language': True,  # default (not changed)
    'violence': True,  # updated
    'drugs': False     # default (not changed)
}

print_test(
    "comfort_zone still has EXACTLY 5 keys after update",
    set(comfort_zone2.keys()) == expected_keys,
    f"Keys: {sorted(comfort_zone2.keys())}"
)

for key, expected_value in expected_after_update.items():
    actual_value = comfort_zone2.get(key)
    print_test(
        f"comfort_zone.{key} = {expected_value} (after partial update)",
        actual_value == expected_value,
        f"Expected: {expected_value}, Got: {actual_value}"
    )

# ============================================================================
# TEST 4: PUT /api/profile with bogus_key → verify it's removed
# ============================================================================
print("\nTEST 4: PUT /api/profile with bogus_key → verify sanitization")
print("-" * 80)

update_resp3 = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(test_token),
    json={"comfort_zone": {"ai": False, "bogus_key": True, "language": False}}
)
print_test(
    "PUT /api/profile with {ai:false, bogus_key:true, language:false} → 200",
    update_resp3.status_code == 200,
    f"Status: {update_resp3.status_code}"
)

if update_resp3.status_code != 200:
    print(f"❌ FAIL: PUT /api/profile failed: {update_resp3.text}")
    sys.exit(1)

# GET /api/me again to verify sanitization
me_resp3 = requests.get(f"{BASE_URL}/me", headers=headers(test_token))
print_test(
    "GET /api/me after bogus_key update → 200",
    me_resp3.status_code == 200,
    f"Status: {me_resp3.status_code}"
)

if me_resp3.status_code != 200:
    print(f"❌ FAIL: GET /api/me failed: {me_resp3.text}")
    sys.exit(1)

me_data3 = me_resp3.json()
comfort_zone3 = me_data3.get('comfort_zone', {})

# Verify bogus_key is NOT present
print_test(
    "bogus_key is NOT present in comfort_zone",
    'bogus_key' not in comfort_zone3,
    f"bogus_key present: {'bogus_key' in comfort_zone3}"
)

# Verify only 5 known keys
print_test(
    "comfort_zone still has EXACTLY 5 keys (no bogus_key)",
    set(comfort_zone3.keys()) == expected_keys,
    f"Keys: {sorted(comfort_zone3.keys())}"
)

# According to the review request, sanitizer rebuilds from submitted dict using defaults for absent keys
# So expect: nsfw:false (default), ai:false (submitted), language:false (submitted), violence:false (default), drugs:false (default)
expected_after_bogus = {
    'nsfw': False,     # default (not in submitted dict)
    'ai': False,       # submitted
    'language': False, # submitted
    'violence': False, # default (not in submitted dict)
    'drugs': False     # default (not in submitted dict)
}

for key, expected_value in expected_after_bogus.items():
    actual_value = comfort_zone3.get(key)
    print_test(
        f"comfort_zone.{key} = {expected_value} (after sanitization)",
        actual_value == expected_value,
        f"Expected: {expected_value}, Got: {actual_value}"
    )

# ============================================================================
# TEST 5: Verify comfort_zone is NOT exposed on other users' public profiles
# ============================================================================
print("\nTEST 5: Verify comfort_zone is NOT exposed on other users' profiles")
print("-" * 80)

# Create another user to check the first user's profile
other_token, other_user = create_user("OtherUser")
print(f"  → Created OtherUser: {other_user['handle']}")

# OtherUser gets the first user's profile
other_profile_resp = requests.get(
    f"{BASE_URL}/users/{test_handle}",
    headers=headers(other_token)
)
print_test(
    f"GET /api/users/{test_handle} (as OtherUser) → 200",
    other_profile_resp.status_code == 200,
    f"Status: {other_profile_resp.status_code}"
)

if other_profile_resp.status_code != 200:
    print(f"❌ FAIL: GET /api/users/{test_handle} failed: {other_profile_resp.text}")
    sys.exit(1)

other_profile_data = other_profile_resp.json()

# Verify comfort_zone is NOT present
print_test(
    f"comfort_zone is NOT present in {test_handle}'s public profile",
    'comfort_zone' not in other_profile_data,
    f"comfort_zone present: {'comfort_zone' in other_profile_data}"
)

# ============================================================================
# TEST 6: ADMIN ALLOWLIST - Regular user is_admin should be false
# ============================================================================
print("\nTEST 6: ADMIN ALLOWLIST - Regular user is_admin = false")
print("-" * 80)

# Create a regular user
regular_token, regular_user = create_user("RegularUser")
print(f"  → Created RegularUser: {regular_user['handle']}")

# GET /api/me for regular user
regular_me_resp = requests.get(f"{BASE_URL}/me", headers=headers(regular_token))
print_test(
    "GET /api/me (regular user) → 200",
    regular_me_resp.status_code == 200,
    f"Status: {regular_me_resp.status_code}"
)

if regular_me_resp.status_code != 200:
    print(f"❌ FAIL: GET /api/me failed: {regular_me_resp.text}")
    sys.exit(1)

regular_me_data = regular_me_resp.json()
is_admin = regular_me_data.get('is_admin', False)

print_test(
    "Regular user has is_admin = false",
    is_admin == False,
    f"is_admin: {is_admin}"
)

# Regular user tries to access admin endpoint
admin_stats_resp = requests.get(f"{BASE_URL}/admin/stats", headers=headers(regular_token))
print_test(
    "Regular user GET /api/admin/stats → 403",
    admin_stats_resp.status_code == 403,
    f"Status: {admin_stats_resp.status_code}"
)

# ============================================================================
# TEST 7: ADMIN ALLOWLIST - admin@sandbox.clanchat should be admin
# ============================================================================
print("\nTEST 7: ADMIN ALLOWLIST - admin@sandbox.clanchat is admin")
print("-" * 80)

# Create admin user (dev-token with name 'Admin' creates email admin@sandbox.clanchat)
admin_token, admin_user = create_user("Admin")
print(f"  → Created Admin: {admin_user['handle']}")

# GET /api/me for admin user
admin_me_resp = requests.get(f"{BASE_URL}/me", headers=headers(admin_token))
print_test(
    "GET /api/me (admin user) → 200",
    admin_me_resp.status_code == 200,
    f"Status: {admin_me_resp.status_code}"
)

if admin_me_resp.status_code != 200:
    print(f"❌ FAIL: GET /api/me failed: {admin_me_resp.text}")
    sys.exit(1)

admin_me_data = admin_me_resp.json()
admin_is_admin = admin_me_data.get('is_admin', False)

print_test(
    "Admin user (admin@sandbox.clanchat) has is_admin = true",
    admin_is_admin == True,
    f"is_admin: {admin_is_admin}"
)

# Admin user accesses admin endpoint
admin_stats_resp2 = requests.get(f"{BASE_URL}/admin/stats", headers=headers(admin_token))
print_test(
    "Admin user GET /api/admin/stats → 200",
    admin_stats_resp2.status_code == 200,
    f"Status: {admin_stats_resp2.status_code}"
)

if admin_stats_resp2.status_code == 200:
    stats_data = admin_stats_resp2.json()
    print_test(
        "Admin stats contains expected fields",
        'users' in stats_data and 'posts' in stats_data,
        f"Stats: users={stats_data.get('users')}, posts={stats_data.get('posts')}"
    )

# ============================================================================
# TEST 8: QUICK REGRESSION - PUT /api/profile for display_name/follow_mode/dm_open
# ============================================================================
print("\nTEST 8: QUICK REGRESSION - PUT /api/profile for other fields")
print("-" * 80)

# Create a test user for regression
regression_token, regression_user = create_user("RegressionUser")
print(f"  → Created RegressionUser: {regression_user['handle']}")

# Update display_name
update_name_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(regression_token),
    json={"display_name": "Updated Name"}
)
print_test(
    "PUT /api/profile with display_name → 200",
    update_name_resp.status_code == 200,
    f"Status: {update_name_resp.status_code}"
)

# Verify display_name persisted
me_regression_resp = requests.get(f"{BASE_URL}/me", headers=headers(regression_token))
if me_regression_resp.status_code == 200:
    me_regression_data = me_regression_resp.json()
    print_test(
        "display_name persisted as 'Updated Name'",
        me_regression_data.get('display_name') == 'Updated Name',
        f"display_name: {me_regression_data.get('display_name')}"
    )

# Update follow_mode
update_follow_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(regression_token),
    json={"follow_mode": "approval"}
)
print_test(
    "PUT /api/profile with follow_mode='approval' → 200",
    update_follow_resp.status_code == 200,
    f"Status: {update_follow_resp.status_code}"
)

# Verify follow_mode persisted
me_regression_resp2 = requests.get(f"{BASE_URL}/me", headers=headers(regression_token))
if me_regression_resp2.status_code == 200:
    me_regression_data2 = me_regression_resp2.json()
    print_test(
        "follow_mode persisted as 'approval'",
        me_regression_data2.get('follow_mode') == 'approval',
        f"follow_mode: {me_regression_data2.get('follow_mode')}"
    )

# Update dm_open
update_dm_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(regression_token),
    json={"dm_open": False}
)
print_test(
    "PUT /api/profile with dm_open=false → 200",
    update_dm_resp.status_code == 200,
    f"Status: {update_dm_resp.status_code}"
)

# Verify dm_open persisted
me_regression_resp3 = requests.get(f"{BASE_URL}/me", headers=headers(regression_token))
if me_regression_resp3.status_code == 200:
    me_regression_data3 = me_regression_resp3.json()
    print_test(
        "dm_open persisted as false",
        me_regression_data3.get('dm_open') == False,
        f"dm_open: {me_regression_data3.get('dm_open')}"
    )

print("\n" + "="*80)
print("ALL TESTS PASSED ✅")
print("="*80 + "\n")
