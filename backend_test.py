#!/usr/bin/env python3
"""
Backend test for THREE new ClanChat features:
1. Inner-Circle Groups (encrypted group chat)
2. DM unread counts + GET /api/unread
3. Restrict Comments (Instagram-style hidden comments)
"""
import asyncio
import httpx
import secrets
import sys

BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

# Test results tracking
tests_passed = 0
tests_failed = 0

def log_test(name: str, passed: bool, details: str = ""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✅ {name}")
        if details:
            print(f"   {details}")
    else:
        tests_failed += 1
        print(f"❌ {name}")
        if details:
            print(f"   {details}")

async def register_user(client: httpx.AsyncClient, name: str) -> dict:
    """Register a throwaway user and return {token, handle, id, email}"""
    rand = secrets.token_hex(4)
    email = f"{name.lower()}+{rand}@example.com"
    password = "secret123"
    r = await client.post(f"{BASE_URL}/auth/register", json={"email": email, "password": password, "name": name})
    if r.status_code != 200:
        raise Exception(f"Register failed: {r.status_code} {r.text}")
    data = r.json()
    return {"token": data["access_token"], "handle": data["user"]["handle"], 
            "id": data["user"]["id"], "email": email}

async def test_inner_circle_groups():
    """Test Inner-Circle Groups feature"""
    print("\n" + "="*80)
    print("TEST 1: INNER-CIRCLE GROUPS")
    print("="*80)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Register Owner O, M1, M2, Stranger S
        print("\n[1.1] Registering users: Owner O, M1, M2, Stranger S...")
        O = await register_user(client, "Owner O")
        M1 = await register_user(client, "Member One")
        M2 = await register_user(client, "Member Two")
        S = await register_user(client, "Stranger S")
        print(f"   Owner: {O['handle']}, M1: {M1['handle']}, M2: {M2['handle']}, Stranger: {S['handle']}")
        
        # Make M1 and M2 in O's Inner Circle
        print("\n[1.2] Setting up Inner Circle: O invites M1 and M2...")
        
        # O invites M1
        r = await client.post(f"{BASE_URL}/inner/invite/{M1['handle']}", 
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O invites M1 to inner circle", r.status_code == 200, 
                f"status={r.json().get('status')}")
        
        # M1 accepts
        r = await client.post(f"{BASE_URL}/inner/accept/{O['handle']}", 
                             headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 accepts O's inner circle invite", r.status_code == 200, 
                f"status={r.json().get('status')}")
        
        # O invites M2
        r = await client.post(f"{BASE_URL}/inner/invite/{M2['handle']}", 
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O invites M2 to inner circle", r.status_code == 200)
        
        # M2 accepts
        r = await client.post(f"{BASE_URL}/inner/accept/{O['handle']}", 
                             headers={"Authorization": f"Bearer {M2['token']}"})
        log_test("M2 accepts O's inner circle invite", r.status_code == 200)
        
        # Create group with M1 (should succeed)
        print("\n[1.3] Creating group 'Squad' with M1...")
        r = await client.post(f"{BASE_URL}/groups", 
                             json={"name": "Squad", "members": [M1['handle']]},
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O creates group 'Squad' with M1", r.status_code == 200)
        
        if r.status_code == 200:
            group_data = r.json()
            group_id = group_data.get('id')
            member_count = group_data.get('member_count')
            members = group_data.get('members', [])
            member_handles = [m['handle'] for m in members]
            
            log_test("Group has correct member_count=2", member_count == 2, 
                    f"member_count={member_count}")
            log_test("Group members include O and M1", 
                    O['handle'] in member_handles and M1['handle'] in member_handles,
                    f"members={member_handles}")
            print(f"   Group ID: {group_id}")
        else:
            print(f"   ERROR: {r.text}")
            group_id = None
        
        # Try to create group with Stranger (should fail)
        print("\n[1.4] Attempting to create group with Stranger (should fail)...")
        r = await client.post(f"{BASE_URL}/groups", 
                             json={"name": "Bad", "members": [S['handle']]},
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O cannot create group with Stranger (not in inner circle)", 
                r.status_code == 400,
                f"status={r.status_code}, expected 400")
        
        if not group_id:
            print("   Skipping remaining tests (no group created)")
            return
        
        # M1 lists groups
        print("\n[1.5] M1 lists groups...")
        r = await client.get(f"{BASE_URL}/groups", 
                            headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 GET /api/groups", r.status_code == 200)
        if r.status_code == 200:
            groups = r.json()
            group_present = any(g['id'] == group_id for g in groups)
            log_test("Group 'Squad' is present in M1's groups", group_present,
                    f"found {len(groups)} groups")
        
        # M1 gets group detail
        print("\n[1.6] M1 gets group detail...")
        r = await client.get(f"{BASE_URL}/groups/{group_id}", 
                            headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 GET /api/groups/{id}", r.status_code == 200)
        if r.status_code == 200:
            detail = r.json()
            has_members = 'members' in detail
            has_messages = 'messages' in detail
            log_test("Group detail includes 'members' array", has_members)
            log_test("Group detail includes 'messages' array", has_messages)
        
        # Stranger tries to get group detail (should fail)
        print("\n[1.7] Stranger tries to get group detail (should fail)...")
        r = await client.get(f"{BASE_URL}/groups/{group_id}", 
                            headers={"Authorization": f"Bearer {S['token']}"})
        log_test("Stranger GET /api/groups/{id} returns 403", r.status_code == 403,
                f"status={r.status_code}, expected 403")
        
        # O sends message to group
        print("\n[1.8] O sends message 'hello squad' to group...")
        r = await client.post(f"{BASE_URL}/groups/{group_id}/messages", 
                             json={"text": "hello squad"},
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O POST /api/groups/{id}/messages", r.status_code == 200)
        if r.status_code == 200:
            msg = r.json()
            log_test("Message has correct text", msg.get('text') == 'hello squad')
            log_test("Message sender is O", msg.get('sender_id') == O['id'])
        
        # M1 gets group detail again to see message
        print("\n[1.9] M1 gets group detail to see message...")
        r = await client.get(f"{BASE_URL}/groups/{group_id}", 
                            headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 GET /api/groups/{id} after message", r.status_code == 200)
        if r.status_code == 200:
            detail = r.json()
            messages = detail.get('messages', [])
            if messages:
                last_msg = messages[-1]
                log_test("Message decrypted correctly", last_msg.get('text') == 'hello squad',
                        f"text='{last_msg.get('text')}'")
                log_test("Message sender is O", last_msg.get('sender_id') == O['id'])
            else:
                log_test("Messages array is not empty", False, "messages=[]")
        
        # Try to send empty message (should fail)
        print("\n[1.10] Attempting to send empty message (should fail)...")
        r = await client.post(f"{BASE_URL}/groups/{group_id}/messages", 
                             json={},
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("Empty message returns 400", r.status_code == 400,
                f"status={r.status_code}, expected 400")
        
        # M1 tries to rename group (should fail - not owner)
        print("\n[1.11] M1 tries to rename group (should fail - not owner)...")
        r = await client.put(f"{BASE_URL}/groups/{group_id}", 
                            json={"name": "Squad2"},
                            headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 (non-owner) PUT /api/groups/{id} returns 403", r.status_code == 403,
                f"status={r.status_code}, expected 403")
        
        # O renames group (should succeed)
        print("\n[1.12] O renames group to 'Squad2'...")
        r = await client.put(f"{BASE_URL}/groups/{group_id}", 
                            json={"name": "Squad2"},
                            headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O (owner) PUT /api/groups/{id}", r.status_code == 200)
        if r.status_code == 200:
            log_test("Group renamed successfully", r.json().get('name') == 'Squad2')
        
        # O adds M2 to group
        print("\n[1.13] O adds M2 to group...")
        r = await client.post(f"{BASE_URL}/groups/{group_id}/members", 
                             json={"handles": [M2['handle']]},
                             headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O POST /api/groups/{id}/members", r.status_code == 200)
        
        # Verify member_count is now 3
        r = await client.get(f"{BASE_URL}/groups/{group_id}", 
                            headers={"Authorization": f"Bearer {O['token']}"})
        if r.status_code == 200:
            detail = r.json()
            log_test("Group member_count is now 3", detail.get('member_count') == 3,
                    f"member_count={detail.get('member_count')}")
        
        # M1 self-leaves
        print("\n[1.14] M1 self-leaves the group...")
        r = await client.delete(f"{BASE_URL}/groups/{group_id}/members/{M1['handle']}", 
                               headers={"Authorization": f"Bearer {M1['token']}"})
        log_test("M1 DELETE /api/groups/{id}/members/{M1_handle} (self-leave)", 
                r.status_code == 200)
        
        # O deletes group
        print("\n[1.15] O deletes the group...")
        r = await client.delete(f"{BASE_URL}/groups/{group_id}", 
                               headers={"Authorization": f"Bearer {O['token']}"})
        log_test("O DELETE /api/groups/{id}", r.status_code == 200)

async def test_dm_unread():
    """Test DM unread counts + GET /api/unread"""
    print("\n" + "="*80)
    print("TEST 2: DM UNREAD COUNTS + /api/unread")
    print("="*80)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Register A and B
        print("\n[2.1] Registering users A and B...")
        A = await register_user(client, "User A")
        B = await register_user(client, "User B")
        print(f"   A: {A['handle']}, B: {B['handle']}")
        
        # Make them inner circle so DMs allowed
        print("\n[2.2] Setting up Inner Circle: A invites B...")
        r = await client.post(f"{BASE_URL}/inner/invite/{B['handle']}", 
                             headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A invites B to inner circle", r.status_code == 200)
        
        r = await client.post(f"{BASE_URL}/inner/accept/{A['handle']}", 
                             headers={"Authorization": f"Bearer {B['token']}"})
        log_test("B accepts A's inner circle invite", r.status_code == 200)
        
        # B sends 2 DMs to A
        print("\n[2.3] B sends 2 DMs to A...")
        r = await client.post(f"{BASE_URL}/dms/{A['handle']}", 
                             json={"text": "First message from B"},
                             headers={"Authorization": f"Bearer {B['token']}"})
        log_test("B sends first DM to A", r.status_code == 200)
        
        r = await client.post(f"{BASE_URL}/dms/{A['handle']}", 
                             json={"text": "Second message from B"},
                             headers={"Authorization": f"Bearer {B['token']}"})
        log_test("B sends second DM to A", r.status_code == 200)
        
        # A gets unread counts
        print("\n[2.4] A checks unread counts...")
        r = await client.get(f"{BASE_URL}/unread", 
                            headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A GET /api/unread", r.status_code == 200)
        
        if r.status_code == 200:
            unread = r.json()
            dms_unread = unread.get('dms', 0)
            log_test("A has dms >= 2", dms_unread >= 2,
                    f"dms={dms_unread}")
            print(f"   Unread: {unread}")
        
        # A gets DM threads
        print("\n[2.5] A checks DM threads...")
        r = await client.get(f"{BASE_URL}/dms", 
                            headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A GET /api/dms (threads)", r.status_code == 200)
        
        if r.status_code == 200:
            threads = r.json()
            b_thread = next((t for t in threads if t['user']['handle'] == B['handle']), None)
            if b_thread:
                thread_unread = b_thread.get('unread', 0)
                log_test("B's thread has unread >= 2", thread_unread >= 2,
                        f"unread={thread_unread}")
            else:
                log_test("B's thread found in threads", False, "thread not found")
        
        # A opens the thread (marks read)
        print("\n[2.6] A opens B's thread (marks read)...")
        r = await client.get(f"{BASE_URL}/dms/{B['handle']}", 
                            headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A GET /api/dms/{B_handle} (opens thread)", r.status_code == 200)
        
        # A checks unread counts again
        print("\n[2.7] A checks unread counts again (should decrease)...")
        r = await client.get(f"{BASE_URL}/unread", 
                            headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A GET /api/unread after opening thread", r.status_code == 200)
        
        if r.status_code == 200:
            unread_after = r.json()
            dms_after = unread_after.get('dms', 0)
            log_test("DMs unread decreased (that thread now contributes 0)", 
                    dms_after == 0,
                    f"dms={dms_after} (expected 0 since only one thread)")
            print(f"   Unread after: {unread_after}")

async def test_restrict_comments():
    """Test Restrict Comments (Instagram-style hidden comments)"""
    print("\n" + "="*80)
    print("TEST 3: RESTRICT COMMENTS")
    print("="*80)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Register A (author), C (commenter), X (viewer)
        print("\n[3.1] Registering users: A (author), C (commenter), X (viewer)...")
        A = await register_user(client, "Author A")
        C = await register_user(client, "Commenter C")
        X = await register_user(client, "Viewer X")
        print(f"   A: {A['handle']}, C: {C['handle']}, X: {X['handle']}")
        
        # A creates a public post
        print("\n[3.2] A creates a public post...")
        r = await client.post(f"{BASE_URL}/posts", 
                             json={"tier": "public", "text": "Test post for restrict comments"},
                             headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A creates public post", r.status_code == 200)
        
        if r.status_code != 200:
            print("   ERROR: Cannot create post, skipping remaining tests")
            return
        
        post_id = r.json().get('id')
        print(f"   Post ID: {post_id}")
        
        # C comments on the post
        print("\n[3.3] C comments 'hi from C' on the post...")
        r = await client.post(f"{BASE_URL}/posts/{post_id}/comments", 
                             json={"text": "hi from C"},
                             headers={"Authorization": f"Bearer {C['token']}"})
        log_test("C comments on post", r.status_code == 200)
        
        if r.status_code == 200:
            comment_id = r.json().get('id')
            print(f"   Comment ID: {comment_id}")
        
        # Viewer X gets comments (baseline - should see C's comment)
        print("\n[3.4] Viewer X gets comments (baseline - should see C's comment)...")
        r = await client.get(f"{BASE_URL}/posts/{post_id}/comments", 
                            headers={"Authorization": f"Bearer {X['token']}"})
        log_test("X GET /api/posts/{post_id}/comments", r.status_code == 200)
        
        if r.status_code == 200:
            comments = r.json()
            c_comment = next((cm for cm in comments if cm.get('text') == 'hi from C'), None)
            log_test("C's comment PRESENT for viewer X (baseline)", c_comment is not None,
                    f"found {len(comments)} comments")
        
        # A restricts C
        print("\n[3.5] A restricts C...")
        r = await client.post(f"{BASE_URL}/relations/{C['handle']}", 
                             json={"kind": "restrict"},
                             headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A POST /api/relations/{C_handle} {kind:'restrict'}", r.status_code == 200)
        
        # Viewer X gets comments again (should NOT see C's comment)
        print("\n[3.6] Viewer X gets comments after restrict (should NOT see C's comment)...")
        r = await client.get(f"{BASE_URL}/posts/{post_id}/comments", 
                            headers={"Authorization": f"Bearer {X['token']}"})
        log_test("X GET /api/posts/{post_id}/comments after restrict", r.status_code == 200)
        
        if r.status_code == 200:
            comments = r.json()
            c_comment = next((cm for cm in comments if cm.get('text') == 'hi from C'), None)
            log_test("C's comment ABSENT for viewer X (after restrict)", c_comment is None,
                    f"found {len(comments)} comments")
        
        # C gets comments (should see own comment with restricted:true)
        print("\n[3.7] C gets comments (should see own comment with restricted:true)...")
        r = await client.get(f"{BASE_URL}/posts/{post_id}/comments", 
                            headers={"Authorization": f"Bearer {C['token']}"})
        log_test("C GET /api/posts/{post_id}/comments", r.status_code == 200)
        
        if r.status_code == 200:
            comments = r.json()
            c_comment = next((cm for cm in comments if cm.get('text') == 'hi from C'), None)
            if c_comment:
                log_test("C's comment PRESENT for C (self)", True)
                log_test("C's comment has restricted:true", c_comment.get('restricted') == True,
                        f"restricted={c_comment.get('restricted')}")
            else:
                log_test("C's comment PRESENT for C (self)", False, "comment not found")
        
        # A (post author) gets comments (should see C's comment with restricted:true)
        print("\n[3.8] A (post author) gets comments (should see C's comment with restricted:true)...")
        r = await client.get(f"{BASE_URL}/posts/{post_id}/comments", 
                            headers={"Authorization": f"Bearer {A['token']}"})
        log_test("A GET /api/posts/{post_id}/comments", r.status_code == 200)
        
        if r.status_code == 200:
            comments = r.json()
            c_comment = next((cm for cm in comments if cm.get('text') == 'hi from C'), None)
            if c_comment:
                log_test("C's comment PRESENT for A (post author)", True)
                log_test("C's comment has restricted:true for A", c_comment.get('restricted') == True,
                        f"restricted={c_comment.get('restricted')}")
            else:
                log_test("C's comment PRESENT for A (post author)", False, "comment not found")

async def main():
    print("\n" + "="*80)
    print("CLANCHAT BACKEND TEST - THREE NEW FEATURES")
    print("="*80)
    print("Testing:")
    print("1. Inner-Circle Groups (encrypted group chat)")
    print("2. DM unread counts + GET /api/unread")
    print("3. Restrict Comments (Instagram-style hidden comments)")
    print("="*80)
    
    try:
        await test_inner_circle_groups()
        await test_dm_unread()
        await test_restrict_comments()
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"Total: {tests_passed + tests_failed}")
    
    if tests_failed == 0:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {tests_failed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
