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


def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("session_token", path="/")


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
    }


def private_user(u: dict) -> dict:
    return {
        **public_user(u),
        "email": u.get("email"),
        "dob": u.get("dob"),
        "auth_provider": u.get("auth_provider", "password"),
        "settings": u.get("settings", default_settings()),
        "role": u.get("role", "user"),
    }


def default_settings() -> dict:
    return {
        "theme": "dark",
        "dms_enabled_followers": False,  # T2 DMs default off
        "wall_post_permission": "owner",  # owner | followers | inner
        "comfort_zone": {
            "nsfw": False,
            "ai_content": True,
            "strong_language": True,
            "violence": False,
            "self_harm": False,
            "gore": False,
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
    nsfw: bool = False


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
    content: str = Field(min_length=1, max_length=2000)


class ProfileUpdateIn(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = Field(default=None, max_length=150)
    avatar_path: Optional[str] = None
    links: Optional[List[dict]] = None  # [{label, url}]
    follow_mode: Optional[str] = None  # open | approval
    settings: Optional[dict] = None


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
    return {"user": private_user(user), "new_user": new_user}


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
        update["links"] = [{"label": (l.get("label") or "")[:30], "url": (l.get("url") or "")[:200]}
                           for l in payload.links[:10]]
    if payload.follow_mode in ("open", "approval"):
        update["follow_mode"] = payload.follow_mode
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
    # adult cannot find minor in search/profile if not following
    if viewer:
        if target.get("is_minor") and not is_minor(viewer):
            rel = await relation(viewer["user_id"], target["user_id"])
            if not rel["self"] and not rel["follows"] and not rel["inner"]:
                raise HTTPException(404, "Not found")
        if is_minor(viewer) and target.get("nsfw_account"):
            raise HTTPException(404, "Not found")
    rel = await relation(viewer["user_id"], target["user_id"]) if viewer else {"self": False, "follows": False, "inner": False, "follow_pending": False}
    return {"user": public_user(target), "relation": rel}


@api.get("/users/search")
async def search_users(q: str = Query(..., min_length=1), viewer=Depends(get_current_user)):
    q = q.strip().lower().lstrip("#")
    if not re.fullmatch(r"[a-z0-9_]{1,20}", q):
        return {"results": []}
    cursor = db.users.find({"handle": {"$regex": f"^{re.escape(q)}"}}, {"_id": 0}).limit(20)
    results = []
    async for u in cursor:
        if u["user_id"] == viewer["user_id"]:
            results.append(public_user(u))
            continue
        if u.get("is_minor") and not is_minor(viewer):
            rel = await relation(viewer["user_id"], u["user_id"])
            if not rel["follows"] and not rel["inner"]:
                continue
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
    return {"status": status}


@api.delete("/follow/{target_id}")
async def unfollow(target_id: str, user=Depends(get_current_user)):
    await db.follows.delete_one({"follower_id": user["user_id"], "followee_id": target_id})
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
    return {
        "post_id": post["post_id"],
        "author": public_user(author) if author else None,
        "content": post["content"],
        "tier": post["tier"],
        "tags": post.get("tags", []),
        "media": post.get("media_paths", []),
        "is_ai": post.get("is_ai", False),
        "nsfw": post.get("nsfw", False),
        "like_count": post.get("like_count", 0),
        "liked": liked,
        "created_at": post["created_at"],
        "pinned": post.get("pinned", False),
    }


@api.post("/posts")
async def create_post(payload: PostIn, user=Depends(get_current_user)):
    if payload.tier not in TIERS:
        raise HTTPException(400, "Invalid tier")
    if payload.tier == "public" and payload.nsfw:
        raise HTTPException(400, "Tier 1 (Public) posts cannot contain 18+ content")
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
        "is_ai": payload.is_ai,
        "nsfw": payload.nsfw and payload.tier != "public",
        "like_count": 0,
        "pinned": False,
        "created_at": now_iso(),
    }
    await db.posts.insert_one(post)
    return await serialize_post(post, user)


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

    # comfort zone filtering
    cz = user.get("settings", {}).get("comfort_zone", {})
    if not cz.get("nsfw", False):
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
    cursor = db.posts.find({"author_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(100)
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
    return doc


@api.get("/wall/{owner_id}")
async def get_wall(owner_id: str, viewer=Depends(get_current_user)):
    cursor = db.wall_posts.find({"owner_id": owner_id}, {"_id": 0}).sort("created_at", -1).limit(100)
    out = []
    async for w in cursor:
        u = await db.users.find_one({"user_id": w["author_id"]}, {"_id": 0})
        out.append({**w, "author": public_user(u) if u else None})
    return {"posts": out}


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
    recipient = await db.users.find_one({"user_id": payload.recipient_id}, {"_id": 0})
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    ok, reason = await can_dm(user, recipient)
    if not ok:
        raise HTTPException(403, reason)
    mid = f"dm_{uuid.uuid4().hex[:10]}"
    doc = {
        "message_id": mid, "from_id": user["user_id"], "to_id": payload.recipient_id,
        "content": payload.content.strip()[:2000], "created_at": now_iso(), "read": False,
    }
    await db.dms.insert_one(doc)
    return doc


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
    async for t in cursor:
        other_id = t["_id"]
        other = await db.users.find_one({"user_id": other_id}, {"_id": 0})
        if not other:
            continue
        threads.append({
            "with": public_user(other),
            "last": {k: v for k, v in t["last_message"].items() if k != "_id"},
        })
    return {"threads": threads}


@api.get("/dms/with/{other_id}")
async def dm_history(other_id: str, user=Depends(get_current_user)):
    cursor = db.dms.find({
        "$or": [
            {"from_id": user["user_id"], "to_id": other_id},
            {"from_id": other_id, "to_id": user["user_id"]},
        ]
    }, {"_id": 0}).sort("created_at", 1).limit(500)
    msgs = []
    async for m in cursor:
        msgs.append(m)
    other = await db.users.find_one({"user_id": other_id}, {"_id": 0})
    ok, reason = (False, "")
    if other:
        ok, reason = await can_dm(user, other)
    return {"messages": msgs, "with": public_user(other) if other else None, "can_send": ok, "reason": reason}


# ------------------------------------------------------------------
# Block / Mute / Report
# ------------------------------------------------------------------
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
    return {"report_id": rid}


# ------------------------------------------------------------------
# Upload
# ------------------------------------------------------------------
@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename.split(".")[-1] if file.filename and "." in file.filename else "bin").lower()
    if ext not in {"jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov"}:
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
    fr = await db.follows.count_documents({"followee_id": user["user_id"], "status": "pending"})
    inv = await db.inner_circle.count_documents({"member_id": user["user_id"], "status": "pending"})
    unread = await db.dms.count_documents({"to_id": user["user_id"], "read": False})
    return {"follow_requests": fr, "inner_invites": inv, "unread_dms": unread}


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
    await seed_demo()
    init_storage()


@app.on_event("shutdown")
async def shutdown_event():
    client.close()


# include
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "*")],
    allow_origin_regex=r"https://.*\.preview\.emergentagent\.com",
    allow_methods=["*"], allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
