#!/usr/bin/env python3
"""
Backend test for Real-name visibility + Admin DANGER ZONE + deleted stat
Tests the NEW real_name_visibility feature and admin promote/purge-demo endpoints.
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

def register_user(email, password, name):
    """Register a user via email/password and return (token, user_data)"""
    resp = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": password, "name": name})
    if resp.status_code != 200:
        print(f"❌ FAIL: Could not register user {email}: {resp.status_code} {resp.text}")
        sys.exit(1)
    data = resp.json()
    return data['access_token'], data['user']

def headers(token):
    """Return auth headers"""
    return {"Authorization": f"Bearer {token}"}

print("\n" + "="*80)
print("REAL-NAME VISIBILITY + ADMIN DANGER ZONE + DELETED STAT TESTS")
print("="*80 + "\n")

# ============================================================================
# A) REAL-NAME VISIBILITY TESTS
# ============================================================================
print("="*80)
print("A) REAL-NAME VISIBILITY TESTS")
print("="*80 + "\n")

# Generate unique random emails for Owner and Viewer
owner_suffix = secrets.token_hex(4)
viewer_suffix = secrets.token_hex(4)
owner_email = f"owner+{owner_suffix}@example.com"
viewer_email = f"viewer+{viewer_suffix}@example.com"

# ============================================================================
# TEST A1: Register Owner, set real_name + real_name_visibility=private
# ============================================================================
print("TEST A1: Register Owner, set real_name='Thomas Gallacher', real_name_visibility='private'")
print("-" * 80)

owner_token, owner_user = register_user(owner_email, "secret123", "Owner")
owner_handle = owner_user['handle']
print(f"  → Registered Owner: {owner_handle} (email: {owner_email})")

# Set real_name and real_name_visibility=private
update_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(owner_token),
    json={"real_name": "Thomas Gallacher", "real_name_visibility": "private"}
)
print_test(
    "PUT /api/profile {real_name:'Thomas Gallacher', real_name_visibility:'private'} → 200",
    update_resp.status_code == 200,
    f"Status: {update_resp.status_code}"
)

# GET /api/me to confirm self sees own real_name
me_resp = requests.get(f"{BASE_URL}/me", headers=headers(owner_token))
print_test(
    "GET /api/me → 200",
    me_resp.status_code == 200,
    f"Status: {me_resp.status_code}"
)

me_data = me_resp.json()
print_test(
    "Self sees own real_name='Thomas Gallacher'",
    me_data.get('real_name') == 'Thomas Gallacher',
    f"real_name: {me_data.get('real_name')}"
)
print_test(
    "Self sees own real_name_visibility='private'",
    me_data.get('real_name_visibility') == 'private',
    f"real_name_visibility: {me_data.get('real_name_visibility')}"
)

# ============================================================================
# TEST A2: Register Viewer, GET Owner's profile → real_name ABSENT (private)
# ============================================================================
print("\nTEST A2: Register Viewer, GET Owner's profile → real_name ABSENT (private)")
print("-" * 80)

viewer_token, viewer_user = register_user(viewer_email, "secret123", "Viewer")
viewer_handle = viewer_user['handle']
print(f"  → Registered Viewer: {viewer_handle} (email: {viewer_email})")

# Viewer gets Owner's profile
owner_profile_resp = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
print_test(
    f"GET /api/users/{owner_handle} (as Viewer) → 200",
    owner_profile_resp.status_code == 200,
    f"Status: {owner_profile_resp.status_code}"
)

owner_profile_data = owner_profile_resp.json()
print_test(
    "real_name is ABSENT from Owner's profile (visibility=private)",
    'real_name' not in owner_profile_data,
    f"real_name present: {'real_name' in owner_profile_data}"
)

# ============================================================================
# TEST A3: Owner sets visibility='public', Viewer sees real_name
# ============================================================================
print("\nTEST A3: Owner sets visibility='public', Viewer sees real_name")
print("-" * 80)

# Owner sets visibility to public
update_resp2 = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(owner_token),
    json={"real_name_visibility": "public"}
)
print_test(
    "PUT /api/profile {real_name_visibility:'public'} → 200",
    update_resp2.status_code == 200,
    f"Status: {update_resp2.status_code}"
)

# Viewer gets Owner's profile again
owner_profile_resp2 = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
print_test(
    f"GET /api/users/{owner_handle} (as Viewer, after public) → 200",
    owner_profile_resp2.status_code == 200,
    f"Status: {owner_profile_resp2.status_code}"
)

owner_profile_data2 = owner_profile_resp2.json()
print_test(
    "real_name is PRESENT in Owner's profile (visibility=public)",
    owner_profile_data2.get('real_name') == 'Thomas Gallacher',
    f"real_name: {owner_profile_data2.get('real_name')}"
)

# ============================================================================
# TEST A4: Owner sets visibility='followers', Viewer follows, sees real_name
# ============================================================================
print("\nTEST A4: Owner sets visibility='followers', Viewer follows, sees real_name")
print("-" * 80)

# Owner sets visibility to followers
update_resp3 = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(owner_token),
    json={"real_name_visibility": "followers"}
)
print_test(
    "PUT /api/profile {real_name_visibility:'followers'} → 200",
    update_resp3.status_code == 200,
    f"Status: {update_resp3.status_code}"
)

# Viewer gets Owner's profile (NOT following yet)
owner_profile_resp3 = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
owner_profile_data3 = owner_profile_resp3.json()
print_test(
    "real_name is ABSENT (Viewer not following yet)",
    'real_name' not in owner_profile_data3,
    f"real_name present: {'real_name' in owner_profile_data3}"
)

# Viewer follows Owner (Owner's follow_mode is 'open' by default, so auto-approved)
follow_resp = requests.post(
    f"{BASE_URL}/follow/{owner_handle}",
    headers=headers(viewer_token)
)
print_test(
    f"POST /api/follow/{owner_handle} (as Viewer) → 200",
    follow_resp.status_code == 200,
    f"Status: {follow_resp.status_code}, status: {follow_resp.json().get('status')}"
)

# Verify follow status is 'approved'
follow_data = follow_resp.json()
print_test(
    "Follow status is 'approved' (Owner's follow_mode is 'open')",
    follow_data.get('status') == 'approved',
    f"status: {follow_data.get('status')}"
)

# Viewer gets Owner's profile again (now following)
owner_profile_resp4 = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
owner_profile_data4 = owner_profile_resp4.json()
print_test(
    "real_name is PRESENT after following (visibility=followers)",
    owner_profile_data4.get('real_name') == 'Thomas Gallacher',
    f"real_name: {owner_profile_data4.get('real_name')}"
)

# ============================================================================
# TEST A5: Owner sets visibility='inner', Viewer joins inner circle, sees real_name
# ============================================================================
print("\nTEST A5: Owner sets visibility='inner', Viewer joins inner circle, sees real_name")
print("-" * 80)

# Owner sets visibility to inner
update_resp4 = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(owner_token),
    json={"real_name_visibility": "inner"}
)
print_test(
    "PUT /api/profile {real_name_visibility:'inner'} → 200",
    update_resp4.status_code == 200,
    f"Status: {update_resp4.status_code}"
)

# Viewer gets Owner's profile (follower but not inner yet)
owner_profile_resp5 = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
owner_profile_data5 = owner_profile_resp5.json()
print_test(
    "real_name is ABSENT (Viewer is follower but not inner member)",
    'real_name' not in owner_profile_data5,
    f"real_name present: {'real_name' in owner_profile_data5}"
)

# Owner invites Viewer to inner circle
invite_resp = requests.post(
    f"{BASE_URL}/inner/invite/{viewer_handle}",
    headers=headers(owner_token)
)
print_test(
    f"POST /api/inner/invite/{viewer_handle} (as Owner) → 200",
    invite_resp.status_code == 200,
    f"Status: {invite_resp.status_code}, status: {invite_resp.json().get('status')}"
)

# Viewer accepts inner circle invite
accept_resp = requests.post(
    f"{BASE_URL}/inner/accept/{owner_handle}",
    headers=headers(viewer_token)
)
print_test(
    f"POST /api/inner/accept/{owner_handle} (as Viewer) → 200",
    accept_resp.status_code == 200,
    f"Status: {accept_resp.status_code}, status: {accept_resp.json().get('status')}"
)

# Viewer gets Owner's profile again (now inner member)
owner_profile_resp6 = requests.get(
    f"{BASE_URL}/users/{owner_handle}",
    headers=headers(viewer_token)
)
owner_profile_data6 = owner_profile_resp6.json()
print_test(
    "real_name is PRESENT after joining inner circle (visibility=inner)",
    owner_profile_data6.get('real_name') == 'Thomas Gallacher',
    f"real_name: {owner_profile_data6.get('real_name')}"
)

# ============================================================================
# TEST A6: Invalid visibility value → ignored (unchanged)
# ============================================================================
print("\nTEST A6: Invalid visibility value 'bogus' → ignored (unchanged)")
print("-" * 80)

# Get current visibility
me_resp2 = requests.get(f"{BASE_URL}/me", headers=headers(owner_token))
me_data2 = me_resp2.json()
current_visibility = me_data2.get('real_name_visibility')
print(f"  → Current visibility: {current_visibility}")

# Try to set invalid visibility
update_resp5 = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(owner_token),
    json={"real_name_visibility": "bogus"}
)
print_test(
    "PUT /api/profile {real_name_visibility:'bogus'} → 200",
    update_resp5.status_code == 200,
    f"Status: {update_resp5.status_code}"
)

# Get visibility again
me_resp3 = requests.get(f"{BASE_URL}/me", headers=headers(owner_token))
me_data3 = me_resp3.json()
new_visibility = me_data3.get('real_name_visibility')
print_test(
    "Invalid visibility 'bogus' was IGNORED (unchanged)",
    new_visibility == current_visibility,
    f"Previous: {current_visibility}, Current: {new_visibility}"
)

# ============================================================================
# B) DELETED STAT + PURGE TESTS
# ============================================================================
print("\n" + "="*80)
print("B) DELETED STAT + PURGE TESTS")
print("="*80 + "\n")

# ============================================================================
# TEST B1: GET /api/admin/stats as admin → includes 'deleted' field
# ============================================================================
print("TEST B1: GET /api/admin/stats as admin → includes 'deleted' field")
print("-" * 80)

# Create admin user
admin_token, admin_user = create_user("Admin")
print(f"  → Created Admin: {admin_user['handle']}")

# GET /api/admin/stats
stats_resp = requests.get(f"{BASE_URL}/admin/stats", headers=headers(admin_token))
print_test(
    "GET /api/admin/stats (as admin) → 200",
    stats_resp.status_code == 200,
    f"Status: {stats_resp.status_code}"
)

stats_data = stats_resp.json()
print_test(
    "Stats includes 'deleted' field",
    'deleted' in stats_data,
    f"deleted present: {'deleted' in stats_data}"
)

deleted_count_before = stats_data.get('deleted', 0)
print(f"  → Current deleted count: {deleted_count_before}")

# ============================================================================
# TEST B2: Register throwaway user, delete account, verify deleted count increments
# ============================================================================
print("\nTEST B2: Register throwaway user, delete account, verify deleted count increments")
print("-" * 80)

# Register throwaway user
throwaway_suffix = secrets.token_hex(4)
throwaway_email = f"throwaway+{throwaway_suffix}@example.com"
throwaway_token, throwaway_user = register_user(throwaway_email, "secret123", "Throwaway")
throwaway_handle = throwaway_user['handle']
print(f"  → Registered Throwaway: {throwaway_handle} (email: {throwaway_email})")

# Delete account
delete_resp = requests.delete(f"{BASE_URL}/account", headers=headers(throwaway_token))
print_test(
    "DELETE /api/account (as throwaway) → 200",
    delete_resp.status_code == 200,
    f"Status: {delete_resp.status_code}"
)

# GET /api/admin/stats again
stats_resp2 = requests.get(f"{BASE_URL}/admin/stats", headers=headers(admin_token))
stats_data2 = stats_resp2.json()
deleted_count_after = stats_data2.get('deleted', 0)
print_test(
    "Deleted count incremented by 1",
    deleted_count_after == deleted_count_before + 1,
    f"Before: {deleted_count_before}, After: {deleted_count_after}"
)

# ============================================================================
# C) ADMIN DANGER ZONE TESTS
# ============================================================================
print("\n" + "="*80)
print("C) ADMIN DANGER ZONE TESTS")
print("="*80 + "\n")

# ============================================================================
# TEST C1: POST /api/admin/promote as regular user → 403
# ============================================================================
print("TEST C1: POST /api/admin/promote as regular user → 403")
print("-" * 80)

# Create regular user
regular_token, regular_user = create_user("RegularUser")
print(f"  → Created RegularUser: {regular_user['handle']}")

# Try to promote as regular user
promote_resp = requests.post(
    f"{BASE_URL}/admin/promote",
    headers=headers(regular_token),
    json={"email": "someone@example.com"}
)
print_test(
    "POST /api/admin/promote (as regular user) → 403",
    promote_resp.status_code == 403,
    f"Status: {promote_resp.status_code}"
)

# ============================================================================
# TEST C2: POST /api/admin/promote as admin with real user email → 200
# ============================================================================
print("\nTEST C2: POST /api/admin/promote as admin with real user email → 200")
print("-" * 80)

# Register a user to promote
promote_target_suffix = secrets.token_hex(4)
promote_target_email = f"promoteme+{promote_target_suffix}@example.com"
promote_target_token, promote_target_user = register_user(promote_target_email, "secret123", "PromoteMe")
promote_target_handle = promote_target_user['handle']
print(f"  → Registered PromoteMe: {promote_target_handle} (email: {promote_target_email})")

# Verify user is NOT admin initially
me_resp4 = requests.get(f"{BASE_URL}/me", headers=headers(promote_target_token))
me_data4 = me_resp4.json()
print_test(
    "PromoteMe user is NOT admin initially",
    me_data4.get('is_admin') == False,
    f"is_admin: {me_data4.get('is_admin')}"
)

# Admin promotes the user
promote_resp2 = requests.post(
    f"{BASE_URL}/admin/promote",
    headers=headers(admin_token),
    json={"email": promote_target_email}
)
print_test(
    f"POST /api/admin/promote {{email:'{promote_target_email}'}} (as admin) → 200",
    promote_resp2.status_code == 200,
    f"Status: {promote_resp2.status_code}"
)

promote_data = promote_resp2.json()
print_test(
    f"Response includes promoted handle: {promote_target_handle}",
    promote_data.get('promoted') == promote_target_handle,
    f"promoted: {promote_data.get('promoted')}"
)

# Verify user is NOW admin
me_resp5 = requests.get(f"{BASE_URL}/me", headers=headers(promote_target_token))
me_data5 = me_resp5.json()
print_test(
    "PromoteMe user is NOW admin (is_admin=true)",
    me_data5.get('is_admin') == True,
    f"is_admin: {me_data5.get('is_admin')}"
)

# ============================================================================
# TEST C3: POST /api/admin/promote with non-existent email → 404
# ============================================================================
print("\nTEST C3: POST /api/admin/promote with non-existent email → 404")
print("-" * 80)

# Try to promote non-existent user
nonexistent_email = f"nobody-{secrets.token_hex(4)}@example.com"
promote_resp3 = requests.post(
    f"{BASE_URL}/admin/promote",
    headers=headers(admin_token),
    json={"email": nonexistent_email}
)
print_test(
    f"POST /api/admin/promote {{email:'{nonexistent_email}'}} → 404",
    promote_resp3.status_code == 404,
    f"Status: {promote_resp3.status_code}"
)

# ============================================================================
# TEST C4: POST /api/admin/purge-demo as regular user → 403
# ============================================================================
print("\nTEST C4: POST /api/admin/purge-demo as regular user → 403")
print("-" * 80)

# Try to purge as regular user
purge_resp = requests.post(
    f"{BASE_URL}/admin/purge-demo",
    headers=headers(regular_token),
    json={"include_admin": False}
)
print_test(
    "POST /api/admin/purge-demo (as regular user) → 403",
    purge_resp.status_code == 403,
    f"Status: {purge_resp.status_code}"
)

# ============================================================================
# TEST C5: POST /api/admin/purge-demo as admin → 200 with {purged, count}
# ============================================================================
print("\nTEST C5: POST /api/admin/purge-demo as admin → 200 with {purged, count}")
print("-" * 80)

# Admin purges demo accounts
purge_resp2 = requests.post(
    f"{BASE_URL}/admin/purge-demo",
    headers=headers(admin_token),
    json={"include_admin": False}
)
print_test(
    "POST /api/admin/purge-demo {{include_admin:false}} (as admin) → 200",
    purge_resp2.status_code == 200,
    f"Status: {purge_resp2.status_code}"
)

purge_data = purge_resp2.json()
print_test(
    "Response includes 'purged' array",
    'purged' in purge_data,
    f"purged present: {'purged' in purge_data}"
)
print_test(
    "Response includes 'count' field",
    'count' in purge_data,
    f"count present: {'count' in purge_data}"
)

print(f"  → Purged: {purge_data.get('purged', [])}, Count: {purge_data.get('count', 0)}")

# Verify admin is NOT deleted
me_resp6 = requests.get(f"{BASE_URL}/me", headers=headers(admin_token))
print_test(
    "Admin user is NOT deleted (still can access /api/me)",
    me_resp6.status_code == 200,
    f"Status: {me_resp6.status_code}"
)

# ============================================================================
# D) REGRESSION TESTS
# ============================================================================
print("\n" + "="*80)
print("D) REGRESSION TESTS")
print("="*80 + "\n")

# ============================================================================
# TEST D1: PUT /api/profile display_name still works
# ============================================================================
print("TEST D1: PUT /api/profile display_name still works")
print("-" * 80)

# Create regression test user
regression_token, regression_user = create_user("RegressionUser")
print(f"  → Created RegressionUser: {regression_user['handle']}")

# Update display_name
update_name_resp = requests.put(
    f"{BASE_URL}/profile",
    headers=headers(regression_token),
    json={"display_name": "Updated Name"}
)
print_test(
    "PUT /api/profile {{display_name:'Updated Name'}} → 200",
    update_name_resp.status_code == 200,
    f"Status: {update_name_resp.status_code}"
)

# Verify display_name persisted
me_resp7 = requests.get(f"{BASE_URL}/me", headers=headers(regression_token))
me_data7 = me_resp7.json()
print_test(
    "display_name persisted as 'Updated Name'",
    me_data7.get('display_name') == 'Updated Name',
    f"display_name: {me_data7.get('display_name')}"
)

# ============================================================================
# TEST D2: GET /api/me returns comfort_zone
# ============================================================================
print("\nTEST D2: GET /api/me returns comfort_zone")
print("-" * 80)

# Verify comfort_zone is present
print_test(
    "GET /api/me returns comfort_zone",
    'comfort_zone' in me_data7,
    f"comfort_zone present: {'comfort_zone' in me_data7}"
)

comfort_zone = me_data7.get('comfort_zone', {})
expected_keys = {'nsfw', 'ai', 'language', 'violence', 'drugs'}
print_test(
    "comfort_zone has all 5 keys",
    set(comfort_zone.keys()) == expected_keys,
    f"Keys: {sorted(comfort_zone.keys())}"
)

print("\n" + "="*80)
print("ALL TESTS PASSED ✅")
print("="*80 + "\n")
