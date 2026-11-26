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
  console.log('🔍 [Antigravity 对话上下文检视器] 正在执行环境预检...');
  console.log(`  - Node.js 运行时: ${process.version} (${process.execPath})`);
  try {
    const asarPath = findAsarPath(customPath);
    const version = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8')).version;
    console.log(`  - Antigravity 路径: ${asarPath} (v${version})`);
  } catch (e) {
    console.error(`  ❌ Antigravity 路径探测失败: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  const py = resolvePython();
  console.log(`  - Python 附件深度解析器: ${py || '未检测到（基础上下文统计不受影响）'}`);
  const live = await queryLiveWindow();
  const cdpDesc = live.running
    ? `已连接 (端口 ${live.cdpPort})`
    : (live.cdpDisabled
      ? '客户端已运行 (v2.33.0+ 默认未开启远程调试端口)，请退出后重开一次或在外部终端运行 ag-context-meter restart'
      : '客户端未运行或未开启调试端口');
  console.log(`  - 运行中窗口 CDP 状态: ${cdpDesc}`);
  console.log('✅ 环境预检通过！');
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
    console.error(`❌ 已禁用 '${cmd}'：本套件默认采用 100% 零改包设计（绝不修改 app.asar 或客户端二进制），请使用 'node cli.js live' 或 'ag-context-meter live'。`);
    process.exitCode = 1;
    return;
  }

  if (cmd === 'install') {
    const meterVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    console.log(`🚀 [Antigravity 对话上下文检视器 v${meterVersion}] 正在安装上下文可视化组件...`);
    await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
    const manifest = await install({ path: customPath, backup: customBackup, force: isForce });
    await tryHotInject();
    console.log(`✅ 插件 v${manifest.meterVersion} 安装完成 (Antigravity 宿主 v${manifest.version})`);
    console.log(`✅ ASAR 持久化注入完成: ${manifest.installed} (校验 ${manifest.originalFilesVerified} 个原文件)`);
    const { loadModulesConfig, inspectDiskModules } = require('./modules-config');
    const cfg = loadModulesConfig();
    const disk = inspectDiskModules(manifest.installed);
    console.log('📦 模块状态分层报告:');
    console.log('   - ⚡ 上下文与 Token 监控:');
    console.log(`     * 配置状态: [配置: ${cfg.modules.meter.enabled ? '已开启' : '已关闭'}]`);
    console.log(`     * 磁盘注入: ${disk.meter ? '✅ 已注入' : '⚪ 未注入'}`);
    console.log(`     * 运行中加载: ${manifest.liveInjected ? '✅ 已即时挂载生效（无需重启）' : '⏳ 待下次启动客户端时生效'}`);

    console.log('   - 🇨🇳 客户端界面汉化 (桌面客户端):');
    console.log(`     * 配置状态: [配置: ${cfg.modules.chinese.enabled ? '已开启' : '已关闭'}]`);
    console.log(`     * 磁盘组件: ${disk.chineseReady ? '✅ 已注入（支持配置门禁与离线切换）' : (disk.chinese ? '⚠️ 磁盘注入不完整' : '⚪ 未注入')}`);
    console.log(`     * 生效说明: ${cfg.modules.chinese.enabled ? '⏳ 重启 Antigravity 客户端后加载中文' : '⚪ 默认保持官方原生英文，可在客户端面板中随时开启并重启生效'}`);

    console.log('   - 🌐 免 TUN 网络直连 (本地代理):');
    console.log(`     * 配置状态: [配置: ${cfg.modules.proxy.enabled ? '已开启' : '已关闭'}] (代理: ${cfg.modules.proxy.proxyUrl || '未配置'})`);
    console.log(`     * 磁盘组件: ${disk.proxyReady ? '✅ 已注入（支持 Session 代理与环境变量拦截）' : (disk.proxy ? '⚠️ 磁盘注入不完整' : '⚪ 未注入')}`);
    console.log(`     * 生效说明: ${cfg.modules.proxy.enabled ? '🔍 需通过 node cli.js proxy:test 测试连通性' : '⚪ 跟随系统默认网络栈，可在客户端面板中随时配置并开启'}`);
    console.log(`     * 模型请求验证: 待通过真实在线会话验证 (分层标定，未发送请求前不宣称生效)`);
    console.log(`✅ 运行中窗口热挂载状态: ${manifest.liveInjected ? '已即时生效（无需重启）' : '将在下次启动 Antigravity 时自动生效'}`);
  } else if (cmd === 'live') {
    await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
    const ok = await tryHotInject();
    if (!ok) {
      const hostProc = inspectAntigravityHostProcess();
      if (hostProc.running && !hostProc.hasDebugSwitch) {
        throw new Error('检测到 Antigravity 已运行但未开启远程调试端口（v2.33.0+ 默认关闭）；请在外部终端执行 ag-context-meter restart，或按 ⌘Q 退出后重新点开 Antigravity。');
      }
      throw new Error('未检测到运行中的 Antigravity 主窗口，请确认 Antigravity 已开启并带远程调试端口启动。');
    }
    console.log(`✅ 已通过 CDP 免改包热注入当前运行的 Antigravity 窗口！${noRemote ? '（已按请求禁用手机远程端口）' : ''}`);
  } else if (cmd === 'restore' || cmd === 'uninstall') {
    const res = await restore({ path: customPath, force: isForce });
    console.log(`✅ 已完成卸载还原: ${res.restored}`);
    console.log('📦 模块清理与运行时状态说明:');
    console.log(`   - 磁盘处理方式: ${res.inPlaceCleaned ? '原位手术刀精准解构（保留宿主第三方修改）' : '官方原版备份整包还原'}`);
    console.log('   - 磁盘清理状态:');
    console.log('     * ⚡ 上下文与 Token 监控: 磁盘代码已移除');
    console.log('     * 🇨🇳 客户端界面汉化: 磁盘注入已移除');
    console.log('     * 🌐 免 TUN 网络直连: 磁盘代理拦截已移除');
    console.log('   - 运行中残留与重启说明:');
    console.log(`     * 上下文监控: ${res.hotDisposed ? '已通过 CDP 即时销毁运行实例' : '运行实例需重启客户端彻底清理'}`);
    console.log('     * 界面汉化: 运行中已渲染 DOM 受客户端页面内存缓存影响，需完全重启客户端彻底恢复纯净英文');
    console.log('     * 代理环境: 运行中进程已加载的 process.env 环境变量与 Electron session 代理无法即时热撤销，必须完全重启客户端以彻底退出代理环境');
  } else if (cmd === 'unlock-status') {
    console.log('🔍 正在检测 Antigravity 后端上下文加长状态...');
    const st = await analyzeBinaryAsync(customPath);
    console.log(`- 目标文件: ${st.targetPath || '未检测到'}`);
    console.log(`- 目标架构: ${st.arch || '未知'} (${st.format || '未知'}, ${st.mode || '未知'})`);
    console.log(`- 解锁状态: [${st.statusText || st.status}] ${st.details || st.reason || ''}`);
    if (st.backupInfo) {
      console.log(`- 备份文件: ${st.backupInfo.backupPath}`);
    }
    console.log(`- ${st.author?.credit || AUTHOR_INFO.credit} (${st.author?.url || AUTHOR_INFO.url})`);
  } else if (cmd === 'unlock') {
    console.log('⚡ 正在执行 Antigravity 后端上下文加长解锁...');
    console.log(`ℹ ${AUTHOR_INFO.credit} (${AUTHOR_INFO.url})`);
    console.log(`⚠️  ${AUTHOR_INFO.disclaimer}`);
    const res = applyUnlock({ targetPath: customPath });
    if (!res.ok) {
      throw new Error(res.error);
    }
    console.log(`✅ ${res.message || '解锁成功！'}`);
    if (res.backupPath) console.log(`📁 原版备份已安全保存至: ${res.backupPath}`);
  } else if (cmd === 'unlock-restore') {
    console.log('🔄 正在恢复 Antigravity 官方原版后端二进制...');
    const res = restoreUnlock({ targetPath: customPath });
    if (!res.ok) {
      throw new Error(res.error);
    }
    console.log(`✅ ${res.message || '恢复完成！'}`);
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

    console.log('📦 [Antigravity 统一模块状态总览]');
    console.log('1. 上下文与 Token 监控 (ContextMeter):');
    console.log(`   - 配置状态: ${cfg.modules.meter.enabled ? '🟢 已启用' : '⚪ 已禁用'}`);
    console.log(`   - 磁盘注入: ${asarUtils.includes('installContextMeter') ? '✅ 已注入' : '⚪ 未注入'}`);

    console.log('2. 客户端界面汉化 (Chinese Desktop):');
    console.log(`   - 配置状态: ${cfg.modules.chinese.enabled ? '🟢 已启用' : '⚪ 已禁用'}`);
    console.log(`   - 磁盘注入: ${asarPreload.includes('Antigravity Chinese Localization') ? '✅ 已注入' : '⚪ 未注入'}`);
    if (cfg.modules.chinese.migratedFrom) {
      console.log(`   - 迁移来源: ${cfg.modules.chinese.migratedFrom}`);
    }

    console.log('3. 免 TUN 网络直连 (ProxyNoTun):');
    console.log(`   - 配置状态: ${cfg.modules.proxy.enabled ? '🟢 已启用' : '⚪ 已禁用'}`);
    console.log(`   - 代理地址: ${cfg.modules.proxy.proxyUrl || '未配置'}`);
    console.log(`   - 绕过列表: ${cfg.modules.proxy.bypassList || '默认'}`);
    console.log(`   - 磁盘注入: ${asarUtils.includes('Antigravity Proxy NoTun') ? '✅ 已注入' : '⚪ 未注入'}`);
    if (cfg.modules.proxy.migratedFrom) {
      console.log(`   - 迁移来源: ${cfg.modules.proxy.migratedFrom}`);
    }
  } else if (cmd === 'chinese:enable' || cmd === 'chinese:disable') {
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    const enable = cmd === 'chinese:enable';
    cfg.modules.chinese.enabled = enable;
    cfg.modules.chinese.language = enable ? 'zh-CN' : 'en';
    saveModulesConfig(cfg);
    await install({ path: customPath, modules: { chinese: { enabled: enable } } });
    console.log(`✅ 客户端界面汉化模块已${enable ? '开启' : '关闭'}并完成 ASAR 注入同步！`);
  } else if (cmd === 'proxy:enable' || cmd === 'proxy:disable') {
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    const enable = cmd === 'proxy:enable';
    cfg.modules.proxy.enabled = enable;
    saveModulesConfig(cfg);
    await install({ path: customPath, modules: { proxy: { enabled: enable } } });
    console.log(`✅ 免 TUN 网络直连模块已${enable ? '开启' : '关闭'}并完成 ASAR 注入同步！`);
  } else if (cmd === 'proxy:set') {
    const newUrl = args[1] && !args[1].startsWith('-') ? args[1] : args[2];
    if (!newUrl) throw new Error('请提供有效的代理地址，例如: node cli.js proxy:set http://127.0.0.1:7890');
    const { loadModulesConfig, saveModulesConfig } = require('./modules-config');
    const cfg = loadModulesConfig();
    cfg.modules.proxy.proxyUrl = newUrl;
    saveModulesConfig(cfg);
    if (cfg.modules.proxy.enabled) {
      await install({ path: customPath, modules: { proxy: { proxyUrl: newUrl } } });
    }
    console.log(`✅ 代理地址已更新为: ${newUrl}`);
  } else if (cmd === 'proxy:test') {
    const { loadModulesConfig, testProxyHealth } = require('./modules-config');
    const cfg = loadModulesConfig();
    const urlToTest = args[1] && !args[1].startsWith('-') ? args[1] : cfg.modules.proxy.proxyUrl;
    console.log(`🔍 正在分层检测代理地址连通性: ${urlToTest}...`);
    const r = await testProxyHealth(urlToTest);
    console.log(`  - 1. 配置格式验证: ${r.configValid ? '✅ 合法' : '❌ 错误'}`);
    console.log(`  - 2. 本地代理端口: ${r.proxyReachable ? '✅ 可连接' : '❌ 无法连接'}`);
    console.log(`  - 3. 实际网络连通: ${r.internetReachable ? '✅ 可访问公网' : '⚠️ 无法访问公网 (可能节点无境外连接)'}`);
    console.log(`  - 4. 真实模型请求: 待通过真实在线会话验证 (分层标定)`);
    if (r.error) console.log(`  ⚠️ 诊断提示: ${r.error}`);
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
      throw new Error('当前安装目录非 Git 仓库，请通过 git clone 安装后再执行 update');
    }
    const runGit = (gitArgs, timeout = 10000) => execFileSync('git', gitArgs, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const dirty = runGit(['status', '--porcelain', '--untracked-files=no'], 3000);
    if (dirty) {
      throw new Error('本地有未提交改动，已取消自动更新以避免覆盖');
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
    console.log(`🔄 正在从 ${remote}/${branch} 检查并拉取最新代码（当前: ${beforeSha}）...`);
    runGit(['fetch', '--quiet', remote, branch], 10000);
    const pullOut = runGit(['pull', '--ff-only', remote, branch], 15000);
    const afterSha = runGit(['rev-parse', '--short', 'HEAD'], 2500);
    const pkgVer = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
    if (beforeSha === afterSha && /already up[- ]to[- ]date/i.test(pullOut)) {
      console.log(`✅ 当前已是最新版本：v${pkgVer} (${afterSha})`);
    } else {
      console.log(`✅ 代码已更新：${beforeSha} -> ${afterSha} (v${pkgVer})`);
    }
    const { resolveActiveCdpTarget } = require('./asar-engine');
    const cdpInfo = await resolveActiveCdpTarget({ timeoutMs: 2000 }).catch(() => ({ port: null, targets: [] }));
    if (cdpInfo && cdpInfo.targets && cdpInfo.targets.length > 0) {
      await ensureLiveBridgeIfNeeded({ forceFreshBridge: true, noRemote });
      const ok = await tryHotInject();
      if (ok) {
        console.log(`✅ 已自动热刷新当前 Antigravity 窗口！${noRemote ? '（已禁用手机远程端口）' : ''}`);
      }
    } else {
      console.log('ℹ️ 当前未检测到运行中的 Antigravity 窗口，下次启动时将自动加载最新版本。');
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
  node cli.js live [--no-remote]            免改盘 CDP 热挂载到当前运行窗口（默认命令；加 --no-remote 关闭手机远程监听）
  node cli.js update [--no-remote]          从 GitHub 拉取最新代码并自动热刷新当前窗口
  node cli.js status                        显示运行状态与官方安装包签名完整性
  node cli.js remote [--tunnel on|off] [--reset-token] [--json]  打印手机「四通道」融合配对链接与终端二维码
  node cli.js check                         执行前置环境健康检查
  node cli.js upstreams [--json]            检查参考上游项目更新并与当前基线比对

说明:
  已默认禁用所有修改 app.asar 与二进制补丁命令；可通过环境变量 AG_DISABLE_MOBILE_REMOTE=1 全局关闭手机远程端口。`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ 执行失败:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { cmdStatus, cmdCheck };
