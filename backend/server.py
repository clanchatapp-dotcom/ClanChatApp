from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import re
import secrets
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional

import bcrypt
import jwt
import requests
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, UploadFile, File, Form, Query, Header
from fastapi.responses import Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ------------------------------------------------------------------
# DB
# ------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ------------------------------------------------------------------
# Constants & helpers
# ------------------------------------------------------------------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
APP_NAME = os.environ.get("APP_NAME", "clanchat")
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_AUTH_SESSION_DATA_URL = (
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)

BANNED_WORDS = {
    # representative starter list — covers slurs/hate; expand on review
    "nigger", "nigga", "faggot", "fag", "tranny", "retard", "retarded",
    "kike", "spic", "chink", "gook", "wetback", "dyke",
}
TIERS = {"public", "followers", "inner"}

storage_key_cache: Optional[str] = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60 * 24),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True,
                        samesite="none", max_age=60 * 60 * 24, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True,
                        samesite="none", max_age=60 * 60 * 24 * 7, path="/")


# ----------------------------------------------------------------------


def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("session_token", path="/")


# ----------------------------------------------------------------------
# DM encryption — AES-256-GCM at rest.
#
# This is *server-side* encryption (a.k.a. "encryption at rest"), NOT end-to-
# end. ClanChat holds the key. The threat model this protects against:
#   • Stolen MongoDB dumps / leaked backups — ciphertext only
#   • Casual ops or contractor poking around the DB outside the watchlist
#     flow — they see opaque base64 strings, not message content
#   • A leaked read-replica or accidental fixture export
#
# It does NOT protect against:
#   • A compromised app server (the key sits in memory there)
#   • An admin abusing the watchlist (the audit log is the deterrent)
#
# The UI surfaces this as "Encrypted" — never "End-to-end encrypted". When
# we ship Signal-protocol E2E later we'll flip the label.
# ----------------------------------------------------------------------
import base64 as _base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM as _AESGCM
import secrets as _secrets

_DM_KEY_RAW = os.environ.get("DM_ENCRYPTION_KEY", "").strip()
if _DM_KEY_RAW:
    try:
        _DM_KEY = _base64.urlsafe_b64decode(_DM_KEY_RAW)
        if len(_DM_KEY) != 32:
            raise ValueError(f"DM_ENCRYPTION_KEY must decode to 32 bytes, got {len(_DM_KEY)}")
    except Exception as _e:
        raise RuntimeError(f"Invalid DM_ENCRYPTION_KEY in env: {_e}")
else:
    # Dev fallback so the server still boots locally; in production the env
    # var MUST be set or every restart re-keys and prior messages become
    # unreadable. We log a loud warning so this isn't silent.
    _DM_KEY = _AESGCM.generate_key(bit_length=256)
    logging.warning("DM_ENCRYPTION_KEY not set — using ephemeral key. DMs will not survive a server restart.")

_DM_CIPHER = _AESGCM(_DM_KEY)


def encrypt_dm(plaintext: str) -> str:
    """Encrypt a DM body. Returns base64(nonce || ciphertext+tag)."""
    if not plaintext:
        return ""
    nonce = _secrets.token_bytes(12)  # AES-GCM standard nonce length
    ct = _DM_CIPHER.encrypt(nonce, plaintext.encode("utf-8"), None)
    return _base64.urlsafe_b64encode(nonce + ct).decode("ascii")


def decrypt_dm(payload: str) -> str:
    """Reverse of encrypt_dm. Returns '' on bad/empty input — never raises
    into the request handler, because a single corrupt row should not nuke
    the whole thread fetch."""
    if not payload:
        return ""
    try:
        blob = _base64.urlsafe_b64decode(payload.encode("ascii"))
        nonce, ct = blob[:12], blob[12:]
        return _DM_CIPHER.decrypt(nonce, ct, None).decode("utf-8")
    except Exception as e:
        logging.warning("decrypt_dm failed: %s", e)
        return "[unreadable]"


def hydrate_dm(doc: dict) -> dict:
    """Read-path helper: if a stored DM row has `content_enc`, decrypt it
    into `content` for the response. Legacy rows (pre-encryption) keep their
    plaintext `content` untouched."""
    if not doc:
        return doc
    if doc.get("content_enc"):
        doc = {**doc, "content": decrypt_dm(doc["content_enc"])}
        doc.pop("content_enc", None)
    return doc


def calc_age(dob_str: str) -> int:
    try:
        d = date.fromisoformat(dob_str)
    except Exception:
        return 0
    today = date.today()
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


def is_minor(user: dict) -> bool:
    return user.get("is_minor", False) or calc_age(user.get("dob", "1900-01-01")) < 18


def sanitize_handle(h: str) -> str:
    h = (h or "").strip().lower().lstrip("#")
    if not re.fullmatch(r"[a-z0-9_]{3,20}", h):
        raise HTTPException(400, "Handle must be 3-20 chars, lowercase letters/numbers/underscore")
    return h


def sanitize_tags(raw: List[str]) -> List[str]:
    out = []
    seen = set()
    for t in raw or []:
        t = (t or "").strip().lower().lstrip("#")
        if not t:
            continue
        if not re.fullmatch(r"[a-z0-9]+", t):
            continue
        if t in BANNED_WORDS:
            continue
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 10:
            break
    return out


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def real_name_visible(target: dict, viewer: Optional[dict]) -> bool:
    visibility = target.get("settings", {}).get("real_name_visibility", "nobody")
    if not target.get("real_name") or visibility == "nobody":
        return False
    if visibility == "everyone":
        return True
    if not viewer:
        return False
    if viewer["user_id"] == target["user_id"]:
        return True
    if visibility == "followers":
        return bool(await db.follows.find_one({
            "follower_id": viewer["user_id"], "followee_id": target["user_id"], "status": "active"
        }))
    if visibility == "inner":
        return bool(await db.inner_circle.find_one({
            "owner_id": target["user_id"], "member_id": viewer["user_id"], "status": "active"
        }))
    return False


def public_user(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "handle": u["handle"],
        "display_name": u.get("display_name", u["handle"]),
        "bio": u.get("bio", ""),
        "avatar_path": u.get("avatar_path"),
        "links": u.get("links", []),
        "follow_mode": u.get("follow_mode", "open"),
        "is_minor": u.get("is_minor", False),
        "nsfw_account": u.get("nsfw_account", False),
        "role": u.get("role", "user"),
    }


def private_user(u: dict) -> dict:
    return {
        **public_user(u),
        "email": u.get("email"),
        "dob": u.get("dob"),
        "auth_provider": u.get("auth_provider", "password"),
        "settings": u.get("settings", default_settings()),
        "role": u.get("role", "user"),
        "nsfw_account": u.get("nsfw_account", False),
        "real_name": u.get("real_name", ""),
        "strikes": u.get("strikes", 0),
        "strike_history": u.get("strike_history", []),
        "suspended_until": u.get("suspended_until"),
    }


def default_settings() -> dict:
    return {
        "theme": "dark",
        "dms_enabled_followers": False,  # T2 DMs default off
        "wall_post_permission": "owner",  # owner | followers | inner
        "taggable_by": "followers",       # anyone | followers | inner | nobody
        "tag_approval_mode": False,       # if True, all tags require approval
        "real_name_visibility": "nobody", # nobody | inner | followers | everyone
        "dm_screenshots_allowed": False,  # both parties must opt-in; default OFF (privacy-first)
        "onboarded": False,
        "comfort_zone": {
            "nsfw": False,
            "ai_content": True,
            "strong_language": True,
            "violence": False,
            "self_harm": False,
            "gore": False,
            "sensitive": False,
            "anonymous_accounts": True,
        },
    }


# ------------------------------------------------------------------
# Storage helpers
# ------------------------------------------------------------------
def init_storage() -> Optional[str]:
    global storage_key_cache
    if storage_key_cache or not EMERGENT_KEY:
        return storage_key_cache
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        storage_key_cache = r.json()["storage_key"]
    except Exception as e:
        logging.error(f"storage init failed: {e}")
        storage_key_cache = None
    return storage_key_cache


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(500, "Storage unavailable")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    r.raise_for_status()
    return r.json()


def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(500, "Storage unavailable")
    r = requests.get(f"{STORAGE_URL}/objects/{path}",
                     headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ------------------------------------------------------------------
# Auth dependency
# ------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    # session cookie (google oauth) takes precedence
    session_token = request.cookies.get("session_token")
    if session_token:
        sess = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if sess:
            exp = sess.get("expires_at")
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp >= datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
                if user:
                    return user
    # JWT cookie or bearer
    token = request.cookies.get("access_token")
    if not token:
        ah = request.headers.get("Authorization", "")
        if ah.startswith("Bearer "):
            token = ah[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "User not found")
        if user.get("deleted"):
            raise HTTPException(403, "Account deleted")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


async def get_optional_user(request: Request) -> Optional[dict]:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


# ------------------------------------------------------------------
# Visibility check
# ------------------------------------------------------------------
async def can_view_post(post: dict, viewer: Optional[dict]) -> bool:
    # Quarantined content (CSAM flag) is invisible to everyone except admins.
    # Even the author cannot view a quarantined post — content is locked pending review.
    if post.get("quarantined"):
        if viewer and viewer.get("role") == "admin":
            return True
        return False
    if not viewer:
        return post["tier"] == "public" and not post.get("nsfw")
    if viewer["user_id"] == post["author_id"]:
        return True
    # check blocks
    if await db.blocks.find_one({"blocker_id": post["author_id"], "blocked_id": viewer["user_id"]}):
        return False
    if await db.blocks.find_one({"blocker_id": viewer["user_id"], "blocked_id": post["author_id"]}):
        return False
    tier = post["tier"]
    if tier == "public":
        return True
    if tier == "followers":
        return bool(await db.follows.find_one({
            "follower_id": viewer["user_id"], "followee_id": post["author_id"], "status": "active"
        }))
    if tier == "inner":
        return bool(await db.inner_circle.find_one({
            "owner_id": post["author_id"], "member_id": viewer["user_id"], "status": "active"
        }))
    return False


async def relation(viewer_id: str, target_id: str) -> dict:
    if viewer_id == target_id:
        return {"self": True, "follows": False, "inner": False}
    f = await db.follows.find_one({"follower_id": viewer_id, "followee_id": target_id, "status": "active"})
    ic = await db.inner_circle.find_one({"owner_id": target_id, "member_id": viewer_id, "status": "active"})
    pending = await db.follows.find_one({"follower_id": viewer_id, "followee_id": target_id, "status": "pending"})
    return {"self": False, "follows": bool(f), "inner": bool(ic), "follow_pending": bool(pending)}


# ------------------------------------------------------------------
# App & router
# ------------------------------------------------------------------
app = FastAPI()
api = APIRouter(prefix="/api")


# ----------------------------------------------------------------------
# Firebase Cloud Messaging — push notifications for Android.
#
# The service account JSON is stored base64-encoded in
# FCM_SERVICE_ACCOUNT_JSON_B64 so it never sits in plaintext on disk. If
# unset (e.g. local dev), push is a no-op and never raises — DMs/calls/
# etc. still work in-app, you just don't get notified when the app is
# backgrounded.
# ----------------------------------------------------------------------
_FCM_OK = False
_fb_messaging = None
try:
    _FCM_RAW = os.environ.get("FCM_SERVICE_ACCOUNT_JSON_B64", "").strip()
    if _FCM_RAW:
        import json as _json
        import firebase_admin as _firebase_admin
        from firebase_admin import credentials as _fb_creds, messaging as _fb_messaging
        _sa_dict = _json.loads(_base64.b64decode(_FCM_RAW).decode("utf-8"))
        if not _firebase_admin._apps:
            _firebase_admin.initialize_app(_fb_creds.Certificate(_sa_dict))
        _FCM_OK = True
        logging.info("Firebase Cloud Messaging initialised for project %s", _sa_dict.get("project_id"))
except Exception as _e:
    logging.warning("FCM init failed: %s — push notifications disabled.", _e)


async def fcm_push(user_id: str, title: str, body: str, *, data: dict | None = None,
                   notif_type: str = "generic") -> int:
    """Send a push to every registered device of a user. Honours per-type
    toggles. Dead tokens are pruned automatically."""
    if not _FCM_OK or _fb_messaging is None:
        return 0
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "push_prefs": 1})
    if u and u.get("push_prefs", {}).get(notif_type) is False:
        return 0
    cursor = db.device_tokens.find({"user_id": user_id}, {"_id": 0, "token": 1})
    tokens = [t["token"] async for t in cursor]
    if not tokens:
        return 0
    delivered, dead = 0, []
    for tok in tokens:
        try:
            msg = _fb_messaging.Message(
                token=tok,
                notification=_fb_messaging.Notification(title=title[:80], body=body[:240]),
                data={k: str(v) for k, v in (data or {}).items()},
                android=_fb_messaging.AndroidConfig(
                    priority="high",
                    notification=_fb_messaging.AndroidNotification(
                        channel_id=f"clanchat_{notif_type}",
                        sound="default",
                        default_vibrate_timings=True,
                    ),
                ),
            )
            _fb_messaging.send(msg)
            delivered += 1
        except _fb_messaging.UnregisteredError:
            dead.append(tok)
        except Exception as e:
            logging.warning("fcm send to %s failed: %s", tok[:12], e)
    if dead:
        await db.device_tokens.delete_many({"token": {"$in": dead}})
    return delivered


class DeviceTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    platform: str = Field(default="android", pattern="^(android|ios|web)$")


class PushPrefsIn(BaseModel):
    dms: bool | None = None
    calls: bool | None = None
    follows: bool | None = None
    inner_invites: bool | None = None


# Note: the @api endpoints for register-device / unregister-device /
# prefs are declared near the end of the file (after get_current_user
# is defined), so the route registration happens in dependency order.


# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    handle: str
    display_name: str = Field(min_length=1, max_length=40)
    dob: str  # YYYY-MM-DD


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionIn(BaseModel):
    session_id: str
    dob: Optional[str] = None
    handle: Optional[str] = None


class PostIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    tier: str
    tags: List[str] = []
    media_paths: List[str] = []
    is_ai: bool = False
    ai_label: Optional[str] = None  # None | "generated" | "assisted" | "altered"
    depicts_real_person: bool = False
    has_consent: bool = False
    nsfw: bool = False
    tagged_user_ids: List[str] = []  # tag-other-users
    is_audio_track: bool = False  # audio tab posts


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class WallPostIn(BaseModel):
    content: str = Field(max_length=2000)
    nsfw: bool = False


class BoardIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    tier: str
    allow_t1_read: bool = True


class BoardMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class DMIn(BaseModel):
    recipient_id: str
    content: str = Field(default="", max_length=2000)
    media_paths: list[str] = Field(default_factory=list, max_length=4)


class GroupCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    member_ids: List[str] = Field(default_factory=list, max_length=14)


class GroupMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class ProfileUpdateIn(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=150)
    avatar_path: Optional[str] = None
    links: Optional[List[dict]] = None  # [{label, url}]
    follow_mode: Optional[str] = None  # open | approval
    settings: Optional[dict] = None
    nsfw_account: Optional[bool] = None
    real_name: Optional[str] = Field(default=None, max_length=80)
    real_name_visibility: Optional[str] = None  # nobody|inner|followers|everyone


class InnerInviteIn(BaseModel):
    user_id: str
    permissions: dict = {}  # dms, audio_messages, audio_calls, video_calls


class FollowActionIn(BaseModel):
    user_id: str


class ReportIn(BaseModel):
    target_type: str  # user|post|board|message
    target_id: str
    category: str
    notes: str = ""


# ------------------------------------------------------------------
# Auth routes
# ------------------------------------------------------------------
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    handle = sanitize_handle(payload.handle)
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already in use")
    if await db.users.find_one({"handle": handle}):
        raise HTTPException(409, "Handle already taken")
    try:
        date.fromisoformat(payload.dob)
    except Exception:
        raise HTTPException(400, "Invalid DOB (YYYY-MM-DD)")
    age = calc_age(payload.dob)
    if age < 13:
        raise HTTPException(400, "Minimum age is 13")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": uid,
        "email": email,
        "password_hash": hash_password(payload.password),
        "handle": handle,
        "display_name": payload.display_name.strip(),
        "dob": payload.dob,
        "is_minor": age < 18,
        "bio": "",
        "avatar_path": None,
        "links": [],
        "follow_mode": "open",
        "settings": default_settings(),
        "role": "user",
        "auth_provider": "password",
        "strikes": 0,
        "suspended_until": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    access, refresh = create_access_token(uid), create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"user": private_user(user), "access_token": access}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    if user.get("deleted"):
        raise HTTPException(403, "This account has been permanently deleted.")
    if user.get("suspended_until"):
        try:
            until = datetime.fromisoformat(user["suspended_until"])
            if until > datetime.now(timezone.utc):
                raise HTTPException(403, f"Account suspended until {user['suspended_until']}")
        except (ValueError, TypeError):
            pass
    access, refresh = create_access_token(user["user_id"]), create_refresh_token(user["user_id"])
    set_auth_cookies(response, access, refresh)
    return {"user": private_user(user), "access_token": access}


@api.post("/auth/logout")
async def logout(response: Response, request: Request):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    clear_auth_cookies(response)
    return {"ok": True}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@api.post("/auth/change-password")
async def change_password(payload: ChangePasswordIn, user=Depends(get_current_user)):
    """Logged-in user updates their own password. Requires the current
    password — protects against session-hijack attacks where a stolen token
    is used to silently take over the account."""
    if user.get("auth_provider") != "password" or not user.get("password_hash"):
        # Google-only accounts don't have a password to change.
        raise HTTPException(400, "This account signs in with Google. Manage your password in your Google Account settings.")
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(401, "Current password is incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "New password must be different from the current one")
    new_hash = hash_password(payload.new_password)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": new_hash}})
    return {"ok": True}


class PasswordResetRequestIn(BaseModel):
    email: EmailStr
    handle: str = Field(min_length=1, max_length=30)
    reason: str = Field(default="", max_length=300)


@api.post("/auth/request-reset")
async def request_password_reset(payload: PasswordResetRequestIn):
    """Public endpoint: user who can't log in submits an admin-support
    ticket requesting a manual reset. We never confirm whether the email/
    handle actually exists — that would leak account enumeration. The
    admin sees the request in /admin → Reports → Password resets and uses
    the existing /admin/users/{id}/reset-password tool to issue a temp
    password, then contacts the user out-of-band.

    Rate-limited at one request per email per hour to stop spam."""
    email = payload.email.lower().strip()
    handle = payload.handle.lstrip("#").lower().strip()
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.password_reset_requests.count_documents({
        "email": email, "created_at": {"$gt": one_hour_ago},
    })
    if recent >= 1:
        # Always return ok so we don't leak rate-limit state to attackers.
        return {"ok": True}
    # Look the user up but don't tell the caller if we found them.
    target = await db.users.find_one({"$or": [{"email": email}, {"handle": handle}]}, {"_id": 0})
    await db.password_reset_requests.insert_one({
        "request_id": f"prr_{uuid.uuid4().hex[:10]}",
        "email": email, "handle": handle, "reason": payload.reason.strip()[:300],
        "target_user_id": target["user_id"] if target else None,
        "target_handle": target.get("handle") if target else None,
        "status": "open",
        "created_at": now_iso(),
        "resolved_by": None, "resolved_at": None,
    })
    return {"ok": True}


@api.get("/admin/password-resets")
async def admin_list_password_resets(admin=Depends(get_current_user), status: str = "open"):
    if admin.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    cursor = db.password_reset_requests.find({"status": status}, {"_id": 0}).sort("created_at", -1).limit(200)
    return {"requests": [r async for r in cursor]}


@api.post("/admin/password-resets/{request_id}/close")
async def admin_close_password_reset(request_id: str, admin=Depends(get_current_user)):
    if admin.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    await db.password_reset_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "closed", "resolved_by": admin["user_id"], "resolved_at": now_iso()}},
    )
    return {"ok": True}


# ----------------------------------------------------------------------
# Stickers / GIFs — Tenor v2 proxy
#
# The Tenor API key (TENOR_API_KEY) stays server-side. The client only
# ever calls our /stickers/* endpoints. If the key is unset the picker
# shows bundled emoji reactions only.
# ----------------------------------------------------------------------
_TENOR_API_KEY = os.environ.get("TENOR_API_KEY", "").strip()


@api.get("/stickers/config")
async def stickers_config(user=Depends(get_current_user)):
    return {"tenor_enabled": bool(_TENOR_API_KEY)}


@api.get("/stickers/tenor-search")
async def stickers_tenor_search(q: str, user=Depends(get_current_user)):
    if not _TENOR_API_KEY:
        raise HTTPException(503, "Tenor not configured")
    q = (q or "").strip()[:60]
    if not q:
        return {"results": []}
    import httpx
    params = {
        "q": q, "key": _TENOR_API_KEY, "client_key": "clanchat",
        "limit": 24, "media_filter": "gif,tinygif", "contentfilter": "high",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get("https://tenor.googleapis.com/v2/search", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logging.warning("tenor search failed: %s", e)
        raise HTTPException(502, "Tenor search failed")
    results = []
    for item in data.get("results", []):
        media = item.get("media_formats", {})
        gif = media.get("gif") or media.get("tinygif") or {}
        preview = (media.get("tinygif") or media.get("gif") or {}).get("url")
        if gif.get("url"):
            results.append({"id": item.get("id"), "url": gif["url"], "preview": preview or gif["url"]})
    return {"results": results}



@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return private_user(user)


@api.post("/auth/google-session")
async def google_session(payload: GoogleSessionIn, response: Response):
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    r = requests.get(EMERGENT_AUTH_SESSION_DATA_URL,
                     headers={"X-Session-ID": payload.session_id}, timeout=30)
    if r.status_code != 200:
        raise HTTPException(401, "Invalid session id")
    data = r.json()
    email = data["email"].lower()
    session_token = data["session_token"]
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")

    existing = await db.users.find_one({"email": email})
    if existing:
        uid = existing["user_id"]
        # update picture/name if blank
        update = {}
        if not existing.get("display_name"):
            update["display_name"] = name
        if update:
            await db.users.update_one({"user_id": uid}, {"$set": update})
        user = await db.users.find_one({"user_id": uid}, {"_id": 0})
        new_user = False
    else:
        if not payload.dob:
            # Tell frontend we need DOB + handle to finish signup
            return {"needs_profile": True, "google_email": email, "google_name": name}
        try:
            date.fromisoformat(payload.dob)
        except Exception:
            raise HTTPException(400, "Invalid DOB")
        age = calc_age(payload.dob)
        if age < 13:
            raise HTTPException(400, "Minimum age is 13")
        # auto-generate handle if missing or taken
        base = (payload.handle or re.sub(r"[^a-z0-9_]", "", name.lower()) or "user")[:18]
        candidate = base
        suffix = 0
        while await db.users.find_one({"handle": candidate}):
            suffix += 1
            candidate = f"{base}{suffix}"[:20]
        uid = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": uid, "email": email, "password_hash": None,
            "handle": candidate, "display_name": name, "dob": payload.dob,
            "is_minor": age < 18, "bio": "", "avatar_path": picture,
            "links": [], "follow_mode": "open", "settings": default_settings(),
            "role": "user", "auth_provider": "google", "strikes": 0,
            "suspended_until": None, "created_at": now_iso(),
        }
        await db.users.insert_one(user)
        new_user = True

    await db.user_sessions.insert_one({
        "user_id": user["user_id"], "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": now_iso(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", max_age=60 * 60 * 24 * 7, path="/")
    # Also mint a bearer JWT so the Capacitor APK (which serves the bundled
    # build from https://localhost and can't share cookies with clanchat.app)
    # has a persistent auth token. Without this, Google sign-in users get
    # logged out the moment the app reloads.
    access_token = create_access_token(user["user_id"])
    refresh_token = create_refresh_token(user["user_id"])
    response.set_cookie("access_token", access_token, httponly=True, secure=True,
                        samesite="none", max_age=60 * 60 * 24, path="/")
    response.set_cookie("refresh_token", refresh_token, httponly=True, secure=True,
                        samesite="none", max_age=60 * 60 * 24 * 7, path="/")
    return {"user": private_user(user), "new_user": new_user, "access_token": access_token}


# ------------------------------------------------------------------
# Users / profile
# ------------------------------------------------------------------
@api.patch("/users/me")
async def update_me(payload: ProfileUpdateIn, user=Depends(get_current_user)):
    update = {}
    if payload.display_name is not None:
        update["display_name"] = payload.display_name.strip()[:40]
    if payload.bio is not None:
        update["bio"] = payload.bio[:150]
    if payload.avatar_path is not None:
        update["avatar_path"] = payload.avatar_path
    if payload.links is not None:
        update["links"] = [{"label": (link.get("label") or "")[:30], "url": (link.get("url") or "")[:200]}
                           for link in payload.links[:10]]
    if payload.follow_mode in ("open", "approval"):
        update["follow_mode"] = payload.follow_mode
    if payload.nsfw_account is not None and not user.get("is_minor"):
        update["nsfw_account"] = bool(payload.nsfw_account)
    if payload.real_name is not None:
        update["real_name"] = payload.real_name.strip()[:80]
    if payload.real_name_visibility in ("nobody", "inner", "followers", "everyone"):
        # store inside settings too for convenience
        if "settings" not in update:
            update["settings"] = {**user.get("settings", default_settings()),
                                  "real_name_visibility": payload.real_name_visibility}
        else:
            update["settings"]["real_name_visibility"] = payload.real_name_visibility
    if payload.settings is not None:
        current_settings = user.get("settings", default_settings())
        merged = {**current_settings, **payload.settings}
        # comfort_zone merge
        if "comfort_zone" in payload.settings:
            merged["comfort_zone"] = {**current_settings.get("comfort_zone", {}),
                                      **payload.settings["comfort_zone"]}
            if user.get("is_minor"):
                merged["comfort_zone"]["nsfw"] = False  # hardcoded
        update["settings"] = merged
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return private_user(fresh)


@api.get("/users/by-handle/{handle}")
async def get_user_by_handle(handle: str, viewer=Depends(get_optional_user)):
    h = handle.strip().lower().lstrip("#")
    target = await db.users.find_one({"handle": h}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Not found")
    if viewer and target["user_id"] != viewer["user_id"]:
        # Admins can see EVERY account, including minors — they need this to
        # action reports targeting minors. The hardcoded protections still
        # apply to all non-admins.
        is_admin = viewer.get("role") == "admin"
        # Adults can NEVER find minors. No exceptions (admins exempt).
        if target.get("is_minor") and not is_minor(viewer) and not is_admin:
            raise HTTPException(404, "Not found")
        # Minors can NEVER find NSFW-flagged accounts. No exceptions.
        if is_minor(viewer) and target.get("nsfw_account"):
            raise HTTPException(404, "Not found")
    rel = await relation(viewer["user_id"], target["user_id"]) if viewer else {"self": False, "follows": False, "inner": False, "follow_pending": False}
    out_user = public_user(target)
    if await real_name_visible(target, viewer):
        out_user["real_name"] = target.get("real_name", "")
    return {"user": out_user, "relation": rel}


@api.get("/users/search")
async def search_users(q: str = Query(..., min_length=1), viewer=Depends(get_current_user)):
    q = q.strip().lower().lstrip("#")
    if not re.fullmatch(r"[a-z0-9_]{1,20}", q):
        return {"results": []}
    cursor = db.users.find({"handle": {"$regex": f"^{re.escape(q)}"}}, {"_id": 0}).limit(20)
    is_admin = viewer.get("role") == "admin"
    results = []
    async for u in cursor:
        if u["user_id"] == viewer["user_id"]:
            results.append(public_user(u))
            continue
        # Adults can NEVER find minors. No exceptions (admins exempt — they need
        # to be able to search for minor accounts to action reports about them).
        if u.get("is_minor") and not is_minor(viewer) and not is_admin:
            continue
        # Minors can NEVER find NSFW-flagged accounts. No exceptions.
        if is_minor(viewer) and u.get("nsfw_account"):
            continue
        if await db.blocks.find_one({"blocker_id": u["user_id"], "blocked_id": viewer["user_id"]}):
            continue
        results.append(public_user(u))
    return {"results": results}


# ------------------------------------------------------------------
# Follow system
# ------------------------------------------------------------------
def adult_minor_block(actor: dict, target: dict, actor_initiated: bool) -> Optional[str]:
    """Adults cannot follow/DM/invite minors unless minor initiated."""
    if actor_initiated and not is_minor(actor) and is_minor(target):
        return "Adults cannot initiate follow/DM/invite with minors"
    return None


@api.post("/follow/{target_id}")
async def follow_user(target_id: str, user=Depends(get_current_user)):
    if target_id == user["user_id"]:
        raise HTTPException(400, "Cannot follow yourself")
    target = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Not found")
    # Minors can NEVER follow NSFW-flagged accounts. No exceptions.
    if is_minor(user) and target.get("nsfw_account"):
        raise HTTPException(404, "Not found")
    err = adult_minor_block(user, target, actor_initiated=True)
    if err:
        raise HTTPException(403, err)
    if await db.blocks.find_one({"blocker_id": target_id, "blocked_id": user["user_id"]}):
        raise HTTPException(403, "Blocked")
    existing = await db.follows.find_one({"follower_id": user["user_id"], "followee_id": target_id})
    if existing:
        return {"status": existing["status"]}
    status = "active" if target.get("follow_mode", "open") == "open" else "pending"
    await db.follows.insert_one({
        "follow_id": f"fol_{uuid.uuid4().hex[:10]}",
        "follower_id": user["user_id"], "followee_id": target_id,
        "status": status, "created_at": now_iso(),
    })
    try:
        if status == "pending":
            await fcm_push(target_id, "New follow request",
                           f"#{user.get('handle', 'someone')} wants to follow you",
                           data={"type": "follow_request", "from_id": user["user_id"]},
                           notif_type="follows")
        else:
            await fcm_push(target_id, "New follower",
                           f"#{user.get('handle', 'someone')} is now following you",
                           data={"type": "new_follower", "from_id": user["user_id"]},
                           notif_type="follows")
    except Exception as _e:
        logging.warning("follow push failed: %s", _e)
    return {"status": status}


@api.delete("/follow/{target_id}")
async def unfollow(target_id: str, user=Depends(get_current_user)):
    await db.follows.delete_one({"follower_id": user["user_id"], "followee_id": target_id})
    # Bug 5 fix: removing the follow relationship must also evict the user
    # from the target's Inner Circle if they were a member. Inner Circle
    # presupposes the follow relationship — keeping IC membership without
    # the follow creates a stale orphan state that bypasses tier gating on
    # IC-only DMs and posts.
    await db.inner_circle.delete_one({"owner_id": target_id, "member_id": user["user_id"]})
    return {"ok": True}


@api.get("/follow/requests")
async def follow_requests(user=Depends(get_current_user)):
    cursor = db.follows.find({"followee_id": user["user_id"], "status": "pending"}, {"_id": 0})
    reqs = []
    async for f in cursor:
        u = await db.users.find_one({"user_id": f["follower_id"]}, {"_id": 0})
        if u:
            reqs.append({"follow_id": f["follow_id"], "user": public_user(u), "created_at": f["created_at"]})
    return {"requests": reqs}


@api.post("/follow/requests/{follow_id}/approve")
async def approve_follow(follow_id: str, user=Depends(get_current_user)):
    f = await db.follows.find_one({"follow_id": follow_id, "followee_id": user["user_id"]})
    if not f:
        raise HTTPException(404, "Not found")
    await db.follows.update_one({"follow_id": follow_id}, {"$set": {"status": "active"}})
    return {"ok": True}


@api.post("/follow/requests/{follow_id}/decline")
async def decline_follow(follow_id: str, user=Depends(get_current_user)):
    await db.follows.delete_one({"follow_id": follow_id, "followee_id": user["user_id"]})
    return {"ok": True}


@api.post("/follow/remove/{user_id}")
async def remove_follower(user_id: str, user=Depends(get_current_user)):
    await db.follows.delete_one({"follower_id": user_id, "followee_id": user["user_id"]})
    return {"ok": True}


# ------------------------------------------------------------------
# Inner Circle
# ------------------------------------------------------------------
@api.post("/inner/invite")
async def invite_inner(payload: InnerInviteIn, user=Depends(get_current_user)):
    if payload.user_id == user["user_id"]:
        raise HTTPException(400, "Cannot invite yourself")
    target = await db.users.find_one({"user_id": payload.user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Not found")
    # Minors can NEVER receive invites from NSFW-flagged accounts. No exceptions.
    if is_minor(target) and user.get("nsfw_account"):
        raise HTTPException(404, "Not found")
    err = adult_minor_block(user, target, actor_initiated=True)
    if err:
        raise HTTPException(403, err)
    perms = {
        "dms": bool(payload.permissions.get("dms", True)),
        "audio_messages": bool(payload.permissions.get("audio_messages", False)),
        "audio_calls": bool(payload.permissions.get("audio_calls", False)),
        "video_calls": bool(payload.permissions.get("video_calls", False)),
    }
    existing = await db.inner_circle.find_one({"owner_id": user["user_id"], "member_id": payload.user_id})
    if existing:
        await db.inner_circle.update_one(
            {"_id": existing["_id"]},
            {"$set": {"permissions": perms}}
        )
        return {"status": existing["status"]}
    await db.inner_circle.insert_one({
        "invite_id": f"inv_{uuid.uuid4().hex[:10]}",
        "owner_id": user["user_id"], "member_id": payload.user_id,
        "permissions": perms, "status": "pending", "created_at": now_iso(),
    })
    try:
        await fcm_push(
            payload.user_id, "Inner Circle invite",
            f"#{user.get('handle', 'someone')} invited you to their Inner Circle",
            data={"type": "inner_invite", "from_id": user["user_id"]},
            notif_type="inner_invites",
        )
    except Exception as _e:
        logging.warning("inner invite push failed: %s", _e)
    return {"status": "pending"}


@api.get("/inner/invites")
async def list_inner_invites(user=Depends(get_current_user)):
    cursor = db.inner_circle.find({"member_id": user["user_id"], "status": "pending"}, {"_id": 0})
    out = []
    async for inv in cursor:
        owner = await db.users.find_one({"user_id": inv["owner_id"]}, {"_id": 0})
        if owner:
            out.append({"invite_id": inv["invite_id"], "owner": public_user(owner),
                        "permissions": inv["permissions"], "created_at": inv["created_at"]})
    return {"invites": out}


@api.post("/inner/invites/{invite_id}/accept")
async def accept_inner_invite(invite_id: str, user=Depends(get_current_user)):
    inv = await db.inner_circle.find_one({"invite_id": invite_id, "member_id": user["user_id"]})
    if not inv:
        raise HTTPException(404, "Not found")
    await db.inner_circle.update_one({"invite_id": invite_id}, {"$set": {"status": "active"}})
    return {"ok": True}


@api.post("/inner/invites/{invite_id}/decline")
async def decline_inner_invite(invite_id: str, user=Depends(get_current_user)):
    await db.inner_circle.delete_one({"invite_id": invite_id, "member_id": user["user_id"]})
    return {"ok": True}


@api.get("/inner/members")
async def inner_members(user=Depends(get_current_user)):
    cursor = db.inner_circle.find({"owner_id": user["user_id"], "status": "active"}, {"_id": 0})
    out = []
    async for m in cursor:
        u = await db.users.find_one({"user_id": m["member_id"]}, {"_id": 0})
        if u:
            out.append({"member": public_user(u), "permissions": m["permissions"]})
    return {"members": out}


# ------------------------------------------------------------------
# Posts & Feed
# ------------------------------------------------------------------
async def serialize_post(post: dict, viewer: Optional[dict]) -> dict:
    author = await db.users.find_one({"user_id": post["author_id"]}, {"_id": 0})
    liked = False
    if viewer:
        liked = bool(await db.likes.find_one({"post_id": post["post_id"], "user_id": viewer["user_id"]}))
    comment_count = await db.comments.count_documents({"post_id": post["post_id"]})
    can_comment = False
    if viewer:
        can_comment = await user_can_comment(post, viewer)
    tagged = await get_approved_tags(post["post_id"])
    return {
        "post_id": post["post_id"],
        "author": public_user(author) if author else None,
        "content": post["content"],
        "tier": post["tier"],
        "tags": post.get("tags", []),
        "media": post.get("media_paths", []),
        "is_ai": post.get("is_ai", False),
        "ai_label": post.get("ai_label"),
        "depicts_real_person": post.get("depicts_real_person", False),
        "nsfw": post.get("nsfw", False),
        "is_audio_track": post.get("is_audio_track", False),
        "like_count": post.get("like_count", 0),
        "liked": liked,
        "comment_count": comment_count,
        "can_comment": can_comment,
        "tagged_users": tagged,
        "created_at": post["created_at"],
        "pinned": post.get("pinned", False),
    }


async def is_restricted(restrictor_id: str, restricted_id: str) -> bool:
    return bool(await db.restrictions.find_one({
        "restrictor_id": restrictor_id, "restricted_id": restricted_id,
    }))


async def user_can_comment(post: dict, viewer: dict) -> bool:
    """Inner Circle (Tier 3) of post author only. Author can always comment."""
    if post["author_id"] == viewer["user_id"]:
        return True
    if viewer.get("is_minor") and post.get("nsfw"):
        return False
    if await is_restricted(post["author_id"], viewer["user_id"]):
        return False
    return bool(await db.inner_circle.find_one({
        "owner_id": post["author_id"],
        "member_id": viewer["user_id"],
        "status": "active",
    }))


async def apply_strike(user_id: str, reason: str, level: int, ban_hours: Optional[int] = None):
    """Apply a strike. level=1 → 48h suspend. level=2 → 7d. level=3 → permanent delete."""
    history_entry = {
        "level": level,
        "reason": reason[:500],
        "applied_at": now_iso(),
    }
    if level >= 3:
        history_entry["permanent"] = True
        await db.users.update_one({"user_id": user_id}, {
            "$set": {
                "deleted": True,
                "deleted_at": now_iso(),
                "deleted_reason": reason[:500],
            },
            "$inc": {"strikes": 1},
            "$push": {"strike_history": history_entry},
        })
        return
    hours = ban_hours if ban_hours is not None else (48 if level == 1 else 24 * 7)
    until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    history_entry["suspended_until"] = until
    await db.users.update_one({"user_id": user_id}, {
        "$set": {"suspended_until": until},
        "$inc": {"strikes": 1},
        "$push": {"strike_history": history_entry},
    })


@api.post("/posts")
async def create_post(payload: PostIn, user=Depends(get_current_user)):
    if payload.tier not in TIERS:
        raise HTTPException(400, "Invalid tier")
    if payload.tier == "public" and payload.nsfw:
        raise HTTPException(400, "Tier 1 (Public) posts cannot contain 18+ content")
    # AI policy enforcement
    ai_label = payload.ai_label
    if ai_label and ai_label not in {"generated", "assisted", "altered"}:
        raise HTTPException(400, "Invalid AI label")
    is_ai = bool(ai_label) or payload.is_ai
    if ai_label:
        # AI of real person → hard rules
        if payload.depicts_real_person:
            if payload.nsfw:
                # NUCLEAR: AI sexual content of a real person → permanent deletion
                reason = "AI sexual content depicting a real person"
                await apply_strike(user["user_id"], reason, level=3)
                raise HTTPException(403, "AI sexual content depicting real people is permanently banned. Your account has been deleted.")
            if not payload.has_consent:
                # AI of real person without consent → Strike 1 + 48h ban
                reason = "AI generated content depicting a real person without consent"
                await apply_strike(user["user_id"], reason, level=1, ban_hours=48)
                raise HTTPException(403, "This content cannot be uploaded. AI content depicting real people requires their explicit consent. A 48-hour suspension has been applied.")
    if payload.tier == "inner":
        tags = []  # no tags on inner posts
    else:
        tags = sanitize_tags(payload.tags)
    if not payload.content.strip() and not payload.media_paths:
        raise HTTPException(400, "Post cannot be empty")
    pid = f"post_{uuid.uuid4().hex[:12]}"
    post = {
        "post_id": pid,
        "author_id": user["user_id"],
        "content": payload.content.strip()[:4000],
        "tier": payload.tier,
        "tags": tags,
        "media_paths": payload.media_paths[:10],
        "is_ai": is_ai,
        "ai_label": ai_label,
        "depicts_real_person": bool(payload.depicts_real_person and ai_label),
        "nsfw": payload.nsfw and payload.tier != "public",
        "is_audio_track": bool(payload.is_audio_track),
        "like_count": 0,
        "pinned": False,
        "created_at": now_iso(),
    }
    await db.posts.insert_one(post)
    # Tag-other-users — create tag records subject to recipient settings
    if payload.tagged_user_ids:
        await create_user_tags(post, user, payload.tagged_user_ids)
    return await serialize_post(post, user)


async def create_user_tags(post: dict, tagger: dict, tagged_ids: List[str]):
    """Create user-tag rows. Hardcoded: 18+ tags + photo/video tags always need approval."""
    has_media = bool(post.get("media_paths"))
    is_18 = bool(post.get("nsfw"))
    for tid in tagged_ids[:20]:
        if tid == tagger["user_id"]:
            continue
        target = await db.users.find_one({"user_id": tid}, {"_id": 0})
        if not target:
            continue
        # block-aware
        if await db.blocks.find_one({"$or": [
            {"blocker_id": tid, "blocked_id": tagger["user_id"]},
            {"blocker_id": tagger["user_id"], "blocked_id": tid},
        ]}):
            continue
        # adult/minor protection — adults cannot tag minors (acts like contact)
        err = adult_minor_block(tagger, target, actor_initiated=True)
        if err:
            continue
        # taggable_by rule
        taggable = target.get("settings", {}).get("taggable_by", "followers")
        if taggable == "nobody":
            continue
        if taggable == "followers":
            ok = bool(await db.follows.find_one({
                "follower_id": tagger["user_id"], "followee_id": tid, "status": "active"
            })) or tid == tagger["user_id"]
            if not ok:
                continue
        if taggable == "inner":
            ok = bool(await db.inner_circle.find_one({
                "owner_id": tid, "member_id": tagger["user_id"], "status": "active"
            }))
            if not ok:
                continue
        # decide status
        approval_required = bool(target.get("settings", {}).get("tag_approval_mode", False))
        if has_media or is_18:
            approval_required = True  # hardcoded
        status = "pending" if approval_required else "approved"
        await db.user_tags.insert_one({
            "tag_id": f"utag_{uuid.uuid4().hex[:10]}",
            "post_id": post["post_id"],
            "tagged_user_id": tid,
            "tagger_id": tagger["user_id"],
            "status": status,
            "is_nsfw_post": is_18,
            "has_media": has_media,
            "created_at": now_iso(),
        })


async def get_approved_tags(post_id: str) -> List[dict]:
    tags = []
    async for t in db.user_tags.find({"post_id": post_id, "status": "approved"}, {"_id": 0}):
        u = await db.users.find_one({"user_id": t["tagged_user_id"]}, {"_id": 0})
        if u:
            tags.append({"tag_id": t["tag_id"], "user": public_user(u)})
    return tags


@api.get("/tags/pending")
async def my_pending_tags(user=Depends(get_current_user)):
    cursor = db.user_tags.find({"tagged_user_id": user["user_id"], "status": "pending"}, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for t in cursor:
        post = await db.posts.find_one({"post_id": t["post_id"]}, {"_id": 0})
        tagger = await db.users.find_one({"user_id": t["tagger_id"]}, {"_id": 0})
        if not post or not tagger:
            continue
        out.append({
            "tag_id": t["tag_id"],
            "post_id": t["post_id"],
            "post_excerpt": (post.get("content") or "")[:120],
            "post_media": post.get("media_paths", [])[:1],
            "is_nsfw": t.get("is_nsfw_post", False),
            "has_media": t.get("has_media", False),
            "tagger": public_user(tagger),
            "created_at": t["created_at"],
        })
    return {"pending": out}


@api.post("/tags/{tag_id}/approve")
async def approve_tag(tag_id: str, user=Depends(get_current_user)):
    t = await db.user_tags.find_one({"tag_id": tag_id, "tagged_user_id": user["user_id"]})
    if not t:
        raise HTTPException(404, "Not found")
    await db.user_tags.update_one({"tag_id": tag_id}, {"$set": {"status": "approved", "approved_at": now_iso()}})
    return {"ok": True}


@api.post("/tags/{tag_id}/reject")
async def reject_tag(tag_id: str, user=Depends(get_current_user)):
    res = await db.user_tags.delete_one({"tag_id": tag_id, "tagged_user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/tags/{tag_id}")
async def remove_tag(tag_id: str, user=Depends(get_current_user)):
    t = await db.user_tags.find_one({"tag_id": tag_id})
    if not t or t["tagged_user_id"] != user["user_id"]:
        raise HTTPException(404, "Not found")
    await db.user_tags.delete_one({"tag_id": tag_id})
    return {"ok": True}


@api.get("/tags/me")
async def posts_tagged_in(user=Depends(get_current_user)):
    cursor = db.user_tags.find({"tagged_user_id": user["user_id"], "status": "approved"}, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for t in cursor:
        post = await db.posts.find_one({"post_id": t["post_id"]}, {"_id": 0})
        if post and await can_view_post(post, user):
            out.append(await serialize_post(post, user))
    return {"posts": out}


@api.get("/posts/feed")
async def get_feed(user=Depends(get_current_user), limit: int = 50, before: Optional[str] = None):
    # following ids
    following = []
    async for f in db.follows.find({"follower_id": user["user_id"], "status": "active"}, {"_id": 0}):
        following.append(f["followee_id"])
    inner_owners = []
    async for ic in db.inner_circle.find({"member_id": user["user_id"], "status": "active"}, {"_id": 0}):
        inner_owners.append(ic["owner_id"])
    # blocks
    blocked_ids = set()
    async for b in db.blocks.find({"blocker_id": user["user_id"]}, {"_id": 0}):
        blocked_ids.add(b["blocked_id"])
    async for b in db.blocks.find({"blocked_id": user["user_id"]}, {"_id": 0}):
        blocked_ids.add(b["blocker_id"])

    or_clauses = [
        {"tier": "public"},
        {"author_id": user["user_id"]},
    ]
    if following:
        or_clauses.append({"tier": "followers", "author_id": {"$in": following}})
    if inner_owners:
        or_clauses.append({"tier": "inner", "author_id": {"$in": inner_owners}})

    query = {"$or": or_clauses}
    if blocked_ids:
        query["author_id"] = {"$nin": list(blocked_ids)}
    if before:
        query["created_at"] = {"$lt": before}

    # Bug 1 fix: Minors are completely invisible on the global/public feed
    # to non-minor, non-admin viewers. Hardcoded — no override. Their posts
    # only surface to other minors or to admins acting on reports.
    if not is_minor(user) and user.get("role") != "admin":
        minor_ids = [u["user_id"] async for u in db.users.find({"is_minor": True}, {"_id": 0, "user_id": 1})]
        if minor_ids:
            existing_nin = query.get("author_id", {}).get("$nin", []) if isinstance(query.get("author_id"), dict) else []
            query["author_id"] = {"$nin": list(set(existing_nin + minor_ids))}

    # Quarantined content is invisible to everyone (admin still sees via /admin/csam/queue).
    # This is the same rule enforced in can_view_post — applied at the Mongo layer here
    # because /posts/feed does not iterate through that helper for performance.
    if user.get("role") != "admin":
        query["quarantined"] = {"$ne": True}

    # comfort zone filtering
    cz = user.get("settings", {}).get("comfort_zone", {})
    if not cz.get("nsfw", False) or is_minor(user):
        query["nsfw"] = {"$ne": True}
    if not cz.get("ai_content", True):
        query["is_ai"] = {"$ne": True}

    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    posts = []
    async for p in cursor:
        posts.append(await serialize_post(p, user))
    return {"posts": posts}


@api.get("/posts/by-user/{user_id}")
async def posts_by_user(user_id: str, viewer=Depends(get_current_user)):
    if await db.blocks.find_one({"blocker_id": user_id, "blocked_id": viewer["user_id"]}):
        return {"posts": []}
    # Minors never see NSFW posts on any profile. Hardcoded.
    query = {"author_id": user_id}
    if is_minor(viewer):
        query["nsfw"] = {"$ne": True}
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for p in cursor:
        if await can_view_post(p, viewer):
            out.append(await serialize_post(p, viewer))
    return {"posts": out}


@api.get("/posts/pinned/{user_id}")
async def pinned(user_id: str, viewer=Depends(get_optional_user)):
    cursor = db.posts.find({"author_id": user_id, "pinned": True}, {"_id": 0}).sort("created_at", -1).limit(3)
    out = []
    async for p in cursor:
        if await can_view_post(p, viewer):
            out.append(await serialize_post(p, viewer))
    return {"posts": out}


@api.post("/posts/{post_id}/pin")
async def pin_post(post_id: str, user=Depends(get_current_user)):
    post = await db.posts.find_one({"post_id": post_id, "author_id": user["user_id"]})
    if not post:
        raise HTTPException(404, "Not found")
    count = await db.posts.count_documents({"author_id": user["user_id"], "pinned": True})
    if not post.get("pinned") and count >= 3:
        raise HTTPException(400, "Maximum 3 pinned posts")
    await db.posts.update_one({"post_id": post_id}, {"$set": {"pinned": not post.get("pinned", False)}})
    return {"pinned": not post.get("pinned", False)}


@api.post("/posts/{post_id}/like")
async def toggle_like(post_id: str, user=Depends(get_current_user)):
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Not found")
    if not await can_view_post(post, user):
        raise HTTPException(403, "Cannot view this post")
    existing = await db.likes.find_one({"post_id": post_id, "user_id": user["user_id"]})
    if existing:
        await db.likes.delete_one({"_id": existing["_id"]})
        await db.posts.update_one({"post_id": post_id}, {"$inc": {"like_count": -1}})
        return {"liked": False}
    await db.likes.insert_one({"post_id": post_id, "user_id": user["user_id"], "created_at": now_iso()})
    await db.posts.update_one({"post_id": post_id}, {"$inc": {"like_count": 1}})
    return {"liked": True}


@api.delete("/posts/{post_id}")
async def delete_post(post_id: str, user=Depends(get_current_user)):
    res = await db.posts.delete_one({"post_id": post_id, "author_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.get("/posts/by-tag/{tag}")
async def posts_by_tag(tag: str, viewer=Depends(get_current_user)):
    t = tag.lower().strip().lstrip("#")
    cursor = db.posts.find({"tags": t, "tier": "public"}, {"_id": 0}).sort("created_at", -1).limit(50)
    out = []
    async for p in cursor:
        if await can_view_post(p, viewer):
            out.append(await serialize_post(p, viewer))
    return {"posts": out}


@api.get("/posts/audio/{user_id}")
async def audio_posts_by_user(user_id: str, viewer=Depends(get_current_user)):
    if await db.blocks.find_one({"blocker_id": user_id, "blocked_id": viewer["user_id"]}):
        return {"posts": []}
    query = {"author_id": user_id, "is_audio_track": True}
    if is_minor(viewer):
        query["nsfw"] = {"$ne": True}
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for p in cursor:
        if await can_view_post(p, viewer):
            out.append(await serialize_post(p, viewer))
    return {"posts": out}


# ------------------------------------------------------------------
# Comments (Inner Circle only on regular posts)
# ------------------------------------------------------------------
async def serialize_comment(c: dict) -> dict:
    author = await db.users.find_one({"user_id": c["author_id"]}, {"_id": 0})
    return {
        "comment_id": c["comment_id"],
        "post_id": c["post_id"],
        "author": public_user(author) if author else None,
        "content": c["content"],
        "created_at": c["created_at"],
    }


@api.get("/posts/{post_id}/comments")
async def list_comments(post_id: str, viewer=Depends(get_current_user)):
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Not found")
    if not await can_view_post(post, viewer):
        raise HTTPException(404, "Not found")
    cursor = db.comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).limit(500)
    out = []
    async for c in cursor:
        out.append(await serialize_comment(c))
    return {"comments": out, "can_comment": await user_can_comment(post, viewer)}


@api.post("/posts/{post_id}/comments")
async def create_comment(post_id: str, payload: CommentIn, viewer=Depends(get_current_user)):
    post = await db.posts.find_one({"post_id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(404, "Not found")
    if not await can_view_post(post, viewer):
        raise HTTPException(404, "Not found")
    if not await user_can_comment(post, viewer):
        raise HTTPException(403, "Only the Inner Circle can comment on this post")
    cid = f"cmt_{uuid.uuid4().hex[:10]}"
    doc = {
        "comment_id": cid,
        "post_id": post_id,
        "author_id": viewer["user_id"],
        "content": payload.content.strip()[:1000],
        "created_at": now_iso(),
    }
    await db.comments.insert_one(doc)
    return await serialize_comment(doc)


@api.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, viewer=Depends(get_current_user)):
    c = await db.comments.find_one({"comment_id": comment_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    post = await db.posts.find_one({"post_id": c["post_id"]}, {"_id": 0})
    # Comment author OR post owner can delete
    if c["author_id"] != viewer["user_id"] and (not post or post["author_id"] != viewer["user_id"]):
        raise HTTPException(403, "Not allowed")
    await db.comments.delete_one({"comment_id": comment_id})
    return {"ok": True}


# ------------------------------------------------------------------
# Wall
# ------------------------------------------------------------------
@api.post("/wall/{owner_id}")
async def post_to_wall(owner_id: str, payload: WallPostIn, user=Depends(get_current_user)):
    owner = await db.users.find_one({"user_id": owner_id}, {"_id": 0})
    if not owner:
        raise HTTPException(404, "Not found")
    perm = owner.get("settings", {}).get("wall_post_permission", "owner")
    if owner_id != user["user_id"]:
        if perm == "owner":
            raise HTTPException(403, "Wall is owner-only")
        if perm == "followers":
            if not await db.follows.find_one({"follower_id": user["user_id"], "followee_id": owner_id, "status": "active"}):
                raise HTTPException(403, "Followers only")
        if perm == "inner":
            if not await db.inner_circle.find_one({"owner_id": owner_id, "member_id": user["user_id"], "status": "active"}):
                raise HTTPException(403, "Inner circle only")
    wid = f"wall_{uuid.uuid4().hex[:10]}"
    doc = {
        "wall_post_id": wid, "owner_id": owner_id, "author_id": user["user_id"],
        "content": payload.content.strip()[:2000], "nsfw": payload.nsfw,
        "created_at": now_iso(),
    }
    await db.wall_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/wall/{owner_id}")
async def get_wall(owner_id: str, viewer=Depends(get_current_user)):
    cursor = db.wall_posts.find({"owner_id": owner_id}, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for w in cursor:
        u = await db.users.find_one({"user_id": w["author_id"]}, {"_id": 0})
        out.append({**w, "author": public_user(u) if u else None})
    return {"posts": out}


@api.delete("/wall/{wall_post_id}")
async def delete_wall_post(wall_post_id: str, user=Depends(get_current_user)):
    """Delete a wall note. Allowed for: the note's author, the wall's owner, or an admin."""
    w = await db.wall_posts.find_one({"wall_post_id": wall_post_id}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Not found")
    is_admin = user.get("role") == "admin"
    if w["author_id"] != user["user_id"] and w["owner_id"] != user["user_id"] and not is_admin:
        raise HTTPException(403, "Not allowed")
    await db.wall_posts.delete_one({"wall_post_id": wall_post_id})
    if is_admin and w["author_id"] != user["user_id"] and w["owner_id"] != user["user_id"]:
        await db.audit_events.insert_one({
            "event": "wall.delete_admin", "admin_id": user["user_id"],
            "target_user_id": w["owner_id"], "wall_post_id": wall_post_id,
            "author_id": w["author_id"], "at": now_iso(),
        })
    return {"ok": True}


# ------------------------------------------------------------------
# Boards
# ------------------------------------------------------------------
@api.post("/boards")
async def create_board(payload: BoardIn, user=Depends(get_current_user)):
    if payload.tier not in TIERS:
        raise HTTPException(400, "Invalid tier")
    bid = f"brd_{uuid.uuid4().hex[:10]}"
    doc = {
        "board_id": bid, "owner_id": user["user_id"],
        "title": payload.title.strip()[:80], "description": payload.description.strip()[:500],
        "tier": payload.tier, "allow_t1_read": payload.allow_t1_read,
        "created_at": now_iso(),
    }
    await db.boards.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/boards/by-user/{owner_id}")
async def list_boards(owner_id: str, viewer=Depends(get_current_user)):
    cursor = db.boards.find({"owner_id": owner_id}, {"_id": 0}).sort("created_at", -1)
    out = []
    async for b in cursor:
        if b["tier"] == "inner":
            if owner_id != viewer["user_id"]:
                if not await db.inner_circle.find_one({"owner_id": owner_id, "member_id": viewer["user_id"], "status": "active"}):
                    continue
        elif b["tier"] == "followers":
            if owner_id != viewer["user_id"]:
                follows = await db.follows.find_one({"follower_id": viewer["user_id"], "followee_id": owner_id, "status": "active"})
                if not follows and not b.get("allow_t1_read", True):
                    continue
        out.append(b)
    return {"boards": out}


async def can_participate_board(board: dict, user: dict) -> bool:
    if board["owner_id"] == user["user_id"]:
        return True
    tier = board["tier"]
    if tier == "public":
        return True
    if tier == "followers":
        return bool(await db.follows.find_one({"follower_id": user["user_id"], "followee_id": board["owner_id"], "status": "active"}))
    if tier == "inner":
        return bool(await db.inner_circle.find_one({"owner_id": board["owner_id"], "member_id": user["user_id"], "status": "active"}))
    return False


@api.post("/boards/{board_id}/messages")
async def post_board_message(board_id: str, payload: BoardMessageIn, user=Depends(get_current_user)):
    board = await db.boards.find_one({"board_id": board_id}, {"_id": 0})
    if not board:
        raise HTTPException(404, "Not found")
    if not await can_participate_board(board, user):
        raise HTTPException(403, "Cannot participate")
    mid = f"bmsg_{uuid.uuid4().hex[:10]}"
    doc = {
        "message_id": mid, "board_id": board_id, "author_id": user["user_id"],
        "content": payload.content.strip()[:2000], "created_at": now_iso(),
    }
    await db.board_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/boards/{board_id}/messages")
async def board_messages(board_id: str, viewer=Depends(get_current_user)):
    board = await db.boards.find_one({"board_id": board_id}, {"_id": 0})
    if not board:
        raise HTTPException(404, "Not found")
    # check read permission
    if board["tier"] == "inner" and board["owner_id"] != viewer["user_id"]:
        if not await db.inner_circle.find_one({"owner_id": board["owner_id"], "member_id": viewer["user_id"], "status": "active"}):
            raise HTTPException(404, "Not found")
    if board["tier"] == "followers" and board["owner_id"] != viewer["user_id"]:
        follows = await db.follows.find_one({"follower_id": viewer["user_id"], "followee_id": board["owner_id"], "status": "active"})
        if not follows and not board.get("allow_t1_read", True):
            raise HTTPException(403, "Followers only")
    cursor = db.board_messages.find({"board_id": board_id}, {"_id": 0}).sort("created_at", 1).limit(500)
    out = []
    async for m in cursor:
        u = await db.users.find_one({"user_id": m["author_id"]}, {"_id": 0})
        out.append({**m, "author": public_user(u) if u else None})
    return {"board": board, "messages": out, "can_post": await can_participate_board(board, viewer)}


# ------------------------------------------------------------------
# DMs (tier-respecting, text-only V1)
# ------------------------------------------------------------------
async def can_dm(sender: dict, recipient: dict) -> tuple[bool, str]:
    if sender["user_id"] == recipient["user_id"]:
        return False, "Cannot DM yourself"
    if await db.blocks.find_one({"blocker_id": recipient["user_id"], "blocked_id": sender["user_id"]}):
        return False, "Blocked"
    if await db.blocks.find_one({"blocker_id": sender["user_id"], "blocked_id": recipient["user_id"]}):
        return False, "Blocked"
    # Minors can NEVER DM NSFW-flagged accounts. No exceptions.
    if is_minor(sender) and recipient.get("nsfw_account"):
        return False, "Cannot message this account"
    err = adult_minor_block(sender, recipient, actor_initiated=True)
    if err:
        # but allowed if minor initiated previously (any past message from minor)
        prior = await db.dms.find_one({"from_id": recipient["user_id"], "to_id": sender["user_id"]})
        if not prior:
            return False, err
    # check inner circle DM permission first
    ic = await db.inner_circle.find_one({"owner_id": recipient["user_id"], "member_id": sender["user_id"], "status": "active"})
    ic_reverse = await db.inner_circle.find_one({"owner_id": sender["user_id"], "member_id": recipient["user_id"], "status": "active"})
    if ic and ic.get("permissions", {}).get("dms", True):
        return True, ""
    if ic_reverse and ic_reverse.get("permissions", {}).get("dms", True):
        return True, ""
    # Tier 2: followers only if recipient has DMs enabled
    follows = await db.follows.find_one({"follower_id": sender["user_id"], "followee_id": recipient["user_id"], "status": "active"})
    if follows and recipient.get("settings", {}).get("dms_enabled_followers", False):
        return True, ""
    return False, "Recipient does not accept DMs"


@api.post("/dms")
async def send_dm(payload: DMIn, user=Depends(get_current_user)):
    # Self-DM ("Me, myself and I" saved-messages thread) — always allowed.
    is_self = payload.recipient_id == user["user_id"]
    if not is_self:
        recipient = await db.users.find_one({"user_id": payload.recipient_id}, {"_id": 0})
        if not recipient:
            raise HTTPException(404, "Recipient not found")
        ok, reason = await can_dm(user, recipient)
        if not ok:
            raise HTTPException(403, reason)
    content = payload.content.strip()[:2000]
    if not content and not payload.media_paths:
        raise HTTPException(400, "Message cannot be empty — add text or attach media.")
    mid = f"dm_{uuid.uuid4().hex[:10]}"
    doc = {
        "message_id": mid, "from_id": user["user_id"], "to_id": payload.recipient_id,
        # Encrypted content at rest. Plaintext is never persisted.
        "content_enc": encrypt_dm(content),
        "content": "",  # legacy column, intentionally blank for new rows
        "media_paths": payload.media_paths,  # capped at 4 via DMIn validator
        "created_at": now_iso(),
        # Self-DMs are pre-marked read since you're sending to yourself —
        # no point lighting up the unread badge.
        "read": True if is_self else False,
    }
    await db.dms.insert_one(doc)
    doc.pop("_id", None)
    # Fire-and-forget push notification. Self-DMs and recipients who muted
    # DMs in their push prefs get skipped automatically inside fcm_push.
    if not is_self:
        sender_handle = user.get("handle", "someone")
        preview = content[:80] if content else ("📎 Sent media" if payload.media_paths else "New message")
        try:
            await fcm_push(
                payload.recipient_id,
                f"#{sender_handle}",
                preview,
                data={"type": "dm", "from_id": user["user_id"], "from_handle": sender_handle},
                notif_type="dms",
            )
        except Exception as _e:
            logging.warning("dm push failed: %s", _e)
    # Return the decrypted form to the caller so the optimistic UI matches
    # the persisted version when re-fetched.
    return hydrate_dm(doc)


@api.get("/dms/threads")
async def list_threads(user=Depends(get_current_user)):
    # aggregate conversations
    pipeline = [
        {"$match": {"$or": [{"from_id": user["user_id"]}, {"to_id": user["user_id"]}]}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": {
                "$cond": [{"$eq": ["$from_id", user["user_id"]]}, "$to_id", "$from_id"]
            },
            "last_message": {"$first": "$$ROOT"},
        }},
    ]
    cursor = db.dms.aggregate(pipeline)
    threads = []
    self_thread = None
    async for t in cursor:
        other_id = t["_id"]
        if other_id == user["user_id"]:
            # Pin the self thread to the top later, don't bucket with the rest.
            self_thread = {
                "with": {**public_user(user), "is_self": True, "display_name": "Me, myself and I"},
                "last": hydrate_dm({k: v for k, v in t["last_message"].items() if k != "_id"}),
            }
            continue
        other = await db.users.find_one({"user_id": other_id}, {"_id": 0})
        if not other:
            continue
        threads.append({
            "with": public_user(other),
            "last": hydrate_dm({k: v for k, v in t["last_message"].items() if k != "_id"}),
        })
    # Always surface the self thread, even if empty.
    if self_thread is None:
        self_thread = {
            "with": {**public_user(user), "is_self": True, "display_name": "Me, myself and I"},
            "last": None,
        }
    return {"threads": [self_thread, *threads]}


@api.get("/dms/with/{other_id}")
async def dm_history(other_id: str, user=Depends(get_current_user)):
    is_self = other_id == user["user_id"]
    # Mark incoming messages as read. For self-DMs this is a no-op since
    # self-sends are already inserted with read=True.
    await db.dms.update_many(
        {"from_id": other_id, "to_id": user["user_id"], "read": False},
        {"$set": {"read": True, "read_at": now_iso()}},
    )
    cursor = db.dms.find({
        "$or": [
            {"from_id": user["user_id"], "to_id": other_id},
            {"from_id": other_id, "to_id": user["user_id"]},
        ]
    }, {"_id": 0}).sort("created_at", 1).limit(500)
    msgs = []
    async for m in cursor:
        msgs.append(hydrate_dm(m))
    if is_self:
        other = {**user, "display_name": "Me, myself and I"}
        return {"messages": msgs, "with": {**public_user(other), "is_self": True}, "can_send": True, "reason": "", "screenshots_allowed": True}
    other = await db.users.find_one({"user_id": other_id}, {"_id": 0})
    ok, reason = (False, "")
    if other:
        ok, reason = await can_dm(user, other)
    # Screenshots allowed only when BOTH sides have opted in. Default off.
    my_pref = (user.get("settings") or {}).get("dm_screenshots_allowed", False)
    other_pref = ((other or {}).get("settings") or {}).get("dm_screenshots_allowed", False)
    screenshots_allowed = bool(my_pref and other_pref)
    return {
        "messages": msgs,
        "with": public_user(other) if other else None,
        "can_send": ok,
        "reason": reason,
        "screenshots_allowed": screenshots_allowed,
    }


# ------------------------------------------------------------------
# Block / Mute / Report
# ------------------------------------------------------------------
@api.post("/restrict/{user_id}")
async def restrict_user(user_id: str, user=Depends(get_current_user)):
    """Quietly limit follower access — they can still follow but their interactions are silenced."""
    if user_id == user["user_id"]:
        raise HTTPException(400, "Cannot restrict yourself")
    await db.restrictions.update_one(
        {"restrictor_id": user["user_id"], "restricted_id": user_id},
        {"$setOnInsert": {"created_at": now_iso()}}, upsert=True
    )
    return {"ok": True}


@api.delete("/restrict/{user_id}")
async def unrestrict(user_id: str, user=Depends(get_current_user)):
    await db.restrictions.delete_one({"restrictor_id": user["user_id"], "restricted_id": user_id})
    return {"ok": True}


# ------------------------------------------------------------------
# Group chats — Inner Circle only, max 15, consent-based
# ------------------------------------------------------------------
GROUP_MAX = 15


async def is_in_owner_inner(owner_id: str, member_id: str) -> bool:
    return bool(await db.inner_circle.find_one({
        "owner_id": owner_id, "member_id": member_id, "status": "active"
    }))


def serialize_group(g: dict, viewer_id: str) -> dict:
    members = g.get("members", [])
    accepted = [m for m in members if m.get("status") == "accepted"]
    return {
        "group_id": g["group_id"],
        "name": g["name"],
        "owner_id": g["owner_id"],
        "members": members,
        "member_count": len(accepted),
        "my_status": next((m["status"] for m in members if m["user_id"] == viewer_id), None),
        "created_at": g["created_at"],
    }


@api.post("/groups")
async def create_group(payload: GroupCreateIn, user=Depends(get_current_user)):
    # Only IC members may be added
    member_objs = [{"user_id": user["user_id"], "status": "accepted", "joined_at": now_iso()}]
    seen = {user["user_id"]}
    for mid in payload.member_ids[:GROUP_MAX - 1]:
        if mid in seen:
            continue
        if not await is_in_owner_inner(user["user_id"], mid):
            continue  # silently skip non-IC
        member_objs.append({"user_id": mid, "status": "pending", "invited_at": now_iso()})
        seen.add(mid)
    gid = f"grp_{uuid.uuid4().hex[:10]}"
    doc = {
        "group_id": gid,
        "owner_id": user["user_id"],
        "name": payload.name.strip()[:60],
        "members": member_objs,
        "created_at": now_iso(),
    }
    await db.groups.insert_one(doc)
    doc.pop("_id", None)
    return serialize_group(doc, user["user_id"])


@api.get("/groups")
async def list_my_groups(user=Depends(get_current_user)):
    cursor = db.groups.find({
        "members": {"$elemMatch": {"user_id": user["user_id"], "status": {"$in": ["accepted", "pending"]}}}
    }, {"_id": 0}).sort("created_at", -1)
    out = []
    async for g in cursor:
        out.append(serialize_group(g, user["user_id"]))
    return {"groups": out}


@api.post("/groups/{group_id}/accept")
async def group_accept(group_id: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(404, "Not found")
    m = next((x for x in g.get("members", []) if x["user_id"] == user["user_id"] and x["status"] == "pending"), None)
    if not m:
        raise HTTPException(404, "Not found")
    await db.groups.update_one(
        {"group_id": group_id, "members.user_id": user["user_id"]},
        {"$set": {"members.$.status": "accepted", "members.$.joined_at": now_iso()}}
    )
    return {"ok": True}


@api.post("/groups/{group_id}/decline")
async def group_decline(group_id: str, user=Depends(get_current_user)):
    # Silent decline — pull member entry, no notification
    await db.groups.update_one(
        {"group_id": group_id},
        {"$pull": {"members": {"user_id": user["user_id"], "status": "pending"}}}
    )
    return {"ok": True}


@api.post("/groups/{group_id}/leave")
async def group_leave(group_id: str, user=Depends(get_current_user)):
    # Silent leave
    await db.groups.update_one(
        {"group_id": group_id},
        {"$pull": {"members": {"user_id": user["user_id"]}}}
    )
    return {"ok": True}


@api.post("/groups/{group_id}/invite")
async def group_invite(group_id: str, payload: FollowActionIn, user=Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g or g["owner_id"] != user["user_id"]:
        raise HTTPException(403, "Owner only")
    if len(g.get("members", [])) >= GROUP_MAX:
        raise HTTPException(400, "Group at max capacity (15)")
    if any(m["user_id"] == payload.user_id for m in g.get("members", [])):
        raise HTTPException(400, "Already in group")
    if not await is_in_owner_inner(user["user_id"], payload.user_id):
        raise HTTPException(403, "Member must be in your Inner Circle")
    await db.groups.update_one(
        {"group_id": group_id},
        {"$push": {"members": {"user_id": payload.user_id, "status": "pending", "invited_at": now_iso()}}}
    )
    return {"ok": True}


@api.post("/groups/{group_id}/remove/{user_id}")
async def group_remove_member(group_id: str, user_id: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g or g["owner_id"] != user["user_id"]:
        raise HTTPException(403, "Owner only")
    if user_id == user["user_id"]:
        raise HTTPException(400, "Owner cannot remove themselves; delete group instead")
    await db.groups.update_one(
        {"group_id": group_id},
        {"$pull": {"members": {"user_id": user_id}}}
    )
    return {"ok": True}


@api.post("/groups/{group_id}/messages")
async def group_send(group_id: str, payload: GroupMessageIn, user=Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id})
    if not g:
        raise HTTPException(404, "Not found")
    if not any(m["user_id"] == user["user_id"] and m["status"] == "accepted" for m in g.get("members", [])):
        raise HTTPException(403, "Not a group member")
    mid = f"gmsg_{uuid.uuid4().hex[:10]}"
    doc = {
        "message_id": mid, "group_id": group_id,
        "from_id": user["user_id"], "content": payload.content.strip()[:2000],
        "created_at": now_iso(),
    }
    await db.group_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/groups/{group_id}/messages")
async def group_messages(group_id: str, user=Depends(get_current_user)):
    g = await db.groups.find_one({"group_id": group_id}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Not found")
    if not any(m["user_id"] == user["user_id"] and m["status"] == "accepted" for m in g.get("members", [])):
        raise HTTPException(403, "Not a group member")
    cursor = db.group_messages.find({"group_id": group_id}, {"_id": 0}).sort("created_at", 1).limit(500)
    msgs = []
    async for m in cursor:
        msgs.append(m)
    return {"group": serialize_group(g, user["user_id"]), "messages": msgs}


@api.post("/block/{user_id}")
async def block_user(user_id: str, user=Depends(get_current_user)):
    if user_id == user["user_id"]:
        raise HTTPException(400, "Cannot block self")
    await db.blocks.update_one(
        {"blocker_id": user["user_id"], "blocked_id": user_id},
        {"$setOnInsert": {"created_at": now_iso()}}, upsert=True
    )
    # remove follows both ways
    await db.follows.delete_many({"$or": [
        {"follower_id": user["user_id"], "followee_id": user_id},
        {"follower_id": user_id, "followee_id": user["user_id"]},
    ]})
    return {"ok": True}


@api.delete("/block/{user_id}")
async def unblock(user_id: str, user=Depends(get_current_user)):
    await db.blocks.delete_one({"blocker_id": user["user_id"], "blocked_id": user_id})
    return {"ok": True}


@api.post("/mute/{user_id}")
async def mute(user_id: str, user=Depends(get_current_user)):
    await db.mutes.update_one(
        {"muter_id": user["user_id"], "muted_id": user_id},
        {"$setOnInsert": {"created_at": now_iso()}}, upsert=True,
    )
    return {"ok": True}


@api.delete("/mute/{user_id}")
async def unmute(user_id: str, user=Depends(get_current_user)):
    await db.mutes.delete_one({"muter_id": user["user_id"], "muted_id": user_id})
    return {"ok": True}


@api.post("/reports")
async def create_report(payload: ReportIn, user=Depends(get_current_user)):
    rid = f"rep_{uuid.uuid4().hex[:10]}"
    doc = {
        "report_id": rid, "reporter_id": user["user_id"],
        "target_type": payload.target_type, "target_id": payload.target_id,
        "category": payload.category[:80], "notes": payload.notes[:1000],
        "status": "pending", "created_at": now_iso(),
    }
    await db.reports.insert_one(doc)
    # CSAM = immediate quarantine + audit log (CEOP pipeline scaffolded behind env flag)
    if payload.category == "csam":
        await handle_csam_report(payload.target_type, payload.target_id, user["user_id"])
    # Soft pre-strike warning: if 3+ pending reports against same target user → warn
    target_user_id = None
    if payload.target_type == "user":
        target_user_id = payload.target_id
    elif payload.target_type == "post":
        p = await db.posts.find_one({"post_id": payload.target_id}, {"author_id": 1, "_id": 0})
        if p:
            target_user_id = p["author_id"]
    if target_user_id:
        recent_count = await db.reports.count_documents({
            "target_id": payload.target_id, "status": "pending",
        })
        existing_warn = await db.soft_warnings.find_one({
            "user_id": target_user_id, "target_id": payload.target_id,
        })
        if recent_count >= 3 and not existing_warn:
            await db.soft_warnings.insert_one({
                "warning_id": f"warn_{uuid.uuid4().hex[:10]}",
                "user_id": target_user_id, "target_id": payload.target_id,
                "message": "Your content has been reported several times. Please review our community guidelines before this becomes a strike.",
                "created_at": now_iso(), "dismissed": False,
            })
    return {"report_id": rid}


async def handle_csam_report(target_type: str, target_id: str, reporter_id: str):
    """Immediate CSAM handling: quarantine, audit, and external CEOP/NCMEC POST (feature-flagged)."""
    if target_type == "post":
        await db.posts.update_one(
            {"post_id": target_id},
            {"$set": {"quarantined": True, "quarantined_at": now_iso(), "quarantined_reason": "csam_report"}}
        )
    await db.csam_reports.insert_one({
        "csam_id": f"csam_{uuid.uuid4().hex[:10]}",
        "target_type": target_type, "target_id": target_id,
        "reporter_id": reporter_id, "status": "queued",
        "created_at": now_iso(),
    })
    await db.audit_events.insert_one({
        "event": "csam_report_received",
        "target_type": target_type, "target_id": target_id,
        "reporter_id": reporter_id, "at": now_iso(),
    })
    # External hook — only fires if CEOP_ENDPOINT env is set (real deploy)
    ceop_url = os.environ.get("CEOP_ENDPOINT")
    if ceop_url:
        try:
            requests.post(ceop_url, json={
                "target_type": target_type, "target_id": target_id,
                "received_at": now_iso(),
            }, timeout=10)
            await db.csam_reports.update_one(
                {"target_id": target_id}, {"$set": {"status": "forwarded"}}
            )
        except Exception as e:
            logging.error(f"CEOP forward failed: {e}")
            await db.csam_reports.update_one(
                {"target_id": target_id}, {"$set": {"status": "forward_failed", "error": str(e)[:200]}}
            )


@api.get("/me/warnings")
async def my_warnings(user=Depends(get_current_user)):
    cursor = db.soft_warnings.find({"user_id": user["user_id"], "dismissed": False}, {"_id": 0})
    out = []
    async for w in cursor:
        out.append(w)
    return {"warnings": out}


@api.post("/me/warnings/{warning_id}/dismiss")
async def dismiss_warning(warning_id: str, user=Depends(get_current_user)):
    await db.soft_warnings.update_one(
        {"warning_id": warning_id, "user_id": user["user_id"]},
        {"$set": {"dismissed": True}}
    )
    return {"ok": True}


# ------------------------------------------------------------------
# Admin (founding team)
# ------------------------------------------------------------------
def require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return user


@api.get("/admin/reports")
async def admin_list_reports(admin=Depends(require_admin), status: str = "pending"):
    cursor = db.reports.find({"status": status}, {"_id": 0}).sort("created_at", -1).limit(200)
    out = []
    async for r in cursor:
        reporter = await db.users.find_one({"user_id": r["reporter_id"]}, {"_id": 0})
        out.append({
            **r,
            "reporter": public_user(reporter) if reporter else None,
        })
    return {"reports": out}


@api.post("/admin/reports/{report_id}/strike")
async def admin_apply_strike(report_id: str, level: int = 1, reason: str = "", admin=Depends(require_admin)):
    r = await db.reports.find_one({"report_id": report_id})
    if not r:
        raise HTTPException(404, "Not found")
    # find target user
    target_user_id = None
    if r["target_type"] == "user":
        target_user_id = r["target_id"]
    elif r["target_type"] == "post":
        p = await db.posts.find_one({"post_id": r["target_id"]}, {"_id": 0})
        if p:
            target_user_id = p["author_id"]
    if not target_user_id:
        raise HTTPException(400, "Target user not resolvable")
    await apply_strike(target_user_id, reason or r.get("category", "Community guidelines"), level=level)
    await db.reports.update_one({"report_id": report_id}, {"$set": {"status": "actioned", "actioned_at": now_iso(), "actioned_by": admin["user_id"], "action": f"strike_{level}"}})
    return {"ok": True}


@api.post("/admin/reports/{report_id}/dismiss")
async def admin_dismiss_report(report_id: str, admin=Depends(require_admin)):
    await db.reports.update_one({"report_id": report_id}, {"$set": {"status": "dismissed", "actioned_at": now_iso(), "actioned_by": admin["user_id"]}})
    return {"ok": True}


@api.get("/admin/stats")
async def admin_stats(admin=Depends(require_admin)):
    return {
        "users": await db.users.count_documents({"deleted": {"$ne": True}}),
        "posts": await db.posts.count_documents({}),
        "pending_reports": await db.reports.count_documents({"status": "pending"}),
        "csam_queue": await db.csam_reports.count_documents({"status": "queued"}),
        "suspended": await db.users.count_documents({"suspended_until": {"$gt": now_iso()}}),
        "deleted": await db.users.count_documents({"deleted": True}),
    }


# ------------------------------------------------------------------
# CEOP / CSAM pipeline (Iteration 8)
# Quarantined content is invisible to everyone except admins (enforced in
# can_view_post). The queue below is the human handoff layer. In production
# CEOP_ENDPOINT triggers an automated POST to NCMEC/IWF; without it, the queue
# captures every report for manual export.
# ------------------------------------------------------------------
@api.get("/admin/csam/queue")
async def admin_csam_queue(admin=Depends(require_admin), status: str = "queued"):
    cursor = db.csam_reports.find({"status": status}, {"_id": 0}).sort("created_at", -1).limit(200)
    out = []
    async for r in cursor:
        reporter = await db.users.find_one({"user_id": r["reporter_id"]}, {"_id": 0})
        target_meta = None
        if r["target_type"] == "post":
            p = await db.posts.find_one({"post_id": r["target_id"]}, {"_id": 0})
            if p:
                target_meta = {
                    "author_handle": (await db.users.find_one({"user_id": p["author_id"]}, {"_id": 0, "handle": 1}) or {}).get("handle"),
                    "media_count": len(p.get("media_paths", [])),
                    "created_at": p.get("created_at"),
                    "quarantined": p.get("quarantined", False),
                }
        out.append({
            "csam_id": r["csam_id"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "reporter_handle": reporter.get("handle") if reporter else None,
            "status": r["status"],
            "created_at": r["created_at"],
            "target_meta": target_meta,
        })
    return {"queue": out}


@api.post("/admin/csam/{csam_id}/confirm")
async def admin_csam_confirm(csam_id: str, admin=Depends(require_admin)):
    """Confirm CSAM — escalate: delete content, strike-3 author, log audit, mark handoff complete."""
    r = await db.csam_reports.find_one({"csam_id": csam_id})
    if not r:
        raise HTTPException(404, "Not found")
    if r["target_type"] == "post":
        post = await db.posts.find_one({"post_id": r["target_id"]}, {"_id": 0})
        if post:
            await db.posts.delete_one({"post_id": r["target_id"]})
            # immediate strike-3 (permanent deletion path) on the author
            await apply_strike(post["author_id"], reason="CSAM confirmed", level=3)
    elif r["target_type"] == "user":
        await apply_strike(r["target_id"], reason="CSAM confirmed", level=3)
    await db.csam_reports.update_one(
        {"csam_id": csam_id},
        {"$set": {"status": "confirmed", "reviewed_by": admin["user_id"], "reviewed_at": now_iso()}}
    )
    await db.audit_events.insert_one({
        "event": "csam_confirmed",
        "csam_id": csam_id,
        "target_type": r["target_type"],
        "target_id": r["target_id"],
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True}


@api.post("/admin/csam/{csam_id}/clear")
async def admin_csam_clear(csam_id: str, admin=Depends(require_admin)):
    """False alarm — restore content, log audit. Note: keeps full audit trail."""
    r = await db.csam_reports.find_one({"csam_id": csam_id})
    if not r:
        raise HTTPException(404, "Not found")
    if r["target_type"] == "post":
        await db.posts.update_one(
            {"post_id": r["target_id"]},
            {"$set": {"quarantined": False, "quarantine_cleared_at": now_iso(), "quarantine_cleared_by": admin["user_id"]}}
        )
    await db.csam_reports.update_one(
        {"csam_id": csam_id},
        {"$set": {"status": "cleared", "reviewed_by": admin["user_id"], "reviewed_at": now_iso()}}
    )
    await db.audit_events.insert_one({
        "event": "csam_cleared",
        "csam_id": csam_id,
        "target_type": r["target_type"],
        "target_id": r["target_id"],
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True}


@api.get("/admin/audit")
async def admin_audit_log(admin=Depends(require_admin), limit: int = 100):
    """Compliance audit trail. Append-only, immutable, admin-only."""
    cursor = db.audit_events.find({}, {"_id": 0}).sort("at", -1).limit(min(limit, 500))
    out = []
    async for e in cursor:
        out.append(e)
    return {"events": out}


# ------------------------------------------------------------------
# Admin: promote a user to admin role (one-off bootstrap helper for
# production where the user wants to swap the seeded admin@clanchat.app
# for their own real email).
# ------------------------------------------------------------------
@api.post("/admin/promote")
async def admin_promote(payload: dict, admin=Depends(require_admin)):
    email = (payload.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(400, "email required")
    target = await db.users.find_one({"email": email})
    if not target:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"role": "admin"}})
    await db.audit_events.insert_one({
        "event": "admin_promoted", "target_user_id": target["user_id"],
        "target_email": email, "promoted_by": admin["user_id"], "at": now_iso(),
    })
    return {"ok": True, "user_id": target["user_id"]}


# ------------------------------------------------------------------
# Admin: manual account flag overrides (interim — long-term these become
# automated via age verification + creator application).
# ------------------------------------------------------------------
@api.post("/admin/users/{user_id}/mark-minor")
async def admin_mark_minor(user_id: str, payload: dict, admin=Depends(require_admin)):
    """Force-lock an account as a minor. Sets is_minor:true regardless of DOB
    and records minor_locked_by_admin so the user cannot self-unlock. Setting
    locked:false removes the override (DOB-derived minority still applies)."""
    locked = bool(payload.get("locked", True))
    reason = (payload.get("reason") or "").strip()
    if locked and not reason:
        raise HTTPException(400, "reason required (audit trail)")
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    # Safety guard — can't simultaneously be a flagged 18+ creator
    if locked and target.get("nsfw_account"):
        raise HTTPException(409, "Account is flagged as 18+ creator. Remove that flag first.")
    update = {
        "is_minor": locked,
        "minor_locked_by_admin": locked,
        "minor_locked_reason": reason if locked else None,
        "minor_locked_at": now_iso() if locked else None,
        "minor_locked_by": admin["user_id"] if locked else None,
    }
    # When unlocking, restore the DOB-derived flag
    if not locked:
        update["is_minor"] = calc_age(target.get("dob", "1900-01-01")) < 18
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    await db.audit_events.insert_one({
        "event": "admin_mark_minor",
        "target_user_id": user_id,
        "target_handle": target.get("handle"),
        "locked": locked,
        "reason": reason,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True, "is_minor": update["is_minor"], "minor_locked_by_admin": locked}


@api.post("/admin/users/{user_id}/mark-18plus")
async def admin_mark_18plus(user_id: str, payload: dict, admin=Depends(require_admin)):
    """Flag an account as a 18+ content creator. NSFW content allowed for them;
    invisible to minors in search; nsfw_account=true. Setting is_creator:false
    removes the flag."""
    is_creator = bool(payload.get("is_creator", True))
    reason = (payload.get("reason") or "").strip()
    if is_creator and not reason:
        raise HTTPException(400, "reason required (audit trail)")
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    # Safety guard — can't simultaneously be a locked minor
    if is_creator and (target.get("minor_locked_by_admin") or target.get("is_minor")):
        raise HTTPException(409, "Account is a minor (DOB or admin-locked). Cannot flag as 18+ creator.")
    update = {
        "nsfw_account": is_creator,
        "flagged_18plus_by_admin": is_creator,
        "flagged_18plus_reason": reason if is_creator else None,
        "flagged_18plus_at": now_iso() if is_creator else None,
        "flagged_18plus_by": admin["user_id"] if is_creator else None,
    }
    await db.users.update_one({"user_id": user_id}, {"$set": update})
    await db.audit_events.insert_one({
        "event": "admin_mark_18plus",
        "target_user_id": user_id,
        "target_handle": target.get("handle"),
        "is_creator": is_creator,
        "reason": reason,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True, "nsfw_account": is_creator, "flagged_18plus_by_admin": is_creator}


@api.get("/admin/users/by-handle/{handle}")
async def admin_user_lookup(handle: str, admin=Depends(require_admin)):
    """Admin lookup for any handle — returns the flag state so the UI can show
    current minor/18+ status before applying changes."""
    h = handle.strip().lower().lstrip("#")
    u = await db.users.find_one({"handle": h}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "User not found")
    return {
        "user_id": u["user_id"],
        "handle": u["handle"],
        "display_name": u.get("display_name"),
        "email": u.get("email"),
        "dob": u.get("dob"),
        "is_minor": is_minor(u),
        "dob_derived_minor": calc_age(u.get("dob", "1900-01-01")) < 18,
        "minor_locked_by_admin": bool(u.get("minor_locked_by_admin")),
        "minor_locked_reason": u.get("minor_locked_reason"),
        "nsfw_account": bool(u.get("nsfw_account")),
        "flagged_18plus_by_admin": bool(u.get("flagged_18plus_by_admin")),
        "flagged_18plus_reason": u.get("flagged_18plus_reason"),
        "role": u.get("role", "user"),
        "deleted": bool(u.get("deleted")),
        "suspended_until": u.get("suspended_until"),
        "strikes": u.get("strikes", 0),
        "auth_provider": u.get("auth_provider", "password"),
    }


@api.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, payload: dict, admin=Depends(require_admin)):
    """Admin sets a temporary password for a user (support flow — user
    forgot password and there's no email reset yet). The new password is
    NOT returned in plaintext anywhere persistent; the admin must read it
    once from the response and pass it to the user out-of-band. Reason is
    required and the action is audit-logged."""
    reason = (payload.get("reason") or "").strip()
    new_password = (payload.get("new_password") or "").strip()
    if not reason:
        raise HTTPException(400, "reason required (audit trail)")
    if len(new_password) < 8 or len(new_password) > 128:
        raise HTTPException(400, "new_password must be 8-128 chars")
    target = await db.users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("auth_provider") != "password":
        raise HTTPException(400, "Account uses Google sign-in — cannot set a password.")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"password_hash": hash_password(new_password)}},
    )
    await db.audit_events.insert_one({
        "event": "admin_reset_password",
        "target_user_id": user_id,
        "target_handle": target.get("handle"),
        "reason": reason,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True, "handle": target.get("handle")}


# ------------------------------------------------------------------
# Admin Watchlist — silent investigative surveillance
#
# WHY: When an account has been reported, the admin needs to verify whether
# the report is warranted (e.g. confirming abuse pattern in DMs) before
# applying a strike. This tool allows full visibility — posts in every tier,
# all DMs, group memberships — for accounts the admin has explicitly added.
#
# RULES:
# - Watched users have ZERO indication they're being watched. No notification,
#   no field on their public profile, no API endpoint they can call to check.
# - Every add / remove / view is recorded in audit_events (append-only,
#   immutable). This protects the admin legally: "why was bob123 watched?" has
#   a documented reason and timestamp.
# - Only admin role can touch any /admin/watch/* endpoint.
# - Adding requires a reason (free-text). Encouraged: a report_id or short note.
# ------------------------------------------------------------------
async def is_watched(user_id: str) -> bool:
    return (await db.watchlist.find_one({"target_id": user_id, "active": True})) is not None


@api.get("/admin/watch")
async def admin_watch_list(admin=Depends(require_admin)):
    out = []
    async for w in db.watchlist.find({"active": True}, {"_id": 0}).sort("added_at", -1):
        u = await db.users.find_one({"user_id": w["target_id"]}, {"_id": 0, "handle": 1, "display_name": 1, "avatar_path": 1, "email": 1, "user_id": 1})
        if not u:
            continue
        out.append({
            "watch_id": w["watch_id"],
            "target": u,
            "reason": w.get("reason"),
            "added_at": w["added_at"],
            "added_by": w["added_by"],
        })
    return {"watched": out}


@api.post("/admin/watch/{user_id}")
async def admin_watch_add(user_id: str, payload: dict, admin=Depends(require_admin)):
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "reason required (audit trail)")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "handle": 1, "user_id": 1})
    if not target:
        raise HTTPException(404, "User not found")
    # Re-activate existing entry or insert new
    existing = await db.watchlist.find_one({"target_id": user_id, "active": True})
    if existing:
        # Log the re-add attempt so the paper trail captures repeated escalation
        # interest in the same target (even though the watch entry itself is unchanged).
        await db.audit_events.insert_one({
            "event": "watchlist_readd_attempt",
            "watch_id": existing["watch_id"],
            "target_id": user_id,
            "target_handle": target.get("handle"),
            "reason": reason,
            "admin_id": admin["user_id"],
            "at": now_iso(),
        })
        return {"ok": True, "watch_id": existing["watch_id"], "note": "already watched"}
    watch_id = f"watch_{uuid.uuid4().hex[:12]}"
    await db.watchlist.insert_one({
        "watch_id": watch_id,
        "target_id": user_id,
        "added_by": admin["user_id"],
        "added_at": now_iso(),
        "reason": reason,
        "active": True,
    })
    await db.audit_events.insert_one({
        "event": "watchlist_add",
        "watch_id": watch_id,
        "target_id": user_id,
        "target_handle": target.get("handle"),
        "reason": reason,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True, "watch_id": watch_id}


@api.delete("/admin/watch/{user_id}")
async def admin_watch_remove(user_id: str, admin=Depends(require_admin)):
    entry = await db.watchlist.find_one({"target_id": user_id, "active": True})
    if not entry:
        raise HTTPException(404, "Not on watchlist")
    await db.watchlist.update_one(
        {"watch_id": entry["watch_id"]},
        {"$set": {"active": False, "removed_at": now_iso(), "removed_by": admin["user_id"]}},
    )
    await db.audit_events.insert_one({
        "event": "watchlist_remove",
        "watch_id": entry["watch_id"],
        "target_id": user_id,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True}


@api.get("/admin/watch/{user_id}/overview")
async def admin_watch_overview(user_id: str, admin=Depends(require_admin)):
    """All-tiers profile + post + DM + group summary for a watched user.
    Each call is audit-logged so we know which admin viewed what when.
    """
    if not await is_watched(user_id):
        raise HTTPException(403, "Target is not on the watchlist. Add them first.")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")

    # Posts — ALL tiers including IC and quarantined
    posts = []
    async for p in db.posts.find({"author_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(100):
        posts.append(p)

    # DMs — both directions, last 200
    dms_cursor = db.dms.find(
        {"$or": [{"from_id": user_id}, {"to_id": user_id}]}, {"_id": 0}
    ).sort("created_at", -1).limit(200)
    dms = []
    counterpart_ids = set()
    async for m in dms_cursor:
        dms.append(hydrate_dm(m))
        counterpart_ids.add(m["from_id"] if m["from_id"] != user_id else m["to_id"])
    # Resolve counterpart handles for the UI
    counterparts = {}
    async for u in db.users.find({"user_id": {"$in": list(counterpart_ids)}}, {"_id": 0, "user_id": 1, "handle": 1, "display_name": 1}):
        counterparts[u["user_id"]] = u

    # Group memberships
    groups = []
    async for g in db.group_chats.find({"members": user_id}, {"_id": 0}):
        groups.append({"group_id": g["group_id"], "name": g.get("name"), "members": len(g.get("members", []))})

    # Inner Circle relationships
    ic_members = []
    async for ic in db.inner_circle.find({"owner_id": user_id, "status": "active"}, {"_id": 0}):
        u = await db.users.find_one({"user_id": ic["member_id"]}, {"_id": 0, "handle": 1, "user_id": 1})
        if u:
            ic_members.append(u)
    ic_of = []
    async for ic in db.inner_circle.find({"member_id": user_id, "status": "active"}, {"_id": 0}):
        u = await db.users.find_one({"user_id": ic["owner_id"]}, {"_id": 0, "handle": 1, "user_id": 1})
        if u:
            ic_of.append(u)

    # Follow counts
    followers_count = await db.follows.count_documents({"followee_id": user_id, "status": "active"})
    following_count = await db.follows.count_documents({"follower_id": user_id, "status": "active"})

    # Reports filed against this user
    reports_against = []
    async for r in db.reports.find({"target_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(50):
        reports_against.append(r)

    await db.audit_events.insert_one({
        "event": "watchlist_view_overview",
        "target_id": user_id,
        "admin_id": admin["user_id"],
        "at": now_iso(),
    })

    return {
        "target": target,
        "posts": posts,
        "post_count": len(posts),
        "dms": dms,
        "dm_count": len(dms),
        "counterparts": counterparts,
        "groups": groups,
        "inner_circle_members": ic_members,
        "inner_circle_of": ic_of,
        "followers_count": followers_count,
        "following_count": following_count,
        "reports_against": reports_against,
    }


# ------------------------------------------------------------------
# Admin: one-off purge of seeded demo accounts.
# Wipes alice/bob/teen (+ optionally the seeded admin@clanchat.app) and ALL
# data they touched: posts, comments, follows, inner-circle, DMs, group chats,
# boards, wall posts, reports, csam, tag-approvals, warnings, notifications.
# The calling admin is never purged, even if include_seeded_admin=true.
# ------------------------------------------------------------------
DEMO_EMAILS = ["alice@clanchat.app", "bob@clanchat.app", "teen@clanchat.app"]
SEEDED_ADMIN_EMAIL = "admin@clanchat.app"


@api.post("/admin/purge-demo-accounts")
async def admin_purge_demo(payload: Optional[dict] = None, admin=Depends(require_admin)):
    payload = payload or {}
    include_seeded_admin = bool(payload.get("include_seeded_admin", False))

    emails_to_purge = list(DEMO_EMAILS)
    if include_seeded_admin:
        emails_to_purge.append(SEEDED_ADMIN_EMAIL)

    # Resolve user_ids and refuse to nuke the calling admin
    targets = []
    async for u in db.users.find({"email": {"$in": emails_to_purge}}, {"_id": 0, "user_id": 1, "email": 1, "handle": 1}):
        if u["user_id"] == admin["user_id"]:
            continue  # never delete self
        targets.append(u)

    if not targets:
        return {"ok": True, "purged": [], "note": "No demo accounts found (already clean)."}

    uids = [t["user_id"] for t in targets]

    # Delete every collection that references these users by any id field.
    summary = {}
    summary["posts"] = (await db.posts.delete_many({"author_id": {"$in": uids}})).deleted_count
    summary["comments"] = (await db.comments.delete_many({"author_id": {"$in": uids}})).deleted_count
    summary["follows"] = (await db.follows.delete_many({"$or": [{"follower_id": {"$in": uids}}, {"followee_id": {"$in": uids}}]})).deleted_count
    summary["inner_circle"] = (await db.inner_circle.delete_many({"$or": [{"owner_id": {"$in": uids}}, {"member_id": {"$in": uids}}]})).deleted_count
    summary["dms"] = (await db.dms.delete_many({"$or": [{"from_id": {"$in": uids}}, {"to_id": {"$in": uids}}]})).deleted_count
    # group chats: delete groups created by, plus remove from members/pending of others
    summary["group_chats"] = (await db.group_chats.delete_many({"creator_id": {"$in": uids}})).deleted_count
    await db.group_chats.update_many({}, {"$pull": {"members": {"$in": uids}, "pending_invites": {"$in": uids}}})
    summary["group_messages"] = (await db.group_messages.delete_many({"$or": [{"author_id": {"$in": uids}}, {"from_id": {"$in": uids}}]})).deleted_count
    summary["boards"] = (await db.boards.delete_many({"creator_id": {"$in": uids}})).deleted_count
    summary["board_posts"] = (await db.board_posts.delete_many({"author_id": {"$in": uids}})).deleted_count
    summary["wall_posts"] = (await db.wall_posts.delete_many({"$or": [{"owner_id": {"$in": uids}}, {"author_id": {"$in": uids}}]})).deleted_count
    summary["reports"] = (await db.reports.delete_many({"$or": [{"reporter_id": {"$in": uids}}, {"target_id": {"$in": uids}}]})).deleted_count
    summary["csam_reports"] = (await db.csam_reports.delete_many({"$or": [{"reporter_id": {"$in": uids}}, {"target_id": {"$in": uids}}]})).deleted_count
    summary["tags_pending"] = (await db.tags_pending.delete_many({"$or": [{"author_id": {"$in": uids}}, {"tagged_user_id": {"$in": uids}}]})).deleted_count
    summary["user_warnings"] = (await db.user_warnings.delete_many({"user_id": {"$in": uids}})).deleted_count
    summary["blocks"] = (await db.blocks.delete_many({"$or": [{"blocker_id": {"$in": uids}}, {"blocked_id": {"$in": uids}}]})).deleted_count
    summary["mutes"] = (await db.mutes.delete_many({"$or": [{"muter_id": {"$in": uids}}, {"muted_id": {"$in": uids}}]})).deleted_count
    summary["restricts"] = (await db.restricts.delete_many({"$or": [{"restrictor_id": {"$in": uids}}, {"restricted_id": {"$in": uids}}]})).deleted_count
    summary["users"] = (await db.users.delete_many({"user_id": {"$in": uids}})).deleted_count

    await db.audit_events.insert_one({
        "event": "demo_purge",
        "purged_user_ids": uids,
        "purged_emails": [t["email"] for t in targets],
        "summary": summary,
        "include_seeded_admin": include_seeded_admin,
        "performed_by": admin["user_id"],
        "at": now_iso(),
    })
    return {"ok": True, "purged": [t["email"] for t in targets], "summary": summary}


# ------------------------------------------------------------------
# Trending tags (right-rail / discovery)
# Public posts, last 24h, top 10, exclude banned & non-public
# ------------------------------------------------------------------
@api.get("/tags/trending")
async def trending_tags(viewer=Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    # Aggregate over public, non-NSFW (for minors), non-quarantined posts
    match = {
        "tier": "public",
        "quarantined": {"$ne": True},
        "created_at": {"$gte": cutoff},
        "tags": {"$exists": True, "$ne": []},
    }
    if is_minor(viewer):
        match["nsfw"] = {"$ne": True}
    pipeline = [
        {"$match": match},
        {"$unwind": "$tags"},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    out = []
    async for row in db.posts.aggregate(pipeline):
        out.append({"tag": row["_id"], "count": row["count"]})
    return {"trending": out}


# ------------------------------------------------------------------
# Upload
# ------------------------------------------------------------------
@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename.split(".")[-1] if file.filename and "." in file.filename else "bin").lower()
    if ext not in {"jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "aac", "flac"}:
        raise HTTPException(400, "Unsupported file type")
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(400, "Max 50MB")
    ctype = file.content_type or "application/octet-stream"
    res = put_object(path, data, ctype)
    await db.files.insert_one({
        "file_id": f"file_{uuid.uuid4().hex[:10]}",
        "user_id": user["user_id"],
        "storage_path": res["path"],
        "original_filename": file.filename, "content_type": ctype,
        "size": res.get("size", len(data)), "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": res["path"], "content_type": ctype, "size": res.get("size", len(data))}


@api.get("/files/{path:path}")
async def serve_file(path: str, request: Request):
    # public read for V1 (storage is private, frontend already authenticated)
    record = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Not found")
    data, ctype = get_object(path)
    return FastResponse(content=data, media_type=record.get("content_type", ctype),
                        headers={"Cache-Control": "public, max-age=3600"})


# ------------------------------------------------------------------
# Notifications counts (light)
# ------------------------------------------------------------------
@api.get("/notifications/counts")
async def notif_counts(user=Depends(get_current_user)):
    uid = user["user_id"]
    last_seen = user.get("notifications_seen_at") or "2000-01-01T00:00:00+00:00"
    fr = await db.follows.count_documents({"followee_id": uid, "status": "pending"})
    inv = await db.inner_circle.count_documents({"member_id": uid, "status": "pending"})
    unread = await db.dms.count_documents({"to_id": uid, "read": False})
    # New followers since last viewed (covers open-follow accounts)
    new_followers = await db.follows.count_documents({
        "followee_id": uid, "status": "active",
        "created_at": {"$gt": last_seen},
    })
    # Pending tag-approval requests addressed to me
    tag_pending = await db.tags_pending.count_documents({"tagged_user_id": uid, "status": "pending"})
    # Pending group-chat invites
    group_invites = await db.group_chats.count_documents({"pending_invites": uid})
    # Unread strike warnings
    warnings = await db.user_warnings.count_documents({"user_id": uid, "dismissed": False})
    total = fr + inv + unread + new_followers + tag_pending + group_invites + warnings
    return {
        "follow_requests": fr,
        "inner_invites": inv,
        "unread_dms": unread,
        "new_followers": new_followers,
        "tag_pending": tag_pending,
        "group_invites": group_invites,
        "warnings": warnings,
        "total": total,
    }


@api.post("/notifications/mark-seen")
async def notif_mark_seen(user=Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"notifications_seen_at": now_iso()}}
    )
    return {"ok": True}


@api.get("/users/me/followers")
async def my_followers(user=Depends(get_current_user)):
    """Private list — only the user themselves can see who follows them."""
    out = []
    async for f in db.follows.find({"followee_id": user["user_id"], "status": "active"}, {"_id": 0}).sort("created_at", -1).limit(500):
        u = await db.users.find_one({"user_id": f["follower_id"]}, {"_id": 0, "handle": 1, "display_name": 1, "avatar_path": 1, "user_id": 1, "bio": 1})
        if u:
            out.append({**u, "followed_at": f.get("created_at")})
    return {"followers": out, "count": len(out)}


@api.get("/users/me/following")
async def my_following(user=Depends(get_current_user)):
    """Private list — only the user themselves can see who they follow."""
    out = []
    async for f in db.follows.find({"follower_id": user["user_id"], "status": "active"}, {"_id": 0}).sort("created_at", -1).limit(500):
        u = await db.users.find_one({"user_id": f["followee_id"]}, {"_id": 0, "handle": 1, "display_name": 1, "avatar_path": 1, "user_id": 1, "bio": 1})
        if u:
            out.append({**u, "followed_at": f.get("created_at")})
    return {"following": out, "count": len(out)}


# ------------------------------------------------------------------
# Startup
# ------------------------------------------------------------------
async def seed_demo():
    demo = [
        ("admin@clanchat.app", "admin123", "admin", "Admin", "1990-01-01", "admin"),
        ("alice@clanchat.app", "Password123!", "alice", "Alice", "1995-04-12", "user"),
        ("bob@clanchat.app", "Password123!", "bob", "Bob", "1992-09-01", "user"),
        ("teen@clanchat.app", "Password123!", "teenager", "Teen", "2012-01-01", "user"),
    ]
    for email, pw, handle, name, dob, role in demo:
        existing = await db.users.find_one({"email": email})
        if existing:
            continue
        age = calc_age(dob)
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": uid, "email": email,
            "password_hash": hash_password(pw),
            "handle": handle, "display_name": name,
            "dob": dob, "is_minor": age < 18, "bio": f"Hi, I'm {name}",
            "avatar_path": None, "links": [], "follow_mode": "open",
            "settings": default_settings(), "role": role,
            "auth_provider": "password", "strikes": 0, "suspended_until": None,
            "created_at": now_iso(),
        })


@app.on_event("startup")
async def startup_event():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("handle", unique=True)
    await db.posts.create_index([("author_id", 1), ("created_at", -1)])
    await db.posts.create_index([("created_at", -1)])
    await db.posts.create_index("tags")
    await db.follows.create_index([("follower_id", 1), ("followee_id", 1)], unique=True)
    await db.inner_circle.create_index([("owner_id", 1), ("member_id", 1)], unique=True)
    await db.dms.create_index([("from_id", 1), ("to_id", 1), ("created_at", -1)])
    # Demo accounts are only seeded when SEED_DEMO_DATA=1 (preview/dev only).
    # Production must NOT have alice/bob/teen test users polluting the app.
    if os.environ.get("SEED_DEMO_DATA") == "1":
        await seed_demo()
    init_storage()


@app.on_event("shutdown")
async def shutdown_event():
    client.close()


# ----------------------------------------------------------------------
# LiveKit voice / video calling
#
# Server-side: mints short-lived per-call JWT tokens scoped to a single
# room. The api key/secret never leave the server — the client only
# receives the room name, the LiveKit URL, and a join token that expires
# automatically.
#
# Call lifecycle:
#   1. Caller -> POST /calls/start  (creates room + db row + notification)
#   2. Recipient polls /calls/incoming/{me}  (every 3s in the UI)
#   3. Either side -> POST /calls/{id}/answer or /reject
#   4. Both sides connect to LiveKit using the returned join token
#   5. POST /calls/{id}/end when hanging up
#
# Every call insert + end is audit-logged so the admin panel can show
# call history for accounts under review.
# ----------------------------------------------------------------------
try:
    from livekit import api as livekit_api  # noqa: F401  (loaded lazily below)
    _LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "").strip()
    _LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "").strip()
    _LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "").strip()
    _LIVEKIT_OK = bool(_LIVEKIT_URL and _LIVEKIT_API_KEY and _LIVEKIT_API_SECRET)
    if not _LIVEKIT_OK:
        logging.warning("LiveKit env vars missing — voice/video calls disabled.")
except Exception as _e:
    _LIVEKIT_OK = False
    logging.warning("LiveKit SDK not available: %s", _e)


def _mint_livekit_token(room_name: str, identity: str, display_name: str, ttl_seconds: int = 60 * 60) -> str:
    """Mint a JWT scoped to one room. TTL defaults to 1h — long enough for
    a normal call but short enough that a leaked token can't be reused
    days later."""
    from livekit import api as _lk
    from datetime import timedelta as _td
    at = _lk.AccessToken(_LIVEKIT_API_KEY, _LIVEKIT_API_SECRET)
    at = at.with_identity(identity).with_name(display_name).with_ttl(_td(seconds=ttl_seconds))
    at = at.with_grants(_lk.VideoGrants(
        room_join=True, room=room_name,
        can_publish=True, can_subscribe=True, can_publish_data=True,
    ))
    return at.to_jwt()


class CallStartIn(BaseModel):
    callee_id: str = Field(min_length=1)
    kind: str = Field(default="video", pattern="^(audio|video)$")


@api.post("/calls/start")
async def call_start(payload: CallStartIn, user=Depends(get_current_user)):
    """Caller initiates a 1-on-1 call. Re-uses the existing DM tier-gating —
    if the caller can't DM the callee, they can't call them either."""
    if not _LIVEKIT_OK:
        raise HTTPException(503, "Calling is not configured on this server")
    if payload.callee_id == user["user_id"]:
        raise HTTPException(400, "Cannot call yourself")
    callee = await db.users.find_one({"user_id": payload.callee_id}, {"_id": 0})
    if not callee:
        raise HTTPException(404, "User not found")
    # Re-use the DM permission check — same trust gates apply.
    allow, reason = await can_dm(user, callee)
    if not allow:
        raise HTTPException(403, reason or "Cannot call this user")

    call_id = f"call_{uuid.uuid4().hex[:12]}"
    room_name = f"room_{uuid.uuid4().hex[:14]}"
    now = now_iso()
    await db.calls.insert_one({
        "call_id": call_id, "room_name": room_name,
        "caller_id": user["user_id"], "callee_id": payload.callee_id,
        "kind": payload.kind, "status": "ringing",
        "created_at": now, "ended_at": None,
    })
    await db.audit_events.insert_one({
        "event": "call_start", "call_id": call_id, "caller_id": user["user_id"],
        "callee_id": payload.callee_id, "kind": payload.kind, "at": now,
    })
    token = _mint_livekit_token(room_name, user["user_id"], user.get("display_name") or user["handle"])
    # Wake the callee's phone with a push so they hear/see the ring even
    # when ClanChat is backgrounded. The Capacitor APK handles the
    # `incoming_call` data payload by showing a fullscreen ringer.
    try:
        await fcm_push(
            payload.callee_id,
            f"Incoming {payload.kind} call",
            f"#{user.get('handle', 'someone')} is calling",
            data={"type": "incoming_call", "call_id": call_id, "kind": payload.kind,
                  "caller_id": user["user_id"], "caller_handle": user.get("handle", "")},
            notif_type="calls",
        )
    except Exception as _e:
        logging.warning("call push failed: %s", _e)
    return {
        "call_id": call_id, "room_name": room_name, "kind": payload.kind,
        "livekit_url": _LIVEKIT_URL, "token": token,
    }


@api.get("/calls/incoming")
async def calls_incoming(user=Depends(get_current_user)):
    """Recipient poll. Returns at most one ringing call so we never overwhelm
    the UI — calls auto-time-out after 60s if untouched."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    # Auto-expire stale rings without admin intervention.
    await db.calls.update_many(
        {"status": "ringing", "created_at": {"$lt": cutoff}},
        {"$set": {"status": "missed", "ended_at": now_iso()}},
    )
    c = await db.calls.find_one(
        {"callee_id": user["user_id"], "status": "ringing"},
        {"_id": 0}, sort=[("created_at", -1)],
    )
    if not c:
        return {"call": None}
    caller = await db.users.find_one({"user_id": c["caller_id"]}, {"_id": 0})
    return {"call": {**c, "caller": public_user(caller) if caller else None}}


@api.post("/calls/{call_id}/answer")
async def call_answer(call_id: str, user=Depends(get_current_user)):
    if not _LIVEKIT_OK:
        raise HTTPException(503, "Calling is not configured on this server")
    c = await db.calls.find_one({"call_id": call_id}, {"_id": 0})
    if not c or c["callee_id"] != user["user_id"]:
        raise HTTPException(404, "Call not found")
    if c["status"] != "ringing":
        raise HTTPException(409, f"Call is already {c['status']}")
    await db.calls.update_one({"call_id": call_id}, {"$set": {"status": "active", "answered_at": now_iso()}})
    token = _mint_livekit_token(c["room_name"], user["user_id"], user.get("display_name") or user["handle"])
    return {
        "call_id": call_id, "room_name": c["room_name"], "kind": c.get("kind", "video"),
        "livekit_url": _LIVEKIT_URL, "token": token,
    }


@api.post("/calls/{call_id}/reject")
async def call_reject(call_id: str, user=Depends(get_current_user)):
    c = await db.calls.find_one({"call_id": call_id}, {"_id": 0})
    if not c or c["callee_id"] != user["user_id"]:
        raise HTTPException(404, "Call not found")
    await db.calls.update_one({"call_id": call_id}, {"$set": {"status": "rejected", "ended_at": now_iso()}})
    return {"ok": True}


@api.post("/calls/{call_id}/end")
async def call_end(call_id: str, user=Depends(get_current_user)):
    c = await db.calls.find_one({"call_id": call_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Call not found")
    if user["user_id"] not in (c["caller_id"], c["callee_id"]):
        raise HTTPException(403, "Not a participant")
    if c["status"] not in ("ended", "rejected", "missed"):
        await db.calls.update_one({"call_id": call_id}, {"$set": {"status": "ended", "ended_at": now_iso()}})
        await db.audit_events.insert_one({
            "event": "call_end", "call_id": call_id, "ended_by": user["user_id"], "at": now_iso(),
        })
    return {"ok": True}


# ----------------------------------------------------------------------


# include
# ----------------------------------------------------------------------
# Push notification endpoints (live here so they're declared after
# get_current_user). See the FCM init block near the top of the file
# for the actual sender helper.
# ----------------------------------------------------------------------
@api.post("/notifications/register-device")
async def register_device(payload: DeviceTokenIn, user=Depends(get_current_user)):
    """Called by the APK after the OS hands us a push token. Idempotent.
    A given token can only ever belong to one ClanChat account at a time —
    re-registering steals it from any previously-signed-in user, which
    is what happens when two people share a phone."""
    await db.device_tokens.delete_many({"token": payload.token})
    await db.device_tokens.update_one(
        {"user_id": user["user_id"], "token": payload.token},
        {"$set": {"platform": payload.platform, "last_seen": now_iso()},
         "$setOnInsert": {"user_id": user["user_id"], "token": payload.token, "created_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/notifications/unregister-device")
async def unregister_device(payload: DeviceTokenIn, user=Depends(get_current_user)):
    """Called on logout. Silently no-ops if the token isn't ours."""
    await db.device_tokens.delete_one({"user_id": user["user_id"], "token": payload.token})
    return {"ok": True}


@api.post("/notifications/prefs")
async def update_push_prefs(payload: PushPrefsIn, user=Depends(get_current_user)):
    """Per-category toggles. Default is all-on so users get the
    safety-relevant pushes without explicit setup."""
    current = user.get("push_prefs", {}) or {}
    for k in ("dms", "calls", "follows", "inner_invites"):
        v = getattr(payload, k)
        if v is not None:
            current[k] = bool(v)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"push_prefs": current}})
    return {"prefs": current}


@api.get("/notifications/prefs")
async def get_push_prefs(user=Depends(get_current_user)):
    return {"prefs": user.get("push_prefs", {})}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "*")],
    # Allow Emergent preview URLs and the Capacitor APK WebView origins.
    # On Android the bundled APK serves from `https://localhost` (set by
    # `androidScheme: "https"` in capacitor.config.js); the older capacitor
    # scheme `capacitor://localhost` is kept for safety.
    allow_origin_regex=r"https://.*\.preview\.emergentagent\.com|https://localhost(:\d+)?|capacitor://localhost",
    allow_methods=["*"], allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
