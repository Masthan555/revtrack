# RevTrack

Multi-user spaced-repetition tracker. Vanilla HTML UI + small Vercel serverless API, backed by Neon Postgres. Username/password auth with long-lived session cookies (no auto-logout).

## Architecture

```
index.html              ← UI (vanilla JS). localStorage is the synchronous render cache;
                          mutations update the cache AND fire a fine-grained API call.
                          Auth is a session cookie (HttpOnly, SameSite=Lax, 10-year expiry);
                          browser auto-sends it on every request.

api/auth/register.js    ← POST  /api/auth/register  body { username, password }
api/auth/login.js       ← POST  /api/auth/login     body { username, password }
api/auth/logout.js      ← POST  /api/auth/logout
api/auth/me.js          ← GET   /api/auth/me        → { username } or 401

api/state.js            ← GET    /api/state          → { rt_s, rt_t, rt_d } for caller
api/subjects.js         ← POST   /api/subjects       body { name, pi }
                          DELETE /api/subjects?name=...
api/topics.js           ← POST   /api/topics         body { id, subject, name, addedDate }
                          DELETE /api/topics?id=...
api/revisions.js        ← POST   /api/revisions      body { topicId, doneDate }

lib/db.js               ← shared: neon client, schema, scrypt password hashing,
                          session token (opaque random 64-hex), cookie helpers.
```

All `/api/*` except `auth/register` and `auth/login` require a valid session; otherwise
they return 401.

### Schema (Neon Postgres)

```sql
users      (id PK, password_hash NOT NULL, created_at)
sessions   (token PK, user_id → users ON DELETE CASCADE, created_at)
subjects   (user_id → users ON DELETE CASCADE, name, pi)    PK (user_id, name)
topics     (id PK, user_id, subject, name, added_date)
           FK (user_id, subject) → subjects ON DELETE CASCADE
revisions  (topic_id → topics ON DELETE CASCADE, done_date) PK (topic_id, done_date)
```

- `users.id` is the lowercased username — so it's what foreign-keys reference everywhere.
- Password hashing: `scrypt` (Node stdlib crypto), 16-byte salt, 64-byte hash, stored as
  `salt_hex:hash_hex`. No third-party hashing dependency.
- Session token: 32 random bytes → 64 hex chars, stored server-side. Cookie is
  `HttpOnly; SameSite=Lax; Max-Age=10y` (+`Secure` over HTTPS). Logout deletes the row.
- Default subjects (DSA / LLD / HLD) are seeded on register, not on login.
- All tables auto-created on the first API hit (`CREATE TABLE IF NOT EXISTS`).

> **Migrating from an earlier build:** if you ran an older version of this code against
> the same Neon DB, the old `users` table has no `password_hash` column. Drop the existing
> tables (`DROP TABLE revisions, topics, subjects, sessions, users CASCADE;` via Neon's SQL
> editor) and let `ensureSchema` recreate them on the next request.

## Deploy to Vercel (free tier)

1. **Push this folder to GitHub.**
2. **Create a Vercel project** → import the repo. Vercel auto-detects it as a static site
   with serverless functions in `api/`. No framework preset needed.
3. **Attach Neon Postgres:** Project dashboard → **Storage** → **Create Database** → **Neon**.
   Pick the free plan and a region near you. Vercel auto-injects `DATABASE_URL`.
4. **Deploy.** Tables are auto-created on the first API hit.

## Local dev

```bash
npm install
npx vercel link          # one-time: link to your Vercel project so env vars sync
npx vercel env pull      # pulls DATABASE_URL into .env.local
npx vercel dev           # serves / and /api on http://localhost:3000
```

If you want a dev DB separate from prod, create a second Neon database (or Neon branch)
and paste its connection string into `.env.local` instead of running `vercel env pull`.

Cookies over `http://localhost` work because the server omits the `Secure` flag when it
sees no `X-Forwarded-Proto: https`.

## Threat model

- **Passwords** are never stored in plaintext — `scrypt` with a 16-byte per-user salt.
- **Sessions** are opaque random tokens; the cookie is `HttpOnly` (no JS access, blocks XSS
  token theft) and `SameSite=Lax` (blocks cross-site form-submit CSRF).
- **Cross-user isolation:** every `/api/*` query filters by the caller's `user_id` from
  the session; there's no way to address another user's data by guessing an id.
- **Long sessions (10 years)** are deliberate — matches the "no auto-logout" requirement —
  but it means a stolen cookie stays valid until you explicitly log out (which deletes
  the server-side row). If one of your friends reports their laptop stolen, you can
  manually `DELETE FROM sessions WHERE user_id = '...'` in Neon's SQL editor.
- **No rate limiting** on login yet. At 20 users on an unshared URL this is usually fine;
  if the app ever goes public, add a simple attempts-per-IP check in `api/auth/login.js`.
