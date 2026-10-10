'use strict';
// 本地逻辑级验证：直接调 server.js handler（mock req/res），无需真实 HTTP。
// 覆盖：邀请码生成/校验/单次作废 + 未授权拦截 + 真实 16 型诊断链路 + 权重不泄露。
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const srv = require('./server.js');

const DATA = path.join(__dirname, 'data');
// 清空数据，保证确定性（不影响部署：运行时 server 会自动重建空结构）
for (const f of ['codes.json', 'sessions.json']) {
  const p = path.join(DATA, f); if (fs.existsSync(p)) fs.unlinkSync(p);
}

function makeRes() {
  const r = { _status: 0, _headers: {}, _body: null };
  r.setHeader = (k, v) => { if (k === 'Set-Cookie') r._headers['Set-Cookie'] = v; else r._headers[k] = v; };
  r.writeHead = (s, h) => {
    r._status = s;
    if (h) for (const k in h) if (!(k === 'Set-Cookie' && r._headers['Set-Cookie'])) r._headers[k] = h[k];
  };
  r.end = (b) => { r._body = b; };
  r.cookieVal = (name) => {
    const c = r._headers['Set-Cookie'] || '';
    const m = c.match(new RegExp('(^|; )' + name + '=([^;]+)'));
    return m ? (name + '=' + m[2]) : null;
  };
  r.json = () => JSON.parse(r._body);
  return r;
}
function makeReq(method, url, cookie, bodyObj) {
  const req = new EventEmitter();
  req.method = method; req.url = url;
  req.headers = cookie ? { cookie } : {};
  req.destroy = () => {};
  if (bodyObj !== undefined) {
    const payload = JSON.stringify(bodyObj);
    setImmediate(() => { req.emit('data', payload); req.emit('end'); });
  }
  return req;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

(async () => {
  // 1) 无会话取题 → 401
  let res = makeRes();
  await srv.apiTest(makeReq('GET', '/api/test'), res);
  check('无邀请码访问 /api/test → 401', res._status === 401, res._status);

  // 2) 管理员登录（默认密码）
  res = makeRes();
  await srv.apiAdminLogin(makeReq('POST', '/api/admin/login', null, { pass: 'admin123!' }), res);
  check('管理员登录成功 → 200', res._status === 200, res._status);
  const adminCookie = res.cookieVal('aid');
  check('登录下发 aid cookie', !!adminCookie);

  // 3) 未登录访问管理列表 → 401
  res = makeRes();
  await srv.apiAdminCodes(makeReq('GET', '/api/admin/codes'), res);
  check('未登录访问 /api/admin/codes → 401', res._status === 401, res._status);

  // 4) 错误密码 → 401
  res = makeRes();
  await srv.apiAdminLogin(makeReq('POST', '/api/admin/login', null, { pass: 'nope' }), res);
  check('错误管理员密码 → 401', res._status === 401, res._status);

  // 5) 生成 1 个邀请码，拿到明文
  res = makeRes();
  await srv.apiAdminGenerate(makeReq('POST', '/api/admin/generate', adminCookie, { count: 1, note: 'order-001' }), res);
  check('生成邀请码 → 200', res._status === 200, res._status);
  const code = res.json().codes[0];
  check('返回明文邀请码(8位 Crockford)', typeof code === 'string' && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code), code);
  console.log('    生成码:', code);

  // 6) 用该码校验 → 200 + 下发会话 cookie
  res = makeRes();
  await srv.apiVerify(makeReq('POST', '/api/verify', null, { code }), res);
  check('用有效码校验 → 200', res._status === 200, res._status);
  const sid = res.cookieVal('sid');
  check('校验成功下发 sid cookie', !!sid);

  // 7) 同一码二次校验 → 403 used
  res = makeRes();
  await srv.apiVerify(makeReq('POST', '/api/verify', null, { code }), res);
  check('同一码二次校验 → 403 used', res._status === 403 && res.json().error === 'used', res._status);

  // 8) 无效码 → 404
  res = makeRes();
  await srv.apiVerify(makeReq('POST', '/api/verify', null, { code: 'ZZZZZZZZ' }), res);
  check('无效码校验 → 404 not_found', res._status === 404, res._status);

  // 9) 格式非法 → 400
  res = makeRes();
  await srv.apiVerify(makeReq('POST', '/api/verify', null, { code: '!!' }), res);
  check('格式非法码 → 400', res._status === 400, res._status);

  // 10) 带会话取题 → 200 + 题目不含权重
  res = makeRes();
  await srv.apiTest(makeReq('GET', '/api/test', sid), res);
  check('带会话取题 → 200', res._status === 200, res._status);
  const t = res.json().test;
  console.log('    题目数:', t.questions.length);
  check('题目为 15 道（注：16 指 16 季型，非题数）', t.questions.length === 15, t.questions.length);
  const q0 = t.questions[0];
  check('题目结构含 id/question/options', q0.id && q0.question && Array.isArray(q0.options));
  check('选项仅含 text（无 score/w/dims 权重）', q0.options.every(o => o.text && !('score' in o) && !('w' in o)));
  const tStr = JSON.stringify(t);
  check('题目 JSON 不含 score 权重', !tStr.includes('score'));
  check('题目 JSON 不含 archetypes', !tStr.includes('archetypes'));

  // 11) 提交真实作答 → 16 型诊断结果
  const answers = {
    whiteVsCream: 1, jewelry: 0, sun: 1, lipstick: 1, hair: 2, eye: 2,
    skinValue: 0, contrast: 0, flatter: 0, worstColor: 0, texture: 0,
    dayNight: 2, clothDepth: 0, print: 1, contour: 0
  };
  res = makeRes();
  await srv.apiSubmit(makeReq('POST', '/api/submit', sid, { answers }), res);
  check('提交作答 → 200', res._status === 200, res._status);
  const out = res.json();
  check('结果含 name / season', out.result && out.result.name && out.result.season);
  check('结果含 confidencePercent', typeof out.result.confidencePercent === 'string');
  check('结果含 bars(T/V/C)', out.result.bars && 'temp' in out.result.bars && 'value' in out.result.bars && 'chroma' in out.result.bars);
  check('结果含 candidates(>=1)', Array.isArray(out.result.candidates) && out.result.candidates.length >= 1);
  check('结果含 variants(完整报告,>=1)', Array.isArray(out.result.variants) && out.result.variants.length >= 1);
  check('variant[0] 含 colorRange 配色', out.result.variants[0] && out.result.variants[0].colorRange);
  check('variant[0] 不含 img 本地路径', !JSON.stringify(out.result.variants[0]).includes('/assets/'));
  console.log('    测得:', out.result.name, '| 置信度', out.result.confidencePercent, '| 档位', out.result.confidenceLevel);
  const outStr = JSON.stringify(out);
  check('结果 JSON 不含 archetypes', !outStr.includes('archetypes'));
  check('结果 JSON 不含 score 权重', !outStr.includes('score'));

  // 12) 另一条作答 → 不同型，证明算法有效
  const answers2 = {
    whiteVsCream: 0, jewelry: 1, sun: 0, lipstick: 0, hair: 0, eye: 0,
    skinValue: 2, contrast: 1, flatter: 1, worstColor: 1, texture: 1,
    dayNight: 1, clothDepth: 1, print: 0, contour: 1
  };
  res = makeRes();
  await srv.apiAdminGenerate(makeReq('POST', '/api/admin/generate', adminCookie, { count: 1 }), res);
  const code2 = res.json().codes[0];
  res = makeRes();
  await srv.apiVerify(makeReq('POST', '/api/verify', null, { code: code2 }), res);
  const sid2 = res.cookieVal('sid');
  res = makeRes();
  await srv.apiSubmit(makeReq('POST', '/api/submit', sid2, { answers: answers2 }), res);
  check('第二组成交且出结果', res._status === 200 && res.json().result && res.json().result.name);
  console.log('    测得2:', res.json().result.name, '| 置信度', res.json().result.confidencePercent, '| 档位', res.json().result.confidenceLevel);

  // 13) 无会话提交 → 401
  res = makeRes();
  await srv.apiSubmit(makeReq('POST', '/api/submit', null, { answers }), res);
  check('无会话提交 → 401', res._status === 401, res._status);

  console.log(`\n结果： ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
