'use strict';
/*
 * 我的本命色 · 四季16型诊断算法（网页版移植）
 * --------------------------------------------------------------
 * 从「小程序 utils/diagnose.js」完整移植：将问卷作答映射为三维色彩向量
 *   T（冷暖） / V（明度） / C（纯度）
 * 再与 16 个原型向量求欧氏距离取最近者，并给出复合置信度 + 候选季型。
 *
 * 移植要点：
 *  - 全部评分逻辑在服务端完成，前端只拿「剥离权重后的题目」与「最终结果」，
 *    绝不会拿到 T/V/C 分值、archetypes 或选项权重（防窥探评分逻辑）。
 *  - 型资料（名称/季型/配色/服装/妆容/发色等）来自本地 types-data.json
 *    （由小程序 colorData.js 提取、已剔除本地图片路径，自包含可部署）。
 */

const fs = require('fs');
const path = require('path');

// ---------- 型资料 ----------
const TYPE_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'types-data.json'), 'utf8'));
const TYPES = TYPE_DATA.TYPES;
const SEASON_THEME = TYPE_DATA.SEASON_THEME;
const SEASON_EN_MAP = { '春': 'Spring', '夏': 'Summer', '秋': 'Autumn', '冬': 'Winter' };

function getType(id) { return TYPES.find(t => t.id === id) || null; }
function getSeasonTheme(season) { return SEASON_THEME[season] || '#d9a441'; }

// ---------- 16 道问卷题目（12 主判 + 4 维度补充） ----------
const questions = [
  // ===== 冷暖 T =====
  {
    id: 'whiteVsCream',
    title: '试穿纯白与米白，哪种更提气色？',
    dims: ['T'], w: 2.0,
    options: [
      { label: '纯白更精神、更干净', score: { T: -1.2 } },
      { label: '米白更柔和、更衬脸', score: { T: 1.2 } },
      { label: '两种都差不多', score: { T: 0 } }
    ]
  },
  {
    id: 'jewelry',
    title: '戴哪种金属首饰更衬肤色？',
    dims: ['T'], w: 1.5,
    options: [
      { label: '金色更显气色', score: { T: 1 } },
      { label: '银色更显气色', score: { T: -1 } },
      { label: '差不多', score: { T: 0 } }
    ]
  },
  {
    id: 'sun',
    title: '晒太阳后皮肤通常？',
    dims: ['T'], w: 1.0,
    options: [
      { label: '容易晒红、不易晒黑', score: { T: -1 } },
      { label: '很快晒黑', score: { T: 1 } },
      { label: '又红又黑', score: { T: 0 } }
    ]
  },
  {
    id: 'lipstick',
    title: '哪种口红/腮红更自然好看？',
    dims: ['T'], w: 1.2, check: true,
    options: [
      { label: '豆沙粉、冷玫瑰调', score: { T: -1 } },
      { label: '橘调珊瑚、蜜桃调', score: { T: 1 } },
      { label: '都可以', score: { T: 0 } }
    ]
  },
  // ===== 明度 V =====
  {
    id: 'hair',
    title: '你的自然发色更接近？',
    dims: ['V'], w: 1.2,
    options: [
      { label: '乌黑 / 偏冷的深棕', score: { T: -0.5, V: -1 } },
      { label: '栗棕 / 偏暖的棕', score: { T: 1, V: 0 } },
      { label: '浅金 / 亚麻', score: { T: 0.5, V: 1 } },
      { label: '灰白 / 花白', score: { T: -0.3, V: 1 } }
    ]
  },
  {
    id: 'eye',
    title: '你的瞳孔 / 眼珠颜色更接近？',
    dims: ['V'], w: 1.5,
    options: [
      { label: '深邃黑', score: { V: -1, C: 0.5 } },
      { label: '深棕', score: { T: -0.3, V: -0.5 } },
      { label: '浅棕 / 琥珀', score: { T: 0.6, V: 0 } },
      { label: '黑曜带冷调', score: { T: -0.5 } }
    ]
  },
  {
    id: 'skinValue',
    title: '你的肤色明度更接近？',
    dims: ['V'], w: 1.2,
    options: [
      { label: '白皙', score: { V: 1.5 } },
      { label: '中等', score: { V: 0 } },
      { label: '偏深 / 小麦色', score: { V: -1.5 } }
    ]
  },
  // ===== 纯度 C =====
  {
    id: 'contrast',
    title: '五官与肤色的对比度？',
    dims: ['C'], w: 1.5,
    options: [
      { label: '柔和，对比弱', score: { C: -1 } },
      { label: '鲜明，对比强', score: { C: 1 } },
      { label: '适中', score: { C: 0 } }
    ]
  },
  {
    id: 'flatter',
    title: '穿什么颜色最显气色？',
    dims: ['V', 'C'], w: 1.0,
    options: [
      { label: '柔和浊色、大地色', score: { C: -0.5, T: 0.5 } },
      { label: '鲜明纯色、冷色调', score: { C: 0.5, T: -0.5 } },
      { label: '浅淡色系', score: { V: 0.5 } },
      { label: '浓重深色系', score: { V: -0.5 } }
    ]
  },
  {
    id: 'worstColor',
    title: '你最不敢穿的颜色是？',
    dims: ['C'], w: 1.3, check: true,
    options: [
      { label: '正黑、纯白等高对比色', score: { C: -0.8 } },
      { label: '荧光色、高饱和撞色', score: { C: 0.8 } },
      { label: '都还好，不太挑', score: { C: 0 } }
    ]
  },
  {
    id: 'texture',
    title: '哪种面料质感上身更好看？',
    dims: ['C'], w: 1.0,
    options: [
      { label: '哑光、绒面、亚麻', score: { C: -0.6 } },
      { label: '光泽、丝缎、亮面', score: { C: 0.6 } },
      { label: '都可', score: { C: 0 } }
    ]
  },
  // ===== 维度补充判定 =====
  {
    id: 'dayNight',
    title: '白天还是晚上的状态更好？',
    dims: ['V'], w: 1.0,
    options: [
      { label: '白天精神、面色更好', score: { V: 0.4 } },
      { label: '晚上更显气色', score: { V: -0.4 } },
      { label: '都一样', score: { V: 0 } }
    ]
  },
  {
    id: 'clothDepth',
    title: '你衣橱里的主色调偏浅还是偏深？',
    dims: ['V'], w: 1.2,
    options: [
      { label: '浅色为主（米白、浅蓝、浅粉）', score: { V: 0.8 } },
      { label: '深色为主（黑、藏蓝、墨绿）', score: { V: -0.8 } },
      { label: '深浅各半', score: { V: 0 } }
    ]
  },
  {
    id: 'print',
    title: '印花 / 图案你更能驾驭？',
    dims: ['C'], w: 1.1,
    options: [
      { label: '大块纯色、撞色几何', score: { C: 0.6 } },
      { label: '碎花、渐变、低对比小图案', score: { C: -0.6 } },
      { label: '都能穿', score: { C: 0 } }
    ]
  },
  {
    id: 'contour',
    title: '你的五官轮廓给别人的印象是？',
    dims: ['C'], w: 1.3,
    options: [
      { label: '柔和，线条圆润', score: { C: -0.8 } },
      { label: '清晰，线条利落', score: { C: 0.8 } },
      { label: '介于两者之间', score: { C: 0 } }
    ]
  }
];

// 16 型原型向量
const archetypes = [
  { id: 'clear_spring', T: 0.8, V: 1.2, C: 1.0 },
  { id: 'light_spring', T: 0.8, V: 1.2, C: -0.3 },
  { id: 'soft_spring', T: 0.6, V: 0.5, C: -0.9 },
  { id: 'bright_spring', T: 0.6, V: 0.5, C: 0.6 },
  { id: 'light_summer', T: -0.8, V: 1.2, C: -0.3 },
  { id: 'soft_summer', T: -0.7, V: 0.5, C: -0.9 },
  { id: 'bright_summer', T: -0.6, V: 0.5, C: 0.6 },
  { id: 'deep_summer', T: -0.7, V: -0.5, C: -0.3 },
  { id: 'soft_autumn', T: 0.6, V: -0.5, C: -0.6 },
  { id: 'bright_autumn', T: 0.7, V: 0.0, C: 0.5 },
  { id: 'deep_autumn', T: 0.8, V: -0.5, C: 0.0 },
  { id: 'light_autumn', T: 0.5, V: 1.2, C: -1.0 },
  { id: 'soft_winter', T: -0.7, V: -0.5, C: -0.9 },
  { id: 'bright_winter', T: -0.6, V: 0.0, C: 0.6 },
  { id: 'deep_winter', T: -0.7, V: -1.2, C: -0.3 },
  { id: 'clear_winter', T: -0.8, V: 1.2, C: 1.0 }
];

const DIM_LABELS = {
  T: { label: '冷暖', cold: '偏冷调', warm: '偏暖调' },
  V: { label: '明度', cold: '偏浅（明度高）', warm: '偏深（明度低）' },
  C: { label: '纯度', cold: '偏柔和浊色', warm: '偏鲜明清透' }
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function toBars(T, V, C) {
  return {
    temp: Math.round(clamp(((T + 1.5) / 3) * 100, 0, 100)),
    value: Math.round(clamp(((V + 1.5) / 3) * 100, 0, 100)),
    chroma: Math.round(clamp(((C + 1) / 2) * 100, 0, 100))
  };
}

function rankedArchetypes(T, V, C) {
  return archetypes
    .map(a => ({ id: a.id, d: (a.T - T) ** 2 + (a.V - V) ** 2 + (a.C - C) ** 2, vec: a }))
    .sort((a, b) => a.d - b.d);
}

const DIM_TOTAL_WEIGHT = (() => {
  const acc = { T: 0, V: 0, C: 0 };
  questions.forEach(q => {
    const w = q.w == null ? 1 : q.w;
    q.dims.forEach(d => { acc[d] += w; });
  });
  return acc;
})();

const NORM = {
  T: 1.5 / DIM_TOTAL_WEIGHT.T,
  V: 1.2 / DIM_TOTAL_WEIGHT.V,
  C: 1.0 / DIM_TOTAL_WEIGHT.C
};

function computeConsistency(answers) {
  const perDim = { T: [], V: [], C: [] };
  questions.forEach(q => {
    const idx = answers[q.id];
    if (idx === undefined) return;
    const opt = q.options[idx];
    if (!opt || !opt.score) return;
    const w = q.w == null ? 1 : q.w;
    const signed = { T: 0, V: 0, C: 0 };
    q.dims.forEach(d => { signed[d] = (opt.score[d] || 0) * w; });
    let main = null, absMax = 0;
    ['T', 'V', 'C'].forEach(d => {
      const v = Math.abs(signed[d]);
      if (v > absMax) { absMax = v; main = d; }
    });
    if (!main || absMax === 0) return;
    perDim[main].push(signed[main]);
  });
  let sum = 0, n = 0;
  ['T', 'V', 'C'].forEach(d => {
    const arr = perDim[d];
    if (arr.length < 2) return;
    let agree = 0, pairs = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        pairs++;
        if ((arr[i] > 0) === (arr[j] > 0)) agree++;
      }
    }
    if (pairs === 0) return;
    sum += agree / pairs;
    n++;
  });
  return n === 0 ? 1 : sum / n;
}

function marginScore(T, V, C) {
  const dists = rankedArchetypes(T, V, C);
  const best = dists[0];
  const second = dists[1];
  if (!second) return 1;
  return clamp(1 - best.d / Math.max(second.d, 0.0001), 0, 1);
}

function computeConfidence(T, V, C, consistency) {
  const m = marginScore(T, V, C);
  let c;
  if (consistency == null) {
    const n = questions.length || 1;
    c = n < 10 ? n / 10 : 1;
  } else {
    c = clamp(consistency, 0, 1);
  }
  return clamp(0.5 * m + 0.5 * c, 0, 1);
}

function confidenceLevel(conf) {
  if (conf >= 0.7) return 'high';
  if (conf >= 0.4) return 'medium';
  return 'low';
}

const CONF_DISPLAY_FLOOR = 6;
function displayPercent(conf) {
  return Math.max(CONF_DISPLAY_FLOOR, Math.round(clamp(conf, 0, 1) * 100)) + '%';
}

const CONF_CANDIDATE_FLOOR = 1;
function candidatePercents(T, V, C, conf) {
  const ranked = rankedArchetypes(T, V, C).slice(0, 2);
  if (!ranked.length) return [];
  const p1 = Math.max(CONF_DISPLAY_FLOOR, Math.round(clamp(conf, 0, 1) * 100));
  const out = [{ id: ranked[0].id, percent: p1 }];
  if (ranked.length < 2 || p1 >= 100) return out;
  const EPS = 0.01;
  const ratio = clamp((ranked[0].d + EPS) / (ranked[1].d + EPS), 0, 1);
  const cap = Math.max(CONF_CANDIDATE_FLOOR, Math.min(p1 - 1, 100 - p1));
  const p2 = clamp(Math.round(p1 * ratio), CONF_CANDIDATE_FLOOR, cap);
  out.push({ id: ranked[1].id, percent: p2 });
  return out.sort((a, b) => b.percent - a.percent);
}

function determineType(T, V, C) {
  const ranked = rankedArchetypes(T, V, C);
  return ranked.length ? ranked[0].id : null;
}

function buildVerdict(T, V, C, conf) {
  const level = confidenceLevel(conf);
  const ranked = rankedArchetypes(T, V, C);
  const primary = getType(ranked[0].id);
  const secondary = ranked[1] ? getType(ranked[1].id) : null;

  if (level === 'high') {
    return {
      verdict: 'single', confidenceLevel: level,
      primaryId: ranked[0].id, secondaryId: null,
      headline: `你的本命色是 ${primary ? primary.name : ''}`,
      note: '各维度信号一致，结果较稳。'
    };
  }

  if (level === 'medium' && secondary) {
    const diffDims = ['T', 'V', 'C']
      .map(d => ({ d, gap: Math.abs(ranked[0].vec[d] - ranked[1].vec[d]) }))
      .sort((a, b) => b.gap - a.gap);
    const keyDim = diffDims[0].d;
    const meta = DIM_LABELS[keyDim];
    const cands = candidatePercents(T, V, C, conf);
    const p1 = cands[0] ? cands[0].percent : 0;
    const p2 = cands[1] ? cands[1].percent : 0;
    return {
      verdict: 'two', confidenceLevel: level,
      primaryId: ranked[0].id, secondaryId: ranked[1].id,
      diffDimLabel: meta.label,
      candidates: cands,
      headline: `你最可能是 ${primary ? primary.name : ''}（${p1}%），其次是 ${secondary ? secondary.name : ''}（${p2}%）`,
      note: `两者主要在「${meta.label}」上分野：若你更${DIM_LABELS[keyDim].warm}，偏向 ${primary ? primary.name : ''}；更${DIM_LABELS[keyDim].cold}，偏向 ${secondary ? secondary.name : ''}。`
    };
  }

  const parts = [];
  ['T', 'V', 'C'].forEach(d => {
    const val = d === 'T' ? T : (d === 'V' ? V : C);
    const threshold = d === 'C' ? 0.25 : 0.35;
    if (Math.abs(val) < threshold) return;
    parts.push(val > 0 ? DIM_LABELS[d].warm : DIM_LABELS[d].cold);
  });
  const accuracy = displayPercent(conf);
  const pname = primary ? primary.name : '';
  const cands = candidatePercents(T, V, C, conf);
  const p2 = cands[1] ? cands[1].percent : 0;
  const altText = secondary ? `，第二候选 ${secondary.name}（${p2}%）` : '';
  return {
    verdict: 'tentative', confidenceLevel: level,
    primaryId: ranked[0].id, secondaryId: secondary ? secondary.id : null,
    accuracyPercent: accuracy, candidates: cands, direction: parts.join(' + '),
    headline: parts.length ? `你更接近 ${pname}（倾向「${parts.join(' + ')}」）` : `你更接近 ${pname}`,
    note: `本次作答里各维度信号不够集中，所以上面是「最接近」的一型，参考准确率约 ${accuracy}${altText}。建议先按这一型的主色试色；若与体感不符，可换个光线重测一次。`
  };
}

function variantReport(base, cand, index) {
  const type = getType(cand.id);
  if (!type) return null;
  const out = { ...base, ...type };
  out.theme = getSeasonTheme(type.season) || SEASON_THEME[type.season] || '#d9a441';
  out.seasonLabel = type.season + '季型';
  out.seasonEn = type.seasonEn || SEASON_EN_MAP[type.season];
  out.variantIndex = index;
  out.variantPercent = cand.percent + '%';
  out.variantPercentNum = cand.percent;
  out.isPrimaryVariant = index === 0;
  out.candidates = (base.candidates || []).map(c => ({ ...c }));
  delete out.variants;
  return out;
}

function buildResult(id, dims) {
  let resolvedId = id;
  if (dims && typeof dims.T === 'number' && typeof dims.V === 'number' && typeof dims.C === 'number') {
    resolvedId = determineType(dims.T, dims.V, dims.C) || id;
  }
  const type = getType(resolvedId);
  if (!type) return null;
  const conf = dims.confidence != null
    ? dims.confidence
    : computeConfidence(dims.T, dims.V, dims.C, dims.consistency);

  const out = {
    ...type,
    dims,
    bars: toBars(dims.T, dims.V, dims.C),
    theme: getSeasonTheme(type.season) || SEASON_THEME[type.season] || '#d9a441',
    confidence: conf,
    confidencePercent: displayPercent(conf),
    confidenceLevel: confidenceLevel(conf),
    consistency: dims.consistency == null ? null : +dims.consistency.toFixed(3),
    seasonTheme: SEASON_THEME,
    seasonLabel: type.season + '季型',
    seasonEn: type.seasonEn || SEASON_EN_MAP[type.season]
  };
  attachVerdict(out, dims, conf);
  return out;
}

function attachVerdict(out, dims, conf) {
  const verdict = buildVerdict(dims.T, dims.V, dims.C, conf);
  out.verdict = verdict.verdict;
  out.verdictHeadline = verdict.headline;
  out.verdictNote = verdict.note;
  out.primaryId = verdict.primaryId;
  out.secondaryId = verdict.secondaryId;
  out.tentative = verdict.verdict === 'tentative';
  out.accuracyPercent = out.confidencePercent;
  out.directionText = verdict.direction || '';
  out.candidates = (verdict.candidates || []).map(c => {
    const t = getType(c.id);
    if (!t) return null;
    return {
      id: t.id, name: t.name, season: t.season,
      seasonEn: t.seasonEn || SEASON_EN_MAP[t.season],
      theme: getSeasonTheme(t.season) || SEASON_THEME[t.season] || '#d9a441',
      percent: c.percent, percentText: c.percent + '%'
    };
  }).filter(Boolean);
  out.candidates.sort((a, b) => b.percent - a.percent);
  out.alternate = out.candidates.length > 1 ? out.candidates[1] : null;

  if (out.tentative) {
    out.tagline = '本次作答信号不够集中，这是「最接近」的一型，建议再用实体色布确认。';
  }

  out.diffDimLabel = '';
  if (out.alternate) {
    const rk = rankedArchetypes(dims.T, dims.V, dims.C);
    if (rk.length > 1) {
      const gaps = ['T', 'V', 'C']
        .map(d => ({ d, gap: Math.abs(rk[0].vec[d] - rk[1].vec[d]) }))
        .sort((a, b) => b.gap - a.gap);
      out.diffDimLabel = DIM_LABELS[gaps[0].d].label;
    }
  }

  out.variants = (out.candidates || [])
    .map((c, i) => variantReport(out, c, i))
    .filter(Boolean);
  out.variantCount = out.variants.length;
  return out;
}

// 由问卷答案（{qid: 选项下标}）计算
function diagnoseFromAnswers(answers) {
  let T = 0, V = 0, C = 0;
  questions.forEach(q => {
    const idx = answers[q.id];
    if (idx === undefined) return;
    const opt = q.options[idx];
    if (!opt || !opt.score) return;
    const w = q.w == null ? 1 : q.w;
    T += (opt.score.T || 0) * w;
    V += (opt.score.V || 0) * w;
    C += (opt.score.C || 0) * w;
  });
  T = clamp(T * NORM.T, -1.5, 1.5);
  V = clamp(V * NORM.V, -1.5, 1.5);
  C = clamp(C * NORM.C, -1, 1);

  const consistency = computeConsistency(answers);
  const id = determineType(T, V, C);
  return buildResult(id, { T, V, C, consistency });
}

// ---------- 对外接口 ----------
// 前端安全的题目（剥离 score / w / dims / check 权重）
function getClientQuestions() {
  return questions.map(q => ({
    id: q.id,
    question: q.title,
    options: q.options.map(o => ({ text: o.label }))
  }));
}

module.exports = {
  questions,
  archetypes,
  diagnoseFromAnswers,
  determineType,
  toBars,
  buildResult,
  computeConfidence,
  confidenceLevel,
  marginScore,
  computeConsistency,
  rankedArchetypes,
  buildVerdict,
  candidatePercents,
  getType,
  getSeasonTheme,
  getClientQuestions
};
