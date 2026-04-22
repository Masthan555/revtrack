import { ensureSchema, getSessionUser, handleError } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const uid = await getSessionUser(req);
    return res.status(200).json({ username: uid });
  } catch (e) {
    return handleError(res, e, 'api/auth/me');
  }
}
