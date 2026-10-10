'use strict';
const http = require('http');
function get(p, cookie) {
  return new Promise((resolve, reject) => {
    const opt = { host: '127.0.0.1', port: 3000, path: p };
    if (cookie) opt.headers = { cookie };
    const req = http.get(opt, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, len: d.length }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}
(async () => {
  try {
    console.log('GET /            ->', (await get('/')).status);
    console.log('GET /styles.css  ->', (await get('/styles.css')).status);
    console.log('GET /app.js      ->', (await get('/app.js')).status);
    console.log('GET /admin       ->', (await get('/admin')).status);
    console.log('GET /api/test(无会话) ->', (await get('/api/test')).status, '(期望 401)');
    console.log('GET 目录穿越     ->', (await get('/../server.js')).status, '(期望 403/404)');
    console.log('GET 不存在文件  ->', (await get('/nope.txt')).status, '(期望 404)');
  } catch (e) { console.log('ERR', e.message); }
})();
