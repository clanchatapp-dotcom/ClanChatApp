#!/usr/bin/env python3
"""
ClanChat Admin & Reporting Backend Tests
Tests admin gating, reporting, CSAM auto-quarantine, admin actions, strike escalation, and audit log
"""
import requests
import json
import sys

# Base URL from .env
BASE_URL = "https://auth-consolidation-3.preview.emergentagent.com/api"

# Test results tracking
tests_passed = 0
tests_failed = 0

def log_test(name, passed, details=""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✅ PASS: {name}")
        if details:
            print(f"   {details}")
    else:
        tests_failed += 1
        print(f"❌ FAIL: {name}")
        if details:
            print(f"   {details}")

def create_user(name):
    """Create a dev user and return token and user info"""
    try:
        resp = requests.post(f"{BASE_URL}/dev/token", json={"name": name}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data['access_token'], data['user']
        else:
            print(f"Failed to create user {name}: {resp.status_code} {resp.text}")
            return None, None
    except Exception as e:
        print(f"Exception creating user {name}: {e}")
        return None, None

def get_me(token):
    """Get current user profile"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        resp = requests.get(f"{BASE_URL}/me", headers=headers, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        print(f"Exception getting /me: {e}")
        return None

def create_post(token, tier="public", text="Test post", tags=None):
    """Create a post and return post data"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        payload = {"tier": tier, "text": text, "tags": tags or []}
        resp = requests.post(f"{BASE_URL}/posts", headers=headers, json=payload, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"Failed to create post: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        print(f"Exception creating post: {e}")
        return None

def main():
    print("=" * 80)
    print("ClanChat Admin & Reporting Backend Tests")
    print("=" * 80)
    print()

    # ========== SETUP: Create users ==========
    print("SETUP: Creating test users...")
    admin_token, admin_user = create_user("Admin")
    regular_token, regular_user = create_user("Regular")
    victim_token, victim_user = create_user("Victim")

    if not admin_token or not regular_token or not victim_token:
        print("❌ FATAL: Failed to create test users")
        sys.exit(1)

    print(f"✓ Admin user: {admin_user['handle']} (email: {admin_user['email']})")
    print(f"✓ Regular user: {regular_user['handle']} (email: {regular_user['email']})")
    print(f"✓ Victim user: {victim_user['handle']} (email: {victim_user['email']})")
    print()

    # Verify admin status
    admin_profile = get_me(admin_token)
    if admin_profile:
        is_admin = admin_profile.get('is_admin', False)
        log_test("Admin user has is_admin=true", is_admin, 
                 f"is_admin={is_admin}, email={admin_profile.get('email')}")
    else:
        log_test("Admin user has is_admin=true", False, "Failed to get admin profile")

    regular_profile = get_me(regular_token)
    if regular_profile:
        is_admin = regular_profile.get('is_admin', False)
        log_test("Regular user has is_admin=false", not is_admin, 
                 f"is_admin={is_admin}, email={regular_profile.get('email')}")
    else:
        log_test("Regular user has is_admin=false", False, "Failed to get regular profile")

    print()

    # ========== TEST 1: ADMIN GATING ==========
    print("TEST 1: ADMIN GATING")
    print("-" * 80)

    admin_endpoints = [
        "/admin/stats",
        "/admin/reports",
        "/admin/csam",
        "/admin/users",
        "/admin/audit"
    ]

    # Test with NO token (should be 401)
    for endpoint in admin_endpoints:
        try:
            resp = requests.get(f"{BASE_URL}{endpoint}", timeout=10)
            log_test(f"GET {endpoint} without token returns 401", 
                     resp.status_code == 401,
                     f"Status: {resp.status_code}")
        except Exception as e:
            log_test(f"GET {endpoint} without token returns 401", False, f"Exception: {e}")

    # Test with REGULAR token (should be 403)
    for endpoint in admin_endpoints:
        try:
            headers = {"Authorization": f"Bearer {regular_token}"}
            resp = requests.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
            log_test(f"GET {endpoint} with regular token returns 403", 
                     resp.status_code == 403,
                     f"Status: {resp.status_code}")
        except Exception as e:
            log_test(f"GET {endpoint} with regular token returns 403", False, f"Exception: {e}")

    # Test with ADMIN token (should be 200)
    for endpoint in admin_endpoints:
        try:
            headers = {"Authorization": f"Bearer {admin_token}"}
            resp = requests.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
            log_test(f"GET {endpoint} with admin token returns 200", 
                     resp.status_code == 200,
                     f"Status: {resp.status_code}")
        except Exception as e:
            log_test(f"GET {endpoint} with admin token returns 200", False, f"Exception: {e}")

    # Test POST /api/admin/users/{handle}/strike with regular token (should be 403)
    try:
        headers = {"Authorization": f"Bearer {regular_token}"}
        resp = requests.post(f"{BASE_URL}/admin/users/{victim_user['handle']}/strike", 
                            headers=headers, json={"reason": "test"}, timeout=10)
        log_test(f"POST /admin/users/{{handle}}/strike with regular token returns 403", 
                 resp.status_code == 403,
                 f"Status: {resp.status_code}")
    except Exception as e:
        log_test(f"POST /admin/users/{{handle}}/strike with regular token returns 403", False, f"Exception: {e}")

    print()

    # ========== TEST 2: REPORTING ==========
    print("TEST 2: REPORTING")
    print("-" * 80)

    # Create a post by victim to report
    victim_post = create_post(victim_token, tier="public", text="Reportable post content", tags=["test"])
    if victim_post:
        print(f"✓ Created victim post: {victim_post['id']}")
        
        # Report with valid category (harassment)
        try:
            headers = {"Authorization": f"Bearer {regular_token}"}
            payload = {
                "target_type": "post",
                "target_id": victim_post['id'],
                "category": "harassment",
                "note": "This is abusive content"
            }
            resp = requests.post(f"{BASE_URL}/report", headers=headers, json=payload, timeout=10)
            log_test("POST /report with valid category (harassment) returns 200", 
                     resp.status_code == 200 and resp.json().get('ok') == True,
                     f"Status: {resp.status_code}, Response: {resp.json() if resp.status_code == 200 else resp.text}")
        except Exception as e:
            log_test("POST /report with valid category (harassment) returns 200", False, f"Exception: {e}")

        # Report with invalid category (should be 400)
        try:
            headers = {"Authorization": f"Bearer {regular_token}"}
            payload = {
                "target_type": "post",
                "target_id": victim_post['id'],
                "category": "invalid_category",
                "note": "Test invalid"
            }
            resp = requests.post(f"{BASE_URL}/report", headers=headers, json=payload, timeout=10)
            log_test("POST /report with invalid category returns 400", 
                     resp.status_code == 400,
                     f"Status: {resp.status_code}")
        except Exception as e:
            log_test("POST /report with invalid category returns 400", False, f"Exception: {e}")
    else:
        log_test("Create victim post for reporting", False, "Failed to create post")

    print()

    # ========== TEST 3: CSAM AUTO-QUARANTINE ==========
    print("TEST 3: CSAM AUTO-QUARANTINE")
    print("-" * 80)

    # Create another post by victim for CSAM report
    csam_post = create_post(victim_token, tier="public", text="Post to be quarantined by CSAM report", tags=["csam_test"])
    if csam_post:
        print(f"✓ Created CSAM test post: {csam_post['id']}")
        
        # Report as CSAM
        try:
            headers = {"Authorization": f"Bearer {regular_token}"}
            payload = {
                "target_type": "post",
                "target_id": csam_post['id'],
                "category": "csam",
                "note": "CSAM content detected"
            }
            resp = requests.post(f"{BASE_URL}/report", headers=headers, json=payload, timeout=10)
            log_test("POST /report with category=csam returns 200", 
                     resp.status_code == 200 and resp.json().get('ok') == True,
                     f"Status: {resp.status_code}")
        except Exception as e:
            log_test("POST /report with category=csam returns 200", False, f"Exception: {e}")

        # Verify post is quarantined - should NOT appear in victim's own feed
        try:
            headers = {"Authorization": f"Bearer {victim_token}"}
            resp = requests.get(f"{BASE_URL}/feed?scope=general", headers=headers, timeout=10)
            if resp.status_code == 200:
                feed = resp.json()
                post_ids = [p['id'] for p in feed]
                is_hidden = csam_post['id'] not in post_ids
                log_test("CSAM-reported post hidden from victim's own feed", 
                         is_hidden,
                         f"Post {csam_post['id']} {'NOT found' if is_hidden else 'FOUND'} in feed")
            else:
                log_test("CSAM-reported post hidden from victim's own feed", False, 
                         f"Failed to get feed: {resp.status_code}")
        except Exception as e:
            log_test("CSAM-reported post hidden from victim's own feed", False, f"Exception: {e}")

        # Verify post is hidden from victim's profile posts
        try:
            headers = {"Authorization": f"Bearer {victim_token}"}
            resp = requests.get(f"{BASE_URL}/users/{victim_user['handle']}/posts", headers=headers, timeout=10)
            if resp.status_code == 200:
                posts = resp.json()
                post_ids = [p['id'] for p in posts]
                is_hidden = csam_post['id'] not in post_ids
                log_test("CSAM-reported post hidden from victim's profile posts", 
                         is_hidden,
                         f"Post {csam_post['id']} {'NOT found' if is_hidden else 'FOUND'} in profile")
            else:
                log_test("CSAM-reported post hidden from victim's profile posts", False, 
                         f"Failed to get profile posts: {resp.status_code}")
        except Exception as e:
            log_test("CSAM-reported post hidden from victim's profile posts", False, f"Exception: {e}")

        # Verify post appears in admin CSAM queue
        try:
            headers = {"Authorization": f"Bearer {admin_token}"}
            resp = requests.get(f"{BASE_URL}/admin/csam", headers=headers, timeout=10)
            if resp.status_code == 200:
                csam_reports = resp.json()
                found = any(r['target_id'] == csam_post['id'] for r in csam_reports)
                log_test("CSAM-reported post appears in admin CSAM queue", 
                         found,
                         f"Found {len(csam_reports)} CSAM reports, target post {'found' if found else 'NOT found'}")
            else:
                log_test("CSAM-reported post appears in admin CSAM queue", False, 
                         f"Failed to get CSAM queue: {resp.status_code}")
        except Exception as e:
            log_test("CSAM-reported post appears in admin CSAM queue", False, f"Exception: {e}")
    else:
        log_test("Create CSAM test post", False, "Failed to create post")

    print()

    # ========== TEST 4: ADMIN STATS ==========
    print("TEST 4: ADMIN STATS")
    print("-" * 80)

    try:
        headers = {"Authorization": f"Bearer {admin_token}"}
        resp = requests.get(f"{BASE_URL}/admin/stats", headers=headers, timeout=10)
        if resp.status_code == 200:
            stats = resp.json()
            has_users = isinstance(stats.get('users'), int) and stats['users'] > 0
            has_posts = isinstance(stats.get('posts'), int) and stats['posts'] > 0
            has_open_reports = isinstance(stats.get('open_reports'), int) and stats['open_reports'] >= 1
            has_csam_reports = isinstance(stats.get('csam_reports'), int) and stats['csam_reports'] >= 1
            
            log_test("Admin stats returns numeric users count", has_users, 
                     f"users={stats.get('users')}")
            log_test("Admin stats returns numeric posts count", has_posts, 
                     f"posts={stats.get('posts')}")
            log_test("Admin stats returns open_reports >= 1", has_open_reports, 
                     f"open_reports={stats.get('open_reports')}")
            log_test("Admin stats returns csam_reports >= 1", has_csam_reports, 
                     f"csam_reports={stats.get('csam_reports')}")
        else:
            log_test("Admin stats endpoint", False, f"Status: {resp.status_code}")
    except Exception as e:
        log_test("Admin stats endpoint", False, f"Exception: {e}")

    print()

    # ========== TEST 5: ADMIN REPORTS + ACTIONS ==========
    print("TEST 5: ADMIN REPORTS + ACTIONS")
    print("-" * 80)

    # Get open reports
    try:
        headers = {"Authorization": f"Bearer {admin_token}"}
        resp = requests.get(f"{BASE_URL}/admin/reports?status=open", headers=headers, timeout=10)
        if resp.status_code == 200:
            reports = resp.json()
            print(f"✓ Found {len(reports)} open reports")
            
            # Find the harassment report
            harassment_report = None
            for r in reports:
                if r.get('category') == 'harassment' and r.get('target_type') == 'post':
                    harassment_report = r
                    break
            
            if harassment_report:
                target_user = harassment_report.get('target_user', {})
                preview = harassment_report.get('preview', {})
                
                log_test("Harassment report has target_user.handle", 
                         target_user.get('handle') == victim_user['handle'],
                         f"target_user.handle={target_user.get('handle')}, expected={victim_user['handle']}")
                
                log_test("Harassment report has post text preview", 
                         'Reportable post' in preview.get('text', ''),
                         f"preview.text={preview.get('text', '')[:50]}")
                
                # Test action: dismiss
                # Create a new report to dismiss
                dismiss_post = create_post(victim_token, tier="public", text="Post for dismiss test", tags=["dismiss"])
                if dismiss_post:
                    headers_reg = {"Authorization": f"Bearer {regular_token}"}
                    report_resp = requests.post(f"{BASE_URL}/report", headers=headers_reg, 
                                               json={"target_type": "post", "target_id": dismiss_post['id'], 
                                                     "category": "spam", "note": "spam"}, timeout=10)
                    if report_resp.status_code == 200:
                        dismiss_report_id = report_resp.json()['id']
                        
                        # Dismiss the report
                        headers_admin = {"Authorization": f"Bearer {admin_token}"}
                        action_resp = requests.post(f"{BASE_URL}/admin/reports/{dismiss_report_id}/action",
                                                   headers=headers_admin, 
                                                   json={"action": "dismiss", "reason": "not valid"}, timeout=10)
                        if action_resp.status_code == 200:
                            # Verify report is dismissed
                            reports_resp = requests.get(f"{BASE_URL}/admin/reports?status=dismissed", 
                                                       headers=headers_admin, timeout=10)
                            if reports_resp.status_code == 200:
                                dismissed_reports = reports_resp.json()
                                found_dismissed = any(r['id'] == dismiss_report_id for r in dismissed_reports)
                                log_test("Action 'dismiss' changes report status to dismissed", 
                                         found_dismissed,
                                         f"Report {dismiss_report_id} {'found' if found_dismissed else 'NOT found'} in dismissed list")
                            else:
                                log_test("Action 'dismiss' changes report status to dismissed", False, 
                                         f"Failed to get dismissed reports: {reports_resp.status_code}")
                        else:
                            log_test("Action 'dismiss' changes report status to dismissed", False, 
                                     f"Action failed: {action_resp.status_code}")
                
                # Test action: remove_content
                remove_post = create_post(victim_token, tier="public", text="Post for remove test", tags=["remove"])
                if remove_post:
                    headers_reg = {"Authorization": f"Bearer {regular_token}"}
                    report_resp = requests.post(f"{BASE_URL}/report", headers=headers_reg, 
                                               json={"target_type": "post", "target_id": remove_post['id'], 
                                                     "category": "inappropriate", "note": "inappropriate"}, timeout=10)
                    if report_resp.status_code == 200:
                        remove_report_id = report_resp.json()['id']
                        
                        # Remove content
                        headers_admin = {"Authorization": f"Bearer {admin_token}"}
                        action_resp = requests.post(f"{BASE_URL}/admin/reports/{remove_report_id}/action",
                                                   headers=headers_admin, 
                                                   json={"action": "remove_content", "reason": "violates policy"}, timeout=10)
                        if action_resp.status_code == 200:
                            # Verify post is quarantined (not in feed)
                            feed_resp = requests.get(f"{BASE_URL}/feed?scope=general", 
                                                    headers={"Authorization": f"Bearer {victim_token}"}, timeout=10)
                            if feed_resp.status_code == 200:
                                feed = feed_resp.json()
                                post_ids = [p['id'] for p in feed]
                                is_quarantined = remove_post['id'] not in post_ids
                                log_test("Action 'remove_content' quarantines the post", 
                                         is_quarantined,
                                         f"Post {remove_post['id']} {'NOT found' if is_quarantined else 'FOUND'} in feed")
                            else:
                                log_test("Action 'remove_content' quarantines the post", False, 
                                         f"Failed to get feed: {feed_resp.status_code}")
                        else:
                            log_test("Action 'remove_content' quarantines the post", False, 
                                     f"Action failed: {action_resp.status_code}")
                
                # Test action: warn_user
                warn_post = create_post(victim_token, tier="public", text="Post for warn test", tags=["warn"])
                if warn_post:
                    headers_reg = {"Authorization": f"Bearer {regular_token}"}
                    report_resp = requests.post(f"{BASE_URL}/report", headers=headers_reg, 
                                               json={"target_type": "post", "target_id": warn_post['id'], 
                                                     "category": "hate", "note": "hate speech"}, timeout=10)
                    if report_resp.status_code == 200:
                        warn_report_id = report_resp.json()['id']
                        
                        # Warn user
                        headers_admin = {"Authorization": f"Bearer {admin_token}"}
                        action_resp = requests.post(f"{BASE_URL}/admin/reports/{warn_report_id}/action",
                                                   headers=headers_admin, 
                                                   json={"action": "warn_user", "reason": "warning"}, timeout=10)
                        if action_resp.status_code == 200:
                            result = action_resp.json()
                            log_test("Action 'warn_user' returns stage 'soft_warning'", 
                                     result.get('stage') == 'soft_warning',
                                     f"stage={result.get('stage')}")
                        else:
                            log_test("Action 'warn_user' returns stage 'soft_warning'", False, 
                                     f"Action failed: {action_resp.status_code}")
                
                # Test action: strike_user
                strike_post = create_post(victim_token, tier="public", text="Post for strike test", tags=["strike"])
                if strike_post:
                    headers_reg = {"Authorization": f"Bearer {regular_token}"}
                    report_resp = requests.post(f"{BASE_URL}/report", headers=headers_reg, 
                                               json={"target_type": "post", "target_id": strike_post['id'], 
                                                     "category": "harassment", "note": "harassment"}, timeout=10)
                    if report_resp.status_code == 200:
                        strike_report_id = report_resp.json()['id']
                        
                        # Strike user
                        headers_admin = {"Authorization": f"Bearer {admin_token}"}
                        action_resp = requests.post(f"{BASE_URL}/admin/reports/{strike_report_id}/action",
                                                   headers=headers_admin, 
                                                   json={"action": "strike_user", "reason": "violation"}, timeout=10)
                        if action_resp.status_code == 200:
                            result = action_resp.json()
                            log_test("Action 'strike_user' returns stage 'strike_1_48h'", 
                                     result.get('stage') == 'strike_1_48h',
                                     f"stage={result.get('stage')}, strikes={result.get('strikes')}")
                            log_test("Action 'strike_user' increments strikes", 
                                     result.get('strikes') >= 1,
                                     f"strikes={result.get('strikes')}")
                        else:
                            log_test("Action 'strike_user' returns stage 'strike_1_48h'", False, 
                                     f"Action failed: {action_resp.status_code}")
            else:
                log_test("Find harassment report in open reports", False, "No harassment report found")
        else:
            log_test("Get admin reports", False, f"Status: {resp.status_code}")
    except Exception as e:
        log_test("Get admin reports", False, f"Exception: {e}")

    print()

    # ========== TEST 6: STRIKE ESCALATION ==========
    print("TEST 6: STRIKE ESCALATION")
    print("-" * 80)

    # Create a new user for strike testing
    strike_test_token, strike_test_user = create_user("StrikeTest")
    if strike_test_token and strike_test_user:
        print(f"✓ Created strike test user: {strike_test_user['handle']}")
        
        headers_admin = {"Authorization": f"Bearer {admin_token}"}
        
        # Strike 1
        try:
            resp = requests.post(f"{BASE_URL}/admin/users/{strike_test_user['handle']}/strike",
                               headers=headers_admin, json={"reason": "test strike 1"}, timeout=10)
            if resp.status_code == 200:
                result = resp.json()
                log_test("Strike 1 returns stage 'strike_1_48h'", 
                         result.get('stage') == 'strike_1_48h',
                         f"stage={result.get('stage')}, strikes={result.get('strikes')}")
            else:
                log_test("Strike 1 returns stage 'strike_1_48h'", False, 
                         f"Status: {resp.status_code}")
        except Exception as e:
            log_test("Strike 1 returns stage 'strike_1_48h'", False, f"Exception: {e}")
        
        # Strike 2
        try:
            resp = requests.post(f"{BASE_URL}/admin/users/{strike_test_user['handle']}/strike",
                               headers=headers_admin, json={"reason": "test strike 2"}, timeout=10)
            if resp.status_code == 200:
                result = resp.json()
                log_test("Strike 2 returns stage 'strike_2_7d'", 
                         result.get('stage') == 'strike_2_7d',
                         f"stage={result.get('stage')}, strikes={result.get('strikes')}")
            else:
                log_test("Strike 2 returns stage 'strike_2_7d'", False, 
                         f"Status: {resp.status_code}")
        except Exception as e:
            log_test("Strike 2 returns stage 'strike_2_7d'", False, f"Exception: {e}")
        
        # Strike 3
        try:
            resp = requests.post(f"{BASE_URL}/admin/users/{strike_test_user['handle']}/strike",
                               headers=headers_admin, json={"reason": "test strike 3"}, timeout=10)
            if resp.status_code == 200:
                result = resp.json()
                log_test("Strike 3 returns stage 'strike_3_permanent' (banned)", 
                         result.get('stage') == 'strike_3_permanent',
                         f"stage={result.get('stage')}, strikes={result.get('strikes')}")
            else:
                log_test("Strike 3 returns stage 'strike_3_permanent' (banned)", False, 
                         f"Status: {resp.status_code}")
        except Exception as e:
            log_test("Strike 3 returns stage 'strike_3_permanent' (banned)", False, f"Exception: {e}")
        
        # Unsuspend
        try:
            resp = requests.post(f"{BASE_URL}/admin/users/{strike_test_user['handle']}/unsuspend",
                               headers=headers_admin, json={}, timeout=10)
            if resp.status_code == 200:
                result = resp.json()
                log_test("Unsuspend returns ok=true", 
                         result.get('ok') == True,
                         f"ok={result.get('ok')}")
                
                # Verify strikes reset
                users_resp = requests.get(f"{BASE_URL}/admin/users?q={strike_test_user['handle']}", 
                                         headers=headers_admin, timeout=10)
                if users_resp.status_code == 200:
                    users = users_resp.json()
                    user = next((u for u in users if u['handle'] == strike_test_user['handle']), None)
                    if user:
                        log_test("Unsuspend resets strikes to 0", 
                                 user.get('strikes') == 0,
                                 f"strikes={user.get('strikes')}")
                        log_test("Unsuspend sets banned to false", 
                                 user.get('banned') == False,
                                 f"banned={user.get('banned')}")
                    else:
                        log_test("Unsuspend resets strikes to 0", False, "User not found in admin/users")
                else:
                    log_test("Unsuspend resets strikes to 0", False, 
                             f"Failed to get users: {users_resp.status_code}")
            else:
                log_test("Unsuspend returns ok=true", False, 
                         f"Status: {resp.status_code}")
        except Exception as e:
            log_test("Unsuspend returns ok=true", False, f"Exception: {e}")
    else:
        log_test("Create strike test user", False, "Failed to create user")

    print()

    # ========== TEST 7: AUDIT LOG ==========
    print("TEST 7: AUDIT LOG")
    print("-" * 80)

    try:
        headers = {"Authorization": f"Bearer {admin_token}"}
        resp = requests.get(f"{BASE_URL}/admin/audit", headers=headers, timeout=10)
        if resp.status_code == 200:
            audit_log = resp.json()
            log_test("Audit log returns non-empty list", 
                     len(audit_log) > 0,
                     f"Found {len(audit_log)} audit entries")
            
            if len(audit_log) > 0:
                # Check that entries have required fields
                first_entry = audit_log[0]
                has_admin_handle = 'admin_handle' in first_entry
                has_action = 'action' in first_entry
                has_target = 'target' in first_entry
                
                log_test("Audit entries have admin_handle field", has_admin_handle,
                         f"admin_handle={first_entry.get('admin_handle')}")
                log_test("Audit entries have action field", has_action,
                         f"action={first_entry.get('action')}")
                log_test("Audit entries have target field", has_target,
                         f"target={first_entry.get('target')}")
        else:
            log_test("Audit log endpoint", False, f"Status: {resp.status_code}")
    except Exception as e:
        log_test("Audit log endpoint", False, f"Exception: {e}")

    print()

    # ========== SUMMARY ==========
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"✅ PASSED: {tests_passed}")
    print(f"❌ FAILED: {tests_failed}")
    print(f"TOTAL: {tests_passed + tests_failed}")
    print()

    if tests_failed == 0:
        print("🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"⚠️  {tests_failed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
