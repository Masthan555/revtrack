import {
  sql, ensureSchema, verifyPassword, createSession, setSessionCookie,
  isHttps, handleError,
} from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username and password required' });
    }

    const id = username.trim().toLowerCase();
    const [row] = await sql`SELECT id, password_hash FROM users WHERE id = ${id}`;
    const ok = row && (await verifyPassword(password, row.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'invalid username or password' });
    }

    const token = await createSession(row.id);
    setSessionCookie(res, token, isHttps(req));

    return res.status(200).json({ username: row.id });
  } catch (e) {
    return handleError(res, e, 'api/auth/login');
  }
}
