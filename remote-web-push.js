'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');

const DEFAULT_PUSH_SUBJECT = 'mailto:remote@antigravity.local';
const MAX_SUBSCRIPTIONS = 24;
const DEFAULT_DEBOUNCE_MS = 8000;
const RFC8188_RECORD_SIZE = 4096;
const MAX_SINGLE_RECORD_PLAINTEXT_BYTES = RFC8188_RECORD_SIZE - 16 - 1; // 4079 bytes (GCM tag 16B + delimiter 0x02 1B)

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str) {
  const s = String(str || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!s || /[^A-Za-z0-9+/=]/.test(s)) return Buffer.alloc(0);
  const padLen = (4 - (s.length % 4)) % 4;
  return Buffer.from(s + '='.repeat(padLen), 'base64');
}

function expandIpv6Groups(ip) {
  const clean = String(ip || '').toLowerCase().split('%')[0];
  let normalized = clean;
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon >= 0 && normalized.slice(lastColon + 1).includes('.')) {
    const v4Parts = normalized.slice(lastColon + 1).split('.').map((n) => Number(n));
    if (v4Parts.length !== 4 || v4Parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
    const lo = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = halves.length === 2 ? (8 - left.length - right.length) : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const full = [...left, ...Array(missing).fill('0'), ...right];
  if (full.length !== 8) return null;
  const nums = full.map((g) => parseInt(g, 16));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function isBlockedPushHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').trim().toLowerCase().split('%')[0];
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const ipVer = net.isIP(h);
  if (ipVer === 4) {
    const parts = h.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;                         // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;                         // 100.64.0.0/10 (CGNAT)
    if (a === 169 && b === 254) return true;                                   // 169.254.0.0/16 (Link-Local)
    if (a === 172 && b >= 16 && b <= 31) return true;                          // 172.16.0.0/12 (Private)
    if (a === 192 && b === 0 && c === 0) return true;                          // 192.0.0.0/24 (IETF Protocol)
    if (a === 192 && b === 0 && c === 2) return true;                          // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 88 && c === 99) return true;                        // 192.88.99.0/24 (6to4 Relay)
    if (a === 192 && b === 168) return true;                                   // 192.168.0.0/16 (Private)
    if (a === 198 && (b === 18 || b === 19)) return true;                      // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && b === 51 && c === 100) return true;                       // 198.51.100.0/24 (TEST-NET-2)
    if (a === 203 && b === 0 && c === 113) return true;                        // 203.0.113.0/24 (TEST-NET-3)
    if (a >= 224) return true;                                                 // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved
    return false;
  }
  if (ipVer === 6) {
    const g = expandIpv6Groups(h);
    if (!g) return true;
    const isAllZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    if (isAllZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // ::/128, ::1/128
    if (isAllZeroPrefix && (g[5] === 0xffff || g[5] === 0)) return true;       // ::ffff:0:0/96 & IPv4-compatible
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0) return true; // 64:ff9b::/96 NAT64
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) return true;     // 64:ff9b:1::/48 Local-Use NAT64
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 Discard-Only
    if (g[0] === 0x2001 && g[1] === 0x0000) return true;                       // 2001::/32 Teredo
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                       // 2001:db8::/32 Documentation
    if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return true;         // 2001:2::/48 Benchmarking
    if (g[0] === 0x2001 && g[1] === 0x0010) return true;                       // 2001:10::/28 ORCHID
    if (g[0] === 0x2002) return true;                                          // 2002::/16 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true;                               // fc00::/7 Unique Local
    if ((g[0] & 0xffc0) === 0xfe80) return true;                               // fe80::/10 Link-Local
    if ((g[0] & 0xffc0) === 0xfec0) return true;                               // fec0::/10 Site-Local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true;                               // ff00::/8 Multicast
    return false;
  }
  return false;
}

async function resolveSafePushEndpoint(endpoint, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || '').trim());
  } catch {
    return { ok: false, error: '订阅 endpoint 不是合法 URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Web Push 订阅 endpoint 必须为 https:// 地址' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'Web Push 订阅 endpoint 仅允许标准 443 HTTPS 端口' };
  }
  if (parsed.username || parsed.password || isBlockedPushHost(parsed.hostname)) {
    return { ok: false, error: '订阅 endpoint 主机不受允许' };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipVer = net.isIP(host);
  if (ipVer === 4 || ipVer === 6) {
    return { ok: true, parsed, resolvedAddress: host, resolvedFamily: ipVer };
  }
  const dnsLookup = typeof options.dnsLookup === 'function'
    ? options.dnsLookup
    : (h) => dns.promises.lookup(h, { all: true, verbatim: true });
  let records;
  try {
    records = await dnsLookup(host);
  } catch (err) {
    return { ok: false, error: `订阅 endpoint DNS 解析失败: ${err?.message || 'unknown'}` };
  }
  const list = Array.isArray(records) ? records : (records ? [records] : []);
  if (!list.length) {
    return { ok: false, error: '订阅 endpoint DNS 解析无可用地址' };
  }
  for (const rec of list) {
    const addr = String(rec?.address || rec || '').trim();
    if (!addr || isBlockedPushHost(addr)) {
      return { ok: false, error: `订阅 endpoint DNS 解析到受限非公网地址 (${addr || 'empty'})` };
    }
  }
  const first = list[0];
  const resolvedAddress = String(first?.address || first).trim();
  const resolvedFamily = Number(first?.family) || net.isIP(resolvedAddress) || 4;
  return { ok: true, parsed, resolvedAddress, resolvedFamily };
}

function postEncryptedPushPinned(parsedUrl, resolvedAddress, resolvedFamily, headers, body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const effectiveTimeout = Math.max(500, Number(timeoutMs) || 8000);
    let settled = false;
    let req = null;
    let resRef = null;
    const wallTimer = setTimeout(() => {
      try { req?.destroy(new Error('Web Push request timeout')); } catch {}
      finish({ ok: false, status: 0, expired: false, error: 'Web Push request timeout' });
    }, effectiveTimeout);
    if (typeof wallTimer.unref === 'function') wallTimer.unref();
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      try { resRef?.destroy?.(); } catch {}
      resolve(val);
    };
    req = https.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : 443,
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: 'POST',
      agent: false,
      servername: parsedUrl.hostname,
      headers: {
        ...headers,
        'Content-Length': String(body.length)
      },
      lookup: (_hostname, opts, cb) => {
        if (opts && opts.all) {
          cb(null, [{ address: resolvedAddress, family: resolvedFamily }]);
        } else {
          cb(null, resolvedAddress, resolvedFamily);
        }
      },
      timeout: effectiveTimeout
    }, (res) => {
      resRef = res;
      const status = Number(res.statusCode || 0);
      if (status >= 300 && status < 400) {
        res.destroy();
        finish({ ok: false, status, expired: false, error: `Web Push 拒绝重定向响应 (HTTP ${status})` });
        return;
      }
      let respBytes = 0;
      res.on('data', (chunk) => {
        respBytes += chunk.length;
        if (respBytes > 65536) {
          res.destroy();
        }
      });
      res.on('error', () => {});
      const ok = status >= 200 && status < 300;
      const expired = status === 404 || status === 410;
      finish({ ok, status, expired });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Web Push request timeout'));
    });
    req.on('error', (err) => {
      finish({ ok: false, status: 0, expired: false, error: err?.message || String(err) });
    });
    req.end(body);
  });
}

const p256ValidationEcdh = (() => {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  return e;
})();

function validatePushSubscription(sub) {
  if (!sub || typeof sub !== 'object') {
    return { ok: false, error: '无效的推送订阅对象' };
  }
  const endpoint = String(sub.endpoint || '').trim();
  if (!endpoint || endpoint.length > 2048) {
    return { ok: false, error: '订阅 endpoint 缺失或过长' };
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, error: '订阅 endpoint 不是合法 URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Web Push 订阅 endpoint 必须为 https:// 地址' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'Web Push 订阅 endpoint 仅允许标准 443 HTTPS 端口' };
  }
  if (parsed.username || parsed.password || isBlockedPushHost(parsed.hostname)) {
    return { ok: false, error: '订阅 endpoint 主机不受允许' };
  }
  const p256dhRaw = String(sub.keys?.p256dh || '').trim();
  const authRaw = String(sub.keys?.auth || '').trim();
  const p256dhBuf = b64urlDecode(p256dhRaw);
  const authBuf = b64urlDecode(authRaw);
  if (p256dhBuf.length !== 65 || p256dhBuf[0] !== 0x04) {
    return { ok: false, error: '订阅 keys.p256dh 必须为 65 字节未压缩 P-256 公钥' };
  }
  try {
    p256ValidationEcdh.computeSecret(p256dhBuf);
  } catch {
    return { ok: false, error: '订阅 keys.p256dh 不是合法的 P-256 椭圆曲线公钥点' };
  }
  if (authBuf.length !== 16) {
    return { ok: false, error: '订阅 keys.auth 必须为 16 字节密钥' };
  }
  return {
    ok: true,
    subscription: {
      endpoint: parsed.toString(),
      keys: {
        p256dh: b64urlEncode(p256dhBuf),
        auth: b64urlEncode(authBuf)
      }
    }
  };
}

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  const rawPub = Buffer.concat([
    Buffer.from([0x04]),
    b64urlDecode(pubJwk.x),
    b64urlDecode(pubJwk.y)
  ]);
  return {
    publicKey: b64urlEncode(rawPub),
    privateKeyJwk: privJwk,
    subject: DEFAULT_PUSH_SUBJECT
  };
}

function createVapidAuthHeader(endpoint, vapidKeys, options = {}) {
  const parsed = new URL(endpoint);
  const nowSec = Math.floor((options.nowMs || Date.now()) / 1000);
  const expSec = nowSec + Math.max(60, Math.min(24 * 3600, Number(options.ttlSeconds) || 12 * 3600));
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8'));
  const payload = b64urlEncode(Buffer.from(JSON.stringify({
    aud: parsed.origin,
    exp: expSec,
    sub: vapidKeys.subject || DEFAULT_PUSH_SUBJECT
  }), 'utf8'));
  const signingInput = `${header}.${payload}`;
  const privKeyObj = crypto.createPrivateKey({ key: vapidKeys.privateKeyJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privKeyObj,
    dsaEncoding: 'ieee-p1363'
  });
  const jwt = `${signingInput}.${b64urlEncode(sig)}`;
  return `vapid t=${jwt}, k=${vapidKeys.publicKey}`;
}

function encryptWebPushPayload(plaintext, subscription, options = {}) {
  const checked = validatePushSubscription(subscription);
  if (!checked.ok) throw new Error(checked.error);
  const uaPublic = b64urlDecode(checked.subscription.keys.p256dh);
  const authSecret = b64urlDecode(checked.subscription.keys.auth);

  const serverEcdh = crypto.createECDH('prime256v1');
  if (options.serverPrivateKey) {
    serverEcdh.setPrivateKey(options.serverPrivateKey);
  } else {
    serverEcdh.generateKeys();
  }
  const asPublic = serverEcdh.getPublicKey();
  const ecdhSecret = serverEcdh.computeSecret(uaPublic);
  const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);

  // RFC 8291 §3.3 Key Derivation
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // RFC 8188 single record (padding delimiter 0x02 for final record; rs = 4096 -> max plaintext 4079 UTF-8 bytes)
  const plainBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext || ''), 'utf8');
  if (plainBuf.length > MAX_SINGLE_RECORD_PLAINTEXT_BYTES) {
    throw new RangeError(`Web Push 载荷超出单记录上限 (${plainBuf.length} > ${MAX_SINGLE_RECORD_PLAINTEXT_BYTES} UTF-8 bytes)`);
  }
  const recordPlain = Buffer.concat([plainBuf, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(recordPlain), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RFC8188_RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return {
    body: Buffer.concat([header, encrypted, authTag]),
    salt,
    asPublic
  };
}

function decryptWebPushPayloadForTest(bodyBuf, uaPrivateKeyBuf, authSecretBuf) {
  const buf = Buffer.from(bodyBuf);
  const salt = buf.subarray(0, 16);
  const idLen = buf.readUInt8(20);
  const asPublic = buf.subarray(21, 21 + idLen);
  const ciphertextWithTag = buf.subarray(21 + idLen);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

  const uaEcdh = crypto.createECDH('prime256v1');
  uaEcdh.setPrivateKey(uaPrivateKeyBuf);
  const uaPublic = uaEcdh.getPublicKey();
  const ecdhSecret = uaEcdh.computeSecret(asPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecretBuf, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12));

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(authTag);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  let endIdx = padded.length - 1;
  while (endIdx >= 0 && padded[endIdx] === 0x00) endIdx -= 1;
  if (endIdx < 0 || padded[endIdx] !== 0x02) {
    throw new Error('Invalid RFC 8188 padding delimiter');
  }
  return padded.subarray(0, endIdx).toString('utf8');
}

function computeCompletedUnreadCount(conversations) {
  if (!Array.isArray(conversations)) return 0;
  let count = 0;
  for (const c of conversations) {
    if (!c || c.archived === true) continue;
    if (c.status === 'idle' && c.completedUnread === true) {
      count += 1;
    }
  }
  return count;
}

function sanitizePushPrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    notifyCompleted: src.notifyCompleted !== false,
    notifyWaiting: src.notifyWaiting !== false
  };
}

function createWebPushManager(options = {}) {
  const getStateFilePath = typeof options.getStateFilePath === 'function'
    ? options.getStateFilePath
    : () => path.join(options.stateDir || process.cwd(), 'remote-push-state.json');
  const customFetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : null;
  const dnsLookup = typeof options.dnsLookup === 'function' ? options.dnsLookup : null;
  const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : DEFAULT_DEBOUNCE_MS;

  let cachedState = null;
  const prevStatusMap = new Map();
  let trackerBootstrapped = false;
  const lastEventSentAt = new Map();

  function ensureOwnerOnlyMode(filePath) {
    if (process.platform === 'win32') return;
    fs.chmodSync(filePath, 0o600);
    const mode = fs.statSync(filePath).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`无法将推送密钥状态文件权限收紧至 0600 (当前 0${mode.toString(8)})`);
    }
  }

  function loadState() {
    if (cachedState) return cachedState;
    const fp = getStateFilePath();
    let parsed = null;
    let fileExists = false;
    if (fs.existsSync(fp)) {
      fileExists = true;
      ensureOwnerOnlyMode(fp);
      try {
        parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      } catch {}
    }
    const hasValidVapid = Boolean(
      parsed?.vapid?.publicKey
      && parsed?.vapid?.privateKeyJwk?.d
      && parsed?.vapid?.privateKeyJwk?.x
      && parsed?.vapid?.privateKeyJwk?.y
    );
    const vapid = hasValidVapid ? parsed.vapid : generateVapidKeys();
    const rawSubs = Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : [];
    const subs = [];
    const seen = new Set();
    for (const s of rawSubs) {
      const checked = validatePushSubscription(s);
      if (checked.ok && !seen.has(checked.subscription.endpoint)) {
        seen.add(checked.subscription.endpoint);
        subs.push({
          ...checked.subscription,
          label: String(s.label || '').slice(0, 80),
          origin: String(s.origin || '').slice(0, 160),
          createdAt: Number(s.createdAt) || Date.now()
        });
      }
    }
    const nextState = {
      vapid,
      prefs: sanitizePushPrefs(parsed?.prefs),
      subscriptions: subs.slice(-MAX_SUBSCRIPTIONS)
    };
    if (!hasValidVapid || !fileExists) {
      persistState(nextState);
    }
    cachedState = nextState;
    return cachedState;
  }

  function persistState(state) {
    const fp = getStateFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = `${fp}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
      ensureOwnerOnlyMode(tmp);
      fs.renameSync(tmp, fp);
      ensureOwnerOnlyMode(fp);
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      throw new Error(`持久化推送状态失败: ${err?.message || String(err)}`);
    }
  }

  function getPublicInfo() {
    const st = loadState();
    return {
      publicKey: st.vapid.publicKey,
      prefs: { ...st.prefs },
      subscriptionCount: st.subscriptions.length
    };
  }

  function addSubscription(sub, meta = {}) {
    const checked = validatePushSubscription(sub);
    if (!checked.ok) return { ...checked, statusCode: 400 };
    try {
      const st = loadState();
      const prevSubs = st.subscriptions.slice();
      const nextEntry = {
        ...checked.subscription,
        label: String(meta.label || '').slice(0, 80),
        origin: String(meta.origin || '').slice(0, 160),
        createdAt: Date.now()
      };
      const idx = st.subscriptions.findIndex((s) => s.endpoint === nextEntry.endpoint);
      if (idx >= 0) {
        st.subscriptions[idx] = nextEntry;
      } else {
        st.subscriptions.push(nextEntry);
        if (st.subscriptions.length > MAX_SUBSCRIPTIONS) {
          st.subscriptions = st.subscriptions.slice(-MAX_SUBSCRIPTIONS);
        }
      }
      try {
        persistState(st);
      } catch (err) {
        st.subscriptions = prevSubs;
        return { ok: false, statusCode: 500, error: err?.message || '保存订阅失败' };
      }
      return { ok: true, subscriptionCount: st.subscriptions.length };
    } catch (err) {
      return { ok: false, statusCode: 500, error: err?.message || '加载推送状态失败' };
    }
  }

  function removeSubscription(endpoint) {
    const target = String(endpoint || '').trim();
    try {
      const st = loadState();
      const prevSubs = st.subscriptions.slice();
      const before = st.subscriptions.length;
      st.subscriptions = st.subscriptions.filter((s) => s.endpoint !== target);
      if (st.subscriptions.length !== before) {
        try {
          persistState(st);
        } catch (err) {
          st.subscriptions = prevSubs;
          return { ok: false, statusCode: 500, error: err?.message || '移除订阅失败' };
        }
      }
      return { ok: true, removed: before - st.subscriptions.length, subscriptionCount: st.subscriptions.length };
    } catch (err) {
      return { ok: false, statusCode: 500, error: err?.message || '加载推送状态失败' };
    }
  }

  function updatePrefs(patch = {}) {
    try {
      const st = loadState();
      const prevPrefs = { ...st.prefs };
      st.prefs = sanitizePushPrefs({ ...st.prefs, ...(patch && typeof patch === 'object' ? patch : {}) });
      try {
        persistState(st);
      } catch (err) {
        st.prefs = prevPrefs;
        return { ok: false, statusCode: 500, error: err?.message || '保存推送偏好失败' };
      }
      return { ok: true, prefs: { ...st.prefs } };
    } catch (err) {
      return { ok: false, statusCode: 500, error: err?.message || '加载推送状态失败' };
    }
  }

  async function sendToSubscription(sub, payloadObj, sendOpts = {}) {
    const safeTarget = await resolveSafePushEndpoint(sub?.endpoint, {
      dnsLookup: sendOpts.dnsLookup || dnsLookup
    });
    if (!safeTarget.ok) {
      return { ok: false, status: 0, expired: false, error: safeTarget.error };
    }
    let body;
    let reqHeaders;
    try {
      const st = loadState();
      const jsonStr = JSON.stringify(payloadObj || {});
      body = encryptWebPushPayload(jsonStr, sub).body;
      const authHeader = createVapidAuthHeader(sub.endpoint, st.vapid, {
        ttlSeconds: sendOpts.ttlSeconds || 3600
      });
      reqHeaders = {
        Authorization: authHeader,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(sendOpts.ttlSeconds || 3600),
        Urgency: payloadObj?.type === 'waiting' ? 'high' : 'normal'
      };
    } catch (err) {
      return { ok: false, status: 0, expired: false, error: err?.message || 'encrypt_failed' };
    }

    if (!customFetchImpl) {
      return postEncryptedPushPinned(
        safeTarget.parsed,
        safeTarget.resolvedAddress,
        safeTarget.resolvedFamily,
        reqHeaders,
        body,
        sendOpts.timeoutMs || 8000
      );
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), sendOpts.timeoutMs || 8000) : null;
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      const resp = await customFetchImpl(sub.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: reqHeaders,
        body,
        signal: controller ? controller.signal : undefined
      });
      const status = Number(resp?.status || 0);
      if (status >= 300 && status < 400) {
        return { ok: false, status, expired: false, error: `Web Push 拒绝重定向响应 (HTTP ${status})` };
      }
      const ok = Boolean((status >= 200 && status < 300) || (status === 0 && resp?.ok));
      const expired = status === 404 || status === 410;
      return { ok, status, expired };
    } catch (err) {
      return { ok: false, status: 0, expired: false, error: err?.message || String(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function broadcast(payloadObj, sendOpts = {}) {
    const st = loadState();
    if (!st.subscriptions.length) {
      return { ok: true, sent: 0, failed: 0, expiredRemoved: 0 };
    }
    const results = await Promise.all(st.subscriptions.map(async (sub) => ({
      endpoint: sub.endpoint,
      res: await sendToSubscription(sub, payloadObj, sendOpts)
    })));
    let sent = 0;
    let failed = 0;
    const expiredSet = new Set();
    for (const item of results) {
      if (item.res.ok) sent += 1;
      else failed += 1;
      if (item.res.expired) expiredSet.add(item.endpoint);
    }
    if (expiredSet.size > 0) {
      st.subscriptions = st.subscriptions.filter((s) => !expiredSet.has(s.endpoint));
      try { persistState(st); } catch {}
    }
    return { ok: sent > 0 || failed === 0, sent, failed, expiredRemoved: expiredSet.size, results };
  }

  function observeCatalogItems(items, nowMs = Date.now()) {
    const list = Array.isArray(items) ? items : [];
    const completedUnreadCount = computeCompletedUnreadCount(list);
    const events = [];

    if (!trackerBootstrapped) {
      for (const c of list) {
        if (!c || !c.id) continue;
        prevStatusMap.set(c.id, { status: c.status || 'unknown', updatedAt: Number(c.updatedAt) || 0 });
      }
      trackerBootstrapped = true;
      return { events, completedUnreadCount };
    }

    const st = loadState();
    const activeIds = new Set();
    for (const c of list) {
      if (!c || !c.id) continue;
      activeIds.add(c.id);
      const prev = prevStatusMap.get(c.id);
      const nextStatus = c.status || 'unknown';
      const nextUpdatedAt = Number(c.updatedAt) || 0;
      prevStatusMap.set(c.id, { status: nextStatus, updatedAt: nextUpdatedAt });
      if (!prev) continue;

      let eventType = '';
      if (prev.status === 'running' && nextStatus === 'idle' && (c.completedUnread || nextUpdatedAt > prev.updatedAt)) {
        eventType = 'completed';
      } else if (prev.status !== 'waiting' && nextStatus === 'waiting') {
        eventType = 'waiting';
      }
      if (!eventType) continue;
      if (!st.prefs.enabled) continue;
      if (eventType === 'completed' && !st.prefs.notifyCompleted) continue;
      if (eventType === 'waiting' && !st.prefs.notifyWaiting) continue;

      const dedupKey = `${eventType}:${c.id}`;
      const lastAt = lastEventSentAt.get(dedupKey);
      if (debounceMs > 0 && lastAt !== undefined && (nowMs - lastAt) < debounceMs) continue;
      lastEventSentAt.set(dedupKey, nowMs);

      const titleText = String(c.title || 'Antigravity 对话').slice(0, 60);
      const projText = String(c.projectName || '').trim();
      events.push({
        type: eventType,
        conversationId: c.id,
        title: eventType === 'waiting' ? '需要你的确认' : '对话已完成',
        body: eventType === 'waiting'
          ? `${titleText}${projText ? ` (${projText})` : ''} 正在等待确认或审批`
          : `${titleText}${projText ? ` · ${projText}` : ''}`,
        ...options.formatCatalogNotification?.(c, eventType),
        tag: `ag-${eventType}-${c.id}`,
        url: `/?conversationId=${encodeURIComponent(c.id)}`,
        completedUnreadCount,
        ts: nowMs
      });
    }

    for (const id of prevStatusMap.keys()) {
      if (!activeIds.has(id)) {
        prevStatusMap.delete(id);
        lastEventSentAt.delete(`completed:${id}`);
        lastEventSentAt.delete(`waiting:${id}`);
      }
    }

    if (events.length > 0 && st.subscriptions.length > 0 && !options.disableAutoBroadcast) {
      for (const ev of events) {
        void broadcast(ev).catch(() => {});
      }
    }
    return { events, completedUnreadCount };
  }

  return {
    getPublicInfo,
    addSubscription,
    removeSubscription,
    updatePrefs,
    broadcast,
    observeCatalogItems,
    resetForTest() {
      cachedState = null;
      prevStatusMap.clear();
      trackerBootstrapped = false;
      lastEventSentAt.clear();
    }
  };
}

// ==================== 零依赖纯 Node.js PNG 图标生成 ====================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const PNG_ICON_CACHE = new Map();

function buildPwaIconPng(size = 192) {
  const dim = Math.max(32, Math.min(512, Math.round(Number(size) || 192)));
  if (PNG_ICON_CACHE.has(dim)) return PNG_ICON_CACHE.get(dim);

  const raw = Buffer.alloc((dim * 4 + 1) * dim);
  const radius = dim * 0.22;
  const cx = dim * 0.5;
  const cy = dim * 0.5;

  for (let y = 0; y < dim; y++) {
    const rowStart = y * (dim * 4 + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < dim; x++) {
      const px = rowStart + 1 + x * 4;
      // 圆角矩形裁剪（含 iOS/macOS 满底安全填充）
      const dx = Math.max(0, Math.abs(x - cx) - (cx - radius));
      const dy = Math.max(0, Math.abs(y - cy) - (cy - radius));
      const inRounded = (dx * dx + dy * dy) <= (radius * radius);

      // 深邃暗底 + 紫色主调微渐变 (#0f0d1a -> #1e1633)
      const t = (x + y) / (2 * dim);
      let r = Math.round(15 + t * 24);
      let g = Math.round(13 + t * 14);
      let b = Math.round(26 + t * 38);
      const a = inRounded ? 255 : 255; // iOS apple-touch-icon 推荐不透明底色防黑边

      // 紫色内光晕圆环 (#7c3aed -> #a78bfa)
      const nx = (x - cx) / dim;
      const ny = (y - cy) / dim;
      const dist = Math.hypot(nx, ny);
      if (dist < 0.36 && dist > 0.29) {
        r = Math.round(124 + t * 43);
        g = Math.round(58 + t * 81);
        b = Math.round(237 + t * 13);
      }

      // 中心白色 "A" 翼形图标
      const inLeftLeg = Math.abs((nx + 0.14) - (ny + 0.22) * -0.52) < 0.045 && ny > -0.22 && ny < 0.22;
      const inRightLeg = Math.abs((nx - 0.14) - (ny + 0.22) * 0.52) < 0.045 && ny > -0.22 && ny < 0.22;
      const inApex = Math.hypot(nx, ny + 0.21) < 0.05;
      const inBar = ny > 0.01 && ny < 0.08 && Math.abs(nx) < 0.13;
      if (inLeftLeg || inRightLeg || inApex || inBar) {
        r = 248;
        g = 247;
        b = 255;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
  PNG_ICON_CACHE.set(dim, png);
  return png;
}

module.exports = {
  RFC8188_RECORD_SIZE,
  MAX_SINGLE_RECORD_PLAINTEXT_BYTES,
  b64urlEncode,
  b64urlDecode,
  isBlockedPushHost,
  resolveSafePushEndpoint,
  validatePushSubscription,
  generateVapidKeys,
  createVapidAuthHeader,
  encryptWebPushPayload,
  decryptWebPushPayloadForTest,
  computeCompletedUnreadCount,
  createWebPushManager,
  buildPwaIconPng
};
