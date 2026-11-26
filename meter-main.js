'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
let ipcMain = null;
let app = null;
let electronDialog = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object') {
    ipcMain = electron.ipcMain;
    app = electron.app;
    electronDialog = electron.dialog;
  }
} catch {}
const {
  collect,
  collectTokenHistory,
  collectTokenHistoryAsync,
  recordModelCalls,
  getPluginSettings,
  savePluginSettings,
  launchCliSession,
  detectAvailableTerminals,
  pickTerminalExecutableDialog,
  scanUserInstalledFonts,
  checkUpdateAsync,
  applyUpdateAsync,
  getContextUnlockStatus,
  applyContextUnlock,
  restoreContextUnlock
} = require('./meter-collector');
const { isValidExternalUrl } = require('./meter-core');

const { applyProxyEnvironment } = require('./meter-proxy');

function ensureProxyEnvironment(targetEnv = process.env) {
  try {
    return applyProxyEnvironment(targetEnv);
  } catch {
    return targetEnv;
  }
}
ensureProxyEnvironment(process.env);
exports.ensureProxyEnvironment = ensureProxyEnvironment;

function getMeterSource() {
  try {
    const coreCode = fs.readFileSync(path.join(__dirname, 'meter-core.js'), 'utf8');
    const rendererCode = fs.readFileSync(path.join(__dirname, 'meter-renderer.js'), 'utf8');
    let bootstrap = '';
    try {
      const settingsSnap = getPluginSettings();
      if (settingsSnap && settingsSnap.ok) {
        bootstrap += `window.__AGContextMeterSettings = ${JSON.stringify(settingsSnap)};\n`;
      }
    } catch {}
    return `${bootstrap}${coreCode}\n${rendererCode}\ntrue;`;
  } catch (e) {
    return '';
  }
}

function isLocalMainFrameSender(event) {
  try {
    const rawUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1') return null;
    if (event.senderFrame && event.sender?.mainFrame && event.senderFrame !== event.sender.mainFrame) return null;
    return url;
  } catch {
    return null;
  }
}

function resolveTargetWindow(sender) {
  try {
    const { BrowserWindow } = require('electron');
    const direct = BrowserWindow.fromWebContents(sender);
    if (direct && !direct.isDestroyed()) return direct;
  } catch {}
  try {
    const utils = require('./utils');
    if (typeof utils.resolveHubWindowFromWebContents === 'function') {
      const hubWin = utils.resolveHubWindowFromWebContents(sender);
      if (hubWin && !hubWin.isDestroyed?.()) return hubWin;
    }
  } catch {}
  return null;
}

let registered = false;
let isAppQuitting = false;
const boundWindows = new WeakSet();
const boundWebContents = new WeakSet();
const injectionTimers = new WeakMap();
const wcProbeTimers = new WeakMap();

function setAppQuitting(val = true) {
  isAppQuitting = Boolean(val);
}

function getAppQuitting() {
  return isAppQuitting;
}

async function handleModulesStatus(event, customAsar = null) {
  const url = isLocalMainFrameSender(event);
  if (!url) throw new Error('仅允许本机主聊天窗口');
  try {
    const { loadModulesConfig, inspectDiskModules } = require('./modules-config');
    return { ok: true, data: loadModulesConfig(), disk: inspectDiskModules(customAsar) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleToggleModule(event, moduleName, enable, extraOpts = {}) {
  const url = isLocalMainFrameSender(event);
  if (!url) throw new Error('仅允许本机主聊天窗口');
  try {
    const { loadModulesConfig, saveModulesConfig, inspectDiskModules, normalizeBrandTitle, normalizeClientLanguage } = require('./modules-config');
    const cfg = loadModulesConfig();
    if (!cfg.modules[moduleName]) throw new Error(`未知的模块标识: ${moduleName}`);

    const targetEnable = Boolean(enable);
    const disk = inspectDiskModules(extraOpts?.asarPath || null);

    // 判断磁盘是否已经具备该模块所需脚本、字典及配置读取能力
    const hasDiskCapability = (() => {
      if (moduleName === 'chinese') {
        return Boolean(disk.chineseReady);
      } else if (moduleName === 'proxy') {
        return Boolean(disk.proxyReady);
      } else if (moduleName === 'meter') {
        return Boolean(disk.meterReady);
      }
      return false;
    })();

    // 结果类型 1: 已有完整运行时可通过配置切换 (config_toggled)
    if (hasDiskCapability) {
      if (moduleName === 'chinese') {
        const nextLang = normalizeClientLanguage(extraOpts?.language, targetEnable);
        cfg.modules.chinese.language = nextLang;
        cfg.modules.chinese.enabled = nextLang === 'zh-CN' || nextLang === 'zh-TW';
        if (extraOpts?.brandTitle !== undefined) cfg.modules.chinese.brandTitle = normalizeBrandTitle(extraOpts.brandTitle);
        cfg.modules.chinese.lastUpdated = new Date().toISOString();
      } else {
        cfg.modules[moduleName].enabled = targetEnable;
        if (moduleName === 'proxy' && extraOpts) {
          if (extraOpts.proxyUrl) cfg.modules.proxy.proxyUrl = extraOpts.proxyUrl;
          if (extraOpts.bypassList) cfg.modules.proxy.bypassList = extraOpts.bypassList;
        }
      }
      saveModulesConfig(cfg);
      const msg = targetEnable
        ? `已开启配置，重启客户端后生效`
        : `已关闭配置，需完全重启客户端彻底退出`;
      return {
        ok: true,
        status: 'config_toggled',
        data: cfg,
        disk,
        restartRequired: true,
        message: msg
      };
    }

    // 若用户是关闭一个原本就未注入的模块，直接同步配置
    if (!targetEnable) {
      cfg.modules[moduleName].enabled = false;
      if (moduleName === 'chinese') {
        cfg.modules.chinese.language = 'en';
      }
      saveModulesConfig(cfg);
      return {
        ok: true,
        status: 'config_toggled',
        data: cfg,
        disk,
        restartRequired: false,
        message: '模块未注入，配置保持关闭'
      };
    }

    // 结果类型 3: 磁盘上原本没有该组件/资源，无法在客户端运行中直接热注入
    // 明确提示用户需完全退出客户端后，在安装包目录运行 install.bat 或对应命令完成注入
    return {
      ok: false,
      status: 'install_failed',
      data: cfg,
      disk,
      error: `当前客户端磁盘 ASAR 未注入${moduleName === 'chinese' ? '汉化' : '免 TUN 代理'}组件（或组件不完整）。由于客户端正在运行受系统文件保护，请完全退出 Antigravity 客户端后，在安装包目录运行 install.bat 完成注入。`,
      restartRequired: false
    };
  } catch (e) {
    console.error(`[AntigravityContextMeter] 切换模块 ${moduleName} 异常:`, e);
    return { ok: false, status: 'error', error: e.message };
  }
}

function registerIpcOnce() {
  if (registered || !ipcMain) return;
  registered = true;

  ipcMain.handle('context-meter:scan', async (event, id, force) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return { ok: true, data: await collect(url.origin, id, { force: force === true }) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:record-calls', async (event, calls) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      const res = recordModelCalls(calls);
      if (res && typeof res === 'object') {
        if (res.ok === false) {
          return { ok: false, error: res.error || '入账失败', changed: false };
        }
        return { ok: true, changed: !!res.changed };
      }
      return { ok: true, changed: !!res };
    } catch (e) {
      return { ok: false, error: e.message, changed: false };
    }
  });

  ipcMain.handle('context-meter:token-history', async (event, force) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return { ok: true, data: await collectTokenHistoryAsync({ force: force === true }) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:get-settings', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return getPluginSettings(options || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:save-settings', async (event, payload) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return savePluginSettings(payload || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:launch-cli', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      const targetWin = resolveTargetWindow(event.sender);
      let ownerHwndStr = '0';
      let hostBounds = null;
      if (targetWin && !targetWin.isDestroyed()) {
        try {
          const buf = targetWin.getNativeWindowHandle();
          if (buf && buf.length >= 8) {
            ownerHwndStr = buf.readBigInt64LE(0).toString();
          } else if (buf && buf.length >= 4) {
            ownerHwndStr = buf.readInt32LE(0).toString();
          }
        } catch {}
        try {
          hostBounds = targetWin.getBounds();
        } catch {}
      }
      const res = await launchCliSession({
        ...options,
        ownerHwnd: ownerHwndStr,
        hostBounds
      }, ownerHwndStr);

      try {
        console.log('[AntigravityContextMeter:CLI] launch-cli result:', JSON.stringify({
          ok: res?.ok,
          terminalSpawned: res?.terminalSpawned,
          cliAlive: res?.cliAlive,
          isCentered: res?.isCentered,
          isForeground: res?.isForeground,
          pid: res?.pid,
          runtimeInfo: res?.runtimeInfo,
          telemetry: res?.telemetry
        }));
      } catch {}

      return res;
    }
    catch (e) {
      console.error('[AntigravityContextMeter:CLI] launch-cli exception:', e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:sync-overlay', async (event, options) => {
    try {
      const targetWin = resolveTargetWindow(event.sender);
      if (!targetWin || targetWin.isDestroyed?.()) return { ok: false };
      if (process.platform === 'win32') {
        try {
          if (typeof targetWin.setMenuBarVisibility === 'function') targetWin.setMenuBarVisibility(false);
          targetWin.autoHideMenuBar = true;
        } catch {}
      }
      if (typeof targetWin.setTitleBarOverlay !== 'function') return { ok: true };
      const patch = {};
      if (options && typeof options.color === 'string') patch.color = options.color;
      if (options && typeof options.symbolColor === 'string') patch.symbolColor = options.symbolColor;
      const rawHeight = options?.height ?? options?.heightCssPx;
      if (options && Number.isFinite(Number(rawHeight)) && Number(rawHeight) >= 24 && Number(rawHeight) <= 64) {
        patch.height = Math.round(Number(rawHeight));
      }
      targetWin.setTitleBarOverlay(patch);
      return { ok: true, patch };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:check-update', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return await checkUpdateAsync(options || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:apply-update', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try { return await applyUpdateAsync(options || {}); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('context-meter:open-external', async (event, targetUrl) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    if (!isValidExternalUrl(targetUrl)) {
      return { ok: false, error: '仅允许打开官方白名单链接（GitHub 仓库或作者署名主页）' };
    }
    try {
      const { shell } = require('electron');
      await shell.openExternal(targetUrl);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:open-browser-url', async (event, targetUrl) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    const raw = String(targetUrl || '').trim();
    if (!raw || /[\r\n\0]/.test(raw)) {
      return { ok: false, error: '无效的外部链接' };
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: '无效的外部链接' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      return { ok: false, error: '仅支持 http/https/mailto 外部链接' };
    }
    try {
      const { shell } = require('electron');
      await shell.openExternal(parsed.href);
      return { ok: true, url: parsed.href };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:context-unlock-status', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      return { ok: true, data: await getContextUnlockStatus(undefined, options || {}) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:context-unlock-apply', async (event) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      return applyContextUnlock();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:context-unlock-restore', async (event) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      return restoreContextUnlock();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:modules-status', handleModulesStatus);
  ipcMain.handle('context-meter:toggle-module', handleToggleModule);

  ipcMain.handle('context-meter:test-proxy', async (event, proxyUrl) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      const { testProxyHealth } = require('./modules-config');
      const report = await testProxyHealth(proxyUrl);
      return { ok: true, data: report };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:list-terminals', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      const savedPrefs = getPluginSettings()?.uiPreferences || {};
      const customPath = options?.customTerminalPath ?? savedPrefs.customTerminalPath ?? '';
      return detectAvailableTerminals({ customPath });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:pick-terminal-path', async (event) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      return await pickTerminalExecutableDialog({
        electronDialog,
        targetWin: resolveTargetWindow(event.sender)
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('context-meter:list-fonts', async (event, options) => {
    const url = isLocalMainFrameSender(event);
    if (!url) throw new Error('仅允许本机主聊天窗口');
    try {
      return {
        ok: true,
        fonts: scanUserInstalledFonts({ force: Boolean(options?.force) })
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

function getWindowWebContents(win) {
  if (!win || win.isDestroyed?.()) return null;
  // 1. 若为标准 BrowserWindow 或已定义 webContents getter
  if (win.webContents && !win.webContents.isDestroyed?.()) return win.webContents;

  // 2. 宿主官方 utils.getHubWebContents(win)（最权威主会话 WebContents 来源）
  try {
    const utils = require('./utils');
    if (typeof utils.getHubWebContents === 'function') {
      const wc = utils.getHubWebContents(win);
      if (wc && !wc.isDestroyed?.()) return wc;
    }
  } catch {}

  // 3. 针对 Antigravity 2.x BaseWindow + contentView 架构遍历子 View
  // 严格安全限制：仅选择主会话界面，坚决排除 curtainView（data: 协议）及无关弹窗
  try {
    const children = win.contentView?.children;
    if (Array.isArray(children)) {
      // 优先：明确匹配本地主聊天服务地址 (https://127.0.0.1:<port>/)
      for (const child of children) {
        if (child?.webContents && !child.webContents.isDestroyed?.()) {
          const url = child.webContents.getURL?.() || '';
          if (/^https:\/\/127\.0\.0\.1:\d+\//.test(url)) return child.webContents;
        }
      }
      // 次优：若正在加载中尚未完成导航，排除明确的 data: 遮罩页 (curtainView)
      for (const child of children) {
        if (child?.webContents && !child.webContents.isDestroyed?.()) {
          const url = child.webContents.getURL?.() || '';
          if (!url.startsWith('data:')) return child.webContents;
        }
      }
    }
  } catch {}
  return null;
}


function syncWindowOverlayHeight(win) {
  try {
    if (!win || process.platform === 'darwin' || win.isDestroyed?.() || typeof win.setTitleBarOverlay !== 'function') return;
    const wc = getWindowWebContents(win);
    const zf = typeof wc?.getZoomFactor === 'function' ? wc.getZoomFactor() : 1;
    const targetH = Math.max(28, Math.min(60, Math.round(40 * (Number.isFinite(zf) && zf > 0 ? zf : 1))));
    win.setTitleBarOverlay({ height: targetH });
  } catch {}
}

let embeddedBridge = null;
let embeddedBridgePromise = null;
let embeddedBridgeQuitHooked = false;

function canStartEmbeddedLiveBridge() {
  return Boolean(
    ipcMain &&
    app &&
    typeof app.on === 'function' &&
    process.env.AG_METER_TEST_MODE !== '1' &&
    process.env.NODE_ENV !== 'test' &&
    fs.existsSync(path.join(__dirname, 'live-host.js'))
  );
}

function readDiskLiveSession(hubOrigin) {
  try {
    const { getStateDir } = require('./asar-engine');
    const stampPath = path.join(getStateDir(), '.live-session.json');
    if (!fs.existsSync(stampPath)) return null;
    const info = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    if (!info || !info.port || !info.token) return null;
    if (hubOrigin && info.origin && info.origin !== hubOrigin) return null;
    if (info.pid) {
      process.kill(info.pid, 0);
    }
    return { port: Number(info.port), token: String(info.token) };
  } catch {
    return null;
  }
}

async function ensureEmbeddedLiveBridge(hubOrigin) {
  if (!canStartEmbeddedLiveBridge()) return null;
  if (embeddedBridge) {
    if (hubOrigin) embeddedBridge.setOrigin(hubOrigin);
    return embeddedBridge;
  }
  if (embeddedBridgePromise) {
    const b = await embeddedBridgePromise;
    if (b && hubOrigin) b.setOrigin(hubOrigin);
    return b;
  }
  embeddedBridgePromise = (async () => {
    try {
      const { startEmbeddedLiveBridge } = require('./live-host');
      const bridge = await startEmbeddedLiveBridge({
        origin: hubOrigin,
        embedded: true
      });
      embeddedBridge = bridge;
      if (!embeddedBridgeQuitHooked && typeof app?.once === 'function') {
        embeddedBridgeQuitHooked = true;
        app.once('will-quit', () => {
          try { embeddedBridge?.stop?.(); } catch {}
          embeddedBridge = null;
        });
      }
      return bridge;
    } catch (err) {
      console.warn('[Context Meter] Embedded live bridge startup warning:', err?.message || err);
      return null;
    } finally {
      embeddedBridgePromise = null;
    }
  })();
  return await embeddedBridgePromise;
}

function readOverlayFile(filename) {
  try {
    const p = path.join(__dirname, filename);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch {}
  return '';
}

function extractOverlayTag(source, regex) {
  if (!source) return '';
  const m = source.match(regex);
  return m ? m[1] : '';
}

async function ensureMeterInjected(win, options = {}) {
  try {
    if (!win || win.isDestroyed?.()) return false;
    const wc = getWindowWebContents(win);
    if (!wc || wc.isDestroyed?.()) {
      const attempt = Number(options.attempt || 0);
      const delays = [300, 600, 1000, 1500, 2500];
      if (attempt < delays.length && win && !win.isDestroyed?.()) {
        const prevTimer = injectionTimers.get(win);
        if (prevTimer) clearTimeout(prevTimer);
        const t = setTimeout(() => {
          injectionTimers.delete(win);
          void ensureMeterInjected(win, { ...options, attempt: attempt + 1 });
        }, delays[attempt]);
        injectionTimers.set(win, t);
      }
      return false;
    }
    const url = wc.getURL?.() || '';
    if (!/^https:\/\/127\.0\.0\.1:\d+\//.test(url)) {
      const attempt = Number(options.attempt || 0);
      const delays = [300, 600, 1000, 1500, 2500];
      if (attempt < delays.length && win && !win.isDestroyed?.()) {
        const prevTimer = injectionTimers.get(win);
        if (prevTimer) clearTimeout(prevTimer);
        const t = setTimeout(() => {
          injectionTimers.delete(win);
          void ensureMeterInjected(win, { ...options, attempt: attempt + 1 });
        }, delays[attempt]);
        injectionTimers.set(win, t);
      }
      return false;
    }

    syncWindowOverlayHeight(win);

    let liveInfo = null;
    try {
      const hubOrigin = new URL(url).origin;
      const bridge = await ensureEmbeddedLiveBridge(hubOrigin);
      liveInfo = bridge?.getInfo?.() || readDiskLiveSession(hubOrigin);
    } catch {}

    const hansSrc = readOverlayFile('antigravity-hans-overlay.js');
    const pulseSrc = readOverlayFile('pulse-capsule-overlay.js');
    const enhancerSrc = readOverlayFile('ag-enhancer-overlay.js');
    const codexSrc = readOverlayFile('ag-codex-overlay.js');
    const hasHansFile = Boolean(hansSrc);
    const hasPulseFile = Boolean(pulseSrc);
    const hasEnhancerFile = Boolean(enhancerSrc);
    const hasCodexFile = Boolean(codexSrc);
    const expectedHansFp = extractOverlayTag(hansSrc, /const\s+PATCH_FINGERPRINT\s*=\s*['"]([^'"]+)['"]/);
    const expectedPulseVer = extractOverlayTag(pulseSrc, /const\s+CAPSULE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    const expectedEnhancerVer = extractOverlayTag(enhancerSrc, /globalThis\.__AGEnhancer\s*=\s*\{[\s\S]*?version\s*:\s*['"]([^'"]+)['"]/);
    const expectedCodexVer = extractOverlayTag(codexSrc, /globalThis\.__AGCodexOverlay\s*=\s*\{[\s\S]*?version\s*:\s*['"]([^'"]+)['"]/);
    const expectedPort = Number(liveInfo?.port || 0);

    let state = null;
    if (!options.force) {
      try {
        const probeExpr = `(() => ({
          meterAlive: Boolean(window.__AGContextMeter && document.getElementById("ag-context-meter") && (window.__AGContextMeter.ensureAlive ? window.__AGContextMeter.ensureAlive() : true)),
          liveAlive: ${expectedPort ? `Boolean(window.__AGContextMeterLive && window.__AGContextMeterLive.port === ${expectedPort})` : 'true'},
          hansAlive: ${hasHansFile ? `Boolean(window.__antigravityZhPatchInstalled === true && window.__observedDocument === document${expectedHansFp ? ` && window.__antigravityZhPatchFingerprint === ${JSON.stringify(expectedHansFp)}` : ''})` : 'true'},
          pulseAlive: ${hasPulseFile ? `Boolean(window.__AGY_CTX_CAPSULE_ACTIVE__ === true${expectedPulseVer ? ` && window.__AGY_CTX_CAPSULE_VERSION__ === ${JSON.stringify(expectedPulseVer)}` : ''} && (document.querySelector('[data-agy-context-capsule="1"]') || !document.querySelector('.agy-composer-footer')))` : 'true'},
          enhancerAlive: ${hasEnhancerFile ? `Boolean(window.__AGEnhancer${expectedEnhancerVer ? ` && window.__AGEnhancer.version === ${JSON.stringify(expectedEnhancerVer)}` : ''} && typeof window.__AGEnhancer.isAlive === 'function' && window.__AGEnhancer.isAlive())` : 'true'},
          codexAlive: ${hasCodexFile ? `Boolean(window.__AGCodexOverlay${expectedCodexVer ? ` && window.__AGCodexOverlay.version === ${JSON.stringify(expectedCodexVer)}` : ''} && typeof window.__AGCodexOverlay.isAlive === 'function' && window.__AGCodexOverlay.isAlive())` : 'true'}
        }))()`;
        const res = await wc.executeJavaScript(probeExpr);
        if (res && typeof res === 'object') state = res;
      } catch {}
    }

    const meterAlive = Boolean(state?.meterAlive);
    const liveAlive = Boolean(state?.liveAlive);
    const hansAlive = Boolean(state?.hansAlive);
    const pulseAlive = Boolean(state?.pulseAlive);
    const enhancerAlive = Boolean(state?.enhancerAlive);
    const codexAlive = Boolean(state?.codexAlive);

    if (!options.force && meterAlive && liveAlive && hansAlive && pulseAlive && enhancerAlive && codexAlive) {
      return true;
    }

    if (liveInfo?.port && liveInfo?.token && (options.force || !liveAlive)) {
      try {
        await wc.executeJavaScript('window.__AGContextMeterLive=' + JSON.stringify({ port: liveInfo.port, token: liveInfo.token }) + ';');
      } catch {}
    }

    if (options.force || !meterAlive) {
      const runtimeSource = getMeterSource();
      if (!runtimeSource) return false;
      await wc.executeJavaScript(runtimeSource);
    }

    if (hasHansFile && (options.force || !hansAlive)) {
      try {
        await wc.executeJavaScript(hansSrc);
      } catch (e) {
        console.warn('[Context Meter] hans overlay inject warning:', e?.message || e);
      }
    }

    if (hasPulseFile && (options.force || !pulseAlive)) {
      try {
        await wc.executeJavaScript('try { window.__AGY_CTX_CAPSULE_DISPOSE__?.(); } catch {} window.__AGY_CTX_CAPSULE_ACTIVE__ = false;\n' + pulseSrc);
      } catch (e) {
        console.warn('[Context Meter] pulse overlay inject warning:', e?.message || e);
      }
    }

    if (hasEnhancerFile && (options.force || !enhancerAlive)) {
      try {
        await wc.executeJavaScript(enhancerSrc);
      } catch (e) {
        console.warn('[Context Meter] enhancer overlay inject warning:', e?.message || e);
      }
    }

    if (hasCodexFile && (options.force || !codexAlive)) {
      try {
        await wc.executeJavaScript(codexSrc);
      } catch (e) {
        console.warn('[Context Meter] codex overlay inject warning:', e?.message || e);
      }
    }

    return true;
  } catch (error) {
    const attempt = Number(options.attempt || 0);
    const delays = [350, 1000, 2500];
    if (attempt < delays.length && win && !win.isDestroyed?.()) {
      const prevTimer = injectionTimers.get(win);
      if (prevTimer) clearTimeout(prevTimer);
      const t = setTimeout(() => {
        injectionTimers.delete(win);
        void ensureMeterInjected(win, { ...options, attempt: attempt + 1 });
      }, delays[attempt]);
      injectionTimers.set(win, t);
    } else {
      console.warn('[Context Meter]', error?.message || String(error));
    }
    return false;
  }
}

exports.ensureMeterInjected = ensureMeterInjected;

exports.installContextMeter = function (win) {
  registerIpcOnce();
  if (!win || win.isDestroyed?.()) return;

  if (!boundWindows.has(win)) {
    boundWindows.add(win);
    if (process.platform === 'win32') {
      try {
        if (typeof win.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false);
        win.autoHideMenuBar = true;
      } catch {}
    }
    const onWinVisibleOrActive = () => {
      if (process.platform === 'win32') {
        try {
          if (typeof win.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false);
          win.autoHideMenuBar = true;
        } catch {}
      }
      void ensureMeterInjected(win, { force: false });
    };
    win.on?.('show', onWinVisibleOrActive);
    win.on?.('restore', onWinVisibleOrActive);
    win.on?.('focus', onWinVisibleOrActive);

    // 托盘常驻与会话保持：点击窗口右上角关闭时，若满足后台常驻与主会话条件，隐藏至托盘而非销毁，避免重新打开丢失会话
    try {
      win.on?.('close', (event) => {
        if (shouldInterceptWindowClose(win)) {
          if (typeof event?.preventDefault === 'function') {
            event.preventDefault();
            if (typeof win.hide === 'function') win.hide();
          }
        }
      });
    } catch {}
  }

  const bindToWc = (wc) => {
    if (!wc || boundWebContents.has(wc)) return;
    boundWebContents.add(wc);
    wc.on('did-finish-load', () => {
      void ensureMeterInjected(win, { force: true });
    });
    wc.on('dom-ready', () => {
      void ensureMeterInjected(win, { force: false });
    });
    wc.on('did-navigate', () => {
      void ensureMeterInjected(win, { force: false });
    });
    wc.on('did-navigate-in-page', () => {
      void ensureMeterInjected(win, { force: false });
    });
    wc.on('zoom-changed', () => syncWindowOverlayHeight(win));
  };

  const initialWc = getWindowWebContents(win);
  if (initialWc) {
    bindToWc(initialWc);
  } else {
    // 若为 BaseWindow 且尚未挂载 WebContentsView，开启轻量安全探测轮询，并在 WeakMap 中记录定时器
    const prevProbe = wcProbeTimers.get(win);
    if (prevProbe) clearInterval(prevProbe);

    let retries = 0;
    const probeInterval = setInterval(() => {
      retries++;
      const candidateWc = getWindowWebContents(win);
      if (candidateWc) {
        clearInterval(probeInterval);
        wcProbeTimers.delete(win);
        bindToWc(candidateWc);
        void ensureMeterInjected(win, { force: false });
      } else if (retries >= 10 || !win || win.isDestroyed?.()) {
        clearInterval(probeInterval);
        wcProbeTimers.delete(win);
      }
    }, 150);
    wcProbeTimers.set(win, probeInterval);

    win.once?.('closed', () => {
      const activeTimer = wcProbeTimers.get(win);
      if (activeTimer) {
        clearInterval(activeTimer);
        wcProbeTimers.delete(win);
      }
    });
  }
};

try {
  if (app && typeof app.on === 'function') {
    app.on('before-quit', () => {
      isAppQuitting = true;
    });
    app.on('will-quit', () => {
      isAppQuitting = true;
    });
    const handleCreated = (_event, win) => {
      try {
        exports.installContextMeter(win);
        void ensureMeterInjected(win, { force: false });
      } catch {}
    };
    app.on('browser-window-created', handleCreated);
    app.on('base-window-created', handleCreated);
    app.on('activate', () => {
      try {
        const utils = require('./utils');
        const wins = typeof utils.getHubWindows === 'function' ? utils.getHubWindows() : [];
        for (const w of wins) {
          exports.installContextMeter(w);
          void ensureMeterInjected(w, { force: true });
        }
      } catch {}
    });
    app.on('second-instance', () => {
      try {
        const utils = require('./utils');
        setTimeout(() => {
          try {
            const wins = typeof utils.getHubWindows === 'function' ? utils.getHubWindows() : [];
            for (const w of wins) {
              exports.installContextMeter(w);
              void ensureMeterInjected(w, { force: true });
            }
          } catch {}
        }, 120);
      } catch {}
    });
  }
} catch {}

function isHostRunInBackgroundEnabled() {
  try {
    if (process.platform === 'darwin') return true;
    let storagePath = null;
    if (app && typeof app.getPath === 'function') {
      try {
        storagePath = path.join(app.getPath('userData'), 'app_storage.json');
      } catch {}
    }
    if (!storagePath) {
      const home = typeof os.homedir === 'function' ? os.homedir() : '';
      const appData = process.env.APPDATA || (process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : path.join(home, '.config'));
      storagePath = path.join(appData, 'Antigravity', 'app_storage.json');
    }
    if (!fs.existsSync(storagePath)) return false;
    const content = fs.readFileSync(storagePath, 'utf8');
    const data = JSON.parse(content);
    return data?.runInBackground === 'true' || data?.runInBackground === true;
  } catch {
    return false;
  }
}

function shouldInterceptWindowClose(win, options = {}) {
  try {
    if (isAppQuitting) return false;

    // 1. 尊重宿主后台常驻设置：若明确未开启或读取设置失败，不得拦截
    const isBgEnabled = typeof options.isBackgroundEnabled === 'function'
      ? options.isBackgroundEnabled()
      : isHostRunInBackgroundEnabled();
    if (!isBgEnabled) return false;

    // 2. 获取宿主主会话窗口列表
    let wins = null;
    if (typeof options.getHubWindows === 'function') {
      wins = options.getHubWindows();
    } else {
      try {
        const utils = require('./utils');
        if (typeof utils.getHubWindows === 'function') wins = utils.getHubWindows();
      } catch {}
    }

    // 获取窗口列表失败或当前窗口非已确认的主会话窗口（避免影响辅助/弹窗窗口），安全放行
    if (!Array.isArray(wins) || !wins.includes(win)) return false;

    // 3. 多窗口关闭路径：若仍有其他可见主窗口在运行，说明当前是关闭辅助多开窗口，放行正常关闭；
    // 仅当当前是最后一个可见主会话窗口时拦截销毁，转为隐藏至托盘
    const remainingVisible = wins.filter(
      w => w !== win && !w.isDestroyed?.() && (typeof w.isVisible === 'function' ? w.isVisible() : true)
    );
    return remainingVisible.length === 0;
  } catch {
    // 发生任何异常时绝不默认隐藏，确保安全放行
    return false;
  }
}

exports.handleModulesStatus = handleModulesStatus;
exports.handleToggleModule = handleToggleModule;
exports.setAppQuitting = setAppQuitting;
exports.getAppQuitting = getAppQuitting;
exports.shouldInterceptWindowClose = shouldInterceptWindowClose;
exports.isHostRunInBackgroundEnabled = isHostRunInBackgroundEnabled;
exports.getWindowWebContents = getWindowWebContents;
