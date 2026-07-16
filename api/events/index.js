// api/events/index.js  —  CRUD for timetable events
const { Redis } = require('@upstash/redis');

function getClient() { return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN }); }

module.exports = async (req, ctx) => {
  const token = req.headers.authorization || '';
  if (!token) return { json: { ok: false, message: '需要登录' } };

  const redis = getClient();

  // Find user by token
  const keys = await redis.scanMatch('user:*');
  let username = '';
  for (const k of (keys || [])) {
    const u = await redis.get(k);
    if (u) {
      const d = typeof u === 'string' ? JSON.parse(u) : u;
      if (d.token === token) { username = d.username; break; }
    }
  }
  if (!username) return { json: { ok: false, message: '令牌无效' } };

  const dataKey = `events:${username}`;

  try {
    // GET — fetch all events
    if (req.method === 'GET') {
      const raw = await redis.get(dataKey);
      return { json: { ok: true, events: raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [] } };
    }

    const body = JSON.parse(req.body);

    // POST — save full event list (overwrite)
    if (req.method === 'POST') {
      await redis.set(dataKey, JSON.stringify(body.events || []));
      return { json: { ok: true } };
    }

    // DELETE — clear all
    if (req.method === 'DELETE') {
      await redis.del(dataKey);
      return { json: { ok: true } };
    }

    return { json: { ok: false, message: '方法不支持' } };
  } catch (err) {
    return { json: { ok: false, message: err.message } };
  }
};
