import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method === 'POST') {
      const { id, subject, name, addedDate } = req.body || {};
      if (!id || !subject || !name || !addedDate) {
        return res.status(400).json({ error: 'id, subject, name, addedDate required' });
      }
      await sql`
        INSERT INTO topics (id, user_id, subject, name, added_date)
        VALUES (${id}, ${uid}, ${subject}, ${name}, ${addedDate})
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM topics WHERE id = ${id} AND user_id = ${uid}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return handleError(res, e, 'api/topics');
  }
}
