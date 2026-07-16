// api/index.js — unified serverless API: register / login / verify / logout / events
// Uses Upstash Redis (REST, works on Vercel serverless).
const { Redis } = require('@upstash/redis');
const bcrypt = require('bcryptjs');

function getClient() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

function userKey(uid) { return `user:${uid}`; }
function sessionKey(token) { return `session:${token}`; }
function eventsKey(uid) { return `events:${uid}`; }

function generateToken() {
  const arr = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
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

function corsHeaders() {
  // Comma-separated list of allowed origins in ALLOWED_ORIGINS, or '*'.
  const allowed = (process.env.ALLOWED_ORIGINS || '*')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = allowed.includes('*') ? '*' : allowed.join(',');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

function cookieOpts() {
  // SameSite=None + Secure is required so the cookie is sent cross-site
  // (GitHub Pages front-end -> Vercel API). On localhost Secure is dropped.
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  return `Path=/; HttpOnly; ${secure}SameSite=None; Max-Age=${60 * 60 * 24 * 30}`;
}

async function getUserId(req, redis) {
  let token = '';
  const auth = req.headers.get('authorization');
  if (auth) token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const cookieHeader = req.headers.get('cookie') || '';
    const m = cookieHeader.match(/session=([^;]+)/);
    if (m) token = m[1];
  }
  if (!token) return null;
  return await redis.get(sessionKey(token));
}

module.exports = async (req) => {
  const redis = getClient();

  // Parse action from URL: /api/register, /api/login, /api/events, etc.
  let action = 'index';
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'login']
    if (parts.length >= 2) action = parts[1];
  } catch {}

  const method = req.method;

  // --- CORS preflight ---
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // --- register ---
  if (action === 'register' && method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return json({ ok: false, message: 'invalid JSON' }, 400);
    }
    const { username, password } = body;
    if (!username || !password) {
      return json({ ok: false, message: '请填写用户名和密码' }, 400);
    }
    if (String(password).length < 4) {
      return json({ ok: false, message: '密码至少 4 位' }, 400);
    }
    const uid = String(username).toLowerCase().trim();
    const existing = await redis.get(userKey(uid));
    if (existing) {
      return json({ ok: false, message: '用户名已存在' }, 409);
    }
    const token = generateToken();
    const hashed = bcrypt.hashSync(password, 10);
    await redis.set(userKey(uid), JSON.stringify({ username: uid, password: hashed, token }));
    await redis.set(sessionKey(token), uid, { ex: 60 * 60 * 24 * 30 });
    return json(
      { ok: true, token, username: uid },
      200,
      { 'Set-Cookie': `session=${token}; ${cookieOpts()}` }
    );
  }

  // --- login ---
  if (action === 'login' && method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return json({ ok: false, message: 'invalid JSON' }, 400);
    }
    const { username, password } = body;
    if (!username || !password) {
      return json({ ok: false, message: '请填写用户名和密码' }, 400);
    }
    const uid = String(username).toLowerCase().trim();
    const raw = await redis.get(userKey(uid));
    if (!raw) return json({ ok: false, message: '用户名或密码错误' }, 401);
    const user = JSON.parse(raw);
    if (!bcrypt.compareSync(password, user.password)) {
      return json({ ok: false, message: '用户名或密码错误' }, 401);
    }
    const token = generateToken();
    user.token = token;
    await redis.set(userKey(uid), JSON.stringify(user));
    await redis.set(sessionKey(token), uid, { ex: 60 * 60 * 24 * 30 });
    return json(
      { ok: true, token, username: uid },
      200,
      { 'Set-Cookie': `session=${token}; ${cookieOpts()}` }
    );
  }

  // --- verify ---
  if (action === 'verify' && method === 'GET') {
    const uid = await getUserId(req, redis);
    if (!uid) return json({ ok: false, message: '未登录' }, 401);
    const raw = await redis.get(userKey(uid));
    if (!raw) return json({ ok: false, message: '未登录' }, 401);
    const user = JSON.parse(raw);
    return json({ ok: true, username: user.username, token: user.token });
  }

  // --- logout ---
  if (action === 'logout' && method === 'POST') {
    const auth = req.headers.get('authorization');
    let token = auth ? auth.replace(/^Bearer\s+/i, '').trim() : '';
    if (!token) {
      const cookieHeader = req.headers.get('cookie') || '';
      const m = cookieHeader.match(/session=([^;]+)/);
      if (m) token = m[1];
    }
    if (token) await redis.del(sessionKey(token));
    return json({ ok: true }, 200, { 'Set-Cookie': `session=; ${cookieOpts().replace(/Max-Age=\d+/, 'Max-Age=0')}` });
  }

  // --- events (GET/POST/DELETE) require login ---
  if (action === 'events' && (method === 'GET' || method === 'POST' || method === 'DELETE' || method === 'PUT')) {
    const uid = await getUserId(req, redis);
    if (!uid) return json({ ok: false, message: '需要登录' }, 401);
    const dataKey = eventsKey(uid);

    if (method === 'GET') {
      const raw = await redis.get(dataKey);
      return json({ ok: true, events: raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [] });
    }

    if (method === 'DELETE') {
      await redis.del(dataKey);
      return json({ ok: true });
    }

    // POST / PUT — overwrite full list
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      return json({ ok: false, message: 'invalid JSON' }, 400);
    }
    await redis.set(dataKey, JSON.stringify(body.events || []));
    return json({ ok: true });
  }

  return json({ ok: false, message: '未知操作' }, 405);
};
