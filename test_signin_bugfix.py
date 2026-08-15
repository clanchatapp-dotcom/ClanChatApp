#!/usr/bin/env python3
"""
Backend API tests for signin bugfix: OAuth account detection
Tests that /api/auth/signin properly returns 409 oauth_account for Google accounts
instead of misleading 401 invalid_credentials
"""
import requests
import json
import time

BASE_URL = "https://handle-profile-setup.preview.emergentagent.com/api"

def test_google_account_signin_attempt():
    """
    Test 1: POST /api/auth/signin with Google-only account
    Expected: 409 with error='oauth_account', provider='google', message referencing Google
    """
    print("\n=== Test 1: Google-only account signin attempt ===")
    try:
        payload = {
            "email": "googleonly@example.com",
            "password": "anything"
        }
        response = requests.post(f"{BASE_URL}/auth/signin", json=payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        # Check status code
        if response.status_code != 409:
            print(f"❌ FAIL: Expected status 409, got {response.status_code}")
            return False
        
        # Check error field
        if data.get('error') != 'oauth_account':
            print(f"❌ FAIL: Expected error='oauth_account', got error='{data.get('error')}'")
            return False
        
        # Check provider field
        if data.get('provider') != 'google':
            print(f"❌ FAIL: Expected provider='google', got provider='{data.get('provider')}'")
            return False
        
        # Check message references Google
        message = data.get('message', '').lower()
        if 'google' not in message:
            print(f"❌ FAIL: Expected message to reference 'Google', got: '{data.get('message')}'")
            return False
        
        print("✅ PASS: Returns 409 with error='oauth_account', provider='google', and message referencing Google")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_create_password_account_and_signin():
    """
    Test 2: Create a password account and sign in successfully
    a) Create account with password provider
    b) Sign in with correct credentials
    """
    print("\n=== Test 2: Create password account and signin ===")
    try:
        timestamp = int(time.time())
        email = f"realpw{timestamp}@example.com"
        password = "secret1"
        handle = f"realpw{timestamp}"
        
        # 2a. Create account
        print(f"\n2a. Creating password account (email: {email})...")
        create_payload = {
            "provider": "password",
            "password": password,
            "email": email,
            "handle": handle,
            "display_name": "Real PW",
            "dob": "1990-01-01"
        }
        response = requests.post(f"{BASE_URL}/auth/supabase-login", json=create_payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 200:
            print(f"❌ FAIL: Account creation failed with status {response.status_code}")
            return False
        
        if not data.get('token') or not data.get('user'):
            print(f"❌ FAIL: Missing token or user in response")
            return False
        
        if data['user'].get('auth_provider') != 'password':
            print(f"❌ FAIL: Expected auth_provider='password', got '{data['user'].get('auth_provider')}'")
            return False
        
        print("✅ Account created successfully with auth_provider='password'")
        
        # 2b. Sign in with correct credentials
        print(f"\n2b. Signing in with correct credentials...")
        signin_payload = {
            "email": email,
            "password": password
        }
        response = requests.post(f"{BASE_URL}/auth/signin", json=signin_payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 200:
            print(f"❌ FAIL: Signin failed with status {response.status_code}")
            return False
        
        if not data.get('token') or not data.get('user'):
            print(f"❌ FAIL: Missing token or user in signin response")
            return False
        
        print("✅ PASS: Password account created and signin successful")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_signin_wrong_password():
    """
    Test 3: Sign in with wrong password
    Expected: 401 with error='invalid_credentials'
    """
    print("\n=== Test 3: Signin with wrong password ===")
    try:
        # First create an account
        timestamp = int(time.time())
        email = f"wrongpw{timestamp}@example.com"
        password = "secret1"
        handle = f"wrongpw{timestamp}"
        
        print(f"\nCreating account (email: {email})...")
        create_payload = {
            "provider": "password",
            "password": password,
            "email": email,
            "handle": handle,
            "display_name": "Wrong PW Test",
            "dob": "1990-01-01"
        }
        response = requests.post(f"{BASE_URL}/auth/supabase-login", json=create_payload, timeout=10)
        
        if response.status_code != 200:
            print(f"❌ FAIL: Account creation failed with status {response.status_code}")
            return False
        
        print("✅ Account created")
        
        # Now try to sign in with wrong password
        print(f"\nAttempting signin with wrong password...")
        signin_payload = {
            "email": email,
            "password": "wrongpass"
        }
        response = requests.post(f"{BASE_URL}/auth/signin", json=signin_payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 401:
            print(f"❌ FAIL: Expected status 401, got {response.status_code}")
            return False
        
        if data.get('error') != 'invalid_credentials':
            print(f"❌ FAIL: Expected error='invalid_credentials', got error='{data.get('error')}'")
            return False
        
        print("✅ PASS: Returns 401 with error='invalid_credentials' for wrong password")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_signin_nonexistent_email():
    """
    Test 4: Sign in with non-existent email
    Expected: 401 with error='invalid_credentials'
    """
    print("\n=== Test 4: Signin with non-existent email ===")
    try:
        payload = {
            "email": "nobody-here@example.com",
            "password": "x"
        }
        response = requests.post(f"{BASE_URL}/auth/signin", json=payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 401:
            print(f"❌ FAIL: Expected status 401, got {response.status_code}")
            return False
        
        if data.get('error') != 'invalid_credentials':
            print(f"❌ FAIL: Expected error='invalid_credentials', got error='{data.get('error')}'")
            return False
        
        print("✅ PASS: Returns 401 with error='invalid_credentials' for non-existent email")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def main():
    print("=" * 80)
    print("SIGNIN BUGFIX TESTS - OAuth Account Detection")
    print("=" * 80)
    
    results = []
    
    # Run all tests
    results.append(("Test 1: Google account signin attempt (409 oauth_account)", test_google_account_signin_attempt()))
    results.append(("Test 2: Create password account and signin", test_create_password_account_and_signin()))
    results.append(("Test 3: Signin with wrong password (401 invalid_credentials)", test_signin_wrong_password()))
    results.append(("Test 4: Signin with non-existent email (401 invalid_credentials)", test_signin_nonexistent_email()))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit(main())
