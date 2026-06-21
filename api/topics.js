import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

function validIntervals(v) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 32 &&
    v.every((n) => Number.isInteger(n) && n > 0 && n <= 36500)
  );
}

// Normalize a client-provided tag list: lowercase, trim, drop empties,
// dedupe, enforce per-tag and total length limits. Returns null on invalid input.
function normalizeTags(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  if (v.length > 16) return null;
  const seen = new Set();
  const out = [];
  for (const raw of v) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t.length > 32) return null;
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method === 'POST') {
      const { id, subject, name, addedDate, description, intervals, recurring, tags } = req.body || {};
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
      const normTags = normalizeTags(tags);
      if (normTags === null) {
        return res.status(400).json({ error: 'tags must be an array of up to 16 strings, each ≤ 32 chars' });
      }
      const tagsParam = normTags.length ? JSON.stringify(normTags) : null;
      await sql`
        INSERT INTO topics (id, user_id, subject, name, added_date, description, intervals, recurring, tags)
        VALUES (${id}, ${uid}, ${subject}, ${name}, ${addedDate}, ${desc},
                ${ivs === null ? null : JSON.stringify(ivs)}::jsonb, ${rec},
                ${tagsParam}::jsonb)
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const body = req.body || {};
      const hasName = typeof body.name === 'string' && body.name.trim();
      const hasSubject = typeof body.subject === 'string' && body.subject.trim();
      const hasDesc = typeof body.description === 'string';
      const hasIvs = 'intervals' in body;
      const hasRec = typeof body.recurring === 'boolean';
      const hasTags = 'tags' in body;
      if (!hasName && !hasSubject && !hasDesc && !hasIvs && !hasRec && !hasTags) {
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
      let newTags = null;
      if (hasTags) {
        newTags = normalizeTags(body.tags);
        if (newTags === null) {
          return res.status(400).json({ error: 'tags must be an array of up to 16 strings, each ≤ 32 chars' });
        }
      }
      const newName = hasName ? body.name.trim() : null;
      const newSubject = hasSubject ? body.subject.trim() : null;
      const newDesc = hasDesc ? (body.description.trim() ? body.description : null) : null;
      const newRec  = hasRec  ? body.recurring : null;
      const ivsParam = hasIvs && newIvs !== null ? JSON.stringify(newIvs) : null;
      const tagsParam = hasTags && newTags && newTags.length ? JSON.stringify(newTags) : null;
      const result = await sql`
        UPDATE topics
        SET name        = COALESCE(${newName}, name),
            subject     = COALESCE(${newSubject}, subject),
            description = CASE WHEN ${hasDesc} THEN ${newDesc} ELSE description END,
            intervals   = CASE WHEN ${hasIvs}  THEN ${ivsParam}::jsonb ELSE intervals END,
            recurring   = CASE WHEN ${hasRec}  THEN ${newRec} ELSE recurring END,
            tags        = CASE WHEN ${hasTags} THEN ${tagsParam}::jsonb ELSE tags END
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
