import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method === 'POST') {
      const { id, subject, name, addedDate, description } = req.body || {};
      if (!id || !subject || !name || !addedDate) {
        return res.status(400).json({ error: 'id, subject, name, addedDate required' });
      }
      const desc = typeof description === 'string' && description.trim() ? description : null;
      await sql`
        INSERT INTO topics (id, user_id, subject, name, added_date, description)
        VALUES (${id}, ${uid}, ${subject}, ${name}, ${addedDate}, ${desc})
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { name, description } = req.body || {};
      const hasName = typeof name === 'string' && name.trim();
      const hasDesc = typeof description === 'string'; // empty string clears the description
      if (!hasName && !hasDesc) {
        return res.status(400).json({ error: 'name or description required' });
      }
      const newName = hasName ? name.trim() : null;
      const newDesc = hasDesc ? (description.trim() ? description : null) : null;
      const result = await sql`
        UPDATE topics
        SET name        = COALESCE(${newName}, name),
            description = CASE WHEN ${hasDesc} THEN ${newDesc} ELSE description END
        WHERE id = ${id} AND user_id = ${uid}
        RETURNING id
      `;
      if (result.length === 0) return res.status(404).json({ error: 'topic not found' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM topics WHERE id = ${id} AND user_id = ${uid}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return handleError(res, e, 'api/topics');
  }
}
