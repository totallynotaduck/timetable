// api/auth/[...action].js — register / login / verify / logout
const Redis = require('ioredis');
const bcrypt = require('bcryptjs');

// Vercel Redis integration sets REDIS_URL (direct Redis URL).
const redis = new Redis(process.env.REDIS_URL || process.env.KV_URL || '');

function userKey(uid) { return `user:${uid}`; }
function sessionKey(token) { return `session:${token}`; }
function eventsKey(username) { return `events:${username}`; }

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req) => {
  // Parse action from URL path: /api/auth/register -> ['register']
  let action = [];
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 3) action = parts.slice(2);
  } catch {}

  // --- register ---
  if (action[0] === 'register' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return new Response(JSON.stringify({ ok: false, message: 'invalid JSON' }), { status: 400 });
    }
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ ok: false, message: '请填写用户名和密码' }), { status: 400 });
    }
    const uid = username.toLowerCase().trim();
    const existing = await redis.get(userKey(uid));
    if (existing) {
      return new Response(JSON.stringify({ ok: false, message: '用户名已存在' }), { status: 409 });
    }
    const token = generateToken();
    const hashed = bcrypt.hashSync(password, 10);
    await redis.set(userKey(uid), JSON.stringify({ username: uid, password: hashed, token }));
    await redis.set(sessionKey(token), uid, { EX: 60 * 60 * 24 * 30 });
    return new Response(JSON.stringify({ ok: true, token, username: uid }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `session=${token}; HttpOnly; Max-Age=${60*60*24*30}; Path=/` },
    });
  }

  // --- login ---
  if (action[0] === 'login' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return new Response(JSON.stringify({ ok: false, message: 'invalid JSON' }), { status: 400 });
    }
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ ok: false, message: '请填写用户名和密码' }), { status: 400 });
    }
    const uid = username.toLowerCase().trim();
    const raw = await redis.get(userKey(uid));
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, message: '用户名或密码错误' }), { status: 401 });
    }
    const user = JSON.parse(raw);
    if (!bcrypt.compareSync(password, user.password)) {
      return new Response(JSON.stringify({ ok: false, message: '用户名或密码错误' }), { status: 401 });
    }
    const token = generateToken();
    user.token = token;
    await redis.set(userKey(uid), JSON.stringify(user));
    await redis.set(sessionKey(token), uid, { EX: 60 * 60 * 24 * 30 }); // 30 days
    return new Response(JSON.stringify({ ok: true, token, username: uid }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `session=${token}; HttpOnly; Max-Age=${60*60*24*30}; Path=/` },
    });
  }

  // --- verify ---
  if (action[0] === 'verify' && req.method === 'GET') {
    const token = req.headers.get('authorization') || '';
    let userId = null;
    if (token) {
      userId = await redis.get(sessionKey(token));
    }
    // Also check cookie
    if (!userId) {
      const cookieHeader = req.headers.get('cookie') || '';
      const m = cookieHeader.match(/session=([^;]+)/);
      if (m) {
        userId = await redis.get(sessionKey(m[1]));
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, message: '未登录' }), { status: 401 });
    }
    const raw = await redis.get(userKey(userId));
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, message: '未登录' }), { status: 401 });
    }
    const user = JSON.parse(raw);
    return new Response(JSON.stringify({ ok: true, username: user.username, token: user.token }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- logout ---
  if (action[0] === 'logout' && req.method === 'POST') {
    const token = req.headers.get('authorization') || '';
    if (token) await redis.del(sessionKey(token));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; HttpOnly; Max-Age=0; Path=/' },
    });
  }

  // --- get events (GET) ---
  if (action[0] === 'events' && req.method === 'GET') {
    let userId = null;
    const token = req.headers.get('authorization') || '';
    if (token) {
      userId = await redis.get(sessionKey(token));
    }
    if (!userId) {
      const cookieHeader = req.headers.get('cookie') || '';
      const m = cookieHeader.match(/session=([^;]+)/);
      if (m) {
        userId = await redis.get(sessionKey(m[1]));
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, message: '需要登录' }), { status: 401 });
    }
    const raw = await redis.get(eventsKey(userId));
    return new Response(JSON.stringify({ ok: true, events: raw ? JSON.parse(raw) : [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- save events (POST/PUT) ---
  if ((action[0] === 'events') && (req.method === 'POST' || req.method === 'PUT')) {
    let userId = null;
    const token = req.headers.get('authorization') || '';
    if (token) {
      userId = await redis.get(sessionKey(token));
    }
    if (!userId) {
      const cookieHeader = req.headers.get('cookie') || '';
      const m = cookieHeader.match(/session=([^;]+)/);
      if (m) {
        userId = await redis.get(sessionKey(m[1]));
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, message: '需要登录' }), { status: 401 });
    }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return new Response(JSON.stringify({ ok: false, message: 'invalid JSON' }), { status: 400 });
    }
    await redis.set(eventsKey(userId), JSON.stringify(body.events || []));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- delete events (DELETE) ---
  if (action[0] === 'events' && req.method === 'DELETE') {
    let userId = null;
    const token = req.headers.get('authorization') || '';
    if (token) {
      userId = await redis.get(sessionKey(token));
    }
    if (!userId) {
      const cookieHeader = req.headers.get('cookie') || '';
      const m = cookieHeader.match(/session=([^;]+)/);
      if (m) {
        userId = await redis.get(sessionKey(m[1]));
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, message: '需要登录' }), { status: 401 });
    }
    await redis.del(eventsKey(userId));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: false, message: '未知操作' }), { status: 405 });
};
