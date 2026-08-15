import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// MongoDB connection (singleton)
// ---------------------------------------------------------------------------
let client
let db

async function connectToMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME)
  }
  return db
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

function json(data, status = 200) {
  return handleCORS(NextResponse.json(data, { status }))
}

// ---------------------------------------------------------------------------
// Auth helpers (dependency-free JWT + password hashing)
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'clanchat_dev_secret'
const ACCESS_TTL = 30 * 24 * 3600 // 30 days

function signJWT(payload, ttl = ACCESS_TTL) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + ttl }
  const h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const p = Buffer.from(JSON.stringify(body)).toString('base64url')
  const data = `${h}.${p}`
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyJWT(token) {
  try {
    const [h, p, s] = String(token).split('.')
    if (!h || !p || !s) return null
    const data = `${h}.${p}`
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
    if (s !== expected) return null
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch (e) {
    return null
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(pw, stored) {
  if (!stored) return false
  const [salt, hash] = stored.split(':')
  const test = crypto.scryptSync(pw, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash))
}

function calcAge(dob) {
  const b = new Date(dob)
  if (isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

function sanitizeHandle(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20)
}

function cleanUser(u) {
  if (!u) return null
  const { _id, password_hash, ...rest } = u
  return rest
}

// Verify a Supabase (or mock) OAuth access token -> { email, name, sub }
async function verifySupabaseToken(accessToken) {
  if (!accessToken) return null
  const supaConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  // MOCK dev tokens: "mock.<base64url(json)>" — only honored when Supabase is NOT configured
  if (!supaConfigured && accessToken.startsWith('mock.')) {
    try {
      const payload = JSON.parse(Buffer.from(accessToken.slice(5), 'base64url').toString())
      return { email: payload.email, name: payload.name || '', sub: payload.sub || payload.email }
    } catch (e) {
      return null
    }
  }
  // REAL Supabase token verification
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    const name = u.user_metadata?.full_name || u.user_metadata?.name || ''
    return { email: u.email, name, sub: u.id }
  } catch (e) {
    return null
  }
}

function getBearer(request) {
  const auth = request.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return null
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()
    const users = db.collection('users')

    // -- Health --------------------------------------------------------------
    if ((route === '/root' || route === '/') && method === 'GET') {
      return json({ message: 'ClanChat API' })
    }

    // -- Public config (fixes "Supabase config unavailable" banner) ----------
    if (route === '/config' && method === 'GET') {
      const url = process.env.SUPABASE_URL || ''
      const anon = process.env.SUPABASE_ANON_KEY || ''
      return json({
        supabase_url: url,
        supabase_anon_key: anon,
        configured: Boolean(url && anon),
      })
    }

    // -- DEV mock Google identity (used only when Supabase not configured) ---
    if (route === '/auth/dev-google' && method === 'POST') {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        return json({ error: 'disabled', message: 'Dev Google mock is disabled; real Supabase is configured.' }, 404)
      }
      const body = await request.json().catch(() => ({}))
      const rand = crypto.randomBytes(3).toString('hex')
      const email = (body.email || `googler_${rand}@gmail.com`).toLowerCase()
      const name = body.name || 'Google User'
      const payload = Buffer.from(JSON.stringify({ email, name, sub: `g_${rand}` })).toString('base64url')
      return json({ access_token: `mock.${payload}`, email, name, mock: true })
    }

    // -- Emergent-managed Google: exchange session_id for identity -----------
    if (route === '/auth/emergent/exchange' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const sessionId = body.session_id
      if (!sessionId || typeof sessionId !== 'string') {
        return json({ error: 'session_id_required', message: 'Missing session_id.' }, 400)
      }

      // Server-to-server identity lookup. Try the documented endpoint first,
      // then fall back to the widely-used Emergent session-data endpoint.
      let identity = null
      try {
        const up = await fetch('https://auth.emergentagent.com/api/auth/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
          cache: 'no-store',
        })
        if (up.ok) identity = await up.json()
      } catch (e) {}
      if (!identity) {
        try {
          const up2 = await fetch('https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data', {
            method: 'GET',
            headers: { 'X-Session-ID': sessionId },
            cache: 'no-store',
          })
          if (up2.ok) identity = await up2.json()
        } catch (e) {}
      }
      if (!identity) {
        return json({ error: 'invalid_session', message: 'Invalid or expired Emergent session.' }, 401)
      }

      const eu = identity.user || identity
      const emEmail = String(eu.email || '').trim().toLowerCase()
      if (!emEmail) {
        return json({ error: 'no_email', message: 'Emergent returned no email.' }, 502)
      }

      // Returning user -> straight in
      const existing = await users.findOne({ email: emEmail })
      if (existing) {
        const token = signJWT({ sub: existing.id, email: existing.email, handle: existing.handle })
        return json({ token, user: cleanUser(existing) })
      }

      // New user -> mint a short-lived profile ticket and send to /complete-profile
      const ticket = signJWT(
        {
          purpose: 'profile',
          provider: 'emergent',
          email: emEmail,
          name: eu.name || '',
          picture: eu.picture || null,
          emergent_user_id: eu.user_id || eu.id || null,
        },
        900,
      )
      return json({
        needs_profile: true,
        provider: 'emergent',
        supabase_email: emEmail,
        supabase_name: eu.name || '',
        profile_ticket: ticket,
      })
    }

    // -- Supabase login / profile completion ---------------------------------
    if (route === '/auth/supabase-login' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const { access_token, provider, password } = body
      const handleRaw = body.handle

      // ---- Phase 1: initial exchange (no handle yet) ----
      if (!handleRaw) {
        const identity = await verifySupabaseToken(access_token)
        if (!identity || !identity.email) {
          return json({ error: 'invalid_token', message: 'Could not verify Google session.' }, 401)
        }
        // Returning user? -> straight in
        const existing = await users.findOne({ email: identity.email.toLowerCase() })
        if (existing) {
          const token = signJWT({ sub: existing.id, email: existing.email, handle: existing.handle })
          return json({ token, user: cleanUser(existing) })
        }
        // New user -> needs profile
        return json({
          needs_profile: true,
          supabase_email: identity.email,
          supabase_name: identity.name || '',
        })
      }

      // ---- Phase 2: profile completion (handle present) ----
      const handle = sanitizeHandle(handleRaw)
      if (!handle || handle.length < 3) {
        return json({ error: 'invalid_handle', message: 'Handle must be at least 3 characters (letters, numbers, underscore).' }, 400)
      }
      const email = String(body.email || '').trim().toLowerCase()
      if (!email || !email.includes('@')) {
        return json({ error: 'invalid_email', message: 'A valid email is required.' }, 400)
      }
      const age = calcAge(body.dob)
      if (age === null) {
        return json({ error: 'invalid_dob', message: 'A valid date of birth is required.' }, 400)
      }
      if (age < 13) {
        return json({ error: 'age', message: 'You must be at least 13 years old to join.' }, 400)
      }

      const authProvider = provider === 'password' ? 'password' : 'google'
      let emergentMeta = {}

      // For google we require a verified session; password requires a password;
      // emergent requires a valid one-time profile ticket minted at /auth/emergent/exchange.
      if (provider === 'emergent') {
        const ticket = verifyJWT(body.profile_ticket)
        if (!ticket || ticket.purpose !== 'profile') {
          return json({ error: 'invalid_ticket', message: 'Your sign-in expired. Please sign up again.' }, 401)
        }
        emergentMeta = { emergent_user_id: ticket.emergent_user_id || null, picture: ticket.picture || null }
      } else if (authProvider === 'google') {
        const identity = await verifySupabaseToken(access_token)
        if (!identity || !identity.email) {
          return json({ error: 'invalid_token', message: 'Google session expired. Please sign up again.' }, 401)
        }
      } else if (authProvider === 'password') {
        if (!password || String(password).length < 6) {
          return json({ error: 'invalid_password', message: 'Password must be at least 6 characters.' }, 400)
        }
      }

      // Uniqueness checks
      if (await users.findOne({ handle })) {
        return json({ error: 'handle_taken', message: 'That #handle is already taken.' }, 409)
      }
      if (await users.findOne({ email })) {
        return json({ error: 'email_in_use', message: 'That email is already in use.' }, 409)
      }

      const user = {
        id: uuidv4(),
        email,
        handle,
        display_name: (body.display_name || handle).trim(),
        dob: body.dob,
        age,
        is_minor: age < 18,
        auth_provider: authProvider,
        auth_source: provider === 'emergent' ? 'emergent_google' : provider,
        password_hash: authProvider === 'password' ? hashPassword(password) : null,
        created_at: new Date(),
        ...emergentMeta,
      }
      await users.insertOne(user)
      const token = signJWT({ sub: user.id, email: user.email, handle: user.handle })
      return json({ token, user: cleanUser(user) })
    }

    // -- Email/password sign-in ----------------------------------------------
    if (route === '/auth/signin' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const email = String(body.email || '').trim().toLowerCase()
      const user = await users.findOne({ email })
      if (!user || user.auth_provider !== 'password' || !verifyPassword(body.password || '', user.password_hash)) {
        return json({ error: 'invalid_credentials', message: 'Invalid email or password.' }, 401)
      }
      const token = signJWT({ sub: user.id, email: user.email, handle: user.handle })
      return json({ token, user: cleanUser(user) })
    }

    // -- Current user --------------------------------------------------------
    if (route === '/auth/me' && method === 'GET') {
      const token = getBearer(request)
      const payload = verifyJWT(token)
      if (!payload) return json({ error: 'unauthorized' }, 401)
      const user = await users.findOne({ id: payload.sub })
      if (!user) return json({ error: 'unauthorized' }, 401)
      return json({ user: cleanUser(user) })
    }

    // -- Handle availability (nice-to-have for inline UX) --------------------
    if (route === '/auth/check-handle' && method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const handle = sanitizeHandle(body.handle)
      if (!handle || handle.length < 3) return json({ available: false, handle })
      const existing = await users.findOne({ handle })
      return json({ available: !existing, handle })
    }

    return json({ error: `Route ${route} not found` }, 404)
  } catch (error) {
    console.error('API Error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
