import {
  ensureSchema, getSessionToken, deleteSession, clearSessionCookie, handleError,
} from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    await deleteSession(getSessionToken(req));
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return handleError(res, e, 'api/auth/logout');
  }
}
