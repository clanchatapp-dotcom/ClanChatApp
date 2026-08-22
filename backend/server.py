import os
import uuid
import time
import logging
from datetime import datetime, timezone
from typing import Optional

import jwt
import httpx
from dotenv import load_dotenv
from fastapi import (
    FastAPI, Depends, HTTPException, status, UploadFile, File, Form,
    WebSocket, WebSocketDisconnect,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv('/app/.env')
logging.basicConfig(level=logging.INFO)
log = logging.getLogger('clanchat')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ.get('DB_NAME', 'clanchat')
JWT_SECRET = os.environ['SUPABASE_JWT_SECRET']
SUPABASE_URL = os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_ROLE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
BUCKET = os.environ.get('SUPABASE_BUCKET', 'clanchat-media')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title='ClanChat API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

security = HTTPBearer(auto_error=False)

DEFAULT_CLANS = [
    {'id': '00000000-0000-0000-0000-0000000000g1', 'name': 'General', 'description': 'The main hangout for every clan member.', 'code': 'GENERAL'},
    {'id': '00000000-0000-0000-0000-0000000000a2', 'name': 'Announcements', 'description': 'Official news & updates.', 'code': 'NEWS'},
]


# ----------------------------- Auth helpers -----------------------------

def decode_supabase_jwt(token: str) -> dict:
    return jwt.decode(
        token,
        JWT_SECRET,
        algorithms=['HS256'],
        audience='authenticated',
        options={'verify_signature': True, 'verify_exp': True,
                 'verify_aud': True, 'require': ['exp', 'sub']},
    )


def user_from_claims(claims: dict) -> dict:
    meta = claims.get('user_metadata') or {}
    name = (claims.get('name') or meta.get('name') or meta.get('full_name')
            or (claims.get('email') or 'member').split('@')[0])
    return {
        'id': claims['sub'],
        'email': claims.get('email'),
        'name': name,
        'avatar_url': claims.get('avatar_url') or meta.get('avatar_url'),
    }


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if credentials is None or (credentials.scheme or '').lower() != 'bearer':
        raise HTTPException(status_code=401, detail='Missing Bearer token')
    try:
        claims = decode_supabase_jwt(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f'Invalid token: {e}')
    user = user_from_claims(claims)
    await ensure_profile(user)
    return user


async def ensure_profile(user: dict) -> None:
    await db.profiles.update_one(
        {'id': user['id']},
        {'$set': {'email': user.get('email'), 'name': user.get('name'),
                  'avatar_url': user.get('avatar_url')},
         '$setOnInsert': {'id': user['id'],
                          'created_at': datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    # auto-join the General clan so new members land somewhere alive
    await db.clans.update_one({'id': DEFAULT_CLANS[0]['id']},
                              {'$addToSet': {'member_ids': user['id']}})


# ----------------------------- Models -----------------------------

class ClanCreate(BaseModel):
    name: str
    description: Optional[str] = ''


class JoinCode(BaseModel):
    code: str


class MessageCreate(BaseModel):
    text: Optional[str] = ''
    media_url: Optional[str] = None


class DevLogin(BaseModel):
    name: Optional[str] = 'Guest'
    email: Optional[str] = None


# ----------------------------- WebSocket manager -----------------------------

class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, clan_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(clan_id, set()).add(ws)

    def disconnect(self, clan_id: str, ws: WebSocket):
        self.rooms.get(clan_id, set()).discard(ws)

    async def broadcast(self, clan_id: str, data: dict):
        for ws in list(self.rooms.get(clan_id, set())):
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(clan_id, ws)


manager = ConnectionManager()


# ----------------------------- Storage -----------------------------

def admin_headers() -> dict:
    return {'apikey': SERVICE_ROLE_KEY, 'Authorization': f'Bearer {SERVICE_ROLE_KEY}'}


async def ensure_bucket() -> None:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            f'{SUPABASE_URL}/storage/v1/bucket',
            headers={**admin_headers(), 'Content-Type': 'application/json'},
            json={'id': BUCKET, 'name': BUCKET, 'public': False,
                  'file_size_limit': 15 * 1024 * 1024,
                  'allowed_mime_types': ['image/*']},
        )
        if r.status_code in (200, 201):
            log.info('Created storage bucket %s', BUCKET)
        elif r.status_code in (400, 409) and 'exист' or r.status_code in (400, 409):
            log.info('Storage bucket %s already exists (%s)', BUCKET, r.status_code)
        else:
            log.warning('ensure_bucket unexpected %s: %s', r.status_code, r.text)


async def upload_and_sign(path: str, content: bytes, content_type: str,
                          expires_in: int = 60 * 60 * 24 * 7) -> str:
    safe = path.lstrip('/')
    async with httpx.AsyncClient(timeout=60) as c:
        up = await c.post(
            f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{safe}',
            headers={**admin_headers(), 'Content-Type': content_type, 'x-upsert': 'true'},
            content=content,
        )
        up.raise_for_status()
        signed = await c.post(
            f'{SUPABASE_URL}/storage/v1/object/sign/{BUCKET}/{safe}',
            headers={**admin_headers(), 'Content-Type': 'application/json'},
            json={'expiresIn': expires_in},
        )
        signed.raise_for_status()
        url = signed.json()['signedURL']
    return url if url.startswith('http') else f'{SUPABASE_URL}/storage/v1{url}'


# ----------------------------- Startup -----------------------------

@app.on_event('startup')
async def startup():
    for c in DEFAULT_CLANS:
        await db.clans.update_one(
            {'id': c['id']},
            {'$setOnInsert': {**c, 'created_by': 'system', 'member_ids': [],
                              'created_at': datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    try:
        await ensure_bucket()
    except Exception as e:
        log.warning('ensure_bucket failed at startup: %s', e)


# ----------------------------- Routes -----------------------------

@app.get('/api/')
async def root():
    return {'ok': True, 'service': 'clanchat', 'time': datetime.now(timezone.utc).isoformat()}


@app.post('/api/dev/token')
async def dev_token(body: DevLogin):
    """SANDBOX ONLY: mint a real Supabase-compatible JWT so the app is testable
    without a live Google redirect. Signed with the project's JWT secret."""
    name = (body.name or 'Guest').strip() or 'Guest'
    email = (body.email or f"{name.lower().replace(' ', '.')}@sandbox.clanchat").strip()
    uid = str(uuid.uuid5(uuid.NAMESPACE_DNS, email))
    now = int(time.time())
    claims = {
        'sub': uid, 'email': email, 'aud': 'authenticated', 'role': 'authenticated',
        'iss': 'clanchat-dev', 'iat': now, 'exp': now + 60 * 60 * 24 * 7,
        'user_metadata': {'name': name},
    }
    token = jwt.encode(claims, JWT_SECRET, algorithm='HS256')
    user = {'id': uid, 'email': email, 'name': name, 'avatar_url': None}
    await ensure_profile(user)
    return {'access_token': token, 'token_type': 'bearer', 'user': user}


@app.get('/api/me')
async def me(user: dict = Depends(get_current_user)):
    prof = await db.profiles.find_one({'id': user['id']}, {'_id': 0})
    return prof or user


def clan_public(c: dict, uid: str) -> dict:
    return {
        'id': c['id'], 'name': c['name'], 'description': c.get('description', ''),
        'code': c.get('code'), 'created_by': c.get('created_by'),
        'member_count': len(c.get('member_ids', [])),
        'is_member': uid in c.get('member_ids', []),
    }


@app.get('/api/clans')
async def list_clans(user: dict = Depends(get_current_user)):
    out = []
    async for c in db.clans.find({}, {'_id': 0}).sort('created_at', 1):
        out.append(clan_public(c, user['id']))
    return out


@app.post('/api/clans')
async def create_clan(body: ClanCreate, user: dict = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, 'Clan name required')
    doc = {
        'id': str(uuid.uuid4()), 'name': name, 'description': (body.description or '').strip(),
        'code': uuid.uuid4().hex[:6].upper(), 'created_by': user['id'],
        'member_ids': [user['id']], 'created_at': datetime.now(timezone.utc).isoformat(),
    }
    await db.clans.insert_one(doc)
    return clan_public(doc, user['id'])


@app.post('/api/clans/join')
async def join_by_code(body: JoinCode, user: dict = Depends(get_current_user)):
    code = body.code.strip().upper()
    c = await db.clans.find_one({'code': code}, {'_id': 0})
    if not c:
        raise HTTPException(404, 'No clan with that code')
    await db.clans.update_one({'id': c['id']}, {'$addToSet': {'member_ids': user['id']}})
    c['member_ids'] = list(set(c.get('member_ids', []) + [user['id']]))
    return clan_public(c, user['id'])


@app.post('/api/clans/{clan_id}/join')
async def join_clan(clan_id: str, user: dict = Depends(get_current_user)):
    c = await db.clans.find_one({'id': clan_id}, {'_id': 0})
    if not c:
        raise HTTPException(404, 'Clan not found')
    await db.clans.update_one({'id': clan_id}, {'$addToSet': {'member_ids': user['id']}})
    c['member_ids'] = list(set(c.get('member_ids', []) + [user['id']]))
    return clan_public(c, user['id'])


@app.get('/api/clans/{clan_id}/messages')
async def get_messages(clan_id: str, user: dict = Depends(get_current_user)):
    c = await db.clans.find_one({'id': clan_id})
    if not c:
        raise HTTPException(404, 'Clan not found')
    # opening a room joins it (open rooms => low friction MVP)
    await db.clans.update_one({'id': clan_id}, {'$addToSet': {'member_ids': user['id']}})
    msgs = []
    async for m in db.messages.find({'clan_id': clan_id}, {'_id': 0}).sort('created_at', 1).limit(200):
        msgs.append(m)
    return msgs


@app.post('/api/clans/{clan_id}/messages')
async def send_message(clan_id: str, body: MessageCreate, user: dict = Depends(get_current_user)):
    c = await db.clans.find_one({'id': clan_id})
    if not c:
        raise HTTPException(404, 'Clan not found')
    text = (body.text or '').strip()
    if not text and not body.media_url:
        raise HTTPException(400, 'Empty message')
    doc = {
        'id': str(uuid.uuid4()), 'clan_id': clan_id, 'user_id': user['id'],
        'user_name': user['name'], 'user_email': user.get('email'),
        'text': text, 'media_url': body.media_url,
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(doc)
    doc.pop('_id', None)
    await manager.broadcast(clan_id, {'type': 'message', 'message': doc})
    return doc


@app.post('/api/upload')
async def upload(user: dict = Depends(get_current_user), file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, 'File too large (max 15MB)')
    ext = (file.filename or 'file').split('.')[-1][:8]
    path = f"{user['id']}/{uuid.uuid4().hex}.{ext}"
    url = await upload_and_sign(path, data, file.content_type or 'application/octet-stream')
    return {'path': path, 'signed_url': url}


@app.websocket('/api/ws/{clan_id}')
async def ws_endpoint(ws: WebSocket, clan_id: str):
    token = ws.query_params.get('token')
    try:
        if not token:
            raise ValueError('no token')
        decode_supabase_jwt(token)
    except Exception:
        await ws.close(code=1008)
        return
    await manager.connect(clan_id, ws)
    try:
        while True:
            await ws.receive_text()  # keepalive / ignore inbound
    except WebSocketDisconnect:
        manager.disconnect(clan_id, ws)
    except Exception:
        manager.disconnect(clan_id, ws)
