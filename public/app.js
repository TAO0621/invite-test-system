'use strict';
// 用户端逻辑：三视图切换 + 服务端门禁 + 富报告渲染（渲染逻辑见 report.js）
const $ = id => document.getElementById(id);
const state = { test: null, answers: {}, current: 0, result: null, activeVariant: 0 };

function show(view) {
  ['entry', 'test', 'result'].forEach(v => {
    const el = $('view-' + v);
    if (el) el.style.display = (v === view) ? '' : 'none';
  });
}

async function boot() {
  // 进入页面先试探是否有有效会话（已用过码、刷新页面的情况）
  try {
    const r = await fetch('/api/test', { credentials: 'same-origin' });
    if (r.ok) {
      const d = await r.json();
      state.test = d.test;
      renderTitle(d.test);
      if (d.test.result) { renderResult(d.test.result); show('result'); }
      else { renderTest(); show('test'); }
      return;
    }
  } catch (e) {}
  show('entry');
}

function renderTitle(test) {
  $('siteTitle').textContent = test.title || '我的本命色';
  $('siteSub').textContent = '请输入邀请码开始';
  const intro = document.querySelector('#view-entry .sub');
  if (test.intro) intro.textContent = test.intro;
}

function renderTest() {
  state.current = 0;
  renderQuestion();
}

function renderQuestion() {
  const qs = state.test.questions;
  const i = state.current;
  const q = qs[i];
  $('stepInfo').textContent = `第 ${i + 1} / ${qs.length} 题`;
  $('progBar').style.width = ((i) / qs.length * 100) + '%';
  $('qText').textContent = q.question;
  const list = $('optList');
  list.innerHTML = '';
  q.options.forEach((o, idx) => {
    const el = document.createElement('button');
    el.className = 'opt' + (state.answers[q.id] === idx ? ' sel' : '');
    const radio = document.createElement('span');
    radio.className = 'radio';
    const txt = document.createElement('span');
    txt.className = 'otext';
    txt.textContent = o.text;
    el.appendChild(radio);
    el.appendChild(txt);
    el.onclick = () => {
      state.answers[q.id] = idx;
      [...list.children].forEach(c => c.classList.remove('sel'));
      el.classList.add('sel');
    };
    list.appendChild(el);
  });
  $('prevBtn').style.visibility = (i === 0) ? 'hidden' : 'visible';
  $('nextBtn').textContent = (i === qs.length - 1) ? '提交并查看结果' : '下一题';
  $('testMsg').textContent = '';
}

$('prevBtn').onclick = () => { if (state.current > 0) { state.current--; renderQuestion(); } };
$('nextBtn').onclick = async () => {
  const q = state.test.questions[state.current];
  if (state.answers[q.id] === undefined) { $('testMsg').textContent = '请先选择一个选项'; $('testMsg').className = 'msg err'; return; }
  if (state.current < state.test.questions.length - 1) { state.current++; renderQuestion(); return; }
  // 最后一题 → 提交
  $('nextBtn').disabled = true;
  try {
    const r = await fetch('/api/submit', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: state.answers })
    });
    const d = await r.json();
    if (d.ok) { renderResult(d.result); show('result'); }
    else { $('testMsg').textContent = '提交失败，请重试'; $('testMsg').className = 'msg err'; }
  } catch (e) {
    $('testMsg').textContent = '网络错误，请重试'; $('testMsg').className = 'msg err';
  }
  $('nextBtn').disabled = false;
};

// ---------- 结果渲染（逻辑在 report.js） ----------
function renderResult(res) {
  state.result = res;
  state.activeVariant = 0;
  buildReport();
}

function buildReport() {
  const r = state.result;
  $('resBody').innerHTML = ReportHTML(r, state.activeVariant);
  // 绑定候选切换
  $('resBody').querySelectorAll('.cand').forEach(el => {
    el.onclick = () => {
      state.activeVariant = +el.getAttribute('data-vi');
      buildReport();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
}

$('enterBtn').onclick = async () => {
  const code = $('codeInput').value.trim();
  if (!code) { $('entryMsg').textContent = '请输入邀请码'; $('entryMsg').className = 'msg err'; return; }
  $('enterBtn').disabled = true;
  $('entryMsg').textContent = '';
  try {
    const r = await fetch('/api/verify', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const d = await r.json();
    if (d.ok) {
      const t = await fetch('/api/test', { credentials: 'same-origin' });
      const td = await t.json();
      state.test = td.test; state.answers = {};
      renderTitle(td.test);
      if (td.test.result) { renderResult(td.test.result); show('result'); }
      else { renderTest(); show('test'); }
    } else {
      const map = {
        invalid_format: '邀请码格式不正确',
        not_found: '邀请码无效',
        used: '该邀请码已被使用',
        expired: '该邀请码已过期'
      };
      $('entryMsg').textContent = map[d.error] || '邀请码无效';
      $('entryMsg').className = 'msg err';
    }
  } catch (e) {
    $('entryMsg').textContent = '网络错误，请重试'; $('entryMsg').className = 'msg err';
  }
  $('enterBtn').disabled = false;
};

$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('enterBtn').click(); });
$('retestBtn').onclick = () => { if (state.result) buildReport(); };

boot();
