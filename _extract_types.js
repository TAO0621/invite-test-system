'use strict';
// 一次性脚本：从小程序 colorData.js 提取 16 型元数据，剔除本地 img 路径，导出为自包含的 types-data.json
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/ace_t/WorkBuddy/2026-09-11-18-38-10/lightme-color-miniprogram/utils/colorData.js';
const OUT = path.join(__dirname, 'types-data.json');

const cd = require(SRC);

// 深拷贝并删除所有 img 字段（web 端没有小程序本地资源）
function stripImg(obj) {
  if (Array.isArray(obj)) return obj.map(stripImg);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (k === 'img') continue;
      out[k] = stripImg(obj[k]);
    }
    return out;
  }
  return obj;
}

const data = {
  SEASON_THEME: cd.SEASON_THEME,
  SEASON_ORDER: cd.SEASON_ORDER,
  TYPE_ORDER: cd.TYPE_ORDER,
  TYPES: (cd.TYPES || []).map(t => stripImg(t))
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log('导出类型数:', data.TYPES.length);
console.log('输出文件:', OUT, fs.statSync(OUT).size, 'bytes');
// 校验每个型都有必备字段
const missing = data.TYPES.filter(t => !t.id || !t.name || !t.season || !t.palette || !t.clothingColors);
console.log('缺字段的类型:', missing.map(t => t.id));
