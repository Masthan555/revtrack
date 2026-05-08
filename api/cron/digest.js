import webpush from 'web-push';
import { sql, ensureSchema, handleError } from '../../lib/db.js';

const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];

function revOffsetDays(t, i) {
  const ivs = Array.isArray(t.intervals) && t.intervals.length > 0
    ? t.intervals
    : DEFAULT_INTERVALS;
  const N = ivs.length;
  if (!t.recurring) return i >= N ? null : ivs[i];
  const cycle = Math.floor(i / N);
  const idx = i % N;
  return cycle * ivs[N - 1] + ivs[idx];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Today in IST (the business day the digest represents). Picks the calendar
// date in Asia/Kolkata so the "due today" set matches what the user would see
// in the app when they open it.
function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function sendOne(sub, payload, uid, results) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    results.pushed++;
  } catch (e) {
    // 404/410 = subscription is dead; remove so we don't keep retrying.
    if (e.statusCode === 404 || e.statusCode === 410) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      results.pruned++;
    } else {
      console.error('push failed', { uid, status: e.statusCode, msg: e.body });
    }
  }
}

function configureVapid() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars required');
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:nobody@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

export default async function handler(req, res) {
  try {
    // Vercel Cron includes Authorization: Bearer <CRON_SECRET>. Reject anything else.
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (!process.env.CRON_SECRET || req.headers.authorization !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    configureVapid();
    await ensureSchema();

    const today = todayIST();

    // Pull every subscription; group by user.
    const subs = await sql`SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions`;
    const subsByUser = {};
    for (const s of subs) (subsByUser[s.user_id] ||= []).push(s);

    const results = { users: 0, notified: 0, pushed: 0, pruned: 0, skipped: 0 };
    const pushTasks = [];

    for (const uid of Object.keys(subsByUser)) {
      results.users++;

      const topics = await sql`
        SELECT id, added_date::text AS added_date, intervals, recurring
        FROM topics WHERE user_id = ${uid}
      `;
      const revCounts = await sql`
        SELECT r.topic_id, COUNT(*)::int AS n
        FROM revisions r
        JOIN topics t ON t.id = r.topic_id
        WHERE t.user_id = ${uid}
        GROUP BY r.topic_id
      `;
      const doneByTopic = Object.fromEntries(revCounts.map(r => [r.topic_id, r.n]));
      const doneTodayByTopic = await sql`
        SELECT topic_id FROM revisions
        WHERE done_date = ${today}
          AND topic_id IN (SELECT id FROM topics WHERE user_id = ${uid})
      `;
      const doneTodaySet = new Set(doneTodayByTopic.map(r => r.topic_id));

      // Count topics whose next due date is ≤ today AND not already done today.
      let dueCount = 0;
      for (const t of topics) {
        if (doneTodaySet.has(t.id)) continue;
        const i = doneByTopic[t.id] || 0;
        const off = revOffsetDays(t, i);
        if (off === null) continue; // mastered
        if (addDays(t.added_date, off) <= today) dueCount++;
      }

      if (dueCount === 0) {
        results.skipped++;
        continue;
      }
      results.notified++;

      const payload = JSON.stringify({
        title: dueCount === 1 ? '1 topic due for revision' : `${dueCount} topics due for revision`,
        body: 'Tap to review and mark them done.',
      });

      // Queue one promise per subscription; we'll await all of them together
      // below so total cron time stays near max(single push) instead of sum.
      for (const sub of subsByUser[uid]) {
        pushTasks.push(sendOne(sub, payload, uid, results));
      }
    }

    await Promise.all(pushTasks);

    return res.status(200).json({ date: today, ...results });
  } catch (e) {
    return handleError(res, e, 'api/cron/digest');
  }
}
