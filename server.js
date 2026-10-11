'use strict';
/*
 * 邀请码测试系统 —— 零依赖 Node.js 后端
 * 运行： node server.js   （首次运行会自动生成 config.json / data/）
 *
 * 安全模型：
 *  - 邀请码仅存 SHA-256 哈希，明文只在「生成那一刻」通过接口返回一次。
 *  - 码一经校验成功立即标记 used=true（单次有效性），二次使用返回 403 used。
 *  - 校验成功后下发 HttpOnly 会话 Cookie；测试题目(/api/test)与提交(/api/submit)
 *    必须携带有效会话，否则 401 —— 无有效邀请码者无法看到任何测试内容。
 *  - 静态资源做了目录穿越防护。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// 数据目录：默认放在仓库根的 data/；部署时可用 DATA_DIR 指向持久卷（如 Railway 的 /data）
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CODES_PATH = path.join(DATA_DIR, 'codes.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const TEST_PATH = path.join(ROOT, 'test-content.json');
const diagnose = require('./diagnose');

// ---------- 配置（首次运行自动生成） ----------
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const cfg = {
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      adminPass: 'admin123!',          // 上线前务必修改（也可设环境变量 ADMIN_PASS 覆盖）
      adminSalt: crypto.randomBytes(16).toString('hex'),
      codeLength: 8,                   // 邀请码字符数（Crockford 基数 → ~40bit 熵）
      codeValidityDays: 30,            // 0 表示永不过期
      sessionTtlMinutes: 120
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // 环境变量 ADMIN_PASS 可覆盖（部署时避免在代码仓库里写死密码）
  if (process.env.ADMIN_PASS) loaded.adminPass = process.env.ADMIN_PASS;
  // 始终以运行期 PORT 为准：Railway 每次部署都会换 PORT，若用 config.json 缓存的旧端口，
  // 应用会监听在旧端口、Railway 代理却打到新端口，导致 502 / 打不开
  if (process.env.PORT) loaded.port = parseInt(process.env.PORT, 10);
  return loaded;
}
// 数据目录可能由 DATA_DIR 指定（如持久卷 /data），确保它存在再写配置
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG = ensureConfig();

// ---------- 存储 ----------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CODES_PATH)) fs.writeFileSync(CODES_PATH, JSON.stringify({ codes: [] }));
  if (!fs.existsSync(SESSIONS_PATH)) fs.writeFileSync(SESSIONS_PATH, JSON.stringify({ sessions: {}, admins: {} }));
}
ensureStore();

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function writeJSONAtomic(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

// ---------- 密码学辅助 ----------
// 去掉易混字符 I L O U，避免用户抄错
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function adminHash(pass) { return sha256(pass + ':' + CONFIG.adminSalt); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function ctimeEq(a, b) { // 恒定时间比较，防计时攻击
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- HTTP 辅助 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function getCookie(req, name) {
  const c = req.headers.cookie; if (!c) return null;
  const m = c.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setCookie(res, name, val, maxAgeSec) {
  const parts = [`${name}=${val}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`];
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ---------- 会话 / 管理态 ----------
function getSession(req) {
  const sid = getCookie(req, 'sid'); if (!sid) return null;
  const d = readJSON(SESSIONS_PATH); if (!d || !d.sessions) return null;
  const s = d.sessions[sid]; if (!s) return null;
  if (s.expiresAt && Date.now() > s.expiresAt) return null;
  return { id: sid, ...s };
}
function getAdmin(req) {
  const aid = getCookie(req, 'aid'); if (!aid) return false;
  const d = readJSON(SESSIONS_PATH); if (!d || !d.admins) return false;
  const a = d.admins[aid]; if (!a) return false;
  if (a.expiresAt && Date.now() > a.expiresAt) return false;
  return true;
}

// ---------- API ----------
async function apiVerify(req, res) {
  const body = await readBody(req);
  const raw = (body.code || '').toString().trim().toUpperCase();
  if (!/^[0-9A-Z]{4,16}$/.test(raw)) return sendJson(res, 400, { ok: false, error: 'invalid_format' });

  const hash = sha256(raw);
  const db = readJSON(CODES_PATH) || { codes: [] };
  const code = db.codes.find(c => c.hash === hash);
  if (!code) return sendJson(res, 404, { ok: false, error: 'not_found' });
  if (code.used) return sendJson(res, 403, { ok: false, error: 'used' });
  if (code.expiresAt && Date.now() > code.expiresAt) return sendJson(res, 403, { ok: false, error: 'expired' });

  // 立即作废（单次有效性）
  code.used = true;
  code.usedAt = Date.now();
  const sid = newToken();
  const sess = readJSON(SESSIONS_PATH) || { sessions: {}, admins: {} };
  sess.sessions[sid] = {
    codeId: code.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + CONFIG.sessionTtlMinutes * 60000,
    result: null
  };
  writeJSONAtomic(CODES_PATH, db);
  writeJSONAtomic(SESSIONS_PATH, sess);
  setCookie(res, 'sid', sid, CONFIG.sessionTtlMinutes * 60);
  return sendJson(res, 200, { ok: true });
}

function apiTest(req, res) {
  const sess = getSession(req);
  if (!sess) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(TEST_PATH, 'utf8')); } catch (e) { meta = {}; }
  // 题目由诊断模块提供，且已剥离 T/V/C 权重与 archetypes —— 前端拿不到评分逻辑
  const safe = {
    title: meta.title || '我的本命色 · 四季16型色彩诊断',
    intro: meta.intro || '',
    questions: diagnose.getClientQuestions()
  };
  // 若已出过结果，一并带上，刷新可看
  if (sess.result) safe.result = sess.result;
  return sendJson(res, 200, { ok: true, test: safe });
}

async function apiSubmit(req, res) {
  const sess = getSession(req);
  if (!sess) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  const body = await readBody(req);
  const answers = body.answers || {};

  let result;
  try {
    result = diagnose.diagnoseFromAnswers(answers);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'diagnose_failed' });
  }
  if (!result) return sendJson(res, 500, { ok: false, error: 'no_result' });

  const d = readJSON(SESSIONS_PATH) || { sessions: {}, admins: {} };
  if (d.sessions[sess.id]) { d.sessions[sess.id].result = result; writeJSONAtomic(SESSIONS_PATH, d); }
  return sendJson(res, 200, { ok: true, result });
}

async function apiAdminLogin(req, res) {
  const body = await readBody(req);
  const pass = (body.pass || '').toString();
  if (!ctimeEq(adminHash(pass), adminHash(CONFIG.adminPass))) return sendJson(res, 401, { ok: false, error: 'bad_pass' });
  const aid = newToken();
  const d = readJSON(SESSIONS_PATH) || { sessions: {}, admins: {} };
  d.admins[aid] = { createdAt: Date.now(), expiresAt: Date.now() + CONFIG.sessionTtlMinutes * 60000 };
  writeJSONAtomic(SESSIONS_PATH, d);
  setCookie(res, 'aid', aid, CONFIG.sessionTtlMinutes * 60);
  return sendJson(res, 200, { ok: true });
}

async function apiAdminGenerate(req, res) {
  if (!getAdmin(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  const body = await readBody(req);
  let count = parseInt(body.count, 10);
  if (isNaN(count) || count < 1) count = 1;
  if (count > 500) count = 500;
  const note = (body.note || '').toString().slice(0, 200);
  const db = readJSON(CODES_PATH) || { codes: [] };
  const out = [];
  for (let i = 0; i < count; i++) {
    const raw = randomCode(CONFIG.codeLength);
    db.codes.push({
      id: 'c' + crypto.randomBytes(6).toString('hex'),
      hash: sha256(raw),
      createdAt: Date.now(),
      used: false, usedAt: null,
      expiresAt: CONFIG.codeValidityDays > 0 ? Date.now() + CONFIG.codeValidityDays * 86400000 : null,
      note
    });
    out.push(raw);
  }
  writeJSONAtomic(CODES_PATH, db);
  return sendJson(res, 200, { ok: true, codes: out }); // 明文仅此一次返回
}

function apiAdminCodes(req, res) {
  if (!getAdmin(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  const db = readJSON(CODES_PATH) || { codes: [] };
  const list = db.codes
    .map(c => ({ id: c.id, used: c.used, usedAt: c.usedAt, createdAt: c.createdAt, expiresAt: c.expiresAt, note: c.note }))
    .sort((a, b) => b.createdAt - a.createdAt);
  return sendJson(res, 200, { ok: true, codes: list, total: list.length, used: list.filter(c => c.used).length });
}

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const safe = path.normalize(rel);
  if (safe.startsWith('..') || path.isAbsolute(safe)) return sendError(res, 403, 'forbidden');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendError(res, 403, 'forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendError(res, 404, 'not found');
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p.startsWith('/api/')) {
      if (p === '/api/verify' && req.method === 'POST') return await apiVerify(req, res);
      if (p === '/api/test' && req.method === 'GET') return apiTest(req, res);
      if (p === '/api/submit' && req.method === 'POST') return await apiSubmit(req, res);
      if (p === '/api/admin/login' && req.method === 'POST') return await apiAdminLogin(req, res);
      if (p === '/api/admin/generate' && req.method === 'POST') return await apiAdminGenerate(req, res);
      if (p === '/api/admin/codes' && req.method === 'GET') return apiAdminCodes(req, res);
      return sendError(res, 404, 'not found');
    }
    return serveStatic(req, res, p);
  } catch (e) {
    sendError(res, 500, 'server error');
  }
});

if (require.main === module) {
  server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`邀请码测试系统已启动： http://0.0.0.0:${CONFIG.port}`);
    console.log(`管理后台： http://0.0.0.0:${CONFIG.port}/admin  （默认管理员密码 admin123!，请尽快修改 config.json）`);
  });
}

// 便于单元测试：直接调用 handler（不需要起真实 HTTP 服务）
module.exports = {
  server, CONFIG,
  apiVerify, apiTest, apiSubmit, apiAdminLogin, apiAdminGenerate, apiAdminCodes,
  getSession, getAdmin
};
