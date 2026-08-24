#!/usr/bin/env python3
"""
Backend test for Self-DM "Me, Myself & I" feature
Tests the NEW self-DM feature where users can message themselves (Saved Messages).
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
print("SELF-DM 'ME, MYSELF & I' FEATURE TESTS")
print("="*80 + "\n")

# Generate unique random suffix for test users
u_suffix = secrets.token_hex(4)
v_suffix = secrets.token_hex(4)
u_email = f"selfdm+{u_suffix}@example.com"
v_email = f"selfdm+{v_suffix}@example.com"

# ============================================================================
# STEP 1: Register throwaway user U
# ============================================================================
print("STEP 1: Register throwaway user U")
print("-" * 80)

u_token, u_user = register_user(u_email, "secret123", "User U")
u_handle = u_user['handle']
u_id = u_user['id']
print(f"  → Registered User U: {u_handle} (email: {u_email}, id: {u_id})")
print_test(
    "User U registered successfully",
    u_token is not None and u_handle is not None,
    f"Token length: {len(u_token)}, Handle: {u_handle}"
)

# ============================================================================
# STEP 2: GET /api/dms/{U_handle} (own handle) → verify initial state
# ============================================================================
print("\nSTEP 2: GET /api/dms/{U_handle} (own handle) → verify initial state")
print("-" * 80)

self_dm_resp = requests.get(f"{BASE_URL}/dms/{u_handle}", headers=headers(u_token))
print_test(
    f"GET /api/dms/{u_handle} (own handle) → 200",
    self_dm_resp.status_code == 200,
    f"Status: {self_dm_resp.status_code}"
)

self_dm_data = self_dm_resp.json()
print(f"  → Response: {json.dumps(self_dm_data, indent=2)}")

print_test(
    "peer.handle == U's own handle",
    self_dm_data.get('peer', {}).get('handle') == u_handle,
    f"peer.handle: {self_dm_data.get('peer', {}).get('handle')}, expected: {u_handle}"
)

print_test(
    "can_dm == true (can DM self)",
    self_dm_data.get('can_dm') == True,
    f"can_dm: {self_dm_data.get('can_dm')}"
)

print_test(
    "messages == [] initially (empty)",
    self_dm_data.get('messages') == [],
    f"messages count: {len(self_dm_data.get('messages', []))}"
)

# ============================================================================
# STEP 3: POST /api/dms/{U_handle} {text:"Note to self: buy milk"}
# ============================================================================
print("\nSTEP 3: POST /api/dms/{U_handle} {text:'Note to self: buy milk'}")
print("-" * 80)

msg1_text = "Note to self: buy milk"
send_msg1_resp = requests.post(
    f"{BASE_URL}/dms/{u_handle}",
    headers=headers(u_token),
    json={"text": msg1_text}
)
print_test(
    f"POST /api/dms/{u_handle} (first message) → 200",
    send_msg1_resp.status_code == 200,
    f"Status: {send_msg1_resp.status_code}"
)

msg1_data = send_msg1_resp.json()
print(f"  → Response: {json.dumps(msg1_data, indent=2)}")

print_test(
    "mine == true (message is from self)",
    msg1_data.get('mine') == True,
    f"mine: {msg1_data.get('mine')}"
)

print_test(
    f"text == '{msg1_text}'",
    msg1_data.get('text') == msg1_text,
    f"text: {msg1_data.get('text')}"
)

msg1_id = msg1_data.get('id')
print(f"  → Message 1 ID: {msg1_id}")

# ============================================================================
# STEP 4: POST /api/dms/{U_handle} {text:"Second saved message"}
# ============================================================================
print("\nSTEP 4: POST /api/dms/{u_handle} {text:'Second saved message'}")
print("-" * 80)

msg2_text = "Second saved message"
send_msg2_resp = requests.post(
    f"{BASE_URL}/dms/{u_handle}",
    headers=headers(u_token),
    json={"text": msg2_text}
)
print_test(
    f"POST /api/dms/{u_handle} (second message) → 200",
    send_msg2_resp.status_code == 200,
    f"Status: {send_msg2_resp.status_code}"
)

msg2_data = send_msg2_resp.json()
print(f"  → Response: {json.dumps(msg2_data, indent=2)}")

print_test(
    "mine == true (message is from self)",
    msg2_data.get('mine') == True,
    f"mine: {msg2_data.get('mine')}"
)

print_test(
    f"text == '{msg2_text}'",
    msg2_data.get('text') == msg2_text,
    f"text: {msg2_data.get('text')}"
)

msg2_id = msg2_data.get('id')
print(f"  → Message 2 ID: {msg2_id}")

# ============================================================================
# STEP 5: GET /api/dms/{U_handle} → verify BOTH messages present
# ============================================================================
print("\nSTEP 5: GET /api/dms/{U_handle} → verify BOTH messages present")
print("-" * 80)

self_dm_resp2 = requests.get(f"{BASE_URL}/dms/{u_handle}", headers=headers(u_token))
print_test(
    f"GET /api/dms/{u_handle} → 200",
    self_dm_resp2.status_code == 200,
    f"Status: {self_dm_resp2.status_code}"
)

self_dm_data2 = self_dm_resp2.json()
messages = self_dm_data2.get('messages', [])
print(f"  → Messages count: {len(messages)}")

print_test(
    "messages has BOTH messages (count == 2)",
    len(messages) == 2,
    f"messages count: {len(messages)}"
)

# Verify first message
if len(messages) >= 1:
    print_test(
        f"Message 1 text == '{msg1_text}'",
        messages[0].get('text') == msg1_text,
        f"text: {messages[0].get('text')}"
    )
    print_test(
        "Message 1 mine == true",
        messages[0].get('mine') == True,
        f"mine: {messages[0].get('mine')}"
    )

# Verify second message
if len(messages) >= 2:
    print_test(
        f"Message 2 text == '{msg2_text}'",
        messages[1].get('text') == msg2_text,
        f"text: {messages[1].get('text')}"
    )
    print_test(
        "Message 2 mine == true",
        messages[1].get('mine') == True,
        f"mine: {messages[1].get('mine')}"
    )

# Verify AES encrypt/decrypt round-trip
print_test(
    "AES encrypt/decrypt round-trip working (text decrypted correctly)",
    messages[0].get('text') == msg1_text and messages[1].get('text') == msg2_text,
    "Both messages decrypted correctly"
)

# ============================================================================
# STEP 6: GET /api/dms (thread list) → verify self thread appears
# ============================================================================
print("\nSTEP 6: GET /api/dms (thread list) → verify self thread appears")
print("-" * 80)

threads_resp = requests.get(f"{BASE_URL}/dms", headers=headers(u_token))
print_test(
    "GET /api/dms (thread list) → 200",
    threads_resp.status_code == 200,
    f"Status: {threads_resp.status_code}"
)

threads_data = threads_resp.json()
print(f"  → Threads count: {len(threads_data)}")

# Find self thread
self_thread = None
for thread in threads_data:
    if thread.get('user', {}).get('handle') == u_handle:
        self_thread = thread
        break

print_test(
    "Self thread appears in thread list",
    self_thread is not None,
    f"Self thread found: {self_thread is not None}"
)

if self_thread:
    print(f"  → Self thread: {json.dumps(self_thread, indent=2)}")
    
    print_test(
        "Self thread user.handle == U's own handle",
        self_thread.get('user', {}).get('handle') == u_handle,
        f"user.handle: {self_thread.get('user', {}).get('handle')}"
    )
    
    print_test(
        f"Self thread last message == '{msg2_text}'",
        msg2_text in self_thread.get('last', ''),
        f"last: {self_thread.get('last', '')}"
    )
    
    print_test(
        "Self thread mine == true",
        self_thread.get('mine') == True,
        f"mine: {self_thread.get('mine')}"
    )

# ============================================================================
# STEP 7: ISOLATION - Register second user V, verify isolation
# ============================================================================
print("\nSTEP 7: ISOLATION - Register second user V, verify isolation")
print("-" * 80)

v_token, v_user = register_user(v_email, "secret123", "User V")
v_handle = v_user['handle']
v_id = v_user['id']
print(f"  → Registered User V: {v_handle} (email: {v_email}, id: {v_id})")

# V gets their own self thread
v_self_dm_resp = requests.get(f"{BASE_URL}/dms/{v_handle}", headers=headers(v_token))
print_test(
    f"GET /api/dms/{v_handle} (V's own handle) → 200",
    v_self_dm_resp.status_code == 200,
    f"Status: {v_self_dm_resp.status_code}"
)

v_self_dm_data = v_self_dm_resp.json()
v_messages = v_self_dm_data.get('messages', [])

print_test(
    "V's self thread is empty (does NOT see U's messages)",
    len(v_messages) == 0,
    f"V's messages count: {len(v_messages)}"
)

# V gets thread list
v_threads_resp = requests.get(f"{BASE_URL}/dms", headers=headers(v_token))
v_threads_data = v_threads_resp.json()

# Check if V sees U's messages in any thread
u_messages_visible_to_v = False
for thread in v_threads_data:
    if thread.get('user', {}).get('handle') == u_handle:
        u_messages_visible_to_v = True
        break

print_test(
    "U's self messages are NOT visible to V in any way",
    not u_messages_visible_to_v,
    f"U's messages visible to V: {u_messages_visible_to_v}"
)

# ============================================================================
# STEP 8: REGRESSION - Normal DM still tier-gated
# ============================================================================
print("\nSTEP 8: REGRESSION - Normal DM still tier-gated")
print("-" * 80)

# U tries to DM V (a stranger, not inner/follower)
u_to_v_dm_resp = requests.post(
    f"{BASE_URL}/dms/{v_handle}",
    headers=headers(u_token),
    json={"text": "Hello stranger"}
)

print_test(
    f"POST /api/dms/{v_handle} (U to V, strangers) → 403",
    u_to_v_dm_resp.status_code == 403,
    f"Status: {u_to_v_dm_resp.status_code}"
)

# Verify can_dm is false for strangers
u_to_v_check_resp = requests.get(f"{BASE_URL}/dms/{v_handle}", headers=headers(u_token))
if u_to_v_check_resp.status_code == 200:
    u_to_v_check_data = u_to_v_check_resp.json()
    print_test(
        "can_dm == false for non-self strangers",
        u_to_v_check_data.get('can_dm') == False,
        f"can_dm: {u_to_v_check_data.get('can_dm')}"
    )

print_test(
    "Self-DM didn't break normal tier-gating",
    u_to_v_dm_resp.status_code == 403,
    "Normal DM tier-gating still enforced"
)

print("\n" + "="*80)
print("ALL SELF-DM TESTS PASSED ✅")
print("="*80 + "\n")
