'use strict';
// 本地开发与实时会话桥接服务。常规启动时由 Electron IPC 接管。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');
const { fileURLToPath } = require('url');
const { connect } = require('./local-api');
const {
  collect,
  collectTokenHistoryAsync,
  recordModelCalls,
  getPluginSettings,
  savePluginSettings,
  launchCliSession,
  detectAvailableTerminals,
  pickTerminalExecutableDialog,
  getContextUnlockStatus,
  applyContextUnlock,
  restoreContextUnlock
} = require('./meter-collector');
const { getStateDir } = require('./asar-engine');
const { safeReadJsonSync, safeWriteJsonSync } = require('./meter-storage');
const { startMobileRemoteServer, buildRemoteInfo, saveRemoteTunnelConfig, validateTailscaleCustomHost } = require('./mobile-remote');
const { createMacosDockBadgeManager } = require('./macos-dock-badge');

const MAX_BODY_BYTES = 1024 * 1024; // 1MB 传输体积上限
const MAX_RECORD_CALLS = 500; // 单批次最大记录数
const MAX_TRANSLATE_BATCH = 30; // 单次批量翻译最大条数
const ALLOWED_ROUTES = [
  '/scan',
  '/token-history',
  '/record-calls',
  '/get-settings',
  '/save-settings',
  '/launch-cli',
  '/list-terminals',
  '/pick-terminal-path',
  '/context-unlock-status',
  '/context-unlock-apply',
  '/context-unlock-restore',
  '/enhance-status',
  '/enhance-apply',
  '/enhance-restore',
  '/restart-language-servers',
  '/modules-status',
  '/toggle-module',
  '/test-proxy',
  '/restart-host',
  '/export-markdown',
  '/translate-zh',
  '/localize-conversations',
  '/brain-stats',
  '/read-local-file',
  '/write-local-file',
  '/open-external-url',
  '/remote-info',
  '/remote-tunnel',
  '/suite-version-check',
  '/suite-apply-update',
  '/dock-state',
  '/dock-badge-status',
  '/dock-badge-test',
  '/dock-badge-open-ax'
];

function readSuitePackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return String(pkg?.version || '0.8.5').trim();
  } catch {
    return '0.8.5';
  }
}

function runSuiteGitSync(args, timeoutMs = 5000) {
  return execFileSync('git', args, {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim();
}

function resolveSuiteGitTarget() {
  let remote = 'origin';
  let branch = 'main';
  let ref = 'origin/main';
  try {
    const curBranch = runSuiteGitSync(['rev-parse', '--abbrev-ref', 'HEAD'], 2000);
    if (curBranch && curBranch !== 'HEAD') branch = curBranch;
  } catch {}
  try {
    const upstream = runSuiteGitSync(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 2000);
    if (upstream && upstream.includes('/')) {
      const slash = upstream.indexOf('/');
      remote = upstream.slice(0, slash);
      branch = upstream.slice(slash + 1);
      ref = upstream;
    }
  } catch {
    ref = `${remote}/${branch}`;
  }
  return { remote, branch, ref };
}

function checkSuiteRepoVersion(options = {}) {
  const version = readSuitePackageVersion();
  const fetchRemote = options?.fetchRemote !== false;
  if (!fs.existsSync(path.join(__dirname, '.git'))) {
    return {
      ok: true,
      isGitRepo: false,
      version,
      branch: '',
      localShortSha: '',
      localSubject: '',
      remoteShortSha: '',
      behindCount: 0,
      hasUpdate: false,
      latestSubject: '',
      latestRelativeTime: '',
      fetchError: '',
      fetchErrorDetail: ''
    };
  }

  let localShortSha = '';
  let localSubject = '';
  try { localShortSha = runSuiteGitSync(['rev-parse', '--short', 'HEAD'], 2500); } catch {}
  try { localSubject = runSuiteGitSync(['log', '-1', '--format=%s', 'HEAD'], 2500); } catch {}
  const { remote, branch, ref } = resolveSuiteGitTarget();

  let fetchError = '';
  let fetchErrorDetail = '';
  if (fetchRemote) {
    try {
      runSuiteGitSync(['fetch', '--quiet', remote, branch], 8000);
    } catch (e) {
      fetchError = '暂时无法连接更新服务器，请检查网络或代理设置后重试';
      fetchErrorDetail = String(e?.stderr || e?.message || '检查远端更新失败').trim().split(/\r?\n/)[0].slice(0, 200);
    }
  }

  let behindCount = 0;
  let remoteShortSha = localShortSha;
  let latestSubject = localSubject;
  let latestRelativeTime = '';
  try {
    const cntStr = runSuiteGitSync(['rev-list', '--count', `HEAD..${ref}`], 2500);
    behindCount = Math.max(0, Number.parseInt(cntStr, 10) || 0);
    if (behindCount > 0) {
      remoteShortSha = runSuiteGitSync(['rev-parse', '--short', ref], 2500);
      latestSubject = runSuiteGitSync(['log', '-1', '--format=%s', ref], 2500);
      latestRelativeTime = runSuiteGitSync(['log', '-1', '--format=%cr', ref], 2500);
    }
  } catch {}

  return {
    ok: true,
    isGitRepo: true,
    version,
    branch,
    localShortSha,
    localSubject,
    remoteShortSha,
    behindCount,
    hasUpdate: behindCount > 0,
    latestSubject,
    latestRelativeTime,
    fetchError,
    fetchErrorDetail
  };
}

function applySuiteRepoUpdate() {
  const version = readSuitePackageVersion();
  if (!fs.existsSync(path.join(__dirname, '.git'))) {
    return { ok: false, noGitRepo: true, version, error: '当前为手动安装版，暂不支持在线一键更新，请前往项目页下载新版覆盖安装' };
  }
  try {
    const dirty = runSuiteGitSync(['status', '--porcelain', '--untracked-files=no'], 3000);
    if (dirty) {
      return { ok: false, dirty: true, version, error: '检测到本地文件有自定义修改，为防止覆盖你的改动，已暂停自动更新（原有配置不受影响）' };
    }
    const { remote, branch } = resolveSuiteGitTarget();
    const beforeSha = runSuiteGitSync(['rev-parse', '--short', 'HEAD'], 2500);
    const pullOut = runSuiteGitSync(['pull', '--ff-only', remote, branch], 15000);
    const afterSha = runSuiteGitSync(['rev-parse', '--short', 'HEAD'], 2500);
    const localSubject = runSuiteGitSync(['log', '-1', '--format=%s', 'HEAD'], 2500);
    const nextVersion = readSuitePackageVersion();
    const alreadyUpToDate = beforeSha === afterSha && /already up[- ]to[- ]date/i.test(pullOut);
    return {
      ok: true,
      updated: true,
      alreadyUpToDate,
      version: nextVersion,
      beforeSha,
      localShortSha: afterSha,
      localSubject
    };
  } catch (e) {
    const detail = String(e?.stderr || e?.message || '拉取更新失败').trim().split(/\r?\n/)[0].slice(0, 200);
    return {
      ok: false,
      version,
      error: '更新未完成（当前版本和数据不受影响），请检查网络或代理后重试',
      errorDetail: detail || '拉取更新失败'
    };
  }
}

// 解析并校验可编辑本地文件路径，禁止读写系统关键目录与敏感凭据目录
function resolveSafeEditablePath(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) return null;
  let fsPath = input;
  if (/^file:\/\//i.test(input)) {
    try {
      fsPath = fileURLToPath(input);
    } catch {
      return null;
    }
  }
  if (!path.isAbsolute(fsPath)) return null;
  const resolved = path.resolve(fsPath);
  const blockedPrefixes = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/var',
    '/private/etc',
    '/Applications/Antigravity.app'
  ];
  for (const prefix of blockedPrefixes) {
    if (resolved === prefix || resolved.startsWith(prefix + '/')) {
      return null;
    }
  }
  if (/\/(?:\.ssh|\.gnupg|\.aws|1Password)\//i.test(resolved)) {
    return null;
  }
  return resolved;
}

// 校验并规范化待使用系统默认浏览器打开的外部链接，仅允许 http/https/mailto
function resolveSafeExternalUrl(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input || /[\r\n\0]/.test(input)) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

const customTitlesPath = path.join(getStateDir(), 'custom-conversation-titles.json');
let customTitlesCache = { mtimeMs: -1, data: {} };

// 从状态目录按需读取用户自定义会话标题映射，避免硬编码个人会话记录
function getCustomConversationTitles() {
  try {
    if (!fs.existsSync(customTitlesPath)) {
      customTitlesCache = { mtimeMs: -1, data: {} };
      return customTitlesCache.data;
    }
    const stat = fs.statSync(customTitlesPath);
    if (stat.mtimeMs !== customTitlesCache.mtimeMs) {
      const loaded = safeReadJsonSync(customTitlesPath, {});
      if (loaded.ok && loaded.data && typeof loaded.data === 'object' && !Array.isArray(loaded.data)) {
        customTitlesCache = { mtimeMs: stat.mtimeMs, data: loaded.data };
      } else {
        customTitlesCache = { mtimeMs: stat.mtimeMs, data: {} };
      }
    }
  } catch {}
  return customTitlesCache.data;
}

const translationCachePath = path.join(getStateDir(), 'zh-translation-cache.json');
let translationCache = {};
try {
  const loaded = safeReadJsonSync(translationCachePath, {});
  if (loaded.ok && loaded.data && typeof loaded.data === 'object' && !Array.isArray(loaded.data)) {
    translationCache = loaded.data;
  }
} catch {}

const inFlightTranslations = new Map();

function persistTranslationCache() {
  try {
    const keys = Object.keys(translationCache);
    if (keys.length > 3000) {
      const keep = {};
      for (const k of keys.slice(-2500)) keep[k] = translationCache[k];
      translationCache = keep;
    }
    safeWriteJsonSync(translationCachePath, translationCache, {
      indent: 2,
      validate: (d) => d && typeof d === 'object' && !Array.isArray(d)
    });
  } catch {}
}

function splitTextForTranslate(text, maxLen = 1200) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.2) cut = maxLen;
    else cut += 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function normalizeTranslateTargetLang(targetLang) {
  const raw = String(targetLang || '').trim().toLowerCase();
  if (!raw) return 'zh-TW';
  if (raw === 'zh-cn' || raw === 'zh-hans' || raw === 'zh' || raw === 'cn') {
    return 'zh-CN';
  }
  if (raw === 'zh-tw' || raw === 'zh-hant' || raw === 'zh-hk' || raw === 'tw' || raw.startsWith('zh-tw-') || raw.startsWith('zh-hant-')) {
    return 'zh-TW';
  }
  return 'zh-TW';
}

function getTranslationCacheKey(text, targetLang) {
  const tl = normalizeTranslateTargetLang(targetLang);
  return tl === 'zh-TW' ? `zh-TW\0${text}` : text;
}

async function translateSingleChunkToZh(chunk, targetLang = 'zh-TW') {
  const tl = normalizeTranslateTargetLang(targetLang);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(chunk)}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AntigravityContextMeter/1.0' },
    signal: AbortSignal.timeout(8000)
  });
  if (!resp.ok) throw new Error(`翻译接口 HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  return data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
}

async function translateToZh(rawText, targetLang = 'zh-TW') {
  const text = String(rawText || '').trim();
  if (!text) return '';
  const tl = normalizeTranslateTargetLang(targetLang);
  const cacheKey = getTranslationCacheKey(text, tl);
  if (typeof translationCache[cacheKey] === 'string' && translationCache[cacheKey]) {
    return translationCache[cacheKey];
  }
  if (inFlightTranslations.has(cacheKey)) {
    return inFlightTranslations.get(cacheKey);
  }
  const job = (async () => {
    try {
      const chunks = splitTextForTranslate(text);
      const parts = [];
      for (const ch of chunks) {
        const zh = await translateSingleChunkToZh(ch, tl);
        if (zh) parts.push(zh);
      }
      const merged = parts.join('').trim();
      if (merged) {
        translationCache[cacheKey] = merged;
        return merged;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightTranslations.delete(cacheKey);
    }
  })();
  inFlightTranslations.set(cacheKey, job);
  return job;
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const count = Math.min(Math.max(1, limit), items.length);
  const runners = Array.from({ length: count }, async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function cleanTextForTitle(raw) {
  let s = String(raw || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/@\[[^\]]+\]/g, ' ');
  s = s.replace(/(?:~\/|\/Users\/|\/Applications\/|\/System\/|\/etc\/|\/var\/|\/tmp\/|[A-Za-z]:\\)[^\s"'`<>|]+/g, ' ');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/[#>*_~|[\]{}]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[，。！？：；、,.!?:;\-—·\s]+|[，。！？：；、,.!?:;\-—·\s]+$/g, '').trim();
  return s;
}

function extractTitleFromLocalTranscript(id, allowEnglish = false) {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return null;
  const logsDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain', id, '.system_generated', 'logs');
  const compactLogPath = path.join(logsDir, 'transcript.jsonl');
  const fullLogPath = path.join(logsDir, 'transcript_full.jsonl');
  const logPath = fs.existsSync(compactLogPath) ? compactLogPath : (fs.existsSync(fullLogPath) ? fullLogPath : null);
  if (!logPath) return null;
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry && entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
        const m = entry.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
        const raw = (m ? m[1] : entry.content);
        const cleaned = cleanTextForTitle(raw);
        if (!cleaned) return null;
        const zhMatches = cleaned.match(/[\u4e00-\u9fff]/g) || [];
        if (zhMatches.length >= 2 || allowEnglish) {
          return cleaned.slice(0, 18).replace(/[，。！？：；、,.!?:;\-—·\s]+$/g, '').trim();
        }
        return null;
      }
    }
  } catch {}
  return null;
}

function calcDirSizeBytes(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    const full = path.join(dirPath, ent.name);
    try {
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        total += calcDirSizeBytes(full);
      } else if (ent.isFile()) {
        total += fs.lstatSync(full).size;
      }
    } catch {}
  }
  return total;
}

function collectBrainStats() {
  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  if (!fs.existsSync(brainDir)) {
    return { ok: true, totalBytes: 0, totalMB: 0, count: 0, topSessions: [] };
  }
  let entries = [];
  try {
    entries = fs.readdirSync(brainDir, { withFileTypes: true });
  } catch (e) {
    return {
      ok: false,
      error: '无法读取本地会话缓存，请检查文件夹权限后重试',
      errorDetail: String(e?.message || e || '').trim().slice(0, 200)
    };
  }
  let totalBytes = 0;
  const sessions = [];
  const customTitles = getCustomConversationTitles();
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const id = ent.name;
    const bytes = calcDirSizeBytes(path.join(brainDir, id));
    totalBytes += bytes;
    const title = customTitles[id] || extractTitleFromLocalTranscript(id, true) || id.slice(0, 8);
    sessions.push({
      id,
      shortId: id.slice(0, 8),
      title,
      bytes,
      mb: Number((bytes / (1024 * 1024)).toFixed(1))
    });
  }
  sessions.sort((a, b) => b.bytes - a.bytes);
  return {
    ok: true,
    totalBytes,
    totalMB: Number((totalBytes / (1024 * 1024)).toFixed(1)),
    count: sessions.length,
    topSessions: sessions.slice(0, 5)
  };
}

function validateDockStatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Dock 状态请求体必须为 JSON 对象' };
  }
  if (typeof payload.windowId !== 'string') {
    return { ok: false, error: '缺少有效的 windowId 字符串' };
  }
  const windowId = payload.windowId.trim();
  if (!windowId || windowId.length > 128 || /[\x00-\x1f\x7f]/.test(windowId)) {
    return { ok: false, error: 'windowId 格式不合法' };
  }
  if (payload.offline !== undefined && typeof payload.offline !== 'boolean') {
    return { ok: false, error: 'offline 字段必须为布尔值' };
  }
  if (payload.offline === true) {
    return { ok: true, data: { windowId, offline: true } };
  }
  const unreadRaw = payload.unreadCount !== undefined ? payload.unreadCount : payload.unread;
  if (unreadRaw !== undefined && (typeof unreadRaw !== 'number' || !Number.isFinite(unreadRaw) || unreadRaw < 0)) {
    return { ok: false, error: 'unreadCount 必须为非负有限数字' };
  }
  let unreadIds;
  if (payload.unreadIds !== undefined) {
    if (!Array.isArray(payload.unreadIds)) {
      return { ok: false, error: 'unreadIds 必须为数组' };
    }
    if (payload.unreadIds.length > 200) {
      return { ok: false, error: 'unreadIds 最多支持 200 项' };
    }
    const dedup = new Set();
    for (const rawItem of payload.unreadIds) {
      if (typeof rawItem !== 'string') {
        return { ok: false, error: 'unreadIds 每项必须为非空字符串' };
      }
      const id = rawItem.trim();
      if (!id || id.length > 128 || /[\x00-\x1f\x7f]/.test(id)) {
        return { ok: false, error: 'unreadIds 存在不合法的会话 ID' };
      }
      dedup.add(id);
    }
    unreadIds = Array.from(dedup);
  }
  const approvalRaw = payload.approvalCount !== undefined ? payload.approvalCount : payload.approval;
  if (approvalRaw !== undefined && (typeof approvalRaw !== 'number' || !Number.isFinite(approvalRaw) || approvalRaw < 0)) {
    return { ok: false, error: 'approvalCount 必须为非负有限数字' };
  }
  if (payload.highRisk !== undefined && typeof payload.highRisk !== 'boolean') {
    return { ok: false, error: 'highRisk 字段必须为布尔值' };
  }
  if (payload.running !== undefined && typeof payload.running !== 'boolean') {
    return { ok: false, error: 'running 字段必须为布尔值' };
  }
  if (payload.locale !== undefined && (typeof payload.locale !== 'string' || payload.locale.trim().length > 32)) {
    return { ok: false, error: 'locale 字段必须为长度不超过 32 的字符串' };
  }
  const data = {
    windowId,
    offline: false,
    unreadCount: unreadRaw ?? 0,
    approvalCount: approvalRaw ?? 0,
    highRisk: Boolean(payload.highRisk),
    running: Boolean(payload.running),
    locale: typeof payload.locale === 'string' && payload.locale.trim() ? payload.locale.trim() : 'zh-TW'
  };
  if (unreadIds !== undefined) {
    data.unreadIds = unreadIds;
  }
  return {
    ok: true,
    data
  };
}

async function startEmbeddedLiveBridge(options = {}) {
  let currentOrigin = String(
    options.origin ||
    (typeof options.getOrigin === 'function' ? options.getOrigin() : '') ||
    ''
  ).trim();
  const resolveOrigin = () => {
    if (typeof options.getOrigin === 'function') {
      const dynamic = String(options.getOrigin() || '').trim();
      if (dynamic) currentOrigin = dynamic;
    }
    return currentOrigin;
  };

  const secret = crypto.randomBytes(32).toString('hex');
  const mobileRemoteDisabled = Boolean(
    options.skipMobileRemote ||
    process.env.AG_DISABLE_MOBILE_REMOTE === '1' ||
    process.argv.includes('--no-remote')
  );
  const stamp = options.stampPath || path.join(getStateDir(), '.live-session.json');
  const writeStamp = options.writeStamp !== false;
  let remoteHandle = null;
  let dockBadge = null;
  if (options.disableDockBadge !== true) {
    try {
      const initialUiPrefs = getPluginSettings()?.uiPreferences || {};
      dockBadge = createMacosDockBadgeManager({
        uiPreferences: initialUiPrefs,
        ...(options.dockBadgeOptions && typeof options.dockBadgeOptions === 'object' ? options.dockBadgeOptions : {})
      });
    } catch (e) {
      console.error('Dock badge manager startup skipped:', e?.message || e);
    }
  }
  let serverPort = 0;

  const persistStamp = () => {
    if (!writeStamp || !serverPort) return;
    try {
      fs.mkdirSync(path.dirname(stamp), { recursive: true });
      const info = {
        port: serverPort,
        token: secret,
        pid: process.pid,
        origin: resolveOrigin(),
        remoteDisabled: mobileRemoteDisabled,
        startedAt: Date.now(),
        embedded: Boolean(options.embedded)
      };
      fs.writeFileSync(stamp, JSON.stringify(info));
    } catch {}
  };
  const server = http.createServer(async (req, res) => {
    const allowedOrigin = resolveOrigin();
    const origin = req.headers.origin;
    if (!allowedOrigin || origin !== allowedOrigin) { res.writeHead(403); res.end(); return; }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-AG-Context-Token');
      res.writeHead(204); res.end(); return;
    }
    if (req.method !== 'POST' || !ALLOWED_ROUTES.includes(req.url) || req.headers['x-ag-context-token'] !== secret) { res.writeHead(403); res.end(); return; }
    const chunks = [];
    let bodyLength = 0;
    let exceeded = false;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bodyLength += buf.length;
      if (bodyLength > MAX_BODY_BYTES) {
        exceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请求体积超出限制（最大 1MB）' }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', async () => {
      if (exceeded) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const request = JSON.parse(body || '{}');
        if (req.url === '/record-calls') {
          const calls = Array.isArray(request.calls) ? request.calls : [];
          if (calls.length > MAX_RECORD_CALLS) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `单次入账记录数超出上限（最多 ${MAX_RECORD_CALLS} 条）` }));
            return;
          }
          const resCall = recordModelCalls(calls);
          if (resCall && typeof resCall === 'object' && resCall.ok === false) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, changed: false, error: resCall.error || '入账落盘失败' }));
            return;
          }
          const changed = (resCall && typeof resCall === 'object') ? !!resCall.changed : !!resCall;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, changed }));
          return;
        }
        if (req.url === '/get-settings') {
          const result = getPluginSettings(request);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/save-settings') {
          const result = savePluginSettings(request);
          if (result?.uiPreferences) {
            dockBadge?.applyPreferences?.(result.uiPreferences);
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/launch-cli') {
          const result = await launchCliSession(request);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/list-terminals') {
          const savedPrefs = getPluginSettings()?.uiPreferences || {};
          const customPath = request?.customTerminalPath ?? savedPrefs.customTerminalPath ?? '';
          const result = detectAvailableTerminals({ customPath });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/pick-terminal-path') {
          const result = await pickTerminalExecutableDialog({});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/context-unlock-status') {
          const result = await getContextUnlockStatus(undefined, request || {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: result }));
          return;
        }
        if (req.url === '/context-unlock-apply') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: '已禁用二进制解锁（保护官方签名与账号合规）' }));
          return;
        }
        if (req.url === '/context-unlock-restore') {
          const result = restoreContextUnlock();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/enhance-status') {
          const { getEnhanceStatus } = require('./meter-enhance');
          const result = getEnhanceStatus(request || {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: result }));
          return;
        }
        if (req.url === '/enhance-apply') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: '已禁用二进制内核补丁（保护 macOS 官方签名与账号安全，中文标题已由免改包桥接接管）' }));
          return;
        }
        if (req.url === '/enhance-restore') {
          const { restoreAllEnhance } = require('./meter-enhance');
          const result = restoreAllEnhance(request || {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/restart-language-servers') {
          const { restartLanguageServers } = require('./meter-enhance');
          const result = restartLanguageServers();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/modules-status') {
          const { loadModulesConfig, inspectDiskModules } = require('./modules-config');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: loadModulesConfig(), disk: inspectDiskModules(request?.asarPath || null) }));
          return;
        }
        if (req.url === '/toggle-module') {
          const { loadModulesConfig, saveModulesConfig, inspectDiskModules, normalizeBrandTitle, normalizeClientLanguage } = require('./modules-config');
          const cfg = loadModulesConfig();
          const mod = request?.name;
          if (!cfg.modules[mod]) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: `未知模块: ${mod}` }));
            return;
          }
          const extra = request?.opts || {};
          if (mod === 'chinese') {
            const nextLang = normalizeClientLanguage(extra.language, Boolean(request?.enable));
            cfg.modules.chinese.language = nextLang;
            cfg.modules.chinese.enabled = nextLang === 'zh-CN' || nextLang === 'zh-TW';
            if (extra.brandTitle !== undefined) cfg.modules.chinese.brandTitle = normalizeBrandTitle(extra.brandTitle);
            cfg.modules.chinese.lastUpdated = new Date().toISOString();
          } else {
            cfg.modules[mod].enabled = Boolean(request?.enable);
            if (mod === 'proxy') {
              if (extra.proxyUrl) cfg.modules.proxy.proxyUrl = extra.proxyUrl;
              if (extra.bypassList) cfg.modules.proxy.bypassList = extra.bypassList;
            }
          }
          saveModulesConfig(cfg);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, status: 'config_toggled', data: cfg, disk: inspectDiskModules(extra.asarPath || null), restartRequired: mod !== 'proxy' }));
          return;
        }
        if (req.url === '/test-proxy') {
          const { testProxyHealth } = require('./modules-config');
          const report = await testProxyHealth(request?.proxyUrl || '');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: report }));
          return;
        }
        if (req.url === '/restart-host') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, supported: false }));
          return;
        }
        if (req.url === '/token-history') {
          const data = await collectTokenHistoryAsync({ force: request.force === true });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data }));
          return;
        }
        if (req.url === '/export-markdown') {
          const id = String(request.id || '').trim();
          if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: '无效的会话 ID' }));
            return;
          }
          const logsDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain', id, '.system_generated', 'logs');
          const fullLogPath = path.join(logsDir, 'transcript_full.jsonl');
          const compactLogPath = path.join(logsDir, 'transcript.jsonl');
          const logPath = fs.existsSync(fullLogPath) ? fullLogPath : (fs.existsSync(compactLogPath) ? compactLogPath : null);
          if (!logPath) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: '未找到对应会话的日志文件' }));
            return;
          }
          const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
          const sections = [];
          for (const line of lines) {
            if (!line.trim()) continue;
            let entry;
            try { entry = JSON.parse(line); } catch { continue; }
            if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
              const match = entry.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
              const text = (match ? match[1] : entry.content).trim();
              if (text) sections.push(`## 👤 用户\n\n${text}`);
            } else if (entry.type === 'PLANNER_RESPONSE' && typeof entry.content === 'string') {
              const text = entry.content.trim();
              if (text) sections.push(`## 🤖 Antigravity\n\n${text}`);
            }
          }
          const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
          const header = [
            '# Antigravity 会话记录',
            '',
            `- 会话 ID: \`${id}\``,
            `- 导出时间: ${exportedAt}`,
            `- 对话轮次: ${sections.length}`,
            '',
            '---',
            ''
          ].join('\n');
          const markdown = header + sections.join('\n\n---\n\n') + '\n';
          const downloadsDir = path.join(os.homedir(), 'Downloads');
          fs.mkdirSync(downloadsDir, { recursive: true });
          const savedPath = path.join(downloadsDir, `antigravity-session-${id.slice(0, 8)}.md`);
          fs.writeFileSync(savedPath, markdown, 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, markdown, savedPath, turnsCount: sections.length }));
          return;
        }
        if (req.url === '/translate-zh') {
          const targetLang = normalizeTranslateTargetLang(request.targetLang);
          const rawList = Array.isArray(request.texts) ? request.texts : [];
          const uniqueTexts = [];
          const seen = new Set();
          for (const item of rawList) {
            if (typeof item !== 'string') continue;
            const trimmed = item.trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            uniqueTexts.push(trimmed);
            if (uniqueTexts.length >= MAX_TRANSLATE_BATCH) break;
          }
          const translations = {};
          const pending = [];
          for (const text of uniqueTexts) {
            const cacheKey = getTranslationCacheKey(text, targetLang);
            if (typeof translationCache[cacheKey] === 'string' && translationCache[cacheKey]) {
              translations[text] = translationCache[cacheKey];
            } else {
              pending.push(text);
            }
          }
          let added = false;
          if (pending.length) {
            const results = await mapConcurrent(pending, 4, async (text) => {
              const zh = await translateToZh(text, targetLang);
              return [text, zh];
            });
            for (const [text, zh] of results) {
              if (zh) {
                translations[text] = zh;
                added = true;
              }
            }
          }
          if (added) persistTranslationCache();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, translations }));
          return;
        }
        if (req.url === '/localize-conversations') {
          const targetLang = normalizeTranslateTargetLang(request.targetLang);
          const rawItems = Array.isArray(request.items) ? request.items.slice(0, 50) : [];
          const titles = {};
          const toTranslate = [];
          for (const item of rawItems) {
            const id = String(item?.id || '').trim();
            const title = String(item?.title || '').trim();
            if (!id) continue;
            const enWordCount = (title.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
            if (!title || /[\u4e00-\u9fff]/.test(title) || enWordCount < 3) {
              continue;
            }
            const cacheKey = getTranslationCacheKey(title, targetLang);
            if (typeof translationCache[cacheKey] === 'string' && translationCache[cacheKey]) {
              titles[id] = translationCache[cacheKey];
            } else {
              toTranslate.push({ id, title });
            }
          }
          let added = false;
          if (toTranslate.length) {
            const results = await mapConcurrent(toTranslate, 4, async ({ id, title }) => {
              const zh = await translateToZh(title, targetLang);
              return [id, zh];
            });
            for (const [id, zh] of results) {
              if (zh) {
                titles[id] = zh;
                added = true;
              }
            }
          }
          if (added) persistTranslationCache();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, titles }));
          return;
        }
        if (req.url === '/brain-stats') {
          const stats = collectBrainStats();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(stats));
          return;
        }
        if (req.url === '/read-local-file') {
          const filePath = resolveSafeEditablePath(request?.path);
          res.setHeader('Content-Type', 'application/json');
          if (!filePath) {
            res.end(JSON.stringify({ ok: false, error: '路径不合法或位于受保护目录' }));
            return;
          }
          if (!fs.existsSync(filePath)) {
            res.end(JSON.stringify({ ok: false, error: '目标文件不存在' }));
            return;
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            res.end(JSON.stringify({ ok: false, error: '目标不是普通文件' }));
            return;
          }
          if (stat.size > 2 * 1024 * 1024) {
            res.end(JSON.stringify({ ok: false, error: '文件体积超过 2MB，暂不支持侧边栏直接编辑' }));
            return;
          }
          const content = fs.readFileSync(filePath, 'utf8');
          res.end(JSON.stringify({ ok: true, filePath, content, size: stat.size }));
          return;
        }
        if (req.url === '/write-local-file') {
          const filePath = resolveSafeEditablePath(request?.path);
          res.setHeader('Content-Type', 'application/json');
          if (!filePath) {
            res.end(JSON.stringify({ ok: false, error: '路径不合法或位于受保护目录' }));
            return;
          }
          if (typeof request?.content !== 'string') {
            res.end(JSON.stringify({ ok: false, error: '缺少有效的文件文本内容' }));
            return;
          }
          fs.writeFileSync(filePath, request.content, 'utf8');
          res.end(JSON.stringify({ ok: true, filePath, bytes: Buffer.byteLength(request.content, 'utf8') }));
          return;
        }
        if (req.url === '/open-external-url') {
          const safeUrl = resolveSafeExternalUrl(request?.url);
          res.setHeader('Content-Type', 'application/json');
          if (!safeUrl) {
            res.end(JSON.stringify({ ok: false, error: '仅支持 http/https/mailto 外部链接' }));
            return;
          }
          if (request?.dryRun === true) {
            res.end(JSON.stringify({ ok: true, url: safeUrl, dryRun: true }));
            return;
          }
          const execOpts = { timeout: 5000 };
          if (process.platform === 'darwin') {
            execFile('/usr/bin/open', [safeUrl], execOpts, () => {});
          } else if (process.platform === 'win32') {
            execFile('cmd.exe', ['/c', 'start', '', safeUrl], { ...execOpts, windowsHide: true }, () => {});
          } else {
            execFile('xdg-open', [safeUrl], execOpts, () => {});
          }
          res.end(JSON.stringify({ ok: true, url: safeUrl }));
          return;
        }
        if (req.url === '/remote-info') {
          if (mobileRemoteDisabled) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, disabled: true, error: '手机远程功能当前已被启动配置关闭；如需使用，请移除禁用项后重启 Antigravity' }));
            return;
          }
          const tunnelStatus = remoteHandle?.ensureTunnelRunning
            ? remoteHandle.ensureTunnelRunning()
            : (remoteHandle?.getTunnelStatus?.() || null);
          const info = buildRemoteInfo({
            resetToken: request?.resetToken === true,
            tunnelStatus
          });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: info }));
          return;
        }
        if (req.url === '/remote-tunnel') {
          res.setHeader('Content-Type', 'application/json');
          if (mobileRemoteDisabled) {
            res.end(JSON.stringify({ ok: false, disabled: true, error: '手机远程功能当前已被启动配置关闭；如需使用，请移除禁用项后重启 Antigravity' }));
            return;
          }
          if (!remoteHandle?.configureTunnel) {
            const hasDisplayPatch = request && (request.remoteDisplay !== undefined || request.displayConfig !== undefined);
            const touchesTunnelOrCh = request && (
              request.enabled !== undefined
              || request.tunnelEnabled !== undefined
              || request.tunnelMode !== undefined
              || request.tunnelHostname !== undefined
              || request.tunnelToken !== undefined
              || request.tailscaleCustomHost !== undefined
              || request.enabledChannels !== undefined
            );
            if (hasDisplayPatch && !touchesTunnelOrCh) {
              saveRemoteTunnelConfig({ remoteDisplay: request.remoteDisplay ?? request.displayConfig });
              res.end(JSON.stringify({ ok: true, data: buildRemoteInfo({ resetToken: false }) }));
              return;
            }
            if (request?.tailscaleCustomHost !== undefined && String(request.tailscaleCustomHost || '').trim()) {
              const tsCheck = validateTailscaleCustomHost(request.tailscaleCustomHost);
              if (!tsCheck.ok) {
                res.end(JSON.stringify({ ok: false, error: tsCheck.error }));
                return;
              }
            }
            res.end(JSON.stringify({ ok: false, error: '手机远程服务正在启动中，请稍等几秒后点击「刷新状态」重试' }));
            return;
          }
          const cfgResult = await remoteHandle.configureTunnel(request || {});
          const info = buildRemoteInfo({
            resetToken: false,
            tunnelStatus: remoteHandle.getTunnelStatus()
          });
          if (cfgResult && cfgResult.validationError) {
            res.end(JSON.stringify({ ok: false, error: cfgResult.validationError, data: info }));
            return;
          }
          res.end(JSON.stringify({ ok: true, data: info }));
          return;
        }
        if (req.url === '/suite-version-check') {
          const info = checkSuiteRepoVersion({ fetchRemote: request?.fetchRemote !== false });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(info));
          return;
        }
        if (req.url === '/suite-apply-update') {
          const result = applySuiteRepoUpdate();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          if (result && result.ok && !result.alreadyUpToDate) {
            setTimeout(() => {
              try {
                const args = [path.join(__dirname, 'cli.js'), 'live'];
                if (mobileRemoteDisabled) args.push('--no-remote');
                const child = spawn(process.execPath, args, {
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                  env: { ...process.env }
                });
                child.unref();
              } catch {}
            }, 250);
          }
          return;
        }
        if (req.url === '/dock-state') {
          const check = validateDockStatePayload(request);
          if (!check.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: check.error }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          if (!dockBadge) {
            res.end(JSON.stringify({ ok: true, disabled: true }));
            return;
          }
          const result = dockBadge.updateWindowState(check.data);
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/dock-badge-status') {
          if (!request || typeof request !== 'object' || Array.isArray(request)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '请求体必须为 JSON 对象' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          if (!dockBadge) {
            res.end(JSON.stringify({ ok: true, supported: process.platform === 'darwin', disabled: true, enabled: false }));
            return;
          }
          res.end(JSON.stringify(dockBadge.getStatus()));
          return;
        }
        if (req.url === '/dock-badge-test') {
          if (!request || typeof request !== 'object' || Array.isArray(request)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '请求体必须为 JSON 对象' }));
            return;
          }
          if (request.durationMs !== undefined && (typeof request.durationMs !== 'number' || !Number.isFinite(request.durationMs) || request.durationMs <= 0)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'durationMs 必须为正数' }));
            return;
          }
          if (request.locale !== undefined && (typeof request.locale !== 'string' || request.locale.trim().length > 32)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'locale 必须为长度不超过 32 的字符串' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          if (!dockBadge) {
            res.end(JSON.stringify({ ok: false, disabled: true, errorCode: 'NOT_READY', error: '当前后台服务尚未开启 Dock 图标提醒模块，请完全退出并重新打开 Antigravity 后重试' }));
            return;
          }
          const result = await dockBadge.triggerTestPreview({
            durationMs: request.durationMs,
            locale: request.locale
          });
          res.end(JSON.stringify(result));
          return;
        }
        if (req.url === '/dock-badge-open-ax') {
          if (!request || typeof request !== 'object' || Array.isArray(request)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '请求体必须为 JSON 对象' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          if (!dockBadge) {
            res.end(JSON.stringify({ ok: false, disabled: true, errorCode: 'NOT_READY', error: '当前后台服务尚未开启 Dock 图标提醒模块，请完全退出并重新打开 Antigravity 后重试' }));
            return;
          }
          const result = await dockBadge.openAccessibilitySettings();
          res.end(JSON.stringify(result));
          return;
        }
        let scanOrigin = resolveOrigin();
        if (!scanOrigin) {
          const a = await connect();
          scanOrigin = a.origin;
          currentOrigin = scanOrigin;
        }
        const data = await collect(scanOrigin, request.id, { force: request.force === true });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, data }));
      }
      catch (e) {
        console.error('[live-host] request error:', e);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          ok: false,
          error: '本地服务处理失败（已有数据不受影响），请稍后重试或重启 Antigravity',
          errorDetail: String(e?.message || e || '')
        }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      serverPort = server.address().port;
      persistStamp();
      console.log('Context Meter local bridge ready on loopback port ' + serverPort);
      if (mobileRemoteDisabled) {
        console.log('Mobile Remote PWA disabled via --no-remote / AG_DISABLE_MOBILE_REMOTE=1');
      } else {
        try {
          remoteHandle = startMobileRemoteServer();
        } catch (e) {
          console.error('Mobile Remote PWA startup skipped:', e?.message || e);
        }
      }
      resolve();
    });
  });

  const getInfo = () => ({
    port: serverPort,
    token: secret,
    pid: process.pid,
    origin: resolveOrigin()
  });

  const setOrigin = (nextOrigin) => {
    const clean = String(nextOrigin || '').trim();
    if (clean && clean !== currentOrigin) {
      currentOrigin = clean;
      persistStamp();
    }
  };

  const stop = async (opts = {}) => {
    const rh = remoteHandle;
    remoteHandle = null;
    const db = dockBadge;
    dockBadge = null;
    if (writeStamp && !opts.preserveStamp) {
      try {
        if (fs.existsSync(stamp)) {
          const disk = JSON.parse(fs.readFileSync(stamp, 'utf8'));
          if (disk && disk.pid === process.pid && disk.token === secret) {
            fs.unlinkSync(stamp);
          }
        }
      } catch {}
    }
    try { server.close(); } catch {}
    try { await rh?.stop?.(); } catch {}
    try { await db?.stop?.(); } catch {}
  };

  return {
    port: serverPort,
    token: secret,
    getInfo,
    setOrigin,
    stop
  };
}

function isLiveSessionTakenOver(stampPath, myPid, myToken) {
  try {
    if (!fs.existsSync(stampPath)) return false;
    const diskInfo = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    if (!diskInfo || !diskInfo.pid) return false;
    if (diskInfo.pid === myPid && diskInfo.token === myToken) return false;
    process.kill(diskInfo.pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  (async () => {
    const { tryHotInject } = require('./install');
    let api = await connect();
    const stamp = path.join(getStateDir(), '.live-session.json');
    const bridge = await startEmbeddedLiveBridge({
      origin: api.origin,
      getOrigin: () => api.origin,
      stampPath: stamp,
      embedded: false
    });
    const shutdownAll = async (code = 0, opts = {}) => {
      clearInterval(check);
      try {
        await Promise.race([
          Promise.resolve(bridge.stop(opts)),
          new Promise((r) => setTimeout(r, 700))
        ]);
      } catch {}
      process.exit(code);
    };
    process.on('SIGTERM', () => shutdownAll(0));
    process.on('SIGINT', () => shutdownAll(0));
    let misses = 0;
    let checking = false;
    const check = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (isLiveSessionTakenOver(stamp, process.pid, bridge.token)) {
          shutdownAll(0, { preserveStamp: true });
          return;
        }
        const a = await connect();
        misses = 0;
        if (a.origin !== api.origin) {
          api = a;
          bridge.setOrigin(a.origin);
        }
        await tryHotInject({ onlyMissing: true });
      } catch {
        if (isLiveSessionTakenOver(stamp, process.pid, bridge.token)) {
          shutdownAll(0, { preserveStamp: true });
          return;
        }
        if (++misses >= 40) {
          shutdownAll(0);
        }
      } finally {
        checking = false;
      }
    }, 3000);
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}

module.exports = {
  startEmbeddedLiveBridge,
  resolveSafeExternalUrl,
  resolveSafeEditablePath
};
