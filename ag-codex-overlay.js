/**
 * ag-codex-overlay.js — Antigravity Suite Codex Theme, Ink Quota & Native Settings Overlay
 * Self-contained browser runtime bundle (zero external dependencies, idempotent IIFE).
 */
(() => {
  'use strict';

  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  try { g.__AGCodexOverlay?.dispose?.(); } catch {}

  const win = typeof window !== 'undefined' ? window : g;
  const doc = typeof document !== 'undefined' ? document : null;
  if (win && Array.isArray(win.__ag_cleanup_fns)) {
    for (const fn of win.__ag_cleanup_fns.splice(0)) {
      try { if (typeof fn === 'function') fn(); } catch {}
    }
  }

  const IS_SWARM_PLUGIN_FRAME = Boolean(
    win &&
      win.top &&
      win.top !== win &&
      win.location &&
      win.location.protocol === 'plugin:' &&
      /^swarm--/i.test(win.location.hostname || '')
  );
  if (win && win.top && win.top !== win && !IS_SWARM_PLUGIN_FRAME) {
    return;
  }

  const OVERLAY_VERSION = '1.0.0';
  const STORAGE_KEY_CODEX_UI = 'ag_suite_codex_ui';
  const STORAGE_KEY_LOCALE = 'ag_suite_locale';
  const STORAGE_KEY_FEATURE_FLAGS = 'ag_suite_feature_flags';

  const AG_QUOTA_STYLES = ['segments', 'bar', 'rings', 'gauge', 'dots', 'compact'];
  const AG_QUOTA_OTHER_STYLES = ['lines', 'text', 'segments', 'rings', 'rows', 'hidden'];
  const AG_QUOTA_POOL_FILTERS = ['all', 'gemini-only', 'claude-only'];

  const DEFAULT_CODEX_UI = {
    quotaSidebar: true,
    quotaStyle: 'bar',
    quotaOtherStyle: 'hidden',
    quotaPoolFilter: 'all',
    codexTheme: false,
    deadlockHealer: true,
    zoomShortcuts: true,
    fonts: { mode: 'global', global: '', ui: '', chat: '', code: '' }
  };

  let disposed = false;

  /* ============================================================================
   * 1. Pure Helpers (exported via __AGCodexOverlay.helpers)
   * ============================================================================ */

  function normalizeQuotaStyle(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return AG_QUOTA_STYLES.includes(s) ? s : 'bar';
  }

  function normalizeQuotaOtherStyle(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return AG_QUOTA_OTHER_STYLES.includes(s) ? s : 'hidden';
  }

  function normalizeQuotaPoolFilter(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return AG_QUOTA_POOL_FILTERS.includes(s) ? s : 'all';
  }

  function normalizeFontsConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      mode: src.mode === 'split' ? 'split' : 'global',
      global: typeof src.global === 'string' ? src.global : '',
      ui: typeof src.ui === 'string' ? src.ui : '',
      chat: typeof src.chat === 'string' ? src.chat : '',
      code: typeof src.code === 'string' ? src.code : ''
    };
  }

  function normalizeCodexConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      quotaSidebar: src.quotaSidebar !== false,
      quotaStyle: normalizeQuotaStyle(src.quotaStyle || DEFAULT_CODEX_UI.quotaStyle),
      quotaOtherStyle: normalizeQuotaOtherStyle(src.quotaOtherStyle || DEFAULT_CODEX_UI.quotaOtherStyle),
      quotaPoolFilter: normalizeQuotaPoolFilter(src.quotaPoolFilter || DEFAULT_CODEX_UI.quotaPoolFilter),
      codexTheme: Boolean(src.codexTheme),
      deadlockHealer: src.deadlockHealer !== false,
      zoomShortcuts: src.zoomShortcuts !== false,
      fonts: normalizeFontsConfig(src.fonts)
    };
  }

  function normalizeLocaleCode(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
    if (!s) return '';
    if (s === 'zh-tw' || s === 'zh-hant' || s.startsWith('zh-hant-') || s === 'tw' || s === 'hant') return 'zh-TW';
    if (s === 'zh-cn' || s === 'zh-hans' || s.startsWith('zh-hans-') || s === 'zh' || s === 'cn' || s === 'hans') return 'zh-CN';
    if (s === 'en' || s.startsWith('en-')) return 'en';
    return '';
  }

  function resolveLocaleHint(localeOrIsZh) {
    if (localeOrIsZh === true) return 'zh-TW';
    if (localeOrIsZh === false) return 'en';
    const norm = normalizeLocaleCode(localeOrIsZh);
    return norm || 'zh-TW';
  }

  function cleanModelLabel(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s
      .replace(/^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:\s*/i, '')
      .replace(/^模型(?:[選选][擇择]器)?(?:[，,]\s*(?:目前|当前))?[：:]\s*/, '')
      .trim();
    s = s
      .replace(/\.\s+(?:Applies\s+to|Model\s+cannot|Cannot\s+be|Disabled|Locked)[\s\S]*$/i, '')
      .replace(/[。.]\s*(?:適用於|Agent 執行期間|對話中途無法|适用于|智能体运行期间|会话中途无法)[\s\S]*$/, '')
      .replace(/,\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|Disabled|Locked)[\s\S]*$/i, '')
      .replace(
        /\s*[（(]\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|Agent 執行期間無法切換模型|對話中途無法更改|智能体运行期间无法切换模型|会话中途无法更改)[^）)]*[）)]\s*$/i,
        ''
      )
      .replace(/\s*,\s*[^,]+$/i, (m) =>
        /(?:cannot|while|running|disabled|locked|unavailable|[無无]法|執行期間|运行期间)/i.test(m) ? '' : m
      )
      .trim();
    if (/^(?:Select model|[選选][擇择]模型)$/i.test(s)) return '';
    return s;
  }

  function normalizeModelMatchKey(label) {
    return cleanModelLabel(label)
      .toLowerCase()
      .replace(/\(\s*extra[\s_-]*high\s*\)|\bextra[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*x[\s_-]*high\s*\)|\bx[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*extra\s*\)|\bextra\b/g, 'extrahigh')
      .replace(/[^a-z0-9]+/g, '');
  }

  function parseQuotaResetMs(resetTime) {
    if (!resetTime || typeof resetTime !== 'object') return null;
    const rawSec = resetTime.seconds;
    if (rawSec === undefined || rawSec === null || rawSec === '') return null;
    const sec = Number(rawSec);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    const nanos = Number(resetTime.nanos || 0);
    const ms = sec * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1e6) : 0);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  function formatShortPoolLabel(displayName) {
    const raw = String(displayName || '').trim();
    if (!raw) return 'Quota';
    if (/gemini/i.test(raw)) return 'Gemini';
    if (/claude/i.test(raw) && /gpt/i.test(raw)) return 'Claude·GPT';
    const cleaned = raw
      .replace(/\s+models?$/i, '')
      .replace(/\s*(?:and|&|\/)\s*/gi, '·')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 14 ? cleaned.slice(0, 13) + '…' : cleaned || raw;
  }

  function extractGroupModelNames(description) {
    const desc = String(description || '');
    const m = desc.match(/models\s+within\s+this\s+group\s*:\s*([^\n]+)/i);
    if (!m || !m[1]) return [];
    const body = m[1].replace(/\.\s*$/, '');
    return body
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function parseQuotaBucket(rawBucket) {
    if (!rawBucket || typeof rawBucket !== 'object') return null;
    if (rawBucket.disabled === true) return null;
    const winName = String(rawBucket.window || '').trim().toLowerCase();
    if (winName !== '5h' && winName !== 'weekly') return null;
    const rem = rawBucket.remaining;
    if (!rem || rem.case !== 'remainingFraction') return null;
    const frac = Number(rem.value);
    if (!Number.isFinite(frac)) return null;
    const clampedFrac = Math.max(0, Math.min(1, frac));
    const pct = Math.round(clampedFrac * 100);
    return {
      window: winName,
      remainingFraction: clampedFrac,
      pct,
      resetMs: parseQuotaResetMs(rawBucket.resetTime)
    };
  }

  function parseQuotaSummary(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'object') return [];
    const inner =
      rawResponse.response && typeof rawResponse.response === 'object' ? rawResponse.response : rawResponse;
    const rawGroups = Array.isArray(inner.groups) ? inner.groups : [];
    const groups = [];
    for (let i = 0; i < rawGroups.length; i++) {
      const grp = rawGroups[i];
      if (!grp || typeof grp !== 'object') continue;
      const rawBuckets = Array.isArray(grp.buckets) ? grp.buckets : [];
      let fiveHour = null;
      let weekly = null;
      for (let j = 0; j < rawBuckets.length; j++) {
        const parsed = parseQuotaBucket(rawBuckets[j]);
        if (!parsed) continue;
        if (parsed.window === '5h' && !fiveHour) fiveHour = parsed;
        if (parsed.window === 'weekly' && !weekly) weekly = parsed;
      }
      if (!fiveHour && !weekly) continue;
      const displayName = String(grp.displayName || '').trim();
      const description = String(grp.description || '').trim();
      groups.push({
        displayName,
        shortLabel: formatShortPoolLabel(displayName),
        description,
        models: extractGroupModelNames(description),
        fiveHour,
        weekly
      });
    }
    return groups;
  }

  function quotaModelMatchKey(label) {
    return normalizeModelMatchKey(label);
  }

  function stripQuotaEffortSuffix(label) {
    return String(label || '')
      .replace(
        /(?:\s*[（(]?\s*(?:extra[\s_-]*high|x[\s_-]*high|minimal|low|medium|high|max|thinking)\s*[）)]?\s*)+$/i,
        ''
      )
      .trim();
  }

  function scoreQuotaModelMatch(modelKey, modelBaseKey, rawModelTokens, itemName) {
    const itemKey = quotaModelMatchKey(itemName);
    if (!modelKey || !itemKey) return 0;
    if (modelKey === itemKey || (modelBaseKey && modelBaseKey === itemKey)) {
      return 1000 + itemKey.length;
    }
    if (
      modelKey.startsWith(itemKey) ||
      itemKey.startsWith(modelKey) ||
      (modelBaseKey && (modelBaseKey.startsWith(itemKey) || itemKey.startsWith(modelBaseKey)))
    ) {
      return 700 + Math.min((modelBaseKey || modelKey).length, itemKey.length);
    }
    if (
      modelKey.includes(itemKey) ||
      itemKey.includes(modelKey) ||
      (modelBaseKey && (modelBaseKey.includes(itemKey) || itemKey.includes(modelBaseKey)))
    ) {
      return 400 + Math.min((modelBaseKey || modelKey).length, itemKey.length);
    }
    const itemTokens = String(itemName || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t.length >= 2);
    if (rawModelTokens.length > 0 && itemTokens.length > 0) {
      let overlap = 0;
      for (let i = 0; i < rawModelTokens.length; i++) {
        if (itemTokens.includes(rawModelTokens[i])) overlap++;
      }
      if (overlap >= 2) return 150 * overlap;
    }
    return 0;
  }

  function matchActiveQuotaGroupIndex(groups, modelLabel) {
    if (!Array.isArray(groups) || groups.length === 0) return -1;
    const rawLabel = String(modelLabel || '').trim();
    if (!rawLabel) return 0;

    const modelKey = quotaModelMatchKey(rawLabel);
    const modelBaseKey = quotaModelMatchKey(stripQuotaEffortSuffix(rawLabel));
    const rawModelTokens = stripQuotaEffortSuffix(rawLabel)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t.length >= 2);

    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < groups.length; i++) {
      const grp = groups[i];
      const models = Array.isArray(grp.models) ? grp.models : extractGroupModelNames(grp.description);
      let groupBest = 0;
      for (let j = 0; j < models.length; j++) {
        const sc = scoreQuotaModelMatch(modelKey, modelBaseKey, rawModelTokens, models[j]);
        if (sc > groupBest) groupBest = sc;
      }
      if (groupBest > bestScore) {
        bestScore = groupBest;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) return bestIdx;

    const geminiIdx = groups.findIndex((grp) => /gemini/i.test(grp.displayName || ''));
    const nonGeminiIdx = groups.findIndex((grp) => !/gemini/i.test(grp.displayName || ''));
    if (/gemini|orchestrator/i.test(rawLabel)) {
      return geminiIdx >= 0 ? geminiIdx : 0;
    }
    return nonGeminiIdx >= 0 ? nonGeminiIdx : 0;
  }

  function filterQuotaGroupsForDisplay(groups, modelLabel, poolFilter) {
    if (!Array.isArray(groups) || groups.length === 0) {
      return { displayGroups: [], activeIdx: -1, isPinned: false, isPinnedActive: false };
    }
    const filter = normalizeQuotaPoolFilter(poolFilter);
    if (filter === 'all') {
      const activeIdx = Math.max(0, matchActiveQuotaGroupIndex(groups, modelLabel));
      return { displayGroups: groups, activeIdx, isPinned: false, isPinnedActive: true };
    }
    const predicate =
      filter === 'gemini-only'
        ? (grp) => /gemini/i.test(grp.displayName || '')
        : (grp) => !/gemini/i.test(grp.displayName || '');
    const matched = groups.filter(predicate);
    const displayGroups = matched.length > 0 ? matched : groups;
    const realActiveIdx = matchActiveQuotaGroupIndex(groups, modelLabel);
    const realActiveGroup = realActiveIdx >= 0 ? groups[realActiveIdx] : null;
    const isPinnedActive = Boolean(realActiveGroup && displayGroups.includes(realActiveGroup));
    const activeIdx = isPinnedActive ? Math.max(0, displayGroups.indexOf(realActiveGroup)) : 0;
    return {
      displayGroups,
      activeIdx,
      isPinned: matched.length > 0,
      isPinnedActive
    };
  }

  function classifyQuotaLevel(pct) {
    const p = Number(pct);
    if (!Number.isFinite(p)) return 'ok';
    if (p <= 10) return 'crit';
    if (p <= 30) return 'low';
    return 'ok';
  }

  function computeQuotaSegments(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const out = [];
    for (let i = 0; i < 5; i++) {
      const w = Math.max(0, Math.min(1, (clamped - i * 20) / 20)) * 100;
      out.push(Math.round(w * 100) / 100);
    }
    return out;
  }

  function computeQuotaDotLevels(pct, count = 10) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const step = 100 / count;
    const out = [];
    for (let i = 0; i < count; i++) {
      const rem = clamped - i * step;
      if (rem >= step * 0.75) out.push('full');
      else if (rem > 0) out.push('part');
      else out.push('empty');
    }
    return out;
  }

  function formatQuotaCountdown(resetMs, remainingFraction, nowMs = Date.now()) {
    const frac = Number(remainingFraction);
    if (Number.isFinite(frac) && frac >= 0.9999) return '—';
    if (!Number.isFinite(resetMs) || resetMs <= 0) return '—';
    const diffMs = resetMs - nowMs;
    if (diffMs <= 0) return '—';
    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes >= 24 * 60) {
      return Math.floor(totalMinutes / (24 * 60)) + 'd';
    }
    const mins = Math.max(1, totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  function formatQuotaResetDetail(resetMs, remainingFraction, localeOrIsZh, nowMs = Date.now()) {
    const loc = resolveLocaleHint(localeOrIsZh);
    const frac = Number(remainingFraction);
    if (Number.isFinite(frac) && frac >= 0.9999) return '—';
    if (!Number.isFinite(resetMs) || resetMs <= 0) return '—';
    const diffMs = resetMs - nowMs;
    if (diffMs <= 0) return '—';
    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes < 24 * 60) {
      const mins = Math.max(1, totalMinutes);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (loc === 'zh-TW') {
        if (h > 0 && m > 0) return h + ' 小時 ' + m + ' 分後';
        if (h > 0) return h + ' 小時後';
        return m + ' 分鐘後';
      }
      if (loc === 'zh-CN') {
        if (h > 0 && m > 0) return h + ' 小时 ' + m + ' 分后';
        if (h > 0) return h + ' 小时后';
        return m + ' 分钟后';
      }
      if (h > 0 && m > 0) return 'in ' + h + 'h ' + m + 'm';
      if (h > 0) return 'in ' + h + 'h';
      return 'in ' + m + 'm';
    }
    const d = new Date(resetMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (diffMs < 7 * 24 * 3600 * 1000) {
      const daysMap = {
        'zh-TW': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
        'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      };
      const wd = (daysMap[loc] || daysMap.en)[d.getDay()];
      return wd + ' ' + hh + ':' + mm;
    }
    return d.getMonth() + 1 + '/' + d.getDate() + ' ' + hh + ':' + mm;
  }

  function formatQuotaModelShort(modelLabel) {
    let s = cleanModelLabel(modelLabel);
    if (!s) return '';
    s = s.replace(/\.\s+[\s\S]*$/, '').replace(/[。，,]\s*[\s\S]*$/, '').trim();
    s = s.replace(/\s*[（(][^）)]*[）)]\s*$/g, '').trim();
    s = s.replace(/^(?:claude|gemini|gpt)\s+/i, '').trim();
    s = stripQuotaEffortSuffix(s) || s;
    return s.length > 18 ? s.slice(0, 17) + '…' : s;
  }

  function formatQuotaCountdownLabel(bucket, localeOrIsZh, nowMs = Date.now(), compact = false) {
    if (!bucket) return '';
    const loc = resolveLocaleHint(localeOrIsZh);
    const frac = Number(bucket.remainingFraction);
    if (Number.isFinite(frac) && frac >= 0.9999) {
      if (loc === 'zh-TW') return '額度全滿';
      if (loc === 'zh-CN') return '额度全满';
      return 'Full';
    }
    if (!Number.isFinite(bucket.resetMs) || bucket.resetMs <= 0) return '—';
    const diffMs = bucket.resetMs - nowMs;
    if (diffMs <= 0) return '—';
    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes < 24 * 60) {
      const mins = Math.max(1, totalMinutes);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const hhmm = h + ':' + String(m).padStart(2, '0');
      if (loc === 'zh-TW') return hhmm + ' 後重設';
      if (loc === 'zh-CN') return hhmm + ' 后重置';
      return 'resets ' + hhmm;
    }
    const detail = formatQuotaResetDetail(bucket.resetMs, bucket.remainingFraction, loc, nowMs);
    if (detail === '—') return '—';
    if (compact) return detail;
    if (loc === 'zh-TW') return detail + ' 重設';
    if (loc === 'zh-CN') return detail + ' 重置';
    return 'resets ' + detail;
  }

  function hasExpiredQuotaBucket(groups, nowMs = Date.now()) {
    if (!Array.isArray(groups) || groups.length === 0) return false;
    for (let i = 0; i < groups.length; i++) {
      const grp = groups[i];
      if (!grp || typeof grp !== 'object') continue;
      const buckets = [grp.fiveHour, grp.weekly];
      for (let j = 0; j < buckets.length; j++) {
        const b = buckets[j];
        if (!b || typeof b !== 'object') continue;
        const frac = Number(b.remainingFraction);
        if (Number.isFinite(frac) && frac >= 0.9999) continue;
        if (Number.isFinite(b.resetMs) && b.resetMs > 0 && nowMs >= b.resetMs) {
          return true;
        }
      }
    }
    return false;
  }

  const AG_DEFAULT_SANS_STACK =
    "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif";
  const AG_DEFAULT_MONO_STACK =
    "'SF Mono', 'Fira Code', Menlo, Monaco, ui-monospace, SFMono-Regular, 'PingFang SC', Consolas, monospace";
  const AG_GENERIC_FONT_KEYWORDS = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'emoji',
    'math',
    'fangsong',
    '-apple-system',
    'blinkmacsystemfont'
  ]);

  function sanitizeFontInput(raw) {
    let s = String(raw || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[;{}<>@\\]/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (!s || /(?:url\s*\(|expression\s*\(|import\b)/i.test(s)) return '';
    if (s.length > 240) s = s.slice(0, 240).trim();
    return s;
  }

  function buildFontStack(raw, kind) {
    const clean = sanitizeFontInput(raw);
    if (!clean) return '';
    const parts = clean
      .split(',')
      .map((item) => item.trim().replace(/^["']+|["']+$/g, '').trim())
      .filter(Boolean)
      .map((name) => {
        const lower = name.toLowerCase();
        if (AG_GENERIC_FONT_KEYWORDS.has(lower)) return lower;
        const safe = name.replace(/["']/g, '');
        if (!safe) return '';
        return /\s|[^a-zA-Z0-9_-]/.test(safe) ? `"${safe}"` : safe;
      })
      .filter(Boolean);
    if (parts.length === 0) return '';
    const fallback = kind === 'mono' ? AG_DEFAULT_MONO_STACK : AG_DEFAULT_SANS_STACK;
    return `${parts.join(', ')}, ${fallback}`;
  }

  function buildUserFontsCss(fontsCfg) {
    const cfg = fontsCfg && typeof fontsCfg === 'object' ? fontsCfg : {};
    const mode = cfg.mode === 'split' ? 'split' : 'global';
    const uiStack = mode === 'split' ? buildFontStack(cfg.ui, 'sans') : buildFontStack(cfg.global, 'sans');
    const chatStack = mode === 'split' ? buildFontStack(cfg.chat, 'sans') : uiStack;
    const codeStack = mode === 'split' ? buildFontStack(cfg.code, 'mono') : '';

    if (!uiStack && !chatStack && !codeStack) return '';

    const blocks = [];
    if (uiStack) {
      blocks.push(
        `html[data-ag-os], html[data-ag-os] body, html[data-ag-os] body[data-agy-theme], html[data-ag-os] body[data-agy-theme] :where(.font-sans), html[data-ag-os] body[data-agy-font], html[data-ag-os] body[data-agy-font="google-sans"], html[data-ag-os] body[data-agy-font="inter"], html[data-ag-os] body[data-agy-font] :where(.font-sans) { --font-sans: ${uiStack} !important; --vscode-font-family: ${uiStack} !important; --default-font-family: ${uiStack} !important; --sdk-font-family: ${uiStack} !important; --sdk-comment-font-family: ${uiStack} !important; }`,
        `html[data-ag-os] body, html[data-ag-os] body[data-agy-font], html[data-ag-os] :is(button:not(.context-scope-mention button), select, nav, header, aside, [role="dialog"], [role="dialog"] :is(input, textarea), [role="menu"], [role="listbox"], #ag-settings-pane, #ag-quota, #ag-quota-popover) { font-family: ${uiStack} !important; }`
      );
    }

    const effectiveChatStack = chatStack || (mode === 'split' && uiStack ? AG_DEFAULT_SANS_STACK : '');
    if (effectiveChatStack) {
      blocks.push(
        `html[data-ag-os], html[data-ag-os] body { --ag-chat-font: ${effectiveChatStack} !important; }`,
        `html[data-ag-os] :is([data-markdown-root], [data-markdown-root] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, a, strong, em, del, s, mark, sub, sup, summary, dd, dt, bdi, .context-scope-mention, .context-scope-mention button, .context-scope-mention span):not(code):not(pre):not(pre *):not(.font-mono):not(.codicon):not(.google-symbols), [data-testid="user-message-content"], [data-testid="user-message-content"] :is(p, span, div):not(code):not(pre):not(pre *):not(.codicon):not(.google-symbols), .agy-user-bubble, .agy-user-bubble :is(p, span, div):not(code):not(pre):not(pre *):not(.codicon):not(.google-symbols), .prose, .prose :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th):not(code):not(pre):not(pre *), .markdown, [data-lexical-editor="true"], [data-lexical-editor="true"] :is(p, span, div), #antigravity\\.agentSidePanelInputBox div:has(> [data-lexical-editor="true"]) > p.pointer-events-none) { font-family: ${effectiveChatStack} !important; }`
      );
    }

    if (codeStack) {
      blocks.push(
        `html[data-ag-os], html[data-ag-os] body, html[data-ag-os] body[data-agy-theme] :where(.font-mono), html[data-ag-os] body[data-agy-font] :where(.font-mono) { --font-mono: ${codeStack} !important; --editor-font-family: ${codeStack} !important; --vscode-editor-font-family: ${codeStack} !important; --default-mono-font-family: ${codeStack} !important; --sdk-font-family-mono: ${codeStack} !important; }`,
        `html[data-ag-os] :is(code, pre, kbd, samp, .font-mono, .code-block, .code-block *, [class*="language-"], .monaco-editor, .monaco-editor .view-lines, .cm-editor, .cm-content, .cm-line, .xterm, pre *, .code-line, .code-line .line-content, .code-line .line-content *, [data-testid="code-gutter-diff"], [data-markdown-root] :is(code, pre, kbd, samp, .font-mono), [class*="group/file-title"], [class*="group/file-title"] *, [class*="file-title"], [class*="file-path"], [data-path], [data-file-path]) { font-family: ${codeStack} !important; }`
      );
    }

    return blocks.join('\n');
  }

  /* ============================================================================
   * 2. Trilingual Localization Dictionary (zh-TW / zh-CN / en)
   * ============================================================================ */

  const LOCALE_DICT = {
    'zh-TW': {
      quotaActive: '目前',
      quotaIdle: '未在使用',
      quotaClickRefresh: '點選立即更新額度',
      navTitle: 'Suite 外觀與額度',
      pageTitle: 'Suite 外觀與額度',
      openFullSettings: '開啟完整 Suite 設定中心',
      savedBadge: '已儲存',
      subtitle: '自訂側邊欄模型額度、Codex 主題、字型與快速鍵。所有設定會即時同步至 Suite 設定檔。',
      secQuota: '側邊欄模型額度',
      quotaSidebarLbl: '側邊欄模型額度',
      quotaSidebarDesc: '在「系統設定」上方顯示模型群組的 5h / 7d 剩餘額度；收合側邊欄時隱藏',
      quotaPoolFilterLbl: '顯示範圍',
      quotaPoolFilterDesc: '選擇自動跟隨目前模型，或固定只顯示單一模型池',
      poolAll: '自動跟隨目前模型',
      poolGemini: '僅顯示 Gemini',
      poolClaude: '僅顯示 Claude·GPT',
      quotaStyleLbl: '目前模型群組',
      quotaStyleHint: '顯示目前模型群組的剩餘額度與重設倒數',
      quotaOtherLbl: '其他模型群組',
      quotaOtherHint: '可搭配不同樣式或隱藏（固定顯示單一群組時自動隱藏）',
      qStyleSegments: '五段格',
      qStyleBar: '連續進度條',
      qStyleRings: '雙圓環',
      qStyleGauge: '儀表板',
      qStyleDots: '點陣',
      qStyleCompact: '精簡刻度',
      qOtherLines: '進度細線',
      qOtherText: '純文字',
      qOtherSegments: '迷你五段',
      qOtherRings: '迷你圓環',
      qOtherRows: '雙列橫條',
      qOtherHidden: '隱藏',
      secSuite: '外觀與互動增強',
      topbarQuotaLbl: '頂欄配額膠囊 (G4 · C)',
      topbarQuotaDesc: '在右下角狀態列顯示精簡配額膠囊，點選可展開各模型明細',
      codexThemeLbl: 'Codex 純白／炭黑主題',
      codexThemeDesc: '套用高對比純白與中性炭黑配色，隨 IDE 淺色／深色模式自動切換',
      deadlockHealerLbl: '避免設定視窗卡住',
      deadlockHealerDesc: '開啟系統設定前自動清除卡住的 URL 查詢狀態，避免無法開啟設定視窗',
      zoomShortcutsLblMac: '⌘ + -/=/0 畫面縮放',
      zoomShortcutsLblOther: 'Ctrl + -/=/0 畫面縮放',
      zoomShortcutsDesc: '支援使用快速鍵放大、縮小與重設 Antigravity 視窗比例',
      secFonts: '自訂本機字型',
      fontsResetBtn: '還原預設值',
      fontsModeLbl: '字型套用範圍',
      fontsModeDesc: '可統一套用一種字型，或分別指定介面、對話與程式碼字型',
      fontsModeGlobal: '全域',
      fontsModeSplit: '分別設定（介面／對話／程式碼）',
      fontGlobalLbl: '全域正文字型',
      fontGlobalDesc: '套用於介面與對話，並保留程式碼等寬字型',
      fontUiLbl: '介面字型',
      fontUiDesc: '側邊欄、按鈕、選單與設定面板',
      fontChatLbl: '對話字型',
      fontChatDesc: 'AI 回覆、使用者訊息與輸入欄',
      fontCodeLbl: '程式碼與等寬字型',
      fontCodeDesc: '程式碼區塊、行內程式碼、編輯器與等寬數值',
      fontDefault: '跟隨主題預設'
    },
    'zh-CN': {
      quotaActive: '当前',
      quotaIdle: '未在使用',
      quotaClickRefresh: '点击立即更新额度',
      navTitle: 'Suite 外观与额度',
      pageTitle: 'Suite 外观与额度',
      openFullSettings: '打开完整 Suite 设置中心',
      savedBadge: '已保存',
      subtitle: '自定义侧边栏模型额度、Codex 主题、字体与快捷键。所有设置将实时同步至 Suite 配置文件。',
      secQuota: '侧边栏模型额度',
      quotaSidebarLbl: '侧边栏模型额度',
      quotaSidebarDesc: '在「系统设置」上方显示模型分组的 5h / 7d 剩余额度；收起侧边栏时隐藏',
      quotaPoolFilterLbl: '显示范围',
      quotaPoolFilterDesc: '选择自动跟随当前模型，或固定仅显示单个模型池',
      poolAll: '自动跟随当前模型',
      poolGemini: '仅显示 Gemini',
      poolClaude: '仅显示 Claude·GPT',
      quotaStyleLbl: '当前模型分组',
      quotaStyleHint: '显示当前模型分组的剩余额度与重置倒计时',
      quotaOtherLbl: '其他模型分组',
      quotaOtherHint: '可搭配不同样式或隐藏（固定显示单个分组时自动隐藏）',
      qStyleSegments: '五段格',
      qStyleBar: '连续进度条',
      qStyleRings: '双圆环',
      qStyleGauge: '仪表板',
      qStyleDots: '点阵',
      qStyleCompact: '精简刻度',
      qOtherLines: '进度细线',
      qOtherText: '纯文字',
      qOtherSegments: '迷你五段',
      qOtherRings: '迷你圆环',
      qOtherRows: '双列横条',
      qOtherHidden: '隐藏',
      secSuite: '外观与交互增强',
      topbarQuotaLbl: '顶栏配额胶囊 (G4 · C)',
      topbarQuotaDesc: '在右下角状态栏显示精简配额胶囊，点击可展开各模型明细',
      codexThemeLbl: 'Codex 纯白／炭黑主题',
      codexThemeDesc: '应用高对比纯白与中性炭黑配色，随 IDE 浅色／深色模式自动切换',
      deadlockHealerLbl: '设置弹窗防卡死',
      deadlockHealerDesc: '打开系统设置前自动清理卡住的 URL 查询状态，避免无法打开弹窗',
      zoomShortcutsLblMac: '⌘ + -/=/0 页面缩放',
      zoomShortcutsLblOther: 'Ctrl + -/=/0 页面缩放',
      zoomShortcutsDesc: '支持使用快捷键放大、缩小与重置 Antigravity 窗口比例',
      secFonts: '自定义本地字体',
      fontsResetBtn: '恢复默认值',
      fontsModeLbl: '字体应用范围',
      fontsModeDesc: '可统一应用一种字体，或分别指定界面、对话与代码字体',
      fontsModeGlobal: '全局',
      fontsModeSplit: '分别设置（界面／对话／代码）',
      fontGlobalLbl: '全局正文字体',
      fontGlobalDesc: '应用于界面与对话，并保留代码等宽字体',
      fontUiLbl: '界面字体',
      fontUiDesc: '侧边栏、按钮、菜单与设置面板',
      fontChatLbl: '对话字体',
      fontChatDesc: 'AI 回复、用户消息与输入框',
      fontCodeLbl: '代码与等宽字体',
      fontCodeDesc: '代码块、行内代码、编辑器与等宽数值',
      fontDefault: '跟随主题默认'
    },
    en: {
      quotaActive: 'Active',
      quotaIdle: 'Idle',
      quotaClickRefresh: 'Click to refresh quota',
      navTitle: 'Suite UI & Quota',
      pageTitle: 'Suite UI & Quota',
      openFullSettings: 'Open Full Suite Settings',
      savedBadge: 'Saved',
      subtitle: 'Customize sidebar model quota, Codex theme, local fonts, and shortcuts. Changes sync directly to Suite preferences.',
      secQuota: 'Sidebar Model Quota',
      quotaSidebarLbl: 'Model Quota (Sidebar)',
      quotaSidebarDesc: 'Shows 5h / 7d remaining quota above Settings; hidden when the sidebar collapses',
      quotaPoolFilterLbl: 'Display Scope',
      quotaPoolFilterDesc: 'Follow the active model automatically or pin a single model pool',
      poolAll: 'Auto (Follow Active)',
      poolGemini: 'Gemini Only',
      poolClaude: 'Claude·GPT Only',
      quotaStyleLbl: 'Active Pool',
      quotaStyleHint: 'The active model pool with exact percentage and reset countdown',
      quotaOtherLbl: 'Other Pools',
      quotaOtherHint: 'Mix styles or hide (hidden automatically when pinned to one pool)',
      qStyleSegments: 'Segments',
      qStyleBar: 'Bar',
      qStyleRings: 'Rings',
      qStyleGauge: 'Gauge',
      qStyleDots: 'Dots',
      qStyleCompact: 'Compact',
      qOtherLines: 'Lines',
      qOtherText: 'Text',
      qOtherSegments: 'Mini Segs',
      qOtherRings: 'Mini Rings',
      qOtherRows: 'Rows',
      qOtherHidden: 'Hidden',
      secSuite: 'Appearance & Guards',
      topbarQuotaLbl: 'Topbar Quota Capsule (G4 · C)',
      topbarQuotaDesc: 'Displays the compact quota capsule in the bottom bar with expandable pool details',
      codexThemeLbl: 'Codex Light & Dark Theme',
      codexThemeDesc: 'Pure white light and neutral charcoal dark palettes syncing with IDE appearance',
      deadlockHealerLbl: 'Settings Modal Deadlock Healer',
      deadlockHealerDesc: 'Clears stale settingsOpen URL query state before opening Settings to avoid lockups',
      zoomShortcutsLblMac: '⌘ + -/=/0 Zoom Shortcuts',
      zoomShortcutsLblOther: 'Ctrl + -/=/0 Zoom Shortcuts',
      zoomShortcutsDesc: 'Enable keyboard zoom in, zoom out, and reset shortcuts for the window',
      secFonts: 'Custom Local Fonts',
      fontsResetBtn: 'Reset Defaults',
      fontsModeLbl: 'Font Scope',
      fontsModeDesc: 'Apply one font globally or customize UI, Chat, and Code separately',
      fontsModeGlobal: 'Global',
      fontsModeSplit: 'Split (UI / Chat / Code)',
      fontGlobalLbl: 'Global Font',
      fontGlobalDesc: 'Applies to UI chrome and chat messages while preserving monospace code',
      fontUiLbl: 'UI Font',
      fontUiDesc: 'Sidebar, buttons, menus, and settings panel',
      fontChatLbl: 'Chat Font',
      fontChatDesc: 'Assistant replies, user bubbles, and composer',
      fontCodeLbl: 'Code & Monospace Font',
      fontCodeDesc: 'Code blocks, inline code, editors, and monospace numbers',
      fontDefault: 'Follow Theme Default'
    }
  };

  function resolveActiveLocale() {
    try {
      const ls = win.localStorage?.getItem?.(STORAGE_KEY_LOCALE);
      const nLs = normalizeLocaleCode(ls);
      if (nLs) return nLs;
    } catch {}
    try {
      const hostPref =
        win.__AGContextMeterSettings?.uiPreferences?.locale ||
        win.__AGContextMeterSettings?.uiPreferences?.panelLanguage ||
        win.__AGContextMeterSettings?.panelLanguage;
      const nHost = normalizeLocaleCode(hostPref);
      if (nHost) return nHost;
    } catch {}
    try {
      if (typeof win.__antigravityZhGetLang === 'function') {
        const nZh = normalizeLocaleCode(win.__antigravityZhGetLang());
        if (nZh) return nZh;
      }
    } catch {}
    try {
      const attrLoc = doc?.documentElement?.getAttribute?.('data-ag-suite-locale');
      const nAttr = normalizeLocaleCode(attrLoc);
      if (nAttr) return nAttr;
      const docLang = normalizeLocaleCode(doc?.documentElement?.lang);
      if (docLang) return docLang;
    } catch {}
    return 'zh-TW';
  }

  let activeLocale = resolveActiveLocale();

  function getStrings() {
    return LOCALE_DICT[activeLocale] || LOCALE_DICT['zh-TW'];
  }

  /* ============================================================================
   * 3. Scoped Stylesheets (Zero 需求 25 forbidden colors!)
   * ============================================================================ */

  const QUOTA_CSS = `
/* Ink Quota — Light & Dark */
#ag-quota {
  --ag-q-mut: var(--muted-foreground, #8b8b92);
  --ag-q-fg: var(--foreground, #18181b);
  --ag-q-fg-2: var(--secondary-foreground, #3c3c42);
  --ag-q-card: var(--card, #ffffff);
  --ag-q-tile: transparent;
  --ag-q-tile-other: transparent;
  --ag-q-line: rgba(15, 23, 42, 0.08);
  --ag-q-badge-bg: #18181b;
  --ag-q-badge-fg: #ffffff;
  --ag-q-wl-bg: rgba(0, 0, 0, 0.055);
  --ag-q-track: rgba(0, 0, 0, 0.085);
  --ag-q-fill: #2a2a2e;
  --ag-q-low: #c49a4f;
  --ag-q-low-text: #a8803a;
  --ag-q-crit: #c4513f;
  --ag-q-font: var(--font-sans, Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", system-ui, sans-serif);
}
:is(html[data-ag-theme-mode="dark"] body, html.dark body, body.dark, body.theme-dark, body[data-agy-theme].dark) #ag-quota {
  --ag-q-mut: var(--muted-foreground, #84848c);
  --ag-q-fg: var(--foreground, #ececef);
  --ag-q-fg-2: var(--secondary-foreground, #c4c4ca);
  --ag-q-card: var(--card, #202024);
  --ag-q-tile: transparent;
  --ag-q-tile-other: transparent;
  --ag-q-line: rgba(255, 255, 255, 0.08);
  --ag-q-badge-bg: #e6e6ea;
  --ag-q-badge-fg: #141417;
  --ag-q-wl-bg: rgba(255, 255, 255, 0.085);
  --ag-q-track: rgba(255, 255, 255, 0.1);
  --ag-q-fill: #e6e6ea;
  --ag-q-low: #c3a05e;
  --ag-q-low-text: #d2b273;
  --ag-q-crit: #d8735f;
}
#ag-quota * { box-sizing: border-box; }
#ag-quota [data-level] { --ag-q-c: var(--ag-q-fill); --ag-q-tc: var(--ag-q-fg); --ag-q-sc: var(--ag-q-mut); }
#ag-quota [data-level="low"] { --ag-q-c: var(--ag-q-low); --ag-q-tc: var(--ag-q-low-text); --ag-q-sc: var(--ag-q-low-text); }
#ag-quota [data-level="crit"] { --ag-q-c: var(--ag-q-crit); --ag-q-tc: var(--ag-q-crit); --ag-q-sc: var(--ag-q-crit); }
#ag-quota .ag-quota-wl {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 22px; height: 14px; padding: 0 3px; border-radius: 4px;
  background: var(--ag-q-wl-bg); color: var(--ag-q-fg-2);
  font-size: 9px; font-weight: 650; line-height: 1; letter-spacing: 0.02em; font-variant-numeric: tabular-nums;
}
#ag-quota .ag-quota-badge {
  flex: none; padding: 0 6px; border-radius: 5px;
  background: var(--ag-q-badge-bg); color: var(--ag-q-badge-fg);
  font-size: 10px; font-weight: 650; line-height: 16px; letter-spacing: 0.02em;
}
#ag-quota .ag-quota-hd-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ag-q-c); }
#ag-quota .ag-quota-cbar { position: relative; height: 3px; border-radius: 3px; background: var(--ag-q-track); overflow: hidden; }
#ag-quota .ag-quota-cbar-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--ag-q-c); transition: width 220ms ease, background-color 150ms ease; }
#ag-quota .ag-quota-cbar.ag-quota-cbar-main { height: 4px; }
#ag-quota .ag-quota-cbar.ag-quota-mb { height: 2px; flex: 1; min-width: 14px; }
#ag-quota .ag-quota-bar { display: flex; gap: 3px; }
#ag-quota .ag-quota-seg { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--ag-q-track); overflow: hidden; }
#ag-quota .ag-quota-seg-fill { position: absolute; inset: 0 auto 0 0; background: var(--ag-q-c); transition: width 220ms ease, background-color 150ms ease; }
#ag-quota .ag-quota-dots { display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 3px; }
#ag-quota .ag-quota-dot { aspect-ratio: 1; max-width: 6px; border-radius: 50%; background: var(--ag-q-track); }
#ag-quota .ag-quota-dot[data-state="full"] { background: var(--ag-q-c); }
#ag-quota .ag-quota-ring-svg { flex: none; display: block; }
#ag-quota .ag-quota-ring-svg circle { fill: none; stroke-width: 3.4; }
#ag-quota .ag-quota-ring-track { stroke: var(--ag-q-track); }
#ag-quota .ag-quota-ring-arc { stroke: var(--ag-q-c); stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
#ag-quota .ag-quota-gauge-svg { display: block; }
#ag-quota .ag-quota-gauge-svg path { fill: none; stroke-width: 4; stroke-linecap: round; }
#ag-quota .ag-quota-gauge-track { stroke: var(--ag-q-track); }
#ag-quota .ag-quota-gauge-arc { stroke: var(--ag-q-c); }
#ag-quota .ag-quota-vticks, #ag-quota .ag-quota-mseg { display: flex; gap: 2px; }
#ag-quota .ag-quota-vtick { position: relative; flex: 1; height: 8px; border-radius: 1.5px; background: var(--ag-q-track); overflow: hidden; }
#ag-quota .ag-quota-vtick-fill, #ag-quota .ag-quota-ms > span { position: absolute; inset: 0 auto 0 0; background: var(--ag-q-c); }
#ag-quota .ag-quota-mseg { flex: 1; min-width: 24px; gap: 2px; }
#ag-quota .ag-quota-ms { position: relative; flex: 1; height: 5px; border-radius: 1px; background: var(--ag-q-track); overflow: hidden; }
#ag-quota {
  position: relative; display: block; margin: 4px 0 2px; padding: 5px 8px; border-radius: 10px;
  color: var(--ag-q-mut); font-family: var(--ag-q-font); font-size: 11px; line-height: 1.3;
  font-variant-numeric: tabular-nums; cursor: pointer; user-select: none;
}
#ag-quota em { font-style: normal !important; }
#ag-quota .ag-quota-hd { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 11.5px; line-height: 16px; min-width: 0; }
#ag-quota .ag-quota-hd-name { color: var(--ag-q-fg); font-weight: 600; white-space: nowrap; }
#ag-quota .ag-quota-hd-model { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ag-q-mut); font-size: 10.5px; }
#ag-quota .ag-quota-row + .ag-quota-row { margin-top: 5px; }
#ag-quota .ag-quota-head { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
#ag-quota .ag-quota-pct { color: var(--ag-q-tc); font-size: 12px; font-weight: 650; }
#ag-quota .ag-quota-pct small { margin-left: 1px; color: var(--ag-q-mut); font-size: 9.5px; font-weight: 500; }
#ag-quota .ag-quota-time { margin-left: auto; font-size: 10px; color: var(--ag-q-sc); white-space: nowrap; }
#ag-quota .ag-quota-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#ag-quota .ag-quota-tile { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 2px; border-radius: 6px; background: var(--ag-q-tile); border: none; }
#ag-quota .ag-quota-tile-tv { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; line-height: 1.2; }
#ag-quota .ag-quota-tile-top { display: inline-flex; align-items: center; gap: 4px; }
#ag-quota .ag-quota-tile b { color: var(--ag-q-tc); font-size: 12px; font-weight: 650; }
#ag-quota .ag-quota-tile em { font-style: normal; font-size: 9.5px; color: var(--ag-q-sc); white-space: nowrap; }
#ag-quota .ag-quota-gtile { flex-direction: column; gap: 3px; padding: 3px 2px 2px; text-align: center; }
#ag-quota .ag-quota-gauge-dial { position: relative; width: 48px; height: 25px; }
#ag-quota .ag-quota-gauge-pct { position: absolute; left: 0; right: 0; bottom: -1px; font-size: 11.5px; text-align: center; }
#ag-quota .ag-quota-gmeta { display: inline-flex; align-items: center; justify-content: center; gap: 4px; max-width: 100%; }
#ag-quota .ag-quota-crow { display: grid; grid-template-columns: 22px 1fr 30px 54px; align-items: center; gap: 6px; }
#ag-quota .ag-quota-crow + .ag-quota-crow { margin-top: 4px; }
#ag-quota .ag-quota-crow b { color: var(--ag-q-tc); font-size: 11px; font-weight: 650; text-align: right; }
#ag-quota .ag-quota-crow em { font-style: normal; font-size: 9.5px; color: var(--ag-q-sc); text-align: right; white-space: nowrap; }
#ag-quota .ag-quota-sep { height: 0; margin: 7px 0 0; background: transparent; }
#ag-quota .ag-quota-o + .ag-quota-o { margin-top: 5px; }
#ag-quota .ag-quota-o { font-size: 10.5px; }
#ag-quota .ag-quota-o-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; line-height: 14px; }
#ag-quota .ag-quota-o-hd em { font-style: normal; font-size: 10px; }
#ag-quota .ag-quota-o-name { color: var(--ag-q-fg-2); font-weight: 600; white-space: nowrap; }
#ag-quota .ag-quota-o-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#ag-quota .ag-quota-o-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 2px 0; border-radius: 6px; background: var(--ag-q-tile-other); border: none; }
#ag-quota .ag-quota-o-col .ag-quota-oi { width: 100%; }
#ag-quota .ag-quota-o-col .ag-quota-o-time { text-align: center; }
#ag-quota .ag-quota-o-tcol { display: flex; align-items: center; gap: 3px; min-width: 0; padding: 2px 0; border-radius: 6px; background: var(--ag-q-tile-other); border: none; }
#ag-quota .ag-quota-o-tcol .ag-quota-wl { width: 20px; }
#ag-quota .ag-quota-o-tcol b { flex: 1; text-align: center; color: var(--ag-q-tc); font-size: 10px; font-weight: 600; white-space: nowrap; }
#ag-quota .ag-quota-o-tcol .ag-quota-o-time { flex: none; font-size: 9px; }
#ag-quota .ag-quota-o[data-ostyle="lines"] .ag-quota-o-col .ag-quota-oi b,
#ag-quota .ag-quota-o[data-ostyle="segments"] .ag-quota-o-col .ag-quota-oi b { min-width: 24px; text-align: right; }
#ag-quota .ag-quota-o-rcol { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 0; border-radius: 6px; background: var(--ag-q-tile-other); border: none; }
#ag-quota .ag-quota-o-ring { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; }
#ag-quota .ag-quota-o-rtv { display: flex; flex-direction: column; gap: 2px; min-width: 0; line-height: 1.2; }
#ag-quota .ag-quota-o-time { font-style: normal; font-size: 9.5px; line-height: 1.2; color: var(--ag-q-sc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ag-quota .ag-quota-oi { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
#ag-quota .ag-quota-oi b { color: var(--ag-q-tc); font-weight: 600; font-size: 10.5px; }
#ag-quota .ag-quota-orow { display: grid; grid-template-columns: 22px 1fr 30px 54px; align-items: center; gap: 6px; margin-top: 3px; }
#ag-quota .ag-quota-orow b { color: var(--ag-q-tc); font-size: 10.5px; font-weight: 600; text-align: right; }
#ag-quota .ag-quota-orow em { font-style: normal; font-size: 9.5px; color: var(--ag-q-sc); text-align: right; white-space: nowrap; }
`;

  const CODEX_THEME_CSS = `
/* 00-base.css */
:root,
html,
body,
body[data-agy-theme],
body[data-agy-theme] :where(.font-sans),
body[data-agy-font],
body[data-agy-font="google-sans"],
body[data-agy-font="inter"],
body[data-agy-font] :where(.font-sans),
body[data-agy-theme] :where(.font-mono),
body[data-agy-font] :where(.font-mono) {
  --vscode-font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif !important;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif !important;
  --default-font-family: var(--font-sans) !important;
  --font-mono: 'SF Mono', 'Fira Code', Menlo, Monaco, ui-monospace, SFMono-Regular, 'PingFang SC', Consolas, monospace !important;
  --editor-font-family: var(--font-mono) !important;
  --vscode-editor-font-family: var(--font-mono) !important;
  --default-mono-font-family: var(--font-mono) !important;
  --font-weight-light: 300 !important;
  --font-weight-normal: 400 !important;
  --font-weight-medium: 500 !important;
  --font-weight-semibold: 600 !important;
  --font-weight-bold: 700 !important;
  --font-weight-black: 900 !important;
  --agy-gsf-h1-wght: 600 !important;
  --agy-gsf-h3-wght: 600 !important;
  --agy-gsf-bold-wght: 600 !important;
  --agy-gsf-italic: italic !important;
  --agy-gsf-slnt: 0 !important;
}
:root { --ag-chat-font-size: 15px; }
body, body[data-agy-font], body[data-agy-font="google-sans"] {
  font-weight: 400 !important;
  font-variation-settings: normal !important;
  color: var(--foreground) !important;
}
body:not([data-has-browser-hole="true"]),
body[data-agy-font]:not([data-has-browser-hole="true"]),
body[data-agy-font="google-sans"]:not([data-has-browser-hole="true"]) {
  background-color: var(--background) !important;
}
.bg-sidebar:not([data-has-browser-hole="true"]) { background-color: var(--sidebar) !important; }
body[data-agy-font] :where(.font-sans, h1, h2, h3, h4, h5, h6, b, strong, i, em, .italic) {
  --agy-gsf-bold-wght: 600 !important;
  font-variation-settings: normal !important;
}
body[data-agy-font] :where(i, em, .italic):not(.codicon, .google-symbols) { font-style: italic !important; }
html, body, body[data-agy-font], button, select, nav, header, aside {
  font-family: var(--font-sans) !important;
  -webkit-font-smoothing: antialiased;
}
[data-markdown-root],
[data-testid="user-message-content"],
.agy-user-bubble,
.select-text,
.prose,
.markdown,
article,
div[contenteditable="true"],
textarea:not([role="dialog"] textarea),
[data-lexical-editor="true"],
[data-lexical-editor="true"] :is(p, span, div),
[data-lexical-editor="true"] ~ p.pointer-events-none,
#antigravity\\.agentSidePanelInputBox div:has(> [data-lexical-editor="true"]) > p.pointer-events-none,
:is([data-markdown-root], .select-text, .prose, .markdown, article) :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th),
[data-markdown-root] :is(bdi, .context-scope-mention, .context-scope-mention button, .context-scope-mention span) {
  font-family: var(--ag-chat-font, var(--font-sans)) !important;
  letter-spacing: -0.01em !important;
}
:is([data-markdown-root], .select-text, .prose, .markdown) :is(p, li, blockquote) { line-height: 1.62; }
html[data-ag-custom-font-size="true"] :is([data-markdown-root], [data-testid="user-message-content"], [data-testid="user-message-content"] .select-text, .agy-user-bubble, .prose, .markdown, [class*="chat-message"]) {
  font-size: var(--ag-chat-font-size) !important;
}
code, pre, kbd, samp, .font-mono, .code-block, .code-block *, [class*="language-"], .monaco-editor, .cm-editor, .cm-content, .cm-line, .xterm, pre *,
.code-line, .code-line .line-content, .code-line .line-content *, [data-testid="code-gutter-diff"],
[class*="group/file-title"], [class*="group/file-title"] *, [class*="file-title"], [class*="file-path"],
[data-path], [data-file-path], :is([data-markdown-root], .select-text) :is(code, pre, kbd, samp, .font-mono) {
  font-family: var(--font-mono) !important;
}
#antigravity\\.agentSidePanelInputBox [data-lexical-editor="true"],
#antigravity\\.agentSidePanelInputBox [data-lexical-editor="true"] span[data-lexical-text="true"] {
  font-weight: 400 !important;
  letter-spacing: normal !important;
}
.surface-glass, .agy-fastpick.surface-glass, .quick-input-widget.surface-glass, .agy-user-bubble {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.agy-inset-shell {
  --card-edge: var(--card-border, rgba(0, 0, 0, 0.08)) !important;
  --sash-line: var(--card-border, rgba(0, 0, 0, 0.08)) !important;
}
.agy-sheet[data-sheet-inset] [data-main-content-body]::after,
.agy-inset-shell [data-side-panel-body]::after {
  box-shadow: inset 0 0 0 1px var(--card-edge, rgba(0, 0, 0, 0.08)) !important;
}
:is(#antigravity\\.agentSidePanelInputBox, [id="antigravity.agentSidePanelInputBox"], .surface-composer, .surface-composer.bg-card-border) {
  --nux-composer-frame-radius: 21px;
  --nux-composer-radius: 20px;
  padding: 1px !important;
  background-color: var(--ag-composer-tray-bg, #F7F7F8) !important;
  border: 0 !important;
  border-radius: 21px !important;
  box-shadow: none !important;
  outline: none !important;
  transition: border-color 180ms ease, box-shadow 180ms ease !important;
}
.surface-composer > .surface-composer-card,
body[data-agy-theme] .surface-composer > .surface-composer-card,
body[data-agy-theme][data-newux-theme="onyx"] .surface-composer > .surface-composer-card,
.surface-composer-card.bg-card,
[id="antigravity.agentSidePanelInputBox"] .surface-composer-card,
[id="antigravity.agentSidePanelInputBox"] > div.bg-card {
  background-color: var(--ag-composer-card-bg, #FFFFFF) !important;
  border: 1px solid var(--ag-composer-card-border, rgba(0, 0, 0, 0.07)) !important;
  border-radius: 20px !important;
  box-shadow: var(--ag-composer-card-shadow, 0 2px 10px rgba(0, 0, 0, 0.035), 0 1px 2px rgba(0, 0, 0, 0.02)) !important;
  outline: none !important;
  transition: box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1), border-color 220ms ease !important;
}
body[data-agy-theme] .surface-composer:focus-within > .surface-composer-card,
body[data-agy-theme][data-newux-theme="onyx"] .surface-composer:focus-within > .surface-composer-card,
.surface-composer:focus-within > .surface-composer-card,
.surface-composer-card:focus-within,
[id="antigravity.agentSidePanelInputBox"]:focus-within .surface-composer-card {
  border-color: var(--ag-composer-card-focus-border, rgba(0, 0, 0, 0.10)) !important;
  box-shadow: var(--ag-composer-card-focus-shadow, 0 4px 16px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.03)) !important;
}
[id="antigravity.agentSidePanelInputBox"] > div:first-child:not(.surface-composer-card) :is(button, span, svg) {
  color: var(--ag-composer-top-fg, #171717) !important;
}
[id="antigravity.agentSidePanelInputBox"] > div:first-child:not(.surface-composer-card) button:is(:hover, :focus-visible, [data-state="open"], [aria-expanded="true"]) {
  background-color: var(--ag-composer-top-hover-bg, rgba(0, 0, 0, 0.06)) !important;
  color: var(--ag-composer-top-hover-fg, #0D0D0D) !important;
}
#antigravity\\.agentSidePanelInputBox :is([class*="text-secondary-foreground"], button, span):not([data-lexical-editor="true"]):not([data-lexical-editor="true"] *) {
  font-weight: 400 !important;
  letter-spacing: -0.012em !important;
}
#antigravity\\.agentSidePanelInputBox :is([class*="text-secondary-foreground"]:not(#ag-live-metrics-pill *):not(.ag-live-metrics-pill *), button:not([data-testid="send-button"]):not(.agy-send-button):not([data-testid="voice-start-button"]):not([data-testid="input-cancel-button"]), span:not([data-testid="voice-live-pill"]):not([data-testid="voice-live-pill"] *):not(.agy-send-button):not(.agy-send-button *):not([data-testid="input-cancel-button"] *):not(#ag-live-metrics-pill):not(#ag-live-metrics-pill *):not(.ag-live-metrics-pill):not(.ag-live-metrics-pill *), svg:not([data-testid="voice-live-pill"] *):not([data-testid="send-button"] *):not(.agy-send-button *):not([data-testid="input-cancel-button"] *)):not([data-lexical-editor="true"]):not([data-lexical-editor="true"] *) {
  color: var(--ag-composer-ctrl-fg, #171717) !important;
  opacity: 1 !important;
}
#antigravity\\.agentSidePanelInputBox :is([data-testid="voice-live-pill"], button[data-testid="send-button"], .agy-send-button),
:is([data-testid="voice-live-pill"], button[data-testid="send-button"], .agy-send-button) {
  background-color: var(--ag-send-btn-bg, #2B7FFF) !important;
  color: #FFFFFF !important;
  border: 1px solid var(--ag-send-btn-border, #2B7FFF) !important;
  box-shadow: var(--ag-send-btn-shadow, 0 2px 6px rgba(43, 127, 255, 0.28)) !important;
}
#antigravity\\.agentSidePanelInputBox :is([data-testid="voice-live-pill"], button[data-testid="send-button"], .agy-send-button):hover,
:is([data-testid="voice-live-pill"], button[data-testid="send-button"], .agy-send-button):hover {
  background-color: var(--ag-send-btn-hover-bg, #1D6FEF) !important;
  opacity: 1 !important;
}
#antigravity\\.agentSidePanelInputBox :is([data-testid="voice-live-pill"], button[data-testid="send-button"], .agy-send-button) * {
  color: #FFFFFF !important;
  fill: #FFFFFF !important;
}
input[placeholder*="Search"],
input[data-ag-orig-placeholder*="Search"],
[data-testid="new-tab-search-input"],
input:not([type="checkbox"]):not([type="radio"]):not([type="range"])[class*="focus:border-primary"],
input:not([type="checkbox"]):not([type="radio"]):not([type="range"])[class*="focus:border-ring"] {
  --nux-focus-ring: transparent !important;
}
input[placeholder*="Search"]:is(:focus, :focus-visible),
input[data-ag-orig-placeholder*="Search"]:is(:focus, :focus-visible),
[data-testid="new-tab-search-input"]:is(:focus, :focus-visible),
input:not([type="checkbox"]):not([type="radio"]):not([type="range"])[class*="focus:border-primary"]:is(:focus, :focus-visible),
input:not([type="checkbox"]):not([type="radio"]):not([type="range"])[class*="focus:border-ring"]:is(:focus, :focus-visible) {
  outline: none !important;
  outline-offset: 0 !important;
  border-color: var(--primary, #2B7FFF) !important;
  box-shadow: none !important;
}
html[data-ag-preset] #antigravity\\.agentSidePanelInputBox [data-testid="voice-live-pill"] :is(.opacity-0, [class*="opacity-0"], [class*="opacity-0"] *),
[data-testid="voice-live-pill"] :is(.opacity-0, [class*="opacity-0"], [class*="opacity-0"] *) {
  opacity: 0 !important; visibility: hidden !important; display: none !important;
}
html[data-ag-preset] #antigravity\\.agentSidePanelInputBox [data-testid="voice-live-pill"] :is(.opacity-100, [class*="opacity-100"]),
[data-testid="voice-live-pill"] :is(.opacity-100, [class*="opacity-100"]) {
  opacity: 1 !important; visibility: visible !important; display: flex !important;
}
.bg-sidebar :is(a, button, [class*="truncate"], [class*="text-sm"], [class*="text-xs"]),
aside :is(a, button) {
  font-weight: 400 !important;
  letter-spacing: -0.012em !important;
  color: var(--ag-sidebar-fg, #171717) !important;
}
[data-testid="conversation-row-sidebar"]:not([data-selected="true"]) span.truncate,
.bg-sidebar [data-testid="conversation-row-sidebar"]:not([data-selected="true"]) [class*="truncate"],
.agy-sidebar-row:not([data-selected="true"]) span.truncate,
aside [data-testid="conversation-row-sidebar"]:not([data-selected="true"]) span {
  font-weight: 400 !important;
  letter-spacing: -0.005em !important;
  color: var(--ag-sidebar-row-fg, #262626) !important;
}
button[data-testid="project-header"],
button[data-project-card="true"],
[data-project-label],
[data-subtext] span[class*="text-muted"],
.bg-sidebar span:has(> svg) + span {
  font-weight: 400 !important;
  color: var(--ag-sidebar-header-fg, #404040) !important;
}
button[data-testid="project-header"] span,
button[data-project-card="true"] span {
  font-weight: 400 !important;
  letter-spacing: -0.01em !important;
  color: var(--ag-sidebar-header-title-fg, #171717) !important;
}
[data-testid="conversation-row-sidebar"][data-selected="true"],
[data-testid="conversation-row-sidebar"][data-selected="true"] span,
.bg-sidebar [data-testid="conversation-row-sidebar"][data-selected="true"] [class*="truncate"],
.bg-sidebar [data-active="true"],
.bg-sidebar [data-active="true"] span,
.bg-sidebar [aria-selected="true"] {
  font-weight: 500 !important;
  color: var(--ag-sidebar-selected-fg, #0D0D0D) !important;
}
.bg-sidebar :is([class*="text-muted"], [class*="text-[11px]"], [class*="uppercase"]) {
  font-weight: 400 !important;
  letter-spacing: -0.005em !important;
  color: var(--ag-sidebar-muted-fg, #676767) !important;
}
button, [role="button"], select { letter-spacing: -0.012em; }
[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [data-select-popup],
[data-testid="title-menu-bar"], [data-testid="title-menu-bar-item"], [data-testid="title-menu-bar-option"],
.agy-overlay, .agy-overlay-item, [data-radix-menu-content], [data-radix-popper-content-wrapper],
[data-side="top"]:not(.code-line), [data-side="bottom"]:not(.code-line), [data-side="left"]:not(.code-line), [data-side="right"]:not(.code-line) {
  font-family: var(--font-sans) !important;
}
[role="option"]:not([data-disabled]),
[data-testid="title-menu-bar-option"] {
  font-weight: 400 !important; letter-spacing: -0.01em !important; color: var(--ag-menu-item-fg, #171717) !important;
}
[role="menu"] :is([role="menuitem"], .agy-overlay-item, [class*="truncate"], [class*="text-xs"], [class*="text-[13px]"], span),
.agy-overlay .agy-overlay-item {
  font-weight: 400 !important; letter-spacing: -0.01em !important; color: var(--ag-menu-item-fg, #171717) !important;
}
[role="menu"] :is([role="menuitem"], .agy-overlay-item) > span,
[role="menu"] :is([role="menuitem"], .agy-overlay-item) :is(span[class*="flex-1"], span.truncate),
.agy-overlay .agy-overlay-item > span,
.agy-overlay .agy-overlay-item :is(span[class*="flex-1"], span.truncate) {
  font-weight: 400 !important; letter-spacing: -0.01em !important; color: var(--ag-menu-item-fg, #171717) !important;
}
[role="menu"] :is(h2, h3, h4) {
  font-weight: 500 !important; letter-spacing: -0.01em !important; color: var(--ag-menu-header-fg, #171717) !important;
}
[role="menu"] :is([class*="font-medium"], [class*="text-muted-foreground"]),
.agy-overlay :is([class*="font-medium"], [class*="text-muted-foreground"]) {
  font-weight: 400 !important; letter-spacing: -0.01em !important; color: var(--ag-menu-header-fg, #171717) !important;
}
[data-testid="permissions-selector-trigger"],
[data-testid="permissions-selector-trigger"] span:not(.codicon, .google-symbols),
[data-testid^="permissions-preset-option-"],
[data-testid^="permissions-preset-option-"] :is(div, p, span):not(.codicon, .google-symbols) {
  font-weight: 400 !important;
}
[role="dialog"] { font-family: var(--font-sans) !important; }
[role="dialog"] :is(h2, h3) { font-weight: 500 !important; letter-spacing: -0.01em !important; color: var(--ag-dialog-title-fg, #0D0D0D) !important; }
[role="dialog"] :is(.agy-card, [class*="agy-card"], [class*="divide-border"]) span.text-sm {
  font-weight: 400 !important; letter-spacing: -0.01em !important; color: var(--ag-dialog-item-fg, #171717) !important;
}

/* 10-light-codex.css */
html:not([data-ag-theme-mode="dark"]):not(:has(> body.dark)),
html:not([data-ag-theme-mode="dark"]) body:not(.dark) {
  --primary: #2B7FFF !important;
  --primary-foreground: #FFFFFF !important;
  --editor-selection-background: rgba(43, 127, 255, 0.22) !important;
  --background: #FFFFFF !important;
  --content: #FFFFFF !important;
  --foreground: #0D0D0D !important;
  --secondary-foreground: #171717 !important;
  --muted-foreground: #676767 !important;
  --sidebar: #F9F9F9 !important;
  --shell: #F9F9F9 !important;
  --vscode-sideBar-background: #F9F9F9 !important;
  --sidebar-secondary: #EFEFEF !important;
  --sidebar-muted: #F4F4F4 !important;
  --sidebar-border: rgba(0, 0, 0, 0.06) !important;
  --border: rgba(0, 0, 0, 0.08) !important;
  --card: #FFFFFF !important;
  --card-border: rgba(0, 0, 0, 0.08) !important;
  --card-edge: rgba(0, 0, 0, 0.06) !important;
  --sash-line: rgba(0, 0, 0, 0.06) !important;
  --onyx-frame: #EFEFEF !important;
  --onyx-well: #F9F9F9 !important;
  --onyx-raised: #FFFFFF !important;
  --onyx-selected: #EFEFEF !important;
  --onyx-key: #FFFFFF !important;
  --glass: #FFFFFF !important;
  --glass-border: rgba(0, 0, 0, 0.08) !important;
  --glass-highlight: transparent !important;
  --home-glow: transparent !important;
  --ag-composer-tray-bg: #F7F7F8;
  --ag-composer-tray-border: transparent;
  --ag-composer-card-bg: #FFFFFF;
  --ag-composer-card-border: rgba(0, 0, 0, 0.07);
  --ag-composer-card-shadow: 0 2px 10px rgba(0, 0, 0, 0.035), 0 1px 2px rgba(0, 0, 0, 0.02);
  --ag-composer-card-focus-border: rgba(0, 0, 0, 0.10);
  --ag-composer-card-focus-shadow: 0 4px 16px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.03);
  --ag-composer-top-fg: #171717;
  --ag-composer-top-hover-bg: rgba(0, 0, 0, 0.06);
  --ag-composer-top-hover-fg: #0D0D0D;
  --ag-composer-ctrl-fg: #171717;
  --ag-send-btn-bg: #2B7FFF;
  --ag-send-btn-hover-bg: #1D6FEF;
  --ag-send-btn-border: #2B7FFF;
  --ag-send-btn-shadow: 0 2px 6px rgba(43, 127, 255, 0.28);
  --ag-sidebar-fg: #171717;
  --ag-sidebar-row-fg: #262626;
  --ag-sidebar-header-fg: #404040;
  --ag-sidebar-header-title-fg: #171717;
  --ag-sidebar-selected-fg: #0D0D0D;
  --ag-sidebar-muted-fg: #676767;
  --ag-menu-item-fg: #171717;
  --ag-menu-header-fg: #171717;
  --ag-dialog-title-fg: #0D0D0D;
  --ag-dialog-item-fg: #171717;
  --code-foreground: #171717 !important;
}
body[data-agy-theme]:not(.dark) .agy-sidebar-row[data-selected="true"],
body[data-agy-theme][data-newux-theme="onyx"]:not(.dark) .agy-sidebar-row[data-selected="true"],
body:not(.dark) [data-testid="conversation-row-sidebar"][data-selected="true"],
body:not(.dark) .agy-sidebar-row[data-selected="true"] {
  background-color: #EFEFEF !important;
  --row-bg: #EFEFEF !important;
  border-radius: 10px !important;
  box-shadow: none !important;
}
html[data-ag-page-type="plugin"]:not([data-ag-theme-mode="dark"]),
html[data-ag-page-type="plugin"]:not([data-ag-theme-mode="dark"]) body {
  --primary-foreground: #FFFFFF !important;
  --secondary: rgba(0, 0, 0, 0.05) !important;
  --muted: rgba(0, 0, 0, 0.04) !important;
  --placeholder: #8C8C8C !important;
  --error: #DC2626 !important;
}
html:not([data-ag-theme-mode="dark"]) body:not(.dark):not(.theme-dark) #antigravity\\.agentSidePanelInputBox button[data-testid="input-cancel-button"] {
  background-color: rgba(0, 0, 0, 0.07) !important;
  color: #171717 !important;
}
html:not([data-ag-theme-mode="dark"]) body:not(.dark):not(.theme-dark) #antigravity\\.agentSidePanelInputBox button[data-testid="input-cancel-button"]:hover {
  background-color: rgba(0, 0, 0, 0.12) !important;
  color: #0D0D0D !important;
}

/* 20-dark-codex.css */
html[data-ag-theme-mode="dark"],
html[data-ag-theme-mode="dark"] body,
html:has(> body.dark),
body.dark,
body.theme-dark,
body[data-agy-theme].dark,
html[data-ag-preset] body.dark,
html[data-ag-preset] body[data-agy-theme].dark {
  --background: #181818 !important;
  --content: #181818 !important;
  --foreground: #FFFFFF !important;
  --primary: #2C67C5 !important;
  --primary-foreground: #FFFFFF !important;
  --editor-selection-background: rgba(44, 103, 197, 0.38) !important;
  --editor-comment-selection-background: rgba(44, 103, 197, 0.24) !important;
  --shell: #232323 !important;
  --sidebar: #232323 !important;
  --vscode-sideBar-background: #232323 !important;
  --sidebar-secondary: #353535 !important;
  --sidebar-muted: rgba(255, 255, 255, 0.06) !important;
  --sidebar-border: rgba(255, 255, 255, 0.08) !important;
  --secondary: rgba(255, 255, 255, 0.08) !important;
  --secondary-foreground: #DEDEDE !important;
  --muted: rgba(255, 255, 255, 0.05) !important;
  --muted-foreground: #959595 !important;
  --placeholder: #787878 !important;
  --card: #232323 !important;
  --card-border: rgba(255, 255, 255, 0.09) !important;
  --card-edge: rgba(255, 255, 255, 0.08) !important;
  --sash-line: rgba(255, 255, 255, 0.09) !important;
  --border: rgba(255, 255, 255, 0.08) !important;
  --glass: #282828 !important;
  --glass-border: rgba(255, 255, 255, 0.09) !important;
  --glass-highlight: rgba(255, 255, 255, 0.06) !important;
  --scrim: rgba(0, 0, 0, 0.65) !important;
  --onyx-frame: #282828 !important;
  --onyx-well: #232323 !important;
  --onyx-raised: #363636 !important;
  --onyx-selected: #353535 !important;
  --onyx-key: #303030 !important;
  --home-glow: transparent !important;
  --error: #E55353 !important;
  --warning: #FBBF24 !important;
  --link: #60A5FA !important;
  --success: #2ec990 !important;
  --ag-composer-tray-bg: #262626;
  --ag-composer-tray-border: transparent;
  --ag-composer-card-bg: #363636;
  --ag-composer-card-border: rgba(255, 255, 255, 0.07);
  --ag-composer-card-shadow: 0 3px 12px rgba(0, 0, 0, 0.24), 0 1px 3px rgba(0, 0, 0, 0.18);
  --ag-composer-card-focus-border: rgba(255, 255, 255, 0.12);
  --ag-composer-card-focus-shadow: 0 5px 18px rgba(0, 0, 0, 0.34), 0 2px 5px rgba(0, 0, 0, 0.22);
  --ag-composer-top-fg: #D4D4D4;
  --ag-composer-top-hover-bg: rgba(255, 255, 255, 0.08);
  --ag-composer-top-hover-fg: #FFFFFF;
  --ag-composer-ctrl-fg: #DEDEDE;
  --ag-send-btn-bg: #2C67C5;
  --ag-send-btn-hover-bg: #3774D6;
  --ag-send-btn-border: rgba(255, 255, 255, 0.12);
  --ag-send-btn-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  --ag-sidebar-fg: #DEDEDE;
  --ag-sidebar-row-fg: #CFCFCF;
  --ag-sidebar-header-fg: #B8B8B8;
  --ag-sidebar-header-title-fg: #EAEAEA;
  --ag-sidebar-selected-fg: #FFFFFF;
  --ag-sidebar-muted-fg: #8E8E8E;
  --ag-menu-item-fg: #E8E8E8;
  --ag-menu-header-fg: #959595;
  --ag-dialog-title-fg: #FFFFFF;
  --ag-dialog-item-fg: #E8E8E8;
  --code-foreground: #ECECEC !important;
}
body[data-agy-theme].dark .agy-sidebar-row[data-selected="true"],
body[data-agy-theme][data-newux-theme="onyx"].dark .agy-sidebar-row[data-selected="true"],
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is([data-testid="conversation-row-sidebar"][data-selected="true"], .agy-sidebar-row[data-selected="true"]) {
  background-color: #353535 !important;
  --row-bg: #353535 !important;
  border-radius: 10px !important;
  box-shadow: none !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is(#antigravity\\.agentSidePanelInputBox, [id="antigravity.agentSidePanelInputBox"], .surface-composer, .surface-composer.bg-card-border) {
  --nux-composer-frame-radius: 21px;
  --nux-composer-radius: 20px;
  padding: 1px !important;
  background-color: #262626 !important;
  border: 0 !important;
  border-radius: 21px !important;
  box-shadow: none !important;
}
body[data-agy-theme].dark .surface-composer > .surface-composer-card,
body[data-agy-theme][data-newux-theme="onyx"].dark .surface-composer > .surface-composer-card,
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is(
  .surface-composer > .surface-composer-card,
  .surface-composer-card.bg-card,
  [id="antigravity.agentSidePanelInputBox"] .surface-composer-card,
  [id="antigravity.agentSidePanelInputBox"] > div.bg-card
) {
  background-color: #363636 !important;
  border: 1px solid rgba(255, 255, 255, 0.07) !important;
  border-radius: 20px !important;
  box-shadow: var(--ag-composer-card-shadow) !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is(
  .surface-composer:focus-within > .surface-composer-card,
  .surface-composer-card:focus-within,
  [id="antigravity.agentSidePanelInputBox"]:focus-within .surface-composer-card
) {
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: var(--ag-composer-card-focus-shadow) !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) #antigravity\\.agentSidePanelInputBox button[data-testid="input-cancel-button"] {
  background-color: rgba(255, 255, 255, 0.11) !important;
  color: #EAEAEA !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) #antigravity\\.agentSidePanelInputBox button[data-testid="input-cancel-button"]:hover {
  background-color: rgba(255, 255, 255, 0.18) !important;
  color: #FFFFFF !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) #antigravity\\.agentSidePanelInputBox button:not([data-testid="send-button"]):not([data-testid="voice-start-button"]):not([data-testid="input-cancel-button"]):hover,
:is(html[data-ag-theme-mode="dark"] body, body.dark) #antigravity\\.agentSidePanelInputBox button:not([data-testid="send-button"]):not([data-testid="voice-start-button"]):not([data-testid="input-cancel-button"]):hover :is(span, svg) {
  color: #FFFFFF !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is([data-testid="conversation-row-sidebar"], .agy-sidebar-row):not([data-selected="true"]):hover span.truncate {
  color: #FFFFFF !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) :is(.bg-sidebar a[class*="border"], .bg-sidebar button[class*="border"], a[class*="inline-flex items-center"][class*="border"]) {
  border-color: rgba(255, 255, 255, 0.10) !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark) .bg-border {
  background-color: rgba(255, 255, 255, 0.08) !important;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark, body.theme-dark) :is([data-markdown-root], [data-testid="user-message-content"], .prose, .markdown) {
  color: #ECECEC;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark, body.theme-dark) :is([data-markdown-root], [data-testid="user-message-content"], .select-text, .prose, .markdown) :is(h1, h2, h3, h4, h5, h6, strong, b) {
  color: #FFFFFF;
}
:is(html[data-ag-theme-mode="dark"] body, body.dark, body.theme-dark) :is([data-markdown-root], .select-text, .prose, .markdown) :not(pre) > code {
  background-color: rgba(255, 255, 255, 0.085);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 5px;
  padding: 0.12em 0.36em;
  color: #EAEAEA !important;
}
`;

  const SETTINGS_CSS = `
/* 45-settings-ui.css (scoped, zero forbidden colors) */
#ag-settings-nav-wrap,
#ag-settings-pane,
#ag-settings-font-menu {
  --ag-s-bg: var(--background, #FFFFFF);
  --ag-s-sidebar: var(--sidebar, #FAFAFA);
  --ag-s-selected: var(--sidebar-secondary, var(--secondary, rgba(0, 0, 0, 0.06)));
  --ag-s-hover: var(--muted, rgba(0, 0, 0, 0.04));
  --ag-s-card: var(--card, var(--background, transparent));
  --ag-s-surface: var(--muted, rgba(0, 0, 0, 0.038));
  --ag-s-border: var(--card-border, var(--border, rgba(0, 0, 0, 0.08)));
  --ag-s-hairline: var(--border, rgba(0, 0, 0, 0.06));
  --ag-s-fg: var(--foreground, #0A0A0C);
  --ag-s-fg-2: var(--secondary-foreground, #3F3F46);
  --ag-s-fg-3: var(--muted-foreground, #71717A);
  --ag-s-primary: var(--primary, #2F75C3);
  --ag-s-focus: var(--primary, #2F75C3);
  --ag-s-switch-off: rgba(128, 128, 128, 0.30);
  --ag-s-ok: var(--success, #2ec990);
  --ag-s-warn: var(--warning, #D97706);
  --ag-s-err: var(--error, #DC2626);
  --ag-s-seg-bg: var(--secondary, rgba(0, 0, 0, 0.06));
  --ag-s-seg-active: var(--card, var(--background, #FFFFFF));
  --ag-s-seg-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  --ag-s-badge-bg: var(--secondary, rgba(0, 0, 0, 0.06));
  --ag-s-dropdown-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.14), 0 2px 8px -2px rgba(15, 23, 42, 0.06);
  --ag-s-font: var(--font-sans, Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", system-ui, sans-serif);
  --ag-s-mono: var(--font-mono, "SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
}
:is(html.dark body, body.dark, body.theme-dark, body[data-agy-theme].dark) :is(#ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu) {
  --ag-s-switch-off: rgba(255, 255, 255, 0.22);
  --ag-s-seg-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  --ag-s-dropdown-shadow: 0 20px 44px -6px rgba(0, 0, 0, 0.72), 0 4px 12px rgba(0, 0, 0, 0.42);
}
html[data-ag-preset]:not([data-ag-theme-mode="dark"]):not(:has(> body.dark)) :is(#ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu) {
  --ag-s-bg: var(--background, #FFFFFF);
  --ag-s-sidebar: var(--sidebar, #F9F9F9);
  --ag-s-selected: var(--sidebar-secondary, #EFEFEF);
  --ag-s-hover: rgba(0, 0, 0, 0.045);
  --ag-s-card: var(--card, #FFFFFF);
  --ag-s-surface: #F6F7F9;
  --ag-s-border: rgba(0, 0, 0, 0.08);
  --ag-s-hairline: rgba(0, 0, 0, 0.06);
  --ag-s-fg: #0D0D0D;
  --ag-s-fg-2: #525252;
  --ag-s-fg-3: #858585;
  --ag-s-primary: #2B7FFF;
  --ag-s-focus: #2B7FFF;
  --ag-s-switch-off: #D1D5DB;
  --ag-s-ok: #2ec990;
  --ag-s-warn: #D97706;
  --ag-s-err: #DC2626;
  --ag-s-seg-bg: #F3F4F6;
  --ag-s-seg-active: #FFFFFF;
  --ag-s-seg-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  --ag-s-badge-bg: #F3F4F6;
}
:is(html[data-ag-preset][data-ag-theme-mode="dark"] body, html[data-ag-preset].dark body, html[data-ag-preset] body.dark, html[data-ag-preset] body.theme-dark, html[data-ag-preset] body[data-agy-theme].dark) :is(#ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu) {
  --ag-s-bg: var(--background, #181818);
  --ag-s-sidebar: var(--sidebar, #232323);
  --ag-s-selected: var(--sidebar-secondary, #353535);
  --ag-s-hover: rgba(255, 255, 255, 0.06);
  --ag-s-card: var(--card, #212121);
  --ag-s-surface: #2B2B2B;
  --ag-s-border: rgba(255, 255, 255, 0.09);
  --ag-s-hairline: rgba(255, 255, 255, 0.07);
  --ag-s-fg: #F5F5F5;
  --ag-s-fg-2: #B8B8B8;
  --ag-s-fg-3: #8E8E8E;
  --ag-s-primary: #2C67C5;
  --ag-s-focus: #60A5FA;
  --ag-s-switch-off: #444444;
  --ag-s-ok: #2ec990;
  --ag-s-warn: #FBBF24;
  --ag-s-err: #F87171;
  --ag-s-seg-bg: #2A2A2A;
  --ag-s-seg-active: #3A3A3A;
  --ag-s-seg-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  --ag-s-badge-bg: #303030;
  --ag-s-dropdown-shadow: 0 20px 44px -6px rgba(0, 0, 0, 0.72), 0 4px 12px rgba(0, 0, 0, 0.42);
}
#ag-settings-nav-divider {
  margin: 8px 16px 6px 16px;
  border-top: 1px solid var(--sidebar-border, var(--border, rgba(0, 0, 0, 0.06)));
}
#ag-settings-nav-wrap { margin: 0 8px; }
#ag-settings-nav-btn {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 4px 8px; border: none; border-radius: 8px;
  background: transparent; color: var(--ag-s-fg) !important;
  font-family: var(--ag-s-font) !important; font-size: 14px !important; line-height: 20px !important; font-weight: 400;
  text-align: left; cursor: pointer; outline: none; user-select: none;
  transition: background-color 120ms ease, color 120ms ease;
}
#ag-settings-nav-btn:hover { background-color: var(--ag-s-hover) !important; color: var(--ag-s-fg) !important; }
#ag-settings-nav-btn:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: -2px; }
#ag-settings-nav-btn .ag-s-nav-left { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
#ag-settings-nav-btn .ag-s-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ag-codex-settings-open="1"] #ag-settings-nav-btn {
  background-color: var(--ag-s-selected) !important; color: var(--ag-s-fg) !important; font-weight: 500 !important;
}
[data-ag-codex-settings-open="1"] [data-testid="settings-sidebar"] button:not(#ag-settings-nav-btn):not(:hover) {
  background-color: transparent !important; font-weight: 400 !important;
}
[data-ag-codex-settings-open="1"] [data-ag-settings-right-pane="1"] > :not(#ag-settings-pane):not(button):not([data-testid*="close"]) {
  display: none !important;
}
#ag-settings-pane {
  display: none; box-sizing: border-box; width: 100%; height: 100%; overflow-y: auto;
  padding: 36px 24px 48px 24px; background-color: transparent; color: var(--ag-s-fg);
  font-family: var(--ag-s-font) !important; -webkit-font-smoothing: antialiased;
}
[data-ag-codex-settings-open="1"] #ag-settings-pane { display: block; }
#ag-settings-pane *, #ag-settings-font-menu * { box-sizing: border-box; }
#ag-settings-pane .ag-s-header { width: 100%; max-width: 624px; margin: 0 auto 24px auto; padding-right: 0; }
@media (max-width: 900px) { #ag-settings-pane .ag-s-header { padding-right: 32px; } }
#ag-settings-pane .ag-s-title-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
#ag-settings-pane .ag-s-title-left { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
#ag-settings-pane .ag-s-title { margin: 0 !important; font-size: 18px !important; line-height: 26px !important; font-weight: 600 !important; letter-spacing: -0.015em !important; color: var(--ag-s-fg) !important; }
#ag-settings-pane .ag-s-hdr-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
  background-color: var(--ag-s-surface) !important; border: 1px solid var(--ag-s-border) !important;
  color: var(--ag-s-fg) !important; font-family: var(--ag-s-font) !important; font-size: 12px !important;
  line-height: 16px !important; font-weight: 500; cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
#ag-settings-pane .ag-s-hdr-link:hover { background-color: var(--ag-s-selected) !important; }
#ag-settings-pane .ag-s-hdr-link:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: 2px; }
#ag-settings-pane .ag-s-hot-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
  background-color: var(--ag-s-surface); border: 1px solid rgba(46, 201, 144, 0.35);
  color: var(--ag-s-ok) !important; font-family: var(--ag-s-mono) !important; font-variant-numeric: tabular-nums;
  font-size: 11px !important; line-height: 16px !important; transition: opacity 160ms ease;
}
#ag-settings-pane .ag-s-hot-badge[hidden] { display: none !important; }
#ag-settings-pane .ag-s-subtitle { margin: 10px 0 0 0 !important; font-size: 12px !important; line-height: 18px !important; color: var(--ag-s-fg-3) !important; }
#ag-settings-pane .ag-s-sections { display: flex; flex-direction: column; gap: 22px; width: 100%; max-width: 624px; margin: 0 auto; }
#ag-settings-pane .ag-s-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
#ag-settings-pane .ag-s-section-title { font-size: 13px !important; line-height: 18px !important; font-weight: 600 !important; color: var(--ag-s-fg) !important; }
#ag-settings-pane .ag-s-card { border-radius: 12px; background-color: var(--ag-s-card); border: 1px solid var(--ag-s-border); overflow: visible; }
#ag-settings-pane .ag-s-row { padding: 12px 16px; }
#ag-settings-pane .ag-s-row + .ag-s-row { border-top: 1px solid var(--ag-s-hairline); }
#ag-settings-pane .ag-s-row-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
#ag-settings-pane .ag-s-row-info { min-width: 0; flex: 1 1 auto; }
#ag-settings-pane .ag-s-row-label { display: block; font-size: 13px !important; line-height: 19px !important; font-weight: 500 !important; color: var(--ag-s-fg) !important; cursor: pointer; }
#ag-settings-pane .ag-s-row-desc { margin-top: 2px; font-size: 12px !important; line-height: 17px !important; color: var(--ag-s-fg-3) !important; }
#ag-settings-pane .ag-s-subrow {
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--ag-s-hairline);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
}
#ag-settings-pane .ag-s-subrow[hidden] { display: none !important; }
#ag-settings-pane .ag-s-sub-label { font-size: 12px !important; line-height: 17px !important; font-weight: 500 !important; color: var(--ag-s-fg) !important; }
#ag-settings-pane .ag-s-sub-desc { margin-top: 2px; font-size: 11px !important; line-height: 16px !important; color: var(--ag-s-fg-3) !important; }
#ag-settings-pane input.ag-s-switch {
  -webkit-appearance: none; appearance: none; position: relative; display: inline-flex; align-items: center;
  width: 36px; height: 20px; margin: 0; padding: 0; border: none; border-radius: 999px;
  background-color: var(--ag-s-switch-off) !important; cursor: pointer; flex-shrink: 0;
  transition: background-color 160ms ease;
}
#ag-settings-pane input.ag-s-switch::before {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px;
  background-color: #FFFFFF; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22); transform: translateX(0);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
#ag-settings-pane input.ag-s-switch:checked { background-color: var(--ag-s-primary) !important; }
#ag-settings-pane input.ag-s-switch:checked::before { transform: translateX(16px); }
#ag-settings-pane input.ag-s-switch:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: 3px; }
#ag-settings-pane .ag-s-seg { display: inline-flex; padding: 2px; border-radius: 8px; background-color: var(--ag-s-seg-bg); flex-shrink: 0; flex-wrap: wrap; }
#ag-settings-pane .ag-s-seg-btn {
  padding: 4px 10px; border: none; border-radius: 6px; background: transparent;
  color: var(--ag-s-fg-3) !important; font-family: var(--ag-s-font) !important; font-size: 12px !important;
  line-height: 16px !important; font-weight: 500; cursor: pointer; white-space: nowrap;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
#ag-settings-pane .ag-s-seg-btn[aria-pressed="true"] {
  background-color: var(--ag-s-seg-active) !important; color: var(--ag-s-fg) !important; box-shadow: var(--ag-s-seg-shadow);
}
#ag-settings-pane .ag-s-seg-btn:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: 1px; }
#ag-settings-pane .ag-s-qstyle-subrow { flex-direction: column; align-items: stretch; gap: 8px; }
#ag-settings-pane .ag-s-qstyle-subrow[hidden] { display: none !important; }
#ag-settings-pane .ag-s-qstyle-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
#ag-settings-pane .ag-s-qstyle-hint { font-size: 11px !important; color: var(--ag-s-fg-3) !important; }
#ag-settings-pane .ag-s-qstyle-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; width: 100%; }
@media (max-width: 720px) { #ag-settings-pane .ag-s-qstyle-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
#ag-settings-pane .ag-s-qstyle-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 6px 7px; border-radius: 8px; border: 1px solid var(--ag-s-border);
  background-color: var(--ag-s-surface) !important; color: var(--ag-s-fg-2) !important;
  font-family: var(--ag-s-font) !important; font-size: 11px !important; line-height: 14px !important; font-weight: 500;
  cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
#ag-settings-pane .ag-s-qstyle-card:hover { background-color: var(--ag-s-selected) !important; color: var(--ag-s-fg) !important; }
#ag-settings-pane .ag-s-qstyle-card[aria-pressed="true"] {
  background-color: var(--ag-s-seg-active) !important; border-color: var(--ag-s-fg) !important;
  color: var(--ag-s-fg) !important; box-shadow: var(--ag-s-seg-shadow);
}
#ag-settings-pane .ag-s-qstyle-card:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: 1px; }
#ag-settings-pane .ag-s-qstyle-prev { display: flex; align-items: center; justify-content: center; width: 44px; height: 20px; color: var(--ag-s-fg); }
#ag-settings-pane .ag-s-qstyle-block-disabled { opacity: 0.45; pointer-events: none; }
#ag-settings-pane .ag-s-link-btn {
  padding: 0; border: none; background: transparent; color: var(--ag-s-fg-3) !important;
  font-family: var(--ag-s-font) !important; font-size: 12px !important; line-height: 16px !important; cursor: pointer;
  transition: color 120ms ease;
}
#ag-settings-pane .ag-s-link-btn:hover { color: var(--ag-s-fg) !important; }
#ag-settings-pane .ag-s-pill-trigger {
  display: inline-flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 5px 12px; border-radius: 999px; background-color: var(--ag-s-surface) !important;
  color: var(--ag-s-fg) !important; border: 1px solid var(--ag-s-border) !important;
  font-family: var(--ag-s-font) !important; font-size: 13px !important; line-height: 19px !important;
  cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease;
}
#ag-settings-pane .ag-s-pill-trigger:hover,
#ag-settings-pane .ag-s-pill-trigger[aria-expanded="true"] { background-color: var(--ag-s-selected) !important; }
#ag-settings-pane .ag-s-pill-trigger:focus-visible { outline: 2px solid var(--ag-s-focus); outline-offset: 2px; }
#ag-settings-pane .ag-s-font-trigger { min-width: 136px; max-width: 224px; }
#ag-settings-pane .ag-s-font-trigger-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ag-settings-font-menu {
  padding: 6px; border-radius: 12px; background-color: var(--ag-s-card) !important;
  border: 1px solid var(--ag-s-border) !important; box-shadow: var(--ag-s-dropdown-shadow);
  color: var(--ag-s-fg) !important; font-family: var(--ag-s-font) !important; font-size: 13px !important; line-height: 19px !important;
  overflow-y: auto; width: min(228px, calc(100vw - 24px)); max-height: min(248px, calc(100vh - 24px));
}
#ag-settings-font-menu[data-js-pos="1"] { position: fixed; inset: auto; margin: 0; }
#ag-settings-font-menu .ag-s-menu-list { display: flex; flex-direction: column; gap: 2px; }
#ag-settings-font-menu .ag-s-menu-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
  padding: 6px 10px; border: none; border-radius: 8px; background: transparent;
  color: var(--ag-s-fg) !important; font-family: var(--ag-s-font) !important; font-size: 13px !important; line-height: 19px !important;
  text-align: left; cursor: pointer; outline: none; transition: background-color 100ms ease;
}
#ag-settings-font-menu .ag-s-menu-row:hover,
#ag-settings-font-menu .ag-s-menu-row[data-hovered="true"] { background-color: var(--ag-s-selected) !important; }
#ag-settings-font-menu .ag-s-menu-row:focus-visible { background-color: var(--ag-s-selected) !important; outline: 2px solid var(--ag-s-focus); outline-offset: -2px; }
#ag-settings-font-menu .ag-s-menu-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ag-settings-font-menu .ag-s-menu-row[data-selected="true"] .ag-s-menu-row-name,
#ag-settings-font-menu .ag-s-menu-row[aria-checked="true"] { font-weight: 500 !important; }
#ag-settings-font-menu .ag-s-menu-row-right { display: inline-flex; align-items: center; color: var(--ag-s-fg-3) !important; flex-shrink: 0; }
#ag-settings-font-menu .ag-s-menu-row-check { color: var(--ag-s-fg) !important; }
`;

  /* ============================================================================
   * 4. Config State, Persistence & Two-Way Sync
   * ============================================================================ */

  function readLocalCodexUi() {
    try {
      const raw = win.localStorage?.getItem?.(STORAGE_KEY_CODEX_UI);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return null;
  }

  function readHostCodexUi() {
    try {
      const cu = win.__AGContextMeterSettings?.uiPreferences?.codexUi;
      if (cu && typeof cu === 'object') return cu;
    } catch {}
    return null;
  }

  function readShowTopbarQuota() {
    try {
      const hostFlag = win.__AGContextMeterSettings?.uiPreferences?.featureFlags?.showTopbarQuota;
      if (typeof hostFlag === 'boolean') return hostFlag;
    } catch {}
    try {
      const raw = win.localStorage?.getItem?.(STORAGE_KEY_FEATURE_FLAGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.showTopbarQuota === 'boolean') return parsed.showTopbarQuota;
      }
    } catch {}
    return true;
  }

  function readAllFeatureFlags() {
    let flags = {};
    try {
      const raw = win.localStorage?.getItem?.(STORAGE_KEY_FEATURE_FLAGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') flags = Object.assign({}, parsed);
      }
    } catch {}
    try {
      const hostFlags = win.__AGContextMeterSettings?.uiPreferences?.featureFlags;
      if (hostFlags && typeof hostFlags === 'object') {
        flags = Object.assign({}, flags, hostFlags);
      }
    } catch {}
    return flags;
  }

  let currentConfig = normalizeCodexConfig(
    Object.assign({}, DEFAULT_CODEX_UI, readLocalCodexUi() || {}, readHostCodexUi() || {})
  );
  let currentShowTopbarQuota = readShowTopbarQuota();

  function getConfig() {
    return Object.assign({}, currentConfig, {
      fonts: Object.assign({}, currentConfig.fonts)
    });
  }

  async function callHostBridge(route, payload, ipcMethod) {
    const fetchFn = typeof fetch === 'function' ? fetch : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    try {
      const live = win.__AGContextMeterLive;
      if (live && live.port && live.token && fetchFn) {
        const resp = await fetchFn(`http://127.0.0.1:${live.port}${route}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AG-Context-Token': live.token
          },
          body: JSON.stringify(payload || {})
        });
        if (resp && resp.ok) {
          const json = await resp.json().catch(() => null);
          if (json !== null) return json;
        }
      }
    } catch {}
    try {
      if (win.contextMeterAPI && typeof win.contextMeterAPI[ipcMethod] === 'function') {
        return await win.contextMeterAPI[ipcMethod](payload);
      }
    } catch {}
    return null;
  }

  function writeHostSettingsCache(partialUiPrefs) {
    try {
      const cur = win.__AGContextMeterSettings && typeof win.__AGContextMeterSettings === 'object' ? win.__AGContextMeterSettings : {};
      const nextUi = Object.assign({}, cur.uiPreferences || {}, partialUiPrefs || {});
      win.__AGContextMeterSettings = Object.assign({}, cur, {
        ok: cur.ok !== undefined ? cur.ok : true,
        uiPreferences: nextUi
      });
    } catch {}
  }

  async function hydrateConfigFromHost() {
    if (disposed) return;
    try {
      const res = await callHostBridge('/get-settings', {}, 'getSettings');
      if (disposed || !res || !res.ok) return;
      if (res.uiPreferences && typeof res.uiPreferences === 'object') {
        writeHostSettingsCache(res.uiPreferences);
        if (res.uiPreferences.codexUi && typeof res.uiPreferences.codexUi === 'object') {
          updateConfig(res.uiPreferences.codexUi, { persist: false, broadcast: false });
        }
        if (res.uiPreferences.featureFlags && typeof res.uiPreferences.featureFlags.showTopbarQuota === 'boolean') {
          currentShowTopbarQuota = res.uiPreferences.featureFlags.showTopbarQuota;
        }
        const hostLoc = normalizeLocaleCode(res.uiPreferences.locale || res.uiPreferences.panelLanguage);
        if (hostLoc && hostLoc !== activeLocale) {
          activeLocale = hostLoc;
        }
        renderPane();
        renderQuota();
      }
    } catch {}
  }

  function updateConfig(patch, opts = {}) {
    if (disposed) return getConfig();
    const { persist = true, broadcast = true } = opts || {};
    const src = patch && typeof patch === 'object' ? patch : {};
    const mergedFonts = src.fonts && typeof src.fonts === 'object'
      ? Object.assign({}, currentConfig.fonts, src.fonts)
      : Object.assign({}, currentConfig.fonts);
    const next = normalizeCodexConfig(Object.assign({}, currentConfig, src, { fonts: mergedFonts }));
    const prev = currentConfig;
    currentConfig = next;

    try {
      win.localStorage?.setItem?.(STORAGE_KEY_CODEX_UI, JSON.stringify(next));
    } catch {}
    writeHostSettingsCache({ codexUi: next });

    if (next.codexTheme !== prev.codexTheme) {
      syncCodexThemeModule();
    }
    if (JSON.stringify(next.fonts) !== JSON.stringify(prev.fonts)) {
      applyUserFonts(next.fonts);
    }
    if (!next.quotaSidebar) {
      cleanupQuotaDom();
    } else {
      if (!prev.quotaSidebar) {
        ensureQuotaStyleTag();
        void fetchQuota(false);
      }
      renderQuota();
    }
    renderPane();

    if (persist) {
      void callHostBridge('/save-settings', { uiPreferences: { codexUi: next } }, 'saveSettings');
    }
    if (broadcast && typeof win.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        win.dispatchEvent(new CustomEvent('ag-codex-config-changed', { detail: { codexUi: getConfig() } }));
      } catch {}
    }
    return getConfig();
  }

  function toggleTopbarQuotaFlag(checked) {
    const nextVal = Boolean(checked);
    currentShowTopbarQuota = nextVal;
    const nextFlags = Object.assign({}, readAllFeatureFlags(), { showTopbarQuota: nextVal });
    try {
      win.localStorage?.setItem?.(STORAGE_KEY_FEATURE_FLAGS, JSON.stringify(nextFlags));
    } catch {}
    writeHostSettingsCache({ featureFlags: nextFlags });
    void callHostBridge('/save-settings', { uiPreferences: { featureFlags: nextFlags } }, 'saveSettings');
    try {
      if (typeof win.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        win.dispatchEvent(new CustomEvent('ag-suite-prefs-changed', { detail: { featureFlags: nextFlags } }));
      }
    } catch {}
  }

  function onSuitePrefsChanged(ev) {
    if (disposed) return;
    const detail = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
    let needsRender = false;
    const nextLoc = normalizeLocaleCode(detail.locale || detail.hansCode || detail.capsuleLang) || resolveActiveLocale();
    if (nextLoc && nextLoc !== activeLocale) {
      activeLocale = nextLoc;
      needsRender = true;
    }
    if (detail.featureFlags && typeof detail.featureFlags.showTopbarQuota === 'boolean') {
      if (currentShowTopbarQuota !== detail.featureFlags.showTopbarQuota) {
        currentShowTopbarQuota = detail.featureFlags.showTopbarQuota;
        needsRender = true;
      }
    }
    if (detail.codexUi && typeof detail.codexUi === 'object') {
      updateConfig(detail.codexUi, { persist: false, broadcast: false });
      needsRender = false;
    }
    if (needsRender) {
      renderQuota();
      renderPane();
    }
  }

  /* ============================================================================
   * 5. Style Tag Helper & OS Attribute Helper
   * ============================================================================ */

  function ensureStyleTag(id, cssText) {
    if (!doc) return null;
    const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
    if (!head) return null;
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement('style');
      el.id = id;
      head.appendChild(el);
    }
    if (el.textContent !== cssText) {
      el.textContent = cssText;
    }
    return el;
  }

  function removeElementById(id) {
    if (!doc) return;
    try {
      const el = doc.getElementById(id);
      if (el) el.remove();
    } catch {}
  }

  function detectOsName() {
    try {
      const nav = win.navigator || {};
      const plat = String(nav.platform || '');
      const ua = String(nav.userAgent || '');
      if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'win32';
      if (/Mac/i.test(plat) || /Macintosh|Mac OS/i.test(ua)) return 'darwin';
      return 'linux';
    } catch {
      return 'darwin';
    }
  }

  const detectedOs = detectOsName();

  function ensureOsAttr() {
    if (!doc || !doc.documentElement) return;
    doc.documentElement.setAttribute('data-ag-os', detectedOs);
    if (IS_SWARM_PLUGIN_FRAME) {
      doc.documentElement.setAttribute('data-ag-page-type', 'plugin');
    }
  }

  function applyUserFonts(fontsCfg) {
    if (disposed || !doc) return;
    const css = buildUserFontsCss(fontsCfg);
    if (!css) {
      removeElementById('ag-user-fonts');
      return;
    }
    ensureOsAttr();
    ensureStyleTag('ag-user-fonts', css);
  }

  /* ============================================================================
   * 6. Codex Light & Dark Theme Module (Part 20)
   * ============================================================================ */

  const PRESETS = {
    CODEX_PURE_WHITE: 'codex-pure-white',
    CODEX_DARK: 'codex-dark'
  };
  const ALL_CUSTOM_PRESET_NAMES = new Set([PRESETS.CODEX_PURE_WHITE, PRESETS.CODEX_DARK, 'onyx-dark']);

  let themeObserver = null;
  let origGetItemFn = null;
  let origSetItemFn = null;
  let wrappedGetItemFn = null;
  let wrappedSetItemFn = null;
  let themeSyncTimer = null;

  function installLocalStoragePresetHook() {
    if (wrappedGetItemFn || !win.localStorage) return;
    try {
      const ls = win.localStorage;
      const origGet = ls.getItem;
      const origSet = ls.setItem;
      if (typeof origGet !== 'function' || typeof origSet !== 'function') return;
      origGetItemFn = origGet;
      origSetItemFn = origSet;

      wrappedGetItemFn = function (key) {
        const val = origGet.call(ls, key);
        if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) return 'Default Light';
        if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) return 'Default Dark';
        return val;
      };
      wrappedSetItemFn = function (key, val) {
        let nextVal = val;
        if (key === 'theme-preset-light' && ALL_CUSTOM_PRESET_NAMES.has(val)) nextVal = 'Default Light';
        if (key === 'theme-preset-dark' && ALL_CUSTOM_PRESET_NAMES.has(val)) nextVal = 'Default Dark';
        origSet.call(ls, key, nextVal);
        if (
          key === 'theme-preset-light' ||
          key === 'theme-preset-dark' ||
          key === 'theme-mode' ||
          key === 'theme-color-flavor'
        ) {
          if (themeSyncTimer) clearTimeout(themeSyncTimer);
          themeSyncTimer = setTimeout(() => {
            themeSyncTimer = null;
            if (!disposed && currentConfig.codexTheme) syncThemePreset();
          }, 50);
        }
      };
      ls.getItem = wrappedGetItemFn;
      ls.setItem = wrappedSetItemFn;
    } catch {}
  }

  function restoreLocalStoragePresetHook() {
    if (themeSyncTimer) {
      clearTimeout(themeSyncTimer);
      themeSyncTimer = null;
    }
    try {
      const ls = win.localStorage;
      if (!ls) return;
      if (wrappedGetItemFn && ls.getItem === wrappedGetItemFn) {
        if (origGetItemFn && origGetItemFn !== Storage.prototype.getItem) {
          ls.getItem = origGetItemFn;
        } else {
          delete ls.getItem;
          if (ls.getItem === wrappedGetItemFn && origGetItemFn) {
            ls.getItem = origGetItemFn;
          }
        }
      }
      if (wrappedSetItemFn && ls.setItem === wrappedSetItemFn) {
        if (origSetItemFn && origSetItemFn !== Storage.prototype.setItem) {
          ls.setItem = origSetItemFn;
        } else {
          delete ls.setItem;
          if (ls.setItem === wrappedSetItemFn && origSetItemFn) {
            ls.setItem = origSetItemFn;
          }
        }
      }
    } catch {}
    origGetItemFn = null;
    origSetItemFn = null;
    wrappedGetItemFn = null;
    wrappedSetItemFn = null;
  }

  function syncThemePreset() {
    if (disposed || !doc || !doc.documentElement) return;
    if (!currentConfig.codexTheme) {
      doc.documentElement.removeAttribute('data-ag-preset');
      doc.documentElement.removeAttribute('data-ag-theme-mode');
      return;
    }
    try {
      const ls = win.localStorage;
      const rawGet = origGetItemFn ? (k) => origGetItemFn.call(ls, k) : (k) => Storage.prototype.getItem.call(ls, k);
      const rawSet = origSetItemFn ? (k, v) => origSetItemFn.call(ls, k, v) : (k, v) => Storage.prototype.setItem.call(ls, k, v);

      try {
        const storedLight = rawGet('theme-preset-light');
        if (ALL_CUSTOM_PRESET_NAMES.has(storedLight)) rawSet('theme-preset-light', 'Default Light');
        const storedDark = rawGet('theme-preset-dark');
        if (ALL_CUSTOM_PRESET_NAMES.has(storedDark)) rawSet('theme-preset-dark', 'Default Dark');
      } catch {}

      const bodyEl = doc.body;
      const bodyExplicitDark = Boolean(
        bodyEl &&
          (bodyEl.classList.contains('dark') ||
            bodyEl.classList.contains('theme-dark') ||
            bodyEl.classList.contains('dark-theme'))
      );
      const bodyExplicitLight = Boolean(
        bodyEl &&
          (bodyEl.classList.contains('theme-light') ||
            bodyEl.classList.contains('light-theme') ||
            bodyEl.classList.contains('light'))
      );
      let storedThemeMode = null;
      try {
        storedThemeMode = rawGet('theme-mode');
      } catch {}

      let isDark;
      if (IS_SWARM_PLUGIN_FRAME) {
        const docTheme = doc.documentElement.getAttribute('data-theme');
        isDark =
          docTheme === 'dark' ||
          bodyExplicitDark ||
          Boolean(win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches);
      } else {
        isDark = bodyExplicitDark
          ? true
          : bodyExplicitLight || storedThemeMode === 'light'
          ? false
          : storedThemeMode === 'dark'
          ? true
          : doc.documentElement.style.colorScheme === 'dark';
      }

      const targetMode = isDark ? 'dark' : 'light';
      const targetPreset = isDark ? PRESETS.CODEX_DARK : PRESETS.CODEX_PURE_WHITE;
      const prevPreset = doc.documentElement.getAttribute('data-ag-preset');
      const prevMode = doc.documentElement.getAttribute('data-ag-theme-mode');

      if (prevPreset !== targetPreset) {
        doc.documentElement.setAttribute('data-ag-preset', targetPreset);
      }
      if (prevMode !== targetMode || prevPreset !== targetPreset) {
        doc.documentElement.setAttribute('data-ag-theme-mode', targetMode);
        if (IS_SWARM_PLUGIN_FRAME) {
          doc.documentElement.style.colorScheme = targetMode;
        }
        try {
          const cs = win.getComputedStyle ? win.getComputedStyle(doc.body || doc.documentElement) : null;
          const sidebarBg = (cs && cs.getPropertyValue('--sidebar').trim()) || (isDark ? '#232323' : '#F9F9F9');
          const fgColor = (cs && cs.getPropertyValue('--foreground').trim()) || (isDark ? '#FFFFFF' : '#0D0D0D');
          win.electronNative?.setTitleBarOverlay?.({
            color: sidebarBg,
            symbolColor: fgColor
          });
        } catch {}
      }
    } catch {}
  }

  function disconnectThemeObserver() {
    if (themeObserver) {
      try { themeObserver.disconnect(); } catch {}
      themeObserver = null;
    }
  }

  function syncCodexThemeModule() {
    if (!doc) return;
    if (!currentConfig.codexTheme) {
      removeElementById('ag-codex-theme-style');
      if (doc.documentElement) {
        doc.documentElement.removeAttribute('data-ag-preset');
        doc.documentElement.removeAttribute('data-ag-theme-mode');
      }
      disconnectThemeObserver();
      restoreLocalStoragePresetHook();
      return;
    }
    ensureOsAttr();
    ensureStyleTag('ag-codex-theme-style', CODEX_THEME_CSS);
    installLocalStoragePresetHook();
    if (!themeObserver && typeof MutationObserver !== 'undefined') {
      try {
        themeObserver = new MutationObserver(() => {
          if (!disposed && currentConfig.codexTheme) syncThemePreset();
        });
        if (doc.body) themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['class', 'data-agy-theme'] });
        if (doc.documentElement) themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
      } catch {}
    }
    syncThemePreset();
  }

  /* ============================================================================
   * 7. Guards: Deadlock Healer & Zoom Shortcuts (Part 10)
   * ============================================================================ */

  function onGuardSettingsClick(e) {
    if (disposed || !currentConfig.deadlockHealer || !doc) return;
    const btn = e.target && e.target.closest && e.target.closest('[data-testid="settings-button"]');
    if (!btn) return;
    const hasDialog = Boolean(doc.querySelector('[role="dialog"]'));
    const urlHasSettings = String(win.location?.search || '').includes('settingsOpen=true');
    if (!hasDialog && urlHasSettings) {
      try {
        const url = new URL(win.location.href);
        url.searchParams.delete('settingsOpen');
        url.searchParams.delete('settingsScreen');
        win.history.replaceState(win.history.state, '', url.toString());
      } catch {}
    }
  }

  function onGuardZoomKeydown(e) {
    if (disposed || !currentConfig.zoomShortcuts) return;
    if (e.isComposing) return;
    const isMac = detectedOs === 'darwin';
    const modKey = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!modKey || e.altKey) return;
    const native = win.electronNative;
    if (!native) return;

    if (!e.shiftKey && (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
      if (typeof native.zoomOut === 'function') {
        e.preventDefault();
        e.stopPropagation();
        native.zoomOut();
      }
    } else if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
      if (typeof native.zoomIn === 'function') {
        e.preventDefault();
        e.stopPropagation();
        native.zoomIn();
      }
    } else if (!e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
      const resetFn = typeof native.resetZoom === 'function' ? native.resetZoom : native.zoomReset;
      if (typeof resetFn === 'function') {
        e.preventDefault();
        e.stopPropagation();
        resetFn.call(native);
      }
    }
  }

  /* ============================================================================
   * 8. Sidebar Ink Quota Module (Part 55 + Dual Source + Pool Filter)
   * ============================================================================ */

  const FETCH_INTERVAL_MS = 60000;
  const TICK_INTERVAL_MS = 30000;
  const FORCE_COOLDOWN_MS = 30000;
  const FORCE_POLL_INTERVAL_MS = 180000;
  const WAKE_CACHE_COOLDOWN_MS = 10000;
  const CLICK_FORCE_COOLDOWN_MS = 5000;

  let cachedService = null;
  let tappedService = null;
  let tappedOriginal = null;
  let tappedWrapper = null;
  let tappedHadOwnProp = false;
  let internalFetchDepth = 0;
  let fetchInFlight = false;
  let pendingForceRefresh = false;
  let hasDoneInitialForceRefresh = false;
  let lastFetchAt = 0;
  let lastForceFetchAt = 0;
  let lastGroups = null;
  let lastModelLabel = '';
  let fetchTimer = null;
  let tickTimer = null;
  let obsTimer = null;
  let clickCheckTimer = null;
  let quotaObserver = null;

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureQuotaStyleTag() {
    ensureStyleTag('ag-codex-quota-style', QUOTA_CSS);
  }

  function cleanupQuotaDom() {
    if (!doc) return;
    try {
      const el = doc.getElementById('ag-quota');
      if (el) el.remove();
    } catch {}
  }

  function untapCloudCodeService() {
    if (tappedService && tappedOriginal && tappedWrapper) {
      try {
        if (tappedService.retrieveUserQuotaSummary === tappedWrapper) {
          if (tappedHadOwnProp) {
            tappedService.retrieveUserQuotaSummary = tappedOriginal;
          } else {
            delete tappedService.retrieveUserQuotaSummary;
          }
        }
      } catch {}
    }
    tappedService = null;
    tappedOriginal = null;
    tappedWrapper = null;
    tappedHadOwnProp = false;
  }

  function tapCloudCodeService(svc) {
    if (!svc || typeof svc.retrieveUserQuotaSummary !== 'function') return;
    if (svc === tappedService && svc.retrieveUserQuotaSummary === tappedWrapper) return;
    untapCloudCodeService();
    const hadOwnProp = Object.prototype.hasOwnProperty.call(svc, 'retrieveUserQuotaSummary');
    const desc = hadOwnProp ? Object.getOwnPropertyDescriptor(svc, 'retrieveUserQuotaSummary') : null;
    if (desc && (!desc.writable || !desc.configurable)) return;
    if (!hadOwnProp && !Object.isExtensible(svc)) return;
    const orig = svc.retrieveUserQuotaSummary;
    const wrapper = function agCodexQuotaTappedRetrieve(forceRefresh) {
      const p = orig.apply(this, arguments);
      if (!disposed && internalFetchDepth === 0 && p && typeof p.then === 'function') {
        p.then(
          (res) => {
            if (disposed) return;
            const now = Date.now();
            if (forceRefresh === true) {
              lastForceFetchAt = now;
              hasDoneInitialForceRefresh = true;
            }
            applyQuotaResponse(res, now);
          },
          () => {}
        );
      }
      return p;
    };
    try {
      svc.retrieveUserQuotaSummary = wrapper;
      tappedService = svc;
      tappedOriginal = orig;
      tappedWrapper = wrapper;
      tappedHadOwnProp = hadOwnProp;
    } catch {}
  }

  function findCloudCodeService() {
    if (cachedService && typeof cachedService.retrieveUserQuotaSummary === 'function') {
      tapCloudCodeService(cachedService);
      return cachedService;
    }
    if (!doc) return null;
    try {
      const els = doc.querySelectorAll('body *');
      const limit = Math.min(els.length, 300);
      for (let n = 0; n < limit; n++) {
        const el = els[n];
        if (!el) continue;
        const fk = Object.keys(el).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
        );
        if (!fk) continue;
        let f = el[fk];
        for (let i = 0; f && i < 120; i++, f = f.return) {
          const v = f.memoizedProps && f.memoizedProps.value;
          const c = v && v.core;
          const svc = c && c.cloudCodeService;
          if (svc && typeof svc.retrieveUserQuotaSummary === 'function') {
            cachedService = svc;
            tapCloudCodeService(svc);
            return svc;
          }
        }
      }
    } catch {}
    return null;
  }

  function resolveLanguageServerCsrfToken() {
    try {
      const direct = String(win.__APP_CONFIG__?.csrfToken || '').trim();
      if (direct) return direct;
    } catch {}
    try {
      const winToken = String(win.agy_session_csrf_token || '').trim();
      if (winToken) return winToken;
    } catch {}
    try {
      const ls = String(win.localStorage?.getItem?.('agy_session_csrf_token') || '').trim();
      if (ls) return ls;
    } catch {}
    try {
      const scripts = doc?.querySelectorAll?.('script') || [];
      for (let i = 0; i < scripts.length; i++) {
        const txt = String(scripts[i]?.textContent || '');
        if (!txt.includes('__APP_CONFIG__')) continue;
        const m = txt.match(/__APP_CONFIG__\s*=\s*(\{[\s\S]*?\});/);
        if (m) {
          const parsed = JSON.parse(m[1]);
          if (parsed?.csrfToken) return String(parsed.csrfToken).trim();
        }
      }
    } catch {}
    try {
      const entries = win.performance?.getEntriesByType?.('resource') || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const name = String(entries[i]?.name || '');
        if (!name) continue;
        const m = name.match(/[?&](?:csrf|csrf_token|token)=([^&#]+)/i);
        if (m && m[1]) return decodeURIComponent(m[1]).trim();
      }
    } catch {}
    return '';
  }

  function getSelectedModelLabel(scopeEl) {
    if (!doc) return '';
    try {
      const el =
        (scopeEl && scopeEl.querySelector ? scopeEl.querySelector('[data-testid="model-selector-trigger"]') : null) ||
        doc.querySelector('[data-testid="model-selector-trigger"]');
      if (!el) return '';
      const fk = Object.keys(el).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (fk && el[fk]) {
        let f = el[fk];
        for (let i = 0; i < 6 && f; i++, f = f.return) {
          const al = f.memoizedProps && f.memoizedProps['aria-label'];
          if (typeof al === 'string' && /^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:/i.test(al)) {
            const cleaned = cleanModelLabel(al);
            if (cleaned) return cleaned;
          }
        }
      }
      const origAl = el.getAttribute('data-ag-orig-aria-label');
      if (origAl) {
        const cleaned = cleanModelLabel(origAl);
        if (cleaned) return cleaned;
      }
      const curAl = el.getAttribute('aria-label');
      if (curAl) {
        const cleaned = cleanModelLabel(curAl);
        if (cleaned) return cleaned;
      }
      return cleanModelLabel(el.innerText || '');
    } catch {
      return '';
    }
  }

  function onQuotaClick() {
    if (disposed) return;
    void fetchQuota(true, { manual: true });
  }

  function ensureQuotaMount() {
    if (!doc || !currentConfig.quotaSidebar) return null;
    const settingsBtn = doc.querySelector('[data-testid="settings-button"]');
    const parent = settingsBtn && settingsBtn.parentElement;
    if (!settingsBtn || !parent) return null;

    ensureQuotaStyleTag();

    let el = doc.getElementById('ag-quota');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'ag-quota';
      el.className = 'ag-quota';
      el.setAttribute('data-ag-enhancer', 'codex');
      el.setAttribute('data-style', currentConfig.quotaStyle);
    } else if (el.getAttribute('data-ag-enhancer') !== 'codex') {
      el.setAttribute('data-ag-enhancer', 'codex');
    }
    if (!el.__agQuotaClickBound && typeof el.addEventListener === 'function') {
      el.__agQuotaClickBound = true;
      el.addEventListener('click', onQuotaClick);
    }
    if (el.parentElement !== parent || el.nextElementSibling !== settingsBtn) {
      try {
        parent.insertBefore(el, settingsBtn);
      } catch {
        return null;
      }
    }
    return el;
  }

  function wl(label) {
    return '<span class="ag-quota-wl">' + escHtml(label) + '</span>';
  }

  function buildFiveSegBarHtml(pct, level) {
    const segs = computeQuotaSegments(pct);
    let segsHtml = '';
    for (let i = 0; i < segs.length; i++) {
      segsHtml +=
        '<span class="ag-quota-seg"><span class="ag-quota-seg-fill" style="width:' + segs[i] + '%"></span></span>';
    }
    return '<div class="ag-quota-bar" data-level="' + level + '">' + segsHtml + '</div>';
  }

  function buildContinuousBarHtml(pct, level, extraClass = '') {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
      '<div class="ag-quota-cbar' +
      (extraClass ? ' ' + extraClass : '') +
      '" data-level="' +
      level +
      '"><span class="ag-quota-cbar-fill" style="width:' +
      clamped +
      '%"></span></div>'
    );
  }

  function buildDotMatrixHtml(pct, level) {
    const dots = computeQuotaDotLevels(pct, 20);
    let html = '';
    for (let i = 0; i < dots.length; i++) {
      html += '<span class="ag-quota-dot" data-state="' + (dots[i] === 'empty' ? 'empty' : 'full') + '"></span>';
    }
    return '<div class="ag-quota-dots" data-level="' + level + '">' + html + '</div>';
  }

  function buildCompactTicksHtml(pct, level) {
    const segs = computeQuotaSegments(pct);
    let html = '';
    for (let i = 0; i < segs.length; i++) {
      html += '<span class="ag-quota-vtick"><span class="ag-quota-vtick-fill" style="width:' + segs[i] + '%"></span></span>';
    }
    return '<span class="ag-quota-vticks" data-level="' + level + '">' + html + '</span>';
  }

  function buildMiniSegHtml(pct, level) {
    const segs = computeQuotaSegments(pct);
    let html = '';
    for (let i = 0; i < segs.length; i++) {
      html += '<span class="ag-quota-ms"><span style="width:' + segs[i] + '%"></span></span>';
    }
    return '<span class="ag-quota-mseg" data-level="' + level + '">' + html + '</span>';
  }

  function buildRingSvgHtml(pct, level, size = 24) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
      '<svg class="ag-quota-ring-svg" data-level="' +
      level +
      '" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 36 36" aria-hidden="true">' +
      '<circle class="ag-quota-ring-track" cx="18" cy="18" r="14.5"/>' +
      (clamped > 0
        ? '<circle class="ag-quota-ring-arc" cx="18" cy="18" r="14.5" pathLength="100" stroke-dasharray="' +
          clamped +
          ' 100"/>'
        : '') +
      '</svg>'
    );
  }

  function buildGaugeSvgHtml(pct, level) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
      '<svg class="ag-quota-gauge-svg" data-level="' +
      level +
      '" width="48" height="25" viewBox="0 0 48 25" aria-hidden="true">' +
      '<path class="ag-quota-gauge-track" d="M4 23 A20 20 0 0 1 44 23"/>' +
      (clamped > 0
        ? '<path class="ag-quota-gauge-arc" pathLength="100" stroke-dasharray="' +
          clamped +
          ' 100" d="M4 23 A20 20 0 0 1 44 23"/>'
        : '') +
      '</svg>'
    );
  }

  function windowEntries(group) {
    const out = [];
    if (group.fiveHour) out.push({ label: '5h', b: group.fiveHour });
    if (group.weekly) out.push({ label: '7d', b: group.weekly });
    return out;
  }

  function buildActiveHeaderHtml(group, modelLabel, loc, showActiveBadge) {
    const entries = windowEntries(group);
    const minPct = entries.reduce((m, e) => Math.min(m, e.b.pct), 100);
    const modelShort = showActiveBadge ? formatQuotaModelShort(modelLabel) : '';
    const str = LOCALE_DICT[loc] || LOCALE_DICT['zh-TW'];
    return (
      '<div class="ag-quota-hd" data-level="' +
      classifyQuotaLevel(minPct) +
      '">' +
      '<span class="ag-quota-hd-dot"></span>' +
      '<span class="ag-quota-hd-name">' +
      escHtml(group.shortLabel) +
      '</span>' +
      (showActiveBadge ? '<span class="ag-quota-badge">' + escHtml(str.quotaActive) + '</span>' : '') +
      (modelShort ? '<span class="ag-quota-hd-model">' + escHtml(modelShort) + '</span>' : '') +
      '</div>'
    );
  }

  function buildActiveBodyHtml(group, style, loc, nowMs) {
    const entries = windowEntries(group);
    if (style === 'rings' || style === 'gauge') {
      const tiles = entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const t = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          if (style === 'rings') {
            return (
              '<div class="ag-quota-tile" data-level="' +
              lvl +
              '">' +
              buildRingSvgHtml(e.b.pct, lvl, 24) +
              '<div class="ag-quota-tile-tv"><span class="ag-quota-tile-top">' +
              wl(e.label) +
              '<b>' +
              e.b.pct +
              '%</b></span><em>' +
              escHtml(t) +
              '</em></div></div>'
            );
          }
          return (
            '<div class="ag-quota-tile ag-quota-gtile" data-level="' +
            lvl +
            '"><div class="ag-quota-gauge-dial">' +
            buildGaugeSvgHtml(e.b.pct, lvl) +
            '<b class="ag-quota-gauge-pct">' +
            e.b.pct +
            '%</b></div><div class="ag-quota-gmeta">' +
            wl(e.label) +
            '<em>' +
            escHtml(t) +
            '</em></div></div>'
          );
        })
        .join('');
      return '<div class="ag-quota-tiles">' + tiles + '</div>';
    }
    if (style === 'compact') {
      return entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const shortT = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          return (
            '<div class="ag-quota-crow" data-level="' +
            lvl +
            '">' +
            wl(e.label) +
            buildCompactTicksHtml(e.b.pct, lvl) +
            '<b>' +
            e.b.pct +
            '%</b><em>' +
            escHtml(shortT) +
            '</em></div>'
          );
        })
        .join('');
    }
    const viz =
      style === 'bar'
        ? (p, l) => buildContinuousBarHtml(p, l, 'ag-quota-cbar-main')
        : style === 'dots'
        ? buildDotMatrixHtml
        : buildFiveSegBarHtml;
    return entries
      .map((e) => {
        const lvl = classifyQuotaLevel(e.b.pct);
        return (
          '<div class="ag-quota-row" data-level="' +
          lvl +
          '"><div class="ag-quota-head">' +
          wl(e.label) +
          '<b class="ag-quota-pct">' +
          e.b.pct +
          '<small>%</small></b>' +
          '<span class="ag-quota-time">' +
          escHtml(formatQuotaCountdownLabel(e.b, loc, nowMs, false)) +
          '</span></div>' +
          viz(e.b.pct, lvl) +
          '</div>'
        );
      })
      .join('');
  }

  function buildOtherPoolHtml(group, style, loc, nowMs) {
    const entries = windowEntries(group);
    const str = LOCALE_DICT[loc] || LOCALE_DICT['zh-TW'];
    const name = '<span class="ag-quota-o-name">' + escHtml(group.shortLabel) + '</span>';
    const idle = '<em>' + escHtml(str.quotaIdle) + '</em>';
    if (style === 'rings') {
      const items = entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const t = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          return (
            '<div class="ag-quota-o-rcol" data-level="' +
            lvl +
            '"><span class="ag-quota-o-ring">' +
            buildRingSvgHtml(e.b.pct, lvl, 18) +
            '</span><div class="ag-quota-o-rtv"><span class="ag-quota-oi">' +
            wl(e.label) +
            '<b>' +
            e.b.pct +
            '%</b></span><em class="ag-quota-o-time">' +
            escHtml(t) +
            '</em></div></div>'
          );
        })
        .join('');
      return (
        '<div class="ag-quota-o" data-ostyle="rings"><div class="ag-quota-o-hd">' +
        name +
        idle +
        '</div><div class="ag-quota-o-grid">' +
        items +
        '</div></div>'
      );
    }
    if (style === 'text') {
      const items = entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const tFull = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          const tInline =
            loc === 'zh-TW'
              ? tFull.replace(/\s*後重設$/, ' 後')
              : loc === 'zh-CN'
              ? tFull.replace(/\s*后重置$/, ' 后')
              : tFull.replace(/^resets\s+/, '');
          return (
            '<div class="ag-quota-o-tcol" data-level="' +
            lvl +
            '">' +
            wl(e.label) +
            '<b>' +
            e.b.pct +
            '%</b><em class="ag-quota-o-time">' +
            escHtml(tInline) +
            '</em></div>'
          );
        })
        .join('');
      return (
        '<div class="ag-quota-o" data-ostyle="text"><div class="ag-quota-o-hd">' +
        name +
        idle +
        '</div><div class="ag-quota-o-grid">' +
        items +
        '</div></div>'
      );
    }
    if (style === 'segments') {
      const items = entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const g = buildMiniSegHtml(e.b.pct, lvl);
          const t = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          return (
            '<div class="ag-quota-o-col" data-level="' +
            lvl +
            '"><span class="ag-quota-oi">' +
            wl(e.label) +
            g +
            '<b>' +
            e.b.pct +
            '%</b></span><em class="ag-quota-o-time">' +
            escHtml(t) +
            '</em></div>'
          );
        })
        .join('');
      return (
        '<div class="ag-quota-o" data-ostyle="segments"><div class="ag-quota-o-hd">' +
        name +
        idle +
        '</div><div class="ag-quota-o-grid">' +
        items +
        '</div></div>'
      );
    }
    if (style === 'rows') {
      const rows = entries
        .map((e) => {
          const lvl = classifyQuotaLevel(e.b.pct);
          const t = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
          return (
            '<div class="ag-quota-orow" data-level="' +
            lvl +
            '">' +
            wl(e.label) +
            buildContinuousBarHtml(e.b.pct, lvl, 'ag-quota-mb') +
            '<b>' +
            e.b.pct +
            '%</b><em>' +
            escHtml(t) +
            '</em></div>'
          );
        })
        .join('');
      return '<div class="ag-quota-o" data-ostyle="rows"><div class="ag-quota-o-hd">' + name + idle + '</div>' + rows + '</div>';
    }
    const items = entries
      .map((e) => {
        const lvl = classifyQuotaLevel(e.b.pct);
        const t = formatQuotaCountdownLabel(e.b, loc, nowMs, true);
        return (
          '<div class="ag-quota-o-col" data-level="' +
          lvl +
          '"><span class="ag-quota-oi">' +
          wl(e.label) +
          buildContinuousBarHtml(e.b.pct, lvl, 'ag-quota-mb') +
          '<b>' +
          e.b.pct +
          '%</b></span><em class="ag-quota-o-time">' +
          escHtml(t) +
          '</em></div>'
        );
      })
      .join('');
    return (
      '<div class="ag-quota-o" data-ostyle="lines"><div class="ag-quota-o-hd">' +
      name +
      idle +
      '</div><div class="ag-quota-o-grid">' +
      items +
      '</div></div>'
    );
  }

  function buildMainQuotaHtml(filtered, style, oStyle, modelLabel, loc, nowMs) {
    const { displayGroups, activeIdx, isPinned, isPinnedActive } = filtered;
    const activeGroup = displayGroups[activeIdx];
    if (!activeGroup) return '';
    let html = buildActiveHeaderHtml(activeGroup, modelLabel, loc, isPinnedActive);
    html += '<div class="ag-quota-body">' + buildActiveBodyHtml(activeGroup, style, loc, nowMs) + '</div>';
    if (!isPinned && oStyle !== 'hidden') {
      let others = '';
      for (let i = 0; i < displayGroups.length; i++) {
        if (i === activeIdx) continue;
        if (!displayGroups[i].fiveHour && !displayGroups[i].weekly) continue;
        others += buildOtherPoolHtml(displayGroups[i], oStyle, loc, nowMs);
      }
      if (others) html += '<div class="ag-quota-sep"></div>' + others;
    }
    return html;
  }

  function renderQuota() {
    if (disposed || !doc) return;
    if (!currentConfig.quotaSidebar) {
      cleanupQuotaDom();
      return;
    }
    if (!lastGroups || lastGroups.length === 0) {
      cleanupQuotaDom();
      return;
    }
    const nowMs = Date.now();
    const modelLabel = getSelectedModelLabel();
    lastModelLabel = modelLabel;
    const filtered = filterQuotaGroupsForDisplay(lastGroups, modelLabel, currentConfig.quotaPoolFilter);
    if (!filtered.displayGroups.length || filtered.activeIdx < 0) {
      cleanupQuotaDom();
      return;
    }
    const el = ensureQuotaMount();
    if (!el) return;
    const str = getStrings();
    el.setAttribute('data-style', currentConfig.quotaStyle);
    el.setAttribute('data-ostyle', filtered.isPinned ? 'hidden' : currentConfig.quotaOtherStyle);
    el.setAttribute('title', str.quotaClickRefresh);
    const nextHtml = buildMainQuotaHtml(
      filtered,
      currentConfig.quotaStyle,
      currentConfig.quotaOtherStyle,
      modelLabel,
      activeLocale,
      nowMs
    );
    if (el.innerHTML !== nextHtml) {
      el.innerHTML = nextHtml;
    }
  }

  function applyQuotaResponse(res, nowMs = Date.now()) {
    if (disposed) return false;
    const groups = parseQuotaSummary(res);
    lastFetchAt = nowMs;
    if (groups.length > 0) {
      lastGroups = groups;
      renderQuota();
      return true;
    }
    return false;
  }

  async function fetchQuotaViaCsrfFallback() {
    const csrf = resolveLanguageServerCsrfToken();
    const fetchFn = typeof fetch === 'function' ? fetch : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    if (!csrf || !fetchFn) return null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const resp = await fetchFn('/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': csrf
        },
        body: '{}',
        signal: controller ? controller.signal : undefined
      });
      if (!resp || !resp.ok) return null;
      return await resp.json().catch(() => null);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchQuota(force = false, opts = null) {
    if (disposed || (doc && doc.hidden)) return;
    const manual = Boolean(opts && opts.manual);
    const wantForce = Boolean(force);
    const nowBefore = Date.now();
    if (wantForce && !manual && lastForceFetchAt > 0 && nowBefore - lastForceFetchAt < FORCE_COOLDOWN_MS) {
      if (lastGroups && nowBefore - lastFetchAt < WAKE_CACHE_COOLDOWN_MS) return;
      return fetchQuota(false);
    }
    if (wantForce && manual && lastForceFetchAt > 0 && nowBefore - lastForceFetchAt < CLICK_FORCE_COOLDOWN_MS) {
      return;
    }
    if (fetchInFlight) {
      if (wantForce) pendingForceRefresh = true;
      return;
    }

    const svc = findCloudCodeService();
    fetchInFlight = true;
    let shouldFollowUpForce = false;
    let fetchOk = false;

    try {
      let res = null;
      if (svc) {
        internalFetchDepth++;
        let req;
        try {
          req = svc.retrieveUserQuotaSummary(wantForce);
        } finally {
          internalFetchDepth--;
        }
        res = await req;
      } else {
        res = await fetchQuotaViaCsrfFallback();
      }
      if (disposed) return;
      if (res) {
        fetchOk = true;
        const now = Date.now();
        if (wantForce) {
          lastForceFetchAt = now;
          hasDoneInitialForceRefresh = true;
        }
        applyQuotaResponse(res, now);
        if (svc && !wantForce && !hasDoneInitialForceRefresh) {
          hasDoneInitialForceRefresh = true;
          shouldFollowUpForce = true;
        }
      }
    } catch {
      if (svc) {
        cachedService = null;
        untapCloudCodeService();
      }
    } finally {
      fetchInFlight = false;
    }

    if (!disposed && !(doc && doc.hidden)) {
      if (pendingForceRefresh) {
        pendingForceRefresh = false;
        void fetchQuota(true);
      } else if (shouldFollowUpForce && fetchOk) {
        void fetchQuota(true);
      }
    }
  }

  function checkDomAndModel() {
    if (disposed || !doc || doc.hidden || !currentConfig.quotaSidebar) return;
    if (!lastGroups || lastGroups.length === 0) {
      if (!fetchInFlight && Date.now() - lastFetchAt >= 5000) {
        void fetchQuota(false);
      }
      return;
    }
    const settingsBtn = doc.querySelector('[data-testid="settings-button"]');
    const el = doc.getElementById('ag-quota');
    const needsRemount = Boolean(
      settingsBtn &&
        settingsBtn.parentElement &&
        (!el || el.parentElement !== settingsBtn.parentElement || el.nextElementSibling !== settingsBtn)
    );
    const curModel = getSelectedModelLabel();
    if (needsRemount || (curModel && curModel !== lastModelLabel)) {
      renderQuota();
    }
  }

  function scheduleQuotaObsCheck() {
    if (disposed || obsTimer) return;
    obsTimer = setTimeout(() => {
      obsTimer = null;
      checkDomAndModel();
    }, 250);
  }

  function onQuotaWake() {
    if (disposed || (doc && doc.hidden) || !currentConfig.quotaSidebar) return;
    const now = Date.now();
    if (!lastGroups || hasExpiredQuotaBucket(lastGroups, now)) {
      void fetchQuota(true);
    } else if (now - lastForceFetchAt >= FORCE_COOLDOWN_MS) {
      void fetchQuota(true);
    } else if (now - lastFetchAt >= WAKE_CACHE_COOLDOWN_MS) {
      void fetchQuota(false);
    } else {
      renderQuota();
    }
  }

  function onQuotaDocClick() {
    if (disposed) return;
    if (clickCheckTimer) clearTimeout(clickCheckTimer);
    clickCheckTimer = setTimeout(() => {
      clickCheckTimer = null;
      checkDomAndModel();
    }, 120);
  }

  /* ============================================================================
   * 9. Embedded Native Settings Tab (Part 75, adapted for Suite Codex UI)
   * ============================================================================ */

  const SUPPORTS_POPOVER =
    typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');

  let scanTimer = null;
  let saveBadgeTimer = null;
  let savedUntil = 0;
  let activeDlg = null;
  let activeSidebar = null;
  let boundSidebarClick = null;
  let settingsTabOpen = false;
  let settingsScrollTop = 0;
  let settingsObserver = null;

  let activeFontSlot = '';
  let activeFontTrigger = null;
  let cachedDetectedFonts = null;
  let installedHostFonts = null;
  let fetchingHostFonts = false;

  function detectAvailableFonts() {
    if (cachedDetectedFonts) return cachedDetectedFonts;
    const bundled = new Set();
    try {
      if (doc && doc.fonts && typeof doc.fonts[Symbol.iterator] === 'function') {
        for (const f of doc.fonts) {
          if (f && f.family) bundled.add(String(f.family).replace(/^["']|["']$/g, '').trim());
        }
      }
    } catch {}

    let hasFont = (name) => bundled.has(name);
    try {
      const canvas = doc?.createElement ? doc.createElement('canvas') : null;
      const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
      if (ctx) {
        const sample = 'mmmmmmmmmmlli中文測試12345';
        const measure = (font) => {
          ctx.font = '72px ' + font;
          return ctx.measureText(sample).width;
        };
        const baseMono = measure('monospace');
        const baseSans = measure('sans-serif');
        const baseSerif = measure('serif');
        hasFont = (name) => {
          if (bundled.has(name)) return true;
          const q = JSON.stringify(name);
          return (
            measure(q + ',monospace') !== baseMono ||
            measure(q + ',sans-serif') !== baseSans ||
            measure(q + ',serif') !== baseSerif
          );
        };
      }
    } catch {}

    const sansCandidates = [
      'Inter',
      'Google Sans',
      'PingFang TC',
      'PingFang SC',
      'Hiragino Sans GB',
      'Microsoft JhengHei UI',
      'Microsoft YaHei UI',
      'Microsoft YaHei',
      'Segoe UI',
      'LXGW WenKai',
      'LXGW WenKai Screen',
      'HarmonyOS Sans TC',
      'HarmonyOS Sans SC',
      'Noto Sans TC',
      'Noto Sans SC',
      'Noto Sans CJK TC',
      'Noto Sans CJK SC',
      'Source Han Sans TC',
      'Source Han Sans SC',
      'Helvetica Neue',
      'Georgia'
    ];
    const monoCandidates = [
      'Google Sans Code',
      'SF Mono',
      'JetBrains Mono',
      'Fira Code',
      'Maple Mono',
      'Maple Mono NF CN',
      'Cascadia Code',
      'Cascadia Mono',
      'Iosevka',
      'SFMono-Regular',
      'Menlo',
      'Monaco',
      'Consolas',
      'Source Code Pro',
      'IBM Plex Mono',
      'Roboto Mono',
      'Hack',
      'MesloLGS NF',
      'DejaVu Sans Mono'
    ];

    const sans = sansCandidates.filter(hasFont);
    const mono = monoCandidates.filter(hasFont);
    for (const b of bundled) {
      if (/mono|code|consol/i.test(b)) {
        if (!mono.includes(b)) mono.push(b);
      } else if (!sans.includes(b)) {
        sans.push(b);
      }
    }
    cachedDetectedFonts = {
      sans: sans.length > 0 ? sans : ['Inter', 'Google Sans'],
      mono: mono.length > 0 ? mono : ['SF Mono', 'Menlo', 'Consolas']
    };
    return cachedDetectedFonts;
  }

  async function ensureInstalledHostFonts() {
    if (installedHostFonts || fetchingHostFonts) return;
    fetchingHostFonts = true;
    try {
      const res = await callHostBridge('/list-fonts', {}, 'listFonts');
      if (!disposed && res && (Array.isArray(res.sans) || Array.isArray(res.mono) || Array.isArray(res.fonts))) {
        const sans = Array.isArray(res.sans) ? res.sans : (Array.isArray(res.fonts) ? res.fonts : []);
        const mono = Array.isArray(res.mono) ? res.mono : [];
        installedHostFonts = { sans, mono };
      }
    } catch {} finally {
      fetchingHostFonts = false;
    }
  }

  function isPopoverOpen(el) {
    if (!el) return false;
    if (SUPPORTS_POPOVER) {
      try { return el.matches(':popover-open'); } catch { return false; }
    }
    return !el.hidden;
  }

  function positionFontMenuInModal(menu, anchorEl) {
    if (!menu || !anchorEl || !doc) return;
    menu.setAttribute('data-js-pos', '1');
    const ar = anchorEl.getBoundingClientRect();
    const vw = win.innerWidth || 1280;
    const vh = win.innerHeight || 800;
    const boundsEl =
      activeDlg ||
      (anchorEl.closest && anchorEl.closest('.settings-modal-container, [role="dialog"]')) ||
      doc.getElementById('ag-settings-pane');
    const br = boundsEl ? boundsEl.getBoundingClientRect() : { top: 0, bottom: vh, left: 0, right: vw };
    const pad = 10;
    const minTop = Math.max(12, br.top + pad);
    const maxBottom = Math.min(vh - 12, br.bottom - pad);
    const minLeft = Math.max(12, br.left + pad);
    const maxRight = Math.min(vw - 12, br.right - pad);

    menu.style.maxHeight = '';
    const ow = menu.offsetWidth || 228;
    const naturalH = Math.max(44, Math.min(248, (menu.scrollHeight || 180) + 4));
    const spaceBelow = Math.max(0, maxBottom - (ar.bottom + 6));
    const spaceAbove = Math.max(0, ar.top - 6 - minTop);

    const openAbove = spaceBelow < naturalH && spaceAbove > spaceBelow;
    const availH = openAbove ? spaceAbove : spaceBelow;
    const maxH = Math.max(88, Math.min(248, availH));
    menu.style.maxHeight = Math.floor(maxH) + 'px';

    const actualH = Math.min(menu.offsetHeight || naturalH, maxH);
    let top = openAbove ? ar.top - actualH - 6 : ar.bottom + 6;
    if (top + actualH > maxBottom) top = maxBottom - actualH;
    if (top < minTop) top = minTop;

    let left = ar.right - ow;
    if (left + ow > maxRight) left = maxRight - ow;
    if (left < minLeft) left = minLeft;

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function hideFontMenu({ restoreFocus = false, fromPointer = false } = {}) {
    if (!doc) return;
    const menu = doc.getElementById('ag-settings-font-menu');
    if (menu) {
      if (SUPPORTS_POPOVER) {
        try {
          if (menu.matches(':popover-open')) menu.hidePopover();
        } catch {}
      } else {
        menu.hidden = true;
      }
    }
    if (activeFontTrigger) {
      activeFontTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        try {
          activeFontTrigger.focus({ focusVisible: !fromPointer });
        } catch {
          try { activeFontTrigger.focus(); } catch {}
        }
      }
    }
    activeFontSlot = '';
    activeFontTrigger = null;
  }

  function flashSavedBadge() {
    savedUntil = Date.now() + 1800;
    const badge = doc?.getElementById?.('ag-s-hot-badge');
    if (badge) {
      badge.hidden = false;
      if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
      saveBadgeTimer = setTimeout(() => {
        saveBadgeTimer = null;
        const b = doc?.getElementById?.('ag-s-hot-badge');
        if (b) b.hidden = true;
      }, 1800);
    }
  }

  function commitSettingsUpdate(patch) {
    const paneEl = doc?.getElementById?.('ag-settings-pane');
    if (paneEl) settingsScrollTop = paneEl.scrollTop;
    savedUntil = Date.now() + 1800;
    updateConfig(patch, { persist: true, broadcast: true });
    flashSavedBadge();
  }

  function ensureFontMenu() {
    if (!doc || !doc.body) return null;
    let menu = doc.getElementById('ag-settings-font-menu');
    if (menu) return menu;

    menu = doc.createElement('div');
    menu.id = 'ag-settings-font-menu';
    menu.setAttribute('data-ag-enhancer', 'codex');
    menu.setAttribute('data-js-pos', '1');
    if (SUPPORTS_POPOVER) {
      menu.setAttribute('popover', 'auto');
    } else {
      menu.hidden = true;
    }
    menu.innerHTML = '<div class="ag-s-menu-list" role="menu"></div>';
    doc.body.appendChild(menu);

    menu.addEventListener('toggle', (ev) => {
      if (ev.newState !== 'open') {
        if (activeFontTrigger) activeFontTrigger.setAttribute('aria-expanded', 'false');
        activeFontSlot = '';
        activeFontTrigger = null;
      }
    });

    menu.addEventListener('click', (ev) => {
      const row = ev.target && ev.target.closest ? ev.target.closest('[data-pick-font]') : null;
      if (!row || !activeFontSlot) return;
      const slot = activeFontSlot;
      const val = row.getAttribute('data-pick-font') || '';
      hideFontMenu({ restoreFocus: true, fromPointer: ev.detail !== 0 });
      if ((currentConfig.fonts[slot] || '') !== val) {
        commitSettingsUpdate({ fonts: { [slot]: val } });
      }
    });

    return menu;
  }

  function toggleFontMenu(slot, triggerBtn, fromKeyboard) {
    const menu = ensureFontMenu();
    if (!menu) return;
    if (isPopoverOpen(menu) && activeFontSlot === slot) {
      hideFontMenu({ restoreFocus: fromKeyboard, fromPointer: !fromKeyboard });
      return;
    }
    if (activeFontTrigger && activeFontTrigger !== triggerBtn) {
      activeFontTrigger.setAttribute('aria-expanded', 'false');
    }
    activeFontSlot = slot;
    activeFontTrigger = triggerBtn;

    const s = getStrings();
    const curVal = (currentConfig.fonts && currentConfig.fonts[slot]) || '';
    const detected = detectAvailableFonts();
    const scanned = installedHostFonts || { sans: [], mono: [] };
    const isMono = slot === 'code';
    const items = [{ value: '', label: s.fontDefault, preview: '' }];
    const seen = new Set(['']);

    const mergedList = (isMono ? detected.mono : detected.sans).concat(
      isMono ? scanned.mono || [] : scanned.sans || []
    );
    for (let i = 0; i < mergedList.length; i++) {
      const name = mergedList[i];
      if (!name) continue;
      const key = String(name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ value: name, label: name, preview: name });
    }
    if (curVal && !seen.has(curVal.toLowerCase())) {
      items.splice(1, 0, { value: curVal, label: curVal, preview: curVal });
    }

    const listEl = menu.querySelector('.ag-s-menu-list');
    if (listEl) {
      listEl.innerHTML = items
        .map((it) => {
          const isSel = curVal.toLowerCase() === it.value.toLowerCase();
          const prevStack = it.preview ? buildFontStack(it.preview, isMono ? 'mono' : 'sans') : '';
          return (
            '<button type="button" class="ag-s-menu-row" role="menuitemradio" aria-checked="' +
            (isSel ? 'true' : 'false') +
            '" data-selected="' +
            (isSel ? 'true' : 'false') +
            '" data-pick-font="' +
            escHtml(it.value) +
            '">' +
            '<span class="ag-s-menu-row-name"' +
            (prevStack ? ' style="font-family:' + escHtml(prevStack) + ' !important"' : '') +
            '>' +
            escHtml(it.label) +
            '</span>' +
            '<span class="ag-s-menu-row-right" aria-hidden="true">' +
            (isSel
              ? '<svg class="ag-s-menu-row-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'
              : '') +
            '</span>' +
            '</button>'
          );
        })
        .join('');
    }

    if (SUPPORTS_POPOVER) {
      try { menu.showPopover(); } catch {}
    } else {
      menu.hidden = false;
    }
    positionFontMenuInModal(menu, triggerBtn);
    triggerBtn.setAttribute('aria-expanded', 'true');

    if (fromKeyboard && listEl) {
      const target = listEl.querySelector('button[aria-checked="true"]') || listEl.querySelector('button');
      if (target) target.focus();
    }
  }

  function openFullSuiteSettings() {
    try {
      const closeBtn =
        (activeDlg && activeDlg.querySelector('[data-testid="settings-close-button"], [aria-label="Close"], [aria-label="關閉"], [aria-label="关闭"]')) ||
        doc?.querySelector?.('[role="dialog"] [data-testid="settings-close-button"], [role="dialog"] [aria-label="Close"], [role="dialog"] [aria-label="關閉"], [role="dialog"] [aria-label="关闭"]');
      if (closeBtn && typeof closeBtn.click === 'function') {
        closeBtn.click();
      } else if (doc) {
        const escEv = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true });
        (activeDlg || doc).dispatchEvent(escEv);
      }
    } catch {}

    setTimeout(() => {
      try {
        if (typeof win.__AGContextMeter?.openSettings === 'function') {
          win.__AGContextMeter.openSettings('appearance');
          return;
        }
      } catch {}
      try {
        const host = doc?.getElementById?.('ag-context-meter');
        const btn = host?.shadowRoot?.getElementById?.('badge-settings');
        if (btn && typeof btn.click === 'function') btn.click();
      } catch {}
    }, 60);
  }

  function renderPane() {
    if (disposed || !doc) return;
    const s = getStrings();
    const navBtn = doc.getElementById('ag-settings-nav-btn');
    if (navBtn) {
      const lbl = navBtn.querySelector('.ag-s-nav-label');
      if (lbl) lbl.textContent = s.navTitle;
    }

    const pane = doc.getElementById('ag-settings-pane');
    if (!pane) return;

    const cfg = currentConfig;
    const curQuotaStyle = cfg.quotaStyle;
    const curQuotaOther = cfg.quotaOtherStyle;
    const quotaSidebarOn = cfg.quotaSidebar !== false;
    const isPinnedPool = cfg.quotaPoolFilter !== 'all';
    const savedActive = Boolean(savedUntil && Date.now() < savedUntil);
    const prevScroll = pane.scrollTop || settingsScrollTop || 0;

    const quotaStyleCardsHtml = [
      {
        id: 'segments',
        label: s.qStyleSegments,
        svg:
          '<svg width="42" height="16" viewBox="0 0 42 16" fill="none" aria-hidden="true">' +
          '<rect x="1" y="3" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="9.3" y="3" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="17.6" y="3" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="25.9" y="3" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="34.2" y="3" width="6.5" height="2.6" rx="1.3" fill="currentColor" opacity="0.22"/>' +
          '<rect x="1" y="10" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="9.3" y="10" width="6.5" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="17.6" y="10" width="6.5" height="2.6" rx="1.3" fill="currentColor" opacity="0.22"/>' +
          '<rect x="25.9" y="10" width="6.5" height="2.6" rx="1.3" fill="currentColor" opacity="0.22"/>' +
          '<rect x="34.2" y="10" width="6.5" height="2.6" rx="1.3" fill="currentColor" opacity="0.22"/>' +
          '</svg>'
      },
      {
        id: 'bar',
        label: s.qStyleBar,
        svg:
          '<svg width="42" height="16" viewBox="0 0 42 16" fill="none" aria-hidden="true">' +
          '<rect x="1" y="3" width="40" height="2.6" rx="1.3" fill="currentColor" opacity="0.2"/>' +
          '<rect x="1" y="3" width="32" height="2.6" rx="1.3" fill="currentColor"/>' +
          '<rect x="1" y="10" width="40" height="2.6" rx="1.3" fill="currentColor" opacity="0.2"/>' +
          '<rect x="1" y="10" width="18" height="2.6" rx="1.3" fill="currentColor"/>' +
          '</svg>'
      },
      {
        id: 'rings',
        label: s.qStyleRings,
        svg:
          '<svg width="42" height="18" viewBox="0 0 42 18" fill="none" aria-hidden="true">' +
          '<circle cx="12" cy="9" r="6" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.2"/>' +
          '<circle cx="12" cy="9" r="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="29 38" transform="rotate(-90 12 9)"/>' +
          '<circle cx="30" cy="9" r="6" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.2"/>' +
          '<circle cx="30" cy="9" r="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="18 38" transform="rotate(-90 30 9)"/>' +
          '</svg>'
      },
      {
        id: 'gauge',
        label: s.qStyleGauge,
        svg:
          '<svg width="42" height="18" viewBox="0 0 42 18" fill="none" aria-hidden="true">' +
          '<path d="M3 14 A7.5 7.5 0 0 1 18 14" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.3" stroke-linecap="round"/>' +
          '<path d="M3 14 A7.5 7.5 0 0 1 18 14" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-dasharray="19 24"/>' +
          '<path d="M24 14 A7.5 7.5 0 0 1 39 14" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.3" stroke-linecap="round"/>' +
          '<path d="M24 14 A7.5 7.5 0 0 1 39 14" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-dasharray="11 24"/>' +
          '</svg>'
      },
      {
        id: 'dots',
        label: s.qStyleDots,
        svg:
          '<svg width="42" height="16" viewBox="0 0 42 16" fill="none" aria-hidden="true">' +
          '<circle cx="4" cy="4.5" r="2" fill="currentColor"/><circle cx="11" cy="4.5" r="2" fill="currentColor"/><circle cx="18" cy="4.5" r="2" fill="currentColor"/><circle cx="25" cy="4.5" r="2" fill="currentColor"/><circle cx="32" cy="4.5" r="2" fill="currentColor" opacity="0.45"/><circle cx="39" cy="4.5" r="2" fill="currentColor" opacity="0.2"/>' +
          '<circle cx="4" cy="11.5" r="2" fill="currentColor"/><circle cx="11" cy="11.5" r="2" fill="currentColor"/><circle cx="18" cy="11.5" r="2" fill="currentColor"/><circle cx="25" cy="11.5" r="2" fill="currentColor" opacity="0.2"/><circle cx="32" cy="11.5" r="2" fill="currentColor" opacity="0.2"/><circle cx="39" cy="11.5" r="2" fill="currentColor" opacity="0.2"/>' +
          '</svg>'
      },
      {
        id: 'compact',
        label: s.qStyleCompact,
        svg:
          '<svg width="42" height="16" viewBox="0 0 42 16" fill="none" aria-hidden="true">' +
          '<rect x="2" y="4" width="2.4" height="8" rx="0.8" fill="currentColor"/>' +
          '<rect x="5.8" y="4" width="2.4" height="8" rx="0.8" fill="currentColor"/>' +
          '<rect x="9.6" y="4" width="2.4" height="8" rx="0.8" fill="currentColor"/>' +
          '<rect x="13.4" y="4" width="2.4" height="8" rx="0.8" fill="currentColor" opacity="0.22"/>' +
          '<rect x="20.5" y="3.5" width="1" height="9" fill="currentColor" opacity="0.22"/>' +
          '<rect x="26" y="4" width="2.4" height="8" rx="0.8" fill="currentColor"/>' +
          '<rect x="29.8" y="4" width="2.4" height="8" rx="0.8" fill="currentColor"/>' +
          '<rect x="33.6" y="4" width="2.4" height="8" rx="0.8" fill="currentColor" opacity="0.22"/>' +
          '<rect x="37.4" y="4" width="2.4" height="8" rx="0.8" fill="currentColor" opacity="0.22"/>' +
          '</svg>'
      }
    ]
      .map(
        (opt) =>
          '<button type="button" class="ag-s-qstyle-card" data-quota-style="' +
          opt.id +
          '" aria-pressed="' +
          (curQuotaStyle === opt.id ? 'true' : 'false') +
          '">' +
          '<span class="ag-s-qstyle-prev">' +
          opt.svg +
          '</span><span>' +
          escHtml(opt.label) +
          '</span></button>'
      )
      .join('');

    const qWl = (x, t) =>
      '<rect x="' + x + '" y="' + (t - 3.5) + '" width="9" height="7" rx="1.6" fill="currentColor" opacity="0.18"/>';
    const quotaOtherCardsHtml = [
      {
        id: 'lines',
        label: s.qOtherLines,
        svg:
          '<svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden="true">' + qWl(1, 8) +
          '<rect x="12" y="7.2" width="9" height="1.6" rx="0.8" fill="currentColor"/>' + qWl(24, 8) +
          '<rect x="35" y="7.2" width="8" height="1.6" rx="0.8" fill="currentColor" opacity="0.2"/>' +
          '<rect x="35" y="7.2" width="5" height="1.6" rx="0.8" fill="currentColor"/></svg>'
      },
      {
        id: 'text',
        label: s.qOtherText,
        svg:
          '<svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden="true">' + qWl(1, 8) +
          '<rect x="12" y="6" width="9" height="4" rx="1" fill="currentColor"/>' + qWl(24, 8) +
          '<rect x="35" y="6" width="8" height="4" rx="1" fill="currentColor"/></svg>'
      },
      {
        id: 'segments',
        label: s.qOtherSegments,
        svg:
          '<svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden="true">' + qWl(1, 8) +
          [12, 15, 18].map((x) => '<rect x="' + x + '" y="5.5" width="2.2" height="5" rx="0.6" fill="currentColor"/>').join('') +
          qWl(24, 8) +
          [35, 38].map((x) => '<rect x="' + x + '" y="5.5" width="2.2" height="5" rx="0.6" fill="currentColor"/>').join('') +
          '<rect x="41" y="5.5" width="2.2" height="5" rx="0.6" fill="currentColor" opacity="0.2"/></svg>'
      },
      {
        id: 'rings',
        label: s.qOtherRings,
        svg:
          '<svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden="true">' +
          '<circle cx="7" cy="8" r="4.5" stroke="currentColor" stroke-width="1.8"/>' + qWl(13, 8) +
          '<circle cx="29" cy="8" r="4.5" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.8"/>' +
          '<circle cx="29" cy="8" r="4.5" stroke="currentColor" stroke-width="1.8" stroke-dasharray="20 29" transform="rotate(-90 29 8)"/>' +
          qWl(35, 8) + '</svg>'
      },
      {
        id: 'rows',
        label: s.qOtherRows,
        svg:
          '<svg width="44" height="18" viewBox="0 0 44 18" fill="none" aria-hidden="true">' + qWl(1, 5) +
          '<rect x="13" y="4.2" width="30" height="1.6" rx="0.8" fill="currentColor"/>' + qWl(1, 13) +
          '<rect x="13" y="12.2" width="30" height="1.6" rx="0.8" fill="currentColor" opacity="0.2"/>' +
          '<rect x="13" y="12.2" width="22" height="1.6" rx="0.8" fill="currentColor"/></svg>'
      },
      {
        id: 'hidden',
        label: s.qOtherHidden,
        svg:
          '<svg width="44" height="16" viewBox="0 0 44 16" fill="none" aria-hidden="true">' +
          '<rect x="6" y="5" width="32" height="6" rx="3" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="2.5 2.5"/>' +
          '<path d="M18 13 L26 3" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.4" stroke-linecap="round"/></svg>'
      }
    ]
      .map(
        (opt) =>
          '<button type="button" class="ag-s-qstyle-card" data-quota-other-style="' +
          opt.id +
          '" aria-pressed="' +
          (curQuotaOther === opt.id ? 'true' : 'false') +
          '">' +
          '<span class="ag-s-qstyle-prev">' +
          opt.svg +
          '</span><span>' +
          escHtml(opt.label) +
          '</span></button>'
      )
      .join('');

    const f = normalizeFontsConfig(cfg.fonts);
    const isSplit = f.mode === 'split';
    const hasCustomFont = Boolean(f.global || f.ui || f.chat || f.code);
    const mkFontRow = (slot, lbl, desc) => {
      const cur = f[slot] || '';
      const display = cur || s.fontDefault;
      return (
        '<div class="ag-s-row"><div class="ag-s-row-main">' +
        '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
        escHtml(lbl) +
        '</div><div class="ag-s-row-desc">' +
        escHtml(desc) +
        '</div></div>' +
        '<button type="button" class="ag-s-pill-trigger ag-s-font-trigger" data-font-trigger="' +
        slot +
        '" aria-haspopup="menu" aria-expanded="false">' +
        '<span class="ag-s-font-trigger-name">' +
        escHtml(display) +
        '</span>' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.6;flex-shrink:0"><path d="M4 6l4 4 4-4"/></svg>' +
        '</button>' +
        '</div></div>'
      );
    };

    const zoomLabel = detectedOs === 'darwin' ? s.zoomShortcutsLblMac : s.zoomShortcutsLblOther;

    pane.innerHTML =
      '<div class="ag-s-header">' +
      '<div class="ag-s-title-row">' +
      '<div class="ag-s-title-left">' +
      '<h2 class="ag-s-title">' +
      escHtml(s.pageTitle) +
      '</h2>' +
      '<span id="ag-s-hot-badge" class="ag-s-hot-badge"' +
      (savedActive ? '' : ' hidden') +
      '>' +
      escHtml(s.savedBadge) +
      '</span>' +
      '</div>' +
      '<button type="button" id="ag-s-open-suite" class="ag-s-hdr-link">' +
      '<span>' +
      escHtml(s.openFullSettings) +
      '</span>' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7v7M13 3L6 10"/></svg>' +
      '</button>' +
      '</div>' +
      '<p class="ag-s-subtitle">' +
      escHtml(s.subtitle) +
      '</p>' +
      '</div>' +
      '<div class="ag-s-sections">' +
      // Section 1: Sidebar Quota
      '<div>' +
      '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
      escHtml(s.secQuota) +
      '</span></div>' +
      '<div class="ag-s-card">' +
      '<div class="ag-s-row">' +
      '<div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-quota-sidebar">' +
      escHtml(s.quotaSidebarLbl) +
      '</label><div class="ag-s-row-desc">' +
      escHtml(s.quotaSidebarDesc) +
      '</div></div>' +
      '<input id="ag-s-sw-quota-sidebar" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-cfg="quotaSidebar" aria-label="' +
      escHtml(s.quotaSidebarLbl) +
      '" ' +
      (quotaSidebarOn ? 'checked' : '') +
      ' />' +
      '</div>' +
      '<div class="ag-s-subrow"' +
      (quotaSidebarOn ? '' : ' hidden') +
      '>' +
      '<div><div class="ag-s-sub-label">' +
      escHtml(s.quotaPoolFilterLbl) +
      '</div><div class="ag-s-sub-desc">' +
      escHtml(s.quotaPoolFilterDesc) +
      '</div></div>' +
      '<div class="ag-s-seg" role="group" aria-label="' +
      escHtml(s.quotaPoolFilterLbl) +
      '">' +
      '<button type="button" class="ag-s-seg-btn" data-pool-filter="all" aria-pressed="' +
      (cfg.quotaPoolFilter === 'all' ? 'true' : 'false') +
      '">' +
      escHtml(s.poolAll) +
      '</button>' +
      '<button type="button" class="ag-s-seg-btn" data-pool-filter="gemini-only" aria-pressed="' +
      (cfg.quotaPoolFilter === 'gemini-only' ? 'true' : 'false') +
      '">' +
      escHtml(s.poolGemini) +
      '</button>' +
      '<button type="button" class="ag-s-seg-btn" data-pool-filter="claude-only" aria-pressed="' +
      (cfg.quotaPoolFilter === 'claude-only' ? 'true' : 'false') +
      '">' +
      escHtml(s.poolClaude) +
      '</button>' +
      '</div>' +
      '</div>' +
      '<div class="ag-s-subrow ag-s-qstyle-subrow"' +
      (quotaSidebarOn ? '' : ' hidden') +
      '>' +
      '<div class="ag-s-qstyle-hdr"><span class="ag-s-sub-label">' +
      escHtml(s.quotaStyleLbl) +
      '</span><span class="ag-s-qstyle-hint">' +
      escHtml(s.quotaStyleHint) +
      '</span></div>' +
      '<div class="ag-s-qstyle-grid" role="group" aria-label="' +
      escHtml(s.quotaStyleLbl) +
      '">' +
      quotaStyleCardsHtml +
      '</div>' +
      '<div class="' +
      (isPinnedPool ? 'ag-s-qstyle-block-disabled' : '') +
      '" style="display:flex;flex-direction:column;gap:8px;margin-top:6px">' +
      '<div class="ag-s-qstyle-hdr"><span class="ag-s-sub-label">' +
      escHtml(s.quotaOtherLbl) +
      '</span><span class="ag-s-qstyle-hint">' +
      escHtml(s.quotaOtherHint) +
      '</span></div>' +
      '<div class="ag-s-qstyle-grid" role="group" aria-label="' +
      escHtml(s.quotaOtherLbl) +
      '">' +
      quotaOtherCardsHtml +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      // Section 2: Appearance & Guards
      '<div>' +
      '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
      escHtml(s.secSuite) +
      '</span></div>' +
      '<div class="ag-s-card">' +
      '<div class="ag-s-row"><div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-topbar-quota">' +
      escHtml(s.topbarQuotaLbl) +
      '</label><div class="ag-s-row-desc">' +
      escHtml(s.topbarQuotaDesc) +
      '</div></div>' +
      '<input id="ag-s-sw-topbar-quota" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-flag="showTopbarQuota" aria-label="' +
      escHtml(s.topbarQuotaLbl) +
      '" ' +
      (currentShowTopbarQuota ? 'checked' : '') +
      ' />' +
      '</div></div>' +
      '<div class="ag-s-row"><div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-codex-theme">' +
      escHtml(s.codexThemeLbl) +
      '</label><div class="ag-s-row-desc">' +
      escHtml(s.codexThemeDesc) +
      '</div></div>' +
      '<input id="ag-s-sw-codex-theme" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-cfg="codexTheme" aria-label="' +
      escHtml(s.codexThemeLbl) +
      '" ' +
      (cfg.codexTheme ? 'checked' : '') +
      ' />' +
      '</div></div>' +
      '<div class="ag-s-row"><div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-deadlock">' +
      escHtml(s.deadlockHealerLbl) +
      '</label><div class="ag-s-row-desc">' +
      escHtml(s.deadlockHealerDesc) +
      '</div></div>' +
      '<input id="ag-s-sw-deadlock" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-cfg="deadlockHealer" aria-label="' +
      escHtml(s.deadlockHealerLbl) +
      '" ' +
      (cfg.deadlockHealer !== false ? 'checked' : '') +
      ' />' +
      '</div></div>' +
      '<div class="ag-s-row"><div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-zoom">' +
      escHtml(zoomLabel) +
      '</label><div class="ag-s-row-desc">' +
      escHtml(s.zoomShortcutsDesc) +
      '</div></div>' +
      '<input id="ag-s-sw-zoom" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-cfg="zoomShortcuts" aria-label="' +
      escHtml(zoomLabel) +
      '" ' +
      (cfg.zoomShortcuts !== false ? 'checked' : '') +
      ' />' +
      '</div></div>' +
      '</div>' +
      '</div>' +
      // Section 3: Custom Fonts
      '<div>' +
      '<div class="ag-s-section-head">' +
      '<span class="ag-s-section-title">' +
      escHtml(s.secFonts) +
      '</span>' +
      (hasCustomFont
        ? '<button type="button" id="ag-s-fonts-reset" class="ag-s-link-btn">' + escHtml(s.fontsResetBtn) + '</button>'
        : '') +
      '</div>' +
      '<div class="ag-s-card">' +
      '<div class="ag-s-row"><div class="ag-s-row-main">' +
      '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
      escHtml(s.fontsModeLbl) +
      '</div><div class="ag-s-row-desc">' +
      escHtml(s.fontsModeDesc) +
      '</div></div>' +
      '<div class="ag-s-seg" role="group" aria-label="' +
      escHtml(s.fontsModeLbl) +
      '">' +
      '<button type="button" class="ag-s-seg-btn" data-font-mode="global" aria-pressed="' +
      (!isSplit ? 'true' : 'false') +
      '">' +
      escHtml(s.fontsModeGlobal) +
      '</button>' +
      '<button type="button" class="ag-s-seg-btn" data-font-mode="split" aria-pressed="' +
      (isSplit ? 'true' : 'false') +
      '">' +
      escHtml(s.fontsModeSplit) +
      '</button>' +
      '</div>' +
      '</div></div>' +
      (isSplit
        ? mkFontRow('ui', s.fontUiLbl, s.fontUiDesc) +
          mkFontRow('chat', s.fontChatLbl, s.fontChatDesc) +
          mkFontRow('code', s.fontCodeLbl, s.fontCodeDesc)
        : mkFontRow('global', s.fontGlobalLbl, s.fontGlobalDesc)) +
      '</div>' +
      '</div>' +
      '</div>';

    if (prevScroll > 0) pane.scrollTop = prevScroll;

    if (savedActive) {
      if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
      const remain = Math.max(100, savedUntil - Date.now());
      saveBadgeTimer = setTimeout(() => {
        saveBadgeTimer = null;
        const b = doc?.getElementById?.('ag-s-hot-badge');
        if (b) b.hidden = true;
      }, remain);
    }
  }

  function setCodexTabOpen(open) {
    settingsTabOpen = Boolean(open);
    if (activeDlg) {
      if (open) {
        activeDlg.setAttribute('data-ag-codex-settings-open', '1');
      } else {
        activeDlg.removeAttribute('data-ag-codex-settings-open');
      }
    }
    if (open) {
      void ensureInstalledHostFonts();
      renderPane();
    } else {
      hideFontMenu({ restoreFocus: false });
    }
  }

  function bindPaneEvents(pane) {
    pane.addEventListener(
      'scroll',
      () => {
        if (activeFontSlot) hideFontMenu({ restoreFocus: false });
      },
      { passive: true }
    );

    pane.addEventListener('change', (ev) => {
      const swCfg = ev.target && ev.target.closest ? ev.target.closest('input.ag-s-switch[data-bind-cfg]') : null;
      if (swCfg) {
        const key = swCfg.getAttribute('data-bind-cfg');
        if (key) commitSettingsUpdate({ [key]: Boolean(swCfg.checked) });
        return;
      }
      const swFlag = ev.target && ev.target.closest ? ev.target.closest('input.ag-s-switch[data-bind-flag]') : null;
      if (swFlag) {
        const key = swFlag.getAttribute('data-bind-flag');
        if (key === 'showTopbarQuota') {
          toggleTopbarQuotaFlag(Boolean(swFlag.checked));
          flashSavedBadge();
        }
      }
    });

    pane.addEventListener('click', (ev) => {
      if (ev.target && ev.target.closest && ev.target.closest('#ag-s-open-suite')) {
        ev.preventDefault();
        ev.stopPropagation();
        openFullSuiteSettings();
        return;
      }

      const poolBtn = ev.target && ev.target.closest ? ev.target.closest('[data-pool-filter]') : null;
      if (poolBtn) {
        const val = poolBtn.getAttribute('data-pool-filter');
        if (val && currentConfig.quotaPoolFilter !== val) {
          commitSettingsUpdate({ quotaPoolFilter: val });
        }
        return;
      }

      const qoCard = ev.target && ev.target.closest ? ev.target.closest('[data-quota-other-style]') : null;
      if (qoCard) {
        const val = qoCard.getAttribute('data-quota-other-style');
        if (val && currentConfig.quotaOtherStyle !== val) {
          commitSettingsUpdate({ quotaOtherStyle: val });
        }
        return;
      }

      const qCard = ev.target && ev.target.closest ? ev.target.closest('[data-quota-style]') : null;
      if (qCard) {
        const val = qCard.getAttribute('data-quota-style');
        if (val && currentConfig.quotaStyle !== val) {
          commitSettingsUpdate({ quotaStyle: val });
        }
        return;
      }

      const fMode = ev.target && ev.target.closest ? ev.target.closest('[data-font-mode]') : null;
      if (fMode) {
        const mode = fMode.getAttribute('data-font-mode');
        if ((mode === 'global' || mode === 'split') && currentConfig.fonts.mode !== mode) {
          hideFontMenu({ restoreFocus: false });
          commitSettingsUpdate({ fonts: { mode } });
        }
        return;
      }

      const fTrig = ev.target && ev.target.closest ? ev.target.closest('[data-font-trigger]') : null;
      if (fTrig) {
        ev.preventDefault();
        ev.stopPropagation();
        const slot = fTrig.getAttribute('data-font-trigger');
        if (slot) toggleFontMenu(slot, fTrig, ev.detail === 0);
        return;
      }

      if (ev.target && ev.target.closest && ev.target.closest('#ag-s-fonts-reset')) {
        hideFontMenu({ restoreFocus: false });
        commitSettingsUpdate({ fonts: { global: '', ui: '', chat: '', code: '' } });
      }
    });

    pane.addEventListener('keydown', (ev) => {
      const fTrig = ev.target && ev.target.closest ? ev.target.closest('[data-font-trigger]') : null;
      if (fTrig && ev.key === 'ArrowDown') {
        ev.preventDefault();
        ev.stopPropagation();
        const slot = fTrig.getAttribute('data-font-trigger');
        if (slot) toggleFontMenu(slot, fTrig, true);
      }
    });
  }

  function tryMountInSettingsModal() {
    if (disposed || !doc) return;
    const sidebar = doc.querySelector('[data-testid="settings-sidebar"]');
    const dlg = sidebar ? sidebar.closest('.settings-modal-container') || sidebar.closest('[role="dialog"]') : null;

    if (!dlg || !sidebar) {
      if (activeDlg) {
        activeDlg = null;
        if (activeSidebar && boundSidebarClick) {
          try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
        }
        activeSidebar = null;
        boundSidebarClick = null;
        settingsTabOpen = false;
        settingsScrollTop = 0;
        hideFontMenu({ restoreFocus: false });
      }
      return;
    }

    ensureStyleTag('ag-codex-settings-style', SETTINGS_CSS);

    const listRoot = sidebar.firstElementChild;
    const firstNavGroup =
      listRoot &&
      (Array.from(listRoot.children).find((el) => el.querySelector && el.querySelector('[data-testid^="settings-nav-item-"]')) ||
        listRoot.children[1]);
    const splitRow = sidebar.closest('.relative.flex.w-full.h-full') || dlg.querySelector('.relative.flex.w-full.h-full');
    const rightPane = splitRow && splitRow.children && splitRow.children[1];
    if (!firstNavGroup || !rightPane) return;

    let justMounted = activeDlg !== dlg;
    activeDlg = dlg;
    rightPane.setAttribute('data-ag-settings-right-pane', '1');

    if (activeSidebar !== sidebar) {
      if (activeSidebar && boundSidebarClick) {
        try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
      }
      activeSidebar = sidebar;
      boundSidebarClick = (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (btn && btn.id !== 'ag-settings-nav-btn' && settingsTabOpen) {
          setCodexTabOpen(false);
        }
      };
      sidebar.addEventListener('click', boundSidebarClick, true);
    }

    let divider = doc.getElementById('ag-settings-nav-divider');
    if (!divider) {
      divider = doc.createElement('div');
      divider.id = 'ag-settings-nav-divider';
      divider.setAttribute('data-ag-enhancer', 'codex');
    } else if (divider.getAttribute('data-ag-enhancer') !== 'codex') {
      divider.setAttribute('data-ag-enhancer', 'codex');
    }
    if (divider.parentElement !== firstNavGroup) {
      firstNavGroup.appendChild(divider);
      justMounted = true;
    }

    let navWrap = doc.getElementById('ag-settings-nav-wrap');
    if (!navWrap) {
      navWrap = doc.createElement('div');
      navWrap.id = 'ag-settings-nav-wrap';
      navWrap.className = 'relative group/nav-item';
      navWrap.setAttribute('data-ag-enhancer', 'codex');
      const btn = doc.createElement('button');
      btn.id = 'ag-settings-nav-btn';
      btn.type = 'button';
      btn.setAttribute('data-testid', 'settings-nav-item-CodexTheme');
      btn.innerHTML =
        '<span class="ag-s-nav-left">' +
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;flex-shrink:0" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="5.5"></circle>' +
        '<path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" fill="currentColor" stroke="none"></path>' +
        '</svg>' +
        '<span class="ag-s-nav-label"></span>' +
        '</span>';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setCodexTabOpen(true);
      });
      navWrap.appendChild(btn);
      justMounted = true;
    } else if (navWrap.getAttribute('data-ag-enhancer') !== 'codex') {
      navWrap.setAttribute('data-ag-enhancer', 'codex');
    }
    if (navWrap.parentElement !== firstNavGroup) {
      firstNavGroup.appendChild(navWrap);
      justMounted = true;
    }

    let pane = doc.getElementById('ag-settings-pane');
    if (!pane) {
      pane = doc.createElement('div');
      pane.id = 'ag-settings-pane';
      pane.setAttribute('data-ag-enhancer', 'codex');
      bindPaneEvents(pane);
      justMounted = true;
    } else if (pane.getAttribute('data-ag-enhancer') !== 'codex') {
      pane.setAttribute('data-ag-enhancer', 'codex');
    }
    if (pane.parentElement !== rightPane) {
      rightPane.appendChild(pane);
      justMounted = true;
    }

    if (justMounted) {
      renderPane();
      if (settingsTabOpen) {
        activeDlg.setAttribute('data-ag-codex-settings-open', '1');
      }
    }
  }

  function scheduleSettingsScan(delayMs) {
    if (disposed || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      tryMountInSettingsModal();
    }, delayMs);
  }

  function onSettingsDocClick(ev) {
    if (disposed || !doc) return;
    if (!SUPPORTS_POPOVER) {
      const fontMenu = doc.getElementById('ag-settings-font-menu');
      if (
        fontMenu &&
        !fontMenu.hidden &&
        ev.target &&
        ev.target.closest &&
        !ev.target.closest('#ag-settings-font-menu') &&
        !ev.target.closest('[data-font-trigger]')
      ) {
        hideFontMenu({ restoreFocus: false });
      }
    }
    if (ev.target && ev.target.closest && ev.target.closest('[data-testid="settings-button"]')) {
      scheduleSettingsScan(40);
      setTimeout(() => { if (!disposed) tryMountInSettingsModal(); }, 160);
    }
  }

  /* ============================================================================
   * 10. Lifecycle Boot & Dispose
   * ============================================================================ */

  function cleanupSettingsDom() {
    if (!doc) return;
    try {
      for (const id of [
        'ag-settings-nav-divider',
        'ag-settings-nav-wrap',
        'ag-settings-pane',
        'ag-settings-font-menu',
        'ag-codex-settings-style'
      ]) {
        const el = doc.getElementById(id);
        if (el) el.remove();
      }
      doc.querySelectorAll('[data-ag-codex-settings-open]').forEach((el) => {
        el.removeAttribute('data-ag-codex-settings-open');
      });
      doc.querySelectorAll('[data-ag-settings-right-pane]').forEach((el) => {
        el.removeAttribute('data-ag-settings-right-pane');
      });
    } catch {}
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    untapCloudCodeService();
    restoreLocalStoragePresetHook();
    disconnectThemeObserver();

    if (fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (obsTimer) { clearTimeout(obsTimer); obsTimer = null; }
    if (clickCheckTimer) { clearTimeout(clickCheckTimer); clickCheckTimer = null; }
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (saveBadgeTimer) { clearTimeout(saveBadgeTimer); saveBadgeTimer = null; }

    if (quotaObserver) {
      try { quotaObserver.disconnect(); } catch {}
      quotaObserver = null;
    }
    if (settingsObserver) {
      try { settingsObserver.disconnect(); } catch {}
      settingsObserver = null;
    }

    if (doc) {
      try { doc.removeEventListener('visibilitychange', onQuotaWake); } catch {}
      try { doc.removeEventListener('click', onQuotaDocClick, true); } catch {}
      try { doc.removeEventListener('click', onGuardSettingsClick, true); } catch {}
      try { doc.removeEventListener('click', onSettingsDocClick, true); } catch {}
    }
    if (win) {
      try { win.removeEventListener('focus', onQuotaWake); } catch {}
      try { win.removeEventListener('popstate', onQuotaDocClick); } catch {}
      try { win.removeEventListener('keydown', onGuardZoomKeydown, true); } catch {}
      try { win.removeEventListener('ag-suite-prefs-changed', onSuitePrefsChanged); } catch {}
    }
    if (activeSidebar && boundSidebarClick) {
      try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
    }
    activeSidebar = null;
    boundSidebarClick = null;
    activeDlg = null;
    settingsTabOpen = false;

    cleanupQuotaDom();
    cleanupSettingsDom();
    removeElementById('ag-codex-quota-style');
    removeElementById('ag-codex-theme-style');
    removeElementById('ag-user-fonts');

    if (doc && doc.documentElement) {
      for (const attr of ['data-ag-preset', 'data-ag-theme-mode', 'data-ag-os', 'data-ag-page-type']) {
        try { doc.documentElement.removeAttribute(attr); } catch {}
      }
    }
  }

  // Boot DOM integrations if running in browser/DOM environment
  if (doc) {
    if (doc.body) {
      if (currentConfig.codexTheme) {
        syncCodexThemeModule();
      }
      applyUserFonts(currentConfig.fonts);

      doc.addEventListener('visibilitychange', onQuotaWake);
      doc.addEventListener('click', onQuotaDocClick, true);
      doc.addEventListener('click', onGuardSettingsClick, true);
      doc.addEventListener('click', onSettingsDocClick, true);

      if (win) {
        win.addEventListener('focus', onQuotaWake);
        win.addEventListener('popstate', onQuotaDocClick);
        win.addEventListener('keydown', onGuardZoomKeydown, true);
        win.addEventListener('ag-suite-prefs-changed', onSuitePrefsChanged);
      }

      if (typeof MutationObserver !== 'undefined') {
        try {
          quotaObserver = new MutationObserver(() => {
            if (!disposed && currentConfig.quotaSidebar) scheduleQuotaObsCheck();
          });
          quotaObserver.observe(doc.body, { childList: true, subtree: true });
        } catch {}

        try {
          settingsObserver = new MutationObserver(() => {
            if (disposed) return;
            if (activeDlg) {
              const navOk = doc.getElementById('ag-settings-nav-wrap');
              const paneOk = doc.getElementById('ag-settings-pane');
              if (!activeDlg.isConnected || !navOk || !navOk.isConnected || !paneOk || !paneOk.isConnected) {
                tryMountInSettingsModal();
              }
              return;
            }
            if (
              String(win.location?.search || '').includes('settingsOpen=true') ||
              doc.querySelector('[data-testid="settings-sidebar"]')
            ) {
              tryMountInSettingsModal();
            }
          });
          settingsObserver.observe(doc.body, { childList: true, subtree: true });
        } catch {}
      }

      fetchTimer = setInterval(() => {
        if (disposed || doc.hidden || !currentConfig.quotaSidebar) return;
        const now = Date.now();
        const needForce =
          !lastGroups ||
          hasExpiredQuotaBucket(lastGroups, now) ||
          now - lastForceFetchAt >= FORCE_POLL_INTERVAL_MS;
        void fetchQuota(needForce);
      }, FETCH_INTERVAL_MS);

      tickTimer = setInterval(() => {
        if (disposed || doc.hidden || !currentConfig.quotaSidebar || !lastGroups || lastGroups.length === 0) return;
        renderQuota();
        const now = Date.now();
        if (hasExpiredQuotaBucket(lastGroups, now) && now - lastForceFetchAt >= FORCE_COOLDOWN_MS) {
          void fetchQuota(true);
        }
      }, TICK_INTERVAL_MS);

      if (currentConfig.quotaSidebar) {
        ensureQuotaStyleTag();
        void fetchQuota(false);
      }
      tryMountInSettingsModal();
    }
    void hydrateConfigFromHost();
  }

  const api = (globalThis.__AGCodexOverlay = {
    version: '1.0.1',
    isAlive: () => !disposed,
    dispose,
    getConfig,
    updateConfig,
    refreshQuota: (force) => fetchQuota(Boolean(force), { manual: true }),
    helpers: {
      normalizeQuotaStyle,
      normalizeQuotaOtherStyle,
      normalizeQuotaPoolFilter,
      parseQuotaResetMs,
      parseQuotaSummary,
      formatShortPoolLabel,
      matchActiveQuotaGroupIndex,
      filterQuotaGroupsForDisplay,
      classifyQuotaLevel,
      computeQuotaSegments,
      computeQuotaDotLevels,
      formatQuotaCountdown,
      formatQuotaResetDetail,
      formatQuotaCountdownLabel,
      formatQuotaModelShort,
      hasExpiredQuotaBucket,
      cleanModelLabel,
      buildUserFontsCss
    }
  });

  if (g !== globalThis) {
    g.__AGCodexOverlay = api;
  }
  if (win && win !== g && win !== globalThis) {
    win.__AGCodexOverlay = api;
  }
})();
