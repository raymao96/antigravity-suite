#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile, execFileSync, spawn } = require('child_process');
const { getStateDir, resolveActiveCdpTarget } = require('./asar-engine');
const { safeReadJsonSync, safeWriteJsonSync } = require('./meter-storage');
const { detectProxyConfig } = require('./meter-proxy');
const { convertZhCNToZhTW } = require('./src/i18n/zh-tw-converter');
const {
  computeCompletedUnreadCount,
  createWebPushManager,
  buildPwaIconPng
} = require('./remote-web-push');

const DEFAULT_REMOTE_PORT = 18765;
const MAX_ACTION_BODY_BYTES = 15 * 1024 * 1024;
const CONFIG_FILE_NAME = 'remote-config.json';
const TUNNEL_STATE_FILE_NAME = '.cloudflared-tunnel-state.json';
const MOBILE_UI_VERSION = '2.1.7';
const PING_GIF_BUFFER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const DEFAULT_REMOTE_DISPLAY_CONFIG = {
  showContextPanel: true,
  showUsagePanel: true,
  showQuotaPill: true,
  showChannelMeta: true,
  showSidebar: true,
  showThinking: true,
  showQuickChips: true,
  showComposerTools: true,
  showApprovals: true
};

function sanitizeRemoteDisplayConfig(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  for (const [k, defVal] of Object.entries(DEFAULT_REMOTE_DISPLAY_CONFIG)) {
    out[k] = typeof src[k] === 'boolean' ? src[k] : defVal;
  }
  return out;
}

const DEFAULT_REMOTE_QUICK_PROMPTS = [
  { id: 'tpl-continue', label: '继续', text: '继续', autoSend: true },
  { id: 'tpl-zh', label: '用中文回答', text: '用中文回答', autoSend: true },
  { id: 'tpl-run', label: '跑一下', text: '跑一下', autoSend: true },
  { id: 'tpl-implement', label: '直接实现', text: '直接实现', autoSend: true },
  { id: 'tpl-fix-err', label: '修复这个报错', text: '修复这个报错：\n', autoSend: false },
  { id: 'tpl-optimize', label: '优化一下', text: '优化一下', autoSend: true }
];

const REMOTE_BUILTIN_POOL_DEFS = [
  { id: 'plan', label: '/plan 规划', text: '/plan ', supportsAutoSend: false },
  { id: 'grill-me', label: '/grill-me 追问', text: '/grill-me ', supportsAutoSend: false },
  { id: 'btw', label: '/btw 旁路提问', text: '/btw ', supportsAutoSend: false },
  { id: 'learn', label: '/learn 沉淀', text: '/learn ', supportsAutoSend: false },
  { id: 'goal', label: '/goal 持续到底', text: '/goal ', supportsAutoSend: false },
  { id: 'boost', label: '/boost 深度攻坚', text: '/boost ', supportsAutoSend: false },
  { id: 'swarm', label: '/swarm 蜂群', text: '/swarm ', supportsAutoSend: false },
  { id: 'teamwork', label: '/teamwork 团队', text: '/teamwork ', supportsAutoSend: false },
  { id: 'browser', label: '/browser 浏览器', text: '/browser ', supportsAutoSend: false },
  { id: 'schedule', label: '/schedule 定时', text: '/schedule ', supportsAutoSend: false },
  { id: 'reload', label: '重载规则', text: '重新读取 AGENTS', supportsAutoSend: true }
];

function buildRemoteQuickPrompts(uiPrefs = null) {
  const rawList = uiPrefs && Array.isArray(uiPrefs.quickPrompts) ? uiPrefs.quickPrompts : null;
  const baseList = [];
  const seenText = new Set();
  if (rawList) {
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (!item || typeof item !== 'object') continue;
      const label = String(item.label ?? '').trim();
      const text = String(item.text ?? '');
      if (!label || !text.trim()) continue;
      const trimmed = text.trim();
      if (trimmed === '/compact' || seenText.has(trimmed)) continue;
      seenText.add(trimmed);
      const rawId = String(item.id || '').trim();
      baseList.push({
        id: rawId && /^[a-zA-Z0-9_-]{1,32}$/.test(rawId) ? rawId : `custom-${i}`,
        label: label.slice(0, 24),
        text: text.slice(0, 2000),
        autoSend: Boolean(item.autoSend)
      });
      if (baseList.length >= 16) break;
    }
  }
  if (!baseList.length) {
    for (const def of DEFAULT_REMOTE_QUICK_PROMPTS) {
      const trimmed = def.text.trim();
      if (!seenText.has(trimmed)) {
        seenText.add(trimmed);
        baseList.push({ ...def });
      }
    }
  }

  const poolObj = uiPrefs && uiPrefs.quickPool && typeof uiPrefs.quickPool === 'object' ? uiPrefs.quickPool : null;
  if (poolObj && baseList.length < 16) {
    const autoSendBuiltin = uiPrefs.quickAutoSendBuiltin !== false;
    for (const p of REMOTE_BUILTIN_POOL_DEFS) {
      if (baseList.length >= 16) break;
      if (poolObj[p.id] !== true) continue;
      const trimmed = p.text.trim();
      if (seenText.has(trimmed)) continue;
      seenText.add(trimmed);
      baseList.push({
        id: p.id,
        label: p.label,
        text: p.text,
        autoSend: Boolean(p.supportsAutoSend && autoSendBuiltin)
      });
    }
  }
  return baseList.slice(0, 16);
}

let cachedRemoteQuickPrompts = null;
let cachedRemoteQuickPromptsAt = 0;

function resolveCachedRemoteQuickPrompts() {
  const now = Date.now();
  if (cachedRemoteQuickPrompts && (now - cachedRemoteQuickPromptsAt) < 2000) {
    return cachedRemoteQuickPrompts;
  }
  let next = DEFAULT_REMOTE_QUICK_PROMPTS;
  try {
    const collector = require('./meter-collector');
    const res = collector && typeof collector.getPluginSettings === 'function'
      ? collector.getPluginSettings()
      : null;
    next = buildRemoteQuickPrompts(res?.uiPreferences || null);
  } catch {
    next = DEFAULT_REMOTE_QUICK_PROMPTS;
  }
  cachedRemoteQuickPrompts = next;
  cachedRemoteQuickPromptsAt = now;
  return next;
}

// ==================== 配置与内网安全校验 ====================

function getRemoteConfigPath() {
  return path.join(getStateDir(), CONFIG_FILE_NAME);
}

function getTunnelStatePath() {
  return path.join(getStateDir(), TUNNEL_STATE_FILE_NAME);
}

function extractCloudflareTunnelToken(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const m = text.match(/\beyJ[A-Za-z0-9+/_-]{8,}=*(?:\.[A-Za-z0-9+/_-]+=*)*/);
  if (!m) return '';
  const matched = m[0];
  if (!matched.includes('.')) {
    const eqMatch = matched.match(/=+$/);
    if (eqMatch && eqMatch[0].length > 2) return '';
    const unpadded = matched.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (unpadded.length % 4 === 1) return '';
    const padLen = (4 - (unpadded.length % 4)) % 4;
    return unpadded + '='.repeat(padLen);
  }
  const parts = matched.split('.');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p)) return '';
  return matched;
}

function decodeBase64JsonObject(seg) {
  const clean = String(seg || '').trim();
  if (!clean) return null;
  const eqMatch = clean.match(/=+$/);
  if (eqMatch && eqMatch[0].length > 2) return null;
  const normalized = clean.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+$/.test(normalized) || normalized.length % 4 === 1) return null;
  const padLen = (4 - (normalized.length % 4)) % 4;
  try {
    const decoded = Buffer.from(normalized + '='.repeat(padLen), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateCloudflareTunnelToken(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    return {
      ok: false,
      token: '',
      error: '请粘贴 Cloudflare Tunnel Token 或 cloudflared service install 命令'
    };
  }
  const token = extractCloudflareTunnelToken(input);
  if (!token) {
    return {
      ok: false,
      token: '',
      error: '未能识别有效的 Cloudflare Tunnel Token（须以 eyJ 开头，或完整粘贴 cloudflared service install 命令）'
    };
  }
  if (!token.includes('.')) {
    const payload = decodeBase64JsonObject(token);
    if (!payload) {
      return {
        ok: false,
        token: '',
        error: 'Cloudflare Tunnel Token 格式损坏（Base64 JSON 解析失败，请检查是否截断或缺少结尾 =）'
      };
    }
    if (
      typeof payload.a !== 'string' || !payload.a.trim()
      || typeof payload.t !== 'string' || !payload.t.trim()
      || typeof payload.s !== 'string' || !payload.s.trim()
    ) {
      return {
        ok: false,
        token: '',
        error: 'Cloudflare Tunnel Token 缺少必要字段 (a/t/s)，请从 Zero Trust 控制台重新复制'
      };
    }
    return { ok: true, token, error: '' };
  }
  const parts = token.split('.');
  if (parts.length < 2 || parts.length > 3) {
    return { ok: false, token: '', error: 'Cloudflare Tunnel Token JWT 结构无效' };
  }
  const header = decodeBase64JsonObject(parts[0]);
  const payload = decodeBase64JsonObject(parts[1]);
  if (!header || !payload) {
    return {
      ok: false,
      token: '',
      error: 'Cloudflare Tunnel Token JWT 解析失败，请检查是否完整复制'
    };
  }
  return { ok: true, token, error: '' };
}

function validateTunnelHostname(raw) {
  let text = String(raw || '').trim();
  if (!text) {
    return {
      ok: false,
      origin: '',
      error: '请填写有效的 Cloudflare HTTPS 固定域名（例如 https://ag.example.com）'
    };
  }
  if (/^http:\/\//i.test(text)) {
    return {
      ok: false,
      origin: '',
      error: '固定域名必须使用 https://（不能使用 http://）；若无自有域名请点击「改用免登录临时隧道」'
    };
  }
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const u = new URL(text);
    const host = String(u.hostname || '').toLowerCase();
    if (u.protocol !== 'https:' || !host || !host.includes('.')) {
      return {
        ok: false,
        origin: '',
        error: '请填写有效的 Cloudflare HTTPS 固定域名（例如 https://ag.example.com）'
      };
    }
    if (host === 'cloudflareaccess.com' || host.endsWith('.cloudflareaccess.com')) {
      return {
        ok: false,
        origin: '',
        error: '*.cloudflareaccess.com 是 Cloudflare Access 登录门户而非隧道公网域名（访问会停在 /#/NoAuth）；请填写隧道 Public Hostname 绑定的自有域名，若无自有域名请点「改用免登录临时隧道」'
      };
    }
    if (host === 'dash.cloudflare.com' || host === 'one.dash.cloudflare.com') {
      return {
        ok: false,
        origin: '',
        error: '请勿填写 Cloudflare 控制台地址；请填写隧道 Public Hostname 绑定的自有域名，或改用免登录临时隧道'
      };
    }
    if (host === 'trycloudflare.com' || host.endsWith('.trycloudflare.com')) {
      return {
        ok: false,
        origin: '',
        error: '*.trycloudflare.com 为临时随机域名，无需手填；请直接点击「改用免登录临时隧道」'
      };
    }
    return { ok: true, origin: u.origin, error: '' };
  } catch {
    return {
      ok: false,
      origin: '',
      error: '请填写有效的 Cloudflare HTTPS 固定域名（例如 https://ag.example.com）'
    };
  }
}

function normalizeTunnelHostname(raw) {
  const res = validateTunnelHostname(raw);
  return res.ok ? res.origin : '';
}

function validateTailscaleCustomHost(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, host: '', error: '' };
  if (/[\s\x00-\x1f\x7f]/.test(text)) {
    return {
      ok: false,
      host: '',
      error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
    };
  }
  let cleanHost = '';
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) {
        return {
          ok: false,
          host: '',
          error: 'Tailscale 节点地址仅填写 IP 或域名（无需附带路径或参数）'
        };
      }
      cleanHost = String(u.hostname || '').replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
    } catch {
      return {
        ok: false,
        host: '',
        error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
      };
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /[\/?#\\@]/.test(text)) {
    return {
      ok: false,
      host: '',
      error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
    };
  } else {
    const bracketMatch = text.match(/^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/);
    if (bracketMatch) {
      if (bracketMatch[2]) {
        const portNum = Number(bracketMatch[2]);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          return {
            ok: false,
            host: '',
            error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
          };
        }
      }
      cleanHost = bracketMatch[1].toLowerCase();
    } else {
      const singlePortMatch = text.match(/^([^:]+):(\d{1,5})$/);
      if (singlePortMatch) {
        const portNum = Number(singlePortMatch[2]);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          return {
            ok: false,
            host: '',
            error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
          };
        }
        cleanHost = singlePortMatch[1].replace(/\.+$/, '').toLowerCase();
      } else {
        cleanHost = text.replace(/\.+$/, '').toLowerCase();
      }
    }
  }

  const isCgnatV4 = isTailscaleCgnatIpv4(cleanHost);
  const v6Hextets = cleanHost.includes(':') ? expandIpv6Hextets(cleanHost) : null;
  const isTsUlaV6 = Boolean(
    v6Hextets && v6Hextets[0] === 0xfd7a && v6Hextets[1] === 0x115c && v6Hextets[2] === 0xa1e0
  );
  const isTsMagicDns = cleanHost.length <= 253
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/i.test(cleanHost);
  if (!isCgnatV4 && !isTsUlaV6 && !isTsMagicDns) {
    return {
      ok: false,
      host: '',
      error: '请填写有效的 Tailscale 节点 IP（100.64.0.0/10）或 MagicDNS 域名（*.ts.net）'
    };
  }
  return { ok: true, host: cleanHost, error: '' };
}

function normalizeTailscaleCustomHost(raw) {
  const res = validateTailscaleCustomHost(raw);
  return res.ok ? res.host : '';
}

function loadOrCreateRemoteConfig(options = {}) {
  const { resetToken = false } = options;
  const cfgPath = getRemoteConfigPath();
  const loaded = safeReadJsonSync(cfgPath, null);
  const existing = (loaded.ok && loaded.data && typeof loaded.data === 'object') ? loaded.data : {};

  const envPort = Number(process.env.AG_REMOTE_PORT);
  const port = (Number.isInteger(envPort) && envPort > 0 && envPort < 65536)
    ? envPort
    : ((Number.isInteger(existing.port) && existing.port > 0 && existing.port < 65536) ? existing.port : DEFAULT_REMOTE_PORT);

  let token = (!resetToken && typeof existing.token === 'string' && existing.token.length >= 24)
    ? existing.token
    : '';
  const rawCh = (existing.enabledChannels && typeof existing.enabledChannels === 'object') ? existing.enabledChannels : {};
  const defaultTunnelOn = typeof existing.tunnelEnabled === 'boolean'
    ? existing.tunnelEnabled
    : true;
  const tunnelEnabled = typeof rawCh.tunnel === 'boolean' ? rawCh.tunnel : defaultTunnelOn;
  const enabledChannels = {
    lan: typeof rawCh.lan === 'boolean' ? rawCh.lan : true,
    tailscale: typeof rawCh.tailscale === 'boolean' ? rawCh.tailscale : true,
    bonjour: typeof rawCh.bonjour === 'boolean' ? rawCh.bonjour : true,
    tunnel: tunnelEnabled
  };
  const tunnelMode = existing.tunnelMode === 'named' ? 'named' : 'quick';
  const tunnelToken = typeof existing.tunnelToken === 'string'
    ? extractCloudflareTunnelToken(existing.tunnelToken)
    : '';
  const tunnelHostname = normalizeTunnelHostname(existing.tunnelHostname || '');
  const tailscaleCustomHost = normalizeTailscaleCustomHost(existing.tailscaleCustomHost || '');
  const remoteDisplay = sanitizeRemoteDisplayConfig(existing.remoteDisplay);

  let changed = !loaded.ok || !existing.token || resetToken || existing.port !== port;

  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    changed = true;
  }

  const next = {
    ...existing,
    port,
    token,
    tunnelEnabled,
    enabledChannels,
    tunnelMode,
    tunnelToken,
    tunnelHostname,
    tailscaleCustomHost,
    remoteDisplay,
    updatedAt: changed ? new Date().toISOString() : (existing.updatedAt || new Date().toISOString())
  };

  if (changed) {
    safeWriteJsonSync(cfgPath, next, {
      indent: 2,
      validate: (d) => d && typeof d.token === 'string' && d.token.length >= 24
    });
    try {
      fs.chmodSync(cfgPath, 0o600);
    } catch {}
  }

  return next;
}

// ==================== 已关联远程设备追踪（内存级，随 Token 隔离） ====================

const DEVICE_ONLINE_TTL_MS = 15000;
const MAX_PAIRED_DEVICES = 50;
const MAX_CLIENT_SESSIONS = 128;
const CLIENT_SESSION_TTL_MS = 24 * 3600 * 1000;
let trackedDeviceToken = '';
const pairedDevicesMap = new Map();
const remoteClientSessions = new Map();
let actionQueueTail = Promise.resolve();

function enqueueRemoteAction(task) {
  const next = actionQueueTail.then(task, task);
  actionQueueTail = next.catch(() => {});
  return next;
}

function syncTrackedDeviceToken(activeToken) {
  const clean = String(activeToken || '');
  if (clean && clean !== trackedDeviceToken) {
    pairedDevicesMap.clear();
    remoteClientSessions.clear();
    trackedDeviceToken = clean;
  }
}

function extractRequestClientId(req, urlObj = null, body = null) {
  const raw = String(
    req?.headers?.['x-ag-client-id']
    || urlObj?.searchParams?.get('clientId')
    || body?.clientId
    || ''
  ).trim().slice(0, 64);
  return /^[A-Za-z0-9._:-]{4,64}$/.test(raw) ? raw : '';
}

function getOrCreateClientSession(clientId, activeToken, now = Date.now()) {
  const cleanId = String(clientId || '').trim();
  if (!/^[A-Za-z0-9._:-]{4,64}$/.test(cleanId)) return null;
  syncTrackedDeviceToken(activeToken);
  if (remoteClientSessions.has(cleanId)) {
    const existing = remoteClientSessions.get(cleanId);
    existing.lastSeenAt = now;
    return existing;
  }
  for (const [k, s] of Array.from(remoteClientSessions.entries())) {
    if (!s || (now - (s.lastSeenAt || 0)) > CLIENT_SESSION_TTL_MS) {
      remoteClientSessions.delete(k);
    }
  }
  while (remoteClientSessions.size >= MAX_CLIENT_SESSIONS) {
    let oldestKey = null;
    let oldestSeen = Infinity;
    for (const [k, s] of remoteClientSessions.entries()) {
      if ((s?.lastSeenAt || 0) < oldestSeen) {
        oldestSeen = s?.lastSeenAt || 0;
        oldestKey = k;
      }
    }
    if (!oldestKey) break;
    remoteClientSessions.delete(oldestKey);
  }
  const created = {
    clientId: cleanId,
    conversationId: '',
    targetId: '',
    createdAt: now,
    lastSeenAt: now
  };
  remoteClientSessions.set(cleanId, created);
  return created;
}

function getRemoteClientSession(clientId) {
  const cleanId = String(clientId || '').trim();
  const s = remoteClientSessions.get(cleanId);
  return s ? { ...s } : null;
}

function clearRemoteClientSessionsForTests() {
  remoteClientSessions.clear();
}

function parseDeviceLabel(rawUa, rawHint) {
  const hint = String(rawHint || '').trim();
  if (/^iPad$/i.test(hint)) return 'iPad';
  if (/^iPhone$/i.test(hint)) return 'iPhone';
  const ua = String(rawUa || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows NT/i.test(ua)) return 'Windows';
  return '移动设备';
}

function recordPairedDeviceAccess(req, activeToken, now = Date.now(), activeTunnelUrl = '') {
  if (!req) return null;
  syncTrackedDeviceToken(activeToken);
  const headers = req.headers || {};
  let urlParams = null;
  if (typeof req.url === 'string' && req.url.includes('?')) {
    try {
      urlParams = new URL(req.url, 'http://localhost').searchParams;
    } catch {}
  }
  const queryProbe = urlParams?.get('probe') || '';
  if (queryProbe === '1' || String(headers['x-ag-probe'] || '').trim() === '1') {
    return null;
  }

  const rawDevId = String(headers['x-ag-device-id'] || urlParams?.get('did') || '').trim().slice(0, 64);
  const headerDevId = /^[A-Za-z0-9._:-]{4,64}$/.test(rawDevId) ? rawDevId : '';
  const rawFp = String(headers['x-ag-device-fp'] || urlParams?.get('fp') || '').trim().slice(0, 64);
  const deviceFp = /^[A-Za-z0-9._x@-]{4,64}$/.test(rawFp) ? rawFp : '';
  const deviceHint = String(headers['x-ag-device-hint'] || urlParams?.get('hint') || '').trim().slice(0, 24);
  const ua = String(headers['user-agent'] || '').trim();
  const label = parseDeviceLabel(ua, deviceHint);
  const cleanIp = normalizeRemoteIp(req.socket?.remoteAddress || req.ip || '');

  // 过滤本机非浏览器健康检查或 CLI 脚本探测，避免误计为关联设备（Cloudflare 隧道透传请求除外）
  const reqCh = detectRequestChannel(req, activeTunnelUrl);
  if (!headerDevId && reqCh === 'loopback' && !/Mozilla\/|Mobile|Safari|Chrome|Firefox/i.test(ua)) {
    return null;
  }

  const localHostIps = getLocalHostIpSet();
  const tsProxyIp = extractTailscaleProxyClientIp(req, reqCh, localHostIps);
  const isSelfIp = Boolean(cleanIp && localHostIps.has(cleanIp));
  const fallbackId = 'ua-' + crypto.createHash('sha1').update(`${cleanIp}|${ua}`).digest('hex').slice(0, 12);
  let finalId = headerDevId || fallbackId;
  let prev = pairedDevicesMap.get(finalId) || null;
  let earliestFirstSeen = prev?.firstSeenAt || now;
  let mergedFp = deviceFp || prev?.fp || '';
  const prevLanIp = (prev?.lastLanIp && !localHostIps.has(prev.lastLanIp)) ? prev.lastLanIp : '';
  const prevTsIp = (prev?.lastTailscaleIp && !localHostIps.has(prev.lastTailscaleIp)) ? prev.lastTailscaleIp : '';
  const freshLanHit = reqCh === 'lan' && !isSelfIp && isRfc1918Ipv4(cleanIp);
  const freshTsHit = Boolean(tsProxyIp) || (reqCh === 'tailscale' && !isSelfIp && isTailscaleCgnatIpv4(cleanIp));
  let lastLanIp = freshLanHit ? cleanIp : prevLanIp;
  let lastLanSeenAt = freshLanHit ? now : (prev?.lastLanSeenAt || 0);
  let lastTailscaleIp = tsProxyIp || (freshTsHit ? cleanIp : prevTsIp);
  let lastTailscaleSeenAt = freshTsHit ? now : (prev?.lastTailscaleSeenAt || 0);

  if (headerDevId && pairedDevicesMap.has(fallbackId)) {
    const fallbackEntry = pairedDevicesMap.get(fallbackId);
    if (fallbackEntry) {
      earliestFirstSeen = Math.min(earliestFirstSeen, fallbackEntry.firstSeenAt || now);
      if (!mergedFp && fallbackEntry.fp) mergedFp = fallbackEntry.fp;
      if (!lastLanIp && fallbackEntry.lastLanIp && !localHostIps.has(fallbackEntry.lastLanIp)) {
        lastLanIp = fallbackEntry.lastLanIp;
      }
      if ((fallbackEntry.lastLanSeenAt || 0) > lastLanSeenAt) lastLanSeenAt = fallbackEntry.lastLanSeenAt || 0;
      if (!lastTailscaleIp && fallbackEntry.lastTailscaleIp && !localHostIps.has(fallbackEntry.lastTailscaleIp)) {
        lastTailscaleIp = fallbackEntry.lastTailscaleIp;
      }
      if ((fallbackEntry.lastTailscaleSeenAt || 0) > lastTailscaleSeenAt) lastTailscaleSeenAt = fallbackEntry.lastTailscaleSeenAt || 0;
      if (!prev) prev = fallbackEntry;
    }
    pairedDevicesMap.delete(fallbackId);
  }

  // 同一物理设备跨通道（如 Cloudflare <-> Tailscale <-> LAN）或跨源切换时自动去重合并
  for (const [k, v] of Array.from(pairedDevicesMap.entries())) {
    if (k === finalId || !v) continue;
    if (v.label !== label || !ua || v.ua !== ua) continue;
    const fpCompatible = (mergedFp && v.fp) ? (mergedFp === v.fp) : true;
    if (!fpCompatible) continue;
    const exactFpMatch = Boolean(mergedFp && v.fp && mergedFp === v.fp);
    const matchesInitialNav = k.startsWith('ua-') || !headerDevId;
    const switchedInactiveChannel = v.channel !== reqCh && (now - (v.lastSeenAt || 0)) > 2500;
    if (!exactFpMatch && !matchesInitialNav && !switchedInactiveChannel) continue;

    earliestFirstSeen = Math.min(earliestFirstSeen, v.firstSeenAt || now);
    if (!mergedFp && v.fp) mergedFp = v.fp;
    if (!lastLanIp && v.lastLanIp && !localHostIps.has(v.lastLanIp)) lastLanIp = v.lastLanIp;
    if ((v.lastLanSeenAt || 0) > lastLanSeenAt) lastLanSeenAt = v.lastLanSeenAt || 0;
    if (!lastTailscaleIp && v.lastTailscaleIp && !localHostIps.has(v.lastTailscaleIp)) lastTailscaleIp = v.lastTailscaleIp;
    if ((v.lastTailscaleSeenAt || 0) > lastTailscaleSeenAt) lastTailscaleSeenAt = v.lastTailscaleSeenAt || 0;
    if (!headerDevId && !k.startsWith('ua-')) {
      finalId = k;
      prev = v;
    } else {
      if (!prev) prev = v;
      pairedDevicesMap.delete(k);
    }
  }

  if (finalId !== fallbackId && pairedDevicesMap.has(fallbackId)) {
    const fb = pairedDevicesMap.get(fallbackId);
    if (fb && fb.label === label && ua && fb.ua === ua) {
      earliestFirstSeen = Math.min(earliestFirstSeen, fb.firstSeenAt || now);
      if (!mergedFp && fb.fp) mergedFp = fb.fp;
      if (!lastLanIp && fb.lastLanIp && !localHostIps.has(fb.lastLanIp)) lastLanIp = fb.lastLanIp;
      if ((fb.lastLanSeenAt || 0) > lastLanSeenAt) lastLanSeenAt = fb.lastLanSeenAt || 0;
      if (!lastTailscaleIp && fb.lastTailscaleIp && !localHostIps.has(fb.lastTailscaleIp)) lastTailscaleIp = fb.lastTailscaleIp;
      if ((fb.lastTailscaleSeenAt || 0) > lastTailscaleSeenAt) lastTailscaleSeenAt = fb.lastTailscaleSeenAt || 0;
      pairedDevicesMap.delete(fallbackId);
    }
  }

  const record = {
    id: finalId,
    label,
    channel: reqCh,
    ip: cleanIp,
    ua,
    fp: mergedFp,
    lastLanIp,
    lastLanSeenAt,
    lastTailscaleIp,
    lastTailscaleSeenAt,
    firstSeenAt: earliestFirstSeen,
    lastSeenAt: now
  };
  pairedDevicesMap.set(finalId, record);

  if (pairedDevicesMap.size > MAX_PAIRED_DEVICES) {
    let oldestKey = null;
    let oldestSeen = Infinity;
    for (const [k, v] of pairedDevicesMap.entries()) {
      if ((v?.lastSeenAt || 0) < oldestSeen) {
        oldestSeen = v?.lastSeenAt || 0;
        oldestKey = k;
      }
    }
    if (oldestKey) pairedDevicesMap.delete(oldestKey);
  }
  return record;
}

function getPairedDevicesSummary(activeToken, now = Date.now()) {
  syncTrackedDeviceToken(activeToken);
  const devices = Array.from(pairedDevicesMap.values())
    .sort((a, b) => (b.lastSeenAt - a.lastSeenAt))
    .map((d) => ({
      id: d.id,
      label: d.label,
      channel: d.channel,
      ip: d.ip,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      online: (now - d.lastSeenAt) <= DEVICE_ONLINE_TTL_MS
    }));
  const onlineCount = devices.filter((d) => d.online).length;
  return {
    pairedCount: devices.length,
    onlineCount,
    devices
  };
}

function saveRemoteTunnelConfig(patch = {}) {
  const cur = loadOrCreateRemoteConfig();
  const patchCh = (patch.enabledChannels && typeof patch.enabledChannels === 'object') ? patch.enabledChannels : {};
  const nextTunnelEnabled = patch.enabled !== undefined
    ? Boolean(patch.enabled)
    : (patch.tunnelEnabled !== undefined
        ? Boolean(patch.tunnelEnabled)
        : (typeof patchCh.tunnel === 'boolean' ? patchCh.tunnel : cur.tunnelEnabled));
  const nextEnabledChannels = {
    lan: typeof patchCh.lan === 'boolean' ? patchCh.lan : cur.enabledChannels.lan,
    tailscale: typeof patchCh.tailscale === 'boolean' ? patchCh.tailscale : cur.enabledChannels.tailscale,
    bonjour: typeof patchCh.bonjour === 'boolean' ? patchCh.bonjour : cur.enabledChannels.bonjour,
    tunnel: nextTunnelEnabled
  };
  const nextModeRaw = patch.tunnelMode !== undefined ? patch.tunnelMode : cur.tunnelMode;
  const nextMode = nextModeRaw === 'named' ? 'named' : 'quick';
  const nextToken = patch.tunnelToken !== undefined
    ? extractCloudflareTunnelToken(patch.tunnelToken)
    : cur.tunnelToken;
  const nextHost = patch.tunnelHostname !== undefined
    ? normalizeTunnelHostname(patch.tunnelHostname)
    : cur.tunnelHostname;
  const nextTailscaleCustomHost = patch.tailscaleCustomHost !== undefined
    ? normalizeTailscaleCustomHost(patch.tailscaleCustomHost)
    : normalizeTailscaleCustomHost(cur.tailscaleCustomHost || '');
  const rawDisplay = patch.remoteDisplay !== undefined
    ? patch.remoteDisplay
    : (patch.displayConfig !== undefined ? patch.displayConfig : null);
  const nextRemoteDisplay = rawDisplay && typeof rawDisplay === 'object'
    ? sanitizeRemoteDisplayConfig({ ...(cur.remoteDisplay || DEFAULT_REMOTE_DISPLAY_CONFIG), ...rawDisplay })
    : sanitizeRemoteDisplayConfig(cur.remoteDisplay);

  const next = {
    ...cur,
    tunnelEnabled: nextTunnelEnabled,
    enabledChannels: nextEnabledChannels,
    tunnelMode: nextMode,
    tunnelToken: nextToken,
    tunnelHostname: nextHost,
    tailscaleCustomHost: nextTailscaleCustomHost,
    remoteDisplay: nextRemoteDisplay,
    updatedAt: new Date().toISOString()
  };

  const cfgPath = getRemoteConfigPath();
  safeWriteJsonSync(cfgPath, next, {
    indent: 2,
    validate: (d) => d && typeof d.token === 'string' && d.token.length >= 24
  });
  try {
    fs.chmodSync(cfgPath, 0o600);
  } catch {}
  return next;
}

function normalizeRemoteIp(rawAddr) {
  let ip = String(rawAddr || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  return ip.toLowerCase();
}

function parseIpv4Parts(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

function ipv4ToInt(ip) {
  const p = parseIpv4Parts(String(ip || ''));
  if (!p) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function getLocalHostIpSet(netsMap = os.networkInterfaces()) {
  const set = new Set(['127.0.0.1', '::1']);
  for (const entries of Object.values(netsMap || {})) {
    for (const info of entries || []) {
      if (!info || !info.address) continue;
      const clean = normalizeRemoteIp(info.address);
      if (clean) set.add(clean);
    }
  }
  return set;
}

function isIpInLocalPhysicalLanSubnet(ip, netsMap = os.networkInterfaces()) {
  const targetInt = ipv4ToInt(ip);
  if (targetInt === null) return false;
  for (const [ifName, entries] of Object.entries(netsMap || {})) {
    if (isVirtualBridgeIface(ifName)) continue;
    for (const info of entries || []) {
      if (!info || info.internal || info.family !== 'IPv4') continue;
      if (!isRfc1918Ipv4(info.address) || !info.netmask) continue;
      if (String(info.address) === String(ip)) continue;
      const addrInt = ipv4ToInt(info.address);
      const maskInt = ipv4ToInt(info.netmask);
      if (addrInt === null || maskInt === null || maskInt === 0) continue;
      if ((addrInt & maskInt) === (targetInt & maskInt)) return true;
    }
  }
  return false;
}

function expandIpv6Hextets(rawIp) {
  let clean = String(rawIp || '').trim();
  if (!clean) return null;
  if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx >= 0) clean = clean.slice(0, zoneIdx);
  if (!clean || clean.includes('.') || !/^[0-9a-fA-F:]+$/.test(clean)) return null;
  const parts = clean.split('::');
  if (parts.length > 2) return null;
  let hextets = [];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    if (left.some((s) => !s || s.length > 4) || right.some((s) => !s || s.length > 4)) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    hextets = [...left, ...new Array(missing).fill('0'), ...right];
  } else {
    const segs = clean.split(':');
    if (segs.length !== 8 || segs.some((s) => !s || s.length > 4)) return null;
    hextets = segs;
  }
  const nums = [];
  for (const h of hextets) {
    const v = parseInt(h, 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) return null;
    nums.push(v);
  }
  return nums.length === 8 ? nums : null;
}

function isIpv6InLocalPhysicalLanPrefix(ip, netsMap = os.networkInterfaces()) {
  const target = expandIpv6Hextets(ip);
  if (!target) return false;
  if (target.slice(0, 7).every((x) => x === 0) && target[7] <= 1) return false;
  if ((target[0] & 0xffc0) === 0xfe80) return true;
  for (const [ifName, entries] of Object.entries(netsMap || {})) {
    if (isVirtualBridgeIface(ifName)) continue;
    for (const info of entries || []) {
      const fam = String(info?.family || '').toUpperCase();
      if (!info || info.internal || (fam !== 'IPV6' && info.family !== 6)) continue;
      const selfH = expandIpv6Hextets(info.address);
      if (!selfH) continue;
      if ((selfH[0] & 0xffc0) === 0xfe80) continue;
      if (selfH.every((v, idx) => v === target[idx])) continue;
      if (
        selfH[0] === target[0]
        && selfH[1] === target[1]
        && selfH[2] === target[2]
        && selfH[3] === target[3]
      ) {
        return true;
      }
    }
  }
  return false;
}

function extractTailscaleProxyClientIp(req, reqCh, localHostIps = new Set()) {
  if (reqCh !== 'tailscale' || !req) return '';
  const headers = req.headers || {};
  const sockIp = normalizeRemoteIp(req.socket?.remoteAddress || req.ip || '');
  if (!sockIp || !isLoopbackIp(sockIp)) return '';
  const xffRaw = Array.isArray(headers['x-forwarded-for'])
    ? headers['x-forwarded-for'].join(',')
    : String(headers['x-forwarded-for'] || '');
  const xriRaw = Array.isArray(headers['x-real-ip'])
    ? headers['x-real-ip'].join(',')
    : String(headers['x-real-ip'] || '');
  const candidates = [];
  for (const rawPart of xffRaw.split(',')) {
    if (rawPart && rawPart.trim()) candidates.push(rawPart.trim());
  }
  for (const rawPart of xriRaw.split(',')) {
    if (rawPart && rawPart.trim()) candidates.push(rawPart.trim());
  }
  for (const rawIp of candidates) {
    const clean = normalizeRemoteIp(rawIp);
    if (clean && isTailscaleCgnatIpv4(clean) && !localHostIps.has(clean)) {
      return clean;
    }
  }
  return '';
}

function isTailscaleCgnatIpv4(ip) {
  const p = parseIpv4Parts(ip);
  return Boolean(p && p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

function isRfc1918Ipv4(ip) {
  const p = parseIpv4Parts(ip);
  if (!p) return false;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  return false;
}

function isAllowedPrivateAddress(rawAddr) {
  const ip = normalizeRemoteIp(rawAddr);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const p = parseIpv4Parts(ip);
  if (p) {
    if (p[0] === 127) return true;
    if (isRfc1918Ipv4(ip)) return true;
    if (isTailscaleCgnatIpv4(ip)) return true;
    return false;
  }
  // 链路本地 fe80::/10 与 ULA fc00::/7 (包含 Tailscale IPv6 fd7a:...)
  if (/^fe[89ab][0-9a-f]:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

function parseHostHeaderHostname(rawHost) {
  const text = String(rawHost || '').trim();
  if (!text) return '';
  try {
    return new URL(`http://${text}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return text.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  }
}

function isTailscaleIp(rawAddr) {
  const ip = normalizeRemoteIp(rawAddr);
  if (!ip) return false;
  return isTailscaleCgnatIpv4(ip) || /^fd7a:115c:a1e0:/i.test(ip);
}

function isLoopbackIp(rawAddr) {
  const ip = normalizeRemoteIp(rawAddr);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const p = parseIpv4Parts(ip);
  return Boolean(p && p[0] === 127);
}

function detectRequestChannel(reqOrIp, hostOrTunnelUrl = '', maybeTunnelUrl = '') {
  const isStringCall = typeof reqOrIp === 'string';
  const headers = (!isStringCall && reqOrIp && reqOrIp.headers) ? reqOrIp.headers : {};
  const remoteIp = normalizeRemoteIp(isStringCall ? reqOrIp : (reqOrIp?.socket?.remoteAddress || reqOrIp?.ip || ''));
  const localIp = isStringCall ? '' : normalizeRemoteIp(reqOrIp?.socket?.localAddress || '');
  const hostName = parseHostHeaderHostname(isStringCall ? hostOrTunnelUrl : (headers.host || ''));
  const activeTunnelUrl = isStringCall ? maybeTunnelUrl : hostOrTunnelUrl;
  let activeTunnelHost = '';
  if (activeTunnelUrl) {
    try { activeTunnelHost = new URL(activeTunnelUrl).hostname.toLowerCase(); } catch {}
  }
  if (
    (!remoteIp || isLoopbackIp(remoteIp))
    && (
      headers['cf-connecting-ip']
      || headers['cf-ray']
      || hostName.endsWith('.trycloudflare.com')
      || (activeTunnelHost && hostName === activeTunnelHost)
    )
  ) {
    return 'tunnel';
  }
  if (hostName.endsWith('.local')) {
    return 'bonjour';
  }
  if (
    hostName.endsWith('.ts.net')
    || isTailscaleIp(hostName)
    || isTailscaleIp(remoteIp)
    || isTailscaleIp(localIp)
  ) {
    return 'tailscale';
  }
  if (isLoopbackIp(remoteIp) && (!hostName || hostName === 'localhost' || isLoopbackIp(hostName))) {
    return 'loopback';
  }
  return 'lan';
}

const isVirtualBridgeIface = (name) => /^(?:bridge|vmenet|vmnet|vboxnet|docker|br-|veth|awdl|llw|utun)/i.test(String(name || ''));

function enumerateLocalAddresses() {
  const nets = os.networkInterfaces();
  const tailscale = [];
  const lan = [];
  const tailscaleIpv6 = [];
  const seen = new Set();

  for (const [ifName, entries] of Object.entries(nets)) {
    for (const info of entries || []) {
      if (!info || info.internal) continue;
      const addr = String(info.address || '').trim();
      if (!addr) continue;
      if (info.family === 'IPv6') {
        const cleanV6 = normalizeRemoteIp(addr);
        if (/^fd7a:115c:a1e0:/i.test(cleanV6) && !seen.has(cleanV6)) {
          seen.add(cleanV6);
          tailscaleIpv6.push(cleanV6);
        }
        continue;
      }
      if (info.family !== 'IPv4' || seen.has(addr)) continue;
      seen.add(addr);

      if (isTailscaleCgnatIpv4(addr)) {
        tailscale.push({ iface: ifName, address: addr, kind: 'tailscale' });
      } else if (isRfc1918Ipv4(addr)) {
        lan.push({ iface: ifName, address: addr, kind: 'lan' });
      }
    }
  }

  // 物理网卡 (en0 / en* / eth* / wlan*) 排在虚拟网桥 (bridge100 等) 之前
  lan.sort((a, b) => {
    const score = (x) => {
      if (isVirtualBridgeIface(x.iface)) return 3;
      if (x.iface === 'en0') return 0;
      if (/^(?:en|eth|wlan|wi-fi)/i.test(x.iface)) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  const physicalLan = lan.filter((x) => !isVirtualBridgeIface(x.iface));
  const bindIps = ['127.0.0.1', '::1', ...tailscale.map((x) => x.address), ...lan.map((x) => x.address), ...tailscaleIpv6];
  return { tailscale, lan, physicalLan, tailscaleIpv6, bindIps };
}

let cachedHostMeta = null;
let cachedHostMetaAt = 0;

function detectHostIdentityMeta(options = {}) {
  const force = Boolean(options?.force || options?.forceRefresh || typeof options?.execFileSync === 'function');
  const now = Date.now();
  if (!force && cachedHostMeta && now - cachedHostMetaAt < 45000) {
    return cachedHostMeta;
  }

  const skipProbes = process.env.AG_REMOTE_SKIP_PROBES === '1';
  let localHostLabel = '';
  if (!skipProbes && process.platform === 'darwin') {
    try {
      localHostLabel = execFileSync('scutil', ['--get', 'LocalHostName'], {
        timeout: 500,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {}
  }
  if (!localHostLabel) {
    localHostLabel = String(os.hostname() || '').trim();
  }
  localHostLabel = localHostLabel.replace(/\.+$/, '').replace(/\.local$/i, '').trim();
  const bonjourHost = localHostLabel ? `${localHostLabel}.local` : '';

  let tailscaleDnsName = '';
  let tailscaleNodeName = '';
  let tailscaleHttpsCapable = false;
  let tailscaleBin = '';
  let tailscaleRunning = false;
  let tailscaleBackendState = '';
  const execFn = typeof options.execFileSync === 'function' ? options.execFileSync : execFileSync;
  if (!skipProbes || typeof options.execFileSync === 'function') {
    const tsBins = process.platform === 'darwin'
      ? ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale']
      : ['tailscale'];
    for (const bin of tsBins) {
      try {
        const out = execFn(bin, ['status', '--json'], {
          timeout: 800,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        const parsed = JSON.parse(out);
        tailscaleBackendState = String(parsed?.BackendState || '').trim();
        const selfOnline = parsed?.Self?.Online;
        const isRunning = (!tailscaleBackendState || tailscaleBackendState === 'Running') && selfOnline !== false;
        tailscaleBin = bin;
        if (isRunning) {
          const dns = String(parsed?.Self?.DNSName || '').trim().replace(/\.+$/, '');
          const hostName = String(parsed?.Self?.HostName || '').trim();
          const certDomains = Array.isArray(parsed?.CertDomains)
            ? parsed.CertDomains.map((d) => String(d || '').trim().replace(/\.+$/, '').toLowerCase()).filter(Boolean)
            : [];
          if (dns) tailscaleDnsName = dns;
          if (dns) tailscaleNodeName = dns.split('.')[0] || hostName;
          else if (hostName) tailscaleNodeName = hostName;
          tailscaleHttpsCapable = Boolean(tailscaleDnsName && certDomains.includes(tailscaleDnsName.toLowerCase()));
          tailscaleRunning = true;
        }
        break;
      } catch {}
    }
  }

  const deviceName = tailscaleNodeName || localHostLabel || 'antigravity-mac';
  const result = {
    localHostLabel,
    bonjourHost,
    tailscaleDnsName,
    tailscaleNodeName,
    tailscaleHttpsCapable,
    tailscaleRunning,
    tailscaleBackendState,
    tailscaleBin,
    deviceName
  };
  if (typeof options.execFileSync !== 'function') {
    cachedHostMeta = result;
    cachedHostMetaAt = now;
  }
  return result;
}

let cachedTailscaleServe = { active: false, port: 0, url: '', hint: '', createdByUs: false, checkedAt: 0 };

function inspectTailscaleServe443Target(rawJson, numPort) {
  if (!rawJson || typeof rawJson !== 'string') {
    return { parsed: false, occupiedBySelf: false, occupiedByOther: false, existingProxy: '' };
  }
  let obj;
  try {
    obj = JSON.parse(rawJson);
  } catch {
    return { parsed: false, occupiedBySelf: false, occupiedByOther: false, existingProxy: '' };
  }
  if (!obj || typeof obj !== 'object') {
    return { parsed: false, occupiedBySelf: false, occupiedByOther: false, existingProxy: '' };
  }
  const webMap = (obj.Web && typeof obj.Web === 'object') ? obj.Web : {};
  const matchesSelfPort = (proxyStr) => {
    const s = String(proxyStr || '').trim();
    if (!s) return false;
    return new RegExp(`^https?://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${numPort}(?:/|$)`, 'i').test(s);
  };
  let occupiedBySelf = false;
  let existingProxy = '';
  for (const [hostPort, cfg] of Object.entries(webMap)) {
    if (!/:443$/i.test(hostPort) && hostPort !== '443') continue;
    const handlers = cfg?.Handlers;
    if (!handlers || typeof handlers !== 'object') continue;
    for (const [mountPath, handlerObj] of Object.entries(handlers)) {
      const proxyTarget = String(handlerObj?.Proxy || handlerObj?.proxy || '').trim();
      if (!proxyTarget) continue;
      if (mountPath === '/' || mountPath === '') {
        if (matchesSelfPort(proxyTarget)) occupiedBySelf = true;
        else if (!existingProxy) existingProxy = proxyTarget;
      }
    }
  }
  const tcp443 = obj.TCP?.['443'];
  if (!occupiedBySelf && !existingProxy && tcp443 && tcp443.TCPForward) {
    const fwd = String(tcp443.TCPForward || '').trim();
    if (fwd) {
      if (fwd.endsWith(`:${numPort}`)) occupiedBySelf = true;
      else existingProxy = fwd;
    }
  }
  return {
    parsed: true,
    occupiedBySelf,
    occupiedByOther: Boolean(existingProxy && !occupiedBySelf),
    existingProxy
  };
}

function cleanupTailscaleServeHttps(port, options = {}) {
  const numPort = Number(port) || DEFAULT_REMOTE_PORT;
  const bin = String(options.tailscaleBin || detectHostIdentityMeta().tailscaleBin || 'tailscale');
  const execFn = typeof options.execFileSync === 'function' ? options.execFileSync : execFileSync;
  try {
    const statusRaw = execFn(bin, ['serve', 'status', '--json'], {
      timeout: 1500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const inspected = inspectTailscaleServe443Target(statusRaw, numPort);
    if (!inspected.parsed || !inspected.occupiedBySelf) return false;
    execFn(bin, ['serve', '--https=443', 'off'], {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (cachedTailscaleServe.port === numPort) {
      cachedTailscaleServe = { active: false, port: 0, url: '', hint: '', createdByUs: false, checkedAt: 0 };
    }
    return true;
  } catch {
    return false;
  }
}

function ensureTailscaleServeHttps(port, options = {}) {
  const numPort = Number(port) || DEFAULT_REMOTE_PORT;
  const now = Date.now();
  const useCustomExec = typeof options.execFileSync === 'function';
  const readOnly = options.readOnly === true;
  if (!useCustomExec && !options.force && cachedTailscaleServe.port === numPort && (now - cachedTailscaleServe.checkedAt < 60000)) {
    return {
      enabled: Boolean(cachedTailscaleServe.active && cachedTailscaleServe.url),
      url: cachedTailscaleServe.url,
      hint: cachedTailscaleServe.hint,
      createdByUs: Boolean(cachedTailscaleServe.createdByUs)
    };
  }
  const meta = options.hostMeta || detectHostIdentityMeta({
    forceRefresh: Boolean(options.force || useCustomExec),
    execFileSync: options.execFileSync
  });
  if (!meta.tailscaleDnsName || meta.tailscaleRunning === false) {
    const empty = { active: false, port: numPort, url: '', hint: '', createdByUs: false, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = empty;
    return { enabled: false, url: '', hint: '', createdByUs: false };
  }
  if (!meta.tailscaleHttpsCapable) {
    const hint = `在 Tailscale 控制台 DNS 页开启 HTTPS Certificates 后即可使用安全地址 https://${meta.tailscaleDnsName}`;
    const res = { active: false, port: numPort, url: '', hint, createdByUs: false, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = res;
    return { enabled: false, url: '', hint, createdByUs: false };
  }
  const bin = meta.tailscaleBin || 'tailscale';
  const execFn = useCustomExec ? options.execFileSync : execFileSync;
  const targetUrl = `https://${meta.tailscaleDnsName}`;
  let inspected = { parsed: false, occupiedBySelf: false, occupiedByOther: false, existingProxy: '' };
  try {
    const statusRaw = execFn(bin, ['serve', 'status', '--json'], {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    inspected = inspectTailscaleServe443Target(statusRaw, numPort);
  } catch {}
  if (inspected.parsed && inspected.occupiedBySelf) {
    const selfState = { active: true, port: numPort, url: targetUrl, hint: '', createdByUs: false, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = selfState;
    return { enabled: true, url: targetUrl, hint: '', createdByUs: false, alreadyConfigured: true };
  }
  if (inspected.parsed && inspected.occupiedByOther) {
    const hint = `检测到 Tailscale HTTPS 443 端口已被其他服务 (${inspected.existingProxy}) 占用，为避免覆盖现有服务已跳过自动托管`;
    const conflictState = { active: false, port: numPort, url: '', hint, createdByUs: false, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = conflictState;
    return { enabled: false, url: '', hint, createdByUs: false, conflict: true };
  }
  if (readOnly) {
    return { enabled: false, url: '', hint: '', createdByUs: false };
  }
  try {
    execFn(bin, ['serve', '--bg', String(numPort)], {
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const okState = { active: true, port: numPort, url: targetUrl, hint: '', createdByUs: true, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = okState;
    return { enabled: true, url: targetUrl, hint: '', createdByUs: true };
  } catch {
    const hint = `请在 Tailscale 控制台开启 HTTPS Certificates 或运行 tailscale serve --bg ${numPort}`;
    const errState = { active: false, port: numPort, url: '', hint, createdByUs: false, checkedAt: now };
    if (!useCustomExec) cachedTailscaleServe = errState;
    return { enabled: false, url: '', hint, createdByUs: false };
  }
}

function encodeEndpointsParam(endpoints) {
  const compact = (Array.isArray(endpoints) ? endpoints : [])
    .filter((ep) => ep && typeof ep.url === 'string' && /^https?:\/\//i.test(ep.url))
    .map(({ url, kind, priority }) => ({
      url,
      kind: String(kind || 'lan'),
      priority: Number.isFinite(Number(priority)) ? Number(priority) : 100
    }));
  return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function decodeEndpointsParam(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((ep) => ep && typeof ep.url === 'string' && /^https?:\/\//i.test(ep.url))
      .map((ep) => ({
        url: String(ep.url),
        kind: String(ep.kind || 'lan'),
        priority: Number.isFinite(Number(ep.priority)) ? Number(ep.priority) : 100
      }));
  } catch {
    return [];
  }
}

function formatHostForUrl(host) {
  const clean = String(host || '').trim();
  if (!clean) return '127.0.0.1';
  if (clean.includes(':') && !clean.startsWith('[')) return `[${clean}]`;
  return clean;
}

function buildFusedPairingUrl({ entryBaseUrl, entryHost, port, token, name, hosts, endpoints }) {
  let cleanBase = '';
  let authority = '';
  if (entryBaseUrl) {
    try {
      const u = new URL(String(entryBaseUrl));
      cleanBase = `${u.protocol}//${u.host}`;
      authority = u.host;
    } catch {}
  }
  if (!cleanBase) {
    authority = `${formatHostForUrl(entryHost)}:${port}`;
    cleanBase = `http://${authority}`;
  }
  const cleanHosts = Array.isArray(hosts) ? hosts.filter(Boolean) : [];
  const encodedEndpoints = encodeEndpointsParam(endpoints);
  return `${cleanBase}/?token=${encodeURIComponent(token || '')}`
    + `&address=${encodeURIComponent(authority)}`
    + `&name=${encodeURIComponent(name || 'antigravity-mac')}`
    + `&hosts=${encodeURIComponent(cleanHosts.join(','))}`
    + `&endpoints=${encodedEndpoints}`;
}

function timingSafeTokenMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(cookieHeader) {
  const map = {};
  const raw = String(cookieHeader || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try { map[k] = decodeURIComponent(v); } catch { map[k] = v; }
    }
  }
  return map;
}

function extractRequestToken(req, urlObj) {
  const queryToken = urlObj.searchParams.get('token') || '';
  const headerToken = String(req.headers['x-ag-remote-token'] || '').trim();
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies.ag_remote_token || '';
  return {
    token: queryToken || headerToken || cookieToken,
    fromQuery: Boolean(queryToken),
    fromCookie: Boolean(!queryToken && !headerToken && cookieToken),
    uiVersion: cookies.ag_ui_ver || ''
  };
}

// ==================== 纯 JS 零依赖 QR Code 生成器 (Byte 模式, L 纠错) ====================

const QR_GF_EXP = new Uint8Array(512);
const QR_GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_GF_EXP[i] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) QR_GF_EXP[i] = QR_GF_EXP[i - 255];
})();

function qrGfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
}

function qrRsGenPoly(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = QR_GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= qrGfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function qrRsEncode(dataBytes, ecLen) {
  const gen = qrRsGenPoly(ecLen);
  const res = new Uint8Array(dataBytes.length + ecLen);
  res.set(dataBytes, 0);
  for (let i = 0; i < dataBytes.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= qrGfMul(gen[j], coef);
      }
    }
  }
  return Array.from(res.slice(dataBytes.length));
}

// [version]: [totalDataBytes, ecBytesPerBlock, group1Blocks, group1Data, group2Blocks, group2Data, alignCenters]
const QR_SPECS_L = {
  1:  [19,   7, 1, 19, 0,  0, []],
  2:  [34,  10, 1, 34, 0,  0, [6, 18]],
  3:  [55,  15, 1, 55, 0,  0, [6, 22]],
  4:  [80,  20, 1, 80, 0,  0, [6, 26]],
  5:  [108, 26, 1, 108, 0, 0, [6, 30]],
  6:  [136, 18, 2, 68, 0,  0, [6, 34]],
  7:  [156, 20, 2, 78, 0,  0, [6, 22, 38]],
  8:  [194, 24, 2, 97, 0,  0, [6, 24, 42]],
  9:  [232, 30, 2, 116, 0, 0, [6, 26, 46]],
  10: [274, 18, 2, 68, 2, 69, [6, 28, 50]],
  11: [324, 20, 4, 81, 0,  0, [6, 30, 54]],
  12: [370, 24, 2, 92, 2, 93, [6, 32, 58]],
  13: [428, 26, 4, 107, 0, 0, [6, 34, 62]],
  14: [461, 30, 3, 115, 1, 116, [6, 26, 46, 66]],
  15: [523, 22, 5, 87, 1, 88, [6, 26, 48, 70]],
  16: [589, 24, 5, 98, 1, 99, [6, 26, 50, 74]],
  17: [647, 28, 1, 107, 5, 108, [6, 30, 54, 78]],
  18: [721, 30, 5, 120, 1, 121, [6, 30, 56, 82]],
  19: [795, 28, 3, 113, 4, 114, [6, 30, 58, 86]],
  20: [861, 28, 3, 107, 5, 108, [6, 34, 62, 90]],
  21: [932, 28, 4, 116, 4, 117, [6, 28, 50, 72, 94]],
  22: [1006, 28, 2, 111, 7, 112, [6, 26, 50, 74, 98]],
  23: [1094, 30, 4, 121, 5, 122, [6, 30, 54, 78, 102]],
  24: [1174, 30, 6, 117, 4, 118, [6, 28, 54, 80, 106]],
  25: [1276, 26, 8, 106, 4, 107, [6, 32, 58, 84, 110]]
};

function encodeQrCodeMatrix(text) {
  const bytes = Array.from(Buffer.from(String(text || ''), 'utf8'));
  let version = 0;
  for (let v = 1; v <= 25; v++) {
    const charCountBits = v <= 9 ? 8 : 16;
    const neededBits = 4 + charCountBits + bytes.length * 8;
    if (neededBits <= QR_SPECS_L[v][0] * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('QR URL 过长');

  const [totalDataBytes, ecPerBlock, g1Count, g1Data, g2Count, g2Data, alignPos] = QR_SPECS_L[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = totalDataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  for (let idx = 0; bits.length < maxBits; idx++) {
    pushBits(padBytes[idx % 2], 8);
  }

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    dataBytes.push(byte);
  }

  const blocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1Count; i++) {
    const blk = dataBytes.slice(offset, offset + g1Data);
    offset += g1Data;
    blocks.push(blk);
    ecBlocks.push(qrRsEncode(blk, ecPerBlock));
  }
  for (let i = 0; i < g2Count; i++) {
    const blk = dataBytes.slice(offset, offset + g2Data);
    offset += g2Data;
    blocks.push(blk);
    ecBlocks.push(qrRsEncode(blk, ecPerBlock));
  }

  const interleaved = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of blocks) {
      if (i < blk.length) interleaved.push(blk[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of ecBlocks) interleaved.push(ec[i]);
  }

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFixed = (r, c, val) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = val;
    reserved[r][c] = true;
  };

  const placeFinder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const onBorder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = onBorder && (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        );
        setFixed(rr, cc, dark);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFixed(6, i, dark);
    setFixed(i, 6, dark);
  }
  setFixed(size - 8, 8, true); // Dark module

  // Alignment patterns
  if (alignPos.length) {
    for (const r of alignPos) {
      for (const c of alignPos) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFixed(r + dr, c + dc, dark);
          }
        }
      }
    }
  }

  // Reserve format info cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
    if (i < 8) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }
  }

  // Reserve & write 18-bit version info for v >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFixed(a, b, bit);
      setFixed(b, a, bit);
    }
  }

  // Place data bits in zig-zag order
  const dataBits = [];
  for (const byte of interleaved) {
    for (let b = 7; b >= 0; b--) dataBits.push(((byte >>> b) & 1) === 1);
  }
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (!reserved[r][c]) {
          modules[r][c] = bitIdx < dataBits.length ? dataBits[bitIdx++] : false;
        }
      }
    }
    upward = !upward;
  }

  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r, _c) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  const writeFormat = (grid, maskId) => {
    const data = (0b01 << 3) | maskId; // ECC L = 01
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmtBits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i < 15; i++) {
      const bit = ((fmtBits >>> i) & 1) === 1;
      if (i < 6) grid[i][8] = bit;
      else if (i < 8) grid[i + 1][8] = bit;
      else grid[size - 15 + i][8] = bit;

      if (i < 8) grid[8][size - 1 - i] = bit;
      else if (i < 9) grid[8][15 - i] = bit;
      else grid[8][15 - i - 1] = bit;
    }
  };

  const evalPenalty = (grid) => {
    let score = 0;
    for (let r = 0; r < size; r++) {
      let runCol = 1;
      let runRow = 1;
      for (let c = 1; c < size; c++) {
        if (grid[r][c] === grid[r][c - 1]) runRow++;
        else { if (runRow >= 5) score += 3 + (runRow - 5); runRow = 1; }
        if (grid[c][r] === grid[c - 1][r]) runCol++;
        else { if (runCol >= 5) score += 3 + (runCol - 5); runCol = 1; }
      }
      if (runRow >= 5) score += 3 + (runRow - 5);
      if (runCol >= 5) score += 3 + (runCol - 5);
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
      }
    }
    return score;
  };

  let bestGrid = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const grid = modules.map((row, r) => row.map((v, c) => (reserved[r][c] ? v : (v ^ maskFns[m](r, c)))));
    writeFormat(grid, m);
    const sc = evalPenalty(grid);
    if (sc < bestScore) {
      bestScore = sc;
      bestGrid = grid;
    }
  }
  return bestGrid;
}

function renderTerminalQr(url) {
  const grid = encodeQrCodeMatrix(url);
  const size = grid.length;
  const pad = 2;
  const total = size + pad * 2;
  const isDark = (r, c) => {
    const rr = r - pad;
    const cc = c - pad;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) return false;
    return grid[rr][cc];
  };
  const lines = [];
  for (let r = 0; r < total; r += 2) {
    let row = '';
    for (let c = 0; c < total; c++) {
      // 白底黑码使用终端反色呈现（暗模块输出空格还是█按常规黑底白码反转以兼容所有终端）
      const top = isDark(r, c);
      const bot = r + 1 < total ? isDark(r + 1, c) : false;
      // 反色：浅色终端/深色终端下白边黑码更易识别
      if (!top && !bot) row += '█';
      else if (top && bot) row += ' ';
      else if (top && !bot) row += '▄';
      else row += '▀';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

function renderQrSvg(url) {
  const grid = encodeQrCodeMatrix(url);
  const size = grid.length;
  const pad = 3;
  const total = size + pad * 2;
  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        pathData += `M${c + pad} ${r + pad}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="200" height="200" shape-rendering="crispEdges"><rect width="${total}" height="${total}" rx="2.5" fill="#ffffff"/><path d="${pathData}" fill="#09090b"/></svg>`;
}

// ==================== CDP 目标枚举与脚本求值 ====================

function listElectronWebContentsTargets() {
  try {
    const electron = require('electron');
    const all = electron?.webContents?.getAllWebContents?.();
    if (!Array.isArray(all) || !all.length) return [];
    return all
      .filter((wc) => {
        if (!wc || wc.isDestroyed?.()) return false;
        if (wc.hostWebContents) return false;
        const url = String(wc.getURL?.() || '');
        return /^https:\/\/127\.0\.0\.1:\d+\//.test(url);
      })
      .map((wc) => ({
        id: `wc-${wc.id}`,
        title: String(wc.getTitle?.() || 'Antigravity'),
        url: String(wc.getURL?.() || ''),
        wc
      }));
  } catch {
    return [];
  }
}

let cachedCdpTargets = null;
let cachedCdpTargetsAt = 0;
const CDP_TARGETS_CACHE_TTL_MS = 10000;

function invalidateCdpTargetsCache() {
  cachedCdpTargets = null;
  cachedCdpTargetsAt = 0;
}

async function listAntigravityCdpTargets(options = {}) {
  const electronTargets = listElectronWebContentsTargets();
  if (electronTargets.length) {
    return electronTargets;
  }

  const nowMs = Date.now();
  if (!isCatalogTestEnv() && !options.force && Array.isArray(cachedCdpTargets) && cachedCdpTargets.length && (nowMs - cachedCdpTargetsAt < CDP_TARGETS_CACHE_TTL_MS)) {
    return cachedCdpTargets;
  }

  const { port, targets } = await resolveActiveCdpTarget({ timeoutMs: 2500 });
  if (!port) {
    invalidateCdpTargetsCache();
    throw new Error('Antigravity 未运行或未开启远程调试端口');
  }
  const mapped = targets
    .filter((p) => p && p.webSocketDebuggerUrl)
    .map((p) => ({
      id: String(p.id),
      title: String(p.title || 'Antigravity'),
      url: String(p.url || ''),
      wsUrl: String(p.webSocketDebuggerUrl)
    }));
  if (!isCatalogTestEnv() && mapped.length) {
    cachedCdpTargets = mapped;
    cachedCdpTargetsAt = Date.now();
  } else {
    invalidateCdpTargetsCache();
  }
  return mapped;
}

function evalInElectronWebContents(wc, expression, timeoutMs = 4500) {
  if (!wc || wc.isDestroyed?.() || typeof wc.executeJavaScript !== 'function') {
    const err = new Error('目标窗口已关闭');
    err.cdpDispatched = false;
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispatched = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error('页面执行超时');
      err.cdpDispatched = dispatched;
      reject(err);
    }, timeoutMs);
    Promise.resolve()
      .then(() => {
        dispatched = true;
        return wc.executeJavaScript(expression, true);
      })
      .then((val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const wrapped = err instanceof Error ? err : new Error(String(err || '页面执行异常'));
        wrapped.cdpDispatched = dispatched;
        reject(wrapped);
      });
  });
}

function evalInTarget(target, expression, timeoutMs = 4500) {
  if (target?.wc) {
    return evalInElectronWebContents(target.wc, expression, timeoutMs);
  }
  return evalInCdpTarget(target.wsUrl, expression, timeoutMs);
}

function evalInCdpTarget(wsUrl, expression, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let requestSent = false;
    let timer = null;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) {
        if (err.cdpDispatched === undefined) err.cdpDispatched = requestSent;
        reject(err);
      } else {
        resolve(val);
      }
    };

    timer = setTimeout(() => {
      finish(new Error('CDP 请求超时'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      requestSent = true;
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        if (msg.error) {
          finish(new Error(msg.error.message || 'CDP Runtime.evaluate 错误'));
        } else if (msg.result?.exceptionDetails) {
          const desc = msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text || '页面执行异常';
          finish(new Error(desc));
        } else {
          finish(null, msg.result?.result?.value);
        }
      } catch (e) {
        finish(e);
      }
    });

    ws.addEventListener('error', () => finish(new Error(requestSent ? 'CDP 连接在执行期间断开' : 'CDP WebSocket 连接失败')));
    ws.addEventListener('close', () => finish(new Error(requestSent ? 'CDP 连接在执行期间断开' : 'CDP WebSocket 连接失败')));
  });
}

async function pickCdpTarget(requestedId, options = {}) {
  let targets = await listAntigravityCdpTargets(options);
  if (!targets.length) {
    invalidateCdpTargetsCache();
    if (!options.force) targets = await listAntigravityCdpTargets({ force: true });
  }
  if (!targets.length) {
    throw new Error('未找到激活的 Antigravity 对话窗口');
  }
  const cleanWindows = targets.map((t) => ({ id: t.id, title: t.title }));
  if (requestedId) {
    const found = targets.find((t) => t.id === requestedId);
    if (found) return { target: found, windows: cleanWindows };
  }
  return { target: targets[0], windows: cleanWindows };
}

async function evalInPickedTarget(requestedId, expression, timeoutMs = 4500, options = {}) {
  const idempotent = Boolean(options.idempotent);
  const pickFn = typeof options.pickTarget === 'function' ? options.pickTarget : pickCdpTarget;
  const evalFn = typeof options.evalInTarget === 'function' ? options.evalInTarget : evalInTarget;
  let picked = await pickFn(requestedId);
  try {
    const value = await evalFn(picked.target, expression, timeoutMs);
    return { value, target: picked.target, windows: picked.windows };
  } catch (err) {
    invalidateCdpTargetsCache();
    const msg = String(err?.message || '');
    const isTargetOrConnErr = /(?:CDP WebSocket 连接失败|CDP 连接在执行期间断开|目标窗口已关闭|未找到激活|CDP 请求超时|页面执行超时)/.test(msg);
    if (!isTargetOrConnErr) {
      throw err;
    }
    const mayHaveExecuted = Boolean(err?.cdpDispatched) || /(?:超时|执行期间断开)/.test(msg);
    if (!idempotent && mayHaveExecuted) {
      throw err;
    }
    picked = await pickFn(requestedId, { force: true });
    const value = await evalFn(picked.target, expression, timeoutMs);
    return { value, target: picked.target, windows: picked.windows };
  }
}

// ==================== 多项目融合目录、会话状态汇总与防缩水缓存 ====================

const SESSION_CATALOG_FILE_NAME = 'remote-session-catalog.json';
const MAX_ARCHIVED_TOMBSTONES = 500;
const INTERNAL_EMPTY_PROJECT_IDS = new Set(['outside-of-project', 'standalone']);
globalThis.__AG_REMOTE_BOOT_SEQ = (globalThis.__AG_REMOTE_BOOT_SEQ || 0) + 1;
const REMOTE_SERVER_BOOT_AT = Math.max(Date.now() * 1000, (Number(globalThis.__AG_REMOTE_LAST_BOOT_AT) || 0) + 1);
globalThis.__AG_REMOTE_LAST_BOOT_AT = REMOTE_SERVER_BOOT_AT;
const REMOTE_SERVER_BOOT_ID = `${REMOTE_SERVER_BOOT_AT}-${process.pid}-${globalThis.__AG_REMOTE_BOOT_SEQ.toString(36)}`;
let remoteServerSnapSeq = 0;

function isCatalogTestEnv() {
  return process.env.AG_METER_TEST_MODE === '1' || process.env.NODE_ENV === 'test';
}

const CREDIBLE_TRAJ_IDLE_STATUSES = new Set([
  'CASCADE_RUN_STATUS_IDLE',
  'CASCADE_RUN_STATUS_DONE',
  'CASCADE_RUN_STATUS_COMPLETED',
  'CASCADE_RUN_STATUS_STOPPED',
  'CASCADE_RUN_STATUS_CANCELED',
  'CASCADE_RUN_STATUS_CANCELLED'
]);
const CREDIBLE_STATUS_VALUES = new Set(['waiting', 'running', 'error', 'idle']);

function normalizeTrajectoryStatus(rawStatus, termReason, options = {}) {
  const s = String(rawStatus || '').trim();
  const r = String(termReason || '').trim();
  const fallback = CREDIBLE_STATUS_VALUES.has(options.fallbackStatus) ? options.fallbackStatus : '';
  if (
    options.hasPendingApprovals ||
    s === 'CASCADE_RUN_STATUS_WAITING_FOR_USER' ||
    options.subagentWaiting ||
    options.domStatus === 'waiting'
  ) {
    return 'waiting';
  }
  const explicitTrajIdle = Boolean(
    CREDIBLE_TRAJ_IDLE_STATUSES.has(s) ||
    (r && r !== 'EXECUTOR_TERMINATION_REASON_UNSPECIFIED' && !s)
  );
  if (
    s === 'CASCADE_RUN_STATUS_RUNNING' ||
    options.subagentRunning ||
    options.domBusy ||
    options.strongDomBusy ||
    (!explicitTrajIdle && (options.activeBusy || options.domStatus === 'running'))
  ) {
    return 'running';
  }
  if (
    r === 'EXECUTOR_TERMINATION_REASON_ERROR' ||
    s === 'CASCADE_RUN_STATUS_ERROR' ||
    s === 'CASCADE_RUN_STATUS_FAILED' ||
    options.domStatus === 'error'
  ) {
    return 'error';
  }
  if (explicitTrajIdle || options.explicitIdle) {
    return 'idle';
  }
  if (fallback) {
    return fallback;
  }
  return 'unknown';
}

function statusToLabel(status) {
  if (status === 'waiting') return '待确认';
  if (status === 'running') return '运行中';
  if (status === 'error') return '异常';
  if (status === 'unknown') return '未知';
  return '';
}

function parseIsoTimestampMs(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 1e12 && raw < 4e12 ? raw : 0;
  }
  const s = String(raw || '').trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function safeDecodeURIComponent(raw) {
  const s = String(raw ?? '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function decodeFileUriToPath(rawUri) {
  const s = String(rawUri || '').trim();
  if (!s) return '';
  if (!/^file:\/\//i.test(s)) return path.resolve(s);
  try {
    const u = new URL(s);
    let p = safeDecodeURIComponent(u.pathname || '');
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return p ? path.resolve(p) : '';
  } catch {
    return '';
  }
}

function matchWorkspaceToProjectId(traj, projectsMetaMap) {
  const meta = traj?.trajectoryMetadata || {};
  const uris = [];
  for (const ws of (Array.isArray(traj?.workspaces) ? traj.workspaces : [])) {
    if (ws?.workspaceFolderAbsoluteUri) uris.push(ws.workspaceFolderAbsoluteUri);
    if (ws?.gitRootAbsoluteUri) uris.push(ws.gitRootAbsoluteUri);
  }
  for (const ws of (Array.isArray(meta.workspaces) ? meta.workspaces : [])) {
    if (ws?.workspaceFolderAbsoluteUri) uris.push(ws.workspaceFolderAbsoluteUri);
    if (ws?.gitRootAbsoluteUri) uris.push(ws.gitRootAbsoluteUri);
  }
  for (const u of (Array.isArray(meta.workspaceUris) ? meta.workspaceUris : [])) {
    uris.push(u);
  }

  for (const uri of uris) {
    const wsPath = decodeFileUriToPath(uri);
    if (!wsPath) continue;
    for (const proj of projectsMetaMap.values()) {
      for (const pPath of proj.workspacePaths) {
        if (wsPath === pPath || wsPath.startsWith(pPath + path.sep) || pPath.startsWith(wsPath + path.sep)) {
          return proj.id;
        }
      }
    }
  }
  return '';
}

function loadProjectsMetaFromDisk(options = {}, cacheRef = null) {
  const explicitDir = String(options.configDir || process.env.AG_CONFIG_DIR || '').trim();
  let configDir = explicitDir;
  if (!configDir) {
    if (isCatalogTestEnv()) return { metaMap: new Map(), excludedIds: new Set() };
    configDir = path.join(os.homedir(), '.gemini', 'config');
  }
  const projectsDir = path.join(configDir, 'projects');
  const nowMs = Date.now();
  if (
    cacheRef &&
    !options.bypassCache &&
    cacheRef.projectsDir === projectsDir &&
    cacheRef.data &&
    nowMs - cacheRef.fetchedAt < 10000
  ) {
    return cacheRef.data;
  }

  const metaMap = new Map();
  const excludedIds = new Set();
  const archivedIds = new Set();
  try {
    if (fs.existsSync(projectsDir)) {
      const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const fp = path.join(projectsDir, f);
        const readRes = safeReadJsonSync(fp, null);
        const parsed = readRes?.ok ? readRes.data : null;
        if (!parsed || typeof parsed !== 'object') continue;
        const id = String(parsed.id || parsed.projectId || f.slice(0, -5)).trim();
        const name = String(parsed.name || id).trim();
        if (parsed.archived === true) {
          if (id) {
            excludedIds.add(id);
            archivedIds.add(id);
          }
          continue;
        }
        if (parsed.sidecar || name === 'swarm/swarm_board') {
          if (id) excludedIds.add(id);
          continue;
        }
        if (!id || !name) continue;
        const workspacePaths = [];
        const resources = Array.isArray(parsed.projectResources?.resources) ? parsed.projectResources.resources : [];
        for (const r of resources) {
          const uri = r?.gitFolder?.folderUri || r?.folderUri;
          const p = decodeFileUriToPath(uri);
          if (p) workspacePaths.push(p);
        }
        let mtimeMs = 0;
        try {
          mtimeMs = Number(fs.statSync(fp).mtimeMs) || 0;
        } catch {}
        metaMap.set(id, { id, name, primaryPath: workspacePaths[0] || '', workspacePaths, mtimeMs });
      }
    }
  } catch {}

  const resData = { metaMap, excludedIds, archivedIds };
  if (cacheRef) {
    cacheRef.projectsDir = projectsDir;
    cacheRef.fetchedAt = nowMs;
    cacheRef.data = resData;
  }
  return resData;
}

function withRaceTimeout(promise, ms, fallback = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let cachedLocalApi = null;
let cachedLocalApiAt = 0;
let inflightLocalApiPromise = null;
const LOCAL_API_CACHE_TTL_MS = 15000;

function invalidateSharedLocalApi() {
  cachedLocalApi = null;
  cachedLocalApiAt = 0;
  inflightLocalApiPromise = null;
}

async function getSharedLocalApi() {
  const nowMs = Date.now();
  if (cachedLocalApi && (nowMs - cachedLocalApiAt < LOCAL_API_CACHE_TTL_MS)) {
    return cachedLocalApi;
  }
  if (!inflightLocalApiPromise) {
    inflightLocalApiPromise = (async () => {
      let connectFn;
      try {
        connectFn = require('./local-api').connect;
      } catch {
        return null;
      }
      const api = await withRaceTimeout(Promise.resolve().then(() => connectFn()).catch(() => null), 1200, null);
      if (api && typeof api.call === 'function') {
        cachedLocalApi = api;
        cachedLocalApiAt = Date.now();
        return api;
      }
      return null;
    })().finally(() => {
      inflightLocalApiPromise = null;
    });
  }
  return await inflightLocalApiPromise;
}

async function resolveLocalApi(options = {}) {
  const customConnect = options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__;
  if (customConnect) {
    return typeof customConnect === 'function'
      ? await withRaceTimeout(Promise.resolve().then(() => customConnect()).catch(() => null), 1200, null)
      : customConnect;
  }
  if (isCatalogTestEnv()) return null;
  return await getSharedLocalApi();
}

function classifyLanguageServerRpcError(err, method = '') {
  const msg = String(err?.message || err || '').trim();
  const code = String(err?.code || '').toUpperCase();
  const isTimeoutOrNet = /timeout|timed?\s*out|abort|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i.test(msg)
    || ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ABORT_ERR'].includes(code);
  if (isTimeoutOrNet) {
    return {
      ok: false,
      kind: 'timeout',
      confirmedNotExecuted: false,
      error: msg || `${method || 'RPC'} 调用超时`
    };
  }
  if (err?.confirmedNotExecuted === true) {
    return {
      ok: false,
      kind: 'confirmed_not_executed',
      confirmedNotExecuted: true,
      error: msg || `${method || 'RPC'} 已确认未执行`
    };
  }
  const httpMatch = msg.match(/^HTTP\s+(\d{3})\s*:\s*([\s\S]*)$/i);
  const httpStatus = Number(err?.status || err?.statusCode || (httpMatch ? httpMatch[1] : 0)) || 0;
  const rawBody = String(err?.responseText || (httpMatch ? httpMatch[2] : '') || '').trim();
  let parsedBody = (err?.rpcError && typeof err.rpcError === 'object') ? err.rpcError : null;
  if (!parsedBody && rawBody.startsWith('{') && rawBody.endsWith('}')) {
    try {
      const obj = JSON.parse(rawBody);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsedBody = obj;
      }
    } catch {}
  }
  const structCode = String(parsedBody?.code || err?.connectCode || '').trim().toLowerCase();
  const structMessage = String(parsedBody?.message || '').trim().toLowerCase();
  const isGatewayErrorStatus = httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
  const EXPLICIT_HTTP_REJECT_STATUSES = new Set([400, 404, 405, 409, 412, 422, 501]);
  const EXPLICIT_CONNECT_REJECT_CODES = new Set([
    'unimplemented',
    'invalid_argument',
    'not_found',
    'failed_precondition',
    'permission_denied',
    'unauthenticated'
  ]);
  const isExactVerifiedDeprecated = Boolean(
    parsedBody &&
    (!method || method === 'SendAllQueuedMessages') &&
    (structCode === 'unknown' || structCode === 'unimplemented') &&
    structMessage === 'deprecated'
  );
  const isConfirmedRejected = Boolean(
    EXPLICIT_HTTP_REJECT_STATUSES.has(httpStatus) ||
    (!isGatewayErrorStatus && EXPLICIT_CONNECT_REJECT_CODES.has(structCode)) ||
    isExactVerifiedDeprecated
  );
  return {
    ok: false,
    kind: isConfirmedRejected ? 'confirmed_not_executed' : 'error_unknown',
    confirmedNotExecuted: isConfirmedRejected,
    error: msg || `${method || 'RPC'} 调用失败`
  };
}

async function runRpcCallDetailed(invoker, method, body, timeoutMs = 4500) {
  const TIMEOUT_SENTINEL = Symbol('rpc_timeout');
  let timer = null;
  try {
    const res = await Promise.race([
      Promise.resolve().then(() => invoker(method, body)),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), Math.max(50, Number(timeoutMs) || 4500));
      })
    ]);
    if (res === TIMEOUT_SENTINEL) {
      return { ok: false, kind: 'timeout', confirmedNotExecuted: false, error: `${method} 响应超时，结果未知` };
    }
    if (res === null || res === false) {
      return { ok: false, kind: 'empty', confirmedNotExecuted: false, error: `${method} 返回空结果，状态未知` };
    }
    return { ok: true, kind: 'ok', result: res };
  } catch (err) {
    return classifyLanguageServerRpcError(err, method);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callLocalLanguageServerDetailed(method, body, timeoutMs = 1500, options = {}) {
  const isCustom = Boolean(options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__);
  const api = await resolveLocalApi(options);
  if (!api || typeof api.call !== 'function') {
    return { ok: false, kind: 'unavailable', confirmedNotExecuted: true, error: 'LanguageServer 未连接' };
  }
  const firstOutcome = await runRpcCallDetailed((m, b) => api.call(m, b), method, body, timeoutMs);
  if (firstOutcome.ok || isCustom || options?.idempotent !== true || firstOutcome.kind !== 'error_unknown') {
    return firstOutcome;
  }
  invalidateSharedLocalApi();
  const retryApi = await getSharedLocalApi();
  if (!retryApi || typeof retryApi.call !== 'function') {
    return firstOutcome;
  }
  return await runRpcCallDetailed((m, b) => retryApi.call(m, b), method, body, timeoutMs);
}

async function callLocalLanguageServer(method, body, timeoutMs = 1500, options = {}) {
  const isCustom = Boolean(options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__);
  const api = await resolveLocalApi(options);
  if (!api || typeof api.call !== 'function') return null;
  if (isCustom) {
    return await withRaceTimeout(
      Promise.resolve().then(() => api.call(method, body)).catch(() => null),
      timeoutMs,
      null
    );
  }
  try {
    return await withRaceTimeout(
      Promise.resolve().then(() => api.call(method, body)),
      timeoutMs,
      null
    );
  } catch {
    invalidateSharedLocalApi();
    const retryApi = await getSharedLocalApi();
    if (!retryApi || typeof retryApi.call !== 'function') return null;
    return await withRaceTimeout(
      Promise.resolve().then(() => retryApi.call(method, body)).catch(() => null),
      timeoutMs,
      null
    );
  }
}

function inspectSubagentRecord(cid, traj, snapConv, knownSubIds = null, knownRoots = null) {
  const id = String(cid || '').trim();
  const meta = traj?.trajectoryMetadata || {};
  const rawRoot = String(
    meta.rootConversationId ||
    meta.parentConversationId ||
    traj?.parentConversationId ||
    snapConv?.rootConversationId ||
    snapConv?.parentConversationId ||
    (knownRoots?.get ? knownRoots.get(id) : '') ||
    ''
  ).trim();
  const rootId = (rawRoot && rawRoot !== id) ? rawRoot : '';
  const isSub = Boolean(
    knownSubIds?.has?.(id) ||
    rootId ||
    meta.parentConversationId ||
    traj?.parentConversationId ||
    meta.isSubagent ||
    traj?.isSubagent ||
    snapConv?.parentConversationId ||
    snapConv?.isSubagent
  );
  return { isSub, rootId };
}

function createSessionCatalogStore() {
  const registryByDir = new Map();
  const projectsCache = { projectsDir: '', fetchedAt: 0, data: null };
  const trajCache = { at: 0, data: null };

  function getStickyStoreForDir(stateDir) {
    const dir = String(stateDir || getStateDir());
    let entry = registryByDir.get(dir);
    if (!entry) {
      const filePath = path.join(dir, SESSION_CATALOG_FILE_NAME);
      const savedRes = safeReadJsonSync(filePath, null);
      const saved = savedRes?.ok ? savedRes.data : null;
      const map = new Map();
      const subagentIds = new Set(Array.isArray(saved?.subagentIds) ? saved.subagentIds.map((x) => String(x || '').trim()).filter(Boolean) : []);
      const subagentRoots = new Map();
      if (saved?.subagentRoots && typeof saved.subagentRoots === 'object') {
        for (const [k, v] of Object.entries(saved.subagentRoots)) {
          if (k && v) subagentRoots.set(String(k), String(v));
        }
      }
      const subagentStates = new Map();
      if (saved?.subagentStates && typeof saved.subagentStates === 'object') {
        for (const [k, v] of Object.entries(saved.subagentStates)) {
          if (k && v && typeof v === 'object' && v.rootId && (v.status === 'waiting' || v.status === 'running')) {
            subagentStates.set(String(k), {
              rootId: String(v.rootId),
              status: String(v.status),
              updatedAt: Number(v.updatedAt) || 0
            });
          }
        }
      }
      const rawItems = Array.isArray(saved?.conversations) ? saved.conversations : [];
      for (const item of rawItems) {
        if (!item || typeof item !== 'object' || !item.id) continue;
        const cid = String(item.id);
        const subInfo = inspectSubagentRecord(cid, null, item, subagentIds, subagentRoots);
        if (subInfo.isSub) {
          subagentIds.add(cid);
          if (subInfo.rootId) subagentRoots.set(cid, subInfo.rootId);
          continue;
        }
        const savedStatus = (CREDIBLE_STATUS_VALUES.has(item.status) || item.status === 'unknown') ? item.status : 'unknown';
        map.set(cid, { ...item, id: cid, status: savedStatus, statusLabel: statusToLabel(savedStatus) });
      }
      entry = { dir, filePath, map, subagentIds, subagentRoots, subagentStates, lastSig: '', lastActiveSessionId: '', catalogRevision: '' };
      registryByDir.set(dir, entry);
    }
    return entry;
  }

  function buildActiveCatalogItems(store, activeSessionId = '', snapConvMap = null) {
    const items = [];
    let archivedCount = 0;
    for (const c of store.map.values()) {
      if (store.subagentIds.has(c.id)) continue;
      if (c.archived) {
        archivedCount += 1;
        continue;
      }
      const isActive = Boolean((activeSessionId && c.id === activeSessionId) || snapConvMap?.get(c.id)?.active);
      const itemStatus = (CREDIBLE_STATUS_VALUES.has(c.status) || c.status === 'unknown') ? c.status : 'unknown';
      const unread = Boolean(!isActive && c.updatedAt > 0 && (c.updatedAt > (Number(c.lastViewedAt) || 0)));
      const completedUnread = Boolean(unread && itemStatus === 'idle');
      items.push({
        id: c.id,
        title: c.title,
        active: isActive,
        projectId: c.projectId || 'ungrouped',
        projectName: c.projectName || '未归属项目',
        status: itemStatus,
        statusLabel: statusToLabel(itemStatus),
        unread,
        completedUnread,
        pinned: Boolean(c.pinned),
        updatedAt: c.updatedAt
      });
    }
    items.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
    const revPayload = items
      .map((c) => `${c.id}\t${c.title}\t${c.projectId}\t${c.status}\t${c.unread ? 1 : 0}\t${c.pinned ? 1 : 0}\t${c.updatedAt}`)
      .join('\n') + `|s:${store.subagentIds.size}|a:${archivedCount}`;
    const catalogRevision = crypto.createHash('sha1').update(revPayload).digest('hex').slice(0, 16);
    return { items, catalogRevision };
  }

  async function fetchTrajectories(options = {}) {
    const customConnect = options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__;
    const nowMs = Date.now();
    if (!customConnect && !options.bypassCache && !options.bypassCatalogCache && trajCache.data && nowMs - trajCache.at < 2000) {
      return trajCache.data;
    }

    try {
      const api = await resolveLocalApi(options);
      if (!api || typeof api.call !== 'function') return null;
      const runBatch = async (client, allowThrow) => {
        let trajFailed = false;
        const [trajRes, listProjRes] = await Promise.all([
          withRaceTimeout(
            Promise.resolve()
              .then(() => client.call('GetAllCascadeTrajectories', {}))
              .catch((err) => {
                trajFailed = true;
                if (allowThrow) throw err;
                return null;
              }),
            1500,
            null
          ),
          withRaceTimeout(Promise.resolve().then(() => client.call('ListProjects', {})).catch(() => null), 1000, null)
        ]);
        return { trajRes, listProjRes, trajFailed };
      };
      let batch = await runBatch(api, !customConnect).catch(() => null);
      if ((!batch || batch.trajFailed) && !customConnect) {
        invalidateSharedLocalApi();
        const retryApi = await resolveLocalApi(options);
        if (retryApi && typeof retryApi.call === 'function') {
          batch = await runBatch(retryApi, false).catch(() => null);
        }
      }
      const trajRes = batch?.trajRes || null;
      const listProjRes = batch?.listProjRes || null;
      const hasSummaries = Boolean(trajRes && trajRes.trajectorySummaries && typeof trajRes.trajectorySummaries === 'object');
      const data = {
        trajOk: hasSummaries,
        summaries: hasSummaries ? trajRes.trajectorySummaries : {},
        projectIds: Array.isArray(listProjRes?.projectIds) ? listProjRes.projectIds : []
      };
      if (!customConnect && hasSummaries) {
        trajCache.at = Date.now();
        trajCache.data = data;
      }
      return data;
    } catch {
      return null;
    }
  }

  async function enrichSnapshot(snap, options = {}) {
    if (!snap || typeof snap !== 'object' || snap.ok === false) return snap;

    const store = getStickyStoreForDir(options.stateDir || getStateDir());
    const { metaMap: projectsMeta, excludedIds: excludedProjectIds, archivedIds: archivedProjectIds } = loadProjectsMetaFromDisk(options, projectsCache);
    const trajData = await fetchTrajectories(options);

    // 1. 构建项目名称字典（融合磁盘配置 + 语言服务项目 ID + 前端 DOM/Fiber 项目组）
    const projectNameMap = new Map();
    for (const p of projectsMeta.values()) {
      projectNameMap.set(p.id, p.name);
    }
    for (const pid of (trajData?.projectIds || [])) {
      const id = String(pid || '').trim();
      if (!id || id === 'swarm/swarm_board' || excludedProjectIds.has(id)) continue;
      if (!projectNameMap.has(id)) {
        projectNameMap.set(id, id === 'default-cli-project' ? 'CLI Project' : id);
      }
    }
    for (const fp of (Array.isArray(snap.projects) ? snap.projects : [])) {
      const id = String(fp?.id || '').trim();
      const name = String(fp?.name || '').trim();
      if (!id || !name || name === 'swarm/swarm_board' || excludedProjectIds.has(id)) continue;
      if (!projectNameMap.has(id) || projectNameMap.get(id) === id) {
        projectNameMap.set(id, name);
      }
    }

    // 2. 索引快照与轨迹，统一识别 Subagent（跨越轨迹 / 快照 / 持久化缓存三源）并清库汇总状态
    const snapConvMap = new Map();
    for (const c of (Array.isArray(snap.conversations) ? snap.conversations : [])) {
      if (c && c.id) snapConvMap.set(String(c.id), c);
    }
    const summaries = trajData?.summaries || {};
    const rootTrajs = new Map();
    const subagentRollup = new Map();
    const candidateIds = new Set([...store.map.keys(), ...Object.keys(summaries), ...snapConvMap.keys()]);
    const seenSubIds = new Set();
    const rootIds = [];

    for (const cid of candidateIds) {
      const t = summaries[cid];
      const sc = snapConvMap.get(cid);
      const cached = store.map.get(cid);
      const subInfo = inspectSubagentRecord(cid, t, sc || cached, store.subagentIds, store.subagentRoots);
      if (subInfo.isSub) {
        store.subagentIds.add(cid);
        seenSubIds.add(cid);
        const rootId = subInfo.rootId || store.subagentRoots.get(cid) || store.subagentStates.get(cid)?.rootId || '';
        if (rootId) store.subagentRoots.set(cid, rootId);
        const prevSub = store.subagentStates.get(cid);
        const hasChildData = Boolean(t || sc);
        const childStatus = hasChildData
          ? normalizeTrajectoryStatus(t?.status, t?.latestExecutorTerminationReason, {
              domBusy: Boolean(sc?.domBusy),
              domStatus: sc?.status,
              fallbackStatus: prevSub?.status
            })
          : (prevSub?.status || 'unknown');
        const childArchived = t?.annotations?.archived === true;
        if (!childArchived && (childStatus === 'waiting' || childStatus === 'running') && rootId) {
          store.subagentStates.set(cid, {
            rootId,
            status: childStatus,
            updatedAt: Math.max(parseIsoTimestampMs(t?.lastModifiedTime), parseIsoTimestampMs(sc?.timeKey), Number(prevSub?.updatedAt) || 0)
          });
        } else if (hasChildData && (childArchived || childStatus === 'idle' || childStatus === 'error')) {
          store.subagentStates.delete(cid);
        }
        if (rootId) {
          const prevRoll = subagentRollup.get(rootId) || { waiting: false, running: false, maxUpdatedAt: 0 };
          if (!childArchived) {
            if (childStatus === 'waiting') prevRoll.waiting = true;
            else if (childStatus === 'running') prevRoll.running = true;
          }
          const modMs = Math.max(parseIsoTimestampMs(t?.lastModifiedTime), parseIsoTimestampMs(sc?.timeKey), Number(prevSub?.updatedAt) || 0);
          if (modMs > prevRoll.maxUpdatedAt) prevRoll.maxUpdatedAt = modMs;
          subagentRollup.set(rootId, prevRoll);
        }
        store.map.delete(cid);
        continue;
      }
      if (t) rootTrajs.set(cid, t);
      rootIds.push(cid);
    }

    const nowMs = Date.now();
    const subagentStateTtlMs = Number(options?.subagentStateTtlMs) > 0
      ? Number(options.subagentStateTtlMs)
      : 2 * 60 * 60 * 1000;
    const trajFetchedOk = Boolean(trajData && trajData.trajOk === true);

    for (const [subId, subRec] of Array.from(store.subagentStates.entries())) {
      if (seenSubIds.has(subId)) continue;
      if (!subRec || !subRec.rootId) {
        store.subagentStates.delete(subId);
        continue;
      }
      const rootTraj = rootTrajs.get(subRec.rootId);
      const rootCached = store.map.get(subRec.rootId);
      const rootArchived = rootTraj?.annotations?.archived === true || rootCached?.archived === true;
      const updatedMs = Number(subRec.updatedAt) || 0;
      const subAgeMs = nowMs - updatedMs;
      // 仅在全量轨迹拉取明确成功（含成功返回空对象）且该 running 子代理已不在列表中超过 15 秒时清理僵尸缓存；
      // 同时也按根会话归档或全局 TTL 上限清理陈旧记录，若轨迹拉取失败则保留非过期 waiting/running 状态以免误伤
      const shouldPruneRunning = subRec.status === 'running' && trajFetchedOk && subAgeMs > 15000;
      if (rootArchived || (updatedMs > 0 && subAgeMs > subagentStateTtlMs) || shouldPruneRunning) {
        store.subagentStates.delete(subId);
        continue;
      }
      const prevRoll = subagentRollup.get(subRec.rootId) || { waiting: false, running: false, maxUpdatedAt: 0 };
      if (subRec.status === 'waiting') prevRoll.waiting = true;
      else if (subRec.status === 'running') prevRoll.running = true;
      if (updatedMs > prevRoll.maxUpdatedAt) prevRoll.maxUpdatedAt = updatedMs;
      subagentRollup.set(subRec.rootId, prevRoll);
    }

    if (store.subagentStates.size > 200) {
      const oldestFirst = Array.from(store.subagentStates.entries())
        .sort((a, b) => (Number(a[1]?.updatedAt) || 0) - (Number(b[1]?.updatedAt) || 0));
      const excess = store.subagentStates.size - 200;
      for (let i = 0; i < excess; i++) {
        store.subagentStates.delete(oldestFirst[i][0]);
      }
    }

    const activeSessionId = String(snap.sessionId || '').trim();
    const hasPendingApprovals = (Array.isArray(snap.pendingApprovals) && snap.pendingApprovals.length > 0)
      || (Array.isArray(snap.pendingPrompts) && snap.pendingPrompts.length > 0);

    for (const id of rootIds) {
      const prev = store.map.get(id);
      const t = rootTrajs.get(id);
      const sc = snapConvMap.get(id);
      const roll = subagentRollup.get(id);
      const isActive = Boolean((activeSessionId && id === activeSessionId) || sc?.active);

      const snapPid = String(sc?.projectId || '').trim();
      const trajPid = String(t?.trajectoryMetadata?.projectId || '').trim();
      const wsPid = t ? matchWorkspaceToProjectId(t, projectsMeta) : '';
      let projectId = (snapPid && snapPid !== 'ungrouped') ? snapPid : (trajPid || wsPid || String(prev?.projectId || '').trim());
      if (projectId === 'outside-of-project' && !projectNameMap.has('outside-of-project')) {
        projectNameMap.set('outside-of-project', '独立对话');
      }
      const projArchived = Boolean(projectId && archivedProjectIds?.has(projectId));

      const archived = ((t?.annotations?.archived === true || projArchived) && !isActive)
        ? true
        : ((t && !projArchived) ? false : Boolean(prev?.archived && !isActive));

      const snapTitle = String(sc?.title || '').trim();
      const isUsefulSnapTitle = Boolean(snapTitle && snapTitle !== id.slice(0, 8));
      const trajTitle = String(t?.annotations?.title || t?.summary || '').trim();
      const title = (isUsefulSnapTitle ? snapTitle : '') || trajTitle || prev?.title || snapTitle || id.slice(0, 8);

      const modMs = parseIsoTimestampMs(t?.lastModifiedTime);
      const scTimeMs = parseIsoTimestampMs(sc?.timeKey);
      const subMs = roll?.maxUpdatedAt || 0;
      const updatedAt = Math.max(modMs, scTimeMs, subMs, Number(prev?.updatedAt) || 0) || nowMs;

      const viewMs = Math.max(
        parseIsoTimestampMs(t?.annotations?.lastUserViewTime),
        Number(prev?.lastViewedAt) || 0,
        isActive ? Math.max(updatedAt, 1) : 0
      );

      const pinned = Boolean(
        sc?.pinned !== undefined ? sc.pinned
          : (t?.annotations?.pinned !== undefined ? t.annotations.pinned : prev?.pinned)
      );

      const hasStrongActiveDomBusy = Boolean(isActive && (snap.strongDomBusy || snap.busySignal));
      const status = normalizeTrajectoryStatus(t?.status, t?.latestExecutorTerminationReason, {
        hasPendingApprovals: isActive && hasPendingApprovals,
        activeBusy: isActive && Boolean(snap.busy),
        strongDomBusy: hasStrongActiveDomBusy,
        domBusy: Boolean(sc?.domBusy),
        domStatus: sc?.status,
        subagentWaiting: Boolean(roll?.waiting),
        subagentRunning: Boolean(roll?.running),
        fallbackStatus: prev?.status
      });
      if (
        isActive &&
        status === 'idle' &&
        CREDIBLE_TRAJ_IDLE_STATUSES.has(String(t?.status || '').trim()) &&
        !hasStrongActiveDomBusy &&
        !sc?.domBusy &&
        !roll?.running &&
        !hasPendingApprovals
      ) {
        snap = { ...snap, busy: false };
      }

      const projectName = String(
        projectNameMap.get(projectId) ||
        sc?.projectName ||
        prev?.projectName ||
        (projectId ? projectId : '未归属项目')
      );

      if (projectId && !archived && !excludedProjectIds.has(projectId) && !projectNameMap.has(projectId)) {
        projectNameMap.set(projectId, projectName);
      }

      store.map.set(id, {
        id,
        title: title.slice(0, 100),
        projectId: projectId || 'ungrouped',
        projectName,
        pinned,
        archived,
        updatedAt,
        lastViewedAt: viewMs,
        status,
        statusLabel: statusToLabel(status)
      });
    }

    // 4. 全量保留非归档根会话并落盘（仅回收超量已归档墓碑）
    const nonArchivedPersisted = [];
    const archivedTombstones = [];
    for (const item of store.map.values()) {
      if (item.archived) archivedTombstones.push(item);
      else nonArchivedPersisted.push(item);
    }
    nonArchivedPersisted.sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
    archivedTombstones.sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
    const keptArchived = archivedTombstones.slice(0, MAX_ARCHIVED_TOMBSTONES);
    const persistedAll = [...nonArchivedPersisted, ...keptArchived];
    if (archivedTombstones.length > MAX_ARCHIVED_TOMBSTONES) {
      store.map.clear();
      for (const item of persistedAll) store.map.set(item.id, item);
    }

    // 上限淘汰 subagent 缓存：清理指向已归档根会话的状态并限制集合规模防止长驻内存膨胀
    const MAX_SUBAGENT_STATES = 500;
    const MAX_SUBAGENT_IDS = 2000;
    for (const [subId, subRec] of Array.from(store.subagentStates.entries())) {
      const rootItem = subRec?.rootId ? store.map.get(subRec.rootId) : null;
      if (rootItem && rootItem.archived) store.subagentStates.delete(subId);
    }
    if (store.subagentStates.size > MAX_SUBAGENT_STATES) {
      const sortedSubStates = Array.from(store.subagentStates.entries())
        .sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0));
      store.subagentStates.clear();
      for (const [k, v] of sortedSubStates.slice(0, MAX_SUBAGENT_STATES)) {
        store.subagentStates.set(k, v);
      }
    }
    if (store.subagentIds.size > MAX_SUBAGENT_IDS) {
      const protectedIds = new Set([...store.subagentStates.keys(), ...seenSubIds]);
      for (const sid of Array.from(store.subagentIds)) {
        if (store.subagentIds.size <= MAX_SUBAGENT_IDS) break;
        if (!protectedIds.has(sid)) {
          store.subagentIds.delete(sid);
          store.subagentRoots.delete(sid);
        }
      }
      // 极端情况下即使受保护项偏多，仍按插入顺序严格守住 MAX_SUBAGENT_IDS 容量上限
      for (const sid of Array.from(store.subagentIds)) {
        if (store.subagentIds.size <= MAX_SUBAGENT_IDS) break;
        store.subagentIds.delete(sid);
        store.subagentRoots.delete(sid);
      }
    }
    if (store.subagentRoots.size > MAX_SUBAGENT_IDS) {
      for (const sid of Array.from(store.subagentRoots.keys())) {
        if (store.subagentRoots.size <= MAX_SUBAGENT_IDS) break;
        if (!store.subagentIds.has(sid) && !store.subagentStates.has(sid)) {
          store.subagentRoots.delete(sid);
        }
      }
    }

    store.lastActiveSessionId = activeSessionId;
    const { items: allActiveConvs, catalogRevision } = buildActiveCatalogItems(store, activeSessionId, snapConvMap);
    store.catalogRevision = catalogRevision;

    const persistSig = JSON.stringify([
      store.subagentIds.size,
      Array.from(store.subagentStates.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      persistedAll.map((c) => [c.id, c.title, c.projectId, c.archived, c.pinned, c.updatedAt, c.status, c.lastViewedAt])
    ]);
    if (persistSig !== store.lastSig) {
      store.lastSig = persistSig;
      safeWriteJsonSync(store.filePath, {
        version: 2,
        updatedAt: nowMs,
        subagentIds: Array.from(store.subagentIds).sort(),
        subagentRoots: Object.fromEntries(store.subagentRoots),
        subagentStates: Object.fromEntries(store.subagentStates),
        conversations: persistedAll
      });
    }

    // 5. 基于全量未归档会话聚合并排序多项目列表（包含空项目，过滤内部空项目）
    const activeConvObj = allActiveConvs.find((c) => c.active);
    const currentProjectId = String(snap.currentProjectId || activeConvObj?.projectId || '').trim();
    const projectStats = new Map();

    const ensureProjBucket = (pid, name, seedLastActiveAt = 0, rawPath = '') => {
      const candidatePath = String(rawPath || projectsMeta.get(pid)?.primaryPath || '').trim();
      const safePath = candidatePath && !isSensitiveHostPath(candidatePath) ? candidatePath : '';
      if (!projectStats.has(pid)) {
        projectStats.set(pid, {
          id: pid,
          name: name || pid,
          ...(safePath ? { path: safePath, workspacePath: safePath } : {}),
          conversationCount: 0,
          runningCount: 0,
          waitingCount: 0,
          unreadCount: 0,
          lastActiveAt: Number(seedLastActiveAt) || 0
        });
      } else if (safePath && !projectStats.get(pid).path) {
        projectStats.get(pid).path = safePath;
        projectStats.get(pid).workspacePath = safePath;
      }
      return projectStats.get(pid);
    };

    for (const [pid, name] of projectNameMap.entries()) {
      const metaObj = projectsMeta.get(pid);
      ensureProjBucket(pid, name, metaObj?.mtimeMs || 0, metaObj?.primaryPath || '');
    }

    for (const c of allActiveConvs) {
      const pid = c.projectId || 'ungrouped';
      const bucket = ensureProjBucket(pid, c.projectName || '未归属项目');
      bucket.conversationCount += 1;
      if (c.status === 'running') bucket.runningCount += 1;
      if (c.status === 'waiting') bucket.waitingCount += 1;
      if (c.unread) bucket.unreadCount += 1;
      if (c.updatedAt > bucket.lastActiveAt) bucket.lastActiveAt = c.updatedAt;
    }

    const projects = Array.from(projectStats.values())
      .filter((p) => !(INTERNAL_EMPTY_PROJECT_IDS.has(p.id) && p.conversationCount === 0))
      .filter((p) => !(p.id === 'ungrouped' && p.conversationCount === 0))
      .map((p) => ({
        ...p,
        isEmpty: p.conversationCount === 0,
        active: Boolean(currentProjectId && p.id === currentProjectId)
      }))
      .sort((a, b) => {
        if ((a.id === 'ungrouped') !== (b.id === 'ungrouped')) {
          return a.id === 'ungrouped' ? 1 : -1;
        }
        if (b.lastActiveAt !== a.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });

    // 支持快照首屏分窗大小（0=全量，>0 时确保每项目至少前3条及当前活跃会话且总条数受控，其余通过 /api/conversations 分页拉取）
    const convLimit = options.convLimit === undefined ? 0 : Math.max(0, Number(options.convLimit) || 0);
    let outputConvs = allActiveConvs;
    if (convLimit > 0 && allActiveConvs.length > convLimit) {
      const picked = new Set();
      if (activeConvObj) picked.add(activeConvObj.id);
      const perProj = new Map();
      for (const c of allActiveConvs) {
        const cnt = perProj.get(c.projectId) || 0;
        if (cnt < 3 && picked.size < convLimit) {
          picked.add(c.id);
          perProj.set(c.projectId, cnt + 1);
        }
      }
      for (const c of allActiveConvs) {
        if (picked.size >= convLimit) break;
        picked.add(c.id);
      }
      outputConvs = allActiveConvs.filter((c) => picked.has(c.id));
    }

    const currentProj = projects.find((p) => p.id === currentProjectId);
    const currentProjectName = String(snap.currentProjectName || currentProj?.name || '').trim();
    const rawCurrentPath = String(snap.currentProjectPath || currentProj?.path || '').trim();
    const currentProjectPath = rawCurrentPath && !isSensitiveHostPath(rawCurrentPath) ? rawCurrentPath : '';
    const activeTraj = activeSessionId ? summaries[activeSessionId] : null;
    const _activeTrajSig = activeTraj
      ? `${activeTraj.status || ''}|${activeTraj.stepCount ?? ''}|${activeTraj.lastModifiedTime || ''}`
      : '';

    return {
      ...snap,
      serverBootId: REMOTE_SERVER_BOOT_ID,
      serverBootAt: REMOTE_SERVER_BOOT_AT,
      snapSeq: ++remoteServerSnapSeq,
      currentProjectId,
      currentProjectName,
      ...(currentProjectPath ? { currentProjectPath } : {}),
      catalogRevision,
      totalConversations: allActiveConvs.length,
      hasMoreConversations: outputConvs.length < allActiveConvs.length,
      projects,
      conversations: outputConvs,
      _activeTrajSig
    };
  }

  function listConversations(options = {}) {
    const store = getStickyStoreForDir(options.stateDir || getStateDir());
    const projectId = String(options.projectId || '').trim();
    const offset = Math.max(0, Number.parseInt(options.offset ?? 0, 10) || 0);
    const rawLimit = options.limit === undefined || options.limit === null || options.limit === '' ? 100 : Number.parseInt(options.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 0;
    const activeSessionId = String(options.activeSessionId ?? store.lastActiveSessionId ?? '').trim();

    const { items: allItems, catalogRevision } = buildActiveCatalogItems(store, activeSessionId, null);
    const items = projectId ? allItems.filter((c) => c.projectId === projectId) : allItems;
    const total = items.length;
    const sliced = limit > 0 ? items.slice(offset, offset + limit) : items.slice(offset);
    return {
      ok: true,
      total,
      offset,
      hasMore: offset + sliced.length < total,
      catalogRevision,
      conversations: sliced
    };
  }

  function invalidateProjectsCache() {
    projectsCache.fetchedAt = 0;
    projectsCache.data = null;
    trajCache.at = 0;
  }

  function markViewed(sessionId, viewedAtMs = Date.now(), options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid || sid === '__new__' || sid === 'new' || sid === 'follow-desktop') return false;
    const store = getStickyStoreForDir(options.dataDir || options.stateDir);
    const item = store.map.get(sid);
    if (!item) return false;
    const nextViewMs = Math.max(Number(item.lastViewedAt) || 0, Number(item.updatedAt) || 0, Number(viewedAtMs) || Date.now());
    if (nextViewMs <= (Number(item.lastViewedAt) || 0)) return false;
    item.lastViewedAt = nextViewMs;
    store.map.set(sid, item);
    store.lastSig = '';
    try {
      safeWriteJsonSync(store.filePath, {
        version: 2,
        updatedAt: Date.now(),
        subagentIds: Array.from(store.subagentIds).sort(),
        subagentRoots: Object.fromEntries(store.subagentRoots),
        subagentStates: Object.fromEntries(store.subagentStates),
        conversations: Array.from(store.map.values())
      });
    } catch {}
    return true;
  }

  return { enrichSnapshot, listConversations, invalidateProjectsCache, markViewed };
}

const defaultCatalogStore = createSessionCatalogStore();

async function enrichSnapshotWithCatalog(snap, options = {}) {
  const withCatalog = await defaultCatalogStore.enrichSnapshot(snap, options);
  return await defaultHistoryManager.enrichMessages(withCatalog, options);
}

function listCatalogConversations(options = {}) {
  return defaultCatalogStore.listConversations(options);
}

// ==================== 宿主机目录浏览、新建子目录与远程创建项目 ====================

const SENSITIVE_SYSTEM_PREFIXES = [
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private/etc',
  '/private/var',
  '/Applications/Antigravity.app'
];
const SENSITIVE_DIR_SEGMENTS_RE = /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|1Password|\.gemini|\.kube|\.docker|\.npmrc|\.netrc|keychains|\.claude|\.codex|\.gcloud|\.azure|\.password-store)(?:\/|$)/i;

function isSensitiveHostPath(absPath, options = {}) {
  const normalized = path.resolve(String(absPath || '')).replace(/\\/g, '/');
  if (!normalized) return true;
  if (SENSITIVE_DIR_SEGMENTS_RE.test(normalized)) {
    return true;
  }
  const normalizedLower = normalized.toLowerCase();
  const homeBase = String(options.homeDir || os.homedir() || '').trim();
  if (homeBase) {
    const homeNorm = path.resolve(homeBase).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let homeReal = homeNorm;
    try { homeReal = fs.realpathSync(homeBase).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); } catch {}
    for (const h of (homeReal && homeReal !== homeNorm ? [homeNorm, homeReal] : [homeNorm])) {
      for (const sub of ['/library', '/.config/op', '/.config/gh', '/.config/gcloud', '/.config/hub']) {
        const sensitiveHomePrefix = `${h}${sub}`;
        if (normalizedLower === sensitiveHomePrefix || normalizedLower.startsWith(`${sensitiveHomePrefix}/`)) {
          return true;
        }
      }
    }
  }
  // 生产环境无条件屏蔽全部系统前缀（含 /var 与 /private/var，且大小写无关以覆盖 macOS APFS）；
  // 仅在自动化测试环境（NODE_TEST_CONTEXT）下对 os.tmpdir() 内的隔离临时沙箱放行 /var 前缀以便单测运行
  let inTestTmpDir = false;
  if (!options.forceProd && (isCatalogTestEnv() || Boolean(process.env.NODE_TEST_CONTEXT))) {
    const tmpLogical = path.resolve(os.tmpdir()).replace(/\\/g, '/').toLowerCase();
    let tmpReal = tmpLogical;
    try { tmpReal = fs.realpathSync(os.tmpdir()).replace(/\\/g, '/').toLowerCase(); } catch {}
    inTestTmpDir = normalizedLower === tmpLogical
      || normalizedLower.startsWith(`${tmpLogical}/`)
      || normalizedLower === tmpReal
      || normalizedLower.startsWith(`${tmpReal}/`);
  }
  for (const prefix of SENSITIVE_SYSTEM_PREFIXES) {
    const prefixLower = prefix.toLowerCase();
    if (inTestTmpDir && (prefixLower === '/var' || prefixLower === '/private/var')) continue;
    if (normalizedLower === prefixLower || normalizedLower.startsWith(`${prefixLower}/`)) {
      return true;
    }
  }
  return false;
}

function isPathWithinRoot(candidatePath, rootPath) {
  const cand = path.resolve(String(candidatePath || ''));
  const root = path.resolve(String(rootPath || ''));
  const rel = path.relative(root, cand);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveRealPathWithFallback(targetPath) {
  const abs = path.resolve(String(targetPath || ''));
  const probeRealAt = (p) => {
    let lst = null;
    try {
      lst = fs.lstatSync(p);
    } catch (err) {
      if (err?.code === 'ENOENT') return null;
      throw Object.assign(new Error(`无法安全检查路径状态 (${err?.code || 'ERR'})`), { status: 403 });
    }
    try {
      return fs.realpathSync(p);
    } catch (err) {
      // 已存在的符号链接（悬空软链/循环软链/无权限目标）一律直接拒绝，绝不回溯拼接放行
      if (lst?.isSymbolicLink()) {
        throw Object.assign(new Error(`检测到悬空或无法解析目标的符号链接 (${err?.code || 'ERR'})，已拒绝访问`), { status: 403 });
      }
      throw Object.assign(new Error(`无法安全验证真实物理路径 (${err?.code || 'ERR'})`), { status: 403 });
    }
  };

  const directReal = probeRealAt(abs);
  if (directReal !== null) return directReal;

  // 仅当目标确实不存在（lstatSync 返回 ENOENT）时，逐级向上校验祖先 lstatSync + realpathSync
  let cur = abs;
  const pending = [];
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      throw Object.assign(new Error('无法确认目标路径的真实物理根目录，已拒绝访问'), { status: 403 });
    }
    pending.unshift(path.basename(cur));
    cur = parent;
    const ancestorReal = probeRealAt(cur);
    if (ancestorReal !== null) {
      return path.resolve(ancestorReal, ...pending);
    }
  }
}

function resolveAllowedHostRoots(options = {}) {
  const homeDir = path.resolve(String(options.homeDir || os.homedir()));
  const rawRoots = Array.isArray(options.allowedRoots) && options.allowedRoots.length > 0
    ? options.allowedRoots
    : [homeDir];
  const logicalRoots = [];
  const realRoots = [];
  const seen = new Set();
  for (const r of rawRoots) {
    const s = String(r || '').trim();
    if (!s) continue;
    const abs = path.resolve(s);
    if (seen.has(abs)) continue;
    seen.add(abs);
    logicalRoots.push(abs);
    realRoots.push(resolveRealPathWithFallback(abs));
  }
  if (!logicalRoots.length) {
    logicalRoots.push(homeDir);
    realRoots.push(resolveRealPathWithFallback(homeDir));
  }
  return { homeDir, realHomeDir: resolveRealPathWithFallback(homeDir), logicalRoots, realRoots };
}

function assertSafeHostDirectoryPath(rawPath, options = {}) {
  const { homeDir, realHomeDir, logicalRoots, realRoots } = resolveAllowedHostRoots(options);
  const resolvedPath = resolveHostPathInput(rawPath, homeDir);
  const matchedRootIdx = logicalRoots.findIndex((root) => isPathWithinRoot(resolvedPath, root));
  if (matchedRootIdx < 0) {
    throw Object.assign(new Error('目标路径超出允许访问的宿主机根目录边界'), { status: 403 });
  }
  if (isSensitiveHostPath(resolvedPath)) {
    throw Object.assign(new Error('禁止访问敏感系统或凭证目录'), { status: 403 });
  }
  // 显式经 lstatSync 检查非 ENOENT 错误（如 EACCES/ELOOP）并经 realpathSync 二次校验真实物理路径
  let lstat = null;
  try {
    lstat = fs.lstatSync(resolvedPath);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw Object.assign(new Error(`无法安全检查目标路径状态 (${err?.code || 'ERR'})`), { status: 403 });
    }
  }
  const realPath = resolveRealPathWithFallback(resolvedPath);
  const matchedRealIdx = realRoots.findIndex((root) => isPathWithinRoot(realPath, root));
  if (matchedRealIdx < 0) {
    throw Object.assign(new Error('检测到符号链接指向授权目录之外，已拒绝访问'), { status: 403 });
  }
  if (isSensitiveHostPath(realPath)) {
    throw Object.assign(new Error('检测到符号链接指向敏感目录，已拒绝访问'), { status: 403 });
  }
  return {
    resolvedPath,
    realPath,
    lstat,
    homeDir,
    realHomeDir,
    matchedRoot: logicalRoots[matchedRootIdx],
    matchedRealRoot: realRoots[matchedRealIdx],
    logicalRoots,
    realRoots
  };
}

function resolveHostPathInput(rawPath, homeDir = os.homedir()) {
  const baseHome = path.resolve(String(homeDir || os.homedir()));
  const raw = String(rawPath ?? '').trim();
  if (raw.includes('\0')) {
    throw Object.assign(new Error('目录路径包含非法字符'), { status: 400 });
  }
  if (!raw || raw === '~') return baseHome;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.resolve(baseHome, raw.slice(2));
  }
  if (!path.isAbsolute(raw)) {
    return path.resolve(baseHome, raw);
  }
  return path.resolve(raw);
}

function readGitDefaultBranchFromDisk(dirPath) {
  try {
    const gitHeadPath = path.join(dirPath, '.git', 'HEAD');
    if (fs.existsSync(gitHeadPath) && fs.statSync(gitHeadPath).isFile()) {
      const head = fs.readFileSync(gitHeadPath, 'utf8').trim();
      const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      if (m && m[1]) return m[1].trim();
    }
  } catch {}
  return '';
}

function buildUniqueSuggestedProjectName(baseName, existingNamesSet, matchedExisting) {
  if (matchedExisting?.name) return matchedExisting.name;
  const clean = String(baseName || '').trim() || 'new-project';
  const hasConflict = (candidate) => existingNamesSet.has(candidate.toLowerCase());
  if (!hasConflict(clean)) return clean;
  for (let i = 2; i < 100; i++) {
    const cand = `${clean} (${i})`;
    if (!hasConflict(cand)) return cand;
  }
  return `${clean}-${Date.now().toString(36).slice(-4)}`;
}

function listHostDirectories(options = {}) {
  const showHidden = Boolean(options.showHidden);
  const {
    resolvedPath,
    realPath,
    homeDir,
    matchedRoot,
    matchedRealRoot,
    realRoots
  } = assertSafeHostDirectoryPath(options.dirPath, options);

  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw Object.assign(new Error('无权限读取该目录'), { status: 403 });
    }
    throw Object.assign(new Error('目标路径不存在或无法访问'), { status: 400 });
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error('目标路径不是文件夹'), { status: 400 });
  }

  let dirents;
  try {
    dirents = fs.readdirSync(realPath, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw Object.assign(new Error('无权限列出该目录内容'), { status: 403 });
    }
    throw Object.assign(new Error('读取目录列表失败'), { status: 400 });
  }

  const { metaMap } = loadProjectsMetaFromDisk({
    configDir: options.configDir,
    bypassCache: options.bypassCache !== undefined ? Boolean(options.bypassCache) : true
  });
  const primaryPathMap = new Map();
  const existingNamesSet = new Set();
  for (const proj of metaMap.values()) {
    if (proj.name) existingNamesSet.add(proj.name.toLowerCase());
    if (proj.primaryPath) {
      const norm = path.resolve(proj.primaryPath);
      if (!primaryPathMap.has(norm)) {
        primaryPathMap.set(norm, { id: proj.id, name: proj.name });
      }
    }
  }

  const rootCandidates = [
    { label: '主目录 (~)', path: homeDir },
    { label: 'codebase', path: path.join(homeDir, 'codebase') },
    { label: 'shared', path: path.join(homeDir, 'shared') },
    { label: 'Projects', path: path.join(homeDir, 'Projects') },
    { label: 'Developer', path: path.join(homeDir, 'Developer') },
    { label: 'Desktop', path: path.join(homeDir, 'Desktop') },
    { label: 'Documents', path: path.join(homeDir, 'Documents') }
  ];
  const roots = [];
  const seenRoots = new Set();
  for (const rc of rootCandidates) {
    const abs = path.resolve(rc.path);
    if (seenRoots.has(abs)) continue;
    try {
      if (fs.statSync(abs).isDirectory()) {
        fs.accessSync(abs, fs.constants.R_OK);
        seenRoots.add(abs);
        roots.push({ label: rc.label, path: abs });
      }
    } catch {}
  }

  const allEntries = [];
  for (const d of dirents) {
    const name = String(d?.name || '');
    if (!name || name === '.' || name === '..') continue;
    const isHidden = name.startsWith('.');
    if (!showHidden && isHidden) continue;
    const childFull = path.join(resolvedPath, name);
    if (isSensitiveHostPath(childFull)) continue;
    let isDir = false;
    try {
      if (d.isDirectory()) {
        isDir = true;
      } else if (d.isSymbolicLink()) {
        const realChild = fs.realpathSync(childFull);
        if (!realRoots.some((r) => isPathWithinRoot(realChild, r)) || isSensitiveHostPath(realChild)) {
          continue;
        }
        if (fs.statSync(realChild).isDirectory()) isDir = true;
      }
    } catch {}
    if (!isDir) continue;
    const linked = primaryPathMap.get(childFull) || null;
    let isGitRepo = false;
    try {
      isGitRepo = fs.existsSync(path.join(childFull, '.git'));
    } catch {}
    allEntries.push({
      name,
      path: childFull,
      isHidden,
      isGitRepo,
      existingProjectId: linked?.id || '',
      existingProjectName: linked?.name || ''
    });
  }

  allEntries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
  const MAX_DIR_ENTRIES = 300;
  const truncated = allEntries.length > MAX_DIR_ENTRIES;
  const entries = truncated ? allEntries.slice(0, MAX_DIR_ENTRIES) : allEntries;

  const parsedRoot = path.parse(resolvedPath).root;
  const candidateParent = resolvedPath === parsedRoot ? '' : path.dirname(resolvedPath);
  const atBoundary = resolvedPath === matchedRoot
    || realPath === matchedRealRoot
    || !candidateParent
    || !isPathWithinRoot(candidateParent, matchedRoot);
  const parentPath = atBoundary ? '' : candidateParent;
  const currentName = path.basename(resolvedPath) || resolvedPath;
  const existingProject = primaryPathMap.get(resolvedPath) || null;
  let selfIsGitRepo = false;
  try {
    selfIsGitRepo = fs.existsSync(path.join(resolvedPath, '.git'));
  } catch {}
  const suggestedName = buildUniqueSuggestedProjectName(currentName, existingNamesSet, existingProject);

  return {
    ok: true,
    path: resolvedPath,
    currentName,
    parentPath,
    isGitRepo: selfIsGitRepo,
    existingProject,
    suggestedName,
    showHidden,
    roots,
    entries,
    truncated
  };
}

function createHostSubdirectory(payload = {}, options = {}) {
  const rawParent = String(payload?.parentPath || '').trim();
  if (!rawParent) {
    throw Object.assign(new Error('缺少父目录路径'), { status: 400 });
  }
  const { resolvedPath: resolvedParent, realPath: realParent } = assertSafeHostDirectoryPath(rawParent, options);
  let parentStat;
  try {
    parentStat = fs.statSync(realParent);
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw Object.assign(new Error('无权限访问父目录'), { status: 403 });
    }
    throw Object.assign(new Error('父目录不存在'), { status: 400 });
  }
  if (!parentStat.isDirectory()) {
    throw Object.assign(new Error('父路径不是文件夹'), { status: 400 });
  }

  const rawName = String(payload?.name || '').trim();
  if (!rawName || rawName === '.' || rawName === '..' || /[\\/\0]/.test(rawName)) {
    throw Object.assign(new Error('文件夹名称非法，不可为空或包含斜杠'), { status: 400 });
  }

  const targetPath = path.join(resolvedParent, rawName);
  const { realPath: realTargetPath } = assertSafeHostDirectoryPath(targetPath, options);
  let existingLstat = null;
  try {
    existingLstat = fs.lstatSync(targetPath);
  } catch {}
  if (existingLstat) {
    const st = fs.statSync(realTargetPath);
    if (!st.isDirectory()) {
      throw Object.assign(new Error('同名文件已存在且不是文件夹'), { status: 400 });
    }
    return { ok: true, existed: true, path: targetPath, name: rawName };
  }

  try {
    fs.mkdirSync(targetPath);
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw Object.assign(new Error('无权限在该目录创建文件夹'), { status: 403 });
    }
    throw Object.assign(new Error(err?.message || '创建文件夹失败'), { status: 500 });
  }
  return { ok: true, existed: false, path: targetPath, name: rawName };
}

async function createRemoteProject(payload = {}, options = {}) {
  const rawFolder = String(payload?.folderPath || '').trim();
  if (!rawFolder) {
    throw Object.assign(new Error('请选择项目文件夹路径'), { status: 400 });
  }
  const {
    resolvedPath,
    realPath,
    homeDir,
    realHomeDir
  } = assertSafeHostDirectoryPath(rawFolder, options);
  if (
    resolvedPath === path.parse(resolvedPath).root ||
    resolvedPath === homeDir ||
    realPath === realHomeDir
  ) {
    throw Object.assign(new Error('不支持直接以用户主目录或系统根目录作为项目，请选择具体项目子目录'), { status: 400 });
  }

  let dirStat;
  try {
    dirStat = fs.statSync(realPath);
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw Object.assign(new Error('无权限访问所选文件夹'), { status: 403 });
    }
    throw Object.assign(new Error('所选项目目录不存在'), { status: 400 });
  }
  if (!dirStat.isDirectory()) {
    throw Object.assign(new Error('所选路径不是文件夹'), { status: 400 });
  }

  const requestedName = String(payload?.name || '').trim();
  if (!requestedName) {
    throw Object.assign(new Error('请输入项目名称'), { status: 400 });
  }
  const projectName = requestedName;
  const forceNew = Boolean(payload?.forceNew);
  const requestedExistingId = String(payload?.existingProjectId || '').trim();

  const { metaMap } = loadProjectsMetaFromDisk({ configDir: options.configDir, bypassCache: true });
  let matchedExisting = null;
  for (const proj of metaMap.values()) {
    if (proj.primaryPath && path.resolve(proj.primaryPath) === resolvedPath) {
      matchedExisting = proj;
      break;
    }
  }
  if (!matchedExisting && requestedExistingId && metaMap.has(requestedExistingId)) {
    matchedExisting = metaMap.get(requestedExistingId);
  }

  if (matchedExisting && !forceNew && (!requestedName || requestedName.toLowerCase() === matchedExisting.name.toLowerCase())) {
    return {
      ok: true,
      alreadyExists: true,
      project: {
        id: matchedExisting.id,
        name: matchedExisting.name,
        folderPath: resolvedPath
      }
    };
  }

  const customConnect = options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__;
  let connectFn = customConnect;
  if (!connectFn && !isCatalogTestEnv()) {
    try {
      connectFn = require('./local-api').connect;
    } catch {}
  }

  let lsApi = null;
  if (connectFn) {
    try {
      lsApi = typeof connectFn === 'function' ? await withRaceTimeout(connectFn(), 1500, null) : connectFn;
    } catch {
      lsApi = null;
    }
  }

  if (!forceNew && requestedExistingId && lsApi && typeof lsApi.call === 'function') {
    try {
      const readRes = await withRaceTimeout(lsApi.call('ReadProject', { id: requestedExistingId }), 1500, null);
      const rp = readRes?.project;
      if (rp && rp.id === requestedExistingId && !rp.archived) {
        const rpName = String(rp.name || requestedName || '').trim();
        if (!requestedName || requestedName.toLowerCase() === rpName.toLowerCase()) {
          return {
            ok: true,
            alreadyExists: true,
            project: {
              id: rp.id,
              name: rpName,
              folderPath: resolvedPath
            }
          };
        }
      }
    } catch {}
  }

  for (const proj of metaMap.values()) {
    if (proj.name && proj.name.toLowerCase() === projectName.toLowerCase()) {
      throw Object.assign(new Error(`同名项目「${proj.name}」已存在，请修改项目名称`), { status: 400 });
    }
  }

  const folderUri = pathToFileURL(resolvedPath).href.replace(/\/+$/, '');
  let isGitRepo = false;
  try {
    isGitRepo = fs.existsSync(path.join(resolvedPath, '.git'));
  } catch {}
  let defaultBranch = isGitRepo ? readGitDefaultBranchFromDisk(resolvedPath) : '';

  if (lsApi && typeof lsApi.call === 'function') {
    try {
      const resolvedFolder = await withRaceTimeout(lsApi.call('ResolveFolder', { folderUri }), 2500, null);
      if (resolvedFolder && (resolvedFolder.resourceType === 'FOLDER_TYPE_GIT_FOLDER' || resolvedFolder.resourceType === 2)) {
        isGitRepo = true;
      }
    } catch {}
    if (isGitRepo) {
      try {
        const repoRes = await withRaceTimeout(lsApi.call('GetRepoInfos', { repoUris: [folderUri] }), 2500, null);
        const branches = Array.isArray(repoRes?.repos?.[0]?.branches) ? repoRes.repos[0].branches : [];
        if (branches.length) {
          const names = branches.map((b) => String(b?.name || '').trim()).filter(Boolean);
          const cur = branches.find((b) => b?.isCurrentBranch && b?.name)?.name;
          if (names.includes('main')) defaultBranch = 'main';
          else if (names.includes('master')) defaultBranch = 'master';
          else if (cur) defaultBranch = String(cur).trim();
          else if (names[0] && !defaultBranch) defaultBranch = names[0];
        }
      } catch {}
    }
  }

  const projectId = crypto.randomUUID();
  const resource = isGitRepo
    ? { gitFolder: { folderUri, defaultBranch: defaultBranch || '' } }
    : { folderUri };
  const projectObj = {
    id: projectId,
    name: projectName,
    projectResources: { resources: [resource] },
    permissionGrants: { v2Migrated: true },
    settings: {},
    isWorkspaceOnly: false
  };

  let created = false;
  let lastLsError = '';
  if (lsApi && typeof lsApi.call === 'function') {
    try {
      await lsApi.call('CreateProject', { project: projectObj });
      created = true;
    } catch (err) {
      lastLsError = err?.message || 'CreateProject 调用失败';
    }
  }

  const effectiveConfigDir = String(options.configDir || process.env.AG_CONFIG_DIR || '').trim()
    || (isCatalogTestEnv() ? '' : path.join(os.homedir(), '.gemini', 'config'));
  if (!created) {
    const canFallback = Boolean(options.allowDiskFallback || options.configDir || process.env.AG_CONFIG_DIR);
    if (!canFallback || !effectiveConfigDir) {
      throw Object.assign(new Error(lastLsError || '无法连接 Antigravity 语言服务以创建项目'), { status: 503 });
    }
    const projFile = path.join(effectiveConfigDir, 'projects', `${projectId}.json`);
    const writeRes = safeWriteJsonSync(projFile, projectObj, {
      indent: 2,
      validate: (d) => d && d.id === projectId && d.name === projectName
    });
    if (!writeRes?.ok) {
      throw Object.assign(new Error(writeRes?.error || '保存项目配置失败'), { status: 500 });
    }
  }

  defaultCatalogStore.invalidateProjectsCache();
  return {
    ok: true,
    alreadyExists: false,
    project: {
      id: projectId,
      name: projectName,
      folderPath: resolvedPath,
      folderUri,
      isGitRepo,
      defaultBranch
    }
  };
}

// ==================== 全量会话轨迹读取、Markdown 渲染与向上分页 ====================

function escSafeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSafeMarkdownToHtml(rawMd) {
  const src = String(rawMd || '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return '';

  const codeBlocks = [];
  const withCodePlaceholders = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escSafeHtml(String(code || '').replace(/\n$/, ''))}</code></pre>`);
    return `\n\u0000CB${idx}\u0000\n`;
  });

  const formatInline = (text) => {
    const inlineCodes = [];
    const tokens = [];
    let s = String(text || '').replace(/`([^`\n]+)`/g, (_m, c) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code>${escSafeHtml(c)}</code>`);
      return `\u0000IC${idx}\u0000`;
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label, rawUrl) => {
      const idx = tokens.length;
      if (/^https?:\/\//i.test(rawUrl)) {
        tokens.push(`<a href="${escSafeHtml(rawUrl)}" target="_blank" rel="noopener">${escSafeHtml(label)}</a>`);
      } else if (/^file:\/\//i.test(rawUrl)) {
        const hashIdx = rawUrl.indexOf('#');
        const uriPart = hashIdx >= 0 ? rawUrl.slice(0, hashIdx) : rawUrl;
        const hashPart = hashIdx >= 0 ? rawUrl.slice(hashIdx + 1) : '';
        const lineMatch = hashPart.match(/^L(\d+)/i);
        const lineNum = lineMatch ? lineMatch[1] : '';
        const localPath = normalizeLocalFileUriToPath(uriPart);
        if (localPath) {
          tokens.push(`<button type="button" class="md-file-link" data-file-path="${escSafeHtml(localPath)}"${lineNum ? ` data-file-line="${escSafeHtml(lineNum)}"` : ''}><code class="md-pill">${escSafeHtml(label)}</code></button>`);
        } else {
          tokens.push(`<code class="md-pill">${escSafeHtml(label)}</code>`);
        }
      } else {
        tokens.push(escSafeHtml(label));
      }
      return `\u0000LN${idx}\u0000`;
    });
    let escaped = escSafeHtml(s);
    escaped = escaped.replace(/\*\*([^\n*][^\n]*?[^\n*]|[^\n*])\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/(^|[^*])\*([^\s*\n][^*\n]*?[^\s*\n]|[^\s*\n])\*(?!\*)/g, '$1<em>$2</em>');
    escaped = escaped.replace(/\u0000LN(\d+)\u0000/g, (_m, idx) => tokens[Number(idx)] || '');
    escaped = escaped.replace(/\u0000IC(\d+)\u0000/g, (_m, idx) => inlineCodes[Number(idx)] || '');
    return escaped;
  };

  const splitTableCells = (line) => {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map((c) => c.trim());
  };
  const isTableSep = (line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);

  const lines = withCodePlaceholders.split('\n');
  const out = [];
  let para = [];
  let listTag = '';
  let listItems = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${para.map((ln) => formatInline(ln)).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listItems.length || !listTag) return;
    out.push(`<${listTag}>${listItems.map((it) => `<li>${formatInline(it)}</li>`).join('')}</${listTag}>`);
    listTag = '';
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    const cbMatch = trimmed.match(/^\u0000CB(\d+)\u0000$/);
    if (cbMatch) {
      flushPara();
      flushList();
      out.push(codeBlocks[Number(cbMatch[1])] || '');
      continue;
    }
    const hMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      flushPara();
      flushList();
      const lvl = hMatch[1].length;
      out.push(`<h${lvl}>${formatInline(hMatch[2])}</h${lvl}>`);
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushPara();
      flushList();
      const bqLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        bqLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      const isAlert = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(bqLines[0] || '');
      const clsAttr = isAlert ? ' class="md-alert"' : '';
      out.push(`<blockquote${clsAttr}>${bqLines.map((l) => formatInline(l)).join('<br>')}</blockquote>`);
      continue;
    }
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      flushList();
      const headers = splitTableCells(trimmed);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().includes('|') && !/^\s*$/.test(lines[i])) {
        bodyRows.push(splitTableCells(lines[i]));
        i++;
      }
      i--;
      const thead = `<thead><tr>${headers.map((h) => `<th>${formatInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = bodyRows.length
        ? `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, ci) => `<td>${formatInline(row[ci] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      out.push(`<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }
    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushPara();
      if (listTag !== 'ul') {
        flushList();
        listTag = 'ul';
      }
      listItems.push(ulMatch[1]);
      continue;
    }
    const olMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (olMatch) {
      flushPara();
      if (listTag !== 'ol') {
        flushList();
        listTag = 'ol';
      }
      listItems.push(olMatch[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
}

const LOCAL_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const SENSITIVE_MEDIA_DIR_RE = /(?:^|[\\/])(?:\.ssh|\.gnupg|\.aws|1Password|\.kube|\.docker|keychains|\.claude|\.codex|\.gcloud|\.azure|\.password-store)(?:[\\/]|$)/i;
const SENSITIVE_MEDIA_FILE_RE = /^(?:\.env.*|id_rsa.*|id_ed25519.*|id_ecdsa.*|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.zsh_history|\.bash_history|\.sh_history|\.python_history|\.node_repl_history|\.mysql_history|\.psql_history|credentials\.json|token\.json|auth\.json|.*\.(?:pem|key|p12|pfx|jks|kdbx|ovpn))$/i;

function resolveProductionMediaAllowedRoots(options = {}) {
  const roots = [];
  const pushDir = (rawDir) => {
    const clean = String(rawDir || '').trim();
    if (!clean) return;
    let real = '';
    try {
      real = fs.realpathSync(clean);
      if (!fs.statSync(real).isDirectory()) return;
    } catch {
      return;
    }
    if (!roots.includes(real)) roots.push(real);
  };

  try {
    const { metaMap } = loadProjectsMetaFromDisk({ configDir: options.configDir, bypassCache: true });
    for (const proj of metaMap.values()) {
      for (const wp of (Array.isArray(proj?.workspacePaths) ? proj.workspacePaths : [])) {
        if (!wp || isSensitiveHostPath(wp, options)) continue;
        pushDir(wp);
      }
    }
  } catch {}

  const homeBase = String(options.homeDir || os.homedir() || '').trim();
  if (homeBase) {
    pushDir(path.join(homeBase, '.gemini', 'antigravity', 'brain'));
  }
  return roots;
}

function resolveMediaAllowedRoots(options = {}) {
  let rawRoots = null;
  if (typeof options.getAllowedRoots === 'function') {
    const res = options.getAllowedRoots();
    rawRoots = Array.isArray(res) ? res : [];
  } else if (Array.isArray(options.allowedRoots) && (options.allowedRoots.length > 0 || options.strictProdRoots)) {
    rawRoots = options.allowedRoots;
  } else if (options.strictProdRoots === true || (!isCatalogTestEnv() && !process.env.NODE_TEST_CONTEXT)) {
    rawRoots = resolveProductionMediaAllowedRoots(options);
  } else {
    rawRoots = [os.homedir(), os.tmpdir()];
  }
  const realRoots = [];
  for (const r of rawRoots) {
    if (!r) continue;
    try {
      const rp = fs.realpathSync(String(r));
      if (!realRoots.includes(rp)) realRoots.push(rp);
    } catch {}
  }
  return realRoots;
}

function isAllowedBrainArtifactPath(absPath, realRoots = [], options = {}) {
  const norm = path.resolve(String(absPath || ''));
  const homeBase = String(options.homeDir || os.homedir() || '').trim();
  let homeReal = '';
  if (homeBase) {
    try { homeReal = fs.realpathSync(homeBase); } catch { homeReal = path.resolve(homeBase); }
  }
  const homeBrainRoot = homeReal ? path.join(homeReal, '.gemini', 'antigravity', 'brain') : '';
  const candidates = Array.isArray(realRoots) && realRoots.length ? realRoots : (homeReal ? [homeReal] : []);
  for (const r of candidates) {
    if (!r) continue;
    let realRoot = '';
    try { realRoot = fs.realpathSync(String(r)); } catch { realRoot = path.resolve(String(r)); }
    if (homeBrainRoot && realRoot === homeBrainRoot && (norm === homeBrainRoot || norm.startsWith(homeBrainRoot + path.sep))) {
      const rel = norm.slice(homeBrainRoot.length);
      return !SENSITIVE_MEDIA_DIR_RE.test(rel) && !isSensitiveHostPath(path.join(homeReal, rel), options);
    }
    if (isSensitiveHostPath(realRoot, options)) continue;
    const brainRoot = path.join(realRoot, '.gemini', 'antigravity', 'brain');
    if (norm === brainRoot || norm.startsWith(brainRoot + path.sep)) {
      const rel = norm.slice(brainRoot.length);
      return !SENSITIVE_MEDIA_DIR_RE.test(rel) && !isSensitiveHostPath(path.join(realRoot, rel), options);
    }
  }
  return false;
}
const SAFE_MEDIA_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};
const FORCE_DOWNLOAD_EXTS = new Set(['.html', '.htm', '.svg', '.xhtml', '.xml', '.js', '.mjs', '.cjs', '.pdf']);

function normalizeLocalFileUriToPath(rawPath) {
  let s = String(rawPath || '').trim();
  if (!s) return '';
  if (/^file:\/\//i.test(s)) {
    try {
      const { fileURLToPath } = require('url');
      s = fileURLToPath(s);
    } catch {
      try {
        s = decodeURIComponent(s.replace(/^file:\/\//i, ''));
      } catch {
        s = s.replace(/^file:\/\//i, '');
      }
    }
  }
  return s;
}

function resolveSafeLocalMediaPath(rawPath, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : LOCAL_MEDIA_MAX_BYTES;
  const candidate = normalizeLocalFileUriToPath(rawPath);
  if (!candidate || !path.isAbsolute(candidate)) {
    return { ok: false, status: 400, error: '无效的本地文件路径' };
  }
  let realPath = '';
  try {
    realPath = fs.realpathSync(candidate);
  } catch {
    return { ok: false, status: 404, error: '文件不存在或无法读取' };
  }

  const realRoots = resolveMediaAllowedRoots(options);
  const inAllowedRoot = realRoots.some((root) => realPath === root || realPath.startsWith(root + path.sep));
  if (!inAllowedRoot) {
    return { ok: false, status: 403, error: '禁止访问受限目录之外的文件' };
  }
  if (SENSITIVE_MEDIA_DIR_RE.test(realPath) || (isSensitiveHostPath(realPath, options) && !isAllowedBrainArtifactPath(realPath, realRoots, options))) {
    return { ok: false, status: 403, error: '禁止访问敏感密钥或凭证目录' };
  }
  const baseName = path.basename(realPath);
  if (SENSITIVE_MEDIA_FILE_RE.test(baseName)) {
    return { ok: false, status: 403, error: '禁止访问敏感环境或私钥文件' };
  }

  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, status: 404, error: '文件不存在' };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 400, error: '目标不是常规文件' };
  }
  if (stat.size > maxBytes) {
    return { ok: false, status: 413, error: `文件体积超过限制 (${Math.round(maxBytes / (1024 * 1024))}MB)` };
  }

  const ext = path.extname(baseName).toLowerCase();
  const forceAttachment = FORCE_DOWNLOAD_EXTS.has(ext) || !SAFE_MEDIA_MIME_BY_EXT[ext];
  const contentType = SAFE_MEDIA_MIME_BY_EXT[ext] || 'application/octet-stream';
  return {
    ok: true,
    realPath,
    baseName,
    size: stat.size,
    ext,
    contentType,
    forceAttachment
  };
}

const TREE_HIDDEN_NOISE_DIRS = new Set(['.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', '.cache', '__pycache__', '.venv']);

function listSafeProjectTree(rawDir, options = {}) {
  const showAll = Boolean(options.showAll);
  const realRoots = resolveMediaAllowedRoots(options);
  if (!realRoots.length) {
    return { ok: false, status: 403, error: '当前暂无已注册项目工作区，已禁止默认浏览系统主目录' };
  }
  const candidate = normalizeLocalFileUriToPath(rawDir || '') || realRoots[0];
  if (!candidate || !path.isAbsolute(candidate)) {
    return { ok: false, status: 400, error: '无效的目录路径' };
  }
  let realDir = '';
  try {
    realDir = fs.realpathSync(candidate);
  } catch {
    return { ok: false, status: 404, error: '目录不存在或无法访问' };
  }
  const inAllowedRoot = realRoots.some((root) => realDir === root || realDir.startsWith(root + path.sep));
  if (!inAllowedRoot) {
    return { ok: false, status: 403, error: '禁止浏览受限目录之外的路径' };
  }
  if (SENSITIVE_MEDIA_DIR_RE.test(realDir) || isSensitiveHostPath(realDir, options)) {
    return { ok: false, status: 403, error: '禁止浏览敏感密钥或凭证目录' };
  }
  let stat;
  try {
    stat = fs.statSync(realDir);
  } catch {
    return { ok: false, status: 404, error: '目录不存在' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, error: '目标不是目录' };
  }

  let dirents = [];
  try {
    dirents = fs.readdirSync(realDir, { withFileTypes: true });
  } catch (err) {
    return { ok: false, status: 403, error: err?.message || '读取目录失败' };
  }

  const entries = [];
  for (const d of dirents) {
    const name = String(d.name || '');
    if (!name) continue;
    const fullPath = path.join(realDir, name);
    let realTarget = fullPath;
    let targetStat = null;
    try {
      realTarget = fs.realpathSync(fullPath);
      targetStat = fs.statSync(realTarget);
    } catch {
      continue;
    }
    const targetInAllowedRoot = realRoots.some((root) => realTarget === root || realTarget.startsWith(root + path.sep));
    if (!targetInAllowedRoot) continue;
    if (SENSITIVE_MEDIA_DIR_RE.test(realTarget) || isSensitiveHostPath(realTarget, options)) continue;
    const isDir = targetStat.isDirectory();
    if (isDir) {
      if (!showAll && TREE_HIDDEN_NOISE_DIRS.has(name)) continue;
    } else {
      if (SENSITIVE_MEDIA_FILE_RE.test(name) || SENSITIVE_MEDIA_FILE_RE.test(path.basename(realTarget))) continue;
    }
    entries.push({
      name,
      path: fullPath,
      isDir,
      size: isDir ? 0 : (targetStat.size || 0),
      ext: isDir ? '' : path.extname(name).toLowerCase()
    });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  const parentCandidate = path.dirname(realDir);
  const canGoUp = parentCandidate !== realDir
    && realRoots.some((root) => parentCandidate === root || parentCandidate.startsWith(root + path.sep));
  return {
    ok: true,
    dir: realDir,
    parentDir: canGoUp ? parentCandidate : '',
    entries: entries.slice(0, 200),
    truncated: entries.length > 200
  };
}

function readSafeTextFilePreview(rawPath, options = {}) {
  const maxTextBytes = Number.isFinite(options.maxTextBytes) ? options.maxTextBytes : (512 * 1024);
  const checked = resolveSafeLocalMediaPath(rawPath, options);
  if (!checked.ok) return checked;
  if (/^image\//i.test(checked.contentType)) {
    return {
      ok: true,
      isImage: true,
      isBinary: false,
      isMarkdown: false,
      name: checked.baseName,
      path: checked.realPath,
      ext: checked.ext,
      size: checked.size
    };
  }
  if (checked.size > maxTextBytes) {
    return {
      ok: true,
      isImage: false,
      isBinary: false,
      isTooLargeForText: true,
      name: checked.baseName,
      path: checked.realPath,
      ext: checked.ext,
      size: checked.size,
      error: `文件较大 (${Math.round(checked.size / 1024)} KB)，超过文本预览上限 (${Math.round(maxTextBytes / 1024)} KB)`
    };
  }
  let buf;
  try {
    buf = fs.readFileSync(checked.realPath);
  } catch (err) {
    return { ok: false, status: 500, error: err?.message || '读取文件失败' };
  }
  const sampleLen = Math.min(buf.length, 4096);
  let hasNul = false;
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) { hasNul = true; break; }
  }
  if (hasNul) {
    return {
      ok: true,
      isImage: false,
      isBinary: true,
      isMarkdown: false,
      name: checked.baseName,
      path: checked.realPath,
      ext: checked.ext,
      size: checked.size
    };
  }
  const content = buf.toString('utf8');
  return {
    ok: true,
    isImage: false,
    isBinary: false,
    isMarkdown: checked.ext === '.md' || checked.ext === '.markdown',
    name: checked.baseName,
    path: checked.realPath,
    ext: checked.ext,
    size: checked.size,
    lineCount: content ? content.split(/\r?\n/).length : 0,
    content
  };
}

const SAFE_INLINE_IMAGE_MIME_RE = /^image\/(?:png|jpeg|jpg|webp|gif)$/i;
const MAX_INLINE_IMAGE_DATA_URL_CHARS = 512 * 1024;

function buildSafeInlineImageDataUrl(rawData, rawMimeType = 'image/png') {
  const s = String(rawData || '').trim();
  if (!s) return '';
  if (/^data:/i.test(s)) {
    const m = s.match(/^data:([^;,\s]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) return '';
    const mime = m[1].toLowerCase();
    if (!SAFE_INLINE_IMAGE_MIME_RE.test(mime)) return '';
    const b64 = m[2].replace(/\s+/g, '');
    if (!b64 || b64.length > MAX_INLINE_IMAGE_DATA_URL_CHARS) return '';
    return `data:${mime};base64,${b64}`;
  }
  const mime = String(rawMimeType || 'image/png').trim().toLowerCase();
  if (!SAFE_INLINE_IMAGE_MIME_RE.test(mime)) return '';
  const b64 = s.replace(/\s+/g, '');
  if (!b64 || b64.length > MAX_INLINE_IMAGE_DATA_URL_CHARS || !/^[A-Za-z0-9+/=]+$/.test(b64)) return '';
  return `data:${mime};base64,${b64}`;
}

function extractTrajectoryUserAttachments(ui) {
  if (!ui || typeof ui !== 'object') return [];
  const attachments = [];
  const seen = new Set();
  const pushAtt = (att) => {
    const inlineSig = att.inlineUrl ? crypto.createHash('sha1').update(att.inlineUrl).digest('hex') : '';
    const key = `${att.kind}|${att.path || att.uri || inlineSig || att.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    attachments.push(att);
  };
  if (Array.isArray(ui.media)) {
    for (const m of ui.media) {
      if (!m || typeof m !== 'object') continue;
      const rawUri = String(m.uri || m.fileUri || m.path || m.absoluteUri || '').trim();
      const localPath = normalizeLocalFileUriToPath(rawUri);
      const mimeType = String(m.mimeType || m.mime_type || 'image/png').trim();
      const rawInline = m.inlineData || m.inline_data || m.thumbnail || m.base64Data || m.base64_data || '';
      const inlineUrl = buildSafeInlineImageDataUrl(rawInline, mimeType);
      const isImg = Boolean(inlineUrl) || /^image\//i.test(mimeType) || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(localPath);
      const name = String(m.displayName || m.name || (localPath ? path.basename(localPath) : (isImg ? 'image.png' : 'attachment'))).trim();
      if (!localPath && !rawUri && !inlineUrl) continue;
      pushAtt({
        kind: isImg ? 'image' : 'file',
        name,
        mimeType,
        path: localPath,
        uri: rawUri,
        ...(inlineUrl ? { inlineUrl } : {})
      });
    }
  }
  if (Array.isArray(ui.images)) {
    for (const img of ui.images) {
      if (!img || typeof img !== 'object') continue;
      const rawUri = String(img.uri || img.fileUri || img.path || img.absoluteUri || '').trim();
      const localPath = normalizeLocalFileUriToPath(rawUri);
      const mimeType = String(img.mimeType || img.mime_type || 'image/png').trim();
      const rawInline = img.base64Data || img.base64_data || img.inlineData || img.inline_data || img.thumbnail || img.data || '';
      const inlineUrl = buildSafeInlineImageDataUrl(rawInline, mimeType);
      if (!localPath && !rawUri && !inlineUrl) continue;
      const name = String(img.displayName || img.name || (localPath ? path.basename(localPath) : 'image.png')).trim();
      pushAtt({
        kind: 'image',
        name,
        mimeType,
        path: localPath,
        uri: rawUri,
        ...(inlineUrl ? { inlineUrl } : {})
      });
    }
  }
  if (Array.isArray(ui.items)) {
    for (const it of ui.items) {
      const fileUri = String(it?.item?.file?.absoluteUri || '').trim();
      if (!fileUri) continue;
      const localPath = normalizeLocalFileUriToPath(fileUri);
      const name = localPath ? path.basename(localPath) : safeDecodeURIComponent(fileUri.split('/').pop() || fileUri);
      const isImg = /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name);
      pushAtt({
        kind: isImg ? 'image' : 'file',
        name,
        mimeType: isImg ? (SAFE_MEDIA_MIME_BY_EXT[path.extname(name).toLowerCase()] || 'image/png') : 'application/octet-stream',
        path: localPath,
        uri: fileUri
      });
    }
  }
  return attachments;
}

function stripDisplayMediaSuffixFromQueuedText(rawText, hasMedia = true) {
  const s = String(rawText || '');
  if (!hasMedia) return s;
  const trimmed = s.replace(/\r\n?/g, '\n').trim();
  if (/^(?:\[图片附件\]|\[图片\s*×\d+\])$/.test(trimmed)) return '';
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/(?:\n+)?\[附带\s*\d+\s*张图片\]\s*$/g, '')
    .replace(/(?:\n+)?\[图片\s*×\d+\]\s*$/g, '')
    .trim();
}

function extractRawMediaEntriesFromUserInput(ui) {
  if (!ui || typeof ui !== 'object') return [];
  const entries = [];
  const seen = new Set();
  const pushRaw = (entry) => {
    const inlineHash = entry.inlineRaw
      ? crypto.createHash('sha256').update(entry.inlineRaw).digest('hex')
      : '';
    const identity = entry.localPath
      || entry.rawUri
      || (inlineHash ? `inline:${inlineHash}|${entry.name || ''}` : '')
      || (entry.hasThumbnailOnly ? `thumb:${entry.name || ''}` : (entry.name || ''));
    const key = `${entry.kind}|${identity}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, dedupKey: key });
  };
  const inspectMediaObj = (m, forceImage = false) => {
    if (!m || typeof m !== 'object') return;
    const rawUri = String(m.uri || m.fileUri || m.path || m.absoluteUri || '').trim();
    const localPath = normalizeLocalFileUriToPath(rawUri);
    const mimeType = String(m.mimeType || m.mime_type || 'image/png').trim() || 'image/png';
    const inlineRaw = String(m.inlineData || m.inline_data || m.base64Data || m.base64_data || m.data || '').trim();
    const hasThumbnailOnly = !inlineRaw && Boolean(String(m.thumbnail || '').trim());
    const isImage = forceImage || /^image\//i.test(mimeType) || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(localPath || String(m.displayName || m.name || ''));
    const name = String(m.displayName || m.name || (localPath ? path.basename(localPath) : (isImage ? 'image.png' : 'attachment'))).trim();
    if (!localPath && !rawUri && !inlineRaw && !hasThumbnailOnly) return;
    pushRaw({
      kind: isImage ? 'image' : 'file',
      name,
      mimeType,
      localPath,
      rawUri,
      inlineRaw,
      hasThumbnailOnly,
      isImage
    });
  };
  if (Array.isArray(ui.media)) {
    for (const m of ui.media) inspectMediaObj(m, false);
  }
  if (Array.isArray(ui.images)) {
    for (const img of ui.images) inspectMediaObj(img, true);
  }
  if (Array.isArray(ui.items)) {
    for (const it of ui.items) {
      const fileUri = String(it?.item?.file?.absoluteUri || '').trim();
      if (!fileUri) continue;
      const localPath = normalizeLocalFileUriToPath(fileUri);
      const name = localPath ? path.basename(localPath) : safeDecodeURIComponent(fileUri.split('/').pop() || fileUri);
      const ext = path.extname(name).toLowerCase();
      const isImage = /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name);
      const mimeType = SAFE_MEDIA_MIME_BY_EXT[ext] || (isImage ? 'image/png' : 'application/octet-stream');
      pushRaw({
        kind: isImage ? 'image' : 'file',
        name,
        mimeType,
        localPath,
        rawUri: fileUri,
        inlineRaw: '',
        hasThumbnailOnly: false,
        isImage
      });
    }
  }
  return entries;
}

function materializeQueuedAttachmentsForEdit(rawEntries, mediaOptions = {}) {
  const list = Array.isArray(rawEntries) ? rawEntries : [];
  if (!list.length) {
    return { ok: false, attachments: [], error: '未能获取排队消息的原始附件来源' };
  }
  const out = [];
  for (const item of list) {
    let resolvedBuf = null;
    let resolvedMime = String(item?.mimeType || 'image/png').split(';')[0].trim() || 'image/png';
    let resolvedName = String(item?.name || 'attachment').trim() || 'attachment';
    if (item?.localPath) {
      const checked = resolveSafeLocalMediaPath(item.localPath, mediaOptions);
      if (checked.ok) {
        try {
          resolvedBuf = fs.readFileSync(checked.realPath);
          resolvedName = checked.baseName || resolvedName;
          const cleanContentMime = String(checked.contentType || '').split(';')[0].trim();
          if (cleanContentMime && cleanContentMime !== 'application/octet-stream') {
            resolvedMime = cleanContentMime;
          }
        } catch {
          resolvedBuf = null;
        }
      }
    }
    if (!resolvedBuf && item?.inlineRaw) {
      const dataMatch = item.inlineRaw.match(/^data:([^;,\s]+);base64,([\s\S]+)$/i);
      const cleanB64 = (dataMatch ? dataMatch[2] : item.inlineRaw).replace(/\s+/g, '');
      if (cleanB64 && /^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
        try {
          const decoded = Buffer.from(cleanB64, 'base64');
          const maxBytes = Number.isFinite(mediaOptions.maxBytes) ? mediaOptions.maxBytes : LOCAL_MEDIA_MAX_BYTES;
          if (decoded.length > 0 && decoded.length <= maxBytes) {
            resolvedBuf = decoded;
            if (dataMatch?.[1]) resolvedMime = dataMatch[1].toLowerCase();
          }
        } catch {}
      }
    }
    if (!resolvedBuf) {
      return {
        ok: false,
        attachments: [],
        error: item?.hasThumbnailOnly
          ? '排队媒体仅含缩略图且原始本地文件不可访问，已取消撤回以避免丢失原图'
          : '无法读取原始排队附件内容，已取消撤回以避免丢失附件'
      };
    }
    const isImage = Boolean(item?.isImage || /^image\//i.test(resolvedMime));
    const dataUrl = `data:${resolvedMime};base64,${resolvedBuf.toString('base64')}`;
    out.push({
      name: resolvedName,
      mimeType: resolvedMime,
      base64: dataUrl,
      size: resolvedBuf.length,
      isImage,
      previewUrl: isImage ? dataUrl : ''
    });
  }
  return { ok: true, attachments: out };
}

function formatTrajectoryUserInput(ui) {
  if (!ui || typeof ui !== 'object') return '';
  const pieces = [];
  if (Array.isArray(ui.items)) {
    for (const it of ui.items) {
      if (!it || typeof it !== 'object') continue;
      if (typeof it.text === 'string' && it.text) {
        pieces.push(it.text);
      } else if (it.item?.file?.absoluteUri) {
        const uri = String(it.item.file.absoluteUri);
        const base = safeDecodeURIComponent(uri.split('/').pop() || uri);
        pieces.push(`@${base}`);
      } else if (it.item?.directory?.absoluteUri) {
        const uri = String(it.item.directory.absoluteUri);
        const base = safeDecodeURIComponent(uri.replace(/\/+$/, '').split('/').pop() || uri);
        pieces.push(`@${base}`);
      } else if (it.item?.slashCommand?.info?.name) {
        pieces.push(`/${it.item.slashCommand.info.name}`);
      }
    }
  }
  let raw = pieces.join(' ').trim() || String(ui.userResponse || '').trim();
  const urMatch = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  if (urMatch) raw = urMatch[1];
  raw = raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<\/?USER_REQUEST>/gi, '')
    .trim();
  if (!raw || /^(?:<SYSTEM_MESSAGE>|<CONTEXT_SUMMARY>)/i.test(raw)) {
    raw = '';
  }
  if (!raw && Array.isArray(ui.media) && ui.media.length > 0) {
    raw = '[图片附件]';
  } else if (raw && Array.isArray(ui.media) && ui.media.length > 0) {
    raw += `\n[附带 ${ui.media.length} 张图片]`;
  }
  return raw;
}

function isQueuedTrajectoryUserStep(step) {
  if (!step || typeof step !== 'object') return false;
  const type = String(step.type || '');
  if (type ? type !== 'CORTEX_STEP_TYPE_USER_INPUT' : !step.userInput) return false;
  const st = String(step.status || '').trim().toUpperCase();
  return st === 'CORTEX_STEP_STATUS_QUEUED'
    || step.queued === true
    || step.userInput?.queued === true
    || step.userInput?.isQueuedMessage === true
    || step.userInput?.is_queued_message === true
    || step.metadata?.queued === true;
}

function buildQueuedStepMediaSig(uiObj) {
  return extractRawMediaEntriesFromUserInput(uiObj)
    .map((e) => String(e?.dedupKey || e?.localPath || e?.rawUri || e?.name || '').trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

function extractQueuedMessagesFromTrajectorySteps(steps, extraContainer = null) {
  const queued = [];
  const seenKey = new Set();
  const pushQueued = (stepIndex, ui) => {
    const text = formatTrajectoryUserInput(ui);
    const atts = extractTrajectoryUserAttachments(ui);
    const mediaSig = buildQueuedStepMediaSig(ui);
    const images = atts
      .filter((a) => a.kind === 'image' && (a.inlineUrl || a.path))
      .map((a) => ({
        src: a.inlineUrl || `/api/media?path=${encodeURIComponent(a.path)}`,
        alt: a.name || (a.path ? path.basename(a.path) : '图片')
      }));
    if (!text && !images.length) return;
    const key = `${stepIndex}|${text}|${mediaSig}`;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    queued.push({
      stepIndex,
      text,
      ...(images.length ? { images } : {}),
      ...(atts.length > 0 ? { hasMedia: true } : {}),
      ...(mediaSig ? { mediaSig } : {}),
      status: 'queued'
    });
  };
  if (Array.isArray(steps) && steps.length) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isQueuedTrajectoryUserStep(step)) continue;
      pushQueued(i, step.userInput);
    }
  }
  const extraList = Array.isArray(extraContainer?.queuedSteps)
    ? extraContainer.queuedSteps
    : (Array.isArray(extraContainer?.queued_steps) ? extraContainer.queued_steps : []);
  for (let j = 0; j < extraList.length; j++) {
    const qStep = extraList[j];
    if (!qStep || typeof qStep !== 'object') continue;
    const ui = qStep.userInput || qStep.user_input || qStep;
    const idx = Number.isInteger(qStep.stepIndex) ? qStep.stepIndex : (Number.isInteger(qStep.step_index) ? qStep.step_index : (Array.isArray(steps) ? steps.length + j : j));
    pushQueued(idx, ui);
  }
  return queued;
}

function decodeProtoVarint(buf, offset) {
  let val = 0;
  let mult = 1;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    val += (b & 0x7f) * mult;
    if ((b & 0x80) === 0) return [val, pos];
    mult *= 128;
    if (pos - offset > 10) return null;
  }
  return null;
}

function parseProtoFields(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return [];
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tagRes = decodeProtoVarint(buf, pos);
    if (!tagRes) return null;
    const [tag, p1] = tagRes;
    const no = Math.floor(tag / 8);
    const wt = tag & 7;
    if (no <= 0) return null;
    pos = p1;
    if (wt === 0) {
      const valRes = decodeProtoVarint(buf, pos);
      if (!valRes) return null;
      fields.push({ no, wt, val: valRes[0] });
      pos = valRes[1];
    } else if (wt === 1) {
      if (pos + 8 > buf.length) return null;
      fields.push({ no, wt, val: buf.subarray(pos, pos + 8) });
      pos += 8;
    } else if (wt === 2) {
      const lenRes = decodeProtoVarint(buf, pos);
      if (!lenRes) return null;
      const [len, p2] = lenRes;
      if (len < 0 || !Number.isSafeInteger(len) || p2 + len > buf.length) return null;
      fields.push({ no, wt, val: buf.subarray(p2, p2 + len) });
      pos = p2 + len;
    } else if (wt === 5) {
      if (pos + 4 > buf.length) return null;
      fields.push({ no, wt, val: buf.subarray(pos, pos + 4) });
      pos += 4;
    } else {
      return null;
    }
  }
  return fields;
}

function decodePendingAgentStepPayload(rawStepPayload) {
  let buf = null;
  if (Buffer.isBuffer(rawStepPayload)) {
    buf = rawStepPayload;
  } else if (rawStepPayload instanceof Uint8Array) {
    buf = Buffer.from(rawStepPayload.buffer, rawStepPayload.byteOffset, rawStepPayload.byteLength);
  } else if (typeof rawStepPayload === 'string') {
    const clean = rawStepPayload.trim();
    if (!clean || !/^[A-Za-z0-9+/=_-]+$/.test(clean)) return null;
    const normalized = clean.replace(/-/g, '+').replace(/_/g, '/');
    buf = Buffer.from(normalized, 'base64');
  } else {
    return null;
  }
  if (!buf || !buf.length) return null;
  const stepFields = parseProtoFields(buf);
  if (!stepFields || !stepFields.length) return null;
  const userInputField = stepFields.find((f) => f.no === 19 && f.wt === 2);
  if (!userInputField) return { isUserInput: false, ui: null };
  const uiFields = parseProtoFields(userInputField.val);
  if (!uiFields) return { isUserInput: false, ui: null };
  const items = [];
  const media = [];
  let query = '';
  let userResponse = '';
  for (const f of uiFields) {
    if (f.wt !== 2) continue;
    if (f.no === 1 && !query) {
      query = f.val.toString('utf8');
    } else if (f.no === 2 && !userResponse) {
      userResponse = f.val.toString('utf8');
    } else if (f.no === 3) {
      const itemFields = parseProtoFields(f.val);
      const txtField = itemFields?.find((x) => x.no === 1 && x.wt === 2);
      if (txtField) {
        items.push({ text: txtField.val.toString('utf8') });
      }
    } else if (f.no === 9) {
      const mFields = parseProtoFields(f.val);
      if (!mFields) continue;
      const mimeType = mFields.find((x) => x.no === 1 && x.wt === 2)?.val.toString('utf8') || 'image/png';
      const inlineBuf = mFields.find((x) => x.no === 2 && x.wt === 2)?.val || null;
      const uri = mFields.find((x) => x.no === 5 && x.wt === 2)?.val.toString('utf8') || '';
      const thumbBuf = mFields.find((x) => x.no === 6 && x.wt === 2)?.val || null;
      const displayName = mFields.find((x) => x.no === 9 && x.wt === 2)?.val.toString('utf8') || '';
      media.push({
        mimeType,
        ...(inlineBuf?.length ? { inlineData: inlineBuf.toString('base64') } : {}),
        ...(uri ? { uri } : {}),
        ...(thumbBuf?.length ? { thumbnail: thumbBuf.toString('base64') } : {}),
        ...(displayName ? { displayName } : {})
      });
    }
  }
  if (!items.length && query) {
    items.push({ text: query });
  }
  return {
    isUserInput: true,
    ui: {
      items,
      ...(userResponse ? { userResponse } : {}),
      ...(media.length ? { media } : {})
    }
  };
}

function hasExplicitPendingAgentMessagesUpdate(stateUpdate) {
  if (!stateUpdate || typeof stateUpdate !== 'object') return false;
  const u = (stateUpdate.update && typeof stateUpdate.update === 'object') ? stateUpdate.update : null;
  const hasField = (obj) => Boolean(
    obj && (
      (obj.pendingAgentMessagesUpdate && typeof obj.pendingAgentMessagesUpdate === 'object') ||
      (obj.pending_agent_messages_update && typeof obj.pending_agent_messages_update === 'object') ||
      Array.isArray(obj.pendingAgentMessages) ||
      Array.isArray(obj.pending_agent_messages)
    )
  );
  return hasField(u) || hasField(stateUpdate);
}

function extractPendingAgentMessagesFromUpdate(stateUpdate, options = {}) {
  if (!stateUpdate || typeof stateUpdate !== 'object') return [];
  const rawList =
    stateUpdate?.update?.pendingAgentMessagesUpdate?.pendingAgentMessages ||
    stateUpdate?.update?.pendingAgentMessagesUpdate?.pending_agent_messages ||
    stateUpdate?.update?.pending_agent_messages_update?.pendingAgentMessages ||
    stateUpdate?.update?.pending_agent_messages_update?.pending_agent_messages ||
    stateUpdate?.pendingAgentMessagesUpdate?.pendingAgentMessages ||
    stateUpdate?.pending_agent_messages_update?.pending_agent_messages ||
    stateUpdate?.update?.pendingAgentMessages ||
    stateUpdate?.update?.pending_agent_messages ||
    stateUpdate?.pendingAgentMessages ||
    stateUpdate?.pending_agent_messages ||
    [];
  if (!Array.isArray(rawList) || !rawList.length) return [];

  const onRawRecord = typeof options?.onRawRecord === 'function' ? options.onRawRecord : null;
  const out = [];
  const seenIds = new Set();
  for (let i = 0; i < rawList.length; i++) {
    const msg = rawList[i];
    if (!msg || typeof msg !== 'object') continue;
    if (msg.hideFromUser === true || msg.hide_from_user === true) continue;
    const ds = msg.deliveryStrategy ?? msg.delivery_strategy;
    if (ds === 1 || ds === '1' || ds === 'NEXT_INVOCATION' || ds === 'MESSAGE_DELIVERY_STRATEGY_NEXT_INVOCATION') {
      continue;
    }
    const messageId = String(msg.id || msg.messageId || msg.message_id || '').trim();
    const topType = String(msg.type || '').trim();
    if (topType.startsWith('CORTEX_STEP_TYPE_') && topType !== 'CORTEX_STEP_TYPE_USER_INPUT') {
      continue;
    }
    if (msg.payload && typeof msg.payload === 'object' && typeof msg.payload.case === 'string' && msg.payload.case !== 'stepPayload') {
      continue;
    }
    const rawStepPayload = msg.stepPayload ?? msg.step_payload ?? (msg.payload?.case === 'stepPayload' ? msg.payload.value : null);
    let ui = null;
    if (typeof rawStepPayload === 'string' || Buffer.isBuffer(rawStepPayload) || rawStepPayload instanceof Uint8Array) {
      const decoded = decodePendingAgentStepPayload(rawStepPayload);
      if (decoded && decoded.isUserInput === false) continue;
      ui = decoded?.ui || null;
    }
    if (!ui) {
      const stepObj = (rawStepPayload && typeof rawStepPayload === 'object' && !Buffer.isBuffer(rawStepPayload) && !(rawStepPayload instanceof Uint8Array))
        ? rawStepPayload
        : (msg.step && typeof msg.step === 'object' ? msg.step : null);
      if (stepObj) {
        const stType = String(stepObj.type || stepObj.stepType || stepObj.step_type || msg.stepType || msg.step_type || '').trim();
        if (stType && stType !== 'CORTEX_STEP_TYPE_USER_INPUT' && !/^user_?input$/i.test(stType)) {
          continue;
        }
        const stCase = String(stepObj.case || stepObj.stepCase || stepObj.step_case || stepObj.step?.case || '').trim();
        if (stCase && !/^user_?input$/i.test(stCase)) {
          continue;
        }
        const hasExplicitUserInput = Boolean(stepObj.userInput || stepObj.user_input || (Array.isArray(stepObj.items) && stepObj.items.length));
        const nonUserStepKeys = [
          'plannerResponse', 'planner_response', 'runCommand', 'run_command', 'commandStatus', 'command_status',
          'codeAction', 'code_action', 'checkpoint', 'viewFile', 'view_file', 'grepSearch', 'grep_search',
          'findByName', 'find_by_name', 'listDirectory', 'list_directory', 'notifyUser', 'notify_user',
          'taskBoundary', 'task_boundary', 'errorMessage', 'error_message'
        ];
        if (!hasExplicitUserInput && nonUserStepKeys.some((k) => stepObj[k] != null)) {
          continue;
        }
      }
      ui =
        msg.step?.userInput ||
        msg.step?.user_input ||
        (rawStepPayload && typeof rawStepPayload === 'object' ? (rawStepPayload.userInput || rawStepPayload.user_input) : null) ||
        msg.userInput ||
        msg.user_input ||
        msg.step ||
        (rawStepPayload && typeof rawStepPayload === 'object' ? rawStepPayload : null) ||
        msg;
    }
    let text = formatTrajectoryUserInput(ui);
    if (!text) {
      text = String(msg.text || msg.content || ui?.text || '').replace(/\r\n?/g, '\n').trim();
    }
    const atts = extractTrajectoryUserAttachments(ui);
    const images = atts
      .filter((a) => a.kind === 'image' && (a.inlineUrl || a.path))
      .map((a) => ({
        src: a.inlineUrl || `/api/media?path=${encodeURIComponent(a.path)}`,
        alt: a.name || (a.path ? path.basename(a.path) : '图片')
      }));
    if (!images.length && Array.isArray(ui?.media)) {
      for (const m of ui.media) {
        const inlineUrl = buildSafeInlineImageDataUrl(m?.inlineData || m?.thumbnail || m?.data || '', m?.mimeType || 'image/png');
        const p = normalizeLocalFileUriToPath(m?.uri || m?.url || '');
        if (inlineUrl || p) {
          images.push({
            src: inlineUrl || `/api/media?path=${encodeURIComponent(p)}`,
            alt: String(m?.displayName || m?.name || '图片')
          });
        }
      }
    }
    const hasMedia = images.length > 0 || (Array.isArray(ui?.media) && ui.media.length > 0) || atts.length > 0;
    if (!text && !images.length) continue;
    if (messageId) {
      if (seenIds.has(messageId)) continue;
      seenIds.add(messageId);
      if (onRawRecord) {
        try {
          onRawRecord({
            messageId,
            text,
            ui,
            hasMedia
          });
        } catch {}
      }
    }
    out.push({
      ...(messageId ? { id: messageId, messageId } : {}),
      stepIndex: -1,
      source: 'agent_state',
      text,
      ...(images.length ? { images } : {}),
      ...(hasMedia ? { hasMedia: true } : {}),
      status: 'queued'
    });
  }
  return out;
}

function isStopHookBlockedSystemStep(step, prevStep = null, steps = null, stepIndex = -1) {
  if (!step || typeof step !== 'object') return false;
  const type = String(step.type || '');
  if (type && type !== 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE') return false;
  const sysMsg = step.systemMessage;
  if (sysMsg && typeof sysMsg === 'object') {
    return /^\s*Stop hook blocked termination(?::|\b)/i.test(String(sysMsg.message || ''));
  }
  // 历史压缩（CORTEX_STEP_STATUS_CLEARED）会清空 systemMessage.message；
  // 实机 40 条轨迹 / 4079 条 SYSTEM_MESSAGE（1686 可读 + 2393 CLEARED）核验表明，
  // 非 Stop hook 可读系统消息 0/1337 命中，仅 Stop hook 阻塞步骤同时满足全部联合结构不变量：
  // CLEARED 无正文 + CORTEX_STEP_SOURCE_SYSTEM + 前驱无 toolCalls 的同 executionId PLANNER_RESPONSE +
  // 无 startedAt 且 createdAt === completedAt + 紧邻后继为同 executionId 的 PLANNER_RESPONSE（执行未结束被强行续跑）+
  // 同用户轮次后续存在至少一条带可见正文的 PLANNER_RESPONSE（确保绝不隐藏某轮唯一或最终正常回复）。
  if (
    type === 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE' &&
    String(step.status || '') === 'CORTEX_STEP_STATUS_CLEARED' &&
    !sysMsg &&
    prevStep && typeof prevStep === 'object' &&
    Array.isArray(steps) && stepIndex >= 0
  ) {
    const prevType = String(prevStep.type || '');
    const prevIsPlanner = prevType ? prevType === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' : Boolean(prevStep.plannerResponse);
    const prevHasTools = Array.isArray(prevStep.plannerResponse?.toolCalls) && prevStep.plannerResponse.toolCalls.length > 0;
    const src = String(step.metadata?.source || '').trim();
    const prevExec = String(prevStep.metadata?.executionId || '').trim();
    const curExec = String(step.metadata?.executionId || '').trim();
    const curCreated = String(step.metadata?.createdAt || '').trim();
    const curCompleted = String(step.metadata?.completedAt || '').trim();
    if (
      prevIsPlanner &&
      !prevHasTools &&
      src === 'CORTEX_STEP_SOURCE_SYSTEM' &&
      prevExec && curExec && prevExec === curExec &&
      !step.metadata?.startedAt &&
      curCreated && curCreated === curCompleted
    ) {
      const nextStep = steps[stepIndex + 1];
      const nextType = String(nextStep?.type || '');
      const nextIsPlanner = Boolean(nextStep && (nextType ? nextType === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' : nextStep.plannerResponse));
      const nextExec = String(nextStep?.metadata?.executionId || '').trim();
      if (!nextIsPlanner || !nextExec || nextExec !== curExec) return false;
      for (let j = stepIndex + 1; j < steps.length; j++) {
        const sj = steps[j];
        if (!sj || typeof sj !== 'object') continue;
        const sjType = String(sj.type || '');
        if (sjType === 'CORTEX_STEP_TYPE_USER_INPUT' || (!sjType && sj.userInput)) {
          if (isQueuedTrajectoryUserStep(sj)) continue;
          break;
        }
        const sjIsPlanner = sjType ? sjType === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' : Boolean(sj.plannerResponse);
        if (sjIsPlanner) {
          const sjText = String(sj.plannerResponse?.modifiedResponse ?? sj.plannerResponse?.response ?? '').trim();
          if (sjText) return true;
        }
      }
    }
  }
  return false;
}

function extractMessagesFromTrajectorySteps(steps, options = {}) {
  if (!Array.isArray(steps) || !steps.length) return [];
  const lazyHtml = Boolean(options?.lazyHtml);
  const messages = [];
  let turnThoughts = [];
  let turnAssistantIndices = [];

  const clearEarlierTurnThoughts = () => {
    for (const idx of turnAssistantIndices) {
      if (messages[idx]) {
        messages[idx].thoughtLabel = '';
        messages[idx].thoughtText = '';
        messages[idx].thoughts = [];
        messages[idx].thoughtCount = 0;
      }
    }
  };

  const flushPendingThoughtsOnly = (idxTag) => {
    if (!turnThoughts.length) {
      turnAssistantIndices = [];
      return;
    }
    const thoughts = turnThoughts.slice();
    if (turnAssistantIndices.length) {
      const lastIdx = turnAssistantIndices[turnAssistantIndices.length - 1];
      clearEarlierTurnThoughts();
      messages[lastIdx].thoughtLabel = '思考过程';
      messages[lastIdx].thoughtText = thoughts.join('\n\n');
      messages[lastIdx].thoughts = thoughts;
      messages[lastIdx].thoughtCount = thoughts.length;
    } else {
      messages.push({
        id: `t-think-${idxTag}`,
        role: 'assistant',
        text: '',
        html: '',
        thoughtLabel: '思考过程',
        thoughtText: thoughts.join('\n\n'),
        thoughts,
        thoughtCount: thoughts.length,
        highRisk: false,
        riskText: ''
      });
    }
    turnThoughts = [];
    turnAssistantIndices = [];
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object') continue;
    const type = String(step.type || '');
    if (type === 'CORTEX_STEP_TYPE_USER_INPUT') {
      if (isQueuedTrajectoryUserStep(step)) continue;
      const userText = formatTrajectoryUserInput(step.userInput);
      const attachments = extractTrajectoryUserAttachments(step.userInput);
      if (!userText && !attachments.length) continue;
      flushPendingThoughtsOnly(i);
      messages.push({
        id: `t-u-${i}`,
        role: 'user',
        text: userText,
        ...(attachments.length ? { attachments } : {})
      });
      continue;
    }
    if (type === 'CORTEX_STEP_TYPE_CHECKPOINT' || /COMPACT|CONTEXT_SUMMARY/i.test(type) || step.checkpoint) {
      flushPendingThoughtsOnly(i);
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'system-notice') {
        messages.push({
          id: `t-compact-${i}`,
          role: 'system-notice',
          text: '✓ 上下文已完成压缩',
          html: ''
        });
      }
      continue;
    }
    if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
      const pr = step.plannerResponse || {};
      const thought = String(pr.thinking || pr.thought || '').trim();
      if (thought) turnThoughts.push(thought);
      const replyRaw = String(pr.modifiedResponse ?? pr.response ?? '').trim();
      const hasToolCalls = Array.isArray(pr.toolCalls) && pr.toolCalls.length > 0;
      const blockedByStopHook = !hasToolCalls && isStopHookBlockedSystemStep(steps[i + 1], step, steps, i + 1);
      if (replyRaw && !blockedByStopHook) {
        clearEarlierTurnThoughts();
        const replyText = replyRaw;
        const thoughts = turnThoughts.slice();
        const thoughtText = thoughts.join('\n\n');
        messages.push({
          id: `t-a-${i}`,
          role: 'assistant',
          text: replyText,
          html: lazyHtml ? null : renderSafeMarkdownToHtml(replyText),
          thoughtLabel: thoughtText ? '思考过程' : '',
          thoughtText,
          thoughts,
          thoughtCount: thoughts.length,
          highRisk: false,
          riskText: ''
        });
        turnAssistantIndices.push(messages.length - 1);
      }
    }
  }
  flushPendingThoughtsOnly('end');
  return messages;
}

function ensureMessagesHtmlRendered(msgs, sourceList = null) {
  if (!Array.isArray(msgs)) return [];
  let srcById = null;
  for (const m of msgs) {
    if (!m || m.role !== 'assistant' || m.html !== null) continue;
    m.html = m.text ? renderSafeMarkdownToHtml(m.text) : '';
    if (Array.isArray(sourceList) && m.id) {
      if (!srcById) {
        srcById = new Map();
        for (const tm of sourceList) {
          if (tm && tm.id) srcById.set(tm.id, tm);
        }
      }
      const src = srcById.get(m.id);
      if (src && src.text === m.text) src.html = m.html;
    }
  }
  return msgs;
}

function normMsgPrefix(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function stripTablePipesAndDelims(text, frozen, sentinel) {
  const TABLE_DELIM_RE = /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/;
  const SINGLE_COL_TABLE_DELIM_RE = /^[ \t]*\|[ \t]*:?-{3,}:?[ \t]*\|[ \t]*$/;
  const lines = String(text || '').split('\n');
  const isDelim = new Array(lines.length).fill(false);
  const isTableRow = new Array(lines.length).fill(false);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!TABLE_DELIM_RE.test(line) && !SINGLE_COL_TABLE_DELIM_RE.test(line)) continue;
    if (!lines[i - 1].includes('|')) continue;
    isDelim[i] = true;
    isTableRow[i - 1] = true;
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim() || !row.includes('|')) break;
      isTableRow[j] = true;
    }
  }

  const placeholderRe = (Array.isArray(frozen) && sentinel)
    ? new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g')
    : null;

  for (let i = 0; i < lines.length; i++) {
    if (isDelim[i]) {
      lines[i] = '';
    } else if (isTableRow[i]) {
      lines[i] = lines[i].replace(/\|/g, ' ');
      if (placeholderRe) {
        lines[i].replace(placeholderRe, (_m, idxStr) => {
          const idx = Number(idxStr);
          if (typeof frozen[idx] === 'string') {
            frozen[idx] = frozen[idx].replace(/\\\|/g, '|');
          }
          return '';
        });
      }
    }
  }
  return lines.join('\n');
}

function normPlainMatchText(text) {
  let s = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
  if (!s.trim()) return '';

  let sentinel = '\u0000';
  while (s.includes(sentinel)) sentinel += '\u0001';
  const frozen = [];
  const freeze = (val) => {
    const idx = frozen.length;
    frozen.push(String(val));
    return `${sentinel}${idx}${sentinel}`;
  };

  // 1. 冻结围栏代码块正文（支持流式未闭合围栏），避免内部被后续 Markdown 正则破坏
  const rawLines = s.split('\n');
  const fenceOut = [];
  let inFence = null;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!inFence) {
      const fm = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
      if (fm && (fm[1][0] !== '`' || !fm[2].includes('`'))) {
        inFence = { ch: fm[1][0], len: fm[1].length, body: [] };
        continue;
      }
      fenceOut.push(line);
    } else {
      const cm = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (cm && cm[1][0] === inFence.ch && cm[1].length >= inFence.len) {
        fenceOut.push(freeze(inFence.body.join('\n')));
        inFence = null;
      } else {
        inFence.body.push(line);
      }
    }
  }
  if (inFence) {
    fenceOut.push(freeze(inFence.body.join('\n')));
  }
  s = fenceOut.join('\n');

  // 2. 冻结行内代码正文（兼容多反引号与文末流式未闭合反引号）
  s = s.replace(/(?<![`\\])(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, (_m, _ticks, inner) => {
    let code = inner;
    if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) {
      code = code.slice(1, -1);
    }
    return freeze(code);
  });
  s = s.replace(/(?<![`\\])(`+)(?!`)([^`\n]*)$/, (_m, _ticks, inner) => freeze(inner));

  // 3. 剥离引用链接定义与引用/GitHub Alert 前缀
  s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/^[ \t]*(?:>[ \t]*)+(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*)?/gim, '');
  }

  // 4. 冻结 Markdown 反斜杠转义字符，防止还原后被链接/标题/强调规则误改写
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>|~$])/g, (_m, ch) => freeze(ch));

  // 5. 仅对确认 GFM 表格块剥离列竖线与对齐分隔行，保留代码/非表格竖线
  s = stripTablePipesAndDelims(s, frozen, sentinel);

  // 6. 仅对非冻结 Markdown 骨架执行常规语法剥离
  for (let i = 0; i < 3; i++) {
    const next = s.replace(
      /!?\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\((?:<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g,
      '$1'
    );
    if (next === s) break;
    s = next;
  }
  s = s.replace(/(?<![\w$])!?\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\[[^\]\n]*\]/g, '$1');
  s = s.replace(/<(https?:\/\/[^>\s]+|file:\/\/[^>\s]+|mailto:[^>\s]+)>/gi, '$1');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  // 剥离常见安全内联排版 HTML 标签（严格限定白名单与合法属性语法，避免误伤 a<i && j>b、TypeScript 泛型 <T> 或正文 <tag>）
  s = s.replace(/<\/?(?:b|i|u)\s*\/?>/gi, '');
  s = s.replace(/<\/?(?:kbd|sub|sup|del|ins|strong|em|mark|small|span)(?:\s+[a-z][a-z0-9-]*(?:\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s"'=<>`]+))?)*\s*\/?>/gi, '');
  // 解码非冻结区（代码外）的常见 HTML 实体，与桌面端 DOM 渲染文本对齐
  s = s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, (ent) => {
    const lower = ent.toLowerCase();
    if (lower === '&amp;') return '&';
    if (lower === '&lt;') return '<';
    if (lower === '&gt;') return '>';
    if (lower === '&quot;') return '"';
    if (lower === '&apos;' || lower === '&#39;' || lower === '&#x27;') return "'";
    if (lower === '&nbsp;') return ' ';
    return ent;
  });
  // 剥离块级（含标准多行 $$\n...\n$$ 与单行 $$...$$）与行内 KaTeX 数学定界符（反斜杠转义 \$ 与代码块已在第 1-4 步冻结，且严格避开货币金额与变量名）
  s = s.replace(/^[ \t]*\$\$[ \t]*\n((?:(?![ \t]*\$\$[ \t]*$)(?!\s*$)[^$\n]+\n)+)[ \t]*\$\$[ \t]*$/gm, '$1');
  s = s.replace(/\$\$(?!\s)((?:[^$\n]*?[^\s$])|[^$\s])\$\$/g, '$1');
  s = s.replace(
    /(^|[^\\$\w])\$(?!\s)(?!\d+(?:[.,]\d+)?(?:\s|$))([A-Za-z0-9_\\^{}()[\]+\-*/=.,:;<>|!?' \t]+?)(?<!\s)\$(?![A-Za-z0-9_])/g,
    (full, prefix, inner) => (/[A-Za-z\\=+\-*/^_{}]/.test(inner) ? (prefix + inner) : full)
  );
  s = s.replace(/^[ \t]*(?:={3,}|-{3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/gm, '');
  s = s.replace(/^[ \t]*#{1,6}[ \t]+([^\n]*?)(?:[ \t]+#+)?[ \t]*$/gm, '$1');
  s = s.replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '');
  s = s.replace(/^[ \t]*\[[ xX]\][ \t]+/gm, '');
  s = s.replace(/(^|[^\\\w)\]])\*\*\*(?!\s)((?:[^*\n]*?[^\s*])|[^*\s])\*\*\*(?=$|[^\\\w(\[])/g, '$1$2');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(^|[^\\\w)\]])\*\*(?!\s)((?:[^*\n]*?[^\s*])|[^*\s])\*\*(?=$|[^\\\w(\[])/g, '$1$2');
  }
  s = s.replace(/(^|\n|[ \t]|[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\*\*(?=[^\s*][^*\n]*$)/, '$1');
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(^|[^\\\w)\]])~~(?!\s)((?:[^~\n]*?[^\s~])|[^~\s])~~(?=$|[^\\\w(\[])/g, '$1$2');
  }
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(^|[^\w])__([^_\n]+?)__(?=$|[^\w])/g, '$1$2');
  }
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(^|[^*\\\w)\]\n])\*(?!\s)((?:[^*\n]*?[^\s*])|[^*\s])\*(?!\*)(?=$|[^\\\w(\[])/g, '$1$2');
  }
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(^|[^\w])_(?!\s)((?:[^_\n]*?[^\s_])|[^_\s])_(?=$|[^\w])/g, '$1$2');
  }

  // 7. 还原全部冻结代码与转义文本并折叠空白
  const restoreRe = new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g');
  s = s.replace(restoreRe, (_m, idxStr) => frozen[Number(idxStr)] ?? '');
  return s.replace(/\s+/g, ' ').trim();
}

function normDomPlainText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripUserMediaMarkers(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/(?:\s*\[附带\s*\d+\s*张图片\]|\s*\[图片附件\]|\s*\[图片\s*×\d+\])+$/g, '')
    .trim();
}

function compactDomKey(text, options = {}) {
  const raw = options.stripUserMediaSuffix ? stripUserMediaMarkers(text) : String(text || '');
  return normDomPlainText(raw).replace(/\s+/g, '').toLowerCase();
}

function compactBaseKey(text, options = {}) {
  const raw = options.stripUserMediaSuffix ? stripUserMediaMarkers(text) : String(text || '');
  const compact = normPlainMatchText(raw).replace(/\s+/g, '').toLowerCase();
  if (compact) return compact;
  return raw.replace(/\s+/g, '').toLowerCase();
}

function stripTrailingEllipsis(s) {
  return String(s || '').replace(/(?:\.{3,}|…+)$/g, '');
}

const DOM_UI_CHROME_TOKEN = '(?:'
  + '(?:(?:javascript|typescript|python|bash|shell|zsh|sh|json|yaml|yml|html|css|scss|less|sql|golang|go|rust|java|cpp|c\\+\\+|csharp|c#|ruby|php|swift|kotlin|markdown|md|xml|toml|ini|diff|plaintext|text|txt|jsx|tsx|js|ts|py|rb|rs|cs|mermaid)?(?:copycode|copied|copy|复制代码|已复制|复制))'
  + '|(?:important|warning|caution|note|tip)'
  + '|(?:重要提示|提示信息|注意事项|警告提示)'
  + ')';
const DOM_UI_CHROME_STRICT_RE = new RegExp(`^(?:${DOM_UI_CHROME_TOKEN}[:：·•\\-|]*)+$`);
const DOM_UI_CHROME_COPY_ONLY_RE = /^(?:(?:copycode|copied|copy|复制代码|已复制|复制)[:：·•\-|]*)+$/;
const DOM_ALERT_CHROME_BY_TYPE = {
  note: /^(?:(?:note|提示信息)[:：·•\-|]*)+$/,
  tip: /^(?:(?:tip|提示信息)[:：·•\-|]*)+$/,
  important: /^(?:(?:important|重要提示|提示信息)[:：·•\-|]*)+$/,
  warning: /^(?:(?:warning|注意事项|警告提示)[:：·•\-|]*)+$/,
  caution: /^(?:(?:caution|注意事项|警告提示)[:：·•\-|]*)+$/
};

function buildBaseChromeSlots(markdownText) {
  const slots = new Map();
  const addSlot = (pos, slot) => {
    if (!Number.isInteger(pos) || pos < 0) return;
    let list = slots.get(pos);
    if (!list) {
      list = [];
      slots.set(pos, list);
    }
    list.push(slot);
  };
  const lines = String(markdownText || '').replace(/\r\n?/g, '\n').split('\n');
  let inFence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inFence) {
      const fm = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*([a-z0-9+#._-]{0,24})[^\n]*$/i);
      if (fm) {
        const lang = String(fm[2] || '').toLowerCase();
        const pos = stripTrailingEllipsis(compactBaseKey(lines.slice(0, i).join('\n'))).length;
        addSlot(pos, { kind: 'code', lang });
        inFence = { ch: fm[1][0], len: fm[1].length, lang };
        continue;
      }
      const am = line.match(/^[ \t]*(?:>[ \t]*)+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+|$)/i);
      if (am) {
        const alertType = String(am[1] || '').toLowerCase();
        const pos = stripTrailingEllipsis(compactBaseKey(lines.slice(0, i).join('\n'))).length;
        addSlot(pos, { kind: 'alert', alertType });
      }
    } else {
      const cm = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (cm && cm[1][0] === inFence.ch && cm[1].length >= inFence.len) {
        const endPos = stripTrailingEllipsis(compactBaseKey(lines.slice(0, i + 1).join('\n'))).length;
        addSlot(endPos, { kind: 'code-end', lang: inFence.lang });
        inFence = null;
      }
    }
  }
  return slots;
}

function hasDomRawBoundaryBetween(rawText, rawStartOffsets, gapEndIdx) {
  if (!rawText || !Array.isArray(rawStartOffsets) || gapEndIdx <= 0 || gapEndIdx >= rawStartOffsets.length) return true;
  const prevRaw = rawStartOffsets[gapEndIdx - 1];
  const nextRaw = rawStartOffsets[gapEndIdx];
  if (!Number.isInteger(prevRaw) || !Number.isInteger(nextRaw)) return true;
  if (nextRaw > prevRaw + 1) {
    const between = rawText.slice(prevRaw + 1, nextRaw);
    if (/[\s\n\r]/.test(between)) return true;
  }
  const prevCh = rawText[prevRaw] || '';
  const nextCh = rawText[nextRaw] || '';
  // 若前一个字符与后一个字符同为连续英文字母/数字且中间无空白分隔（如 notebook 中 note 与 book），不得拆词跳过
  if (/[a-z0-9]/i.test(prevCh) && /[a-z0-9]/i.test(nextCh)) return false;
  return true;
}

function decodeBasicHtmlEntities(str) {
  return String(str || '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, (ent) => {
    const lower = ent.toLowerCase();
    if (lower === '&amp;') return '&';
    if (lower === '&lt;') return '<';
    if (lower === '&gt;') return '>';
    if (lower === '&quot;') return '"';
    if (lower === '&apos;' || lower === '&#39;' || lower === '&#x27;') return "'";
    if (lower === '&nbsp;') return ' ';
    return ent;
  });
}

function extractDomCopyButtonCodeStarts(domMsg) {
  const html = String(domMsg?.html || '');
  if (!html || !/<button\b/i.test(html) || !/<code\b/i.test(html)) return null;
  const starts = [];
  const btnRe = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = btnRe.exec(html)) !== null) {
    const btnText = decodeBasicHtmlEntities(String(m[1] || '').replace(/<[^>]+>/g, '')).trim();
    if (!/^(?:Copy(?:\s*Code)?|Copied|复制代码|已复制|复制)$/i.test(btnText)) continue;
    const rest = html.slice(btnRe.lastIndex);
    const nextCodeMatch = rest.match(/^(?:\s|<(?!\/?(?:button|code)\b)\/?[a-z][a-z0-9-]*(?:\s+[^>]*)?>)*<code\b[^>]*>([\s\S]*?)<\/code>/i);
    if (!nextCodeMatch) continue;
    const innerText = decodeBasicHtmlEntities(String(nextCodeMatch[1] || '').replace(/<[^>]+>/g, ''));
    const compactCode = stripTrailingEllipsis(compactDomKey(innerText));
    if (compactCode) starts.push(compactCode);
    if (starts.length >= 24) break;
  }
  return starts.length ? starts : null;
}

function matchesCopyButtonCodeEvidence(copyButtonCodeStarts, dClean, gapEndIdx) {
  if (!Array.isArray(copyButtonCodeStarts) || !copyButtonCodeStarts.length) return false;
  const after = String(dClean || '').slice(gapEndIdx);
  if (!after) return false;
  for (const codeCompact of copyButtonCodeStarts) {
    if (!codeCompact) continue;
    if (after.startsWith(codeCompact)) return true;
    const minPrefix = Math.min(16, codeCompact.length, after.length);
    if (minPrefix >= 6 && codeCompact.startsWith(after.slice(0, minPrefix)) && after.length <= codeCompact.length) {
      return true;
    }
  }
  return false;
}

function isGluedLangCopyChrome(rawGap, expectedLang = '') {
  const s = String(rawGap || '');
  // 仅当紧邻 <button>Copy</button> 后的 <code> 正文确以跳过后的代码起始（而非 pyCopyright 自身），
  // 且语言标签与 Copy/Copied/复制代码 之间无空白/标点分隔时才允许无词边界跳过。
  if (!s || /[\s:：·•\-|]/.test(s)) return false;
  if (expectedLang) {
    if (!s.toLowerCase().startsWith(String(expectedLang).toLowerCase())) return false;
    const tail = s.slice(String(expectedLang).length);
    return /^(?:CopyCode|Copy|Copied|复制代码|已复制|复制)$/.test(tail);
  }
  return /^[a-z0-9_+#.-]+(?:CopyCode|Copy|Copied|复制代码|已复制|复制)$/i.test(s)
    && /(?:CopyCode|Copy|Copied|复制代码|已复制|复制)$/.test(s);
}

function isAllowedDomChromeGapAt(gap, tiPos, chromeSlots, boundaryOk = true, rawGap = '', allowGluedCopyChrome = false) {
  if (!gap || gap.length > 48) return false;
  if (tiPos === 0 && DOM_UI_CHROME_STRICT_RE.test(gap)) {
    const hasLangAndCopyChrome = !DOM_UI_CHROME_COPY_ONLY_RE.test(gap) && /(?:copycode|copied|copy|复制代码|已复制|复制)[:：·•\-|]*$/.test(gap);
    if (boundaryOk || (allowGluedCopyChrome && hasLangAndCopyChrome && isGluedLangCopyChrome(rawGap))) return true;
    return false;
  }
  const list = chromeSlots?.get?.(tiPos);
  if (!Array.isArray(list) || !list.length) return false;
  for (const slot of list) {
    if (slot.kind === 'code') {
      // 代码块槽位必须包含明确的复制按钮铬（Copy/复制代码 等）与真实词边界；
      // 无后继词边界的紧贴复合铬仅在该处紧邻 <button>Copy</button> 后的 <code> 确以跳过后正文起始时放行，
      // 彻底杜绝将 <code> 内的 pyCopyright（即使同消息存在 <button>Copy</button>）误拆为按钮铬与 right。
      if (DOM_UI_CHROME_COPY_ONLY_RE.test(gap) && boundaryOk) return true;
      if (slot.lang && gap.startsWith(slot.lang)) {
        const rest = gap.slice(slot.lang.length).replace(/^[:：·•\-|]+/, '');
        if (rest && DOM_UI_CHROME_COPY_ONLY_RE.test(rest) && (boundaryOk || (allowGluedCopyChrome && isGluedLangCopyChrome(rawGap, slot.lang)))) return true;
      }
    } else if (slot.kind === 'code-end') {
      if (DOM_UI_CHROME_COPY_ONLY_RE.test(gap) && boundaryOk) return true;
    } else if (slot.kind === 'alert') {
      const re = DOM_ALERT_CHROME_BY_TYPE[slot.alertType];
      if (re && re.test(gap) && boundaryOk) return true;
    }
  }
  return false;
}

function consumeBaseFromDomWithChrome(tClean, dClean, startPos = 0, chromeSlots = null, domIndex = null, copyButtonCodeStarts = null) {
  if (!tClean || !dClean || startPos < 0 || startPos >= dClean.length) return -1;
  const rawDom = domIndex?.raw || '';
  const rawOffsets = domIndex?.rawStartOffsets || null;
  let ti = 0;
  let di = startPos;
  let skippedChrome = 0;
  const MAX_CHROME_GAPS = 24;
  while (ti < tClean.length && di < dClean.length) {
    if (tClean[ti] === dClean[di]) {
      ti += 1;
      di += 1;
      continue;
    }
    if (skippedChrome >= MAX_CHROME_GAPS) return -1;
    // 允许最多回退 12 个已匹配字符，处理 UI 铬与后续正文共享前缀的场景（如 shCopy 插在 sudoaptupdate 前先消费了 's'），且仅在对应结构槽位允许跳过
    const maxBack = Math.min(ti, 12);
    let matchedTi = -1;
    let matchedDi = -1;
    for (let back = 0; back <= maxBack; back += 1) {
      const ti2 = ti - back;
      const di2 = di - back;
      if (di2 < startPos) break;
      if (ti2 > 0 && !chromeSlots?.has?.(ti2)) continue;
      const remT = tClean.length - ti2;
      const probeLen = Math.min(8, remT);
      const probe = tClean.slice(ti2, ti2 + probeLen);
      const searchEnd = Math.min(dClean.length, di2 + 48);
      let searchFrom = di2 + 1;
      while (searchFrom < searchEnd) {
        const idx = dClean.indexOf(probe, searchFrom);
        if (idx < 0 || idx > searchEnd) break;
        const gap = dClean.slice(di2, idx);
        const boundaryOk = hasDomRawBoundaryBetween(rawDom, rawOffsets, idx);
        const rawGapStart = Array.isArray(rawOffsets) && Number.isInteger(rawOffsets[di2]) ? rawOffsets[di2] : -1;
        const rawGapEnd = Array.isArray(rawOffsets) && idx > 0 && Number.isInteger(rawOffsets[idx - 1]) ? (rawOffsets[idx - 1] + 1) : -1;
        const rawGap = (rawDom && rawGapStart >= 0 && rawGapEnd > rawGapStart) ? rawDom.slice(rawGapStart, rawGapEnd) : gap;
        const allowGluedAtSlot = !boundaryOk && matchesCopyButtonCodeEvidence(copyButtonCodeStarts, dClean, idx);
        if (isAllowedDomChromeGapAt(gap, ti2, chromeSlots, boundaryOk, rawGap, allowGluedAtSlot)) {
          matchedTi = ti2;
          matchedDi = idx;
          break;
        }
        searchFrom = idx + 1;
      }
      if (matchedDi >= 0) break;
    }
    if (matchedDi < 0) return -1;
    ti = matchedTi;
    di = matchedDi;
    skippedChrome += 1;
  }
  if (ti < tClean.length) return -1;
  if (di < dClean.length) {
    const trailing = dClean.slice(di);
    const rawTrailStart = Array.isArray(rawOffsets) && Number.isInteger(rawOffsets[di]) ? rawOffsets[di] : -1;
    const rawTrail = (rawDom && rawTrailStart >= 0) ? rawDom.slice(rawTrailStart) : trailing;
    if (isAllowedDomChromeGapAt(trailing, tClean.length, chromeSlots, true, rawTrail, false)) {
      di = dClean.length;
    }
  }
  return di;
}

function isMarkdownSourcedIncoming(msg, options = {}) {
  if (options.isolated || options.domIsMarkdown) return true;
  const id = String(msg?.id || '');
  return /^rpc-(?:u|a|e|think)-/.test(id);
}

function classifyAssistantMatchDetail(baseText, domText, options = {}) {
  if (options.domIsMarkdown && !options.baseIsDom) {
    const rawBase = String(baseText || '').trim();
    const rawDom = String(domText || '').trim();
    if (rawBase && rawDom) {
      if (rawBase === rawDom) return { tier: 3, hasStreamingGrowth: false };
      if (!options.exactOnly && String(domText || '').length >= 3900 && rawDom.length >= 3900 && rawBase.length > rawDom.length && rawBase.startsWith(rawDom)) {
        return { tier: 3, hasStreamingGrowth: false };
      }
    }
  }
  const tKey = (options.baseIsDom || options.domIsMarkdown) ? compactDomKey(baseText) : compactBaseKey(baseText);
  const dKey = (options.baseIsDom && options.domIsMarkdown) ? compactBaseKey(domText) : compactDomKey(domText);
  if (!tKey || !dKey) return { tier: 0, hasStreamingGrowth: false };

  const tClean = stripTrailingEllipsis(tKey);
  const dClean = stripTrailingEllipsis(dKey);
  if (!tClean || !dClean) return { tier: 0, hasStreamingGrowth: false };

  if (options.baseIsDom && !options.domIsMarkdown) {
    const bNorm = stripTrailingEllipsis(normDomPlainText(baseText).toLowerCase());
    const dNorm = stripTrailingEllipsis(normDomPlainText(domText).toLowerCase());
    if (bNorm === dNorm) return { tier: 3, hasStreamingGrowth: false };
    if (options.exactOnly) return { tier: 0, hasStreamingGrowth: false };
    const shorterN = bNorm.length <= dNorm.length ? bNorm : dNorm;
    const longerN = bNorm.length <= dNorm.length ? dNorm : bNorm;
    if (longerN.startsWith(shorterN) && (
      shorterN.length >= 10 ||
      (options.busy && shorterN.length >= 4) ||
      (options.allowCoveredPrefix && dNorm.startsWith(bNorm) && bNorm.length >= 4) ||
      (shorterN.length >= 6 && (shorterN.length / longerN.length) >= 0.6)
    )) {
      return { tier: 2, hasStreamingGrowth: dNorm.length > bNorm.length && dNorm.startsWith(bNorm) };
    }
    return { tier: 0, hasStreamingGrowth: false };
  }

  if (tKey === dKey || (tClean === dClean && Math.min(tClean.length, dClean.length) >= 8)) {
    return { tier: 3, hasStreamingGrowth: false };
  }
  if (options.exactOnly) return { tier: 0, hasStreamingGrowth: false };

  const shorter = tClean.length <= dClean.length ? tClean : dClean;
  const longer = tClean.length <= dClean.length ? dClean : tClean;
  if (longer.startsWith(shorter) && (
    shorter.length >= 10 ||
    (options.busy && shorter.length >= 4) ||
    (options.allowCoveredPrefix && dClean.startsWith(tClean) && tClean.length >= 4) ||
    (shorter.length >= 6 && (shorter.length / longer.length) >= 0.6)
  )) {
    return { tier: 2, hasStreamingGrowth: dClean.length > tClean.length && dClean.startsWith(tClean) };
  }

  // Tier 1 仅在轨迹 Markdown 对应的结构槽位（围栏代码块起止、GitHub Alert 头部及文首前缀）允许跳过可识别的桌面 UI 装饰
  if (!options.baseIsDom && !options.domIsMarkdown && tClean.length >= 12 && dClean.length > tClean.length) {
    const chromeSlots = buildBaseChromeSlots(baseText);
    const domIndex = buildCompactDomIndex(domText);
    const endPos = consumeBaseFromDomWithChrome(tClean, dClean, 0, chromeSlots, domIndex, options.copyButtonCodeStarts || null);
    if (endPos > 0) {
      const tailAfter = dClean.length - endPos;
      if (tailAfter === 0 || Boolean(options.busy) || Boolean(options.allowCoveredPrefix)) {
        return { tier: 1, hasStreamingGrowth: tailAfter > 0 };
      }
    }
  }
  return { tier: 0, hasStreamingGrowth: false };
}

function classifyAssistantMatch(baseText, domText, options = {}) {
  return classifyAssistantMatchDetail(baseText, domText, options).tier;
}

function hasUserAttachmentOrMediaMarker(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) return true;
  if (Array.isArray(msg.images) && msg.images.length > 0) return true;
  if (msg.hasMedia) return true;
  return /\[(?:附带\s*\d+\s*张图片|图片附件|图片\s*×\d+)\]/.test(String(msg.text || ''));
}

function isSameUserMessage(baseMsg, domMsg, options = {}) {
  if (!baseMsg || !domMsg) return false;
  const bStripped = stripUserMediaMarkers(baseMsg.text);
  const dStripped = stripUserMediaMarkers(domMsg.text);
  const bRawKey = compactDomKey(bStripped);
  const bMdKey = options.baseIsDom ? bRawKey : compactBaseKey(bStripped);
  const dRawKey = compactDomKey(dStripped);
  const dMdKey = options.domIsMarkdown ? compactBaseKey(dStripped) : dRawKey;
  if ((bRawKey || bMdKey) && (dRawKey || dMdKey)) {
    if (
      bRawKey === dRawKey ||
      (!options.baseIsDom && !options.domIsMarkdown && bMdKey && bMdKey === dRawKey) ||
      (options.baseIsDom && options.domIsMarkdown && dMdKey && bRawKey === dMdKey)
    ) {
      return true;
    }
    if (
      options.domIsMarkdown &&
      String(domMsg.text || '').length >= 3900 &&
      dStripped.length >= 3900 &&
      bStripped.length > dStripped.length &&
      bStripped.startsWith(dStripped)
    ) {
      return true;
    }
    const domRawTrimmed = String(domMsg.text || '').trim();
    if (domRawTrimmed.endsWith('…') || dStripped.endsWith('…')) {
      const dClean = stripTrailingEllipsis(dRawKey);
      if (
        dClean.length >= 200 && (
          (bRawKey.length > dClean.length && bRawKey.startsWith(dClean)) ||
          (!options.baseIsDom && bMdKey.length > dClean.length && bMdKey.startsWith(dClean))
        )
      ) {
        return true;
      }
    }
    return false;
  }
  if (!bRawKey && !bMdKey && !dRawKey && !dMdKey) {
    return hasUserAttachmentOrMediaMarker(baseMsg) && hasUserAttachmentOrMediaMarker(domMsg);
  }
  return false;
}

function collapseConsecutiveDomThinking(domMessages) {
  const raw = Array.isArray(domMessages) ? domMessages.filter(Boolean) : [];
  const out = [];
  let turnThoughts = [];
  let turnLabel = '';
  let turnCount = 0;
  let turnAssistantIndices = [];

  const clearEarlierTurnThoughts = () => {
    for (const idx of turnAssistantIndices) {
      if (out[idx]) {
        out[idx].thoughtLabel = '';
        out[idx].thoughtText = '';
        out[idx].thoughts = [];
        out[idx].thoughtCount = 0;
      }
    }
  };

  const flush = (tag) => {
    if (!turnThoughts.length && !turnLabel) {
      turnAssistantIndices = [];
      return;
    }
    const thoughts = turnThoughts.slice();
    if (turnAssistantIndices.length) {
      const lastIdx = turnAssistantIndices[turnAssistantIndices.length - 1];
      clearEarlierTurnThoughts();
      out[lastIdx].thoughtLabel = turnLabel || '思考过程';
      out[lastIdx].thoughtText = thoughts.join('\n\n');
      out[lastIdx].thoughts = thoughts;
      out[lastIdx].thoughtCount = Math.max(thoughts.length, turnCount, 1);
    } else {
      out.push({
        id: `dom-think-${tag}`,
        role: 'assistant',
        text: '',
        html: '',
        thoughtLabel: turnLabel || '思考过程',
        thoughtText: thoughts.join('\n\n'),
        thoughts,
        thoughtCount: Math.max(thoughts.length, turnCount, 1),
        highRisk: false,
        riskText: ''
      });
    }
    turnThoughts = [];
    turnLabel = '';
    turnCount = 0;
    turnAssistantIndices = [];
  };
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (m.role === 'user') {
      flush(i);
      out.push(m);
      continue;
    }
    const hasBody = Boolean(normMsgPrefix(m.text) || String(m.html || '').trim() || m.highRisk);
    const mThoughts = Array.isArray(m.thoughts) && m.thoughts.length
      ? m.thoughts.map((t) => String(t || '').trim()).filter(Boolean)
      : (String(m.thoughtText || '').trim() ? [String(m.thoughtText).trim()] : []);
    if (mThoughts.length) turnThoughts.push(...mThoughts);
    if (m.thoughtLabel && !turnLabel) turnLabel = m.thoughtLabel;
    turnCount += Math.max(mThoughts.length, Number(m.thoughtCount) || (m.thoughtLabel ? 1 : 0));
    if (!hasBody) continue;
    clearEarlierTurnThoughts();
    const mergedThoughts = turnThoughts.slice();
    const mergedCount = Math.max(mergedThoughts.length, turnCount, turnLabel ? 1 : 0);
    const mergedLabel = turnLabel || (mergedThoughts.length ? '思考过程' : '');
    out.push({
      ...m,
      thoughtLabel: mergedLabel,
      thoughtText: mergedThoughts.join('\n\n') || String(m.thoughtText || ''),
      ...(mergedThoughts.length ? { thoughts: mergedThoughts } : {}),
      ...(mergedCount ? { thoughtCount: mergedCount } : {})
    });
    turnAssistantIndices.push(out.length - 1);
  }
  flush('end');
  return out;
}

function buildCompactDomIndex(rawText) {
  const raw = String(rawText || '');
  let compact = '';
  const rawStartOffsets = [];
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i);
    const chLen = cp > 0xffff ? 2 : 1;
    const ch = raw.slice(i, i + chLen);
    if (!/[\s\u200b-\u200d\ufeff]/.test(ch)) {
      const lowered = ch.toLowerCase();
      for (let j = 0; j < lowered.length; j++) {
        rawStartOffsets.push(i);
      }
      compact += lowered;
    }
    i += chLen;
  }
  return { raw, compact, rawStartOffsets };
}

function matchConcatenatedTurnDom(dmText, baseEntries, baseOverwrittenByDom, allowBusyTail = false, allowCoveredTail = false, copyButtonCodeStarts = null) {
  if (!Array.isArray(baseEntries) || baseEntries.length < 2) return null;
  const textEntries = baseEntries.filter((entry) => {
    const item = entry?.item;
    if (!item || item.role !== 'assistant') return false;
    const bk = stripTrailingEllipsis(
      baseOverwrittenByDom?.has(item) ? compactDomKey(item.text) : compactBaseKey(item.text)
    );
    return Boolean(bk);
  });
  if (textEntries.length < 2) return null;
  const { raw, compact, rawStartOffsets } = buildCompactDomIndex(dmText);
  const dClean = stripTrailingEllipsis(compact);
  if (!dClean) return null;
  let pos = 0;
  let lastStartPos = 0;
  const matched = [];
  for (const entry of textEntries) {
    const item = entry.item;
    const bk = stripTrailingEllipsis(
      baseOverwrittenByDom?.has(item) ? compactDomKey(item.text) : compactBaseKey(item.text)
    );
    if (bk) {
      let nextPos = -1;
      if (dClean.startsWith(bk, pos)) {
        nextPos = pos + bk.length;
      } else if (!baseOverwrittenByDom?.has(item) && bk.length >= 12) {
        nextPos = consumeBaseFromDomWithChrome(bk, dClean, pos, buildBaseChromeSlots(item.text), { raw, compact, rawStartOffsets }, copyButtonCodeStarts);
      }
      if (nextPos > pos) {
        lastStartPos = pos;
        pos = nextPos;
        matched.push(entry);
      }
    }
  }
  if (matched.length >= 2 && pos === dClean.length) {
    return { matched, target: matched[matched.length - 1], streamingTailText: '' };
  }
  const lastEntry = textEntries[textEntries.length - 1];
  if ((allowBusyTail || allowCoveredTail) && matched.length >= 2 && matched[matched.length - 1] === lastEntry && pos < dClean.length) {
    const bkLast = stripTrailingEllipsis(
      baseOverwrittenByDom?.has(lastEntry.item) ? compactDomKey(lastEntry.item.text) : compactBaseKey(lastEntry.item.text)
    );
    if (bkLast.length >= 4 || pos >= 4) {
      const rawSliceStart = rawStartOffsets[lastStartPos];
      const streamingTailText = allowBusyTail && Number.isInteger(rawSliceStart)
        ? raw.slice(rawSliceStart).trim()
        : '';
      return { matched, target: lastEntry, streamingTailText };
    }
  }
  return null;
}

function findUserAnchorAlignment(baseList, domList, options = {}) {
  const baseUserIndices = [];
  for (let i = 0; i < baseList.length; i++) {
    if (baseList[i]?.role === 'user') baseUserIndices.push(i);
  }
  const domUserIndices = [];
  for (let i = 0; i < domList.length; i++) {
    if (domList[i]?.role === 'user') domUserIndices.push(i);
  }
  const M = baseUserIndices.length;
  const K = domUserIndices.length;
  if (!M || !K) return { startAppendIdx: -1, alignedTurnPairs: [] };

  const getTurnAssistants = (list, userIndices, pos, isDom) => {
    const start = userIndices[pos] + 1;
    const end = pos + 1 < userIndices.length ? userIndices[pos + 1] : list.length;
    const items = [];
    for (let i = start; i < end; i++) {
      const m = list[i];
      if (!m || m.role !== 'assistant') continue;
      const hasKey = isDom
        ? compactDomKey(m.text)
        : (options.isolated ? compactDomKey(m.text) : compactBaseKey(m.text));
      if (hasKey) items.push(m);
    }
    return items;
  };

  const scoreTurnAssistants = (baseTurnPos, domTurnPos) => {
    const bAsst = getTurnAssistants(baseList, baseUserIndices, baseTurnPos, false);
    const dAsst = getTurnAssistants(domList, domUserIndices, domTurnPos, true);
    if (!bAsst.length || !dAsst.length) return 0;
    const isActiveTail = Boolean(options.busy && baseTurnPos === M - 1 && domTurnPos === K - 1);
    for (const bm of bAsst) {
      for (const dm of dAsst) {
        if (classifyAssistantMatch(bm.text, dm.text, {
          busy: isActiveTail,
          domIsMarkdown: isMarkdownSourcedIncoming(dm, options),
          copyButtonCodeStarts: extractDomCopyButtonCodeStarts(dm)
        }) > 0) {
          return 1;
        }
      }
    }
    if (bAsst.length >= 2) {
      const baseAsEntries = bAsst.map((item) => ({ item }));
      for (const dm of dAsst) {
        if (isMarkdownSourcedIncoming(dm, options)) continue;
        if (matchConcatenatedTurnDom(dm.text, baseAsEntries, null, isActiveTail, true, extractDomCopyButtonCodeStarts(dm))) {
          return 1;
        }
      }
    }
    return -1;
  };

  const makeTurnPair = (bPos, dPos) => ({
    baseTurnStart: baseUserIndices[bPos] + 1,
    baseTurnEnd: (bPos + 1 < M ? baseUserIndices[bPos + 1] : baseList.length) - 1,
    domTurnStart: domUserIndices[dPos] + 1,
    domTurnEnd: (dPos + 1 < K ? domUserIndices[dPos + 1] : domList.length) - 1
  });

  const anchorUser = baseList[baseUserIndices[M - 1]];
  const candidates = [];
  let fallbackP = -1;

  for (let p = 0; p < K; p++) {
    const domIdx = domUserIndices[p];
    const domU = domList[domIdx];
    if (!isSameUserMessage(anchorUser, domU, { domIsMarkdown: isMarkdownSourcedIncoming(domU, options) })) continue;
    fallbackP = p;
    if (p > M - 1) continue;
    let allPrevMatch = true;
    for (let offset = 1; offset <= p; offset++) {
      const prevDomU = domList[domUserIndices[p - offset]];
      if (!isSameUserMessage(baseList[baseUserIndices[M - 1 - offset]], prevDomU, { domIsMarkdown: isMarkdownSourcedIncoming(prevDomU, options) })) {
        allPrevMatch = false;
        break;
      }
    }
    if (!allPrevMatch) continue;
    const userSpan = p + 1;
    let matchedAssistants = 0;
    let mismatchedAssistants = 0;
    for (let offset = 0; offset <= p; offset++) {
      const score = scoreTurnAssistants(M - 1 - offset, p - offset);
      if (score > 0) matchedAssistants += 1;
      else if (score < 0) mismatchedAssistants += 1;
    }
    const netScore = matchedAssistants - mismatchedAssistants;
    candidates.push({ p, domIdx, userSpan, matchedAssistants, mismatchedAssistants, netScore });
  }

  if (candidates.length) {
    candidates.sort((a, b) => (
      (b.netScore - a.netScore) ||
      (a.mismatchedAssistants - b.mismatchedAssistants) ||
      (b.matchedAssistants - a.matchedAssistants) ||
      (b.userSpan - a.userSpan) ||
      (b.p - a.p)
    ));
    const best = candidates[0];
    const alignedTurnPairs = [];
    for (let offset = best.p; offset >= 0; offset--) {
      alignedTurnPairs.push(makeTurnPair(M - 1 - offset, best.p - offset));
    }
    return { startAppendIdx: best.domIdx + 1, alignedTurnPairs };
  }

  if (fallbackP >= 0) {
    const alignedTurnPairs = [];
    for (let offset = 0; offset <= fallbackP && offset <= M - 1; offset++) {
      const bPos = M - 1 - offset;
      const dPos = fallbackP - offset;
      const dUser = domList[domUserIndices[dPos]];
      if (!isSameUserMessage(baseList[baseUserIndices[bPos]], dUser, { domIsMarkdown: isMarkdownSourcedIncoming(dUser, options) })) break;
      alignedTurnPairs.unshift(makeTurnPair(bPos, dPos));
    }
    return { startAppendIdx: domUserIndices[fallbackP] + 1, alignedTurnPairs };
  }
  return { startAppendIdx: -1, alignedTurnPairs: [] };
}

function mergeTrajectoryAndDomMessages(trajMsgs, domMessages, options = {}) {
  const domList = collapseConsecutiveDomThinking(domMessages);
  const baseList = Array.isArray(trajMsgs) ? trajMsgs.map((m) => ({ ...m })) : [];
  if (!baseList.length) {
    return domList.map((m, idx) => ({ ...m, msgIndex: idx }));
  }

  const trajHasAuthoritativeThoughts = new WeakSet();
  for (const m of baseList) {
    if (m && m.role === 'assistant' && String(m.thoughtText || '').trim()) {
      trajHasAuthoritativeThoughts.add(m);
    }
  }
  const baseOverwrittenByDom = new WeakSet();

  const mergeDomMetaIntoTarget = (target, src) => {
    if (!target || !src || target === src) return;
    if (src.highRisk) {
      target.highRisk = true;
      const srcRisk = String(src.riskText || '').trim();
      const curRisk = String(target.riskText || '').trim();
      if (srcRisk) {
        if (!curRisk) {
          target.riskText = srcRisk;
        } else if (!curRisk.includes(srcRisk)) {
          target.riskText = `${curRisk}\n${srcRisk}`;
        }
      }
    }
    if (!trajHasAuthoritativeThoughts.has(target)) {
      const srcThoughts = Array.isArray(src.thoughts) && src.thoughts.length
        ? src.thoughts.map((t) => String(t || '').trim()).filter(Boolean)
        : (String(src.thoughtText || '').trim() ? [String(src.thoughtText).trim()] : []);
      const curThoughts = Array.isArray(target.thoughts) && target.thoughts.length
        ? target.thoughts.map((t) => String(t || '').trim()).filter(Boolean)
        : (String(target.thoughtText || '').trim() ? [String(target.thoughtText).trim()] : []);
      if (srcThoughts.length) {
        const mergedThoughts = curThoughts.slice();
        for (const t of srcThoughts) {
          if (t && !mergedThoughts.includes(t)) mergedThoughts.push(t);
        }
        target.thoughts = mergedThoughts;
        target.thoughtText = mergedThoughts.join('\n\n');
        target.thoughtLabel = target.thoughtLabel || src.thoughtLabel || '思考过程';
        target.thoughtCount = Math.max(mergedThoughts.length, Number(target.thoughtCount) || 0, Number(src.thoughtCount) || 0);
      } else if (!target.thoughtLabel && src.thoughtLabel) {
        target.thoughtLabel = src.thoughtLabel;
        target.thoughtCount = Math.max(Number(target.thoughtCount) || 0, Number(src.thoughtCount) || 1);
      }
    }
  };

  const applyConcatenatedTurnHit = (hit, dm) => {
    if (!hit?.target?.item) return;
    const targetItem = hit.target.item;
    if (hit.streamingTailText) {
      const prevKeyLen = baseOverwrittenByDom.has(targetItem)
        ? compactDomKey(targetItem.text).length
        : compactBaseKey(targetItem.text).length;
      if (compactDomKey(hit.streamingTailText).length > prevKeyLen) {
        targetItem.text = hit.streamingTailText;
        targetItem.html = null;
        baseOverwrittenByDom.add(targetItem);
      }
    }
    mergeDomMetaIntoTarget(targetItem, dm);
  };

  // 先结合消息顺序与轮次结构定位轨迹最后一条用户消息在桌面 DOM 中的锚点位置
  let lastBaseUserIdx = -1;
  for (let i = baseList.length - 1; i >= 0; i--) {
    if (baseList[i].role === 'user') {
      lastBaseUserIdx = i;
      break;
    }
  }
  let lastDomUserIdx = -1;
  for (let i = domList.length - 1; i >= 0; i--) {
    if (domList[i]?.role === 'user') {
      lastDomUserIdx = i;
      break;
    }
  }
  const anchor = lastBaseUserIdx >= 0
    ? findUserAnchorAlignment(baseList, domList, options)
    : { startAppendIdx: -1, alignedTurnPairs: [] };
  const startAppendIdx = anchor.startAppendIdx;

  const consumedDomIndices = new Set();
  const consumedBaseIndices = new Set();

  const matchAndMergePool = (domIndices, baseIndices, poolOpts = {}) => {
    if (!domIndices.length || !baseIndices.length) return;
    const allowBusyOverwrite = Boolean(options.busy && poolOpts.isActiveTailTurn);
    const minStreamableBaseIdx = Number.isInteger(poolOpts.minStreamableBaseIdx) ? poolOpts.minStreamableBaseIdx : 0;
    let lastTextBiInPool = -1;
    for (let idx = baseIndices.length - 1; idx >= 0; idx--) {
      const bi = baseIndices[idx];
      const item = baseList[bi];
      const hasTextKey = item && (baseOverwrittenByDom.has(item) ? compactDomKey(item.text) : compactBaseKey(item.text));
      if (hasTextKey) {
        lastTextBiInPool = bi;
        break;
      }
    }
    let lastStreamableBi = -1;
    for (let idx = baseIndices.length - 1; idx >= 0; idx--) {
      const bi = baseIndices[idx];
      if (bi < minStreamableBaseIdx) break;
      const item = baseList[bi];
      const hasTextKey = item && (baseOverwrittenByDom.has(item) ? compactDomKey(item.text) : compactBaseKey(item.text));
      if (hasTextKey) {
        lastStreamableBi = bi;
        break;
      }
    }
    const domDesc = domIndices.slice().reverse();
    const baseDesc = baseIndices.slice().reverse();

    const runTierPass = (tiers) => {
      for (const minTier of tiers) {
        for (const di of domDesc) {
          if (consumedDomIndices.has(di)) continue;
          const dm = domList[di];
          const domIsMd = isMarkdownSourcedIncoming(dm, options);
          let bestBi = -1;
          let bestTier = 0;
          let bestHasGrowth = false;
          for (const bi of baseDesc) {
            if (consumedBaseIndices.has(bi)) continue;
            const matchTarget = baseList[bi];
            const detail = classifyAssistantMatchDetail(matchTarget.text, dm.text, {
              busy: allowBusyOverwrite && bi === lastStreamableBi,
              allowCoveredPrefix: Boolean(poolOpts.singleTurn && !poolOpts.isActiveTailTurn && !domIsMd && bi === lastTextBiInPool),
              baseIsDom: baseOverwrittenByDom.has(matchTarget),
              domIsMarkdown: domIsMd,
              copyButtonCodeStarts: extractDomCopyButtonCodeStarts(dm)
            });
            const tier = detail.tier;
            if (tier >= minTier && tier > bestTier) {
              bestTier = tier;
              bestBi = bi;
              bestHasGrowth = Boolean(detail.hasStreamingGrowth);
              if (tier === 3) break;
            }
          }
          if (bestBi >= 0) {
            consumedDomIndices.add(di);
            consumedBaseIndices.add(bestBi);
            const matchTarget = baseList[bestBi];
            const targetIsDom = baseOverwrittenByDom.has(matchTarget);
            const targetKeyLen = (targetIsDom || domIsMd)
              ? compactDomKey(matchTarget.text).length
              : compactBaseKey(matchTarget.text).length;
            const domKeyLen = (targetIsDom && domIsMd)
              ? compactBaseKey(dm.text).length
              : compactDomKey(dm.text).length;
            if (allowBusyOverwrite && bestBi === lastStreamableBi && bestHasGrowth && domKeyLen > targetKeyLen) {
              matchTarget.text = dm.text;
              matchTarget.html = dm.html || null;
              if (!domIsMd) baseOverwrittenByDom.add(matchTarget);
            }
            mergeDomMetaIntoTarget(matchTarget, dm);
          }
        }
      }
    };

    // 1. 精确 1-to-1 匹配
    runTierPass([3]);

    // 2. 桌面单轮多段聚合容器识别：防止将整轮拼合纯文本误当作单条回复或覆盖历史首条
    if (baseIndices.length >= 2) {
      const baseEntriesInPool = baseIndices.map((bi) => ({ item: baseList[bi], baseIdx: bi }));
      const concatPool = poolOpts.singleTurn
        ? baseEntriesInPool
        : baseEntriesInPool.filter((e) => e.baseIdx >= minStreamableBaseIdx);
      const canBusyConcat = allowBusyOverwrite && lastStreamableBi >= minStreamableBaseIdx;
      if (concatPool.length >= 2) {
        for (const di of domIndices) {
          if (consumedDomIndices.has(di)) continue;
          const dm = domList[di];
          if (isMarkdownSourcedIncoming(dm, options)) continue;
          const hit = matchConcatenatedTurnDom(
            dm.text,
            concatPool,
            baseOverwrittenByDom,
            canBusyConcat,
            canBusyConcat || Boolean(poolOpts.singleTurn),
            extractDomCopyButtonCodeStarts(dm)
          );
          if (hit) {
            consumedDomIndices.add(di);
            applyConcatenatedTurnHit(hit, dm);
          }
        }
      }
    }

    // 3. Tier 2/1 前缀续写与 UI 装饰包含匹配
    runTierPass([2, 1]);

    // 扫尾聚合：同池内未消费的重复 DOM 节点若与已消费基准项精确同文，合并其 highRisk/riskText/thoughts 后跳过
    for (const di of domIndices) {
      if (consumedDomIndices.has(di)) continue;
      const dm = domList[di];
      const domIsMd = isMarkdownSourcedIncoming(dm, options);
      for (const bi of baseDesc) {
        if (!consumedBaseIndices.has(bi)) continue;
        const matchTarget = baseList[bi];
        if (classifyAssistantMatch(matchTarget.text, dm.text, {
          busy: allowBusyOverwrite && bi === lastStreamableBi,
          exactOnly: true,
          baseIsDom: baseOverwrittenByDom.has(matchTarget),
          domIsMarkdown: domIsMd
        }) >= 3) {
          mergeDomMetaIntoTarget(matchTarget, dm);
          consumedDomIndices.add(di);
          break;
        }
      }
    }
  };

  const collectAssistantIndices = (list, from, to) => {
    const ids = [];
    for (let i = Math.max(0, from); i <= Math.min(list.length - 1, to); i++) {
      if (list[i]?.role === 'assistant') ids.push(i);
    }
    return ids;
  };

  if (startAppendIdx >= 0) {
    for (const pair of anchor.alignedTurnPairs) {
      const isActiveTailTurn =
        pair.baseTurnStart > lastBaseUserIdx &&
        pair.baseTurnEnd === baseList.length - 1 &&
        pair.domTurnStart > lastDomUserIdx &&
        pair.domTurnEnd === domList.length - 1;
      matchAndMergePool(
        collectAssistantIndices(domList, pair.domTurnStart, pair.domTurnEnd),
        collectAssistantIndices(baseList, pair.baseTurnStart, pair.baseTurnEnd),
        { isActiveTailTurn, minStreamableBaseIdx: lastBaseUserIdx + 1, singleTurn: true }
      );
    }
  } else {
    const hasTrailingBaseAssistants = lastBaseUserIdx < baseList.length - 1;
    const isActiveTailTurn = lastDomUserIdx < 0 && hasTrailingBaseAssistants;
    matchAndMergePool(
      collectAssistantIndices(domList, 0, domList.length - 1),
      collectAssistantIndices(baseList, Math.max(0, baseList.length - 12), baseList.length - 1),
      { isActiveTailTurn, minStreamableBaseIdx: lastBaseUserIdx + 1, singleTurn: false }
    );
  }

  // 如果桌面 DOM 末尾刚发送/流式生成了轨迹接口尚未索引的最新消息，无损补入尾部
  if (startAppendIdx >= 0) {
    let currentTurnStartIdx = lastBaseUserIdx;
    let currentTurnEntries = [];
    let seenNewDomUserInPass2 = false;
    for (let k = Math.max(0, lastBaseUserIdx + 1); k < baseList.length; k++) {
      currentTurnEntries.push({
        item: baseList[k],
        baseIdx: k,
        fromBase: true,
        fromMarkdown: !baseOverwrittenByDom.has(baseList[k])
      });
    }
    for (let j = startAppendIdx; j < domList.length; j++) {
      if (consumedDomIndices.has(j)) continue;
      const dm = domList[j];
      const dmIsMd = isMarkdownSourcedIncoming(dm, options);
      const dHasText = Boolean(normMsgPrefix(dm.text));
      if (dm.role === 'user') {
        const dupUser = currentTurnEntries.some((entry) => (
          entry.item.role === 'user' &&
          isSameUserMessage(entry.item, dm, {
            baseIsDom: !entry.fromMarkdown || baseOverwrittenByDom.has(entry.item),
            domIsMarkdown: dmIsMd
          })
        ));
        if (!dupUser) {
          const item = { ...dm, id: `dom-tail-${j}` };
          baseList.push(item);
          // 遇到新用户消息立即重置当前轮次范围，避免后续新轮思考被挂到旧轮回复
          currentTurnStartIdx = baseList.length - 1;
          currentTurnEntries = [];
          seenNewDomUserInPass2 = true;
        }
        continue;
      }
      if (dm.role === 'assistant' && /^rpc-e-/.test(String(dm.id || ''))) {
        let hasLaterDomReply = false;
        for (let k = j + 1; k < domList.length && domList[k]?.role !== 'user'; k++) {
          const nxt = domList[k];
          if (nxt && nxt.role === 'assistant' && !nxt.highRisk && !/^rpc-e-/.test(String(nxt.id || '')) && Boolean(normMsgPrefix(nxt.text))) {
            hasLaterDomReply = true;
            break;
          }
        }
        if (hasLaterDomReply) {
          continue;
        }
      }
      if (dm.role === 'assistant' && !dHasText && !dm.highRisk) {
        // 纯思考项（空正文）：不得向本轮已有回复或思考卡尾部追加空壳 dom-tail
        const lastTurnAssistant = [...currentTurnEntries].reverse().map((e) => e.item).find((bm) => bm.role === 'assistant');
        if (lastTurnAssistant) {
          if (!lastTurnAssistant.thoughtText && dm.thoughtText) {
            mergeDomMetaIntoTarget(lastTurnAssistant, dm);
          } else if (!normMsgPrefix(lastTurnAssistant.text) && dm.thoughtText && dm.thoughtText.length > String(lastTurnAssistant.thoughtText || '').length) {
            lastTurnAssistant.thoughtText = dm.thoughtText;
            if (Array.isArray(dm.thoughts) && dm.thoughts.length) {
              lastTurnAssistant.thoughts = dm.thoughts.slice();
              lastTurnAssistant.thoughtCount = dm.thoughts.length;
            }
          }
          continue;
        }
        // 本轮尚无任何 assistant 消息才追加唯一 1 条流式思考卡
        if (dm.thoughtLabel || dm.thoughtText) {
          const item = { ...dm, id: `dom-tail-${j}` };
          baseList.push(item);
          currentTurnEntries.push({ item, baseIdx: baseList.length - 1, fromBase: false, fromMarkdown: dmIsMd });
        }
        continue;
      }
      const isDomActiveTailTurn = j > lastDomUserIdx;
      const allowPass2Busy = Boolean(options.busy && isDomActiveTailTurn);
      if (dm.role === 'assistant' && dHasText && !dmIsMd) {
        const baseAsstEntries = currentTurnEntries.filter(
          (e) => e.fromBase && e.item?.role === 'assistant' && Boolean(normMsgPrefix(e.item.text))
        );
        if (baseAsstEntries.length >= 2) {
          const concatHit = matchConcatenatedTurnDom(dm.text, baseAsstEntries, baseOverwrittenByDom, allowPass2Busy, true, extractDomCopyButtonCodeStarts(dm));
          if (concatHit) {
            applyConcatenatedTurnHit(concatHit, dm);
            continue;
          }
        }
      }
      const lastBaseTextIdxInTurn = dHasText
        ? currentTurnEntries.reduce((acc, e) => (
            (e.fromBase && e.item?.role === 'assistant' && Boolean(normMsgPrefix(e.item.text)))
              ? Math.max(acc, e.baseIdx)
              : acc
          ), -1)
        : -1;
      const dupEntry = dHasText
        ? currentTurnEntries.find((entry) => {
            if (entry.item.role !== dm.role) return false;
            const exactOnly = !entry.fromBase || consumedBaseIndices.has(entry.baseIdx);
            const baseIsDom = !entry.fromMarkdown || baseOverwrittenByDom.has(entry.item);
            const allowEntryBusy = allowPass2Busy && (!entry.fromBase || lastBaseTextIdxInTurn < 0 || entry.baseIdx === lastBaseTextIdxInTurn);
            return classifyAssistantMatch(entry.item.text, dm.text, {
              busy: allowEntryBusy,
              allowCoveredPrefix: Boolean(!isDomActiveTailTurn && entry.fromBase && !dmIsMd && (lastBaseTextIdxInTurn < 0 || entry.baseIdx === lastBaseTextIdxInTurn)),
              exactOnly,
              baseIsDom,
              domIsMarkdown: dmIsMd,
              copyButtonCodeStarts: extractDomCopyButtonCodeStarts(dm)
            }) > 0;
          })
        : null;
      if (dupEntry) {
        mergeDomMetaIntoTarget(dupEntry.item, dm);
      } else {
        // 权威空闲轨迹保护：在语言服务与桌面端均确认空闲且轨迹已与当前空闲签名对齐时，
        // 同一已回复轮次内的非 Markdown 桌面 DOM 容器必为同一轮的渲染副本，仅合并元数据绝不重复追加 dom-tail
        if (
          options.authoritativeIdle === true &&
          !options.isolated &&
          !dmIsMd &&
          !seenNewDomUserInPass2 &&
          dm.role === 'assistant' &&
          dHasText
        ) {
          const lastBaseAsstEntry = [...currentTurnEntries]
            .reverse()
            .find((e) => e.fromBase && e.item?.role === 'assistant' && Boolean(normMsgPrefix(e.item.text)));
          if (lastBaseAsstEntry) {
            mergeDomMetaIntoTarget(lastBaseAsstEntry.item, dm);
            continue;
          }
        }
        // 流式纯思考卡转正文交接：若本轮末尾是无正文纯思考卡，合并其思考到新回复并移除临时卡
        const pendingThinkIdx = (dm.role === 'assistant' && dHasText)
          ? baseList.findIndex((bm, idx) => idx > currentTurnStartIdx && bm.role === 'assistant' && !normMsgPrefix(bm.text) && !bm.highRisk && (bm.thoughtLabel || bm.thoughtText))
          : -1;
        if (pendingThinkIdx >= 0) {
          const prevThink = baseList[pendingThinkIdx];
          const prevThoughts = Array.isArray(prevThink.thoughts) && prevThink.thoughts.length
            ? prevThink.thoughts
            : (prevThink.thoughtText ? [prevThink.thoughtText] : []);
          const nextThoughts = Array.isArray(dm.thoughts) && dm.thoughts.length
            ? dm.thoughts
            : (dm.thoughtText ? [dm.thoughtText] : []);
          const combinedThoughts = prevThoughts.slice();
          for (const t of nextThoughts) {
            if (t && !combinedThoughts.includes(t)) combinedThoughts.push(t);
          }
          const promoted = {
            ...dm,
            id: `dom-tail-${j}`,
            thoughtLabel: dm.thoughtLabel || prevThink.thoughtLabel || (combinedThoughts.length ? '思考过程' : ''),
            thoughtText: combinedThoughts.join('\n\n') || dm.thoughtText || prevThink.thoughtText || '',
            ...(combinedThoughts.length ? { thoughts: combinedThoughts, thoughtCount: combinedThoughts.length } : {})
          };
          baseList.splice(pendingThinkIdx, 1, promoted);
          const turnPos = currentTurnEntries.findIndex((e) => e.baseIdx === pendingThinkIdx || e.item === prevThink);
          if (turnPos >= 0) currentTurnEntries.splice(turnPos, 1, { item: promoted, baseIdx: pendingThinkIdx, fromBase: false, fromMarkdown: dmIsMd });
          else currentTurnEntries.push({ item: promoted, baseIdx: pendingThinkIdx, fromBase: false, fromMarkdown: dmIsMd });
        } else {
          const item = { ...dm, id: `dom-tail-${j}` };
          baseList.push(item);
          currentTurnEntries.push({ item, baseIdx: baseList.length - 1, fromBase: false, fromMarkdown: dmIsMd });
        }
      }
    }
  } else if (lastBaseUserIdx < 0 && domList.length) {
    for (let j = 0; j < domList.length; j++) {
      const dm = domList[j];
      if (dm.role === 'user') baseList.push({ ...dm, id: `dom-tail-${j}` });
    }
  }

  return baseList.map((m, idx) => ({ ...m, msgIndex: idx }));
}

function mergeUniqueQueuedLists(baseList, incomingList, mergeMeta = false) {
  if (!Array.isArray(baseList)) return [];
  if (!Array.isArray(incomingList) || !incomingList.length) return baseList;
  const normQText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const getQImgCount = (q) => {
    if (Array.isArray(q?.images)) return q.images.length;
    if (Array.isArray(q?.attachments)) return q.attachments.length;
    if (Array.isArray(q?.media)) return q.media.length;
    return 0;
  };
  const getStableId = (q) => String(q?.messageId || '').trim();
  const queueMatchKey = (q) => `${normQText(q?.text)}::img=${getQImgCount(q)}`;

  const idMap = new Map();
  for (let i = 0; i < baseList.length; i++) {
    const bid = getStableId(baseList[i]);
    if (bid && !idMap.has(bid)) {
      idMap.set(bid, { item: baseList[i], idx: i });
    }
  }

  // 第一轮：优先按稳定 messageId 精确匹配并消耗对应基准项，防止同行额外无 ID/异 ID 项误用其文本配额
  const matchedBaseIndices = new Set();
  const handledIncomingIndices = new Set();
  for (let i = 0; i < incomingList.length; i++) {
    const iq = incomingList[i];
    if (!iq || typeof iq !== 'object') {
      handledIncomingIndices.add(i);
      continue;
    }
    const iqId = getStableId(iq);
    if (iqId && idMap.has(iqId)) {
      const hit = idMap.get(iqId);
      matchedBaseIndices.add(hit.idx);
      handledIncomingIndices.add(i);
      if (mergeMeta && Number.isInteger(iq.domIndex)) {
        hit.item.domIndex = iq.domIndex;
      }
    }
  }

  const unmatchedAnyByKey = new Map();
  const unmatchedIdlessByKey = new Map();
  for (let i = 0; i < baseList.length; i++) {
    if (matchedBaseIndices.has(i)) continue;
    const bq = baseList[i];
    if (!bq || typeof bq !== 'object') continue;
    const k = queueMatchKey(bq);
    if (!unmatchedAnyByKey.has(k)) unmatchedAnyByKey.set(k, []);
    unmatchedAnyByKey.get(k).push({ item: bq, idx: i });
    if (!getStableId(bq)) {
      if (!unmatchedIdlessByKey.has(k)) unmatchedIdlessByKey.set(k, []);
      unmatchedIdlessByKey.get(k).push({ item: bq, idx: i });
    }
  }

  const takeFirstUnmatched = (poolMap, k) => {
    const bucket = poolMap.get(k);
    if (!bucket || !bucket.length) return null;
    while (bucket.length) {
      const cand = bucket.shift();
      if (!matchedBaseIndices.has(cand.idx)) {
        matchedBaseIndices.add(cand.idx);
        return cand;
      }
    }
    return null;
  };

  for (let i = 0; i < incomingList.length; i++) {
    if (handledIncomingIndices.has(i)) continue;
    const iq = incomingList[i];
    const iqId = getStableId(iq);
    if (iqId && idMap.has(iqId)) {
      const hit = idMap.get(iqId);
      if (mergeMeta && Number.isInteger(iq.domIndex) && !Number.isInteger(hit.item.domIndex)) {
        hit.item.domIndex = iq.domIndex;
      }
      continue;
    }
    const k = queueMatchKey(iq);
    if (iqId) {
      // 携带非空稳定 ID 时，绝不能因文本/图数相同而吞并另一个已有不同稳定 ID 的项；仅可绑定无 ID 项（如 traj 与 Fiber）
      const idlessHit = takeFirstUnmatched(unmatchedIdlessByKey, k);
      if (idlessHit) {
        if (mergeMeta && Number.isInteger(iq.domIndex)) {
          idlessHit.item.domIndex = iq.domIndex;
        }
        idlessHit.item.messageId = iqId;
        if (!idlessHit.item.id) idlessHit.item.id = iqId;
        idMap.set(iqId, { item: idlessHit.item, idx: idlessHit.idx });
        continue;
      }
      baseList.push(iq);
      idMap.set(iqId, { item: iq, idx: baseList.length - 1 });
      continue;
    }
    const anyHit = takeFirstUnmatched(unmatchedAnyByKey, k);
    if (anyHit) {
      if (mergeMeta && Number.isInteger(iq.domIndex) && !Number.isInteger(anyHit.item.domIndex)) {
        anyHit.item.domIndex = iq.domIndex;
      }
      continue;
    }
    baseList.push(iq);
  }
  return baseList;
}

function createConversationHistoryManager() {
  const cache = new Map();
  const pendingMsgCache = new Map();
  const pendingRawUiCache = new Map();
  const lastUserConfigMap = new Map();
  const inflightMap = new Map();
  const fetchGenMap = new Map();
  const invalidatedGenMap = new Map();
  const pendingFetchGenMap = new Map();
  const pendingInvalidatedGenMap = new Map();
  const MAX_CACHE_ENTRIES = 24;
  const MAX_FETCH_GEN_ENTRIES = 2000;
  let globalFetchSeq = 0;
  let globalPendingSeq = 0;

  function nextPendingGen(sessionId) {
    const next = ++globalPendingSeq;
    if (pendingFetchGenMap.has(sessionId)) pendingFetchGenMap.delete(sessionId);
    pendingFetchGenMap.set(sessionId, next);
    while (pendingFetchGenMap.size > MAX_FETCH_GEN_ENTRIES) {
      const oldestKey = pendingFetchGenMap.keys().next().value;
      if (oldestKey !== undefined) pendingFetchGenMap.delete(oldestKey);
      else break;
    }
    return next;
  }

  function getCachedUserConfig(sessionId) {
    const sid = String(sessionId || '').trim();
    return sid ? (lastUserConfigMap.get(sid) || null) : null;
  }

  async function fetchPendingAgentMessages(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid || sid === '__new__' || sid === 'new') return null;
    if (typeof options.fetchPendingAgentMessages === 'function') {
      return await options.fetchPendingAgentMessages(sid, options);
    }
    const nowMs = Date.now();
    const cached = pendingMsgCache.get(sid);
    if (!options.bypassCache && cached && (nowMs - cached.at) < 450) {
      return cached.list;
    }
    const reqGen = nextPendingGen(sid);
    const api = await resolveLocalApi(options);
    if (!api || typeof api.callStreamFirstFrame !== 'function') return null;
    try {
      const firstFrame = await api.callStreamFirstFrame(
        'StreamAgentStateUpdates',
        {
          conversationId: sid,
          subscriberId: `ag-remote-q-${nowMs}`,
          initialStepsPageBounds: { startIndex: 0, endIndexExclusive: 0 },
          initialGeneratorMetadatasPageBounds: { startIndex: 0, endIndexExclusive: 0 },
          initialExecutorMetadatasPageBounds: { startIndex: 0, endIndexExclusive: 0 }
        },
        1200
      );
      if (!firstFrame || typeof firstFrame !== 'object') return null;
      if (!hasExplicitPendingAgentMessagesUpdate(firstFrame)) return null;
      const latestPendingGen = pendingFetchGenMap.get(sid) || 0;
      const invPendingGen = pendingInvalidatedGenMap.get(sid) || 0;
      const currentCached = pendingMsgCache.get(sid);
      if (
        reqGen < latestPendingGen ||
        reqGen <= invPendingGen ||
        (currentCached && (currentCached.gen || 0) > reqGen)
      ) {
        return (currentCached && (currentCached.gen || 0) > reqGen && Array.isArray(currentCached.list))
          ? currentCached.list
          : null;
      }
      const rawMap = new Map();
      const list = extractPendingAgentMessagesFromUpdate(firstFrame, {
        onRawRecord: (rec) => {
          if (rec?.messageId) rawMap.set(rec.messageId, rec);
        }
      });
      if (invPendingGen > 0 && reqGen > invPendingGen) {
        pendingInvalidatedGenMap.delete(sid);
      }
      if (pendingMsgCache.size >= MAX_CACHE_ENTRIES && !pendingMsgCache.has(sid)) {
        const oldest = pendingMsgCache.keys().next().value;
        if (oldest !== undefined) pendingMsgCache.delete(oldest);
      }
      if (pendingRawUiCache.size >= MAX_CACHE_ENTRIES && !pendingRawUiCache.has(sid)) {
        const oldestRaw = pendingRawUiCache.keys().next().value;
        if (oldestRaw !== undefined) pendingRawUiCache.delete(oldestRaw);
      }
      pendingMsgCache.set(sid, { list, at: Date.now(), gen: reqGen });
      pendingRawUiCache.set(sid, rawMap);
      return list;
    } catch {
      return null;
    }
  }

  async function resolvePendingMessageForEdit(sessionId, messageId, options = {}) {
    const sid = String(sessionId || '').trim();
    const mid = String(messageId || '').trim();
    if (!sid || !mid) return null;
    const cachedRaw = pendingRawUiCache.get(sid)?.get(mid);
    if (cachedRaw) return cachedRaw;
    const list = await fetchPendingAgentMessages(sid, { ...options, bypassCache: true }).catch(() => null);
    const afterFetchRaw = pendingRawUiCache.get(sid)?.get(mid);
    if (afterFetchRaw) return afterFetchRaw;
    if (Array.isArray(list)) {
      const hit = list.find((item) => item && (String(item.messageId || item.id || '').trim() === mid));
      if (hit) {
        return {
          messageId: mid,
          text: String(hit.text || ''),
          ui: hit.ui || ((Array.isArray(hit.media) || Array.isArray(hit.images) || Array.isArray(hit.items)) ? hit : null),
          hasMedia: Boolean(hit.hasMedia || (Array.isArray(hit.media) && hit.media.length) || (Array.isArray(hit.images) && hit.images.length))
        };
      }
    }
    return null;
  }

  function touchCache(sessionId, rec) {
    if (cache.has(sessionId)) cache.delete(sessionId);
    cache.set(sessionId, rec);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
  }

  function nextFetchGen(sessionId) {
    // 使用全局单调递增序号，即使某 sessionId 被 LRU 淘汰后再次请求，也绝不会复用旧代次 1，彻底防止晚归旧请求覆盖新结果
    const next = ++globalFetchSeq;
    if (fetchGenMap.has(sessionId)) fetchGenMap.delete(sessionId);
    fetchGenMap.set(sessionId, next);
    while (fetchGenMap.size > MAX_FETCH_GEN_ENTRIES) {
      const oldestKey = fetchGenMap.keys().next().value;
      if (oldestKey !== undefined) fetchGenMap.delete(oldestKey);
      else break;
    }
    return next;
  }

  function findInflightBySession(sessionId) {
    const prefix = `${sessionId}\n`;
    for (const [key, entry] of inflightMap.entries()) {
      if (key.startsWith(prefix)) return entry;
    }
    return null;
  }

  async function fetchTrajectoryMessages(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const customConnect = options.localApiConnect || globalThis.__AG_REMOTE_TEST_API__;
    if (!customConnect && isCatalogTestEnv()) return null;

    const reqSig = String(options.trajSig || '').trim();
    const inflightKey = `${sid}\n${reqSig}`;
    if (!options.bypassCache) {
      const existingEntry = inflightMap.get(inflightKey);
      if (existingEntry) {
        return await existingEntry.promise;
      }
    }

    const gen = nextFetchGen(sid);
    const startedAt = Date.now();
    let entry = null;
    const promise = (async () => {
      try {
        const res = await callLocalLanguageServer('GetCascadeTrajectory', { cascadeId: sid, trajectoryVerbosity: 3 }, 4500, options);
        const firstSteps = res?.trajectory?.steps;
        if (!Array.isArray(firstSteps)) {
          return { messages: null, queuedMessages: null, fetchedSig: reqSig, gen, startedAt };
        }
        const allSteps = firstSteps.slice();
        const totalSteps = Number(res?.numTotalSteps || res?.trajectory?.numTotalSteps || 0);
        if (totalSteps > allSteps.length) {
          const maxPages = Math.min(totalSteps + 1, 20000);
          for (let page = 0; page < maxPages && allSteps.length < totalSteps; page++) {
            const stepOffset = allSteps.length;
            const pageRes = await callLocalLanguageServer(
              'GetCascadeTrajectorySteps',
              { cascadeId: sid, stepOffset, trajectoryVerbosity: 3 },
              4000,
              options
            ).catch(() => null);
            const chunk = Array.isArray(pageRes?.steps) ? pageRes.steps : [];
            if (!chunk.length) break;
            const prevLen = allSteps.length;
            allSteps.push(...chunk);
            if (allSteps.length <= prevLen) break;
          }
        }
        for (let i = allSteps.length - 1; i >= 0; i--) {
          const uiCfg = allSteps[i]?.userInput?.userConfig || allSteps[i]?.userInput?.lastUserConfig;
          if (uiCfg && typeof uiCfg === 'object') {
            if (lastUserConfigMap.size >= MAX_CACHE_ENTRIES && !lastUserConfigMap.has(sid)) {
              const oldest = lastUserConfigMap.keys().next().value;
              if (oldest !== undefined) lastUserConfigMap.delete(oldest);
            }
            lastUserConfigMap.set(sid, uiCfg);
            break;
          }
        }
        return {
          messages: extractMessagesFromTrajectorySteps(allSteps, { lazyHtml: true }),
          queuedMessages: extractQueuedMessagesFromTrajectorySteps(allSteps, res?.trajectory || res),
          fetchedSig: reqSig,
          gen,
          startedAt
        };
      } catch {
        return { messages: null, queuedMessages: null, fetchedSig: reqSig, gen, startedAt };
      } finally {
        if (inflightMap.get(inflightKey) === entry) {
          inflightMap.delete(inflightKey);
        }
      }
    })();
    entry = { promise, sig: reqSig, gen, startedAt };
    inflightMap.set(inflightKey, entry);
    return await promise;
  }

  async function resolveFullMessages(sessionId, domMessages, options = {}) {
    const sid = String(sessionId || '').trim();
    const domTail = Array.isArray(domMessages) ? domMessages : [];
    if (!sid) {
      return { merged: domTail.map((m, idx) => ({ ...m, msgIndex: idx })), trajMsgs: null, queuedMessages: null };
    }
    const existing = cache.get(sid);
    const nowMs = Date.now();
    const ttl = options.busy ? 1000 : 3500;
    const trajSig = String(options.trajSig || '').trim();
    const trajStatusPrefix = trajSig ? trajSig.split('|')[0] : '';
    const isCredibleIdleTraj = CREDIBLE_TRAJ_IDLE_STATUSES.has(trajStatusPrefix);
    const knownOldSig = String(existing?.trajSig || '').trim();
    const observedOldSig = String(existing?.observedSig || '').trim();
    const sigMismatch = Boolean(
      trajSig && (
        (knownOldSig && knownOldSig !== trajSig) ||
        (!knownOldSig && observedOldSig && observedOldSig !== trajSig)
      )
    );
    const verifiedIdleMatch = Boolean(trajSig && knownOldSig && knownOldSig === trajSig && !options.busy);
    const withinTtl = Boolean(existing && existing.at > 0 && (nowMs - existing.at < ttl));
    const trajHit = !options.bypassCache &&
      Boolean(existing && Array.isArray(existing.trajMsgs)) &&
      !sigMismatch &&
      (verifiedIdleMatch || withinTtl);

    if (trajHit) {
      const trajMsgs = existing.trajMsgs;
      const merged = mergeTrajectoryAndDomMessages(trajMsgs, domTail, {
        busy: Boolean(options.busy),
        isolated: Boolean(options.isolated),
        authoritativeIdle: Boolean(!options.busy && !options.isolated && isCredibleIdleTraj && verifiedIdleMatch)
      });
      // Never extend `at` on cache hits: TTL must measure elapsed time since actual RPC fetch.
      // For unknown-signature warm entries (knownOldSig === ''), record observedSig without promoting it to trajSig.
      const nextObservedSig = knownOldSig ? '' : (observedOldSig || trajSig || '');
      const cachedQueued = Array.isArray(existing.queuedMessages) ? existing.queuedMessages : null;
      touchCache(sid, {
        trajMsgs,
        queuedMessages: cachedQueued,
        trajSig: knownOldSig,
        observedSig: nextObservedSig,
        domTail: domTail.length ? domTail : (existing?.domTail || []),
        domTailIsolated: domTail.length ? Boolean(options.isolated) : Boolean(existing?.domTailIsolated),
        merged,
        at: existing.at || 0,
        gen: existing.gen || 0
      });
      return { merged, trajMsgs, queuedMessages: cachedQueued };
    }

    const commitFetchResult = (fetchRes) => {
      const latestExisting = cache.get(sid);
      const latestGen = fetchGenMap.get(sid) || 0;
      const isSuperseded = Boolean(
        !fetchRes ||
        fetchRes.gen < latestGen ||
        (latestExisting?.gen && latestExisting.gen > fetchRes.gen)
      );
      const fetchedMsgs = Array.isArray(fetchRes?.messages) ? fetchRes.messages : null;
      const fetchedQueued = Array.isArray(fetchRes?.queuedMessages) ? fetchRes.queuedMessages : null;
      const trajFetchedFresh = Boolean(fetchedMsgs && fetchRes.fetchedSig === trajSig);

      if (isSuperseded) {
        const invGen = invalidatedGenMap.get(sid) || 0;
        const wasInvalidated = Boolean(fetchRes && fetchRes.gen < invGen);
        const activeTrajMsgs = Array.isArray(latestExisting?.trajMsgs)
          ? latestExisting.trajMsgs
          : (wasInvalidated ? null : (fetchedMsgs || (Array.isArray(existing?.trajMsgs) ? existing.trajMsgs : null)));
        const activeQueued = Array.isArray(latestExisting?.queuedMessages)
          ? latestExisting.queuedMessages
          : (wasInvalidated ? [] : (Array.isArray(fetchedQueued) ? fetchedQueued : (Array.isArray(existing?.queuedMessages) ? existing.queuedMessages : null)));
        const merged = mergeTrajectoryAndDomMessages(activeTrajMsgs, domTail, {
          busy: Boolean(options.busy),
          isolated: Boolean(options.isolated)
        });
        return { merged, trajMsgs: activeTrajMsgs, queuedMessages: activeQueued };
      }

      const baseRec = latestExisting || existing;
      let trajMsgs = null;
      if (trajFetchedFresh) {
        trajMsgs = fetchedMsgs;
      } else if (baseRec && Array.isArray(baseRec.trajMsgs)) {
        trajMsgs = baseRec.trajMsgs;
      }
      const invGenAfter = invalidatedGenMap.get(sid) || 0;
      const isPendingInvalidation = Boolean(invGenAfter > 0);
      if (trajFetchedFresh && invGenAfter > 0 && fetchRes.gen > invGenAfter) {
        invalidatedGenMap.delete(sid);
      }
      const stillPendingInvalidation = Boolean((invalidatedGenMap.get(sid) || 0) > 0);
      const nextQueued = trajFetchedFresh
        ? (Array.isArray(fetchedQueued) ? fetchedQueued : [])
        : (Array.isArray(baseRec?.queuedMessages) ? baseRec.queuedMessages : (isPendingInvalidation ? [] : null));

      const merged = mergeTrajectoryAndDomMessages(trajMsgs, domTail, {
        busy: Boolean(options.busy),
        isolated: Boolean(options.isolated),
        authoritativeIdle: Boolean(!options.busy && !options.isolated && isCredibleIdleTraj && trajFetchedFresh && !stillPendingInvalidation)
      });
      const nextTrajSig = trajFetchedFresh ? trajSig : String(baseRec?.trajSig || '');
      const nextObservedSig = trajFetchedFresh ? '' : String(baseRec?.observedSig || '');
      const nextAt = trajFetchedFresh ? fetchRes.startedAt : (baseRec?.at || 0);
      const nextGen = trajFetchedFresh ? fetchRes.gen : (baseRec?.gen || 0);
      const persistedTrajMsgs = Array.isArray(trajMsgs)
        ? trajMsgs
        : (Array.isArray(baseRec?.trajMsgs) ? baseRec.trajMsgs : null);
      touchCache(sid, {
        trajMsgs: persistedTrajMsgs,
        queuedMessages: nextQueued,
        trajSig: nextTrajSig,
        observedSig: nextObservedSig,
        domTail: domTail.length ? domTail : (baseRec?.domTail || []),
        domTailIsolated: domTail.length ? Boolean(options.isolated) : Boolean(baseRec?.domTailIsolated),
        merged,
        at: nextAt,
        gen: nextGen
      });
      return { merged, trajMsgs: persistedTrajMsgs, queuedMessages: nextQueued };
    };

    const fetchPromise = fetchTrajectoryMessages(sid, { ...options, trajSig })
      .then((fetchRes) => commitFetchResult(fetchRes));
    // 防止软预算超时提前返回后，后台拉取偶发异常变成 unhandledRejection
    fetchPromise.catch(() => {});

    const explicitSoftWait = Number(options.softWaitMs);
    let softWaitMs = 0;
    if (Number.isFinite(explicitSoftWait) && explicitSoftWait > 0) {
      softWaitMs = explicitSoftWait;
    } else if (
      !isCatalogTestEnv() &&
      !options.localApiConnect &&
      !globalThis.__AG_REMOTE_TEST_API__ &&
      !options.bypassCache
    ) {
      if (Array.isArray(existing?.trajMsgs)) {
        softWaitMs = 600;
      } else if (domTail.length > 0) {
        softWaitMs = 1200;
      }
    }

    if (!(softWaitMs > 0)) {
      return await fetchPromise;
    }

    const SOFT_TIMEOUT = Symbol('soft-timeout');
    let softTimer = null;
    const timeoutPromise = new Promise((resolve) => {
      softTimer = setTimeout(() => resolve(SOFT_TIMEOUT), softWaitMs);
      softTimer.unref?.();
    });
    try {
      const raceRes = await Promise.race([fetchPromise, timeoutPromise]);
      if (raceRes !== SOFT_TIMEOUT) {
        return raceRes;
      }
    } finally {
      if (softTimer) clearTimeout(softTimer);
    }

    // 软预算超时后立刻用现有缓存与最新 DOM 尾消息拼装返回，避免阻塞局域网首屏或轮询；后台完成后自动回填缓存
    const latestFallbackRec = cache.get(sid) || existing;
    const fallbackTrajMsgs = Array.isArray(latestFallbackRec?.trajMsgs) ? latestFallbackRec.trajMsgs : null;
    const fallbackQueued = Array.isArray(latestFallbackRec?.queuedMessages) ? latestFallbackRec.queuedMessages : null;
    const merged = mergeTrajectoryAndDomMessages(fallbackTrajMsgs, domTail, {
      busy: Boolean(options.busy),
      isolated: Boolean(options.isolated)
    });
    return { merged, trajMsgs: fallbackTrajMsgs, queuedMessages: fallbackQueued };
  }

  async function warmSession(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid || sid === 'new') return;
    const existing = cache.get(sid);
    if (existing && Array.isArray(existing.trajMsgs)) return;
    const activeInflight = findInflightBySession(sid);
    if (activeInflight) {
      await activeInflight.promise;
      return;
    }
    const warmSig = String(options.trajSig || '').trim();
    const fetchRes = await fetchTrajectoryMessages(sid, { ...options, trajSig: warmSig });
    if (
      Array.isArray(fetchRes?.messages) &&
      fetchRes.gen === (fetchGenMap.get(sid) || 0) &&
      !cache.get(sid)?.trajMsgs
    ) {
      touchCache(sid, {
        trajMsgs: fetchRes.messages,
        queuedMessages: Array.isArray(fetchRes.queuedMessages) ? fetchRes.queuedMessages : [],
        trajSig: fetchRes.fetchedSig || '',
        observedSig: '',
        domTail: [],
        domTailIsolated: false,
        merged: [],
        at: fetchRes.startedAt,
        gen: fetchRes.gen
      });
    }
  }

  async function enrichMessages(snap, options = {}) {
    if (!snap || typeof snap !== 'object' || snap.ok === false) return snap;
    const { _activeTrajSig, ...cleanSnap } = snap;
    const sid = String(cleanSnap.sessionId || '').trim();
    const [{ merged: fullMsgs, trajMsgs, queuedMessages }, pendingAgentQueued] = await Promise.all([
      resolveFullMessages(sid, cleanSnap.messages, {
        ...options,
        trajSig: _activeTrajSig || '',
        busy: Boolean(cleanSnap.busy),
        isolated: Boolean(cleanSnap.isolated)
      }),
      (!cleanSnap.isNewConversation && !cleanSnap.isolatedError)
        ? fetchPendingAgentMessages(sid, options).catch(() => null)
        : Promise.resolve(null)
    ]);
    const rawLimit = options.msgLimit === undefined ? 30 : Math.max(0, Number(options.msgLimit) || 0);
    const startIdx = (rawLimit > 0 && fullMsgs.length > rawLimit) ? (fullMsgs.length - rawLimit) : 0;
    const sliced = ensureMessagesHtmlRendered(fullMsgs.slice(startIdx), trajMsgs);
    const domQueued = (Array.isArray(cleanSnap.queuedMessages) ? cleanSnap.queuedMessages : []).filter((q) => q && q.source === 'dom');
    let effQueued;
    if (Array.isArray(pendingAgentQueued)) {
      const mergedQ = [...pendingAgentQueued];
      if (Array.isArray(queuedMessages) && queuedMessages.length) {
        mergeUniqueQueuedLists(mergedQ, queuedMessages, false);
      }
      if (domQueued.length) {
        mergeUniqueQueuedLists(mergedQ, domQueued, true);
      }
      effQueued = mergedQ;
    } else if (Array.isArray(queuedMessages)) {
      const mergedQ = [...queuedMessages];
      mergeUniqueQueuedLists(mergedQ, domQueued, true);
      effQueued = mergedQ;
    } else {
      effQueued = Array.isArray(cleanSnap.queuedMessages) ? cleanSnap.queuedMessages : [];
    }
    return {
      ...cleanSnap,
      totalMessages: fullMsgs.length,
      messagesStartIndex: startIdx,
      hasEarlierMessages: startIdx > 0,
      historySource: trajMsgs ? 'trajectory' : (cleanSnap.isolatedError ? 'isolated_error' : 'dom'),
      messages: sliced,
      queuedMessages: effQueued
    };
  }

  function invalidateSession(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    cache.delete(sid);
    pendingMsgCache.delete(sid);
    pendingRawUiCache.delete(sid);
    const invPendingGen = nextPendingGen(sid);
    pendingInvalidatedGenMap.set(sid, invPendingGen);
    const invGen = nextFetchGen(sid);
    invalidatedGenMap.set(sid, invGen);
    const prefix = `${sid}\n`;
    for (const key of Array.from(inflightMap.keys())) {
      if (key.startsWith(prefix)) inflightMap.delete(key);
    }
  }

  async function getMessagesPage(options = {}) {
    const sid = String(options.sessionId || '').trim();
    if (!sid) return { ok: false, error: '缺少 sessionId 参数' };
    const limit = Math.max(1, Math.min(200, Number.parseInt(options.limit ?? 30, 10) || 30));
    const existing = cache.get(sid);
    const hasBefore = options.before !== undefined && options.before !== null && options.before !== '';
    const parsedBefore = hasBefore ? Number.parseInt(options.before, 10) : NaN;
    if (
      hasBefore &&
      !options.bypassCache &&
      !options.trajSig &&
      existing &&
      Array.isArray(existing.merged) &&
      existing.merged.length > 0 &&
      Number.isFinite(parsedBefore) &&
      parsedBefore > 0 &&
      parsedBefore <= existing.merged.length
    ) {
      const endIdx = parsedBefore;
      const startIdx = Math.max(0, endIdx - limit);
      return {
        ok: true,
        sessionId: sid,
        totalMessages: existing.merged.length,
        startIndex: startIdx,
        endIndex: endIdx,
        hasEarlier: startIdx > 0,
        messages: ensureMessagesHtmlRendered(existing.merged.slice(startIdx, endIdx), existing.trajMsgs)
      };
    }

    const { merged: fullMsgs, trajMsgs } = await resolveFullMessages(sid, existing?.domTail || [], {
      ...options,
      isolated: Boolean(options.isolated || existing?.domTailIsolated)
    });
    const total = fullMsgs.length;
    const rawBefore = hasBefore ? Number.parseInt(options.before, 10) : total;
    const endIdx = Math.max(0, Math.min(total, Number.isFinite(rawBefore) ? rawBefore : total));
    const startIdx = Math.max(0, endIdx - limit);
    return {
      ok: true,
      sessionId: sid,
      totalMessages: total,
      startIndex: startIdx,
      endIndex: endIdx,
      hasEarlier: startIdx > 0,
      messages: ensureMessagesHtmlRendered(fullMsgs.slice(startIdx, endIdx), trajMsgs)
    };
  }

  return {
    enrichMessages,
    getMessagesPage,
    warmSession,
    invalidateSession,
    getCachedUserConfig,
    fetchPendingAgentMessages,
    resolvePendingMessageForEdit
  };
}

const defaultHistoryManager = createConversationHistoryManager();

function getConversationMessagesPage(options = {}) {
  return defaultHistoryManager.getMessagesPage(options);
}

function warmConversationSession(sessionId, options = {}) {
  return defaultHistoryManager.warmSession(sessionId, options);
}

function buildEnrichFallbackSnapshot(baseSnap) {
  const isIsolatedError = Boolean(baseSnap?.isolatedError);
  const rawMsgs = (!isIsolatedError && Array.isArray(baseSnap?.messages)) ? baseSnap.messages : [];
  const normalizedMsgs = [];
  for (const m of rawMsgs) {
    if (!m || typeof m !== 'object') continue;
    normalizedMsgs.push({
      ...m,
      msgIndex: normalizedMsgs.length
    });
  }
  return {
    ...baseSnap,
    messages: normalizedMsgs,
    historySource: isIsolatedError ? 'isolated_error' : 'dom',
    totalMessages: normalizedMsgs.length,
    messagesStartIndex: 0,
    hasEarlierMessages: false,
    serverBootId: REMOTE_SERVER_BOOT_ID,
    serverBootAt: REMOTE_SERVER_BOOT_AT,
    snapSeq: ++remoteServerSnapSeq
  };
}

async function fetchSnapshotFromTarget(requestedTargetId, snapOptions = {}) {
  const serializedOpts = JSON.stringify({
    conversationId: String(snapOptions?.conversationId || '').trim(),
    clientId: String(snapOptions?.clientId || '').trim()
  });
  const expr = `(async () => {
    const fnAsync = window.__AGEnhancer?.getMobileSnapshotAsync;
    if (typeof fnAsync === 'function') {
      return await fnAsync(${serializedOpts});
    }
    const fn = window.__AGEnhancer?.getMobileSnapshot;
    if (typeof fn !== 'function') {
      return { ok: false, error: '电脑端增强组件尚未就绪，请在 Antigravity 窗口中重新开启套件或稍等 2 秒重试' };
    }
    return fn();
  })()`;
  const { value: snap, target, windows } = await evalInPickedTarget(requestedTargetId, expr, 7000, {
    idempotent: true,
    pickTarget: snapOptions?.pickTarget,
    evalInTarget: snapOptions?.evalInTarget
  });
  if (!snap || typeof snap !== 'object') {
    throw new Error('未能读取电脑端会话画面，请确认 Antigravity 已打开');
  }
  const baseSnap = {
    ...snap,
    currentTargetId: target.id,
    windows
  };
  const enrichFn = typeof snapOptions?.enrichSnapshot === 'function' ? snapOptions.enrichSnapshot : enrichSnapshotWithCatalog;
  try {
    return await enrichFn(baseSnap, snapOptions);
  } catch {
    return buildEnrichFallbackSnapshot(baseSnap);
  }
}

async function performActionInTarget(payload, options = {}) {
  return await enqueueRemoteAction(async () => {
    const act = String(payload?.action || '').trim();
    const warmId = (act === 'switch-conversation' && payload?.id && String(payload.id).trim() !== 'new' && String(payload.id).trim() !== 'follow-desktop')
      ? String(payload.id).trim()
      : '';
    const warmPromise = warmId
      ? defaultHistoryManager.warmSession(warmId).catch(() => null)
      : Promise.resolve();
    const serialized = JSON.stringify(payload || {});
    const expr = `(async () => {
      const fn = window.__AGEnhancer?.performMobileAction;
      if (typeof fn !== 'function') {
        return { ok: false, error: '电脑端远程控制暂未就绪，请确认 Antigravity 窗口已打开并重新加载套件' };
      }
      return await fn(${serialized});
    })()`;
    const actionTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 6000;
    const { value: actionResult, target } = await evalInPickedTarget(payload?.targetId, expr, actionTimeoutMs, {
      idempotent: false,
      pickTarget: options.pickTarget,
      evalInTarget: options.evalInTarget
    });
    const settleMs = (act === 'switch-conversation' || act === 'new-conversation')
      ? (actionResult?.verifiedState ? 45 : 180)
      : 80;
    await Promise.all([new Promise((r) => setTimeout(r, settleMs)), warmPromise]);
    const snapConvId = act === 'switch-conversation'
      ? (payload?.id && payload.id !== 'new' && payload.id !== 'follow-desktop' ? String(payload.id) : '')
      : (act === 'new-conversation'
        ? ''
        : (act === 'send' && actionResult?.createdConversationId
          ? String(actionResult.createdConversationId)
          : (payload?.conversationId ? String(payload.conversationId) : '')));
    if (act === 'send' && snapConvId && snapConvId !== '__new__') {
      defaultHistoryManager.invalidateSession?.(snapConvId);
    }
    const snapshot = await fetchSnapshotFromTarget(target.id, {
      convLimit: 100,
      conversationId: snapConvId,
      clientId: payload?.clientId ? String(payload.clientId) : '',
      bypassCache: act === 'send',
      bypassCatalogCache: act === 'switch-conversation' || act === 'new-conversation'
    }).catch(() => null);
    return {
      ok: Boolean(actionResult?.ok),
      actionResult: actionResult || null,
      snapshot
    };
  });
}

// ==================== 移动端极速 PWA HTML & 资源 ====================

function normalizeRemoteChineseLocale(locale) {
  const lang = String(locale || '').trim().toLowerCase().replace(/_/g, '-');
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(lang)) return 'zh-TW';
  if (/^zh-(?:cn|sg|hans)(?:-|$)/.test(lang)) return 'zh-CN';
  return '';
}

function preferredRemoteChineseLocale(req) {
  const languages = String(req.headers?.['accept-language'] || '').split(',')
    .map((entry) => {
      const [language, ...params] = entry.split(';');
      const quality = params.find((param) => /^q=/i.test(param.trim()));
      return { locale: normalizeRemoteChineseLocale(language), quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter(({ locale, quality }) => locale && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality);
  return languages[0]?.locale || '';
}

function resolveRemoteLocale(req) {
  const preferred = preferredRemoteChineseLocale(req);
  if (preferred) return preferred;
  try {
    const prefs = require('./meter-collector').getPluginSettings().uiPreferences;
    return normalizeRemoteChineseLocale(prefs?.locale || prefs?.panelLanguage) || 'zh-TW';
  } catch {
    return 'zh-TW';
  }
}

const REMOTE_TW_COPY = new Map([
  ["会话与窗口", "對話與視窗"],
  ["当前会话", "目前對話"],
  ["本会话变更与产物", "本次對話的變更與產物"],
  ["读取会话变更失败", "無法讀取這則對話的變更"],
  ["当前会话暂无代码改动或产物", "這則對話尚無變更或產物"],
  ["若有 AI 改动和产物会显示在这里", "若有 AI 改動和產物會顯示在這裡"],
  ["浏览历史会话", "瀏覽歷史對話"],
  ["该项目暂无可切换会话", "此專案目前沒有可切換的對話"],
  ["切换会话失败，请检查电脑端连接或刷新重试", "無法切換對話，請確認電腦端連線或重新整理後再試。"],
  ["同步桌面当前会话", "同步桌面目前的對話"],
  ["已同步桌面当前会话", "已同步桌面對話"],
  ["独立视图", "獨立檢視"],
  ["读取失败", "讀取失敗"],
  ["无法独立读取该会话", "無法以獨立檢視讀取這則對話"],
  ["电脑端增强组件尚未就绪，请在 Antigravity 窗口中重新开启套件或稍等 2 秒重试", "電腦端套件尚未就緒。請重新開啟 Antigravity 套件，或等 2 秒再試。"],
  ["电脑端远程控制暂未就绪，请确认 Antigravity 窗口已打开并重新加载套件", "電腦端的遠端功能尚未就緒。請確認 Antigravity 視窗已開啟，再重新載入套件。"],
  ["桌面端未能进入该项目新对话", "桌面端無法在這個專案開啟新對話。"],
  ["桌面端路由正忙", "桌面端路由正忙"],
  ["思考过程", "思考過程"],
  ["未归属项目", "未歸屬專案"],
  ["未命名项目", "未命名專案"],
  ["默认项目", "預設專案"],
  ["独立对话", "獨立對話"],
  ["局域网", "區域網路"],
  ["Cloudflare 隧道", "Cloudflare 隧道"],
  ["步骤异常", "步驟異常"],
  ["图片", "圖片"],
  ["[图片附件]", "[圖片附件]"],
  ["待确认", "待確認"],
  ["待审批", "待核准"],
  ["运行中", "執行中"],
  ["异常", "異常"],
  ["允许", "允許"],
  ["拒绝", "拒絕"],
  ["确认", "確認"],
  ["继续", "繼續"],
  ["重试", "重試"],
  ["提交", "送出"],
  ["始终允许", "一律允許"],
  ["仅允许一次", "僅允許這次"],
  ["需要你的确认", "請確認"],
  ["无限", "無限"],
  ["自动", "自動"],
  ["默认", "預設"],
  ["请求审核", "請求核准"],
  ["局域网 连接方式已停用", "區域網路連線已停用"],
  ["Cloudflare 隧道 连接方式已停用", "Cloudflare 隧道連線已停用"],
  ["对话已完成", "對話已完成"],
  ["Antigravity 对话", "Antigravity 對話"],
  ["有新的会话状态更新", "對話狀態已更新"],
  ["Antigravity 远程通知测试", "Antigravity 遠端通知測試"],
  ["推送通道正常，桌面应用未读角标将随已完成未读数自动同步。", "推播連線正常。桌面應用程式的未讀徽章會同步顯示已完成的未讀對話數。"],
  ["无效的本地文件路径", "本機檔案路徑無效"],
  ["文件不存在或无法读取", "檔案不存在或無法讀取"],
  ["禁止访问受限目录之外的文件", "無法存取允許的資料夾以外的檔案"],
  ["禁止访问敏感密钥或凭证目录", "無法存取存放敏感金鑰或憑證的目錄"],
  ["禁止访问敏感环境或私钥文件", "無法存取敏感環境設定或私密金鑰檔案"],
  ["文件不存在", "檔案不存在"],
  ["目标不是常规文件", "請選擇一般檔案"],
  ["文件体积超过限制 (‹數值›MB)", "檔案大小超過 ‹數值› MB 上限"],
  ["当前暂无已注册项目工作区，已禁止默认浏览系统主目录", "目前沒有已登錄的專案工作區，無法瀏覽系統家目錄"],
  ["无效的目录路径", "資料夾路徑無效"],
  ["目录不存在或无法访问", "資料夾不存在或無法存取"],
  ["禁止浏览受限目录之外的路径", "無法瀏覽允許的資料夾以外的路徑"],
  ["禁止浏览敏感密钥或凭证目录", "無法瀏覽存放敏感金鑰或憑證的目錄"],
  ["目录不存在", "資料夾不存在"],
  ["目标不是目录", "請選擇資料夾"],
  ["读取目录失败", "無法讀取資料夾"],
  ["文件较大 (‹數值› KB)，超过文本预览上限 (‹數值› KB)", "檔案大小為 ‹數值› KB，超過 ‹數值› KB 的文字預覽上限"],
  ["读取文件失败", "無法讀取檔案"],
  ["‹值› 调用超时", "‹值› 呼叫逾時"],
  ["‹值› 已确认未执行", "已確認 ‹值› 未執行"],
  ["‹值› 调用失败", "呼叫 ‹值› 失敗"],
  ["‹值› 响应超时，结果未知", "‹值› 回應逾時，結果未知"],
  ["‹值› 返回空结果，状态未知", "‹值› 回傳空結果，狀態未知"],
  ["LanguageServer 未连接", "尚未連線至 LanguageServer"],
  ["未能获取排队消息的原始附件来源", "無法取得佇列訊息的原始附件來源"],
  ["排队媒体仅含缩略图且原始本地文件不可访问，已取消撤回以避免丢失原图", "佇列中的附件只有縮圖，無法讀取原始檔案。為避免遺失原圖，已取消撤回。"],
  ["无法读取原始排队附件内容，已取消撤回以避免丢失附件", "無法讀取佇列訊息的原始附件。為避免遺失附件，已取消撤回。"],
  ["缺少 sessionId 参数", "缺少 sessionId 參數"],
  ["未能读取电脑端会话画面，请确认 Antigravity 已打开", "無法讀取電腦端的對話畫面，請確認 Antigravity 已開啟。"],
  ["当前会话待重发暂存附件将超过上限（‹值› 个），已取消撤回以避免丢失早期附件；请先发送或移除部分附件", "待重新傳送的附件將超過 ‹值› 個上限。為保留先前的附件，已取消撤回。請先傳送或移除部分附件。"],
  ["消息已立即发送，但移除原排队项失败；再次点击将仅重试移除而不重复发送", "訊息已立即傳送，但無法移除原佇列項目。再點一次可重試移除，訊息只會傳送一次。"],
  ["未找到可用的桌面端导航控制接口", "找不到可用的桌面導覽介面"],
  ["缺少语言服务凭证 (csrfToken)", "缺少語言服務憑證（csrfToken）"],
  ["未取得目标会话历史", "無法取得這則對話的歷史紀錄"],
  ["缺少会话 ID", "缺少對話 ID"],
  ["未找到新建对话按钮", "找不到「新增對話」按鈕"],
  ["未在侧边栏找到该会话", "側邊欄找不到這則對話"],
  ["发送内容不能为空", "請先輸入要傳送的內容"],
  ["恢复附件注入桌面输入框失败，已回滚本次已注入附件并取消发送", "無法將附件還原至桌面輸入框。已移除這次加入的附件並取消傳送。"],
  ["未能填入输入框", "無法填入輸入框"],
  ["当前未在执行中", "目前沒有執行中的操作"],
  ["当前没有待审批操作", "目前沒有待核准的操作"],
  ["目标审批按钮已消失或已处理", "核准按鈕已消失，或該操作已處理"],
  ["当前没有待确认选择框", "目前沒有待確認的選擇框"],
  ["目标确认选择框已消失或已变更", "確認選擇框已消失或內容已變更"],
  ["目标确认选择框已消失或索引失效", "確認選擇框已消失或位置已失效"],
  ["目标确认按钮已消失或不可用", "確認按鈕已消失或無法使用"],
  ["目标确认按钮当前仍处于禁用状态，请先完成必选项", "請先完成必選項目，再按確認。"],
  ["请先填写必填项后再提交", "請填寫必填欄位後再送出。"],
  ["输入内容未通过校验，请修改后重试", "輸入內容未通過驗證，請修改後再試。"],
  ["表单存在未通过校验的必填项，请完善后重试", "表單有必填欄位未通過驗證，請修正後再送出。"],
  ["新建对话导航失败", "無法前往新增對話畫面"],
  ["桌面端未进入新建对话状态", "桌面端未進入新增對話畫面"],
  ["桌面端未进入目标项目新建对话状态: ‹值›", "桌面端未進入「‹值›」的新增對話畫面"],
  ["未找到该会话的跳转入口", "找不到開啟這則對話的入口"],
  ["桌面端未切换至目标会话状态: ‹值›", "桌面端未切換至對話「‹值›」"],
  ["未找到桌面端模型选择器", "找不到桌面端的模型選單"],
  ["未找到目标模型: ‹值›", "找不到模型「‹值›」"],
  ["缺少权限预设名称", "缺少權限預設名稱"],
  ["未找到桌面端权限选择器", "找不到桌面端的權限選單"],
  ["当前会话不允许切换权限预设", "這則對話無法切換權限預設"],
  ["权限选项不可用: ‹值›", "權限選項「‹值›」無法使用"],
  ["该权限预设当前被锁定: ‹值›", "權限預設「‹值›」目前已鎖定"],
  ["缺少附件数据", "缺少附件資料"],
  ["图片数据解析失败，请重新选择图片", "無法解析圖片，請重新選擇。"],
  ["未找到桌面端文件上传控件", "找不到桌面端的檔案上傳元件"],
  ["缺少图片数据", "缺少圖片資料"],
  ["未找到桌面端输入区域，已取消删除以防误删", "找不到桌面輸入區。為避免誤刪，已取消刪除。"],
  ["桌面端当前未找到可移除的附件", "桌面端沒有可移除的附件"],
  ["未在桌面端找到匹配的附件，已取消删除以防误删", "桌面端找不到相符的附件。為避免誤刪，已取消刪除。"],
  ["目标附件索引已失效，已取消删除以防误删", "附件位置已失效。為避免誤刪，已取消刪除。"],
  ["移除桌面端附件失败", "無法移除桌面端的附件"],
  ["当前没有排队中的消息", "目前沒有佇列中的訊息"],
  ["目标排队消息已变化或不存在，已取消‹動作›以防误操作", "佇列訊息已變更或已移除。為避免誤操作，已取消‹動作›。"],
  ["桌面排队数量已变化，已取消‹動作›以防索引移位误操作", "佇列訊息數量已變更，原位置可能已移動。為避免誤操作，已取消‹動作›。"],
  ["目标排队索引越界，已取消‹動作›以防误操作", "佇列訊息的位置超出範圍。為避免誤操作，已取消‹動作›。"],
  ["目标排队消息文本已变化，已取消‹動作›以防误操作", "佇列訊息的內容已變更。為避免誤操作，已取消‹動作›。"],
  ["存在多条相同文本排队消息，无法确认唯一目标，已取消", "多則佇列訊息的內容相同，無法確認操作對象，已取消操作。"],
  ["目标排队消息文本未匹配，已取消‹動作›以防误操作", "找不到內容相符的佇列訊息。為避免誤操作，已取消‹動作›。"],
  ["多条排队消息缺少唯一目标标识，已取消‹動作›以防误操作", "多則佇列訊息缺少可辨識的唯一 ID。為避免誤操作，已取消‹動作›。"],
  ["未找到桌面端排队消息发送按钮", "找不到桌面端佇列訊息的傳送按鈕"],
  ["未找到桌面端排队消息编辑/删除按钮", "找不到桌面端佇列訊息的編輯或刪除按鈕"],
  ["后台会话切回桌面原会话会清空临时输入区附件，当前无法无损提取完整附件数据，已取消撤回以避免丢失附件", "切回原本的桌面對話會清除暫存附件，目前無法完整取回附件。為避免遺失，已取消撤回。"],
  ["该排队消息包含媒体附件，但未能获取可恢复的附件元数据，已取消撤回以避免丢失附件", "無法取得還原佇列訊息附件所需的資料。為避免遺失附件，已取消撤回。"],
  ["该排队消息包含媒体附件且无原生编辑按钮，无法完整恢复附件数据，已取消撤回以避免丢失附件", "佇列訊息含媒體附件，且缺少原生編輯按鈕，無法完整還原附件。為避免遺失附件，已取消撤回。"],
  ["恢复附件至桌面端输入框失败，已取消删除原排队消息", "無法將附件還原至桌面輸入框，已取消刪除原佇列訊息。"],
  ["未找到桌面端排队消息删除按钮", "找不到桌面端佇列訊息的刪除按鈕"],
  ["未知操作: ‹值›", "無法辨識操作「‹值›」"],
  ["缺少 action 参数", "缺少 action 參數"],
  ["新建对话失败", "無法新增對話"],
  ["草稿附件上传失败，请重试", "草稿附件上傳失敗，請再試一次。"],
  ["发送消息失败", "無法傳送訊息"],
  ["发送消息异常", "傳送訊息時發生錯誤"],
  ["未知错误", "發生未知錯誤"],
  ["新对话", "新增對話"],
  ["新建对话", "新增對話"],
  ["正在等待确认或审批", "等待確認或核准"],
  ["发送", "傳送"],
  ["编辑", "編輯"],
  ["删除", "刪除"],
  ["桌面端队列操作未能生效，请重试", "桌面端未完成佇列操作，請再試一次。"],
  ["电脑端后台队列服务暂时无响应或超时，请稍后重试", "電腦端暫時無法處理佇列訊息，請稍後再試。"],
  ["草稿最多可附带 10 个待发附件", "草稿最多可附加 10 個檔案。"],
  ["草稿中未找到指定附件", "草稿中找不到指定的附件。"],
  ["首条消息正在发送或等待新会话 ID 确认，请稍候或切换会话后再试，避免重复发送", "正在傳送第一則訊息或確認新對話。請稍候，或切換對話後再試。"],
  ["通知通道正常，桌面应用未读角标将随已完成未读数自动同步。", "通知正常。桌面未讀徽章會同步顯示已完成的未讀對話數。"],
  ["删除原排队消息被服务端拒绝，已保留原排队项", "伺服器拒絕刪除，原佇列訊息已保留。"],
  ["删除原排队消息响应超时，经核验原项仍在队列中，请重试", "刪除逾時，原訊息仍在佇列中，請再試一次。"],
  ["删除原排队消息响应超时且无法确认原项状态，已保留恢复的文本与附件以避免丢失", "刪除逾時，無法確認原訊息狀態。已保留還原的文字與附件。"],
  ["删除原排队消息响应超时且无法确认原项状态，已保留恢复的文本以避免丢失", "刪除逾時，無法確認原訊息狀態。已保留還原的文字。"],
  ["立即发送排队消息失败", "無法立即傳送佇列訊息。"],
  ["立即发送请求超时或结果未知，已阻止自动补发以避免重复发送，请核对后再试", "無法確認訊息是否已傳送。系統已暫停自動重送，請先確認結果再試。"],
  ["当前会话存在同内容未确认撤回的暂存批次，无法确认本次编辑是否为原项重试，已取消删除以防覆盖已保留内容", "相同內容的上一筆撤回尚未確認。為保留已還原的內容，已取消刪除。"],
  ["消息此前已发送，重试移除原排队项仍失败；请稍后再试，不会重复发送", "訊息已傳送，仍無法移除原佇列項目。稍後可重試移除，訊息只會傳送一次。"],
  ["无法确认目标媒体排队项的桌面映射，已取消发送以防误发", "無法確認桌面端的附件屬於這則佇列訊息，已取消傳送。"],
  ["无法确认当前排队项与此前已发送待删项为同一消息（可能存在同内容新消息或并发变更），已停止操作以防误删或重复发送", "無法確認這是先前已傳送的訊息，已停止操作以避免誤刪或重複傳送。"],
  ["目标排队步骤内容或媒体形态已变化（索引已被其他消息占用），已取消操作以防误删", "佇列訊息或附件已變更。為避免誤操作，已取消操作。"],
  ["目标排队步骤的媒体附件签名已变化（索引已被同文异附件消息占用），已取消操作以防误删", "佇列訊息的附件已變更。為避免誤操作，已取消操作。"],
  ["纯媒体排队项缺少匹配的媒体身份标识（索引可能已被其他媒体项占用），已取消操作以防误删", "無法確認佇列訊息中的附件。為避免誤操作，已取消操作。"],
  ["该排队消息包含媒体附件，当前无法完整恢复附件数据，已取消撤回以避免丢失附件", "無法完整還原附件。為避免遺失，已取消撤回。"],
  ["缺少有效的排队标识 messageId 或 stepIndex", "缺少有效的佇列識別碼 messageId 或 stepIndex。"],
  ["未找到指定排队步骤或内容为空", "找不到指定的佇列訊息，或訊息內容為空。"],
  ["✓ 上下文已完成压缩", "✓ 已壓縮上下文"],
  ["读取上下文窗口失败", "無法讀取上下文，請再試一次。"],
  ["读取会话消息失败", "無法讀取對話，請再試一次。"],
  ["读取会话列表失败", "無法讀取對話，請再試一次。"],
  ["操作失败", "操作失敗，請確認電腦端狀態後再試。"],
  ["读取 Antigravity 状态失败", "無法讀取對話，請再試一次。"],
  ["‹連線方式› 连接方式已停用", "‹連線方式›連線已停用"],
  ["无法验证目标排队步骤状态，已取消撤回以防误删", "無法確認訊息仍在佇列中，已取消撤回。"],
  ["无法验证目标排队步骤状态，已取消编辑以防误删", "無法確認訊息仍在佇列中，已取消編輯。"],
  ["无法验证目标排队步骤状态，已取消操作以防误删或重复发送", "無法確認訊息仍在佇列中，已取消操作。"],
  ["目标步骤已不在排队中，已取消撤回", "訊息已離開佇列，已取消撤回。"],
  ["目标步骤已不在排队中，已取消编辑", "訊息已離開佇列，已取消編輯。"],
  ["目标步骤已不在排队中，已取消发送以防重复发送", "訊息已離開佇列，已取消傳送。"],
  ["存在多条相同文本排队消息，无法确认唯一目标，已取消‹動作›", "多則佇列訊息的內容相同，無法確認操作對象，已取消‹動作›。"],
]);

const REMOTE_TW_PHRASES = {
  '配對口令': '配對碼',
  '未發訊息': '尚未傳送的訊息',
  '發訊息': '傳送訊息',
  '已直發': '已傳送',
  '直發': '直接傳送',
  '推送服務不可達': '無法連線至推播服務',
  '不可達': '無法連線',
  '訊息推送設定': '推播通知設定',
  '高優推送': '優先推播通知',
  '推送偏好': '推播設定',
  '推送': '推播',
  '通道': '連線',
  '已關聯專案': '已連結專案',
  '已關聯': '已配對',
  '會話': '對話',
  '排隊': '佇列',
  '審核': '核准',
  '伺服端': '伺服器端',
  '服務端': '伺服器端',
  '超時': '逾時'
};
const REMOTE_TW_PHRASE_RE = new RegExp(Object.keys(REMOTE_TW_PHRASES).join('|'), 'g');

const REMOTE_TW_PLACEHOLDER = /‹(?:值|動作|數值|連線方式)›/g;
const REMOTE_TW_TEMPLATES = [...REMOTE_TW_COPY]
  .filter(([source]) => source.includes('‹'))
  .map(([source, copy]) => ({
    match: new RegExp('^' + source.split(REMOTE_TW_PLACEHOLDER)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$'),
    copy
  }));

function localizeRemoteText(text) {
  return REMOTE_TW_COPY.get(text) || convertZhCNToZhTW(text.replace(/会话/g, '會話'))
    .replace(REMOTE_TW_PHRASE_RE, (phrase) => REMOTE_TW_PHRASES[phrase]);
}

function localizeRemoteErrorText(text, fallback) {
  if (typeof text !== 'string' || !text) return text;
  if (REMOTE_TW_COPY.has(text)) return REMOTE_TW_COPY.get(text);
  for (const { match, copy } of REMOTE_TW_TEMPLATES) {
    const values = match.exec(text);
    if (!values) continue;
    let index = 0;
    return copy.replace(REMOTE_TW_PLACEHOLDER, (placeholder) => {
      const value = values[++index];
      return placeholder === '‹動作›' || placeholder === '‹連線方式›' ? localizeRemoteText(value) : value;
    });
  }
  const converted = localizeRemoteText(text);
  return fallback && converted !== text ? fallback : converted;
}

function localizeRemoteProjectName(name, id) {
  if (typeof name !== 'string') return name;
  if (/^(?:未归属项目|未歸屬項目)$/.test(name) && (!id || id === 'ungrouped')) return '未歸屬專案';
  if (/^(?:未命名项目|默认项目)$/.test(name) && (!id || id === 'default' || String(id).startsWith('dom:'))) {
    return localizeRemoteText(name);
  }
  if (name === '独立对话' && id === 'outside-of-project') return '獨立對話';
  return name;
}

function localizeRemoteConversationTitle(title, id, isNewConversation, projectId) {
  if (typeof title !== 'string') return title;
  const prefix = id ? String(id).slice(0, 8) : '';
  if (prefix && ['会话', '會話', '对话'].some((label) => title === label + ' ' + prefix)) {
    return '對話 ' + prefix;
  }
  if (!isNewConversation) return title;
  const separator = title.indexOf(' · ');
  const heading = separator < 0 ? title : title.slice(0, separator);
  if (!/^新[建增]?(?:对话|對話)$/.test(heading)) return title;
  return '新增對話' + (separator < 0 ? '' : ' · ' + localizeRemoteProjectName(title.slice(separator + 3), projectId));
}

function localizeRemoteConversation(item) {
  return {
    ...item,
    title: localizeRemoteConversationTitle(item.title, item.id),
    projectName: localizeRemoteProjectName(item.projectName, item.projectId),
    ...(item.statusLabel && {
      statusLabel: REMOTE_TW_COPY.get(item.statusLabel)
        || (statusToLabel(item.status) ? localizeRemoteText(statusToLabel(item.status)) : '狀態未知')
    })
  };
}

function formatTraditionalCatalogNotification(item, type) {
  const conversation = localizeRemoteConversation(item);
  const title = String(conversation.title || 'Antigravity 對話').slice(0, 60);
  const project = String(conversation.projectName || '').trim();
  return type === 'waiting'
    ? { titleTw: '請確認', bodyTw: title + (project ? '（' + project + '）' : '') + ' 等待確認或核准' }
    : { titleTw: '對話已完成', bodyTw: title + (project ? ' · ' + project : '') };
}

function localizeRemoteAttachmentSummary(text) {
  return text === '[图片附件]' ? '[圖片附件]' : text.replace(/\n\[附带 (\d+) 张图片\]$/, '\n[附加 $1 張圖片]');
}

function localizeRemoteMessage(message) {
  if (!message) return message;
  const result = { ...message };
  if (message.role === 'system-notice' && REMOTE_TW_COPY.has(message.text)) {
    result.text = localizeRemoteText(message.text);
  }
  if (message.thoughtLabel === '思考过程') result.thoughtLabel = '思考過程';
  if (REMOTE_TW_COPY.has(message.riskText)) result.riskText = localizeRemoteText(message.riskText);
  if (message.role === 'user' && /^t-u-\d+$/.test(message.id || '') && message.attachments?.length
      && typeof message.text === 'string') {
    const displayText = localizeRemoteAttachmentSummary(message.text);
    if (displayText !== message.text) result.displayText = displayText;
  }
  if (String(message.id || '').startsWith('rpc-e-') && typeof message.text === 'string' && !message.html) {
    result.text = localizeRemoteErrorText(message.text, '模型暫時無法回應，請再試一次。');
  }
  return result;
}

function localizeRemoteResponse(payload, localizeError) {
  if (!payload || typeof payload !== 'object') return payload;
  const result = { ...payload };
  for (const field of ['error', 'navError', 'isolationWarning']) {
    if (typeof payload[field] === 'string' && payload[field]) result[field] = localizeError(payload[field]);
  }
  for (const field of ['snapshot', 'actionResult', 'navResult']) {
    if (payload[field]) result[field] = localizeRemoteResponse(payload[field], localizeError);
  }
  if (Array.isArray(payload.results)) {
    result.results = payload.results.map((item) => item?.res
      ? { ...item, res: localizeRemoteResponse(item.res, localizeError) } : item);
  }
  if (typeof payload.title === 'string') {
    result.title = localizeRemoteConversationTitle(payload.title, payload.activeConversationId || payload.sessionId
      || payload.conversationId, payload.isNewConversation, payload.currentProjectId);
  }
  if (typeof payload.currentProjectName === 'string') {
    result.currentProjectName = localizeRemoteProjectName(payload.currentProjectName, payload.currentProjectId);
  }
  if (Array.isArray(payload.conversations)) {
    result.conversations = payload.conversations.map((item) => item && localizeRemoteConversation(item));
  }
  if (Array.isArray(payload.projects)) {
    result.projects = payload.projects.map((item) => item && { ...item, name: localizeRemoteProjectName(item.name, item.id) });
  }
  if (Array.isArray(payload.projectGroups)) {
    result.projectGroups = payload.projectGroups.map((group) => group && {
      ...localizeRemoteResponse(group, localizeError), name: localizeRemoteProjectName(group.name, group.id)
    });
  }
  if (Array.isArray(payload.messages)) result.messages = payload.messages.map(localizeRemoteMessage);
  if (Array.isArray(payload.queuedMessages)) {
    result.queuedMessages = payload.queuedMessages.map((item) => {
      if (!item?.hasMedia || item.source === 'dom' || typeof item.text !== 'string') return item;
      const displayText = localizeRemoteAttachmentSummary(item.text);
      return displayText === item.text ? item : { ...item, displayText };
    });
  }
  if (Array.isArray(payload.pendingApprovals)) {
    result.pendingApprovals = payload.pendingApprovals.map((item) => item?.label
      ? { ...item, displayLabel: localizeRemoteText(item.label) } : item);
  }
  if (Array.isArray(payload.pendingPrompts)) {
    result.pendingPrompts = payload.pendingPrompts.map((prompt) => prompt && {
      ...prompt,
      ...(typeof prompt.title === 'string' && { displayTitle: localizeRemoteText(prompt.title) }),
      ...(typeof prompt.otherPlaceholder === 'string' && { displayPlaceholder: localizeRemoteText(prompt.otherPlaceholder) }),
      ...(Array.isArray(prompt.actions) && {
        actions: prompt.actions.map((item) => item?.label
          ? { ...item, displayLabel: localizeRemoteText(item.label) } : item)
      }),
      ...(Array.isArray(prompt.options) && {
        options: prompt.options.map((item) => typeof item?.label === 'string' && REMOTE_TW_COPY.has(item.label)
          ? { ...item, displayLabel: localizeRemoteText(item.label) } : item)
      })
    });
  }
  for (const field of ['contextBadge', 'pulseText']) {
    if (typeof payload[field] === 'string' && payload[field]) result[field] = localizeRemoteText(payload[field]);
  }
  if (payload.contextPanel && typeof payload.contextPanel.contextBadge === 'string') {
    result.contextPanel = { ...payload.contextPanel, contextBadge: localizeRemoteText(payload.contextPanel.contextBadge) };
  }
  return result;
}

function localizeRemoteSource(source, locale) {
  if (locale !== 'zh-TW') return source;
  // Localize owned template text without touching script syntax, markup or runtime payloads.
  return source.replaceAll('lang="zh-CN"', 'lang="zh-TW"').replaceAll('PingFang SC', 'PingFang TC')
    .replace(/\p{Script=Han}+/gu, localizeRemoteText);
}

function serializeRemoteTemplateData(value) {
  return JSON.stringify(value).replace(/[<\u4e00-\u9fff]/g, (character) =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function buildMobileIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#09090b"/>
  <circle cx="256" cy="256" r="172" fill="none" stroke="url(#g)" stroke-width="26"/>
  <path d="M256 124 L350 364 L302 364 L280 304 L232 304 L210 364 L162 364 Z M256 184 L241 264 L271 264 Z" fill="#f4f4f5"/>
</svg>`;
}

function buildManifestJson(locale = 'zh-CN') {
  return JSON.stringify({
    lang: locale,
    name: locale === 'zh-TW' ? 'Antigravity 遠端操作' : 'Antigravity 远程操作',
    short_name: 'AG Remote',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
    ]
  });
}

function buildServiceWorkerJs(locale = 'zh-CN') {
  return localizeRemoteSource(`'use strict';
const RECOVERY_CACHE = 'ag-remote-recovery-v1';
// Mobile UI version: ${MOBILE_UI_VERSION}
const RECOVERY_META_KEY = '/__ag_recovery_meta__';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function escHtmlSw(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeRecoveryPayload(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const list = Array.isArray(src.endpoints) ? src.endpoints : [];
  const cleanEps = [];
  for (const ep of list) {
    if (!ep || typeof ep.url !== 'string' || !/^https?:\\/\\//i.test(ep.url)) continue;
    cleanEps.push({
      url: String(ep.url).replace(/\\/+$/, ''),
      kind: String(ep.kind || 'lan'),
      priority: Number.isFinite(Number(ep.priority)) ? Number(ep.priority) : 100
    });
  }
  return {
    endpoints: cleanEps,
    encodedEndpoints: typeof src.encodedEndpoints === 'string' ? src.encodedEndpoints : '',
    token: typeof src.token === 'string' ? src.token : '',
    name: typeof src.name === 'string' ? src.name : ''
  };
}

async function readRecoveryMeta() {
  try {
    if (!self.caches) return null;
    const cache = await self.caches.open(RECOVERY_CACHE);
    const res = await cache.match(RECOVERY_META_KEY);
    if (!res) return null;
    const data = await res.json().catch(() => null);
    return sanitizeRecoveryPayload(data);
  } catch {
    return null;
  }
}

function sortRecoveryEndpoints(endpoints, currentOrigin) {
  const rankKind = (ep) => {
    const u = String(ep?.url || '').toLowerCase();
    const k = String(ep?.kind || 'lan');
    if (k === 'tailscale' && u.startsWith('https://')) return 0;
    if (u.startsWith('https://') && k !== 'tunnel') return 1;
    if (k === 'lan') return 2;
    if (k === 'tailscale') return 3;
    if (k === 'bonjour') return 4;
    if (k === 'tunnel') return 5;
    return 8;
  };
  const curClean = String(currentOrigin || '').replace(/\\/+$/, '');
  return [...(endpoints || [])]
    .filter((ep) => ep && ep.url && ep.url !== curClean && String(ep.kind || '') !== 'loopback')
    .sort((a, b) => (rankKind(a) - rankKind(b)) || ((Number(a.priority) || 999) - (Number(b.priority) || 999)));
}

function kindTitleSw(ep) {
  const k = String(ep?.kind || '');
  const u = String(ep?.url || '').toLowerCase();
  if (k === 'tailscale') return u.startsWith('https://') ? 'Tailscale HTTPS' : 'Tailscale 直连';
  if (k === 'tunnel') return 'Cloudflare 隧道';
  if (k === 'bonjour') return 'Bonjour (mDNS)';
  return '局域网直连';
}

function buildRecoveryShellHtml(meta, statusCode) {
  const curOrigin = String(self.location?.origin || '').replace(/\\/+$/, '');
  const candidates = sortRecoveryEndpoints(meta?.endpoints || [], curOrigin);
  const safeStatus = Number(statusCode) || 0;
  const is1033 = safeStatus === 530;
  const reasonText = is1033
    ? '当前免登录 Cloudflare 临时隧道域名已失效（Error 1033）。临时域名是一次性的，电脑热更新、live 重载、重启软件或休眠断网后旧网址会永久作废并换新域名；可点击下方备用通道直连，或回电脑端「远程」重新扫码（长期使用推荐 Tailscale HTTPS 或固定域名）。'
    : '当前远程地址暂时无法连接到电脑端。';
  const btnsHtml = candidates.length > 0
    ? candidates.map((ep, idx) => {
        let hostText = ep.url;
        try { hostText = new URL(ep.url).host; } catch {}
        return '<button class="ep-btn" data-idx="' + idx + '" type="button">'
          + '<span class="ep-left"><span class="ep-name">' + escHtmlSw(kindTitleSw(ep)) + '</span>'
          + '<span class="ep-host">' + escHtmlSw(hostText) + '</span></span>'
          + '<span class="ep-go">切过去 →</span></button>';
      }).join('')
    : '<div class="empty-tip">暂未缓存其他备用通道，请在电脑端 Antigravity 右上角「远程」重新扫码打开。</div>';
  const inlineData = JSON.stringify({
    candidates: candidates.map((c) => c.url),
    token: String(meta?.token || ''),
    name: String(meta?.name || ''),
    encodedEndpoints: String(meta?.encodedEndpoints || '')
  }).replace(/</g, '\\\\u003c');

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>通道已中断 · 切换可用连接</title><style>'
    + ':root{color-scheme:light dark}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}'
    + 'body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;background:#09090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;line-height:1.5}'
    + '.card{width:100%;max-width:420px;padding:22px 18px;border-radius:18px;background:#111114;border:1px solid rgba(255,255,255,.12)}'
    + 'h1{margin:0 0 8px;font-size:17px;font-weight:700}p{margin:0 0 14px;font-size:13.5px;color:#a1a1aa}'
    + '.list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}'
    + '.ep-btn{appearance:none;width:100%;padding:11px 12px;border-radius:12px;border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.1);color:#f4f4f5;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer}'
    + '.ep-left{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}'
    + '.ep-name{font-size:14px;font-weight:600}.ep-host{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#a1a1aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ep-go{font-size:12px;font-weight:600;color:#7dd3fc;flex-shrink:0}'
    + '.reload-btn{appearance:none;width:100%;min-height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#f4f4f5;font-size:13.5px;font-weight:600;cursor:pointer}'
    + '.empty-tip{padding:12px;border-radius:10px;background:rgba(255,255,255,.04);font-size:13px;color:#a1a1aa}'
    + '.hint{margin-top:12px;font-size:12px;color:#71717a;text-align:center}'
    + '@media (prefers-color-scheme:light){body{background:#f8fafc;color:#18181b}.card{background:#fff;border-color:rgba(15,23,42,.12)}p,.ep-host,.empty-tip,.hint{color:#52525b}.ep-btn{background:rgba(2,132,199,.08);color:#09090b;border-color:rgba(2,132,199,.35)}.ep-go{color:#0369a1}.reload-btn{background:#f1f5f9;border-color:rgba(15,23,42,.15);color:#18181b}}'
    + '</style></head><body><div class="card">'
    + '<h1>远程通道暂时无法连接</h1>'
    + '<p>' + escHtmlSw(reasonText) + '</p>'
    + '<div class="list" id="ep-list">' + btnsHtml + '</div>'
    + '<button class="reload-btn" id="btn-reload" type="button">重新加载当前页</button>'
    + '<div class="hint">如仍无法连接，请在电脑端重新扫码或点击「远程设置」刷新</div>'
    + '</div><script>(function(){var d=' + inlineData + ';'
    + 'var bs=document.querySelectorAll(".ep-btn");'
    + 'for(var i=0;i<bs.length;i++){bs[i].onclick=function(){var u=d.candidates[Number(this.getAttribute("data-idx"))];if(!u)return;'
    + 'var ps=["manual=1"];if(d.token)ps.push("token="+encodeURIComponent(d.token));'
    + 'if(d.name)ps.push("name="+encodeURIComponent(d.name));'
    + 'if(d.encodedEndpoints)ps.push("endpoints="+encodeURIComponent(d.encodedEndpoints));'
    + 'location.replace(u+"/?"+ps.join("&"));};}'
    + 'var rb=document.getElementById("btn-reload");if(rb)rb.onclick=function(){location.reload();};'
    + '})();<' + '/script></body></html>';
}

self.addEventListener('message', (event) => {
  const msg = event && event.data;
  if (!msg || msg.type !== 'ag-cache-endpoints') return;
  const payload = sanitizeRecoveryPayload(msg);
  if (!payload.endpoints.length || !self.caches) return;
  event.waitUntil(
    self.caches.open(RECOVERY_CACHE)
      .then((cache) => cache.put(
        RECOVERY_META_KEY,
        new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
      ))
      .catch(() => {})
  );
});

self.addEventListener('fetch', (event) => {
  const req = event && event.request;
  if (!req || req.mode !== 'navigate' || req.method !== 'GET') return;
  try {
    const reqUrl = new URL(req.url);
    if (reqUrl.origin !== self.location.origin) return;
  } catch {
    return;
  }
  event.respondWith((async () => {
    let statusCode = 0;
    try {
      const res = await fetch(req);
      if (res && ![502, 503, 504, 530].includes(res.status)) {
        return res;
      }
      statusCode = res ? res.status : 503;
    } catch {
      statusCode = 0;
    }
    const meta = await readRecoveryMeta();
    return new Response(buildRecoveryShellHtml(meta, statusCode), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  })());
});

function updateSwBadge(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  try {
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      if (n > 0) return self.navigator.setAppBadge(n).catch(() => {});
      if (typeof self.navigator.clearAppBadge === 'function') {
        return self.navigator.clearAppBadge().catch(() => {});
      }
      return self.navigator.setAppBadge(0).catch(() => {});
    }
  } catch {}
  return Promise.resolve();
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      try {
        data = { body: event.data ? event.data.text() : '' };
      } catch {
        data = {};
      }
    }
    if (typeof data.completedUnreadCount === 'number' && Number.isFinite(data.completedUnreadCount)) {
      await updateSwBadge(data.completedUnreadCount);
      try {
        const winList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of winList) {
          if (client && typeof client.postMessage === 'function') {
            client.postMessage({ type: 'ag-push-badge-updated', completedUnreadCount: data.completedUnreadCount });
          }
        }
      } catch {}
    }
    if (data.silent) return;
    const traditional = ${locale === 'zh-TW'};
    const suppliedTitle = String(data.title || '');
    const isTestPush = data.type === 'test' || data.tag === 'ag-push-test';
    const isWaitingPush = data.type === 'waiting' || suppliedTitle === ${serializeRemoteTemplateData('需要你的确认')};
    const isCompletedPush = data.type === 'completed' || suppliedTitle === ${serializeRemoteTemplateData('对话已完成')};
    const title = isTestPush ? 'Antigravity 远程通知测试'
      : traditional && data.titleTw ? String(data.titleTw)
      : isWaitingPush ? '需要你的确认'
      : isCompletedPush ? '对话已完成'
      : traditional ? '有新的会话状态更新' : suppliedTitle || 'Antigravity 远程通知';
    const waitingSuffix = ${serializeRemoteTemplateData(' 正在等待确认或审批')};
    const suppliedBody = String(data.body || '');
    const legacyHeading = suppliedBody.endsWith(waitingSuffix) ? suppliedBody.slice(0, -waitingSuffix.length) : suppliedBody;
    const legacyTitle = ${serializeRemoteTemplateData('Antigravity 对话')};
    const legacyProject = ${serializeRemoteTemplateData('未归属项目')};
    let localHeading = legacyHeading;
    if (traditional) {
      localHeading = localHeading.replace(new RegExp('^' + legacyTitle + '(?=$| [·(])'), 'Antigravity 对话');
      const projectSuffix = localHeading.endsWith(' (' + legacyProject + ')') ? ' (' + legacyProject + ')'
        : localHeading.endsWith(' · ' + legacyProject) ? ' · ' + legacyProject : '';
      if (projectSuffix) {
        localHeading = localHeading.slice(0, -projectSuffix.length)
          + (projectSuffix.startsWith(' (') ? '（未归属项目）' : ' · 未归属项目');
      }
    }
    const body = isTestPush ? ${serializeRemoteTemplateData(locale === 'zh-TW' ? localizeRemoteText('推送通道正常，桌面应用未读角标将随已完成未读数自动同步。') : '推送通道正常，桌面应用未读角标将随已完成未读数自动同步。')}
      : traditional && data.bodyTw ? String(data.bodyTw)
      : traditional && !isWaitingPush && !isCompletedPush ? '有新的会话状态更新'
      : suppliedBody.endsWith(waitingSuffix)
      ? localHeading + ' 正在等待确认或审批'
      : localHeading || '有新的会话状态更新';
    const tag = String(data.tag || ('ag-push-' + Date.now()));
    const url = String(data.url || '/');
    const conversationId = String(data.conversationId || '');
    await self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-180.png',
      tag,
      renotify: true,
      data: { url, conversationId }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = (event.notification && event.notification.data) || {};
  const conversationId = String(payload.conversationId || '');
  const targetUrl = String(payload.url || (conversationId ? ('/?conversationId=' + encodeURIComponent(conversationId)) : '/'));
  event.waitUntil((async () => {
    const winList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of winList) {
      try {
        if (client && 'focus' in client) {
          await client.focus();
          if (conversationId && typeof client.postMessage === 'function') {
            client.postMessage({ type: 'ag-open-conversation', conversationId });
          }
          return;
        }
      } catch {}
    }
    if (self.clients && typeof self.clients.openWindow === 'function') {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
`, locale);
}

function buildUnauthorizedHtml(locale = 'zh-CN') {
  return localizeRemoteSource(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Antigravity 远程未授权</title>
  <style>
    :root{color-scheme:light dark;--ease-out:cubic-bezier(.22,1,.36,1)}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    body{
      margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
      padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));
      background:#09090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;line-height:1.5
    }
    .card{
      max-width:420px;width:100%;padding:22px;border-radius:18px;background:#18181b;
      border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 56px rgba(0,0,0,.45);
      animation:ag-auth-in .22s var(--ease-out)
    }
    @keyframes ag-auth-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .icon-badge{
      width:40px;height:40px;border-radius:12px;margin-bottom:12px;
      display:inline-flex;align-items:center;justify-content:center;
      background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.32);color:#7dd3fc
    }
    h1{margin:0 0 8px;font-size:18px;font-weight:700;text-wrap:balance}
    p{margin:0 0 14px;color:#a1a1aa;font-size:14px;text-wrap:pretty}
    code{
      display:block;padding:11px 12px;border-radius:10px;background:#09090b;color:#7dd3fc;
      font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      border:1px solid rgba(56,189,248,.28);overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch
    }
    .actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
    .btn{
      appearance:none;flex:1 1 130px;min-height:40px;padding:0 14px;border-radius:10px;
      font-size:13.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;
      transition:transform .12s var(--ease-out),filter .15s ease,background-color .15s ease
    }
    .btn:active:not(:disabled){transform:scale(.975)}
    .btn:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
    .btn.primary{
      border:none;background:#38bdf8;color:#082f49;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.24),0 1px 2px rgba(0,0,0,.18)
    }
    .btn.secondary{
      border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#f4f4f5
    }
    .status{margin-top:10px;min-height:18px;font-size:12px;color:#7dd3fc}
    @media (prefers-color-scheme:light){
      body{background:#f8fafc;color:#18181b}
      .card{background:#ffffff;border-color:rgba(15,23,42,.12);box-shadow:0 12px 32px rgba(15,23,42,.08)}
      .icon-badge{background:rgba(2,132,199,.1);border-color:rgba(2,132,199,.28);color:#0369a1}
      p{color:#52525b}
      code{background:#f1f5f9;color:#0369a1;border-color:rgba(2,132,199,.28)}
      .btn:focus-visible{outline-color:#0284c7}
      .btn.primary{background:#0369a1;color:#ffffff}
      .btn.secondary{background:#f1f5f9;border-color:rgba(15,23,42,.15);color:#18181b}
      .status{color:#0369a1}
    }
    @media (prefers-reduced-motion:reduce){
      *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <h1>需要配对口令</h1>
    <p>当前浏览器未携带有效的配对凭据。请在电脑终端运行下方命令后重新扫码打开：</p>
    <code id="auth-cmd">ag-context-meter remote</code>
    <div class="actions">
      <button id="btn-copy-cmd" class="btn primary" type="button">复制终端命令</button>
      <button id="btn-retry-conn" class="btn secondary" type="button">重新检测连接</button>
    </div>
    <div id="auth-status" class="status" role="status" aria-live="polite"></div>
  </div>
  <script>
  (function(){
    var cmd = 'ag-context-meter remote';
    var statusEl = document.getElementById('auth-status');
    var copyBtn = document.getElementById('btn-copy-cmd');
    var retryBtn = document.getElementById('btn-retry-conn');
    function setStatus(txt){ if (statusEl) statusEl.textContent = txt || ''; }
    if (copyBtn) {
      copyBtn.onclick = function(){
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(cmd).then(function(){
            setStatus('已复制命令，请粘贴到电脑终端运行');
          }, function(){
            fallbackCopy();
          });
        } else {
          fallbackCopy();
        }
      };
    }
    function fallbackCopy(){
      try {
        var ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setStatus(ok ? '已复制命令，请粘贴到电脑终端运行' : '请长按上方命令手动复制');
      } catch (e) {
        setStatus('请长按上方命令手动复制');
      }
    }
    if (retryBtn) {
      retryBtn.onclick = function(){
        retryBtn.disabled = true;
        retryBtn.textContent = '正在检测…';
        setStatus('正在刷新页面检查连接状态…');
        location.reload();
      };
    }
  })();
  </script>
</body>
</html>`, locale);
}

function buildMobileAppHtml(locale = 'zh-CN') {
  const chromeLabels = [
    ...['waiting', 'running', 'error', 'unknown'].map(statusToLabel),
    '主目录 (~)', '允许', '拒绝', '取消', '确认', '继续', '重试', '提交',
    '始终允许', '仅允许一次', '需要你的确认', '步骤异常'
  ];
  const localizedChromeLabels = locale === 'zh-TW'
    ? Object.fromEntries(chromeLabels.map((label) => [label, localizeRemoteText(label)]))
    : {};
  const shortLabels = {
    'tpl-run': '執行一下',
    'tpl-implement': '直接實作',
    'tpl-req': '照需求做',
    'tpl-no-explain': '不用說明',
    'tpl-why': '為什麼無法執行',
    btw: '/btw 延伸提問',
    learn: '/learn 歸納',
    goal: '/goal 做到完',
    boost: '/boost 解題',
    teamwork: '/teamwork 團隊',
    schedule: '/schedule 排程'
  };
  const builtInPrompts = locale === 'zh-TW'
    ? Object.fromEntries([
        ...DEFAULT_REMOTE_QUICK_PROMPTS,
        ...REMOTE_BUILTIN_POOL_DEFS,
        { id: 'tpl-req', label: '按这个需求做', text: '按这个需求做：\n' },
        { id: 'tpl-no-explain', label: '不要解释', text: '不要解释' },
        { id: 'tpl-why', label: '为什么不行', text: '为什么不行' },
        { id: 'tpl-revise', label: '再改一版', text: '再改一版' }
      ].map(({ id, label, text }) => [
        id, {
          label,
          text,
          labelTw: shortLabels[id] || localizeRemoteText(label),
          textTw: id === 'tpl-req' ? '依這項需求實作：\n'
            : shortLabels[id] && text.startsWith(label) ? shortLabels[id] + text.slice(label.length) : localizeRemoteText(text)
        }
      ]))
    : {};
  const suggestionLabels = {
    '先帮我梳理下当前任务并给出方案': '先幫我整理目前的任務並提出方案',
    '按这个需求做：': '依這項需求實作：',
    '直接实现': '直接實作',
    '确认，按推荐方案执行': '確認，依建議方案執行',
    '再改一版': '再改一版',
    '继续': '繼續',
    '修复这个报错': '修正這個錯誤',
    '为什么不行': '為什麼無法執行',
    '跑一下': '執行一下',
    '优化一下': '優化一下',
    '不要解释': '不用說明'
  };
  const shortSuggestionLabels = locale === 'zh-TW' ? {
    [suggestionLabels['先帮我梳理下当前任务并给出方案']]: '整理任務',
    [suggestionLabels['按这个需求做：']]: '照需求做'
  } : {};
  const localizedSuggestions = locale === 'zh-TW' ? Object.fromEntries(
    Object.entries(suggestionLabels).flatMap(([source, label]) => [[source, label], [localizeRemoteText(source), label]])
  ) : {};
  const permissionLabels = locale === 'zh-TW' ? {
    turbo: '無限 (Turbo)',
    auto: '自動 (Auto)',
    default: '預設 (Default)',
    request_review: '請求核准 (Review)'
  } : {};
  const sourceProjectLabels = ['未归属项目', '未歸屬項目', '未歸屬專案'];
  const sourceNewChatLabels = ['新对话', '新對話', '新建对话', '新建對話', '新增對話'];
  return localizeRemoteSource(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta id="meta-theme-color" name="theme-color" content="#09090b">
  <title>Antigravity 远程操作</title>
  <link rel="manifest" href="/manifest.json?lang=${locale}">
  <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <script id="ag-theme-boot">(function(){try{var p=localStorage.getItem('ag_remote_theme_v1');if(p!=='light'&&p!=='dark'&&p!=='system')p='system';var l=p==='light'||(p==='system'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: light)').matches);var t=l?'light':'dark';var d=document.documentElement;d.setAttribute('data-theme',t);d.setAttribute('data-theme-pref',p);d.style.colorScheme=t;var m=document.getElementById('meta-theme-color');if(m)m.setAttribute('content',l?'#f8fafc':'#09090b');}catch{}})();</script>
  <style>
    :root{
      color-scheme:dark;
      --ease-out:cubic-bezier(.22,1,.36,1);
      --bg:#09090b;--topbar-bg:rgba(12,12,15,.88);--topbar-border:rgba(255,255,255,.07);
      --drawer-bg:#18181b;--sidebar-bg:#111114;--sidebar-border:rgba(255,255,255,.08);
      --card:#18181b;--card2:#27272a;--composer-bg:#16161a;--composer-border:rgba(255,255,255,.11);
      --composer-shadow:0 8px 28px rgba(0,0,0,.45);--composer-shadow-lg:0 12px 36px rgba(0,0,0,.4);
      --surface-highlight:rgba(255,255,255,.07);
      --approval-dock-bg:rgba(24,24,27,.98);
      --dock-bg:rgba(16,16,20,.94);--dock-shadow:0 -6px 18px rgba(0,0,0,.38);
      --surface-subtle:rgba(255,255,255,.04);--surface-soft:rgba(255,255,255,.05);--surface-hover:rgba(255,255,255,.08);
      --surface-strong:rgba(255,255,255,.07);--surface-strong-hover:rgba(255,255,255,.11);
      --border:rgba(255,255,255,.11);--border-subtle:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.18);
      --fg:#f4f4f5;--fg-strong:#fafafa;--fg-secondary:#e4e4e7;--fg-sub:#d4d4d8;--muted:#a1a1aa;--placeholder:#8e8e98;
      --accent:#38bdf8;--accent-fg:#7dd3fc;--accent-strong-fg:#bae6fd;--accent-bg:rgba(56,189,248,.11);--accent-border:rgba(56,189,248,.34);
      --btn-primary-bg:#38bdf8;
      --green:#34d399;--amber:#fbbf24;--red:#f87171;--risk-fg:#fca5a5;--risk-bg:rgba(239,68,68,.14);--risk-border:rgba(248,113,113,.55);
      --diff-add:#4ade80;--diff-del:#f87171;
      --code-bg:rgba(255,255,255,.1);--pre-bg:#09090b;--qbar-bg:rgba(255,255,255,.12);--thought-summary:#93c5fd;
      --ap-approve-bg:#10b981;--ap-approve-fg:#052e16;--ap-reject-bg:#3f3f46;--ap-reject-fg:#f4f4f5;
      --user-bg:#1d4ed8;--user-fg:#f8fafc;--send-ready-fg:#082f49;
      --toast-bg:#27272a;--toast-fg:#fff;--backdrop-bg:rgba(0,0,0,.58);
      --pop-shadow:0 16px 40px rgba(0,0,0,.6);--sheet-shadow:0 24px 64px rgba(0,0,0,.65);
      --scroll-thumb:rgba(255,255,255,.14);--scroll-thumb-hover:rgba(255,255,255,.26);
      --seg-track:rgba(255,255,255,.05);--seg-active-bg:#27272a;--seg-active-shadow:0 1px 3px rgba(0,0,0,.35);
      --input-bg:rgba(9,9,11,.75);
      --proj-head-bg:rgba(255,255,255,.06);--proj-head-border:rgba(255,255,255,.09);
      --proj-count-bg:rgba(255,255,255,.09);
      --badge-fast-bg:rgba(52,211,153,.16);--badge-fast-fg:#6ee7b7;--badge-fast-border:rgba(52,211,153,.35);
      --badge-mid-bg:rgba(251,191,36,.15);--badge-mid-fg:#fde68a;
      --badge-slow-bg:rgba(249,115,22,.18);--badge-slow-fg:#fdba74;
      --badge-run-bg:rgba(34,197,94,.16);--badge-run-fg:#86efac;
      --badge-wait-bg:rgba(245,158,11,.18);--badge-wait-fg:#fde68a;
      --badge-err-bg:rgba(239,68,68,.18);--badge-err-fg:#fca5a5;
      --badge-unk-bg:rgba(113,113,122,.18);--badge-unk-fg:#a1a1aa;
      --git-tag-bg:rgba(52,211,153,.15);--git-tag-fg:#6ee7b7;
      --warn-card-bg:rgba(245,158,11,.12);--warn-card-border:rgba(245,158,11,.55);--warn-card-fg:#fde68a;
      --perm-review:#c084fc;
      --unread-dot:#3b82f6;--unread-glow:rgba(59,130,246,.24);
      --app-h:100dvh;
      --modal-h:100dvh;
      --safe-bottom:0px;
    }
    @media (display-mode:standalone){
      :root{--safe-bottom:min(20px,max(0px,calc(env(safe-area-inset-bottom,0px) - 14px)))}
    }
    body.is-standalone{--safe-bottom:min(20px,max(0px,calc(env(safe-area-inset-bottom,0px) - 14px)))}
    @media (prefers-color-scheme:light){
      :root:not([data-theme="dark"]){
        color-scheme:light;
        --bg:#f8fafc;--topbar-bg:rgba(248,250,252,.88);--topbar-border:rgba(15,23,42,.08);
        --drawer-bg:#ffffff;--sidebar-bg:#f1f5f9;--sidebar-border:rgba(15,23,42,.08);
        --card:#ffffff;--card2:#e2e8f0;--composer-bg:#ffffff;--composer-border:rgba(15,23,42,.14);
        --composer-shadow:0 6px 24px rgba(15,23,42,.07);--composer-shadow-lg:0 10px 30px rgba(15,23,42,.08);
        --surface-highlight:rgba(255,255,255,.85);
        --approval-dock-bg:rgba(248,250,252,.96);
        --dock-bg:rgba(241,245,249,.95);--dock-shadow:0 -6px 16px rgba(15,23,42,.08);
        --surface-subtle:rgba(15,23,42,.035);--surface-soft:rgba(15,23,42,.05);--surface-hover:rgba(15,23,42,.08);
        --surface-strong:#ffffff;--surface-strong-hover:rgba(15,23,42,.06);
        --border:rgba(15,23,42,.13);--border-subtle:rgba(15,23,42,.08);--border-strong:rgba(15,23,42,.2);
        --fg:#18181b;--fg-strong:#09090b;--fg-secondary:#27272a;--fg-sub:#3f3f46;--muted:#52525b;--placeholder:#64748b;
        --accent:#0284c7;--accent-fg:#0369a1;--accent-strong-fg:#075985;--accent-bg:rgba(2,132,199,.09);--accent-border:rgba(2,132,199,.32);
        --btn-primary-bg:#0369a1;
        --green:#059669;--amber:#d97706;--red:#dc2626;--risk-fg:#b91c1c;--risk-bg:rgba(239,68,68,.09);--risk-border:rgba(220,38,38,.42);
        --diff-add:#15803d;--diff-del:#b91c1c;
        --code-bg:rgba(15,23,42,.06);--pre-bg:#f1f5f9;--qbar-bg:rgba(15,23,42,.1);--thought-summary:#0369a1;
        --ap-approve-bg:#047857;--ap-approve-fg:#ffffff;--ap-reject-bg:#e4e4e7;--ap-reject-fg:#18181b;
        --user-bg:#2563eb;--user-fg:#ffffff;--send-ready-fg:#ffffff;
        --toast-bg:#18181b;--toast-fg:#fafafa;--backdrop-bg:rgba(15,23,42,.36);
        --pop-shadow:0 14px 36px rgba(15,23,42,.14);--sheet-shadow:0 20px 56px rgba(15,23,42,.18);
        --scroll-thumb:rgba(15,23,42,.18);--scroll-thumb-hover:rgba(15,23,42,.32);
        --seg-track:rgba(15,23,42,.06);--seg-active-bg:#ffffff;--seg-active-shadow:0 1px 3px rgba(15,23,42,.12);
        --input-bg:#f8fafc;
        --proj-head-bg:rgba(15,23,42,.055);--proj-head-border:rgba(15,23,42,.1);
        --proj-count-bg:rgba(15,23,42,.08);
        --badge-fast-bg:rgba(5,150,105,.12);--badge-fast-fg:#065f46;--badge-fast-border:rgba(5,150,105,.32);
        --badge-mid-bg:rgba(217,119,6,.13);--badge-mid-fg:#92400e;
        --badge-slow-bg:rgba(234,88,12,.12);--badge-slow-fg:#9a3412;
        --badge-run-bg:rgba(5,150,105,.13);--badge-run-fg:#047857;
        --badge-wait-bg:rgba(217,119,6,.14);--badge-wait-fg:#92400e;
        --badge-err-bg:rgba(220,38,38,.13);--badge-err-fg:#b91c1c;
        --badge-unk-bg:rgba(82,82,91,.12);--badge-unk-fg:#52525b;
        --git-tag-bg:rgba(5,150,105,.13);--git-tag-fg:#047857;
        --warn-card-bg:rgba(245,158,11,.12);--warn-card-border:rgba(217,119,6,.5);--warn-card-fg:#92400e;
        --perm-review:#7c3aed;
        --unread-dot:#2563eb;--unread-glow:rgba(37,99,235,.2);
      }
    }
    html[data-theme="light"]{
      color-scheme:light;
      --bg:#f8fafc;--topbar-bg:rgba(248,250,252,.88);--topbar-border:rgba(15,23,42,.08);
      --drawer-bg:#ffffff;--sidebar-bg:#f1f5f9;--sidebar-border:rgba(15,23,42,.08);
      --card:#ffffff;--card2:#e2e8f0;--composer-bg:#ffffff;--composer-border:rgba(15,23,42,.14);
      --composer-shadow:0 6px 24px rgba(15,23,42,.07);--composer-shadow-lg:0 10px 30px rgba(15,23,42,.08);
      --surface-highlight:rgba(255,255,255,.85);
      --approval-dock-bg:rgba(248,250,252,.96);
      --dock-bg:rgba(241,245,249,.95);--dock-shadow:0 -6px 16px rgba(15,23,42,.08);
      --surface-subtle:rgba(15,23,42,.035);--surface-soft:rgba(15,23,42,.05);--surface-hover:rgba(15,23,42,.08);
      --surface-strong:#ffffff;--surface-strong-hover:rgba(15,23,42,.06);
      --border:rgba(15,23,42,.13);--border-subtle:rgba(15,23,42,.08);--border-strong:rgba(15,23,42,.2);
      --fg:#18181b;--fg-strong:#09090b;--fg-secondary:#27272a;--fg-sub:#3f3f46;--muted:#52525b;--placeholder:#64748b;
      --accent:#0284c7;--accent-fg:#0369a1;--accent-strong-fg:#075985;--accent-bg:rgba(2,132,199,.09);--accent-border:rgba(2,132,199,.32);
      --btn-primary-bg:#0369a1;
      --green:#059669;--amber:#d97706;--red:#dc2626;--risk-fg:#b91c1c;--risk-bg:rgba(239,68,68,.09);--risk-border:rgba(220,38,38,.42);
      --diff-add:#15803d;--diff-del:#b91c1c;
      --code-bg:rgba(15,23,42,.06);--pre-bg:#f1f5f9;--qbar-bg:rgba(15,23,42,.1);--thought-summary:#0369a1;
      --ap-approve-bg:#047857;--ap-approve-fg:#ffffff;--ap-reject-bg:#e4e4e7;--ap-reject-fg:#18181b;
      --user-bg:#2563eb;--user-fg:#ffffff;--send-ready-fg:#ffffff;
      --toast-bg:#18181b;--toast-fg:#fafafa;--backdrop-bg:rgba(15,23,42,.36);
      --pop-shadow:0 14px 36px rgba(15,23,42,.14);--sheet-shadow:0 20px 56px rgba(15,23,42,.18);
      --scroll-thumb:rgba(15,23,42,.18);--scroll-thumb-hover:rgba(15,23,42,.32);
      --seg-track:rgba(15,23,42,.06);--seg-active-bg:#ffffff;--seg-active-shadow:0 1px 3px rgba(15,23,42,.12);
      --input-bg:#f8fafc;
      --proj-head-bg:rgba(15,23,42,.055);--proj-head-border:rgba(15,23,42,.1);
      --proj-count-bg:rgba(15,23,42,.08);
      --badge-fast-bg:rgba(5,150,105,.12);--badge-fast-fg:#065f46;--badge-fast-border:rgba(5,150,105,.32);
      --badge-mid-bg:rgba(217,119,6,.13);--badge-mid-fg:#92400e;
      --badge-slow-bg:rgba(234,88,12,.12);--badge-slow-fg:#9a3412;
      --badge-run-bg:rgba(5,150,105,.13);--badge-run-fg:#047857;
      --badge-wait-bg:rgba(217,119,6,.14);--badge-wait-fg:#92400e;
      --badge-err-bg:rgba(220,38,38,.13);--badge-err-fg:#b91c1c;
      --badge-unk-bg:rgba(82,82,91,.12);--badge-unk-fg:#52525b;
      --git-tag-bg:rgba(5,150,105,.13);--git-tag-fg:#047857;
      --warn-card-bg:rgba(245,158,11,.12);--warn-card-border:rgba(217,119,6,.5);--warn-card-fg:#92400e;
      --perm-review:#7c3aed;
      --unread-dot:#2563eb;--unread-glow:rgba(37,99,235,.2);
    }
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    button:focus-visible,[tabindex]:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .composer-card textarea:focus-visible,.prompt-other-input:focus-visible,.proj-path-input:focus-visible,.proj-field-input:focus-visible{outline:none}
    button:not(:disabled){transition:transform .12s var(--ease-out),background-color .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease}
    button:active:not(:disabled){transform:scale(.975)}
    html{
      margin:0;padding:0;width:100%;height:100%;height:100dvh;overflow:hidden;
      background:var(--bg);color:var(--fg);overscroll-behavior:none;
    }
    body{
      margin:0;padding:0;width:100%;position:fixed;inset:0;height:auto;overflow:hidden;
      background:var(--bg);color:var(--fg);touch-action:manipulation;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;
      font-size:14px;line-height:1.45;overscroll-behavior:none;
    }
    .app{
      display:flex;flex-direction:column;width:100%;height:100%;
      padding-top:env(safe-area-inset-top);
      padding-bottom:calc(4px + var(--safe-bottom));
      padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);
    }
    .app.kb-open{padding-bottom:4px}
    .topbar{
      flex-shrink:0;display:flex;align-items:center;gap:8px;padding:8px 12px;
      border-bottom:1px solid var(--topbar-border);background:var(--topbar-bg);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    }
    .conn-banner{
      flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
      padding:8px 12px;background:var(--warn-card-bg);border-bottom:1px solid var(--warn-card-border);
      color:var(--warn-card-fg);font-size:12.5px;line-height:1.4;
    }
    .conn-banner[hidden]{display:none}
    .conn-banner-msg{flex:1 1 180px;min-width:0;font-weight:500}
    .conn-banner-actions{display:inline-flex;align-items:center;gap:6px;flex-shrink:0}
    .conn-banner-btn{
      appearance:none;min-height:32px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:600;
      border:1px solid var(--warn-card-border);background:var(--card);color:var(--fg-strong);cursor:pointer;white-space:nowrap;
    }
    .conn-banner-btn.primary{background:var(--btn-primary-bg);border-color:transparent;color:var(--send-ready-fg)}
    .icon-btn{
      appearance:none;border:none;background:transparent;color:var(--muted);
      border-radius:10px;height:34px;min-width:34px;padding:0 6px;
      display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;
    }
    .icon-btn:active{background:var(--surface-hover);color:var(--fg-strong)}
    .drawer-refresh-btn,.panel-close-btn{
      min-height:34px;height:34px;padding:0 10px;gap:5px;font-size:12px;font-weight:600;white-space:nowrap;
      border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg-secondary);border-radius:9px;
    }
    .drawer-refresh-btn.is-spinning svg{animation:agspin .7s linear infinite}
    .drawer-refresh-btn:disabled{opacity:.65;cursor:default}
    .title-wrap{
      flex:1 1 auto;min-width:0;overflow:hidden;
      display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;
      column-gap:5px;row-gap:2px;align-items:center;
    }
    .title-row{display:contents}
    .dot{grid-column:1;grid-row:1;width:7px;height:7px;border-radius:99px;background:var(--green);flex-shrink:0}
    .dot.busy{background:var(--amber);animation:pulse 1s infinite ease-in-out}
    .dot.err{background:var(--red)}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.82)}}
    @keyframes ag-pop-in{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes ag-sheet-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    @keyframes ag-toast-in{from{opacity:0;transform:translate(-50%,-8px) scale(.96)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
    @keyframes ag-shimmer{0%{opacity:.45}50%{opacity:.85}100%{opacity:.45}}
    .conv-title{
      grid-column:2;grid-row:1;min-width:0;
      font-size:14.5px;font-weight:600;color:var(--fg-strong);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;
    }
    .sub-row{
      grid-column:1 / -1;grid-row:2;min-width:0;overflow:hidden;
      display:flex;align-items:center;gap:5px;
    }
    .conv-project-badge{
      display:inline-block;vertical-align:middle;max-width:128px;min-width:0;padding:1px 6px;border-radius:999px;
      font-size:10.5px;font-weight:500;line-height:1.35;letter-spacing:0;
      background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-strong-fg);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;
    }
    .conv-project-badge[hidden]{display:none!important}
    .sub-meta{
      flex:1 1 auto;min-width:0;font-size:11.5px;color:var(--muted);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;
      cursor:pointer;display:block;
    }
    .sub-meta:active{color:var(--accent)}
    .channel-pill{
      appearance:none;border:1px solid var(--border);background:var(--surface-soft);color:var(--fg-secondary);
      border-radius:999px;height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;
      font-size:11.5px;font-weight:600;white-space:nowrap;flex-shrink:0;cursor:pointer;
      transition:border-color .15s ease,background-color .15s ease,color .15s ease;
    }
    .channel-pill:active{background:var(--surface-hover)}
    .channel-pill .ch-dot{width:7px;height:7px;border-radius:999px;background:var(--green);flex-shrink:0}
    .channel-pill.is-connecting .ch-dot{background:var(--amber);animation:pulse 1s infinite ease-in-out}
    .channel-pill.is-offline{border-color:var(--risk-border);background:var(--risk-bg);color:var(--risk-fg)}
    .channel-pill.is-offline .ch-dot{background:var(--red)}
    .quota-pill{
      appearance:none;border:1px solid var(--border);background:var(--surface-soft);color:var(--fg-secondary);
      border-radius:11px;padding:5px 10px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;
      flex-shrink:0;cursor:pointer;display:flex;flex-direction:column;align-items:flex-end;line-height:1.2;gap:1px;white-space:nowrap;
    }
    .quota-pill span:last-child{font-size:11.5px;color:var(--muted);font-weight:500}
    .quota-drawer{
      position:fixed;top:calc(env(safe-area-inset-top) + 52px);right:10px;left:10px;max-width:360px;margin-left:auto;
      z-index:60;background:var(--card);border:1px solid var(--border-strong);border-radius:18px;
      padding:12px;box-shadow:var(--pop-shadow);
      max-height:calc(var(--modal-h,100dvh) - env(safe-area-inset-top,0px) - 108px);overflow-y:auto;-webkit-overflow-scrolling:touch;
    }
    .quota-drawer:not([hidden]){animation:ag-pop-in .18s var(--ease-out)}
    .quota-drawer[hidden]{display:none}
    .qcard{padding:8px 10px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border);margin-bottom:8px}
    .qhead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:13.5px;margin-bottom:6px;font-variant-numeric:tabular-nums}
    .qhead>span:first-child{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .qhead>span:last-child{flex-shrink:0;white-space:nowrap}
    .qsub{margin-top:5px}
    .qsub-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;margin-bottom:3px;font-variant-numeric:tabular-nums}
    .qsub-row>strong,.qsub-row>span:last-child{flex-shrink:0;white-space:nowrap}
    .qbar{height:5px;border-radius:99px;background:var(--qbar-bg);overflow:hidden}
    .qfill{height:100%;border-radius:99px}
    .qreset{font-size:11.5px;color:var(--muted);margin-top:2px;font-variant-numeric:tabular-nums}
    .messages{
      position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;
      padding:14px 16px 12px;display:flex;flex-direction:column;gap:16px;
    }
    .msg{word-break:break-word}
    .msg.user{
      align-self:flex-end;max-width:84%;padding:10px 14px;border-radius:18px 18px 4px 18px;
      background:var(--user-bg);color:var(--user-fg);
      font-size:14.5px;line-height:1.48;white-space:pre-wrap;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(0,0,0,.14);
    }
    .msg.assistant{align-self:stretch;background:transparent;border:none;padding:2px 2px}
    .msg.assistant .msg-plain{white-space:pre-wrap;font-size:14.5px;line-height:1.65;color:var(--fg-secondary)}
    .msg.assistant.is-risk{padding:10px 12px;border-radius:14px;background:var(--risk-bg);border:1px solid var(--risk-border)}
    .busy-pill{
      display:inline-flex;align-items:center;gap:8px;align-self:flex-start;
      padding:6px 12px;border-radius:999px;background:var(--surface-subtle);border:1px solid var(--border-subtle);
      font-size:12.5px;color:var(--muted);
    }
    .busy-spark{width:7px;height:7px;border-radius:99px;background:var(--accent);animation:pulse 1s infinite ease-in-out}
    .md-body{font-size:14px;line-height:1.62;color:var(--fg)}
    .md-body>:first-child{margin-top:0}
    .md-body>:last-child{margin-bottom:0}
    .md-body h1{font-size:19px;font-weight:700;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--border);line-height:1.35;color:var(--fg-strong)}
    .md-body h2{font-size:17px;font-weight:700;margin:12px 0 6px;padding-bottom:3px;border-bottom:1px solid var(--topbar-border);line-height:1.35;color:var(--fg-strong)}
    .md-body h3{font-size:15.5px;font-weight:700;margin:11px 0 5px;line-height:1.38;color:var(--fg)}
    .md-body h4,.md-body h5,.md-body h6{font-size:14.5px;font-weight:600;margin:9px 0 4px;color:var(--fg-secondary)}
    .md-body p{margin:6px 0;text-wrap:pretty}
    .md-body ul,.md-body ol{margin:6px 0;padding-left:20px}
    .md-body li{margin:4px 0;text-wrap:pretty}
    .md-body li>p{margin:2px 0}
    .md-body strong,.md-body b{font-weight:700;color:var(--fg-strong)}
    .md-body em{color:var(--fg-secondary)}
    .md-body hr{border:none;border-top:1px solid var(--border);margin:10px 0}
    .md-body a{color:var(--accent-fg);text-decoration:underline;text-underline-offset:2px}
    .md-body blockquote{margin:8px 0;padding:6px 10px;border-left:3px solid var(--accent);background:var(--accent-bg);border-radius:0 8px 8px 0;color:var(--fg-sub)}
    .md-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;padding:1px 5px;border-radius:5px;background:var(--code-bg);color:var(--accent-fg)}
    .md-body code.md-pill{background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-strong-fg)}
    .md-body pre{margin:8px 0;padding:10px 12px;border-radius:10px;background:var(--pre-bg);border:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch}
    .md-body pre code{background:none;padding:0;border:none;color:var(--fg-secondary);font-size:12px;line-height:1.5;white-space:pre}
    .md-table-wrap{margin:8px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px}
    .md-body table{width:max-content;min-width:100%;border-collapse:collapse;font-size:12.5px}
    .md-body th,.md-body td{padding:6px 9px;border-bottom:1px solid var(--border-subtle);border-right:1px solid var(--topbar-border);text-align:left;vertical-align:top;max-width:260px}
    .md-body th{background:var(--surface-soft);font-weight:600;color:var(--fg-strong)}
    .md-body tr:last-child td{border-bottom:none}
    .md-body th:last-child,.md-body td:last-child{border-right:none}
    .risk-tag{
      display:block;margin-bottom:6px;padding:5px 8px;border-radius:8px;
      background:var(--risk-bg);border:1px solid var(--risk-border);color:var(--risk-fg);font-size:12.5px;font-weight:600;
    }
    .thought-box{margin-bottom:8px;padding:6px 10px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border-subtle);font-size:12.5px;color:var(--fg-sub)}
    .msg.assistant.is-thought-only{padding:8px 10px}
    .msg.assistant.is-thought-only .thought-box{margin-bottom:0}
    .thought-box summary{cursor:pointer;font-weight:600;color:var(--thought-summary);list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none}
    .thought-box summary::-webkit-details-marker{display:none}
    .thought-sum-left{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1 1 auto}
    .thought-caret{display:inline-block;font-size:11px;transition:transform .16s var(--ease-out);opacity:.82;flex:0 0 auto}
    .thought-box[open] .thought-caret{transform:rotate(90deg)}
    .thought-sum-meta{font-weight:500;font-size:11.5px;opacity:.76;white-space:nowrap;font-variant-numeric:tabular-nums}
    .thought-box[open] .thought-cue-open{display:none}
    .thought-box:not([open]) .thought-cue-close{display:none}
    .thought-all-btn{
      position:relative;appearance:none;border:1px solid var(--border-subtle);background:var(--surface-soft);color:var(--fg-sub);
      border-radius:6px;padding:1px 6px;font-size:11px;font-weight:500;cursor:pointer;flex:0 0 auto;line-height:1.4;white-space:nowrap;
    }
    .thought-all-btn::after{content:'';position:absolute;inset:-8px}
    .thought-all-btn:hover{border-color:var(--accent-border);background:var(--accent-bg);color:var(--fg-strong)}
    .thought-body{margin-top:7px;white-space:pre-wrap;color:var(--muted);max-height:280px;overflow-y:auto;line-height:1.5;border-top:1px solid var(--border-subtle);padding-top:6px}
    .thought-step{position:relative;padding:0 0 8px 12px;border-left:2px solid var(--border-subtle);margin-left:4px}
    .thought-step:last-child{padding-bottom:0}
    .thought-step::before{content:'';position:absolute;left:-5px;top:5px;width:8px;height:8px;border-radius:999px;background:var(--thought-summary);opacity:.72}
    .thought-step-hd{font-size:11px;font-weight:600;color:var(--thought-summary);margin-bottom:2px;opacity:.85}
    .thought-step-txt{white-space:pre-wrap;word-break:break-word;color:var(--muted)}
    .compact-done-pill{align-self:center;display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:var(--surface-subtle);border:1px solid var(--border-subtle);color:var(--muted);font-size:12px;margin:2px 0}
    .messages.is-switching{opacity:.58;transition:opacity .12s ease}
    .empty-tip{margin:auto;text-align:center;color:var(--muted);padding:24px 12px;font-size:13px}
    .empty-state-card{
      margin:auto;width:100%;max-width:340px;padding:20px 16px;border-radius:14px;
      background:var(--surface-subtle);border:1px solid var(--border-subtle);
      display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;
    }
    .empty-state-card.compact{padding:16px 12px;max-width:none;border-radius:10px}
    .empty-state-ico{
      width:40px;height:40px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;
      background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-fg);flex-shrink:0;
    }
    .empty-state-card.is-error .empty-state-ico{
      background:var(--risk-bg);border-color:var(--risk-border);color:var(--risk-fg);
    }
    .empty-state-title{font-size:14px;font-weight:700;color:var(--fg-strong);line-height:1.35;text-wrap:balance}
    .empty-state-desc{font-size:12.5px;color:var(--muted);line-height:1.5;text-wrap:pretty;word-break:break-word}
    .empty-state-btn{
      appearance:none;margin-top:4px;min-height:36px;padding:0 14px;border-radius:9px;
      border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg);
      font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;
    }
    .empty-state-card.is-error .empty-state-btn{
      border-color:var(--risk-border);background:var(--card);color:var(--fg-strong);
    }
    .ag-skel-list{display:flex;flex-direction:column;gap:8px;padding:4px 0}
    .ag-skel-row{
      height:36px;border-radius:9px;background:var(--surface-soft);border:1px solid var(--border-subtle);
      position:relative;overflow:hidden;animation:ag-shimmer 1.3s ease-in-out infinite;
    }
    .ag-skel-row.w-lg{width:100%}
    .ag-skel-row.w-md{width:84%}
    .ag-skel-row.w-sm{width:68%}
    .mode-entry-card{
      margin:auto;width:100%;max-width:400px;padding:14px;border-radius:18px;
      background:var(--card);border:1px solid var(--border);
      display:flex;flex-direction:column;gap:10px;
    }
    .mode-entry-title{font-size:13px;font-weight:600;color:var(--fg-secondary);line-height:1.45;text-wrap:balance}
    .mode-entry-list{display:flex;flex-direction:column;gap:8px}
    .mode-entry-btn{
      appearance:none;width:100%;padding:10px 12px;border-radius:10px;
      border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;cursor:pointer;
      transition:border-color .15s ease,background-color .15s ease;
    }
    .mode-entry-btn:active{background:var(--accent-bg);border-color:var(--accent)}
    .mode-entry-btn.active{border-color:var(--accent);background:var(--accent-bg)}
    .mode-entry-left{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
    .mode-entry-name{font-size:13.5px;font-weight:600;color:var(--fg-strong);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .mode-entry-host{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mode-entry-tag{font-size:11.5px;font-weight:600;color:var(--accent-fg);flex-shrink:0;white-space:nowrap}
    .approval-dock{
      flex-shrink:0;padding:8px 10px;background:var(--approval-dock-bg);border-top:1px solid var(--border);
      display:flex;flex-direction:column;gap:6px;
    }
    .approval-dock[hidden]{display:none}
    .approval-card{
      padding:10px;border-radius:16px;background:var(--accent-bg);border:1px solid var(--accent-border);
      display:flex;flex-direction:column;gap:7px;
    }
    .approval-card.is-risk{background:var(--risk-bg);border-color:var(--risk-border)}
    .approval-ctx{
      font-size:12.5px;line-height:1.45;color:var(--fg-secondary);
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;
      font-family:ui-monospace,Menlo,monospace;
    }
    .approval-btns{display:flex;gap:8px;flex-wrap:wrap}
    .ap-btn{
      flex:1 1 110px;min-height:42px;border-radius:8px;border:none;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;
    }
    .ap-btn.approve{background:var(--ap-approve-bg);color:var(--ap-approve-fg);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 1px 2px rgba(0,0,0,.16)}
    .ap-btn.reject{background:var(--ap-reject-bg);color:var(--ap-reject-fg);border:1px solid var(--border)}
    .ap-btn.secondary{background:var(--surface-soft);color:var(--fg-strong);border:1px solid var(--border-strong)}
    .prompt-card{
      padding:10px;border-radius:16px;background:var(--card);border:1px solid var(--accent-border);
      display:flex;flex-direction:column;gap:7px;max-height:min(38vh,280px);overflow-y:auto;-webkit-overflow-scrolling:touch;
    }
    .prompt-card.is-risk{background:var(--risk-bg);border-color:var(--risk-border)}
    .ap-btn.is-persistent-risk{border:1px solid var(--risk-border);background:var(--risk-bg);color:var(--risk-fg)}
    .prompt-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .prompt-title{font-size:13.5px;font-weight:700;color:var(--fg-strong);line-height:1.35;min-width:0;text-wrap:balance}
    .prompt-badge{
      flex-shrink:0;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:999px;white-space:nowrap;
      background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-strong-fg);
    }
    .prompt-desc{font-size:12px;color:var(--muted);line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:72px;overflow-y:auto;text-wrap:pretty}
    .prompt-opts{display:flex;flex-direction:column;gap:5px}
    .prompt-opt{
      appearance:none;width:100%;text-align:left;padding:8px 10px;border-radius:8px;
      border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.35;cursor:pointer;
      transition:border-color .14s ease,background-color .14s ease;
    }
    .prompt-opt.selected{
      border-color:var(--accent);background:var(--accent-bg);color:var(--accent-strong-fg);font-weight:600;
    }
    .prompt-opt-mark{flex-shrink:0;font-size:14px;line-height:1;color:var(--accent-fg)}
    .prompt-opt-label{min-width:0;flex:1 1 auto;word-break:break-word}
    .prompt-other-input{
      width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-strong);
      background:var(--surface-subtle);color:var(--fg-strong);font-size:16px;font-family:inherit;outline:none;
    }
    .prompt-other-input:focus{border-color:var(--accent)}
    .queue-dock{
      flex-shrink:0;padding:6px 10px 4px;background:var(--approval-dock-bg);border-top:1px solid var(--border);
      display:flex;flex-direction:column;gap:6px;
    }
    .queue-dock[hidden]{display:none}
    .queue-card{
      padding:10px;border-radius:16px;background:var(--card);border:1px solid var(--border-strong);
      display:flex;flex-direction:column;gap:6px;max-height:min(22vh,176px);overflow-y:auto;-webkit-overflow-scrolling:touch;
    }
    .queue-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .queue-title{
      display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--fg-strong);min-width:0;
    }
    .queue-count{
      font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;font-variant-numeric:tabular-nums;
      background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-strong-fg);white-space:nowrap;
    }
    .queue-send-all{
      appearance:none;border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg);
      border-radius:8px;min-height:30px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap;
    }
    .queue-send-all:disabled{opacity:.5;cursor:not-allowed}
    .queue-list{display:flex;flex-direction:column;gap:4px}
    .queue-item{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:6px 8px;border-radius:8px;background:var(--surface-subtle);border:1px solid var(--border);
    }
    .queue-thumbs{display:inline-flex;align-items:center;gap:4px;flex-shrink:0}
    .queue-thumb{width:24px;height:24px;border-radius:5px;object-fit:cover;border:1px solid var(--border);display:block}
    .queue-item-text{
      flex:1 1 auto;min-width:0;font-size:12.5px;color:var(--fg);line-height:1.35;
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;
    }
    .queue-actions{display:inline-flex;align-items:center;gap:4px;flex-shrink:0}
    .queue-op-btn,.queue-del-btn{
      position:relative;appearance:none;border:1px solid var(--border);background:transparent;color:var(--muted);
      border-radius:7px;width:24px;height:24px;flex-shrink:0;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;font-size:12.5px;line-height:1;
    }
    .queue-op-btn:hover{background:var(--surface-hover);color:var(--fg-strong)}
    .queue-op-btn.send:active{background:var(--accent-bg);color:var(--accent-strong-fg);border-color:var(--accent-border)}
    .queue-del-btn::after{content:'';position:absolute;inset:-8px}
    .queue-del-btn:active{background:var(--surface-hover);color:var(--red)}
    .queue-op-btn:disabled,.queue-del-btn:disabled{opacity:.45;cursor:not-allowed}
    .composer-dock{
      flex-shrink:0;background:var(--dock-bg);border-top:1px solid var(--border);
      box-shadow:var(--dock-shadow);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      padding:2px 10px 2px;display:flex;flex-direction:column;gap:5px;
    }
    body.has-upper-dock .composer-dock{
      border-top-color:var(--border-subtle);box-shadow:none;
    }
    .approval-dock:not([hidden]){box-shadow:var(--dock-shadow)}
    body.has-approval-dock .queue-dock:not([hidden]){border-top-color:var(--border-subtle);box-shadow:none}
    body:not(.has-approval-dock) .queue-dock:not([hidden]){box-shadow:var(--dock-shadow)}
    .chips{display:flex;align-items:center;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:2px;min-height:34px}
    .chips::-webkit-scrollbar{display:none}
    .chip{
      appearance:none;flex-shrink:0;border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg-sub);
      border-radius:999px;min-height:30px;padding:5px 11px;font-size:12.5px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:4px;
    }
    .chip.suggest{border:1px dashed var(--accent-border);background:var(--accent-bg);color:var(--accent-fg);font-weight:500}
    .chip.chip-mode-toggle{border-color:var(--border-strong);background:var(--surface-soft);color:var(--fg-secondary);font-weight:600;padding:5px 10px}
    .chip.chip-mode-toggle.active{border-color:var(--btn-primary-bg);background:var(--btn-primary-bg);color:var(--send-ready-fg);font-weight:700}
    .chip.quick-prompt{color:var(--fg-secondary)}
    .chip.quick-prompt.direct{border-color:var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg)}
    .attach-hint{
      display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:12px;
      background:var(--accent-bg);border:1px solid var(--accent-border);font-size:12.5px;color:var(--accent-strong-fg);
    }
    .attach-hint[hidden]{display:none}
    .attach-strip{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;overflow-x:auto;padding:5px 2px 2px;scrollbar-width:none}
    .attach-strip::-webkit-scrollbar{display:none}
    .attach-thumb-wrap{
      position:relative;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;
      width:48px;height:48px;padding:0;border-radius:10px;background:var(--card);border:1px solid var(--border);
    }
    .attach-thumb{
      width:46px;height:46px;border-radius:9px;object-fit:cover;cursor:zoom-in;display:block;flex-shrink:0;
    }
    .attach-file-chip{
      position:relative;flex-shrink:0;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      width:48px;height:48px;padding:4px;border-radius:10px;
      background:var(--card);border:1px solid var(--border);color:var(--fg);font-size:10px;
    }
    .attach-file-icon{font-size:16px;line-height:1}
    .attach-file-ext{font-size:9.5px;font-weight:700;letter-spacing:.02em;color:var(--muted);text-transform:uppercase;max-width:42px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .attach-item-rm{
      position:absolute;top:-6px;right:-6px;appearance:none;border:1px solid var(--border-strong);background:var(--card);color:var(--fg);
      width:18px;height:18px;border-radius:999px;padding:0;flex-shrink:0;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;font-weight:700;
      box-shadow:0 2px 6px rgba(0,0,0,.22);
    }
    .attach-item-rm::after{content:'';position:absolute;inset:-9px}
    .attach-item-rm:hover,.attach-item-rm:active{background:var(--risk-bg);color:var(--risk-fg);border-color:var(--risk-fg)}
    .attach-clear-btn{
      appearance:none;border:1px solid var(--accent-border);background:var(--card);color:var(--accent-strong-fg);
      border-radius:8px;min-height:30px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap;
    }
    .msg-user-group{display:flex;flex-direction:column;align-items:flex-end;gap:6px;align-self:flex-end;max-width:86%}
    .msg-user-group .msg.user{max-width:100%}
    .msg-atts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
    .msg-atts.above-user{margin:0}
    .msg-att-img{
      width:84px;height:84px;max-width:140px;max-height:120px;border-radius:10px;object-fit:cover;cursor:zoom-in;
      border:1px solid var(--border);display:block;background:var(--surface-subtle);
    }
    .msg-att-file{
      appearance:none;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      width:54px;height:54px;padding:4px;border-radius:10px;
      border:1px solid var(--border);background:var(--card);color:var(--fg);
      font-size:10px;cursor:pointer;text-align:center;
    }
    .msg-att-file .att-ext{font-size:9.5px;font-weight:700;color:var(--muted);text-transform:uppercase;max-width:46px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .media-lightbox{
      position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.84);
      display:flex;align-items:center;justify-content:center;padding:20px;
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    }
    .media-lightbox[hidden]{display:none}
    .media-lightbox img{max-width:94vw;max-height:86vh;border-radius:12px;object-fit:contain;box-shadow:0 16px 48px rgba(0,0,0,.5)}
    .media-lightbox-close{
      position:fixed;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));width:40px;height:40px;border-radius:999px;
      border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.55);color:#fff;font-size:18px;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;
    }
    .md-file-link{
      appearance:none;border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg);
      border-radius:6px;padding:1px 6px;font-family:ui-monospace,Menlo,monospace;font-size:12px;cursor:pointer;
      display:inline-flex;align-items:center;gap:3px;vertical-align:baseline;
    }
    .md-file-link:active{filter:brightness(1.1)}
    .fv-backdrop{
      position:fixed;top:0;left:0;right:0;height:var(--modal-h,100dvh);z-index:110;background:var(--backdrop-bg);
      display:flex;align-items:flex-end;justify-content:center;
      backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    }
    .fv-backdrop[hidden]{display:none}
    .fv-modal{
      width:100%;max-width:760px;height:min(86%,calc(var(--modal-h,100dvh) * 0.86));max-height:calc(var(--modal-h,100dvh) - env(safe-area-inset-top,0px) - 16px);
      background:var(--card);border-top-left-radius:18px;border-top-right-radius:18px;border:1px solid var(--border-strong);
      padding-bottom:var(--safe-bottom);
      display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--sheet-shadow);
    }
    .fv-head{
      display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;
      border-bottom:1px solid var(--border);flex-shrink:0;
    }
    .fv-title{font-size:14px;font-weight:700;color:var(--fg-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-wrap:balance}
    .fv-tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
    .fv-tab{
      appearance:none;flex:1;min-height:34px;padding:6px 10px;border-radius:9px;border:1px solid var(--border);
      background:var(--surface-subtle);color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;
    }
    .fv-tab.active{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-strong-fg)}
    .fv-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px;-webkit-overflow-scrolling:touch}
    .fv-path-bar{
      display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11.5px;color:var(--muted);
      font-family:ui-monospace,Menlo,monospace;word-break:break-all;
    }
    .fv-up-btn{
      appearance:none;min-height:34px;padding:0 10px;border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap;
      display:inline-flex;align-items:center;justify-content:center;gap:4px;
    }
    .fv-list{display:flex;flex-direction:column;gap:5px}
    .fv-row{
      appearance:none;width:100%;text-align:left;min-height:40px;padding:8px 10px;border-radius:9px;
      border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;cursor:pointer;
    }
    .fv-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
    .fv-row-meta{font-size:11px;color:var(--muted);flex-shrink:0;font-variant-numeric:tabular-nums;white-space:nowrap}
    .fv-code{
      margin:0;padding:10px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border);
      font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre;
    }
    .fv-code-line{display:block;padding:0 4px}
    .fv-code-line.hl{background:var(--accent-bg);border-left:2px solid var(--accent)}
    .fv-ln{display:inline-block;width:36px;color:var(--muted);user-select:none;text-align:right;margin-right:10px;font-variant-numeric:tabular-nums}
    .fv-diff-add{color:var(--diff-add)}
    .fv-diff-del{color:var(--diff-del)}
    .fv-diff-hdr{color:var(--accent-strong-fg);font-weight:600}
    .composer-card{
      background:var(--composer-bg);border:1px solid var(--composer-border);border-radius:22px;
      padding:10px 10px 8px 12px;display:flex;flex-direction:column;gap:6px;
      box-shadow:var(--composer-shadow),inset 0 1px 0 var(--surface-highlight);transition:border-color .15s ease,box-shadow .15s ease;
    }
    .composer-card:focus-within{border-color:var(--accent);box-shadow:var(--composer-shadow),0 0 0 3px var(--accent-bg)}
    .composer-card textarea{
      width:100%;min-height:28px;max-height:148px;resize:none;border:none;background:transparent;
      color:var(--fg);padding:2px 4px;font-size:16px;line-height:1.42;font-family:inherit;outline:none;
    }
    .composer-card textarea::placeholder{color:var(--placeholder)}
    .composer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding-top:2px}
    .toolbar-left{display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto}
    .toolbar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .ghost-btn{
      appearance:none;border:none;background:transparent;color:var(--muted);
      height:36px;padding:0 8px;border-radius:999px;font-size:12.5px;font-weight:500;
      display:inline-flex;align-items:center;gap:4px;cursor:pointer;min-width:0;max-width:100%;white-space:nowrap;
    }
    .ghost-btn:active{background:var(--surface-hover);color:var(--fg-strong)}
    .ghost-btn.icon-only{width:36px;padding:0;justify-content:center}
    .ghost-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .send-circle{
      appearance:none;flex-shrink:0;width:36px;height:36px;border-radius:999px;border:none;
      background:var(--card2);color:var(--placeholder);display:inline-flex;align-items:center;justify-content:center;
      cursor:pointer;transition:background-color .15s ease,color .15s ease,transform .12s var(--ease-out);
    }
    .send-circle.ready{background:var(--btn-primary-bg);color:var(--send-ready-fg);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 1px 2px rgba(0,0,0,.16)}
    .send-circle.stop{background:var(--risk-bg);color:var(--red);border:1px solid var(--risk-border)}
    .send-circle.pending{background:var(--card2);color:var(--muted);border:1px solid var(--border);cursor:not-allowed;pointer-events:none}
    .send-circle:active:not(:disabled){transform:scale(.94)}
    .send-circle:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
    .send-circle:disabled:active{transform:none}
    [hidden],.sheet-speed-btn[hidden],.sheet-sub-text[hidden],.sheet-back-btn[hidden]{display:none!important}
    .sheet-backdrop{
      position:fixed;top:0;left:0;right:0;height:var(--modal-h,100dvh);z-index:75;background:var(--backdrop-bg);box-shadow:0 0 0 100vmax var(--backdrop-bg);display:flex;align-items:flex-end;justify-content:center;
    }
    .sheet-backdrop[hidden]{display:none}
    .sheet{
      width:100%;max-width:520px;max-height:min(calc(var(--modal-h,100dvh) * 0.72),calc(var(--modal-h,100dvh) - env(safe-area-inset-top,0px) - 16px));background:var(--card);border-top:1px solid var(--border-strong);
      border-radius:20px 20px 0 0;padding:14px 14px calc(14px + var(--safe-bottom));box-shadow:0 240px 0 0 var(--card);
      display:flex;flex-direction:column;gap:8px;overflow:hidden;
    }
    .sheet-backdrop:not([hidden]) .sheet,.fv-backdrop:not([hidden]) .fv-modal{animation:ag-sheet-in .22s var(--ease-out)}
    .sheet-title{font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-shrink:0}
    .sheet-title-left{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
    .sheet-sub-text{font-size:11.5px;font-weight:400;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sheet-title-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .sheet-back-btn{
      appearance:none;min-height:34px;height:34px;padding:0 10px;border-radius:8px;
      border:1px solid var(--border-strong);background:var(--surface-subtle);color:var(--fg);
      font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;cursor:pointer;flex-shrink:0;white-space:nowrap;
    }
    .sheet-back-btn:active{background:var(--surface-hover)}
    .sheet-speed-btn{
      appearance:none;min-height:34px;height:34px;padding:0 10px;border-radius:8px;
      border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg);
      font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;
    }
    .sheet-speed-btn:active{filter:brightness(1.08)}
    .sheet-speed-btn:disabled{opacity:.65;cursor:default}
    .sheet-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;-webkit-overflow-scrolling:touch}
    .sheet-stage-viewport{width:100%;overflow:hidden}
    .sheet-stage-track{display:flex;width:200%;align-items:flex-start;transition:transform .24s var(--ease-out);will-change:transform}
    .sheet-stage-track.step-effort{transform:translateX(-50%)}
    .sheet-stage-pane{width:50%;flex:0 0 50%;display:flex;flex-direction:column;gap:6px;max-height:56dvh;overflow-y:auto;padding-right:2px;-webkit-overflow-scrolling:touch}
    .sheet-opt.sliding-out{background:var(--accent-bg);border-color:var(--accent-border)}
    .sheet-opt{
      width:100%;text-align:left;padding:11px 12px;border-radius:10px;border:1px solid var(--border);
      background:var(--surface-subtle);color:var(--fg);font-size:14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;
    }
    .sheet-opt.active{border-color:var(--accent);background:var(--accent-bg);color:var(--fg-strong);font-weight:600}
    .sheet-opt-left{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
    .sheet-opt-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .sheet-opt-host{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sheet-opt-right,.mode-entry-right{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;margin-left:8px}
    .mode-pill{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:999px;line-height:1.4;white-space:nowrap}
    .mode-pill.fast{background:var(--badge-fast-bg);color:var(--badge-fast-fg);border:1px solid var(--badge-fast-border)}
    .mode-pill.cur{background:var(--accent-bg);color:var(--accent-fg);border:1px solid var(--accent-border)}
    .mode-pill.warn{background:var(--badge-mid-bg);color:var(--badge-mid-fg);border:1px solid rgba(217,119,6,.32)}
    .sheet-foot-note{margin-top:6px;padding:8px 10px;border-radius:10px;border:1px solid rgba(217,119,6,.28);background:var(--badge-mid-bg);color:var(--muted);font-size:11.5px;line-height:1.45}
    .lat-badge{font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;padding:2px 7px;border-radius:999px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
    .lat-badge.fast{background:var(--badge-fast-bg);color:var(--badge-fast-fg)}
    .lat-badge.mid{background:var(--badge-mid-bg);color:var(--badge-mid-fg)}
    .lat-badge.slow{background:var(--badge-slow-bg);color:var(--badge-slow-fg)}
    .lat-badge.err{background:var(--badge-err-bg);color:var(--badge-err-fg)}
    .lat-badge.muted,.lat-badge.pending{background:var(--surface-subtle);color:var(--muted)}
    .mini-spin{display:inline-block;width:11px;height:11px;border-radius:999px;border:1.5px solid var(--accent-border);border-top-color:var(--accent);animation:agspin .7s linear infinite;flex-shrink:0}
    @keyframes agspin{to{transform:rotate(360deg)}}
    .drawer-backdrop{
      position:fixed;top:0;left:0;right:0;height:var(--modal-h,100dvh);z-index:70;background:rgba(0,0,0,0);display:flex;justify-content:flex-start;
      opacity:0;visibility:hidden;pointer-events:none;
      transition:opacity .22s ease,visibility .22s ease,background-color .22s ease;
    }
    .drawer-backdrop.open{
      background:var(--backdrop-bg);opacity:1;visibility:visible;pointer-events:auto;
    }
    .drawer-backdrop.dragging{
      transition:none;opacity:1;visibility:visible;pointer-events:auto;
    }
    .drawer{
      width:min(82vw,320px);height:100%;background:var(--drawer-bg);border-right:1px solid var(--border);
      padding:calc(env(safe-area-inset-top) + 12px) 12px calc(10px + var(--safe-bottom));
      display:flex;flex-direction:column;gap:10px;overflow:hidden;
      transform:translateX(-100%);transition:transform .24s cubic-bezier(.22,1,.36,1);
      will-change:transform;
    }
    .drawer-backdrop.open .drawer{transform:translateX(0)}
    .drawer-backdrop.dragging .drawer{transition:none}
    .new-chat-group{display:flex;align-items:stretch;gap:6px;flex-shrink:0}
    .new-chat-btn{
      appearance:none;flex:1 1 auto;min-width:0;min-height:44px;padding:6px 10px;border-radius:10px;
      background:var(--surface-strong);border:1px solid var(--border);color:var(--fg-strong);
      font-size:14px;font-weight:600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;
    }
    .new-chat-main{display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%;line-height:1.2}
    .new-chat-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .new-chat-sub{display:block;width:100%;max-width:100%;font-size:10.5px;font-weight:500;line-height:1.22;color:var(--muted);white-space:normal;overflow-wrap:anywhere;word-break:break-word;text-align:center}
    .new-chat-sub[hidden]{display:none}
    .new-chat-pick-btn{
      appearance:none;width:42px;min-height:44px;flex-shrink:0;border-radius:10px;
      background:var(--surface-strong);border:1px solid var(--border);color:var(--fg-sub);
      display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
    }
    .new-chat-btn:active,.new-chat-pick-btn:active{background:var(--accent-bg);border-color:var(--accent-border);color:var(--fg-strong)}
    .conv-toolbar{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .conv-view-tabs{
      flex:1 1 auto;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:3px;border-radius:10px;
      background:var(--seg-track);border:1px solid var(--border-subtle);
    }
    .conv-tab{
      appearance:none;border:none;background:transparent;color:var(--muted);border-radius:8px;
      padding:6px 8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
      display:inline-flex;align-items:center;justify-content:center;gap:4px;
    }
    .conv-tab.active{background:var(--accent-bg);color:var(--accent-strong-fg)}
    .tab-count{font-size:11px;opacity:.78;font-variant-numeric:tabular-nums}
    .new-proj-mini-btn{
      appearance:none;width:34px;height:34px;padding:0;border-radius:10px;flex-shrink:0;
      border:1px solid var(--border-subtle);background:var(--surface-subtle);color:var(--muted);
      display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
      transition:background-color .14s ease,border-color .14s ease,color .14s ease;
    }
    .new-proj-mini-btn:active{background:var(--accent-bg);border-color:var(--accent-border);color:var(--accent-strong-fg)}
    .proj-group{display:flex;flex-direction:column;gap:5px;margin-top:6px}
    .proj-group:first-child{margin-top:0}
    .proj-head{
      display:flex;align-items:center;gap:4px;padding:3px 5px 3px 3px;border-radius:10px;
      background:var(--proj-head-bg);border:1px solid var(--proj-head-border);
      transition:background-color .14s ease,border-color .14s ease;
    }
    .proj-group.is-current .proj-head{
      background:var(--accent-bg);border-color:var(--accent-border);
    }
    .proj-toggle{
      appearance:none;flex:1 1 auto;min-width:0;border:none;background:transparent;color:var(--fg-strong);
      padding:6px 7px;border-radius:8px;font-size:14.5px;font-weight:700;letter-spacing:-.01em;
      display:flex;align-items:center;gap:6px;cursor:pointer;text-align:left;
    }
    .proj-icon{display:inline-flex;align-items:center;justify-content:center;color:var(--accent-fg);flex-shrink:0}
    .proj-group.is-ungrouped .proj-icon{color:var(--muted)}
    .proj-chev{font-size:11px;color:var(--muted);width:12px;flex-shrink:0;text-align:center;font-weight:700}
    .proj-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj-stat-dot{width:6px;height:6px;border-radius:99px;flex-shrink:0}
    .proj-stat-dot.running{background:var(--green);animation:pulse 1.1s infinite ease-in-out}
    .proj-stat-dot.waiting{background:var(--amber);animation:pulse 1s infinite ease-in-out}
    .proj-count{
      margin-left:auto;padding:1px 7px;border-radius:999px;background:var(--proj-count-bg);
      font-size:11px;color:var(--fg-sub);font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0;
    }
    .proj-new-btn{
      appearance:none;width:28px;height:28px;flex-shrink:0;border-radius:8px;
      border:1px solid var(--border);background:var(--surface-soft);color:var(--fg-sub);
      display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;line-height:1;
    }
    .proj-new-btn:active{background:var(--accent-bg);border-color:var(--accent-border);color:var(--fg-strong)}
    .proj-body{
      display:flex;flex-direction:column;gap:4px;margin-left:11px;padding-left:9px;
      border-left:1.5px solid var(--border);
    }
    .proj-group.is-empty .proj-chev{opacity:.4}
    /* 新建项目与电脑目录浏览器弹窗 */
    .sheet.proj-modal{max-width:540px;max-height:min(680px,calc(var(--modal-h,100dvh) * 0.84),calc(var(--modal-h,100dvh) - env(safe-area-inset-top,0px) - 16px));gap:10px}
    .proj-modal-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px}
    .proj-roots-bar{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-shrink:0;padding-bottom:2px}
    .proj-roots-bar::-webkit-scrollbar{display:none}
    .proj-root-pill{
      appearance:none;flex-shrink:0;padding:5px 10px;border-radius:999px;border:1px solid var(--border);
      background:var(--surface-soft);color:var(--fg-secondary);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
    }
    .proj-root-pill.active{border-color:var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg)}
    .proj-path-row{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .proj-path-input,.proj-field-input{
      flex:1 1 auto;min-width:0;height:36px;padding:0 10px;border-radius:10px;border:1px solid var(--border);
      background:var(--input-bg);color:var(--fg);font-size:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;
    }
    .proj-field-input{font-family:inherit;font-size:16px}
    .proj-path-input:focus,.proj-field-input:focus{border-color:var(--accent)}
    .proj-act-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0}
    .proj-act-btn{
      appearance:none;min-height:34px;height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--border);
      background:var(--surface-soft);color:var(--fg-sub);font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;
    }
    .proj-act-btn.active{border-color:var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg)}
    .proj-act-btn:disabled{opacity:.42;cursor:default}
    .proj-mkdir-row{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .proj-mkdir-row[hidden]{display:none}
    .proj-dir-list{
      display:flex;flex-direction:column;gap:5px;flex:0 0 auto;min-height:104px;max-height:calc(var(--modal-h,100dvh) * 0.32);overflow-y:auto;-webkit-overflow-scrolling:touch;
      padding:2px 0;
    }
    .proj-dir-item{
      width:100%;text-align:left;padding:9px 11px;border-radius:10px;border:1px solid var(--border-subtle);
      background:var(--surface-subtle);color:var(--fg);font-size:13.5px;font-weight:500;cursor:pointer;
      display:flex;align-items:center;gap:8px;
    }
    .proj-dir-item:active{background:var(--accent-bg);border-color:var(--accent-border)}
    .proj-dir-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj-dir-badges{display:inline-flex;align-items:center;gap:4px;flex-shrink:0}
    .proj-tag{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;line-height:1.4;white-space:nowrap}
    .proj-tag.git{background:var(--git-tag-bg);color:var(--git-tag-fg)}
    .proj-tag.linked{background:var(--accent-bg);color:var(--accent-fg)}
    .proj-summary-card{
      padding:8px 10px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border);
      font-size:12px;color:var(--fg-sub);display:flex;flex-direction:column;gap:3px;flex-shrink:0;text-wrap:pretty;
    }
    .proj-summary-card.is-warn{border-color:var(--warn-card-border);background:var(--warn-card-bg);color:var(--warn-card-fg)}
    .proj-summary-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent-fg);word-break:break-all;font-size:11.5px}
    .proj-name-row{display:flex;flex-direction:column;gap:5px;flex-shrink:0}
    .proj-name-label{font-size:12px;font-weight:600;color:var(--muted)}
    .proj-primary-btn{
      appearance:none;width:100%;height:42px;border-radius:10px;border:none;background:var(--btn-primary-bg);color:var(--send-ready-fg);
      font-size:14.5px;font-weight:700;cursor:pointer;flex-shrink:0;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 1px 2px rgba(0,0,0,.16);
    }
    .proj-primary-btn:disabled{opacity:.5;cursor:default}
    .drawer-sub{font-size:12px;font-weight:600;color:var(--muted);padding:2px 4px 0;flex-shrink:0}
    .drawer-nav-bar{display:flex;align-items:center;gap:6px;min-height:34px;padding:2px 2px 0;flex-shrink:0}
    .drawer-nav-bar[hidden]{display:none}
    .drawer-back-btn{
      appearance:none;min-height:34px;height:34px;padding:0 10px;border-radius:8px;
      border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:3px;cursor:pointer;flex-shrink:0;white-space:nowrap;
    }
    .drawer-back-btn:active{background:var(--accent-bg);border-color:var(--accent-border)}
    .drawer-proj-title{font-size:12.5px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}
    .proj-item{
      width:100%;text-align:left;padding:10px 11px;border-radius:10px;border:1px solid var(--border);
      background:var(--surface-subtle);color:var(--fg);font-size:13.5px;display:flex;align-items:center;
      justify-content:space-between;gap:8px;cursor:pointer;transition:background-color .14s ease,border-color .14s ease;
    }
    .proj-item.active{border-color:var(--accent);background:var(--accent-bg);font-weight:600}
    .proj-item-left{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto}
    .proj-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .proj-item-right{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;color:var(--muted);font-size:13px}
    @keyframes agconvfade{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
    .conv-list.anim-enter{animation:agconvfade .18s ease}
    .conv-item{
      width:100%;text-align:left;padding:9px 11px;border-radius:8px;border:1px solid transparent;
      background:var(--surface-subtle);color:var(--fg);font-size:13.5px;cursor:pointer;
      display:flex;flex-direction:column;gap:3px;
    }
    .conv-item.active{border-color:var(--accent);background:var(--accent-bg);font-weight:600}
    .conv-item.is-unread .c-title{font-weight:600;color:var(--fg-strong)}
    .c-row{display:flex;align-items:center;gap:6px;min-width:0;width:100%}
    .c-dot{width:7px;height:7px;border-radius:99px;flex-shrink:0;background:var(--border-strong)}
    .c-dot.running{background:var(--green);animation:pulse 1.1s infinite ease-in-out}
    .c-dot.waiting{background:var(--amber);animation:pulse 1s infinite ease-in-out}
    .c-dot.error{background:var(--red)}
    .c-dot.unknown{background:transparent;border:1.5px solid var(--placeholder)}
    .c-dot.unread{background:var(--accent)}
    .c-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.35}
    .c-badge{
      flex-shrink:0;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:999px;line-height:1.4;white-space:nowrap;
    }
    .c-badge.running{background:var(--badge-run-bg);color:var(--badge-run-fg)}
    .c-badge.waiting{background:var(--badge-wait-bg);color:var(--badge-wait-fg)}
    .c-badge.error{background:var(--badge-err-bg);color:var(--badge-err-fg)}
    .c-badge.unknown{background:var(--badge-unk-bg);color:var(--badge-unk-fg)}
    .conv-unread-dot{
      width:8px;height:8px;border-radius:999px;flex-shrink:0;display:inline-block;
      background:var(--unread-dot);box-shadow:0 0 0 4px var(--unread-glow);margin:0 3px;
    }
    .conv-bell-indicator{
      position:relative;display:inline-flex;align-items:center;justify-content:center;
      width:20px;height:20px;flex-shrink:0;color:var(--fg-secondary);
    }
    .conv-bell-dot{
      position:absolute;top:1px;right:1px;width:6px;height:6px;border-radius:999px;
      background:var(--unread-dot);box-shadow:0 0 0 2px var(--drawer-bg);
    }
    .c-time{flex-shrink:0;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
    .c-sub{font-size:11px;color:var(--muted);padding-left:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .conv-more-btn{
      appearance:none;width:100%;min-height:34px;padding:8px 10px;border-radius:8px;border:1px dashed var(--border);
      background:var(--surface-subtle);color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer;margin-top:2px;
    }
    .composer-card.drag-over{border-color:var(--accent);background:var(--accent-bg)}
    .load-earlier-btn{
      appearance:none;align-self:center;min-height:34px;padding:6px 14px;border-radius:999px;
      border:1px solid var(--border);background:var(--surface-soft);color:var(--fg-sub);
      font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;cursor:pointer;flex-shrink:0;
    }
    .load-earlier-btn:disabled{opacity:.6;cursor:default}
    .perm-ico{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .perm-ico.turbo{color:var(--amber)}
    .perm-ico.auto{color:var(--accent-fg)}
    .perm-ico.default{color:var(--muted)}
    .perm-ico.request_review{color:var(--perm-review)}
    .perm-ico.unknown{color:var(--placeholder)}
    .drawer-brand{display:none}
    .conv-list{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-right:2px;display:flex;flex-direction:column;gap:6px}
    .drawer-footer{flex-shrink:0;padding-top:6px;border-top:1px solid var(--border-subtle);display:flex;align-items:center;gap:6px}
    .theme-seg{flex:1 1 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;border-radius:10px;background:var(--seg-track);border:1px solid var(--border-subtle)}
    .push-footer-btn{
      flex:0 0 auto;appearance:none;height:36px;min-width:36px;padding:0 10px;border-radius:10px;
      background:var(--seg-track);border:1px solid var(--border-subtle);color:var(--muted);
      display:inline-flex;align-items:center;justify-content:center;gap:5px;font-size:12px;cursor:pointer;
      transition:background-color .15s ease,color .15s ease,border-color .15s ease;
    }
    .push-footer-btn:hover{background:var(--surface-hover);color:var(--fg)}
    .push-footer-btn.active{color:var(--accent-fg);border-color:var(--accent-border);background:var(--accent-bg)}
    .theme-seg-btn{
      appearance:none;border:none;background:transparent;color:var(--muted);
      height:32px;padding:0;border-radius:8px;
      display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
      transition:transform .12s var(--ease-out),background-color .15s ease,color .15s ease,box-shadow .15s ease;
    }
    .theme-seg-btn.active{background:var(--seg-active-bg);color:var(--fg-strong);box-shadow:var(--seg-active-shadow)}
    .toast{
      position:fixed;top:calc(env(safe-area-inset-top) + 56px);left:50%;transform:translateX(-50%);
      z-index:80;background:var(--toast-bg);color:var(--toast-fg);padding:7px 14px;border-radius:999px;font-size:12.5px;
      border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;max-width:min(90vw,460px);text-align:center;
    }
    .toast:not([hidden]){animation:ag-toast-in .18s var(--ease-out)}
    .toast[hidden]{display:none}
    /* 细滚动条 */
    .messages,.conv-list,.drawer,.sheet-list,.proj-modal-body,.thought-body,.md-body pre,.md-table-wrap,.fv-body,.quota-drawer{
      scrollbar-width:thin;scrollbar-color:var(--scroll-thumb) transparent;
    }
    .messages{scrollbar-gutter:stable}
    .messages::-webkit-scrollbar,.conv-list::-webkit-scrollbar,.drawer::-webkit-scrollbar,.sheet-list::-webkit-scrollbar,.proj-modal-body::-webkit-scrollbar,.thought-body::-webkit-scrollbar,.md-body pre::-webkit-scrollbar,.md-table-wrap::-webkit-scrollbar,.fv-body::-webkit-scrollbar,.quota-drawer::-webkit-scrollbar{
      width:6px;height:6px;
    }
    .messages::-webkit-scrollbar-thumb,.conv-list::-webkit-scrollbar-thumb,.drawer::-webkit-scrollbar-thumb,.sheet-list::-webkit-scrollbar-thumb,.proj-modal-body::-webkit-scrollbar-thumb,.thought-body::-webkit-scrollbar-thumb,.md-body pre::-webkit-scrollbar-thumb,.md-table-wrap::-webkit-scrollbar-thumb,.fv-body::-webkit-scrollbar-thumb,.quota-drawer::-webkit-scrollbar-thumb{
      background:var(--scroll-thumb);border-radius:99px;
    }
    .messages::-webkit-scrollbar-thumb:hover,.conv-list::-webkit-scrollbar-thumb:hover,.drawer::-webkit-scrollbar-thumb:hover,.sheet-list::-webkit-scrollbar-thumb:hover,.proj-modal-body::-webkit-scrollbar-thumb:hover,.md-table-wrap::-webkit-scrollbar-thumb:hover,.fv-body::-webkit-scrollbar-thumb:hover,.quota-drawer::-webkit-scrollbar-thumb:hover{
      background:var(--scroll-thumb-hover);
    }
    .messages::-webkit-scrollbar-track,.conv-list::-webkit-scrollbar-track,.drawer::-webkit-scrollbar-track,.sheet-list::-webkit-scrollbar-track,.proj-modal-body::-webkit-scrollbar-track,.md-table-wrap::-webkit-scrollbar-track,.fv-body::-webkit-scrollbar-track,.quota-drawer::-webkit-scrollbar-track{
      background:transparent;
    }
    /* 鼠标设备悬停交互 */
    @media (hover:hover){
      .icon-btn:hover,.top-panel-btn:hover,.fv-up-btn:hover,.fv-row:hover,.conn-banner-btn:hover,.channel-pill:hover{background:var(--surface-hover);color:var(--fg)}
      .channel-pill.is-offline:hover{filter:brightness(1.06);color:var(--risk-fg)}
      .conn-banner-btn.primary:hover{filter:brightness(1.08)}
      .empty-state-btn:hover{filter:brightness(1.08);border-color:var(--accent)}
      .quota-pill:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .mode-entry-btn:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .chip:hover{background:var(--surface-hover);border-color:var(--border-strong);color:var(--fg-secondary)}
      .chip.chip-mode-toggle.active:hover{filter:brightness(1.08);color:var(--send-ready-fg)}
      .chip.suggest:hover{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-strong-fg)}
      .ghost-btn:hover{background:var(--surface-hover);color:var(--fg-secondary)}
      .send-circle.ready:hover{filter:brightness(1.08)}
      .send-circle.stop:hover{opacity:.9}
      .new-chat-btn:hover,.new-chat-pick-btn:hover{background:var(--surface-strong-hover);border-color:var(--accent-border);color:var(--fg-strong)}
      .conv-tab:hover{color:var(--fg-secondary)}
      .new-proj-mini-btn:hover{background:var(--surface-hover);border-color:var(--border-strong);color:var(--fg-strong)}
      .proj-head:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .proj-toggle:hover{color:var(--fg-strong)}
      .proj-new-btn:hover{background:var(--accent-bg);border-color:var(--accent-border);color:var(--fg-strong)}
      .proj-root-pill:hover,.proj-act-btn:hover,.proj-dir-item:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .proj-primary-btn:hover{filter:brightness(1.08)}
      .conv-more-btn:hover{background:var(--surface-hover);color:var(--fg-secondary)}
      .conv-item:hover,.proj-item:hover,.usage-src-btn:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .conv-item.active:hover,.proj-item.active:hover{background:var(--accent-bg)}
      .drawer-back-btn:hover,.sheet-back-btn:hover{background:var(--surface-hover);color:var(--fg-strong)}
      .sheet-opt:hover{background:var(--surface-hover);border-color:var(--border-strong)}
      .sheet-opt.active:hover{background:var(--accent-bg)}
      .theme-seg-btn:not(.active):hover{color:var(--fg)}
    }
    /* 电脑端宽屏控制台适配（>= 860px 且具备精细鼠标指针与足够高度，避免横屏手机/平板误入双栏） */
    @media (min-width:860px) and (min-height:521px) and (hover:hover) and (pointer:fine){
      body{display:flex;flex-direction:row}
      .app{
        flex:1 1 auto;min-width:0;width:auto;height:100%;position:relative;
        padding-top:0;padding-bottom:0;
      }
      .topbar{height:54px;padding:0 24px;gap:12px}
      .channel-pill{display:none}
      .conn-banner{padding:8px 24px}
      .title-wrap{grid-template-columns:auto minmax(0,1fr);column-gap:7px;row-gap:1px}
      .conv-title{grid-column:2;grid-row:1;font-size:15.5px}
      .conv-project-badge{max-width:260px;font-size:11.5px;padding:1px 8px}
      .sub-meta{font-size:12px}
      .quota-pill{flex-direction:row;align-items:center;gap:8px;padding:6px 12px;font-size:12px;border-radius:10px}
      .quota-pill span:last-child{font-size:11.5px;color:var(--muted);padding-left:8px;border-left:1px solid var(--border)}
      .drawer-backdrop{
        order:-1;position:relative;top:auto;left:auto;right:auto;bottom:auto;
        width:268px;height:100%;flex-shrink:0;z-index:10;
        opacity:1;visibility:visible;pointer-events:auto;background:transparent;
        overflow:hidden;transition:width .2s cubic-bezier(.22,1,.36,1);
      }
      body.sidebar-collapsed .drawer-backdrop{width:0;pointer-events:none}
      .drawer{
        width:268px;height:100%;min-height:0;overflow:hidden;
        background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);
        padding:14px 12px 14px;transform:none!important;transition:none;gap:10px;
      }
      .drawer-brand{
        display:flex;align-items:center;gap:8px;padding:2px 4px 6px;
        font-size:13.5px;font-weight:700;color:var(--fg-strong);letter-spacing:-.01em;flex-shrink:0;
      }
      .drawer-brand-dot{
        width:8px;height:8px;border-radius:99px;
        background:var(--accent);box-shadow:none;
      }
      .new-chat-btn,.new-chat-pick-btn{min-height:38px;border-radius:10px}
      .new-chat-btn{padding:5px 10px;font-size:13px}
      .new-chat-sub{font-size:10px}
      .conv-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:2px}
      .proj-toggle{font-size:13.5px;padding:5px 7px}
      .conv-item{
        padding:7px 10px;font-size:12.5px;border-radius:8px;
        transition:background-color .14s ease,border-color .14s ease;
      }
      .messages{
        padding:24px max(24px,calc(50% - 410px)) 18px;gap:18px;
      }
      .msg.user{max-width:72%;font-size:14.5px;padding:11px 16px}
      .md-body{font-size:14.5px}
      .md-body code{font-size:13px}
      .md-body pre code{font-size:12.5px}
      .approval-dock{padding:10px max(24px,calc(50% - 410px))}
      .queue-dock{padding:6px max(24px,calc(50% - 410px)) 4px}
      .composer-dock{
        padding:6px max(24px,calc(50% - 410px)) 18px;gap:8px;
      }
      .composer-card{
        border-radius:18px;padding:12px 14px 10px 16px;
        box-shadow:var(--composer-shadow-lg),inset 0 1px 0 var(--surface-highlight);
      }
      .composer-card textarea{min-height:32px;max-height:200px;font-size:14.5px}
      .quota-drawer{
        position:absolute;top:60px;right:24px;left:auto;width:368px;max-width:none;margin-left:0;
        max-height:calc(100% - 84px);
      }
      .sheet-backdrop{
        align-items:center;padding:24px;background:var(--backdrop-bg);
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
      }
      .sheet{
        max-width:440px;max-height:min(560px,80vh);border-radius:20px;
        border:1px solid var(--border-strong);padding:16px;
        box-shadow:var(--sheet-shadow);
      }
      .sheet.proj-modal{max-width:520px;max-height:min(680px,86vh)}
      .fv-backdrop{align-items:center;padding:24px}
      .fv-modal{max-height:min(760px,84vh);height:min(680px,84vh);border-radius:18px;padding-bottom:0}
      .proj-path-input{font-size:13px}
      .proj-field-input{font-size:14px}
      .prompt-other-input{font-size:13px}
      .sheet-opt{padding:10px 12px;font-size:13.5px}
      .toast{top:18px}
    }
    .topbar-actions{display:flex;align-items:center;gap:5px;flex-shrink:0}
    .top-panel-btn{
      appearance:none;border:1px solid var(--border);background:var(--surface-subtle);color:var(--fg);
      border-radius:10px;height:32px;padding:0 8px;display:inline-flex;align-items:center;gap:4px;
      font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;cursor:pointer;flex-shrink:0;white-space:nowrap;
      transition:border-color .15s ease,background-color .15s ease,color .15s ease;
    }
    .top-panel-btn:active{background:var(--surface-hover)}
    .top-panel-btn.active{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-strong-fg)}
    .top-panel-btn[hidden]{display:none!important}
    .ctx-drawer-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}
    .ctx-stat-box{padding:7px 9px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border)}
    .ctx-stat-lbl{font-size:11px;color:var(--muted)}
    .ctx-stat-val{font-size:13px;font-weight:600;color:var(--fg-strong);margin-top:2px;font-variant-numeric:tabular-nums}
    .usage-src-tabs{display:flex;gap:5px;margin-bottom:8px}
    .usage-src-btn{
      flex:1;appearance:none;min-height:30px;border:1px solid var(--border);background:var(--surface-subtle);color:var(--muted);
      border-radius:8px;padding:5px 6px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;
    }
    .usage-src-btn.active{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-strong-fg);font-weight:600}
    .usage-kpi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:8px}
    .usage-bars{display:flex;align-items:flex-end;gap:3px;height:46px;padding:6px 4px 2px;border-radius:10px;background:var(--surface-subtle);border:1px solid var(--border)}
    .usage-bar-col{flex:1;min-width:4px;border-radius:3px 3px 0 0;background:var(--accent)}
    .follow-desk-btn{
      appearance:none;margin:0 10px 8px;min-height:36px;padding:7px 10px;border-radius:10px;
      border:1px solid var(--accent-border);background:var(--accent-bg);color:var(--accent-strong-fg);
      font-size:12.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;
    }
    .follow-desk-btn:active{filter:brightness(1.08)}
    .isolated-badge{
      display:inline-flex;align-items:center;padding:1px 6px;border-radius:999px;font-size:10.5px;font-weight:600;white-space:nowrap;
      background:var(--accent-bg);border:1px solid var(--accent-border);color:var(--accent-strong-fg);flex-shrink:0;
    }
    body.hide-thinking .thought-box{display:none!important}
    body.hide-composer-tools .composer-toolbar .toolbar-left{display:none!important}
    @media (max-width:859px){
      .topbar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto auto auto;align-items:center;padding:6px 10px 7px;column-gap:6px;row-gap:4px}
      #btn-drawer{grid-column:1;grid-row:1 / span 2;align-self:center}
      .title-wrap{display:contents}
      .title-row{grid-column:2;grid-row:1;display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden}
      #btn-channel-pill{grid-column:3;grid-row:1;justify-self:end}
      .sub-row{grid-column:2 / -1;grid-row:2}
      .topbar-actions{
        grid-column:1 / -1;grid-row:3;width:100%;gap:6px;
        padding-top:5px;border-top:1px solid var(--topbar-border);
        overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;
      }
      .topbar-actions::-webkit-scrollbar{display:none}
      .topbar-actions .quota-pill{margin-left:auto}
      .quota-drawer{top:calc(env(safe-area-inset-top) + 92px)}
      .toast{top:calc(env(safe-area-inset-top) + 98px)}
      .top-panel-btn{height:32px;border-radius:8px;padding:0 8px;gap:4px;font-size:11.5px}
      .quota-pill{
        height:32px;padding:0 8px;border-radius:8px;font-size:11.5px;
        flex-direction:row;align-items:center;gap:5px;line-height:1;
      }
      .quota-pill span:last-child{font-size:11px;padding-left:5px;border-left:1px solid var(--border)}
      body.has-ctx-btn .quota-pill #ctx-badge{display:none}
    }
    @media (max-width:430px){
      .icon-btn{height:36px;min-width:36px;padding:0 4px}
      .conv-project-badge{max-width:46%;font-size:10.5px;padding:1px 6px}
      .channel-pill{height:28px;padding:0 8px;gap:4px;font-size:11px}
      .top-panel-btn{height:32px;padding:0 7px;gap:3px;font-size:11px}
      .quota-pill{height:32px;padding:0 7px;font-size:11px}
    }
    @media (max-width:360px){
      .topbar{padding:6px 8px;column-gap:5px;row-gap:5px}
      .icon-btn{height:36px;min-width:36px;padding:0 3px}
      .channel-pill{height:30px;padding:0 7px;gap:4px;font-size:10.5px}
      .topbar-actions{gap:4px;padding-top:4px}
      .top-panel-btn{height:32px;padding:0 6px;gap:2px;font-size:10.5px;border-radius:8px}
      #btn-usage-panel{min-width:32px;padding:0 6px;justify-content:center}
      #btn-usage-panel #usage-top-val{display:none}
      #btn-files-panel{min-width:32px;padding:0 6px}
      .quota-pill{height:32px;padding:0 6px;font-size:10.5px;border-radius:8px}
    }
    @supports (corner-shape:superellipse(1.25)){
      .composer-card,.quota-drawer,.sheet,.fv-modal,.mode-entry-card,.approval-card,.prompt-card,.queue-card,.msg.user,.qcard,.ctx-stat-box,.sheet-opt,.conv-item,.proj-head,.proj-item,.ap-btn,.proj-primary-btn,.empty-state-card{corner-shape:superellipse(1.25)}
    }
    @media (prefers-reduced-motion:reduce){
      *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <button id="btn-drawer" class="icon-btn" type="button" aria-label="会话与窗口">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>
      </button>
      <div class="title-wrap">
        <div class="title-row">
          <span id="status-dot" class="dot"></span>
          <span id="conv-title" class="conv-title">正在连接电脑端…</span>
        </div>
        <div class="sub-row">
          <span id="conv-project-badge" class="conv-project-badge" hidden></span>
          <div id="sub-meta" class="sub-meta">正在检测连接通道…</div>
        </div>
      </div>
      <button id="btn-channel-pill" class="channel-pill is-connecting" type="button" aria-label="切换连接方式" title="切换连接方式">
        <span id="channel-pill-dot" class="ch-dot"></span>
        <span id="channel-pill-label">连接中</span>
      </button>
      <div class="topbar-actions">
        <button id="btn-context-panel" class="top-panel-btn" type="button" aria-label="上下文窗口面板" title="上下文窗口面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><circle cx="12" cy="12" r="9" opacity=".35"/><path d="M12 3a9 9 0 1 1-6.36 2.64" stroke-linecap="round"/></svg>
          <span id="ctx-top-val">--%</span>
        </button>
        <button id="btn-files-panel" class="top-panel-btn" type="button" aria-label="项目文件与变更验收" title="项目文件与变更验收">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button id="btn-usage-panel" class="top-panel-btn" type="button" aria-label="本机已记录用量面板" title="本机已记录用量面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span id="usage-top-val">用量</span>
        </button>
        <button id="btn-quota" class="quota-pill" type="button">
          <span id="quota-main">G4 -- · C --</span>
          <span id="ctx-badge">--%</span>
        </button>
      </div>
    </header>

    <div id="conn-banner" class="conn-banner" role="alert" hidden>
      <span id="conn-banner-msg" class="conn-banner-msg">与电脑端的连接已断开，正在尝试自动重连…</span>
      <div class="conn-banner-actions">
        <button id="conn-retry-btn" class="conn-banner-btn primary" type="button">立即重试</button>
        <button id="conn-switch-btn" class="conn-banner-btn" type="button">切换连接方式</button>
      </div>
    </div>

    <div id="context-drawer" class="quota-drawer top-drawer context-drawer" hidden></div>
    <div id="usage-drawer" class="quota-drawer top-drawer usage-drawer" hidden></div>
    <div id="quota-drawer" class="quota-drawer" hidden></div>

    <main id="messages" class="messages">
      <div class="empty-tip">正在读取桌面端对话画面…</div>
    </main>

    <section id="approval-dock" class="approval-dock" hidden></section>
    <section id="queue-dock" class="queue-dock" hidden></section>

    <footer class="composer-dock">
      <div id="attach-hint" class="attach-hint" hidden></div>
      <div id="chips" class="chips"></div>
      <div class="composer-card">
        <textarea id="input" rows="1" enterkeyhint="enter" placeholder="发消息… (Cmd/Ctrl + Enter 发送)"></textarea>
        <input id="img-input" type="file" multiple hidden>
        <div class="composer-toolbar">
          <div class="toolbar-left">
            <button id="btn-img" class="ghost-btn icon-only" type="button" title="上传图片或文件" aria-label="上传图片或文件">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button id="btn-model-inline" class="ghost-btn" type="button" title="切换模型">
              <span id="model-inline-label" class="ghost-label">切换模型</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.7"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button id="btn-perm-inline" class="ghost-btn" type="button" title="切换权限预设" style="flex-shrink:0">
              <span id="perm-inline-icon" class="perm-ico unknown" data-perm-mode="unknown"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
              <span id="perm-inline-label">权限</span>
            </button>
          </div>
          <div class="toolbar-right">
            <button id="btn-send" class="send-circle" type="button" aria-label="发送消息">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    </footer>
  </div>

  <div id="sheet-backdrop" class="sheet-backdrop" hidden>
    <div class="sheet">
      <div class="sheet-title">
        <button id="sheet-back-btn" class="sheet-back-btn" type="button" hidden>‹ 返回</button>
        <div class="sheet-title-left">
          <span id="sheet-title-text">选择选项</span>
          <span id="sheet-sub-text" class="sheet-sub-text" hidden></span>
        </div>
        <div class="sheet-title-actions">
          <button id="sheet-action-btn" class="sheet-speed-btn" type="button" hidden>⚡ 测速</button>
          <button id="sheet-close" class="icon-btn panel-close-btn" type="button">关闭</button>
        </div>
      </div>
      <div id="sheet-list" class="sheet-list"></div>
    </div>
  </div>

  <div id="proj-modal-backdrop" class="sheet-backdrop" hidden>
    <div class="sheet proj-modal" role="dialog" aria-label="新建项目">
      <div class="sheet-title">
        <span>新建项目 · 选择电脑目录</span>
        <button id="proj-modal-close" class="icon-btn panel-close-btn" type="button">关闭</button>
      </div>
      <div id="proj-modal-body" class="proj-modal-body">
        <div id="proj-roots" class="proj-roots-bar"></div>
        <div class="proj-path-row">
          <input id="proj-path-input" class="proj-path-input" type="text" placeholder="输入电脑路径，例如 ~/codebase/my-app">
          <button id="proj-path-go" class="proj-act-btn" type="button">前往</button>
        </div>
        <div class="proj-act-row">
          <button id="proj-up-btn" class="proj-act-btn" type="button">↑ 上级目录</button>
          <button id="proj-hidden-btn" class="proj-act-btn" type="button">显示隐藏目录</button>
          <button id="proj-mkdir-toggle" class="proj-act-btn" type="button">＋ 新建文件夹</button>
        </div>
        <div id="proj-mkdir-row" class="proj-mkdir-row" hidden>
          <input id="proj-mkdir-input" class="proj-field-input" type="text" placeholder="输入新文件夹名称…">
          <button id="proj-mkdir-confirm" class="proj-act-btn active" type="button">创建</button>
        </div>
        <div id="proj-dir-list" class="proj-dir-list"></div>
        <div id="proj-selected-summary" class="proj-summary-card"></div>
        <div class="proj-name-row">
          <label class="proj-name-label" for="proj-name-input">项目名称</label>
          <input id="proj-name-input" class="proj-field-input" type="text" placeholder="请填写项目名称…">
        </div>
        <button id="proj-create-submit" class="proj-primary-btn" type="button">创建项目并进入对话</button>
      </div>
    </div>
  </div>

  <div id="drawer-backdrop" class="drawer-backdrop" aria-hidden="true">
    <div id="drawer-panel" class="drawer">
      <div class="drawer-brand">
        <span class="drawer-brand-dot"></span>
        <span>Antigravity Remote</span>
      </div>
      <div class="new-chat-group">
        <button id="btn-new-chat" class="new-chat-btn" type="button">
          <span class="new-chat-main">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span id="new-chat-label" class="new-chat-label">新建对话</span>
          </span>
          <span id="new-chat-sub" class="new-chat-sub" hidden></span>
        </button>
        <button id="btn-new-chat-project" class="new-chat-pick-btn" type="button" title="选择项目新建对话" aria-label="选择项目新建对话">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <button id="btn-follow-desktop" class="follow-desk-btn" type="button" hidden>🔄 同步桌面当前会话</button>
      <div class="conv-toolbar">
        <div id="conv-view-tabs" class="conv-view-tabs" role="tablist" aria-label="会话视图切换">
          <button class="conv-tab active" data-conv-view="projects" type="button" role="tab" aria-selected="true">按项目 <span id="tab-proj-count" class="tab-count"></span></button>
          <button class="conv-tab" data-conv-view="recent" type="button" role="tab" aria-selected="false">活跃 <span id="tab-conv-count" class="tab-count"></span></button>
        </div>
        <button id="btn-new-project" class="new-proj-mini-btn" type="button" title="新建项目（选择电脑目录）" aria-label="新建项目">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3.5"/><path d="M18 15v6"/><path d="M15 18h6"/></svg>
        </button>
      </div>
      <div id="drawer-nav-bar" class="drawer-nav-bar" hidden><span class="drawer-sub">历史项目</span></div>
      <div id="conv-list" class="conv-list"></div>
      <div class="drawer-footer">
        <div id="theme-seg" class="theme-seg" role="radiogroup" aria-label="切换外观">
          <button class="theme-seg-btn" type="button" role="radio" aria-checked="false" data-theme-mode="system" title="跟随系统" aria-label="跟随系统">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </button>
          <button class="theme-seg-btn" type="button" role="radio" aria-checked="false" data-theme-mode="light" title="浅色模式" aria-label="浅色模式">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          </button>
          <button class="theme-seg-btn" type="button" role="radio" aria-checked="false" data-theme-mode="dark" title="深色模式" aria-label="深色模式">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
          </button>
        </div>
        <button id="btn-mode-switcher" class="push-footer-btn" type="button" title="切换连接通道与测速" aria-label="切换连接通道">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        </button>
        <button id="btn-push-settings" class="push-footer-btn" type="button" title="消息推送与未读角标设置" aria-label="消息推送设置">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast" hidden></div>
  <div id="media-lightbox" class="media-lightbox" hidden>
    <button id="media-lightbox-close" class="media-lightbox-close" type="button" aria-label="关闭预览">✕</button>
    <img id="media-lightbox-img" alt="附件预览" />
  </div>
  <div id="file-viewer-backdrop" class="fv-backdrop" hidden>
    <div id="file-viewer-modal" class="fv-modal" role="dialog" aria-label="文件与项目验收">
      <div class="fv-head">
        <button id="fv-back-btn" class="fv-up-btn" type="button" hidden>← 返回</button>
        <span id="fv-title" class="fv-title">项目文件与验收</span>
        <button id="fv-close-btn" class="fv-up-btn" type="button">✕ 关闭</button>
      </div>
      <div id="fv-tabs" class="fv-tabs">
        <button id="fv-tab-tree" class="fv-tab active" type="button">📁 项目文件</button>
        <button id="fv-tab-changes" class="fv-tab" type="button">📝 变更与产物</button>
      </div>
      <div id="fv-body" class="fv-body"></div>
    </div>
  </div>

  <script>
  (function(){
    const PAIR_STORAGE_KEY = 'ag_remote_pair_v1';
    const DEVICE_ID_STORAGE_KEY = 'ag_remote_device_id_v1';
    const CLIENT_ID_SESSION_KEY = 'ag_remote_client_id_v1';
    const CONV_ID_SESSION_KEY = 'ag_remote_conv_id_v1';
    const TARGET_ID_SESSION_KEY = 'ag_remote_target_id_v1';
    const USAGE_SRC_SESSION_KEY = 'ag_remote_usage_src_v1';
    const DRAFT_SESSION_PREFIX = 'ag_remote_draft_v1:';
    const SPEED_STORAGE_KEY = 'ag_remote_speed_v1';
    const MANUAL_LOCK_SESSION_KEY = 'ag_remote_manual_lock_v1';
    const urlParams = new URLSearchParams(location.search);
    const urlToken = urlParams.get('token') || '';
    const urlName = urlParams.get('name') || '';
    const urlDid = String(urlParams.get('did') || '').trim();
    const urlBcid = String(urlParams.get('bcid') || '').trim();
    const isManualEntry = urlParams.get('manual') === '1';
    const isAutoSwitched = urlParams.get('autosw') === '1';

    const deviceId = (() => {
      try {
        if ((isAutoSwitched || isManualEntry) && /^dev-[a-z0-9_-]{6,60}$/i.test(urlDid)) {
          localStorage.setItem(DEVICE_ID_STORAGE_KEY, urlDid);
          return urlDid;
        }
        let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '';
        if (!id) {
          id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
          localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
        }
        return id;
      } catch {
        return (isAutoSwitched || isManualEntry) && /^dev-[a-z0-9_-]{6,60}$/i.test(urlDid) ? urlDid : '';
      }
    })();

    const clientId = (() => {
      try {
        if (isAutoSwitched && /^agb-[a-z0-9_-]{4,64}$/i.test(urlBcid)) {
          sessionStorage.setItem(CLIENT_ID_SESSION_KEY, urlBcid);
          return urlBcid;
        }
        let cid = sessionStorage.getItem(CLIENT_ID_SESSION_KEY) || '';
        if (!/^agb-[a-z0-9_-]{4,64}$/i.test(cid)) {
          cid = 'agb-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
          sessionStorage.setItem(CLIENT_ID_SESSION_KEY, cid);
        }
        return cid;
      } catch {
        return 'agb-' + Math.random().toString(36).slice(2, 10);
      }
    })();

    const deviceFp = (() => {
      try {
        const scr = (typeof screen === 'object' && screen) ? screen : {};
        const swRaw = Number(scr.width) || 0;
        const shRaw = Number(scr.height) || 0;
        const sw = Math.min(swRaw, shRaw);
        const sh = Math.max(swRaw, shRaw);
        const dpr = Math.round((Number(window.devicePixelRatio) || 1) * 100);
        const plat = String(navigator.platform || '');
        const cores = Number(navigator.hardwareConcurrency || 0);
        let tz = '';
        try { tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch {}
        const raw = [sw + 'x' + sh, dpr, plat, cores, tz].join('|');
        let h = 2166136261;
        for (let i = 0; i < raw.length; i++) {
          h ^= raw.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
        return 'fp-' + h.toString(16) + '-' + sw + 'x' + sh;
      } catch {
        return '';
      }
    })();

    function b64UrlDecodeJson(raw) {
      if (!raw) return null;
      try {
        let b64 = String(raw).replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const json = typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : decodeURIComponent(escape(bin));
        return JSON.parse(json);
      } catch {
        return null;
      }
    }
    function b64UrlEncodeJson(obj) {
      try {
        const json = JSON.stringify(obj);
        let bin = '';
        if (typeof TextEncoder === 'function') {
          const bytes = new TextEncoder().encode(json);
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        } else {
          bin = unescape(encodeURIComponent(json));
        }
        return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      } catch {
        return '';
      }
    }
    function decodeEndpointsClient(raw) {
      const list = b64UrlDecodeJson(raw);
      return Array.isArray(list) ? list.filter((x) => x && typeof x.url === 'string' && /^https?:\\/\\//i.test(x.url)) : [];
    }
    function encodeEndpointsClient(list) {
      return b64UrlEncodeJson(Array.isArray(list) ? list : []);
    }
    function decodeSpeedTestClient(raw) {
      const parsed = b64UrlDecodeJson(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.results || typeof parsed.results !== 'object') return null;
      return {
        running: false,
        testedAt: Number(parsed.testedAt) || 0,
        results: parsed.results
      };
    }
    function encodeSpeedTestClient(st) {
      if (!st || !st.testedAt || !st.results || typeof st.results !== 'object') return '';
      const compactResults = {};
      for (const [k, v] of Object.entries(st.results)) {
        if (!v || typeof v !== 'object') continue;
        compactResults[k] = {
          ok: Boolean(v.ok),
          ms: Number.isFinite(v.ms) ? v.ms : null,
          reason: String(v.reason || ''),
          via: String(v.via || ''),
          url: String(v.url || '')
        };
      }
      return b64UrlEncodeJson({ testedAt: st.testedAt, results: compactResults });
    }

    function detectKindFromOrigin(rawUrl) {
      const origin = String(rawUrl || '').toLowerCase();
      if (origin.includes('.ts.net') || origin.startsWith('http://100.') || origin.startsWith('https://100.')) return 'tailscale';
      if (origin.includes('.trycloudflare.com') || origin.startsWith('https://')) return 'tunnel';
      if (origin.includes('.local:') || origin.endsWith('.local')) return 'bonjour';
      return 'lan';
    }
    function isTrustedSecureOrigin(rawUrl) {
      const s = String(rawUrl || '').trim().toLowerCase();
      if (!s) return false;
      if (s.startsWith('https://')) return true;
      return /^http:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?(?:\\/|$)/i.test(s);
    }
    function shouldBlockInsecureDowngrade(curOrigin, targetUrl, standaloneFlag) {
      if (isTrustedSecureOrigin(targetUrl)) return false;
      return Boolean(standaloneFlag || isTrustedSecureOrigin(curOrigin));
    }
    function formatKindLabel(kind) {
      if (kind === 'tunnel') return 'Cloudflare 隧道';
      if (kind === 'tailscale') return 'Tailscale';
      if (kind === 'bonjour') return 'Bonjour';
      return '局域网';
    }
    function isRawIpHost(host) {
      const h = String(host || '').replace(/^\\[|\\]$/g, '').toLowerCase();
      if (!h) return false;
      return /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(h) || h.includes(':');
    }
    function loadStoredPair() {
      try {
        const raw = localStorage.getItem(PAIR_STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return (p && typeof p === 'object') ? p : null;
      } catch {
        return null;
      }
    }
    let swRegistrationPromise = null;
    let swLastError = '';
    function syncEndpointsToServiceWorker(st) {
      try {
        const src = st || (typeof pairState === 'object' ? pairState : null);
        if (!src || !Array.isArray(src.endpoints) || !src.endpoints.length) return;
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return;
        const msg = {
          type: 'ag-cache-endpoints',
          endpoints: src.endpoints,
          encodedEndpoints: encodeEndpointsClient(src.endpoints),
          token: src.token || '',
          name: src.name || ''
        };
        if (navigator.serviceWorker.controller && typeof navigator.serviceWorker.controller.postMessage === 'function') {
          navigator.serviceWorker.controller.postMessage(msg);
        }
        if (swRegistrationPromise && typeof swRegistrationPromise.then === 'function') {
          swRegistrationPromise.then((reg) => {
            const target = reg?.active || navigator.serviceWorker?.controller || null;
            if (target && typeof target.postMessage === 'function') target.postMessage(msg);
          }).catch(() => {});
        }
      } catch {}
    }
    function saveStoredPair(st) {
      try {
        localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify({
          token: st.token || '',
          name: st.name || '',
          hosts: Array.isArray(st.hosts) ? st.hosts : [],
          endpoints: Array.isArray(st.endpoints) ? st.endpoints : []
        }));
      } catch {}
      syncEndpointsToServiceWorker(st);
    }
    function loadStoredSpeed() {
      try {
        const raw = localStorage.getItem(SPEED_STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object' || typeof p.results !== 'object') return null;
        return { running: false, testedAt: Number(p.testedAt) || 0, results: p.results || {} };
      } catch {
        return null;
      }
    }
    function saveStoredSpeed(st) {
      try {
        const compactResults = {};
        for (const [k, v] of Object.entries(st?.results || {})) {
          if (!v || typeof v !== 'object') continue;
          compactResults[k] = {
            ok: Boolean(v.ok),
            ms: Number.isFinite(v.ms) ? v.ms : null,
            reason: String(v.reason || ''),
            via: String(v.via || ''),
            url: String(v.url || ''),
            testedAt: Number(v.testedAt) || 0
          };
        }
        localStorage.setItem(SPEED_STORAGE_KEY, JSON.stringify({
          testedAt: Number(st?.testedAt) || 0,
          results: compactResults
        }));
      } catch {}
    }

    const urlHosts = (urlParams.get('hosts') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const urlEndpoints = decodeEndpointsClient(urlParams.get('endpoints') || '');
    const urlSpeed = decodeSpeedTestClient(urlParams.get('spd') || '');
    const storedPair = loadStoredPair() || {};
    const pairState = {
      token: urlToken || storedPair.token || '',
      name: urlName || storedPair.name || '',
      hosts: urlHosts.length ? urlHosts : (Array.isArray(storedPair.hosts) ? storedPair.hosts : []),
      endpoints: urlEndpoints.length ? urlEndpoints : (Array.isArray(storedPair.endpoints) ? storedPair.endpoints : [])
    };
    if (isManualEntry) {
      try { sessionStorage.setItem(MANUAL_LOCK_SESSION_KEY, '1'); } catch {}
    } else if (urlToken && !isAutoSwitched) {
      try { sessionStorage.removeItem(MANUAL_LOCK_SESSION_KEY); } catch {}
    }
    let manualLocked = isManualEntry || (() => {
      try { return sessionStorage.getItem(MANUAL_LOCK_SESSION_KEY) === '1'; } catch { return false; }
    })();

    const storedSpeed = loadStoredSpeed();
    let speedTestState = (urlSpeed && urlSpeed.testedAt >= (storedSpeed?.testedAt || 0))
      ? urlSpeed
      : (storedSpeed || { running: false, testedAt: 0, results: {} });
    if (urlSpeed && urlSpeed.testedAt) saveStoredSpeed(speedTestState);

    const urlOpenConvId = String(urlParams.get('conversationId') || '').trim();
    if (urlToken || urlEndpoints.length || urlHosts.length || urlDid || urlBcid || urlSpeed || isManualEntry || isAutoSwitched || urlOpenConvId) {
      saveStoredPair(pairState);
      try { history.replaceState(null, '', location.pathname); } catch {}
    }
    if (isTrustedSecureOrigin(location.origin) && 'serviceWorker' in navigator) {
      swRegistrationPromise = navigator.serviceWorker.register('/sw.js?lang=${locale}', { scope: '/' }).then((reg) => {
        if (reg) syncEndpointsToServiceWorker(pairState);
        return reg;
      }).catch((err) => {
        swLastError = err?.message || String(err || 'register failed');
        return null;
      });
      if (typeof navigator.serviceWorker.addEventListener === 'function') {
        navigator.serviceWorker.addEventListener('message', (ev) => {
          const msg = ev && ev.data;
          if (msg && msg.type === 'ag-open-conversation' && msg.conversationId && typeof switchConversationById === 'function') {
            void switchConversationById(String(msg.conversationId));
          } else if (msg && msg.type === 'ag-push-badge-updated' && latestSnap) {
            syncAppBadgeCount(computeClientCompletedUnreadCount(getMergedConversations(latestSnap)));
          }
        });
      }
    }
    let pendingOpenConvId = urlOpenConvId;

    function computeClientCompletedUnreadCount(convs) {
      if (!Array.isArray(convs)) return 0;
      let count = 0;
      for (const c of convs) {
        if (!c || c.archived === true) continue;
        if (c.status === 'idle' && c.completedUnread === true) count += 1;
      }
      return count;
    }

    function syncAppBadgeCount(count) {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      try {
        if (navigator && typeof navigator.setAppBadge === 'function') {
          if (n > 0) void navigator.setAppBadge(n).catch(() => {});
          else if (typeof navigator.clearAppBadge === 'function') void navigator.clearAppBadge().catch(() => {});
          else void navigator.setAppBadge(0).catch(() => {});
        }
      } catch {}
      try {
        document.title = n > 0 ? ('(' + n + ') Antigravity Remote') : 'Antigravity Remote';
      } catch {}
      return n;
    }

    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (String(base64String || '').length % 4)) % 4);
      const base64 = (String(base64String || '') + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      const output = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
      return output;
    }

    function pushApiRequest(apiPath, method, bodyObj) {
      const m = String(method || 'GET').toUpperCase();
      const extraHeaders = m !== 'GET' ? { 'Content-Type': 'application/json' } : {};
      const opts = {
        method: m,
        headers: authHeaders(extraHeaders)
      };
      if (m !== 'GET' && bodyObj !== undefined) {
        opts.body = JSON.stringify(bodyObj);
      }
      return fetchWithTimeout((apiBase || '') + apiPath, opts, 8000);
    }

    const LOCAL_NOTIFY_STORAGE_KEY = 'ag_remote_local_notify_v1';
    function isLocalNotifyEnabled() {
      try { return localStorage.getItem(LOCAL_NOTIFY_STORAGE_KEY) === '1'; } catch { return false; }
    }
    function setLocalNotifyEnabled(on) {
      try {
        if (on) localStorage.setItem(LOCAL_NOTIFY_STORAGE_KEY, '1');
        else localStorage.removeItem(LOCAL_NOTIFY_STORAGE_KEY);
      } catch {}
    }

    function showLocalSystemNotification(title, body, conversationId) {
      try {
        if (typeof Notification !== 'function' || Notification.permission !== 'granted') return false;
        const n = new Notification(String(title || 'Antigravity 远程通知'), {
          body: String(body || ''),
          icon: '/icon-192.png',
          tag: conversationId ? ('ag-local-' + conversationId) : ('ag-local-' + Date.now())
        });
        n.onclick = () => {
          try { window.focus(); } catch {}
          if (conversationId && typeof switchConversationById === 'function') {
            void switchConversationById(String(conversationId));
          }
        };
        return true;
      } catch {
        return false;
      }
    }

    async function waitForSwActive(reg, timeoutMs) {
      if (!reg) return null;
      if (reg.active && reg.active.state === 'activated') return reg;
      const worker = reg.installing || reg.waiting || reg.active;
      if (!worker) return reg;
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const t = setTimeout(finish, timeoutMs || 4000);
        const onState = () => {
          if (worker.state === 'activated' || worker.state === 'redundant') {
            clearTimeout(t);
            finish();
          }
        };
        if (typeof worker.addEventListener === 'function') {
          worker.addEventListener('statechange', onState);
        }
        onState();
      });
      return reg;
    }

    async function resolveSwRegistration(allowRegister) {
      if (!('serviceWorker' in navigator)) {
        swLastError = '当前环境不支持 serviceWorker';
        return null;
      }
      try {
        if (swRegistrationPromise) {
          const existing = await Promise.race([
            swRegistrationPromise,
            new Promise((r) => setTimeout(() => r(null), 1500))
          ]);
          if (existing) return allowRegister ? await waitForSwActive(existing, 4000) : existing;
        }
        if (typeof navigator.serviceWorker.getRegistration === 'function') {
          const reg = await navigator.serviceWorker.getRegistration('/')
            || await navigator.serviceWorker.getRegistration();
          if (reg) return allowRegister ? await waitForSwActive(reg, 4000) : reg;
        }
        if (allowRegister && isTrustedSecureOrigin(location.origin)) {
          swLastError = '';
          swRegistrationPromise = navigator.serviceWorker.register('/sw.js?lang=${locale}', { scope: '/' }).catch((err) => {
            swLastError = err?.message || String(err || 'register failed');
            return null;
          });
          const reg = await Promise.race([
            swRegistrationPromise,
            new Promise((r) => setTimeout(() => r(null), 4000))
          ]);
          if (reg) return await waitForSwActive(reg, 4000);
          const readyReg = await Promise.race([
            navigator.serviceWorker.ready.catch(() => null),
            new Promise((r) => setTimeout(() => r(null), 2000))
          ]);
          if (readyReg) return readyReg;
        }
      } catch (err) {
        swLastError = err?.message || String(err || 'unknown');
      }
      return null;
    }

    async function getActivePushSubscription() {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        const reg = await resolveSwRegistration(false);
        if (!reg || !reg.pushManager) return null;
        return await reg.pushManager.getSubscription();
      } catch {
        return null;
      }
    }

    let cachedHasActiveWebPush = false;
    async function refreshPushButtonState() {
      const btn = $('btn-push-settings');
      const sub = await getActivePushSubscription();
      cachedHasActiveWebPush = Boolean(sub);
      if (!btn) return;
      const localOn = isLocalNotifyEnabled() && typeof Notification === 'function' && Notification.permission === 'granted';
      btn.classList.toggle('active', Boolean(sub || localOn));
    }

    async function openPushSettingsSheet() {
      if (!isDesktopLayout()) closeDrawer();
      const isSecure = isTrustedSecureOrigin(location.origin);
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      const hasNotifApi = typeof window !== 'undefined' && 'Notification' in window;
      const hasPushApi = hasNotifApi && 'PushManager' in window && 'serviceWorker' in navigator;
      const isQuickTunnel = String(location.hostname || '').toLowerCase().endsWith('.trycloudflare.com');
      let serverInfo = null;
      try {
        const res = await pushApiRequest('/api/push/vapid-key', 'GET');
        if (res.ok) serverInfo = await res.json();
      } catch {}
      const sub = hasPushApi ? await getActivePushSubscription() : null;
      const localOn = isLocalNotifyEnabled() && hasNotifApi && Notification.permission === 'granted';
      const prefs = (serverInfo && serverInfo.prefs) || { enabled: true, notifyCompleted: true, notifyWaiting: true };

      const rows = [];
      if (!isSecure) {
        rows.push({
          label: '需要 HTTPS 安全上下文',
          sub: '当前为明文 HTTP 地址，请通过 https://<机器名>.ts.net、固定域名隧道或 localhost 打开后再开启推送。',
          disabled: true
        });
      } else if (isIos && !isStandalonePwa) {
        rows.push({
          label: 'iOS 需先「添加到主屏幕」',
          sub: 'iOS 16.4+ 要求在 Safari 点击分享 → 添加到主屏幕，从桌面图标打开后才能开启 Web Push 与图标未读角标。',
          disabled: true
        });
      } else if (!hasNotifApi) {
        rows.push({
          label: '当前浏览器不支持系统通知',
          sub: '桌面未读角标与页面未读提示仍会在前台自动更新。',
          disabled: true
        });
      } else if (!sub && !localOn) {
        rows.push({
          label: '🔔 开启本机消息推送与未读角标',
          sub: isQuickTunnel
            ? '提示：Quick Tunnel 随机域名变更后需重新订阅；推荐使用 Tailscale HTTPS 获得长期稳定推送。'
            : '后台对话完成或待审批时推送通知，并同步桌面应用图标未读数。',
          value: 'enable'
        });
      } else {
        rows.push({
          label: '🔕 关闭本机消息推送',
          sub: sub
            ? ('已启用 Web Push 后台推送（本机已关联 ' + (serverInfo?.subscriptionCount || 1) + ' 台设备）')
            : '已启用本地系统通知（页面开启时即时弹出通知并同步角标）',
          value: 'disable'
        });
        rows.push({
          label: (prefs.notifyCompleted ? '✓ ' : '○ ') + '对话运行完成提醒',
          sub: prefs.notifyCompleted ? '已开启：对话结束且有新产出时推送' : '已关闭',
          value: 'toggle-completed'
        });
        rows.push({
          label: (prefs.notifyWaiting ? '✓ ' : '○ ') + '待审批 / 等待确认提醒',
          sub: prefs.notifyWaiting ? '已开启：触发权限或提问卡时高优推送' : '已关闭',
          value: 'toggle-waiting'
        });
        rows.push({
          label: '📤 发送测试通知',
          sub: '立即发送一条测试通知并刷新桌面未读角标',
          value: 'test'
        });
      }

      openSheet('消息推送与未读角标', rows, async (item) => {
        if (!item || !item.value || item.disabled) return;
        if (item.value === 'enable') {
          try {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
              showToast('通知权限未授予，请在系统/浏览器设置中允许通知');
              return;
            }
            if (!serverInfo || !serverInfo.publicKey) {
              const retryKey = await pushApiRequest('/api/push/vapid-key', 'GET').catch(() => null);
              if (retryKey && retryKey.ok) serverInfo = await retryKey.json().catch(() => null);
            }
            const reg = hasPushApi ? await resolveSwRegistration(true) : null;
            if (!reg || !reg.pushManager || !serverInfo || !serverInfo.publicKey) {
              setLocalNotifyEnabled(true);
              await refreshPushButtonState();
              const reason = swLastError || (!reg ? 'SW 未注册' : (!reg.pushManager ? '浏览器无 pushManager' : '缺少 VAPID 公钥'));
              showLocalSystemNotification('Antigravity 通知已开启', '已启用本地系统通知（后台 Web Push 不可用：' + reason + '）', '');
              showToast('已开启本地系统通知（Web Push：' + reason + '）');
              return;
            }
            try {
              const nextSub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(serverInfo.publicKey)
              });
              const subJson = typeof nextSub.toJSON === 'function' ? nextSub.toJSON() : nextSub;
              const saveRes = await pushApiRequest('/api/push/subscribe', 'POST', {
                subscription: subJson,
                origin: location.origin,
                label: (navigator.platform || 'Device').slice(0, 40)
              });
              const saveData = await saveRes.json().catch(() => ({}));
              if (!saveRes.ok || !saveData.ok) {
                await nextSub.unsubscribe().catch(() => {});
                cachedHasActiveWebPush = false;
                await refreshPushButtonState();
                showToast('保存订阅失败：' + (saveData.error || saveRes.status));
                return;
              }
              cachedHasActiveWebPush = true;
              setLocalNotifyEnabled(false);
              await refreshPushButtonState();
              showToast('已开启消息推送与未读角标');
            } catch (subErr) {
              setLocalNotifyEnabled(true);
              await refreshPushButtonState();
              const msg = subErr?.message || '推送服务不可达';
              showLocalSystemNotification('Antigravity 本地通知已开启', '后台推送订阅受限（' + msg + '），已自动切换本地系统通知。', '');
              showToast('已切换本地系统通知（' + msg + '）');
            }
          } catch (err) {
            showToast('开启推送失败：' + (err?.message || '未知错误'));
          }
          return;
        }
        if (item.value === 'disable') {
          try {
            setLocalNotifyEnabled(false);
            cachedHasActiveWebPush = false;
            if (sub) {
              const ep = sub.endpoint;
              await sub.unsubscribe().catch(() => {});
              await pushApiRequest('/api/push/unsubscribe', 'POST', { endpoint: ep }).catch(() => {});
            }
            await refreshPushButtonState();
            showToast('已关闭本机消息推送');
          } catch {
            showToast('关闭推送失败');
          }
          return;
        }
        if (item.value === 'toggle-completed' || item.value === 'toggle-waiting') {
          const patch = item.value === 'toggle-completed'
            ? { notifyCompleted: !prefs.notifyCompleted }
            : { notifyWaiting: !prefs.notifyWaiting };
          try {
            const prefRes = await pushApiRequest('/api/push/prefs', 'POST', patch);
            if (!prefRes.ok) {
              showToast('更新推送偏好失败（HTTP ' + prefRes.status + '）');
              return;
            }
            showToast('推送偏好已更新');
          } catch {
            showToast('更新推送偏好失败，请检查网络连接');
          }
          return;
        }
        if (item.value === 'test') {
          if (sub) {
            const testRes = await pushApiRequest('/api/push/test', 'POST', {}).catch(() => null);
            const testData = testRes ? await testRes.json().catch(() => ({})) : {};
            if (testRes && testRes.ok && testData.ok && Number(testData.sent || 0) > 0) {
              showToast('测试推送已发送（送达 ' + testData.sent + ' 台设备）');
              return;
            }
          }
          const popped = showLocalSystemNotification('Antigravity 远程通知测试', ${serializeRemoteTemplateData(locale === 'zh-TW' ? localizeRemoteText('通知通道正常，桌面应用未读角标将随已完成未读数自动同步。') : '通知通道正常，桌面应用未读角标将随已完成未读数自动同步。')}, '');
          showToast(popped ? '已弹出本地系统测试通知' : '测试通知未送达，请检查系统通知权限');
        }
      });
    }

    let apiBase = '';
    let activeSheetKind = '';
    let activeSheetState = null;
    let activeDrawerProject = '';
    let autoSwitchChecked = false;
    let navigatingAway = false;
    let currentTargetId = (() => {
      try { return sessionStorage.getItem(TARGET_ID_SESSION_KEY) || ''; } catch { return ''; }
    })();
    let selectedConversationId = (() => {
      try { return sessionStorage.getItem(CONV_ID_SESSION_KEY) || ''; } catch { return ''; }
    })();
    let usageSourceFilter = (() => {
      try {
        const s = sessionStorage.getItem(USAGE_SRC_SESSION_KEY) || 'all';
        return (s === 'desktop' || s === 'cli' || s === 'all') ? s : 'all';
      } catch { return 'all'; }
    })();
    let cachedUsageData = null;
    let cachedContextResp = null;
    let latestDisplayConfig = null;
    let latestSnap = null;
    const QUICK_DIRECT_MODE_KEY = 'ag_remote_quick_direct_v1';
    const DEFAULT_CLIENT_QUICK_PROMPTS = ${serializeRemoteTemplateData(DEFAULT_REMOTE_QUICK_PROMPTS)};
    let quickDirectMode = (() => {
      try { return localStorage.getItem(QUICK_DIRECT_MODE_KEY) !== '0'; } catch { return true; }
    })();
    let lastQuickSendAt = 0;
    const promptDraftState = new Map();
    let promptSubmittingSig = '';
    let queueActionBusy = false;
    let wakeLock = null;
    let wakeWanted = false;
    let pollTimer = null;
    let toastTimer = null;
    let sending = false;
    let stickBottom = true;
    let programmaticScrollTop = null;

    const $ = (id) => document.getElementById(id);
    const msgEl = $('messages');
    let activeSnapAbort = null;

    const isIpadDesktopUa = (() => {
      try {
        return Number(navigator.maxTouchPoints || 0) > 1 && /Mac/i.test(String(navigator.platform || ''));
      } catch {
        return false;
      }
    })();
    function authHeaders(extra) {
      const h = Object.assign({ 'Accept-Language': document.documentElement.lang }, extra || {});
      if (pairState.token) h['X-AG-Remote-Token'] = pairState.token;
      if (clientId) h['X-AG-Client-Id'] = clientId;
      if (deviceId) h['X-AG-Device-Id'] = deviceId;
      if (deviceFp) h['X-AG-Device-Fp'] = deviceFp;
      if (isIpadDesktopUa) h['X-AG-Device-Hint'] = 'iPad';
      return h;
    }

    function fetchWithTimeout(url, init, timeoutMs, externalCtrl) {
      const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000;
      const ctrl = externalCtrl || (typeof AbortController === 'function' ? new AbortController() : null);
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, ms) : null;
      const opts = Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {});
      return fetch(url, opts).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }

    function nowPerfMs() {
      return (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    async function probeEndpointOnce(ep, timeoutMs) {
      const isHttpsPage = location.protocol === 'https:';
      const cleanUrl = String(ep?.url || '').replace(/\\/+$/, '');
      const epIsHttp = cleanUrl.toLowerCase().startsWith('http://');
      const effectiveTimeout = (isHttpsPage && epIsHttp) ? Math.min(600, timeoutMs) : timeoutMs;
      const nonce = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      const t0 = nowPerfMs();
      try {
        const r = await fetchWithTimeout(cleanUrl + '/api/ping?probe=1&_n=' + encodeURIComponent(nonce) + '&_t=' + Date.now(), {
          headers: authHeaders({ 'X-AG-Probe': '1' }),
          cache: 'no-store'
        }, effectiveTimeout);
        if (r.status === 403) return { ok: false, ms: null, reason: 'disabled', data: null };
        if (!r.ok) return { ok: false, ms: null, reason: (isHttpsPage && epIsHttp) ? 'https_restricted' : 'unreachable', data: null };
        const d = await r.json().catch(() => null);
        if (!d || d.ok !== true) {
          return { ok: false, ms: null, reason: (isHttpsPage && epIsHttp) ? 'https_restricted' : 'unreachable', data: null };
        }
        if (d.nonce && d.nonce !== nonce) {
          return { ok: false, ms: null, reason: 'unreachable', data: null };
        }
        if (d.service !== 'ag-mobile-remote' && !Array.isArray(d.endpoints) && typeof d.port !== 'number') {
          return { ok: false, ms: null, reason: 'unreachable', data: null };
        }
        const ms = Math.max(1, Math.round(nowPerfMs() - t0));
        return { ok: true, ms, reason: 'ok', data: d };
      } catch {
        return { ok: false, ms: null, reason: (isHttpsPage && epIsHttp) ? 'https_restricted' : 'unreachable', data: null };
      }
    }

    async function fetchServerProbeHints(force) {
      try {
        const url = (apiBase || '') + '/api/probe-hints?probe=1' + (force ? '&force=1' : '') + '&_t=' + Date.now();
        const r = await fetchWithTimeout(url, {
          headers: authHeaders({ 'X-AG-Probe': '1' }),
          cache: 'no-store'
        }, 2400);
        if (!r.ok) return null;
        const d = await r.json().catch(() => null);
        return (d && d.ok && d.hints && typeof d.hints === 'object') ? d.hints : null;
      } catch {
        return null;
      }
    }

    function mergeServerHintIntoProbe(res, serverHints, nowTs) {
      const sh = (!res.ok && serverHints && typeof serverHints === 'object') ? serverHints[res.kind] : null;
      if (sh && sh.ok && Number.isFinite(sh.ms)) {
        return {
          kind: res.kind,
          url: res.url,
          ok: true,
          ms: sh.ms,
          reason: 'server_hint',
          via: 'server',
          data: res.data || null,
          testedAt: nowTs
        };
      }
      if (sh && sh.ok === false && sh.reason === 'unreachable') {
        return {
          kind: res.kind,
          url: res.url,
          ok: false,
          ms: null,
          reason: 'unreachable',
          via: 'server',
          data: null,
          testedAt: nowTs
        };
      }
      return {
        kind: res.kind,
        url: res.url,
        ok: Boolean(res.ok),
        ms: res.ok && Number.isFinite(res.ms) ? res.ms : null,
        reason: res.reason || (res.ok ? 'ok' : 'unreachable'),
        via: String(res.via || ''),
        data: res.data || null,
        testedAt: res.testedAt || nowTs
      };
    }

    async function probeEndpointLatency(ep, timeoutMs) {
      const tMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 1500;
      const p1 = await probeEndpointOnce(ep, tMs);
      if (!p1.ok) {
        return {
          kind: ep.kind,
          url: ep.url,
          ok: false,
          ms: null,
          reason: p1.reason || 'unreachable',
          data: null,
          testedAt: Date.now()
        };
      }
      let bestMs = p1.ms;
      let latestData = p1.data;
      if (p1.ms < 900) {
        const p2 = await probeEndpointOnce(ep, Math.min(700, tMs));
        if (p2.ok && Number.isFinite(p2.ms)) {
          bestMs = Math.min(bestMs, p2.ms);
          if (p2.data) latestData = p2.data;
        }
      }
      return {
        kind: ep.kind,
        url: ep.url,
        ok: true,
        ms: bestMs,
        reason: 'ok',
        data: latestData,
        testedAt: Date.now()
      };
    }

    function pickFastestReachable(resultsMap, entries) {
      const order = { lan: 0, tailscale: 1, bonjour: 2, tunnel: 3, loopback: 9 };
      const list = [];
      for (const ep of (entries || [])) {
        if (!ep || !ep.kind) continue;
        const r = resultsMap && resultsMap[ep.kind];
        if (r && r.ok && Number.isFinite(r.ms)) {
          list.push({ kind: ep.kind, url: r.url || ep.url, ms: r.ms, data: r.data || null });
        }
      }
      list.sort((a, b) => (a.ms - b.ms) || ((order[a.kind] ?? 5) - (order[b.kind] ?? 5)));
      return list;
    }

    let navigatingAwayTimer = null;
    function resetNavigationGuard(resumePoll) {
      const wasNavigating = navigatingAway;
      navigatingAway = false;
      clearTimeout(navigatingAwayTimer);
      navigatingAwayTimer = null;
      if (resumePoll && wasNavigating && !document.hidden) {
        schedulePoll();
      }
    }
    function navigateEntryUrl(targetUrl, useReplace) {
      if (navigatingAway) return;
      navigatingAway = true;
      clearTimeout(pollTimer);
      clearTimeout(navigatingAwayTimer);
      navigatingAwayTimer = setTimeout(() => {
        resetNavigationGuard(true);
      }, 6000);
      if (useReplace && typeof location.replace === 'function') {
        location.replace(targetUrl);
      } else {
        location.href = targetUrl;
      }
    }
    try {
      window.addEventListener('pageshow', () => {
        resetNavigationGuard(true);
      });
    } catch {}

    let speedTestBusy = null;
    async function runSpeedTest(opts) {
      const o = opts || {};
      const wantAutoSwitch = Boolean(o.autoSwitch);
      const silent = Boolean(o.silent);
      if (speedTestBusy) {
        await speedTestBusy;
        return speedTestState;
      }
      speedTestBusy = (async () => {
        const entries = getEnabledModeEntries();
        speedTestState.running = true;
        renderModeSwitcherSheet();
        if (!latestSnap) {
          renderModeEntryGate(
            isManualEntry
              ? ('正在通过 ' + getActiveChannelLabel() + ' 连接电脑端…')
              : '正在检测各可用通道速度，自动选择最快通道…'
          );
        }
        const needServerHints = location.protocol === 'https:'
          && entries.some((ep) => String(ep.url || '').toLowerCase().startsWith('http://'));
        const [probed, serverHints] = await Promise.all([
          Promise.all(entries.map((ep) => probeEndpointLatency(ep, o.timeoutMs || 1500))),
          needServerHints ? fetchServerProbeHints(!silent) : Promise.resolve(null)
        ]);
        const nextResults = {};
        let refreshedMeta = false;
        const nowTs = Date.now();
        for (const res of probed) {
          if (!res || !res.kind) continue;
          const merged = mergeServerHintIntoProbe(res, serverHints, nowTs);
          nextResults[merged.kind] = {
            ok: merged.ok,
            ms: merged.ms,
            reason: merged.reason,
            via: merged.via,
            url: merged.url,
            testedAt: merged.testedAt
          };
          if (res.data && Array.isArray(res.data.endpoints) && res.data.endpoints.length) {
            pairState.endpoints = res.data.endpoints;
            if (Array.isArray(res.data.hosts)) pairState.hosts = res.data.hosts;
            refreshedMeta = true;
          }
        }
        if (refreshedMeta) saveStoredPair(pairState);
        speedTestState = {
          running: false,
          testedAt: Date.now(),
          results: nextResults
        };
        saveStoredSpeed(speedTestState);
        renderModeSwitcherSheet();

        const ranked = pickFastestReachable(nextResults, entries);
        const best = ranked[0] || null;
        if (!silent) {
          if (best) {
            showToast('⚡ 测速完成：' + formatKindLabel(best.kind) + ' 最快 (' + best.ms + ' ms)');
          } else {
            showToast('测速未连通，请检查当前网络');
          }
        }

        const pageOrigin = String(location.origin || '').replace(/\\/+$/, '');
        const curOrigin = String(apiBase || pageOrigin).replace(/\\/+$/, '');
        const curKind = detectKindFromOrigin(curOrigin);
        const exactCurRes = Object.values(nextResults).find((r) => r && r.url === curOrigin) || null;
        const kindRes = nextResults[curKind] || null;
        const curRes = exactCurRes || (kindRes && kindRes.url === curOrigin ? kindRes : null);
        const curReachable = Boolean((curRes && curRes.ok) || (!curRes && (isTrustedSecureOrigin(pageOrigin) || isStandalonePwa)));
        const switchOrigin = isTrustedSecureOrigin(pageOrigin) ? pageOrigin : curOrigin;
        const eligibleRanked = curReachable
          ? ranked.filter((ep) => ep && !shouldBlockInsecureDowngrade(switchOrigin, ep.url, isStandalonePwa))
          : ranked;
        const switchBest = eligibleRanked[0] || null;

        if (wantAutoSwitch && !manualLocked && !isAutoSwitched && switchBest) {
          const sameEntry = switchBest.url === curOrigin || switchBest.kind === curKind;
          const downgradeBlocked = Boolean(curReachable && shouldBlockInsecureDowngrade(switchOrigin, switchBest.url, isStandalonePwa));
          const significantlyFaster = !curReachable
            || (curRes && curRes.ok && curKind === 'tunnel' && switchBest.kind !== 'tunnel' && (!curRes.ms || switchBest.ms < curRes.ms))
            || (curRes && curRes.ok && Number.isFinite(curRes.ms) && (curRes.ms - switchBest.ms >= 15) && switchBest.ms <= curRes.ms * 0.75);
          if (!sameEntry && !downgradeBlocked && significantlyFaster) {
            if (activeSnapAbort) {
              try { activeSnapAbort.abort(); } catch {}
              activeSnapAbort = null;
            }
            clearTimeout(pollTimer);
            const targetUrl = buildClientEntryUrl(switchBest.url, { autoSwitched: true });
            navigateEntryUrl(targetUrl, true);
            return speedTestState;
          }
        }

        if (!latestSnap) {
          renderModeEntryGate(
            isManualEntry
              ? ('正在通过 ' + getActiveChannelLabel() + ' 连接电脑端…')
              : (best ? ('最快通道：' + formatKindLabel(best.kind) + ' (' + best.ms + ' ms)，可直接点击进入：') : '当前入口暂未连通，请点击下方已开启的连接方式直接进入：')
          );
        }
        return speedTestState;
      })();
      try {
        return await speedTestBusy;
      } finally {
        speedTestBusy = null;
      }
    }

    let failoverBusy = null;
    async function tryFailoverEndpoint() {
      if (failoverBusy) return failoverBusy;
      failoverBusy = (async () => {
        const entries = getEnabledModeEntries();
        const extra = [];
        const seenUrls = new Set(entries.map((e) => e.url));
        for (const ep of (pairState.endpoints || [])) {
          const clean = String(ep?.url || '').replace(/\\/+$/, '');
          if (clean && !seenUrls.has(clean)) {
            seenUrls.add(clean);
            extra.push({ url: clean, kind: ep.kind || detectKindFromOrigin(clean) });
          }
        }
        const candidates = entries.concat(extra);
        if (candidates.length <= 1 && !apiBase) return false;
        const needServerHints = location.protocol === 'https:'
          && candidates.some((ep) => String(ep.url || '').toLowerCase().startsWith('http://'));
        const [probed, serverHints] = await Promise.all([
          Promise.all(candidates.map((ep) => probeEndpointLatency(ep, 1600))),
          needServerHints ? fetchServerProbeHints(true) : Promise.resolve(null)
        ]);
        const nextResults = Object.assign({}, speedTestState.results || {});
        const nowTs = Date.now();
        const mergedList = [];
        for (const res of probed) {
          if (!res || !res.kind) continue;
          const merged = mergeServerHintIntoProbe(res, serverHints, nowTs);
          mergedList.push(merged);
          if (merged.ok || !nextResults[merged.kind]) {
            nextResults[merged.kind] = {
              ok: merged.ok,
              ms: merged.ms,
              reason: merged.reason,
              via: merged.via,
              url: merged.url,
              testedAt: merged.testedAt
            };
          }
        }
        speedTestState = { running: false, testedAt: Date.now(), results: nextResults };
        saveStoredSpeed(speedTestState);
        renderModeSwitcherSheet();

        const order = { lan: 0, tailscale: 1, bonjour: 2, tunnel: 3, loopback: 9 };
        const curOriginFail = String(location.origin || '').replace(/\\/+$/, '');
        const winners = mergedList
          .filter((r) => r && r.ok && Number.isFinite(r.ms))
          .sort((a, b) => {
            const aBlock = shouldBlockInsecureDowngrade(curOriginFail, a.url, isStandalonePwa) ? 1 : 0;
            const bBlock = shouldBlockInsecureDowngrade(curOriginFail, b.url, isStandalonePwa) ? 1 : 0;
            if (aBlock !== bBlock) return aBlock - bBlock;
            return (a.ms - b.ms) || ((order[a.kind] ?? 5) - (order[b.kind] ?? 5));
          });
        const winner = winners[0] || null;
        if (!winner) return false;

        if (Array.isArray(winner.data?.endpoints) && winner.data.endpoints.length) {
          pairState.endpoints = winner.data.endpoints;
          if (Array.isArray(winner.data.hosts)) pairState.hosts = winner.data.hosts;
          saveStoredPair(pairState);
        }
        if (winner.url !== curOriginFail && shouldBlockInsecureDowngrade(curOriginFail, winner.url, isStandalonePwa)) {
          return false;
        }
        if (location.protocol === 'https:' && winner.url.toLowerCase().startsWith('http://')) {
          navigateEntryUrl(buildClientEntryUrl(winner.url, { autoSwitched: true }), true);
          return true;
        }
        const nextBase = winner.url === String(location.origin || '').replace(/\\/+$/, '') ? '' : winner.url;
        const changed = nextBase !== apiBase;
        apiBase = nextBase;
        if (changed) {
          showToast('已自动切至最快通道：' + formatKindLabel(winner.kind) + ' (' + winner.ms + ' ms)');
        }
        return true;
      })();
      try {
        return await failoverBusy;
      } finally {
        failoverBusy = null;
      }
    }

    function getActiveChannelLabel() {
      return formatKindLabel(detectKindFromOrigin(apiBase || location.origin || ''));
    }

    function rankModeEntry(ep) {
      const k = String(ep?.kind || '');
      const u = String(ep?.url || '').toLowerCase();
      if (k === 'tunnel' && !u.includes('.trycloudflare.com')) return 0;
      if (k === 'tailscale' && u.startsWith('https://')) return 1;
      if (k === 'lan') return 2;
      if (k === 'tailscale') return 3;
      if (k === 'bonjour') return 4;
      if (k === 'tunnel') return 5;
      if (k === 'loopback') return 9;
      return 6;
    }

    function getEnabledModeEntries() {
      const byKind = new Map();
      const sorted = [...(pairState.endpoints || [])].sort((a, b) => (Number(a?.priority) || 999) - (Number(b?.priority) || 999));
      const curOriginClean = String(location.origin || '').replace(/\\/+$/, '');
      const curOriginKind = detectKindFromOrigin(curOriginClean);
      for (const ep of sorted) {
        if (!ep || !ep.url) continue;
        const k = ep.kind || detectKindFromOrigin(ep.url);
        if (k === 'loopback' && sorted.length > 1 && curOriginKind !== 'loopback') continue;
        if (!byKind.has(k)) {
          byKind.set(k, { url: String(ep.url).replace(/\\/+$/, ''), kind: k });
        }
      }
      if (curOriginKind === 'loopback' && curOriginClean && !byKind.has('loopback')) {
        byKind.set('loopback', { url: curOriginClean, kind: 'loopback' });
      }
      if (byKind.size === 0) {
        const curKind = detectKindFromOrigin(location.origin);
        byKind.set(curKind, { url: String(location.origin || '').replace(/\\/+$/, ''), kind: curKind });
      }
      return Array.from(byKind.values()).sort((a, b) => rankModeEntry(a) - rankModeEntry(b));
    }

    function formatClockTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }

    function formatLatencyBadge(kind) {
      if (speedTestState.running) {
        return { cls: 'pending', html: '<span class="mini-spin"></span><span>测速中</span>' };
      }
      const r = speedTestState.results ? speedTestState.results[kind] : null;
      if (!r) return { cls: 'muted', html: '未测速' };
      if (r.ok && Number.isFinite(r.ms)) {
        const cls = r.ms < 80 ? 'fast' : (r.ms <= 250 ? 'mid' : 'slow');
        return { cls, html: esc(r.ms + ' ms') };
      }
      if (r.reason === 'https_restricted') return { cls: 'muted', html: '点击切直连' };
      if (r.reason === 'disabled') return { cls: 'err', html: '已停用' };
      return { cls: 'err', html: '不可达' };
    }

    function buildClientEntryUrl(targetBaseUrl, opts) {
      const o = opts || {};
      const cleanBase = String(targetBaseUrl || '').replace(/\\/+$/, '');
      const params = [];
      if (pairState.token) params.push('token=' + encodeURIComponent(pairState.token));
      if (pairState.name) params.push('name=' + encodeURIComponent(pairState.name));
      if (deviceId) params.push('did=' + encodeURIComponent(deviceId));
      if (o.autoSwitched && clientId) params.push('bcid=' + encodeURIComponent(clientId));
      if (pairState.hosts?.length) params.push('hosts=' + encodeURIComponent(pairState.hosts.join(',')));
      const encEps = encodeEndpointsClient(pairState.endpoints || []);
      if (encEps) params.push('endpoints=' + encodeURIComponent(encEps));
      if (!o.omitSpeed) {
        const encSpd = encodeSpeedTestClient(speedTestState);
        if (encSpd) params.push('spd=' + encodeURIComponent(encSpd));
      }
      if (o.autoSwitched) {
        params.push('autosw=1');
      } else if (o.manual !== false) {
        params.push('manual=1');
      }
      return cleanBase + '/?' + params.join('&');
    }

    function enterConnectionMode(ep) {
      if (!ep || !ep.url) return;
      manualLocked = true;
      try { sessionStorage.setItem(MANUAL_LOCK_SESSION_KEY, '1'); } catch {}
      if (activeSnapAbort) {
        try { activeSnapAbort.abort(); } catch {}
        activeSnapAbort = null;
      }
      clearTimeout(pollTimer);
      saveStoredPair(pairState);
      const cleanTarget = String(ep.url).replace(/\\/+$/, '');
      const cleanCur = String(location.origin || '').replace(/\\/+$/, '');
      if (cleanTarget === cleanCur) {
        apiBase = '';
        const modeName = formatKindLabel(ep.kind);
        $('sub-meta').textContent = '正在通过 ' + modeName + ' 连接…';
        syncChannelPillUi('connecting');
        if (latestSnap) {
          showToast('已切换至 ' + modeName);
        } else {
          renderModeEntryGate('正在通过 ' + modeName + ' 连接电脑端…');
        }
        void fetchSnapshot();
        return;
      }
      const isCrossProtocolDowngrade = location.protocol === 'https:' && cleanTarget.toLowerCase().startsWith('http://');
      navigateEntryUrl(buildClientEntryUrl(cleanTarget, { manual: true, omitSpeed: isCrossProtocolDowngrade }), false);
    }

    function renderModeEntryGate(statusText) {
      if (latestSnap) return;
      const entries = getEnabledModeEntries();
      const curOrigin = String(apiBase || location.origin || '').replace(/\\/+$/, '');
      const ranked = pickFastestReachable(speedTestState.results, entries);
      const fastestKind = (entries.length > 1 && ranked.length > 0) ? ranked[0].kind : '';
      const btnsHtml = entries.map((ep, idx) => {
        let hostText = ep.url;
        try { hostText = new URL(ep.url).host; } catch {}
        const isCurrent = ep.url === curOrigin;
        const badge = formatLatencyBadge(ep.kind);
        const fastPill = (fastestKind && ep.kind === fastestKind) ? ' <span class="mode-pill fast">最快</span>' : '';
        return '<button class="mode-entry-btn' + (isCurrent ? ' active' : '') + '" data-mode-idx="' + idx + '" type="button">'
          + '<span class="mode-entry-left">'
          + '<span class="mode-entry-name">' + esc(formatKindLabel(ep.kind)) + fastPill + '</span>'
          + '<span class="mode-entry-host">' + esc(hostText) + '</span>'
          + '</span>'
          + '<span class="mode-entry-right">'
          + '<span class="lat-badge ' + badge.cls + '">' + badge.html + '</span>'
          + '<span class="mode-entry-tag">' + (isCurrent ? '当前 →' : '进入 →') + '</span>'
          + '</span>'
          + '</button>';
      }).join('');
      msgEl.innerHTML = '<div id="mode-entry-panel" class="mode-entry-card">'
        + '<div id="mode-entry-status" class="mode-entry-title">' + esc(statusText || '请选择或等待连接方式进入：') + '</div>'
        + '<div class="mode-entry-list">' + btnsHtml + '</div>'
        + '</div>';
      msgEl.querySelectorAll('.mode-entry-btn').forEach((btn) => {
        btn.onclick = () => {
          const ep = entries[Number(btn.dataset.modeIdx)];
          if (ep) enterConnectionMode(ep);
        };
      });
    }

    function configureSheetChrome(cfg) {
      const c = cfg || {};
      activeSheetKind = c.kind || '';
      $('sheet-title-text').textContent = c.title || '选择选项';
      const subEl = $('sheet-sub-text');
      if (subEl) {
        if (c.subText) {
          subEl.hidden = false;
          subEl.textContent = c.subText;
        } else {
          subEl.hidden = true;
          subEl.textContent = '';
        }
      }
      const backBtn = $('sheet-back-btn');
      if (backBtn) {
        if (typeof c.onBack === 'function') {
          backBtn.hidden = false;
          backBtn.onclick = (ev) => {
            ev?.stopPropagation?.();
            c.onBack();
          };
        } else {
          backBtn.hidden = true;
          backBtn.onclick = null;
        }
      }
      const actBtn = $('sheet-action-btn');
      if (actBtn) {
        if (c.showSpeed) {
          actBtn.hidden = false;
          actBtn.disabled = Boolean(c.speedDisabled);
          actBtn.innerHTML = c.speedHtml || '⚡ 测速';
          actBtn.onclick = typeof c.onSpeedClick === 'function' ? c.onSpeedClick : null;
        } else {
          actBtn.hidden = true;
          actBtn.disabled = false;
          actBtn.onclick = null;
        }
      }
    }

    function closeSheet() {
      activeSheetKind = '';
      activeSheetState = null;
      const backBtn = $('sheet-back-btn');
      if (backBtn) {
        backBtn.hidden = true;
        backBtn.onclick = null;
      }
      const actBtn = $('sheet-action-btn');
      if (actBtn) {
        actBtn.hidden = true;
        actBtn.disabled = false;
        actBtn.onclick = null;
      }
      const listEl = $('sheet-list');
      if (listEl && typeof handleSheetListClick === 'function') {
        listEl.onclick = handleSheetListClick;
      }
      const backdrop = $('sheet-backdrop');
      if (backdrop && backdrop.contains(document.activeElement)) {
        try { document.activeElement.blur(); } catch {}
      }
      if (backdrop) backdrop.hidden = true;
      if (typeof resetModalSheetShift === 'function') resetModalSheetShift();
      if (typeof syncViewportHeight === 'function') syncViewportHeight();
    }

    function renderModeSwitcherSheet() {
      const backdrop = $('sheet-backdrop');
      if (!backdrop || backdrop.hidden || activeSheetKind !== 'mode') return;
      const entries = getEnabledModeEntries();
      const curOrigin = String(apiBase || location.origin || '').replace(/\\/+$/, '');
      const ranked = pickFastestReachable(speedTestState.results, entries);
      const fastestKind = (entries.length > 1 && ranked.length > 0) ? ranked[0].kind : '';

      const subMsg = speedTestState.running
        ? '⏳ 正在检测各通道延迟…'
        : (speedTestState.testedAt > 0
            ? ('最近测速 ' + formatClockTime(speedTestState.testedAt) + ' · 延迟仅供参考')
            : '尚未测速 · 点击右侧「测速」获取延迟参考');

      configureSheetChrome({
        kind: 'mode',
        title: '切换连接方式',
        subText: subMsg,
        showSpeed: true,
        speedDisabled: Boolean(speedTestState.running),
        speedHtml: speedTestState.running ? '<span class="mini-spin"></span><span>测速中…</span>' : '⚡ 测速',
        onSpeedClick: (ev) => {
          ev.stopPropagation();
          void runSpeedTest({ autoSwitch: false, silent: false });
        },
        onBack: null
      });

      const listEl = $('sheet-list');
      let hasQuickTunnel = false;
      const rowsHtml = entries.map((ep, idx) => {
        let hostText = ep.url;
        try { hostText = new URL(ep.url).host; } catch {}
        const isCurrent = ep.url === curOrigin;
        const isQuickTunnelEp = ep.kind === 'tunnel' && String(hostText || '').toLowerCase().endsWith('.trycloudflare.com');
        if (isQuickTunnelEp) hasQuickTunnel = true;
        const badge = formatLatencyBadge(ep.kind);
        const pills = ((fastestKind && ep.kind === fastestKind) ? '<span class="mode-pill fast">最快</span>' : '')
          + (isCurrent ? '<span class="mode-pill cur">当前</span>' : '')
          + (isQuickTunnelEp ? '<span class="mode-pill warn">临时域名</span>' : '');
        return '<button class="sheet-opt' + (isCurrent ? ' active' : '') + '" data-idx="' + idx + '" type="button">'
          + '<span class="sheet-opt-left">'
          + '<span class="sheet-opt-top"><span>' + esc(formatKindLabel(ep.kind)) + '</span>' + pills + '</span>'
          + '<span class="sheet-opt-host">' + esc(hostText) + '</span>'
          + '</span>'
          + '<span class="sheet-opt-right">'
          + '<span class="lat-badge ' + badge.cls + '">' + badge.html + '</span>'
          + (isCurrent ? '<span>✓</span>' : '')
          + '</span>'
          + '</button>';
      }).join('');
      const footNoteHtml = hasQuickTunnel
        ? '<div class="sheet-foot-note">提示：.trycloudflare.com 为免登录一次性临时域名，电脑热更新、重启或休眠断网后旧网址会永久失效并换新；长期使用建议优先选 Tailscale HTTPS、局域网或自定义固定域名。</div>'
        : '';
      listEl.innerHTML = rowsHtml + footNoteHtml;
      listEl.onclick = (e) => {
        const btn = e.target?.closest?.('.sheet-opt');
        if (!btn) return;
        const ep = entries[Number(btn.dataset.idx)];
        closeSheet();
        if (ep) enterConnectionMode(ep);
      };
    }

    function formatShortChannelLabel(rawUrl) {
      const u = String(rawUrl || '').trim().toLowerCase();
      const k = detectKindFromOrigin(u);
      if (k === 'tailscale') return u.startsWith('https://') ? 'TS HTTPS' : 'Tailscale';
      if (k === 'tunnel') return '隧道';
      if (k === 'bonjour') return 'Bonjour';
      return '局域网';
    }

    function syncChannelPillUi(state) {
      const btn = $('btn-channel-pill');
      const lbl = $('channel-pill-label');
      if (!btn || !lbl) return;
      const st = state || (latestSnap ? 'online' : 'connecting');
      btn.classList?.toggle?.('is-offline', st === 'offline');
      btn.classList?.toggle?.('is-connecting', st === 'connecting');
      const curOrigin = apiBase || location.origin || '';
      if (st === 'offline') {
        lbl.textContent = '切通道';
        btn.title = '连接已断开，点击切换连接方式';
        btn.setAttribute?.('aria-label', '连接已断开，点击切换连接方式');
      } else if (st === 'connecting') {
        lbl.textContent = '连接中';
        btn.title = '正在连接，点击切换连接方式 (' + formatKindLabel(detectKindFromOrigin(curOrigin)) + ')';
        btn.setAttribute?.('aria-label', '切换连接方式');
      } else {
        const shortName = formatShortChannelLabel(curOrigin);
        lbl.textContent = shortName;
        btn.title = '当前通道：' + formatKindLabel(detectKindFromOrigin(curOrigin)) + '，点击切换';
        btn.setAttribute?.('aria-label', '当前通道：' + shortName + '，点击切换');
      }
    }

    function pickDirectFallbackHintEndpoint() {
      const curOrigin = String(apiBase || location.origin || '').replace(/\\/+$/, '');
      const entries = getEnabledModeEntries().filter((ep) => ep && ep.url && ep.url !== curOrigin);
      if (!entries.length) return null;
      const rank = (ep) => {
        const u = String(ep.url || '').toLowerCase();
        if (ep.kind === 'tailscale' && u.startsWith('https://')) return 0;
        if (ep.kind === 'lan') return 1;
        if (ep.kind === 'tailscale') return 2;
        if (ep.kind === 'bonjour') return 3;
        return 9;
      };
      entries.sort((a, b) => rank(a) - rank(b));
      const best = entries[0];
      return best && best.kind !== 'tunnel' ? best : null;
    }

    function openModeSwitcherSheet() {
      closeTopDrawers();
      const entries = getEnabledModeEntries();
      if (!entries.length) return;
      activeSheetKind = 'mode';
      $('sheet-backdrop').hidden = false;
      renderModeSwitcherSheet();
      if (speedTestState.testedAt === 0 && !speedTestState.running) {
        void runSpeedTest({ autoSwitch: false, silent: true });
      }
    }

    $('sub-meta').textContent = '正在连接 · ' + getActiveChannelLabel();
    $('sub-meta').onclick = openModeSwitcherSheet;
    syncChannelPillUi('connecting');
    if ($('btn-channel-pill')) {
      $('btn-channel-pill').onclick = () => {
        closeTopDrawers();
        openModeSwitcherSheet();
      };
    }
    if ($('btn-mode-switcher')) {
      $('btn-mode-switcher').addEventListener('click', () => {
        if (!isDesktopLayout()) closeDrawer();
        openModeSwitcherSheet();
      });
    }

    const appEl = document.querySelector('.app');
    let isStandalonePwa = false;
    try {
      isStandalonePwa = Boolean(
        window.navigator?.standalone === true ||
        (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
      );
      document.body?.classList?.toggle?.('is-standalone', isStandalonePwa);
    } catch {}

    function getLogicalScreenHeight() {
      const scr = typeof window !== 'undefined' ? window.screen : null;
      const sw = Number(scr && scr.width) || 0;
      const sh = Number(scr && scr.height) || 0;
      if (!sw || !sh) return 0;
      const isLandscape = (window.innerWidth || 0) > (window.innerHeight || 0);
      return isLandscape ? Math.min(sw, sh) : Math.max(sw, sh);
    }

    function measureSafeAreaInsetTop() {
      try {
        if (!appEl || typeof window.getComputedStyle !== 'function') return 0;
        return parseFloat(window.getComputedStyle(appEl).paddingTop) || 0;
      } catch {
        return 0;
      }
    }

    function computeLegacyStandaloneFullHeight(curH, kbOpen) {
      if (!isStandalonePwa || kbOpen) return 0;
      const safeTop = measureSafeAreaInsetTop();
      if (!(safeTop > 20)) return 0;
      const screenH = getLogicalScreenHeight();
      const winH = Number(window.innerHeight || curH || 0);
      if (!(screenH > winH)) return 0;
      const diff = screenH - winH;
      // 兼容旧版已固化 black-translucent 的 iOS 桌面图标：视口短缺约等于顶部状态栏高度（误差 <= 8px）时补偿至真实屏幕高度
      if (Math.abs(diff - safeTop) <= 8) {
        return Math.round(screenH);
      }
      return 0;
    }

    function getFullLayoutHeight() {
      const vvH = window.visualViewport ? window.visualViewport.height : 0;
      const winH = window.innerHeight || 0;
      const docH = document.documentElement?.clientHeight || 0;
      if (isStandalonePwa) {
        return Math.round(Math.max(vvH, winH, docH));
      }
      return Math.round(vvH || winH || docH);
    }

    let maxVvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    let lockedModalBaseH = getFullLayoutHeight();
    let lastLayoutWidth = window.innerWidth || 0;
    let lastTextBlurAt = 0;
    let activeShiftedSheet = null;
    let activeModalSheetShiftY = 0;
    let activeSheetLockedHeight = 0;
    let activeScrolledModalBody = null;
    let activeModalBodyScrollY = 0;
    let viewportSyncTimers = [];

    const desktopMq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width:860px) and (min-height:521px) and (hover:hover) and (pointer:fine)')
      : null;
    const isDesktopLayout = () => {
      if (desktopMq) return desktopMq.matches;
      const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer:fine)').matches;
      return window.innerWidth >= 860 && window.innerHeight > 520 && (fine || Number(navigator.maxTouchPoints || 0) <= 1);
    };

    function isTextEntryElement(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
      if (tag === 'INPUT') {
        const type = String(el.type || 'text').toLowerCase();
        if (['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type)) {
          return false;
        }
        return !el.disabled && !el.readOnly;
      }
      return Boolean(el.isContentEditable);
    }

    function getOpenModalBackdrop() {
      const projBackdrop = $('proj-modal-backdrop');
      if (projBackdrop && !projBackdrop.hidden) return projBackdrop;
      const sheetBackdrop = $('sheet-backdrop');
      if (sheetBackdrop && !sheetBackdrop.hidden) return sheetBackdrop;
      return null;
    }

    function clearScrollBodyOffset(bodyEl) {
      if (!bodyEl) return;
      // 仅移除临时 paddingBottom，保留 bodyEl.scrollTop 避免把用户手动滚动定位的已填输入框滚出视野
      bodyEl.style.paddingBottom = '';
    }

    function resetModalSheetShift() {
      if (activeShiftedSheet) {
        activeShiftedSheet.style.transform = '';
        activeShiftedSheet.style.height = '';
      }
      clearScrollBodyOffset(activeScrolledModalBody);
      const openBackdrop = getOpenModalBackdrop();
      const sheetEl = openBackdrop?.querySelector?.('.sheet');
      if (sheetEl) {
        if (sheetEl !== activeShiftedSheet) {
          sheetEl.style.transform = '';
          sheetEl.style.height = '';
        }
        const bodyEl = sheetEl.querySelector?.('.proj-modal-body');
        if (bodyEl && bodyEl !== activeScrolledModalBody) {
          clearScrollBodyOffset(bodyEl);
        }
      }
      activeShiftedSheet = null;
      activeModalSheetShiftY = 0;
      activeSheetLockedHeight = 0;
      activeScrolledModalBody = null;
      activeModalBodyScrollY = 0;
    }

    function computeModalSheetShiftY(metrics) {
      const rawTop = Number(metrics?.rawTop);
      const rawBottom = Number(metrics?.rawBottom);
      const sheetRawTop = metrics?.sheetRawTop !== undefined && metrics?.sheetRawTop !== null
        ? Number(metrics.sheetRawTop)
        : null;
      const vvTop = Number(metrics?.vvTop) || 0;
      const vvHeight = Number(metrics?.vvHeight) || 0;
      const safeTopGap = Number.isFinite(metrics?.safeTopGap) ? Number(metrics.safeTopGap) : 12;
      const safeBottomGap = Number.isFinite(metrics?.safeBottomGap) ? Number(metrics.safeBottomGap) : 14;
      const hasScrollBody = Boolean(metrics?.hasScrollBody);
      if (!Number.isFinite(rawTop) || !Number.isFinite(rawBottom) || !(vvHeight > 0)) return 0;

      const vvBottom = vvTop + vvHeight;
      const minTop = vvTop + safeTopGap;
      const maxBottom = vvBottom - safeBottomGap;
      const hasSheetTop = sheetRawTop !== null && Number.isFinite(sheetRawTop);
      const sheetTopOk = (!hasSheetTop || vvTop <= 0) ? true : (sheetRawTop >= minTop);

      // 只要聚焦输入框和弹窗顶边（在正向视觉偏移下）均已完整处于可视安全区内，严格禁止任何位移
      if (rawBottom <= maxBottom && rawTop >= minTop && sheetTopOk) return 0;

      const minShiftForSheetTop = hasSheetTop ? Math.ceil(minTop - sheetRawTop) : -Infinity;
      const minShiftForInputTop = Math.ceil(minTop - rawTop);
      const maxShiftForInputBottom = Math.floor(maxBottom - rawBottom);

      if (hasScrollBody) {
        if (rawBottom > maxBottom && minShiftForSheetTop <= 0) {
          return Math.max(maxShiftForInputBottom, minShiftForSheetTop);
        }
        const needDownShift = Math.max(0, hasSheetTop ? minShiftForSheetTop : 0, minShiftForInputTop);
        if (needDownShift > 0) return needDownShift;
        return Math.max(maxShiftForInputBottom, minShiftForSheetTop);
      }

      if (rawBottom > maxBottom) {
        return Math.max(maxShiftForInputBottom, minShiftForSheetTop, minShiftForInputTop);
      }
      const downTarget = Math.max(0, hasSheetTop ? minShiftForSheetTop : 0, minShiftForInputTop);
      return Math.max(minShiftForInputTop, Math.min(downTarget, Math.max(0, maxShiftForInputBottom)));
    }

    function syncModalKeyboardOffset() {
      const openBackdrop = getOpenModalBackdrop();
      const activeEl = document.activeElement;
      if (!openBackdrop || isDesktopLayout() || !isTextEntryElement(activeEl) || !openBackdrop.contains(activeEl)) {
        resetModalSheetShift();
        return;
      }
      const sheetEl = openBackdrop.querySelector('.sheet');
      if (!sheetEl || typeof activeEl.getBoundingClientRect !== 'function' || typeof sheetEl.getBoundingClientRect !== 'function') {
        resetModalSheetShift();
        return;
      }
      if (activeShiftedSheet && activeShiftedSheet !== sheetEl) {
        resetModalSheetShift();
      }
      const vv = window.visualViewport;
      const vvTop = vv ? (Number(vv.offsetTop) || 0) : 0;
      const vvHeight = vv ? (Number(vv.height) || window.innerHeight || 0) : (window.innerHeight || 0);
      const baseH = Math.max(maxVvHeight || 0, lockedModalBaseH || 0, window.innerHeight || 0);
      const kbLikelyOpen = Boolean(vv && ((baseH - vvHeight > 60) || vvTop > 2));
      if (!kbLikelyOpen) {
        resetModalSheetShift();
        return;
      }

      const scrollBody = sheetEl.querySelector('.proj-modal-body') || sheetEl.querySelector('.sheet-list') || null;
      const hasScrollBody = Boolean(scrollBody && scrollBody.contains(activeEl));
      const appliedShift = activeShiftedSheet === sheetEl ? activeModalSheetShiftY : 0;
      // 仅补偿本逻辑自身施加的滚动增量（activeModalBodyScrollY），不得叠加用户手动下滑的 scrollTop 导致偏移过大
      const bodyScroll = (hasScrollBody && activeScrolledModalBody === scrollBody) ? (Number(activeModalBodyScrollY) || 0) : 0;
      const sheetRect = sheetEl.getBoundingClientRect();
      const bodyRect = scrollBody && typeof scrollBody.getBoundingClientRect === 'function' ? scrollBody.getBoundingClientRect() : null;
      const rect = activeEl.getBoundingClientRect();

      const sheetRawTop = sheetRect.top - appliedShift;
      const sheetRawHeight = (activeShiftedSheet === sheetEl && activeSheetLockedHeight > 0) ? activeSheetLockedHeight : sheetRect.height;
      const bodyRawTop = bodyRect ? (bodyRect.top - appliedShift) : sheetRawTop;
      const rawTop = rect.top - appliedShift + bodyScroll;
      const rawBottom = rect.bottom - appliedShift + bodyScroll;
      const minTop = vvTop + 12;
      const maxBottom = vvTop + vvHeight - 14;
      const sheetTopOk = vvTop <= 0 ? true : (sheetRawTop >= minTop);

      if (rawBottom <= maxBottom && rawTop >= minTop && sheetTopOk) {
        resetModalSheetShift();
        return;
      }

      if (vvTop > 0 && (rawTop < minTop || !sheetTopOk) && typeof window.scrollTo === 'function') {
        try { window.scrollTo(0, 0); } catch {}
      }

      const nextShift = computeModalSheetShiftY({
        rawTop,
        rawBottom,
        sheetRawTop,
        vvTop,
        vvHeight,
        safeTopGap: 12,
        safeBottomGap: 14,
        hasScrollBody
      });

      const remainingOverlap = Math.max(0, Math.ceil((rawBottom + nextShift) - maxBottom));
      sheetEl.style.transform = nextShift ? ('translateY(' + nextShift + 'px)') : '';

      if (remainingOverlap > 0 && hasScrollBody) {
        if (sheetRawHeight > 0) {
          sheetEl.style.height = sheetRawHeight + 'px';
          activeSheetLockedHeight = sheetRawHeight;
        }
        const maxBodyScroll = Math.max(0, Math.floor(rawTop - bodyRawTop - 4));
        const targetScroll = Math.max(0, Math.min(remainingOverlap, maxBodyScroll));
        const prevApplied = activeScrolledModalBody === scrollBody ? (Number(activeModalBodyScrollY) || 0) : 0;
        const userBaseScroll = Math.max(0, (Number(scrollBody.scrollTop) || 0) - prevApplied);
        scrollBody.style.paddingBottom = (targetScroll + 28) + 'px';
        scrollBody.scrollTop = userBaseScroll + targetScroll;
        activeScrolledModalBody = scrollBody;
        activeModalBodyScrollY = targetScroll;
      } else {
        sheetEl.style.height = '';
        activeSheetLockedHeight = 0;
        clearScrollBodyOffset(activeScrolledModalBody);
        if (scrollBody && scrollBody !== activeScrolledModalBody) {
          clearScrollBodyOffset(scrollBody);
        }
        activeScrolledModalBody = null;
        activeModalBodyScrollY = 0;
      }

      activeShiftedSheet = (nextShift || remainingOverlap > 0) ? sheetEl : null;
      activeModalSheetShiftY = nextShift;
    }

    function syncViewportHeight() {
      const vv = window.visualViewport;
      const curH = vv ? vv.height : (window.innerHeight || document.documentElement?.clientHeight || 0);
      const curW = window.innerWidth || 0;
      const desktop = isDesktopLayout();
      const activeEl = document.activeElement;
      const anyTextFocused = isTextEntryElement(activeEl);
      const openModal = getOpenModalBackdrop();
      const isComposerFocused = !openModal && activeEl === $('input');

      const recentlyBlurred = (Date.now() - lastTextBlurAt) < 380;
      if (!anyTextFocused && Math.abs(curW - lastLayoutWidth) > 2) {
        lastLayoutWidth = curW;
        maxVvHeight = curH;
        lockedModalBaseH = Math.round(curH);
      } else if (!anyTextFocused && curH > maxVvHeight) {
        maxVvHeight = curH;
      } else if (!anyTextFocused && !openModal && !recentlyBlurred && Math.abs((window.innerHeight || curH) - curH) <= 2 && curH > 0) {
        // Safari 底部工具栏重新出现导致 innerHeight 与 visualViewport.height 同步回落时，同步收敛 maxVvHeight 避免残留底部死区
        maxVvHeight = curH;
      }

      const refFullH = Math.max(maxVvHeight || 0, window.innerHeight || 0, lockedModalBaseH || 0);
      const kbLikelyActive = Boolean(vv && ((refFullH - curH > 60) || ((Number(vv.offsetTop) || 0) > 2)));
      const legacyFullH = computeLegacyStandaloneFullHeight(curH, kbLikelyActive);
      const freezeModalShrink = !desktop && (anyTextFocused || kbLikelyActive || recentlyBlurred);
      const modalCandH = isStandalonePwa ? Math.max(getFullLayoutHeight(), legacyFullH) : Math.round(curH || 0);
      if (desktop || !freezeModalShrink || modalCandH >= lockedModalBaseH) {
        lockedModalBaseH = modalCandH;
      }
      const modalBaseH = Math.max(lockedModalBaseH || 0, modalCandH);
      document.documentElement.style.setProperty('--modal-h', modalBaseH + 'px');

      const baseH = Math.max(maxVvHeight || 0, window.innerHeight || 0);
      const kbOpenForComposer = Boolean(!desktop && !openModal && vv && (baseH - curH > 60) && (isComposerFocused || !anyTextFocused));
      if (kbOpenForComposer) {
        const top = vv.offsetTop || 0;
        document.documentElement.style.height = '';
        document.body.style.bottom = 'auto';
        document.body.style.height = Math.round(curH) + 'px';
        document.documentElement.style.setProperty('--app-h', Math.round(curH) + 'px');
        document.body.style.transform = top ? 'translateY(' + top + 'px)' : '';
        appEl?.classList.add('kb-open');
      } else {
        if (legacyFullH > 0) {
          // 填平旧版 black-translucent WebClip 底部被裁掉的 59pt 死区
          document.documentElement.style.height = legacyFullH + 'px';
          document.body.style.bottom = 'auto';
          document.body.style.height = legacyFullH + 'px';
          document.documentElement.style.setProperty('--app-h', legacyFullH + 'px');
        } else {
          document.documentElement.style.height = '';
          document.body.style.bottom = '0';
          // 普通浏览器与新版 iOS 独立 PWA 在无键盘及键盘收起时均清除内联 height，让 position:fixed;inset:0;height:auto 严格贴满物理底边
          document.body.style.height = '';
          const appHeightPx = (!desktop && openModal && (anyTextFocused || kbLikelyActive || recentlyBlurred))
            ? modalBaseH
            : getFullLayoutHeight();
          document.documentElement.style.setProperty('--app-h', appHeightPx + 'px');
        }
        document.body.style.transform = '';
        appEl?.classList.remove('kb-open');
      }
      syncModalKeyboardOffset();
      if (!openModal && stickBottom) msgEl.scrollTop = msgEl.scrollHeight;
    }

    function scheduleViewportSyncBurst() {
      for (const tid of viewportSyncTimers) clearTimeout(tid);
      viewportSyncTimers = [];
      for (const delay of [60, 180, 320]) {
        viewportSyncTimers.push(setTimeout(() => { syncViewportHeight(); }, delay));
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportHeight);
      window.visualViewport.addEventListener('scroll', syncViewportHeight);
    }
    window.addEventListener('resize', syncViewportHeight);
    document.addEventListener('focusin', (e) => {
      if (isTextEntryElement(e?.target || document.activeElement)) {
        syncViewportHeight();
        scheduleViewportSyncBurst();
      }
    });
    document.addEventListener('focusout', (e) => {
      if (isTextEntryElement(e?.target)) {
        lastTextBlurAt = Date.now();
        setTimeout(syncViewportHeight, 16);
        scheduleViewportSyncBurst();
      }
    });
    window.addEventListener('orientationchange', () => {
      const nextH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      maxVvHeight = nextH;
      lockedModalBaseH = Math.round(nextH || 0);
      lastLayoutWidth = window.innerWidth || 0;
      setTimeout(() => {
        const settledH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        maxVvHeight = settledH;
        lockedModalBaseH = Math.round(settledH || 0);
        lastLayoutWidth = window.innerWidth || 0;
        syncViewportHeight();
        if (typeof syncSidebarA11y === 'function') syncSidebarA11y();
      }, 150);
    });
    syncViewportHeight();

    msgEl.addEventListener('scroll', () => {
      if (programmaticScrollTop !== null && Math.abs(msgEl.scrollTop - programmaticScrollTop) <= 2) {
        programmaticScrollTop = null;
        return;
      }
      programmaticScrollTop = null;
      stickBottom = (msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight) < 80;
      if (msgEl.scrollTop <= 50 && !stickBottom && msgEl.scrollHeight > msgEl.clientHeight + 40) {
        void loadEarlierMessages();
      }
    });
    msgEl.addEventListener('toggle', (e) => {
      const target = e?.target;
      if (target && target.classList && target.classList.contains('thought-box')) {
        hydrateThoughtDetails(target);
      }
    }, true);
    msgEl.addEventListener('click', (e) => {
      if (e.target?.closest?.('#btn-load-earlier')) {
        void loadEarlierMessages();
        return;
      }
      const allBtn = e.target?.closest?.('.thought-all-btn');
      if (allBtn) {
        e.preventDefault();
        e.stopPropagation();
        const boxes = Array.from(msgEl.querySelectorAll('.thought-box'));
        const shouldOpen = boxes.some((b) => !b.open);
        for (const b of boxes) {
          b.open = shouldOpen;
          hydrateThoughtDetails(b);
        }
        return;
      }
      const sum = e.target?.closest?.('summary');
      const detailsEl = sum?.parentElement;
      if (detailsEl && detailsEl.classList?.contains?.('thought-box')) {
        setTimeout(() => hydrateThoughtDetails(detailsEl), 0);
      }
    });

    function showToast(txt) {
      const el = $('toast');
      el.textContent = txt;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    const REFRESH_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    const EMPTY_CHAT_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor" fill-opacity=".14"/></svg>';
    const EMPTY_FOLDER_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".14"/></svg>';
    const EMPTY_CHANGES_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="currentColor" fill-opacity=".14"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
    const ERROR_ALERT_ICON_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".14"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/></svg>';

    function humanizeRemoteError(rawMsg, fallbackMsg) {
      const msg = String(rawMsg || '').trim();
      const fb = String(fallbackMsg || '加载失败，请稍后重试');
      if (!msg) return fb;
      if (/channel_disabled|403|forbidden/i.test(msg)) return '当前连接通道未启用或无权访问该路径，请检查电脑端设置';
      if (/404|ENOENT|no such file/i.test(msg)) return '找不到目标路径或文件，可能已被移动或删除';
      if (/EACCES|permission/i.test(msg)) return '没有访问该路径的权限，请检查系统目录权限';
      if (/aborted|AbortError|timeout|timed out/i.test(msg)) return '请求超时，可能是当前网络较慢或电脑端忙，请重试';
      if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(msg)) return '无法连接电脑端，请检查网络或切换连接方式后重试';
      if (/^HTTP\\s*5\\d\\d/i.test(msg)) return '电脑端服务暂时异常，请稍后重试';
      if (/^HTTP\\s*\\d+/i.test(msg)) return fb + '，请检查连接后重试';
      return msg;
    }

    function renderPanelStateHtml(opts) {
      const o = opts || {};
      const icon = o.icon || (o.isError ? ERROR_ALERT_ICON_SVG : EMPTY_FOLDER_ICON_SVG);
      const cls = 'empty-state-card' + (o.isError ? ' is-error' : '') + (o.compact ? ' compact' : '');
      const actAttr = o.actionAttr ? (' ' + o.actionAttr) : '';
      const actIdAttr = o.actionId ? (' id="' + esc(o.actionId) + '"') : '';
      const btnHtml = o.actionLabel
        ? ('<button class="empty-state-btn"' + actIdAttr + actAttr + ' type="button">' + esc(o.actionLabel) + '</button>')
        : '';
      return '<div class="' + cls + '">'
        + '<div class="empty-state-ico">' + icon + '</div>'
        + '<div class="empty-state-title">' + esc(o.title || '') + '</div>'
        + (o.desc ? '<div class="empty-state-desc">' + esc(o.desc) + '</div>' : '')
        + btnHtml
        + '</div>';
    }

    function renderSkeletonRowsHtml(count) {
      const n = Number(count) > 0 ? Number(count) : 5;
      const widths = ['w-lg', 'w-md', 'w-sm', 'w-lg', 'w-md'];
      let out = '<div class="ag-skel-list" aria-hidden="true">';
      for (let i = 0; i < n; i++) {
        out += '<div class="ag-skel-row ' + widths[i % widths.length] + '"></div>';
      }
      return out + '</div>';
    }

    function fmtPct(frac) {
      return typeof frac === 'number' ? Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%' : '--%';
    }
    function fmtPctOne(frac) {
      return typeof frac === 'number' ? (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%' : '--%';
    }
    function fmtReset(iso) {
      if (!iso) return '重置时间未知';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const diffMin = Math.floor((d.getTime() - Date.now()) / 60000);
      const hhmm = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      if (diffMin <= 0) return '即将重置 · ' + hhmm;
      const days = Math.floor(diffMin / 1440);
      const hrs = Math.floor((diffMin % 1440) / 60);
      const mins = diffMin % 60;
      const cd = days > 0 ? days + '天' + hrs + 'h' : (hrs > 0 ? hrs + 'h' + mins + 'm' : mins + 'm');
      return cd + '后重置 · ' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + hhmm;
    }
    function qColor(frac) {
      if (typeof frac !== 'number') return 'var(--muted)';
      const p = frac * 100;
      return p >= 50 ? 'var(--green)' : (p >= 20 ? 'var(--amber)' : 'var(--red)');
    }

    let snapshotInflight = false;
    let snapshotSeq = 0;
    function invalidateInflightSnapshotPolls() {
      snapshotSeq += 1;
      snapshotInflight = false;
      if (activeSnapAbort) {
        try { activeSnapAbort.abort(); } catch {}
        activeSnapAbort = null;
      }
      schedulePoll();
    }

    async function apiAction(payload, opts) {
      const act = String(payload?.action || '').trim();
      const isNavAction = act === 'new-conversation' || act === 'switch-conversation';
      const actionStartEpoch = ++clientSyncEpoch;
      const myNavSeq = isNavAction ? (++lastNavActionSeq) : 0;
      if (isNavAction) invalidateInflightSnapshotPolls();
      const bodyPayload = {
        targetId: currentTargetId || undefined,
        conversationId: (isNavAction ? undefined : selectedConversationId) || undefined,
        clientId: clientId || undefined,
        ...payload
      };
      const doPost = () => fetchWithTimeout((apiBase || '') + '/api/action', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(bodyPayload)
      }, 8000);
      try {
        let res;
        try {
          res = await doPost();
          if (res.status === 403) throw new Error('channel_disabled');
        } catch (err) {
          if (await tryFailoverEndpoint()) {
            res = await doPost();
          } else {
            throw err;
          }
        }
        if (res.status === 401) {
          location.reload();
          return null;
        }
        const ctype = String(res.headers.get('content-type') || '').toLowerCase();
        let data = null;
        if (ctype.includes('application/json')) {
          data = await res.json().catch(() => null);
        }
        if (!data) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const text = await res.text().catch(() => '');
          throw new Error(text ? text.slice(0, 80) : '响应格式异常');
        }
        if (!res.ok && data.ok !== false) {
          data = Object.assign({ ok: false, error: 'HTTP ' + res.status }, data);
        }
        if (data?.snapshot && !opts?.skipAutoRender && (!isNavAction || myNavSeq === lastNavActionSeq)) {
          const snapApplied = renderSnapshot(data.snapshot, {
            reqStartEpoch: actionStartEpoch,
            advanceFloorOnApply: isNavAction
          });
          if (snapApplied && isNavAction) invalidateInflightSnapshotPolls();
        }
        return data;
      } finally {
        if (isNavAction && myNavSeq === lastNavActionSeq && !snapshotInflight) {
          schedulePoll();
        }
      }
    }

    function fmtNumShort(n) {
      const v = Number(n || 0);
      if (!Number.isFinite(v) || v <= 0) return '0';
      if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 1 : 2).replace(/\\.0+$/, '') + 'M';
      if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\\.0$/, '') + 'k';
      return String(Math.round(v));
    }

    function renderMarkdownSafe(rawText) {
      const src = String(rawText || '');
      if (!src) return '';
      const fence = String.fromCharCode(96).repeat(3);
      const inlineBt = String.fromCharCode(96);
      const parts = src.split(fence);
      let out = '';
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          const nlIdx = parts[i].indexOf('\\n');
          const codeBody = nlIdx >= 0 ? parts[i].slice(nlIdx + 1) : parts[i];
          out += '<pre><code>' + esc(codeBody) + '</code></pre>';
        } else {
          const segs = parts[i].split(inlineBt);
          let lineHtml = '';
          for (let j = 0; j < segs.length; j++) {
            lineHtml += j % 2 === 1
              ? ('<code>' + esc(segs[j]) + '</code>')
              : esc(segs[j]).replace(/\\n/g, '<br>');
          }
          out += lineHtml;
        }
      }
      return out;
    }

    function saveDraftForConv(convId, text) {
      const key = DRAFT_SESSION_PREFIX + (convId || '__desktop__');
      try {
        if (text) sessionStorage.setItem(key, text);
        else sessionStorage.removeItem(key);
      } catch {}
    }

    function loadDraftForConv(convId) {
      const key = DRAFT_SESSION_PREFIX + (convId || '__desktop__');
      try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
    }

    function applySelectedConversation(nextId) {
      const oldId = selectedConversationId;
      if (oldId !== nextId && typeof ta !== 'undefined' && ta) {
        saveDraftForConv(oldId, ta.value || '');
      }
      selectedConversationId = nextId || '';
      try {
        if (selectedConversationId) sessionStorage.setItem(CONV_ID_SESSION_KEY, selectedConversationId);
        else sessionStorage.removeItem(CONV_ID_SESSION_KEY);
      } catch {}
      if (oldId !== selectedConversationId && typeof ta !== 'undefined' && ta) {
        ta.value = loadDraftForConv(selectedConversationId);
        if (typeof autoGrow === 'function') autoGrow();
      }
    }

    function getEffectiveDisplayConfig(snap) {
      const raw = snap?.displayConfig || latestDisplayConfig || {};
      return {
        showContextPanel: raw.showContextPanel !== false,
        showUsagePanel: raw.showUsagePanel !== false,
        showQuotaPill: raw.showQuotaPill !== false,
        showChannelMeta: raw.showChannelMeta !== false,
        showSidebar: raw.showSidebar !== false,
        showThinking: raw.showThinking !== false,
        showQuickChips: raw.showQuickChips !== false,
        showComposerTools: raw.showComposerTools !== false,
        showApprovals: raw.showApprovals !== false
      };
    }

    function applyRemoteDisplayConfig(snap) {
      if (snap?.displayConfig) latestDisplayConfig = snap.displayConfig;
      const cfg = getEffectiveDisplayConfig(snap);
      const ctxBtn = $('btn-context-panel');
      const usageBtn = $('btn-usage-panel');
      const quotaBtn = $('btn-quota');
      const subMeta = $('sub-meta');
      const drawerBtn = $('btn-drawer');
      const chipsEl = $('chips');
      const dockEl = $('approval-dock');

      if (ctxBtn) ctxBtn.hidden = !cfg.showContextPanel;
      if (!cfg.showContextPanel && $('context-drawer') && !$('context-drawer').hidden) {
        $('context-drawer').hidden = true;
        ctxBtn?.classList.remove('active');
      }
      if (usageBtn) usageBtn.hidden = !cfg.showUsagePanel;
      if (!cfg.showUsagePanel && $('usage-drawer') && !$('usage-drawer').hidden) {
        $('usage-drawer').hidden = true;
        usageBtn?.classList.remove('active');
      }
      if (quotaBtn) quotaBtn.hidden = !cfg.showQuotaPill;
      if (!cfg.showQuotaPill && $('quota-drawer') && !$('quota-drawer').hidden) {
        $('quota-drawer').hidden = true;
        quotaBtn?.classList.remove('active');
      }
      if (subMeta) subMeta.hidden = !cfg.showChannelMeta;
      if (drawerBtn) drawerBtn.hidden = !cfg.showSidebar;
      if (!cfg.showSidebar && typeof closeDrawer === 'function') closeDrawer();
      if (document.body?.classList) {
        document.body.classList.toggle('has-ctx-btn', Boolean(cfg.showContextPanel));
        document.body.classList.toggle('hide-thinking', !cfg.showThinking);
        document.body.classList.toggle('hide-composer-tools', !cfg.showComposerTools);
      }
      if (chipsEl) chipsEl.hidden = !cfg.showQuickChips;
      if (dockEl && !cfg.showApprovals) dockEl.hidden = true;
      return cfg;
    }

    function syncTopbarDrawerButtons() {
      $('btn-context-panel')?.classList.toggle('active', Boolean($('context-drawer') && !$('context-drawer').hidden));
      $('btn-usage-panel')?.classList.toggle('active', Boolean($('usage-drawer') && !$('usage-drawer').hidden));
      $('btn-quota')?.classList.toggle('active', Boolean($('quota-drawer') && !$('quota-drawer').hidden));
    }

    let contextRefreshing = false;
    let usageRefreshing = false;
    let quotaRefreshing = false;

    async function fetchContextPanelData() {
      if (contextRefreshing) return null;
      contextRefreshing = true;
      renderContextDrawer(latestSnap, cachedContextResp);
      const qs = [];
      if (currentTargetId) qs.push('targetId=' + encodeURIComponent(currentTargetId));
      if (selectedConversationId) qs.push('conversationId=' + encodeURIComponent(selectedConversationId));
      const q = qs.length ? '?' + qs.join('&') : '';
      try {
        const res = await fetchWithTimeout((apiBase || '') + '/api/context' + q, { headers: authHeaders(), cache: 'no-store' }, 4500);
        if (res.status === 401) { location.reload(); return null; }
        const data = await res.json().catch(() => null);
        if (data?.ok) cachedContextResp = data;
        return data;
      } catch {
        return null;
      } finally {
        contextRefreshing = false;
        renderContextDrawer(latestSnap, cachedContextResp);
      }
    }

    async function fetchUsageData(force) {
      if (usageRefreshing) return null;
      usageRefreshing = true;
      renderUsageDrawer(cachedUsageData);
      const q = force ? '?force=1' : '';
      try {
        const res = await fetchWithTimeout((apiBase || '') + '/api/usage' + q, { headers: authHeaders(), cache: 'no-store' }, 6000);
        if (res.status === 401) { location.reload(); return null; }
        const json = await res.json().catch(() => null);
        if (json?.ok && json.data) {
          cachedUsageData = json.data;
          if ($('usage-top-val') && cachedUsageData.summary?.totalTokens) {
            $('usage-top-val').textContent = fmtNumShort(cachedUsageData.summary.totalTokens);
          }
        }
        return json;
      } catch {
        return null;
      } finally {
        usageRefreshing = false;
        renderUsageDrawer(cachedUsageData);
      }
    }

    function closeTopDrawers() {
      const ctxBox = $('context-drawer');
      const usageBox = $('usage-drawer');
      const quotaBox = $('quota-drawer');
      if (ctxBox) ctxBox.hidden = true;
      if (usageBox) usageBox.hidden = true;
      if (quotaBox) quotaBox.hidden = true;
      syncTopbarDrawerButtons();
    }

    function positionTopDrawer(targetBox) {
      if (!targetBox || !targetBox.style) return;
      try {
        const topbarEl = document.querySelector?.('.topbar');
        const bannerEl = $('conn-banner');
        let maxBottom = 0;
        if (topbarEl && typeof topbarEl.getBoundingClientRect === 'function') {
          const r = topbarEl.getBoundingClientRect();
          if (r && Number.isFinite(r.bottom) && r.bottom > maxBottom) maxBottom = r.bottom;
        }
        if (bannerEl && !bannerEl.hidden && typeof bannerEl.getBoundingClientRect === 'function') {
          const rb = bannerEl.getBoundingClientRect();
          if (rb && Number.isFinite(rb.bottom) && rb.bottom > maxBottom) maxBottom = rb.bottom;
        }
        if (maxBottom > 0) {
          targetBox.style.top = Math.round(maxBottom + 6) + 'px';
        } else {
          targetBox.style.top = '';
        }
      } catch {}
    }

    function openTopDrawer(kind) {
      const ctxBox = $('context-drawer');
      const usageBox = $('usage-drawer');
      const quotaBox = $('quota-drawer');
      const targetBox = kind === 'context' ? ctxBox : (kind === 'usage' ? usageBox : (kind === 'quota' ? quotaBox : null));
      const willOpen = Boolean(targetBox && targetBox.hidden);

      if (kind === 'quota' && willOpen && !latestSnap) {
        closeTopDrawers();
        showToast('正在连接电脑端，暂未获取配额');
        return;
      }

      if (ctxBox) ctxBox.hidden = true;
      if (usageBox) usageBox.hidden = true;
      if (quotaBox) quotaBox.hidden = true;

      if (willOpen && targetBox) {
        targetBox.hidden = false;
        positionTopDrawer(targetBox);
        if (kind === 'context') {
          renderContextDrawer(latestSnap, cachedContextResp);
          void fetchContextPanelData();
        } else if (kind === 'usage') {
          renderUsageDrawer(cachedUsageData);
          void fetchUsageData(false);
        } else if (kind === 'quota' && latestSnap) {
          renderQuotaDrawer(latestSnap);
        }
      }
      syncTopbarDrawerButtons();
    }

    const contextMetricFormat = new Intl.NumberFormat('en-US', {
      useGrouping: false,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    function renderContextDrawer(snap, ctxRes) {
      const box = $('context-drawer');
      if (!box || box.hidden) return;
      const cp = ctxRes?.contextPanel || snap?.contextPanel || {};
      const pct = typeof cp.usagePercent === 'number' ? Math.max(0, Math.min(100, cp.usagePercent)) : null;
      const usedStr = cp.usedText || (cp.usedTokens ? fmtNumShort(cp.usedTokens) : '—');
      const limitStr = cp.limitText || (cp.limitTokens ? fmtNumShort(cp.limitTokens) : '—');
      const remainStr = cp.remainingText || (cp.limitTokens && cp.usedTokens != null ? fmtNumShort(Math.max(0, cp.limitTokens - cp.usedTokens)) : '—');
      const speedStr = cp.speedText || (Number.isFinite(cp.tokPerSec) ? contextMetricFormat.format(cp.tokPerSec) + ' tok/s' : '—');
      const cacheStr = Number.isFinite(cp.cacheHitRate) ? contextMetricFormat.format(cp.cacheHitRate) + '%' : '—';
      const durStr = cp.durationText || (Number.isFinite(cp.lastDurationSec) ? contextMetricFormat.format(cp.lastDurationSec) + 's' : '—');
      const modelStr = cp.modelDisplayName || ctxRes?.model || snap?.model || '—';
      const barCol = pct == null ? 'var(--accent)' : (pct >= 85 ? 'var(--red)' : (pct >= 65 ? 'var(--amber)' : 'var(--green)'));
      const isolatedTag = snap?.isolated ? '<span class="isolated-badge" title="当前仅在本页浏览其他会话，不会改变电脑端屏幕">仅本页</span>' : '';

      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:6px;min-width:0"><strong style="font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">上下文窗口面板</strong>' + isolatedTag + '</div>' +
          '<button id="btn-refresh-context" class="icon-btn drawer-refresh-btn' + (contextRefreshing ? ' is-spinning' : '') + '" type="button"' + (contextRefreshing ? ' disabled' : '') + '>' + REFRESH_ICON_SVG + '<span>' + (contextRefreshing ? '刷新中' : '刷新') + '</span></button>' +
        '</div>' +
        '<div class="qcard">' +
          '<div class="qhead"><span>' + esc(remoteConversationDisplayTitle(ctxRes?.title || snap?.title, snap?.isNewConversation) || '当前会话') + '</span><span style="color:' + barCol + '">' + (pct != null ? pct.toFixed(1) + '%' : '--%') + '</span></div>' +
          '<div class="qbar"><div class="qfill" style="width:' + (pct != null ? pct.toFixed(1) : 0) + '%;background:' + barCol + '"></div></div>' +
          '<div class="qreset" style="margin-top:5px">模型：' + esc(modelStr) + '</div>' +
        '</div>' +
        '<div class="ctx-drawer-grid">' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">当前已用 / 上限</div><div class="ctx-stat-val">' + esc(usedStr) + ' / ' + esc(limitStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">剩余可用</div><div class="ctx-stat-val">' + esc(remainStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">输出速度 · 耗时</div><div class="ctx-stat-val">' + esc(speedStr) + ' · ' + esc(durStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">缓存命中率</div><div class="ctx-stat-val">' + esc(cacheStr) + '</div></div>' +
        '</div>' +
        (cp.sessionCostText ? '<div class="qreset" style="margin-top:6px">' + esc(cp.roundCostText ? cp.roundCostText + ' · ' : '') + esc(cp.sessionCostText) + '</div>' : '');

      const refBtn = $('btn-refresh-context');
      if (refBtn) refBtn.onclick = () => { void fetchContextPanelData(); };
    }

    function renderUsageDrawer(usageData) {
      const box = $('usage-drawer');
      if (!box || box.hidden) return;
      const summary = usageData?.summary || latestSnap?.usageSummary || {};
      const bySrc = usageData?.dailyMapBySource || null;
      const allMap = usageData?.dailyMap || {};
      const activeMap = (usageSourceFilter === 'desktop' && bySrc?.desktop)
        ? bySrc.desktop
        : ((usageSourceFilter === 'cli' && bySrc?.cli) ? bySrc.cli : allMap);
      const dayKeys = Object.keys(activeMap || {}).sort().slice(-14);
      let maxVal = 1;
      for (const k of dayKeys) {
        const v = Number(activeMap[k]?.totalTokens ?? activeMap[k]?.total ?? 0) || 0;
        if (v > maxVal) maxVal = v;
      }
      const barsHtml = dayKeys.length
        ? '<div class="usage-bars">' + dayKeys.map((k) => {
            const v = Number(activeMap[k]?.totalTokens ?? activeMap[k]?.total ?? 0) || 0;
            const h = Math.max(8, Math.round((v / maxVal) * 100));
            return '<div class="usage-bar-col" style="height:' + h + '%" title="' + esc(k + ': ' + fmtNumShort(v)) + '"></div>';
          }).join('') + '</div>'
        : '<div class="qreset">点击右上角刷新同步完整日均统计</div>';

      const todayStr = fmtNumShort(summary.todayTokens || 0);
      const sevenStr = fmtNumShort(summary.sevenDayTokens || 0);
      const thirtyStr = fmtNumShort(summary.thirtyDayTokens || 0);
      const totalStr = fmtNumShort(summary.totalTokens || 0);
      const costNum = Number(usageData?.referenceCost?.totalUsd ?? usageData?.costEstimate?.totalUsd ?? summary.totalCostUsd ?? 0) || 0;
      const costStr = costNum > 0 ? '$' + costNum.toFixed(2) : '—';

      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">' +
          '<strong style="font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">本机已记录用量面板</strong>' +
          '<button id="btn-refresh-usage" class="icon-btn drawer-refresh-btn' + (usageRefreshing ? ' is-spinning' : '') + '" type="button"' + (usageRefreshing ? ' disabled' : '') + '>' + REFRESH_ICON_SVG + '<span>' + (usageRefreshing ? '刷新中' : '刷新') + '</span></button>' +
        '</div>' +
        '<div class="usage-src-tabs">' +
          [['all', '全部'], ['desktop', '桌面端'], ['cli', 'CLI']].map(([k, lbl]) =>
            '<button class="usage-src-btn' + (usageSourceFilter === k ? ' active' : '') + '" data-src="' + k + '" type="button">' + lbl + '</button>'
          ).join('') +
        '</div>' +
        '<div class="usage-kpi-grid">' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">今日用量</div><div class="ctx-stat-val">' + esc(todayStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">近 7 天 / 30 天</div><div class="ctx-stat-val">' + esc(sevenStr) + ' / ' + esc(thirtyStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">累计总用量</div><div class="ctx-stat-val">' + esc(totalStr) + '</div></div>' +
          '<div class="ctx-stat-box"><div class="ctx-stat-lbl">API 参考等值</div><div class="ctx-stat-val">' + esc(costStr) + '</div></div>' +
        '</div>' +
        barsHtml;

      box.querySelectorAll('.usage-src-btn').forEach((btn) => {
        btn.onclick = () => {
          usageSourceFilter = btn.getAttribute('data-src') || 'all';
          try { sessionStorage.setItem(USAGE_SRC_SESSION_KEY, usageSourceFilter); } catch {}
          renderUsageDrawer(cachedUsageData);
        };
      });
      const refUsage = $('btn-refresh-usage');
      if (refUsage) refUsage.onclick = () => { void fetchUsageData(true); };
    }

    function renderQuotaDrawer(snap) {
      const box = $('quota-drawer');
      if (box.hidden) return;
      const renderPool = (title, pool) => {
        const rows = [];
        if (pool?.fiveHour) {
          rows.push(['5 小时限额', pool.fiveHour]);
        }
        if (pool?.weekly) {
          rows.push(['每周限额', pool.weekly]);
        }
        if (!rows.length && pool) {
          rows.push(['当前额度', pool]);
        }
        return '<div class="qcard"><div class="qhead"><span>' + esc(title) + '</span><span style="color:' + qColor(pool?.remainingFraction) + '">' + fmtPctOne(pool?.remainingFraction) + '</span></div>' +
          rows.map(([label, b]) => {
            const pct = typeof b.remainingFraction === 'number' ? Math.max(0, Math.min(100, b.remainingFraction * 100)) : 0;
            const col = qColor(b.remainingFraction);
            return '<div class="qsub"><div class="qsub-row"><span>' + esc(label) + '</span><strong style="color:' + col + '">' + fmtPctOne(b.remainingFraction) + '</strong></div>' +
              '<div class="qbar"><div class="qfill" style="width:' + pct.toFixed(1) + '%;background:' + col + '"></div></div>' +
              '<div class="qreset">' + esc(fmtReset(b.resetTime)) + '</div></div>';
          }).join('') + '</div>';
      };
      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">' +
          '<strong style="font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">双窗口剩余配额</strong>' +
          '<button id="btn-refresh-quota" class="icon-btn drawer-refresh-btn' + (quotaRefreshing ? ' is-spinning' : '') + '" type="button"' + (quotaRefreshing ? ' disabled' : '') + '>' + REFRESH_ICON_SVG + '<span>' + (quotaRefreshing ? '刷新中' : '刷新') + '</span></button>' +
        '</div>' +
        renderPool('Gemini 4 / 3.8', snap?.quota?.gemini) +
        renderPool('Claude 5.5 / GPT', snap?.quota?.claude);
      $('btn-refresh-quota').onclick = async () => {
        if (quotaRefreshing) return;
        quotaRefreshing = true;
        renderQuotaDrawer(latestSnap);
        try {
          const r = await apiAction({ action: 'refresh-quota' });
          if (r?.ok) showToast('已刷新配额');
          else showToast(r?.error || r?.actionResult?.error || '刷新额度失败，请检查网络或稍后重试');
        } catch (e) {
          showToast(humanizeRemoteError(e?.message, '刷新额度失败，请检查网络或稍后重试'));
        } finally {
          quotaRefreshing = false;
          renderQuotaDrawer(latestSnap);
        }
      };
    }

    let selectedProjectId = null;
    let selectedProjectFallbackName = '';
    let selectedProjectEpoch = 0;
    let clientSyncEpoch = 0;
    let minAcceptableReqStartEpoch = 0;
    let lastRenderedServerBootId = '';
    let lastRenderedServerBootAt = 0;
    let lastRenderedServerSnapSeq = 0;
    const retiredServerBootIds = new Set();
    let lastNavActionSeq = 0;

    function isNonProjectBucket(raw) {
      const pid = String(raw || '').trim();
      return !pid || pid === 'ungrouped' || pid === 'outside-of-project' || pid === 'standalone';
    }

    function normalizeProjectId(raw) {
      const pid = String(raw || '').trim();
      return isNonProjectBucket(pid) ? '' : pid;
    }

    function setUserSelectedProject(rawPid, fallbackName) {
      selectedProjectId = normalizeProjectId(rawPid);
      selectedProjectFallbackName = selectedProjectId ? String(fallbackName || '').trim() : '';
      selectedProjectEpoch = ++clientSyncEpoch;
      return selectedProjectEpoch;
    }

    // 方案 A：仅首次加载按宿主初始化选中项目；之后完全由手机端操作决定，不因桌面切换或后台轮询反向改写
    function syncSelectedProjectFromSnapshot(snap) {
      if (!snap || snap.ok === false) return;
      const snapPid = normalizeProjectId(snap.currentProjectId);
      const projects = Array.isArray(snap.projects) ? snap.projects : null;
      const hasProj = (pid) => Boolean(pid && (!projects || projects.some((p) => p && p.id === pid)));
      if (selectedProjectId === null) {
        selectedProjectId = hasProj(snapPid) ? snapPid : '';
        return;
      }
      if (selectedProjectId && !hasProj(selectedProjectId)) {
        selectedProjectId = '';
        selectedProjectFallbackName = '';
      }
    }

    function getEffectiveSelectedProject(snap) {
      const projects = Array.isArray(snap?.projects) ? snap.projects : [];
      const pid = selectedProjectId !== null
        ? selectedProjectId
        : normalizeProjectId(snap?.currentProjectId);
      if (!pid) return { id: '', name: '' };
      const matched = projects.find((p) => p && p.id === pid);
      const name = String(
        matched?.name ||
        (pid === normalizeProjectId(snap?.currentProjectId) ? snap?.currentProjectName : '') ||
        selectedProjectFallbackName ||
        ''
      ).trim();
      return { id: pid, name };
    }

    const localizedChromeLabels = ${serializeRemoteTemplateData(localizedChromeLabels)};

    function remoteChromeLabel(label) {
      return typeof label === 'string' && Object.hasOwn(localizedChromeLabels, label)
        ? localizedChromeLabels[label] : label;
    }

    const sourceProjectLabels = ${serializeRemoteTemplateData(sourceProjectLabels)};
    const sourceNewChatLabels = ${serializeRemoteTemplateData(sourceNewChatLabels)};

    function remoteConversationDisplayTitle(title, isNewConversation) {
      if (!isNewConversation || typeof title !== 'string') return title;
      const separator = title.indexOf(' · ');
      const heading = separator < 0 ? title : title.slice(0, separator);
      if (!sourceNewChatLabels.includes(heading)) return title;
      return '新建对话' + (separator < 0 ? '' : ' · ' + remoteProjectDisplayName(title.slice(separator + 3)));
    }

    function resolveConversationProjectName(snap) {
      if (!snap || snap.ok === false) return '';
      if (snap.isNewConversation) {
        return getEffectiveSelectedProject(snap).name || '';
      }
      const projects = Array.isArray(snap.projects) ? snap.projects : [];
      const curPid = normalizeProjectId(snap.currentProjectId);
      const directName = String(snap.currentProjectName || '').trim();
      if (directName && !sourceProjectLabels.includes(directName)) return directName;
      if (curPid) {
        const matchedProj = projects.find((p) => p && p.id === curPid && p.name);
        if (matchedProj?.name) return String(matchedProj.name).trim();
      }
      const activeCid = String(snap.activeConversationId || snap.sessionId || '').trim();
      if (activeCid && Array.isArray(snap.conversations)) {
        const matchedConv = snap.conversations.find((c) => c && c.id === activeCid);
        if (matchedConv) {
          const convProjName = String(matchedConv.projectName || '').trim();
          if (convProjName && !sourceProjectLabels.includes(convProjName)) return convProjName;
          const convPid = normalizeProjectId(matchedConv.projectId);
          if (convPid) {
            const pByConv = projects.find((p) => p && p.id === convPid && p.name);
            if (pByConv?.name) return String(pByConv.name).trim();
          }
        }
      }
      return directName;
    }

    function syncTopbarProjectBadge(projectName, projectId) {
      const el = $('conv-project-badge');
      if (!el) return;
      const clean = remoteProjectDisplayName(String(projectName || '').trim(), projectId);
      el.textContent = clean;
      el.title = clean ? ('所属项目：' + clean) : '';
      el.hidden = !clean;
    }

    function syncNewChatButtonUi(snap) {
      const newChatLabelEl = $('new-chat-label');
      if (newChatLabelEl) newChatLabelEl.textContent = '新建对话';
      const eff = getEffectiveSelectedProject(snap);
      const newChatSubEl = $('new-chat-sub');
      if (newChatSubEl) {
        newChatSubEl.textContent = remoteProjectDisplayName(eff.name, eff.id);
        newChatSubEl.hidden = !eff.name;
      }
      const newChatBtnEl = $('btn-new-chat');
      if (newChatBtnEl) {
        newChatBtnEl.title = eff.name ? ('在「' + remoteProjectDisplayName(eff.name, eff.id) + '」中新建对话') : '新建对话';
      }
    }

    function setConnBannerVisible(visible, msg) {
      const el = $('conn-banner');
      if (!el) return;
      if (visible && msg) {
        const msgElBanner = $('conn-banner-msg');
        if (msgElBanner) msgElBanner.textContent = msg;
      }
      el.hidden = !visible;
    }

    function renderSnapshot(snap, opts) {
      if (!snap || snap.ok === false) {
        $('status-dot').className = 'dot err';
        syncChannelPillUi('offline');
        $('conv-title').textContent = snap?.error || '连接异常';
        if (latestSnap) {
          setConnBannerVisible(true, humanizeRemoteError(snap?.error, '与电脑端的连接暂时异常，可点击重试或切换连接方式'));
        }
        return false;
      }
      const reqEpoch = typeof opts?.reqStartEpoch === 'number' ? opts.reqStartEpoch : null;
      if (reqEpoch !== null && reqEpoch < minAcceptableReqStartEpoch) {
        return false;
      }
      const bootId = String(snap.serverBootId || '').trim();
      const bootAt = Number(snap.serverBootAt) || 0;
      const snapSeqNum = Number.isInteger(snap.snapSeq) && snap.snapSeq > 0 ? snap.snapSeq : 0;
      if (bootId) {
        if (retiredServerBootIds.has(bootId)) {
          return false;
        }
        if (lastRenderedServerBootId && bootId !== lastRenderedServerBootId) {
          if (bootAt > 0 && lastRenderedServerBootAt > 0 && bootAt < lastRenderedServerBootAt) {
            return false;
          }
          if (lastRenderedServerBootAt > 0 && bootAt <= 0) {
            return false;
          }
        } else if (snapSeqNum > 0 && snapSeqNum < lastRenderedServerSnapSeq) {
          return false;
        }
      } else if (snapSeqNum > 0 && snapSeqNum < lastRenderedServerSnapSeq) {
        return false;
      }
      if (reqEpoch !== null) {
        minAcceptableReqStartEpoch = opts?.advanceFloorOnApply
          ? Math.max(minAcceptableReqStartEpoch, ++clientSyncEpoch)
          : Math.max(minAcceptableReqStartEpoch, reqEpoch);
      }
      if (bootId) {
        if (lastRenderedServerBootId && bootId !== lastRenderedServerBootId) {
          retiredServerBootIds.add(lastRenderedServerBootId);
          lastRenderedServerBootId = bootId;
          lastRenderedServerBootAt = bootAt > 0 ? bootAt : lastRenderedServerBootAt;
          lastRenderedServerSnapSeq = snapSeqNum;
        } else {
          if (!lastRenderedServerBootId) lastRenderedServerBootId = bootId;
          if (bootAt > lastRenderedServerBootAt) lastRenderedServerBootAt = bootAt;
          if (snapSeqNum > lastRenderedServerSnapSeq) lastRenderedServerSnapSeq = snapSeqNum;
        }
      } else if (snapSeqNum > lastRenderedServerSnapSeq) {
        lastRenderedServerSnapSeq = snapSeqNum;
      }
      latestSnap = snap;
      setConnBannerVisible(false);
      syncChannelPillUi('online');
      syncSelectedProjectFromSnapshot(snap);
      if ($('btn-follow-desktop')) $('btn-follow-desktop').hidden = !Boolean(snap.isolated);
      if (snap.currentTargetId) {
        currentTargetId = snap.currentTargetId;
        try { sessionStorage.setItem(TARGET_ID_SESSION_KEY, currentTargetId); } catch {}
      }
      if (Array.isArray(snap.endpoints) && snap.endpoints.length) {
        pairState.endpoints = snap.endpoints;
        if (Array.isArray(snap.hosts) && snap.hosts.length) pairState.hosts = snap.hosts;
        saveStoredPair(pairState);
        if (!manualLocked && !isAutoSwitched && !autoSwitchChecked && getEnabledModeEntries().length > 1) {
          autoSwitchChecked = true;
          void runSpeedTest({ autoSwitch: true, silent: true });
        }
      }

      const displayCfg = applyRemoteDisplayConfig(snap);
      $('status-dot').className = snap.busy ? 'dot busy' : 'dot';
      $('conv-title').textContent = remoteConversationDisplayTitle(snap.title, snap.isNewConversation) || 'Antigravity';
      syncTopbarProjectBadge(resolveConversationProjectName(snap), snap.currentProjectId);
      $('sub-meta').textContent = snap.pulseText || (snap.busy ? '正在生成内容…' : (snap.contextBadge || '已就绪'));

      const gStr = fmtPct(snap.quota?.gemini?.remainingFraction);
      const cStr = fmtPct(snap.quota?.claude?.remainingFraction);
      $('quota-main').textContent = 'G4 ' + gStr + ' · C ' + cStr;
      $('ctx-badge').textContent = snap.contextBadge || '--%';
      const cp = snap.contextPanel || {};
      const ctxPctMatch = String(snap.contextBadge || '').match(/(\\d+(?:\\.\\d+)?)%/);
      const ctxPctNum = typeof cp.usagePercent === 'number'
        ? Math.round(cp.usagePercent) + '%'
        : (ctxPctMatch ? ctxPctMatch[1] + '%' : '--%');
      if ($('ctx-top-val')) $('ctx-top-val').textContent = ctxPctNum;
      if ($('usage-top-val')) {
        const totTok = Number(cachedUsageData?.summary?.totalTokens || snap.usageSummary?.totalTokens || 0);
        $('usage-top-val').textContent = totTok > 0 ? fmtNumShort(totTok) : '用量';
      }
      $('model-inline-label').textContent = snap.model || '切换模型';
      syncPermInlineUi(snap.permissionKey, snap.permissionLabel);
      syncNewChatButtonUi(snap);

      renderQuotaDrawer(snap);
      if ($('context-drawer') && !$('context-drawer').hidden) renderContextDrawer(snap, cachedContextResp);
      if ($('usage-drawer') && !$('usage-drawer').hidden) renderUsageDrawer(cachedUsageData);
      syncSendButtonUI();

      // Messages (full history + upward pagination + gap backfill + scroll anchor)
      msgEl.classList.remove('is-switching');
      const snapSid = snap.isNewConversation ? '__new__' : String(snap.sessionId || '');
      const nextHistSource = snap.historySource === 'trajectory'
        ? 'trajectory'
        : (snap.historySource === 'dom' || snap.historySource === 'isolated_error' ? snap.historySource : '');
      const totalMsgs = parseNonNegativeInt(snap.totalMessages);
      const hasValidTotalMsgs = totalMsgs !== null;
      if (snapSid !== activeMsgSessionId) {
        activeMsgSessionId = snapSid;
        activeMsgHistorySource = hasValidTotalMsgs ? (nextHistSource || 'dom') : 'dom';
        msgCacheEpoch += 1;
        sessionMsgsByIndex.clear();
        openThoughtIdxSet.clear();
        promptDraftState.clear();
        loadingEarlierMsgs = false;
        backfillingMsgGaps = false;
        stickBottom = true;
      } else if (!hasValidTotalMsgs) {
        // 缺失或无效 totalMessages（如 undefined/null/''/NaN/负数），即使显式携带原有 historySource（含 'trajectory'），
        // 也一律视为降级回退快照，在写入前先清空旧索引缓存，防止旧轨迹键与回退键混排重复
        msgCacheEpoch += 1;
        sessionMsgsByIndex.clear();
        openThoughtIdxSet.clear();
        loadingEarlierMsgs = false;
        backfillingMsgGaps = false;
        activeMsgHistorySource = 'dom';
      } else if (activeMsgHistorySource === 'dom' && nextHistSource === 'trajectory') {
        // RPC 偶发降级 domTail（写入 0..59 临时键）后恢复全量轨迹时，清空旧临时键防止前 60 条重复错序
        msgCacheEpoch += 1;
        sessionMsgsByIndex.clear();
        openThoughtIdxSet.clear();
        loadingEarlierMsgs = false;
        backfillingMsgGaps = false;
        activeMsgHistorySource = 'trajectory';
      } else if (activeMsgHistorySource === 'isolated_error' && nextHistSource === 'trajectory') {
        msgCacheEpoch += 1;
        sessionMsgsByIndex.clear();
        openThoughtIdxSet.clear();
        loadingEarlierMsgs = false;
        backfillingMsgGaps = false;
        activeMsgHistorySource = 'trajectory';
      } else if (activeMsgHistorySource === 'trajectory' && nextHistSource !== 'trajectory') {
        // 轨迹显式降级至 DOM / isolated_error 或缺失来源时清空旧轨迹索引键，防止双源键混排重复
        msgCacheEpoch += 1;
        sessionMsgsByIndex.clear();
        openThoughtIdxSet.clear();
        loadingEarlierMsgs = false;
        backfillingMsgGaps = false;
        activeMsgHistorySource = nextHistSource || 'dom';
      } else if (nextHistSource) {
        activeMsgHistorySource = nextHistSource;
      }
      const rawMsgs = Array.isArray(snap.messages) ? snap.messages : [];
      if (hasValidTotalMsgs) {
        for (const k of Array.from(sessionMsgsByIndex.keys())) {
          if (totalMsgs === 0 || k >= totalMsgs) sessionMsgsByIndex.delete(k);
        }
      }
      const parsedBaseIdx = hasValidTotalMsgs ? parseNonNegativeInt(snap.messagesStartIndex) : null;
      const baseIdx = parsedBaseIdx !== null ? parsedBaseIdx : 0;
      for (let idx = 0; idx < rawMsgs.length; idx++) {
        const m = rawMsgs[idx];
        if (!m) continue;
        const parsedMsgIdx = hasValidTotalMsgs ? parseNonNegativeInt(m.msgIndex) : null;
        const mIdx = parsedMsgIdx !== null ? parsedMsgIdx : (baseIdx + idx);
        sessionMsgsByIndex.set(mIdx, { ...m, msgIndex: mIdx });
      }
      renderMessagesView(snap);
      if (hasValidTotalMsgs && activeMsgHistorySource === 'trajectory' && snapSid && snapSid !== '__new__' && findMissingMsgRanges(totalMsgs).length > 0) {
        void backfillMissingMsgGaps(snapSid);
      }

      // Pending Prompts (交互式单选/多选确认框) & Pending Approvals (按钮审批)
      const prompts = Array.isArray(snap.pendingPrompts) ? snap.pendingPrompts : [];
      const approvals = Array.isArray(snap.pendingApprovals) ? snap.pendingApprovals : [];
      const dock = $('approval-dock');
      const curDockSid = String(dock.dataset.promptSig || '').split('::')[0];
      const keepPromptDuringUpload = Boolean(
        displayCfg.showApprovals &&
        !prompts.length &&
        !approvals.length &&
        !dock.hidden &&
        dock.dataset.promptSig &&
        curDockSid === String(snapSid || '__default__') &&
        (typeof attachmentUploadInflight === 'number' && attachmentUploadInflight > 0 || (typeof lastAttachmentUploadAt === 'number' && (Date.now() - lastAttachmentUploadAt) < 1500))
      );
      if (keepPromptDuringUpload) {
        // 粘贴/上传图片期间桌面端瞬态重绘可能短暂漏检选择框，保留当前已挂载的选择框避免闪烁消失
      } else if (!displayCfg.showApprovals || (!prompts.length && !approvals.length)) {
        dock.hidden = true;
        dock.innerHTML = '';
        dock.dataset.promptSig = '';
        promptSubmittingSig = '';
        promptDraftState.clear();
      } else if (prompts.length > 0) {
        dock.hidden = false;
        const activePrompt = prompts[0];
        const activePromptKey = String(activePrompt.promptKey || activePrompt.id || '');
        const highRiskApprovals = approvals.filter((a) => a && a.highRisk);
        const isPromptRisk = Boolean(activePrompt.highRisk);
        const promptSig = String(snapSid || '__default__') + '::' + activePromptKey + '|' + String(activePrompt.title || '') + '|'
          + String(activePrompt.description || '') + '|'
          + (activePrompt.options || []).map((o) => o.label).join(',') + '|'
          + (activePrompt.actions || []).map((a) => a.label + (a.isPersistentAllow ? ':pa' : '')).join(',')
          + '|' + (isPromptRisk ? ('risk:' + String(activePrompt.riskText || '')) : '')
          + '|' + highRiskApprovals.map((a) => String(a.index) + ':' + String(a.label || '')).join(',');
        if (!promptDraftState.has(promptSig)) {
          const initSelected = new Set(
            (activePrompt.options || []).filter((o) => o.selected).map((o) => Number(o.index))
          );
          promptDraftState.clear();
          promptDraftState.set(promptSig, {
            selected: initSelected,
            otherText: String(activePrompt.otherValue || '')
          });
        }
        const draft = promptDraftState.get(promptSig);
        // 同一提示框在连续轮询中直接复用已挂载 DOM，保留长列表滚动位置、输入框焦点及提交中按钮禁用锁
        if (dock.dataset.promptSig !== promptSig) {
          dock.dataset.promptSig = promptSig;
          promptSubmittingSig = '';
          const modeLabel = activePrompt.options?.length
            ? (activePrompt.multiSelect ? '多选确认' : '单选确认')
            : '系统确认';
          const optsHtml = (activePrompt.options || []).length
            ? ('<div class="prompt-opts">' + activePrompt.options.map((opt) => {
                const isSel = draft.selected.has(Number(opt.index));
                const mark = activePrompt.multiSelect ? (isSel ? '☑' : '☐') : (isSel ? '●' : '○');
                return '<button class="prompt-opt' + (isSel ? ' selected' : '') + '" data-opt-idx="' + opt.index + '" type="button">'
                  + '<span class="prompt-opt-mark">' + mark + '</span>'
                  + '<span class="prompt-opt-label">' + esc(opt.displayLabel || opt.label) + '</span>'
                  + '</button>';
              }).join('') + '</div>')
            : '';
          const otherHtml = activePrompt.hasOtherInput
            ? '<input class="prompt-other-input" type="text" placeholder="' + esc(activePrompt.displayPlaceholder || activePrompt.otherPlaceholder || '输入自定义说明或选项…') + '" value="' + esc(draft.otherText) + '" />'
            : '';
          const actionsList = Array.isArray(activePrompt.actions) ? activePrompt.actions : [];
          const actsHtml = actionsList.length
            ? ('<div class="approval-btns">' + actionsList.map((act) => {
                const isPersistRisk = Boolean(act.isPersistentAllow && isPromptRisk);
                const cls = (act.kind === 'reject' ? 'reject' : (act.kind === 'primary' ? 'approve' : 'secondary')) + (isPersistRisk ? ' is-persistent-risk' : '');
                return '<button class="ap-btn ' + cls + ' prompt-act-btn" data-act-idx="' + act.index + '" data-act-label="' + esc(act.label) + '"'
                  + (isPersistRisk ? ' data-persistent-risk="1"' : '') + ' type="button">'
                  + esc(act.displayLabel || remoteChromeLabel(act.label)) + '</button>';
              }).join('') + '</div>')
            : '';
          const riskTagHtml = isPromptRisk
            ? ('<div class="risk-tag">' + esc(activePrompt.riskText || '🛡️ 检测到高危操作，请人工核对') + '</div>')
            : '';
          const coexistRiskHtml = highRiskApprovals.length
            ? ('<div class="approval-card is-risk" style="margin-top:6px">'
              + '<div style="font-size:12px;font-weight:700;color:var(--risk-fg)">' + esc(highRiskApprovals[0].riskText || '🛡️ 高危操作确认') + '</div>'
              + '<div class="approval-ctx">' + esc(highRiskApprovals[0].contextText || '桌面端存在高危操作等待你的确认') + '</div>'
              + '<div class="approval-btns">' + approvals.map((a) =>
                  '<button class="ap-btn ' + (a.kind === 'reject' ? 'reject' : 'approve') + ' ap-coexist-btn" data-idx="' + a.index + '" data-label="' + esc(a.label) + '" data-display-label="' + esc(a.displayLabel || remoteChromeLabel(a.label)) + '" type="button">'
                  + (a.kind === 'reject' ? '❌ ' : '✅ ') + esc(a.displayLabel || remoteChromeLabel(a.label)) + '</button>'
                ).join('') + '</div></div>')
            : '';
          dock.innerHTML = (isPromptRisk ? '<div class="prompt-card is-risk">' : '<div class="prompt-card">')
            + '<div class="prompt-head"><span class="prompt-title">' + esc(activePrompt.displayTitle || remoteChromeLabel(activePrompt.title) || '需要你的确认') + '</span>'
            + '<span class="prompt-badge">' + esc(modeLabel) + '</span></div>'
            + riskTagHtml
            + (activePrompt.description ? '<div class="prompt-desc">' + esc(activePrompt.description) + '</div>' : '')
            + optsHtml + otherHtml + actsHtml + '</div>' + coexistRiskHtml;

          dock.querySelectorAll('.prompt-opt').forEach((optBtn) => {
            optBtn.onclick = async () => {
              const idx = Number(optBtn.dataset.optIdx);
              if (!Number.isInteger(idx)) return;
              if (activePrompt.multiSelect) {
                if (draft.selected.has(idx)) draft.selected.delete(idx);
                else draft.selected.add(idx);
              } else {
                draft.selected.clear();
                draft.selected.add(idx);
              }
              dock.querySelectorAll('.prompt-opt').forEach((b) => {
                const bIdx = Number(b.dataset.optIdx);
                const sel = draft.selected.has(bIdx);
                b.classList.toggle('selected', sel);
                const mk = b.querySelector('.prompt-opt-mark');
                if (mk) mk.textContent = activePrompt.multiSelect ? (sel ? '☑' : '☐') : (sel ? '●' : '○');
              });
              if (!actionsList.length && !activePrompt.multiSelect) {
                optBtn.disabled = true;
                try {
                  const res = await apiAction({
                    action: 'respond-prompt',
                    promptKey: activePromptKey,
                    promptIndex: Number(activePrompt.index) || 0,
                    selectedIndices: Array.from(draft.selected)
                  });
                  if (res?.ok) showToast('已选择确认项');
                  else showToast(res?.error || res?.actionResult?.error || '选择未生效，请重试或检查电脑端窗口');
                } catch (e) {
                  showToast(humanizeRemoteError(e?.message, '选择未生效，请重试或检查电脑端窗口'));
                } finally {
                  optBtn.disabled = false;
                }
              }
            };
          });

          const otherInp = dock.querySelector('.prompt-other-input');
          if (otherInp) {
            otherInp.oninput = () => { draft.otherText = String(otherInp.value || ''); };
          }

          dock.querySelectorAll('.prompt-act-btn').forEach((actBtn) => {
            actBtn.onclick = async () => {
              if (promptSubmittingSig === promptSig) return;
              if (actBtn.dataset.persistentRisk === '1' && actBtn.dataset.confirmArmed !== '1') {
                actBtn.dataset.confirmArmed = '1';
                actBtn.textContent = '⚠️ 再次点击确认: ' + (actBtn.dataset.actLabel || '');
                showToast('高危持久放行：请再次点击确认');
                return;
              }
              promptSubmittingSig = promptSig;
              dock.querySelectorAll('.prompt-act-btn').forEach((b) => { b.disabled = true; });
              try {
                const res = await apiAction({
                  action: 'respond-prompt',
                  promptKey: activePromptKey,
                  promptIndex: Number(activePrompt.index) || 0,
                  selectedIndices: Array.from(draft.selected),
                  otherText: activePrompt.hasOtherInput ? draft.otherText : undefined,
                  actionIndex: Number(actBtn.dataset.actIdx),
                  actionLabel: actBtn.dataset.actLabel
                });
                if (res?.ok) {
                  showToast('已提交: ' + actBtn.dataset.actLabel);
                } else {
                  showToast(res?.error || res?.actionResult?.error || '提交失败，请检查电脑端连接后重试');
                }
              } catch (e) {
                showToast(humanizeRemoteError(e?.message, '提交失败，请检查电脑端连接后重试'));
              } finally {
                // 请求结束后解除在途锁并恢复按钮可用（保留草稿直至提示框真正消失或变更，支持纯 JS 校验未通过后修改重试）
                if (promptSubmittingSig === promptSig) {
                  promptSubmittingSig = '';
                }
                if (dock.dataset.promptSig === promptSig) {
                  dock.querySelectorAll('.prompt-act-btn').forEach((b) => { b.disabled = false; });
                }
              }
            };
          });

          dock.querySelectorAll('.ap-coexist-btn').forEach((btn) => {
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                const res = await apiAction({ action: 'click-approval', index: Number(btn.dataset.idx), label: btn.dataset.label });
                if (res?.ok) showToast(${locale === 'zh-TW' ? true : false}
                  ? '已選擇「' + btn.dataset.displayLabel + '」' : '已触发: ' + btn.dataset.label);
                else {
                  btn.disabled = false;
                  showToast(res?.error || res?.actionResult?.error || '操作未生效，请检查电脑端状态后重试');
                }
              } catch (e) {
                btn.disabled = false;
                showToast(humanizeRemoteError(e?.message, '操作未生效，请检查电脑端状态后重试'));
              }
            };
          });
        }
      } else {
        dock.hidden = false;
        dock.dataset.promptSig = '';
        promptDraftState.clear();
        const firstRisk = approvals.some((a) => a.highRisk);
        const ctx = approvals[0]?.contextText || '桌面端正在等待你的操作确认';
        dock.innerHTML = '<div class="approval-card' + (firstRisk ? ' is-risk' : '') + '">' +
          (firstRisk ? '<div style="font-size:12px;font-weight:700;color:var(--risk-fg)">' + esc(approvals[0].riskText || '🛡️ 高危操作确认') + '</div>' : '') +
          '<div class="approval-ctx">' + esc(ctx) + '</div>' +
          '<div class="approval-btns">' + approvals.map((a) =>
            '<button class="ap-btn ' + (a.kind === 'reject' ? 'reject' : 'approve') + '" data-idx="' + a.index + '" data-label="' + esc(a.label) + '" data-display-label="' + esc(a.displayLabel || remoteChromeLabel(a.label)) + '" type="button">' +
            (a.kind === 'reject' ? '❌ ' : '✅ ') + esc(a.displayLabel || remoteChromeLabel(a.label)) + '</button>'
          ).join('') + '</div></div>';
        dock.querySelectorAll('.ap-btn').forEach((btn) => {
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const res = await apiAction({ action: 'click-approval', index: Number(btn.dataset.idx), label: btn.dataset.label });
              if (res?.ok) showToast(${locale === 'zh-TW' ? true : false}
                  ? '已選擇「' + btn.dataset.displayLabel + '」' : '已触发: ' + btn.dataset.label);
              else {
                btn.disabled = false;
                showToast(res?.error || res?.actionResult?.error || '操作未生效，请检查电脑端状态后重试');
              }
            } catch (e) {
              btn.disabled = false;
              showToast(humanizeRemoteError(e?.message, '操作未生效，请检查电脑端状态后重试'));
            }
          };
        });
      }

      // Queued Messages (排队中消息展示、立即发送、编辑回填与撤回删除)
      const qDock = $('queue-dock');
      if (qDock) {
        const queuedList = Array.isArray(snap.queuedMessages) ? snap.queuedMessages : [];
        if (!queuedList.length) {
          qDock.hidden = true;
          qDock.innerHTML = '';
          qDock.dataset.queueSig = '';
        } else {
          qDock.hidden = false;
          const hasDomQueued = queuedList.some((q) => q && q.source === 'dom');
          const isDomQueuedList = queuedList.every((q) => q && q.source === 'dom');
          const hasOnlyOptimistic = queuedList.every((q) => q && q.source === 'optimistic');
          const agentMsgIds = queuedList.map((q) => String(q?.messageId || q?.id || '').trim()).filter(Boolean);
          const qSig = String(snapSid || '') + '::' + queuedList.map((q, qi) => String(q.source || 'traj') + ':' + String(q.messageId || q.id || '') + ':' + String(q.stepIndex ?? qi) + ':' + String(q.domIndex ?? qi) + ':' + String(q.text || '') + ':' + (Array.isArray(q.images) ? q.images.length : 0)).join('\u001f');
          if (qDock.dataset.queueSig !== qSig) {
            qDock.dataset.queueSig = qSig;
            qDock.innerHTML = '<div class="queue-card">'
              + '<div class="queue-head">'
              + '<span class="queue-title"><span>排队中</span><span class="queue-count">' + queuedList.length + '</span></span>'
              + '<button class="queue-send-all" type="button"' + ((queueActionBusy || hasOnlyOptimistic) ? ' disabled' : '') + '>⚡ 立即发送</button>'
              + '</div>'
              + '<div class="queue-list">' + queuedList.map((q, qi) => {
                const imgsHtml = (Array.isArray(q.images) && q.images.length)
                  ? ('<span class="queue-thumbs">' + q.images.slice(0, 3).map((im) => {
                      const rawSrc = typeof im === 'string' ? im : String(im?.src || '');
                      const qSrc = rawSrc.startsWith('/api/media?')
                        ? ((apiBase || '') + rawSrc + (apiBase && pairState.token ? ('&token=' + encodeURIComponent(pairState.token)) : ''))
                        : rawSrc;
                      const qAlt = typeof im === 'string' ? '' : String(im?.alt || '');
                      return '<img class="queue-thumb" src="' + esc(qSrc) + '" alt="' + esc(qAlt) + '" />';
                    }).join('') + '</span>')
                  : '';
                const stepAttr = Number.isInteger(Number(q.stepIndex)) ? Number(q.stepIndex) : -1;
                const domAttr = Number.isInteger(Number(q.domIndex)) ? Number(q.domIndex) : qi;
                const msgIdAttr = String(q.messageId || q.id || '').trim();
                const srcAttr = q.source === 'dom' ? 'dom' : (q.source === 'agent_state' ? 'agent_state' : (q.source === 'optimistic' ? 'optimistic' : 'traj'));
                const hasMediaAttr = (q.hasMedia || (Array.isArray(q.images) && q.images.length > 0)) ? '1' : '';
                const mediaSigAttr = String(q.mediaSig || (Array.isArray(q.images) ? q.images.map((im) => (typeof im === 'string' ? im : String(im?.alt || im?.src || ''))).filter(Boolean).sort().join('|') : '')).trim();
                const itemBtnDisabled = (queueActionBusy || srcAttr === 'optimistic') ? ' disabled' : '';
                const dataAttrs = 'data-step-idx="' + esc(String(stepAttr)) + '" data-dom-idx="' + esc(String(domAttr)) + '" data-queue-source="' + esc(srcAttr) + '" data-msg-id="' + esc(msgIdAttr) + '" data-queue-text="' + esc(String(q.text || '')) + '" data-has-media="' + esc(hasMediaAttr) + '" data-media-sig="' + esc(mediaSigAttr) + '"';
                return '<div class="queue-item" ' + dataAttrs + '>'
                  + imgsHtml
                  + '<span class="queue-item-text">' + esc(q.displayText ?? q.text ?? '') + '</span>'
                  + '<span class="queue-actions">'
                  + '<button class="queue-op-btn send queue-item-send" type="button" title="立即发送" aria-label="立即发送" ' + dataAttrs + itemBtnDisabled + '>→</button>'
                  + '<button class="queue-op-btn edit queue-item-edit" type="button" title="编辑此条排队消息" aria-label="编辑此条排队消息" ' + dataAttrs + itemBtnDisabled + '>✎</button>'
                  + '<button class="queue-del-btn" type="button" title="撤回此条排队消息" aria-label="撤回此条排队消息" ' + dataAttrs + itemBtnDisabled + '>×</button>'
                  + '</span></div>';
              }).join('') + '</div></div>';

            const setQueueBtnsDisabled = (disabled) => {
              qDock.querySelectorAll('.queue-send-all').forEach((b) => { b.disabled = disabled || hasOnlyOptimistic; });
              qDock.querySelectorAll('.queue-op-btn, .queue-del-btn').forEach((b) => {
                b.disabled = disabled || b.dataset.queueSource === 'optimistic';
              });
            };
            const buildQueueItemPayload = (el, extra = {}) => {
              const src = String(el.dataset.queueSource || 'traj');
              const msgId = String(el.dataset.msgId || '').trim();
              const stepIdx = Number(el.dataset.stepIdx);
              const domIdx = Number(el.dataset.domIdx);
              const text = String(el.dataset.queueText || '');
              const hasMedia = el.dataset.hasMedia === '1';
              const mediaSig = String(el.dataset.mediaSig || '').trim();
              return {
                conversationId: String(snap.activeConversationId || snap.sessionId || ''),
                ...(msgId ? { messageId: msgId } : {}),
                ...(text ? { text } : {}),
                ...(hasMedia ? { hasMedia: true } : {}),
                ...(mediaSig ? { mediaSig } : {}),
                ...(src === 'dom' ? {
                  source: 'dom',
                  domIndex: Number.isInteger(domIdx) ? domIdx : 0,
                  ...(isDomQueuedList ? { expectedQueueCount: queuedList.length } : {})
                } : {}),
                ...(src !== 'dom' && Number.isInteger(stepIdx) && stepIdx >= 0 ? { stepIndex: stepIdx } : {}),
                ...extra
              };
            };
            const sendAllBtn = qDock.querySelector('.queue-send-all');
            if (sendAllBtn) {
              sendAllBtn.onclick = async () => {
                if (queueActionBusy) return;
                if (hasOnlyOptimistic) return;
                queueActionBusy = true;
                setQueueBtnsDisabled(true);
                try {
                  const res = await apiAction({
                    action: 'send-queued-messages',
                    conversationId: String(snap.activeConversationId || snap.sessionId || ''),
                    ...(agentMsgIds.length ? { messageIds: agentMsgIds } : {}),
                    ...(isDomQueuedList ? { source: 'dom', sendAll: true } : (hasDomQueued ? { hasDomQueued: true } : {}))
                  });
                  if (res?.ok) {
                    showToast(res?.actionResult?.hasRemainingDomQueued
                      ? '已发送排队中的消息，电脑端输入框内若还有未发消息请留意核对'
                      : '已立即发送排队消息');
                  } else showToast(res?.error || res?.actionResult?.error || '发送排队消息失败，请检查电脑端连接后重试');
                } catch (e) {
                  showToast(humanizeRemoteError(e?.message, '发送排队消息失败，请检查电脑端连接后重试'));
                } finally {
                  queueActionBusy = false;
                  setQueueBtnsDisabled(false);
                }
              };
            }
            qDock.querySelectorAll('.queue-item-send').forEach((sendOneBtn) => {
              sendOneBtn.onclick = async () => {
                if (queueActionBusy) return;
                if (String(sendOneBtn.dataset.queueSource || '') === 'optimistic') return;
                queueActionBusy = true;
                setQueueBtnsDisabled(true);
                try {
                  const reqBody = buildQueueItemPayload(sendOneBtn, { action: 'send-queued-messages', sendAll: false });
                  const res = await apiAction(reqBody);
                  if (res?.ok) showToast('已立即发送此条排队消息');
                  else showToast(res?.error || res?.actionResult?.error || '发送排队消息失败');
                } catch (e) {
                  showToast(e?.message || '发送排队消息失败');
                } finally {
                  queueActionBusy = false;
                  setQueueBtnsDisabled(false);
                }
              };
            });
            qDock.querySelectorAll('.queue-item-edit').forEach((editBtn) => {
              editBtn.onclick = async () => {
                if (queueActionBusy) return;
                const src = String(editBtn.dataset.queueSource || 'traj');
                if (src === 'optimistic') return;
                const qText = String(editBtn.dataset.queueText || '');
                const msgId = String(editBtn.dataset.msgId || '').trim();
                const stepIdx = Number(editBtn.dataset.stepIdx);
                if (!msgId && src !== 'dom' && (!Number.isInteger(stepIdx) || stepIdx < 0)) return;
                queueActionBusy = true;
                setQueueBtnsDisabled(true);
                try {
                  const res = await apiAction(buildQueueItemPayload(editBtn, { action: 'edit-queued-message' }));
                  if (res?.ok || res?.attachmentsPreserved || res?.textPreserved) {
                    const restoredAtts = Array.isArray(res?.actionResult?.editedAttachments)
                      ? res.actionResult.editedAttachments
                      : [];
                    const isPendingRetryRestore = Boolean(!res?.ok && (res?.attachmentsPreserved || res?.textPreserved));
                    const serverRecoveryKey = String(res?.actionResult?.recoveryKey || '').trim();
                    const restoreSourceKey = msgId
                      ? ('msg:' + msgId)
                      : (serverRecoveryKey || (Number.isInteger(stepIdx) && stepIdx >= 0 ? ('step:' + stepIdx) : ''));
                    if (restoreSourceKey && restoredAtts.length) {
                      for (let ri = uploadedAttachments.length - 1; ri >= 0; ri -= 1) {
                        if (
                          uploadedAttachments[ri] &&
                          uploadedAttachments[ri]._sourceKey === restoreSourceKey &&
                          uploadedAttachments[ri]._pendingRetry === true
                        ) {
                          uploadedAttachments.splice(ri, 1);
                          uploadedNames.splice(ri, 1);
                        }
                      }
                    }
                    for (const att of restoredAtts) {
                      if (!att || typeof att !== 'object') continue;
                      const rawPrev = String(att.previewUrl || '');
                      const safePrev = rawPrev.startsWith('/api/media?')
                        ? ((apiBase || '') + rawPrev + (apiBase && pairState.token ? ('&token=' + encodeURIComponent(pairState.token)) : ''))
                        : rawPrev;
                      const attName = String(att.name || (att.isImage ? 'image.png' : 'attachment'));
                      uploadedNames.push(attName);
                      uploadedAttachments.push({
                        name: attName,
                        size: Number(att.size) || 0,
                        isImage: Boolean(att.isImage),
                        previewUrl: safePrev,
                        ...(restoreSourceKey ? { _sourceKey: restoreSourceKey } : {}),
                        ...(isPendingRetryRestore ? { _pendingRetry: true } : {})
                      });
                    }
                    if (restoredAtts.length) {
                      renderAttachHintStrip();
                    }
                    const hasServerText = Boolean(res?.actionResult && typeof res.actionResult.editedText === 'string');
                    const fillVal = hasServerText ? res.actionResult.editedText : qText;
                    const textRestoreKey = restoreSourceKey ? ((selectedConversationId || '') + '::' + restoreSourceKey) : '';
                    const alreadyRestoredText = Boolean(textRestoreKey && restoredQueueEditTextKeys.has(textRestoreKey));
                    if (fillVal && !alreadyRestoredText) {
                      ta.value = ta.value.trim() ? (ta.value.trimEnd() + '\\n' + fillVal) : fillVal;
                      saveDraftForConv(selectedConversationId, ta.value);
                      ta.style.height = 'auto';
                      const maxH = isDesktopLayout() ? 180 : 112;
                      ta.style.height = Math.min(maxH, Math.max(28, ta.scrollHeight)) + 'px';
                      ta.focus();
                      if (textRestoreKey && !res?.ok && (res?.attachmentsPreserved || res?.textPreserved)) {
                        restoredQueueEditTextKeys.add(textRestoreKey);
                      }
                    } else if (restoredAtts.length || alreadyRestoredText) {
                      ta.focus();
                    }
                    if (textRestoreKey && res?.ok) {
                      restoredQueueEditTextKeys.delete(textRestoreKey);
                    }
                    syncSendButtonUI();
                    if (!res?.ok && (res?.attachmentsPreserved || res?.textPreserved)) {
                      showToast(res?.error || '原排队消息状态待确认，已保留恢复的文本与附件');
                    } else {
                      showToast(restoredAtts.length
                        ? ('已撤回至输入区（含 ' + restoredAtts.length + ' 个附件），修改后重新发送')
                        : '已撤回至输入框，修改后重新发送');
                    }
                  } else showToast(res?.error || res?.actionResult?.error || '编辑排队消息失败');
                } catch (e) {
                  showToast(e?.message || '编辑排队消息失败');
                } finally {
                  queueActionBusy = false;
                  setQueueBtnsDisabled(false);
                }
              };
            });
            qDock.querySelectorAll('.queue-del-btn').forEach((delBtn) => {
              delBtn.onclick = async () => {
                if (queueActionBusy) return;
                const src = String(delBtn.dataset.queueSource || 'traj');
                if (src === 'optimistic') return;
                const stepIdx = Number(delBtn.dataset.stepIdx);
                const msgId = String(delBtn.dataset.msgId || '').trim();
                if (!msgId && src !== 'dom' && (!Number.isInteger(stepIdx) || stepIdx < 0)) return;
                queueActionBusy = true;
                setQueueBtnsDisabled(true);
                try {
                  const res = await apiAction(buildQueueItemPayload(delBtn, { action: 'delete-queued-message' }));
                  if (res?.ok) showToast('已撤回排队消息');
                  else showToast(res?.error || res?.actionResult?.error || '撤回排队消息失败，请检查电脑端连接后重试');
                } catch (e) {
                  showToast(humanizeRemoteError(e?.message, '撤回排队消息失败，请检查电脑端连接后重试'));
                } finally {
                  queueActionBusy = false;
                  setQueueBtnsDisabled(false);
                }
              };
            });
          }
        }
      }

      // 同步上层停靠区栈顶单线状态（避免 approval-dock / queue-dock / composer-dock 叠加多层分隔线与阴影）
      if (typeof syncUpperDockStackState === 'function') syncUpperDockStackState();

      // 轻盈下一步建议 & 快捷提示词 & 快捷操作胶囊（模型/权限已并入输入卡片内部工具栏）
      renderQuickChipsBar(snap);

      // Drawer Conversations & Multi-Project Grouping (with projectGroups drilldown fallback)
      const useDrilldownDrawer = shouldUseDrilldownDrawer(snap);
      const navBarEl = $('drawer-nav-bar');
      const convToolbarEl = document.querySelector('.conv-toolbar');
      if (navBarEl) navBarEl.hidden = !useDrilldownDrawer;
      if (convToolbarEl) convToolbarEl.hidden = useDrilldownDrawer;
      if (useDrilldownDrawer) {
        renderDrawerProjectsAndConversations(snap);
      } else {
        reconcileExtraConversations(snap);
        renderConversationList(snap);
      }
      return true;
    }

    function syncUpperDockStackState() {
      const apEl = $('approval-dock');
      const qEl = $('queue-dock');
      const apVisible = Boolean(apEl && !apEl.hidden);
      const qVisible = Boolean(qEl && !qEl.hidden);
      try {
        document.body?.classList?.toggle?.('has-approval-dock', apVisible);
        document.body?.classList?.toggle?.('has-upper-dock', apVisible || qVisible);
      } catch {}
    }

    function renderQuickChipsBar(snap) {
      const chips = $('chips');
      if (!chips) return;
      const items = [];
      items.push({
        cls: 'chip chip-mode-toggle' + (quickDirectMode ? ' active' : ''),
        text: quickDirectMode ? '⚡直发' : '✎填入',
        raw: quickDirectMode ? 'direct' : 'insert',
        isModeToggle: true,
        act: () => {
          quickDirectMode = !quickDirectMode;
          try { localStorage.setItem(QUICK_DIRECT_MODE_KEY, quickDirectMode ? '1' : '0'); } catch {}
          chips.dataset.sig = '';
          renderQuickChipsBar(latestSnap || snap);
          showToast(quickDirectMode ? '已切换为「⚡直发」模式（固定快捷提示词点一下立即发送）' : '已切换为「✎填入」模式（点一下先填进输入框）');
          return { ok: true };
        }
      });

      const quickList = (Array.isArray(snap?.quickPrompts) && snap.quickPrompts.length)
        ? snap.quickPrompts
        : DEFAULT_CLIENT_QUICK_PROMPTS;
      const quickItems = [];
      const quickNormSet = new Set();
      const builtInPrompts = ${serializeRemoteTemplateData(builtInPrompts)};
      for (const qp of quickList) {
        if (!qp || !qp.label || !qp.text) continue;
        const builtIn = Object.hasOwn(builtInPrompts, qp.id) ? builtInPrompts[qp.id] : null;
        const isBuiltIn = builtIn?.label === qp.label && builtIn?.text === qp.text;
        const label = isBuiltIn ? builtIn.labelTw : qp.label;
        const text = isBuiltIn ? builtIn.textTw : qp.text;
        const normText = String(qp.text).trim().toLowerCase();
        const normLabel = String(qp.label).trim().toLowerCase();
        if (normText) quickNormSet.add(normText);
        quickNormSet.add(String(text).trim().toLowerCase());
        if (normLabel) quickNormSet.add(normLabel);
        const isDirect = Boolean(quickDirectMode && qp.autoSend);
        quickItems.push({
          cls: isDirect ? 'chip quick-prompt direct' : 'chip quick-prompt',
          text: (isDirect ? '⚡ ' : '✎ ') + label,
          raw: text,
          qpLabel: label,
          qpAutoSend: Boolean(qp.autoSend),
          isQuickPrompt: true
        });
      }

      if (!snap?.busy) {
        const seenSuggest = new Set();
        const localizedSuggestions = ${serializeRemoteTemplateData(localizedSuggestions)};
        const shortSuggestionLabels = ${serializeRemoteTemplateData(shortSuggestionLabels)};
        for (const s of (snap?.suggestions || [])) {
          const source = String(s || '').trim();
          const clean = Object.hasOwn(localizedSuggestions, source) ? localizedSuggestions[source] : source;
          if (!clean) continue;
          const norm = clean.toLowerCase();
          if (seenSuggest.has(norm) || quickNormSet.has(norm)) continue;
          seenSuggest.add(norm);
          const label = Object.hasOwn(shortSuggestionLabels, clean) ? shortSuggestionLabels[clean] : clean;
          items.push({ cls: 'chip suggest', text: '✦ ' + label, raw: clean, qpLabel: label, isSuggest: true });
        }
      }

      for (const qi of quickItems) {
        items.push(qi);
      }

      items.push({ cls: 'chip', text: '/compact', act: () => apiAction({ action: 'send', text: '/compact' }) });
      items.push({
        cls: 'chip',
        text: '展开/收起思考',
        act: () => {
          const boxes = Array.from(document.querySelectorAll('#messages .thought-box'));
          if (!boxes.length) { showToast('当前消息暂无思考过程'); return { ok: true }; }
          const anyClosed = boxes.some((b) => !(b.open || (typeof b.hasAttribute === 'function' && b.hasAttribute('open'))));
          boxes.forEach((b) => {
            b.open = anyClosed;
            if (typeof b.setAttribute === 'function' && typeof b.removeAttribute === 'function') {
              if (anyClosed) b.setAttribute('open', '');
              else b.removeAttribute('open');
            }
            hydrateThoughtDetails(b);
          });
          return { ok: true };
        }
      });

      const chipsSig = JSON.stringify([quickDirectMode, items.map((it) => [it.cls, it.text, it.raw || ''])]);
      if (chips.dataset.sig !== chipsSig) {
        chips.dataset.sig = chipsSig;
        chips.innerHTML = '';
        for (const it of items) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = it.cls;
          b.textContent = it.text;
          if (it.isModeToggle) {
            b.dataset.role = 'quick-mode-toggle';
            b.setAttribute('aria-pressed', quickDirectMode ? 'true' : 'false');
            b.title = '切换快捷提示词点击模式：⚡直发 / ✎填入';
          } else if (it.isSuggest) {
            b.dataset.role = 'quick-suggest';
            b.title = quickDirectMode ? ('⚡ 建议直发：' + it.raw) : ('✎ 建议填入：' + it.raw);
          } else if (it.isQuickPrompt) {
            b.dataset.role = 'quick-prompt';
            b.title = (quickDirectMode && it.qpAutoSend) ? ('⚡ 直发：' + it.raw) : ('✎ 填入：' + it.raw);
          }
          bindButtonClick(b, async () => {
            try {
              if (it.isSuggest || it.isQuickPrompt) {
                const taEl = $('input');
                const supportsDirect = it.isSuggest ? true : Boolean(it.qpAutoSend);
                const displayLabel = it.qpLabel || it.raw;
                const hasAttachments = typeof uploadedNames !== 'undefined' && Array.isArray(uploadedNames) && uploadedNames.length > 0;
                const hasDraft = Boolean(taEl && taEl.value.trim());
                const hasDraftOrAttach = hasDraft || hasAttachments;
                if (quickDirectMode && supportsDirect && !hasDraftOrAttach) {
                  const nowTs = Date.now();
                  if ((nowTs - lastQuickSendAt) < 800) return;
                  lastQuickSendAt = nowTs;
                  stickBottom = true;
                  const r = await apiAction({ action: 'send', text: it.raw });
                  if (r?.ok) showToast('⚡ 已直发：' + displayLabel);
                  else showToast(r?.error || r?.actionResult?.error || '发送失败，请检查电脑端连接或网络后重试');
                } else {
                  if (taEl) {
                    const prev = taEl.value || '';
                    const insertText = String(it.raw || '');
                    if (!prev.trim()) {
                      taEl.value = insertText;
                    } else {
                      const sep = /[\\s\\n]$/.test(prev) ? '' : ' ';
                      taEl.value = prev + sep + insertText;
                    }
                    if (typeof autoGrow === 'function') autoGrow();
                    taEl.focus();
                  }
                  showToast((hasDraftOrAttach && quickDirectMode && supportsDirect)
                    ? ('已有草稿，已改为追加填入：' + displayLabel)
                    : ('已填入：' + displayLabel));
                }
              } else if (it.act) {
                const r = await it.act();
                if (r && !r.ok) showToast(r.error || r.actionResult?.error || '操作未生效，请检查电脑端状态后重试');
              }
            } catch (e) {
              showToast(humanizeRemoteError(e?.message, '操作未生效，请检查电脑端状态后重试'));
            }
          });
          chips.appendChild(b);
        }
      }
    }

    function shouldUseDrilldownDrawer(snap) {
      return Boolean(
        (!Array.isArray(snap?.projects) || !snap.projects.length) &&
        Array.isArray(snap?.projectGroups) &&
        snap.projectGroups.length > 0
      );
    }

    const CONV_VIEW_KEY = 'ag_remote_conv_view_v1';
    const COLLAPSED_PROJ_KEY = 'ag_remote_collapsed_projects_v1';
    let convViewMode = (() => {
      try {
        const v = localStorage.getItem(CONV_VIEW_KEY);
        return v === 'recent' ? 'recent' : 'projects';
      } catch {
        return 'projects';
      }
    })();
    let collapsedProjMap = (() => {
      try {
        const raw = localStorage.getItem(COLLAPSED_PROJ_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
      } catch {
        return {};
      }
    })();
    let recentDisplayLimit = 50;
    let nextGlobalOffset = 0;
    const projOffsetMap = new Map();
    const extraConvMap = new Map();
    let loadingMoreConvs = false;
    let lastSyncedCatalogRev = '';
    let syncingExtraConvs = false;
    let pendingCatalogRev = '';

    function saveConvUiPrefs() {
      try {
        localStorage.setItem(CONV_VIEW_KEY, convViewMode);
        localStorage.setItem(COLLAPSED_PROJ_KEY, JSON.stringify(collapsedProjMap));
      } catch {}
    }

    function syncConvTabsUi() {
      const tabsEl = $('conv-view-tabs');
      if (!tabsEl) return;
      tabsEl.querySelectorAll('.conv-tab').forEach((btn) => {
        const isActive = btn.getAttribute('data-conv-view') === convViewMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    function getMergedConversations(snap) {
      const merged = new Map();
      for (const [id, c] of extraConvMap.entries()) {
        if (id && c) merged.set(id, c);
      }
      for (const c of (Array.isArray(snap?.conversations) ? snap.conversations : [])) {
        if (c && c.id) merged.set(c.id, c);
      }
      return Array.from(merged.values()).sort((a, b) =>
        (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) ||
        ((Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)) ||
        String(a.id).localeCompare(String(b.id))
      );
    }

    async function fetchPagedConversations(url) {
      const res = await fetchWithTimeout((apiBase || '') + url, { headers: authHeaders(), cache: 'no-store' }, 5000);
      if (res.status === 401) { location.reload(); return null; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    }

    async function triggerRefreshExtraConversations(rev) {
      const targetRev = String(rev || '').trim();
      if (!targetRev || targetRev === lastSyncedCatalogRev) return;
      pendingCatalogRev = targetRev;
      if (syncingExtraConvs) return;
      syncingExtraConvs = true;
      try {
        while (pendingCatalogRev && pendingCatalogRev !== lastSyncedCatalogRev) {
          const reqRev = pendingCatalogRev;
          const rebuilt = new Map();
          let globalCoveredAll = false;
          let latestRespRev = '';

          if (nextGlobalOffset > 0) {
            const lim = Math.max(nextGlobalOffset, extraConvMap.size, 150);
            const data = await fetchPagedConversations('/api/conversations?offset=0&limit=' + lim);
            if (!data) break;
            const rows = Array.isArray(data.conversations) ? data.conversations : [];
            for (const c of rows) {
              if (c && c.id) rebuilt.set(c.id, c);
            }
            globalCoveredAll = !data.hasMore;
            const tot = Number(data.total);
            nextGlobalOffset = Math.min(Math.max(nextGlobalOffset, rows.length), Number.isFinite(tot) ? tot : rows.length);
            if (data.catalogRevision) latestRespRev = String(data.catalogRevision);
          }

          if (!globalCoveredAll && projOffsetMap.size > 0) {
            for (const [pid, pOff] of Array.from(projOffsetMap.entries())) {
              if (!(pOff > 0)) continue;
              const lim = Math.max(pOff, 150);
              const data = await fetchPagedConversations('/api/conversations?offset=0&limit=' + lim + '&projectId=' + encodeURIComponent(pid));
              if (!data) continue;
              const rows = Array.isArray(data.conversations) ? data.conversations : [];
              for (const c of rows) {
                if (c && c.id) rebuilt.set(c.id, c);
              }
              const tot = Number(data.total);
              projOffsetMap.set(pid, Math.min(Math.max(pOff, rows.length), Number.isFinite(tot) ? tot : rows.length));
              if (data.catalogRevision) latestRespRev = String(data.catalogRevision);
            }
          }

          const curSid = String(latestSnap?.sessionId || '');
          extraConvMap.clear();
          for (const [id, c] of rebuilt.entries()) {
            const isAct = Boolean(curSid && id === curSid);
            extraConvMap.set(id, { ...c, active: isAct, unread: isAct ? false : Boolean(c.unread) });
          }
          lastSyncedCatalogRev = latestRespRev || reqRev;
          if (pendingCatalogRev === reqRev || pendingCatalogRev === lastSyncedCatalogRev) {
            pendingCatalogRev = '';
          }
          if (latestSnap) renderConversationList(latestSnap);
        }
      } catch {
      } finally {
        syncingExtraConvs = false;
      }
    }

    function reconcileExtraConversations(snap) {
      const rev = String(snap?.catalogRevision || '').trim();
      if (extraConvMap.size === 0 && nextGlobalOffset === 0 && projOffsetMap.size === 0) {
        if (rev) lastSyncedCatalogRev = rev;
        return;
      }
      const activeSid = String(snap?.sessionId || '');
      const snapConvs = Array.isArray(snap?.conversations) ? snap.conversations : [];
      for (const c of snapConvs) {
        if (c && c.id && extraConvMap.has(c.id)) {
          extraConvMap.set(c.id, c);
        }
      }
      for (const [id, c] of extraConvMap.entries()) {
        if (!c) continue;
        const isAct = Boolean(activeSid && id === activeSid);
        if (Boolean(c.active) !== isAct || (isAct && c.unread)) {
          extraConvMap.set(id, { ...c, active: isAct, unread: isAct ? false : Boolean(c.unread) });
        }
      }
      if (rev && rev !== lastSyncedCatalogRev) {
        void triggerRefreshExtraConversations(rev);
      }
    }

    async function loadMoreConversations(opts = {}) {
      if (loadingMoreConvs) return;
      loadingMoreConvs = true;
      try {
        const wasEmpty = extraConvMap.size === 0 && nextGlobalOffset === 0 && projOffsetMap.size === 0;
        const pid = String(opts.projectId || '').trim();
        const offset = pid ? (projOffsetMap.get(pid) || 0) : nextGlobalOffset;
        const limit = 150;
        let q = '/api/conversations?offset=' + offset + '&limit=' + limit;
        if (pid) q += '&projectId=' + encodeURIComponent(pid);
        const data = await fetchPagedConversations(q);
        if (!data) return;
        const rows = Array.isArray(data?.conversations) ? data.conversations : [];
        const curSid = String(latestSnap?.sessionId || '');
        for (const c of rows) {
          if (!c || !c.id) continue;
          const isAct = Boolean(curSid && c.id === curSid);
          extraConvMap.set(c.id, { ...c, active: isAct, unread: isAct ? false : Boolean(c.unread) });
        }
        if (pid) {
          projOffsetMap.set(pid, offset + rows.length);
        } else {
          nextGlobalOffset = offset + rows.length;
          recentDisplayLimit = Math.max(recentDisplayLimit + rows.length, extraConvMap.size);
        }
        if (wasEmpty && data?.catalogRevision) {
          lastSyncedCatalogRev = String(data.catalogRevision);
        }
        if (latestSnap) renderConversationList(latestSnap);
      } catch (err) {
        showToast(humanizeRemoteError(err?.message, '加载更多会话失败，请重试'));
      } finally {
        loadingMoreConvs = false;
      }
    }

    function formatRelTime(ts) {
      const n = Number(ts) || 0;
      if (!n || n <= 0) return '';
      const diff = Math.max(0, Date.now() - n);
      const mins = Math.floor(diff / 60000);
      if (mins < 2) return '刚刚';
      if (mins < 60) return mins + 'm';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h';
      const days = Math.floor(hrs / 24);
      return days + 'd';
    }

    function statusDotHtml(c) {
      if (c.status === 'waiting') return '<span class="c-dot waiting" title="待确认"></span>';
      if (c.status === 'running') return '<span class="c-dot running" title="运行中"></span>';
      if (c.status === 'error') return '<span class="c-dot error" title="异常中断"></span>';
      if (c.status === 'unknown') return '<span class="c-dot unknown" title="状态未知"></span>';
      if (c.unread) return '<span class="c-dot unread" title="有新结果"></span>';
      return '<span class="c-dot"></span>';
    }

    const BELL_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

    function renderConvItemHtml(c, showProjectName) {
      const isUnreadCompleted = Boolean((c.completedUnread ?? c.unread) && c.status !== 'running' && c.status !== 'waiting' && c.status !== 'error' && c.status !== 'unknown');
      const cls = 'conv-item' + (c.active ? ' active' : '') + (c.unread ? ' is-unread' : '');
      const titleText = (c.pinned ? '📌 ' : '') + String(c.title || c.id || '');
      let badgeHtml = '';
      if (c.status === 'waiting') {
        badgeHtml = '<span class="conv-bell-indicator" title="' + esc(remoteChromeLabel(c.statusLabel) || '待确认 / 待审批') + '" aria-label="待用户确认或审批">' + BELL_ICON_SVG + '<i class="conv-bell-dot"></i></span>';
      } else if (c.status === 'running') {
        badgeHtml = '<span class="c-badge running">' + esc(remoteChromeLabel(c.statusLabel) || '运行中') + '</span>';
      } else if (c.status === 'error') {
        badgeHtml = '<span class="c-badge error">' + esc(remoteChromeLabel(c.statusLabel) || '异常') + '</span>';
      } else if (c.status === 'unknown') {
        badgeHtml = '<span class="c-badge unknown">' + esc(remoteChromeLabel(c.statusLabel) || (${locale === 'zh-TW'} ? '狀態未知' : '未知')) + '</span>';
      } else if (isUnreadCompleted) {
        badgeHtml = '<span class="conv-unread-dot" title="已完成 · 有新产出" aria-label="未读新产出"></span>';
      }
      const rel = formatRelTime(c.updatedAt);
      const rightMeta = badgeHtml || (rel ? '<span class="c-time">' + esc(rel) + '</span>' : '');
      let subHtml = '';
      if (showProjectName || (badgeHtml && rel)) {
        const subParts = [];
        if (showProjectName && c.projectName) subParts.push(remoteProjectDisplayName(c.projectName, c.projectId));
        if (rel) subParts.push(rel);
        if (subParts.length) subHtml = '<div class="c-sub">' + esc(subParts.join(' · ')) + '</div>';
      }
      return '<button class="' + cls + '" data-cid="' + esc(c.id) + '" type="button">' +
        '<div class="c-row">' + statusDotHtml(c) + '<span class="c-title">' + esc(titleText) + '</span>' + rightMeta + '</div>' +
        subHtml + '</button>';
    }

    const FOLDER_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    const FOLDER_SM_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

    let clientPrevConvStatus = new Map();
    let clientNotifyBootstrapped = false;
    function maybeTriggerLocalNotifications(convs) {
      if (!Array.isArray(convs)) return;
      if (!clientNotifyBootstrapped) {
        for (const c of convs) {
          if (c && c.id) clientPrevConvStatus.set(c.id, c.status || 'unknown');
        }
        clientNotifyBootstrapped = true;
        return;
      }
      const canPop = !cachedHasActiveWebPush && isLocalNotifyEnabled() && typeof Notification === 'function' && Notification.permission === 'granted';
      for (const c of convs) {
        if (!c || !c.id) continue;
        const prev = clientPrevConvStatus.get(c.id);
        const cur = c.status || 'unknown';
        clientPrevConvStatus.set(c.id, cur);
        if (!canPop || !prev) continue;
        if (prev === 'running' && cur === 'idle' && c.completedUnread === true) {
          showLocalSystemNotification('对话已完成', (c.title || 'Antigravity 对话') + (c.projectName ? (' · ' + remoteProjectDisplayName(c.projectName, c.projectId)) : ''), c.id);
        } else if (prev !== 'waiting' && cur === 'waiting') {
          showLocalSystemNotification('需要你的确认', (c.title || 'Antigravity 对话')
            + (${locale === 'zh-TW'} && c.projectName ? '（' + remoteProjectDisplayName(c.projectName, c.projectId) + '）' : '')
            + ' 正在等待确认或审批', c.id);
        }
      }
    }

    function renderConversationList(snap) {
      const convList = $('conv-list');
      if (!convList || !snap) return;
      const convs = getMergedConversations(snap);
      syncAppBadgeCount(computeClientCompletedUnreadCount(convs));
      maybeTriggerLocalNotifications(convs);
      if (pendingOpenConvId && convs.some((c) => c && c.id === pendingOpenConvId)) {
        const targetOpenId = pendingOpenConvId;
        pendingOpenConvId = '';
        if (typeof switchConversationById === 'function') {
          void switchConversationById(targetOpenId);
        }
      }
      const totalAllCount = Math.max(convs.length, Number(snap.totalConversations) || 0);
      const rawProjects = Array.isArray(snap.projects) ? snap.projects : [];
      const projMap = new Map();
      const grouped = new Map();

      for (const p of rawProjects) {
        if (!p || !p.id) continue;
        projMap.set(p.id, p);
        grouped.set(p.id, []);
      }
      for (const c of convs) {
        const pid = c.projectId || 'ungrouped';
        if (!projMap.has(pid)) {
          projMap.set(pid, {
            id: pid,
            name: c.projectName || (pid === 'ungrouped' ? '未归属项目' : pid),
            conversationCount: 0,
            runningCount: 0,
            waitingCount: 0,
            isEmpty: false
          });
        }
        if (!grouped.has(pid)) grouped.set(pid, []);
        grouped.get(pid).push(c);
      }

      const projCountEl = $('tab-proj-count');
      const convCountEl = $('tab-conv-count');
      if (projCountEl) projCountEl.textContent = projMap.size ? ('(' + projMap.size + ')') : '';
      if (convCountEl) convCountEl.textContent = totalAllCount ? ('(' + totalAllCount + ')') : '';
      syncConvTabsUi();

      let html = '';
      if (convViewMode === 'recent') {
        if (!convs.length && !totalAllCount) {
          html = renderPanelStateHtml({
            icon: EMPTY_CHAT_ICON_SVG,
            compact: true,
            title: '暂无历史对话',
            desc: '新建一条对话即可开始使用',
            actionLabel: '＋ 新建对话',
            actionAttr: 'data-empty-action="new-chat"'
          });
        } else {
          const shown = convs.slice(0, recentDisplayLimit);
          html = shown.map((c) => renderConvItemHtml(c, true)).join('');
          if (shown.length < totalAllCount || snap.hasMoreConversations) {
            html += '<button class="conv-more-btn" data-conv-more="1" type="button">加载更多历史对话 (' + shown.length + '/' + totalAllCount + ')</button>';
          }
        }
      } else {
        const orderedProjects = Array.from(projMap.values()).filter((p) =>
          !isNonProjectBucket(p.id) || (p.conversationCount > 0) || ((grouped.get(p.id)?.length || 0) > 0)
        );
        const effProj = getEffectiveSelectedProject(snap);

        if (!orderedProjects.length) {
          html = renderPanelStateHtml({
            icon: EMPTY_FOLDER_ICON_SVG,
            compact: true,
            title: '暂无项目与对话',
            desc: '选择电脑目录新建项目，或直接发起对话',
            actionLabel: '新建项目',
            actionAttr: 'data-empty-action="new-project"'
          });
        } else {
          html = orderedProjects.map((p) => {
            const list = grouped.get(p.id) || [];
            const projTotal = Math.max(list.length, Number(p.conversationCount) || 0);
            const isEmptyProj = projTotal === 0 && list.length === 0;
            const hasRunning = (p.runningCount > 0) || list.some((x) => x.status === 'running');
            const hasWaiting = (p.waitingCount > 0) || list.some((x) => x.status === 'waiting');
            const collapsed = !isEmptyProj && Boolean(collapsedProjMap[p.id]);
            const isCurrentProj = Boolean(effProj.id && p.id === effProj.id);
            const isUngroupedProj = isNonProjectBucket(p.id);
            const groupCls = 'proj-group' + (isCurrentProj ? ' is-current' : '') + (isUngroupedProj ? ' is-ungrouped' : '') + (isEmptyProj ? ' is-empty' : '');
            const statDot = hasWaiting
              ? '<span class="proj-stat-dot waiting" title="有待确认操作"></span>'
              : (hasRunning ? '<span class="proj-stat-dot running" title="有运行中对话"></span>' : '');
            const newBtnHtml = !isUngroupedProj
              ? '<button class="proj-new-btn" data-new-proj="' + esc(p.id) + '" type="button" title="在 ' + esc(remoteProjectDisplayName(p.name, p.id)) + ' 中新建对话" aria-label="在 ' + esc(remoteProjectDisplayName(p.name, p.id)) + ' 中新建对话">+</button>'
              : '';
            const projMoreHtml = list.length < projTotal
              ? '<button class="conv-more-btn" data-proj-more="' + esc(p.id) + '" type="button">加载该项目更多对话 (' + list.length + '/' + projTotal + ')</button>'
              : '';
            const itemsHtml = (isEmptyProj || collapsed) ? '' : ('<div class="proj-body">' + list.map((c) => renderConvItemHtml(c, false)).join('') + projMoreHtml + '</div>');
            const chevChar = isEmptyProj ? '·' : (collapsed ? '▸' : '▾');
            const expandedAttr = isEmptyProj ? '' : (' aria-expanded="' + (collapsed ? 'false' : 'true') + '"');
            return '<div class="' + groupCls + '">' +
              '<div class="proj-head">' +
                '<button class="proj-toggle" data-proj-toggle="' + esc(p.id) + '" type="button"' + expandedAttr + '>' +
                  '<span class="proj-chev">' + chevChar + '</span>' +
                  '<span class="proj-icon">' + FOLDER_ICON_SVG + '</span>' +
                  '<span class="proj-name">' + esc(remoteProjectDisplayName(p.name, p.id)) + '</span>' +
                  statDot +
                  '<span class="proj-count">' + projTotal + '</span>' +
                '</button>' +
                newBtnHtml +
              '</div>' +
              itemsHtml +
            '</div>';
          }).join('');
        }
      }

      if (convList.dataset.lastHtml !== html) {
        convList.innerHTML = html;
        convList.dataset.lastHtml = html;
      }
    }

    function remoteProjectDisplayName(name, id) {
      return (!id || id === 'ungrouped') && sourceProjectLabels.includes(name) ? '未归属项目' : name;
    }

    function normalizeProjectGroups(snap) {
      const rawGroups = Array.isArray(snap?.projectGroups) ? snap.projectGroups : [];
      if (rawGroups.length) {
        return rawGroups.map((g, idx) => {
          const convs = Array.isArray(g.conversations) ? g.conversations : [];
          const name = String(g.name || '未命名项目').trim() || '未命名项目';
          const key = String(g.key || g.id || ('proj:' + idx + ':' + name));
          return {
            id: String(g.id || ''),
            key,
            name,
            count: Math.max(Number(g.count) || 0, convs.length),
            isCollapsed: Boolean(g.isCollapsed),
            active: Boolean(g.active || convs.some((c) => c.active)),
            conversations: convs
          };
        });
      }
      const convs = Array.isArray(snap?.conversations) ? snap.conversations : [];
      const map = new Map();
      for (const c of convs) {
        if (!c || !c.id) continue;
        const pName = String(c.project || '默认项目').trim() || '默认项目';
        if (!map.has(pName)) {
          map.set(pName, {
            id: '',
            key: 'proj:' + pName,
            name: pName,
            count: 0,
            isCollapsed: false,
            active: false,
            conversations: []
          });
        }
        const g = map.get(pName);
        g.conversations.push(c);
        g.count = g.conversations.length;
        if (c.active) g.active = true;
      }
      return Array.from(map.values());
    }

    function renderDrawerProjectsAndConversations(snap, animate) {
      const convList = $('conv-list');
      const navBar = $('drawer-nav-bar');
      if (!convList) return;
      const groups = normalizeProjectGroups(snap);
      let selectedGroup = activeDrawerProject
        ? groups.find((g) => g.key === activeDrawerProject || g.id === activeDrawerProject || g.name === activeDrawerProject)
        : null;
      if (activeDrawerProject && !selectedGroup) {
        activeDrawerProject = '';
      }

      if (animate && convList.classList) {
        convList.classList.remove('anim-enter');
        try { void convList.offsetWidth; } catch {}
        convList.classList.add('anim-enter');
      }

      if (selectedGroup) {
        if (navBar) {
          const navHtml = '<button id="btn-drawer-back" class="drawer-back-btn" type="button">‹ 返回项目</button>'
            + '<span class="drawer-proj-title" title="' + esc(remoteProjectDisplayName(selectedGroup.name, selectedGroup.id)) + '">📁 ' + esc(remoteProjectDisplayName(selectedGroup.name, selectedGroup.id)) + '</span>';
          if (navBar.dataset.lastHtml !== navHtml) {
            navBar.innerHTML = navHtml;
            navBar.dataset.lastHtml = navHtml;
          }
        }
        const convHtml = selectedGroup.conversations.length
          ? selectedGroup.conversations.map((c) =>
              '<button class="conv-item' + (c.active ? ' active' : '') + '" data-cid="' + esc(c.id) + '" type="button">' + esc(c.title) + '</button>'
            ).join('')
          : renderPanelStateHtml({
              icon: EMPTY_CHAT_ICON_SVG,
              compact: true,
              title: '该项目暂无可切换会话',
              desc: '点击上方「新建对话」即可在该项目下开始'
            });
        if (convList.dataset.lastHtml !== convHtml) {
          convList.innerHTML = convHtml;
          convList.dataset.lastHtml = convHtml;
        }
        return;
      }

      if (navBar) {
        const navHtml = '<span class="drawer-sub">项目列表 (' + groups.length + ')</span>';
        if (navBar.dataset.lastHtml !== navHtml) {
          navBar.innerHTML = navHtml;
          navBar.dataset.lastHtml = navHtml;
        }
      }
      const projHtml = groups.length
        ? groups.map((g) =>
            '<button class="proj-item' + (g.active ? ' active' : '') + '" data-proj-key="' + esc(g.key) + '" type="button">'
            + '<span class="proj-item-left"><span>📁</span><span class="proj-item-name">' + esc(remoteProjectDisplayName(g.name, g.id)) + '</span>'
            + (g.active ? '<span class="mode-pill cur">当前</span>' : '')
            + '</span>'
            + '<span class="proj-item-right"><span class="lat-badge muted">' + esc(g.count) + '</span><span>›</span></span>'
            + '</button>'
          ).join('')
        : renderPanelStateHtml({
            icon: EMPTY_FOLDER_ICON_SVG,
            compact: true,
            title: '暂无历史项目',
            desc: '桌面端打开项目后会自动同步到此处'
          });
      if (convList.dataset.lastHtml !== projHtml) {
        convList.innerHTML = projHtml;
        convList.dataset.lastHtml = projHtml;
      }
    }

    async function fetchSnapshot() {
      if (snapshotInflight) return;
      snapshotInflight = true;
      const mySeq = ++snapshotSeq;
      const fetchStartEpoch = ++clientSyncEpoch;
      const qs = [];
      if (currentTargetId) qs.push('targetId=' + encodeURIComponent(currentTargetId));
      if (selectedConversationId) qs.push('conversationId=' + encodeURIComponent(selectedConversationId));
      const q = qs.length ? '?' + qs.join('&') : '';
      const doFetch = () => {
        if (activeSnapAbort) { try { activeSnapAbort.abort(); } catch {} }
        activeSnapAbort = typeof AbortController === 'function' ? new AbortController() : null;
        return fetchWithTimeout((apiBase || '') + '/api/snapshot' + q, { headers: authHeaders(), cache: 'no-store' }, latestSnap ? 5000 : 6500, activeSnapAbort);
      };
      try {
        let res = await doFetch();
        if (res.status === 401) { location.reload(); return; }
        if (res.status === 403) throw new Error('channel_disabled');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (mySeq === snapshotSeq) renderSnapshot(data, { reqStartEpoch: fetchStartEpoch });
      } catch {
        if (mySeq !== snapshotSeq) return;
        syncChannelPillUi('connecting');
        $('sub-meta').textContent = '连接中断 · 正在切换可用通道…';
        if (latestSnap) {
          setConnBannerVisible(true, '与电脑端的连接已断开，正在尝试切换可用通道…');
        } else {
          renderModeEntryGate('正在自动尝试备用通道，也可直接点击已开启的方式立即进入：');
        }
        const switched = await tryFailoverEndpoint();
        if (switched && !navigatingAway) {
          try {
            const retryRes = await doFetch();
            if (retryRes.status === 401) { location.reload(); return; }
            if (retryRes.status === 403) throw new Error('channel_disabled');
            if (!retryRes.ok) throw new Error('HTTP ' + retryRes.status);
            const retryData = await retryRes.json();
            if (mySeq === snapshotSeq) renderSnapshot(retryData, { reqStartEpoch: fetchStartEpoch });
            return;
          } catch {}
        }
        if (navigatingAway) return;
        $('status-dot').className = 'dot err';
        syncChannelPillUi('offline');
        $('sub-meta').textContent = '连接中断，点击可切换连接方式';
        const fallbackHintEp = pickDirectFallbackHintEndpoint();
        const isCurrentQuickTunnel = String(apiBase || location.origin || '').toLowerCase().includes('.trycloudflare.com');
        if (latestSnap) {
          const bannerHint = isCurrentQuickTunnel
            ? (fallbackHintEp
                ? ('当前临时隧道域名可能已随电脑热更新/重启/休眠失效，建议点击右侧「切换连接方式」切往 ' + formatKindLabel(fallbackHintEp.kind) + '，或回电脑端重新扫码')
                : '当前临时隧道域名为一次性地址，电脑热更新/重启/休眠后旧网址会失效，请回电脑端「远程」重新扫码获取新地址')
            : (fallbackHintEp
                ? ('当前通道 (' + getActiveChannelLabel() + ') 已断开，建议点击右侧「切换连接方式」切往 ' + formatKindLabel(fallbackHintEp.kind))
                : '与电脑端连接已断开，可点击重试或切换连接方式');
          setConnBannerVisible(true, bannerHint);
        } else {
          renderModeEntryGate('当前入口暂未连通，请点击下方已开启的连接方式直接进入：');
        }
      } finally {
        if (mySeq === snapshotSeq) {
          snapshotInflight = false;
          activeSnapAbort = null;
          const retryBtnEl = $('conn-retry-btn');
          if (retryBtnEl) { retryBtnEl.disabled = false; retryBtnEl.textContent = '立即重试'; }
          schedulePoll();
        }
      }
    }

    if ($('conn-retry-btn')) {
      $('conn-retry-btn').onclick = () => {
        const retryBtnEl = $('conn-retry-btn');
        if (retryBtnEl) { retryBtnEl.disabled = true; retryBtnEl.textContent = '重试中…'; }
        void fetchSnapshot();
      };
    }
    if ($('conn-switch-btn')) {
      $('conn-switch-btn').onclick = () => {
        closeTopDrawers();
        openModeSwitcherSheet();
      };
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      if (document.hidden || navigatingAway) return;
      const ms = latestSnap?.busy ? 900 : 2500;
      pollTimer = setTimeout(fetchSnapshot, ms);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void fetchSnapshot();
      } else {
        clearTimeout(pollTimer);
      }
    });
    window.addEventListener('pageshow', () => { void fetchSnapshot(); });

    async function handleSheetListClick(e) {
      const btn = e?.target?.closest?.('.sheet-opt');
      if (!btn || !activeSheetState) return;
      const idx = Number(btn.getAttribute('data-idx'));
      const opt = activeSheetState.options[idx];
      if (!opt || opt.disabled) return;
      const onSelect = activeSheetState.onSelect;
      activeSheetState = null;
      closeSheet();
      if (opt && typeof onSelect === 'function') await onSelect(opt);
    }
    const sheetListEl = $('sheet-list');
    sheetListEl.onclick = handleSheetListClick;
    if (!(typeof EventTarget === 'function' && sheetListEl instanceof EventTarget) && typeof sheetListEl.addEventListener === 'function') {
      sheetListEl.addEventListener('click', handleSheetListClick);
    }
    function openSheet(title, options, onSelect) {
      configureSheetChrome({
        kind: 'generic',
        title,
        subText: '',
        showSpeed: false,
        onBack: null
      });
      const listEl = $('sheet-list');
      activeSheetState = { options, onSelect };
      listEl.innerHTML = options.map((o, idx) =>
        '<button class="sheet-opt' + (o.active ? ' active' : '') + (o.disabled ? ' disabled' : '') + '" data-idx="' + idx + '" type="button"' + (o.disabled ? ' disabled' : '') + '>' +
        '<span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left">' +
        '<span>' + esc(o.label) + '</span>' +
        (o.sub ? '<span style="font-size:11.5px;color:var(--muted);font-weight:400;line-height:1.4">' + esc(o.sub) + '</span>' : '') +
        '</span>' +
        (o.active ? '<span>✓</span>' : '') + '</button>'
      ).join('');
      listEl.onclick = handleSheetListClick;
      $('sheet-backdrop').hidden = false;
      syncViewportHeight();
    }
    $('sheet-close').onclick = closeSheet;
    $('sheet-backdrop').onclick = (e) => {
      if (e.target === $('sheet-backdrop')) closeSheet();
    };

    const EFFORT_META = {
      max: { label: '最高 · Max', short: 'Max', rank: 0 },
      xhigh: { label: '超高 · XHigh', short: 'XHigh', rank: 1 },
      high: { label: '高 · High', short: 'High', rank: 2 },
      medium: { label: '中 · Medium', short: 'Medium', rank: 3 },
      low: { label: '低 · Low', short: 'Low', rank: 4 }
    };

    function groupModelsByBaseId(modelOptions, currentModelLabel) {
      const groups = [];
      const groupMap = new Map();
      for (const m of (modelOptions || [])) {
        if (!m || !m.label) continue;
        const rawLabel = String(m.label).trim();
        const rawModelId = String(m.modelId || '').trim();
        const idMatch = rawModelId.match(/^(.*?)-(xhigh|high|medium|low|max)$/i);
        const lblMatch = rawLabel.match(/^(.*?)\\s*\\((XHigh|High|Medium|Low|Max)\\)\\s*$/i);
        const effortKey = idMatch
          ? idMatch[2].toLowerCase()
          : (lblMatch ? lblMatch[2].toLowerCase() : '');
        const baseModelId = idMatch
          ? idMatch[1].toLowerCase()
          : (rawModelId || (lblMatch ? lblMatch[1].trim() : rawLabel)).toLowerCase();
        const baseLabel = lblMatch ? lblMatch[1].trim() : rawLabel;
        const meta = EFFORT_META[effortKey] || { label: effortKey || rawLabel, short: effortKey || '', rank: 9 };
        const isActive = Boolean(m.selected || rawLabel === currentModelLabel);

        if (!groupMap.has(baseModelId)) {
          const g = {
            baseModelId,
            baseLabel,
            active: false,
            hasEffortChoice: false,
            variants: []
          };
          groupMap.set(baseModelId, g);
          groups.push(g);
        }
        const grp = groupMap.get(baseModelId);
        if (isActive) grp.active = true;
        grp.variants.push({
          label: rawLabel,
          modelId: rawModelId,
          effortKey,
          effortLabel: meta.label,
          effortShort: meta.short,
          rank: meta.rank,
          active: isActive
        });
      }
      for (const grp of groups) {
        grp.variants.sort((a, b) => a.rank - b.rank);
        grp.hasEffortChoice = grp.variants.length > 1;
      }
      return groups;
    }

    async function applyModelSelection(opt) {
      if (!opt) return;
      showToast('正在切换至 ' + opt.label + '…');
      try {
        const r = await apiAction({ action: 'select-model', label: opt.label, modelId: opt.modelId });
        if (r?.ok) showToast('已切换到 ' + (r.actionResult?.model || opt.label));
        else showToast(r?.error || r?.actionResult?.error || '切换模型失败，请确认电脑端窗口在线后重试');
      } catch (err) {
        showToast(humanizeRemoteError(err?.message, '切换模型失败，请确认电脑端窗口在线后重试'));
      }
    }

    function openModelPicker() {
      activeSheetState = null;
      const groups = groupModelsByBaseId(latestSnap?.modelOptions || [], latestSnap?.model || '');
      if (!groups.length) {
        showToast('未检测到可用模型列表');
        return;
      }
      configureSheetChrome({
        kind: 'model',
        title: '切换模型',
        subText: '',
        showSpeed: false,
        onBack: null
      });
      const listEl = $('sheet-list');
      const groupsHtml = groups.map((g, gIdx) => {
        const activeVar = g.variants.find((v) => v.active);
        const effPill = (g.hasEffortChoice && activeVar?.effortShort)
          ? '<span class="mode-pill cur">' + esc(activeVar.effortShort) + '</span>'
          : '';
        const rightTag = g.hasEffortChoice
          ? ('<span class="lat-badge muted">' + g.variants.length + ' 档 ›</span>')
          : (g.active ? '<span>✓</span>' : '');
        return '<button class="sheet-opt' + (g.active ? ' active' : '') + '" data-group-idx="' + gIdx + '" type="button">'
          + '<span class="sheet-opt-left">'
          + '<span class="sheet-opt-top"><span>' + esc(g.baseLabel) + '</span>' + effPill + '</span>'
          + (g.baseModelId ? ('<span class="sheet-opt-host">' + esc(g.baseModelId) + '</span>') : '')
          + '</span>'
          + '<span class="sheet-opt-right">' + rightTag + '</span>'
          + '</button>';
      }).join('');

      listEl.innerHTML =
        '<div class="sheet-stage-viewport">'
        + '<div id="sheet-stage-track" class="sheet-stage-track">'
        + '<div id="model-group-pane" class="sheet-stage-pane">' + groupsHtml + '</div>'
        + '<div id="model-effort-pane" class="sheet-stage-pane"></div>'
        + '</div>'
        + '</div>';

      const findPane = (id) => $(id) || listEl.querySelector?.('#' + id) || null;
      listEl.onclick = async (e) => {
        const varBtn = e.target?.closest?.('[data-variant-idx]');
        if (varBtn) {
          const g = groups[Number(varBtn.dataset.groupIdx)];
          const v = g?.variants?.[Number(varBtn.dataset.variantIdx)];
          closeSheet();
          if (v) await applyModelSelection(v);
          return;
        }
        const grpBtn = e.target?.closest?.('[data-group-idx]');
        if (!grpBtn) return;
        const gIdx = Number(grpBtn.dataset.groupIdx);
        const g = groups[gIdx];
        if (!g) return;
        if (!g.hasEffortChoice) {
          closeSheet();
          await applyModelSelection(g.variants[0]);
          return;
        }
        const trackEl = findPane('sheet-stage-track');
        const groupPane = findPane('model-group-pane');
        const effortPane = findPane('model-effort-pane');
        if (groupPane) {
          groupPane.querySelectorAll?.('.sheet-opt.sliding-out')?.forEach?.((el) => el.classList.remove('sliding-out'));
        }
        grpBtn.classList?.add?.('sliding-out');
        if (effortPane) {
          effortPane.innerHTML = g.variants.map((v, vIdx) =>
            '<button class="sheet-opt' + (v.active ? ' active' : '') + '" data-group-idx="' + gIdx + '" data-variant-idx="' + vIdx + '" type="button">'
            + '<span class="sheet-opt-left">'
            + '<span class="sheet-opt-top"><span>' + esc(v.effortLabel) + '</span>' + (v.active ? '<span class="mode-pill cur">当前</span>' : '') + '</span>'
            + '<span class="sheet-opt-host">' + esc(v.modelId || v.label) + '</span>'
            + '</span>'
            + '<span class="sheet-opt-right">' + (v.active ? '<span>✓</span>' : '') + '</span>'
            + '</button>'
          ).join('');
        }
        if (trackEl) trackEl.classList.add('step-effort');
        configureSheetChrome({
          kind: 'model-effort',
          title: g.baseLabel,
          subText: '选择思考等级 · ' + g.baseModelId,
          showSpeed: false,
          onBack: () => {
            if (trackEl) trackEl.classList.remove('step-effort');
            if (groupPane) {
              groupPane.querySelectorAll?.('.sheet-opt.sliding-out')?.forEach?.((el) => el.classList.remove('sliding-out'));
            }
            configureSheetChrome({
              kind: 'model',
              title: '切换模型',
              subText: '',
              showSpeed: false,
              onBack: null
            });
          }
        });
      };
      $('sheet-backdrop').hidden = false;
    }

    const PERM_ICONS = {
      turbo: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
      auto: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11.2 14.2 15.5 10"/></svg>',
      default: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
      request_review: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.8"/></svg>',
      unknown: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
    };

    function resolvePermKey(rawKey, rawLabel) {
      const k = String(rawKey || '').trim().toLowerCase();
      if (k === 'turbo' || k === 'auto' || k === 'default' || k === 'request_review') return k;
      const lbl = String(rawLabel || '').trim().toLowerCase();
      if (!lbl) return 'unknown';
      if (new RegExp(${serializeRemoteTemplateData(/(?:turbo|无限|無限|unrestricted)/.source)}, 'i').test(lbl)) return 'turbo';
      if (new RegExp(${serializeRemoteTemplateData(/(?:request_review|review|请求审核|请求审查|請求審核|請求審查|审核|审查|審核|審查)/.source)}, 'i').test(lbl)) return 'request_review';
      if (new RegExp(${serializeRemoteTemplateData(/(?:\bauto\b|自动|自動)/.source)}, 'i').test(lbl)) return 'auto';
      if (new RegExp(${serializeRemoteTemplateData(/(?:\bdefault\b|默认|預設)/.source)}, 'i').test(lbl)) return 'default';
      return 'unknown';
    }

    const localizedPermissionLabels = ${serializeRemoteTemplateData(permissionLabels)};

    function remotePermissionDisplayLabel(key, label) {
      const localized = localizedPermissionLabels[resolvePermKey(key, label)];
      if (!localized) return ${locale === 'zh-TW'} && label ? '未知權限' : label;
      const icon = String(label || '').match(/^[⚡🛡️🔒👁]+\\s*/u)?.[0] || '';
      return icon + localized;
    }

    function syncPermInlineUi(rawKey, rawLabel) {
      const mode = resolvePermKey(rawKey, rawLabel);
      const lblEl = $('perm-inline-label');
      if (lblEl) {
        lblEl.textContent = String(remotePermissionDisplayLabel(mode, rawLabel) || '').trim() || ({ turbo: '无限', auto: '自动', default: '默认', request_review: '请求审核' }[mode]) || '权限';
      }
      const icoEl = $('perm-inline-icon');
      if (icoEl) {
        icoEl.className = 'perm-ico ' + mode;
        icoEl.setAttribute('data-perm-mode', mode);
        const svgHtml = PERM_ICONS[mode] || PERM_ICONS.unknown;
        if (icoEl.dataset.svgMode !== mode) {
          icoEl.innerHTML = svgHtml;
          icoEl.dataset.svgMode = mode;
        }
      }
    }

    let activeMsgSessionId = null;
    let activeMsgHistorySource = '';
    let msgCacheEpoch = 0;
    const sessionMsgsByIndex = new Map();
    const openThoughtIdxSet = new Set();
    let loadingEarlierMsgs = false;
    let backfillingMsgGaps = false;

    function parseNonNegativeInt(v) {
      if (typeof v === 'number') return (Number.isSafeInteger(v) && v >= 0) ? v : null;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (/^\\d+$/.test(trimmed)) {
          const n = Number(trimmed);
          return (Number.isSafeInteger(n) && n >= 0) ? n : null;
        }
      }
      return null;
    }

    function getThoughtFallbackText(m) {
      if (!m) return '';
      if (m.thoughtText) return String(m.thoughtText);
      if (Array.isArray(m.thoughts) && m.thoughts.length) {
        return m.thoughts.map((t) => String(t || '').trim()).filter(Boolean).join('\\n\\n');
      }
      return '';
    }

    function buildThoughtBodyInnerHtml(m) {
      if (!m) return '';
      const steps = Array.isArray(m.thoughts) && m.thoughts.length > 1
        ? m.thoughts.map((t) => String(t || '').trim()).filter(Boolean)
        : [];
      if (steps.length > 1) {
        return steps.map((txt, idx) => (
          '<div class="thought-step"><div class="thought-step-hd">步骤 ' + (idx + 1) + '</div><div class="thought-step-txt">' + esc(txt) + '</div></div>'
        )).join('');
      }
      return esc(getThoughtFallbackText(m));
    }

    function hydrateThoughtDetails(detailsEl) {
      if (!detailsEl) return;
      const idx = Number(detailsEl.getAttribute('data-thought-idx'));
      if (!Number.isFinite(idx)) return;
      const isOpen = Boolean(detailsEl.open || (typeof detailsEl.hasAttribute === 'function' && detailsEl.hasAttribute('open')));
      if (isOpen) {
        openThoughtIdxSet.add(idx);
        if (!detailsEl.querySelector('.thought-body')) {
          const m = sessionMsgsByIndex.get(idx);
          const fallbackTxt = getThoughtFallbackText(m);
          if (fallbackTxt || (Array.isArray(m?.thoughts) && m.thoughts.length)) {
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'thought-body';
            if (Array.isArray(m.thoughts) && m.thoughts.length > 1) {
              bodyDiv.innerHTML = buildThoughtBodyInnerHtml(m);
            } else {
              bodyDiv.textContent = fallbackTxt;
            }
            detailsEl.appendChild(bodyDiv);
          }
        }
      } else {
        openThoughtIdxSet.delete(idx);
      }
    }

    function getOrderedSessionMessages() {
      return Array.from(sessionMsgsByIndex.values()).sort((a, b) => (a.msgIndex - b.msgIndex));
    }

    function findMissingMsgRanges(totalCount) {
      if (sessionMsgsByIndex.size === 0) return [];
      const keys = Array.from(sessionMsgsByIndex.keys()).sort((a, b) => a - b);
      const minIdx = keys[0];
      const maxKey = keys[keys.length - 1];
      const maxEnd = (Number.isFinite(totalCount) && totalCount > 0) ? Math.max(totalCount, maxKey + 1) : (maxKey + 1);
      const keySet = new Set(keys);
      const ranges = [];
      let gapStart = -1;
      for (let idx = minIdx; idx < maxEnd; idx++) {
        if (!keySet.has(idx)) {
          if (gapStart < 0) gapStart = idx;
        } else if (gapStart >= 0) {
          ranges.push([gapStart, idx]);
          gapStart = -1;
        }
      }
      if (gapStart >= 0) ranges.push([gapStart, maxEnd]);
      return ranges;
    }

    async function backfillMissingMsgGaps(expectedSid) {
      if (backfillingMsgGaps || !expectedSid || expectedSid === '__new__' || expectedSid !== activeMsgSessionId || activeMsgHistorySource !== 'trajectory') return;
      const reqEpoch = msgCacheEpoch;
      backfillingMsgGaps = true;
      try {
        while (reqEpoch === msgCacheEpoch && expectedSid === activeMsgSessionId && activeMsgHistorySource === 'trajectory') {
          const totalCount = parseNonNegativeInt(latestSnap?.totalMessages);
          if (totalCount === null) break;
          const ranges = findMissingMsgRanges(totalCount);
          if (!ranges.length) break;
          const [gapStart, gapEnd] = ranges[0];
          let cursorEnd = gapEnd;
          let progressed = false;
          while (cursorEnd > gapStart && reqEpoch === msgCacheEpoch && expectedSid === activeMsgSessionId && activeMsgHistorySource === 'trajectory') {
            const chunkLim = Math.max(1, Math.min(200, cursorEnd - gapStart));
            const q = '/api/messages?sessionId=' + encodeURIComponent(expectedSid) + '&before=' + cursorEnd + '&limit=' + chunkLim;
            const res = await fetchWithTimeout((apiBase || '') + q, { headers: authHeaders(), cache: 'no-store' }, 5000);
            if (res.status === 401) { location.reload(); return; }
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (reqEpoch !== msgCacheEpoch || expectedSid !== activeMsgSessionId || activeMsgHistorySource !== 'trajectory') return;
            const rows = Array.isArray(data?.messages) ? data.messages : [];
            if (!rows.length) break;
            const parsedStart = parseNonNegativeInt(data?.startIndex);
            const baseIdx = parsedStart !== null ? parsedStart : Math.max(0, cursorEnd - rows.length);
            for (let i = 0; i < rows.length; i++) {
              const m = rows[i];
              if (!m) continue;
              const parsedMIdx = parseNonNegativeInt(m.msgIndex);
              const mIdx = parsedMIdx !== null ? parsedMIdx : (baseIdx + i);
              sessionMsgsByIndex.set(mIdx, { ...m, msgIndex: mIdx });
              progressed = true;
            }
            renderMessagesView(latestSnap);
            if (baseIdx >= cursorEnd) break;
            cursorEnd = baseIdx;
          }
          if (!progressed) break;
        }
      } catch {
      } finally {
        if (reqEpoch === msgCacheEpoch) {
          backfillingMsgGaps = false;
        }
      }
    }

    function setMsgScrollTop(nextTop) {
      const maxScroll = Math.max(0, (msgEl.scrollHeight || 0) - (msgEl.clientHeight || 0));
      const clamped = (msgEl.scrollHeight > 0 && msgEl.clientHeight > 0)
        ? Math.max(0, Math.min(maxScroll, nextTop))
        : Math.max(0, nextTop);
      programmaticScrollTop = clamped;
      msgEl.scrollTop = clamped;
    }

    function measureMsgViewportMetrics(el) {
      if (!el || typeof el.offsetTop !== 'number') return null;
      const byOffset = el.offsetTop - msgEl.scrollTop;
      const er = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      const br = typeof msgEl.getBoundingClientRect === 'function' ? msgEl.getBoundingClientRect() : null;
      const h = (typeof el.offsetHeight === 'number' && el.offsetHeight > 0) ? el.offsetHeight : (er?.height || 0);
      if (er && br && Number.isFinite(er.top) && Number.isFinite(br.top) && Math.abs((er.top - br.top) - byOffset) < 4) {
        return { offset: er.top - br.top, height: er.height || h };
      }
      return { offset: byOffset, height: h };
    }

    function captureReadingAnchor() {
      const fallbackTop = msgEl.scrollTop;
      const nodes = msgEl.querySelectorAll('[data-msg-idx]');
      if (!nodes.length) return { msgIndex: null, viewportOffset: 0, fallbackTop };
      let chosen = null;
      let chosenMetrics = null;
      for (let i = 0; i < nodes.length; i++) {
        const m = measureMsgViewportMetrics(nodes[i]);
        if (!m) return { msgIndex: null, viewportOffset: 0, fallbackTop };
        chosen = nodes[i];
        chosenMetrics = m;
        if (m.offset + m.height > 0.5 || (m.height === 0 && m.offset >= 0)) {
          break;
        }
      }
      if (!chosen || !chosenMetrics) return { msgIndex: null, viewportOffset: 0, fallbackTop };
      const idx = Number(chosen.getAttribute('data-msg-idx'));
      if (!Number.isFinite(idx)) return { msgIndex: null, viewportOffset: 0, fallbackTop };
      return { msgIndex: idx, viewportOffset: chosenMetrics.offset, fallbackTop };
    }

    function restoreReadingAnchor(anchor) {
      if (!anchor) return;
      if (anchor.msgIndex !== null && anchor.msgIndex !== undefined) {
        const targetEl = msgEl.querySelector('[data-msg-idx="' + anchor.msgIndex + '"]');
        const curMetrics = measureMsgViewportMetrics(targetEl);
        if (curMetrics) {
          setMsgScrollTop(msgEl.scrollTop + (curMetrics.offset - anchor.viewportOffset));
          return;
        }
      }
      setMsgScrollTop(anchor.fallbackTop);
    }

    function renderMessagesView(snap, opts = {}) {
      const msgs = getOrderedSessionMessages();
      if (!msgs.length && !snap?.busy) {
        const isNewProj = Boolean(snap?.isNewConversation && snap?.currentProjectName);
        const canOpenDrawer = !isDesktopLayout() || document.body.classList.contains('sidebar-collapsed');
        const emptyHtml = renderPanelStateHtml({
          icon: EMPTY_CHAT_ICON_SVG,
          title: isNewProj ? ('在「' + snap.currentProjectName + '」开始新对话') : '暂无对话消息',
          desc: isNewProj
            ? '在下方输入问题、上传图片或文件，或点选快捷提示词即可开始'
            : ('在下方输入消息即可开始' + (isDesktopLayout() ? '，或在左侧列表切换历史会话' : '，或右滑切换历史会话')),
          actionId: (!isNewProj && canOpenDrawer) ? 'empty-open-drawer-btn' : '',
          actionLabel: (!isNewProj && canOpenDrawer) ? '浏览历史会话' : ''
        });
        if (msgEl.dataset.lastHtml !== emptyHtml) {
          msgEl.innerHTML = emptyHtml;
          msgEl.dataset.lastHtml = emptyHtml;
        }
        return;
      }

      const earliestIdx = msgs.length ? Math.max(0, Number(msgs[0].msgIndex) || 0) : 0;
      let html = '';
      if (earliestIdx > 0) {
        html += '<button class="load-earlier-btn" id="btn-load-earlier" data-before="' + earliestIdx + '" type="button"' +
          (loadingEarlierMsgs ? ' disabled' : '') + '>' +
          (loadingEarlierMsgs ? '正在加载更早内容…' : ('↑ 加载更早的对话内容（前 ' + earliestIdx + ' 条）')) + '</button>';
      }
      html += msgs.map((m) => {
        if (m.role === 'system-notice') {
          return '<div class="compact-done-pill" data-msg-idx="' + m.msgIndex + '">' + esc(m.text || ${JSON.stringify(locale === 'zh-TW' ? localizeRemoteText('✓ 上下文已完成压缩') : '✓ 上下文已完成压缩')}) + '</div>';
        }
        if (m.role === 'user') {
          const atts = Array.isArray(m.attachments) ? m.attachments : [];
          let attHtml = '';
          let renderedImgCount = 0;
          const getShortExt = (name) => {
            const rawName = String(name || '').trim();
            const dot = rawName.lastIndexOf('.');
            if (dot > 0 && dot < rawName.length - 1) return rawName.slice(dot + 1).slice(0, 6).toUpperCase();
            return 'FILE';
          };
          if (atts.length) {
            const tiles = atts.map((att) => {
              const safeInline = (typeof att.inlineUrl === 'string' && /^data:image\\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(att.inlineUrl)) ? att.inlineUrl : '';
              if (att.kind === 'image' && (safeInline || att.path)) {
                renderedImgCount += 1;
                const mediaSrc = safeInline || ((apiBase || '') + '/api/media?path=' + encodeURIComponent(att.path) + (apiBase && pairState.token ? ('&token=' + encodeURIComponent(pairState.token)) : ''));
                const label = att.name || '图片';
                return '<img class="msg-att-img" src="' + esc(mediaSrc) + '" alt="' + esc(label) + '" title="' + esc(label) + '" loading="lazy" data-preview-src="' + esc(mediaSrc) + '" />';
              }
              const fName = att.name || '附件';
              const ext = getShortExt(fName);
              return '<button class="msg-att-file" type="button" data-file-path="' + esc(att.path || '') + '" title="' + esc(att.path || fName) + '" aria-label="' + esc(fName) + '"><span class="attach-file-icon" aria-hidden="true">📄</span><span class="att-ext">' + esc(ext) + '</span></button>';
            }).join('');
            if (tiles) attHtml = '<div class="msg-atts above-user">' + tiles + '</div>';
          }
          let userText = String((renderedImgCount > 0 ? m.text : m.displayText ?? m.text) || '');
          if (renderedImgCount > 0) {
            userText = userText
              .replace(new RegExp(${serializeRemoteTemplateData(/\n?\[附带\s*\d+\s*张图片\]\s*$/.source)}, 'g'), '')
              .replace(new RegExp(${serializeRemoteTemplateData(/^\[图片附件\]$/.source)}), '')
              .trim();
          }
          if (attHtml) {
            const bubbleHtml = userText ? ('<div class="msg user"><div>' + esc(userText) + '</div></div>') : '';
            return '<div class="msg-user-group" data-msg-idx="' + m.msgIndex + '">' + attHtml + bubbleHtml + '</div>';
          }
          return '<div class="msg user" data-msg-idx="' + m.msgIndex + '">' + (userText ? ('<div>' + esc(userText) + '</div>') : '') + '</div>';
        }
        const risk = m.highRisk ? '<span class="risk-tag">' + esc(m.riskText || '🛡️ 检测到高危命令，请人工核对') + '</span>' : '';
        const hasThoughtBody = Boolean(m.thoughtText || (Array.isArray(m.thoughts) && m.thoughts.length));
        const isThoughtOpen = Boolean(hasThoughtBody && openThoughtIdxSet.has(m.msgIndex));
        const tCount = Math.max(Number(m.thoughtCount) || 0, Array.isArray(m.thoughts) ? m.thoughts.length : 0);
        const stepBadge = tCount > 1 ? (' · 共 ' + tCount + ' 步') : '';
        const thought = (m.thoughtLabel || hasThoughtBody)
          ? '<details class="thought-box" data-thought-idx="' + m.msgIndex + '"' + (isThoughtOpen ? ' open' : '') + '><summary>' +
              '<span class="thought-sum-left"><span class="thought-caret">▸</span><span>💡 ' + esc(m.thoughtLabel || '思考过程') + stepBadge + '</span>' +
              (hasThoughtBody ? '<span class="thought-sum-meta"><span class="thought-cue-open">展开</span><span class="thought-cue-close">收起</span></span>' : '') +
              '</span>' +
              (hasThoughtBody ? '<button class="thought-all-btn" type="button" title="一键展开或收起当前会话的全部思考过程">全部</button>' : '') +
            '</summary>' +
            (isThoughtOpen ? '<div class="thought-body">' + buildThoughtBodyInnerHtml(m) + '</div>' : '') + '</details>'
          : '';
        const hasBodyText = Boolean(String(m.html || '').trim() || String(m.text || '').trim());
        const bodyHtml = hasBodyText
          ? (m.html ? '<div class="md-body">' + m.html + '</div>' : '<div class="md-body">' + renderMarkdownSafe(m.text || '') + '</div>')
          : '';
        const thoughtOnlyCls = (!hasBodyText && !m.highRisk && thought) ? ' is-thought-only' : '';
        return '<div class="msg assistant' + (m.highRisk ? ' is-risk' : '') + thoughtOnlyCls + '" data-msg-idx="' + m.msgIndex + '">' + risk + thought + bodyHtml + '</div>';
      }).join('');
      if (snap?.busy) {
        html += '<div class="busy-pill" role="status" aria-live="polite"><span class="busy-spark"></span><span>正在思考与执行…</span></div>';
      } else if (msgs.length) {
        const lastM = msgs[msgs.length - 1];
        const compactBlocked = Boolean(
          snap?.ok === false
          || snap?.error
          || snap?.lastError
          || snap?.status === 'error'
          || (Array.isArray(snap?.pendingApprovals) && snap.pendingApprovals.length)
          || (Array.isArray(snap?.pendingPrompts) && snap.pendingPrompts.length)
        );
        if (!compactBlocked && lastM && lastM.role === 'user' && /^\\/compact(?:\\s|$)/i.test(String(lastM.text || '').trim())) {
          html += '<div class="compact-done-pill">' + ${JSON.stringify(locale === 'zh-TW'
            ? localizeRemoteText('✓ 上下文已完成压缩') : '✓ 上下文已完成压缩')} + '</div>';
        }
      }

      if (msgEl.dataset.lastHtml !== html) {
        const shouldPreserve = !stickBottom || Boolean(opts.preserveAnchor);
        const anchor = shouldPreserve ? captureReadingAnchor() : null;
        msgEl.innerHTML = html;
        msgEl.dataset.lastHtml = html;
        if (!shouldPreserve) {
          programmaticScrollTop = msgEl.scrollHeight;
          msgEl.scrollTop = msgEl.scrollHeight;
        } else if (anchor) {
          restoreReadingAnchor(anchor);
        }
      }
    }

    async function loadEarlierMessages() {
      const msgs = getOrderedSessionMessages();
      const earliestIdx = msgs.length ? Math.max(0, Number(msgs[0].msgIndex) || 0) : 0;
      const reqSid = activeMsgSessionId;
      if (loadingEarlierMsgs || !reqSid || reqSid === '__new__' || activeMsgHistorySource !== 'trajectory' || !(earliestIdx > 0)) return;
      const reqEpoch = msgCacheEpoch;
      loadingEarlierMsgs = true;
      const btn = $('btn-load-earlier');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在加载更早内容…';
      }
      try {
        const q = '/api/messages?sessionId=' + encodeURIComponent(reqSid) + '&before=' + earliestIdx + '&limit=30';
        const res = await fetchWithTimeout((apiBase || '') + q, { headers: authHeaders(), cache: 'no-store' }, 5000);
        if (res.status === 401) {
          if (reqEpoch === msgCacheEpoch) loadingEarlierMsgs = false;
          location.reload();
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (reqEpoch !== msgCacheEpoch || reqSid !== activeMsgSessionId || activeMsgHistorySource !== 'trajectory') return;
        const rows = Array.isArray(data?.messages) ? data.messages : [];
        const parsedStart = parseNonNegativeInt(data?.startIndex);
        const baseIdx = parsedStart !== null ? parsedStart : Math.max(0, earliestIdx - rows.length);
        stickBottom = false;
        for (let i = 0; i < rows.length; i++) {
          const m = rows[i];
          if (!m) continue;
          const parsedMIdx = parseNonNegativeInt(m.msgIndex);
          const mIdx = parsedMIdx !== null ? parsedMIdx : (baseIdx + i);
          sessionMsgsByIndex.set(mIdx, { ...m, msgIndex: mIdx });
        }
        loadingEarlierMsgs = false;
        renderMessagesView(latestSnap, { preserveAnchor: true });
      } catch (err) {
        if (reqEpoch === msgCacheEpoch && reqSid === activeMsgSessionId) {
          loadingEarlierMsgs = false;
          msgEl.dataset.lastHtml = '';
          renderMessagesView(latestSnap);
          showToast(err?.message || '加载更早消息失败');
        }
      }
    }

    function openPermPicker() {
      const curKey = resolvePermKey(latestSnap?.permissionKey, latestSnap?.permissionLabel);
      const cur = (latestSnap?.permissionLabel || '').toLowerCase();
      const opts = (latestSnap?.permissionOptions || [
        { key: 'turbo', label: '⚡ 无限 (Turbo)' },
        { key: 'auto', label: '🛡️ 自动 (Auto)' },
        { key: 'default', label: '🔒 默认 (Default)' },
        { key: 'request_review', label: '👁️ 请求审核 (Review)' }
      ]).map((p) => ({
        key: p.key,
        label: remotePermissionDisplayLabel(p.key, p.label),
        active: curKey !== 'unknown' ? (p.key === curKey) : Boolean(cur && p.label.toLowerCase().includes(cur))
      }));
      openSheet('切换权限预设', opts, async (opt) => {
        showToast('正在切换权限…');
        try {
          const r = await apiAction({ action: 'select-permission', preset: opt.key });
          if (r?.ok) {
            syncPermInlineUi(r.actionResult?.permissionKey || opt.key, r.actionResult?.permissionLabel || opt.label);
            showToast('已切换权限: ' + remotePermissionDisplayLabel(r.actionResult?.permissionKey || opt.key, r.actionResult?.permissionLabel || opt.label));
          } else {
            showToast(r?.error || r?.actionResult?.error || '切换权限失败，请确认电脑端窗口在线后重试');
          }
        } catch (err) {
          showToast(humanizeRemoteError(err?.message, '切换权限失败，请确认电脑端窗口在线后重试'));
        }
      });
    }

    function bindButtonClick(el, fn) {
      if (!el || typeof fn !== 'function') return;
      const seenEvents = typeof WeakSet === 'function' ? new WeakSet() : null;
      const isNativeTarget = typeof EventTarget === 'function' && el instanceof EventTarget;
      const wrapped = (e) => {
        if (e && typeof e === 'object') {
          if (seenEvents) {
            if (seenEvents.has(e)) return;
            seenEvents.add(e);
          } else if (e.__agClickHandled) {
            return;
          } else {
            try { e.__agClickHandled = true; } catch {}
          }
        }
        return fn(e);
      };
      el.onclick = wrapped;
      if (!isNativeTarget && typeof el.addEventListener === 'function') {
        el.addEventListener('click', wrapped);
      }
    }

    bindButtonClick($('btn-model-inline'), openModelPicker);
    bindButtonClick($('btn-perm-inline'), openPermPicker);

    const THEME_STORAGE_KEY = 'ag_remote_theme_v1';
    const lightSchemeMq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

    function normalizeThemePref(raw) {
      return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
    }
    function readStoredThemePref() {
      try { return normalizeThemePref(localStorage.getItem(THEME_STORAGE_KEY)); } catch { return 'system'; }
    }
    let activeThemePref = readStoredThemePref();
    function resolveEffectiveTheme(pref) {
      if (pref === 'light' || pref === 'dark') return pref;
      return lightSchemeMq && lightSchemeMq.matches ? 'light' : 'dark';
    }
    function applyTheme(rawPref, persist = false) {
      const pref = normalizeThemePref(rawPref);
      activeThemePref = pref;
      if (persist) {
        try { localStorage.setItem(THEME_STORAGE_KEY, pref); } catch {}
      }
      const effective = resolveEffectiveTheme(pref);
      const docEl = document.documentElement;
      docEl.setAttribute('data-theme', effective);
      docEl.setAttribute('data-theme-pref', pref);
      docEl.style.colorScheme = effective;
      const metaColor = $('meta-theme-color');
      if (metaColor) metaColor.setAttribute('content', effective === 'light' ? '#f8fafc' : '#09090b');

      const seg = $('theme-seg');
      if (seg) {
        seg.querySelectorAll('.theme-seg-btn').forEach((btn) => {
          const active = btn.getAttribute('data-theme-mode') === pref;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      }
      return { pref, effective };
    }
    function selectThemePref(nextPref) {
      const { pref, effective } = applyTheme(nextPref, true);
      const effText = effective === 'light' ? '浅色' : '深色';
      showToast(pref === 'system' ? ('已设为跟随系统（当前' + effText + '）') : ('已切换为固定' + effText));
    }
    const themeSegEl = $('theme-seg');
    if (themeSegEl) {
      themeSegEl.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('.theme-seg-btn');
        const mode = btn?.getAttribute?.('data-theme-mode');
        if (!mode) return;
        selectThemePref(mode);
      });
    }
    const pushSettingsBtnEl = $('btn-push-settings');
    if (pushSettingsBtnEl) {
      pushSettingsBtnEl.addEventListener('click', () => {
        void openPushSettingsSheet();
      });
      void refreshPushButtonState();
    }
    if (lightSchemeMq) {
      const onSystemSchemeChange = () => {
        if (activeThemePref === 'system') applyTheme('system', false);
      };
      if (typeof lightSchemeMq.addEventListener === 'function') lightSchemeMq.addEventListener('change', onSystemSchemeChange);
      else if (typeof lightSchemeMq.addListener === 'function') lightSchemeMq.addListener(onSystemSchemeChange);
    }
    window.addEventListener('storage', (e) => {
      if (e && e.key === THEME_STORAGE_KEY) applyTheme(e.newValue, false);
    });
    applyTheme(activeThemePref, false);

    // 拍照/传图压缩并注入桌面端输入框
    let uploadedNames = [];
    function compressAndReadImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const lowType = String(file.type || '').toLowerCase();
          if (file.size <= 350 * 1024 && ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(lowType)) {
            resolve({ name: file.name || 'image.jpg', mimeType: file.type, base64: dataUrl });
            return;
          }
          const img = new Image();
          img.onerror = () => resolve({ name: file.name || 'image.jpg', mimeType: file.type || 'image/jpeg', base64: dataUrl });
          img.onload = () => {
            const maxDim = 1920;
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > maxDim || h > maxDim) {
              const scale = maxDim / Math.max(w, h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const outUrl = canvas.toDataURL('image/jpeg', 0.85);
            const baseName = (file.name || 'mobile').replace(/\\.[^.]+$/, '') + '.jpg';
            resolve({ name: baseName, mimeType: 'image/jpeg', base64: outUrl });
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    }

    let uploadedAttachments = [];
    const restoredQueueEditTextKeys = new Set();
    let attachmentUploadInflight = 0;
    let lastAttachmentUploadAt = 0;
    function formatFileSizeShort(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function openMediaLightbox(src, alt) {
      const lb = $('media-lightbox');
      const img = $('media-lightbox-img');
      if (!lb || !img || !src) return;
      img.src = src;
      img.alt = alt || '图片预览';
      lb.hidden = false;
    }
    function closeMediaLightbox() {
      const lb = $('media-lightbox');
      if (lb) lb.hidden = true;
    }
    $('media-lightbox-close')?.addEventListener('click', closeMediaLightbox);
    $('media-lightbox')?.addEventListener('click', (e) => {
      if (e.target === $('media-lightbox')) closeMediaLightbox();
    });
    msgEl.addEventListener('click', (e) => {
      if (e.target?.closest?.('#empty-open-drawer-btn')) {
        $('btn-drawer')?.click?.();
        return;
      }
      const img = e.target?.closest?.('.msg-att-img');
      if (img) {
        openMediaLightbox(img.dataset.previewSrc || img.src, img.alt);
        return;
      }
      const fileLink = e.target?.closest?.('.md-file-link, .msg-att-file');
      if (fileLink && fileLink.dataset.filePath) {
        e.preventDefault();
        void openFilePreviewModal(fileLink.dataset.filePath, Number(fileLink.dataset.fileLine || 0));
      }
    });

    const fvState = { tab: 'tree', curDir: '', viewingFile: false, returnTab: 'tree' };
    function closeFileViewerModal() {
      const bd = $('file-viewer-backdrop');
      if (bd) bd.hidden = true;
    }
    function syncFvChrome() {
      const tabsEl = $('fv-tabs');
      const backBtn = $('fv-back-btn');
      if (tabsEl) tabsEl.hidden = fvState.viewingFile;
      if (backBtn) backBtn.hidden = !fvState.viewingFile;
      $('fv-tab-tree')?.classList.toggle('active', fvState.tab === 'tree');
      $('fv-tab-changes')?.classList.toggle('active', fvState.tab === 'changes');
    }
    function resolveCurrentProjectRootDir() {
      const snap = latestSnap;
      if (!snap) return '';
      const pid = normalizeProjectId(snap.currentProjectId);
      const projs = Array.isArray(snap.projects) ? snap.projects : [];
      const matched = pid ? projs.find((p) => p && p.id === pid) : null;
      return String(matched?.path || matched?.workspacePath || snap.currentProjectPath || '').trim();
    }
    function renderCodeWithLineNumbers(text, hlLine) {
      const lines = String(text || '').split(/\\r?\\n/);
      return '<pre class="fv-code">' + lines.map((ln, idx) => {
        const n = idx + 1;
        const isHl = hlLine > 0 && n === hlLine;
        return '<span class="fv-code-line' + (isHl ? ' hl' : '') + '" data-ln="' + n + '"><span class="fv-ln">' + n + '</span>' + esc(ln) + '</span>';
      }).join('\\n') + '</pre>';
    }
    function renderUnifiedDiffHtml(diffText) {
      const lines = String(diffText || '').split(/\\r?\\n/);
      return '<pre class="fv-code">' + lines.map((ln) => {
        const cls = ln.startsWith('+') && !ln.startsWith('+++') ? ' fv-diff-add'
          : (ln.startsWith('-') && !ln.startsWith('---') ? ' fv-diff-del'
            : (ln.startsWith('@@') || ln.startsWith('diff ') ? ' fv-diff-hdr' : ''));
        return '<span class="fv-code-line' + cls + '">' + esc(ln) + '</span>';
      }).join('\\n') + '</pre>';
    }
    async function openFilePreviewModal(filePath, hlLine = 0) {
      const bd = $('file-viewer-backdrop');
      const body = $('fv-body');
      const title = $('fv-title');
      if (!bd || !body || !filePath) return;
      fvState.returnTab = fvState.tab;
      fvState.viewingFile = true;
      bd.hidden = false;
      syncFvChrome();
      if (title) title.textContent = String(filePath).split('/').pop() || filePath;
      body.innerHTML = renderSkeletonRowsHtml(6);
      const showFileErr = (errMsg) => {
        body.innerHTML = renderPanelStateHtml({
          isError: true,
          title: '无法读取文件内容',
          desc: humanizeRemoteError(errMsg, '读取文件失败，请确认文件存在且处于允许访问的目录内'),
          actionId: 'fv-file-retry',
          actionLabel: '重试读取'
        });
        const retryBtn = $('fv-file-retry');
        if (retryBtn) retryBtn.onclick = () => { void openFilePreviewModal(filePath, hlLine); };
      };
      try {
        const res = await fetchWithTimeout((apiBase || '') + '/api/file-content?path=' + encodeURIComponent(filePath), { headers: authHeaders(), cache: 'no-store' }, 6000);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          showFileErr(data?.error || ('HTTP ' + res.status));
          return;
        }
        if (title) title.textContent = data.name || filePath;
        const pathBar = '<div class="fv-path-bar">' + esc(data.path || filePath) + '</div>';
        if (data.isImage) {
          const mediaSrc = (apiBase || '') + '/api/media?path=' + encodeURIComponent(data.path) + (apiBase && pairState.token ? ('&token=' + encodeURIComponent(pairState.token)) : '');
          body.innerHTML = pathBar + '<img src="' + esc(mediaSrc) + '" style="max-width:100%;border-radius:10px;border:1px solid var(--border)" alt="' + esc(data.name || '') + '" />';
        } else if (data.isBinary || data.isTooLargeForText) {
          body.innerHTML = pathBar + renderPanelStateHtml({
            icon: EMPTY_CHANGES_ICON_SVG,
            title: '暂不支持直接预览该文件',
            desc: data.error || ('该文件为二进制或体积较大 (' + formatFileSizeShort(data.size) + ')，暂不支持纯文本预览')
          });
        } else if (data.isMarkdown && !hlLine) {
          body.innerHTML = pathBar + '<div class="md-body">' + renderMarkdownSafe(data.content || '') + '</div>';
        } else {
          body.innerHTML = pathBar + renderCodeWithLineNumbers(data.content || '', hlLine);
          if (hlLine > 0) {
            const target = body.querySelector('[data-ln="' + hlLine + '"]');
            if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
          }
        }
      } catch (err) {
        showFileErr(err?.message);
      }
    }
    async function loadProjectTreeView(targetDir) {
      const body = $('fv-body');
      const title = $('fv-title');
      if (!body) return;
      fvState.tab = 'tree';
      fvState.viewingFile = false;
      syncFvChrome();
      if (title) title.textContent = '项目文件';
      body.innerHTML = renderSkeletonRowsHtml(6);
      const dirParam = targetDir || fvState.curDir || resolveCurrentProjectRootDir();
      const showTreeErr = (errMsg) => {
        body.innerHTML = renderPanelStateHtml({
          isError: true,
          title: '读取项目文件失败',
          desc: humanizeRemoteError(errMsg, '无法加载项目目录，请检查电脑端连接后重试'),
          actionId: 'fv-tree-retry',
          actionLabel: '重试加载'
        });
        const retryBtn = $('fv-tree-retry');
        if (retryBtn) retryBtn.onclick = () => { void loadProjectTreeView(targetDir); };
      };
      try {
        const qs = dirParam ? ('?dir=' + encodeURIComponent(dirParam)) : '';
        const res = await fetchWithTimeout((apiBase || '') + '/api/project-tree' + qs, { headers: authHeaders(), cache: 'no-store' }, 6000);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          showTreeErr(data?.error || ('HTTP ' + res.status));
          return;
        }
        fvState.curDir = data.dir || '';
        const upBtn = data.parentDir ? '<button class="fv-up-btn" id="fv-tree-up" type="button">↑ 上级</button>' : '';
        const rows = (data.entries || []).map((ent) =>
          '<button class="fv-row" type="button" data-is-dir="' + (ent.isDir ? '1' : '0') + '" data-path="' + esc(ent.path) + '">'
          + '<span class="fv-row-name">' + (ent.isDir ? '📁 ' : '📄 ') + esc(ent.name) + '</span>'
          + '<span class="fv-row-meta">' + (ent.isDir ? '›' : esc(formatFileSizeShort(ent.size))) + '</span>'
          + '</button>'
        ).join('');
        const emptyDirHtml = renderPanelStateHtml({
          icon: EMPTY_FOLDER_ICON_SVG,
          compact: true,
          title: '当前目录为空',
          desc: '该文件夹下暂无文件或子目录',
          actionId: data.parentDir ? 'fv-empty-up-btn' : '',
          actionLabel: data.parentDir ? '返回上级目录' : ''
        });
        body.innerHTML = '<div class="fv-path-bar">' + upBtn + '<span>' + esc(data.dir || '') + '</span></div>'
          + '<div class="fv-list">' + (rows || emptyDirHtml) + '</div>';
        $('fv-tree-up')?.addEventListener('click', () => { void loadProjectTreeView(data.parentDir); });
        $('fv-empty-up-btn')?.addEventListener('click', () => { void loadProjectTreeView(data.parentDir); });
        body.querySelectorAll('.fv-row').forEach((row) => {
          row.onclick = () => {
            const p = row.dataset.path;
            if (!p) return;
            if (row.dataset.isDir === '1') void loadProjectTreeView(p);
            else void openFilePreviewModal(p, 0);
          };
        });
      } catch (err) {
        showTreeErr(err?.message);
      }
    }
    async function loadSessionChangesView() {
      const body = $('fv-body');
      const title = $('fv-title');
      if (!body) return;
      fvState.tab = 'changes';
      fvState.viewingFile = false;
      syncFvChrome();
      if (title) title.textContent = '本会话变更与产物';
      body.innerHTML = renderSkeletonRowsHtml(5);
      const cid = String(latestSnap?.activeConversationId || latestSnap?.sessionId || selectedConversationId || '').trim();
      const showChangesErr = (errMsg) => {
        body.innerHTML = renderPanelStateHtml({
          isError: true,
          title: '读取会话变更失败',
          desc: humanizeRemoteError(errMsg, '无法读取本次对话的改动与产物，请检查电脑端连接后重试'),
          actionId: 'fv-changes-retry',
          actionLabel: '重试加载'
        });
        const retryBtn = $('fv-changes-retry');
        if (retryBtn) retryBtn.onclick = () => { void loadSessionChangesView(); };
      };
      try {
        const res = await fetchWithTimeout((apiBase || '') + '/api/session-files?conversationId=' + encodeURIComponent(cid), { headers: authHeaders(), cache: 'no-store' }, 6000);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          showChangesErr(data?.error || ('HTTP ' + res.status));
          return;
        }
        const diffs = Array.isArray(data.diffs) ? data.diffs : [];
        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
        if (!diffs.length && !artifacts.length) {
          body.innerHTML = renderPanelStateHtml({
            icon: EMPTY_CHANGES_ICON_SVG,
            title: '当前会话暂无代码改动或产物',
            desc: '若有 AI 改动和产物会显示在这里',
            actionId: 'fv-go-tree-btn',
            actionLabel: '浏览项目文件'
          });
          $('fv-go-tree-btn')?.addEventListener('click', () => { void loadProjectTreeView(fvState.curDir); });
          return;
        }
        let htmlOut = '';
        if (artifacts.length) {
          htmlOut += '<div style="font-size:12px;font-weight:700;color:var(--muted);margin:4px 0 6px">生成文档与产物 (' + artifacts.length + ')</div><div class="fv-list" style="margin-bottom:12px">'
            + artifacts.map((art, idx) =>
              '<button class="fv-row fv-art-row" type="button" data-art-idx="' + idx + '"><span class="fv-row-name">✨ ' + esc(art.name || art.path || ('生成产物 ' + (idx + 1))) + '</span><span class="fv-row-meta">打开 ›</span></button>'
            ).join('') + '</div>';
        }
        if (diffs.length) {
          htmlOut += '<div style="font-size:12px;font-weight:700;color:var(--muted);margin:4px 0 6px">修改的文件 (' + diffs.length + ')</div><div class="fv-list">'
            + diffs.map((df, idx) =>
              '<button class="fv-row fv-diff-row" type="button" data-diff-idx="' + idx + '"><span class="fv-row-name">📝 ' + esc(df.name || df.path || ('文件 ' + (idx + 1))) + '</span><span class="fv-row-meta">查看改动 ›</span></button>'
            ).join('') + '</div>';
        }
        body.innerHTML = htmlOut;
        body.querySelectorAll('.fv-art-row').forEach((btn) => {
          btn.onclick = () => {
            const art = artifacts[Number(btn.dataset.artIdx)];
            if (!art) return;
            if (art.path) { void openFilePreviewModal(art.path, 0); return; }
            fvState.returnTab = 'changes';
            fvState.viewingFile = true;
            syncFvChrome();
            if (title) title.textContent = art.name || '生成产物';
            body.innerHTML = '<div class="md-body">' + renderMarkdownSafe(art.content || '') + '</div>';
          };
        });
        body.querySelectorAll('.fv-diff-row').forEach((btn) => {
          btn.onclick = () => {
            const df = diffs[Number(btn.dataset.diffIdx)];
            if (!df) return;
            fvState.returnTab = 'changes';
            fvState.viewingFile = true;
            syncFvChrome();
            if (title) title.textContent = df.name || df.path || '文件改动';
            if (df.diff) {
              body.innerHTML = '<div class="fv-path-bar">' + esc(df.path || '') + '</div>' + renderUnifiedDiffHtml(df.diff);
            } else if (df.path) {
              void openFilePreviewModal(df.path, 0);
            }
          };
        });
      } catch (err) {
        showChangesErr(err?.message);
      }
    }
    $('btn-files-panel')?.addEventListener('click', () => {
      const bd = $('file-viewer-backdrop');
      if (!bd) return;
      bd.hidden = false;
      fvState.curDir = resolveCurrentProjectRootDir() || fvState.curDir;
      void loadProjectTreeView(fvState.curDir);
    });
    $('fv-close-btn')?.addEventListener('click', closeFileViewerModal);
    $('file-viewer-backdrop')?.addEventListener('click', (e) => {
      if (e.target === $('file-viewer-backdrop')) closeFileViewerModal();
    });
    $('fv-back-btn')?.addEventListener('click', () => {
      if (fvState.returnTab === 'changes') void loadSessionChangesView();
      else void loadProjectTreeView(fvState.curDir);
    });
    $('fv-tab-tree')?.addEventListener('click', () => { void loadProjectTreeView(fvState.curDir); });
    $('fv-tab-changes')?.addEventListener('click', () => { void loadSessionChangesView(); });

    function readAttachmentFile(file) {
      if ((file?.size || 0) > 15 * 1024 * 1024) {
        return Promise.reject(new Error('单个文件不能超过 15MB'));
      }
      const isImg = /^image\\//i.test(String(file?.type || '')) && !/svg/i.test(String(file?.type || ''));
      if (isImg) {
        return compressAndReadImage(file).then((res) => ({
          ...res,
          size: file.size || 0,
          isImage: true,
          previewUrl: res.base64
        }));
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.onload = () => {
          resolve({
            name: file.name || ('file-' + Date.now()),
            mimeType: file.type || 'application/octet-stream',
            base64: String(reader.result || ''),
            size: file.size || 0,
            isImage: false,
            previewUrl: ''
          });
        };
        reader.readAsDataURL(file);
      });
    }

    function renderAttachHintStrip() {
      const hint = $('attach-hint');
      if (!hint) return;
      if (!uploadedAttachments.length) {
        hint.hidden = true;
        hint.innerHTML = '';
        return;
      }
      const getTileExt = (name) => {
        const s = String(name || '').trim();
        const dot = s.lastIndexOf('.');
        if (dot > 0 && dot < s.length - 1) return s.slice(dot + 1).slice(0, 6).toUpperCase();
        return 'FILE';
      };
      const stripHtml = uploadedAttachments.map((att, idx) => {
        if (att.isImage && att.previewUrl) {
          return '<span class="attach-thumb-wrap" data-att-idx="' + idx + '" title="' + esc(att.name) + '">'
            + '<img class="attach-thumb" src="' + esc(att.previewUrl) + '" alt="' + esc(att.name) + '" title="' + esc(att.name) + '" data-att-idx="' + idx + '" />'
            + '<button type="button" class="attach-item-rm" data-rm-idx="' + idx + '" title="移除 ' + esc(att.name) + '" aria-label="移除此图片">×</button>'
            + '</span>';
        }
        const ext = getTileExt(att.name);
        const tip = att.size ? (att.name + ' (' + formatFileSizeShort(att.size) + ')') : att.name;
        return '<span class="attach-file-chip" data-att-idx="' + idx + '" title="' + esc(tip) + '" aria-label="' + esc(att.name) + '">'
          + '<span class="attach-file-icon" aria-hidden="true">📄</span>'
          + '<span class="attach-file-ext">' + esc(ext) + '</span>'
          + '<button type="button" class="attach-item-rm" data-rm-idx="' + idx + '" title="移除 ' + esc(att.name) + '" aria-label="移除此文件">×</button>'
          + '</span>';
      }).join('');
      const clearAllHtml = uploadedAttachments.length >= 2
        ? '<button type="button" class="attach-clear-btn" title="清空全部附件">清空</button>'
        : '';
      hint.innerHTML = '<div class="attach-strip">' + stripHtml + '</div>' + clearAllHtml;
      const enqueueAttachSync = (taskFn) => {
        const hostObj = typeof globalThis !== 'undefined' ? globalThis : {};
        const base = hostObj.__agAttachDelQ && typeof hostObj.__agAttachDelQ.then === 'function'
          ? hostObj.__agAttachDelQ
          : Promise.resolve();
        const next = base.then(taskFn);
        hostObj.__agAttachDelQ = next.catch(() => {});
        return next;
      };
      hint.querySelectorAll('.attach-thumb').forEach((imgEl) => {
        imgEl.onclick = () => {
          const item = uploadedAttachments[Number(imgEl.dataset.attIdx)];
          if (item?.previewUrl) openMediaLightbox(item.previewUrl, item.name);
        };
      });
      hint.querySelectorAll('.attach-item-rm').forEach((rmBtn) => {
        rmBtn.onclick = (ev) => {
          ev.stopPropagation();
          const idx = Number(rmBtn.dataset.rmIdx);
          if (!Number.isInteger(idx) || idx < 0 || idx >= uploadedAttachments.length) return;
          const removed = uploadedAttachments.splice(idx, 1)[0];
          let removedNameIdx = -1;
          if (removed && uploadedNames[idx] === removed.name) {
            removedNameIdx = idx;
            uploadedNames.splice(idx, 1);
          } else {
            const nameIdx = removed ? uploadedNames.indexOf(removed.name) : idx;
            if (nameIdx >= 0) {
              removedNameIdx = nameIdx;
              uploadedNames.splice(nameIdx, 1);
            }
          }
          renderAttachHintStrip();
          syncSendButtonUI();
          const rollbackOne = (errMsg) => {
            if (removed) {
              uploadedAttachments.splice(Math.min(idx, uploadedAttachments.length), 0, removed);
              if (removedNameIdx >= 0) {
                uploadedNames.splice(Math.min(removedNameIdx, uploadedNames.length), 0, removed.name);
              } else {
                uploadedNames.push(removed.name);
              }
              renderAttachHintStrip();
              syncSendButtonUI();
            }
            showToast(errMsg || '桌面端附件同步移除失败，已恢复预览');
          };
          void enqueueAttachSync(() => apiAction({
            action: 'remove-uploaded-attachment',
            name: removed?.name || '',
            index: idx
          }, { skipAutoRender: true }).then((r) => {
            if (!r || r.ok === false) {
              rollbackOne(r?.error || r?.actionResult?.error || '桌面端附件同步移除失败，已恢复预览');
            }
          }).catch((err) => {
            rollbackOne(err?.message || '桌面端附件同步移除失败，已恢复预览');
          }));
        };
      });
      const clearBtn = hint.querySelector('.attach-clear-btn');
      if (clearBtn) {
        clearBtn.onclick = () => {
          const prevAtts = uploadedAttachments.slice();
          const prevNames = uploadedNames.slice();
          uploadedNames = [];
          uploadedAttachments = [];
          renderAttachHintStrip();
          syncSendButtonUI();
          const rollbackAll = (errMsg) => {
            uploadedAttachments = [...prevAtts, ...uploadedAttachments];
            uploadedNames = [...prevNames, ...uploadedNames];
            renderAttachHintStrip();
            syncSendButtonUI();
            showToast(errMsg || '桌面端附件清空失败，已恢复预览');
          };
          void enqueueAttachSync(() => apiAction({ action: 'remove-uploaded-attachment', clearAll: true }, { skipAutoRender: true }).then((r) => {
            if (!r || r.ok === false) {
              rollbackAll(r?.error || r?.actionResult?.error || '桌面端附件清空失败，已恢复预览');
            }
          }).catch((err) => {
            rollbackAll(err?.message || '桌面端附件清空失败，已恢复预览');
          }));
        };
      }
      hint.hidden = false;
    }

    async function uploadImageFiles(rawFiles) {
      const files = Array.from(rawFiles || []).filter(Boolean);
      if (!files.length) return;
      showToast('正在上传 ' + files.length + ' 个附件…');
      let okCount = 0;
      attachmentUploadInflight += 1;
      lastAttachmentUploadAt = Date.now();
      try {
        for (const f of files) {
          try {
            const payload = await readAttachmentFile(f);
            const r = await apiAction({ action: 'upload-image', name: payload.name, mimeType: payload.mimeType, base64: payload.base64 }, { skipAutoRender: true });
            lastAttachmentUploadAt = Date.now();
            if (r?.ok) {
              uploadedNames.push(payload.name);
              uploadedAttachments.push({
                name: payload.name,
                size: payload.size,
                isImage: payload.isImage,
                previewUrl: payload.previewUrl
              });
              okCount += 1;
            } else {
              showToast(r?.error || r?.actionResult?.error || '上传附件失败');
            }
          } catch (err) {
            showToast(err?.message || '上传附件失败');
          }
        }
      } finally {
        attachmentUploadInflight = Math.max(0, attachmentUploadInflight - 1);
        lastAttachmentUploadAt = Date.now();
      }
      if (uploadedAttachments.length) {
        renderAttachHintStrip();
        syncSendButtonUI();
        if (okCount > 0) showToast('✅ 附件已附带到输入框');
      }
    }

    $('btn-img').onclick = () => $('img-input').click();
    $('img-input').onchange = (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      void uploadImageFiles(files);
    };

    const composerCardEl = document.querySelector('.composer-card');
    let dragDepth = 0;
    const hasDraggedFiles = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    if (composerCardEl) {
      composerCardEl.addEventListener('dragenter', (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        dragDepth += 1;
        composerCardEl.classList.add('drag-over');
      });
      composerCardEl.addEventListener('dragover', (e) => {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        composerCardEl.classList.add('drag-over');
      });
      composerCardEl.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) composerCardEl.classList.remove('drag-over');
      });
      composerCardEl.addEventListener('drop', (e) => {
        dragDepth = 0;
        composerCardEl.classList.remove('drag-over');
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const droppedFiles = Array.from(e.dataTransfer?.files || []).filter(Boolean);
        if (droppedFiles.length) void uploadImageFiles(droppedFiles);
      });
    }
    document.addEventListener('dragover', (e) => {
      if (hasDraggedFiles(e)) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      dragDepth = 0;
      if (composerCardEl) composerCardEl.classList.remove('drag-over');
      if (hasDraggedFiles(e)) e.preventDefault();
    });

    if ($('btn-context-panel')) {
      $('btn-context-panel').onclick = (e) => {
        e.stopPropagation();
        openTopDrawer('context');
      };
    }
    if ($('btn-usage-panel')) {
      $('btn-usage-panel').onclick = (e) => {
        e.stopPropagation();
        openTopDrawer('usage');
      };
    }
    $('btn-quota').onclick = (e) => {
      e.stopPropagation();
      openTopDrawer('quota');
    };
    document.addEventListener('click', (e) => {
      // Drawer controls can replace the clicked element before the event bubbles here.
      const path = e.composedPath();
      const pairs = [
        ['context-drawer', 'btn-context-panel'],
        ['usage-drawer', 'btn-usage-panel'],
        ['quota-drawer', 'btn-quota']
      ];
      for (const [drawerId, btnId] of pairs) {
        const box = $(drawerId);
        const btn = $(btnId);
        if (box && !box.hidden && !path.includes(box) && !path.includes(btn)) {
          box.hidden = true;
        }
      }
      syncTopbarDrawerButtons();
    });

    const backdropEl = $('drawer-backdrop');
    const drawerEl = $('drawer-panel');
    function syncSidebarA11y() {
      const btnDrawer = $('btn-drawer');
      const visible = isDesktopLayout()
        ? !document.body.classList.contains('sidebar-collapsed')
        : backdropEl.classList.contains('open');
      if (!visible && backdropEl.contains(document.activeElement)) {
        try { document.activeElement.blur(); } catch {}
      }
      backdropEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if ('inert' in backdropEl) backdropEl.inert = !visible;
      if (btnDrawer) btnDrawer.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
    function openDrawer() {
      backdropEl.classList.remove('dragging');
      drawerEl.style.transform = '';
      backdropEl.style.backgroundColor = '';
      backdropEl.classList.add('open');
      syncSidebarA11y();
    }
    function closeDrawer() {
      backdropEl.classList.remove('dragging', 'open');
      drawerEl.style.transform = '';
      backdropEl.style.backgroundColor = '';
      syncSidebarA11y();
    }

    async function startNewConversationInProject(projectId, projectName) {
      const mySelEpoch = setUserSelectedProject(projectId, projectName);
      const pid = selectedProjectId;
      syncNewChatButtonUi(latestSnap);
      if (latestSnap) renderConversationList(latestSnap);
      if (!isDesktopLayout()) closeDrawer();
      stickBottom = true;
      const myNavSeqSnapshot = lastNavActionSeq;
      try {
        const payload = { action: 'new-conversation', isolated: true };
        if (pid) payload.projectId = pid;
        if (projectName) payload.projectName = projectName;
        const r = await apiAction(payload);
        const isCurrentNav = mySelEpoch === selectedProjectEpoch && lastNavActionSeq === myNavSeqSnapshot + 1;
        if (r?.ok) {
          if (isCurrentNav) {
            applySelectedConversation(String(r?.snapshot?.activeConversationId || r?.snapshot?.sessionId || '__new__'));
            showToast(projectName ? ('已在「' + projectName + '」中新建对话') : '已新建对话');
          }
        } else if (isCurrentNav) {
          showToast(r?.error || r?.actionResult?.error || '新建对话失败，请确认电脑端窗口已打开后重试');
        }
      } catch (err) {
        if (mySelEpoch === selectedProjectEpoch && lastNavActionSeq === myNavSeqSnapshot + 1) {
          showToast(humanizeRemoteError(err?.message, '新建对话失败，请确认电脑端窗口已打开后重试'));
        }
      }
    }

    function openNewChatProjectPicker() {
      const projs = (latestSnap?.projects || []).filter((p) => p && !isNonProjectBucket(p.id));
      const effProj = getEffectiveSelectedProject(latestSnap);
      const opts = [
        {
          isCreateProject: true,
          label: '📁 新建项目（选择电脑目录）…',
          active: false
        },
        ...projs.map((p) => ({
          projectId: p.id,
          projectName: p.name,
          label: p.name + (p.conversationCount > 0 ? (' (' + p.conversationCount + ')') : ' (空项目)'),
          active: Boolean(effProj.id && p.id === effProj.id)
        })),
        {
          projectId: '',
          projectName: '',
          label: '默认工作区（不指定项目）',
          active: !effProj.id
        }
      ];
      openSheet('选择项目新建对话', opts, async (opt) => {
        if (opt?.isCreateProject) {
          await openCreateProjectModal();
          return;
        }
        await startNewConversationInProject(opt.projectId, opt.projectName);
      });
    }

    const projBrowserState = {
      currentPath: '',
      parentPath: null,
      showHidden: false,
      isGitRepo: false,
      existingProject: null,
      navFailedError: '',
      justCreatedButNavFailed: false,
      loading: false,
      submitting: false
    };

    function renderProjModalSummary() {
      const sumEl = $('proj-selected-summary');
      if (!sumEl) return;
      if (projBrowserState.navFailedError && projBrowserState.existingProject) {
        sumEl.classList.add('is-warn');
        const exName = projBrowserState.existingProject.name || $('proj-name-input')?.value || '';
        const headline = projBrowserState.justCreatedButNavFailed
          ? ('项目「' + exName + '」已创建，但未成功进入新对话')
          : ('未能进入已有项目「' + exName + '」');
        sumEl.innerHTML =
          '<div><strong>' + esc(headline) + '</strong></div>' +
          '<div>原因：' + esc(projBrowserState.navFailedError) + '（请点击下方按钮重试进入已有项目）</div>' +
          '<div class="proj-summary-path">' + esc(projBrowserState.currentPath) + '</div>';
        return;
      }
      sumEl.classList.remove('is-warn');
      const repoBadge = projBrowserState.isGitRepo ? 'Git 仓库' : '普通目录';
      const linkedHint = projBrowserState.existingProject
        ? (' · 已关联项目「' + projBrowserState.existingProject.name + '」（填写同名可直接进入，或填写新名称另建）')
        : '';
      sumEl.innerHTML =
        '<div><strong>当前选中目录</strong> (' + esc(repoBadge) + esc(linkedHint) + ')</div>' +
        '<div class="proj-summary-path">' + esc(projBrowserState.currentPath) + '</div>';
    }

    function syncCreateProjectSubmitUi() {
      const submitBtn = $('proj-create-submit');
      if (!submitBtn) return;
      const typedName = String($('proj-name-input')?.value || '').trim();
      const ex = projBrowserState.existingProject;
      const matchesExisting = Boolean(ex && typedName && typedName.toLowerCase() === String(ex.name || '').toLowerCase());
      if (projBrowserState.submitting) {
        submitBtn.disabled = true;
        submitBtn.textContent = (projBrowserState.navFailedError && matchesExisting)
          ? '正在重试进入项目…'
          : '正在创建并打开项目…';
        return;
      }
      const hasPath = Boolean(projBrowserState.currentPath);
      submitBtn.disabled = !hasPath || !typedName;
      if (matchesExisting) {
        submitBtn.textContent = (projBrowserState.navFailedError ? '重试进入已有项目「' : '进入已有项目「') + ex.name + '」';
      } else {
        submitBtn.textContent = '创建项目并进入对话';
      }
    }

    function renderDirBrowserData(data) {
      projBrowserState.currentPath = String(data?.path || '');
      projBrowserState.parentPath = data?.parentPath || null;
      projBrowserState.isGitRepo = Boolean(data?.isGitRepo);
      projBrowserState.existingProject = data?.existingProject || null;
      projBrowserState.navFailedError = '';
      projBrowserState.justCreatedButNavFailed = false;
      projBrowserState.showHidden = Boolean(data?.showHidden);

      const pathIn = $('proj-path-input');
      if (pathIn) pathIn.value = projBrowserState.currentPath;
      const upBtn = $('proj-up-btn');
      if (upBtn) upBtn.disabled = !projBrowserState.parentPath || projBrowserState.loading;
      const hidBtn = $('proj-hidden-btn');
      if (hidBtn) hidBtn.classList.toggle('active', projBrowserState.showHidden);

      const rootsEl = $('proj-roots');
      if (rootsEl) {
        const roots = Array.isArray(data?.roots) ? data.roots : [];
        rootsEl.innerHTML = roots.map((r) => {
          const isCur = projBrowserState.currentPath === r.path;
          return '<button class="proj-root-pill' + (isCur ? ' active' : '') + '" data-root-path="' + esc(r.path) + '" type="button">' + esc(remoteChromeLabel(r.label)) + '</button>';
        }).join('');
      }

      const listEl = $('proj-dir-list');
      if (listEl) {
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        if (!entries.length) {
          listEl.innerHTML = renderPanelStateHtml({
            icon: EMPTY_FOLDER_ICON_SVG,
            compact: true,
            title: '当前目录下暂无子文件夹',
            desc: '可直接用当前目录创建项目，或点击上方「＋ 新建文件夹」'
          });
        } else {
          listEl.innerHTML = entries.map((d) => {
            const gitTag = d.isGitRepo ? '<span class="proj-tag git">Git</span>' : '';
            const linkedTag = d.existingProjectName ? ('<span class="proj-tag linked">已关联: ' + esc(d.existingProjectName) + '</span>') : '';
            return '<button class="proj-dir-item" data-dir-path="' + esc(d.path) + '" type="button">' +
              '<span class="proj-icon">' + FOLDER_SM_SVG + '</span>' +
              '<span class="proj-dir-label">' + esc(d.name) + '</span>' +
              '<span class="proj-dir-badges">' + gitTag + linkedTag + '</span>' +
              '<span style="color:var(--muted);font-size:13px">›</span>' +
            '</button>';
          }).join('') + (data?.truncated ? '<div style="text-align:center;font-size:11.5px;color:var(--muted);padding:4px 0">仅显示前 300 个子目录，可输入路径精确定位</div>' : '');
        }
      }

      renderProjModalSummary();

      syncCreateProjectSubmitUi();
    }

    async function loadHostDirListing(targetPath) {
      projBrowserState.loading = true;
      const listEl = $('proj-dir-list');
      if (listEl && (!listEl.children.length || listEl.querySelector?.('.empty-state-card'))) {
        listEl.innerHTML = renderSkeletonRowsHtml(5);
      }
      try {
        const params = [];
        if (targetPath !== undefined && targetPath !== null && String(targetPath).trim()) {
          params.push('path=' + encodeURIComponent(String(targetPath).trim()));
        }
        if (projBrowserState.showHidden) params.push('showHidden=1');
        const q = '/api/fs/dirs' + (params.length ? ('?' + params.join('&')) : '');
        const res = await fetchWithTimeout((apiBase || '') + q, { headers: authHeaders(), cache: 'no-store' }, 5000);
        if (res.status === 401) { location.reload(); return false; }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok === false) {
          throw new Error(data?.error || ('读取目录失败 (HTTP ' + res.status + ')'));
        }
        projBrowserState.loading = false;
        renderDirBrowserData(data);
        return true;
      } catch (err) {
        projBrowserState.loading = false;
        const readableErr = humanizeRemoteError(err?.message, '读取电脑目录失败，请检查电脑端连接后重试');
        if (listEl && !projBrowserState.currentPath) {
          listEl.innerHTML = renderPanelStateHtml({
            isError: true,
            compact: true,
            title: '无法读取电脑目录',
            desc: readableErr,
            actionId: 'proj-dir-retry',
            actionLabel: '重新加载'
          });
          const retryBtn = $('proj-dir-retry');
          if (retryBtn) retryBtn.onclick = () => { void loadHostDirListing(targetPath); };
        }
        showToast(readableErr);
        syncCreateProjectSubmitUi();
        return false;
      }
    }

    async function openCreateProjectModal() {
      const backdrop = $('proj-modal-backdrop');
      if (!backdrop) return;
      projBrowserState.navFailedError = '';
      projBrowserState.justCreatedButNavFailed = false;
      if ($('proj-mkdir-row')) $('proj-mkdir-row').hidden = true;
      if ($('proj-mkdir-input')) $('proj-mkdir-input').value = '';
      if ($('proj-name-input')) $('proj-name-input').value = '';
      backdrop.hidden = false;
      resetModalSheetShift();
      syncViewportHeight();
      syncCreateProjectSubmitUi();
      const initialPath = projBrowserState.currentPath || '';
      await loadHostDirListing(initialPath);
    }

    function closeCreateProjectModal() {
      const backdrop = $('proj-modal-backdrop');
      if (backdrop && backdrop.contains(document.activeElement)) {
        try { document.activeElement.blur(); } catch {}
      }
      if (backdrop) backdrop.hidden = true;
      resetModalSheetShift();
      syncViewportHeight();
    }

    async function createNewSubdirInModal() {
      const nameIn = $('proj-mkdir-input');
      const dirName = String(nameIn?.value || '').trim();
      if (!dirName) {
        showToast('请输入新文件夹名称');
        nameIn?.focus?.();
        return;
      }
      try {
        const res = await fetchWithTimeout((apiBase || '') + '/api/fs/mkdir', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ parentPath: projBrowserState.currentPath, name: dirName })
        }, 5000);
        if (res.status === 401) { location.reload(); return; }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok === false) {
          throw new Error(data?.error || '创建文件夹失败');
        }
        if (nameIn) nameIn.value = '';
        if ($('proj-mkdir-row')) $('proj-mkdir-row').hidden = true;
        showToast(data.existed ? ('已进入文件夹「' + data.name + '」') : ('已创建文件夹「' + data.name + '」'));
        await loadHostDirListing(data.path);
      } catch (err) {
        showToast(err?.message || '创建文件夹失败');
      }
    }

    async function submitCreateProjectModal() {
      if (projBrowserState.submitting) return;
      const folderPath = String(projBrowserState.currentPath || '').trim();
      const projectName = String($('proj-name-input')?.value || '').trim();
      if (!folderPath) {
        showToast('请先选择项目目录');
        return;
      }
      if (!projectName) {
        showToast('请输入项目名称');
        return;
      }
      projBrowserState.submitting = true;
      syncCreateProjectSubmitUi();
      const createStartEpoch = ++clientSyncEpoch;
      const createSelEpochBefore = selectedProjectEpoch;
      const myNavSeq = ++lastNavActionSeq;
      invalidateInflightSnapshotPolls();
      try {
        const ex = projBrowserState.existingProject;
        const forceNew = Boolean(ex && ex.name && projectName.toLowerCase() !== String(ex.name).toLowerCase());
        const res = await fetchWithTimeout((apiBase || '') + '/api/projects', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            folderPath,
            name: projectName,
            forceNew,
            existingProjectId: (!forceNew && ex?.id) ? ex.id : undefined,
            targetId: currentTargetId || undefined
          })
        }, 8000);
        if (res.status === 401) { location.reload(); return; }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok === false) {
          throw new Error(data?.error || ('创建项目失败 (HTTP ' + res.status + ')'));
        }
        const createdName = data.project?.name || projectName;
        const createdId = String(data.project?.id || ex?.id || '').trim();
        const navFailed = (data.navOk === false) || Boolean(data.navResult && data.navResult.ok === false);
        let didSetCreatedSelection = false;
        if (!navFailed && createdId && selectedProjectEpoch === createSelEpochBefore) {
          setUserSelectedProject(createdId, createdName);
          didSetCreatedSelection = true;
        }
        let appliedCreateSnap = false;
        if (data.snapshot && myNavSeq === lastNavActionSeq) {
          appliedCreateSnap = renderSnapshot(data.snapshot, {
            reqStartEpoch: createStartEpoch,
            advanceFloorOnApply: true
          });
          if (appliedCreateSnap) invalidateInflightSnapshotPolls();
        }
        if (!appliedCreateSnap) {
          if (didSetCreatedSelection) {
            syncNewChatButtonUi(latestSnap);
            if (latestSnap) renderConversationList(latestSnap);
          }
          if (!data.snapshot) void fetchSnapshot();
        }
        if (navFailed) {
          const reason = String(data.navError || data.navResult?.error || '桌面端未能进入新对话').trim();
          projBrowserState.existingProject = { id: createdId, name: createdName };
          projBrowserState.navFailedError = reason;
          projBrowserState.justCreatedButNavFailed = !data.alreadyExists;
          const nameIn = $('proj-name-input');
          if (nameIn) nameIn.value = createdName;
          renderProjModalSummary();
          showToast(
            data.alreadyExists
              ? ('未能进入已有项目「' + createdName + '」：' + reason)
              : ('项目「' + createdName + '」已创建，但未成功进入对话：' + reason + '（可点击重试进入）')
          );
          return;
        }
        projBrowserState.navFailedError = '';
        projBrowserState.justCreatedButNavFailed = false;
        closeCreateProjectModal();
        if (!isDesktopLayout()) closeDrawer();
        stickBottom = true;
        showToast(data.alreadyExists ? ('已进入项目「' + createdName + '」') : ('已创建并进入项目「' + createdName + '」'));
      } catch (err) {
        showToast(err?.message || '创建项目失败');
      } finally {
        projBrowserState.submitting = false;
        syncCreateProjectSubmitUi();
        if (myNavSeq === lastNavActionSeq && !snapshotInflight) schedulePoll();
      }
    }

    const newProjMiniBtn = $('btn-new-project');
    if (newProjMiniBtn) newProjMiniBtn.addEventListener('click', () => { void openCreateProjectModal(); });
    $('proj-modal-close')?.addEventListener('click', closeCreateProjectModal);
    $('proj-modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === $('proj-modal-backdrop')) closeCreateProjectModal();
    });
    $('proj-roots')?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.proj-root-pill');
      const target = btn?.getAttribute?.('data-root-path');
      if (target) void loadHostDirListing(target);
    });
    $('proj-dir-list')?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.proj-dir-item');
      const target = btn?.getAttribute?.('data-dir-path');
      if (target) void loadHostDirListing(target);
    });
    $('proj-up-btn')?.addEventListener('click', () => {
      if (projBrowserState.parentPath) void loadHostDirListing(projBrowserState.parentPath);
    });
    $('proj-hidden-btn')?.addEventListener('click', () => {
      projBrowserState.showHidden = !projBrowserState.showHidden;
      void loadHostDirListing(projBrowserState.currentPath || '');
    });
    $('proj-mkdir-toggle')?.addEventListener('click', () => {
      const row = $('proj-mkdir-row');
      if (!row) return;
      row.hidden = !row.hidden;
      if (!row.hidden) $('proj-mkdir-input')?.focus?.();
    });
    function bindSafeImeEnter(el, onEnter, opts) {
      if (!el || typeof el.addEventListener !== 'function') return;
      let imeComposing = false;
      el.addEventListener('compositionstart', () => { imeComposing = true; });
      el.addEventListener('compositionend', () => { imeComposing = false; });
      el.addEventListener('keydown', (e) => {
        if (imeComposing || e.isComposing || e.keyCode === 229) return;
        if (e.key !== 'Enter') return;
        if (opts?.requireMod && !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        onEnter(e);
      });
    }

    $('proj-mkdir-confirm')?.addEventListener('click', () => { void createNewSubdirInModal(); });
    bindSafeImeEnter($('proj-mkdir-input'), () => { void createNewSubdirInModal(); });
    $('proj-path-go')?.addEventListener('click', () => {
      const val = String($('proj-path-input')?.value || '').trim();
      if (val) void loadHostDirListing(val);
    });
    bindSafeImeEnter($('proj-path-input'), () => {
      const val = String($('proj-path-input')?.value || '').trim();
      if (val) void loadHostDirListing(val);
    });
    $('proj-name-input')?.addEventListener('input', () => {
      const typedName = String($('proj-name-input')?.value || '').trim();
      const ex = projBrowserState.existingProject;
      if (projBrowserState.navFailedError && (!ex || typedName.toLowerCase() !== String(ex.name || '').toLowerCase())) {
        projBrowserState.navFailedError = '';
        projBrowserState.justCreatedButNavFailed = false;
        renderProjModalSummary();
      }
      syncCreateProjectSubmitUi();
    });
    $('proj-create-submit')?.addEventListener('click', () => { void submitCreateProjectModal(); });

    const convViewTabsEl = $('conv-view-tabs');
    if (convViewTabsEl) {
      convViewTabsEl.addEventListener('click', (e) => {
        const tab = e.target?.closest?.('.conv-tab');
        if (!tab) return;
        const nextMode = tab.getAttribute('data-conv-view');
        if (nextMode !== 'projects' && nextMode !== 'recent') return;
        if (convViewMode === nextMode) return;
        convViewMode = nextMode;
        saveConvUiPrefs();
        if (latestSnap) renderConversationList(latestSnap);
        else syncConvTabsUi();
      });
    }
    if ($('drawer-nav-bar')) {
      $('drawer-nav-bar').addEventListener('click', (e) => {
        const backBtn = e.target?.closest?.('#btn-drawer-back');
        if (!backBtn) return;
        activeDrawerProject = '';
        renderDrawerProjectsAndConversations(latestSnap, true);
      });
    }

    $('conv-list').addEventListener('click', async (e) => {
      const emptyActBtn = e.target?.closest?.('[data-empty-action]');
      if (emptyActBtn) {
        const act = emptyActBtn.getAttribute('data-empty-action');
        if (act === 'new-project') {
          void openCreateProjectModal();
        } else if (act === 'new-chat') {
          const eff = getEffectiveSelectedProject(latestSnap);
          await startNewConversationInProject(eff.id, eff.name);
        }
        return;
      }

      const newProjBtn = e.target?.closest?.('.proj-new-btn');
      if (newProjBtn) {
        e.stopPropagation();
        const pid = newProjBtn.getAttribute('data-new-proj') || '';
        if (!pid) return;
        const matchedProj = (latestSnap?.projects || []).find((p) => p.id === pid);
        await startNewConversationInProject(pid, matchedProj?.name || '');
        return;
      }

      const toggleBtn = e.target?.closest?.('.proj-toggle') || e.target?.closest?.('.proj-head')?.querySelector?.('.proj-toggle');
      if (toggleBtn) {
        const pid = toggleBtn.getAttribute('data-proj-toggle') || '';
        if (!pid) return;
        const wasSelected = getEffectiveSelectedProject(latestSnap).id === pid;
        const clickedChev = Boolean(e.target?.closest?.('.proj-chev'));
        const isEmptyGroup = Boolean(toggleBtn.closest?.('.proj-group')?.classList?.contains('is-empty'));
        const matchedProj = (latestSnap?.projects || []).find((p) => p && p.id === pid);
        setUserSelectedProject(pid, matchedProj?.name || '');
        syncNewChatButtonUi(latestSnap);
        if (!isEmptyGroup) {
          if (collapsedProjMap[pid]) {
            delete collapsedProjMap[pid];
            saveConvUiPrefs();
          } else if (wasSelected || clickedChev || isNonProjectBucket(pid)) {
            collapsedProjMap[pid] = true;
            saveConvUiPrefs();
          }
        }
        if (latestSnap) renderConversationList(latestSnap);
        return;
      }

      const moreBtn = e.target?.closest?.('.conv-more-btn');
      if (moreBtn) {
        const projMorePid = moreBtn.getAttribute('data-proj-more') || '';
        if (projMorePid) {
          await loadMoreConversations({ projectId: projMorePid });
        } else {
          const merged = getMergedConversations(latestSnap);
          const totalCount = Math.max(merged.length, Number(latestSnap?.totalConversations) || 0);
          if (merged.length < totalCount) {
            await loadMoreConversations({ projectId: '' });
          } else {
            recentDisplayLimit = Math.max(recentDisplayLimit + 150, totalCount);
            if (latestSnap) renderConversationList(latestSnap);
          }
        }
        return;
      }

      function applyOptimisticSidebarConvClick(clickedBtn) {
        const convListEl = $('conv-list');
        if (!convListEl || !clickedBtn) return;
        convListEl.querySelectorAll('.conv-item').forEach((el) => {
          if (el !== clickedBtn) el.classList.remove('active');
        });
        clickedBtn.classList.add('active');
        clickedBtn.classList.remove('is-unread');
        clickedBtn.querySelector?.('.conv-unread-dot')?.remove?.();
        const effId = getEffectiveSelectedProject(latestSnap).id;
        convListEl.querySelectorAll('.proj-group').forEach((grp) => {
          const grpPid = grp.querySelector('.proj-toggle')?.getAttribute('data-proj-toggle') || '';
          grp.classList.toggle('is-current', Boolean(effId && grpPid === effId));
        });
        convListEl.dataset.lastHtml = '';
      }

      const projBtn = e.target?.closest?.('.proj-item');
      if (projBtn && projBtn.dataset.projKey) {
        const projKey = projBtn.dataset.projKey;
        activeDrawerProject = projKey;
        renderDrawerProjectsAndConversations(latestSnap, true);
        const groups = normalizeProjectGroups(latestSnap);
        const pickedGrp = groups.find((g) => g.key === projKey);
        if (pickedGrp && pickedGrp.isCollapsed && !pickedGrp.conversations.length) {
          try {
            await apiAction({ action: 'expand-project', groupId: pickedGrp.id, name: pickedGrp.name });
          } catch {}
        }
        return;
      }

      const btn = e.target?.closest?.('.conv-item');
      const cid = btn?.getAttribute('data-cid') || btn?.dataset?.cid || '';
      if (!btn || !cid) return;
      const matchedConv = getMergedConversations(latestSnap).find((x) => x && x.id === cid);
      const mySwitchSelEpoch = matchedConv
        ? setUserSelectedProject(matchedConv.projectId, matchedConv.projectName)
        : selectedProjectEpoch;
      if (matchedConv) {
        matchedConv.unread = false;
        matchedConv.completedUnread = false;
        syncAppBadgeCount(computeClientCompletedUnreadCount(getMergedConversations(latestSnap)));
        syncNewChatButtonUi(latestSnap);
      }
      applyOptimisticSidebarConvClick(btn);
      const prevSessionId = String(latestSnap?.sessionId || '');
      const isSwitchingToOther = Boolean(cid && prevSessionId && prevSessionId !== cid);
      const myNavSeqSnapshot = lastNavActionSeq;
      if (isSwitchingToOther) {
        msgEl.classList.add('is-switching');
        if (matchedConv?.title) $('conv-title').textContent = matchedConv.title;
        if (matchedConv) syncTopbarProjectBadge(matchedConv.projectName || '');
      }
      if (!isDesktopLayout()) closeDrawer();
      stickBottom = true;
      showToast('正在切换会话…');
      try {
        applySelectedConversation(cid);
        const r = await apiAction({ action: 'switch-conversation', id: cid, isolated: true });
        if (!r?.ok && mySwitchSelEpoch === selectedProjectEpoch) {
          showToast(r?.error || r?.actionResult?.error || ${serializeRemoteTemplateData(locale === 'zh-TW' ? localizeRemoteText('切换会话失败，请检查电脑端连接或刷新重试') : '切换会话失败，请检查电脑端连接或刷新重试')});
          if (latestSnap && lastNavActionSeq === myNavSeqSnapshot + 1) {
            $('conv-title').textContent = latestSnap.title || 'Antigravity';
            syncTopbarProjectBadge(resolveConversationProjectName(latestSnap));
          }
        }
      } catch (err) {
        if (mySwitchSelEpoch === selectedProjectEpoch) {
          showToast(humanizeRemoteError(err?.message, ${serializeRemoteTemplateData(locale === 'zh-TW' ? localizeRemoteText('切换会话失败，请检查电脑端连接或刷新重试') : '切换会话失败，请检查电脑端连接或刷新重试')}));
          if (latestSnap && lastNavActionSeq === myNavSeqSnapshot + 1) {
            $('conv-title').textContent = latestSnap.title || 'Antigravity';
            syncTopbarProjectBadge(resolveConversationProjectName(latestSnap));
          }
        }
      } finally {
        if (lastNavActionSeq === myNavSeqSnapshot + 1) {
          msgEl.classList.remove('is-switching');
        }
      }
    });
    async function switchConversationById(cid) {
      const targetId = String(cid || '').trim();
      if (!targetId) return;
      const matchedConv = getMergedConversations(latestSnap).find((x) => x && x.id === targetId);
      if (matchedConv) {
        matchedConv.unread = false;
        matchedConv.completedUnread = false;
        syncAppBadgeCount(computeClientCompletedUnreadCount(getMergedConversations(latestSnap)));
      }
      applySelectedConversation(targetId);
      try {
        await apiAction({ action: 'switch-conversation', id: targetId, isolated: true });
      } catch {}
    }

    if ($('btn-follow-desktop')) {
      $('btn-follow-desktop').onclick = async () => {
        if (!isDesktopLayout()) closeDrawer();
        stickBottom = true;
        showToast('正在同步桌面端当前会话…');
        try {
          applySelectedConversation('');
          const r = await apiAction({ action: 'switch-conversation', id: 'follow-desktop' });
          if (r?.ok) showToast('已同步桌面当前会话');
          else showToast(r?.error || r?.actionResult?.error || '同步桌面会话失败，请检查连接状态后重试');
        } catch (err) {
          showToast(humanizeRemoteError(err?.message, '同步桌面会话失败，请检查连接状态后重试'));
        }
      };
    }
    $('btn-drawer').addEventListener('click', () => {
      if (isDesktopLayout()) {
        document.body.classList.toggle('sidebar-collapsed');
        syncSidebarA11y();
      } else {
        openDrawer();
      }
    });
    backdropEl.addEventListener('click', (e) => { if (!isDesktopLayout() && e.target === backdropEl) closeDrawer(); });
    $('btn-new-chat').addEventListener('click', async () => {
      const eff = getEffectiveSelectedProject(latestSnap);
      await startNewConversationInProject(eff.id, eff.name);
    });
    const newChatProjBtn = $('btn-new-chat-project');
    if (newChatProjBtn) {
      newChatProjBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openNewChatProjectPicker();
      });
    }
    const handleLayoutChange = () => {
      if (isDesktopLayout() && backdropEl.classList.contains('open')) {
        closeDrawer();
      } else {
        syncSidebarA11y();
      }
      if (typeof autoGrow === 'function') autoGrow();
    };
    window.addEventListener('resize', handleLayoutChange);
    if (desktopMq) {
      if (typeof desktopMq.addEventListener === 'function') desktopMq.addEventListener('change', handleLayoutChange);
      else if (typeof desktopMq.addListener === 'function') desktopMq.addListener(handleLayoutChange);
    }
    syncSidebarA11y();

    // 全屏随手右滑打开左侧抽屉 & 左滑关闭抽屉（仅移动端启用）
    let swipeState = null;
    document.addEventListener('touchstart', (e) => {
      if (isDesktopLayout() || e.touches.length !== 1) { swipeState = null; return; }
      const t = e.touches[0];
      const isOpen = backdropEl.classList.contains('open');
      const target = e.target;
      if (!isOpen) {
        if (!$('quota-drawer').hidden || !$('sheet-backdrop').hidden || !$('proj-modal-backdrop').hidden) return;
        if (target?.closest?.('pre, .md-table-wrap, .chips, textarea, select')) return;
        if (t.clientX > window.innerWidth * 0.85) return;
      }
      swipeState = {
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
        isOpen,
        dragging: false,
        dx: 0
      };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!swipeState || isDesktopLayout() || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - swipeState.startX;
      const dy = t.clientY - swipeState.startY;
      swipeState.dx = dx;

      if (!swipeState.dragging) {
        if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
          swipeState = null;
          return;
        }
        const wantOpenDrag = !swipeState.isOpen && dx > 14 && dx > Math.abs(dy) * 1.25;
        const wantCloseDrag = swipeState.isOpen && dx < -14 && Math.abs(dx) > Math.abs(dy) * 1.25;
        if (wantOpenDrag || wantCloseDrag) {
          swipeState.dragging = true;
          backdropEl.classList.add('dragging');
        }
      }

      if (swipeState.dragging) {
        const w = drawerEl.offsetWidth || 300;
        const progress = swipeState.isOpen
          ? Math.max(0, Math.min(1, 1 + dx / w))
          : Math.max(0, Math.min(1, dx / w));
        drawerEl.style.transform = 'translateX(' + ((progress - 1) * 100).toFixed(2) + '%)';
        const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
        backdropEl.style.backgroundColor = (isLightTheme ? 'rgba(15,23,42,' : 'rgba(0,0,0,') + ((isLightTheme ? 0.36 : 0.58) * progress).toFixed(3) + ')';
      }
    }, { passive: true });

    const finishSwipe = () => {
      if (!swipeState) return;
      const st = swipeState;
      swipeState = null;
      if (!st.dragging) return;
      const elapsed = Math.max(1, Date.now() - st.startTime);
      const velocity = Math.abs(st.dx) / elapsed;
      if (!st.isOpen) {
        if (st.dx > 52 || (st.dx > 26 && velocity > 0.35)) openDrawer();
        else closeDrawer();
      } else {
        if (st.dx < -45 || (st.dx < -24 && velocity > 0.35)) closeDrawer();
        else openDrawer();
      }
    };
    document.addEventListener('touchend', finishSwipe, { passive: true });
    document.addEventListener('touchcancel', finishSwipe, { passive: true });

    const ta = $('input');
    const SEND_ARROW_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    const STOP_SQUARE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';

    function syncSendButtonUI() {
      const btn = $('btn-send');
      if (!btn) return;
      if (sending) {
        btn.disabled = true;
        btn.className = 'send-circle pending';
        btn.innerHTML = '<span class="mini-spin"></span>';
        btn.setAttribute('aria-busy', 'true');
        btn.setAttribute('aria-label', '正在处理…');
        return;
      }
      btn.removeAttribute?.('aria-busy');
      const hasContent = Boolean(ta.value.trim() || uploadedNames.length);
      if (hasContent) {
        btn.disabled = false;
        btn.className = 'send-circle ready';
        btn.innerHTML = SEND_ARROW_SVG;
        btn.setAttribute('aria-label', '发送消息');
      } else if (latestSnap?.busy) {
        btn.disabled = false;
        btn.className = 'send-circle stop';
        btn.innerHTML = STOP_SQUARE_SVG;
        btn.setAttribute('aria-label', '停止生成');
      } else {
        btn.disabled = true;
        btn.className = 'send-circle';
        btn.innerHTML = SEND_ARROW_SVG;
        btn.setAttribute('aria-label', '发送消息');
      }
    }

    const autoGrow = () => {
      ta.style.height = 'auto';
      const maxH = isDesktopLayout() ? 200 : 148;
      ta.style.height = Math.min(maxH, Math.max(28, ta.scrollHeight)) + 'px';
      saveDraftForConv(selectedConversationId, ta.value || '');
      syncSendButtonUI();
    };
    {
      const initDraft = loadDraftForConv(selectedConversationId);
      if (initDraft) {
        ta.value = initDraft;
        autoGrow();
      }
    }
    ta.addEventListener('input', autoGrow);
    ta.addEventListener('focus', () => { setTimeout(syncViewportHeight, 120); });
    ta.addEventListener('blur', () => { setTimeout(syncViewportHeight, 80); });
    ta.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imgFiles = [];
      for (const it of items) {
        if (String(it.type || '').startsWith('image/')) {
          const f = it.getAsFile?.();
          if (f) imgFiles.push(f);
        }
      }
      if (!imgFiles.length) {
        const directFiles = Array.from(e.clipboardData?.files || []).filter((f) => String(f.type || '').startsWith('image/'));
        imgFiles.push(...directFiles);
      }
      if (imgFiles.length) {
        e.preventDefault();
        void uploadImageFiles(imgFiles);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('proj-modal-backdrop').hidden) { closeCreateProjectModal(); return; }
      if (!$('sheet-backdrop').hidden) { closeSheet(); return; }
      if (!$('quota-drawer').hidden || ($('context-drawer') && !$('context-drawer').hidden) || ($('usage-drawer') && !$('usage-drawer').hidden)) {
        openTopDrawer(null);
        return;
      }
      if (!isDesktopLayout() && backdropEl.classList.contains('open')) closeDrawer();
    });

    async function sendInput() {
      if (sending) return;
      const rawText = ta.value.trim();
      if (!rawText && !uploadedNames.length && latestSnap?.busy) {
        sending = true;
        syncSendButtonUI();
        try {
          const r = await apiAction({ action: 'stop' }, { skipAutoRender: true });
          if (r?.ok) showToast('已请求停止生成');
          else showToast(r?.error || r?.actionResult?.error || '停止生成失败，可重试或切换连接方式检查电脑端状态');
          sending = false;
          if (r?.snapshot) renderSnapshot(r.snapshot);
        } catch (err) {
          showToast(humanizeRemoteError(err?.message, '停止生成失败，可重试或切换连接方式检查电脑端状态'));
        } finally {
          sending = false;
          syncSendButtonUI();
        }
        return;
      }
      const text = rawText || (uploadedNames.length ? (uploadedAttachments.some((a) => !a.isImage) ? '请查看附件' : '请查看图片') : '');
      if (!text) return;
      sending = true;
      syncSendButtonUI();
      try {
        stickBottom = true;
        const wasBusyWhenSent = Boolean(latestSnap?.busy);
        const r = await apiAction({ action: 'send', text }, { skipAutoRender: true });
        if (r?.ok) {
          ta.value = '';
          saveDraftForConv(selectedConversationId, '');
          uploadedNames = [];
          uploadedAttachments = [];
          renderAttachHintStrip();
          ta.style.height = 'auto';
          const maxH = isDesktopLayout() ? 180 : 112;
          ta.style.height = Math.min(maxH, Math.max(28, ta.scrollHeight)) + 'px';
          if (wasBusyWhenSent) {
            const snapToRender = (r?.snapshot && r.snapshot.ok !== false) ? r.snapshot : latestSnap;
            if (snapToRender && (!Array.isArray(snapToRender.queuedMessages) || !snapToRender.queuedMessages.some((q) => String(q?.text || '').trim() === text.trim()))) {
              const curQ = Array.isArray(snapToRender.queuedMessages) ? snapToRender.queuedMessages.slice() : [];
              curQ.push({ source: 'optimistic', stepIndex: -1, text, status: 'queued' });
              snapToRender.queuedMessages = curQ;
            }
            if (snapToRender) renderSnapshot(snapToRender);
            setTimeout(() => { void fetchSnapshot(); }, 250);
          }
        } else {
          showToast(r?.error || r?.actionResult?.error || '发送失败，请检查电脑端连接或网络后重试');
        }
        sending = false;
        if (r?.snapshot && !(wasBusyWhenSent && r?.ok)) renderSnapshot(r.snapshot);
      } catch (err) {
        showToast(humanizeRemoteError(err?.message, '发送失败，请检查电脑端连接或网络后重试'));
      } finally {
        sending = false;
        syncSendButtonUI();
      }
    }
    bindButtonClick($('btn-send'), sendInput);
    syncSendButtonUI();
    bindSafeImeEnter(ta, () => { void sendInput(); }, { requireMod: true });

    renderModeEntryGate(
      isManualEntry
        ? ('正在通过 ' + getActiveChannelLabel() + ' 连接电脑端…')
        : '正在自动测试并切换至最快通道，也可直接点击下方方式进入：'
    );
    if (isAutoSwitched) {
      const curKind = detectKindFromOrigin(location.origin);
      const curMs = speedTestState.results?.[curKind]?.ms;
      showToast('⚡ 已自动切换至最快通道：' + getActiveChannelLabel() + (Number.isFinite(curMs) ? ' (' + curMs + ' ms)' : ''));
      if (location.protocol !== 'https:') {
        const missingAny = getEnabledModeEntries().some((ep) => {
          const sr = speedTestState.results?.[ep.kind];
          return !sr || sr.via === 'server' || sr.reason === 'https_restricted';
        });
        if (missingAny) void runSpeedTest({ autoSwitch: false, silent: true });
      }
    } else if (!manualLocked && getEnabledModeEntries().length > 1) {
      autoSwitchChecked = true;
      void runSpeedTest({ autoSwitch: true, silent: true });
    } else if (speedTestState.testedAt === 0 || (location.protocol !== 'https:' && getEnabledModeEntries().some((ep) => {
      const sr = speedTestState.results?.[ep.kind];
      return !sr || sr.via === 'server' || sr.reason === 'https_restricted';
    }))) {
      void runSpeedTest({ autoSwitch: false, silent: true });
    }
    void fetchSnapshot();
  })();
  </script>
</body>
</html>`, locale);
}

// ==================== HTTP 服务器管理器（双栈监听，入口强制仅放行本机及内网私网/Tailscale 来源） ====================

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    let settled = false;
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      len += buf.length;
      if (len > MAX_ACTION_BODY_BYTES) {
        try { req.pause(); } catch {}
        finishErr(Object.assign(new Error('请求体过大'), { status: 413 }));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = chunks.length ? Buffer.concat(chunks, len).toString('utf8') : '';
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON 格式错误'), { status: 400 }));
      }
    });
    req.on('close', () => {
      if (!settled && !req.complete) {
        finishErr(Object.assign(new Error('请求连接已中断'), { status: 400 }));
      }
    });
    req.on('error', finishErr);
  });
}

function isAllowedPrivateOrigin(rawOrigin, extraOrigin = '', allowedTailscaleDnsName = null) {
  if (!rawOrigin || typeof rawOrigin !== 'string') return false;
  try {
    const u = new URL(rawOrigin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (extraOrigin) {
      try {
        const eu = new URL(extraOrigin);
        if (u.origin === eu.origin) return true;
      } catch {}
    }
    const cleanHost = String(u.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!cleanHost) return false;
    if (u.protocol === 'https:' && cleanHost.endsWith('.trycloudflare.com')) return true;
    if (cleanHost === 'localhost' || cleanHost.endsWith('.local')) return true;
    if (cleanHost.endsWith('.ts.net')) {
      const rawAllowed = (allowedTailscaleDnsName !== null && allowedTailscaleDnsName !== undefined)
        ? allowedTailscaleDnsName
        : detectHostIdentityMeta().tailscaleDnsName;
      const candidateList = Array.isArray(rawAllowed) ? rawAllowed : [rawAllowed];
      const normalizedSet = new Set(
        candidateList
          .map((item) => String(item || '').replace(/\.+$/, '').trim().toLowerCase())
          .filter(Boolean)
      );
      return normalizedSet.has(cleanHost);
    }
    return isAllowedPrivateAddress(cleanHost);
  } catch {
    return false;
  }
}

// ==================== Cloudflare Tunnel 管理 (免登录 Quick Tunnel + 自有账号 Named Tunnel) ====================

function getCloudflaredInstallGuide(platform = process.platform) {
  const commands = {
    darwin: 'brew install cloudflared',
    win32: 'winget install --id Cloudflare.cloudflared',
    linux: 'mkdir -p ~/.local/bin && curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared'
  };
  const key = commands[platform] ? platform : 'linux';
  return {
    platform: key,
    command: commands[key],
    commands
  };
}

function resolveCloudflaredBinary() {
  const candidates = [];
  if (process.env.AG_CLOUDFLARED_BIN) candidates.push(process.env.AG_CLOUDFLARED_BIN);
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')
    );
  } else {
    candidates.push(
      '/opt/homebrew/bin/cloudflared',
      '/usr/local/bin/cloudflared',
      path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
      '/usr/bin/cloudflared'
    );
  }
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['cloudflared'], {
      timeout: 600,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/)[0]?.trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return '';
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeTunnelStateFile(payload) {
  const stPath = getTunnelStatePath();
  safeWriteJsonSync(stPath, payload, { indent: 2 });
  try {
    fs.chmodSync(stPath, 0o600);
  } catch {}
}

function removeTunnelStateFile() {
  try {
    const stPath = getTunnelStatePath();
    if (fs.existsSync(stPath)) fs.unlinkSync(stPath);
  } catch {}
}

function reapStaleCloudflaredPid() {
  const stPath = getTunnelStatePath();
  const loaded = safeReadJsonSync(stPath, null);
  if (!loaded.ok || !loaded.data || !Number.isInteger(loaded.data.pid)) {
    removeTunnelStateFile();
    return false;
  }
  const pid = loaded.data.pid;
  if (!isPidAlive(pid)) {
    removeTunnelStateFile();
    return false;
  }
  let shouldKill = process.platform === 'win32';
  if (!shouldKill) {
    try {
      const cmdline = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        timeout: 600,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      shouldKill = /cloudflared/i.test(cmdline);
    } catch {}
  }
  if (shouldKill) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  removeTunnelStateFile();
  return shouldKill;
}

function readPersistedTunnelStatus() {
  const cfg = loadOrCreateRemoteConfig();
  if (!cfg.tunnelEnabled) {
    return {
      enabled: false,
      mode: cfg.tunnelMode,
      state: 'stopped',
      pid: null,
      publicUrl: '',
      error: '',
      binaryAvailable: Boolean(resolveCloudflaredBinary())
    };
  }
  const loaded = safeReadJsonSync(getTunnelStatePath(), null);
  if (loaded.ok && loaded.data && Number.isInteger(loaded.data.pid) && isPidAlive(loaded.data.pid)) {
    return {
      enabled: true,
      mode: loaded.data.mode === 'named' ? 'named' : 'quick',
      state: loaded.data.state || 'running',
      pid: loaded.data.pid,
      publicUrl: String(loaded.data.publicUrl || ''),
      error: String(loaded.data.error || ''),
      binaryAvailable: Boolean(resolveCloudflaredBinary())
    };
  }
  return {
    enabled: true,
    mode: cfg.tunnelMode,
    state: 'stopped',
    pid: null,
    publicUrl: '',
    error: '',
    binaryAvailable: Boolean(resolveCloudflaredBinary())
  };
}

function resolveEmptyCloudflaredConfigPath(options = {}) {
  const plat = options.platform || process.platform;
  if (plat !== 'win32') {
    if (fs.existsSync('/dev/null')) {
      return { ok: true, path: '/dev/null', error: '' };
    }
  }
  const baseDir = options.baseDir || path.dirname(getRemoteConfigPath());
  const candidates = [path.join(baseDir, '.cloudflared-empty.yml')];
  if (options.fallbackDir !== null) {
    const fbDir = options.fallbackDir || os.tmpdir();
    if (fbDir && fbDir !== baseDir) {
      candidates.push(path.join(fbDir, 'ag-cloudflared-empty.yml'));
    }
  }
  let lastErr = '';
  for (const emptyPath of candidates) {
    try {
      const dir = path.dirname(emptyPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(emptyPath, '', 'utf8');
      const st = fs.statSync(emptyPath);
      if (st.isFile() && st.size === 0) {
        return { ok: true, path: emptyPath, error: '' };
      }
      lastErr = `隔离配置文件非空 (size=${st.size})`;
    } catch (err) {
      lastErr = err?.message || String(err || 'unknown error');
    }
  }
  return {
    ok: false,
    path: '',
    error: `无法创建 cloudflared 隔离空配置文件（${lastErr || '写入失败'}），已中止启动以避免误读宿主机 ~/.cloudflared/config.yml`
  };
}

function createCloudflareTunnelController(getPort) {
  let child = null;
  let state = 'stopped';
  let publicUrl = '';
  let errorMsg = '';
  let mode = 'quick';
  let killEscalationTimer = null;
  let autoRetryTimer = null;
  let consecutiveFailures = 0;
  let lastAutoRetryAt = 0;

  const clearAutoRetryTimer = () => {
    if (autoRetryTimer) {
      clearTimeout(autoRetryTimer);
      autoRetryTimer = null;
    }
  };

  const scheduleAutoRetry = () => {
    clearAutoRetryTimer();
    if (process.env.AG_REMOTE_SKIP_PROBES === '1' || state === 'stopped') return;
    const cfgNow = loadOrCreateRemoteConfig();
    if (!cfgNow.tunnelEnabled) return;
    if (/(?:Token 无效|请先填写有效|未检测到 cloudflared|隔离空配置文件)/i.test(errorMsg || '')) return;
    if (consecutiveFailures >= 5) return;
    const delay = Math.min(30000, 3000 * Math.pow(2, consecutiveFailures));
    consecutiveFailures += 1;
    autoRetryTimer = setTimeout(() => {
      autoRetryTimer = null;
      if (state !== 'error') return;
      const curCfg = loadOrCreateRemoteConfig();
      if (!curCfg.tunnelEnabled) return;
      lastAutoRetryAt = Date.now();
      void start(curCfg);
    }, delay);
    autoRetryTimer.unref?.();
  };

  const getStatus = () => {
    const cfg = loadOrCreateRemoteConfig();
    return {
      enabled: Boolean(cfg.tunnelEnabled),
      mode: cfg.tunnelMode || mode,
      state,
      pid: (child && child.pid && isPidAlive(child.pid)) ? child.pid : null,
      publicUrl: state === 'running' ? publicUrl : '',
      error: errorMsg,
      binaryAvailable: Boolean(resolveCloudflaredBinary())
    };
  };

  const stop = async () => {
    clearAutoRetryTimer();
    consecutiveFailures = 0;
    if (killEscalationTimer) {
      clearTimeout(killEscalationTimer);
      killEscalationTimer = null;
    }
    const target = child;
    child = null;
    state = 'stopped';
    publicUrl = '';
    errorMsg = '';
    removeTunnelStateFile();
    if (target && !target.killed) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        target.once('exit', finish);
        try { target.kill('SIGTERM'); } catch { finish(); }
        killEscalationTimer = setTimeout(() => {
          try { target.kill('SIGKILL'); } catch {}
          finish();
        }, 450);
        killEscalationTimer.unref?.();
      });
    }
    return getStatus();
  };

  const start = async (overrideCfg = null) => {
    clearAutoRetryTimer();
    let cfg = overrideCfg || loadOrCreateRemoteConfig();
    mode = cfg.tunnelMode === 'named' ? 'named' : 'quick';
    if (!cfg.tunnelEnabled) {
      return await stop();
    }
    const bin = resolveCloudflaredBinary();
    if (!bin) {
      const installGuide = getCloudflaredInstallGuide();
      state = 'error';
      publicUrl = '';
      errorMsg = `未检测到 cloudflared（可执行 ${installGuide.command} 安装）`;
      return getStatus();
    }
    if (mode === 'named') {
      const hostCheck = validateTunnelHostname(cfg.tunnelHostname);
      if (!hostCheck.ok) {
        state = 'error';
        publicUrl = '';
        errorMsg = !String(cfg.tunnelHostname || '').trim()
          ? '请先填写有效的 Cloudflare 固定域名 (https://...) 与 Tunnel Token'
          : hostCheck.error;
        return getStatus();
      }
      const tokCheck = validateCloudflareTunnelToken(cfg.tunnelToken);
      if (!tokCheck.ok) {
        state = 'error';
        publicUrl = '';
        errorMsg = !String(cfg.tunnelToken || '').trim()
          ? '请先填写有效的 Cloudflare 固定域名 (https://...) 与 Tunnel Token'
          : tokCheck.error;
        return getStatus();
      }
      if (tokCheck.token && tokCheck.token !== cfg.tunnelToken) {
        cfg = { ...cfg, tunnelToken: tokCheck.token };
      }
    }

    if (child) await stop();
    mode = cfg.tunnelMode === 'named' ? 'named' : 'quick';
    state = 'starting';
    publicUrl = '';
    errorMsg = '';

    const port = Number(typeof getPort === 'function' ? getPort() : cfg.port) || DEFAULT_REMOTE_PORT;
    const emptyCfg = resolveEmptyCloudflaredConfigPath();
    if (!emptyCfg.ok || !emptyCfg.path) {
      state = 'error';
      publicUrl = '';
      errorMsg = emptyCfg.error || '无法创建 cloudflared 隔离空配置文件，已中止启动';
      return getStatus();
    }
    const args = mode === 'named'
      ? ['tunnel', '--config', emptyCfg.path, '--no-autoupdate', '--edge-ip-version', '4', '--protocol', 'http2', 'run']
      : ['tunnel', '--config', emptyCfg.path, '--no-autoupdate', '--edge-ip-version', '4', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];

    const childEnv = { ...process.env };
    const appendNoProxy = (cur) => {
      const base = String(cur || '').trim();
      const parts = base ? base.split(',').map((s) => s.trim()).filter(Boolean) : [];
      for (const local of ['127.0.0.1', 'localhost', '::1']) {
        if (!parts.includes(local)) parts.push(local);
      }
      return parts.join(',');
    };
    childEnv.NO_PROXY = appendNoProxy(childEnv.NO_PROXY);
    childEnv.no_proxy = appendNoProxy(childEnv.no_proxy);
    try {
      const proxyCfg = detectProxyConfig();
      const proxyUrl = proxyCfg?.httpProxy || proxyCfg?.allProxy || proxyCfg?.url;
      if (proxyCfg?.enabled && proxyUrl && !childEnv.HTTPS_PROXY && !childEnv.https_proxy) {
        childEnv.HTTPS_PROXY = proxyUrl;
        childEnv.HTTP_PROXY = proxyUrl;
      }
    } catch {}
    if (mode === 'named') {
      childEnv.TUNNEL_TOKEN = cfg.tunnelToken;
    }

    return await new Promise((resolve) => {
      let settled = false;
      let quickUrlCandidate = '';
      let quickRegistered = false;
      const markQuickRunning = (urlStr) => {
        if (!urlStr || child !== spawned) return;
        publicUrl = urlStr;
        state = 'running';
        errorMsg = '';
        consecutiveFailures = 0;
        writeTunnelStateFile({
          pid: spawned.pid,
          mode,
          state,
          publicUrl,
          error: '',
          startedAt: Date.now()
        });
        clearTimeout(waitTimer);
        settle();
      };
      const settle = () => {
        if (settled) return;
        if (mode === 'quick' && quickUrlCandidate && state === 'starting' && child === spawned && !errorMsg) {
          publicUrl = quickUrlCandidate;
          state = 'running';
          consecutiveFailures = 0;
          writeTunnelStateFile({
            pid: spawned.pid,
            mode,
            state,
            publicUrl,
            error: '',
            startedAt: Date.now()
          });
        }
        settled = true;
        resolve(getStatus());
      };

      const waitTimer = setTimeout(settle, 9000);
      waitTimer.unref?.();

      const spawned = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        windowsHide: true
      });
      child = spawned;
      let lastErrLine = '';

      const handleChunk = (buf) => {
        if (child !== spawned) return;
        const text = String(buf || '');
        const cleanLines = text
          .replace(/\x1b\[[0-9;]*m/g, '')
          .replace(/\beyJ[A-Za-z0-9+/_-]{8,}=*(?:\.[A-Za-z0-9+/_-]+=*)*/g, '[REDACTED]')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of cleanLines) {
          if (/\b(?:ERR|FTL|FATAL)\b/i.test(line) || /\bfailed to\b/i.test(line)) {
            lastErrLine = line.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+(?:ERR|FTL)\s*/i, '').slice(0, 180);
          }
        }
        if (mode === 'quick') {
          const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
          if (m) {
            quickUrlCandidate = m[0];
          }
          if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(text)) {
            quickRegistered = true;
          }
          if (quickUrlCandidate && quickRegistered) {
            markQuickRunning(quickUrlCandidate);
          } else {
            const mErr = text.match(/failed to request quick Tunnel:\s*([^\r\n]+)/i);
            if (mErr) errorMsg = `Cloudflare 临时隧道连接失败: ${mErr[1].trim()}`;
          }
        } else {
          if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(text)) {
            publicUrl = cfg.tunnelHostname;
            state = 'running';
            errorMsg = '';
            consecutiveFailures = 0;
            writeTunnelStateFile({
              pid: spawned.pid,
              mode,
              state,
              publicUrl,
              error: '',
              startedAt: Date.now()
            });
            clearTimeout(waitTimer);
            settle();
          } else if (/(?:failed to unmarshal|Provided Tunnel token is not valid|Unauthorized|ERR .*token)/i.test(text)) {
            errorMsg = 'Cloudflare Tunnel Token 无效或已被吊销';
          }
        }
      };

      spawned.stdout?.on('data', handleChunk);
      spawned.stderr?.on('data', handleChunk);

      spawned.once('error', (err) => {
        if (child !== spawned) return;
        child = null;
        const wasStopped = state === 'stopped';
        state = 'error';
        publicUrl = '';
        errorMsg = err?.message || '启动 cloudflared 失败';
        removeTunnelStateFile();
        clearTimeout(waitTimer);
        settle();
        if (!wasStopped) scheduleAutoRetry();
      });

      spawned.once('exit', (code) => {
        if (child !== spawned) return;
        child = null;
        const wasStopped = state === 'stopped';
        if (!wasStopped) {
          state = 'error';
          publicUrl = '';
          if (!errorMsg) {
            errorMsg = lastErrLine
              ? `cloudflared 异常退出: ${lastErrLine}`
              : `cloudflared 意外退出 (code=${code ?? 'signal'})`;
          }
        }
        removeTunnelStateFile();
        clearTimeout(waitTimer);
        settle();
        if (!wasStopped) scheduleAutoRetry();
      });
    });
  };

  const ensureRunning = () => {
    const cfg = loadOrCreateRemoteConfig();
    if (!cfg.tunnelEnabled) return getStatus();
    if (state === 'running' || state === 'starting') return getStatus();
    const now = Date.now();
    if (state === 'error' && now - lastAutoRetryAt < 8000) return getStatus();
    lastAutoRetryAt = now;
    void start(cfg);
    return getStatus();
  };

  return {
    start,
    stop,
    getStatus,
    ensureRunning,
    configure: async (patch = {}) => {
      if (patch.tailscaleCustomHost !== undefined && String(patch.tailscaleCustomHost || '').trim()) {
        const tsCheck = validateTailscaleCustomHost(patch.tailscaleCustomHost);
        if (!tsCheck.ok) {
          return { ...getStatus(), validationError: tsCheck.error };
        }
      }
      const prevCfg = loadOrCreateRemoteConfig();
      const patchCh = (patch.enabledChannels && typeof patch.enabledChannels === 'object') ? patch.enabledChannels : {};
      const nextTunnelEnabled = patch.enabled !== undefined
        ? Boolean(patch.enabled)
        : (patch.tunnelEnabled !== undefined
            ? Boolean(patch.tunnelEnabled)
            : (typeof patchCh.tunnel === 'boolean' ? patchCh.tunnel : prevCfg.tunnelEnabled));
      const nextModeRaw = patch.tunnelMode !== undefined ? patch.tunnelMode : prevCfg.tunnelMode;
      const nextMode = nextModeRaw === 'named' ? 'named' : 'quick';
      const touchesTunnel = patch.enabled !== undefined
        || patch.tunnelEnabled !== undefined
        || patch.tunnelMode !== undefined
        || patch.tunnelHostname !== undefined
        || patch.tunnelToken !== undefined
        || typeof patchCh.tunnel === 'boolean';

      let validationError = '';
      if (patch.tunnelToken !== undefined && String(patch.tunnelToken || '').trim()) {
        const tokCheck = validateCloudflareTunnelToken(patch.tunnelToken);
        if (!tokCheck.ok) validationError = tokCheck.error;
      }
      if (!validationError && touchesTunnel && nextTunnelEnabled && nextMode === 'named') {
        const hostRaw = patch.tunnelHostname !== undefined ? patch.tunnelHostname : prevCfg.tunnelHostname;
        const hostCheck = validateTunnelHostname(hostRaw);
        if (!hostCheck.ok) {
          validationError = hostCheck.error;
        } else {
          const effTokenRaw = patch.tunnelToken !== undefined ? patch.tunnelToken : prevCfg.tunnelToken;
          const tokCheck = validateCloudflareTunnelToken(effTokenRaw);
          if (!tokCheck.ok) {
            validationError = !String(effTokenRaw || '').trim()
              ? '请粘贴 Cloudflare Tunnel Token 或 cloudflared service install 命令'
              : tokCheck.error;
          }
        }
      }
      if (validationError) {
        if (child) await stop();
        state = 'error';
        publicUrl = '';
        errorMsg = validationError;
        return getStatus();
      }

      const nextCfg = saveRemoteTunnelConfig(patch);
      if (!nextCfg.tunnelEnabled) {
        await stop();
        return getStatus();
      }
      const tunnelConfigChanged = prevCfg.tunnelEnabled !== nextCfg.tunnelEnabled
        || prevCfg.tunnelMode !== nextCfg.tunnelMode
        || prevCfg.tunnelHostname !== nextCfg.tunnelHostname
        || prevCfg.tunnelToken !== nextCfg.tunnelToken;
      if (!tunnelConfigChanged && (state === 'running' || state === 'starting')) {
        errorMsg = '';
        return getStatus();
      }
      if (!touchesTunnel && !tunnelConfigChanged) {
        return getStatus();
      }
      await stop();
      return await start(nextCfg);
    }
  };
}

function acceptsGzipEncoding(rawHeader) {
  if (Array.isArray(rawHeader)) rawHeader = rawHeader.join(',');
  const raw = String(rawHeader || '').trim().toLowerCase();
  if (!raw) return false;
  let gzipQ = null;
  let starQ = null;
  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(';').map((s) => s.trim()).filter(Boolean);
    const coding = parts[0];
    let q = 1;
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx < 0) continue;
      const k = parts[i].slice(0, eqIdx).trim();
      const v = parts[i].slice(eqIdx + 1).trim();
      if (k === 'q') {
        q = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(v) ? Number(v) : 0;
      }
    }
    if (coding === 'gzip' || coding === 'x-gzip') {
      gzipQ = gzipQ === null ? q : Math.min(gzipQ, q);
    } else if (coding === '*') {
      starQ = starQ === null ? q : Math.min(starQ, q);
    }
  }
  if (gzipQ !== null) return gzipQ > 0;
  return starQ !== null && starQ > 0;
}

const PROBE_HINT_CACHE_TTL_MS = 3000;
const LAN_RECENT_SEEN_TTL_MS = 12000;
const probeHintCache = new Map();
let cachedTailscaleBin = '';

function execFileAsync(bin, args, timeoutMs = 1000) {
  return new Promise((resolve) => {
    try {
      execFile(bin, args, {
        timeout: timeoutMs,
        encoding: 'utf8',
        windowsHide: true
      }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      });
    } catch {
      resolve({ ok: false, stdout: '', stderr: '' });
    }
  });
}

function parseTailscalePingOutput(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const m = rawLine.match(/pong\s+from\s+.*?\(([^)\s]+)\)\s+via\s+(\S+)\s+in\s+(?:<\s*)?([0-9.]+)(ms|s)/i);
    if (!m) continue;
    const peerIp = String(m[1] || '').trim();
    const viaRaw = String(m[2] || '').trim();
    const val = Number(m[3]);
    const unit = String(m[4] || 'ms').toLowerCase();
    const rawMs = unit === 's' ? val * 1000 : val;
    const ms = Number.isFinite(rawMs) ? Math.max(1, Math.round(rawMs)) : 1;
    const isDerp = /^DERP\b/i.test(viaRaw);
    let viaIp = '';
    if (!isDerp) {
      const bracketMatch = viaRaw.match(/^\[([^\]]+)\]:\d+$/);
      viaIp = bracketMatch ? bracketMatch[1] : viaRaw.replace(/:\d+$/, '');
    }
    return {
      ok: true,
      peerIp,
      viaRaw,
      viaIp,
      viaLanIp: (!isDerp && isRfc1918Ipv4(viaIp)) ? viaIp : '',
      isDerp,
      ms
    };
  }
  return { ok: false, peerIp: '', viaRaw: '', viaIp: '', viaLanIp: '', isDerp: false, ms: null };
}

async function pingLanIpRtt(ip, execFn = execFileAsync, netsMap = os.networkInterfaces()) {
  if (!isRfc1918Ipv4(ip)) return null;
  if (getLocalHostIpSet(netsMap).has(ip)) return null;
  let args;
  let timeoutMs = 850;
  if (process.platform === 'win32') {
    args = ['-n', '1', '-w', '350', ip];
    timeoutMs = 700;
  } else if (process.platform === 'linux') {
    args = ['-n', '-c', '2', '-i', '0.15', '-W', '1', ip];
    timeoutMs = 1200;
  } else {
    args = ['-n', '-c', '2', '-i', '0.1', '-W', '300', ip];
    timeoutMs = 850;
  }
  const res = await execFn('ping', args, timeoutMs);
  const out = `${res.stdout}\n${res.stderr}`;
  const statsMatch = out.match(/(?:round-trip|rtt)\s+[^=]*=\s*([0-9.]+)\//i);
  if (statsMatch) {
    const ms = Number(statsMatch[1]);
    if (Number.isFinite(ms)) return { ok: true, ms: Math.max(1, Math.round(ms)) };
  }
  const times = [];
  for (const m of out.matchAll(/time[=<]\s*([0-9.]+)\s*ms/ig)) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) times.push(v);
  }
  if (times.length) {
    return { ok: true, ms: Math.max(1, Math.round(Math.min(...times))) };
  }
  return null;
}

async function probeClientPrivateReachability(req, config, opts = {}) {
  const {
    force = false,
    now = Date.now(),
    networkInterfaces: customNets,
    execAsync: customExec,
    skipProbes = process.env.AG_REMOTE_SKIP_PROBES === '1'
  } = opts || {};
  if (skipProbes) return {};
  const netsMap = typeof customNets === 'function' ? customNets() : (customNets || os.networkInterfaces());
  const execFn = typeof customExec === 'function' ? customExec : execFileAsync;
  const localHostIps = getLocalHostIpSet(netsMap);

  const headers = req?.headers || {};
  let urlParams = null;
  if (typeof req?.url === 'string' && req.url.includes('?')) {
    try { urlParams = new URL(req.url, 'http://localhost').searchParams; } catch {}
  }
  const rawDevId = String(headers['x-ag-device-id'] || urlParams?.get('did') || '').trim().slice(0, 64);
  const headerDevId = /^[A-Za-z0-9._:-]{4,64}$/.test(rawDevId) ? rawDevId : '';
  const rawFp = String(headers['x-ag-device-fp'] || urlParams?.get('fp') || '').trim().slice(0, 64);
  const deviceFp = /^[A-Za-z0-9._x@-]{4,64}$/.test(rawFp) ? rawFp : '';
  const deviceHint = String(headers['x-ag-device-hint'] || urlParams?.get('hint') || '').trim().slice(0, 24);
  const ua = String(headers['user-agent'] || '').trim();
  const label = parseDeviceLabel(ua, deviceHint);
  const cacheKey = headerDevId || deviceFp || ua || 'anon';

  if (!force) {
    const cached = probeHintCache.get(cacheKey);
    if (cached && (now - cached.at) < PROBE_HINT_CACHE_TTL_MS) {
      return cached.hints;
    }
  }

  let rec = headerDevId ? (pairedDevicesMap.get(headerDevId) || null) : null;
  if (!rec) {
    let bestSeen = -1;
    for (const v of pairedDevicesMap.values()) {
      if (!v || v.label !== label) continue;
      if (ua && v.ua && v.ua !== ua) continue;
      if (deviceFp && v.fp && v.fp !== deviceFp) continue;
      if ((v.lastSeenAt || 0) > bestSeen) {
        bestSeen = v.lastSeenAt || 0;
        rec = v;
      }
    }
  }

  const en = config?.enabledChannels || {
    lan: true,
    tailscale: true,
    bonjour: true,
    tunnel: Boolean(config?.tunnelEnabled)
  };
  const reqCh = detectRequestChannel(req);
  const reqTsIp = extractTailscaleProxyClientIp(req, reqCh, localHostIps);
  const rawKnownLanIp = rec?.lastLanIp || '';
  const lanSeenRecently = (now - (rec?.lastLanSeenAt || 0)) <= LAN_RECENT_SEEN_TTL_MS;
  const knownLanIp = (rawKnownLanIp && lanSeenRecently && !localHostIps.has(rawKnownLanIp) && isIpInLocalPhysicalLanSubnet(rawKnownLanIp, netsMap))
    ? rawKnownLanIp
    : '';
  const rawKnownTsIp = rec?.lastTailscaleIp || '';
  const knownTsIp = reqTsIp || ((rawKnownTsIp && !localHostIps.has(rawKnownTsIp)) ? rawKnownTsIp : '');

  const labelToOs = {
    iPhone: 'ios',
    iPad: 'ios',
    Android: 'android',
    Mac: 'macos',
    Windows: 'windows'
  };
  const targetOs = labelToOs[label] || '';

  const runTsProbe = async () => {
    if (!en.tailscale && !en.lan) return { statusAvailable: false, attempted: false, pong: null };
    const candidates = cachedTailscaleBin
      ? [cachedTailscaleBin]
      : (process.platform === 'darwin'
          ? ['tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
          : ['tailscale']);
    let workingBin = '';
    let parsedStatus = null;
    for (const bin of candidates) {
      if (bin.startsWith('/') && !customExec && !fs.existsSync(bin)) continue;
      const stRes = await execFn(bin, ['status', '--json'], 800);
      if (stRes.stdout && stRes.stdout.trim().startsWith('{')) {
        try {
          parsedStatus = JSON.parse(stRes.stdout);
          workingBin = bin;
          if (!customExec) cachedTailscaleBin = bin;
          break;
        } catch {}
      }
    }
    if (!workingBin || !parsedStatus || typeof parsedStatus !== 'object') {
      return { statusAvailable: false, attempted: false, pong: null };
    }
    const tsBackendState = String(parsedStatus.BackendState || '').trim();
    if ((tsBackendState && tsBackendState !== 'Running') || parsedStatus.Self?.Online === false) {
      return { statusAvailable: false, attempted: false, pong: null };
    }

    const probeIps = [];
    if (knownTsIp && isTailscaleCgnatIpv4(knownTsIp)) {
      probeIps.push(knownTsIp);
    } else if (targetOs === 'ios' || targetOs === 'android') {
      const mobilePeers = [];
      for (const p of Object.values(parsedStatus.Peer || {})) {
        if (!p || !p.Online) continue;
        if (String(p.OS || '').toLowerCase() !== targetOs) continue;
        const ip4 = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs.find((ip) => isTailscaleCgnatIpv4(String(ip))) : '';
        if (ip4 && !localHostIps.has(String(ip4))) {
          mobilePeers.push({ ip: String(ip4), active: Boolean(p.Active) });
        }
      }
      if (mobilePeers.length === 1) {
        probeIps.push(mobilePeers[0].ip);
      } else if (mobilePeers.length > 1) {
        const activePeers = mobilePeers.filter((x) => x.active);
        if (activePeers.length === 1) {
          probeIps.push(activePeers[0].ip);
        }
      }
    }
    if (!probeIps.length) return { statusAvailable: true, attempted: false, pong: null };

    const pongs = await Promise.all(probeIps.map(async (ip) => {
      const pr = await execFn(workingBin, ['ping', '--c', '1', '--timeout', '1s', ip], 1250);
      return parseTailscalePingOutput(`${pr.stdout}\n${pr.stderr}`);
    }));
    const validPongs = pongs.filter((p) => p && p.ok && Number.isFinite(p.ms));
    validPongs.sort((a, b) => a.ms - b.ms);
    return { statusAvailable: true, attempted: true, pong: validPongs[0] || null };
  };

  const [tsRes, initialLanPing] = await Promise.all([
    runTsProbe(),
    (en.lan && knownLanIp) ? pingLanIpRtt(knownLanIp, execFn, netsMap) : Promise.resolve(null)
  ]);

  let lanPing = initialLanPing;
  const tsPong = tsRes?.pong || null;
  const viaSameLanIpv6 = Boolean(
    tsPong?.ok
    && !tsPong.isDerp
    && !tsPong.viaLanIp
    && tsPong.viaIp
    && isIpv6InLocalPhysicalLanPrefix(tsPong.viaIp, netsMap)
  );
  if (!lanPing?.ok && en.lan && tsPong?.ok && !tsPong.isDerp && tsPong.viaLanIp && !localHostIps.has(tsPong.viaLanIp) && isIpInLocalPhysicalLanSubnet(tsPong.viaLanIp, netsMap)) {
    lanPing = { ok: true, ms: Math.max(2, tsPong.ms) };
    if (rec) {
      rec.lastLanIp = tsPong.viaLanIp;
      rec.lastLanSeenAt = now;
    }
  } else if (!lanPing?.ok && en.lan && viaSameLanIpv6) {
    lanPing = { ok: true, ms: Math.max(2, tsPong.ms) };
  }
  if (tsPong?.ok && rec && isTailscaleCgnatIpv4(tsPong.peerIp) && !localHostIps.has(tsPong.peerIp)) {
    rec.lastTailscaleIp = tsPong.peerIp;
    rec.lastTailscaleSeenAt = now;
  }

  const hints = {};
  if (en.tailscale) {
    if (tsPong?.ok) {
      hints.tailscale = { ok: true, ms: tsPong.ms, via: 'server' };
    } else if (tsRes?.statusAvailable && tsRes?.attempted) {
      hints.tailscale = { ok: false, ms: null, reason: 'unreachable', via: 'server' };
    }
  }
  if (lanPing?.ok) {
    if (en.lan) {
      hints.lan = { ok: true, ms: lanPing.ms, via: 'server' };
    }
    if (en.bonjour && detectHostIdentityMeta().bonjourHost) {
      hints.bonjour = { ok: true, ms: lanPing.ms + 5, via: 'server' };
    }
  } else if (tsPong?.ok && !tsPong.viaLanIp && !viaSameLanIpv6) {
    if (en.lan) hints.lan = { ok: false, ms: null, reason: 'unreachable', via: 'server' };
    if (en.bonjour) hints.bonjour = { ok: false, ms: null, reason: 'unreachable', via: 'server' };
  }

  if (probeHintCache.size > 64) probeHintCache.clear();
  probeHintCache.set(cacheKey, { at: now, hints });
  return hints;
}

function extractCompactUsageSummary(usagePayload) {
  if (!usagePayload || typeof usagePayload !== 'object') return null;
  const sum = usagePayload.summary || {};
  return {
    totalTokens: Number(sum.grandTotalTokens ?? sum.totalTokens ?? 0) || 0,
    todayTokens: Number(sum.todayTokens ?? 0) || 0,
    monthTokens: Number(sum.monthTokens ?? 0) || 0,
    yearTokens: Number(sum.yearTokens ?? 0) || 0,
    planName: String(usagePayload.planStatus?.tierName || '').trim()
  };
}

function createRemoteHttpHandler(initialConfig, options = {}) {
  const getTunnelOrigin = typeof options.getTunnelOrigin === 'function' ? options.getTunnelOrigin : () => '';
  const fetchSnapshot = typeof options.fetchSnapshot === 'function' ? options.fetchSnapshot : fetchSnapshotFromTarget;
  const performAction = typeof options.performAction === 'function' ? options.performAction : performActionInTarget;
  const callLsRpc = typeof options.callLanguageServer === 'function' ? options.callLanguageServer : callLocalLanguageServer;
  const historyManager = options.historyManager || defaultHistoryManager;
  const rpcTimeoutMs = Number(options.rpcTimeoutMs) > 0 ? Number(options.rpcTimeoutMs) : 4500;
  const callLsRpcDetailed = async (method, body, timeoutMs = rpcTimeoutMs, callOpts = {}) => {
    if (typeof options.callLanguageServer === 'function') {
      return await runRpcCallDetailed((m, b) => options.callLanguageServer(m, b), method, body, timeoutMs);
    }
    return await callLocalLanguageServerDetailed(method, body, timeoutMs, callOpts);
  };
  const getUsageData = typeof options.getUsageData === 'function'
    ? options.getUsageData
    : async (opts = {}) => {
        const { collectTokenHistoryAsync } = require('./meter-collector');
        return await collectTokenHistoryAsync(opts);
      };
  let activeConfig = initialConfig;
  let lastMtimeMs = 0;
  let cachedUsageData = null;
  let cachedUsageAt = 0;
  const dispatchedQueueDeletes = new Map();
  const DISPATCHED_QUEUE_TTL_MS = 5 * 60 * 1000;
  const stagedEditUploadsByKey = new Map();
  let nextStagedUploadId = 1;
  const STAGED_EDIT_UPLOADS_TTL_MS = 30 * 60 * 1000;
  const MAX_STAGED_EDIT_UPLOADS_PER_CONV = 10;
  const makeStagedUploadKey = (cidClient, convId) => `${String(cidClient || '__default__').trim() || '__default__'}::${String(convId || '').trim()}`;
  const pruneStagedEditUploads = () => {
    const now = Date.now();
    for (const [k, rec] of stagedEditUploadsByKey.entries()) {
      if (!rec || (now - rec.at) > STAGED_EDIT_UPLOADS_TTL_MS || !Array.isArray(rec.items) || !rec.items.length) {
        stagedEditUploadsByKey.delete(k);
      }
    }
  };
  const getStagedEditUploads = (key) => {
    pruneStagedEditUploads();
    const rec = stagedEditUploadsByKey.get(key);
    return rec && Array.isArray(rec.items) ? rec.items.slice() : [];
  };
  const appendStagedEditUploads = (key, items, opts = {}) => {
    if (!key || !Array.isArray(items) || !items.length) return;
    pruneStagedEditUploads();
    const sourceKey = String(opts?.sourceKey || '').trim();
    const pendingRetry = opts?.pendingRetry === true;
    const pendingRetryMeta = (pendingRetry && opts?.pendingRetryMeta && typeof opts.pendingRetryMeta === 'object')
      ? { ...opts.pendingRetryMeta }
      : null;
    const existingRaw = stagedEditUploadsByKey.get(key)?.items || [];
    // 仅覆盖同一 sourceKey 下尚未确认删除的暂存重试批次（_pendingRetry === true）；已确认删除的独立批次绝不被同文同图新编辑覆盖
    const existing = sourceKey
      ? existingRaw.filter((x) => !(String(x?._sourceKey || '') === sourceKey && x?._pendingRetry === true))
      : existingRaw;
    const taggedItems = items.map((item) => ({
      ...item,
      _stagingId: String(nextStagedUploadId++),
      ...(sourceKey ? { _sourceKey: sourceKey } : {}),
      ...(pendingRetry ? { _pendingRetry: true } : {}),
      ...(pendingRetryMeta ? { _pendingRetryMeta: pendingRetryMeta } : {})
    }));
    const next = existing.concat(taggedItems);
    if (stagedEditUploadsByKey.size >= 100 && !stagedEditUploadsByKey.has(key)) {
      const oldest = stagedEditUploadsByKey.keys().next().value;
      if (oldest !== undefined) stagedEditUploadsByKey.delete(oldest);
    }
    stagedEditUploadsByKey.set(key, { at: Date.now(), items: next });
  };
  const consumeStagedEditUploads = (key, stagingIds) => {
    if (!key || !Array.isArray(stagingIds) || !stagingIds.length) return 0;
    pruneStagedEditUploads();
    const rec = stagedEditUploadsByKey.get(key);
    if (!rec || !Array.isArray(rec.items) || !rec.items.length) return 0;
    const idSet = new Set(stagingIds.map((id) => String(id || '')).filter(Boolean));
    if (!idSet.size) return 0;
    const before = rec.items.length;
    rec.items = rec.items.filter((x) => !idSet.has(String(x?._stagingId || '')));
    const removed = before - rec.items.length;
    if (!rec.items.length) stagedEditUploadsByKey.delete(key);
    else rec.at = Date.now();
    return removed;
  };
  const removeStagedEditUpload = (key, opts = {}) => {
    pruneStagedEditUploads();
    const rec = stagedEditUploadsByKey.get(key);
    if (!rec || !Array.isArray(rec.items) || !rec.items.length) return 0;
    if (opts.clearAll === true) {
      const n = rec.items.length;
      stagedEditUploadsByKey.delete(key);
      return n;
    }
    const reqName = String(opts.name || '').trim().toLowerCase();
    const reqIdx = Number.isInteger(opts.index) ? opts.index : -1;
    let rmIdx = -1;
    if (reqName) {
      if (reqIdx >= 0 && reqIdx < rec.items.length && String(rec.items[reqIdx]?.name || '').trim().toLowerCase() === reqName) {
        rmIdx = reqIdx;
      } else {
        rmIdx = rec.items.findIndex((x) => String(x?.name || '').trim().toLowerCase() === reqName);
      }
    } else if (reqIdx >= 0 && reqIdx < rec.items.length) {
      rmIdx = reqIdx;
    }
    if (rmIdx < 0) return 0;
    rec.items.splice(rmIdx, 1);
    rec.at = Date.now();
    if (!rec.items.length) stagedEditUploadsByKey.delete(key);
    return 1;
  };
  const markDispatchedQueueDelete = (key, text = '', meta = {}) => {
    const now = Date.now();
    for (const [k, v] of dispatchedQueueDeletes.entries()) {
      if (!v || (now - v.at) > DISPATCHED_QUEUE_TTL_MS) dispatchedQueueDeletes.delete(k);
    }
    if (dispatchedQueueDeletes.size >= 500 && !dispatchedQueueDeletes.has(key)) {
      const oldest = dispatchedQueueDeletes.keys().next().value;
      if (oldest !== undefined) dispatchedQueueDeletes.delete(oldest);
    }
    dispatchedQueueDeletes.set(key, { at: now, text, ...(meta && typeof meta === 'object' ? meta : {}) });
  };
  const getDispatchedQueueDelete = (key) => {
    const rec = dispatchedQueueDeletes.get(key);
    if (!rec) return null;
    if ((Date.now() - rec.at) > DISPATCHED_QUEUE_TTL_MS) {
      dispatchedQueueDeletes.delete(key);
      return null;
    }
    return rec;
  };
  const hasDispatchedQueueDelete = (key) => Boolean(getDispatchedQueueDelete(key));
  try {
    lastMtimeMs = fs.statSync(getRemoteConfigPath()).mtimeMs;
  } catch {}

  const getCachedUsageSummary = async () => {
    const now = Date.now();
    if (cachedUsageData && (now - cachedUsageAt) < 15000) {
      return extractCompactUsageSummary(cachedUsageData);
    }
    if (typeof options.getUsageData !== 'function' && typeof options.fetchSnapshot === 'function') {
      return null;
    }
    try {
      const data = await Promise.race([
        getUsageData({ force: false }),
        new Promise((resolve) => setTimeout(() => resolve(null), 500))
      ]);
      if (data && typeof data === 'object') {
        cachedUsageData = data;
        cachedUsageAt = Date.now();
        return extractCompactUsageSummary(data);
      }
    } catch {}
    return cachedUsageData ? extractCompactUsageSummary(cachedUsageData) : null;
  };

  const webPushManager = options.webPushManager || createWebPushManager({
    getStateFilePath: () => path.join(getStateDir(), 'remote-push-state.json'),
    formatCatalogNotification: formatTraditionalCatalogNotification
  });
  let lastCompletedUnreadCount = 0;
  let pushWatcherTimer = null;
  let pushPollInFlight = false;

  const refreshPushStateFromCatalog = async (force = false) => {
    if (pushPollInFlight && !force) return lastCompletedUnreadCount;
    pushPollInFlight = true;
    try {
      let convList = null;
      if (typeof options.pollConversations === 'function') {
        convList = await options.pollConversations({ force });
      } else if (typeof options.fetchSnapshot === 'function') {
        const snap = await options.fetchSnapshot({ bypassCache: force }).catch(() => null);
        if (snap && Array.isArray(snap.conversations)) convList = snap.conversations;
      } else {
        const enriched = await enrichSnapshotWithCatalog({ ok: true, conversations: [] }, {
          bypassCache: force,
          catalogStore: options.catalogStore
        }).catch(() => null);
        if (enriched && Array.isArray(enriched.conversations)) convList = enriched.conversations;
      }
      if (Array.isArray(convList)) {
        const { completedUnreadCount } = webPushManager.observeCatalogItems(convList);
        lastCompletedUnreadCount = completedUnreadCount;
      }
    } catch {} finally {
      pushPollInFlight = false;
    }
    return lastCompletedUnreadCount;
  };

  const stopPushWatcher = () => {
    if (pushWatcherTimer) {
      clearInterval(pushWatcherTimer);
      pushWatcherTimer = null;
    }
  };

  const startPushWatcher = (intervalMs = 6000) => {
    stopPushWatcher();
    const stepMs = Math.max(50, Number(intervalMs) || 6000);
    pushWatcherTimer = setInterval(() => {
      try {
        const info = webPushManager.getPublicInfo();
        if (!info.prefs?.enabled || info.subscriptionCount <= 0) return;
      } catch {
        return;
      }
      void refreshPushStateFromCatalog(false);
    }, stepMs);
    if (typeof pushWatcherTimer.unref === 'function') pushWatcherTimer.unref();
    return pushWatcherTimer;
  };

  const enrichSnapshotPayload = (snap, config, activeTunnelUrl, clientId = '', fallbackUsageSummary = null) => {
    if (!snap || snap.ok === false) return snap;
    const snapInfo = collectFusedEndpointDescriptor(config.port, activeTunnelUrl ? {
      enabled: Boolean(config.tunnelEnabled),
      state: 'running',
      publicUrl: activeTunnelUrl,
      mode: config.tunnelMode
    } : null, config.enabledChannels, {
      readOnly: true,
      tailscaleCustomHost: config.tailscaleCustomHost
    });
    const activeConvId = snap.activeConversationId || snap.sessionId || '';
    const convList = Array.isArray(snap.conversations) ? snap.conversations : [];
    const { completedUnreadCount } = webPushManager.observeCatalogItems(convList);
    lastCompletedUnreadCount = completedUnreadCount;
    const out = {
      ...snap,
      activeConversationId: activeConvId,
      completedUnreadCount,
      hosts: snapInfo.hosts,
      endpoints: snapInfo.endpoints,
      enabledChannels: config.enabledChannels,
      displayConfig: sanitizeRemoteDisplayConfig(config.remoteDisplay),
      quickPrompts: Array.isArray(snap.quickPrompts) ? snap.quickPrompts : resolveCachedRemoteQuickPrompts()
    };
    if (clientId) out.clientId = clientId;
    if (!out.usageSummary && fallbackUsageSummary) {
      out.usageSummary = fallbackUsageSummary;
    }
    return out;
  };

  const getActiveConfig = () => {
    try {
      const cfgPath = getRemoteConfigPath();
      const mtime = fs.statSync(cfgPath).mtimeMs;
      if (mtime !== lastMtimeMs) {
        lastMtimeMs = mtime;
        activeConfig = loadOrCreateRemoteConfig();
      }
    } catch {}
    return activeConfig;
  };

  // 按客户端 IP 统计失败 Token 次数（60 秒窗口内失败 12 次触发限流 429）
  const failedAuthMap = new Map();
  const RATE_LIMIT_WINDOW_MS = 60000;
  const RATE_LIMIT_MAX_FAILS = 12;

  const isRateLimited = (clientKey) => {
    const rec = failedAuthMap.get(clientKey);
    if (!rec) return false;
    if (Date.now() - rec.windowStart > RATE_LIMIT_WINDOW_MS) {
      failedAuthMap.delete(clientKey);
      return false;
    }
    return rec.count >= RATE_LIMIT_MAX_FAILS;
  };

  const recordAuthFailure = (clientKey) => {
    const now = Date.now();
    if (failedAuthMap.size > 512) {
      for (const [k, v] of failedAuthMap.entries()) {
        if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) failedAuthMap.delete(k);
      }
    }
    const prev = failedAuthMap.get(clientKey);
    if (!prev || now - prev.windowStart > RATE_LIMIT_WINDOW_MS) {
      failedAuthMap.set(clientKey, { count: 1, windowStart: now });
    } else {
      prev.count += 1;
    }
  };

  const cachedIcon = buildMobileIconSvg();
  const localizedPages = new Map();
  const compressedPages = new Map();

  function getLocalizedPages(req, assetLanguage) {
    const locale = normalizeRemoteChineseLocale(assetLanguage) || resolveRemoteLocale(req);
    if (!localizedPages.has(locale)) {
      const html = buildMobileAppHtml(locale);
      localizedPages.set(locale, {
        locale,
        html,
        manifest: buildManifestJson(locale),
        serviceWorker: buildServiceWorkerJs(locale),
        unauthorized: buildUnauthorizedHtml(locale)
      });
      try {
        compressedPages.set(html, zlib.gzipSync(Buffer.from(html, 'utf8'), { level: 1 }));
      } catch {}
    }
    return localizedPages.get(locale);
  }

  function mergeVaryHeader(existingVary, token) {
    const parts = String(existingVary || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.some((p) => p.toLowerCase() === token.toLowerCase())) {
      parts.push(token);
    }
    return parts.join(', ');
  }

  function localizedPageHeaders(res, { locale }) {
    return { 'Content-Language': locale, Vary: mergeVaryHeader(res.getHeader?.('Vary'), 'Accept-Language') };
  }

  function sendPayload(req, res, statusCode, headers, bodyStr) {
    const raw = typeof bodyStr === 'string' ? bodyStr : String(bodyStr || '');
    const baseHeaders = headers && typeof headers === 'object' ? { ...headers } : {};
    if (acceptsGzipEncoding(req?.headers?.['accept-encoding']) && Buffer.byteLength(raw, 'utf8') >= 1024) {
      try {
        const gz = compressedPages.get(raw) || zlib.gzipSync(Buffer.from(raw, 'utf8'), { level: 1 });
        const existingVaryKey = Object.keys(baseHeaders).find((k) => k.toLowerCase() === 'vary');
        const resVary = typeof res?.getHeader === 'function' ? res.getHeader('Vary') : '';
        const combinedVary = existingVaryKey ? baseHeaders[existingVaryKey] : resVary;
        const mergedVary = mergeVaryHeader(combinedVary, 'Accept-Encoding');
        if (existingVaryKey && existingVaryKey !== 'Vary') delete baseHeaders[existingVaryKey];
        res.writeHead(statusCode, { ...baseHeaders, 'Content-Encoding': 'gzip', Vary: mergedVary });
        res.end(gz);
        return;
      } catch {
        // gzip 压缩异常时安全回退为未压缩明文响应
      }
    }
    res.writeHead(statusCode, baseHeaders);
    res.end(raw);
  }

  const httpHandler = async (req, res) => {
    let requestLocale;
    const isTraditional = () => (requestLocale ??= resolveRemoteLocale(req)) === 'zh-TW';
    const remoteError = (message) => isTraditional() ? localizeRemoteErrorText(message) : message;
    const serializeResponse = (payload) => JSON.stringify(isTraditional()
      ? localizeRemoteResponse(payload, (message) => localizeRemoteErrorText(message, errorFallback))
      : payload);
    const config = getActiveConfig();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const HTML_CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob: http: https:; connect-src 'self' http: https:; base-uri 'none'; frame-ancestors 'none'";
    const remoteIp = req.socket?.remoteAddress || '';
    if (!isAllowedPrivateAddress(remoteIp)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Private network only');
      return;
    }

    const activeTunnelUrl = getTunnelOrigin() || readPersistedTunnelStatus().publicUrl || config.tunnelHostname || '';
    const allowedTsDns = options.allowedTailscaleDnsName !== undefined
      ? options.allowedTailscaleDnsName
      : [detectHostIdentityMeta().tailscaleDnsName, config.tailscaleCustomHost]
          .filter((h) => String(h || '').trim().toLowerCase().endsWith('.ts.net'));
    const reqOrigin = String(req.headers.origin || '').trim();
    if (reqOrigin && isAllowedPrivateOrigin(reqOrigin, activeTunnelUrl, allowedTsDns)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AG-Remote-Token, X-AG-Device-Id, X-AG-Client-Id, X-AG-Device-Hint, X-AG-Device-Fp, X-AG-Probe');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const hostHeader = String(req.headers.host || `127.0.0.1:${config.port}`);
    let urlObj;
    try {
      urlObj = new URL(req.url || '/', `http://${hostHeader}`);
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }
    const pathname = urlObj.pathname;
    const errorFallback = {
      '/api/action': '操作失敗，請確認電腦端狀態後再試。',
      '/api/projects': '操作失敗，請確認電腦端狀態後再試。',
      '/api/snapshot': '無法讀取對話，請再試一次。',
      '/api/conversations': '無法讀取對話，請再試一次。',
      '/api/messages': '無法讀取對話，請再試一次。',
      '/api/context': '無法讀取上下文，請再試一次。',
      '/api/push/test': '測試推播未送達，請檢查通知權限與連線。',
      '/api/probe-hints': '無法測試連線，請稍後再試。'
    }[pathname];

    const reqChannel = detectRequestChannel(req, activeTunnelUrl);
    const enabledMap = config.enabledChannels || {
      lan: true,
      tailscale: true,
      bonjour: true,
      tunnel: Boolean(config.tunnelEnabled)
    };
    if (reqChannel !== 'loopback' && !enabledMap[reqChannel]) {
      const chNames = { lan: '局域网', tailscale: 'Tailscale', bonjour: 'Bonjour', tunnel: 'Cloudflare 隧道' };
      const msg = remoteError(`${chNames[reqChannel] || reqChannel} 连接方式已停用`);
      if (pathname.startsWith('/api/')) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, channelDisabled: reqChannel, error: msg }));
      } else {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`403 Forbidden: ${msg}`);
      }
      return;
    }

    // 静态 PWA 元数据无任何敏感状态，允许系统桌面图标抓取稳定通过
    if (pathname === '/icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      res.end(cachedIcon);
      return;
    }
    if (pathname === '/icon-180.png' || pathname === '/icon-192.png' || pathname === '/icon-512.png') {
      const iconDim = pathname === '/icon-180.png' ? 180 : (pathname === '/icon-512.png' ? 512 : 192);
      const pngBuf = buildPwaIconPng(iconDim);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(pngBuf.length),
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(pngBuf);
      return;
    }
    if (pathname === '/manifest.json') {
      const pages = getLocalizedPages(req, urlObj.searchParams.get('lang'));
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache', ...localizedPageHeaders(res, pages) });
      res.end(pages.manifest);
      return;
    }
    if (pathname === '/sw.js') {
      const pages = getLocalizedPages(req, urlObj.searchParams.get('lang'));
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Service-Worker-Allowed': '/',
        ...localizedPageHeaders(res, pages)
      });
      res.end(pages.serviceWorker);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/ping.gif') {
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': String(PING_GIF_BUFFER.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Timing-Allow-Origin': '*'
      });
      res.end(PING_GIF_BUFFER);
      return;
    }

    const fromLoopback = !remoteIp || isLoopbackIp(remoteIp);
    const clientKey = String((fromLoopback && req.headers['cf-connecting-ip']) || normalizeRemoteIp(remoteIp) || 'unknown');
    if (isRateLimited(clientKey)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
      res.end(serializeResponse({ ok: false, error: remoteError('配对口令尝试失败次数过多，请等待 60 秒后再试。') }));
      return;
    }

    const { token, fromQuery, fromCookie, uiVersion } = extractRequestToken(req, urlObj);
    const authed = timingSafeTokenMatch(token, config.token);
    if (!authed) {
      recordAuthFailure(clientKey);
      if (pathname.startsWith('/api/')) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(serializeResponse({ ok: false, error: remoteError('未授权，请在终端运行 ag-context-meter remote 重新扫码') }));
      } else {
        const pages = getLocalizedPages(req);
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': HTML_CSP, ...localizedPageHeaders(res, pages) });
        res.end(pages.unauthorized);
      }
      return;
    }
    failedAuthMap.delete(clientKey);

    const isHttpsForwarded = fromLoopback && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';

    // Same-Site 跨端口 CSRF 加固：所有写请求强制要求 application/json，并严格校验同源（协议+主机+有效端口）Origin 或自定义 X-AG-Remote-Token 请求头
    const reqMethodUpper = String(req.method || 'GET').toUpperCase();
    if (reqMethodUpper !== 'GET' && reqMethodUpper !== 'HEAD' && reqMethodUpper !== 'OPTIONS') {
      const rawCt = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (rawCt !== 'application/json') {
        res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError('写接口仅接受 Content-Type: application/json 请求') }));
        return;
      }
      const headerToken = String(req.headers['x-ag-remote-token'] || '').trim();
      const hasValidCustomHeader = Boolean(headerToken && timingSafeTokenMatch(headerToken, config.token));
      const reqProto = (isHttpsForwarded || Boolean(req.socket?.encrypted)) ? 'https:' : 'http:';
      const reqHostHeader = String(req.headers.host || '').trim();
      const parseOriginTuple = (rawUrl) => {
        if (!rawUrl || String(rawUrl).toLowerCase() === 'null') return null;
        try {
          const u = new URL(rawUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
          const effPort = u.port || (u.protocol === 'https:' ? '443' : '80');
          return { protocol: u.protocol, hostname: u.hostname.toLowerCase(), port: effPort };
        } catch {
          return null;
        }
      };
      const reqTuple = reqHostHeader ? parseOriginTuple(`${reqProto}//${reqHostHeader}`) : null;
      const isSameOriginTuple = (t) => Boolean(
        t && reqTuple && t.protocol === reqTuple.protocol && t.hostname === reqTuple.hostname && t.port === reqTuple.port
      );
      const rawOrigin = String(req.headers.origin || '').trim();
      const rawReferer = String(req.headers.referer || '').trim();
      let sameOriginByOrigin = false;
      if (rawOrigin) {
        const originTuple = parseOriginTuple(rawOrigin);
        if (!isSameOriginTuple(originTuple)) {
          if (!hasValidCustomHeader) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(serializeResponse({ ok: false, error: remoteError('检测到跨协议/跨源或跨端口写请求，已拦截 (CSRF)') }));
            return;
          }
        } else {
          sameOriginByOrigin = true;
        }
      } else if (rawReferer) {
        const refTuple = parseOriginTuple(rawReferer);
        if (!isSameOriginTuple(refTuple) && !hasValidCustomHeader) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(serializeResponse({ ok: false, error: remoteError('检测到跨协议/跨源 Referer 写请求，已拦截 (CSRF)') }));
          return;
        }
      }
      // 仅凭 Cookie 鉴权的写请求必须提供严格同源 Origin（或有效自定义 X-AG-Remote-Token），禁止仅凭 Referer 放行
      if (fromCookie && !hasValidCustomHeader && !sameOriginByOrigin) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError('Cookie 鉴权写请求须提供同源 Origin 或 X-AG-Remote-Token 请求头') }));
        return;
      }
    }

    const secureAttr = isHttpsForwarded ? '; Secure' : '';
    const cookiesToSet = [];
    if (fromQuery) {
      cookiesToSet.push(`ag_remote_token=${encodeURIComponent(config.token)}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Max-Age=31536000`);
    }

    const isProbeReq = urlObj.searchParams.get('probe') === '1' || String(req.headers['x-ag-probe'] || '').trim() === '1';
    if (!isProbeReq && (pathname === '/' || pathname === '/api/ping' || pathname === '/api/snapshot' || pathname === '/api/action')) {
      recordPairedDeviceAccess(req, config.token, Date.now(), activeTunnelUrl);
    }

    if (req.method === 'GET' && pathname === '/') {
      if (uiVersion !== MOBILE_UI_VERSION) {
        cookiesToSet.push(`ag_ui_ver=${MOBILE_UI_VERSION}; Path=/; SameSite=Lax${secureAttr}; Max-Age=31536000`);
      }
      if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet);
      const pages = getLocalizedPages(req);
      sendPayload(req, res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': HTML_CSP, ...localizedPageHeaders(res, pages) }, pages.html);
      return;
    }

    if (cookiesToSet.length) {
      res.setHeader('Set-Cookie', cookiesToSet);
    }

    if (req.method === 'GET' && pathname === '/api/ping') {
      const probeNonce = String(urlObj.searchParams.get('_n') || '').trim().slice(0, 40);
      const snapInfo = collectFusedEndpointDescriptor(config.port, activeTunnelUrl ? {
        enabled: Boolean(config.tunnelEnabled),
        state: 'running',
        publicUrl: activeTunnelUrl,
        mode: config.tunnelMode
      } : null, config.enabledChannels, {
        readOnly: true,
        tailscaleCustomHost: config.tailscaleCustomHost
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(serializeResponse({
        ok: true,
        service: 'ag-mobile-remote',
        nonce: probeNonce,
        port: config.port,
        name: snapInfo.deviceName,
        hosts: snapInfo.hosts,
        endpoints: snapInfo.endpoints,
        enabledChannels: config.enabledChannels,
        displayConfig: sanitizeRemoteDisplayConfig(config.remoteDisplay)
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/push/vapid-key') {
      try {
        const info = webPushManager.getPublicInfo();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: true, ...info }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '读取推送密钥状态失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/push/subscribe') {
      try {
        const body = await readJsonBody(req);
        const sub = body?.subscription || body;
        const result = webPushManager.addSubscription(sub, {
          label: body?.label || '',
          origin: body?.origin || String(req.headers.origin || '')
        });
        const code = result.ok ? 200 : (result.statusCode || 400);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '订阅请求解析失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/push/unsubscribe') {
      try {
        const body = await readJsonBody(req);
        const result = webPushManager.removeSubscription(body?.endpoint || '');
        const code = result.ok ? 200 : (result.statusCode || 500);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '取消订阅失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/push/prefs') {
      try {
        const body = await readJsonBody(req);
        const result = webPushManager.updatePrefs(body || {});
        const code = result.ok ? 200 : (result.statusCode || 500);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '更新推送偏好失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/push/test') {
      try {
        await readJsonBody(req);
        const liveUnreadCount = await refreshPushStateFromCatalog(true);
        const result = await webPushManager.broadcast({
          type: 'test',
          title: 'Antigravity 远程通知测试',
          body: '推送通道正常，桌面应用未读角标将随已完成未读数自动同步。',
          tag: 'ag-push-test',
          url: '/',
          completedUnreadCount: liveUnreadCount,
          ts: Date.now()
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: true, completedUnreadCount: liveUnreadCount, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('发送测试推送失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/probe-hints') {
      try {
        const forceProbe = urlObj.searchParams.get('force') === '1';
        const hints = await probeClientPrivateReachability(req, config, { force: forceProbe });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: true, hints }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: true, hints: {}, error: err?.message || '' }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/media') {
      const rawMediaPath = urlObj.searchParams.get('path') || '';
      const checked = resolveSafeLocalMediaPath(rawMediaPath, options.mediaOptions || {});
      if (!checked.ok) {
        res.writeHead(checked.status || 403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: checked.error }));
        return;
      }
      try {
        const buf = fs.readFileSync(checked.realPath);
        const asciiName = checked.baseName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\\r\n]/g, '_') || 'file';
        const utf8Name = encodeURIComponent(checked.baseName);
        const disp = checked.forceAttachment
          ? `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`
          : `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;
        res.writeHead(200, {
          'Content-Type': checked.contentType,
          'Content-Length': String(buf.length),
          'Content-Disposition': disp,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '读取本地文件失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/file-content') {
      const rawFilePath = urlObj.searchParams.get('path') || '';
      const preview = readSafeTextFilePreview(rawFilePath, options.mediaOptions || {});
      res.writeHead(preview.ok ? 200 : (preview.status || 403), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(serializeResponse(preview));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/project-tree') {
      const rawDir = urlObj.searchParams.get('dir') || '';
      const showAll = urlObj.searchParams.get('showAll') === '1';
      const tree = listSafeProjectTree(rawDir, { ...(options.mediaOptions || {}), showAll });
      res.writeHead(tree.ok ? 200 : (tree.status || 403), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(serializeResponse(tree));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session-files') {
      const cid = String(urlObj.searchParams.get('conversationId') || '').trim();
      const diffs = [];
      const artifacts = [];
      const mediaOpts = options.mediaOptions || {};
      const realRoots = resolveMediaAllowedRoots(mediaOpts);
      const resolveRealPathWithAncestors = (absTarget) => {
        try {
          return resolveRealPathWithFallback(absTarget);
        } catch {
          return '';
        }
      };
      const isSafeResolvedTarget = (resolved) => {
        if (!resolved || resolved.includes('\0') || !realRoots.length) return false;
        if (SENSITIVE_MEDIA_DIR_RE.test(resolved) || SENSITIVE_MEDIA_FILE_RE.test(path.basename(resolved)) || (isSensitiveHostPath(resolved, mediaOpts) && !isAllowedBrainArtifactPath(resolved, realRoots, mediaOpts))) return false;
        return realRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
      };
      const trustedBaseDirs = [];
      const addTrustedBaseDir = (rawDir) => {
        const clean = normalizeLocalFileUriToPath(rawDir);
        if (!clean || !path.isAbsolute(clean)) return;
        try {
          const realDir = fs.realpathSync(clean);
          if (!isSafeResolvedTarget(realDir)) return;
          if (!fs.statSync(realDir).isDirectory()) return;
          if (!trustedBaseDirs.includes(realDir)) trustedBaseDirs.push(realDir);
        } catch {}
      };
      if (cid && cid !== '__new__' && cid !== 'new') {
        if (typeof options.resolveConversationProjectDirs === 'function') {
          const customDirs = await Promise.resolve().then(() => options.resolveConversationProjectDirs(cid)).catch(() => []);
          if (Array.isArray(customDirs)) customDirs.forEach(addTrustedBaseDir);
        }
        if (!trustedBaseDirs.length) {
          const allTraj = await Promise.resolve().then(() => callLsRpc('GetAllCascadeTrajectories', {}, 2500)).catch(() => null);
          const summaries = allTraj?.trajectorySummaries || allTraj?.trajectories || {};
          const summary = summaries && typeof summaries === 'object' ? summaries[cid] : null;
          const wsList = Array.isArray(summary?.workspaces) ? summary.workspaces : [];
          for (const ws of wsList) {
            addTrustedBaseDir(ws?.workspaceFolderAbsoluteUri || ws?.folderUri || ws?.path || '');
          }
        }
      }
      const isSafeSessionPath = (rawCandidate, isFilePathField = true) => {
        const candidate = String(rawCandidate || '').trim();
        if (!candidate) return true;
        if (candidate.includes('\0')) return false;
        const slashNorm = candidate.replace(/\\/g, '/');
        if (SENSITIVE_MEDIA_DIR_RE.test(slashNorm) || SENSITIVE_MEDIA_FILE_RE.test(path.basename(slashNorm))) return false;
        if (path.isAbsolute(candidate)) {
          const resolved = resolveRealPathWithAncestors(candidate);
          return isSafeResolvedTarget(resolved);
        }
        const posixNorm = path.posix.normalize(slashNorm);
        if (posixNorm === '..' || posixNorm.startsWith('../') || /(?:^|\/)\.\.(?:\/|$)/.test(slashNorm)) {
          return false;
        }
        if (SENSITIVE_MEDIA_DIR_RE.test(posixNorm) || SENSITIVE_MEDIA_FILE_RE.test(path.basename(posixNorm))) return false;
        const looksLikePath = isFilePathField || slashNorm.includes('/');
        if (looksLikePath && !trustedBaseDirs.length) {
          // 无法确定可信会话项目基准目录时，拒绝解析相对文件路径（fail-closed）
          return false;
        }
        for (const baseDir of trustedBaseDirs) {
          const joined = path.resolve(baseDir, candidate);
          if (!(joined === baseDir || joined.startsWith(baseDir + path.sep))) return false;
          const resolved = resolveRealPathWithAncestors(joined);
          if (!isSafeResolvedTarget(resolved)) return false;
        }
        return true;
      };
      const isSafeSessionEntry = (filePath, displayName, isDiffEntry = false) => {
        if (filePath && !isSafeSessionPath(filePath, true)) return false;
        if (displayName && !isSafeSessionPath(displayName, isDiffEntry)) return false;
        return true;
      };
      if (cid && cid !== '__new__' && cid !== 'new') {
        const [diffRes, artRes] = await Promise.all([
          Promise.resolve().then(() => callLsRpc('GetTrajectoryFileDiffs', { cascadeId: cid }, 4000)).catch(() => null),
          Promise.resolve().then(() => callLsRpc('GetArtifactSnapshots', { cascadeId: cid }, 4000)).catch(() => null)
        ]);
        const rawDiffs = Array.isArray(diffRes?.fileDiffs) ? diffRes.fileDiffs : (Array.isArray(diffRes?.diffs) ? diffRes.diffs : []);
        for (const d of rawDiffs) {
          if (!d || typeof d !== 'object') continue;
          const p = normalizeLocalFileUriToPath(d.absoluteUri || d.uri || d.path || d.filePath || '');
          const rawName = String(d.fileName || d.name || '').trim();
          const name = p ? path.basename(p) : rawName;
          const diff = String(d.unifiedDiff || d.diff || d.patch || '');
          if (!isSafeSessionEntry(p, rawName, true)) continue;
          if (name || p || diff) diffs.push({ name: name || p, path: p, diff });
        }
        const rawArts = Array.isArray(artRes?.artifacts) ? artRes.artifacts : (Array.isArray(artRes?.snapshots) ? artRes.snapshots : []);
        for (const a of rawArts) {
          if (!a || typeof a !== 'object') continue;
          const p = normalizeLocalFileUriToPath(a.absoluteUri || a.uri || a.path || a.filePath || '');
          const rawName = String(a.title || a.name || a.fileName || '').trim();
          const name = rawName || (p ? path.basename(p) : '');
          const content = String(a.content || a.markdown || '');
          if (!isSafeSessionEntry(p, rawName, false)) continue;
          if (name || p || content) artifacts.push({ name: name || 'Artifact', path: p, content });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(serializeResponse({ ok: true, conversationId: cid, diffs, artifacts }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/usage') {
      try {
        const force = urlObj.searchParams.get('force') === '1';
        const data = await getUsageData({ force });
        if (data && typeof data === 'object') {
          cachedUsageData = data;
          cachedUsageAt = Date.now();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: true, data: data || null }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '读取本机用量失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/context') {
      try {
        const clientId = extractRequestClientId(req, urlObj);
        const session = clientId ? getOrCreateClientSession(clientId, config.token) : null;
        const targetId = urlObj.searchParams.get('targetId') || session?.targetId || '';
        const convId = (urlObj.searchParams.get('conversationId') || session?.conversationId || '').trim();
        const snap = await fetchSnapshot(targetId, { conversationId: convId, clientId });
        if (!snap || snap.ok === false) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(serializeResponse({ ok: false, error: snap?.error || remoteError('读取上下文窗口失败') }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({
          ok: true,
          clientId,
          conversationId: snap.activeConversationId || snap.sessionId || convId,
          title: (isTraditional() ? localizeRemoteConversationTitle(snap.title, snap.activeConversationId || snap.sessionId,
            snap.isNewConversation, snap.currentProjectId) : snap.title) || '',
          model: snap.model || '',
          contextBadge: snap.contextBadge || '',
          pulseText: snap.pulseText || '',
          contextPanel: snap.contextPanel || null
        }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('读取上下文窗口失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/snapshot') {
      if ((fromCookie || uiVersion) && uiVersion !== MOBILE_UI_VERSION) {
        res.setHeader('Set-Cookie', `ag_ui_ver=${MOBILE_UI_VERSION}; Path=/; SameSite=Lax${secureAttr}; Max-Age=31536000`);
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, reloadRequired: true, error: remoteError('界面已升级，正在自动刷新…') }));
        return;
      }
      try {
        const clientId = extractRequestClientId(req, urlObj);
        const session = clientId ? getOrCreateClientSession(clientId, config.token) : null;
        const hasExplicitTarget = urlObj.searchParams.has('targetId');
        const hasExplicitConv = urlObj.searchParams.has('conversationId');
        const targetId = hasExplicitTarget
          ? (urlObj.searchParams.get('targetId') || '')
          : (session?.targetId || '');
        const reqConvId = hasExplicitConv
          ? (urlObj.searchParams.get('conversationId') || '').trim()
          : (session?.conversationId || '');
        if (session) {
          if (hasExplicitTarget && targetId !== session.targetId) {
            session.targetId = targetId;
            session.navEpoch = (session.navEpoch || 0) + 1;
          }
          if (hasExplicitConv) {
            if (reqConvId !== session.conversationId) {
              session.navEpoch = (session.navEpoch || 0) + 1;
            }
            session.conversationId = reqConvId;
            if (reqConvId !== '__new__') {
              session.draftNewIsolated = false;
              session.draftSendPending = false;
              session.draftSendPendingAt = 0;
              session.draftSendInflight = false;
              session.draftProjectId = '';
              session.draftProjectName = '';
              session.draftPendingUploads = [];
            }
          }
        }
        const rawLimit = urlObj.searchParams.get('convLimit');
        const convLimit = rawLimit === 'all' || rawLimit === '0'
          ? 0
          : (rawLimit !== null && rawLimit !== '' ? Math.max(1, Number.parseInt(rawLimit, 10) || 100) : 100);
        const rawMsgLimit = urlObj.searchParams.get('msgLimit');
        const msgLimit = rawMsgLimit === 'all' || rawMsgLimit === '0'
          ? 0
          : (rawMsgLimit !== null && rawMsgLimit !== '' ? Math.max(1, Number.parseInt(rawMsgLimit, 10) || 30) : 30);
        const isIsolatedNewDraft = Boolean(session?.draftNewIsolated && reqConvId === '__new__');
        let snap = await fetchSnapshot(targetId, { conversationId: reqConvId, clientId, convLimit, msgLimit: isIsolatedNewDraft ? 0 : msgLimit });
        if (isIsolatedNewDraft && snap && snap.ok !== false) {
          const draftPid = String(session.draftProjectId || '').trim();
          let reconciledId = '';
          if (session.draftSendPending && !session.draftSendInflight) {
            const pendingAt = Number(session.draftSendPendingAt) || 0;
            const convList = Array.isArray(snap.conversations) ? snap.conversations : [];
            const candidates = convList.filter((c) => {
              if (!c || !c.id || c.id === '__new__' || c.id === 'new') return false;
              if (draftPid && String(c.projectId || '').trim() !== draftPid) return false;
              const ts = Number(c.updatedAt || c.lastModifiedMs || (c.lastModifiedTime ? Date.parse(c.lastModifiedTime) : 0)) || 0;
              return pendingAt > 0 && ts >= (pendingAt - 3000);
            });
            if (candidates.length > 0) {
              candidates.sort((a, b) => {
                const ta = Number(a.updatedAt || a.lastModifiedMs || (a.lastModifiedTime ? Date.parse(a.lastModifiedTime) : 0)) || 0;
                const tb = Number(b.updatedAt || b.lastModifiedMs || (b.lastModifiedTime ? Date.parse(b.lastModifiedTime) : 0)) || 0;
                return tb - ta;
              });
              reconciledId = String(candidates[0].id || '').trim();
            } else if (pendingAt > 0 && (Date.now() - pendingAt) >= 15000) {
              session.draftSendPending = false;
              session.draftSendPendingAt = 0;
            }
          }
          if (reconciledId) {
            session.draftNewIsolated = false;
            session.draftSendPending = false;
            session.draftSendPendingAt = 0;
            session.draftSendInflight = false;
            session.draftProjectId = '';
            session.draftProjectName = '';
            session.draftPendingUploads = [];
            session.conversationId = reconciledId;
            const boundSnap = await fetchSnapshot(targetId, {
              conversationId: reconciledId,
              clientId,
              convLimit,
              msgLimit,
              bypassCache: true,
              bypassCatalogCache: true
            }).catch(() => null);
            snap = (boundSnap && boundSnap.ok !== false)
              ? boundSnap
              : { ...snap, isolated: false, isNewConversation: false, sessionId: reconciledId, activeConversationId: reconciledId };
          } else {
            const matchedProj = draftPid
              ? ((Array.isArray(snap.projects) ? snap.projects : []).find((p) => p && String(p.id || '') === draftPid)
                || (Array.isArray(snap.projectGroups) ? snap.projectGroups : []).find((g) => g && String(g.id || '') === draftPid))
              : null;
            const draftName = String(session.draftProjectName || matchedProj?.name || snap.currentProjectName || '').trim();
            snap = {
              ...snap,
              isolated: true,
              isNewConversation: true,
              sessionId: '__new__',
              activeConversationId: '',
              title: '新对话',
              currentProjectId: draftPid || snap.currentProjectId || '',
              currentProjectName: draftName,
              messages: [],
              totalMessages: 0,
              hasEarlierMessages: false,
              pendingApprovals: [],
              pendingPrompts: [],
              queuedMessages: [],
              busy: false
            };
          }
        }
        if (session && snap && snap.ok !== false) {
          if (!session.targetId && snap.currentTargetId) session.targetId = snap.currentTargetId;
          if (!session.conversationId && (snap.activeConversationId || snap.sessionId)) {
            session.conversationId = String(snap.activeConversationId || snap.sessionId || '');
          }
        }
        const usageSummary = (snap && snap.ok !== false && !snap.usageSummary)
          ? await getCachedUsageSummary()
          : null;
        const payloadOut = enrichSnapshotPayload(snap, config, activeTunnelUrl, clientId, usageSummary);
        sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(payloadOut));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('读取 Antigravity 状态失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/conversations') {
      try {
        const projectId = urlObj.searchParams.get('projectId') || '';
        const offset = Math.max(0, Number.parseInt(urlObj.searchParams.get('offset') || '0', 10) || 0);
        const rawLimit = urlObj.searchParams.get('limit') || '100';
        const limit = (rawLimit === 'all' || rawLimit === '0') ? 0 : Math.max(1, Number.parseInt(rawLimit, 10) || 100);
        const page = listCatalogConversations({ projectId, offset, limit });
        sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(page));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('读取会话列表失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/messages') {
      try {
        const sessionId = urlObj.searchParams.get('sessionId') || '';
        if (!String(sessionId).trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(serializeResponse({ ok: false, error: remoteError('缺少 sessionId 参数') }));
          return;
        }
        const before = urlObj.searchParams.get('before');
        const rawLimit = urlObj.searchParams.get('limit') || '30';
        const limit = Math.max(1, Math.min(200, Number.parseInt(rawLimit, 10) || 30));
        const page = await getConversationMessagesPage({ sessionId, before, limit });
        sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(page));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('读取会话消息失败') }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/fs/dirs') {
      try {
        const dirPath = urlObj.searchParams.get('path') || '';
        const rawHidden = String(urlObj.searchParams.get('showHidden') || '').trim().toLowerCase();
        const showHidden = rawHidden === '1' || rawHidden === 'true';
        const listing = listHostDirectories({
          dirPath,
          showHidden,
          ...(options.homeDir ? { homeDir: options.homeDir } : {}),
          ...(Array.isArray(options.allowedRoots) ? { allowedRoots: options.allowedRoots } : {}),
          ...(options.configDir ? { configDir: options.configDir } : {})
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse(listing));
      } catch (err) {
        res.writeHead(err?.status || 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '读取目录失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/fs/mkdir') {
      try {
        const payload = await readJsonBody(req);
        const result = createHostSubdirectory(payload, {
          ...(options.homeDir ? { homeDir: options.homeDir } : {}),
          ...(Array.isArray(options.allowedRoots) ? { allowedRoots: options.allowedRoots } : {})
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(serializeResponse(result));
      } catch (err) {
        const errHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        if (err?.status === 413) errHeaders.Connection = 'close';
        res.writeHead(err?.status || 400, errHeaders);
        res.end(serializeResponse({ ok: false, error: remoteError(err?.message || '创建文件夹失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/projects') {
      try {
        const payload = await readJsonBody(req);
        const clientId = extractRequestClientId(req, urlObj, payload);
        const session = clientId ? getOrCreateClientSession(clientId, config.token) : null;
        const createdRes = await createRemoteProject(payload, {
          ...(options.homeDir ? { homeDir: options.homeDir } : {}),
          ...(Array.isArray(options.allowedRoots) ? { allowedRoots: options.allowedRoots } : {}),
          ...(options.configDir ? { configDir: options.configDir } : {}),
          ...(options.localApiConnect ? { localApiConnect: options.localApiConnect } : {}),
          ...(options.allowDiskFallback !== undefined ? { allowDiskFallback: options.allowDiskFallback } : {})
        });
        const shouldNavigate = payload?.openInDesktop !== false && options.openInDesktop !== false && Boolean(createdRes?.project?.id);
        let navOk = shouldNavigate ? false : null;
        let navError = '';
        let navResult = null;
        let snapshot = null;
        const doPerformAction = typeof options.performAction === 'function' ? options.performAction : performActionInTarget;
        const doFetchSnapshot = typeof options.fetchSnapshot === 'function' ? options.fetchSnapshot : fetchSnapshotFromTarget;
        if (shouldNavigate) {
          const checkNavOk = (r) => Boolean(r && r.ok !== false && (!r.actionResult || r.actionResult.ok !== false));
          if (!createdRes.alreadyExists && !options.performAction) {
            await new Promise((r) => setTimeout(r, 180));
          }
          let actionRes = await doPerformAction({
            action: 'new-conversation',
            projectId: createdRes.project.id,
            targetId: payload?.targetId || '',
            clientId,
            conversationId: ''
          }).catch((err) => ({ ok: false, error: remoteError(err?.message || '未能切换桌面端至新建项目') }));
          if (!checkNavOk(actionRes) && !createdRes.alreadyExists && !options.performAction) {
            await new Promise((r) => setTimeout(r, 350));
            actionRes = await doPerformAction({
              action: 'new-conversation',
              projectId: createdRes.project.id,
              targetId: payload?.targetId || '',
              clientId,
              conversationId: ''
            }).catch((err) => ({ ok: false, error: remoteError(err?.message || '未能切换桌面端至新建项目') }));
          }
          const rawNav = (actionRes?.actionResult && typeof actionRes.actionResult === 'object')
            ? actionRes.actionResult
            : (actionRes && typeof actionRes === 'object' ? actionRes : {});
          navOk = checkNavOk(actionRes);
          navError = navOk ? '' : String(rawNav.error || actionRes?.error || '桌面端未能进入该项目新对话');
          navResult = {
            ...rawNav,
            ok: navOk,
            ...(navError ? { error: navError } : {})
          };
          snapshot = actionRes?.snapshot || await doFetchSnapshot(payload?.targetId || '', { convLimit: 100, msgLimit: 30, bypassCache: true, clientId }).catch(() => null);
          if (navOk && session) {
            session.conversationId = String(snapshot?.activeConversationId || snapshot?.sessionId || '__new__');
            if (snapshot?.currentTargetId) session.targetId = snapshot.currentTargetId;
          }
          if (snapshot && snapshot.ok !== false) {
            const usageSummary = !snapshot.usageSummary ? await getCachedUsageSummary() : null;
            snapshot = enrichSnapshotPayload(snapshot, config, activeTunnelUrl, clientId, usageSummary);
          }
        }
        sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
          ...createdRes,
          navOk,
          navError,
          navResult,
          snapshot
        }));
      } catch (err) {
        const errHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        if (err?.status === 413) errHeaders.Connection = 'close';
        res.writeHead(err?.status || 400, errHeaders);
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('创建项目失败') }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/action') {
      try {
        const payload = await readJsonBody(req);
        const clientId = extractRequestClientId(req, urlObj, payload);
        const session = clientId ? getOrCreateClientSession(clientId, config.token) : null;
        const effectiveTargetId = String(payload?.targetId || session?.targetId || '').trim();
        const actionName = String(payload?.action || '').trim();

        if (actionName === 'send-queued-messages' || actionName === 'delete-queued-message' || actionName === 'edit-queued-message') {
          const cascadeId = String(payload?.conversationId || session?.conversationId || '').trim();
          if (!cascadeId || cascadeId === '__new__' || cascadeId === 'new') {
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('当前尚未打开有效会话，请先选择一个对话') }));
            return;
          }
          const messageId = String(payload?.messageId || '').trim();
          const messageIds = Array.isArray(payload?.messageIds) ? payload.messageIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
          const isDomQueueSource = payload?.source === 'dom' && !messageId;
          let rpcRes = null;
          let usedDomFallback = false;
          let deduplicatedRetry = false;
          let editedText = String(payload?.text || '');
          let editedAttachments = [];
          let recoveryKey = '';
          const hasMediaMarkerText = (s) => /\[(?:附带\s*\d+\s*张图片|图片附件|图片\s*×\d+)\]/.test(String(s || ''));
          const stripMediaMarkerForMatch = (s) => String(s || '')
            .replace(/(?:\s*\[附带\s*\d+\s*张图片\]|\s*\[图片附件\]|\s*\[图片\s*×\d+\])+$/g, '')
            .trim();
          const extractQueuedStepIdentityToken = (stepObj, uiObj) => String(
            stepObj?.id ||
            stepObj?.stepId ||
            stepObj?.step_id ||
            stepObj?.messageId ||
            stepObj?.message_id ||
            uiObj?.id ||
            uiObj?.clientMessageId ||
            uiObj?.client_message_id ||
            ''
          ).trim();
          const hasStepIdentityContinuity = (prevMeta, curMeta) => {
            if (!prevMeta || !curMeta) return false;
            const prevTok = String(prevMeta.stepIdentityToken || '').trim();
            const curTok = String(curMeta.stepIdentityToken || '').trim();
            // 必须具备可验证的协议级步骤唯一 ID 且前后严格一致；一旦步骤 ID 匹配，即使轨迹追加了无关步骤（总步数增长或索引变化）也允许安全重试，无 ID 或 ID 变化一律拒绝
            return Boolean(prevTok && curTok && prevTok === curTok);
          };
          const verifyStepIndexTargetIdentity = (targetUi, matchedQ, reqPayload) => {
            const rawReqText = typeof reqPayload?.text === 'string' ? reqPayload.text : '';
            const reqMediaSig = String(reqPayload?.mediaSig || '').trim();
            const hasClientIdentityHint = Boolean(rawReqText.trim() || reqPayload?.hasMedia === true || reqMediaSig);
            if (!hasClientIdentityHint) return { ok: true };
            const reqExpectsMedia = Boolean(reqPayload?.hasMedia === true || hasMediaMarkerText(rawReqText) || reqMediaSig);
            const reqTextNorm = stripDisplayMediaSuffixFromQueuedText(rawReqText, reqExpectsMedia).replace(/\s+/g, ' ').trim();
            const liveRawMedia = extractRawMediaEntriesFromUserInput(targetUi);
            const liveRawText = targetUi ? formatTrajectoryUserInput(targetUi) : String(matchedQ?.text || '');
            const liveHasMedia = Boolean(
              matchedQ?.hasMedia ||
              (Array.isArray(matchedQ?.images) && matchedQ.images.length > 0) ||
              liveRawMedia.length > 0 ||
              hasMediaMarkerText(liveRawText)
            );
            const liveTextNorm = stripDisplayMediaSuffixFromQueuedText(liveRawText, liveHasMedia).replace(/\s+/g, ' ').trim();
            if (reqTextNorm !== liveTextNorm || reqExpectsMedia !== liveHasMedia) {
              return {
                ok: false,
                error: remoteError('目标排队步骤内容或媒体形态已变化（索引已被其他消息占用），已取消操作以防误删')
              };
            }
            if (reqExpectsMedia && liveHasMedia) {
              const liveMediaSig = buildQueuedStepMediaSig(targetUi);
              if (reqMediaSig) {
                if (!liveMediaSig || reqMediaSig !== liveMediaSig) {
                  return {
                    ok: false,
                    error: remoteError('目标排队步骤的媒体附件签名已变化（索引已被同文异附件消息占用），已取消操作以防误删')
                  };
                }
              } else if (!reqTextNorm && !liveTextNorm) {
                return {
                  ok: false,
                  error: remoteError('纯媒体排队项缺少匹配的媒体身份标识（索引可能已被其他媒体项占用），已取消操作以防误删')
                };
              }
            }
            return { ok: true };
          };
          const buildQueuedStepFingerprint = (uiObj, fallbackTxt = '') => {
            const rawEntries = extractRawMediaEntriesFromUserInput(uiObj);
            const normTxt = stripDisplayMediaSuffixFromQueuedText(
              uiObj ? formatTrajectoryUserInput(uiObj) : String(fallbackTxt || ''),
              rawEntries.length > 0
            ).replace(/\s+/g, ' ').trim();
            const mediaSig = buildQueuedStepMediaSig(uiObj);
            return `${normTxt}||${mediaSig}`;
          };
          const collectQueuedStepFingerprints = (stepsArr, containerObj) => {
            const fps = [];
            const seenStepIdx = new Set();
            const extraArr = Array.isArray(containerObj?.queuedSteps)
              ? containerObj.queuedSteps
              : (Array.isArray(containerObj?.queued_steps) ? containerObj.queued_steps : []);
            for (const qs of extraArr) {
              if (!qs || typeof qs !== 'object') continue;
              const idxNum = Number(qs.stepIndex ?? qs.step_index);
              if (Number.isInteger(idxNum) && idxNum >= 0) seenStepIdx.add(idxNum);
              const uiObj = qs.userInput || qs.user_input || qs;
              fps.push({ stepIndex: Number.isInteger(idxNum) ? idxNum : -1, fp: buildQueuedStepFingerprint(uiObj, '') });
            }
            if (Array.isArray(stepsArr)) {
              for (let si = 0; si < stepsArr.length; si += 1) {
                if (seenStepIdx.has(si)) continue;
                const st = stepsArr[si];
                if (isQueuedTrajectoryUserStep(st)) {
                  fps.push({ stepIndex: si, fp: buildQueuedStepFingerprint(st?.userInput || st?.user_input || null, '') });
                }
              }
            }
            return fps;
          };
          const stageKey = makeStagedUploadKey(clientId, cascadeId);
          const restoreMediaAndDeleteQueued = async ({ rawUi, fallbackText, deleteMethod, deleteBody, dispatchKey, sourceKey: explicitSourceKey, pendingRetryMeta, checkPendingCollision, verifyOriginalStillQueued }) => {
            const rawEntries = extractRawMediaEntriesFromUserInput(rawUi);
            const mat = materializeQueuedAttachmentsForEdit(rawEntries, options.mediaOptions || {});
            if (!mat.ok || !mat.attachments.length) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  mediaRecoveryUnavailable: true,
                  error: mat.error || remoteError('该排队消息包含媒体附件，当前无法完整恢复附件数据，已取消撤回以避免丢失附件')
                }
              };
            }
            const sourceKey = String(explicitSourceKey || dispatchKey || '').trim();
            if (sourceKey) recoveryKey = sourceKey;
            const currentStagedList = getStagedEditUploads(stageKey);
            const existingPendingForSource = sourceKey
              ? currentStagedList.find((x) => String(x?._sourceKey || '') === sourceKey && x?._pendingRetry === true)
              : null;
            if (existingPendingForSource && typeof checkPendingCollision === 'function' && !checkPendingCollision(existingPendingForSource._pendingRetryMeta || null)) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  outcomeUnknown: true,
                  error: remoteError('当前会话存在同内容未确认撤回的暂存批次，无法确认本次编辑是否为原项重试，已取消删除以防覆盖已保留内容')
                }
              };
            }
            const existingOtherCount = currentStagedList.filter((x) => !(sourceKey && String(x?._sourceKey || '') === sourceKey && x?._pendingRetry === true)).length;
            if (existingOtherCount + mat.attachments.length > MAX_STAGED_EDIT_UPLOADS_PER_CONV) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  mediaRecoveryUnavailable: true,
                  error: `当前会话待重发暂存附件将超过上限（${MAX_STAGED_EDIT_UPLOADS_PER_CONV} 个），已取消撤回以避免丢失早期附件；请先发送或移除部分附件`
                }
              };
            }
            const cleanRestoredText = stripDisplayMediaSuffixFromQueuedText(fallbackText, true);
            const clientAttsMeta = mat.attachments.map(({ name, mimeType, size, isImage, previewUrl }) => ({
              name,
              mimeType,
              size,
              isImage,
              previewUrl
            }));
            const stageableItems = mat.attachments.map(({ name, mimeType, base64, size, isImage, previewUrl }) => ({
              name,
              mimeType,
              base64,
              size,
              isImage,
              previewUrl
            }));
            const delOutcome = await callLsRpcDetailed(deleteMethod, deleteBody, rpcTimeoutMs);
            if (delOutcome.ok) {
              appendStagedEditUploads(stageKey, stageableItems, { sourceKey });
              if (dispatchKey) dispatchedQueueDeletes.delete(dispatchKey);
              editedText = cleanRestoredText;
              editedAttachments = clientAttsMeta;
              return { ok: true, rpcRes: delOutcome.result };
            }
            if (delOutcome.confirmedNotExecuted) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  error: delOutcome.error || remoteError('删除原排队消息被服务端拒绝，已保留原排队项')
                }
              };
            }
            // 删除结果未知（超时/断连/null）：绝不盲目丢弃已恢复附件；核验原排队项真实状态后再决策
            const stillQueued = typeof verifyOriginalStillQueued === 'function'
              ? await verifyOriginalStillQueued().catch(() => null)
              : null;
            if (stillQueued === false) {
              appendStagedEditUploads(stageKey, stageableItems, { sourceKey });
              if (dispatchKey) dispatchedQueueDeletes.delete(dispatchKey);
              editedText = cleanRestoredText;
              editedAttachments = clientAttsMeta;
              return { ok: true, verifiedAfterUnknownDelete: true, rpcRes: { verifiedDeleted: true } };
            }
            if (stillQueued === true) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  error: delOutcome.error || remoteError('删除原排队消息响应超时，经核验原项仍在队列中，请重试')
                }
              };
            }
            // 核验亦不可得：保留暂存附件并回传前端（标记 pendingRetry: true 与连续性元数据供后续重试复用覆盖，已确认删除的独立批次不互相覆盖）
            appendStagedEditUploads(stageKey, stageableItems, { sourceKey, pendingRetry: true, pendingRetryMeta });
            editedText = cleanRestoredText;
            editedAttachments = clientAttsMeta;
            return {
              ok: false,
              errorPayload: {
                ok: false,
                outcomeUnknown: true,
                attachmentsPreserved: true,
                textPreserved: true,
                error: remoteError('删除原排队消息响应超时且无法确认原项状态，已保留恢复的文本与附件以避免丢失'),
                actionResult: {
                  ok: false,
                  outcomeUnknown: true,
                  attachmentsPreserved: true,
                  textPreserved: true,
                  action: actionName,
                  cascadeId,
                  ...(sourceKey ? { recoveryKey: sourceKey } : {}),
                  editedText: cleanRestoredText,
                  editedAttachments: clientAttsMeta
                }
              }
            };
          };
          const deleteQueuedTextForEdit = async ({ text, deleteMethod, deleteBody, dispatchKey, sourceKey: explicitSourceKey, verifyOriginalStillQueued }) => {
            const restoredText = String(text || '');
            const recKey = String(explicitSourceKey || dispatchKey || '').trim();
            if (recKey) recoveryKey = recKey;
            const delOutcome = await callLsRpcDetailed(deleteMethod, deleteBody, rpcTimeoutMs);
            if (delOutcome.ok) {
              if (dispatchKey) dispatchedQueueDeletes.delete(dispatchKey);
              editedText = restoredText;
              return { ok: true, rpcRes: delOutcome.result };
            }
            if (delOutcome.confirmedNotExecuted) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  error: delOutcome.error || remoteError('删除原排队消息被服务端拒绝，已保留原排队项')
                }
              };
            }
            const stillQueued = typeof verifyOriginalStillQueued === 'function'
              ? await verifyOriginalStillQueued().catch(() => null)
              : null;
            if (stillQueued === false) {
              if (dispatchKey) dispatchedQueueDeletes.delete(dispatchKey);
              editedText = restoredText;
              return { ok: true, verifiedAfterUnknownDelete: true, rpcRes: { verifiedDeleted: true } };
            }
            if (stillQueued === true) {
              return {
                ok: false,
                errorPayload: {
                  ok: false,
                  error: delOutcome.error || remoteError('删除原排队消息响应超时，经核验原项仍在队列中，请重试')
                }
              };
            }
            editedText = restoredText;
            return {
              ok: false,
              errorPayload: {
                ok: false,
                outcomeUnknown: true,
                textPreserved: true,
                error: remoteError('删除原排队消息响应超时且无法确认原项状态，已保留恢复的文本以避免丢失'),
                actionResult: {
                  ok: false,
                  outcomeUnknown: true,
                  textPreserved: true,
                  action: actionName,
                  cascadeId,
                  ...(recKey ? { recoveryKey: recKey } : {}),
                  editedText: restoredText
                }
              }
            };
          };
          const runQueuedDomFallback = async (domAct, sendAllFlag, overrides = {}) => {
            const rawIdx = overrides.domIndex !== undefined ? overrides.domIndex : payload?.domIndex;
            const hasExplicitIdx = rawIdx !== undefined && rawIdx !== null && rawIdx !== '' && Number.isInteger(Number(rawIdx));
            const resolvedDomIdx = hasExplicitIdx ? Number(rawIdx) : undefined;
            const rawExpCount = overrides.expectedQueueCount !== undefined ? overrides.expectedQueueCount : payload?.expectedQueueCount;
            const hasExpCount = rawExpCount !== undefined && rawExpCount !== null && rawExpCount !== '' && Number.isInteger(Number(rawExpCount)) && Number(rawExpCount) > 0;
            const resolvedText = overrides.text !== undefined ? String(overrides.text) : editedText;
            let domRes = null;
            try {
              domRes = await performAction({
                action: domAct,
                clientId,
                targetId: effectiveTargetId || undefined,
                conversationId: cascadeId,
                ...(messageId ? { messageId } : {}),
                ...(resolvedDomIdx !== undefined && resolvedDomIdx >= 0 ? { domIndex: resolvedDomIdx } : {}),
                ...(hasExpCount ? { expectedQueueCount: Number(rawExpCount) } : {}),
                ...(payload?.hasMedia ? { hasMedia: true } : {}),
                sendAll: sendAllFlag,
                text: resolvedText
              });
            } catch (domErr) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: domErr?.message || remoteError('桌面端队列操作失败') }));
              return false;
            }
            if (!domRes?.ok) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                ...(domRes?.mediaRecoveryUnavailable || domRes?.actionResult?.mediaRecoveryUnavailable ? { mediaRecoveryUnavailable: true } : {}),
                error: domRes?.error || domRes?.actionResult?.error || remoteError('电脑端队列操作未能生效，请重试')
              }));
              return false;
            }
            if (typeof domRes?.actionResult?.editedText === 'string') {
              editedText = domRes.actionResult.editedText;
            }
            if (Array.isArray(domRes?.actionResult?.editedAttachments)) {
              editedAttachments = domRes.actionResult.editedAttachments;
            }
            if (Array.isArray(domRes?.actionResult?.stageableAttachments) && domRes.actionResult.stageableAttachments.length) {
              const domSourceKey = messageId ? `${cascadeId}::msg:${messageId}` : '';
              appendStagedEditUploads(stageKey, domRes.actionResult.stageableAttachments, domSourceKey ? { sourceKey: domSourceKey } : {});
            }
            usedDomFallback = true;
            return true;
          };
          const respondPartialSendDeleteFailure = async (extraIds = {}, errMsg = '') => {
            historyManager.invalidateSession?.(cascadeId);
            const partialSnap = await fetchSnapshot(effectiveTargetId, {
              conversationId: cascadeId,
              clientId,
              convLimit: 100,
              msgLimit: 30,
              bypassCache: true,
              bypassCatalogCache: true
            }).catch(() => null);
            const usageSummary = (partialSnap && partialSnap.ok !== false && !partialSnap.usageSummary) ? await getCachedUsageSummary() : null;
            const enrichedPartial = enrichSnapshotPayload(partialSnap, config, activeTunnelUrl, clientId, usageSummary);
            const finalErr = errMsg || '消息已立即发送，但移除原排队项失败；再次点击将仅重试移除而不重复发送';
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: false,
              partialSuccess: true,
              sent: true,
              deleteFailed: true,
              error: finalErr,
              actionResult: {
                ok: false,
                partialSuccess: true,
                sent: true,
                deleteFailed: true,
                action: actionName,
                cascadeId,
                ...extraIds
              },
              snapshot: enrichedPartial
            }));
          };
          const sendSingleQueuedWithCheckedDelete = async ({ dispatchKey, text, hasMedia, deleteMethod, deleteBody, dispatchMeta }) => {
            if (hasDispatchedQueueDelete(dispatchKey)) {
              const delRetryOutcome = await callLsRpcDetailed(deleteMethod, deleteBody, rpcTimeoutMs);
              if (!delRetryOutcome.ok) {
                return {
                  ok: false,
                  partialSuccess: true,
                  error: delRetryOutcome.error || remoteError('消息此前已发送，重试移除原排队项仍失败；请稍后再试，不会重复发送')
                };
              }
              dispatchedQueueDeletes.delete(dispatchKey);
              return { ok: true, rpcRes: delRetryOutcome.result, deduplicatedRetry: true };
            }
            if (hasMedia || !String(text || '').trim()) {
              return { ok: false, needsDomFallback: true };
            }
            const cascadeConfig = historyManager.getCachedUserConfig?.(cascadeId) || null;
            const sendOutcome = await callLsRpcDetailed(
              'SendUserCascadeMessage',
              {
                cascadeId,
                items: [{ text: String(text) }],
                deliveryStrategy: 'MESSAGE_DELIVERY_STRATEGY_NEXT_INVOCATION',
                ...(cascadeConfig ? { cascadeConfig } : {})
              },
              rpcTimeoutMs
            );
            if (!sendOutcome.ok) {
              return {
                ok: false,
                sendFailed: true,
                confirmedNotExecuted: Boolean(sendOutcome.confirmedNotExecuted),
                error: sendOutcome.error || remoteError('立即发送排队消息失败')
              };
            }
            const delOutcome = await callLsRpcDetailed(deleteMethod, deleteBody, rpcTimeoutMs);
            if (!delOutcome.ok) {
              markDispatchedQueueDelete(dispatchKey, String(text), dispatchMeta);
              return {
                ok: false,
                partialSuccess: true,
                error: delOutcome.error || remoteError('消息已立即发送，但移除原排队项失败；再次点击将仅重试移除而不重复发送')
              };
            }
            dispatchedQueueDeletes.delete(dispatchKey);
            return { ok: true, rpcRes: sendOutcome.result, deduplicatedRetry: false };
          };
          if (messageId) {
            const dispatchKey = `${cascadeId}::msg:${messageId}`;
            if (actionName === 'delete-queued-message') {
              rpcRes = await callLsRpc('DeleteAgentMessage', { messageId, recipient: cascadeId }, rpcTimeoutMs);
              if (rpcRes !== null && rpcRes !== false) {
                dispatchedQueueDeletes.delete(dispatchKey);
              }
            } else if (actionName === 'edit-queued-message') {
              const pendingRec = await historyManager.resolvePendingMessageForEdit(cascadeId, messageId, {
                localApiConnect: options.localApiConnect,
                fetchPendingAgentMessages: options.fetchPendingAgentMessages
              }).catch(() => null);
              const rawEntriesFromRec = pendingRec?.ui ? extractRawMediaEntriesFromUserInput(pendingRec.ui) : [];
              const baseEditText = String(pendingRec?.text || editedText || '');
              const itemHasMedia = Boolean(
                payload?.hasMedia ||
                pendingRec?.hasMedia ||
                rawEntriesFromRec.length > 0 ||
                hasMediaMarkerText(baseEditText)
              );
              const verifyMsgStillQueued = async () => {
                historyManager.invalidateSession?.(cascadeId);
                const freshList = await historyManager.fetchPendingAgentMessages?.(cascadeId, {
                  localApiConnect: options.localApiConnect,
                  fetchPendingAgentMessages: options.fetchPendingAgentMessages,
                  bypassCache: true
                }).catch(() => null);
                if (!Array.isArray(freshList)) return null;
                return freshList.some((item) => item && String(item.messageId || item.id || '').trim() === messageId);
              };
              if (itemHasMedia) {
                const recovered = await restoreMediaAndDeleteQueued({
                  rawUi: pendingRec?.ui || null,
                  fallbackText: baseEditText,
                  deleteMethod: 'DeleteAgentMessage',
                  deleteBody: { messageId, recipient: cascadeId },
                  dispatchKey,
                  verifyOriginalStillQueued: verifyMsgStillQueued
                });
                if (!recovered.ok) {
                  sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(recovered.errorPayload));
                  return;
                }
                rpcRes = recovered.rpcRes;
              } else {
                const recoveredText = await deleteQueuedTextForEdit({
                  text: baseEditText,
                  deleteMethod: 'DeleteAgentMessage',
                  deleteBody: { messageId, recipient: cascadeId },
                  dispatchKey,
                  verifyOriginalStillQueued: verifyMsgStillQueued
                });
                if (!recoveredText.ok) {
                  sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(recoveredText.errorPayload));
                  return;
                }
                rpcRes = recoveredText.rpcRes;
              }
            } else {
              const outcome = await sendSingleQueuedWithCheckedDelete({
                dispatchKey,
                text: editedText,
                hasMedia: Boolean(payload?.hasMedia),
                deleteMethod: 'DeleteAgentMessage',
                deleteBody: { messageId, recipient: cascadeId }
              });
              if (outcome.partialSuccess) {
                await respondPartialSendDeleteFailure({ messageId }, outcome.error);
                return;
              }
              if (outcome.ok) {
                rpcRes = outcome.rpcRes;
                deduplicatedRetry = Boolean(outcome.deduplicatedRetry);
              } else if (outcome.needsDomFallback || outcome.confirmedNotExecuted) {
                const okDom = await runQueuedDomFallback('send-queued-dom', false);
                if (!okDom) return;
              } else {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  outcomeUnknown: true,
                  error: remoteError('立即发送请求超时或结果未知，已阻止自动补发以避免重复发送，请核对后再试')
                }));
                return;
              }
            }
          } else if (isDomQueueSource) {
            const domAct = actionName === 'delete-queued-message'
              ? 'delete-queued-dom'
              : (actionName === 'edit-queued-message' ? 'edit-queued-dom' : 'send-queued-dom');
            const okDom = await runQueuedDomFallback(domAct, actionName === 'send-queued-messages' ? (payload?.sendAll !== false) : undefined);
            if (!okDom) return;
          } else if (actionName === 'delete-queued-message') {
            const rawStep = payload?.stepIndex;
            const isValidStep = (typeof rawStep === 'number' && Number.isInteger(rawStep) && rawStep >= 0)
              || (typeof rawStep === 'string' && /^\d+$/.test(rawStep.trim()));
            const stepIndex = isValidStep ? Number(rawStep) : -1;
            if (!isValidStep || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('缺少有效的排队标识 messageId 或 stepIndex') }));
              return;
            }
            const hasDelIdentityHint = Boolean(
              (typeof payload?.text === 'string' && payload.text.trim()) ||
              payload?.hasMedia === true ||
              String(payload?.mediaSig || '').trim()
            );
            if (hasDelIdentityHint) {
              const trajOutcome = await callLsRpcDetailed('GetCascadeTrajectory', { cascadeId, trajectoryVerbosity: 3 }, rpcTimeoutMs, { idempotent: true });
              const trajSteps = trajOutcome.ok ? trajOutcome.result?.trajectory?.steps : null;
              if (!trajOutcome.ok || !Array.isArray(trajSteps)) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  outcomeUnknown: true,
                  error: remoteError('无法验证目标排队步骤状态，已取消撤回以防误删')
                }));
                return;
              }
              const trajContainer = trajOutcome.result?.trajectory || trajOutcome.result;
              const qList = extractQueuedMessagesFromTrajectorySteps(trajSteps, trajContainer);
              const matchedQ = qList.find((q) => q && q.stepIndex === stepIndex) || null;
              const extraList = Array.isArray(trajContainer?.queuedSteps)
                ? trajContainer.queuedSteps
                : (Array.isArray(trajContainer?.queued_steps) ? trajContainer.queued_steps : []);
              const directExtraStep = extraList.find((qs) => qs && Number(qs.stepIndex ?? qs.step_index) === stepIndex) || null;
              const directQueuedStep = isQueuedTrajectoryUserStep(trajSteps[stepIndex]) ? trajSteps[stepIndex] : null;
              if (!matchedQ && !directQueuedStep && !directExtraStep) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  error: remoteError('目标步骤已不在排队中，已取消撤回')
                }));
                return;
              }
              const targetUi = directQueuedStep?.userInput || directExtraStep?.userInput || directExtraStep?.user_input || directExtraStep || null;
              const idCheck = verifyStepIndexTargetIdentity(targetUi, matchedQ, payload);
              if (!idCheck.ok) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  outcomeUnknown: true,
                  error: idCheck.error
                }));
                return;
              }
            }
            rpcRes = await callLsRpc('DeleteQueuedUserInputStep', { cascadeId, stepIndex }, rpcTimeoutMs);
            if (rpcRes !== null && rpcRes !== false) {
              dispatchedQueueDeletes.delete(`${cascadeId}::step:${stepIndex}`);
            }
          } else if (actionName === 'edit-queued-message') {
            const rawStep = payload?.stepIndex;
            const isValidStep = (typeof rawStep === 'number' && Number.isInteger(rawStep) && rawStep >= 0)
              || (typeof rawStep === 'string' && /^\d+$/.test(rawStep.trim()));
            const stepIndex = isValidStep ? Number(rawStep) : -1;
            if (!isValidStep || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('缺少有效的排队标识 messageId 或 stepIndex') }));
              return;
            }
            const dispatchKey = `${cascadeId}::step:${stepIndex}`;
            const trajOutcome = await callLsRpcDetailed('GetCascadeTrajectory', { cascadeId, trajectoryVerbosity: 3 }, rpcTimeoutMs, { idempotent: true });
            const trajSteps = trajOutcome.ok ? trajOutcome.result?.trajectory?.steps : null;
            if (!trajOutcome.ok || !Array.isArray(trajSteps)) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                error: remoteError('无法验证目标排队步骤状态，已取消编辑以防误删')
              }));
              return;
            }
            const trajContainer = trajOutcome.result?.trajectory || trajOutcome.result;
            const qList = extractQueuedMessagesFromTrajectorySteps(trajSteps, trajContainer);
            const matchedQ = qList.find((q) => q && q.stepIndex === stepIndex) || null;
            const extraList = Array.isArray(trajContainer?.queuedSteps)
              ? trajContainer.queuedSteps
              : (Array.isArray(trajContainer?.queued_steps) ? trajContainer.queued_steps : []);
            const directExtraStep = extraList.find((qs) => qs && Number(qs.stepIndex ?? qs.step_index) === stepIndex) || null;
            const directQueuedStep = isQueuedTrajectoryUserStep(trajSteps[stepIndex]) ? trajSteps[stepIndex] : null;
            if (!matchedQ && !directQueuedStep && !directExtraStep) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                error: remoteError('目标步骤已不在排队中，已取消编辑')
              }));
              return;
            }
            const targetStepObj = directQueuedStep || directExtraStep || null;
            const targetUi = directQueuedStep?.userInput || directExtraStep?.userInput || directExtraStep?.user_input || directExtraStep || null;
            const idCheck = verifyStepIndexTargetIdentity(targetUi, matchedQ, payload);
            if (!idCheck.ok) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                outcomeUnknown: true,
                error: idCheck.error
              }));
              return;
            }
            const baseEditText = targetUi ? formatTrajectoryUserInput(targetUi) : String(matchedQ?.text || editedText || '');
            const rawEntriesFromStep = extractRawMediaEntriesFromUserInput(targetUi);
            const itemHasMedia = Boolean(
              payload?.hasMedia ||
              matchedQ?.hasMedia ||
              (Array.isArray(matchedQ?.images) && matchedQ.images.length > 0) ||
              rawEntriesFromStep.length > 0 ||
              hasMediaMarkerText(baseEditText)
            );
            const targetStepFp = buildQueuedStepFingerprint(targetUi, baseEditText);
            const stableStepRecoveryKey = `${cascadeId}::stepfp:${targetStepFp}`;
            const preDeleteFps = collectQueuedStepFingerprints(trajSteps, trajContainer);
            const preDeleteSameFpCount = preDeleteFps.filter((x) => x.fp === targetStepFp).length;
            const editStepIdentityToken = extractQueuedStepIdentityToken(targetStepObj, targetUi);
            const editContinuityMeta = {
              originalStepIndex: stepIndex,
              preSameFpCount: Math.max(1, preDeleteSameFpCount),
              preTotalSteps: trajSteps.length,
              stepIdentityToken: editStepIdentityToken
            };
            const verifyStepStillQueued = async () => {
              const recheck = await callLsRpcDetailed('GetCascadeTrajectory', { cascadeId, trajectoryVerbosity: 3 }, rpcTimeoutMs, { idempotent: true });
              const recheckSteps = recheck.ok ? recheck.result?.trajectory?.steps : null;
              if (!recheck.ok || !Array.isArray(recheckSteps)) return null;
              const recheckContainer = recheck.result?.trajectory || recheck.result;
              const postDeleteFps = collectQueuedStepFingerprints(recheckSteps, recheckContainer);
              const matchingPost = postDeleteFps.filter((x) => x.fp === targetStepFp);
              if (matchingPost.length === 0) return false;
              const stillAtSameIndex = matchingPost.some((x) => x.stepIndex === stepIndex);
              if (stillAtSameIndex && matchingPost.length >= Math.max(1, preDeleteSameFpCount)) {
                return true;
              }
              // 仍有同内容排队项存在（例如前序步骤并发删除导致原项前移，或存在同文副本无法唯一定位）→ 无法确认已删，返回未知以保留文本/附件
              return null;
            };
            if (itemHasMedia) {
              const recovered = await restoreMediaAndDeleteQueued({
                rawUi: targetUi,
                fallbackText: baseEditText,
                deleteMethod: 'DeleteQueuedUserInputStep',
                deleteBody: { cascadeId, stepIndex },
                dispatchKey,
                sourceKey: stableStepRecoveryKey,
                pendingRetryMeta: editContinuityMeta,
                checkPendingCollision: (prevMeta) => hasStepIdentityContinuity(prevMeta, {
                  stepIndex,
                  sameFpCount: preDeleteSameFpCount,
                  totalSteps: trajSteps.length,
                  stepIdentityToken: editStepIdentityToken
                }),
                verifyOriginalStillQueued: verifyStepStillQueued
              });
              if (!recovered.ok) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(recovered.errorPayload));
                return;
              }
              rpcRes = recovered.rpcRes;
            } else {
              const recoveredText = await deleteQueuedTextForEdit({
                text: baseEditText || editedText,
                deleteMethod: 'DeleteQueuedUserInputStep',
                deleteBody: { cascadeId, stepIndex },
                dispatchKey,
                sourceKey: stableStepRecoveryKey,
                verifyOriginalStillQueued: verifyStepStillQueued
              });
              if (!recoveredText.ok) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(recoveredText.errorPayload));
                return;
              }
              rpcRes = recoveredText.rpcRes;
            }
          } else if (actionName === 'send-queued-messages' && payload?.sendAll === false) {
            const rawStep = payload?.stepIndex;
            const isValidStep = (typeof rawStep === 'number' && Number.isInteger(rawStep) && rawStep >= 0)
              || (typeof rawStep === 'string' && /^\d+$/.test(rawStep.trim()));
            const stepIndex = isValidStep ? Number(rawStep) : -1;
            if (!isValidStep || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('缺少有效的排队标识 messageId 或 stepIndex') }));
              return;
            }
            const reqTextNorm = stripDisplayMediaSuffixFromQueuedText(editedText, true).replace(/\s+/g, ' ').trim();
            let itemText = editedText.trim();
            let itemHasMedia = Boolean(payload?.hasMedia);
            let verifiedDomIdx = (payload?.domIndex !== undefined && payload?.domIndex !== null && payload?.domIndex !== '' && Number.isInteger(Number(payload.domIndex)))
              ? Number(payload.domIndex)
              : undefined;
            let expectedQueueCount = 0;
            // 无论首次发送还是部分成功重试，均先拉取最新轨迹核验目标步骤真实身份，防止索引被其他项占用误删或前移后重复发送
            const trajOutcome = await callLsRpcDetailed('GetCascadeTrajectory', { cascadeId, trajectoryVerbosity: 3 }, rpcTimeoutMs, { idempotent: true });
            const trajSteps = trajOutcome.ok ? trajOutcome.result?.trajectory?.steps : null;
            if (!trajOutcome.ok || !Array.isArray(trajSteps)) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                outcomeUnknown: true,
                error: remoteError('无法验证目标排队步骤状态，已取消操作以防误删或重复发送')
              }));
              return;
            }
            const trajContainer = trajOutcome.result?.trajectory || trajOutcome.result;
            const qList = extractQueuedMessagesFromTrajectorySteps(trajSteps, trajContainer);
            const qPos = qList.findIndex((q) => q && q.stepIndex === stepIndex);
            const matchedQ = qPos >= 0 ? qList[qPos] : null;
            const extraList = Array.isArray(trajContainer?.queuedSteps)
              ? trajContainer.queuedSteps
              : (Array.isArray(trajContainer?.queued_steps) ? trajContainer.queued_steps : []);
            const directExtraStep = extraList.find((qs) => qs && Number(qs.stepIndex ?? qs.step_index) === stepIndex) || null;
            const directQueuedStep = isQueuedTrajectoryUserStep(trajSteps[stepIndex]) ? trajSteps[stepIndex] : null;
            if (!matchedQ && !directQueuedStep && !directExtraStep) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                error: remoteError('目标步骤已不在排队中，已取消发送以防重复发送')
              }));
              return;
            }
            const targetUi = directQueuedStep?.userInput || directExtraStep?.userInput || directExtraStep?.user_input || directExtraStep || null;
            if (matchedQ) {
              const qText = String(matchedQ.text || '').trim();
              if (qText) itemText = qText;
              itemHasMedia = itemHasMedia || Boolean(matchedQ.hasMedia) || (Array.isArray(matchedQ.images) && matchedQ.images.length > 0);
              if (verifiedDomIdx === undefined && qPos >= 0) verifiedDomIdx = qPos;
              if (qPos >= 0) expectedQueueCount = qList.length;
            } else if (targetUi) {
              const dText = formatTrajectoryUserInput(targetUi);
              if (dText) itemText = dText;
              itemHasMedia = itemHasMedia || extractTrajectoryUserAttachments(targetUi).length > 0;
            }
            const sendIdCheck = verifyStepIndexTargetIdentity(targetUi, matchedQ, payload);
            if (!sendIdCheck.ok) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                outcomeUnknown: true,
                error: sendIdCheck.error
              }));
              return;
            }
            const targetStepObj = directQueuedStep || directExtraStep || null;
            const stepFp = buildQueuedStepFingerprint(targetUi, itemText);
            const liveFpsForSend = collectQueuedStepFingerprints(trajSteps, trajContainer);
            const liveSameFpCount = liveFpsForSend.filter((x) => x.fp === stepFp).length;
            const sendStepIdentityToken = extractQueuedStepIdentityToken(targetStepObj, targetUi);
            const dispatchKey = `${cascadeId}::stepfp:${stepFp}`;
            const existingDispatchedRec = getDispatchedQueueDelete(dispatchKey);
            if (existingDispatchedRec) {
              // 仅在具备原目标身份连续性证据时才允许仅重试删除；否则（多条同文、或原项已删新入队同内容 B 替换）一律停止删除防止误删未发送项
              const continuous = hasStepIdentityContinuity(existingDispatchedRec, {
                stepIndex,
                sameFpCount: liveSameFpCount,
                totalSteps: trajSteps.length,
                stepIdentityToken: sendStepIdentityToken
              });
              if (!continuous) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  outcomeUnknown: true,
                  error: remoteError('无法确认当前排队项与此前已发送待删项为同一消息（可能存在同内容新消息或并发变更），已停止操作以防误删或重复发送')
                }));
                return;
              }
            }
            if (!itemText && !itemHasMedia && !existingDispatchedRec) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('未找到指定排队步骤或内容为空') }));
              return;
            }
            const outcome = await sendSingleQueuedWithCheckedDelete({
              dispatchKey,
              text: itemText,
              hasMedia: itemHasMedia,
              deleteMethod: 'DeleteQueuedUserInputStep',
              deleteBody: { cascadeId, stepIndex },
              dispatchMeta: {
                originalStepIndex: stepIndex,
                preSameFpCount: Math.max(1, liveSameFpCount),
                preTotalSteps: trajSteps.length,
                stepIdentityToken: sendStepIdentityToken
              }
            });
            if (outcome.partialSuccess) {
              await respondPartialSendDeleteFailure({ stepIndex }, outcome.error);
              return;
            }
            if (outcome.ok) {
              rpcRes = outcome.rpcRes;
              deduplicatedRetry = Boolean(outcome.deduplicatedRetry);
            } else if (outcome.needsDomFallback || outcome.confirmedNotExecuted) {
              const coreText = stripMediaMarkerForMatch(itemText);
              if (verifiedDomIdx === undefined && !coreText) {
                sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                  ok: false,
                  error: remoteError('无法确认目标媒体排队项的桌面映射，已取消发送以防误发')
                }));
                return;
              }
              const okDom = await runQueuedDomFallback('send-queued-dom', false, {
                ...(verifiedDomIdx !== undefined ? { domIndex: verifiedDomIdx } : {}),
                ...(expectedQueueCount > 0 ? { expectedQueueCount } : {}),
                text: coreText || itemText
              });
              if (!okDom) return;
            } else {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                outcomeUnknown: true,
                error: remoteError('立即发送请求超时或结果未知，已阻止自动补发以避免重复发送，请核对后再试')
              }));
              return;
            }
          } else {
            // 全部立即发送：优先保留 SendAllQueuedMessages 契约；
            // 仅当服务端明确返回 confirmedNotExecuted（如 Antigravity 2.0 报 deprecated/unimplemented）且携带 agent_state messageIds 时，才允许回退桌面端全发；
            // 若返回 null/超时/未知错误，必须 fail-closed 严禁补发！
            const sendAllOutcome = await callLsRpcDetailed('SendAllQueuedMessages', { cascadeId }, rpcTimeoutMs);
            if (sendAllOutcome.ok) {
              rpcRes = sendAllOutcome.result;
            } else if (sendAllOutcome.confirmedNotExecuted && messageIds.length > 0) {
              const okDom = await runQueuedDomFallback('send-queued-dom', true);
              if (!okDom) return;
            } else {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                ...(sendAllOutcome.confirmedNotExecuted ? {} : { outcomeUnknown: true }),
                error: sendAllOutcome.confirmedNotExecuted
                  ? (sendAllOutcome.error || remoteError('本机 LanguageServer 队列操作失败'))
                  : remoteError('本机 LanguageServer 队列操作调用超时或结果未知，已阻止自动补发以避免重复发送')
              }));
              return;
            }
          }
          if (!usedDomFallback && (rpcRes === null || rpcRes === false)) {
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('电脑端后台队列服务暂时无响应或超时，请稍后重试') }));
            return;
          }
          historyManager.invalidateSession?.(cascadeId);
          const snap = await fetchSnapshot(effectiveTargetId, {
            conversationId: cascadeId,
            clientId,
            convLimit: 100,
            msgLimit: 30,
            bypassCache: true,
            bypassCatalogCache: true
          });
          const usageSummary = (snap && snap.ok !== false && !snap.usageSummary) ? await getCachedUsageSummary() : null;
          const enriched = enrichSnapshotPayload(snap, config, activeTunnelUrl, clientId, usageSummary);
          const hasRemainingDomQueued = Boolean(
            actionName === 'send-queued-messages' &&
            payload?.hasDomQueued === true &&
            !usedDomFallback &&
            Array.isArray(snap?.queuedMessages) &&
            snap.queuedMessages.some((q) => q && q.source === 'dom')
          );
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
            ok: true,
            actionResult: {
              ok: true,
              action: actionName,
              cascadeId,
              ...(deduplicatedRetry ? { deduplicatedRetry: true } : {}),
              ...(actionName === 'edit-queued-message' && recoveryKey ? { recoveryKey } : {}),
              ...(actionName === 'edit-queued-message' ? { editedText } : {}),
              ...(actionName === 'edit-queued-message' && editedAttachments.length ? { editedAttachments } : {}),
              ...(hasRemainingDomQueued ? { hasRemainingDomQueued: true } : {})
            },
            snapshot: enriched
          }));
          return;
        }

        const bumpNavEpoch = (sess) => {
          if (sess) sess.navEpoch = (sess.navEpoch || 0) + 1;
        };
        const clearDraftNew = (sess) => {
          if (!sess) return;
          sess.draftNewIsolated = false;
          sess.draftSendPending = false;
          sess.draftSendPendingAt = 0;
          sess.draftSendInflight = false;
          sess.draftProjectId = '';
          sess.draftProjectName = '';
          sess.draftPendingUploads = [];
        };
        const buildIsolatedDraftSnapshot = (baseSnap, draftPid, draftName) => {
          if (!baseSnap || baseSnap.ok === false) return baseSnap;
          const matchedProj = draftPid
            ? ((Array.isArray(baseSnap.projects) ? baseSnap.projects : []).find((p) => p && String(p.id || '') === draftPid)
              || (Array.isArray(baseSnap.projectGroups) ? baseSnap.projectGroups : []).find((g) => g && String(g.id || '') === draftPid))
            : null;
          return {
            ...baseSnap,
            isolated: true,
            isNewConversation: true,
            sessionId: '__new__',
            activeConversationId: '',
            title: '新对话',
            currentProjectId: draftPid || baseSnap.currentProjectId || '',
            currentProjectName: String(draftName || matchedProj?.name || baseSnap.currentProjectName || '').trim(),
            messages: [],
            totalMessages: 0,
            hasEarlierMessages: false,
            pendingApprovals: [],
            pendingPrompts: [],
            queuedMessages: [],
            busy: false
          };
        };

        if (actionName === 'switch-conversation' && (clientId || payload?.isolated === true)) {
          const nextId = String(payload?.id || '').trim();
          if (!nextId) {
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({ ok: false, error: remoteError('缺少会话 ID') }));
            return;
          }
          if (nextId === 'follow-desktop') {
            if (session) {
              session.conversationId = '';
              clearDraftNew(session);
              bumpNavEpoch(session);
            }
            const snap = await fetchSnapshot(effectiveTargetId, { clientId, convLimit: 100, msgLimit: 30 });
            if (session && snap && snap.ok !== false && (snap.activeConversationId || snap.sessionId)) {
              session.conversationId = String(snap.activeConversationId || snap.sessionId || '');
            }
            const usageSummary = (snap && snap.ok !== false && !snap.usageSummary) ? await getCachedUsageSummary() : null;
            const enriched = enrichSnapshotPayload(snap, config, activeTunnelUrl, clientId, usageSummary);
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: Boolean(snap && snap.ok !== false),
              actionResult: { ok: Boolean(snap && snap.ok !== false), id: enriched?.sessionId || '', isolated: false },
              snapshot: enriched
            }));
            return;
          }
          if (nextId !== 'new') {
            if (session) {
              session.conversationId = nextId;
              clearDraftNew(session);
              bumpNavEpoch(session);
              if (payload?.targetId) session.targetId = effectiveTargetId;
            }
            const activeCatStore = options.catalogStore || defaultCatalogStore;
            activeCatStore.markViewed(nextId, Date.now(), options.catalogOptions || {});
            if (!options.fetchSnapshot && typeof historyManager?.warmSession === 'function') {
              historyManager.warmSession(nextId).catch(() => null);
            }
            const snap = await fetchSnapshot(effectiveTargetId, {
              conversationId: nextId,
              clientId,
              convLimit: 100,
              msgLimit: 30,
              bypassCatalogCache: true
            });
            const usageSummary = (snap && snap.ok !== false && !snap.usageSummary) ? await getCachedUsageSummary() : null;
            const enriched = enrichSnapshotPayload(snap, config, activeTunnelUrl, clientId, usageSummary);
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: Boolean(snap && snap.ok !== false),
              actionResult: { ok: Boolean(snap && snap.ok !== false), id: nextId, isolated: true },
              snapshot: enriched
            }));
            return;
          }
          if (payload?.isolated === true) {
            const draftPid = String(payload?.projectId || '').trim();
            const draftName = String(payload?.projectName || '').trim();
            if (session) {
              session.conversationId = '__new__';
              session.draftNewIsolated = true;
              session.draftSendPending = false;
              session.draftSendPendingAt = 0;
              session.draftSendInflight = false;
              session.draftProjectId = draftPid;
              session.draftProjectName = draftName;
              session.draftPendingUploads = [];
              bumpNavEpoch(session);
              if (payload?.targetId) session.targetId = effectiveTargetId;
            }
            const baseSnap = await fetchSnapshot(effectiveTargetId, {
              conversationId: '__new__',
              clientId,
              convLimit: 100,
              msgLimit: 0
            });
            const draftSnap = buildIsolatedDraftSnapshot(baseSnap, draftPid, draftName);
            const usageSummary = (draftSnap && draftSnap.ok !== false && !draftSnap.usageSummary) ? await getCachedUsageSummary() : null;
            const enriched = enrichSnapshotPayload(draftSnap, config, activeTunnelUrl, clientId, usageSummary);
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: Boolean(draftSnap && draftSnap.ok !== false),
              actionResult: { ok: Boolean(draftSnap && draftSnap.ok !== false), id: '__new__', projectId: draftPid, isolated: true, deferred: true },
              snapshot: enriched
            }));
            return;
          }
          clearDraftNew(session);
          const newResult = await performAction({
            ...payload,
            clientId,
            targetId: effectiveTargetId || undefined,
            conversationId: '',
            restoreDesktop: false
          });
          if (session) {
            session.conversationId = String(newResult?.snapshot?.activeConversationId || newResult?.snapshot?.sessionId || '__new__');
          }
          if (newResult?.snapshot) {
            const usageSummary = !newResult.snapshot.usageSummary ? await getCachedUsageSummary() : null;
            newResult.snapshot = enrichSnapshotPayload(newResult.snapshot, config, activeTunnelUrl, clientId, usageSummary);
          }
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(newResult));
          return;
        }

        if (actionName === 'new-conversation') {
          if (payload?.isolated === true) {
            const draftPid = String(payload?.projectId || '').trim();
            const draftName = String(payload?.projectName || '').trim();
            if (session) {
              session.conversationId = '__new__';
              session.draftNewIsolated = true;
              session.draftSendPending = false;
              session.draftSendPendingAt = 0;
              session.draftSendInflight = false;
              session.draftProjectId = draftPid;
              session.draftProjectName = draftName;
              session.draftPendingUploads = [];
              bumpNavEpoch(session);
              if (payload?.targetId) session.targetId = effectiveTargetId;
            }
            const baseSnap = await fetchSnapshot(effectiveTargetId, {
              conversationId: '__new__',
              clientId,
              convLimit: 100,
              msgLimit: 0
            });
            const draftSnap = buildIsolatedDraftSnapshot(baseSnap, draftPid, draftName);
            const usageSummary = (draftSnap && draftSnap.ok !== false && !draftSnap.usageSummary) ? await getCachedUsageSummary() : null;
            const enriched = enrichSnapshotPayload(draftSnap, config, activeTunnelUrl, clientId, usageSummary);
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: Boolean(draftSnap && draftSnap.ok !== false),
              actionResult: { ok: Boolean(draftSnap && draftSnap.ok !== false), id: '__new__', projectId: draftPid, isolated: true, deferred: true },
              snapshot: enriched
            }));
            return;
          }
          clearDraftNew(session);
          const newResult = await performAction({
            ...payload,
            clientId,
            targetId: effectiveTargetId || undefined,
            conversationId: '',
            restoreDesktop: false
          });
          if (session && newResult?.ok !== false) {
            session.conversationId = String(newResult?.snapshot?.activeConversationId || newResult?.snapshot?.sessionId || '__new__');
            if (newResult?.snapshot?.currentTargetId) session.targetId = newResult.snapshot.currentTargetId;
          }
          if (newResult?.snapshot) {
            const usageSummary = !newResult.snapshot.usageSummary ? await getCachedUsageSummary() : null;
            newResult.snapshot = enrichSnapshotPayload(newResult.snapshot, config, activeTunnelUrl, clientId, usageSummary);
          }
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(newResult));
          return;
        }

        if (actionName === 'switch-window') {
          const nextTargetId = String(payload?.targetId || '').trim();
          if (session) {
            session.targetId = nextTargetId;
            session.conversationId = '';
            clearDraftNew(session);
            bumpNavEpoch(session);
          }
          const snap = await fetchSnapshot(nextTargetId, { clientId, convLimit: 100, msgLimit: 30 });
          if (session && snap && snap.ok !== false && (snap.activeConversationId || snap.sessionId)) {
            session.conversationId = String(snap.activeConversationId || snap.sessionId || '');
          }
          const usageSummary = (snap && snap.ok !== false && !snap.usageSummary) ? await getCachedUsageSummary() : null;
          const enriched = enrichSnapshotPayload(snap, config, activeTunnelUrl, clientId, usageSummary);
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
            ok: Boolean(snap && snap.ok !== false),
            actionResult: { ok: Boolean(snap && snap.ok !== false), targetId: enriched?.currentTargetId || nextTargetId },
            snapshot: enriched
          }));
          return;
        }

        const effectiveConvId = String(payload?.conversationId || session?.conversationId || '').trim();
        const isIsolatedDraftMediaAction = Boolean(
          (actionName === 'upload-image' || actionName === 'remove-uploaded-attachment') &&
          session?.draftNewIsolated &&
          (!effectiveConvId || effectiveConvId === '__new__' || effectiveConvId === 'new')
        );
        if (isIsolatedDraftMediaAction) {
          if (!Array.isArray(session.draftPendingUploads)) {
            session.draftPendingUploads = [];
          }
          if (actionName === 'upload-image') {
            const rawB64 = String(payload?.base64 || '').trim();
            if (!rawB64) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                error: remoteError('缺少附件数据')
              }));
              return;
            }
            if (session.draftPendingUploads.length >= 10) {
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: false,
                error: remoteError('草稿最多可附带 10 个待发附件')
              }));
              return;
            }
            const attName = String(payload?.name || `draft-${Date.now()}`).trim();
            const attMime = String(payload?.mimeType || 'application/octet-stream').trim();
            session.draftPendingUploads.push({
              name: attName,
              mimeType: attMime,
              base64: rawB64
            });
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: true,
              deferredDraftUpload: true,
              actionResult: {
                ok: true,
                deferred: true,
                name: attName,
                pendingCount: session.draftPendingUploads.length
              }
            }));
            return;
          }
          if (payload?.clearAll === true) {
            const removed = session.draftPendingUploads.length;
            session.draftPendingUploads = [];
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: true,
              deferredDraftUpload: true,
              actionResult: { ok: true, deferred: true, removed }
            }));
            return;
          }
          const reqName = String(payload?.name || '').trim().toLowerCase();
          const reqIdx = Number.isInteger(payload?.index) ? payload.index : -1;
          let rmIdx = -1;
          if (reqName) {
            if (reqIdx >= 0 && reqIdx < session.draftPendingUploads.length && String(session.draftPendingUploads[reqIdx]?.name || '').trim().toLowerCase() === reqName) {
              rmIdx = reqIdx;
            } else {
              rmIdx = session.draftPendingUploads.findIndex((x) => String(x?.name || '').trim().toLowerCase() === reqName);
            }
          } else if (reqIdx >= 0 && reqIdx < session.draftPendingUploads.length) {
            rmIdx = reqIdx;
          }
          if (rmIdx < 0) {
            sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
              ok: false,
              error: remoteError('草稿中未找到指定附件')
            }));
            return;
          }
          session.draftPendingUploads.splice(rmIdx, 1);
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
            ok: true,
            deferredDraftUpload: true,
            actionResult: { ok: true, deferred: true, removed: 1, pendingCount: session.draftPendingUploads.length }
          }));
          return;
        }
        const existingConvStageKey = (effectiveConvId && effectiveConvId !== '__new__' && effectiveConvId !== 'new')
          ? makeStagedUploadKey(clientId, effectiveConvId)
          : '';
        if (actionName === 'remove-uploaded-attachment' && existingConvStageKey) {
          const stagedList = getStagedEditUploads(existingConvStageKey);
          if (stagedList.length > 0) {
            const removedStaged = removeStagedEditUpload(existingConvStageKey, {
              clearAll: payload?.clearAll === true,
              name: payload?.name,
              index: payload?.index
            });
            if (removedStaged > 0) {
              if (payload?.clearAll === true) {
                await performAction({
                  ...payload,
                  clientId,
                  targetId: effectiveTargetId || undefined,
                  conversationId: effectiveConvId
                }).catch(() => null);
              }
              sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
                ok: true,
                actionResult: { ok: true, staged: true, removed: removedStaged }
              }));
              return;
            }
          }
        }
        const isDeferredDraftSend = Boolean(
          actionName === 'send' &&
          (session?.draftNewIsolated || payload?.draftNewIsolated === true) &&
          (!effectiveConvId || effectiveConvId === '__new__' || effectiveConvId === 'new')
        );
        if (
          isDeferredDraftSend &&
          session?.draftSendPending &&
          !session.draftSendInflight &&
          Number(session.draftSendPendingAt) > 0 &&
          (Date.now() - Number(session.draftSendPendingAt)) >= 15000
        ) {
          session.draftSendPending = false;
          session.draftSendPendingAt = 0;
        }
        if (isDeferredDraftSend && (session?.draftSendInflight || session?.draftSendPending)) {
          sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse({
            ok: false,
            pendingConfirmation: true,
            error: remoteError('首条消息正在发送或等待新会话 ID 确认，请稍候或切换会话后再试，避免重复发送')
          }));
          return;
        }
        const draftPidForSend = isDeferredDraftSend
          ? String(session?.draftProjectId || payload?.draftProjectId || payload?.projectId || '').trim()
          : '';
        const draftUploadsForSend = (isDeferredDraftSend && Array.isArray(session?.draftPendingUploads) && session.draftPendingUploads.length)
          ? session.draftPendingUploads.slice()
          : [];
        const stagedUploadsForSend = (!isDeferredDraftSend && actionName === 'send' && existingConvStageKey)
          ? getStagedEditUploads(existingConvStageKey)
          : [];
        const sendStartNavEpoch = session ? (session.navEpoch || 0) : 0;
        const sendStartTargetId = session ? String(session.targetId || effectiveTargetId || '') : effectiveTargetId;
        const sendStartConvId = session ? String(session.conversationId || '') : effectiveConvId;
        const isStillSameNav = () => !session || (
          (session.navEpoch || 0) === sendStartNavEpoch &&
          String(session.targetId || effectiveTargetId || '') === sendStartTargetId &&
          String(session.conversationId || '') === sendStartConvId &&
          Boolean(session.draftNewIsolated)
        );
        if (isDeferredDraftSend && session) {
          session.draftSendInflight = true;
        }
        let result;
        try {
          result = await performAction({
            ...payload,
            clientId,
            targetId: effectiveTargetId || undefined,
            conversationId: isDeferredDraftSend ? '__new__' : (effectiveConvId || undefined),
            ...(isDeferredDraftSend ? {
              draftNewIsolated: true,
              draftProjectId: draftPidForSend,
              restoreDesktop: payload?.restoreDesktop !== false,
              ...(draftUploadsForSend.length ? { draftPendingUploads: draftUploadsForSend } : {})
            } : (stagedUploadsForSend.length ? {
              pendingUploads: stagedUploadsForSend.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 }))
            } : {}))
          });
          if (actionName === 'send' && result?.ok !== false) {
            if (existingConvStageKey && stagedUploadsForSend.length) {
              consumeStagedEditUploads(
                existingConvStageKey,
                stagedUploadsForSend.map((x) => x?._stagingId).filter(Boolean)
              );
            }
            const sentSid = String(
              result?.snapshot?.activeConversationId ||
              result?.snapshot?.sessionId ||
              result?.actionResult?.createdConversationId ||
              effectiveConvId ||
              ''
            ).trim();
            if (sentSid && sentSid !== '__new__' && sentSid !== 'new') {
              historyManager.invalidateSession?.(sentSid);
            }
          }
          if (isDeferredDraftSend) {
            if (result?.ok === false) {
              if (!isStillSameNav()) {
                result.snapshot = null;
                result.staleNavigation = true;
              } else if (result.snapshot && result.snapshot.sessionId && result.snapshot.sessionId !== '__new__') {
                result.snapshot = null;
              }
            } else {
              const createdCid = String(result?.actionResult?.createdConversationId || '').trim();
              if (!isStillSameNav()) {
                // 发送期间用户已切换会话/窗口/草稿：丢弃旧快照防止覆盖前端当前视图
                result.snapshot = null;
                result.staleNavigation = true;
              } else if (createdCid && createdCid !== '__new__') {
                let boundSnap = (result?.snapshot && result.snapshot.ok !== false && result.snapshot.sessionId === createdCid)
                  ? result.snapshot
                  : null;
                if (!boundSnap) {
                  const fetchedSnap = await fetchSnapshot(effectiveTargetId, {
                    conversationId: createdCid,
                    clientId,
                    convLimit: 100,
                    msgLimit: 30,
                    bypassCache: true,
                    bypassCatalogCache: true
                  }).catch(() => null);
                  if (fetchedSnap && fetchedSnap.ok !== false && fetchedSnap.sessionId === createdCid) {
                    boundSnap = fetchedSnap;
                  }
                }
                if (!isStillSameNav()) {
                  // 补拉快照期间用户切走：不改写 session，且清空 snapshot 防止覆盖
                  result.snapshot = null;
                  result.staleNavigation = true;
                } else {
                  clearDraftNew(session);
                  if (session) session.conversationId = createdCid;
                  // 若补拉快照失败则置空 snapshot，严禁把桌面原会话 snapshot 返回给前端
                  result.snapshot = boundSnap || null;
                }
              } else {
                // 路由尚未确认新会话 ID：禁止清除草稿或回退绑定桌面旧会话，标记待确认以防重试重复发送
                if (session) {
                  session.draftPendingUploads = [];
                  session.draftSendPending = true;
                  session.draftSendPendingAt = Date.now();
                }
                if (result.actionResult && typeof result.actionResult === 'object') {
                  result.actionResult.pendingConfirmation = true;
                }
                result.snapshot = session
                  ? buildIsolatedDraftSnapshot(
                      result.snapshot || { ok: true, projects: [], conversations: [] },
                      draftPidForSend,
                      session.draftProjectName || ''
                    )
                  : null;
              }
            }
          } else if (session && result?.snapshot && result.snapshot.ok !== false) {
            const respSid = String(result.snapshot.activeConversationId || result.snapshot.sessionId || '');
            if (respSid && respSid !== '__new__' && (effectiveConvId === '__new__' || !session.conversationId) && !session.draftNewIsolated) {
              session.conversationId = respSid;
            }
          }
        } finally {
          if (isDeferredDraftSend && session && (session.navEpoch || 0) === sendStartNavEpoch) {
            session.draftSendInflight = false;
          }
        }
        if (result?.snapshot) {
          const usageSummary = !result.snapshot.usageSummary ? await getCachedUsageSummary() : null;
          result.snapshot = enrichSnapshotPayload(result.snapshot, config, activeTunnelUrl, clientId, usageSummary);
        }
        sendPayload(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, serializeResponse(result));
      } catch (err) {
        const errHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
        if (err?.status === 413) errHeaders.Connection = 'close';
        res.writeHead(err?.status || 500, errHeaders);
        res.end(serializeResponse({ ok: false, error: err?.message || remoteError('操作失败') }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  };
  httpHandler.pollPushState = refreshPushStateFromCatalog;
  httpHandler.startPushWatcher = startPushWatcher;
  httpHandler.stopPushWatcher = stopPushWatcher;
  httpHandler.webPushManager = webPushManager;
  return httpHandler;
}

function startMobileRemoteServer() {
  reapStaleCloudflaredPid();
  const config = loadOrCreateRemoteConfig();
  const tunnelCtrl = createCloudflareTunnelController(() => config.port);
  const handler = createRemoteHttpHandler(config, {
    getTunnelOrigin: () => tunnelCtrl.getStatus().publicUrl || '',
    mediaOptions: {
      strictProdRoots: true,
      getAllowedRoots: () => resolveProductionMediaAllowedRoots()
    }
  });
  const boundServers = new Map();
  let ifaceTimer = null;
  let stopped = false;
  let managedTailscaleServePort = 0;

  const tryBindAddress = (ip) => {
    if (stopped || boundServers.has(ip)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const srv = http.createServer(handler);
      srv.once('error', () => {
        try { srv.close(); } catch {}
        resolve(false);
      });
      srv.listen(config.port, ip, () => {
        boundServers.set(ip, srv);
        resolve(true);
      });
    });
  };

  const tryBindDualStackWildcard = () => {
    if (stopped || boundServers.has('::')) return Promise.resolve(false);
    return new Promise((resolve) => {
      const srv = http.createServer(handler);
      srv.once('error', () => {
        try { srv.close(); } catch {}
        resolve(false);
      });
      srv.listen({ port: config.port, host: '::', ipv6Only: false }, () => {
        boundServers.set('::', srv);
        resolve(true);
      });
    });
  };

  const syncBindings = async () => {
    if (boundServers.has('::')) return;
    const { bindIps } = enumerateLocalAddresses();
    for (const ip of bindIps) {
      await tryBindAddress(ip);
    }
  };

  void tryBindDualStackWildcard().then(async (ok) => {
    if (stopped) return;
    if (ok) {
      const activeIps = enumerateLocalAddresses().bindIps;
      console.log(`Mobile Remote PWA ready on dual-stack [::]:${config.port} (${activeIps.join(', ')})`);
    } else {
      ifaceTimer = setInterval(() => {
        if (!stopped) void syncBindings();
      }, 15000);
      ifaceTimer.unref?.();
      await syncBindings();
      const activeIps = Array.from(boundServers.keys());
      if (activeIps.length) {
        console.log(`Mobile Remote PWA ready on port ${config.port} (${activeIps.join(', ')})`);
      }
    }
    const latestCfg = loadOrCreateRemoteConfig();
    if (!stopped && latestCfg.enabledChannels?.tailscale !== false && process.env.AG_REMOTE_SKIP_PROBES !== '1') {
      try {
        const tsServeRes = ensureTailscaleServeHttps(config.port);
        if (tsServeRes?.createdByUs) managedTailscaleServePort = config.port;
      } catch {}
    }
    if (!stopped && latestCfg.tunnelEnabled) {
      void tunnelCtrl.start(latestCfg);
    }
    if (!stopped && process.env.AG_REMOTE_SKIP_PROBES !== '1') {
      handler.startPushWatcher(6000);
    }
  });

  const stop = async () => {
    stopped = true;
    handler.stopPushWatcher();
    if (ifaceTimer) clearInterval(ifaceTimer);
    for (const srv of boundServers.values()) {
      try { srv.close(); } catch {}
    }
    boundServers.clear();
    if (managedTailscaleServePort > 0) {
      const cleanupPort = managedTailscaleServePort;
      managedTailscaleServePort = 0;
      try { cleanupTailscaleServeHttps(cleanupPort); } catch {}
    }
    await tunnelCtrl.stop();
  };

  process.once('exit', () => {
    try { void tunnelCtrl.stop(); } catch {}
  });

  return {
    config,
    getBoundAddresses: () => (boundServers.has('::') ? enumerateLocalAddresses().bindIps : Array.from(boundServers.keys())),
    getTunnelStatus: () => tunnelCtrl.getStatus(),
    ensureTunnelRunning: () => tunnelCtrl.ensureRunning(),
    configureTunnel: (patch) => tunnelCtrl.configure(patch),
    stop
  };
}

function collectFusedEndpointDescriptor(port, tunnelStatus = null, enabledChannels = null, options = {}) {
  const { tailscale, lan, physicalLan } = options.addresses || enumerateLocalAddresses();
  const meta = options.hostMeta || detectHostIdentityMeta(options.execFileSync ? { execFileSync: options.execFileSync } : {});
  const primaryLan = physicalLan[0] || lan[0] || null;
  const secondaryLan = physicalLan[1] || null;
  const en = {
    lan: enabledChannels?.lan !== false,
    tailscale: enabledChannels?.tailscale !== false,
    bonjour: enabledChannels?.bonjour !== false,
    tunnel: enabledChannels?.tunnel !== false
  };

  let tsHttpsUrl = '';
  let tsHttpsHint = '';
  if (en.tailscale && meta.tailscaleDnsName && meta.tailscaleRunning !== false) {
    const tsServe = options.tailscaleServe || ensureTailscaleServeHttps(port, {
      hostMeta: meta,
      execFileSync: options.execFileSync,
      readOnly: options.readOnly === true
    });
    if (tsServe?.enabled && tsServe?.url) tsHttpsUrl = tsServe.url;
    if (tsServe?.hint) tsHttpsHint = tsServe.hint;
  }

  const customTsHost = normalizeTailscaleCustomHost(options.tailscaleCustomHost || '');
  const effectiveTailscale = [...tailscale];
  if (
    en.tailscale
    && customTsHost
    && !effectiveTailscale.some((x) => String(x?.address || '').toLowerCase() === customTsHost)
    && (!tsHttpsUrl || String(meta.tailscaleDnsName || '').toLowerCase() !== customTsHost)
  ) {
    effectiveTailscale.push({ iface: 'custom', address: customTsHost, kind: 'tailscale', custom: true });
  }

  const endpoints = [];
  const seenHosts = new Set();
  const addEp = (host, kind, priority, iface = '') => {
    const cleanHost = String(host || '').trim();
    if (!cleanHost || seenHosts.has(cleanHost) || endpoints.length >= 6) return;
    seenHosts.add(cleanHost);
    endpoints.push({
      url: `http://${formatHostForUrl(cleanHost)}:${port}`,
      host: cleanHost,
      kind,
      priority,
      iface
    });
  };

  if (en.lan && primaryLan) addEp(primaryLan.address, 'lan', 0, primaryLan.iface);
  if (en.lan && secondaryLan) addEp(secondaryLan.address, 'lan', 50, secondaryLan.iface);
  if (en.tailscale && tsHttpsUrl) {
    const tsHttpsHost = meta.tailscaleDnsName;
    seenHosts.add(`https://${tsHttpsHost}`);
    endpoints.push({
      url: tsHttpsUrl,
      host: tsHttpsHost,
      kind: 'tailscale',
      priority: 90,
      iface: effectiveTailscale[0]?.iface || 'utun0'
    });
  }
  if (en.tailscale && effectiveTailscale[0]) addEp(effectiveTailscale[0].address, 'tailscale', 100, effectiveTailscale[0].iface);
  if (en.tailscale && customTsHost) addEp(customTsHost, 'tailscale', 105, 'custom');
  if (en.tailscale && !tsHttpsUrl && tailscale.length > 0 && meta.tailscaleDnsName) {
    addEp(meta.tailscaleDnsName, 'tailscale', 150, tailscale[0]?.iface || 'utun0');
  }
  if (en.bonjour && meta.bonjourHost && primaryLan) {
    addEp(meta.bonjourHost, 'bonjour', 200, primaryLan.iface);
  }
  const tunnelUrl = String(tunnelStatus?.publicUrl || '').trim().replace(/\/+$/, '');
  if (en.tunnel && tunnelStatus?.enabled && tunnelStatus?.state === 'running' && /^https:\/\//i.test(tunnelUrl)) {
    try {
      const tu = new URL(tunnelUrl);
      if (!seenHosts.has(tu.host)) {
        seenHosts.add(tu.host);
        endpoints.push({
          url: tunnelUrl,
          host: tu.host,
          kind: 'tunnel',
          priority: 250,
          iface: 'cloudflare'
        });
      }
    } catch {}
  }
  const anyEnabled = en.lan || en.tailscale || en.bonjour || en.tunnel;
  if (endpoints.length === 0 && anyEnabled) {
    addEp('127.0.0.1', 'loopback', 900, 'lo0');
  }

  return {
    tailscale: effectiveTailscale,
    lan,
    primaryLan,
    deviceName: meta.deviceName,
    bonjourHost: meta.bonjourHost,
    tailscaleDnsName: meta.tailscaleDnsName,
    tailscaleCustomHost: customTsHost,
    tailscaleHttpsUrl: tsHttpsUrl,
    tailscaleHttpsHint: tsHttpsHint,
    hosts: endpoints.map((ep) => ep.host),
    endpoints: endpoints.map(({ url, kind, priority }) => ({ url, kind, priority }))
  };
}

function buildRemoteInfo({ resetToken = false, tunnelStatus = null } = {}) {
  const cfg = loadOrCreateRemoteConfig({ resetToken });
  if (resetToken) {
    pairedDevicesMap.clear();
    remoteClientSessions.clear();
    trackedDeviceToken = cfg.token;
  }
  const devSummary = getPairedDevicesSummary(cfg.token);
  const persisted = readPersistedTunnelStatus();
  const effTunnel = (tunnelStatus && typeof tunnelStatus === 'object')
    ? {
        enabled: tunnelStatus.enabled !== undefined ? Boolean(tunnelStatus.enabled) : Boolean(cfg.tunnelEnabled),
        mode: tunnelStatus.mode || cfg.tunnelMode,
        state: tunnelStatus.state || (cfg.tunnelEnabled ? persisted.state : 'stopped'),
        pid: tunnelStatus.pid || persisted.pid || null,
        publicUrl: (tunnelStatus.publicUrl || (cfg.tunnelEnabled ? persisted.publicUrl : '') || '').replace(/\/+$/, ''),
        error: tunnelStatus.error || '',
        binaryAvailable: tunnelStatus.binaryAvailable !== undefined ? Boolean(tunnelStatus.binaryAvailable) : Boolean(resolveCloudflaredBinary())
      }
    : persisted;

  const desc = collectFusedEndpointDescriptor(cfg.port, effTunnel, cfg.enabledChannels, {
    readOnly: true,
    tailscaleCustomHost: cfg.tailscaleCustomHost
  });

  const mkFused = (entryHost, entryBaseUrl = '') => buildFusedPairingUrl({
    entryBaseUrl,
    entryHost,
    port: cfg.port,
    token: cfg.token,
    name: desc.deviceName,
    hosts: desc.hosts,
    endpoints: desc.endpoints
  });

  const tsEntryHost = desc.tailscale[0]?.address || desc.tailscaleDnsName || desc.tailscaleCustomHost || '';
  const tsDisplayHost = (desc.tailscale.length > 0 && desc.tailscaleDnsName)
    ? desc.tailscaleDnsName
    : (desc.tailscale[0]?.address || desc.tailscaleCustomHost || '');
  const lanEntryHost = desc.primaryLan?.address || '';
  const bonjourEntryHost = (desc.bonjourHost && desc.primaryLan) ? desc.bonjourHost : '';

  const tunnelActiveUrl = (effTunnel.enabled && effTunnel.state === 'running' && /^https:\/\//i.test(effTunnel.publicUrl))
    ? effTunnel.publicUrl
    : '';
  let tunnelHostDisplay = '';
  if (tunnelActiveUrl) {
    try { tunnelHostDisplay = new URL(tunnelActiveUrl).host; } catch {}
  }

  const enCh = cfg.enabledChannels || { lan: true, tailscale: true, bonjour: true, tunnel: Boolean(cfg.tunnelEnabled) };
  const cloudflaredInstall = getCloudflaredInstallGuide();
  const tunnelChannel = {
    key: 'tunnel',
    label: 'Cloudflare 隧道',
    labelEn: 'Cloudflare Tunnel',
    enabled: Boolean(enCh.tunnel),
    detected: Boolean(effTunnel.binaryAvailable),
    available: Boolean(enCh.tunnel && tunnelActiveUrl),
    state: effTunnel.state || 'stopped',
    mode: cfg.tunnelMode || 'quick',
    binaryAvailable: Boolean(effTunnel.binaryAvailable),
    installCommand: cloudflaredInstall.command,
    hasTunnelToken: Boolean(cfg.tunnelToken),
    tunnelHostname: cfg.tunnelHostname || '',
    error: effTunnel.error || '',
    rawHost: tunnelHostDisplay,
    displayHost: !enCh.tunnel
      ? '已停用'
      : (tunnelHostDisplay
          ? (cfg.tunnelMode === 'named' ? tunnelHostDisplay : `随时随地 · ${tunnelHostDisplay}`)
          : (effTunnel.state === 'starting'
              ? '正在分配公网隧道…'
              : (effTunnel.error || '未就绪'))),
    entryHost: tunnelHostDisplay,
    entryBaseUrl: tunnelActiveUrl,
    iface: 'cloudflare'
  };

  const mkQrSafe = (entryHost, entryBaseUrl = '') => {
    const full = mkFused(entryHost, entryBaseUrl);
    try {
      return { url: full, qrSvg: renderQrSvg(full) };
    } catch {
      const compactEps = (desc.endpoints || []).filter((e) => e.kind === 'tunnel' || e.priority === 0 || e.priority === 90 || e.priority === 100);
      const compact = buildFusedPairingUrl({
        entryBaseUrl,
        entryHost,
        port: cfg.port,
        token: cfg.token,
        name: desc.deviceName,
        hosts: [],
        endpoints: compactEps
      });
      try {
        return { url: compact, qrSvg: renderQrSvg(compact) };
      } catch {
        const bare = entryBaseUrl
          ? `${entryBaseUrl.replace(/\/+$/, '')}/?token=${encodeURIComponent(cfg.token)}`
          : `http://${formatHostForUrl(entryHost)}:${cfg.port}/?token=${encodeURIComponent(cfg.token)}`;
        return { url: bare, qrSvg: renderQrSvg(bare) };
      }
    }
  };

  const channels = [
    {
      key: 'lan',
      label: '局域网',
      labelEn: 'LAN',
      enabled: Boolean(enCh.lan),
      detected: Boolean(desc.primaryLan),
      available: Boolean(enCh.lan && desc.primaryLan),
      rawHost: lanEntryHost,
      displayHost: enCh.lan ? lanEntryHost : (lanEntryHost ? `已停用 · ${lanEntryHost}` : '已停用'),
      entryHost: lanEntryHost,
      iface: desc.primaryLan?.iface || ''
    },
    {
      key: 'tailscale',
      label: 'Tailscale',
      labelEn: 'Tailscale',
      enabled: Boolean(enCh.tailscale),
      detected: desc.tailscale.length > 0 || Boolean(desc.tailscaleHttpsUrl) || Boolean(desc.tailscaleCustomHost),
      available: Boolean(enCh.tailscale && (desc.tailscale.length > 0 || Boolean(desc.tailscaleHttpsUrl) || Boolean(desc.tailscaleCustomHost))),
      rawHost: tsDisplayHost,
      displayHost: enCh.tailscale
        ? (desc.tailscaleHttpsUrl ? `HTTPS · ${desc.tailscaleDnsName}` : tsDisplayHost)
        : (tsDisplayHost ? `已停用 · ${tsDisplayHost}` : '已停用'),
      entryHost: tsEntryHost,
      entryBaseUrl: desc.tailscaleHttpsUrl || '',
      httpsUrl: desc.tailscaleHttpsUrl || '',
      httpsHint: desc.tailscaleHttpsHint || '',
      customHost: cfg.tailscaleCustomHost || '',
      iface: desc.tailscale[0]?.iface || ''
    },
    {
      key: 'bonjour',
      label: 'Bonjour',
      labelEn: 'Bonjour',
      enabled: Boolean(enCh.bonjour),
      detected: Boolean(bonjourEntryHost),
      available: Boolean(enCh.bonjour && bonjourEntryHost),
      rawHost: bonjourEntryHost,
      displayHost: enCh.bonjour ? bonjourEntryHost : (bonjourEntryHost ? `已停用 · ${bonjourEntryHost}` : '已停用'),
      entryHost: bonjourEntryHost,
      iface: desc.primaryLan?.iface || ''
    },
    tunnelChannel
  ].map((ch) => {
    if (!ch.available || (!ch.entryHost && !ch.entryBaseUrl)) return { ...ch, url: '', qrSvg: '' };
    const { url, qrSvg } = mkQrSafe(ch.entryHost, ch.entryBaseUrl || '');
    return { ...ch, url, qrSvg };
  });

  const tailscaleUrls = enCh.tailscale ? desc.tailscale.map((x) => ({ ...x, ...mkQrSafe(x.address) })) : [];
  const lanUrls = enCh.lan ? desc.lan.map((x) => ({ ...x, ...mkQrSafe(x.address) })) : [];

  const isTailscaleHttpsCh = (c) => Boolean(
    c && c.key === 'tailscale' && c.available
    && (c.httpsUrl || (c.entryBaseUrl && String(c.entryBaseUrl).startsWith('https://')) || String(c.url || '').startsWith('https://'))
  );
  const pickedChannel = channels.find((c) => c.key === 'tunnel' && c.available && c.mode === 'named')
    || channels.find((c) => isTailscaleHttpsCh(c))
    || channels.find((c) => c.key === 'lan' && c.available)
    || channels.find((c) => c.key === 'tailscale' && c.available)
    || channels.find((c) => c.key === 'tunnel' && c.available)
    || channels.find((c) => c.available);
  const localBuilt = mkQrSafe('127.0.0.1');
  const localUrl = localBuilt.url;
  const localhostUrl = mkQrSafe('localhost').url;
  const primary = pickedChannel
    ? { iface: pickedChannel.iface, address: pickedChannel.entryHost, kind: pickedChannel.key, url: pickedChannel.url, qrSvg: pickedChannel.qrSvg }
    : { iface: '', address: '', kind: 'none', url: '', qrSvg: '' };

  return {
    port: cfg.port,
    token: cfg.token,
    configPath: getRemoteConfigPath(),
    deviceName: desc.deviceName,
    bonjourHost: desc.bonjourHost,
    tailscaleDnsName: desc.tailscaleDnsName,
    tailscaleCustomHost: cfg.tailscaleCustomHost || '',
    enabledChannels: enCh,
    remoteDisplay: sanitizeRemoteDisplayConfig(cfg.remoteDisplay),
    tunnelEnabled: Boolean(cfg.tunnelEnabled),
    tunnelMode: cfg.tunnelMode,
    tunnelHostname: cfg.tunnelHostname || '',
    hasTunnelToken: Boolean(cfg.tunnelToken),
    tunnelStatus: {
      enabled: Boolean(cfg.tunnelEnabled),
      mode: cfg.tunnelMode,
      state: effTunnel.state,
      publicUrl: tunnelActiveUrl,
      error: effTunnel.error || '',
      binaryAvailable: Boolean(effTunnel.binaryAvailable),
      installCommand: cloudflaredInstall.command
    },
    cloudflaredInstall,
    hosts: desc.hosts,
    endpoints: desc.endpoints,
    channels,
    pairedCount: devSummary.pairedCount,
    onlineCount: devSummary.onlineCount,
    pairedDevices: devSummary.devices,
    fusedUrl: primary.url,
    primaryUrl: primary.url,
    primaryKind: primary.kind,
    qrSvg: primary.qrSvg,
    tailscaleUrls,
    lanUrls,
    localUrl,
    localhostUrl,
    tailscaleHttpsUrl: desc.tailscaleHttpsUrl || '',
    tailscaleHttpsHint: desc.tailscaleHttpsHint || ''
  };
}

function printRemoteCli({ resetToken = false, jsonMode = false, tunnelAction = '' } = {}) {
  if (tunnelAction === 'on' || tunnelAction === 'off') {
    saveRemoteTunnelConfig({ enabled: tunnelAction === 'on' });
    if (!jsonMode) {
      console.log(tunnelAction === 'on'
        ? '✅ 已开启 Cloudflare 远程公网隧道（若桌面端正在运行，点弹窗刷新或在弹窗开关切换即可生效）'
        : '⭕ 已关闭 Cloudflare 远程公网隧道');
    }
  }
  const info = buildRemoteInfo({ resetToken });
  if (jsonMode) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log('');
  console.log(`📱 Antigravity 手机远程操作面板（多通道融合 · ${info.deviceName}）`);
  if (resetToken) console.log('🔑 已重置并生成新的配对 Token（旧链接将自动失效）');
  console.log('');

  for (const ch of (info.channels || [])) {
    if (ch.available) {
      console.log(`✅ ${ch.label.padEnd(14, ' ')} ${ch.displayHost} (${ch.iface || 'auto'})`);
    } else {
      console.log(`⭕ ${ch.label.padEnd(14, ' ')} ${ch.key === 'tunnel' ? ch.displayHost : '未就绪'}`);
    }
  }
  console.log('');
  console.log(`🔗 配对链接: ${info.fusedUrl}`);
  console.log(`🖥️ 本机调试地址: ${info.localUrl}`);
  console.log('');
  console.log('📷 用 iPhone 相机扫描下方二维码即可打开：');
  console.log('');
  if (info.primaryUrl) {
    try {
      const primaryGrid = encodeQrCodeMatrix(info.primaryUrl);
      const cols = Number(process.stdout.columns || 0);
      const qrForTerminal = (cols > 0 && cols < primaryGrid.length + 6)
        ? `http://${(info.tailscaleUrls[0]?.address || info.lanUrls[0]?.address || '127.0.0.1')}:${info.port}/?token=${info.token}`
        : info.primaryUrl;
      console.log(renderTerminalQr(qrForTerminal));
    } catch (err) {
      console.log(`⚠️ 融合二维码字符过长已降级，请直接复制上方融合链接或缩短主机名后重试 (${err?.message || err})`);
    }
  } else {
    console.log('⚠️ 所有连接通道均已停用，请启用至少一种连接方式。');
  }
  console.log('');
  console.log('💡 使用提示：');
  console.log('   1. 扫码在 Safari 打开后，点击底部「分享」→「添加到主屏幕」');
  console.log('   2. 支持 ag-context-meter remote --tunnel on|off 开关 Cloudflare 公网隧道（免装 Tailscale）');
  console.log('   3. 在聊天区右滑即可拉出左侧会话抽屉，底部可直接切换模型/权限与拍照传图');
  console.log('');
}

if (require.main === module) {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const tIdx = rawArgs.indexOf('--tunnel');
  const tunnelAction = (tIdx >= 0 && rawArgs[tIdx + 1]) ? String(rawArgs[tIdx + 1]).trim().toLowerCase() : '';
  if (args.has('--print-info')) {
    printRemoteCli({
      resetToken: args.has('--reset-token'),
      jsonMode: args.has('--json'),
      tunnelAction
    });
  } else {
    startMobileRemoteServer();
  }
}

module.exports = {
  DEFAULT_REMOTE_PORT,
  loadOrCreateRemoteConfig,
  saveRemoteTunnelConfig,
  extractCloudflareTunnelToken,
  validateCloudflareTunnelToken,
  validateTunnelHostname,
  normalizeTunnelHostname,
  validateTailscaleCustomHost,
  normalizeTailscaleCustomHost,
  getCloudflaredInstallGuide,
  resolveCloudflaredBinary,
  createCloudflareTunnelController,
  isAllowedPrivateAddress,
  isAllowedPrivateOrigin,
  detectRequestChannel,
  parseTailscalePingOutput,
  getLocalHostIpSet,
  isIpInLocalPhysicalLanSubnet,
  probeClientPrivateReachability,
  clearPairedDevicesForTests: () => {
    pairedDevicesMap.clear();
    remoteClientSessions.clear();
    probeHintCache.clear();
  },
  DEFAULT_REMOTE_DISPLAY_CONFIG,
  sanitizeRemoteDisplayConfig,
  DEFAULT_REMOTE_QUICK_PROMPTS,
  buildRemoteQuickPrompts,
  getRemoteClientSession,
  clearRemoteClientSessionsForTests,
  enumerateLocalAddresses,
  encodeEndpointsParam,
  decodeEndpointsParam,
  buildFusedPairingUrl,
  encodeQrCodeMatrix,
  renderTerminalQr,
  renderQrSvg,
  buildMobileAppHtml,
  buildManifestJson,
  buildServiceWorkerJs,
  normalizeTrajectoryStatus,
  renderSafeMarkdownToHtml,
  extractMessagesFromTrajectorySteps,
  extractQueuedMessagesFromTrajectorySteps,
  extractPendingAgentMessagesFromUpdate,
  extractTrajectoryUserAttachments,
  extractRawMediaEntriesFromUserInput,
  buildQueuedStepMediaSig,
  materializeQueuedAttachmentsForEdit,
  stripDisplayMediaSuffixFromQueuedText,
  classifyLanguageServerRpcError,
  mergeUniqueQueuedLists,
  collapseConsecutiveDomThinking,
  normPlainMatchText,
  mergeTrajectoryAndDomMessages,
  resolveProductionMediaAllowedRoots,
  resolveMediaAllowedRoots,
  resolveSafeLocalMediaPath,
  listSafeProjectTree,
  readSafeTextFilePreview,
  createSessionCatalogStore,
  createConversationHistoryManager,
  enrichSnapshotWithCatalog,
  listCatalogConversations,
  getConversationMessagesPage,
  warmConversationSession,
  isSensitiveHostPath,
  resolveAllowedHostRoots,
  assertSafeHostDirectoryPath,
  listHostDirectories,
  createHostSubdirectory,
  createRemoteProject,
  evalInCdpTarget,
  evalInPickedTarget,
  buildEnrichFallbackSnapshot,
  fetchSnapshotFromTarget,
  performActionInTarget,
  acceptsGzipEncoding,
  readJsonBody,
  createRemoteHttpHandler,
  recordPairedDeviceAccess,
  getPairedDevicesSummary,
  startMobileRemoteServer,
  resolveEmptyCloudflaredConfigPath,
  buildRemoteInfo,
  detectHostIdentityMeta,
  ensureTailscaleServeHttps,
  cleanupTailscaleServeHttps,
  collectFusedEndpointDescriptor,
  isAllowedPrivateOrigin,
  printRemoteCli
};
