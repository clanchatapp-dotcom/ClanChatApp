#!/usr/bin/env python3
"""
ClanChat Backend Auth API Tests
Tests all authentication endpoints for the ClanChat application
"""

import requests
import json
import sys
from datetime import datetime, timedelta

# Base URL from environment
BASE_URL = "https://handle-profile-setup.preview.emergentagent.com/api"

def print_test(name, passed, details=""):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"   Details: {details}")
    print()

def test_get_config():
    """Test 1: GET /api/config"""
    print("=" * 80)
    print("TEST 1: GET /api/config")
    print("=" * 80)
    
    try:
        response = requests.get(f"{BASE_URL}/config")
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code != 200:
            print_test("GET /api/config returns 200", False, f"Got {response.status_code}")
            return False
        
        data = response.json()
        
        # Check required fields
        has_url = "supabase_url" in data
        has_key = "supabase_anon_key" in data
        has_configured = "configured" in data
        
        if not (has_url and has_key and has_configured):
            print_test("GET /api/config has required fields", False, 
                      f"Missing fields. Got: {list(data.keys())}")
            return False
        
        # Check that configured is false (since env vars are empty)
        if data["configured"] != False:
            print_test("GET /api/config configured flag", False, 
                      f"Expected configured=false, got {data['configured']}")
            return False
        
        # Check that URL and key are empty strings
        if data["supabase_url"] != "" or data["supabase_anon_key"] != "":
            print_test("GET /api/config empty credentials", False, 
                      f"Expected empty strings, got url='{data['supabase_url']}', key='{data['supabase_anon_key']}'")
            return False
        
        print_test("GET /api/config", True, "Returns correct structure with configured=false")
        return True
        
    except Exception as e:
        print_test("GET /api/config", False, f"Exception: {str(e)}")
        return False

def test_dev_google():
    """Test 2: POST /api/auth/dev-google"""
    print("=" * 80)
    print("TEST 2: POST /api/auth/dev-google")
    print("=" * 80)
    
    results = []
    
    # Test 2a: Empty body
    try:
        response = requests.post(f"{BASE_URL}/auth/dev-google", json={})
        print(f"Test 2a - Empty body")
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code != 200:
            print_test("POST /api/auth/dev-google (empty body) returns 200", False, 
                      f"Got {response.status_code}")
            results.append(False)
        else:
            data = response.json()
            
            # Check access_token starts with "mock."
            if not data.get("access_token", "").startswith("mock."):
                print_test("POST /api/auth/dev-google access_token format", False, 
                          f"Token doesn't start with 'mock.': {data.get('access_token', '')[:20]}")
                results.append(False)
            elif not all(k in data for k in ["email", "name", "access_token"]):
                print_test("POST /api/auth/dev-google required fields", False, 
                          f"Missing fields. Got: {list(data.keys())}")
                results.append(False)
            else:
                print_test("POST /api/auth/dev-google (empty body)", True, 
                          f"Returns mock token, email={data['email']}, name={data['name']}")
                results.append(True)
    except Exception as e:
        print_test("POST /api/auth/dev-google (empty body)", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 2b: Custom email and name
    try:
        custom_email = "someone@x.com"
        custom_name = "Alice"
        response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                json={"email": custom_email, "name": custom_name})
        print(f"\nTest 2b - Custom email and name")
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code != 200:
            print_test("POST /api/auth/dev-google (custom email) returns 200", False, 
                      f"Got {response.status_code}")
            results.append(False)
        else:
            data = response.json()
            
            if data.get("email") != custom_email.lower():
                print_test("POST /api/auth/dev-google custom email", False, 
                          f"Expected {custom_email.lower()}, got {data.get('email')}")
                results.append(False)
            elif data.get("name") != custom_name:
                print_test("POST /api/auth/dev-google custom name", False, 
                          f"Expected {custom_name}, got {data.get('name')}")
                results.append(False)
            else:
                print_test("POST /api/auth/dev-google (custom email/name)", True, 
                          f"Returns correct email and name")
                results.append(True)
    except Exception as e:
        print_test("POST /api/auth/dev-google (custom email)", False, f"Exception: {str(e)}")
        results.append(False)
    
    return all(results)

def test_phase1_new_user():
    """Test 3: Phase 1 - New Google user (needs_profile)"""
    print("=" * 80)
    print("TEST 3: Phase 1 - New Google user (needs_profile)")
    print("=" * 80)
    
    try:
        # Step 1: Get mock Google token
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", json={})
        if dev_response.status_code != 200:
            print_test("Phase 1 - Get dev-google token", False, f"Got {dev_response.status_code}")
            return False
        
        dev_data = dev_response.json()
        access_token = dev_data["access_token"]
        print(f"Got access_token: {access_token[:30]}...")
        
        # Step 2: Call supabase-login without handle (phase 1)
        login_response = requests.post(f"{BASE_URL}/auth/supabase-login", 
                                      json={"access_token": access_token, "provider": "google"})
        print(f"Status Code: {login_response.status_code}")
        print(f"Response: {json.dumps(login_response.json(), indent=2)}")
        
        if login_response.status_code != 200:
            print_test("Phase 1 supabase-login returns 200", False, 
                      f"Got {login_response.status_code}")
            return False
        
        data = login_response.json()
        
        # Check for needs_profile response
        if not data.get("needs_profile"):
            print_test("Phase 1 needs_profile flag", False, 
                      f"Expected needs_profile=true, got {data.get('needs_profile')}")
            return False
        
        if "supabase_email" not in data or "supabase_name" not in data:
            print_test("Phase 1 required fields", False, 
                      f"Missing supabase_email or supabase_name. Got: {list(data.keys())}")
            return False
        
        print_test("Phase 1 - New Google user", True, 
                  f"Returns needs_profile=true, email={data['supabase_email']}, name={data['supabase_name']}")
        return True
        
    except Exception as e:
        print_test("Phase 1 - New Google user", False, f"Exception: {str(e)}")
        return False

def test_phase2_create_account():
    """Test 4: Phase 2 - Create Google account with profile"""
    print("=" * 80)
    print("TEST 4: Phase 2 - Create Google account")
    print("=" * 80)
    
    try:
        # Step 1: Get mock Google token with specific email
        test_email = "newuser1@x.com"
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                    json={"email": test_email, "name": "Cool Guy"})
        if dev_response.status_code != 200:
            print_test("Phase 2 - Get dev-google token", False, f"Got {dev_response.status_code}")
            return False
        
        dev_data = dev_response.json()
        access_token = dev_data["access_token"]
        print(f"Got access_token for {test_email}")
        
        # Step 2: Create account with handle (phase 2)
        profile_data = {
            "access_token": access_token,
            "provider": "google",
            "email": test_email,
            "handle": "CoolGuy",
            "display_name": "Cool Guy",
            "dob": "1995-05-05"
        }
        
        create_response = requests.post(f"{BASE_URL}/auth/supabase-login", json=profile_data)
        print(f"Status Code: {create_response.status_code}")
        print(f"Response: {json.dumps(create_response.json(), indent=2)}")
        
        if create_response.status_code != 200:
            print_test("Phase 2 create account returns 200", False, 
                      f"Got {create_response.status_code}: {create_response.json()}")
            return False
        
        data = create_response.json()
        
        # Check for token and user
        if "token" not in data or "user" not in data:
            print_test("Phase 2 required fields", False, 
                      f"Missing token or user. Got: {list(data.keys())}")
            return False
        
        user = data["user"]
        
        # Verify user fields
        checks = []
        
        # Check auth_provider
        if user.get("auth_provider") != "google":
            print_test("Phase 2 auth_provider", False, 
                      f"Expected 'google', got '{user.get('auth_provider')}'")
            checks.append(False)
        else:
            checks.append(True)
        
        # Check handle is sanitized (lowercase)
        if user.get("handle") != "coolguy":
            print_test("Phase 2 handle sanitization", False, 
                      f"Expected 'coolguy', got '{user.get('handle')}'")
            checks.append(False)
        else:
            checks.append(True)
        
        # Check is_minor (should be false for 1995 DOB)
        if user.get("is_minor") != False:
            print_test("Phase 2 is_minor flag", False, 
                      f"Expected false for adult, got {user.get('is_minor')}")
            checks.append(False)
        else:
            checks.append(True)
        
        # Check age (should be around 30 for 1995 DOB)
        age = user.get("age")
        if age is None or age < 28 or age > 31:
            print_test("Phase 2 age calculation", False, 
                      f"Expected age ~30, got {age}")
            checks.append(False)
        else:
            checks.append(True)
        
        # Check no password_hash leaked
        if "password_hash" in user:
            print_test("Phase 2 no password_hash leak", False, 
                      "password_hash should not be in response")
            checks.append(False)
        else:
            checks.append(True)
        
        # Check no _id leaked
        if "_id" in user:
            print_test("Phase 2 no _id leak", False, 
                      "_id should not be in response")
            checks.append(False)
        else:
            checks.append(True)
        
        if all(checks):
            print_test("Phase 2 - Create Google account", True, 
                      f"Account created successfully with handle={user['handle']}, age={user['age']}, is_minor={user['is_minor']}")
            return True
        else:
            return False
        
    except Exception as e:
        print_test("Phase 2 - Create Google account", False, f"Exception: {str(e)}")
        return False

def test_returning_user():
    """Test 5: Returning user flow"""
    print("=" * 80)
    print("TEST 5: Returning user flow")
    print("=" * 80)
    
    try:
        # Use the email from the account created in test 4
        test_email = "newuser1@x.com"
        
        # Step 1: Get new mock token for the same email
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                    json={"email": test_email})
        if dev_response.status_code != 200:
            print_test("Returning user - Get dev-google token", False, 
                      f"Got {dev_response.status_code}")
            return False
        
        dev_data = dev_response.json()
        access_token = dev_data["access_token"]
        print(f"Got new access_token for existing user {test_email}")
        
        # Step 2: Call supabase-login without handle (should return user directly)
        login_response = requests.post(f"{BASE_URL}/auth/supabase-login", 
                                      json={"access_token": access_token, "provider": "google"})
        print(f"Status Code: {login_response.status_code}")
        print(f"Response: {json.dumps(login_response.json(), indent=2)}")
        
        if login_response.status_code != 200:
            print_test("Returning user returns 200", False, 
                      f"Got {login_response.status_code}")
            return False
        
        data = login_response.json()
        
        # Should NOT have needs_profile
        if data.get("needs_profile"):
            print_test("Returning user no needs_profile", False, 
                      "Returning user should not get needs_profile=true")
            return False
        
        # Should have token and user
        if "token" not in data or "user" not in data:
            print_test("Returning user has token and user", False, 
                      f"Missing token or user. Got: {list(data.keys())}")
            return False
        
        user = data["user"]
        
        # Verify it's the same user
        if user.get("email") != test_email:
            print_test("Returning user email match", False, 
                      f"Expected {test_email}, got {user.get('email')}")
            return False
        
        if user.get("handle") != "coolguy":
            print_test("Returning user handle match", False, 
                      f"Expected 'coolguy', got {user.get('handle')}")
            return False
        
        print_test("Returning user flow", True, 
                  f"Existing user logged in directly with token, no needs_profile")
        return True
        
    except Exception as e:
        print_test("Returning user flow", False, f"Exception: {str(e)}")
        return False

def test_collisions():
    """Test 6: Handle and email collision detection"""
    print("=" * 80)
    print("TEST 6: Collision detection")
    print("=" * 80)
    
    results = []
    
    # Test 6a: Handle collision
    try:
        print("\nTest 6a: Handle collision")
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                    json={"email": "another@x.com", "name": "Another User"})
        if dev_response.status_code != 200:
            print_test("Handle collision - Get token", False, f"Got {dev_response.status_code}")
            results.append(False)
        else:
            access_token = dev_response.json()["access_token"]
            
            # Try to create account with existing handle "coolguy"
            collision_response = requests.post(f"{BASE_URL}/auth/supabase-login", json={
                "access_token": access_token,
                "provider": "google",
                "email": "another@x.com",
                "handle": "coolguy",  # This handle already exists
                "display_name": "Another User",
                "dob": "1990-01-01"
            })
            
            print(f"Status Code: {collision_response.status_code}")
            print(f"Response: {json.dumps(collision_response.json(), indent=2)}")
            
            if collision_response.status_code != 409:
                print_test("Handle collision returns 409", False, 
                          f"Expected 409, got {collision_response.status_code}")
                results.append(False)
            else:
                data = collision_response.json()
                if data.get("error") != "handle_taken":
                    print_test("Handle collision error code", False, 
                              f"Expected error='handle_taken', got '{data.get('error')}'")
                    results.append(False)
                else:
                    print_test("Handle collision", True, "Returns 409 with error='handle_taken'")
                    results.append(True)
    except Exception as e:
        print_test("Handle collision", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 6b: Email collision
    try:
        print("\nTest 6b: Email collision")
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                    json={"email": "yetanother@x.com", "name": "Yet Another"})
        if dev_response.status_code != 200:
            print_test("Email collision - Get token", False, f"Got {dev_response.status_code}")
            results.append(False)
        else:
            access_token = dev_response.json()["access_token"]
            
            # Try to create account with existing email "newuser1@x.com"
            collision_response = requests.post(f"{BASE_URL}/auth/supabase-login", json={
                "access_token": access_token,
                "provider": "google",
                "email": "newuser1@x.com",  # This email already exists
                "handle": "differenthandle",
                "display_name": "Yet Another",
                "dob": "1990-01-01"
            })
            
            print(f"Status Code: {collision_response.status_code}")
            print(f"Response: {json.dumps(collision_response.json(), indent=2)}")
            
            if collision_response.status_code != 409:
                print_test("Email collision returns 409", False, 
                          f"Expected 409, got {collision_response.status_code}")
                results.append(False)
            else:
                data = collision_response.json()
                if data.get("error") != "email_in_use":
                    print_test("Email collision error code", False, 
                              f"Expected error='email_in_use', got '{data.get('error')}'")
                    results.append(False)
                else:
                    print_test("Email collision", True, "Returns 409 with error='email_in_use'")
                    results.append(True)
    except Exception as e:
        print_test("Email collision", False, f"Exception: {str(e)}")
        results.append(False)
    
    return all(results)

def test_age_validation():
    """Test 7: Age validation (under 13)"""
    print("=" * 80)
    print("TEST 7: Age validation (under 13)")
    print("=" * 80)
    
    try:
        # Get mock token
        dev_response = requests.post(f"{BASE_URL}/auth/dev-google", 
                                    json={"email": "kid@x.com", "name": "Kid User"})
        if dev_response.status_code != 200:
            print_test("Age validation - Get token", False, f"Got {dev_response.status_code}")
            return False
        
        access_token = dev_response.json()["access_token"]
        
        # Try to create account with DOB making user under 13
        age_response = requests.post(f"{BASE_URL}/auth/supabase-login", json={
            "access_token": access_token,
            "provider": "google",
            "email": "kid@x.com",
            "handle": "kiddo",
            "display_name": "Kid User",
            "dob": "2020-01-01"  # This makes user ~5 years old
        })
        
        print(f"Status Code: {age_response.status_code}")
        print(f"Response: {json.dumps(age_response.json(), indent=2)}")
        
        if age_response.status_code != 400:
            print_test("Age validation returns 400", False, 
                      f"Expected 400, got {age_response.status_code}")
            return False
        
        data = age_response.json()
        if data.get("error") != "age":
            print_test("Age validation error code", False, 
                      f"Expected error='age', got '{data.get('error')}'")
            return False
        
        print_test("Age validation (under 13)", True, "Returns 400 with error='age'")
        return True
        
    except Exception as e:
        print_test("Age validation", False, f"Exception: {str(e)}")
        return False

def test_password_provider():
    """Test 8: Password provider flow"""
    print("=" * 80)
    print("TEST 8: Password provider flow")
    print("=" * 80)
    
    results = []
    
    # Test 8a: Create password account
    try:
        print("\nTest 8a: Create password account")
        create_response = requests.post(f"{BASE_URL}/auth/supabase-login", json={
            "provider": "password",
            "password": "secret1",
            "email": "pwuser@x.com",
            "handle": "pwuser",
            "display_name": "PW User",
            "dob": "1990-01-01"
        })
        
        print(f"Status Code: {create_response.status_code}")
        print(f"Response: {json.dumps(create_response.json(), indent=2)}")
        
        if create_response.status_code != 200:
            print_test("Create password account returns 200", False, 
                      f"Got {create_response.status_code}: {create_response.json()}")
            results.append(False)
        else:
            data = create_response.json()
            
            if "token" not in data or "user" not in data:
                print_test("Create password account has token and user", False, 
                          f"Missing fields. Got: {list(data.keys())}")
                results.append(False)
            elif data["user"].get("auth_provider") != "password":
                print_test("Password account auth_provider", False, 
                          f"Expected 'password', got '{data['user'].get('auth_provider')}'")
                results.append(False)
            else:
                print_test("Create password account", True, 
                          f"Account created with auth_provider='password'")
                results.append(True)
    except Exception as e:
        print_test("Create password account", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 8b: Sign in with correct password
    try:
        print("\nTest 8b: Sign in with correct password")
        signin_response = requests.post(f"{BASE_URL}/auth/signin", json={
            "email": "pwuser@x.com",
            "password": "secret1"
        })
        
        print(f"Status Code: {signin_response.status_code}")
        print(f"Response: {json.dumps(signin_response.json(), indent=2)}")
        
        if signin_response.status_code != 200:
            print_test("Sign in with correct password returns 200", False, 
                      f"Got {signin_response.status_code}")
            results.append(False)
        else:
            data = signin_response.json()
            
            if "token" not in data or "user" not in data:
                print_test("Sign in has token and user", False, 
                          f"Missing fields. Got: {list(data.keys())}")
                results.append(False)
            else:
                print_test("Sign in with correct password", True, "Returns token and user")
                results.append(True)
                
                # Save token for /me test
                global saved_token
                saved_token = data["token"]
    except Exception as e:
        print_test("Sign in with correct password", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 8c: Sign in with wrong password
    try:
        print("\nTest 8c: Sign in with wrong password")
        wrong_response = requests.post(f"{BASE_URL}/auth/signin", json={
            "email": "pwuser@x.com",
            "password": "wrongpassword"
        })
        
        print(f"Status Code: {wrong_response.status_code}")
        print(f"Response: {json.dumps(wrong_response.json(), indent=2)}")
        
        if wrong_response.status_code != 401:
            print_test("Sign in with wrong password returns 401", False, 
                      f"Expected 401, got {wrong_response.status_code}")
            results.append(False)
        else:
            data = wrong_response.json()
            if data.get("error") != "invalid_credentials":
                print_test("Wrong password error code", False, 
                          f"Expected error='invalid_credentials', got '{data.get('error')}'")
                results.append(False)
            else:
                print_test("Sign in with wrong password", True, "Returns 401 with error='invalid_credentials'")
                results.append(True)
    except Exception as e:
        print_test("Sign in with wrong password", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 8d: GET /api/auth/me with valid token
    try:
        print("\nTest 8d: GET /api/auth/me with valid token")
        me_response = requests.get(f"{BASE_URL}/auth/me", 
                                   headers={"Authorization": f"Bearer {saved_token}"})
        
        print(f"Status Code: {me_response.status_code}")
        print(f"Response: {json.dumps(me_response.json(), indent=2)}")
        
        if me_response.status_code != 200:
            print_test("GET /api/auth/me with valid token returns 200", False, 
                      f"Got {me_response.status_code}")
            results.append(False)
        else:
            data = me_response.json()
            
            if "user" not in data:
                print_test("GET /api/auth/me has user", False, 
                          f"Missing user field. Got: {list(data.keys())}")
                results.append(False)
            elif data["user"].get("email") != "pwuser@x.com":
                print_test("GET /api/auth/me correct user", False, 
                          f"Expected pwuser@x.com, got {data['user'].get('email')}")
                results.append(False)
            else:
                print_test("GET /api/auth/me with valid token", True, "Returns correct user")
                results.append(True)
    except Exception as e:
        print_test("GET /api/auth/me with valid token", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 8e: GET /api/auth/me with invalid token
    try:
        print("\nTest 8e: GET /api/auth/me with invalid token")
        invalid_response = requests.get(f"{BASE_URL}/auth/me", 
                                       headers={"Authorization": "Bearer invalidtoken123"})
        
        print(f"Status Code: {invalid_response.status_code}")
        print(f"Response: {json.dumps(invalid_response.json(), indent=2)}")
        
        if invalid_response.status_code != 401:
            print_test("GET /api/auth/me with invalid token returns 401", False, 
                      f"Expected 401, got {invalid_response.status_code}")
            results.append(False)
        else:
            print_test("GET /api/auth/me with invalid token", True, "Returns 401")
            results.append(True)
    except Exception as e:
        print_test("GET /api/auth/me with invalid token", False, f"Exception: {str(e)}")
        results.append(False)
    
    # Test 8f: GET /api/auth/me without token
    try:
        print("\nTest 8f: GET /api/auth/me without token")
        no_token_response = requests.get(f"{BASE_URL}/auth/me")
        
        print(f"Status Code: {no_token_response.status_code}")
        print(f"Response: {json.dumps(no_token_response.json(), indent=2)}")
        
        if no_token_response.status_code != 401:
            print_test("GET /api/auth/me without token returns 401", False, 
                      f"Expected 401, got {no_token_response.status_code}")
            results.append(False)
        else:
            print_test("GET /api/auth/me without token", True, "Returns 401")
            results.append(True)
    except Exception as e:
        print_test("GET /api/auth/me without token", False, f"Exception: {str(e)}")
        results.append(False)
    
    return all(results)

def test_invalid_token():
    """Test 9: Invalid token handling"""
    print("=" * 80)
    print("TEST 9: Invalid token handling")
    print("=" * 80)
    
    try:
        # Try phase 1 with garbage token
        invalid_response = requests.post(f"{BASE_URL}/auth/supabase-login", json={
            "access_token": "garbage",
            "provider": "google"
        })
        
        print(f"Status Code: {invalid_response.status_code}")
        print(f"Response: {json.dumps(invalid_response.json(), indent=2)}")
        
        if invalid_response.status_code != 401:
            print_test("Invalid token returns 401", False, 
                      f"Expected 401, got {invalid_response.status_code}")
            return False
        
        data = invalid_response.json()
        if data.get("error") != "invalid_token":
            print_test("Invalid token error code", False, 
                      f"Expected error='invalid_token', got '{data.get('error')}'")
            return False
        
        print_test("Invalid token handling", True, "Returns 401 with error='invalid_token'")
        return True
        
    except Exception as e:
        print_test("Invalid token handling", False, f"Exception: {str(e)}")
        return False

# Global variable to store token between tests
saved_token = None

def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("CLANCHAT BACKEND AUTH API TESTS")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print("=" * 80 + "\n")
    
    results = {}
    
    # Run tests in order
    results["GET /api/config"] = test_get_config()
    results["POST /api/auth/dev-google"] = test_dev_google()
    results["Phase 1 - New user (needs_profile)"] = test_phase1_new_user()
    results["Phase 2 - Create account"] = test_phase2_create_account()
    results["Returning user"] = test_returning_user()
    results["Collision detection"] = test_collisions()
    results["Age validation"] = test_age_validation()
    results["Password provider"] = test_password_provider()
    results["Invalid token"] = test_invalid_token()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print("=" * 80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("=" * 80 + "\n")
    
    # Exit with appropriate code
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    main()
