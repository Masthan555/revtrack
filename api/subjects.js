import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method === 'POST') {
      const { name, pi } = req.body || {};
      if (!name || typeof name !== 'string' || typeof pi !== 'number') {
        return res.status(400).json({ error: 'name (string) and pi (number) required' });
      }
      await sql`
        INSERT INTO subjects (user_id, name, pi)
        VALUES (${uid}, ${name}, ${pi})
        ON CONFLICT (user_id, name) DO UPDATE SET pi = EXCLUDED.pi
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const name = req.query?.name;
      if (!name) return res.status(400).json({ error: 'name required' });
      await sql`DELETE FROM subjects WHERE user_id = ${uid} AND name = ${name}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return handleError(res, e, 'api/subjects');
  }
}
