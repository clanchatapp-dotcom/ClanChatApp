"""
Iteration 13 - DM screenshot policy (dm_screenshots_allowed AND-gate).

Covers:
  - default OFF in default_settings()
  - PATCH /users/me persistence + deep-merge of comfort_zone & siblings
  - GET /dms/with/{other} AND-gate: false unless both opted in
  - GET /dms/with/{self} -> always true (self thread)
  - cleanup: reset both alice & bob to false
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ALICE = ("alice@clanchat.app", "Password123!")
BOB = ("bob@clanchat.app", "Password123!")


def _login(session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, f"login {creds[0]} failed: {r.status_code} {r.text}"
    # fetch authoritative user record (login response may not include all fields)
    me = session.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200, me.text
    return me.json()


@pytest.fixture(scope="module")
def alice_sess():
    s = requests.Session()
    me = _login(s, ALICE)
    return s, me


@pytest.fixture(scope="module")
def bob_sess():
    s = requests.Session()
    me = _login(s, BOB)
    return s, me


@pytest.fixture(scope="module", autouse=True)
def reset_at_end(alice_sess, bob_sess):
    """Always restore both users to dm_screenshots_allowed=false at end."""
    yield
    for s, _ in (alice_sess, bob_sess):
        s.patch(f"{BASE_URL}/api/users/me",
                json={"settings": {"dm_screenshots_allowed": False}})


def _set_pref(sess, value):
    r = sess.patch(f"{BASE_URL}/api/users/me",
                   json={"settings": {"dm_screenshots_allowed": value}})
    assert r.status_code == 200, r.text
    return r.json()


def _get_me(sess):
    r = sess.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


def _get_dm(sess, other_id):
    r = sess.get(f"{BASE_URL}/api/dms/with/{other_id}")
    assert r.status_code == 200, r.text
    return r.json()


# --- DEFAULTS ---------------------------------------------------------------

class TestDefaults:
    def test_setting_key_present_in_me(self, alice_sess):
        sess, _ = alice_sess
        _set_pref(sess, False)  # ensure baseline
        me = _get_me(sess)
        assert "settings" in me
        assert "dm_screenshots_allowed" in me["settings"]
        assert me["settings"]["dm_screenshots_allowed"] is False


# --- PERSISTENCE & DEEP-MERGE ----------------------------------------------

class TestPersistence:
    def test_persist_and_deep_merge(self, alice_sess):
        sess, me0 = alice_sess
        # ensure off, capture some sibling settings
        _set_pref(sess, False)
        before = _get_me(sess)["settings"]

        # flip on
        _set_pref(sess, True)
        after = _get_me(sess)["settings"]
        assert after["dm_screenshots_allowed"] is True

        # sibling fields preserved
        for k in ("dms_enabled_followers", "wall_post_permission",
                  "taggable_by", "real_name_visibility", "comfort_zone"):
            assert k in after, f"setting {k} missing after patch"
            assert after[k] == before[k], f"setting {k} clobbered by patch"

        # restore
        _set_pref(sess, False)
        assert _get_me(sess)["settings"]["dm_screenshots_allowed"] is False


# --- AND-GATE ---------------------------------------------------------------

class TestAndGate:
    def test_full_gate_truth_table(self, alice_sess, bob_sess):
        a_sess, a_me = alice_sess
        b_sess, b_me = bob_sess
        alice_id = a_me["user_id"]
        bob_id = b_me["user_id"]

        # Baseline: both off
        _set_pref(a_sess, False)
        _set_pref(b_sess, False)

        # (1) both off -> false
        d = _get_dm(a_sess, bob_id)
        assert d["screenshots_allowed"] is False
        assert d["with"]["user_id"] == bob_id
        assert d["with"].get("is_self") in (False, None)

        # (2) alice on, bob off -> false
        _set_pref(a_sess, True)
        d = _get_dm(a_sess, bob_id)
        assert d["screenshots_allowed"] is False

        # (3) both on -> true
        _set_pref(b_sess, True)
        d = _get_dm(a_sess, bob_id)
        assert d["screenshots_allowed"] is True
        # also from bob's side
        d_b = _get_dm(b_sess, alice_id)
        assert d_b["screenshots_allowed"] is True

        # (4) bob off -> false
        _set_pref(b_sess, False)
        d = _get_dm(a_sess, bob_id)
        assert d["screenshots_allowed"] is False

        # cleanup baseline
        _set_pref(a_sess, False)
        _set_pref(b_sess, False)


# --- SELF DM ----------------------------------------------------------------

class TestSelfDm:
    def test_self_dm_always_allowed_regardless_of_setting(self, alice_sess):
        sess, me = alice_sess
        my_id = me["user_id"]
        # Off
        _set_pref(sess, False)
        d = _get_dm(sess, my_id)
        assert d["with"].get("is_self") is True
        assert d["screenshots_allowed"] is True
        # On
        _set_pref(sess, True)
        d = _get_dm(sess, my_id)
        assert d["screenshots_allowed"] is True
        # reset
        _set_pref(sess, False)


# --- REGRESSION: other settings still save ---------------------------------

class TestRegressionOtherSettings:
    def test_other_settings_still_save(self, alice_sess):
        sess, _ = alice_sess
        payload = {
            "settings": {
                "dms_enabled_followers": True,
                "taggable_by": "inner",
                "real_name_visibility": "inner",
                "comfort_zone": {"violence": True, "sensitive": True},
            }
        }
        r = sess.patch(f"{BASE_URL}/api/users/me", json=payload)
        assert r.status_code == 200, r.text
        s = _get_me(sess)["settings"]
        assert s["dms_enabled_followers"] is True
        assert s["taggable_by"] == "inner"
        assert s["real_name_visibility"] == "inner"
        assert s["comfort_zone"]["violence"] is True
        assert s["comfort_zone"]["sensitive"] is True
        # screenshot setting unaffected
        assert s["dm_screenshots_allowed"] is False

        # restore defaults-ish (don't clobber what user might have set)
        sess.patch(f"{BASE_URL}/api/users/me", json={
            "settings": {
                "dms_enabled_followers": False,
                "taggable_by": "followers",
                "real_name_visibility": "nobody",
                "comfort_zone": {"violence": False, "sensitive": False},
            }
        })
