'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeWriteJsonSync, safeReadJsonSync } = require('../meter-storage');
const {
  detectProxyConfig,
  applyProxyEnvironment,
  buildCliProxyEnv,
  getProxyCandidatePaths,
  DEFAULT_NO_PROXY
} = require('../meter-proxy');
const {
  loadPricingLedger,
  savePricingLedger,
  recordModelCalls,
  savePluginSettings,
  getPluginSettings
} = require('../meter-collector');

test('safeWriteJsonSync: 正常保存、递归建目录与读回一致性', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-storage-test-'));
  try {
    const targetPath = path.join(tempDir, 'sub', 'nested', 'target.json');
    const data = { hello: 'world', count: 42, list: [1, 2, 3] };

    const writeRes = safeWriteJsonSync(targetPath, data);
    assert.equal(writeRes.ok, true);
    assert.equal(writeRes.path, path.resolve(targetPath));

    const readRes = safeReadJsonSync(targetPath);
    assert.equal(readRes.ok, true);
    assert.deepEqual(readRes.data, data);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeWriteJsonSync: 临时文件写入失败时正确返回错误并清理临时文件', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-storage-test-'));
  try {
    const targetPath = path.join(tempDir, 'target.json');
    const mockFs = {
      ...fs,
      writeFileSync(p, content, enc) {
        if (p.includes('.tmp')) {
          throw new Error('Disk full on write');
        }
        return fs.writeFileSync(p, content, enc);
      }
    };

    const writeRes = safeWriteJsonSync(targetPath, { key: 'val' }, { fs: mockFs });
    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.phase, 'write_temp');
    assert.match(writeRes.error, /Disk full on write/);
    assert.equal(fs.existsSync(targetPath), false);
    // 验证同目录下没有遗留 .tmp 文件
    const files = fs.readdirSync(tempDir);
    assert.equal(files.filter(f => f.endsWith('.tmp')).length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeWriteJsonSync: 重命名失败后原文件保持完整无损，且不退回覆盖', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-storage-test-'));
  try {
    const targetPath = path.join(tempDir, 'original.json');
    const originalData = { version: '1.0', important: 'do-not-lose-me' };
    fs.writeFileSync(targetPath, JSON.stringify(originalData), 'utf8');

    const mockFs = {
      ...fs,
      renameSync() {
        throw new Error('EPERM: operation not permitted');
      }
    };

    const newData = { version: '2.0', important: 'corrupted-if-overwritten' };
    const writeRes = safeWriteJsonSync(targetPath, newData, { fs: mockFs });

    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.phase, 'rename');
    assert.match(writeRes.error, /EPERM/);

    // 写入失败时保留原文件内容
    const preserved = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.deepEqual(preserved, originalData);

    // 验证临时文件已被清理
    const files = fs.readdirSync(tempDir);
    assert.equal(files.filter(f => f.endsWith('.tmp')).length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeWriteJsonSync: 校验失败时错误正确传播并区分前置与后置阶段', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-storage-test-'));
  try {
    const targetPath = path.join(tempDir, 'validate.json');
    fs.writeFileSync(targetPath, JSON.stringify({ initial: true }), 'utf8');

    // 1. 替换前校验失败 (pre_verify)
    const writeRes1 = safeWriteJsonSync(targetPath, { score: 5 }, {
      validate: (data) => data.score > 10
    });
    assert.equal(writeRes1.ok, false);
    assert.equal(writeRes1.phase, 'pre_verify');
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), { initial: true });

    // 2. 替换后校验失败 (post_verify)
    let hasRenamed = false;
    const mockFs = {
      ...fs,
      renameSync(src, dst) {
        hasRenamed = true;
        return fs.renameSync(src, dst);
      },
      readFileSync(p, enc) {
        if (hasRenamed && p === path.resolve(targetPath)) {
          return '{"score": 2}'; // 模拟被篡改或不合法
        }
        return fs.readFileSync(p, enc);
      }
    };

    const writeRes2 = safeWriteJsonSync(targetPath, { score: 20 }, {
      fs: mockFs,
      validate: (data) => data.score >= 10
    });
    assert.equal(writeRes2.ok, false);
    assert.equal(writeRes2.phase, 'post_verify');
    assert.match(writeRes2.error, /未通过业务规则/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadPricingLedger & recordModelCalls: 损坏文件隔离保护与拒绝空覆盖', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ledger-corrupt-'));
  try {
    const ledgerPath = path.join(tempDir, 'pricing_ledger_v1.json');
    fs.writeFileSync(ledgerPath, '{ invalid json truncated content...', 'utf8');

    // 1. 读取损坏账本：标记损坏，不伪装成空账本
    const ledger = loadPricingLedger(tempDir);
    assert.equal(ledger.__corrupted, true);

    // 验证损坏文件已被隔离备份
    const files = fs.readdirSync(tempDir);
    const corruptBaks = files.filter(f => f.includes('.corrupt.'));
    assert.equal(corruptBaks.length, 1);

    // 2. 尝试向损坏账本写入：拒绝空覆盖
    const call = {
      callId: 'call-safety-1',
      modelId: 'gemini-2.5-flash',
      outputTokens: 100,
      totalTokens: 120,
      status: 'final'
    };
    const recRes = recordModelCalls([call], { agDir: tempDir });
    assert.equal(recRes.ok, false);
    assert.equal(recRes.changed, false);
    assert.match(recRes.error, /账本已损坏/);

    // 验证原损坏文件没有被清空覆盖
    assert.equal(fs.readFileSync(ledgerPath, 'utf8').startsWith('{ invalid json'), true);

    // 3. 当备份文件存在且完好时，验证能自动从备份恢复
    const bakPath = path.join(tempDir, 'pricing_ledger_v1.bak.json');
    const goodData = { version: '1.0.0', updatedAt: '', calls: { 'call-from-bak': { outputTokens: 50 } } };
    fs.writeFileSync(bakPath, JSON.stringify(goodData), 'utf8');

    const recoveredLedger = loadPricingLedger(tempDir);
    assert.equal(recoveredLedger.__corrupted, undefined);
    assert.equal(recoveredLedger.calls['call-from-bak']?.outputTokens, 50);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('recordModelCalls: 保存失败时内存缓存不被污染', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cache-guard-'));
  try {
    // 将目标路径建为同名目录，使写入必定失败
    const ledgerPath = path.join(tempDir, 'pricing_ledger_v1.json');
    fs.mkdirSync(ledgerPath, { recursive: true });

    const call = {
      callId: 'call-cache-taint-1',
      modelId: 'gemini-2.5-flash',
      outputTokens: 50,
      status: 'final'
    };

    const recRes = recordModelCalls([call], { agDir: tempDir });
    assert.equal(recRes.ok, false);
    assert.equal(recRes.changed, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('savePluginSettings: 主配置成功但派生归档失败时返回明确的部分成功状态', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-settings-partial-'));
  try {
    // 构造损坏的 v2 归档文件
    const archivePathV2 = path.join(tempDir, 'token_usage_archive_v2.json');
    fs.writeFileSync(archivePathV2, '{{bad json archive!!', 'utf8');

    const payload = {
      customPlan: {
        country: 'JP',
        subscriptionRegion: 'Japan',
        currency: 'JPY'
      }
    };

    const res = savePluginSettings(payload, { targetDir: tempDir });
    // 主设置成功，归档回写遇到损坏文件，产生明确的部分成功状态
    assert.equal(res.ok, true);
    assert.equal(res.partial, true);
    assert.match(res.warning, /派生归档同步失败/);
    assert.equal(res.archiveSynced, false);

    // 验证主设置文件确实成功落盘
    const settingsPath = path.join(tempDir, 'custom_plan_v1.json');
    assert.equal(fs.existsSync(settingsPath), true);
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(saved.accounts.default.country, 'JP');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('meter-proxy: 统一配置探测、禁用与优先级解析', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-proxy-test-'));
  try {
    // 1. 候选路径应为绝对路径
    const candidates = getProxyCandidatePaths();
    for (const cand of candidates) {
      assert.ok(path.isAbsolute(cand));
    }

    // 2. 模拟配置生效
    const cfgPath = path.join(tempDir, 'proxy.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      enabled: true,
      httpProxy: 'http://127.0.0.1:7890',
      allProxy: 'socks5://127.0.0.1:7890',
      noProxy: 'localhost,127.0.0.1'
    }), 'utf8');

    const detected = detectProxyConfig({ candidates: [cfgPath] });
    assert.equal(detected.enabled, true);
    assert.equal(detected.httpProxy, 'http://127.0.0.1:7890');
    assert.equal(detected.allProxy, 'socks5://127.0.0.1:7890');

    // 3. 注入目标环境变量（已有变量优先）
    const targetEnv = { HTTP_PROXY: 'http://existing-proxy:8080' };
    applyProxyEnvironment(targetEnv, { candidates: [cfgPath] });
    assert.equal(targetEnv.HTTP_PROXY, 'http://existing-proxy:8080'); // 保持原有
    assert.equal(targetEnv.HTTPS_PROXY, 'http://127.0.0.1:7890'); // 自动补齐缺少的
    assert.equal(targetEnv.ALL_PROXY, 'socks5://127.0.0.1:7890');

    // 4. enabled: false 明确禁用
    const disabledCfg = path.join(tempDir, 'disabled.json');
    fs.writeFileSync(disabledCfg, JSON.stringify({
      enabled: false,
      httpProxy: 'http://127.0.0.1:9999'
    }), 'utf8');
    const detectDisabled = detectProxyConfig({ candidates: [disabledCfg] });
    assert.equal(detectDisabled.enabled, false);

    const emptyEnv = {};
    applyProxyEnvironment(emptyEnv, { candidates: [disabledCfg] });
    assert.equal(emptyEnv.HTTP_PROXY, undefined);

    // 5. buildCliProxyEnv 剥离 Electron 变量与 Windows 色彩支持
    const cliEnv = buildCliProxyEnv({ ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, { candidates: [cfgPath] });
    assert.equal(cliEnv.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(cliEnv.HTTPS_PROXY, 'http://127.0.0.1:7890');
    if (process.platform === 'win32') {
      assert.equal(cliEnv.NO_COLOR, undefined);
      assert.equal(cliEnv.TERM, 'xterm-256color');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PR #51 async file lock, PR #50 backup rotation, PR #36 incremental JSONL & PR #90 token-history revision', async () => {
  const { withFileLockAsync } = require('../meter-storage');
  const {
    listLedgerRepairBackups,
    pruneLedgerRepairBackups,
    cleanupUpgradeLedgerBackups,
    loadIncrementalTranscriptRecords,
    shouldSkipTokenHistoryRefresh,
    getTokenHistoryResponse,
    recordModelCallsAsync
  } = require('../meter-collector');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-sync-storage-'));
  try {
    // 1. PR #51 异步文件锁串行与 stale lock 自动回收
    const lockTarget = path.join(tmp, 'ledger.json');
    const staleLockFile = `${lockTarget}.lock`;
    fs.writeFileSync(staleLockFile, JSON.stringify({ pid: 99999999, nonce: 'stale', createdAtMs: Date.now() - 60000 }));
    const order = [];
    await Promise.all([
      withFileLockAsync(lockTarget, async () => {
        order.push('a-start');
        await new Promise(r => setTimeout(r, 20));
        order.push('a-end');
      }),
      withFileLockAsync(lockTarget, async () => {
        order.push('b-start');
        order.push('b-end');
      })
    ]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);

    // 2. PR #50 备份列表、裁剪与升级清理
    const ledgerPath = path.join(tmp, 'pricing_ledger_v1.json');
    fs.writeFileSync(ledgerPath, JSON.stringify({ version: '1.0.0', calls: {} }));
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(`${ledgerPath}.bak-pre-elv89-${1700000000000 + i}`, `{"idx":${i}}`);
    }
    assert.equal(listLedgerRepairBackups(ledgerPath).length, 5);
    const pruned = pruneLedgerRepairBackups(ledgerPath, { keep: 3 });
    assert.equal(pruned.keptCount, 3);
    assert.equal(pruned.removedCount, 2);
    const cleaned = cleanupUpgradeLedgerBackups({ ledgerPath, keep: 1, force: true });
    assert.equal(cleaned.keptCount, 1);

    // 3. recordModelCallsAsync 异步入账
    const asyncRec = await recordModelCallsAsync([{
      callId: 'async-call-1',
      model: 'MODEL_PLACEHOLDER_M532',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      status: 'final',
      created_at: '2026-11-25T10:00:00Z'
    }], { ledgerPath, useWorker: false, allowSynthetic: true });
    assert.equal(asyncRec.ok, true);
    assert.equal(asyncRec.changed, true);

    // 4. PR #36 增量 JSONL 读取与截断回退
    const jPath = path.join(tmp, 'session-1.jsonl');
    const ev1 = JSON.stringify({ callId: 'e1', model: 'MODEL_PLACEHOLDER_M532', input_tokens: 100, output_tokens: 50, created_at: '2026-11-25T10:00:00Z' });
    const ev2 = JSON.stringify({ callId: 'e2', model: 'MODEL_PLACEHOLDER_M532', input_tokens: 200, output_tokens: 60, created_at: '2026-11-25T10:01:00Z' });
    fs.writeFileSync(jPath, ev1 + '\n');
    const localCache = new Map();
    const r1 = loadIncrementalTranscriptRecords(jPath, fs.statSync(jPath), localCache);
    assert.equal(r1.mode, 'full');
    assert.equal(r1.records.length, 1);

    fs.appendFileSync(jPath, ev2 + '\n');
    const r2 = loadIncrementalTranscriptRecords(jPath, fs.statSync(jPath), localCache);
    assert.equal(r2.mode, 'incremental');
    assert.equal(r2.records.length, 2);

    fs.writeFileSync(jPath, ev2 + '\n');
    const r3 = loadIncrementalTranscriptRecords(jPath, fs.statSync(jPath), localCache);
    assert.equal(r3.mode, 'full');
    assert.equal(r3.records.length, 1);

    // 5. PR #90 /token-history revision 判重
    assert.equal(shouldSkipTokenHistoryRefresh({ force: false, knownRevision: 'rev1', revision: 'rev1', knownAccountKey: 'u@x', accountKey: 'u@x' }), true);
    assert.equal(shouldSkipTokenHistoryRefresh({ force: false, knownRevision: 'rev1', revision: 'rev1', knownAccountKey: 'u@x', accountKey: 'u@y' }), false);
    assert.equal(shouldSkipTokenHistoryRefresh({ force: true, knownRevision: 'rev1', revision: 'rev1', knownAccountKey: 'u@x', accountKey: 'u@x' }), false);
    assert.equal(typeof getTokenHistoryResponse, 'function');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
