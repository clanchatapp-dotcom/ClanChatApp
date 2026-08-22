#!/usr/bin/env python3
"""
FOCUSED REGRESSION TEST for ClanChat deploy-prep changes
Tests: Auth, Three-tier visibility, Encrypted DMs, Likes, Admin gating
"""
import os
import sys
import httpx
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment
load_dotenv('/app/.env')

BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'http://localhost:3000')
API_URL = f"{BASE_URL}/api"
MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME', 'clanchat')

print(f"🔧 Testing against: {API_URL}")
print(f"🔧 MongoDB: {MONGO_URL}/{DB_NAME}")

# Test counters
tests_passed = 0
tests_failed = 0

def test_result(name: str, passed: bool, detail: str = ""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✅ {name}")
        if detail:
            print(f"   {detail}")
    else:
        tests_failed += 1
        print(f"❌ {name}")
        if detail:
            print(f"   {detail}")

async def main():
    global tests_passed, tests_failed
    
    print("\n" + "="*80)
    print("FOCUSED REGRESSION TEST - Deploy-Prep Changes")
    print("="*80 + "\n")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        
        # ============================================================
        # 1. AUTH TESTS
        # ============================================================
        print("\n📋 TEST SUITE 1: AUTH")
        print("-" * 80)
        
        # Test 1.1: Create RegA user
        try:
            r = await client.post(f"{API_URL}/dev/token", json={"name": "RegA"})
            if r.status_code == 200:
                data = r.json()
                rega_token = data.get('access_token')
                rega_handle = data['user']['handle']
                test_result("AUTH-1.1: POST /api/dev/token (RegA)", True, 
                           f"Token received, handle={rega_handle}")
            else:
                test_result("AUTH-1.1: POST /api/dev/token (RegA)", False, 
                           f"Status {r.status_code}: {r.text}")
                return
        except Exception as e:
            test_result("AUTH-1.1: POST /api/dev/token (RegA)", False, str(e))
            return
        
        # Test 1.2: GET /api/me with valid token
        try:
            r = await client.get(f"{API_URL}/me", 
                                headers={"Authorization": f"Bearer {rega_token}"})
            if r.status_code == 200:
                data = r.json()
                has_handle = 'handle' in data
                test_result("AUTH-1.2: GET /api/me (valid token)", True, 
                           f"Profile returned, handle={data.get('handle')}")
            else:
                test_result("AUTH-1.2: GET /api/me (valid token)", False, 
                           f"Status {r.status_code}: {r.text}")
        except Exception as e:
            test_result("AUTH-1.2: GET /api/me (valid token)", False, str(e))
        
        # Test 1.3: GET /api/me without token (should be 401)
        try:
            r = await client.get(f"{API_URL}/me")
            if r.status_code == 401:
                test_result("AUTH-1.3: GET /api/me (no token)", True, "Correctly returned 401")
            else:
                test_result("AUTH-1.3: GET /api/me (no token)", False, 
                           f"Expected 401, got {r.status_code}")
        except Exception as e:
            test_result("AUTH-1.3: GET /api/me (no token)", False, str(e))
        
        # Test 1.4: GET /api/me with malformed token (should be 401)
        try:
            r = await client.get(f"{API_URL}/me", 
                                headers={"Authorization": "Bearer invalid.token.here"})
            if r.status_code == 401:
                test_result("AUTH-1.4: GET /api/me (malformed token)", True, 
                           "Correctly returned 401")
            else:
                test_result("AUTH-1.4: GET /api/me (malformed token)", False, 
                           f"Expected 401, got {r.status_code}")
        except Exception as e:
            test_result("AUTH-1.4: GET /api/me (malformed token)", False, str(e))
        
        # ============================================================
        # 2. THREE-TIER VISIBILITY TESTS
        # ============================================================
        print("\n📋 TEST SUITE 2: THREE-TIER VISIBILITY")
        print("-" * 80)
        
        # Create Alpha2 and Beta2 users
        try:
            r = await client.post(f"{API_URL}/dev/token", json={"name": "Alpha2"})
            alpha2_token = r.json()['access_token']
            alpha2_handle = r.json()['user']['handle']
            test_result("VISIBILITY-2.1: Create Alpha2 user", r.status_code == 200, 
                       f"handle={alpha2_handle}")
        except Exception as e:
            test_result("VISIBILITY-2.1: Create Alpha2 user", False, str(e))
            return
        
        try:
            r = await client.post(f"{API_URL}/dev/token", json={"name": "Beta2"})
            beta2_token = r.json()['access_token']
            beta2_handle = r.json()['user']['handle']
            test_result("VISIBILITY-2.2: Create Beta2 user", r.status_code == 200, 
                       f"handle={beta2_handle}")
        except Exception as e:
            test_result("VISIBILITY-2.2: Create Beta2 user", False, str(e))
            return
        
        # Alpha2 creates public, followers, inner posts
        post_ids = {}
        for tier in ['public', 'followers', 'inner']:
            try:
                r = await client.post(f"{API_URL}/posts", 
                    json={"tier": tier, "text": f"Alpha2 {tier} post for regression test", 
                          "tags": ["regression", "test"]},
                    headers={"Authorization": f"Bearer {alpha2_token}"})
                if r.status_code == 200:
                    post_ids[tier] = r.json()['id']
                    test_result(f"VISIBILITY-2.3.{tier}: Alpha2 creates {tier} post", True, 
                               f"post_id={post_ids[tier]}")
                else:
                    test_result(f"VISIBILITY-2.3.{tier}: Alpha2 creates {tier} post", False, 
                               f"Status {r.status_code}")
            except Exception as e:
                test_result(f"VISIBILITY-2.3.{tier}: Alpha2 creates {tier} post", False, str(e))
        
        # Beta2 (not following) should see ONLY public post
        try:
            r = await client.get(f"{API_URL}/feed?scope=general", 
                                headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                posts = r.json()
                alpha_posts = [p for p in posts if p['author']['handle'] == alpha2_handle]
                visible_tiers = [p['tier'] for p in alpha_posts]
                if visible_tiers == ['public']:
                    test_result("VISIBILITY-2.4: Beta2 sees ONLY public (not following)", True, 
                               f"Visible tiers: {visible_tiers}")
                else:
                    test_result("VISIBILITY-2.4: Beta2 sees ONLY public (not following)", False, 
                               f"Expected ['public'], got {visible_tiers}")
            else:
                test_result("VISIBILITY-2.4: Beta2 sees ONLY public (not following)", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("VISIBILITY-2.4: Beta2 sees ONLY public (not following)", False, str(e))
        
        # Beta2 follows Alpha2 (open mode -> auto-approved)
        try:
            r = await client.post(f"{API_URL}/follow/{alpha2_handle}", 
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200 and r.json().get('status') == 'approved':
                test_result("VISIBILITY-2.5: Beta2 follows Alpha2 (auto-approved)", True)
            else:
                test_result("VISIBILITY-2.5: Beta2 follows Alpha2 (auto-approved)", False, 
                           f"Status {r.status_code}, response: {r.text}")
        except Exception as e:
            test_result("VISIBILITY-2.5: Beta2 follows Alpha2 (auto-approved)", False, str(e))
        
        # Beta2 should now see public + followers (NOT inner)
        try:
            r = await client.get(f"{API_URL}/feed?scope=general", 
                                headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                posts = r.json()
                alpha_posts = [p for p in posts if p['author']['handle'] == alpha2_handle]
                visible_tiers = sorted([p['tier'] for p in alpha_posts])
                expected = ['followers', 'public']
                if visible_tiers == expected:
                    test_result("VISIBILITY-2.6: Beta2 sees public+followers (NOT inner)", True, 
                               f"Visible tiers: {visible_tiers}")
                else:
                    test_result("VISIBILITY-2.6: Beta2 sees public+followers (NOT inner)", False, 
                               f"Expected {expected}, got {visible_tiers}")
            else:
                test_result("VISIBILITY-2.6: Beta2 sees public+followers (NOT inner)", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("VISIBILITY-2.6: Beta2 sees public+followers (NOT inner)", False, str(e))
        
        # Alpha2 invites Beta2 to inner circle
        try:
            r = await client.post(f"{API_URL}/inner/invite/{beta2_handle}", 
                                 headers={"Authorization": f"Bearer {alpha2_token}"})
            if r.status_code == 200 and r.json().get('status') == 'pending':
                test_result("VISIBILITY-2.7: Alpha2 invites Beta2 to inner circle", True)
            else:
                test_result("VISIBILITY-2.7: Alpha2 invites Beta2 to inner circle", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("VISIBILITY-2.7: Alpha2 invites Beta2 to inner circle", False, str(e))
        
        # Beta2 accepts inner circle invite
        try:
            r = await client.post(f"{API_URL}/inner/accept/{alpha2_handle}", 
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200 and r.json().get('status') == 'accepted':
                test_result("VISIBILITY-2.8: Beta2 accepts inner circle invite", True)
            else:
                test_result("VISIBILITY-2.8: Beta2 accepts inner circle invite", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("VISIBILITY-2.8: Beta2 accepts inner circle invite", False, str(e))
        
        # Beta2 should now see ALL three tiers
        try:
            r = await client.get(f"{API_URL}/feed?scope=general", 
                                headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                posts = r.json()
                alpha_posts = [p for p in posts if p['author']['handle'] == alpha2_handle]
                visible_tiers = sorted([p['tier'] for p in alpha_posts])
                expected = ['followers', 'inner', 'public']
                if visible_tiers == expected:
                    test_result("VISIBILITY-2.9: Beta2 sees ALL tiers (public+followers+inner)", True, 
                               f"Visible tiers: {visible_tiers}")
                else:
                    test_result("VISIBILITY-2.9: Beta2 sees ALL tiers (public+followers+inner)", False, 
                               f"Expected {expected}, got {visible_tiers}")
            else:
                test_result("VISIBILITY-2.9: Beta2 sees ALL tiers (public+followers+inner)", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("VISIBILITY-2.9: Beta2 sees ALL tiers (public+followers+inner)", False, str(e))
        
        # ============================================================
        # 3. ENCRYPTED DM TESTS
        # ============================================================
        print("\n📋 TEST SUITE 3: ENCRYPTED DMs")
        print("-" * 80)
        
        # Alpha2 sends DM to Beta2
        dm_text = "reg check"
        dm_id = None
        try:
            r = await client.post(f"{API_URL}/dms/{beta2_handle}", 
                                 json={"text": dm_text},
                                 headers={"Authorization": f"Bearer {alpha2_token}"})
            if r.status_code == 200:
                dm_id = r.json()['id']
                test_result("DM-3.1: Alpha2 sends DM to Beta2", True, f"dm_id={dm_id}")
            else:
                test_result("DM-3.1: Alpha2 sends DM to Beta2", False, 
                           f"Status {r.status_code}: {r.text}")
        except Exception as e:
            test_result("DM-3.1: Alpha2 sends DM to Beta2", False, str(e))
        
        # Beta2 retrieves DM and verifies decryption
        try:
            r = await client.get(f"{API_URL}/dms/{alpha2_handle}", 
                                headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                data = r.json()
                messages = data.get('messages', [])
                can_dm = data.get('can_dm', False)
                
                if messages and messages[-1]['text'] == dm_text and can_dm:
                    test_result("DM-3.2: Beta2 retrieves decrypted DM", True, 
                               f"Text='{dm_text}', can_dm={can_dm}")
                else:
                    test_result("DM-3.2: Beta2 retrieves decrypted DM", False, 
                               f"Expected text='{dm_text}', got messages={messages}, can_dm={can_dm}")
            else:
                test_result("DM-3.2: Beta2 retrieves decrypted DM", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("DM-3.2: Beta2 retrieves decrypted DM", False, str(e))
        
        # Verify encryption at rest in MongoDB
        try:
            mongo_client = AsyncIOMotorClient(MONGO_URL)
            db = mongo_client[DB_NAME]
            
            if dm_id:
                dm_doc = await db.dms.find_one({'id': dm_id})
                if dm_doc:
                    content_enc = dm_doc.get('content_enc', '')
                    # Check that content_enc is NOT the plaintext
                    if content_enc and content_enc != dm_text and len(content_enc) > 20:
                        # Check if it looks like base64 ciphertext
                        is_base64_like = all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' 
                                            for c in content_enc)
                        if is_base64_like:
                            test_result("DM-3.3: MongoDB encryption at rest verified", True, 
                                       f"content_enc is base64 ciphertext (not plaintext), length={len(content_enc)}")
                        else:
                            test_result("DM-3.3: MongoDB encryption at rest verified", False, 
                                       f"content_enc doesn't look like base64: {content_enc[:50]}")
                    else:
                        test_result("DM-3.3: MongoDB encryption at rest verified", False, 
                                   f"content_enc is plaintext or empty: {content_enc}")
                else:
                    test_result("DM-3.3: MongoDB encryption at rest verified", False, 
                               "DM document not found in MongoDB")
            else:
                test_result("DM-3.3: MongoDB encryption at rest verified", False, 
                           "No dm_id to verify")
            
            mongo_client.close()
        except Exception as e:
            test_result("DM-3.3: MongoDB encryption at rest verified", False, str(e))
        
        # ============================================================
        # 4. LIKES TESTS
        # ============================================================
        print("\n📋 TEST SUITE 4: LIKES (public-only enforcement)")
        print("-" * 80)
        
        # Beta2 likes Alpha2's public post
        try:
            r = await client.post(f"{API_URL}/posts/{post_ids['public']}/like", 
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                data = r.json()
                if data.get('liked') == True:
                    test_result("LIKES-4.1: Beta2 likes Alpha2's public post", True, 
                               f"liked={data['liked']}, like_count={data.get('like_count')}")
                else:
                    test_result("LIKES-4.1: Beta2 likes Alpha2's public post", False, 
                               f"Expected liked=True, got {data}")
            else:
                test_result("LIKES-4.1: Beta2 likes Alpha2's public post", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("LIKES-4.1: Beta2 likes Alpha2's public post", False, str(e))
        
        # Beta2 tries to like Alpha2's followers post (should be 400)
        try:
            r = await client.post(f"{API_URL}/posts/{post_ids['followers']}/like", 
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 400:
                test_result("LIKES-4.2: Beta2 cannot like followers post (400)", True, 
                           "Correctly returned 400")
            else:
                test_result("LIKES-4.2: Beta2 cannot like followers post (400)", False, 
                           f"Expected 400, got {r.status_code}")
        except Exception as e:
            test_result("LIKES-4.2: Beta2 cannot like followers post (400)", False, str(e))
        
        # Beta2 tries to like Alpha2's inner post (should be 400)
        try:
            r = await client.post(f"{API_URL}/posts/{post_ids['inner']}/like", 
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 400:
                test_result("LIKES-4.3: Beta2 cannot like inner post (400)", True, 
                           "Correctly returned 400")
            else:
                test_result("LIKES-4.3: Beta2 cannot like inner post (400)", False, 
                           f"Expected 400, got {r.status_code}")
        except Exception as e:
            test_result("LIKES-4.3: Beta2 cannot like inner post (400)", False, str(e))
        
        # ============================================================
        # 5. ADMIN GATING + ONE ACTION TESTS
        # ============================================================
        print("\n📋 TEST SUITE 5: ADMIN GATING + REPORTING")
        print("-" * 80)
        
        # Create Admin user
        try:
            r = await client.post(f"{API_URL}/dev/token", json={"name": "Admin"})
            admin_token = r.json()['access_token']
            admin_handle = r.json()['user']['handle']
            
            # Verify admin status
            r2 = await client.get(f"{API_URL}/me", 
                                 headers={"Authorization": f"Bearer {admin_token}"})
            is_admin = r2.json().get('is_admin', False)
            
            if r.status_code == 200 and is_admin:
                test_result("ADMIN-5.1: Create Admin user (is_admin=true)", True, 
                           f"handle={admin_handle}, is_admin={is_admin}")
            else:
                test_result("ADMIN-5.1: Create Admin user (is_admin=true)", False, 
                           f"is_admin={is_admin}")
        except Exception as e:
            test_result("ADMIN-5.1: Create Admin user (is_admin=true)", False, str(e))
            return
        
        # Regular user tries to access admin stats (should be 403)
        try:
            r = await client.get(f"{API_URL}/admin/stats", 
                                headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 403:
                test_result("ADMIN-5.2: Regular user GET /admin/stats (403)", True, 
                           "Correctly returned 403")
            else:
                test_result("ADMIN-5.2: Regular user GET /admin/stats (403)", False, 
                           f"Expected 403, got {r.status_code}")
        except Exception as e:
            test_result("ADMIN-5.2: Regular user GET /admin/stats (403)", False, str(e))
        
        # No token tries to access admin stats (should be 401)
        try:
            r = await client.get(f"{API_URL}/admin/stats")
            if r.status_code == 401:
                test_result("ADMIN-5.3: No token GET /admin/stats (401)", True, 
                           "Correctly returned 401")
            else:
                test_result("ADMIN-5.3: No token GET /admin/stats (401)", False, 
                           f"Expected 401, got {r.status_code}")
        except Exception as e:
            test_result("ADMIN-5.3: No token GET /admin/stats (401)", False, str(e))
        
        # Admin user accesses admin stats (should be 200)
        try:
            r = await client.get(f"{API_URL}/admin/stats", 
                                headers={"Authorization": f"Bearer {admin_token}"})
            if r.status_code == 200:
                stats = r.json()
                test_result("ADMIN-5.4: Admin GET /admin/stats (200)", True, 
                           f"users={stats.get('users')}, posts={stats.get('posts')}")
            else:
                test_result("ADMIN-5.4: Admin GET /admin/stats (200)", False, 
                           f"Expected 200, got {r.status_code}")
        except Exception as e:
            test_result("ADMIN-5.4: Admin GET /admin/stats (200)", False, str(e))
        
        # Regular user reports Alpha2's public post
        report_id = None
        try:
            r = await client.post(f"{API_URL}/report", 
                                 json={"target_type": "post", 
                                      "target_id": post_ids['public'],
                                      "category": "spam",
                                      "note": "Regression test report"},
                                 headers={"Authorization": f"Bearer {beta2_token}"})
            if r.status_code == 200:
                report_id = r.json().get('id')
                test_result("ADMIN-5.5: Beta2 reports Alpha2's public post", True, 
                           f"report_id={report_id}")
            else:
                test_result("ADMIN-5.5: Beta2 reports Alpha2's public post", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("ADMIN-5.5: Beta2 reports Alpha2's public post", False, str(e))
        
        # Admin retrieves open reports
        try:
            r = await client.get(f"{API_URL}/admin/reports?status=open", 
                                headers={"Authorization": f"Bearer {admin_token}"})
            if r.status_code == 200:
                reports = r.json()
                matching_report = None
                for rep in reports:
                    if rep.get('id') == report_id:
                        matching_report = rep
                        break
                
                if matching_report:
                    test_result("ADMIN-5.6: Admin GET /admin/reports shows report", True, 
                               f"Found report, target_user={matching_report.get('target_user', {}).get('handle')}")
                else:
                    test_result("ADMIN-5.6: Admin GET /admin/reports shows report", False, 
                               f"Report {report_id} not found in {len(reports)} reports")
            else:
                test_result("ADMIN-5.6: Admin GET /admin/reports shows report", False, 
                           f"Status {r.status_code}")
        except Exception as e:
            test_result("ADMIN-5.6: Admin GET /admin/reports shows report", False, str(e))
        
        # Admin dismisses the report
        if report_id:
            try:
                r = await client.post(f"{API_URL}/admin/reports/{report_id}/action", 
                                     json={"action": "dismiss", "reason": "Regression test"},
                                     headers={"Authorization": f"Bearer {admin_token}"})
                if r.status_code == 200 and r.json().get('ok'):
                    test_result("ADMIN-5.7: Admin dismisses report", True, 
                               f"action=dismiss, ok={r.json().get('ok')}")
                else:
                    test_result("ADMIN-5.7: Admin dismisses report", False, 
                               f"Status {r.status_code}, response: {r.text}")
            except Exception as e:
                test_result("ADMIN-5.7: Admin dismisses report", False, str(e))
        else:
            test_result("ADMIN-5.7: Admin dismisses report", False, "No report_id to dismiss")
    
    # ============================================================
    # FINAL SUMMARY
    # ============================================================
    print("\n" + "="*80)
    print("REGRESSION TEST SUMMARY")
    print("="*80)
    print(f"✅ PASSED: {tests_passed}")
    print(f"❌ FAILED: {tests_failed}")
    print(f"📊 TOTAL:  {tests_passed + tests_failed}")
    
    if tests_failed == 0:
        print("\n🎉 ALL REGRESSION TESTS PASSED - NO REGRESSIONS DETECTED")
        print("✅ Deploy-prep changes (dotenv refactor) did NOT introduce any regressions")
    else:
        print(f"\n⚠️  {tests_failed} TEST(S) FAILED - REGRESSION DETECTED")
        print("❌ Deploy-prep changes may have introduced regressions")
    
    print("="*80 + "\n")
    
    return tests_failed == 0

if __name__ == '__main__':
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
