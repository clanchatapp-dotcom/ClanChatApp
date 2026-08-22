#!/usr/bin/env python3
"""
Backend test for Admin: flag suspicious accounts + discreet encrypted-DM review
Tests the NEW admin feature for flagging accounts and reviewing their encrypted DMs.
"""
import requests
import json
import sys

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
print("ADMIN FLAG + DISCREET DM REVIEW TESTS")
print("="*80 + "\n")

# ============================================================================
# SETUP: Create users
# ============================================================================
print("SETUP: Creating users...")
admin_token, admin_user = create_user("Admin")
suspect_token, suspect_user = create_user("Suspect")
contact_token, contact_user = create_user("Contact")

print(f"  Admin: {admin_user['handle']} (email: admin@sandbox.clanchat)")
print(f"  Suspect: {suspect_user['handle']}")
print(f"  Contact: {contact_user['handle']}")

# Verify admin has is_admin=true
me_resp = requests.get(f"{BASE_URL}/me", headers=headers(admin_token))
if me_resp.status_code == 200:
    me_data = me_resp.json()
    is_admin = me_data.get('is_admin', False)
    print_test("Admin user has is_admin=true", is_admin, f"is_admin={is_admin}")
else:
    print_test("Admin user verification", False, f"GET /me failed: {me_resp.status_code}")

# ============================================================================
# SETUP: Create DM conversation between Suspect and Contact
# ============================================================================
print("\nSETUP: Creating DM conversation between Suspect and Contact...")

# Step 1: Suspect invites Contact to inner circle
invite_resp = requests.post(
    f"{BASE_URL}/inner/invite/{contact_user['handle']}",
    headers=headers(suspect_token)
)
print_test(
    "Suspect invites Contact to inner circle",
    invite_resp.status_code == 200,
    f"Status: {invite_resp.status_code}"
)

# Step 2: Contact accepts Suspect's inner circle invite
accept_resp = requests.post(
    f"{BASE_URL}/inner/accept/{suspect_user['handle']}",
    headers=headers(contact_token)
)
print_test(
    "Contact accepts Suspect's inner circle invite",
    accept_resp.status_code == 200,
    f"Status: {accept_resp.status_code}"
)

# Step 3: Suspect sends DM to Contact
dm1_resp = requests.post(
    f"{BASE_URL}/dms/{contact_user['handle']}",
    headers=headers(suspect_token),
    json={"text": "secret plan alpha"}
)
print_test(
    "Suspect sends DM 'secret plan alpha' to Contact",
    dm1_resp.status_code == 200,
    f"Status: {dm1_resp.status_code}"
)

# Step 4: Contact sends DM to Suspect
dm2_resp = requests.post(
    f"{BASE_URL}/dms/{suspect_user['handle']}",
    headers=headers(contact_token),
    json={"text": "roger that bravo"}
)
print_test(
    "Contact sends DM 'roger that bravo' to Suspect",
    dm2_resp.status_code == 200,
    f"Status: {dm2_resp.status_code}"
)

print("\n" + "="*80)
print("TEST 1: ADMIN GATING")
print("="*80 + "\n")

# Test 1a: Regular user (Contact) tries to flag - should get 403
flag_regular_resp = requests.post(
    f"{BASE_URL}/admin/users/{suspect_user['handle']}/flag",
    headers=headers(contact_token),
    json={"reason": "test"}
)
print_test(
    "Regular user (Contact) POST /admin/users/{handle}/flag → 403",
    flag_regular_resp.status_code == 403,
    f"Status: {flag_regular_resp.status_code}"
)

# Test 1b: Regular user tries to view DMs - should get 403
dm_regular_resp = requests.get(
    f"{BASE_URL}/admin/dms/{suspect_user['handle']}",
    headers=headers(contact_token)
)
print_test(
    "Regular user (Contact) GET /admin/dms/{handle} → 403",
    dm_regular_resp.status_code == 403,
    f"Status: {dm_regular_resp.status_code}"
)

# Test 1c: No token - should get 401
flag_noauth_resp = requests.post(
    f"{BASE_URL}/admin/users/{suspect_user['handle']}/flag",
    json={"reason": "test"}
)
print_test(
    "No token POST /admin/users/{handle}/flag → 401",
    flag_noauth_resp.status_code == 401,
    f"Status: {flag_noauth_resp.status_code}"
)

dm_noauth_resp = requests.get(
    f"{BASE_URL}/admin/dms/{suspect_user['handle']}"
)
print_test(
    "No token GET /admin/dms/{handle} → 401",
    dm_noauth_resp.status_code == 401,
    f"Status: {dm_noauth_resp.status_code}"
)

# Test 1d: Admin user - should be allowed
flag_admin_test_resp = requests.get(
    f"{BASE_URL}/admin/stats",
    headers=headers(admin_token)
)
print_test(
    "Admin user GET /admin/stats → 200",
    flag_admin_test_resp.status_code == 200,
    f"Status: {flag_admin_test_resp.status_code}"
)

print("\n" + "="*80)
print("TEST 2: DM REVIEW REQUIRES FLAG")
print("="*80 + "\n")

# Test 2: Admin tries to view DMs BEFORE flagging - should get 403
dm_before_flag_resp = requests.get(
    f"{BASE_URL}/admin/dms/{suspect_user['handle']}",
    headers=headers(admin_token)
)
print_test(
    "Admin GET /admin/dms/{handle} BEFORE flagging → 403",
    dm_before_flag_resp.status_code == 403,
    f"Status: {dm_before_flag_resp.status_code}, Message: {dm_before_flag_resp.text}"
)

# Verify the error message mentions flagging requirement
if dm_before_flag_resp.status_code == 403:
    error_text = dm_before_flag_resp.text.lower()
    has_flag_message = 'flag' in error_text or 'suspicious' in error_text
    print_test(
        "Error message mentions flagging requirement",
        has_flag_message,
        f"Error text contains 'flag' or 'suspicious': {has_flag_message}"
    )

print("\n" + "="*80)
print("TEST 3: FLAG USER")
print("="*80 + "\n")

# Test 3a: Admin flags Suspect
flag_resp = requests.post(
    f"{BASE_URL}/admin/users/{suspect_user['handle']}/flag",
    headers=headers(admin_token),
    json={"reason": "suspicious activity"}
)
print_test(
    "Admin POST /admin/users/{handle}/flag → 200",
    flag_resp.status_code == 200,
    f"Status: {flag_resp.status_code}"
)

if flag_resp.status_code == 200:
    flag_data = flag_resp.json()
    print_test(
        "Flag response contains ok=true and flagged=true",
        flag_data.get('ok') == True and flag_data.get('flagged') == True,
        f"Response: {flag_data}"
    )

# Test 3b: Verify user appears in admin users list with flagged=true
users_resp = requests.get(
    f"{BASE_URL}/admin/users?q=suspect",
    headers=headers(admin_token)
)
print_test(
    "Admin GET /admin/users?q=suspect → 200",
    users_resp.status_code == 200,
    f"Status: {users_resp.status_code}"
)

if users_resp.status_code == 200:
    users_data = users_resp.json()
    suspect_in_list = None
    for user in users_data:
        if user['handle'] == suspect_user['handle']:
            suspect_in_list = user
            break
    
    print_test(
        "Suspect user found in admin users list",
        suspect_in_list is not None,
        f"Found: {suspect_in_list is not None}"
    )
    
    if suspect_in_list:
        print_test(
            "Suspect user has flagged=true",
            suspect_in_list.get('flagged') == True,
            f"flagged={suspect_in_list.get('flagged')}"
        )
        print_test(
            "Suspect user has flag_reason='suspicious activity'",
            suspect_in_list.get('flag_reason') == 'suspicious activity',
            f"flag_reason='{suspect_in_list.get('flag_reason')}'"
        )

# Test 3c: Verify admin stats shows flagged count >= 1
stats_resp = requests.get(
    f"{BASE_URL}/admin/stats",
    headers=headers(admin_token)
)
if stats_resp.status_code == 200:
    stats_data = stats_resp.json()
    print_test(
        "Admin stats shows flagged >= 1",
        stats_data.get('flagged', 0) >= 1,
        f"flagged={stats_data.get('flagged', 0)}"
    )

print("\n" + "="*80)
print("TEST 4: DISCREET DM REVIEW")
print("="*80 + "\n")

# Test 4: Admin views DMs of flagged user
dm_review_resp = requests.get(
    f"{BASE_URL}/admin/dms/{suspect_user['handle']}",
    headers=headers(admin_token)
)
print_test(
    "Admin GET /admin/dms/{handle} AFTER flagging → 200",
    dm_review_resp.status_code == 200,
    f"Status: {dm_review_resp.status_code}"
)

if dm_review_resp.status_code == 200:
    dm_data = dm_review_resp.json()
    
    # Verify structure
    print_test(
        "Response contains 'user' and 'threads' fields",
        'user' in dm_data and 'threads' in dm_data,
        f"Keys: {list(dm_data.keys())}"
    )
    
    # Verify user info
    if 'user' in dm_data:
        user_info = dm_data['user']
        print_test(
            "User info contains handle and flag_reason",
            user_info.get('handle') == suspect_user['handle'] and 
            user_info.get('flag_reason') == 'suspicious activity',
            f"handle={user_info.get('handle')}, flag_reason={user_info.get('flag_reason')}"
        )
    
    # Verify threads
    if 'threads' in dm_data:
        threads = dm_data['threads']
        print_test(
            "At least one thread exists",
            len(threads) > 0,
            f"Thread count: {len(threads)}"
        )
        
        if len(threads) > 0:
            # Find thread with Contact
            contact_thread = None
            for thread in threads:
                if thread.get('peer', {}).get('handle') == contact_user['handle']:
                    contact_thread = thread
                    break
            
            print_test(
                "Thread with Contact exists",
                contact_thread is not None,
                f"Found: {contact_thread is not None}"
            )
            
            if contact_thread:
                messages = contact_thread.get('messages', [])
                print_test(
                    "Thread contains messages",
                    len(messages) >= 2,
                    f"Message count: {len(messages)}"
                )
                
                # Verify DECRYPTED messages
                message_texts = [msg.get('text', '') for msg in messages]
                has_alpha = 'secret plan alpha' in message_texts
                has_bravo = 'roger that bravo' in message_texts
                
                print_test(
                    "DECRYPTED message 'secret plan alpha' found",
                    has_alpha,
                    f"Found: {has_alpha}, Messages: {message_texts}"
                )
                
                print_test(
                    "DECRYPTED message 'roger that bravo' found",
                    has_bravo,
                    f"Found: {has_bravo}, Messages: {message_texts}"
                )
                
                # Verify from_flagged field
                for msg in messages:
                    if msg.get('text') == 'secret plan alpha':
                        print_test(
                            "Message 'secret plan alpha' has from_flagged=true",
                            msg.get('from_flagged') == True,
                            f"from_flagged={msg.get('from_flagged')}"
                        )
                    elif msg.get('text') == 'roger that bravo':
                        print_test(
                            "Message 'roger that bravo' has from_flagged=false",
                            msg.get('from_flagged') == False,
                            f"from_flagged={msg.get('from_flagged')}"
                        )

print("\n" + "="*80)
print("TEST 5: DISCREET = NO NOTIFICATION, BUT AUDITED")
print("="*80 + "\n")

# Test 5a: Verify Suspect is NOT notified
activity_resp = requests.get(
    f"{BASE_URL}/activity",
    headers=headers(suspect_token)
)
print_test(
    "Suspect GET /activity → 200",
    activity_resp.status_code == 200,
    f"Status: {activity_resp.status_code}"
)

if activity_resp.status_code == 200:
    activity_data = activity_resp.json()
    # Check for any 'view_dms' or similar notification
    has_dm_view_notification = any(
        'view_dms' in str(act).lower() or 'watched' in str(act).lower() or 'reviewed' in str(act).lower()
        for act in activity_data
    )
    print_test(
        "Suspect has NO notification about DM review",
        not has_dm_view_notification,
        f"Has DM view notification: {has_dm_view_notification}, Activity count: {len(activity_data)}"
    )

# Test 5b: Verify audit log contains view_dms entry
audit_resp = requests.get(
    f"{BASE_URL}/admin/audit",
    headers=headers(admin_token)
)
print_test(
    "Admin GET /admin/audit → 200",
    audit_resp.status_code == 200,
    f"Status: {audit_resp.status_code}"
)

if audit_resp.status_code == 200:
    audit_data = audit_resp.json()
    
    # Find view_dms entry
    view_dms_entry = None
    for entry in audit_data:
        if entry.get('action') == 'view_dms' and entry.get('target') == suspect_user['handle']:
            view_dms_entry = entry
            break
    
    print_test(
        "Audit log contains 'view_dms' entry for Suspect",
        view_dms_entry is not None,
        f"Found: {view_dms_entry is not None}"
    )
    
    if view_dms_entry:
        print_test(
            "view_dms entry has admin_handle",
            view_dms_entry.get('admin_handle') == admin_user['handle'],
            f"admin_handle={view_dms_entry.get('admin_handle')}"
        )
    
    # Find flag_user entry
    flag_user_entry = None
    for entry in audit_data:
        if entry.get('action') == 'flag_user' and entry.get('target') == suspect_user['handle']:
            flag_user_entry = entry
            break
    
    print_test(
        "Audit log contains 'flag_user' entry for Suspect",
        flag_user_entry is not None,
        f"Found: {flag_user_entry is not None}"
    )

print("\n" + "="*80)
print("TEST 6: UNFLAG")
print("="*80 + "\n")

# Test 6a: Admin unflags Suspect
unflag_resp = requests.post(
    f"{BASE_URL}/admin/users/{suspect_user['handle']}/unflag",
    headers=headers(admin_token)
)
print_test(
    "Admin POST /admin/users/{handle}/unflag → 200",
    unflag_resp.status_code == 200,
    f"Status: {unflag_resp.status_code}"
)

if unflag_resp.status_code == 200:
    unflag_data = unflag_resp.json()
    print_test(
        "Unflag response contains ok=true and flagged=false",
        unflag_data.get('ok') == True and unflag_data.get('flagged') == False,
        f"Response: {unflag_data}"
    )

# Test 6b: Verify DM review is blocked after unflagging
dm_after_unflag_resp = requests.get(
    f"{BASE_URL}/admin/dms/{suspect_user['handle']}",
    headers=headers(admin_token)
)
print_test(
    "Admin GET /admin/dms/{handle} AFTER unflagging → 403",
    dm_after_unflag_resp.status_code == 403,
    f"Status: {dm_after_unflag_resp.status_code}"
)

# Test 6c: Verify user appears in admin users list with flagged=false
users_after_unflag_resp = requests.get(
    f"{BASE_URL}/admin/users?q=suspect",
    headers=headers(admin_token)
)
if users_after_unflag_resp.status_code == 200:
    users_data = users_after_unflag_resp.json()
    suspect_in_list = None
    for user in users_data:
        if user['handle'] == suspect_user['handle']:
            suspect_in_list = user
            break
    
    if suspect_in_list:
        print_test(
            "Suspect user has flagged=false after unflagging",
            suspect_in_list.get('flagged') == False,
            f"flagged={suspect_in_list.get('flagged')}"
        )

print("\n" + "="*80)
print("ALL TESTS PASSED ✅")
print("="*80 + "\n")
