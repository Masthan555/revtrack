import { clearSessionCookie, handleError } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    // Stateless JWT — the cookie is the entire session. Clearing it logs out.
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return handleError(res, e, 'api/auth/logout');
  }
}
