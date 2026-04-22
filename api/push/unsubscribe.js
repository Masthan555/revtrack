import { sql, ensureSchema, getSessionUser, handleError } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const uid = await getSessionUser(req);
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ error: 'endpoint required' });
    }
    await sql`
      DELETE FROM push_subscriptions
      WHERE user_id = ${uid} AND endpoint = ${endpoint}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return handleError(res, e, 'api/push/unsubscribe');
  }
}
