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

