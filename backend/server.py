import os
import re
import uuid
import time
import base64
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File,
    WebSocket, WebSocketDisconnect,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from livekit import api as lk_api

load_dotenv('/app/.env')
logging.basicConfig(level=logging.INFO)
log = logging.getLogger('clanchat')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ.get('DB_NAME', 'clanchat')
JWT_SECRET = os.environ['SUPABASE_JWT_SECRET']
SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_ROLE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
BUCKET = os.environ.get('SUPABASE_BUCKET', 'clanchat-media')
DM_KEY = base64.b64decode(os.environ['DM_ENC_KEY'])
LIVEKIT_URL = os.environ.get('LIVEKIT_URL', '')
LIVEKIT_API_KEY = os.environ.get('LIVEKIT_API_KEY', '')
LIVEKIT_API_SECRET = os.environ.get('LIVEKIT_API_SECRET', '')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title='ClanChat API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=False,
                   allow_methods=['*'], allow_headers=['*'])
security = HTTPBearer(auto_error=False)

TIERS = {'public', 'followers', 'inner'}


# ----------------------------- Encryption -----------------------------

def enc(text: str) -> str:
    n = os.urandom(12)
    ct = AESGCM(DM_KEY).encrypt(n, text.encode(), None)
    return base64.b64encode(n + ct).decode()

def dec(blob: str) -> str:
    try:
        raw = base64.b64decode(blob)
        return AESGCM(DM_KEY).decrypt(raw[:12], raw[12:], None).decode()
    except Exception:
        return ''


# ----------------------------- Auth -----------------------------

def decode_jwt(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=['HS256'], audience='authenticated',
                      options={'verify_signature': True, 'verify_exp': True,
                               'verify_aud': True, 'require': ['exp', 'sub']})

def slugify_handle(name: str) -> str:
    base = re.sub(r'[^a-z0-9]', '', (name or 'member').lower())[:20] or 'member'
    return base

async def ensure_profile(sub: str, email: Optional[str], name: Optional[str],
                         avatar: Optional[str]) -> dict:
    prof = await db.profiles.find_one({'id': sub}, {'_id': 0})
    if prof:
        return prof
    display = name or (email.split('@')[0] if email else 'Member')
    base = slugify_handle(display)
    handle = base
    i = 0
    while await db.profiles.find_one({'handle': handle}):
        i += 1
        handle = f'{base}{i}'
    prof = {
        'id': sub, 'handle': handle, 'display_name': display, 'real_name': None,
        'email': email, 'bio': '', 'links': [], 'avatar_url': avatar,
        'account_type': 'standard', 'follow_mode': 'open', 'dm_open': True,
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    await db.profiles.insert_one(dict(prof))
    return prof

async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if creds is None or (creds.scheme or '').lower() != 'bearer':
        raise HTTPException(401, 'Missing Bearer token')
    try:
        c = decode_jwt(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, 'Token expired')
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f'Invalid token: {e}')
    meta = c.get('user_metadata') or {}
    return await ensure_profile(c['sub'], c.get('email'),
                                c.get('name') or meta.get('name') or meta.get('full_name'),
                                c.get('avatar_url') or meta.get('avatar_url'))


# ----------------------------- Relationship helpers -----------------------------

async def is_follower(viewer: str, author: str) -> bool:
    return bool(await db.follows.find_one({'follower_id': viewer, 'target_id': author, 'status': 'approved'}))

async def in_inner(owner: str, member: str) -> bool:
    return bool(await db.inner.find_one({'owner_id': owner, 'member_id': member, 'status': 'accepted'}))

async def can_view(viewer: str, post: dict) -> bool:
    if post['author_id'] == viewer:
        return True
    t = post['tier']
    if t == 'public':
        return True
    if t == 'followers':
        return await is_follower(viewer, post['author_id'])
    if t == 'inner':
        return await in_inner(post['author_id'], viewer)
    return False

async def can_dm(viewer: str, target: str) -> bool:
    if viewer == target:
        return False
    if await in_inner(target, viewer) or await in_inner(viewer, target):
        return True  # Tier 3 both directions
    tp = await db.profiles.find_one({'id': target})
    if tp and tp.get('dm_open') and await is_follower(viewer, target):
        return True  # Tier 2 optional toggle
    return False

async def add_activity(user_id: str, typ: str, actor: dict, text: str, post_id=None):
    await db.activity.insert_one({
        'id': str(uuid.uuid4()), 'user_id': user_id, 'type': typ,
        'actor_handle': actor['handle'], 'actor_name': actor['display_name'],
        'actor_id': actor['id'], 'text': text, 'post_id': post_id,
        'created_at': datetime.now(timezone.utc).isoformat(), 'read': False,
    })


# ----------------------------- Serializers -----------------------------

async def public_profile(prof: dict, viewer_id: str) -> dict:
    is_self = prof['id'] == viewer_id
    following = await db.follows.find_one({'follower_id': viewer_id, 'target_id': prof['id']})
    inv = await db.inner.find_one({'owner_id': prof['id'], 'member_id': viewer_id})
    followers_count = await db.follows.count_documents({'target_id': prof['id'], 'status': 'approved'})
    out = {
        'id': prof['id'], 'handle': prof['handle'], 'display_name': prof['display_name'],
        'bio': prof.get('bio', ''), 'links': prof.get('links', []),
        'avatar_url': prof.get('avatar_url'), 'account_type': prof.get('account_type', 'standard'),
        'follow_mode': prof.get('follow_mode', 'open'), 'dm_open': prof.get('dm_open', True),
        'is_self': is_self,
        'follow_status': following['status'] if following else None,
        'inner_status': inv['status'] if inv else None,
        'in_inner': bool(inv and inv['status'] == 'accepted'),
        'can_dm': await can_dm(viewer_id, prof['id']) if not is_self else False,
    }
    if is_self:
        out['real_name'] = prof.get('real_name')
        out['email'] = prof.get('email')
        out['followers_count'] = followers_count  # private: owner only
    return out

async def post_out(p: dict, viewer_id: str) -> dict:
    author = await db.profiles.find_one({'id': p['author_id']}, {'_id': 0})
    liked = viewer_id in p.get('likes', [])
    return {
        'id': p['id'], 'tier': p['tier'], 'text': p.get('text', ''),
        'media_url': p.get('media_url'), 'media_type': p.get('media_type'),
        'tags': p.get('tags', []), 'created_at': p['created_at'],
        'like_count': len(p.get('likes', [])), 'liked': liked,
        'likeable': p['tier'] == 'public',
        'author': {'id': author['id'], 'handle': author['handle'],
                   'display_name': author['display_name'], 'avatar_url': author.get('avatar_url'),
                   'account_type': author.get('account_type', 'standard')} if author else None,
        'is_mine': p['author_id'] == viewer_id,
    }


# ----------------------------- Models -----------------------------

class DevLogin(BaseModel):
    name: Optional[str] = 'Guest'
    email: Optional[str] = None

class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    links: Optional[list] = None
    follow_mode: Optional[str] = None
    dm_open: Optional[bool] = None
    avatar_url: Optional[str] = None

class PostCreate(BaseModel):
    tier: str = 'public'
    text: Optional[str] = ''
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    tags: Optional[list] = None

class DMSend(BaseModel):
    text: str

class TokenReq(BaseModel):
    room: str


# ----------------------------- WS manager -----------------------------

class Manager:
    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = {}
    async def connect(self, room: str, ws: WebSocket):
        await ws.accept(); self.rooms.setdefault(room, set()).add(ws)
    def disconnect(self, room: str, ws: WebSocket):
        self.rooms.get(room, set()).discard(ws)
    async def broadcast(self, room: str, data: dict):
        for ws in list(self.rooms.get(room, set())):
            try: await ws.send_json(data)
            except Exception: self.disconnect(room, ws)

manager = Manager()

def dm_room(a: str, b: str) -> str:
    return 'dm:' + ':'.join(sorted([a, b]))


# ----------------------------- Storage -----------------------------

def admin_headers():
    return {'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'}

async def ensure_bucket():
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f'{SUPABASE_URL}/storage/v1/bucket',
                         headers={**admin_headers(), 'Content-Type': 'application/json'},
                         json={'id': BUCKET, 'name': BUCKET, 'public': False,
                               'file_size_limit': 50 * 1024 * 1024,
                               'allowed_mime_types': ['image/*', 'video/*', 'audio/*']})
        log.info('ensure_bucket %s', r.status_code)

async def upload_and_sign(path: str, content: bytes, content_type: str,
                          expires_in: int = 60 * 60 * 24 * 30) -> str:
    async with httpx.AsyncClient(timeout=120) as c:
        up = await c.post(f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}',
                          headers={**admin_headers(), 'Content-Type': content_type, 'x-upsert': 'true'},
                          content=content)
        up.raise_for_status()
        s = await c.post(f'{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{path}',
                         headers={**admin_headers(), 'Content-Type': 'application/json'},
                         json={'expiresIn': expires_in})
        s.raise_for_status()
        url = s.json()['signedURL']
    return url if url.startswith('http') else f'{SUPABASE_URL}/storage/v1{url}'


# ----------------------------- Startup seed -----------------------------

@app.on_event('startup')
async def startup():
    sys_id = 'system-clanchat'
    if not await db.profiles.find_one({'id': sys_id}):
        await db.profiles.insert_one({
            'id': sys_id, 'handle': 'clanchat', 'display_name': 'ClanChat',
            'real_name': None, 'email': None, 'bio': 'Your Personal Clubhouse. Your circle. Your rules. No bullshit.',
            'links': ['clanchat.app'], 'avatar_url': None, 'account_type': 'verified',
            'follow_mode': 'open', 'dm_open': False,
            'created_at': datetime.now(timezone.utc).isoformat()})
        for txt, tags in [
            ('Welcome to ClanChat — the responsible adult social network. No algorithm. No ads in your feed. Just your people.', ['welcome', 'clanchat']),
            ('Three tiers, one clubhouse: Public, Followers, and your Inner Circle. You decide who sees what.', ['privacy', 'tiers']),
        ]:
            await db.posts.insert_one({
                'id': str(uuid.uuid4()), 'author_id': sys_id, 'tier': 'public',
                'text': txt, 'media_url': None, 'media_type': None, 'tags': tags,
                'likes': [], 'created_at': datetime.now(timezone.utc).isoformat()})
    try:
        await ensure_bucket()
    except Exception as e:
        log.warning('bucket: %s', e)


# ----------------------------- Auth routes -----------------------------

@app.get('/api/')
async def root():
    return {'ok': True, 'service': 'clanchat', 'time': datetime.now(timezone.utc).isoformat()}

@app.post('/api/dev/token')
async def dev_token(body: DevLogin):
    name = (body.name or 'Guest').strip() or 'Guest'
    email = (body.email or f"{slugify_handle(name)}@sandbox.clanchat").strip()
    uid = str(uuid.uuid5(uuid.NAMESPACE_DNS, email))
    now = int(time.time())
    token = jwt.encode({'sub': uid, 'email': email, 'aud': 'authenticated',
                        'role': 'authenticated', 'iss': 'clanchat-dev', 'iat': now,
                        'exp': now + 60 * 60 * 24 * 7, 'user_metadata': {'name': name}},
                       JWT_SECRET, algorithm='HS256')
    prof = await ensure_profile(uid, email, name, None)
    return {'access_token': token, 'token_type': 'bearer',
            'user': {'id': uid, 'handle': prof['handle'], 'display_name': prof['display_name'], 'email': email}}

@app.get('/api/me')
async def me(u: dict = Depends(get_current_user)):
    return await public_profile(u, u['id'])

@app.put('/api/profile')
async def update_profile(body: ProfileUpdate, u: dict = Depends(get_current_user)):
    upd = {k: v for k, v in body.dict().items() if v is not None}
    if 'follow_mode' in upd and upd['follow_mode'] not in ('open', 'approval'):
        upd.pop('follow_mode')
    if upd:
        await db.profiles.update_one({'id': u['id']}, {'$set': upd})
    prof = await db.profiles.find_one({'id': u['id']}, {'_id': 0})
    return await public_profile(prof, u['id'])


# ----------------------------- Profiles / social graph -----------------------------

@app.get('/api/users/{handle}')
async def get_user(handle: str, u: dict = Depends(get_current_user)):
    prof = await db.profiles.find_one({'handle': handle}, {'_id': 0})
    if not prof:
        raise HTTPException(404, 'User not found')
    return await public_profile(prof, u['id'])

@app.get('/api/users/{handle}/posts')
async def user_posts(handle: str, u: dict = Depends(get_current_user)):
    prof = await db.profiles.find_one({'handle': handle})
    if not prof:
        raise HTTPException(404, 'User not found')
    out = []
    async for p in db.posts.find({'author_id': prof['id']}).sort('created_at', -1).limit(100):
        if await can_view(u['id'], p):
            out.append(await post_out(p, u['id']))
    return out

@app.post('/api/follow/{handle}')
async def follow(handle: str, u: dict = Depends(get_current_user)):
    target = await db.profiles.find_one({'handle': handle})
    if not target or target['id'] == u['id']:
        raise HTTPException(400, 'Cannot follow')
    status = 'approved' if target.get('follow_mode', 'open') == 'open' else 'pending'
    await db.follows.update_one({'follower_id': u['id'], 'target_id': target['id']},
                                {'$set': {'status': status,
                                          'created_at': datetime.now(timezone.utc).isoformat()}},
                                upsert=True)
    await add_activity(target['id'], 'follow_request' if status == 'pending' else 'follow',
                       u, 'requested to follow you' if status == 'pending' else 'started following you')
    return {'status': status}

@app.delete('/api/follow/{handle}')
async def unfollow(handle: str, u: dict = Depends(get_current_user)):
    target = await db.profiles.find_one({'handle': handle})
    if target:
        await db.follows.delete_one({'follower_id': u['id'], 'target_id': target['id']})
    return {'status': 'none'}

@app.post('/api/follow-requests/{handle}/accept')
async def accept_follow(handle: str, u: dict = Depends(get_current_user)):
    fol = await db.profiles.find_one({'handle': handle})
    if not fol:
        raise HTTPException(404, 'Not found')
    await db.follows.update_one({'follower_id': fol['id'], 'target_id': u['id']},
                                {'$set': {'status': 'approved'}})
    await add_activity(fol['id'], 'follow_accepted', u, 'accepted your follow request')
    return {'status': 'approved'}

@app.post('/api/inner/invite/{handle}')
async def invite_inner(handle: str, u: dict = Depends(get_current_user)):
    member = await db.profiles.find_one({'handle': handle})
    if not member or member['id'] == u['id']:
        raise HTTPException(400, 'Cannot invite')
    await db.inner.update_one({'owner_id': u['id'], 'member_id': member['id']},
                              {'$set': {'status': 'pending',
                                        'created_at': datetime.now(timezone.utc).isoformat()}},
                              upsert=True)
    await add_activity(member['id'], 'inner_invite', u, 'invited you to their Inner Circle')
    return {'status': 'pending'}

@app.post('/api/inner/accept/{handle}')
async def accept_inner(handle: str, u: dict = Depends(get_current_user)):
    owner = await db.profiles.find_one({'handle': handle})
    if not owner:
        raise HTTPException(404, 'Not found')
    await db.inner.update_one({'owner_id': owner['id'], 'member_id': u['id']},
                              {'$set': {'status': 'accepted'}})
    await add_activity(owner['id'], 'inner_accepted', u, 'joined your Inner Circle')
    return {'status': 'accepted'}

@app.get('/api/inner')
async def my_inner(u: dict = Depends(get_current_user)):
    out = []
    async for r in db.inner.find({'owner_id': u['id'], 'status': 'accepted'}):
        p = await db.profiles.find_one({'id': r['member_id']}, {'_id': 0})
        if p: out.append(await public_profile(p, u['id']))
    return out


# ----------------------------- Feed / posts -----------------------------

@app.get('/api/feed')
async def feed(scope: str = 'general', u: dict = Depends(get_current_user)):
    author_filter = None
    if scope == 'followers':
        ids = [f['target_id'] async for f in db.follows.find({'follower_id': u['id'], 'status': 'approved'})]
        ids.append(u['id'])
        author_filter = {'author_id': {'$in': ids}}
    q = author_filter or {}
    out = []
    async for p in db.posts.find(q).sort('created_at', -1).limit(150):
        if await can_view(u['id'], p):
            out.append(await post_out(p, u['id']))
        if len(out) >= 60:
            break
    return out

@app.post('/api/posts')
async def create_post(body: PostCreate, u: dict = Depends(get_current_user)):
    tier = body.tier if body.tier in TIERS else 'public'
    text = (body.text or '').strip()
    if not text and not body.media_url:
        raise HTTPException(400, 'Empty post')
    tags = [re.sub(r'[^a-z0-9]', '', t.lower())[:20] for t in (body.tags or [])]
    tags = [t for t in tags if t][:10]
    if tier == 'inner':
        tags = []  # spec: no tag field on Tier 3
    doc = {'id': str(uuid.uuid4()), 'author_id': u['id'], 'tier': tier, 'text': text,
           'media_url': body.media_url, 'media_type': body.media_type, 'tags': tags,
           'likes': [], 'created_at': datetime.now(timezone.utc).isoformat()}
    await db.posts.insert_one(dict(doc))
    return await post_out(doc, u['id'])

@app.delete('/api/posts/{post_id}')
async def delete_post(post_id: str, u: dict = Depends(get_current_user)):
    await db.posts.delete_one({'id': post_id, 'author_id': u['id']})
    return {'deleted': True}

@app.post('/api/posts/{post_id}/like')
async def like_post(post_id: str, u: dict = Depends(get_current_user)):
    p = await db.posts.find_one({'id': post_id})
    if not p:
        raise HTTPException(404, 'Post not found')
    if p['tier'] != 'public':
        raise HTTPException(400, 'Only public posts can be liked')
    if not await can_view(u['id'], p):
        raise HTTPException(403, 'Cannot view')
    liked = u['id'] in p.get('likes', [])
    op = '$pull' if liked else '$addToSet'
    await db.posts.update_one({'id': post_id}, {op: {'likes': u['id']}})
    if not liked and p['author_id'] != u['id']:
        author = await db.profiles.find_one({'id': p['author_id']})
        await add_activity(p['author_id'], 'like', u, 'liked your post', post_id)
    p = await db.posts.find_one({'id': post_id})
    return {'liked': not liked, 'like_count': len(p.get('likes', []))}


# ----------------------------- Search / trending -----------------------------

@app.get('/api/trending')
async def trending(u: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    counts: dict[str, int] = {}
    async for p in db.posts.find({'tier': 'public', 'created_at': {'$gte': since}}):
        for t in p.get('tags', []):
            counts[t] = counts.get(t, 0) + 1
    top = sorted(counts.items(), key=lambda x: -x[1])[:10]
    return [{'tag': t, 'count': c} for t, c in top]

@app.get('/api/search')
async def search(q: str = '', u: dict = Depends(get_current_user)):
    q = q.strip().lstrip('#').lower()
    users, posts = [], []
    if q:
        async for p in db.profiles.find({'$or': [
            {'handle': {'$regex': q, '$options': 'i'}},
            {'display_name': {'$regex': q, '$options': 'i'}}]}).limit(15):
            if p['id'] != 'system-clanchat' or True:
                users.append(await public_profile(await db.profiles.find_one({'id': p['id']}, {'_id': 0}), u['id']))
        async for p in db.posts.find({'tier': 'public', 'tags': q}).sort('created_at', -1).limit(30):
            posts.append(await post_out(p, u['id']))
    return {'users': users, 'posts': posts}


# ----------------------------- DMs (encrypted) -----------------------------

@app.get('/api/dms')
async def dm_threads(u: dict = Depends(get_current_user)):
    seen = {}
    async for m in db.dms.find({'participants': u['id']}).sort('created_at', -1).limit(400):
        other = [p for p in m['participants'] if p != u['id']]
        oid = other[0] if other else u['id']
        if oid in seen:
            continue
        prof = await db.profiles.find_one({'id': oid}, {'_id': 0})
        if not prof:
            continue
        seen[oid] = {'user': {'id': prof['id'], 'handle': prof['handle'],
                              'display_name': prof['display_name'], 'avatar_url': prof.get('avatar_url')},
                     'last': dec(m['content_enc'])[:80], 'created_at': m['created_at'],
                     'mine': m['sender_id'] == u['id']}
    return list(seen.values())

@app.get('/api/dms/{handle}')
async def dm_history(handle: str, u: dict = Depends(get_current_user)):
    other = await db.profiles.find_one({'handle': handle})
    if not other:
        raise HTTPException(404, 'User not found')
    room = dm_room(u['id'], other['id'])
    out = []
    async for m in db.dms.find({'room': room}).sort('created_at', 1).limit(300):
        out.append({'id': m['id'], 'sender_id': m['sender_id'], 'text': dec(m['content_enc']),
                    'created_at': m['created_at'], 'mine': m['sender_id'] == u['id']})
    return {'peer': {'id': other['id'], 'handle': other['handle'],
                     'display_name': other['display_name'], 'avatar_url': other.get('avatar_url')},
            'can_dm': await can_dm(u['id'], other['id']), 'messages': out}

@app.post('/api/dms/{handle}')
async def dm_send(handle: str, body: DMSend, u: dict = Depends(get_current_user)):
    other = await db.profiles.find_one({'handle': handle})
    if not other:
        raise HTTPException(404, 'User not found')
    if not await can_dm(u['id'], other['id']):
        raise HTTPException(403, 'DMs not allowed with this user (tier-gated)')
    text = body.text.strip()
    if not text:
        raise HTTPException(400, 'Empty message')
    room = dm_room(u['id'], other['id'])
    doc = {'id': str(uuid.uuid4()), 'room': room, 'participants': [u['id'], other['id']],
           'sender_id': u['id'], 'content_enc': enc(text),
           'created_at': datetime.now(timezone.utc).isoformat()}
    await db.dms.insert_one(dict(doc))
    payload = {'type': 'dm', 'message': {'id': doc['id'], 'sender_id': u['id'],
               'text': text, 'created_at': doc['created_at']}}
    await manager.broadcast(room, payload)
    return {'id': doc['id'], 'sender_id': u['id'], 'text': text, 'created_at': doc['created_at'], 'mine': True}


# ----------------------------- Activity -----------------------------

@app.get('/api/activity')
async def activity(u: dict = Depends(get_current_user)):
    out = []
    async for a in db.activity.find({'user_id': u['id']}, {'_id': 0}).sort('created_at', -1).limit(50):
        out.append(a)
    return out

@app.get('/api/follow-requests')
async def follow_requests(u: dict = Depends(get_current_user)):
    out = []
    async for f in db.follows.find({'target_id': u['id'], 'status': 'pending'}):
        p = await db.profiles.find_one({'id': f['follower_id']}, {'_id': 0})
        if p: out.append({'handle': p['handle'], 'display_name': p['display_name'], 'avatar_url': p.get('avatar_url')})
    return out


# ----------------------------- Storage -----------------------------

@app.post('/api/upload')
async def upload(u: dict = Depends(get_current_user), file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, 'File too large (max 50MB)')
    ext = (file.filename or 'file').split('.')[-1][:8]
    path = f"{u['id']}/{uuid.uuid4().hex}.{ext}"
    url = await upload_and_sign(path, data, file.content_type or 'application/octet-stream')
    return {'path': path, 'signed_url': url,
            'media_type': (file.content_type or '').split('/')[0]}


# ----------------------------- LiveKit -----------------------------

@app.post('/api/livekit/token')
async def livekit_token(body: TokenReq, u: dict = Depends(get_current_user)):
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(500, 'LiveKit not configured')
    room = re.sub(r'[^A-Za-z0-9_:-]', '', body.room)[:128] or f"room-{u['id']}"
    token = (lk_api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
             .with_identity(u['id']).with_name(f"#{u['handle']}")
             .with_ttl(timedelta(minutes=15))
             .with_grants(lk_api.VideoGrants(room_join=True, room=room,
                                             can_publish=True, can_subscribe=True)))
    return {'server_url': LIVEKIT_URL, 'participant_token': token.to_jwt(), 'room': room}


# ----------------------------- WebSocket (DM realtime) -----------------------------

@app.websocket('/api/ws/dm/{handle}')
async def ws_dm(ws: WebSocket, handle: str):
    token = ws.query_params.get('token')
    try:
        claims = decode_jwt(token) if token else None
        me_id = claims['sub']
    except Exception:
        await ws.close(code=1008); return
    other = await db.profiles.find_one({'handle': handle})
    if not other:
        await ws.close(code=1008); return
    room = dm_room(me_id, other['id'])
    await manager.connect(room, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(room, ws)
    except Exception:
        manager.disconnect(room, ws)
