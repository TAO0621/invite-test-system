'use strict';
const $ = id => document.getElementById(id);

function show(...views) {
  ['login', 'dash', 'list'].forEach(v => { $('view-' + v).style.display = views.includes(v) ? '' : 'none'; });
}

async function boot() {
  // 试探是否已有管理员会话
  try {
    const r = await fetch('/api/admin/codes', { credentials: 'same-origin' });
    if (r.ok) { dash(); return; }
  } catch (e) {}
  show('login');
}

function dash() { show('dash', 'list'); loadCodes(); }

$('loginBtn').onclick = async () => {
  const pass = $('passInput').value;
  if (!pass) { $('loginMsg').textContent = '请输入密码'; $('loginMsg').className = 'msg err'; return; }
  $('loginBtn').disabled = true;
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass })
    });
    const d = await r.json();
    if (d.ok) dash();
    else { $('loginMsg').textContent = '密码错误'; $('loginMsg').className = 'msg err'; }
  } catch (e) { $('loginMsg').textContent = '网络错误'; $('loginMsg').className = 'msg err'; }
  $('loginBtn').disabled = false;
};
$('passInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

$('genBtn').onclick = async () => {
  const count = parseInt($('countInput').value, 10) || 1;
  const note = $('noteInput').value.trim();
  $('genBtn').disabled = true;
  try {
    const r = await fetch('/api/admin/generate', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, note })
    });
    const d = await r.json();
    if (d.ok) {
      $('genCodes').textContent = d.codes.join('\n');
      $('genOut').style.display = 'block';
      $('genMsg').textContent = `已生成 ${d.codes.length} 个邀请码（明文仅此一次显示）`;
      $('genMsg').className = 'msg ok';
      loadCodes();
    } else { $('genMsg').textContent = '生成失败：' + (d.error || ''); $('genMsg').className = 'msg err'; }
  } catch (e) { $('genMsg').textContent = '网络错误'; $('genMsg').className = 'msg err'; }
  $('genBtn').disabled = false;
};

$('copyAllBtn').onclick = async () => {
  const txt = $('genCodes').textContent;
  try { await navigator.clipboard.writeText(txt); $('copyAllBtn').textContent = '已复制'; setTimeout(() => $('copyAllBtn').textContent = '复制全部', 1500); }
  catch (e) { $('genMsg').textContent = '复制失败，请手动选择'; }
};

function fmt(ts) { if (!ts) return '-'; const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

async function loadCodes() {
  try {
    const r = await fetch('/api/admin/codes', { credentials: 'same-origin' });
    const d = await r.json();
    if (!d.ok) { show('login'); return; }
    $('statTotal').textContent = d.total;
    $('statUsed').textContent = d.used;
    $('statUnused').textContent = d.total - d.used;
    const tb = document.querySelector('#codeTable tbody');
    tb.innerHTML = '';
    d.codes.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="code-cell">••••••••</td>` +
        `<td><span class="pill u${c.used ? 1 : 0}">${c.used ? '已使用' : '未使用'}</span></td>` +
        `<td>${c.note ? escapeHtml(c.note) : '-'}</td>` +
        `<td>${fmt(c.createdAt)}</td>`;
      tb.appendChild(tr);
    });
  } catch (e) {}
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

$('refreshBtn').onclick = loadCodes;
$('exportBtn').onclick = async () => {
  try {
    const r = await fetch('/api/admin/codes', { credentials: 'same-origin' });
    const d = await r.json();
    if (!d.ok) return;
    const rows = [['id', 'used', 'note', 'createdAt', 'usedAt']];
    d.codes.forEach(c => rows.push([c.id, c.used ? 1 : 0, c.note || '', c.createdAt || '', c.usedAt || '']));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'invite-codes.csv'; a.click();
  } catch (e) {}
};
$('logoutBtn').onclick = () => { show('login'); $('passInput').value = ''; };

boot();
