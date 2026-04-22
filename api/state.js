import { sql, ensureSchema, getSessionUser, handleError } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const uid = await getSessionUser(req);

    const [subjects, topics, revisions] = await Promise.all([
      sql`SELECT name, pi FROM subjects WHERE user_id = ${uid} ORDER BY name`,
      sql`SELECT id, subject, name, added_date::text AS added_date
          FROM topics WHERE user_id = ${uid} ORDER BY added_date`,
      sql`SELECT r.topic_id, r.done_date::text AS done_date
          FROM revisions r
          JOIN topics t ON t.id = r.topic_id
          WHERE t.user_id = ${uid}
          ORDER BY r.done_date`,
    ]);

    const rt_s = subjects.map(r => ({ name: r.name, pi: r.pi }));
    const rt_t = topics.map(r => ({
      id: r.id, subject: r.subject, name: r.name, addedDate: r.added_date,
    }));
    const rt_d = {};
    for (const r of revisions) {
      (rt_d[r.topic_id] ||= []).push(r.done_date);
    }

    return res.status(200).json({ rt_s, rt_t, rt_d });
  } catch (e) {
    return handleError(res, e, 'api/state');
  }
}
