const { MongoClient } = require('mongodb')
const fs = require('fs')
const path = require('path')

// minimal .env loader
const env = {}
try {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  raw.split('\n').forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  })
} catch (e) {}
const MONGO_URL = process.env.MONGO_URL || env.MONGO_URL
const DB_NAME = process.env.DB_NAME || env.DB_NAME

;(async () => {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  const users = db.collection('users')
  const email = 'googleonly@example.com'
  await users.deleteMany({ email })
  await users.insertOne({
    id: '11111111-1111-1111-1111-111111111111',
    email,
    handle: 'googleonly',
    display_name: 'Google Only',
    dob: '1990-01-01',
    age: 35,
    is_minor: false,
    auth_provider: 'google',
    auth_source: 'emergent_google',
    password_hash: null,
    created_at: new Date(),
  })
  console.log('Seeded google-only account:', email)
  await client.close()
})().catch((e) => { console.error(e); process.exit(1) })
