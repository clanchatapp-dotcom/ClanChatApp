#!/usr/bin/env python3
"""
Backend test for Login Verification (email/password + seeded admin)
Tests login endpoints after request-timeout client fix to ensure NO regression.
"""
import requests
import json
import sys
import secrets
import time

# Base URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  → {details}")
    if not passed:
        sys.exit(1)

print("\n" + "="*80)
print("LOGIN VERIFICATION TESTS (email/password + seeded admin)")
print("="*80 + "\n")

# ============================================================================
# TEST 1: Seeded super-admin login
# ============================================================================
print("TEST 1: Seeded super-admin login")
print("-" * 80)

# Step 1a: POST /api/auth/login with seeded admin credentials
admin_email = "admin@clanchat.app"
admin_password = "ClanChatAdmin!2025"

start_time = time.time()
admin_login_resp = requests.post(
    f"{BASE_URL}/auth/login",
    json={"email": admin_email, "password": admin_password}
)
admin_login_time = time.time() - start_time

print(f"  → POST /api/auth/login (admin) took {admin_login_time:.3f}s")

print_test(
    "POST /api/auth/login (seeded admin) → 200",
    admin_login_resp.status_code == 200,
    f"Status: {admin_login_resp.status_code}, Response: {admin_login_resp.text[:200]}"
)

admin_login_data = admin_login_resp.json()
admin_token = admin_login_data.get('access_token')

print_test(
    "Response contains access_token",
    admin_token is not None and len(admin_token) > 0,
    f"Token length: {len(admin_token) if admin_token else 0}"
)

# Step 1b: GET /api/me with admin token
start_time = time.time()
admin_me_resp = requests.get(
    f"{BASE_URL}/me",
    headers={"Authorization": f"Bearer {admin_token}"}
)
admin_me_time = time.time() - start_time

print(f"  → GET /api/me (admin) took {admin_me_time:.3f}s")

print_test(
    "GET /api/me (with admin token) → 200",
    admin_me_resp.status_code == 200,
    f"Status: {admin_me_resp.status_code}"
)

admin_me_data = admin_me_resp.json()
print(f"  → Admin profile: handle={admin_me_data.get('handle')}, is_admin={admin_me_data.get('is_admin')}")

print_test(
    "is_admin == true",
    admin_me_data.get('is_admin') == True,
    f"is_admin: {admin_me_data.get('is_admin')}"
)

print_test(
    "Admin login response time < 1 second",
    admin_login_time < 1.0,
    f"Login took {admin_login_time:.3f}s"
)

# ============================================================================
# TEST 2: Wrong password
# ============================================================================
print("\nTEST 2: Wrong password")
print("-" * 80)

wrong_pw_resp = requests.post(
    f"{BASE_URL}/auth/login",
    json={"email": admin_email, "password": "wrongwrong"}
)

print_test(
    "POST /api/auth/login (wrong password) → 401",
    wrong_pw_resp.status_code == 401,
    f"Status: {wrong_pw_resp.status_code}"
)

if wrong_pw_resp.status_code == 401:
    wrong_pw_data = wrong_pw_resp.json()
    error_detail = wrong_pw_data.get('detail', '')
    print(f"  → Error detail: {error_detail}")
    
    print_test(
        "Error message contains 'Invalid email or password'",
        'Invalid email or password' in error_detail,
        f"Detail: {error_detail}"
    )

# ============================================================================
# TEST 3: Fresh register + login
# ============================================================================
print("\nTEST 3: Fresh register + login")
print("-" * 80)

# Generate unique random email
rand_suffix = secrets.token_hex(4)
fresh_email = f"loginqa+{rand_suffix}@example.com"
fresh_password = "secret123"
fresh_name = "Login QA"

print(f"  → Testing with email: {fresh_email}")

# Step 3a: POST /api/auth/register
start_time = time.time()
register_resp = requests.post(
    f"{BASE_URL}/auth/register",
    json={"email": fresh_email, "password": fresh_password, "name": fresh_name}
)
register_time = time.time() - start_time

print(f"  → POST /api/auth/register took {register_time:.3f}s")

print_test(
    "POST /api/auth/register → 200",
    register_resp.status_code == 200,
    f"Status: {register_resp.status_code}, Response: {register_resp.text[:200]}"
)

register_data = register_resp.json()
register_token = register_data.get('access_token')

print_test(
    "Register response contains access_token",
    register_token is not None and len(register_token) > 0,
    f"Token length: {len(register_token) if register_token else 0}"
)

# Step 3b: GET /api/me with registration token
me_resp = requests.get(
    f"{BASE_URL}/me",
    headers={"Authorization": f"Bearer {register_token}"}
)

print_test(
    "GET /api/me (with registration token) → 200",
    me_resp.status_code == 200,
    f"Status: {me_resp.status_code}"
)

me_data = me_resp.json()
print(f"  → User profile: handle={me_data.get('handle')}, display_name={me_data.get('display_name')}")

# Step 3c: POST /api/auth/login with same credentials
start_time = time.time()
login_resp = requests.post(
    f"{BASE_URL}/auth/login",
    json={"email": fresh_email, "password": fresh_password}
)
login_time = time.time() - start_time

print(f"  → POST /api/auth/login took {login_time:.3f}s")

print_test(
    "POST /api/auth/login (fresh user) → 200",
    login_resp.status_code == 200,
    f"Status: {login_resp.status_code}"
)

login_data = login_resp.json()
login_token = login_data.get('access_token')

print_test(
    "Login response contains access_token",
    login_token is not None and len(login_token) > 0,
    f"Token length: {len(login_token) if login_token else 0}"
)

print_test(
    "Register response time < 1 second",
    register_time < 1.0,
    f"Register took {register_time:.3f}s"
)

print_test(
    "Login response time < 1 second",
    login_time < 1.0,
    f"Login took {login_time:.3f}s"
)

# ============================================================================
# TEST 4: Unknown email
# ============================================================================
print("\nTEST 4: Unknown email")
print("-" * 80)

unknown_suffix = secrets.token_hex(4)
unknown_email = f"nobody-{unknown_suffix}@example.com"
unknown_password = "whatever1"

print(f"  → Testing with unknown email: {unknown_email}")

unknown_resp = requests.post(
    f"{BASE_URL}/auth/login",
    json={"email": unknown_email, "password": unknown_password}
)

print_test(
    "POST /api/auth/login (unknown email) → 401",
    unknown_resp.status_code == 401,
    f"Status: {unknown_resp.status_code}"
)

if unknown_resp.status_code == 401:
    unknown_data = unknown_resp.json()
    error_detail = unknown_data.get('detail', '')
    print(f"  → Error detail: {error_detail}")
    
    print_test(
        "Error message contains 'Invalid email or password'",
        'Invalid email or password' in error_detail,
        f"Detail: {error_detail}"
    )

# ============================================================================
# TEST 5: /api/me with no token and malformed token
# ============================================================================
print("\nTEST 5: /api/me with no token and malformed token")
print("-" * 80)

# Step 5a: GET /api/me with no token
no_token_resp = requests.get(f"{BASE_URL}/me")

print_test(
    "GET /api/me (no token) → 401",
    no_token_resp.status_code == 401,
    f"Status: {no_token_resp.status_code}"
)

# Step 5b: GET /api/me with malformed token
malformed_token = "this-is-not-a-valid-jwt-token"
malformed_resp = requests.get(
    f"{BASE_URL}/me",
    headers={"Authorization": f"Bearer {malformed_token}"}
)

print_test(
    "GET /api/me (malformed token) → 401",
    malformed_resp.status_code == 401,
    f"Status: {malformed_resp.status_code}"
)

# Step 5c: GET /api/me with invalid JWT format
invalid_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature"
invalid_resp = requests.get(
    f"{BASE_URL}/me",
    headers={"Authorization": f"Bearer {invalid_jwt}"}
)

print_test(
    "GET /api/me (invalid JWT) → 401",
    invalid_resp.status_code == 401,
    f"Status: {invalid_resp.status_code}"
)

# ============================================================================
# TEST 6: Response time summary
# ============================================================================
print("\nTEST 6: Response time summary")
print("-" * 80)

print(f"  → Admin login: {admin_login_time:.3f}s")
print(f"  → Admin /me: {admin_me_time:.3f}s")
print(f"  → Fresh register: {register_time:.3f}s")
print(f"  → Fresh login: {login_time:.3f}s")

avg_time = (admin_login_time + admin_me_time + register_time + login_time) / 4

print_test(
    "Average response time < 1 second",
    avg_time < 1.0,
    f"Average: {avg_time:.3f}s (well under 1 second, rules out server-side slowness)"
)

print("\n" + "="*80)
print("ALL LOGIN VERIFICATION TESTS PASSED ✅")
print("="*80 + "\n")

print("SUMMARY:")
print("  ✅ Seeded super-admin login working (admin@clanchat.app)")
print("  ✅ Wrong password correctly returns 401")
print("  ✅ Fresh register + login round-trip working")
print("  ✅ Unknown email correctly returns 401")
print("  ✅ /api/me with no token → 401")
print("  ✅ /api/me with malformed token → 401")
print("  ✅ Response times fast (< 1s), no server-side slowness")
print("\nCONCLUSION: NO REGRESSION detected. Login endpoints working correctly.")
