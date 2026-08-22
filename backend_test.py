#!/usr/bin/env python3
"""
ClanChat Backend API Test Suite
Tests all FastAPI endpoints including auth, clans, messages, storage, and websockets
"""
import asyncio
import json
import io
from pathlib import Path

import httpx
import websockets

# Base URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
}


def log_pass(test_name: str, details: str = ""):
    print(f"✅ PASS: {test_name}")
    if details:
        print(f"   {details}")
    test_results["passed"].append(test_name)


def log_fail(test_name: str, details: str):
    print(f"❌ FAIL: {test_name}")
    print(f"   {details}")
    test_results["failed"].append(test_name)


async def test_health_check():
    """Test 1: GET /api/ -> 200 {ok:true}"""
    test_name = "Health check GET /api/"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{API_BASE}/")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("ok") is True:
                    log_pass(test_name, f"Response: {data}")
                else:
                    log_fail(test_name, f"Expected ok:true, got {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        log_fail(test_name, f"Exception: {e}")


async def test_dev_token():
    """Test 2: POST /api/dev/token -> returns access_token + user (deterministic)"""
    test_name = "POST /api/dev/token"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # First call
            resp1 = await client.post(f"{API_BASE}/dev/token", json={"name": "Tester"})
            if resp1.status_code != 200:
                log_fail(test_name, f"First call status {resp1.status_code}: {resp1.text}")
                return None, None
            
            data1 = resp1.json()
            token1 = data1.get("access_token")
            user1 = data1.get("user")
            
            if not token1 or not user1:
                log_fail(test_name, f"Missing access_token or user: {data1}")
                return None, None
            
            # Second call with same name - should return same user id
            resp2 = await client.post(f"{API_BASE}/dev/token", json={"name": "Tester"})
            data2 = resp2.json()
            user2 = data2.get("user")
            
            if user1.get("id") == user2.get("id"):
                log_pass(test_name, f"Deterministic user id: {user1.get('id')}, token length: {len(token1)}")
                return token1, user1
            else:
                log_fail(test_name, f"User ids don't match: {user1.get('id')} vs {user2.get('id')}")
                return token1, user1
    except Exception as e:
        log_fail(test_name, f"Exception: {e}")
        return None, None


async def test_auth_me(token: str):
    """Test 3: GET /api/me with various auth scenarios"""
    async with httpx.AsyncClient(timeout=30) as client:
        # 3a: Valid token
        test_name = "GET /api/me with valid token"
        try:
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": f"Bearer {token}"})
            if resp.status_code == 200:
                data = resp.json()
                log_pass(test_name, f"User: {data.get('name')} ({data.get('id')})")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3b: No Authorization header
        test_name = "GET /api/me without Authorization header"
        try:
            resp = await client.get(f"{API_BASE}/me")
            if resp.status_code == 401:
                log_pass(test_name, f"Correctly rejected: {resp.json()}")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3c: Malformed token
        test_name = "GET /api/me with malformed token"
        try:
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": "Bearer abc.def.ghi"})
            if resp.status_code == 401:
                log_pass(test_name, f"Correctly rejected: {resp.json()}")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 3d: Valid format but wrong signature
        test_name = "GET /api/me with wrong signature token"
        try:
            # A valid JWT structure but with wrong signature
            fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0.wrongsignaturewrongsignaturewrongsignature"
            resp = await client.get(f"{API_BASE}/me", headers={"Authorization": f"Bearer {fake_token}"})
            if resp.status_code == 401:
                log_pass(test_name, f"Correctly rejected: {resp.json()}")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")


async def test_clans(token: str):
    """Test 4: Clans list/create/join-by-code/join-by-id"""
    headers = {"Authorization": f"Bearer {token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # 4a: List clans - should have General and Announcements
        test_name = "GET /api/clans - list seeded clans"
        try:
            resp = await client.get(f"{API_BASE}/clans", headers=headers)
            if resp.status_code == 200:
                clans = resp.json()
                clan_names = [c.get("name") for c in clans]
                has_general = "General" in clan_names
                has_announcements = "Announcements" in clan_names
                
                # Check for member_count and is_member fields
                has_fields = all("member_count" in c and "is_member" in c for c in clans)
                
                if has_general and has_announcements and has_fields:
                    log_pass(test_name, f"Found clans: {clan_names}, fields present")
                else:
                    log_fail(test_name, f"Missing expected clans or fields. Clans: {clans}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 4b: Create clan - should return code
        test_name = "POST /api/clans - create clan with code"
        created_clan = None
        try:
            resp = await client.post(f"{API_BASE}/clans", headers=headers, json={"name": "Test Clan", "description": "A test clan"})
            if resp.status_code in (200, 201):
                clan = resp.json()
                code = clan.get("code")
                clan_id = clan.get("id")
                if code and len(code) == 6 and clan_id:
                    log_pass(test_name, f"Created clan with code: {code}, id: {clan_id}")
                    created_clan = clan
                else:
                    log_fail(test_name, f"Missing or invalid code. Clan: {clan}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        if created_clan:
            # 4c: Join by code with a second user
            test_name = "POST /api/clans/join - join by code"
            try:
                # Create second user
                resp2 = await client.post(f"{API_BASE}/dev/token", json={"name": "Joiner"})
                token2 = resp2.json().get("access_token")
                headers2 = {"Authorization": f"Bearer {token2}"}
                
                # Join the clan
                resp = await client.post(f"{API_BASE}/clans/join", headers=headers2, json={"code": created_clan["code"]})
                if resp.status_code in (200, 201):
                    result = resp.json()
                    if result.get("is_member") is True:
                        log_pass(test_name, f"Successfully joined clan: {result.get('name')}")
                    else:
                        log_fail(test_name, f"Joined but is_member not true: {result}")
                else:
                    log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")
            
            # 4d: Join by ID
            test_name = "POST /api/clans/{id}/join - join by id"
            try:
                # Create third user
                resp3 = await client.post(f"{API_BASE}/dev/token", json={"name": "ThirdUser"})
                token3 = resp3.json().get("access_token")
                headers3 = {"Authorization": f"Bearer {token3}"}
                
                # Join by ID
                resp = await client.post(f"{API_BASE}/clans/{created_clan['id']}/join", headers=headers3)
                if resp.status_code in (200, 201):
                    result = resp.json()
                    if result.get("is_member") is True:
                        log_pass(test_name, f"Successfully joined by id: {result.get('name')}")
                    else:
                        log_fail(test_name, f"Joined but is_member not true: {result}")
                else:
                    log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")
            
            # 4e: Bad code should return 404
            test_name = "POST /api/clans/join - bad code returns 404"
            try:
                resp = await client.post(f"{API_BASE}/clans/join", headers=headers, json={"code": "BADCOD"})
                if resp.status_code == 404:
                    log_pass(test_name, f"Correctly rejected bad code: {resp.json()}")
                else:
                    log_fail(test_name, f"Expected 404, got {resp.status_code}: {resp.text}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")


async def test_messages(token: str):
    """Test 5: Messages history + send + auto-join + validation"""
    headers = {"Authorization": f"Bearer {token}"}
    
    async with httpx.AsyncClient(timeout=30) as client:
        # Get the General clan id
        resp = await client.get(f"{API_BASE}/clans", headers=headers)
        clans = resp.json()
        general_clan = next((c for c in clans if c["name"] == "General"), None)
        
        if not general_clan:
            log_fail("Messages test setup", "Could not find General clan")
            return
        
        clan_id = general_clan["id"]
        
        # 5a: Get messages (auto-joins)
        test_name = "GET /api/clans/{id}/messages - auto-join"
        try:
            resp = await client.get(f"{API_BASE}/clans/{clan_id}/messages", headers=headers)
            if resp.status_code == 200:
                messages = resp.json()
                log_pass(test_name, f"Retrieved {len(messages)} messages, auto-joined")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 5b: Send message
        test_name = "POST /api/clans/{id}/messages - send message"
        try:
            resp = await client.post(f"{API_BASE}/clans/{clan_id}/messages", headers=headers, json={"text": "Hello from test!"})
            if resp.status_code == 200:
                msg = resp.json()
                if msg.get("id") and msg.get("user_name") and msg.get("created_at") and msg.get("text") == "Hello from test!":
                    log_pass(test_name, f"Message sent: id={msg.get('id')}, user={msg.get('user_name')}")
                else:
                    log_fail(test_name, f"Message missing required fields: {msg}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 5c: Empty message should fail
        test_name = "POST /api/clans/{id}/messages - empty text returns 400"
        try:
            resp = await client.post(f"{API_BASE}/clans/{clan_id}/messages", headers=headers, json={"text": ""})
            if resp.status_code == 400:
                log_pass(test_name, f"Correctly rejected empty message: {resp.json()}")
            else:
                log_fail(test_name, f"Expected 400, got {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")


async def test_storage(token: str):
    """Test 6: Supabase Storage upload"""
    headers = {"Authorization": f"Bearer {token}"}
    
    async with httpx.AsyncClient(timeout=60) as client:
        # 6a: Upload without auth should fail
        test_name = "POST /api/upload - without auth returns 401"
        try:
            # Create a small PNG file (1x1 red pixel)
            png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {"file": ("test.png", io.BytesIO(png_data), "image/png")}
            
            resp = await client.post(f"{API_BASE}/upload", files=files)
            if resp.status_code == 401:
                log_pass(test_name, "Correctly rejected upload without auth")
            else:
                log_fail(test_name, f"Expected 401, got {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 6b: Upload with auth
        test_name = "POST /api/upload - with auth returns path and signed_url"
        signed_url = None
        try:
            png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
            files = {"file": ("test.png", io.BytesIO(png_data), "image/png")}
            
            resp = await client.post(f"{API_BASE}/upload", headers=headers, files=files)
            if resp.status_code == 200:
                data = resp.json()
                path = data.get("path")
                signed_url = data.get("signed_url")
                
                if path and signed_url and signed_url.startswith("http"):
                    log_pass(test_name, f"Upload successful: path={path}, url={signed_url[:50]}...")
                else:
                    log_fail(test_name, f"Missing or invalid path/signed_url: {data}")
            else:
                log_fail(test_name, f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_fail(test_name, f"Exception: {e}")
        
        # 6c: Verify signed URL is accessible
        if signed_url:
            test_name = "GET signed_url - verify file is accessible"
            try:
                resp = await client.get(signed_url)
                if resp.status_code == 200 and len(resp.content) > 0:
                    log_pass(test_name, f"File accessible, size: {len(resp.content)} bytes")
                else:
                    log_fail(test_name, f"Status {resp.status_code}, content length: {len(resp.content)}")
            except Exception as e:
                log_fail(test_name, f"Exception: {e}")


async def test_websocket(token: str):
    """Test 7: WebSocket realtime broadcast"""
    # Get a clan to test with
    async with httpx.AsyncClient(timeout=30) as client:
        headers = {"Authorization": f"Bearer {token}"}
        resp = await client.get(f"{API_BASE}/clans", headers=headers)
        clans = resp.json()
        general_clan = next((c for c in clans if c["name"] == "General"), None)
        
        if not general_clan:
            log_fail("WebSocket test setup", "Could not find General clan")
            return
        
        clan_id = general_clan["id"]
        
        # Determine WebSocket URL (wss for https, ws for http)
        ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_base}/api/ws/{clan_id}"
        
        # 7a: Connect without token should be rejected
        test_name = "WebSocket /api/ws/{clan_id} - without token rejected"
        try:
            async with websockets.connect(f"{ws_url}") as ws:
                # If we get here, connection was accepted (should not happen)
                log_fail(test_name, "Connection accepted without token")
        except websockets.exceptions.InvalidStatusCode as e:
            if e.status_code in (401, 403):
                log_pass(test_name, f"Correctly rejected: status {e.status_code}")
            else:
                log_fail(test_name, f"Unexpected status: {e.status_code}")
        except Exception as e:
            # Connection closed or rejected
            log_pass(test_name, f"Connection rejected/closed: {type(e).__name__}")
        
        # 7b: Connect with invalid token should be rejected
        test_name = "WebSocket /api/ws/{clan_id} - with invalid token rejected"
        try:
            async with websockets.connect(f"{ws_url}?token=invalid.token.here") as ws:
                log_fail(test_name, "Connection accepted with invalid token")
        except Exception as e:
            log_pass(test_name, f"Connection rejected: {type(e).__name__}")
        
        # 7c: Connect with valid token and receive broadcast
        test_name = "WebSocket /api/ws/{clan_id} - with valid token receives broadcast"
        try:
            async with websockets.connect(f"{ws_url}?token={token}") as ws:
                # Connection successful
                print(f"   WebSocket connected successfully")
                
                # Send a message via REST API
                test_message = f"WebSocket test message {asyncio.get_event_loop().time()}"
                resp = await client.post(
                    f"{API_BASE}/clans/{clan_id}/messages",
                    headers=headers,
                    json={"text": test_message}
                )
                
                if resp.status_code != 200:
                    log_fail(test_name, f"Failed to send REST message: {resp.status_code}")
                    return
                
                # Wait for WebSocket message
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=5)
                    data = json.loads(msg)
                    
                    if data.get("type") == "message" and "message" in data:
                        message_obj = data["message"]
                        if message_obj.get("text") == test_message:
                            log_pass(test_name, f"Received broadcast: {message_obj.get('text')[:50]}")
                        else:
                            log_fail(test_name, f"Received different message: {message_obj}")
                    else:
                        log_fail(test_name, f"Invalid message format: {data}")
                except asyncio.TimeoutError:
                    log_fail(test_name, "Timeout waiting for WebSocket message")
        except websockets.exceptions.InvalidStatusCode as e:
            log_fail(test_name, f"WebSocket connection failed with status {e.status_code}. This may be an ingress routing issue.")
        except Exception as e:
            log_fail(test_name, f"Exception: {type(e).__name__}: {e}")


async def main():
    print("=" * 80)
    print("ClanChat Backend API Test Suite")
    print("=" * 80)
    print()
    
    # Test 1: Health check
    await test_health_check()
    print()
    
    # Test 2: Dev token (get auth token for subsequent tests)
    token, user = await test_dev_token()
    print()
    
    if not token:
        print("❌ Cannot proceed without valid token")
        return
    
    # Test 3: Auth /me endpoint
    await test_auth_me(token)
    print()
    
    # Test 4: Clans
    await test_clans(token)
    print()
    
    # Test 5: Messages
    await test_messages(token)
    print()
    
    # Test 6: Storage
    await test_storage(token)
    print()
    
    # Test 7: WebSocket
    await test_websocket(token)
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"✅ Passed: {len(test_results['passed'])}")
    print(f"❌ Failed: {len(test_results['failed'])}")
    print()
    
    if test_results["failed"]:
        print("Failed tests:")
        for test in test_results["failed"]:
            print(f"  - {test}")
    else:
        print("🎉 All tests passed!")
    print()


if __name__ == "__main__":
    asyncio.run(main())
