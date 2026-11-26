#!/usr/bin/env node
'use strict';
process.noAsar = true;

/**
 * Antigravity Context Meter CLI
 * Cross-platform installer, live CDP hot-injector, and lifecycle manager
 * Format aligned with antigravity-chinese for one-command human & AI Agent execution.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { loadAsarEngine, getStateDir, getDevToolsPort, resolveActiveCdpTarget, inspectAntigravityHostProcess } = require('./asar-engine');
const { install, findAsarPath, tryHotInject } = require('./install');
const { restore } = require('./restore');
const { resolvePython } = require('./meter-collector');
const { analyzeBinary, analyzeBinaryAsync, applyUnlock, restoreUnlock, AUTHOR_INFO } = require('./meter-context-unlock');

const asar = loadAsarEngine();
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function queryLiveWindow() {
  try {
    const { port, targets } = await resolveActiveCdpTarget({ timeoutMs: 2500 });
    if (!port) {
      const hostProc = inspectAntigravityHostProcess();
      return {
        running: false,
        hostProcessRunning: Boolean(hostProc.running),
        hostPid: hostProc.pid || null,
        cdpDisabled: Boolean(hostProc.running && !hostProc.hasDebugSwitch),
        elapsedSec: hostProc.elapsedSec ?? null
      };
    }
    const target = targets[0];
    if (!target) return { running: true, cdpPort: port, pageFound: false };
    const origin = new URL(target.url).origin;

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 4000);
      ws.addEventListener('message', ev => {
        const d = JSON.parse(ev.data);
        if (d.id === 1) {
          clearTimeout(timer);
          resolve(d.result?.result?.value || null);
        }
      });
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const s = window.__AGContextMeter?.snapshot();
            const root = document.getElementById('ag-context-meter')?.shadowRoot;
            return {
              active: Boolean(window.__AGContextMeter),
              hansActive: Boolean(window.__antigravityZhPatchInstalled === true && window.__observedDocument === document),
              enhancerActive: Boolean(window.__AGEnhancer && typeof window.__AGEnhancer.isAlive === 'function' && window.__AGEnhancer.isAlive()),
              codexActive: Boolean(window.__AGCodexOverlay && typeof window.__AGCodexOverlay.isAlive === 'function' && window.__AGCodexOverlay.isAlive()),
              sidebarQuotaActive: Boolean(document.getElementById('ag-quota')),
              quotaBadgeText: root?.getElementById('ag-quota-text')?.textContent?.trim() || null,
              quickBarActive: Boolean(document.getElementById('ag-quick-capsule-bar')),
              pulseActive: Boolean(window.__AGY_CTX_CAPSULE_ACTIVE__ === true && document.querySelector('[data-agy-context-capsule="1"]')),
              pulseText: document.querySelector('[data-agy-context-capsule="1"]')?.textContent?.trim() || null,
              version: window.__AGContextMeter?.version || null,
              hasIpcBridge: Boolean(window.contextMeterAPI?.scan && window.contextMeterAPI?.saveSettings && window.contextMeterAPI?.launchCli && window.contextMeterAPI?.getContextUnlockStatus),
              hasLiveBridge: Boolean(window.__AGContextMeterLive?.port),
              badgeText: root?.getElementById('amount')?.textContent || null,
              route: s?.route || null,
              latest: s?.latest || null
            };
          })()`,
          returnByValue: true
        }
      }));
    });
    ws.close();
    return { running: true, cdpPort: port, pageFound: true, origin, ...status };
  } catch (e) {
    return { running: false, error: e.message };
  }
}

async function ensureLiveBridgeIfNeeded(options = {}) {
  const forceFreshBridge = options.forceFreshBridge === true;
  const noRemote = options.noRemote === true || process.env.AG_DISABLE_MOBILE_REMOTE === '1';
  const live = await queryLiveWindow();
  if (!live.running || !live.pageFound) return;
  if (live.hasIpcBridge && !forceFreshBridge) return;
  const stateDir = getStateDir();
  const statePath = path.join(stateDir, '.live-session.json');
  const legacyPath = path.join(__dirname, '.live-session.json');
  const liveSessionPath = fs.existsSync(statePath) ? statePath : legacyPath;

  const backendModules = [
    'live-host.js',
    'mobile-remote.js',
    'macos-dock-badge.js',
    'scripts/macos-dock-overlay.swift',
    'local-api.js',
    'meter-collector.js',
    'meter-cli-launcher.js',
    'meter-terminals.js',
    'meter-core.js',
    'meter-proxy.js',
    'modules-config.js'
  ];
  let latestBackendMtime = 0;
  for (const modName of backendModules) {
    try {
      const mtimeMs = fs.statSync(path.join(__dirname, modName)).mtimeMs || 0;
      if (mtimeMs > latestBackendMtime) latestBackendMtime = mtimeMs;
    } catch {}
  }

  let alive = false;
  let existingInfo = null;
  if (fs.existsSync(liveSessionPath)) {
    try {
      const info = JSON.parse(fs.readFileSync(liveSessionPath, 'utf8'));
      existingInfo = info;
      process.kill(info.pid, 0);
      const startedAt = Number(info.startedAt || 0);
      const originMatches = !live.origin || info.origin === live.origin;
      const remoteMatches = Boolean(info.remoteDisabled) === noRemote;
      const isUpToDate = startedAt >= latestBackendMtime;
      if (originMatches && remoteMatches && (info.embedded === true || (isUpToDate && !forceFreshBridge))) {
        alive = true;
      }
    } catch {}
  }
  if (!alive) {
    if (existingInfo?.pid && existingInfo.embedded !== true && existingInfo.pid !== process.pid) {
      try { process.kill(existingInfo.pid); } catch {}
      const exitDeadline = Date.now() + 600;
      while (Date.now() < exitDeadline) {
        try {
          process.kill(existingInfo.pid, 0);
          await new Promise(r => setTimeout(r, 50));
        } catch {
          break;
        }
      }
    }
    try { if (fs.existsSync(statePath)) fs.unlinkSync(statePath); } catch {}
    try { if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath); } catch {}

    const childEnv = { ...process.env };
    if (noRemote) childEnv.AG_DISABLE_MOBILE_REMOTE = '1';
    else delete childEnv.AG_DISABLE_MOBILE_REMOTE;
    const child = spawn(process.execPath, [path.join(__dirname, 'live-host.js')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv
    });
    child.unref();

    const maxWaitMs = 5000;
    const intervalMs = 150;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      const checkPath = fs.existsSync(statePath) ? statePath : (fs.existsSync(legacyPath) ? legacyPath : null);
      if (checkPath) {
        try {
          const info = JSON.parse(fs.readFileSync(checkPath, 'utf8'));
          if (info && info.pid === child.pid && (!live.origin || info.origin === live.origin)) {
            process.kill(info.pid, 0);
            alive = true;
            break;
          }
        } catch {}
      }
    }
  }
}

async function cmdStatus(customPath) {
  let asarPath = null;
  let version = null;
  let asarPatched = false;
  try {
    asarPath = findAsarPath(customPath);
    version = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8')).version;
    const utilsSource = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
    asarPatched = utilsSource.includes('installContextMeter(win)');
  } catch {}

  const live = await queryLiveWindow();
  const py = resolvePython();
  const report = {
    asarPath,
    antigravityVersion: version,
    asarPatched,
    liveWindow: live,
    pythonAttachmentScanner: py || 'unavailable (optional)'
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function cmdCheck(customPath) {
  console.log('🔍 [Antigravity 對話上下文檢視器] 正在執行環境預檢...');
  console.log(`  - Node.js 執行環境: ${process.version} (${process.execPath})`);
  try {
    const asarPath = findAsarPath(customPath);
    const version = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8')).version;
    console.log(`  - Antigravity 路徑: ${asarPath} (v${version})`);
  } catch (e) {
    console.error(`  ❌ Antigravity 路徑探測失敗: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  const py = resolvePython();
  console.log(`  - Python 附件深度解析器: ${py || '未偵測到（基礎上下文統計不受影響）'}`);
  const live = await queryLiveWindow();
  const cdpDesc = live.running
    ? `已連線 (連接埠 ${live.cdpPort})`
    : (live.cdpDisabled
      ? '用戶端已執行 (v2.33.0+ 預設未開啟遠端偵錯連接埠)，請退出後重開一次或在外部終端機執行 ag-context-meter restart'
      : '用戶端未執行或未開啟除錯連接埠');
  console.log(`  - 執行中視窗 CDP 狀態: ${cdpDesc}`);
  console.log('✅ 通過環境預檢！');
}

async function main() {
  const args = process.argv.slice(2);
  const rawPositional = args.find(a => !a.startsWith('-'));
  const wantsHelp = args.includes('--help') || args.includes('-h');
  const cmd = (wantsHelp && !rawPositional) ? 'help' : (rawPositional || 'live').toLowerCase();
  const pathIdx = args.indexOf('--path');
  const customPath = pathIdx >= 0 ? args[pathIdx + 1] : null;
  const backupIdx = args.indexOf('--backup');
  const customBackup = backupIdx >= 0 ? args[backupIdx + 1] : null;
  const isForce = args.includes('--force');
  const noRemote = args.includes('--no-remote') || process.env.AG_DISABLE_MOBILE_REMOTE === '1';

  const isTestEnv = process.env.AG_METER_TEST_MODE === '1' || process.env.NODE_ENV === 'test';
  const allowAsarPatch = isTestEnv || args.includes('--allow-asar-patch');
  const ASAR_PATCH_CMDS = new Set([
    'install', 'restore', 'uninstall',
    'unlock', 'unlock-restore',
    'chinese:enable', 'chinese:disable',
    'proxy:enable', 'proxy:disable', 'proxy:set'
  ]);
  if (ASAR_PATCH_CMDS.has(cmd) && !allowAsarPatch) {
    console.error(`❌ 已停用 '${cmd}'：本套件預設採用 100% 零改包設計（絕不修改 app.asar 或用戶端二進位），請使用 'node cli.js live' 或 'ag-context-meter live'。`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'install') {
    const meterVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    console.log(`🚀 [Antigravity 對話上下文檢視器 v${meterVersion}] 正在安裝上下文可視化元件...`);
    await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
    const manifest = await install({ path: customPath, backup: customBackup, force: isForce });
    await tryHotInject();
    console.log(`✅ 外掛 v${manifest.meterVersion} 安裝完成 (Antigravity 宿主 v${manifest.version})`);
    console.log(`✅ ASAR 持久注入完成: ${manifest.installed} (驗證 ${manifest.originalFilesVerified} 個原始檔案)`);
    const { loadModulesConfig, inspectDiskModules } = require('./modules-config');
    const cfg = loadModulesConfig();
    const disk = inspectDiskModules(manifest.installed);
    console.log('📦 模組狀態分層報告:');
    console.log('   - ⚡ 上下文與 Token 監控:');
    console.log(`     * 設定狀態: [設定: ${cfg.modules.meter.enabled ? '已開啟' : '已關閉'}]`);
    console.log(`     * 磁碟注入: ${disk.meter ? '✅ 已注入' : '⚪ 未注入'}`);
    console.log(`     * 執行中載入: ${manifest.liveInjected ? '✅ 已即時掛載生效（無需重新啟動）' : '⏳ 待下次啟動用戶端時生效'}`);

    console.log('   - 🇨🇳 用戶端介面中文化 (桌面用戶端):');
    console.log(`     * 設定狀態: [設定: ${cfg.modules.chinese.enabled ? '已開啟' : '已關閉'}]`);
    console.log(`     * 磁碟元件: ${disk.chineseReady ? '✅ 已注入（支援設定限制與離線切換）' : (disk.chinese ? '⚠️ 磁碟注入不完整' : '⚪ 未注入')}`);
    console.log(`     * 生效說明: ${cfg.modules.chinese.enabled ? '⏳ 重新啟動 Antigravity 用戶端後載入中文' : '⚪ 預設保持官方原生英文，可在用戶端面板中隨時開啟並重新啟動生效'}`);

    console.log('   - 🌐 免 TUN 網路直連 (本機代理):');
    console.log(`     * 設定狀態: [設定: ${cfg.modules.proxy.enabled ? '已開啟' : '已關閉'}] (代理: ${cfg.modules.proxy.proxyUrl || '未設定'})`);
    console.log(`     * 磁碟元件: ${disk.proxyReady ? '✅ 已注入（支援 Session 代理與環境變數攔截）' : (disk.proxy ? '⚠️ 磁碟注入不完整' : '⚪ 未注入')}`);
    console.log(`     * 生效說明: ${cfg.modules.proxy.enabled ? '🔍 需透過 node cli.js proxy:test 測試連通性' : '⚪ 跟隨系統預設網路棧，可在用戶端面板中隨時設定並開啟'}`);
    console.log(`     * 模型請求驗證: 待透過真實線上工作階段驗證 (分層驗證，未傳送請求前不宣稱生效)`);
    console.log(`✅ 執行中視窗熱掛載狀態: ${manifest.liveInjected ? '已即時生效（無需重新啟動）' : '將在下次啟動 Antigravity 時自動生效'}`);
  } else if (cmd === 'live') {
    await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
    const ok = await tryHotInject();
    if (!ok) {
      const hostProc = inspectAntigravityHostProcess();
      if (hostProc.running && !hostProc.hasDebugSwitch) {
        throw new Error('偵測到 Antigravity 已執行但未開啟遠端偵錯連接埠（v2.33.0+ 預設關閉）；請在外部終端機執行 ag-context-meter restart，或按 ⌘Q 退出後重新點開 Antigravity。');
      }
      throw new Error('未偵測到執行中的 Antigravity 主視窗，請確認啟動時已開啟遠端偵錯連接埠。');
    }
    console.log(`✅ 已透過 CDP 免改包熱注入目前執行的 Antigravity 視窗！${noRemote ? '（已按請求停用手機遠端連接埠）' : ''}`);
  } else if (cmd === 'restore' || cmd === 'uninstall') {
    const res = await restore({ path: customPath, force: isForce });
    console.log(`✅ 已完成解除安裝還原: ${res.restored}`);
    console.log('📦 模組清理與執行環境狀態說明:');
    console.log(`   - 磁碟處理方式: ${res.inPlaceCleaned ? '原位手術刀精準解構（保留宿主第三方修改）' : '官方原版備份整包還原'}`);
    console.log('   - 磁碟清理狀態:');
    console.log('     * ⚡ 上下文與 Token 監控: 磁碟程式碼已移除');
    console.log('     * 🇨🇳 用戶端介面中文化: 磁碟注入已移除');
    console.log('     * 🌐 免 TUN 網路直連: 磁碟代理攔截已移除');
    console.log('   - 執行中殘留與重新啟動說明:');
    console.log(`     * 上下文監控: ${res.hotDisposed ? '已透過 CDP 即時銷毀執行實例' : '執行實例需重新啟動用戶端徹底清理'}`);
    console.log('     * 介面中文化: 執行中已算繪 DOM 受用戶端頁面記憶體快取影響，需完全重新啟動用戶端徹底恢復純淨英文');
    console.log('     * 代理環境: 執行中處理程序已載入的 process.env 環境變數與 Electron session 代理無法即時熱復原，必須完全重新啟動用戶端以徹底退出代理環境');
  } else if (cmd === 'unlock-status') {
    console.log('🔍 正在偵測 Antigravity 後端上下文加長狀態...');
    const st = await analyzeBinaryAsync(customPath);
    console.log(`- 目標檔案: ${st.targetPath || '未偵測到'}`);
    console.log(`- 目標架構: ${st.arch || '未知'} (${st.format || '未知'}, ${st.mode || '未知'})`);
    console.log(`- 解鎖狀態: [${st.statusText || st.status}] ${st.details || st.reason || ''}`);
    if (st.backupInfo) {
      console.log(`- 備份檔案: ${st.backupInfo.backupPath}`);
    }
    console.log(`- ${st.author?.credit || AUTHOR_INFO.credit} (${st.author?.url || AUTHOR_INFO.url})`);
  } else if (cmd === 'unlock') {
    console.log('⚡ 正在執行 Antigravity 後端上下文加長解鎖...');
    console.log(`ℹ ${AUTHOR_INFO.credit} (${AUTHOR_INFO.url})`);
    console.log(`⚠️  ${AUTHOR_INFO.disclaimer}`);
    const res = applyUnlock({ targetPath: customPath });
    if (!res.ok) {
      throw new Error(res.error);
    }
    console.log(`✅ ${res.message || '解鎖成功！'}`);
    if (res.backupPath) console.log(`📁 原版備份已安全儲存至: ${res.backupPath}`);
  } else if (cmd === 'unlock-restore') {
    console.log('🔄 正在恢復 Antigravity 官方原版後端二進位...');
    const res = restoreUnlock({ targetPath: customPath });
    if (!res.ok) {
      throw new Error(res.error);
    }
    console.log(`✅ ${res.message || '恢復完成！'}`);
  } else if (cmd === 'modules') {
    const { loadModulesConfig, detectAndMigrateLegacyConfigs } = require('./modules-config');
    const cfg = loadModulesConfig();
    const asarPath = findAsarPath(customPath);
    let asarUtils = '';
    let asarPreload = '';
    try {
      asarUtils = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
      asarPreload = asar.extractFile(asarPath, 'dist/preload.js').toString('utf8');
    } catch {}

    console.log('📦 [Antigravity 統一模組狀態總覽]');
    console.log('1. 上下文與 Token 監控 (ContextMeter):');
    console.log(`   - 設定狀態: ${cfg.modules.meter.enabled ? '🟢 已啟用' : '⚪ 已停用'}`);
    console.log(`   - 磁碟注入: ${asarUtils.includes('installContextMeter') ? '✅ 已注入' : '⚪ 未注入'}`);

    console.log('2. 用戶端介面中文化 (Chinese Desktop):');
    console.log(`   - 設定狀態: ${cfg.modules.chinese.enabled ? '🟢 已啟用' : '⚪ 已停用'}`);
    console.log(`   - 磁碟注入: ${asarPreload.includes('Antigravity Chinese Localization') ? '✅ 已注入' : '⚪ 未注入'}`);
    if (cfg.modules.chinese.migratedFrom) {
      console.log(`   - 遷移來源: ${cfg.modules.chinese.migratedFrom}`);
    }

    console.log('3. 免 TUN 網路直連 (ProxyNoTun):');
    console.log(`   - 設定狀態: ${cfg.modules.proxy.enabled ? '🟢 已啟用' : '⚪ 已停用'}`);
    console.log(`   - 代理位址: ${cfg.modules.proxy.proxyUrl || '未設定'}`);
    console.log(`   - 繞過清單: ${cfg.modules.proxy.bypassList || '預設'}`);
    console.log(`   - 磁碟注入: ${asarUtils.includes('Antigravity Proxy NoTun') ? '✅ 已注入' : '⚪ 未注入'}`);
    if (cfg.modules.proxy.migratedFrom) {
      console.log(`   - 遷移來源: ${cfg.modules.proxy.migratedFrom}`);
    }
  } else if (cmd === 'chinese:enable' || cmd === 'chinese:disable') {
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    const enable = cmd === 'chinese:enable';
    cfg.modules.chinese.enabled = enable;
    cfg.modules.chinese.language = enable ? 'zh-CN' : 'en';
    saveModulesConfig(cfg);
    await install({ path: customPath, modules: { chinese: { enabled: enable } } });
    console.log(`✅ 用戶端介面中文化模組已${enable ? '開啟' : '關閉'}並完成 ASAR 注入同步！`);
  } else if (cmd === 'proxy:enable' || cmd === 'proxy:disable') {
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    const enable = cmd === 'proxy:enable';
    cfg.modules.proxy.enabled = enable;
    saveModulesConfig(cfg);
    await install({ path: customPath, modules: { proxy: { enabled: enable } } });
    console.log(`✅ 免 TUN 網路直連模組已${enable ? '開啟' : '關閉'}並完成 ASAR 注入同步！`);
  } else if (cmd === 'proxy:set') {
    const newUrl = args[1] && !args[1].startsWith('-') ? args[1] : args[2];
    if (!newUrl) throw new Error('請提供有效的代理位址，例如: node cli.js proxy:set http://127.0.0.1:7890');
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    cfg.modules.proxy.proxyUrl = newUrl;
    saveModulesConfig(cfg);
    if (cfg.modules.proxy.enabled) {
      await install({ path: customPath, modules: { proxy: { proxyUrl: newUrl } } });
    }
    console.log(`✅ 代理位址已更新為: ${newUrl}`);
  } else if (cmd === 'proxy:test') {
    const { loadModulesConfig, testProxyHealth } = require('./modules-config');
    const cfg = loadModulesConfig();
    const urlToTest = args[1] && !args[1].startsWith('-') ? args[1] : cfg.modules.proxy.proxyUrl;
    console.log(`🔍 正在分層偵測代理位址連通性: ${urlToTest}...`);
    const r = await testProxyHealth(urlToTest);
    console.log(`  - 1. 設定格式驗證: ${r.configValid ? '✅ 合法' : '❌ 錯誤'}`);
    console.log(`  - 2. 本機代理連接埠: ${r.proxyReachable ? '✅ 可連線' : '❌ 無法連線'}`);
    console.log(`  - 3. 實際網路連通: ${r.internetReachable ? '✅ 可存取公開網路' : '⚠️ 無法存取公開網路 (可能節點無境外連線)'}`);
    console.log(`  - 4. 真實模型請求: 待透過真實線上工作階段驗證 (分層驗證)`);
    if (r.error) console.log(`  ⚠️ 診斷提示: ${r.error}`);
  } else if (cmd === 'status') {
    await cmdStatus(customPath);
  } else if (cmd === 'check') {
    await cmdCheck(customPath);
  } else if (cmd === 'remote') {
    const tIdx = args.indexOf('--tunnel');
    const tunnelAction = (tIdx >= 0 && args[tIdx + 1]) ? String(args[tIdx + 1]).trim().toLowerCase() : '';
    require('./mobile-remote').printRemoteCli({
      resetToken: args.includes('--reset-token'),
      jsonMode: args.includes('--json'),
      tunnelAction
    });
  } else if (cmd === 'update') {
    const { execFileSync } = require('child_process');
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
      throw new Error('目前安裝目錄非 Git 儲存庫，請透過 git clone 安裝後再執行 update');
    }
    const runGit = (gitArgs, timeout = 10000) => execFileSync('git', gitArgs, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const dirty = runGit(['status', '--porcelain', '--untracked-files=no'], 3000);
    if (dirty) {
      throw new Error('本機有未提交改動，已取消自動更新以避免覆蓋');
    }
    let remote = 'origin';
    let branch = 'main';
    try {
      const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 2000);
      if (upstream && upstream.includes('/')) {
        const slash = upstream.indexOf('/');
        remote = upstream.slice(0, slash);
        branch = upstream.slice(slash + 1);
      }
    } catch {
      try {
        const cur = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], 2000);
        if (cur && cur !== 'HEAD') branch = cur;
      } catch {}
    }
    const beforeSha = runGit(['rev-parse', '--short', 'HEAD'], 2500);
    console.log(`🔄 正在從 ${remote}/${branch} 檢查並拉取最新程式碼（目前: ${beforeSha}）...`);
    runGit(['fetch', '--quiet', remote, branch], 10000);
    const pullOut = runGit(['pull', '--ff-only', remote, branch], 15000);
    const afterSha = runGit(['rev-parse', '--short', 'HEAD'], 2500);
    const pkgVer = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    if (beforeSha === afterSha && /already up[- ]to[- ]date/i.test(pullOut)) {
      console.log(`✅ 目前已是最新版本：v${pkgVer} (${afterSha})`);
    } else {
      console.log(`✅ 程式碼已更新：${beforeSha} -> ${afterSha} (v${pkgVer})`);
    }
    const { resolveActiveCdpTarget } = require('./asar-engine');
    const cdpInfo = await resolveActiveCdpTarget({ timeoutMs: 2000 }).catch(() => ({ port: null, targets: [] }));
    if (cdpInfo && cdpInfo.targets && cdpInfo.targets.length > 0) {
      await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
      const ok = await tryHotInject();
      if (ok) {
        console.log(`✅ 已更新目前開啟的 Antigravity 視窗！${noRemote ? '（已停用手機遠端連接埠）' : ''}`);
      }
    } else {
      console.log('ℹ️ 目前未偵測到執行中的 Antigravity 視窗，下次啟動時將自動載入最新版本。');
    }
  } else if (cmd === 'upstreams') {
    const cmdIdx = process.argv.indexOf('upstreams');
    const passthrough = cmdIdx >= 0 ? process.argv.slice(cmdIdx + 1) : [];
    const res = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'check-upstreams.js'), ...passthrough], {
      stdio: 'inherit'
    });
    if (typeof res.status === 'number' && res.status !== 0) {
      process.exitCode = res.status;
    }
  } else {
    const isHelp = cmd === 'help';
    if (!isHelp) {
      console.error(`❌ 未知命令: ${cmd}`);
      process.exitCode = 1;
    }
    console.log(`用法 (100% 零改包模式):
  node cli.js live [--no-remote]            透過 CDP 熱掛載至目前執行中的視窗（預設命令；加 --no-remote 關閉手機遠端監聽）
  node cli.js update [--no-remote]          從 GitHub 拉取最新程式碼並更新目前開啟的視窗
  node cli.js status                        顯示執行狀態與官方安裝包簽名完整性
  node cli.js remote [--tunnel on|off] [--reset-token] [--json]  顯示手機「四通道」融合配對連結與終端機 QR Code
  node cli.js check                         檢查執行環境
  node cli.js upstreams [--json]            檢查參考上游專案更新並與目前基線比對

說明:
  已預設停用所有修改 app.asar 與二進位補丁命令；可透過環境變數 AG_DISABLE_MOBILE_REMOTE=1 全域關閉手機遠端連接埠。`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ 執行失敗:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { cmdStatus, cmdCheck };
