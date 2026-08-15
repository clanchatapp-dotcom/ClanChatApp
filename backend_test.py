#!/usr/bin/env python3
"""
Backend API tests for Emergent-managed Google auth + regressions
Tests error/guard paths only (real Emergent OAuth needs live Google login)
"""
import requests
import json
import time

BASE_URL = "https://handle-profile-setup.preview.emergentagent.com/api"

def test_emergent_exchange_missing_session_id():
    """Test 1: POST /api/auth/emergent/exchange with {} -> 400 session_id_required"""
    print("\n=== Test 1: Emergent exchange - missing session_id ===")
    try:
        response = requests.post(f"{BASE_URL}/auth/emergent/exchange", json={}, timeout=20)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 400 and data.get('error') == 'session_id_required':
            print("✅ PASS: Returns 400 with error 'session_id_required'")
            return True
        else:
            print(f"❌ FAIL: Expected 400 with error='session_id_required', got {response.status_code} with error='{data.get('error')}'")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_emergent_exchange_invalid_session():
    """Test 2: POST /api/auth/emergent/exchange with fake session_id -> 401 invalid_session (NOT 500)"""
    print("\n=== Test 2: Emergent exchange - invalid session_id ===")
    try:
        # Allow up to 15s for upstream timeouts
        response = requests.post(
            f"{BASE_URL}/auth/emergent/exchange", 
            json={"session_id": "fake-invalid-123"}, 
            timeout=20
        )
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 401 and data.get('error') == 'invalid_session':
            print("✅ PASS: Returns 401 with error 'invalid_session' (graceful failure, not 500)")
            return True
        elif response.status_code == 500:
            print(f"❌ FAIL: Returns 500 (should fail gracefully to 401). Response: {data}")
            return False
        else:
            print(f"❌ FAIL: Expected 401 with error='invalid_session', got {response.status_code} with error='{data.get('error')}'")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_emergent_provider_no_ticket():
    """Test 3: POST /api/auth/supabase-login with provider=emergent but NO profile_ticket -> 401 invalid_ticket"""
    print("\n=== Test 3: Emergent provider - missing profile_ticket ===")
    try:
        payload = {
            "provider": "emergent",
            "email": "em1@example.com",
            "handle": "emuser1",
            "display_name": "Em One",
            "dob": "1990-01-01"
        }
        response = requests.post(f"{BASE_URL}/auth/supabase-login", json=payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 401 and data.get('error') == 'invalid_ticket':
            print("✅ PASS: Returns 401 with error 'invalid_ticket'")
            return True
        else:
            print(f"❌ FAIL: Expected 401 with error='invalid_ticket', got {response.status_code} with error='{data.get('error')}'")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_emergent_provider_garbage_ticket():
    """Test 4: POST /api/auth/supabase-login with provider=emergent and garbage profile_ticket -> 401 invalid_ticket"""
    print("\n=== Test 4: Emergent provider - garbage profile_ticket ===")
    try:
        payload = {
            "provider": "emergent",
            "email": "em1@example.com",
            "handle": "emuser1",
            "display_name": "Em One",
            "dob": "1990-01-01",
            "profile_ticket": "garbage.token.value"
        }
        response = requests.post(f"{BASE_URL}/auth/supabase-login", json=payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 401 and data.get('error') == 'invalid_ticket':
            print("✅ PASS: Returns 401 with error 'invalid_ticket'")
            return True
        else:
            print(f"❌ FAIL: Expected 401 with error='invalid_ticket', got {response.status_code} with error='{data.get('error')}'")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_password_provider_regression():
    """Test 5: REGRESSION - password provider flow (create, signin, /me)"""
    print("\n=== Test 5: REGRESSION - Password provider flow ===")
    try:
        # Create account with password provider
        timestamp = int(time.time())
        email = f"pw2test{timestamp}@example.com"
        password = "secret1"
        handle = f"pw2user{timestamp}"
        
        print(f"\n5a. Creating account with password provider (email: {email})...")
        create_payload = {
            "provider": "password",
            "password": password,
            "email": email,
            "handle": handle,
            "display_name": "PW Two",
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
        token = data['token']
        
        # Test signin
        print(f"\n5b. Testing signin with email/password...")
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
        
        print("✅ Signin successful")
        
        # Test /me endpoint
        print(f"\n5c. Testing GET /api/auth/me with Bearer token...")
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BASE_URL}/auth/me", headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 200:
            print(f"❌ FAIL: /me endpoint failed with status {response.status_code}")
            return False
        
        if not data.get('user'):
            print(f"❌ FAIL: Missing user in /me response")
            return False
        
        print("✅ /me endpoint successful")
        print("✅ PASS: Complete password provider flow working")
        return True
        
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_google_phase1_invalid_token():
    """Test 6: REGRESSION - google phase1 with invalid token -> 401 invalid_token"""
    print("\n=== Test 6: REGRESSION - Google phase1 invalid token ===")
    try:
        payload = {
            "access_token": "garbage",
            "provider": "google"
        }
        response = requests.post(f"{BASE_URL}/auth/supabase-login", json=payload, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 401 and data.get('error') == 'invalid_token':
            print("✅ PASS: Returns 401 with error 'invalid_token'")
            return True
        else:
            print(f"❌ FAIL: Expected 401 with error='invalid_token', got {response.status_code} with error='{data.get('error')}'")
            return False
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def test_config_endpoint():
    """Test 7: GET /api/config returns configured:true"""
    print("\n=== Test 7: GET /api/config returns configured:true ===")
    try:
        response = requests.get(f"{BASE_URL}/config", timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code != 200:
            print(f"❌ FAIL: Expected 200, got {response.status_code}")
            return False
        
        if data.get('configured') != True:
            print(f"❌ FAIL: Expected configured=true, got configured={data.get('configured')}")
            return False
        
        print("✅ PASS: Returns 200 with configured=true")
        return True
    except Exception as e:
        print(f"❌ FAIL: Exception occurred: {e}")
        return False

def main():
    print("=" * 80)
    print("EMERGENT-MANAGED GOOGLE AUTH BACKEND TESTS")
    print("=" * 80)
    
    results = []
    
    # Run all tests
    results.append(("Test 1: Emergent exchange - missing session_id", test_emergent_exchange_missing_session_id()))
    results.append(("Test 2: Emergent exchange - invalid session_id", test_emergent_exchange_invalid_session()))
    results.append(("Test 3: Emergent provider - no profile_ticket", test_emergent_provider_no_ticket()))
    results.append(("Test 4: Emergent provider - garbage profile_ticket", test_emergent_provider_garbage_ticket()))
    results.append(("Test 5: REGRESSION - Password provider flow", test_password_provider_regression()))
    results.append(("Test 6: REGRESSION - Google phase1 invalid token", test_google_phase1_invalid_token()))
    results.append(("Test 7: GET /api/config configured:true", test_config_endpoint()))
    
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
