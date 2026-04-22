import { sql, ensureSchema, getSessionUser, handleError } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const uid = await getSessionUser(req);
    const { endpoint, keys } = req.body || {};
    if (
      typeof endpoint !== 'string' ||
      !endpoint ||
      !keys ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string'
    ) {
      return res.status(400).json({ error: 'endpoint and keys.p256dh/auth required' });
    }
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (${uid}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
      ON CONFLICT (user_id, endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return handleError(res, e, 'api/push/subscribe');
  }
}
