// api/auth/[...action].js  —  register / login
const { Redis } = require('@upstash/redis');

function getClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN;
  return new Redis({ url, token });
}

module.exports = async (req, ctx) => {
  const { action = [] } = ctx.query;
  const method = req.method === 'POST' ? 'post' : 'get';

  if (method === 'get') {
    return { json: { ok: true, message: 'auth ok' } };
  }

  try {
    const body = JSON.parse(req.body);
    const redis = getClient();

    // --- register ---
    if (action[0] === 'register') {
      const { username, password } = body;
      if (!username || !password) return { json: { ok: false, message: '请填写用户名和密码' } };
      const exists = await redis.get(`user:${username}`);
      if (exists) return { json: { ok: false, message: '用户名已存在' } };
      await redis.set(`user:${username}`, JSON.stringify({ username, password, token: crypto.randomUUID() }));
      return { json: { ok: true, token: crypto.randomUUID(), username } };
    }

    // --- login ---
    if (action[0] === 'login') {
      const { username, password } = body;
      const user = await redis.get(`user:${username}`);
      if (!user) return { json: { ok: false, message: '用户名或密码错误' } };
      const data = typeof user === 'string' ? JSON.parse(user) : user;
      if (data.password !== password) return { json: { ok: false, message: '用户名或密码错误' } };
      data.token = crypto.randomUUID();
      await redis.set(`user:${username}`, JSON.stringify(data));
      return { json: { ok: true, token: data.token, username } };
    }

    // --- verify ---
    if (action[0] === 'verify') {
      const { token } = body;
      const users = await redis.scanMatch(`user:*`);
      for (const k of (users || [])) {
        const u = await redis.get(k);
        if (u && (typeof u === 'string' ? JSON.parse(u) : u).token === token) {
          return { json: { ok: true, username: (typeof u === 'string' ? JSON.parse(u) : u).username } };
        }
      }
      return { json: { ok: false, message: '无效令牌' } };
    }

    return { json: { ok: false, message: '未知操作' } };
  } catch (err) {
    return { json: { ok: false, message: err.message } };
  }
};
