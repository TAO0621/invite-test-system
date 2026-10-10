'use strict';
// 生成静态演示报告 demo-result.html（无需服务器，直接双击打开）。
// 用真实 diagnose 算法算一份示例结果，再用 report.js 渲染成页面。
const fs = require('fs');
const path = require('path');
const diagnose = require('./diagnose');
const { reportHTML } = require('./public/report.js');

// 一组偏暖、中明、柔的作答（演示用）
const sampleAnswers = {
  whiteVsCream: 1, jewelry: 0, sun: 1, lipstick: 1, hair: 2, eye: 2,
  skinValue: 0, contrast: 0, flatter: 0, worstColor: 0, texture: 0,
  dayNight: 2, clothDepth: 0, print: 1, contour: 0
};
const result = diagnose.diagnoseFromAnswers(sampleAnswers);
const json = JSON.stringify(result);

const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
const reportJs = fs.readFileSync(path.join(__dirname, 'public', 'report.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>本命色 · 演示报告</title>
  <style>${css}
  .topbar{text-align:center;color:#6b7689;font-size:13px;padding:14px}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">演示报告（静态，候选季型可点击切换 · 真实算法输出）</div>
    <div id="resBody"></div>
  </div>
  <script>${reportJs}</script>
  <script>
    var RESULT = ${json};
    var AV = 0;
    function render() {
      document.getElementById('resBody').innerHTML = ReportHTML(RESULT, AV);
      document.querySelectorAll('#resBody .cand').forEach(function (el) {
        el.onclick = function () { AV = +el.getAttribute('data-vi'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      });
    }
    render();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'demo-result.html'), html);
console.log('生成 demo-result.html：', result.name, '| 置信度', result.confidencePercent, '| 候选', result.variants.length);
