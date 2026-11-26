'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const zlib = require('zlib');
const { resolveActiveCdpTarget } = require('./asar-engine');

const LOOPBACK_ORIGIN_RE = /^https?:\/\/127\.0\.0\.1:(\d+)$/;

function normalizeLoopbackOrigin(rawOrigin) {
  if (!rawOrigin || typeof rawOrigin !== 'string') return null;
  try {
    const parsed = new URL(rawOrigin.trim());
    const origin = parsed.origin;
    const m = origin.match(LOOPBACK_ORIGIN_RE);
    if (!m) return null;
    const port = Number(m[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return origin;
  } catch {
    return null;
  }
}

function request(url, body, token, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;
    let resRef = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { resRef?.destroy?.(); } catch {}
      try { req?.destroy?.(); } catch {}
      reject(err instanceof Error ? err : new Error(String(err || 'Local API request failed')));
    };
    const succeed = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      req = (url.startsWith('https:') ? https : http).request(url, {
        rejectUnauthorized: false,
        agent: false,
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': token } : {}
      }, response => {
        resRef = response;
        const chunks = [];
        response.on('data', chunk => {
          if (settled) return;
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('Local API response aborted')));
        response.on('close', () => {
          if (!settled && !response.complete) {
            fail(new Error('Local API connection closed unexpectedly'));
          }
        });
        response.on('end', () => {
          if (settled) return;
          let text = '';
          try {
            text = Buffer.concat(chunks).toString('utf8');
          } catch (err) {
            chunks.length = 0;
            fail(err);
            return;
          }
          chunks.length = 0;
          if (response.statusCode === 200) succeed(text);
          else fail(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
        });
      });
      req.setTimeout(Math.max(200, Number(timeoutMs) || 20000), () => fail(new Error('Local API timeout')));
      req.on('error', fail);
      req.end(body ? JSON.stringify(body) : undefined);
    } catch (err) {
      fail(err);
    }
  });
}

function requestConnectStreamFirstFrame(baseOrigin, method, body, token, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const MAX_FRAME_BYTES = 32 * 1024 * 1024;
    let settled = false;
    let req = null;
    let resRef = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { resRef?.destroy?.(); } catch {}
      try { req?.destroy?.(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), Math.max(200, Number(timeoutMs) || 1500));
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const targetUrl = `${String(baseOrigin || '').replace(/\/+$/, '')}/exa.language_server_pb.LanguageServerService/${method}`;
      const payloadBuf = Buffer.from(JSON.stringify(body || {}), 'utf8');
      const frame = Buffer.alloc(5 + payloadBuf.length);
      frame[0] = 0;
      frame.writeUInt32BE(payloadBuf.length, 1);
      payloadBuf.copy(frame, 5);
      const clientMod = targetUrl.startsWith('https:') ? https : http;
      req = clientMod.request(targetUrl, {
        rejectUnauthorized: false,
        agent: false,
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': String(token || '')
        }
      }, (res) => {
        resRef = res;
        if (res.statusCode && res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        const chunks = [];
        let totalBuffered = 0;
        let expectedLen = null;
        res.on('data', (chunk) => {
          if (settled) return;
          if (!Buffer.isBuffer(chunk) || !chunk.length) return;
          totalBuffered += chunk.length;
          if (totalBuffered > 5 + MAX_FRAME_BYTES) {
            finish(null);
            return;
          }
          chunks.push(chunk);
          if (totalBuffered < 5) return;
          if (expectedLen === null) {
            const headBuf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
            expectedLen = headBuf.readUInt32BE(1);
            if (expectedLen > MAX_FRAME_BYTES) {
              finish(null);
              return;
            }
            if (chunks.length > 1) {
              chunks.length = 0;
              chunks.push(headBuf);
            }
          }
          if (totalBuffered < 5 + expectedLen) return;
          const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
          const flags = buf[0];
          const len = buf.readUInt32BE(1);
          if (len > MAX_FRAME_BYTES) {
            finish(null);
            return;
          }
          const rawBody = buf.subarray(5, 5 + len);
          if ((flags & 2) !== 0) {
            finish(null);
            return;
          }
          try {
            const decoded = (flags & 1)
              ? zlib.gunzipSync(rawBody, { maxOutputLength: MAX_FRAME_BYTES })
              : rawBody;
            finish(JSON.parse(decoded.toString('utf8')));
          } catch {
            finish(null);
          }
        });
        res.on('end', () => finish(null));
        res.on('error', () => finish(null));
      });
      req.on('error', () => finish(null));
      req.end(frame);
    } catch {
      finish(null);
    }
  });
}

/**
 * 轻量探测本机回环页是否为 Antigravity 宿主窗口，过滤内置浏览器打开的第三方本地预览页（PR #57）
 */
async function probeAntigravityOrigin(origin, timeoutMs = 1200) {
  try {
    const html = await request(origin + '/', null, null, timeoutMs);
    return /window\.__APP_CONFIG__\s*=/.test(String(html || '')) ? 'antigravity' : 'other_http';
  } catch (err) {
    if (String(err?.message || '').startsWith('HTTP ')) {
      return 'other_http';
    }
    return 'unreachable';
  }
}

/**
 * 零依赖 RFC 6455 WebSocket 客户端（不发送 Origin 头，仅允许连接本机回环地址）
 */
function connectCdpWebSocket(wsUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(wsUrl);
    } catch {
      return reject(new Error(`Invalid WebSocket URL: ${wsUrl}`));
    }
    if (parsed.protocol !== 'ws:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')) {
      return reject(new Error('仅允许连接本机回环 CDP WebSocket 地址'));
    }
    const port = Number(parsed.port || 80);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return reject(new Error('无效的本机 CDP 端口'));
    }
    const host = '127.0.0.1';
    const reqPath = (parsed.pathname || '/') + (parsed.search || '');
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const socket = net.connect(port, host);
    const timeoutMs = options.timeoutMs || 5000;
    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    let closed = false;

    const listeners = { message: [], close: [], error: [] };
    const emit = (type, arg) => {
      for (const fn of listeners[type] || []) {
        try { fn(arg); } catch {}
      }
    };

    const timer = setTimeout(() => {
      if (!handshakeDone) {
        socket.destroy();
        reject(new Error('CDP WebSocket handshake timeout'));
      }
    }, timeoutMs);

    function sendFrame(opcode, payloadBuf) {
      if (closed || socket.destroyed) return;
      const mask = crypto.randomBytes(4);
      const len = payloadBuf.length;
      let header;
      if (len < 126) {
        header = Buffer.alloc(6);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | len;
        mask.copy(header, 2);
      } else if (len < 65536) {
        header = Buffer.alloc(8);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
        mask.copy(header, 4);
      } else {
        header = Buffer.alloc(14);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
        mask.copy(header, 10);
      }
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        masked[i] = payloadBuf[i] ^ mask[i & 3];
      }
      socket.write(Buffer.concat([header, masked]));
    }

    let fragmentedOpcode = 0;
    let fragmentedChunks = [];

    function processFrames() {
      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const secondByte = buffer[1];
        const fin = (firstByte & 0x80) !== 0;
        const opcode = firstByte & 0x0f;
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) return;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) return;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = isMasked ? 4 : 0;
        if (buffer.length < offset + maskLen + payloadLen) return;

        let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (isMasked) {
          const mask = buffer.subarray(offset, offset + 4);
          const unmasked = Buffer.alloc(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ mask[i & 3];
          }
          payload = unmasked;
        }
        buffer = buffer.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          closed = true;
          try { sendFrame(0x8, Buffer.alloc(0)); } catch {}
          socket.end();
          emit('close');
          return;
        } else if (opcode === 0x9) {
          sendFrame(0x0a, payload);
        } else if (opcode === 0x0a) {
          // Pong
        } else if (opcode === 0x1 || opcode === 0x2) {
          if (fin) {
            emit('message', { data: payload.toString('utf8') });
          } else {
            fragmentedOpcode = opcode;
            fragmentedChunks = [payload];
          }
        } else if (opcode === 0x0 && fragmentedOpcode !== 0) {
          fragmentedChunks.push(payload);
          if (fin) {
            const full = Buffer.concat(fragmentedChunks);
            fragmentedOpcode = 0;
            fragmentedChunks = [];
            emit('message', { data: full.toString('utf8') });
          }
        }
      }
    }

    const wsClient = {
      send(data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        sendFrame(0x1, buf);
      },
      close() {
        if (closed) return;
        closed = true;
        try { sendFrame(0x8, Buffer.alloc(0)); } catch {}
        socket.end();
        setTimeout(() => {
          if (!socket.destroyed) socket.destroy();
        }, 100).unref();
      },
      addEventListener(type, fn) {
        if (listeners[type]) listeners[type].push(fn);
      }
    };

    socket.on('connect', () => {
      const reqLines = [
        `GET ${reqPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n'
      ];
      socket.write(reqLines.join('\r\n'));
    });

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeDone) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerText = buffer.subarray(0, headerEnd).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4);
        clearTimeout(timer);

        const firstLine = headerText.split('\r\n')[0] || '';
        if (!firstLine.includes('101')) {
          socket.destroy();
          return reject(new Error(`CDP WebSocket handshake failed: ${firstLine}`));
        }
        const acceptMatch = headerText.match(/Sec-WebSocket-Accept:\s*([^\r\n]+)/i);
        if (!acceptMatch || acceptMatch[1].trim() !== expectedAccept) {
          socket.destroy();
          return reject(new Error('CDP WebSocket invalid Sec-WebSocket-Accept'));
        }
        handshakeDone = true;
        resolve(wsClient);
        if (buffer.length > 0) processFrames();
      } else {
        processFrames();
      }
    });

    socket.on('error', err => {
      clearTimeout(timer);
      if (!handshakeDone) reject(err);
      else emit('error', err);
    });

    socket.on('close', () => {
      clearTimeout(timer);
      closed = true;
      if (!handshakeDone) reject(new Error('CDP WebSocket closed before handshake completed'));
      else emit('close');
    });
  });
}

async function createCdpClient(wsUrl, options = {}) {
  const ws = await connectCdpWebSocket(wsUrl, options);
  let seq = 0;
  const pending = new Map();

  ws.addEventListener('message', event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg && msg.id && pending.has(msg.id)) {
        const item = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(item.timer);
        if (msg.error) {
          item.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          item.resolve(msg.result);
        }
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    for (const [, item] of pending) {
      clearTimeout(item.timer);
      item.reject(new Error('CDP connection closed'));
    }
    pending.clear();
  });

  return {
    ws,
    call(method, params = {}, callTimeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP call timeout: ${method}`));
          }
        }, callTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    evaluate(expression, opts = {}) {
      return this.call(
        'Runtime.evaluate',
        {
          expression,
          returnByValue: opts.returnByValue !== false,
          awaitPromise: opts.awaitPromise !== false
        },
        opts.timeoutMs || 8000
      );
    },
    async evaluateValue(expression, opts = {}) {
      const res = await this.evaluate(expression, opts);
      if (res && res.exceptionDetails) {
        const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'CDP eval exception';
        throw new Error(desc);
      }
      return res?.result?.value;
    },
    close() {
      ws.close();
    }
  };
}

function isIsolatedLocalApiOptions(options = {}) {
  return Boolean(
    (options && (options.appDataDir || options.homeDir || options.daemonDir || options.daemonDirs || options.platform)) ||
    process.env.AG_METER_TEST_MODE === '1'
  );
}

/**
 * 检查目标 PID 是否仍存活（EPERM 说明进程存在但无权发信号）。
 */
function defaultIsPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * 扫描 ~/.gemini/(antigravity|antigravity-ide)/daemon/*.json，返回存活进程对应的回环原点与 CSRF 凭据（按存活与 mtimeMs 降序）。
 */
function discoverLiveDaemonHubs(options = {}) {
  if (options?.allowDaemonFallback === false) return [];
  const inIsolatedTest = isIsolatedLocalApiOptions(options);
  if (inIsolatedTest && !options?.daemonDir && !options?.daemonDirs && !options?.homeDir) return [];
  const homeDir = options?.homeDir || os.homedir();
  const daemonDirs = Array.isArray(options?.daemonDirs) && options.daemonDirs.length
    ? options.daemonDirs
    : (options?.daemonDir
      ? [options.daemonDir]
      : ['antigravity', 'antigravity-ide'].map(dir => path.join(homeDir, '.gemini', dir, 'daemon')));
  const isPidAlive = typeof options?.isPidAlive === 'function' ? options.isPidAlive : defaultIsPidAlive;
  const requireAlivePid = options?.requireAlivePid !== false;
  const out = [];

  for (const dirPath of daemonDirs) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/\.json$/i.test(name)) continue;
      const fullPath = path.join(dirPath, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const csrfToken = typeof raw?.csrfToken === 'string' ? raw.csrfToken.trim() : '';
        const httpsPort = typeof raw?.httpsPort === 'number' && raw.httpsPort > 0 ? raw.httpsPort : null;
        const httpPort = typeof raw?.httpPort === 'number' && raw.httpPort > 0 ? raw.httpPort : null;
        if (!csrfToken) continue;
        const rawPid = raw?.pid;
        const pidNum = (rawPid != null && rawPid !== '') ? Number(rawPid) : NaN;
        const hasPid = Number.isInteger(pidNum) && pidNum > 0;
        const alive = hasPid ? isPidAlive(pidNum) : false;
        if (requireAlivePid && hasPid && !alive) continue;
        if (requireAlivePid && !hasPid && options?.allowPidless !== true) continue;
        const aliveRank = hasPid ? (alive ? 2 : 0) : 1;
        const httpsOrigin = httpsPort && httpsPort <= 65535
          ? normalizeLoopbackOrigin(`https://127.0.0.1:${httpsPort}`)
          : null;
        const httpOrigin = httpPort && httpPort <= 65535
          ? normalizeLoopbackOrigin(`http://127.0.0.1:${httpPort}`)
          : null;
        const primaryOrigin = httpsOrigin || httpOrigin;
        if (!primaryOrigin) continue;
        out.push({
          origin: primaryOrigin,
          httpsOrigin,
          httpOrigin,
          httpsPort: httpsOrigin ? httpsPort : null,
          httpPort: httpOrigin ? httpPort : null,
          csrfToken,
          pid: hasPid ? pidNum : null,
          aliveRank,
          filePath: fullPath,
          mtimeMs: Number(stat.mtimeMs) || 0
        });
      } catch {
        // 忽略损坏或正在写入的守护进程文件
      }
    }
  }
  out.sort((a, b) => (b.aliveRank - a.aliveRank) || (b.mtimeMs - a.mtimeMs) || ((b.httpsPort || 0) - (a.httpsPort || 0)));
  return out;
}

function loadHostAuthBootstrap(options = {}) {
  if (options?.authBootstrap === null) return null;
  const inIsolatedTest = isIsolatedLocalApiOptions(options);
  if (inIsolatedTest && !options?.authBootstrap) return null;
  let mod = options?.authBootstrap || null;
  if (!mod) {
    try {
      mod = require('./authBootstrap');
    } catch {
      return null;
    }
  }
  if (!mod || typeof mod !== 'object') return null;
  let activeOrigin = null;
  try {
    if (typeof mod.getActiveLsBaseUrl === 'function') {
      activeOrigin = normalizeLoopbackOrigin(mod.getActiveLsBaseUrl());
    }
  } catch {}
  if (!activeOrigin) {
    try {
      if (typeof mod.getActiveLsPort === 'function') {
        const port = Number(mod.getActiveLsPort());
        if (Number.isInteger(port) && port >= 1 && port <= 65535) {
          activeOrigin = normalizeLoopbackOrigin(`https://127.0.0.1:${port}`);
        }
      }
    } catch {}
  }
  let token = '';
  try {
    if (typeof mod.getActiveLsCsrfToken === 'function') {
      token = String(mod.getActiveLsCsrfToken() || '').trim();
    }
  } catch {}
  if (!activeOrigin || !token) return null;
  return { origin: activeOrigin, csrfToken: token };
}

function resolveAuthBootstrapForOrigin(rawOrigin, options = {}) {
  const safeOrigin = normalizeLoopbackOrigin(rawOrigin);
  if (!safeOrigin) return null;
  const auth = loadHostAuthBootstrap(options);
  if (!auth || auth.origin !== safeOrigin) return null;
  return auth.csrfToken;
}

function resolveDaemonHubForOrigin(rawOrigin, options = {}) {
  const safeOrigin = normalizeLoopbackOrigin(rawOrigin);
  if (!safeOrigin) return null;
  const hubs = discoverLiveDaemonHubs({ ...options, allowPidless: true });
  for (const hub of hubs) {
    if (hub.httpsOrigin === safeOrigin || hub.httpOrigin === safeOrigin) {
      return hub.csrfToken;
    }
  }
  return null;
}

function resolveOriginCsrfToken(rawOrigin, options = {}) {
  const safeOrigin = normalizeLoopbackOrigin(rawOrigin);
  if (!safeOrigin) return null;
  return resolveAuthBootstrapForOrigin(safeOrigin, options) || resolveDaemonHubForOrigin(safeOrigin, options) || null;
}

async function extractAppConfigViaCdp(page) {
  if (!page || !page.webSocketDebuggerUrl) return null;
  let client;
  try {
    client = await createCdpClient(page.webSocketDebuggerUrl, { timeoutMs: 3000 });
    const res = await client.call(
      'Runtime.evaluate',
      {
        expression:
          '(() => { try { const cfg = window.__APP_CONFIG__; const direct = typeof cfg?.csrfToken === "string" ? cfg.csrfToken.trim() : ""; let stored = ""; try { stored = String(window.localStorage?.getItem?.("agy_session_csrf_token") || "").trim(); } catch {} if (!cfg && !stored) return null; return { hasConfig: Boolean(cfg || stored), csrfToken: direct || stored }; } catch (e) { return null; } })()',
        returnByValue: true
      },
      3000
    );
    return res?.result?.value || null;
  } catch {
    return null;
  } finally {
    if (client) client.close();
  }
}

/**
 * 解析或实时提取指定本地页面原点的 CSRF Token 并构造 RPC 客户端（含 401/403 自动刷新单次重试）
 */
async function connectOrigin(rawOrigin, page = null, origins = null, extraMeta = {}, options = {}) {
  const origin = normalizeLoopbackOrigin(rawOrigin);
  if (!origin) {
    throw new Error('非法的本机回环页面地址');
  }
  const mergedMeta = { ...(extraMeta || {}), ...(options || {}) };

  const resolveAuth = async () => {
    let hasConfig = false;
    let token = '';
    let htmlFetchErr = null;
    try {
      const html = await request(origin + '/');
      const config = html.match(/window\.__APP_CONFIG__\s*=\s*(\{.*?\})\s*;/s);
      if (config) {
        hasConfig = true;
        const parsedCfg = JSON.parse(config[1]);
        token = typeof parsedCfg?.csrfToken === 'string' ? parsedCfg.csrfToken.trim() : '';
      }
    } catch (err) {
      htmlFetchErr = err;
    }

    if ((!hasConfig || !token) && page && page.webSocketDebuggerUrl) {
      const cdpCfg = await extractAppConfigViaCdp(page);
      if (cdpCfg && cdpCfg.hasConfig) {
        hasConfig = true;
        const cdpToken = typeof cdpCfg.csrfToken === 'string' ? cdpCfg.csrfToken.trim() : '';
        if (cdpToken) token = cdpToken;
      }
    }

    const canUseHostAuthFallback = !htmlFetchErr || /^HTTP 40[13]\b/.test(String(htmlFetchErr.message || ''));
    if (!token && canUseHostAuthFallback) {
      const bootstrapToken = resolveAuthBootstrapForOrigin(origin, mergedMeta);
      if (bootstrapToken) {
        token = bootstrapToken;
        hasConfig = true;
      }
    }
    if (!token && canUseHostAuthFallback) {
      const daemonToken = resolveDaemonHubForOrigin(origin, mergedMeta);
      if (daemonToken) {
        token = daemonToken;
        hasConfig = true;
      }
    }

    if (!hasConfig && !token && htmlFetchErr) {
      throw htmlFetchErr;
    }
    if (!hasConfig) {
      throw new Error('Antigravity 本地连接信息尚未就绪，请稍后重试');
    }
    if (!token) {
      throw new Error('Antigravity 本地鉴权信息尚未就绪，请稍后重试');
    }
    return token;
  };

  let activeToken = await resolveAuth();

  return {
    origin,
    origins: Array.isArray(origins) && origins.length ? origins : [origin],
    get csrfToken() {
      return activeToken;
    },
    page,
    ...(mergedMeta.port ? { port: mergedMeta.port } : {}),
    ...(Array.isArray(mergedMeta.pages) ? { pages: mergedMeta.pages } : {}),
    call: async (method, body) => {
      const endpoint = `${origin}/exa.language_server_pb.LanguageServerService/${method}`;
      try {
        return JSON.parse(await request(endpoint, body, activeToken));
      } catch (err) {
        if (/^HTTP 40[13]\b/.test(String(err?.message || ''))) {
          let refreshed = '';
          try {
            refreshed = await resolveAuth();
          } catch {}
          if (refreshed && refreshed !== activeToken) {
            activeToken = refreshed;
            return JSON.parse(await request(endpoint, body, activeToken));
          }
        }
        throw err;
      }
    },
    callStreamFirstFrame: (method, body, timeoutMs = 1500) =>
      requestConnectStreamFirstFrame(origin, method, body, activeToken, timeoutMs)
  };
}

/**
 * 扫描 ~/.gemini/(antigravity|antigravity-ide)/daemon/*.json 发现本地语言服务（保留向后兼容签名与 PID 无效时降级能力）。
 */
function discoverFromHubDaemonFiles(options = {}) {
  const candidates = discoverLiveDaemonHubs({
    ...options,
    requireAlivePid: false,
    allowPidless: true
  });
  for (const item of candidates) {
    let activeToken = item.csrfToken;
    return {
      origin: item.origin,
      origins: candidates.map(c => c.origin),
      get csrfToken() {
        return activeToken;
      },
      page: null,
      call: async (method, body) => {
        const endpoint = `${item.origin}/exa.language_server_pb.LanguageServerService/${method}`;
        try {
          return JSON.parse(await request(endpoint, body, activeToken));
        } catch (err) {
          if (/^HTTP 40[13]\b/.test(String(err?.message || ''))) {
            const refreshed = resolveOriginCsrfToken(item.origin, options);
            if (refreshed && refreshed !== activeToken) {
              activeToken = refreshed;
              return JSON.parse(await request(endpoint, body, activeToken));
            }
          }
          throw err;
        }
      },
      callStreamFirstFrame: (method, body, timeoutMs = 1500) =>
        requestConnectStreamFirstFrame(item.origin, method, body, activeToken, timeoutMs)
    };
  }
  return null;
}

async function connect(options = {}) {
  if (
    options &&
    options.origin !== undefined &&
    options.origin !== null &&
    String(options.origin).trim() !== ''
  ) {
    const explicitOrigin = normalizeLoopbackOrigin(options.origin);
    if (!explicitOrigin) {
      throw new Error('非法的本机回环页面地址');
    }
    return connectOrigin(explicitOrigin, null, [explicitOrigin], options);
  }

  let cdpPage = null;
  let cdpOrigin = '';
  let primaryErr = null;
  try {
    const { port, targets } = await resolveActiveCdpTarget({ timeoutMs: 2500 });
    const validTargets = Array.isArray(targets) ? targets.filter(item => item && normalizeLoopbackOrigin(item.url)) : [];
    if (!validTargets.length) throw new Error('Antigravity window not found');

    let candidatePages = validTargets;
    if (validTargets.length > 1) {
      const uniqueOrigins = Array.from(new Set(validTargets.map(item => normalizeLoopbackOrigin(item.url)).filter(Boolean)));
      const originKinds = new Map();
      await Promise.all(uniqueOrigins.map(async o => {
        originKinds.set(o, await probeAntigravityOrigin(o, 1200));
      }));
      const hasAntigravity = uniqueOrigins.some(o => originKinds.get(o) === 'antigravity');
      if (hasAntigravity) {
        const filtered = validTargets.filter(item => originKinds.get(normalizeLoopbackOrigin(item.url)) !== 'other_http');
        candidatePages = [
          ...filtered.filter(item => originKinds.get(normalizeLoopbackOrigin(item.url)) === 'antigravity'),
          ...filtered.filter(item => originKinds.get(normalizeLoopbackOrigin(item.url)) !== 'antigravity')
        ];
      }
    }

    cdpPage = candidatePages[0] || validTargets[0];
    cdpOrigin = normalizeLoopbackOrigin(cdpPage?.url) || '';
    const origins = Array.from(new Set(candidatePages.map(item => normalizeLoopbackOrigin(item.url)).filter(Boolean)));

    let lastErr = null;
    for (const cand of candidatePages) {
      const targetOrigin = normalizeLoopbackOrigin(cand?.url);
      if (!targetOrigin) continue;
      try {
        return await connectOrigin(targetOrigin, cand, origins, { ...options, port, pages: candidatePages });
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
  } catch (err) {
    primaryErr = err;
  }

  if (options?.strictPort !== true) {
    const bootstrapAuth = loadHostAuthBootstrap(options);
    if (bootstrapAuth && bootstrapAuth.origin) {
      try {
        return await connectOrigin(bootstrapAuth.origin, null, [bootstrapAuth.origin], options);
      } catch {}
    }
    const fallback = discoverFromHubDaemonFiles(options);
    if (fallback) {
      if (cdpPage && (!cdpOrigin || fallback.origin === cdpOrigin)) {
        return { ...fallback, page: cdpPage };
      }
      return fallback;
    }
  }

  throw primaryErr || new Error('Antigravity 本地连接信息尚未就绪，请稍后重试');
}

module.exports = {
  connect,
  connectOrigin,
  probeAntigravityOrigin,
  resolveOriginCsrfToken,
  resolveAuthBootstrapForOrigin,
  resolveDaemonHubForOrigin,
  discoverLiveDaemonHubs,
  discoverFromHubDaemonFiles,
  normalizeLoopbackOrigin,
  connectCdpWebSocket,
  createCdpClient,
  requestConnectStreamFirstFrame,
  request
};
