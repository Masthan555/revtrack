import { handleError } from '../../lib/db.js';

// Returns the public VAPID key so the browser can subscribe to push.
// Safe to expose — the private key stays on the server.
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
    }
    return res.status(200).json({ publicKey });
  } catch (e) {
    return handleError(res, e, 'api/push/vapid-key');
  }
}
