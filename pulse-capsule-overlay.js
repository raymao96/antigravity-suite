/**
 * Antigravity 底部工具栏「本地权限 / Turbo」旁 3A 冷雾莫兰迪跑道胶囊上下文监控模块 (v1.3.1)
 * 运行环境：客户端渲染进程 Main World / 浏览器扩展 MAIN World (同源 Connect-RPC + React Fiber 精准会话隔离)
 */
(function () {
    const CAPSULE_VERSION = '1.6.5';
    if (window.__AGY_CTX_CAPSULE_ACTIVE__) {
        if (window.__AGY_CTX_CAPSULE_VERSION__ === CAPSULE_VERSION) return;
        try { window.__AGY_CTX_CAPSULE_DISPOSE__?.(); } catch {}
        window.__AGY_CTX_CAPSULE_ACTIVE__ = false;
    }

    // 网页端非 Antigravity 站点快速排除守卫 (避免在 Gmail / Google 搜索 / Cloud / Colab 等无关或敏感页面挂载钩子)
    const isElectronHost = typeof navigator !== 'undefined' && /Antigravity|Electron/i.test(navigator.userAgent || '');
    if (!isElectronHost && typeof location !== 'undefined') {
        const host = (location.hostname || '').toLowerCase();
        const excludedGoogleHosts = new Set([
            'www.google.com',
            'mail.google.com',
            'docs.google.com',
            'drive.google.com',
            'calendar.google.com',
            'meet.google.com',
            'maps.google.com',
            'photos.google.com',
            'play.google.com',
            'translate.google.com',
            'accounts.google.com',
            'myaccount.google.com',
            'pay.google.com',
            'admin.google.com',
            'console.cloud.google.com',
            'colab.research.google.com',
            'www.youtube.com',
            'music.youtube.com'
        ]);
        if (excludedGoogleHosts.has(host) && !/^\/(antigravity|jetski)(\/|$)/i.test(location.pathname || '')) {
            return;
        }
    }

    window.__AGY_CTX_CAPSULE_ACTIVE__ = true;
    window.__AGY_CTX_CAPSULE_VERSION__ = CAPSULE_VERSION;

    // 与顶栏保持一致的常态/预警语义色板
    const MORANDI_3A = {
        green: '#a78bfa',  // 回退默认主题紫（正常态优先读取全局主题强调色，浅色回退 #7c3aed）
        yellow: '#f59e0b', // 偏高预警 (已用 50%~80% / 剩余 20%~50%，与顶栏一致)
        red: '#ef4444'     // 高占用告急 (已用 >= 80% / 剩余 <= 20%，与顶栏一致)
    };
    const CAPSULE_STYLE_ID = '__agy_ctx_capsule_style__';

    const COMPRESSION_MIN_DROP = 5000; // 连续快照含缓存输入下降 > 5000 tokens 判定为自动压缩
    const DEFAULT_LIMIT = 256000;      // 基础保底压缩上限 256k
    const OFFICIAL_COMPRESSION_BUDGET = 512000; // 1M 物理窗口模型官方默认自动压缩线 512k
    const GPT_OSS_LIMIT = 131072;      // GPT-OSS 120B 模型上限 131072 (128Ki)
    const CLAUDE_55_LIMIT = 1000000;   // Claude 5.5 模型物理上下文上限 1M
    const GEMINI_4_LIMIT = 1048576;    // Gemini 4 / 3.8 Flash 模型物理上下文上限 1Mi (1048576)

    // 已知共享 5 小时配额池映射 (对齐官方 LanguageServer 配额池划分)
    const KNOWN_QUOTA_POOLS = {
        MODEL_PLACEHOLDER_M417: 'gemini',
        MODEL_PLACEHOLDER_M418: 'gemini',
        MODEL_PLACEHOLDER_M419: 'gemini',
        MODEL_PLACEHOLDER_M318: 'gemini',
        MODEL_PLACEHOLDER_M319: 'gemini',
        MODEL_PLACEHOLDER_M320: 'gemini',
        MODEL_PLACEHOLDER_M322: 'gemini',
        MODEL_PLACEHOLDER_M298: 'gemini',
        MODEL_PLACEHOLDER_M299: 'gemini',
        MODEL_PLACEHOLDER_M300: 'gemini',
        MODEL_PLACEHOLDER_M71: 'gemini',
        MODEL_PLACEHOLDER_M72: 'gemini',
        MODEL_PLACEHOLDER_M73: 'gemini',
        MODEL_PLACEHOLDER_M84: 'gemini',
        MODEL_PLACEHOLDER_M20: 'gemini',
        MODEL_PLACEHOLDER_M187: 'gemini',
        MODEL_PLACEHOLDER_M16: 'gemini',
        MODEL_PLACEHOLDER_M36: 'gemini',
        MODEL_PLACEHOLDER_M37: 'gemini',
        MODEL_PLACEHOLDER_M18: 'gemini',
        MODEL_PLACEHOLDER_M47: 'gemini',
        MODEL_PLACEHOLDER_M532: 'gemini',
        MODEL_PLACEHOLDER_M533: 'gemini',
        MODEL_PLACEHOLDER_M534: 'gemini',
        MODEL_PLACEHOLDER_M535: 'gemini',
        MODEL_PLACEHOLDER_M536: 'gemini',
        MODEL_PLACEHOLDER_M537: 'gemini',
        MODEL_PLACEHOLDER_M400: 'premium',
        MODEL_PLACEHOLDER_M401: 'premium',
        MODEL_PLACEHOLDER_M402: 'premium',
        MODEL_PLACEHOLDER_M403: 'premium',
        MODEL_PLACEHOLDER_M404: 'premium',
        MODEL_PLACEHOLDER_M405: 'premium',
        MODEL_PLACEHOLDER_M35: 'premium',
        MODEL_PLACEHOLDER_M26: 'premium',
        MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'premium'
    };

    // 状态缓存
    const sessionCache = new Map();     // cascadeId -> { stepCount, lastModifiedTime, status, steps, usage }
    const sniffedStepsMap = new Map();  // cascadeId -> steps[] (通过 fetch/XHR 旁路嗅探捕获的本地或云端步骤)
    const domStreamTracker = new Map(); // panelKey -> { lastTokens, lastTime, lastSpeed, avgTokensSum, avgDurSum }
    const availableModelsMap = new Map();      // normKey -> { modelId, displayName, maxTokens, maxOutputTokens }
    const sessionRuntimeBudgetMap = new Map(); // cascadeId -> { modelKey, maxContextTokens }
    const modelRuntimeBudgetMap = new Map();   // modelKey -> maxContextTokens
    const sessionRuntimeSpeedMap = new Map();  // cascadeId -> { tokPerSec, avgTokPerSec, lastDurationSec, timedOutTokensSum, timedDurationSum }
    const TPS_MIN_DURATION_SEC = 1.0;
    const TPS_MAX_DURATION_SEC = 600;
    const TPS_MIN_OUTPUT_TOKENS = 30;

    function parseDurationSec(raw) {
        if (raw == null) return 0;
        if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
        if (typeof raw === 'string') {
            const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
            if (!m) return 0;
            const val = Number(m[1]) || 0;
            return val > 0 ? (String(m[2] || '').toLowerCase() === 'ms' ? val / 1000 : val) : 0;
        }
        if (typeof raw === 'object') {
            const sec = Number(raw.seconds ?? raw.secs ?? 0) + Number(raw.nanos || 0) / 1e9;
            return Number.isFinite(sec) && sec > 0 ? sec : 0;
        }
        return 0;
    }

    function isValidTpsSample(outTok, durSec) {
        return Number(outTok) >= TPS_MIN_OUTPUT_TOKENS &&
            Number(durSec) >= TPS_MIN_DURATION_SEC &&
            Number(durSec) < TPS_MAX_DURATION_SEC;
    }

    function extractOutputTokens(usageObj) {
        if (!usageObj || typeof usageObj !== 'object') return 0;
        const direct = Math.max(0, parseInt(usageObj.outputTokens || usageObj.completionTokens || '0', 10) || 0);
        if (direct > 0) return direct;
        const think = Math.max(0, parseInt(usageObj.thinkingOutputTokens || '0', 10) || 0);
        const resp = Math.max(0, parseInt(usageObj.responseOutputTokens || '0', 10) || 0);
        return think + resp;
    }
    let trajectoriesMap = new Map();    // cascadeId -> summary
    let sniffedCsrfToken = '';
    let panelAutoIdCounter = 0;
    let userStatusCache = {
        fetchedAt: 0,
        planName: '',
        tierName: '',
        modelConfigs: []
    };
    let isPolling = false;
    let isFetchingUserStatus = false;
    let activeTooltipTarget = null;
    let tooltipEl = null;
    let engineActivated = false;

    // 有界缓存写入辅助函数：已存在键先删除以刷新顺序，超出 maxSize 时淘汰最早插入键
    function setBoundedMap(map, key, value, maxSize = 30) {
        if (!map) return;
        if (map.has(key)) {
            map.delete(key);
        }
        map.set(key, value);
        while (map.size > maxSize) {
            const oldestKey = map.keys().next().value;
            if (oldestKey === undefined && !map.has(undefined)) break;
            map.delete(oldestKey);
        }
    }

    // 语言模式：优先读取用户手动切换过的 localStorage，未设置时按系统 navigator.language 自动匹配 ('zh' | 'zh-TW' | 'en')
    function normalizeCapsuleLang(raw) {
        const s = String(raw || '').trim().toLowerCase();
        if (!s) return '';
        if (s === 'zh-tw' || s === 'zh-hant' || s === 'zh-hk' || s === 'tw' || s.startsWith('zh-tw-') || s.startsWith('zh-hant-')) return 'zh-TW';
        if (s === 'zh' || s === 'zh-cn' || s === 'zh-hans' || s === 'cn' || s.startsWith('zh-')) return 'zh';
        if (s.startsWith('en')) return 'en';
        return '';
    }

    function capTr(lang, zh, tw, en) {
        if (lang === 'en') return en;
        if (lang === 'zh-TW') return tw;
        return zh;
    }

    function getLangMode() {
        try {
            const saved = normalizeCapsuleLang(localStorage.getItem('__agy_ctx_lang__'))
                || normalizeCapsuleLang(localStorage.getItem('ag_suite_locale'));
            if (saved) return saved;
        } catch (e) {}
        try {
            const sysLang = (
                (typeof navigator !== 'undefined' && navigator.language) ||
                (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ||
                'zh-TW'
            );
            return normalizeCapsuleLang(sysLang) || 'en';
        } catch (e) {
            return 'zh-TW';
        }
    }

    function toggleLangMode() {
        try {
            const cur = getLangMode();
            const next = cur === 'en' ? 'zh-TW' : 'en';
            localStorage.setItem('__agy_ctx_lang__', next);
        } catch (e) {}
        renderAllFooters();
        if (activeTooltipTarget) {
            updateTooltipContent(activeTooltipTarget);
        }
    }

    // 格式化 Token 数字 (如 45231 -> "45.2k", 256000 -> "256k", 1000000 -> "1M")
    function formatTokenValue(value) {
        const safe = Math.max(0, Math.round(Number(value) || 0));
        if (safe >= 1000000) {
            return (safe / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (safe >= 1000) {
            return (safe / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return String(safe);
    }

    // 字符级 Token 估算：ASCII ~4 chars/token，非 ASCII (中文等) ~1.5 chars/token
    function estimateTokensFromText(text) {
        if (!text || typeof text !== 'string') return 0;
        let ascii = 0;
        let nonAscii = 0;
        const len = Math.min(text.length, 250000);
        for (let i = 0; i < len; i++) {
            if (text.charCodeAt(i) < 128) ascii++;
            else nonAscii++;
        }
        return Math.ceil(ascii / 4 + nonAscii / 1.5);
    }

    // 判断是否为后台影子模型或图片生成模型 (防篡改主对话模型与分母)
    function isShadowOrImageModel(modelId) {
        if (!modelId) return false;
        const s = String(modelId).toUpperCase();
        // M50 = Gemini Flash Lite 子智能体; M21 = Nano Banana 2 生图模型
        if (s.includes('_M50') || s === 'M50' || s.includes('FLASH_LITE')) return true;
        if (s.includes('_M21') || s === 'M21' || s.includes('IMAGE') || s.includes('BANANA')) return true;
        return false;
    }

    function toPositiveIntLimit(v) {
        if (v === null || v === undefined || v === '') return 0;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    }

    function normalizeModelKey(val) {
        const s = String(val || '').trim().toLowerCase();
        return s || '';
    }

    function getModelCandidateKeys(modelId, label) {
        const keys = [];
        const addKey = (raw) => {
            const k = normalizeModelKey(raw);
            if (!k) return;
            if (!keys.includes(k)) keys.push(k);
            const stripped = k.replace(/^model_placeholder_/, '').replace(/^model_/, '');
            if (stripped && !keys.includes(stripped)) keys.push(stripped);
            const mTag = k.match(/\b(m\d{2,4})\b/);
            if (mTag && !keys.includes(mTag[1])) keys.push(mTag[1]);
        };
        addKey(modelId);
        addKey(label);
        return keys;
    }

    function ingestAvailableModelsPayload(raw) {
        const modelsObj = raw?.response?.models || raw?.models || (raw && typeof raw === 'object' && !Array.isArray(raw) && !raw.userStatus ? raw : null);
        if (!modelsObj || typeof modelsObj !== 'object') return 0;
        let count = 0;
        const entries = Array.isArray(modelsObj)
            ? modelsObj.map(item => [item?.model || item?.modelId || item?.id || '', item])
            : Object.entries(modelsObj);
        for (const [entryKey, d] of entries) {
            if (!d || typeof d !== 'object') continue;
            const rawId = String(d.model || d.modelId || entryKey || '').trim();
            const displayName = typeof (d.displayName ?? d.label) === 'string' ? (d.displayName ?? d.label).trim() : '';
            const maxTokens = toPositiveIntLimit(d.maxTokens ?? d.max_tokens ?? d.contextWindow ?? d.maxContextTokens);
            const maxOutputTokens = toPositiveIntLimit(d.maxOutputTokens ?? d.max_output_tokens);
            if (!rawId && !displayName) continue;
            if (!maxTokens && !displayName) continue;
            const info = { modelId: rawId || displayName, displayName: displayName || rawId, maxTokens, maxOutputTokens };
            for (const key of getModelCandidateKeys(rawId, displayName)) {
                availableModelsMap.set(key, info);
            }
            for (const key of getModelCandidateKeys(entryKey, '')) {
                if (!availableModelsMap.has(key)) availableModelsMap.set(key, info);
            }
            count++;
        }
        return count;
    }

    function ingestUserStatusModelConfigs(configs) {
        if (!Array.isArray(configs)) return;
        for (const c of configs) {
            if (!c || typeof c !== 'object') continue;
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            const maxTokens = toPositiveIntLimit(c.maxTokens ?? c.max_tokens ?? c.contextWindow ?? c.maxContextTokens);
            if (!maxTokens || (!cid && !c.label)) continue;
            const info = { modelId: cid || c.label, displayName: c.label || cid, maxTokens, maxOutputTokens: toPositiveIntLimit(c.maxOutputTokens) };
            for (const key of getModelCandidateKeys(cid, c.label)) {
                if (!availableModelsMap.has(key) || !availableModelsMap.get(key).maxTokens) {
                    availableModelsMap.set(key, info);
                }
            }
        }
    }

    function extractMaxStepIndex(row) {
        if (!row || typeof row !== 'object') return -1;
        let maxIdx = -1;
        if (Array.isArray(row.stepIndices)) for (const v of row.stepIndices) if (Number.isFinite(Number(v)) && Number(v) > maxIdx) maxIdx = Math.trunc(Number(v));
        const single = row.stepIndex ?? row.step_index;
        return (single !== undefined && single !== null && Number.isFinite(Number(single))) ? Math.max(maxIdx, Math.trunc(Number(single))) : maxIdx;
    }

    function ingestGeneratorMetadataRows(rows, cascadeId) {
        if (!Array.isArray(rows) || rows.length === 0) return null;
        let lastTokPerSec = 0, lastDurationSec = 0, timedOutSum = 0, timedDurSum = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i], cm = row?.chatModel;
            if (!cm) continue;
            const streamDur = parseDurationSec(cm.streamingDuration ?? cm.durationSec ?? row?.streamingDuration);
            const outTok = extractOutputTokens(cm.usage || row?.usage || null);
            if (isValidTpsSample(outTok, streamDur)) {
                lastTokPerSec = Number((outTok / streamDur).toFixed(1)); lastDurationSec = Number(streamDur.toFixed(2));
                timedOutSum += outTok; timedDurSum += streamDur;
            }
        }
        if (cascadeId && timedDurSum > 0 && lastTokPerSec > 0) {
            const speedEntry = { tokPerSec: lastTokPerSec, avgTokPerSec: Number((timedOutSum / timedDurSum).toFixed(1)), lastDurationSec, timedOutTokensSum: timedOutSum, timedDurationSum: timedDurSum };
            setBoundedMap(sessionRuntimeSpeedMap, cascadeId, speedEntry, 40);
            const shortCid = normalizeCidKey(cascadeId);
            if (shortCid && shortCid !== cascadeId) setBoundedMap(sessionRuntimeSpeedMap, shortCid, speedEntry, 40);
        }
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i], cm = row?.chatModel;
            if (!cm) continue;
            const budget = toPositiveIntLimit(cm.chatStartMetadata?.contextWindowMetadata?.maxContextTokens);
            const turnKeys = getModelCandidateKeys(cm.model || cm.modelId || cm.responseModel || '', cm.modelDisplayName || '');
            const u = cm.usage || row.usage || {};
            let inTok = Math.max(0, parseInt(u.inputTokens ?? u.promptTokens ?? '0', 10) || 0);
            const cacheReadTok = Math.max(0, parseInt(u.cacheReadTokens ?? u.cachedTokens ?? '0', 10) || 0);
            const cacheCreateTok = Math.max(0, parseInt(u.cacheCreationTokens ?? '0', 10) || 0);
            const outTok = extractOutputTokens(u);
            let totalTokens = inTok + cacheReadTok + cacheCreateTok + outTok;
            if (!totalTokens && u.totalTokens !== undefined) {
                const totFb = Math.max(0, parseInt(u.totalTokens || '0', 10) || 0);
                if (totFb > 0) { inTok = totFb; totalTokens = totFb; }
            }
            const usageSignature = (inTok + cacheReadTok + cacheCreateTok + outTok) > 0 ? `${inTok}:${cacheReadTok}:${cacheCreateTok}:${outTok}` : '';
            const ttftSec = parseDurationSec(cm.timeToFirstToken), streamingSec = parseDurationSec(cm.streamingDuration);
            const durSec = (ttftSec > 0 && streamingSec > 0) ? Number((ttftSec + streamingSec).toFixed(2)) : (streamingSec > 0 ? Number(streamingSec.toFixed(2)) : (ttftSec > 0 ? Number(ttftSec.toFixed(2)) : 0));
            const speedDenom = streamingSec >= 1.0 ? streamingSec : (streamingSec === 0 && durSec >= 1.0 ? durSec : 0);
            const streamingTps = isValidTpsSample(outTok, speedDenom) ? Number((outTok / speedDenom).toFixed(1)) : 0;
            if (!budget && !streamingTps && !totalTokens) continue;
            const entry = {
                modelKey: turnKeys[0] || '', maxContextTokens: budget, streamingTps,
                ttftSec: ttftSec > 0 ? Number(ttftSec.toFixed(2)) : 0, streamingSec: streamingSec > 0 ? Number(streamingSec.toFixed(2)) : 0,
                durationSec: durSec, outputTokens: outTok, inputTokens: inTok, cacheReadTokens: cacheReadTok,
                cacheCreationTokens: cacheCreateTok, totalTokens, maxStepIndex: extractMaxStepIndex(row),
                createdAtMs: parseResetTimeMs(cm.chatStartMetadata?.createdAt || row.createdAt || ''), usageSignature
            };
            if (cascadeId) {
                setBoundedMap(sessionRuntimeBudgetMap, cascadeId, entry, 40);
                const shortCid = normalizeCidKey(cascadeId);
                if (shortCid && shortCid !== cascadeId) setBoundedMap(sessionRuntimeBudgetMap, shortCid, entry, 40);
            }
            if (budget > 0) for (const k of turnKeys) setBoundedMap(modelRuntimeBudgetMap, k, budget, 60);
            return entry;
        }
        return null;
    }

    function resolveCustomFixedContextLimit(modelId, label, explicitCustom = 0) {
        const direct = toPositiveIntLimit(explicitCustom);
        if (direct > 0) return direct;
        try {
            const cp = typeof window !== 'undefined' ? window.__AGContextMeterSettings?.customPlan : null;
            if (!cp || typeof cp !== 'object') return 0;
            if (cp.contextScopeMode !== 'per_model') {
                const uni = cp.contextUnifiedPreference;
                return (uni && uni.mode === 'fixed') ? (toPositiveIntLimit(uni.limitTokens) || 0) : 0;
            }
            const prefs = cp.contextPreferences;
            if (!prefs || typeof prefs !== 'object') return 0;
            const candKeys = getModelCandidateKeys(modelId, label);
            for (const [k, entry] of Object.entries(prefs)) {
                if (!entry || entry.mode !== 'fixed') continue;
                const lim = toPositiveIntLimit(entry.limitTokens);
                if (lim && candKeys.some(ck => getModelCandidateKeys(entry.modelId || k, entry.label || '').includes(ck))) return lim;
            }
        } catch (e) {}
        return 0;
    }

    function getFamilyPhysicalFallback(modelId, label) {
        const combined = ((modelId || '') + ' ' + (label || '')).toUpperCase();
        if (combined.includes('GPT_OSS') || combined.includes('GPT-OSS') || combined.includes('120B')) return GPT_OSS_LIMIT;
        if (combined.includes('CLAUDE') || combined.includes('OPUS') || combined.includes('SONNET')) return /5[._-]5|M400|M401|M402|M403|M404|M405/.test(combined) ? CLAUDE_55_LIMIT : 200000;
        if (combined.includes('GEMINI') || combined.includes('NEON') || combined.includes('CARBON') || combined.includes('ARGON') || combined.includes('HYDROGEN') || combined.includes('ORCHESTRATOR') || combined.includes('FLASH') || /M41[789]|M427|M43[78]|M52[5-8]|M53[2-7]|M667|M669|M681|M31[89]|M320/.test(combined)) return GEMINI_4_LIMIT;
        return DEFAULT_LIMIT;
    }

    // 获取纯模型物理上下文窗口上限 (绝不读取 modelRuntimeBudgetMap，不受 512k 运行时压缩线覆盖)
    function getPhysicalMaxTokensForModel(modelId, label, options = {}) {
        const candidateKeys = getModelCandidateKeys(modelId, label);
        const fiberMax = toPositiveIntLimit(options.fiberMaxTokens);
        if (fiberMax > 0) return fiberMax;
        for (const k of candidateKeys) {
            const info = availableModelsMap.get(k);
            if (info && info.maxTokens > 0) return info.maxTokens;
        }
        for (const c of userStatusCache.modelConfigs) {
            if (!c) continue;
            const cKeys = getModelCandidateKeys((c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId, c.label);
            if (candidateKeys.some(k => cKeys.includes(k))) {
                const mcMax = toPositiveIntLimit(c.maxTokens ?? c.max_tokens ?? c.contextWindow ?? c.maxContextTokens);
                if (mcMax > 0) return mcMax;
            }
        }
        return getFamilyPhysicalFallback(modelId, label);
    }

    // 根据模型 ID 或显示名称动态获取物理/能力上下文上限 (实测运行时预算 > 当前模型运行时记录 > 物理能力上限)
    function getContextLimitForModel(modelId, label, options = {}) {
        const candidateKeys = getModelCandidateKeys(modelId, label);
        const rtBudget = toPositiveIntLimit(options.runtimeBudget);
        if (rtBudget > 0 && (!candidateKeys.length || !options.runtimeModelKey || candidateKeys.includes(normalizeModelKey(options.runtimeModelKey)))) return rtBudget;
        for (const k of candidateKeys) {
            const observed = toPositiveIntLimit(modelRuntimeBudgetMap.get(k));
            if (observed > 0) return observed;
        }
        return getPhysicalMaxTokensForModel(modelId, label, { fiberMaxTokens: options.fiberMaxTokens });
    }

    // 统一主百分比分母：按实际压缩触发上限计算 (用户自定义固定阈值 > 会话/模型实测 maxContextTokens > 1M 模型官方 512K 压缩线 / 小窗口物理上限)
    function resolveCompressionBudgetForModel(modelId, label, options = {}) {
        const customFixed = resolveCustomFixedContextLimit(modelId, label, options.customLimitTokens);
        if (customFixed > 0) return customFixed;
        const candidateKeys = getModelCandidateKeys(modelId, label);
        const rtBudget = toPositiveIntLimit(options.runtimeBudget);
        if (rtBudget > 0 && (!candidateKeys.length || !options.runtimeModelKey || candidateKeys.includes(normalizeModelKey(options.runtimeModelKey)))) return rtBudget;
        for (const k of candidateKeys) {
            const observed = toPositiveIntLimit(modelRuntimeBudgetMap.get(k));
            if (observed > 0) return observed;
        }
        const physicalMax = getPhysicalMaxTokensForModel(modelId, label, { fiberMaxTokens: options.fiberMaxTokens });
        if (physicalMax > 0 && physicalMax < OFFICIAL_COMPRESSION_BUDGET) return physicalMax;
        if (physicalMax >= OFFICIAL_COMPRESSION_BUDGET) return OFFICIAL_COMPRESSION_BUDGET;
        return DEFAULT_LIMIT;
    }

    // 识别模型所属的 5 小时配额池 ('gemini' | 'premium' | '')
    function getQuotaPoolForModel(modelId, label) {
        if (modelId && KNOWN_QUOTA_POOLS[modelId]) {
            return KNOWN_QUOTA_POOLS[modelId];
        }
        const combined = ((modelId || '') + ' ' + (label || '')).toUpperCase();
        if (combined.includes('GEMINI') || combined.includes('NEON') || combined.includes('CARBON') || combined.includes('ARGON') || combined.includes('HYDROGEN') || combined.includes('ORCHESTRATOR') || combined.includes('FLASH')) {
            return 'gemini';
        }
        if (combined.includes('CLAUDE') || combined.includes('OPUS') || combined.includes('SONNET') || combined.includes('GPT') || combined.includes('OSS')) {
            return 'premium';
        }
        return '';
    }

    // 美化模型名称
    function resolveModelDisplayName(modelId, fallbackLabel) {
        if (fallbackLabel) return fallbackLabel;
        if (!modelId) return getLangMode() === 'en' ? 'Default Model' : '默认模型';
        const candKeys = getModelCandidateKeys(modelId, '');
        for (const k of candKeys) {
            const av = availableModelsMap.get(k);
            if (av?.displayName) return av.displayName;
        }
        for (const c of userStatusCache.modelConfigs) {
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            if (cid === modelId || c.modelId === modelId || c.model === modelId) {
                return c.label || modelId;
            }
        }
        const rawM = String(modelId);
        const m = rawM.toUpperCase();
        if (m.includes('M532')) return 'Gemini 4 Neon (High)';
        if (m.includes('M533')) return 'Gemini 4 Neon (Medium)';
        if (m.includes('M534')) return 'Gemini 4 Neon (Low)';
        if (m.includes('M535')) return 'Gemini 4 Neon (XHigh)';
        if (m.includes('M536')) return 'Gemini 4 Neon';
        if (m.includes('M537')) return 'Orchestrator (Neon)';
        if (m.includes('M667')) return 'Orchestrator (Carbon)';
        if (m.includes('M669')) return 'Gemini 4 Hydrogen (Orchestrator)';
        if (m.includes('M681')) return 'Orchestrator (Argon)';
        if (m.includes('M427')) return 'Gemini 4 Carbon (High)';
        if (m.includes('M437')) return 'Gemini 4 Carbon (Medium)';
        if (m.includes('M438')) return 'Gemini 4 Carbon (Low)';
        if (m.includes('M525')) return 'Gemini 4 Hydrogen (High)';
        if (m.includes('M526')) return 'Gemini 4 Hydrogen (Medium)';
        if (m.includes('M527')) return 'Gemini 4 Hydrogen (Low)';
        if (m.includes('M528')) return 'Gemini 4 Hydrogen (XHigh)';
        if (m.includes('M419')) return 'Gemini 4 Argon (Low)';
        if (m.includes('M418')) return 'Gemini 4 Argon (Medium)';
        if (m.includes('M417')) return 'Gemini 4 Argon (High)';
        if (m.includes('M320')) return 'Gemini 3.8 Flash (Low)';
        if (m.includes('M319')) return 'Gemini 3.8 Flash (Medium)';
        if (m.includes('M318')) return 'Gemini 3.8 Flash (High)';
        if (m.includes('M400')) return 'Claude Opus 5.5 (Low)';
        if (m.includes('M401')) return 'Claude Opus 5.5 (Medium)';
        if (m.includes('M402')) return 'Claude Opus 5.5 (High)';
        if (m.includes('M403')) return 'Claude Sonnet 5.5 (Low)';
        if (m.includes('M404')) return 'Claude Sonnet 5.5 (Medium)';
        if (m.includes('M405')) return 'Claude Sonnet 5.5 (High)';
        if (m.includes('M35')) return 'Claude Sonnet 4.6 (Thinking)';
        if (m.includes('M26')) return 'Claude Opus 4.6 (Thinking)';
        if (m.includes('GPT_OSS')) return 'GPT-OSS 120B (Medium)';
        return rawM.replace(/^MODEL_PLACEHOLDER_/, '').replace(/^MODEL_/, '');
    }

    // 归一化会话 ID 尾缀 (兼容本地 UUID 与云端 v1/default/jetski_remote_agents_3p/<uuid>)
    function normalizeCidKey(cid) {
        if (!cid || typeof cid !== 'string') return '';
        const trimmed = cid.trim();
        const parts = trimmed.split('/');
        return parts[parts.length - 1] || trimmed;
    }

    // 判断请求目标是否为同源 URL (支持 string / URL / Request 对象；相对路径或同 location.origin 返回 true)
    function isSameOriginUrl(input) {
        try {
            let rawUrl = '';
            if (typeof input === 'string') {
                rawUrl = input.trim();
            } else if (typeof URL !== 'undefined' && input instanceof URL) {
                rawUrl = input.href;
            } else if (input && typeof input === 'object') {
                if (typeof input.url === 'string') {
                    rawUrl = input.url.trim();
                } else if (typeof input.href === 'string') {
                    rawUrl = input.href.trim();
                }
            }
            if (!rawUrl) return false;
            if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl) && !rawUrl.startsWith('//')) {
                return true;
            }
            if (typeof location === 'undefined' || !location.origin || location.origin === 'null') {
                return false;
            }
            const resolved = new URL(rawUrl, location.href || location.origin);
            return resolved.origin === location.origin;
        } catch (e) {
            return false;
        }
    }

    // 安装无损网络旁路嗅探器：仅针对同源请求捕获本地与云端项目 (Remote Agent / Web 端) 的步骤、轨迹与配额响应
    function installNetworkSniffer() {
        if (window.__AGY_CTX_FETCH_SNIFFED__) return;
        window.__AGY_CTX_FETCH_SNIFFED__ = true;
        const origFetch = window.fetch;
        if (typeof origFetch !== 'function') return;

        window.fetch = async function (...args) {
            if (!isSameOriginUrl(args[0])) {
                return origFetch.apply(this, args);
            }

            let reqBodyCid = '';
            try {
                const init = args[1];
                if (init && init.headers) {
                    if (typeof init.headers.get === 'function') {
                        const t = init.headers.get('x-codeium-csrf-token');
                        if (t) sniffedCsrfToken = t;
                    } else if (typeof init.headers === 'object') {
                        const t = init.headers['x-codeium-csrf-token'] || init.headers['X-Codeium-Csrf-Token'];
                        if (t) sniffedCsrfToken = t;
                    }
                }
                if (init && typeof init.body === 'string' && init.body.length <= 65536 && init.body.startsWith('{')) {
                    const parsedReq = JSON.parse(init.body);
                    reqBodyCid = parsedReq.cascadeId || parsedReq.conversationId || parsedReq.id || '';
                }
            } catch (e) {}

            const resp = await origFetch.apply(this, args);
            try {
                const hasHeadersGet = Boolean(resp && resp.headers && typeof resp.headers.get === 'function');
                const ct = hasHeadersGet ? (resp.headers.get('content-type') || '') : '';
                const cl = hasHeadersGet ? resp.headers.get('content-length') : null;
                const clAllowed = cl === null || cl === undefined || cl === '' || Number(cl) <= 5 * 1024 * 1024;
                if (ct.toLowerCase().includes('application/json') && clAllowed) {
                    const clone = resp.clone();
                    clone.json().then((data) => {
                        if (!data || typeof data !== 'object') return;
                        // 1. 捕获 GetUserStatus 或模型配额列表与 GetAvailableModels 能力列表
                        const us = data.userStatus || (data.cascadeModelConfigData ? data : null);
                        if (us && us.cascadeModelConfigData && Array.isArray(us.cascadeModelConfigData.clientModelConfigs)) {
                            userStatusCache.fetchedAt = Date.now();
                            userStatusCache.modelConfigs = us.cascadeModelConfigData.clientModelConfigs;
                            ingestUserStatusModelConfigs(userStatusCache.modelConfigs);
                        }
                        if (data.models || data.response?.models) {
                            ingestAvailableModelsPayload(data);
                        }
                        if (Array.isArray(data.generatorMetadata)) {
                            ingestGeneratorMetadataRows(data.generatorMetadata, reqBodyCid);
                        }
                        // 2. 捕获会话摘要字典
                        if (data.trajectorySummaries && typeof data.trajectorySummaries === 'object') {
                            for (const [k, v] of Object.entries(data.trajectorySummaries)) {
                                trajectoriesMap.set(k, v);
                            }
                        }
                        // 3. 捕获本地或云端项目的轨迹步骤 (steps / trajectory.steps / messages / turns)
                        const stepsArr = Array.isArray(data.steps) ? data.steps
                            : (data.trajectory && Array.isArray(data.trajectory.steps) ? data.trajectory.steps
                            : (Array.isArray(data.turns) ? data.turns
                            : (Array.isArray(data.messages) ? data.messages : null)));
                        if (stepsArr && stepsArr.length > 0) {
                            const cid = data.cascadeId || data.conversationId || (data.trajectory && (data.trajectory.cascadeId || data.trajectory.conversationId)) || reqBodyCid || '__latest_sniffed__';
                            setBoundedMap(sniffedStepsMap, cid, stepsArr);
                            const shortKey = normalizeCidKey(cid);
                            if (shortKey && shortKey !== cid) {
                                setBoundedMap(sniffedStepsMap, shortKey, stepsArr);
                            }
                        }
                    }).catch(() => {});
                }
            } catch (e) {}
            return resp;
        };
    }

    // 获取当前页面同源 CSRF Token (支持 __APP_CONFIG__、v2.34+ agy_session_csrf_token 与网络嗅探回退)
    function getCsrfToken() {
        try {
            const direct = window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken;
            if (direct) {
                return direct;
            }
            const ls = localStorage.getItem('agy_session_csrf_token');
            if (ls) {
                return String(ls).trim();
            }
        } catch (e) {}
        return sniffedCsrfToken || '';
    }

    // 调用本地或同源 Connect-RPC 接口 (网页端无 csrfToken 时亦允许尝试携带同源 Cookie 请求)
    async function callLsRpc(method, body, timeoutMs = 6000) {
        const csrf = getCsrfToken();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1'
            };
            if (csrf) {
                headers['x-codeium-csrf-token'] = csrf;
            }
            const resp = await fetch('/exa.language_server_pb.LanguageServerService/' + method, {
                method: 'POST',
                headers,
                credentials: 'same-origin',
                body: JSON.stringify(body || {}),
                signal: ctrl.signal
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    // 刷新 GetUserStatus 与 GetAvailableModels 能力缓存
    async function refreshUserStatus(force = false) {
        const now = Date.now();
        if (!force && (isFetchingUserStatus || (now - userStatusCache.fetchedAt < 30000 && userStatusCache.modelConfigs.length > 0 && availableModelsMap.size > 0))) {
            return;
        }
        isFetchingUserStatus = true;
        try {
            const [usSet, availSet] = await Promise.allSettled([
                callLsRpc('GetUserStatus', { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } }),
                callLsRpc('GetAvailableModels', { forceRefresh: false })
            ]);
            const usResp = usSet.status === 'fulfilled' ? usSet.value : null;
            const availResp = availSet.status === 'fulfilled' ? availSet.value : null;
            if (availResp) {
                ingestAvailableModelsPayload(availResp);
            }
            if (usResp && usResp.userStatus) {
                const us = usResp.userStatus;
                userStatusCache.fetchedAt = Date.now();
                userStatusCache.planName = (us.planStatus && us.planStatus.planInfo && us.planStatus.planInfo.planName) || '';
                userStatusCache.tierName = (us.userTier && us.userTier.name) || '';
                userStatusCache.modelConfigs = (us.cascadeModelConfigData && us.cascadeModelConfigData.clientModelConfigs) || [];
                ingestUserStatusModelConfigs(userStatusCache.modelConfigs);
            }
        } catch (e) {
        } finally {
            isFetchingUserStatus = false;
        }
    }

    // 从步骤对象提取用于估算的文本内容 (与 meter-collector 及 isolated 视图保持 100% 同字段口径)
    function extractStepEstimateText(step) {
        if (!step || typeof step !== 'object') return '';
        const parts = [];
        const pushUniq = (s) => { if (typeof s === 'string' && s && !parts.includes(s)) parts.push(s); };
        const pushCalls = (list) => {
            if (!Array.isArray(list)) return;
            for (const tc of list) {
                if (!tc) continue;
                const args = tc.argumentsJson ?? tc.arguments ?? tc.args ?? (tc.function && tc.function.arguments);
                pushUniq(typeof args === 'string' ? args : (args && typeof args === 'object' ? JSON.stringify(args) : ''));
            }
        };
        try {
            if (step.checkpoint && typeof step.checkpoint === 'object') {
                const cpSum = step.checkpoint.sessionSummary || step.checkpoint.summary || '';
                if (typeof cpSum === 'string' && cpSum) parts.push(cpSum);
            } else if (/CHECKPOINT/i.test(String(step.type || ''))) {
                const topSum = step.sessionSummary || step.summary || '';
                if (typeof topSum === 'string' && topSum) parts.push(topSum);
            }
            if (step.userInput) {
                const ui = step.userInput;
                if (typeof ui.userResponse === 'string' && ui.userResponse) parts.push(ui.userResponse);
                if (typeof ui.text === 'string' && ui.text && ui.text !== ui.userResponse) parts.push(ui.text);
                if (Array.isArray(ui.items)) for (const it of ui.items) pushUniq(it && it.text);
            }
            if (step.plannerResponse) {
                const pr = step.plannerResponse;
                const mainResp = (typeof pr.modifiedResponse === 'string' && pr.modifiedResponse) ? pr.modifiedResponse : (typeof pr.response === 'string' ? pr.response : '');
                if (mainResp) parts.push(mainResp);
                if (typeof pr.thinking === 'string' && pr.thinking) parts.push(pr.thinking);
                if (typeof pr.text === 'string' && pr.text && pr.text !== mainResp) parts.push(pr.text);
                pushCalls(pr.toolCalls);
            }
            pushUniq(step.metadata && step.metadata.toolCall && step.metadata.toolCall.argumentsJson);
            if (typeof step.content === 'string' && step.content) parts.push(step.content);
            else if (Array.isArray(step.content)) {
                for (const c of step.content) {
                    if (typeof c === 'string' && c) parts.push(c);
                    else if (c && typeof c.text === 'string' && c.text) parts.push(c.text);
                }
            }
            for (const k of ['text', 'thinking', 'response', 'message']) pushUniq(step[k]);
            pushCalls(step.toolCalls || step.tool_calls);
        } catch (e) {}
        return parts.join('\n');
    }

    function hasValidUsageFields(mu) {
        return Boolean(mu && typeof mu === 'object' && (
            mu.inputTokens !== undefined || mu.promptTokens !== undefined || mu.cacheReadTokens !== undefined || mu.cachedTokens !== undefined ||
            mu.cacheCreationTokens !== undefined || mu.outputTokens !== undefined || mu.completionTokens !== undefined || mu.totalTokens !== undefined
        ));
    }

    // 核心计算函数：精确快照 + 字符级尾差估算 + 云端无 modelUsage 步骤自适应测速与容量拆解
    function analyzeSteps(steps, preferredModelId, preferredModelLabel, totalStepCount, extraLimits = {}) {
        let baseTokens = 0;
        let inputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        let outputTokens = 0;
        let estimatedDelta = 0;
        let estInputSum = 0;
        let estOutputSum = 0;
        let prevCacheInclusiveInput = 0;
        let maxPriorCacheRead = 0;
        let compressionDetected = false;
        let compressionBefore = 0;
        let compressionAfter = 0;
        let compressionDrop = 0;
        let activeModelId = preferredModelId || '';
        let shadowModelId = '';
        let hasPreciseSnapshot = false;
        let lastTokPerSec = 0;
        let lastDurationSec = 0;
        let lastTtftSec = 0;
        let timedOutTokensSum = 0;
        let timedDurationSum = 0;
        let stepObservedLimit = 0;
        let stepObservedPhysicalMax = 0;
        let stepObservedModelKey = '';
        let lastCheckpointStepIdx = -1;
        let lastCheckpointAtMs = 0;
        let lastPlannerStepIdx = -1;
        let lastPlannerUsageSig = '';
        let plannerTurnCount = 0;
        let lastUsageStepIdx = -1;
        let latestStepTimeMs = 0;
        const preCheckpointUsageSigs = new Set();
        const postCheckpointUsageSigs = new Set();
        const priorPlannerUsageSigs = new Set();
        const estEntries = [];

        if (Array.isArray(steps)) {
            for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
                const st = steps[stepIdx];
                if (!st || typeof st !== 'object') continue;
                const meta = st.metadata || st;
                const mu = meta.modelUsage || st.modelUsage || (st.checkpoint && (st.checkpoint.modelUsage || st.checkpoint.usage)) || (meta.checkpoint && (meta.checkpoint.modelUsage || meta.checkpoint.usage)) || st.usage || null;
                const stepModel = (mu && (mu.model || mu.modelId)) || meta.generatorModel || st.model || '';
                const stepRuntimeBudget = toPositiveIntLimit(meta.chatStartMetadata?.contextWindowMetadata?.maxContextTokens ?? st.chatStartMetadata?.contextWindowMetadata?.maxContextTokens ?? mu?.maxContextTokens);
                const stepPhysMax = toPositiveIntLimit(meta.modelInfo?.maxTokens ?? meta.model_info?.max_tokens);
                if (stepRuntimeBudget > 0 && (!stepModel || !isShadowOrImageModel(stepModel))) {
                    stepObservedLimit = stepRuntimeBudget;
                    const smKey = normalizeModelKey(stepModel || activeModelId);
                    if (smKey) stepObservedModelKey = smKey;
                }
                if (stepPhysMax > 0 && (!stepModel || !isShadowOrImageModel(stepModel))) stepObservedPhysicalMax = stepPhysMax;
                const stepTimeMs = parseResetTimeMs(meta.finishedGeneratingAt || meta.completedAt || meta.updatedAt || meta.createdAt || meta.created_at || st.finishedGeneratingAt || st.completedAt || st.updatedAt || st.createdAt || st.created_at);
                if (stepTimeMs > latestStepTimeMs) latestStepTimeMs = stepTimeMs;

                const isCheckpoint = Boolean(st.checkpoint && typeof st.checkpoint === 'object') || /CHECKPOINT/i.test(String(st.type || ''));
                if (isCheckpoint) {
                    if (lastPlannerUsageSig) priorPlannerUsageSigs.add(lastPlannerUsageSig);
                    lastPlannerUsageSig = '';
                    for (const sig of postCheckpointUsageSigs) preCheckpointUsageSigs.add(sig);
                    postCheckpointUsageSigs.clear();
                    lastCheckpointStepIdx = stepIdx;
                    if (stepTimeMs > 0) lastCheckpointAtMs = stepTimeMs;
                    lastTokPerSec = 0; lastDurationSec = 0; lastTtftSec = 0; timedOutTokensSum = 0; timedDurationSum = 0;
                }

                // 尝试从用户输入配置中识别初始选中的模型
                if (!activeModelId && st.userInput && st.userInput.userConfig && st.userInput.userConfig.plannerConfig) {
                    const pc = st.userInput.userConfig.plannerConfig;
                    const userPicked = pc.planModel || pc.modelName || (pc.requestedModel && pc.requestedModel.model) || '';
                    if (userPicked && !isShadowOrImageModel(userPicked)) {
                        activeModelId = userPicked;
                    }
                }

                if (hasValidUsageFields(mu)) {
                    if (isShadowOrImageModel(stepModel)) {
                        shadowModelId = stepModel;
                        // 非 CHECKPOINT 子代理影子步骤直接忽略；若 CHECKPOINT 摘要由影子模型生成，则继续落入下方摘要估算以废弃压缩前旧值
                        if (!isCheckpoint) continue;
                    } else {
                        let inTok = Math.max(0, parseInt(mu.inputTokens ?? mu.promptTokens ?? '0', 10) || 0);
                        const cacheRead = Math.max(0, parseInt(mu.cacheReadTokens ?? mu.cachedTokens ?? '0', 10) || 0);
                        const cacheCreate = Math.max(0, parseInt(mu.cacheCreationTokens ?? '0', 10) || 0);
                        const outTok = extractOutputTokens(mu);
                        let cacheInclusiveInput = inTok + cacheRead + cacheCreate;
                        let snapshotTotal = cacheInclusiveInput + outTok;
                        if (snapshotTotal === 0 && mu.totalTokens !== undefined) {
                            const totFallback = Math.max(0, parseInt(mu.totalTokens || '0', 10) || 0);
                            if (totFallback > 0) {
                                inTok = totFallback;
                                cacheInclusiveInput = totFallback;
                                snapshotTotal = totFallback;
                            }
                        }
                        if (!isCheckpoint) {
                            const stepSig = snapshotTotal > 0 ? `${inTok}:${cacheRead}:${cacheCreate}:${outTok}` : '';
                            if (lastPlannerUsageSig) priorPlannerUsageSigs.add(lastPlannerUsageSig);
                            if (stepSig) {
                                if (lastCheckpointStepIdx >= 0) postCheckpointUsageSigs.add(stepSig);
                                else preCheckpointUsageSigs.add(stepSig);
                            }
                            plannerTurnCount += 1;
                            lastPlannerStepIdx = stepIdx;
                            lastPlannerUsageSig = stepSig;
                            lastTokPerSec = 0;
                            lastDurationSec = 0;
                            lastTtftSec = 0;
                            // 优先按纯流式输出时长计算 tok/s (无流式时长时回退端到端总时长，过滤 <1.0s 或 <30 outTok 短窗噪音)
                            const streamSec = parseDurationSec(meta.streamingDuration ?? st.streamingDuration ?? st.chatModel?.streamingDuration ?? mu.streamingDuration ?? meta.durationSec);
                            const ttftSec = parseDurationSec(meta.timeToFirstToken ?? st.timeToFirstToken ?? mu.timeToFirstToken);
                            const tStart = parseResetTimeMs(meta.createdAt || meta.created_at || meta.startedAt || st.createdAt || st.created_at);
                            const tEndRaw = meta.finishedGeneratingAt || meta.completedAt || meta.updatedAt || st.finishedGeneratingAt || st.completedAt || st.updatedAt || meta.viewableAt || '';
                            const tEnd = parseResetTimeMs(tEndRaw);
                            const wallDurSec = (tStart > 0 && tEnd > tStart) ? (tEnd - tStart) / 1000 : 0;
                            const totalDurSec = (ttftSec > 0 && streamSec > 0) ? (ttftSec + streamSec) : (wallDurSec > 0 ? wallDurSec : streamSec);
                            const speedDenom = streamSec >= 1.0 ? streamSec : (streamSec === 0 && totalDurSec >= 1.0 ? totalDurSec : 0);
                            if (isValidTpsSample(outTok, speedDenom)) {
                                lastTokPerSec = Number((outTok / speedDenom).toFixed(1));
                                lastDurationSec = Number((totalDurSec || speedDenom).toFixed(2));
                                lastTtftSec = ttftSec > 0 ? Number(ttftSec.toFixed(2)) : 0;
                                timedOutTokensSum += outTok;
                                timedDurationSum += speedDenom;
                            }
                        }

                        if (snapshotTotal > 0) {
                            if (isCheckpoint || (prevCacheInclusiveInput > 0 && (prevCacheInclusiveInput - cacheInclusiveInput) > COMPRESSION_MIN_DROP)) {
                                const priorTotal = (baseTokens + estimatedDelta) || prevCacheInclusiveInput;
                                compressionDetected = true;
                                compressionBefore = priorTotal > snapshotTotal ? priorTotal : compressionBefore;
                                compressionAfter = snapshotTotal;
                                compressionDrop = Math.max(0, compressionBefore - snapshotTotal);
                                maxPriorCacheRead = 0;
                            } else if (hasPreciseSnapshot) {
                                maxPriorCacheRead = Math.max(maxPriorCacheRead, cacheReadTokens);
                            }
                            prevCacheInclusiveInput = cacheInclusiveInput;
                            baseTokens = snapshotTotal; inputTokens = inTok; cacheReadTokens = cacheRead; cacheCreationTokens = cacheCreate; outputTokens = outTok;
                            estimatedDelta = 0; estInputSum = 0; estOutputSum = 0; estEntries.length = 0; lastUsageStepIdx = stepIdx; hasPreciseSnapshot = true;
                            if (stepModel && !preferredModelId) activeModelId = stepModel;
                            continue;
                        }
                    }
                }

                // CHECKPOINT 压缩步骤（仅当缺少有效压缩后 modelUsage 时才使用摘要基线估算）
                if (isCheckpoint) {
                    const summaryTok = estimateTokensFromText(extractStepEstimateText(st)), sysBase = 12500, compactedTotal = sysBase + summaryTok;
                    const priorTotal = (baseTokens + estimatedDelta) || prevCacheInclusiveInput;
                    compressionDetected = true;
                    if (priorTotal > compactedTotal) { compressionBefore = priorTotal; compressionDrop = priorTotal - compactedTotal; }
                    compressionAfter = compactedTotal; baseTokens = compactedTotal; inputTokens = summaryTok; cacheReadTokens = sysBase;
                    cacheCreationTokens = 0; outputTokens = 0; estimatedDelta = 0; estInputSum = 0; estOutputSum = 0;
                    estEntries.length = 0; lastUsageStepIdx = stepIdx; prevCacheInclusiveInput = compactedTotal; maxPriorCacheRead = 0; hasPreciseSnapshot = true;
                    continue;
                }

                // 快照之后的步骤 (或云端无 modelUsage 的步骤) 累加字符级估算并测速
                const stepType = String(st.type || st.role || (st.plannerResponse ? 'PLANNER_RESPONSE' : (st.userInput ? 'USER_INPUT' : ''))).toUpperCase();
                const isPlanner = stepType.includes('PLANNER') || stepType.includes('MODEL') || stepType.includes('ASSISTANT') || Boolean(st.plannerResponse);
                if (isPlanner) {
                    if (lastPlannerUsageSig) priorPlannerUsageSigs.add(lastPlannerUsageSig);
                    plannerTurnCount += 1;
                    lastPlannerStepIdx = stepIdx; lastPlannerUsageSig = ''; lastTokPerSec = 0; lastDurationSec = 0; lastTtftSec = 0;
                }
                const estText = extractStepEstimateText(st);
                if (estText) {
                    const stepTok = estimateTokensFromText(estText);
                    estimatedDelta += stepTok;
                    estEntries.push({ relIdx: stepIdx, tok: stepTok, isPlanner });
                    if (isPlanner) {
                        estOutputSum += stepTok;
                        const tStart = parseResetTimeMs(meta.createdAt || meta.created_at || meta.startedAt || st.createdAt || st.created_at);
                        const tEnd = parseResetTimeMs(meta.finishedGeneratingAt || meta.completedAt || meta.updatedAt || st.finishedGeneratingAt || st.completedAt || st.updatedAt);
                        const durSec = (tStart > 0 && tEnd > tStart) ? (tEnd - tStart) / 1000 : 0;
                        if (stepTok > 5 && durSec >= 0.2 && durSec < 600) {
                            lastTokPerSec = Number((stepTok / durSec).toFixed(1)); lastDurationSec = Number(durSec.toFixed(2));
                            timedOutTokensSum += stepTok; timedDurationSum += durSec;
                        }
                    } else {
                        estInputSum += stepTok;
                    }
                }
            }
        }

        const baseStepOffset = Math.max(0, Math.trunc(Number(extraLimits?.baseStepOffset || 0) || 0));
        const absCheckpointStepIdx = lastCheckpointStepIdx >= 0 ? (baseStepOffset + lastCheckpointStepIdx) : -1;
        let absLastPlannerStepIdx = lastPlannerStepIdx >= 0 ? (baseStepOffset + lastPlannerStepIdx) : -1;
        let absLastUsageStepIdx = lastUsageStepIdx >= 0 ? (baseStepOffset + lastUsageStepIdx) : -1;

        // 若 GeneratorMetadata 已返回晚于 CHECKPOINT 且晚于步骤内 modelUsage 的实报快照（或非压缩场景下仅 GeneratorMetadata 提供用量），立即采用实报
        const gmUsageStep = typeof extraLimits?.generatorUsageMaxStepIndex === 'number' ? extraLimits.generatorUsageMaxStepIndex : -1;
        const gmTotalTok = Number(extraLimits?.generatorTotalTokens || 0) || 0;
        const adoptIndexedGm = gmUsageStep >= 0 && gmTotalTok > 0 && gmUsageStep > absCheckpointStepIdx && gmUsageStep > absLastUsageStepIdx;
        const adoptUnindexedGmOnly = gmUsageStep < 0 && absCheckpointStepIdx < 0 && !hasPreciseSnapshot && gmTotalTok > 0;
        if (adoptIndexedGm || adoptUnindexedGmOnly) {
            baseTokens = gmTotalTok; inputTokens = Number(extraLimits.generatorInputTokens || 0) || 0;
            cacheReadTokens = Number(extraLimits.generatorCacheReadTokens || 0) || 0;
            cacheCreationTokens = Number(extraLimits.generatorCacheCreationTokens || 0) || 0;
            outputTokens = Number(extraLimits.generatorUsageOutputTokens || 0) || 0;
            hasPreciseSnapshot = true;
            if (adoptIndexedGm) {
                absLastUsageStepIdx = gmUsageStep;
                if (gmUsageStep > absLastPlannerStepIdx) absLastPlannerStepIdx = gmUsageStep;
                if (absCheckpointStepIdx >= 0) compressionDetected = false;
                estimatedDelta = 0; estInputSum = 0; estOutputSum = 0;
                for (const e of estEntries) {
                    if ((baseStepOffset + e.relIdx) > gmUsageStep) {
                        estimatedDelta += e.tok;
                        if (e.isPlanner) estOutputSum += e.tok; else estInputSum += e.tok;
                    }
                }
            } else {
                estimatedDelta = 0; estInputSum = 0; estOutputSum = 0;
            }
        }

        // 若 GeneratorMetadata 提供最新轮纯流式速度且不早于 CHECKPOINT 及最新回复步骤，按同一轮整体对齐速度与耗时
        const gmTps = Number(extraLimits?.generatorStreamingTps || 0);
        const gmMaxStep = typeof extraLimits?.generatorMaxStepIndex === 'number' ? extraLimits.generatorMaxStepIndex : -1;
        const gmCreatedMs = Number(extraLimits?.generatorCreatedAtMs || 0);
        const gmUsageSig = extraLimits?.generatorUsageSignature || '';
        const gmMatchesPostUsage = Boolean(gmUsageSig && postCheckpointUsageSigs.has(gmUsageSig) && !preCheckpointUsageSigs.has(gmUsageSig));
        const gmPredatesCheckpoint = absCheckpointStepIdx >= 0 && (
            gmMaxStep >= 0 ? gmMaxStep <= absCheckpointStepIdx : ((gmCreatedMs > 0 && lastCheckpointAtMs > 0) ? gmCreatedMs <= lastCheckpointAtMs : !gmMatchesPostUsage)
        );
        const lastPlannerSignatureUnique = Boolean(lastPlannerUsageSig && !priorPlannerUsageSigs.has(lastPlannerUsageSig));
        const canAdoptUnindexedSingleTurnGm = Boolean(absCheckpointStepIdx < 0 && lastUsageStepIdx < 0 && plannerTurnCount === 1);
        const gmProvenLatestUnindexed = lastPlannerUsageSig
            ? Boolean(lastPlannerSignatureUnique && gmUsageSig && gmUsageSig === lastPlannerUsageSig)
            : canAdoptUnindexedSingleTurnGm;
        const gmNotBehindPlanner = absLastPlannerStepIdx < 0
            ? true : (gmMaxStep >= 0 ? gmMaxStep >= absLastPlannerStepIdx : gmProvenLatestUnindexed);
        if (gmTps > 0 && !gmPredatesCheckpoint && gmNotBehindPlanner) {
            const sameTurn = (gmMaxStep >= 0 && gmMaxStep === absLastPlannerStepIdx) || Boolean(lastPlannerSignatureUnique && gmUsageSig && gmUsageSig === lastPlannerUsageSig);
            lastTokPerSec = gmTps;
            lastDurationSec = extraLimits?.generatorDurationSec > 0 ? extraLimits.generatorDurationSec : (sameTurn ? lastDurationSec : 0);
            lastTtftSec = extraLimits?.generatorTtftSec > 0 ? extraLimits.generatorTtftSec : (sameTurn ? lastTtftSec : 0);
            if (extraLimits?.generatorOutputTokens > 0 && (!sameTurn || outputTokens === 0)) outputTokens = extraLimits.generatorOutputTokens;
        }

        const actualStepCount = totalStepCount || (Array.isArray(steps) ? steps.length : 0);
        if (!hasPreciseSnapshot && (estimatedDelta > 0 || actualStepCount > 0)) {
            const sysPromptOverhead = actualStepCount > 0 ? 12500 : 0, totalEst = sysPromptOverhead + estimatedDelta;
            baseTokens = totalEst; estimatedDelta = 0; cacheReadTokens = Math.round(sysPromptOverhead + estInputSum * 0.75);
            inputTokens = Math.max(0, totalEst - cacheReadTokens - estOutputSum); outputTokens = estOutputSum; hasPreciseSnapshot = totalEst > 0;
        }

        const rtBudget = toPositiveIntLimit(extraLimits?.runtimeBudget) || stepObservedLimit || 0;
        const rtModelKey = extraLimits?.runtimeModelKey || stepObservedModelKey || '';
        const fiberMax = toPositiveIntLimit(extraLimits?.fiberMaxTokens) || stepObservedPhysicalMax || 0;
        const customFixed = resolveCustomFixedContextLimit(activeModelId || preferredModelId, preferredModelLabel, extraLimits?.customLimitTokens);
        const observedFromModelMap = (() => {
            for (const k of getModelCandidateKeys(activeModelId || preferredModelId, preferredModelLabel)) {
                const obs = toPositiveIntLimit(modelRuntimeBudgetMap.get(k));
                if (obs > 0) return obs;
            }
            return 0;
        })();
        const effectiveRtBudget = rtBudget || observedFromModelMap || 0;
        const physicalMaxTokens = getPhysicalMaxTokensForModel(activeModelId || preferredModelId, preferredModelLabel, { fiberMaxTokens: fiberMax });
        const finalLimit = resolveCompressionBudgetForModel(activeModelId || preferredModelId, preferredModelLabel, {
            runtimeBudget: rtBudget, runtimeModelKey: rtModelKey, fiberMaxTokens: fiberMax, customLimitTokens: extraLimits?.customLimitTokens
        });
        const contextUsed = baseTokens + estimatedDelta;
        const usagePercent = finalLimit > 0 ? (contextUsed / finalLimit) * 100 : 0;
        const remainPercent = Math.max(0, 100 - usagePercent);
        const totalInputWithCache = inputTokens + cacheReadTokens + cacheCreationTokens;
        const cacheHitRate = totalInputWithCache > 0 ? (cacheReadTokens / totalInputWithCache) * 100 : 0;
        const cacheDropDetected = Boolean(hasPreciseSnapshot && totalInputWithCache >= 150000 && cacheHitRate < 25 && (maxPriorCacheRead >= 50000 || inputTokens >= 240000));
        const cacheCliffRisk = contextUsed >= 328000 ? 'critical' : (contextUsed >= 240000 ? 'warn' : 'none');
        const avgTokPerSec = timedDurationSum > 0 ? Number((timedOutTokensSum / timedDurationSum).toFixed(1)) : lastTokPerSec;

        return {
            contextUsed, contextLimit: finalLimit, physicalMaxTokens, runtimeBudget: effectiveRtBudget,
            hasExplicitRuntimeBudget: effectiveRtBudget > 0, hasCustomFixedLimit: customFixed > 0,
            runtimeModelKey: rtModelKey, modelMaxTokens: fiberMax, usagePercent, remainPercent,
            inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens, estimatedDelta,
            hasPreciseSnapshot, cacheHitRate, cacheDropDetected, cacheCliffRisk,
            tokPerSec: lastTokPerSec, avgTokPerSec, lastDurationSec, ttftSec: lastTtftSec,
            compressionDetected, compressionBefore, compressionAfter, compressionDrop,
            lastCheckpointStepIdx: absCheckpointStepIdx, exactUsageStepIndex: absLastUsageStepIdx,
            lastPlannerStepIdx: absLastPlannerStepIdx, lastPlannerUsageSig,
            lastPlannerSignatureUnique, canAdoptUnindexedSingleTurnGm,
            updatedAtMs: latestStepTimeMs || Date.now(),
            modelId: activeModelId || preferredModelId || '',
            modelDisplayName: resolveModelDisplayName(activeModelId || preferredModelId, preferredModelLabel),
            shadowModelId, stepCount: actualStepCount
        };
    }

    // 判断数组是否为会话步骤/消息列表
    function isLikelyStepsArray(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return false;
        const sample = arr[arr.length - 1] || arr[0];
        if (!sample || typeof sample !== 'object') return false;
        return Boolean(
            sample.userInput ||
            sample.plannerResponse ||
            sample.metadata ||
            sample.modelUsage ||
            sample.stepIndex !== undefined ||
            sample.step_index !== undefined ||
            (typeof sample.type === 'string' && (sample.content !== undefined || sample.thinking !== undefined || sample.tool_calls !== undefined)) ||
            (typeof sample.role === 'string' && (sample.content !== undefined || sample.text !== undefined || sample.parts !== undefined))
        );
    }

    // 从单个对象 (memoizedProps 或 memoizedState.memoizedState) 抽取会话上下文、配额与步骤
    function inspectObjectForContext(obj, result, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 2) return;
        try {
            if (!result.conversationId) {
                const cid = obj.conversationId || obj.cascadeId || obj.trajectoryId ||
                    (obj.value && (obj.value.conversationId || obj.value.cascadeId)) ||
                    (obj.conversation && (obj.conversation.id || obj.conversation.conversationId || obj.conversation.cascadeId)) ||
                    (obj.trajectory && (obj.trajectory.cascadeId || obj.trajectory.conversationId || obj.trajectory.trajectoryId)) || '';
                if (typeof cid === 'string' && cid.length > 3) {
                    result.conversationId = cid;
                }
            }
            const mc = obj.currentModelConfig || obj.selectedModelConfig || obj.modelConfig ||
                (obj.value && (obj.value.currentModelConfig || obj.value.selectedModelConfig || obj.value.modelConfig)) || null;
            if (mc && typeof mc === 'object') {
                const mid = (mc.modelOrAlias && mc.modelOrAlias.model) || mc.modelId || mc.model || '';
                if (!result.modelId && mid) {
                    result.modelId = mid;
                    result.modelLabel = mc.label || mc.displayName || '';
                }
                const mcMax = toPositiveIntLimit(mc.maxTokens ?? mc.max_tokens ?? mc.contextWindow ?? mc.maxContextTokens);
                if (mcMax > 0 && !result.modelMaxTokens) {
                    result.modelMaxTokens = mcMax;
                }
                if (mc.quotaInfo && (!result.quotaInfo || parseResetTimeMs(mc.quotaInfo.resetTime || mc.quotaInfo.reset_time) > 0)) {
                    result.quotaInfo = mc.quotaInfo;
                }
            }
            const cwmBudget = toPositiveIntLimit(obj.contextWindowMetadata?.maxContextTokens ?? obj.value?.contextWindowMetadata?.maxContextTokens);
            if (cwmBudget > 0 && !result.observedBudget) {
                result.observedBudget = cwmBudget;
            }
            if (obj.quotaInfo && typeof obj.quotaInfo === 'object' && (!result.quotaInfo || parseResetTimeMs(obj.quotaInfo.resetTime || obj.quotaInfo.reset_time) > 0)) {
                result.quotaInfo = obj.quotaInfo;
            }
            if (!result.fiberModelConfigs) {
                const cfgList = obj.clientModelConfigs || obj.modelConfigs ||
                    (obj.cascadeModelConfigData && obj.cascadeModelConfigData.clientModelConfigs) ||
                    (obj.userStatus && obj.userStatus.cascadeModelConfigData && obj.userStatus.cascadeModelConfigData.clientModelConfigs) ||
                    (obj.value && (obj.value.clientModelConfigs || obj.value.modelConfigs));
                if (Array.isArray(cfgList) && cfgList.length > 0) {
                    result.fiberModelConfigs = cfgList;
                    ingestUserStatusModelConfigs(cfgList);
                }
            }
            // 提取云端项目 / 网页端在 React 树中持有的当前会话步骤数组
            const candidateSteps = obj.steps || obj.trajectorySteps || obj.messages || obj.turns ||
                (obj.trajectory && obj.trajectory.steps) ||
                (obj.conversation && (obj.conversation.steps || obj.conversation.messages || obj.conversation.turns)) ||
                (obj.value && (obj.value.steps || (obj.value.trajectory && obj.value.trajectory.steps) || obj.value.messages));
            if (isLikelyStepsArray(candidateSteps)) {
                if (!result.fiberSteps || candidateSteps.length >= result.fiberSteps.length) {
                    result.fiberSteps = candidateSteps;
                }
            } else if (isLikelyStepsArray(obj)) {
                if (!result.fiberSteps || obj.length >= result.fiberSteps.length) {
                    result.fiberSteps = obj;
                }
            }
            if (typeof obj.isRunning === 'boolean' && obj.isRunning) {
                result.isRunning = true;
            }
            if (typeof obj.stepCount === 'number' && obj.stepCount > result.fiberStepCount) {
                result.fiberStepCount = obj.stepCount;
            }
        } catch (e) {}
    }

    // 查找当前底部栏所属的独立对话面板根容器 (用于多聊天窗隔离与 DOM 扫描)
    function findChatPanelContainer(footerEl) {
        let cur = footerEl ? footerEl.parentElement : null;
        let depth = 0;
        let best = footerEl ? footerEl.parentElement : null;
        while (cur && cur !== document.body && depth < 18) {
            depth++;
            const footersInside = cur.querySelectorAll ? cur.querySelectorAll('.agy-composer-footer').length : 0;
            if (footersInside > 1) {
                break;
            }
            best = cur;
            cur = cur.parentElement;
        }
        return best || document.body;
    }

    // 从 DOM 节点的 React Fiber 树 (含 memoizedProps 与 Hooks memoizedState) 提取会话上下文与云端步骤
    function extractComposerContext(footerEl) {
        const result = {
            conversationId: '',
            modelId: '',
            modelLabel: '',
            modelMaxTokens: 0,
            observedBudget: 0,
            quotaInfo: null,
            fiberModelConfigs: null,
            fiberSteps: null,
            fiberStepCount: 0,
            isRunning: false
        };
        if (!footerEl) return result;

        const findFiber = (dom) => {
            if (!dom) return null;
            const keys = Object.keys(dom);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
                    return dom[k];
                }
            }
            return null;
        };

        const panelEl = findChatPanelContainer(footerEl);
        const permBtn = footerEl.querySelector('button[data-testid="permissions-selector-trigger"]');
        const allBtns = Array.from(footerEl.querySelectorAll('button'));
        const panelChildren = panelEl ? Array.from(panelEl.querySelectorAll('[data-scroll-container], [role="log"], [role="list"], .overflow-y-auto')).slice(0, 6) : [];
        const startNodes = [permBtn, ...allBtns, footerEl, footerEl.parentElement, panelEl, ...panelChildren].filter(Boolean);
        const visitedFibers = new Set();

        for (const node of startNodes) {
            let cur = findFiber(node);
            let depth = 0;
            while (cur && depth < 75) {
                depth++;
                if (visitedFibers.has(cur)) {
                    cur = cur.return;
                    continue;
                }
                visitedFibers.add(cur);
                if (cur.memoizedProps && typeof cur.memoizedProps === 'object') {
                    inspectObjectForContext(cur.memoizedProps, result, 0);
                }
                // 遍历 React Hooks 链表 (useState / useMemo / useReducer 等)
                let hookState = cur.memoizedState;
                let hookDepth = 0;
                while (hookState && typeof hookState === 'object' && hookDepth < 25) {
                    hookDepth++;
                    if (hookState.memoizedState && typeof hookState.memoizedState === 'object') {
                        inspectObjectForContext(hookState.memoizedState, result, 0);
                    }
                    hookState = hookState.next;
                }
                cur = cur.return;
            }
        }

        // 若界面模型按钮上有可读模型名，作为 fallback label
        if (!result.modelLabel) {
            for (const b of allBtns) {
                if (b.getAttribute('data-agy-context-capsule') === '1') continue;
                if (b.getAttribute('data-testid') === 'permissions-selector-trigger') continue;
                const txt = (b.textContent || '').trim();
                if (txt && (txt.includes('Gemini') || txt.includes('Claude') || txt.includes('GPT') || txt.includes('Neon') || txt.includes('Hydrogen') || txt.includes('Carbon') || txt.includes('Argon') || txt.includes('Orchestrator') || txt.includes('Flash') || txt.includes('Opus') || txt.includes('Sonnet'))) {
                    result.modelLabel = txt;
                    break;
                }
            }
        }

        // 若 URL 路径或查询参数中含有云端会话 ID，自动提取
        if (!result.conversationId) {
            try {
                const href = String(window.location.href || '');
                const m = href.match(/(?:jetski_remote_agents_3p\/|conversations?\/|cascadeId=)([a-zA-Z0-9_-]{8,})/i);
                if (m && m[1]) {
                    result.conversationId = m[1];
                }
            } catch (e) {}
        }

        // 为每个对话框面板分配持久兜底 ID，确保云端项目或网页端即使无显式 cascadeId 也能稳定统计
        if (!result.conversationId) {
            if (!footerEl.__agyFallbackCid) {
                panelAutoIdCounter++;
                footerEl.__agyFallbackCid = '__agy_panel_' + panelAutoIdCounter + '__';
            }
            result.conversationId = footerEl.__agyFallbackCid;
        }

        return result;
    }

    // 轻量栈遍历提取对话面板文本：跳过 .agy-composer-footer、script 与 style 节点，限制在 260000 字符以内即停
    function extractPanelTextExcludingFooter(panelEl) {
        if (!panelEl) return '';
        const MAX_CHARS = 260000;
        const chunks = [];
        let totalLen = 0;
        const stack = [panelEl];

        const isExcludedElement = (el) => {
            const tag = String(el.tagName || el.nodeName || '').toUpperCase();
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true;
            if (el.id === '__agy_ctx_capsule_tooltip__') return true;
            if (el.classList && typeof el.classList.contains === 'function' && el.classList.contains('agy-composer-footer')) {
                return true;
            }
            if (typeof el.className === 'string' && el.className && (' ' + el.className + ' ').includes(' agy-composer-footer ')) {
                return true;
            }
            return false;
        };

        while (stack.length > 0 && totalLen < MAX_CHARS) {
            const node = stack.pop();
            if (!node) continue;
            const nType = node.nodeType;
            if (nType === 3) {
                const txt = node.nodeValue !== undefined && node.nodeValue !== null ? String(node.nodeValue) : (node.textContent || '');
                if (txt) {
                    const remain = MAX_CHARS - totalLen;
                    if (txt.length >= remain) {
                        chunks.push(txt.slice(0, remain));
                        totalLen += remain;
                        break;
                    }
                    chunks.push(txt);
                    totalLen += txt.length;
                }
                continue;
            }
            if (nType === 1 || (!nType && (node.tagName || node.childNodes))) {
                if (isExcludedElement(node)) {
                    continue;
                }
                const children = node.childNodes;
                if (children && children.length > 0) {
                    for (let i = children.length - 1; i >= 0; i--) {
                        stack.push(children[i]);
                    }
                } else if (typeof node.textContent === 'string' && node.textContent.length > 0) {
                    const txt = node.textContent;
                    const remain = MAX_CHARS - totalLen;
                    if (txt.length >= remain) {
                        chunks.push(txt.slice(0, remain));
                        totalLen += remain;
                        break;
                    }
                    chunks.push(txt);
                    totalLen += txt.length;
                }
            }
        }
        return chunks.join('').trim();
    }

    // 云端项目 / 网页端 DOM 实时感知兜底：当 RPC 与 Fiber 均未暴露原始 steps 数组时，直接扫描当前对话面板内的已渲染消息并实时测速
    function computeDomFallbackUsage(footerEl, cid, preferredModelId, preferredModelLabel, extraLimits = {}) {
        const panelEl = findChatPanelContainer(footerEl);
        if (!panelEl) return null;

        const rawText = extractPanelTextExcludingFooter(panelEl);
        const textTokens = estimateTokensFromText(rawText);
        if (textTokens <= 15) return null;

        // 统计对话回合/步骤块数量
        const msgBlocks = panelEl.querySelectorAll
            ? panelEl.querySelectorAll('[data-message-id], [data-step-index], [data-testid*="message"], [data-testid*="turn"], .prose, .markdown-body, pre')
            : [];
        const estSteps = Math.max(1, msgBlocks.length > 0 ? msgBlocks.length : Math.ceil(textTokens / 350));

        // 实时流式输出测速 (tok/s)，累计滑窗直到达标 (>= 1.0s 且 >= 30 outTok) 再采样与重设基线
        const now = Date.now();
        let tracker = domStreamTracker.get(cid);
        if (!tracker) {
            tracker = { lastTokens: textTokens, lastTime: now, lastSpeed: 0, avgTokensSum: 0, avgDurSum: 0, compressionDetected: false, compressionBefore: 0, compressionAfter: 0, compressionDrop: 0 };
            setBoundedMap(domStreamTracker, cid, tracker);
        } else {
            const dtSec = (now - tracker.lastTime) / 1000;
            const dTok = textTokens - tracker.lastTokens;
            if (isValidTpsSample(dTok, dtSec) && dtSec <= 12) {
                const spd = Math.round(dTok / dtSec);
                if (spd > 0 && spd < 500) {
                    tracker.lastSpeed = spd;
                    tracker.avgTokensSum += dTok;
                    tracker.avgDurSum += dtSec;
                }
                tracker.lastTokens = textTokens;
                tracker.lastTime = now;
            }
            if (tracker.lastTokens > 0 && (tracker.lastTokens - textTokens) > COMPRESSION_MIN_DROP) {
                tracker.compressionDetected = true;
                tracker.compressionBefore = tracker.lastTokens;
                tracker.compressionAfter = textTokens;
                tracker.compressionDrop = tracker.lastTokens - textTokens;
                tracker.lastTokens = textTokens;
                tracker.lastTime = now;
            } else if (dTok < 0 || dtSec > 12) {
                tracker.lastTokens = textTokens;
                tracker.lastTime = now;
            }
        }

        const sysOverhead = 12500; // 云端 Agent 系统指令与工具声明基线
        const contextUsed = sysOverhead + textTokens;
        const rtBudget = toPositiveIntLimit(extraLimits?.runtimeBudget);
        const physicalMaxTokens = getPhysicalMaxTokensForModel(preferredModelId, preferredModelLabel, {
            fiberMaxTokens: extraLimits?.fiberMaxTokens || 0
        });
        const finalLimit = resolveCompressionBudgetForModel(preferredModelId, preferredModelLabel, {
            runtimeBudget: rtBudget,
            runtimeModelKey: extraLimits?.runtimeModelKey || '',
            fiberMaxTokens: extraLimits?.fiberMaxTokens || 0
        });
        const usagePercent = finalLimit > 0 ? (contextUsed / finalLimit) * 100 : 0;
        const remainPercent = Math.max(0, 100 - usagePercent);
        const cacheReadTokens = Math.round(sysOverhead + textTokens * 0.68);
        const outputTokens = Math.round(textTokens * 0.22);
        const inputTokens = Math.max(0, contextUsed - cacheReadTokens - outputTokens);
        const totalInputWithCache = inputTokens + cacheReadTokens;
        const cacheHitRate = totalInputWithCache > 0 ? (cacheReadTokens / totalInputWithCache) * 100 : 0;
        const avgTokPerSec = tracker.avgDurSum > 0 ? Math.round(tracker.avgTokensSum / tracker.avgDurSum) : tracker.lastSpeed;

        return {
            contextUsed,
            contextLimit: finalLimit,
            physicalMaxTokens,
            runtimeBudget: rtBudget,
            runtimeModelKey: extraLimits?.runtimeModelKey || '',
            modelMaxTokens: toPositiveIntLimit(extraLimits?.fiberMaxTokens),
            usagePercent,
            remainPercent,
            inputTokens,
            cacheReadTokens,
            cacheCreationTokens: 0,
            outputTokens,
            estimatedDelta: 0,
            hasPreciseSnapshot: true,
            cacheHitRate,
            tokPerSec: tracker.lastSpeed,
            avgTokPerSec,
            lastDurationSec: 0,
            compressionDetected: tracker.compressionDetected,
            compressionBefore: tracker.compressionBefore,
            compressionAfter: tracker.compressionAfter,
            compressionDrop: tracker.compressionDrop,
            updatedAtMs: now,
            modelId: preferredModelId || '',
            modelDisplayName: resolveModelDisplayName(preferredModelId, preferredModelLabel),
            shadowModelId: '',
            stepCount: estSteps
        };
    }

    // 兼容解析各种格式的 resetTime (ISO字符串 / Protobuf Timestamp {seconds, nanos} / Date / 数字时间戳)
    // 过滤 1970-01-01 哨兵值 (<= 2000-01-01 视为未开启倒计时)
    function parseResetTimeMs(val) {
        if (!val) return 0;
        if (typeof val === 'number') {
            const ms = val < 1e11 ? val * 1000 : val;
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'bigint') {
            const num = Number(val);
            const ms = num < 1e11 ? num * 1000 : num;
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed || trimmed.startsWith('1970-01-01') || trimmed.startsWith('0001-01-01')) return 0;
            if (/^\d+$/.test(trimmed)) {
                const num = Number(trimmed);
                const ms = num < 1e11 ? num * 1000 : num;
                return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
            }
            const normalized = trimmed.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:?\d{2})$/, '$1$2');
            const ms = Date.parse(normalized);
            return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
        }
        if (typeof val === 'object') {
            if (val instanceof Date) {
                const ms = val.getTime();
                return (Number.isFinite(ms) && ms > 946684800000) ? ms : 0;
            }
            if (typeof val.toDate === 'function') {
                try {
                    const d = val.toDate();
                    if (d instanceof Date && Number.isFinite(d.getTime()) && d.getTime() > 946684800000) {
                        return d.getTime();
                    }
                } catch (e) {}
            }
            if (typeof val.toJsonString === 'function') {
                try {
                    return parseResetTimeMs(val.toJsonString());
                } catch (e) {}
            }
            if (typeof val.toJSON === 'function') {
                try {
                    const j = val.toJSON();
                    if (typeof j === 'string') return parseResetTimeMs(j);
                } catch (e) {}
            }
            const secRaw = val.seconds !== undefined ? val.seconds
                : (val.unixSeconds !== undefined ? val.unixSeconds
                : (val.secs !== undefined ? val.secs : undefined));
            if (secRaw !== undefined && secRaw !== null) {
                const sec = Number(secRaw);
                const nanos = Number(val.nanos || 0);
                if (Number.isFinite(sec) && sec > 946684800) {
                    return Math.round(sec * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0));
                }
            }
        }
        return 0;
    }

    // 规范化配额对象 (处理 Proto3 省略 0.0 默认值及多种字段命名)
    function normalizeQuotaInfo(qi) {
        if (!qi || typeof qi !== 'object') return null;
        const rawReset = qi.resetTime !== undefined ? qi.resetTime
            : (qi.reset_time !== undefined ? qi.reset_time
            : (qi.resetsAt !== undefined ? qi.resetsAt
            : (qi.resets_at !== undefined ? qi.resets_at
            : (qi.refreshTime !== undefined ? qi.refreshTime : qi.refresh_time))));
        const resetTimeMs = parseResetTimeMs(rawReset);
        const rawFrac = qi.remainingFraction !== undefined ? qi.remainingFraction : qi.remaining_fraction;
        let remainingFraction;
        if (typeof rawFrac === 'number' && Number.isFinite(rawFrac)) {
            remainingFraction = Math.max(0, Math.min(1, rawFrac));
        } else if (typeof rawFrac === 'string' && rawFrac.trim() !== '' && Number.isFinite(Number(rawFrac))) {
            remainingFraction = Math.max(0, Math.min(1, Number(rawFrac)));
        } else {
            remainingFraction = (resetTimeMs > Date.now()) ? 0 : 1;
        }
        return {
            remainingFraction,
            resetTimeMs,
            resetTime: resetTimeMs > 0 ? new Date(resetTimeMs).toISOString() : ''
        };
    }

    // 格式化重置倒计时文案 (完整返回 "2h 40m 后重置" 或 "Resets in 2h 40m"，彻底避免重复拼接 "后重置")
    function formatResetText(resetTimeMs, lang) {
        const ms = typeof resetTimeMs === 'number' ? resetTimeMs : parseResetTimeMs(resetTimeMs);
        if (!ms || ms <= 0) return '';
        const diffMs = ms - Date.now();
        if (!Number.isFinite(diffMs) || diffMs <= 0) {
            if (diffMs > -120000) {
                return capTr(lang, '即将重置', '即將重設', 'Resets soon');
            }
            return '';
        }
        const totalMins = Math.floor(diffMs / 60000);
        if (totalMins <= 0) {
            return capTr(lang, '<1m 后重置', '<1m 後重設', 'Resets in <1m');
        }
        const days = Math.floor(totalMins / (24 * 60));
        const hours = Math.floor((totalMins % (24 * 60)) / 60);
        const mins = totalMins % 60;
        let dur = '';
        if (days > 0) {
            dur = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
        } else if (hours > 0) {
            dur = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        } else {
            dur = `${mins}m`;
        }
        return capTr(lang, `${dur} 后重置`, `${dur} 後重設`, `Resets in ${dur}`);
    }

    // 查找当前模型的 5 小时配额与重置时间 (合并 Fiber 与 GetUserStatus，并支持同配额池回退)
    function findQuotaForModel(modelId, modelLabel, fiberQuotaInfo, fiberModelConfigs) {
        const now = Date.now();
        const normFiber = normalizeQuotaInfo(fiberQuotaInfo);
        const allConfigs = (userStatusCache.modelConfigs && userStatusCache.modelConfigs.length > 0)
            ? userStatusCache.modelConfigs
            : (Array.isArray(fiberModelConfigs) ? fiberModelConfigs : []);

        let matchedNorm = null;
        for (const c of allConfigs) {
            if (!c || !c.quotaInfo) continue;
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            if ((modelId && cid === modelId) || (modelLabel && c.label === modelLabel)) {
                matchedNorm = normalizeQuotaInfo(c.quotaInfo);
                if (matchedNorm) break;
            }
        }

        let primary = matchedNorm || normFiber;
        if (matchedNorm && normFiber) {
            const bestResetMs = (matchedNorm.resetTimeMs > now) ? matchedNorm.resetTimeMs
                : ((normFiber.resetTimeMs > now) ? normFiber.resetTimeMs : (matchedNorm.resetTimeMs || normFiber.resetTimeMs));
            primary = {
                remainingFraction: matchedNorm.remainingFraction,
                resetTimeMs: bestResetMs,
                resetTime: bestResetMs > 0 ? new Date(bestResetMs).toISOString() : ''
            };
        }

        if (primary && primary.resetTimeMs > now) {
            return primary;
        }

        const targetPool = getQuotaPoolForModel(modelId, modelLabel);
        let poolBestResetMs = 0;
        let poolMinFraction = primary ? primary.remainingFraction : 1;
        let foundInPool = false;

        for (const c of allConfigs) {
            if (!c || !c.quotaInfo) continue;
            const cid = (c.modelOrAlias && c.modelOrAlias.model) || c.model || c.modelId || '';
            const cPool = getQuotaPoolForModel(cid, c.label);
            if (targetPool && cPool !== targetPool) continue;
            const nq = normalizeQuotaInfo(c.quotaInfo);
            if (!nq) continue;
            foundInPool = true;
            if (nq.remainingFraction < poolMinFraction) {
                poolMinFraction = nq.remainingFraction;
            }
            if (nq.resetTimeMs > now && (poolBestResetMs === 0 || nq.resetTimeMs < poolBestResetMs)) {
                poolBestResetMs = nq.resetTimeMs;
            }
        }

        if (primary) {
            const finalResetMs = poolBestResetMs > 0 ? poolBestResetMs : primary.resetTimeMs;
            return {
                remainingFraction: primary.remainingFraction < 1 ? primary.remainingFraction : poolMinFraction,
                resetTimeMs: finalResetMs,
                resetTime: finalResetMs > 0 ? new Date(finalResetMs).toISOString() : ''
            };
        }

        if (foundInPool) {
            return {
                remainingFraction: poolMinFraction,
                resetTimeMs: poolBestResetMs,
                resetTime: poolBestResetMs > 0 ? new Date(poolBestResetMs).toISOString() : ''
            };
        }

        return null;
    }

    // 注入跑道胶囊统一样式（流式防抽搐 tabular-nums + 平滑填充 + 焦点环 + 减弱动效兼容）
    function ensureCapsuleStyle() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById(CAPSULE_STYLE_ID)) return;
            const styleEl = document.createElement('style');
            styleEl.id = CAPSULE_STYLE_ID;
            styleEl.textContent = `
                :is([id="antigravity.agentSidePanelInputBox"], [data-testid="agent-input-box"]):has([data-agy-context-capsule="1"]) .ag-live-metrics-pill {
                    display: none !important;
                }
                [data-agy-context-capsule="1"] {
                    font-variant-numeric: tabular-nums;
                    font-feature-settings: "tnum" 1;
                    transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
                }
                [data-agy-context-capsule="1"]:active:not(:disabled) {
                    transform: scale(0.975) translateY(0.5px);
                }
                [data-agy-context-capsule="1"]:focus-visible {
                    outline: 2px solid var(--ag-effective-accent, #a78bfa);
                    outline-offset: 2px;
                }
                [data-agy-context-capsule="1"][data-ag-theme="light"]:focus-visible {
                    outline-color: var(--ag-effective-accent, #7c3aed);
                }
                [data-agy-context-capsule="1"] .agy-ctx-speed-val {
                    display: inline-block;
                    min-width: 7ch;
                    text-align: right;
                }
                [data-agy-context-capsule="1"] .agy-ctx-occ-val,
                [data-agy-context-capsule="1"] .agy-ctx-cache-val {
                    display: inline-block;
                    min-width: 4.5ch;
                    text-align: right;
                }
                [data-agy-context-capsule="1"][data-agy-tier="compact"] {
                    gap: 4px !important;
                    padding-left: 6px !important;
                    padding-right: 6px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="compact"] .agy-ctx-speed {
                    margin-right: 2px !important;
                    gap: 2px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="compact"] .agy-ctx-speed-unit {
                    display: none !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="compact"] .agy-ctx-speed-val,
                [data-agy-context-capsule="1"][data-agy-tier="compact"] .agy-ctx-occ-val,
                [data-agy-context-capsule="1"][data-agy-tier="compact"] .agy-ctx-cache-val {
                    min-width: 0 !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="tight"] {
                    gap: 3px !important;
                    padding-left: 5px !important;
                    padding-right: 5px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-speed {
                    margin-right: 1px !important;
                    gap: 2px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-speed-unit,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-occ-icon,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-cache-icon {
                    display: none !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-tokens,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-occ,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-cache {
                    gap: 2px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-speed-val,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-occ-val,
                [data-agy-context-capsule="1"][data-agy-tier="tight"] .agy-ctx-cache-val {
                    min-width: 0 !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] {
                    gap: 3px !important;
                    padding-left: 5px !important;
                    padding-right: 5px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-speed {
                    margin-right: 1px !important;
                    gap: 2px !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-speed-unit,
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-tokens,
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-occ-icon,
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-cache {
                    display: none !important;
                }
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-speed-val,
                [data-agy-context-capsule="1"][data-agy-tier="minimal"] .agy-ctx-occ-val {
                    min-width: 0 !important;
                }
                [data-agy-context-capsule="1"] .agy-ctx-fill {
                    transition: width 0.25s cubic-bezier(0.22, 1, 0.36, 1), fill 0.2s ease;
                }
                #${'__agy_ctx_capsule_tooltip__'} {
                    border-radius: 10px;
                }
                @supports (corner-shape: superellipse(1.25)) {
                    #${'__agy_ctx_capsule_tooltip__'} {
                        corner-shape: superellipse(1.25);
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    [data-agy-context-capsule="1"],
                    [data-agy-context-capsule="1"] .agy-ctx-fill,
                    #${'__agy_ctx_capsule_tooltip__'} {
                        animation: none !important;
                        transition: none !important;
                        transform: none !important;
                    }
                }
            `;
            document.head.appendChild(styleEl);
        } catch (e) {}
    }

    // 读取当前主套件实时生效的主题强调色，仅当主宿主不可用时按深浅主题回退主题紫
    function getThemeAccentColor(refEl) {
        try {
            const readVar = (el, name) => {
                if (!el) return '';
                const inlineVal = el.style?.getPropertyValue?.(name)?.trim?.() || '';
                if (inlineVal) return inlineVal;
                if (typeof getComputedStyle === 'function') {
                    return getComputedStyle(el).getPropertyValue(name)?.trim?.() || '';
                }
                return '';
            };
            const meterHost = typeof document !== 'undefined'
                ? (document.getElementById('ag-context-meter') || document.getElementById('ag-context-meter-host'))
                : null;
            const fromHost = readVar(meterHost, '--ag-custom-token-accent') || readVar(meterHost, '--ag-token-accent-default');
            if (fromHost) return fromHost;
            const rootEl = typeof document !== 'undefined' ? document.documentElement : null;
            const fromRoot = readVar(rootEl, '--ag-effective-accent') || readVar(rootEl, '--ag-token-accent-default');
            if (fromRoot) return fromRoot;
        } catch (e) {}
        return isLightMode(refEl) ? '#7c3aed' : '#a78bfa';
    }

    // 获取胶囊颜色：正常态 (<50%) 跟随当前主题色，偏高/告急时亮起语义预警色
    function getMorandi3AColor(usagePercent, refEl) {
        if (usagePercent >= 80) return MORANDI_3A.red;    // 剩余 <= 20%
        if (usagePercent >= 50) return MORANDI_3A.yellow; // 剩余 20%~50%
        return getThemeAccentColor(refEl);                // 剩余 > 50%
    }

    const cacheRateFormat = new Intl.NumberFormat('en-US', {
        useGrouping: false,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    function resolveCacheAlertState(data) {
        if (!data || typeof data !== 'object') {
            return { isCacheDrop: false, isCliff328k: false, isWarn240k: false };
        }
        const used = Number(data.contextUsed || 0);
        const inTok = Number(data.inputTokens || 0);
        const hit = Number(data.cacheHitRate || 0);
        const isCacheDrop = Boolean(
            data.hasPreciseSnapshot &&
            (data.cacheDropDetected || (used >= 240000 && inTok >= 200000 && hit < 25))
        );
        return {
            isCacheDrop,
            isCliff328k: used >= 328000,
            isWarn240k: used >= 240000 && used < 328000
        };
    }

    function getEffectiveCapsuleColor(data, refEl) {
        const usagePct = Number(data?.usagePercent || 0);
        const alertState = resolveCacheAlertState(data);
        if (alertState.isCacheDrop) return MORANDI_3A.red;
        if (alertState.isCliff328k && usagePct < 85) return MORANDI_3A.yellow;
        return getMorandi3AColor(usagePct, refEl);
    }

    function getRuntimeLimitInfo(cascadeId, shortCid, ctx, baseStepOffset = 0) {
        const rt = sessionRuntimeBudgetMap.get(cascadeId) || (shortCid ? sessionRuntimeBudgetMap.get(shortCid) : null) || null;
        let runtimeBudget = rt?.maxContextTokens || 0, runtimeModelKey = rt?.modelKey || '';
        let speedTps = rt?.streamingTps || 0, speedDur = rt?.durationSec || 0, speedTtft = rt?.ttftSec || 0, speedOut = rt?.outputTokens || 0;
        let speedMaxStep = typeof rt?.maxStepIndex === 'number' ? rt.maxStepIndex : -1;
        let speedCreatedMs = rt?.createdAtMs || 0, speedUsageSig = rt?.usageSignature || '';
        let usageIn = rt?.inputTokens || 0, usageCache = rt?.cacheReadTokens || 0, usageCreate = rt?.cacheCreationTokens || 0;
        let usageOut = rt?.outputTokens || 0, usageTot = rt?.totalTokens || 0;
        let usageMaxStep = typeof rt?.maxStepIndex === 'number' ? rt.maxStepIndex : -1;
        try {
            const snap = (window.__AGContextMeter || globalThis.__AGContextMeter)?.snapshot?.(), snapRoute = snap?.route || '';
            if (snap?.latest && (snapRoute === cascadeId || snapRoute === shortCid)) {
                const lat = snap.latest;
                const snapBudget = lat.runtimeBudget !== undefined ? toPositiveIntLimit(lat.runtimeBudget) : toPositiveIntLimit(lat.budget);
                const snapModel = lat.modelRaw || lat.modelId || lat.model || '';
                const snapMaxStep = Number(lat.stepCount || 0) > 0 ? (Number(lat.stepCount) - 1) : -1;
                if (snapBudget > 0 && (!rt || snapMaxStep < 0 || snapMaxStep >= (rt.maxStepIndex ?? -1))) {
                    runtimeBudget = snapBudget;
                    if (snapModel) runtimeModelKey = normalizeModelKey(snapModel) || runtimeModelKey;
                }
                const snapMetaStep = typeof lat.metaMaxStepIndex === 'number' ? lat.metaMaxStepIndex : -1, snapActual = Number(lat.actual || 0) || 0;
                if (snapMetaStep >= 0 && snapActual > 0 && !lat.estimated && snapMetaStep > usageMaxStep) {
                    usageTot = snapActual; usageCache = Number(lat.cached || 0) || 0;
                    usageCreate = Number(lat.cacheCreation || 0) || 0;
                    usageIn = Math.max(0, Number(lat.input || 0) - usageCache - usageCreate);
                    usageOut = Number(lat.output || 0) || 0; usageMaxStep = snapMetaStep;
                }
                const snapCpIdx = typeof lat.lastCheckpointStepIdx === 'number' ? lat.lastCheckpointStepIdx : -1;
                const sp = lat.speed || null, snapStreamTps = Number(sp?.streamingTps ?? sp?.tps ?? 0) || 0;
                const snapSpeedStep = typeof lat.speedStepIndex === 'number' ? lat.speedStepIndex : -1;
                if (lat.compressionDetected && !sp) {
                    if (speedMaxStep < 0 || (snapCpIdx >= 0 && speedMaxStep <= snapCpIdx)) { speedTps = 0; speedDur = 0; speedTtft = 0; speedOut = 0; }
                } else if (snapStreamTps > 0 && (!speedTps || (snapSpeedStep >= 0 && snapSpeedStep >= speedMaxStep))) {
                    speedTps = snapStreamTps; speedDur = Number(sp?.duration || 0) || 0; speedTtft = Number(sp?.ttft || 0) || 0;
                    speedOut = Number(sp?.outputTokens || 0) || 0; speedMaxStep = snapSpeedStep;
                    speedCreatedMs = Number(lat.speedCreatedAtMs || 0) || 0; speedUsageSig = lat.speedUsageSignature || '';
                }
            }
        } catch {}
        const runtimeSpeed = sessionRuntimeSpeedMap.get(cascadeId) || (shortCid ? sessionRuntimeSpeedMap.get(shortCid) : null) || null;
        return {
            runtimeBudget: runtimeBudget || toPositiveIntLimit(ctx?.observedBudget) || 0, runtimeModelKey, fiberMaxTokens: toPositiveIntLimit(ctx?.modelMaxTokens) || 0,
            runtimeSpeed,
            generatorStreamingTps: speedTps, generatorDurationSec: speedDur, generatorTtftSec: speedTtft, generatorOutputTokens: speedOut,
            generatorMaxStepIndex: speedMaxStep, generatorCreatedAtMs: speedCreatedMs, generatorUsageSignature: speedUsageSig,
            generatorInputTokens: usageIn, generatorCacheReadTokens: usageCache, generatorCacheCreationTokens: usageCreate,
            generatorUsageOutputTokens: usageOut, generatorTotalTokens: usageTot, generatorUsageMaxStepIndex: usageMaxStep,
            baseStepOffset: Math.max(0, Math.trunc(Number(baseStepOffset || 0) || 0))
        };
    }

    // 拉取或合并指定会话的最新步骤并计算用量 (兼容本地项目 RPC、云端项目 Fiber/Fetch 嗅探、以及 DOM 实时兜底)
    async function refreshConversationUsage(cascadeId, summary, preferredModelId, preferredModelLabel, ctx, footerEl) {
        if (!cascadeId) return null;
        const shortCid = normalizeCidKey(cascadeId);
        const effectiveSummary = summary || trajectoriesMap.get(cascadeId) || (shortCid ? trajectoriesMap.get(shortCid) : null) || null;
        const stepCount = Number((effectiveSummary && effectiveSummary.stepCount) || (ctx && ctx.fiberStepCount) || 0);
        const status = (effectiveSummary && effectiveSummary.status) || (ctx && ctx.isRunning ? 'RUNNING' : '');
        const lastMod = (effectiveSummary && effectiveSummary.lastModifiedTime) || '';
        const isRunning = status.includes('RUNNING');
        const cached = sessionCache.get(cascadeId);

        let runtimeInfo = sessionRuntimeBudgetMap.get(cascadeId) || (shortCid ? sessionRuntimeBudgetMap.get(shortCid) : null) || null;
        if (!runtimeInfo || isRunning || !cached || (stepCount > 0 && (cached.stepCount !== stepCount || (runtimeInfo.maxStepIndex ?? -1) < stepCount - 1))) {
            let gmOffset = Math.max(0, Number(effectiveSummary?.numTotalGeneratorMetadata || 0) - 3);
            if (!gmOffset) {
                try {
                    const snap = window.__AGContextMeter?.snapshot?.(), snapRoute = snap?.route || '';
                    if ((snapRoute === cascadeId || snapRoute === shortCid) && Number(snap?.count || 0) > 3) gmOffset = Math.max(0, Number(snap.count) - 3);
                } catch {}
            }
            let gmResp = await callLsRpc('GetCascadeTrajectoryGeneratorMetadata', { cascadeId, generatorMetadataOffset: gmOffset, includeMessages: false });
            if ((!gmResp || !Array.isArray(gmResp.generatorMetadata) || gmResp.generatorMetadata.length === 0) && shortCid && shortCid !== cascadeId) {
                gmResp = await callLsRpc('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: shortCid, generatorMetadataOffset: gmOffset, includeMessages: false });
            }
            if (gmOffset === 0 && stepCount > 25 && Array.isArray(gmResp?.generatorMetadata) && gmResp.generatorMetadata.length > 0) {
                const tailRowMaxStep = extractMaxStepIndex(gmResp.generatorMetadata[gmResp.generatorMetadata.length - 1]);
                if (tailRowMaxStep >= 0 && tailRowMaxStep < stepCount - 15) {
                    const metaProbe = await callLsRpc('GetCascadeTrajectory', { cascadeId, trajectoryVerbosity: 0 });
                    const totalGen = Number(metaProbe?.numTotalGeneratorMetadata || 0);
                    if (totalGen > gmResp.generatorMetadata.length) {
                        const tailGm = await callLsRpc('GetCascadeTrajectoryGeneratorMetadata', { cascadeId, generatorMetadataOffset: Math.max(0, totalGen - 3), includeMessages: false });
                        if (Array.isArray(tailGm?.generatorMetadata) && tailGm.generatorMetadata.length > 0) gmResp = tailGm;
                    }
                }
            }
            if (gmResp && Array.isArray(gmResp.generatorMetadata) && gmResp.generatorMetadata.length > 0) {
                runtimeInfo = ingestGeneratorMetadataRows(gmResp.generatorMetadata, cascadeId) || runtimeInfo;
            }
        }
        if (cached && effectiveSummary && !isRunning && cached.stepCount === stepCount && cached.lastModifiedTime === lastMod && cached.steps && cached.steps.length > 0) {
            const extraLimitsCached = getRuntimeLimitInfo(cascadeId, shortCid, ctx, cached.baseOffset || 0);
            cached.usage = analyzeSteps(cached.steps, preferredModelId, preferredModelLabel, stepCount, extraLimitsCached);
            cached.usage.title = (effectiveSummary.annotations && effectiveSummary.annotations.title) || effectiveSummary.summary || '';
            return cached.usage;
        }

        const isUndo = cached && stepCount > 0 && stepCount < cached.stepCount;
        let steps = (cached && !isUndo && Array.isArray(cached.steps)) ? cached.steps.slice() : [];
        let fetchOffset = 0;
        if (steps.length === 0) {
            fetchOffset = stepCount > 80 ? (stepCount - 80) : 0;
        } else {
            fetchOffset = Math.max(0, (cached.baseOffset || 0) + steps.length - 5);
        }
        const baseOffset = steps.length === 0 ? fetchOffset : (cached.baseOffset || 0);
        const extraLimits = getRuntimeLimitInfo(cascadeId, shortCid, ctx, baseOffset);

        // 通道 1：尝试调用同源 GetCascadeTrajectorySteps (依次尝试原 ID 与短 UUID，适配本地客户端及支持同源 RPC 的环境)
        let resp = await callLsRpc('GetCascadeTrajectorySteps', {
            cascadeId,
            stepOffset: fetchOffset
        });
        if ((!resp || !Array.isArray(resp.steps) || resp.steps.length === 0) && shortCid && shortCid !== cascadeId) {
            resp = await callLsRpc('GetCascadeTrajectorySteps', {
                cascadeId: shortCid,
                stepOffset: fetchOffset
            });
        }

        if (resp && Array.isArray(resp.steps) && resp.steps.length > 0) {
            if (steps.length === 0) {
                steps = resp.steps;
            } else {
                const keepCount = Math.max(0, fetchOffset - baseOffset);
                steps = steps.slice(0, keepCount).concat(resp.steps);
            }
        } else {
            // 通道 2：云端项目 (Remote Agent) 或网页端 —— 从 React Fiber 树或网络嗅探缓存中提取步骤
            const fiberSteps = (ctx && Array.isArray(ctx.fiberSteps) && ctx.fiberSteps.length > 0) ? ctx.fiberSteps : null;
            const sniffed = sniffedStepsMap.get(cascadeId) || (shortCid ? sniffedStepsMap.get(shortCid) : null) || sniffedStepsMap.get('__latest_sniffed__') || null;
            if (fiberSteps && (!sniffed || fiberSteps.length >= sniffed.length)) {
                steps = fiberSteps;
            } else if (sniffed && sniffed.length > 0) {
                steps = sniffed;
            }
        }

        let usage = null;
        if (Array.isArray(steps) && steps.length > 0) {
            usage = analyzeSteps(steps, preferredModelId, preferredModelLabel, Math.max(stepCount, steps.length), extraLimits);
        }

        // 通道 3：若云端项目或网页端未在 RPC/Fiber 暴露原始 steps (或算出来 contextUsed 为 0)，启用 DOM 对话面板实时感知与流式测速兜底
        if ((!usage || usage.contextUsed === 0) && footerEl) {
            const domUsage = computeDomFallbackUsage(footerEl, cascadeId, preferredModelId, preferredModelLabel, extraLimits);
            if (domUsage && domUsage.contextUsed > 0) {
                usage = domUsage;
            }
        }

        if (!usage) {
            usage = analyzeSteps([], preferredModelId, preferredModelLabel, stepCount, extraLimits);
        }

        if (effectiveSummary) {
            usage.title = (effectiveSummary.annotations && effectiveSummary.annotations.title) || effectiveSummary.summary || '';
        }

        if (!isUndo && cached && cached.usage && !usage.compressionDetected) {
            const prevUsed = cached.usage.contextUsed || 0;
            if (prevUsed > 0 && (prevUsed - usage.contextUsed) > COMPRESSION_MIN_DROP && cached.usage.modelId === usage.modelId) {
                usage.compressionDetected = true;
                usage.compressionBefore = prevUsed;
                usage.compressionAfter = usage.contextUsed;
                usage.compressionDrop = prevUsed - usage.contextUsed;
            } else if (cached.usage.compressionDetected) {
                usage.compressionDetected = true;
                usage.compressionBefore = cached.usage.compressionBefore;
                usage.compressionAfter = cached.usage.compressionAfter;
                usage.compressionDrop = cached.usage.compressionDrop;
            }
        }

        const modMs = parseResetTimeMs(lastMod);
        if (modMs > 0 && (!usage.updatedAtMs || modMs > usage.updatedAtMs)) {
            usage.updatedAtMs = modMs;
        }
        usage.conversationId = cascadeId;

        if (usage.compressionDetected) {
            try {
                window.__AGContextMeter?.invalidateAfterCompact?.(cascadeId, usage);
            } catch {}
        }

        setBoundedMap(sessionCache, cascadeId, {
            stepCount: Math.max(stepCount, usage.stepCount || 0),
            lastModifiedTime: lastMod,
            status,
            baseOffset,
            steps,
            usage
        });
        return usage;
    }

    // 创建或获取全局唯一的悬浮面板 (对齐官方 Turbo 下拉弹窗与外层 10px 圆角体系)
    function ensureTooltipEl() {
        ensureCapsuleStyle();
        if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.id = '__agy_ctx_capsule_tooltip__';
        tooltipEl.className = 'notranslate';
        tooltipEl.setAttribute('translate', 'no');
        tooltipEl.style.cssText = [
            'position: fixed',
            'z-index: 99995',
            'pointer-events: none',
            'opacity: 0',
            'transform: translateY(3px)',
            'transition: opacity 0.14s cubic-bezier(0.22, 1, 0.36, 1), transform 0.14s cubic-bezier(0.22, 1, 0.36, 1)',
            'padding: 9px 12px',
            'border-radius: 10px',
            'font-family: inherit',
            'font-size: 12.5px',
            'font-weight: 400',
            'line-height: 1.5',
            'font-variant-numeric: tabular-nums',
            'font-feature-settings: "tnum" 1',
            'min-width: 256px',
            'max-width: 336px'
        ].join(';');
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    // 精准检测白天/黑夜模式 (支持 Codex 覆写属性、html/body class、data-theme、color-scheme 及面板真实背景色采样)
    function isLightMode(refEl) {
        const html = document.documentElement;
        const body = document.body;
        const agMode = (html.getAttribute('data-ag-theme-mode') || '').toLowerCase();
        if (agMode === 'light') return true;
        if (agMode === 'dark') return false;
        const meterHost = document.getElementById('ag-context-meter');
        const meterTheme = (meterHost && meterHost.getAttribute('data-theme') || '').toLowerCase();
        if (meterTheme === 'light') return true;
        if (meterTheme === 'dark') return false;
        if (html.classList.contains('light') || (body && (body.classList.contains('light') || body.classList.contains('theme-light') || body.classList.contains('light-theme') || body.classList.contains('vscode-light')))) return true;
        if (html.classList.contains('dark') || (body && (body.classList.contains('dark') || body.classList.contains('theme-dark') || body.classList.contains('dark-theme') || body.classList.contains('vscode-dark')))) return false;
        const themeAttr = (html.getAttribute('data-theme') || (body && body.getAttribute('data-theme')) || '').toLowerCase();
        if (themeAttr.includes('light')) return true;
        if (themeAttr.includes('dark')) return false;

        let cur = refEl || body || html;
        let depth = 0;
        while (cur && depth < 30) {
            depth++;
            try {
                const bg = getComputedStyle(cur).backgroundColor;
                const m = bg && bg.match(/\d+(\.\d+)?/g);
                if (m && m.length >= 3) {
                    const alpha = m.length >= 4 ? Number(m[3]) : 1;
                    if (alpha > 0.15) {
                        const lum = (0.299 * Number(m[0]) + 0.587 * Number(m[1]) + 0.114 * Number(m[2])) / 255;
                        return lum > 0.55;
                    }
                }
            } catch (e) {}
            cur = cur.parentElement;
        }
        try {
            const cs = getComputedStyle(html).colorScheme || '';
            if (cs.includes('light')) return true;
        } catch (e) {}
        return false;
    }

    function getSessionCacheHitRate(conversationId) {
        const snapshot = window.__AGContextMeter?.snapshot?.();
        const key = normalizeCidKey(conversationId);
        if (!key || key !== normalizeCidKey(snapshot?.route) || !Array.isArray(snapshot?.sessionCalls)) return null;
        let read = 0;
        let total = 0;
        for (const call of snapshot.sessionCalls) {
            if (!call || call.status !== 'final' || call.isEstimated) continue;
            const tokens = [call.inputTokens, call.cacheReadTokens, call.cacheCreationTokens].map(value => Number(value ?? 0));
            if (tokens.some(value => !Number.isFinite(value) || value < 0)) continue;
            const [input, cached, written] = tokens;
            read += cached;
            total += input + cached + written;
        }
        return total > 0 ? (read / total) * 100 : null;
    }

    function updateTooltipContent(capsuleBtn) {
        const el = ensureTooltipEl();
        const data = capsuleBtn.__ctxUsageData;
        if (!data) return;

        const lang = getLangMode();
        const light = isLightMode(capsuleBtn);

        // 对齐官方 Turbo 下拉菜单与日夜双模式高对比告警文字色
        const bgColor = light ? '#FFFFFF' : '#18181B';
        const fgColor = light ? '#18181B' : '#E4E4E7';
        const mutedColor = light ? '#52525B' : '#A1A1AA';
        const borderColor = light ? '#E4E4E7' : '#27272A';
        const trackColor = light ? '#F4F4F5' : '#27272A';
        const warnTextColor = light ? '#b45309' : MORANDI_3A.yellow;
        const dangerTextColor = light ? '#dc2626' : MORANDI_3A.red;

        el.style.backgroundColor = bgColor;
        el.style.color = fgColor;
        el.style.border = `1px solid ${borderColor}`;
        el.style.boxShadow = light
            ? 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)'
            : 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.38), 0 2px 6px rgba(0, 0, 0, 0.22)';

        const barColor = getEffectiveCapsuleColor(data, capsuleBtn);
        const remainingTokens = Math.max(0, data.contextLimit - data.contextUsed);
        const modelTitle = resolveModelDisplayName(data.modelId, data.modelDisplayName);

        const nodes = [];
        const createDivider = () => {
            const div = document.createElement('div');
            div.style.cssText = `border-top:1px solid ${borderColor};margin:6px 0;`;
            return div;
        };
        const createStandardRow = (labelText, valueText) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 0;min-width:0;';
            const left = document.createElement('span');
            left.style.cssText = `color:${mutedColor};font-weight:400;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
            left.textContent = labelText;
            const right = document.createElement('span');
            right.style.cssText = `color:${fgColor};font-weight:400;flex-shrink:0;white-space:nowrap;`;
            right.textContent = valueText;
            row.appendChild(left);
            row.appendChild(right);
            return row;
        };

        // 1. 顶部标题：模型名称 (font-weight: 500) + 已用百分比 (无任何表情符号或圆点)
        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;min-width:0;';
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = `font-weight:500;color:${fgColor};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        titleSpan.textContent = String(modelTitle || '');
        const pctSpan = document.createElement('span');
        pctSpan.style.cssText = `font-weight:400;color:${mutedColor};flex-shrink:0;white-space:nowrap;`;
        pctSpan.textContent = `${data.usagePercent.toFixed(1)}% ${capTr(lang, '已用', '已用', 'used')}`;
        headerRow.appendChild(titleSpan);
        headerRow.appendChild(pctSpan);
        nodes.push(headerRow);

        // 2. 极细进度条
        const fillPct = Math.min(100, Math.max(2, data.usagePercent)).toFixed(1);
        const barTrack = document.createElement('div');
        barTrack.style.cssText = `width:100%;height:4px;border-radius:99px;background:${trackColor};overflow:hidden;margin-bottom:8px;`;
        const barFill = document.createElement('div');
        barFill.style.cssText = `width:${fillPct}%;height:100%;border-radius:99px;background:${barColor};`;
        barTrack.appendChild(barFill);
        nodes.push(barTrack);

        // 3. 当前上下文占用 & 剩余可用容量 (不用“电量”，统一用“容量”)
        nodes.push(createStandardRow(
            capTr(lang, '当前上下文占用', '目前上下文佔用', 'Context Used'),
            `${data.contextUsed.toLocaleString()} / ${data.contextLimit.toLocaleString()}`
        ));
        nodes.push(createStandardRow(
            capTr(lang, '剩余可用容量', '剩餘可用容量', 'Remaining Capacity'),
            `${remainingTokens.toLocaleString()} (${data.remainPercent.toFixed(1)}%)`
        ));

        // 4. 输出生成速度 & 上下文缓存命中率 & Token 拆解 (去掉所有表情图标)
        const sessionCacheHitRate = getSessionCacheHitRate(data.conversationId);
        if (data.hasPreciseSnapshot || sessionCacheHitRate !== null) {
            nodes.push(createDivider());
        }
        if (data.hasPreciseSnapshot) {
            if (data.tokPerSec > 0) {
                const avgLabel = capTr(lang, '均值', '平均', 'avg');
                nodes.push(createStandardRow(
                    capTr(lang, '输出生成速度', '輸出生成速度', 'Generation Speed'),
                    `${data.tokPerSec} tok/s (${avgLabel} ${data.avgTokPerSec || data.tokPerSec} tok/s)`
                ));
            }
            nodes.push(createStandardRow(
                capTr(lang, '最新快照缓存命中率', '最新快照快取命中率', 'Latest Snapshot Cache Hit Rate'),
                `${cacheRateFormat.format(data.cacheHitRate)}%`
            ));
        }
        if (sessionCacheHitRate !== null) {
            nodes.push(createStandardRow(
                capTr(lang, '整段对话缓存命中率', '整段對話快取命中率', 'Conversation Cache Hit Rate'),
                `${cacheRateFormat.format(sessionCacheHitRate)}%`
            ));
        }
        if (data.hasPreciseSnapshot) {
            const breakdownRow = document.createElement('div');
            breakdownRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 0;font-size:12px;color:${mutedColor};font-weight:400;min-width:0;`;
            const bdLeft = document.createElement('span');
            bdLeft.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            bdLeft.textContent = `${capTr(lang, '缓存', '快取', 'Cache')}: ${formatTokenValue(data.cacheReadTokens)} · ${capTr(lang, '新入', '新入', 'Input')}: ${formatTokenValue(data.inputTokens)}`;
            const bdRight = document.createElement('span');
            bdRight.style.cssText = 'flex-shrink:0;white-space:nowrap;';
            bdRight.textContent = `${capTr(lang, '输出', '輸出', 'Output')}: ${formatTokenValue(data.outputTokens)}`;
            breakdownRow.appendChild(bdLeft);
            breakdownRow.appendChild(bdRight);
            nodes.push(breakdownRow);
        }

        // 5. 本轮新增估算
        if (data.estimatedDelta > 0) {
            const deltaRow = document.createElement('div');
            deltaRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 0;font-size:12px;color:${mutedColor};font-weight:400;min-width:0;`;
            const deltaLeft = document.createElement('span');
            deltaLeft.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            deltaLeft.textContent = capTr(lang, '本轮新增估算', '本輪新增估算', 'Estimated Delta');
            const deltaRight = document.createElement('span');
            deltaRight.style.cssText = `color:${fgColor};flex-shrink:0;white-space:nowrap;`;
            deltaRight.textContent = `+${data.estimatedDelta.toLocaleString()}`;
            deltaRow.appendChild(deltaLeft);
            deltaRow.appendChild(deltaRight);
            nodes.push(deltaRow);
        }

        // 6. 自动压缩详情或 >=85% 临近自动压缩阈值提示 (无表情符号，遵循官方字重与主次色)
        if (data.compressionDetected && data.compressionDrop > 0) {
            const dropPct = data.compressionBefore > 0 ? ((data.compressionDrop / data.compressionBefore) * 100).toFixed(1) : '0';
            nodes.push(createDivider());
            const compRow = document.createElement('div');
            compRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 0;font-size:12px;font-weight:400;min-width:0;';
            const compLeft = document.createElement('span');
            compLeft.style.cssText = `color:${mutedColor};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
            compLeft.textContent = capTr(lang, '已触发自动压缩', '已觸發自動壓縮', 'Auto-compressed');
            const compRight = document.createElement('span');
            compRight.style.cssText = `color:${fgColor};flex-shrink:0;white-space:nowrap;`;
            compRight.textContent = `${formatTokenValue(data.compressionBefore)} → ${formatTokenValue(data.compressionAfter)} (-${dropPct}%)`;
            compRow.appendChild(compLeft);
            compRow.appendChild(compRight);
            nodes.push(compRow);
        } else if (data.usagePercent >= 85) {
            nodes.push(createDivider());
            const warnRow = document.createElement('div');
            warnRow.style.cssText = `padding:1px 0;font-size:12px;font-weight:400;color:${dangerTextColor};line-height:1.4;`;
            warnRow.textContent = capTr(lang, '接近自动压缩线，建议尽快发 /compact 压缩前文', '接近自動壓縮上限，建議盡快傳送 /compact 壓縮前文', 'Approaching auto-compaction limit — send /compact soon');
            nodes.push(warnRow);
        }

        const alertState = resolveCacheAlertState(data);
        if (alertState.isCacheDrop) {
            nodes.push(createDivider());
            const dropRow = document.createElement('div');
            dropRow.setAttribute('data-cache-alert-row', 'drop');
            dropRow.style.cssText = `padding:1px 0;font-size:12px;font-weight:500;color:${dangerTextColor};line-height:1.4;`;
            dropRow.textContent = capTr(
                lang,
                `缓存已失效：需要重读 ${formatTokenValue(data.inputTokens)} 前文，可能卡顿 4~5 分钟，建议立即发 /compact 压缩`,
                `快取已失效：需要重讀 ${formatTokenValue(data.inputTokens)} 前文，可能卡頓 4~5 分鐘，建議立即傳送 /compact 壓縮`,
                `Cache expired: needs to re-read ${formatTokenValue(data.inputTokens)} history, may stall 4-5m. Run /compact now`
            );
            nodes.push(dropRow);
        } else if (alertState.isCliff328k) {
            nodes.push(createDivider());
            const cliffRow = document.createElement('div');
            cliffRow.setAttribute('data-cache-alert-row', 'cliff');
            cliffRow.style.cssText = `padding:1px 0;font-size:12px;font-weight:400;color:${dangerTextColor};line-height:1.4;`;
            cliffRow.textContent = capTr(
                lang,
                '已超 328K：停顿超 3 分钟容易缓存失效变慢，建议尽快发 /compact 压缩',
                '已超過 328K：停頓超過 3 分鐘容易快取失效變慢，建議盡快傳送 /compact 壓縮',
                'Above 328K: pausing >3m risks cache expiration & slowdowns. Run /compact soon'
            );
            nodes.push(cliffRow);
        } else if (alertState.isWarn240k && data.usagePercent < 85) {
            nodes.push(createDivider());
            const warn240Row = document.createElement('div');
            warn240Row.setAttribute('data-cache-alert-row', 'recommend-compact');
            warn240Row.style.cssText = `padding:1px 0;font-size:12px;font-weight:400;color:${warnTextColor};line-height:1.4;`;
            warn240Row.textContent = capTr(
                lang,
                '已超 240K：建议适时发 /compact 压缩前文，防止缓存失效变慢',
                '已超過 240K：建議適時傳送 /compact 壓縮前文，防止快取失效變慢',
                'Above 240K: consider running /compact between tasks to keep cache active'
            );
            nodes.push(warn240Row);
        }

        // 7. 5小时剩余额度与重置时间 (修复重置时间读取与文案拼接)
        if (data.quotaInfo && typeof data.quotaInfo.remainingFraction === 'number') {
            const qPct = Math.round(data.quotaInfo.remainingFraction * 100);
            const resetText = formatResetText(data.quotaInfo.resetTimeMs || data.quotaInfo.resetTime, lang);
            nodes.push(createDivider());
            nodes.push(createStandardRow(
                capTr(lang, '5小时剩余额度', '5 小時剩餘額度', '5h Remaining Quota'),
                `${qPct}%${resetText ? ' · ' + resetText : ''}`
            ));
        }

        // 8. 底部栏：步数统计（语言配置统一移至套件设置面板）
        const footerRow = document.createElement('div');
        footerRow.style.cssText = `border-top:1px solid ${borderColor};margin-top:6px;padding-top:5px;font-size:12px;color:${mutedColor};font-weight:400;display:flex;justify-content:space-between;gap:12px;min-width:0;`;
        const stepsSpan = document.createElement('span');
        stepsSpan.textContent = `${capTr(lang, '步数', '步數', 'Steps')}: ${data.stepCount || 0}`;
        footerRow.appendChild(stepsSpan);
        nodes.push(footerRow);

        if (typeof el.replaceChildren === 'function') {
            el.replaceChildren(...nodes);
        } else {
            while (el.firstChild) el.removeChild(el.firstChild);
            for (const n of nodes) el.appendChild(n);
        }

        // 定位在胶囊正上方
        const rect = capsuleBtn.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - elRect.width / 2;
        left = Math.max(8, Math.min(window.innerWidth - elRect.width - 8, left));
        let top = rect.top - elRect.height - 8;
        if (top < 8) top = rect.bottom + 8;

        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    }

    function hideTooltip() {
        activeTooltipTarget = null;
        if (tooltipEl) {
            tooltipEl.style.opacity = '0';
            tooltipEl.style.transform = 'translateY(3px)';
        }
    }

    // 使用纯原生 DOM + SVG API 构建胶囊按钮子节点 (纯节点树组装，兼容严格内容安全策略)
    function createSvgEl(tag, attrs = {}) {
        const svgNs = 'http://www.w3.org/2000/svg';
        const el = document.createElementNS(svgNs, tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, String(v));
        }
        return el;
    }

    function populateCapsuleButtonDom(capsuleBtn) {
        const lang = getLangMode();

        const speedWrap = document.createElement('span');
        speedWrap.className = 'agy-ctx-speed';
        speedWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:4px;opacity:0.85;';

        const boltSvg = createSvgEl('svg', { width: 10, height: 12, viewBox: '0 0 12 14', fill: 'currentColor' });
        boltSvg.style.cssText = 'display:block;opacity:0.8;';
        boltSvg.appendChild(createSvgEl('path', { d: 'M7.2 1L1.5 8h4.2L4.8 13l5.7-7H6.3L7.2 1z' }));

        const speedVal = document.createElement('span');
        speedVal.className = 'agy-ctx-speed-val';
        const speedNum = document.createElement('span');
        speedNum.className = 'agy-ctx-speed-num';
        speedNum.textContent = '--';
        const speedUnit = document.createElement('span');
        speedUnit.className = 'agy-ctx-speed-unit';
        speedUnit.textContent = ' tok/s';
        speedVal.appendChild(speedNum);
        speedVal.appendChild(speedUnit);

        speedWrap.appendChild(boltSvg);
        speedWrap.appendChild(speedVal);

        const tokensWrap = document.createElement('span');
        tokensWrap.className = 'agy-ctx-tokens';
        tokensWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';

        const trackSvg = createSvgEl('svg', { width: 18, height: 12, viewBox: '0 0 18 12', class: 'shrink-0' });
        trackSvg.style.cssText = 'display:block;';
        trackSvg.appendChild(createSvgEl('rect', {
            x: 1, y: 1.8, width: 16, height: 8.4, rx: 4.2,
            fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-opacity': 0.5
        }));
        trackSvg.appendChild(createSvgEl('rect', {
            class: 'agy-ctx-fill', x: 2.8, y: 3.4, width: 12.4, height: 5.2, rx: 2.6, fill: getThemeAccentColor(capsuleBtn)
        }));

        const labelSpan = document.createElement('span');
        labelSpan.className = 'agy-ctx-label';
        labelSpan.textContent = '0k/256k';

        tokensWrap.appendChild(trackSvg);
        tokensWrap.appendChild(labelSpan);

        const occWrap = document.createElement('span');
        occWrap.className = 'agy-ctx-occ';
        occWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;opacity:0.92;';
        occWrap.setAttribute('aria-label', capTr(lang, '上下文窗口占用率', '上下文視窗佔用率', 'Context Window Occupancy'));

        const occIcon = createSvgEl('svg', {
            class: 'agy-ctx-occ-icon shrink-0', width: 11, height: 11, viewBox: '0 0 16 16',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 1.65,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        });
        occIcon.style.cssText = 'display:block;opacity:0.82;';
        occIcon.appendChild(createSvgEl('path', { d: 'M14 8A6 6 0 1 1 8 2' }));
        occIcon.appendChild(createSvgEl('path', { d: 'M8 2a6 6 0 0 1 6 6H8z' }));

        const occVal = document.createElement('span');
        occVal.className = 'agy-ctx-occ-val';
        occVal.textContent = '0%';

        occWrap.appendChild(occIcon);
        occWrap.appendChild(occVal);

        const cacheWrap = document.createElement('span');
        cacheWrap.className = 'agy-ctx-cache';
        cacheWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;opacity:0.88;';
        cacheWrap.setAttribute('aria-label', capTr(lang, '最新快照缓存命中率', '最新快照快取命中率', 'Latest Snapshot Cache Hit Rate'));

        const cacheIcon = createSvgEl('svg', {
            class: 'agy-ctx-cache-icon shrink-0', width: 11, height: 11, viewBox: '0 0 16 16',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        });
        cacheIcon.style.cssText = 'display:block;opacity:0.82;';
        cacheIcon.appendChild(createSvgEl('ellipse', { cx: 8, cy: 3.5, rx: 5, ry: 2 }));
        cacheIcon.appendChild(createSvgEl('path', { d: 'M3 3.5v4.5c0 1.1 2.24 2 5 2s5-.9 5-2V3.5' }));
        cacheIcon.appendChild(createSvgEl('path', { d: 'M3 8v4.5c0 1.1 2.24 2 5 2s5-.9 5-2V8' }));

        const cacheVal = document.createElement('span');
        cacheVal.className = 'agy-ctx-cache-val';
        cacheVal.textContent = '--%';

        cacheWrap.appendChild(cacheIcon);
        cacheWrap.appendChild(cacheVal);

        capsuleBtn.appendChild(speedWrap);
        capsuleBtn.appendChild(tokensWrap);
        capsuleBtn.appendChild(occWrap);
        capsuleBtn.appendChild(cacheWrap);
    }

    // 在单个 .agy-composer-footer 内创建或更新 3A 莫兰迪跑道胶囊
    function renderFooterCapsule(footerEl, usageData) {
        if (!footerEl) return;
        ensureCapsuleStyle();
        let capsuleBtn = footerEl.querySelector('[data-agy-context-capsule="1"]');
        const permBtn = footerEl.querySelector('button[data-testid="permissions-selector-trigger"]');

        if (!capsuleBtn) {
            capsuleBtn = document.createElement('button');
            capsuleBtn.type = 'button';
            capsuleBtn.setAttribute('data-agy-context-capsule', '1');
            capsuleBtn.setAttribute('translate', 'no');
            capsuleBtn.className = 'notranslate flex cursor-pointer items-center h-7 gap-1.5 rounded-full px-2 text-xs text-secondary-foreground select-none hover:bg-secondary transition-colors shrink-0 whitespace-nowrap';
            capsuleBtn.style.fontVariantNumeric = 'tabular-nums';
            capsuleBtn.style.fontFeatureSettings = '"tnum" 1';

            populateCapsuleButtonDom(capsuleBtn);

            capsuleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    window.__AGContextMeter?.toggle?.(true, 'context');
                } catch {}
            });
            capsuleBtn.addEventListener('mouseenter', () => {
                activeTooltipTarget = capsuleBtn;
                updateTooltipContent(capsuleBtn);
                if (userStatusCache.modelConfigs.length === 0 || Date.now() - userStatusCache.fetchedAt > 10000) {
                    refreshUserStatus(true).then(() => {
                        renderAllFooters();
                        if (activeTooltipTarget === capsuleBtn) {
                            updateTooltipContent(capsuleBtn);
                        }
                    });
                }
            });
            capsuleBtn.addEventListener('mouseleave', () => {
                if (activeTooltipTarget === capsuleBtn) hideTooltip();
            });

            if (permBtn && permBtn.parentNode) {
                permBtn.parentNode.insertBefore(capsuleBtn, permBtn);
            } else {
                const rightBox = footerEl.querySelector('.shrink-0.flex.items-center');
                if (rightBox) {
                    rightBox.insertBefore(capsuleBtn, rightBox.firstChild);
                } else {
                    footerEl.appendChild(capsuleBtn);
                }
            }
        } else {
            if (!capsuleBtn.querySelector('.agy-ctx-occ') || !capsuleBtn.querySelector('.agy-ctx-cache') || !capsuleBtn.querySelector('.agy-ctx-speed-num')) {
                if (typeof capsuleBtn.replaceChildren === 'function') capsuleBtn.replaceChildren();
                else {
                    while (capsuleBtn.firstChild) capsuleBtn.removeChild(capsuleBtn.firstChild);
                }
                populateCapsuleButtonDom(capsuleBtn);
            }
            if (permBtn && permBtn.parentNode && capsuleBtn.nextSibling !== permBtn) {
                permBtn.parentNode.insertBefore(capsuleBtn, permBtn);
            }
        }

        capsuleBtn.__ctxUsageData = usageData;

        const lang = getLangMode();
        const light = isLightMode(capsuleBtn);
        capsuleBtn.setAttribute('data-ag-theme', light ? 'light' : 'dark');
        const dangerTextColor = light ? '#dc2626' : MORANDI_3A.red;
        const alertState = resolveCacheAlertState(usageData);
        const color = getEffectiveCapsuleColor(usageData, capsuleBtn);
        const remainPct = Math.max(0, Math.min(100, 100 - usageData.usagePercent));
        const fillWidth = Math.max(2.2, (12.4 * remainPct) / 100).toFixed(1);

        const fillRect = capsuleBtn.querySelector('.agy-ctx-fill');
        if (fillRect) {
            if (fillRect.getAttribute('width') !== fillWidth) fillRect.setAttribute('width', fillWidth);
            if (fillRect.getAttribute('fill') !== color) fillRect.setAttribute('fill', color);
        }

        const usedStr = formatTokenValue(usageData.contextUsed);
        const limitStr = formatTokenValue(usageData.contextLimit);
        const pctStr = usageData.usagePercent.toFixed(1).replace(/\.0$/, '') + '%';
        const nextText = `${usedStr}/${limitStr}`;

        const labelSpan = capsuleBtn.querySelector('.agy-ctx-label');
        if (labelSpan && labelSpan.textContent !== nextText) {
            labelSpan.textContent = nextText;
        }

        const occWrap = capsuleBtn.querySelector('.agy-ctx-occ');
        if (occWrap) {
            occWrap.setAttribute('aria-label', capTr(lang, '上下文窗口占用率', '上下文視窗佔用率', 'Context Window Occupancy'));
            if (occWrap.hasAttribute?.('title')) occWrap.removeAttribute('title');
        }
        const occValSpan = capsuleBtn.querySelector('.agy-ctx-occ-val');
        if (occValSpan && occValSpan.textContent !== pctStr) {
            occValSpan.textContent = pctStr;
        }

        const cacheWrap = capsuleBtn.querySelector('.agy-ctx-cache');
        if (cacheWrap) {
            cacheWrap.setAttribute('data-cache-alert', alertState.isCacheDrop ? 'drop' : (alertState.isCliff328k ? 'cliff' : 'none'));
            if (cacheWrap.hasAttribute?.('title')) cacheWrap.removeAttribute('title');
            if (alertState.isCacheDrop) {
                cacheWrap.style.color = dangerTextColor;
                cacheWrap.style.fontWeight = '600';
                cacheWrap.style.opacity = '1';
                cacheWrap.setAttribute('aria-label', capTr(
                    lang,
                    '上下文缓存已失效！需要重读全部前文，可能卡顿 4~5 分钟并加速消耗额度，建议立即发 /compact 压缩',
                    '上下文快取已失效！需要重讀全部前文，可能卡頓 4~5 分鐘並加速消耗額度，建議立即傳送 /compact 壓縮',
                    'Context cache expired! Re-reading full history causes 4-5m lag & extra quota drain. Run /compact now'
                ));
            } else {
                cacheWrap.style.color = '';
                cacheWrap.style.fontWeight = '';
                cacheWrap.style.opacity = '0.88';
                cacheWrap.setAttribute('aria-label', capTr(lang, '最新快照缓存命中率', '最新快照快取命中率', 'Latest Snapshot Cache Hit Rate'));
            }
        }
        const cacheValSpan = capsuleBtn.querySelector('.agy-ctx-cache-val');
        if (cacheValSpan) {
            const hasCacheMetrics = Boolean(
                usageData && (usageData.hasPreciseSnapshot || usageData.contextUsed > 0 || usageData.cacheReadTokens > 0)
            ) && Number.isFinite(usageData.cacheHitRate);
            const cacheStr = hasCacheMetrics
                ? cacheRateFormat.format(Math.max(0, Math.min(100, usageData.cacheHitRate))) + '%'
                : '--%';
            if (cacheValSpan.textContent !== cacheStr) {
                cacheValSpan.textContent = cacheStr;
            }
        }

        const speedNumSpan = capsuleBtn.querySelector('.agy-ctx-speed-num');
        const speedUnitSpan = capsuleBtn.querySelector('.agy-ctx-speed-unit');
        const speedValSpan = capsuleBtn.querySelector('.agy-ctx-speed-val');
        if (speedNumSpan) {
            const numText = usageData.tokPerSec > 0 ? String(usageData.tokPerSec) : '--';
            if (speedNumSpan.textContent !== numText) {
                speedNumSpan.textContent = numText;
            }
            if (speedUnitSpan && speedUnitSpan.textContent !== ' tok/s') {
                speedUnitSpan.textContent = ' tok/s';
            }
        } else if (speedValSpan) {
            const speedText = usageData.tokPerSec > 0 ? `${usageData.tokPerSec} tok/s` : '-- tok/s';
            if (speedValSpan.textContent !== speedText) {
                speedValSpan.textContent = speedText;
            }
        }

        applyResponsiveTierToCapsule(capsuleBtn);

        if (activeTooltipTarget === capsuleBtn) {
            updateTooltipContent(capsuleBtn);
        }
    }

    const CAPSULE_TIER_THRESHOLDS = { compact: 560, tight: 470, minimal: 390, hysteresis: 24 };
    const CAPSULE_TIERS_ORDER = ['full', 'compact', 'tight', 'minimal'];
    let capsuleResizeObserver = null;
    let capsuleResizeTimer = null;
    const observedCapsuleHosts = typeof WeakSet === 'function' ? new WeakSet() : null;

    function computeCapsuleTier(width, prevTier = 'full') {
        const w = Number(width);
        if (!Number.isFinite(w) || w <= 0) return prevTier || 'full';
        const { compact, tight, minimal, hysteresis } = CAPSULE_TIER_THRESHOLDS;
        const curIdx = Math.max(0, CAPSULE_TIERS_ORDER.indexOf(prevTier));
        if (curIdx <= 0) {
            if (w < minimal) return 'minimal';
            if (w < tight) return 'tight';
            if (w < compact) return 'compact';
            return 'full';
        }
        if (curIdx === 1) {
            if (w < minimal) return 'minimal';
            if (w < tight) return 'tight';
            if (w >= compact + hysteresis) return 'full';
            return 'compact';
        }
        if (curIdx === 2) {
            if (w < minimal) return 'minimal';
            if (w >= compact + hysteresis) return 'full';
            if (w >= tight + hysteresis) return 'tight' === prevTier ? 'compact' : 'tight';
            return 'tight';
        }
        if (w >= compact + hysteresis) return 'full';
        if (w >= tight + hysteresis) return 'compact';
        if (w >= minimal + hysteresis) return 'tight';
        return 'minimal';
    }

    function applyResponsiveTierToCapsule(capsuleBtn) {
        if (!capsuleBtn) return;
        const container = capsuleBtn.closest?.('.agy-composer-footer') || capsuleBtn.parentElement;
        if (container && typeof ResizeObserver === 'function') {
            if (!capsuleResizeObserver) {
                capsuleResizeObserver = new ResizeObserver(() => {
                    if (capsuleResizeTimer) clearTimeout(capsuleResizeTimer);
                    capsuleResizeTimer = setTimeout(() => {
                        document.querySelectorAll('[data-agy-context-capsule="1"]').forEach((btn) => {
                            applyResponsiveTierToCapsule(btn);
                        });
                    }, 80);
                });
            }
            if (!observedCapsuleHosts || !observedCapsuleHosts.has(container)) {
                try {
                    capsuleResizeObserver.observe(container);
                    observedCapsuleHosts?.add(container);
                } catch {}
            }
        }
        const rect = container?.getBoundingClientRect?.();
        const width = Number(rect?.width || container?.clientWidth || 0);
        const prevTier = capsuleBtn.getAttribute('data-agy-tier') || 'full';
        let nextTier = width > 0 ? computeCapsuleTier(width, prevTier) : prevTier;
        capsuleBtn.setAttribute('data-agy-tier', nextTier);
        try {
            const cScroll = Number(capsuleBtn.scrollWidth || 0);
            const cClient = Number(capsuleBtn.clientWidth || 0);
            if (cClient > 0 && cScroll > cClient + 4) {
                const idx = CAPSULE_TIERS_ORDER.indexOf(nextTier);
                if (idx >= 0 && idx < CAPSULE_TIERS_ORDER.length - 1) {
                    nextTier = CAPSULE_TIERS_ORDER[idx + 1];
                    capsuleBtn.setAttribute('data-agy-tier', nextTier);
                }
            }
        } catch {}
    }

    // 选择兜底活跃会话
    function findFallbackConversationId() {
        let bestId = '';
        let bestTime = 0;
        for (const [cid, sum] of trajectoriesMap.entries()) {
            if (sum.status && sum.status.includes('RUNNING')) return cid;
            const t = new Date(sum.lastModifiedTime || 0).getTime();
            if (t > bestTime) {
                bestTime = t;
                bestId = cid;
            }
        }
        return bestId;
    }

    // 渲染页面上所有的 .agy-composer-footer (同时支持本地缓存、云端 Fiber 步骤与 DOM 实时感知兜底)
    function renderAllFooters() {
        const footers = document.querySelectorAll('.agy-composer-footer');
        if (!footers || footers.length === 0) return;

        for (const footer of footers) {
            const ctx = extractComposerContext(footer);
            const cid = ctx.conversationId;
            const quotaInfo = findQuotaForModel(ctx.modelId, ctx.modelLabel, ctx.quotaInfo, ctx.fiberModelConfigs);

            let baseUsage = null;
            if (cid && sessionCache.has(cid)) {
                baseUsage = sessionCache.get(cid).usage;
            }
            // 若 sessionCache 中尚无数据或为 0，立即尝试从 Fiber 步骤或 DOM 实时感知计算 (解决云端项目显示全 0 问题)
            if (!baseUsage || baseUsage.contextUsed === 0) {
                if (Array.isArray(ctx.fiberSteps) && ctx.fiberSteps.length > 0) {
                    const rtLimits = getRuntimeLimitInfo(cid, cid ? normalizeCidKey(cid) : '', ctx);
                    baseUsage = analyzeSteps(ctx.fiberSteps, ctx.modelId, ctx.modelLabel, Math.max(ctx.fiberStepCount, ctx.fiberSteps.length), rtLimits);
                } else {
                    const domUsage = computeDomFallbackUsage(footer, cid, ctx.modelId, ctx.modelLabel);
                    if (domUsage && domUsage.contextUsed > 0) {
                        baseUsage = domUsage;
                    }
                }
            }

            if (baseUsage) {
                const effectiveModelId = ctx.modelId || baseUsage.modelId;
                const modelSwitched = Boolean(ctx.modelId && baseUsage.modelId && normalizeModelKey(ctx.modelId) !== normalizeModelKey(baseUsage.modelId));
                const effectiveLabel = ctx.modelLabel || (modelSwitched ? '' : baseUsage.modelDisplayName);
                const shortCid = cid ? normalizeCidKey(cid) : '';
                const cachedEntry = cid ? sessionCache.get(cid) : null;
                const rtLimits = getRuntimeLimitInfo(cid, shortCid, ctx, cachedEntry?.baseOffset || 0);
                if (cachedEntry?.steps?.length && rtLimits.generatorUsageMaxStepIndex >= 0 && rtLimits.generatorUsageMaxStepIndex > (baseUsage.exactUsageStepIndex ?? -1)) {
                    baseUsage = analyzeSteps(cachedEntry.steps, effectiveModelId, effectiveLabel, cachedEntry.stepCount || cachedEntry.steps.length, rtLimits);
                    cachedEntry.usage = baseUsage;
                }
                const runtimeInfo = sessionRuntimeBudgetMap.get(cid) || (shortCid ? sessionRuntimeBudgetMap.get(shortCid) : null) || null;
                const fiberMax = toPositiveIntLimit(ctx.modelMaxTokens) || (modelSwitched ? 0 : toPositiveIntLimit(baseUsage.modelMaxTokens));
                const physicalMaxTokens = getPhysicalMaxTokensForModel(effectiveModelId, effectiveLabel, { fiberMaxTokens: fiberMax });
                const mergedRtBudget = modelSwitched
                    ? 0
                    : (rtLimits.runtimeBudget || runtimeInfo?.maxContextTokens || toPositiveIntLimit(ctx.observedBudget) || toPositiveIntLimit(baseUsage.runtimeBudget));
                const customFixed = resolveCustomFixedContextLimit(effectiveModelId, effectiveLabel, 0);
                const dynamicLimit = resolveCompressionBudgetForModel(effectiveModelId, effectiveLabel, {
                    runtimeBudget: mergedRtBudget,
                    runtimeModelKey: rtLimits.runtimeModelKey || runtimeInfo?.modelKey || baseUsage.runtimeModelKey || '',
                    fiberMaxTokens: fiberMax
                });
                const usagePercent = dynamicLimit > 0 ? (baseUsage.contextUsed / dynamicLimit) * 100 : 0;
                const remainPercent = Math.max(0, 100 - usagePercent);
                const effectiveQuota = quotaInfo || findQuotaForModel(effectiveModelId, effectiveLabel, null, ctx.fiberModelConfigs) || baseUsage.quotaInfo;
                const absCpIdx = typeof baseUsage.lastCheckpointStepIdx === 'number' ? baseUsage.lastCheckpointStepIdx : -1;
                const absLastPlanner = typeof baseUsage.lastPlannerStepIdx === 'number' ? baseUsage.lastPlannerStepIdx : -1;
                const rtMaxStep = rtLimits.generatorMaxStepIndex;
                const rtNotBeforeCp = absCpIdx < 0 || (rtMaxStep >= 0 && rtMaxStep > absCpIdx);
                const rtProvenLatestUnindexed = baseUsage.lastPlannerUsageSig
                    ? Boolean(baseUsage.lastPlannerSignatureUnique && rtLimits.generatorUsageSignature && rtLimits.generatorUsageSignature === baseUsage.lastPlannerUsageSig)
                    : Boolean(baseUsage.canAdoptUnindexedSingleTurnGm);
                const rtNotBehindPlanner = absLastPlanner < 0
                    ? true : (rtMaxStep >= 0 ? rtMaxStep >= absLastPlanner : rtProvenLatestUnindexed);
                const useRtStreamSpeed = Boolean(!modelSwitched && rtLimits.generatorStreamingTps > 0 && rtNotBeforeCp && rtNotBehindPlanner);
                const rtSameTurnAsBase = (rtMaxStep >= 0 && rtMaxStep === absLastPlanner) || Boolean(baseUsage.lastPlannerSignatureUnique && rtLimits.generatorUsageSignature && rtLimits.generatorUsageSignature === baseUsage.lastPlannerUsageSig);
                const usage = Object.assign({}, baseUsage, {
                    conversationId: cid || baseUsage.conversationId || '', contextLimit: dynamicLimit, physicalMaxTokens,
                    runtimeBudget: mergedRtBudget, hasExplicitRuntimeBudget: mergedRtBudget > 0, hasCustomFixedLimit: customFixed > 0,
                    usagePercent, remainPercent,
                    tokPerSec: useRtStreamSpeed ? rtLimits.generatorStreamingTps : baseUsage.tokPerSec,
                    lastDurationSec: useRtStreamSpeed ? (rtLimits.generatorDurationSec > 0 ? rtLimits.generatorDurationSec : (rtSameTurnAsBase ? baseUsage.lastDurationSec : 0)) : baseUsage.lastDurationSec,
                    ttftSec: useRtStreamSpeed ? (rtLimits.generatorTtftSec > 0 ? rtLimits.generatorTtftSec : (rtSameTurnAsBase ? baseUsage.ttftSec : 0)) : baseUsage.ttftSec,
                    outputTokens: useRtStreamSpeed ? ((rtSameTurnAsBase && baseUsage.outputTokens > 0) ? baseUsage.outputTokens : (rtLimits.generatorOutputTokens || 0)) : baseUsage.outputTokens,
                    modelDisplayName: resolveModelDisplayName(effectiveModelId, effectiveLabel), quotaInfo: effectiveQuota
                });
                renderFooterCapsule(footer, usage);
            } else {
                const fiberMax = toPositiveIntLimit(ctx.modelMaxTokens);
                const physicalMaxTokens = getPhysicalMaxTokensForModel(ctx.modelId, ctx.modelLabel, {
                    fiberMaxTokens: fiberMax
                });
                const limit = resolveCompressionBudgetForModel(ctx.modelId, ctx.modelLabel, {
                    fiberMaxTokens: fiberMax,
                    runtimeBudget: toPositiveIntLimit(ctx.observedBudget)
                });
                const emptyUsage = {
                    conversationId: cid || '',
                    contextUsed: 0,
                    contextLimit: limit,
                    physicalMaxTokens,
                    usagePercent: 0,
                    remainPercent: 100,
                    inputTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    outputTokens: 0,
                    estimatedDelta: 0,
                    hasPreciseSnapshot: false,
                    cacheHitRate: 0,
                    tokPerSec: 0,
                    avgTokPerSec: 0,
                    lastDurationSec: 0,
                    compressionDetected: false,
                    compressionBefore: 0,
                    compressionAfter: 0,
                    compressionDrop: 0,
                    modelId: ctx.modelId,
                    modelDisplayName: resolveModelDisplayName(ctx.modelId, ctx.modelLabel),
                    stepCount: 0,
                    quotaInfo
                };
                renderFooterCapsule(footer, emptyUsage);
            }
        }
    }

    // 轮询同步最新轨迹与配额状态 (解除 trajectoriesMap.has(cid) 限制，全面支持本地项目 + 云端项目 + 网页端)
    async function pollCycle() {
        if (isPolling) return;
        isPolling = true;
        try {
            const footers = Array.from(document.querySelectorAll('.agy-composer-footer'));
            if (footers.length === 0) return;

            // 1. 每 30 秒刷新一次 GetUserStatus
            await refreshUserStatus(false);

            // 2. 拉取本地会话摘要列表 (若在云端/网页端返回空也不阻塞后续流程)
            const trajResp = await callLsRpc('GetAllCascadeTrajectories', {
                metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
            });
            if (trajResp && trajResp.trajectorySummaries) {
                trajectoriesMap.clear();
                for (const [cid, sum] of Object.entries(trajResp.trajectorySummaries)) {
                    trajectoriesMap.set(cid, sum);
                    const shortKey = normalizeCidKey(cid);
                    if (shortKey) trajectoriesMap.set(shortKey, sum);
                }
            }

            // 3. 针对当前页面上所有可见对话框并行刷新 (无论是否在本地 trajectoriesMap 中均执行刷新)
            const activeTasks = [];
            const seenCids = new Set();
            for (const footer of footers) {
                const ctx = extractComposerContext(footer);
                let cid = ctx.conversationId;
                if ((!cid || cid.startsWith('__agy_panel_')) && footers.length === 1 && trajectoriesMap.size === 1) {
                    cid = findFallbackConversationId() || cid;
                }
                if (cid && !seenCids.has(cid)) {
                    seenCids.add(cid);
                    const shortCid = normalizeCidKey(cid);
                    const summary = trajectoriesMap.get(cid) || (shortCid ? trajectoriesMap.get(shortCid) : null) || null;
                    activeTasks.push(
                        refreshConversationUsage(cid, summary, ctx.modelId, ctx.modelLabel, ctx, footer)
                    );
                }
            }
            if (activeTasks.length > 0) {
                await Promise.allSettled(activeTasks);
            }

            // 4. 更新所有底部工具栏胶囊 UI
            renderAllFooters();
        } catch (e) {
            // 静默容错
        } finally {
            isPolling = false;
        }
    }

    // 监听 DOM 与主题变化：切换会话、打开新聊天框、流式输出或切换白天/黑夜模式时即时响应
    let mutationTimer = null;
    const domObserver = new MutationObserver(() => {
        const footers = document.querySelectorAll('.agy-composer-footer');
        let needsImmediateRender = false;
        for (const f of footers) {
            if (!f.querySelector('[data-agy-context-capsule="1"]')) {
                needsImmediateRender = true;
                break;
            }
        }
        if (needsImmediateRender) {
            renderAllFooters();
        }
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            renderAllFooters();
            if (activeTooltipTarget) updateTooltipContent(activeTooltipTarget);
        }, 250);
    });

    // 判断当前页面是否具备 Antigravity 桌面或网页端宿主特征 (防止在普通 localhost 或无关网页挂载 fetch 钩子)
    function isLikelyAntigravityHost() {
        if (isElectronHost) return true;
        try {
            const host = (typeof location !== 'undefined' && location.hostname ? location.hostname : '').toLowerCase();
            if (
                host === 'antigravity.google' ||
                host.endsWith('.antigravity.google') ||
                host.startsWith('antigravity.') ||
                host.includes('-antigravity.')
            ) {
                return true;
            }
            if (Boolean((window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken) || localStorage.getItem('agy_session_csrf_token'))) {
                return true;
            }
            if (
                document.querySelector('.agy-composer-footer') ||
                document.querySelector('button[data-testid="permissions-selector-trigger"]')
            ) {
                return true;
            }
            const title = (document.title || '').toLowerCase();
            if (title.includes('antigravity') && document.querySelector('textarea, [contenteditable="true"]')) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function activateCapsuleEngine() {
        if (engineActivated) return;
        const root = document.body || document.documentElement;
        if (!root) {
            setTimeout(activateCapsuleEngine, 200);
            return;
        }
        engineActivated = true;
        installNetworkSniffer();
        domObserver.observe(root, { childList: true, subtree: true });
        if (document.documentElement) {
            domObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-ag-theme-mode', 'style'] });
        }
        renderAllFooters();
        pollCycle();
        const onSuitePrefsChanged = () => {
            renderAllFooters();
            try {
                document.querySelectorAll('[data-agy-context-capsule="1"]').forEach((btn) => {
                    const fillRect = btn.querySelector?.('.agy-ctx-fill');
                    if (fillRect) {
                        const nextColor = getEffectiveCapsuleColor(btn.__ctxUsageData, btn);
                        if (fillRect.getAttribute('fill') !== nextColor) {
                            fillRect.setAttribute('fill', nextColor);
                        }
                    }
                });
            } catch {}
            if (activeTooltipTarget) updateTooltipContent(activeTooltipTarget);
        };
        try { window.addEventListener?.('ag-suite-prefs-changed', onSuitePrefsChanged); } catch {}
        window.__AGY_CTX_CAPSULE_API__ = {
            version: CAPSULE_VERSION,
            analyzeSteps,
            getContextLimitForModel,
            getPhysicalMaxTokensForModel,
            resolveCompressionBudgetForModel,
            resolveModelDisplayName,
            renderFooterCapsule,
            computeCapsuleTier,
            ingestAvailableModels: ingestAvailableModelsPayload,
            ingestUserStatusModelConfigs,
            ingestGeneratorMetadata: ingestGeneratorMetadataRows,
            getRuntimeLimitInfo,
            refreshConversationUsage,
            renderAllFooters,
            setTrajectorySummary: (cid, sum) => { if (cid && sum) trajectoriesMap.set(cid, sum); },
            clearCaches: () => {
                sessionCache.clear();
                availableModelsMap.clear();
                sessionRuntimeBudgetMap.clear();
                modelRuntimeBudgetMap.clear();
                sessionRuntimeSpeedMap.clear();
                domStreamTracker.clear();
                userStatusCache.modelConfigs = [];
            }
        };
        const __agyPollTimer = setInterval(pollCycle, 3000);
        window.__AGY_CTX_CAPSULE_DISPOSE__ = () => {
            try { clearInterval(__agyPollTimer); } catch {}
            try { window.removeEventListener?.('ag-suite-prefs-changed', onSuitePrefsChanged); } catch {}
            try { if (typeof mutationTimer !== "undefined" && mutationTimer) clearTimeout(mutationTimer); } catch {}
            try { if (capsuleResizeTimer) { clearTimeout(capsuleResizeTimer); capsuleResizeTimer = null; } } catch {}
            try { if (capsuleResizeObserver) { capsuleResizeObserver.disconnect(); capsuleResizeObserver = null; } } catch {}
            try { if (typeof domObserver !== "undefined") domObserver.disconnect(); } catch {}
            try {
                document.querySelectorAll("[data-agy-context-capsule=\"1\"]").forEach(el => el.remove());
                document.getElementById("__agy_ctx_capsule_tooltip__")?.remove();
                document.getElementById(CAPSULE_STYLE_ID)?.remove();
            } catch {}
            try { delete window.__AGY_CTX_CAPSULE_API__; } catch {}
            window.__AGY_CTX_CAPSULE_ACTIVE__ = false;
        };
    }

    function startCapsuleMonitor() {
        if (isLikelyAntigravityHost()) {
            activateCapsuleEngine();
            return;
        }
        // 在未知网页端 (如 localhost 或泛域名) 仅做 3 次轻量延迟嗅探，不命中则彻底休眠退出，零性能损耗
        const probeDelays = [1500, 5000, 12000];
        for (const delay of probeDelays) {
            setTimeout(() => {
                if (!engineActivated && isLikelyAntigravityHost()) {
                    activateCapsuleEngine();
                }
            }, delay);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startCapsuleMonitor);
    } else {
        startCapsuleMonitor();
    }
})();
