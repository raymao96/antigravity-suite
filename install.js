'use strict';
// Preserve Electron ASAR support in the host process.
// Context Meter Preload API Exposure Contract:
// recordCalls: (calls) => electron_1.ipcRenderer.invoke("context-meter:record-calls", calls)
// getContextUnlockStatus: () => electron_1.ipcRenderer.invoke("context-meter:context-unlock-status")
// applyContextUnlock: () => electron_1.ipcRenderer.invoke("context-meter:context-unlock-apply")
// restoreContextUnlock: () => electron_1.ipcRenderer.invoke("context-meter:context-unlock-restore")
// additions: 'asar-engine.js', 'local-api.js', 'meter-context-unlock.js'
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { loadAsarEngine, builtinAsar, getStateDir, findAsarPath, resolveActiveCdpTarget } = require('./asar-engine');
const { loadModulesConfig, saveModulesConfig, acquireFileLock } = require('./modules-config');
const {
  TAGS,
  validateSyntax,
  generateProxyUtilsCode,
  generateMeterUtilsCode,
  generateMeterPreloadCode,
  generateChinesePreloadCode,
  cleanUtilsSource,
  cleanPreloadSource,
  verifyCleanStructure
} = require('./modular-installer');

const asar = loadAsarEngine();
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function clearAsarCache(archivePath) {
  try {
    if (asar && typeof asar.uncacheAll === 'function') asar.uncacheAll();
    if (asar && typeof asar.uncache === 'function' && archivePath) asar.uncache(archivePath);
  } catch {}
}

function extractAsarFile(archivePath, relPath) {
  clearAsarCache(archivePath);
  try {
    return builtinAsar.extractFile(archivePath, relPath);
  } catch {
    return asar.extractFile(archivePath, relPath);
  }
}

function extractAllAsar(archivePath, destDir) {
  clearAsarCache(archivePath);
  try {
    builtinAsar.extractAll(archivePath, destDir);
  } catch {
    asar.extractAll(archivePath, destDir);
  }
}

// findAsarPath 由 ./asar-engine 纯路径共享模块提供并导出

async function injectMissingSecondaryOverlays(evalExpr, enhancerOverlay, enhancerCond, codexOverlay, codexCond) {
  let missingOk = true;
  if (enhancerOverlay) {
    const enhAlive = await evalExpr(`Boolean(${enhancerCond})`);
    if (enhAlive?.result?.result?.value !== true) {
      const enhRes = await evalExpr(enhancerOverlay);
      if (!enhRes || enhRes.error || enhRes.result?.exceptionDetails) missingOk = false;
    }
  }
  if (codexOverlay) {
    const codexAlive = await evalExpr(`Boolean(${codexCond})`);
    if (codexAlive?.result?.result?.value !== true) {
      const codexRes = await evalExpr(codexOverlay);
      if (!codexRes || codexRes.error || codexRes.result?.exceptionDetails) missingOk = false;
    }
  }
  return missingOk;
}

async function tryHotInject(options = {}) {
  try {
    const appData = process.env.APPDATA || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));

    // 严格安全隔离门禁：若处于测试模式，严禁连接真实运行环境的 AppData/DevTools 端口！
    if (process.env.AG_METER_TEST_MODE === '1' || process.env.NODE_ENV === 'test') {
      const isIsolatedTemp = appData.toLowerCase().includes(os.tmpdir().toLowerCase());
      if (!isIsolatedTemp) return false;
    }

    const { targets } = await resolveActiveCdpTarget({ timeoutMs: 2500 });
    if (!targets.length) return false;

    const stateDir = getStateDir();
    const livePath = fs.existsSync(path.join(stateDir, '.live-session.json'))
      ? path.join(stateDir, '.live-session.json')
      : path.join(__dirname, '.live-session.json');
    const liveInfo = fs.existsSync(livePath) ? JSON.parse(fs.readFileSync(livePath, 'utf8')) : null;
    const bundle = ['meter-core.js', 'meter-renderer.js']
      .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
      .join('\n');
    const hansPath = path.join(__dirname, 'antigravity-hans-overlay.js');
    const hansOverlay = fs.existsSync(hansPath) ? fs.readFileSync(hansPath, 'utf8') : '';
    const hansFpMatch = hansOverlay.match(/const\s+PATCH_FINGERPRINT\s*=\s*['"]([^'"]+)['"]/);
    const expectedHansFp = hansFpMatch ? hansFpMatch[1] : '';
    const enhancerPath = path.join(__dirname, 'ag-enhancer-overlay.js');
    const enhancerOverlay = fs.existsSync(enhancerPath) ? fs.readFileSync(enhancerPath, 'utf8') : '';
    const enhancerVerMatch = enhancerOverlay.match(/globalThis\.__AGEnhancer\s*=\s*\{[\s\S]*?version\s*:\s*['"]([^'"]+)['"]/);
    const expectedEnhancerVer = enhancerVerMatch ? enhancerVerMatch[1] : '';
    const codexPath = path.join(__dirname, 'ag-codex-overlay.js');
    const codexOverlay = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
    const codexVerMatch = codexOverlay.match(/globalThis\.__AGCodexOverlay\s*=\s*\{[\s\S]*?version\s*:\s*['"]([^'"]+)['"]/);
    const expectedCodexVer = codexVerMatch ? codexVerMatch[1] : '';
    const pulsePath = path.join(__dirname, 'pulse-capsule-overlay.js');
    const pulseOverlay = fs.existsSync(pulsePath) ? fs.readFileSync(pulsePath, 'utf8') : '';
    const pulseVerMatch = pulseOverlay.match(/const\s+CAPSULE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const expectedPulseVer = pulseVerMatch ? pulseVerMatch[1] : '';
    const i18nExactPath = path.join(__dirname, 'i18n', 'zh-CN.json');
    let latestExact = {};
    try {
      if (fs.existsSync(i18nExactPath)) {
        const parsedExact = JSON.parse(fs.readFileSync(i18nExactPath, 'utf8'));
        if (parsedExact && parsedExact.exact && typeof parsedExact.exact === 'object') {
          latestExact = parsedExact.exact;
        }
      }
    } catch {}
    const latestExactJson = JSON.stringify(latestExact)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const isolatedBridgeExpr = `(function() {
      if (!window.__AGY_I18N_DATA__) return false;
      var latestExact = ${latestExactJson};
      if (window.__AGY_I18N_DATA__.exact && latestExact) {
        try { Object.assign(window.__AGY_I18N_DATA__.exact, latestExact); } catch (e) {}
      }
      if (window.__AGY_CACHE__) {
        try {
          if (typeof Map !== 'undefined' && window.__AGY_CACHE__ instanceof Map && Map.prototype && typeof Map.prototype.clear === 'function') {
            Map.prototype.clear.call(window.__AGY_CACHE__);
          } else if (typeof window.__AGY_CACHE__.clear === 'function') {
            window.__AGY_CACHE__.clear();
          }
        } catch (e) {}
      }
      if (window.__AGY_ISOLATED_LIVE_BRIDGE__ === '2.2.0') {
        try { window.__AGY_UPGRADE_STALE_ZH__ && window.__AGY_UPGRADE_STALE_ZH__(); } catch (e) {}
        try { window.__AGY_SYNC_ISOLATED_LOCALE__ && window.__AGY_SYNC_ISOLATED_LOCALE__(); } catch (e) {}
        return true;
      }
      window.__AGY_ISOLATED_LIVE_BRIDGE__ = '2.2.0';
      var exact = (window.__AGY_I18N_DATA__ && window.__AGY_I18N_DATA__.exact) || {};
      var rev = Object.create(null);
      var canon = {
        '新增': 'New',
        '新建': 'New',
        '新建会话': 'New Conversation',
        '自动化': 'Automations',
        '自定义扩展': 'Customizations',
        '项目列表': 'Projects',
        '设置': 'Settings',
        '扩展': 'Extensions',
        '扩展插件': 'Extensions',
        '收件箱': 'Inbox',
        '文件列表': 'Files',
        '概览': 'Overview',
        '极速': 'Turbo',
        '极速模式': 'Turbo mode',
        '智能体权限预设选择器，当前：极速': 'Agent permissions preset selector, current: Turbo',
        '无限': 'Turbo',
        '无限模式': 'Turbo mode',
        '智能规划': 'Planning',
        '快速执行': 'Fast',
        '标准': 'Default',
        '自动': 'Auto',
        '请求审核': 'Request Review',
        '始终继续': 'Always Proceed'
      };
      function scoreKey(k) {
        var s = 0;
        if (/^[A-Z][a-z]/.test(k)) s += 4;
        if (/[a-z]/.test(k) && !/^[a-z]/.test(k)) s += 2;
        if (k.length <= 32) s += 1;
        return s;
      }
      for (var ek in exact) {
        if (!Object.prototype.hasOwnProperty.call(exact, ek)) continue;
        var zv = exact[ek];
        if (!zv || typeof zv !== 'string') continue;
        var tz = zv.trim();
        var prev = rev[tz];
        if (!prev || scoreKey(ek) > scoreKey(prev)) rev[tz] = ek;
      }
      for (var ck in canon) rev[ck] = canon[ck];
      function isZhEnabled() {
        try {
          var ah = String(document.documentElement && document.documentElement.getAttribute ? (document.documentElement.getAttribute('data-ag-hans-lang') || '') : '').trim();
          if (/^en/i.test(ah)) return false;
          if (/^zh/i.test(ah)) return true;
          var as = String(document.documentElement && document.documentElement.getAttribute ? (document.documentElement.getAttribute('data-ag-suite-locale') || '') : '').trim();
          if (as && !/^(?:zh|cn)/i.test(as)) return false;
          var hl = String(localStorage.getItem('antigravityHansLang') || '').trim();
          if (/^en/i.test(hl)) return false;
          var sl = String(localStorage.getItem('ag_suite_locale') || '').trim();
          if (sl && !/^(?:zh|cn)/i.test(sl)) return false;
        } catch (e) {}
        return true;
      }
      var cache = window.__AGY_CACHE__;
      if (cache && !cache.__agWrappedByLiveBridge) {
        cache.__agWrappedByLiveBridge = true;
        var origHas = cache.has.bind(cache);
        var origGet = cache.get.bind(cache);
        cache.has = function(k) { return !isZhEnabled() ? true : origHas(k); };
        cache.get = function(k) { return !isZhEnabled() ? null : origGet(k); };
      }
      var ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt', 'aria-description'];
      var SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'SVG', 'PATH', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO']);
      function shouldSkipEl(el) {
        if (!el || el.nodeType !== 1) return false;
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.id === 'ag-context-meter' || el.id === 'ag-quick-capsule-bar' || el.id === 'ag-quota-popover' || el.id === 'ag-chat-nav-float' || el.id === 'ag-quota' || el.id === 'ag-settings-nav-wrap' || el.id === 'ag-settings-pane' || el.id === 'ag-settings-font-menu') return true;
        if (el.closest && el.closest('#ag-context-meter, #ag-quick-capsule-bar, #ag-quota-popover, #ag-chat-nav-float, #ag-quota, #ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu, [data-agy-context-capsule], #__agy_ctx_capsule_tooltip__, [data-testid="user-input-step"], [aria-label="User message"], [aria-label="用户消息"], [data-testid="conversation-row-sidebar"] span.truncate')) return true;
        return false;
      }
      function lookupRev(str) {
        if (!str || typeof str !== 'string') return null;
        var t = str.trim();
        if (!t || !/[\\u4e00-\\u9fa5]/.test(t)) return null;
        if (Object.prototype.hasOwnProperty.call(rev, t)) return rev[t];
        var pm = t.match(/^(.+?)([：:…\\.？\\?!！]+)$/);
        if (pm) {
          var base = pm[1].trim();
          var punc = pm[2] === '：' ? ':' : pm[2];
          if (Object.prototype.hasOwnProperty.call(rev, base)) return rev[base] + punc;
        }
        return null;
      }
      function revertIsolatedDom() {
        function visit(el) {
          if (!el || el.nodeType !== 1 || shouldSkipEl(el)) return;
          el._agyScanId = 0;
          for (var i = 0; i < ATTRS.length; i++) {
            var attr = ATTRS[i];
            var val = el.getAttribute && el.getAttribute(attr);
            if (val) {
              var enA = lookupRev(val);
              if (enA) el.setAttribute(attr, enA);
            }
            el['_agyDone_' + attr] = undefined;
          }
          for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
            if (ch.nodeType === 3) {
              if (typeof ch._agySourceEn === 'string' && ch._agySourceEn !== ch.nodeValue) {
                ch.nodeValue = ch._agySourceEn;
              } else if (ch.nodeValue) {
                var enT = lookupRev(ch.nodeValue);
                if (enT) {
                  var lead = ch.nodeValue.match(/^\\s*/)[0];
                  var tail = ch.nodeValue.match(/\\s*$/)[0];
                  ch.nodeValue = lead + enT + tail;
                }
              }
              ch._agyOriginal = ch.nodeValue;
            } else if (ch.nodeType === 1) {
              visit(ch);
            }
          }
        }
        if (document.documentElement) {
          visit(document.documentElement);
          if (document.documentElement.lang && /^zh/i.test(document.documentElement.lang)) {
            document.documentElement.lang = 'en';
          }
        }
      }
      function clearIsolatedMarks(el) {
        if (!el || el.nodeType !== 1) return;
        el._agyScanId = 0;
        for (var i = 0; i < ATTRS.length; i++) el['_agyDone_' + ATTRS[i]] = undefined;
        for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType === 3) ch._agyOriginal = undefined;
          else if (ch.nodeType === 1) clearIsolatedMarks(ch);
        }
      }
      var STALE_ZH_UPGRADES = {
        '极速': { zh: '无限', en: 'Turbo' },
        '极速模式': { zh: '无限模式', en: 'Turbo mode' },
        '智能体权限预设选择器，当前：极速': {
          zh: '智能体权限预设选择器，当前：无限',
          en: 'Agent permissions preset selector, current: Turbo'
        }
      };
      function shouldSkipStaleEl(el) {
        if (!el || el.nodeType !== 1) return true;
        var tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'CODE' || tag === 'PRE') return true;
        if (el.id === 'ag-context-meter' || el.id === 'ag-suite-capsule' || el.id === 'ag-suite-settings-panel' || el.id === 'ag-quota' || el.id === 'ag-settings-nav-wrap' || el.id === 'ag-settings-pane' || el.id === 'ag-settings-font-menu') return true;
        if (el.isContentEditable) return true;
        if (el.getAttribute && (el.getAttribute('data-testid') === 'user-input-step' || el.getAttribute('data-ag-enhancer') != null)) return true;
        return false;
      }
      function upgradeStaleZhTerms() {
        if (!isZhEnabled() || !document.documentElement) return;
        function walkUpgrade(el) {
          if (shouldSkipStaleEl(el)) return;
          for (var i = 0; i < ATTRS.length; i++) {
            var attr = ATTRS[i];
            if (!el.hasAttribute || !el.hasAttribute(attr)) continue;
            var rawAttr = el.getAttribute(attr);
            if (!rawAttr) continue;
            var attrTrim = rawAttr.trim();
            var attrSpec = STALE_ZH_UPGRADES[attrTrim];
            if (attrSpec) {
              var aLead = rawAttr.match(/^\\s*/)[0];
              var aTail = rawAttr.match(/\\s*$/)[0];
              el.setAttribute(attr, aLead + attrSpec.zh + aTail);
              el['_agySrcAttr_' + attr] = attrSpec.en;
              el['_agyDone_' + attr] = undefined;
              el._agyScanId = 0;
            }
          }
          var inMenuPopup = Boolean(
            el.closest && el.closest('[role="menu"], [role="listbox"], [role="menuitem"], [role="option"], [data-radix-popper-content-wrapper]')
          );
          for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
            if (ch.nodeType === 3 && ch.nodeValue) {
              var rawTxt = ch.nodeValue;
              var txtTrim = rawTxt.trim();
              var txtSpec = STALE_ZH_UPGRADES[txtTrim] || (inMenuPopup && txtTrim === '新建' ? { zh: '新增', en: 'New' } : null);
              if (txtSpec) {
                var tLead = rawTxt.match(/^\\s*/)[0];
                var tTail = rawTxt.match(/\\s*$/)[0];
                ch.nodeValue = tLead + txtSpec.zh + tTail;
                ch._agySourceEn = txtSpec.en;
                ch._agyOriginal = undefined;
                el._agyScanId = 0;
              }
            } else if (ch.nodeType === 1) {
              walkUpgrade(ch);
            }
          }
        }
        walkUpgrade(document.documentElement);
      }
      window.__AGY_UPGRADE_STALE_ZH__ = upgradeStaleZhTerms;
      var lastZh = null;
      function syncIsolatedLocale() {
        var nextZh = isZhEnabled();
        if (lastZh !== null && nextZh === lastZh) return;
        if (!nextZh) {
          revertIsolatedDom();
        } else if (lastZh === false || lastZh === null) {
          if (document.documentElement) {
            clearIsolatedMarks(document.documentElement);
            document.documentElement.lang = 'zh-CN';
          }
          upgradeStaleZhTerms();
          try { if (typeof window.__AGY_RUN_FULL_SCAN__ === 'function') window.__AGY_RUN_FULL_SCAN__(); } catch (e) {}
        }
        lastZh = nextZh;
      }
      window.__AGY_SYNC_ISOLATED_LOCALE__ = syncIsolatedLocale;
      if (window.__AGY_ISOLATED_LOCALE_OBS__ && typeof window.__AGY_ISOLATED_LOCALE_OBS__.disconnect === 'function') {
        try { window.__AGY_ISOLATED_LOCALE_OBS__.disconnect(); } catch (e) {}
      }
      if (document.documentElement && typeof MutationObserver === 'function') {
        var obs = new MutationObserver(syncIsolatedLocale);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ag-hans-lang', 'data-ag-suite-locale'] });
        window.__AGY_ISOLATED_LOCALE_OBS__ = obs;
      }
      if (window.__AGY_ISOLATED_STORAGE_FN__ && window.removeEventListener) {
        window.removeEventListener('storage', window.__AGY_ISOLATED_STORAGE_FN__);
      }
      window.__AGY_ISOLATED_STORAGE_FN__ = syncIsolatedLocale;
      if (window.addEventListener) window.addEventListener('storage', syncIsolatedLocale);
      syncIsolatedLocale();
      return true;
    })()`;

    let injectedCount = 0;
    for (const target of targets) {
      let ws = null;
      try {
        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        let seq = 0;
        const execContexts = [];
        const onContextEvent = ev => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.method === 'Runtime.executionContextCreated' && msg.params?.context) {
              execContexts.push(msg.params.context);
            }
          } catch {}
        };
        ws.addEventListener('message', onContextEvent);
        const sendCdp = (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++seq;
          const timer = setTimeout(() => {
            ws.removeEventListener('message', handler);
            reject(new Error(`CDP ${method} timeout`));
          }, 5000);
          const handler = ev => {
            const d = JSON.parse(ev.data);
            if (d.id === id) {
              clearTimeout(timer);
              ws.removeEventListener('message', handler);
              resolve(d);
            }
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id, method, params }));
        });
        const evalExpr = (expression, contextId) => {
          const params = { expression, returnByValue: true, awaitPromise: true };
          if (typeof contextId === 'number') params.contextId = contextId;
          return sendCdp('Runtime.evaluate', params);
        };
        try {
          await sendCdp('Runtime.enable');
          const targetOrigin = new URL(target.url).origin;
          for (const ctx of execContexts) {
            if (ctx?.auxData?.type === 'isolated' && ctx.origin === targetOrigin) {
              const hasPreload = await evalExpr('Boolean(window.__AGY_I18N_DATA__)', ctx.id).catch(() => null);
              if (hasPreload?.result?.result?.value === true) {
                await evalExpr(isolatedBridgeExpr, ctx.id).catch(() => null);
              }
            }
          }
        } catch {}
        ws.removeEventListener('message', onContextEvent);
        if (hansOverlay) {
          const hansFpExpr = expectedHansFp ? ` && window.__antigravityZhPatchFingerprint === ${JSON.stringify(expectedHansFp)}` : '';
          const hansCheck = await evalExpr(`Boolean(window.__antigravityZhPatchInstalled === true && window.__observedDocument === document${hansFpExpr} && !document.querySelector('[data-agy-hans-ui]'))`);
          if (hansCheck?.result?.result?.value !== true) {
            await evalExpr(hansOverlay);
          }
        }
        if (pulseOverlay) {
          const pulseVerExpr = expectedPulseVer ? ` && window.__AGY_CTX_CAPSULE_VERSION__ === ${JSON.stringify(expectedPulseVer)}` : '';
          const pulseCheck = await evalExpr(`Boolean(window.__AGY_CTX_CAPSULE_ACTIVE__ === true${pulseVerExpr} && document.querySelector(\'[data-agy-context-capsule="1"]\'))`);
          if (pulseCheck?.result?.result?.value !== true) {
            await evalExpr('try { window.__AGY_CTX_CAPSULE_DISPOSE__?.(); } catch {} window.__AGY_CTX_CAPSULE_ACTIVE__ = false;');
            await evalExpr(pulseOverlay);
          }
        }
        if (options && options.onlyMissing) {
          const enhancerCond = enhancerOverlay
            ? `window.__AGEnhancer${expectedEnhancerVer ? ` && window.__AGEnhancer.version === ${JSON.stringify(expectedEnhancerVer)}` : ''} && typeof window.__AGEnhancer.isAlive === "function" && window.__AGEnhancer.isAlive()`
            : 'true';
          const codexCond = codexOverlay
            ? `window.__AGCodexOverlay${expectedCodexVer ? ` && window.__AGCodexOverlay.version === ${JSON.stringify(expectedCodexVer)}` : ''} && typeof window.__AGCodexOverlay.isAlive === "function" && window.__AGCodexOverlay.isAlive()`
            : 'true';
          const checkRes = await evalExpr(`Boolean(window.__AGContextMeter && window.__AGContextMeterLive && window.__AGContextMeterLive.port === ${Number(liveInfo?.port || 0)} && (${enhancerCond}) && (${codexCond}))`);
          if (checkRes?.result?.result?.value === true) {
            injectedCount++;
            continue;
          }
          // 若主看板与桥接仍正常且仅缺少增强挂件，就地补注而不重绘主看板（即使挂件失败也不得重绘主看板，避免误关闭已打开浮窗）
          const baseOk = await evalExpr(`Boolean(window.__AGContextMeter && window.__AGContextMeterLive && window.__AGContextMeterLive.port === ${Number(liveInfo?.port || 0)})`);
          if (baseOk?.result?.result?.value === true) {
            if (await injectMissingSecondaryOverlays(evalExpr, enhancerOverlay, enhancerCond, codexOverlay, codexCond)) {
              injectedCount++;
            }
            continue;
          }
        }
        if (liveInfo && liveInfo.origin === new URL(target.url).origin) {
          await evalExpr('window.__AGContextMeterLive=' + JSON.stringify({ port: liveInfo.port, token: liveInfo.token }));
        }
        try {
          const { collectTokenHistoryAsync, getPluginSettings } = require('./meter-collector');
          const settingsSnap = getPluginSettings();
          if (settingsSnap && settingsSnap.ok) {
            await evalExpr('window.__AGContextMeterSettings=' + JSON.stringify(settingsSnap));
          }
          const historyData = await collectTokenHistoryAsync({ force: true });
          if (historyData && !historyData.loading) {
            await evalExpr('window.__AGContextMeterHistory=' + JSON.stringify(historyData));
          }
        } catch {}
        const evalRes = await evalExpr(bundle);
        if (evalRes && !evalRes.error && !evalRes.result?.exceptionDetails) {
          if (enhancerOverlay) {
            await evalExpr(enhancerOverlay);
          }
          if (codexOverlay) {
            await evalExpr(codexOverlay);
          }
          injectedCount++;
        }
      } catch {} finally {
        if (ws) {
          try { ws.close(); } catch {}
        }
      }
    }
    return injectedCount > 0;
  } catch {
    return false;
  }
}

async function install(options = {}) {
  const customPathIdx = process.argv.indexOf('--path');
  const customPath = options.path || (customPathIdx >= 0 ? process.argv[customPathIdx + 1] : null);
  const customBackupIdx = process.argv.indexOf('--backup');
  const explicitBackup = options.backup || (customBackupIdx >= 0 ? process.argv[customBackupIdx + 1] : null);

  const installed = findAsarPath(customPath);
  const stateDir = getStateDir();
  let sourceArchive = installed;
  let previousManifest = null;
  const manifestPath = path.join(stateDir, 'installation.json');
  const legacyManifestPath = path.join(__dirname, 'installation.json');
  const activeManifestPath = fs.existsSync(manifestPath)
    ? manifestPath
    : (fs.existsSync(legacyManifestPath) ? legacyManifestPath : null);

  if (activeManifestPath) {
    try { previousManifest = JSON.parse(fs.readFileSync(activeManifestPath, 'utf8')); } catch {}
  }

  // 获取目标文件互斥锁，避免并发改写冲突
  const fileLock = acquireFileLock(installed);

  try {
    // 1. 若用户显式传入了 --backup 参数，严格校验其对应关系，不合规立即明确报错，绝不静默回退
    if (explicitBackup !== undefined && explicitBackup !== null) {
      const resolvedBackup = path.resolve(String(explicitBackup).trim());
      if (!fs.existsSync(resolvedBackup) || !fs.statSync(resolvedBackup).isFile()) {
        throw new Error(`指定的 --backup 文件不存在或无效: ${resolvedBackup}`);
      }
      let bHostVer = null;
      let bUtils = null;
      try {
        bHostVer = JSON.parse(extractAsarFile(resolvedBackup, 'package.json').toString('utf8')).version;
        bUtils = extractAsarFile(resolvedBackup, 'dist/utils.js').toString('utf8');
      } catch (e) {
        throw new Error(`指定的 --backup 文件无法被解析为合法 ASAR 归档: ${e.message}`);
      }
      let tHostVer = null;
      try {
        tHostVer = JSON.parse(extractAsarFile(installed, 'package.json').toString('utf8')).version;
      } catch {}
      if (bHostVer && tHostVer && bHostVer !== tHostVer) {
        throw new Error(`指定的 --backup 宿主版本 (v${bHostVer}) 与当前目标宿主版本 (v${tHostVer}) 不匹配，拒绝跨版本还原。`);
      }
      if (bUtils.includes('installContextMeter') || bUtils.includes(TAGS.METER_UTILS_START)) {
        throw new Error('指定的 --backup 文件包含本插件修改痕迹，不能作为原版基底。');
      }
      if (!verifyCleanStructure(bUtils)) {
        throw new Error('指定的 --backup 文件的 dist/utils.js 缺少标准宿主标记或语法校验未通过。');
      }
      sourceArchive = resolvedBackup;
      console.log(`[Installation] 已校验并选用显式指定的备份文件 (${path.basename(resolvedBackup)}) 作为打包基底。`);
    }

    // 2. 基底选择与原位精准解构自愈（未显式指定 --backup 时执行）
    let inPlaceCleanedUtils = null;
    let inPlaceCleanedPreload = null;

    if (sourceArchive === installed) {
      let currentUtilsRaw = null;
      let currentPreloadRaw = null;
      let targetHostVer = null;
      try {
        currentUtilsRaw = extractAsarFile(installed, 'dist/utils.js').toString('utf8');
        currentPreloadRaw = extractAsarFile(installed, 'dist/preload.js').toString('utf8');
        targetHostVer = JSON.parse(extractAsarFile(installed, 'package.json').toString('utf8')).version;
      } catch (e) {
        throw new Error(`无法解析当前目标 ASAR 内容: ${e.message}`);
      }

      const hasPluginTrace = currentUtilsRaw.includes('installContextMeter') ||
                             currentUtilsRaw.includes(TAGS.METER_UTILS_START) ||
                             currentUtilsRaw.includes(TAGS.PROXY_START) ||
                             currentPreloadRaw.includes(TAGS.CHINESE_START);

      if (!hasPluginTrace) {
        // 场景 A: 纯净宿主（全新安装或宿主官方升级后，无本插件任何模块痕迹）
        sourceArchive = installed;
      } else {
        // 场景 B: 目标包含插件痕迹
        const isKnownInstallation = Boolean(
          previousManifest &&
          previousManifest.installed &&
          path.resolve(previousManifest.installed) === path.resolve(installed)
        );

        // 若为未知的外部篡改文件（本地无安装记录且未显式指定合规备份），严格拒绝安装以保护文件
        if (!isKnownInstallation && !explicitBackup) {
          throw new Error(
            '当前 ASAR 包含未知的补丁修改痕迹且哈希不匹配安装记录，且结构无法安全解构或本地未找到通过校验的官方原版备份。为保护宿主文件安全，已安全中止安装。\n' +
            '可执行的恢复路径：\n' +
            '1. 若您持有官方原版备份文件，请使用 --backup <path-to-clean-base.asar> 指定；\n' +
            '2. 或重新运行 Antigravity 官方安装程序执行修复以恢复纯净 ASAR，随后重新安装本插件。'
          );
        }

        // 优先评估能否在当前文件自身基础上原位清洗，以 100% 保留用户的第三方修改、汉化内容与现有构建
        const potentialCleanUtils = cleanUtilsSource(currentUtilsRaw);
        const potentialCleanPreload = cleanPreloadSource(currentPreloadRaw);

        if (verifyCleanStructure(potentialCleanUtils)) {
          // 原位清洗自证通过！保留所有无关内容，不丢第三方修改，也不回退宿主版本
          inPlaceCleanedUtils = potentialCleanUtils;
          inPlaceCleanedPreload = potentialCleanPreload;
          sourceArchive = installed;
          console.log('[Installation] 当前 ASAR 包含旧补丁痕迹，已通过原位解构精准移除插件挂载，并完整保留宿主现有修改与构建内容。');
        } else {
          // 原位清洗未通过标准结构校验（例如 utils.js 源码被外部严重破坏），回退检查本地合规原版备份
          let matchedBackup = null;
          if (previousManifest) {
            const isSameTarget = Boolean(previousManifest.installed && path.resolve(previousManifest.installed) === path.resolve(installed));
            if (isSameTarget) {
              if (previousManifest.backup && fs.existsSync(previousManifest.backup) && sha(fs.readFileSync(previousManifest.backup)) === previousManifest.originalSha256) {
                matchedBackup = previousManifest.backup;
              } else if (previousManifest.previousInstalledBackup && fs.existsSync(previousManifest.previousInstalledBackup) && sha(fs.readFileSync(previousManifest.previousInstalledBackup)) === previousManifest.previousInstalledSha256) {
                matchedBackup = previousManifest.previousInstalledBackup;
              }
              if (matchedBackup) {
                let bVer = null;
                let bClean = false;
                try {
                  bVer = JSON.parse(extractAsarFile(matchedBackup, 'package.json').toString('utf8')).version;
                  const bUtils = extractAsarFile(matchedBackup, 'dist/utils.js').toString('utf8');
                  bClean = verifyCleanStructure(bUtils);
                } catch {}
                if (bVer && targetHostVer && bVer === targetHostVer && bClean) {
                  sourceArchive = matchedBackup;
                  console.log(`[Installation] 已安全采信与当前宿主版本 (v${bVer}) 匹配的原版备份 (${path.basename(matchedBackup)}) 作为基底重新安装。`);
                }
              }
            }
          }

          if (sourceArchive === installed) {
            throw new Error(
              '当前 ASAR 包含未知的补丁修改痕迹且哈希不匹配安装记录，且结构无法安全解构或本地未找到通过校验的官方原版备份。为保护宿主文件安全，已安全中止安装。\n' +
              '可执行的恢复路径：\n' +
              '1. 若您持有官方原版备份文件，请使用 --backup <path-to-clean-base.asar> 指定；\n' +
              '2. 或重新运行 Antigravity 官方安装程序执行修复以恢复纯净 ASAR，随后重新安装本插件。'
            );
          }
        }
      }
    }

    // 3. 模块配置解析与状态管理
    const modulesConfig = loadModulesConfig();
    if (options.modules) {
      if (options.modules.meter) Object.assign(modulesConfig.modules.meter, options.modules.meter);
      if (options.modules.chinese) {
        Object.assign(modulesConfig.modules.chinese, options.modules.chinese);
        if (options.modules.chinese.language !== undefined) {
          modulesConfig.modules.chinese.language = String(options.modules.chinese.language).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
          modulesConfig.modules.chinese.enabled = modulesConfig.modules.chinese.language === 'zh-CN';
        } else if (options.modules.chinese.enabled !== undefined) {
          modulesConfig.modules.chinese.language = options.modules.chinese.enabled ? 'zh-CN' : 'en';
        }
      }
      if (options.modules.proxy) Object.assign(modulesConfig.modules.proxy, options.modules.proxy);
    }
    if (process.argv.includes('--enable-chinese')) {
      modulesConfig.modules.chinese.enabled = true;
      modulesConfig.modules.chinese.language = 'zh-CN';
    }
    if (process.argv.includes('--disable-chinese')) {
      modulesConfig.modules.chinese.enabled = false;
      modulesConfig.modules.chinese.language = 'en';
    }
    if (process.argv.includes('--enable-proxy')) modulesConfig.modules.proxy.enabled = true;
    if (process.argv.includes('--disable-proxy')) modulesConfig.modules.proxy.enabled = false;
    const proxyUrlIdx = process.argv.indexOf('--proxy-url');
    if (proxyUrlIdx >= 0 && process.argv[proxyUrlIdx + 1]) {
      modulesConfig.modules.proxy.proxyUrl = process.argv[proxyUrlIdx + 1];
    }
    saveModulesConfig(modulesConfig);

    const version = JSON.parse(extractAsarFile(sourceArchive, 'package.json').toString('utf8')).version;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
    const backupDir = path.join(stateDir, 'backups');
    const snapshotDir = path.join(backupDir, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });

    // 4. 改写前保存带有时间戳与当前实际哈希的唯一快照，用于写入失败紧急恢复
    const currentInstalledSha = sha(fs.readFileSync(installed));
    const snapshotFile = path.join(snapshotDir, `app-${version}-preinstall-${stamp}-${currentInstalledSha.slice(0, 8)}.asar`);
    fs.copyFileSync(installed, snapshotFile);

    // 5. 建立长期官方原版备份（基于当前目标路径与宿主版本严格物理隔离）
    const targetKey = crypto.createHash('sha256').update(path.resolve(installed)).digest('hex').slice(0, 8);
    const backup = path.join(backupDir, `app-${version}-${targetKey}-base.asar`);

    if (!fs.existsSync(backup)) {
      if (sourceArchive !== installed) {
        fs.copyFileSync(sourceArchive, backup);
      } else if (!extractAsarFile(sourceArchive, 'dist/utils.js').toString('utf8').includes('installContextMeter')) {
        fs.copyFileSync(sourceArchive, backup);
      }
    }

    const staging = path.join(os.tmpdir(), `ag-context-meter-pkg-${stamp}`);
    const packed = path.join(os.tmpdir(), `ag-context-meter-${stamp}.asar`);

    try {
      fs.mkdirSync(staging, { recursive: true });
      clearAsarCache(sourceArchive);
      extractAllAsar(sourceArchive, staging);

      // 先完成底层 utils 与 preload 的全量原位清洗
      let cleanUtils = cleanUtilsSource(inPlaceCleanedUtils || extractAsarFile(sourceArchive, 'dist/utils.js').toString('utf8'));
      let cleanPreload = cleanPreloadSource(inPlaceCleanedPreload || extractAsarFile(sourceArchive, 'dist/preload.js').toString('utf8'));

      if (!verifyCleanStructure(cleanUtils)) {
        throw new Error('清洗后的 utils.js 结构校验未通过 (Unexpected createWindow/setupNodeWrapper) 或 JavaScript 语法自证失败，中止写入以保护宿主环境。');
      }

      let finalUtils = cleanUtils;
      let finalPreload = cleanPreload;

      // 6. 模块组装注入（使用成对标记与运行时配置门禁，默认完整注入三模块能力，通过 modules.json 精确控制开关）
      // 若用户或测试显式传入 pureMeterOnly: true 或 --pure-meter-only，则仅注入上下文监控
      const isPureMeterOnly = Boolean(options.pureMeterOnly || process.argv.includes('--pure-meter-only'));

      // 模块 A: Proxy NoTun (免 TUN 代理组件注入)
      const shouldInjectProxy = !isPureMeterOnly && (modulesConfig.modules.proxy.enabled || options.injectProxy !== false);
      if (shouldInjectProxy) {
        const proxyCode = generateProxyUtilsCode(modulesConfig.modules.proxy);
        finalUtils = proxyCode + '\n' + finalUtils;
      }

      // 模块 B: Context Meter (上下文与 Token 监控)
      if (modulesConfig.modules.meter.enabled) {
        const meterUtils = generateMeterUtilsCode();
        finalUtils = finalUtils
          .replace('"use strict";', `"use strict";\n${meterUtils.headerProxyHook}`)
          .replace('function setupNodeWrapper(env) {', `function setupNodeWrapper(env) {${meterUtils.nodeWrapperHook}`)
          .replace("titleBarStyle: 'hidden',", `titleBarStyle: 'hidden',${meterUtils.menuBarOption}`)
          .replace('    void win.loadURL(url);', `${meterUtils.windowLoadHook}    void win.loadURL(url);`);

        const createWinSig = 'function createWindow(url, storageManager, options) {';
        if (finalUtils.includes(createWinSig) && !finalUtils.includes('__agDefaultStorageManager')) {
          finalUtils = finalUtils.replace(createWinSig, createWinSig + meterUtils.storageFallback);
        }
        if (finalUtils.includes('wins[0].focus();') && !finalUtils.includes('ensureMeterInjected(wins[0]')) {
          finalUtils = finalUtils.replace('wins[0].focus();', 'wins[0].focus();' + meterUtils.focusHook);
        }
        if (finalUtils.includes('createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);') && !finalUtils.includes('ensureMeterInjected(_mWin')) {
          finalUtils = finalUtils.replace('createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);', 'const _mWin = createWindow(`${constants_1.WINDOW_ORIGIN}:${port}/`);' + meterUtils.createHook);
        }

        finalPreload += generateMeterPreloadCode();
      }

      // 模块 C: Chinese (桌面端界面汉化组件注入)
      const shouldInjectChinese = !isPureMeterOnly && (modulesConfig.modules.chinese.enabled || options.injectChinese !== false);
      if (shouldInjectChinese) {
        const homeDir = os.homedir();
        const localAppDir = process.platform === 'win32'
          ? (process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'))
          : (process.platform === 'darwin'
            ? path.join(homeDir, 'Library', 'Application Support')
            : path.join(homeDir, '.local', 'state'));
        const dictCandidates = [
          path.join(__dirname, 'i18n', 'zh-CN.json'),
          path.join(__dirname, 'src', 'i18n', 'zh-CN.json'),
          path.join(__dirname, 'dist', 'i18n', 'zh-CN.json'),
          path.join(__dirname, '..', 'i18n', 'zh-CN.json'),
          path.join(localAppDir, 'AntigravityContextMeter', 'i18n', 'zh-CN.json')
        ];
        const runtimeCandidates = [
          path.join(__dirname, 'i18n', 'i18n-runtime.js'),
          path.join(__dirname, 'src', 'i18n', 'i18n-runtime.js'),
          path.join(__dirname, 'dist', 'i18n', 'i18n-runtime.js'),
          path.join(__dirname, '..', 'i18n', 'i18n-runtime.js'),
          path.join(localAppDir, 'AntigravityContextMeter', 'i18n', 'i18n-runtime.js')
        ];
        const dictP = dictCandidates.find(p => fs.existsSync(p));
        const rtP = runtimeCandidates.find(p => fs.existsSync(p));
        if (dictP && rtP) {
          const dictContent = fs.readFileSync(dictP, 'utf8');
          const runtimeContent = fs.readFileSync(rtP, 'utf8');
          finalPreload += generateChinesePreloadCode(dictContent, runtimeContent);
        } else {
          throw new Error('未找到客户端汉化字典 (zh-CN.json) 或运行时脚本 (i18n-runtime.js)，拒绝在缺少必要资源时完成安装。');
        }
      }

      // 7. 写回前对最终 JavaScript 语法做严格校验断言
      if (!validateSyntax(finalUtils, 'dist/utils.js')) {
        throw new Error('注入后生成的 dist/utils.js 未通过 JavaScript 语法编译断言，中止写入以保护宿主安全。');
      }
      if (!validateSyntax(finalPreload, 'dist/preload.js')) {
        throw new Error('注入后生成的 dist/preload.js 未通过 JavaScript 语法编译断言，中止写入以保护宿主安全。');
      }

      fs.writeFileSync(path.join(staging, 'dist', 'utils.js'), finalUtils, 'utf8');
      fs.writeFileSync(path.join(staging, 'dist', 'preload.js'), finalPreload, 'utf8');

      // 8. 拷贝各模块 additions
      const additions = [
        'asar-engine.js',
        'modules-config.js',
        'modular-installer.js',
        'install.js',
        'restore.js',
        'meter-main.js',
        'meter-core.js',
        'meter-renderer.js',
        'meter-collector.js',
        'meter-storage.js',
        'meter-proxy.js',
        'meter-cli-launcher.js',
        'meter-terminals.js',
        'meter-context-unlock.js',
        'local-api.js',
        'attachment_scan.py'
      ];
      for (const file of additions) {
        const srcP = path.join(__dirname, file);
        if (fs.existsSync(srcP) && !fs.statSync(srcP).isDirectory()) {
          fs.copyFileSync(srcP, path.join(staging, 'dist', file));
        } else {
          const inStaging = path.join(staging, 'dist', file);
          if (!fs.existsSync(inStaging)) {
            throw new Error(`缺少必需的模块依赖文件: ${file}，拒绝生成不完整的 ASAR 归档！`);
          }
        }
      }

      const optionalAdditions = [
        'ag-enhancer-overlay.js',
        'ag-codex-overlay.js',
        'pulse-capsule-overlay.js',
        'antigravity-hans-overlay.js',
        'live-host.js',
        'mobile-remote.js',
        'meter-enhance.js'
      ];
      const copiedOptionalAdditions = [];
      for (const file of optionalAdditions) {
        const srcP = path.join(__dirname, file);
        const dstP = path.join(staging, 'dist', file);
        if (fs.existsSync(srcP) && !fs.statSync(srcP).isDirectory()) {
          fs.copyFileSync(srcP, dstP);
          copiedOptionalAdditions.push(file);
        } else if (fs.existsSync(dstP)) {
          copiedOptionalAdditions.push(file);
        }
      }

      // 拷贝 i18n 资源文件至 ASAR 内部，确保运行中客户端可离线切换汉化
      const i18nSrcDir = path.join(__dirname, 'i18n');
      if (fs.existsSync(i18nSrcDir)) {
        const i18nDstDir = path.join(staging, 'dist', 'i18n');
        fs.mkdirSync(i18nDstDir, { recursive: true });
        for (const item of ['zh-CN.json', 'i18n-runtime.js']) {
          const itemP = path.join(i18nSrcDir, item);
          if (fs.existsSync(itemP)) fs.copyFileSync(itemP, path.join(i18nDstDir, item));
        }
      }

      const originalEntries = asar.listPackage(sourceArchive);
      const hasUnpacked = originalEntries.some(file => {
        const s = asar.statFile(sourceArchive, file.slice(1));
        return s && s.unpacked;
      });

      if (hasUnpacked) {
        await builtinAsar.createPackageWithOptions(staging, packed, { unpackDir: '**/chrome-devtools-mcp' });
      } else {
        await builtinAsar.createPackageWithOptions(staging, packed, {});
      }

      let verified = 0;
      const allowedChanges = [
        'dist/utils.js',
        'dist/preload.js',
        'dist/i18n/zh-CN.json',
        'dist/i18n/i18n-runtime.js',
        ...additions.map(f => 'dist/' + f),
        ...copiedOptionalAdditions.map(f => 'dist/' + f)
      ].map(p => path.normalize(p));
      for (const file of originalEntries) {
        const name = path.normalize(file.slice(1));
        const before = asar.statFile(sourceArchive, name);
        const after = asar.statFile(packed, name);
        if (before.files || before.link) continue;
        if (!!before.unpacked !== !!after.unpacked) throw new Error(`Unpack flag changed: ${name}`);
        const isAllowed = allowedChanges.includes(name) || name.startsWith('dist' + path.sep + 'i18n' + path.sep);
        if (!isAllowed && sha(asar.extractFile(sourceArchive, name)) !== sha(asar.extractFile(packed, name))) {
          throw new Error(`Unexpected file change: ${name}`);
        }
        verified++;
      }

      const isSameTargetManifest = Boolean(previousManifest?.installed && path.resolve(previousManifest.installed) === path.resolve(installed));
      const previousInstalledBackup = (isSameTargetManifest && previousManifest?.previousInstalledBackup && fs.existsSync(previousManifest.previousInstalledBackup))
        ? previousManifest.previousInstalledBackup
        : path.join(backupDir, `pre-meter-${version}-${targetKey}.asar`);

      if (fs.existsSync(backup) && !fs.existsSync(previousInstalledBackup)) {
        try { fs.copyFileSync(backup, previousInstalledBackup); } catch {}
      }
      const previousInstalledSha256 = fs.existsSync(previousInstalledBackup) ? sha(fs.readFileSync(previousInstalledBackup)) : null;
      const origSha = fs.existsSync(backup) ? sha(fs.readFileSync(backup)) : (previousInstalledSha256 || previousManifest?.originalSha256);

      const { PROJECT_VERSION } = require('./modules-config');
      const pkgVersion = PROJECT_VERSION;

      const manifest = {
        meterVersion: pkgVersion,
        version,
        installed,
        backup,
        previousInstalledBackup,
        previousInstalledSha256,
        originalSha256: origSha,
        patchedSha256: sha(fs.readFileSync(packed)),
        originalFilesVerified: verified,
        added: [...additions, ...copiedOptionalAdditions].map(f => 'dist/' + f),
        modified: ['dist/utils.js', 'dist/preload.js'],
        installedAt: new Date().toISOString(),
        enabledModules: Object.entries(modulesConfig.modules).filter(([, v]) => v.enabled).map(([k]) => k)
      };

      let installCommitted = false;
      const tempReplacement = path.join(path.dirname(installed), `app.asar.tmp_${stamp}`);

      try {
        // 9. 临时文件写入与校验
        fs.copyFileSync(packed, tempReplacement);
        if (sha(fs.readFileSync(tempReplacement)) !== manifest.patchedSha256) {
          throw new Error('Packed temporary file checksum mismatch; aborting before touching target.');
        }

        // 10. 安全原子替换目标文件
        try {
          fs.copyFileSync(tempReplacement, installed);
          clearAsarCache(installed);
        } catch (err) {
          if (err.code === 'EBUSY' || err.code === 'EPERM') {
            throw new Error(`无法写入目标文件 (${installed})：文件正被运行中的 Antigravity 锁定。请先完全退出 Antigravity 客户端后再运行！`);
          }
          throw err;
        } finally {
          try { if (fs.existsSync(tempReplacement)) fs.unlinkSync(tempReplacement); } catch {}
        }

        if (sha(fs.readFileSync(installed)) !== manifest.patchedSha256) {
          throw new Error('Installed checksum mismatch');
        }

        // 11. 安装后从目标 ASAR 中重新读取核心启动文件并核对哈希与启动逻辑
        const extractedLauncher = extractAsarFile(installed, 'dist/meter-cli-launcher.js').toString('utf8');
        const localLauncherCandidates = [
          path.join(__dirname, 'meter-cli-launcher.js'),
          path.join(__dirname, '..', 'meter-cli-launcher.js')
        ];
        const localLauncherPath = localLauncherCandidates.find(p => fs.existsSync(p));
        const installedLauncherSha = sha(Buffer.from(extractedLauncher, 'utf8'));
        if (localLauncherPath) {
          const localLauncherSha = sha(fs.readFileSync(localLauncherPath));
          if (installedLauncherSha !== localLauncherSha) {
            throw new Error(`ASAR 内 meter-cli-launcher.js 哈希核验失败 (ASAR: ${installedLauncherSha}, Local: ${localLauncherSha})`);
          }
        }
        if (extractedLauncher.includes("spawnSync('powershell.exe'") || extractedLauncher.includes('timeout: 8000')) {
          throw new Error('ASAR 内仍然残留旧版同步 PowerShell 启动逻辑，拒绝完成安装！');
        }
        if (!extractedLauncher.includes('0.8.2-helper-v2')) {
          throw new Error('ASAR 内未包含最新的 LAUNCHER_VERSION 标识，拒绝完成安装！');
        }

        const extractedMain = extractAsarFile(installed, 'dist/meter-main.js').toString('utf8');
        const localMainCandidates = [
          path.join(__dirname, 'meter-main.js'),
          path.join(__dirname, '..', 'meter-main.js')
        ];
        const localMainPath = localMainCandidates.find(p => fs.existsSync(p));
        const installedMainSha = sha(Buffer.from(extractedMain, 'utf8'));
        if (localMainPath) {
          const localMainSha = sha(fs.readFileSync(localMainPath));
          if (installedMainSha !== localMainSha) {
            throw new Error(`ASAR 内 meter-main.js 哈希核验失败 (ASAR: ${installedMainSha}, Local: ${localMainSha})`);
          }
        }

        // 12. 同步部署 CLI 辅助定位程序至状态目录与资源目录并核对哈希
        let helperSha = null;
        const helperCandidates = [
          path.join(__dirname, 'scripts', 'cli-window-helper.exe'),
          path.join(__dirname, '..', 'scripts', 'cli-window-helper.exe'),
          path.join(stateDir, 'cli-window-helper.exe'),
          path.join(path.dirname(installed), 'bin', 'cli-window-helper.exe')
        ];
        const helperSrc = helperCandidates.find(p => fs.existsSync(p));
        if (helperSrc) {
          helperSha = sha(fs.readFileSync(helperSrc));
          const deployedHelperPath = path.join(stateDir, 'cli-window-helper.exe');
          if (deployedHelperPath !== helperSrc) {
            fs.copyFileSync(helperSrc, deployedHelperPath);
          }
          const deployedSha = sha(fs.readFileSync(deployedHelperPath));
          if (deployedSha !== helperSha) {
            throw new Error(`部署的 helper 哈希不一致 (目标: ${deployedSha}, 源: ${helperSha})`);
          }
          const resBinDir = path.join(path.dirname(installed), 'bin');
          if (fs.existsSync(resBinDir)) {
            try {
              fs.copyFileSync(helperSrc, path.join(resBinDir, 'cli-window-helper.exe'));
            } catch {}
          }
        }

        manifest.verifiedLauncherSha256 = installedLauncherSha;
        manifest.verifiedMainSha256 = installedMainSha;
        manifest.helperSha256 = helperSha;
        manifest.verifiedAt = new Date().toISOString();

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        installCommitted = true;
        const liveInjected = await tryHotInject();
        return { ...manifest, liveInjected };
      } catch (err) {
        // 失败回滚机制：若在改写目标后发生任何校验或保存异常，立即从快照无损回滚还原
        if (!installCommitted && fs.existsSync(snapshotFile)) {
          try {
            fs.copyFileSync(snapshotFile, installed);
            clearAsarCache(installed);
            console.error(`[Failure-Rollback] 安装过程异常中断，已自动从改写前快照还原目标文件: ${installed}`);
          } catch (rollbackErr) {
            console.error(`[Fatal Rollback Error] 快照回滚失败: ${rollbackErr.message}`);
          }
        }
        throw err;
      }
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(packed, { force: true }); } catch {}
      try { fs.rmSync(packed + '.unpacked', { recursive: true, force: true }); } catch {}
    }
  } finally {
    fileLock.release();
  }
}

if (require.main === module) {
  const isTestEnv = process.env.AG_METER_TEST_MODE === '1' || process.env.NODE_ENV === 'test';
  const allowAsarPatch = isTestEnv || process.argv.includes('--allow-asar-patch');
  if (!allowAsarPatch) {
    console.error('❌ 本套件默认采用 100% 零改包设计，已禁用直接运行 install.js 修改 app.asar；请改用 node cli.js live。');
    process.exitCode = 1;
  } else {
    install()
      .then(manifest => console.log(JSON.stringify(manifest, null, 2)))
      .catch(error => {
        console.error(String(error.stack || error.message).slice(0, 2000));
        process.exitCode = 1;
      });
  }
}

module.exports = { install, findAsarPath, tryHotInject, extractAsarFile };
