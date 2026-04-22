# RevTrack

Multi-user spaced-repetition tracker. Vanilla HTML UI + small Vercel serverless API, backed by Neon Postgres. Stateless JWT auth in an HttpOnly cookie — long-lived, no auto-logout, no DB round trip per request.

## Architecture

```
index.html              ← UI (vanilla JS). localStorage is the synchronous render cache;
                          mutations update the cache AND fire a fine-grained API call.
                          Auth is a signed JWT in an HttpOnly / SameSite=Lax cookie with
                          a 10-year expiry; the browser auto-sends it on every request.

api/auth/register.js    ← POST  /api/auth/register  body { username, password }
api/auth/login.js       ← POST  /api/auth/login     body { username, password }
api/auth/logout.js      ← POST  /api/auth/logout    (just clears the cookie)
api/auth/me.js          ← GET   /api/auth/me        → { username } or 401

api/state.js            ← GET    /api/state          → { rt_s, rt_t, rt_d }
api/subjects.js         ← POST   /api/subjects       body { name, pi }
                          DELETE /api/subjects?name=...
api/topics.js           ← POST   /api/topics         body { id, subject, name, addedDate, description? }
                          PATCH  /api/topics?id=...  body { name?, description? }
                          DELETE /api/topics?id=...
api/revisions.js        ← POST   /api/revisions      body { topicId, doneDate }

lib/db.js               ← shared: neon client, schema, scrypt password hashing,
                          JWT sign/verify via `jose`, cookie helpers.
```

All `/api/*` except `auth/register` and `auth/login` require a valid session cookie;
otherwise they return 401. Auth verification is a pure in-memory HMAC check — **zero DB
round trips**.

### Schema (Neon Postgres)

```sql
users      (id PK, password_hash NOT NULL, created_at)
subjects   (user_id → users ON DELETE CASCADE, name, pi)    PK (user_id, name)
topics     (id PK, user_id, subject, name, added_date, description)
           FK (user_id, subject) → subjects ON DELETE CASCADE
revisions  (topic_id → topics ON DELETE CASCADE, done_date) PK (topic_id, done_date)
```

- `users.id` is the lowercased username — what foreign-keys reference everywhere.
- Password hashing: `scrypt` (Node stdlib crypto), 16-byte salt, 64-byte hash, stored as
  `salt_hex:hash_hex`. No third-party hashing dependency.
- Session cookie contents: a JWT signed with HS256 and `process.env.SESSION_SECRET`,
  subject = `username`, 10-year expiry. Cookie is `HttpOnly; SameSite=Lax; Max-Age=10y`
  (+`Secure` over HTTPS). Logout just clears the cookie — there's no server-side session
  row to delete.
- Default subjects (DSA / LLD / HLD) are seeded on register.
- All tables auto-created on the first API hit (`CREATE TABLE IF NOT EXISTS`).

> **Migrating from the session-table build:** the previous revision stored session tokens
> in a `sessions` table. It's no longer used. You can drop it whenever:
> `DROP TABLE IF EXISTS sessions;` in Neon's SQL editor. Leaving it in place is harmless
> but takes a few KB.

## Deploy to Vercel (free tier)

1. **Push this folder to GitHub.**
2. **Create a Vercel project** → import the repo. Vercel auto-detects it as a static site
   with serverless functions in `api/`. No framework preset needed.
3. **Attach Neon Postgres:** Project dashboard → **Storage** → **Create Database** → **Neon**.
   Pick the free plan and a region near you. Vercel auto-injects `DATABASE_URL`.
4. **Set `SESSION_SECRET`** env var (required for JWT signing). Generate 32+ random bytes:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```
   Vercel → Project → **Settings** → **Environment Variables** → add
   `SESSION_SECRET` = `<pasted value>` for **Production**, **Preview**, and **Development**.
5. **Match the function region to Neon's** (otherwise every DB query crosses a continent).
   Project → Settings → **Functions** → **Region** → pick the same region Neon is in.
   Redeploy after changing this.
6. **Deploy.** Tables are auto-created on the first API hit.

> Rotating `SESSION_SECRET` invalidates every existing cookie and forces all users to
> log back in. That's the "kick everyone out" button; no per-session revocation.

## Local dev

```bash
npm install
npx vercel link          # one-time: link to your Vercel project so env vars sync
npx vercel env pull      # pulls DATABASE_URL and SESSION_SECRET into .env.local
npx vercel dev           # serves / and /api on http://localhost:3000
```

If you want a dev DB separate from prod, create a second Neon database (or Neon branch)
and paste its connection string into `.env.local` instead of running `vercel env pull`.
Same for `SESSION_SECRET` — a distinct value for dev means prod cookies won't verify
locally and vice versa (usually what you want).

Cookies over `http://localhost` work because the server omits the `Secure` flag when it
sees no `X-Forwarded-Proto: https`.

## Threat model

- **Passwords** never stored in plaintext — `scrypt` with a 16-byte per-user salt.
- **JWT integrity:** every request reconstructs the HMAC with `SESSION_SECRET` and compares
  (timing-safe) against the signature the browser sent. A forged cookie cannot pass.
- **`HttpOnly`** cookie — JS can't read the token, so XSS can't directly exfiltrate it.
- **`SameSite=Lax`** — cross-site form submissions can't ride the cookie (CSRF).
- **Cross-user isolation:** every `/api/*` query filters by the caller's `user_id` from
  the verified JWT `sub`; no way to address another user's data.
- **Long sessions (10 years)** are deliberate — matches "no auto-logout" — but a stolen
  cookie stays valid for its lifetime. Mitigations:
  - **Kick everyone out:** rotate `SESSION_SECRET` in Vercel env and redeploy.
  - **Kick one user out:** no single-session revoke with stateless JWTs. You'd either
    change their password (doesn't invalidate old cookies without adding a password-version
    claim) or rotate the global secret.
- **No rate limiting** on login yet. At 20 users on an unshared URL this is usually fine;
  if the app ever goes public, add an attempts-per-IP check in `api/auth/login.js`.
