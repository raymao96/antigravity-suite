'use strict';
/**
 * 零依赖纯 Node.js 渲染层构建脚本 (build-renderer.js)
 *
 * 职责：
 * 将 src/renderer/ 下按职责拆分的子模块：
 *  - styles.css (纯 CSS 样式定义)
 *  - template.html (Shadow DOM 结构模板)
 *  - colors.js (色彩空间转换、色相/明度/饱和度算法与拾色器组件)
 *  - dropdown.js (自定义下拉菜单、国家/地区/货币搜索过滤与键盘高亮)
 *  - heatmap.js (热力图网格、周视图、累计视图与悬浮 Popover)
 *  - main.js (宿主挂载、状态机、数据轮询、布局响应式及生命周期销毁)
 * 组合输出至根目录的 meter-renderer.js；修改渲染层时以 src/renderer 为准。
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src', 'renderer');
const targetFile = path.join(rootDir, 'meter-renderer.js');
const TRUNCATION_MARKER_RE = /truncated for diff preview/i;

/**
 * 校验渲染层源码是否意外包含 diff 预览截断标记，防止覆盖完整产物
 */
function assertNoTruncationMarker(filePath, content) {
  const match = TRUNCATION_MARKER_RE.exec(String(content || ''));
  if (!match) return;
  const prefix = content.slice(0, match.index);
  const lines = prefix.split(/\r?\n/);
  const lineNum = lines.length;
  const colNum = lines[lines.length - 1].length + 1;
  const err = new Error(
    `[构建中止] 检测到源码截断标记 (truncated for diff preview): ${filePath}:${lineNum}:${colNum}。已保留现场文件与未提交修改。`
  );
  err.code = 'ERR_SOURCE_TRUNCATED';
  err.filePath = filePath;
  err.line = lineNum;
  err.column = colNum;
  throw err;
}

function readVerifiedRendererSource(dir, fileName) {
  const fullPath = path.join(dir, fileName);
  const raw = fs.readFileSync(fullPath, 'utf8');
  assertNoTruncationMarker(fullPath, raw);
  return raw;
}

function buildRenderer(options = {}) {
  const effRootDir = options.rootDir ? path.resolve(options.rootDir) : rootDir;
  const effSrcDir = options.srcDir ? path.resolve(options.srcDir) : path.join(effRootDir, 'src', 'renderer');
  const effTargetFile = options.targetFile ? path.resolve(options.targetFile) : path.join(effRootDir, 'meter-renderer.js');

  const pkg = JSON.parse(fs.readFileSync(path.join(effRootDir, 'package.json'), 'utf8'));
  const meterVersion = pkg.version || '0.8.5';

  const stylesBase = readVerifiedRendererSource(effSrcDir, 'styles.css').trim();
  const suiteStylesPath = path.join(effSrcDir, 'suite-settings.css');
  const styles = fs.existsSync(suiteStylesPath)
    ? `${stylesBase}\n${readVerifiedRendererSource(effSrcDir, 'suite-settings.css').trim()}`
    : stylesBase;

  const templateBase = readVerifiedRendererSource(effSrcDir, 'template.html').trim();
  const suiteTemplatePath = path.join(effSrcDir, 'suite-settings.html');
  let template = fs.existsSync(suiteTemplatePath)
    ? `${templateBase}\n${readVerifiedRendererSource(effSrcDir, 'suite-settings.html').trim()}`
    : templateBase;
  template = template.replace(/<span id="v">v[^<]*<\/span>/g, `<span id="v">v${meterVersion}</span>`);
  template = template.replace(/<span id="up-pop-ver"[^>]*>v[^<]*<\/span>/g, `<span id="up-pop-ver" class="key-pill pill-good" style="font-size:10px">v${meterVersion}</span>`);
  template = template.replace(/(<span id="suite-ver-status"[^>]*>)v[^<]*(<\/span>)/g, `$1v${meterVersion}$2`);

  const colors = readVerifiedRendererSource(effSrcDir, 'colors.js').trim();
  const dropdown = readVerifiedRendererSource(effSrcDir, 'dropdown.js').trim();
  const heatmap = readVerifiedRendererSource(effSrcDir, 'heatmap.js').trim();
  const zhTwConverterPath = path.join(effRootDir, 'src', 'i18n', 'zh-tw-converter.js');
  const zhTwConverter = fs.existsSync(zhTwConverterPath) ? fs.readFileSync(zhTwConverterPath, 'utf8').trim() : '';
  const suiteSettingsPath = path.join(effSrcDir, 'suite-settings.js');
  const suiteSettings = fs.existsSync(suiteSettingsPath) ? readVerifiedRendererSource(effSrcDir, 'suite-settings.js').trim() : '';
  let mainTemplate = readVerifiedRendererSource(effSrcDir, 'main.js');

  // 注入或同步构建期版本常量
  const versionConst = `  const METER_VERSION = '${meterVersion}';\n`;
  if (mainTemplate.includes('const METER_VERSION =')) {
    mainTemplate = mainTemplate.replace(/const METER_VERSION = '[^']*';/, `const METER_VERSION = '${meterVersion}';`);
  } else {
    mainTemplate = mainTemplate.replace(/\(function \(\) \{/, `(function () {\n${versionConst}`);
  }

  const domString = `  shadow.innerHTML = \`<style>\n    ${styles.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${')}\n  </style>\n\n  ${template.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${')}\`;`;

  let output = mainTemplate
    .replace('  /* @INSERT_STYLES_AND_TEMPLATE */', () => domString)
    .replace('  /* @INSERT_COLORS_MODULE */', () => colors)
    .replace('  /* @INSERT_DROPDOWN_MODULE */', () => dropdown)
    .replace('  /* @INSERT_HEATMAP_MODULE */', () => heatmap)
    .replace('  /* @INSERT_ZH_TW_CONVERTER */', () => zhTwConverter)
    .replace('  /* @INSERT_SUITE_SETTINGS_MODULE */', () => suiteSettings);

  fs.writeFileSync(effTargetFile, output, 'utf8');
  console.log(`[构建成功] 渲染层构建完成: ${effTargetFile} (v${meterVersion}, ${Buffer.byteLength(output, 'utf8')} 字节)`);
}

if (require.main === module) {
  buildRenderer();
}

module.exports = { buildRenderer, assertNoTruncationMarker };
