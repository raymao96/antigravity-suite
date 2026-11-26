const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../meter-core');
const collector = require('../meter-collector');

const ROOT = path.resolve(__dirname, '..');
const CODEX_OVERLAY_SRC = fs.readFileSync(path.join(ROOT, 'ag-codex-overlay.js'), 'utf8');
const HANS_OVERLAY_SRC = fs.readFileSync(path.join(ROOT, 'antigravity-hans-overlay.js'), 'utf8');
const RENDERER_SRC = fs.readFileSync(path.join(ROOT, 'meter-renderer.js'), 'utf8');
const LIVE_HOST_SRC = fs.readFileSync(path.join(ROOT, 'live-host.js'), 'utf8');

function matchesSimple(el, sel) {
  if (!el || !el.tagName || el.nodeType !== 1) return false;
  const trimmed = String(sel || '').trim();
  if (!trimmed) return false;
  if (trimmed.includes(',')) return trimmed.split(',').some(p => matchesSimple(el, p));
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    if (!matchesSimple(el, parts[parts.length - 1])) return false;
    let anc = el.parentElement;
    let i = parts.length - 2;
    while (anc && i >= 0) {
      if (matchesSimple(anc, parts[i])) i--;
      anc = anc.parentElement;
    }
    return i < 0;
  }
  if (trimmed === '*') return true;
  if (trimmed.startsWith('#')) return el.id === trimmed.slice(1).split(/[\s.\[:]/)[0];
  if (trimmed.startsWith('.')) return el.classList.contains(trimmed.slice(1).split(/[\s.\[:]/)[0]);
  const am = trimmed.match(/^([a-zA-Z0-9_-]+)?\[([^\]]+)\]$/);
  if (am) {
    if (am[1] && el.tagName.toLowerCase() !== am[1].toLowerCase()) return false;
    const inner = am[2];
    const eq = inner.indexOf('=');
    if (eq < 0) return el.getAttribute(inner.trim()) !== null;
    const op = inner[eq - 1] === '^' ? '^=' : inner[eq - 1] === '*' ? '*=' : '=';
    const k = (op === '=' ? inner.slice(0, eq) : inner.slice(0, eq - 1)).trim();
    const expected = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    const actual = el.getAttribute(k);
    if (actual === null) return false;
    if (op === '^=') return String(actual).startsWith(expected);
    if (op === '*=') return String(actual).includes(expected);
    return actual === expected;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

function createFusionDomEnv(options = {}) {
  const storageMap = new Map(Object.entries(options.initialStorage || {}));
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = new Set();
  const fetchCalls = [];
  const shadowElements = new Map();

  function makeEl(tagName = 'div') {
    const attrs = new Map();
    const props = new Map();
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      children: [],
      childNodes: [],
      parentElement: null,
      isConnected: false,
      hidden: false,
      disabled: false,
      checked: false,
      value: '',
      scrollTop: 0,
      textContent: '',
      innerText: '',
      _innerHTML: '',
      style: {
        display: '',
        opacity: '',
        colorScheme: '',
        left: '',
        top: '',
        setProperty(k, v) { props.set(String(k), String(v)); },
        removeProperty(k) { props.delete(String(k)); },
        getPropertyValue(k) { return props.get(String(k)) || ''; }
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v || '')); },
      get className() { return attrs.get('class') || ''; },
      set className(v) { attrs.set('class', String(v || '')); },
      classList: {
        add(...cs) {
          const cur = (attrs.get('class') || '').split(/\s+/).filter(Boolean);
          for (const c of cs) if (c && !cur.includes(c)) cur.push(c);
          attrs.set('class', cur.join(' '));
        },
        remove(...cs) {
          const cur = (attrs.get('class') || '').split(/\s+/).filter(Boolean);
          attrs.set('class', cur.filter(c => !cs.includes(c)).join(' '));
        },
        contains(c) { return (attrs.get('class') || '').split(/\s+/).includes(c); }
      },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val || '');
        this.children = [];
        this.childNodes = [];
      },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        const idx = siblings.indexOf(this);
        return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null;
      },
      get firstElementChild() { return this.children[0] || null; },
      get lastElementChild() { return this.children[this.children.length - 1] || null; },
      setAttribute(k, v) { attrs.set(String(k), String(v)); },
      getAttribute(k) { return attrs.has(String(k)) ? attrs.get(String(k)) : null; },
      hasAttribute(k) { return attrs.has(String(k)); },
      removeAttribute(k) { attrs.delete(String(k)); },
      appendChild(child) {
        if (!child) return child;
        if (child.parentElement && child.parentElement !== this) {
          const prev = child.parentElement.children;
          const idx = prev.indexOf(child);
          if (idx >= 0) prev.splice(idx, 1);
        }
        if (!this.children.includes(child)) {
          this.children.push(child);
          this.childNodes.push(child);
        }
        child.parentElement = this;
        const markConn = (n, val) => {
          n.isConnected = val;
          for (const c of n.children || []) markConn(c, val);
        };
        markConn(child, this.isConnected);
        return child;
      },
      insertBefore(newNode, refNode) {
        if (!refNode) return this.appendChild(newNode);
        if (newNode.parentElement) {
          const prev = newNode.parentElement.children;
          const oldIdx = prev.indexOf(newNode);
          if (oldIdx >= 0) prev.splice(oldIdx, 1);
        }
        const idx = this.children.indexOf(refNode);
        if (idx >= 0) {
          this.children.splice(idx, 0, newNode);
          this.childNodes.splice(idx, 0, newNode);
        } else {
          this.children.push(newNode);
          this.childNodes.push(newNode);
        }
        newNode.parentElement = this;
        const markConn = (n, val) => {
          n.isConnected = val;
          for (const c of n.children || []) markConn(c, val);
        };
        markConn(newNode, this.isConnected);
        return newNode;
      },
      remove() {
        if (this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx >= 0) this.parentElement.children.splice(idx, 1);
          const idx2 = this.parentElement.childNodes.indexOf(this);
          if (idx2 >= 0) this.parentElement.childNodes.splice(idx2, 1);
          this.parentElement = null;
        }
        const markConn = (n) => {
          n.isConnected = false;
          for (const c of n.children || []) markConn(c);
        };
        markConn(this);
      },
      replaceChildren() { this.children = []; this.childNodes = []; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      dispatchEvent(ev) {
        const list = listeners.get(ev?.type) || [];
        for (const fn of [...list]) fn(ev);
        return true;
      },
      click() {
        this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
      },
      focus() {},
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesSimple(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            if (matchesSimple(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      getBoundingClientRect() { return { left: 20, top: 20, right: 220, bottom: 60, width: 200, height: 40 }; }
    };
    return el;
  }

  const htmlEl = makeEl('html');
  htmlEl.isConnected = true;
  htmlEl.lang = 'zh-TW';
  const headEl = makeEl('head');
  const bodyEl = makeEl('body');
  htmlEl.appendChild(headEl);
  htmlEl.appendChild(bodyEl);

  const shadowRoot = {
    getElementById(id) {
      if (!shadowElements.has(id)) {
        const el = makeEl('div');
        el.id = id;
        shadowElements.set(id, el);
      }
      return shadowElements.get(id);
    },
    querySelector(sel) {
      if (sel.startsWith('#')) return this.getElementById(sel.slice(1).split(/\s/)[0]);
      return null;
    },
    querySelectorAll() { return []; },
    set innerHTML(v) { this._html = v; }
  };

  const doc = {
    documentElement: htmlEl,
    head: headEl,
    body: bodyEl,
    hidden: false,
    fonts: [{ family: 'Inter', status: 'loaded' }, { family: 'JetBrains Mono', status: 'loaded' }],
    createElement(tag) {
      const el = makeEl(tag);
      if (String(tag).toLowerCase() === 'div') {
        el.attachShadow = () => shadowRoot;
      }
      return el;
    },
    getElementById(id) {
      const find = (n) => {
        if (!n) return null;
        if (n.id === id) return n;
        for (const c of n.children || []) {
          const r = find(c);
          if (r) return r;
        }
        return null;
      };
      return find(htmlEl);
    },
    querySelector(sel) { return htmlEl.querySelector(sel); },
    querySelectorAll(sel) { return htmlEl.querySelectorAll(sel); },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    dispatchEvent(ev) {
      for (const fn of [...(docListeners.get(ev?.type) || [])]) fn(ev);
    }
  };

  const localStorageObj = {
    getItem(k) { return storageMap.has(String(k)) ? storageMap.get(String(k)) : null; },
    setItem(k, v) { storageMap.set(String(k), String(v)); },
    removeItem(k) { storageMap.delete(String(k)); }
  };

  const CustomEventCtor = function CustomEvent(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  };

  const win = {
    document: doc,
    localStorage: localStorageObj,
    location: { protocol: 'https:', hostname: '127.0.0.1', pathname: '/workbench.html', search: '', href: 'https://127.0.0.1/workbench.html' },
    navigator: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' },
    history: { state: {}, replaceState(_s, _t, u) { win.location.href = u; win.location.search = new URL(u).search; } },
    electronNative: {
      zoomInCount: 0,
      zoomOutCount: 0,
      resetZoomCount: 0,
      zoomIn() { this.zoomInCount++; },
      zoomOut() { this.zoomOutCount++; },
      resetZoom() { this.resetZoomCount++; },
      setTitleBarOverlay() {}
    },
    CustomEvent: CustomEventCtor,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { winListeners.get(type)?.delete(fn); },
    dispatchEvent(ev) {
      for (const fn of [...(winListeners.get(ev?.type) || [])]) fn(ev);
      return true;
    }
  };
  win.window = win;
  win.top = win;

  const sandbox = {
    window: win,
    document: doc,
    localStorage: localStorageObj,
    location: win.location,
    navigator: win.navigator,
    history: win.history,
    CustomEvent: CustomEventCtor,
    MutationObserver: function MutationObserver() {
      return { observe() {}, disconnect() {}, takeRecords() { return []; } };
    },
    KeyboardEvent: function KeyboardEvent(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    },
    AbortController,
    URL,
    Date,
    __AGContextMeterCore: core,
    setTimeout(fn, ms) {
      const t = setTimeout(() => { timers.delete(t); fn(); }, Math.min(Number(ms) || 0, 20));
      timers.add(t);
      return t;
    },
    clearTimeout(t) { timers.delete(t); clearTimeout(t); },
    setInterval() { return 1; },
    clearInterval() {},
    getComputedStyle() { return { getPropertyValue() { return ''; } }; },
    fetch(url, opts) {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, fonts: { sans: ['Inter', 'PingFang TC'], mono: ['JetBrains Mono'] } }) });
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  win.fetch = sandbox.fetch;
  win.__AGContextMeterLive = { port: 41234, token: 'tok-test' };

  vm.createContext(sandbox);
  return {
    sandbox,
    win,
    doc,
    headEl,
    bodyEl,
    shadowRoot,
    shadowElements,
    localStorage: localStorageObj,
    storageMap,
    docListeners,
    winListeners,
    fetchCalls,
    cleanupTimers() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    }
  };
}

test('1. ag-codex-overlay pure quota helpers & pool filtering (all / gemini-only / claude-only)', () => {
  assert.equal(
    CODEX_OVERLAY_SRC.match(/globalThis\.__AGCodexOverlay\s*=\s*\{[\s\S]*?version\s*:\s*['"]([^'"]+)['"]/)?.[1],
    '1.0.1'
  );
  const env = createFusionDomEnv();
  try {
    vm.runInContext(CODEX_OVERLAY_SRC, env.sandbox);
    const h = env.sandbox.__AGCodexOverlay.helpers;

    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);
    const rawResp = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            description: 'Models within this group: Gemini 4 Hydrogen, Gemini 4 Carbon.',
            buckets: [
              { window: '5h', remaining: { case: 'remainingFraction', value: 0.91 }, resetTime: { seconds: Math.floor((nowMs + (4 * 60 + 39) * 60000) / 1000), nanos: 0 } },
              { window: 'weekly', remaining: { case: 'remainingFraction', value: 0.97 }, resetTime: { seconds: Math.floor((nowMs + 2 * 86400000) / 1000), nanos: 0 } }
            ]
          },
          {
            displayName: 'Claude and GPT Models',
            description: 'Models within this group: Claude Opus 5.5, GPT-OSS 120B.',
            buckets: [
              { window: '5h', remaining: { case: 'remainingFraction', value: 0.65 }, resetTime: { seconds: Math.floor((nowMs + 120 * 60000) / 1000), nanos: 0 } },
              { window: 'weekly', remaining: { case: 'remainingFraction', value: 0.80 }, resetTime: { seconds: Math.floor((nowMs + 4 * 86400000) / 1000), nanos: 0 } }
            ]
          }
        ]
      }
    };

    const groups = h.parseQuotaSummary(rawResp);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].shortLabel, 'Gemini');
    assert.equal(groups[0].fiveHour.pct, 91);
    assert.equal(groups[0].weekly.pct, 97);
    assert.equal(groups[1].shortLabel, 'Claude·GPT');

    assert.equal(h.formatQuotaModelShort('Gemini 4 Hydrogen (Medium)'), '4 Hydrogen');
    assert.deepEqual(Array.from(h.computeQuotaSegments(50)), [100, 100, 50, 0, 0]);
    assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Gemini 4 Hydrogen (Medium)'), 0);
    assert.equal(h.matchActiveQuotaGroupIndex(groups, 'Claude Opus 5.5 (High)'), 1);

    assert.equal(h.formatQuotaCountdownLabel(groups[0].fiveHour, 'zh-TW', nowMs, false), '4:39 後重設');
    assert.equal(h.formatQuotaCountdownLabel(groups[0].fiveHour, 'zh-CN', nowMs, false), '4:39 后重置');
    assert.equal(h.formatQuotaCountdownLabel(groups[0].fiveHour, 'en', nowMs, false), 'resets 4:39');
    assert.equal(h.formatQuotaCountdownLabel({ remainingFraction: 1, resetMs: null }, 'zh-TW', nowMs, false), '額度全滿');

    // Pin Gemini-only while using Gemini -> shows Gemini + Active badge
    const pinGeminiActive = h.filterQuotaGroupsForDisplay(groups, 'Gemini 4 Hydrogen (Medium)', 'gemini-only');
    assert.equal(pinGeminiActive.displayGroups.length, 1);
    assert.equal(pinGeminiActive.displayGroups[0].shortLabel, 'Gemini');
    assert.equal(pinGeminiActive.isPinned, true);
    assert.equal(pinGeminiActive.isPinnedActive, true);

    // Pin Gemini-only while using Claude -> still shows Gemini, but isPinnedActive=false
    const pinGeminiInactive = h.filterQuotaGroupsForDisplay(groups, 'Claude Opus 5.5 (High)', 'gemini-only');
    assert.equal(pinGeminiInactive.displayGroups.length, 1);
    assert.equal(pinGeminiInactive.displayGroups[0].shortLabel, 'Gemini');
    assert.equal(pinGeminiInactive.isPinned, true);
    assert.equal(pinGeminiInactive.isPinnedActive, false);

    // Pin Claude-only
    const pinClaude = h.filterQuotaGroupsForDisplay(groups, 'Claude Opus 5.5 (High)', 'claude-only');
    assert.equal(pinClaude.displayGroups.length, 1);
    assert.equal(pinClaude.displayGroups[0].shortLabel, 'Claude·GPT');
    assert.equal(pinClaude.isPinnedActive, true);

    assert.equal(h.hasExpiredQuotaBucket(groups, nowMs), false);
    assert.equal(h.hasExpiredQuotaBucket(groups, nowMs + 10 * 86400000), true);
  } finally {
    env.sandbox.__AGCodexOverlay?.dispose?.();
    env.cleanupTimers();
  }
});

test('2. ag-codex-overlay DOM mount, cloudCodeService tap/untap, native settings, theme/fonts & dispose cleanup', async () => {
  const env = createFusionDomEnv();
  try {
    const nowMs = Date.now();
    const rawQuota = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            description: 'Models within this group: Gemini 4 Hydrogen.',
            buckets: [
              { window: '5h', remaining: { case: 'remainingFraction', value: 0.91 }, resetTime: { seconds: Math.floor((nowMs + 4 * 3600000 + 39 * 60000) / 1000) } },
              { window: 'weekly', remaining: { case: 'remainingFraction', value: 0.97 }, resetTime: { seconds: Math.floor((nowMs + 2 * 86400000) / 1000) } }
            ]
          },
          {
            displayName: 'Claude and GPT Models',
            description: 'Models within this group: Claude Opus 5.5.',
            buckets: [
              { window: '5h', remaining: { case: 'remainingFraction', value: 0.72 }, resetTime: { seconds: Math.floor((nowMs + 2 * 3600000) / 1000) } }
            ]
          }
        ]
      }
    };

    const origRetrieve = async () => rawQuota;
    const svc = { retrieveUserQuotaSummary: origRetrieve };
    const sidebarWrap = env.doc.createElement('div');
    const settingsBtn = env.doc.createElement('button');
    settingsBtn.setAttribute('data-testid', 'settings-button');
    settingsBtn.__reactFiber$test = {
      return: {
        memoizedProps: { value: { core: { cloudCodeService: svc } } },
        return: null
      }
    };
    sidebarWrap.appendChild(settingsBtn);
    env.bodyEl.appendChild(sidebarWrap);

    const modelTrigger = env.doc.createElement('button');
    modelTrigger.setAttribute('data-testid', 'model-selector-trigger');
    modelTrigger.setAttribute('aria-label', 'Select model, current: Gemini 4 Hydrogen (Medium)');
    env.bodyEl.appendChild(modelTrigger);

    // Mount native Settings dialog structure
    const dlg = env.doc.createElement('div');
    dlg.setAttribute('role', 'dialog');
    const splitRow = env.doc.createElement('div');
    splitRow.className = 'relative flex w-full h-full';
    const settingsSidebar = env.doc.createElement('div');
    settingsSidebar.setAttribute('data-testid', 'settings-sidebar');
    const listRoot = env.doc.createElement('div');
    const navGroup = env.doc.createElement('div');
    const nativeNavBtn = env.doc.createElement('button');
    nativeNavBtn.setAttribute('data-testid', 'settings-nav-item-General');
    navGroup.appendChild(nativeNavBtn);
    listRoot.appendChild(env.doc.createElement('div'));
    listRoot.appendChild(navGroup);
    settingsSidebar.appendChild(listRoot);
    const rightPane = env.doc.createElement('div');
    splitRow.appendChild(settingsSidebar);
    splitRow.appendChild(rightPane);
    dlg.appendChild(splitRow);
    env.bodyEl.appendChild(dlg);

    vm.runInContext(CODEX_OVERLAY_SRC, env.sandbox);
    const api = env.sandbox.__AGCodexOverlay;
    assert.ok(api && api.isAlive(), 'ag-codex-overlay should mount and report alive');

    await api.refreshQuota(true);
    const quotaEl = env.doc.getElementById('ag-quota');
    assert.ok(quotaEl, '#ag-quota should be mounted above settings-button');
    assert.equal(quotaEl.getAttribute('data-ag-enhancer'), 'codex');
    assert.equal(quotaEl.nextElementSibling, settingsBtn);
    assert.equal(quotaEl.getAttribute('data-style'), 'bar');
    assert.equal(quotaEl.getAttribute('data-ostyle'), 'hidden');
    assert.ok(quotaEl.innerHTML.includes('Gemini'));
    assert.ok(quotaEl.innerHTML.includes('目前'));
    assert.ok(quotaEl.innerHTML.includes('4 Hydrogen'));
    assert.ok(quotaEl.innerHTML.includes('ag-quota-cbar-main'));
    assert.ok(!quotaEl.innerHTML.includes('Claude·GPT'), 'hidden otherStyle should hide Claude·GPT');

    // Passive tap should wrap cloudCodeService.retrieveUserQuotaSummary
    assert.notEqual(svc.retrieveUserQuotaSummary, origRetrieve, 'cloudCodeService should be tapped');

    // Native settings tab mounted
    const navBtn = env.doc.getElementById('ag-settings-nav-btn');
    const pane = env.doc.getElementById('ag-settings-pane');
    assert.ok(navBtn && pane, 'Native settings nav button and pane should mount');
    assert.equal(env.doc.getElementById('ag-settings-nav-wrap').getAttribute('data-ag-enhancer'), 'codex');

    // Toggle Codex theme & fonts
    api.updateConfig({ codexTheme: true, fonts: { mode: 'split', ui: 'Inter', chat: 'PingFang TC', code: 'JetBrains Mono' } });
    assert.ok(env.doc.getElementById('ag-codex-theme-style'), 'Codex theme style should be injected when enabled');
    assert.equal(env.doc.documentElement.getAttribute('data-ag-preset'), 'codex-pure-white');
    const fontStyle = env.doc.getElementById('ag-user-fonts');
    assert.ok(fontStyle && fontStyle.textContent.includes('JetBrains Mono'), 'Split custom font CSS should include JetBrains Mono');

    // Zoom shortcut guard
    let prevented = false;
    env.win.dispatchEvent({
      type: 'keydown',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      key: '=',
      code: 'Equal',
      preventDefault() { prevented = true; },
      stopPropagation() {}
    });
    assert.equal(prevented, true);
    assert.equal(env.win.electronNative.zoomInCount, 1);

    // Dispose cleans up everything cleanly including cloudCodeService untap
    api.dispose();
    assert.equal(api.isAlive(), false);
    assert.equal(svc.retrieveUserQuotaSummary, origRetrieve, 'dispose() must restore original retrieveUserQuotaSummary');
    assert.equal(env.doc.getElementById('ag-quota'), null);
    assert.equal(env.doc.getElementById('ag-codex-theme-style'), null);
    assert.equal(env.doc.getElementById('ag-user-fonts'), null);
    assert.equal(env.doc.getElementById('ag-settings-pane'), null);
  } finally {
    env.sandbox.__AGCodexOverlay?.dispose?.();
    env.cleanupTimers();
  }
});

test('3. Backend scanUserInstalledFonts, codexUi sanitization/persistence, and live-host /list-fonts route', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-codex-fusion-'));
  try {
    const clean = collector.sanitizeCodexUiConfig({
      quotaSidebar: false,
      quotaStyle: 'RINGS',
      quotaOtherStyle: 'invalid-val',
      quotaPoolFilter: 'gemini-only',
      codexTheme: true,
      fonts: { mode: 'split', ui: 'Inter";body{', chat: 'Noto Sans TC', code: 'Fira Code' }
    });
    assert.deepEqual(clean, {
      quotaSidebar: false,
      quotaStyle: 'rings',
      quotaOtherStyle: 'hidden',
      quotaPoolFilter: 'gemini-only',
      codexTheme: true,
      deadlockHealer: true,
      zoomShortcuts: true,
      fonts: { mode: 'split', global: '', ui: 'Interbody', chat: 'Noto Sans TC', code: 'Fira Code' }
    });

    const saved = collector.savePluginSettings({
      uiPreferences: { codexUi: { quotaStyle: 'segments', codexTheme: true, fonts: { ui: 'Inter' } } }
    }, { targetDir: tmpDir });
    assert.equal(saved.ok, true);
    assert.equal(saved.uiPreferences.codexUi.quotaStyle, 'segments');
    assert.equal(saved.uiPreferences.codexUi.codexTheme, true);
    assert.equal(saved.uiPreferences.codexUi.fonts.ui, 'Inter');

    const merged = collector.savePluginSettings({
      uiPreferences: { codexUi: { quotaPoolFilter: 'gemini-only', fonts: { code: 'JetBrains Mono' } } }
    }, { targetDir: tmpDir });
    assert.equal(merged.uiPreferences.codexUi.quotaStyle, 'segments');
    assert.equal(merged.uiPreferences.codexUi.fonts.ui, 'Inter');
    assert.equal(merged.uiPreferences.codexUi.fonts.code, 'JetBrains Mono');

    const cleared = collector.savePluginSettings({ uiPreferences: { codexUi: null } }, { targetDir: tmpDir });
    assert.equal(cleared.uiPreferences.codexUi, undefined);

    const emptyScan = collector.scanUserInstalledFonts({ dirs: [tmpDir], force: true });
    assert.deepEqual(emptyScan, { sans: [], mono: [] });
    assert.ok(LIVE_HOST_SRC.includes("'/list-fonts'"), 'live-host.js should expose /list-fonts route');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. Electron native context menu Array.prototype.map localization & restoration in antigravity-hans-overlay.js', () => {
  const env = createFusionDomEnv();
  env.sandbox.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 };
  env.sandbox.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
  env.doc.createTreeWalker = () => ({ nextNode: () => null });
  env.localStorage.setItem('antigravityHansLang', 'zh-TW');
  try {
    vm.runInContext(HANS_OVERLAY_SRC, env.sandbox);
    const menuItems = [
      { id: 'pin', label: 'Pin', accelerator: '', click() {}, enabled: true },
      { id: 'copy-path', label: 'Copy Path', accelerator: 'CmdOrCtrl+C', click() {}, enabled: true },
      { id: 'project-myproj', label: 'My Workspace', accelerator: '', click() {}, enabled: true }
    ];
    const mappedTw = vm.runInContext(
      `([
        { id: 'pin', label: 'Pin', accelerator: '', click() {}, enabled: true },
        { id: 'copy-path', label: 'Copy Path', accelerator: 'CmdOrCtrl+C', click() {}, enabled: true },
        { id: 'project-myproj', label: 'My Workspace', accelerator: '', click() {}, enabled: true }
      ]).map(x => x)`,
      env.sandbox
    );
    assert.equal(mappedTw[0].label, '釘選');
    assert.equal(mappedTw[1].label, '複製路徑');
    assert.equal(mappedTw[2].label, 'My Workspace', 'Dynamic project-* entry must not be translated');

    env.win.__antigravityZhSetLang('en');
    const mappedEn = vm.runInContext(
      `([{ id: 'pin', label: 'Pin', accelerator: '', click() {}, enabled: true }]).map(x => x)`,
      env.sandbox
    );
    assert.equal(mappedEn[0].label, 'Pin', 'Switching to en should restore Array.prototype.map');
    assert.ok(menuItems.length === 3);
  } finally {
    env.win.__antigravityZhPatchCleanup?.();
    env.cleanupTimers();
  }
});

test('5. Two-way sync between Suite Settings (#panel-settings) and ag-codex-overlay', () => {
  const env = createFusionDomEnv();
  try {
    vm.runInContext(CODEX_OVERLAY_SRC, env.sandbox);
    vm.runInContext(RENDERER_SRC, env.sandbox);

    const meterApi = env.sandbox.__AGContextMeter;
    const codexApi = env.sandbox.__AGCodexOverlay;
    assert.ok(meterApi && codexApi, 'Both __AGContextMeter and __AGCodexOverlay should be active');

    // Change from Suite Settings -> ag-codex-overlay updates immediately
    const selPool = env.shadowRoot.getElementById('set-codex-pool-filter');
    const selStyle = env.shadowRoot.getElementById('set-codex-quota-style');
    const chkTheme = env.shadowRoot.getElementById('set-codex-theme');
    assert.ok(selPool && selStyle && chkTheme);

    selPool.value = 'gemini-only';
    selPool.dispatchEvent({ type: 'change', target: selPool });
    assert.equal(codexApi.getConfig().quotaPoolFilter, 'gemini-only');

    selStyle.value = 'rings';
    selStyle.dispatchEvent({ type: 'change', target: selStyle });
    assert.equal(codexApi.getConfig().quotaStyle, 'rings');

    // Change from ag-codex-overlay (native settings) -> Suite Settings syncs via ag-codex-config-changed
    codexApi.updateConfig({ codexTheme: true, quotaPoolFilter: 'all', quotaStyle: 'segments' });
    assert.equal(chkTheme.checked, true);
    assert.equal(selPool.value, 'all');
    assert.equal(selStyle.value, 'segments');

    // Toggle topbar quota inside native settings -> Suite Settings showTopbarQuota flag syncs
    const meterHost = env.doc.getElementById('ag-context-meter');
    const chkFeatQuota = env.shadowRoot.getElementById('set-feat-quota');
    env.win.dispatchEvent(new env.win.CustomEvent('ag-suite-prefs-changed', {
      detail: { featureFlags: { showTopbarQuota: false } }
    }));
    assert.equal(chkFeatQuota.checked, false);
    assert.equal(meterHost.getAttribute('data-hide-quota'), 'true');

    codexApi.dispose();
    meterApi.dispose?.();
  } finally {
    env.sandbox.__AGCodexOverlay?.dispose?.();
    env.sandbox.__AGContextMeter?.dispose?.();
    env.cleanupTimers();
  }
});
