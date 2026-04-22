import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const uid = await getSessionUser(req);

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { topicId, doneDate } = req.body || {};
    if (!topicId || !doneDate) {
      return res.status(400).json({ error: 'topicId and doneDate required' });
    }

    const [owner] = await sql`SELECT user_id FROM topics WHERE id = ${topicId}`;
    if (!owner || owner.user_id !== uid) {
      return res.status(404).json({ error: 'topic not found' });
    }

    await sql`
      INSERT INTO revisions (topic_id, done_date) VALUES (${topicId}, ${doneDate})
      ON CONFLICT (topic_id, done_date) DO NOTHING
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return handleError(res, e, 'api/revisions');
  }
}
