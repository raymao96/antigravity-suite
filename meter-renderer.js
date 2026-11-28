(function () {
  const METER_VERSION = '0.9.0';

  'use strict';
  if (location.protocol !== 'https:' || location.hostname !== '127.0.0.1') return;
  globalThis.__AGContextMeter?.dispose();
  const {
    summarize,
    parseGeneratorCall,
    calculateRequestApiCost,
    normalizeModelId,
    getLvlForRange,
    getDailyModelCost,
    calculateIntervalCost,
    convertToCNY,
    convertCurrency,
    resolveEffectivePlanStatus
  } = (globalThis.__AGContextMeterCore || {});

  const BASE_CURRENCY_STORAGE_KEY = 'ag_suite_base_currency';
  const BASE_CURRENCY_SYMBOLS = { TWD: 'NT$', USD: '$', CNY: '¥' };

  function getActiveBaseCurrency() {
    try {
      const saved = String(localStorage?.getItem?.(BASE_CURRENCY_STORAGE_KEY) || '').trim().toUpperCase();
      if (saved === 'TWD' || saved === 'USD' || saved === 'CNY') return saved;
    } catch {}
    let loc = '';
    try {
      loc = (typeof suiteEnhancerPrefs !== 'undefined' && suiteEnhancerPrefs?.locale)
        ? String(suiteEnhancerPrefs.locale)
        : String(localStorage?.getItem?.('ag_suite_locale') || 'zh-TW');
    } catch { loc = 'zh-TW'; }
    if (loc === 'zh-CN') return 'CNY';
    if (loc === 'en') return 'USD';
    return 'TWD';
  }

  function convertToBaseCurrency(amount, fromCurrency, regionQuery = null, targetCur = null) {
    const toCur = targetCur || getActiveBaseCurrency();
    if (typeof convertCurrency === 'function') {
      return convertCurrency(amount, fromCurrency, toCur, regionQuery);
    }
    if (toCur === 'CNY' && typeof convertToCNY === 'function') {
      return convertToCNY(amount, fromCurrency, regionQuery);
    }
    return null;
  }

  const twoDecimalFormat = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function formatUsdEstimate(amount, prefix = '') {
    return amount > 0 && amount < 0.005 ? '<$0.01' : `${prefix}$${twoDecimalFormat.format(amount)}`;
  }

  function formatBaseCurrencyParen(amount, fromCurrency, regionQuery = null, decimals = 1) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
    const baseCur = getActiveBaseCurrency();
    let fromCur = String(fromCurrency || 'USD').toUpperCase();
    if (fromCur === 'NTD') fromCur = 'TWD';
    if (fromCur === baseCur) return '';
    const val = convertToBaseCurrency(amount, fromCur, regionQuery, baseCur);
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '';
    const sym = BASE_CURRENCY_SYMBOLS[baseCur] || '';
    return `(≈ ${sym}${Number(val).toFixed(decimals)} ${baseCur})`;
  }

  function formatUsdSecondaryParen(usdAmount) {
    if (usdAmount === null || usdAmount === undefined || Number.isNaN(Number(usdAmount))) return '';
    const baseCur = getActiveBaseCurrency();
    if (baseCur === 'USD') return '';
    const val = convertToBaseCurrency(usdAmount, 'USD', null, baseCur);
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '';
    const sym = BASE_CURRENCY_SYMBOLS[baseCur] || '';
    return ` (${sym}${Number(val).toFixed(2)})`;
  }
  const host = document.createElement('div');
  host.id = 'ag-context-meter';
  host.setAttribute('data-layout', 'wide');
  host.setAttribute('data-dock', 'fixed');
  host.setAttribute('data-window-active', 'true');
  const shadow = host.attachShadow({ mode: 'open' });

  // Antigravity 本地真实 Token 统计基准数据（纯净初始状态，启动时由宿主实时扫描本地实际账本注入）
  const ANTIGRAVITY_TOKEN_DATA = {
    updatedAt: "",
    firstUseDate: null,
    summary: {
      grandTotalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheTokens: 0,
      todayTokens: 0,
      monthTokens: 0,
      yearTokens: 0,
      totalSteps: 0,
      totalConversations: 0,
      firstUseDate: null,
      activeDaysCount: 0
    },
    dailyMap: {}
  };

  const RING_RADIUS = 6.5;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  shadow.innerHTML = `<style>
    :host{
      position:fixed;top:6px;right:138px;z-index:2147483000;
      font:12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI",sans-serif;
      -webkit-app-region:no-drag;user-select:none;display:inline-flex;align-items:center;gap:2px;
      height:28px;flex-shrink:0;vertical-align:middle;

      /* 优先复用 Antigravity 0 级宿主主题变量，无变量时回退深色默认值 */
      --ag-toolbar-fg:var(--secondary-foreground,#b8b8c0);
      --ag-toolbar-fg-hover:var(--foreground,#ececef);
      --ag-toolbar-bg:transparent;
      --ag-toolbar-bg-hover:var(--secondary,rgba(255,255,255,0.08));
      --ag-toolbar-bg-active:var(--secondary,rgba(255,255,255,0.12));
      --ag-toolbar-border-focus:var(--primary,rgba(128,128,128,0.45));
      --ag-divider:var(--border,rgba(255,255,255,0.08));

      /* 圆环与各指标默认主题色 */
      --ag-ring-track-default:rgba(255,255,255,0.20);
      --ag-ring-used-default:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      --ag-ring-warn:#f59e0b;
      --ag-ring-danger:#ef4444;

      --ag-context-text-default:var(--foreground,#ececef);
      --ag-speed-default:var(--secondary-foreground,#b8b8c0);
      --ag-token-total-default:var(--secondary-foreground,#b8b8c0);
      --ag-token-accent-default:#a78bfa;
      --ag-accent-bg:rgba(167,139,250,0.14);
      --ag-accent-bg-hover:rgba(167,139,250,0.24);
      --ag-accent-border:rgba(167,139,250,0.34);
      --ag-accent-border-hover:rgba(167,139,250,0.56);
      --ag-accent-glow:rgba(167,139,250,0.44);

      /* 0 级主题背景与一级/二级微明度表面层级 */
      --ag-bg-panel-default:var(--ag-host-bg,var(--background,#18181b));
      --ag-unified-bg:var(--ag-custom-panel-bg,var(--ag-bg-panel-default));
      --ag-link:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));

      --ag-float-bg:var(--ag-unified-bg);
      --ag-float-border:rgba(255,255,255,0.12);
      --ag-float-shadow:0 12px 32px rgba(0,0,0,0.52),0 2px 8px rgba(0,0,0,0.32);

      --ag-bg-panel:var(--ag-unified-bg);
      --ag-border-panel:rgba(255,255,255,0.11);
      --ag-shadow-panel:0 16px 40px rgba(0,0,0,0.58),0 2px 10px rgba(0,0,0,0.32);
      --ag-text-primary:#ececef;
      --ag-text-secondary:#c8c8d0;
      --ag-text-muted:#a1a1aa;
      --ag-border-subtle:rgba(255,255,255,0.08);

      /* 一级卡片与二级子卡片采用柔和微差层次 */
      --ag-bg-card:rgba(255,255,255,0.025);
      --ag-bg-card-hover:rgba(255,255,255,0.045);
      --ag-border-card:rgba(255,255,255,0.09);
      --ag-bg-subcard:rgba(255,255,255,0.04);
      --ag-border-subcard:rgba(255,255,255,0.08);
      --ag-bg-status:rgba(255,255,255,0.035);
      --ag-text-status:#c8c8d0;

      --ag-btn-bg:rgba(255,255,255,0.04);
      --ag-btn-hover:rgba(255,255,255,0.08);
      --ag-btn-border:rgba(255,255,255,0.12);
      --ag-btn-border-hover:rgba(255,255,255,0.22);
      --ag-btn-text:#d4d4d8;

      --ag-pill-muted-bg:rgba(255,255,255,0.04);
      --ag-pill-muted-border:rgba(255,255,255,0.12);
      --ag-pill-muted-text:#a1a1aa;

      --ag-track-bg:rgba(255,255,255,0.12);
      --ag-track-shadow:none;

      --ag-heat-bg:rgba(255,255,255,0.025);
      --ag-heat-lvl-0:#27272a;
      --ag-heat-lvl-1:#3f1e6b;
      --ag-heat-lvl-2:#652ab7;
      --ag-heat-lvl-3:#9053f8;
      --ag-heat-lvl-4:#c084fc;
      --ag-heat-outline:#ffffff;

      --ag-pop-bg:var(--ag-unified-bg);
      --ag-pop-border:var(--ag-float-border);
      --ag-pop-shadow:var(--ag-float-shadow);
      --ag-pop-text:var(--ag-text-primary);
      --ag-pop-muted:var(--ag-text-secondary);
      --ag-pop-sub:var(--ag-text-muted);

      --ag-scrollbar-thumb:rgba(255,255,255,0.16);
      --ag-scrollbar-hover:rgba(255,255,255,0.28);

      --ag-bg-input:rgba(255,255,255,0.06);
      --ag-select-option-bg:#222226;
      --ag-select-option-fg:#ececef;

      --ag-ease-out:cubic-bezier(0.16,1,0.3,1);
      --ag-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.06);
      --ag-text-danger:#f87171;
      --ag-text-warn:#fbbf24;

      color-scheme:dark;
      color:var(--ag-text-primary);
    }

    /* 融入宿主原生布局容器时参与正常 Flexbox 空间分配 */
    :host([data-dock="flow"]){
      position:relative !important;top:auto !important;right:auto !important;left:auto !important;bottom:auto !important;z-index:20;
      margin-right:4px;
    }
    :host([data-elevated="true"]),
    :host([data-dock="flow"][data-elevated="true"]){
      z-index:2147483646 !important;
    }

    /* 窗口非活动或宿主非对话全屏子视图（扩展/插件市场）时暂停动效并避让 */
    :host([data-window-active="false"]) *,
    :host([data-marketplace-active="true"]) *{
      animation-play-state:paused !important;
    }
    :host([data-marketplace-active="true"]) .ag-panel,
    :host([data-marketplace-active="true"]) #panel,
    :host([data-marketplace-active="true"]) #panel-tokens,
    :host([data-marketplace-active="true"]) #panel-settings,
    :host([data-marketplace-active="true"]) #overflow-menu,
    :host([data-marketplace-active="true"]) #context-tooltip,
    :host([data-marketplace-active="true"]) #update-popover,
    :host([data-marketplace-active="true"]) #popover{
      display:none !important;
      visibility:hidden !important;
      pointer-events:none !important;
    }
    :host([data-dock="fixed"][data-marketplace-active="true"]){
      display:none !important;
      pointer-events:none !important;
    }
    :host([data-window-active="false"]) .ag-unit{
      opacity:0.72;
    }
    :host([data-window-active="false"]) .ag-unit:hover,
    :host([data-window-active="false"]) .ag-unit:focus-visible{
      opacity:1;
    }

    /* 浅色模式规范（与 0 级浅色主题协调，且微明度层次一致） */
    :host([data-theme="light"]),
    :host([data-panel-tone="light"]){
      --ag-toolbar-fg:#52525b;
      --ag-toolbar-fg-hover:#18181b;
      --ag-toolbar-bg:transparent;
      --ag-toolbar-bg-hover:rgba(0,0,0,0.06);
      --ag-toolbar-bg-active:rgba(0,0,0,0.10);
      --ag-toolbar-border-focus:rgba(0,0,0,0.35);
      --ag-divider:rgba(0,0,0,0.08);

      --ag-ring-track-default:rgba(0,0,0,0.18);
      --ag-ring-used-default:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
      --ag-ring-warn:#d97706;
      --ag-ring-danger:#dc2626;

      --ag-context-text-default:#18181b;
      --ag-speed-default:#52525b;
      --ag-token-total-default:#52525b;
      --ag-token-accent-default:#7c3aed;
      --ag-link:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
      --ag-accent-bg:rgba(124,58,237,0.10);
      --ag-accent-bg-hover:rgba(124,58,237,0.18);
      --ag-accent-border:rgba(124,58,237,0.28);
      --ag-accent-border-hover:rgba(124,58,237,0.48);
      --ag-accent-glow:rgba(124,58,237,0.32);

      --ag-bg-panel-default:var(--ag-host-bg,var(--background,#ffffff));
      --ag-unified-bg:var(--ag-custom-panel-bg,var(--ag-bg-panel-default));

      --ag-float-bg:var(--ag-unified-bg);
      --ag-float-border:rgba(0,0,0,0.12);
      --ag-float-shadow:0 8px 24px rgba(0,0,0,0.12),0 2px 6px rgba(0,0,0,0.06);

      --ag-bg-panel:var(--ag-unified-bg);
      --ag-border-panel:rgba(0,0,0,0.12);
      --ag-shadow-panel:0 14px 36px rgba(0,0,0,0.14),0 2px 8px rgba(0,0,0,0.06);
      --ag-text-primary:#18181b;
      --ag-text-secondary:#3f3f46;
      --ag-text-muted:#52525b;
      --ag-border-subtle:rgba(0,0,0,0.08);

      --ag-bg-card:rgba(0,0,0,0.02);
      --ag-bg-card-hover:rgba(0,0,0,0.04);
      --ag-border-card:rgba(0,0,0,0.10);
      --ag-bg-subcard:rgba(0,0,0,0.035);
      --ag-border-subcard:rgba(0,0,0,0.09);
      --ag-bg-status:rgba(0,0,0,0.03);
      --ag-text-status:#27272a;

      --ag-btn-bg:rgba(0,0,0,0.035);
      --ag-btn-hover:rgba(0,0,0,0.06);
      --ag-btn-border:rgba(0,0,0,0.12);
      --ag-btn-border-hover:rgba(0,0,0,0.22);
      --ag-btn-text:#18181b;

      --ag-pill-muted-bg:rgba(0,0,0,0.035);
      --ag-pill-muted-border:rgba(0,0,0,0.12);
      --ag-pill-muted-text:#52525b;

      --ag-track-bg:rgba(0,0,0,0.08);
      --ag-track-shadow:none;

      --ag-heat-bg:rgba(0,0,0,0.02);
      --ag-heat-lvl-0:#e4e4e7;
      --ag-heat-lvl-1:#e9d5ff;
      --ag-heat-lvl-2:#c084fc;
      --ag-heat-lvl-3:#9333ea;
      --ag-heat-lvl-4:#6b21a8;
      --ag-heat-outline:#18181b;

      --ag-scrollbar-thumb:rgba(0,0,0,0.16);
      --ag-scrollbar-hover:rgba(0,0,0,0.28);

      --ag-bg-input:rgba(0,0,0,0.04);
      --ag-select-option-bg:#ffffff;
      --ag-select-option-fg:#18181b;

      --ag-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.65);
      --ag-text-danger:#dc2626;
      --ag-text-warn:#b45309;

      color-scheme:light;
      color:var(--ag-text-primary);
    }

    /* 顶栏透明控件按宿主实际标题栏明暗自适应，防止面板独立设深/浅时顶栏文字隐身 */
    :host([data-host-theme="light"]){
      --ag-toolbar-fg:#52525b;
      --ag-toolbar-fg-hover:#18181b;
      --ag-toolbar-bg-hover:rgba(0,0,0,0.06);
      --ag-toolbar-bg-active:rgba(0,0,0,0.10);
      --ag-toolbar-border-focus:rgba(0,0,0,0.35);
      --ag-divider:rgba(0,0,0,0.08);
      --ag-ring-track-default:rgba(0,0,0,0.18);
      --ag-context-text-default:#18181b;
      --ag-speed-default:#52525b;
      --ag-token-total-default:#52525b;
    }
    :host([data-host-theme="dark"]){
      --ag-toolbar-fg:#b8b8c0;
      --ag-toolbar-fg-hover:#ececef;
      --ag-toolbar-bg-hover:rgba(255,255,255,0.08);
      --ag-toolbar-bg-active:rgba(255,255,255,0.12);
      --ag-toolbar-border-focus:rgba(128,128,128,0.45);
      --ag-divider:rgba(255,255,255,0.08);
      --ag-ring-track-default:rgba(255,255,255,0.20);
      --ag-context-text-default:#ececef;
      --ag-speed-default:#b8b8c0;
      --ag-token-total-default:#b8b8c0;
    }

    *{box-sizing:border-box}
    .sr-only{
      position:absolute!important;width:1px!important;height:1px!important;
      padding:0!important;margin:-1px!important;overflow:hidden!important;
      clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;
    }
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:var(--ag-scrollbar-thumb);border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:var(--ag-scrollbar-hover)}
    button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0}
    :is(button,[tabindex="0"],summary,select,input[type="checkbox"]):focus-visible{
      outline:2px solid var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      outline-offset:1px;
    }

    /* Basic Unit: 原生工具栏级别精密小单元 */
    .ag-unit{
      display:inline-flex;align-items:center;justify-content:center;
      height:28px;padding:0 7px;border-radius:8px;border:1px solid transparent;
      background:var(--ag-toolbar-bg);color:var(--ag-toolbar-fg);
      white-space:nowrap;font-variant-numeric:tabular-nums;
      font-size:12px;font-weight:500;letter-spacing:0;gap:4px;
      transition:background-color .14s var(--ag-ease-out),color .14s ease,border-color .14s ease,opacity .14s ease,transform .08s ease;
      flex-shrink:0;
    }
    .ag-unit:hover,.ag-unit:focus-visible,.ag-unit[aria-expanded="true"]{
      background:var(--ag-toolbar-bg-hover);
      color:var(--ag-toolbar-fg-hover);
    }
    .ag-unit:active{
      background:var(--ag-toolbar-bg-active);
      transform:scale(0.975) translateY(0.5px);
    }

    /* 单元 1: 上下文小圆环按钮（按内容自适应，圆环+百分比共存） */
    #badge.ag-unit-ring{
      width:auto!important;
      min-width:28px;
      height:28px;
      padding:0 6px 0 4px;
      gap:3px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
    }
    :host([data-layout="ring-only"]) #badge.ag-unit-ring{
      width:28px!important;
      min-width:28px!important;
      padding:0!important;
      gap:0!important;
    }
    .ring-svg{
      width:18px;height:18px;display:block;flex-shrink:0;overflow:visible;
    }
    .ring-track{
      stroke:var(--ag-custom-ring-track,var(--ag-ring-track-default));
    }
    .ring-fill{
      stroke:var(--ag-custom-ring-used,var(--ag-ring-used-default));
      transition:stroke-dasharray .22s ease,opacity .15s ease;
    }
    :host([data-occupancy="warn"]) .ring-fill{
      stroke:var(--ag-ring-warn);
    }
    :host([data-occupancy="danger"]) .ring-fill{
      stroke:var(--ag-ring-danger);
    }

    /* 单元 1B: 模型额度圆环入口 */
    #badge-quota.ag-unit-quota{
      width:auto;
      min-width:28px;
      height:28px;
      padding:0 6px 0 5px;
      gap:4px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      color:var(--ag-toolbar-fg);
    }
    .quota-ring-svg{
      width:18px;height:18px;display:block;flex-shrink:0;overflow:visible;
    }
    .quota-ring-track{
      stroke:var(--ag-custom-ring-track,var(--ag-ring-track-default));
    }
    .quota-ring-fill{
      stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      transition:stroke-dashoffset .22s cubic-bezier(0.22,1,0.36,1),stroke .18s ease,opacity .15s ease;
    }
    #badge-quota[data-quota-state="available"] .quota-ring-fill{ stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)); }
    :host([data-theme="light"]) .quota-ring-fill,
    :host([data-panel-tone="light"]) .quota-ring-fill,
    :host([data-theme="light"]) #badge-quota[data-quota-state="available"] .quota-ring-fill,
    :host([data-panel-tone="light"]) #badge-quota[data-quota-state="available"] .quota-ring-fill{ stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed)); }
    #badge-quota[data-quota-state="low"] .quota-ring-fill{ stroke:#f59e0b; }
    #badge-quota[data-quota-state="exhausted"] .quota-ring-fill{ stroke:#ef4444; }
    #badge-quota[data-quota-state="no_permission"] .quota-ring-fill{ stroke:#a855f7; }
    #badge-quota[data-quota-state="stale"] .quota-ring-fill{ stroke:#eab308; opacity:0.8; }
    #badge-quota[data-quota-state="error"] .quota-ring-fill{ stroke:#f97316; }
    #badge-quota[data-quota-state="unknown"] .quota-ring-fill{ stroke:var(--ag-text-muted); opacity:0.65; }
    .quota-badge-val{
      font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;
      color:var(--ag-text-primary);
      white-space:nowrap;
      min-width:34px;text-align:center;
    }
    #badge-quota[data-quota-state="exhausted"] .quota-badge-val{ color:var(--ag-text-danger,#f87171); }
    #badge-quota[data-quota-state="error"] .quota-badge-val{ color:#fb923c; }
    #badge-quota[data-quota-state="no_permission"] .quota-badge-val{ color:#c084fc; }
    :host([data-theme="light"]) #badge-quota[data-quota-state="exhausted"] .quota-badge-val,
    :host([data-panel-tone="light"]) #badge-quota[data-quota-state="exhausted"] .quota-badge-val{ color:var(--ag-text-danger,#dc2626); }
    :host([data-theme="light"]) #badge-quota[data-quota-state="error"] .quota-badge-val,
    :host([data-panel-tone="light"]) #badge-quota[data-quota-state="error"] .quota-badge-val{ color:#ea580c; }
    :host([data-theme="light"]) #badge-quota[data-quota-state="no_permission"] .quota-badge-val,
    :host([data-panel-tone="light"]) #badge-quota[data-quota-state="no_permission"] .quota-badge-val{ color:#7e22ce; }
    .quota-badge-tag{
      font-size:11px;font-weight:500;padding:0 5px;border-radius:4px;
      background:rgba(127,127,127,0.16);color:var(--ag-text-secondary);
      line-height:16px;white-space:nowrap;
    }
    :host([data-layout="compact"]) #badge-quota{ padding:0 5px 0 4px;gap:3px; }
    :host([data-layout="compact"]) .quota-badge-tag{ display:none!important; }
    :host([data-layout="minimal"]) #badge-quota,
    :host([data-layout="ring-only"]) #badge-quota{ display:none!important; }

    /* 单元 2 (合并进单元 1): 内联输出速度 */
    #badge-speed,
    #badge .badge-inline-speed{
      display:inline-flex;
      align-items:center;
      gap:3px;
      color:var(--ag-custom-speed,var(--ag-speed-default));
      margin-left:3px;
      padding-left:6px;
      border-left:1px solid var(--ag-divider,rgba(128,128,128,0.25));
      font-variant-numeric:tabular-nums;
      justify-content:flex-start;
    }
    #badge:hover #badge-speed,#badge:focus-visible #badge-speed,#badge[aria-expanded="true"] #badge-speed{
      color:var(--ag-custom-speed,var(--ag-toolbar-fg-hover));
    }
    .speed-icon{
      width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;
      flex-shrink:0;opacity:0.88;font-size:11.5px;line-height:1;
    }
    #speed-amount{
      font-variant-numeric:tabular-nums;
      display:inline-block;
      min-width:30px;
      text-align:left;
      color:inherit;
    }
    #badge-speed[data-speed-phase="waiting"]{
      min-width:26px;
      justify-content:center;
    }
    #badge-speed[data-speed-phase="waiting"] #badge-speed-icon,
    #badge-speed[data-speed-phase="waiting"] #speed-amount{
      display:none !important;
    }
    .speed-wait-svg{
      width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;
      flex-shrink:0;color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .speed-wait-svg[hidden]{display:none !important}
    .ag-hourglass-svg{
      display:block;width:14px;height:14px;transform-origin:center;
      animation:ag-hourglass-flip 1.8s cubic-bezier(0.4,0,0.2,1) infinite;
      will-change:transform;
    }
    .ag-hourglass-sand-top{transform-origin:7px 6.5px;animation:ag-hg-top-drain 1.8s linear infinite}
    .ag-hourglass-sand-bot{transform-origin:7px 11.5px;animation:ag-hg-bot-fill 1.8s linear infinite}
    .ag-hourglass-stream{animation:ag-hg-stream 1.8s linear infinite}
    @keyframes ag-hourglass-flip{
      0%,68%{transform:rotate(0deg)}
      88%,100%{transform:rotate(180deg)}
    }
    @keyframes ag-hg-top-drain{
      0%{transform:scaleY(1);opacity:0.95}
      68%,100%{transform:scaleY(0.12);opacity:0.35}
    }
    @keyframes ag-hg-bot-fill{
      0%{transform:scaleY(0.15);opacity:0.4}
      68%,100%{transform:scaleY(1);opacity:0.95}
    }
    @keyframes ag-hg-stream{
      0%,66%{opacity:0.9;transform:translateY(0)}
      70%,100%{opacity:0;transform:translateY(1px)}
    }
    @media (prefers-reduced-motion: reduce){
      .ag-hourglass-svg,.ag-hourglass-sand-top,.ag-hourglass-sand-bot,.ag-hourglass-stream{
        animation:none !important;
      }
    }

    /* 单元 3: 累计 Token 用量 */
    #badge-tokens{
      color:var(--ag-custom-token-total,var(--ag-token-total-default));
      min-width:68px;
      justify-content:flex-start;
    }
    #badge-tokens:hover,#badge-tokens:focus-visible,#badge-tokens[aria-expanded="true"]{
      color:var(--ag-custom-token-total,var(--ag-toolbar-fg-hover));
    }
    .token-fire-dot{
      width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default));
      flex-shrink:0;opacity:0.95;
    }
    .badge-pct-val{
      font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;
      color:var(--ag-custom-context-text,var(--ag-context-text-default));
      padding-left:2px;
    }
    :host([data-layout="ring-only"]) .badge-pct-val{
      display:none!important;
    }
    #token-amount{
      font-variant-numeric:tabular-nums;
      display:inline-block;
      min-width:38px;
      text-align:left;
      color:inherit;
    }

    /* 下拉选择框与选项在深浅主题下的高对比度保底 */
    select {
      background-color: var(--ag-bg-input, rgba(255,255,255,0.08)) !important;
      color: var(--ag-text-primary, #ececef) !important;
      border: 1px solid var(--ag-border-subcard, rgba(255,255,255,0.15)) !important;
      border-radius: 4px;
      outline: none;
      color-scheme: dark;
    }
    :host([data-theme="light"]) select,
    :host([data-panel-tone="light"]) select {
      background-color: var(--ag-bg-input, #f4f4f5) !important;
      color: var(--ag-text-primary, #18181b) !important;
      border-color: var(--ag-border-subcard, rgba(0,0,0,0.15)) !important;
      color-scheme: light;
    }
    select option {
      background-color: var(--ag-select-option-bg, #27272a) !important;
      color: var(--ag-select-option-fg, #f4f4f5) !important;
    }
    :host([data-theme="light"]) select option,
    :host([data-panel-tone="light"]) select option {
      background-color: #ffffff !important;
      color: #18181b !important;
    }

    /* 单元 4: 一键启动 CLI 按钮 */
    #badge-cli{
      color:var(--ag-toolbar-fg);
      min-width:44px;
      padding:0 6px;
      gap:3px;
      justify-content:center;
      transition: transform 0.08s cubic-bezier(0.2, 0, 0, 1), background-color 0.12s ease, opacity 0.12s ease;
      user-select: none;
      -webkit-user-select: none;
    }
    #badge-cli:hover,#badge-cli:focus-visible{
      color:var(--ag-toolbar-fg-hover);
    }
    #badge-cli:active,
    #badge-cli[data-pressed="true"]{
      transform: scale(0.96);
      background: var(--ag-toolbar-bg-active);
    }
    #badge-cli[data-busy="true"]{
      cursor: wait;
      pointer-events: none;
    }
    #badge-cli[data-busy="true"] .cli-icon{
      animation: ag-cli-pulse 0.8s ease-in-out infinite alternate;
    }
    @keyframes ag-cli-pulse {
      0% { transform: scale(0.9); opacity: 0.6; }
      100% { transform: scale(1.15); opacity: 1; }
    }
    .cli-icon{
      font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
      font-size:11px;font-weight:600;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default));
      line-height:1;
      display: inline-block;
      transition: transform 0.15s ease;
    }

    /* CLI 启动状态提示浮层 */
    #cli-launch-toast{
      position:fixed;top:38px;right:140px;z-index:2147483647;
      max-width:360px;padding:7px 11px;border-radius:8px;
      border:1px solid var(--ag-float-border);
      background:var(--ag-float-bg);color:var(--ag-text-primary);
      box-shadow:var(--ag-float-shadow);font-size:12px;line-height:1.45;
      pointer-events:auto;transition:opacity .15s ease,transform .15s ease;
    }
    #cli-launch-toast[hidden]{display:none!important}
    #cli-launch-toast[data-tone="error"]{
      border-color:rgba(239,68,68,0.45);
      color:var(--ag-text-danger,#f87171);
    }
    :host([data-theme="light"]) #cli-launch-toast[data-tone="error"],
    :host([data-panel-tone="light"]) #cli-launch-toast[data-tone="error"]{
      color:var(--ag-text-danger,#dc2626);
    }

    /* 单元 4B: 统一设置按钮 */
    #badge-settings{
      width:26px;height:26px;padding:0;font-size:13px;
      color:var(--ag-toolbar-fg);justify-content:center;
    }
    #badge-settings:hover,#badge-settings:focus-visible,#badge-settings[aria-expanded="true"]{
      color:var(--ag-toolbar-fg-hover);
    }

    /* 单元 5: 窄屏溢出菜单入口 */
    #badge-overflow{
      width:28px;height:28px;padding:0;display:none;
    }
    .overflow-icon{
      width:16px;height:16px;display:block;
    }

    /* 渐进式宽度收缩四阶段: wide -> compact -> minimal -> ring-only */
    :host([data-layout="compact"]){
      gap:1px;
    }
    :host([data-layout="compact"]) #badge .badge-inline-speed{
      margin-left:2px;padding-left:5px;gap:2px;
    }
    :host([data-layout="compact"]) #badge-tokens,
    :host([data-layout="compact"]) #badge-cli,
    :host([data-layout="compact"]) #badge-settings{
      padding:0 5px;font-size:11.5px;gap:3px;
    }
    :host([data-layout="minimal"]) #badge .badge-inline-speed,
    :host([data-layout="minimal"]) #badge-speed,
    :host([data-layout="minimal"]) #badge-tokens,
    :host([data-layout="minimal"]) #badge-cli,
    :host([data-layout="minimal"]) #badge-settings{
      display:none!important;
    }
    :host([data-layout="minimal"]) #badge-overflow{
      display:inline-flex!important;
    }
    :host([data-layout="ring-only"]) #badge .badge-inline-speed,
    :host([data-layout="ring-only"]) #badge-speed,
    :host([data-layout="ring-only"]) #badge-tokens,
    :host([data-layout="ring-only"]) #badge-cli,
    :host([data-layout="ring-only"]) #badge-settings,
    :host([data-layout="ring-only"]) #badge-overflow{
      display:none!important;
    }

    /* 用户自定义功能显示开关 */
    :host([data-hide-tokens="true"]) #badge-tokens,
    :host([data-hide-tokens="true"]) #overflow-tokens-btn,
    :host([data-hide-cli="true"]) #badge-cli,
    :host([data-hide-cli="true"]) #overflow-cli-btn,
    :host([data-hide-quota="true"]) #badge-quota,
    :host([data-hide-remote="true"]) #badge-remote{
      display:none!important;
    }

    /* 上下文悬停信息气泡（严格还原参考图三层结构） */
    #context-tooltip{
      position:fixed;top:0;left:0;z-index:2147483647;
      min-width:166px;max-width:268px;padding:9px 13px;
      border-radius:10px;border:1px solid var(--ag-float-border);
      background:var(--ag-float-bg);color:var(--ag-text-primary);
      box-shadow:var(--ag-float-shadow);
      pointer-events:none;opacity:0;visibility:hidden;
      transform:translateY(2px);
      transition:opacity .12s ease,transform .12s ease,visibility .12s ease;
      font-variant-numeric:tabular-nums;
    }
    #context-tooltip[data-visible="true"]{
      opacity:1;visibility:visible;transform:none;
    }
    .ctx-tip-title{
      font-size:12px;line-height:1.35;font-weight:500;
      color:var(--ag-text-muted);margin-bottom:2px;
    }
    .ctx-tip-pct{
      font-size:13px;line-height:1.38;font-weight:600;
      color:var(--ag-custom-context-text,var(--ag-text-primary));
    }
    :host([data-occupancy="warn"]) .ctx-tip-pct{
      color:var(--ag-ring-warn);
    }
    :host([data-occupancy="danger"]) .ctx-tip-pct{
      color:var(--ag-ring-danger);
    }
    .ctx-tip-detail{
      font-size:12.5px;line-height:1.38;font-weight:500;
      color:var(--ag-custom-context-text,var(--ag-text-secondary));
      margin-top:1px;
    }

    /* 窄屏溢出菜单浮层 */
    #overflow-menu{
      box-sizing:border-box;
      position:fixed;top:36px;right:12px;z-index:2147483645;
      width:220px;padding:4px;border-radius:12px;
      border:1px solid var(--ag-float-border);
      background:var(--ag-float-bg);color:var(--ag-text-primary);
      box-shadow:var(--ag-float-shadow);
      transform-origin:top right;
    }
    #overflow-menu[hidden]{display:none!important}
    .overflow-item{
      width:100%;display:flex;align-items:center;justify-content:space-between;
      padding:7px 9px;border-radius:8px;font-size:12px;color:var(--ag-text-secondary);
      text-align:left;transition:background-color .12s ease,color .12s ease,transform .08s ease;
    }
    .overflow-item:hover,.overflow-item:focus-visible{
      background:var(--ag-toolbar-bg-hover);color:var(--ag-text-primary);
    }
    .overflow-item:active{
      transform:scale(0.985) translateY(0.5px);
    }
    .overflow-item-label{display:flex;align-items:center;gap:6px;font-weight:500;min-width:0}
    .overflow-item-val{font-weight:600;font-variant-numeric:tabular-nums;color:var(--ag-text-primary);flex-shrink:0}

    /* 详情二级抽屉折叠交互 */
    .tech-drawer{margin-top:10px;border-top:1px solid var(--ag-border-subtle);padding-top:9px}
    .drawer-trigger{
      width:100%;display:flex;justify-content:space-between;align-items:center;
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);
      border-radius:7px;padding:7px 11px;color:var(--ag-text-secondary);font-size:12.5px;font-weight:500;
      cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .08s ease;
    }
    .drawer-trigger:hover{background:var(--ag-bg-card-hover);color:var(--ag-text-primary);border-color:var(--ag-border-card)}
    .drawer-trigger:active{transform:scale(0.99) translateY(0.5px)}
    .drawer-trigger-left{display:flex;align-items:center;gap:6px;min-width:0}
    .drawer-arrow{font-size:11.5px;color:var(--ag-text-muted);font-weight:600;white-space:nowrap;flex-shrink:0}
    .drawer-body{margin-top:9px}

    /* 自定义颜色设置网格与自定义颜色选取器面板 */
    .color-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:6px}
    .color-item{
      display:flex;align-items:center;justify-content:space-between;gap:6px;
      padding:6px 8px;border-radius:6px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);min-width:0;
    }
    .color-item-lbl{font-size:12px;color:var(--ag-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .color-item-ctrls{display:flex;align-items:center;gap:4px;flex-shrink:0}
    .color-picker{display:none!important}
    .color-swatch-btn{
      width:20px;height:20px;padding:0;border:1px solid var(--ag-border-card);
      border-radius:4px;background:var(--swatch-color,#7748cf);cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
      box-shadow:inset 0 0 0 1px rgba(0,0,0,0.18);transition:border-color .12s ease,transform .08s ease;
    }
    .color-swatch-btn:hover{border-color:var(--ag-text-primary)}
    .color-swatch-btn:active{transform:scale(0.94)}
    .color-reset-btn{
      font-size:11.5px;padding:2px 7px;border-radius:4px;white-space:nowrap;
      border:1px solid var(--ag-btn-border);background:var(--ag-btn-bg);color:var(--ag-text-muted);
      transition:background-color .12s ease,color .12s ease,transform .08s ease;
    }
    .color-reset-btn:hover{color:var(--ag-text-primary);background:var(--ag-btn-hover)}
    .color-reset-btn:active{transform:scale(0.975) translateY(0.5px)}
    .color-reset-btn[data-mode="auto"]{opacity:0.55}

    /* 自定义颜色选取器悬浮面板（参考样式：吸管 + 预设圆点 + SV主色区 + 色相条 + HEX/RGB/HSL三行） */
    #color-picker-popover{
      position:fixed;z-index:2147483646;width:304px;max-height:calc(100vh - 48px);overflow-y:auto;
      background:var(--ag-bg-panel);color:var(--ag-text-primary);
      border:1px solid var(--ag-border-panel);border-radius:10px;
      box-shadow:var(--ag-shadow-panel);padding:12px;
      user-select:none;
      opacity:1;transform:none;
      transition:opacity 170ms var(--ag-ease-out), transform 170ms var(--ag-ease-out);
      pointer-events:auto;
    }
    #color-picker-popover[hidden]{display:none!important}
    #color-picker-popover.is-opening{
      opacity:0;transform:translateY(-3px);
    }
    #color-picker-popover.is-closing{
      opacity:0;transform:translateY(-3px);
      transition:opacity 125ms cubic-bezier(0.4, 0, 1, 1), transform 125ms cubic-bezier(0.4, 0, 1, 1);
      pointer-events:none!important;
    }
    .cp-advanced-formats{
      margin-top:6px;border-top:1px solid var(--ag-border-subtle);padding-top:6px;
    }
    .cp-fmt-summary{
      font-size:11px;color:var(--ag-text-muted);cursor:pointer;outline:none;user-select:none;
    }
    .cp-fmt-summary:hover{color:var(--ag-text-primary)}
    .source-switch-bar,.view-switch-bar{
      display:inline-flex;align-items:center;background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);border-radius:6px;padding:2px;gap:2px;
    }
    .switch-pill-btn{
      border:0;background:transparent;color:var(--ag-text-muted);font-size:12px;font-weight:500;
      padding:3px 9px;border-radius:4px;cursor:pointer;white-space:nowrap;
      transition:background-color .12s ease,color .12s ease,transform .08s ease;
    }
    .switch-pill-btn:hover{color:var(--ag-text-primary)}
    .switch-pill-btn:active:not(:disabled){transform:scale(0.975) translateY(0.5px)}
    .switch-pill-btn.active{
      background:var(--ag-unified-bg);color:var(--ag-text-primary);font-weight:600;
      box-shadow:0 1px 3px rgba(0,0,0,0.18);
    }
    .plan-summary-price-badge{
      display:inline-flex;align-items:center;gap:4px;
      padding:3px 10px;border-radius:999px;
      font-size:11.5px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;
      cursor:pointer;flex-shrink:0;user-select:none;
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      transition:background 0.2s var(--ag-ease-out), border-color 0.2s var(--ag-ease-out), transform 0.08s ease;
    }
    .plan-summary-price-badge:hover{
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .plan-summary-price-badge:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .plan-summary-price-badge.is-animating{
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
    }
    :host([data-theme="light"]) .plan-summary-price-badge,
    :host([data-panel-tone="light"]) .plan-summary-price-badge{
      background:var(--ag-accent-bg,rgba(124,58,237,0.10));
      border-color:var(--ag-accent-border,rgba(124,58,237,0.28));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }
    :host([data-theme="light"]) .plan-summary-price-badge:hover,
    :host([data-panel-tone="light"]) .plan-summary-price-badge:hover{
      background:var(--ag-accent-bg-hover,rgba(124,58,237,0.18));
      border-color:var(--ag-accent-border-hover,rgba(124,58,237,0.48));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }
    :host([data-theme="light"]) .plan-summary-price-badge.is-animating{
      box-shadow:0 0 10px var(--ag-accent-glow,rgba(124,58,237,0.32));
      border-color:var(--ag-accent-border-hover,rgba(124,58,237,0.48));
    }
    .plan-subtier-readonly-pill{
      display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;
      font-size:11.5px;font-weight:600;white-space:nowrap;flex-shrink:0;
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .badge-symbol-anim{
      display:inline-block;
      transition:opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1), transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), filter 0.18s ease;
    }
    .badge-symbol-anim.is-dissolving{
      opacity:0;
      transform:scale(0.72) translateY(-2px);
      filter:blur(1.5px);
    }
    .badge-symbol-anim.is-entering{
      opacity:0;
      transform:scale(1.25) translateY(2px);
      filter:blur(1.5px);
    }
    .badge-num-anim{
      display:inline-block;
      font-variant-numeric:tabular-nums;
      font-feature-settings:"tnum";
    }
    .badge-cycle-anim{
      display:inline-block;
    }
    .plan-summary-bar{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;
      padding:8px 12px;margin-bottom:10px;font-size:12.5px;
    }
    .plan-summary-badge{
      display:inline-flex;align-items:center;gap:6px;font-weight:600;min-width:0;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default));
    }
    .plan-detail-dl{
      display:grid;
      grid-template-columns:120px minmax(0,1fr);
      gap:7px 12px;
      margin:0;
      align-items:baseline;
    }
    .plan-detail-dl dt{
      color:var(--ag-text-muted);
      font-size:12px;
      white-space:nowrap;
      text-align:left;
    }
    .plan-detail-dl dd{
      margin:0;
      text-align:left;
      max-width:none;
      min-width:0;
      color:var(--ag-text-primary);
      font-size:12.5px;
      font-variant-numeric:tabular-nums;
      line-height:1.5;
      overflow-wrap:break-word;
    }
    @media (max-width: 600px) {
      .plan-detail-dl{
        grid-template-columns:minmax(0,1fr);
        gap:3px 0;
      }
      .plan-detail-dl dt{
        font-weight:600;
        margin-top:3px;
      }
    }
        /* 所有详情与收起面板的丝滑物理展开动画 (匹配一级菜单质感) */
    @keyframes agSmoothExpand{
      0%{
        opacity:0;
        transform:translateY(-6px) scale(0.985);
      }
      100%{
        opacity:1;
        transform:none;
      }
    }
    .collapsible-pane[style*="display: block"],
    .collapsible-pane:not([style*="display: none"]),
    #plan-detail-card:not([style*="display: none"]),
    #plan-custom-form:not([style*="display: none"]),
    #cost-details-pane:not([style*="display: none"]),
    .drawer-body:not([style*="display: none"]){
      animation: agSmoothExpand 0.2s cubic-bezier(0.16,1,0.3,1);
      transform-origin: top center;
    }

    /* 适度调和、略亮半度但温润自然的药丸编辑按钮 */
    .plan-edit-pill-btn{
      display:inline-flex;align-items:center;gap:5px;
      padding:4px 12px;border-radius:6px;white-space:nowrap;
      font-size:12px;font-weight:500;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      cursor:pointer;user-select:none;
      transition:background-color 0.16s ease,border-color 0.16s ease,color 0.16s ease,transform 0.08s ease;
    }
    .plan-edit-pill-btn:hover{
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .plan-edit-pill-btn:active{
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.28));
      transform:scale(0.975) translateY(0.5px);
    }
    :host([data-theme="light"]) .plan-edit-pill-btn,
    :host([data-panel-tone="light"]) .plan-edit-pill-btn{
      background:var(--ag-accent-bg,rgba(124,58,237,0.10));
      border-color:var(--ag-accent-border,rgba(124,58,237,0.28));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }
    :host([data-theme="light"]) .plan-edit-pill-btn:hover,
    :host([data-panel-tone="light"]) .plan-edit-pill-btn:hover{
      background:var(--ag-accent-bg-hover,rgba(124,58,237,0.16));
      border-color:var(--ag-accent-border-hover,rgba(124,58,237,0.44));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }

    /* Antigravity 原生定制下拉组件样式与动效 */
    .ag-dropdown-wrapper{
      position:relative;width:100%;box-sizing:border-box;
    }
    .ag-dropdown-trigger{
      width:100%;height:28px;min-height:28px;box-sizing:border-box;
      display:flex;align-items:center;justify-content:space-between;gap:6px;
      padding:0 8px;font-size:12.5px;
      color:var(--ag-text-primary);
      background:var(--ag-bg-input);
      border:1px solid var(--ag-border-subcard);
      border-radius:5px;
      cursor:pointer;user-select:none;
      transition:background .15s var(--ag-ease-out),border-color .15s var(--ag-ease-out),box-shadow .15s var(--ag-ease-out);
    }
    #plan-custom-form input:not([type="checkbox"]):not([type="radio"]),
    #plan-custom-form select,
    .unlock-input{
      height:28px;
      min-height:28px;
      padding:0 8px !important;
      font-size:11.5px;
      line-height:26px;
      border-radius:5px !important;
      box-sizing:border-box;
      outline:none;
    }
    #plan-custom-form input[type="date"]{
      display:inline-flex;
      align-items:center;
    }
    #plan-custom-form input:not([type="checkbox"]):not([type="radio"]):focus,
    #plan-custom-form input:not([type="checkbox"]):not([type="radio"]):focus-visible,
    .unlock-input:focus,
    .unlock-input:focus-visible{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)) !important;
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .ag-dropdown-trigger:hover{
      background:rgba(255,255,255,0.08);
      border-color:rgba(255,255,255,0.22);
    }
    :host([data-theme="light"]) .ag-dropdown-trigger:hover,
    :host([data-panel-tone="light"]) .ag-dropdown-trigger:hover{
      background:rgba(0,0,0,0.05);
      border-color:rgba(0,0,0,0.22);
    }
    .ag-dropdown-wrapper.is-open .ag-dropdown-trigger{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.25));
      background:var(--ag-bg-subcard);
    }
    .ag-dropdown-arrow{
      width:10px;height:10px;display:flex;align-items:center;justify-content:center;
      flex-shrink:0;opacity:0.65;
      transition:transform 0.2s var(--ag-ease-out),opacity 0.2s ease;
    }
    .ag-dropdown-wrapper.is-open .ag-dropdown-arrow{
      transform:rotate(180deg);opacity:1;
    }
    .plan-detail-card, .plan-detail-dl{
      overflow:visible !important;
    }
    .ag-dropdown-wrapper.is-open{
      z-index:2147483647 !important;
    }
    .ag-dropdown-menu{
      position:absolute;top:calc(100% + 4px);left:0;right:0;
      max-height:240px;overflow-y:auto;overflow-anchor:none;
      background:var(--ag-unified-bg,#1e1e24);
      border:1px solid var(--ag-float-border,rgba(255,255,255,0.14));
      border-radius:10px;
      box-shadow:var(--ag-shadow-panel);
      padding:4px;z-index:2147483647 !important;
      opacity:0;transform:translateY(-6px) scale(0.97);
      transform-origin:top center;pointer-events:none;
      transition:opacity 0.16s var(--ag-ease-out),transform 0.16s var(--ag-ease-out);
    }
    .ag-dropdown-search-wrap{
      position:sticky;top:-4px;margin:-4px -4px 4px -4px;padding:6px;
      background:var(--ag-unified-bg,#1e1e24);
      border-bottom:1px solid var(--ag-border-subcard);
      z-index:10;
    }
    .ag-dropdown-search-input{
      width:100%;box-sizing:border-box;
      background:var(--ag-bg-input);
      border:1px solid var(--ag-border-subcard);
      border-radius:4px;padding:5px 8px;font-size:12.5px;
      color:var(--ag-text-primary);outline:none;
    }
    .ag-dropdown-search-input:focus,
    .ag-dropdown-search-input:focus-visible{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .ag-dropdown-wrapper.is-open .ag-dropdown-menu{
      opacity:1;transform:none;pointer-events:auto;
    }
    .ag-dropdown-item{
      display:flex;align-items:center;justify-content:space-between;gap:6px;
      padding:6px 9px;border-radius:6px;
      font-size:12.5px;color:var(--ag-text-secondary);
      cursor:pointer;user-select:none;
      transition:background 0.12s ease,color 0.12s ease;
    }
    .ag-dropdown-item:hover{
      background:rgba(255,255,255,0.08);color:var(--ag-text-primary);
    }
    :host([data-theme="light"]) .ag-dropdown-item:hover,
    :host([data-panel-tone="light"]) .ag-dropdown-item:hover{
      background:rgba(0,0,0,0.05);color:var(--ag-text-primary);
    }
    .ag-dropdown-item.is-selected{
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;background:var(--ag-accent-bg,rgba(167,139,250,0.12));
    }
    .ag-dropdown-item-check{
      font-size:11px;opacity:0;color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .ag-dropdown-item.is-selected .ag-dropdown-item-check{
      opacity:1;
    }
    .ag-dropdown-item.is-keyboard-focus{
      background:rgba(255,255,255,0.12);outline:1px solid var(--ag-accent-border-hover,rgba(167,139,250,0.4));
    }
    :host([data-theme="light"]) .ag-dropdown-item.is-keyboard-focus,
    :host([data-panel-tone="light"]) .ag-dropdown-item.is-keyboard-focus{
      background:rgba(0,0,0,0.08);outline:1px solid var(--ag-accent-border-hover,rgba(124,58,237,0.4));
    }
    .ag-dropdown-wrapper.open-up .ag-dropdown-menu{
      top:auto;bottom:calc(100% + 4px);
      transform-origin:bottom center;
      transform:translateY(6px) scale(0.97);
    }
    .ag-dropdown-wrapper.is-open.open-up .ag-dropdown-menu{
      transform:none;
    }
    .ag-dropdown-item-right{
      display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding-left:6px;flex-shrink:0;
    }
    .ag-dropdown-item-sub{
      font-size:11px;color:var(--ag-text-muted);margin-left:auto;padding-left:8px;
    }
    .ag-dropdown-item-right .ag-dropdown-item-sub{
      margin-left:0;padding-left:0;
    }
    .ag-dropdown-item:hover .ag-dropdown-item-sub{
      color:var(--ag-text-secondary);
    }
    .ag-dropdown-menu::-webkit-scrollbar{width:4px}
    .ag-dropdown-menu::-webkit-scrollbar-thumb{background:var(--ag-scrollbar-thumb,rgba(255,255,255,0.2));border-radius:4px}

    .plan-detail-card{
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;
    }
    .collapsible-pane{
      transition:opacity 0.18s ease;
    }
    .round-cost-bar{
      display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;
      padding:6px 10px;margin:6px 0 8px;font-size:12.5px;font-variant-numeric:tabular-nums;
    }
    #cost-estimate-card{font-variant-numeric:tabular-nums}
    .cp-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}
    .cp-title{font-size:12.5px;font-weight:600;color:var(--ag-text-primary);display:flex;align-items:center;gap:6px;min-width:0}
    .cp-target-lbl{font-size:11px;font-weight:400;color:var(--ag-text-muted)}
    .cp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:9px}
    .cp-eyedropper-btn{
      display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;white-space:nowrap;
      border:1px solid var(--ag-btn-border);background:var(--ag-btn-bg);color:var(--ag-text-primary);
      font-size:11.5px;font-weight:500;cursor:pointer;flex-shrink:0;
      transition:background-color .12s ease,border-color .12s ease,transform .08s ease;
    }
    .cp-eyedropper-btn:hover{background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    .cp-eyedropper-btn:active{transform:scale(0.975) translateY(0.5px)}
    .cp-presets{display:flex;align-items:center;gap:5px}
    .cp-preset-dot{
      width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.22);
      cursor:pointer;padding:0;transition:transform .12s ease;
    }
    :host([data-theme="light"]) .cp-preset-dot,
    :host([data-panel-tone="light"]) .cp-preset-dot{border-color:rgba(0,0,0,0.18)}
    .cp-preset-dot:hover{transform:scale(1.16)}
    .cp-stage{display:grid;grid-template-columns:16px minmax(0,1fr);gap:8px;margin-bottom:8px}
    .cp-side-preview{border-radius:6px;border:1px solid var(--ag-border-card);background:#652ab7}
    .cp-sv-area{
      position:relative;height:132px;border-radius:7px;overflow:hidden;cursor:crosshair;
      border:1px solid var(--ag-border-card);
      background-color:#ff0000;
      background-image:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent);
    }
    .cp-sv-thumb{
      position:absolute;width:12px;height:12px;border-radius:50%;
      border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.75);
      transform:translate(-50%,-50%);pointer-events:none;left:50%;top:50%;
    }
    .cp-hue-wrap{
      position:relative;height:12px;border-radius:6px;margin-bottom:10px;cursor:ew-resize;
      border:1px solid var(--ag-border-card);
      background:linear-gradient(to right,#ff0000 0%,#ffff00 17%,#00ff00 33%,#00ffff 50%,#0000ff 67%,#ff00ff 83%,#ff0000 100%);
    }
    .cp-hue-thumb{
      position:absolute;top:50%;width:12px;height:12px;border-radius:50%;
      background:#fff;border:2px solid rgba(0,0,0,0.45);box-shadow:0 1px 3px rgba(0,0,0,0.5);
      transform:translate(-50%,-50%);pointer-events:none;left:0%;
    }
    .cp-rows{display:flex;flex-direction:column;gap:6px}
    .cp-row{
      display:grid;grid-template-columns:36px minmax(0,1fr) 24px;align-items:center;gap:6px;
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-card);
      border-radius:6px;padding:4px 7px;
      transition:border-color .14s ease,box-shadow .14s ease;
    }
    .cp-row:focus-within{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .cp-fmt-lbl{font-size:11px;font-weight:600;color:var(--ag-text-muted)}
    .cp-fmt-input{
      width:100%;border:0;background:transparent;color:var(--ag-text-primary);
      font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;
      outline:none;padding:1px 2px;
    }
    .cp-copy-btn{
      border:0;background:transparent;color:var(--ag-text-muted);cursor:pointer;white-space:nowrap;
      font-size:11.5px;padding:2px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;
      transition:background-color .12s ease,color .12s ease,transform .08s ease;
    }
    .cp-copy-btn:hover{color:var(--ag-text-primary);background:var(--ag-toolbar-bg-hover)}
    .cp-copy-btn:active{transform:scale(0.95)}
    .cp-footer{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:7px;border-top:1px solid var(--ag-border-subtle)}

    /* 弹出面板：上下文 (#panel) 与 Token 用量一览 (#panel-tokens) 独立面板 */
    .ag-panel{
      box-sizing:border-box;
      position:fixed;top:38px;left:auto;right:16px;z-index:2147483645;
      max-width:calc(100vw - 24px);max-height:calc(100vh - 54px);
      overflow:auto;overflow-anchor:none;border:1px solid var(--ag-border-panel);border-radius:14px;
      background:var(--ag-bg-panel);color:var(--ag-text-primary);
      box-shadow:var(--ag-shadow-panel),var(--ag-inset-highlight);
      padding:12px 14px 16px;
      opacity:1;transform:none;visibility:visible;pointer-events:auto;
      transform-origin:top right;
      transition:opacity .16s var(--ag-ease-out),transform .16s var(--ag-ease-out),visibility .16s ease;
    }
    .ag-panel.ag-panel-flex{
      display:flex;flex-direction:column;overflow:hidden;padding:0;
    }
    .ag-panel.ag-panel-flex .panel-header-bar{
      position:relative;top:auto;flex:0 0 auto;margin:0;padding:12px 14px 9px;
      border-bottom:1px solid var(--ag-border-subtle);background:var(--ag-bg-panel);z-index:20;
    }
    .quota-panel-body{
      flex:1 1 auto;min-height:0;overflow-y:auto;overflow-anchor:none;overscroll-behavior:contain;
      padding:10px 14px 20px;box-sizing:border-box;
    }
    #panel{width:500px;max-width:calc(100vw - 24px)}
    #panel-quota{width:500px;max-width:calc(100vw - 24px)}
    #panel-tokens{width:730px;transition:width .22s var(--ag-ease-out),max-width .22s var(--ag-ease-out),opacity .16s var(--ag-ease-out),transform .16s var(--ag-ease-out)}
    #panel-tokens.cost-compact-view{width:400px!important;max-width:calc(100vw - 24px)}
    .ag-panel[hidden]{display:block!important;opacity:0;transform:translateY(-6px);visibility:hidden;pointer-events:none}

    /* 视图内平滑交叉淡入淡出（避免直接 display 硬切导致内容跳闪） */
    @keyframes agFadeIn{
      from{opacity:0;transform:translateY(4px)}
      to{opacity:1;transform:none}
    }
    .view-pane-fade{transition:opacity .15s ease,transform .15s ease;opacity:1;transform:none}
    .view-pane-fade.pane-hidden{opacity:0;transform:translateY(3px);display:none!important}

    /* 顶栏控制条（sticky 固定，防止表单或详情展开时滚出视口） */
    .panel-header-bar{
      position:sticky;top:-12px;background:var(--ag-bg-panel);z-index:20;
      margin-top:-12px;padding-top:12px;
      display:flex;justify-content:space-between;align-items:center;
      border-bottom:1px solid var(--ag-border-subtle);padding-bottom:9px;margin-bottom:11px
    }
    .panel-title{display:flex;align-items:center;gap:5px;min-width:0}
    .panel-title-tokens{color:var(--ag-custom-token-accent,var(--ag-token-accent-default))}
    .panel-header-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}

    .panel-icon-btn{
      background:none;border:0;color:var(--ag-text-muted);font-size:12px;line-height:1;
      padding:4px 7px;border-radius:6px;cursor:pointer;white-space:nowrap;
      transition:background-color .14s ease,color .14s ease,transform .08s ease;
      display:inline-flex;align-items:center;justify-content:center;gap:3px;
    }
    .panel-icon-btn:hover{color:var(--ag-text-primary);background:var(--ag-toolbar-bg-hover)}
    .panel-icon-btn:active{transform:scale(0.95)}
    #close,#close-tokens,#close-quota{font-size:16px;padding:2px 7px}

    /* 模型额度看板面板 (#panel-quota) */
    .quota-refresh-feedback{
      display:inline-flex;align-items:center;
      font-size:11.5px;font-weight:500;color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      padding:2px 7px;border-radius:10px;white-space:nowrap;
      opacity:1;visibility:visible;
      transition:opacity .18s ease,visibility .18s ease;
    }
    :host([data-theme="light"]) .quota-refresh-feedback,
    :host([data-panel-tone="light"]) .quota-refresh-feedback{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.28))}
    .quota-refresh-feedback[hidden]{display:inline-flex!important;opacity:0;visibility:hidden;pointer-events:none}
    .quota-refresh-btn{gap:4px;font-size:12px;padding:4px 9px;white-space:nowrap;border:1px solid var(--ag-btn-border);border-radius:6px;background:var(--ag-btn-bg);color:var(--ag-text-secondary);transition:background .15s ease,border-color .15s ease,color .15s ease,transform .08s ease}
    .quota-refresh-btn:not(:disabled):hover{color:var(--ag-text-primary);background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    .quota-refresh-btn:not(:disabled):active{transform:scale(0.975) translateY(0.5px)}
    .quota-refresh-btn[disabled]{cursor:progress;color:var(--ag-text-primary);background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    .quota-refresh-icon{display:inline-block;transform-origin:center}
    @media (max-width:440px){.quota-refresh-feedback[hidden]{display:none!important}}
    .quota-banner{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:8px 11px;border-radius:7px;margin-bottom:8px;font-size:12px;line-height:1.45;
      border:1px solid rgba(245,158,11,0.35);background:rgba(245,158,11,0.1);color:var(--ag-text-primary);
    }
    .quota-banner[hidden],.quota-cur-alert[hidden],.quota-cur-est[hidden],.quota-bucket-est[hidden],#quota-plan-tier-pill[hidden]{display:none !important}
    .quota-banner .switch-pill-btn{white-space:nowrap;flex-shrink:0}
    .quota-banner[data-tone="error"]{border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.12)}
    .quota-times-grid{
      display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,0.92fr) minmax(0,1.33fr);gap:6px;margin-bottom:9px;
    }
    .quota-time-cell{
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);
      border-radius:6px;padding:7px 8px;min-width:0;
    }
    .quota-time-label{font-size:11.5px;color:var(--ag-text-muted);margin-bottom:2px}
    .quota-time-val{font-size:12px;line-height:1.35;font-weight:600;color:var(--ag-text-primary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .quota-current-card{
      background:var(--ag-bg-card);border:1px solid var(--ag-border-card);
      border-radius:8px;padding:10px 12px;margin-bottom:10px;
    }
    .quota-cur-model-name{font-size:14px;font-weight:600;color:var(--ag-text-primary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .quota-cur-pool-sub{font-size:12px;color:var(--ag-text-muted);margin-top:2px}
    .quota-cur-est{font-size:12px;color:var(--ag-text-secondary);margin-top:3px;font-variant-numeric:tabular-nums}
    .quota-cur-alert{
      margin-top:7px;padding:6px 9px;border-radius:6px;font-size:12px;line-height:1.45;
      background:var(--ag-accent-bg);border:1px solid var(--ag-accent-border);color:var(--ag-text-secondary);
    }
    .quota-cur-alert[data-kind="notice"]{background:var(--ag-accent-bg);border-color:var(--ag-accent-border)}
    .quota-buckets-list{display:flex;flex-direction:column;gap:7px;margin-top:8px}
    .quota-bucket-row{display:flex;flex-direction:column;gap:4px}
    .quota-bucket-meta{display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:6px;min-width:0}
    .quota-bucket-name{color:var(--ag-text-secondary);font-weight:500;min-width:0}
    .quota-bucket-val{font-weight:600;font-variant-numeric:tabular-nums;color:var(--ag-text-primary);text-align:right;flex-shrink:0}
    .quota-pct-num{display:inline-block;min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
    .quota-bucket-est{font-size:11.5px;color:var(--ag-text-muted);line-height:1.4;font-variant-numeric:tabular-nums}
    .quota-bar-track{position:relative;width:100%;height:5px;border-radius:3px;background:var(--ag-track-bg);overflow:hidden}
    .quota-bar-fill{width:100%;height:100%;border-radius:3px;background:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));transform-origin:left center;transform:scaleX(var(--quota-scale,0));transition:transform .22s cubic-bezier(0.22,1,0.36,1),background-color .18s ease;will-change:transform}
    :host([data-theme="light"]) .quota-bar-fill,
    :host([data-panel-tone="light"]) .quota-bar-fill{background:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    .quota-bar-fill[data-status="low"]{background:#f59e0b}
    .quota-bar-fill[data-status="exhausted"]{background:#ef4444}
    .quota-bar-fill[data-status="no_permission"]{background:#a855f7}
    .quota-bar-fill[data-status="unknown"]{background:var(--ag-text-muted)}
    .quota-bar-charge-stage{
      position:absolute;left:0;top:0;bottom:0;width:0;
      border-radius:3px;overflow:hidden;pointer-events:none;
      --quota-charge-bg:linear-gradient(90deg,var(--ag-accent-border-hover,rgba(167,139,250,0.75)) 0%,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)) 68%,rgba(255,255,255,0.85) 100%);
    }
    .quota-bar-charge-stage[hidden]{display:none!important}
    .quota-bar-charge-stage[data-status="low"]{
      --quota-charge-bg:linear-gradient(90deg,rgba(245,158,11,0.92) 0%,#fbbf24 62%,#fef08a 100%);
    }
    .quota-bar-charge-stage[data-status="exhausted"]{
      --quota-charge-bg:linear-gradient(90deg,rgba(239,68,68,0.92) 0%,#f87171 62%,#fecaca 100%);
    }
    :host([data-theme="light"]) .quota-bar-charge-stage,
    :host([data-panel-tone="light"]) .quota-bar-charge-stage{
      --quota-charge-bg:linear-gradient(90deg,var(--ag-accent-border-hover,rgba(124,58,237,0.75)) 0%,var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed)) 68%,rgba(255,255,255,0.85) 100%);
    }
    :host([data-theme="light"]) .quota-bar-charge-stage[data-status="low"],
    :host([data-panel-tone="light"]) .quota-bar-charge-stage[data-status="low"]{
      --quota-charge-bg:linear-gradient(90deg,rgba(217,119,6,0.94) 0%,#fbbf24 68%,#fef3c7 100%);
    }
    :host([data-theme="light"]) .quota-bar-charge-stage[data-status="exhausted"],
    :host([data-panel-tone="light"]) .quota-bar-charge-stage[data-status="exhausted"]{
      --quota-charge-bg:linear-gradient(90deg,rgba(220,38,38,0.94) 0%,#f87171 68%,#fee2e2 100%);
    }
    .quota-bar-charge-fill{
      position:absolute;inset:0;border-radius:3px;
      background:var(--quota-charge-bg);
      transform-origin:left center;transform:scaleX(0);opacity:0;
      will-change:transform,opacity;
    }
    .quota-bar-charge-sheen{
      position:absolute;top:0;bottom:0;left:0;width:62%;
      background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.82) 50%,rgba(255,255,255,0) 100%);
      transform:translateX(-120%);opacity:0;
      will-change:transform,opacity;
    }
    .quota-bar-track[data-charging="true"] .quota-bar-charge-fill{
      animation:ag-quota-bar-charge-fill 720ms linear forwards;
    }
    .quota-bar-track[data-charging="true"] .quota-bar-charge-sheen{
      animation:ag-quota-bar-charge-sheen 720ms linear forwards;
    }
    @keyframes ag-quota-bar-charge-fill{
      0%{transform:scaleX(0);opacity:0.96;animation-timing-function:cubic-bezier(0.22,1,0.36,1)}
      55%{transform:scaleX(1);opacity:1}
      76%{transform:scaleX(1);opacity:0.9;animation-timing-function:ease-out}
      100%{transform:scaleX(1);opacity:0}
    }
    @keyframes ag-quota-bar-charge-sheen{
      0%,34%{transform:translateX(-115%);opacity:0;animation-timing-function:cubic-bezier(0.35,0,0.25,1)}
      43%{opacity:1}
      76%{transform:translateX(175%);opacity:0.95}
      85%,100%{transform:translateX(190%);opacity:0}
    }
    .quota-pools-header{display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px;gap:8px}
    .quota-pools-list{display:flex;flex-direction:column;gap:8px}
    .quota-pool-card{
      background:var(--ag-bg-card);border:1px solid var(--ag-border-card);
      border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .14s ease,background-color .14s ease,transform .08s ease;
    }
    .quota-pool-card:hover{border-color:var(--ag-btn-border-hover)}
    .quota-pool-card:active{transform:scale(0.99) translateY(0.5px)}
    .quota-pool-card[data-active-current="true"]{border-color:var(--ag-accent-border)}
    .quota-pool-card[data-browsing="true"]{box-shadow:inset 0 0 0 1px var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .quota-pool-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;min-width:0}
    .quota-pool-title{font-size:13px;font-weight:600;color:var(--ag-text-primary);line-height:1.35;min-width:0;text-wrap:balance}
    .quota-pool-tags{display:flex;align-items:center;gap:4px;flex-shrink:0;flex-wrap:wrap}
    .quota-current-tag{font-size:11px;padding:1px 6px;border-radius:9px;background:var(--ag-accent-bg,rgba(167,139,250,0.14));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));font-weight:600;white-space:nowrap}
    :host([data-theme="light"]) .quota-current-tag,
    :host([data-panel-tone="light"]) .quota-current-tag{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.28))}
    .quota-models-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;padding-top:6px;border-top:1px solid var(--ag-border-subcard)}
    .quota-model-chip{
      display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:5px;
      font-size:11.5px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-secondary);
    }
    .quota-model-chip[data-current-model="true"]{border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));color:var(--ag-text-primary);font-weight:600}
    .quota-chip-efforts{font-size:11px;color:var(--ag-text-muted)}
    .quota-chip-notice{font-size:11px;padding:0 4px;border-radius:3px;background:var(--ag-accent-bg,rgba(167,139,250,0.14));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .quota-chip-noperm{font-size:11px;padding:0 4px;border-radius:3px;background:rgba(168,85,247,0.15);color:#c084fc}
    .quota-basis-note{margin-top:10px;padding-top:8px;border-top:1px solid var(--ag-border-subtle);font-size:12px;color:var(--ag-text-muted);line-height:1.5;text-wrap:pretty}
    .quota-usage-tip{margin-top:6px;padding:7px 9px;border-radius:6px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);font-size:12px;color:var(--ag-text-secondary);line-height:1.5;text-wrap:pretty}

    h3{margin:0;font-size:14px;font-weight:600;color:var(--ag-text-primary);text-wrap:balance}
    h4{margin:12px 0 5px;font-size:12.5px;font-weight:600;color:var(--ag-text-secondary);text-wrap:balance}
    p{margin:5px 0;color:var(--ag-text-muted)}
    .drawer-body dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;margin:0}
    .drawer-body dt{color:var(--ag-text-muted)}
    .drawer-body dd{margin:0;text-align:right;color:var(--ag-text-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;max-width:270px}

    #key-summary{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:11px 12px;margin:6px 0 10px}
    .key-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;gap:8px;min-width:0}
    .key-title{font-size:13px;font-weight:600;color:var(--ag-text-primary);display:flex;align-items:center;gap:5px;min-width:0;text-wrap:balance}
    .key-pill{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:10px;border:1px solid transparent;white-space:nowrap;flex-shrink:0}
    .pill-good, .pill-ok{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));background:var(--ag-accent-bg,rgba(167,139,250,0.14));border-color:var(--ag-accent-border,rgba(167,139,250,0.34))}
    :host([data-theme="light"]) .pill-good, :host([data-theme="light"]) .pill-ok,
    :host([data-panel-tone="light"]) .pill-good, :host([data-panel-tone="light"]) .pill-ok{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.28))}
    .pill-info{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));background:var(--ag-accent-bg,rgba(167,139,250,0.12));border-color:var(--ag-accent-border,rgba(167,139,250,0.28))}
    :host([data-theme="light"]) .pill-info,
    :host([data-panel-tone="light"]) .pill-info{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.26))}
    .pill-warn{color:var(--ag-text-warn,#fbbf24);background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.28)}
    :host([data-theme="light"]) .pill-warn,
    :host([data-panel-tone="light"]) .pill-warn{color:var(--ag-text-warn,#b45309);background:rgba(217,119,6,0.09);border-color:rgba(217,119,6,0.26)}
    .pill-danger{color:var(--ag-text-danger,#f87171);background:rgba(248,113,113,0.12);border-color:rgba(248,113,113,0.28)}
    :host([data-theme="light"]) .pill-danger,
    :host([data-panel-tone="light"]) .pill-danger{color:var(--ag-text-danger,#dc2626);background:rgba(220,38,38,0.09);border-color:rgba(220,38,38,0.26)}
    .pill-muted{color:var(--ag-pill-muted-text);background:var(--ag-pill-muted-bg);border-color:var(--ag-pill-muted-border)}

    .key-bar-track{width:100%;height:6px;background:var(--ag-custom-ring-track,var(--ag-track-bg));border-radius:3px;overflow:hidden;margin-bottom:9px}
    .key-bar-fill{height:100%;width:0%;border-radius:3px;background:var(--ag-custom-ring-used,var(--bar-color,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))));transition:width .24s ease,background-color .2s ease}
    :host([data-occupancy="warn"]) .key-bar-fill{background:var(--ag-ring-warn)}
    :host([data-occupancy="danger"]) .key-bar-fill{background:var(--ag-ring-danger)}
    .key-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;text-align:center;margin-bottom:7px}
    .key-stat{background:var(--ag-bg-subcard);padding:7px 5px;border-radius:6px;border:1px solid var(--ag-border-subcard);min-width:0}
    .key-stat-label{font-size:11.5px;color:var(--ag-text-muted);margin-bottom:2px}
    .key-stat-val{font-size:13.5px;font-weight:600;color:var(--ag-text-primary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #key-used{color:var(--ag-custom-context-text,var(--ag-text-primary))}
    .key-takeaway{font-size:12px;color:var(--ag-text-secondary);padding-top:6px;border-top:1px solid var(--ag-border-subcard);line-height:1.5;text-wrap:pretty}

    #status{padding:7px 10px;border:0;border-left:2.5px solid var(--tone,#666);border-radius:4px;background:var(--ag-bg-status);color:var(--ag-text-status);font-weight:500;font-size:12px}
    #model{overflow-wrap:anywhere;font-size:12px;color:var(--ag-text-muted)}
    #note,#coverage,#updated{font-size:11.5px;color:var(--ag-text-muted);text-wrap:pretty}
    #refresh{border:1px solid var(--ag-btn-border);border-radius:6px;background:var(--ag-btn-bg);color:var(--ag-btn-text);padding:4px 10px;margin-top:8px;white-space:nowrap;transition:background-color .14s ease,border-color .14s ease,transform .08s ease}
    #refresh:hover:not(:disabled){background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    #refresh:active:not(:disabled){transform:scale(0.975) translateY(0.5px)}

    #files{max-height:220px;overflow:auto}
    .file{padding:7px 0;border-top:1px solid var(--ag-border-subtle)}
    .file-name{overflow-wrap:anywhere;color:var(--ag-text-primary)}
    .file-detail{color:var(--ag-text-muted);font-size:12px}
    .file-unknown{color:var(--ag-text-warn,#fbbf24);font-size:12px}
    :host([data-theme="light"]) .file-unknown,
    :host([data-panel-tone="light"]) .file-unknown{color:var(--ag-text-warn,#b45309)}
    #v{color:var(--ag-text-muted);font-size:11px;font-weight:400;margin-left:6px;font-variant-numeric:tabular-nums}

    /* 全局 Token 用量一览 */
    #view-tokens{display:flex;flex-direction:column;gap:10px}
    .token-stat-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .t-card{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:3px;min-width:0;transition:background-color .14s ease}
    .t-card:hover{background:var(--ag-bg-card-hover)}
    .t-card-lbl{font-size:12px;color:var(--ag-text-muted);display:flex;justify-content:space-between;gap:4px;min-width:0}
    .t-card-val{font-size:17px;font-weight:600;color:var(--ag-text-primary);letter-spacing:0;font-variant-numeric:tabular-nums}
    #t-total-val{color:var(--ag-custom-token-total,var(--ag-text-primary))}
    #t-today-val{color:var(--ag-text-primary)}
    .t-card-sub{font-size:11.5px;color:var(--ag-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .t-card-cost{font-size:11.5px;color:var(--ag-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}

    .heatmap-section{background:var(--ag-heat-bg);border:1px solid var(--ag-border-card);border-radius:10px;padding:12px}
    .heat-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .heat-header-left{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .heat-title{font-size:13px;font-weight:600;color:var(--ag-text-primary);text-wrap:balance}
    .first-use-badge{
      font-size:11px;font-weight:500;color:var(--ag-text-secondary);
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-card);
      border-radius:6px;padding:2px 8px;font-variant-numeric:tabular-nums;
    }
    .heat-win-nav{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--ag-text-muted);font-variant-numeric:tabular-nums}
    .heat-nav-btn{
      border:1px solid var(--ag-btn-border);background:var(--ag-btn-bg);color:var(--ag-text-secondary);
      border-radius:4px;padding:1px 6px;font-size:11px;line-height:1.25;cursor:pointer;white-space:nowrap;
      transition:background-color .12s ease,color .12s ease,transform .08s ease;
    }
    .heat-nav-btn:hover:not(:disabled){background:var(--ag-btn-hover);color:var(--ag-text-primary)}
    .heat-nav-btn:active:not(:disabled){transform:scale(0.94)}
    .heat-nav-btn:disabled{opacity:0.35;cursor:default}
    .heat-tabs{
      position:relative;display:inline-flex;align-items:center;
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);
      border-radius:9999px;padding:2px;gap:2px;user-select:none;
    }
    .heat-tab-thumb{
      position:absolute;top:2px;bottom:2px;left:0;width:0;
      border-radius:9999px;
      background:var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
      border:1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.34));
      box-sizing:border-box;
      opacity:1;pointer-events:none;
      transition:transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), width 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
      will-change:transform, width;
    }
    /* 上下文加长面板样式 */
    .unlock-panel-content{padding:4px 0 2px;display:flex;flex-direction:column;gap:8px}
    .unlock-status-row{display:flex;justify-content:space-between;align-items:flex-start;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px}
    .unlock-label{font-size:12px;font-weight:600;color:var(--ag-text-primary);margin-bottom:2px}
    .unlock-desc{font-size:12px;color:var(--ag-text-secondary);line-height:1.45;text-wrap:pretty}
    .unlock-notice{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px}
    .unlock-notice-title{font-size:12px;font-weight:600;color:var(--ag-text-primary);margin-bottom:4px}
    .unlock-notice-list{margin:0;padding-left:14px;font-size:12px;color:var(--ag-text-secondary);line-height:1.55;text-wrap:pretty}
    .unlock-notice-list li{margin-bottom:2px}
    .unlock-notice-list strong{color:var(--ag-text-primary)}
    .unlock-actions-row{display:flex;gap:8px;align-items:center;margin-top:2px}
    .unlock-btn{display:inline-flex;align-items:center;justify-content:center;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background-color .15s var(--ag-ease-out),border-color .15s var(--ag-ease-out),color .15s ease,transform .08s ease}
    .unlock-btn:active:not(:disabled){transform:scale(0.975) translateY(0.5px)}
    .unlock-btn:disabled{opacity:0.5;cursor:not-allowed}
    .unlock-btn-primary{background:var(--ag-accent-bg,rgba(167,139,250,0.14));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34))}
    .unlock-btn-primary:hover:not(:disabled){background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56))}
    .unlock-btn-secondary{background:var(--ag-bg-subcard);color:var(--ag-text-primary);border:1px solid var(--ag-border-subcard)}
    .unlock-btn-secondary:hover:not(:disabled){background:var(--ag-bg-card-hover)}
    .unlock-result-box{border-radius:6px;padding:7px 10px;font-size:12px;line-height:1.45}
    .unlock-result-box.result-success{background:var(--ag-accent-bg,rgba(167,139,250,0.14));border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    :host([data-theme="light"]) .unlock-result-box.result-success,
    :host([data-panel-tone="light"]) .unlock-result-box.result-success{background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.28));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    .unlock-result-box.result-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:var(--ag-text-danger,#f87171)}
    .unlock-meta-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:12px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px;margin:2px 0}
    .unlock-meta-dl dt{color:var(--ag-text-muted);font-weight:500}
    .unlock-meta-dl dd{margin:0;color:var(--ag-text-secondary);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    .unlock-credit-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--ag-text-muted);border-top:1px solid var(--ag-border-subtle);padding-top:8px;margin-top:4px}
    .unlock-credit-left{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
    .unlock-author-link{color:var(--ag-link);text-decoration:underline;text-underline-offset:2px;font-weight:600;cursor:pointer;padding:1px 4px;border-radius:4px;transition:background-color .15s ease,color .15s ease;display:inline-flex;align-items:center}
    .unlock-author-link:hover{color:var(--ag-link);background:var(--ag-accent-bg)}
    .unlock-author-link:focus-visible{outline:2px solid var(--ag-link);background:var(--ag-accent-bg-hover)}
    .unlock-copy-link-btn{background:transparent;border:1px solid var(--ag-border-subcard);color:var(--ag-text-muted);border-radius:4px;font-size:11.5px;padding:2px 7px;white-space:nowrap;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .08s ease}
    .unlock-copy-link-btn:hover{color:var(--ag-text-primary);border-color:var(--ag-text-muted);background:var(--ag-bg-card-hover)}
    .unlock-copy-link-btn:active{transform:scale(0.975) translateY(0.5px)}
    .unlock-copy-link-btn:focus-visible{outline:2px solid var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));outline-offset:1px}
    .unlock-link-toast{margin-top:4px;font-size:11.5px;padding:4px 8px;border-radius:4px;background:var(--ag-accent-bg);color:var(--ag-text-primary);border:1px solid var(--ag-accent-border);line-height:1.45;animation:agSmoothExpand 0.15s ease}
    .unlock-adapter-note{font-size:11.5px;color:var(--ag-text-muted)}

    @media (prefers-reduced-motion: reduce){
      .heat-tab-thumb{transition:none!important}
    }
    .heat-tab-btn{
      position:relative;z-index:1;border:0;background:transparent;
      color:var(--ag-text-muted);font-size:12px;font-weight:500;
      padding:3px 10px;border-radius:9999px;cursor:pointer;
      transition:color .14s ease;white-space:nowrap;
    }
    .heat-tab-btn:hover{color:var(--ag-text-primary)}
    .heat-tab-btn.active{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));font-weight:600}
    .heat-tab-btn:focus-visible{outline:2px solid var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));outline-offset:1px}

    .heat-scroll-box{overflow-x:auto;overflow-y:hidden;padding:6px 6px 4px 6px}
    .heat-grid-cols{display:flex;gap:3px}
    .heat-week-col{display:flex;flex-direction:column;gap:3px}
    .heat-cell{width:10px;height:10px;border-radius:2px;background:var(--ag-heat-lvl-0);cursor:pointer;transition:outline .12s ease}
    .heat-cell:hover{z-index:5;outline:1.5px solid var(--ag-heat-outline)}
    .heat-cell.is-future{opacity:0.36}
    .heat-cell.is-today{outline:1.5px solid var(--ag-custom-token-accent,var(--ag-token-accent-default));outline-offset:0.5px}
    .lvl-0{background:var(--ag-heat-lvl-0)}
    .lvl-1{background:var(--ag-heat-lvl-1)}
    .lvl-2{background:var(--ag-heat-lvl-2)}
    .lvl-3{background:var(--ag-heat-lvl-3)}
    .lvl-4{background:var(--ag-heat-lvl-4)}

    .heat-months{position:relative;height:18px;margin-top:4px;font-size:11.5px;color:var(--ag-text-muted);overflow:hidden}
    .heat-month-item{position:absolute;white-space:nowrap}

    #h-weekly-box{display:none;height:105px;align-items:flex-end;gap:3px;border-bottom:1px solid var(--ag-border-subtle);padding-bottom:3px}
    .w-bar-col{flex:1;height:100%;display:flex;align-items:flex-end;cursor:pointer}
    .w-bar-fill{width:100%;border-radius:2px 2px 0 0;background:var(--ag-heat-lvl-0);min-height:3px;transition:height .22s ease,background-color .14s ease}
    .w-bar-col:hover .w-bar-fill{background:var(--ag-custom-token-accent,var(--ag-heat-lvl-4))!important}

    #h-monthly-box{display:none;height:105px;width:100%;box-sizing:border-box;align-items:center;justify-content:center}
    .heat-month-grid{display:grid;width:100%;height:100%;align-content:center;justify-content:center}
    .heat-month-cell{display:flex;align-items:center;justify-content:center;border-radius:3px;cursor:pointer;transition:outline .12s ease}
    .heat-month-cell:hover{z-index:5;outline:1.5px solid var(--ag-heat-outline,#fff)}
    .heat-month-cell-num{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;color:rgba(255,255,255,0.92);text-shadow:0 1px 2px rgba(0,0,0,0.65);pointer-events:none}
    :host([data-theme="light"]) .heat-month-cell.lvl-0 .heat-month-cell-num,
    :host([data-theme="light"]) .heat-month-cell.lvl-1 .heat-month-cell-num,
    :host([data-panel-tone="light"]) .heat-month-cell.lvl-0 .heat-month-cell-num,
    :host([data-panel-tone="light"]) .heat-month-cell.lvl-1 .heat-month-cell-num{color:#18181b;text-shadow:none}
    :host([data-theme="light"]) .heat-month-cell.lvl-2 .heat-month-cell-num,
    :host([data-theme="light"]) .heat-month-cell.lvl-3 .heat-month-cell-num,
    :host([data-theme="light"]) .heat-month-cell.lvl-4 .heat-month-cell-num,
    :host([data-panel-tone="light"]) .heat-month-cell.lvl-2 .heat-month-cell-num,
    :host([data-panel-tone="light"]) .heat-month-cell.lvl-3 .heat-month-cell-num,
    :host([data-panel-tone="light"]) .heat-month-cell.lvl-4 .heat-month-cell-num{color:#ffffff;text-shadow:0 1px 2px rgba(0,0,0,0.45)}

    #h-yearly-box{display:none;height:105px;width:100%;box-sizing:border-box;align-items:center;justify-content:center}
    .heat-yearly-svg{width:100%;height:105px;display:block;overflow:visible}
    @keyframes bubblePopIn{0%{transform:scale(0.6);opacity:0}100%{transform:scale(1);opacity:1}}
    .heat-yearly-bubble-group{transform-origin:center center;animation:bubblePopIn 0.22s cubic-bezier(0.16,1,0.3,1) both;cursor:pointer}

    @media (prefers-reduced-motion: reduce){.heat-yearly-bubble-group{animation:none!important}}
    .heat-yearly-bubble-group:hover circle.bubble-main{filter:brightness(1.22);stroke:var(--ag-text-primary);stroke-width:1.5px}

    #h-cum-box{display:none;height:105px;position:relative}
    canvas#h-cum-canvas{width:100%;height:105px;display:block}

    .heat-summary-bar{
      display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;
      margin-top:8px;padding:6px 9px;background:var(--ag-bg-subcard);border-radius:6px;
      border:1px solid var(--ag-border-subcard);font-size:12px;
    }
    .heat-sum-item{display:inline-flex;align-items:center;gap:4px}
    .heat-sum-label{color:var(--ag-text-muted);font-size:11.5px}
    .heat-sum-val{color:var(--ag-text-primary);font-weight:600;font-variant-numeric:tabular-nums}
    .heat-cost-disclaimer{font-size:11.5px;color:var(--ag-text-muted);margin-top:4px;line-height:1.45}

    .update-btn{position:relative}
    .update-badge-dot{
      position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;
      background:var(--ag-ring-danger,#ef4444);box-shadow:0 0 0 1.5px var(--ag-bg-panel);
    }
    .update-popover{
      position:fixed;top:80px;right:24px;width:290px;max-width:calc(100vw - 28px);
      background:var(--ag-unified-bg,#1e1e24);border:1px solid var(--ag-float-border,rgba(255,255,255,0.18));
      border-radius:10px;box-shadow:var(--ag-float-shadow);
      padding:12px 14px;z-index:2147483646;
      animation:agSmoothExpand 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    .update-pop-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;border-bottom:1px solid var(--ag-border-subcard);padding-bottom:5px}
    .update-pop-body{font-size:12px;color:var(--ag-text-secondary);line-height:1.5;max-height:130px;overflow-y:auto;white-space:pre-wrap;margin-bottom:9px}
    .update-pop-footer{display:flex;align-items:center;justify-content:flex-end;gap:6px}

    .heat-preset-bar{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin:6px 0 8px}
    .heat-preset-group{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
    .heat-preset-btn{
      display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:6px;white-space:nowrap;
      border:1px solid var(--ag-border-card);background:var(--ag-bg-subcard);color:var(--ag-text-secondary);
      font-size:12px;cursor:pointer;transition:border-color .12s ease,color .12s ease,transform .08s ease;
    }
    .heat-preset-btn:hover{color:var(--ag-text-primary);border-color:var(--ag-btn-border-hover)}
    .heat-preset-btn:active{transform:scale(0.975) translateY(0.5px)}
    .heat-preset-btn[data-active="true"]{
      color:var(--ag-text-primary);border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default));
      font-weight:600;
    }
    .heat-preset-dots{display:inline-flex;gap:2px}
    .heat-preset-dots i{width:7px;height:7px;border-radius:1.5px;display:inline-block}

    .heat-leg-swatch{
      width:11px;height:11px;padding:0;border-radius:2.5px;
      border:1px solid var(--ag-border-card);
      background:var(--swatch-color,var(--ag-heat-lvl-0));
      cursor:pointer;flex-shrink:0;
      transition:border-color .12s ease,box-shadow .12s ease;
    }
    .heat-leg-swatch:hover{
      z-index:2;
      border-color:var(--ag-text-primary);
      box-shadow:0 0 0 1px var(--ag-text-primary);
    }
    .heat-leg-swatch[data-custom="true"]{
      border-color:var(--ag-text-secondary);
    }

    .heat-lvl-custom-bar{
      margin:6px 0 8px;padding:7px 8px;border-radius:7px;
      background:var(--ag-bg-card);border:1px solid var(--ag-border-card);
    }
    .heat-lvl-custom-hdr{
      display:flex;align-items:center;justify-content:space-between;gap:6px;
      margin-bottom:6px;flex-wrap:wrap;
    }
    .heat-lvl-grid{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:6px;
    }
    .heat-lvl-item{
      display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0;
      padding:5px 7px;border-radius:6px;
      background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);
    }
    .heat-lvl-lbl{
      font-size:11.5px;color:var(--ag-text-secondary);font-weight:500;min-width:0;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }

    .heat-popover{position:fixed;pointer-events:none;background:var(--ag-pop-bg);border:1px solid var(--ag-pop-border);border-radius:8px;padding:8px 12px;box-shadow:var(--ag-pop-shadow);z-index:2147483647;opacity:0;transform:translate(-50%,-100%) translateY(-6px);transition:opacity .12s ease;font-variant-numeric:tabular-nums}
    .pop-date{font-size:12px;color:var(--ag-pop-muted)}
    .pop-val{font-size:14px;font-weight:600;color:var(--ag-pop-text);margin:2px 0 4px}
    .pop-det{font-size:11.5px;color:var(--ag-pop-sub);margin-top:2px;display:flex;gap:12px;align-items:flex-start}
    .pop-det-col{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px}
    .pop-det-val{font-size:11.5px;font-weight:500;color:var(--ag-pop-sub);font-variant-numeric:tabular-nums;white-space:nowrap}
    .pop-det-trans{font-size:9.5px;color:var(--ag-pop-muted);opacity:0.88;white-space:nowrap;line-height:1.2}

    /* 模型选择器（模型设置页内） & 分页栏 */
    .ctx-header-model-ctrl{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;flex-wrap:wrap}
    .ctx-models-toolbar{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:8px 10px;margin-bottom:8px}
    .ctx-selector-role-lbl{font-size:12px;color:var(--ag-text-muted);white-space:nowrap;flex-shrink:0}
    .ctx-header-dropdown{flex:1 1 160px;min-width:0;max-width:100%}
    .ctx-compact-trigger{padding:5px 9px!important;font-size:12px!important;max-width:100%}
    .ctx-compact-trigger .ag-dropdown-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
    .ctx-model-dropdown-menu{min-width:220px;max-width:100%;left:0;right:auto}
    .ctx-card-details-drawer{border-top:1px solid var(--ag-border-subtle);padding-top:6px;margin-top:2px}
    .ctx-card-drawer-trigger{font-size:12px;padding:3px 0}
    .ctx-card-drawer-body{padding-top:6px}
    .ctx-model-group-hdr.is-history-hdr{margin-top:4px;border-top:1px solid var(--ag-border-subtle);padding-top:6px;opacity:0.88}
    .ctx-product-row-history-tag{font-size:11px;padding:0 5px;border-radius:4px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-muted);flex-shrink:0}
    .ctx-mini-link-btn{background:none;border:0;color:var(--ag-link,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)));font-size:11.5px;padding:2px 4px;cursor:pointer;white-space:nowrap;text-decoration:underline;text-underline-offset:2px}
    .ctx-mini-link-btn[hidden]{display:none!important}
    .ag-dropdown-group-title{display:flex;align-items:center;gap:6px;padding:5px 8px 3px;font-size:11.5px;font-weight:600;color:var(--ag-text-muted);letter-spacing:0;cursor:default;user-select:none;border-top:1px solid var(--ag-border-subtle);margin-top:3px}
    .ag-dropdown-group-title:first-child{border-top:0;margin-top:0}
    .ag-vendor-dot{width:7px;height:7px;border-radius:999px;display:inline-block;flex-shrink:0;background:var(--ag-text-muted)}
    .ag-dropdown-badge{font-size:11px;padding:0 5px;border-radius:9px;background:var(--ag-accent-bg,rgba(167,139,250,0.14));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));margin-left:4px;flex-shrink:0}

    .ctx-tabs-bar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:10px;padding:4px;margin-bottom:9px;box-sizing:border-box;width:100%}
    .ctx-tab-btn{display:flex;align-items:center;justify-content:center;min-width:0;border:1px solid transparent;background:transparent;color:var(--ag-text-muted);font-size:12.5px;font-weight:500;padding:6px 4px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background-color .15s var(--ag-ease-out),color .15s ease,border-color .15s ease,transform .08s ease}
    .ctx-tab-btn:hover{color:var(--ag-text-primary);background:var(--ag-toolbar-bg-hover)}
    .ctx-tab-btn:active{background:var(--ag-toolbar-bg-active);transform:scale(0.975) translateY(0.5px)}
    .ctx-tab-btn:focus-visible{outline:2px solid var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));outline-offset:1px}
    .ctx-tab-btn.active{background:var(--ag-unified-bg);color:var(--ag-text-primary);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,0.28);border:1px solid var(--ag-border-card)}
    :host([data-theme="light"]) .ctx-tab-btn.active,
    :host([data-panel-tone="light"]) .ctx-tab-btn.active{box-shadow:0 1px 3px rgba(0,0,0,0.12);border-color:rgba(0,0,0,0.12)}

    .ctx-lang-top-segmented{display:inline-flex;align-items:center;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:2px;gap:2px;flex-shrink:0;vertical-align:middle;margin-right:2px}
    .ctx-lang-top-segmented .ctx-seg-btn{border:1px solid transparent;background:transparent;color:var(--ag-text-muted);font-size:11.5px;font-weight:500;padding:2px 7px;border-radius:4px;cursor:pointer;line-height:16px;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .08s ease}
    .ctx-lang-top-segmented .ctx-seg-btn:hover{color:var(--ag-text-primary);background:var(--ag-toolbar-bg-hover)}
    .ctx-lang-top-segmented .ctx-seg-btn:active{transform:scale(0.975) translateY(0.5px)}
    .ctx-lang-top-segmented .ctx-seg-btn:focus-visible{outline:2px solid var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));outline-offset:1px}
    .ctx-lang-top-segmented .ctx-seg-btn.active{background:var(--ag-unified-bg);color:var(--ag-text-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.2);border:1px solid var(--ag-border-card)}

    .ag-modal-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(3px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;animation:agFadeIn .15s ease-out}
    :host([data-theme="light"]) .ag-modal-overlay,
    :host([data-panel-tone="light"]) .ag-modal-overlay{background:rgba(0,0,0,0.35)}
    .ag-modal-overlay[hidden]{display:none !important}
    .ag-modal-card{background:var(--ag-bg-panel);border:1px solid var(--ag-border-panel);border-radius:10px;padding:16px 18px;max-width:340px;width:100%;box-shadow:var(--ag-shadow-panel),var(--ag-inset-highlight);display:flex;flex-direction:column;gap:12px}
    .ag-modal-title{font-size:14px;font-weight:600;color:var(--ag-text-primary);text-wrap:balance}
    .ag-modal-body{font-size:12.5px;line-height:1.55;color:var(--ag-text-secondary);text-wrap:pretty}
    .ag-modal-feedback{font-size:12px;line-height:1.45;padding:6px 8px;border-radius:5px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary)}
    .ag-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
    .ctx-brand-feedback{font-size:12px;margin-top:6px;padding:5px 8px;border-radius:5px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary)}
    .ctx-tab-pane[hidden]{display:none!important}

    /* 当前会话紧凑卡片 */
    .ctx-compact-card{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:9px 11px;margin:8px 0 4px}
    .ctx-compact-info{min-width:0;display:flex;flex-direction:column;gap:3px}
    .ctx-compact-title{font-size:12.5px;font-weight:600;color:var(--ag-text-primary)}
    .ctx-compact-meta{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;color:var(--ag-text-secondary)}
    .ctx-compact-meta strong{color:var(--ag-text-primary);font-weight:600}
    .ctx-compact-link-btn{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:background-color .14s ease,border-color .14s ease,transform .08s ease}
    .ctx-compact-link-btn:hover{background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    .ctx-compact-link-btn:active{transform:scale(0.975) translateY(0.5px)}

    /* 模型设置页：全局状态条 */
    .ctx-status-bar{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:8px 10px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}
    .ctx-status-bar-main{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .ctx-status-left{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
    .ctx-client-status-text{font-size:12px;font-weight:600;color:var(--ag-text-primary)}
    .ctx-restart-btn[hidden],.ctx-restart-confirm[hidden],.ctx-manual-restart-note[hidden],.ctx-restart-feedback[hidden],.ctx-status-subnote[hidden]{display:none!important}
    .ctx-status-subnote{font-size:11.5px;color:var(--ag-text-warn,#fbbf24);line-height:1.45}
    .ctx-manual-restart-note{font-size:11.5px;color:var(--ag-text-secondary);background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:5px;padding:6px 8px;line-height:1.45}
    .ctx-restart-confirm{background:rgba(234,179,8,0.09);border:1px solid rgba(234,179,8,0.3);border-radius:6px;padding:7px 9px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .ctx-restart-confirm-text{font-size:12px;color:var(--ag-text-primary);line-height:1.45;flex:1;min-width:170px}
    .ctx-restart-confirm-actions{display:flex;gap:6px;align-items:center}
    .ctx-restart-feedback{font-size:11.5px;color:var(--ag-link,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)));line-height:1.45}

    /* 模式选择器（统一设置 vs 按模型分别设置） */
    .ctx-scope-selector-wrap{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:10px;padding:4px;margin-bottom:8px}
    .ctx-scope-mode-toggle{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .ctx-mode-tab-btn{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:2px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:7px 9px;cursor:pointer;color:var(--ag-text-secondary);min-width:0;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .08s ease}
    .ctx-mode-tab-btn:hover{background:var(--ag-btn-hover);color:var(--ag-text-primary)}
    .ctx-mode-tab-btn:active{transform:scale(0.985) translateY(0.5px)}
    .ctx-mode-tab-btn.is-active{background:var(--ag-accent-bg,rgba(167,139,250,0.14));border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));color:var(--ag-text-primary)}
    .ctx-mode-tab-title{font-size:12px;font-weight:600;color:var(--ag-text-primary)}
    .ctx-mode-tab-desc{font-size:11.5px;color:var(--ag-text-muted);line-height:1.45}

    /* 厂商分组模型列表 */
    .ctx-model-list{display:flex;flex-direction:column;gap:6px;max-height:185px;overflow-y:auto;overflow-anchor:none;background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:7px;margin-bottom:8px}
    .ctx-model-group{display:flex;flex-direction:column;gap:3px}
    .ctx-model-group-hdr{display:flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--ag-text-muted);padding:2px 4px}
    .ctx-product-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:6px;padding:6px 8px;cursor:pointer;color:var(--ag-text-secondary);font-size:12px;transition:background .12s ease,border-color .12s ease}
    .ctx-product-row:hover{background:var(--ag-btn-hover);color:var(--ag-text-primary)}
    .ctx-product-row.is-active{background:var(--ag-accent-bg,rgba(167,139,250,0.14));border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));color:var(--ag-text-primary);font-weight:600}
    .ctx-product-row.is-unavailable{opacity:0.65}
    .ctx-product-row-unavailable-tag{font-size:11px;padding:0 5px;border-radius:4px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:var(--ag-text-danger,#f87171);flex-shrink:0}
    :host([data-theme="light"]) .ctx-product-row-unavailable-tag,
    :host([data-panel-tone="light"]) .ctx-product-row-unavailable-tag{color:var(--ag-text-danger,#dc2626)}
    .ctx-product-row-notice-tag{font-size:11px;padding:0 5px;border-radius:4px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);color:var(--ag-text-warn,#fbbf24);flex-shrink:0}
    :host([data-theme="light"]) .ctx-product-row-notice-tag,
    :host([data-panel-tone="light"]) .ctx-product-row-notice-tag{color:var(--ag-text-warn,#b45309)}
    .ctx-product-row-left{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden}
    .ctx-product-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ctx-product-row-right{display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11.5px;color:var(--ag-text-muted);font-variant-numeric:tabular-nums}
    .ctx-product-row-val.is-conflict{color:var(--ag-text-warn,#fbbf24);font-weight:600}

    /* 模型列表 / 下拉 / 卡片小额度圆环芯片 */
    .ctx-model-quota-chip{display:inline-flex;align-items:center;gap:4px;padding:1.5px 7px 1.5px 5px;border-radius:999px;background:rgba(127,127,127,0.10);border:1px solid rgba(127,127,127,0.18);font-size:11px;font-weight:600;line-height:15px;font-variant-numeric:tabular-nums;color:var(--ag-text-secondary);white-space:nowrap;flex-shrink:0;transition:border-color .18s ease,background-color .18s ease,color .18s ease}
    .ctx-model-quota-chip.is-dropdown{padding:1px 6px 1px 4px;font-size:11px}
    .ctx-model-quota-chip.is-card{padding:2px 7px 2px 5px;font-size:11.5px}
    .ctx-quota-ring-svg{width:13px;height:13px;display:block;flex-shrink:0;overflow:visible}
    .ctx-quota-ring-track{stroke:var(--ag-custom-ring-track,var(--ag-ring-track-default))}
    .ctx-quota-ring-fill{stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));transition:stroke-dashoffset .24s cubic-bezier(0.22,1,0.36,1),stroke .18s ease,opacity .15s ease}
    .ctx-model-quota-chip[data-quota-state="available"]{background:var(--ag-accent-bg,rgba(167,139,250,0.14));border-color:var(--ag-accent-border,rgba(167,139,250,0.34));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .ctx-model-quota-chip[data-quota-state="available"] .ctx-quota-ring-fill{stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .ctx-model-quota-chip[data-quota-state="low"]{background:rgba(245,158,11,0.11);border-color:rgba(245,158,11,0.32);color:var(--ag-text-warn,#fbbf24)}
    .ctx-model-quota-chip[data-quota-state="low"] .ctx-quota-ring-fill{stroke:#f59e0b}
    .ctx-model-quota-chip[data-quota-state="exhausted"]{background:rgba(239,68,68,0.11);border-color:rgba(239,68,68,0.32);color:var(--ag-text-danger,#f87171)}
    .ctx-model-quota-chip[data-quota-state="exhausted"] .ctx-quota-ring-fill{stroke:#ef4444}
    .ctx-model-quota-chip[data-quota-state="no_permission"]{background:rgba(168,85,247,0.11);border-color:rgba(168,85,247,0.30);color:#c084fc}
    .ctx-model-quota-chip[data-quota-state="no_permission"] .ctx-quota-ring-fill{stroke:#a855f7}
    .ctx-model-quota-chip[data-quota-state="stale"]{background:rgba(234,179,8,0.10);border-color:rgba(234,179,8,0.30);color:#facc15}
    .ctx-model-quota-chip[data-quota-state="stale"] .ctx-quota-ring-fill{stroke:#eab308;opacity:0.85}
    .ctx-model-quota-chip[data-quota-state="error"]{background:rgba(249,115,22,0.10);border-color:rgba(249,115,22,0.30);color:#fb923c}
    .ctx-model-quota-chip[data-quota-state="error"] .ctx-quota-ring-fill{stroke:#f97316}
    .ctx-model-quota-chip[data-quota-state="unknown"]{background:rgba(127,127,127,0.08);border-color:rgba(127,127,127,0.20);color:var(--ag-text-muted)}
    .ctx-model-quota-chip[data-quota-state="unknown"] .ctx-quota-ring-fill{stroke:var(--ag-text-muted);opacity:0.65}
    :host([data-theme="light"]) .ctx-quota-ring-fill,
    :host([data-panel-tone="light"]) .ctx-quota-ring-fill{stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="available"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="available"]{background:var(--ag-accent-bg,rgba(124,58,237,0.10));border-color:var(--ag-accent-border,rgba(124,58,237,0.28));color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="available"] .ctx-quota-ring-fill,
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="available"] .ctx-quota-ring-fill{stroke:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="low"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="low"]{color:var(--ag-text-warn,#b45309)}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="exhausted"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="exhausted"]{color:var(--ag-text-danger,#dc2626)}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="no_permission"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="no_permission"]{color:#7e22ce}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="stale"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="stale"]{color:#a16207}
    :host([data-theme="light"]) .ctx-model-quota-chip[data-quota-state="error"],
    :host([data-panel-tone="light"]) .ctx-model-quota-chip[data-quota-state="error"]{color:#ea580c}
    .ctx-card-vendor-left{display:inline-flex;align-items:center;gap:6px;min-width:0}
    .ctx-card-quota-slot{display:inline-flex;align-items:center;margin-left:auto;flex-shrink:0}
    .ctx-card-quota-slot[hidden]{display:none!important}

    /* 模型大卡片 */
    .ctx-detail-card{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:11px 12px;margin-bottom:8px;display:flex;flex-direction:column;gap:8px}
    .ctx-conflict-banner{background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.34);border-radius:6px;padding:7px 9px;display:flex;flex-direction:column;gap:5px}
    .ctx-conflict-banner[hidden]{display:none!important}
    .ctx-conflict-title{font-size:12px;font-weight:600;color:var(--ag-text-warn,#fbbf24)}
    .ctx-conflict-rows{display:flex;flex-direction:column;gap:4px}
    .ctx-conflict-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--ag-text-primary);min-width:0}
    .ctx-conflict-btn{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary);border-radius:4px;padding:2px 8px;font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .08s ease}
    .ctx-conflict-btn:hover{background:var(--ag-btn-hover);border-color:var(--ag-btn-border-hover)}
    .ctx-conflict-btn:active{transform:scale(0.975) translateY(0.5px)}

    .ctx-card-top{display:flex;flex-direction:column;gap:3px;min-width:0}
    .ctx-card-vendor-row{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11.5px;color:var(--ag-text-muted)}
    .ctx-card-product-name{font-size:14.5px;font-weight:600;color:var(--ag-text-primary);line-height:1.3;overflow-wrap:anywhere;word-break:break-word;text-wrap:balance}
    .ctx-card-efforts-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--ag-text-secondary)}
    .ctx-card-session-effort{font-weight:600;color:var(--ag-link,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)))}
    .ctx-card-session-effort[hidden]{display:none!important}

    /* 精简主界面三项高亮网格 */
    .ctx-summary-highlight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px}
    .ctx-summary-item{display:flex;flex-direction:column;gap:2px;min-width:0}
    .ctx-summary-item-length{grid-column:1 / -1;border-top:1px solid var(--ag-border-subtle);padding-top:6px;margin-top:2px}
    .ctx-summary-label{font-size:11.5px;font-weight:500;color:var(--ag-text-muted)}
    .ctx-summary-value{font-size:12.5px;font-weight:600;color:var(--ag-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ctx-summary-length-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .ctx-length-val{font-size:13.5px;color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}

    .ctx-card-metrics{display:flex;flex-direction:column;gap:5px}
    .ctx-metric-row{display:grid;grid-template-columns:64px minmax(0,1fr) auto;align-items:start;gap:6px 8px;padding:6px 9px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-left-width:3px;border-radius:5px;font-size:12px}
    .ctx-metric-saved{border-left-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .ctx-metric-request{border-left-color:var(--ag-custom-speed,var(--ag-speed-default,#b8b8c0))}
    .ctx-metric-client{border-left-color:var(--ag-text-muted)}
    .ctx-metric-observed{border-left-color:var(--ag-custom-speed,var(--ag-speed-default,#b8b8c0))}
    .ctx-metric-convo{border-left-color:var(--ag-text-muted)}
    .ctx-metric-diagnosis{border-left-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    .ctx-metric-diagnosis-val{font-size:12px;font-weight:500;line-height:1.45}
    .ctx-metric-diagnosis-val.is-confirmed{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))}
    :host([data-theme="light"]) .ctx-metric-diagnosis,
    :host([data-panel-tone="light"]) .ctx-metric-diagnosis{border-left-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    :host([data-theme="light"]) .ctx-metric-diagnosis-val.is-confirmed,
    :host([data-panel-tone="light"]) .ctx-metric-diagnosis-val.is-confirmed{color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed))}
    .ctx-metric-diagnosis-val.is-mismatch{color:var(--ag-text-danger,#f87171)}
    .ctx-metric-diagnosis-val.is-dispatched_pending_confirm,
    .ctx-metric-diagnosis-val.is-saved_pending_dispatch{color:var(--ag-text-warn,#fbbf24)}
    .ctx-metric-label{font-size:12px;color:var(--ag-text-muted);font-weight:500;padding-top:1px}
    .ctx-metric-value{font-size:12px;font-weight:600;color:var(--ag-text-primary);display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
    .ctx-metric-value-col{display:flex;flex-direction:column;gap:3px;min-width:0}
    .ctx-metric-side{font-size:11.5px;color:var(--ag-text-muted);white-space:nowrap;padding-top:2px}
    .ctx-metric-pre-restart{font-size:11.5px;color:var(--ag-text-muted);opacity:0.85}
    .ctx-metric-pre-restart[hidden],.ctx-metric-service-limit[hidden],.ctx-card-hints[hidden],.ctx-reset-notice[hidden]{display:none!important}
    .ctx-metric-service-limit{font-size:11.5px;color:var(--ag-text-warn,#fbbf24);font-weight:500}
    .ctx-speed-effort-lines{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--ag-text-secondary);font-variant-numeric:tabular-nums}
    .ctx-inline-link-btn{background:none;border:0;padding:0;color:var(--ag-link,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)));font-size:12px;font-weight:500;cursor:pointer;text-align:left;align-self:flex-start}
    .ctx-inline-link-btn:hover{text-decoration:underline}
    .ctx-card-hints{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--ag-border-subtle);padding-top:6px;font-size:12px;color:var(--ag-text-secondary);line-height:1.45}
    .ctx-card-hint-item{padding:6px 9px;background:var(--ag-bg-subcard);border-radius:6px;border:1px solid var(--ag-border-subcard)}

    /* 设置操作区 */
    .ctx-adjust-box{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:10px 11px;display:flex;flex-direction:column;gap:7px}
    .ctx-small-label{font-size:12px;color:var(--ag-text-muted)}
    .ctx-model-select{background:var(--ag-bg-card);color:var(--ag-text-primary);border:1px solid var(--ag-border-subcard);border-radius:5px;padding:4px 7px;font-size:12px;width:100%;outline:none}
    .ctx-preset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    .ctx-preset-btn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:7px 9px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .08s ease;color:var(--ag-text-primary)}
    .ctx-preset-btn:hover:not(:disabled){background:var(--ag-bg-card-hover);border-color:var(--ag-text-muted)}
    .ctx-preset-btn:active:not(:disabled){transform:scale(0.975) translateY(0.5px)}
    .ctx-preset-btn.active{border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));background:var(--ag-accent-bg,rgba(167,139,250,0.14))}
    .ctx-preset-btn:disabled,.ctx-preset-btn.is-disabled{opacity:0.48;cursor:not-allowed;border-style:dashed}
    .ctx-preset-title{font-size:12px;font-weight:600;color:var(--ag-text-primary)}
    .ctx-preset-sub{font-size:11.5px;color:var(--ag-text-secondary);line-height:1.45}
    .ctx-cap-ref-card{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;margin-top:2px}
    .ctx-cap-ref-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 10px}
    .ctx-cap-item{display:flex;flex-direction:column;gap:1px;min-width:0}
    .ctx-cap-item-wide{grid-column:1 / -1;border-top:1px solid var(--ag-border-subtle);padding-top:4px;margin-top:1px}
    .ctx-cap-lbl{font-size:11.5px;color:var(--ag-text-muted);font-weight:500}
    .ctx-cap-val{font-size:12px;font-weight:600;color:var(--ag-text-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .ctx-cap-sub{font-size:11.5px;color:var(--ag-text-secondary);line-height:1.45}
    .ctx-cap-verify-strip{display:flex;flex-wrap:wrap;gap:6px 12px;border-top:1px solid var(--ag-border-subtle);padding-top:5px;font-size:11.5px;color:var(--ag-text-secondary)}
    .ctx-cap-v-cell{display:inline-flex;align-items:center;gap:4px;min-width:0}
    .ctx-cap-v-cell em{font-style:normal;color:var(--ag-text-muted)}
    .ctx-cap-v-cell strong{font-weight:600;color:var(--ag-text-primary);font-variant-numeric:tabular-nums}
    .ctx-unified-proj{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--ag-border-subtle);padding-top:5px;font-size:11.5px}
    .ctx-unified-proj-title{font-weight:600;color:var(--ag-text-primary);margin-bottom:1px}
    .ctx-unified-proj-row{display:flex;justify-content:space-between;gap:8px;color:var(--ag-text-secondary);font-variant-numeric:tabular-nums}
    .ctx-unified-proj-row.is-clamped strong{color:var(--ag-text-warn,#fbbf24)}
    .ctx-custom-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:1px}
    .ctx-custom-input-wrap{display:flex;align-items:center;flex:1;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:0 8px}
    .ctx-custom-input-wrap:focus-within{border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24))}
    .ctx-custom-input{flex:1;min-width:0;background:transparent;border:none;color:var(--ag-text-primary);font-size:12px;padding:6px 0;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    .ctx-input-unit{font-size:11.5px;color:var(--ag-text-muted);margin-left:4px}
    .ctx-validation-msg{font-size:11.5px;color:var(--ag-text-secondary);line-height:1.45}
    .ctx-validation-msg.is-error{color:var(--ag-text-danger,#f87171);font-weight:500}
    .ctx-validation-msg.is-warn{color:var(--ag-text-warn,#fbbf24)}
    .ctx-pref-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px}
    .ctx-text-action-btn{background:none;border:0;color:var(--ag-text-muted);font-size:12px;padding:4px 6px;white-space:nowrap;cursor:pointer;text-decoration:underline;text-underline-offset:2px;transition:color .12s ease,transform .08s ease}
    .ctx-text-action-btn:hover{color:var(--ag-text-primary)}
    .ctx-text-action-btn:active{transform:scale(0.975)}
    .ctx-reset-notice{font-size:11.5px;color:var(--ag-text-warn,#fbbf24);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.24);border-radius:6px;padding:6px 9px;line-height:1.45}
    .ctx-plain-help{font-size:11.5px;color:var(--ag-text-muted);line-height:1.45;border-top:1px solid var(--ag-border-subtle);padding-top:6px;text-wrap:pretty}
    .ctx-detail-ol{padding-left:16px}

    /* 速度对比分页与 SVG 图表 */
    .ctx-speed-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:8px}
    .ctx-segmented{display:inline-flex;align-items:center;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:2px;gap:2px}
    .ctx-seg-btn{border:0;background:transparent;color:var(--ag-text-muted);font-size:11.5px;font-weight:500;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;transition:background-color .12s ease,color .12s ease,transform .08s ease}
    .ctx-seg-btn:hover{color:var(--ag-text-primary);background:var(--ag-toolbar-bg-hover)}
    .ctx-seg-btn:active{transform:scale(0.975)}
    .ctx-seg-btn.active{background:var(--ag-unified-bg);color:var(--ag-text-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,0.2)}
    .ctx-chart-card{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:9px 10px;margin-bottom:8px;display:flex;flex-direction:column;gap:7px}
    .ctx-chart-header{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
    .ctx-chart-title{font-size:12.5px;font-weight:600;color:var(--ag-text-primary);text-wrap:balance}
    .ctx-speed-dropdown{min-width:170px;max-width:250px;flex:1}
    .ctx-svg-wrap{width:100%;overflow:hidden}
    .ctx-speed-svg{display:block;width:100%;height:auto;font-family:inherit}
    .ctx-chart-tooltip{position:absolute;z-index:30;pointer-events:none;background:var(--ag-pop-bg);border:1px solid var(--ag-pop-border);border-radius:6px;padding:6px 9px;box-shadow:var(--ag-pop-shadow);font-size:11.5px;color:var(--ag-pop-text);line-height:1.45;max-width:220px}
    .ctx-chart-tooltip[hidden]{display:none!important}
    .ctx-chart-note{font-size:11.5px;color:var(--ag-text-muted);line-height:1.45;text-wrap:pretty}
    .ctx-speed-empty{font-size:12px;color:var(--ag-text-muted);text-align:center;padding:18px 8px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px}
    .ctx-speed-empty[hidden],.ctx-svg-wrap[hidden]{display:none!important}
    .ctx-active-test-note{font-size:11.5px;color:var(--ag-text-muted);background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:7px 9px;line-height:1.45;text-wrap:pretty}

    /* 设置视图 */
    .ctx-settings-header{display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--ag-border-subtle)}
    .ctx-back-btn{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,transform .08s ease}
    .ctx-back-btn:hover{background:var(--ag-btn-hover)}
    .ctx-back-btn:active{transform:scale(0.975) translateY(0.5px)}
    .ctx-settings-title{font-size:13px;font-weight:600;color:var(--ag-text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ctx-settings-card{background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:10px 11px;margin-bottom:8px;display:flex;flex-direction:column;gap:7px}
    .ctx-settings-card-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .ctx-settings-card-title{font-size:13px;font-weight:600;color:var(--ag-text-primary);text-wrap:balance}
    .ctx-settings-card-desc{font-size:12px;color:var(--ag-text-muted);line-height:1.5;text-wrap:pretty}
    .ctx-lang-segmented{display:flex;width:100%;box-sizing:border-box}
    .ctx-lang-segmented .ctx-seg-btn{flex:1 1 0;min-width:0;text-align:center;padding:5px 8px;font-size:12px}
    .ctx-client-lang-note{font-size:11.5px;color:var(--ag-text-muted);background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:6px 8px;margin-top:8px;line-height:1.5;text-wrap:pretty}
    .ctx-pref-actions{flex-wrap:wrap}
    .ctx-preset-btn{min-width:0}
    .ctx-preset-sub{overflow-wrap:anywhere}
    .ctx-metric-label{flex-shrink:0}
    .ctx-metric-value,.ctx-metric-side{min-width:0;overflow-wrap:anywhere}

    /* 结果框内联重启操作区与增强设置中心 */
    .unlock-result-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}
    .unlock-result-actions[hidden],.ctx-enhance-confirm[hidden],.ctx-preset-preview-box[hidden]{display:none!important}
    .ctx-result-manual-note{font-size:11.5px;color:var(--ag-text-secondary);line-height:1.45;margin-top:4px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:5px;padding:5px 8px}
    .ctx-selector-hint{font-size:11.5px;color:var(--ag-text-muted);line-height:1.45;margin-top:4px;text-wrap:pretty}

    .ctx-settings-card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px}
    .ctx-enhance-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:2px 0}
    .ctx-enhance-stat{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:7px 9px;min-width:0}
    .ctx-enhance-stat-lbl{font-size:11.5px;color:var(--ag-text-muted);margin-bottom:2px}
    .ctx-enhance-stat-val{font-size:12px;font-weight:600;color:var(--ag-text-primary);overflow-wrap:anywhere}

    .ctx-tier-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
    .ctx-tier-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 4px;border-radius:6px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-secondary);cursor:pointer;text-align:center;min-width:0;transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .08s ease}
    .ctx-tier-btn:hover{background:var(--ag-bg-card-hover);color:var(--ag-text-primary);border-color:var(--ag-btn-border-hover)}
    .ctx-tier-btn:active{transform:scale(0.975) translateY(0.5px)}
    .ctx-tier-btn.active{background:var(--ag-accent-bg,rgba(167,139,250,0.14));border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));color:var(--ag-text-primary);font-weight:600}
    .ctx-tier-num{font-size:12px;font-weight:600;line-height:1.2}
    .ctx-tier-name{font-size:11.5px;line-height:1.35;overflow-wrap:anywhere}

    .ctx-tier-matrix{background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.45}
    .ctx-tier-matrix-title{font-weight:600;color:var(--ag-text-primary);margin-bottom:1px}
    .ctx-tier-matrix-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:6px;align-items:start}
    .ctx-tier-matrix-k{font-weight:600;color:var(--ag-text-muted);white-space:nowrap}
    .ctx-tier-matrix-v{color:var(--ag-text-secondary);overflow-wrap:anywhere}
    .ctx-tier-note-warn{font-size:11.5px;color:var(--ag-text-muted);background:rgba(234,179,8,0.07);border:1px solid rgba(234,179,8,0.22);border-radius:5px;padding:6px 9px;line-height:1.45;text-wrap:pretty}

    .ctx-toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:7px 9px;cursor:pointer}
    .ctx-toggle-row-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
    .ctx-toggle-row-title{font-size:12px;font-weight:600;color:var(--ag-text-primary)}
    .ctx-toggle-row-sub{font-size:11.5px;color:var(--ag-text-muted);line-height:1.45}

    .ctx-preset-checklist{display:flex;flex-direction:column;gap:5px}
    .ctx-preset-check-item{display:flex;align-items:flex-start;gap:7px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px;padding:6px 8px;cursor:pointer;font-size:12px;line-height:1.45}
    .ctx-preset-check-item input[type="checkbox"]{margin-top:2px;flex-shrink:0}
    .ctx-preset-check-meta{display:flex;flex-direction:column;gap:1px;min-width:0}
    .ctx-preset-check-meta strong{color:var(--ag-text-primary);font-size:12px}
    .ctx-preset-check-meta span{color:var(--ag-text-muted);font-size:11.5px}

    .ctx-enhance-confirm{background:rgba(234,179,8,0.09);border:1px solid rgba(234,179,8,0.32);border-radius:6px;padding:7px 9px;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.45;color:var(--ag-text-primary)}
    .ctx-enhance-confirm-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .unlock-btn-danger{background:rgba(239,68,68,0.12);color:var(--ag-text-danger,#f87171);border:1px solid rgba(239,68,68,0.35)}
    .unlock-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.2)}
    :host([data-theme="light"]) .unlock-btn-danger,
    :host([data-panel-tone="light"]) .unlock-btn-danger{color:var(--ag-text-danger,#dc2626)}

    @media (max-width:440px){
      .ctx-preset-grid{grid-template-columns:minmax(0,1fr)}
      .ctx-tier-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
      .ctx-enhance-status-grid{grid-template-columns:minmax(0,1fr)}
      .color-grid{grid-template-columns:minmax(0,1fr)}
    }
    @media (prefers-reduced-motion: reduce){
      *,.ag-unit,.ring-fill,.quota-ring-fill,.ctx-quota-ring-fill,.ctx-model-quota-chip,.quota-bar-fill,.quota-bar-charge-stage,.quota-bar-charge-fill,.quota-bar-charge-sheen,.quota-refresh-icon,.key-bar-fill,.ag-panel,#context-tooltip,.heat-cell,.w-bar-fill{
        transition:none!important;animation:none!important;
      }
      .quota-bar-charge-stage{display:none!important}
    }
    @media(max-width:800px){
      #panel{width:calc(100vw - 24px)}
      #panel-tokens:not(.cost-compact-view){width:calc(100vw - 24px)}
    }

    /* Ultra 子档首屏快捷下拉胶囊 */
    .ag-subtier-compact-wrap{
      position:relative;
      width:auto;
      flex-shrink:0;
    }
    .ag-subtier-compact-trigger{
      width:auto;
      height:auto;
      min-height:0;
      padding:3px 9px;
      gap:4px;
      border-radius:999px;
      font-size:11.5px;
      font-weight:600;
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .ag-subtier-compact-trigger:hover{
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
      color:var(--ag-text-primary);
    }
    :host([data-theme="light"]) .ag-subtier-compact-trigger,
    :host([data-panel-tone="light"]) .ag-subtier-compact-trigger{
      background:var(--ag-accent-bg,rgba(124,58,237,0.10));
      border-color:var(--ag-accent-border,rgba(124,58,237,0.28));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }
    :host([data-theme="light"]) .ag-subtier-compact-trigger:hover,
    :host([data-panel-tone="light"]) .ag-subtier-compact-trigger:hover{
      background:var(--ag-accent-bg-hover,rgba(124,58,237,0.18));
      border-color:var(--ag-accent-border-hover,rgba(124,58,237,0.48));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#7c3aed));
    }
    .ag-subtier-compact-menu{
      left:auto;
      right:0;
      min-width:290px;
    }
    .subtier-spec-pills{
      display:flex;
      flex-wrap:wrap;
      gap:4px;
    }

    @supports (corner-shape: superellipse(1.25)){
      .ag-panel,.ag-modal-card,#overflow-menu,.ag-dropdown-menu,#color-picker-popover,.update-popover,.heat-popover,#context-tooltip,#cli-launch-toast,.settings-card-box,.heatmap-section,.t-card,#key-summary,#speed-summary,.quota-current-card,.quota-pool-card,.ctx-detail-card,.ctx-adjust-box,.ctx-chart-card,.ctx-settings-card{
        corner-shape:superellipse(1.25);
      }
    }

    /* antigravity-suite 本地化裁剪覆盖（保留上游 DOM/JS 结构以便后续平滑同步上游版本） */
    #chinese-i18n-drawer,
    #btn-github-repo,
    #btn-github-repo-ctx,
    #btn-check-update,
    #btn-check-update-ctx,
    #auto-update-setting-row {
      display: none !important;
    }
/* ==================== 统一设置面板 (#panel-settings) ==================== */
    #badge-settings{
      position:relative;
    }
    #badge-settings[data-has-update="true"]::after{
      content:"";
      position:absolute;
      top:3px;
      right:3px;
      width:6px;
      height:6px;
      border-radius:999px;
      background:#f59e0b;
      box-shadow:0 0 0 1.5px var(--ag-bg-panel,#18181b);
    }
    #panel-settings{
      width:640px;
      max-width:calc(100vw - 24px);
    }
    #panel-settings .panel-header-bar{
      gap:8px;
      flex-wrap:wrap;
    }
    #panel-settings .panel-header-actions{
      gap:6px;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    #suite-ver-status{
      font-size:12px;
      font-weight:500;
      font-variant-numeric:tabular-nums;
      white-space:nowrap;
      cursor:pointer;
    }
    #suite-ver-status[data-state="update"]{
      color:var(--ag-text-warn,#fbbf24);
      background:rgba(245,158,11,0.14);
      border-color:rgba(245,158,11,0.38);
    }
    :host([data-theme="light"]) #suite-ver-status[data-state="update"],
    :host([data-panel-tone="light"]) #suite-ver-status[data-state="update"]{
      color:var(--ag-text-warn,#b45309);
      background:#fef3c7;
      border-color:#fcd34d;
    }
    #suite-ver-status[data-state="ok"]{
      color:var(--ag-text-secondary);
      background:var(--ag-bg-subcard);
      border-color:var(--ag-border-subcard);
    }
    :host([data-theme="light"]) #suite-ver-status[data-state="ok"],
    :host([data-panel-tone="light"]) #suite-ver-status[data-state="ok"]{
      color:var(--ag-text-secondary);
      background:var(--ag-bg-subcard);
      border-color:var(--ag-border-subcard);
    }
    #btn-suite-apply-update{
      font-size:12px;
      font-weight:500;
      padding:3px 9px;
      white-space:nowrap;
    }
    #btn-suite-apply-update[hidden]{
      display:none!important;
    }
    .settings-tabs-bar{
      display:grid;
      grid-template-columns:repeat(5,minmax(0,1fr));
      gap:4px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      border-radius:10px;
      padding:4px;
      margin-bottom:10px;
    }
    .settings-tab-btn{
      border:1px solid transparent;
      background:transparent;
      color:var(--ag-text-muted);
      font-size:12px;
      font-weight:500;
      padding:6px 4px;
      border-radius:6px;
      cursor:pointer;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      transition:background-color .15s var(--ag-ease-out,cubic-bezier(0.16,1,0.3,1)),color .15s ease,border-color .15s ease,transform .08s ease;
    }
    .settings-tab-btn:hover{
      color:var(--ag-text-primary);
      background:var(--ag-toolbar-bg-hover);
    }
    .settings-tab-btn:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .settings-tab-btn.active{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;
    }
    .settings-body{
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .settings-tab-pane[hidden]{
      display:none!important;
    }
    .settings-card-box{
      background:var(--ag-bg-card);
      border:1px solid var(--ag-border-card);
      border-radius:10px;
      padding:12px 14px;
      margin-bottom:10px;
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .settings-card-box:last-child{
      margin-bottom:0;
    }
    .settings-card-hdr{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
    }
    .settings-card-hdr-actions{
      display:inline-flex;
      align-items:center;
      gap:6px;
      flex-shrink:0;
      flex-wrap:wrap;
    }
    #btn-test-dock-badge,#btn-dock-open-ax{
      white-space:nowrap;
    }
    #btn-dock-open-ax[hidden]{
      display:none!important;
    }
    #dock-badge-status-note{
      flex:none;
      white-space:normal;
      overflow:visible;
      text-overflow:clip;
      padding:7px 10px;
      border-radius:7px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      color:var(--ag-text-secondary);
      font-size:12px;
      line-height:1.5;
      text-wrap:pretty;
    }
    #dock-badge-status-note[data-tone="ok"]{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-text-primary);
    }
    #dock-badge-status-note[data-tone="warn"]{
      background:var(--ag-bg-subcard);
      border-color:var(--ag-ring-warn,#f59e0b);
      color:var(--ag-text-warn,#fbbf24);
    }
    #dock-badge-status-note[data-tone="error"]{
      background:var(--ag-bg-subcard);
      border-color:var(--ag-ring-danger,#ef4444);
      color:var(--ag-text-danger,#f87171);
    }
    .settings-advanced-details{
      margin-top:4px;
      border-top:1px solid var(--ag-border-subtle);
      padding-top:8px;
    }
    .settings-advanced-details > summary{
      font-size:12px;
      font-weight:500;
      color:var(--ag-text-secondary);
      cursor:pointer;
      user-select:none;
      list-style:none;
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:6px 8px;
      border-radius:6px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      transition:background-color .14s ease,color .14s ease,border-color .14s ease;
    }
    .settings-advanced-details > summary::-webkit-details-marker{
      display:none;
    }
    .settings-advanced-details > summary:hover{
      color:var(--ag-text-primary);
      background:var(--ag-toolbar-bg-hover);
      border-color:var(--ag-btn-border-hover);
    }
    .settings-advanced-details[open] > summary{
      margin-bottom:8px;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
    }
    .settings-card-title-wrap{
      display:inline-flex;
      align-items:center;
      gap:6px;
      flex-wrap:wrap;
      min-width:0;
    }
    .settings-card-title{
      font-size:14px;
      font-weight:600;
      line-height:1.3;
      color:var(--ag-text-primary);
      text-wrap:balance;
    }
    .settings-card-desc{
      font-size:12px;
      color:var(--ag-text-muted);
      line-height:1.55;
      text-wrap:pretty;
    }
    .term-app-grid{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:6px;
    }
    .term-option-card{
      display:flex;
      flex-direction:column;
      gap:3px;
      padding:7px 9px;
      border-radius:7px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      text-align:left;
      cursor:pointer;
      transition:border-color .14s ease,background-color .14s ease,transform .08s ease;
    }
    .term-option-card:hover{
      border-color:var(--ag-btn-border-hover);
      background:var(--ag-btn-hover);
    }
    .term-option-card:active{
      transform:scale(0.985) translateY(0.5px);
    }
    .term-option-card[data-selected="true"]{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
    }
    .term-option-top{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:6px;
    }
    .term-option-name{
      font-size:13px;
      font-weight:500;
      color:var(--ag-text-primary);
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .term-option-card[data-selected="true"] .term-option-name{
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .term-option-badge{
      font-size:11px;
      font-weight:500;
      padding:1px 6px;
      border-radius:999px;
      flex-shrink:0;
      border:1px solid var(--ag-border-subcard);
      color:var(--ag-text-muted);
    }
    .term-option-badge[data-installed="true"]{
      color:var(--ag-text-secondary);
      background:var(--ag-bg-subcard);
      border-color:var(--ag-border-subcard);
    }
    :host([data-theme="light"]) .term-option-badge[data-installed="true"],
    :host([data-panel-tone="light"]) .term-option-badge[data-installed="true"]{
      color:var(--ag-text-secondary);
      background:var(--ag-bg-subcard);
      border-color:var(--ag-border-subcard);
    }
    .term-option-path{
      font-size:11.5px;
      color:var(--ag-text-muted);
      font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .term-custom-box{
      display:flex;
      flex-direction:column;
      gap:7px;
      padding:10px 12px;
      border-radius:8px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
    }
    .term-custom-box[data-active="true"]{
      border-style:solid;
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.45));
    }
    .settings-field-lbl{
      font-size:12px;
      color:var(--ag-text-secondary);
      font-weight:500;
    }
    .term-custom-row{
      display:flex;
      align-items:center;
      gap:6px;
      flex-wrap:wrap;
    }
    .settings-input{
      flex:1 1 220px;
      min-width:0;
      height:28px;
      min-height:28px;
      box-sizing:border-box;
      padding:0 8px;
      font-size:13px;
      line-height:26px;
      background:var(--ag-bg-input);
      border:1px solid var(--ag-border-subcard);
      color:var(--ag-text-primary);
      border-radius:6px;
      outline:none;
    }
    .settings-input:focus,
    .settings-input:focus-visible{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .settings-card-footer{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding-top:6px;
      border-top:1px solid var(--ag-border-subtle);
      flex-wrap:wrap;
    }
    .settings-status-note{
      font-size:12px;
      color:var(--ag-text-secondary);
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      flex:1;
    }
    .settings-pref-list{
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .settings-pref-row{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding:8px 10px;
      border-radius:7px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      transition:opacity .15s ease;
    }
    .settings-pref-row[data-disabled="true"]{
      opacity:.5;
      pointer-events:none;
    }
    #settings-card-codex-ui .settings-status-note{
      flex:none;
      white-space:normal;
      overflow:visible;
      text-overflow:clip;
      padding:7px 10px;
      border-radius:7px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      color:var(--ag-text-muted);
      font-size:12px;
      line-height:1.5;
      text-wrap:pretty;
    }
    .settings-pref-check{
      cursor:pointer;
    }
    .settings-pref-meta{
      display:flex;
      flex-direction:column;
      gap:3px;
      min-width:0;
      flex:1;
    }
    .settings-pref-name{
      font-size:13px;
      font-weight:500;
      color:var(--ag-text-primary);
    }
    .settings-pref-desc{
      font-size:12px;
      color:var(--ag-text-muted);
      line-height:1.5;
      text-wrap:pretty;
    }
    .settings-checkbox{
      -webkit-appearance:none;
      appearance:none;
      position:relative;
      width:32px;
      height:18px;
      margin:0;
      border-radius:999px;
      border:1px solid var(--ag-btn-border);
      background:var(--ag-track-bg,rgba(255,255,255,0.14));
      cursor:pointer;
      flex-shrink:0;
      vertical-align:middle;
      transition:background-color .18s var(--ag-ease-out,cubic-bezier(0.16,1,0.3,1)),border-color .18s ease;
    }
    .settings-checkbox::after{
      content:"";
      position:absolute;
      top:1px;
      left:1px;
      width:14px;
      height:14px;
      border-radius:999px;
      background:#ffffff;
      box-shadow:0 1px 2px rgba(0,0,0,0.28);
      transition:transform .18s var(--ag-ease-out,cubic-bezier(0.16,1,0.3,1));
    }
    .settings-checkbox:hover:not(:disabled){
      border-color:var(--ag-btn-border-hover);
    }
    .settings-checkbox:checked{
      background:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .settings-checkbox:checked::after{
      transform:translateX(14px);
    }
    .settings-checkbox:disabled{
      opacity:.5;
      cursor:not-allowed;
    }
    .settings-select-wrap{
      min-width:195px;
      max-width:265px;
      flex:0 0 auto;
      position:relative;
    }
    .settings-select{
      width:100%;
      height:28px;
      min-height:28px;
      box-sizing:border-box;
      padding:0 8px;
      font-size:13px;
      background:var(--ag-bg-input);
      border:1px solid var(--ag-border-subcard);
      color:var(--ag-text-primary);
      border-radius:6px;
      outline:none;
      cursor:pointer;
    }
    .settings-select:focus{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .settings-select-wrap .ag-dropdown-wrapper{
      width:100%;
    }
    .settings-select-wrap .ag-dropdown-menu{
      left:auto;
      right:0;
      min-width:225px;
      max-height:240px;
      overflow-y:auto;
    }
    #panel-settings .settings-card-box,
    #panel-settings .settings-pref-list,
    #panel-settings .settings-pref-row{
      overflow:visible;
    }
    .settings-sub-preview-bar{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:8px 10px;
      border-radius:6px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
    }
    .settings-sub-grid{
      overflow:visible !important;
      gap:7px 12px;
    }
    .settings-sub-grid dd{
      display:flex;
      align-items:center;
      gap:6px;
      flex-wrap:wrap;
    }
    .settings-sub-grid .ag-dropdown-wrapper{
      width:156px;
      max-width:100%;
      flex:0 0 auto;
    }
    .settings-sub-grid .ag-dropdown-trigger{
      height:30px;
      min-height:30px;
      padding:0 10px;
      border-radius:6px;
      white-space:nowrap;
    }
    .settings-sub-grid .ag-dropdown-trigger .ag-dropdown-label{
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .settings-sub-grid .ag-dropdown-menu{
      left:0;
      right:auto;
      min-width:100%;
      width:max-content;
      max-width:420px;
    }
    .settings-sub-grid .ag-dropdown-item,
    .settings-sub-grid .ag-dropdown-item-sub{
      white-space:nowrap;
    }
    .settings-sub-grid .ag-dropdown-item-sub{
      flex-shrink:0;
    }
    #panel-settings .drawer-body{
      margin-top:0;
      animation:none!important;
    }
    #panel-settings #plan-custom-form{
      animation:none!important;
    }
    .settings-feature-grid{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:6px;
    }
    .settings-feature-item{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:7px 10px;
      border-radius:7px;
      background:var(--ag-bg-subcard);
      border:1px solid var(--ag-border-subcard);
      cursor:pointer;
      transition:border-color .14s ease,background-color .14s ease;
    }
    .settings-feature-item:hover{
      border-color:var(--ag-btn-border-hover);
      background:var(--ag-btn-hover);
    }
    .settings-feature-item:active{
      transform:scale(0.985) translateY(0.5px);
    }
    .settings-feature-name{
      font-size:12.5px;
      font-weight:500;
      color:var(--ag-text-primary);
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .qp-pool-grid{
      display:flex;
      flex-direction:column;
      gap:8px;
      margin-bottom:6px;
    }
    .qp-pool-group{
      display:flex;
      flex-direction:column;
      gap:4px;
    }
    .qp-pool-group-title{
      font-size:11.5px;
      font-weight:600;
      color:var(--ag-text-muted);
      line-height:1.35;
    }
    .qp-pool-group-items{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:6px;
    }
    .qp-pool-chip{
      display:inline-flex;
      align-items:center;
      gap:6px;
      min-width:0;
      padding:6px 8px;
      border-radius:7px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      color:var(--ag-text-muted);
      font-size:12px;
      font-weight:500;
      cursor:pointer;
      text-align:left;
      transition:border-color .14s ease,background-color .14s ease,color .14s ease,transform .08s ease;
    }
    .qp-pool-chip:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .qp-pool-chip:hover,
    .qp-pool-chip[data-inspected="true"]{
      border-color:var(--ag-btn-border-hover);
      background:var(--ag-btn-hover);
      color:var(--ag-text-primary);
    }
    .qp-pool-chip[data-active="true"]{
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      color:var(--ag-text-primary);
    }
    .qp-pool-chip[data-active="true"]:hover{
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .qp-pool-chip-mark{
      flex-shrink:0;
      width:14px;
      text-align:center;
      font-size:11px;
      font-weight:700;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .qp-pool-chip[data-active="false"] .qp-pool-chip-mark{
      color:var(--ag-text-muted);
      font-weight:500;
    }
    .qp-pool-chip-label{
      flex:1;
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .qp-pool-chip-star{
      flex-shrink:0;
      font-size:11px;
      line-height:1;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      opacity:.88;
    }
    .qp-info-box{
      display:flex;
      flex-direction:column;
      gap:3px;
      padding:8px 10px;
      border-radius:8px;
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      background:var(--ag-bg-subcard);
      margin-bottom:4px;
    }
    .qp-info-top{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      flex-wrap:wrap;
    }
    .qp-info-title-wrap{
      display:inline-flex;
      align-items:center;
      gap:6px;
      min-width:0;
    }
    .qp-info-prefix{
      font-size:11.5px;
      font-weight:600;
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      flex-shrink:0;
    }
    .qp-info-title{
      font-size:12px;
      font-weight:600;
      color:var(--ag-text-primary);
    }
    .qp-info-rec{
      font-size:11px;
      font-weight:600;
      padding:1px 5px;
      border-radius:4px;
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border:1px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      flex-shrink:0;
    }
    .qp-info-rec[hidden]{
      display:none!important;
    }
    .qp-info-tag{
      font-size:11px;
      color:var(--ag-text-muted);
      flex-shrink:0;
    }
    .qp-info-role{
      font-size:11.5px;
      color:var(--ag-text-primary);
      line-height:1.45;
      text-wrap:pretty;
    }
    .qp-info-scene{
      font-size:11.5px;
      color:var(--ag-text-muted);
      line-height:1.45;
      text-wrap:pretty;
    }
    .qp-empty-hint{
      font-size:11.5px;
      color:var(--ag-text-muted);
      padding:7px 9px;
      border-radius:6px;
      border:1px dashed var(--ag-border-subcard);
      background:transparent;
    }
    .qp-custom-hdr{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      margin:10px 0 6px;
    }
    .qp-custom-hdr .settings-field-lbl{
      margin:0;
    }
    .qp-add-btn{
      flex-shrink:0;
      white-space:nowrap;
    }
    .qp-custom-hint{
      font-size:11.5px;
      color:var(--ag-text-muted);
      line-height:1.45;
      text-wrap:pretty;
      margin:-2px 0 6px;
    }
    .qp-tpl-bar{
      display:flex;
      flex-wrap:wrap;
      align-items:center;
      gap:5px;
      margin:2px 0 8px;
    }
    .qp-tpl-label{
      font-size:11.5px;
      color:var(--ag-text-muted);
      margin-right:2px;
      user-select:none;
    }
    .qp-tpl-chip{
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      color:var(--ag-text-secondary);
      border-radius:999px;
      padding:2px 8px;
      font-size:11.5px;
      line-height:1.45;
      white-space:nowrap;
      cursor:pointer;
      transition:border-color .14s,background-color .14s,color .14s,transform .08s ease;
    }
    .qp-tpl-chip:hover{
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      color:var(--ag-text-primary);
    }
    .qp-tpl-chip:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .qp-tpl-chip[data-added="true"]{
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:500;
    }
    .qp-editor-list{
      display:flex;
      flex-direction:column;
      gap:6px;
      margin-bottom:8px;
    }
    .qp-row{
      display:grid;
      grid-template-columns:minmax(92px,124px) minmax(0,1fr) auto auto;
      gap:6px;
      align-items:center;
    }
    .qp-autosend-btn{
      height:26px;
      padding:0 8px;
      min-width:56px;
      border-radius:6px;
      border:1px solid var(--ag-border-subcard);
      background:transparent;
      color:var(--ag-text-muted);
      font-size:11.5px;
      font-weight:500;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      white-space:nowrap;
      cursor:pointer;
      transition:background-color .14s,border-color .14s,color .14s,transform .08s ease;
    }
    .qp-autosend-btn:hover{
      color:var(--ag-text-primary);
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
    }
    .qp-autosend-btn:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .qp-autosend-btn[data-auto-send="true"]{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;
    }
    .qp-label-input,.qp-text-input,.ag-rp-input{
      width:100%;
      box-sizing:border-box;
      border-radius:6px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-input);
      color:var(--ag-text-primary);
      padding:5px 8px;
      font-size:12px;
      outline:none;
    }
    .qp-label-input:focus,.qp-text-input:focus,.ag-rp-input:focus,
    .qp-label-input:focus-visible,.qp-text-input:focus-visible,.ag-rp-input:focus-visible{
      border-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      box-shadow:0 0 0 2px var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
    }
    .qp-del-btn{
      border:1px solid var(--ag-border-subcard);
      background:transparent;
      color:var(--ag-text-muted);
      border-radius:6px;
      width:26px;
      height:26px;
      cursor:pointer;
      font-size:13px;
      line-height:1;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      transition:border-color .14s,color .14s,background-color .14s,transform .08s ease;
    }
    .qp-del-btn:hover{
      border-color:rgba(248,113,113,0.45);
      color:var(--ag-text-danger,#f87171);
      background:rgba(248,113,113,0.08);
    }
    .qp-del-btn:active{
      transform:scale(0.95);
    }
    .qp-footer{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
    }
    .qp-status{
      font-size:11.5px;
      color:var(--ag-text-muted);
      min-height:16px;
      min-width:0;
    }
    .qp-status[data-tone="dirty"]{
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:500;
    }
    .qp-status[data-tone="warn"]{
      color:var(--ag-text-danger,#f87171);
      font-weight:500;
    }
    .term-action-btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:5px;
      height:28px;
      padding:0 12px;
      border-radius:6px;
      border:1px solid var(--ag-btn-border);
      background:var(--ag-btn-bg);
      color:var(--ag-text-primary);
      font-size:12px;
      font-weight:500;
      white-space:nowrap;
      cursor:pointer;
      flex-shrink:0;
      transition:background-color .14s var(--ag-ease-out,cubic-bezier(0.16,1,0.3,1)),border-color .14s var(--ag-ease-out,cubic-bezier(0.16,1,0.3,1)),color .14s ease,transform .08s ease;
    }
    .term-action-btn:hover:not(:disabled){
      background:var(--ag-btn-hover);
      border-color:var(--ag-btn-border-hover);
    }
    .term-action-btn:active:not(:disabled){
      transform:scale(0.975) translateY(0.5px);
    }
    .term-action-btn:disabled{
      opacity:.52;
      cursor:not-allowed;
    }
    #btn-save-quick-prompts[data-dirty="true"]{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;
    }
    #btn-save-quick-prompts[data-dirty="true"]:hover:not(:disabled){
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
    }
    .settings-remote-channels-root{
      min-height:168px;
    }
    #btn-settings-remote-refresh{
      min-width:68px;
      white-space:nowrap;
    }
    #ag-remote-reset,#btn-reset-feature-toggles,#btn-reset-quick-prompts,#btn-refresh-terminals,#btn-test-terminal,#btn-toggle-heat-advanced,#btn-reset-remote-display{
      white-space:nowrap;
    }
    .ag-rp-channels{
      display:flex;
      flex-direction:column;
      gap:6px;
    }
    .ag-rp-channel{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:7px 9px;
      border-radius:7px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      font-size:12px;
      cursor:pointer;
      color:var(--ag-text-primary);
    }
    .ag-rp-channel[data-disabled="true"]{
      opacity:.58;
      cursor:not-allowed;
    }
    .ag-rp-channel[data-active="true"]{
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
    }
    .ag-rp-ch-check{
      display:inline-flex;
      align-items:center;
      gap:6px;
      min-width:0;
      flex:1;
    }
    .ag-rp-ch-name{
      font-weight:500;
      white-space:nowrap;
    }
    .ag-rp-ch-addr{
      font-size:11px;
      color:var(--ag-text-muted);
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .ag-rp-ch-cfg{
      border:1px solid var(--ag-border-subcard);
      background:transparent;
      color:var(--ag-text-secondary);
      border-radius:6px;
      padding:3px 8px;
      font-size:11px;
      white-space:nowrap;
      cursor:pointer;
      flex-shrink:0;
      transition:color .14s ease,background-color .14s ease,transform .08s ease;
    }
    .ag-rp-ch-cfg:hover{
      color:var(--ag-text-primary);
      background:var(--ag-toolbar-bg-hover);
    }
    .ag-rp-ch-cfg:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .ag-rp-tunnel-form{
      display:flex;
      flex-direction:column;
      gap:8px;
      margin-top:8px;
      padding:10px;
      border-radius:8px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-card);
      font-size:11.5px;
      color:var(--ag-text-secondary);
    }
    .ag-rp-tunnel-sub{
      font-size:11px;
      line-height:1.45;
      color:var(--ag-text-muted);
    }
    .ag-rp-install-guide{
      display:flex;
      flex-direction:column;
      gap:6px;
      margin-top:8px;
      padding:8px 10px;
      border-radius:8px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-card);
      font-size:11.5px;
      color:var(--ag-text-secondary);
    }
    .ag-rp-install-guide[data-missing="true"]{
      border-color:rgba(245,158,11,0.48);
      background:rgba(245,158,11,0.08);
    }
    .ag-rp-install-hdr{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      flex-wrap:wrap;
    }
    .ag-rp-install-title{
      display:inline-flex;
      align-items:center;
      gap:6px;
      font-weight:600;
      color:var(--ag-text-primary);
      font-size:11.5px;
    }
    .ag-rp-install-badge{
      display:inline-flex;
      align-items:center;
      padding:1px 6px;
      border-radius:999px;
      font-size:11px;
      font-weight:500;
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
    }
    .ag-rp-install-guide[data-missing="true"] .ag-rp-install-badge{
      background:rgba(245,158,11,0.18);
      color:var(--ag-text-warn,#fbbf24);
    }
    .ag-rp-install-tabs{
      display:inline-flex;
      align-items:center;
      gap:4px;
    }
    .ag-rp-install-tab{
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      color:var(--ag-text-secondary);
      border-radius:5px;
      padding:2px 7px;
      font-size:11px;
      white-space:nowrap;
      cursor:pointer;
      transition:border-color .14s ease,background-color .14s ease,color .14s ease,transform .08s ease;
    }
    .ag-rp-install-tab:active{
      transform:scale(0.975) translateY(0.5px);
    }
    .ag-rp-install-tab[data-active="true"]{
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;
    }
    .ag-rp-install-cmd-row{
      display:flex;
      align-items:center;
      gap:6px;
    }
    .ag-rp-install-cmd{
      flex:1;
      min-width:0;
      margin:0;
      padding:5px 8px;
      border-radius:6px;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      color:var(--ag-text-primary);
      font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      font-size:11px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      user-select:all;
    }
    .ag-rp-install-foot{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      flex-wrap:wrap;
      font-size:11px;
      color:var(--ag-text-muted);
    }
    .ag-rp-form-actions{
      display:flex;
      gap:6px;
      flex-wrap:wrap;
    }
    .ag-rp-btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border:1px solid var(--ag-border-subcard);
      background:var(--ag-bg-subcard);
      color:var(--ag-text-primary);
      border-radius:6px;
      padding:5px 10px;
      font-size:11.5px;
      white-space:nowrap;
      cursor:pointer;
      transition:border-color .14s ease,background-color .14s ease,color .14s ease,transform .08s ease;
    }
    .ag-rp-btn:hover:not(:disabled){
      background:var(--ag-btn-hover);
      border-color:var(--ag-btn-border-hover);
    }
    .ag-rp-btn:active:not(:disabled){
      transform:scale(0.975) translateY(0.5px);
    }
    .ag-rp-btn:disabled{
      opacity:.52;
      cursor:not-allowed;
    }
    .ag-rp-btn.primary{
      background:var(--ag-accent-bg,rgba(167,139,250,0.14));
      border-color:var(--ag-accent-border,rgba(167,139,250,0.34));
      color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      font-weight:600;
    }
    .ag-rp-btn.primary:hover:not(:disabled){
      background:var(--ag-accent-bg-hover,rgba(167,139,250,0.24));
      border-color:var(--ag-accent-border-hover,rgba(167,139,250,0.56));
    }
    .ag-rp-err{
      margin-top:8px;
      padding:6px 8px;
      border-radius:6px;
      background:rgba(248,113,113,0.12);
      border:1px solid rgba(248,113,113,0.35);
      color:var(--ag-text-danger,#f87171);
      font-size:11.5px;
    }
    .ag-rp-hint{
      margin-top:8px;
      padding:6px 8px;
      border-radius:6px;
      background:var(--ag-bg-subcard,rgba(255,255,255,0.04));
      border:1px solid var(--ag-border-subcard,rgba(255,255,255,0.1));
      color:var(--ag-text-muted,#a1a1aa);
      font-size:11.5px;
      line-height:1.45;
    }
    @keyframes ag-spin{
      from{transform:rotate(0deg);}
      to{transform:rotate(360deg);}
    }
    .ag-rp-spin{
      display:inline-block;
      width:11px;
      height:11px;
      border-radius:999px;
      border:1.5px solid var(--ag-accent-border,rgba(167,139,250,0.34));
      border-top-color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa));
      animation:ag-spin .7s linear infinite;
      vertical-align:middle;
      margin-right:4px;
    }
    @media (max-width:560px){
      #panel-settings{width:calc(100vw - 24px);}
      .settings-tabs-bar{grid-template-columns:repeat(2,minmax(0,1fr));}
      .qp-pool-group-items{grid-template-columns:repeat(2,minmax(0,1fr));}
      .term-app-grid,.settings-feature-grid,.qp-row{grid-template-columns:minmax(0,1fr);}
    }
    @media (prefers-reduced-motion: reduce){
      .settings-tab-btn,.term-option-card,.settings-feature-item,.qp-pool-chip,.qp-tpl-chip,.qp-autosend-btn,.qp-del-btn,.term-action-btn,.settings-checkbox,.settings-checkbox::after,.ag-rp-btn,.ag-rp-ch-cfg,.ag-rp-install-tab,.settings-advanced-details > summary{
        transition:none!important;
      }
      .ag-rp-spin{
        animation:none!important;
      }
    }
  </style>

  <!-- 顶部基本单元 1 & 2 (合并): 上下文小圆环 + 输出速度 (点击统一打开上下文面板) -->
  <button id="badge" class="ag-unit ag-unit-ring ag-unit-merged" type="button" aria-label="会话上下文与输出速度统计" aria-describedby="context-tooltip" aria-expanded="false">
    <svg id="ring-svg" class="ring-svg" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle id="ring-track" class="ring-track" cx="9" cy="9" r="6.5" fill="none" stroke-width="2.1"></circle>
      <circle id="ring-fill" class="ring-fill" cx="9" cy="9" r="6.5" fill="none" stroke-width="2.1" stroke-linecap="round" transform="rotate(-90 9 9)" stroke-dasharray="3.2 4.97"></circle>
    </svg>
    <span id="badge-pct-val" class="badge-pct-val">--%</span>
    <span id="badge-speed" class="badge-inline-speed" aria-label="模型输出速度与耗时统计" aria-expanded="false">
      <span id="badge-speed-icon" class="speed-icon" aria-hidden="true">⚡</span>
      <span id="badge-speed-wait-svg" class="speed-wait-svg" hidden aria-hidden="true">
        <svg class="ag-hourglass-svg" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.2 2.2h7.6M3.2 11.8h7.6M4 2.2c0 2.5 3 4.2 3 4.8s-3 2.3-3 4.8M10 2.2c0 2.5-3 4.2-3 4.8s3 2.3 3 4.8" opacity="0.88" />
          <path class="ag-hourglass-sand-top" d="M4.8 3.2h4.4L7 6.1z" fill="currentColor" stroke="none" />
          <line class="ag-hourglass-stream" x1="7" y1="6.7" x2="7" y2="9.4" stroke-dasharray="1 1.2" stroke-width="1.2" />
          <path class="ag-hourglass-sand-bot" d="M4.8 11.1h4.4L7 8.4z" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span id="speed-amount">-- tok/s</span>
      <span id="speed-hover-extra" class="sr-only"></span>
    </span>
    <div id="bar-wrap" class="sr-only" aria-hidden="true"><div id="bar-fill" class="meter-bar-fill"></div></div>
    <span id="amount" class="sr-only">读取中…</span>
    <span id="hover-wrap" class="sr-only"><span id="hover-extra"></span></span>
  </button>

  <!-- 顶部基本单元 3: 累计 Token 用量（细线统计图标） -->
  <button id="badge-tokens" class="ag-unit" type="button" aria-label="Token 用量一览" aria-expanded="false">
    <span class="token-fire-dot" aria-hidden="true"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13V9M8 13V4M13 13V7"></path></svg></span>
    <span id="token-amount">--</span>
    <span id="token-hover-extra" class="sr-only"></span>
  </button>

  <!-- 顶部基本单元 4: 一键启动 CLI 模式 -->
  <button id="badge-cli" class="ag-unit" type="button" aria-label="启动 CLI" title="一键启动 Antigravity CLI 终端（自动进入当前项目目录）">
    <span class="cli-icon" aria-hidden="true">&gt;_</span>
    <span id="cli-label">CLI</span>
  </button>

  <!-- 顶部基本单元 4B: 套件统一设置入口 -->
  <button id="badge-settings" class="ag-unit" type="button" aria-label="套件设置" aria-expanded="false" title="打开 Antigravity Suite 统一设置面板"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.82 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.69 0-1.25.4-1.51 1z"/></svg></button>

  <!-- 顶部基本单元 5: 窄屏溢出菜单按钮 -->
  <button id="badge-overflow" class="ag-unit" type="button" aria-label="更多统计指标" aria-expanded="false">
    <svg class="overflow-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25"></circle>
      <circle cx="8" cy="8" r="1.25"></circle>
      <circle cx="12.5" cy="8" r="1.25"></circle>
    </svg>
  </button>

  <!-- CLI 启动反馈提示气泡 -->
  <div id="cli-launch-toast" hidden role="status" aria-live="polite"></div>

  <!-- 上下文圆环悬停/聚焦信息气泡（参考图三层结构） -->
  <div id="context-tooltip" role="tooltip" data-visible="false" data-placement="bottom">
    <div id="ctx-tip-title" class="ctx-tip-title">上下文窗口：</div>
    <div id="ctx-tip-pct" class="ctx-tip-pct">数据尚未就绪</div>
    <div id="ctx-tip-detail" class="ctx-tip-detail">正在读取当前会话上下文用量…</div>
  </div>

  <!-- 窄屏溢出菜单 -->
  <div id="overflow-menu" hidden aria-label="更多统计快捷菜单">
    <button id="overflow-speed-btn" class="overflow-item" type="button">
      <span class="overflow-item-label"><span>⚡</span><span>输出速度</span></span>
      <span id="overflow-speed-val" class="overflow-item-val">-- tok/s</span>
    </button>
    <button id="overflow-tokens-btn" class="overflow-item" type="button">
      <span class="overflow-item-label"><span class="token-fire-dot"></span><span>Token 用量一览</span></span>
      <span id="overflow-tokens-val" class="overflow-item-val">--</span>
    </button>
    <button id="overflow-cli-btn" class="overflow-item" type="button">
      <span class="overflow-item-label"><span class="cli-icon">&gt;_</span><span>启动 CLI 终端</span></span>
      <span id="overflow-cli-val" class="overflow-item-val">agy</span>
    </button>
    <button id="overflow-settings-btn" class="overflow-item" type="button">
      <span class="overflow-item-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.82 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.69 0-1.25.4-1.51 1z"/></svg><span>套件设置</span></span>
      <span class="overflow-item-val">配置</span>
    </button>
  </div>

  <!-- 弹出式面板 1: 会话上下文与速度监控 (#panel, 450px) -->
  <section id="panel" class="ag-panel" hidden aria-label="会话与上下文详情">
    <div class="panel-header-bar">
      <div class="panel-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;color:var(--ag-custom-token-accent,var(--ag-token-accent-default))"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 1.5"/></svg>
        <span style="font-size:13px;font-weight:600;color:var(--ag-text-primary)">当前会话上下文</span>
      </div>
      <div class="panel-header-actions">
        <button id="btn-github-repo-ctx" class="panel-icon-btn" type="button" aria-label="打开 GitHub 仓库" title="打开 GitHub 仓库" hidden style="display:none">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
        </button>
        <button id="btn-check-update-ctx" class="panel-icon-btn update-btn" type="button" aria-label="检查插件更新" title="检查插件更新" hidden style="position:relative;display:none">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8A6 6 0 1 1 8 2M14 2v6h-6"></path></svg>
          <span id="update-badge-dot-ctx" class="update-badge-dot" style="display:none"></span>
        </button>
        <button id="close" class="panel-icon-btn" type="button" aria-label="收起详情">×</button>
      </div>
    </div>

    <div id="view-context">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h3 style="margin:0">会话用量与生成监控<span id="v">v0.9.0</span></h3>
      </div>

      <!-- 本轮与当前会话实时 API 等值参考行 -->
      <div id="round-cost-bar" class="round-cost-bar" title="当前模型调用的 API 等值参考金额（按已返回用量或实时生成估算）">
        <span id="round-cost-text" style="font-weight:600;color:var(--ag-text-primary)">本轮估值：—</span>
        <span id="session-cost-text" style="font-size:11px;color:var(--ag-text-muted)">当前会话合计：—</span>
      </div>

      <!-- 卡片 1: 核心用量速览 -->
      <div id="key-summary">
        <div class="key-header"><span class="key-title">核心用量速览</span><span id="key-badge" class="key-pill pill-muted">读取中</span></div>
        <div class="key-bar-track"><div id="key-bar-fill" class="key-bar-fill"></div></div>
        <div class="key-stats"><div class="key-stat"><div class="key-stat-label">当前已用</div><div id="key-used" class="key-stat-val">—</div></div><div class="key-stat"><div class="key-stat-label">预算上限</div><div id="key-limit" class="key-stat-val">—</div></div><div class="key-stat"><div class="key-stat-label">剩余可用</div><div id="key-remaining" class="key-stat-val">—</div></div></div>
        <div id="key-takeaway" class="key-takeaway">正在计算核心指标…</div>
      </div>

      <!-- 卡片 2: 输出速度与延迟速览 -->
      <div id="speed-summary" style="background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:11px 12px;margin:8px 0 10px;">
        <div class="key-header">
          <span class="key-title">最新生成速度与耗时</span>
          <span id="speed-badge" class="key-pill pill-muted">待生成</span>
        </div>
        <div class="key-stats" style="grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="key-stat">
            <div class="key-stat-label">输出速度</div>
            <div id="speed-val" class="key-stat-val" style="color:var(--ag-custom-speed,var(--ag-text-primary));">—</div>
          </div>
          <div class="key-stat">
            <div class="key-stat-label">生成耗时</div>
            <div id="speed-duration" class="key-stat-val">—</div>
          </div>
          <div class="key-stat">
            <div class="key-stat-label">首字延迟</div>
            <div id="speed-ttft" class="key-stat-val">—</div>
          </div>
          <div class="key-stat">
            <div class="key-stat-label">本次输出</div>
            <div id="speed-tokens" class="key-stat-val">—</div>
          </div>
        </div>
        <div id="speed-takeaway" class="key-takeaway">等待首次模型输出产生速度统计…</div>
      </div>

      <!-- 二级交互折叠区: 客户端界面汉化 (AntigravityChinese) -->
      <div class="tech-drawer" id="chinese-i18n-drawer" hidden style="display:none">
        <button id="btn-toggle-chinese" class="drawer-trigger" aria-expanded="false" type="button">
          <span class="drawer-trigger-left">
            <span>🇨🇳 客户端界面汉化（桌面客户端）</span>
            <span id="chinese-badge" class="key-pill pill-muted" style="margin-left:6px;font-size:11px;">读取中…</span>
          </span>
          <span id="chinese-drawer-arrow" class="drawer-arrow">▼ 展开</span>
        </button>
        <div id="chinese-drawer-body" class="drawer-body" style="display:none;">
          <div class="unlock-panel-content">
            <div class="unlock-status-row">
              <div class="unlock-status-meta">
                <div class="unlock-label">汉化模块运行状态</div>
                <div id="chinese-status-desc" class="unlock-desc">正在检测桌面端汉化注入状态…</div>
              </div>
            </div>
            <div class="unlock-actions">
              <button id="btn-toggle-chinese-module" class="unlock-btn unlock-btn-primary" type="button">切换汉化状态</button>
            </div>
            <div class="unlock-credit-row">
              <div class="unlock-credit-left">
                <span class="unlock-credit-lbl">汉化方案来源：</span>
                <span class="unlock-adapter-note">AntigravityChinese (开源社区贡献)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 二级交互折叠区: 命令行与更新代理（可选） -->
      <div class="tech-drawer" id="proxy-notun-drawer">
        <button id="btn-toggle-proxy" class="drawer-trigger" aria-expanded="false" type="button">
          <span class="drawer-trigger-left">
            <span>🌐 命令行与更新代理（可选）</span>
            <span id="proxy-badge" class="key-pill pill-muted" style="margin-left:6px;font-size:11px;">读取中…</span>
          </span>
          <span id="proxy-drawer-arrow" class="drawer-arrow">▼ 展开</span>
        </button>
        <div id="proxy-drawer-body" class="drawer-body" style="display:none;">
          <div class="unlock-panel-content">
            <div class="unlock-status-row">
              <div class="unlock-status-meta">
                <div class="unlock-label">代理作用范围与状态</div>
                <div id="proxy-status-desc" class="unlock-desc">正在核对代理设置…</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin:8px 0;">
              <label style="font-size:11.5px;color:var(--ag-text-secondary);display:flex;flex-direction:column;gap:4px;">
                <span>本地代理地址（支持 HTTP / SOCKS5，如 http://127.0.0.1:7897）：</span>
                <input id="input-proxy-url" type="text" class="unlock-input" style="height:28px;padding:0 8px;font-size:11.5px;box-sizing:border-box;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary);border-radius:5px;" value="http://127.0.0.1:7897" />
              </label>
              <label style="font-size:11.5px;color:var(--ag-text-secondary);display:flex;flex-direction:column;gap:4px;">
                <span>不走代理的地址（本机地址默认直连）：</span>
                <input id="input-proxy-bypass" type="text" class="unlock-input" style="height:28px;padding:0 8px;font-size:11.5px;box-sizing:border-box;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);color:var(--ag-text-primary);border-radius:5px;" value="localhost,127.0.0.1,::1,<local>" />
              </label>
            </div>
            <div class="unlock-actions" style="display:flex;gap:8px;">
              <button id="btn-test-proxy" class="unlock-btn unlock-btn-secondary" type="button">🔍 测试代理连接</button>
              <button id="btn-toggle-proxy-module" class="unlock-btn unlock-btn-primary" type="button">启用代理</button>
            </div>
            <div id="proxy-test-result" style="font-size:11.5px;margin-top:6px;display:none;color:var(--ag-text-secondary);"></div>
          </div>
        </div>
      </div>

      <!-- 二级交互折叠区 1: 面板背景与指标颜色自定义（就近放置于面板 B 内部） -->
      <div class="tech-drawer" id="meter-colors-drawer">
        <button id="btn-toggle-colors" class="drawer-trigger" aria-expanded="false" type="button">
          <span class="drawer-trigger-left"><span>🎨 指标与背景颜色自定义（默认跟随主题）</span></span>
          <span id="color-drawer-arrow" class="drawer-arrow">▼ 展开设置</span>
        </button>
        <div id="color-drawer-body" class="drawer-body" style="display:none;">
          <div class="color-grid">
            <div class="color-item">
              <span class="color-item-lbl">全局主题强调色</span>
              <div class="color-item-ctrls">
                <input id="color-tokenAccent" class="color-picker" type="color" value="#a78bfa" aria-label="全局主题强调色" />
                <button id="swatch-tokenAccent" class="color-swatch-btn" type="button" data-color-slot="tokenAccent" data-color-label="全局主题强调色" title="点击打开颜色选取器"></button>
                <button id="reset-tokenAccent" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">浮窗与面板背景色</span>
              <div class="color-item-ctrls">
                <input id="color-panelBg" class="color-picker" type="color" value="#181818" aria-label="浮窗与面板背景色" />
                <button id="swatch-panelBg" class="color-swatch-btn" type="button" data-color-slot="panelBg" data-color-label="浮窗与面板背景色" title="点击打开颜色选取器"></button>
                <button id="reset-panelBg" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">顶部圆环进度</span>
              <div class="color-item-ctrls">
                <input id="color-ringUsed" class="color-picker" type="color" value="#e6e6eb" aria-label="顶部圆环进度颜色" />
                <button id="swatch-ringUsed" class="color-swatch-btn" type="button" data-color-slot="ringUsed" data-color-label="顶部圆环进度" title="点击打开颜色选取器"></button>
                <button id="reset-ringUsed" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">顶部圆环底轨</span>
              <div class="color-item-ctrls">
                <input id="color-ringTrack" class="color-picker" type="color" value="#52525b" aria-label="顶部圆环底轨颜色" />
                <button id="swatch-ringTrack" class="color-swatch-btn" type="button" data-color-slot="ringTrack" data-color-label="顶部圆环底轨" title="点击打开颜色选取器"></button>
                <button id="reset-ringTrack" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">对话占用百分比</span>
              <div class="color-item-ctrls">
                <input id="color-contextText" class="color-picker" type="color" value="#ececef" aria-label="对话占用百分比颜色" />
                <button id="swatch-contextText" class="color-swatch-btn" type="button" data-color-slot="contextText" data-color-label="对话占用百分比" title="点击打开颜色选取器"></button>
                <button id="reset-contextText" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">测速徽章文字</span>
              <div class="color-item-ctrls">
                <input id="color-speedText" class="color-picker" type="color" value="#b8b8c0" aria-label="测速徽章文字颜色" />
                <button id="swatch-speedText" class="color-swatch-btn" type="button" data-color-slot="speedText" data-color-label="测速徽章文字" title="点击打开颜色选取器"></button>
                <button id="reset-speedText" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
            <div class="color-item">
              <span class="color-item-lbl">顶部总 Token 数</span>
              <div class="color-item-ctrls">
                <input id="color-tokenTotal" class="color-picker" type="color" value="#c084fc" aria-label="顶部总 Token 数颜色" />
                <button id="swatch-tokenTotal" class="color-swatch-btn" type="button" data-color-slot="tokenTotal" data-color-label="顶部总 Token 数" title="点击打开颜色选取器"></button>
                <button id="reset-tokenTotal" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
              </div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px">
            <span style="font-size:11px;color:var(--ag-text-muted)">注：高占用与超限告警色独立保留，不被常态颜色覆盖。</span>
            <button id="reset-all-colors" class="color-reset-btn" type="button">全部恢复跟随主题</button>
          </div>
        </div>
      </div>

      <!-- 二级交互折叠区 2: 底层统计与附件检查 -->
      <div class="tech-drawer">
        <button id="btn-toggle-details" class="drawer-trigger" aria-expanded="false" type="button">
          <span class="drawer-trigger-left">
            <span>底层统计与附件检查</span>
          </span>
          <span id="drawer-arrow" class="drawer-arrow">▼ 点击展开明细</span>
        </button>
        <div id="drawer-body" class="drawer-body" style="display:none;">
          <p id="status">正在核对请求和附件…</p><p id="model"></p>
          <h4>最近一次模型请求</h4>
          <dl><dt>请求状态</dt><dd id="request-status">—</dd><dt>模型返回输入＋输出</dt><dd id="actual">—</dd><dt>本地估算（可能未计入附件）</dt><dd id="estimate">—</dd><dt>客户端预算上限</dt><dd id="budget">—</dd><dt>该次报错的服务端限制</dt><dd id="service-limit">—</dd><dt>相对客户端预算</dt><dd id="percent">—</dd></dl>
          <h4>整个会话累计内容 · 本地估算</h4>
          <dl><dt>可读取文本 token 估算</dt><dd id="session-total">扫描中…</dd><dt>实际读取文字字符数</dt><dd id="characters">—</dd><dt>用户消息</dt><dd id="user">—</dd><dt>模型回复</dt><dd id="assistant">—</dd><dt>可见思考内容</dt><dd id="thinking">—</dd><dt>工具调用与工具输出</dt><dd id="tools">—</dd><dt>历史压缩摘要</dt><dd id="summaries">—</dd><dt>当前系统提示与工具定义</dt><dd id="system">—</dd><dt>上传／输出附件文本</dt><dd id="attachment-total">—</dd><dt>历史步骤完整性</dt><dd id="steps">—</dd></dl>
          <p id="coverage"></p><h4>附件逐项检查</h4><div id="files"></div><button id="refresh" type="button">重新扫描整段会话与附件</button>
          <p id="note">会话累计包含当前可读取的全部历史记录（含已压缩内容），不等同于每次实际发给模型的长度，也不能直接用累计值除以 1M 判断剩余容量。附件原文与工具读取出的内容可能在记录中分别计入一次；尚未发送的草稿和待上传文件暂未计入，新上传文件会使下次请求明显增大。<br><br>本地数值仅按字数粗略推算，并非模型官方精确分词；图片、音视频、加密或不可读文件会单独标为「未知」而非按零计。只有模型服务端返回的统计才属于实际用量；所有扫描均在本机完成，不会向外部上传文件，也不会执行文件中的宏或公式。</p>
          <p id="updated"></p>
        </div>
      </div>
    </div>
  </section>

  <!-- 弹出式面板 2: Token 用量一览 (#panel-tokens, 730px) -->
  <section id="panel-tokens" class="ag-panel" hidden aria-label="Token 用量一览">
    <div class="panel-header-bar">
      <div class="panel-title panel-title-tokens">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ag-custom-token-accent,var(--ag-token-accent-default))"><path d="M3 13V9M8 13V4M13 13V7"></path></svg>
        <span id="panel-tokens-title" style="font-size:13px;font-weight:600;color:var(--ag-text-primary)">本机已记录用量</span>
      </div>
      <div class="panel-header-actions">
        <button id="btn-github-repo" class="panel-icon-btn" type="button" aria-label="打开 GitHub 仓库" title="打开 GitHub 仓库" hidden style="display:none">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
        </button>
        <button id="btn-check-update" class="panel-icon-btn update-btn" type="button" aria-label="检查插件更新" title="检查插件更新" hidden style="position:relative;display:none">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8A6 6 0 1 1 8 2M14 2v6h-6"></path></svg>
          <span id="update-badge-dot" class="update-badge-dot" style="display:none"></span>
        </button>
        <button id="close-tokens" class="panel-icon-btn" type="button" aria-label="收起详情">×</button>
      </div>
    </div>

    <div id="view-tokens">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <div class="source-switch-bar">
          <span style="font-size:11px;color:var(--ag-text-muted);padding:0 4px">来源:</span>
          <button id="src-tab-all" class="switch-pill-btn active" type="button">全部</button>
          <button id="src-tab-desktop" class="switch-pill-btn" type="button">桌面端</button>
          <button id="src-tab-cli" class="switch-pill-btn" type="button">CLI</button>
        </div>
        <div class="view-switch-bar">
          <button id="tok-view-tokens" class="switch-pill-btn active" type="button">Token 统计</button>
          <button id="tok-view-cost" class="switch-pill-btn" type="button">API 参考金额</button>
        </div>
      </div>

      <!-- 账号套餐状态摘要行 -->
      <div id="plan-summary-bar" class="plan-summary-bar">
        <div class="plan-summary-badge" style="display:flex;align-items:center;gap:6px;flex:1;overflow:hidden">
          <span id="plan-summary-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Pro · 已自动识别 · 刚刚更新</span>
        </div>
        <span id="summary-subtier-readonly" class="plan-subtier-readonly-pill" style="display:none" title="当前订阅子档"></span>
        <!-- Ultra 子档快捷选择下拉（仅当套餐为 Ultra 时显示） -->
        <div id="summary-subtier-wrap" class="ag-dropdown-wrapper ag-subtier-compact-wrap" style="display:none;width:auto;flex-shrink:0">
          <div id="summary-subtier-trigger" class="ag-dropdown-trigger ag-subtier-compact-trigger" tabindex="0" title="官方接口未返回 Ultra 子档，点击选择您的实际订阅子档 (5x / 20x)">
            <span id="summary-subtier-label" class="ag-dropdown-label">子档: 未设</span>
            <div class="ag-dropdown-arrow">
              <svg viewBox="0 0 10 6" width="9" height="5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
            </div>
          </div>
          <div id="summary-subtier-menu" class="ag-dropdown-menu ag-subtier-compact-menu"></div>
        </div>
        <!-- 黄框位置：实时联动的订阅费与汇率胶囊 -->
        <div id="plan-summary-price-badge" class="plan-summary-price-badge" role="button" tabindex="0" aria-expanded="false" aria-controls="plan-detail-card" title="当前地区订阅费与最新汇率折算 (点击展开/收起详情)">
          <span id="plan-summary-price-val">$19.99/月</span>
          <span id="plan-summary-price-cny" style="font-size:11px;opacity:0.85;font-weight:400">(≈ ¥134.3 CNY)</span>
        </div>
        <button id="btn-plan-detail-toggle" class="switch-pill-btn" type="button" style="padding:2px 6px;flex-shrink:0">详情 ▼</button>
      </div>

      <!-- 套餐详情卡片（可折叠，紧凑左对齐，支持就地自定义与获取方式设置） -->
      <div id="plan-detail-card" class="plan-detail-card collapsible-pane" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--ag-border-subcard)">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11.5px;font-weight:600;color:var(--ag-text-primary)">AI 订阅与额度详情</span>
            <span id="plan-save-feedback" style="font-size:11px;color:var(--ag-text-muted);display:none"></span>
          </div>
          <button id="btn-plan-detail-collapse-top" class="switch-pill-btn" type="button" style="padding:2px 8px;font-size:11px" title="收回 AI Pro 详情面板">详情收回 ▲</button>
        </div>
        <dl class="plan-detail-dl">
          <dt>当前套餐：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
            <span id="p-det-name" style="display:none;font-weight:600">Google AI Pro</span>
            <select id="direct-tier-select" aria-label="订阅方案与档位覆盖" style="display:none">
              <option value="auto">✨ 自动检测</option>
              <option value="free">免费版 (Free)</option>
              <option value="plus">Google AI Plus</option>
              <option value="pro">Google AI Pro</option>
              <option value="ultra_5x">Google AI Ultra 5x</option>
              <option value="ultra_20x">Google AI Ultra 20x</option>
              <option value="ultra">Google AI Ultra</option>
            </select>
            <div id="direct-tier-wrap" class="ag-dropdown-wrapper" style="flex:1;min-width:0;max-width:270px">
              <div id="direct-tier-trigger" class="ag-dropdown-trigger" tabindex="0" title="订阅方案与档位覆盖 · 可手动指定套餐或保持自动检测">
                <span id="direct-tier-label" class="ag-dropdown-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">✨ 自动检测</span>
                <div class="ag-dropdown-arrow">
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
                </div>
              </div>
              <div id="direct-tier-menu" class="ag-dropdown-menu"></div>
            </div>
            <span id="p-det-tier-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 5px;display:none;flex-shrink:0;white-space:nowrap">自定义</span>
          </dd>
          <dt id="p-dt-subtier" style="display:none">套餐子档：</dt>
          <dd id="p-dd-subtier" style="display:none;align-items:center;gap:6px;flex-wrap:nowrap">
            <span id="p-det-subtier-readonly" style="display:none;font-weight:600">—</span>
            <select id="direct-subtier-select" aria-label="Ultra 套餐子档" style="display:none">
              <option value="">🌐 未设置 / 自动识别</option>
              <option value="5x">⚡ Ultra 5x · 5× Pro 配额 ($99.99/月)</option>
              <option value="20x">🚀 Ultra 20x · 20× Pro 配额 ($199.99/月)</option>
            </select>
            <div id="direct-subtier-wrap" class="ag-dropdown-wrapper" style="flex:1;min-width:0;max-width:270px">
              <div id="direct-subtier-trigger" class="ag-dropdown-trigger" tabindex="0" title="客户端接口仅返回 Google AI Ultra，可在此手动指定 5x 或 20x 子档以展示对应额度倍率与参考数据">
                <span id="direct-subtier-label" class="ag-dropdown-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🌐 未设置 / 自动识别</span>
                <div class="ag-dropdown-arrow">
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
                </div>
              </div>
              <div id="direct-subtier-menu" class="ag-dropdown-menu"></div>
            </div>
            <span id="p-det-subtier-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 5px;display:none;flex-shrink:0;white-space:nowrap">自定义</span>
          </dd>
          <dt id="p-dt-subtier-specs" style="display:none">子档权益规格：</dt>
          <dd id="p-det-subtier-specs" style="display:none;font-size:11px;color:var(--ag-text-secondary);line-height:1.5">—</dd>
          <dt>当前账号：</dt>
          <dd id="p-det-account">—</dd>
          <dt>账号所在地区：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
            <span id="p-det-country" style="display:none">未知</span>
            <select id="direct-country-select" aria-label="账号所在地区 (仅本地记录)" style="display:none">
              <option value="未知">🌐 未设置 / 自动</option>
              <option value="美国 (US)">🇺🇸 美国 (US)</option>
              <option value="日本 (JP)">🇯🇵 日本 (JP)</option>
              <option value="韩国 (KR)">🇰🇷 韩国 (KR)</option>
              <option value="中国台湾 (TW)">🇹🇼 中国台湾 (TW)</option>
              <option value="中国香港 (HK)">🇭🇰 中国香港 (HK)</option>
              <option value="澳大利亚 (AU)">🇦🇺 澳大利亚 (AU)</option>
              <option value="新加坡 (SG)">🇸🇬 新加坡 (SG)</option>
              <option value="英国 (UK)">🇬🇧 英国 (UK)</option>
              <option value="德国 (DE)">🇩🇪 德国 (DE)</option>
              <option value="加拿大 (CA)">🇨🇦 加拿大 (CA)</option>
              <option value="土耳其 (TR)">🇹🇷 土耳其 (TR)</option>
              <option value="尼日利亚 (NG)">🇳🇬 尼日利亚 (NG)</option>
              <option value="菲律宾 (PH)">🇵🇭 菲律宾 (PH)</option>
              <option value="印度 (IN)">🇮🇳 印度 (IN)</option>
              <option value="马来西亚 (MY)">🇲🇾 马来西亚 (MY)</option>
              <option value="巴西 (BR)">🇧🇷 巴西 (BR)</option>
              <option value="中国大陆 (CN)">🇨🇳 中国大陆 (CN)</option>
            </select>
            <div id="direct-country-wrap" class="ag-dropdown-wrapper" style="flex:1;min-width:0;max-width:270px">
              <div id="direct-country-trigger" class="ag-dropdown-trigger" tabindex="0" title="用户记录或可靠来源识别的 Google 账号所属地区 (仅本地生效，不修改 Google 账号本身)">
                <span id="direct-country-label" class="ag-dropdown-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🌐 未设置 / 自动</span>
                <div class="ag-dropdown-arrow">
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
                </div>
              </div>
              <div id="direct-country-menu" class="ag-dropdown-menu"></div>
            </div>
            <span id="p-det-country-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 5px;display:none;flex-shrink:0;white-space:nowrap">已保存</span>
          </dd>
          <dt>订阅国家：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
            <span id="p-det-region" style="display:none">未知</span>
            <div id="direct-region-wrap" class="ag-dropdown-wrapper" style="flex:1;min-width:0;max-width:270px">
              <div id="direct-region-trigger" class="ag-dropdown-trigger" tabindex="0" title="这份订阅的购买或订阅所在国家/地区 (可与账号所在地区不同)">
                <span id="direct-region-label" class="ag-dropdown-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🌏 未知 (点击选择订阅国家与币种建议)</span>
                <div class="ag-dropdown-arrow">
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
                </div>
              </div>
              <div id="direct-region-menu" class="ag-dropdown-menu"></div>
            </div>
            <span id="p-det-region-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 5px;display:none;flex-shrink:0;white-space:nowrap">自定义</span>
          </dd>
          <dt>订阅币种：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
            <span id="p-det-currency" style="display:none">USD</span>
            <select id="direct-currency-select" aria-label="订阅币种" style="display:none">
              <option value="USD">USD ($ 美元)</option>
              <option value="KRW">KRW (₩ 韩元)</option>
              <option value="AUD">AUD (AU$ 澳元)</option>
              <option value="JPY">JPY (¥ 日元)</option>
              <option value="HKD">HKD (HK$ 港币)</option>
              <option value="TWD">TWD (NT$ 台币)</option>
              <option value="TRY">TRY (₺ 里拉)</option>
              <option value="NGN">NGN (₦ 奈拉)</option>
              <option value="CNY">CNY (¥ 人民币)</option>
              <option value="EUR">EUR (€ 欧元)</option>
              <option value="GBP">GBP (£ 英镑)</option>
              <option value="SGD">SGD (S$ 新元)</option>
              <option value="CAD">CAD (CA$ 加元)</option>
              <option value="PHP">PHP (₱ 比索)</option>
              <option value="INR">INR (₹ 卢比)</option>
              <option value="MYR">MYR (RM 令吉)</option>
              <option value="BRL">BRL (R$ 雷亚尔)</option>
            </select>
            <div id="direct-currency-wrap" class="ag-dropdown-wrapper" style="flex:1;min-width:0;max-width:270px">
              <div id="direct-currency-trigger" class="ag-dropdown-trigger" tabindex="0" title="该订阅记录使用的计价与结算币种 (独立保存，可手动指定或自动跟随)">
                <span id="direct-currency-label" class="ag-dropdown-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">USD ($ 美元)</span>
                <div class="ag-dropdown-arrow">
                  <svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>
                </div>
              </div>
              <div id="direct-currency-menu" class="ag-dropdown-menu"></div>
            </div>
            <span id="p-det-currency-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 5px;display:none;flex-shrink:0;white-space:nowrap">已保存</span>
          </dd>
          <dt>获取方式：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span id="p-det-acq">正常付费订阅</span>
            <span id="p-det-acq-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 4px;display:none">活动权益</span>
          </dd>
          <dt>计费周期与价格：</dt>
          <dd style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span id="p-det-price">地区参考价 $19.99/月</span>
            <span id="p-det-price-tag" class="key-pill pill-muted" style="font-size:11px;padding:1px 4px;display:none">地区参考价</span>
            <div id="price-mode-switch-group" style="display:inline-flex;align-items:center;gap:4px;margin-left:4px">
              <button id="btn-mode-preset" class="switch-pill-btn active" type="button" style="padding:1px 6px;font-size:11px" title="跟随当前订阅国家的官方定价动态联动">跟随参考价</button>
              <button id="btn-mode-custom" class="switch-pill-btn" type="button" style="padding:1px 6px;font-size:11px" title="手动指定用户真实实付金额（含0元/折扣等）">自定义实付</button>
            </div>
          </dd>
          <dt id="p-dt-validity" style="display:none">权益有效期：</dt>
          <dd id="p-det-validity" style="display:none;color:var(--ag-text-secondary);font-size:11px">—</dd>
          <dt id="p-dt-note" style="display:none">补充备注：</dt>
          <dd id="p-det-note" style="display:none;color:var(--ag-text-secondary);font-size:11px">—</dd>
          <dt>Prompt 额度池：</dt>
          <dd id="p-det-prompt-credits"><span id="p-det-credits">—</span></dd>
          <dt>Flow 额度池：</dt>
          <dd id="p-det-flow-credits">—</dd>
          <dt>状态更新时间：</dt>
          <dd id="p-det-time" style="font-size:11px;color:var(--ag-text-muted)">—</dd>
        </dl>

        <!-- 底部操作栏：左侧提供详情收回按钮，右侧提供自定义订阅设置按钮 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:6px;border-top:1px dashed var(--ag-border-subcard)">
          <button id="btn-plan-detail-collapse" class="switch-pill-btn" type="button" style="padding:3px 10px;font-size:11px" title="收回详情面板">详情收回 ▲</button>
          <button id="btn-edit-plan-custom" class="plan-edit-pill-btn" type="button" title="点击展开编辑当前账号订阅详细信息与实付设置">
            <span style="font-size:12px">✎</span>
            <span>自定义订阅设置</span>
          </button>
        </div>

        <!-- 就地行内自定义编辑表单 -->
        <div id="plan-custom-form" style="display:none;margin-top:8px;padding:10px;background:var(--ag-bg-subcard);border:1px solid var(--ag-border-subcard);border-radius:6px">
          <div style="font-size:11.5px;font-weight:600;margin-bottom:6px;color:var(--ag-text-primary)">
            自定义实付金额与订阅备注
          </div>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;margin-bottom:6px">
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">订阅渠道 / 优惠来源</label>
              <select id="select-custom-acq" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
                <option value="normal_paid">正常付费订阅</option>
                <option value="student_offer">学生认证优惠</option>
                <option value="pixel_bundle">Google Pixel 设备赠送</option>
                <option value="chromebook_bundle">Chromebook Plus 设备赠送</option>
                <option value="samsung_galaxy">Samsung Galaxy 设备指定活动</option>
                <option value="jio_offer">Jio 运营商套餐权益</option>
                <option value="partner_carrier">其他运营商 / 合作伙伴权益</option>
                <option value="family_sharing">家庭组共享 / 他人赠送</option>
                <option value="official_promo">官方限时试用 / 促销活动</option>
                <option value="custom_source">其他 / 自由命名</option>
              </select>
            </div>
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">自定义活动 / 合作方名称</label>
              <input id="input-custom-acq-name" type="text" placeholder="选填，如 Pixel 11 Pro 赠送" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
            </div>
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:11.5px;color:var(--ag-text-primary);display:flex;align-items:center;gap:6px;cursor:pointer">
              <input id="check-zero-extra" type="checkbox">
              <span>免费获取（0 元实付，如赠送 / 试用）</span>
            </label>
          </div>
          <div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
              <label style="font-size:11.5px;color:var(--ag-text-muted)">预设订阅国家与汇率 (可选快捷套用)</label>
              <span id="region-cny-preview" style="font-size:11px;color:var(--ag-text-secondary)"></span>
            </div>
            <select id="select-custom-region-preset" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;margin-bottom:4px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
              <option value="">-- 选择预设地区 (自动填入价格与汇率) --</option>
              <option value="US">🇺🇸 美国 (US) · $19.99/月 (折合 ≈ ¥134.3)</option>
              <option value="KR">🇰🇷 韩国 (KR) · ₩29,000/月 (折合 ≈ ¥147.9)</option>
              <option value="HK">🇭🇰 中国香港 (HK) · HK$158/月 (折合 ≈ ¥135.4)</option>
              <option value="JP">🇯🇵 日本 (JP) · ¥2,900/月 (折合 ≈ ¥123.3)</option>
              <option value="TR">🇹🇷 土耳其 (TR) · ₺869.99/月 (折合 ≈ ¥115.7)</option>
              <option value="NG">🇳🇬 尼日利亚 (NG) · ₦28,500/月 (折合 ≈ ¥119.7)</option>
              <option value="TW">🇹🇼 中国台湾 (TW) · NT$650/月 (折合 ≈ ¥136.5)</option>
              <option value="PH">🇵🇭 菲律宾 (PH) · ₱1,100/月 (折合 ≈ ¥128.7)</option>
              <option value="IN">🇮🇳 印度 (IN) · ₹1,950/月 (折合 ≈ ¥148.2)</option>
              <option value="GB">🇬🇧 英国 (UK) · £18.99/月 (折合 ≈ ¥166.2)</option>
              <option value="EU">🇪🇺 欧洲 (EU) · €21.99/月 (折合 ≈ ¥165.4)</option>
              <option value="BR">🇧🇷 巴西 (BR) · R$96.99/月 (折合 ≈ ¥114.4)</option>
              <option value="SG">🇸🇬 新加坡 (SG) · S$27.99/月 (折合 ≈ ¥143.3)</option>
              <option value="CA">🇨🇦 加拿大 (CA) · CA$26.99/月 (折合 ≈ ¥131.7)</option>
              <option value="AU">🇦🇺 澳大利亚 (AU) · AU$32.99/月 (折合 ≈ ¥146.8)</option>
              <option value="MY">🇲🇾 马来西亚 (MY) · RM 97.99/月 (折合 ≈ ¥151.9)</option>
              <option value="CN">🇨🇳 中国大陆/自定义 (CNY) · ¥140/月</option>
              <option value="custom">✎ 自定义输入地区</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:6px">
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">账号所在地区 (仅本地记录)</label>
              <input id="input-custom-country" type="text" placeholder="例如：美国 (US)" title="仅作为本地显示记录，不修改实际 Google 账号" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
            </div>
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">订阅国家 (购买/结算地区)</label>
              <input id="input-custom-region" type="text" placeholder="例如：韩国 / 澳大利亚" title="实际购买或支付订阅所在的国家或地区" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
            </div>
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">订阅币种与实付金额</label>
              <div style="display:flex;gap:4px">
                <select id="select-custom-currency" title="订阅计价/结算币种" style="height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
                  <option value="USD">USD</option>
                  <option value="KRW">KRW</option>
                  <option value="HKD">HKD</option>
                  <option value="JPY">JPY</option>
                  <option value="TRY">TRY</option>
                  <option value="NGN">NGN</option>
                  <option value="TWD">TWD</option>
                  <option value="PHP">PHP</option>
                  <option value="INR">INR</option>
                  <option value="CNY">CNY</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="SGD">SGD</option>
                  <option value="BRL">BRL</option>
                  <option value="CAD">CAD</option>
                  <option value="AUD">AUD</option>
                  <option value="MYR">MYR</option>
                </select>
                <input id="input-custom-paid" type="number" step="0.01" placeholder="实付金额" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:6px">
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">计费周期</label>
              <select id="select-custom-cycle" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
                <option value="月付">月付</option>
                <option value="年付">年付</option>
                <option value="免费/赠送">免费 / 促销赠送</option>
                <option value="随套餐包含">随套餐包含</option>
                <option value="其他周期">其他周期</option>
              </select>
            </div>
            <div>
              <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">权益到期日</label>
              <input id="input-valid-end" type="date" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
            </div>
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:11.5px;color:var(--ag-text-muted);display:block;margin-bottom:2px">备注说明（选填）</label>
            <input id="input-custom-note" type="text" placeholder="例如：Pixel 11 Pro 赠送 6 个月 / 家庭拼车" style="width:100%;height:28px;font-size:11.5px;padding:0 8px;box-sizing:border-box;background:var(--ag-bg-input);border:1px solid var(--ag-border-subcard);border-radius:5px;color:var(--ag-text-primary)">
          </div>
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px">
            <button id="btn-custom-plan-clear" class="switch-pill-btn" type="button" style="padding:2px 8px;font-size:11px;color:var(--ag-text-danger,#f87171)">清除自定义</button>
            <button id="btn-custom-plan-cancel" class="switch-pill-btn" type="button" style="padding:2px 8px;font-size:11px">取消</button>
            <button id="btn-custom-plan-save" class="switch-pill-btn active" type="button" style="padding:2px 10px;font-size:11px">保存</button>
          </div>
        </div>
      </div>

      <!-- API 费用估算卡片（整个费用面板默认收为小摘要，展开后才显示详情） -->
      <div id="cost-estimate-card" style="display:none;background:var(--ag-bg-card);border:1px solid var(--ag-border-card);border-radius:8px;padding:12px;margin-bottom:10px">
        <!-- 紧凑小摘要区（默认常驻展示） -->
        <div id="cost-compact-summary">
          <!-- 1. 标题与范围标签 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span id="cost-card-title" style="font-size:12.5px;font-weight:600;color:var(--ag-text-primary)">💰 本期 API 参考金额</span>
            <span id="cost-period-tag" class="key-pill pill-muted" style="font-size:11px">本月自然月</span>
          </div>
          <!-- 2. 来源与时间短行 -->
          <div id="cost-scope-desc" style="font-size:11px;color:var(--ag-text-muted);margin-bottom:6px">全部来源 · 2026-11 自然月</div>
          <!-- 3. 主要参考金额及常驻“非实付”标识 -->
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <div id="cost-grand-val" style="font-size:22px;font-weight:700;color:var(--ag-text-primary);letter-spacing:-0.5px">约 $0.00</div>
            <span id="cost-non-paid-badge" class="key-pill pill-muted" style="font-size:11px;padding:1px 6px">API 折算 · 非实付</span>
          </div>
          <!-- 4. 一行参考模型/情景假设 -->
          <div id="cost-grand-sub" style="font-size:11px;color:var(--ag-text-secondary);margin-bottom:6px;line-height:1.35">统一按 Gemini 3.8 Flash 估算</div>
          <!-- 5. 一行订阅实付及补充入口 -->
          <div id="cost-sub-line-wrap" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--ag-bg-subcard);border-radius:6px;margin:6px 0 8px">
            <div style="display:flex;align-items:center;gap:4px">
              <span id="cost-sub-line" style="font-size:11px;color:var(--ag-text-primary)">订阅实付：未填写</span>
              <span id="cost-sub-spend-val" style="display:none">实付未知</span>
              <span id="cost-sub-compare-note" style="display:none">公开参考价 $19.99/月</span>
              <span id="cost-sub-spend-lbl" style="display:none">本人同期实际支出</span>
            </div>
            <button id="btn-cost-fill-sub" class="switch-pill-btn" type="button" style="padding:1px 6px;font-size:11px" title="设置当前账号订阅来源与实付金额">补充</button>
          </div>
          <!-- 6. 展开详情入口 -->
          <div id="cost-expand-bar" style="display:flex;justify-content:flex-end">
            <button id="btn-cost-details-toggle" class="switch-pill-btn" type="button" style="padding:2px 10px;font-size:11px">展开详情 ▼</button>
          </div>
        </div>

        <!-- 详细选项与分析区（展开后完整呈现，默认收起） -->
        <div id="cost-details-pane" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--ag-border-subcard)">
          <!-- 高级控制条：范围与覆盖率 -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
            <span style="font-size:11px;color:var(--ag-text-muted)">统计范围:</span>
            <div style="display:flex;align-items:center;gap:4px">
              <button id="cost-btn-scope-period" class="switch-pill-btn active" type="button" style="padding:1px 6px;font-size:11px">本期</button>
              <button id="cost-btn-scope-all" class="switch-pill-btn" type="button" style="padding:1px 6px;font-size:11px">全量历史</button>
              <span id="cost-coverage-pill" class="key-pill pill-muted" style="font-size:11px">100% 折算覆盖</span>
            </div>
          </div>

          <!-- 估值模式快捷切换（中性“参考模型估算”） -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--ag-border-subcard)">
            <span style="font-size:11px;color:var(--ag-text-muted)">估值模式:</span>
            <div class="source-switch-bar">
              <button id="cost-btn-mode-ref" class="switch-pill-btn active" type="button" style="padding:1px 6px;font-size:11px">参考模型估算</button>
              <button id="cost-btn-mode-hybrid" class="switch-pill-btn" type="button" style="padding:1px 6px;font-size:11px">混合模式</button>
              <button id="cost-btn-mode-identified" class="switch-pill-btn" type="button" style="padding:1px 6px;font-size:11px">仅已识别模型</button>
            </div>
          </div>

          <!-- 用量与参考差额指标条（注明包含缓存读取） -->
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;background:var(--ag-bg-subcard);border-radius:6px;margin-bottom:8px">
            <span id="cost-usage-summary" style="font-size:11px;font-weight:600;color:var(--ag-text-primary)">累计处理 Token: -- (含 -- 缓存读取)</span>
            <span id="cost-diff-summary" style="font-size:11px;color:var(--ag-text-muted)">参考差额约 +$0.00 (API 折算 - 实际支出)</span>
          </div>

          <!-- 分类单价与公式明细卡片（输入、缓存读取、输出） -->
          <div id="ref-cost-breakdown-cards" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px">
            <div class="t-card" style="padding:6px">
              <div style="font-size:11px;color:var(--ag-text-muted)">输入 Token ($0.75/M)</div>
              <div id="ref-cost-input-val" style="font-size:12px;font-weight:600;color:var(--ag-text-primary)">$0.00</div>
              <div id="ref-cost-input-tok" style="font-size:11px;color:var(--ag-text-muted)">0 tok</div>
            </div>
            <div class="t-card" style="padding:6px">
              <div style="font-size:11px;color:var(--ag-text-muted)">缓存读取 (约 $0.08/M 优惠)</div>
              <div id="ref-cost-cache-val" style="font-size:12px;font-weight:600;color:var(--ag-text-primary)">$0.00</div>
              <div id="ref-cost-cache-tok" style="font-size:11px;color:var(--ag-text-muted)">0 tok</div>
            </div>
            <div class="t-card" style="padding:6px">
              <div style="font-size:11px;color:var(--ag-text-muted)">输出 Token ($3.75/M)</div>
              <div id="ref-cost-output-val" style="font-size:12px;font-weight:600;color:var(--ag-text-primary)">$0.00</div>
              <div id="ref-cost-output-tok" style="font-size:11px;color:var(--ag-text-muted)">0 tok</div>
            </div>
          </div>

          <!-- 详细分析与未计价原因 -->
          <div id="cost-breakdown-info" style="font-size:11px;color:var(--ag-text-secondary);line-height:1.4;padding-top:6px;border-top:1px solid var(--ag-border-subcard)">
            正在分析请求模型与计价覆盖率…
          </div>

          <div style="font-size:11px;color:var(--ag-text-muted);line-height:1.4;margin-top:8px">
            注：此处按公开 API 单价折算同等用量，仅供价值参考。包月订阅或活动赠送与按量付费不同，差额不代表实际省下的现金；缓存读取按 1 折估算，不含缓存存储费；同一上下文在多轮中会重复计入缓存读取，总量不代表实际输入字数。
          </div>

          <!-- 底部收起详情按钮 -->
          <div style="display:flex;justify-content:center;margin-top:10px">
            <button id="btn-cost-details-collapse" class="switch-pill-btn" type="button" style="padding:2px 14px;font-size:11px">收起详情 ▴</button>
          </div>
        </div>

        <!-- 隐藏辅助兼容层 -->
        <div id="ref-cost-drawer-body" style="display:none">
          <span id="ref-cost-grand-val">$0.00</span>
          <span id="ref-cost-mode-label">参考模型折算</span>
          <button id="btn-toggle-ref-cost-drawer" type="button" style="display:none"></button>
          <button id="btn-ref-mode-all" type="button" style="display:none"></button>
          <button id="btn-ref-mode-hybrid" type="button" style="display:none"></button>
        </div>
      </div>

      <!-- 专属 Token 统计页（包含卡片统计、热力图与调色抽屉，费用模式下完全不渲染） -->
      <div id="tokens-main-view">
        <div class="token-stat-cards" id="token-stat-cards">
          <div class="t-card">
            <div class="t-card-lbl"><span>累计处理 Token</span><span style="color:var(--ag-text-muted)">总计</span></div>
            <div style="font-size:11px;color:var(--ag-text-muted);margin:-2px 0 4px">含缓存读取</div>
            <div class="t-card-val" id="t-total-val">--</div>
            <div class="t-card-sub" id="t-total-sub">读取中...</div>
            <div class="t-card-cost" id="t-total-cost">≈ $0.00 (¥0.00) · 日均 $0.00</div>
          </div>
          <div class="t-card">
            <div class="t-card-lbl"><span>今日使用</span><span style="color:var(--ag-text-muted)">今日</span></div>
            <div class="t-card-val" id="t-today-val">--</div>
            <div class="t-card-sub" id="t-today-sub">读取中...</div>
            <div class="t-card-cost" id="t-today-cost">≈ $0.00 (¥0.00)</div>
          </div>
          <div class="t-card">
            <div class="t-card-lbl"><span>本月使用</span><span style="color:var(--ag-text-muted)">本月</span></div>
            <div class="t-card-val" id="t-month-val">--</div>
            <div class="t-card-sub" id="t-month-sub">读取中...</div>
            <div class="t-card-cost" id="t-month-cost">≈ $0.00 (¥0.00) · 日均 $0.00</div>
          </div>
          <div class="t-card">
            <div class="t-card-lbl"><span>年度使用</span><span style="color:var(--ag-text-muted)">本年</span></div>
            <div class="t-card-val" id="t-year-val">--</div>
            <div class="t-card-sub" id="t-year-sub">读取中...</div>
            <div class="t-card-cost" id="t-year-cost">≈ $0.00 (¥0.00) · 日均 $0.00</div>
          </div>
        </div>

      <div class="heatmap-section">
        <div class="heat-header">
          <div class="heat-header-left">
            <div class="heat-title">Token 活动</div>
            <span id="first-use-badge" class="first-use-badge">首次使用：--</span>
            <div class="heat-win-nav">
              <button id="h-page-prev" class="heat-nav-btn" type="button" title="查看更早的 12 个月窗口" disabled>‹</button>
              <span id="h-win-range">--</span>
              <button id="h-page-next" class="heat-nav-btn" type="button" title="查看更新的 12 个月窗口" disabled>›</button>
            </div>
          </div>
          <div class="heat-tabs" id="heat-tabs-bar" role="tablist" aria-label="热力图统计周期">
            <div class="heat-tab-thumb" id="heat-tab-thumb" aria-hidden="true"></div>
            <button class="heat-tab-btn active" id="h-tab-daily" role="tab" aria-selected="true" type="button" tabindex="0">每天</button>
            <button class="heat-tab-btn" id="h-tab-weekly" role="tab" aria-selected="false" type="button" tabindex="-1">每周</button>
            <button class="heat-tab-btn" id="h-tab-monthly" role="tab" aria-selected="false" type="button" tabindex="-1">每月</button>
            <button class="heat-tab-btn" id="h-tab-yearly" role="tab" aria-selected="false" type="button" tabindex="-1">今年</button>
            <button class="heat-tab-btn" id="h-tab-cum" role="tab" aria-selected="false" type="button" tabindex="-1">累计总量</button>
          </div>
        </div>
        <div class="heat-scroll-box" id="h-scroll-box">
          <div id="h-daily-box">
            <div class="heat-grid-cols" id="h-grid-cols"></div>
            <div class="heat-months" id="h-months"></div>
          </div>
          <div id="h-weekly-box" style="display:none"></div>
          <div id="h-monthly-box" style="display:none"></div>
          <div id="h-yearly-box" style="display:none"></div>
          <div id="h-cum-box" style="display:none">
            <canvas id="h-cum-canvas"></canvas>
          </div>
        </div>
        <div id="h-summary-bar" class="heat-summary-bar">
          <div class="heat-sum-item">
            <span class="heat-sum-label">区间合计:</span>
            <span id="h-sum-tokens" class="heat-sum-val">-- Tokens</span>
          </div>
          <div class="heat-sum-item">
            <span class="heat-sum-label">预估费用:</span>
            <span id="h-sum-cost" class="heat-sum-val">≈ $0.00 (¥0.00)</span>
          </div>
          <div class="heat-sum-item">
            <span class="heat-sum-label">折合每天:</span>
            <span id="h-sum-daily-avg" class="heat-sum-val">$0.00</span>
          </div>
          <div class="heat-sum-item">
            <span class="heat-sum-label">活跃日均:</span>
            <span id="h-sum-active-avg" class="heat-sum-val">$0.00 (0天)</span>
          </div>
          <div id="h-sum-sub-ratio-wrap" class="heat-sum-item" style="display:none">
            <span class="heat-sum-label">订阅性价比:</span>
            <span id="h-sum-sub-ratio" class="heat-sum-val" style="color:var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))">--</span>
          </div>
        </div>
        <div class="heat-cost-disclaimer">
          说明：每日统计按基础费率估算（未单独拆分长上下文阶梯价），实际金额可能略高；若有逐次请求记录则优先按实计算。
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11px;color:var(--ag-text-muted);flex-wrap:wrap;gap:6px">
          <span>点击或悬浮格子查看当日详细 Token 构成</span>
          <div style="display:flex;align-items:center;gap:6px">
            <div id="heat-legend-scale" style="display:flex;align-items:center;gap:4px;cursor:pointer" title="点击任一色块单独修改该档位颜色，或点击文字展开设置">
              <span>少</span>
              <button id="heat-leg-0" class="heat-leg-swatch" type="button" data-color-slot="heatLvl0" data-color-label="色阶第 1 档（少/无用量）" title="第 1 档（少/无用量）：点击单独修改此格颜色"></button>
              <button id="heat-leg-1" class="heat-leg-swatch" type="button" data-color-slot="heatLvl1" data-color-label="色阶第 2 档（低用量）" title="第 2 档（低用量）：点击单独修改此格颜色"></button>
              <button id="heat-leg-2" class="heat-leg-swatch" type="button" data-color-slot="heatLvl2" data-color-label="色阶第 3 档（中等用量）" title="第 3 档（中等用量）：点击单独修改此格颜色"></button>
              <button id="heat-leg-3" class="heat-leg-swatch" type="button" data-color-slot="heatLvl3" data-color-label="色阶第 4 档（高用量）" title="第 4 档（高用量）：点击单独修改此格颜色"></button>
              <button id="heat-leg-4" class="heat-leg-swatch" type="button" data-color-slot="heatLvl4" data-color-label="色阶第 5 档（多/峰值用量）" title="第 5 档（多/峰值用量）：点击单独修改此格颜色"></button>
              <span>多</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 二级交互折叠区（就近放置于面板 A 内部）：面板背景色 + 热力图 5 档色阶预设、5 档逐格独立自定义与两端插值自定义 -->
      <div class="tech-drawer" id="token-colors-drawer" style="margin-top:2px">
        <button id="btn-toggle-token-colors" class="drawer-trigger" aria-expanded="false" type="button">
          <span class="drawer-trigger-left"><span>🎨 热力图色阶与面板外观自定义（默认跟随主题）</span></span>
          <span id="token-color-drawer-arrow" class="drawer-arrow">▼ 展开设置</span>
        </button>
        <div id="token-color-drawer-body" class="drawer-body" style="display:none;">
          <div class="heat-preset-bar">
            <span style="font-size:11px;color:var(--ag-text-secondary);font-weight:500">整体主题色系：</span>
            <div class="heat-preset-group" id="heat-preset-group">
              <button class="heat-preset-btn" type="button" data-heat-preset="purple" data-active="true">
                <span class="heat-preset-dots"><i style="background:#27272a"></i><i style="background:#3f1e6b"></i><i style="background:#652ab7"></i><i style="background:#9053f8"></i><i style="background:#c084fc"></i></span>
                <span>紫色系</span>
              </button>
              <button class="heat-preset-btn" type="button" data-heat-preset="yellow" data-active="false">
                <span class="heat-preset-dots"><i style="background:#27272a"></i><i style="background:#713f12"></i><i style="background:#a16207"></i><i style="background:#eab308"></i><i style="background:#fde047"></i></span>
                <span>黄色系</span>
              </button>
              <button class="heat-preset-btn" type="button" data-heat-preset="green" data-active="false">
                <span class="heat-preset-dots"><i style="background:#27272a"></i><i style="background:#14532d"></i><i style="background:#15803d"></i><i style="background:#22c55e"></i><i style="background:#86efac"></i></span>
                <span>绿色系</span>
              </button>
              <button class="heat-preset-btn" type="button" data-heat-preset="blue" data-active="false">
                <span class="heat-preset-dots"><i style="background:#27272a"></i><i style="background:#1e3a8a"></i><i style="background:#1d4ed8"></i><i style="background:#3b82f6"></i><i style="background:#93c5fd"></i></span>
                <span>蓝色系</span>
              </button>
              <button class="heat-preset-btn" type="button" data-heat-preset="red" data-active="false">
                <span class="heat-preset-dots"><i style="background:#27272a"></i><i style="background:#7f1d1d"></i><i style="background:#b91c1c"></i><i style="background:#ef4444"></i><i style="background:#fca5a5"></i></span>
                <span>红色系</span>
              </button>
            </div>
          </div>

          <div id="heat-advanced-colors-box" style="display:none;margin-top:8px;">
            <div class="heat-lvl-custom-bar">
              <div class="heat-lvl-custom-hdr">
                <span style="font-size:11px;color:var(--ag-text-secondary);font-weight:500">热力图 5 档深浅单独调色（点击色块可逐档修改）：</span>
                <button id="reset-heat-lvls" class="color-reset-btn" type="button">恢复 5 档预设</button>
              </div>
              <div class="heat-lvl-grid" id="heat-lvl-grid">
                <div class="heat-lvl-item">
                  <span class="heat-lvl-lbl" title="第 1 档（少/无用量）">1档 · 少/无</span>
                  <div class="color-item-ctrls">
                    <input id="color-heatLvl0" class="color-picker" type="color" value="#27272a" aria-label="热力图第1档颜色" />
                    <button id="swatch-heatLvl0" class="color-swatch-btn" type="button" data-color-slot="heatLvl0" data-color-label="色阶第 1 档（少/无用量）" title="点击单独设置第 1 档颜色"></button>
                    <button id="reset-heatLvl0" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                  </div>
                </div>
                <div class="heat-lvl-item">
                  <span class="heat-lvl-lbl" title="第 2 档（低用量）">2档 · 低</span>
                  <div class="color-item-ctrls">
                    <input id="color-heatLvl1" class="color-picker" type="color" value="#3f1e6b" aria-label="热力图第2档颜色" />
                    <button id="swatch-heatLvl1" class="color-swatch-btn" type="button" data-color-slot="heatLvl1" data-color-label="色阶第 2 档（低用量）" title="点击单独设置第 2 档颜色"></button>
                    <button id="reset-heatLvl1" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                  </div>
                </div>
                <div class="heat-lvl-item">
                  <span class="heat-lvl-lbl" title="第 3 档（中等用量）">3档 · 中</span>
                  <div class="color-item-ctrls">
                    <input id="color-heatLvl2" class="color-picker" type="color" value="#652ab7" aria-label="热力图第3档颜色" />
                    <button id="swatch-heatLvl2" class="color-swatch-btn" type="button" data-color-slot="heatLvl2" data-color-label="色阶第 3 档（中等用量）" title="点击单独设置第 3 档颜色"></button>
                    <button id="reset-heatLvl2" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                  </div>
                </div>
                <div class="heat-lvl-item">
                  <span class="heat-lvl-lbl" title="第 4 档（高用量）">4档 · 高</span>
                  <div class="color-item-ctrls">
                    <input id="color-heatLvl3" class="color-picker" type="color" value="#9053f8" aria-label="热力图第4档颜色" />
                    <button id="swatch-heatLvl3" class="color-swatch-btn" type="button" data-color-slot="heatLvl3" data-color-label="色阶第 4 档（高用量）" title="点击单独设置第 4 档颜色"></button>
                    <button id="reset-heatLvl3" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                  </div>
                </div>
                <div class="heat-lvl-item">
                  <span class="heat-lvl-lbl" title="第 5 档（多/峰值用量）">5档 · 多/峰</span>
                  <div class="color-item-ctrls">
                    <input id="color-heatLvl4" class="color-picker" type="color" value="#c084fc" aria-label="热力图第5档颜色" />
                    <button id="swatch-heatLvl4" class="color-swatch-btn" type="button" data-color-slot="heatLvl4" data-color-label="色阶第 5 档（多/峰值用量）" title="点击单独设置第 5 档颜色"></button>
                    <button id="reset-heatLvl4" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="color-grid">
              <div class="color-item">
                <span class="color-item-lbl">热力图起始色（自动生成渐变）</span>
                <div class="color-item-ctrls">
                  <input id="color-heatLow" class="color-picker" type="color" value="#27272a" aria-label="热力图少端颜色" />
                  <button id="swatch-heatLow" class="color-swatch-btn" type="button" data-color-slot="heatLow" data-color-label="热力图起始色" title="点击打开颜色选取器"></button>
                  <button id="reset-heatLow" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                </div>
              </div>
              <div class="color-item">
                <span class="color-item-lbl">热力图峰值色（自动生成渐变）</span>
                <div class="color-item-ctrls">
                  <input id="color-heatHigh" class="color-picker" type="color" value="#c084fc" aria-label="热力图多端颜色" />
                  <button id="swatch-heatHigh" class="color-swatch-btn" type="button" data-color-slot="heatHigh" data-color-label="热力图峰值色" title="点击打开颜色选取器"></button>
                  <button id="reset-heatHigh" class="color-reset-btn" type="button" data-mode="auto">预设</button>
                </div>
              </div>
              <div class="color-item" id="token-drawer-mirror-bg">
                <span class="color-item-lbl">浮窗与面板背景色</span>
                <div class="color-item-ctrls">
                  <button id="swatch-panelBg-tokens" class="color-swatch-btn" type="button" data-color-slot="panelBg" data-color-label="浮窗与面板背景色" title="点击打开颜色选取器"></button>
                  <button id="reset-panelBg-tokens" class="color-reset-btn" type="button" data-mode="auto">跟随主题</button>
                </div>
              </div>
              <div class="color-item" id="token-drawer-mirror-accent">
                <span class="color-item-lbl">全局强调与顶部总数色</span>
                <div class="color-item-ctrls">
                  <button id="swatch-tokenTotal-tokens" class="color-swatch-btn" type="button" data-color-slot="tokenTotal" data-color-label="顶部总 Token 数" title="总累计颜色"></button>
                  <button id="swatch-tokenAccent-tokens" class="color-swatch-btn" type="button" data-color-slot="tokenAccent" data-color-label="全局主题强调色" title="强调指标颜色"></button>
                  <button id="reset-all-colors-tokens" class="color-reset-btn" type="button">全部恢复跟随主题</button>
                </div>
              </div>
            </div>
          </div>

          <div id="auto-update-setting-row" hidden style="display:none;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px dashed var(--ag-border-subcard);font-size:11px">
            <span style="color:var(--ag-text-primary);font-weight:500">更新设置</span>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--ag-text-secondary)">
              <input id="check-auto-update" type="checkbox">
              <span>启动时自动检查更新（不自动安装）</span>
            </label>
          </div>
        </div>
      </div>
      </div><!-- end #tokens-main-view -->
    </div>
  </section>

  <!-- 自定义颜色选取器面板（替换系统原生取色器） -->
  <div id="color-picker-popover" hidden role="dialog" aria-label="颜色选取器">
    <div class="cp-header">
      <div class="cp-title">
        <span>颜色选取器</span>
        <span id="cp-target-name" class="cp-target-lbl"></span>
      </div>
      <button id="cp-close" class="panel-icon-btn" type="button" aria-label="关闭颜色选取器">×</button>
    </div>
    <div class="cp-toolbar">
      <button id="cp-eyedropper" class="cp-eyedropper-btn" type="button" title="从屏幕吸取颜色">取色</button>
      <div class="cp-presets" id="cp-presets">
        <button class="cp-preset-dot" type="button" data-cp-hex="#ef4444" style="background:#ef4444" title="#EF4444"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#f97316" style="background:#f97316" title="#F97316"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#eab308" style="background:#eab308" title="#EAB308"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#22c55e" style="background:#22c55e" title="#22C55E"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#06b6d4" style="background:#06b6d4" title="#06B6D4"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#3b82f6" style="background:#3b82f6" title="#3B82F6"></button>
        <button class="cp-preset-dot" type="button" data-cp-hex="#a855f7" style="background:#a855f7" title="#A855F7"></button>
      </div>
    </div>
    <div class="cp-stage">
      <div id="cp-side-preview" class="cp-side-preview"></div>
      <div id="cp-sv-area" class="cp-sv-area">
        <div id="cp-sv-thumb" class="cp-sv-thumb"></div>
      </div>
    </div>
    <div id="cp-hue-wrap" class="cp-hue-wrap">
      <div id="cp-hue-thumb" class="cp-hue-thumb"></div>
    </div>
    <div class="cp-rows">
      <div class="cp-row">
        <span class="cp-fmt-lbl">HEX</span>
        <input id="cp-input-hex" class="cp-fmt-input" type="text" value="#652ab7" spellcheck="false" aria-label="HEX 色值输入" />
        <button id="cp-copy-hex" class="cp-copy-btn" type="button" title="复制 HEX">复制</button>
      </div>
      <details class="cp-advanced-formats">
        <summary class="cp-fmt-summary">更多格式 (RGB / HSL)</summary>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          <div class="cp-row">
            <span class="cp-fmt-lbl">RGB</span>
            <input id="cp-input-rgb" class="cp-fmt-input" type="text" value="rgb(101, 42, 183)" spellcheck="false" aria-label="RGB 色值输入" />
            <button id="cp-copy-rgb" class="cp-copy-btn" type="button" title="复制 RGB">复制</button>
          </div>
          <div class="cp-row">
            <span class="cp-fmt-lbl">HSL</span>
            <input id="cp-input-hsl" class="cp-fmt-input" type="text" value="hsl(265, 63%, 44%)" spellcheck="false" aria-label="HSL 色值输入" />
            <button id="cp-copy-hsl" class="cp-copy-btn" type="button" title="复制 HSL">复制</button>
          </div>
        </div>
      </details>
    </div>
    <div class="cp-footer">
      <span id="cp-status-msg" style="font-size:11px;color:var(--ag-text-muted)">支持直接输入或粘贴 HEX 色值</span>
      <button id="cp-reset-slot" class="color-reset-btn" type="button">跟随主题</button>
    </div>
  </div>

  <!-- 全局在线更新浮层（跨面板独立定位与显示） -->
  <div class="update-popover" id="update-popover" style="display:none" role="dialog" aria-label="版本更新详情">
    <div class="update-pop-hdr">
      <div style="display:flex;align-items:center;gap:6px">
        <span id="up-pop-title" style="font-weight:600;font-size:12px;color:var(--ag-text-primary)">检查更新</span>
        <span id="up-pop-ver" class="key-pill pill-good" style="font-size:10px">v0.9.0</span>
      </div>
      <button id="btn-close-update-pop" class="panel-icon-btn" type="button" style="padding:1px 5px;font-size:13px">×</button>
    </div>
    <div id="up-pop-body" class="update-pop-body">
      正在检测最新版本…
    </div>
    <div id="up-pop-footer" class="update-pop-footer">
      <button id="btn-view-release-page" class="switch-pill-btn" type="button">查看发布页</button>
      <button id="btn-update-later" class="switch-pill-btn" type="button">稍后</button>
      <button id="btn-apply-update" class="switch-pill-btn active" type="button">立即更新</button>
    </div>
    <div id="up-pop-status" style="display:none;font-size:11px;color:var(--ag-text-muted);margin-top:6px;text-align:center"></div>
  </div>

  <!-- 热力图浮动 Tooltip -->
  <div class="heat-popover" id="heat-pop">
    <div class="pop-date" id="heat-pop-date">10月24日</div>
    <div class="pop-val" id="heat-pop-val">2.47亿 个 Token</div>
    <div class="pop-det" id="heat-pop-det"></div>
  </div>
<!-- 弹出式面板 3: Antigravity Suite 统一设置面板 (#panel-settings, 640px) -->
  <section id="panel-settings" class="ag-panel" hidden aria-label="套件统一设置">
    <div class="panel-header-bar">
      <div class="panel-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;color:var(--ag-custom-token-accent,var(--ag-token-accent-default))"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.82 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.69 0-1.25.4-1.51 1z"/></svg>
        <span style="font-size:14.5px;font-weight:600;color:var(--ag-text-primary)">Antigravity Suite 统一设置</span>
      </div>
      <div class="panel-header-actions">
        <span id="suite-ver-status" class="key-pill pill-muted" title="当前版本状态">v0.9.0</span>
        <button id="btn-suite-apply-update" class="switch-pill-btn active" type="button" hidden title="下载最新版本并立即生效，无需重启">立即更新</button>
        <button id="close-settings" class="panel-icon-btn" type="button" aria-label="关闭设置">×</button>
      </div>
    </div>

    <div id="settings-tabs-bar" class="settings-tabs-bar" role="tablist" aria-label="设置分类">
      <button id="settings-tab-btn-appearance" class="settings-tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="settings-pane-appearance" tabindex="0" data-settings-tab="appearance">🌐 语言与外观</button>
      <button id="settings-tab-btn-remote" class="settings-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="settings-pane-remote" tabindex="-1" data-settings-tab="remote">📱 远程设置</button>
      <button id="settings-tab-btn-chat" class="settings-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="settings-pane-chat" tabindex="-1" data-settings-tab="chat">⚡ 对话与效率</button>
      <button id="settings-tab-btn-network" class="settings-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="settings-pane-network" tabindex="-1" data-settings-tab="network">🧰 终端与网络</button>
      <button id="settings-tab-btn-subscription" class="settings-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="settings-pane-subscription" tabindex="-1" data-settings-tab="subscription">📊 套餐与订阅</button>
    </div>

    <div id="settings-body" class="settings-body">
      <!-- 分页 1: 语言与外观 -->
      <div id="settings-pane-appearance" class="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab-btn-appearance">
        <div id="settings-card-lang-appearance" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">语言与明暗外观</span>
          </div>
          <div class="settings-pref-list">
            <div class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">插件与客户端语言</span>
                <span class="settings-pref-desc">同时切换主界面、设置面板、Dock 提醒及浮窗的显示语言</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-ui-language-select" class="settings-select" aria-label="插件与客户端语言">
                  <option value="zh-TW">繁體中文 · Traditional Chinese</option>
                  <option value="zh-CN">简体中文 · Simplified Chinese</option>
                  <option value="en">English · 英文原版</option>
                </select>
              </div>
            </div>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">模式与档位名保留英文</span>
                <span class="settings-pref-desc">中文界面下保留 Default / Auto / Turbo 及 High / Medium / Low 等英文原名</span>
              </div>
              <input id="set-english-labels" type="checkbox" class="settings-checkbox" />
            </label>
            <div class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">面板深浅外观</span>
                <span class="settings-pref-desc">设置所有插件浮窗与设置面板的明暗配色</span>
              </div>
              <div class="source-switch-bar">
                <button id="set-theme-auto" class="switch-pill-btn active" type="button">跟随客户端</button>
                <button id="set-theme-light" class="switch-pill-btn" type="button">浅色</button>
                <button id="set-theme-dark" class="switch-pill-btn" type="button">深色</button>
              </div>
            </div>
          </div>
        </div>

        <div id="settings-card-dock-badge" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">macOS Dock 未读与状态提醒</span>
            <div class="settings-card-hdr-actions">
              <button id="btn-test-dock-badge" class="switch-pill-btn" type="button" title="在 Dock 图标上短暂预览角标与状态胶囊效果">测试提醒</button>
              <button id="btn-dock-open-ax" class="switch-pill-btn" type="button" hidden title="打开 macOS 系统设置，开启「辅助功能」权限以显示 Dock 图标提醒">前往开启权限</button>
            </div>
          </div>
          <div id="dock-badge-status-note" class="settings-status-note">正在检查 macOS Dock 图标提醒状态…</div>
          <div class="settings-pref-list">
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">启用 macOS Dock 图标提醒</span>
                <span class="settings-pref-desc">不修改官方程序；后台有新回复、待审批或高危拦截时即时提醒，关闭后即彻底停用、不占后台资源</span>
              </div>
              <input id="set-dock-badge-enabled" type="checkbox" class="settings-checkbox" checked />
            </label>
            <div class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">提醒样式</span>
                <span class="settings-pref-desc">带状态胶囊可在图标下方直观区分生成中、新回复与待审批；仅显示角标只在右上角显示数字（有待审批时优先显示待审批数）</span>
              </div>
              <div class="source-switch-bar" role="group" aria-label="提醒样式">
                <button id="set-dock-style-capsule" class="switch-pill-btn active" type="button">带状态胶囊（推荐）</button>
                <button id="set-dock-style-badge" class="switch-pill-btn" type="button">仅显示角标</button>
              </div>
            </div>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">用蓝 / 红区分未读与待审批</span>
                <span class="settings-pref-desc">待审批与高危拦截用红色优先提醒，普通新回复用蓝色；关闭后全部显示为红色</span>
              </div>
              <input id="set-dock-badge-color-tier" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">切回窗口自动清除普通未读</span>
                <span class="settings-pref-desc">切回 Antigravity 窗口即自动清除普通新回复提醒；待审批与高危红标会保留，直到你处理完成</span>
              </div>
              <input id="set-dock-badge-autoclear" type="checkbox" class="settings-checkbox" checked />
            </label>
          </div>
        </div>

        <div id="settings-card-features" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">桌面功能显示开关</span>
            <button id="btn-reset-feature-toggles" class="switch-pill-btn" type="button" title="恢复显示全部顶栏入口与对话区挂件">全部恢复显示</button>
          </div>
          <div class="settings-card-desc">按需开启或隐藏顶栏入口与对话区挂件，点击立即生效。</div>
          <div class="settings-feature-grid">
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：总用量统计</span>
              <input id="set-feat-tokens" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：CLI 终端入口</span>
              <input id="set-feat-cli" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：模型配额胶囊</span>
              <input id="set-feat-quota" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">侧栏：模型额度卡</span>
              <input id="set-feat-sidebar-quota" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：手机远程入口</span>
              <input id="set-feat-remote" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">输入框快捷操作栏</span>
              <input id="set-feat-quickbar" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">对话右侧悬浮导航</span>
              <input id="set-feat-chatnav" type="checkbox" class="settings-checkbox" checked />
            </label>
          </div>
        </div>

        <div id="settings-card-codex-ui" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">Codex 主题与侧栏额度样式</span>
          </div>
          <div class="settings-pref-list">
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">启用 Codex 纯白 / 炭黑界面主题</span>
                <span class="settings-pref-desc">覆盖宿主编辑器与对话区为高对比度纯白 / 炭黑配色，并同步原生标题栏</span>
              </div>
              <input id="set-codex-theme" type="checkbox" class="settings-checkbox" />
            </label>
            <div class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">侧边栏额度显示范围</span>
                <span class="settings-pref-desc">控制左下角额度卡片默认追踪全部模型或固定显示指定模型池</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-codex-pool-filter" class="settings-select" aria-label="侧边栏额度显示范围">
                  <option value="all">自动跟随当前模型</option>
                  <option value="gemini-only">固定仅显示 Gemini</option>
                  <option value="claude-only">固定仅显示 Claude / GPT</option>
                </select>
              </div>
            </div>
            <div class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">当前模型组样式</span>
                <span class="settings-pref-desc">切换当前正在使用模型池的进度条与仪表样式</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-codex-quota-style" class="settings-select" aria-label="当前模型组样式">
                  <option value="bar">连续进度条</option>
                  <option value="segments">五段格</option>
                  <option value="rings">双圆环</option>
                  <option value="gauge">仪表盘</option>
                  <option value="dots">点阵</option>
                  <option value="compact">精简刻度</option>
                </select>
              </div>
            </div>
            <div id="codex-quota-other-row" class="settings-pref-row">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">其他模型组样式</span>
                <span class="settings-pref-desc">设置未在使用中模型池的展示方式或将其隐藏</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-codex-quota-other" class="settings-select" aria-label="其他模型组样式">
                  <option value="hidden">隐藏</option>
                  <option value="lines">进度细线</option>
                  <option value="text">纯文字</option>
                  <option value="segments">迷你五段</option>
                  <option value="rings">迷你圆环</option>
                  <option value="rows">双列横条</option>
                </select>
              </div>
            </div>
          </div>
          <div class="settings-status-note">提示：SVG 视觉样式预览以及界面 / 对话 / 代码三区自定义本地字体，也可在 Antigravity 原生「设置 → Suite 外观与额度」中直接配置。</div>
        </div>

        <div class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">主题色系与热力图配色</span>
            <button id="btn-toggle-heat-advanced" class="switch-pill-btn" type="button">高级色阶微调 ▼</button>
          </div>
          <div class="settings-card-desc">切换下方主题色系后，所有弹窗的高亮色、进度条、按钮激活态及热力图均会自动同步。</div>
          <div id="settings-slot-heatmap-colors"></div>
          <details id="settings-meter-colors-details" class="settings-advanced-details">
            <summary>自定义强调色与顶栏分项配色</summary>
            <div id="settings-slot-meter-colors"></div>
          </details>
        </div>
      </div>

      <!-- 分页 2: 远程设置 -->
      <div id="settings-pane-remote" class="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab-btn-remote" hidden>
        <div id="settings-card-remote-channels" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">远程通道与隧道</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <button id="btn-settings-remote-refresh" class="switch-pill-btn" type="button" title="刷新远程连接通道与隧道状态">刷新状态</button>
              <button id="ag-remote-reset" class="switch-pill-btn" type="button" title="重新生成配对口令，旧链接与已配对设备将失效">重置配对口令</button>
            </div>
          </div>
          <div class="settings-card-desc">默认已开启免登录公网通道，点顶部「远程」图标即可用手机扫码连接。如需绑定自己的固定域名，可在下方展开配置。</div>
          <div id="settings-remote-channels-root" class="settings-remote-channels-root"></div>
        </div>

        <div id="settings-card-remote-display" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">手机远程页面显示内容</span>
            <button id="btn-reset-remote-display" class="switch-pill-btn" type="button" title="恢复手机远程页面默认显示的全部模块">恢复默认</button>
          </div>
          <div class="settings-card-desc">自定义用手机或浏览器打开远程页面时显示的功能模块，勾选或取消后会立即保存并同步生效。</div>
          <div class="settings-feature-grid">
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部上下文窗口面板</span>
              <input id="set-remote-ctx-panel" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：历史用量统计面板</span>
              <input id="set-remote-usage-panel" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部模型配额胶囊</span>
              <input id="set-remote-quota-pill" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">顶部：当前连接方式提示</span>
              <input id="set-remote-channel-meta" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">左侧会话列表栏</span>
              <input id="set-remote-sidebar" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">AI 思考过程折叠区</span>
              <input id="set-remote-thinking" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">底部快捷操作与下一步建议</span>
              <input id="set-remote-quick-chips" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">输入区工具栏（模型/权限等）</span>
              <input id="set-remote-composer-tools" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-feature-item">
              <span class="settings-feature-name">待审批操作提醒横幅</span>
              <input id="set-remote-approvals" type="checkbox" class="settings-checkbox" checked />
            </label>
          </div>
        </div>
      </div>

      <!-- 分页 3: 对话与效率 -->
      <div id="settings-pane-chat" class="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab-btn-chat" hidden>
        <div id="settings-card-quick-prompts" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">快捷提示词</span>
            <button id="btn-reset-quick-prompts" class="switch-pill-btn" type="button" title="恢复默认快捷提示词">恢复默认</button>
          </div>
          <div class="settings-card-desc">从内置常用指令中点选要在输入框上方显示的快捷按钮（点击即可开启或关闭，不可删除）；也可在下方「自定义快捷提示词」中自由新增。</div>
          <div class="settings-field-lbl" style="margin:2px 0 6px;">内置快捷按钮（点击开启或关闭 · 悬停查看说明）</div>
          <div id="quick-builtin-pool-grid" class="qp-pool-grid" role="group" aria-label="内置常用指令"></div>
          <div id="quick-builtin-info-box" class="qp-info-box" role="region" aria-label="内置指令实时解读">
            <div class="qp-info-top">
              <div class="qp-info-title-wrap">
                <span class="qp-info-prefix">💡 指令解读</span>
                <span id="quick-info-title" class="qp-info-title">/compact 压缩</span>
                <span id="quick-info-rec" class="qp-info-rec">★必开</span>
              </div>
              <span id="quick-info-tag" class="qp-info-tag">分类标签：防卡死</span>
            </div>
            <div id="quick-info-role" class="qp-info-role">作用：触发官方本地压缩，将冗长历史浓缩为高密度摘要。</div>
            <div id="quick-info-scene" class="qp-info-scene">场景：上下文超过 150K~240K、响应变慢，或切换下一阶段任务前。</div>
          </div>
          <label class="settings-pref-row settings-pref-check" style="margin:6px 0 4px;">
            <div class="settings-pref-meta">
              <span class="settings-pref-name">点击内置快捷指令时直接发送</span>
              <span class="settings-pref-desc">开启后点击「/compact 压缩」或「重载规则」会直接发送（需要补充内容的指令仍仅填入输入框）；按住 ⌘/Ctrl 点击可临时切换</span>
            </div>
            <input id="set-quick-builtin-autosend" type="checkbox" class="settings-checkbox" />
          </label>
          <div class="qp-custom-hdr">
            <span id="quick-custom-section-hdr" class="settings-field-lbl">自定义快捷提示词</span>
            <button id="btn-add-quick-prompt" class="switch-pill-btn qp-add-btn" type="button" title="添加一条快捷提示词">+ 新增</button>
          </div>
          <div id="quick-custom-mode-hint" class="qp-custom-hint">填入：仅放进输入框，方便粘贴报错或补充后再发 · ⚡直发：点一下立刻发出（有草稿时自动防误发；按住 ⌘/Ctrl 点击可临时切换）</div>
          <div id="quick-popular-templates" class="qp-tpl-bar" role="group" aria-label="热门模板"></div>
          <div id="quick-prompts-editor-list" class="qp-editor-list"></div>
          <div class="qp-footer">
            <span id="quick-prompts-status" class="qp-status" role="status"></span>
            <button id="btn-save-quick-prompts" class="term-action-btn" type="button">保存快捷提示词</button>
          </div>
        </div>

        <div id="settings-card-chat-policy" class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">对话自动化与安全策略</span>
          </div>
          <div class="settings-pref-list">
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">自动确认安全操作 (Auto-Accept)</span>
                <span class="settings-pref-desc">自动点击对话中的 Proceed / Accept / 继续 等常规确认按钮，遇到高危命令自动拦截</span>
              </div>
              <input id="set-auto-accept" type="checkbox" class="settings-checkbox" />
            </label>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">输入框智能追问建议 (Tab / →)</span>
                <span class="settings-pref-desc">回答结束后在输入框内提示下一步常用追问，按 Tab 或 → 键一键填入</span>
              </div>
              <input id="set-ghost-suggest" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">240K 自动压缩防卡顿</span>
                <span class="settings-pref-desc">官方默认满 512K 才整理，对话过长后稍作停顿就容易卡顿数分钟。开启后，上下文满 240K 或发生缓存失效时，会在回复结束且输入框为空时自动发送 /compact 压缩历史</span>
              </div>
              <input id="set-auto-compact" type="checkbox" class="settings-checkbox" checked />
            </label>
            <label class="settings-pref-row settings-pref-check">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">长消息与代码块折叠</span>
                <span class="settings-pref-desc">超长代码块与历史长回复自动折叠（保留开头摘要，生成中与最新回复保持展开），支持随时一键展开或收起</span>
              </div>
              <input id="set-long-fold" type="checkbox" class="settings-checkbox" checked />
            </label>
          </div>
        </div>
      </div>

      <!-- 分页 4: 终端与网络 -->
      <div id="settings-pane-network" class="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab-btn-network" hidden>
        <div class="settings-card-box">
          <div class="settings-card-hdr">
            <div class="settings-card-title-wrap">
              <span class="settings-card-title">&gt;_ CLI 启动终端配置</span>
              <span id="term-os-badge" class="key-pill pill-muted" style="font-size:11.5px">检测中…</span>
            </div>
            <button id="btn-refresh-terminals" class="switch-pill-btn" type="button" title="重新扫描本机已安装的终端程序">重新检测</button>
          </div>
          <div class="settings-card-desc">选择点击顶栏 CLI 按钮时启动的终端程序；支持本机主流终端自动识别与自定义路径。</div>
          <div id="term-app-grid" class="term-app-grid"></div>
          <div id="term-custom-box" class="term-custom-box">
            <label for="input-custom-term-path" class="settings-field-lbl">自定义终端程序路径（选择「自定义程序路径」时生效）</label>
            <div class="term-custom-row">
              <input id="input-custom-term-path" type="text" class="settings-input" placeholder="输入或选择可执行程序路径（如 /Applications/Ghostty.app 或 C:\\Program Files\\Git\\git-bash.exe）" />
              <button id="btn-pick-term-path" class="unlock-btn unlock-btn-secondary" type="button">浏览选择…</button>
              <button id="btn-save-term-path" class="unlock-btn unlock-btn-primary" type="button">保存路径</button>
            </div>
          </div>
          <div id="cli-launch-options-box" class="term-custom-box" data-active="true" style="gap:7px;">
            <label class="settings-pref-row settings-pref-check" style="margin:0;">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">CLI 自动批准工具权限（免确认）</span>
                <span class="settings-pref-desc">在命令行启动时自动放行文件修改与命令执行，不再逐次弹窗确认；仅建议在受信任项目开启</span>
              </div>
              <input id="set-cli-skip-permissions" type="checkbox" class="settings-checkbox" />
            </label>
            <div class="settings-pref-row" style="margin:0;flex-wrap:wrap;">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">CLI 默认启动模型</span>
                <span class="settings-pref-desc">指定启动命令行终端时默认使用的模型；选「不指定」则跟随 CLI 默认配置</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-cli-model-select" class="settings-select" aria-label="CLI 默认启动模型">
                  <option value="">不指定 · 跟随 CLI 默认设置</option>
                  <option value="gemini-4-carbon-high">Gemini 4 Carbon (High)</option>
                  <option value="gemini-4-carbon-medium">Gemini 4 Carbon (Medium)</option>
                  <option value="gemini-4-carbon-low">Gemini 4 Carbon (Low)</option>
                  <option value="gemini-4-argon-high">Gemini 4 Argon (High)</option>
                  <option value="gemini-4-argon-medium">Gemini 4 Argon (Medium)</option>
                  <option value="gemini-4-argon-low">Gemini 4 Argon (Low)</option>
                  <option value="gemini-4-hydrogen-xhigh">Gemini 4 Hydrogen (XHigh)</option>
                  <option value="gemini-4-hydrogen-high">Gemini 4 Hydrogen (High)</option>
                  <option value="gemini-4-hydrogen-medium">Gemini 4 Hydrogen (Medium)</option>
                  <option value="gemini-4-hydrogen-low">Gemini 4 Hydrogen (Low)</option>
                  <option value="gemini-pro-orchestrator">Orchestrator (Carbon)</option>
                  <option value="gemini-pro-orchestrator-argon">Orchestrator (Argon)</option>
                  <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High)</option>
                  <option value="gemini-3.8-flash-medium">Gemini 3.8 Flash (Medium)</option>
                  <option value="gemini-3.8-flash-low">Gemini 3.8 Flash (Low)</option>
                  <option value="claude-opus-5-5-high">Claude Opus 5.5 (High)</option>
                  <option value="claude-opus-5-5-medium">Claude Opus 5.5 (Medium)</option>
                  <option value="claude-opus-5-5-low">Claude Opus 5.5 (Low)</option>
                  <option value="claude-sonnet-5-5-high">Claude Sonnet 5.5 (High)</option>
                  <option value="claude-sonnet-5-5-medium">Claude Sonnet 5.5 (Medium)</option>
                  <option value="claude-sonnet-5-5-low">Claude Sonnet 5.5 (Low)</option>
                  <option value="gpt-oss-120b-medium">GPT-OSS 120B (Medium)</option>
                  <option value="__custom__">自定义模型 ID…</option>
                </select>
              </div>
            </div>
            <div id="cli-custom-model-row" class="term-custom-row" style="display:none;">
              <label for="input-cli-custom-model" class="settings-field-lbl" style="flex:0 0 100%;">自定义模型名称（留空则跟随默认配置）</label>
              <input id="input-cli-custom-model" type="text" class="settings-input" placeholder="例如：gemini-3.8-flash-high" />
              <button id="btn-save-cli-model" class="unlock-btn unlock-btn-primary" type="button">保存模型</button>
            </div>
            <div id="cli-mux-host-pref-row" class="settings-pref-row" style="margin:0;flex-wrap:wrap;">
              <div class="settings-pref-meta">
                <span class="settings-pref-name">终端连接目标（电脑端 / 远程服务器）</span>
                <span class="settings-pref-desc">仅在使用 Rex、WezTerm 或 tmux 时生效：可选择在当前电脑或远程服务器上启动终端</span>
              </div>
              <div class="settings-select-wrap">
                <select id="set-cli-mux-host-select" class="settings-select" aria-label="终端连接目标">
                  <option value="">本机（当前电脑）</option>
                  <option value="__custom__">自定义远程主机名…</option>
                </select>
              </div>
            </div>
            <div id="cli-custom-mux-host-row" class="term-custom-row" style="display:none;">
              <label for="input-cli-mux-host" class="settings-field-lbl" style="flex:0 0 100%;">远程主机名称（留空则在当前电脑运行）</label>
              <input id="input-cli-mux-host" type="text" class="settings-input" placeholder="例如：my-server 或 SSH 主机名" />
              <button id="btn-save-cli-mux-host" class="unlock-btn unlock-btn-primary" type="button">保存主机</button>
            </div>
          </div>
          <div class="settings-card-footer">
            <span id="term-config-status" class="settings-status-note">当前使用：自动默认</span>
            <button id="btn-test-terminal" class="switch-pill-btn active" type="button" title="在当前项目目录尝试打开所选终端以验证路径与权限">测试打开终端</button>
          </div>
        </div>

        <div class="settings-card-box">
          <div class="settings-card-hdr">
            <span class="settings-card-title">命令行与更新代理（可选）</span>
            <span id="settings-slot-proxy-badge"></span>
          </div>
          <div id="settings-slot-proxy"></div>
        </div>
      </div>

      <!-- 分页 5: 套餐与订阅 -->
      <div id="settings-pane-subscription" class="settings-tab-pane" role="tabpanel" aria-labelledby="settings-tab-btn-subscription" hidden>
        <div class="settings-card-box">
          <div id="settings-sub-summary-bar" class="settings-sub-preview-bar">
            <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
              <span id="settings-sub-preview-plan" style="font-size:13.5px;font-weight:600;color:var(--ag-text-primary)">当前套餐：读取中…</span>
              <span id="settings-sub-preview-pools" style="font-size:12px;color:var(--ag-text-secondary)">额度池同步中…</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span id="settings-slot-sub-feedback"></span>
              <span id="settings-sub-preview-price" class="plan-summary-price-badge">--</span>
            </div>
          </div>

          <dl class="plan-detail-dl settings-sub-grid">
            <dt>订阅方案：</dt>
            <dd><div id="settings-slot-tier"></div></dd>
            <dt id="settings-subtier-dt">Ultra 套餐规格：</dt>
            <dd id="settings-subtier-dd"><div id="settings-slot-subtier"></div></dd>
            <dt>账号归属地区：</dt>
            <dd><div id="settings-slot-country"></div></dd>
            <dt>订阅结算地区：</dt>
            <dd><div id="settings-slot-region"></div></dd>
            <dt>订阅币种：</dt>
            <dd><div id="settings-slot-currency"></div></dd>
            <dt>基准换算币种：</dt>
            <dd>
              <select id="set-base-currency-select" class="settings-select">
                <option value="TWD">🇹🇼 TWD</option>
                <option value="USD">🇺🇸 USD</option>
                <option value="CNY">🇨🇳 CNY</option>
              </select>
            </dd>
            <dt>计价模式：</dt>
            <dd><div id="settings-slot-pricemode"></div></dd>
          </dl>

          <div id="settings-slot-custom-plan-form"></div>
        </div>
      </div>
    </div>
  </section>`;

  (document.body || document.documentElement).appendChild(host);
  const el = id => shadow.getElementById(id);
  const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('en-US');
  const short = v => {
    if (v == null) return '—';
    if (v >= 1e9) return `${parseFloat((v / 1e9).toFixed(2))}B`;
    if (v >= 1e6) return `${parseFloat((v / 1e6).toFixed(2))}M`;
    if (v >= 1000) return `${parseFloat((v / 1000).toFixed(1))}K`;
    return fmt(v);
  };
  // 悬停信息气泡专用紧凑计数格式（如 37k、475k、1.05M）
  const fmtBubbleToken = v => {
    if (v == null) return '未知';
    if (v >= 1e9) return `${parseFloat((v / 1e9).toFixed(2))}B`;
    if (v >= 1e6) return `${parseFloat((v / 1e6).toFixed(2))}M`;
    if (v >= 1000) {
      const k = v / 1000;
      return k >= 10 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`;
    }
    return String(Math.round(v));
  };
  const range = value => value ? `≈ ${short(value.low)}–${short(value.high)}` : '—';
  const token = value => value == null ? '未提供' : `${fmt(value)} tokens`;
  const state = {
    route: null, count: 0, scanGeneratorCount: -1, latest: null, requestAt: 0, requestError: '',
    requestBusy: false, requestNext: 0, scanBusy: false, scanNext: 0,
    scanError: '', scan: null, generation: 0, controllers: new Set(),
    disposed: false, layoutMode: 'wide', tooltipOpen: false,
    reportedFinalCallIds: new Set(), reportedFinalCallOutputs: new Map()
  };
  const route = () => location.pathname.match(/^\/c\/([a-f\d-]{36})(?:\/|$)/i)?.[1] || null;
  let activeHeatView = 'daily';
  let heatPageOffset = 0;
  let heatMonthOffset = 0;
  let heatYearOffset = 0;
  let activeCostModel = 'gemini-3.8-flash';
  let activeCostMode = 'ref';
  let autoCheckUpdate = false;
  let cachedLatestRelease = null;

// =========================================================================
  // 模块 1: 0 级主题跟随、面板与菜单统一背景色、热力图 5 档色阶与自定义颜色选取器
  // =========================================================================
  const COLOR_SLOTS = {
    panelBg: '--ag-custom-panel-bg',
    ringUsed: '--ag-custom-ring-used',
    ringTrack: '--ag-custom-ring-track',
    contextText: '--ag-custom-context-text',
    speedText: '--ag-custom-speed',
    tokenTotal: '--ag-custom-token-total',
    tokenAccent: '--ag-custom-token-accent',
    heatLow: '--ag-custom-heat-low',
    heatHigh: '--ag-custom-heat-high',
    heatLvl0: '--ag-custom-heat-lvl-0',
    heatLvl1: '--ag-custom-heat-lvl-1',
    heatLvl2: '--ag-custom-heat-lvl-2',
    heatLvl3: '--ag-custom-heat-lvl-3',
    heatLvl4: '--ag-custom-heat-lvl-4'
  };
  const COLOR_STORAGE_KEY = 'ag_custom_colors_v1';
  const HEAT_PRESET_STORAGE_KEY = 'ag_heat_preset_v1';
  const customColors = {
    panelBg: '',
    ringUsed: '',
    ringTrack: '',
    contextText: '',
    speedText: '',
    tokenTotal: '',
    tokenAccent: '',
    heatLow: '',
    heatHigh: '',
    heatLvl0: '',
    heatLvl1: '',
    heatLvl2: '',
    heatLvl3: '',
    heatLvl4: ''
  };
  let heatPreset = 'purple';

  const HEAT_PRESETS = {
    purple: {
      dark: ['#27272a', '#3f1e6b', '#652ab7', '#9053f8', '#c084fc'],
      light: ['#e4e4e7', '#e9d5ff', '#c084fc', '#9333ea', '#6b21a8']
    },
    yellow: {
      dark: ['#27272a', '#713f12', '#a16207', '#eab308', '#fde047'],
      light: ['#e4e4e7', '#fef08a', '#facc15', '#ca8a04', '#854d0e']
    },
    green: {
      dark: ['#27272a', '#14532d', '#15803d', '#22c55e', '#86efac'],
      light: ['#e4e4e7', '#bbf7d0', '#4ade80', '#16a34a', '#14532d']
    },
    blue: {
      dark: ['#27272a', '#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd'],
      light: ['#e4e4e7', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a']
    },
    red: {
      dark: ['#27272a', '#7f1d1d', '#b91c1c', '#ef4444', '#fca5a5'],
      light: ['#e4e4e7', '#fecaca', '#f87171', '#dc2626', '#7f1d1d']
    }
  };

  try {
    const rawColors = typeof localStorage !== 'undefined' && localStorage.getItem(COLOR_STORAGE_KEY);
    if (rawColors) {
      const parsed = JSON.parse(rawColors);
      for (const k of Object.keys(COLOR_SLOTS)) {
        if (typeof parsed?.[k] === 'string') customColors[k] = parsed[k];
      }
      if (typeof parsed?.heatPreset === 'string' && HEAT_PRESETS[parsed.heatPreset]) {
        heatPreset = parsed.heatPreset;
      }
    }
    const savedPreset = typeof localStorage !== 'undefined' && localStorage.getItem(HEAT_PRESET_STORAGE_KEY);
    if (savedPreset && HEAT_PRESETS[savedPreset]) heatPreset = savedPreset;
    const hostUiPrefs = typeof window !== 'undefined' ? window.__AGContextMeterSettings?.uiPreferences : null;
    if (hostUiPrefs && typeof hostUiPrefs === 'object') {
      let hostInitApplied = false;
      if (typeof hostUiPrefs.heatPreset === 'string' && HEAT_PRESETS[hostUiPrefs.heatPreset]) {
        if (heatPreset !== hostUiPrefs.heatPreset || savedPreset !== hostUiPrefs.heatPreset) {
          hostInitApplied = true;
        }
        heatPreset = hostUiPrefs.heatPreset;
      }
      if (hostUiPrefs.customColors && typeof hostUiPrefs.customColors === 'object') {
        for (const k of Object.keys(COLOR_SLOTS)) {
          if (typeof hostUiPrefs.customColors[k] === 'string' && customColors[k] !== hostUiPrefs.customColors[k]) {
            customColors[k] = hostUiPrefs.customColors[k];
            hostInitApplied = true;
          }
        }
      }
      if (hostInitApplied) {
        saveCustomColors(false);
      }
    }
  } catch {}

  function saveCustomColors(syncHost = true) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify({ ...customColors, heatPreset }));
        localStorage.setItem(HEAT_PRESET_STORAGE_KEY, heatPreset);
      }
    } catch {}
    if (syncHost && typeof saveSuiteUiPrefs === 'function') {
      void saveSuiteUiPrefs({
        heatPreset,
        customColors: { ...customColors },
        themeMode: currentThemeMode
      });
    }
  }

  function applyHostAppearancePreferences(uiPrefs) {
    if (!uiPrefs || typeof uiPrefs !== 'object') return;
    let changed = false;
    if (typeof uiPrefs.themeMode === 'string' && ['auto', 'light', 'dark'].includes(uiPrefs.themeMode)) {
      if (currentThemeMode !== uiPrefs.themeMode) {
        currentThemeMode = uiPrefs.themeMode;
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem('ag_theme_mode', currentThemeMode);
        } catch {}
        changed = true;
      }
    }
    if (typeof uiPrefs.heatPreset === 'string' && HEAT_PRESETS[uiPrefs.heatPreset]) {
      if (heatPreset !== uiPrefs.heatPreset) {
        heatPreset = uiPrefs.heatPreset;
        changed = true;
      }
    }
    if (uiPrefs.customColors && typeof uiPrefs.customColors === 'object') {
      for (const key of Object.keys(COLOR_SLOTS)) {
        if (typeof uiPrefs.customColors[key] === 'string') {
          const nextVal = uiPrefs.customColors[key];
          if (customColors[key] !== nextVal) {
            customColors[key] = nextVal;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      saveCustomColors(false);
      applyTheme();
      applyCustomColors();
    }
  }

  // 色彩空间转换与格式化工具（HEX <-> RGB <-> HSV <-> HSL）
  function clampNum(n, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  }

  function rgbToHex(r, g, b) {
    const to2 = v => clampNum(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  }

  function hexToRgb(hexStr) {
    if (!hexStr || typeof hexStr !== 'string') return null;
    const clean = hexStr.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean)) return null;
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return null;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function hslToRgb(h, s, l) {
    const hn = ((Number(h) % 360) + 360) % 360;
    const sn = clampNum(Number(s), 0, 100) / 100;
    const ln = clampNum(Number(l), 0, 100) / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
    const m = ln - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hn < 60) { r1 = c; g1 = x; }
    else if (hn < 120) { r1 = x; g1 = c; }
    else if (hn < 180) { g1 = c; b1 = x; }
    else if (hn < 240) { g1 = x; b1 = c; }
    else if (hn < 300) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function normalizeHex(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (!s || /^transparent$/i.test(s)) return null;
    const direct = hexToRgb(s);
    if (direct) return rgbToHex(direct.r, direct.g, direct.b);
    const mRgb = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+%?))?/i);
    if (mRgb) {
      if (mRgb[4] !== undefined) {
        const alphaRaw = mRgb[4].endsWith('%') ? Number(mRgb[4].slice(0, -1)) / 100 : Number(mRgb[4]);
        if (!Number.isNaN(alphaRaw) && alphaRaw <= 0.01) return null;
      }
      return rgbToHex(Number(mRgb[1]), Number(mRgb[2]), Number(mRgb[3]));
    }
    const mHsl = s.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*[,/]\s*([\d.]+%?))?/i);
    if (mHsl) {
      if (mHsl[4] !== undefined) {
        const alphaRaw = mHsl[4].endsWith('%') ? Number(mHsl[4].slice(0, -1)) / 100 : Number(mHsl[4]);
        if (!Number.isNaN(alphaRaw) && alphaRaw <= 0.01) return null;
      }
      const rgb = hslToRgb(Number(mHsl[1]), Number(mHsl[2]), Number(mHsl[3]));
      return rgbToHex(rgb.r, rgb.g, rgb.b);
    }
    return null;
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      else if (max === gn) h = ((bn - rn) / d + 2) * 60;
      else h = ((rn - gn) / d + 4) * 60;
    }
    const s = max === 0 ? 0 : (d / max) * 100;
    const v = max * 100;
    return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
  }

  function hsvToRgb(h, s, v) {
    const hn = ((Number(h) % 360) + 360) % 360;
    const sn = clampNum(Number(s), 0, 100) / 100;
    const vn = clampNum(Number(v), 0, 100) / 100;
    const c = vn * sn;
    const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
    const m = vn - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (hn < 60) { r1 = c; g1 = x; }
    else if (hn < 120) { r1 = x; g1 = c; }
    else if (hn < 180) { g1 = c; b1 = x; }
    else if (hn < 240) { g1 = x; b1 = c; }
    else if (hn < 300) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      else if (max === gn) h = ((bn - rn) / d + 2) * 60;
      else h = ((rn - gn) / d + 4) * 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function interpolateHex(hexA, hexB, t) {
    const a = hexToRgb(hexA) || { r: 39, g: 39, b: 42 };
    const b = hexToRgb(hexB) || { r: 192, g: 132, b: 252 };
    const ratio = clampNum(t, 0, 1);
    return rgbToHex(
      a.r + (b.r - a.r) * ratio,
      a.g + (b.g - a.g) * ratio,
      a.b + (b.b - a.b) * ratio
    );
  }

  let currentThemeMode = 'auto';
  try {
    const savedMode = typeof localStorage !== 'undefined' ? localStorage.getItem('ag_theme_mode') : null;
    currentThemeMode = savedMode || 'auto';
    const hostThemeMode = typeof window !== 'undefined' ? window.__AGContextMeterSettings?.uiPreferences?.themeMode : null;
    if (typeof hostThemeMode === 'string' && ['auto', 'light', 'dark'].includes(hostThemeMode)) {
      currentThemeMode = hostThemeMode;
      if (savedMode !== hostThemeMode && typeof localStorage !== 'undefined') {
        localStorage.setItem('ag_theme_mode', hostThemeMode);
      }
    }
  } catch {}

  function parseRgbLuminance(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return null;
    const rgb = hexToRgb(normalizeHex(colorStr));
    if (rgb) return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return null;
  }

  function getHostZeroLevelBg(isLight) {
    const fallback = isLight ? '#ffffff' : '#181818';
    try {
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const rootEl = document.body || document.documentElement;
        if (rootEl) {
          const cs = window.getComputedStyle(rootEl);
          const candidates = [
            cs.getPropertyValue('--background')?.trim(),
            cs.backgroundColor?.trim()
          ].filter(Boolean);
          for (const raw of candidates) {
            const norm = normalizeHex(raw);
            if (!norm) continue;
            const lum = parseRgbLuminance(norm);
            const normIsLight = lum != null ? lum > 0.55 : Boolean(isLight);
            if (normIsLight === Boolean(isLight)) return norm;
            return fallback;
          }
        }
      }
    } catch {}
    return fallback;
  }

  function getSystemTheme() {
    try {
      const body = document.body;
      const doc = document.documentElement;
      const docAttr = doc?.getAttribute?.('data-theme');
      if (docAttr === 'light' || body?.classList?.contains('theme-light') || body?.classList?.contains('light') || doc?.classList?.contains('light') || body?.classList?.contains('vscode-light')) return 'light';
      if (docAttr === 'dark' || body?.classList?.contains('theme-dark') || body?.classList?.contains('dark') || doc?.classList?.contains('dark') || body?.classList?.contains('vscode-dark')) return 'dark';
      if (doc?.style?.colorScheme === 'light') return 'light';
      if (doc?.style?.colorScheme === 'dark') return 'dark';
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        for (const el of [body, doc].filter(Boolean)) {
          const cs = window.getComputedStyle(el);
          for (const raw of [cs?.getPropertyValue?.('--background')?.trim(), cs?.backgroundColor?.trim()]) {
            if (!raw) continue;
            const lum = parseRgbLuminance(raw);
            if (lum != null) return lum > 0.55 ? 'light' : 'dark';
          }
        }
      }
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      }
    } catch {}
    return 'dark';
  }

  function resolveTheme() {
    if (currentThemeMode === 'light') return 'light';
    if (currentThemeMode === 'dark') return 'dark';
    return getSystemTheme();
  }

  function refreshActiveHeatViews() {
    if (activeHeatView === 'weekly') renderHeatmapWeekly();
    else if (activeHeatView === 'monthly') renderHeatmapMonthly();
    else if (activeHeatView === 'yearly') renderHeatmapYearly();
    else if (activeHeatView === 'cum') renderHeatmapCum();
  }

  function getPresetHeatmapScale() {
    const isLight = resolveTheme() === 'light';
    const presetObj = HEAT_PRESETS[heatPreset] || HEAT_PRESETS.purple;
    return (isLight ? presetObj.light : presetObj.dark).slice();
  }

  function getBaseHeatmapScale() {
    const base = getPresetHeatmapScale();
    const lowCustom = normalizeHex(customColors.heatLow);
    const highCustom = normalizeHex(customColors.heatHigh);
    if (lowCustom || highCustom) {
      const c0 = lowCustom || base[0];
      const c4 = highCustom || base[4];
      return [
        c0,
        interpolateHex(c0, c4, 0.25),
        interpolateHex(c0, c4, 0.5),
        interpolateHex(c0, c4, 0.75),
        c4
      ];
    }
    return base;
  }

  function getEffectiveHeatmapScale() {
    const scale = getBaseHeatmapScale();
    for (let i = 0; i < 5; i++) {
      const lvlCustom = normalizeHex(customColors[`heatLvl${i}`]);
      if (lvlCustom) scale[i] = lvlCustom;
    }
    return scale;
  }

  const PRESET_ACCENT_COLORS = {
    purple: { dark: '#a78bfa', light: '#7c3aed', totalDark: '#a78bfa', totalLight: '#7c3aed' },
    yellow: { dark: '#fbbf24', light: '#d97706', totalDark: '#fbbf24', totalLight: '#d97706' },
    green: { dark: '#34d399', light: '#059669', totalDark: '#34d399', totalLight: '#059669' },
    blue: { dark: '#60a5fa', light: '#2563eb', totalDark: '#60a5fa', totalLight: '#2563eb' },
    red: { dark: '#f87171', light: '#dc2626', totalDark: '#f87171', totalLight: '#dc2626' }
  };

  function getDefaultSlotColor(slotKey) {
    const isLight = resolveTheme() === 'light';
    const presetScale = getPresetHeatmapScale();
    const baseScale = getBaseHeatmapScale();
    const accentSpec = PRESET_ACCENT_COLORS[heatPreset] || PRESET_ACCENT_COLORS.purple;
    const customHeatAccent = normalizeHex(customColors.heatLvl4) || normalizeHex(customColors.heatHigh);
    switch (slotKey) {
      case 'panelBg': return getHostZeroLevelBg(isLight);
      case 'ringUsed': return customHeatAccent || (isLight ? accentSpec.light : accentSpec.dark);
      case 'ringTrack': return isLight ? '#b8b8c2' : '#52525b';
      case 'contextText': return isLight ? '#18181b' : '#ececef';
      case 'speedText': return isLight ? '#52525b' : '#b8b8c0';
      case 'tokenTotal': return customHeatAccent || (isLight ? accentSpec.totalLight : accentSpec.totalDark);
      case 'tokenAccent': return customHeatAccent || (isLight ? accentSpec.light : accentSpec.dark);
      case 'heatLow': return presetScale[0];
      case 'heatHigh': return presetScale[4];
      case 'heatLvl0': return baseScale[0];
      case 'heatLvl1': return baseScale[1];
      case 'heatLvl2': return baseScale[2];
      case 'heatLvl3': return baseScale[3];
      case 'heatLvl4': return baseScale[4];
      default: return '#7748cf';
    }
  }

  function getEffectiveSlotColor(slotKey) {
    return normalizeHex(customColors[slotKey]) || getDefaultSlotColor(slotKey);
  }

  function syncThemeAccentVars() {
    const isLight = resolveTheme() === 'light';
    const defaultAccent = getDefaultSlotColor('tokenAccent');
    const defaultTotal = getDefaultSlotColor('tokenTotal');
    const effAccent = getEffectiveSlotColor('tokenAccent');
    const rgb = hexToRgb(effAccent) || { r: 167, g: 139, b: 250 };
    const panelBg = normalizeHex(customColors.panelBg) || getHostZeroLevelBg(isLight);
    const accentVars = {
      '--ag-effective-accent': effAccent,
      '--ag-token-accent-default': defaultAccent,
      '--ag-token-total-default': defaultTotal,
      '--ag-accent-bg': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? 0.10 : 0.14})`,
      '--ag-accent-bg-hover': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? 0.18 : 0.24})`,
      '--ag-accent-border': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? 0.28 : 0.34})`,
      '--ag-accent-border-hover': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? 0.48 : 0.56})`,
      '--ag-accent-glow': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? 0.32 : 0.44})`
    };
    const surfaceVars = {
      '--ag-bg-panel': panelBg,
      '--ag-border-panel': isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.11)',
      '--ag-shadow-panel': isLight
        ? '0 14px 36px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06)'
        : '0 16px 40px rgba(0, 0, 0, 0.58), 0 2px 10px rgba(0, 0, 0, 0.32)',
      '--ag-bg-card': isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.025)',
      '--ag-bg-card-hover': isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.045)',
      '--ag-border-card': isLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.09)',
      '--ag-text-primary': isLight ? '#18181b' : '#ececef',
      '--ag-text-secondary': isLight ? '#3f3f46' : '#c8c8d0',
      '--ag-text-muted': isLight ? '#52525b' : '#a1a1aa'
    };
    for (const [k, v] of Object.entries(accentVars)) {
      host.style.setProperty(k, v);
    }
    // 镜像写入宿主根节点，供 Shadow DOM 外部的浮层、菜单与底部胶囊继承当前主题表面色与强调色
    try {
      const rootStyle = typeof document !== 'undefined' ? document.documentElement?.style : null;
      if (rootStyle && typeof rootStyle.setProperty === 'function') {
        for (const [k, v] of Object.entries({ ...accentVars, ...surfaceVars })) {
          rootStyle.setProperty(k, v);
        }
      }
    } catch {}
  }

  function applyHeatmapPalette() {
    const scale = getEffectiveHeatmapScale();
    for (let i = 0; i < 5; i++) {
      host.style.setProperty(`--ag-heat-lvl-${i}`, scale[i]);
      const legEl = el(`heat-leg-${i}`);
      if (legEl) {
        legEl.style.background = scale[i];
        legEl.style.setProperty('--swatch-color', scale[i]);
        legEl.setAttribute('data-custom', String(Boolean(customColors[`heatLvl${i}`])));
      }
    }
    syncThemeAccentVars();
    const hasCustomHeat = Boolean(
      customColors.heatLow || customColors.heatHigh ||
      customColors.heatLvl0 || customColors.heatLvl1 || customColors.heatLvl2 || customColors.heatLvl3 || customColors.heatLvl4
    );
    try {
      const group = el('heat-preset-group');
      if (group?.querySelectorAll) {
        const btns = group.querySelectorAll('[data-heat-preset]');
        for (const btn of btns) {
          const pName = btn.getAttribute('data-heat-preset');
          btn.setAttribute('data-active', String(!hasCustomHeat && pName === heatPreset));
        }
      }
    } catch {}
  }

  function syncSwatchAndResetButtons() {
    for (const key of Object.keys(COLOR_SLOTS)) {
      const val = customColors[key];
      const eff = getEffectiveSlotColor(key);
      const inputEl = el(`color-${key}`);
      if (inputEl) inputEl.value = eff;
      const swatchEl = el(`swatch-${key}`);
      if (swatchEl) {
        swatchEl.style.setProperty('--swatch-color', eff);
        swatchEl.style.background = eff;
      }
      const resetBtn = el(`reset-${key}`);
      if (resetBtn) {
        resetBtn.setAttribute('data-mode', val ? 'custom' : 'auto');
        if (key.startsWith('heatLvl')) {
          resetBtn.textContent = val ? '恢复' : '预设';
        } else if (key === 'heatLow' || key === 'heatHigh') {
          resetBtn.textContent = val ? '恢复预设' : '预设';
        } else {
          resetBtn.textContent = val ? '恢复默认' : '跟随主题';
        }
      }
    }
    const resetHeatLvlsBtn = el('reset-heat-lvls');
    if (resetHeatLvlsBtn) {
      const anyHeatLvl = Boolean(
        customColors.heatLvl0 || customColors.heatLvl1 || customColors.heatLvl2 || customColors.heatLvl3 || customColors.heatLvl4 ||
        customColors.heatLow || customColors.heatHigh
      );
      resetHeatLvlsBtn.setAttribute('data-mode', anyHeatLvl ? 'custom' : 'auto');
    }
    // 面板 A 中的镜像色块按钮同步
    const mirrorMap = {
      'swatch-panelBg-tokens': 'panelBg',
      'swatch-tokenTotal-tokens': 'tokenTotal',
      'swatch-tokenAccent-tokens': 'tokenAccent'
    };
    for (const [id, slot] of Object.entries(mirrorMap)) {
      const sw = el(id);
      if (sw) {
        const eff = getEffectiveSlotColor(slot);
        sw.style.setProperty('--swatch-color', eff);
        sw.style.background = eff;
      }
    }
    const resetBgTokens = el('reset-panelBg-tokens');
    if (resetBgTokens) {
      const hasBg = Boolean(customColors.panelBg);
      resetBgTokens.setAttribute('data-mode', hasBg ? 'custom' : 'auto');
      resetBgTokens.textContent = hasBg ? '恢复默认' : '跟随主题';
    }
  }

  function applyCustomColors() {
    for (const [key, cssVar] of Object.entries(COLOR_SLOTS)) {
      const val = customColors[key];
      if (val) {
        host.style.setProperty(cssVar, val);
      } else if (host.style.removeProperty) {
        host.style.removeProperty(cssVar);
      } else {
        host.style.setProperty(cssVar, '');
      }
    }
    if (customColors.panelBg) {
      const lum = parseRgbLuminance(customColors.panelBg);
      if (lum != null) {
        host.setAttribute('data-panel-tone', lum > 0.55 ? 'light' : 'dark');
      }
    } else {
      host.removeAttribute('data-panel-tone');
    }
    applyHeatmapPalette();
    syncSwatchAndResetButtons();
    if (typeof syncSettingsThemePills === 'function') syncSettingsThemePills();
    refreshActiveHeatViews();
  }

  function setCustomColor(key, value) {
    if (!Object.prototype.hasOwnProperty.call(COLOR_SLOTS, key)) return;
    const raw = value ? String(value).trim() : '';
    const norm = raw ? (normalizeHex(raw) || raw) : '';
    customColors[key] = norm;
    if (key === 'heatLow' && norm) customColors.heatLvl0 = '';
    if (key === 'heatHigh' && norm) customColors.heatLvl4 = '';
    saveCustomColors();
    applyCustomColors();
    if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
  }

  function setHeatPreset(presetName) {
    if (!HEAT_PRESETS[presetName]) return;
    heatPreset = presetName;
    customColors.heatLow = '';
    customColors.heatHigh = '';
    for (let i = 0; i < 5; i++) {
      customColors[`heatLvl${i}`] = '';
    }
    saveCustomColors();
    applyCustomColors();
    if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
  }

  function resetHeatmapLevels() {
    customColors.heatLow = '';
    customColors.heatHigh = '';
    for (let i = 0; i < 5; i++) {
      customColors[`heatLvl${i}`] = '';
    }
    saveCustomColors();
    applyCustomColors();
    if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
  }

  function resetCustomColors() {
    for (const key of Object.keys(COLOR_SLOTS)) customColors[key] = '';
    heatPreset = 'purple';
    saveCustomColors();
    applyCustomColors();
    if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
  }

  function applyTheme() {
    const activeTheme = resolveTheme();
    const hostTheme = getSystemTheme();
    host.setAttribute('data-theme', activeTheme);
    host.setAttribute('data-host-theme', hostTheme);
    host.setAttribute('data-theme-mode', currentThemeMode);
    const hostBg = getHostZeroLevelBg(activeTheme === 'light');
    host.style.setProperty('--ag-host-bg', hostBg);
    const btns = [el('theme-toggle'), el('theme-toggle-tokens')].filter(Boolean);
    btns.forEach(btn => {
      if (currentThemeMode === 'auto') {
        btn.textContent = activeTheme === 'light' ? '🌗' : '🌓';
        btn.title = `当前主题：跟随宿主 (${activeTheme === 'light' ? '浅色' : '深色'})\n点击切换为：浅色模式`;
      } else if (currentThemeMode === 'light') {
        btn.textContent = '☀️';
        btn.title = '当前主题：浅色模式 (固定)\n点击切换为：深色模式';
      } else {
        btn.textContent = '🌙';
        btn.title = '当前主题：深色模式 (固定)\n点击切换为：跟随宿主';
      }
    });
    applyHeatmapPalette();
    syncSwatchAndResetButtons();
    if (typeof syncSettingsThemePills === 'function') syncSettingsThemePills();
    refreshActiveHeatViews();
    syncNativeOverlayTheme();
  }

  let lastSyncedOverlayKey = '';
  function syncNativeOverlayTheme() {
    try {
      if (typeof window === 'undefined') return;
      const isLight = resolveTheme() === 'light';
      const rootEl = document.body || document.documentElement;
      const cs = (rootEl && typeof window.getComputedStyle === 'function') ? window.getComputedStyle(rootEl) : null;
      const bg = cs?.getPropertyValue?.('--background')?.trim() || (isLight ? '#FAFAFA' : '#131313');
      const fg = cs?.getPropertyValue?.('--foreground')?.trim() || (isLight ? '#383A42' : '#FAFAFA');
      const overlayKey = `${bg}|${fg}|40`;
      if (overlayKey === lastSyncedOverlayKey) return;
      lastSyncedOverlayKey = overlayKey;
      if (typeof window.contextMeterAPI?.syncOverlay === 'function') {
        void window.contextMeterAPI.syncOverlay({ color: bg, symbolColor: fg, height: 40, heightCssPx: 40 });
      } else if (typeof window.electronNative?.setTitleBarOverlay === 'function') {
        void window.electronNative.setTitleBarOverlay({ color: bg, symbolColor: fg });
      }
    } catch {}
  }

  function cycleTheme() {
    if (currentThemeMode === 'auto') currentThemeMode = 'light';
    else if (currentThemeMode === 'light') currentThemeMode = 'dark';
    else currentThemeMode = 'auto';
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('ag_theme_mode', currentThemeMode);
    } catch {}
    applyTheme();
    if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
    if (typeof saveSuiteUiPrefs === 'function') void saveSuiteUiPrefs({ themeMode: currentThemeMode });
  }

  let themeObserver = null;
  try {
    if (typeof MutationObserver !== 'undefined' && document.body) {
      themeObserver = new MutationObserver(() => {
        const prevTheme = host.getAttribute('data-theme');
        const prevHostTheme = host.getAttribute('data-host-theme');
        applyTheme();
        if ((host.getAttribute('data-theme') !== prevTheme || host.getAttribute('data-host-theme') !== prevHostTheme)
          && typeof dispatchSuitePrefsChanged === 'function') {
          dispatchSuitePrefsChanged();
        }
      });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      if (document.documentElement) {
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      }
    }
  } catch {}

  applyTheme();
  applyCustomColors();

  // =========================================================================
  // 自定义「颜色选取器」面板交互逻辑（吸管 + 预设圆点 + SV主色区 + 色相条 + HEX/RGB/HSL）
  // =========================================================================
  let activePickerSlot = null;
  let activePickerAnchor = null;
  let cpHsv = { h: 265, s: 77, v: 72 };

  function syncPickerUiFromHsv(skipInputId = '', exactRgb = null) {
    const rgb = exactRgb || hsvToRgb(cpHsv.h, cpHsv.s, cpHsv.v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    const svArea = el('cp-sv-area');
    const svThumb = el('cp-sv-thumb');
    const hueThumb = el('cp-hue-thumb');
    const sidePreview = el('cp-side-preview');
    if (svArea) svArea.style.backgroundColor = `hsl(${cpHsv.h}, 100%, 50%)`;
    if (svThumb) {
      svThumb.style.left = `${cpHsv.s}%`;
      svThumb.style.top = `${100 - cpHsv.v}%`;
    }
    if (hueThumb) {
      hueThumb.style.left = `${(cpHsv.h / 360) * 100}%`;
    }
    if (sidePreview) {
      sidePreview.style.background = hex;
    }

    const inHex = el('cp-input-hex');
    const inRgb = el('cp-input-rgb');
    const inHsl = el('cp-input-hsl');
    if (inHex && skipInputId !== 'cp-input-hex') inHex.value = hex;
    if (inRgb && skipInputId !== 'cp-input-rgb') inRgb.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    if (inHsl && skipInputId !== 'cp-input-hsl') inHsl.value = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    return hex;
  }

  function applyPickerHex(hexStr, skipInputId = '') {
    const norm = normalizeHex(hexStr);
    if (!norm) return false;
    const rgb = hexToRgb(norm);
    if (!rgb) return false;
    cpHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const appliedHex = syncPickerUiFromHsv(skipInputId, rgb);
    if (activePickerSlot) {
      setCustomColor(activePickerSlot, appliedHex);
    }
    return true;
  }

  let pickerOpVersion = 0;

  function positionColorPickerPopover() {
    const pop = el('color-picker-popover');
    if (!pop || pop.hidden) return;
    try {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
      const popW = 304;
      const popH = pop.offsetHeight > 0 ? pop.offsetHeight : 340;
      let minLeft = 12;
      if (typeof document.querySelector === 'function') {
        const navEl = document.querySelector('div[role="navigation"]');
        if (navEl?.getBoundingClientRect) {
          const nr = navEl.getBoundingClientRect();
          if (nr.width > 0 && nr.left <= 8 && nr.right < vw - 320) {
            minLeft = Math.ceil(nr.right + 12);
          }
        }
      }
      let left = Math.round((vw - popW) / 2);
      let top = 90;
      if (activePickerAnchor?.getBoundingClientRect) {
        const ar = activePickerAnchor.getBoundingClientRect();
        if (ar.width > 0 || ar.height > 0) {
          left = Math.round(ar.right - popW);
          top = Math.round(ar.bottom + 6);
          if (top + popH > vh - 12 && ar.top > popH + 12) {
            top = Math.round(ar.top - popH - 6);
          }
        }
      }
      left = Math.max(minLeft, Math.min(vw - popW - 12, left));
      top = Math.max(42, Math.min(vh - popH - 12, top));
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    } catch {}
  }

  function openColorPicker(slotKey, anchorEl = null, labelText = '') {
    if (!Object.prototype.hasOwnProperty.call(COLOR_SLOTS, slotKey)) return;
    const pop = el('color-picker-popover');
    if (!pop) return;

    const op = ++pickerOpVersion;
    activePickerSlot = slotKey;
    activePickerAnchor = anchorEl;

    const lbl = el('cp-target-name');
    if (lbl) lbl.textContent = labelText ? `· ${labelText}` : `· ${slotKey}`;
    const cpResetBtn = el('cp-reset-slot');
    if (cpResetBtn) {
      cpResetBtn.textContent = slotKey.startsWith('heat') ? '恢复该档预设' : '跟随主题';
    }
    const startHex = getEffectiveSlotColor(slotKey);
    const rgb = hexToRgb(startHex) || { r: 101, g: 42, b: 183 };
    cpHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    syncPickerUiFromHsv();

    pop.setAttribute?.('data-closing', 'false');
    pop.classList?.remove?.('is-closing');
    pop.classList?.add?.('is-opening');
    pop.hidden = false;
    positionColorPickerPopover();

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (pickerOpVersion === op) {
          pop.classList?.remove?.('is-opening');
        }
      });
    } else {
      pop.classList?.remove?.('is-opening');
    }
  }

  function closeColorPicker(immediate = false) {
    const pop = el('color-picker-popover');
    const isMock = !pop?.classList || typeof pop.classList.add !== 'function' || typeof pop.animate !== 'function';
    const isClosing = pop?.classList ? pop.classList.contains('is-closing') : pop?.getAttribute('data-closing') === 'true';
    if (!pop || pop.hidden || isClosing) {
      activePickerSlot = null;
      activePickerAnchor = null;
      return;
    }
    const op = ++pickerOpVersion;
    activePickerSlot = null;
    activePickerAnchor = null;

    const isImmediate = typeof immediate === 'boolean' ? immediate : false;
    if (isImmediate || isMock || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)) {
      pop.setAttribute?.('data-closing', 'false');
      pop.classList?.remove?.('is-opening', 'is-closing');
      pop.hidden = true;
      return;
    }

    pop.setAttribute?.('data-closing', 'true');
    pop.classList?.add?.('is-closing');
    setTimeout(() => {
      if (pickerOpVersion === op) {
        pop.setAttribute?.('data-closing', 'false');
        pop.classList?.remove?.('is-opening', 'is-closing');
        pop.hidden = true;
      }
    }, 130);
  }

  const HEAT_LVL_LABELS = [
    '色阶第 1 档（少/无用量）',
    '色阶第 2 档（低用量）',
    '色阶第 3 档（中等用量）',
    '色阶第 4 档（高用量）',
    '色阶第 5 档（多/峰值用量）'
  ];

  // 绑定所有颜色色块与恢复按钮事件
  for (const key of Object.keys(COLOR_SLOTS)) {
    const inputEl = el(`color-${key}`);
    const resetBtn = el(`reset-${key}`);
    const swatchBtn = el(`swatch-${key}`);
    inputEl?.addEventListener('input', e => setCustomColor(key, e.target?.value || ''));
    inputEl?.addEventListener('change', e => setCustomColor(key, e.target?.value || ''));
    resetBtn?.addEventListener('click', () => {
      setCustomColor(key, '');
      if (activePickerSlot === key) {
        const eff = getEffectiveSlotColor(key);
        const rgb = hexToRgb(eff) || { r: 101, g: 42, b: 183 };
        cpHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        syncPickerUiFromHsv();
      }
    });
    swatchBtn?.addEventListener('click', e => {
      e?.stopPropagation?.();
      openColorPicker(key, swatchBtn, swatchBtn.getAttribute('data-color-label') || key);
    });
  }

  // 热力图右下角「少 ▢▢▢▢▢ 多」5 个小色块图例直接点击弹出颜色选取器单独调色
  for (let i = 0; i < 5; i++) {
    const legBtn = el(`heat-leg-${i}`);
    const slotKey = `heatLvl${i}`;
    legBtn?.addEventListener('click', e => {
      e?.stopPropagation?.();
      const settingsOpen = el('panel-settings') && !el('panel-settings').hidden;
      const swatchBtn = settingsOpen ? (el(`swatch-${slotKey}`) || legBtn) : legBtn;
      openColorPicker(slotKey, swatchBtn, legBtn.getAttribute('data-color-label') || HEAT_LVL_LABELS[i]);
    });
  }
  el('reset-heat-lvls')?.addEventListener('click', () => {
    resetHeatmapLevels();
    if (activePickerSlot?.startsWith('heat')) {
      const eff = getEffectiveSlotColor(activePickerSlot);
      const rgb = hexToRgb(eff) || { r: 101, g: 42, b: 183 };
      cpHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      syncPickerUiFromHsv();
    }
  });

  // 面板 A 镜像色块与预设按钮事件
  ['swatch-panelBg-tokens', 'swatch-tokenTotal-tokens', 'swatch-tokenAccent-tokens'].forEach(id => {
    const btn = el(id);
    btn?.addEventListener('click', e => {
      e?.stopPropagation?.();
      const slot = btn.getAttribute('data-color-slot');
      if (slot) openColorPicker(slot, btn, btn.getAttribute('data-color-label') || slot);
    });
  });
  el('reset-panelBg-tokens')?.addEventListener('click', () => setCustomColor('panelBg', ''));
  el('reset-all-colors')?.addEventListener('click', () => { resetCustomColors(); closeColorPicker(); });
  el('reset-all-colors-tokens')?.addEventListener('click', () => { resetCustomColors(); closeColorPicker(); });

  try {
    const presetGroup = el('heat-preset-group');
    if (presetGroup?.querySelectorAll) {
      for (const btn of presetGroup.querySelectorAll('[data-heat-preset]')) {
        btn.addEventListener('click', () => {
          const p = btn.getAttribute('data-heat-preset');
          if (p) setHeatPreset(p);
        });
      }
    }
  } catch {}

  // 颜色选取器内部控件绑定（SV 拖拽、Hue 拖拽、预设圆点、吸管、HEX/RGB/HSL 输入与复制）
  el('cp-close')?.addEventListener('click', () => closeColorPicker(false));
  el('cp-reset-slot')?.addEventListener('click', () => {
    if (activePickerSlot) {
      setCustomColor(activePickerSlot, '');
      const eff = getEffectiveSlotColor(activePickerSlot);
      const rgb = hexToRgb(eff) || { r: 101, g: 42, b: 183 };
      cpHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      syncPickerUiFromHsv();
    }
  });

  try {
    const presetsWrap = el('cp-presets');
    if (presetsWrap?.querySelectorAll) {
      for (const dot of presetsWrap.querySelectorAll('[data-cp-hex]')) {
        dot.addEventListener('click', () => {
          const hex = dot.getAttribute('data-cp-hex');
          if (hex) applyPickerHex(hex);
        });
      }
    }
  } catch {}

  el('cp-eyedropper')?.addEventListener('click', async () => {
    const statusEl = el('cp-status-msg');
    try {
      if (typeof window !== 'undefined' && typeof window.EyeDropper === 'function') {
        const dropper = new window.EyeDropper();
        const res = await dropper.open();
        if (res?.sRGBHex) {
          applyPickerHex(res.sRGBHex);
          if (statusEl) statusEl.textContent = `已吸取 ${res.sRGBHex.toUpperCase()}`;
        }
      } else {
        el('cp-input-hex')?.focus?.();
        if (statusEl) statusEl.textContent = '当前环境不支持原生吸管，可直接粘贴 HEX';
      }
    } catch {}
  });

  el('cp-input-hex')?.addEventListener('input', e => {
    const raw = e.target?.value || '';
    const norm = normalizeHex(raw);
    if (norm) {
      applyPickerHex(norm, 'cp-input-hex');
      const statusEl = el('cp-status-msg');
      if (statusEl) statusEl.textContent = `已应用 ${norm.toUpperCase()}`;
    }
  });
  el('cp-input-hex')?.addEventListener('change', e => {
    const raw = e.target?.value || '';
    const norm = normalizeHex(raw);
    if (norm) applyPickerHex(norm);
  });

  el('cp-input-rgb')?.addEventListener('input', e => {
    const norm = normalizeHex(e.target?.value || '');
    if (norm) applyPickerHex(norm, 'cp-input-rgb');
  });
  el('cp-input-hsl')?.addEventListener('input', e => {
    const norm = normalizeHex(e.target?.value || '');
    if (norm) applyPickerHex(norm, 'cp-input-hsl');
  });

  function copyPickerText(inputId, label) {
    const input = el(inputId);
    const val = input?.value || '';
    if (!val) return;
    try {
      navigator?.clipboard?.writeText?.(val);
    } catch {}
    const statusEl = el('cp-status-msg');
    if (statusEl) statusEl.textContent = `✔ 已复制 ${label}: ${val}`;
  }
  el('cp-copy-hex')?.addEventListener('click', () => copyPickerText('cp-input-hex', 'HEX'));
  el('cp-copy-rgb')?.addEventListener('click', () => copyPickerText('cp-input-rgb', 'RGB'));
  el('cp-copy-hsl')?.addEventListener('click', () => copyPickerText('cp-input-hsl', 'HSL'));

  const svAreaEl = el('cp-sv-area');
  const hueWrapEl = el('cp-hue-wrap');
  let draggingSv = false;
  let draggingHue = false;

  function updateSvFromPointer(e) {
    if (!svAreaEl?.getBoundingClientRect) return;
    const r = svAreaEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const s = clampNum(((e.clientX - r.left) / r.width) * 100, 0, 100);
    const v = clampNum(100 - ((e.clientY - r.top) / r.height) * 100, 0, 100);
    cpHsv.s = Math.round(s);
    cpHsv.v = Math.round(v);
    const hex = syncPickerUiFromHsv();
    if (activePickerSlot) setCustomColor(activePickerSlot, hex);
  }

  function updateHueFromPointer(e) {
    if (!hueWrapEl?.getBoundingClientRect) return;
    const r = hueWrapEl.getBoundingClientRect();
    if (!r.width) return;
    const h = clampNum(((e.clientX - r.left) / r.width) * 360, 0, 360);
    cpHsv.h = Math.round(h);
    const hex = syncPickerUiFromHsv();
    if (activePickerSlot) setCustomColor(activePickerSlot, hex);
  }

  svAreaEl?.addEventListener('mousedown', e => {
    draggingSv = true;
    updateSvFromPointer(e);
  });
  hueWrapEl?.addEventListener('mousedown', e => {
    draggingHue = true;
    updateHueFromPointer(e);
  });
  const onPointerMove = e => {
    if (draggingSv) updateSvFromPointer(e);
    else if (draggingHue) updateHueFromPointer(e);
  };
  const onPointerUp = () => {
    draggingSv = false;
    draggingHue = false;
  };
  try {
    window.addEventListener?.('mousemove', onPointerMove);
    window.addEventListener?.('mouseup', onPointerUp);
  } catch {}
  // =========================================================================
  // 模块 2: 宿主布局挂载、右上角原生窗口控制区预留、渐进式宽度收缩与悬浮层定位
  // =========================================================================
  let resizeObserver = null;
  let hostDomObserver = null;
  let domMutationThrottleTimer = null;
  let observedTitlebar = null;
  let layoutRaf = 0;
  let cachedMeasuredAvailWidth = null;
  let cachedMeasuredAvailAt = 0;
  let cachedMeasuredWinWidth = 0;

  function findHostTitlebar() {
    try {
      if (typeof document.querySelector !== 'function') return null;
      return document.querySelector('[class*="@container/titlebar"]');
    } catch {
      return null;
    }
  }

  function isTopRightToolbarCluster(el) {
    if (!el || typeof el.getAttribute !== 'function') return false;
    const cls = el.className || '';
    if (typeof cls !== 'string') return false;
    const classList = typeof el.classList?.contains === 'function'
      ? el.classList
      : { contains: c => cls.split(/\s+/).includes(c) };
    if (!classList.contains('absolute') || !classList.contains('right-0')) return false;

    const styleTop = el.style?.top || el.getAttribute('style') || '';
    const hasTopClass = classList.contains('top-0');
    const hasTopStyle = /(?:^|;)\s*top:\s*0(?:px)?(?:\s*;|$)/i.test(styleTop);
    const rectTop = el.getBoundingClientRect ? el.getBoundingClientRect().top : 0;
    if (el.getBoundingClientRect && rectTop >= 20) return false;
    const isAtTop = hasTopClass || hasTopStyle || (rectTop <= 10 && rectTop >= 0);
    if (!isAtTop) return false;

    // 排除明显非顶栏容器（右侧全高抽屉、全屏浮层或带有明确非零高度下沉定位的浮层）
    if (classList.contains('bottom-0') || classList.contains('h-screen') || classList.contains('h-full')) {
      return false;
    }

    // 排除右侧滚动条滑槽（特征：包含 top-0.5 / bottom-0.5 / w-3 等滚动条特征）
    if (classList.contains('w-3') || classList.contains('right-0.5')) {
      return false;
    }

    // 必须符合顶栏控制按钮容器特征：
    // a) 包含右侧栏切换按钮
    // b) 或包含 z-50 并具有 flex / items-center 水平布局
    const hasAuxToggle = Boolean(el.querySelector && el.querySelector('[data-testid="toggle-aux-sidebar"]'));
    const hasToolbarLayout = classList.contains('z-50') && (classList.contains('items-center') || classList.contains('flex'));

    return hasAuxToggle || hasToolbarLayout;
  }

  function findTopRightCluster() {
    try {
      if (typeof document.querySelector !== 'function') return null;
      // 1. 优先从右侧栏切换按钮向上寻找最近的顶栏容器
      const auxToggle = document.querySelector('[data-testid="toggle-aux-sidebar"]');
      if (auxToggle?.closest) {
        // 先尝试带 top-0 的经典结构（Antigravity 1.x）
        let cluster = auxToggle.closest('div.absolute.right-0.top-0');
        if (cluster && isTopRightToolbarCluster(cluster)) return cluster;
        // 兼容 Antigravity 2.x（top: 0px 写在内联 style，class 无 top-0）
        cluster = auxToggle.closest('div.absolute.right-0');
        if (cluster && isTopRightToolbarCluster(cluster)) return cluster;
      }

      // 2. 备用安全探测：当 auxToggle 尚未挂载或被动态卸载时，精确匹配顶栏容器
      // 严格检查顶部坐标与容器特征，绝不误伤滚动条、侧栏抽屉或模态弹窗
      const selectors = [
        'div.h-screen.w-screen > div.flex-1 > div.absolute.right-0.top-0.z-50',
        'div.h-screen.w-screen > div.flex-1 > div.absolute.right-0.z-50',
        'div.absolute.right-0.z-50'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && isTopRightToolbarCluster(el)) return el;
      }
      return null;
    } catch {
      return null;
    }
  }

  // 动态计算右上角原生窗口控制区（Minimize / Maximize / Close）独占宽度（CSS px）
  function computeWindowControlsWidth(topRight) {
    if (!topRight) return 0;
    try {
      const plat = (typeof navigator !== 'undefined' && navigator.platform) || '';
      if (/^Mac|iPhone|iPad/i.test(plat)) return 0;
      if (topRight?.getBoundingClientRect) {
        const tr = topRight.getBoundingClientRect();
        // 若顶部已单独渲染菜单栏（top >= 20），则 40px 工具栏不在窗口顶边，无需重复留白
        if (tr.height > 0 && tr.top >= 20) return 0;
      }
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
      // 优先 1: 标准 WCO 接口 navigator.windowControlsOverlay
      const wco = typeof navigator !== 'undefined' ? navigator.windowControlsOverlay : null;
      if (wco?.visible && typeof wco.getTitlebarAreaRect === 'function') {
        const rect = wco.getTitlebarAreaRect();
        if (rect && rect.width > 0 && vw > 0 && rect.width < vw) {
          return Math.max(0, Math.ceil(vw - rect.right));
        }
      }
      // 优先 2: 根据 Electron titleBarOverlay 几何规格（Windows 3 颗原生控制按钮共 138 OS DIP）与实时缩放比动态换算
      let zoomFactor = 1;
      if (typeof window !== 'undefined') {
        const nativeZoom = window.electronNative?.getZoomLevel?.();
        if (typeof nativeZoom === 'number' && nativeZoom >= 0.25 && nativeZoom <= 5) {
          zoomFactor = nativeZoom;
        } else if (window.outerWidth > 0 && window.innerWidth > 0) {
          const ratio = window.outerWidth / window.innerWidth;
          if (ratio >= 0.25 && ratio <= 5) zoomFactor = ratio;
        }
      }
      const rawCssWidth = Math.ceil(138 / zoomFactor);
      let existingSpacerWidth = 0;
      if (topRight?.querySelectorAll) {
        const spacers = topRight.querySelectorAll('div[aria-hidden="true"]');
        for (const sp of spacers) {
          if (sp.id !== 'ag-wco-spacer' && sp.getBoundingClientRect) {
            existingSpacerWidth += Math.round(sp.getBoundingClientRect().width || parseFloat(sp.style?.width) || 0);
          }
        }
      }
      return Math.max(0, rawCssWidth - existingSpacerWidth);
    } catch {
      return 98;
    }
  }

  function syncWindowControlsOverlay() {
    if (state.disposed) return;
    try {
      const topRight = findTopRightCluster();
      const wcoWidth = computeWindowControlsWidth(topRight);
      const spacer = typeof document.getElementById === 'function' ? document.getElementById('ag-wco-spacer') : null;
      if (topRight && typeof document.createElement === 'function' && wcoWidth > 0) {
        let activeSpacer = spacer;
        if (!activeSpacer || activeSpacer.parentElement !== topRight) {
          activeSpacer?.remove?.();
          activeSpacer = document.createElement('div');
          activeSpacer.id = 'ag-wco-spacer';
          activeSpacer.setAttribute('aria-hidden', 'true');
          topRight.appendChild(activeSpacer);
        }
        const targetCss = `width:${wcoWidth}px;height:100%;flex-shrink:0;pointer-events:none;`;
        if (activeSpacer.style.cssText !== targetCss) {
          activeSpacer.style.cssText = targetCss;
        }
      } else {
        if (spacer) {
          spacer.remove();
        }
        if (topRight?.querySelectorAll) {
          const oldSpacers = topRight.querySelectorAll('#ag-wco-spacer');
          for (const s of oldSpacers) {
            s.remove?.();
          }
        }
      }

      if (typeof document.head !== 'undefined' && document.head && typeof document.createElement === 'function') {
        let styleEl = typeof document.getElementById === 'function' ? document.getElementById('ag-topbar-host-fix') : null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'ag-topbar-host-fix';
          document.head.appendChild(styleEl);
        }
        const cssText = [
          '[data-aux-pane-focus-scope="true"] > div[data-active-tab-id] {',
          '  padding-right: calc(var(--right-cluster-width, 140px) - 4px) !important;',
          '}',
          wcoWidth > 0 ? [
            '[class*="@container/titlebar"],',
            '[data-aux-pane-focus-scope="true"] > div[data-active-tab-id],',
            'div[role="navigation"][aria-label] > div.shrink-0:first-child {',
            '  -webkit-app-region: drag;',
            '}',
            '[class*="@container/titlebar"] button,',
            '[class*="@container/titlebar"] a,',
            '[class*="@container/titlebar"] input,',
            '[class*="@container/titlebar"] [role="button"],',
            '[data-testid="pane-titlebar-toolbar"] > *,',
            '[data-aux-pane-focus-scope="true"] > div[data-active-tab-id] button,',
            '[data-aux-pane-focus-scope="true"] > div[data-active-tab-id] [data-tab-id],',
            'div[role="navigation"][aria-label] > div.shrink-0:first-child button,',
            'div[role="navigation"][aria-label] > div.shrink-0:first-child a,',
            '#ag-context-meter {',
            '  -webkit-app-region: no-drag;',
            '}'
          ].join('\n') : ''
        ].join('\n');
        if (styleEl.textContent !== cssText) {
          styleEl.textContent = cssText;
        }
      }
      syncNativeOverlayTheme();
    } catch {}
  }

  function isSearchOrFilterTextbox(node) {
    if (!node) return false;
    try {
      const type = String(node.type || node.getAttribute?.('type') || '').toLowerCase();
      if (type === 'search') return true;
      const meta = [
        node.getAttribute?.('placeholder'),
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('name'),
        node.getAttribute?.('data-testid')
      ].filter(Boolean).join(' ').toLowerCase();
      if (/\b(search|filter|find|extension|plugin|marketplace)\b|搜索|过滤|筛选|扩展|插件/.test(meta)) return true;
      if (node.closest?.('[data-testid*="customization"], [data-testid*="marketplace"], [class*="customization"], [class*="marketplace"]')) {
        return true;
      }
    } catch {}
    return false;
  }

  function hasRealChatComposer() {
    try {
      const selectors = '[data-testid="composer"], [data-testid="chat-input"], [data-testid="prompt-input"], textarea, [contenteditable="true"], [role="textbox"]';
      let candidates = [];
      if (typeof document?.querySelectorAll === 'function') {
        candidates = Array.from(document.querySelectorAll(selectors) || []);
      }
      if (!candidates.length && typeof document?.querySelector === 'function') {
        for (const singleSel of selectors.split(',')) {
          const hit = document.querySelector(singleSel.trim());
          if (hit) candidates.push(hit);
        }
      }
      for (const node of candidates) {
        if (!node) continue;
        if (typeof host?.contains === 'function' && host.contains(node)) continue;
        if (node.closest?.('#ag-context-meter')) continue;
        if (isSearchOrFilterTextbox(node)) continue;
        if (typeof node.getBoundingClientRect === 'function') {
          const rect = node.getBoundingClientRect();
          if (rect && Number(rect.width) === 0 && Number(rect.height) === 0) continue;
        }
        return true;
      }
    } catch {}
    return false;
  }

  function isHostNavOrSideUtilityNode(node) {
    if (!node) return false;
    try {
      if (typeof host?.contains === 'function' && host.contains(node)) return true;
      if (node.closest?.('#ag-context-meter')) return true;
      if (node.closest?.('nav, aside, [data-side-panel-open], [data-side-panel-focus-scope]')) return true;
      if (node.tagName === 'A' && node.getAttribute?.('href')) return true;
    } catch {}
    return false;
  }

  function hasActiveConversationContentInDom() {
    try {
      if (typeof document?.querySelector !== 'function') return false;
      return Boolean(
        document.querySelector('[data-testid="conversation-view"], [data-testid="cascade-system-message-toolbar"], .ag-cm-turn-footer')
      );
    } catch { return false; }
  }

  function isHostMarketplaceActive() {
    try {
      const locPath = String(typeof location !== 'undefined' ? (location.pathname || '') : '');
      const locHash = String(typeof location !== 'undefined' ? (location.hash || '') : '');
      const locCombined = `${locPath} ${locHash}`.toLowerCase();
      if (/(?:^|\/|#|\s)(?:extensions|marketplace|customizations|installed|plugin|plugins)(?:\/|$|\?|#|\s)/i.test(locCombined)) {
        return true;
      }
      if (typeof document?.querySelectorAll === 'function' || typeof document?.querySelector === 'function') {
        const navSelectors = '[data-testid*="customization"], [data-testid*="marketplace"], [data-testid*="installed"], [aria-label*="自定义"], [aria-label*="Customization"]';
        const navCandidates = typeof document?.querySelectorAll === 'function'
          ? Array.from(document.querySelectorAll(navSelectors) || [])
          : (document.querySelector(navSelectors) ? [document.querySelector(navSelectors)] : []);
        const hasActiveCustomNav = navCandidates.some(node => {
          if (!node || host?.contains?.(node) || node.closest?.('#ag-context-meter')) return false;
          return Boolean(
            node.classList?.contains?.('active') ||
            node.getAttribute?.('aria-selected') === 'true' ||
            node.getAttribute?.('aria-current') === 'page'
          );
        });
        if (hasActiveCustomNav) return true;
      }

      if (hasRealChatComposer()) return false;

      const headings = typeof document?.querySelectorAll === 'function'
        ? Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], [aria-selected="true"]') || [])
        : [];
      const CUSTOMIZATION_TITLES = new Set([
        '自定义扩展', '插件市场', '已安装', '自定义扩展与技能',
        'Marketplace', 'Customizations', 'Customizations & Skills', 'Installed', 'Plugins', 'Extensions',
        'Browse the Marketplace'
      ]);
      const hasHeading = headings.some(node => {
        if (!node || isHostNavOrSideUtilityNode(node)) return false;
        const txt = String(node.textContent || '').trim();
        return CUSTOMIZATION_TITLES.has(txt);
      });
      if (hasHeading) return true;

      // 防止无输入框的已归档历史会话 (/c/...) 被宽松全局 Back 误锁
      if (hasActiveConversationContentInDom()) return false;

      const backCandidates = typeof document?.querySelectorAll === 'function'
        ? Array.from(document.querySelectorAll('[aria-label*="Back"], [aria-label*="返回"], [data-testid*="back"]') || [])
        : (document.querySelector?.('[aria-label*="Back"], [aria-label*="返回"], [data-testid*="back"]')
          ? [document.querySelector('[aria-label*="Back"], [aria-label*="返回"], [data-testid*="back"]')]
          : []);
      const hasHostBack = backCandidates.some(btn => {
        if (!btn || isHostNavOrSideUtilityNode(btn)) return false;
        return btn.tagName === 'BUTTON' || btn.getAttribute?.('role') === 'button' || String(btn.getAttribute?.('data-testid') || '').toLowerCase().includes('back');
      });
      if (hasHostBack) {
        const customContainerNodes = typeof document?.querySelectorAll === 'function'
          ? Array.from(document.querySelectorAll('[data-testid*="customization"], [class*="customization"], [data-testid*="marketplace"], [class*="marketplace"]'))
          : [];
        if (customContainerNodes.some(node => node && !isHostNavOrSideUtilityNode(node))) {
          return true;
        }
        const actionNodes = typeof document?.querySelectorAll === 'function'
          ? Array.from(document.querySelectorAll('button, [role="button"]'))
          : [];
        const hasPluginDetailAction = actionNodes.some(btn => {
          if (!btn || isHostNavOrSideUtilityNode(btn)) return false;
          const label = String(btn.textContent || '').trim();
          return /^(Install|Uninstall|Enable|Disable|Configure|Connect|\+\s*Add|Details|安装|卸载|启用|禁用|移除|配置|详情)$/i.test(label);
        });
        if (hasPluginDetailAction && !document.querySelector('[data-testid="conversation-view"]')) {
          return true;
        }
      }
      return false;
    } catch { return false; }
  }

  function enforceMarketplaceAvoidance(forceActive) {
    const active = typeof forceActive === 'boolean' ? forceActive : isHostMarketplaceActive();
    if (active && host.getAttribute?.('data-marketplace-active') === 'true') return true;
    try {
      if (active) {
        host.setAttribute('data-marketplace-active', 'true');
        state.tooltipOpen = false;
        for (const id of ['panel', 'panel-tokens', 'overflow-menu']) {
          const node = el(id);
          if (node) node.hidden = true;
        }
        const tip = el('context-tooltip');
        if (tip) tip.setAttribute('data-visible', 'false');
        const upPop = el('update-popover');
        if (upPop && upPop.style) upPop.style.display = 'none';
        const heatPop = el('popover');
        if (heatPop && heatPop.style) heatPop.style.display = 'none';
        for (const bid of ['badge', 'badge-speed', 'badge-tokens', 'badge-overflow']) {
          el(bid)?.setAttribute?.('aria-expanded', 'false');
        }
        try {
          globalThis.__AGEnhancer?.closeQuotaPopover?.();
          globalThis.__AGEnhancer?.closeRemotePopover?.();
        } catch {}
        if (typeof syncHostStackingElevation === 'function') syncHostStackingElevation(false);
      } else if (host.getAttribute?.('data-marketplace-active') === 'true') {
        host.removeAttribute('data-marketplace-active');
      }
    } catch {}
    return active;
  }

  function ensureHostDocked() {
    if (state.disposed) return;
    syncWindowControlsOverlay();
    const titlebar = findHostTitlebar();
    if (titlebar) {
      // 自愈保护：若主对话区（div.flex[style*="min-width"]）的 inline flex-grow 被意外清空，立即恢复为 1，绝不覆写其他分栏属性
      try {
        const convPane = titlebar.closest?.('div.flex[style*="min-width"]');
        if (convPane?.style && (!convPane.style.flexGrow || convPane.style.flexGrow === '0')) {
          convPane.style.flexGrow = '1';
        }
      } catch {}

      let targetContainer = titlebar;
      try {
        const rightGroup = titlebar.querySelector(':scope > div.shrink-0') || titlebar.lastElementChild;
        if (rightGroup && rightGroup !== titlebar.firstElementChild) {
          targetContainer = rightGroup;
        }
      } catch {}

      if (host.parentElement !== targetContainer) {
        if (targetContainer.firstChild && targetContainer !== titlebar) {
          targetContainer.insertBefore(host, targetContainer.firstChild);
        } else {
          targetContainer.appendChild(host);
        }
      }
      host.setAttribute('data-dock', 'flow');
      try {
        host.style.removeProperty?.('right');
        host.style.removeProperty?.('top');
      } catch {}
      host.style.right = '';
      host.style.top = '';

      if (observedTitlebar !== titlebar) {
        observedTitlebar = titlebar;
        try {
          if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver.observe(titlebar);
            if (document.body) resizeObserver.observe(document.body);
          }
        } catch {}
      }
    } else {
      const fallbackParent = document.body || document.documentElement;
      if (fallbackParent && host.parentElement !== fallbackParent) {
        fallbackParent.appendChild(host);
      }
      host.setAttribute('data-dock', 'fixed');
      updateFixedFallbackPosition();
    }
    enforceMarketplaceAvoidance();
    updateResponsiveLayout();
  }

  function findNativeTopRightAnchor() {
    try {
      if (typeof document.querySelector !== 'function') return null;
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const openIdeBtn = buttons.find(b => {
        const text = (b.textContent || '').trim();
        return (text === 'Open IDE' || text === '打开 IDE' || text.includes('Open IDE') || text.includes('打开 IDE')) && b.getBoundingClientRect?.().top < 50;
      });
      if (openIdeBtn) {
        const parentGroup = openIdeBtn.closest('div.flex.items-center, div.absolute.right-0') || openIdeBtn;
        return parentGroup;
      }
      const auxToggle = document.querySelector('[data-testid="toggle-aux-sidebar"]');
      if (auxToggle?.closest) {
        return auxToggle.closest('div.absolute.right-0.top-0') || auxToggle;
      }
      return document.querySelector('div.absolute.right-0.top-0');
    } catch {
      return null;
    }
  }

  function updateFixedFallbackPosition() {
    if (host.getAttribute?.('data-dock') === 'flow') {
      try {
        host.style.removeProperty?.('right');
        host.style.removeProperty?.('top');
      } catch {}
      host.style.right = '';
      host.style.top = '';
      return;
    }
    try {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      let rightOffset = 144;
      const anchor = findNativeTopRightAnchor();
      if (anchor?.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        if (r.width > 0 && r.left > 0 && r.left < vw) {
          rightOffset = Math.max(144, Math.ceil(vw - r.left + 6));
        }
      }
      host.style.top = '6px';
      host.style.right = `${rightOffset}px`;
    } catch {}
  }

  // 带迟滞区间（Hysteresis）的四阶段渐进收缩计算，防止临界宽度抖动
  function computeNextLayoutMode(availWidth, currentMode) {
    // 阈值设计：
    // wide <-> compact: 收缩 < 195px, 恢复 >= 210px
    // compact <-> minimal: 收缩 < 135px, 恢复 >= 150px
    // minimal <-> ring-only: 收缩 < 68px, 恢复 >= 82px
    if (availWidth == null || Number.isNaN(availWidth)) return 'wide';
    if (currentMode === 'wide') {
      if (availWidth < 68) return 'ring-only';
      if (availWidth < 135) return 'minimal';
      if (availWidth < 195) return 'compact';
      return 'wide';
    }
    if (currentMode === 'compact') {
      if (availWidth >= 210) return 'wide';
      if (availWidth < 68) return 'ring-only';
      if (availWidth < 135) return 'minimal';
      return 'compact';
    }
    if (currentMode === 'minimal') {
      if (availWidth >= 210) return 'wide';
      if (availWidth >= 150) return 'compact';
      if (availWidth < 68) return 'ring-only';
      return 'minimal';
    }
    // currentMode === 'ring-only'
    if (availWidth >= 210) return 'wide';
    if (availWidth >= 150) return 'compact';
    if (availWidth >= 82) return 'minimal';
    return 'ring-only';
  }

  function measureAvailableWidth(force = false) {
    try {
      const now = Date.now();
      const curWinW = typeof window !== 'undefined' ? (window.innerWidth || 0) : 0;
      if (!force && cachedMeasuredAvailWidth !== null && curWinW === cachedMeasuredWinWidth && (now - cachedMeasuredAvailAt) < 350) {
        return cachedMeasuredAvailWidth;
      }
      const titlebar = findHostTitlebar();
      if (titlebar?.getBoundingClientRect) {
        const tbRect = titlebar.getBoundingClientRect();
        if (tbRect.width > 0) {
          const titleEl = titlebar.firstElementChild;
          const titleInner = titleEl?.firstElementChild;
          const contentStart = titleInner?.getBoundingClientRect
            ? Math.max(8, titleInner.getBoundingClientRect().left - tbRect.left)
            : (tbRect.left < 168 ? (168 - tbRect.left) : 12);
          const titleRealW = titleEl?.scrollWidth ? Math.min(320, titleEl.scrollWidth) : 160;
          const minTitleWidth = Math.max(150, titleRealW);
          let nativeButtonsWidth = 64;
          let rightPad = 8;
          const rightGroup = host.parentElement;
          if (rightGroup && rightGroup !== titlebar) {
            const auxOpen = typeof document.querySelector === 'function'
              && !!document.querySelector('[data-testid="aux-pane-sash"]');
            const root = typeof document.querySelector === 'function'
              ? document.querySelector('div.h-screen.w-screen')
              : null;
            const rightClusterVar = root?.style?.getPropertyValue?.('--right-cluster-width')?.trim() || '';
            if (auxOpen) {
              rightPad = 8;
            } else if (rightClusterVar) {
              rightPad = Math.max(8, (parseFloat(rightClusterVar) || 44) - 4);
            } else if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
              rightPad = parseFloat(window.getComputedStyle(rightGroup).paddingRight) || 0;
            }
            if (rightGroup.children) {
              let sum = 0;
              for (const child of rightGroup.children) {
                if (child !== host && child.getBoundingClientRect) {
                  sum += child.getBoundingClientRect().width;
                }
              }
              if (sum > 0) nativeButtonsWidth = sum + 6;
            }
          }
          const avail = tbRect.width - contentStart - minTitleWidth - rightPad - nativeButtonsWidth;
          cachedMeasuredAvailWidth = avail;
          cachedMeasuredAvailAt = now;
          cachedMeasuredWinWidth = curWinW;
          return avail;
        }
      }
      if (typeof window !== 'undefined' && window.innerWidth) {
        const avail = window.innerWidth - 360;
        cachedMeasuredAvailWidth = avail;
        cachedMeasuredAvailAt = now;
        cachedMeasuredWinWidth = curWinW;
        return avail;
      }
    } catch {}
    return 400;
  }

  function renderSessionCost() {
    const roundCostBar = el('round-cost-bar');
    const roundCostText = el('round-cost-text');
    const sessionCostText = el('session-cost-text');
    if (!roundCostText || !sessionCostText) return;
    const activeCalls = state.sessionCalls || [];
    const latestCall = activeCalls[activeCalls.length - 1];
    const sessTotal = state.sessionCostTotal || 0;
    if (latestCall && latestCall.isPriced) {
      const roundCost = latestCall.costUSD || 0;
      const roundCostStr = formatUsdEstimate(roundCost, '≈');
      const estLabel = latestCall.status === 'streaming' ? '生成中暂估' : '按已返回用量估算';
      roundCostText.textContent = `最近调用 ${roundCostStr} · ${estLabel}`;
      roundCostText.title = `模型：${latestCall.model}\n输入：${fmt(latestCall.inputTokens)} tok\n缓存：${fmt(latestCall.cacheTokens)} tok\n输出：${fmt(latestCall.outputTokens)} tok\n参考金额：${formatUsdEstimate(roundCost)}`;
    } else if (latestCall) {
      roundCostText.textContent = '最近调用：模型费率未收录';
      roundCostText.title = latestCall.model ? `模型：${latestCall.model}（公开费率未收录）` : '缺少模型信息';
    } else {
      roundCostText.textContent = '最近调用估值：—';
      roundCostText.title = '';
    }
    sessionCostText.textContent = sessTotal > 0 ? `当前会话合计约 ${formatUsdEstimate(sessTotal)}` : '当前会话合计：—';
  }

  function applyLayoutMode(nextMode) {
    if (!nextMode) return;
    const prev = state.layoutMode;
    state.layoutMode = nextMode;
    host.setAttribute('data-layout', nextMode);
    if (prev !== nextMode) {
      if (nextMode !== 'minimal') {
        const om = el('overflow-menu');
        if (om) om.hidden = true;
        el('badge-overflow')?.setAttribute('aria-expanded', 'false');
      }
      syncSpeedBadgeText();
    }
    renderSessionCost();
  }

  function updateResponsiveLayout(forceMeasure = false) {
    if (state.disposed) return;
    syncWindowControlsOverlay();
    const avail = measureAvailableWidth(forceMeasure);
    const nextMode = computeNextLayoutMode(avail, state.layoutMode);
    applyLayoutMode(nextMode);
    if (state.tooltipOpen) positionContextTooltip();
    if (isAnyPanelOpen() || !el('overflow-menu')?.hidden) positionFloatingPanels();
  }

  function scheduleLayoutSync() {
    if (state.disposed) return;
    if (typeof requestAnimationFrame === 'function') {
      if (layoutRaf) return;
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        ensureHostDocked();
      });
    } else {
      ensureHostDocked();
    }
  }

  // 定位上下文悬停气泡：空间足够时优先在圆环上方，顶部空间不足时自动翻转至下方，左右防裁切
  function positionContextTooltip() {
    const tip = el('context-tooltip');
    const badge = el('badge');
    if (!tip || !badge || !badge.getBoundingClientRect) return;
    try {
      const bRect = badge.getBoundingClientRect();
      if (bRect.width === 0 && bRect.height === 0) return;
      const tRect = tip.getBoundingClientRect ? tip.getBoundingClientRect() : { width: 190, height: 66 };
      const tipW = tRect.width || 190;
      const tipH = tRect.height || 66;
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
      const gap = 7;

      const spaceAbove = bRect.top;
      const spaceBelow = vh - bRect.bottom;
      let top;
      if (spaceAbove >= tipH + gap + 6 || spaceAbove > spaceBelow) {
        top = bRect.top - tipH - gap;
        tip.setAttribute('data-placement', 'top');
      } else {
        top = bRect.bottom + gap;
        tip.setAttribute('data-placement', 'bottom');
      }
      top = Math.max(6, Math.min(vh - tipH - 6, Math.round(top)));

      let left = Math.round(bRect.left + bRect.width / 2 - tipW / 2);
      left = Math.max(8, Math.min(vw - tipW - 8, left));

      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    } catch {}
  }

  function showContextTooltip() {
    const tip = el('context-tooltip');
    if (!tip || !el('panel')?.hidden) return;
    state.tooltipOpen = true;
    tip.setAttribute('data-visible', 'true');
    positionContextTooltip();
  }

  function hideContextTooltip() {
    const tip = el('context-tooltip');
    if (!tip) return;
    state.tooltipOpen = false;
    tip.setAttribute('data-visible', 'false');
  }

  let elevatedStackAncestors = [];

  function syncHostStackingElevation(elevate) {
    try {
      if (elevate) {
        host.setAttribute?.('data-elevated', 'true');
        let cur = host.parentElement || null;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          let shouldElevate = false;
          try {
            const cs = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
              ? window.getComputedStyle(cur)
              : null;
            if (cs && ((cs.position && cs.position !== 'static') || (cs.zIndex && cs.zIndex !== 'auto') || cs.isolation === 'isolate')) {
              shouldElevate = true;
            }
          } catch {}
          const cls = typeof cur.className === 'string' ? cur.className : '';
          if (!shouldElevate && /\b(relative|fixed|absolute|sticky|z-\d+)\b/.test(cls)) {
            shouldElevate = true;
          }
          if (shouldElevate && cur.style && !elevatedStackAncestors.some(item => item.el === cur)) {
            elevatedStackAncestors.push({ el: cur, prevZIndex: cur.style.zIndex || '' });
            cur.style.zIndex = '2147483646';
          }
          cur = cur.parentElement;
        }
        if (elevatedStackAncestors.length === 0) {
          const z0 = host.closest?.('div.relative.z-0');
          if (z0?.style) {
            elevatedStackAncestors.push({ el: z0, prevZIndex: z0.style.zIndex || '' });
            z0.style.zIndex = '2147483646';
          }
        }
      } else {
        const quotaOpen = Boolean(el('ag-quota-popover') && !el('ag-quota-popover').hidden)
          || Boolean(document?.getElementById?.('ag-quota-popover') && !document.getElementById('ag-quota-popover').hidden);
        if (!state.disposed && (isAnyPanelOpen() || (el('overflow-menu') && !el('overflow-menu').hidden) || quotaOpen)) {
          return;
        }
        host.removeAttribute?.('data-elevated');
        for (const item of elevatedStackAncestors) {
          try {
            if (item?.el?.style) item.el.style.zIndex = item.prevZIndex || '';
          } catch {}
        }
        elevatedStackAncestors = [];
      }
    } catch {}
  }

  function getLeftProjectSidebarRight(vw) {
    try {
      if (typeof document.querySelector === 'function') {
        const navEl = document.querySelector('div[role="navigation"]');
        if (navEl?.getBoundingClientRect) {
          const nr = navEl.getBoundingClientRect();
          if (nr.width > 0 && nr.left <= 8 && nr.right > 0 && nr.right < vw - 260) {
            return Math.ceil(nr.right);
          }
        }
      }
    } catch {}
    return 0;
  }

  let activeContextAnchor = null;

  function positionFloatingPanels() {
    if (!host.getBoundingClientRect) return;
    try {
      const hRect = host.getBoundingClientRect();
      if (hRect.width === 0 && hRect.height === 0) return;
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
      const navRight = getLeftProjectSidebarRight(vw);
      const minLeft = navRight > 0 ? Math.max(12, navRight + 12) : 12;

      const placePanel = (panelEl, targetW, anchorBtn) => {
        if (!panelEl) return;
        const bRect = (anchorBtn && anchorBtn.getBoundingClientRect && anchorBtn !== host && anchorBtn.getBoundingClientRect().right > hRect.left)
          ? anchorBtn.getBoundingClientRect()
          : hRect;
        const top = Math.max(36, Math.min(vh - 120, Math.round((bRect.bottom || hRect.bottom) + 6)));
        const isCompact = panelEl.classList?.contains?.('cost-compact-view') || panelEl.getAttribute?.('class')?.includes?.('cost-compact-view');
        const effW = isCompact ? 400 : targetW;
        const maxAvailW = Math.max(260, vw - minLeft - 12);

        // 核心锚点：右侧精确对齐到触发按钮右边缘，展开时向左下自然伸展，收起时向右上自然收拢
        let left = Math.round(bRect.right - effW);
        left = Math.min(left, vw - effW - 12);
        left = Math.max(minLeft, left);

        panelEl.style.top = `${top}px`;
        panelEl.style.left = `${left}px`;
        panelEl.style.right = 'auto';
        panelEl.style.maxWidth = `${maxAvailW}px`;
        panelEl.style.transformOrigin = 'top right';
      };

      placePanel(el('panel'), 450, activeContextAnchor || el('badge'));
      placePanel(el('panel-tokens'), 730, el('badge-tokens'));
      placePanel(el('panel-settings'), 640, el('badge-settings') || el('badge-overflow') || el('badge'));
      placePanel(el('overflow-menu'), 220, el('badge-overflow'));
      positionColorPickerPopover();
    } catch {}
  }

  try {
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateResponsiveLayout(true));
      if (document.body) resizeObserver.observe(document.body);
    }
    if (typeof MutationObserver !== 'undefined' && document.body) {
      hostDomObserver = new MutationObserver(() => {
        if (!host.isConnected || host.getAttribute('data-dock') !== 'flow') {
          scheduleLayoutSync();
          return;
        }
        if (domMutationThrottleTimer) return;
        domMutationThrottleTimer = setTimeout(() => {
          domMutationThrottleTimer = null;
          if (state.disposed) return;
          if (!host.isConnected || host.getAttribute('data-dock') !== 'flow' || !findHostTitlebar()?.contains?.(host)) {
            scheduleLayoutSync();
          }
        }, 120);
      });
      hostDomObserver.observe(document.body, { childList: true, subtree: true });
    }
  } catch {}

  const onWindowResize = () => updateResponsiveLayout(true);
  const onWindowFocus = () => host.setAttribute('data-window-active', 'true');
  const onWindowBlur = () => host.setAttribute('data-window-active', 'false');
  try {
    window.addEventListener?.('resize', onWindowResize);
    window.addEventListener?.('focus', onWindowFocus);
    window.addEventListener?.('blur', onWindowBlur);
    navigator?.windowControlsOverlay?.addEventListener?.('geometrychange', onWindowResize);
  } catch {}

  ensureHostDocked();

  // =========================================================================
  // 模块 3: 面板、气泡与溢出菜单交互
  // =========================================================================
  function withStepError(value, metadata) {
    const error = state.scan?.session?.currentError;
    if (!error || value?.error) return value;
    const lastStep = Math.max(-1, ...(metadata?.stepIndices || []), metadata?.chatModel?.chatStartMetadata?.startStepIndex ?? -1);
    if (lastStep > error.index) return value;
    const failure = summarize({ chatModel: { retryInfos: [{ error: error.text }] } }, {
      currentModel: value?.model || state.latest?.model || '',
      cascadeModelConfigs: state.cascadeModelConfigs || state.scan?.cascadeModelConfigs || [],
      previousValidContext: value
    });
    return {
      ...(value || {}),
      error: failure.error,
      errorClassification: failure.errorClassification,
      exceeded: failure.exceeded,
      network: failure.network,
      serviceLimit: failure.serviceLimit || value?.serviceLimit || null,
      status: failure.status,
      // 解耦：保留已有有效上下文数据，不归零、不清空
      used: value?.used ?? failure?.used ?? null,
      actual: failure.exceeded ? null : (value?.actual ?? null),
      estimate: value?.estimate ?? failure?.estimate ?? null,
      budget: value?.budget ?? failure?.budget ?? null,
      percent: failure.exceeded ? 100 : (value?.percent ?? null),
      estimated: value?.actual == null
    };
  }

  function isAnyPanelOpen() {
    return !el('panel').hidden || !el('panel-tokens').hidden || Boolean(el('panel-settings') && !el('panel-settings').hidden);
  }

  function showPanel(target) {
    if ((target === 'context' || target === 'tokens') && enforceMarketplaceAvoidance()) {
      return;
    }
    const pContext = el('panel');
    const pTokens = el('panel-tokens');
    const pSettings = el('panel-settings');
    const pOverflow = el('overflow-menu');
    const bContext = el('badge');
    const bSpeed = el('badge-speed');
    const bTokens = el('badge-tokens');
    const bSettings = el('badge-settings');
    const bOverflow = el('badge-overflow');

    hideUpdatePopover();
    try {
      globalThis.__AGEnhancer?.closeQuotaPopover?.();
      globalThis.__AGEnhancer?.closeRemotePopover?.();
      const pQuota = el('ag-quota-popover');
      if (pQuota && !pQuota.hidden) pQuota.hidden = true;
      el('badge-quota')?.setAttribute('aria-expanded', 'false');
      const pRemote = el('ag-remote-popover');
      if (pRemote && !pRemote.hidden) pRemote.hidden = true;
      el('badge-remote')?.setAttribute('aria-expanded', 'false');
    } catch {}
    if (pOverflow) pOverflow.hidden = true;
    bOverflow?.setAttribute('aria-expanded', 'false');
    if (target !== 'settings' && pSettings && !pSettings.hidden && typeof onSuiteSettingsClosed === 'function') {
      try { onSuiteSettingsClosed(); } catch {}
    }

    if (target === 'settings') {
      hideContextTooltip();
      closeColorPicker();
      setPlanDetailExpanded(false, { skipReposition: true });
      el('plan-summary-price-badge')?.setAttribute?.('aria-expanded', 'false');
      syncHostStackingElevation(true);
      positionFloatingPanels();
      pContext.hidden = true;
      pTokens.hidden = true;
      if (pSettings) pSettings.hidden = false;
      bContext.setAttribute('aria-expanded', 'false');
      bSpeed?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'false');
      bSettings?.setAttribute('aria-expanded', 'true');
    } else if (target === 'tokens') {
      hideContextTooltip();
      closeColorPicker();
      syncHostStackingElevation(true);
      positionFloatingPanels();
      pContext.hidden = true;
      if (pSettings) pSettings.hidden = true;
      pTokens.hidden = false;
      bContext.setAttribute('aria-expanded', 'false');
      bSpeed?.setAttribute('aria-expanded', 'false');
      bSettings?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'true');
      void syncTokenHistoryFromHost(false);
      renderActiveHeatView(true);
    } else if (target === 'context') {
      hideContextTooltip();
      closeColorPicker();
      setPlanDetailExpanded(false, { skipReposition: true });
      el('plan-summary-price-badge')?.setAttribute?.('aria-expanded', 'false');
      syncHostStackingElevation(true);
      positionFloatingPanels();
      pTokens.hidden = true;
      if (pSettings) pSettings.hidden = true;
      pContext.hidden = false;
      bContext.setAttribute('aria-expanded', 'true');
      bSpeed?.setAttribute('aria-expanded', 'true');
      bSettings?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'false');
      void refreshModulesDisplay();
    } else {
      setPlanDetailExpanded(false, { skipReposition: true });
      el('plan-summary-price-badge')?.setAttribute?.('aria-expanded', 'false');
      pContext.hidden = true;
      pTokens.hidden = true;
      if (pSettings) pSettings.hidden = true;
      bContext.setAttribute('aria-expanded', 'false');
      bSpeed?.setAttribute('aria-expanded', 'false');
      bSettings?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'false');
      closeColorPicker();
      hidePopover();
      syncHostStackingElevation(false);
    }
  }

  function toggle(open, tab = 'context') {
    if (!open) {
      showPanel('none');
    } else {
      showPanel(tab === 'tokens' ? 'tokens' : 'context');
    }
  }

  function toggleContext(anchorEl) {
    if (!el('panel').hidden) {
      showPanel('none');
    } else {
      activeContextAnchor = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl : el('badge');
      showPanel('context');
    }
  }

  function toggleTokens() {
    if (!el('panel-tokens').hidden) showPanel('none');
    else showPanel('tokens');
  }

  function toggleOverflowMenu() {
    const pOverflow = el('overflow-menu');
    if (!pOverflow) return;
    const willOpen = pOverflow.hidden;
    showPanel('none');
    hideContextTooltip();
    pOverflow.hidden = !willOpen;
    el('badge-overflow')?.setAttribute('aria-expanded', String(willOpen));
    syncHostStackingElevation(willOpen);
    if (willOpen) positionFloatingPanels();
  }

  // 外观调色按钮直接展开抽屉
  el('btn-panel-palette')?.addEventListener('click', () => toggleColorsDrawer());
  el('btn-panel-tokens-palette')?.addEventListener('click', () => toggleTokenColorsDrawer());

  // =========================================================================
  // 统一定制下拉组件控制器 (国家 / 订阅地区 / 币种 / 增强 Select)
  // =========================================================================
  const COUNTRY_OPTIONS = [
    { value: '未知', label: '🌐 未设置 / 自动', code: 'AUTO', aliases: ['自动', '未知', 'none'] },
    { value: '美国 (US)', label: '🇺🇸 美国 (US)', code: 'US', aliases: ['美国', 'united states', 'usa'] },
    { value: '日本 (JP)', label: '🇯🇵 日本 (JP)', code: 'JP', aliases: ['日本', 'japan'] },
    { value: '韩国 (KR)', label: '🇰🇷 韩国 (KR)', code: 'KR', aliases: ['韩国', 'korea', 'south korea'] },
    { value: '中国台湾 (TW)', label: '🇹🇼 中国台湾 (TW)', code: 'TW', aliases: ['台湾', 'taiwan', 'tw'] },
    { value: '中国香港 (HK)', label: '🇭🇰 中国香港 (HK)', code: 'HK', aliases: ['香港', 'hong kong', 'hk'] },
    { value: '澳大利亚 (AU)', label: '🇦🇺 澳大利亚 (AU)', code: 'AU', aliases: ['澳大利亚', '澳洲', 'australia', 'au'] },
    { value: '新加坡 (SG)', label: '🇸🇬 新加坡 (SG)', code: 'SG', aliases: ['新加坡', 'singapore', 'sg'] },
    { value: '英国 (UK)', label: '🇬🇧 英国 (UK)', code: 'UK', aliases: ['英国', 'united kingdom', 'uk', 'gb', 'britain'] },
    { value: '德国 (DE)', label: '🇩🇪 德国 (DE)', code: 'DE', aliases: ['德国', 'germany', 'de'] },
    { value: '加拿大 (CA)', label: '🇨🇦 加拿大 (CA)', code: 'CA', aliases: ['加拿大', 'canada', 'ca'] },
    { value: '土耳其 (TR)', label: '🇹🇷 土耳其 (TR)', code: 'TR', aliases: ['土耳其', 'turkey', 'tr'] },
    { value: '尼日利亚 (NG)', label: '🇳🇬 尼日利亚 (NG)', code: 'NG', aliases: ['尼日利亚', 'nigeria', 'ng'] },
    { value: '菲律宾 (PH)', label: '🇵🇭 菲律宾 (PH)', code: 'PH', aliases: ['菲律宾', 'philippines', 'ph'] },
    { value: '印度 (IN)', label: '🇮🇳 印度 (IN)', code: 'IN', aliases: ['印度', 'india', 'in'] },
    { value: '马来西亚 (MY)', label: '🇲🇾 马来西亚 (MY)', code: 'MY', aliases: ['马来西亚', 'malaysia', 'my'] },
    { value: '巴西 (BR)', label: '🇧🇷 巴西 (BR)', code: 'BR', aliases: ['巴西', 'brazil', 'br'] },
    { value: '中国大陆 (CN)', label: '🇨🇳 中国大陆 (CN)', code: 'CN', aliases: ['中国大陆', '中国', 'china', 'cn'] }
  ];

  const CURRENCY_OPTIONS = [
    { value: 'USD', code: 'USD', flag: '🇺🇸', symbol: '$', name: '美元', label: '🇺🇸 USD', aliases: ['美元', 'usd', '$', 'dollar'] },
    { value: 'KRW', code: 'KRW', flag: '🇰🇷', symbol: '₩', name: '韩元', label: '🇰🇷 KRW', aliases: ['韩元', 'krw', '₩', 'won'] },
    { value: 'AUD', code: 'AUD', flag: '🇦🇺', symbol: 'AU$', name: '澳元', label: '🇦🇺 AUD', aliases: ['澳元', '澳洲', 'aud', 'au$', 'australian'] },
    { value: 'JPY', code: 'JPY', flag: '🇯🇵', symbol: '¥', name: '日元', label: '🇯🇵 JPY', aliases: ['日元', '日本', 'jpy', '¥', 'yen'] },
    { value: 'HKD', code: 'HKD', flag: '🇭🇰', symbol: 'HK$', name: '港币', label: '🇭🇰 HKD', aliases: ['港币', '香港', 'hkd', 'hk$'] },
    { value: 'TWD', code: 'TWD', flag: '🇹🇼', symbol: 'NT$', name: '新台币', label: '🇹🇼 TWD', aliases: ['台币', '新台币', '台湾', 'twd', 'ntd', 'nt$'] },
    { value: 'TRY', code: 'TRY', flag: '🇹🇷', symbol: '₺', name: '里拉', label: '🇹🇷 TRY', aliases: ['里拉', '土耳其', 'try', '₺', 'lira'] },
    { value: 'NGN', code: 'NGN', flag: '🇳🇬', symbol: '₦', name: '奈拉', label: '🇳🇬 NGN', aliases: ['奈拉', '尼日利亚', 'ngn', '₦', 'naira'] },
    { value: 'CNY', code: 'CNY', flag: '🇨🇳', symbol: '¥', name: '人民币', label: '🇨🇳 CNY', aliases: ['人民币', '中国', 'cny', 'rmb', '¥', 'yuan'] },
    { value: 'EUR', code: 'EUR', flag: '🇪🇺', symbol: '€', name: '欧元', label: '🇪🇺 EUR', aliases: ['欧元', '欧洲', 'eur', '€', 'euro'] },
    { value: 'GBP', code: 'GBP', flag: '🇬🇧', symbol: '£', name: '英镑', label: '🇬🇧 GBP', aliases: ['英镑', '英国', 'gbp', '£', 'pound'] },
    { value: 'SGD', code: 'SGD', flag: '🇸🇬', symbol: 'S$', name: '新元', label: '🇸🇬 SGD', aliases: ['新元', '新加坡', 'sgd', 's$'] },
    { value: 'CAD', code: 'CAD', flag: '🇨🇦', symbol: 'CA$', name: '加元', label: '🇨🇦 CAD', aliases: ['加元', '加拿大', 'cad', 'ca$'] },
    { value: 'PHP', code: 'PHP', flag: '🇵🇭', symbol: '₱', name: '比索', label: '🇵🇭 PHP', aliases: ['比索', '菲律宾', 'php', '₱', 'peso'] },
    { value: 'INR', code: 'INR', flag: '🇮🇳', symbol: '₹', name: '卢比', label: '🇮🇳 INR', aliases: ['卢比', '印度', 'inr', '₹', 'rupee'] },
    { value: 'MYR', code: 'MYR', flag: '🇲🇾', symbol: 'RM', name: '令吉', label: '🇲🇾 MYR', aliases: ['令吉', '马来西亚', 'myr', 'rm', 'ringgit'] },
    { value: 'BRL', code: 'BRL', flag: '🇧🇷', symbol: 'R$', name: '雷亚尔', label: '🇧🇷 BRL', aliases: ['雷亚尔', '巴西', 'brl', 'r$', 'real'] }
  ];

  function hasClass(node, cls) {
    if (!node) return false;
    if (node.classList?.contains) return node.classList.contains(cls);
    return String(node.className || '').split(/\s+/).includes(cls);
  }
  function addClass(node, cls) {
    if (!node) return;
    if (node.classList?.add) { node.classList.add(cls); return; }
    const cur = String(node.className || '').trim();
    if (!cur.split(/\s+/).includes(cls)) node.className = cur ? `${cur} ${cls}` : cls;
  }
  function removeClass(node, cls) {
    if (!node) return;
    if (node.classList?.remove) { node.classList.remove(cls); return; }
    const parts = String(node.className || '').split(/\s+/).filter(c => c !== cls);
    node.className = parts.join(' ');
  }

  // 纯同步 UI 控件回填防护守卫（仅在纯同步赋值代码块内开启，严禁跨越 await）
  let isHydratingUiControls = false;
  function runWithUiHydration(fn) {
    const prev = isHydratingUiControls;
    isHydratingUiControls = true;
    try {
      return fn();
    } finally {
      isHydratingUiControls = prev;
    }
  }

  // 兼容老调用声明
  let isRestoringSettings = false;

  // 异步时序保护：用户主动修改序列号、恢复请求版本号与在途保存计数
  let userActionSeq = 0;
  let restoreRequestSeq = 0;
  let suitePrefsSaveInFlight = 0;

function closeAllDropdowns(exceptWrap = null) {
    const rootScope = (typeof shadow !== 'undefined' && shadow && shadow.querySelectorAll) ? shadow : (typeof document !== 'undefined' ? document : null);
    try {
      rootScope?.querySelectorAll?.('.ag-dropdown-wrapper.is-open')?.forEach(w => {
        if (w !== exceptWrap) removeClass(w, 'is-open');
      });
    } catch {}
  }

  function initDropdownController(cfg) {
    const wrap = el(cfg.wrapId);
    const trigger = el(cfg.triggerId);
    const label = el(cfg.labelId);
    const menu = el(cfg.menuId);
    const linkedSelect = cfg.selectId ? el(cfg.selectId) : null;
    if (!wrap || !trigger || !label || !menu) return null;
    if (trigger._bound) return wrap._controller || null;
    trigger._bound = true;

    let keyboardFocusIndex = -1;
    let listScrollTimer = null;
    let lastClosedMenuSig = '';
    const renderedItemMap = new Map();

    /**
     * 清空挂起的菜单内定位定时器，避免关闭或重建后继续触发滚动。
     */
    function clearListScrollTimer() {
      if (listScrollTimer) {
        clearTimeout(listScrollTimer);
        listScrollTimer = null;
      }
    }

    /**
     * 仅在不触发祖先滚动容器跳转的前提下聚焦元素。
     */
    function focusNoScroll(targetEl) {
      if (!targetEl || typeof targetEl.focus !== 'function') return;
      try {
        targetEl.focus({ preventScroll: true });
      } catch {
        targetEl.focus();
      }
    }

    /**
     * 仅调整下拉菜单自身 scrollTop，严禁调用会穿透滚动外层面板的 scrollIntoView。
     */
    function scrollChildNearestInContainer(scrollBox, childEl) {
      if (!scrollBox || !childEl) return;
      if (typeof scrollBox.getBoundingClientRect !== 'function' || typeof childEl.getBoundingClientRect !== 'function') return;
      try {
        const boxRect = scrollBox.getBoundingClientRect();
        const itemRect = childEl.getBoundingClientRect();
        if (!boxRect || !itemRect || boxRect.height <= 0 || itemRect.height <= 0) return;
        const searchBar = menu.querySelector ? menu.querySelector('.ag-dropdown-search-wrap') : null;
        const stickyTopH = (searchBar && typeof searchBar.getBoundingClientRect === 'function')
          ? Math.max(0, Math.round(searchBar.getBoundingClientRect().height || 0))
          : 0;
        const visTop = boxRect.top + stickyTopH;
        const visBottom = boxRect.bottom;
        const curScroll = Number(scrollBox.scrollTop) || 0;
        if (itemRect.top < visTop) {
          scrollBox.scrollTop = Math.max(0, curScroll - (visTop - itemRect.top + 4));
        } else if (itemRect.bottom > visBottom) {
          scrollBox.scrollTop = curScroll + (itemRect.bottom - visBottom + 4);
        }
      } catch { }
    }

    function renderMenu(kw = '', menuOpts = {}) {
      clearListScrollTimer();
      menu.innerHTML = '';
      if (typeof menu.replaceChildren === 'function') menu.replaceChildren();
      keyboardFocusIndex = -1;

      // 1. 搜索框
      const searchWrap = document.createElement('div');
      searchWrap.className = 'ag-dropdown-search-wrap';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'ag-dropdown-search-input';
      searchInput.placeholder = cfg.searchPlaceholder || '🔍 搜索...';
      searchInput.value = kw;
      searchWrap.appendChild(searchInput);
      menu.appendChild(searchWrap);

      searchInput.addEventListener('click', (e) => e?.stopPropagation?.());
      searchInput.addEventListener('input', (e) => {
        renderList(e.target.value.trim().toLowerCase(), { scrollSelected: false });
      });

      // 2. 列表容器
      const listContainer = document.createElement('div');
      listContainer.className = 'ag-dropdown-list-container';
      menu.appendChild(listContainer);

      let visibleItems = [];

      function updateKeyboardHighlight(newIdx) {
        const itemEls = listContainer.querySelectorAll ? listContainer.querySelectorAll('.ag-dropdown-item') : (listContainer.children || []);
        if (!itemEls.length) return;
        keyboardFocusIndex = Math.max(0, Math.min(newIdx, itemEls.length - 1));
        Array.from(itemEls).forEach((elNode, idx) => {
          if (idx === keyboardFocusIndex) {
            addClass(elNode, 'is-keyboard-focus');
            scrollChildNearestInContainer(menu, elNode);
          } else {
            removeClass(elNode, 'is-keyboard-focus');
          }
        });
      }

      function renderList(searchKey = '', listOpts = {}) {
        clearListScrollTimer();
        if (typeof listContainer.replaceChildren === 'function') listContainer.replaceChildren();
        listContainer.innerHTML = '';
        renderedItemMap.clear();
        const allItems = cfg.getOptions();
        const selectedVal = cfg.getSelectedValue();

        visibleItems = allItems.filter(it => {
          if (!searchKey) return true;
          if (cfg.filterItem) return cfg.filterItem(it, searchKey);
          const t1 = String(it.label || '').toLowerCase();
          const t2 = String(it.value || '').toLowerCase();
          const t3 = String(it.code || '').toLowerCase();
          const aliases = (it.aliases || []).map(a => String(a).toLowerCase());
          return t1.includes(searchKey) || t2.includes(searchKey) || t3.includes(searchKey) || aliases.some(a => a.includes(searchKey));
        });

        if (!visibleItems.length) {
          const emptyDiv = document.createElement('div');
          emptyDiv.style.cssText = 'padding:10px;text-align:center;color:var(--ag-text-muted);font-size:11px';
          emptyDiv.textContent = cfg.emptyText || '未找到匹配项';
          listContainer.appendChild(emptyDiv);
          return;
        }

        visibleItems.forEach((opt, idx) => {
          const itemEl = document.createElement('div');
          const isSelected = cfg.isItemSelected ? cfg.isItemSelected(opt, selectedVal) : (opt.value === selectedVal);
          itemEl.className = 'ag-dropdown-item' + (isSelected ? ' is-selected' : '');
          itemEl.setAttribute?.('data-index', String(idx));
          itemEl.setAttribute?.('data-value', String(opt.value || ''));
          if (opt.tooltip) itemEl.title = opt.tooltip;

          const leftSpan = document.createElement('span');
          leftSpan.textContent = opt.displayLeft || opt.label;

          const rightSpan = document.createElement('span');
          rightSpan.className = 'ag-dropdown-item-sub';
          if (opt.displayRight) {
            rightSpan.textContent = opt.displayRight;
          }

          const extraEl = typeof cfg.renderOptionExtras === 'function' ? cfg.renderOptionExtras(opt) : null;

          const check = document.createElement('span');
          check.className = 'ag-dropdown-item-check';
          check.textContent = '✓';

          itemEl.appendChild(leftSpan);
          if (extraEl) {
            const rightGroup = document.createElement('span');
            rightGroup.className = 'ag-dropdown-item-right';
            rightGroup.appendChild(extraEl);
            if (opt.displayRight) rightGroup.appendChild(rightSpan);
            itemEl.appendChild(rightGroup);
          } else if (opt.displayRight) {
            itemEl.appendChild(rightSpan);
          }
          itemEl.appendChild(check);

          renderedItemMap.set(opt.value, { itemEl, extraEl });

          itemEl.addEventListener('click', (e) => {
            e?.stopPropagation?.();
            selectOption(opt);
          });

          listContainer.appendChild(itemEl);
        });

        // 仅在主动展开菜单时，将当前选中项滚动到下拉列表自身可视区域（绝不触发祖先面板滚动）
        if (listOpts.scrollSelected === true) {
          listScrollTimer = setTimeout(() => {
            listScrollTimer = null;
            if (!hasClass(wrap, 'is-open')) return;
            const selNode = listContainer.querySelector ? listContainer.querySelector('.ag-dropdown-item.is-selected') : null;
            scrollChildNearestInContainer(menu, selNode);
          }, 30);
        }
      }

      function selectOption(opt) {
        clearListScrollTimer();
        clearInputFocusTimer();
        removeClass(wrap, 'is-open');
        const text = cfg.getLabelText ? cfg.getLabelText(opt) : (opt.label || opt.value);
        label.textContent = text;
        if (linkedSelect) {
          runWithUiHydration(() => {
            linkedSelect.value = opt.value;
          });
        }
        if (cfg.onSelect) cfg.onSelect(opt);
        focusNoScroll(trigger);
      }

      renderList(kw, menuOpts);

      // 键盘导航
      const keyHandler = (e) => {
        if (!hasClass(wrap, 'is-open')) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault?.();
          updateKeyboardHighlight(keyboardFocusIndex + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault?.();
          updateKeyboardHighlight(keyboardFocusIndex <= 0 ? 0 : keyboardFocusIndex - 1);
        } else if (e.key === 'Enter') {
          e.preventDefault?.();
          if (keyboardFocusIndex >= 0 && visibleItems[keyboardFocusIndex]) {
            selectOption(visibleItems[keyboardFocusIndex]);
          } else if (visibleItems.length === 1) {
            selectOption(visibleItems[0]);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault?.();
          clearListScrollTimer();
          clearInputFocusTimer();
          removeClass(wrap, 'is-open');
          focusNoScroll(trigger);
        }
      };

      searchInput.addEventListener('keydown', keyHandler);
      menu.addEventListener('keydown', keyHandler);
    }

    let inputFocusTimer = null;
    function clearInputFocusTimer() {
      if (inputFocusTimer) {
        clearTimeout(inputFocusTimer);
        inputFocusTimer = null;
      }
    }

    // 立即预渲染一次菜单内容，避免初次点击或测试环境遇到空白（不触发滚动）
    renderMenu('', { scrollSelected: false });

    function toggleOpen() {
      const isOpen = hasClass(wrap, 'is-open');
      if (!isOpen) {
        closeAllDropdowns(wrap);
        clearInputFocusTimer();

        // 空间不足检测，自适应展开方向
        try {
          const rect = trigger.getBoundingClientRect?.() || { bottom: 0, top: 0 };
          const spaceBelow = (typeof window !== 'undefined' ? (window.innerHeight || 800) : 800) - rect.bottom;
          if (spaceBelow < 240 && rect.top > 240) {
            addClass(wrap, 'open-up');
          } else {
            removeClass(wrap, 'open-up');
          }
        } catch {
          removeClass(wrap, 'open-up');
        }

        addClass(wrap, 'is-open');
        renderMenu('', { scrollSelected: true });
        inputFocusTimer = setTimeout(() => {
          inputFocusTimer = null;
          if (!hasClass(wrap, 'is-open')) return;
          const input = menu.querySelector ? menu.querySelector('.ag-dropdown-search-input') : null;
          focusNoScroll(input);
        }, 50);
      } else {
        clearListScrollTimer();
        clearInputFocusTimer();
        removeClass(wrap, 'is-open');
      }
    }

    trigger.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      toggleOpen();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault?.();
        toggleOpen();
      } else if (e.key === 'Escape') {
        clearListScrollTimer();
        clearInputFocusTimer();
        removeClass(wrap, 'is-open');
      }
    });

    const controller = {
      refresh: () => {
        const val = cfg.getSelectedValue();
        const opts = cfg.getOptions();
        const found = opts.find(o => !o.isGroupHeader && o.value === val);
        const nextText = found
          ? (cfg.getLabelText ? cfg.getLabelText(found) : (found.label || found.value))
          : (typeof cfg.emptyLabel === 'function' ? cfg.emptyLabel() : cfg.emptyLabel);
        if (nextText != null && label.textContent !== nextText) {
          label.textContent = nextText;
        }
        // 关闭态仅在选项结构/选中项变化时静态同步菜单（scrollSelected: false 绝不触发滚动），避免轮询无意义重建或抢滚动
        if (!hasClass(wrap, 'is-open')) {
          const optsSig = `${val || ''}|` + opts.map(o => `${o.value || ''}:${o.label || ''}:${o.displayRight || ''}:${o.badgeText || ''}:${o.isGroupHeader ? 1 : 0}`).join(';');
          if (optsSig !== lastClosedMenuSig) {
            lastClosedMenuSig = optsSig;
            renderMenu('', { scrollSelected: false });
          }
        }
      },
      isOpen: () => hasClass(wrap, 'is-open'),
      updateItemsInPlace: (updater) => {
        if (typeof updater !== 'function') return;
        for (const [val, entry] of renderedItemMap.entries()) {
          updater(val, entry.itemEl, entry.extraEl);
        }
      },
      close: () => {
        clearListScrollTimer();
        clearInputFocusTimer();
        removeClass(wrap, 'is-open');
      },
      open: () => toggleOpen()
    };
    wrap._controller = controller;
    return controller;
  }

  // 刷新国家直接选择器显示
  function refreshDirectCountryDisplay(currentCountryVal) {
    const label = el('direct-country-label');
    if (!label) return;
    const val = currentCountryVal || ANTIGRAVITY_TOKEN_DATA.planStatus?.country || '未知';
    const matched = COUNTRY_OPTIONS.find(o => o.value === val);
    label.textContent = matched ? matched.label : (val !== '未知' ? `🌐 ${val}` : '🌐 未设置 / 自动');
  }

  function getSubscriptionRegionLabel(region) {
    let locale = document.documentElement?.getAttribute?.('data-ag-suite-locale');
    try { locale ||= localStorage.getItem('ag_suite_locale'); } catch {}
    locale ||= 'zh-TW';
    const name = locale === 'zh-TW' ? region.nameTw : locale === 'en' ? region.nameEn : region.name;
    const currency = region.currency === 'NTD' ? 'TWD' : region.currency;
    return (region.flag || '🌏') + ' ' + (name || region.name) + ' (' + currency + ')';
  }

  function formatSubscriptionRegionPrice(region, specKey, core, showRange) {
    const reference = core?.getRegionPlanReferencePrice?.(region, specKey);
    if (reference?.isRange) {
      return showRange ? '$' + reference.minUsd + '~' + reference.maxUsd + '/月' : '';
    }
    const price = reference ? (reference.available ? reference.monthlyPrice : null) : region.monthlyPrice;
    if (price == null) return '';
    if (price === 0) return '$0/月';
    const currency = reference?.currency || region.currency;
    const symbol = reference?.symbol || region.symbol;
    const converted = typeof formatBaseCurrencyParen === 'function'
      ? formatBaseCurrencyParen(price, currency, region.id, 1)
      : '';
    return symbol + price + '/月' + (converted ? ' · ' + converted.slice(1, -1) : '');
  }

  function formatDirectRegionLabel(matched, core) {
    const label = getSubscriptionRegionLabel(matched);
    const plan = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    if (plan.priceMode === 'custom') return label;
    const specKey = core?.resolvePlanSpecKey?.(plan) || plan.tierKey || 'pro';
    const price = formatSubscriptionRegionPrice(matched, specKey, core, false);
    return label + (price ? ' · ' + price : '');
  }

  // 刷新订阅地区直接选择器显示
  function refreshDirectRegionDisplay(currentRegionText) {
    const directLabel = el('direct-region-label');
    if (!directLabel) return;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const presets = core?.SUBSCRIPTION_REGIONS_PRESET || [];
    const reg = currentRegionText || ANTIGRAVITY_TOKEN_DATA.planStatus?.region || '未知';
    const matched = core?.findRegionPreset ? core.findRegionPreset(reg) : presets.find(p => p.id === reg || p.name === reg);
    if (matched) {
      directLabel.textContent = formatDirectRegionLabel(matched, core);
    } else if (reg && reg !== '未知') {
      directLabel.textContent = '🌏 ' + reg;
    } else {
      directLabel.textContent = '🌏 未知 (点击选择订阅地区与货币)';
    }
  }

  // 刷新币种直接选择器显示
  function refreshDirectCurrencyDisplay(currentCurrencyVal) {
    const label = el('direct-currency-label');
    if (!label) return;
    let val = currentCurrencyVal || ANTIGRAVITY_TOKEN_DATA.planStatus?.currency || 'USD';
    if (val === 'NTD') val = 'TWD';
    const matched = CURRENCY_OPTIONS.find(o => o.value === val);
    label.textContent = matched ? matched.label : val;
  }

  const ULTRA_SUB_TIER_OPTIONS = [
    {
      value: '',
      shortLabel: '子档: 未设',
      label: '🌐 未设置 / 自动识别',
      displayLeft: '🌐 未设置 / 自动识别',
      displayRight: '默认显示子档未知',
      aliases: ['auto', 'unknown', '未知', '自动']
    },
    {
      value: '5x',
      shortLabel: '⚡ 5x',
      label: '⚡ Ultra 5x · 5× Pro 配额 ($99.99/月)',
      displayLeft: '⚡ Ultra 5x (5× Pro 配额)',
      displayRight: '$99.99/月 · 10K Flow · 20TB',
      aliases: ['5x', '99.99', '10000', '20tb']
    },
    {
      value: '20x',
      shortLabel: '🚀 20x',
      label: '🚀 Ultra 20x · 20× Pro 配额 ($199.99/月)',
      displayLeft: '🚀 Ultra 20x (20× Pro 配额)',
      displayRight: '$199.99/月 · 25K Flow · 30TB',
      aliases: ['20x', '199.99', '25000', '30tb']
    }
  ];

  function refreshDirectSubTierDisplay(subTierVal) {
    const cleanVal = (subTierVal === '5x' || subTierVal === '20x') ? subTierVal : '';
    const matched = ULTRA_SUB_TIER_OPTIONS.find(o => o.value === cleanVal) || ULTRA_SUB_TIER_OPTIONS[0];
    const directLabel = el('direct-subtier-label');
    const summaryLabel = el('summary-subtier-label');
    const directSel = el('direct-subtier-select');
    if (directLabel) directLabel.textContent = matched.label;
    if (summaryLabel) summaryLabel.textContent = matched.shortLabel;
    if (directSel) {
      runWithUiHydration(() => {
        directSel.value = cleanVal;
      });
    }
    el('direct-subtier-wrap')?._controller?.refresh?.();
    el('summary-subtier-wrap')?._controller?.refresh?.();
  }

  const PLAN_TIER_OPTIONS = [
    { value: 'auto', label: '✨ 自动检测', displayLeft: '✨ 自动检测', displayRight: '跟随当前登录账号' },
    { value: 'free', label: '免费版 (Free)', displayLeft: '免费版 (Free)', displayRight: '$0/月 · 每周基础配额' },
    { value: 'plus', label: 'Google AI Plus', displayLeft: 'Google AI Plus', displayRight: '$4.99/月 · 1.5×/入门配额' },
    { value: 'pro', label: 'Google AI Pro', displayLeft: 'Google AI Pro', displayRight: '$19.99/月 · 5h 基准配额' },
    { value: 'ultra_5x', label: 'Google AI Ultra 5x', displayLeft: '⚡ Google AI Ultra 5x', displayRight: '$99.99/月 · 5× Pro 配额' },
    { value: 'ultra_20x', label: 'Google AI Ultra 20x', displayLeft: '🚀 Google AI Ultra 20x', displayRight: '$199.99/月 · 20× Pro 配额' },
    { value: 'ultra', label: 'Google AI Ultra', displayLeft: 'Google AI Ultra', displayRight: '$99.99~199.99/月 · 子档未定' }
  ];

  function getActivePlanTierControlValue(ps) {
    const plan = ps || ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const ov = String(plan.planTierOverride || '').trim().toLowerCase();
    if (ov && ov !== 'auto' && PLAN_TIER_OPTIONS.some(o => o.value === ov)) return ov;
    if (plan.ultraSubTier === '5x') return 'ultra_5x';
    if (plan.ultraSubTier === '20x') return 'ultra_20x';
    return 'auto';
  }

  function refreshDirectTierDisplay(ps) {
    const plan = (ps && typeof ps === 'object') ? ps : (ANTIGRAVITY_TOKEN_DATA.planStatus || {});
    const val = getActivePlanTierControlValue(plan);
    const matched = PLAN_TIER_OPTIONS.find(o => o.value === val) || PLAN_TIER_OPTIONS[0];
    const directLabel = el('direct-tier-label');
    const directSel = el('direct-tier-select');
    if (directLabel) {
      if (val === 'auto' && plan.tierName && !String(plan.tierName).includes('未知')) {
        directLabel.textContent = `✨ 自动: ${plan.tierName}`;
      } else {
        directLabel.textContent = matched.label;
      }
    }
    if (directSel) {
      runWithUiHydration(() => {
        directSel.value = val;
      });
    }
    el('direct-tier-wrap')?._controller?.refresh?.();
  }

  function renderDirectRegionMenu(filterText = '') {
    const directWrap = el('direct-region-wrap');
    if (directWrap?._controller) {
      directWrap._controller.open();
    }
  }

  // =========================================================================
  // 插件栏设置持久化（币种、国家、订阅地区）与详情面板生命周期管理
  // =========================================================================
  let planDetailExpanded = false;
  let lastSavedCustomPlan = null;
  let lastSaveResult = { ok: true, error: '' };
  let saveFeedbackTimer = null;

  function showPlanSaveFeedback(ok, message) {
    lastSaveResult = { ok: Boolean(ok), error: ok ? '' : (message || '保存失败') };
    const fb = el('plan-save-feedback');
    if (!fb) return;
    if (saveFeedbackTimer) {
      clearTimeout(saveFeedbackTimer);
      saveFeedbackTimer = null;
    }
    fb.style.display = 'inline-block';
    fb.style.color = ok ? 'var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))' : '#f87171';
    fb.textContent = ok ? (message || '✔ 已自动保存') : `✖ 保存失败：${message || '无法写入配置文件'}`;
    if (ok) {
      saveFeedbackTimer = setTimeout(() => {
        if (fb) fb.style.display = 'none';
        saveFeedbackTimer = null;
      }, 2800);
    }
  }

  function closeOpenRegionDropdowns() {
    try {
      const rootScope = (typeof shadow !== 'undefined' && shadow && shadow.querySelectorAll) ? shadow : document;
      rootScope?.querySelectorAll?.('.ag-dropdown-wrapper.is-open')?.forEach(w => w.classList.remove('is-open'));
    } catch {}
  }

  // 统一控制 AI Pro 详情面板展开与收回（手动按钮、切换预估费用、关闭面板共用同一套清理逻辑）
  function setPlanDetailExpanded(expanded, options = {}) {
    const next = Boolean(expanded) && activeTokenView === 'tokens';
    planDetailExpanded = next;
    const card = el('plan-detail-card');
    const btn = el('btn-plan-detail-toggle');
    const form = el('plan-custom-form');

    if (card) {
      card.style.display = next ? 'block' : 'none';
      card.classList?.toggle?.('is-expanded', next);
      card.setAttribute?.('data-expanded', String(next));
      if (!next) {
        try { card.scrollTop = 0; } catch {}
      }
    }
    if (btn) {
      btn.textContent = next ? '收起 ▲' : '详情 ▼';
      btn.setAttribute?.('aria-expanded', String(next));
    }
    el('plan-summary-price-badge')?.setAttribute?.('aria-expanded', String(next));
    if (!next) {
      if (form && form.getAttribute?.('data-in-settings') !== 'true') form.style.display = 'none';
      closeOpenRegionDropdowns();
    }
    if (!options.skipReposition) {
      positionFloatingPanels();
    }
    return planDetailExpanded;
  }

  let currentSaveSeq = 0;

  function getStoredCustomPlanSnapshot(email = 'default') {
    if (lastSavedCustomPlan && typeof lastSavedCustomPlan === 'object') {
      return { ...lastSavedCustomPlan };
    }
    try {
      const key = email && email !== 'default' ? 'ag_custom_plan_' + String(email).toLowerCase() : 'ag_custom_plan_default';
      const raw = localStorage?.getItem(key) || localStorage?.getItem('ag_custom_plan_default');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const hasExplicitCustomPaid = Boolean(ps.isZeroExtraCost || (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined && ps.actualPricePaid !== ''));
    const pm = (ps.priceMode === 'custom' || ps.priceMode === 'preset')
      ? ps.priceMode
      : (ps.priceSource === 'custom' && hasExplicitCustomPaid ? 'custom' : 'preset');
    return {
      accountRegion: (ps.accountRegion && !ps.accountRegion.includes('未知')) ? ps.accountRegion : ((ps.country && !ps.country.includes('未知')) ? ps.country : undefined),
      country: (ps.country && !ps.country.includes('未知')) ? ps.country : undefined,
      subscriptionCountry: (ps.subscriptionCountry && !ps.subscriptionCountry.includes('未知')) ? ps.subscriptionCountry : ((ps.subscriptionRegion && !ps.subscriptionRegion.includes('未知')) ? ps.subscriptionRegion : ((ps.region && !ps.region.includes('未知')) ? ps.region : undefined)),
      subscriptionRegion: (ps.subscriptionRegion && !ps.subscriptionRegion.includes('未知')) ? ps.subscriptionRegion : ((ps.region && !ps.region.includes('未知')) ? ps.region : undefined),
      region: (ps.region && !ps.region.includes('未知')) ? ps.region : undefined,
      subscriptionCurrency: ps.subscriptionCurrency || ps.currency || 'USD',
      currency: ps.currency || 'USD',
      currencySource: ps.currencySource || 'default',
      currencySymbol: ps.currencySymbol || '$',
      actualPricePaid: ps.actualPricePaid ?? null,
      customActualPrice: (pm === 'custom' && ps.actualPricePaid !== null) ? ps.actualPricePaid : (lastSavedCustomPlan?.customActualPrice ?? null),
      priceMode: pm,
      billingCycle: (ps.billingCycle && !ps.billingCycle.includes('未知')) ? ps.billingCycle : '月付',
      acquisitionSource: ps.acquisitionSource || 'normal_paid',
      acquisitionSourceName: ps.acquisitionSourceName || undefined,
      isZeroExtraCost: Boolean(ps.isZeroExtraCost),
      validEndDate: ps.validEndDate || null,
      customNote: ps.customNote || '',
      ultraSubTier: ps.ultraSubTier || lastSavedCustomPlan?.ultraSubTier || undefined,
      planTierOverride: ps.planTierOverride || lastSavedCustomPlan?.planTierOverride || undefined,
      priceSource: ps.priceSource || (pm === 'preset' ? 'preset_region' : 'custom')
    };
  }

  async function persistSettingsToHost(payload = {}) {
    const thisSeq = ++currentSaveSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = payload.email || ps.email || 'default';
    const customObj = payload.customPlan || null;

    // 保存前检查通信桥接，缺失时返回失败
    const hasIpc = typeof window !== 'undefined' && typeof window.contextMeterAPI?.saveSettings === 'function';
    const hasLive = typeof window !== 'undefined' && Boolean(window.__AGContextMeterLive?.port);
    if (!hasIpc && !hasLive) {
      showPlanSaveFeedback(false, '未连接持久化服务，无法保存');
      return { ok: false, error: 'NO_HOST_BRIDGE' };
    }

    try {
      let res = null;
      if (hasIpc) {
        res = await window.contextMeterAPI.saveSettings({ ...payload, email, saveSeq: thisSeq });
      } else if (hasLive) {
        const live = window.__AGContextMeterLive;
        const resp = await fetch(`http://127.0.0.1:${live.port}/save-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
          body: JSON.stringify({ ...payload, email, saveSeq: thisSeq })
        });
        if (!resp.ok) {
          showPlanSaveFeedback(false, `HTTP ${resp.status}`);
          return { ok: false, error: `HTTP ${resp.status}` };
        }
        res = await resp.json().catch(() => null);
      }

      // 请求序列检查：若在此保存期间发生更新的操作，丢弃旧回包，避免旧响应乱序覆盖
      if (thisSeq < currentSaveSeq) {
        return { ok: true, superseded: true };
      }

      if (!res || res.ok === false) {
        showPlanSaveFeedback(false, res?.error || '写入本地配置失败');
        return { ok: false, error: res?.error || '写入本地配置失败' };
      }

      // 宿主落盘确认成功后，才更新内存已保存缓存与全局快照
      if (payload.clearPlan) {
        lastSavedCustomPlan = null;
        if (typeof window !== 'undefined') {
          window.__AGContextMeterSettings = { ok: true, customPlan: null };
        }
        try {
          if (email && email !== 'default') localStorage?.removeItem('ag_custom_plan_' + String(email).toLowerCase());
          localStorage?.removeItem('ag_custom_plan_default');
        } catch {}
      } else {
        const savedPlan = res.customPlan || customObj;
        lastSavedCustomPlan = { ...savedPlan };
        if (typeof window !== 'undefined') {
          window.__AGContextMeterSettings = { ok: true, customPlan: { ...savedPlan } };
        }
        try {
          const jsonStr = JSON.stringify(savedPlan);
          if (email && email !== 'default') {
            localStorage?.setItem('ag_custom_plan_' + String(email).toLowerCase(), jsonStr);
          }
          localStorage?.setItem('ag_custom_plan_default', jsonStr);
        } catch {}
      }

      showPlanSaveFeedback(true, '✔ 已自动保存');
      return res;
    } catch (err) {
      if (thisSeq >= currentSaveSeq) {
        showPlanSaveFeedback(false, err?.message || '持久化异常');
      }
      return { ok: false, error: err?.message || '持久化异常' };
    }
  }

  function applyCustomPlanObjectLocally(customObj, email = 'default') {
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const rawLive = ANTIGRAVITY_TOKEN_DATA.rawPlanStatus || null;
    const cleanLive = rawLive
      ? { ...rawLive, region: '未知', subscriptionRegion: '未知', country: '未知', actualPricePaid: null, regionSource: 'unknown', priceSource: 'unknown' }
      : null;

    if (core && core.resolveEffectivePlanStatus) {
      ANTIGRAVITY_TOKEN_DATA.planStatus = core.resolveEffectivePlanStatus(cleanLive, customObj, { currentEmail: email });
    } else if (customObj) {
      const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
      const sym = (core?.CURRENCY_SYMBOLS && customObj.currency) ? (core.CURRENCY_SYMBOLS[customObj.currency] || customObj.currencySymbol || '$') : (customObj.currencySymbol || '$');
      ANTIGRAVITY_TOKEN_DATA.planStatus = {
        ...ps,
        country: customObj.country || ps.country || '未知',
        countrySource: customObj.country ? 'custom' : (ps.countrySource || 'unknown'),
        region: customObj.subscriptionRegion || customObj.region || ps.region || '未知',
        subscriptionRegion: customObj.subscriptionRegion || customObj.region || ps.subscriptionRegion || '未知',
        regionSource: (customObj.subscriptionRegion || customObj.region) ? 'custom' : (ps.regionSource || 'unknown'),
        currency: customObj.currency || ps.currency || 'USD',
        currencySource: customObj.currency ? 'custom' : (ps.currencySource || 'default'),
        currencySymbol: sym,
        actualPricePaid: customObj.actualPricePaid !== undefined ? customObj.actualPricePaid : ps.actualPricePaid,
        priceSource: customObj.priceSource || 'custom'
      };
    }
    renderPlanDetail(ANTIGRAVITY_TOKEN_DATA.planStatus);
    renderActiveCostEstimateView();
  }

  // 明确切换价格模式：'preset' (跟随订阅国家参考价) 与 'custom' (自定义实付金额)
  function switchPlanPriceMode(newMode) {
    ++userActionSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const targetMode = newMode === 'custom' ? 'custom' : 'preset';

    let customObj = null;
    if (targetMode === 'preset') {
      // 切换为「跟随订阅国家参考价」：实时根据当前订阅国家与档位派生官方参考价与币种
      const currentReg = prevCustom.subscriptionCountry || prevCustom.subscriptionRegion || prevCustom.region || ps.region || '';
      const matched = core?.findRegionPreset ? core.findRegionPreset(currentReg) : core?.SUBSCRIPTION_REGIONS_PRESET?.find(p => p.id === currentReg || p.name === currentReg);
      const specKey = core?.resolvePlanSpecKey
        ? core.resolvePlanSpecKey(ps)
        : (ps.planTierOverride && ps.planTierOverride !== 'auto' ? ps.planTierOverride : (ps.tierKey || 'pro'));
      const refPrice = (matched && core?.getRegionPlanReferencePrice)
        ? core.getRegionPlanReferencePrice(matched, specKey)
        : null;
      const curCode = (refPrice && refPrice.currency) || (matched ? matched.currency : (prevCustom.subscriptionCurrency || prevCustom.currency || 'USD'));
      const curSymbol = (refPrice && refPrice.symbol) || (matched ? matched.symbol : (core?.CURRENCY_SYMBOLS?.[curCode] || '$'));
      const paid = refPrice ? (refPrice.available ? refPrice.monthlyPrice : null) : (matched ? matched.monthlyPrice : null);

      customObj = {
        ...prevCustom,
        priceMode: 'preset',
        priceSource: 'preset_region',
        actualPricePaid: paid,
        subscriptionCurrency: curCode,
        currency: curCode,
        currencySource: 'preset_region',
        currencySymbol: curSymbol,
        billingCycle: '月付',
        isZeroExtraCost: false,
        updatedAt: new Date().toISOString()
      };
      applyCustomPlanObjectLocally(customObj, email);
      togglePlanCustomForm(false);
      void persistSettingsToHost({ email, customPlan: customObj });
    } else {
      // 切换为「自定义实付金额」：若已在自定义模式且表单正展开，再点一次收起；否则展开编辑表单
      const formEl = el('plan-custom-form');
      const isFormOpen = Boolean(formEl && formEl.style.display && formEl.style.display !== 'none');
      if (ps.priceMode === 'custom' && isFormOpen) {
        togglePlanCustomForm(false);
        return;
      }
      const isZero = Boolean(prevCustom.isZeroExtraCost || prevCustom.actualPricePaid === 0);
      const paid = isZero ? 0 : (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined ? prevCustom.actualPricePaid : (prevCustom.customActualPrice ?? null));

      customObj = {
        ...prevCustom,
        priceMode: 'custom',
        priceSource: 'custom',
        actualPricePaid: paid,
        customActualPrice: paid,
        updatedAt: new Date().toISOString()
      };
      applyCustomPlanObjectLocally(customObj, email);
      togglePlanCustomForm(true);
      void persistSettingsToHost({ email, customPlan: customObj });
    }
  }

  // 用户点选「订阅国家」：在参考价模式下实时派生价格与币种，在自定义模式下保持用户实付金额与币种
  function applyDirectRegionSelection(regionItem) {
    if (!regionItem) return;
    ++userActionSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const regionName = regionItem.name + ' (' + (regionItem.currency === 'TWD' ? 'NTD' : regionItem.currency) + ')';
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;

    const hasExplicitCustomPaid = Boolean(prevCustom.isZeroExtraCost || (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined && prevCustom.actualPricePaid !== ''));
    const currentPriceMode = (prevCustom.priceMode === 'custom' || prevCustom.priceMode === 'preset')
      ? prevCustom.priceMode
      : (prevCustom.priceSource === 'custom' && hasExplicitCustomPaid ? 'custom' : 'preset');

    let curCode = regionItem.currency;
    let curSymbol = core?.CURRENCY_SYMBOLS?.[curCode] || regionItem.symbol || '$';
    let paid = null;
    let priceSource = 'preset_region';
    let isZero = false;
    let cycle = '月付';

    if (currentPriceMode === 'custom') {
      // 自定义实付模式：切换国家严格保留用户此前设置的实付金额与币种，绝不静默覆盖！
      isZero = Boolean(prevCustom.isZeroExtraCost || prevCustom.actualPricePaid === 0);
      curCode = prevCustom.subscriptionCurrency || prevCustom.currency || regionItem.currency;
      curSymbol = core?.CURRENCY_SYMBOLS?.[curCode] || '$';
      paid = isZero ? 0 : (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined ? prevCustom.actualPricePaid : null);
      priceSource = 'custom';
      cycle = isZero ? '随套餐赠送/免费' : (prevCustom.billingCycle || '月付');
    } else {
      // 切换为「跟随订阅国家参考价」：实时从对应档位与预设派生定价、币种与周期
      const specKey = core?.resolvePlanSpecKey
        ? core.resolvePlanSpecKey(ps)
        : (ps.planTierOverride && ps.planTierOverride !== 'auto' ? ps.planTierOverride : (ps.tierKey || 'pro'));
      const refPrice = core?.getRegionPlanReferencePrice
        ? core.getRegionPlanReferencePrice(regionItem, specKey)
        : null;
      curCode = (refPrice && refPrice.currency) || regionItem.currency;
      curSymbol = (refPrice && refPrice.symbol) || core?.CURRENCY_SYMBOLS?.[curCode] || regionItem.symbol || '$';
      paid = refPrice ? (refPrice.available ? refPrice.monthlyPrice : null) : regionItem.monthlyPrice;
      priceSource = (refPrice && refPrice.source) || 'preset_region';
      isZero = false;
      cycle = '月付';
    }

    const customObj = {
      ...prevCustom,
      accountRegion: prevCustom.accountRegion || prevCustom.country || undefined,
      country: prevCustom.country || prevCustom.accountRegion || undefined,
      subscriptionCountry: regionName,
      subscriptionRegion: regionName,
      region: regionName,
      acquisitionSource: prevCustom.acquisitionSource || ps.acquisitionSource || 'normal_paid',
      acquisitionSourceName: prevCustom.acquisitionSourceName || ps.acquisitionSourceName || undefined,
      isZeroExtraCost: isZero,
      actualPricePaid: paid,
      customActualPrice: currentPriceMode === 'custom' ? paid : (prevCustom.customActualPrice ?? null),
      priceMode: currentPriceMode,
      subscriptionCurrency: curCode,
      currency: curCode,
      currencySource: currentPriceMode === 'custom' ? 'custom' : 'preset_region',
      currencySymbol: curSymbol,
      billingCycle: isZero ? '随套餐赠送/免费' : cycle,
      priceSource,
      updatedAt: new Date().toISOString()
    };

    refreshDirectRegionDisplay(regionName);
    refreshDirectCurrencyDisplay(curCode);
    applyCustomPlanObjectLocally(customObj, email);

    // 双向同步：更新订阅国家表单及币种（使用纯同步防护守卫，防级联循环）
    runWithUiHydration(() => {
      const directCurSel = el('direct-currency-select');
      if (directCurSel) directCurSel.value = curCode === 'TWD' ? 'TWD' : curCode;
      const form = el('plan-custom-form');
      if (form) {
        const regInput = el('input-custom-region');
        const curSelect = el('select-custom-currency');
        const paidInput = el('input-custom-paid');
        const zeroCheck = el('check-zero-extra');
        if (regInput) regInput.value = regionName;
        if (curSelect) {
          curSelect.value = curCode;
          enhancedDropdowns.get('select-custom-currency')?.refresh?.();
        }
        if (paidInput && !zeroCheck?.checked) {
          paidInput.value = (paid !== null && paid !== undefined) ? paid : '';
        }
        const prevEl = el('region-cny-preview');
        if (prevEl && paid !== null) {
          const paren = typeof formatBaseCurrencyParen === 'function'
            ? formatBaseCurrencyParen(paid, regionItem.currency, regionItem.name, 1)
            : '';
          prevEl.textContent = paren ? ('折合 ' + paren.replace(/^\(|\)$/g, '') + '/月') : '';
        }
      }
    });

    void persistSettingsToHost({ email, customPlan: customObj });
  }

  // 用户单独修改「账号所在地区」：仅修改本地记录，绝不影响订阅国家、订阅币种或订阅金额
  function applyDirectCountrySelection(newCountryVal) {
    ++userActionSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const cleanCountry = (newCountryVal && newCountryVal !== '未知') ? String(newCountryVal).trim() : '';

    const customObj = {
      ...prevCustom,
      accountRegion: cleanCountry || undefined,
      country: cleanCountry || undefined,
      updatedAt: new Date().toISOString()
    };
    if (!cleanCountry) {
      delete customObj.accountRegion;
      delete customObj.country;
    }

    refreshDirectCountryDisplay(cleanCountry || '未知');

    runWithUiHydration(() => {
      const countryInput = el('input-custom-country');
      if (countryInput) countryInput.value = cleanCountry;
      const directCountrySel = el('direct-country-select');
      if (directCountrySel) directCountrySel.value = cleanCountry || '未知';
    });

    applyCustomPlanObjectLocally(customObj, email);
    void persistSettingsToHost({ email, customPlan: customObj });
  }

  // 用户单独修改「订阅币种」：独立更新结算币种与符号，严格保持账号所在地区和订阅国家不变
  function applyDirectCurrencySelection(newCurrencyVal) {
    if (!newCurrencyVal) return;
    ++userActionSeq;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    let curCode = String(newCurrencyVal).trim().toUpperCase();
    if (curCode === 'NTD') curCode = 'TWD';
    const curSymbol = core?.CURRENCY_SYMBOLS?.[curCode] || '$';

    refreshDirectCurrencyDisplay(curCode);

    const hasExplicitCustomPaid = Boolean(prevCustom.isZeroExtraCost || (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined && prevCustom.actualPricePaid !== ''));
    const currentPriceMode = (prevCustom.priceMode === 'custom' || prevCustom.priceMode === 'preset')
      ? prevCustom.priceMode
      : (prevCustom.priceSource === 'custom' && hasExplicitCustomPaid ? 'custom' : 'preset');
    let paid = prevCustom.actualPricePaid;
    let priceSource = currentPriceMode === 'custom' ? 'custom' : 'preset_region';
    const isZero = Boolean(prevCustom.isZeroExtraCost || prevCustom.actualPricePaid === 0);

    if (isZero) {
      paid = 0;
      priceSource = 'custom';
    } else if (currentPriceMode === 'preset') {
      // 检查新币种在预设库中是否有当前档位对应的基准定价
      const matchedNewPreset = core?.SUBSCRIPTION_REGIONS_PRESET?.find(p => p.currency === curCode);
      if (matchedNewPreset) {
        const specKey = core?.resolvePlanSpecKey
          ? core.resolvePlanSpecKey(ps)
          : (ps.planTierOverride && ps.planTierOverride !== 'auto' ? ps.planTierOverride : (ps.tierKey || 'pro'));
        const refPrice = core?.getRegionPlanReferencePrice ? core.getRegionPlanReferencePrice(matchedNewPreset, specKey) : null;
        paid = refPrice ? (refPrice.available ? refPrice.monthlyPrice : null) : matchedNewPreset.monthlyPrice;
        priceSource = (refPrice && refPrice.source) || 'preset_region';
      } else {
        paid = prevCustom.actualPricePaid;
      }
    } else {
      paid = prevCustom.actualPricePaid;
      priceSource = 'custom';
    }

    const customObj = {
      ...prevCustom,
      accountRegion: prevCustom.accountRegion || prevCustom.country || undefined,
      country: prevCustom.country || prevCustom.accountRegion || undefined,
      subscriptionCountry: prevCustom.subscriptionCountry || prevCustom.subscriptionRegion || prevCustom.region || undefined,
      subscriptionRegion: prevCustom.subscriptionRegion || prevCustom.region || undefined,
      region: prevCustom.subscriptionRegion || prevCustom.region || undefined,
      subscriptionCurrency: curCode,
      currency: curCode,
      currencySource: 'custom',
      currencySymbol: curSymbol,
      actualPricePaid: paid,
      customActualPrice: currentPriceMode === 'custom' ? paid : (prevCustom.customActualPrice ?? null),
      priceMode: currentPriceMode,
      priceSource,
      updatedAt: new Date().toISOString()
    };

    runWithUiHydration(() => {
      const formCurSel = el('select-custom-currency');
      if (formCurSel) {
        formCurSel.value = curCode;
        enhancedDropdowns.get('select-custom-currency')?.refresh?.();
      }
      const directCurSel = el('direct-currency-select');
      if (directCurSel) directCurSel.value = curCode;
      const paidInput = el('input-custom-paid');
      if (paidInput && !isZero) {
        paidInput.value = (paid !== null && paid !== undefined) ? paid : '';
      }
    });

    applyCustomPlanObjectLocally(customObj, email);
    void persistSettingsToHost({ email, customPlan: customObj });
  }

  el('direct-country-select')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    applyDirectCountrySelection(e.target?.value || '');
  });

  el('direct-currency-select')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    applyDirectCurrencySelection(e.target?.value || 'USD');
  });

  // 用户手动选择 Google AI Ultra 子档 (5x / 20x / 自动)
  function applyDirectSubTierSelection(newSubTierVal) {
    ++userActionSeq;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const norm = core?.normalizeUltraSubTier
      ? (core.normalizeUltraSubTier(newSubTierVal) || '')
      : ((newSubTierVal === '5x' || newSubTierVal === '20x') ? newSubTierVal : '');

    const hasExplicitCustomPaid = Boolean(prevCustom.isZeroExtraCost || (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined && prevCustom.actualPricePaid !== ''));
    const currentPriceMode = (prevCustom.priceMode === 'custom' || prevCustom.priceMode === 'preset')
      ? prevCustom.priceMode
      : (prevCustom.priceSource === 'custom' && hasExplicitCustomPaid ? 'custom' : 'preset');

    const currentReg = prevCustom.subscriptionCountry || prevCustom.subscriptionRegion || prevCustom.region || ps.region || '';
    const matchedRegPreset = core?.findRegionPreset ? core.findRegionPreset(currentReg) : null;
    const subSpec = norm && core?.ULTRA_SUB_TIER_PRESETS ? core.ULTRA_SUB_TIER_PRESETS[norm] : null;

    const customObj = {
      ...prevCustom,
      ultraSubTier: norm || null,
      updatedAt: new Date().toISOString()
    };

    if (currentPriceMode === 'preset') {
      if (matchedRegPreset && matchedRegPreset.currency === 'USD' && subSpec) {
        customObj.actualPricePaid = subSpec.officialPriceMonthly;
        customObj.priceMode = 'preset';
        customObj.priceSource = 'preset_region';
      } else if (!matchedRegPreset) {
        customObj.actualPricePaid = null;
        customObj.priceMode = 'preset';
        customObj.priceSource = subSpec ? 'official_reference' : 'unknown';
      }
    }

    refreshDirectSubTierDisplay(norm);
    applyCustomPlanObjectLocally(customObj, email);
    void persistSettingsToHost({ email, customPlan: customObj });
  }

  el('direct-subtier-select')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    applyDirectSubTierSelection(e.target?.value || '');
  });

  // 用户手动选择订阅方案档位覆盖 (auto / free / plus / pro / ultra_5x / ultra_20x / ultra)
  function applyDirectTierSelection(newTierVal) {
    ++userActionSeq;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const raw = String(newTierVal || 'auto').trim().toLowerCase();
    const VALID_TIERS = new Set(['auto', 'free', 'plus', 'pro', 'ultra_5x', 'ultra_20x', 'ultra']);
    const norm = VALID_TIERS.has(raw) ? raw : 'auto';

    const hasExplicitCustomPaid = Boolean(prevCustom.isZeroExtraCost || (prevCustom.actualPricePaid !== null && prevCustom.actualPricePaid !== undefined && prevCustom.actualPricePaid !== ''));
    const currentPriceMode = (prevCustom.priceMode === 'custom' || prevCustom.priceMode === 'preset')
      ? prevCustom.priceMode
      : (prevCustom.priceSource === 'custom' && hasExplicitCustomPaid ? 'custom' : 'preset');

    const nextUltraSub = norm === 'ultra_5x' ? '5x' : (norm === 'ultra_20x' ? '20x' : null);
    const customObj = {
      ...prevCustom,
      planTierOverride: norm === 'auto' ? null : norm,
      ultraSubTier: nextUltraSub,
      updatedAt: new Date().toISOString()
    };

    if (currentPriceMode === 'preset') {
      const currentReg = prevCustom.subscriptionCountry || prevCustom.subscriptionRegion || prevCustom.region || ps.region || '';
      const matchedRegPreset = core?.findRegionPreset ? core.findRegionPreset(currentReg) : null;
      const specKey = norm === 'auto'
        ? (core?.resolvePlanSpecKey ? core.resolvePlanSpecKey({ ...ps, planTierOverride: null, ultraSubTier: null }) : (ps.tierKey || 'pro'))
        : norm;
      const refPrice = (matchedRegPreset && core?.getRegionPlanReferencePrice)
        ? core.getRegionPlanReferencePrice(matchedRegPreset, specKey)
        : null;
      if (refPrice && refPrice.available && refPrice.monthlyPrice != null) {
        customObj.actualPricePaid = refPrice.monthlyPrice;
        customObj.subscriptionCurrency = refPrice.currency || customObj.subscriptionCurrency;
        customObj.currency = refPrice.currency || customObj.currency;
        customObj.currencySymbol = refPrice.symbol || customObj.currencySymbol;
        customObj.priceMode = 'preset';
        customObj.priceSource = refPrice.source || 'preset_region';
      } else {
        const tierSpec = core?.getPlanTierSpec ? core.getPlanTierSpec(specKey) : core?.SUBSCRIPTION_TIER_SPECS?.[specKey];
        if (tierSpec && tierSpec.officialPriceUSD !== null && tierSpec.officialPriceUSD !== undefined) {
          customObj.actualPricePaid = matchedRegPreset ? null : tierSpec.officialPriceUSD;
          customObj.priceMode = 'preset';
          customObj.priceSource = matchedRegPreset ? 'official_reference' : 'official_reference';
        } else {
          customObj.actualPricePaid = null;
          customObj.priceMode = 'preset';
          customObj.priceSource = 'unknown';
        }
      }
    }

    refreshDirectSubTierDisplay(nextUltraSub || '');
    refreshDirectTierDisplay({ ...ps, planTierOverride: customObj.planTierOverride, ultraSubTier: nextUltraSub });
    applyCustomPlanObjectLocally(customObj, email);
    refreshDirectRegionDisplay(customObj.subscriptionRegion || ps.region || '未知');
    el('direct-region-wrap')?._controller?.refresh?.();
    void persistSettingsToHost({ email, customPlan: customObj });
  }

  el('direct-tier-select')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    applyDirectTierSelection(e.target?.value || 'auto');
  });

  // 绑定统一定制「账号所在地区」、「订阅国家」与「订阅币种」下拉组件
  function initDirectCountryDropdown() {
    return initDropdownController({
      wrapId: 'direct-country-wrap',
      triggerId: 'direct-country-trigger',
      labelId: 'direct-country-label',
      menuId: 'direct-country-menu',
      selectId: 'direct-country-select',
      searchPlaceholder: '🔍 搜索账号所在地区或代码 (如: 美国、TW、JP)...',
      getOptions: () => COUNTRY_OPTIONS,
      getSelectedValue: () => {
        const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
        return (ps.country && !String(ps.country).includes('未知')) ? String(ps.country).trim() : '未知';
      },
      getLabelText: (opt) => opt.label,
      onSelect: (opt) => {
        applyDirectCountrySelection(opt.value);
      },
      emptyText: '未找到匹配的账号所在地区'
    });
  }

  function initDirectRegionDropdown() {
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const presets = core?.SUBSCRIPTION_REGIONS_PRESET || [];
    return initDropdownController({
      wrapId: 'direct-region-wrap',
      triggerId: 'direct-region-trigger',
      labelId: 'direct-region-label',
      menuId: 'direct-region-menu',
      searchPlaceholder: '🔍 搜索订阅国家/地区、货币或缩写 (如: 台湾、澳、USD)...',
      getOptions: () => {
        const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
        const specKey = core?.resolvePlanSpecKey
          ? core.resolvePlanSpecKey(ps)
          : (ps.tierKey === 'ultra' ? (ps.ultraSubTier === '5x' ? 'ultra_5x' : (ps.ultraSubTier === '20x' ? 'ultra_20x' : 'ultra')) : (ps.tierKey || 'pro'));
        return presets.map(p => {
          const curCode = p.currency === 'NTD' ? 'TWD' : p.currency;
          const label = getSubscriptionRegionLabel(p);
          const displayRight = formatSubscriptionRegionPrice(p, specKey, core, true);
          return {
            value: p.id,
            rawItem: p,
            label,
            displayLeft: label,
            displayRight,
            code: p.id,
            currency: curCode,
            aliases: p.aliases || []
          };
        });
      },
      getSelectedValue: () => {
        const currentReg = ANTIGRAVITY_TOKEN_DATA.planStatus?.region || '';
        const matched = core?.findRegionPreset ? core.findRegionPreset(currentReg) : presets.find(p => p.id === currentReg || p.name === currentReg);
        return matched ? matched.id : '';
      },
      filterItem: (it, kw) => {
        const curCode = String(it.currency || '').toLowerCase();
        const name = String(it.label || '').toLowerCase();
        const id = String(it.code || '').toLowerCase();
        const aliases = (it.aliases || []).map(a => String(a).toLowerCase());
        return name.includes(kw) || id.includes(kw) || curCode.includes(kw) || aliases.some(a => a.includes(kw));
      },
      getLabelText: (opt) => {
        const p = opt.rawItem;
        if (!p) return opt.label;
        return formatDirectRegionLabel(p, core);
      },
      onSelect: (opt) => {
        if (opt.rawItem) applyDirectRegionSelection(opt.rawItem);
      },
      emptyText: '未找到匹配的订阅国家/地区'
    });
  }

  function initDirectCurrencyDropdown() {
    return initDropdownController({
      wrapId: 'direct-currency-wrap',
      triggerId: 'direct-currency-trigger',
      labelId: 'direct-currency-label',
      menuId: 'direct-currency-menu',
      selectId: 'direct-currency-select',
      searchPlaceholder: '🔍 搜索订阅币种、代码或符号 (如: 美元、AUD、¥、$)...',
      getOptions: () => CURRENCY_OPTIONS.map(it => ({
        ...it,
        displayLeft: it.label,
        displayRight: `${it.symbol} ${it.name}`
      })),
      getSelectedValue: () => {
        const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
        let cur = ps.currency || 'USD';
        if (cur === 'NTD') cur = 'TWD';
        return cur;
      },
      filterItem: (it, kw) => {
        const name = String(it.name || '').toLowerCase();
        const code = String(it.code || '').toLowerCase();
        const sym = String(it.symbol || '').toLowerCase();
        const label = String(it.label || '').toLowerCase();
        const aliases = (it.aliases || []).map(a => String(a).toLowerCase());
        return name.includes(kw) || code.includes(kw) || sym.includes(kw) || label.includes(kw) || aliases.some(a => a.includes(kw));
      },
      getLabelText: (opt) => opt.label,
      onSelect: (opt) => {
        applyDirectCurrencySelection(opt.value);
      },
      emptyText: '未找到匹配的订阅币种'
    });
  }

  function initDirectSubTierDropdown() {
    return initDropdownController({
      wrapId: 'direct-subtier-wrap',
      triggerId: 'direct-subtier-trigger',
      labelId: 'direct-subtier-label',
      menuId: 'direct-subtier-menu',
      selectId: 'direct-subtier-select',
      searchPlaceholder: '🔍 搜索 Ultra 子档 (5x / 20x)...',
      getOptions: () => ULTRA_SUB_TIER_OPTIONS,
      getSelectedValue: () => {
        const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
        return (ps.ultraSubTier === '5x' || ps.ultraSubTier === '20x') ? ps.ultraSubTier : '';
      },
      getLabelText: (opt) => opt.label,
      onSelect: (opt) => {
        applyDirectSubTierSelection(opt.value);
      },
      emptyText: '未找到匹配的子档'
    });
  }

  function initSummarySubTierDropdown() {
    return initDropdownController({
      wrapId: 'summary-subtier-wrap',
      triggerId: 'summary-subtier-trigger',
      labelId: 'summary-subtier-label',
      menuId: 'summary-subtier-menu',
      selectId: 'direct-subtier-select',
      searchPlaceholder: '🔍 选择 Ultra 子档 (5x / 20x)...',
      getOptions: () => ULTRA_SUB_TIER_OPTIONS,
      getSelectedValue: () => {
        const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
        return (ps.ultraSubTier === '5x' || ps.ultraSubTier === '20x') ? ps.ultraSubTier : '';
      },
      getLabelText: (opt) => opt.shortLabel || opt.label,
      onSelect: (opt) => {
        applyDirectSubTierSelection(opt.value);
      },
      emptyText: '未找到匹配的子档'
    });
  }

  function initDirectTierDropdown() {
    return initDropdownController({
      wrapId: 'direct-tier-wrap',
      triggerId: 'direct-tier-trigger',
      labelId: 'direct-tier-label',
      menuId: 'direct-tier-menu',
      selectId: 'direct-tier-select',
      searchPlaceholder: '🔍 搜索订阅方案 (Free / Plus / Pro / Ultra 5x / 20x)...',
      getOptions: () => PLAN_TIER_OPTIONS,
      getSelectedValue: () => getActivePlanTierControlValue(),
      getLabelText: (opt) => opt.label,
      onSelect: (opt) => {
        applyDirectTierSelection(opt.value);
      },
      emptyText: '未找到匹配的订阅方案'
    });
  }

  // 立即触发初始化三大原生定制下拉及订阅方案/Ultra 子档选择器
  initDirectCountryDropdown();
  initDirectRegionDropdown();
  initDirectCurrencyDropdown();
  initDirectSubTierDropdown();
  initSummarySubTierDropdown();
  initDirectTierDropdown();

  // 全局点击外部关闭所有下拉
  if (typeof shadow !== 'undefined' && shadow && shadow.addEventListener) {
    shadow.addEventListener('click', (e) => {
      if (!e.target?.closest?.('.ag-dropdown-wrapper')) {
        closeAllDropdowns();
      }
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', (e) => {
      if (!e.target?.closest?.('.ag-dropdown-wrapper')) {
        closeAllDropdowns();
      }
    });
  }

  // 套餐详情卡片展开与收回（统一走 setPlanDetailExpanded）
  el('plan-summary-price-badge')?.addEventListener('click', () => {
    setPlanDetailExpanded(!planDetailExpanded);
  });
  el('btn-plan-detail-toggle')?.addEventListener('click', () => {
    const card = el('plan-detail-card');
    const currentlyHidden = !card || card.style.display === 'none' || !card.style.display;
    setPlanDetailExpanded(currentlyHidden);
  });
  el('btn-plan-detail-collapse-top')?.addEventListener('click', () => {
    setPlanDetailExpanded(false);
  });
  el('btn-plan-detail-collapse')?.addEventListener('click', () => {
    setPlanDetailExpanded(false);
  });

  // 原生质感自定义下拉选择增强器
  const enhancedDropdowns = new Map();
  function enhanceCustomSelect(selectId) {
    const sel = el(selectId);
    if (!sel || !sel.parentNode) return null;
    if (enhancedDropdowns.has(selectId)) {
      const existing = enhancedDropdowns.get(selectId);
      existing.refresh();
      return existing;
    }

    sel.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'ag-dropdown-wrapper';
    wrap.setAttribute('data-target-select', selectId);

    const trigger = document.createElement('div');
    trigger.className = 'ag-dropdown-trigger';
    trigger.setAttribute('tabindex', '0');

    const label = document.createElement('span');
    label.className = 'ag-dropdown-label';
    label.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1';

    const arrow = document.createElement('div');
    arrow.className = 'ag-dropdown-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>';

    trigger.appendChild(label);
    trigger.appendChild(arrow);
    wrap.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'ag-dropdown-menu';
    wrap.appendChild(menu);

    const renderOptions = () => {
      menu.innerHTML = '';
      const selectedVal = sel.value;
      const opts = Array.from(sel.options);
      let activeText = '';

      opts.forEach((opt) => {
        const item = document.createElement('div');
        item.className = 'ag-dropdown-item' + (opt.value === selectedVal ? ' is-selected' : '');

        const textSpan = document.createElement('span');
        if (opt.text.includes(' · ')) {
          const parts = opt.text.split(' · ');
          textSpan.textContent = parts[0];
          const subSpan = document.createElement('span');
          subSpan.className = 'ag-dropdown-item-sub';
          subSpan.textContent = parts.slice(1).join(' · ');
          item.appendChild(textSpan);
          item.appendChild(subSpan);
        } else {
          textSpan.textContent = opt.text;
          item.appendChild(textSpan);
        }

        const check = document.createElement('span');
        check.className = 'ag-dropdown-item-check';
        check.textContent = '✓';
        item.appendChild(check);

        if (opt.value === selectedVal) {
          activeText = opt.text;
        }

        item.addEventListener('click', (e) => {
          e?.stopPropagation?.();
          sel.value = opt.value;
          renderOptions();
          wrap?.classList?.remove?.('is-open');
          if (typeof Event !== 'undefined') sel.dispatchEvent(new Event('change', { bubbles: true })); else sel.dispatchEvent?.({ type: 'change' });
        });

        menu.appendChild(item);
      });

      label.textContent = activeText || sel.selectedOptions[0]?.text || sel.options[0]?.text || '';
    };

    renderOptions();

    trigger.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      const isOpen = Boolean(wrap?.classList?.contains?.('is-open'));
      const rootScope = (typeof shadow !== 'undefined' && shadow && shadow.querySelectorAll) ? shadow : (typeof document !== 'undefined' ? document : null);
      rootScope?.querySelectorAll?.('.ag-dropdown-wrapper.is-open')?.forEach(w => {
        if (w !== wrap) w.classList.remove('is-open');
      });
      if (!isOpen) {
        renderOptions();
        wrap?.classList?.add?.('is-open');
      } else {
        wrap?.classList?.remove?.('is-open');
      }
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      } else if (e.key === 'Escape') {
        wrap?.classList?.remove?.('is-open');
      }
    });

    sel.parentNode.insertBefore(wrap, sel.nextSibling);

    sel.addEventListener('change', () => {
      renderOptions();
    });

    const handler = {
      wrap,
      refresh: renderOptions
    };
    enhancedDropdowns.set(selectId, handler);
    return handler;
  }

  // 点击外部自动收起下拉浮层
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', (e) => {
      try {
        if (!e.target?.closest?.('.ag-dropdown-wrapper')) {
          const root = (typeof shadow !== 'undefined' && shadow && shadow.querySelectorAll) ? shadow : document;
          root.querySelectorAll('.ag-dropdown-wrapper.is-open').forEach(w => w.classList.remove('is-open'));
        }
      } catch {}
    });
  }

  /**
   * 将当前账号套餐状态同步回填到自定义订阅表单控件，可选跳过用户正在编辑的输入框。
   */
  function syncPlanCustomFormFields(ps, opts = {}) {
    if (!ps) return;
    const acqSelect = el('select-custom-acq');
    const acqNameInput = el('input-custom-acq-name');
    const zeroCheck = el('check-zero-extra');
    const countryInput = el('input-custom-country');
    const regInput = el('input-custom-region');
    const paidInput = el('input-custom-paid');
    const curSelect = el('select-custom-currency');
    const cycleSelect = el('select-custom-cycle');
    const validEndInput = el('input-valid-end');
    const noteInput = el('input-custom-note');
    const activeEl = opts.skipFocused ? (shadow?.activeElement || document?.activeElement || null) : null;
    const canWrite = (node) => Boolean(node) && (!activeEl || node !== activeEl);
    const coreRef = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const isPresetAcqName = ps.acquisitionSourceName === '正常付费订阅'
      || Boolean(coreRef?.SUBSCRIPTION_ACQUISITION_PRESETS?.some?.(p => p.name === ps.acquisitionSourceName));

    runWithUiHydration(() => {
      if (acqSelect && ps.acquisitionSource) acqSelect.value = ps.acquisitionSource;
      if (canWrite(acqNameInput)) acqNameInput.value = (ps.acquisitionSourceName && !isPresetAcqName) ? ps.acquisitionSourceName : '';
      if (zeroCheck) zeroCheck.checked = Boolean(ps.isZeroExtraCost || ps.actualPricePaid === 0);
      if (canWrite(countryInput)) countryInput.value = (ps.country && !ps.country.includes('未知')) ? ps.country : '';
      if (canWrite(regInput)) regInput.value = (ps.region && !ps.region.includes('未知')) ? ps.region : '';
      if (canWrite(paidInput)) {
        paidInput.value = (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined) ? ps.actualPricePaid : (zeroCheck?.checked ? '0' : '');
        paidInput.disabled = Boolean(zeroCheck?.checked);
      }
      if (curSelect && ps.currency) curSelect.value = ps.currency;
      if (cycleSelect && ps.billingCycle && !ps.billingCycle.includes('未知')) cycleSelect.value = ps.billingCycle.replace(/（.*）/, '').trim();
      if (canWrite(validEndInput)) validEndInput.value = ps.validEndDate || '';
      if (canWrite(noteInput)) noteInput.value = ps.customNote || '';
      const ids = ['select-custom-acq', 'select-custom-region-preset', 'select-custom-currency', 'select-custom-cycle'];
      if (opts.enhance) {
        ids.forEach(id => enhanceCustomSelect(id));
      } else {
        ids.forEach(id => enhancedDropdowns.get(id)?.refresh?.());
      }
    });
  }

  // 就地行内自定义订阅表单交互（实际读取优先于手填，支持官方依据活动来源）
  function togglePlanCustomForm(forceOpen) {
    const form = el('plan-custom-form');
    if (!form) return;
    const curHidden = form.style.display === 'none' || !form.style.display;
    const next = typeof forceOpen === 'boolean' ? forceOpen : curHidden;
    const inSettings = form.getAttribute?.('data-in-settings') === 'true';
    form.style.display = next ? 'block' : 'none';
    if (next) {
      const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
      syncPlanCustomFormFields(ps, { enhance: true });
      if (!inSettings) el('input-custom-region')?.focus?.();
    }
    positionFloatingPanels();
  }

  el('select-custom-region-preset')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    const presetId = e.target?.value || '';
    if (!presetId || presetId === 'custom') return;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const matched = core?.SUBSCRIPTION_REGIONS_PRESET?.find(p => p.id === presetId);
    if (matched) {
      applyDirectRegionSelection(matched);
    }
  });

  el('check-zero-extra')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    const paidInput = el('input-custom-paid');
    if (e.target.checked) {
      if (paidInput) {
        paidInput.value = '0';
        paidInput.disabled = true;
      }
    } else {
      if (paidInput) {
        paidInput.disabled = false;
        if (paidInput.value === '0') paidInput.value = '';
      }
      const cycleSelect = el('select-custom-cycle');
      if (cycleSelect && (cycleSelect.value === '免费/赠送' || cycleSelect.value === '随套餐包含')) {
        cycleSelect.value = '月付';
        enhancedDropdowns.get('select-custom-cycle')?.refresh?.();
      }
    }
  });

  el('input-custom-paid')?.addEventListener('input', (e) => {
    if (isHydratingUiControls) return;
    const numVal = Number(String(e.target?.value || '').trim());
    const cycleSelect = el('select-custom-cycle');
    if (Number.isFinite(numVal) && numVal > 0 && cycleSelect && (cycleSelect.value === '免费/赠送' || cycleSelect.value === '随套餐包含')) {
      cycleSelect.value = '月付';
      enhancedDropdowns.get('select-custom-cycle')?.refresh?.();
    }
  });

  el('select-custom-acq')?.addEventListener('change', (e) => {
    if (isHydratingUiControls) return;
    const val = e.target.value;
    const zeroCheck = el('check-zero-extra');
    const paidInput = el('input-custom-paid');
    const cycleSelect = el('select-custom-cycle');
    const freeBundlePresets = ['student_offer', 'pixel_bundle', 'chromebook_bundle', 'samsung_galaxy', 'jio_offer', 'official_promo'];
    if (freeBundlePresets.includes(val)) {
      if (zeroCheck) zeroCheck.checked = true;
      if (paidInput) {
        paidInput.value = '0';
        paidInput.disabled = true;
      }
      if (cycleSelect) {
        cycleSelect.value = '免费/赠送';
        enhancedDropdowns.get('select-custom-cycle')?.refresh?.();
      }
    } else if (val === 'normal_paid') {
      if (zeroCheck) zeroCheck.checked = false;
      if (paidInput) {
        paidInput.disabled = false;
        if (!paidInput.value || paidInput.value === '0') paidInput.value = '19.99';
      }
      if (cycleSelect) {
        cycleSelect.value = '月付';
        enhancedDropdowns.get('select-custom-cycle')?.refresh?.();
      }
    }
  });

  el('btn-mode-preset')?.addEventListener('click', () => switchPlanPriceMode('preset'));
  el('btn-mode-custom')?.addEventListener('click', () => switchPlanPriceMode('custom'));
  el('btn-edit-plan-custom')?.addEventListener('click', () => togglePlanCustomForm());
  el('btn-custom-plan-cancel')?.addEventListener('click', () => togglePlanCustomForm(false));

  el('btn-custom-plan-save')?.addEventListener('click', () => {
    ++userActionSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const prevCustom = getStoredCustomPlanSnapshot(email);
    const acq = el('select-custom-acq')?.value || 'normal_paid';
    const acqName = el('input-custom-acq-name')?.value?.trim() || '';
    const isZero = Boolean(el('check-zero-extra')?.checked);
    const countryInputEl = el('input-custom-country');
    const countryVal = countryInputEl ? countryInputEl.value.trim() : (prevCustom.accountRegion || prevCustom.country || '');
    const regInputEl = el('input-custom-region');
    const reg = regInputEl ? regInputEl.value.trim() : (prevCustom.subscriptionCountry || prevCustom.subscriptionRegion || prevCustom.region || '');
    const rawPaid = el('input-custom-paid')?.value?.trim();
    const paid = isZero ? 0 : (rawPaid !== '' && !Number.isNaN(Number(rawPaid)) ? Number(rawPaid) : null);
    const cur = el('select-custom-currency')?.value || prevCustom.subscriptionCurrency || prevCustom.currency || 'USD';
    const cycleEl = el('select-custom-cycle');
    let cycle = cycleEl?.value || (isZero ? '随套餐赠送/免费' : '月付');
    if (!isZero && paid !== null && paid > 0 && (cycle === '免费/赠送' || cycle === '随套餐赠送/免费')) {
      cycle = '月付';
      if (cycleEl) {
        cycleEl.value = '月付';
        enhancedDropdowns.get('select-custom-cycle')?.refresh?.();
      }
    }
    const validEnd = el('input-valid-end')?.value?.trim() || '';
    const note = el('input-custom-note')?.value?.trim() || '';

    const customObj = {
      ...prevCustom,
      accountRegion: countryVal || undefined,
      country: countryVal || undefined,
      subscriptionCountry: reg || undefined,
      subscriptionRegion: reg || undefined,
      region: reg || undefined,
      acquisitionSource: acq,
      acquisitionSourceName: acqName || '',
      isZeroExtraCost: isZero,
      actualPricePaid: paid,
      customActualPrice: paid,
      priceMode: 'custom',
      subscriptionCurrency: cur,
      currency: cur,
      currencySource: 'custom',
      billingCycle: cycle,
      validEndDate: validEnd || null,
      customNote: note,
      priceSource: 'custom',
      updatedAt: new Date().toISOString()
    };
    if (!countryVal) {
      delete customObj.accountRegion;
      delete customObj.country;
    }
    if (!reg) {
      delete customObj.subscriptionCountry;
      delete customObj.subscriptionRegion;
      delete customObj.region;
    }

    applyCustomPlanObjectLocally(customObj, email);
    togglePlanCustomForm(false);
    void persistSettingsToHost({ email, customPlan: customObj });
  });

  el('btn-custom-plan-clear')?.addEventListener('click', () => {
    ++userActionSeq;
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const email = ps.email || 'default';
    const rawLive = ANTIGRAVITY_TOKEN_DATA.rawPlanStatus || null;
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    if (core && core.resolveEffectivePlanStatus) {
      ANTIGRAVITY_TOKEN_DATA.planStatus = core.resolveEffectivePlanStatus(rawLive, { priceMode: 'preset' }, { currentEmail: email });
    }
    togglePlanCustomForm(false);
    renderPlanDetail(ANTIGRAVITY_TOKEN_DATA.planStatus);
    renderActiveCostEstimateView();
    void persistSettingsToHost({ email, clearPlan: true });
  });

  let lastBadgePriceState = null;
  let activeBadgeRafId = null;
  let activeBadgeTimerId = null;
  let activeCnyTimerId = null;
  function renderPlanSummaryPriceBadge(targetSymbol, targetNum, targetCycle, targetCnyText, options = {}) {
    const priceValEl = el('plan-summary-price-val');
    const priceCnyEl = el('plan-summary-price-cny');
    const badgeEl = el('plan-summary-price-badge');
    if (!priceValEl) return;

    if (activeBadgeTimerId) {
      clearTimeout(activeBadgeTimerId);
      activeBadgeTimerId = null;
    }
    if (activeCnyTimerId) {
      clearTimeout(activeCnyTimerId);
      activeCnyTimerId = null;
    }
    if (activeBadgeRafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(activeBadgeRafId);
      activeBadgeRafId = null;
    }

    const formattedFinalNum = targetNum !== null && targetNum !== undefined
      ? (Number(targetNum) % 1 === 0 ? String(Number(targetNum)) : Number(targetNum).toFixed(2))
      : '';

    // 轻量模拟环境安全兼容
    if (typeof priceValEl.querySelector !== 'function') {
      priceValEl.textContent = `${targetSymbol}${formattedFinalNum}${targetCycle}`;
      if (priceCnyEl) priceCnyEl.textContent = targetCnyText;
      lastBadgePriceState = {
        symbol: targetSymbol,
        num: targetNum !== null ? Number(targetNum) : 0,
        cycle: targetCycle,
        cnyText: targetCnyText
      };
      return;
    }

    const hasRaf = typeof requestAnimationFrame === 'function';
    const forceDirect = options.forceDirect || !hasRaf || !lastBadgePriceState;

    if (forceDirect) {
      priceValEl.innerHTML = `<span class="badge-symbol-anim">${targetSymbol}</span><span class="badge-num-anim">${formattedFinalNum}</span><span class="badge-cycle-anim">${targetCycle}</span>`;
      if (priceCnyEl) priceCnyEl.textContent = targetCnyText;
      lastBadgePriceState = {
        symbol: targetSymbol,
        num: targetNum !== null ? Number(targetNum) : 0,
        cycle: targetCycle,
        cnyText: targetCnyText
      };
      return;
    }

    const startNum = (lastBadgePriceState && Number.isFinite(lastBadgePriceState.num))
      ? lastBadgePriceState.num
      : (Number(targetNum) || 0);
    const endNum = targetNum !== null ? Number(targetNum) : 0;
    const startSymbol = lastBadgePriceState?.symbol || targetSymbol;
    const endSymbol = targetSymbol;

    // 确保内部 DOM 结构完整
    let symbolEl = priceValEl.querySelector?.('.badge-symbol-anim');
    let numEl = priceValEl.querySelector?.('.badge-num-anim');
    let cycleEl = priceValEl.querySelector?.('.badge-cycle-anim');

    if (!symbolEl || !numEl || !cycleEl) {
      priceValEl.innerHTML = `<span class="badge-symbol-anim">${startSymbol}</span><span class="badge-num-anim">${formattedFinalNum}</span><span class="badge-cycle-anim">${targetCycle}</span>`;
      symbolEl = priceValEl.querySelector?.('.badge-symbol-anim');
      numEl = priceValEl.querySelector?.('.badge-num-anim');
      cycleEl = priceValEl.querySelector?.('.badge-cycle-anim');
    }

    if (cycleEl) cycleEl.textContent = targetCycle;

    // 1. 货币符号消散再切换动画 (Symbol Dissolve & Crossfade)
    if (startSymbol !== endSymbol && symbolEl && symbolEl.classList) {
      symbolEl.classList.remove('is-entering');
      symbolEl.classList.add('is-dissolving');

      activeBadgeTimerId = setTimeout(() => {
        symbolEl.textContent = endSymbol;
        symbolEl.classList.remove('is-dissolving');
        symbolEl.classList.add('is-entering');
        try { void symbolEl.offsetWidth; } catch {}
        setTimeout(() => {
          symbolEl.classList?.remove?.('is-entering');
        }, 180);
        activeBadgeTimerId = null;
      }, 160);
    } else if (symbolEl) {
      symbolEl.textContent = endSymbol;
    }

    // 2. CNY 折合平滑渐变
    if (priceCnyEl && priceCnyEl.textContent !== targetCnyText) {
      try {
        priceCnyEl.style.transition = 'opacity 0.18s ease';
        priceCnyEl.style.opacity = '0.2';
        activeCnyTimerId = setTimeout(() => {
          priceCnyEl.textContent = targetCnyText;
          priceCnyEl.style.opacity = '0.85';
          activeCnyTimerId = null;
        }, 140);
      } catch {
        priceCnyEl.textContent = targetCnyText;
      }
    }

    // 3. 数字滚动/递减递增动画 (Rolling Numeric Count Tween)
    if (targetNum !== null && targetNum !== undefined && startNum !== endNum && numEl) {
      if (badgeEl && badgeEl.classList) badgeEl.classList.add('is-animating');

      const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const duration = 500;
      const easeOut = t => 1 - Math.pow(1 - t, 4);

      const step = now => {
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOut(progress);
        const currentVal = startNum + (endNum - startNum) * eased;

        if (progress < 1) {
          if (endNum % 1 !== 0) {
            numEl.textContent = currentVal >= 100 ? String(Math.round(currentVal)) : currentVal.toFixed(2);
          } else {
            numEl.textContent = String(Math.round(currentVal));
          }
          activeBadgeRafId = requestAnimationFrame(step);
        } else {
          numEl.textContent = formattedFinalNum;
          if (badgeEl && badgeEl.classList) badgeEl.classList.remove('is-animating');
          activeBadgeRafId = null;
        }
      };

      activeBadgeRafId = requestAnimationFrame(step);
    } else if (numEl) {
      numEl.textContent = formattedFinalNum;
    }

    lastBadgePriceState = {
      symbol: targetSymbol,
      num: endNum,
      cycle: targetCycle,
      cnyText: targetCnyText
    };
  }

  function renderPlanDetail(ps) {
    if (!ps) return;
    const isCustomTier = Boolean(ps.sources?.tier === 'custom' || (ps.planTierOverride && ps.planTierOverride !== 'auto'));
    const sumTxt = el('plan-summary-text');
    if (sumTxt) {
      if (ps.ultraSubTierSpec) {
        const subModeTxt = (isCustomTier || ps.ultraSubTierSource === 'custom') ? '自定义' : '已自动识别';
        sumTxt.textContent = `${ps.tierName} · ${ps.ultraSubTierSpec.quotaMultiplierText} · ${subModeTxt}`;
      } else {
        const modeTxt = isCustomTier
          ? '自定义生效'
          : (ps.status === 'identified' ? '已自动识别' : ps.hasCustomSettings ? '自定义生效' : '未识别/默认');
        sumTxt.textContent = `${ps.tierName || 'Pro'} · ${modeTxt} · 刚刚更新`;
      }
    }
    // 实时联动顶部订阅费与汇率胶囊
    const curSymbol = ps.currencySymbol || '$';
    let targetSymbol = '$';
    let targetNum = 19.99;
    let targetCycle = '/月';
    let targetCny = '(≈ ¥134.3 CNY)';

    if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
      targetSymbol = curSymbol;
      targetNum = 0;
      targetCycle = '/月';
      targetCny = ps.tierKey === 'free' ? '(免费版)' : '(随套餐免费)';
    } else if (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined) {
      targetSymbol = curSymbol;
      const rawPaid = Number(ps.actualPricePaid);
      const isAnnual = String(ps.billingCycle || '').includes('年');
      const monthlyPaid = isAnnual ? Number((rawPaid / 12).toFixed(2)) : rawPaid;
      targetNum = monthlyPaid;
      targetCycle = '/月';
      targetCny = formatBaseCurrencyParen(monthlyPaid, ps.currency || 'USD', ps.region || ps.subscriptionRegion || null, 1);
    } else if (ps.officialPriceMonthly !== null && ps.officialPriceMonthly !== undefined) {
      targetSymbol = '$';
      targetNum = Number(ps.officialPriceMonthly);
      targetCycle = '/月';
      targetCny = formatBaseCurrencyParen(targetNum, 'USD', null, 1);
    } else if (ps.tierKey === 'ultra') {
      targetSymbol = '$99.99~199.99';
      targetNum = null;
      targetCycle = '/月';
      targetCny = '(待选子档)';
    } else {
      targetSymbol = '$';
      targetNum = 19.99;
      targetCycle = '/月';
      targetCny = formatBaseCurrencyParen(19.99, 'USD', null, 1);
    }

    renderPlanSummaryPriceBadge(targetSymbol, targetNum, targetCycle, targetCny, targetNum === null ? { forceDirect: true } : {});

    const detName = el('p-det-name');
    if (detName) detName.textContent = ps.tierName || 'Google AI Pro';
    const tagTier = el('p-det-tier-tag');
    if (tagTier) {
      if (isCustomTier) {
        tagTier.style.display = 'inline-block';
        tagTier.textContent = '自定义';
      } else if (ps.status === 'identified') {
        tagTier.style.display = 'inline-block';
        tagTier.textContent = '自动识别';
      } else {
        tagTier.style.display = 'none';
        tagTier.textContent = '';
      }
    }
    if (typeof refreshDirectTierDisplay === 'function') {
      refreshDirectTierDisplay(ps);
    }

    const isUltraPlan = ps.tierKey === 'ultra' || Boolean(ps.ultraSubTier);
    const summarySubWrap = el('summary-subtier-wrap');
    if (summarySubWrap) {
      summarySubWrap.style.display = isUltraPlan ? 'inline-flex' : 'none';
    }
    const dtSub = el('p-dt-subtier');
    const ddSub = el('p-dd-subtier');
    const tagSub = el('p-det-subtier-tag');
    const dtSubSpecs = el('p-dt-subtier-specs');
    const ddSubSpecs = el('p-det-subtier-specs');
    if (dtSub && ddSub) {
      dtSub.style.display = isUltraPlan ? 'block' : 'none';
      ddSub.style.display = isUltraPlan ? 'flex' : 'none';
    }
    if (tagSub) {
      if (isUltraPlan && ps.ultraSubTier) {
        tagSub.style.display = 'inline-block';
        tagSub.textContent = ps.ultraSubTierSource === 'live' ? '自动识别' : '自定义';
      } else {
        tagSub.style.display = 'none';
        tagSub.textContent = '';
      }
    }
    if (dtSubSpecs && ddSubSpecs) {
      if (isUltraPlan) {
        dtSubSpecs.style.display = 'block';
        ddSubSpecs.style.display = 'block';
        if (ps.ultraSubTierSpec) {
          const spec = ps.ultraSubTierSpec;
          ddSubSpecs.textContent = `配额倍率：${spec.quotaMultiplier}× Pro 基准额度（5h 滚动窗口 + 周上限）｜Google Flow：${spec.flowCreditsMonthly.toLocaleString('en-US')} 积分/月｜开发者抵扣金：$${spec.developerCreditsMonthlyUSD}/月｜云存储：${spec.storageTB} TB｜美区公开参考价：$${spec.officialPriceMonthly}/月`;
        } else {
          ddSubSpecs.textContent = '官方本地接口仅返回 Google AI Ultra，未下发 5x / 20x 子档；请在上方下拉菜单选择您的实际子档以展示对应配额倍率与权益数据。';
        }
      } else {
        dtSubSpecs.style.display = 'none';
        ddSubSpecs.style.display = 'none';
      }
    }
    if (typeof refreshDirectSubTierDisplay === 'function') {
      refreshDirectSubTierDisplay(ps.ultraSubTier || '');
    }

    const detAcc = el('p-det-account');
    if (detAcc) detAcc.textContent = ps.email || '未识别当前登录邮箱';

    // 守卫：若当前不在 Token 统计视图或详情处于收起状态，严禁异步返回时撑开详情面板
    const cardEl = el('plan-detail-card');
    if (cardEl && (activeTokenView !== 'tokens' || !planDetailExpanded)) {
      cardEl.style.display = 'none';
      cardEl.classList?.remove?.('is-expanded');
    }

    const detCountry = el('p-det-country');
    const tagCountry = el('p-det-country-tag');
    const directCountrySel = el('direct-country-select');
    const countryText = (ps.country && !String(ps.country).includes('未知')) ? String(ps.country).trim() : '未知';
    if (detCountry) detCountry.textContent = countryText;
    if (tagCountry) {
      tagCountry.style.display = ps.countrySource === 'custom' ? 'inline-block' : 'none';
      tagCountry.textContent = ps.countrySource === 'custom' ? '自定义' : '';
    }

    const detReg = el('p-det-region');
    const tagReg = el('p-det-region-tag');
    let regText = ps.subscriptionRegion || ps.region || '未知';
    if (regText.includes('未在当前会话中获取') || regText.trim() === '未知') regText = '未知';
    if (detReg) detReg.textContent = regText;
    if (tagReg) {
      tagReg.style.display = ps.regionSource === 'custom' ? 'inline-block' : 'none';
      tagReg.textContent = ps.regionSource === 'custom' ? '自定义' : '';
    }

    const detCur = el('p-det-currency');
    const tagCur = el('p-det-currency-tag');
    const directCurSel = el('direct-currency-select');
    const curText = ps.currency || 'USD';
    if (detCur) detCur.textContent = curText;
    if (tagCur) {
      tagCur.style.display = ps.currencySource === 'custom' ? 'inline-block' : 'none';
      tagCur.textContent = ps.currencySource === 'custom' ? '自定义' : '';
    }

    // 使用纯同步回填守卫同步更新详情面板内的下拉控件值
    runWithUiHydration(() => {
      if (directCountrySel) {
        if (countryText !== '未知' && directCountrySel.options) {
          const exists = Array.from(directCountrySel.options).some(o => o.value === countryText);
          if (!exists && typeof document.createElement === 'function') {
            const opt = document.createElement('option');
            opt.value = countryText;
            opt.textContent = '🌐 ' + countryText;
            directCountrySel.appendChild?.(opt);
          }
        }
        directCountrySel.value = countryText;
      }
      if (directCurSel) {
        directCurSel.value = curText === 'NTD' ? 'TWD' : curText;
      }
    });

    // 刷新国家、订阅地区与币种直接选择器标签与选中高亮
    if (typeof refreshDirectCountryDisplay === 'function') {
      refreshDirectCountryDisplay(countryText);
    }
    if (typeof refreshDirectRegionDisplay === 'function') {
      refreshDirectRegionDisplay(regText);
    }
    if (typeof refreshDirectCurrencyDisplay === 'function') {
      refreshDirectCurrencyDisplay(curText);
    }
    if (el('plan-custom-form')?.getAttribute?.('data-in-settings') === 'true' && typeof syncPlanCustomFormFields === 'function') {
      syncPlanCustomFormFields(ps, { skipFocused: true, enhance: false });
    }

    const detAcq = el('p-det-acq');
    const tagAcq = el('p-det-acq-tag');
    if (detAcq) detAcq.textContent = ps.acquisitionSourceName || '正常付费订阅';
    if (tagAcq) {
      const isPromo = ps.acquisitionSource && ps.acquisitionSource !== 'normal_paid';
      tagAcq.style.display = isPromo ? 'inline-block' : 'none';
      tagAcq.textContent = isPromo ? '活动权益' : '';
    }

    const detPrice = el('p-det-price');
    const tagPrice = el('p-det-price-tag');
    const isPresetMode = ps.priceMode === 'preset';
    const btnModePreset = el('btn-mode-preset');
    const btnModeCustom = el('btn-mode-custom');
    if (btnModePreset) setPillActive(btnModePreset, isPresetMode);
    if (btnModeCustom) setPillActive(btnModeCustom, !isPresetMode);

    if (detPrice) {
      if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
        detPrice.textContent = `${curSymbol}0 · ${ps.billingCycle || '随套餐包含'}`;
      } else if (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined) {
        const baseParen = formatBaseCurrencyParen(ps.actualPricePaid, ps.currency || 'USD', ps.region || ps.subscriptionRegion || null, 1);
        const cnyPart = baseParen ? ` ${baseParen}` : '';
        const paidFormatted = Number(ps.actualPricePaid) % 1 === 0 ? Number(ps.actualPricePaid) : Number(ps.actualPricePaid).toFixed(2);
        detPrice.textContent = `${curSymbol}${paidFormatted} · ${ps.billingCycle || '月付'}${cnyPart}`;
      } else if (ps.priceRangeNote && ps.priceRangeNote !== '未知') {
        detPrice.textContent = ps.priceRangeNote.replace(/[（\(][^）\)]*[）\)]/g, '').trim();
      } else if (ps.officialPriceMonthly !== null && ps.officialPriceMonthly !== undefined) {
        detPrice.textContent = `公开参考价 $${ps.officialPriceMonthly}/月`;
      } else {
        detPrice.textContent = '未知';
      }
    }
    if (tagPrice) {
      tagPrice.style.display = 'inline-block';
      if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
        tagPrice.textContent = '手动确认 · 免费';
      } else if (ps.priceMode === 'custom' || ps.priceSource === 'custom') {
        tagPrice.textContent = '用户实付';
      } else if (ps.priceSource === 'preset_region' || isPresetMode) {
        tagPrice.textContent = '官方定价';
      } else {
        tagPrice.textContent = '公开参考价';
      }
    }

    const dtVal = el('p-dt-validity');
    const ddVal = el('p-det-validity');
    if (dtVal && ddVal) {
      if (ps.validEndDate) {
        dtVal.style.display = 'block';
        ddVal.style.display = 'block';
        ddVal.textContent = `至 ${ps.validEndDate}${ps.isExpired ? ' · ⚠️ 权益已到期' : ' · 有效期内'}`;
        ddVal.style.color = ps.isExpired ? 'var(--ag-text-danger,#f87171)' : 'var(--ag-text-secondary)';
      } else {
        dtVal.style.display = 'none';
        ddVal.style.display = 'none';
      }
    }

    const dtNote = el('p-dt-note');
    const ddNote = el('p-det-note');
    if (dtNote && ddNote) {
      if (ps.customNote) {
        dtNote.style.display = 'block';
        ddNote.style.display = 'block';
        ddNote.textContent = String(ps.customNote);
      } else {
        dtNote.style.display = 'none';
        ddNote.style.display = 'none';
      }
    }

    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const qpd = ps.quotaPoolDisplay || (core?.resolvePlanQuotaPools ? core.resolvePlanQuotaPools(ps) : null);
    const pPrompt = el('p-det-prompt-credits');
    const pFlow = el('p-det-flow-credits');
    if (pPrompt) {
      const promptTxt = qpd?.promptPoolText || (ps.promptCredits ? `${ps.promptCredits.available ?? '—'} 可用 / ${ps.promptCredits.monthly ?? '—'} 月额度` : '—');
      pPrompt.textContent = promptTxt;
      const pLegacy = el('p-det-credits');
      if (pLegacy) pLegacy.textContent = promptTxt;
    }
    if (pFlow) {
      const flowTxt = qpd?.flowPoolText || (ps.ultraSubTierSpec
        ? `${ps.ultraSubTierSpec.flowCreditsMonthly.toLocaleString('en-US')} 套餐月积分 / 月`
        : (ps.flowCredits ? `${ps.flowCredits.available ?? '—'} 可用 / ${ps.flowCredits.monthly ?? '—'} 月额度` : '—'));
      pFlow.textContent = flowTxt;
    }
    const sumSubRo = el('summary-subtier-readonly');
    const detSubRo = el('p-det-subtier-readonly');
    const roText = isUltraPlan
      ? (ps.ultraSubTier === '20x' ? '🚀 Ultra 20x' : (ps.ultraSubTier === '5x' ? '⚡ Ultra 5x' : '🌐 子档: 未设'))
      : '';
    if (sumSubRo) {
      sumSubRo.style.display = isUltraPlan ? 'inline-flex' : 'none';
      sumSubRo.textContent = roText;
    }
    if (detSubRo) {
      detSubRo.textContent = isUltraPlan
        ? (ps.ultraSubTier === '20x' ? '🚀 Ultra 20x · 20× Pro 配额 ($199.99/月)' : (ps.ultraSubTier === '5x' ? '⚡ Ultra 5x · 5× Pro 配额 ($99.99/月)' : '🌐 未设置 / 自动识别'))
        : '—';
    }
    const detTime = el('p-det-time');
    if (detTime) {
      const timeStr = ps.updatedAt ? new Date(ps.updatedAt).toLocaleString() : '—';
      const verifyStr = ps.pricingTableVerifiedDate ? ` · 价表核对：${ps.pricingTableVerifiedDate}` : '';
      detTime.textContent = `${timeStr}${verifyStr}`;
    }
    if (typeof syncSettingsSubPreview === 'function') {
      syncSettingsSubPreview();
    }
  }

  function setPillActive(node, active) {
    if (!node) return;
    node.classList?.toggle?.('active', active);
    const cur = node.getAttribute('class') || 'switch-pill-btn';
    if (active) {
      if (!cur.includes('active')) node.setAttribute('class', (cur + ' active').trim());
    } else {
      node.setAttribute('class', cur.replace(/\bactive\b/g, '').trim());
    }
  }

  // 数据源切换（全部 / 桌面 / CLI）
  let activeTokenSource = 'all';
  function switchTokenSource(src) {
    activeTokenSource = src;
    try { localStorage?.setItem('ag_token_source_v1', src); } catch {}
    setPillActive(el('src-tab-all'), src === 'all');
    setPillActive(el('src-tab-desktop'), src === 'desktop');
    setPillActive(el('src-tab-cli'), src === 'cli');

    if (ANTIGRAVITY_TOKEN_DATA.rawPayload) {
      applyTokenHistoryPayload(ANTIGRAVITY_TOKEN_DATA.rawPayload);
    } else {
      const bySrc = ANTIGRAVITY_TOKEN_DATA.dailyMapBySource || {};
      const srcMap = bySrc[src] || bySrc.all || ANTIGRAVITY_TOKEN_DATA.dailyMap;
      ANTIGRAVITY_TOKEN_DATA.dailyMap = srcMap;
      renderActiveHeatView(true);
      renderActiveCostEstimateView();
    }
  }
  el('src-tab-all')?.addEventListener('click', () => switchTokenSource('all'));
  el('src-tab-desktop')?.addEventListener('click', () => switchTokenSource('desktop'));
  el('src-tab-cli')?.addEventListener('click', () => switchTokenSource('cli'));

  // 视图切换（Token 统计 / API 等值估算）
  let activeTokenView = 'tokens';

  // 费用面板紧凑摘要与展开详情切换
  let costDetailsExpanded = false;
  function toggleCostDetails(expand) {
    if (expand === undefined) costDetailsExpanded = !costDetailsExpanded;
    else costDetailsExpanded = Boolean(expand);

    const pane = el('cost-details-pane');
    const btn = el('btn-cost-details-toggle');
    const pTokens = el('panel-tokens');

    if (pane) {
      pane.style.display = costDetailsExpanded ? 'block' : 'none';
      if (costDetailsExpanded) pane.style.animation = 'agFadeIn .2s cubic-bezier(0.16,1,0.3,1)';
    }
    if (btn) btn.textContent = costDetailsExpanded ? '收起详情 ▲' : '展开详情 ▼';
    if (pTokens) {
      const isCompact = activeTokenView === 'cost' && !costDetailsExpanded;
      pTokens.classList?.toggle?.('cost-compact-view', isCompact);
      const curCls = pTokens.getAttribute?.('class') || '';
      if (isCompact) {
        if (!curCls.includes('cost-compact-view')) pTokens.setAttribute?.('class', (curCls + ' cost-compact-view').trim());
      } else {
        pTokens.setAttribute?.('class', curCls.replace(/\bcost-compact-view\b/g, '').trim());
      }
    }
    positionFloatingPanels();
  }
  el('cost-details-pane');
  el('cost-non-paid-badge');
  el('cost-scope-desc');
  el('tokens-main-view');
  el('btn-cost-details-toggle')?.addEventListener('click', () => toggleCostDetails());
  el('btn-cost-details-collapse')?.addEventListener('click', () => toggleCostDetails(false));
  el('btn-cost-fill-sub')?.addEventListener('click', () => {
    if (el('plan-custom-form')?.getAttribute?.('data-in-settings') === 'true' && typeof openSuiteSettings === 'function') {
      openSuiteSettings('subscription');
    } else {
      switchTokenView('tokens');
      setPlanDetailExpanded(true);
      togglePlanCustomForm(true);
    }
  });
  toggleCostDetails(false);

  function switchTokenView(v) {
    activeTokenView = v;
    // 离开 Token 统计视图时关闭订阅详情与表单
    if (v !== 'tokens') {
      setPlanDetailExpanded(false, { skipReposition: true });
    } else {
      setPlanDetailExpanded(false, { skipReposition: true });
    }
    el('plan-summary-price-badge')?.setAttribute?.('aria-expanded', 'false');
    setPillActive(el('tok-view-tokens'), v === 'tokens');
    setPillActive(el('tok-view-cost'), v === 'cost');
    const costCard = el('cost-estimate-card');
    const tokensMain = el('tokens-main-view');
    const statCards = el('token-stat-cards');
    const planBar = el('plan-summary-bar');
    const titleTokens = el('panel-tokens-title');
    const pTokens = el('panel-tokens');

    if (costCard) {
      costCard.style.display = v === 'cost' ? 'block' : 'none';
      if (v === 'cost') costCard.style.animation = 'agFadeIn .18s cubic-bezier(0.16,1,0.3,1)';
    }
    if (tokensMain) {
      tokensMain.style.display = v === 'tokens' ? 'block' : 'none';
      if (v === 'tokens') tokensMain.style.animation = 'agFadeIn .18s cubic-bezier(0.16,1,0.3,1)';
    }
    if (statCards) statCards.style.display = v === 'tokens' ? 'grid' : 'none';
    if (planBar) planBar.style.display = v === 'tokens' ? 'flex' : 'none';
    if (titleTokens) titleTokens.textContent = v === 'cost' ? 'API 价格折算' : '本机已记录用量';

    if (pTokens) {
      const isCompact = v === 'cost' && !costDetailsExpanded;
      pTokens.classList?.toggle?.('cost-compact-view', isCompact);
      const curCls = pTokens.getAttribute?.('class') || '';
      if (isCompact) {
        if (!curCls.includes('cost-compact-view')) pTokens.setAttribute?.('class', (curCls + ' cost-compact-view').trim());
      } else {
        pTokens.setAttribute?.('class', curCls.replace(/\bcost-compact-view\b/g, '').trim());
      }
    }
    positionFloatingPanels();
  }
  el('tok-view-tokens')?.addEventListener('click', () => switchTokenView('tokens'));
  el('tok-view-cost')?.addEventListener('click', () => switchTokenView('cost'));

  // =========================================================================
  // 一键启动 CLI 模式（当前项目目录绑定 + 中文/空格路径兼容 + 错误提示）
  // =========================================================================
  let cliLaunchBusy = false;
  let cliToastTimer = null;
  let lastCliLaunchResult = null;

  function showCliToast(message, isError = false) {
    const toast = el('cli-launch-toast');
    if (!toast) return;
    if (cliToastTimer) {
      clearTimeout(cliToastTimer);
      cliToastTimer = null;
    }
    toast.hidden = false;
    toast.setAttribute('data-tone', isError ? 'error' : 'info');
    toast.textContent = message;
    cliToastTimer = setTimeout(() => {
      toast.hidden = true;
      cliToastTimer = null;
    }, isError ? 5200 : 3200);
  }

  async function invokeHostBridge(liveRoute, payload, ipcMethod) {
    const fetchFn = typeof fetch === 'function'
      ? fetch
      : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
    if (typeof window !== 'undefined' && window.__AGContextMeterLive?.port && fetchFn) {
      try {
        const live = window.__AGContextMeterLive;
        const r = await fetchFn(`http://127.0.0.1:${live.port}${liveRoute}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
          body: JSON.stringify(payload ?? {})
        });
        if (r && r.ok) {
          const json = await r.json().catch(() => null);
          if (json !== null) return json;
        }
      } catch {}
    }
    if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.[ipcMethod] === 'function') {
      return await window.contextMeterAPI[ipcMethod](payload);
    }
    return null;
  }

  async function triggerLaunchCli(customOpts = {}) {
    if (cliLaunchBusy) {
      showCliToast('CLI 正在启动中，请稍候…', false);
      return { ok: false, error: 'CLI 正在启动中，请稍候' };
    }
    cliLaunchBusy = true;
    const btn = el('badge-cli');
    const label = el('cli-label');
    btn?.setAttribute('data-busy', 'true');
    if (label) label.textContent = '…';
    try {
      if (typeof document !== 'undefined' && document.activeElement?.blur) {
        document.activeElement.blur();
      }
    } catch {}

    const hostBounds = {
      x: typeof window !== 'undefined' ? (window.screenX || 0) : 0,
      y: typeof window !== 'undefined' ? (window.screenY || 0) : 0,
      width: typeof window !== 'undefined' ? (window.outerWidth || window.innerWidth || 1200) : 1200,
      height: typeof window !== 'undefined' ? (window.outerHeight || window.innerHeight || 800) : 800
    };

    const termOpts = typeof getSuiteTerminalSettings === 'function' ? getSuiteTerminalSettings() : {};
    const hasCustomModel = customOpts && Object.prototype.hasOwnProperty.call(customOpts, 'model');
    const reqOpts = {
      cascadeId: state.route || undefined,
      cwd: customOpts.cwd !== undefined ? customOpts.cwd : (state.scan?.workspacePath || undefined),
      hostBounds,
      ...termOpts,
      ...customOpts
    };
    if (hasCustomModel && customOpts.noModel === undefined) {
      const mStr = typeof customOpts.model === 'string' ? customOpts.model.trim() : '';
      reqOpts.noModel = !mStr;
    }
    try {
      let res = await invokeHostBridge('/launch-cli', reqOpts, 'launchCli');
      if (res === null && !window?.contextMeterAPI?.launchCli) {
        res = { ok: false, code: 'NO_BRIDGE', error: '未能连接到本地服务：请完全退出并重启 Antigravity 客户端（或运行 ag-context-meter live）后重试' };
      }

      lastCliLaunchResult = res;
      if (res && res.ok) {
        const om = el('overflow-menu');
        if (om) om.hidden = true;
        const hostNote = reqOpts.muxHost ? ` · 主机：${reqOpts.muxHost}` : '';
        showCliToast(`✔ 已启动 Antigravity CLI（目录：${res.cwd || '默认'}${hostNote}）`, false);
        return res;
      } else {
        const errMsg = res?.error || '未检测到可用的 Antigravity CLI (agy)，请检查安装路径';
        showCliToast(`✖ 启动 CLI 失败：${errMsg}`, true);
        return res || { ok: false, error: errMsg };
      }
    } catch (err) {
      const errMsg = err?.message || '启动 CLI 发生异常';
      lastCliLaunchResult = { ok: false, error: errMsg };
      showCliToast(`✖ 启动 CLI 失败：${errMsg}`, true);
      return lastCliLaunchResult;
    } finally {
      cliLaunchBusy = false;
      btn?.removeAttribute('data-busy');
      btn?.removeAttribute('data-pressed');
      if (label) label.textContent = 'CLI';
    }
  }

  const badgeCliEl = el('badge-cli');
  if (badgeCliEl) {
    const releasePress = () => {
      badgeCliEl.removeAttribute('data-pressed');
    };
    badgeCliEl.addEventListener('pointerdown', () => {
      badgeCliEl.setAttribute('data-pressed', 'true');
    });
    badgeCliEl.addEventListener('pointerup', releasePress);
    badgeCliEl.addEventListener('pointercancel', releasePress);
    badgeCliEl.addEventListener('mouseleave', releasePress);
    badgeCliEl.addEventListener('blur', releasePress);
    badgeCliEl.addEventListener('click', () => {
      releasePress();
      void triggerLaunchCli();
    });
  }
  el('overflow-cli-btn')?.addEventListener('click', () => { void triggerLaunchCli(); });

  el('badge').addEventListener('click', () => toggleContext(el('badge')));
  el('badge-speed')?.addEventListener('click', e => {
    e?.stopPropagation?.();
    toggleContext(el('badge'));
  });
  el('badge-tokens').addEventListener('click', toggleTokens);
  el('badge-overflow')?.addEventListener('click', toggleOverflowMenu);
  el('overflow-speed-btn')?.addEventListener('click', () => {
    activeContextAnchor = el('badge-overflow') || el('badge');
    showPanel('context');
  });
  el('overflow-tokens-btn')?.addEventListener('click', () => showPanel('tokens'));
  el('close').addEventListener('click', () => showPanel('none'));
  el('close-tokens')?.addEventListener('click', () => showPanel('none'));

  // 上下文圆环悬停与键盘聚焦气泡（面板打开时不通过悬停误切，必须通过显式左键点击切换）
  el('badge').addEventListener('mouseenter', () => {
    if (!isAnyPanelOpen()) {
      showContextTooltip();
    }
  });
  el('badge').addEventListener('mouseleave', () => {
    hideContextTooltip();
  });
  el('badge').addEventListener('focus', () => {
    if (!isAnyPanelOpen()) showContextTooltip();
  });
  el('badge').addEventListener('blur', () => {
    hideContextTooltip();
  });

  el('theme-toggle')?.addEventListener('click', cycleTheme);
  el('theme-toggle-tokens')?.addEventListener('click', cycleTheme);
  el('badge').addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });
  el('badge-tokens').addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });
  el('badge-speed')?.addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });

  // -------------------------------------------------------------
  // 模块 2: 客户端界面汉化 (AntigravityChinese)
  // -------------------------------------------------------------
  const btnToggleChinese = el('btn-toggle-chinese');
  const chineseDrawerBody = el('chinese-drawer-body');
  const chineseDrawerArrow = el('chinese-drawer-arrow');
  const chineseBadge = el('chinese-badge');
  const chineseStatusDesc = el('chinese-status-desc');
  const btnToggleChineseModule = el('btn-toggle-chinese-module');

  let isChineseExpanded = false;
  let currentChineseEnabled = false;

  btnToggleChinese?.addEventListener('click', () => {
    isChineseExpanded = !isChineseExpanded;
    if (chineseDrawerBody) chineseDrawerBody.style.display = isChineseExpanded ? 'block' : 'none';
    if (chineseDrawerArrow) chineseDrawerArrow.textContent = isChineseExpanded ? '▲ 收起' : '▼ 展开';
    btnToggleChinese?.setAttribute('aria-expanded', String(isChineseExpanded));
    if (isChineseExpanded) {
      void refreshModulesDisplay();
    }
  });

  // -------------------------------------------------------------
  // 模块 3: 免 TUN 网络直连 (AntigravityProxyNoTun)
  // -------------------------------------------------------------
  const btnToggleProxy = el('btn-toggle-proxy');
  const proxyDrawerBody = el('proxy-drawer-body');
  const proxyDrawerArrow = el('proxy-drawer-arrow');
  const proxyBadge = el('proxy-badge');
  const proxyStatusDesc = el('proxy-status-desc');
  const inputProxyUrl = el('input-proxy-url');
  const inputProxyBypass = el('input-proxy-bypass');
  const btnTestProxy = el('btn-test-proxy');
  const btnToggleProxyModule = el('btn-toggle-proxy-module');
  const proxyTestResult = el('proxy-test-result');

  let isProxyExpanded = false;
  let currentProxyEnabled = false;

  btnToggleProxy?.addEventListener('click', () => {
    isProxyExpanded = !isProxyExpanded;
    if (proxyDrawerBody) proxyDrawerBody.style.display = isProxyExpanded ? 'block' : 'none';
    if (proxyDrawerArrow) proxyDrawerArrow.textContent = isProxyExpanded ? '▲ 收起' : '▼ 展开';
    btnToggleProxy?.setAttribute('aria-expanded', String(isProxyExpanded));
  });

  async function invokeModuleApi(action, payload = {}) {
    const api = typeof window !== 'undefined' ? window.contextMeterAPI : null;
    if (action === 'status' && typeof api?.getModulesStatus === 'function') {
      return await api.getModulesStatus();
    }
    if (action === 'toggle' && typeof api?.toggleModule === 'function') {
      return await api.toggleModule(payload.name, payload.enable, payload.opts);
    }
    if (action === 'test-proxy' && typeof api?.testProxy === 'function') {
      return await api.testProxy(payload.proxyUrl);
    }
    if (typeof window !== 'undefined' && window.__AGContextMeterLive?.port) {
      const live = window.__AGContextMeterLive;
      const routeMap = {
        status: '/modules-status',
        toggle: '/toggle-module',
        'test-proxy': '/test-proxy'
      };
      const route = routeMap[action];
      if (route) {
        const r = await fetch(`http://127.0.0.1:${live.port}${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
          body: JSON.stringify(payload)
        });
        return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      }
    }
    return { ok: false, error: '未能连接到本地服务：请完全退出并重启 Antigravity 客户端（或运行 ag-context-meter live）后重试' };
  }

  async function refreshModulesDisplay() {
    try {
      const res = await invokeModuleApi('status');
      if (!res || !res.ok || !res.data) {
        const errMsg = (res && res.error) ? res.error : '模块状态返回异常';
        if (chineseBadge) {
          chineseBadge.textContent = '⚠️ 读取失败';
          chineseBadge.className = 'key-pill pill-danger';
        }
        if (chineseStatusDesc) {
          chineseStatusDesc.textContent = `检测汉化状态失败: ${errMsg}`;
        }
        if (proxyBadge) {
          proxyBadge.textContent = '⚠️ 读取失败';
          proxyBadge.className = 'key-pill pill-danger';
        }
        if (proxyStatusDesc) {
          proxyStatusDesc.textContent = `检测代理设置失败: ${errMsg}`;
        }
        return;
      }
      const cfg = res.data;

      currentChineseEnabled = Boolean(cfg.modules?.chinese?.enabled);
      // 判定宿主界面是否已翻译：定向检查系统导航、活动栏、菜单及操作按钮等固有系统壳层（排除用户消息内容区域）
      const isDomTranslated = (() => {
        if (typeof window.__AGY_I18N_DATA__ !== 'undefined' || typeof window.__AGY_TRANSLATE_EL__ !== 'undefined') {
          return true;
        }
        try {
          const systemContainers = document.querySelectorAll(
            "div[role='navigation'], nav, header, [role='banner'], aside, [data-testid*='sidebar'], [data-testid*='navigation'], [class*='@container/titlebar'], .monaco-workbench, .activitybar"
          );
          const systemKeywords = ['新建对话', '新建会话', '新建', '设置', '账户', '项目', '关于', '帮助', '工作区', '管理', '自定义扩展', '资源管理器', '活动栏'];
          for (let i = 0; i < systemContainers.length; i++) {
            const container = systemContainers[i];
            if (container.closest && container.closest('.chat-session, .conversation-view, .monaco-list-row, .markdown, [data-testid*="chat"], [data-testid*="message"]')) {
              continue; // 严格排除用户聊天内容区
            }
            const labeledNodes = container.querySelectorAll ? container.querySelectorAll('button, a, [role="button"], [aria-label], [title], span') : [];
            for (let j = 0; j < Math.min(labeledNodes.length, 40); j++) {
              const node = labeledNodes[j];
              const label = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || '';
              if (label && systemKeywords.some(kw => label.includes(kw))) return true;
              const text = (node.textContent || '').trim();
              if (text && systemKeywords.some(kw => text.includes(kw))) return true;
            }
            const txt = container.innerText || '';
            if (systemKeywords.some(kw => txt.includes(kw))) return true;
          }
          const nav = document.querySelector("div[role='navigation'], nav");
          if (nav && nav.innerText && systemKeywords.some(kw => nav.innerText.includes(kw))) {
            return true;
          }
        } catch {}
        return false;
      })();
      const disk = res.disk || {};

      if (chineseBadge) {
        if (!currentChineseEnabled) {
          if (isDomTranslated) {
            chineseBadge.textContent = '⏳ 需重启恢复英文';
            chineseBadge.className = 'key-pill pill-warn';
          } else {
            chineseBadge.textContent = disk.chinese ? '⚪ 已关闭 (就绪)' : '⚪ 未安装';
            chineseBadge.className = 'key-pill pill-muted';
          }
        } else if (isDomTranslated) {
          chineseBadge.textContent = '🟢 已翻译生效';
          chineseBadge.className = 'key-pill pill-ok';
        } else if (!disk.chinese) {
          chineseBadge.textContent = '⚠️ 待本地同步';
          chineseBadge.className = 'key-pill pill-danger';
        } else {
          chineseBadge.textContent = '⏳ 待重启客户端生效';
          chineseBadge.className = 'key-pill pill-warn';
        }
      }
      if (chineseStatusDesc) {
        if (!currentChineseEnabled) {
          if (isDomTranslated) {
            chineseStatusDesc.textContent = '汉化已关闭；当前界面仍保留着刚才的中文文本，请完全退出并重新打开 Antigravity 客户端以恢复官方原生英文界面。';
          } else {
            chineseStatusDesc.textContent = disk.chinese
              ? '客户端汉化已关闭（本地资源已就绪，开启上方开关并重启客户端即可生效）。'
              : '客户端汉化当前未开启，保持官方原生英文界面。';
          }
        } else if (isDomTranslated) {
          chineseStatusDesc.textContent = '汉化运行中：客户端左侧边栏与核心菜单已自动转为中文。';
        } else if (!disk.chinese) {
          chineseStatusDesc.textContent = '配置已开启，但本地尚未准备好汉化资源；请完全退出并重启 Antigravity 客户端（或运行 ag-context-meter live）完成自动同步后再试。';
        } else {
          chineseStatusDesc.textContent = '汉化资源已就绪且开关已开启；请完全退出并重新打开 Antigravity 客户端即可生效。';
        }
      }
      if (btnToggleChineseModule) {
        btnToggleChineseModule.textContent = currentChineseEnabled ? '关闭客户端汉化' : '开启客户端汉化';
      }

      currentProxyEnabled = Boolean(cfg.modules?.proxy?.enabled);
      if (proxyBadge) {
        if (currentProxyEnabled) {
          proxyBadge.textContent = '🟢 已启用';
          proxyBadge.className = 'key-pill pill-ok';
        } else {
          proxyBadge.textContent = '⚪ 未启用';
          proxyBadge.className = 'key-pill pill-muted';
        }
      }
      if (inputProxyUrl && cfg.modules?.proxy?.proxyUrl) {
        inputProxyUrl.value = cfg.modules.proxy.proxyUrl;
      }
      if (inputProxyBypass && cfg.modules?.proxy?.bypassList) {
        inputProxyBypass.value = cfg.modules.proxy.bypassList;
      }
      if (proxyStatusDesc) {
        if (currentProxyEnabled) {
          proxyStatusDesc.textContent = `已立即生效（当前地址: ${cfg.modules.proxy.proxyUrl || '未填写'}）。仅用于「>_ CLI」终端启动、检查套件更新与远程隧道；因当前采用零改包运行，Antigravity 客户端本体的对话联网仍跟随系统代理。`;
        } else {
          proxyStatusDesc.textContent = '未启用自定义代理。「>_ CLI」终端、检查更新与远程隧道将跟随系统网络设置；Antigravity 客户端本体的对话联网始终跟随系统代理。';
        }
      }
      if (btnToggleProxyModule) {
        btnToggleProxyModule.textContent = currentProxyEnabled ? '停用代理' : '启用代理';
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      if (chineseBadge) {
        chineseBadge.textContent = '⚠️ 读取异常';
        chineseBadge.className = 'key-pill pill-danger';
      }
      if (chineseStatusDesc) {
        chineseStatusDesc.textContent = `检测汉化状态异常: ${errMsg}`;
      }
      if (proxyBadge) {
        proxyBadge.textContent = '⚠️ 读取异常';
        proxyBadge.className = 'key-pill pill-danger';
      }
      if (proxyStatusDesc) {
        proxyStatusDesc.textContent = `检测代理设置异常: ${errMsg}`;
      }
    }
  }

  btnToggleChineseModule?.addEventListener('click', async () => {
    try {
      btnToggleChineseModule.disabled = true;
      btnToggleChineseModule.textContent = '正在处理…';
      const res = await invokeModuleApi('toggle', { name: 'chinese', enable: !currentChineseEnabled });
      if (!res || !res.ok) {
        alert(res?.error || '切换汉化模块失败');
      }
      await refreshModulesDisplay();
    } catch (e) {
      alert('切换汉化模块异常: ' + e.message);
    } finally {
      if (btnToggleChineseModule) {
        btnToggleChineseModule.disabled = false;
        btnToggleChineseModule.textContent = currentChineseEnabled ? '关闭客户端汉化' : '开启客户端汉化';
      }
    }
  });

  btnToggleProxyModule?.addEventListener('click', async () => {
    try {
      btnToggleProxyModule.disabled = true;
      btnToggleProxyModule.textContent = '正在处理…';
      const res = await invokeModuleApi('toggle', {
        name: 'proxy',
        enable: !currentProxyEnabled,
        opts: {
          proxyUrl: inputProxyUrl?.value?.trim(),
          bypassList: inputProxyBypass?.value?.trim()
        }
      });
      if (!res || !res.ok) {
        alert(res?.error || '切换代理模块失败');
      }
      await refreshModulesDisplay();
    } catch (e) {
      alert('切换代理模块异常: ' + e.message);
    } finally {
      if (btnToggleProxyModule) {
        btnToggleProxyModule.disabled = false;
        btnToggleProxyModule.textContent = currentProxyEnabled ? '停用代理' : '启用代理';
      }
    }
  });

  btnTestProxy?.addEventListener('click', async () => {
    try {
      btnTestProxy.disabled = true;
      btnTestProxy.textContent = '正在测试…';
      if (proxyTestResult) {
        proxyTestResult.style.display = 'block';
        proxyTestResult.textContent = '正在发起本地与网络连通性测试…';
      }
      const res = await invokeModuleApi('test-proxy', { proxyUrl: inputProxyUrl?.value?.trim() });
      if (proxyTestResult) {
        if (!res || !res.ok) {
          proxyTestResult.textContent = '❌ 测试失败: ' + (res?.error || '未知异常');
        } else {
          const d = res.data || {};
          proxyTestResult.textContent = '';
          const lines = [
            `配置格式: ${d.configValid ? '✅ 合法' : '❌ 无效'}`,
            `本地端口: ${d.proxyReachable ? '✅ 可连接' : '❌ 无法连接'}`,
            `公网连通: ${d.internetReachable ? '✅ 可访问' : '⚠️ 无法访问公网 (可能无境外连通)'}`,
            '作用范围: 仅用于 CLI 终端、检查更新与远程隧道（本体对话跟随系统代理）'
          ];
          lines.forEach((line) => {
            const row = document.createElement('div');
            row.textContent = line;
            proxyTestResult.appendChild(row);
          });
          if (d.error) {
            const errRow = document.createElement('div');
            errRow.style.color = 'var(--ag-text-danger,#f87171)';
            errRow.textContent = `⚠️ ${d.error}`;
            proxyTestResult.appendChild(errRow);
          }
        }
      }
    } catch (e) {
      if (proxyTestResult) proxyTestResult.textContent = '❌ 测试异常: ' + e.message;
    } finally {
      if (btnTestProxy) {
        btnTestProxy.disabled = false;
        btnTestProxy.textContent = '🔍 测试代理连接';
      }
    }
  });

  // 静默初始化检测各模块状态
  setTimeout(() => {
    void refreshModulesDisplay();
  }, 500);
  setTimeout(() => {
    if (currentChineseEnabled) {
      void refreshModulesDisplay();
    }
  }, 2000);

  // 二级抽屉 1（面板 B 内）: 指标与背景颜色自定义抽屉折叠展开
  const btnColors = el('btn-toggle-colors');
  const colorDrawerBody = el('color-drawer-body');
  const colorDrawerArrow = el('color-drawer-arrow');
  function toggleColorsDrawer(forceOpen) {
    if (!colorDrawerBody) return;
    const isHidden = colorDrawerBody.style.display === 'none' || !colorDrawerBody.style.display;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
    colorDrawerBody.style.display = nextOpen ? 'block' : 'none';
    if (colorDrawerArrow) colorDrawerArrow.textContent = nextOpen ? '▲ 收起设置' : '▼ 展开设置';
    btnColors?.setAttribute('aria-expanded', String(nextOpen));
    if (!nextOpen) {
      closeColorPicker();
    }
  }
  btnColors?.addEventListener('click', () => toggleColorsDrawer());

  // 二级抽屉 2（面板 B 内）: 底层技术抽屉折叠展开
  const btnDetails = el('btn-toggle-details');
  const drawerBody = el('drawer-body');
  const drawerArrow = el('drawer-arrow');
  btnDetails?.addEventListener('click', () => {
    if (!drawerBody) return;
    const isHidden = drawerBody.style.display === 'none' || !drawerBody.style.display;
    drawerBody.style.display = isHidden ? 'block' : 'none';
    if (drawerArrow) drawerArrow.textContent = isHidden ? '▲ 点击收起明细' : '▼ 点击展开明细';
    btnDetails.setAttribute('aria-expanded', String(isHidden));
  });

  // 二级抽屉 3（面板 A 内就近设置）: 热力图色阶与面板外观自定义抽屉折叠展开
  const btnTokenColors = el('btn-toggle-token-colors');
  const tokenColorDrawerBody = el('token-color-drawer-body');
  const tokenColorDrawerArrow = el('token-color-drawer-arrow');
  function toggleTokenColorsDrawer(forceOpen) {
    if (!tokenColorDrawerBody) return;
    const curHidden = tokenColorDrawerBody.style.display === 'none' || !tokenColorDrawerBody.style.display;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : curHidden;
    tokenColorDrawerBody.style.display = nextOpen ? 'block' : 'none';
    tokenColorDrawerBody.classList?.toggle?.('is-expanded', nextOpen);
    if (tokenColorDrawerArrow) tokenColorDrawerArrow.textContent = nextOpen ? '▲ 收起设置' : '▼ 展开设置';
    btnTokenColors?.setAttribute('aria-expanded', String(nextOpen));
    if (!nextOpen) {
      closeColorPicker(false);
    }
  }
  btnTokenColors?.addEventListener('click', () => toggleTokenColorsDrawer());
  el('heat-legend-scale')?.addEventListener('click', () => {
    if (typeof isRealShadowDomTree === 'function' && isRealShadowDomTree() && typeof openSuiteSettings === 'function') {
      openSuiteSettings('appearance');
    } else {
      toggleTokenColorsDrawer(true);
    }
  });

  // 热力图视图切换（每天 / 每周 / 累计总量）

  // 费用估算范围（默认本期：自然月）与估值模式（默认参考模型折算，首屏展示真实用量价值）
  let activeCostScope = 'period'; // 'period' | 'all'
  let costModelMode = 'ref'; // 'ref' | 'hybrid' | 'identified'
  let activeRefMode = 'all'; // 兼容旧接口 'all' | 'hybrid'

  function switchCostScope(scope) {
    activeCostScope = scope;
    setPillActive(el('cost-btn-scope-period'), scope === 'period');
    setPillActive(el('cost-btn-scope-all'), scope === 'all');
    renderActiveCostEstimateView();
  }
  el('cost-btn-scope-period')?.addEventListener('click', () => switchCostScope('period'));
  el('cost-btn-scope-all')?.addEventListener('click', () => switchCostScope('all'));

  function switchCostModelMode(mode) {
    costModelMode = mode;
    setPillActive(el('cost-btn-mode-ref'), mode === 'ref');
    setPillActive(el('cost-btn-mode-hybrid'), mode === 'hybrid');
    setPillActive(el('cost-btn-mode-identified'), mode === 'identified');
    renderActiveCostEstimateView();
  }
  el('cost-btn-mode-ref')?.addEventListener('click', () => switchCostModelMode('ref'));
  el('cost-btn-mode-hybrid')?.addEventListener('click', () => switchCostModelMode('hybrid'));
  el('cost-btn-mode-identified')?.addEventListener('click', () => switchCostModelMode('identified'));

  function toggleRefCostDrawer(forceOpen) {
    const body = el('ref-cost-drawer-body');
    const btn = el('btn-toggle-ref-cost-drawer');
    if (!body) return;
    const curHidden = body.style.display === 'none' || !body.style.display;
    const next = typeof forceOpen === 'boolean' ? forceOpen : curHidden;
    body.style.display = next ? 'block' : 'none';
    if (btn) btn.textContent = next ? '收起详情 ▲' : '展开详情 ▼';
  }
  el('btn-toggle-ref-cost-drawer')?.addEventListener('click', () => toggleRefCostDrawer());

  function switchRefMode(mode) {
    activeRefMode = mode;
    costModelMode = mode === 'hybrid' ? 'hybrid' : 'ref';
    setPillActive(el('btn-ref-mode-all'), mode === 'all');
    setPillActive(el('btn-ref-mode-hybrid'), mode === 'hybrid');
    renderActiveCostEstimateView();
  }
  el('btn-ref-mode-all')?.addEventListener('click', () => switchRefMode('all'));
  el('btn-ref-mode-hybrid')?.addEventListener('click', () => switchRefMode('hybrid'));

  function renderActiveCostEstimateView() {
    const isPeriod = activeCostScope === 'period';
    const titleEl = el('cost-card-title');
    const periodTag = el('cost-period-tag');
    const grandVal = el('cost-grand-val');
    const grandSub = el('cost-grand-sub');
    const covPill = el('cost-coverage-pill');
    const subSpendVal = el('cost-sub-spend-val');
    const subSpendLbl = el('cost-sub-spend-lbl');
    const subNote = el('cost-sub-compare-note');
    const usageSummary = el('cost-usage-summary');
    const diffSummary = el('cost-diff-summary');
    const breakdown = el('cost-breakdown-info');

    // 分类卡片 DOM
    const inVal = el('ref-cost-input-val');
    const inTok = el('ref-cost-input-tok');
    const caVal = el('ref-cost-cache-val');
    const caTok = el('ref-cost-cache-tok');
    const outVal = el('ref-cost-output-val');
    const outTok = el('ref-cost-output-tok');

    if (titleEl) titleEl.textContent = isPeriod ? '💰 本期 API 参考金额' : '💰 全量 API 参考金额';
    if (periodTag) {
      const pKey = ANTIGRAVITY_TOKEN_DATA.currentPeriod?.label || '本月自然月';
      periodTag.textContent = isPeriod ? pKey : '全历史累计';
    }

    // 1. 提取当前范围真实用量与折算数据
    const curIn = isPeriod
      ? Number(ANTIGRAVITY_TOKEN_DATA.summary?.currentMonthInput || 0)
      : Number(ANTIGRAVITY_TOKEN_DATA.summary?.totalInputTokens || 0);
    const curCa = isPeriod
      ? Number(ANTIGRAVITY_TOKEN_DATA.summary?.currentMonthCache || 0)
      : Number(ANTIGRAVITY_TOKEN_DATA.summary?.totalCacheTokens || 0);
    const curOut = isPeriod
      ? Number(ANTIGRAVITY_TOKEN_DATA.summary?.currentMonthOutput || 0)
      : Number(ANTIGRAVITY_TOKEN_DATA.summary?.totalOutputTokens || 0);
    const curTotal = isPeriod
      ? Number(ANTIGRAVITY_TOKEN_DATA.summary?.monthTokens || (curIn + curCa + curOut))
      : Number(ANTIGRAVITY_TOKEN_DATA.summary?.grandTotalTokens || (curIn + curCa + curOut));

    const refAll = ANTIGRAVITY_TOKEN_DATA.referenceCost?.all || {};
    const refMonth = ANTIGRAVITY_TOKEN_DATA.referenceCost?.currentMonth || {};
    const refHybridAll = ANTIGRAVITY_TOKEN_DATA.referenceCost?.hybrid || {};
    const refHybridMonth = ANTIGRAVITY_TOKEN_DATA.referenceCost?.currentMonthHybrid || refHybridAll;

    const curRef = isPeriod ? refMonth : refAll;
    const curHybrid = isPeriod ? refHybridMonth : refHybridAll;

    const ceSourceMap = ANTIGRAVITY_TOKEN_DATA.costEstimateBySource || {};
    const ceAll = ceSourceMap[activeTokenSource] || ceSourceMap.all || ANTIGRAVITY_TOKEN_DATA.costEstimate || {};
    const cePeriod = ANTIGRAVITY_TOKEN_DATA.costEstimateCurrentMonth || ceAll;
    const curIdentified = isPeriod ? cePeriod : ceAll;

    let apiCost = 0;
    let pillText = '100% 折算覆盖';
    let pillClass = 'key-pill pill-good';

    // 2. 估值模式计算
    let effectiveRef = curRef;
    if ((effectiveRef.totalCostUSD === undefined || effectiveRef.totalCostUSD === null) && curTotal > 0) {
      const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
      if (core && core.calculateReferenceModelCost) {
        effectiveRef = core.calculateReferenceModelCost({
          inputTokens: curIn,
          outputTokens: curOut,
          cacheTokens: curCa,
          totalTokens: curTotal
        }, 'gemini-3.8-flash', { pricingDate: '2026-11-09', mode: 'all' });
      }
    }

    const rateIn = Number(effectiveRef.matchedTier?.inputPerMillion ?? 0.75);
    const rateCa = Number(effectiveRef.matchedTier?.cacheReadPerMillion ?? 0.075);
    const rateOut = Number(effectiveRef.matchedTier?.outputPerMillion ?? 3.75);

    // 更新小摘要来源与时间描述行及非实付常驻标识
    const scopeDescEl = el('cost-scope-desc');
    if (scopeDescEl) {
      const srcName = activeTokenSource === 'desktop' ? '桌面端' : activeTokenSource === 'cli' ? 'CLI' : '全部来源';
      const pLabel = isPeriod ? (ANTIGRAVITY_TOKEN_DATA.currentPeriod?.label || '本月自然月') : '全历史累计';
      scopeDescEl.textContent = `${srcName} · ${pLabel}`;
    }
    const nonPaidBadge = el('cost-non-paid-badge');
    if (nonPaidBadge) nonPaidBadge.textContent = 'API 折算 · 非实付';

    if (costModelMode === 'ref') {
      apiCost = Number(effectiveRef.totalCostUSD || 0);
      if (grandVal) {
        if (apiCost > 0) {
          grandVal.textContent = formatUsdEstimate(apiCost, '约 ');
          grandVal.title = `参考费率折算值：${formatUsdEstimate(apiCost)}`;
        } else if (curTotal > 0 && curIn === 0 && curCa === 0 && curOut === 0) {
          grandVal.textContent = '数据未就绪';
          grandVal.title = '缺少有效分类统计数据';
        } else {
          grandVal.textContent = '$0.00';
          grandVal.title = '当前范围内暂无记录';
        }
      }
      if (grandSub) {
        grandSub.textContent = `统一按 ${effectiveRef.modelDisplayName || 'Gemini 3.8 Flash'} 估算 (输入 ${formatUsdEstimate(rateIn)} / 缓存 ${formatUsdEstimate(rateCa)} / 输出 ${formatUsdEstimate(rateOut)} 每百万 Token)`;
      }
      pillText = '参考模型估算';
      pillClass = 'key-pill pill-muted';

      if (inVal) inVal.textContent = `$${Number(effectiveRef.inputCostUSD || (curIn * rateIn / 1e6)).toFixed(2)}`;
      if (inTok) inTok.textContent = `${fmtYi(curIn)} tok`;
      if (caVal) caVal.textContent = `$${Number(effectiveRef.cacheCostUSD || (curCa * rateCa / 1e6)).toFixed(2)}`;
      if (caTok) caTok.textContent = `${fmtYi(curCa)} tok (优惠)`;
      if (outVal) outVal.textContent = `$${Number(effectiveRef.outputCostUSD || (curOut * rateOut / 1e6)).toFixed(2)}`;
      if (outTok) outTok.textContent = `${fmtYi(curOut)} tok`;
    } else if (costModelMode === 'hybrid') {
      const h = curHybrid.hybrid || {};
      apiCost = Number(h.combinedTotalUSD || effectiveRef.totalCostUSD || 0);
      if (grandVal) {
        grandVal.textContent = formatUsdEstimate(apiCost, '约 ');
      }
      if (grandVal || grandSub) {
        const breakdown = `混合模式：已识别 ${formatUsdEstimate(h.knownCostUSD || 0)} + 未知折算 ${formatUsdEstimate(h.unpricedResidualCostUSD || 0)}`;
        if (grandVal) grandVal.title = breakdown;
        if (grandSub) grandSub.textContent = breakdown;
      }
      pillText = '混合模式折算';
      pillClass = 'key-pill pill-muted';

      const rb = h.residualTokensBreakdown || {};
      if (inVal) inVal.textContent = `$${Number(rb.inputCostUSD || (Number(rb.input || 0) * rateIn / 1e6)).toFixed(2)}`;
      if (inTok) inTok.textContent = `剩余 ${fmtYi(rb.input || 0)} tok`;
      if (caVal) caVal.textContent = `$${Number(rb.cacheCostUSD || (Number(rb.cache || 0) * rateCa / 1e6)).toFixed(2)}`;
      if (caTok) caTok.textContent = `剩余 ${fmtYi(rb.cache || 0)} tok`;
      if (outVal) outVal.textContent = `$${Number(rb.outputCostUSD || (Number(rb.output || 0) * rateOut / 1e6)).toFixed(2)}`;
      if (outTok) outTok.textContent = `剩余 ${fmtYi(rb.output || 0)} tok`;
    } else {
      // 仅已识别真实模型
      const pricedCount = Number(curIdentified.pricedRequestsCount || 0);
      const unpricedCount = Number(curIdentified.unpricedRequestsCount || 0);
      const totalCount = pricedCount + unpricedCount;
      apiCost = Number(curIdentified.pricedCostUSD || 0);

      if (grandVal) {
        if (totalCount === 0) {
          grandVal.textContent = '暂无记录';
        } else if (pricedCount === 0) {
          grandVal.textContent = '暂无法估值';
          grandVal.title = '当前范围内已扫描请求均缺少模型信息或费率未收录，未记为 $0';
        } else {
          grandVal.textContent = formatUsdEstimate(apiCost);
          grandVal.title = `已识别模型价值：${grandVal.textContent}`;
        }
      }
      if (grandSub) {
        grandSub.textContent = pricedCount > 0
          ? `仅计入 ${pricedCount} 条已知真实模型调用`
          : '当前范围内请求缺少模型型号（未按 $0 计入）';
      }
      if (pricedCount === 0) {
        pillText = '0% 计价覆盖';
        pillClass = 'key-pill pill-warn';
      } else {
        const pct = curIdentified.coveragePercent != null ? curIdentified.coveragePercent : 0;
        pillText = `${pct}% 计价覆盖`;
        pillClass = `key-pill ${pct >= 100 ? 'pill-good' : 'pill-warn'}`;
      }

      if (inVal) inVal.textContent = `$${((curIdentified.byCategory?.inputTokens || 0) * rateIn / 1e6).toFixed(2)}`;
      if (inTok) inTok.textContent = `${fmtYi(curIdentified.byCategory?.inputTokens || 0)} tok`;
      if (caVal) caVal.textContent = `$${((curIdentified.byCategory?.cacheTokens || 0) * rateCa / 1e6).toFixed(2)}`;
      if (caTok) caTok.textContent = `${fmtYi(curIdentified.byCategory?.cacheTokens || 0)} tok`;
      if (outVal) outVal.textContent = `$${((curIdentified.byCategory?.outputTokens || 0) * rateOut / 1e6).toFixed(2)}`;
      if (outTok) outTok.textContent = `${fmtYi(curIdentified.byCategory?.outputTokens || 0)} tok`;
    }

    if (covPill) {
      covPill.textContent = pillText;
      covPill.className = pillClass;
      covPill.setAttribute?.('class', pillClass);
    }

    // 3. 用户实际支出渲染（首屏并列右栏）
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const curSymbol = ps.currencySymbol || '$';
    if (subSpendLbl) subSpendLbl.textContent = '本人同期实际支出';

    if (subSpendVal && subNote) {
      if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
        subSpendVal.textContent = `${curSymbol}0`;
        subNote.textContent = `${ps.acquisitionSourceName || '免费活动'} · 用户确认 · 免费权益使用中${isPeriod ? '' : ' · 全量累计不直接对比单月支出'}`;
      } else if (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined) {
        subSpendVal.textContent = `${curSymbol}${Number(ps.actualPricePaid).toFixed(2)}`;
        subNote.textContent = `${ps.acquisitionSourceName || '订阅支出'} · 实付 (${ps.billingCycle || '月付'})${ps.isExpired ? ' · ⚠️ 权益已到期' : ''}${isPeriod ? '' : ' · 全量累计不直接对比单月支出'}`;
      } else if (ps.officialPriceMonthly !== null && ps.officialPriceMonthly !== undefined) {
        subSpendVal.textContent = '实付未知';
        subNote.textContent = `公开参考价 $${ps.officialPriceMonthly}/月（实付未确认）${isPeriod ? '' : ' · 全量累计不直接对比单月支出'}`;
      } else {
        subSpendVal.textContent = '未知';
        subNote.textContent = '未获取到套餐与实付数据';
      }
    }

    const subLine = el('cost-sub-line');
    if (subLine) {
      if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
        subLine.textContent = `订阅额外实付：${curSymbol}0 (${ps.acquisitionSourceName || '免费活动'} · 用户确认)`;
      } else if (ps.actualPricePaid !== null && ps.actualPricePaid !== undefined) {
        const baseParen = formatBaseCurrencyParen(ps.actualPricePaid, ps.currency || 'USD', ps.region || ps.subscriptionRegion || null, 1);
        const cnyPart = baseParen ? ` ${baseParen}` : '';
        subLine.textContent = `订阅实付：${curSymbol}${Number(ps.actualPricePaid).toFixed(2)}${cnyPart} (${ps.billingCycle || '月付'}${ps.isExpired ? ' · ⚠️ 权益已到期' : ''})`;
      } else {
        subLine.textContent = '订阅实付：未填写';
      }
    }

    // 4. 用量与参考差额指标条（注明累计处理 Token，含缓存读取）
    if (usageSummary) {
      usageSummary.textContent = `累计处理 Token: ${fmtYi(curTotal)} (含 ${fmtYi(curCa)} 缓存读取)`;
    }
    if (diffSummary) {
      if (!isPeriod) {
        diffSummary.textContent = '全量累计不直接与单月费用做差额比较 · 避免跨月虚高';
      } else if (ps.actualPricePaid === 0 || ps.isZeroExtraCost) {
        diffSummary.textContent = `与此 API 方案参考差额 约 +$${apiCost.toFixed(2)} (免费权益使用中 · 不计算无限倍数)`;
      } else if (ps.actualPricePaid !== null && ps.currency === 'USD') {
        const diff = apiCost - Number(ps.actualPricePaid);
        diffSummary.textContent = `与此 API 方案参考差额 ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)} (API 折算 - 实际支出 · 仅供参考比较)`;
      } else {
        diffSummary.textContent = '跨币种或实付未知 · 并列展示不计算差额';
      }
    }

    // 5. 详细未计价原因说明
    if (breakdown) {
      const modelKeys = Object.keys(curIdentified.byModel || {});
      const modelDetails = modelKeys.map(k => `${k}: $${curIdentified.byModel[k].costUSD} (${fmt(curIdentified.byModel[k].tokens)} tok)`).join('； ');
      const unpricedReasons = curIdentified.unpricedReasons || {};
      const reasonParts = [];
      if (unpricedReasons.missingModel) reasonParts.push(`${unpricedReasons.missingModel} 条日志缺少模型型号`);
      if (unpricedReasons.unsupportedModel) reasonParts.push(`${unpricedReasons.unsupportedModel} 条模型未收录公开费率`);
      if (unpricedReasons.missingUsage) reasonParts.push(`${unpricedReasons.missingUsage} 条缺少用量数据`);
      const unpricedTokensStr = curIdentified.unpricedTokens > 0 ? `，涉及约 ${fmtYi(curIdentified.unpricedTokens)} 未估值 Token` : '';
      const unpricedNote = reasonParts.length ? `；未识别部分：${reasonParts.join('，')}${unpricedTokensStr}（已按所选参考模型价表折算）` : '';
      breakdown.textContent = `已识别真实模型明细：${modelDetails || '暂无已匹配真实模型'}${unpricedNote}。`;
    }

    // 6. 兼容性辅助隐藏层同步
    const refGrand = el('ref-cost-grand-val');
    if (refGrand) refGrand.textContent = `约 $${Number(curRef.totalCostUSD || 0).toFixed(2)}`;
  }

  const heatPop = el('heat-pop');
  const heatPopDate = el('heat-pop-date');
  const heatPopVal = el('heat-pop-val');
  const heatPopDet = el('heat-pop-det');

  function hidePopover() {
    if (heatPop) heatPop.style.opacity = '0';
  }

  function updateHeatTabThumb() {
    const thumb = el('heat-tab-thumb');
    const tabsBar = el('heat-tabs-bar');
    const activeBtn = el(`h-tab-${activeHeatView}`);
    if (!thumb || !tabsBar || !activeBtn) return;

    const offsetLeft = activeBtn.offsetLeft || 0;
    const offsetWidth = activeBtn.offsetWidth || 0;
    thumb.style.transform = `translateX(${offsetLeft}px)`;
    thumb.style.width = `${offsetWidth}px`;

    const thumbColor = typeof getEffectiveSlotColor === 'function' ? getEffectiveSlotColor('tokenAccent') : (customColors.tokenAccent || '#a78bfa');
    thumb.style.setProperty('--ag-tab-thumb-bg', thumbColor);
  }

  function renderActiveHeatView(forceRebuild = false) {
    if (activeHeatView === 'weekly') {
      renderHeatmapWeekly();
    } else if (activeHeatView === 'monthly') {
      renderHeatmapMonthly();
    } else if (activeHeatView === 'yearly') {
      renderHeatmapYearly();
    } else if (activeHeatView === 'cum') {
      renderHeatmapCum();
    } else {
      renderHeatmapGrid(forceRebuild);
    }
    computeTimelineWindow();
    updateHeatTabThumb();
  }

  function switchHeatView(view, save = true) {
    if (!['daily', 'weekly', 'monthly', 'yearly', 'cum'].includes(view)) view = 'daily';
    activeHeatView = view;

    const views = ['daily', 'weekly', 'monthly', 'yearly', 'cum'];
    views.forEach(v => {
      const tabBtn = el(`h-tab-${v}`);
      const box = el(`h-${v}-box`);
      const isActive = (v === view);
      if (tabBtn) {
        if (tabBtn.classList) {
          if (isActive) tabBtn.classList.add('active');
          else tabBtn.classList.remove('active');
        } else {
          const cls = (tabBtn.className || '').split(/\s+/).filter(c => c && c !== 'active');
          if (isActive) cls.push('active');
          tabBtn.className = cls.join(' ');
        }
        tabBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tabBtn.setAttribute('tabindex', isActive ? '0' : '-1');
      }
      if (box) {
        if (isActive) {
          box.style.display = (v === 'weekly' || v === 'monthly' || v === 'yearly') ? 'flex' : 'block';
        } else {
          box.style.display = 'none';
        }
      }
    });

    hidePopover();
    renderActiveHeatView(true);
    updateHeatTabThumb();

    if (save && typeof window !== 'undefined' && typeof window.contextMeterAPI?.saveSettings === 'function') {
      window.contextMeterAPI.saveSettings({ savedHeatView: view });
    }
  }

  ['daily', 'weekly', 'monthly', 'yearly', 'cum'].forEach(v => {
    el(`h-tab-${v}`)?.addEventListener('click', () => switchHeatView(v));
  });

  const tabsBarEl = el('heat-tabs-bar');
  tabsBarEl?.addEventListener('keydown', e => {
    const views = ['daily', 'weekly', 'monthly', 'yearly', 'cum'];
    const curIdx = views.indexOf(activeHeatView);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (curIdx + 1) % views.length;
      switchHeatView(views[nextIdx]);
      el(`h-tab-${views[nextIdx]}`)?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (curIdx - 1 + views.length) % views.length;
      switchHeatView(views[prevIdx]);
      el(`h-tab-${views[prevIdx]}`)?.focus();
    }
  });

  // 初始化默认热力图视图状态与药丸滑块
  switchHeatView('daily', false);

  el('h-page-prev')?.addEventListener('click', () => {
    if (activeHeatView === 'monthly') {
      heatMonthOffset -= 1;
    } else if (activeHeatView === 'yearly') {
      heatYearOffset -= 1;
    } else {
      heatPageOffset -= 1;
    }
    renderActiveHeatView(true);
  });
  el('h-page-next')?.addEventListener('click', () => {
    if (activeHeatView === 'monthly') {
      if (heatMonthOffset < 0) heatMonthOffset += 1;
    } else if (activeHeatView === 'yearly') {
      if (heatYearOffset < 0) heatYearOffset += 1;
    } else {
      if (heatPageOffset < 0) heatPageOffset += 1;
    }
    renderActiveHeatView(true);
  });

  el('refresh').addEventListener('click', () => { if (state.route && !state.scanBusy) void scan(state.generation, state.route, true); });
  const outside = e => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const pop = el('color-picker-popover');
    if (!path.includes(host)) {
      closeColorPicker(true);
      toggle(false);
      hideContextTooltip();
      const om = el('overflow-menu');
      if (om) om.hidden = true;
      syncHostStackingElevation(false);
      return;
    }
    const isClosingNow = pop?.classList ? pop.classList.contains('is-closing') : pop?.getAttribute('data-closing') === 'true';
    if (pop && !pop.hidden && !isClosingNow) {
      const isInsidePicker = path.includes(pop);
      const isSwatchBtn = path.some(n => n?.classList?.contains?.('color-swatch-btn') || n?.classList?.contains?.('heat-leg-swatch') || n?.id?.startsWith?.('swatch-') || n?.id?.startsWith?.('heat-leg-'));
      if (!isInsidePicker && !isSwatchBtn) {
        closeColorPicker();
      }
    }
  };
  const escape = e => {
    if (e.key === 'Escape') {
      const pop = el('color-picker-popover');
      const isEscClosing = pop?.classList ? pop.classList.contains('is-closing') : pop?.getAttribute('data-closing') === 'true';
      if (pop && !pop.hidden && !isEscClosing) {
        const returnFocus = activePickerAnchor;
        closeColorPicker();
        returnFocus?.focus?.();
        return;
      }
      const tokenDrawer = el('token-color-drawer-body');
      if (tokenDrawer && tokenDrawer.style.display !== 'none') {
        toggleTokenColorsDrawer(false);
        btnTokenColors?.focus?.();
        return;
      }
      const colorDrawer = el('color-drawer-body');
      if (colorDrawer && colorDrawer.style.display !== 'none') {
        toggleColorsDrawer(false);
        btnColors?.focus?.();
        return;
      }
      toggle(false);
      hideContextTooltip();
      const om = el('overflow-menu');
      if (om) om.hidden = true;
      syncHostStackingElevation(false);
      el('badge')?.focus?.();
    }
  };
  document.addEventListener('click', outside);
  document.addEventListener('keydown', escape);

  // =========================================================================
  // 模块 4: 数据渲染、完整本地 Token 历史读取与首次使用日起算时间轴
  // =========================================================================
  function renderFiles(session) {
    const parent = el('files'); parent.replaceChildren();
    if (!session) { const item = document.createElement('p'); item.textContent = '正在读取全量会话附件引用…'; parent.appendChild(item); return; }
    if (!session.attachments.length) { const item = document.createElement('p'); item.textContent = '归档中没有上传附件引用。'; parent.appendChild(item); return; }
    for (const file of session.attachments) {
      const item = document.createElement('div'); item.className = 'file';
      const name = document.createElement('div'); name.className = 'file-name'; name.textContent = `${file.name} ${file.references > 1 ? `（引用 ${file.references} 次）` : ''}`;
      const detail = document.createElement('div'); detail.className = 'file-detail';
      const sizeInfo = file.width && file.height
        ? `${file.width}×${file.height} 像素`
        : (typeof file.chars === 'number' && file.chars > 0 ? `${fmt(file.chars)} 字符` : '');
      const tokenInfo = range(file) ? `${range(file)} token` : '内容 token 未知';
      detail.textContent = `${file.source === 'assistant' ? '模型输出附件 · ' : ''}${tokenInfo}${sizeInfo ? ` · ${sizeInfo}` : ''}${file.sheets != null ? ` · ${file.sheets} 个工作表，${fmt(file.cells)} 个单元格` : ''}${file.hiddenSheets ? `（含 ${file.hiddenSheets} 个隐藏表）` : ''}`;
      item.appendChild(name); item.appendChild(detail);
      if (file.unknownParts?.length) { const unknown = document.createElement('div'); unknown.className = 'file-unknown'; unknown.textContent = '未计全：' + file.unknownParts.join('；'); item.appendChild(unknown); }
      parent.appendChild(item);
    }
  }

  function setHoverExtra(text) {
    const extra = el('hover-extra');
    if (extra && extra.textContent !== text) {
      extra.textContent = text;
    }
  }

  function fmtYi(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e9) return `${parseFloat((n / 1e9).toFixed(2))}B`;
    if (n >= 1e6) return `${parseFloat((n / 1e6).toFixed(2))}M`;
    if (n >= 1e3) return `${parseFloat((n / 1e3).toFixed(1))}K`;
    return n.toLocaleString('en-US');
  }

  function getLvl(t) {
    if (!t || t <= 0) return 0;
    if (t < 3e6) return 1;
    if (t < 15e6) return 2;
    if (t < 60e6) return 3;
    return 4;
  }

  function parseLocalYmd(ymd) {
    if (!ymd || typeof ymd !== 'string') return null;
    const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatLocalYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDotYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  }

  function formatZhYmd(ymd) {
    const d = parseLocalYmd(ymd);
    if (!d) return ymd || '—';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function addDays(baseDate, deltaDays) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    d.setDate(d.getDate() + deltaDays);
    return d;
  }

  function getFirstUseDateStr() {
    const map = ANTIGRAVITY_TOKEN_DATA.dailyMap || {};
    const keys = Object.keys(map).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && (map[k]?.total > 0)).sort();
    const declared = ANTIGRAVITY_TOKEN_DATA.firstUseDate;
    if (declared && /^\d{4}-\d{2}-\d{2}$/.test(declared)) {
      if (keys.length && keys[0] < declared) return keys[0];
      return declared;
    }
    if (keys.length) return keys[0];
    return formatLocalYmd(new Date());
  }

  // 计算从「实际首次使用日」起算的 12 个月（52 周 = 364 天）展示窗口，绝不展示首次使用日之前的日期
  function computeTimelineWindow() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const firstStr = getFirstUseDateStr();
    const firstDate = parseLocalYmd(firstStr) || today;
    const totalDays = 52 * 7; // 364 天（12 个月 / 52 周）
    const elapsedDays = Math.max(0, Math.floor((today.getTime() - firstDate.getTime()) / 86400000)) + 1;

    let winStart;
    let winEnd;
    let canPrev = false;
    let canNext = false;

    if (elapsedDays <= totalDays) {
      // 使用未满一年：起点固定为实际首次使用日，向后铺满 12 个月（前置空白为 0）
      heatPageOffset = 0;
      winStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
      winEnd = addDays(winStart, totalDays - 1);
    } else {
      // 使用满一年后：默认窗口滚动为「以今天结尾的最近 12 个月」，且起点永不早于首次使用日；支持 ‹ / › 翻页回看更早归档
      const latestStart = addDays(today, -(totalDays - 1));
      const stepDays = 26 * 7; // 每次翻页半年度（26 周）
      let candidateStart = addDays(latestStart, heatPageOffset * stepDays);
      if (candidateStart.getTime() <= firstDate.getTime()) {
        candidateStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
        const maxBackSteps = -Math.ceil((latestStart.getTime() - firstDate.getTime()) / (stepDays * 86400000));
        if (heatPageOffset < maxBackSteps) heatPageOffset = maxBackSteps;
      }
      winStart = candidateStart;
      winEnd = addDays(winStart, totalDays - 1);
      canPrev = winStart.getTime() > firstDate.getTime();
      canNext = heatPageOffset < 0;
    }

    const firstBadge = el('first-use-badge');
    if (firstBadge) firstBadge.textContent = `首次使用：${formatZhYmd(firstStr)}`;
    const rangeEl = el('h-win-range');
    const prevBtn = el('h-page-prev');
    const nextBtn = el('h-page-next');

    if (activeHeatView === 'monthly') {
      const targetMonthDate = new Date(today.getFullYear(), today.getMonth() + heatMonthOffset, 1);
      const targetY = targetMonthDate.getFullYear();
      const targetM = targetMonthDate.getMonth();
      const firstY = firstDate.getFullYear();
      const firstM = firstDate.getMonth();
      const targetMonthKey = targetY * 12 + targetM;
      const firstMonthKey = firstY * 12 + firstM;
      canPrev = targetMonthKey > firstMonthKey;
      canNext = heatMonthOffset < 0;
      if (rangeEl) rangeEl.textContent = `${targetY}年${targetM + 1}月`;
    } else if (activeHeatView === 'yearly') {
      const thisY = today.getFullYear();
      const targetY = thisY + heatYearOffset;
      const firstY = firstDate.getFullYear();
      canPrev = targetY > firstY;
      canNext = heatYearOffset < 0;
      if (rangeEl) {
        rangeEl.textContent = (targetY === thisY) ? `${targetY}年（1月1日–今天）` : `${targetY}年`;
      }
    } else {
      if (rangeEl) rangeEl.textContent = `${formatDotYmd(winStart)} – ${formatDotYmd(winEnd)}`;
    }

    if (prevBtn) prevBtn.disabled = !canPrev;
    if (nextBtn) nextBtn.disabled = !canNext;

    return { firstStr, firstDate, today, winStart, winEnd, totalDays, canPrev, canNext };
  }

  function applyTokenHistoryPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.loading) {
      if (Number(ANTIGRAVITY_TOKEN_DATA.summary?.grandTotalTokens) > 0) return false;
    }

    const hasExistingData = Number(ANTIGRAVITY_TOKEN_DATA.summary?.grandTotalTokens) > 0;
    const incomingKeys = Object.keys(payload.dailyMap || {});
    const incomingTotal = Number(payload.summary?.grandTotalTokens) || incomingKeys.reduce((acc, k) => acc + (Number(payload.dailyMap[k]?.total) || 0), 0);
    const hasIncomingRefCost = Boolean(payload.referenceCost?.currentMonth?.totalCostUSD || payload.referenceCost?.all?.totalCostUSD);
    const hasIncomingPayloadContent = incomingKeys.length > 0 || incomingTotal > 0 || hasIncomingRefCost;
    if (hasExistingData && !hasIncomingPayloadContent && !payload.isAccountSwitched && !payload.forceReset) {
      return false;
    }

    ANTIGRAVITY_TOKEN_DATA.rawPayload = payload;

    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const todayStr = formatLocalYmd(new Date());
    const normalized = core && typeof core.normalizeTokenHistoryPayload === 'function'
      ? core.normalizeTokenHistoryPayload(payload, { source: activeTokenSource, todayStr })
      : null;

    if (normalized) {
      ANTIGRAVITY_TOKEN_DATA.dailyMap = normalized.dailyMap;
      ANTIGRAVITY_TOKEN_DATA.dailyMapBySource = normalized.dailyMapBySource;
      ANTIGRAVITY_TOKEN_DATA.summary = normalized.summary;
      ANTIGRAVITY_TOKEN_DATA.referenceCost = normalized.referenceCost;
      ANTIGRAVITY_TOKEN_DATA.currentPeriod = normalized.currentPeriod;
      if (normalized.firstUseDate) ANTIGRAVITY_TOKEN_DATA.firstUseDate = normalized.firstUseDate;
      if (normalized.updatedAt) ANTIGRAVITY_TOKEN_DATA.updatedAt = normalized.updatedAt;
    } else {
      const newMap = {};
      if (payload.dailyMap && typeof payload.dailyMap === 'object') {
        for (const [dKey, rec] of Object.entries(payload.dailyMap)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dKey) || !rec) continue;
          newMap[dKey] = {
            total: Number(rec.total) || 0,
            input: Number(rec.input) || 0,
            output: Number(rec.output) || 0,
            cache: Number(rec.cache) || 0,
            steps: Number(rec.steps) || 0
          };
        }
      }
      ANTIGRAVITY_TOKEN_DATA.dailyMap = newMap;
      if (payload.dailyMapBySource) ANTIGRAVITY_TOKEN_DATA.dailyMapBySource = payload.dailyMapBySource;
      if (payload.firstUseDate) ANTIGRAVITY_TOKEN_DATA.firstUseDate = payload.firstUseDate;
      if (payload.updatedAt) ANTIGRAVITY_TOKEN_DATA.updatedAt = payload.updatedAt;
      if (payload.currentPeriod) ANTIGRAVITY_TOKEN_DATA.currentPeriod = payload.currentPeriod;
      if (payload.referenceCost) ANTIGRAVITY_TOKEN_DATA.referenceCost = payload.referenceCost;

      const keys = Object.keys(newMap).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && newMap[k]?.total > 0).sort();
      const monthPrefix = todayStr.slice(0, 7);
      const yearPrefix = todayStr.slice(0, 4);
      let totalTokens = 0, todayTokens = 0, monthTokens = 0, yearTokens = 0, monthDays = 0;
      let totalInput = 0, totalOutput = 0, totalCache = 0;
      let curMonthInput = 0, curMonthOutput = 0, curMonthCache = 0;
      for (const k of keys) {
        const r = newMap[k];
        const t = Number(r.total) || 0;
        totalTokens += t;
        totalInput += Number(r.input) || 0;
        totalOutput += Number(r.output) || 0;
        totalCache += Number(r.cache) || 0;
        if (k === todayStr) todayTokens += t;
        if (k.startsWith(monthPrefix)) {
          monthTokens += t;
          curMonthInput += Number(r.input) || 0;
          curMonthOutput += Number(r.output) || 0;
          curMonthCache += Number(r.cache) || 0;
          monthDays += 1;
        }
        if (k.startsWith(yearPrefix)) yearTokens += t;
      }
      const rawSum = payload.summary || {};
      ANTIGRAVITY_TOKEN_DATA.summary = {
        grandTotalTokens: Math.max(totalTokens, Number(rawSum.grandTotalTokens) || 0),
        totalTokens: Math.max(totalTokens, Number(rawSum.grandTotalTokens) || 0),
        todayTokens: todayTokens > 0 ? todayTokens : (Number(rawSum.todayTokens) || 0),
        monthTokens: Math.max(monthTokens, Number(rawSum.monthTokens) || 0),
        yearTokens: Math.max(yearTokens, Number(rawSum.yearTokens) || 0),
        totalInputTokens: Math.max(totalInput, Number(rawSum.totalInputTokens) || 0),
        totalOutputTokens: Math.max(totalOutput, Number(rawSum.totalOutputTokens) || 0),
        totalCacheTokens: Math.max(totalCache, Number(rawSum.totalCacheTokens) || 0),
        currentMonthInput: Math.max(curMonthInput, Number(rawSum.currentMonthInput) || 0),
        currentMonthOutput: Math.max(curMonthOutput, Number(rawSum.currentMonthOutput) || 0),
        currentMonthCache: Math.max(curMonthCache, Number(rawSum.currentMonthCache) || 0),
        totalDays: keys.length,
        totalConversations: Number(rawSum.totalConversations) || keys.length,
        firstUseDate: payload.firstUseDate || rawSum.firstUseDate || null
      };
    }

    if (payload.planStatus || payload.customPlanSettings) {
      let mergedPlan = payload.planStatus || ANTIGRAVITY_TOKEN_DATA.planStatus || {};
      try {
        const email = mergedPlan.email || 'default';
        let customObj = lastSavedCustomPlan || payload.customPlanSettings || null;
        if (!customObj && typeof window !== 'undefined' && window.__AGContextMeterSettings?.customPlan) {
          customObj = window.__AGContextMeterSettings.customPlan;
        }
        if (!customObj) {
          const savedCustomRaw = localStorage?.getItem('ag_custom_plan_' + email.toLowerCase()) || localStorage?.getItem('ag_custom_plan_default');
          if (savedCustomRaw) customObj = JSON.parse(savedCustomRaw);
        }
        if (customObj && typeof customObj === 'object') {
          lastSavedCustomPlan = { ...customObj };
          try {
            const jsonStr = JSON.stringify(customObj);
            if (email && email !== 'default') localStorage?.setItem('ag_custom_plan_' + email.toLowerCase(), jsonStr);
            localStorage?.setItem('ag_custom_plan_default', jsonStr);
          } catch {}
          if (core && core.resolveEffectivePlanStatus) {
            mergedPlan = core.resolveEffectivePlanStatus(payload.rawPlanStatus || payload.planStatus, customObj, { currentEmail: email });
          }
        }
      } catch {}
      ANTIGRAVITY_TOKEN_DATA.planStatus = mergedPlan;
      ANTIGRAVITY_TOKEN_DATA.rawPlanStatus = payload.rawPlanStatus || payload.planStatus || mergedPlan;
      renderPlanDetail(mergedPlan);
    }

    if (payload.costEstimate) {
      ANTIGRAVITY_TOKEN_DATA.costEstimate = payload.costEstimate;
    }
    if (payload.costEstimateCurrentMonth) {
      ANTIGRAVITY_TOKEN_DATA.costEstimateCurrentMonth = payload.costEstimateCurrentMonth;
    }
    if (payload.costEstimateBySource) {
      ANTIGRAVITY_TOKEN_DATA.costEstimateBySource = payload.costEstimateBySource;
    } else if (payload.costEstimate) {
      ANTIGRAVITY_TOKEN_DATA.costEstimateBySource = {
        all: payload.costEstimate,
        desktop: payload.costEstimate,
        cli: { pricedCostUSD: 0, pricedRequestsCount: 0, unpricedRequestsCount: 0, coveragePercent: null, byModel: {} }
      };
    }

    // 重新汇总卡片统计与顶栏
    const sum = ANTIGRAVITY_TOKEN_DATA.summary;
    const totalTokens = sum.grandTotalTokens;
    const shownToday = sum.todayTokens;
    const monthTokens = sum.monthTokens;
    const yearTokens = sum.yearTokens;
    const convCount = sum.totalConversations;
    const totalDays = sum.totalDays || Object.keys(ANTIGRAVITY_TOKEN_DATA.dailyMap).length;
    const avgMonth = Math.round(monthTokens / Math.max(1, totalDays));

    const fmtCardM = v => {
      const n = Number(v) || 0;
      if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return String(n);
    };
    const badgeAmt = el('token-amount');
    const badgeExtra = el('token-hover-extra');
    const overAmt = el('overflow-tokens-val');
    if (badgeAmt) badgeAmt.textContent = fmtCardM(totalTokens);
    if (badgeExtra) badgeExtra.textContent = `· 今日 ${fmtCardM(shownToday)}`;
    if (overAmt) overAmt.textContent = fmtCardM(totalTokens);

    const tTotalVal = el('t-total-val');
    const tTotalSub = el('t-total-sub');
    const tTodayVal = el('t-today-val');
    const tTodaySub = el('t-today-sub');
    const tMonthVal = el('t-month-val');
    const tMonthSub = el('t-month-sub');
    const tYearVal = el('t-year-val');
    const tYearSub = el('t-year-sub');

    if (tTotalVal) tTotalVal.textContent = fmtCardM(totalTokens);
    if (tTotalSub) tTotalSub.textContent = `${totalTokens.toLocaleString('en-US')} Tokens`;
    if (tTodayVal) tTodayVal.textContent = fmtCardM(shownToday);
    if (tTodaySub) tTodaySub.textContent = `${convCount} 会话实时累加`;
    if (tMonthVal) tMonthVal.textContent = fmtCardM(monthTokens);
    if (tMonthSub) tMonthSub.textContent = `日均约 ${fmtCardM(avgMonth)}`;
    if (tYearVal) tYearVal.textContent = fmtCardM(yearTokens);
    if (tYearSub) tYearSub.textContent = `${totalDays} 天活动记录`;

    // 聚合全周期各区间预估费用
    const allDateKeys = Object.keys(ANTIGRAVITY_TOKEN_DATA.dailyMap || {});
    const nowYmd = todayStr;
    const thisMonthPrefix = nowYmd.slice(0, 7);
    const thisYearPrefix = nowYmd.slice(0, 4);

    const todayCostInfo = getDailyModelCost(ANTIGRAVITY_TOKEN_DATA.dailyMap[nowYmd], nowYmd, activeCostModel, { mode: activeCostMode });
    const totalCostAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, allDateKeys, activeCostModel, { mode: activeCostMode, todayStr: nowYmd });

    const monthKeys = allDateKeys.filter(k => k.startsWith(thisMonthPrefix) && k <= nowYmd);
    const monthCostAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, monthKeys, activeCostModel, { mode: activeCostMode, todayStr: nowYmd });

    const yearKeys = allDateKeys.filter(k => k.startsWith(thisYearPrefix) && k <= nowYmd);
    const yearCostAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, yearKeys, activeCostModel, { mode: activeCostMode, todayStr: nowYmd });

    const tTotalCost = el('t-total-cost');
    const tTodayCost = el('t-today-cost');
    const tMonthCost = el('t-month-cost');
    const tYearCost = el('t-year-cost');

    if (tTotalCost) {
      tTotalCost.textContent = `≈ $${totalCostAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(totalCostAgg.totalCostUSD)} · 日均 $${totalCostAgg.dailyAverageUSD.toFixed(2)}`;
    }
    if (tTodayCost) {
      tTodayCost.textContent = `≈ $${todayCostInfo.costUSD.toFixed(2)}${formatUsdSecondaryParen(todayCostInfo.costUSD)}`;
    }
    if (tMonthCost) {
      tMonthCost.textContent = `≈ $${monthCostAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(monthCostAgg.totalCostUSD)} · 日均 $${monthCostAgg.dailyAverageUSD.toFixed(2)}`;
    }
    if (tYearCost) {
      tYearCost.textContent = `≈ $${yearCostAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(yearCostAgg.totalCostUSD)} · 日均 $${yearCostAgg.dailyAverageUSD.toFixed(2)}`;
    }

    // 规范化已完整保留输入/缓存/输出分类，执行费用视图渲染
    renderActiveCostEstimateView();

    computeTimelineWindow();
    renderActiveHeatView(true);
    return true;
  }


  async function recordModelCallsRemote(calls) {
    if (!calls || !calls.length) return;
    let changed = false;
    const hasFinalCall = calls.some(c => c?.status === 'final');
    try {
      if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.recordCalls === 'function') {
        const res = await window.contextMeterAPI.recordCalls(calls);
        if (res && res.ok === false) {
          console.warn('Context Meter: 记录调用入账失败', res.error);
        } else if (res?.changed) {
          changed = true;
        }
      } else if (typeof window !== 'undefined' && window.__AGContextMeterLive?.port) {
        const live = window.__AGContextMeterLive;
        const resp = await fetch(`http://127.0.0.1:${live.port}/record-calls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
          body: JSON.stringify({ calls })
        });
        if (!resp.ok) {
          console.warn(`Context Meter: 实时通道 record-calls 响应异常 HTTP ${resp.status}`);
        } else {
          const res = await resp.json().catch(() => null);
          if (res && res.ok === false) {
            console.warn('Context Meter: 实时通道 record-calls 失败', res.error);
          } else if (res?.changed) {
            changed = true;
          }
        }
      }
      if (changed || hasFinalCall) {
        void syncTokenHistoryFromHost(false);
      }
    } catch (err) {
      console.warn('Context Meter: 调用入账发生异常', err);
    }
  }

  async function restoreSettingsFromHost() {
    if (state.disposed || suitePrefsSaveInFlight > 0) return;
    const thisSeq = ++restoreRequestSeq;
    const startActionSeq = userActionSeq;
    try {
      let settingsRes = null;
      const currentEmail = ANTIGRAVITY_TOKEN_DATA.planStatus?.email || 'default';

      // 权威配置同步：热注入实时桥接优先，未开启实时桥接时走宿主 IPC 或启动快照
      settingsRes = await invokeHostBridge('/get-settings', { email: currentEmail }, 'getSettings');
      if (!settingsRes && typeof window !== 'undefined' && window.__AGContextMeterSettings?.ok) {
        settingsRes = window.__AGContextMeterSettings;
      }

      // 若在网络等待期间有更新的恢复请求完成、用户发生了主动修改或仍有设置在途保存，丢弃旧回包！
      if (thisSeq < restoreRequestSeq || userActionSeq > startActionSeq || suitePrefsSaveInFlight > 0) {
        return;
      }

      if (settingsRes?.ok) {
        const savedView = settingsRes.savedHeatView || settingsRes.uiPreferences?.savedHeatView;
        if (savedView && ['daily', 'weekly', 'monthly', 'yearly', 'cum'].includes(savedView)) {
          switchHeatView(savedView, false);
        }
        // 隐藏检查更新与自动更新后，启动时禁止自动请求上游 GitHub Releases
        autoCheckUpdate = false;
        const chk = el('check-auto-update');
        if (chk) chk.checked = false;
        if (settingsRes.uiPreferences && typeof settingsRes.uiPreferences === 'object' && typeof window !== 'undefined') {
          window.__AGContextMeterSettings = {
            ...(window.__AGContextMeterSettings || {}),
            ok: true,
            uiPreferences: { ...settingsRes.uiPreferences }
          };
        }
        if (typeof applyHostUiPreferences === 'function' && settingsRes.uiPreferences) {
          applyHostUiPreferences(settingsRes.uiPreferences, { fromPoll: true });
        }
      }

      if (settingsRes?.ok && settingsRes.customPlan && typeof settingsRes.customPlan === 'object') {
        lastSavedCustomPlan = { ...settingsRes.customPlan };
        if (typeof window !== 'undefined') {
          window.__AGContextMeterSettings = { ...(window.__AGContextMeterSettings || {}), ok: true, customPlan: { ...settingsRes.customPlan } };
        }

        const email = ANTIGRAVITY_TOKEN_DATA.planStatus?.email || settingsRes.customPlan?.account || currentEmail || 'default';
        try {
          const jsonStr = JSON.stringify(settingsRes.customPlan);
          if (email && email !== 'default') localStorage?.setItem('ag_custom_plan_' + String(email).toLowerCase(), jsonStr);
          localStorage?.setItem('ag_custom_plan_default', jsonStr);
        } catch {}
        applyCustomPlanObjectLocally(settingsRes.customPlan, email);
      } else {
        // 回退检查 localStorage
        const email = ANTIGRAVITY_TOKEN_DATA.planStatus?.email || 'default';
        const key = email && email !== 'default' ? 'ag_custom_plan_' + String(email).toLowerCase() : 'ag_custom_plan_default';
        const savedRaw = localStorage?.getItem(key) || localStorage?.getItem('ag_custom_plan_default');
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          if (parsed && typeof parsed === 'object') {
            lastSavedCustomPlan = { ...parsed };
            applyCustomPlanObjectLocally(parsed, parsed.account || email);
          }
        }
      }
    } catch {}
  }

  let historySyncBusy = false;
  let pendingHistoryForce = false;
  async function syncTokenHistoryFromHost(force = false) {
    if (state.disposed) return;
    if (historySyncBusy) {
      if (force) {
        pendingHistoryForce = true;
      }
      return;
    }
    historySyncBusy = true;
    try {
      await restoreSettingsFromHost();
      if (typeof window !== 'undefined' && window.__AGContextMeterHistory) {
        if (!ANTIGRAVITY_TOKEN_DATA.updatedAt && !ANTIGRAVITY_TOKEN_DATA.summary?.grandTotalTokens) {
          applyTokenHistoryPayload(window.__AGContextMeterHistory);
        }
      }
      if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.getTokenHistory === 'function') {
        const res = await window.contextMeterAPI.getTokenHistory(Boolean(force));
        if (res?.ok && res.data) {
          if (typeof window !== 'undefined') window.__AGContextMeterHistory = res.data;
          applyTokenHistoryPayload(res.data);
        }
      } else if (typeof window !== 'undefined' && window.__AGContextMeterLive?.port) {
        const live = window.__AGContextMeterLive;
        const r = await fetch(`http://127.0.0.1:${live.port}/token-history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
          body: JSON.stringify({ force: Boolean(force) })
        });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok && j.data) {
            if (typeof window !== 'undefined') window.__AGContextMeterHistory = j.data;
            applyTokenHistoryPayload(j.data);
          }
        }
      }
    } catch {}
    finally {
      historySyncBusy = false;
      if (pendingHistoryForce) {
        pendingHistoryForce = false;
        void syncTokenHistoryFromHost(true);
      }
      if (autoCheckUpdate) {
        setTimeout(() => { void checkAppUpdate(false); }, 1200);
      }
    }
  }

  function openGithubRepo(pathSuffix = '') {
    const url = 'https://github.com/elviscjn-cjn/antigravity-context-viewer' + pathSuffix;
    if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.openExternal === 'function') {
      window.contextMeterAPI.openExternal(url);
    } else {
      window.open?.(url, '_blank');
    }
  }

  let currentUpdateTrigger = 'tokens';

  function positionUpdatePopover(trigger = currentUpdateTrigger) {
    const pop = el('update-popover');
    if (!pop) return;
    const triggerBtn = trigger === 'ctx' ? el('btn-check-update-ctx') : el('btn-check-update');
    if (!triggerBtn || typeof triggerBtn.getBoundingClientRect !== 'function') return;
    const rect = triggerBtn.getBoundingClientRect();
    const winW = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024;
    const winH = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768;
    let right = Math.max(14, winW - rect.right);
    let top = rect.bottom + 8;
    if (top + 220 > winH) {
      top = Math.max(10, rect.top - 230);
    }
    pop.style.position = 'fixed';
    pop.style.top = `${Math.round(top)}px`;
    pop.style.right = `${Math.round(right)}px`;
    pop.style.left = 'auto';
  }

  function showUpdatePopover(trigger = currentUpdateTrigger) {
    const pop = el('update-popover');
    if (!pop) return;
    currentUpdateTrigger = trigger;
    positionUpdatePopover(trigger);
    pop.style.display = 'block';
  }

  function hideUpdatePopover() {
    const pop = el('update-popover');
    if (pop) pop.style.display = 'none';
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => {
      const pop = el('update-popover');
      if (pop && pop.style.display === 'block') {
        positionUpdatePopover();
      }
    });
  }

  async function checkAppUpdate(manual = false, trigger = currentUpdateTrigger) {
    const dot = el('update-badge-dot');
    const dotCtx = el('update-badge-dot-ctx');
    const pop = el('update-popover');
    const titleEl = el('up-pop-title');
    const bodyEl = el('up-pop-body');
    const verEl = el('up-pop-ver');
    const statusEl = el('up-pop-status');
    const applyBtn = el('btn-apply-update');

    // 检查桥接是否存在；若缺失则直接判定为更新功能不可用，严禁显示“最新”
    const currentVer = typeof METER_VERSION !== 'undefined' ? METER_VERSION : '0.8.2';
    const hasBridge = typeof window !== 'undefined' && typeof window.contextMeterAPI?.checkUpdate === 'function';
    if (!hasBridge) {
      cachedLatestRelease = null;
      if (dot) dot.style.display = 'none';
      if (dotCtx) dotCtx.style.display = 'none';
      if (titleEl) titleEl.textContent = 'ℹ️ 更新不可用';
      if (verEl) verEl.textContent = `v${currentVer} (更新不可用)`;
      if (bodyEl) bodyEl.textContent = '当前环境未提供更新桥接接口（如纯前端调试或免安装热挂载模式），无法在线检查更新。请前往 GitHub Releases 页面查看最新发布。';
      if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
      if (applyBtn) { applyBtn.style.display = 'none'; applyBtn.disabled = true; }
      if (manual) showUpdatePopover(trigger);
      return;
    }

    if (manual) {
      cachedLatestRelease = null;
      showUpdatePopover(trigger);
      if (titleEl) titleEl.textContent = '🔄 检查更新中';
      if (verEl) verEl.textContent = `v${currentVer} (正在检查…)`;
      if (bodyEl) bodyEl.textContent = '正在连接 GitHub 检测最新版本…';
      if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
      if (applyBtn) { applyBtn.style.display = 'none'; applyBtn.disabled = true; }
    }

    try {
      const res = await window.contextMeterAPI.checkUpdate({ force: manual, currentVersion: currentVer });

      // 返回 null、非对象或 ok: false 均为检查失败，严禁显示“最新”
      if (!res || res.ok === false) {
        cachedLatestRelease = null;
        if (dot) dot.style.display = 'none';
        if (dotCtx) dotCtx.style.display = 'none';
        if (titleEl) titleEl.textContent = '⚠️ 检查更新失败';
        if (verEl) verEl.textContent = `v${currentVer} (检查失败)`;
        const errMsg = res?.error || '未能获取有效的版本数据';
        if (bodyEl) bodyEl.textContent = `检查更新失败: ${errMsg}。请检查网络代理设置或前往 GitHub 查看。`;
        if (applyBtn) { applyBtn.style.display = 'none'; applyBtn.disabled = true; }
        if (manual) showUpdatePopover(trigger);
        return;
      }

      if (res.hasUpdate && res.latestVersion) {
        cachedLatestRelease = res;
        if (dot) dot.style.display = 'block';
        if (dotCtx) dotCtx.style.display = 'block';
        if (titleEl) titleEl.textContent = '🚀 发现新版本';
        if (verEl) verEl.textContent = `v${res.currentVersion || currentVer} → v${res.latestVersion}`;
        if (bodyEl) {
          bodyEl.textContent = `发现新版本 v${res.latestVersion}！\n\n更新说明：\n${res.releaseNotes || '性能优化与体验改进'}`;
        }
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = '立即更新';
          applyBtn.style.display = 'inline-block';
        }
        if (manual) showUpdatePopover(trigger);
      } else {
        cachedLatestRelease = null;
        if (dot) dot.style.display = 'none';
        if (dotCtx) dotCtx.style.display = 'none';
        if (titleEl) titleEl.textContent = '✅ 已是最新版本';
        const effectiveCurrent = res.installedVersion || res.currentVersion || currentVer;
        if (verEl) verEl.textContent = `v${effectiveCurrent} (已是最新)`;
        const updateStatusText = res.diskPendingRestart
          ? `已完成磁盘安装至最新版本 (v${effectiveCurrent})，待重启客户端后主进程完整生效。`
          : `当前已是最新版本 (v${effectiveCurrent})。已通过 GitHub Releases 确认。`;
        if (bodyEl) bodyEl.textContent = updateStatusText;
        if (applyBtn) { applyBtn.style.display = 'none'; applyBtn.disabled = true; }
        if (manual) showUpdatePopover(trigger);
      }
    } catch (err) {
      cachedLatestRelease = null;
      if (dot) dot.style.display = 'none';
      if (dotCtx) dotCtx.style.display = 'none';
      if (titleEl) titleEl.textContent = '⚠️ 检查更新失败';
      if (verEl) verEl.textContent = `v${currentVer} (检查失败)`;
      if (bodyEl) bodyEl.textContent = `检查更新失败: ${err.message}。请检查网络连接或稍后重试。`;
      if (applyBtn) { applyBtn.style.display = 'none'; applyBtn.disabled = true; }
      if (manual) showUpdatePopover(trigger);
    }
  }

  async function applyAppUpdate() {
    const pop = el('update-popover');
    const applyBtn = el('btn-apply-update');
    const statusEl = el('up-pop-status');
    const titleEl = el('up-pop-title');
    const bodyEl = el('up-pop-body');
    const verEl = el('up-pop-ver');
    const dot = el('update-badge-dot');
    const dotCtx = el('update-badge-dot-ctx');
    if (!cachedLatestRelease) return;

    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = '正在更新...';
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = '正在下载安装包并校验 SHA-256...';
    }

    try {
      let res = null;
      if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.applyUpdate === 'function') {
        res = await window.contextMeterAPI.applyUpdate({ version: cachedLatestRelease.latestVersion });
      } else {
        throw new Error('更新接口不可用');
      }
      if (res && res.ok) {
        const targetVer = res.version || res.installedVersion || cachedLatestRelease?.latestVersion || currentVer;
        currentVer = targetVer;
        const vEl = el('v');
        if (vEl) vEl.textContent = `v${currentVer}`;

        const dot = el('update-badge-dot');
        const dotCtx = el('update-badge-dot-ctx');
        if (dot) dot.style.display = 'none';
        if (dotCtx) dotCtx.style.display = 'none';

        if (titleEl) titleEl.textContent = '🎉 更新已完成';
        if (verEl) verEl.textContent = `v${currentVer} (已是最新)`;
        if (bodyEl) {
          bodyEl.textContent = res.liveInjected
            ? `已成功在线更新至 v${currentVer}。界面组件已完成热注入即时生效；主进程核心常驻模块待完全重启客户端后完整生效。`
            : `已成功完成 v${currentVer} 磁盘更新，需完全重启 Antigravity 后生效。`;
        }
        if (applyBtn) {
          applyBtn.textContent = '已更新';
          applyBtn.disabled = false;
        }

        if (res.liveInjected) {
          if (statusEl) statusEl.textContent = `🎉 磁盘更新成功 (v${currentVer})！已完成热注入即时生效（界面已刷新，主进程待重启完整生效）。`;
        } else {
          const detail = res.diskInstalled ? '已完成磁盘安装' : '更新已完成';
          if (statusEl) statusEl.textContent = `✅ ${detail} (v${currentVer})，需完全重启 Antigravity 后生效。`;
        }
        setTimeout(() => {
          if (pop) pop.style.display = 'none';
        }, 3500);
      } else {
        if (statusEl) statusEl.textContent = `✖ 更新失败: ${res?.error || '未知错误'}`;
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '重试更新'; }
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `✖ 更新异常: ${err.message}`;
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '重试更新'; }
    }
  }

  el('btn-github-repo')?.addEventListener('click', () => openGithubRepo());
  el('btn-github-repo-ctx')?.addEventListener('click', () => openGithubRepo());
  el('btn-check-update')?.addEventListener('click', () => {
    const pop = el('update-popover');
    if (pop && pop.style.display === 'block' && currentUpdateTrigger === 'tokens') {
      pop.style.display = 'none';
    } else {
      void checkAppUpdate(true, 'tokens');
    }
  });
  el('btn-check-update-ctx')?.addEventListener('click', () => {
    const pop = el('update-popover');
    if (pop && pop.style.display === 'block' && currentUpdateTrigger === 'ctx') {
      pop.style.display = 'none';
    } else {
      void checkAppUpdate(true, 'ctx');
    }
  });
  el('btn-close-update-pop')?.addEventListener('click', () => {
    const pop = el('update-popover');
    if (pop) pop.style.display = 'none';
  });
  el('btn-update-later')?.addEventListener('click', () => {
    const pop = el('update-popover');
    if (pop) pop.style.display = 'none';
  });
  el('btn-view-release-page')?.addEventListener('click', () => {
    openGithubRepo(cachedLatestRelease?.tagName ? `/releases/tag/${cachedLatestRelease.tagName}` : '/releases');
  });
  el('btn-apply-update')?.addEventListener('click', () => void applyAppUpdate());

  el('check-auto-update')?.addEventListener('change', e => {
    autoCheckUpdate = e.target.checked;
    if (typeof window !== 'undefined' && typeof window.contextMeterAPI?.saveSettings === 'function') {
      window.contextMeterAPI.saveSettings({ autoCheckUpdate });
    }
  });

function positionHeatPopover(anchorX, anchorY) {
    if (!heatPop) return;
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    const popRect = typeof heatPop.getBoundingClientRect === 'function' ? heatPop.getBoundingClientRect() : null;
    const popW = (popRect && popRect.width > 0) ? popRect.width : 190;
    const popH = (popRect && popRect.height > 0) ? popRect.height : 74;
    const margin = 10;
    const halfW = popW / 2;
    const clampedX = Math.max(halfW + margin, Math.min(vw - halfW - margin, Number(anchorX) || 0));
    const minY = popH + margin + 6;
    const clampedY = Math.max(minY, Math.min(vh - margin, Number(anchorY) || 0));
    heatPop.style.left = `${Math.round(clampedX)}px`;
    heatPop.style.top = `${Math.round(clampedY)}px`;
    heatPop.style.opacity = '1';
  }

  function renderHeatmapGrid(forceRebuild = false) {
    const colsBox = el('h-grid-cols');
    const monthsBox = el('h-months');
    if (!colsBox || !monthsBox) return;
    const win = computeTimelineWindow();
    const sig = `${win.firstStr}:${formatLocalYmd(win.winStart)}:${Object.keys(ANTIGRAVITY_TOKEN_DATA.dailyMap).length}`;
    if (!forceRebuild && colsBox.children.length > 0 && colsBox.getAttribute('data-sig') === sig) return;

    colsBox.replaceChildren();
    monthsBox.replaceChildren();
    colsBox.setAttribute('data-sig', sig);

    const todayKey = formatLocalYmd(win.today);
    const list = [];
    for (let i = 0; i < win.totalDays; i++) {
      const d = addDays(win.winStart, i);
      const key = formatLocalYmd(d);
      const isFuture = d.getTime() > win.today.getTime();
      const rec = ANTIGRAVITY_TOKEN_DATA.dailyMap[key];
      list.push({ date: d, key, tokens: rec ? rec.total : 0, rec, isFuture, isToday: key === todayKey });
    }

    const monthMarkers = [];
    let lastM = -1;
    let lastCol = -10;

    for (let c = 0; c < 52; c++) {
      const col = document.createElement('div');
      col.className = 'heat-week-col';
      const slice = list.slice(c * 7, (c + 1) * 7);
      const mNum = slice[0].date.getMonth() + 1;
      if (mNum !== lastM) {
        if (c - lastCol >= 3 && 52 - c >= 2) {
          monthMarkers.push({ month: mNum, colIdx: c });
          lastCol = c;
        }
        lastM = mNum;
      }

      slice.forEach(item => {
        const cell = document.createElement('div');
        const lvl = getLvl(item.tokens);
        cell.className = `heat-cell lvl-${lvl}${item.isFuture ? ' is-future' : ''}${item.isToday ? ' is-today' : ''}`;
        cell.setAttribute('data-date', item.key);
        cell.setAttribute('data-tokens', String(item.tokens));

        const showPop = () => {
          const d = item.date;
          heatPopDate.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${item.isToday ? '（今日）' : (item.key === win.firstStr ? '（首次使用）' : '')}`;
          const costInfo = getDailyModelCost(item.rec, item.key, activeCostModel, { mode: activeCostMode });
          const costStr = costInfo.costUSD > 0 ? ` · ≈ $${costInfo.costUSD.toFixed(2)}${formatUsdSecondaryParen(costInfo.costUSD)}` : '';
          heatPopVal.textContent = item.tokens > 0 ? `${fmtYi(item.tokens)} Tokens${costStr}` : (item.isFuture ? '未来日期（待产生记录）' : '0 Tokens');
          if (item.rec) {
            heatPopDet.innerHTML = `
              <div class="pop-det-col"><span class="pop-det-val">Prompt: ${fmtYi(item.rec.input)}</span><span class="pop-det-trans">提示词</span></div>
              <div class="pop-det-col"><span class="pop-det-val">Output: ${fmtYi(item.rec.output)}</span><span class="pop-det-trans">输出</span></div>
              <div class="pop-det-col"><span class="pop-det-val">Cache: ${fmtYi(item.rec.cache)}</span><span class="pop-det-trans">缓存</span></div>
            `.trim();
            heatPopDet.style.display = 'flex';
          } else {
            heatPopDet.style.display = 'none';
          }
          const r = cell.getBoundingClientRect();
          positionHeatPopover(r.left + r.width / 2, r.top - 6);
        };

        cell.addEventListener('mouseenter', showPop);
        cell.addEventListener('mouseleave', hidePopover);
        cell.addEventListener('click', showPop);

        col.appendChild(cell);
      });
      colsBox.appendChild(col);
    }

    monthMarkers.forEach(mm => {
      const lbl = document.createElement('span');
      lbl.className = 'heat-month-item';
      lbl.style.left = `${mm.colIdx * 13}px`;
      lbl.textContent = `${mm.month}月`;
      monthsBox.appendChild(lbl);
    });

    updateSummaryBar('daily', list.map(x => x.key));
  }

  function renderHeatmapWeekly() {
    const box = el('h-weekly-box');
    if (!box) return;
    box.replaceChildren();

    const scale = getEffectiveHeatmapScale();
    const [cEmpty, c1, c2, c3, c4] = scale;
    const win = computeTimelineWindow();
    const totalWeeks = 52;
    const weeksData = [];
    let max = 1;

    for (let c = 0; c < totalWeeks; c++) {
      let sum = 0;
      let sDate = null, eDate = null;
      for (let r = 0; r < 7; r++) {
        const d = addDays(win.winStart, c * 7 + r);
        const k = formatLocalYmd(d);
        if (!sDate) sDate = d;
        eDate = d;
        const rec = ANTIGRAVITY_TOKEN_DATA.dailyMap[k];
        if (rec) sum += rec.total;
      }
      if (sum > max) max = sum;
      weeksData.push({ sum, sDate, eDate, startKey: formatLocalYmd(sDate) });
    }

    weeksData.forEach(w => {
      const col = document.createElement('div');
      col.className = 'w-bar-col';
      col.setAttribute('data-week-start', w.startKey);
      const fill = document.createElement('div');
      fill.className = 'w-bar-fill';
      const pct = Math.max(3, (w.sum / max) * 100);
      fill.style.height = `${pct}%`;
      const lvl = getLvlForRange(w.sum, 'week', max);
      fill.style.backgroundColor = w.sum === 0 ? cEmpty : (scale[lvl] || c4);
      col.appendChild(fill);

      const showPop = () => {
        const weekDates = [];
        for (let r = 0; r < 7; r++) weekDates.push(formatLocalYmd(addDays(w.sDate, r)));
        const costAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, weekDates, activeCostModel, {
          mode: activeCostMode,
          todayStr: formatLocalYmd(win.today)
        });
        const costStr = costAgg.totalCostUSD > 0 ? ` · ≈ $${costAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(costAgg.totalCostUSD)}` : '';
        heatPopDate.textContent = `${w.sDate.getFullYear()}.${w.sDate.getMonth() + 1}.${w.sDate.getDate()} - ${w.eDate.getMonth() + 1}.${w.eDate.getDate()}`;
        heatPopVal.textContent = w.sum > 0 ? `${fmtYi(w.sum)} Tokens${costStr}` : '0 Tokens';
        heatPopDet.innerHTML = `<span>周累计 (折合日均 $${costAgg.dailyAverageUSD.toFixed(2)})</span>`;
        heatPopDet.style.display = 'block';
        const r = col.getBoundingClientRect();
        positionHeatPopover(r.left + r.width / 2, r.top - 6);
      };

      col.addEventListener('mouseenter', showPop);
      col.addEventListener('mouseleave', hidePopover);
      col.addEventListener('click', showPop);

      box.appendChild(col);
    });

    const allWinDates = [];
    for (let i = 0; i < win.totalDays; i++) allWinDates.push(formatLocalYmd(addDays(win.winStart, i)));
    updateSummaryBar('weekly', allWinDates);
  }

  function renderHeatmapCum() {
    const cvs = el('h-cum-canvas');
    if (!cvs || !cvs.getContext) return;
    const ctx = cvs.getContext('2d');
    const rect = cvs.getBoundingClientRect ? cvs.getBoundingClientRect() : { width: 670 };
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const width = (rect.width || 670);
    const height = 100;
    cvs.width = width * dpr;
    cvs.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const win = computeTimelineWindow();
    const map = ANTIGRAVITY_TOKEN_DATA.dailyMap || {};
    const winStartKey = formatLocalYmd(win.winStart);
    // 计算窗口起点之前的历史滚存基数（支持跨年翻页时累计曲线连续）
    let running = 0;
    for (const [k, rec] of Object.entries(map)) {
      if (k < winStartKey && rec?.total > 0) running += rec.total;
    }

    const activeEnd = win.winEnd.getTime() > win.today.getTime() ? win.today : win.winEnd;
    const plotDays = Math.max(1, Math.floor((activeEnd.getTime() - win.winStart.getTime()) / 86400000) + 1);
    const points = [];

    for (let i = 0; i < plotDays; i++) {
      const d = addDays(win.winStart, i);
      const k = formatLocalYmd(d);
      const rec = map[k];
      if (rec) running += rec.total;
      points.push({ date: d, key: k, val: running });
    }

    const max = running || 1;
    const denom = Math.max(1, points.length - 1);
    const step = points.length === 1 ? width : (width / denom);

    const scale = getEffectiveHeatmapScale();
    const strokeColor = customColors.tokenAccent || scale[4];
    const strokeRgb = hexToRgb(normalizeHex(strokeColor)) || { r: 192, g: 132, b: 252 };
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgba(${strokeRgb.r}, ${strokeRgb.g}, ${strokeRgb.b}, 0.36)`);
    grad.addColorStop(1, `rgba(${strokeRgb.r}, ${strokeRgb.g}, ${strokeRgb.b}, 0.02)`);

    ctx.beginPath();
    ctx.moveTo(0, height);
    points.forEach((pt, idx) => {
      const x = points.length === 1 ? width / 2 : idx * step;
      const y = height - (pt.val / max) * (height - 12);
      ctx.lineTo(x, y);
    });
    if (points.length === 1) {
      const y = height - (points[0].val / max) * (height - 12);
      ctx.lineTo(width, y);
    }
    ctx.lineTo(width, height);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((pt, idx) => {
      const x = points.length === 1 ? 0 : idx * step;
      const y = height - (pt.val / max) * (height - 12);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (points.length === 1) {
      const y = height - (points[0].val / max) * (height - 12);
      ctx.lineTo(width, y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    cvs.onmousemove = e => {
      const r = cvs.getBoundingClientRect();
      const mouseX = e.clientX - r.left;
      const idx = points.length === 1 ? 0 : Math.min(points.length - 1, Math.max(0, Math.round(mouseX / step)));
      const pt = points[idx];
      const cumDates = [];
      for (const k of Object.keys(map)) {
        if (k <= pt.key) cumDates.push(k);
      }
      const costAgg = calculateIntervalCost(map, cumDates, activeCostModel, {
        mode: activeCostMode,
        todayStr: formatLocalYmd(win.today)
      });
      const costStr = costAgg.totalCostUSD > 0 ? ` · ≈ $${costAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(costAgg.totalCostUSD)}` : '';
      heatPopDate.textContent = `${pt.date.getFullYear()}年${pt.date.getMonth() + 1}月${pt.date.getDate()}日 (累计)`;
      heatPopVal.textContent = `${fmtYi(pt.val)} Tokens${costStr}`;
      heatPopDet.innerHTML = `<span>截至当日累计 (折合日均 $${costAgg.dailyAverageUSD.toFixed(2)})</span>`;
      heatPopDet.style.display = 'block';
      positionHeatPopover(e.clientX, r.top + (height - (pt.val / max) * (height - 12)) - 6);
    };
    cvs.onmouseleave = hidePopover;

    const allWinDates = [];
    for (let i = 0; i < win.totalDays; i++) allWinDates.push(formatLocalYmd(addDays(win.winStart, i)));
    updateSummaryBar('cum', allWinDates);
  }

  function updateSummaryBar(viewType, dateKeys = []) {
    const sumTokensEl = el('h-sum-tokens');
    const sumCostEl = el('h-sum-cost');
    const sumDailyAvgEl = el('h-sum-daily-avg');
    const sumActiveAvgEl = el('h-sum-active-avg');
    const subRatioWrapEl = el('h-sum-sub-ratio-wrap');
    const subRatioEl = el('h-sum-sub-ratio');
    if (!sumTokensEl || !sumCostEl) return;

    const win = computeTimelineWindow();
    const todayStr = formatLocalYmd(win.today);
    const costAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, dateKeys, activeCostModel, {
      mode: activeCostMode,
      todayStr
    });

    sumTokensEl.textContent = `${fmtYi(costAgg.totalTokens)} Tokens`;
    sumCostEl.textContent = `≈ $${costAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(costAgg.totalCostUSD)}`;
    sumDailyAvgEl.textContent = `$${costAgg.dailyAverageUSD.toFixed(2)}`;
    sumActiveAvgEl.textContent = `$${costAgg.activeDailyAverageUSD.toFixed(2)} (${costAgg.activeDays}天)`;

    if ((viewType === 'monthly' || viewType === 'yearly') && subRatioWrapEl && subRatioEl) {
      const plan = resolveEffectivePlanStatus(ANTIGRAVITY_TOKEN_DATA.planStatus, ANTIGRAVITY_TOKEN_DATA.customPlanSettings);
      const rawPaidVal = plan.actualPricePaid ?? plan.pricePaid ?? plan.officialPriceMonthly ?? null;
      const isAnnualPlan = String(plan.billingCycle || '').includes('年');
      const paidVal = (rawPaidVal !== null && isAnnualPlan) ? (rawPaidVal / 12) : rawPaidVal;
      const isZeroCost = plan.isZeroExtraCost || paidVal === 0;
      if (!isZeroCost && paidVal > 0 && costAgg.totalCostUSD > 0) {
        const subMonthlyUSD = plan.currency === 'USD' ? paidVal : (plan.actualPricePaidCNY ? (isAnnualPlan ? plan.actualPricePaidCNY / 12 : plan.actualPricePaidCNY) / 6.72 : paidVal);
        if (subMonthlyUSD > 0) {
          const ratio = (costAgg.totalCostUSD / (viewType === 'yearly' ? subMonthlyUSD * 12 : subMonthlyUSD)).toFixed(1);
          subRatioEl.textContent = `${ratio}x 回本`;
          subRatioWrapEl.style.display = 'inline-flex';
        } else {
          subRatioWrapEl.style.display = 'none';
        }
      } else {
        subRatioWrapEl.style.display = 'none';
      }
    } else if (subRatioWrapEl) {
      subRatioWrapEl.style.display = 'none';
    }
  }

  function renderHeatmapMonthly() {
    const box = el('h-monthly-box');
    if (!box) return;
    box.replaceChildren();

    const scrollBox = el('h-scroll-box') || box.parentElement;
    const rect = scrollBox && typeof scrollBox.getBoundingClientRect === 'function' ? scrollBox.getBoundingClientRect() : null;
    const W = (rect && rect.width > 200) ? Math.floor(rect.width - 16) : 670;
    const H = 95;

    const scale = getEffectiveHeatmapScale();
    const win = computeTimelineWindow();
    const today = win.today;
    const todayKey = formatLocalYmd(today);

    // 计算当前所选月 (按 heatMonthOffset 自然月偏移)
    const targetDate = new Date(today.getFullYear(), today.getMonth() + heatMonthOffset, 1);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    const gap = 5;
    let bestR = 1, bestC = daysInMonth, bestS = 0;
    for (let r = 1; r <= 7; r++) {
      const c = Math.ceil(daysInMonth / r);
      const s = Math.min((W - (c - 1) * gap) / c, (H - (r - 1) * gap) / r);
      if (s > bestS) {
        bestS = s;
        bestR = r;
        bestC = c;
      }
    }
    bestS = Math.floor(bestS);
    const showDayNum = bestS >= 22;

    const grid = document.createElement('div');
    grid.className = 'heat-month-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${bestC}, ${bestS}px)`;
    grid.style.gridAutoRows = `${bestS}px`;
    grid.style.gap = `${gap}px`;
    grid.style.justifyContent = 'center';
    grid.style.alignContent = 'center';
    grid.style.height = `${H}px`;

    const dateKeys = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(targetYear, targetMonth, day);
      const k = formatLocalYmd(d);
      dateKeys.push(k);
      const isFuture = d.getTime() > today.getTime();
      const isToday = k === todayKey;
      const rec = ANTIGRAVITY_TOKEN_DATA.dailyMap[k];
      const tokens = rec ? rec.total : 0;
      const lvl = getLvl(tokens);

      const cell = document.createElement('div');
      cell.className = `heat-month-cell heat-cell lvl-${lvl}${isFuture ? ' is-future' : ''}${isToday ? ' is-today' : ''}`;
      cell.style.width = `${bestS}px`;
      cell.style.height = `${bestS}px`;
      cell.style.backgroundColor = scale[lvl];
      cell.setAttribute('data-date', k);
      cell.setAttribute('data-tokens', String(tokens));

      if (showDayNum) {
        const numSpan = document.createElement('span');
        numSpan.className = 'heat-month-cell-num';
        numSpan.textContent = String(day);
        cell.appendChild(numSpan);
      }

      const showPop = () => {
        const costInfo = getDailyModelCost(rec, k, activeCostModel, { mode: activeCostMode });
        const costStr = costInfo.costUSD > 0 ? ` · ≈ $${costInfo.costUSD.toFixed(2)}${formatUsdSecondaryParen(costInfo.costUSD)}` : '';
        heatPopDate.textContent = `${targetYear}年${targetMonth + 1}月${day}日${isToday ? '（今日）' : ''}`;
        heatPopVal.textContent = tokens > 0 ? `${fmtYi(tokens)} Tokens${costStr}` : (isFuture ? '未来日期（待产生记录）' : '0 Tokens');
        if (rec) {
          heatPopDet.innerHTML = `
            <div class="pop-det-col"><span class="pop-det-val">Prompt: ${fmtYi(rec.input)}</span><span class="pop-det-trans">提示词</span></div>
            <div class="pop-det-col"><span class="pop-det-val">Output: ${fmtYi(rec.output)}</span><span class="pop-det-trans">输出</span></div>
            <div class="pop-det-col"><span class="pop-det-val">Cache: ${fmtYi(rec.cache)}</span><span class="pop-det-trans">缓存</span></div>
          `.trim();
          heatPopDet.style.display = 'flex';
        } else {
          heatPopDet.style.display = 'none';
        }
        const r = cell.getBoundingClientRect();
        positionHeatPopover(r.left + r.width / 2, r.top - 6);
      };

      cell.addEventListener('mouseenter', showPop);
      cell.addEventListener('mouseleave', hidePopover);
      cell.addEventListener('click', showPop);

      grid.appendChild(cell);
    }

    box.appendChild(grid);
    updateSummaryBar('monthly', dateKeys);
  }

  function renderHeatmapYearly() {
    const box = el('h-yearly-box');
    if (!box) return;
    box.replaceChildren();

    const scrollBox = el('h-scroll-box') || box.parentElement;
    const rect = scrollBox && typeof scrollBox.getBoundingClientRect === 'function' ? scrollBox.getBoundingClientRect() : null;
    const W = (rect && rect.width > 200) ? Math.floor(rect.width - 16) : 670;
    const H = 95;

    const scale = getEffectiveHeatmapScale();
    const win = computeTimelineWindow();
    const today = win.today;
    const thisYear = today.getFullYear();
    const thisMonth = today.getMonth();
    const targetYear = thisYear + heatYearOffset;

    const monthsData = [];
    const allYearDates = [];
    let maxMonthTokens = 1;

    for (let m = 0; m < 12; m++) {
      const daysCount = new Date(targetYear, m + 1, 0).getDate();
      let mTokens = 0;
      const mDates = [];
      for (let d = 1; d <= daysCount; d++) {
        const dateObj = new Date(targetYear, m, d);
        const k = formatLocalYmd(dateObj);
        mDates.push(k);
        allYearDates.push(k);
        const rec = ANTIGRAVITY_TOKEN_DATA.dailyMap[k];
        if (rec) mTokens += rec.total;
      }
      const isCurrent = (targetYear === thisYear && m === thisMonth);
      const isFuture = (targetYear > thisYear || (targetYear === thisYear && m > thisMonth));
      if (!isFuture && mTokens > maxMonthTokens) {
        maxMonthTokens = mTokens;
      }
      monthsData.push({
        monthIndex: m,
        monthName: `${m + 1}月`,
        tokens: mTokens,
        dates: mDates,
        isCurrent,
        isFuture
      });
    }

    const createSvgNode = tag => {
      if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
        return document.createElementNS('http://www.w3.org/2000/svg', tag);
      }
      return document.createElement(tag);
    };

    const svg = createSvgNode('svg');
    svg.setAttribute('class', 'heat-yearly-svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));

    const Rmin = 6;
    const Rmax = 24;
    const colW = W / 12;
    const cy = 42;

    let peakMonthIndex = -1;
    let peakTokens = 0;
    monthsData.forEach(item => {
      if (!item.isFuture && item.tokens > peakTokens) {
        peakTokens = item.tokens;
        peakMonthIndex = item.monthIndex;
      }
    });

    monthsData.forEach((item, idx) => {
      const cx = colW * idx + colW / 2;
      const g = createSvgNode('g');
      g.setAttribute('class', 'heat-yearly-bubble-group');
      g.style.animationDelay = `${idx * 20}ms`;

      let radius = Rmin;
      if (!item.isFuture && item.tokens > 0) {
        const ratio = Math.sqrt(item.tokens / maxMonthTokens);
        radius = Rmin + ratio * (Rmax - Rmin);
      }

      const lvl = item.isFuture ? 0 : getLvlForRange(item.tokens, 'month', maxMonthTokens);
      const fillCol = item.isFuture ? 'transparent' : (scale[lvl] || scale[0]);

      const circle = createSvgNode('circle');
      circle.setAttribute('class', 'bubble-main');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', fillCol);
      circle.setAttribute('stroke', item.isFuture ? 'var(--ag-btn-border)' : (item.monthIndex === peakMonthIndex ? 'var(--ag-text-primary)' : 'var(--ag-border-subtle)'));
      circle.setAttribute('stroke-width', item.monthIndex === peakMonthIndex ? '2' : '1');

      if (item.isFuture) {
        circle.setAttribute('stroke-dasharray', '2,2');
      }

      g.appendChild(circle);

      if (item.isCurrent) {
        const activeRing = createSvgNode('circle');
        activeRing.setAttribute('cx', String(cx));
        activeRing.setAttribute('cy', String(cy));
        activeRing.setAttribute('r', String(radius + 4));
        activeRing.setAttribute('fill', 'none');
        activeRing.setAttribute('stroke', 'var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))');
        activeRing.setAttribute('stroke-width', '1.5');
        activeRing.setAttribute('stroke-dasharray', '3,3');
        g.appendChild(activeRing);
      }

      if (item.monthIndex === peakMonthIndex && item.tokens > 0) {
        const peakBadge = createSvgNode('text');
        peakBadge.setAttribute('x', String(cx));
        peakBadge.setAttribute('y', String(cy - radius - 5));
        peakBadge.setAttribute('text-anchor', 'middle');
        peakBadge.setAttribute('font-size', '10.5');
        peakBadge.setAttribute('font-weight', '600');
        peakBadge.setAttribute('fill', 'var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))');
        peakBadge.textContent = '峰值';
        g.appendChild(peakBadge);
      }

      const text = createSvgNode('text');
      text.setAttribute('x', String(cx));
      text.setAttribute('y', String(H - 12));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('fill', item.isCurrent ? 'var(--ag-text-primary)' : 'var(--ag-text-muted)');
      text.setAttribute('font-weight', item.isCurrent ? '600' : '400');
      text.textContent = item.monthName;
      g.appendChild(text);

      const showPop = () => {
        const costAgg = calculateIntervalCost(ANTIGRAVITY_TOKEN_DATA.dailyMap, item.dates, activeCostModel, {
          mode: activeCostMode,
          todayStr: formatLocalYmd(win.today)
        });
        const costStr = costAgg.totalCostUSD > 0 ? ` · ≈ $${costAgg.totalCostUSD.toFixed(2)}${formatUsdSecondaryParen(costAgg.totalCostUSD)}` : '';
        heatPopDate.textContent = `${targetYear}年${item.monthName}${item.isCurrent ? '（进行中）' : (item.monthIndex === peakMonthIndex ? '（年度峰值）' : '')}`;
        heatPopVal.textContent = item.tokens > 0 ? `${fmtYi(item.tokens)} Tokens${costStr}` : (item.isFuture ? '未来月份（尚未产生用量）' : '0 Tokens');
        heatPopDet.innerHTML = `<span>月累计 · 折合日均 $${costAgg.dailyAverageUSD.toFixed(2)} (活跃 ${costAgg.activeDays} 天)</span>`;
        heatPopDet.style.display = 'block';

        const r = g.getBoundingClientRect ? g.getBoundingClientRect() : { left: cx, top: cy, width: radius * 2 };
        positionHeatPopover(r.left + (r.width || 0) / 2, r.top - 6);
      };

      g.addEventListener('mouseenter', showPop);
      g.addEventListener('mouseleave', hidePopover);
      g.addEventListener('click', showPop);

      svg.appendChild(g);
    });

    box.appendChild(svg);
    updateSummaryBar('yearly', allYearDates);
  }

  // 初始化首次使用日与时间轴显示并触发后台完整历史同步
  computeTimelineWindow();
  void syncTokenHistoryFromHost();

  // 统一生成徽章、悬浮提示与速览卡片的状态数据
  function resolveDisplayStatus(d, session) {
    const ec = d?.errorClassification;
    let kind = ec?.kind || (d?.exceeded ? 'context_overflow' : d?.network ? 'network_error' : d?.error ? 'unknown' : 'none');

    // 如果没有显示分类但存在明确标志
    if (d?.exceeded) kind = 'context_overflow';

    if (kind === 'context_overflow' || d?.exceeded) {
      const sLimit = d?.serviceLimit || ec?.serviceLimit;
      return {
        kind: 'context_overflow',
        badgeText: '超限',
        amountText: '服务端超限',
        keyBadgeText: '已超限',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 100% 已溢出',
        tipTitle: '上下文窗口（超限告警）：',
        tipPct: '100% 已用（已超出上限）',
        tipDetail: sLimit ? `已超上限，共 ${fmtBubbleToken(sLimit)} token` : '服务端已拒绝输入（超出容量上限）',
        statusText: `服务端已拒绝：输入超限${sLimit ? `（上限 ${short(sLimit)} tokens）` : ''}。本地估算不可靠，需精简或新建会话。`,
        keyTakeaway: `✖ 已超出服务端最大限制${sLimit ? `（${fmt(sLimit)} tokens）` : ''}，当前对话已被拒绝。需精简或新建会话。`,
        isError: true,
        isOverflow: true
      };
    }

    if (kind === 'quota_exhausted') {
      const pool = ec?.modelOrPool || d?.model || '当前模型';
      const resetStr = ec?.resetTimeZh ? `，预计将于 ${ec.resetTimeZh} 重置` : '';
      return {
        kind: 'quota_exhausted',
        badgeText: '额度耗尽',
        amountText: '额度耗尽',
        keyBadgeText: '额度耗尽',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 模型额度用尽，可切换模型',
        tipTitle: '模型额度（额度耗尽）：',
        tipPct: '当前模型配额已用尽',
        tipDetail: `${pool}额度已耗尽${resetStr}。可手动切换至其他可用模型`,
        statusText: `模型额度耗尽：${pool}额度已用尽${resetStr}。可手动切换至其他可用模型。`,
        keyTakeaway: `✖ ${pool}额度已耗尽${resetStr}。可手动切换至 Gemini 3.8 Flash 或其他可用模型继续对话。`,
        isError: true,
        isOverflow: false
      };
    }

    if (kind === 'rate_limited') {
      const retryStr = ec?.retryAfterSec ? `（建议等待 ${ec.retryAfterSec} 秒）` : '';
      return {
        kind: 'rate_limited',
        badgeText: '限流',
        amountText: '请求限流',
        keyBadgeText: '请求限流',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 触发频率限制，请稍候',
        tipTitle: '请求限制（请求过频）：',
        tipPct: '触发服务端频率限制（429）',
        tipDetail: `请求过于频繁${retryStr}，请稍候重试`,
        statusText: `请求频率限制：请求过于频繁，触发服务端限制（429）${retryStr}。稍候重试即可恢复。`,
        keyTakeaway: `⚠ 触发服务端请求频率限制（HTTP 429）${retryStr}，短时间内发送请求过多，稍候重试即可恢复。`,
        isError: true,
        isOverflow: false
      };
    }

    if (kind === 'network_error' || d?.network) {
      const cleanDiag = ec?.diagnostic || '连接中断或超时';
      return {
        kind: 'network_error',
        badgeText: '网络',
        amountText: '网络故障',
        keyBadgeText: '网络故障',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 连接异常，请检查网络',
        tipTitle: '网络连接（连接故障）：',
        tipPct: '网络连接失败或超时',
        tipDetail: `连接异常（${cleanDiag}）。请检查本地网络代理与连接`,
        statusText: `网络连接异常：${cleanDiag}。请检查本地网络代理与网络链路设置。`,
        keyTakeaway: `✖ 网络连接出现异常（${cleanDiag}）。请检查本地网络代理与链路状态。`,
        isError: true,
        isOverflow: false
      };
    }

    if (kind === 'auth_error') {
      return {
        kind: 'auth_error',
        badgeText: '认证',
        amountText: '认证失败',
        keyBadgeText: '认证异常',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 权限不足或登录异常',
        tipTitle: '账号权限（身份异常）：',
        tipPct: '身份认证失败或缺少权限',
        tipDetail: '身份认证失败或无权限访问，请检查账号登录状态',
        statusText: '身份认证失败或无访问权限，请检查账号登录状态或订阅权限。',
        keyTakeaway: '✖ 身份认证失败或无访问权限（401/403）。请检查账号登录状态或订阅权限。',
        isError: true,
        isOverflow: false
      };
    }

    if (kind === 'service_unavailable') {
      return {
        kind: 'service_unavailable',
        badgeText: '服务异常',
        amountText: '服务受限',
        keyBadgeText: '服务受限',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 服务端繁忙，请稍候',
        tipTitle: '服务端状态（服务受限）：',
        tipPct: '模型服务暂不可用或过载',
        tipDetail: '服务端暂时过载或维护中，请稍后重试',
        statusText: '模型服务暂不可用或处于高负载（503/Overloaded），请稍后重试。',
        keyTakeaway: '⚠ 服务端暂时不可用或处于高负载（503/Overloaded），请稍后重试。',
        isError: true,
        isOverflow: false
      };
    }

    if (kind === 'canceled') {
      return {
        kind: 'canceled',
        badgeText: '已取消',
        amountText: '请求取消',
        keyBadgeText: '已取消',
        pillClass: 'key-pill pill-muted',
        hoverExtra: ' · 用户中断请求',
        tipTitle: '请求状态（已取消）：',
        tipPct: '请求已被主动取消',
        tipDetail: '本次生成请求已由用户或系统主动取消',
        statusText: '本次生成请求已由用户或系统主动取消。',
        keyTakeaway: 'ℹ 本次生成请求已由用户或系统主动取消。',
        isError: false,
        isOverflow: false
      };
    }

    if (d?.error) {
      const diag = ec?.diagnostic || d.error;
      return {
        kind: 'unknown',
        badgeText: '待确认',
        amountText: '请求异常',
        keyBadgeText: '原因待确认',
        pillClass: 'key-pill pill-danger',
        hoverExtra: ' · 失败原因待确认',
        tipTitle: '请求状态（原因待确认）：',
        tipPct: '最近请求失败（原因未知）',
        tipDetail: `当前无法确认具体原因（${diag}）`,
        statusText: `最近请求遇到错误，当前无法独立确认具体原因（${diag}）。`,
        keyTakeaway: `✖ 最近请求遇到错误，当前无法独立确认具体原因（${diag}）。`,
        isError: true,
        isOverflow: false
      };
    }

    return {
      kind: 'none',
      badgeText: '',
      amountText: '',
      keyBadgeText: '',
      pillClass: 'key-pill pill-good',
      hoverExtra: '',
      tipTitle: '',
      tipPct: '',
      tipDetail: '',
      statusText: '',
      keyTakeaway: '',
      isError: false,
      isOverflow: false
    };
  }
  function updateRingAndBubble(d, session, pct, danger, stale, incomplete) {
    const ringFill = el('ring-fill');
    const tipTitle = el('ctx-tip-title');
    const tipPct = el('ctx-tip-pct');
    const tipDetail = el('ctx-tip-detail');

    // 区分常态颜色与高占用告警状态
    let occupancy = 'normal';
    if (danger || (pct != null && pct >= 90)) {
      occupancy = 'danger';
    } else if ((pct != null && pct >= 75) || stale) {
      occupancy = 'warn';
    }
    host.setAttribute('data-occupancy', occupancy);

    // 1. 圆环进度与未知容量状态表达（未知容量绝不画成 0% 或 100%）
    if (ringFill) {
      if (d?.exceeded) {
        ringFill.setAttribute('data-ring-state', 'exceeded');
        ringFill.setAttribute('stroke-dasharray', `${RING_CIRCUMFERENCE.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
        ringFill.style.opacity = '1';
      } else if (pct != null) {
        ringFill.setAttribute('data-ring-state', 'determinate');
        if (pct <= 0) {
          ringFill.setAttribute('stroke-dasharray', `0 ${RING_CIRCUMFERENCE.toFixed(2)}`);
          ringFill.style.opacity = '0';
        } else {
          const arcLen = Math.max(1.8, (Math.min(100, pct) / 100) * RING_CIRCUMFERENCE);
          ringFill.setAttribute('stroke-dasharray', `${arcLen.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
          ringFill.style.opacity = '1';
        }
      } else {
        // 容量未知 / 仅估算 / 尚未就绪：使用均匀虚线环段表示非确定比例，不画成 0% 空环或 100% 满环
        ringFill.setAttribute('data-ring-state', d?.estimated ? 'estimated' : 'unknown');
        ringFill.setAttribute('stroke-dasharray', '3.2 4.97');
        ringFill.style.opacity = '0.55';
      }
    }

    // 2. 悬停信息气泡三层文案（标题 — 使用比例 — 用量与容量）
    if (!tipTitle || !tipPct || !tipDetail) return;

    const disp = resolveDisplayStatus(d, session);
    if (disp.isError || disp.kind === 'canceled') {
      tipTitle.textContent = disp.tipTitle;
      tipPct.textContent = disp.tipPct;
      tipDetail.textContent = disp.tipDetail;
    } else if (stale && d?.actual != null && d?.budget) {
      const usedRound = Math.min(100, Math.max(0, Math.round((d.actual / d.budget) * 100)));
      const remRound = Math.max(0, 100 - usedRound);
      tipTitle.textContent = '上下文窗口（数据过期）：';
      tipPct.textContent = `${usedRound}% 已用（剩余 ${remRound}% · 统计延迟）`;
      tipDetail.textContent = `已用 ${fmtBubbleToken(d.actual)} token，共 ${fmtBubbleToken(d.budget)}`;
    } else if (stale) {
      tipTitle.textContent = '上下文窗口（数据过期）：';
      tipPct.textContent = '统计读取延迟（剩余未知）';
      tipDetail.textContent = session
        ? `会话估算 ≈ ${fmtBubbleToken(session.total.low)}–${fmtBubbleToken(session.total.high)} token`
        : '正在等待后台更新统计数据';
    } else if (d?.actual != null && d?.budget) {
      const rawPct = pct != null ? pct : (d.actual / d.budget) * 100;
      const usedRound = rawPct > 0 && rawPct < 1 ? 1 : Math.min(100, Math.max(0, Math.round(rawPct)));
      const remRound = Math.max(0, 100 - usedRound);
      if (rawPct >= 90) {
        tipTitle.textContent = '上下文窗口（高占用告警）：';
        tipPct.textContent = `${usedRound}% 已用（剩余 ${remRound}% · 接近上限）`;
      } else if (rawPct >= 75) {
        tipTitle.textContent = '上下文窗口（占用偏高）：';
        tipPct.textContent = `${usedRound}% 已用（剩余 ${remRound}% · 占用偏高）`;
      } else {
        tipTitle.textContent = '上下文窗口：';
        tipPct.textContent = `${usedRound}% 已用（剩余 ${remRound}%）`;
      }
      tipDetail.textContent = `已用 ${fmtBubbleToken(d.actual)} token，共 ${fmtBubbleToken(d.budget)}${incomplete ? '（含未知附件）' : ''}`;
    } else if (d?.actual != null && !d?.budget) {
      tipTitle.textContent = '上下文窗口：';
      tipPct.textContent = '容量未知（未返回上限）';
      tipDetail.textContent = `已用 ${fmtBubbleToken(d.actual)} token，总容量未知`;
    } else if (d?.estimated || d?.estimate != null) {
      tipTitle.textContent = '上下文窗口（本地估算）：';
      tipPct.textContent = '真实占比未知（仅估算）';
      tipDetail.textContent = `已用 ≈ ${fmtBubbleToken(d.estimate)} token${d.budget ? `，共 ${fmtBubbleToken(d.budget)}` : '，总容量未知'}`;
    } else if (session) {
      tipTitle.textContent = '上下文窗口（本地估算）：';
      tipPct.textContent = '等待请求统计（仅归档估算）';
      tipDetail.textContent = `会话累计 ≈ ${fmtBubbleToken(session.total.low)}–${fmtBubbleToken(session.total.high)} token`;
    } else {
      tipTitle.textContent = '上下文窗口：';
      tipPct.textContent = '数据尚未就绪';
      tipDetail.textContent = '正在读取当前会话上下文用量…';
    }

    if (state.tooltipOpen) positionContextTooltip();
  }

  function syncSpeedBadgeText() {
    const sp = state.latest?.speed;
    const bSpeed = el('badge-speed');
    const waitSvgWrap = el('badge-speed-wait-svg');
    const speedAmount = el('speed-amount');
    const overflowSpeedVal = el('overflow-speed-val');
    if (!speedAmount) return;
    const isCompact = state.layoutMode === 'compact';
    if (sp?.tps != null) {
      bSpeed?.removeAttribute?.('data-speed-phase');
      if (waitSvgWrap) waitSvgWrap.hidden = true;
      speedAmount.textContent = isCompact ? `${sp.tps}` : `${sp.tps} tok/s`;
      if (overflowSpeedVal) overflowSpeedVal.textContent = `${sp.tps} tok/s`;
    } else if (state.requestBusy) {
      bSpeed?.setAttribute?.('data-speed-phase', 'waiting');
      if (waitSvgWrap) waitSvgWrap.hidden = false;
      speedAmount.textContent = '';
      if (overflowSpeedVal) overflowSpeedVal.textContent = '计算中…';
    } else {
      bSpeed?.removeAttribute?.('data-speed-phase');
      if (waitSvgWrap) waitSvgWrap.hidden = true;
      speedAmount.textContent = isCompact ? '--' : '-- tok/s';
      if (overflowSpeedVal) overflowSpeedVal.textContent = '-- tok/s';
    }
  }

  // 渲染上下文与全局状态（无论在主页 / 还是会话页 /c/<id>，始终保持插件栏挂载与可用）
  function render() {
    host.hidden = false;
    host.setAttribute('data-has-session', state.route ? 'true' : 'false');
    ensureHostDocked();
    if (!state.route) {
      hideContextTooltip();
      const barFill = el('bar-fill');
      if (barFill) barFill.style.width = '0%';
      const badgePctVal = el('badge-pct-val');
      if (badgePctVal) badgePctVal.textContent = '--%';
      el('amount').textContent = '未打开会话';
      setHoverExtra(' · 点击查看或启动 CLI');
      syncSpeedBadgeText();
      el('badge-tokens').title = 'Token 用量一览（点击展开详情）';
      return;
    }
    renderSessionCost();

    const d = state.latest, session = state.scan?.session;
    const disp = resolveDisplayStatus(d, session);
    const stale = state.requestError || state.requestAt && Date.now() - state.requestAt > 20000;
    const incomplete = session?.unknownFiles > 0;
    const danger = disp.isError || d?.exceeded;

    let pct = null;
    if (d?.exceeded) {
      pct = 100;
    } else if (d?.percent != null && !danger && !stale) {
      pct = Math.min(100, Math.max(0, d.percent));
    } else if (d?.actual != null && d?.budget && !danger && !stale) {
      pct = Math.min(100, Math.max(0, (d.actual / d.budget) * 100));
    }

    const barColor = danger ? 'var(--ag-text-danger,#f87171)' : pct != null && pct >= 90 ? 'var(--ag-text-danger,#f87171)' : pct != null && pct >= 75 || stale || incomplete ? 'var(--ag-text-warn,#fbbf24)' : 'var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))';
    const tone = danger ? 'var(--ag-text-danger,#f87171)' : stale || incomplete || d?.estimated ? 'var(--ag-text-warn,#fbbf24)' : 'var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa))';
    host.style.setProperty('--tone', tone);
    host.style.setProperty('--bar-color', barColor);

    const barFill = el('bar-fill');
    if (barFill) barFill.style.width = pct != null ? `${pct}%` : (d?.exceeded ? '100%' : '0%');

    updateRingAndBubble(d, session, pct, danger, stale, incomplete);

    const status = disp.isError
      ? disp.statusText
      : stale ? '最近请求统计读取异常或延迟，不能判断剩余空间。'
      : state.scanError ? '全会话扫描未完成：' + state.scanError
      : incomplete ? `存在 ${session.unknownFiles} 个附件含未知内容；会话总量仍未计全，不能据此保证不会超限。`
      : d?.estimated ? '只有客户端估算，附件等内容可能未计全；当前请求真实占用未知。'
      : '请求用量与会话累计分别统计；会话 token 数始终为本地估算。';
    el('status').textContent = status;

    const corpus = session ? `会话${range(session.total)}${incomplete ? '＋未知' : ''}` : state.scanBusy ? '会话扫描中…' : '会话待扫描';

    const badgePctVal = el('badge-pct-val');
    if (disp.isError || disp.kind === 'canceled') {
      el('amount').textContent = disp.amountText;
      if (badgePctVal) badgePctVal.textContent = disp.badgeText;
      setHoverExtra(disp.hoverExtra);
    } else if (stale) {
      el('amount').textContent = '统计延迟';
      if (badgePctVal) badgePctVal.textContent = pct != null ? `${pct.toFixed(0)}%` : '--%';
      setHoverExtra(` · ${corpus}`);
    } else if (d?.actual != null) {
      const pctStr = pct != null ? ` (${pct.toFixed(0)}%)` : '';
      el('amount').textContent = `${short(d.actual)}${pctStr}`;
      if (badgePctVal) badgePctVal.textContent = pct != null ? `${pct.toFixed(0)}%` : '--%';
      const budgetStr = d?.budget ? ` / ${short(d.budget)}` : '';
      setHoverExtra(`${budgetStr} · ${corpus}`);
    } else {
      el('amount').textContent = '真实量未知';
      if (badgePctVal) badgePctVal.textContent = '--%';
      setHoverExtra(` · ${corpus}`);
    }

    el('badge-tokens').title = 'Token 用量一览（点击展开详情）';

    // 渲染输出速度 (统一使用 tok/s)
    const sp = d?.speed;
    const speedBadge = el('badge-speed');
    const speedHoverExtra = el('speed-hover-extra');
    syncSpeedBadgeText();
    if (speedBadge) {
      if (sp?.tps != null) {
        if (speedHoverExtra) {
          speedHoverExtra.textContent = `${sp.duration ? ` · ${sp.duration}s` : ''}${sp.outputTokens ? ` · ${short(sp.outputTokens)} tok` : ''}`;
        }
        speedBadge.title = `最新模型输出速度：${sp.tps} tok/s${sp.streamingTps ? ` (流式 ${sp.streamingTps} tok/s)` : ''}\n总耗时：${sp.duration || '—'}s (首字 ${sp.ttft || '—'}s + 流式 ${sp.streamingSec || '—'}s)\n本次产出：${fmt(sp.outputTokens)} tokens`;
      } else if (state.requestBusy) {
        if (speedHoverExtra) speedHoverExtra.textContent = '';
        speedBadge.title = '正在等待模型返回或计算生成指标…';
      } else {
        if (speedHoverExtra) speedHoverExtra.textContent = ' · 待生成';
        speedBadge.title = '模型输出速度与耗时 (tok/s)';
      }
    }

    if (el('key-summary')) {
      const keyBar = el('key-bar-fill');
      const keyBadge = el('key-badge');
      const keyUsed = el('key-used');
      const keyLimit = el('key-limit');
      const keyRemaining = el('key-remaining');
      const keyTakeaway = el('key-takeaway');

      if (keyBar) keyBar.style.width = pct != null ? `${pct}%` : (d?.exceeded ? '100%' : '0%');

      if (disp.isError || disp.kind === 'canceled') {
        if (keyBadge) {
          keyBadge.textContent = disp.keyBadgeText;
          keyBadge.className = disp.pillClass;
        }

        const usedTokenCount = d?.actual != null ? d.actual : (d?.used != null ? d.used : (d?.estimate != null ? d.estimate : (session?.total?.low ?? null)));
        const budgetTokenCount = d?.budget || (d?.serviceLimit ? d.serviceLimit : 512000);

        if (disp.isOverflow) {
          if (keyUsed) keyUsed.textContent = d.serviceLimit ? `>${short(d.serviceLimit)}` : '超限';
          if (keyLimit) keyLimit.textContent = d.serviceLimit ? short(d.serviceLimit) : short(budgetTokenCount);
          if (keyRemaining) keyRemaining.textContent = '0 (已溢出)';
        } else {
          // 非超限错误：保留已有上下文用量，标明其状态，不归零、不清空
          if (keyUsed) {
            keyUsed.textContent = usedTokenCount != null ? (d?.actual != null ? `${short(usedTokenCount)}${pct != null ? ` (${pct.toFixed(1)}%)` : ''}` : `约 ${short(usedTokenCount)} (估算)`) : '—';
          }
          if (keyLimit) keyLimit.textContent = budgetTokenCount ? short(budgetTokenCount) : '—';
          if (keyRemaining) {
            if (usedTokenCount != null && budgetTokenCount) {
              const rem = Math.max(0, budgetTokenCount - usedTokenCount);
              const remP = Math.max(0, 100 - (pct || ((usedTokenCount / budgetTokenCount) * 100)));
              keyRemaining.textContent = `${short(rem)} (${remP.toFixed(1)}%)`;
            } else {
              keyRemaining.textContent = '待确认';
            }
          }
        }
        if (keyTakeaway) keyTakeaway.textContent = disp.keyTakeaway;
      } else if (d?.actual != null && pct != null) {
        const limitVal = d.budget || 256000;
        const remainVal = Math.max(0, limitVal - d.actual);
        const remainPct = Math.max(0, 100 - pct);

        if (keyBadge) {
          if (d.cacheDropDetected) { keyBadge.textContent = '缓存脱落'; keyBadge.className = 'key-pill pill-danger'; }
          else if (pct >= 90) { keyBadge.textContent = '紧张'; keyBadge.className = 'key-pill pill-danger'; }
          else if (pct >= 75) { keyBadge.textContent = '偏高'; keyBadge.className = 'key-pill pill-warn'; }
          else if (d.actual >= 328000) { keyBadge.textContent = '建议压缩'; keyBadge.className = 'key-pill pill-warn'; }
          else { keyBadge.textContent = '正常'; keyBadge.className = 'key-pill pill-good'; }
        }
        if (keyUsed) keyUsed.textContent = `${short(d.actual)} (${pct.toFixed(1)}%)`;
        if (keyLimit) keyLimit.textContent = short(limitVal);
        if (keyRemaining) keyRemaining.textContent = `${short(remainVal)} (${remainPct.toFixed(1)}%)`;
        if (keyTakeaway) {
          const autoCompactOn = typeof localStorage === 'undefined' || localStorage.getItem('ag_suite_auto_compact') !== 'false';
          const autoCompactHint = autoCompactOn
            ? '（已开启 240K 自动压缩，本轮回答结束后将自动执行 /compact；可在套件设置关闭）'
            : '（可在套件设置中开启 240K 自动压缩）';
          if (d.cacheDropDetected) {
            keyTakeaway.textContent = `⚠ 缓存已脱落（命中率 ${twoDecimalFormat.format(d.cacheHitRate ?? 0)}%），本步全量重算 ${short(d.uncachedInput || d.input)} tokens！已使用 ${pct.toFixed(1)}%，极易引发 4~5 分钟卡顿与配额加速消耗，建议立即执行 /compact。${autoCompactHint}`;
          } else if (pct >= 90) {
            keyTakeaway.textContent = `⚠ 上下文已消耗 ${pct.toFixed(1)}%，仅剩约 ${short(remainVal)} tokens，接近预算上限！建议清理冗余上下文。`;
          } else if (pct >= 75) {
            keyTakeaway.textContent = `⚡ 已使用 ${pct.toFixed(1)}%，剩余可用空间约 ${short(remainVal)} tokens，注意大文件或长输出。`;
          } else if (d.actual >= 328000) {
            keyTakeaway.textContent = `⚡ 当前已达 ${short(d.actual)}（${pct.toFixed(1)}%，已超过 328K 风险线）；官方要到 512K 才压缩，一旦停顿超 3 分钟就会重新全量计算并卡顿 4~5 分钟，建议尽快执行 /compact。${autoCompactHint}`;
          } else if (d.actual >= 240000) {
            keyTakeaway.textContent = `✔ 当前用量正常（${pct.toFixed(1)}%，已达 ${short(d.actual)}），处于 240K+ 长上下文区间，提前执行 /compact 可避开 300K+ 缓存过期卡顿。${autoCompactHint}`;
          } else {
            keyTakeaway.textContent = `✔ 当前用量健康（${pct.toFixed(1)}%），剩余可用空间充足（约 ${short(remainVal)} tokens），可正常继续对话。`;
          }
        }
      } else {
        if (keyBadge) { keyBadge.textContent = d?.estimated ? '估算' : '读取中'; keyBadge.className = 'key-pill pill-muted'; }
        if (keyUsed) keyUsed.textContent = d?.estimate ? `约 ${short(d.estimate)}` : (session ? short(session.total.low) : '—');
        if (keyLimit) keyLimit.textContent = d?.budget ? short(d.budget) : '—';
        if (keyRemaining) keyRemaining.textContent = '待确认';
        if (keyTakeaway) keyTakeaway.textContent = 'ℹ 当前主要依赖本地估算或待服务端返回实际统计，暂不计算精确剩余空间。';
      }
    }

    if (el('speed-summary')) {
      const spBadge = el('speed-badge');
      const spVal = el('speed-val');
      const spDur = el('speed-duration');
      const spTtft = el('speed-ttft');
      const spTokens = el('speed-tokens');
      const spTakeaway = el('speed-takeaway');

      if (sp?.tps != null) {
        if (spBadge) {
          if (sp.tps >= 80) { spBadge.textContent = '极速'; spBadge.className = 'key-pill pill-good'; }
          else if (sp.tps >= 35) { spBadge.textContent = '流畅'; spBadge.className = 'key-pill pill-good'; }
          else if (sp.tps >= 15) { spBadge.textContent = '良好'; spBadge.className = 'key-pill pill-warn'; }
          else { spBadge.textContent = '偏慢'; spBadge.className = 'key-pill pill-danger'; }
        }
        if (spVal) spVal.textContent = `${sp.tps} tok/s`;
        if (spDur) spDur.textContent = sp.duration ? `${sp.duration}s` : '—';
        if (spTtft) spTtft.textContent = sp.ttft ? `${sp.ttft}s` : '—';
        if (spTokens) spTokens.textContent = `${fmt(sp.outputTokens)} tok`;
        if (spTakeaway) {
          const modelStr = d?.model ? `（${d.model}）` : '';
          const streamInfo = sp.streamingTps ? `，纯流式传输达 ${sp.streamingTps} tok/s` : '';
          if (sp.ttft != null && sp.ttft >= 30 && (d?.cacheDropDetected || (d?.uncachedInput || 0) >= 150000)) {
            spTakeaway.textContent = `⚠ 本步首字等待达 ${sp.ttft}s，因缓存失效触发了全量重算（输出 ${sp.tps} tok/s，总耗时 ${sp.duration}s${modelStr}），建议立即执行 /compact。`;
          } else {
            spTakeaway.textContent = `✔ 输出${sp.tps >= 35 ? '流畅' : '平稳'}（${sp.tps} tok/s${streamInfo}），总耗时 ${sp.duration}s 内生成 ${fmt(sp.outputTokens)} tokens${modelStr}。`;
          }
        }
      } else {
        if (spBadge) { spBadge.textContent = state.requestBusy ? '计算中' : '待生成'; spBadge.className = 'key-pill pill-muted'; }
        if (spVal) spVal.textContent = '—';
        if (spDur) spDur.textContent = '—';
        if (spTtft) spTtft.textContent = '—';
        if (spTokens) spTokens.textContent = '—';
        if (spTakeaway) spTakeaway.textContent = 'ℹ 等待当前或下一次模型输出完成，将自动计算精确输出速度 (tok/s)、首字延迟与总耗时。';
      }
    }

    el('model').textContent = d?.model?.startsWith('MODEL_PLACEHOLDER') ? '模型标识：' + d.model : d?.model || '未返回模型信息';
    el('request-status').textContent = d?.exceeded ? '输入超限（已失败）' : d?.network ? '网络故障（非超限）' : d?.error ? '已失败' : d?.status === 'reported' ? '已返回实际统计' : d?.status === 'estimated' ? '只有本地估算' : '等待统计，未确认执行状态';
    el('actual').textContent = d?.actual != null ? token(d.actual) : d?.exceeded ? `>${fmt(d.serviceLimit || 0)}（实际总数未返回）` : '真实用量未知';
    if (d?.exceeded && !d.serviceLimit) el('actual').textContent = '已超限；实际数值未知';
    el('estimate').textContent = d?.estimate ? `约 ${fmt(d.estimate)} · ${d.exceeded ? '已证实低估' : '仅供参考'}` : '未提供';
    el('budget').textContent = token(d?.budget);
    el('service-limit').textContent = d?.serviceLimit ? `${fmt(d.serviceLimit)}（仅该次错误证据）` : '本次没有服务端限制证据';
    el('percent').textContent = d?.percent != null && !danger && !stale ? `${d.percent.toFixed(1)}%（非 1M 总容量）` : '不提供安全余量百分比';
    el('session-total').textContent = session ? range(session.total) + (incomplete ? ' ＋ 未知内容' : '') : state.scanError ? '扫描未完成' : '扫描中…';
    el('characters').textContent = session ? fmt(session.total.chars) : '—';
    for (const name of ['user', 'assistant', 'thinking', 'tools', 'summaries']) el(name).textContent = session ? range(session.groups[name]) : '—';
    el('system').textContent = session ? range({ low: (session.groups.system?.low || 0) + (session.groups.definitions?.low || 0), high: (session.groups.system?.high || 0) + (session.groups.definitions?.high || 0) }) : '—';
    el('attachment-total').textContent = session ? range(session.attachmentTotal) + (incomplete ? ' ＋ 未知' : '') : '—';
    el('steps').textContent = session ? `${fmt(session.steps)} 条；${session.userMessages} 条用户消息／${session.assistantMessages} 条回复` : '尚未完成全量读取';
    el('coverage').textContent = session ? `${session.attachments.length} 个附件条目（${session.attachments.filter(f => f.source === 'user').length} 个上传、${session.attachments.filter(f => f.source === 'assistant').length} 个模型/工具输出）；${session.attachments.filter(f => f.chars > 0).length} 个已读到文本，${session.unknownFiles} 个含未计内容。${state.scanBusy ? ' 正在重新扫描…' : ''}${state.scanError ? ' 最近重扫失败，当前为旧结果：' + state.scanError : ''}` : state.scanError || '正在扫描整段归档，不依赖页面已加载的聊天条数。';
    el('updated').textContent = `请求统计 ${state.requestAt ? new Date(state.requestAt).toLocaleTimeString() : '未读取'} · 全量扫描 ${state.scan ? new Date(state.scan.scannedAt).toLocaleTimeString() : '未完成'}`;
    el('refresh').disabled = state.scanBusy;
  }

  function resolveSessionCsrfToken() {
    const direct = String(window.__APP_CONFIG__?.csrfToken || '').trim();
    if (direct) return direct;
    try {
      return String(localStorage.getItem('agy_session_csrf_token') || '').trim();
    } catch {
      return '';
    }
  }

  async function requestPoll(generation, id) {
    state.requestBusy = true;
    const startedAt = Date.now();
    const controller = new AbortController(); state.controllers.add(controller);
    const timeoutMs = state.count > 0 ? 12000 : 25000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const csrf = resolveSessionCsrfToken(); if (!csrf) throw new Error('后台尚未就绪');
      const offset = Math.max(0, state.count - 3);
      const response = await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': csrf }, body: JSON.stringify({ cascadeId: id, generatorMetadataOffset: offset, includeMessages: false }), signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); if (generation !== state.generation || state.disposed) return;
      const rows = data.generatorMetadata || [];
      state.count = rows.length ? offset + rows.length : 0;
      if (!state.sessionCallsMap) state.sessionCallsMap = new Map();
      const parsedCalls = [];
      for (let i = 0; i < rows.length; i++) {
        const call = parseGeneratorCall ? parseGeneratorCall(rows[i], id, 'desktop') : null;
        if (call && call.callId) {
          state.sessionCallsMap.set(call.callId, call);
          parsedCalls.push(call);
        }
      }
      state.sessionCalls = Array.from(state.sessionCallsMap.values());
      state.sessionCostTotal = state.sessionCalls.reduce((sum, c) => sum + (c.isPriced ? (c.costUSD || 0) : 0), 0);
      if (parsedCalls.length) {
        if (!state.reportedFinalCallIds) state.reportedFinalCallIds = new Set();
        if (!state.reportedFinalCallOutputs) state.reportedFinalCallOutputs = new Map();
        const callsToReport = [];
        for (const call of parsedCalls) {
          if (call && call.status === 'final' && call.callId) {
            const lastOutput = state.reportedFinalCallOutputs.get(call.callId);
            const currentOutput = call.outputTokens || 0;
            if (!state.reportedFinalCallIds.has(call.callId) || (lastOutput != null && currentOutput > lastOutput)) {
              callsToReport.push(call);
            }
          }
        }
        if (callsToReport.length) {
          for (const call of callsToReport) {
            state.reportedFinalCallIds.add(call.callId);
            state.reportedFinalCallOutputs.set(call.callId, call.outputTokens || 0);
          }
          void recordModelCallsRemote(callsToReport);
        }
      }
      let latestVal = null;
      let latestIdx = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        const value = summarize(rows[i]);
        if (value) { latestVal = withStepError(value, rows[i]); latestIdx = i; break; }
      }
      if (latestVal) {
        const hadPriorHighCache = rows.slice(0, Math.max(0, latestIdx)).some(r => {
          const s = summarize(r);
          return (s?.cached || 0) >= 50000;
        }) || (state.sessionCalls || []).slice(0, -1).some(c => (c?.cacheReadTokens || 0) >= 50000);
        const totalIn = Number(latestVal.input || 0);
        const uncachedIn = Number(latestVal.uncachedInput ?? Math.max(0, totalIn - Number(latestVal.cached || 0)));
        const hitRate = latestVal.cacheHitRate;
        latestVal.cacheDropDetected = Boolean(
          totalIn >= 150000 && hitRate != null && hitRate < 25 && (hadPriorHighCache || uncachedIn >= 240000)
        );
        latestVal.cacheCliffRisk = (latestVal.actual || 0) >= 328000
          ? 'critical'
          : ((latestVal.actual || 0) >= 240000 ? 'warn' : 'none');
        latestVal.runtimeBudget = latestVal.budget || null;
        try {
          const cp = window.__AGContextMeterSettings?.customPlan;
          if (cp && typeof cp === 'object') {
            let customLim = 0;
            if (cp.contextScopeMode !== 'per_model') {
              if (cp.contextUnifiedPreference?.mode === 'fixed' && Number(cp.contextUnifiedPreference.limitTokens) > 0) {
                customLim = Math.round(Number(cp.contextUnifiedPreference.limitTokens));
              }
            } else if (cp.contextPreferences && typeof cp.contextPreferences === 'object') {
              const cands = [latestVal.modelId, latestVal.modelRaw, latestVal.model].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
              for (const [k, ent] of Object.entries(cp.contextPreferences)) {
                if (!ent || ent.mode !== 'fixed' || !(Number(ent.limitTokens) > 0)) continue;
                const ek = [k, ent.modelId, ent.label].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
                if (cands.some(c => ek.includes(c))) { customLim = Math.round(Number(ent.limitTokens)); break; }
              }
            }
            if (customLim > 0) {
              latestVal.budget = customLim;
              if (latestVal.actual != null && !latestVal.exceeded) {
                latestVal.percent = (latestVal.actual / customLim) * 100;
              }
            }
          }
        } catch {}
        const matchedRow = latestIdx >= 0 ? rows[latestIdx] : null;
        let matchedMaxStepIdx = -1;
        const rawStepCandidates = Array.isArray(matchedRow?.stepIndices) && matchedRow.stepIndices.length > 0
          ? matchedRow.stepIndices
          : ((matchedRow?.stepIndex != null && matchedRow.stepIndex !== '') || (matchedRow?.step_index != null && matchedRow.step_index !== '')
            ? [matchedRow.stepIndex ?? matchedRow.step_index]
            : []);
        const validMatchedSteps = rawStepCandidates
          .filter((v) => v !== null && v !== '' && typeof v !== 'boolean')
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0);
        if (validMatchedSteps.length > 0) {
          matchedMaxStepIdx = Math.max(...validMatchedSteps);
          latestVal.stepCount = matchedMaxStepIdx + 1;
        }
        latestVal.speedStepIndex = latestVal.speed ? matchedMaxStepIdx : -1;
        latestVal.speedCreatedAtMs = 0;
        latestVal.speedUsageSignature = '';
        latestVal.metaMaxStepIndex = matchedMaxStepIdx;
        latestVal.exactUsageStepIndex = matchedMaxStepIdx;
        latestVal.updatedAtMs = Date.now();
        const pf = state.postCompactFloor;
        const curExact = typeof state.latest?.exactUsageStepIndex === 'number' ? state.latest.exactUsageStepIndex : -1;
        const pfExact = (pf && pf.route === id && typeof pf.latest?.exactUsageStepIndex === 'number') ? pf.latest.exactUsageStepIndex : -1;
        const knownExact = Math.max(curExact, pfExact);
        const knownStepCount = Math.max(Number(state.latest?.stepCount || 0), pf && pf.route === id ? Number(pf.latest?.stepCount || 0) : 0);
        const rowHasTrailingScanSteps = matchedMaxStepIdx >= 0 && matchedMaxStepIdx === knownExact && knownStepCount > matchedMaxStepIdx + 1;
        const rowProvenAfterCp = Boolean(
          pf && pf.route === id && matchedMaxStepIdx >= 0 && pf.lastCheckpointStepIdx >= 0 &&
          matchedMaxStepIdx > pf.lastCheckpointStepIdx && matchedMaxStepIdx >= knownExact && !rowHasTrailingScanSteps
        );
        const sameScannedUnindexed = matchedMaxStepIdx < 0 && state.scanGeneratorCount >= 0 && state.count <= state.scanGeneratorCount && Number(state.latest?.stepCount) > 0;
        const rowBehindKnownStep = (knownExact >= 0 && (matchedMaxStepIdx < 0 || matchedMaxStepIdx < knownExact || rowHasTrailingScanSteps)) || sameScannedUnindexed;
        const rowPredatesFloorCp = Boolean(pf && pf.route === id && matchedMaxStepIdx >= 0 && pf.lastCheckpointStepIdx >= 0 && matchedMaxStepIdx <= pf.lastCheckpointStepIdx);
        let adoptedLatest = false;
        if (rowBehindKnownStep) {
          if (pf && pf.route === id && state.count > pf.generatorCount) pf.generatorCount = state.count;
          if (pf && pf.route === id && pf.latest && pfExact >= curExact) state.latest = pf.latest;
        } else if (pf && pf.route === id && !rowProvenAfterCp && (rowPredatesFloorCp || (matchedMaxStepIdx < 0 && pf.lastCheckpointStepIdx >= 0 && knownExact > pf.lastCheckpointStepIdx) || (state.count <= pf.generatorCount && (latestVal.actual || 0) > ((pf.latest?.actual || 0) + 5000)))) {
          if ((rowPredatesFloorCp || matchedMaxStepIdx < 0) && state.count > pf.generatorCount) pf.generatorCount = state.count;
          state.latest = pf.latest;
        } else {
          if (pf && (rowProvenAfterCp || state.count > pf.generatorCount)) state.postCompactFloor = null;
          state.latest = latestVal;
          adoptedLatest = true;
        }
        if (adoptedLatest) state.requestAt = Date.now();
      } else {
        state.requestAt = Date.now();
      }
      state.requestError = '';
    } catch (e) {
      if (generation === state.generation && !state.disposed && !(state.requestAt > startedAt && state.latest)) {
        state.requestError = e.name === 'AbortError' ? '读取超时' : e.message;
      }
    }
    finally { clearTimeout(timeout); state.controllers.delete(controller); if (generation === state.generation && !state.disposed) { state.requestBusy = false; state.requestNext = Date.now() + (document.hidden ? 15000 : 3000); render(); } }
  }

  async function scan(generation, id, force = false) {
    state.scanBusy = true; render();
    try {
      let result;
      if (window.contextMeterAPI?.scan) result = await window.contextMeterAPI.scan(id, force);
      else if (window.__AGContextMeterLive) {
        const live = window.__AGContextMeterLive, controller = new AbortController(); state.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 180000);
        try { const response = await fetch(`http://127.0.0.1:${live.port}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token }, body: JSON.stringify({ id, force }), signal: controller.signal }); if (!response.ok) throw new Error(`扫描接口 HTTP ${response.status}`); result = await response.json(); }
        finally { clearTimeout(timeout); state.controllers.delete(controller); }
      } else throw new Error('完整重启 Antigravity 后启用附件扫描');
      if (generation !== state.generation || state.disposed) return;
      if (!result?.ok) throw new Error(result?.error || '扫描未返回有效结果');
      state.scan = result.data; state.scanError = '';
      const genCount = Number(result.data.generatorCount);
      if (Number.isFinite(genCount) && genCount > state.count) {
        state.count = genCount;
      }
      const scanLat = result.data.latest;
      const curExact = typeof state.latest?.exactUsageStepIndex === 'number' ? state.latest.exactUsageStepIndex : -1;
      const scanExact = typeof scanLat?.exactUsageStepIndex === 'number' ? scanLat.exactUsageStepIndex : -1;
      const scanCp = typeof scanLat?.lastCheckpointStepIdx === 'number' ? scanLat.lastCheckpointStepIdx : -1;
      const staleCompactScan = Boolean(
        scanLat?.compressionDetected && scanCp >= 0 && curExact > scanCp &&
        (scanExact < 0 || curExact > scanExact || (curExact === scanExact && !state.latest?.compressionDetected))
      );
      const scanBehindCur = scanExact >= 0 && curExact >= 0 && scanExact < curExact;
      const scanBlockedByFloor = Boolean(state.postCompactFloor && state.postCompactFloor.route === id && state.postCompactFloor.lastCheckpointStepIdx >= 0 && scanExact < 0 && !scanLat?.compressionDetected);
      if (!staleCompactScan && scanLat?.compressionDetected && scanLat?.postCompactAtGeneratorCount != null) {
        state.scanGeneratorCount = Number.isFinite(genCount) ? Math.max(genCount, state.count) : state.count;
        state.postCompactFloor = { route: id, generatorCount: scanLat.postCompactAtGeneratorCount, lastCheckpointStepIdx: scanCp, latest: scanLat };
        state.latest = scanLat;
        state.requestAt = result.data.scannedAt || Date.now();
        state.requestError = '';
      } else if (!staleCompactScan && !scanBehindCur && !scanBlockedByFloor && scanLat && (scanExact > curExact || result.data.scannedAt >= state.requestAt)) {
        state.scanGeneratorCount = Number.isFinite(genCount) ? Math.max(genCount, state.count) : state.count;
        if (state.postCompactFloor && state.postCompactFloor.route === id && scanExact > state.postCompactFloor.lastCheckpointStepIdx) state.postCompactFloor = null;
        state.latest = scanLat;
        state.requestAt = Math.max(state.requestAt, result.data.scannedAt || Date.now());
        state.requestError = '';
      }
      state.latest = withStepError(state.latest);
      renderFiles(result.data.session);
    } catch (e) { if (generation === state.generation && !state.disposed) state.scanError = e.message; }
    finally {
      if (generation === state.generation && !state.disposed) {
        state.scanBusy = false;
        state.scanNext = Date.now() + (document.hidden ? 60000 : (state.scanError && !state.scan ? 4000 : 20000));
        render();
      }
    }
  }

  let lastHistorySync = 0;
  function tick() {
    if (!state.disposed && !host.isConnected) {
      ensureHostDocked();
    } else if (!state.disposed) {
      enforceMarketplaceAvoidance();
    }
    const id = route();
    if (id !== state.route) {
      for (const controller of state.controllers) controller.abort(); state.controllers.clear(); state.generation++;
      if (state.sessionCallsMap) state.sessionCallsMap.clear();
      if (state.reportedFinalCallIds) state.reportedFinalCallIds.clear();
      if (state.reportedFinalCallOutputs) state.reportedFinalCallOutputs.clear();
      Object.assign(state, {
        route: id, count: 0, scanGeneratorCount: -1, latest: null, postCompactFloor: null, sessionCalls: [], sessionCostTotal: 0,
        requestAt: 0, requestError: '', requestBusy: false, requestNext: 0,
        scanBusy: false, scanNext: 0, scanError: '', scan: null,
        reportedFinalCallIds: state.reportedFinalCallIds || new Set(),
        reportedFinalCallOutputs: state.reportedFinalCallOutputs || new Map()
      });
      toggle(false); hideContextTooltip(); renderFiles(null); render();
      void syncTokenHistoryFromHost(false);
    }
    if (id && !state.requestBusy && Date.now() >= state.requestNext) void requestPoll(state.generation, id);
    if (id && !state.scanBusy && Date.now() >= state.scanNext) void scan(state.generation, id);
    if (Date.now() - lastHistorySync > 15000) {
      lastHistorySync = Date.now();
      void syncTokenHistoryFromHost(false);
    }
  }

  const timer = setInterval(tick, 500);
'use strict';
/**
 * Simplified Chinese (zh-CN) -> Traditional Chinese (zh-TW, Taiwan terminology) converter.
 * Zero external dependencies; single-pass longest-match phrase table + character fallback + bounded cache.
 */
(function (root) {
  if (!root) {
    root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  }

  const PHRASE_MAP = {
  "哪里": "哪裡",
  "这里": "這裡",
  "导航面包屑": "麵包屑導覽",
  "面包屑": "麵包屑",
  "左右并排布局": "左右並排版面設定",
  "布局": "排版",
  "串口": "序列埠",
  "设备": "裝置",
  "設備": "裝置",
  "智能芯片": "智慧型方塊",
  "芯片": "晶片",
  "浏览器扩展": "瀏覽器擴充功能",
  "导航": "導覽",
  "導航": "導覽",
  "访问": "存取",
  "訪問": "存取",
  "访问我们": "造訪我們",
  "訪問我們": "造訪我們",
  "存储桶": "儲存桶",
  "存儲桶": "儲存桶",
  "连接方式": "連線方式",
  "电脑端": "電腦端",
  "手机远程": "手機遠端",
  "配对口令": "配對碼",
  "运行时": "執行環境",
  "软链": "符號連結",
  "自启": "自動啟動",
  "重试": "重試",
  "就绪": "就緒",
  "公网": "公開網路",
  "内网": "內部網路",
  "打印手机": "顯示手機",
  "免改盘": "免改包",
  "终端命令": "終端機指令",
  "重新加载": "重新載入",
  "检测连接": "偵測連線",
  "多路复用器": "多工器",
  "正则表达式": "正規表示式",
  "未检测到": "未偵測到",
  "自动默认": "自動預設",
  "配置文件": "設定檔",
  "命令提示符": "命令提示字元",
  "每条命令都需要审核": "每條指令都需要核准",
  "每条命令均需审批": "每條指令都需要核准",
  "执行敏感操作前先询问": "執行敏感動作前先詢問",
  "在执行敏感操作前询问": "執行敏感動作前先詢問",
  "对敏感操作请求授权许可": "執行敏感動作前需取得授權",
  "由安全智能体决定是否运行命令": "由安全 Agent 決定是否執行指令",
  "自动判断是否运行命令": "自動判斷是否執行指令",
  "自动决定是否运行命令": "自動判斷是否執行指令",
  "不受限制地运行所有命令": "不受限制地執行所有指令",
  "无限制运行所有命令": "不受限制地執行所有指令",
  "敏感操作": "敏感動作",
  "执行命令": "執行指令",
  "运行命令": "執行指令",
  "命令执行": "指令執行",
  "命令面板": "指令面板",
  "命令选择器": "指令選擇器",
  "命令状态": "指令狀態",
  "命令访问权限": "指令存取權限",
  "复制命令": "複製指令",
  "完整命令": "完整指令",
  "输入命令": "輸入指令",
  "搜索命令": "搜尋指令",
  "斜杠命令": "斜線指令",
  "子系统": "子系統",
  "文件夹": "資料夾",
  "复选框": "核取方塊",
  "下拉框": "下拉選單",
  "工具栏": "工具列",
  "侧边栏": "側邊欄",
  "状态栏": "狀態列",
  "标题栏": "標題列",
  "地址栏": "網址列",
  "活动栏": "活動列",
  "导航栏": "導覽列",
  "标签页": "分頁",
  "对话框": "對話方塊",
  "剪贴板": "剪貼簿",
  "快捷键": "快速鍵",
  "回车": "Enter",
  "回車": "Enter",
  "命令行": "命令列",
  "控制台": "主控台",
  "客户端": "用戶端",
  "桌面端": "桌面版",
  "移动端": "行動版",
  "网页端": "網頁版",
  "服务器端": "伺服器端",
  "服务器": "伺服器",
  "占位符": "預留位置",
  "通配符": "萬用字元",
  "分辨率": "解析度",
  "返回值": "回傳值",
  "字符串": "字串",
  "智能体": "Agent",
  "热力图": "熱度圖",
  "快捷提示词": "常用提示詞",
  "快捷操作栏": "常用工具列",
  "快捷按钮": "指令按鈕",
  "快捷指令": "常用指令",
  "快捷口令": "常用指令",
  "快捷方式": "捷徑",
  "快捷": "快速",
  "按点击付费": "按點擊付費",
  "点击": "點選",
  "日常高频": "日常常用",
  "追问对齐": "追問釐清",
  "全部对齐": "全部釐清",
  "提炼经验": "歸納經驗",
  "提炼": "歸納",
  "深度攻坚": "深度解題",
  "复杂攻坚": "複雜任務",
  "攻坚": "突破",
  "定时任务": "排程任務",
  "定时计划": "排程計畫",
  "定时巡检": "排程巡檢",
  "定时轮询": "排程輪詢",
  "定时运行": "排程執行",
  "定时后台": "背景排程",
  "定时器": "計時器",
  "5h 滚动窗口": "5 小時限額",
  "5h 滚动": "5 小時限額",
  "滚动窗口": "分時段",
  "滚动条": "捲軸",
  "滚动": "捲動",
  "周边": "周邊",
  "周邊": "周邊",
  "周围": "周圍",
  "周圍": "周圍",
  "周全": "周全",
  "周密": "周密",
  "周到": "周到",
  "圆周": "圓周",
  "圓周": "圓周",
  "周长": "周長",
  "周長": "周長",
  "周知": "周知",
  "免审核": "免審核",
  "待审批": "待審核",
  "二进制": "二進位",
  "自定义": "自訂",
  "只读": "唯讀",
  "仅限": "僅限",
  "仅显示": "僅顯示",
  "仅用于": "僅用於",
  "默认值": "預設值",
  "初始化": "初始化",
  "上下文": "上下文",
  "响应式": "響應式",
  "高危": "高風險",
  "审批": "審核",
  "菜单": "選單",
  "弹窗": "彈出視窗",
  "浮窗": "懸浮視窗",
  "窗口": "視窗",
  "屏幕": "螢幕",
  "鼠标": "滑鼠",
  "图标": "圖示",
  "角标": "徽章",
  "标签": "標籤",
  "书签": "書籤",
  "字体": "字型",
  "内存": "記憶體",
  "缓存": "快取",
  "软件": "軟體",
  "硬件": "硬體",
  "文档": "文件",
  "文件": "檔案",
  "默认": "預設",
  "设置": "設定",
  "配置": "設定",
  "终端": "終端機",
  "重启": "重新啟動",
  "刷新": "重新整理",
  "卸载": "解除安裝",
  "新建": "新增",
  "添加": "新增",
  "保存": "儲存",
  "加载": "載入",
  "导入": "匯入",
  "导出": "匯出",
  "搜索": "搜尋",
  "查找": "尋找",
  "替换": "取代",
  "撤销": "復原",
  "重置": "重設",
  "清空": "清理",
  "清除": "清理",
  "过滤": "篩選",
  "拖拽": "拖曳",
  "粘贴": "貼上",
  "拷贝": "複製",
  "复制": "複製",
  "重复": "重複",
  "复杂": "複雜",
  "复用": "重複使用",
  "回复": "回覆",
  "恢复": "恢復",
  "复原": "復原",
  "复核": "複核",
  "复盘": "覆盤",
  "复现": "重現",
  "修复": "修復",
  "支持": "支援",
  "兼容": "相容",
  "自定义": "自訂",
  "数据": "資料",
  "元数据": "中繼資料",
  "调用": "呼叫",
  "连接器": "連接器",
  "连接": "連線",
  "创建": "建立",
  "响应式": "響應式",
  "响应": "回應",
  "内置": "內建",
  "全局": "全域",
  "本地": "本機",
  "本机": "本機",
  "远程": "遠端",
  "远端": "遠端",
  "后台": "背景",
  "前台": "前景",
  "实时": "即時",
  "异步": "非同步",
  "并发送": "並傳送",
  "并发布": "並發布",
  "并发现": "並發現",
  "并发展": "並發展",
  "并发起": "並發起",
  "并发": "並行",
  "合并": "合併",
  "并行": "平行",
  "并排": "並排",
  "通过": "透過",
  "用户": "使用者",
  "登录": "登入",
  "注销": "登出",
  "账号": "帳號",
  "账户": "帳戶",
  "链接": "連結",
  "视频": "影片",
  "音频": "音訊",
  "图像": "影像",
  "文本": "文字",
  "字符": "字元",
  "字节": "位元組",
  "信息": "資訊",
  "消息": "訊息",
  "反馈": "回饋",
  "交互": "互動",
  "崩溃": "當機",
  "卡死": "卡住",
  "报错": "錯誤",
  "超时": "逾時",
  "端口": "連接埠",
  "域名": "網域",
  "协议": "通訊協定",
  "网络": "網路",
  "带宽": "頻寬",
  "磁盘": "磁碟",
  "硬盘": "硬碟",
  "插件": "外掛",
  "汉化": "中文化",
  "代码": "程式碼",
  "项目": "專案",
  "仓库": "儲存庫",
  "归档": "封存",
  "运行": "執行",
  "调试": "除錯",
  "今天想构建什么？": "今天想打造什麼？",
  "构建": "建置",
  "组件": "元件",
  "模块": "模組",
  "依赖": "相依套件",
  "变量": "變數",
  "常量": "常數",
  "函数": "函式",
  "接口": "介面",
  "数组": "陣列",
  "对象": "物件",
  "布尔": "布林",
  "回调": "回呼",
  "进程": "處理程序",
  "處理程序": "處理程序",
  "线程": "執行緒",
  "队列": "佇列",
  "缩进": "縮排",
  "后缀": "副檔名",
  "套餐方案": "方案",
  "套餐": "方案",
  "概览": "總覽",
  "积分": "點數",
  "润色": "潤飾",
  "剩余": "剩餘",
  "占用": "佔用",
  "兜底": "備援",
  "启用": "啟用",
  "启动": "啟動",
  "开启": "開啟",
  "禁用": "停用",
  "地址": "位址",
  "网址": "網址",
  "打印": "列印",
  "检测": "偵測",
  "校验": "驗證",
  "渲染": "算繪",
  "高亮": "醒目提示",
  "折叠": "摺疊",
  "计划": "計畫",
  "脚本": "指令碼",
  "程序": "程式",
  "内核": "核心",
  "批注": "註解",
  "教程": "教學",
  "联系": "聯絡",
  "关系": "關係",
  "体系": "體系",
  "系统": "系統",
  "在线": "線上",
  "离线": "離線",
  "帮助": "說明",
  "定制": "客製",
  "制作": "製作",
  "录制": "錄製",
  "绘制": "繪製",
  "控制": "控制",
  "限制": "限制",
  "强制": "強制",
  "机制": "機制",
  "干预": "干預",
  "干預": "干預",
  "干扰": "干擾",
  "干擾": "干擾",
  "干净": "乾淨",
  "回滚": "還原",
  "邮箱": "電子郵件",
  "昵称": "暱稱",
  "头像": "大頭貼",
  "令牌": "權杖",
  "密钥": "金鑰",
  "汇总": "彙總",
  "游戏": "遊戲",
  "下游": "下游",
  "上游": "上游",
  "台币": "新台幣",
  "中国台湾": "台灣",
  "台湾": "台灣",
  "占位": "預留位置",
  "独占": "獨佔",
  "其余": "其餘",
  "多余": "多餘",
  "轻松": "輕鬆",
  "宽松": "寬鬆",
  "松开": "放開",
  "切换": "切換",
  "刷新并": "重新整理並",
  "当前": "目前",
  "里面": "裡面",
  "界面": "介面",
  "页面": "頁面",
  "面板": "面板",
  "桌面": "桌面",
  "下面": "下方",
  "上面": "上方",
  "后面": "後方",
  "前面": "前方",
  "全面": "全面",
  "方面": "方面",
  "浏览": "瀏覽",
  "浏览器": "瀏覽器",
  "编辑": "編輯",
  "编辑器": "編輯器",
  "评论": "留言",
  "发送": "傳送",
  "跳过": "略過",
  "暂停": "暫停",
  "继续": "繼續",
  "取消": "取消",
  "确定": "確定",
  "确认": "確認",
  "关闭": "關閉",
  "打开": "開啟",
  "删除": "刪除",
  "移除": "移除",
  "隐藏": "隱藏",
  "显示": "顯示",
  "展开": "展開",
  "收起": "收合",
  "收拢": "收合",
  "折叠态": "摺疊狀態",
  "同步": "同步",
  "上传": "上傳",
  "下载": "下載",
  "更新": "更新",
  "升级": "升級",
  "安装": "安裝",
  "权限": "權限",
  "隐私": "隱私",
  "安全": "安全",
  "异常": "異常",
  "失败": "失敗",
  "成功": "成功",
  "警告": "警告",
  "提示": "提示",
  "通知": "通知",
  "状态": "狀態",
  "统计": "統計",
  "分析": "分析",
  "历史": "歷史",
  "日历": "行事曆",
  "工作区": "工作區",
  "工作台": "工作台",
  "工作流": "工作流程",
  "工作流程": "工作流程",
  "任务": "任務",
  "会话": "工作階段",
  "对话": "對話",
  "聊天": "聊天",
  "标题": "標題",
  "内容": "內容",
  "详情": "詳細資訊",
  "列表": "清單",
  "表单": "表單",
  "按钮": "按鈕",
  "开关": "開關",
  "选项": "選項",
  "参数": "參數",
  "属性": "屬性",
  "格式": "格式",
  "样式": "樣式",
  "主题": "佈景主題",
  "配色": "配色",
  "强调色": "強調色",
  "浅色": "淺色",
  "深色": "深色",
  "暗色": "深色",
  "亮色": "淺色",
  "预览": "預覽",
  "草稿": "草稿",
  "快照": "快照",
  "提交": "提交",
  "分支": "分支",
  "差异": "差異",
  "冲突": "衝突",
  "拉取": "拉取",
  "推送": "推送",
  "克隆": "複製",
  "模型": "模型",
  "推理": "推理",
  "思考": "思考",
  "额度": "額度",
  "配额": "配額",
  "订阅": "訂閱",
  "费用": "費用",
  "价格": "價格",
  "汇率": "匯率",
  "货币": "貨幣",
  "国家": "國家",
  "地区": "地區",
  "语言": "語言",
  "简体中文": "簡體中文",
  "繁体中文": "繁體中文",
  "英文": "英文",
  "原文": "原文",
  "译文": "譯文",
  "翻译": "翻譯",
  "词典": "詞典",
  "词库": "詞庫",
  "日志": "日誌",
  "记录": "記錄",
  "规则": "規則",
  "策略": "策略",
  "模式": "模式",
  "档位": "等級",
  "级别": "層級",
  "阈值": "門檻值",
  "上限": "上限",
  "下限": "下限",
  "速率": "速率",
  "速度": "速度",
  "延迟": "延遲",
  "耗时": "耗時",
  "时长": "時間長度",
  "分钟": "分鐘",
  "小时": "小時",
  "秒": "秒",
  "毫秒": "毫秒",
  "自动": "自動",
  "手动": "手動",
  "批量": "批次",
  "单次": "單次",
  "全局脚本": "全域指令碼",
  "环境变量": "環境變數",
  "代理": "代理",
  "隧道": "通道",
  "扫码": "掃碼",
  "二维码": "QR Code",
  "蓝牙": "藍牙",
  "触控": "觸控",
  "辅助功能": "輔助使用",
  "系统设置": "系統設定",
  "偏好设置": "偏好設定",
  "常见": "常見",
  "推荐": "推薦",
  "必开": "必開",
  "可选": "選用",
  "其他": "其他",
  "未知": "未知",
  "暂无": "暫無",
  "未提供": "未提供",
  "未填写": "未填寫",
  "已启用": "已啟用",
  "已停用": "已停用",
  "已关闭": "已關閉",
  "已保存": "已儲存",
  "已复制": "已複製",
  "已连接": "已連線",
  "未连接": "未連線",
  "正在": "正在",
  "完成": "完成",
  "准备": "準備",
  "知识工作": "日常辦公",
  "常规": "一般",
  "编程语言": "程式語言",
  "编程": "程式開發",
  "获取": "取得",
  "流式": "串流",
  "高级": "進階",
  "许可证": "授權條款",
  "凭据": "憑證",
  "性能": "效能",
  "全屏": "全螢幕",
  "激活": "啟用",
  "质量": "品質",
  "代码补全": "程式碼自動完成",
  "自动补全": "自動完成",
  "补全": "自動完成",
  "转写": "轉錄",
  "首选项": "偏好設定",
  "网关": "閘道",
  "录屏": "螢幕錄製",
  "光标": "游標",
  "剪切": "剪下",
  "集群": "叢集",
  "扩展程序": "擴充功能",
  "扩展市场": "擴充功能市集",
  "已安装扩展": "已安裝擴充功能",
  "扩展名": "副檔名",
  "取消固定": "取消釘選",
  "已固定": "已釘選",
  "固定此对话": "釘選此對話",
  "固定对话": "釘選對話",
  "仅固定会话": "僅釘選對話",
  "自动固定": "自動釘選",
  "排队消息": "佇列訊息",
  "排队": "佇列",
  "适用于代理模式": "適用於 Agent 模式",
  "没有正在运行的代理": "沒有正在執行的 Agent",
  "个代理正在运行": "個 Agent 正在執行",
  "将在代理完成后发送": "將在 Agent 完成後傳送",
  "局域网": "區域網路",
  "批准": "核准",
  "核准": "核准",
  "获准": "獲准",
  "獲准": "獲准",
  "准许": "准許",
  "准許": "准許",
  "允准": "允准",
  "准予": "准予",
  "不准": "不准",
  "周期": "週期",
  "新台币": "新台幣",
  "币种": "幣別",
  "按已返回用量估算": "依實際用量估算",
  "已返回用量": "實際回傳用量",
  "仅返回": "僅回傳",
  "未返回": "未回傳",
  "已返回": "已回傳",
  "模型返回": "模型回傳",
  "服务端返回": "伺服器回傳",
  "状态返回": "狀態回傳",
  "自动跟随当前模型": "自動跟隨目前模型",
  "侧栏：模型额度卡": "側欄：模型額度卡",
  "自定义本地字体": "自訂本機字型",
  "侧边栏模型额度": "側邊欄模型額度",
  "纯白 / 炭黑": "純白／炭黑",
  "顶栏配额胶囊": "頂欄配額膠囊",
  "当前模型组": "目前模型群組",
  "其他模型组": "其他模型群組",
  "固定仅显示": "固定僅顯示",
  "连续进度条": "連續進度條",
  "精简刻度": "精簡刻度",
  "进度细线": "進度細線",
  "迷你五段": "迷你五段",
  "迷你圆环": "迷你圓環",
  "双列横条": "雙列橫條",
  "路由死锁": "路由死鎖",
  "开启完整": "開啟完整",
  "额度全满": "額度全滿",
  "发起旁路提问，不打断主会话": "提出延伸問題，不中斷主要對話",
  "新建旁路提问": "新增延伸提問",
  "将截图添加到会话": "將截圖加入對話",
  "检查元素并添加评论": "檢查元素並新增留言",
  "退出元素检查模式": "離開元素檢查模式",
  "查看网站信息": "檢視網站資訊",
  "查看全部说明": "查閱完整說明",
  "查看更多结果": "顯示更多結果",
  "查看更多": "瀏覽更多",
  "查看全部": "顯示全部",
  "查看文档": "查閱文件",
  "查閱文件": "查閱文件",
  "查看发行说明": "閱讀發行說明",
  "查看套餐方案": "瀏覽方案",
  "查看方案": "瀏覽方案",
  "查看模型用量": "查詢模型用量",
  "查看用量": "查詢用量",
  "查看忙闲状态": "查詢忙閒狀態",
  "查看": "檢視",
  "订阅方案与档位覆盖 · 可手动指定套餐或保持自动检测": "手動指定訂閱方案與等級，或維持自動偵測",
  "订阅方案与档位覆盖": "指定訂閱方案與等級",
  "跟随当前登录账号": "依目前登入的帳號判定",
  "每周基础配额": "每週基本額度",
  "入门配额": "入門額度",
  "5h 基准配额": "5 小時基準額度",
  "Pro 配额": "Pro 額度",
  "搜索订阅方案": "搜尋訂閱方案",
  "未找到匹配的订阅方案": "找不到符合的訂閱方案",
  "子档未定": "尚未確認等級",
  "子档未知": "尚未確認等級",
  "待选子档": "請選擇 Ultra 等級",
  "已自动识别": "已自動辨識",
  "自动识别": "自動辨識",
  "未识别/默认": "無法辨識，使用預設值",
  "地区参考价": "地區參考價格",
  "套餐可用": "方案可用",
  "当前套餐无权访问该模型": "目前方案無法使用此模型",
  "请求中断": "請求已中斷",
  "最近一次生成请求已中断，无法仅凭此记录确定取消来源或当前请求状态": "最近一次生成請求已中斷。單憑這筆記錄無法判斷取消來源或目前的請求狀態",
  "共享池": "共用額度池",
  "取消置顶": "取消釘選",
  "五段格": "五段格",
  "双圆环": "雙圓環",
  "仪表盘": "儀表板",
  "纯文字": "純文字",
  "后重置": "後重設",
  "点阵": "點陣",
  "炭黑": "炭黑",
  "置顶": "釘選",
  "“": "「",
  "”": "」",
  "‘": "『",
  "’": "』"
};

  // 台灣介面文案依操作情境優先使用完整詞句。
  Object.assign(PHRASE_MAP, {
  "修改提交成功": "已修改提交",
  "自动展开代码更改概览": "自動顯示程式碼更改總覽",
  "当智能体完成回复生成时，自动展开代码更改概览工具栏。": "當 Agent 完成回覆生成時，自動顯示程式碼更改總覽工具列。",
  "提交成功": "已提交",
  "连接失败": "無法連線",
  "连接成功": "已連線",
  "展开": "顯示",
  "展开（按住 Shift 点击可展开下方所有层级）": "顯示（按住 Shift 點選可顯示下方所有層級）",
  "全部展开": "全部顯示",
  "全部展开文件夹": "全部顯示資料夾",
  "展开排队中的消息": "顯示佇列中的訊息",
  "展开子智能体": "顯示子 Agent",
  "添加插件失败。": "無法新增外掛。",
  "添加插件失败。请重试。": "無法新增外掛。請重試。",
  "修改提交失败": "無法修改提交",
  "归档工作区失败": "無法封存工作區",
  "构建失败": "無法建置",
  "提交失败": "無法提交",
  "继续操作失败": "無法繼續操作",
  "复制失败：": "無法複製：",
  "创建 CitC 克隆工作区失败": "無法建立 CitC 複製工作區",
  "创建终端失败": "無法建立終端機",
  "创建工作区失败。": "無法建立工作區。",
  "创建工作树失败": "無法建立工作樹",
  "删除会话失败": "無法刪除工作階段",
  "编辑失败": "無法編輯",
  "执行失败": "無法執行",
  "派生分支会话失败": "無法派生分支工作階段",
  "生成提交信息失败": "無法生成提交資訊",
  "打印文档失败": "無法列印文件",
  "打印文档失败：": "無法列印文件：",
  "继续执行失败": "無法繼續執行",
  "推送失败": "無法推送",
  "读取失败": "無法讀取",
  "读取文件内容失败": "無法讀取檔案內容",
  "重命名会话失败": "無法重命名工作階段",
  "重新验证斜杠命令失败：": "無法重新驗證斜線指令：",
  "保存项目失败": "無法儲存專案",
  "启动多候选对决模式失败": "無法啟動多候選對決模式",
  "启动会话失败": "無法啟動工作階段",
  "停止智能体失败": "無法停止 Agent ",
  "停止会话失败": "無法停止工作階段",
  "模型摘要生成失败": "無法模型摘要生成",
  "项目根目录": "專案最上層資料夾",
  "推送成功": "已推送",
  "收起": "摺疊",
  "收起部分资源": "摺疊部分資源",
  "认证成功，正在继续...": "已完成認證，正在繼續...",
  "已成功导入项目：": "已匯入專案：",
  "测试失败": "無法測試",
  "展开代码块": "顯示程式碼塊",
  "验证失败，请检查要求后重试。": "無法驗證，請檢查要求後重試。",
  "工作区已成功归档": "工作區已封存",
  "加载媒体失败": "無法載入媒體",
  "加载图片失败": "無法載入圖片",
  "上传 HTML 产物至 Google Drive 失败": "無法上傳 HTML 產物至 Google Drive ",
  "加载执行轨迹失败": "無法載入執行軌跡",
  "加载 MCP 服务失败": "無法載入 MCP 服務",
  "获取可用 MCP 服务失败：": "無法取得可用 MCP 服務：",
  "打开 MCP 配置文件失败": "無法開啟 MCP 設定檔",
  "保存项目设置失败：": "無法儲存專案設定：",
  "保存设置失败：": "無法儲存設定：",
  "删除智能体失败：": "無法刪除 Agent ：",
  "删除插件失败。": "無法刪除外掛。",
  "删除插件失败，请重试。": "無法刪除外掛，請重試。",
  "删除技能失败。": "無法刪除技能。",
  "删除技能失败，请重试。": "無法刪除技能，請重試。",
  "获取技能路径失败：": "無法取得技能路徑：",
  "加载自定义智能体失败": "無法載入自訂 Agent ",
  "加载 hooks.json 失败：": "無法載入 hooks.json ：",
  "加载更多插件失败，请重试。": "無法載入更多外掛，請重試。",
  "加载插件失败，请重试。": "無法載入外掛，請重試。",
  "加载插件失败": "無法載入外掛",
  "加载技能路径失败：": "無法載入技能路徑：",
  "加载自定义扩展失败，请重试。": "無法載入自訂擴展，請重試。",
  "打开智能体配置文件失败": "無法開啟 Agent 設定檔",
  "打开智能体配置失败：": "無法開啟 Agent 設定：",
  "打开插件配置文件失败": "無法開啟外掛設定檔",
  "移除智能体失败：": "無法移除 Agent ：",
  "移除插件失败：": "無法移除外掛：",
  "切换智能体状态失败：": "無法切換 Agent 狀態：",
  "切换插件状态失败：": "無法切換外掛狀態：",
  "切换插件状态失败，请重试。": "無法切換外掛狀態，請重試。",
  "更新智能体失败：": "無法更新 Agent ：",
  "启用后，当智能体完成回复生成时，“变更概览”工具栏将自动展开。": "啟用後，當 Agent 完成回覆生成時，「變更總覽」工具列將自動顯示。",
  "在组合包中收起": "在組合包中摺疊",
  "在插件中收起": "在外掛中摺疊",
  "检查此项目的许可证失败": "無法檢查此專案的授權條款",
  "切换全屏模式失败": "無法切換全螢幕模式",
  "解析设置失败，请修复后重启。": "無法解析設定，請修復後重新啟動。",
  "展开或收起语言列表": "顯示或摺疊語言清單",
  "创建自动化任务失败。": "無法建立自動化任務。",
  "在 Google Workspace 中收起": "在 Google Workspace 中摺疊",
  "收拢": "摺疊",
  "根目录": "最上層資料夾",
  "无项目关联": "尚未配對專案",
  "选择要关联的项目": "選擇要配對的專案",
  "当前对话未关联项目文件夹": "目前對話尚未配對專案資料夾",
  "未关联调用": "尚未配對呼叫",
  "此步骤未关联任何模型调用。": "此步驟尚未配對任何模型呼叫。",
  "使用 Antigravity 需要关联一个 Google Cloud 项目。": "使用 Antigravity 需要配對 Google Cloud 專案。",
  "没有可用于打开 MCP 配置文件的关联程序": "沒有可用來開啟 MCP 設定檔的程式",
  "此项目关联了其他工作区。": "此專案已配對其他工作區。",
  "projectOrder 必须是项目 ID 数组": "projectOrder 應為專案 ID 陣列",
  "projectOrder 包含非字符串的项目 ID": "projectOrder 包含非字串格式的專案 ID",
  "projectOrder 不能为空": "請至少提供一個專案 ID",
  "未提供有效的可排序项目 ID": "未提供有效的專案 ID，無法排序",
  "复制失败，请检查剪贴板权限": "無法複製，請檢查剪貼簿權限",
  "保存项目顺序失败": "無法儲存專案順序",
  "长消息与代码块折叠": "長訊息與程式碼區塊摺疊",
  "超长代码块与历史长回复自动折叠（保留开头摘要，生成中与最新回复保持展开），支持随时一键展开或收起": "自動摺疊過長的程式碼區塊與先前的長回覆（保留開頭摘要，生成中及最新回覆保持顯示），可隨時一鍵顯示或摺疊",
  "展开代码": "顯示程式碼",
  "收起代码": "摺疊程式碼",
  "展开消息": "顯示訊息",
  "收起消息": "摺疊訊息",
  "展开全文": "顯示全文",
  "收起长回复": "摺疊長回覆",
  "无效的本地路径": "本機路徑無效",
  "路径格式不合法": "路徑格式無效",
  "读取路径信息失败": "無法讀取路徑資訊",
  "打开系统文件管理器失败": "無法開啟系統檔案管理器",
  "项目文件": "專案檔案",
  "本会话变更与产物": "本次對話的變更與產出",
  "当前对话未绑定项目工作区目录，已拦截跨项目目录访问": "目前對話尚未配對專案工作區資料夾，已阻擋跨專案資料夾存取",
  "工作区根目录": "工作區最上層資料夾",
  "无效的工作区根目录路径": "工作區最上層資料夾路徑無效",
  "指定的工作区根目录不存在或无法访问": "指定的工作區最上層資料夾不存在或無法存取",
  "指定的工作区根不是目录": "指定的工作區最上層路徑不是資料夾",
  "指定的工作区根目录不属于当前会话所属项目": "指定的工作區最上層資料夾不屬於目前對話的專案",
  "目标目录超出当前所选工作区根目录边界，禁止静默跨工作区访问": "目標資料夾超出目前所選工作區最上層資料夾的範圍，禁止在未提示的情況下跨工作區存取"
});

  Object.assign(PHRASE_MAP, {
  "提交信息不能为空": "請填寫提交資訊",
  "启用插件 $1 失败": "無法啟用外掛 $1",
  "写入 MCP 配置失败：$1": "無法寫入 MCP 設定：$1",
  "加载技能失败：$1": "無法載入技能：$1",
  "扫描技能配置文件失败：$1": "無法掃描技能設定檔：$1",
  "加载第 $1 页失败：$2": "無法載入第 $1 頁：$2",
  "加载第 $1 页的文本图层失败：$2": "無法載入第 $1 頁的文字圖層：$2",
  "文本图层渲染失败：$1": "無法算繪文字圖層：$1",
  "初始化文本图层失败：$1": "無法初始化文字圖層：$1",
  "该项目共挂载": "此專案共掛載",
  "个工作区文件夹，请选择要浏览的目录": "個工作區資料夾，請選擇要瀏覽的目錄",
  "该对话不属于任何本地项目目录，或所属项目尚未挂载工作区文件夹": "此對話不屬於任何本機專案資料夾，或所屬專案尚未掛載工作區資料夾",
  "全部目录": "全部資料夾",
  "返回上级目录": "返回上一層資料夾",
  "上级": "上一層",
  "复制所在文件夹路径": "複製所在資料夾路徑",
  "复制含行号路径": "複製含行號的路徑",
  "文件路径操作菜单": "檔案路徑操作選單",
  "已复制所在文件夹": "已複製所在資料夾",
  "已复制含行号路径": "已複製含行號的路徑",
  "禁止访问敏感密钥或凭证目录": "禁止存取敏感金鑰或憑證資料夾",
  "未指定要浏览的项目工作区目录": "請指定要瀏覽的專案工作區資料夾",
  "禁止跨项目浏览非当前会话所属的工作区目录": "禁止跨專案瀏覽不屬於目前對話的工作區資料夾",
  "您的 Antigravity 使用情况将与所提供的项目关联。": "您的 Antigravity 使用情況將配對至所提供的專案。",
  "已关联项目": "已配對專案"
});

  const CHAR_MAP = {"周":"週","万":"萬","与":"與","丑":"醜","专":"專","业":"業","丛":"叢","东":"東","丝":"絲","丢":"丟","两":"兩","严":"嚴","丧":"喪","个":"個","丰":"豐","临":"臨","为":"為","丽":"麗","举":"舉","么":"麼","义":"義","乌":"烏","乐":"樂","乔":"喬","习":"習","乡":"鄉","书":"書","买":"買","乱":"亂","争":"爭","于":"於","亏":"虧","云":"雲","亘":"亙","亚":"亞","产":"產","亩":"畝","亲":"親","亵":"褻","亸":"嚲","亿":"億","仅":"僅","仆":"僕","从":"從","仑":"侖","仓":"倉","仪":"儀","们":"們","价":"價","众":"眾","优":"優","会":"會","伛":"傴","伞":"傘","伟":"偉","传":"傳","伣":"俔","伤":"傷","伥":"倀","伦":"倫","伧":"傖","伪":"偽","伫":"佇","体":"體","余":"餘","佣":"傭","佥":"僉","侠":"俠","侣":"侶","侥":"僥","侦":"偵","侧":"側","侨":"僑","侩":"儈","侪":"儕","侬":"儂","俣":"俁","俦":"儔","俨":"儼","俩":"倆","俪":"儷","俫":"倈","俭":"儉","债":"債","倾":"傾","偬":"傯","偻":"僂","偾":"僨","偿":"償","傥":"儻","傧":"儐","储":"儲","傩":"儺","儿":"兒","兑":"兌","兖":"兗","党":"黨","兰":"蘭","关":"關","兴":"興","兹":"茲","养":"養","兽":"獸","冁":"囅","内":"內","冈":"岡","册":"冊","写":"寫","军":"軍","农":"農","冯":"馮","冲":"衝","决":"決","况":"況","冻":"凍","净":"淨","凄":"淒","准":"準","凉":"涼","减":"減","凑":"湊","凛":"凜","几":"幾","凤":"鳳","凫":"鳧","凭":"憑","凯":"凱","击":"擊","凿":"鑿","刍":"芻","划":"劃","刘":"劉","则":"則","刚":"剛","创":"創","删":"刪","别":"別","刬":"剗","刭":"剄","刹":"剎","刽":"劊","刿":"劌","剀":"剴","剂":"劑","剐":"剮","剑":"劍","剥":"剝","剧":"劇","劝":"勸","办":"辦","务":"務","劢":"勱","动":"動","励":"勵","劲":"勁","劳":"勞","势":"勢","勋":"勳","勚":"勩","匀":"勻","匦":"匭","匮":"匱","区":"區","医":"醫","华":"華","协":"協","单":"單","卖":"賣","占":"佔","卢":"盧","卤":"鹵","卧":"臥","卫":"衛","却":"卻","厂":"廠","厅":"廳","历":"歷","厉":"厲","压":"壓","厌":"厭","厍":"厙","厐":"龎","厕":"廁","厘":"釐","厢":"廂","厣":"厴","厦":"廈","厨":"廚","厩":"廄","厮":"廝","县":"縣","叁":"叄","参":"參","叆":"靉","叇":"靆","双":"雙","发":"發","变":"變","叙":"敘","叠":"疊","叶":"葉","号":"號","叹":"嘆","叽":"嘰","后":"後","吓":"嚇","吕":"呂","吗":"嗎","吣":"唚","吨":"噸","听":"聽","启":"啟","吴":"吳","呐":"吶","呒":"嘸","呓":"囈","呕":"嘔","呖":"嚦","呗":"唄","员":"員","呙":"咼","呛":"嗆","呜":"嗚","咏":"詠","咙":"嚨","咛":"嚀","咝":"噝","咤":"吒","响":"響","哑":"啞","哒":"噠","哓":"嘵","哔":"嗶","哕":"噦","哗":"嘩","哙":"噲","哜":"嚌","哝":"噥","哟":"喲","唛":"嘜","唝":"嗊","唠":"嘮","唡":"啢","唢":"嗩","唤":"喚","啧":"嘖","啬":"嗇","啭":"囀","啮":"嚙","啰":"囉","啴":"嘽","啸":"嘯","喂":"餵","喷":"噴","喽":"嘍","喾":"嚳","嗫":"囁","嗳":"噯","嘘":"噓","嘤":"嚶","嘱":"囑","噜":"嚕","嚣":"囂","团":"團","园":"園","囱":"囪","围":"圍","囵":"圇","国":"國","图":"圖","圆":"圓","圣":"聖","圹":"壙","场":"場","坂":"阪","坏":"壞","块":"塊","坚":"堅","坛":"壇","坜":"壢","坝":"壩","坞":"塢","坟":"墳","坠":"墜","垄":"壟","垅":"壠","垆":"壚","垒":"壘","垦":"墾","垩":"堊","垫":"墊","垭":"埡","垯":"墶","垱":"壋","垲":"塏","垴":"堖","埘":"塒","埙":"塤","埚":"堝","埯":"垵","堑":"塹","堕":"墮","塆":"壪","墙":"牆","壮":"壯","声":"聲","壳":"殼","壶":"壺","壸":"壼","处":"處","备":"備","复":"復","够":"夠","头":"頭","夸":"誇","夹":"夾","夺":"奪","奁":"奩","奂":"奐","奋":"奮","奖":"獎","奥":"奧","妆":"妝","妇":"婦","妈":"媽","妩":"嫵","妪":"嫗","妫":"媯","姗":"姍","姹":"奼","娄":"婁","娅":"婭","娆":"嬈","娇":"嬌","娈":"孌","娱":"娛","娲":"媧","娴":"嫻","婳":"嫿","婴":"嬰","婵":"嬋","婶":"嬸","媪":"媼","媭":"嬃","嫒":"嬡","嫔":"嬪","嫱":"嬙","嬷":"嬤","孙":"孫","学":"學","孪":"孿","宁":"寧","宝":"寶","实":"實","宠":"寵","审":"審","宪":"憲","宫":"宮","宽":"寬","宾":"賓","寝":"寢","对":"對","寻":"尋","导":"導","寿":"壽","将":"將","尔":"爾","尘":"塵","尝":"嘗","尧":"堯","尴":"尷","尸":"屍","尽":"盡","层":"層","屃":"屓","屉":"屜","届":"屆","属":"屬","屡":"屢","屦":"屨","屿":"嶼","岁":"歲","岂":"豈","岖":"嶇","岗":"崗","岘":"峴","岙":"嶴","岚":"嵐","岛":"島","岭":"嶺","岽":"崬","岿":"巋","峃":"嶨","峄":"嶧","峡":"峽","峣":"嶢","峤":"嶠","峥":"崢","峦":"巒","崂":"嶗","崃":"崍","崄":"嶮","崭":"嶄","嵘":"嶸","嵚":"嶔","嵝":"嶁","巅":"巔","巩":"鞏","巯":"巰","币":"幣","帅":"帥","师":"師","帏":"幃","帐":"帳","帘":"簾","帜":"幟","带":"帶","帧":"幀","帮":"幫","帱":"幬","帻":"幘","帼":"幗","幂":"冪","干":"乾","并":"並","广":"廣","庄":"莊","庆":"慶","庐":"廬","庑":"廡","库":"庫","应":"應","庙":"廟","庞":"龐","废":"廢","庼":"廎","廪":"廩","开":"開","异":"異","弃":"棄","弑":"弒","张":"張","弥":"彌","弪":"弳","弯":"彎","弹":"彈","强":"強","归":"歸","当":"當","录":"錄","彟":"彠","彦":"彥","彷":"徬","彻":"徹","征":"徵","径":"徑","徕":"徠","忆":"憶","忏":"懺","忧":"憂","忾":"愾","怀":"懷","态":"態","怂":"慫","怃":"憮","怄":"慪","怅":"悵","怆":"愴","怜":"憐","总":"總","怼":"懟","怿":"懌","恋":"戀","恒":"恆","恳":"懇","恶":"惡","恸":"慟","恹":"懨","恺":"愷","恻":"惻","恼":"惱","恽":"惲","悦":"悅","悫":"愨","悬":"懸","悭":"慳","悮":"悞","悯":"憫","惊":"驚","惧":"懼","惨":"慘","惩":"懲","惫":"憊","惬":"愜","惭":"慚","惮":"憚","惯":"慣","愠":"慍","愤":"憤","愦":"憒","愿":"願","慑":"懾","慭":"憖","懑":"懣","懒":"懶","懔":"懍","戆":"戇","戋":"戔","戏":"戲","戗":"戧","战":"戰","戬":"戩","戯":"戱","户":"戶","扑":"撲","执":"執","扩":"擴","扪":"捫","扫":"掃","扬":"揚","扰":"擾","抚":"撫","抛":"拋","抟":"摶","抠":"摳","抡":"掄","抢":"搶","护":"護","报":"報","担":"擔","拟":"擬","拢":"攏","拣":"揀","拥":"擁","拦":"攔","拧":"擰","拨":"撥","择":"擇","挂":"掛","挚":"摯","挛":"攣","挜":"掗","挝":"撾","挞":"撻","挟":"挾","挠":"撓","挡":"擋","挢":"撟","挣":"掙","挤":"擠","挥":"揮","挦":"撏","挽":"輓","捝":"挩","捞":"撈","损":"損","捡":"撿","换":"換","捣":"搗","据":"據","掳":"擄","掴":"摑","掷":"擲","掸":"撣","掺":"摻","掼":"摜","揽":"攬","揾":"搵","揿":"撳","搀":"攙","搁":"擱","搂":"摟","搅":"攪","携":"攜","摄":"攝","摅":"攄","摆":"擺","摇":"搖","摈":"擯","摊":"攤","撄":"攖","撑":"撐","撵":"攆","撷":"擷","撸":"擼","撺":"攛","擞":"擻","攒":"攢","敌":"敵","敛":"斂","敩":"斆","数":"數","斋":"齋","斓":"斕","斗":"鬥","斩":"斬","断":"斷","无":"無","旧":"舊","时":"時","旷":"曠","旸":"暘","昙":"曇","昵":"暱","昼":"晝","昽":"曨","显":"顯","晋":"晉","晒":"曬","晓":"曉","晔":"曄","晕":"暈","晖":"暉","暂":"暫","暧":"曖","术":"術","朴":"樸","机":"機","杀":"殺","杂":"雜","权":"權","杆":"桿","杠":"槓","条":"條","来":"來","杨":"楊","杩":"榪","杰":"傑","松":"鬆","极":"極","构":"構","枞":"樅","枢":"樞","枣":"棗","枥":"櫪","枧":"梘","枨":"棖","枪":"槍","枫":"楓","枭":"梟","柜":"櫃","柠":"檸","柽":"檉","栀":"梔","栅":"柵","标":"標","栈":"棧","栉":"櫛","栊":"櫳","栋":"棟","栌":"櫨","栎":"櫟","栏":"欄","树":"樹","栖":"棲","样":"樣","栾":"欒","桠":"椏","桡":"橈","桢":"楨","档":"檔","桤":"榿","桥":"橋","桦":"樺","桧":"檜","桨":"槳","桩":"樁","梦":"夢","梼":"檮","梾":"棶","梿":"槤","检":"檢","棁":"梲","棂":"櫺","棱":"稜","椁":"槨","椟":"櫝","椠":"槧","椤":"欏","椭":"橢","楼":"樓","榄":"欖","榅":"榲","榇":"櫬","榈":"櫚","榉":"櫸","槚":"檟","槛":"檻","槟":"檳","槠":"櫧","横":"橫","樯":"檣","樱":"櫻","橥":"櫫","橱":"櫥","橹":"櫓","橼":"櫞","檩":"檁","欢":"歡","欤":"歟","欧":"歐","歼":"殲","殁":"歿","殇":"殤","残":"殘","殒":"殞","殓":"殮","殚":"殫","殡":"殯","殴":"毆","毁":"毀","毂":"轂","毕":"畢","毙":"斃","毡":"氈","毵":"毿","氇":"氌","气":"氣","氢":"氫","氩":"氬","氲":"氳","汇":"匯","汉":"漢","汤":"湯","汹":"洶","沉":"沈","沟":"溝","没":"沒","沣":"灃","沤":"漚","沥":"瀝","沦":"淪","沧":"滄","沨":"渢","沩":"溈","沪":"滬","泄":"洩","泞":"濘","泪":"淚","泶":"澩","泷":"瀧","泸":"瀘","泺":"濼","泻":"瀉","泼":"潑","泽":"澤","泾":"涇","洁":"潔","洒":"灑","洼":"窪","浃":"浹","浅":"淺","浆":"漿","浇":"澆","浈":"湞","浉":"溮","浊":"濁","测":"測","浍":"澮","济":"濟","浏":"瀏","浐":"滻","浑":"渾","浒":"滸","浓":"濃","浔":"潯","浕":"濜","涂":"塗","涌":"湧","涛":"濤","涝":"澇","涞":"淶","涟":"漣","涠":"潿","涡":"渦","涢":"溳","涣":"渙","涤":"滌","润":"潤","涧":"澗","涨":"漲","涩":"澀","淀":"澱","渊":"淵","渌":"淥","渍":"漬","渎":"瀆","渐":"漸","渑":"澠","渔":"漁","渖":"瀋","渗":"滲","温":"溫","湾":"灣","湿":"濕","溁":"濚","溃":"潰","溅":"濺","溆":"漵","溇":"漊","滗":"潷","滚":"滾","滞":"滯","滟":"灧","滠":"灄","满":"滿","滢":"瀅","滤":"濾","滥":"濫","滦":"灤","滨":"濱","滩":"灘","滪":"澦","漓":"灕","漤":"灠","潆":"瀠","潇":"瀟","潋":"瀲","潍":"濰","潜":"潛","潴":"瀦","澛":"瀂","澜":"瀾","濑":"瀨","濒":"瀕","灏":"灝","灭":"滅","灯":"燈","灵":"靈","灾":"災","灿":"燦","炀":"煬","炉":"爐","炖":"燉","炜":"煒","炝":"熗","点":"點","炼":"煉","炽":"熾","烁":"爍","烂":"爛","烃":"烴","烛":"燭","烟":"煙","烦":"煩","烧":"燒","烨":"燁","烩":"燴","烫":"燙","烬":"燼","热":"熱","焕":"煥","焖":"燜","焘":"燾","煴":"熅","爱":"愛","爷":"爺","牍":"牘","牦":"氂","牵":"牽","牺":"犧","犊":"犢","状":"狀","犷":"獷","犸":"獁","犹":"猶","狈":"狽","狝":"獮","狞":"獰","独":"獨","狭":"狹","狮":"獅","狯":"獪","狰":"猙","狱":"獄","狲":"猻","猃":"獫","猎":"獵","猕":"獼","猡":"玀","猪":"豬","猫":"貓","猬":"蝟","献":"獻","獭":"獺","玑":"璣","玙":"璵","玚":"瑒","玛":"瑪","玮":"瑋","环":"環","现":"現","玱":"瑲","玺":"璽","珐":"琺","珑":"瓏","珰":"璫","珲":"琿","琎":"璡","琏":"璉","琐":"瑣","琼":"瓊","瑶":"瑤","瑷":"璦","璎":"瓔","瓒":"瓚","瓮":"甕","瓯":"甌","电":"電","画":"畫","畅":"暢","畴":"疇","疖":"癤","疗":"療","疟":"瘧","疠":"癘","疡":"瘍","疬":"癧","疭":"瘲","疮":"瘡","疯":"瘋","疱":"皰","疴":"痾","痈":"癰","痉":"痙","痒":"癢","痖":"瘂","痨":"癆","痪":"瘓","痫":"癇","瘅":"癉","瘆":"瘮","瘗":"瘞","瘘":"瘻","瘪":"癟","瘫":"癱","瘾":"癮","瘿":"癭","癞":"癩","癣":"癬","癫":"癲","皑":"皚","皱":"皺","皲":"皸","盏":"盞","盐":"鹽","监":"監","盖":"蓋","盗":"盜","盘":"盤","眍":"瞘","眦":"眥","眬":"矓","着":"著","睁":"睜","睐":"睞","睑":"瞼","睾":"睪","瞆":"瞶","瞒":"瞞","瞩":"矚","矫":"矯","矶":"磯","矾":"礬","矿":"礦","砀":"碭","码":"碼","砖":"磚","砗":"硨","砚":"硯","砜":"碸","砺":"礪","砻":"礱","砾":"礫","础":"礎","硁":"硜","硕":"碩","硖":"硤","硗":"磽","硙":"磑","硚":"礄","确":"確","硷":"礆","碍":"礙","碛":"磧","碜":"磣","碱":"鹼","礴":"礡","礼":"禮","祃":"禡","祎":"禕","祢":"禰","祯":"禎","祷":"禱","祸":"禍","禀":"稟","禄":"祿","禅":"禪","离":"離","秃":"禿","秆":"稈","种":"種","积":"積","称":"稱","秽":"穢","秾":"穠","稆":"穭","税":"稅","稣":"穌","稳":"穩","穑":"穡","穷":"窮","窃":"竊","窍":"竅","窎":"窵","窑":"窯","窜":"竄","窝":"窩","窥":"窺","窦":"竇","窭":"窶","竖":"竪","竞":"競","笃":"篤","笋":"筍","笔":"筆","笕":"筧","笺":"箋","笼":"籠","笾":"籩","筑":"築","筚":"篳","筛":"篩","筜":"簹","筝":"箏","筹":"籌","筼":"篔","签":"簽","简":"簡","箓":"籙","箦":"簀","箧":"篋","箨":"籜","箩":"籮","箪":"簞","箫":"簫","篑":"簣","篓":"簍","篮":"籃","篯":"籛","篱":"籬","簖":"籪","籁":"籟","籴":"糴","类":"類","籼":"秈","粜":"糶","粝":"糲","粤":"粵","粪":"糞","粮":"糧","糁":"糝","糇":"餱","紧":"緊","絷":"縶","纟":"糹","纠":"糾","纡":"紆","红":"紅","纣":"紂","纤":"纖","纥":"紇","约":"約","级":"級","纨":"紈","纩":"纊","纪":"紀","纫":"紉","纬":"緯","纭":"紜","纮":"紘","纯":"純","纰":"紕","纱":"紗","纲":"綱","纳":"納","纴":"紝","纵":"縱","纶":"綸","纷":"紛","纸":"紙","纹":"紋","纺":"紡","纻":"紵","纼":"紖","纽":"紐","纾":"紓","线":"線","绀":"紺","绁":"紲","绂":"紱","练":"練","组":"組","绅":"紳","细":"細","织":"織","终":"終","绉":"縐","绊":"絆","绋":"紼","绌":"絀","绍":"紹","绎":"繹","经":"經","绐":"紿","绑":"綁","绒":"絨","结":"結","绔":"絝","绕":"繞","绖":"絰","绗":"絎","绘":"繪","给":"給","绚":"絢","绛":"絳","络":"絡","绝":"絕","绞":"絞","统":"統","绠":"綆","绡":"綃","绢":"絹","绣":"繡","绤":"綌","绥":"綏","绦":"縧","继":"繼","绨":"綈","绩":"績","绪":"緒","绫":"綾","绬":"緓","续":"續","绮":"綺","绯":"緋","绰":"綽","绱":"緔","绲":"緄","绳":"繩","维":"維","绵":"綿","绶":"綬","绷":"繃","绸":"綢","绹":"綯","绺":"綹","绻":"綣","综":"綜","绽":"綻","绾":"綰","绿":"綠","缀":"綴","缁":"緇","缂":"緙","缃":"緗","缄":"緘","缅":"緬","缆":"纜","缇":"緹","缈":"緲","缉":"緝","缊":"縕","缋":"繢","缌":"緦","缍":"綞","缎":"緞","缏":"緶","缐":"線","缑":"緱","缒":"縋","缓":"緩","缔":"締","缕":"縷","编":"編","缗":"緡","缘":"緣","缙":"縉","缚":"縛","缛":"縟","缜":"縝","缝":"縫","缞":"縗","缟":"縞","缠":"纏","缡":"縭","缢":"縊","缣":"縑","缤":"繽","缥":"縹","缦":"縵","缧":"縲","缨":"纓","缩":"縮","缪":"繆","缫":"繅","缬":"纈","缭":"繚","缮":"繕","缯":"繒","缰":"繮","缱":"繾","缲":"繰","缳":"繯","缴":"繳","缵":"纘","罂":"罌","网":"網","罗":"羅","罚":"罰","罢":"罷","罴":"羆","羁":"羈","羟":"羥","羡":"羨","翘":"翹","翙":"翽","翚":"翬","耢":"耮","耧":"耬","耸":"聳","耻":"恥","聂":"聶","聋":"聾","职":"職","聍":"聹","联":"聯","聩":"聵","聪":"聰","肃":"肅","肠":"腸","肤":"膚","肮":"骯","肾":"腎","肿":"腫","胀":"脹","胁":"脅","胆":"膽","胜":"勝","胧":"朧","胨":"腖","胪":"臚","胫":"脛","胶":"膠","脉":"脈","脍":"膾","脏":"髒","脐":"臍","脑":"腦","脓":"膿","脔":"臠","脚":"腳","脱":"脫","脶":"腡","脸":"臉","腊":"臘","腌":"醃","腘":"膕","腭":"齶","腻":"膩","腽":"膃","腾":"騰","膑":"臏","膻":"羶","臜":"臢","舆":"輿","舍":"捨","舣":"艤","舰":"艦","舱":"艙","舻":"艫","艰":"艱","艳":"艷","艺":"藝","节":"節","芈":"羋","芗":"薌","芜":"蕪","芦":"蘆","苁":"蓯","苇":"葦","苈":"藶","苋":"莧","苌":"萇","苍":"蒼","苎":"苧","苏":"蘇","苧":"薴","苹":"蘋","范":"範","茎":"莖","茏":"蘢","茑":"蔦","茔":"塋","茕":"煢","茧":"繭","荆":"荊","荐":"薦","荙":"薘","荚":"莢","荛":"蕘","荜":"蓽","荞":"蕎","荟":"薈","荠":"薺","荡":"蕩","荣":"榮","荤":"葷","荥":"滎","荦":"犖","荧":"熒","荨":"蕁","荩":"藎","荪":"蓀","荫":"蔭","荬":"蕒","荭":"葒","荮":"葤","药":"藥","莅":"蒞","莱":"萊","莲":"蓮","莳":"蒔","莴":"萵","莶":"薟","获":"獲","莸":"蕕","莹":"瑩","莺":"鶯","莼":"蒓","萚":"蘀","萝":"蘿","萤":"螢","营":"營","萦":"縈","萧":"蕭","萨":"薩","葱":"蔥","蒇":"蕆","蒉":"蕢","蒋":"蔣","蒌":"蔞","蓝":"藍","蓟":"薊","蓠":"蘺","蓣":"蕷","蓥":"鎣","蓦":"驀","蔂":"虆","蔷":"薔","蔹":"蘞","蔺":"藺","蔼":"藹","蕰":"薀","蕲":"蘄","蕴":"蘊","薮":"藪","藓":"蘚","蘖":"櫱","虏":"虜","虑":"慮","虚":"虛","虫":"蟲","虬":"虯","虮":"蟣","虱":"蝨","虽":"雖","虾":"蝦","虿":"蠆","蚀":"蝕","蚁":"蟻","蚂":"螞","蚕":"蠶","蚝":"蠔","蚬":"蜆","蛊":"蠱","蛎":"蠣","蛏":"蟶","蛮":"蠻","蛰":"蟄","蛱":"蛺","蛲":"蟯","蛳":"螄","蛴":"蠐","蜕":"蛻","蜗":"蝸","蜡":"蠟","蝇":"蠅","蝈":"蟈","蝉":"蟬","蝎":"蠍","蝼":"螻","蝾":"蠑","螀":"螿","螨":"蟎","蟏":"蠨","衅":"釁","衔":"銜","补":"補","衬":"襯","衮":"袞","袄":"襖","袅":"裊","袆":"褘","袜":"襪","袭":"襲","袯":"襏","装":"裝","裆":"襠","裈":"褌","裢":"褳","裣":"襝","裤":"褲","裥":"襇","褛":"褸","褴":"襤","襕":"襴","见":"見","观":"觀","觃":"覎","规":"規","觅":"覓","视":"視","觇":"覘","览":"覽","觉":"覺","觊":"覬","觋":"覡","觌":"覿","觍":"覥","觎":"覦","觏":"覯","觐":"覲","觑":"覷","觞":"觴","触":"觸","觯":"觶","訚":"誾","詟":"讋","誉":"譽","誊":"謄","讠":"訁","计":"計","订":"訂","讣":"訃","认":"認","讥":"譏","讦":"訐","讧":"訌","讨":"討","让":"讓","讪":"訕","讫":"訖","讬":"託","训":"訓","议":"議","讯":"訊","记":"記","讱":"訒","讲":"講","讳":"諱","讴":"謳","讵":"詎","讶":"訝","讷":"訥","许":"許","讹":"訛","论":"論","讻":"訩","讼":"訟","讽":"諷","设":"設","访":"訪","诀":"訣","证":"證","诂":"詁","诃":"訶","评":"評","诅":"詛","识":"識","诇":"詗","诈":"詐","诉":"訴","诊":"診","诋":"詆","诌":"謅","词":"詞","诎":"詘","诏":"詔","诐":"詖","译":"譯","诒":"詒","诓":"誆","诔":"誄","试":"試","诖":"詿","诗":"詩","诘":"詰","诙":"詼","诚":"誠","诛":"誅","诜":"詵","话":"話","诞":"誕","诟":"詬","诠":"詮","诡":"詭","询":"詢","诣":"詣","诤":"諍","该":"該","详":"詳","诧":"詫","诨":"諢","诩":"詡","诪":"譸","诫":"誡","诬":"誣","语":"語","诮":"誚","误":"誤","诰":"誥","诱":"誘","诲":"誨","诳":"誑","说":"說","诵":"誦","诶":"誒","请":"請","诸":"諸","诹":"諏","诺":"諾","读":"讀","诼":"諑","诽":"誹","课":"課","诿":"諉","谀":"諛","谁":"誰","谂":"諗","调":"調","谄":"諂","谅":"諒","谆":"諄","谇":"誶","谈":"談","谊":"誼","谋":"謀","谌":"諶","谍":"諜","谎":"謊","谏":"諫","谐":"諧","谑":"謔","谒":"謁","谓":"謂","谔":"諤","谕":"諭","谖":"諼","谗":"讒","谘":"諮","谙":"諳","谚":"諺","谛":"諦","谜":"謎","谝":"諞","谞":"諝","谟":"謨","谠":"讜","谡":"謖","谢":"謝","谣":"謠","谤":"謗","谥":"謚","谦":"謙","谧":"謐","谨":"謹","谩":"謾","谪":"謫","谫":"謭","谬":"謬","谭":"譚","谮":"譖","谯":"譙","谰":"讕","谱":"譜","谲":"譎","谳":"讞","谴":"譴","谵":"譫","谶":"讖","豮":"豶","贝":"貝","贞":"貞","负":"負","贠":"貟","贡":"貢","财":"財","责":"責","贤":"賢","败":"敗","账":"帳","货":"貨","质":"質","贩":"販","贪":"貪","贫":"貧","贬":"貶","购":"購","贮":"貯","贯":"貫","贰":"貳","贱":"賤","贲":"賁","贳":"貰","贴":"貼","贵":"貴","贶":"貺","贷":"貸","贸":"貿","费":"費","贺":"賀","贻":"貽","贼":"賊","贽":"贄","贾":"賈","贿":"賄","赀":"貲","赁":"賃","赂":"賂","赃":"贓","资":"資","赅":"賅","赆":"贐","赇":"賕","赈":"賑","赉":"賚","赊":"賒","赋":"賦","赌":"賭","赍":"賫","赎":"贖","赏":"賞","赐":"賜","赑":"贔","赒":"賙","赓":"賡","赔":"賠","赕":"賧","赖":"賴","赗":"賵","赘":"贅","赙":"賻","赚":"賺","赛":"賽","赜":"賾","赝":"贋","赞":"贊","赟":"贇","赠":"贈","赡":"贍","赢":"贏","赣":"贛","赪":"赬","赵":"趙","赶":"趕","趋":"趨","趱":"趲","趸":"躉","跃":"躍","跄":"蹌","跞":"躒","践":"踐","跶":"躂","跷":"蹺","跸":"蹕","跹":"躚","跻":"躋","踊":"踴","踌":"躊","踪":"蹤","踬":"躓","踯":"躑","蹑":"躡","蹒":"蹣","蹰":"躕","蹿":"躥","躏":"躪","躜":"躦","躯":"軀","车":"車","轧":"軋","轨":"軌","轩":"軒","轪":"軑","轫":"軔","转":"轉","轭":"軛","轮":"輪","软":"軟","轰":"轟","轱":"軲","轲":"軻","轳":"轤","轴":"軸","轵":"軹","轶":"軼","轷":"軤","轸":"軫","轹":"轢","轺":"軺","轻":"輕","轼":"軾","载":"載","轾":"輊","轿":"轎","辀":"輈","辁":"輇","辂":"輅","较":"較","辄":"輒","辅":"輔","辆":"輛","辇":"輦","辈":"輩","辉":"輝","辊":"輥","辋":"輞","辌":"輬","辍":"輟","辎":"輜","辏":"輳","辐":"輻","辑":"輯","辒":"轀","输":"輸","辔":"轡","辕":"轅","辖":"轄","辗":"輾","辘":"轆","辙":"轍","辚":"轔","辞":"辭","辩":"辯","辫":"辮","边":"邊","辽":"遼","达":"達","迁":"遷","过":"過","迈":"邁","运":"運","还":"還","这":"這","进":"進","远":"遠","违":"違","连":"連","迟":"遲","迩":"邇","迳":"逕","迹":"跡","适":"適","选":"選","逊":"遜","递":"遞","逦":"邐","逻":"邏","遗":"遺","遥":"遙","邓":"鄧","邝":"鄺","邬":"鄔","邮":"郵","邹":"鄒","邺":"鄴","邻":"鄰","郏":"郟","郐":"鄶","郑":"鄭","郓":"鄆","郦":"酈","郧":"鄖","郸":"鄲","酂":"酇","酝":"醖","酦":"醱","酱":"醬","酽":"釅","酾":"釃","酿":"釀","采":"採","释":"釋","鉴":"鑒","銮":"鑾","錾":"鏨","钅":"釒","钆":"釓","钇":"釔","针":"針","钉":"釘","钊":"釗","钋":"釙","钌":"釕","钍":"釷","钎":"釺","钏":"釧","钐":"釤","钑":"鈒","钒":"釩","钓":"釣","钔":"鍆","钕":"釹","钖":"鍚","钗":"釵","钘":"鈃","钙":"鈣","钚":"鈈","钛":"鈦","钜":"鉅","钝":"鈍","钞":"鈔","钟":"鐘","钠":"鈉","钡":"鋇","钢":"鋼","钣":"鈑","钤":"鈐","钥":"鑰","钦":"欽","钧":"鈞","钨":"鎢","钩":"鈎","钪":"鈧","钫":"鈁","钬":"鈥","钭":"鈄","钮":"鈕","钯":"鈀","钰":"鈺","钱":"錢","钲":"鉦","钳":"鉗","钴":"鈷","钵":"鉢","钶":"鈳","钷":"鉕","钸":"鈽","钹":"鈸","钺":"鉞","钻":"鑽","钼":"鉬","钽":"鉭","钾":"鉀","钿":"鈿","铀":"鈾","铁":"鐵","铂":"鉑","铃":"鈴","铄":"鑠","铅":"鉛","铆":"鉚","铇":"鉋","铈":"鈰","铉":"鉉","铊":"鉈","铋":"鉍","铌":"鈮","铍":"鈹","铎":"鐸","铏":"鉶","铐":"銬","铑":"銠","铒":"鉺","铓":"鋩","铔":"錏","铕":"銪","铖":"鋮","铗":"鋏","铘":"鋣","铙":"鐃","铚":"銍","铛":"鐺","铜":"銅","铝":"鋁","铞":"銱","铟":"銦","铠":"鎧","铡":"鍘","铢":"銖","铣":"銑","铤":"鋌","铥":"銩","铦":"銛","铧":"鏵","铨":"銓","铩":"鎩","铪":"鉿","铫":"銚","铬":"鉻","铭":"銘","铮":"錚","铯":"銫","铰":"鉸","铱":"銥","铲":"鏟","铳":"銃","铴":"鐋","铵":"銨","银":"銀","铷":"銣","铸":"鑄","铹":"鐒","铺":"鋪","铻":"鋙","铼":"錸","铽":"鋱","链":"鏈","铿":"鏗","销":"銷","锁":"鎖","锂":"鋰","锃":"鋥","锄":"鋤","锅":"鍋","锆":"鋯","锇":"鋨","锈":"鏽","锉":"銼","锊":"鋝","锋":"鋒","锌":"鋅","锍":"鋶","锎":"鐦","锏":"鐧","锐":"銳","锑":"銻","锒":"鋃","锓":"鋟","锔":"鋦","锕":"錒","锖":"錆","锗":"鍺","锘":"鍩","错":"錯","锚":"錨","锛":"錛","锜":"錡","锝":"鍀","锞":"錁","锟":"錕","锠":"錩","锡":"錫","锢":"錮","锣":"鑼","锤":"錘","锥":"錐","锦":"錦","锧":"鑕","锨":"鍁","锩":"錈","锪":"鍃","锫":"錇","锬":"錟","锭":"錠","键":"鍵","锯":"鋸","锰":"錳","锱":"錙","锲":"鍥","锳":"鍈","锴":"鍇","锵":"鏘","锶":"鍶","锷":"鍔","锸":"鍤","锹":"鍬","锺":"鍾","锻":"鍛","锼":"鎪","锽":"鍠","锾":"鍰","锿":"鎄","镀":"鍍","镁":"鎂","镂":"鏤","镃":"鎡","镄":"鐨","镅":"鎇","镆":"鏌","镇":"鎮","镈":"鎛","镉":"鎘","镊":"鑷","镋":"鎲","镌":"鐫","镍":"鎳","镎":"鎿","镏":"鎦","镐":"鎬","镑":"鎊","镒":"鎰","镓":"鎵","镔":"鑌","镕":"鎔","镖":"鏢","镗":"鏜","镘":"鏝","镙":"鏍","镚":"鏰","镛":"鏞","镜":"鏡","镝":"鏑","镞":"鏃","镟":"鏇","镠":"鏐","镡":"鐔","镢":"鐝","镣":"鐐","镤":"鏷","镥":"鑥","镦":"鐓","镧":"鑭","镨":"鐠","镩":"鑹","镪":"鏹","镫":"鐙","镬":"鑊","镭":"鐳","镮":"鐶","镯":"鐲","镰":"鐮","镱":"鐿","镲":"鑔","镳":"鑣","镴":"鑞","镵":"鑱","镶":"鑲","长":"長","门":"門","闩":"閂","闪":"閃","闫":"閆","闬":"閈","闭":"閉","问":"問","闯":"闖","闰":"閏","闱":"闈","闲":"閒","闳":"閎","间":"間","闵":"閔","闶":"閌","闷":"悶","闸":"閘","闹":"鬧","闺":"閨","闻":"聞","闼":"闥","闽":"閩","闾":"閭","闿":"闓","阀":"閥","阁":"閣","阂":"閡","阃":"閫","阄":"鬮","阅":"閱","阆":"閬","阇":"闍","阈":"閾","阉":"閹","阊":"閶","阋":"鬩","阌":"閿","阍":"閽","阎":"閻","阏":"閼","阐":"闡","阑":"闌","阒":"闃","阓":"闠","阔":"闊","阕":"闋","阖":"闔","阗":"闐","阘":"闒","阙":"闕","阚":"闞","阛":"闤","队":"隊","阳":"陽","阴":"陰","阵":"陣","阶":"階","际":"際","陆":"陸","陇":"隴","陈":"陳","陉":"陘","陕":"陝","陧":"隉","陨":"隕","险":"險","随":"隨","隐":"隱","隶":"隸","隽":"雋","难":"難","雏":"雛","雠":"讎","雳":"靂","雾":"霧","霁":"霽","霡":"霢","霭":"靄","靓":"靚","静":"靜","靥":"靨","鞑":"韃","鞒":"鞽","鞯":"韉","韦":"韋","韧":"韌","韨":"韍","韩":"韓","韪":"韙","韫":"韞","韬":"韜","韵":"韻","页":"頁","顶":"頂","顷":"頃","顸":"頇","项":"項","顺":"順","须":"須","顼":"頊","顽":"頑","顾":"顧","顿":"頓","颀":"頎","颁":"頒","颂":"頌","颃":"頏","预":"預","颅":"顱","领":"領","颇":"頗","颈":"頸","颉":"頡","颊":"頰","颋":"頲","颌":"頜","颍":"潁","颎":"熲","颏":"頦","颐":"頤","频":"頻","颒":"頮","颓":"頹","颔":"頷","颕":"頴","颖":"穎","颗":"顆","题":"題","颙":"顒","颚":"顎","颛":"顓","颜":"顏","额":"額","颞":"顳","颟":"顢","颠":"顛","颡":"顙","颢":"顥","颤":"顫","颥":"顬","颦":"顰","颧":"顴","风":"風","飏":"颺","飐":"颭","飑":"颮","飒":"颯","飓":"颶","飔":"颸","飕":"颼","飖":"颻","飗":"飀","飘":"飄","飙":"飆","飚":"飈","飞":"飛","飨":"饗","餍":"饜","饣":"飠","饤":"飣","饥":"飢","饦":"飥","饧":"餳","饨":"飩","饩":"餼","饪":"飪","饫":"飫","饬":"飭","饭":"飯","饮":"飲","饯":"餞","饰":"飾","饱":"飽","饲":"飼","饳":"飿","饴":"飴","饵":"餌","饶":"饒","饷":"餉","饸":"餄","饹":"餎","饺":"餃","饻":"餏","饼":"餅","饽":"餑","饾":"餖","饿":"餓","馀":"餘","馁":"餒","馂":"餕","馃":"餜","馄":"餛","馅":"餡","馆":"館","馇":"餷","馈":"饋","馉":"餶","馊":"餿","馋":"饞","馌":"饁","馍":"饃","馎":"餺","馏":"餾","馐":"饈","馑":"饉","馒":"饅","馓":"饊","馔":"饌","馕":"饢","马":"馬","驭":"馭","驮":"馱","驯":"馴","驰":"馳","驱":"驅","驲":"馹","驳":"駁","驴":"驢","驵":"駔","驶":"駛","驷":"駟","驸":"駙","驹":"駒","驺":"騶","驻":"駐","驼":"駝","驽":"駑","驾":"駕","驿":"驛","骀":"駘","骁":"驍","骂":"罵","骃":"駰","骄":"驕","骅":"驊","骆":"駱","骇":"駭","骈":"駢","骉":"驫","骊":"驪","骋":"騁","验":"驗","骍":"騂","骎":"駸","骏":"駿","骐":"騏","骑":"騎","骒":"騍","骓":"騅","骔":"騌","骕":"驌","骖":"驂","骗":"騙","骘":"騭","骙":"騤","骚":"騷","骛":"騖","骜":"驁","骝":"騮","骞":"騫","骟":"騸","骠":"驃","骡":"騾","骢":"驄","骣":"驏","骤":"驟","骥":"驥","骦":"驦","骧":"驤","髅":"髏","髋":"髖","髌":"髕","鬓":"鬢","鬶":"鬹","魇":"魘","魉":"魎","鱼":"魚","鱽":"魛","鱾":"魢","鱿":"魷","鲀":"魨","鲁":"魯","鲂":"魴","鲃":"䰾","鲄":"魺","鲅":"鮁","鲆":"鮃","鲇":"鮎","鲈":"鱸","鲉":"鮋","鲊":"鮓","鲋":"鮒","鲌":"鮊","鲍":"鮑","鲎":"鱟","鲏":"鮍","鲐":"鮐","鲑":"鮭","鲒":"鮚","鲓":"鮳","鲔":"鮪","鲕":"鮞","鲖":"鮦","鲗":"鰂","鲘":"鮜","鲙":"鱠","鲚":"鱭","鲛":"鮫","鲜":"鮮","鲝":"鮺","鲞":"鮝","鲟":"鱘","鲠":"鯁","鲡":"鱺","鲢":"鰱","鲣":"鰹","鲤":"鯉","鲥":"鰣","鲦":"鰷","鲧":"鯀","鲨":"鯊","鲩":"鯇","鲪":"鮶","鲫":"鯽","鲬":"鯒","鲭":"鯖","鲮":"鯪","鲯":"鯕","鲰":"鯫","鲱":"鯡","鲲":"鯤","鲳":"鯧","鲴":"鯝","鲵":"鯢","鲶":"鯰","鲷":"鯛","鲸":"鯨","鲹":"鰺","鲺":"鯴","鲻":"鯔","鲼":"鱝","鲽":"鰈","鲾":"鰏","鲿":"鱨","鳀":"鯷","鳁":"鰮","鳂":"鰃","鳃":"鰓","鳄":"鰐","鳅":"鰍","鳆":"鰒","鳇":"鰉","鳈":"鰁","鳉":"鱂","鳊":"鯿","鳋":"鰠","鳌":"鰲","鳍":"鰭","鳎":"鰨","鳏":"鰥","鳐":"鰩","鳑":"鰟","鳒":"鰜","鳓":"鰳","鳔":"鰾","鳕":"鱈","鳖":"鱉","鳗":"鰻","鳘":"鰵","鳙":"鱅","鳚":"䲁","鳛":"鰼","鳜":"鱖","鳝":"鱔","鳞":"鱗","鳟":"鱒","鳠":"鱯","鳡":"鱤","鳢":"鱧","鳣":"鱣","鳤":"䲘","鸟":"鳥","鸠":"鳩","鸡":"雞","鸢":"鳶","鸣":"鳴","鸤":"鳲","鸥":"鷗","鸦":"鴉","鸧":"鶬","鸨":"鴇","鸩":"鴆","鸪":"鴣","鸫":"鶇","鸬":"鸕","鸭":"鴨","鸮":"鴞","鸯":"鴦","鸰":"鴒","鸱":"鴟","鸲":"鴝","鸳":"鴛","鸴":"鷽","鸵":"鴕","鸶":"鷥","鸷":"鷙","鸸":"鴯","鸹":"鴰","鸺":"鵂","鸻":"鴴","鸼":"鵃","鸽":"鴿","鸾":"鸞","鸿":"鴻","鹀":"鵐","鹁":"鵓","鹂":"鸝","鹃":"鵑","鹄":"鵠","鹅":"鵝","鹆":"鵒","鹇":"鷳","鹈":"鵜","鹉":"鵡","鹊":"鵲","鹋":"鶓","鹌":"鵪","鹍":"鵾","鹎":"鵯","鹏":"鵬","鹐":"鵮","鹑":"鶉","鹒":"鶊","鹓":"鵷","鹔":"鷫","鹕":"鶘","鹖":"鶡","鹗":"鶚","鹘":"鶻","鹙":"鶖","鹚":"鷀","鹛":"鶥","鹜":"鶩","鹝":"鷊","鹞":"鷂","鹟":"鶲","鹠":"鶹","鹡":"鶺","鹢":"鷁","鹣":"鶼","鹤":"鶴","鹥":"鷖","鹦":"鸚","鹧":"鷓","鹨":"鷚","鹩":"鷯","鹪":"鷦","鹫":"鷲","鹬":"鷸","鹭":"鷺","鹮":"䴉","鹯":"鸇","鹰":"鷹","鹱":"鸌","鹲":"鸏","鹳":"鸛","鹴":"鸘","鹾":"鹺","麦":"麥","麸":"麩","麹":"麴","黄":"黃","黉":"黌","黡":"黶","黩":"黷","黪":"黲","黾":"黽","鼋":"黿","鼍":"鼉","鼗":"鞀","鼹":"鼴","齐":"齊","齑":"齏","齿":"齒","龀":"齔","龁":"齕","龂":"齗","龃":"齟","龄":"齡","龅":"齙","龆":"齠","龇":"齜","龈":"齦","龉":"齬","龊":"齪","龋":"齲","龌":"齷","龙":"龍","龚":"龔","龛":"龕","龟":"龜","鿎":"䃮","鿏":"䥑","鿔":"鎶","鿭":"鉨"};

  const PHRASE_KEYS = Object.keys(PHRASE_MAP).sort((a, b) => b.length - a.length);
  const PHRASE_RE = new RegExp(
    PHRASE_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g'
  );
  const HAS_CONVERTIBLE_RE = /[\u4e00-\u9fff“”‘’]/;
  const MIXED_TEXT_BOUNDARY_RE = /(?<!\\[A-Za-z])(?<=[A-Za-z])(?=\p{Script=Han})|(?<=\p{Script=Han})(?=[A-Za-z])/gu;
  const CACHE_MAX = 8000;
  const convertCache = typeof Map !== 'undefined' ? new Map() : null;

  function convertChars(segment) {
    let out = '';
    let changed = false;
    for (let i = 0; i < segment.length; i++) {
      const ch = segment[i];
      const mapped = CHAR_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        changed = true;
      } else {
        out += ch;
      }
    }
    return changed ? out : segment;
  }

  function convertZhCNToZhTW(input) {
    if (typeof input !== 'string' || !input) return input;
    if (!HAS_CONVERTIBLE_RE.test(input)) return input;
    if (convertCache && convertCache.has(input)) {
      return convertCache.get(input);
    }

    let result = '';
    let lastIndex = 0;
    PHRASE_RE.lastIndex = 0;
    let match;
    while ((match = PHRASE_RE.exec(input)) !== null) {
      if (match.index > lastIndex) {
        result += convertChars(input.slice(lastIndex, match.index));
      }
      result += PHRASE_MAP[match[0]];
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < input.length) {
      result += convertChars(input.slice(lastIndex));
    }
    result = result.replace(MIXED_TEXT_BOUNDARY_RE, ' ');

    if (convertCache) {
      if (convertCache.size >= CACHE_MAX) {
        const firstKey = convertCache.keys().next().value;
        if (firstKey !== undefined) convertCache.delete(firstKey);
      }
      convertCache.set(input, result);
    }
    return result;
  }

  if (root) {
    root.__AG_ZH_TW_CONVERT__ = convertZhCNToZhTW;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { convertZhCNToZhTW, PHRASE_MAP, CHAR_MAP };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
// =========================================================================
  // 模块 5: 统一设置面板、配置项无损迁移、终端与 CLI 启动、多语言注册表
  // =========================================================================
  const SETTINGS_TAB_ORDER = ['appearance', 'remote', 'chat', 'network', 'subscription'];
  const SETTINGS_TAB_ALIASES = { terminal: 'network', system: 'network' };
  let activeSettingsTab = 'appearance';
  let suiteConfigTransplanted = false;
  let suiteDropdownsEnhanced = false;
  let uiLangDropdown = null;
  let uiCliModelDropdown = null;
  let uiCliMuxHostDropdown = null;
  let uiBaseCurrencyDropdown = null;
  let uiCodexPoolFilterDropdown = null;
  let uiCodexQuotaStyleDropdown = null;
  let uiCodexQuotaOtherDropdown = null;

  const SUITE_EN_UI_DICT = {
    'Antigravity Suite 统一设置': 'Antigravity Suite Settings',
    '套件统一设置': 'Suite Settings',
    '关闭设置': 'Close Settings',
    '设置分类': 'Settings Categories',
    '🌐 语言与外观': '🌐 Language & Appearance',
    '📱 远程设置': '📱 Remote',
    '⚡ 对话与效率': '⚡ Chat & Efficiency',
    '🧰 终端与网络': '🧰 Terminal & Network',
    '📊 套餐与订阅': '📊 Plan & Subscription',
    '基准换算币种：': 'Reference Currency:',
    '语言与明暗外观': 'Language & Appearance',
    '桌面功能显示开关': 'Desktop Feature Toggles',
    '对话自动化与安全策略': 'Chat Automation & Safety',
    '自定义强调色与顶栏分项配色': 'Custom Accent & Topbar Colors',
    'macOS Dock 未读与状态提醒': 'macOS Dock Unread & Status Alerts',
    '测试提醒': 'Test Alert',
    '在 Dock 图标上短暂预览角标与状态胶囊效果': 'Preview badge and status capsule briefly on the Dock icon',
    '前往开启权限': 'Grant Access',
    '打开 macOS 系统设置，开启「辅助功能」权限以显示 Dock 图标提醒': 'Open macOS System Settings and enable Accessibility permission to show Dock icon alerts',
    '正在检查 macOS Dock 图标提醒状态…': 'Checking macOS Dock icon alert status…',
    '启用 macOS Dock 图标提醒': 'Enable macOS Dock Icon Alerts',
    '不修改官方程序；后台有新回复、待审批或高危拦截时即时提醒，关闭后即彻底停用、不占后台资源': 'Does not modify the official app; alerts immediately on background replies, pending approvals, or high-risk blocks, and uses zero resources when disabled',
    '提醒样式': 'Alert Style',
    '带状态胶囊可在图标下方直观区分生成中、新回复与待审批；仅显示角标只在右上角显示数字（有待审批时优先显示待审批数）': 'Status capsule shows Working, Unread, and Approve states below the icon; badge-only shows the corner count (approvals take priority)',
    '带状态胶囊（推荐）': 'Status Capsule (Recommended)',
    '仅显示角标': 'Badge Only',
    '用蓝 / 红区分未读与待审批': 'Use Blue for Unread & Red for Approvals',
    '待审批与高危拦截用红色优先提醒，普通新回复用蓝色；关闭后全部显示为红色': 'Approvals and high-risk blocks highlight in red with priority, while normal unread replies use blue; when off, all alerts show in red',
    '切回窗口自动清除普通未读': 'Auto-Clear Normal Unread on Focus',
    '切回 Antigravity 窗口即自动清除普通新回复提醒；待审批与高危红标会保留，直到你处理完成': 'Automatically clears normal unread alerts when returning to Antigravity; red approval and high-risk alerts stay until resolved',
    '🖥️ 终端与通用': '🖥️ Terminal & General',
    '🎨 外观与主题': '🎨 Appearance & Theme',
    '💎 套餐与订阅': '💎 Plan & Subscription',
    '🌐 网络与高级': '🌐 Network & Advanced',
    '>_ CLI 启动终端配置': '>_ CLI Launch Terminal',
    '检测中…': 'Detecting…',
    '🔄 重新检测': '🔄 Re-detect',
    '重新检测': 'Re-detect',
    '选择点击顶栏 CLI 按钮时启动的终端程序；支持本机主流终端自动识别与自定义路径。': 'Choose the terminal launched by the topbar CLI button; supports auto-detected terminals and custom paths.',
    '自定义终端程序路径（选择「自定义程序路径」时生效）': 'Custom Terminal Path (active when "Custom Path" is selected)',
    '📂 浏览选择…': '📂 Browse…',
    '浏览选择…': 'Browse…',
    '保存路径': 'Save Path',
    '自定义程序路径': 'Custom Path',
    '自动默认 (Terminal.app)': 'Auto Default (Terminal.app)',
    '自动默认 (原生居中控制台)': 'Auto Default (Native Centered)',
    'Terminal (系统终端)': 'Terminal (System)',
    'CMD (命令提示符)': 'CMD (Command Prompt)',
    'WSL (Linux 子系统)': 'WSL (Linux Subsystem)',
    '已安装': 'Installed',
    '未检测到': 'Not found',
    '已配置': 'Configured',
    '自定义': 'Custom',
    '请填写或浏览选择终端程序路径': 'Enter or browse for terminal executable path',
    '未在本机默认路径找到': 'Not found in default paths',
    '开启 CLI 免审核模式 (--dangerously-skip-permissions)': 'Skip CLI Permissions (--dangerously-skip-permissions)',
    '启动 agy 时自动批准终端内工具调用权限，无需逐次手动确认': 'Auto-approve terminal tool calls when launching agy without manual prompts',
    'CLI 默认启动模型 (--model)': 'CLI Default Launch Model (--model)',
    '选择启动 agy CLI 时传入的模型，或保持「不选择模型」以跟随 agy 默认设置': 'Select the model passed to agy CLI, or keep "No Model" to follow agy defaults',
    '不选择模型 · 跟随 agy 默认设置': 'No Model · Follow agy default',
    '自定义模型 ID…': 'Custom Model ID…',
    '保存模型': 'Save Model',
    '多路复用器目标主机 (Rex / WezTerm / tmux)': 'Multiplexer Target Host (Rex / WezTerm / tmux)',
    '多路复用器启动 agy 时指定目标主机名；选「本机」避免误入远端会话，选远端主机自动执行远端 agy': 'Target host for multiplexer CLI launch; choose Local to stay on this Mac, or a remote host to launch agy remotely',
    '本机 · This Mac (Local)': 'Local · This Mac',
    '自定义主机名 / Domain…': 'Custom Host / Domain…',
    '保存主机': 'Save Host',
    'tmux (多路复用器)': 'tmux (Multiplexer)',
    '输入 Rex 主机名、WezTerm Domain 或 SSH 主机名（留空为本机）': 'Enter Rex host label, WezTerm domain, or SSH host (blank = local)',
    '当前使用：自动默认': 'Active: Auto Default',
    '▶ 测试打开终端': '▶ Test Terminal',
    '测试打开终端': 'Test Terminal',
    '⏳ 正在尝试打开所选终端…': '⏳ Launching selected terminal…',
    '🧩 界面与对话增强偏好': '🧩 UI & Conversation Preferences',
    '界面与对话增强偏好': 'UI & Conversation Preferences',
    '界面深浅主题': 'Appearance Theme',
    '控制状态栏、浮窗面板与调色默认色调': 'Controls default palette for toolbar badges, popovers, and panels',
    '🌗 跟随宿主': '🌗 Auto',
    '跟随宿主': 'Auto',
    '☀️ 浅色': '☀️ Light',
    '浅色': 'Light',
    '🌙 深色': '🌙 Dark',
    '深色': 'Dark',
    '安全自动确认 (Auto-Accept)': 'Safe Auto-Accept',
    '自动点击 Proceed / Accept / 继续 等低风险确认按钮，高危命令自动拦截预警': 'Auto-click low-risk Proceed / Accept buttons while blocking high-risk commands',
    '下一步建议幽灵补全 (Tab / →)': 'Next-Step Ghost Suggestions (Tab / →)',
    '对话空闲且输入框为空时显示高匹配下一步指令提示，按 Tab 一键填入': 'Show context-aware prompt suggestions when composer is idle (press Tab to fill)',
    '界面与提示语言 (Language)': 'Interface Language',
    '统一切换客户端界面汉化、悬浮胶囊与插件多语言展示（可扩展多语言包）': 'Switch client UI localization, context capsule, and suite panels (extensible)',
    '选项名保留英文': 'Keep Option Names in English',
    '中文界面下保留 Default / Auto / Turbo 与 High / Medium / Low 等档位英文原名': 'Keep original English option names (Default / Auto / Turbo / Effort) under Chinese UI',
    '🎨 热力图颜色主题与 5 档色阶自定义': '🎨 Heatmap Theme & 5-Level Color Scale',
    '热力图颜色主题与 5 档色阶自定义': 'Heatmap Theme & 5-Level Color Scale',
    '切换色系预设或单独调色后，顶部标题文字、胶囊边框、按钮高亮及热力图色阶均同步跟随该颜色主题。': 'Topbar titles, accents, highlights, and heatmap palette sync automatically with the selected theme.',
    '🖌️ 面板背景与顶部指标颜色自定义': '🖌️ Panel Background & Badge Colors',
    '面板背景与顶部指标颜色自定义': 'Panel Background & Badge Colors',
    '5 档色阶预设：': '5-Level Presets:',
    '紫色系': 'Purple',
    '黄色系': 'Yellow',
    '绿色系': 'Green',
    '蓝色系': 'Blue',
    '红色系': 'Red',
    '5 档逐格独立自定义（点击任意一格或图例「少 ▢▢▢▢▢ 多」单独调色，可设 5 种不同颜色）：': 'Per-level customization (click any cell or legend swatch):',
    '恢复 5 档预设': 'Reset Levels',
    '1档 · 少/无': 'L1 · None',
    '2档 · 低': 'L2 · Low',
    '3档 · 中': 'L3 · Med',
    '4档 · 高': 'L4 · High',
    '5档 · 多/峰': 'L5 · Peak',
    '预设': 'Preset',
    '跟随主题': 'Follow Theme',
    '色阶「少」端颜色（自动插值）': 'Scale Low Color (Auto-Interpolate)',
    '色阶「多」端颜色（自动插值）': 'Scale High Color (Auto-Interpolate)',
    '面板与菜单统一背景色（0级跟随 / 自定义）': 'Panel & Menu Background (Auto / Custom)',
    '面板与菜单统一背景色': 'Panel & Menu Background',
    '功能显示开关': 'Feature Toggles',
    '全部恢复显示': 'Show All',
    '恢复显示全部顶栏入口与对话区挂件': 'Restore all topbar badges and chat widgets',
    '按需开启或隐藏顶栏入口与对话区挂件，点击立即生效。': 'Show or hide topbar badges and chat widgets; takes effect immediately.',
    '顶部：总用量统计': 'Topbar: Total Usage',
    '顶部：CLI 终端入口': 'Topbar: CLI Button',
    '顶部：模型配额胶囊': 'Topbar: Quota Badge',
    '顶部：手机远程入口': 'Topbar: Remote Badge',
    '输入框快捷操作栏': 'Composer Quick Bar',
    '对话右侧悬浮导航': 'Chat Navigation Float',
    '当前会话上下文': 'Session Context',
    '核心用量速览': 'Core Context Usage',
    '最新生成速度与耗时': 'Output Speed & Latency',
    '底层技术参数与附件审计': 'Technical Details & Attachments',
    'AI 订阅与额度详情': 'AI Subscription & Quota Details',
    '颜色选取器': 'Color Picker',
    '检查更新': 'Check for Updates',
    'CLI 自动批准工具权限（免每次手动确认）': 'Skip CLI Permissions (--dangerously-skip-permissions)',
    '在终端启动 agy 时默认跳过权限询问（附带 --dangerously-skip-permissions）': 'Auto-approve terminal tool calls when launching agy without manual prompts',
    'CLI 默认启动模型': 'CLI Default Launch Model',
    '指定启动 agy 时默认使用的模型；选「不指定」则使用 CLI 默认配置': 'Select the default model when launching agy, or choose Unspecified to follow CLI defaults',
    '不指定 · 跟随 CLI 默认设置': 'Unspecified · Follow CLI default',
    '终端连接目标（本机 / 远程服务器）': 'Terminal Target Host (Local / Remote)',
    '终端连接目标': 'Terminal Target Host',
    '仅在使用 Rex、WezTerm 或 tmux 时生效：可选择在本机或远程服务器上启动 agy': 'Applies to Rex, WezTerm, or tmux: choose Local or a remote server to launch agy',
    '本机（当前电脑）': 'Local (This Computer)',
    '自定义远程主机名…': 'Custom Remote Host…',
    '面板深浅外观': 'Appearance Theme',
    '设置所有插件浮窗与设置面板的明暗配色': 'Configure light/dark appearance for all popovers and settings panels',
    '跟随客户端': 'Follow App',
    '自动确认安全操作 (Auto-Accept)': 'Safe Auto-Accept',
    '自动点击对话中的 Proceed / Accept / 继续 等常规确认按钮，遇到高危命令自动拦截': 'Auto-click safe Proceed / Accept buttons while blocking high-risk commands',
    '输入框智能追问建议 (Tab / →)': 'Smart Follow-up Suggestions (Tab / →)',
    '回答结束后在输入框内提示下一步常用追问，按 Tab 或 → 键一键填入': 'Show follow-up prompt suggestions in composer after responses (Tab or → to fill)',
    '插件与客户端语言': 'Plugin & Client Language',
    '同时切换主界面、设置面板、Dock 提醒及浮窗的显示语言': 'Switch main interface, settings, Dock alerts, and popovers together',
    '模式与档位名保留英文': 'Keep Mode & Effort Names in English',
    '中文界面下保留 Default / Auto / Turbo 及 High / Medium / Low 等英文原名': 'Keep original English names (Default / Auto / Turbo / Effort) under Chinese UI',
    '主题色系与热力图配色': 'Theme Palette & Heatmap Colors',
    '高级色阶微调 ▼': 'Advanced Scale ▼',
    '收起色阶微调 ▲': 'Hide Advanced ▲',
    '切换下方主题色系后，所有弹窗的高亮色、进度条、按钮激活态及热力图均会自动同步。': 'Switching the theme palette syncs accents, progress bars, active controls, and the heatmap.',
    '全局强调色与顶部栏分项配色': 'Global Accent & Topbar Colors',
    '订阅方案：': 'Subscription Plan:',
    'Ultra 套餐规格：': 'Ultra Tier Spec:',
    '账号归属地区：': 'Account Region:',
    '订阅结算地区：': 'Billing Region:',
    '本地代理网络直连（免开 TUN 模式）': 'Local Proxy Direct Connect (No TUN)',
    '本地代理地址（支持 HTTP / SOCKS5，如 http://127.0.0.1:7897）：': 'Local Proxy URL (HTTP / SOCKS5, e.g. http://127.0.0.1:7897):',
    '不走代理的地址（本地回环默认直连）：': 'Bypass Proxy Addresses (Loopback Direct):',
    '🔍 测试代理连接': '🔍 Test Proxy',
    '启用代理': 'Enable Proxy',
    '停用代理': 'Disable Proxy',
    '🟢 已启用': '🟢 Enabled',
    '⚪ 未启用': '⚪ Disabled',
    '全局主题强调色': 'Global Theme Accent',
    '浮窗与面板背景色': 'Popover & Panel Background',
    '顶部圆环进度': 'Ring Progress',
    '顶部圆环底轨': 'Ring Track',
    '对话占用百分比': 'Context Usage %',
    '测速徽章文字': 'Speed Badge Text',
    '顶部总 Token 数': 'Topbar Total Tokens',
    '自定义实付金额与订阅备注': 'Custom Paid Amount & Notes',
    '订阅渠道 / 优惠来源': 'Channel / Promo Source',
    '免费获取（0 元实付，如赠送 / 试用）': 'Free Access ($0 paid, e.g. promo / trial)',
    '备注说明（选填）': 'Notes (Optional)',
    '整体主题色系：': 'Theme Color Palette:',
    '热力图 5 档深浅单独调色（点击色块可逐档修改）：': 'Per-level Heatmap Shading (click swatches to customize):',
    '热力图起始色（自动生成渐变）': 'Heatmap Start Color (Auto Gradient)',
    '热力图峰值色（自动生成渐变）': 'Heatmap Peak Color (Auto Gradient)',
    '全局强调与顶部总数色': 'Accent & Total Tokens',
    '累计与强调指标色': 'Total & Accent Colors',
    '圆环已用部分': 'Ring Used',
    '圆环轨道': 'Ring Track',
    '上下文用量文字': 'Context Text',
    '输出速度': 'Output Speed',
    '累计 token 用量': 'Total Tokens',
    '其他 token 指标': 'Token Accent',
    '注：高占用与超限告警色独立保留，不被常态颜色覆盖。': 'Note: High-usage and overflow alert colors remain independent.',
    '全部恢复跟随主题': 'Reset All to Theme',
    '当前套餐：读取中…': 'Current Plan: Loading…',
    '额度池同步中…': 'Syncing quota pools…',
    '按当前套餐配额执行': 'Follows active plan quota',
    'Ultra 套餐子档：': 'Ultra Sub-tier:',
    '套餐子档：': 'Sub-tier:',
    '账号所在地区：': 'Account Country:',
    '订阅国家：': 'Billing Region:',
    '订阅币种：': 'Currency:',
    '计价模式：': 'Pricing Mode:',
    '跟随参考价': 'Reference Price',
    '自定义实付': 'Custom Paid',
    '设置当前账号订阅信息': 'Configure Subscription Details',
    '获取方式 / 活动来源': 'Acquisition / Source',
    '自定义活动 / 合作方名称': 'Custom Promo / Partner',
    '本权益期间无需另付订阅费': 'No extra fee during this promo period',
    '预设订阅国家与汇率 (可选快捷套用)': 'Preset Billing Region & FX',
    '账号所在地区 (仅本地记录)': 'Account Country (local only)',
    '订阅国家 (购买/结算地区)': 'Billing Country / Region',
    '订阅币种与实付金额': 'Currency & Actual Paid',
    '计费周期': 'Billing Cycle',
    '权益到期日': 'Benefit Expiry',
    '补充说明备注': 'Notes',
    '清除自定义': 'Clear Custom',
    '取消': 'Cancel',
    '保存': 'Save',
    '正在核对代理设置…': 'Checking proxy settings…',
    '绕过代理列表 (NO_PROXY)：': 'Bypass List (NO_PROXY):',
    '⚡ 上下文加长（实验特性说明）': '⚡ Context Window Unlock (Experimental)',
    '上下文加长（实验特性说明）': 'Context Window Unlock (Experimental)',
    '当前后端补丁状态': 'Backend Patch Status',
    '正在分析当前 Antigravity 后端二进制…': 'Analyzing backend binary…',
    '⚠️ 技术边界与重要说明': '⚠️ Technical Notes & Disclaimers',
    '⚡ 立即应用加长补丁': '⚡ Apply Unlock Patch',
    '🔄 恢复官方原版': '🔄 Restore Original',
    '🔄 刷新': '🔄 Refresh',
    '当前目标不受支持': 'Unsupported Target',
    '目标后端': 'Target Binary',
    '目标架构': 'Architecture',
    '文件哈希 (SHA-256)': 'File Hash (SHA-256)',
    '原版备份状态': 'Backup Status',
    '解锁方案来源：': 'Credits:',
    '原作者帖子 (Linux.do @23375) ↗': 'Original Post (Linux.do @23375) ↗',
    '📋 复制链接': '📋 Copy Link',
    '本项目负责 Node.js 原生适配与客户端集成': 'Native Node.js & client integration by Antigravity Suite',
    '当前平台不支持': 'Unsupported Platform',
    '已启用': 'Enabled',
    '未启用': 'Disabled',
    '💬 当前会话上下文': '💬 Session Context',
    '会话用量与生成监控': 'Session Usage & Speed',
    '⭐ 核心用量速览': '⭐ Core Context Usage',
    '读取中': 'Loading',
    '读取中…': 'Loading…',
    '读取中...': 'Loading...',
    '正在计算核心指标…': 'Calculating metrics…',
    '当前已用': 'Used',
    '预算上限': 'Budget',
    '剩余可用': 'Remaining',
    '⚡ 最新生成速度与耗时': '⚡ Output Speed & Latency',
    '待生成': 'Idle',
    '生成耗时': 'Duration',
    '首字延迟': 'TTFT',
    '本次输出': 'Tokens',
    '📋 底层技术参数与附件审计': '📋 Technical Details & Attachments',
    '▼ 点击展开明细': '▼ Show Details',
    '▲ 收起明细': '▲ Hide Details',
    '重新扫描整段会话与附件': 'Rescan Session & Attachments',
    '本机已记录用量': 'Recorded Token Usage',
    '来源:': 'Source:',
    '全部': 'All',
    '桌面端': 'Desktop',
    'CLI': 'CLI',
    'Token 统计': 'Token Stats',
    'API 参考金额': 'API Reference Cost',
    '详情 ▼': 'Details ▼',
    '详情收回 ▲': 'Collapse ▲',
    '前往设置修改': 'Edit in Settings',
    '累计处理 Token': 'Total Processed',
    '含缓存读取': 'Incl. cache reads',
    '总计': 'Total',
    '今日使用': "Today's Usage",
    '今日': 'Today',
    '本月使用': 'This Month',
    '本月': 'Month',
    '年度使用': 'This Year',
    '本年': 'Year',
    '全年': 'Year',
    'Token 活动': 'Token Activity',
    '每天': 'Daily',
    '每周': 'Weekly',
    '每月': 'Monthly',
    '今年': 'Yearly',
    '累计总量': 'Cumulative',
    '区间合计:': 'Range Total:',
    '预估费用:': 'Est. Cost:',
    '折合每天:': 'Daily Avg:',
    '活跃日均:': 'Active Day Avg:',
    '订阅性价比:': 'Sub Value:',
    '少': 'Less',
    '多': 'More',
    '注：按日聚合按基础档估算，未拆分长上下文分档，结果偏下限。有逐请求记录时优先精确入账。': 'Note: Daily aggregates use base-tier pricing without long-context splits (lower-bound estimate). Per-request records use exact pricing when available.',
    '点击或悬浮格子查看当日详细 Token 构成': 'Click or hover cells for daily breakdown',
    '启动 CLI 终端': 'Launch CLI Terminal',
    '套件设置': 'Suite Settings',
    '配置': 'Settings',
    '上下文窗口：': 'Context Window:',
    '⬆️ 一键更新': '⬆️ Update Now',
    '立即更新': 'Update Now',
    '⏳ 正在更新…': '⏳ Updating…',
    '当前版本状态': 'Current Version Status',
    '拉取最新提交并免重启热生效': 'Pull latest commits and hot-reload without restart',
    '打开 Antigravity Suite 统一设置面板': 'Open Antigravity Suite Settings',
    '发现新版本，点击打开设置一键更新': 'Update available — click to open Settings and update',
    '远程通道与隧道': 'Remote Channels & Tunnel',
    '刷新状态': 'Refresh',
    '重置令牌': 'Reset Token',
    'Remote 页面显示内容': 'Remote Page Visibility',
    '恢复默认': 'Reset Default',
    '顶部上下文窗口面板': 'Topbar Context Window Panel',
    '顶部：历史用量统计面板': 'Topbar: Usage History Panel',
    '顶部模型配额胶囊': 'Topbar Model Quota Pill',
    '顶部：当前连接方式提示': 'Topbar: Connection Status Hint',
    '左侧会话列表栏': 'Left Conversation Sidebar',
    'AI 思考过程折叠区': 'Collapsible Thinking Process',
    '底部快捷操作与下一步建议': 'Bottom Quick Chips & Suggestions',
    '输入区工具栏（模型/权限等）': 'Composer Tools (Model / Perms / Upload)',
    '待审批操作提醒横幅': 'Pending Approvals Banner',
    '快捷提示词': 'Quick Prompts',
    '内置常用指令': 'Built-in commands',
    '💡 指令解读': '💡 Command Guide',
    '⚡直发': '⚡Send',
    '填入': 'Insert',
    '自定义快捷提示词': 'Custom Quick Prompts',
    '填入：仅放进输入框，方便粘贴报错或补充后再发 · ⚡直发：点一下立刻发出（有草稿时自动防误发；按住 ⌘/Ctrl 点击可临时切换）': 'Insert: fills the composer so you can paste errors/details before sending · ⚡Send: sends immediately on click (auto-guards existing drafts; hold ⌘/Ctrl + click to toggle)',
    '暂无自定义快捷提示词，点击右上角「+ 新增」可自由添加': 'No custom prompts yet. Click "+ Add" above to create one.',
    '暂无自定义快捷提示词，点击右侧「+ 新增」可自由添加': 'No custom prompts yet. Click "+ Add" on the right to create one.',
    '+ 新增': '+ Add',
    '热门对话口令模板': 'Popular Quick Prompt Templates',
    '热门口令：': 'Popular:',
    '热门模板': 'Popular Templates',
    '热门模板：': 'Popular:',
    '保存快捷提示词': 'Save Quick Prompts',
    '● 有未保存的更改，请点击右侧「保存快捷提示词」': '● Unsaved changes — click "Save Quick Prompts"',
    '✅ 已清空自定义提示词': '✅ Cleared custom quick prompts',
    '局域网': 'LAN',
    'Cloudflare 隧道': 'Cloudflare Tunnel',
    '固定域名': 'Fixed Domain',
    '公网隧道已停用 · 点击启用公网域名': 'Tunnel disabled · click to enable public access',
    '点击上方复选框或「固定域名」开启公网访问': 'Toggle checkbox or Fixed Domain to enable tunnel',
    '获取 Token 前往 Cloudflare →': 'Get Token on Cloudflare →',
    '前往 Cloudflare 获取 Token →': 'Get Token on Cloudflare →',
    '保存并启用': 'Save & Enable',
    '改用免登录临时隧道': 'Use Quick Tunnel',
    '下载最新版本并立即生效，无需重启': 'Download the latest release and apply immediately without restart',
    '内置快捷按钮（点击开启或关闭 · 悬停查看说明）': 'Built-in Quick Buttons (click to toggle · hover for guide)',
    '从内置常用指令中点选要在输入框上方显示的快捷按钮（点击即可开启或关闭，不可删除）；也可在下方「自定义快捷提示词」中自由新增。': 'Pick from built-in commands to display above the composer (click to toggle, non-deletable), or add your own under "Custom Quick Prompts" below.',
    '点击内置快捷指令时直接发送': 'Send built-in quick commands immediately',
    '开启后点击「/compact 压缩」或「重载规则」会直接发送（需要补充内容的指令仍仅填入输入框）；按住 ⌘/Ctrl 点击可临时切换': 'Send /compact and Reload Rules immediately on click (commands needing extra input still insert only); hold ⌘/Ctrl + click to toggle',
    'CLI 自动批准工具权限（免确认）': 'Auto-Approve CLI Tool Permissions (Skip Prompts)',
    '在命令行启动时自动放行文件修改与命令执行，不再逐次弹窗确认；仅建议在受信任项目开启': 'Automatically allow file edits and command runs without prompts when launching CLI; recommended only for trusted projects',
    '指定启动命令行终端时默认使用的模型；选「不指定」则跟随 CLI 默认配置': 'Select the default model for CLI launch, or choose Unspecified to follow CLI defaults',
    '自定义模型名称（留空则跟随默认配置）': 'Custom Model Name (leave blank for default)',
    '例如：gemini-3.8-flash-high': 'e.g. gemini-3.8-flash-high',
    '终端连接目标（电脑端 / 远程服务器）': 'Terminal Target (Desktop / Remote Server)',
    '仅在使用 Rex、WezTerm 或 tmux 时生效：可选择在当前电脑或远程服务器上启动终端': 'Applies to Rex, WezTerm, or tmux: launch terminal on this desktop or a remote server',
    '远程主机名称（留空则在当前电脑运行）': 'Remote Host Name (leave blank to run locally)',
    '例如：my-server 或 SSH 主机名': 'e.g. my-server or SSH host',
    '240K 自动压缩防卡顿': '240K Auto-Compact Anti-Stall',
    '官方默认满 512K 才整理，对话过长后稍作停顿就容易卡顿数分钟。开启后，上下文满 240K 或发生缓存失效时，会在回复结束且输入框为空时自动发送 /compact 压缩历史': 'Official default waits until 512K to organize context, risking multi-minute stalls after pauses. Auto-sends /compact after replies when context reaches 240K or cache drops',
    '长消息与代码块折叠': 'Fold Long Messages & Code Blocks',
    '超长代码块与历史长回复自动折叠（保留开头摘要，生成中与最新回复保持展开），支持随时一键展开或收起': 'Auto-fold long code blocks and older long replies (keeping leading preview; streaming and latest reply stay expanded) with one-click toggle',
    '重置配对口令': 'Reset Pairing Passcode',
    '重新生成配对口令，旧链接与已配对设备将失效': 'Regenerate pairing passcode (invalidates old links & paired devices)',
    '默认已开启免登录公网通道，点顶部「远程」图标即可用手机扫码连接。如需绑定自己的固定域名，可在下方展开配置。': 'Zero-login public tunnel is enabled by default — click the topbar Remote icon to scan QR and connect. Expand below to bind a custom fixed domain.',
    '手机远程页面显示内容': 'Mobile Remote Page Visibility',
    '恢复手机远程页面默认显示的全部模块': 'Restore default visible modules on mobile remote page',
    '自定义用手机或浏览器打开远程页面时显示的功能模块，勾选或取消后会立即保存并同步生效。': 'Customize modules shown on the mobile/browser remote page; changes save and apply immediately.',
    '命令行与更新代理（可选）': 'CLI & Update Proxy (Optional)',
    '🌐 命令行与更新代理（可选）': '🌐 CLI & Update Proxy (Optional)',
    '代理作用范围与状态': 'Proxy Scope & Status',
    '未启用自定义代理。「>_ CLI」终端、检查更新与远程隧道将跟随系统网络设置；Antigravity 客户端本体的对话联网始终跟随系统代理。': 'Custom proxy is disabled. The CLI launcher, update checks, and remote tunnel follow system network settings; Antigravity chat requests always follow system proxy.',
    '正在发起本地与网络连通性测试…': 'Running local & network connectivity test…',
    '作用范围: 仅用于 CLI 终端、检查更新与远程隧道（本体对话跟随系统代理）': 'Scope: CLI launcher, update checks, and remote tunnel only (host chat follows system proxy)',
    '不走代理的地址（本机地址默认直连）：': 'Bypass Proxy Addresses (Localhost Direct):',
    '底层统计与附件检查': 'Technical Details & Attachments',
    '本地估算（可能未计入附件）': 'Local Estimate (excl. attachments)',
    '客户端预算上限': 'Client Budget Limit',
    '附件逐项检查': 'Attachment Audit',
    '注：此处按公开 API 单价折算同等用量，仅供价值参考。包月订阅或活动赠送与按量付费不同，差额不代表实际省下的现金；缓存读取按 1 折估算，不含缓存存储费；同一上下文在多轮中会重复计入缓存读取，总量不代表实际输入字数。': 'Note: Converted at public API rates for value reference only. Subscriptions/promos differ from pay-as-you-go; difference is not cash saved. Cache reads use 10% rate (excl. cache storage) and may count shared context across turns.',
    '说明：每日统计按基础费率估算（未单独拆分长上下文阶梯价），实际金额可能略高；若有逐次请求记录则优先按实计算。': 'Note: Daily estimates use base-tier rates without long-context tiering (actuals may be slightly higher); per-request logs use exact pricing when available.',
    '创建后台定时巡检或一次性倒计时提醒任务，到点自动唤醒。': 'Schedule a background periodic check or one-time timer reminder.',
    '一键提取并复制当前对话窗口的会话 ID。': 'Extract and copy the current conversation ID to the clipboard.',
    '刷新远程连接通道与隧道状态': 'Refresh remote channels and tunnel status',
    '恢复默认快捷提示词': 'Reset to default quick prompts',
    '内置指令实时解读': 'Built-in command guide',
    '添加一条快捷提示词': 'Add a custom quick prompt',
    '重新扫描本机已安装的终端程序': 'Rescan locally installed terminal apps',
    '输入或选择可执行程序路径（如 /Applications/Ghostty.app 或 C:\\Program Files\\Git\\git-bash.exe）': 'Enter or browse executable path (e.g. /Applications/Ghostty.app or C:\\Program Files\\Git\\git-bash.exe)',
    '在当前项目目录尝试打开所选终端以验证路径与权限': 'Try launching the selected terminal in the current project directory',
    'GitHub 仓库有新提交': 'New commits available on GitHub',
    '当前为手动安装版，暂不支持在线一键更新，如需更新请前往项目页下载新版覆盖安装': 'Manual installation does not support one-click updates; download the latest release from the project page to update',
    '当前版本与仓库同步': 'Current version is up to date',
    '已完成热更新': 'Updated and applied immediately',
    '更新未完成（当前版本与配置不受影响），请检查网络或代理后重试': 'Update incomplete (your current version and settings are safe); check your network or proxy and try again',
    '暂时无法连接更新服务器，请检查网络或代理设置后重试': 'Unable to reach the update server; check your network or proxy and try again',
    '侧栏：模型额度卡': 'Sidebar: Model Quota',
    'Codex 主题与侧栏额度样式': 'Codex Theme & Sidebar Quota Style',
    '启用 Codex 纯白 / 炭黑界面主题': 'Enable Codex Pure Light / Charcoal Theme',
    '覆盖宿主编辑器与对话区为高对比度纯白 / 炭黑配色，并同步原生标题栏': 'Override host editor and chat with high-contrast pure light / charcoal palettes and sync native titlebar',
    '侧边栏额度显示范围': 'Sidebar Quota Display Scope',
    '控制左下角额度卡片默认追踪全部模型或固定显示指定模型池': 'Choose whether the sidebar quota card follows the active model or pins a specific pool',
    '自动跟随当前模型': 'Auto-follow Active Model',
    '固定仅显示 Gemini': 'Pin Gemini Only',
    '固定仅显示 Claude / GPT': 'Pin Claude / GPT Only',
    '当前模型组样式': 'Active Pool Style',
    '切换当前正在使用模型池的进度条与仪表样式': 'Choose the progress bar or gauge style for the active model pool',
    '连续进度条': 'Continuous Bar',
    '五段格': '5 Segments',
    '双圆环': 'Dual Rings',
    '仪表盘': 'Gauge',
    '点阵': 'Dot Matrix',
    '精简刻度': 'Compact Scale',
    '其他模型组样式': 'Other Pools Style',
    '设置未在使用中模型池的展示方式或将其隐藏': 'Choose how inactive model pools are displayed or hide them',
    '隐藏': 'Hidden',
    '进度细线': 'Thin Lines',
    '纯文字': 'Text Only',
    '迷你五段': 'Mini Segments',
    '迷你圆环': 'Mini Rings',
    '双列横条': 'Dual Rows',
    '提示：SVG 视觉样式预览以及界面 / 对话 / 代码三区自定义本地字体，也可在 Antigravity 原生「设置 → Suite 外观与额度」中直接配置。': 'Tip: SVG style previews and custom local fonts (UI / Chat / Code) can also be configured directly in Antigravity Settings → Suite Appearance & Quota.'
  };

  function translateSuiteDynamicFragmentEn(fragment) {
    return String(fragment || '')
      .replace(/Terminal\s*\(系统终端\)/g, 'Terminal (System)')
      .replace(/CMD\s*\(命令提示符\)/g, 'CMD (Command Prompt)')
      .replace(/WSL\s*\(Linux 子系统\)/g, 'WSL (Linux Subsystem)')
      .replace(/tmux\s*\(多路复用器\)/g, 'tmux (Multiplexer)')
      .replace(/原生居中控制台/g, 'Native Centered Console')
      .replace(/自动默认\s*\(([^)]+)\)/g, 'Auto Default ($1)')
      .replace(/自定义程序路径/g, 'Custom Path')
      .replace(/未设置路径/g, 'No path set')
      .replace(/系统默认/g, 'System Default')
      .replace(/默认目录/g, 'Default Folder')
      .replace(/模型:\s*默认/g, 'Model: Default')
      .replace(/模型:/g, 'Model:')
      .replace(/主机:\s*本机/g, 'Host: Local')
      .replace(/主机:/g, 'Host:')
      .replace(/免审核/g, 'Skip Perms')
      .replace(/标准权限/g, 'Standard Perms');
  }

  const SUITE_EN_UI_PATTERNS = [
    [/^当前使用：([\s\S]+)$/, (_, rest) => `Active: ${translateSuiteDynamicFragmentEn(rest)}`],
    [/^当前套餐：([\s\S]+)$/, (_, rest) => `Current Plan: ${rest}`],
    [/^首次使用：([\s\S]+)$/, (_, rest) => `First used: ${rest}`],
    [/^✅ 测试启动成功：([\s\S]+)$/, (_, rest) => `✅ Test launch succeeded: ${translateSuiteDynamicFragmentEn(rest)}`],
    [/^✖ 测试启动失败：([\s\S]+)$/, (_, rest) => `✖ Test launch failed: ${translateSuiteDynamicFragmentEn(rest)}`],
    [/^(\d[\d,]*) 会话实时累加$/, '$1 sessions tracked'],
    [/^日均约 ([\s\S]+)$/, 'Daily avg ~$1'],
    [/^(\d[\d,]*) 天活动记录$/, '$1 active days'],
    [/^(≈ \$[\s\S]+?) · 日均 (\$[\d.,]+)$/, '$1 · Avg $2/day'],
    [/^· 今日 ([\s\S]+)$/, '· Today $1'],
    [/^(\$[\d.,]+)\s*\((\d+)天\)$/, '$1 ($2d)'],
    [/^(\d+)月$/, (_, m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || `${m}M`],
    [/^周累计 \(折合日均 (\$[\d.,]+)\)$/, 'Weekly Total (Avg $1/day)'],
    [/^截至当日累计 \(折合日均 (\$[\d.,]+)\)$/, 'Cumulative Total (Avg $1/day)'],
    [/^月累计 · 折合日均 (\$[\d.,]+) \(活跃 (\d+) 天\)$/, 'Monthly Total · Avg $1/day ($2 active days)'],
    [/^v([^\s(]+)\s*\(([0-9a-f]+)\s*·\s*已是最新\)$/i, 'v$1 ($2 · Up to date)'],
    [/^v([^\s(]+)\s*·\s*已是最新$/i, 'v$1 · Up to date'],
    [/^🔔 有新更新 \(\+(\d+)\s*·\s*([0-9a-f]+)\)$/i, '🔔 +$1 update(s) ($2)'],
    [/^✅ 已更新至 v([^\s(]+)\s*\(([0-9a-f]+)\)$/i, '✅ Updated to v$1 ($2)'],
    [/^v([^\s(]+)\s*[（(]手动安装版[）)]$/i, 'v$1 (Manual Install)'],
    [/^当前提交[：:]\s*([\s\S]+)$/, 'Current commit: $1'],
    [/^最新提交[：:]\s*([\s\S]+)$/, 'Latest commit: $1'],
    [/^暂时无法检查更新[：:]\s*([\s\S]+)$/, (_, d) => `Unable to check updates: ${/[\u4e00-\u9fff]/.test(d) ? 'check network or proxy and retry' : d}`],
    [/^远端检查失败[：:]\s*([\s\S]+)$/, (_, d) => `Remote check failed: ${/[\u4e00-\u9fff]/.test(d) ? 'check network or proxy and retry' : d}`],
    [/^✖ 更新失败：([\s\S]+)$/, (_, reason) => {
      const clean = String(reason || '').trim();
      if (!clean || /[\u4e00-\u9fff]/.test(clean)) {
        if (/手动安装/.test(clean)) return '✖ Update failed: manual installation requires manual update';
        if (/本地.*修改|未提交/.test(clean)) return '✖ Update failed: local changes detected, auto-update paused';
        return '✖ Update failed: check network or proxy and retry';
      }
      return `✖ Update failed: ${clean}`;
    }],
    [/^已立即生效（当前地址:\s*([\s\S]+?)）。仅用于「>_ CLI」终端启动、检查套件更新与远程隧道；因当前采用零改包运行，Antigravity 客户端本体的对话联网仍跟随系统代理。$/, (_, url) => `Active now (Proxy URL: ${url === '未填写' ? 'Not set' : url}). Applies to CLI launcher, update checks, and remote tunnel only; in zero-patch mode, Antigravity chat traffic always follows the system proxy.`],
    [/^检测代理设置(?:失败|异常):\s*([\s\S]+)$/, (_, d) => `Failed to inspect proxy settings: ${d}`]
  ];

  const convertSuiteToZhTW = (raw) => {
    const fn = (typeof globalThis !== 'undefined' && typeof globalThis.__AG_ZH_TW_CONVERT__ === 'function')
      ? globalThis.__AG_ZH_TW_CONVERT__
      : ((typeof window !== 'undefined' && typeof window.__AG_ZH_TW_CONVERT__ === 'function') ? window.__AG_ZH_TW_CONVERT__ : null);
    return fn ? fn(raw) : raw;
  };

  const SUITE_ZH_TW_UI_DICT = {
    'Antigravity Suite 统一设置': 'Antigravity Suite 統一設定',
    '套件统一设置': '套件統一設定',
    '关闭设置': '關閉設定',
    '设置分类': '設定分類',
    '🌐 语言与外观': '🌐 語言與外觀',
    '📱 远程设置': '📱 遠端設定',
    '⚡ 对话与效率': '⚡ 對話與效率',
    '🧰 终端与网络': '🧰 終端機與網路',
    '📊 套餐与订阅': '📊 方案與訂閱',
    '语言与明暗外观': '語言與明暗外觀',
    '面板深浅外观': '面板深淺外觀',
    '跟随客户端': '跟隨用戶端',
    '桌面功能显示开关': '桌面功能顯示開關',
    '对话自动化与安全策略': '對話自動化與安全策略',
    '自定义强调色与顶栏分项配色': '自訂強調色與頂部列分項配色',
    'macOS Dock 未读与状态提醒': 'macOS Dock 未讀與狀態提醒',
    '选项名保留英文': '選項名保留英文',
    '模式与档位名保留英文': '模式與等級名保留英文',
    '5 档色阶预设：': '5 級色階預設：',
    '恢复 5 档预设': '恢復 5 級預設',
    '累计处理 Token': '累計處理 Token',
    '总计': '總計',
    '今日使用': '今日使用',
    '今日': '今日',
    '本月使用': '本月使用',
    '本月': '本月',
    '年度使用': '年度使用',
    '本年': '本年',
    '无限': '無限'
  };

  const SUITE_SUPPORTED_LOCALES = [
    { code: 'zh-TW', hansCode: 'zh-TW', capsuleLang: 'zh-TW', label: '繁體中文 · Traditional Chinese', uiDict: SUITE_ZH_TW_UI_DICT, uiPatterns: null, uiTransform: convertSuiteToZhTW },
    { code: 'zh-CN', hansCode: 'zh', capsuleLang: 'zh', label: '简体中文 · Simplified Chinese', uiDict: null, uiPatterns: null, uiTransform: null },
    { code: 'en', hansCode: 'en', capsuleLang: 'en', label: 'English · 英文原版', uiDict: SUITE_EN_UI_DICT, uiPatterns: SUITE_EN_UI_PATTERNS, uiTransform: null }
  ];

  let suiteTerminalState = {
    terminalApp: 'auto',
    customTerminalPath: '',
    cliSkipPermissions: false,
    cliDefaultModel: '',
    cliMuxHost: '',
    muxHosts: [],
    terminals: [],
    platform: (typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent || '')) ? 'win32' : 'darwin'
  };
  let suiteEnhancerPrefs = {
    autoAccept: false,
    ghostSuggest: true,
    autoCompact: true,
    longFold: true,
    quickBuiltinAutoSend: false,
    dockBadgeEnabled: true,
    dockBadgeStyle: 'capsule',
    dockBadgeColorTier: true,
    dockBadgeAutoClear: true,
    locale: 'zh-TW',
    capsuleLang: 'zh-TW',
    englishLabels: false
  };
  const DEFAULT_SUITE_FEATURE_FLAGS = {
    showTopbarTokens: true,
    showTopbarCli: true,
    showTopbarQuota: true,
    showTopbarRemote: true,
    showQuickBar: true,
    showChatNav: true
  };
  let suiteFeatureFlags = { ...DEFAULT_SUITE_FEATURE_FLAGS };

  const CODEX_QUOTA_STYLES = ['segments', 'bar', 'rings', 'gauge', 'dots', 'compact'];
  const CODEX_QUOTA_OTHER_STYLES = ['lines', 'text', 'segments', 'rings', 'rows', 'hidden'];
  const CODEX_QUOTA_POOL_FILTERS = ['all', 'gemini-only', 'claude-only'];
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

  function normalizeCodexUiConfig(raw, base = DEFAULT_CODEX_UI) {
    const ref = base && typeof base === 'object' ? base : DEFAULT_CODEX_UI;
    const src = raw && typeof raw === 'object' ? raw : {};
    const srcFonts = src.fonts && typeof src.fonts === 'object' ? src.fonts : {};
    const refFonts = ref.fonts && typeof ref.fonts === 'object' ? ref.fonts : DEFAULT_CODEX_UI.fonts;
    const rawStyle = String(src.quotaStyle ?? ref.quotaStyle ?? 'bar').trim().toLowerCase();
    const rawOther = String(src.quotaOtherStyle ?? ref.quotaOtherStyle ?? 'hidden').trim().toLowerCase();
    const rawFilter = String(src.quotaPoolFilter ?? ref.quotaPoolFilter ?? 'all').trim().toLowerCase();
    const rawMode = srcFonts.mode !== undefined ? srcFonts.mode : refFonts.mode;
    return {
      quotaSidebar: src.quotaSidebar !== undefined ? Boolean(src.quotaSidebar) : ref.quotaSidebar !== false,
      quotaStyle: CODEX_QUOTA_STYLES.includes(rawStyle) ? rawStyle : 'bar',
      quotaOtherStyle: CODEX_QUOTA_OTHER_STYLES.includes(rawOther) ? rawOther : 'hidden',
      quotaPoolFilter: CODEX_QUOTA_POOL_FILTERS.includes(rawFilter) ? rawFilter : 'all',
      codexTheme: src.codexTheme !== undefined ? Boolean(src.codexTheme) : Boolean(ref.codexTheme),
      deadlockHealer: src.deadlockHealer !== undefined ? Boolean(src.deadlockHealer) : ref.deadlockHealer !== false,
      zoomShortcuts: src.zoomShortcuts !== undefined ? Boolean(src.zoomShortcuts) : ref.zoomShortcuts !== false,
      fonts: {
        mode: rawMode === 'split' ? 'split' : 'global',
        global: typeof srcFonts.global === 'string' ? srcFonts.global : (typeof refFonts.global === 'string' ? refFonts.global : ''),
        ui: typeof srcFonts.ui === 'string' ? srcFonts.ui : (typeof refFonts.ui === 'string' ? refFonts.ui : ''),
        chat: typeof srcFonts.chat === 'string' ? srcFonts.chat : (typeof refFonts.chat === 'string' ? refFonts.chat : ''),
        code: typeof srcFonts.code === 'string' ? srcFonts.code : (typeof refFonts.code === 'string' ? refFonts.code : '')
      }
    };
  }

  function cloneCodexUiConfig(cfg) {
    const norm = normalizeCodexUiConfig(cfg);
    return {
      ...norm,
      fonts: { ...norm.fonts }
    };
  }

  let suiteCodexUi = cloneCodexUiConfig(DEFAULT_CODEX_UI);

  const QUICK_POOL_GROUPS = [
    { id: 'daily', title: '🔥 日常高频与上下文', titleEn: '🔥 Daily & Context' },
    { id: 'heavy', title: '🚀 复杂攻坚与多 Agent', titleEn: '🚀 Complex & Multi-Agent' },
    { id: 'tools', title: '🛠️ 会话工具与规则', titleEn: '🛠️ Session Tools & Rules' }
  ];

  const BUILTIN_QUICK_POOL = [
    {
      id: 'compact',
      group: 'daily',
      label: '/compact 压缩',
      labelEn: '/compact',
      text: '/compact',
      rec: '★必开',
      recEn: '★Must',
      tag: '防卡死',
      tagEn: 'Anti-Stall',
      role: '触发官方本地压缩，将冗长历史浓缩为高密度摘要。',
      roleEn: 'Triggers native compaction to summarize long conversation history.',
      scene: '上下文超过 150K~240K、响应变慢，或切换下一阶段任务前。',
      sceneEn: 'When context exceeds 150K-240K, slows down, or before switching sub-tasks.',
      title: '压缩上下文（执行官方 /compact 命令），防止超 240K~300K 缓存过期卡死',
      titleEn: 'Compact context via native /compact command',
      defaultEnabled: true
    },
    {
      id: 'plan',
      group: 'daily',
      label: '/plan 规划',
      labelEn: '/plan',
      text: '/plan ',
      rec: '★推荐',
      recEn: '★Rec',
      tag: '先谋后动',
      tagEn: 'Plan First',
      role: '切换规划模式，强制先读代码并给出方案，确认后再动手改文件。',
      roleEn: 'Enter planning mode to inspect code and propose a plan before editing.',
      scene: '涉及多文件改造、架构调整，想先审阅思路再让 AI 动手时。',
      sceneEn: 'Multi-file changes or architectural edits where you want to approve a plan first.',
      title: '进入或切换规划模式，先出方案再动手改代码',
      titleEn: 'Enter plan mode via /plan',
      defaultEnabled: true
    },
    {
      id: 'grill-me',
      group: 'daily',
      label: '/grill-me 追问对齐',
      labelEn: '/grill-me',
      text: '/grill-me ',
      rec: '★推荐',
      recEn: '★Rec',
      tag: '需求澄清',
      tagEn: 'Clarify',
      role: '让 AI 像面试官一样连环追问，逐项确认模糊需求与边界条件。',
      roleEn: 'Have the AI interview you relentlessly to clarify requirements and edge cases.',
      scene: '只有一个大概想法、细节还没想透，怕 AI 自作主张乱写时。',
      sceneEn: 'When your idea is still rough and you want alignment before execution.',
      title: '让 AI 像面试一样主动追问，把模糊需求与边界全部对齐',
      titleEn: 'Interview me to align on requirements and plan',
      defaultEnabled: false
    },
    {
      id: 'btw',
      group: 'daily',
      label: '/btw 插话提问',
      labelEn: '/btw',
      text: '/btw ',
      rec: '',
      recEn: '',
      tag: '旁路问答',
      tagEn: 'Side Q',
      role: '开启轻量旁路问答，不打断当前主线进度也不污染主上下文。',
      roleEn: 'Ask a quick side question without interrupting the main conversation flow.',
      scene: '主线正在跑任务，你想顺手确认某条语法、报错或无关知识点。',
      sceneEn: 'Quickly checking syntax or concepts without derailing the main task.',
      title: '不打断主线上下文，临时快速旁路提问',
      titleEn: 'Ask a quick side question without interrupting main chat',
      defaultEnabled: false
    },
    {
      id: 'learn',
      group: 'daily',
      label: '/learn 提炼经验',
      labelEn: '/learn',
      text: '/learn ',
      rec: '',
      recEn: '',
      tag: '规则沉淀',
      tagEn: 'Learn',
      role: '复盘本轮对话中你的纠正或成功路径，沉淀为可复用的规则或 Skill。',
      roleEn: 'Reflect on corrections or setups from this turn into reusable rules or skills.',
      scene: '费了多轮才教会 AI 某件事，希望它下次永远直接做对时。',
      sceneEn: 'After correcting the agent or solving a tricky setup to persist the workflow.',
      title: '复盘本轮纠偏与踩坑，沉淀为长期规则或 Skill',
      titleEn: 'Capture lessons learned as reusable skills or rules',
      defaultEnabled: false
    },
    {
      id: 'goal',
      group: 'heavy',
      label: '/goal 持续到底',
      labelEn: '/goal',
      text: '/goal ',
      rec: '★推荐',
      recEn: '★Rec',
      tag: '长程死磕',
      tagEn: 'Long Run',
      role: '开启长程目标循环模式，反复校验执行直到目标彻底达成。',
      roleEn: 'Run relentlessly toward the specified goal until every criterion is verified.',
      scene: '全量测试修完所有报错、批量机械重构、夜间挂机跑完长任务。',
      sceneEn: 'Fixing all failing tests, large refactors, or unattended long-horizon runs.',
      title: '启动长程自主目标模式，持续推进直到目标彻底完成',
      titleEn: 'Run until the specified goal is completely finished',
      defaultEnabled: false
    },
    {
      id: 'boost',
      group: 'heavy',
      label: '/boost 深度攻坚',
      labelEn: '/boost',
      text: '/boost ',
      rec: '★推荐',
      recEn: '★Rec',
      tag: '单点深研',
      tagEn: 'Deep Dive',
      role: '调用 Boost 多智能体编排器，深度推理并从多视角严格校验。',
      roleEn: 'Invoke the Boost multi-agent orchestrator for deep thinking and strict verification.',
      scene: '棘手疑难 Bug 反复修不好、复杂算法或需要严密论证的核心工程。',
      sceneEn: 'Hard bugs, intricate algorithms, or research/code needing rigorous verification.',
      title: '调用 Boost 多模型深度推理与严格验证编排',
      titleEn: 'Invoke Boost multi-agent orchestrator for complex tasks',
      defaultEnabled: false
    },
    {
      id: 'swarm',
      group: 'heavy',
      label: '/swarm 蜂群并发',
      labelEn: '/swarm',
      text: '/swarm ',
      rec: '',
      recEn: '',
      tag: '横向分包',
      tagEn: 'Parallel',
      role: '主 Agent 当协调者，在共享消息板上同时派多名工人+复核员并行分工。',
      roleEn: 'Spawn parallel workers collaborating through a shared message board.',
      scene: '可拆成多个互不冲突的子任务并行提速（改多文件/交叉审查，极耗额度）。',
      sceneEn: 'Independent subtasks that can run simultaneously or need peer verification (quota heavy).',
      title: '调度多个子 Agent 并发协作拆分复杂任务',
      titleEn: 'Spawn parallel agents collaborating on one task',
      defaultEnabled: false
    },
    {
      id: 'teamwork',
      group: 'heavy',
      label: '/teamwork 团队协作',
      labelEn: '/teamwork',
      text: '/teamwork ',
      rec: '',
      recEn: '',
      tag: '军团流水',
      tagEn: 'Pipeline',
      role: '启动 Agent 团队接手项目，依序执行探查、拆解、求解、审查与修补。',
      roleEn: 'Invoke an autonomous 5-phase team pipeline to tackle large projects end-to-end.',
      scene: '超大型工程重构或从零搭建完整大项目，希望团队全自动一条龙交付。',
      sceneEn: 'Large projects or greenfield builds best handled by a full autonomous team.',
      title: '调动自治 Agent 团队接管大型复杂项目',
      titleEn: 'Invoke autonomous agent team for large projects',
      defaultEnabled: false
    },
    {
      id: 'browser',
      group: 'heavy',
      label: '/browser 浏览器',
      labelEn: '/browser',
      text: '/browser ',
      rec: '',
      recEn: '',
      tag: '网页实操',
      tagEn: 'Web UI',
      role: '派遣内置浏览器子 Agent 访问网页、点击填表并截取视觉状态。',
      roleEn: 'Launch the browser subagent to navigate, click, fill forms, and inspect UI.',
      scene: '验证 localhost 前端页面表现、检查 UI 错位或跑通网页端交互流程。',
      sceneEn: 'Testing localhost web apps, verifying rendered UI, or interactive web flows.',
      title: '唤醒浏览器子 Agent 执行网页操作与核验',
      titleEn: 'Invoke browser agent for web tasks',
      defaultEnabled: false
    },
    {
      id: 'schedule',
      group: 'heavy',
      label: '/schedule 定时任务',
      labelEn: '/schedule',
      text: '/schedule ',
      rec: '',
      recEn: '',
      tag: '定时巡检',
      tagEn: 'Cron',
      role: '创建后台定时巡检或一次性倒计时提醒任务，到点自动唤醒。',
      roleEn: 'Schedule a recurring cron job or a one-time delayed timer notification.',
      scene: '每 N 分钟巡检构建/服务状态，或约定稍后自动触发某项检查。',
      sceneEn: 'Periodic monitoring, polling builds, or setting a delayed reminder.',
      title: '创建定时轮询或一次性定时提醒任务',
      titleEn: 'Schedule a recurring cron or one-shot timer',
      defaultEnabled: false
    },
    {
      id: 'reload',
      group: 'tools',
      label: '重载规则',
      labelEn: 'Reload Rules',
      text: '重新读取 AGENTS',
      rec: '★默认',
      recEn: '★Default',
      tag: '恢复约束',
      tagEn: 'Rules',
      role: '一键填入「重新读取 AGENTS」，让 AI 立刻重新加载全局行为规则。',
      roleEn: 'Insert "Reload AGENTS" so the agent immediately re-reads ~/.codex/AGENTS.md.',
      scene: '刚改完 AGENTS.md 配置文件，或长对话后觉得 AI 忘了约定规矩时。',
      sceneEn: 'Right after editing AGENTS.md or when guidelines start drifting in long chats.',
      title: '让 AI 重新读取 ~/.codex/AGENTS.md 行为规则',
      titleEn: 'Fill reload AGENTS prompt',
      defaultEnabled: true
    },
    {
      id: 'copyid',
      group: 'tools',
      label: '复制会话 ID',
      labelEn: 'Copy ID',
      text: '',
      rec: '★默认',
      recEn: '★Default',
      tag: '快速取值',
      tagEn: 'Copy ID',
      role: '一键提取并复制当前对话窗口的会话 ID。',
      roleEn: 'Extract and copy the current conversation UUID to the clipboard.',
      scene: '需要在终端定位当前会话日志，或在另一扇窗口中引用本会话时。',
      sceneEn: 'Checking session transcript logs or referencing this conversation elsewhere.',
      title: '一键复制当前对话窗口的会话 ID',
      titleEn: 'Copy current conversation ID',
      defaultEnabled: true
    },
    {
      id: 'export',
      group: 'tools',
      label: '导出 Markdown',
      labelEn: 'Export MD',
      text: '',
      rec: '★默认',
      recEn: '★Default',
      tag: '对话归档',
      tagEn: 'Archive',
      role: '将当前完整对话导出为 Markdown 保存到 ~/Downloads 并复制。',
      roleEn: 'Export the full conversation as Markdown to ~/Downloads and copy it.',
      scene: '重要问题排查过程归档留存、发给他人复盘或跨工具交接上下文。',
      sceneEn: 'Archiving troubleshooting records, sharing logs, or migrating context.',
      title: '将完整对话导出为 Markdown 保存到 ~/Downloads 并复制',
      titleEn: 'Export conversation to Markdown in ~/Downloads and copy',
      defaultEnabled: true
    }
  ];
  const DEFAULT_QUICK_POOL_STATE = Object.fromEntries(
    BUILTIN_QUICK_POOL.map(item => [item.id, Boolean(item.defaultEnabled)])
  );

  // 自定义快捷提示词区热门对话口令模板（前 8 项免参即发预设 ⚡直发，后 2 项带上下文预设 填入）
  const POPULAR_QUICK_PROMPT_TEMPLATES = [
    { id: 'tpl-implement', label: '直接实现', labelEn: 'Implement', text: '直接实现', textEn: 'Implement directly', autoSend: true },
    { id: 'tpl-zh', label: '用中文回答', labelEn: 'Reply ZH', text: '用中文回答', textEn: 'Reply in Chinese', autoSend: true },
    { id: 'tpl-continue', label: '继续', labelEn: 'Continue', text: '继续', textEn: 'Continue', autoSend: true },
    { id: 'tpl-no-explain', label: '不要解释', labelEn: 'No Explain', text: '不要解释', textEn: 'No explanation, just give the result', autoSend: true },
    { id: 'tpl-fix-err', label: '修复这个报错', labelEn: 'Fix Error', text: '修复这个报错：\n', textEn: 'Fix this error:\n', autoSend: false },
    { id: 'tpl-req', label: '按这个需求做', labelEn: 'Do Spec', text: '按这个需求做：\n', textEn: 'Implement per this requirement:\n', autoSend: false },
    { id: 'tpl-run', label: '跑一下', labelEn: 'Run It', text: '跑一下', textEn: 'Run and verify', autoSend: true },
    { id: 'tpl-optimize', label: '优化一下', labelEn: 'Optimize', text: '优化一下', textEn: 'Optimize this', autoSend: true },
    { id: 'tpl-why', label: '为什么不行', labelEn: 'Why Failed', text: '为什么不行', textEn: 'Why did this fail?', autoSend: true },
    { id: 'tpl-revise', label: '再改一版', labelEn: 'Revise', text: '再改一版', textEn: 'Revise another version', autoSend: true }
  ];

  function sanitizeQuickPoolState(raw, fallbackState = DEFAULT_QUICK_POOL_STATE) {
    const out = { ...DEFAULT_QUICK_POOL_STATE, ...(fallbackState && typeof fallbackState === 'object' ? fallbackState : {}) };
    if (raw && typeof raw === 'object') {
      for (const item of BUILTIN_QUICK_POOL) {
        if (typeof raw[item.id] === 'boolean') {
          out[item.id] = raw[item.id];
        }
      }
    }
    return out;
  }

  function isLegacyDefaultPromptItem(item) {
    if (!item || typeof item !== 'object') return false;
    const id = String(item.id || '').trim();
    if (id !== 'compact' && id !== 'plan' && id !== 'reload') return false;
    const poolDef = BUILTIN_QUICK_POOL.find(p => p.id === id);
    return Boolean(
      poolDef &&
      String(item.text || '').trim() === String(poolDef.text || '').trim() &&
      String(item.label || '').trim() === String(poolDef.label || '').trim()
    );
  }

  function sanitizeQuickPromptsList(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item !== 'object') continue;
      const label = String(item.label ?? '').trim();
      const text = String(item.text ?? '');
      if (!label || !text.trim()) continue;
      if (isLegacyDefaultPromptItem(item)) continue;
      const rawId = String(item.id || '').trim();
      const id = rawId && /^[a-zA-Z0-9_-]{1,32}$/.test(rawId) ? rawId : `custom-${i}`;
      out.push({
        id,
        label: label.slice(0, 40),
        text: text.slice(0, 2000),
        title: String(item.title || '').trim().slice(0, 120),
        autoSend: Boolean(item.autoSend)
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  let suiteQuickPool = (() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ag_suite_quick_pool') : '';
      if (raw) {
        return sanitizeQuickPoolState(JSON.parse(raw));
      }
    } catch {}
    return { ...DEFAULT_QUICK_POOL_STATE };
  })();

  let suiteQuickPrompts = (() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ag_suite_quick_prompts') : '';
      if (raw) {
        const rawArr = JSON.parse(raw);
        if (Array.isArray(rawArr)) {
          const hasStoredPool = Boolean(localStorage?.getItem?.('ag_suite_quick_pool'));
          if (!hasStoredPool) {
            for (const item of rawArr) {
              if (isLegacyDefaultPromptItem(item) && item.enabled === false) {
                suiteQuickPool[item.id] = false;
              }
            }
          }
          const parsed = sanitizeQuickPromptsList(rawArr);
          if (parsed && parsed.length > 0) return parsed;
        }
      }
    } catch {}
    return null;
  })();

  // 自定义快捷提示词编辑态跟踪与未保存保护，防止后台轮询/状态同步刷新冲掉正在输入的内容
  let quickPromptsEditorDirty = false;

  function isNodeInsideContainer(container, node) {
    if (!container || !node) return false;
    if (typeof container.contains === 'function') {
      try { if (container.contains(node)) return true; } catch {}
    }
    let cur = node;
    while (cur) {
      if (cur === container) return true;
      cur = cur.parentElement || cur.parentNode || null;
    }
    return false;
  }

  function isSameQuickPromptsList(a, b) {
    const listA = Array.isArray(a) ? a : [];
    const listB = Array.isArray(b) ? b : [];
    if (listA.length !== listB.length) return false;
    for (let i = 0; i < listA.length; i++) {
      const ia = listA[i] || {};
      const ib = listB[i] || {};
      if (
        String(ia.id || '') !== String(ib.id || '') ||
        String(ia.label || '') !== String(ib.label || '') ||
        String(ia.text || '') !== String(ib.text || '') ||
        Boolean(ia.autoSend) !== Boolean(ib.autoSend)
      ) {
        return false;
      }
    }
    return true;
  }

  function setQuickPromptsStatus(text, tone = '') {
    const statusEl = el('quick-prompts-status');
    if (!statusEl) return;
    statusEl.textContent = String(text || '');
    if (tone) statusEl.setAttribute('data-tone', tone);
    else statusEl.removeAttribute('data-tone');
  }

  function syncQuickPromptsDirtyUi() {
    const saveBtn = el('btn-save-quick-prompts');
    if (!saveBtn) return;
    if (quickPromptsEditorDirty) saveBtn.setAttribute('data-dirty', 'true');
    else saveBtn.removeAttribute('data-dirty');
  }

  function markQuickPromptsEditorDirty(showHint = true) {
    quickPromptsEditorDirty = true;
    syncQuickPromptsDirtyUi();
    if (showHint) {
      setQuickPromptsStatus(
        suiteTr('● 有未保存的更改，请点击右侧「保存快捷提示词」', '● Unsaved changes — click "Save Quick Prompts"'),
        'dirty'
      );
    }
  }

  function clearQuickPromptsEditorDirty() {
    quickPromptsEditorDirty = false;
    syncQuickPromptsDirtyUi();
  }

  function getQuickPromptEditorRows() {
    const listEl = el('quick-prompts-editor-list');
    if (!listEl || typeof listEl.querySelectorAll !== 'function') return [];
    return Array.from(listEl.querySelectorAll('.qp-row') || []);
  }

  function hasUnsavedQuickPromptDraftRows() {
    return getQuickPromptEditorRows().some(row => row.getAttribute?.('data-qp-saved') !== 'true');
  }

  function hasPartialOrModifiedQuickPromptRows() {
    const rows = getQuickPromptEditorRows();
    if (rows.length === 0) return false;
    const saved = Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts : [];
    if (rows.length !== saved.length) return true;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const label = String(row.querySelector?.('.qp-label-input')?.value || '').trim();
      const text = String(row.querySelector?.('.qp-text-input')?.value || '');
      const autoSend = row.querySelector?.('.qp-autosend-btn')?.getAttribute?.('data-auto-send') === 'true';
      if (Boolean(label) !== Boolean(text.trim())) return true;
      const item = saved[i] || {};
      if (
        label !== String(item.label || '').trim() ||
        text !== String(item.text || '') ||
        autoSend !== Boolean(item.autoSend)
      ) {
        return true;
      }
    }
    return false;
  }

  function isQuickPromptsEditorActiveOrDirty() {
    if (quickPromptsEditorDirty) return true;
    if (hasUnsavedQuickPromptDraftRows()) return true;
    const listEl = el('quick-prompts-editor-list');
    if (!listEl) return false;
    const activeShadow = shadow?.activeElement || null;
    const activeDoc = typeof document !== 'undefined' ? (document.activeElement || null) : null;
    if (isNodeInsideContainer(listEl, activeShadow) || isNodeInsideContainer(listEl, activeDoc)) {
      return true;
    }
    const hasMountedContent = Boolean(listEl.querySelector?.('.qp-row') || listEl.querySelector?.('.qp-empty-hint'));
    if (hasMountedContent && hasPartialOrModifiedQuickPromptRows()) {
      return true;
    }
    return false;
  }

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
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [k, defVal] of Object.entries(DEFAULT_REMOTE_DISPLAY_CONFIG)) {
      out[k] = typeof src[k] === 'boolean' ? src[k] : defVal;
    }
    return out;
  }

  const REMOTE_DISPLAY_BINDINGS = [
    ['set-remote-ctx-panel', 'showContextPanel'],
    ['set-remote-usage-panel', 'showUsagePanel'],
    ['set-remote-quota-pill', 'showQuotaPill'],
    ['set-remote-channel-meta', 'showChannelMeta'],
    ['set-remote-sidebar', 'showSidebar'],
    ['set-remote-thinking', 'showThinking'],
    ['set-remote-quick-chips', 'showQuickChips'],
    ['set-remote-composer-tools', 'showComposerTools'],
    ['set-remote-approvals', 'showApprovals']
  ];

  const DEFAULT_CLOUDFLARED_INSTALL_COMMANDS = {
    darwin: 'brew install cloudflared',
    win32: 'winget install --id Cloudflare.cloudflared',
    linux: 'mkdir -p ~/.local/bin && curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared'
  };

  const remoteSettingsState = {
    loading: false,
    busy: false,
    pendingAction: '',
    data: null,
    error: '',
    tunnelConfigOpen: false,
    draftHost: null,
    draftToken: '',
    tsConfigOpen: false,
    draftTsHost: null,
    installPlatform: '',
    installCopiedAt: 0,
    installCopyTimer: null,
    pollTimer: null
  };

  function detectClientInstallPlatform(data) {
    const serverPlatform = String(data?.cloudflaredInstall?.platform || '').trim();
    if (serverPlatform && DEFAULT_CLOUDFLARED_INSTALL_COMMANDS[serverPlatform]) return serverPlatform;
    try {
      const navPlat = String(navigator?.platform || navigator?.userAgent || '').toLowerCase();
      if (navPlat.includes('mac') || navPlat.includes('darwin')) return 'darwin';
      if (navPlat.includes('win')) return 'win32';
    } catch {}
    return 'linux';
  }

  function resolveCloudflaredInstallGuideForSettings(data) {
    const serverCmds = (data?.cloudflaredInstall?.commands && typeof data.cloudflaredInstall.commands === 'object')
      ? data.cloudflaredInstall.commands
      : {};
    const commands = {
      darwin: String(serverCmds.darwin || DEFAULT_CLOUDFLARED_INSTALL_COMMANDS.darwin),
      win32: String(serverCmds.win32 || DEFAULT_CLOUDFLARED_INSTALL_COMMANDS.win32),
      linux: String(serverCmds.linux || DEFAULT_CLOUDFLARED_INSTALL_COMMANDS.linux)
    };
    const hostPlatform = detectClientInstallPlatform(data);
    const activePlatform = (remoteSettingsState.installPlatform && commands[remoteSettingsState.installPlatform])
      ? remoteSettingsState.installPlatform
      : hostPlatform;
    return {
      hostPlatform,
      activePlatform,
      command: commands[activePlatform] || commands.darwin,
      commands
    };
  }

  async function copyRemoteInstallCommand(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    try {
      if (navigator?.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = Boolean(document.execCommand && document.execCommand('copy'));
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function escapeSuiteHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function suiteTr(zh, en) {
    const entry = findSupportedLocaleEntry(suiteEnhancerPrefs.locale);
    if (entry.hansCode === 'en') return en;
    if (entry.code === 'zh-TW') return convertSuiteToZhTW(zh);
    return zh;
  }

  function onSuiteSettingsClosed() {
    if (remoteSettingsState.pollTimer) {
      clearTimeout(remoteSettingsState.pollTimer);
      remoteSettingsState.pollTimer = null;
    }
    if (remoteSettingsState.installCopyTimer) {
      clearTimeout(remoteSettingsState.installCopyTimer);
      remoteSettingsState.installCopyTimer = null;
    }
    remoteSettingsState.tunnelConfigOpen = false;
    remoteSettingsState.draftHost = null;
    remoteSettingsState.draftToken = '';
  }

  function findSupportedLocaleEntry(codeRaw) {
    const clean = String(codeRaw || '').trim();
    if (!clean) return SUITE_SUPPORTED_LOCALES[0];
    const lower = clean.toLowerCase();
    const exact = SUITE_SUPPORTED_LOCALES.find(item => item.code.toLowerCase() === lower);
    if (exact) return exact;
    if (lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh-hk' || lower === 'tw' || lower.startsWith('zh-tw-') || lower.startsWith('zh-hant-')) {
      return SUITE_SUPPORTED_LOCALES.find(item => item.code === 'zh-TW') || SUITE_SUPPORTED_LOCALES[0];
    }
    if (lower === 'zh' || lower === 'zh-hans' || lower === 'cn') {
      return SUITE_SUPPORTED_LOCALES.find(item => item.code === 'zh-CN') || SUITE_SUPPORTED_LOCALES[0];
    }
    if (lower.startsWith('en')) {
      return SUITE_SUPPORTED_LOCALES.find(item => item.code === 'en') || SUITE_SUPPORTED_LOCALES[0];
    }
    return SUITE_SUPPORTED_LOCALES.find(item => lower.startsWith(item.code.toLowerCase().split('-')[0])) || SUITE_SUPPORTED_LOCALES[0];
  }

  try {
    const lsTerm = localStorage?.getItem?.('ag_suite_terminal_app');
    if (lsTerm) suiteTerminalState.terminalApp = lsTerm;
    const lsTermPath = localStorage?.getItem?.('ag_suite_custom_term_path');
    if (lsTermPath) suiteTerminalState.customTerminalPath = lsTermPath;
    const lsCliSkip = localStorage?.getItem?.('ag_suite_cli_skip_perms');
    if (lsCliSkip === 'true' || lsCliSkip === 'false') suiteTerminalState.cliSkipPermissions = lsCliSkip === 'true';
    const lsCliModel = localStorage?.getItem?.('ag_suite_cli_model');
    if (typeof lsCliModel === 'string') suiteTerminalState.cliDefaultModel = lsCliModel.trim();
    const lsCliMuxHost = localStorage?.getItem?.('ag_suite_cli_mux_host');
    if (typeof lsCliMuxHost === 'string') suiteTerminalState.cliMuxHost = lsCliMuxHost.trim();
    const lsAutoAccept = localStorage?.getItem?.('ag_suite_auto_accept');
    if (lsAutoAccept === 'true' || lsAutoAccept === 'false') suiteEnhancerPrefs.autoAccept = lsAutoAccept === 'true';
    const lsGhost = localStorage?.getItem?.('ag_suite_ghost_suggest');
    if (lsGhost === 'true' || lsGhost === 'false') suiteEnhancerPrefs.ghostSuggest = lsGhost !== 'false';
    const lsAutoCompact = localStorage?.getItem?.('ag_suite_auto_compact');
    if (lsAutoCompact === 'true' || lsAutoCompact === 'false') suiteEnhancerPrefs.autoCompact = lsAutoCompact !== 'false';
    const lsLongFold = localStorage?.getItem?.('ag_suite_long_fold');
    if (lsLongFold === 'true' || lsLongFold === 'false') suiteEnhancerPrefs.longFold = lsLongFold !== 'false';
    const lsQuickAutoSend = localStorage?.getItem?.('ag_suite_quick_builtin_autosend');
    if (lsQuickAutoSend === 'true' || lsQuickAutoSend === 'false') {
      suiteEnhancerPrefs.quickBuiltinAutoSend = lsQuickAutoSend === 'true';
    }
    const lsDockEnabled = localStorage?.getItem?.('ag_suite_dock_badge_enabled');
    if (lsDockEnabled === 'true' || lsDockEnabled === 'false') {
      suiteEnhancerPrefs.dockBadgeEnabled = lsDockEnabled !== 'false';
    }
    const lsDockStyle = localStorage?.getItem?.('ag_suite_dock_badge_style');
    if (lsDockStyle === 'capsule' || lsDockStyle === 'badge') {
      suiteEnhancerPrefs.dockBadgeStyle = lsDockStyle;
    }
    const lsDockColorTier = localStorage?.getItem?.('ag_suite_dock_badge_color_tier');
    if (lsDockColorTier === 'true' || lsDockColorTier === 'false') {
      suiteEnhancerPrefs.dockBadgeColorTier = lsDockColorTier !== 'false';
    }
    const lsDockAutoClear = localStorage?.getItem?.('ag_suite_dock_badge_autoclear');
    if (lsDockAutoClear === 'true' || lsDockAutoClear === 'false') {
      suiteEnhancerPrefs.dockBadgeAutoClear = lsDockAutoClear !== 'false';
    }
    const lsLocale = localStorage?.getItem?.('ag_suite_locale')
      || localStorage?.getItem?.('antigravityHansLang')
      || localStorage?.getItem?.('__agy_ctx_lang__');
    if (lsLocale) {
      const entry = findSupportedLocaleEntry(lsLocale);
      suiteEnhancerPrefs.locale = entry.code;
      suiteEnhancerPrefs.capsuleLang = entry.capsuleLang;
    }
    const lsEngLbl = localStorage?.getItem?.('antigravityHansEnglishLabels');
    if (lsEngLbl === '1' || lsEngLbl === '0') {
      suiteEnhancerPrefs.englishLabels = lsEngLbl === '1';
    }
    const lsFeatFlags = localStorage?.getItem?.('ag_suite_feature_flags');
    if (lsFeatFlags) {
      const parsedFeat = JSON.parse(lsFeatFlags);
      if (parsedFeat && typeof parsedFeat === 'object') {
        for (const k of Object.keys(DEFAULT_SUITE_FEATURE_FLAGS)) {
          if (typeof parsedFeat[k] === 'boolean') suiteFeatureFlags[k] = parsedFeat[k];
        }
        if (!localStorage?.getItem?.('ag_suite_quick_pool')) {
          if (typeof parsedFeat.showQuickCopyId === 'boolean') suiteQuickPool.copyid = parsedFeat.showQuickCopyId;
          if (typeof parsedFeat.showQuickExport === 'boolean') suiteQuickPool.export = parsedFeat.showQuickExport;
        }
      }
    }
    const lsCodexUi = localStorage?.getItem?.('ag_suite_codex_ui');
    if (lsCodexUi) {
      const parsedCodex = JSON.parse(lsCodexUi);
      if (parsedCodex && typeof parsedCodex === 'object') {
        suiteCodexUi = normalizeCodexUiConfig(parsedCodex, suiteCodexUi);
      }
    }
    if (typeof window !== 'undefined') {
      const hostCodexUi = window.__AGContextMeterSettings?.uiPreferences?.codexUi;
      if (hostCodexUi && typeof hostCodexUi === 'object') {
        suiteCodexUi = normalizeCodexUiConfig(hostCodexUi, suiteCodexUi);
      }
      const liveCodexUi = window.__AGCodexOverlay?.getConfig?.();
      if (liveCodexUi && typeof liveCodexUi === 'object') {
        suiteCodexUi = normalizeCodexUiConfig(liveCodexUi, suiteCodexUi);
      }
    }
  } catch {}

  function isRealShadowDomTree() {
    const slot = el('settings-slot-heatmap-colors');
    const qs = typeof shadow.querySelector === 'function' ? shadow.querySelector('#settings-slot-heatmap-colors') : null;
    return Boolean(slot?.parentNode || slot?.parentElement || qs);
  }

  function enhanceSuiteDropdownsOnce() {
    if (suiteDropdownsEnhanced) return;
    if (!isRealShadowDomTree() || typeof enhanceCustomSelect !== 'function') return;
    suiteDropdownsEnhanced = true;
    try { uiCliModelDropdown = enhanceCustomSelect('set-cli-model-select'); } catch {}
    try { uiCliMuxHostDropdown = enhanceCustomSelect('set-cli-mux-host-select'); } catch {}
    try { uiLangDropdown = enhanceCustomSelect('set-ui-language-select'); } catch {}
    try { uiBaseCurrencyDropdown = enhanceCustomSelect('set-base-currency-select'); } catch {}
    try { uiCodexPoolFilterDropdown = enhanceCustomSelect('set-codex-pool-filter'); } catch {}
    try { uiCodexQuotaStyleDropdown = enhanceCustomSelect('set-codex-quota-style'); } catch {}
    try { uiCodexQuotaOtherDropdown = enhanceCustomSelect('set-codex-quota-other'); } catch {}
  }

  function transplantConfigControlsOnce() {
    if (suiteConfigTransplanted) return true;
    if (!isRealShadowDomTree()) return false;
    suiteConfigTransplanted = true;

    const moveTo = (nodeId, slotId) => {
      const node = el(nodeId);
      const slot = el(slotId);
      if (node && slot && typeof slot.appendChild === 'function') {
        slot.appendChild(node);
        return node;
      }
      return node;
    };

    // 1. 外观与配色移入「🌐 语言与外观」分页，并移除原面板内的调色抽屉
    const tokColorsBody = moveTo('token-color-drawer-body', 'settings-slot-heatmap-colors');
    if (tokColorsBody) tokColorsBody.style.display = 'block';
    const mBg = el('token-drawer-mirror-bg');
    const mAcc = el('token-drawer-mirror-accent');
    if (mBg) mBg.style.display = 'none';
    if (mAcc) mAcc.style.display = 'none';
    el('token-colors-drawer')?.remove?.();

    const meterColorsBody = moveTo('color-drawer-body', 'settings-slot-meter-colors');
    if (meterColorsBody) meterColorsBody.style.display = 'block';
    el('meter-colors-drawer')?.remove?.();

    // 2. 订阅与套餐配置移入「套餐与订阅」分页，原 Token 面板保留只读信息与跳转按钮
    moveTo('plan-save-feedback', 'settings-slot-sub-feedback');
    moveTo('direct-tier-select', 'settings-slot-tier');
    moveTo('direct-tier-wrap', 'settings-slot-tier');
    moveTo('direct-subtier-select', 'settings-slot-subtier');
    moveTo('direct-subtier-wrap', 'settings-slot-subtier');
    moveTo('direct-country-select', 'settings-slot-country');
    moveTo('direct-country-wrap', 'settings-slot-country');
    moveTo('direct-region-wrap', 'settings-slot-region');
    moveTo('direct-currency-select', 'settings-slot-currency');
    moveTo('direct-currency-wrap', 'settings-slot-currency');
    moveTo('price-mode-switch-group', 'settings-slot-pricemode');
    const customForm = moveTo('plan-custom-form', 'settings-slot-custom-plan-form');
    if (customForm) {
      customForm.setAttribute?.('data-in-settings', 'true');
      customForm.style.display = 'none';
    }
    const presetSel = el('select-custom-region-preset');
    if (presetSel?.parentElement) {
      presetSel.parentElement.style.display = 'none';
    }
    const countryCol = el('input-custom-country')?.parentElement;
    if (countryCol) countryCol.style.display = 'none';
    const regionCol = el('input-custom-region')?.parentElement;
    if (regionCol) regionCol.style.display = 'none';
    const paidCol = el('input-custom-paid')?.parentElement?.parentElement;
    if (paidCol) paidCol.style.gridColumn = '1 / -1';

    el('summary-subtier-wrap')?.remove?.();
    el('btn-edit-plan-custom')?.remove?.();
    ['p-det-name', 'p-det-subtier-readonly', 'p-det-country', 'p-det-region', 'p-det-currency'].forEach(id => {
      const node = el(id);
      if (node) {
        node.style.display = 'inline-block';
      }
    });

    // 3. 网络代理移入「🧰 终端与网络」分页，并移除 #panel 内原有抽屉
    moveTo('proxy-badge', 'settings-slot-proxy-badge');
    const proxyBody = moveTo('proxy-drawer-body', 'settings-slot-proxy');
    if (proxyBody) proxyBody.style.display = 'block';
    el('proxy-notun-drawer')?.remove?.();

    enhanceSuiteDropdownsOnce();
    return true;
  }

  function syncSettingsSubPreview() {
    const ps = ANTIGRAVITY_TOKEN_DATA.planStatus || {};
    const planEl = el('settings-sub-preview-plan');
    const poolsEl = el('settings-sub-preview-pools');
    const priceEl = el('settings-sub-preview-price');
    const core = typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null;
    const qpd = ps.quotaPoolDisplay || (core?.resolvePlanQuotaPools ? core.resolvePlanQuotaPools(ps) : null);

    if (planEl) {
      planEl.textContent = `当前套餐：${ps.tierName || 'Google AI Pro'}${ps.email ? ` (${ps.email})` : ''}`;
    }
    if (poolsEl) {
      poolsEl.textContent = qpd ? `${qpd.promptPoolText} · ${qpd.flowPoolText}` : '按当前套餐配额执行';
    }
    if (priceEl) {
      if (typeof lastBadgePriceState !== 'undefined' && lastBadgePriceState && lastBadgePriceState.symbol !== undefined) {
        const numStr = (lastBadgePriceState.num !== null && lastBadgePriceState.num !== undefined && lastBadgePriceState.symbol !== '$99.99~199.99')
          ? (Number(lastBadgePriceState.num) % 1 === 0 ? String(Number(lastBadgePriceState.num)) : Number(lastBadgePriceState.num).toFixed(2))
          : '';
        const valText = `${lastBadgePriceState.symbol}${numStr}${lastBadgePriceState.cycle || ''}`;
        const cnyText = lastBadgePriceState.cnyText || '';
        priceEl.textContent = valText ? `${valText} ${cnyText}`.trim() : '--';
      } else {
        const valText = el('plan-summary-price-val')?.textContent || '';
        const cnyText = el('plan-summary-price-cny')?.textContent || '';
        priceEl.textContent = valText ? `${valText} ${cnyText}`.trim() : '--';
      }
    }
    const isUltraPlan = ps.tierKey === 'ultra' || Boolean(ps.ultraSubTier);
    const subDt = el('settings-subtier-dt');
    const subDd = el('settings-subtier-dd');
    if (subDt && subDd) {
      subDt.style.display = isUltraPlan ? 'block' : 'none';
      subDd.style.display = isUltraPlan ? 'flex' : 'none';
    }
    const baseCurSel = el('set-base-currency-select');
    if (baseCurSel && typeof getActiveBaseCurrency === 'function') {
      const activeBase = getActiveBaseCurrency();
      if (baseCurSel.value !== activeBase) baseCurSel.value = activeBase;
      try { uiBaseCurrencyDropdown?.refresh?.(); } catch {}
    }
    syncCliOptionControls();
  }

  function syncSettingsThemePills() {
    setPillActive(el('set-theme-auto'), currentThemeMode === 'auto');
    setPillActive(el('set-theme-light'), currentThemeMode === 'light');
    setPillActive(el('set-theme-dark'), currentThemeMode === 'dark');
  }

  function dispatchSuitePrefsChanged() {
    const curEntry = findSupportedLocaleEntry(suiteEnhancerPrefs.locale);
    const activeLocale = suiteEnhancerPrefs.locale || 'zh-TW';
    const hansLangVal = curEntry.hansCode === 'en' ? 'en' : (curEntry.hansCode === 'zh-TW' ? 'zh-TW' : 'zh');
    const capsuleLangVal = curEntry.capsuleLang === 'en' ? 'en' : (curEntry.capsuleLang === 'zh-TW' ? 'zh-TW' : 'zh');
    try {
      if (typeof document !== 'undefined' && document.documentElement?.setAttribute) {
        document.documentElement.setAttribute('data-ag-suite-locale', activeLocale);
        document.documentElement.setAttribute('data-ag-hans-lang', hansLangVal);
      }
    } catch {}
    try {
      localStorage?.setItem?.('ag_suite_terminal_app', suiteTerminalState.terminalApp || 'auto');
      localStorage?.setItem?.('ag_suite_custom_term_path', suiteTerminalState.customTerminalPath || '');
      localStorage?.setItem?.('ag_suite_cli_skip_perms', suiteTerminalState.cliSkipPermissions ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_cli_model', suiteTerminalState.cliDefaultModel || '');
      localStorage?.setItem?.('ag_suite_cli_mux_host', suiteTerminalState.cliMuxHost || '');
      localStorage?.setItem?.('ag_suite_auto_accept', suiteEnhancerPrefs.autoAccept ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_ghost_suggest', suiteEnhancerPrefs.ghostSuggest ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_auto_compact', suiteEnhancerPrefs.autoCompact !== false ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_long_fold', suiteEnhancerPrefs.longFold !== false ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_quick_builtin_autosend', suiteEnhancerPrefs.quickBuiltinAutoSend ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_dock_badge_enabled', suiteEnhancerPrefs.dockBadgeEnabled !== false ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_dock_badge_style', suiteEnhancerPrefs.dockBadgeStyle === 'badge' ? 'badge' : 'capsule');
      localStorage?.setItem?.('ag_suite_dock_badge_color_tier', suiteEnhancerPrefs.dockBadgeColorTier !== false ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_dock_badge_autoclear', suiteEnhancerPrefs.dockBadgeAutoClear !== false ? 'true' : 'false');
      localStorage?.setItem?.('ag_suite_locale', activeLocale);
      localStorage?.setItem?.('__agy_ctx_lang__', capsuleLangVal);
      localStorage?.setItem?.('antigravityHansLang', hansLangVal);
      localStorage?.setItem?.('antigravityHansEnglishLabels', suiteEnhancerPrefs.englishLabels ? '1' : '0');
      localStorage?.setItem?.('ag_suite_feature_flags', JSON.stringify(suiteFeatureFlags));
      localStorage?.setItem?.('ag_suite_codex_ui', JSON.stringify(suiteCodexUi));
      localStorage?.setItem?.('ag_suite_quick_pool', JSON.stringify(suiteQuickPool));
      if (suiteQuickPrompts === null) {
        localStorage?.removeItem?.('ag_suite_quick_prompts');
      } else {
        localStorage?.setItem?.('ag_suite_quick_prompts', JSON.stringify(suiteQuickPrompts));
      }
    } catch {}
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('ag-suite-prefs-changed', {
          detail: {
            terminalApp: suiteTerminalState.terminalApp,
            customTerminalPath: suiteTerminalState.customTerminalPath,
            cliSkipPermissions: Boolean(suiteTerminalState.cliSkipPermissions),
            cliDefaultModel: suiteTerminalState.cliDefaultModel || '',
            cliMuxHost: suiteTerminalState.cliMuxHost || '',
            autoAccept: suiteEnhancerPrefs.autoAccept,
            ghostSuggest: suiteEnhancerPrefs.ghostSuggest,
            autoCompact: suiteEnhancerPrefs.autoCompact !== false,
            longFold: suiteEnhancerPrefs.longFold !== false,
            quickBuiltinAutoSend: Boolean(suiteEnhancerPrefs.quickBuiltinAutoSend),
            dockBadgeEnabled: suiteEnhancerPrefs.dockBadgeEnabled !== false,
            dockBadgeStyle: suiteEnhancerPrefs.dockBadgeStyle === 'badge' ? 'badge' : 'capsule',
            dockBadgeColorTier: suiteEnhancerPrefs.dockBadgeColorTier !== false,
            dockBadgeAutoClear: suiteEnhancerPrefs.dockBadgeAutoClear !== false,
            locale: activeLocale,
            capsuleLang: curEntry.capsuleLang,
            hansCode: curEntry.hansCode,
            englishLabels: Boolean(suiteEnhancerPrefs.englishLabels),
            featureFlags: { ...suiteFeatureFlags },
            codexUi: cloneCodexUiConfig(suiteCodexUi),
            quickPool: { ...suiteQuickPool },
            quickPrompts: suiteQuickPrompts ? suiteQuickPrompts.map(item => ({ ...item })) : null
          }
        }));
      }
    } catch {}
  }

  // 非破坏式 Shadow DOM 多语言切换器：基于 WeakMap 记录中文原文，支持切回 zh-CN 精确还原
  const suiteTextOriginals = new WeakMap();
  const suiteLeafOriginals = new WeakMap();
  const suiteAttrOriginals = new WeakMap();
  let suiteShadowObserver = null;
  let suiteTranslateApplying = false;
  let suiteTranslatePending = false;

  function translateSuiteString(raw, dict, patternsList, transformFn) {
    if (!raw || typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const lead = raw.slice(0, raw.indexOf(trimmed));
    const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
    if (dict && Object.prototype.hasOwnProperty.call(dict, trimmed)) {
      return lead + dict[trimmed] + tail;
    }
    if (Array.isArray(patternsList)) {
      for (const [re, rep] of patternsList) {
        if (re.test(trimmed)) {
          const next = typeof rep === 'function' ? trimmed.replace(re, rep) : trimmed.replace(re, rep);
          if (next !== trimmed) return lead + next + tail;
        }
      }
    }
    if (typeof transformFn === 'function') {
      const next = transformFn(trimmed);
      if (next && next !== trimmed) return lead + next + tail;
    }
    return raw;
  }

  function isProtectedSuiteLocaleSubtree(node) {
    let cur = node?.nodeType === 3 ? (node.parentElement || node.parentNode) : node;
    while (cur && cur !== shadow) {
      const tag = String(cur.tagName || '').toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT') return true;
      if (cur.id === 'set-ui-language-select') return true;
      if (cur.getAttribute?.('data-target-select') === 'set-ui-language-select') return true;
      cur = cur.parentElement || cur.parentNode;
    }
    return false;
  }

  function restoreShadowNodeLocale(root) {
    const visit = (node) => {
      if (!node || node.nodeType === 8) return;
      if (node.nodeType === 3) {
        const rec = suiteTextOriginals.get(node);
        if (rec) {
          const cur = node.nodeValue !== undefined ? node.nodeValue : node.textContent;
          if (cur === rec.translated) {
            if (node.nodeValue !== undefined) node.nodeValue = rec.orig;
            else node.textContent = rec.orig;
          }
          suiteTextOriginals.delete(node);
        }
        return;
      }
      if (node.nodeType === 1) {
        const leafRec = suiteLeafOriginals.get(node);
        if (leafRec && (!node.childNodes || node.childNodes.length === 0)) {
          if (node.textContent === leafRec.translated) node.textContent = leafRec.orig;
          suiteLeafOriginals.delete(node);
        }
        const attrRecs = suiteAttrOriginals.get(node);
        if (attrRecs) {
          for (const [k, rec] of attrRecs.entries()) {
            if (node.getAttribute?.(k) === rec.translated) node.setAttribute(k, rec.orig);
          }
          suiteAttrOriginals.delete(node);
        }
      }
      for (const ch of (node.childNodes || [])) visit(ch);
    };
    visit(root);
  }

  function translateShadowSubtreeLocale(root, dict, patternsList, transformFn) {
    const visit = (node) => {
      if (!node || node.nodeType === 8) return;
      if (node.nodeType === 3) {
        if (isProtectedSuiteLocaleSubtree(node)) return;
        const cur = node.nodeValue !== undefined ? node.nodeValue : node.textContent;
        const next = translateSuiteString(cur, dict, patternsList, transformFn);
        if (next && next !== cur) {
          const prevRec = suiteTextOriginals.get(node);
          const orig = prevRec ? prevRec.orig : cur;
          suiteTextOriginals.set(node, { orig, translated: next });
          if (node.nodeValue !== undefined) node.nodeValue = next;
          else node.textContent = next;
        }
        return;
      }
      if (node.nodeType === 1) {
        if (isProtectedSuiteLocaleSubtree(node)) return;
        const tag = String(node.tagName || '').toUpperCase();
        if ((!node.childNodes || node.childNodes.length === 0) && tag !== 'INPUT' && tag !== 'TEXTAREA' && node.textContent) {
          const curLeaf = node.textContent;
          const nextLeaf = translateSuiteString(curLeaf, dict, patternsList, transformFn);
          if (nextLeaf && nextLeaf !== curLeaf) {
            const prevLeaf = suiteLeafOriginals.get(node);
            suiteLeafOriginals.set(node, { orig: prevLeaf ? prevLeaf.orig : curLeaf, translated: nextLeaf });
            node.textContent = nextLeaf;
          }
        }
        for (const attrName of ['title', 'placeholder', 'aria-label']) {
          const attrVal = node.getAttribute?.(attrName);
          if (!attrVal) continue;
          const nextAttr = translateSuiteString(attrVal, dict, patternsList, transformFn);
          if (nextAttr && nextAttr !== attrVal) {
            let map = suiteAttrOriginals.get(node);
            if (!map) suiteAttrOriginals.set(node, (map = new Map()));
            const prevAttr = map.get(attrName);
            map.set(attrName, { orig: prevAttr ? prevAttr.orig : attrVal, translated: nextAttr });
            node.setAttribute(attrName, nextAttr);
          }
        }
      }
      for (const ch of (node.childNodes || [])) visit(ch);
    };
    visit(root);
  }

  let suiteShadowPendingRoots = new Set();
  function ensureSuiteShadowObserver(active) {
    if (!active) {
      if (suiteShadowObserver) {
        try { suiteShadowObserver.disconnect(); } catch {}
      }
      suiteShadowPendingRoots.clear();
      return;
    }
    if (typeof MutationObserver !== 'function') return;
    if (!suiteShadowObserver) {
      suiteShadowObserver = new MutationObserver((mutations) => {
        if (suiteTranslateApplying) return;
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target) {
            suiteShadowPendingRoots.add(m.target);
          } else if (m.type === 'childList') {
            if (m.addedNodes && m.addedNodes.length) {
              for (const n of m.addedNodes) suiteShadowPendingRoots.add(n);
            } else if (m.target) {
              suiteShadowPendingRoots.add(m.target);
            }
          }
        }
        if (suiteShadowPendingRoots.size === 0) return;
        const entry = findSupportedLocaleEntry(suiteEnhancerPrefs.locale);
        const isZhBase = /^(?:zh|cn)/i.test(entry.code) && !entry.uiDict && !entry.uiTransform;
        if (isZhBase || (!entry.uiDict && !entry.uiTransform)) {
          suiteShadowPendingRoots.clear();
          return;
        }
        const roots = Array.from(suiteShadowPendingRoots);
        suiteShadowPendingRoots.clear();
        suiteTranslateApplying = true;
        try {
          ensureSuiteShadowObserver(false);
          for (const r of roots) {
            if (r && r.isConnected !== false) {
              translateShadowSubtreeLocale(r, entry.uiDict, entry.uiPatterns, entry.uiTransform);
            }
          }
          ensureSuiteShadowObserver(true);
        } finally {
          suiteTranslateApplying = false;
        }
      });
    }
    try {
      suiteShadowObserver.observe(shadow, { childList: true, subtree: true, characterData: true });
    } catch {}
  }

  function applySuiteShadowLocale() {
    if (!shadow || suiteTranslateApplying) return;
    const entry = findSupportedLocaleEntry(suiteEnhancerPrefs.locale);
    const isZhBase = /^(?:zh|cn)/i.test(entry.code) && !entry.uiDict && !entry.uiTransform;
    suiteTranslateApplying = true;
    try {
      ensureSuiteShadowObserver(false);
      restoreShadowNodeLocale(shadow);
      if (!isZhBase && (entry.uiDict || entry.uiTransform)) {
        translateShadowSubtreeLocale(shadow, entry.uiDict, entry.uiPatterns, entry.uiTransform);
      }
      try { uiCliModelDropdown?.refresh?.(); } catch {}
      try { uiCliMuxHostDropdown?.refresh?.(); } catch {}
      try { uiLangDropdown?.refresh?.(); } catch {}
      try { uiBaseCurrencyDropdown?.refresh?.(); } catch {}
      try { uiCodexPoolFilterDropdown?.refresh?.(); } catch {}
      try { uiCodexQuotaStyleDropdown?.refresh?.(); } catch {}
      try { uiCodexQuotaOtherDropdown?.refresh?.(); } catch {}
      if (!isZhBase) ensureSuiteShadowObserver(true);
    } finally {
      suiteTranslateApplying = false;
    }
  }

  function syncLanguageDropdownOptions() {
    const sel = el('set-ui-language-select');
    if (!sel) return;
    const existing = new Map();
    if (sel.options) {
      for (const opt of Array.from(sel.options)) {
        if (opt?.value) existing.set(String(opt.value), opt);
      }
    }
    for (const loc of SUITE_SUPPORTED_LOCALES) {
      const opt = existing.get(loc.code);
      if (opt) {
        if (opt.textContent !== loc.label) opt.textContent = loc.label;
      } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const newOpt = document.createElement('option');
        newOpt.value = loc.code;
        newOpt.textContent = loc.label;
        sel.appendChild?.(newOpt);
      }
    }
    sel.value = suiteEnhancerPrefs.locale || 'zh-TW';
    uiLangDropdown?.refresh?.();
  }

  function syncCliOptionControls() {
    const chkSkip = el('set-cli-skip-permissions');
    if (chkSkip) chkSkip.checked = Boolean(suiteTerminalState.cliSkipPermissions);

    const sel = el('set-cli-model-select');
    const customRow = el('cli-custom-model-row');
    const customInp = el('input-cli-custom-model');
    if (!sel) return;

    // 合并宿主下发的可用模型（例如升级出新模型时无需等手动加字典）
    const hostModels = ANTIGRAVITY_TOKEN_DATA?.planStatus?.cascadeModelConfigs;
    if (Array.isArray(hostModels) && sel.options && typeof document?.createElement === 'function') {
      const existingVals = new Set(Array.from(sel.options).map(o => String(o.value || '')));
      const customOpt = Array.from(sel.options).find(o => o.value === '__custom__') || null;
      for (const m of hostModels) {
        if (!m || m.disabled || m.unavailable || m.isHistorical) continue;
        const mid = String(m.modelId || m.model || '').trim();
        if (!mid || !/^[a-z0-9._-]+$/i.test(mid) || /^MODEL_PLACEHOLDER_/i.test(mid)) continue;
        if (!existingVals.has(mid)) {
          const opt = document.createElement('option');
          opt.value = mid;
          opt.textContent = m.label || mid;
          if (customOpt && typeof sel.insertBefore === 'function') sel.insertBefore(opt, customOpt);
          else sel.appendChild?.(opt);
          existingVals.add(mid);
        }
      }
    }

    const curModel = String(suiteTerminalState.cliDefaultModel || '').trim();
    const optVals = sel.options ? Array.from(sel.options).map(o => String(o.value || '')) : [];
    const isCustomModel = Boolean(curModel) && !optVals.includes(curModel);
    if (isCustomModel) {
      sel.value = '__custom__';
      if (customRow) customRow.style.display = 'flex';
      if (customInp && customInp.value !== curModel) customInp.value = curModel;
    } else {
      sel.value = curModel;
      if (customRow && sel.value !== '__custom__') customRow.style.display = 'none';
    }
    uiCliModelDropdown?.refresh?.();

    const hostPrefRow = el('cli-mux-host-pref-row');
    const hostSel = el('set-cli-mux-host-select');
    const customHostRow = el('cli-custom-mux-host-row');
    const customHostInp = el('input-cli-mux-host');
    const termList = suiteTerminalState.terminals.length ? suiteTerminalState.terminals : getFallbackTerminalCatalog().terminals;
    const curApp = String(suiteTerminalState.terminalApp || 'auto').toLowerCase();
    const curTermObj = termList.find(t => t.id === curApp);
    const supportsMuxHost = Boolean(curTermObj?.supportsMuxHost)
      || ['rex', 'wezterm', 'tmux', 'custom'].includes(curApp)
      || Boolean(suiteTerminalState.cliMuxHost);
    if (hostPrefRow) {
      hostPrefRow.style.display = supportsMuxHost ? '' : 'none';
    }
    if (!supportsMuxHost && customHostRow) {
      customHostRow.style.display = 'none';
    }
    if (hostSel) {
      const detectedHosts = Array.isArray(suiteTerminalState.muxHosts) ? suiteTerminalState.muxHosts : [];
      if (detectedHosts.length && typeof document?.createElement === 'function') {
        const customOpt = hostSel.options
          ? Array.from(hostSel.options).find(o => String(o.value || '') === '__custom__')
          : null;
        // 清理旧的动态选项，保留 '' (本机) 与 '__custom__'
        if (hostSel.options) {
          for (const opt of Array.from(hostSel.options)) {
            const v = String(opt?.value ?? '');
            if (v !== '' && v !== '__custom__') opt.remove?.();
          }
        }
        const seenHostVals = new Set(['', '__custom__']);
        for (const h of detectedHosts) {
          const hid = String(h?.id ?? '').trim();
          if (!hid || seenHostVals.has(hid)) continue;
          seenHostVals.add(hid);
          const opt = document.createElement('option');
          opt.setAttribute?.('value', hid);
          opt.value = hid;
          const srcTag = h?.source === 'rex' ? 'Rex' : (h?.source === 'wezterm' ? 'WezTerm' : 'Detected');
          opt.textContent = `${h?.label || hid} · ${srcTag}`;
          if (customOpt && typeof hostSel.insertBefore === 'function') hostSel.insertBefore(opt, customOpt);
          else hostSel.appendChild?.(opt);
        }
      }
      const curHost = String(suiteTerminalState.cliMuxHost || '').trim();
      const hostOptVals = hostSel.options ? Array.from(hostSel.options).map(o => String(o.value || '')) : [];
      const isCustomHost = Boolean(curHost) && !hostOptVals.includes(curHost);
      if (isCustomHost) {
        hostSel.value = '__custom__';
        if (customHostRow) customHostRow.style.display = supportsMuxHost ? 'flex' : 'none';
        if (customHostInp && customHostInp.value !== curHost) customHostInp.value = curHost;
      } else {
        hostSel.value = curHost;
        if (customHostRow && (!supportsMuxHost || hostSel.value !== '__custom__')) customHostRow.style.display = 'none';
      }
      uiCliMuxHostDropdown?.refresh?.();
    }
  }

  function applySuiteFeatureFlags() {
    if (host?.setAttribute && host?.removeAttribute) {
      const toggleAttr = (attr, visible) => {
        if (visible === false) host.setAttribute(attr, 'true');
        else host.removeAttribute(attr);
      };
      toggleAttr('data-hide-tokens', suiteFeatureFlags.showTopbarTokens);
      toggleAttr('data-hide-cli', suiteFeatureFlags.showTopbarCli);
      toggleAttr('data-hide-quota', suiteFeatureFlags.showTopbarQuota);
      toggleAttr('data-hide-remote', suiteFeatureFlags.showTopbarRemote);
    }
    if (suiteFeatureFlags.showTopbarTokens === false) {
      const pTok = el('panel-tokens');
      if (pTok && !pTok.hidden && typeof showPanel === 'function') showPanel('none');
    }
    try {
      const ge = globalThis.__AGEnhancer || window?.__AGEnhancer;
      if (suiteFeatureFlags.showTopbarQuota === false) ge?.closeQuotaPopover?.();
      if (suiteFeatureFlags.showTopbarRemote === false) ge?.closeRemotePopover?.();
    } catch {}
  }

  function syncFeatureFlagControls() {
    const map = [
      ['set-feat-tokens', 'showTopbarTokens'],
      ['set-feat-cli', 'showTopbarCli'],
      ['set-feat-quota', 'showTopbarQuota'],
      ['set-feat-remote', 'showTopbarRemote'],
      ['set-feat-quickbar', 'showQuickBar'],
      ['set-feat-chatnav', 'showChatNav']
    ];
    for (const [id, key] of map) {
      const chk = el(id);
      if (chk) chk.checked = suiteFeatureFlags[key] !== false;
    }
  }

  function getSuiteFeatureFlags() {
    return { ...suiteFeatureFlags };
  }

  async function setSuiteFeatureFlags(partialFlags = {}, opts = {}) {
    if (partialFlags && typeof partialFlags === 'object') {
      for (const k of Object.keys(DEFAULT_SUITE_FEATURE_FLAGS)) {
        if (typeof partialFlags[k] === 'boolean') {
          suiteFeatureFlags[k] = partialFlags[k];
        }
      }
    }
    syncFeatureFlagControls();
    applySuiteFeatureFlags();
    dispatchSuitePrefsChanged();
    if (opts.syncHost !== false) {
      await saveSuiteUiPrefs({ featureFlags: { ...suiteFeatureFlags } });
    }
    return { ...suiteFeatureFlags };
  }

  function syncCodexUiControls() {
    const chkSidebar = el('set-feat-sidebar-quota');
    if (chkSidebar) chkSidebar.checked = suiteCodexUi.quotaSidebar !== false;
    const chkTheme = el('set-codex-theme');
    if (chkTheme) chkTheme.checked = Boolean(suiteCodexUi.codexTheme);

    const selPool = el('set-codex-pool-filter');
    if (selPool) {
      selPool.value = suiteCodexUi.quotaPoolFilter || 'all';
      try { uiCodexPoolFilterDropdown?.refresh?.(); } catch {}
    }
    const selStyle = el('set-codex-quota-style');
    if (selStyle) {
      selStyle.value = suiteCodexUi.quotaStyle || 'bar';
      try { uiCodexQuotaStyleDropdown?.refresh?.(); } catch {}
    }
    const isPinned = (suiteCodexUi.quotaPoolFilter || 'all') !== 'all';
    const otherRow = el('codex-quota-other-row');
    if (otherRow) {
      if (isPinned) otherRow.setAttribute('data-disabled', 'true');
      else otherRow.removeAttribute('data-disabled');
    }
    const selOther = el('set-codex-quota-other');
    if (selOther) {
      selOther.value = suiteCodexUi.quotaOtherStyle || 'hidden';
      selOther.disabled = isPinned;
      if (isPinned) {
        try { uiCodexQuotaOtherDropdown?.wrap?.classList?.remove?.('is-open'); } catch {}
      }
      try { uiCodexQuotaOtherDropdown?.refresh?.(); } catch {}
    }
  }

  async function setSuiteCodexUi(partialCodex = {}, opts = {}) {
    suiteCodexUi = normalizeCodexUiConfig(partialCodex, suiteCodexUi);
    try {
      localStorage?.setItem?.('ag_suite_codex_ui', JSON.stringify(suiteCodexUi));
    } catch {}
    syncCodexUiControls();
    try {
      window?.__AGCodexOverlay?.updateConfig?.(
        (partialCodex && typeof partialCodex === 'object') ? partialCodex : cloneCodexUiConfig(suiteCodexUi),
        { persist: false, broadcast: false }
      );
    } catch {}
    dispatchSuitePrefsChanged();
    if (opts.syncHost !== false) {
      await saveSuiteUiPrefs({ codexUi: cloneCodexUiConfig(suiteCodexUi) });
    }
    return cloneCodexUiConfig(suiteCodexUi);
  }

  let dockBadgeStatusState = {
    lastRes: null,
    overrideZh: '',
    overrideEn: '',
    overrideTone: '',
    overrideAxHidden: true
  };

  function normalizeDockBadgeStyle(raw) {
    return String(raw || '').trim().toLowerCase() === 'badge' ? 'badge' : 'capsule';
  }

  function isMacDockPlatformHint() {
    if (suiteTerminalState.platform && suiteTerminalState.platform !== 'darwin') return false;
    try {
      const p = String(navigator?.platform || navigator?.userAgent || '');
      if (p && (/win/i.test(p) || (/linux/i.test(p) && !/mac|darwin/i.test(p)))) return false;
    } catch {}
    return true;
  }

  function setDockBadgeStatusNote(zhText, enText, tone = '', openAxHidden = true) {
    dockBadgeStatusState.overrideZh = zhText || '';
    dockBadgeStatusState.overrideEn = enText || zhText || '';
    dockBadgeStatusState.overrideTone = tone || '';
    dockBadgeStatusState.overrideAxHidden = Boolean(openAxHidden);
    const noteEl = el('dock-badge-status-note');
    if (noteEl) {
      noteEl.textContent = suiteTr(dockBadgeStatusState.overrideZh, dockBadgeStatusState.overrideEn);
      if (tone) noteEl.setAttribute('data-tone', tone);
      else noteEl.removeAttribute('data-tone');
    }
    const openAxBtn = el('btn-dock-open-ax');
    if (openAxBtn) {
      const hideAx = Boolean(openAxHidden);
      openAxBtn.hidden = hideAx;
      if (hideAx) openAxBtn.setAttribute?.('hidden', '');
      else openAxBtn.removeAttribute?.('hidden');
    }
  }

  function renderDockBadgeStatusPayload(res) {
    dockBadgeStatusState.lastRes = res || null;
    const enabled = suiteEnhancerPrefs.dockBadgeEnabled !== false;
    const st = (res && typeof res === 'object')
      ? ((res.status && typeof res.status === 'object') ? res.status : ((res.data && typeof res.data === 'object') ? res.data : res))
      : null;

    if (!st || res?.ok === false) {
      if (!isMacDockPlatformHint()) {
        setDockBadgeStatusNote(
          '当前电脑不是 macOS：Dock 图标提醒仅在 Mac 上可用，其他系统已自动跳过',
          'Not running on macOS: Dock icon alerts are only available on Mac and are safely skipped here',
          '',
          true
        );
        return;
      }
      if (!enabled) {
        setDockBadgeStatusNote(
          '已关闭 macOS Dock 图标提醒，相关后台组件已完全停用',
          'macOS Dock icon alerts are disabled; background helper is stopped',
          '',
          true
        );
        return;
      }
      const hasBridge = typeof window !== 'undefined' && (Boolean(window.__AGContextMeterLive?.port) || typeof window.contextMeterAPI?.dockBadgeStatus === 'function');
      if (!hasBridge) {
        setDockBadgeStatusNote(
          'macOS Dock 提醒已开启，连接 Antigravity 后即可实时生效与预览',
          'macOS Dock alerts are enabled and will activate once connected to Antigravity',
          '',
          true
        );
        return;
      }
      const errCode = String(st?.errorCode || res?.errorCode || '').trim().toUpperCase();
      if (errCode === 'NOT_READY') {
        setDockBadgeStatusNote(
          '当前后台服务尚未开启 Dock 图标提醒，请完全退出并重新打开 Antigravity 后重试',
          'Dock icon alerts are not ready in the background helper yet. Quit and reopen Antigravity and retry.',
          'warn',
          true
        );
      } else {
        setDockBadgeStatusNote(
          '暂未获取到 macOS Dock 图标提醒状态，请完全退出并重新打开 Antigravity 后重试',
          'Unable to get macOS Dock alert status yet. Quit and reopen Antigravity and retry.',
          res?.error ? 'warn' : '',
          true
        );
      }
      return;
    }

    const plat = String(st.platform || res.platform || '').trim().toLowerCase();
    const supported = typeof st.supported === 'boolean'
      ? st.supported
      : (typeof res.supported === 'boolean' ? res.supported : (plat ? plat === 'darwin' : isMacDockPlatformHint()));
    if (!supported) {
      setDockBadgeStatusNote(
        '当前电脑不是 macOS：Dock 图标提醒仅在 Mac 上可用，其他系统已自动跳过',
        'Not running on macOS: Dock icon alerts are only available on Mac and are safely skipped here',
        '',
        true
      );
      return;
    }

    const effEnabled = typeof st.enabled === 'boolean' ? st.enabled : enabled;
    if (!effEnabled) {
      setDockBadgeStatusNote(
        '已关闭 macOS Dock 图标提醒，相关后台组件已完全停用',
        'macOS Dock icon alerts are disabled; background helper is stopped',
        '',
        true
      );
      return;
    }

    if (st.compiling === true || st.state === 'compiling' || st.status === 'compiling') {
      setDockBadgeStatusNote(
        '正在首次准备 macOS Dock 提醒组件（约需数秒，完成后自动生效）…',
        'Preparing native macOS Dock alert helper for first use (takes a few seconds)…',
        '',
        true
      );
      return;
    }

    const compileErrCode = String(st.compileErrorCode || '').trim().toUpperCase();
    const compileErr = String(st.compileError || st.error || '').trim();
    if (st.swiftcAvailable === false || compileErrCode === 'NO_SWIFTC') {
      setDockBadgeStatusNote(
        '需要先安装 Apple 命令行工具：请在「终端」运行 xcode-select --install，完成后重启 Antigravity 即可生效',
        'Apple Command Line Tools are required: run xcode-select --install in Terminal, then restart Antigravity',
        'warn',
        true
      );
      return;
    }
    if (compileErrCode || compileErr) {
      const compileCodeMap = {
        MISSING_SOURCE: [
          'Dock 提醒组件文件缺失，请重新安装或更新 Antigravity Suite 后重试',
          'Dock alert component files are missing. Reinstall or update Antigravity Suite and retry.'
        ],
        READ_SOURCE_FAILED: [
          '无法读取 Dock 提醒组件文件，请检查安装目录权限后重试',
          'Unable to read Dock alert component files. Check installation folder permissions and retry.'
        ],
        COMPILE_FAILED: [
          'Dock 提醒组件准备失败，请确认 Xcode 命令行工具正常后重启 Antigravity 重试',
          'Failed to prepare the Dock alert helper. Verify Xcode Command Line Tools are working and restart Antigravity.'
        ],
        SPAWN_FAILED: [
          'Dock 提醒组件启动失败，请完全退出并重新打开 Antigravity 后重试',
          'Failed to start the Dock alert helper. Quit and reopen Antigravity and try again.'
        ]
      };
      const pair = compileCodeMap[compileErrCode] || [
        compileErr || 'macOS Dock 图标提醒暂时无法启动，请完全退出并重新打开 Antigravity 后重试',
        'macOS Dock alerts failed to start. Quit and reopen Antigravity and try again.'
      ];
      setDockBadgeStatusNote(pair[0], pair[1], 'error', true);
      return;
    }

    if (st.axTrusted === false) {
      setDockBadgeStatusNote(
        '需要开启「辅助功能」权限才能在 Dock 图标上显示提醒，请点击右上角「前往开启权限」并勾选放行',
        'Accessibility permission is required to show alerts on the Dock icon. Click "Grant Access" above to enable it.',
        'warn',
        false
      );
      return;
    }

    if (st.axTrusted === true && st.dockFound === false) {
      setDockBadgeStatusNote(
        '已获得辅助功能权限，但暂未在底部 Dock 栏找到 Antigravity 图标（请确认程序图标在 Dock 中可见）',
        'Accessibility permission granted, waiting to locate the Antigravity icon in your Dock',
        '',
        true
      );
      return;
    }

    if (st.axTrusted === true && st.dockFound === true) {
      setDockBadgeStatusNote(
        'macOS Dock 图标提醒已就绪：后台有新回复、待审批或高危拦截时会即时提醒',
        'macOS Dock icon alerts are ready: alerts immediately on background replies, approvals, and high-risk blocks',
        'ok',
        true
      );
      return;
    }

    setDockBadgeStatusNote(
      'macOS Dock 图标提醒已开启，正在检查权限与图标位置…',
      'macOS Dock icon alerts are enabled; checking permissions and Dock icon status…',
      '',
      true
    );
  }

  function renderDockBadgeStatusNote() {
    if (dockBadgeStatusState.lastRes !== null) {
      renderDockBadgeStatusPayload(dockBadgeStatusState.lastRes);
      return;
    }
    if (dockBadgeStatusState.overrideZh) {
      const noteEl = el('dock-badge-status-note');
      if (noteEl) {
        noteEl.textContent = suiteTr(dockBadgeStatusState.overrideZh, dockBadgeStatusState.overrideEn);
      }
    }
  }

  function syncDockBadgeControls() {
    const enabled = suiteEnhancerPrefs.dockBadgeEnabled !== false;
    const style = normalizeDockBadgeStyle(suiteEnhancerPrefs.dockBadgeStyle);
    const colorTier = suiteEnhancerPrefs.dockBadgeColorTier !== false;
    const autoClear = suiteEnhancerPrefs.dockBadgeAutoClear !== false;

    const chkEnabled = el('set-dock-badge-enabled');
    const btnCapsule = el('set-dock-style-capsule');
    const btnBadge = el('set-dock-style-badge');
    const chkColorTier = el('set-dock-badge-color-tier');
    const chkAutoClear = el('set-dock-badge-autoclear');
    const btnTest = el('btn-test-dock-badge');

    if (chkEnabled) chkEnabled.checked = enabled;
    setPillActive(btnCapsule, style === 'capsule');
    setPillActive(btnBadge, style === 'badge');
    if (btnCapsule) btnCapsule.setAttribute('aria-pressed', String(style === 'capsule'));
    if (btnBadge) btnBadge.setAttribute('aria-pressed', String(style === 'badge'));
    if (chkColorTier) chkColorTier.checked = colorTier;
    if (chkAutoClear) chkAutoClear.checked = autoClear;

    const supported = dockBadgeStatusState.lastRes?.supported === false
      ? false
      : (dockBadgeStatusState.lastRes?.status?.supported === false ? false : isMacDockPlatformHint());
    if (btnTest) btnTest.disabled = !enabled || !supported;
  }

  let dockBadgeCompilePollTimer = null;

  async function refreshDockBadgeStatus() {
    if (dockBadgeCompilePollTimer) {
      clearTimeout(dockBadgeCompilePollTimer);
      dockBadgeCompilePollTimer = null;
    }
    const hasLivePort = typeof window !== 'undefined' && Boolean(window.__AGContextMeterLive?.port);
    const hasIpc = typeof window !== 'undefined' && typeof window.contextMeterAPI?.dockBadgeStatus === 'function';
    if (!hasLivePort && !hasIpc) {
      renderDockBadgeStatusPayload(null);
      syncDockBadgeControls();
      return null;
    }
    try {
      const res = await invokeHostBridge('/dock-badge-status', {}, 'dockBadgeStatus');
      renderDockBadgeStatusPayload(res);
      syncDockBadgeControls();
      const st = (res && typeof res === 'object')
        ? ((res.status && typeof res.status === 'object') ? res.status : ((res.data && typeof res.data === 'object') ? res.data : res))
        : null;
      const panelEl = el('panel-settings');
      if (st?.compiling === true && panelEl && !panelEl.hidden && !(typeof state !== 'undefined' && state?.disposed)) {
        dockBadgeCompilePollTimer = setTimeout(() => {
          dockBadgeCompilePollTimer = null;
          const curPanel = el('panel-settings');
          if (curPanel && !curPanel.hidden && !(typeof state !== 'undefined' && state?.disposed)) {
            void refreshDockBadgeStatus();
          }
        }, 2000);
      }
      return res || null;
    } catch {
      renderDockBadgeStatusPayload(null);
      syncDockBadgeControls();
      return null;
    }
  }

  function syncEnhancerPrefControls() {
    const chkAuto = el('set-auto-accept');
    const chkGhost = el('set-ghost-suggest');
    const chkCompact = el('set-auto-compact');
    const chkLongFold = el('set-long-fold');
    const chkQuickBuiltinAutoSend = el('set-quick-builtin-autosend');
    const chkEngLbl = el('set-english-labels');
    if (chkAuto) chkAuto.checked = Boolean(suiteEnhancerPrefs.autoAccept);
    if (chkGhost) chkGhost.checked = Boolean(suiteEnhancerPrefs.ghostSuggest);
    if (chkCompact) chkCompact.checked = suiteEnhancerPrefs.autoCompact !== false;
    if (chkLongFold) chkLongFold.checked = suiteEnhancerPrefs.longFold !== false;
    if (chkQuickBuiltinAutoSend) chkQuickBuiltinAutoSend.checked = Boolean(suiteEnhancerPrefs.quickBuiltinAutoSend);
    if (chkEngLbl) chkEngLbl.checked = Boolean(suiteEnhancerPrefs.englishLabels);
    try {
      if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('[data-agy-hans-ui]')?.forEach?.(node => node.remove?.());
      }
    } catch {}
    syncFeatureFlagControls();
    applySuiteFeatureFlags();
    syncLanguageDropdownOptions();
    syncCliOptionControls();
    syncSettingsThemePills();
    syncDockBadgeControls();
  }

  function getSupportedLocales() {
    return SUITE_SUPPORTED_LOCALES.map(item => ({ ...item }));
  }

  function registerSuiteLocale(def) {
    if (!def || typeof def !== 'object') return false;
    const code = String(def.code || '').trim();
    if (!code) return false;
    const label = String(def.label || code).trim();
    const isZhTwLike = /^(?:zh-tw|zh-hant|zh-hk|tw)\b/i.test(code);
    const isZhLike = /^(?:zh|cn)/i.test(code);
    const capsuleLang = def.capsuleLang === 'zh' || def.capsuleLang === 'zh-TW' || def.capsuleLang === 'en'
      ? def.capsuleLang
      : (isZhTwLike ? 'zh-TW' : (isZhLike ? 'zh' : 'en'));
    const hansCode = def.hansCode === 'zh' || def.hansCode === 'zh-TW' || def.hansCode === 'en'
      ? def.hansCode
      : (isZhTwLike ? 'zh-TW' : (isZhLike ? 'zh' : 'en'));
    const uiDict = (def.uiDict && typeof def.uiDict === 'object')
      ? def.uiDict
      : (!isZhLike && def.fallbackEn !== false ? SUITE_EN_UI_DICT : null);
    const uiPatterns = Array.isArray(def.uiPatterns)
      ? def.uiPatterns
      : (!isZhLike && def.fallbackEn !== false ? SUITE_EN_UI_PATTERNS : null);
    const uiTransform = typeof def.uiTransform === 'function' ? def.uiTransform : null;
    const idx = SUITE_SUPPORTED_LOCALES.findIndex(item => item.code.toLowerCase() === code.toLowerCase());
    const nextEntry = { code, hansCode, capsuleLang, label, uiDict, uiPatterns, uiTransform };
    if (idx >= 0) SUITE_SUPPORTED_LOCALES[idx] = nextEntry;
    else SUITE_SUPPORTED_LOCALES.push(nextEntry);
    syncLanguageDropdownOptions();
    return true;
  }

  function getSuiteLocale() {
    return suiteEnhancerPrefs.locale || 'zh-TW';
  }

  async function setSuiteLocale(localeCode, opts = {}) {
    const entry = findSupportedLocaleEntry(localeCode);
    suiteEnhancerPrefs.locale = entry.code;
    suiteEnhancerPrefs.capsuleLang = entry.capsuleLang;
    syncEnhancerPrefControls();
    renderQuickBuiltinPool();
    renderQuickPromptsEditor();
    renderDockBadgeStatusNote();
    dispatchSuitePrefsChanged();
    if (typeof refreshDirectRegionDisplay === 'function') refreshDirectRegionDisplay();
    applySuiteShadowLocale();
    try {
      if (typeof window !== 'undefined' && typeof window.__antigravityZhSetLang === 'function') {
        window.__antigravityZhSetLang(entry.hansCode, false);
      }
    } catch {}
    if (opts.syncHost !== false) {
      await saveSuiteUiPrefs({
        locale: entry.code,
        panelLanguage: entry.code,
        capsuleLang: entry.capsuleLang
      });
    }
    return getSuiteLocale();
  }

  function getFallbackTerminalCatalog(platformHint) {
    const plat = platformHint || suiteTerminalState.platform || 'darwin';
    const customPath = suiteTerminalState.customTerminalPath || '';
    if (plat === 'win32') {
      return {
        ok: true,
        platform: 'win32',
        terminals: [
          { id: 'auto', name: '自动默认 (原生居中控制台)', installed: true, executablePath: 'cmd.exe' },
          { id: 'powershell', name: 'PowerShell', installed: true, executablePath: 'powershell.exe / pwsh.exe' },
          { id: 'cmd', name: 'CMD (命令提示符)', installed: true, executablePath: 'cmd.exe' },
          { id: 'gitbash', name: 'Git Bash', installed: false, executablePath: 'C:\\Program Files\\Git\\git-bash.exe' },
          { id: 'wsl', name: 'WSL (Linux 子系统)', installed: false, executablePath: 'wsl.exe' },
          { id: 'warp', name: 'Warp', installed: false, executablePath: '%LOCALAPPDATA%\\Programs\\Warp\\warp.exe' },
          { id: 'wt', name: 'Windows Terminal', installed: false, executablePath: 'wt.exe' },
          { id: 'custom', name: '自定义程序路径', installed: Boolean(customPath), executablePath: customPath || null, isCustom: true }
        ]
      };
    }
    return {
      ok: true,
      platform: 'darwin',
      terminals: [
        { id: 'auto', name: '自动默认 (Terminal.app)', installed: true, executablePath: '/System/Applications/Utilities/Terminal.app' },
        { id: 'terminal', name: 'Terminal (系统终端)', installed: true, executablePath: '/System/Applications/Utilities/Terminal.app' },
        { id: 'iterm2', name: 'iTerm2', installed: false, executablePath: '/Applications/iTerm.app' },
        { id: 'ghostty', name: 'Ghostty', installed: false, executablePath: '/Applications/Ghostty.app' },
        { id: 'warp', name: 'Warp', installed: false, executablePath: '/Applications/Warp.app' },
        { id: 'rex', name: 'Rex', installed: false, executablePath: '/Applications/Rex.app', supportsMuxHost: true },
        { id: 'kitty', name: 'Kitty', installed: false, executablePath: '/Applications/kitty.app' },
        { id: 'wezterm', name: 'WezTerm', installed: false, executablePath: '/Applications/WezTerm.app', supportsMuxHost: true },
        { id: 'tmux', name: 'tmux (多路复用器)', installed: false, executablePath: '/opt/homebrew/bin/tmux', supportsMuxHost: true },
        { id: 'alacritty', name: 'Alacritty', installed: false, executablePath: '/Applications/Alacritty.app' },
        { id: 'custom', name: '自定义程序路径', installed: Boolean(customPath), executablePath: customPath || null, isCustom: true, supportsMuxHost: true }
      ]
    };
  }

  async function saveSuiteUiPrefs(partialPrefs) {
    if (typeof userActionSeq === 'number') ++userActionSeq;
    if (typeof suitePrefsSaveInFlight === 'number') ++suitePrefsSaveInFlight;
    try {
      if (partialPrefs && typeof partialPrefs === 'object' && typeof window !== 'undefined') {
        const curSettings = (window.__AGContextMeterSettings && typeof window.__AGContextMeterSettings === 'object')
          ? window.__AGContextMeterSettings
          : {};
        const nextUi = {
          ...(curSettings.uiPreferences && typeof curSettings.uiPreferences === 'object' ? curSettings.uiPreferences : {}),
          ...partialPrefs
        };
        if (nextUi.quickPrompts === null) delete nextUi.quickPrompts;
        window.__AGContextMeterSettings = {
          ...curSettings,
          ok: curSettings.ok !== undefined ? curSettings.ok : true,
          uiPreferences: nextUi
        };
      }
      const payload = { uiPreferences: partialPrefs };
      return await invokeHostBridge('/save-settings', payload, 'saveSettings');
    } catch (err) {
      return { ok: false, error: '', errorDetail: err?.message || String(err) };
    } finally {
      if (typeof suitePrefsSaveInFlight === 'number' && suitePrefsSaveInFlight > 0) {
        --suitePrefsSaveInFlight;
      }
    }
  }

  function renderTerminalGrid() {
    const grid = el('term-app-grid');
    const osBadge = el('term-os-badge');
    const customBox = el('term-custom-box');
    const customInput = el('input-custom-term-path');
    const statusEl = el('term-config-status');
    const platNameMap = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
    if (osBadge) osBadge.textContent = platNameMap[suiteTerminalState.platform] || suiteTerminalState.platform;
    const isEditingCustomPath = Boolean(
      customInput && (shadow?.activeElement === customInput || (typeof document !== 'undefined' && document.activeElement === customInput))
    );
    if (customInput && !isEditingCustomPath && customInput.value !== (suiteTerminalState.customTerminalPath || '')) {
      customInput.value = suiteTerminalState.customTerminalPath || '';
    }
    if (customBox) {
      customBox.setAttribute('data-active', String(suiteTerminalState.terminalApp === 'custom'));
    }

    const list = suiteTerminalState.terminals.length ? suiteTerminalState.terminals : getFallbackTerminalCatalog().terminals;
    const selectedItem = list.find(t => t.id === suiteTerminalState.terminalApp) || list[0];
    if (statusEl && selectedItem) {
      const pathHint = selectedItem.id === 'custom'
        ? (suiteTerminalState.customTerminalPath || '未设置路径')
        : (selectedItem.executablePath || '系统默认');
      const modelHint = suiteTerminalState.cliDefaultModel ? `模型: ${suiteTerminalState.cliDefaultModel}` : '模型: 默认';
      const skipHint = suiteTerminalState.cliSkipPermissions ? '免审核' : '标准权限';
      const hostHint = (selectedItem.supportsMuxHost || suiteTerminalState.cliMuxHost)
        ? ` · 主机: ${suiteTerminalState.cliMuxHost || '本机'}`
        : '';
      statusEl.textContent = `当前使用：${selectedItem.name} (${pathHint}) · ${modelHint}${hostHint} · ${skipHint}`;
    }

    if (!grid) return;
    if (typeof grid.replaceChildren === 'function') grid.replaceChildren();
    else grid.innerHTML = '';

    for (const item of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'term-option-card';
      card.setAttribute('data-terminal-id', item.id);
      card.setAttribute('data-installed', item.installed ? 'true' : 'false');
      card.setAttribute('data-selected', String(item.id === suiteTerminalState.terminalApp));
      card.title = item.description || item.executablePath || item.name;

      const topRow = document.createElement('div');
      topRow.className = 'term-option-top';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'term-option-name';
      nameSpan.textContent = item.name;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'term-option-badge';
      badgeSpan.setAttribute('data-installed', item.installed ? 'true' : 'false');
      badgeSpan.textContent = item.isCustom
        ? (item.installed ? '已配置' : '自定义')
        : (item.installed ? '已安装' : '未检测到');

      topRow.appendChild(nameSpan);
      topRow.appendChild(badgeSpan);

      const pathRow = document.createElement('div');
      pathRow.className = 'term-option-path';
      pathRow.textContent = item.executablePath || (item.isCustom ? '请填写或浏览选择终端程序路径' : '未在本机默认路径找到');

      card.appendChild(topRow);
      card.appendChild(pathRow);
      card.addEventListener('click', () => {
        void setSuiteTerminalSettings(item.id, suiteTerminalState.customTerminalPath);
      });
      grid.appendChild(card);
    }
  }

  async function refreshTerminalsList() {
    try {
      const customPath = suiteTerminalState.customTerminalPath || '';
      const res = await invokeHostBridge('/list-terminals', { customTerminalPath: customPath }, 'listTerminals');
      if (res && res.ok && Array.isArray(res.terminals)) {
        suiteTerminalState.platform = res.platform || suiteTerminalState.platform;
        suiteTerminalState.terminals = res.terminals;
        if (Array.isArray(res.muxHosts)) {
          suiteTerminalState.muxHosts = res.muxHosts;
        }
      } else {
        const fb = getFallbackTerminalCatalog();
        suiteTerminalState.platform = fb.platform;
        suiteTerminalState.terminals = fb.terminals;
      }
    } catch {
      const fb = getFallbackTerminalCatalog();
      suiteTerminalState.terminals = fb.terminals;
    }
    syncCliOptionControls();
    renderTerminalGrid();
    return { ...suiteTerminalState, terminals: [...suiteTerminalState.terminals], muxHosts: [...suiteTerminalState.muxHosts] };
  }

  async function setSuiteTerminalSettings(terminalApp, customTerminalPath, muxHost) {
    suiteTerminalState.terminalApp = String(terminalApp || 'auto').trim().toLowerCase() || 'auto';
    if (customTerminalPath !== undefined) {
      suiteTerminalState.customTerminalPath = String(customTerminalPath || '').trim();
    }
    const partial = {
      terminalApp: suiteTerminalState.terminalApp,
      customTerminalPath: suiteTerminalState.customTerminalPath
    };
    if (muxHost !== undefined) {
      const rawHost = String(muxHost ?? '').trim();
      suiteTerminalState.cliMuxHost = ['local', '__local__', '__custom__'].includes(rawHost.toLowerCase()) ? '' : rawHost;
      partial.cliMuxHost = suiteTerminalState.cliMuxHost;
    }
    syncCliOptionControls();
    dispatchSuitePrefsChanged();
    renderTerminalGrid();
    await saveSuiteUiPrefs(partial);
    return { ...suiteTerminalState };
  }

  async function setSuiteCliSettings(opts = {}, saveOpts = {}) {
    const partial = {};
    if (typeof opts.skipPermissions === 'boolean') {
      suiteTerminalState.cliSkipPermissions = opts.skipPermissions;
      partial.cliSkipPermissions = suiteTerminalState.cliSkipPermissions;
    }
    if (opts.model !== undefined) {
      const raw = String(opts.model ?? '').trim();
      const normalized = ['none', 'default', 'auto', '__custom__'].includes(raw.toLowerCase()) ? '' : raw;
      suiteTerminalState.cliDefaultModel = normalized;
      partial.cliDefaultModel = normalized;
    }
    if (opts.muxHost !== undefined) {
      const rawHost = String(opts.muxHost ?? '').trim();
      const normHost = ['local', '__local__', '__custom__'].includes(rawHost.toLowerCase()) ? '' : rawHost;
      suiteTerminalState.cliMuxHost = normHost;
      partial.cliMuxHost = normHost;
    }
    syncCliOptionControls();
    renderTerminalGrid();
    dispatchSuitePrefsChanged();
    if (saveOpts.syncHost !== false && Object.keys(partial).length > 0) {
      await saveSuiteUiPrefs(partial);
    }
    return getSuiteCliSettings();
  }

  function getSuiteCliSettings() {
    const m = String(suiteTerminalState.cliDefaultModel || '').trim();
    return {
      skipPermissions: Boolean(suiteTerminalState.cliSkipPermissions),
      model: m,
      noModel: !m
    };
  }

  function getSuiteTerminalSettings() {
    const cliCfg = getSuiteCliSettings();
    return {
      terminalApp: suiteTerminalState.terminalApp || 'auto',
      customTerminalPath: suiteTerminalState.customTerminalPath || '',
      muxHost: String(suiteTerminalState.cliMuxHost || '').trim(),
      skipPermissions: cliCfg.skipPermissions,
      model: cliCfg.model,
      noModel: cliCfg.noModel
    };
  }

  function applyHostUiPreferences(uiPrefs, opts = {}) {
    if (!uiPrefs || typeof uiPrefs !== 'object') return;
    if (typeof uiPrefs.terminalApp === 'string' && uiPrefs.terminalApp.trim()) {
      suiteTerminalState.terminalApp = uiPrefs.terminalApp.trim().toLowerCase();
    }
    if (typeof uiPrefs.customTerminalPath === 'string') {
      suiteTerminalState.customTerminalPath = uiPrefs.customTerminalPath.trim();
    }
    if (typeof uiPrefs.cliMuxHost === 'string') {
      suiteTerminalState.cliMuxHost = uiPrefs.cliMuxHost.trim();
    }
    if (typeof uiPrefs.cliSkipPermissions === 'boolean') {
      suiteTerminalState.cliSkipPermissions = uiPrefs.cliSkipPermissions;
    }
    if (typeof uiPrefs.cliDefaultModel === 'string') {
      suiteTerminalState.cliDefaultModel = uiPrefs.cliDefaultModel.trim();
    }
    if (typeof uiPrefs.autoAccept === 'boolean') {
      suiteEnhancerPrefs.autoAccept = uiPrefs.autoAccept;
    }
    if (typeof uiPrefs.ghostSuggest === 'boolean') {
      suiteEnhancerPrefs.ghostSuggest = uiPrefs.ghostSuggest;
    }
    if (typeof uiPrefs.autoCompact === 'boolean') {
      suiteEnhancerPrefs.autoCompact = uiPrefs.autoCompact;
    }
    if (typeof uiPrefs.longFold === 'boolean') {
      suiteEnhancerPrefs.longFold = uiPrefs.longFold;
    }
    if (typeof uiPrefs.quickBuiltinAutoSend === 'boolean') {
      suiteEnhancerPrefs.quickBuiltinAutoSend = uiPrefs.quickBuiltinAutoSend;
    }
    if (typeof uiPrefs.dockBadgeEnabled === 'boolean') {
      suiteEnhancerPrefs.dockBadgeEnabled = uiPrefs.dockBadgeEnabled;
    } else if (uiPrefs.dockBadge && typeof uiPrefs.dockBadge.enabled === 'boolean') {
      suiteEnhancerPrefs.dockBadgeEnabled = uiPrefs.dockBadge.enabled;
    }
    if (typeof uiPrefs.dockBadgeStyle === 'string') {
      const ds = uiPrefs.dockBadgeStyle.trim().toLowerCase();
      if (ds === 'capsule' || ds === 'badge') suiteEnhancerPrefs.dockBadgeStyle = ds;
    } else if (uiPrefs.dockBadge && typeof uiPrefs.dockBadge.style === 'string') {
      const ds = uiPrefs.dockBadge.style.trim().toLowerCase();
      if (ds === 'capsule' || ds === 'badge') suiteEnhancerPrefs.dockBadgeStyle = ds;
    }
    if (typeof uiPrefs.dockBadgeColorTier === 'boolean') {
      suiteEnhancerPrefs.dockBadgeColorTier = uiPrefs.dockBadgeColorTier;
    } else if (uiPrefs.dockBadge && typeof uiPrefs.dockBadge.colorTier === 'boolean') {
      suiteEnhancerPrefs.dockBadgeColorTier = uiPrefs.dockBadge.colorTier;
    }
    if (typeof uiPrefs.dockBadgeAutoClear === 'boolean') {
      suiteEnhancerPrefs.dockBadgeAutoClear = uiPrefs.dockBadgeAutoClear;
    } else if (uiPrefs.dockBadge && typeof uiPrefs.dockBadge.autoClear === 'boolean') {
      suiteEnhancerPrefs.dockBadgeAutoClear = uiPrefs.dockBadge.autoClear;
    }
    const incomingLoc = uiPrefs.locale || uiPrefs.panelLanguage || uiPrefs.capsuleLang;
    if (typeof incomingLoc === 'string' && incomingLoc.trim()) {
      const entry = findSupportedLocaleEntry(incomingLoc);
      suiteEnhancerPrefs.locale = entry.code;
      suiteEnhancerPrefs.capsuleLang = entry.capsuleLang;
      try { window.__antigravityZhSetLang?.(entry.hansCode, false); } catch {}
    }
    if (typeof uiPrefs.englishLabels === 'boolean') {
      suiteEnhancerPrefs.englishLabels = uiPrefs.englishLabels;
      try { window.__antigravityZhSetEnglishLabels?.(suiteEnhancerPrefs.englishLabels, true); } catch {}
    }
    if (uiPrefs.featureFlags && typeof uiPrefs.featureFlags === 'object') {
      for (const k of Object.keys(DEFAULT_SUITE_FEATURE_FLAGS)) {
        if (typeof uiPrefs.featureFlags[k] === 'boolean') {
          suiteFeatureFlags[k] = uiPrefs.featureFlags[k];
        }
      }
      if (!uiPrefs.quickPool && !localStorage?.getItem?.('ag_suite_quick_pool')) {
        if (typeof uiPrefs.featureFlags.showQuickCopyId === 'boolean') {
          suiteQuickPool.copyid = uiPrefs.featureFlags.showQuickCopyId;
        }
        if (typeof uiPrefs.featureFlags.showQuickExport === 'boolean') {
          suiteQuickPool.export = uiPrefs.featureFlags.showQuickExport;
        }
      }
    }
    if (uiPrefs.quickPool && typeof uiPrefs.quickPool === 'object') {
      suiteQuickPool = sanitizeQuickPoolState(uiPrefs.quickPool);
    }
    if (uiPrefs.codexUi && typeof uiPrefs.codexUi === 'object') {
      suiteCodexUi = normalizeCodexUiConfig(uiPrefs.codexUi, suiteCodexUi);
    }
    if (typeof applyHostAppearancePreferences === 'function') {
      applyHostAppearancePreferences(uiPrefs);
    }
    const editingQuickPrompts = isQuickPromptsEditorActiveOrDirty();
    const prevQuickPrompts = Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts : [];
    let quickPromptsChanged = false;
    if ('quickPrompts' in uiPrefs && !editingQuickPrompts) {
      if (uiPrefs.quickPrompts === null) {
        suiteQuickPrompts = null;
      } else {
        if (!uiPrefs.quickPool && !localStorage?.getItem?.('ag_suite_quick_pool') && Array.isArray(uiPrefs.quickPrompts)) {
          for (const item of uiPrefs.quickPrompts) {
            if (isLegacyDefaultPromptItem(item) && item.enabled === false) {
              suiteQuickPool[item.id] = false;
            }
          }
        }
        const cleaned = sanitizeQuickPromptsList(uiPrefs.quickPrompts);
        suiteQuickPrompts = cleaned && cleaned.length > 0 ? cleaned : null;
      }
      quickPromptsChanged = !isSameQuickPromptsList(prevQuickPrompts, suiteQuickPrompts);
    }
    dispatchSuitePrefsChanged();
    syncEnhancerPrefControls();
    syncDockBadgeControls();
    applySuiteFeatureFlags();
    syncFeatureFlagControls();
    syncCodexUiControls();
    renderQuickBuiltinPool();
    if (!editingQuickPrompts) {
      const listEl = el('quick-prompts-editor-list');
      const hasMounted = Boolean(listEl?.querySelector?.('.qp-row') || listEl?.querySelector?.('.qp-empty-hint'));
      if (quickPromptsChanged || !hasMounted) {
        renderQuickPromptsEditor();
      }
    }
    renderTerminalGrid();
    applySuiteShadowLocale();
  }

  function getSuiteQuickPool() {
    return { ...suiteQuickPool };
  }

  async function setSuiteQuickPool(partialPool = {}, opts = {}) {
    if (partialPool && typeof partialPool === 'object') {
      suiteQuickPool = sanitizeQuickPoolState({ ...suiteQuickPool, ...partialPool });
    }
    renderQuickBuiltinPool();
    dispatchSuitePrefsChanged();
    if (!opts?.skipPersist) {
      await saveSuiteUiPrefs({ quickPool: { ...suiteQuickPool } });
    }
    return getSuiteQuickPool();
  }

  async function toggleSuiteQuickPoolItem(id, opts = {}) {
    const cleanId = String(id || '').trim();
    if (!BUILTIN_QUICK_POOL.some(item => item.id === cleanId)) return getSuiteQuickPool();
    return await setSuiteQuickPool({ [cleanId]: suiteQuickPool[cleanId] === false }, opts);
  }

  function getSuiteQuickBuiltinAutoSend() {
    return Boolean(suiteEnhancerPrefs.quickBuiltinAutoSend);
  }

  async function setSuiteQuickBuiltinAutoSend(val, opts = {}) {
    suiteEnhancerPrefs.quickBuiltinAutoSend = Boolean(val);
    syncEnhancerPrefControls();
    dispatchSuitePrefsChanged();
    if (!opts?.skipPersist) {
      await saveSuiteUiPrefs({ quickBuiltinAutoSend: suiteEnhancerPrefs.quickBuiltinAutoSend });
    }
    return getSuiteQuickBuiltinAutoSend();
  }

  let inspectedQuickPoolId = 'compact';

  function updateQuickBuiltinInfoBox(id) {
    const item = BUILTIN_QUICK_POOL.find(x => x.id === id) || BUILTIN_QUICK_POOL[0];
    if (!item) return;
    inspectedQuickPoolId = item.id;
    const gridEl = el('quick-builtin-pool-grid');
    if (gridEl && typeof gridEl.querySelectorAll === 'function') {
      const chips = gridEl.querySelectorAll('.qp-pool-chip');
      if (chips && typeof chips[Symbol.iterator] === 'function') {
        for (const chip of chips) {
          chip.setAttribute?.('data-inspected', chip.getAttribute?.('data-pool-id') === item.id ? 'true' : 'false');
        }
      }
    }
    const titleEl = el('quick-info-title');
    const recEl = el('quick-info-rec');
    const tagEl = el('quick-info-tag');
    const roleEl = el('quick-info-role');
    const sceneEl = el('quick-info-scene');
    if (titleEl) titleEl.textContent = suiteTr(item.label, item.labelEn || item.label);
    if (recEl) {
      const recTxt = suiteTr(item.rec || '', item.recEn || item.rec || '');
      if (recTxt) {
        recEl.textContent = recTxt;
        recEl.hidden = false;
      } else {
        recEl.textContent = '';
        recEl.hidden = true;
      }
    }
    if (tagEl) {
      const tagTxt = suiteTr(item.tag || '', item.tagEn || item.tag || '');
      tagEl.textContent = tagTxt
        ? `${suiteTr('分类标签：', 'Category: ')}${tagTxt}`
        : '';
    }
    if (roleEl) {
      const roleTxt = suiteTr(item.role || item.title, item.roleEn || item.titleEn || item.role);
      roleEl.textContent = `${suiteTr('作用：', 'Role: ')}${roleTxt}`;
    }
    if (sceneEl) {
      const sceneTxt = suiteTr(item.scene || '', item.sceneEn || item.scene || '');
      sceneEl.textContent = `${suiteTr('场景：', 'When to use: ')}${sceneTxt}`;
    }
  }

  function renderQuickBuiltinPool() {
    const gridEl = el('quick-builtin-pool-grid');
    if (!gridEl) return;
    gridEl.replaceChildren();
    for (const group of QUICK_POOL_GROUPS) {
      const groupItems = BUILTIN_QUICK_POOL.filter(item => item.group === group.id);
      if (groupItems.length === 0) continue;

      const groupWrap = document.createElement('div');
      groupWrap.className = 'qp-pool-group';
      groupWrap.setAttribute('data-pool-group', group.id);

      const groupTitle = document.createElement('div');
      groupTitle.className = 'qp-pool-group-title';
      groupTitle.textContent = suiteTr(group.title, group.titleEn || group.title);
      groupWrap.appendChild(groupTitle);

      const itemsGrid = document.createElement('div');
      itemsGrid.className = 'qp-pool-group-items';

      for (const item of groupItems) {
        const active = suiteQuickPool[item.id] !== false;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `ag-qp-pool-${item.id}`;
        btn.className = 'qp-pool-chip';
        btn.setAttribute('data-pool-id', item.id);
        btn.setAttribute('data-active', active ? 'true' : 'false');
        btn.setAttribute('data-inspected', inspectedQuickPoolId === item.id ? 'true' : 'false');
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = suiteTr(item.title, item.titleEn || item.title);

        const mark = document.createElement('span');
        mark.className = 'qp-pool-chip-mark';
        mark.textContent = active ? '✓' : '+';

        const lbl = document.createElement('span');
        lbl.className = 'qp-pool-chip-label';
        lbl.textContent = suiteTr(item.label, item.labelEn || item.label);

        btn.appendChild(mark);
        btn.appendChild(lbl);

        if (item.rec) {
          const star = document.createElement('span');
          star.className = 'qp-pool-chip-star';
          star.textContent = '★';
          star.setAttribute('aria-hidden', 'true');
          btn.appendChild(star);
        }

        btn.addEventListener('mouseenter', () => {
          updateQuickBuiltinInfoBox(item.id);
        });
        btn.addEventListener('focus', () => {
          updateQuickBuiltinInfoBox(item.id);
        });
        btn.addEventListener('click', () => {
          inspectedQuickPoolId = item.id;
          void toggleSuiteQuickPoolItem(item.id);
        });
        itemsGrid.appendChild(btn);
      }

      groupWrap.appendChild(itemsGrid);
      gridEl.appendChild(groupWrap);
    }
    updateQuickBuiltinInfoBox(inspectedQuickPoolId);
  }

  function getSuiteQuickPrompts() {
    return (Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts : []).map(item => ({ ...item }));
  }

  async function setSuiteQuickPrompts(list, opts = {}) {
    if (typeof userActionSeq === 'number') ++userActionSeq;
    if (list === null) {
      suiteQuickPrompts = null;
    } else {
      const cleaned = sanitizeQuickPromptsList(list);
      suiteQuickPrompts = (cleaned && cleaned.length > 0) ? cleaned : null;
    }
    dispatchSuitePrefsChanged();
    if (!opts?.skipRenderEditor) {
      clearQuickPromptsEditorDirty();
      renderQuickPromptsEditor();
    } else {
      if (!opts?.preserveDirty) {
        for (const r of getQuickPromptEditorRows()) {
          const l = String(r.querySelector?.('.qp-label-input')?.value || '').trim();
          const t = String(r.querySelector?.('.qp-text-input')?.value || '').trim();
          if (l && t) r.setAttribute?.('data-qp-saved', 'true');
        }
        clearQuickPromptsEditorDirty();
      }
      syncQuickPopularTemplatesState();
    }
    if (!opts?.skipPersist) {
      const saveRes = await saveSuiteUiPrefs({
        quickPrompts: suiteQuickPrompts === null ? (opts?.isReset ? null : []) : suiteQuickPrompts.map(item => ({ ...item }))
      });
      if (saveRes && saveRes.ok === false) {
        const detail = String(saveRes.error || '').trim();
        const hasCjk = /[\u4e00-\u9fff]/.test(detail);
        setQuickPromptsStatus(
          suiteTr(
            `⚠️ 写入配置失败，你编辑的内容仍保留在页面中，请确认 Antigravity 正常运行后重试${detail ? `（${detail}）` : ''}`,
            `⚠️ Failed to write settings — your edits remain on this page; ensure Antigravity is running and retry${detail && !hasCjk ? ` (${detail})` : ''}`
          ),
          'warn'
        );
        return getSuiteQuickPrompts();
      }
    }
    if (!opts?.silentStatus) {
      if (suiteQuickPrompts && suiteQuickPrompts.length > 0) {
        setQuickPromptsStatus(
          suiteTr(`✅ 已保存 ${suiteQuickPrompts.length} 条自定义提示词`, `✅ Saved ${suiteQuickPrompts.length} custom prompt(s)`),
          'ok'
        );
      } else if (opts?.isReset) {
        setQuickPromptsStatus(suiteTr('✅ 已恢复默认快捷按钮', '✅ Reset to default quick buttons'), 'ok');
      } else {
        setQuickPromptsStatus(suiteTr('✅ 已清空自定义提示词', '✅ Cleared custom quick prompts'), 'ok');
      }
    }
    return getSuiteQuickPrompts();
  }

  async function resetSuiteQuickPrompts() {
    clearQuickPromptsEditorDirty();
    if (typeof userActionSeq === 'number') ++userActionSeq;
    suiteQuickPool = { ...DEFAULT_QUICK_POOL_STATE };
    suiteQuickPrompts = null;
    suiteEnhancerPrefs.quickBuiltinAutoSend = false;
    syncEnhancerPrefControls();
    renderQuickBuiltinPool();
    renderQuickPromptsEditor();
    dispatchSuitePrefsChanged();
    setQuickPromptsStatus(suiteTr('✅ 已恢复默认快捷按钮', '✅ Reset to default quick buttons'), 'ok');
    await saveSuiteUiPrefs({
      quickPool: { ...suiteQuickPool },
      quickPrompts: null,
      quickBuiltinAutoSend: false
    });
    return getSuiteQuickPrompts();
  }

  function appendQuickPromptEditorRow(listEl, item, idx, opts = {}) {
    const emptyHint = listEl.querySelector?.('.qp-empty-hint');
    if (emptyHint) emptyHint.remove?.();

    const row = document.createElement('div');
    row.className = 'qp-row';
    row.setAttribute('data-qp-idx', String(idx));
    if (item?.id) row.setAttribute('data-qp-id', String(item.id));
    if (opts?.isSaved) row.setAttribute('data-qp-saved', 'true');

    const labelInp = document.createElement('input');
    labelInp.type = 'text';
    labelInp.className = 'qp-label-input';
    labelInp.placeholder = suiteTr('按钮文案 (如 逐行审查)', 'Button label');
    labelInp.value = String(item?.label || '');
    labelInp.setAttribute('value', labelInp.value);

    const textInp = document.createElement('input');
    textInp.type = 'text';
    textInp.className = 'qp-text-input';
    textInp.placeholder = suiteTr('填入输入框的完整提示词…', 'Prompt text to insert…');
    textInp.value = String(item?.text || '');
    textInp.setAttribute('value', textInp.value);

    const onFieldInput = () => {
      markQuickPromptsEditorDirty(true);
      syncQuickPopularTemplatesState();
    };
    labelInp.addEventListener('input', onFieldInput);
    textInp.addEventListener('input', onFieldInput);

    const autoSendBtn = document.createElement('button');
    autoSendBtn.type = 'button';
    autoSendBtn.className = 'switch-pill-btn qp-autosend-btn';
    const applyAutoSendBtnState = (on) => {
      const active = Boolean(on);
      autoSendBtn.setAttribute('data-auto-send', active ? 'true' : 'false');
      autoSendBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      autoSendBtn.classList?.toggle?.('active', active);
      autoSendBtn.textContent = active ? suiteTr('⚡直发', '⚡Send') : suiteTr('填入', 'Insert');
      autoSendBtn.title = active
        ? suiteTr('当前：点击快捷按钮后直接发送（按住 ⌘/Ctrl 点击可临时仅填入）', 'Current: auto-send on click (hold ⌘/Ctrl to insert only)')
        : suiteTr('当前：点击快捷按钮仅填入输入框（按住 ⌘/Ctrl 点击可临时直发）', 'Current: insert only on click (hold ⌘/Ctrl to auto-send)');
    };
    applyAutoSendBtnState(Boolean(item?.autoSend));
    autoSendBtn.addEventListener('click', () => {
      const next = autoSendBtn.getAttribute('data-auto-send') !== 'true';
      applyAutoSendBtnState(next);
      const hasDraftOrPartial = getQuickPromptEditorRows().some(r => {
        if (r.getAttribute?.('data-qp-saved') !== 'true') return true;
        const rl = String(r.querySelector?.('.qp-label-input')?.value || '').trim();
        const rt = String(r.querySelector?.('.qp-text-input')?.value || '').trim();
        return Boolean(rl) !== Boolean(rt);
      });
      if (row.getAttribute('data-qp-saved') === 'true' && labelInp.value.trim() && textInp.value.trim()) {
        if (!hasDraftOrPartial) {
          const collected = collectQuickPromptsFromEditor();
          void setSuiteQuickPrompts(collected, { skipRenderEditor: true });
        } else {
          const savedId = String(row.getAttribute('data-qp-id') || '').trim();
          const savedIdxAttr = Number(row.getAttribute('data-qp-idx'));
          const curSaved = Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts.map(it => ({ ...it })) : [];
          let targetIdx = savedId ? curSaved.findIndex(it => String(it?.id || '') === savedId) : -1;
          if (targetIdx < 0 && Number.isInteger(savedIdxAttr) && savedIdxAttr >= 0 && savedIdxAttr < curSaved.length) {
            targetIdx = savedIdxAttr;
          }
          if (targetIdx >= 0) {
            curSaved[targetIdx] = {
              ...curSaved[targetIdx],
              label: labelInp.value.trim().slice(0, 40),
              text: textInp.value.slice(0, 2000),
              title: labelInp.value.trim().slice(0, 120),
              autoSend: next
            };
            void setSuiteQuickPrompts(curSaved, { skipRenderEditor: true, preserveDirty: true, silentStatus: true });
          }
          markQuickPromptsEditorDirty(true);
        }
      } else {
        markQuickPromptsEditorDirty(true);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'qp-del-btn';
    delBtn.textContent = '×';
    delBtn.title = suiteTr('删除此条', 'Remove');
    delBtn.addEventListener('click', () => {
      const wasSaved = row.getAttribute('data-qp-saved') === 'true';
      const delId = String(row.getAttribute('data-qp-id') || '').trim();
      const delIdxAttr = Number(row.getAttribute('data-qp-idx'));
      row.remove?.();
      const remainRows = getQuickPromptEditorRows();
      const remain = remainRows.length;
      if (remain === 0) {
        clearQuickPromptsEditorDirty();
        renderQuickPromptsEditor();
      }
      if (wasSaved) {
        const hasDraftOrPartial = remainRows.some(r => {
          if (r.getAttribute?.('data-qp-saved') !== 'true') return true;
          const rl = String(r.querySelector?.('.qp-label-input')?.value || '').trim();
          const rt = String(r.querySelector?.('.qp-text-input')?.value || '').trim();
          return Boolean(rl) !== Boolean(rt);
        });
        if (!hasDraftOrPartial) {
          const collected = collectQuickPromptsFromEditor();
          void setSuiteQuickPrompts(collected.length ? collected : null, { skipRenderEditor: remain > 0 });
        } else {
          const curSaved = Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts.map(it => ({ ...it })) : [];
          let removeAt = delId ? curSaved.findIndex(it => String(it?.id || '') === delId) : -1;
          if (removeAt < 0 && Number.isInteger(delIdxAttr) && delIdxAttr >= 0 && delIdxAttr < curSaved.length) {
            removeAt = delIdxAttr;
          }
          if (removeAt >= 0) curSaved.splice(removeAt, 1);
          void setSuiteQuickPrompts(curSaved.length ? curSaved : null, {
            skipRenderEditor: true,
            preserveDirty: true,
            silentStatus: true
          });
          markQuickPromptsEditorDirty(true);
        }
      } else if (remain > 0 && !hasUnsavedQuickPromptDraftRows() && !hasPartialOrModifiedQuickPromptRows()) {
        clearQuickPromptsEditorDirty();
        setQuickPromptsStatus('');
      } else if (remain === 0) {
        setQuickPromptsStatus('');
      }
      if (remain > 0) syncQuickPopularTemplatesState();
    });

    row.appendChild(labelInp);
    row.appendChild(textInp);
    row.appendChild(autoSendBtn);
    row.appendChild(delBtn);
    listEl.appendChild(row);
    return row;
  }

  function getPopularTemplateDisplay(tpl) {
    return {
      label: suiteTr(tpl.label, tpl.labelEn),
      text: suiteTr(tpl.text, tpl.textEn)
    };
  }

  function normalizeQuickPromptMatchText(raw) {
    return String(raw || '').replace(/[\r\n]+/g, '').trim().toLowerCase();
  }

  function findMatchingQuickPromptRow(tpl) {
    if (!tpl) return null;
    const labelTargets = [tpl.label, tpl.labelEn].map(normalizeQuickPromptMatchText).filter(Boolean);
    const textTargets = [tpl.text, tpl.textEn].map(normalizeQuickPromptMatchText).filter(Boolean);
    const rows = getQuickPromptEditorRows();
    for (const row of rows) {
      const rl = normalizeQuickPromptMatchText(row.querySelector?.('.qp-label-input')?.value);
      const rt = normalizeQuickPromptMatchText(row.querySelector?.('.qp-text-input')?.value);
      if ((rl && labelTargets.includes(rl)) || (rt && textTargets.includes(rt))) {
        return row;
      }
    }
    return null;
  }

  function syncQuickPopularTemplatesState() {
    const bar = el('quick-popular-templates');
    if (!bar || typeof bar.querySelectorAll !== 'function') return;
    const chips = Array.from(bar.querySelectorAll('.qp-tpl-chip') || []);
    for (const btn of chips) {
      const tplId = String(btn.getAttribute?.('data-tpl-id') || '').trim();
      const tpl = POPULAR_QUICK_PROMPT_TEMPLATES.find(item => item.id === tplId);
      if (!tpl) continue;
      const disp = getPopularTemplateDisplay(tpl);
      const matched = Boolean(findMatchingQuickPromptRow(tpl));
      btn.setAttribute('data-added', matched ? 'true' : 'false');
      btn.setAttribute('aria-pressed', matched ? 'true' : 'false');
      btn.textContent = `${matched ? '✓' : '+'} ${disp.label}`;
      btn.title = matched
        ? suiteTr(`「${disp.label}」已在自定义列表中（点击定位）`, `"${disp.label}" is already in custom list (click to locate)`)
        : suiteTr(
            `一键添加到自定义列表：${disp.label}（${tpl.autoSend ? '默认 ⚡直发' : '默认 填入'}）`,
            `One-click add to custom list: ${disp.label} (${tpl.autoSend ? 'default ⚡Send' : 'default Insert'})`
          );
    }
  }

  function renderQuickPopularTemplates() {
    const bar = el('quick-popular-templates');
    if (!bar) return;
    const existingChips = Array.from(bar.querySelectorAll?.('.qp-tpl-chip') || []);
    if (existingChips.length === POPULAR_QUICK_PROMPT_TEMPLATES.length) {
      const prefixEl = bar.querySelector?.('.qp-tpl-label');
      if (prefixEl) prefixEl.textContent = suiteTr('热门模板：', 'Popular:');
      syncQuickPopularTemplatesState();
      return;
    }
    bar.replaceChildren?.();
    const prefix = document.createElement('span');
    prefix.className = 'qp-tpl-label';
    prefix.textContent = suiteTr('热门模板：', 'Popular:');
    bar.appendChild(prefix);

    for (const tpl of POPULAR_QUICK_PROMPT_TEMPLATES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qp-tpl-chip';
      btn.setAttribute('data-tpl-id', tpl.id);
      btn.setAttribute('data-auto-send-default', tpl.autoSend ? 'true' : 'false');
      btn.addEventListener('click', () => {
        const existingRow = findMatchingQuickPromptRow(tpl);
        const disp = getPopularTemplateDisplay(tpl);
        if (existingRow) {
          setQuickPromptsStatus(
            quickPromptsEditorDirty
              ? suiteTr(`「${disp.label}」已在下方列表中（有未保存更改，请记得点击保存）`, `"${disp.label}" is already in the list (unsaved changes pending)`)
              : suiteTr(`「${disp.label}」已在自定义列表中`, `"${disp.label}" is already in custom list`),
            quickPromptsEditorDirty ? 'dirty' : 'ok'
          );
          try { existingRow.querySelector?.('.qp-text-input')?.focus?.(); } catch {}
          try { existingRow.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } catch {}
          return;
        }
        const listEl = el('quick-prompts-editor-list');
        if (!listEl) return;
        const count = listEl.querySelectorAll('.qp-row')?.length || 0;
        if (count >= 12) {
          setQuickPromptsStatus(suiteTr('⚠️ 最多支持 12 条自定义快捷提示词', '⚠️ Maximum 12 custom quick prompts'), 'warn');
          return;
        }
        const newRow = appendQuickPromptEditorRow(
          listEl,
          { id: tpl.id, label: disp.label, text: disp.text, autoSend: Boolean(tpl.autoSend) },
          count,
          { isSaved: false }
        );
        markQuickPromptsEditorDirty(true);
        syncQuickPopularTemplatesState();
        try { newRow?.querySelector?.('.qp-text-input')?.focus?.(); } catch {}
        try { newRow?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } catch {}
      });
      bar.appendChild(btn);
    }
    syncQuickPopularTemplatesState();
  }

  function renderQuickPromptsEditor() {
    const listEl = el('quick-prompts-editor-list');
    if (!listEl) {
      renderQuickPopularTemplates();
      return;
    }
    listEl.replaceChildren();
    const items = Array.isArray(suiteQuickPrompts) ? suiteQuickPrompts : [];
    if (items.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'qp-empty-hint';
      emptyEl.textContent = suiteTr(
        '暂无自定义快捷提示词，点击右侧「+ 新增」可自由添加',
        'No custom prompts yet. Click "+ Add" on the right to create one.'
      );
      listEl.appendChild(emptyEl);
      renderQuickPopularTemplates();
      return;
    }
    for (let i = 0; i < items.length; i++) {
      appendQuickPromptEditorRow(listEl, items[i], i, { isSaved: true });
    }
    renderQuickPopularTemplates();
  }

  function collectQuickPromptsFromEditor() {
    const listEl = el('quick-prompts-editor-list');
    if (!listEl) return [];
    const rows = Array.from(listEl.querySelectorAll('.qp-row') || []);
    const out = [];
    const usedIds = new Set();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const labelInp = row.querySelector('.qp-label-input');
      const textInp = row.querySelector('.qp-text-input');
      const autoSend = row.querySelector('.qp-autosend-btn')?.getAttribute?.('data-auto-send') === 'true';
      const label = String(labelInp?.value || '').trim();
      const text = String(textInp?.value || '');
      if (!label || !text.trim()) continue;
      const rawId = String(row.getAttribute?.('data-qp-id') || '').trim();
      let id = (rawId && /^[a-zA-Z0-9_-]{1,32}$/.test(rawId) && !usedIds.has(rawId)) ? rawId : `custom-${i}`;
      while (usedIds.has(id)) id = `${id}-${i}`;
      usedIds.add(id);
      out.push({
        id,
        label: label.slice(0, 40),
        text: text.slice(0, 2000),
        title: label.slice(0, 120),
        autoSend
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  function broadcastRemoteStateChanged(data) {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('ag-remote-state-changed', {
          detail: { data }
        }));
      }
    } catch {}
  }

  function getRemoteDisplayConfig() {
    return sanitizeRemoteDisplayConfig(remoteSettingsState.data?.remoteDisplay);
  }

  function syncRemoteDisplayCheckboxes(displayCfg) {
    const cfg = sanitizeRemoteDisplayConfig(displayCfg || remoteSettingsState.data?.remoteDisplay);
    for (const [elId, key] of REMOTE_DISPLAY_BINDINGS) {
      const box = el(elId);
      if (box) box.checked = Boolean(cfg[key]);
    }
  }

  function collectRemoteDisplayFromUI() {
    const out = {};
    for (const [elId, key] of REMOTE_DISPLAY_BINDINGS) {
      const box = el(elId);
      if (box) out[key] = Boolean(box.checked);
    }
    return sanitizeRemoteDisplayConfig({
      ...(remoteSettingsState.data?.remoteDisplay || DEFAULT_REMOTE_DISPLAY_CONFIG),
      ...out
    });
  }

  function resolveRemoteChannelsForSettings(data) {
    if (!data) return [];
    const tsList = Array.isArray(data.tailscaleUrls) ? data.tailscaleUrls : [];
    const lanList = Array.isArray(data.lanUrls) ? data.lanUrls : [];
    const rawHost = rawUrl => {
      try { return new URL(String(rawUrl || '')).hostname || ''; } catch { return ''; }
    };
    let channels = Array.isArray(data.channels) && data.channels.length
      ? data.channels.map(ch => ({ ...ch }))
      : [
          {
            key: 'lan',
            label: '局域网',
            labelEn: 'LAN',
            enabled: data.enabledChannels?.lan !== false,
            available: (data.enabledChannels?.lan !== false) && lanList.length > 0,
            displayHost: rawHost(lanList[0]?.url)
          },
          {
            key: 'tailscale',
            label: 'Tailscale',
            labelEn: 'Tailscale',
            enabled: data.enabledChannels?.tailscale !== false,
            available: (data.enabledChannels?.tailscale !== false) && (tsList.length > 0 || Boolean(data.tailscaleCustomHost)),
            displayHost: data.tailscaleDnsName || data.tailscaleCustomHost || rawHost(tsList[0]?.url),
            customHost: data.tailscaleCustomHost || ''
          },
          {
            key: 'bonjour',
            label: 'Bonjour',
            labelEn: 'Bonjour',
            enabled: data.enabledChannels?.bonjour !== false,
            available: (data.enabledChannels?.bonjour !== false) && Boolean(data.bonjourHost && lanList.length > 0),
            displayHost: data.bonjourHost || ''
          },
          {
            key: 'tunnel',
            label: 'Cloudflare 隧道',
            labelEn: 'Cloudflare Tunnel',
            enabled: Boolean(data.enabledChannels?.tunnel),
            available: Boolean(data.tunnelAvailable),
            state: data.tunnelState || 'stopped',
            mode: data.tunnelMode || 'quick',
            displayHost: data.tunnelPublicUrl ? rawHost(data.tunnelPublicUrl) : '',
            tunnelHostname: data.tunnelHostname || '',
            error: data.tunnelError || ''
          }
        ];

    const switchingTunnelMode = Boolean(
      remoteSettingsState.busy &&
      (remoteSettingsState.pendingAction === 'quick' || remoteSettingsState.pendingAction === 'named')
    );
    if (switchingTunnelMode) {
      channels = channels.map(ch => (ch.key === 'tunnel'
        ? { ...ch, available: false, displayHost: '', rawHost: '' }
        : ch));
    }
    return channels;
  }

  function scheduleRemoteSettingsPoll() {
    if (remoteSettingsState.pollTimer) {
      clearTimeout(remoteSettingsState.pollTimer);
      remoteSettingsState.pollTimer = null;
    }
    if (activeSettingsTab !== 'remote') return;
    const chs = Array.isArray(remoteSettingsState.data?.channels) ? remoteSettingsState.data.channels : [];
    const tch = chs.find(c => c.key === 'tunnel');
    if (tch && tch.state === 'starting') {
      remoteSettingsState.pollTimer = setTimeout(() => {
        remoteSettingsState.pollTimer = null;
        if (activeSettingsTab === 'remote') {
          void loadRemoteSettingsInfo(false);
        }
      }, 1500);
    }
  }

  function renderRemoteSettingsChannels() {
    const root = el('settings-remote-channels-root');
    if (!root) return;
    const data = remoteSettingsState.data;
    const resetBtn = el('ag-remote-reset');
    const refreshBtn = el('btn-settings-remote-refresh');
    if (resetBtn) resetBtn.disabled = Boolean(remoteSettingsState.loading || remoteSettingsState.busy);
    if (refreshBtn) {
      refreshBtn.disabled = Boolean(remoteSettingsState.loading || remoteSettingsState.busy);
      refreshBtn.textContent = (remoteSettingsState.loading || remoteSettingsState.busy)
        ? suiteTr('处理中…', 'Working…')
        : suiteTr('刷新状态', 'Refresh');
    }

    if (remoteSettingsState.loading && !data) {
      root.innerHTML = `<div class="settings-card-desc">${escapeSuiteHtml(suiteTr('⏳ 正在读取远程通道状态…', '⏳ Loading remote channels…'))}</div>`;
      return;
    }
    if (!data) {
      root.innerHTML = `<div class="ag-rp-err">${escapeSuiteHtml(remoteSettingsState.error || suiteTr('暂未连接到手机远程服务：请确认 Antigravity 正常运行（或重启客户端）后点击「刷新状态」', 'Not connected to mobile remote service yet: ensure Antigravity is running (or restart the app), then click Refresh'))}</div>`;
      return;
    }

    const channels = resolveRemoteChannelsForSettings(data);
    const availableList = channels.filter(c => (c.enabled !== false) && c.available);
    const isTsHttpsCh = c => Boolean(
      c && c.key === 'tailscale' && c.available
      && (c.httpsUrl || (c.entryBaseUrl && String(c.entryBaseUrl).startsWith('https://')) || String(c.url || '').startsWith('https://'))
    );
    const activeChannel = availableList.find(c => c.key === 'tunnel' && c.available && c.mode === 'named')
      || availableList.find(c => isTsHttpsCh(c))
      || availableList.find(c => c.key === 'lan')
      || availableList.find(c => c.key === 'tailscale')
      || availableList.find(c => c.key === 'tunnel')
      || availableList[0]
      || null;
    const activeKey = activeChannel?.key || 'none';
    const tunnelCh = channels.find(c => c.key === 'tunnel') || null;
    const tailscaleCh = channels.find(c => c.key === 'tailscale') || null;
    const busyAny = Boolean(remoteSettingsState.loading || remoteSettingsState.busy);
    const switchingTunnelMode = Boolean(
      remoteSettingsState.busy &&
      (remoteSettingsState.pendingAction === 'quick' || remoteSettingsState.pendingAction === 'named')
    );

    const channelsHtml = `<div class="ag-rp-channels">${channels.map(ch => {
      const label = suiteTr(ch.label || ch.key, ch.labelEn || ch.label || ch.key);
      if (ch.key === 'tunnel') {
        const isStarting = switchingTunnelMode || ch.state === 'starting';
        const isRunning = !switchingTunnelMode && ch.state === 'running' && ch.available;
        const checked = !switchingTunnelMode && Boolean(ch.enabled || isRunning || ch.state === 'starting');
        const isNamedMode = ch.mode === 'named';
        const modeHint = isNamedMode ? suiteTr('固定域名', 'Fixed Domain') : suiteTr('免登录零配置', 'Quick (Zero-Config)');
        const cfgBtnLabel = isNamedMode ? suiteTr('固定域名 ▾', 'Fixed Domain ▾') : suiteTr('免登录零配置 ▾', 'Zero-Config ▾');
        const statusHint = switchingTunnelMode
          ? (remoteSettingsState.pendingAction === 'quick'
              ? suiteTr('正在切换临时隧道…', 'Switching to quick tunnel…')
              : suiteTr('正在切换固定域名…', 'Switching to fixed domain…'))
          : isStarting
            ? (ch.displayHost || suiteTr('正在分配公网隧道…', 'Provisioning Tunnel…'))
            : (isRunning
                ? (ch.displayHost || modeHint)
                : (ch.binaryAvailable === false
                    ? suiteTr('尚未安装公网通道组件（cloudflared），复制下方命令安装即可启用', 'Public tunnel component (cloudflared) not installed — copy the command below to install')
                    : suiteTr('免登录零配置 · 点击启用', 'Zero-Config · Click to enable')));
        return `
          <div id="ag-rp-tunnel-toggle" class="ag-rp-channel ag-rp-check" role="checkbox" tabindex="0" aria-checked="${checked ? 'true' : 'false'}" data-ch="tunnel" data-active="${activeKey === 'tunnel' ? 'true' : 'false'}" data-disabled="${busyAny ? 'true' : 'false'}">
            <span class="ag-rp-ch-check">
              <span aria-hidden="true">${checked ? '☑' : '☐'}</span>
              <span class="ag-rp-ch-name">${escapeSuiteHtml(label)}</span>
              <span class="ag-rp-ch-addr">${isStarting ? '<span class="ag-rp-spin"></span>' : ''}${escapeSuiteHtml(statusHint)}</span>
            </span>
            <button id="ag-rp-tunnel-cfg-btn" class="ag-rp-ch-cfg" type="button" title="${escapeSuiteHtml(suiteTr('切换免登录零配置或配置 Cloudflare 固定域名', 'Switch Quick Zero-Config or Configure Fixed Domain'))}">${escapeSuiteHtml(cfgBtnLabel)}</button>
          </div>
        `;
      }
      if (ch.key === 'tailscale') {
        const checked = ch.enabled !== false;
        const customTsHost = String(ch.customHost ?? data?.tailscaleCustomHost ?? '').trim();
        const tsCfgLabel = customTsHost ? suiteTr('已自定义 ▾', 'Custom · ▾') : suiteTr('自定义节点 ▾', 'Custom ▾');
        const addrHint = checked
          ? (ch.displayHost || (ch.available ? '' : suiteTr('当前网络不可用', 'Unavailable')))
          : suiteTr('已停用 · 点击重新启用', 'Disabled · Click to enable');
        return `
          <div id="ag-rp-toggle-tailscale" class="ag-rp-channel ag-rp-check" role="checkbox" tabindex="0" aria-checked="${checked ? 'true' : 'false'}" data-ch="tailscale" data-active="${activeKey === 'tailscale' ? 'true' : 'false'}" data-disabled="${busyAny ? 'true' : 'false'}">
            <span class="ag-rp-ch-check">
              <span aria-hidden="true">${checked ? '☑' : '☐'}</span>
              <span class="ag-rp-ch-name">${escapeSuiteHtml(label)}</span>
              <span class="ag-rp-ch-addr">${escapeSuiteHtml(addrHint)}</span>
            </span>
            <button id="ag-rp-ts-cfg-btn" class="ag-rp-ch-cfg" type="button" title="${escapeSuiteHtml(suiteTr('填写 Loon 等代理内置 Tailscale 节点地址（IP 或 .ts.net 域名）', 'Configure custom Tailscale host for proxy built-in Tailscale'))}">${escapeSuiteHtml(tsCfgLabel)}</button>
          </div>
        `;
      }
      const checked = ch.enabled !== false;
      const addrHint = checked
        ? (ch.displayHost || (ch.available ? '' : suiteTr('当前网络不可用', 'Unavailable')))
        : suiteTr('已停用 · 点击重新启用', 'Disabled · Click to enable');
      return `
        <button id="ag-rp-toggle-${escapeSuiteHtml(ch.key)}" class="ag-rp-channel ag-rp-check" type="button" role="checkbox" aria-checked="${checked ? 'true' : 'false'}" data-ch="${escapeSuiteHtml(ch.key)}" data-active="${activeKey === ch.key ? 'true' : 'false'}" ${busyAny ? 'disabled' : ''}>
          <span class="ag-rp-ch-check">
            <span aria-hidden="true">${checked ? '☑' : '☐'}</span>
            <span class="ag-rp-ch-name">${escapeSuiteHtml(label)}</span>
          </span>
          <span class="ag-rp-ch-addr">${escapeSuiteHtml(addrHint)}</span>
        </button>
      `;
    }).join('')}</div>`;

    const customTsHostSaved = String(tailscaleCh?.customHost ?? data?.tailscaleCustomHost ?? '').trim();
    const tsHostDraft = remoteSettingsState.draftTsHost !== null
      ? remoteSettingsState.draftTsHost
      : customTsHostSaved;
    const tsFormHtml = remoteSettingsState.tsConfigOpen ? `
      <div id="ag-rp-ts-form" class="ag-rp-tunnel-form">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span>${escapeSuiteHtml(suiteTr('自定义 Tailscale 节点（代理内置 Tailscale 用）', 'Custom Tailscale Node (Proxy Built-in)'))}</span>
        </div>
        <div class="ag-rp-tunnel-sub">${escapeSuiteHtml(suiteTr('仅用 Loon 等代理内置 Tailscale（未开独立版客户端）时，可填写本机在 Tailscale 中的地址，并确保代理已开启允许入站。', 'When using proxy built-in Tailscale (e.g. Loon without standalone Tailscale), enter this device’s Tailscale host and enable inbound connections in the proxy.'))}</div>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span>${escapeSuiteHtml(suiteTr('Tailscale IP 或 MagicDNS 域名（例: 100.x.y.z 或 node.tailxxxx.ts.net）', 'Tailscale IP or MagicDNS Host (e.g. 100.x.y.z or node.tailxxxx.ts.net)'))}</span>
          <input id="ag-rp-ts-host" class="ag-rp-input" type="text" placeholder="my-mac.tailxxxx.ts.net" value="${escapeSuiteHtml(tsHostDraft)}" />
        </label>
        <div class="ag-rp-form-actions">
          <button id="ag-rp-ts-save" class="ag-rp-btn primary" type="button" ${busyAny ? 'disabled' : ''}>${escapeSuiteHtml(suiteTr('保存', 'Save'))}</button>
          ${customTsHostSaved ? `<button id="ag-rp-ts-clear" class="ag-rp-btn" type="button" ${busyAny ? 'disabled' : ''}>${escapeSuiteHtml(suiteTr('清除', 'Clear'))}</button>` : ''}
          <button id="ag-rp-ts-cancel" class="ag-rp-btn" type="button">${escapeSuiteHtml(suiteTr('取消', 'Cancel'))}</button>
        </div>
      </div>
    ` : '';

    const tunnelHostDraft = remoteSettingsState.draftHost !== null
      ? remoteSettingsState.draftHost
      : (tunnelCh?.tunnelHostname || '');
    const tunnelTokenDraft = remoteSettingsState.draftToken || '';
    const hasSavedToken = Boolean(tunnelCh?.hasTunnelToken || tunnelCh?.hasToken || data?.hasTunnelToken);
    const tokenConfiguredHint = hasSavedToken
      ? suiteTr('（已配置 Token，留空保留原值）', '(Token saved — leave blank to keep)')
      : suiteTr('（从 Cloudflare Zero Trust → Tunnels 获取）', '(From Cloudflare Zero Trust → Tunnels)');

    const formHtml = remoteSettingsState.tunnelConfigOpen ? `
      <div id="ag-rp-tunnel-form" class="ag-rp-tunnel-form">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span>${escapeSuiteHtml(suiteTr('Cloudflare 固定域名（可选高级配置）', 'Cloudflare Fixed Domain (Optional)'))}</span>
          <a id="ag-rp-cf-get-token" href="https://one.dash.cloudflare.com/?to=/:account/networks/tunnels" target="_blank" rel="noopener noreferrer" style="color:var(--ag-link,var(--ag-custom-token-accent,var(--ag-token-accent-default,#a78bfa)));text-decoration:none;font-weight:500;">${escapeSuiteHtml(suiteTr('前往 Cloudflare 获取 Token →', 'Get Token on Cloudflare →'))}</a>
        </div>
        <div class="ag-rp-tunnel-sub">${escapeSuiteHtml(suiteTr('免登录临时隧道无需注册即可使用，但域名为一次性地址（电脑热更新、重启或休眠断网后会作废换新）。如需永久固定网址，请在下方绑定自己的 Cloudflare 固定域名。', 'Quick Tunnel works without login, but its URL is one-time and expires after live reload, restart, or sleep. Bind your own Cloudflare fixed domain below for a permanent URL.'))}</div>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span>${escapeSuiteHtml(suiteTr('自定义域名（例: ag.example.com）', 'Custom Hostname (e.g. ag.example.com)'))}</span>
          <input id="ag-rp-cf-host" class="ag-rp-input" type="text" placeholder="ag.example.com" value="${escapeSuiteHtml(tunnelHostDraft)}" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span>${escapeSuiteHtml(`Tunnel Token ${tokenConfiguredHint}`)}</span>
          <input id="ag-rp-cf-token" class="ag-rp-input" type="password" placeholder="eyJ..." value="${escapeSuiteHtml(tunnelTokenDraft)}" />
        </label>
        <div class="ag-rp-form-actions">
          <button id="ag-rp-cf-save" class="ag-rp-btn primary" type="button" ${busyAny ? 'disabled' : ''}>${remoteSettingsState.pendingAction === 'named' && remoteSettingsState.busy ? '<span class="ag-rp-spin"></span>' : ''}${escapeSuiteHtml(suiteTr('保存并启用', 'Save & Enable'))}</button>
          <button id="ag-rp-cf-quick" class="ag-rp-btn" type="button" ${busyAny ? 'disabled' : ''}>${remoteSettingsState.pendingAction === 'quick' && remoteSettingsState.busy ? '<span class="ag-rp-spin"></span>' : ''}${escapeSuiteHtml(suiteTr('改用免登录临时隧道', 'Use Quick Tunnel'))}</button>
          <button id="ag-rp-cf-cancel" class="ag-rp-btn" type="button">${escapeSuiteHtml(suiteTr('取消', 'Cancel'))}</button>
        </div>
      </div>
    ` : '';

    const installGuide = resolveCloudflaredInstallGuideForSettings(data);
    const missingCloudflared = tunnelCh?.binaryAvailable === false;
    const copiedInstallRecent = (Date.now() - remoteSettingsState.installCopiedAt) < 2000;
    const platformTabsHtml = [
      ['darwin', 'macOS'],
      ['win32', 'Windows'],
      ['linux', 'Linux']
    ].map(([platKey, platLabel]) => (
      `<button id="ag-rp-install-tab-${platKey}" class="ag-rp-install-tab" type="button" data-install-platform="${platKey}" data-active="${installGuide.activePlatform === platKey ? 'true' : 'false'}">${platLabel}</button>`
    )).join('');
    const installGuideHtml = `
      <div id="ag-rp-cf-install-guide" class="ag-rp-install-guide" data-missing="${missingCloudflared ? 'true' : 'false'}">
        <div class="ag-rp-install-hdr">
          <span class="ag-rp-install-title">
            <span>${escapeSuiteHtml(missingCloudflared
              ? suiteTr('安装公网通道组件 cloudflared（手机扫码远程访问所需）', 'Install public tunnel component cloudflared (Required for Mobile QR Remote Access)')
              : suiteTr('公网通道组件 cloudflared 安装命令', 'Public Tunnel Component (cloudflared) Install Command'))}</span>
            <span class="ag-rp-install-badge">${escapeSuiteHtml(missingCloudflared
              ? suiteTr('未检测到', 'Not Found')
              : suiteTr('✓ 本机已安装', '✓ Installed'))}</span>
          </span>
          <div class="ag-rp-install-tabs" role="tablist" aria-label="${escapeSuiteHtml(suiteTr('选择操作系统', 'Select OS'))}">${platformTabsHtml}</div>
        </div>
        <div class="ag-rp-install-cmd-row">
          <code id="ag-rp-cf-install-cmd" class="ag-rp-install-cmd" title="${escapeSuiteHtml(installGuide.command)}">${escapeSuiteHtml(installGuide.command)}</code>
          <button id="ag-rp-cf-copy-install" class="ag-rp-btn${missingCloudflared ? ' primary' : ''}" type="button" title="${escapeSuiteHtml(suiteTr('一键复制安装命令', 'Copy install command'))}">${escapeSuiteHtml(copiedInstallRecent ? suiteTr('✓ 已复制', '✓ Copied') : suiteTr('📋 复制命令', '📋 Copy'))}</button>
        </div>
        <div class="ag-rp-install-foot">
          <span>${escapeSuiteHtml(missingCloudflared
            ? suiteTr('打开终端粘贴运行上方命令安装完成后，点击右侧「重新检测」即可立即使用公网访问。', 'Run the command above in Terminal, then click Re-check to enable zero-config public access.')
            : suiteTr('无需注册或登录 Cloudflare 账号；在新设备部署时可一键复制上方命令安装。', 'No Cloudflare account required; copy the command above when setting up on a new machine.'))}</span>
          ${missingCloudflared
            ? `<button id="ag-rp-cf-recheck" class="ag-rp-btn" type="button" ${busyAny ? 'disabled' : ''}>${escapeSuiteHtml(suiteTr('↻ 重新检测', '↻ Re-check'))}</button>`
            : ''}
        </div>
      </div>
    `;

    const tsHttpsHintText = (
      tailscaleCh
      && tailscaleCh.enabled !== false
      && !tailscaleCh.httpsUrl
      && !data?.tailscaleHttpsUrl
    )
      ? String(tailscaleCh.httpsHint || data?.tailscaleHttpsHint || '').trim()
      : '';
    const tsHintHtml = tsHttpsHintText
      ? `<div id="ag-rp-ts-hint" class="ag-rp-hint">${escapeSuiteHtml(tsHttpsHintText)}</div>`
      : '';
    const showQuickTunnelHint = Boolean(
      tunnelCh
      && tunnelCh.mode !== 'named'
      && (tunnelCh.enabled || tunnelCh.state === 'running' || tunnelCh.state === 'starting')
    );
    const quickTunnelHintHtml = showQuickTunnelHint
      ? `<div id="ag-rp-quick-tunnel-hint" class="ag-rp-hint">${escapeSuiteHtml(suiteTr(
        '提示：免登录临时隧道域名是一次性的，电脑执行热更新、live 重载、重启软件或休眠断网后，旧域名会永久失效并更换新域名（手机旧页会出现 Error 1033）。如需固定网址，建议优先开启 Tailscale HTTPS，或点击上方「免登录零配置 ▾」绑定自己的固定域名。',
        'Note: Quick Tunnel uses a one-time URL that permanently expires after live reload, restart, or sleep (old mobile links will show Error 1033). For a permanent URL, enable Tailscale HTTPS or click "Zero-Config ▾" above to bind your fixed domain.'
      ))}</div>`
      : '';

    const errMsg = tunnelCh?.error || remoteSettingsState.error || '';
    const errHtml = errMsg ? `<div class="ag-rp-err">${escapeSuiteHtml(errMsg)}</div>` : '';

    root.innerHTML = `${channelsHtml}${tsHintHtml}${quickTunnelHintHtml}${tsFormHtml}${formHtml}${installGuideHtml}${errHtml}`;

    channels.filter(c => c.key !== 'tunnel' && c.key !== 'tailscale').forEach(ch => {
      const btn = root.querySelector(`#ag-rp-toggle-${ch.key}`);
      btn?.addEventListener('click', ev => {
        ev.stopPropagation();
        if (remoteSettingsState.busy) return;
        const nextOn = ch.enabled === false;
        void configureRemoteSettings({ enabledChannels: { [ch.key]: nextOn } });
      });
    });

    const tsToggleRow = root.querySelector('#ag-rp-toggle-tailscale');
    const tsCfgBtn = root.querySelector('#ag-rp-ts-cfg-btn');
    tsCfgBtn?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.tsConfigOpen = !remoteSettingsState.tsConfigOpen;
      remoteSettingsState.error = '';
      renderRemoteSettingsChannels();
    });
    const onTsRowToggle = ev => {
      if (ev.target && tsCfgBtn && (ev.target === tsCfgBtn || tsCfgBtn.contains?.(ev.target))) return;
      ev.stopPropagation();
      if (remoteSettingsState.busy) return;
      const nextOn = tailscaleCh?.enabled === false;
      void configureRemoteSettings({ enabledChannels: { tailscale: nextOn } });
    };
    tsToggleRow?.addEventListener('click', onTsRowToggle);
    tsToggleRow?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onTsRowToggle(ev);
      }
    });

    const tsHostInput = root.querySelector('#ag-rp-ts-host');
    tsHostInput?.addEventListener('input', ev => {
      remoteSettingsState.draftTsHost = String(ev?.target?.value ?? tsHostInput.value ?? '');
    });
    root.querySelector('#ag-rp-ts-save')?.addEventListener('click', ev => {
      ev.stopPropagation();
      const rawHost = String(tsHostInput?.value ?? remoteSettingsState.draftTsHost ?? '').trim();
      remoteSettingsState.draftTsHost = rawHost;
      if (!rawHost) {
        void configureRemoteSettings({ tailscaleCustomHost: '' });
        return;
      }
      void configureRemoteSettings({ tailscaleCustomHost: rawHost, enabledChannels: { tailscale: true } });
    });
    root.querySelector('#ag-rp-ts-clear')?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.draftTsHost = '';
      void configureRemoteSettings({ tailscaleCustomHost: '' });
    });
    root.querySelector('#ag-rp-ts-cancel')?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.tsConfigOpen = false;
      remoteSettingsState.draftTsHost = null;
      remoteSettingsState.error = '';
      renderRemoteSettingsChannels();
    });

    const toggleRow = root.querySelector('#ag-rp-tunnel-toggle');
    const cfgBtn = root.querySelector('#ag-rp-tunnel-cfg-btn');
    cfgBtn?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.tunnelConfigOpen = !remoteSettingsState.tunnelConfigOpen;
      remoteSettingsState.error = '';
      renderRemoteSettingsChannels();
    });
    const onTunnelRowToggle = ev => {
      if (ev.target && cfgBtn && (ev.target === cfgBtn || cfgBtn.contains?.(ev.target))) return;
      ev.stopPropagation();
      if (remoteSettingsState.busy) return;
      const isOn = Boolean(tunnelCh?.enabled || tunnelCh?.state === 'running' || tunnelCh?.state === 'starting');
      void configureRemoteSettings({ enabled: !isOn, enabledChannels: { tunnel: !isOn } });
    };
    toggleRow?.addEventListener('click', onTunnelRowToggle);
    toggleRow?.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onTunnelRowToggle(ev);
      }
    });

    const cfLink = root.querySelector('#ag-rp-cf-get-token');
    cfLink?.addEventListener('click', async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const targetUrl = cfLink.getAttribute('href') || 'https://one.dash.cloudflare.com/?to=/:account/networks/tunnels';
      try {
        await invokeHostBridge('/open-external-url', { url: targetUrl, dryRun: false }, 'openExternalUrl');
      } catch {}
    });

    const hostInput = root.querySelector('#ag-rp-cf-host');
    const tokenInput = root.querySelector('#ag-rp-cf-token');
    hostInput?.addEventListener('input', ev => {
      remoteSettingsState.draftHost = String(ev?.target?.value ?? hostInput.value ?? '');
    });
    tokenInput?.addEventListener('input', ev => {
      remoteSettingsState.draftToken = String(ev?.target?.value ?? tokenInput.value ?? '');
    });

    root.querySelector('#ag-rp-cf-save')?.addEventListener('click', ev => {
      ev.stopPropagation();
      const hostname = String(hostInput?.value ?? remoteSettingsState.draftHost ?? '').trim();
      const token = String(tokenInput?.value ?? remoteSettingsState.draftToken ?? '').trim();
      remoteSettingsState.draftHost = hostname;
      remoteSettingsState.draftToken = token;
      if (!hostname) {
        remoteSettingsState.error = suiteTr('请先填写自定义域名（如 ag.example.com）', 'Please enter a custom hostname');
        remoteSettingsState.tunnelConfigOpen = true;
        renderRemoteSettingsChannels();
        return;
      }
      if (!token && !hasSavedToken) {
        remoteSettingsState.error = suiteTr('首次配置固定域名请粘贴 Cloudflare Tunnel Token', 'Paste Cloudflare Tunnel Token for fixed domain');
        remoteSettingsState.tunnelConfigOpen = true;
        renderRemoteSettingsChannels();
        return;
      }
      void configureRemoteSettings({
        enabled: true,
        enabledChannels: { tunnel: true },
        tunnelMode: 'named',
        tunnelHostname: hostname,
        ...(token ? { tunnelToken: token } : {})
      });
    });

    root.querySelector('#ag-rp-cf-quick')?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.tunnelConfigOpen = true;
      void configureRemoteSettings({
        enabled: true,
        enabledChannels: { tunnel: true },
        tunnelMode: 'quick'
      });
    });

    root.querySelector('#ag-rp-cf-cancel')?.addEventListener('click', ev => {
      ev.stopPropagation();
      remoteSettingsState.tunnelConfigOpen = false;
      remoteSettingsState.draftHost = null;
      remoteSettingsState.draftToken = '';
      remoteSettingsState.error = '';
      renderRemoteSettingsChannels();
    });

    ['darwin', 'win32', 'linux'].forEach(plat => {
      const tabBtn = root.querySelector(`#ag-rp-install-tab-${plat}`);
      tabBtn?.addEventListener('click', ev => {
        ev.stopPropagation();
        if (!DEFAULT_CLOUDFLARED_INSTALL_COMMANDS[plat]) return;
        remoteSettingsState.installPlatform = plat;
        remoteSettingsState.installCopiedAt = 0;
        renderRemoteSettingsChannels();
      });
    });

    root.querySelector('#ag-rp-cf-copy-install')?.addEventListener('click', async ev => {
      ev.stopPropagation();
      const cmd = installGuide.command;
      const ok = await copyRemoteInstallCommand(cmd);
      if (ok) {
        remoteSettingsState.installCopiedAt = Date.now();
        renderRemoteSettingsChannels();
        if (remoteSettingsState.installCopyTimer) clearTimeout(remoteSettingsState.installCopyTimer);
        remoteSettingsState.installCopyTimer = setTimeout(() => {
          remoteSettingsState.installCopyTimer = null;
          renderRemoteSettingsChannels();
        }, 2100);
      }
    });

    root.querySelector('#ag-rp-cf-recheck')?.addEventListener('click', ev => {
      ev.stopPropagation();
      if (remoteSettingsState.busy || remoteSettingsState.loading) return;
      void loadRemoteSettingsInfo(false);
    });
  }

  async function loadRemoteSettingsInfo(resetToken = false) {
    if (remoteSettingsState.loading) return remoteSettingsState.data;
    remoteSettingsState.loading = true;
    remoteSettingsState.error = '';
    renderRemoteSettingsChannels();
    try {
      const res = await invokeHostBridge('/remote-info', { resetToken: Boolean(resetToken) }, 'getRemoteInfo');
      if (res && res.disabled) {
        remoteSettingsState.data = null;
        remoteSettingsState.error = suiteTr(
          '手机远程功能当前已被启动配置关闭；如需使用，请移除禁用设置后重启 Antigravity',
          'Mobile remote is currently disabled by launch settings; remove the disable option and restart Antigravity to enable it'
        );
      } else if (res && res.ok && res.data) {
        remoteSettingsState.data = res.data;
        syncRemoteDisplayCheckboxes(res.data.remoteDisplay);
        broadcastRemoteStateChanged(res.data);
      } else {
        remoteSettingsState.error = suiteTr('暂未连接到手机远程服务：请确认 Antigravity 正常运行（或重启客户端），然后点击「刷新状态」重试', 'Not connected to mobile remote service yet: ensure Antigravity is running (or restart the app), then click Refresh');
      }
    } catch {
      remoteSettingsState.error = suiteTr('读取手机远程状态失败，请点击「刷新状态」重试', 'Failed to load remote status; click Refresh to retry');
    } finally {
      remoteSettingsState.loading = false;
      renderRemoteSettingsChannels();
      scheduleRemoteSettingsPoll();
    }
    return remoteSettingsState.data;
  }

  async function configureRemoteSettings(payload = {}) {
    if (remoteSettingsState.busy) return remoteSettingsState.data;
    remoteSettingsState.busy = true;
    remoteSettingsState.pendingAction = payload.tunnelMode === 'quick'
      ? 'quick'
      : (payload.tunnelMode === 'named' ? 'named' : (payload.remoteDisplay ? 'display' : 'toggle'));
    remoteSettingsState.error = '';
    renderRemoteSettingsChannels();
    try {
      const res = await invokeHostBridge('/remote-tunnel', payload, 'configureRemoteTunnel');
      if (res && res.ok && res.data) {
        remoteSettingsState.data = res.data;
        syncRemoteDisplayCheckboxes(res.data.remoteDisplay);
        broadcastRemoteStateChanged(res.data);
        const chs = Array.isArray(res.data.channels) ? res.data.channels : [];
        const tch = chs.find(c => c.key === 'tunnel');
        const hasErr = Boolean(tch?.error || tch?.state === 'error');
        if (payload.tunnelMode === 'named' || payload.tunnelMode === 'quick') {
          if (!hasErr) {
            remoteSettingsState.tunnelConfigOpen = false;
            remoteSettingsState.draftHost = null;
            remoteSettingsState.draftToken = '';
          } else {
            remoteSettingsState.tunnelConfigOpen = true;
          }
        }
        if (payload.tailscaleCustomHost !== undefined) {
          remoteSettingsState.tsConfigOpen = false;
          remoteSettingsState.draftTsHost = null;
        }
      } else {
        const rawErr = String(res?.error || '').trim();
        const hasCjk = /[\u4e00-\u9fff]/.test(rawErr);
        remoteSettingsState.error = suiteTr(
          rawErr || '保存手机远程设置失败，请检查网络或配置后重试',
          (rawErr && !hasCjk) ? rawErr : 'Failed to save remote channel settings; check configuration and retry'
        );
        if (payload.tunnelMode === 'named' || payload.tunnelMode === 'quick') {
          remoteSettingsState.tunnelConfigOpen = true;
        }
        if (payload.tailscaleCustomHost !== undefined) {
          remoteSettingsState.tsConfigOpen = true;
        }
      }
    } catch {
      remoteSettingsState.error = suiteTr('保存手机远程设置失败，请稍后点击「刷新状态」重试', 'Failed to save remote settings; refresh and try again later');
      if (payload.tunnelMode === 'named' || payload.tunnelMode === 'quick') {
        remoteSettingsState.tunnelConfigOpen = true;
      }
      if (payload.tailscaleCustomHost !== undefined) {
        remoteSettingsState.tsConfigOpen = true;
      }
    } finally {
      remoteSettingsState.busy = false;
      remoteSettingsState.pendingAction = '';
      renderRemoteSettingsChannels();
      scheduleRemoteSettingsPoll();
    }
    return remoteSettingsState.data;
  }

  async function setRemoteDisplayConfig(partialCfg) {
    const next = sanitizeRemoteDisplayConfig({
      ...getRemoteDisplayConfig(),
      ...(partialCfg && typeof partialCfg === 'object' ? partialCfg : {})
    });
    syncRemoteDisplayCheckboxes(next);
    return await configureRemoteSettings({ remoteDisplay: next });
  }

  function switchSuiteSettingsTab(tabName = 'appearance') {
    const raw = String(tabName || 'appearance').trim().toLowerCase();
    const mapped = SETTINGS_TAB_ALIASES[raw] || raw;
    const target = SETTINGS_TAB_ORDER.includes(mapped) ? mapped : 'appearance';
    activeSettingsTab = target;
    for (const key of SETTINGS_TAB_ORDER) {
      const btn = el(`settings-tab-btn-${key}`);
      const pane = el(`settings-pane-${key}`);
      const isCur = key === target;
      if (btn) {
        setPillActive(btn, isCur);
        btn.setAttribute('aria-selected', String(isCur));
        btn.setAttribute('tabindex', isCur ? '0' : '-1');
      }
      if (pane) pane.hidden = !isCur;
    }
    if (target === 'appearance') {
      syncEnhancerPrefControls();
      applySuiteFeatureFlags();
      syncDockBadgeControls();
      void refreshDockBadgeStatus();
    } else if (target === 'remote') {
      renderRemoteSettingsChannels();
      syncRemoteDisplayCheckboxes();
      void loadRemoteSettingsInfo(false);
    } else if (target === 'chat') {
      syncEnhancerPrefControls();
      renderQuickBuiltinPool();
      if (!isQuickPromptsEditorActiveOrDirty()) {
        renderQuickPromptsEditor();
      } else {
        const tplBar = el('quick-popular-templates');
        if (tplBar && (!tplBar.children || tplBar.children.length === 0)) {
          renderQuickPopularTemplates();
        } else {
          syncQuickPopularTemplatesState();
        }
      }
    } else if (target === 'network') {
      void refreshTerminalsList();
      void refreshModulesDisplay();
    } else if (target === 'subscription') {
      syncSettingsSubPreview();
      if (typeof syncPlanCustomFormFields === 'function' && isRealShadowDomTree()) {
        syncPlanCustomFormFields(ANTIGRAVITY_TOKEN_DATA.planStatus, { enhance: true });
      }
    }
    positionFloatingPanels();
  }

  const AUTO_UPDATE_CHECK_TTL_MS = 300000;
  let lastSuiteVersionCheckAt = 0;
  let suiteVersionCheckBusy = false;
  let suiteVersionApplyBusy = false;
  let suiteVersionInfo = null;

  function renderSuiteVersionUi(info) {
    const verEl = el('suite-ver-status');
    const applyBtn = el('btn-suite-apply-update');
    const settingsBtn = el('badge-settings');
    const fallbackVer = typeof METER_VERSION === 'string' && METER_VERSION ? METER_VERSION : '0.8.5';

    if (!info || !info.ok) {
      if (verEl && !verEl.textContent) verEl.textContent = `v${fallbackVer}`;
      return;
    }

    const ver = info.version || fallbackVer;
    const sha = info.localShortSha || '';
    if (info.hasUpdate) {
      if (verEl) {
        verEl.setAttribute('data-state', 'update');
        verEl.textContent = `🔔 有新更新 (+${info.behindCount || 1} · ${info.remoteShortSha || 'new'})`;
        verEl.title = `${info.latestSubject || ''}${info.latestRelativeTime ? ` (${info.latestRelativeTime})` : ''}`.trim() || 'GitHub 仓库有新提交';
      }
      if (applyBtn) {
        applyBtn.hidden = false;
        applyBtn.disabled = false;
        applyBtn.textContent = '立即更新';
      }
      if (settingsBtn) {
        settingsBtn.setAttribute('data-has-update', 'true');
        settingsBtn.setAttribute('title', '发现新版本，点击打开设置一键更新');
      }
    } else if (info.isGitRepo === false) {
      if (verEl) {
        verEl.setAttribute('data-state', 'muted');
        verEl.textContent = `v${ver}（手动安装版）`;
        verEl.title = '当前为手动安装版，暂不支持在线一键更新，如需更新请前往项目页下载新版覆盖安装';
      }
      if (applyBtn) applyBtn.hidden = true;
      if (settingsBtn) {
        settingsBtn.removeAttribute('data-has-update');
        settingsBtn.setAttribute('title', '打开 Antigravity Suite 统一设置面板');
      }
    } else {
      if (verEl) {
        verEl.setAttribute('data-state', info.fetchError ? 'muted' : 'ok');
        verEl.textContent = sha ? `v${ver} (${sha} · 已是最新)` : `v${ver} · 已是最新`;
        verEl.title = info.fetchError
          ? `暂时无法检查更新：${info.fetchError}`
          : (info.localSubject ? `当前提交: ${info.localSubject}` : '当前版本与仓库同步');
      }
      if (applyBtn) applyBtn.hidden = true;
      if (settingsBtn) {
        settingsBtn.removeAttribute('data-has-update');
        settingsBtn.setAttribute('title', '打开 Antigravity Suite 统一设置面板');
      }
    }
    applySuiteShadowLocale();
  }

  async function checkSuiteRepoUpdate(opts = {}) {
    if (suiteVersionCheckBusy || suiteVersionApplyBusy) return suiteVersionInfo;
    if (typeof window === 'undefined' || !window.__AGContextMeterLive?.port) {
      const verEl = el('suite-ver-status');
      const fallbackVer = typeof METER_VERSION === 'string' && METER_VERSION ? METER_VERSION : '0.8.5';
      if (verEl && !verEl.textContent) verEl.textContent = `v${fallbackVer}`;
      return null;
    }
    suiteVersionCheckBusy = true;
    try {
      const res = await invokeHostBridge('/suite-version-check', { fetchRemote: opts?.fetchRemote !== false }, 'suiteVersionCheck');
      if (res && res.ok) {
        lastSuiteVersionCheckAt = Date.now();
        suiteVersionInfo = res;
        renderSuiteVersionUi(res);
      }
      return res || null;
    } catch {
      return null;
    } finally {
      suiteVersionCheckBusy = false;
    }
  }

  async function applySuiteRepoUpdate() {
    if (suiteVersionApplyBusy) return null;
    const applyBtn = el('btn-suite-apply-update');
    const verEl = el('suite-ver-status');
    const settingsBtn = el('badge-settings');
    suiteVersionApplyBusy = true;
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = '⏳ 正在更新…';
      applySuiteShadowLocale();
    }
    try {
      const res = await invokeHostBridge('/suite-apply-update', {}, 'suiteApplyUpdate');
      if (res && res.ok) {
        suiteVersionInfo = {
          ok: true,
          isGitRepo: true,
          version: res.version,
          localShortSha: res.localShortSha,
          localSubject: res.localSubject,
          hasUpdate: false,
          behindCount: 0
        };
        if (verEl) {
          verEl.setAttribute('data-state', 'ok');
          verEl.textContent = `✅ 已更新至 v${res.version} (${res.localShortSha})`;
          verEl.title = res.localSubject ? `最新提交: ${res.localSubject}` : '已完成热更新';
        }
        if (applyBtn) applyBtn.hidden = true;
        if (settingsBtn) {
          settingsBtn.removeAttribute('data-has-update');
          settingsBtn.setAttribute('title', '打开 Antigravity Suite 统一设置面板');
        }
        applySuiteShadowLocale();
        return res;
      }
      const errMsg = res?.noGitRepo
        ? '手动安装版暂不支持一键更新'
        : (res?.dirty ? '检测到本地修改，已暂停自动更新' : (res?.error || '请检查网络或代理后重试'));
      if (verEl) {
        verEl.setAttribute('data-state', 'muted');
        verEl.textContent = `✖ 更新失败：${errMsg}`;
        verEl.title = '更新未完成（当前版本与配置不受影响），请检查网络或代理后重试';
      }
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = '立即更新';
      }
      applySuiteShadowLocale();
      return res || null;
    } catch {
      if (verEl) {
        verEl.setAttribute('data-state', 'muted');
        verEl.textContent = '✖ 更新失败：请检查网络或代理后重试';
        verEl.title = '更新未完成（当前版本与配置不受影响），请检查网络或代理后重试';
      }
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = '立即更新';
      }
      applySuiteShadowLocale();
      return null;
    } finally {
      suiteVersionApplyBusy = false;
    }
  }

  function openSuiteSettings(tabName = activeSettingsTab) {
    transplantConfigControlsOnce();
    showPanel('settings');
    switchSuiteSettingsTab(tabName || activeSettingsTab);
    if (!lastSuiteVersionCheckAt || Date.now() - lastSuiteVersionCheckAt >= AUTO_UPDATE_CHECK_TTL_MS) {
      void checkSuiteRepoUpdate({ fetchRemote: true });
    }
  }

  function toggleSuiteSettings(tabName) {
    const pSettings = el('panel-settings');
    const raw = String(tabName || '').trim().toLowerCase();
    const resolvedTab = raw ? (SETTINGS_TAB_ALIASES[raw] || raw) : '';
    if (pSettings && !pSettings.hidden && (!resolvedTab || resolvedTab === activeSettingsTab)) {
      showPanel('none');
    } else {
      openSuiteSettings(resolvedTab || activeSettingsTab);
    }
  }

  el('badge-settings')?.addEventListener('click', () => toggleSuiteSettings());
  el('overflow-settings-btn')?.addEventListener('click', () => openSuiteSettings());
  el('close-settings')?.addEventListener('click', () => showPanel('none'));

  SETTINGS_TAB_ORDER.forEach(tab => {
    el(`settings-tab-btn-${tab}`)?.addEventListener('click', () => switchSuiteSettingsTab(tab));
  });

  el('btn-add-quick-prompt')?.addEventListener('click', () => {
    const listEl = el('quick-prompts-editor-list');
    if (!listEl) return;
    const count = listEl.querySelectorAll('.qp-row')?.length || 0;
    if (count >= 12) {
      setQuickPromptsStatus(suiteTr('⚠️ 最多支持 12 条自定义快捷提示词', '⚠️ Maximum 12 custom quick prompts'), 'warn');
      return;
    }
    const newRow = appendQuickPromptEditorRow(listEl, { label: '', text: '', autoSend: false }, count, { isSaved: false });
    markQuickPromptsEditorDirty(true);
    try { newRow?.querySelector?.('.qp-label-input')?.focus?.(); } catch {}
    try { newRow?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } catch {}
  });

  el('btn-save-quick-prompts')?.addEventListener('click', () => {
    const rows = getQuickPromptEditorRows();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const labelInp = r.querySelector?.('.qp-label-input');
      const textInp = r.querySelector?.('.qp-text-input');
      const label = String(labelInp?.value || '').trim();
      const textTrim = String(textInp?.value || '').trim();
      if (!label && !textTrim) continue;
      if (!label || !textTrim) {
        setQuickPromptsStatus(
          suiteTr(
            `⚠️ 第 ${i + 1} 行请同时填写按钮文案和提示词内容`,
            `⚠️ Row ${i + 1}: please fill both label and prompt text`
          ),
          'warn'
        );
        try { (!label ? labelInp : textInp)?.focus?.(); } catch {}
        return;
      }
    }
    const collected = collectQuickPromptsFromEditor();
    void setSuiteQuickPrompts(collected);
  });

  el('btn-reset-quick-prompts')?.addEventListener('click', () => {
    void resetSuiteQuickPrompts();
  });

  el('btn-settings-remote-refresh')?.addEventListener('click', () => {
    void loadRemoteSettingsInfo(false);
  });

  el('ag-remote-reset')?.addEventListener('click', () => {
    void loadRemoteSettingsInfo(true);
  });

  el('btn-reset-remote-display')?.addEventListener('click', () => {
    void setRemoteDisplayConfig({ ...DEFAULT_REMOTE_DISPLAY_CONFIG });
  });

  for (const [elId] of REMOTE_DISPLAY_BINDINGS) {
    el(elId)?.addEventListener('change', () => {
      const nextCfg = collectRemoteDisplayFromUI();
      void configureRemoteSettings({ remoteDisplay: nextCfg });
    });
  }

  const onSuitePrefsChangedInSettings = ev => {
    if (typeof state !== 'undefined' && state?.disposed) {
      try { window.removeEventListener?.('ag-suite-prefs-changed', onSuitePrefsChangedInSettings); } catch {}
      return;
    }
    const detail = ev?.detail;
    if (!detail || typeof detail !== 'object') return;
    if (detail.featureFlags && typeof detail.featureFlags === 'object') {
      let flagsChanged = false;
      for (const k of Object.keys(DEFAULT_SUITE_FEATURE_FLAGS)) {
        if (typeof detail.featureFlags[k] === 'boolean' && suiteFeatureFlags[k] !== detail.featureFlags[k]) {
          suiteFeatureFlags[k] = detail.featureFlags[k];
          flagsChanged = true;
        }
      }
      if (flagsChanged) {
        syncFeatureFlagControls();
        applySuiteFeatureFlags();
      }
    }
    if (detail.codexUi && typeof detail.codexUi === 'object') {
      const nextCodex = normalizeCodexUiConfig(detail.codexUi, suiteCodexUi);
      if (JSON.stringify(nextCodex) !== JSON.stringify(suiteCodexUi)) {
        suiteCodexUi = nextCodex;
        syncCodexUiControls();
      }
    }
    if ('locale' in detail || 'hansCode' in detail || 'capsuleLang' in detail) {
      const incoming = findSupportedLocaleEntry(detail.locale || detail.hansCode || detail.capsuleLang);
      if (incoming.code !== suiteEnhancerPrefs.locale) {
        suiteEnhancerPrefs.locale = incoming.code;
        suiteEnhancerPrefs.capsuleLang = incoming.capsuleLang;
      }
      if (activeSettingsTab === 'remote' && remoteSettingsState.data) {
        renderRemoteSettingsChannels();
      }
      renderDockBadgeStatusNote();
      applySuiteShadowLocale();
    }
  };

  const onCodexConfigChanged = ev => {
    if (typeof state !== 'undefined' && state?.disposed) {
      try { window.removeEventListener?.('ag-codex-config-changed', onCodexConfigChanged); } catch {}
      return;
    }
    const incoming = ev?.detail?.codexUi;
    if (!incoming || typeof incoming !== 'object') return;
    const nextCodex = normalizeCodexUiConfig(incoming, suiteCodexUi);
    if (JSON.stringify(nextCodex) !== JSON.stringify(suiteCodexUi)) {
      suiteCodexUi = nextCodex;
      syncCodexUiControls();
    }
  };

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('ag-suite-prefs-changed', onSuitePrefsChangedInSettings);
      window.addEventListener('ag-codex-config-changed', onCodexConfigChanged);
    }
  } catch {}

  el('btn-refresh-terminals')?.addEventListener('click', () => {
    void refreshTerminalsList();
  });

  el('btn-pick-term-path')?.addEventListener('click', async () => {
    const statusEl = el('term-config-status');
    try {
      if (!window?.contextMeterAPI?.pickTerminalPath && !window?.__AGContextMeterLive?.port) {
        if (statusEl) {
          statusEl.textContent = suiteTr(
            '⚠️ 当前页面暂不支持弹窗选文件，请在左侧输入框粘贴终端程序路径后点击「保存路径」',
            '⚠️ File picker is unavailable here — paste the terminal path on the left and click "Save Path"'
          );
        }
        return;
      }
      const res = await invokeHostBridge('/pick-terminal-path', {}, 'pickTerminalPath');
      if (res?.ok && !res.canceled && res.path) {
        const inp = el('input-custom-term-path');
        if (inp) inp.value = res.path;
        await setSuiteTerminalSettings('custom', res.path);
        await refreshTerminalsList();
      } else if (res && res.ok === false && statusEl) {
        statusEl.textContent = suiteTr(
          '✖ 未能完成选择，请直接手动输入终端路径后点击「保存路径」',
          '✖ Could not select terminal app — enter the path manually and click "Save Path"'
        );
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = suiteTr(
          '✖ 无法打开文件选择器，请直接手动输入终端路径后点击「保存路径」',
          '✖ Unable to open file picker — enter the terminal path manually and click "Save Path"'
        );
      }
    }
  });

  el('btn-save-term-path')?.addEventListener('click', async () => {
    const raw = el('input-custom-term-path')?.value?.trim() || '';
    await setSuiteTerminalSettings('custom', raw);
    await refreshTerminalsList();
  });

  el('set-cli-skip-permissions')?.addEventListener('change', e => {
    void setSuiteCliSettings({ skipPermissions: Boolean(e?.target?.checked) });
  });

  el('set-cli-model-select')?.addEventListener('change', e => {
    const val = String(e?.target?.value ?? '').trim();
    const customRow = el('cli-custom-model-row');
    if (val === '__custom__') {
      if (customRow) customRow.style.display = 'flex';
      return;
    }
    if (customRow) customRow.style.display = 'none';
    void setSuiteCliSettings({ model: val });
  });

  el('btn-save-cli-model')?.addEventListener('click', () => {
    const raw = el('input-cli-custom-model')?.value?.trim() || '';
    void setSuiteCliSettings({ model: raw });
  });

  el('set-cli-mux-host-select')?.addEventListener('change', e => {
    const val = String(e?.target?.value ?? '').trim();
    const customRow = el('cli-custom-mux-host-row');
    if (val === '__custom__') {
      if (customRow) customRow.style.display = 'flex';
      return;
    }
    if (customRow) customRow.style.display = 'none';
    void setSuiteCliSettings({ muxHost: val });
  });

  el('btn-save-cli-mux-host')?.addEventListener('click', () => {
    const raw = el('input-cli-mux-host')?.value?.trim() || '';
    void setSuiteCliSettings({ muxHost: raw });
  });

  el('btn-test-terminal')?.addEventListener('click', async () => {
    const statusEl = el('term-config-status');
    if (statusEl) statusEl.textContent = suiteTr('⏳ 正在尝试打开所选终端…', '⏳ Launching selected terminal…');
    try {
      const cliCfg = getSuiteCliSettings();
      const res = await triggerLaunchCli({
        terminalApp: suiteTerminalState.terminalApp,
        customTerminalPath: el('input-custom-term-path')?.value?.trim() || suiteTerminalState.customTerminalPath,
        muxHost: suiteTerminalState.cliMuxHost || '',
        skipPermissions: cliCfg.skipPermissions,
        model: cliCfg.model,
        noModel: cliCfg.noModel,
        testOnly: true
      });
      if (statusEl) {
        if (res?.ok) {
          const rawTerm = String(res.terminal || suiteTerminalState.terminalApp || '');
          const termDisp = suiteTr(rawTerm, translateSuiteDynamicFragmentEn(rawTerm));
          const cwdDisp = res.cwd || suiteTr('默认目录', 'Default Folder');
          const hostSuffix = res?.muxHost ? suiteTr(` · 主机: ${res.muxHost}`, ` · Host: ${res.muxHost}`) : '';
          statusEl.textContent = suiteTr(
            `✅ 测试启动成功：${termDisp} (${cwdDisp}${hostSuffix})`,
            `✅ Test launch succeeded: ${termDisp} (${cwdDisp}${hostSuffix})`
          );
        } else {
          const rawErr = String(res?.error || '').trim();
          const hasCjk = /[\u4e00-\u9fff]/.test(rawErr);
          const zhFallback = res?.code === 'NO_BRIDGE'
            ? '未连接到 Antigravity 后台助手，请完全退出并重新打开客户端后再试'
            : (rawErr || '请确认所选终端已安装，或切换为「自定义程序路径」手动指定后再试');
          const enFallback = res?.code === 'NO_BRIDGE'
            ? 'Not connected to the background helper; quit and reopen Antigravity and retry'
            : ((rawErr && !hasCjk) ? rawErr : 'confirm the selected terminal is installed, or choose "Custom Path" and retry');
          statusEl.textContent = suiteTr(
            `✖ 测试启动失败：${zhFallback}`,
            `✖ Test launch failed: ${enFallback}`
          );
        }
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = suiteTr(
          '✖ 测试启动失败：请确认所选终端已安装，或切换为「自定义程序路径」手动指定后再试',
          '✖ Test launch failed: confirm the selected terminal is installed, or choose "Custom Path" and retry'
        );
      }
    }
  });

  const applyThemeChoice = (mode) => {
    currentThemeMode = mode;
    try { localStorage?.setItem?.('ag_theme_mode', mode); } catch {}
    applyTheme();
    syncSettingsThemePills();
    dispatchSuitePrefsChanged();
    void saveSuiteUiPrefs({ themeMode: mode });
  };
  el('set-theme-auto')?.addEventListener('click', () => applyThemeChoice('auto'));
  el('set-theme-light')?.addEventListener('click', () => applyThemeChoice('light'));
  el('set-theme-dark')?.addEventListener('click', () => applyThemeChoice('dark'));

  el('set-auto-accept')?.addEventListener('change', e => {
    suiteEnhancerPrefs.autoAccept = Boolean(e?.target?.checked);
    dispatchSuitePrefsChanged();
    void saveSuiteUiPrefs({ autoAccept: suiteEnhancerPrefs.autoAccept });
  });

  el('set-ghost-suggest')?.addEventListener('change', e => {
    suiteEnhancerPrefs.ghostSuggest = Boolean(e?.target?.checked);
    dispatchSuitePrefsChanged();
    void saveSuiteUiPrefs({ ghostSuggest: suiteEnhancerPrefs.ghostSuggest });
  });

  el('set-auto-compact')?.addEventListener('change', e => {
    suiteEnhancerPrefs.autoCompact = Boolean(e?.target?.checked);
    dispatchSuitePrefsChanged();
    void saveSuiteUiPrefs({ autoCompact: suiteEnhancerPrefs.autoCompact });
  });

  el('set-long-fold')?.addEventListener('change', e => {
    suiteEnhancerPrefs.longFold = Boolean(e?.target?.checked);
    dispatchSuitePrefsChanged();
    void saveSuiteUiPrefs({ longFold: suiteEnhancerPrefs.longFold });
  });

  el('set-quick-builtin-autosend')?.addEventListener('change', e => {
    void setSuiteQuickBuiltinAutoSend(Boolean(e?.target?.checked));
  });

  el('set-ui-language-select')?.addEventListener('change', e => {
    void setSuiteLocale(e?.target?.value || 'zh-TW');
  });

  el('set-base-currency-select')?.addEventListener('change', e => {
    const nextCur = String(e?.target?.value || 'TWD').trim().toUpperCase();
    if (nextCur !== 'TWD' && nextCur !== 'USD' && nextCur !== 'CNY') return;
    try { localStorage?.setItem?.(BASE_CURRENCY_STORAGE_KEY, nextCur); } catch {}
    try { uiBaseCurrencyDropdown?.refresh?.(); } catch {}
    try { renderPlanDetail?.(ANTIGRAVITY_TOKEN_DATA.planStatus); } catch {}
    try { refreshDirectRegionDisplay?.(); } catch {}
    try { renderActiveCostEstimateView?.(); } catch {}
    try { renderActiveHeatView?.(true); } catch {}
    try { syncSettingsSubPreview?.(); } catch {}
  });

  el('set-english-labels')?.addEventListener('change', e => {
    suiteEnhancerPrefs.englishLabels = Boolean(e?.target?.checked);
    syncEnhancerPrefControls();
    dispatchSuitePrefsChanged();
    try { window.__antigravityZhSetEnglishLabels?.(suiteEnhancerPrefs.englishLabels, true); } catch {}
    void saveSuiteUiPrefs({ englishLabels: suiteEnhancerPrefs.englishLabels });
  });

  el('set-dock-badge-enabled')?.addEventListener('change', async e => {
    suiteEnhancerPrefs.dockBadgeEnabled = Boolean(e?.target?.checked);
    syncDockBadgeControls();
    dispatchSuitePrefsChanged();
    await saveSuiteUiPrefs({ dockBadgeEnabled: suiteEnhancerPrefs.dockBadgeEnabled });
    void refreshDockBadgeStatus();
  });

  const applyDockBadgeStyleChoice = async (style) => {
    suiteEnhancerPrefs.dockBadgeStyle = normalizeDockBadgeStyle(style);
    syncDockBadgeControls();
    dispatchSuitePrefsChanged();
    await saveSuiteUiPrefs({ dockBadgeStyle: suiteEnhancerPrefs.dockBadgeStyle });
    void refreshDockBadgeStatus();
  };
  el('set-dock-style-capsule')?.addEventListener('click', () => { void applyDockBadgeStyleChoice('capsule'); });
  el('set-dock-style-badge')?.addEventListener('click', () => { void applyDockBadgeStyleChoice('badge'); });

  el('set-dock-badge-color-tier')?.addEventListener('change', async e => {
    suiteEnhancerPrefs.dockBadgeColorTier = Boolean(e?.target?.checked);
    syncDockBadgeControls();
    dispatchSuitePrefsChanged();
    await saveSuiteUiPrefs({ dockBadgeColorTier: suiteEnhancerPrefs.dockBadgeColorTier });
    void refreshDockBadgeStatus();
  });

  el('set-dock-badge-autoclear')?.addEventListener('change', async e => {
    suiteEnhancerPrefs.dockBadgeAutoClear = Boolean(e?.target?.checked);
    syncDockBadgeControls();
    dispatchSuitePrefsChanged();
    await saveSuiteUiPrefs({ dockBadgeAutoClear: suiteEnhancerPrefs.dockBadgeAutoClear });
    void refreshDockBadgeStatus();
  });

  el('btn-test-dock-badge')?.addEventListener('click', async () => {
    const hasBridge = typeof window !== 'undefined' && (Boolean(window.__AGContextMeterLive?.port) || typeof window.contextMeterAPI?.dockBadgeTest === 'function');
    if (!hasBridge) {
      setDockBadgeStatusNote(
        '尚未连接到 Antigravity 后台助手，请完全退出并重新打开 Antigravity 后重试',
        'Not connected to the Antigravity background helper yet. Quit and reopen Antigravity, then try again.',
        'warn',
        true
      );
      return;
    }
    const testBtn = el('btn-test-dock-badge');
    if (testBtn) testBtn.disabled = true;
    setDockBadgeStatusNote(
      '正在向 macOS Dock 发送 5 秒预览提醒…',
      'Sending 5-second preview alert to macOS Dock…',
      '',
      true
    );
    try {
      const res = await invokeHostBridge('/dock-badge-test', {
        style: normalizeDockBadgeStyle(suiteEnhancerPrefs.dockBadgeStyle),
        colorTier: suiteEnhancerPrefs.dockBadgeColorTier !== false,
        locale: suiteEnhancerPrefs.locale || 'zh-TW'
      }, 'dockBadgeTest');
      if (res && res.ok) {
        if (res.status?.axTrusted === false) {
          setDockBadgeStatusNote(
            '已发送预览请求，但尚未开启「辅助功能」权限，暂时无法显示在 Dock 图标上 — 请点击右上角「前往开启权限」并勾选放行',
            'Preview requested, but Accessibility permission is needed to show it on the Dock icon — click "Grant Access" above to enable it.',
            'warn',
            false
          );
        } else {
          const curStyle = normalizeDockBadgeStyle(res.status?.style || suiteEnhancerPrefs.dockBadgeStyle);
          if (curStyle === 'badge') {
            setDockBadgeStatusNote(
              '已发送 5 秒预览提醒（模拟 2 条待审批），请查看底部 Dock 中 Antigravity 图标右上角的红色角标（5 秒后自动恢复）',
              '5-second preview alert sent (simulating 2 pending approvals) — check the red badge at the top-right of the Antigravity Dock icon (clears automatically in 5s)',
              'ok',
              true
            );
          } else {
            setDockBadgeStatusNote(
              '已发送 5 秒预览提醒（模拟 2 条待审批、3 条新回复），请查看底部 Dock 中的 Antigravity 图标（5 秒后自动恢复）',
              '5-second preview alert sent (simulating 2 pending approvals & 3 unread replies) — check the Antigravity Dock icon (clears automatically in 5s)',
              'ok',
              true
            );
          }
        }
      } else {
        const axNeed = res?.axTrusted === false || res?.status?.axTrusted === false;
        const errCode = String(res?.errorCode || '').trim().toUpperCase();
        const errCodeMap = {
          UNSUPPORTED: [
            '当前电脑不是 macOS，无法使用 Dock 图标提醒',
            'Dock icon alerts are only available on macOS.'
          ],
          DISABLED: [
            '请先打开「启用 macOS Dock 图标提醒」开关后再试',
            'Please turn on "Enable macOS Dock Icon Alerts" first and try again.'
          ],
          STOPPED: [
            'Dock 提醒服务已停止，请完全退出并重新打开 Antigravity 后重试',
            'Dock alert service has stopped. Quit and reopen Antigravity, then try again.'
          ],
          NOT_READY: [
            '当前后台服务尚未开启 Dock 图标提醒，请完全退出并重新打开 Antigravity 后重试',
            'Dock icon alerts are not ready in the background helper yet. Quit and reopen Antigravity and retry.'
          ],
          HELPER_START_FAILED: [
            'Dock 提醒组件启动失败，请根据上方状态提示检查权限或命令行工具后重试',
            'Failed to start the Dock alert helper. Check permissions or Command Line Tools per the status above and retry.'
          ]
        };
        if (axNeed) {
          setDockBadgeStatusNote(
            '需要开启「辅助功能」权限才能在 Dock 图标上显示提醒，请点击右上角「前往开启权限」并勾选放行',
            'Accessibility permission is required to show alerts on the Dock icon. Click "Grant Access" above and retry.',
            'warn',
            false
          );
        } else {
          const pair = errCodeMap[errCode] || [
            '未能触发 Dock 预览提醒，请确认开关已开启且辅助功能权限正常后重试',
            'Unable to trigger Dock preview alert; verify alerts are enabled and Accessibility permission is granted.'
          ];
          setDockBadgeStatusNote(pair[0], pair[1], 'error', true);
        }
      }
    } catch {
      setDockBadgeStatusNote(
        '发送预览提醒失败，请确认 Antigravity 正常运行后重试',
        'Failed to send Dock preview alert. Ensure Antigravity is running and try again.',
        'error',
        true
      );
    } finally {
      syncDockBadgeControls();
    }
  });

  el('btn-dock-open-ax')?.addEventListener('click', async () => {
    const hasBridge = typeof window !== 'undefined' && (Boolean(window.__AGContextMeterLive?.port) || typeof window.contextMeterAPI?.dockBadgeOpenAx === 'function');
    if (!hasBridge) {
      setDockBadgeStatusNote(
        '请手动打开「系统设置 → 隐私与安全性 → 辅助功能」，在列表中为「Antigravity Suite Dock 提醒」开启权限',
        'Open System Settings → Privacy & Security → Accessibility manually and enable permission for Antigravity Suite Dock 提醒.',
        'warn',
        false
      );
      return;
    }
    try {
      const res = await invokeHostBridge('/dock-badge-open-ax', {}, 'dockBadgeOpenAx');
      if (res && res.ok) {
        setDockBadgeStatusNote(
          '已打开「系统设置 → 隐私与安全性 → 辅助功能」，请在列表中为「Antigravity Suite Dock 提醒」开启权限，几秒后自动生效',
          'Opened System Settings → Privacy & Security → Accessibility. Enable permission for Antigravity Suite Dock 提醒; it takes effect in a few seconds.',
          'warn',
          false
        );
      } else if (res?.errorCode === 'HELPER_START_FAILED') {
        setDockBadgeStatusNote(
          res.error || '无法启动 Dock 图标提醒助手，请重试',
          'Could not start the Dock badge helper. Try again.',
          'error',
          true
        );
      } else {
        setDockBadgeStatusNote(
          '未能自动打开系统设置，请手动前往「系统设置 → 隐私与安全性 → 辅助功能」，为「Antigravity Suite Dock 提醒」开启权限',
          'Could not open System Settings automatically. Manually open System Settings → Privacy & Security → Accessibility and enable permission for Antigravity Suite Dock 提醒.',
          'warn',
          false
        );
      }
    } catch {
      setDockBadgeStatusNote(
        '无法打开系统设置，请手动前往「系统设置 → 隐私与安全性 → 辅助功能」，为「Antigravity Suite Dock 提醒」开启权限',
        'Unable to open System Settings. Manually open System Settings → Privacy & Security → Accessibility and enable permission for Antigravity Suite Dock 提醒.',
        'warn',
        false
      );
    }
  });

  [
    ['set-feat-tokens', 'showTopbarTokens'],
    ['set-feat-cli', 'showTopbarCli'],
    ['set-feat-quota', 'showTopbarQuota'],
    ['set-feat-remote', 'showTopbarRemote'],
    ['set-feat-quickbar', 'showQuickBar'],
    ['set-feat-chatnav', 'showChatNav']
  ].forEach(([id, key]) => {
    el(id)?.addEventListener('change', e => {
      void setSuiteFeatureFlags({ [key]: Boolean(e?.target?.checked) });
    });
  });

  el('set-feat-sidebar-quota')?.addEventListener('change', e => {
    void setSuiteCodexUi({ quotaSidebar: Boolean(e?.target?.checked) });
  });

  el('set-codex-theme')?.addEventListener('change', e => {
    void setSuiteCodexUi({ codexTheme: Boolean(e?.target?.checked) });
  });

  el('set-codex-pool-filter')?.addEventListener('change', e => {
    const val = String(e?.target?.value ?? 'all').trim();
    void setSuiteCodexUi({ quotaPoolFilter: val });
  });

  el('set-codex-quota-style')?.addEventListener('change', e => {
    const val = String(e?.target?.value ?? 'bar').trim();
    void setSuiteCodexUi({ quotaStyle: val });
  });

  el('set-codex-quota-other')?.addEventListener('change', e => {
    const val = String(e?.target?.value ?? 'hidden').trim();
    void setSuiteCodexUi({ quotaOtherStyle: val });
  });

  el('btn-reset-feature-toggles')?.addEventListener('click', () => {
    void setSuiteFeatureFlags({ ...DEFAULT_SUITE_FEATURE_FLAGS });
    if (suiteCodexUi.quotaSidebar !== true) {
      void setSuiteCodexUi({ quotaSidebar: true });
    } else {
      syncCodexUiControls();
    }
  });

  el('btn-toggle-heat-advanced')?.addEventListener('click', () => {
    const box = el('heat-advanced-colors-box');
    const btn = el('btn-toggle-heat-advanced');
    if (!box) return;
    const isHidden = box.style.display === 'none' || !box.style.display;
    box.style.display = isHidden ? 'block' : 'none';
    if (btn) {
      btn.textContent = isHidden ? '收起色阶微调 ▲' : '高级色阶微调 ▼';
      applySuiteShadowLocale();
    }
  });

  el('suite-ver-status')?.addEventListener('click', () => {
    void checkSuiteRepoUpdate({ fetchRemote: true });
  });

  el('btn-suite-apply-update')?.addEventListener('click', () => {
    void applySuiteRepoUpdate();
  });

  const onSuiteWindowFocusForUpdate = () => {
    if (typeof state !== 'undefined' && state?.disposed) {
      try { window.removeEventListener?.('focus', onSuiteWindowFocusForUpdate); } catch {}
      return;
    }
    if (!lastSuiteVersionCheckAt || Date.now() - lastSuiteVersionCheckAt >= AUTO_UPDATE_CHECK_TTL_MS) {
      void checkSuiteRepoUpdate({ fetchRemote: true });
    }
  };
  try {
    if (isRealShadowDomTree() && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', onSuiteWindowFocusForUpdate);
    }
  } catch {}

  transplantConfigControlsOnce();
  syncEnhancerPrefControls();
  applySuiteFeatureFlags();
  syncFeatureFlagControls();
  syncCodexUiControls();
  syncDockBadgeControls();
  renderQuickBuiltinPool();
  renderQuickPromptsEditor();
  renderTerminalGrid();
  dispatchSuitePrefsChanged();
  applySuiteShadowLocale();
  if (el('suite-ver-status') && typeof METER_VERSION === 'string' && METER_VERSION) {
    el('suite-ver-status').textContent = `v${METER_VERSION}`;
  }
  if (isRealShadowDomTree() && typeof window !== 'undefined' && window.__AGContextMeterLive?.port) {
    void checkSuiteRepoUpdate({ fetchRemote: true });
    void refreshDockBadgeStatus();
  }
  globalThis.__AGContextMeter = window.__AGContextMeter = {
    version: typeof METER_VERSION !== 'undefined' ? METER_VERSION : '0.8.2',
    ensureAlive: () => {
      if (state.disposed) return false;
      ensureHostDocked();
      render();
      return true;
    },
    theme: () => resolveTheme(),
    setTheme: mode => {
      currentThemeMode = mode;
      try { localStorage.setItem('ag_theme_mode', mode); } catch {}
      applyTheme();
      if (typeof syncSettingsThemePills === 'function') syncSettingsThemePills();
      if (typeof dispatchSuitePrefsChanged === 'function') dispatchSuitePrefsChanged();
      if (typeof saveSuiteUiPrefs === 'function') void saveSuiteUiPrefs({ themeMode: mode });
    },
    getCustomColors: () => ({ ...customColors }),
    setCustomColor,
    resetCustomColors,
    resetHeatmapLevels,
    getHeatPreset: () => heatPreset,
    setHeatPreset,
    getHeatPalette: () => getEffectiveHeatmapScale(),
    getActivePickerSlot: () => activePickerSlot,
    openColorPicker,
    closeColorPicker,
    applyTokenHistoryPayload,
    applyPickerHex,
    setTokenHistoryForTest: payload => applyTokenHistoryPayload(payload),
    getPlanDetailExpanded: () => planDetailExpanded,
    setPlanDetailExpanded,
    switchTokenView,
    switchHeatView: view => switchHeatView(view),
    getActiveHeatView: () => activeHeatView,
    renderHeatmapMonthly: () => renderHeatmapMonthly(),
    renderHeatmapYearly: () => renderHeatmapYearly(),
    checkUpdate: manual => checkAppUpdate(manual),
    applyUpdate: () => applyAppUpdate(),
    getLatestRelease: () => cachedLatestRelease,
    openGithubRepo: path => openGithubRepo(path),
    updateHeatTabThumb: () => updateHeatTabThumb(),
    getPlanSettings: () => ({
      tierKey: ANTIGRAVITY_TOKEN_DATA.planStatus?.tierKey || null,
      tierName: ANTIGRAVITY_TOKEN_DATA.planStatus?.tierName || '未知',
      planTierOverride: ANTIGRAVITY_TOKEN_DATA.planStatus?.planTierOverride || null,
      ultraSubTier: ANTIGRAVITY_TOKEN_DATA.planStatus?.ultraSubTier || null,
      country: ANTIGRAVITY_TOKEN_DATA.planStatus?.country || '未知',
      subscriptionRegion: ANTIGRAVITY_TOKEN_DATA.planStatus?.subscriptionRegion || ANTIGRAVITY_TOKEN_DATA.planStatus?.region || '未知',
      region: ANTIGRAVITY_TOKEN_DATA.planStatus?.region || '未知',
      currency: ANTIGRAVITY_TOKEN_DATA.planStatus?.currency || 'USD',
      currencySymbol: ANTIGRAVITY_TOKEN_DATA.planStatus?.currencySymbol || '$',
      actualPricePaid: ANTIGRAVITY_TOKEN_DATA.planStatus?.actualPricePaid ?? null,
      lastSaveResult
    }),
    setCountry: val => applyDirectCountrySelection(val),
    setCurrency: val => applyDirectCurrencySelection(val),
    setUltraSubTier: val => applyDirectSubTierSelection(val),
    setPlanTierOverride: val => applyDirectTierSelection(val),
    isMarketplaceActiveForTest: () => isHostMarketplaceActive(),
    restoreSettingsFromHost,
    openSettings: tab => openSuiteSettings(tab),
    getTerminalSettings: () => getSuiteTerminalSettings(),
    setTerminalSettings: (app, customPath, muxHost) => setSuiteTerminalSettings(app, customPath, muxHost),
    getCliSettings: () => getSuiteCliSettings(),
    setCliSettings: opts => setSuiteCliSettings(opts),
    getSupportedLocales: () => getSupportedLocales(),
    registerLocale: def => registerSuiteLocale(def),
    getLocale: () => getSuiteLocale(),
    setLocale: (code, opts) => setSuiteLocale(code, opts),
    getFeatureFlags: () => getSuiteFeatureFlags(),
    setFeatureFlags: (flags, opts) => setSuiteFeatureFlags(flags, opts),
    getQuickPrompts: () => getSuiteQuickPrompts(),
    setQuickPrompts: (list, opts) => setSuiteQuickPrompts(list, opts),
    resetQuickPrompts: () => resetSuiteQuickPrompts(),
    getQuickPool: () => getSuiteQuickPool(),
    setQuickPool: (partial, opts) => setSuiteQuickPool(partial, opts),
    toggleQuickPoolItem: (id, opts) => toggleSuiteQuickPoolItem(id, opts),
    getQuickBuiltinAutoSend: () => getSuiteQuickBuiltinAutoSend(),
    setQuickBuiltinAutoSend: (val, opts) => setSuiteQuickBuiltinAutoSend(val, opts),
    getRemoteDisplayConfig: () => getRemoteDisplayConfig(),
    setRemoteDisplayConfig: cfg => setRemoteDisplayConfig(cfg),
    setHostElevated: flag => syncHostStackingElevation(Boolean(flag)),
    launchCli: opts => triggerLaunchCli(opts),
    getLastCliLaunchResult: () => lastCliLaunchResult,
    getTimelineWindow: () => {
      const w = computeTimelineWindow();
      return {
        firstUseDate: w.firstStr,
        winStart: formatLocalYmd(w.winStart),
        winEnd: formatLocalYmd(w.winEnd),
        totalDays: w.totalDays,
        canPrev: w.canPrev,
        canNext: w.canNext
      };
    },
    repositionPanelsForTest: () => positionFloatingPanels(),
    getLayoutMode: () => state.layoutMode,
    setAvailableWidthForTest: width => {
      const next = computeNextLayoutMode(width, state.layoutMode);
      applyLayoutMode(next);
      return state.layoutMode;
    },
    findTopRightClusterForTest: () => findTopRightCluster(),
    syncWindowControlsOverlayForTest: () => syncWindowControlsOverlay(),
    computeWindowControlsWidthForTest: el => computeWindowControlsWidth(el),
    invalidateAfterCompact: (cascadeId, compactInfo) => {
      if (state.disposed || !compactInfo || typeof compactInfo !== 'object') return false;
      const liveId = route();
      if (liveId && liveId !== state.route) tick();
      if (!state.route) return false;
      const norm = v => String(v || '').trim().split('/').pop() || '';
      if (cascadeId && norm(cascadeId) !== norm(state.route)) return false;
      const compactCpIdx = typeof compactInfo.lastCheckpointStepIdx === 'number' ? compactInfo.lastCheckpointStepIdx : (state.latest?.lastCheckpointStepIdx ?? -1);
      const curExactStep = typeof state.latest?.exactUsageStepIndex === 'number' ? state.latest.exactUsageStepIndex : (typeof state.latest?.metaMaxStepIndex === 'number' ? state.latest.metaMaxStepIndex : -1);
      if (compactCpIdx >= 0 && curExactStep > compactCpIdx) return false;
      const compactedUsed = Math.max(0, Math.round(Number(compactInfo.contextUsed ?? compactInfo.usedTokens ?? compactInfo.actual ?? 0) || 0));
      if (!compactedUsed) return false;
      const curActual = Number(state.latest?.actual ?? state.latest?.used ?? 0) || 0;
      const regrown = Number(compactInfo.compressionAfter || 0) > 0 && compactedUsed > Number(compactInfo.compressionAfter) + 50000;
      if (regrown) return false;
      if (curActual > 0 && !state.latest?.compressionDetected && curActual <= compactedUsed + 5000) return false;
      const effBudget = Math.round(Number(compactInfo.contextLimit ?? compactInfo.limitTokens ?? state.latest?.budget ?? 512000) || 512000);
      const inTok = Math.max(0, Math.round(Number(compactInfo.inputTokens ?? 0) || 0));
      const cRead = Math.max(0, Math.round(Number(compactInfo.cacheReadTokens ?? 0) || 0));
      const outTok = Math.max(0, Math.round(Number(compactInfo.outputTokens ?? 0) || 0));
      const totalIn = (inTok + cRead) || compactedUsed;
      const postTps = Number(compactInfo.tokPerSec || 0) > 0 ? Number(Number(compactInfo.tokPerSec).toFixed(1)) : 0;
      const nextLatest = {
        ...(state.latest || {}),
        used: compactedUsed, actual: compactedUsed, estimate: compactedUsed, budget: effBudget,
        runtimeBudget: Number(compactInfo.runtimeBudget || state.latest?.runtimeBudget || 0) || null,
        physicalMaxTokens: Number(compactInfo.physicalMaxTokens || state.latest?.physicalMaxTokens || 0) || null,
        estimated: false, exceeded: false, network: false, error: '',
        input: totalIn, cached: cRead, uncachedInput: inTok,
        cacheHitRate: typeof compactInfo.cacheHitRate === 'number' ? Number(compactInfo.cacheHitRate.toFixed(1)) : (totalIn > 0 ? Number(((cRead / totalIn) * 100).toFixed(1)) : 100),
        output: outTok,
        speed: postTps > 0 ? {
          tps: postTps, streamingTps: postTps, duration: Number(compactInfo.lastDurationSec || 0) || null,
          ttft: Number(compactInfo.ttftSec || 0) || null, streamingSec: null, outputTokens: outTok, thinkingTokens: 0, responseTokens: outTok
        } : null,
        speedStepIndex: postTps > 0 ? Math.max(0, Number(compactInfo.stepCount || 1) - 1) : -1,
        metaMaxStepIndex: -1, exactUsageStepIndex: compactCpIdx,
        percent: effBudget > 0 ? (compactedUsed / effBudget) * 100 : null,
        model: compactInfo.modelDisplayName || state.latest?.model || '', modelId: compactInfo.modelId || state.latest?.modelId || null,
        status: 'reported', compressionDetected: true,
        compressionBefore: Number(compactInfo.compressionBefore || curActual || 0) || 0,
        compressionAfter: Number(compactInfo.compressionAfter || compactedUsed) || compactedUsed,
        cacheDropDetected: false, cacheCliffRisk: compactedUsed >= 328000 ? 'critical' : (compactedUsed >= 240000 ? 'warn' : 'none'),
        postCompactAtGeneratorCount: state.count, lastCheckpointStepIdx: compactCpIdx,
        stepCount: Number(compactInfo.stepCount || state.latest?.stepCount || 0) || 0,
        updatedAtMs: Number(compactInfo.updatedAtMs || Date.now())
      };
      state.postCompactFloor = { route: state.route, generatorCount: state.count, lastCheckpointStepIdx: nextLatest.lastCheckpointStepIdx, latest: nextLatest };
      state.latest = nextLatest;
      state.requestAt = Date.now();
      render();
      return true;
    },
    refresh: () => {
      if (state.disposed) return false;
      const liveId = route();
      if (liveId && liveId !== state.route) tick();
      if (!state.route) return false;
      state.requestNext = 0;
      state.scanNext = 0;
      return Promise.allSettled([scan(state.generation, state.route, true), requestPoll(state.generation, state.route)]);
    },
    snapshot: () => ({ route: state.route, count: state.count, latest: state.latest, scan: state.scan, requestError: state.requestError, scanError: state.scanError, scanBusy: state.scanBusy, layoutMode: state.layoutMode, sessionCalls: state.sessionCalls, sessionCostTotal: state.sessionCostTotal }),
    dispose() {
      state.disposed = true;
      for (const controller of state.controllers) controller.abort();
      clearInterval(timer);
      if (layoutRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(layoutRaf);
      syncHostStackingElevation(false);
      try { themeObserver?.disconnect(); } catch {}
      try { resizeObserver?.disconnect(); } catch {}
      if (domMutationThrottleTimer) { clearTimeout(domMutationThrottleTimer); domMutationThrottleTimer = null; }
      try { hostDomObserver?.disconnect(); } catch {}
      try {
        window.removeEventListener?.('resize', onWindowResize);
        window.removeEventListener?.('focus', onWindowFocus);
        window.removeEventListener?.('blur', onWindowBlur);
        window.removeEventListener?.('mousemove', onPointerMove);
        window.removeEventListener?.('mouseup', onPointerUp);
        navigator?.windowControlsOverlay?.removeEventListener?.('geometrychange', onWindowResize);
      } catch {}
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
      try { document.getElementById('ag-wco-spacer')?.remove?.(); } catch {}
      try { document.getElementById('ag-topbar-host-fix')?.remove?.(); } catch {}
      host.remove();
    }
  };
  el('plan-summary-price-badge')?.addEventListener?.('keydown', e => {
    if (e && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault?.();
      el('plan-summary-price-badge')?.click?.();
    }
  });

  void restoreSettingsFromHost();
  render();
  tick();
})();

