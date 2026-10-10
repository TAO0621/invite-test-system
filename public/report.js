/*
 * 报告渲染（纯函数，浏览器与 Node 通用）。
 * reportHTML(result, activeVariant) 返回完整报告的 HTML 字符串。
 * 浏览器端 app.js 用它设置 innerHTML；Node 端 gen_demo.js 用它生成静态预览。
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function swatchesHTML(arr, opts) {
    opts = opts || {};
    const cls = 'sw' + (opts.avoid ? ' no' : '');
    return (arr || []).map(c =>
      `<div class="${cls}"><span class="chip${opts.avoid ? ' chip-no' : ''}" style="background:${esc(c.hex)}"></span>` +
      `<span class="nm${opts.muted ? ' chip-muted' : ''}">${esc(c.name)}</span></div>`
    ).join('');
  }

  function clothRows(colors, label, kind) {
    if (!colors || !colors.length) return '';
    const cls = kind === 'avoid' ? 'cloth-label avoid' : (kind === 'cautious' ? 'cloth-label cautious' : 'cloth-label');
    return `<div class="cloth-row"><div class="${cls}">${label}</div>` +
      `<div class="swatches compact">${swatchesHTML(colors, { avoid: kind === 'avoid', muted: kind === 'avoid' })}</div></div>`;
  }

  function colorGroup(label, arr) {
    if (!arr || !arr.length) return '';
    return `<div class="range-group"><div class="range-label">${esc(label)}</div>` +
      `<div class="swatches compact">${swatchesHTML(arr)}</div></div>`;
  }

  function mkRow(label, val) {
    return `<div class="makeup-row"><span class="mk-label">${esc(label)}</span><span class="mk-val">${esc(val || '')}</span></div>`;
  }

  function metalGroup(label, arr) {
    if (!arr || !arr.length) return '';
    return `<div class="range-label" style="margin-top:10px">${esc(label)}</div>` +
      `<div class="metal-grid">${arr.map(m => `<div class="metal-item"><span class="mchip"></span><span class="nm">${esc(m.name)}</span></div>`).join('')}</div>`;
  }

  function barRow(label, val, left, right) {
    val = val || 0;
    return `<div class="rep-bar"><div class="rb-label">${esc(label)}</div>` +
      `<div class="rb-track"><div class="rb-fill" style="width:${val}%"></div></div>` +
      `<div class="rb-ends"><span>${esc(left)}</span><span>${esc(right)}</span></div>` +
      `<div class="rb-val">${val}</div></div>`;
  }

  function reportHTML(r, activeVariant) {
    if (!r) return '<div class="rep-card">暂无结果</div>';
    activeVariant = activeVariant || 0;
    const v = (r.variants && r.variants.length) ? r.variants[activeVariant] : r;
    const theme = v.theme || r.theme || '#2b4c7e';
    let html = '';

    // 头部
    html += `<div class="rep-head" style="border-left-color:${theme}">` +
      `<div class="rep-season" style="background:${theme}">${esc(v.season)}季型</div>` +
      `<div class="rep-name">${esc(v.name)}</div>` +
      `<div class="rep-en">${esc(v.seasonEn || '')}</div>` +
      `<div class="rep-tag">${esc(v.tagline || '')}</div></div>`;

    // 置信度卡
    const lvlText = { high: '高', medium: '中', low: '低' }[r.confidenceLevel] || '';
    html += `<div class="rep-card conf conf-${r.confidenceLevel}">` +
      `<div class="conf-head"><span class="conf-title">结论可靠度</span>` +
      `<span class="conf-badge">置信度 ${esc(r.confidencePercent)}（${lvlText}）</span></div>` +
      `<div class="conf-note">${esc(r.verdictNote || '')}</div></div>`;

    // 维度条
    const bars = r.bars || {};
    html += `<div class="rep-card"><div class="block-title">你的色彩维度</div>` +
      barRow('冷暖（T）', bars.temp, '冷', '暖') +
      barRow('明度（V）', bars.value, '深', '浅') +
      barRow('纯度（C）', bars.chroma, '柔', '鲜') +
      (r.directionText ? `<div class="rep-desc">倾向：${esc(r.directionText)}</div>` : '') +
      `</div>`;

    // 候选季型切换
    if (r.candidates && r.candidates.length > 1) {
      html += `<div class="rep-card"><div class="block-title">可能的季型（按准确率排序）</div><div class="cands">` +
        r.candidates.map((c, i) =>
          `<div class="cand ${i === activeVariant ? 'on' : ''}" data-vi="${i}">` +
          `<div class="cand-rank ${i === 0 ? 'top' : ''}">${i + 1}</div>` +
          `<div class="cand-main"><div class="cand-name" style="color:${esc(c.theme)}">${esc(c.name)}</div>` +
          `<div class="cand-bar"><div class="cand-fill" style="width:${c.percent}%;background:${esc(c.theme)}"></div></div></div>` +
          `<div class="cand-pct">${esc(c.percentText || (c.percent + '%'))}</div></div>`
        ).join('') +
        `</div>` +
        (r.diffDimLabel ? `<div class="cand-note">两者差异主要在「${esc(r.diffDimLabel)}」上，可对照肤色再确认。</div>` : '') +
        `</div>`;
    }

    // 分析
    html += `<div class="rep-card"><div class="block-title">分析</div>` +
      `<div class="rep-desc">${esc(v.description || '')}</div>` +
      `<div class="kv-mini">肤色冷暖调：${esc(v.skinTone || '')}</div>`;
    if (v.analysis) {
      html += `<div class="rep-metrics">` +
        `<div class="rm"><span>肤色明度</span><b>${esc(v.analysis.skinBrightness)}</b></div>` +
        `<div class="rm"><span>肤色饱和度</span><b>${esc(v.analysis.skinSaturation)}</b></div>` +
        `<div class="rm"><span>五官对比度</span><b>${esc(v.analysis.contrast)}</b></div>` +
        `<div class="rm"><span>发色/瞳孔</span><b>${esc(v.analysis.hairAndPupil)}</b></div>` +
        `</div>`;
    }
    html += `</div>`;

    // 色彩范围
    if (v.colorRange) {
      html += `<div class="rep-card"><div class="block-title">适合你的色彩范围</div>` +
        colorGroup('基础色（中性色）', v.colorRange.basics) +
        colorGroup('主色', v.colorRange.main) +
        colorGroup('点缀色', v.colorRange.accents) + `</div>`;
    }

    // 服装颜色推荐
    if (v.clothingColors) {
      html += `<div class="rep-card"><div class="block-title">服装颜色推荐</div>` +
        clothRows(v.clothingColors.priority, '优先选择', 'priority') +
        clothRows(v.clothingColors.try, '可以尝试', 'try') +
        clothRows(v.clothingColors.cautious, '谨慎选择', 'cautious') +
        clothRows(v.clothingColors.avoid, '尽量避免', 'avoid') + `</div>`;
    }

    // 发色方向
    if (v.hairColor) {
      html += `<div class="rep-card"><div class="block-title">发色方向</div>` +
        `<div class="rep-desc">${esc(v.hairColor.note || '')}</div>` +
        `<div class="hair-grid">${(v.hairColor.colors || []).map(c =>
          `<div class="hair-item"><span class="chip" style="background:${esc(c.hex)}"></span><span class="nm">${esc(c.name)}</span></div>`).join('')}</div></div>`;
    }

    // 最显白颜色
    if (v.whiteningColors) {
      html += `<div class="rep-card"><div class="block-title">最显白颜色（提亮肤色）</div>` +
        `<div class="rep-desc">${esc(v.whiteningColors.reason || '')}</div>` +
        `<div class="swatches compact">${swatchesHTML(v.whiteningColors.colors)}</div></div>`;
    }

    // 妆容
    if (v.makeup) {
      html += `<div class="rep-card"><div class="block-title">妆容颜色推荐</div>` +
        mkRow('底妆', v.makeup.base) + mkRow('腮红', v.makeup.blush) +
        mkRow('眼影', v.makeup.eyeshadow) + mkRow('眼线', v.makeup.eyeliner) +
        mkRow('口红方向', v.makeup.lipstick) + `</div>`;
    }

    // 配饰金属
    if (v.metals) {
      html += `<div class="rep-card"><div class="block-title">配饰金属</div>` +
        metalGroup('优先选择', v.metals.priority) +
        metalGroup('可少量搭配', v.metals.optional) + `</div>`;
    }

    // 显脏显黑
    if (v.dirtyColors) {
      html += `<div class="rep-card"><div class="block-title">最容易显脏显黑的颜色</div>` +
        `<div class="rep-desc">${esc(v.dirtyColors.reason || '')}</div>` +
        `<div class="swatches compact">${swatchesHTML(v.dirtyColors.colors, { avoid: true, muted: true })}</div></div>`;
    }

    // 气质关键词 + 风格
    if (v.styleKeywords && v.styleKeywords.length) {
      html += `<div class="rep-card"><div class="block-title">我的整体气质关键词</div>` +
        `<div class="kw-list">${v.styleKeywords.map(k => `<span class="kw">${esc(k)}</span>`).join('')}</div>` +
        (v.styles && v.styles.length ? `<div class="block-sub">适合走</div><div class="style-list">${v.styles.map(s => `<span class="style-tag">${esc(s)}</span>`).join('')}</div>` : '') +
        `</div>`;
    }

    return html;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { reportHTML };
  if (global) global.ReportHTML = reportHTML;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
