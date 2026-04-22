import { neon } from '@neondatabase/serverless';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { SignJWT, jwtVerify } from 'jose';

const scryptAsync = promisify(scrypt);

export const sql = neon(process.env.DATABASE_URL);

export const DEFAULT_SUBJECTS = [
  { name: 'DSA', pi: 0 },
  { name: 'LLD', pi: 2 },
  { name: 'HLD', pi: 5 },
];

const SESSION_COOKIE = 'rt_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years ≈ no auto-logout

let schemaReady = false;
export async function ensureSchema() {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS subjects (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      pi      INT  NOT NULL,
      PRIMARY KEY (user_id, name)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS topics (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      subject     TEXT NOT NULL,
      name        TEXT NOT NULL,
      added_date  DATE NOT NULL,
      description TEXT,
      FOREIGN KEY (user_id, subject) REFERENCES subjects(user_id, name) ON DELETE CASCADE
    )
  `;
  // Safety net: if the table existed before `description` was added, bring it in line.
  await sql`ALTER TABLE topics ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS revisions (
      topic_id  TEXT NOT NULL,
      done_date DATE NOT NULL,
      PRIMARY KEY (topic_id, done_date),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `;
  schemaReady = true;
}

/* ── Password hashing (scrypt, Node stdlib) ── */

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const want = Buffer.from(hashHex, 'hex');
  const got = await scryptAsync(password, salt, 64);
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ── Sessions (stateless JWT in an HttpOnly cookie) ── */

const JWT_ALG = 'HS256';
const JWT_EXPIRY = '3650d'; // 10 years — matches the cookie Max-Age, "no auto-logout"

function getJwtSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'SESSION_SECRET env var missing or too short (need 32+ chars of random data)',
    );
  }
  return new TextEncoder().encode(s);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSessionToken(req) {
  if (req.cookies && req.cookies[SESSION_COOKIE]) return req.cookies[SESSION_COOKIE];
  return parseCookies(req.headers?.cookie)[SESSION_COOKIE] || null;
}

export async function getSessionUser(req) {
  const token = getSessionToken(req);
  if (!token) throw unauthorized();
  // Get the secret OUTSIDE the try — a missing/short SESSION_SECRET is a
  // server misconfiguration, not an auth failure. Let it surface as a 500
  // with a clear message instead of silently 401-ing every request.
  const secret = getJwtSecret();
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== 'string' || !payload.sub) throw unauthorized();
    return payload.sub;
  } catch (e) {
    if (e.statusCode === 401) throw e;
    // Any error from jose (expired / invalid signature / malformed) is an auth failure.
    throw unauthorized();
  }
}

export async function createSession(userId) {
  return await new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret());
}

export function setSessionCookie(res, token, secure) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function isHttps(req) {
  return (
    req.headers['x-forwarded-proto'] === 'https' ||
    req.connection?.encrypted === true
  );
}

/* ── Misc helpers ── */

export async function seedDefaultSubjects(uid) {
  for (const s of DEFAULT_SUBJECTS) {
    await sql`
      INSERT INTO subjects (user_id, name, pi) VALUES (${uid}, ${s.name}, ${s.pi})
      ON CONFLICT (user_id, name) DO NOTHING
    `;
  }
}

export function handleError(res, e, tag) {
  const code = e.statusCode || 500;
  if (code >= 500) console.error(tag + ' error:', e);
  return res.status(code).json({ error: e.message });
}

function unauthorized() {
  const err = new Error('not authenticated');
  err.statusCode = 401;
  return err;
}
