import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

function validIntervals(v) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 32 &&
    v.every((n) => Number.isInteger(n) && n > 0 && n <= 36500)
  );
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method === 'POST') {
      const { id, subject, name, addedDate, description, intervals, recurring } = req.body || {};
      if (!id || !subject || !name || !addedDate) {
        return res.status(400).json({ error: 'id, subject, name, addedDate required' });
      }
      const desc = typeof description === 'string' && description.trim() ? description : null;
      let ivs = null;
      if (intervals != null) {
        if (!validIntervals(intervals)) {
          return res.status(400).json({ error: 'intervals must be an array of positive integers (max 32 items, each ≤ 36500)' });
        }
        ivs = intervals;
      }
      const rec = recurring === true;
      await sql`
        INSERT INTO topics (id, user_id, subject, name, added_date, description, intervals, recurring)
        VALUES (${id}, ${uid}, ${subject}, ${name}, ${addedDate}, ${desc},
                ${ivs === null ? null : JSON.stringify(ivs)}::jsonb, ${rec})
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const body = req.body || {};
      const hasName = typeof body.name === 'string' && body.name.trim();
      const hasDesc = typeof body.description === 'string';
      const hasIvs = 'intervals' in body;
      const hasRec = typeof body.recurring === 'boolean';
      if (!hasName && !hasDesc && !hasIvs && !hasRec) {
        return res.status(400).json({ error: 'at least one editable field required' });
      }
      let newIvs = null;
      if (hasIvs) {
        if (body.intervals === null) {
          newIvs = null;
        } else if (validIntervals(body.intervals)) {
          newIvs = body.intervals;
        } else {
          return res.status(400).json({ error: 'intervals must be an array of positive integers or null' });
        }
      }
      const newName = hasName ? body.name.trim() : null;
      const newDesc = hasDesc ? (body.description.trim() ? body.description : null) : null;
      const newRec  = hasRec  ? body.recurring : null;
      const ivsParam = hasIvs && newIvs !== null ? JSON.stringify(newIvs) : null;
      const result = await sql`
        UPDATE topics
        SET name        = COALESCE(${newName}, name),
            description = CASE WHEN ${hasDesc} THEN ${newDesc} ELSE description END,
            intervals   = CASE WHEN ${hasIvs}  THEN ${ivsParam}::jsonb ELSE intervals END,
            recurring   = CASE WHEN ${hasRec}  THEN ${newRec} ELSE recurring END
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
