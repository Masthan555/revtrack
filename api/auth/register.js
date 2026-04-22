import {
  sql, ensureSchema, hashPassword, createSession, setSessionCookie,
  isHttps, seedDefaultSubjects, handleError,
} from '../../lib/db.js';

const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { username, password } = req.body || {};
    const id = typeof username === 'string' ? username.trim().toLowerCase() : '';

    if (!USERNAME_RE.test(id)) {
      return res.status(400).json({
        error: 'username must be 3-32 chars: letters, numbers, _ . -',
      });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: 'password must be 6-200 characters' });
    }

    const hash = await hashPassword(password);

    try {
      await sql`INSERT INTO users (id, password_hash) VALUES (${id}, ${hash})`;
    } catch (e) {
      if (e.code === '23505' || /unique|duplicate/i.test(e.message || '')) {
        return res.status(409).json({ error: 'username already taken' });
      }
      throw e;
    }

    await seedDefaultSubjects(id);

    const token = await createSession(id);
    setSessionCookie(res, token, isHttps(req));

    return res.status(200).json({ username: id });
  } catch (e) {
    return handleError(res, e, 'api/auth/register');
  }
}
