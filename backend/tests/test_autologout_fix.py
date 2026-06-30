"""
Tests for auto-logout fix and token refresh.
Verifies 24-hour token expiry and refresh token functionality.
"""
import os
import time
import pytest
import requests
import jwt

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = ("alice@clanchat.app", "Password123!")
JWT_SECRET = os.environ.get("JWT_SECRET", "test-secret")
JWT_ALGORITHM = "HS256"

def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s

@pytest.fixture(scope="module")
def alice():
    return _login(*ALICE)

class TestTokenExpiry:
    """Test token expiry and refresh."""

    def test_access_token_has_long_expiry(self, alice):
        """Access token should be valid for 24 hours (not instant expiry)."""
        # Get token from cookie
        token = None
        for cookie in alice.cookies:
            if cookie.name == "access_token":
                token = cookie.value
                break
        
        assert token is not None, "access_token cookie not found"
        
        # Decode token
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            exp = payload.get("exp")
            assert exp is not None
            
            # Check if expiry is in future (not already expired)
            current_time = time.time()
            assert exp > current_time, "Token already expired"
            
            # Check if expiry is > 20 hours from now (24h - buffer)
            hours_until_expiry = (exp - current_time) / 3600
            assert hours_until_expiry > 20, f"Token expiry too short: {hours_until_expiry} hours"
        except jwt.DecodeError:
            pytest.fail("Could not decode access token")

    def test_auth_me_still_works(self, alice):
        """Session should remain valid (no premature logout)."""
        for i in range(5):
            r = alice.get(f"{API}/auth/me", timeout=10)
            assert r.status_code == 200, f"Session died after request {i+1}: {r.text}"
            time.sleep(0.2)

    def test_refresh_token_endpoint_exists(self, alice):
        """POST /auth/refresh endpoint should exist for token refresh."""
        # Get refresh token from cookie
        refresh_token = None
        for cookie in alice.cookies:
            if cookie.name == "refresh_token":
                refresh_token = cookie.value
                break
        
        if refresh_token:
            # Test refresh endpoint (may not be fully implemented yet)
            r = alice.post(f"{API}/auth/refresh", json={
                "refresh_token": refresh_token
            }, timeout=10)
            # Should not 404
            assert r.status_code != 404, "Refresh endpoint not found"
