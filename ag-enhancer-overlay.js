// Antigravity 界面增强挂件（窗口内配额双胶囊 + 输入框快捷胶囊栏）
// 严格免改盘设计，通过 CDP 运行时注入，可随时通过 dispose() 无痕卸载。
(function () {
  'use strict';

  try {
    if (globalThis.__AGEnhancer && typeof globalThis.__AGEnhancer.dispose === 'function') {
      globalThis.__AGEnhancer.dispose();
    }
  } catch {}

  const METER_HOST_ID = 'ag-context-meter';
  const REMOTE_BADGE_ID = 'badge-remote';
  const REMOTE_POPOVER_ID = 'ag-remote-popover';
  const QUOTA_STYLE_ID = 'ag-enhancer-quota-style';
  const QUOTA_BADGE_ID = 'badge-quota';
  const QUOTA_POPOVER_ID = 'ag-quota-popover';
  const DOC_STYLE_ID = 'ag-enhancer-doc-style';
  const QUICK_BAR_ID = 'ag-quick-capsule-bar';
  const CHAT_NAV_ID = 'ag-chat-nav-float';
  const FILE_EDITOR_CONTROLS_ID = 'ag-file-editor-controls';
  const FILE_EDITOR_WRAP_ID = 'ag-inline-file-editor-wrap';
  const NEXT_STEP_GHOST_ID = 'ag-next-step-ghost';
  const NEXT_STEP_TOOLTIP_ID = 'ag-next-step-tooltip';
  const QUICK_BAR_TOOLTIP_ID = 'ag-quickbar-tooltip';
  const QUICK_RIGHT_SLOT_ID = 'ag-qcap-right-slot';
  const PROMPT_OPT_WRAP_ID = 'ag-prompt-opt-wrap';
  const PROMPT_OPT_BTN_ID = 'ag-prompt-opt-btn';
  const PROMPT_OPT_UNDO_ID = 'ag-prompt-undo-btn';
  const CLOUDFLARE_TUNNEL_DASHBOARD_URL = 'https://one.dash.cloudflare.com/?to=/:account/networks/tunnels';
  const PROMPT_OPT_SPARKLE_SVG = '<svg class="ag-opt-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.3a2 2 0 0 0 1.2 1.2L20.4 11.4l-5.3 1.9a2 2 0 0 0-1.2 1.2L12 19.8l-1.9-5.3a2 2 0 0 0-1.2-1.2L3.6 11.4l5.3-1.9a2 2 0 0 0 1.2-1.2Z"></path><path d="M19 3v3"></path><path d="M20.5 4.5h-3"></path></svg>';
  const PROMPT_OPT_UNDO_SVG = '<svg class="ag-opt-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"></path></svg>';
  const CHECKBOX_CHECKED_SVG = '<svg class="ag-rp-icon ag-rp-ok" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5" fill="var(--ag-accent-bg, rgba(167, 139, 250, 0.14))" stroke="var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa))" stroke-width="2"></rect><polyline points="8.5 12.2 11.2 14.9 15.8 9.4" stroke="var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa))" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>';
  const CHECKBOX_UNCHECKED_SVG = '<svg class="ag-rp-icon ag-rp-off" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4.5"></rect></svg>';
  const LOCK_SHIELD_SVG = '<svg class="ag-rp-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
  const makeNavSvg = (paths) => '<svg class="ag-nav-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const CHAT_NAV_ICONS = {
    top: makeNavSvg('<path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path>'),
    prev: makeNavSvg('<path d="m18 15-6-6-6 6"></path>'),
    next: makeNavSvg('<path d="m6 9 6 6 6-6"></path>'),
    bottom: makeNavSvg('<path d="m7 6 5 5 5-5"></path><path d="m7 13 5 5 5-5"></path>'),
    think: makeNavSvg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>')
  };

  let disposed = false;
  let remotePopoverOpen = false;
  let remotePollTimer = null;
  let lastRemoteFetchAt = 0;
  const REMOTE_SELECTED_CHANNEL_STORAGE_KEY = 'ag-remote-selected-channel-v1';
  const loadSavedRemoteChannelKey = () => {
    try {
      const k = typeof localStorage !== 'undefined'
        ? String(localStorage.getItem(REMOTE_SELECTED_CHANNEL_STORAGE_KEY) || '').trim()
        : '';
      return (k === 'lan' || k === 'tailscale' || k === 'bonjour' || k === 'tunnel') ? k : '';
    } catch {
      return '';
    }
  };
  const saveSelectedRemoteChannelKey = (key) => {
    try {
      if (typeof localStorage === 'undefined') return;
      const k = String(key || '').trim();
      if (k === 'lan' || k === 'tailscale' || k === 'bonjour' || k === 'tunnel') {
        localStorage.setItem(REMOTE_SELECTED_CHANNEL_STORAGE_KEY, k);
      } else {
        localStorage.removeItem(REMOTE_SELECTED_CHANNEL_STORAGE_KEY);
      }
    } catch {}
  };
  let remotePairState = { loading: false, tunnelBusy: false, tunnelPendingAction: '', error: '', data: null, copiedAt: 0, selectedChannelKey: loadSavedRemoteChannelKey(), tunnelConfigOpen: false, tunnelPollTimer: null, draftHost: null, draftToken: '' };
  let fileEditorState = {
    active: false,
    fileUri: '',
    filePath: '',
    dirty: false,
    saving: false,
    loading: false,
    savedOnce: false,
    statusText: ''
  };
  let activeEditorWrapEl = null;
  let quotaState = {
    loading: false,
    lastFetchedAt: 0,
    error: '',
    gemini: null,
    claude: null,
    subGroups: [],
    promptCredits: null,
    flowCredits: null,
    activeModelText: '',
    activePoolKey: 'gemini'
  };
  let popoverOpen = false;
  let toastTimer = null;
  let autoAcceptEnabled = false;
  let ghostSuggestEnabled = true;
  let autoCompactEnabled = true;
  let quickBuiltinAutoSendEnabled = false;
  let quickAutoSendInFlight = false;
  let quickAutoSendLockUntil = 0;
  let quickAutoSendLockTimer = null;
  let uiLang = 'zh-TW';
  let dockBadgeEnabled = true;
  let dockBadgeAutoClear = true;
  const DEFAULT_FEATURE_FLAGS = {
    showTopbarTokens: true,
    showTopbarCli: true,
    showTopbarQuota: true,
    showTopbarRemote: true,
    showQuickBar: true,
    showChatNav: true
  };
  let featureFlags = { ...DEFAULT_FEATURE_FLAGS };

  const BUILTIN_QUICK_POOL = [
    {
      id: 'compact',
      group: 'daily',
      label: '/compact 压缩',
      labelEn: '/compact',
      slash: 'compact',
      text: '/compact',
      supportsAutoSend: true,
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
      slash: 'plan',
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
      slash: 'grill-me',
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
      slash: 'btw',
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
      slash: 'learn',
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
      slash: 'goal',
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
      slash: 'boost',
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
      slash: 'swarm',
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
      slash: 'teamwork',
      text: '/teamwork ',
      rec: '',
      recEn: '',
      tag: '军团流水',
      tagEn: 'Pipeline',
      role: '拉起探查→拆解→求解→批判审校→修补 5 阶段专业 Agent 团队接管项目。',
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
      slash: 'browser',
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
      slash: 'schedule',
      text: '/schedule ',
      rec: '',
      recEn: '',
      tag: '定时巡检',
      tagEn: 'Schedule',
      role: '创建后台定时巡检或一次性倒计时提醒任务，到点自动唤醒。',
      roleEn: 'Schedule a recurring background check or a one-time timer reminder.',
      scene: '每 N 分钟巡检构建/服务状态，或约定稍后自动触发某项检查。',
      sceneEn: 'Periodic monitoring, polling builds, or setting a delayed reminder.',
      title: '创建定时轮询或一次性定时提醒任务',
      titleEn: 'Schedule a recurring check or one-shot timer',
      defaultEnabled: false
    },
    {
      id: 'reload',
      group: 'tools',
      label: '重载规则',
      labelEn: 'Reload Rules',
      slash: '',
      text: '重新读取 AGENTS',
      supportsAutoSend: true,
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
      slash: '',
      text: '',
      builtinAction: 'copyid',
      rec: '★默认',
      recEn: '★Default',
      tag: '快速取值',
      tagEn: 'Copy ID',
      role: '一键复制当前对话窗口的唯一会话编号（ID）。',
      roleEn: 'Extract and copy the current conversation ID to the clipboard.',
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
      slash: '',
      text: '',
      builtinAction: 'export',
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
    BUILTIN_QUICK_POOL.map((item) => [item.id, Boolean(item.defaultEnabled)])
  );
  let quickPoolState = { ...DEFAULT_QUICK_POOL_STATE };
  let customQuickPrompts = null;

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
    const poolDef = BUILTIN_QUICK_POOL.find((p) => p.id === id);
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
      if (out.length >= 20) break;
    }
    return out;
  }

  const autoClickedButtons = new WeakMap();

  const __AG_ZH_TW_PHRASE_MAP = {"左右并排布局":"左右並排版面設定","布局":"排版","多路复用器":"多工器","正则表达式":"正規表示式","未检测到":"未偵測到","自动默认":"自動預設","配置文件":"設定檔","命令提示符":"命令提示字元","子系统":"子系統","文件夹":"資料夾","复选框":"核取方塊","下拉框":"下拉選單","工具栏":"工具列","侧边栏":"側邊欄","状态栏":"狀態列","标题栏":"標題列","地址栏":"網址列","活动栏":"活動列","导航栏":"導覽列","标签页":"分頁","对话框":"對話方塊","剪贴板":"剪貼簿","快捷键":"快速鍵","命令行":"命令列","控制台":"主控台","客户端":"用戶端","桌面端":"桌面版","移动端":"行動版","网页端":"網頁版","服务器端":"伺服器端","服务器":"伺服器","占位符":"預留位置","通配符":"萬用字元","分辨率":"解析度","返回值":"回傳值","字符串":"字串","智能体":"代理","热力图":"熱度圖","快捷提示词":"常用提示詞","快捷操作栏":"常用工具列","快捷按钮":"指令按鈕","快捷指令":"常用指令","快捷口令":"常用指令","快捷方式":"捷徑","快捷":"快速","按点击付费":"按點擊付費","点击":"點選","日常高频":"日常常用","追问对齐":"追問釐清","全部对齐":"全部釐清","提炼经验":"歸納經驗","提炼":"歸納","深度攻坚":"深度解題","复杂攻坚":"複雜任務","攻坚":"突破","定时任务":"排程任務","定时计划":"排程計畫","定时巡检":"排程巡檢","定时轮询":"排程輪詢","定时运行":"排程執行","定时后台":"背景排程","定时器":"計時器","5h 滚动窗口":"5 小時限額","5h 滚动":"5 小時限額","滚动窗口":"分時段","滚动条":"捲軸","滚动":"捲動","周边":"周邊","周邊":"周邊","周围":"周圍","周圍":"周圍","周全":"周全","周密":"周密","周到":"周到","圆周":"圓周","圓周":"圓周","周长":"周長","周長":"周長","周知":"周知","免审核":"免審核","待审批":"待審核","二进制":"二進位","自定义":"自訂","只读":"唯讀","仅限":"僅限","仅显示":"僅顯示","仅用于":"僅用於","默认值":"預設值","初始化":"初始化","上下文":"上下文","响应式":"響應式","高危":"高風險","审批":"審核","菜单":"選單","弹窗":"彈出視窗","浮窗":"懸浮視窗","窗口":"視窗","屏幕":"螢幕","鼠标":"滑鼠","图标":"圖示","角标":"徽章","标签":"標籤","书签":"書籤","字体":"字型","内存":"記憶體","缓存":"快取","软件":"軟體","硬件":"硬體","文档":"文件","文件":"檔案","默认":"預設","设置":"設定","配置":"設定","终端":"終端機","重启":"重新啟動","刷新":"重新整理","卸载":"解除安裝","新建":"新增","添加":"新增","保存":"儲存","加载":"載入","导入":"匯入","导出":"匯出","搜索":"搜尋","查找":"尋找","替换":"取代","撤销":"復原","重置":"重設","清空":"清除","过滤":"篩選","拖拽":"拖曳","粘贴":"貼上","拷贝":"複製","复制":"複製","重复":"重複","复杂":"複雜","复用":"重複使用","回复":"回覆","恢复":"恢復","复原":"復原","复核":"複核","复盘":"覆盤","复现":"重現","修复":"修復","支持":"支援","兼容":"相容","数据":"資料","元数据":"中繼資料","调用":"呼叫","连接器":"連接器","连接":"連線","创建":"建立","响应":"回應","内置":"內建","全局":"全域","本地":"本機","本机":"本機","远程":"遠端","远端":"遠端","后台":"背景","前台":"前景","实时":"即時","异步":"非同步","并发送":"並傳送","并发布":"並發布","并发现":"並發現","并发展":"並發展","并发起":"並發起","并发":"並行","合并":"合併","并行":"平行","并排":"並排","通过":"透過","用户":"使用者","登录":"登入","注销":"登出","账号":"帳號","账户":"帳戶","链接":"連結","视频":"影片","音频":"音訊","图像":"影像","文本":"文字","字符":"字元","字节":"位元組","信息":"資訊","消息":"訊息","反馈":"回饋","交互":"互動","崩溃":"當機","卡死":"卡住","报错":"錯誤","超时":"逾時","端口":"連接埠","域名":"網域","协议":"通訊協定","网络":"網路","带宽":"頻寬","磁盘":"磁碟","硬盘":"硬碟","插件":"外掛","汉化":"中文化","代码":"程式碼","项目":"專案","仓库":"儲存庫","归档":"封存","运行":"執行","调试":"除錯","构建":"建置","组件":"元件","模块":"模組","依赖":"相依套件","变量":"變數","常量":"常數","函数":"函式","接口":"介面","数组":"陣列","对象":"物件","布尔":"布林","回调":"回呼","进程":"處理程序","處理程序":"處理程序","线程":"執行緒","队列":"佇列","缩进":"縮排","后缀":"副檔名","套餐":"方案","概览":"總覽","积分":"點數","润色":"潤飾","剩余":"剩餘","占用":"佔用","兜底":"備援","启用":"啟用","启动":"啟動","开启":"開啟","禁用":"停用","地址":"位址","网址":"網址","打印":"列印","检测":"偵測","校验":"驗證","渲染":"算繪","高亮":"醒目提示","折叠":"摺疊","计划":"計畫","脚本":"指令碼","程序":"程式","内核":"核心","批注":"註解","教程":"教學","联系":"聯絡","关系":"關係","体系":"體系","系统":"系統","在线":"線上","离线":"離線","帮助":"說明","定制":"客製","制作":"製作","录制":"錄製","绘制":"繪製","控制":"控制","限制":"限制","强制":"強制","机制":"機制","干预":"干預","干預":"干預","干扰":"干擾","干擾":"干擾","干净":"乾淨","回滚":"還原","邮箱":"電子郵件","昵称":"暱稱","头像":"大頭貼","令牌":"權杖","密钥":"金鑰","汇总":"彙總","游戏":"遊戲","下游":"下游","上游":"上游","台币":"新台幣","中国台湾":"台灣","台湾":"台灣","占位":"預留位置","独占":"獨佔","其余":"其餘","多余":"多餘","轻松":"輕鬆","宽松":"寬鬆","松开":"放開","切换":"切換","刷新并":"重新整理並","当前":"目前","里面":"裡面","界面":"介面","页面":"頁面","面板":"面板","桌面":"桌面","下面":"下方","上面":"上方","后面":"後方","前面":"前方","全面":"全面","方面":"方面","浏览":"瀏覽","浏览器":"瀏覽器","编辑":"編輯","编辑器":"編輯器","评论":"留言","发送":"傳送","跳过":"略過","暂停":"暫停","继续":"繼續","取消":"取消","确定":"確定","确认":"確認","关闭":"關閉","打开":"開啟","删除":"刪除","移除":"移除","隐藏":"隱藏","显示":"顯示","展开":"展開","收起":"收合","收拢":"收合","折叠态":"摺疊狀態","同步":"同步","上传":"上傳","下载":"下載","更新":"更新","升级":"升級","安装":"安裝","权限":"權限","隐私":"隱私","安全":"安全","异常":"異常","失败":"失敗","成功":"成功","警告":"警告","提示":"提示","通知":"通知","状态":"狀態","统计":"統計","分析":"分析","历史":"歷史","日历":"行事曆","工作区":"工作區","工作台":"工作台","工作流":"工作流程","工作流程":"工作流程","任务":"任務","会话":"工作階段","对话":"對話","聊天":"聊天","标题":"標題","内容":"內容","详情":"詳細資訊","列表":"清單","表单":"表單","按钮":"按鈕","开关":"開關","选项":"選項","参数":"參數","属性":"屬性","格式":"格式","样式":"樣式","主题":"佈景主題","配色":"配色","强调色":"強調色","浅色":"淺色","深色":"深色","暗色":"深色","亮色":"淺色","预览":"預覽","草稿":"草稿","快照":"快照","提交":"提交","分支":"分支","差异":"差異","冲突":"衝突","拉取":"拉取","推送":"推送","克隆":"複製","模型":"模型","推理":"推理","思考":"思考","额度":"額度","配额":"配額","订阅":"訂閱","费用":"費用","价格":"價格","汇率":"匯率","货币":"貨幣","国家":"國家","地区":"地區","语言":"語言","简体中文":"簡體中文","繁体中文":"繁體中文","英文":"英文","原文":"原文","译文":"譯文","翻译":"翻譯","词典":"詞典","词库":"詞庫","日志":"日誌","记录":"記錄","规则":"規則","策略":"策略","模式":"模式","档位":"等級","级别":"層級","阈值":"門檻值","上限":"上限","下限":"下限","速率":"速率","速度":"速度","延迟":"延遲","耗时":"耗時","时长":"時間長度","分钟":"分鐘","小时":"小時","秒":"秒","毫秒":"毫秒","自动":"自動","手动":"手動","批量":"批次","单次":"單次","全局脚本":"全域指令碼","环境变量":"環境變數","代理":"代理","隧道":"通道","扫码":"掃碼","二维码":"QR Code","蓝牙":"藍牙","触控":"觸控","辅助功能":"輔助使用","系统设置":"系統設定","偏好设置":"偏好設定","常见":"常見","推荐":"推薦","必开":"必開","可选":"選用","其他":"其他","未知":"未知","暂无":"暫無","未提供":"未提供","未填写":"未填寫","已启用":"已啟用","已停用":"已停用","已关闭":"已關閉","已保存":"已儲存","已复制":"已複製","已连接":"已連線","未连接":"未連線","正在":"正在","完成":"完成","准备":"準備","“":"「","”":"」","‘":"『","’":"』","查看网站信息":"檢視網站資訊","查看全部说明":"查閱完整說明","查看更多结果":"顯示更多結果","查看更多":"瀏覽更多","查看全部":"顯示全部","查看文档":"查閱文件","查看发行说明":"閱讀發行說明","查看套餐方案":"瀏覽方案","查看方案":"瀏覽方案","查看模型用量":"查詢模型用量","查看用量":"查詢用量","查看忙闲状态":"查詢忙閒狀態","查看":"檢視"};
  const __AG_ZH_TW_CHAR_MAP = {"周":"週","万":"萬","与":"與","专":"專","业":"業","丢":"丟","两":"兩","严":"嚴","丧":"喪","个":"個","丰":"豐","临":"臨","为":"為","举":"舉","么":"麼","义":"義","乐":"樂","习":"習","书":"書","买":"買","乱":"亂","争":"爭","于":"於","云":"雲","亚":"亞","产":"產","亿":"億","仅":"僅","从":"從","仓":"倉","仪":"儀","们":"們","价":"價","优":"優","会":"會","传":"傳","伤":"傷","体":"體","侣":"侶","侧":"側","倾":"傾","偿":"償","储":"儲","兰":"蘭","关":"關","兴":"興","兽":"獸","内":"內","册":"冊","写":"寫","军":"軍","冲":"衝","决":"決","况":"況","冻":"凍","净":"淨","减":"減","凑":"湊","几":"幾","凭":"憑","击":"擊","则":"則","刚":"剛","创":"創","删":"刪","别":"別","剥":"剝","办":"辦","务":"務","动":"動","势":"勢","匀":"勻","区":"區","医":"醫","协":"協","单":"單","占":"佔","卢":"盧","卫":"衛","历":"歷","压":"壓","参":"參","双":"雙","发":"發","变":"變","叠":"疊","叶":"葉","号":"號","叹":"嘆","后":"後","吗":"嗎","听":"聽","启":"啟","员":"員","响":"響","唤":"喚","团":"團","围":"圍","国":"國","图":"圖","圆":"圓","场":"場","坏":"壞","块":"塊","坚":"堅","声":"聲","壳":"殼","处":"處","备":"備","复":"復","够":"夠","头":"頭","夹":"夾","妆":"妝","学":"學","实":"實","审":"審","宽":"寬","宾":"賓","对":"對","寻":"尋","导":"導","将":"將","尔":"爾","尝":"嘗","尸":"屍","尽":"盡","层":"層","屉":"屜","属":"屬","币":"幣","师":"師","帐":"帳","带":"帶","帧":"幀","帮":"幫","干":"乾","并":"並","广":"廣","库":"庫","应":"應","废":"廢","开":"開","异":"異","弃":"棄","张":"張","弥":"彌","弹":"彈","强":"強","归":"歸","当":"當","录":"錄","彻":"徹","征":"徵","径":"徑","态":"態","总":"總","恶":"惡","悬":"懸","惩":"懲","懒":"懶","戏":"戲","战":"戰","户":"戶","扑":"撲","执":"執","扩":"擴","扫":"掃","扬":"揚","扰":"擾","抢":"搶","护":"護","报":"報","担":"擔","拟":"擬","拢":"攏","拥":"擁","拦":"攔","择":"擇","挂":"掛","挥":"揮","损":"損","换":"換","据":"據","携":"攜","摄":"攝","撑":"撐","敌":"敵","敛":"斂","数":"數","断":"斷","无":"無","旧":"舊","时":"時","昵":"暱","显":"顯","暂":"暫","术":"術","机":"機","杂":"雜","权":"權","杠":"槓","条":"條","来":"來","极":"極","构":"構","标":"標","栈":"棧","栏":"欄","树":"樹","样":"樣","档":"檔","桥":"橋","桩":"樁","检":"檢","横":"橫","欢":"歡","欧":"歐","残":"殘","毁":"毀","气":"氣","汇":"匯","汉":"漢","沉":"沈","沟":"溝","没":"沒","泄":"洩","洁":"潔","浅":"淺","测":"測","浏":"瀏","浓":"濃","淀":"澱","渐":"漸","温":"溫","湾":"灣","溃":"潰","滚":"滾","滞":"滯","满":"滿","滤":"濾","潜":"潛","灯":"燈","灵":"靈","点":"點","炼":"煉","烁":"爍","烟":"煙","热":"熱","爱":"愛","状":"狀","独":"獨","献":"獻","环":"環","现":"現","电":"電","画":"畫","畅":"暢","疗":"療","监":"監","盖":"蓋","盘":"盤","着":"著","睐":"睞","码":"碼","础":"礎","确":"確","碍":"礙","离":"離","种":"種","积":"積","称":"稱","税":"稅","稳":"穩","窃":"竊","竖":"竪","竞":"競","笔":"筆","笺":"箋","筛":"篩","筹":"籌","签":"簽","简":"簡","类":"類","紧":"緊","纠":"糾","红":"紅","约":"約","级":"級","纯":"純","纲":"綱","纳":"納","线":"線","练":"練","组":"組","细":"細","织":"織","终":"終","绍":"紹","经":"經","绑":"綁","结":"結","绕":"繞","绘":"繪","给":"給","络":"絡","绝":"絕","统":"統","继":"繼","绪":"緒","续":"續","维":"維","绿":"綠","缀":"綴","缓":"緩","编":"編","缘":"緣","缩":"縮","网":"網","罚":"罰","职":"職","联":"聯","胀":"脹","胁":"脅","胜":"勝","胶":"膠","脑":"腦","脚":"腳","脱":"脫","腊":"臘","节":"節","范":"範","荐":"薦","药":"藥","获":"獲","营":"營","蓝":"藍","虑":"慮","虚":"虛","虽":"雖","补":"補","装":"裝","见":"見","观":"觀","规":"規","视":"視","览":"覽","觉":"覺","触":"觸","计":"計","订":"訂","认":"認","讨":"討","让":"讓","训":"訓","议":"議","记":"記","讲":"講","许":"許","论":"論","设":"設","访":"訪","证":"證","评":"評","识":"識","诉":"訴","诊":"診","词":"詞","译":"譯","试":"試","诗":"詩","话":"話","询":"詢","该":"該","详":"詳","语":"語","误":"誤","诱":"誘","说":"說","请":"請","读":"讀","调":"調","谋":"謀","谢":"謝","谨":"謹","谱":"譜","负":"負","贡":"貢","责":"責","败":"敗","账":"帳","货":"貨","质":"質","购":"購","贴":"貼","费":"費","资":"資","赋":"賦","赖":"賴","赠":"贈","赶":"趕","趋":"趨","跃":"躍","践":"踐","踪":"蹤","车":"車","轨":"軌","转":"轉","轮":"輪","软":"軟","轴":"軸","轻":"輕","载":"載","较":"較","辅":"輔","辑":"輯","输":"輸","边":"邊","达":"達","迁":"遷","过":"過","运":"運","还":"還","这":"這","进":"進","远":"遠","连":"連","迟":"遲","迹":"跡","适":"適","选":"選","递":"遞","逻":"邏","遗":"遺","遥":"遙","邮":"郵","邻":"鄰","采":"採","释":"釋","鉴":"鑒","针":"針","钟":"鐘","钥":"鑰","钩":"鈎","钮":"鈕","钻":"鑽","铬":"鉻","铭":"銘","银":"銀","铺":"鋪","链":"鏈","销":"銷","锁":"鎖","错":"錯","锚":"錨","键":"鍵","镑":"鎊","镜":"鏡","长":"長","门":"門","闪":"閃","闭":"閉","问":"問","闲":"閒","间":"間","阅":"閱","阈":"閾","队":"隊","阴":"陰","阵":"陣","阶":"階","际":"際","陆":"陸","陈":"陳","险":"險","随":"隨","隐":"隱","难":"難","雾":"霧","静":"靜","韩":"韓","页":"頁","顶":"頂","项":"項","顺":"順","须":"須","顾":"顧","顿":"頓","颁":"頒","预":"預","领":"領","频":"頻","颗":"顆","题":"題","颜":"顏","额":"額","风":"風","饰":"飾","饱":"飽","饼":"餅","馈":"饋","马":"馬","驱":"驅","驻":"駐","验":"驗","骗":"騙","骚":"騷","骤":"驟","麦":"麥","黄":"黃","齐":"齊","龙":"龍","余":"餘","松":"鬆","准":"準","划":"劃"};
  const __AG_ZH_TW_PHRASE_KEYS = Object.keys(__AG_ZH_TW_PHRASE_MAP).sort((a, b) => b.length - a.length);
  const __AG_ZH_TW_PHRASE_RE = new RegExp(__AG_ZH_TW_PHRASE_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const __AG_ZH_TW_HAS_RE = /[\u4e00-\u9fff“”‘’]/;
  const __AG_ZH_TW_CACHE = new Map();
  function convertZhCNToZhTWFallback(input) {
    if (typeof input !== "string" || !input || !__AG_ZH_TW_HAS_RE.test(input)) return input;
    if (__AG_ZH_TW_CACHE.has(input)) return __AG_ZH_TW_CACHE.get(input);
    const convSeg = (seg) => {
      let out = ""; let changed = false;
      for (let i = 0; i < seg.length; i++) { const c = seg[i]; const m = __AG_ZH_TW_CHAR_MAP[c]; if (m !== undefined) { out += m; changed = true; } else { out += c; } }
      return changed ? out : seg;
    };
    let res = ""; let last = 0; __AG_ZH_TW_PHRASE_RE.lastIndex = 0; let m;
    while ((m = __AG_ZH_TW_PHRASE_RE.exec(input)) !== null) {
      if (m.index > last) res += convSeg(input.slice(last, m.index));
      res += __AG_ZH_TW_PHRASE_MAP[m[0]]; last = m.index + m[0].length;
    }
    if (last < input.length) res += convSeg(input.slice(last));
    if (__AG_ZH_TW_CACHE.size >= 8000) { const fk = __AG_ZH_TW_CACHE.keys().next().value; if (fk !== undefined) __AG_ZH_TW_CACHE.delete(fk); }
    __AG_ZH_TW_CACHE.set(input, res);
    return res;
  }
  function convertEnhancerToZhTW(text) {
    if (typeof text !== 'string' || !text) return text;
    if (typeof window !== 'undefined' && typeof window.__AG_ZH_TW_CONVERT__ === 'function') {
      return window.__AG_ZH_TW_CONVERT__(text);
    }
    return typeof convertZhCNToZhTWFallback === 'function' ? convertZhCNToZhTWFallback(text) : text;
  }

  function tr(zhText, enText, zhTwText) {
    if (uiLang === 'en') return enText;
    if (uiLang === 'zh-TW') return zhTwText ?? convertEnhancerToZhTW(zhText);
    return zhText;
  }

  function syncSuitePrefsFromStorage(detail = null) {
    try {
      if (detail && typeof detail.autoAccept === 'boolean') {
        autoAcceptEnabled = detail.autoAccept;
      } else if (typeof localStorage !== 'undefined') {
        autoAcceptEnabled = localStorage.getItem('ag_suite_auto_accept') === 'true';
      }
    } catch {}
    try {
      if (detail && typeof detail.ghostSuggest === 'boolean') {
        ghostSuggestEnabled = detail.ghostSuggest;
      } else if (typeof localStorage !== 'undefined') {
        const rawGhost = localStorage.getItem('ag_suite_ghost_suggest');
        if (rawGhost === 'true' || rawGhost === 'false') {
          ghostSuggestEnabled = rawGhost === 'true';
        }
      }
    } catch {}
    try {
      if (detail && typeof detail.autoCompact === 'boolean') {
        autoCompactEnabled = detail.autoCompact;
      } else if (typeof localStorage !== 'undefined') {
        const rawCompact = localStorage.getItem('ag_suite_auto_compact');
        if (rawCompact === 'true' || rawCompact === 'false') {
          autoCompactEnabled = rawCompact !== 'false';
        }
      }
    } catch {}
    try {
      if (detail && typeof detail.quickBuiltinAutoSend === 'boolean') {
        quickBuiltinAutoSendEnabled = detail.quickBuiltinAutoSend;
      } else if (typeof localStorage !== 'undefined') {
        const rawQuickSend = localStorage.getItem('ag_suite_quick_builtin_autosend');
        if (rawQuickSend === 'true' || rawQuickSend === 'false') {
          quickBuiltinAutoSendEnabled = rawQuickSend === 'true';
        }
      }
    } catch {}
    try {
      if (detail && typeof detail.dockBadgeEnabled === 'boolean') {
        dockBadgeEnabled = detail.dockBadgeEnabled;
      } else if (typeof localStorage !== 'undefined') {
        const rawDockEnabled = localStorage.getItem('ag_suite_dock_badge_enabled');
        dockBadgeEnabled = rawDockEnabled !== 'false';
      }
    } catch {}
    try {
      if (detail && typeof detail.dockBadgeAutoClear === 'boolean') {
        dockBadgeAutoClear = detail.dockBadgeAutoClear;
      } else if (typeof localStorage !== 'undefined') {
        const rawDockAutoClear = localStorage.getItem('ag_suite_dock_badge_autoclear');
        dockBadgeAutoClear = rawDockAutoClear !== 'false';
      }
    } catch {}
    try {
      if (detail && detail.featureFlags && typeof detail.featureFlags === 'object') {
        for (const k of Object.keys(DEFAULT_FEATURE_FLAGS)) {
          if (typeof detail.featureFlags[k] === 'boolean') {
            featureFlags[k] = detail.featureFlags[k];
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        const rawFeat = localStorage.getItem('ag_suite_feature_flags');
        if (rawFeat) {
          const parsedFeat = JSON.parse(rawFeat);
          if (parsedFeat && typeof parsedFeat === 'object') {
            for (const k of Object.keys(DEFAULT_FEATURE_FLAGS)) {
              if (typeof parsedFeat[k] === 'boolean') {
                featureFlags[k] = parsedFeat[k];
              }
            }
          }
        }
      }
    } catch {}
    try {
      let rawLang = '';
      if (detail && typeof detail === 'object') {
        rawLang = String(detail.hansCode || detail.capsuleLang || detail.locale || '').trim();
      }
      if (!rawLang && typeof document !== 'undefined' && document.documentElement?.getAttribute) {
        rawLang = String(
          document.documentElement.getAttribute('data-ag-hans-lang')
          || document.documentElement.getAttribute('data-ag-suite-locale')
          || ''
        ).trim();
      }
      if (!rawLang && typeof localStorage !== 'undefined') {
        rawLang = String(
          localStorage.getItem('ag_suite_locale')
          || localStorage.getItem('antigravityHansLang')
          || ''
        ).trim();
      }
      if (/^(?:zh-tw|zh-hant|zh-hk|tw)\b/i.test(rawLang)) {
        uiLang = 'zh-TW';
      } else if (!rawLang) {
        uiLang = 'zh-TW';
      } else if (/^(?:zh|cn)/i.test(rawLang)) {
        uiLang = 'zh';
      } else {
        uiLang = 'en';
      }
    } catch {
      uiLang = 'zh-TW';
    }
    try {
      let hasExplicitPool = false;
      if (detail && detail.quickPool && typeof detail.quickPool === 'object') {
        quickPoolState = sanitizeQuickPoolState(detail.quickPool);
        hasExplicitPool = true;
      } else if (typeof localStorage !== 'undefined') {
        const rawPool = localStorage.getItem('ag_suite_quick_pool');
        if (rawPool) {
          quickPoolState = sanitizeQuickPoolState(JSON.parse(rawPool));
          hasExplicitPool = true;
        }
      }
      if (!hasExplicitPool) {
        const flagSrc = (detail && detail.featureFlags && typeof detail.featureFlags === 'object')
          ? detail.featureFlags
          : (typeof localStorage !== 'undefined' && localStorage.getItem('ag_suite_feature_flags')
              ? JSON.parse(localStorage.getItem('ag_suite_feature_flags'))
              : null);
        if (flagSrc && typeof flagSrc === 'object') {
          if (typeof flagSrc.showQuickCopyId === 'boolean') quickPoolState.copyid = flagSrc.showQuickCopyId;
          if (typeof flagSrc.showQuickExport === 'boolean') quickPoolState.export = flagSrc.showQuickExport;
        }
      }
    } catch {}
    try {
      if (detail && 'quickPrompts' in detail) {
        if (detail.quickPrompts === null) {
          customQuickPrompts = null;
        } else {
          if (Array.isArray(detail.quickPrompts) && !detail.quickPool) {
            for (const item of detail.quickPrompts) {
              if (isLegacyDefaultPromptItem(item) && item.enabled === false) {
                quickPoolState[item.id] = false;
              }
            }
          }
          customQuickPrompts = sanitizeQuickPromptsList(detail.quickPrompts);
        }
      } else if (typeof localStorage !== 'undefined') {
        const rawQp = localStorage.getItem('ag_suite_quick_prompts');
        if (rawQp) {
          const parsedArr = JSON.parse(rawQp);
          if (Array.isArray(parsedArr) && !localStorage.getItem('ag_suite_quick_pool')) {
            for (const item of parsedArr) {
              if (isLegacyDefaultPromptItem(item) && item.enabled === false) {
                quickPoolState[item.id] = false;
              }
            }
          }
          customQuickPrompts = sanitizeQuickPromptsList(parsedArr);
        } else {
          customQuickPrompts = null;
        }
      }
    } catch {}
  }
  syncSuitePrefsFromStorage();
  let latestBrainStats = null;
  let nextStepState = {
    candidates: [],
    index: 0,
    replySig: '',
    dismissedSig: '',
    visible: false
  };
  let promptOptState = {
    loading: false,
    abortCtrl: null,
    userCancelled: false,
    backupText: '',
    optimizedText: '',
    undoHintActive: false,
    canUndo: false,
    lastError: null,
    cacheModel: {
      primary: '',
      fallback: '',
      candidates: [],
      fetchedAt: 0
    }
  };
  let isComposerComposing = false;
  let lastUserSubmitAt = 0;
  let autoCompactState = {
    lastSessionId: '',
    armedForSession: false,
    inFlightMap: new Map(),
    idleSince: 0,
    lastFiredMap: new Map()
  };
  const AUTO_COMPACT_MAP_LIMIT = 64;
  const AUTO_COMPACT_IN_FLIGHT_MAX_MS = 180000;

  function trimAutoCompactMap(map, limit = AUTO_COMPACT_MAP_LIMIT) {
    while (map.size > limit) {
      const firstKey = map.keys().next().value;
      if (firstKey === undefined) break;
      map.delete(firstKey);
    }
  }

  function scoreOptimizeModelCandidate(entry, isDefaultOverride = false) {
    const mid = String(entry?.modelId || '').toLowerCase();
    const label = String(entry?.label || '').toLowerCase();
    const model = String(entry?.model || '').toLowerCase();
    const text = `${mid} ${label} ${model}`;
    const remaining = entry?.remainingFraction;
    const exhaustedPenalty = (typeof remaining === 'number' && Number.isFinite(remaining) && remaining <= 0) ? 200 : 0;

    let baseScore = 50;
    if (text.includes('orchestrator')) {
      baseScore = 90;
    } else if (text.includes('flash')) {
      if (text.includes('low')) baseScore = 10;
      else if (text.includes('medium')) baseScore = 15;
      else if (text.includes('high') || text.includes('xhigh')) baseScore = 24;
      else baseScore = 18;
    } else if (text.includes('sonnet') && text.includes('low')) {
      baseScore = 20;
    } else if (/\b(?:haiku|mini|lite)\b|gpt[-_]oss/i.test(text)) {
      baseScore = 22;
    } else if (/\blow\b|\(low\)|-low\b|_low\b/.test(text)) {
      baseScore = 26;
    } else if (/\bmedium\b|\(medium\)|-medium\b|_medium\b/.test(text)) {
      baseScore = 36;
    } else if (/\bxhigh\b|\(xhigh\)|-xhigh\b|_xhigh\b/.test(text)) {
      baseScore = 72;
    } else if (/\bhigh\b|\(high\)|-high\b|_high\b/.test(text)) {
      baseScore = 62;
    } else if (isDefaultOverride) {
      baseScore = 44;
    }

    return baseScore + exhaustedPenalty;
  }

  function detectOptimizeModelFamily(entry) {
    const text = `${entry?.modelId || ''} ${entry?.label || ''} ${entry?.model || ''}`.toLowerCase();
    if (text.includes('orchestrator')) return 'orchestrator';
    if (text.includes('claude') || text.includes('sonnet') || text.includes('opus') || text.includes('haiku')) return 'claude';
    if (text.includes('gpt') || text.includes('openai')) return 'openai';
    if (text.includes('flash')) return 'gemini-flash';
    if (text.includes('gemini')) return 'gemini';
    return 'other';
  }

  function buildOptimizeModelCandidates(cfgData) {
    if (!cfgData || typeof cfgData !== 'object') return [];
    const configs = Array.isArray(cfgData.clientModelConfigs) ? cfgData.clientModelConfigs : [];
    const primaryOverride = String(cfgData.defaultOverrideModelConfig?.modelOrAlias?.model || '').trim();
    const byModel = new Map();

    configs.forEach((c, idx) => {
      const model = String(c?.modelOrAlias?.model || '').trim();
      if (!model || byModel.has(model)) return;
      const item = {
        model,
        modelId: String(c?.modelId || '').trim(),
        label: String(c?.label || c?.modelId || model).trim(),
        remainingFraction: typeof c?.quotaInfo?.remainingFraction === 'number' ? c.quotaInfo.remainingFraction : null,
        isDefaultOverride: model === primaryOverride,
        idx
      };
      item.score = scoreOptimizeModelCandidate(item, item.isDefaultOverride);
      item.family = detectOptimizeModelFamily(item);
      byModel.set(model, item);
    });

    if (primaryOverride && !byModel.has(primaryOverride)) {
      const item = {
        model: primaryOverride,
        modelId: '',
        label: primaryOverride,
        remainingFraction: null,
        isDefaultOverride: true,
        idx: configs.length
      };
      item.score = scoreOptimizeModelCandidate(item, true);
      item.family = detectOptimizeModelFamily(item);
      byModel.set(primaryOverride, item);
    }

    const sorted = Array.from(byModel.values()).sort((a, b) => (a.score - b.score) || (a.idx - b.idx));
    if (sorted.length <= 4) {
      return sorted.map(({ model, modelId, label, family, score }) => ({ model, modelId, label, family, score }));
    }

    const picked = [];
    const pickedModels = new Set();
    const pushItem = (item) => {
      if (!item || pickedModels.has(item.model)) return;
      pickedModels.add(item.model);
      picked.push(item);
    };

    // 1. 优先选择评分最优的轻量快速模型
    pushItem(sorted[0]);
    // 2. 第二候选优先挑选跨模型族的轻量备选（防止单一族限流/不可用）
    const crossFamily = sorted.find((it) => !pickedModels.has(it.model) && it.family !== sorted[0].family && it.score < 200);
    if (crossFamily) pushItem(crossFamily);
    // 3. 加入同族或次优快速备选
    for (const it of sorted) {
      if (picked.length >= 3) break;
      pushItem(it);
    }
    // 4. 若默认覆盖模型尚未进入前 3，作为兜底纳入第 4 候选；否则顺延补足至 4 个
    if (primaryOverride && !pickedModels.has(primaryOverride) && byModel.has(primaryOverride)) {
      pushItem(byModel.get(primaryOverride));
    }
    for (const it of sorted) {
      if (picked.length >= 4) break;
      pushItem(it);
    }
    return picked.map(({ model, modelId, label, family, score }) => ({ model, modelId, label, family, score }));
  }

  function cacheDefaultModelFromConfigData(cfgData) {
    const candidates = buildOptimizeModelCandidates(cfgData);
    if (!candidates.length) return;
    const primary = candidates[0]?.model || '';
    const fallback = candidates.find((c) => c.model !== primary)?.model || '';
    promptOptState.cacheModel = {
      primary,
      fallback,
      candidates,
      fetchedAt: Date.now()
    };
  }

  function safeRemove(node) {
    try {
      if (node && typeof node.remove === 'function') node.remove();
    } catch {}
  }

  function getMeterHostAndShadow() {
    const host = document.getElementById(METER_HOST_ID);
    const sr = host && host.shadowRoot ? host.shadowRoot : null;
    return { host, sr };
  }

  function resolveHostTheme(host) {
    try {
      const attr = host?.getAttribute?.('data-theme');
      if (attr === 'light' || attr === 'dark') return attr;
      const docAttr = document.documentElement?.getAttribute?.('data-theme');
      if (docAttr === 'light' || docAttr === 'dark') return docAttr;
      if (document.documentElement?.classList?.contains('light')) return 'light';
      if (document.documentElement?.classList?.contains('dark')) return 'dark';
      if (window.matchMedia?.('(prefers-color-scheme: light)')?.matches) return 'light';
    } catch {}
    return 'dark';
  }

  // 解析直接画在宿主原生画布上的嵌入式挂件应遵循的真实宿主键底明暗，避免独立切换插件面板深浅时文字隐身
  function resolveSurfaceTheme(host) {
    try {
      const themeMode = host?.getAttribute?.('data-theme-mode');
      const hostAttr = host?.getAttribute?.('data-host-theme');
      if ((themeMode === 'light' || themeMode === 'dark') && (hostAttr === 'light' || hostAttr === 'dark')) {
        return hostAttr;
      }
      const doc = document.documentElement;
      const body = document.body;
      const docAttr = doc?.getAttribute?.('data-theme');
      if (docAttr === 'light' || body?.classList?.contains('theme-light') || body?.classList?.contains('light') || doc?.classList?.contains('light') || body?.classList?.contains('vscode-light')) return 'light';
      if (docAttr === 'dark' || body?.classList?.contains('theme-dark') || body?.classList?.contains('dark') || doc?.classList?.contains('dark') || body?.classList?.contains('vscode-dark')) return 'dark';
      if (doc?.style?.colorScheme === 'light') return 'light';
      if (doc?.style?.colorScheme === 'dark') return 'dark';
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        for (const el of [body, doc].filter(Boolean)) {
          const cs = window.getComputedStyle(el);
          const raw = cs?.backgroundColor?.trim();
          if (raw && raw !== 'transparent') {
            const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([\d.]+%?))?/i);
            if (m) {
              const alpha = m[4] !== undefined ? (m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])) : 1;
              if (Number.isNaN(alpha) || alpha > 0.01) {
                const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
                return lum > 0.55 ? 'light' : 'dark';
              }
            }
          }
        }
      }
    } catch {}
    return resolveHostTheme(host);
  }

  // 解析剩余百分比对应的视觉颜色：>=50% 跟随当前主题色，20%~50% 琥珀黄，<20% 红
  function getQuotaColor(frac) {
    if (typeof frac !== 'number' || !Number.isFinite(frac)) return 'var(--ag-text-muted, #9ca3af)';
    const pct = frac * 100;
    if (pct >= 50) return 'var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa))';
    if (pct >= 20) return 'var(--ag-ring-warn, #f59e0b)';
    return 'var(--ag-ring-danger, #ef4444)';
  }

  function formatPctInt(frac) {
    if (typeof frac !== 'number' || !Number.isFinite(frac)) return '--%';
    return `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }

  function formatPctOne(frac) {
    if (typeof frac !== 'number' || !Number.isFinite(frac)) return '--%';
    return `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  }

  function formatResetCountdownZh(isoStr) {
    const out = (zh) => (uiLang === 'zh-TW' ? convertEnhancerToZhTW(zh) : zh);
    if (!isoStr) return out('重置时间未知');
    const target = new Date(isoStr);
    if (Number.isNaN(target.getTime())) return String(isoStr);
    const diffMs = target.getTime() - Date.now();
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    const month = target.getMonth() + 1;
    const day = target.getDate();
    const now = new Date();
    const sameDay = now.getFullYear() === target.getFullYear() && now.getMonth() === target.getMonth() && now.getDate() === target.getDate();
    const timeLabel = sameDay ? `${hh}:${mm}` : `${month}月${day}日 ${hh}:${mm}`;

    if (diffMs <= 0) return out(`即将重置 · ${timeLabel}`);
    const totalMin = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    let countdown = '';
    if (days > 0) countdown = `${days}天${hours}小时`;
    else if (hours > 0) countdown = `${hours}小时${mins}分`;
    else countdown = `${Math.max(1, mins)}分钟`;
    return out(`${countdown}后重置 · ${timeLabel}`);
  }

  function detectCurrentModelText() {
    try {
      const btn = document.querySelector('[data-testid="model-selector-trigger"]');
      const txt = btn?.textContent?.trim();
      if (txt) return txt;
    } catch {}
    try {
      const snapModel = window.__AGContextMeter?.snapshot?.()?.latest?.model;
      if (snapModel) return String(snapModel);
    } catch {}
    return '';
  }

  function classifyModelPoolKey(modelText) {
    const s = String(modelText || '').toLowerCase();
    if (s.includes('claude') || s.includes('opus') || s.includes('sonnet') || s.includes('gpt')) {
      return 'claude';
    }
    return 'gemini';
  }

  function resolveProtoFraction(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.remainingFraction === 'number' && Number.isFinite(obj.remainingFraction)) {
      return Math.max(0, Math.min(1, obj.remainingFraction));
    }
    // Protobuf3 JSON 序列化会省略默认零值 0，若存在 resetTime/window/bucketId 说明配额桶存在且已耗尽 (0%)
    if (obj.resetTime || obj.window || obj.bucketId) {
      return 0;
    }
    return null;
  }

  function aggregatePoolsFromConfigs(configs) {
    if (!Array.isArray(configs) || !configs.length) return { gemini: null, claude: null };
    let gemini = null;
    let claude = null;

    for (const c of configs) {
      if (!c || typeof c !== 'object') continue;
      // 拼接 modelId / modelOrAlias.model / label，避免 MODEL_PLACEHOLDER_* 遮蔽真实模型名称
      const id = `${c.modelId || ''} ${c.modelOrAlias?.model || ''} ${c.label || ''}`.toLowerCase();
      const qi = c.quotaInfo || {};
      const frac = resolveProtoFraction(qi);
      const resetTime = qi.resetTime || null;
      if (frac === null && !resetTime) continue;

      if (id.includes('gemini-4') || id.includes('gemini-pro-orchestrator') || id.includes('gemini-3.8-flash')) {
        if (!gemini || (frac !== null && (gemini.remainingFraction === null || frac < gemini.remainingFraction))) {
          gemini = { remainingFraction: frac, resetTime, sampleLabel: c.label || c.modelId || 'Gemini' };
        }
      } else if (id.includes('claude') || id.includes('gpt-oss')) {
        if (!claude || (frac !== null && (claude.remainingFraction === null || frac < claude.remainingFraction))) {
          claude = { remainingFraction: frac, resetTime, sampleLabel: c.label || c.modelId || 'Claude / GPT' };
        }
      }
    }
    return { gemini, claude };
  }

  function parseQuotaSummaryGroups(summaryPayload) {
    const groups = summaryPayload?.response?.groups || summaryPayload?.groups || [];
    const result = {
      gemini: { fiveHour: null, weekly: null },
      claude: { fiveHour: null, weekly: null },
      subGroups: []
    };
    if (!Array.isArray(groups) || !groups.length) return result;

    const pickTighter = (existing, incoming) => {
      if (!existing) return incoming;
      if (!incoming) return existing;
      if (typeof incoming.remainingFraction === 'number') {
        if (existing.remainingFraction === null || existing.remainingFraction === undefined || incoming.remainingFraction < existing.remainingFraction) {
          return incoming;
        }
      }
      return existing;
    };

    for (const grp of groups) {
      if (!grp || typeof grp !== 'object') continue;
      const nameLower = String(grp.displayName || '').toLowerCase();
      const buckets = Array.isArray(grp.buckets) ? grp.buckets : [];
      let targetKey = null;
      if (nameLower.includes('gemini')) {
        targetKey = 'gemini';
      } else if (nameLower.includes('claude') || nameLower.includes('gpt') || nameLower.includes('3p')) {
        targetKey = 'claude';
      } else if (buckets.some((b) => String(b?.bucketId || '').toLowerCase().includes('gemini'))) {
        targetKey = 'gemini';
      } else if (buckets.some((b) => /3p|claude|gpt/i.test(String(b?.bucketId || '')))) {
        targetKey = 'claude';
      }
      if (!targetKey) continue;

      let grpFiveHour = null;
      let grpWeekly = null;
      let grpTightest = null;
      for (const b of buckets) {
        if (!b || typeof b !== 'object') continue;
        const win = String(b.window || '').toLowerCase();
        const bid = String(b.bucketId || '').toLowerCase();
        const frac = resolveProtoFraction(b);
        const resetTime = b.resetTime || null;
        if (frac === null && !resetTime) continue;

        const bucketInfo = { remainingFraction: frac, resetTime };
        grpTightest = pickTighter(grpTightest, bucketInfo);
        if (win === '5h' || bid.includes('5h')) {
          grpFiveHour = pickTighter(grpFiveHour, bucketInfo);
          result[targetKey].fiveHour = pickTighter(result[targetKey].fiveHour, bucketInfo);
        } else if (win === 'weekly' || bid.includes('weekly')) {
          grpWeekly = pickTighter(grpWeekly, bucketInfo);
          result[targetKey].weekly = pickTighter(result[targetKey].weekly, bucketInfo);
        }
      }
      if (grpFiveHour || grpWeekly || grpTightest) {
        result.subGroups.push({
          id: grp.groupId || grp.id || grp.displayName || `${targetKey}-${result.subGroups.length}`,
          displayName: grp.displayName || (targetKey === 'claude' ? 'Claude 5.5 / GPT' : 'Gemini 4 / 3.8'),
          poolKey: targetKey,
          fiveHour: grpFiveHour,
          weekly: grpWeekly,
          remainingFraction: grpTightest ? grpTightest.remainingFraction : null,
          resetTime: grpTightest?.resetTime || grpFiveHour?.resetTime || grpWeekly?.resetTime || null
        });
      }
    }
    return result;
  }

  function mergePoolWithSummary(configPool, summaryItem, fallbackLabel) {
    const fiveHour = summaryItem?.fiveHour || null;
    const weekly = summaryItem?.weekly || null;
    if (!configPool && !fiveHour && !weekly) return null;

    // 顶栏胶囊与池主指标取各有效窗口中剩余比例最低（最紧）的值
    const candidates = [fiveHour, weekly, configPool].filter(
      (item) => item && typeof item.remainingFraction === 'number' && Number.isFinite(item.remainingFraction)
    );
    let tightest = null;
    for (const c of candidates) {
      if (!tightest || c.remainingFraction < tightest.remainingFraction) {
        tightest = c;
      }
    }

    const remainingFraction = tightest
      ? tightest.remainingFraction
      : (configPool?.remainingFraction ?? null);
    const resetTime = tightest?.resetTime || fiveHour?.resetTime || weekly?.resetTime || configPool?.resetTime || null;
    const sampleLabel = configPool?.sampleLabel || fallbackLabel;

    return {
      remainingFraction,
      resetTime,
      sampleLabel,
      fiveHour,
      weekly
    };
  }

  function normalizeCredits(userStatus, historyPlan) {
    let promptCredits = null;
    let flowCredits = null;
    const ps = userStatus?.planStatus;
    if (ps) {
      const availPrompt = ps.availablePromptCredits;
      const monthlyPrompt = ps.planInfo?.monthlyPromptCredits ?? historyPlan?.promptCredits?.monthly ?? null;
      if (typeof availPrompt === 'number') {
        promptCredits = { available: availPrompt, monthly: monthlyPrompt };
      }
      const availFlow = ps.availableFlowCredits;
      const monthlyFlow = ps.planInfo?.monthlyFlowCredits ?? historyPlan?.flowCredits?.monthly ?? null;
      if (typeof availFlow === 'number') {
        flowCredits = { available: availFlow, monthly: monthlyFlow };
      }
    }
    if (!promptCredits && historyPlan?.promptCredits && typeof historyPlan.promptCredits.available === 'number') {
      promptCredits = historyPlan.promptCredits;
    }
    if (!flowCredits && historyPlan?.flowCredits && typeof historyPlan.flowCredits.available === 'number') {
      flowCredits = historyPlan.flowCredits;
    }
    return { promptCredits, flowCredits };
  }

  let quotaFetchInFlight = false;
  async function refreshQuota(options = {}) {
    const silent = Boolean(options && options.silent === true);
    if (disposed || quotaFetchInFlight) return quotaState;
    quotaFetchInFlight = true;
    if (!silent) {
      quotaState.loading = true;
      renderQuotaUI();
    }

    try {
      const csrf = resolveLanguageServerCsrfToken();
      let configs = null;
      let userStatus = null;
      let summaryData = null;

      if (csrf) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const headers = {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': csrf
        };
        try {
          const [statusRes, summaryRes] = await Promise.allSettled([
            fetch('/exa.language_server_pb.LanguageServerService/GetUserStatus', {
              method: 'POST',
              headers,
              body: '{}',
              signal: controller.signal
            }),
            fetch('/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', {
              method: 'POST',
              headers,
              body: '{}',
              signal: controller.signal
            })
          ]);
          if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
            const payload = await statusRes.value.json();
            userStatus = payload?.userStatus || null;
            if (userStatus?.cascadeModelConfigData) {
              cacheDefaultModelFromConfigData(userStatus.cascadeModelConfigData);
            }
            configs = userStatus?.cascadeModelConfigData?.clientModelConfigs || null;
          }
          if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
            summaryData = await summaryRes.value.json();
          }
        } finally {
          clearTimeout(timer);
        }
      }

      const historyRaw = window.__AGContextMeterHistory?.rawPlanStatus || window.__AGContextMeterHistory?.planStatus || null;
      if (!configs || !configs.length) {
        configs = historyRaw?.cascadeModelConfigs || [];
      }

      const configPools = aggregatePoolsFromConfigs(configs);
      const summaryPools = parseQuotaSummaryGroups(summaryData);
      const mergedGemini = mergePoolWithSummary(configPools.gemini, summaryPools.gemini, 'Gemini');
      const mergedClaude = mergePoolWithSummary(configPools.claude, summaryPools.claude, 'Claude / GPT');
      const credits = normalizeCredits(userStatus, historyRaw);

      if (mergedGemini || mergedClaude) {
        quotaState.gemini = mergedGemini;
        quotaState.claude = mergedClaude;
        quotaState.subGroups = Array.isArray(summaryPools.subGroups) ? summaryPools.subGroups : [];
        quotaState.lastFetchedAt = Date.now();
        quotaState.error = '';
      } else if (!quotaState.gemini && !quotaState.claude) {
        quotaState.subGroups = [];
        quotaState.error = '暂无可用配额数据';
      }
      quotaState.promptCredits = credits.promptCredits;
      quotaState.flowCredits = credits.flowCredits;
    } catch (err) {
      // 接口失败时回退本地缓存数据
      const historyRaw = window.__AGContextMeterHistory?.rawPlanStatus || window.__AGContextMeterHistory?.planStatus || null;
      if (!quotaState.gemini && !quotaState.claude && historyRaw?.cascadeModelConfigs?.length) {
        const pools = aggregatePoolsFromConfigs(historyRaw.cascadeModelConfigs);
        quotaState.gemini = pools.gemini;
        quotaState.claude = pools.claude;
        const credits = normalizeCredits(null, historyRaw);
        quotaState.promptCredits = credits.promptCredits;
        quotaState.flowCredits = credits.flowCredits;
      }
      quotaState.error = err?.name === 'AbortError' ? '配额查询超时' : (err?.message || '配额刷新失败');
    } finally {
      quotaFetchInFlight = false;
      quotaState.loading = false;
      quotaState.activeModelText = detectCurrentModelText();
      quotaState.activePoolKey = classifyModelPoolKey(quotaState.activeModelText);
      renderQuotaUI();
    }
    return quotaState;
  }

  function ensureQuotaStylesAndNodes() {
    const { host, sr } = getMeterHostAndShadow();
    if (!host || !sr) return null;

    let styleEl = sr.getElementById(QUOTA_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = QUOTA_STYLE_ID;
      styleEl.textContent = `
        #badge-quota {
          gap: 5px;
          padding: 0 7px;
          font-variant-numeric: tabular-nums;
          color: var(--ag-toolbar-fg, #d4d4d8);
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #badge-quota:hover,
        #badge-quota:focus-visible,
        #badge-quota[aria-expanded="true"] {
          color: var(--ag-toolbar-fg-hover, #ffffff);
        }
        #badge-quota:active:not(:disabled),
        #badge-remote:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        #badge-quota:focus-visible,
        #badge-remote:focus-visible {
          outline: 2px solid var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          outline-offset: 1px;
        }
        :host([data-theme="light"]) #badge-quota:focus-visible,
        :host([data-theme="light"]) #badge-remote:focus-visible {
          outline-color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-quota-dot {
          width: 7px;
          height: 7px;
          border-radius: 9999px;
          flex-shrink: 0;
          background: var(--ag-text-muted, #9ca3af);
          transition: background-color 0.2s ease;
        }
        :host([data-layout="compact"]) #badge-quota {
          padding: 0 5px;
          font-size: 11.5px;
          gap: 4px;
        }
        :host([data-layout="minimal"]) #badge-quota,
        :host([data-layout="ring-only"]) #badge-quota {
          display: none !important;
        }
        @keyframes ag-pop-in {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        #ag-quota-popover {
          position: fixed;
          z-index: 2147483645;
          width: 340px;
          max-width: calc(100vw - 24px);
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--ag-border-panel, var(--ag-float-border, rgba(255, 255, 255, 0.11)));
          background: var(--ag-bg-panel, var(--ag-float-bg, #18181b));
          color: var(--ag-text-primary, #ececef);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), var(--ag-shadow-panel, var(--ag-float-shadow, 0 16px 40px rgba(0, 0, 0, 0.58)));
          font-size: 13px;
          line-height: 1.45;
          font-variant-numeric: tabular-nums;
        }
        #ag-quota-popover:not([hidden]),
        #ag-remote-popover:not([hidden]) {
          animation: ag-pop-in 0.14s cubic-bezier(0.22, 1, 0.36, 1);
        }
        :host([data-theme="light"]) #ag-quota-popover {
          --ag-ring-warn: #b45309;
          --ag-ring-danger: #dc2626;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), var(--ag-shadow-panel, var(--ag-float-shadow, 0 10px 28px rgba(0, 0, 0, 0.10)));
        }
        :host([data-theme="light"]) #ag-remote-popover {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), var(--ag-shadow-panel, var(--ag-float-shadow, 0 10px 28px rgba(0, 0, 0, 0.10)));
        }
        #ag-quota-popover[hidden] {
          display: none !important;
        }
        .ag-qp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
        }
        .ag-qp-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--ag-text-primary, #f4f4f5);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ag-qp-refresh {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 26px;
          padding: 0 8px;
          border-radius: 6px;
          border: 1px solid var(--ag-btn-border, var(--ag-border-subcard, rgba(255, 255, 255, 0.12)));
          background: var(--ag-btn-bg, var(--ag-bg-subcard, rgba(255, 255, 255, 0.04)));
          color: var(--ag-text-primary, #e4e4e7);
          font-size: 12px;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-qp-refresh:hover:not([disabled]) {
          background: var(--ag-btn-hover, var(--ag-toolbar-bg-hover, rgba(255, 255, 255, 0.08)));
        }
        .ag-qp-refresh[disabled] {
          opacity: 0.65;
          cursor: default;
        }
        .ag-qp-refresh:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        .ag-qp-model {
          font-size: 12px;
          color: var(--ag-text-muted, #a1a1aa);
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
        }
        .ag-qp-model > span:first-child {
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ag-qp-model strong {
          color: var(--ag-text-primary, #f4f4f5);
          font-weight: 500;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
        }
        .ag-qp-card {
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--ag-bg-card, var(--ag-bg-subcard, rgba(255, 255, 255, 0.025)));
          border: 1px solid var(--ag-border-card, var(--ag-border-subcard, rgba(255, 255, 255, 0.09)));
          margin-bottom: 8px;
        }
        .ag-qp-card.is-active {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
        }
        .ag-qp-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 5px;
          min-width: 0;
        }
        .ag-qp-pool-name {
          font-size: 12.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
          flex: 1 1 auto;
        }
        .ag-qp-pool-name > span:first-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ag-qp-active-tag {
          font-size: 11.5px;
          font-weight: 500;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          border: 1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          flex-shrink: 0;
        }
        .ag-qp-pct {
          font-size: 13px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ag-qp-bar {
          width: 100%;
          height: 5px;
          border-radius: 9999px;
          background: rgba(127, 127, 127, 0.22);
          overflow: hidden;
          margin-bottom: 5px;
        }
        .ag-qp-bar-fill {
          height: 100%;
          border-radius: 9999px;
          transition: width 0.25s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.2s ease;
        }
        .ag-qp-reset {
          font-size: 11.5px;
          color: var(--ag-text-muted, #a1a1aa);
        }
        .ag-qp-subrows {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 2px;
        }
        .ag-qp-subrow {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .ag-qp-subhead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 12px;
          min-width: 0;
        }
        .ag-qp-sublabel {
          color: var(--ag-text-primary, #e4e4e7);
          font-weight: 500;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ag-qp-subpct {
          font-size: 12.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ag-qp-subrow .ag-qp-bar {
          margin-bottom: 1px;
        }
        .ag-qp-footer {
          margin-top: 6px;
          padding-top: 8px;
          border-top: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 12px;
          color: var(--ag-text-muted, #a1a1aa);
        }
        .ag-qp-credit-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
        }
        .ag-qp-credit-row > span {
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ag-qp-credit-row > strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
        }
        #badge-remote {
          gap: 4px;
          padding: 0 7px;
          font-variant-numeric: tabular-nums;
          color: var(--ag-toolbar-fg, #d4d4d8);
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #badge-remote[data-online="true"] {
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
        }
        :host([data-theme="light"]) #badge-remote[data-online="true"] {
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        #badge-remote .ag-remote-dot {
          display: none;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          flex-shrink: 0;
        }
        :host([data-theme="light"]) #badge-remote .ag-remote-dot {
          background: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        #badge-remote[data-online="true"] .ag-remote-dot {
          display: inline-block;
        }
        #badge-remote:hover,
        #badge-remote:focus-visible,
        #badge-remote[aria-expanded="true"] {
          color: var(--ag-toolbar-fg-hover, #ececef);
        }
        :host([data-theme="light"]) #badge-remote:hover,
        :host([data-theme="light"]) #badge-remote:focus-visible,
        :host([data-theme="light"]) #badge-remote[aria-expanded="true"] {
          color: var(--ag-toolbar-fg-hover, #18181b);
        }
        :host([data-layout="compact"]) #badge-remote {
          padding: 0 5px;
          font-size: 11.5px;
          gap: 3px;
        }
        :host([data-layout="ring-only"]) #badge-remote {
          padding: 0 5px;
        }
        :host([data-layout="ring-only"]) #badge-remote .ag-remote-text {
          display: none;
        }
        #ag-remote-popover {
          position: fixed;
          z-index: 2147483645;
          width: 340px;
          max-width: calc(100vw - 24px);
          box-sizing: border-box;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--ag-border-panel, var(--ag-float-border, rgba(255, 255, 255, 0.11)));
          background: var(--ag-bg-panel, var(--ag-float-bg, #18181b));
          color: var(--ag-text-primary, #ececef);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), var(--ag-shadow-panel, var(--ag-float-shadow, 0 16px 40px rgba(0, 0, 0, 0.58)));
          font-size: 13px;
          line-height: 1.45;
          font-variant-numeric: tabular-nums;
        }
        #ag-remote-popover[hidden] {
          display: none !important;
        }
        .ag-rp-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          display: inline-block;
        }
        .ag-rp-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.4;
          color: var(--ag-text-primary, #e4e4e7);
          text-align: center;
          margin: 2px 0 8px;
        }
        .ag-rp-status.is-error {
          color: var(--ag-ring-danger, #ef4444);
        }
        :host([data-theme="light"]) .ag-rp-status.is-error {
          color: var(--ag-ring-danger, #dc2626);
        }
        .ag-rp-qr {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          border-radius: 8px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
          background: #ffffff;
          margin: 4px auto 12px;
          width: fit-content;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
        }
        :host([data-theme="light"]) .ag-rp-qr {
          border-color: var(--ag-border-subcard, rgba(0, 0, 0, 0.09));
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }
        .ag-rp-qr svg {
          display: block;
          width: 196px;
          height: 196px;
        }
        .ag-rp-channels {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin: 0 0 10px;
        }
        .ag-rp-channel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
          padding: 6px 8px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--ag-text-primary, #e4e4e7);
          font-size: 12.5px;
          line-height: 1.3;
          text-align: left;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-channel:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        .ag-rp-channel[aria-checked="false"] {
          opacity: 0.68;
        }
        .ag-rp-channel[disabled] {
          opacity: 0.45;
          cursor: default;
        }
        .ag-rp-channel:not([disabled]):hover {
          background: var(--ag-btn-hover, rgba(255, 255, 255, 0.08));
          opacity: 1;
        }
        .ag-rp-channel[data-selected="true"] {
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          font-weight: 500;
        }
        :host([data-theme="light"]) .ag-rp-channel:not([disabled]):hover {
          background: var(--ag-btn-hover, rgba(0, 0, 0, 0.06));
        }
        :host([data-theme="light"]) .ag-rp-channel[data-selected="true"] {
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-ch-left {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ag-rp-check-box {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--ag-text-muted, #a1a1aa);
          flex-shrink: 0;
        }
        .ag-rp-ch-host {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11.5px;
          color: var(--ag-text-muted, #a1a1aa);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .ag-rp-channel-wrap {
          display: flex;
          align-items: center;
          gap: 4px;
          border-radius: 6px;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-channel-wrap .ag-rp-channel {
          flex: 1 1 auto;
          min-width: 0;
        }
        .ag-rp-channel-tools {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding-right: 4px;
          flex-shrink: 0;
        }
        .ag-rp-mini-btn {
          padding: 3px 7px;
          border-radius: 6px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.14));
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.06));
          color: var(--ag-text-primary, #e4e4e7);
          font-size: 10.5px;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-mini-btn:hover:not([disabled]) {
          background: rgba(255, 255, 255, 0.14);
        }
        :host([data-theme="light"]) .ag-rp-mini-btn:hover:not([disabled]) {
          background: var(--ag-btn-hover, rgba(0, 0, 0, 0.06));
        }
        .ag-rp-mini-btn:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        .ag-rp-mini-btn[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
        }
        :host([data-theme="light"]) .ag-rp-mini-btn[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-mini-btn[disabled] {
          opacity: 0.5;
          cursor: default;
        }
        @keyframes ag-rp-spin {
          to { transform: rotate(360deg); }
        }
        .ag-rp-spin {
          display: inline-block;
          width: 11px;
          height: 11px;
          border: 1.8px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: ag-rp-spin 0.65s linear infinite;
          vertical-align: -1.5px;
          margin-right: 4px;
          flex-shrink: 0;
        }
        .ag-rp-tunnel-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 10px;
          margin: 2px 0 8px;
          border-radius: 8px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.1));
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.04));
        }
        .ag-rp-tunnel-head {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .ag-rp-tunnel-note {
          font-size: 10.5px;
          color: var(--ag-text-muted, #a1a1aa);
          line-height: 1.35;
        }
        .ag-rp-cf-link {
          display: inline-flex;
          align-items: center;
          align-self: flex-start;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          font-size: 10.5px;
          font-weight: 500;
          line-height: 1.3;
          text-decoration: none;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-cf-link:hover {
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
        }
        .ag-rp-cf-link:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        :host([data-theme="light"]) .ag-rp-cf-link {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        :host([data-theme="light"]) .ag-rp-cf-link:hover {
          background: var(--ag-accent-bg-hover, rgba(124, 58, 237, 0.18));
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
        }
        .ag-rp-input {
          width: 100%;
          box-sizing: border-box;
          padding: 5px 8px;
          border-radius: 6px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.14));
          background: var(--ag-bg-input, rgba(0, 0, 0, 0.28));
          color: var(--ag-text-primary, #f4f4f5);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
        }
        :host([data-theme="light"]) .ag-rp-input {
          background: var(--ag-bg-input, rgba(0, 0, 0, 0.04));
          border-color: var(--ag-border-subcard, rgba(0, 0, 0, 0.14));
          color: var(--ag-text-primary, #18181b);
        }
        .ag-rp-input:focus {
          border-color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
        }
        :host([data-theme="light"]) .ag-rp-input:focus {
          border-color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-err {
          font-size: 10.5px;
          color: var(--ag-ring-danger, #ef4444);
          line-height: 1.35;
          margin: 0 0 6px;
        }
        :host([data-theme="light"]) .ag-rp-err {
          color: var(--ag-ring-danger, #dc2626);
        }
        .ag-rp-hint {
          font-size: 11px;
          color: var(--ag-text-muted, #a1a1aa);
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.04));
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
          border-radius: 6px;
          padding: 5px 8px;
          line-height: 1.4;
          margin: 0 0 8px;
        }
        :host([data-theme="light"]) .ag-rp-hint {
          color: var(--ag-text-muted, #52525b);
          background: rgba(15, 23, 42, 0.035);
          border-color: rgba(15, 23, 42, 0.1);
        }
        .ag-rp-sec {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          font-size: 11.5px;
          color: var(--ag-text-muted, #a1a1aa);
          margin: 0 0 10px;
          text-align: center;
        }
        .ag-rp-sec[data-active="true"] {
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          font-weight: 600;
        }
        :host([data-theme="light"]) .ag-rp-sec[data-active="true"] {
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-devices {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 5px;
          margin: -4px 0 10px;
        }
        .ag-rp-dev-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 11.5px;
          line-height: 1.35;
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.04));
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
          color: var(--ag-text-primary, #e4e4e7);
        }
        .ag-rp-dev-dot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: var(--ag-text-muted, #a1a1aa);
          flex-shrink: 0;
        }
        .ag-rp-dev-chip[data-online="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
        }
        .ag-rp-dev-chip[data-online="true"] .ag-rp-dev-dot {
          background: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
        }
        :host([data-theme="light"]) .ag-rp-dev-chip {
          background: var(--ag-bg-subcard, rgba(0, 0, 0, 0.035));
          border-color: var(--ag-border-subcard, rgba(0, 0, 0, 0.09));
        }
        :host([data-theme="light"]) .ag-rp-dev-chip[data-online="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
        }
        :host([data-theme="light"]) .ag-rp-dev-chip[data-online="true"] .ag-rp-dev-dot {
          background: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-actions {
          display: flex;
          gap: 8px;
        }
        .ag-rp-btn {
          flex: 1 1 0;
          min-width: 0;
          min-height: 32px;
          height: auto;
          padding: 5px 10px;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          white-space: nowrap;
          border-radius: 6px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.12));
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.04));
          color: var(--ag-text-primary, #f4f4f5);
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-btn:hover:not([disabled]) {
          background: var(--ag-toolbar-bg-hover, rgba(255, 255, 255, 0.08));
        }
        .ag-rp-btn:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        .ag-rp-btn[data-primary="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
        }
        :host([data-theme="light"]) .ag-rp-btn[data-primary="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-readonly-summary {
          display: flex;
          flex-direction: column;
          gap: 5px;
          margin: 0 0 10px;
        }
        .ag-rp-ch-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 5px 9px;
          border-radius: 6px;
          border: 1px solid var(--ag-border-subcard, rgba(255, 255, 255, 0.08));
          background: var(--ag-bg-subcard, rgba(255, 255, 255, 0.035));
          font-family: inherit;
          font-size: 12px;
          color: var(--ag-text-primary, #e4e4e7);
          text-align: left;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ag-rp-ch-pill > span:first-child {
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ag-rp-ch-pill:hover:not([disabled]):not([data-available="false"]) {
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
        }
        .ag-rp-ch-pill:active:not(:disabled):not([data-available="false"]) {
          transform: scale(0.975) translateY(0.5px);
        }
        .ag-rp-ch-pill[data-available="false"],
        .ag-rp-ch-pill[disabled] {
          opacity: 0.62;
          cursor: not-allowed;
        }
        .ag-rp-ch-pill[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          font-weight: 500;
        }
        :host([data-theme="light"]) .ag-rp-ch-pill[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        .ag-rp-ch-pill-host {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          color: var(--ag-text-muted, #a1a1aa);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          text-align: right;
        }
        .ag-rp-tip {
          margin-top: 8px;
          font-size: 11.5px;
          color: var(--ag-text-muted, #a1a1aa);
          line-height: 1.4;
        }
        .ag-qp-refresh:focus-visible,
        .ag-rp-channel:focus-visible,
        .ag-rp-mini-btn:focus-visible,
        .ag-rp-cf-link:focus-visible,
        .ag-rp-btn:focus-visible,
        .ag-rp-ch-pill:focus-visible,
        .ag-rp-input:focus-visible {
          outline: 2px solid var(--ag-custom-token-accent, var(--ag-token-accent-default, #a78bfa));
          outline-offset: 2px;
        }
        :host([data-theme="light"]) .ag-qp-refresh:focus-visible,
        :host([data-theme="light"]) .ag-rp-channel:focus-visible,
        :host([data-theme="light"]) .ag-rp-mini-btn:focus-visible,
        :host([data-theme="light"]) .ag-rp-cf-link:focus-visible,
        :host([data-theme="light"]) .ag-rp-btn:focus-visible,
        :host([data-theme="light"]) .ag-rp-ch-pill:focus-visible,
        :host([data-theme="light"]) .ag-rp-input:focus-visible {
          outline-color: var(--ag-custom-token-accent, var(--ag-token-accent-default, #7c3aed));
        }
        @supports (corner-shape: superellipse(1.25)) {
          #ag-quota-popover,
          #ag-remote-popover,
          .ag-qp-card,
          .ag-rp-qr,
          .ag-rp-tunnel-form {
            corner-shape: superellipse(1.25);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `;
      sr.appendChild(styleEl);
    }

    const contextBadge = sr.getElementById('badge');
    let remoteBtn = sr.getElementById(REMOTE_BADGE_ID);
    if (!remoteBtn && contextBadge) {
      remoteBtn = document.createElement('button');
      remoteBtn.id = REMOTE_BADGE_ID;
      remoteBtn.className = 'ag-unit';
      remoteBtn.type = 'button';
      remoteBtn.setAttribute('aria-label', tr('手机远程操作配对', 'Mobile Remote Pairing'));
      remoteBtn.setAttribute('aria-expanded', 'false');
      remoteBtn.title = tr('手机远程操作配对（局域网 / Tailscale / Cloudflare）', 'Mobile Remote Pairing (LAN / Tailscale / Cloudflare)');
      remoteBtn.innerHTML = `<span class="ag-remote-icon">📱</span><span class="ag-remote-dot"></span><span class="ag-remote-text">${escapeHtml(tr('远程', 'Remote'))}</span>`;
      contextBadge.insertAdjacentElement('beforebegin', remoteBtn);

      remoteBtn.addEventListener('click', onRemoteBtnClick);
    }
    if (remoteBtn) remoteBtn.hidden = featureFlags.showTopbarRemote === false;

    let quotaBtn = sr.getElementById(QUOTA_BADGE_ID);
    const anchorBadge = contextBadge;
    if (!quotaBtn && anchorBadge) {
      quotaBtn = document.createElement('button');
      quotaBtn.id = QUOTA_BADGE_ID;
      quotaBtn.className = 'ag-unit';
      quotaBtn.type = 'button';
      quotaBtn.setAttribute('aria-label', tr('模型剩余配额', 'Model Quota'));
      quotaBtn.setAttribute('aria-expanded', 'false');
      quotaBtn.title = tr('查看 Gemini / Claude 模型剩余配额与重置倒计时', 'View Gemini / Claude remaining quota & reset countdown');
      quotaBtn.innerHTML = `<span id="ag-quota-dot" class="ag-quota-dot"></span><span id="ag-quota-text">${escapeHtml(tr('配额 --%', 'Quota --%'))}</span>`;
      anchorBadge.insertAdjacentElement('afterend', quotaBtn);

      quotaBtn.addEventListener('click', onQuotaBtnClick);
    } else if (
      quotaBtn &&
      contextBadge &&
      typeof quotaBtn.previousElementSibling !== 'undefined' &&
      quotaBtn.previousElementSibling !== contextBadge &&
      typeof contextBadge.insertAdjacentElement === 'function'
    ) {
      contextBadge.insertAdjacentElement('afterend', quotaBtn);
    }
    if (quotaBtn) quotaBtn.hidden = featureFlags.showTopbarQuota === false;

    let popover = sr.getElementById(QUOTA_POPOVER_ID);
    if (!popover) {
      popover = document.createElement('div');
      popover.id = QUOTA_POPOVER_ID;
      popover.hidden = true;
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', tr('模型剩余配额详情', 'Model Quota Details'));
      popover.addEventListener('click', (e) => e.stopPropagation());
      sr.appendChild(popover);
    }

    let remotePopover = sr.getElementById(REMOTE_POPOVER_ID);
    if (!remotePopover) {
      remotePopover = document.createElement('div');
      remotePopover.id = REMOTE_POPOVER_ID;
      remotePopover.hidden = true;
      remotePopover.setAttribute('role', 'dialog');
      remotePopover.setAttribute('aria-label', tr('手机远程操作配对', 'Mobile Remote Pairing'));
      remotePopover.addEventListener('click', (e) => e.stopPropagation());
      sr.appendChild(remotePopover);
    }

    return { host, sr, remoteBtn, quotaBtn, popover, remotePopover };
  }

  function updateRemoteBtnLanguage(opts = {}) {
    const { sr } = getMeterHostAndShadow();
    if (!sr) return;
    const pairedCount = Math.max(0, Number(remotePairState.data?.pairedCount || 0));
    const onlineCount = Math.max(0, Number(remotePairState.data?.onlineCount || 0));
    const remoteBtn = sr.getElementById(REMOTE_BADGE_ID);
    if (remoteBtn) {
      remoteBtn.setAttribute('aria-label', tr('手机远程操作配对', 'Mobile Remote Pairing'));
      const baseTitle = tr('手机远程操作配对（局域网 / Tailscale / Cloudflare）', 'Mobile Remote Pairing (LAN / Tailscale / Cloudflare)');
      const countTitle = pairedCount > 0
        ? tr(`\n已关联 ${pairedCount} 台设备（${onlineCount} 台在线）`, `\n${pairedCount} paired (${onlineCount} online)`, `\n已配對 ${pairedCount} 台裝置（${onlineCount} 台在線上）`)
        : '';
      remoteBtn.title = `${baseTitle}${countTitle}`;
      if (pairedCount > 0) {
        remoteBtn.setAttribute('data-paired', String(pairedCount));
        remoteBtn.setAttribute('data-online', onlineCount > 0 ? 'true' : 'false');
      } else {
        remoteBtn.removeAttribute('data-paired');
        remoteBtn.removeAttribute('data-online');
      }
      const textSpan = remoteBtn.querySelector?.('.ag-remote-text');
      if (textSpan) {
        textSpan.textContent = pairedCount > 0
          ? tr(`远程 · ${pairedCount}`, `Remote · ${pairedCount}`)
          : tr('远程', 'Remote');
      }
    }
    const remotePopover = sr.getElementById(REMOTE_POPOVER_ID);
    if (remotePopover) {
      remotePopover.setAttribute('aria-label', tr('手机远程操作配对', 'Mobile Remote Pairing'));
      if (!opts?.skipRender && remotePopoverOpen) renderRemotePopoverContent(remotePopover);
    }
  }

  function positionQuotaPopover() {
    const { sr } = getMeterHostAndShadow();
    if (!sr) return;
    const btn = sr.getElementById(QUOTA_BADGE_ID);
    const popover = sr.getElementById(QUOTA_POPOVER_ID);
    if (!btn || !popover || popover.hidden) return;

    try {
      const bRect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const popW = Math.min(320, vw - 24);
      const popH = Math.max(240, Math.round(popover.offsetHeight || 300));
      const top = Math.max(36, Math.min(vh - popH - 12, Math.round(bRect.bottom + 6)));
      // 右边缘优先对齐触发按钮，与顶栏其他面板对齐行为保持一致
      let left = Math.round(bRect.right - popW);
      left = Math.max(12, Math.min(vw - popW - 12, left));
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.width = `${popW}px`;
    } catch {}
  }

  function positionRemotePopover() {
    const { sr } = getMeterHostAndShadow();
    if (!sr) return;
    const btn = sr.getElementById(REMOTE_BADGE_ID);
    const popover = sr.getElementById(REMOTE_POPOVER_ID);
    if (!btn || !popover || popover.hidden) return;

    try {
      const bRect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const popW = Math.min(340, vw - 24);
      const popH = Math.max(260, Math.round(popover.offsetHeight || 360));
      const top = Math.max(36, Math.min(vh - popH - 12, Math.round(bRect.bottom + 6)));
      let left = Math.round(bRect.right - popW);
      left = Math.max(12, Math.min(vw - popW - 12, left));
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.width = `${popW}px`;
    } catch {}
  }

  function extractUrlHostSafe(rawUrl) {
    try {
      return new URL(String(rawUrl || '')).hostname || '';
    } catch {
      return '';
    }
  }

  function resolveRemoteEndpoint(data) {
    if (!data) return null;
    const tsList = Array.isArray(data.tailscaleUrls) ? data.tailscaleUrls : [];
    const lanList = Array.isArray(data.lanUrls) ? data.lanUrls : [];

    let channels = Array.isArray(data.channels) && data.channels.length
      ? data.channels.map((ch) => ({ ...ch }))
      : [
          {
            key: 'lan',
            label: '局域网',
            labelEn: 'LAN',
            enabled: data.enabledChannels?.lan !== false,
            available: (data.enabledChannels?.lan !== false) && lanList.length > 0,
            rawHost: extractUrlHostSafe(lanList[0]?.url),
            displayHost: extractUrlHostSafe(lanList[0]?.url),
            url: lanList[0]?.url || '',
            qrSvg: lanList[0]?.qrSvg || ''
          },
          {
            key: 'tailscale',
            label: 'Tailscale',
            labelEn: 'Tailscale',
            enabled: data.enabledChannels?.tailscale !== false,
            available: (data.enabledChannels?.tailscale !== false) && tsList.length > 0,
            rawHost: data.tailscaleDnsName || extractUrlHostSafe(tsList[0]?.url),
            displayHost: data.tailscaleDnsName || extractUrlHostSafe(tsList[0]?.url),
            url: tsList[0]?.url || '',
            qrSvg: tsList[0]?.qrSvg || ''
          },
          {
            key: 'bonjour',
            label: 'Bonjour',
            labelEn: 'Bonjour',
            enabled: data.enabledChannels?.bonjour !== false,
            available: (data.enabledChannels?.bonjour !== false) && Boolean(data.bonjourHost && lanList.length > 0),
            rawHost: data.bonjourHost || '',
            displayHost: data.bonjourHost || '',
            url: data.fusedUrl || data.primaryUrl || lanList[0]?.url || '',
            qrSvg: data.qrSvg || lanList[0]?.qrSvg || ''
          }
        ];

    const switchingTunnelMode = Boolean(
      remotePairState.tunnelBusy
      && (remotePairState.tunnelPendingAction === 'quick' || remotePairState.tunnelPendingAction === 'named')
    );
    if (switchingTunnelMode) {
      channels = channels.map((ch) => (ch.key === 'tunnel'
        ? { ...ch, available: false, url: '', qrSvg: '', rawHost: '', entryHost: '', entryBaseUrl: '' }
        : ch));
    }

    const availableList = channels.filter((c) => (c.enabled !== false) && c.available && c.url);
    const preferredChannel = remotePairState.selectedChannelKey
      ? availableList.find((c) => c.key === remotePairState.selectedChannelKey)
      : null;
    const isTsHttpsCh = (c) => Boolean(
      c && c.key === 'tailscale' && c.available
      && (c.httpsUrl || (c.entryBaseUrl && String(c.entryBaseUrl).startsWith('https://')) || String(c.url || '').startsWith('https://'))
    );
    const activeChannel = preferredChannel
      || availableList.find((c) => c.key === 'tunnel' && c.available && c.mode === 'named')
      || availableList.find((c) => isTsHttpsCh(c))
      || availableList.find((c) => c.key === 'lan')
      || availableList.find((c) => c.key === 'tailscale')
      || availableList.find((c) => c.key === 'tunnel')
      || availableList[0]
      || null;

    const activeUrl = availableList.length > 0
      ? (activeChannel?.url || (!switchingTunnelMode ? (data.fusedUrl || data.primaryUrl || '') : ''))
      : '';
    const activeQr = availableList.length > 0
      ? (activeChannel?.qrSvg || (!switchingTunnelMode ? (data.qrSvg || '') : ''))
      : '';

    return {
      channels,
      activeChannel,
      activeKey: activeChannel?.key || 'none',
      activeUrl,
      activeQr
    };
  }

  function formatRemoteDeviceChannel(ch) {
    if (ch === 'tunnel') return 'Cloudflare';
    if (ch === 'tailscale') return 'Tailscale';
    if (ch === 'bonjour') return 'Bonjour';
    if (ch === 'loopback') return tr('本机', 'Local');
    return tr('局域网', 'LAN');
  }

  function formatRemoteDeviceTime(dev) {
    if (dev?.online) return tr('在线', 'Online');
    const sec = Math.max(1, Math.round((Date.now() - Number(dev?.lastSeenAt || 0)) / 1000));
    if (sec < 60) return tr('刚刚', 'Just now');
    const mins = Math.round(sec / 60);
    if (mins < 60) return tr(`${mins}分钟前`, `${mins}m ago`);
    const hrs = Math.round(mins / 60);
    return tr(`${hrs}小时前`, `${hrs}h ago`);
  }

  function scheduleTunnelStartingPoll() {
    if (remotePairState.tunnelPollTimer) {
      clearTimeout(remotePairState.tunnelPollTimer);
      remotePairState.tunnelPollTimer = null;
    }
    if (!remotePopoverOpen || disposed) return;
    const chs = remotePairState.data?.channels;
    const tunnelCh = Array.isArray(chs) ? chs.find((c) => c.key === 'tunnel') : null;
    if (tunnelCh?.state === 'starting') {
      remotePairState.tunnelPollTimer = setTimeout(() => {
        remotePairState.tunnelPollTimer = null;
        if (remotePopoverOpen && !disposed) void refreshRemotePairInfo(false);
      }, 1500);
    }
  }

  async function configureRemoteTunnel(payload = {}) {
    if (disposed || remotePairState.tunnelBusy) return remotePairState;
    remotePairState.tunnelBusy = true;
    remotePairState.tunnelPendingAction = payload.tunnelMode === 'quick'
      ? 'quick'
      : (payload.tunnelMode === 'named' ? 'named' : 'toggle');
    remotePairState.error = '';
    const nodes = ensureQuotaStylesAndNodes();
    if (remotePopoverOpen && nodes?.remotePopover) {
      renderRemotePopoverContent(nodes.remotePopover);
      positionRemotePopover();
    }
    try {
      const res = await postToLiveHost('/remote-tunnel', payload);
      if (res && res.ok && res.data) {
        remotePairState.data = res.data;
        const chs = Array.isArray(res.data.channels) ? res.data.channels : [];
        const tch = chs.find((c) => c.key === 'tunnel');
        const hasErr = Boolean(tch?.error || tch?.state === 'error');
        if (payload.tunnelMode === 'named') {
          if (!hasErr) {
            remotePairState.tunnelConfigOpen = false;
            remotePairState.draftHost = null;
            remotePairState.draftToken = '';
          } else {
            remotePairState.tunnelConfigOpen = true;
          }
        } else if (payload.tunnelMode === 'quick') {
          if (!hasErr) {
            remotePairState.tunnelConfigOpen = false;
            remotePairState.draftHost = null;
            remotePairState.draftToken = '';
          }
        }
        const toggledNonTunnel = payload.enabledChannels && typeof payload.enabledChannels === 'object'
          ? Object.entries(payload.enabledChannels).find(([k]) => k !== 'tunnel')
          : null;
        if (toggledNonTunnel) {
          const [chKey, chOn] = toggledNonTunnel;
          const chMeta = chs.find((c) => c.key === chKey);
          const chLabel = chMeta ? tr(chMeta.label || chKey, chMeta.labelEn || chKey) : chKey;
          showQuickToast(chOn
            ? tr(`已启用 ${chLabel}`, `Enabled ${chLabel}`)
            : tr(`已停用 ${chLabel}`, `Disabled ${chLabel}`));
        } else if (payload.tunnelMode === 'quick' && tch?.available) {
          showQuickToast(tr('已切换至免登录临时隧道，4G/5G 可直接扫码', 'Switched to Quick Tunnel'));
        } else if (tch?.available) {
          showQuickToast(tr('Cloudflare 公网隧道已就绪，4G/5G 可直接扫码', 'Cloudflare Tunnel ready for any network'));
        } else if (payload.enabled === false || payload.enabledChannels?.tunnel === false) {
          showQuickToast(tr('已停用 Cloudflare 公网隧道', 'Cloudflare Tunnel disabled'));
        } else if (tch?.state === 'starting') {
          showQuickToast(tr('公网隧道正在启动中，请稍候数秒…', 'Starting Cloudflare Tunnel…'));
        } else if (tch?.error) {
          showQuickToast(tch.error);
        }
      } else {
        remotePairState.error = res?.error || tr('更新远程通道配置失败', 'Failed to update remote channels');
        if (payload.tunnelMode === 'named') remotePairState.tunnelConfigOpen = true;
      }
    } catch (err) {
      remotePairState.error = err?.message || tr('配置 Cloudflare 隧道失败', 'Failed to configure Cloudflare Tunnel');
      if (payload.tunnelMode === 'named') remotePairState.tunnelConfigOpen = true;
    } finally {
      remotePairState.tunnelBusy = false;
      remotePairState.tunnelPendingAction = '';
      updateRemoteBtnLanguage({ skipRender: true });
      const curNodes = ensureQuotaStylesAndNodes();
      if (remotePopoverOpen && curNodes?.remotePopover) {
        renderRemotePopoverContent(curNodes.remotePopover);
        positionRemotePopover();
      }
      scheduleTunnelStartingPoll();
    }
    return remotePairState;
  }

  function renderRemotePopoverContent(popover) {
    if (!popover) return;
    const ep = resolveRemoteEndpoint(remotePairState.data);
    const copiedRecent = Date.now() - remotePairState.copiedAt < 2000;
    const pairedDevices = Array.isArray(remotePairState.data?.pairedDevices) ? remotePairState.data.pairedDevices : [];
    const pairedCount = Math.max(pairedDevices.length, Number(remotePairState.data?.pairedCount || 0));
    const onlineCount = Math.max(0, Number(remotePairState.data?.onlineCount || 0));
    const busyAny = remotePairState.loading || remotePairState.tunnelBusy;
    let bodyHtml = '';

    if (remotePairState.loading && !remotePairState.data) {
      bodyHtml = `<div class="ag-rp-status"><span class="ag-rp-spin" aria-hidden="true"></span><span>${escapeHtml(tr('正在生成配对二维码…', 'Generating pairing QR…'))}</span></div>`;
    } else if (!remotePairState.data) {
      bodyHtml = `<div class="ag-rp-status is-error">${escapeHtml(remotePairState.error || tr('未能连接到本地配对服务', 'Failed to connect to local pairing service'))}</div>`;
    } else {
      const safeQr = (ep.activeQr && ep.activeQr.startsWith('<svg') && !/<script/i.test(ep.activeQr))
        ? ep.activeQr
        : '';
      const tunnelCh = ep.channels.find((c) => c.key === 'tunnel') || null;
      const tailscaleCh = ep.channels.find((c) => c.key === 'tailscale') || null;
      const tsHttpsHintText = (
        tailscaleCh
        && tailscaleCh.enabled !== false
        && !tailscaleCh.httpsUrl
        && !remotePairState.data?.tailscaleHttpsUrl
      )
        ? String(tailscaleCh.httpsHint || remotePairState.data?.tailscaleHttpsHint || '').trim()
        : '';
      const enabledChannels = ep.channels.filter((ch) => (
        ch.key === 'tunnel'
          ? Boolean(ch.enabled || ch.state === 'running' || ch.state === 'starting')
          : (ch.enabled !== false)
      ));
      const activeSummaryHtml = enabledChannels.length > 0
        ? `<div class="ag-rp-readonly-summary">${enabledChannels.map((ch) => {
            const label = tr(ch.label || ch.key, ch.labelEn || ch.label || ch.key, ch.key === 'tunnel' ? 'Cloudflare 隧道' : undefined);
            const canSelect = Boolean((ch.enabled !== false) && ch.available && ch.url);
            const hostVal = (ch.key === 'tunnel' && !ch.available && ch.state === 'starting')
              ? (ch.displayHost || tr('正在分配公网隧道…', 'Provisioning Tunnel…'))
              : (ch.displayHost || (ch.available ? '' : tr('未连接', 'Offline')));
            const titleText = canSelect
              ? tr(`点击切换为 ${label} 二维码与链接`, `Click to switch QR & link to ${label}`)
              : tr('当前通道暂不可用', 'Channel currently unavailable');
            return `<button type="button" class="ag-rp-ch-pill" data-ch-key="${escapeHtml(ch.key)}" data-active="${ep.activeKey === ch.key ? 'true' : 'false'}" data-available="${canSelect ? 'true' : 'false'}" title="${escapeHtml(titleText)}" ${canSelect ? '' : 'disabled'}><span>${escapeHtml(label)}</span>${hostVal ? `<span class="ag-rp-ch-pill-host">${escapeHtml(hostVal)}</span>` : ''}</button>`;
          }).join('')}</div>`
        : '';

      const errHtml = (tunnelCh?.error || remotePairState.error)
        ? `<div class="ag-rp-err">${escapeHtml(tunnelCh?.error || remotePairState.error)}</div>`
        : '';
      const tsHintHtml = tsHttpsHintText
        ? `<div id="ag-rp-ts-hint" class="ag-rp-hint">${escapeHtml(tsHttpsHintText)}</div>`
        : '';
      const showQuickTunnelHint = Boolean(
        ep.activeKey === 'tunnel'
        && tunnelCh
        && tunnelCh.mode !== 'named'
        && (tunnelCh.available || tunnelCh.state === 'running' || tunnelCh.state === 'starting')
      );
      const quickTunnelHintHtml = showQuickTunnelHint
        ? `<div id="ag-rp-quick-tunnel-hint" class="ag-rp-hint">${escapeHtml(tr(
          '提示：免登录临时隧道域名为一次性地址，电脑热更新、live 重载、重启或休眠断网后旧网址会永久失效并更换新域名；长期使用建议优先选 Tailscale HTTPS，或在「远程设置」绑定固定域名。',
          'Note: Quick Tunnel uses a one-time URL that permanently expires on live reload, restart, or sleep. For a permanent URL, prefer Tailscale HTTPS or bind a fixed domain in Remote Settings.'
        ))}</div>`
        : '';

      const statusText = pairedCount > 0
        ? tr(`已关联 ${pairedCount} 台设备（${onlineCount} 台在线）`, `${pairedCount} paired (${onlineCount} online)`, `已配對 ${pairedCount} 台裝置（${onlineCount} 台在線上）`)
        : (ep.activeKey === 'tunnel'
            ? tr('口令保护 · 已启用公网 HTTPS 隧道 · 暂未关联设备', 'Token protected · Public HTTPS tunnel · No paired devices yet', '配對碼保護 · 已啟用公開 HTTPS 隧道 · 尚無已配對裝置')
            : tr('内网口令保护 · 暂未关联设备', 'Token protected · No paired devices yet', '區域網路配對碼保護 · 尚無已配對裝置'));
      const devicesHtml = pairedDevices.length > 0
        ? `<div class="ag-rp-devices">${pairedDevices.slice(0, 6).map((d) => {
            const devLabel = escapeHtml(d?.label || tr('移动设备', 'Mobile'));
            const devCh = escapeHtml(formatRemoteDeviceChannel(d?.channel));
            const devTime = escapeHtml(formatRemoteDeviceTime(d));
            return `<span class="ag-rp-dev-chip" data-online="${d?.online ? 'true' : 'false'}"><span class="ag-rp-dev-dot"></span><span>${devLabel} (${devCh} · ${devTime})</span></span>`;
          }).join('')}${pairedDevices.length > 6 ? `<span class="ag-rp-dev-chip">+${pairedDevices.length - 6}</span>` : ''}</div>`
        : '';

      const qrOrEmptyHtml = safeQr
        ? `<div class="ag-rp-qr">${safeQr}</div>`
        : `<div class="ag-rp-status">${escapeHtml(tr('未启用任何连接方式，请在统一设置中开启', 'No active channels — enable one in Suite Settings'))}</div>`;

      bodyHtml = `
        ${qrOrEmptyHtml}
        ${activeSummaryHtml}
        ${tsHintHtml}${quickTunnelHintHtml}
        ${errHtml}
        <div class="ag-rp-sec" data-active="${onlineCount > 0 ? 'true' : 'false'}">${LOCK_SHIELD_SVG}<span>${escapeHtml(statusText)}</span></div>
        ${devicesHtml}
        <div class="ag-rp-actions">
          <button id="ag-remote-copy" class="ag-rp-btn" data-primary="true" type="button" ${ep.activeUrl ? '' : 'disabled'}>${escapeHtml(copiedRecent ? tr('已复制链接', 'Copied') : tr('复制链接', 'Copy Link'))}</button>
        </div>
        <div class="ag-rp-tip">${escapeHtml(tr('通道、隧道与重置密钥请在顶栏设置面板的「远程设置」中管理。', 'Manage channels, tunnel, and token reset in Suite Settings → Remote.', '連線方式、Cloudflare 隧道與金鑰重設可在頂欄設定面板的「遠端設定」管理。'))}</div>
      `;
    }

    popover.innerHTML = `
      <div class="ag-qp-header">
        <span class="ag-qp-title">${escapeHtml(tr('手机远程操作配对', 'Mobile Remote Pairing'))}</span>
        <button id="ag-remote-refresh" class="ag-qp-refresh" type="button" ${busyAny ? 'disabled' : ''}>${busyAny ? `<span class="ag-rp-spin" aria-hidden="true"></span>${escapeHtml(tr('刷新中…', 'Refreshing…'))}` : escapeHtml(tr('↻ 刷新', '↻ Refresh'))}</button>
      </div>
      ${bodyHtml}
    `;

    popover.querySelector('#ag-remote-refresh')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void refreshRemotePairInfo(false);
    });
    popover.querySelectorAll('.ag-rp-ch-pill').forEach((pillBtn) => {
      pillBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const chKey = pillBtn.getAttribute('data-ch-key') || '';
        const canSelect = pillBtn.getAttribute('data-available') === 'true';
        if (!chKey || !canSelect) return;
        remotePairState.selectedChannelKey = chKey;
        saveSelectedRemoteChannelKey(chKey);
        remotePairState.copiedAt = 0;
        renderRemotePopoverContent(popover);
        positionRemotePopover();
      });
    });
    popover.querySelector('#ag-remote-copy')?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const url = ep?.activeUrl;
      if (!url) return;
      const ok = await copyToClipboard(url);
      if (ok) {
        remotePairState.copiedAt = Date.now();
        renderRemotePopoverContent(popover);
        setTimeout(() => {
          if (remotePopoverOpen) renderRemotePopoverContent(popover);
        }, 2100);
      }
    });
  }

  async function refreshRemotePairInfo(resetToken = false) {
    if (disposed || remotePairState.loading) return remotePairState;
    remotePairState.loading = true;
    remotePairState.error = '';
    const nodes = ensureQuotaStylesAndNodes();
    if (remotePopoverOpen && nodes?.remotePopover) {
      renderRemotePopoverContent(nodes.remotePopover);
      positionRemotePopover();
    }
    try {
      const res = await postToLiveHost('/remote-info', { resetToken: Boolean(resetToken) });
      if (res && res.disabled) {
        remotePairState.data = null;
        remotePairState.error = tr(
          '当前已禁用手机远程控制（启动参数已关闭远程功能，恢复后重启即可）',
          'Mobile remote access is disabled via startup flags'
        );
      } else if (res && res.ok && res.data) {
        remotePairState.data = res.data;
        if (resetToken) showQuickToast(tr('已生成新配对密钥，旧链接已失效', 'New pair token generated; old links revoked'));
      } else {
        remotePairState.error = tr('请确认 Antigravity 后台伴侣服务正在运行', 'Ensure Antigravity companion service is running');
      }
    } catch (err) {
      remotePairState.error = err?.message || tr('获取配对二维码失败', 'Failed to fetch pairing QR code');
    } finally {
      remotePairState.loading = false;
      updateRemoteBtnLanguage({ skipRender: true });
      const curNodes = ensureQuotaStylesAndNodes();
      if (remotePopoverOpen && curNodes?.remotePopover) {
        renderRemotePopoverContent(curNodes.remotePopover);
        positionRemotePopover();
      }
      scheduleTunnelStartingPoll();
    }
    return remotePairState;
  }

  function clearRemotePollTimer() {
    if (remotePollTimer) {
      clearInterval(remotePollTimer);
      remotePollTimer = null;
    }
  }

  function toggleRemotePopover(forceOpen) {
    const nodes = ensureQuotaStylesAndNodes();
    if (!nodes || !nodes.remotePopover) return;
    const isActuallyOpen = remotePopoverOpen && !nodes.remotePopover.hidden;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !isActuallyOpen;
    remotePopoverOpen = nextOpen;
    nodes.remotePopover.hidden = !nextOpen;
    nodes.remoteBtn?.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    clearRemotePollTimer();

    if (nextOpen) {
      if (popoverOpen) {
        popoverOpen = false;
        nodes.popover.hidden = true;
        nodes.quotaBtn?.setAttribute('aria-expanded', 'false');
      }
      try {
        const pCtx = nodes.sr.getElementById('panel');
        const pTok = nodes.sr.getElementById('panel-tokens');
        const pSet = nodes.sr.getElementById('panel-settings');
        if (pCtx && !pCtx.hidden) pCtx.hidden = true;
        if (pTok && !pTok.hidden) pTok.hidden = true;
        if (pSet && !pSet.hidden) pSet.hidden = true;
        nodes.sr.getElementById('badge')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-speed')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-tokens')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-settings')?.setAttribute('aria-expanded', 'false');
      } catch {}
      renderRemotePopoverContent(nodes.remotePopover);
      positionRemotePopover();
      try { (globalThis.__AGContextMeter || window.__AGContextMeter)?.setHostElevated?.(true); } catch {}
      void refreshRemotePairInfo(false);
      remotePollTimer = setInterval(() => {
        if (!disposed && remotePopoverOpen && !remotePairState.loading && !remotePairState.tunnelBusy && !remotePairState.tunnelConfigOpen) {
          void refreshRemotePairInfo(false);
        }
      }, 4000);
    } else {
      remotePairState.tunnelConfigOpen = false;
      remotePairState.draftHost = null;
      remotePairState.draftToken = '';
      if (remotePairState.tunnelPollTimer) {
        clearTimeout(remotePairState.tunnelPollTimer);
        remotePairState.tunnelPollTimer = null;
      }
      try { (globalThis.__AGContextMeter || window.__AGContextMeter)?.setHostElevated?.(Boolean(popoverOpen || remotePopoverOpen)); } catch {}
    }
  }

  function onRemoteBtnClick(e) {
    e.stopPropagation();
    toggleRemotePopover();
  }

  function toggleQuotaPopover(forceOpen) {
    const nodes = ensureQuotaStylesAndNodes();
    if (!nodes) return;
    const isActuallyOpen = popoverOpen && !nodes.popover.hidden;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !isActuallyOpen;
    popoverOpen = nextOpen;
    nodes.popover.hidden = !nextOpen;
    nodes.quotaBtn?.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');

    if (nextOpen) {
      if (remotePopoverOpen && nodes.remotePopover) {
        clearRemotePollTimer();
        if (remotePairState.tunnelPollTimer) {
          clearTimeout(remotePairState.tunnelPollTimer);
          remotePairState.tunnelPollTimer = null;
        }
        remotePopoverOpen = false;
        remotePairState.tunnelConfigOpen = false;
        remotePairState.draftHost = null;
        remotePairState.draftToken = '';
        nodes.remotePopover.hidden = true;
        nodes.remoteBtn?.setAttribute('aria-expanded', 'false');
      }
      // 避免与原有上下文面板重叠
      try {
        const pCtx = nodes.sr.getElementById('panel');
        const pTok = nodes.sr.getElementById('panel-tokens');
        const pSet = nodes.sr.getElementById('panel-settings');
        if (pCtx && !pCtx.hidden) pCtx.hidden = true;
        if (pTok && !pTok.hidden) pTok.hidden = true;
        if (pSet && !pSet.hidden) pSet.hidden = true;
        nodes.sr.getElementById('badge')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-speed')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-tokens')?.setAttribute('aria-expanded', 'false');
        nodes.sr.getElementById('badge-settings')?.setAttribute('aria-expanded', 'false');
      } catch {}
      renderQuotaPopoverContent(nodes.popover);
      positionQuotaPopover();
      try { (globalThis.__AGContextMeter || window.__AGContextMeter)?.setHostElevated?.(true); } catch {}
      void refreshQuota({ silent: Boolean(quotaState.lastFetchedAt) });
    } else {
      if (remotePairState.tunnelPollTimer) {
        clearTimeout(remotePairState.tunnelPollTimer);
        remotePairState.tunnelPollTimer = null;
      }
      try { (globalThis.__AGContextMeter || window.__AGContextMeter)?.setHostElevated?.(Boolean(popoverOpen || remotePopoverOpen)); } catch {}
    }
  }

  function onQuotaBtnClick(e) {
    e.stopPropagation();
    toggleQuotaPopover();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderQuotaPopoverContent(popover) {
    if (!popover) return;
    const g = quotaState.gemini;
    const c = quotaState.claude;
    const activeKey = quotaState.activePoolKey;
    const modelName = quotaState.activeModelText || tr('未检测到模型', 'No model detected');

    const renderWindowRow = (label, bucket) => {
      if (!bucket) return '';
      const bFrac = bucket.remainingFraction;
      const bPctInt = typeof bFrac === 'number' ? Math.max(0, Math.min(100, bFrac * 100)) : 0;
      const bColor = getQuotaColor(bFrac);
      const bPctText = formatPctOne(bFrac);
      const bResetText = bucket.resetTime ? formatResetCountdownZh(bucket.resetTime) : tr('暂无重置时间信息', 'Reset time unknown');
      return `
        <div class="ag-qp-subrow">
          <div class="ag-qp-subhead">
            <span class="ag-qp-sublabel">${escapeHtml(label)}</span>
            <span class="ag-qp-subpct" style="color:${bColor}">${escapeHtml(bPctText)}</span>
          </div>
          <div class="ag-qp-bar">
            <div class="ag-qp-bar-fill" style="width:${bPctInt.toFixed(1)}%;background:${bColor}"></div>
          </div>
          <div class="ag-qp-reset">${escapeHtml(bResetText)}</div>
        </div>
      `;
    };

    const renderPoolCard = (title, pool, isActive) => {
      const frac = pool?.remainingFraction;
      const pctInt = typeof frac === 'number' ? Math.max(0, Math.min(100, frac * 100)) : 0;
      const color = getQuotaColor(frac);
      const pctText = formatPctOne(frac);
      const resetText = pool?.resetTime ? formatResetCountdownZh(pool.resetTime) : tr('暂无重置时间信息', 'Reset time unknown');
      const hasDualWindows = Boolean(pool?.fiveHour || pool?.weekly);
      const bodyHtml = hasDualWindows
        ? `
          <div class="ag-qp-subrows">
            ${pool?.fiveHour ? renderWindowRow(tr('5 小时限额', '5h Limit'), pool.fiveHour) : ''}
            ${pool?.weekly ? renderWindowRow(tr('每周限额', 'Weekly Limit'), pool.weekly) : ''}
          </div>
        `
        : `
          <div class="ag-qp-bar">
            <div class="ag-qp-bar-fill" style="width:${pctInt.toFixed(1)}%;background:${color}"></div>
          </div>
          <div class="ag-qp-reset">${escapeHtml(resetText)}</div>
        `;
      return `
        <div class="ag-qp-card${isActive ? ' is-active' : ''}">
          <div class="ag-qp-row">
            <span class="ag-qp-pool-name">
              <span>${escapeHtml(title)}</span>
              ${isActive ? `<span class="ag-qp-active-tag">${tr('当前', 'Active')}</span>` : ''}
            </span>
            <span class="ag-qp-pct" style="color:${color}">${escapeHtml(hasDualWindows ? `${tr('最紧', 'Min')} ${pctText}` : pctText)}</span>
          </div>
          ${bodyHtml}
        </div>
      `;
    };

    function resolvePopoverPlanPools() {
      const histPlan = window.__AGContextMeterHistory?.planStatus || {};
      const liveSettings = window.__AGContextMeter?.getPlanSettings?.() || {};
      const mergedPlan = {
        tierKey: histPlan.tierKey || (liveSettings.ultraSubTier ? 'ultra' : ''),
        tierName: (liveSettings.tierName && liveSettings.tierName !== '未知') ? liveSettings.tierName : (histPlan.tierName || ''),
        ultraSubTier: liveSettings.ultraSubTier || histPlan.ultraSubTier || null,
        ultraSubTierSpec: histPlan.ultraSubTierSpec || null,
        promptCredits: quotaState.promptCredits || histPlan.promptCredits || null,
        flowCredits: quotaState.flowCredits || histPlan.flowCredits || null
      };
      const coreRef = (typeof __AGContextMeterCore !== 'undefined' ? __AGContextMeterCore : null) || window.__AGContextMeterCore;
      if (coreRef && typeof coreRef.resolvePlanQuotaPools === 'function') {
        return coreRef.resolvePlanQuotaPools(mergedPlan);
      }
      const tk = String(mergedPlan.tierKey || '').toLowerCase();
      const st = String(mergedPlan.ultraSubTier || '').toLowerCase();
      if (tk === 'ultra' && st === '20x') {
        return { subGroupLabel: 'Google AI Ultra · 20x 档位', promptPoolText: '20× Pro 配额（5h 滚动窗口 + 周限额）', flowPoolText: '25,000 套餐月积分 / 月' };
      }
      if (tk === 'ultra' && st === '5x') {
        return { subGroupLabel: 'Google AI Ultra · 5x 档位', promptPoolText: '5× Pro 配额（5h 滚动窗口 + 周限额）', flowPoolText: '10,000 套餐月积分 / 月' };
      }
      if (tk === 'ultra') {
        return { subGroupLabel: 'Google AI Ultra · 待选档位', promptPoolText: '5× ~ 20× Pro 配额（请选 5x / 20x）', flowPoolText: '10,000 ~ 25,000 套餐月积分 / 月' };
      }
      if (tk === 'pro') {
        return { subGroupLabel: 'Google AI Pro · 1x 标准档', promptPoolText: '1× Pro 基准配额（5h 滚动窗口 + 周限额）', flowPoolText: '1,000 套餐月积分 / 月' };
      }
      if (tk === 'plus') {
        return { subGroupLabel: 'Google AI Plus · 基础档', promptPoolText: 'Plus 基础配额', flowPoolText: '200 套餐月积分 / 月' };
      }
      if (tk === 'free') {
        return { subGroupLabel: 'Google AI Free · 免费档', promptPoolText: '免费基础配额', flowPoolText: '100 体验积分 / 月' };
      }
      return null;
    }

    const qpd = resolvePopoverPlanPools();
    const creditsRows = [];
    if (qpd) {
      const subGroupText = uiLang === 'zh-TW' ? convertEnhancerToZhTW(qpd.subGroupLabel) : qpd.subGroupLabel;
      const promptPoolText = uiLang === 'zh-TW' ? convertEnhancerToZhTW(qpd.promptPoolText) : qpd.promptPoolText;
      const flowPoolText = uiLang === 'zh-TW' ? convertEnhancerToZhTW(qpd.flowPoolText) : qpd.flowPoolText;
      creditsRows.push(`
        <div class="ag-qp-credit-row">
          <span>${tr('当前套餐档位', 'Plan Tier')}</span>
          <strong>${escapeHtml(subGroupText)}</strong>
        </div>
        <div class="ag-qp-credit-row">
          <span>${tr('Prompt 额度池', 'Prompt Pool')}</span>
          <strong>${escapeHtml(promptPoolText)}</strong>
        </div>
        <div class="ag-qp-credit-row">
          <span>${tr('Flow 额度池', 'Flow Pool')}</span>
          <strong>${escapeHtml(flowPoolText)}</strong>
        </div>
      `);
    } else {
      if (quotaState.promptCredits) {
        const pc = quotaState.promptCredits;
        creditsRows.push(`
          <div class="ag-qp-credit-row">
            <span>${tr('Prompt 额度池', 'Prompt Pool')}</span>
            <strong>${pc.available}${pc.monthly ? ` / ${pc.monthly}` : ''}</strong>
          </div>
        `);
      }
      if (quotaState.flowCredits) {
        const fc = quotaState.flowCredits;
        creditsRows.push(`
          <div class="ag-qp-credit-row">
            <span>${tr('Flow 额度池', 'Flow Pool')}</span>
            <strong>${fc.available}${fc.monthly ? ` / ${fc.monthly}` : ''}</strong>
          </div>
        `);
      }
    }

    const subGroups = Array.isArray(quotaState.subGroups) ? quotaState.subGroups : [];
    const modelLower = String(modelName || '').toLowerCase();
    const poolCardsHtml = subGroups.length > 0
      ? subGroups.map((sg) => {
          const dispLower = String(sg.displayName || '').toLowerCase();
          const isMatch = (dispLower.includes('flash') && modelLower.includes('flash'))
            || (dispLower.includes('pro') && (modelLower.includes('pro') || modelLower.includes('argon') || modelLower.includes('gemini 4')))
            || (sg.poolKey === activeKey && !subGroups.some((o) => o !== sg && o.poolKey === sg.poolKey));
          return renderPoolCard(sg.displayName, sg, isMatch);
        }).join('')
      : `${renderPoolCard(tr('Gemini 4 / 3.8 配额池', 'Gemini 4 / 3.8 Pool'), g, activeKey === 'gemini')}${renderPoolCard(tr('Claude 5.5 / GPT 配额池', 'Claude 5.5 / GPT Pool'), c, activeKey === 'claude')}`;

    const updatedStr = quotaState.lastFetchedAt
      ? `${tr('上次刷新：', 'Updated: ')}${new Date(quotaState.lastFetchedAt).toLocaleTimeString(uiLang === 'en' ? 'en-US' : (uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN'), { hour12: false })}`
      : (quotaState.error ? tr(quotaState.error, quotaState.error) : tr('等待数据…', 'Waiting for data…'));

    const nextHtml = `
      <div class="ag-qp-header">
        <span class="ag-qp-title">${tr('模型剩余配额实时看板', 'Model Quota Live')}</span>
        <button id="ag-quota-refresh" class="ag-qp-refresh" type="button" ${quotaState.loading ? 'disabled' : ''}>${quotaState.loading ? `<span class="ag-rp-spin" aria-hidden="true"></span>${escapeHtml(tr('刷新中…', 'Refreshing…'))}` : escapeHtml(tr('↻ 刷新', '↻ Refresh'))}</button>
      </div>
      <div class="ag-qp-model">
        <span>${tr('当前选中模型', 'Active Model')}</span>
        <strong>${escapeHtml(modelName)}</strong>
      </div>
      ${poolCardsHtml}
      <div class="ag-qp-footer">
        ${creditsRows.join('')}
        <div>${escapeHtml(updatedStr)}</div>
      </div>
    `;
    if (popover.__agLastHtml === nextHtml && popover.childElementCount > 0) return;
    popover.__agLastHtml = nextHtml;
    popover.innerHTML = nextHtml;

    const refreshBtn = popover.querySelector('#ag-quota-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void refreshQuota();
      });
    }
  }

  function renderQuotaUI() {
    if (disposed) return;
    const nodes = ensureQuotaStylesAndNodes();
    if (!nodes) return;
    const { host, sr, quotaBtn, popover } = nodes;
    if (!quotaBtn) return;

    quotaState.activeModelText = detectCurrentModelText();
    quotaState.activePoolKey = classifyModelPoolKey(quotaState.activeModelText);

    const gFrac = quotaState.gemini?.remainingFraction;
    const cFrac = quotaState.claude?.remainingFraction;
    const activeFrac = quotaState.activePoolKey === 'claude' ? cFrac : gFrac;
    const dotColor = getQuotaColor(activeFrac);

    const dotEl = sr.getElementById('ag-quota-dot');
    const textEl = sr.getElementById('ag-quota-text');
    if (dotEl) {
      dotEl.style.background = dotColor;
      dotEl.style.boxShadow = '';
    }

    const layoutMode = host.getAttribute('data-layout') || 'wide';
    const gStr = formatPctInt(gFrac);
    const cStr = formatPctInt(cFrac);
    let badgeText = '';
    if (layoutMode === 'wide') {
      badgeText = quotaState.activePoolKey === 'claude'
        ? `C ${cStr} · G4 ${gStr}`
        : `G4 ${gStr} · C ${cStr}`;
    } else {
      badgeText = `${tr('配额', 'Quota')} ${formatPctInt(activeFrac)}`;
    }
    if (textEl && textEl.textContent !== badgeText) {
      textEl.textContent = badgeText;
    }

    const formatPoolTooltip = (label, pool, fallbackFrac) => {
      const hasDual = Boolean(pool?.fiveHour || pool?.weekly);
      if (hasDual) {
        const s5 = pool?.fiveHour ? `5h ${formatPctOne(pool.fiveHour.remainingFraction)}` : '';
        const sw = pool?.weekly ? `${tr('周', 'Wk')} ${formatPctOne(pool.weekly.remainingFraction)}` : '';
        const detail = [s5, sw].filter(Boolean).join(' · ');
        const tightReset = pool?.resetTime ? formatResetCountdownZh(pool.resetTime) : tr('未知', 'Unknown');
        return `${label}: ${detail}（${tightReset}）`;
      }
      const tip = pool?.resetTime ? formatResetCountdownZh(pool.resetTime) : tr('未知', 'Unknown');
      return `${label}: ${formatPctOne(fallbackFrac)} (${tip})`;
    };
    quotaBtn.title = `${formatPoolTooltip('Gemini 4/3.8', quotaState.gemini, gFrac)}\n${formatPoolTooltip('Claude/GPT', quotaState.claude, cFrac)}\n${tr('点击查看完整配额面板', 'Click to view full quota details')}`;

    if (popoverOpen && popover && !popover.hidden) {
      renderQuotaPopoverContent(popover);
      positionQuotaPopover();
    }
  }

  // ==================== 输入框快捷胶囊栏 ====================

  function ensureDocStyle() {
    if (!document.head) return;
    let styleEl = document.getElementById(DOC_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = DOC_STYLE_ID;
      styleEl.textContent = `
        @keyframes ag-pop-in {
          from { opacity: 0; transform: translateY(3px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ag-toast-in {
          from { opacity: 0; transform: translateY(3px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        #${QUICK_BAR_ID} {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 2px 6px 2px;
          width: 100%;
          box-sizing: border-box;
          user-select: none;
          -webkit-user-select: none;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 26px;
          padding: 0 9px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(244, 244, 245, 0.88);
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${QUICK_BAR_ID} .ag-qcap-btn:not(.ag-ns-accept) {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #${QUICK_BAR_ID} .ag-qcap-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.13);
          border-color: rgba(255, 255, 255, 0.24);
          color: #ffffff;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-sending="true"] {
          opacity: 0.62;
          cursor: progress;
          pointer-events: none;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn:focus-visible {
          outline: 2px solid var(--ag-effective-accent, #a78bfa);
          outline-offset: 2px;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn:focus-visible {
          outline-color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-effective-accent, #a78bfa);
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-active="true"]:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
          color: var(--ag-effective-accent, #a78bfa);
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-auto-send="true"]::after {
          content: '↵';
          font-size: 10.5px;
          font-weight: 600;
          opacity: 0.78;
          color: var(--ag-effective-accent, #a78bfa);
          margin-left: 1px;
          flex-shrink: 0;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-risk="warn"] {
          border-color: rgba(245, 158, 11, 0.55);
          background: rgba(245, 158, 11, 0.14);
          color: #fbbf24;
        }
        #${QUICK_BAR_ID} .ag-qcap-btn[data-risk="danger"] {
          border-color: rgba(239, 68, 68, 0.65);
          background: rgba(239, 68, 68, 0.16);
          color: #f87171;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn {
          border-color: rgba(0, 0, 0, 0.11);
          background: rgba(0, 0, 0, 0.045);
          color: rgba(24, 24, 27, 0.86);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.09);
          border-color: rgba(0, 0, 0, 0.2);
          color: #09090b;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn[data-active="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn[data-active="true"]:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(124, 58, 237, 0.18));
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn[data-auto-send="true"]::after {
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn[data-risk="warn"] {
          border-color: rgba(217, 119, 6, 0.55);
          background: rgba(245, 158, 11, 0.12);
          color: #b45309;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-btn[data-risk="danger"] {
          border-color: rgba(220, 38, 38, 0.6);
          background: rgba(239, 68, 68, 0.12);
          color: #dc2626;
        }
        #${QUICK_BAR_ID} .ag-qcap-right-slot {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          flex: 0 1 auto;
        }
        #${QUICK_BAR_ID} .ag-qcap-right-slot[data-toast-active="true"] #${NEXT_STEP_GHOST_ID} {
          display: none !important;
        }
        #${QUICK_BAR_ID} .ag-qcap-toast {
          display: none;
          height: 24px;
          line-height: 22px;
          padding: 0 9px;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.30));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.12));
          font-size: 12px;
          font-weight: 500;
          color: var(--ag-effective-accent, #a78bfa);
          pointer-events: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: min(520px, 60vw);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-toast {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.26));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.08));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID} .ag-qcap-toast[data-tone="error"] {
          border-color: rgba(239, 68, 68, 0.45);
          background: rgba(239, 68, 68, 0.14);
          color: #f87171;
          pointer-events: auto;
          user-select: text;
          cursor: text;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] .ag-qcap-toast[data-tone="error"] {
          border-color: rgba(220, 38, 38, 0.36);
          background: rgba(220, 38, 38, 0.09);
          color: #dc2626;
        }
        #${QUICK_BAR_ID} .ag-qcap-toast[data-visible="true"] {
          display: inline-block;
          animation: ag-toast-in 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        [data-ag-risk-card="high"] {
          border: 1.5px solid rgba(239, 68, 68, 0.78) !important;
          background: rgba(239, 68, 68, 0.06) !important;
          border-radius: 8px !important;
        }
        .ag-risk-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          margin-bottom: 6px;
          border-radius: 6px;
          background: rgba(239, 68, 68, 0.16);
          border: 1px solid rgba(239, 68, 68, 0.45);
          color: #fca5a5;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.35;
        }
        .ag-risk-banner[data-ag-theme="light"] {
          background: rgba(220, 38, 38, 0.1);
          border-color: rgba(220, 38, 38, 0.4);
          color: #b91c1c;
        }
        #${CHAT_NAV_ID} {
          position: fixed;
          z-index: 8;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 2px;
          padding: 4px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(18, 18, 22, 0.88);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.34);
          opacity: 0.84;
          transition: opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${CHAT_NAV_ID}:hover {
          opacity: 1;
          border-color: rgba(255, 255, 255, 0.13);
        }
        #${CHAT_NAV_ID}[hidden] {
          display: none !important;
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] {
          border-color: rgba(0, 0, 0, 0.08);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 8px 24px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"]:hover {
          border-color: rgba(0, 0, 0, 0.13);
        }
        #${CHAT_NAV_ID} .ag-nav-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          width: 28px;
          height: 28px;
          padding: 0;
          border-radius: 6px;
          border: none;
          box-shadow: none;
          background: transparent;
          color: rgba(228, 228, 231, 0.82);
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), color 0.14s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${CHAT_NAV_ID}:hover .ag-nav-btn {
          width: auto;
          padding: 0 8px;
          justify-content: flex-start;
        }
        #${CHAT_NAV_ID} .ag-nav-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 15px;
          height: 15px;
          flex-shrink: 0;
          color: rgba(161, 161, 170, 0.92);
          transition: color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${CHAT_NAV_ID} .ag-nav-svg {
          width: 14px;
          height: 14px;
          display: block;
          flex-shrink: 0;
        }
        #${CHAT_NAV_ID} .ag-nav-label {
          display: none;
        }
        #${CHAT_NAV_ID}:hover .ag-nav-label {
          display: inline;
        }
        #${CHAT_NAV_ID} .ag-nav-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fafafa;
        }
        #${CHAT_NAV_ID} .ag-nav-btn:hover .ag-nav-icon {
          color: #fafafa;
        }
        #${CHAT_NAV_ID} .ag-nav-btn:active:not(:disabled) {
          background: rgba(255, 255, 255, 0.13);
          transform: scale(0.975) translateY(0.5px);
        }
        #${CHAT_NAV_ID} .ag-nav-btn:focus-visible {
          outline: 2px solid var(--ag-effective-accent, #a78bfa);
          outline-offset: 2px;
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-btn {
          background: transparent;
          color: rgba(39, 39, 42, 0.86);
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-icon {
          color: rgba(113, 113, 122, 0.95);
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-btn:hover {
          background: rgba(0, 0, 0, 0.06);
          color: #09090b;
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-btn:hover .ag-nav-icon {
          color: #09090b;
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-btn:active:not(:disabled) {
          background: rgba(0, 0, 0, 0.1);
          transform: scale(0.975) translateY(0.5px);
        }
        #${CHAT_NAV_ID}[data-ag-theme="light"] .ag-nav-btn:focus-visible {
          outline-color: var(--ag-effective-accent, #7c3aed);
        }
        #${FILE_EDITOR_CONTROLS_ID} {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-right: 4px;
          app-region: no-drag;
          -webkit-app-region: no-drag;
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          height: 26px;
          padding: 0 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.07);
          color: rgba(244, 244, 245, 0.92);
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.28);
          color: #ffffff;
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn:focus-visible {
          outline: 2px solid var(--ag-effective-accent, #a78bfa);
          outline-offset: 2px;
        }
        #${FILE_EDITOR_CONTROLS_ID}[data-ag-theme="light"] .ag-fedit-btn:focus-visible {
          outline-color: var(--ag-effective-accent, #7c3aed);
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn[data-primary="true"] {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-effective-accent, #a78bfa);
        }
        #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn[data-primary="true"]:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
        }
        #${FILE_EDITOR_CONTROLS_ID}[data-ag-theme="light"] .ag-fedit-btn {
          border-color: rgba(0, 0, 0, 0.12);
          background: rgba(0, 0, 0, 0.05);
          color: rgba(24, 24, 27, 0.9);
        }
        #${FILE_EDITOR_CONTROLS_ID}[data-ag-theme="light"] .ag-fedit-btn:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.1);
          color: #09090b;
        }
        #${FILE_EDITOR_CONTROLS_ID}[data-ag-theme="light"] .ag-fedit-btn[data-primary="true"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${FILE_EDITOR_CONTROLS_ID}[data-ag-theme="light"] .ag-fedit-btn[data-primary="true"]:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(124, 58, 237, 0.18));
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
        }
        [data-ag-editor-host="1"] {
          display: flex !important;
          flex-direction: column !important;
          height: 100% !important;
          min-height: 0 !important;
        }
        #${FILE_EDITOR_WRAP_ID} {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          width: 100%;
          height: 100%;
          min-height: 0;
          background: rgba(24, 24, 27, 0.96);
          color: #e4e4e7;
        }
        #${FILE_EDITOR_WRAP_ID}[data-ag-theme="light"] {
          background: #ffffff;
          color: #18181b;
        }
        #${FILE_EDITOR_WRAP_ID} .ag-fedit-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 12px;
          font-size: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.09);
          background: rgba(255, 255, 255, 0.03);
          color: #a1a1aa;
          flex-shrink: 0;
        }
        #${FILE_EDITOR_WRAP_ID}[data-ag-theme="light"] .ag-fedit-statusbar {
          border-bottom-color: rgba(0, 0, 0, 0.08);
          background: rgba(0, 0, 0, 0.025);
          color: #52525b;
        }
        #${FILE_EDITOR_WRAP_ID} #ag-inline-file-textarea {
          flex: 1 1 auto;
          width: 100%;
          min-height: 0;
          padding: 14px 16px;
          border: none;
          resize: none;
          box-sizing: border-box;
          background: transparent;
          color: inherit;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 13px;
          line-height: 1.65;
          tab-size: 2;
        }
        #${FILE_EDITOR_WRAP_ID} #ag-inline-file-textarea:focus-visible {
          outline: 1.5px solid var(--ag-effective-accent, #a78bfa);
          outline-offset: -2px;
        }
        #${FILE_EDITOR_WRAP_ID}[data-ag-theme="light"] #ag-inline-file-textarea:focus-visible {
          outline-color: var(--ag-effective-accent, #7c3aed);
        }
        html[data-ag-cmd-down="1"] a[href^="http://"],
        html[data-ag-cmd-down="1"] a[href^="https://"],
        html[data-ag-cmd-down="1"] a[href^="mailto:"],
        html[data-ag-cmd-down="1"] code {
          cursor: pointer !important;
        }
        html[data-ag-cmd-down="1"] a[href^="http://"]:hover,
        html[data-ag-cmd-down="1"] a[href^="https://"]:hover {
          text-decoration: underline !important;
        }
        [data-testid="conversation-row-sidebar"][data-ag-shortcut] {
          position: relative !important;
        }
        html[data-ag-cmd-down="1"] [data-testid="conversation-row-sidebar"][data-ag-shortcut]::after {
          content: attr(data-ag-shortcut);
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          padding: 1px 5px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          line-height: 15px;
          letter-spacing: 0.2px;
          color: #e4e4e7;
          background: rgba(24, 24, 27, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
          pointer-events: none;
          z-index: 6;
        }
        html.light[data-ag-cmd-down="1"] [data-testid="conversation-row-sidebar"][data-ag-shortcut]::after,
        html[data-theme="light"][data-ag-cmd-down="1"] [data-testid="conversation-row-sidebar"][data-ag-shortcut]::after {
          color: #18181b;
          background: rgba(255, 255, 255, 0.94);
          border-color: rgba(24, 24, 27, 0.16);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        @keyframes ag-enh-spin {
          to { transform: rotate(360deg); }
        }
        #${NEXT_STEP_GHOST_ID} {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 5px;
          min-width: 0;
          max-width: 100%;
        }
        #${NEXT_STEP_GHOST_ID}[hidden] {
          display: none !important;
        }
        #${QUICK_BAR_ID} #${NEXT_STEP_GHOST_ID} .ag-ns-accept {
          border-color: var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-effective-accent, #a78bfa);
          max-width: 100%;
          min-width: 0;
        }
        #${QUICK_BAR_ID} #${NEXT_STEP_GHOST_ID} .ag-ns-accept:hover:not(:disabled) {
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
          color: #ffffff;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] #${NEXT_STEP_GHOST_ID} .ag-ns-accept {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] #${NEXT_STEP_GHOST_ID} .ag-ns-accept:hover:not(:disabled) {
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
          background: var(--ag-accent-bg-hover, rgba(124, 58, 237, 0.18));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${NEXT_STEP_GHOST_ID} .ag-ns-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 210px;
        }
        #${NEXT_STEP_GHOST_ID} .ag-ns-kbd-tag {
          font-size: 10.5px;
          line-height: 1;
          padding: 2px 5px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          color: rgba(228, 228, 231, 0.85);
          flex-shrink: 0;
        }
        #${QUICK_BAR_ID}[data-ag-theme="light"] #${NEXT_STEP_GHOST_ID} .ag-ns-kbd-tag {
          background: rgba(0, 0, 0, 0.08);
          color: rgba(24, 24, 27, 0.78);
        }
        #${NEXT_STEP_GHOST_ID} .ag-ns-cycle {
          min-width: 46px;
          justify-content: center;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        #${NEXT_STEP_GHOST_ID} .ag-ns-cycle[hidden] {
          display: none !important;
        }
        #${NEXT_STEP_TOOLTIP_ID} {
          position: fixed;
          z-index: 2147483645;
          max-width: min(360px, calc(100vw - 24px));
          padding: 7px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(24, 24, 27, 0.96);
          color: #f4f4f5;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 10px 28px rgba(0, 0, 0, 0.48);
          font-size: 12px;
          line-height: 1.45;
          white-space: normal;
          word-break: break-word;
          pointer-events: none;
        }
        #${NEXT_STEP_TOOLTIP_ID}:not([hidden]),
        #${QUICK_BAR_TOOLTIP_ID}:not([hidden]) {
          animation: ag-pop-in 0.14s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${NEXT_STEP_TOOLTIP_ID}[hidden] {
          display: none !important;
        }
        #${NEXT_STEP_TOOLTIP_ID}[data-hint]::after {
          content: attr(data-hint);
          display: block;
          margin-top: 3px;
          font-size: 11px;
          line-height: 1.35;
          color: rgba(212, 212, 216, 0.72);
        }
        #${NEXT_STEP_TOOLTIP_ID}[data-ag-theme="light"] {
          border-color: rgba(0, 0, 0, 0.12);
          background: rgba(255, 255, 255, 0.98);
          color: #18181b;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        #${NEXT_STEP_TOOLTIP_ID}[data-ag-theme="light"][data-hint]::after {
          color: rgba(63, 63, 70, 0.72);
        }
        #${QUICK_BAR_TOOLTIP_ID} {
          position: fixed;
          z-index: 2147483646;
          width: min(380px, calc(100vw - 24px));
          padding: 8px 11px;
          border-radius: 10px;
          border: 1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.38));
          background: rgba(20, 20, 23, 0.97);
          color: #f4f4f5;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 10px 28px rgba(0, 0, 0, 0.5);
          font-size: 12px;
          line-height: 1.45;
          white-space: normal;
          word-break: break-word;
          pointer-events: none;
        }
        #${QUICK_BAR_TOOLTIP_ID}[hidden] {
          display: none !important;
        }
        #${QUICK_BAR_TOOLTIP_ID}[data-ag-theme="light"] {
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.32));
          background: rgba(255, 255, 255, 0.98);
          color: #18181b;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 3px;
          min-width: 0;
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-title-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex: 1 1 auto;
          min-width: 0;
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-title {
          font-size: 12px;
          font-weight: 600;
          color: inherit;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-rec {
          font-size: 11px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          border: 1px solid var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          color: var(--ag-effective-accent, #a78bfa);
          flex-shrink: 0;
        }
        #${QUICK_BAR_TOOLTIP_ID}[data-ag-theme="light"] .ag-qtip-rec {
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          border-color: var(--ag-accent-border, rgba(124, 58, 237, 0.28));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-rec[hidden] {
          display: none !important;
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-tag {
          font-size: 11px;
          color: rgba(212, 212, 216, 0.78);
          flex-shrink: 0;
        }
        #${QUICK_BAR_TOOLTIP_ID}[data-ag-theme="light"] .ag-qtip-tag {
          color: rgba(63, 63, 70, 0.75);
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-role {
          font-size: 12px;
          color: inherit;
          line-height: 1.42;
        }
        #${QUICK_BAR_TOOLTIP_ID} .ag-qtip-scene {
          font-size: 11.5px;
          color: rgba(212, 212, 216, 0.78);
          line-height: 1.42;
          margin-top: 2px;
        }
        #${QUICK_BAR_TOOLTIP_ID}[data-ag-theme="light"] .ag-qtip-scene {
          color: rgba(63, 63, 70, 0.78);
        }
        #${PROMPT_OPT_WRAP_ID} {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 5px;
          width: 100%;
          box-sizing: border-box;
          padding: 0 12px 4px 12px;
          margin: 0;
          flex-shrink: 0;
          pointer-events: none;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn,
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn {
          pointer-events: auto;
          appearance: none;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 500;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(244, 244, 245, 0.88);
          transition: background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn:active:not(:disabled),
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn:active:not(:disabled) {
          transform: scale(0.975) translateY(0.5px);
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn:focus-visible,
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn:focus-visible {
          outline: 2px solid var(--ag-effective-accent, #a78bfa);
          outline-offset: 2px;
        }
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-opt-btn:focus-visible,
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-undo-btn:focus-visible {
          outline-color: var(--ag-effective-accent, #7c3aed);
        }
        #${PROMPT_OPT_WRAP_ID} .ag-opt-icon {
          display: inline-block;
          flex-shrink: 0;
          color: currentColor;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-opt-spin {
          display: inline-block;
          width: 11px;
          height: 11px;
          border-radius: 999px;
          border: 1.5px solid var(--ag-accent-border, rgba(167, 139, 250, 0.34));
          border-top-color: currentColor;
          animation: ag-enh-spin 0.7s linear infinite;
          flex-shrink: 0;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn:hover:not(:disabled),
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(167, 139, 250, 0.24));
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
          color: #ffffff;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn[data-loading="true"] {
          border-color: var(--ag-accent-border-hover, rgba(167, 139, 250, 0.56));
          background: var(--ag-accent-bg, rgba(167, 139, 250, 0.14));
          color: var(--ag-effective-accent, #a78bfa);
          cursor: pointer;
          opacity: 1;
        }
        #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn[hidden] {
          display: none !important;
        }
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-opt-btn,
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-undo-btn {
          border-color: rgba(0, 0, 0, 0.12);
          background: rgba(0, 0, 0, 0.045);
          color: rgba(24, 24, 27, 0.86);
        }
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-opt-btn:hover:not(:disabled),
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-undo-btn:hover:not(:disabled) {
          background: var(--ag-accent-bg-hover, rgba(124, 58, 237, 0.18));
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
          color: var(--ag-effective-accent, #7c3aed);
        }
        #${PROMPT_OPT_WRAP_ID}[data-ag-theme="light"] .ag-prompt-opt-btn[data-loading="true"] {
          border-color: var(--ag-accent-border-hover, rgba(124, 58, 237, 0.48));
          background: var(--ag-accent-bg, rgba(124, 58, 237, 0.10));
          color: var(--ag-effective-accent, #7c3aed);
        }
        @supports (corner-shape: superellipse(1.25)) {
          #${CHAT_NAV_ID},
          #${NEXT_STEP_TOOLTIP_ID},
          #${QUICK_BAR_TOOLTIP_ID} {
            corner-shape: superellipse(1.25);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          #${QUICK_BAR_ID} .ag-qcap-btn,
          #${QUICK_BAR_ID} .ag-qcap-toast,
          #${CHAT_NAV_ID},
          #${CHAT_NAV_ID} .ag-nav-btn,
          #${CHAT_NAV_ID} .ag-nav-icon,
          #${FILE_EDITOR_CONTROLS_ID} .ag-fedit-btn,
          #${NEXT_STEP_TOOLTIP_ID},
          #${QUICK_BAR_TOOLTIP_ID},
          #${PROMPT_OPT_WRAP_ID} .ag-prompt-opt-btn,
          #${PROMPT_OPT_WRAP_ID} .ag-prompt-undo-btn,
          #${PROMPT_OPT_WRAP_ID} .ag-opt-spin {
            animation: none !important;
            transition: none !important;
            transform: none !important;
          }
        }
      `;
      document.head.appendChild(styleEl);
    }
  }

  function hideQuickToast(expectedTag = '') {
    const bar = document.getElementById(QUICK_BAR_ID);
    const rightSlot = bar?.querySelector(`#${QUICK_RIGHT_SLOT_ID}`);
    const toast = bar?.querySelector('.ag-qcap-toast');
    if (!toast) return;
    if (expectedTag && toast.getAttribute('data-tag') !== expectedTag) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.setAttribute('data-visible', 'false');
    toast.removeAttribute('data-persistent');
    toast.removeAttribute('data-tag');
    if (rightSlot) rightSlot.removeAttribute('data-toast-active');
  }

  function showQuickToast(text, options = {}) {
    const bar = document.getElementById(QUICK_BAR_ID);
    const rightSlot = bar?.querySelector(`#${QUICK_RIGHT_SLOT_ID}`);
    const toast = bar?.querySelector('.ag-qcap-toast');
    if (!toast) return;
    const opts = typeof options === 'number'
      ? { durationMs: options }
      : ((options && typeof options === 'object') ? options : {});
    const isError = Boolean(opts.isError);
    const persistent = Boolean(opts.persistent);
    const tag = String(opts.tag || '');
    const rawDuration = Number(opts.durationMs);
    const durationMs = (Number.isFinite(rawDuration) && rawDuration > 0)
      ? Math.max(1000, rawDuration)
      : (isError ? 7000 : 2800);
    toast.textContent = text;
    toast.title = String(opts.title || text || '');
    toast.setAttribute('data-tone', isError ? 'error' : 'info');
    if (tag) toast.setAttribute('data-tag', tag);
    else toast.removeAttribute('data-tag');
    if (persistent) toast.setAttribute('data-persistent', 'true');
    else toast.removeAttribute('data-persistent');
    toast.setAttribute('data-visible', 'true');
    if (rightSlot) rightSlot.setAttribute('data-toast-active', 'true');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!persistent) {
      toastTimer = setTimeout(() => {
        toastTimer = null;
        toast.setAttribute('data-visible', 'false');
        toast.removeAttribute('data-tag');
        if (rightSlot) rightSlot.removeAttribute('data-toast-active');
      }, durationMs);
    }
  }

  const BUILTIN_SLASH_COMMAND_RE = /^\/(compact|plan|goal|swarm|boost|teamwork|grill-me|btw|learn|browser|schedule)\s*$/i;

  function findMatchingSlashOption(cmdName) {
    const lower = String(cmdName || '').trim().toLowerCase();
    if (!lower) return null;
    const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]') || []);
    for (const opt of opts) {
      const hasExactNode = Array.from(opt.querySelectorAll?.('span, div') || []).some(
        (el) => (!el.children || el.children.length === 0) && String(el.textContent || '').trim().toLowerCase() === lower
      );
      if (hasExactNode) return opt;
      const full = String(opt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (full === lower || full.startsWith(`${lower} `) || full.startsWith(lower)) {
        return opt;
      }
    }
    return null;
  }

  async function fillComposerText(text, opts = {}) {
    const ed = getComposerEditor() || document.querySelector('[contenteditable="true"]');
    if (!ed) {
      showQuickToast('未找到聊天输入框');
      return false;
    }

    const insertTextWithFallback = async (val, lex) => {
      const str = String(val ?? '');
      const trimmedExpected = str.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
      const execOk = str ? document.execCommand('insertText', false, str) : true;
      await new Promise((r) => setTimeout(r, 25));
      const actualClean = String(ed.textContent || '').replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
      const insertedByExec = Boolean(execOk && (!trimmedExpected || actualClean.includes(trimmedExpected.slice(0, 12))));
      if (str && !insertedByExec) {
        const PNode = lex?._nodes?.get?.('paragraph')?.klass;
        const TNode = lex?._nodes?.get?.('text')?.klass;
        const LBNode = lex?._nodes?.get?.('linebreak')?.klass;
        if (lex && typeof lex.update === 'function' && PNode && TNode) {
          lex.update(() => {
            const root = lex.getEditorState()?._nodeMap?.get('root');
            const wRoot = root?.getWritable ? root.getWritable() : root;
            if (!wRoot || typeof wRoot.append !== 'function') return;
            if (typeof wRoot.clear === 'function') wRoot.clear();
            const p = new PNode();
            str.split(/\r?\n/).forEach((ln, idx) => {
              if (idx > 0 && LBNode) p.append(new LBNode());
              if (ln) p.append(new TNode(ln));
            });
            wRoot.append(p);
            if (typeof p.selectEnd === 'function') p.selectEnd();
          });
        } else {
          try {
            const ev = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: str
            });
            ed.dispatchEvent(ev);
          } catch {}
        }
      } else if (!str && lex && typeof lex.update === 'function') {
        const PNode = lex?._nodes?.get?.('paragraph')?.klass;
        if (PNode) {
          lex.update(() => {
            const root = lex.getEditorState()?._nodeMap?.get('root');
            const wRoot = root?.getWritable ? root.getWritable() : root;
            if (wRoot && typeof wRoot.clear === 'function') {
              wRoot.clear();
              wRoot.append(new PNode());
            }
          });
        }
      }
    };

    try {
      const lex = ed.__lexicalEditor;
      if (lex && typeof lex.update === 'function') {
        try {
          lex.update(() => {
            const edState = lex._pendingEditorState || lex.getEditorState?.();
            const root = edState?._nodeMap?.get('root');
            if (root && typeof root.clear === 'function') {
              root.clear();
            }
          }, { discrete: true });
          await new Promise((r) => setTimeout(r, 20));
        } catch {}
      }
      if (!lex || (ed.textContent || '').trim() || ed.querySelector?.('[data-uri]')) {
        ed.focus?.();
        document.execCommand?.('selectAll', false, null);
        document.execCommand?.('delete', false, null);
        if (lex) await new Promise((r) => setTimeout(r, 15));
      }

      ed.focus?.();
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(ed);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      const rawStr = String(text ?? '');
      const slashCmd = opts?.slashCommand
        ? String(opts.slashCommand).trim().toLowerCase()
        : (rawStr.match(BUILTIN_SLASH_COMMAND_RE)?.[1]?.toLowerCase() || '');
      const initialInsert = slashCmd ? `/${slashCmd}` : rawStr;

      await insertTextWithFallback(initialInsert, lex);

      let convertedSlashPill = false;
      if (slashCmd) {
        let matchedOpt = findMatchingSlashOption(slashCmd);
        if (!matchedOpt && lex) {
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 25));
            matchedOpt = findMatchingSlashOption(slashCmd);
            if (matchedOpt) break;
          }
        }
        if (matchedOpt) {
          const clickTarget = matchedOpt.querySelector?.('div.cursor-pointer') || matchedOpt;
          try {
            if (typeof MouseEvent === 'function') {
              clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            }
          } catch {}
          clickTarget.click?.();
          await new Promise((r) => setTimeout(r, 35));
          convertedSlashPill = true;
        } else if (rawStr !== initialInsert) {
          ed.focus?.();
          document.execCommand?.('selectAll', false, null);
          document.execCommand?.('delete', false, null);
          await insertTextWithFallback(rawStr, lex);
        }
      }

      // 确保光标位于内容末尾
      try {
        const endRange = document.createRange();
        endRange.selectNodeContents(ed);
        endRange.collapse(false);
        const s2 = window.getSelection();
        if (s2) {
          s2.removeAllRanges();
          s2.addRange(endRange);
        }
      } catch {}
      syncPromptOptimizerUI();
      return convertedSlashPill ? 'slash_pill' : true;
    } catch {
      showQuickToast('填入输入框失败');
      return false;
    }
  }

  function getComposerDraftText() {
    const ed = getComposerEditor() || document.querySelector('[contenteditable="true"]');
    if (!ed) return '';
    const txt = String(ed.innerText || ed.textContent || '').replace(/\u200B/g, '').trim();
    if (txt) return txt;
    const hasInlineChip = Boolean(
      ed.getAttribute?.('data-converted-slash') ||
      ed.querySelector?.('[data-uri], [data-converted-slash], [data-lexical-decorator="true"]')
    );
    return hasInlineChip ? '__inline_chip__' : '';
  }

  function isDraftSameAsQuickTarget(draft, fillText, slash) {
    if (!draft) return true;
    const normDraft = String(draft).trim();
    const normTarget = String(fillText || '').trim();
    if (normDraft === normTarget) return true;
    if (slash) {
      const s = String(slash).trim().toLowerCase();
      if (normDraft.toLowerCase() === s || normDraft.toLowerCase() === `/${s}`) return true;
      const ed = getComposerEditor() || document.querySelector('[contenteditable="true"]');
      if (ed && String(ed.getAttribute?.('data-converted-slash') || '').toLowerCase() === s) {
        if (normDraft === '__inline_chip__' || normDraft.toLowerCase() === s) return true;
      }
    }
    return false;
  }

  function findComposerSendButton() {
    return (
      document.querySelector('.surface-composer [data-testid="send-button"]') ||
      document.querySelector('.surface-composer .agy-send-button') ||
      document.querySelector('.surface-composer button[aria-label*="Send"], .surface-composer button[aria-label*="发送"]')
    );
  }

  function isComposerSendButtonDisabled(btn) {
    if (!btn) return true;
    return Boolean(btn.disabled || btn.getAttribute?.('aria-disabled') === 'true');
  }

  async function submitCurrentComposer(opts = {}) {
    const allowEnterFallback = opts.allowEnterFallback !== false;
    const allowEnterOnDisabled = Boolean(opts.allowEnterOnDisabled);
    const checkBusyOnEnter = opts.checkBusyOnEnter !== false;
    let sendBtn = null;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 35));
      sendBtn = findComposerSendButton();
      if (sendBtn && !isComposerSendButtonDisabled(sendBtn)) break;
    }
    if (sendBtn && !isComposerSendButtonDisabled(sendBtn)) {
      sendBtn.click();
      lastUserSubmitAt = Date.now();
      hideNextStepGhost();
      return { ok: true, method: 'button' };
    }
    if (sendBtn && isComposerSendButtonDisabled(sendBtn) && !allowEnterOnDisabled) {
      return { ok: false, reason: 'send_disabled', error: '当前发送按钮不可用' };
    }
    if (!allowEnterFallback) {
      return { ok: false, reason: 'no_send_button', error: '未找到发送按钮' };
    }
    if (checkBusyOnEnter && isAssistantBusy()) {
      return { ok: false, reason: 'assistant_busy', error: '智能体正在响应中' };
    }
    const ed = getComposerEditor();
    if (ed) {
      ed.focus?.();
      const evOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      if (typeof KeyboardEvent === 'function') {
        ed.dispatchEvent(new KeyboardEvent('keydown', evOpts));
        ed.dispatchEvent(new KeyboardEvent('keyup', evOpts));
      } else {
        ed.dispatchEvent({ type: 'keydown', ...evOpts });
        ed.dispatchEvent({ type: 'keyup', ...evOpts });
      }
      lastUserSubmitAt = Date.now();
      hideNextStepGhost();
      return { ok: true, method: 'enter' };
    }
    return { ok: false, reason: 'no_composer', error: '未找到发送按钮或输入框' };
  }

  function showQuickFillSuccessToast({ id, slash, label, fillRes }) {
    if (id === 'compact') {
      showQuickToast(
        fillRes === 'slash_pill'
          ? tr('已生成 /compact 压缩指令，按回车即可执行', 'Ready: /compact command, press Enter to run')
          : tr('已填入 /compact，按回车即可执行', 'Inserted /compact, press Enter to run')
      );
    } else if (slash) {
      showQuickToast(
        fillRes === 'slash_pill'
          ? tr(`已生成 /${slash} 指令，输入需求后发送`, `Ready: /${slash} command, enter your prompt`)
          : tr(`已填入 /${slash} ，请输入需求后发送`, `Inserted /${slash} , enter your prompt`)
      );
    } else if (id === 'reload') {
      showQuickToast(tr('已填入重载规则指令，按回车即可发送', 'Inserted reload rules prompt, press Enter'));
    } else {
      showQuickToast(tr(`已填入「${label}」`, `Inserted "${label}"`));
    }
  }

  async function runQuickPromptAction({ fillText, slash = '', label = '', id = '', defaultAutoSend = false, event = null, triggerBtn = null }) {
    const invert = Boolean(event && (event.metaKey || event.ctrlKey));
    const shouldAutoSend = invert ? !Boolean(defaultAutoSend) : Boolean(defaultAutoSend);
    if (!shouldAutoSend) {
      const fillRes = await fillComposerText(fillText, slash ? { slashCommand: slash } : {});
      if (!fillRes) return false;
      showQuickFillSuccessToast({ id, slash, label, fillRes });
      return true;
    }

    const actionBtn = (triggerBtn && triggerBtn.nodeType === 1)
      ? triggerBtn
      : ((event?.currentTarget && event.currentTarget.nodeType === 1) ? event.currentTarget : null);

    if (quickAutoSendInFlight || Date.now() < quickAutoSendLockUntil) {
      if (actionBtn?.setAttribute) actionBtn.setAttribute('data-sending', 'true');
      return false;
    }

    const draft = getComposerDraftText();
    if (draft && !isDraftSameAsQuickTarget(draft, fillText, slash)) {
      showQuickToast(
        tr(
          '⚠️ 输入框已有草稿，为防覆盖已跳过直发（清空后重试，或 ⌘/Ctrl+点击仅填入）',
          '⚠️ Draft detected in composer; skipped auto-send to avoid overwriting'
        ),
        3600
      );
      return false;
    }

    quickAutoSendInFlight = true;
    quickAutoSendLockUntil = Date.now() + 800;
    if (actionBtn?.setAttribute) actionBtn.setAttribute('data-sending', 'true');
    if (quickAutoSendLockTimer) {
      clearTimeout(quickAutoSendLockTimer);
      quickAutoSendLockTimer = null;
    }
    quickAutoSendLockTimer = setTimeout(() => {
      quickAutoSendLockTimer = null;
      if (!quickAutoSendInFlight && actionBtn?.removeAttribute) {
        actionBtn.removeAttribute('data-sending');
      }
    }, 800);
    try {
      const fillRes = await fillComposerText(fillText, slash ? { slashCommand: slash } : {});
      if (!fillRes) return false;
      const sendRes = await submitCurrentComposer();
      if (sendRes?.ok) {
        if (id === 'compact') {
          showQuickToast(tr('⚡ 已直接发送 /compact 压缩', '⚡ Sent /compact'));
        } else {
          showQuickToast(tr(`⚡ 已直接发送「${label}」`, `⚡ Sent "${label}"`));
        }
        return true;
      }
      showQuickToast(
        tr(
          `已填入「${label}」（当前发送不可用，请手动回车）`,
          `Inserted "${label}" (send unavailable, press Enter)`
        ),
        3200
      );
      return false;
    } finally {
      quickAutoSendInFlight = false;
      if (Date.now() >= quickAutoSendLockUntil && actionBtn?.removeAttribute) {
        actionBtn.removeAttribute('data-sending');
      }
    }
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function getSessionIdFromLocation() {
    const pathname = String(location?.pathname || '');
    const m = pathname.match(/\/c\/([0-9a-fA-F-]{8,})/);
    return m ? m[1] : null;
  }

  function parseProjectIdFromHref(href) {
    const s = String(href || '');
    const m = s.match(/[?&]project=([^&#]+)/);
    if (!m || !m[1]) return '';
    try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
  }

  function getProjectIdFromLocation() {
    try {
      const rawSearch = String(location?.search || '').trim();
      if (!rawSearch) return '';
      const q = rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`;
      return parseProjectIdFromHref(q);
    } catch {
      return '';
    }
  }

  function extractDomFallbackMarkdown(sessionId) {
    const blocks = [];
    const header = [
      tr('# Antigravity 会话记录（页面回退导出）', '# Antigravity 会话记录（页面回退导出）'),
      '',
      `- ${tr('会话 ID', '会话 ID')}: \`${sessionId || 'unknown'}\``,
      `- ${tr('导出时间', '导出时间')}: ${new Date().toLocaleString(uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN', { hour12: false })}`,
      '',
      '---',
      ''
    ].join('\n');
    const main = document.querySelector('main') || document.body;
    const text = (main?.innerText || '').trim();
    blocks.push(text);
    return header + blocks.join('\n\n') + '\n';
  }

  function triggerBrowserDownload(filename, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportMarkdown() {
    const id = getSessionIdFromLocation();
    if (!id) {
      showQuickToast('当前页面未包含会话 ID');
      return { ok: false, error: '当前页面未包含会话 ID' };
    }

    const live = window.__AGContextMeterLive;
    if (live?.port && live?.token) {
      try {
        showQuickToast('正在导出会话 Markdown…');
        const resp = await fetch(`http://127.0.0.1:${live.port}/export-markdown`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AG-Context-Token': live.token
          },
          body: JSON.stringify({ id })
        });
        const data = await resp.json();
        if (data && data.ok && typeof data.markdown === 'string') {
          const copied = await copyToClipboard(data.markdown);
          showQuickToast(copied ? '已导出至 ~/Downloads 并复制 Markdown' : `已导出至 ${data.savedPath}`);
          return data;
        }
        throw new Error(data?.error || '导出失败');
      } catch (err) {
        // 若本地伴侣服务异常，回退 DOM 导出
        const md = extractDomFallbackMarkdown(id);
        await copyToClipboard(md);
        triggerBrowserDownload(`antigravity-session-${id.slice(0, 8)}.md`, md);
        showQuickToast(`已回退下载 Markdown（${err?.message || '本地服务暂不可用'}）`);
        return { ok: true, fallback: true, markdown: md };
      }
    }

    const md = extractDomFallbackMarkdown(id);
    await copyToClipboard(md);
    triggerBrowserDownload(`antigravity-session-${id.slice(0, 8)}.md`, md);
    showQuickToast('已提取对话并下载 Markdown');
    return { ok: true, fallback: true, markdown: md };
  }

  const HIGH_RISK_RULES = [
    { label: 'rm -r / rm -rf', re: /(?:^|[\s;|&`(])rm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/ },
    { label: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/ },
    { label: 'git clean -f', re: /\bgit\s+clean\s+-[a-zA-Z]*f/ },
    { label: 'git push', re: /\bgit\s+push\b/ },
    { label: 'git checkout -- / restore', re: /\bgit\s+(?:checkout\s+--|restore)\b/ },
    { label: 'sudo / mkfs / dd', re: /(?:^|[\s;|&`(])(?:sudo|mkfs(?:\.\w+)?)\b|\bdd\s+if=/ },
    { label: 'kill -9 / pkill / killall', re: /(?:^|[\s;|&`(])(?:kill\s+-9|pkill|killall)\b/ },
    { label: 'SQL DROP / TRUNCATE / DELETE', re: /\b(?:DROP\s+(?:TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i },
    { label: '1Password op item 变更', re: /\bop\s+item\s+(?:delete|edit|create)\b/ }
  ];

  function detectHighRiskLabels(text) {
    if (!text || text.length < 4) return [];
    const hits = [];
    for (const rule of HIGH_RISK_RULES) {
      if (rule.re.test(text)) hits.push(rule.label);
    }
    return hits;
  }

  const highRiskScanMemo = new WeakMap();

  function scanHighRiskCommands() {
    if (disposed) return 0;
    const viewport = document.querySelector('[data-testid="autoscroll-viewport"]');
    if (!viewport) return 0;
    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    const targets = viewport.querySelectorAll('pre, code, [data-testid="tool-group-collapsible"]');
    let markedCount = 0;

    for (const el of targets) {
      if (el.closest('[data-testid="user-message"], .ag-risk-banner')) continue;
      if (el.tagName === 'CODE' && el.closest('pre, [data-testid="tool-group-collapsible"]')) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if (el.tagName === 'CODE' && text.length > 220) continue;

      const isInlineCode = el.tagName === 'CODE';
      const card = isInlineCode ? el : (el.closest('[data-testid="turn-cards-container"]') || el);
      const memoSig = `${text.length}:${text.slice(0, 48)}:${text.slice(-32)}|${theme}`;
      const memo = highRiskScanMemo.get(el);
      if (memo && memo.sig === memoSig) {
        if (!memo.marked || card.getAttribute('data-ag-risk-card') === 'high') {
          if (memo.marked) markedCount++;
          continue;
        }
      }

      const hits = detectHighRiskLabels(text);
      if (!hits.length) {
        highRiskScanMemo.set(el, { sig: memoSig, marked: false });
        continue;
      }

      const summary = hits.slice(0, 3).join('、');

      if (card.getAttribute('data-ag-risk-card') !== 'high') {
        card.setAttribute('data-ag-risk-card', 'high');
      }
      const riskWarnText = tr(`🛡️ 高危命令预警：检测到 ${summary}，请人工核对`, `🛡️ High-risk command warning: detected ${summary}, please verify manually`);
      if (isInlineCode) {
        card.setAttribute('title', riskWarnText);
      } else {
        let banner = card.querySelector(':scope > .ag-risk-banner');
        if (!banner && card.parentElement && card.previousElementSibling?.classList?.contains('ag-risk-banner')) {
          banner = card.previousElementSibling;
        }
        const expectedText = riskWarnText;
        if (!banner) {
          banner = document.createElement('div');
          banner.className = 'ag-risk-banner';
          banner.textContent = expectedText;
          if (card.tagName === 'BUTTON' || card.tagName === 'PRE') {
            card.parentElement?.insertBefore(banner, card);
          } else {
            card.insertBefore(banner, card.firstChild);
          }
        } else if (banner.textContent !== expectedText) {
          banner.textContent = expectedText;
        }
        if (banner.getAttribute('data-ag-theme') !== theme) {
          banner.setAttribute('data-ag-theme', theme);
        }
      }
      highRiskScanMemo.set(el, { sig: memoSig, marked: true });
      markedCount++;
    }
    return markedCount;
  }

  function getPreferredScrollBehavior() {
    try {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        return 'auto';
      }
    } catch {}
    return 'smooth';
  }

  function getScrollViewport() {
    return document.querySelector('[data-testid="autoscroll-viewport"]');
  }

  function scrollToTop() {
    const vp = getScrollViewport();
    if (vp) vp.scrollTo({ top: 0, behavior: getPreferredScrollBehavior() });
  }

  function scrollToPrevTurn() {
    const vp = getScrollViewport();
    if (!vp) return;
    const vpRect = vp.getBoundingClientRect();
    const msgs = Array.from(vp.querySelectorAll('[data-testid="user-message"]'));
    let targetTop = 0;
    for (const msg of msgs) {
      const r = msg.getBoundingClientRect();
      const relTop = r.top - vpRect.top + vp.scrollTop;
      if (relTop < vp.scrollTop - 16) {
        targetTop = Math.max(0, relTop - 12);
      }
    }
    vp.scrollTo({ top: targetTop, behavior: getPreferredScrollBehavior() });
  }

  function scrollToNextTurn() {
    const vp = getScrollViewport();
    if (!vp) return;
    const vpRect = vp.getBoundingClientRect();
    const msgs = Array.from(vp.querySelectorAll('[data-testid="user-message"]'));
    for (const msg of msgs) {
      const r = msg.getBoundingClientRect();
      const relTop = r.top - vpRect.top + vp.scrollTop;
      if (relTop > vp.scrollTop + 24) {
        vp.scrollTo({ top: Math.max(0, relTop - 12), behavior: getPreferredScrollBehavior() });
        return;
      }
    }
    vp.scrollTo({ top: vp.scrollHeight, behavior: getPreferredScrollBehavior() });
  }

  function scrollToNextOrBottom() {
    const vp = getScrollViewport();
    if (!vp) return;
    vp.scrollTo({ top: vp.scrollHeight, behavior: getPreferredScrollBehavior() });
  }

  function setNavBtnContent(btn, iconSvg, text) {
    if (!btn) return;
    if (btn._navIconSvg === iconSvg && btn._navLabelText === text && btn.children?.length >= 2) return;
    btn._navIconSvg = iconSvg;
    btn._navLabelText = text;
    btn.textContent = '';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'ag-nav-icon';
    iconSpan.innerHTML = iconSvg;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ag-nav-label';
    labelSpan.textContent = text;
    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
  }

  function updateThinkToggleLabel() {
    const btn = document.getElementById('ag-nav-think');
    if (!btn) return;
    const triggers = Array.from(document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]'));
    const hasCollapsed = triggers.some((t) => t.getAttribute('aria-expanded') !== 'true');
    setNavBtnContent(
      btn,
      CHAT_NAV_ICONS.think,
      hasCollapsed || triggers.length === 0
        ? tr('展开思考', 'Expand Thoughts')
        : tr('收起思考', 'Collapse Thoughts')
    );
  }

  function toggleAllThinking() {
    const triggers = Array.from(document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]'));
    if (!triggers.length) {
      showQuickToast('当前对话暂无可展开的思考块');
      return 0;
    }
    const hasCollapsed = triggers.some((t) => t.getAttribute('aria-expanded') !== 'true');
    let toggled = 0;
    for (const trg of triggers) {
      const key = getThinkingTriggerKey(trg);
      if (hasCollapsed) {
        if (key) {
          userCollapsedThinkingKeys.delete(key);
          keepExpandedThinkingKeys.add(key);
        }
      } else if (key) {
        keepExpandedThinkingKeys.delete(key);
        userCollapsedThinkingKeys.add(key);
      }
      const expanded = trg.getAttribute('aria-expanded') === 'true';
      if ((hasCollapsed && !expanded) || (!hasCollapsed && expanded)) {
        trg.click();
        toggled++;
      }
      if (hasCollapsed) disarmThinkingAutoCollapse(trg);
    }
    updateThinkToggleLabel();
    if (hasCollapsed) {
      setTimeout(() => {
        if (!disposed) {
          localizeThinkingShells();
          void translateExpandedThoughts();
        }
      }, 80);
    }
    return toggled;
  }

  function positionChatNavFloat(nav) {
    if (!nav) return;
    const openModal = typeof document.querySelector === 'function'
      ? document.querySelector('[aria-modal="true"]:not([hidden])')
      : null;
    if (openModal && openModal.offsetWidth > 0 && openModal.offsetHeight > 0) {
      nav.hidden = true;
      return;
    }
    const vp = getScrollViewport();
    if (!vp) {
      nav.hidden = true;
      return;
    }
    const vpRect = vp.getBoundingClientRect();
    if (vpRect.width < 120 || vpRect.height < 120) {
      nav.hidden = true;
      return;
    }
    nav.hidden = false;
    const composer = document.querySelector('.surface-composer');
    const composerRect = composer?.getBoundingClientRect();
    const quickBar = document.getElementById(QUICK_BAR_ID);
    const quickBarRect = quickBar?.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const hasRightMargin = composerRect && composerRect.width > 0 && (vpRect.right - composerRect.right >= 42);
    const composerTop = (composerRect && composerRect.height > 0) ? composerRect.top : null;
    const upperTop = (composerTop !== null && quickBarRect && quickBarRect.height > 0)
      ? Math.min(composerTop, quickBarRect.top)
      : composerTop;
    const bottomAnchor = upperTop !== null ? (upperTop - 8) : vpRect.bottom;
    const top = Math.min(window.innerHeight - navRect.height - 8, Math.max(vpRect.top + 12, bottomAnchor - navRect.height));
    if (hasRightMargin) {
      nav.style.right = 'auto';
      nav.style.left = `${Math.round(composerRect.right + 10)}px`;
    } else {
      const right = Math.max(6, window.innerWidth - vpRect.right + 6);
      nav.style.left = 'auto';
      nav.style.right = `${Math.round(right)}px`;
    }
    nav.style.top = `${Math.round(top)}px`;
  }

  function getChatNavDefinitions() {
    return [
      { id: 'ag-nav-top', icon: CHAT_NAV_ICONS.top, text: tr('顶部', 'Top'), title: tr('跳回当前对话最顶部', 'Scroll to top'), onClick: scrollToTop },
      { id: 'ag-nav-prev', icon: CHAT_NAV_ICONS.prev, text: tr('上一轮', 'Prev'), title: tr('跳到上一条用户提问', 'Previous turn'), onClick: scrollToPrevTurn },
      { id: 'ag-nav-next', icon: CHAT_NAV_ICONS.next, text: tr('下一轮', 'Next'), title: tr('跳到下一条用户提问', 'Next turn'), onClick: scrollToNextTurn },
      { id: 'ag-nav-bottom', icon: CHAT_NAV_ICONS.bottom, text: tr('底部', 'Bottom'), title: tr('直达最新回复底部', 'Scroll to bottom'), onClick: scrollToNextOrBottom },
      { id: 'ag-nav-think', icon: CHAT_NAV_ICONS.think, text: tr('展开思考', 'Expand Thoughts'), title: tr('一键展开或收起当前对话全部思考过程', 'Toggle all thought blocks'), onClick: () => { toggleAllThinking(); } }
    ];
  }

  function updateChatNavLanguage() {
    const nav = document.getElementById(CHAT_NAV_ID);
    if (!nav) return;
    nav.setAttribute('aria-label', tr('长对话快捷导航', 'Chat Quick Navigation'));
    for (const item of getChatNavDefinitions()) {
      const btn = document.getElementById(item.id);
      if (!btn) continue;
      if (item.id !== 'ag-nav-think') setNavBtnContent(btn, item.icon, item.text);
      btn.title = item.title;
    }
    updateThinkToggleLabel();
  }

  function ensureChatNavFloat() {
    if (disposed || featureFlags.showChatNav === false) return;
    ensureDocStyle();
    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    const vp = getScrollViewport();
    const mountRoot = vp?.closest?.('.agy-sheet')
      || (typeof document.querySelector === 'function' ? document.querySelector('.agy-sheet') : null)
      || document.body;
    let nav = document.getElementById(CHAT_NAV_ID);
    if (!nav) {
      nav = document.createElement('div');
      nav.id = CHAT_NAV_ID;
      nav.setAttribute('aria-label', tr('长对话快捷导航', 'Chat Quick Navigation'));
      for (const item of getChatNavDefinitions()) {
        const btn = document.createElement('button');
        btn.id = item.id;
        btn.type = 'button';
        btn.className = 'ag-nav-btn';
        setNavBtnContent(btn, item.icon, item.text);
        btn.title = item.title;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', item.onClick);
        nav.appendChild(btn);
      }
      mountRoot.appendChild(nav);
    } else if (mountRoot && nav.parentElement !== mountRoot) {
      mountRoot.appendChild(nav);
    }
    if (nav.getAttribute('data-ag-theme') !== theme) {
      nav.setAttribute('data-ag-theme', theme);
    }
    updateThinkToggleLabel();
    positionChatNavFloat(nav);
  }

  const AUTO_ACCEPT_WHITELIST = new Set([
    'proceed', 'accept', 'accept all', 'accept changes', 'accept step', 'allow once',
    '继续', '接受', '全部接受', '接受更改', '接受此步骤', '允许一次'
  ]);
  const AUTO_ACCEPT_BLACKLIST = /\b(delete|remove|reject|deny|cancel|stop|abort|discard|reset|uninstall|kill|terminate|revoke)\b|删除|移除|拒绝|取消|停止|中止|丢弃|重置|卸载|终止|撤销/i;

  function runAutoAcceptTick() {
    if (!autoAcceptEnabled || disposed) return;
    scanHighRiskCommands();
    const container = document.querySelector('main') || document.body;
    if (!container) return;
    const now = Date.now();
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.closest(`#${QUICK_BAR_ID}, #${CHAT_NAV_ID}, #${METER_HOST_ID}, [data-agy-hans-ui], [data-agy-context-capsule]`)) continue;
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      if (btn.offsetWidth <= 0 || btn.offsetHeight <= 0) continue;
      const rawText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length > 32) continue;
      if (AUTO_ACCEPT_BLACKLIST.test(rawText)) continue;
      if (!AUTO_ACCEPT_WHITELIST.has(rawText.toLowerCase())) continue;
      const cardScope = btn.closest('[data-testid="agent-response"], [data-testid="turn-cards-container"], [role="dialog"]');
      if (cardScope && cardScope.querySelector('[data-ag-risk-card="high"]')) {
        const lastWarn = autoClickedButtons.get(btn) || 0;
        if (now - lastWarn >= 5000) {
          autoClickedButtons.set(btn, now);
          showQuickToast('⚠️ 检测到高危命令，已跳过自动确认');
        }
        continue;
      }
      const lastClicked = autoClickedButtons.get(btn) || 0;
      if (now - lastClicked < 3000) continue;
      autoClickedButtons.set(btn, now);
      try {
        btn.click();
        showQuickToast(`已自动确认: ${rawText}`);
      } catch {}
    }
  }

  function updateAutoAcceptBtn() {
    const btn = document.getElementById('ag-qcap-autoaccept');
    if (!btn) return;
    btn.textContent = autoAcceptEnabled ? tr('自动确认: 开', 'Auto-Accept: ON') : tr('自动确认: 关', 'Auto-Accept: OFF');
    btn.setAttribute('data-active', autoAcceptEnabled ? 'true' : 'false');
    btn.title = autoAcceptEnabled
      ? tr('自动确认已开启（仅点击 Proceed / Accept / 继续 等安全步骤按钮）；点击关闭', 'Auto-Accept enabled for safe Proceed / Accept buttons; click to disable')
      : tr('开启后自动点击对话中的 Proceed / Accept / 继续 等确认按钮（默认关闭）', 'Enable auto-clicking Proceed / Accept confirmation buttons (off by default)');
  }

  function formatBrainTooltip(stats) {
    if (!stats || !stats.ok) return tr('点击查询历史会话本地缓存大小', 'Click to check local session cache size');
    const lines = [tr(`本地会话缓存：共 ${stats.count} 个对话，合计 ${stats.totalMB} MB`, `Session cache: ${stats.count} chats, ${stats.totalMB} MB total`)];
    if (Array.isArray(stats.topSessions) && stats.topSessions.length) {
      lines.push('', tr('占用 Top 5：', 'Top 5 sessions:'));
      stats.topSessions.forEach((s, idx) => {
        lines.push(`${idx + 1}. ${s.title || s.shortId} (${s.shortId}) — ${s.mb} MB`);
      });
    }
    lines.push('', tr('目录：~/.gemini/antigravity/brain（只读统计，点击刷新并复制明细）', 'Path: ~/.gemini/antigravity/brain (read-only, click to refresh & copy)'));
    return lines.join('\n');
  }

  async function refreshBrainStats(showDetailToast = false) {
    const res = await postToLiveHost('/brain-stats', {});
    if (!res || !res.ok) {
      if (showDetailToast) showQuickToast(tr('缓存统计获取失败（本地服务未连接）', 'Failed to fetch cache stats (service offline)'));
      return null;
    }
    latestBrainStats = res;
    const btn = document.getElementById('ag-qcap-brain');
    if (btn) {
      btn.textContent = tr(`缓存 ${res.totalMB}MB`, `Cache ${res.totalMB}MB`);
      btn.title = formatBrainTooltip(res);
    }
    if (showDetailToast) {
      const summary = formatBrainTooltip(res);
      await copyToClipboard(summary);
      const top1 = res.topSessions && res.topSessions[0];
      showQuickToast(
        top1
          ? tr(`共 ${res.count} 个会话 (${res.totalMB}MB)，最大: ${top1.title} (${top1.mb}MB)，明细已复制`, `${res.count} sessions (${res.totalMB}MB), largest: ${top1.title} (${top1.mb}MB), copied`)
          : tr(`共 ${res.count} 个会话 (${res.totalMB}MB)，明细已复制`, `${res.count} sessions (${res.totalMB}MB), copied`)
      );
    }
    return res;
  }

  function buildCompactBtnTitle(risk = null) {
    const autoTag = autoCompactEnabled
      ? tr('（已开启 240K 自动压缩，可在套件设置关闭）', ' (240K Auto-Compact ON)')
      : tr('（240K 自动压缩已关闭，可在套件设置开启）', ' (240K Auto-Compact OFF)');
    if (risk?.cacheDropDetected) {
      return tr(
        '⚠ 检测到缓存已失效（命中率归零），每步需重读全部前文约 4~5 分钟并消耗大量额度，建议立即发 /compact 压缩',
        '⚠ Cache expired (0% hit), causing 4-5m stalls & heavy quota drain. Run /compact now'
      ) + autoTag;
    }
    if ((risk?.contextUsed || 0) >= 328000) {
      return tr(
        '⚠ 上下文已超 328K（官方要到 512K 才压缩，此时停顿超 3 分钟极易触发缓存失效变慢），建议尽快发 /compact 压缩',
        '⚠ Above 328K (client waits until 512K; >3m idle stalls 4-5m). Run /compact soon'
      ) + autoTag;
    }
    if ((risk?.contextUsed || 0) >= 240000 || (risk?.percent || 0) >= 70) {
      return tr(
        '⚡ 上下文已超 240K（官方默认 512K 才压缩），现在压缩可避免后续缓存失效卡顿',
        '⚡ Above 240K (official threshold is 512K); compacting now prevents 300K+ stalls'
      ) + autoTag;
    }
    return tr(
      '快速填入 /compact 压缩上下文（官方默认 512K 才自动压缩，超 240K 后一旦缓存失效会每步卡顿 4~5 分钟；可在套件设置开关 240K 自动压缩）',
      'Fill /compact command (official auto-compact waits until 512K; compacting around 240K prevents 4-5m cache-expired stalls)'
    ) + autoTag;
  }

  function hideQuickBarTooltip() {
    const tip = document.getElementById(QUICK_BAR_TOOLTIP_ID);
    if (tip) tip.hidden = true;
  }

  function showQuickBarTooltip(anchorBtn, act) {
    if (disposed || !anchorBtn || !act) return;
    ensureDocStyle();
    const { host } = getMeterHostAndShadow();
    const theme = resolveHostTheme(host);
    let tip = document.getElementById(QUICK_BAR_TOOLTIP_ID);
    if (!tip) {
      tip = document.createElement('div');
      tip.id = QUICK_BAR_TOOLTIP_ID;
      tip.setAttribute('role', 'tooltip');

      const topRow = document.createElement('div');
      topRow.className = 'ag-qtip-top';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'ag-qtip-title-wrap';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'ag-qtip-title';

      const recSpan = document.createElement('span');
      recSpan.className = 'ag-qtip-rec';

      titleWrap.appendChild(titleSpan);
      titleWrap.appendChild(recSpan);

      const tagSpan = document.createElement('span');
      tagSpan.className = 'ag-qtip-tag';

      topRow.appendChild(titleWrap);
      topRow.appendChild(tagSpan);

      const roleDiv = document.createElement('div');
      roleDiv.className = 'ag-qtip-role';

      const sceneDiv = document.createElement('div');
      sceneDiv.className = 'ag-qtip-scene';

      tip.appendChild(topRow);
      tip.appendChild(roleDiv);
      tip.appendChild(sceneDiv);
      (document.body || document.documentElement)?.appendChild(tip);
    }

    const titleEl = tip.querySelector('.ag-qtip-title');
    const recEl = tip.querySelector('.ag-qtip-rec');
    const tagEl = tip.querySelector('.ag-qtip-tag');
    const roleEl = tip.querySelector('.ag-qtip-role');
    const sceneEl = tip.querySelector('.ag-qtip-scene');

    if (titleEl) titleEl.textContent = act.label || '';
    if (recEl) {
      if (act.rec) {
        recEl.textContent = act.rec;
        recEl.hidden = false;
      } else {
        recEl.textContent = '';
        recEl.hidden = true;
      }
    }
    if (tagEl) {
      tagEl.textContent = act.tag
        ? (act.isCustom ? act.tag : `${tr('推荐用途：', 'Use case: ')}${act.tag}`)
        : '';
    }
    if (roleEl) {
      roleEl.textContent = act.role ? `${tr('作用：', 'Role: ')}${act.role}` : (act.title || '');
    }
    if (sceneEl) {
      let sceneText = act.scene || '';
      if (act.poolId === 'compact') {
        const risk = extractContextRiskState();
        const autoStr = autoCompactEnabled
          ? tr('240K 自动压缩: 已开启', '240K Auto-Compact: ON')
          : tr('240K 自动压缩: 已关闭', '240K Auto-Compact: OFF');
        if (risk.cacheDropDetected) {
          sceneText = tr('⚠️ 当前检测到缓存已失效，建议立刻执行 /compact 压缩！', '⚠️ Cache expired — run /compact immediately!');
        } else if (risk.contextUsed >= 240000) {
          sceneText = tr(`当前已达 ${Math.round(risk.contextUsed / 1000)}K，建议尽快压缩 · ${autoStr}`, `At ${Math.round(risk.contextUsed / 1000)}K — compact soon · ${autoStr}`);
        } else {
          sceneText = `${sceneText}（${autoStr}）`;
        }
      }
      if (sceneText) {
        sceneEl.textContent = act.isCustom
          ? `${tr('内容：', 'Prompt: ')}${sceneText}`
          : `${tr('场景：', 'When to use: ')}${sceneText}`;
        sceneEl.hidden = false;
      } else {
        sceneEl.textContent = '';
        sceneEl.hidden = true;
      }
    }

    tip.setAttribute('data-ag-theme', theme);
    tip.hidden = false;

    try {
      if (typeof anchorBtn.getBoundingClientRect === 'function') {
        const rect = anchorBtn.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const tipW = tip.offsetWidth || 360;
        const tipH = tip.offsetHeight || 68;
        const left = Math.max(12, Math.min(vw - tipW - 12, Math.round(rect.left || 12)));
        const top = Math.max(8, Math.round((rect.top || 76) - tipH - 7));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }
    } catch {}
  }

  function getQuickBarActions() {
    const actions = [];
    for (const item of BUILTIN_QUICK_POOL) {
      if (quickPoolState[item.id] === false) continue;
      const btnId = `ag-qcap-${item.id}`;
      const label = item.labelEn ? tr(item.label, item.labelEn) : item.label;
      const rec = item.recEn !== undefined ? tr(item.rec || '', item.recEn || '') : (item.rec || '');
      const tag = item.tagEn !== undefined ? tr(item.tag || '', item.tagEn || '') : (item.tag || '');
      const role = item.roleEn ? tr(item.role || item.title, item.roleEn) : (item.role || item.title);
      const scene = item.sceneEn ? tr(item.scene || '', item.sceneEn) : (item.scene || '');
      const title = item.id === 'compact'
        ? buildCompactBtnTitle(extractContextRiskState())
        : (item.titleEn ? tr(item.title, item.titleEn) : item.title);

      if (item.builtinAction === 'copyid') {
        actions.push({
          id: btnId,
          poolId: item.id,
          label,
          rec,
          tag,
          role,
          scene,
          title,
          onClick: async () => {
            const id = getSessionIdFromLocation();
            if (!id) {
              showQuickToast(tr('当前页面未包含会话 ID', 'No conversation ID in current URL'));
              return;
            }
            const ok = await copyToClipboard(id);
            showQuickToast(ok ? tr(`已复制会话 ID (${id.slice(0, 8)})`, `Copied ID (${id.slice(0, 8)})`) : tr('复制失败，请检查剪贴板权限', 'Copy failed'));
          }
        });
        continue;
      }

      if (item.builtinAction === 'export') {
        actions.push({
          id: btnId,
          poolId: item.id,
          label,
          rec,
          tag,
          role,
          scene,
          title,
          onClick: () => { void exportMarkdown(); }
        });
        continue;
      }

      const fillText = String(item.text || '');
      const itemAutoSend = Boolean(item.supportsAutoSend && quickBuiltinAutoSendEnabled);
      const roleDesc = itemAutoSend
        ? `${role}${tr(' · ⚡ 点击直接发送（按住 ⌘/Ctrl 仅填入）', ' · ⚡ Auto-send on click (⌘/Ctrl to insert)')}`
        : `${role}${tr('（按住 ⌘/Ctrl 点击可直接发送）', ' (hold ⌘/Ctrl + click to send)')}`;
      const actTitle = itemAutoSend ? `${title}${tr(' · ⚡ 点击直接发送', ' · ⚡ Auto-send')}` : title;
      actions.push({
        id: btnId,
        poolId: item.id,
        label,
        rec,
        tag,
        role: roleDesc,
        scene,
        title: actTitle,
        fillText,
        autoSend: itemAutoSend,
        onClick: async (ev, btnEl) => runQuickPromptAction({
          fillText,
          slash: item.slash || '',
          label,
          id: item.id,
          defaultAutoSend: itemAutoSend,
          event: ev,
          triggerBtn: btnEl
        })
      });
    }

    const customList = Array.isArray(customQuickPrompts) ? customQuickPrompts : [];
    customList.forEach((item, idx) => {
      if (!item) return;
      const fillText = String(item.text || '');
      const label = item.label;
      const itemAutoSend = Boolean(item.autoSend);
      const customPrefix = itemAutoSend ? tr('点击直接发送：', 'Auto-send: ') : tr('点击填入：', 'Insert: ');
      actions.push({
        id: `ag-qcap-prompt-${idx}`,
        isCustom: true,
        label,
        rec: '',
        tag: itemAutoSend ? tr('自定义 · ⚡直发', 'Custom · ⚡Send') : tr('自定义 · 填入', 'Custom · Insert'),
        role: itemAutoSend
          ? tr('点击直接发送预设提示词（按住 ⌘/Ctrl 点击仅填入）', 'Click to send preset prompt directly (hold ⌘/Ctrl to insert only)')
          : tr('点击一键填入预设提示词到输入框（按住 ⌘/Ctrl 点击直接发送）', 'Click to insert preset prompt (hold ⌘/Ctrl + click to send directly)'),
        scene: truncateNextStepText(fillText, 64),
        title: item.title
          ? (itemAutoSend ? `${item.title}${tr(' · ⚡ 点击直接发送', ' · ⚡ Auto-send')}` : item.title)
          : `${customPrefix}${fillText}`,
        fillText,
        autoSend: itemAutoSend,
        onClick: async (ev, btnEl) => runQuickPromptAction({
          fillText,
          slash: '',
          label,
          id: item.id || `prompt-${idx}`,
          defaultAutoSend: itemAutoSend,
          event: ev,
          triggerBtn: btnEl
        })
      });
    });

    return actions;
  }

  function applyQuickButtonMetadata(btn, act) {
    btn.__agQuickAct = act;
    btn.setAttribute('data-ag-tooltip', act.title || '');
    btn.setAttribute('aria-label', act.title ? `${act.label} - ${act.title}` : act.label);
    if (act.autoSend) btn.setAttribute('data-auto-send', 'true');
    else btn.removeAttribute('data-auto-send');
    if (btn.hasAttribute?.('title')) btn.removeAttribute('title');
  }

  function syncQuickBarActionButtons(bar) {
    if (!bar) return;
    const actions = getQuickBarActions();
    const sig = JSON.stringify({
      lang: uiLang,
      items: actions.map((a) => [a.id, a.label, a.title, a.fillText || '', a.rec || '', a.tag || '', a.role || '', a.scene || '', Boolean(a.autoSend)])
    });
    const rightSlot = bar.querySelector(`#${QUICK_RIGHT_SLOT_ID}`);
    if (bar.dataset.promptsSig === sig) {
      for (const act of actions) {
        const btn = bar.querySelector(`#${act.id}`);
        if (!btn) continue;
        const lbl = btn.querySelector('.ag-qcap-label');
        if (lbl) {
          if (lbl.textContent !== act.label) lbl.textContent = act.label;
        } else if (btn.textContent !== act.label) {
          btn.textContent = act.label;
        }
        applyQuickButtonMetadata(btn, act);
      }
      return;
    }
    bar.dataset.promptsSig = sig;
    const oldBtns = Array.from(bar.children || []).filter((ch) => ch !== rightSlot && ch.id !== QUICK_RIGHT_SLOT_ID);
    for (const oldBtn of oldBtns) {
      safeRemove(oldBtn);
    }
    for (const act of actions) {
      const btn = document.createElement('button');
      btn.id = act.id;
      btn.className = 'ag-qcap-btn';
      btn.type = 'button';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'ag-qcap-label';
      labelSpan.textContent = act.label;
      btn.appendChild(labelSpan);
      applyQuickButtonMetadata(btn, act);
      if (act.active) btn.setAttribute('data-active', 'true');
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('mouseenter', () => {
        showQuickBarTooltip(btn, btn.__agQuickAct);
      });
      btn.addEventListener('focus', () => {
        showQuickBarTooltip(btn, btn.__agQuickAct);
      });
      btn.addEventListener('mouseleave', () => {
        hideQuickBarTooltip();
      });
      btn.addEventListener('blur', () => {
        hideQuickBarTooltip();
      });
      btn.addEventListener('click', (e) => {
        hideQuickBarTooltip();
        return btn.__agQuickAct?.onClick?.(e, btn);
      });
      if (rightSlot && rightSlot.parentElement === bar) {
        bar.insertBefore(btn, rightSlot);
      } else {
        bar.appendChild(btn);
      }
    }
  }

  function updateQuickBarLanguage() {
    const bar = document.getElementById(QUICK_BAR_ID);
    if (bar) {
      bar.setAttribute('aria-label', tr('输入框快捷操作栏', 'Composer Quick Actions'));
      syncQuickBarActionButtons(bar);
      const tabBtn = document.querySelector(`#${NEXT_STEP_GHOST_ID} .ag-ns-tab`);
      if (tabBtn) {
        const kbdTag = tabBtn.querySelector('.ag-ns-kbd-tag');
        if (kbdTag) kbdTag.textContent = tr('Tab / → 补全', 'Tab / →');
      }
    }
    syncPromptOptimizerUI();
  }

  function ensureQuickCapsuleBar() {
    if (disposed || featureFlags.showQuickBar === false) return;
    ensureDocStyle();
    const composer = document.querySelector('.surface-composer');
    if (!composer || !composer.parentElement) return;

    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);

    let bar = document.getElementById(QUICK_BAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = QUICK_BAR_ID;
      bar.setAttribute('aria-label', tr('输入框快捷操作栏', 'Composer Quick Actions'));

      const rightSlot = document.createElement('div');
      rightSlot.id = QUICK_RIGHT_SLOT_ID;
      rightSlot.className = 'ag-qcap-right-slot';

      const toast = document.createElement('span');
      toast.className = 'ag-qcap-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('data-visible', 'false');
      rightSlot.appendChild(toast);
      bar.appendChild(rightSlot);
    }

    syncQuickBarActionButtons(bar);

    if (bar.getAttribute('data-ag-theme') !== theme) {
      bar.setAttribute('data-ag-theme', theme);
    }

    const compactBtn = document.getElementById('ag-qcap-compact');
    if (compactBtn) {
      const risk = extractContextRiskState();
      if (risk.cacheDropDetected) {
        compactBtn.setAttribute('data-risk', 'danger');
      } else if (risk.contextUsed >= 328000) {
        compactBtn.setAttribute('data-risk', 'danger');
      } else if (risk.contextUsed >= 240000 || risk.percent >= 70) {
        compactBtn.setAttribute('data-risk', 'warn');
      } else {
        compactBtn.removeAttribute('data-risk');
      }
      const compactSummary = buildCompactBtnTitle(risk);
      compactBtn.setAttribute('data-ag-tooltip', compactSummary);
      compactBtn.setAttribute('aria-label', `${compactBtn.textContent || '/compact'} - ${compactSummary}`);
      if (compactBtn.hasAttribute?.('title')) compactBtn.removeAttribute('title');
    }

    // 始终保证快捷胶囊栏位于 .surface-composer 的紧邻正上方
    if (bar.parentElement !== composer.parentElement || bar.nextElementSibling !== composer) {
      composer.parentElement.insertBefore(bar, composer);
    }
  }

  // ==================== 输入框“下一步建议”幽灵提示与 Tab 补全 ====================

  function getComposerEditor() {
    return (
      document.querySelector('.surface-composer [data-lexical-editor="true"]') ||
      document.querySelector('.surface-composer [contenteditable="true"]') ||
      document.querySelector('[data-testid="agent-input-box"] [data-lexical-editor="true"]') ||
      document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]') ||
      document.querySelector('[aria-label="Message input"][contenteditable="true"]') ||
      document.querySelector('[aria-label="消息输入"][contenteditable="true"]')
    );
  }

  function getComposerText(ed) {
    if (!ed) return '';
    const raw = typeof ed.__lexicalTextContent === 'string'
      ? ed.__lexicalTextContent
      : (typeof ed.innerText === 'string' && ed.innerText.length ? ed.innerText : (ed.textContent || ''));
    return String(raw).replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  function isComposerEmpty(ed) {
    if (!ed) return false;
    return getComposerText(ed).trim().length === 0;
  }

  function extractContextPercent() {
    const cap = document.querySelector('[data-agy-context-capsule="1"]');
    const capMatch = (cap?.textContent || '').match(/(\d+(?:\.\d+)?)%/);
    if (capMatch) return Number(capMatch[1]);
    const { sr } = getMeterHostAndShadow();
    const meterMatch = (sr?.textContent || '').match(/(\d+(?:\.\d+)?)%/);
    return meterMatch ? Number(meterMatch[1]) : 0;
  }

  function extractContextRiskState() {
    const percent = extractContextPercent();
    let contextUsed = 0;
    let cacheDropDetected = false;
    try {
      const capData = document.querySelector('[data-agy-context-capsule="1"]')?.__ctxUsageData;
      const meterLatest = window.__AGContextMeter?.snapshot?.()?.latest;
      const capUsed = Number(capData?.contextUsed || 0);
      const meterUsed = Number(meterLatest?.actual || meterLatest?.used || 0);
      const compAfter = Number(capData?.compressionAfter || 0);
      const regrownSinceCompact = compAfter > 0 && capUsed > compAfter + 50000;
      const capShowsPostCompactDrop = Boolean(
        capData?.hasPreciseSnapshot &&
        capData?.compressionDetected &&
        !regrownSinceCompact &&
        capUsed > 0 &&
        meterUsed > 0 &&
        capUsed < 240000 &&
        capUsed < meterUsed
      );
      contextUsed = capShowsPostCompactDrop ? capUsed : Math.max(capUsed, meterUsed);
      cacheDropDetected = capShowsPostCompactDrop
        ? Boolean(capData?.cacheDropDetected)
        : Boolean(capData?.cacheDropDetected || meterLatest?.cacheDropDetected);
      if (
        !cacheDropDetected &&
        capData?.hasPreciseSnapshot &&
        contextUsed >= 240000 &&
        Number(capData?.inputTokens || 0) >= 200000 &&
        Number(capData?.cacheHitRate || 0) < 25
      ) {
        cacheDropDetected = true;
      }
    } catch {}
    return { percent, contextUsed, cacheDropDetected };
  }

  function isCompactUserMessageElement(userMsgEl) {
    if (!userMsgEl) return false;
    const contentEl = userMsgEl.querySelector?.('[data-testid="user-message-content"]') || null;
    if (contentEl) {
      const directText = String(contentEl.textContent || '').trim();
      return Boolean(directText) && /^\/?compact$/i.test(directText);
    }
    const rawText = String(userMsgEl.textContent || '').trim();
    if (!rawText) return false;
    const cleaned = rawText
      .replace(/^(?:you\s+said|你说)[:：\s]*/i, '')
      .replace(/(?:\s*(?:just\s+now|刚刚|\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)\s*ago|\d+\s*(?:秒|分钟|小时|天)前|\d{1,2}:\d{2}))+$/i, '')
      .trim();
    return /^\/?compact$/i.test(cleaned);
  }

  function runAutoCompactTick(opts = {}) {
    if (!autoCompactEnabled || disposed) {
      return { triggered: false, reason: 'disabled' };
    }
    const sessionId = getSessionIdFromLocation();
    if (!sessionId) {
      return { triggered: false, reason: 'no_session' };
    }
    if (sessionId !== autoCompactState.lastSessionId) {
      autoCompactState.lastSessionId = sessionId;
      autoCompactState.armedForSession = false;
      autoCompactState.idleSince = 0;
    }

    const now = Date.now();
    const busySignal = detectAssistantBusySignal();
    const busy = Boolean(busySignal);
    let inFlight = autoCompactState.inFlightMap.get(sessionId) || null;
    if (inFlight && !inFlight.sending && now >= (Number(inFlight.maxUntil) || 0)) {
      autoCompactState.inFlightMap.delete(sessionId);
      inFlight = null;
    }
    if (inFlight && (inFlight.sending || busy || now < inFlight.until)) {
      autoCompactState.armedForSession = false;
      autoCompactState.idleSince = 0;
      return { triggered: false, reason: 'compact_in_flight' };
    }
    if (inFlight) {
      autoCompactState.inFlightMap.delete(sessionId);
      autoCompactState.armedForSession = false;
      autoCompactState.idleSince = 0;
      return { triggered: false, reason: 'compact_finished' };
    }
    if (busy) {
      autoCompactState.armedForSession = true;
      autoCompactState.idleSince = 0;
      return { triggered: false, reason: 'assistant_busy' };
    }

    if (!opts.immediate && !autoCompactState.armedForSession) {
      return { triggered: false, reason: 'not_armed_after_turn' };
    }

    const risk = extractContextRiskState();
    if (!risk.cacheDropDetected && risk.contextUsed < 240000) {
      autoCompactState.idleSince = 0;
      return { triggered: false, reason: 'below_threshold' };
    }

    const ed = getComposerEditor();
    if (!ed || isComposerComposing || !isComposerEmpty(ed)) {
      autoCompactState.idleSince = 0;
      return { triggered: false, reason: 'composer_not_empty' };
    }

    const prevFired = autoCompactState.lastFiredMap.get(sessionId);
    if (prevFired && (now - prevFired.at < 90000)) {
      return { triggered: false, reason: 'cooldown' };
    }
    const userMsgs = document.querySelectorAll('[data-testid="user-message"]');
    const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
    if (isCompactUserMessageElement(lastUserMsg)) {
      const assistantMds = getAssistantMarkdownRoots();
      const lastAsst = assistantMds[assistantMds.length - 1];
      const posFollowing = (typeof Node !== 'undefined' && typeof Node.DOCUMENT_POSITION_FOLLOWING === 'number')
        ? Node.DOCUMENT_POSITION_FOLLOWING
        : 4;
      const userFollowsAsst = !lastAsst || (
        typeof lastAsst.compareDocumentPosition === 'function'
          ? Boolean(lastAsst.compareDocumentPosition(lastUserMsg) & posFollowing)
          : false
      );
      if (userFollowsAsst) {
        autoCompactState.idleSince = 0;
        return { triggered: false, reason: 'already_compacted' };
      }
    }
    if (!opts.immediate) {
      if (!autoCompactState.idleSince) {
        autoCompactState.idleSince = now;
        return { triggered: false, reason: 'waiting_idle_stability' };
      }
      if (now - autoCompactState.idleSince < 1800) {
        return { triggered: false, reason: 'waiting_idle_stability' };
      }
    }

    autoCompactState.armedForSession = false;
    const inFlightEntry = {
      sending: true,
      until: now + 5000,
      maxUntil: now + AUTO_COMPACT_IN_FLIGHT_MAX_MS
    };
    autoCompactState.inFlightMap.set(sessionId, inFlightEntry);
    trimAutoCompactMap(autoCompactState.inFlightMap);
    autoCompactState.idleSince = 0;
    autoCompactState.lastFiredMap.set(sessionId, {
      at: now,
      contextUsed: risk.contextUsed,
      assistantCount: getAssistantMarkdownRoots().length
    });
    trimAutoCompactMap(autoCompactState.lastFiredMap);
    Promise.resolve(performMobileAction({ action: 'send', text: '/compact' }))
      .catch(() => null)
      .finally(() => {
        if (autoCompactState.inFlightMap.get(sessionId) === inFlightEntry) {
          inFlightEntry.sending = false;
          inFlightEntry.until = Math.max(inFlightEntry.until, Date.now() + 3000);
        }
      });
    const kVal = Math.round(risk.contextUsed / 1000);
    const noticeText = risk.cacheDropDetected
      ? tr(`⚡ 检测到缓存已失效 (${kVal}K)，已自动发送 /compact 压缩防卡顿（可在设置关闭）`, `⚡ Cache expired (${kVal}K): auto-sent /compact to prevent stall (toggle in Settings)`)
      : tr(`⚡ 上下文已达 ${kVal}K（超 240K 安全线），已自动发送 /compact 提前压缩（可在设置关闭）`, `⚡ Context reached ${kVal}K (>240K): auto-sent /compact early (toggle in Settings)`);
    showQuickToast(noticeText, 6000);
    return {
      triggered: true,
      reason: risk.cacheDropDetected ? 'cache_drop' : 'threshold_240k',
      contextUsed: risk.contextUsed
    };
  }

  function getAssistantMarkdownRoots() {
    return Array.from(document.querySelectorAll('[data-markdown-root]')).filter((m) => (
      !m.closest('[data-testid="user-message"]') &&
      !m.closest('[data-testid="thinking-collapsible-trigger"]') &&
      !m.parentElement?.previousElementSibling?.matches?.('[data-testid="thinking-collapsible-trigger"]')
    ));
  }

  function detectAssistantBusySignal() {
    const cancelBtn =
      document.querySelector('.surface-composer [data-testid="input-cancel-button"]') ||
      document.querySelector('[data-testid="input-cancel-button"]');
    if (cancelBtn && cancelBtn.offsetWidth > 0 && !cancelBtn.disabled) {
      return 'cancel-btn';
    }
    const thinkingTriggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (const trigger of thinkingTriggers) {
      const text = (trigger.textContent || '').trim();
      if (/^(?:Thinking|思考中)/i.test(text)) return 'thinking';
    }
    const activeCid = getSessionIdFromLocation();
    if (activeCid) {
      const activeRow = findSidebarRowById(activeCid);
      if (activeRow && activeRow.querySelector('.animate-spin, [data-testid*="spinner"], [aria-busy="true"]')) {
        return 'spinner';
      }
    }
    if (Date.now() - lastUserSubmitAt < 2500) return 'recent-submit';
    return '';
  }

  function isAssistantBusy() {
    return Boolean(detectAssistantBusySignal());
  }

  function truncateNextStepText(text, maxChars = 8) {
    const str = String(text || '');
    const chars = Array.from(str);
    if (chars.length <= maxChars) return str;
    return `${chars.slice(0, maxChars).join('')}..`;
  }

  function hideNextStepTooltip() {
    const tip = document.getElementById(NEXT_STEP_TOOLTIP_ID);
    if (tip) tip.hidden = true;
  }

  function showNextStepTooltip(anchorBtn) {
    if (disposed || !anchorBtn) return;
    const fullText = anchorBtn.getAttribute('data-full-text') || '';
    if (!fullText) {
      hideNextStepTooltip();
      return;
    }
    ensureDocStyle();
    const { host } = getMeterHostAndShadow();
    const theme = resolveHostTheme(host);
    let tip = document.getElementById(NEXT_STEP_TOOLTIP_ID);
    if (!tip) {
      tip = document.createElement('div');
      tip.id = NEXT_STEP_TOOLTIP_ID;
      tip.setAttribute('role', 'tooltip');
      (document.body || document.documentElement)?.appendChild(tip);
    }
    tip.setAttribute('data-ag-theme', theme);
    tip.setAttribute('data-hint', tr('点击或按 Tab / → 填入输入框', 'Click or press Tab / → to insert'));
    tip.textContent = fullText;
    tip.hidden = false;

    try {
      if (typeof anchorBtn.getBoundingClientRect === 'function') {
        const rect = anchorBtn.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const tipW = Math.min(360, vw - 24);
        const tipH = tip.offsetHeight || 32;
        const left = Math.max(12, Math.min(vw - tipW - 12, Math.round(rect.left || 12)));
        const top = Math.max(8, Math.round((rect.top || 48) - tipH - 6));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }
    } catch {}
  }

  function computeNextStepCandidatesFromText(sessionId, rawText, contextPercent = 0, stepCount = 0) {
    const fullText = String(rawText || '').trim();
    const sig = `${sessionId}|${stepCount}|${fullText.length}|${fullText.slice(-80)}`;
    const recent = fullText.slice(-700);
    const tail = fullText.slice(-180);
    const list = [];
    const addCandidate = (txt) => {
      if (txt && !list.includes(txt)) list.push(txt);
    };

    if (!fullText) {
      addCandidate('先帮我梳理下当前任务并给出方案');
      addCandidate('按这个需求做：\n');
      addCandidate('/plan ');
      addCandidate('用中文回答');
      return { sig, candidates: list.slice(0, 4) };
    }

    const strippedProse = fullText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      .replace(/https?:\/\/\S+/gi, ' ');
    const latinCount = (strippedProse.match(/[A-Za-z]/g) || []).length;
    const cjkCount = (strippedProse.match(/[\u4e00-\u9fff]/g) || []).length;
    const nonSpaceCount = strippedProse.replace(/\s+/g, '').length;
    const isMostlyEnglish = (
      uiLang !== 'en' &&
      latinCount >= 40 &&
      cjkCount < 6 &&
      (latinCount / Math.max(1, nonSpaceCount)) > 0.7
    );

    const asksConfirm = /(?:请确认|是否确认|是否合适|确认后|是否继续|你倾向于|请选择|方案\s*[A-Z1-9]|选项\s*[A-Z1-9])/i.test(recent);
    const hasRecommend = /(?:推荐|方案\s*[A1](?!\d))/.test(recent);
    const asksQuestion = /[？?]\s*$/.test(tail);
    const hasUnnegatedError = (txt) => {
      if (!txt || /(?:已修复|验证通过|PASSED|0\s*failed)/i.test(tail)) return false;
      const re = /(?:报错|失败|异常|未通过|Error:|Exception|exited with code [1-9])/gi;
      let m;
      while ((m = re.exec(txt)) !== null) {
        const before = txt.slice(Math.max(0, m.index - 4), m.index);
        if (/(?:不|无|没有|未见|未发现|未|零|0\s*|避免|防止|防|非)$/.test(before)) continue;
        return true;
      }
      return false;
    };
    const hasError = hasUnnegatedError(recent);
    const hasDoneOrPushed = /(?:已提交|已推送|origin\/main|commit\s+[0-9a-f]{6,}|验证通过|全部组件显示\s*✅|PASSED)/i.test(recent);
    const mentionsCodeChange = /(?:已修改|已新增|已修复|文件修改|函数|补丁|\.(?:js|ts|tsx|py|sh|md|json)\b)/i.test(recent);
    const isLongPlainExplanation = !mentionsCodeChange && !asksConfirm && !hasError && !hasDoneOrPushed && fullText.length >= 450;

    if (isMostlyEnglish) {
      addCandidate('用中文回答');
    }

    if (asksConfirm) {
      addCandidate('直接实现');
      if (hasRecommend) addCandidate('确认，按推荐方案执行');
      addCandidate('再改一版');
    } else if (asksQuestion) {
      addCandidate('直接实现');
      addCandidate('继续');
    }

    if (hasError) {
      addCandidate('修复这个报错');
      addCandidate('为什么不行');
    }

    if (mentionsCodeChange && !hasDoneOrPushed) {
      addCandidate('跑一下');
      addCandidate('优化一下');
    }

    if (hasDoneOrPushed) {
      addCandidate('优化一下');
      addCandidate('再改一版');
      addCandidate('继续');
    }

    if (isLongPlainExplanation) {
      addCandidate('不要解释');
      addCandidate('直接实现');
    }

    const risk = extractContextRiskState();
    if (risk.cacheDropDetected || risk.contextUsed >= 328000) {
      const existingIdx = list.indexOf('/compact');
      if (existingIdx >= 0) list.splice(existingIdx, 1);
      list.unshift('/compact');
    } else if (risk.contextUsed >= 240000 || Math.max(Number(contextPercent) || 0, risk.percent || 0) >= 65) {
      addCandidate('/compact');
    }

    addCandidate('继续');
    addCandidate('优化一下');
    addCandidate('再改一版');

    return { sig, candidates: list.slice(0, 4) };
  }

  function computeNextStepCandidates() {
    const sessionId = getSessionIdFromLocation() || '';
    const assistantMds = getAssistantMarkdownRoots();
    const lastMd = assistantMds[assistantMds.length - 1];
    const fullText = (lastMd?.innerText || '').trim();
    return computeNextStepCandidatesFromText(sessionId, fullText, extractContextPercent(), assistantMds.length);
  }

  function hideNextStepGhost() {
    nextStepState.visible = false;
    hideNextStepTooltip();
    const ghost = document.getElementById(NEXT_STEP_GHOST_ID);
    if (ghost) ghost.hidden = true;
    document.querySelectorAll('[data-ag-has-ghost="1"]').forEach((el) => {
      el.removeAttribute('data-ag-has-ghost');
    });
  }

  function ensureNextStepGhost() {
    if (disposed || !ghostSuggestEnabled || featureFlags.showQuickBar === false) {
      hideNextStepGhost();
      return;
    }
    const ed = getComposerEditor();
    if (!ed || isAssistantBusy()) {
      hideNextStepGhost();
      return;
    }

    ensureQuickCapsuleBar();
    const rightSlot = document.getElementById(QUICK_RIGHT_SLOT_ID);
    if (!rightSlot) {
      hideNextStepGhost();
      return;
    }

    const { sig, candidates } = computeNextStepCandidates();
    if (sig !== nextStepState.replySig) {
      nextStepState.replySig = sig;
      nextStepState.candidates = candidates;
      nextStepState.index = 0;
      nextStepState.dismissedSig = '';
    } else {
      nextStepState.candidates = candidates;
      if (nextStepState.index >= candidates.length) nextStepState.index = 0;
    }

    const shouldShow = (
      !isComposerComposing &&
      !isAssistantBusy() &&
      candidates.length > 0 &&
      nextStepState.dismissedSig !== sig &&
      ed.getAttribute('aria-expanded') !== 'true' &&
      isComposerEmpty(ed)
    );

    if (!shouldShow) {
      hideNextStepGhost();
      return;
    }

    ensureDocStyle();
    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    let ghost = document.getElementById(NEXT_STEP_GHOST_ID);
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = NEXT_STEP_GHOST_ID;

      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'ag-qcap-btn ag-ns-accept ag-ns-tab';

      const textSpan = document.createElement('span');
      textSpan.className = 'ag-ns-text';

      const kbdSpan = document.createElement('span');
      kbdSpan.className = 'ag-ns-kbd-tag';
      kbdSpan.textContent = tr('Tab / → 补全', 'Tab / →');

      tabBtn.appendChild(textSpan);
      tabBtn.appendChild(kbdSpan);
      tabBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      tabBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void acceptNextStepSuggestion();
      });
      tabBtn.addEventListener('mouseenter', () => {
        showNextStepTooltip(tabBtn);
      });
      tabBtn.addEventListener('focus', () => {
        showNextStepTooltip(tabBtn);
      });
      tabBtn.addEventListener('mouseleave', () => {
        hideNextStepTooltip();
      });
      tabBtn.addEventListener('blur', () => {
        hideNextStepTooltip();
      });

      const cycleBtn = document.createElement('button');
      cycleBtn.type = 'button';
      cycleBtn.className = 'ag-qcap-btn ag-ns-cycle';
      cycleBtn.title = tr('按 ↓ 切换下一条建议', 'Press ↓ to cycle suggestion');
      cycleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      cycleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleNextStepSuggestion(1);
      });

      ghost.appendChild(tabBtn);
      ghost.appendChild(cycleBtn);
    }

    const toastEl = rightSlot.querySelector('.ag-qcap-toast');
    if (ghost.parentElement !== rightSlot) {
      if (toastEl) rightSlot.insertBefore(ghost, toastEl);
      else rightSlot.appendChild(ghost);
    }
    if (ghost.getAttribute('data-ag-theme') !== theme) {
      ghost.setAttribute('data-ag-theme', theme);
    }
    ghost.hidden = false;

    const currentText = candidates[nextStepState.index] || '';
    const displayShort = truncateNextStepText(currentText, 8);
    const tabBtn = ghost.querySelector('.ag-ns-tab');
    const textSpan = ghost.querySelector('.ag-ns-text');
    const cycleBtn = ghost.querySelector('.ag-ns-cycle');
    if (textSpan) {
      const nextDisplay = `💡 ${displayShort}`;
      if (textSpan.textContent !== nextDisplay) textSpan.textContent = nextDisplay;
    }
    if (tabBtn) {
      tabBtn.setAttribute('data-full-text', currentText);
      tabBtn.setAttribute('data-truncated', displayShort !== currentText ? 'true' : 'false');
      tabBtn.setAttribute('aria-label', `${currentText}（${tr('点击或按 Tab / → 填入输入框', 'Click or press Tab / → to insert')}）`);
      if (tabBtn.hasAttribute?.('title')) tabBtn.removeAttribute('title');
    }
    if (cycleBtn) {
      if (candidates.length > 1) {
        cycleBtn.hidden = false;
        cycleBtn.textContent = `↓ ${nextStepState.index + 1}/${candidates.length}`;
      } else {
        cycleBtn.hidden = true;
      }
    }

    nextStepState.visible = true;
  }

  function cycleNextStepSuggestion(step = 1) {
    const len = nextStepState.candidates.length;
    if (len <= 1) return false;
    nextStepState.index = (nextStepState.index + step + len) % len;
    ensureNextStepGhost();
    return true;
  }

  async function acceptNextStepSuggestion() {
    const text = nextStepState.candidates[nextStepState.index];
    if (!text) return false;
    hideNextStepGhost();
    const ok = await fillComposerText(text);
    if (ok) {
      showQuickToast(tr('已填入建议，按回车即可发送', 'Suggestion inserted, press Enter to send'));
    }
    ensureNextStepGhost();
    return ok;
  }

  // ==================== 输入框免 CLI 提示词优化 ====================

  function buildPromptOptimizeInstruction(draftText) {
    return [
      '你是一位精通 Google Cloud 提示工程（Prompt Engineering）原则的提示词优化专家。',
      '你的唯一任务是将 <draft> 标签内的用户原始提示词草稿，改写并优化为更清晰、具体、高质量的提示词，供软件工程与通用 AI 助手直接执行。',
      '',
      '请严格遵循以下提示工程准则：',
      '1. 明确任务与具体性（Clarity & Specificity）：消除口语化模糊表达与指代不明，使用清晰的动作动词界定核心目标。',
      '2. 语境与角色定位（Context & Persona）：根据任务性质自然提炼所需专业视角与作用范围；严禁编造草稿中未提及的业务事实、文件路径、接口名或参数。',
      '3. 复杂任务分步拆解（Step-by-Step Breakdown）：若原草稿包含多个需求或复杂目标，拆解为逻辑清晰的有序步骤；若原草稿只是简单直接的单步指令，则保持精炼紧凑，不要强行扩写成冗长模板。',
      '4. 明确边界与输出格式（Constraints & Output Format）：按需补充合理的边界约束、验收标准或期望的输出结构。',
      '5. 格式与标识符保真（Strict Preservation）：',
      '   - 保持与原草稿一致的自然语言（中文输入则输出中文，英文输入则输出英文）；',
      '   - 原样保留草稿中的所有文件路径、代码片段、变量/函数名、URL 与 @ 引用。',
      '',
      '重要限制：不要回答、执行或解释 <draft> 中的问题！只直接输出优化后的提示词正文，不要包含任何开场白、解释说明、引号或外层代码块包裹。',
      '',
      '<draft>',
      String(draftText || '').trim(),
      '</draft>'
    ].join('\n');
  }

  function cleanOptimizedPromptOutput(raw, slashPrefix = '') {
    let out = String(raw || '').trim();
    out = out.replace(/^<draft>\s*/i, '').replace(/\s*<\/draft>$/i, '').trim();
    const fenceMatch = out.match(/^```(?:markdown|md|text|txt|prompt)?\r?\n([\s\S]*?)\r?\n```$/i);
    if (fenceMatch) {
      out = fenceMatch[1].trim();
    }
    if (slashPrefix && out) {
      const cleanPrefix = slashPrefix.trim();
      const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`^${escapedPrefix}\\s*`), '').trim();
      return `${cleanPrefix} ${out}`;
    }
    return out;
  }

  function resolveLanguageServerCsrfToken() {
    const direct = String(window.__APP_CONFIG__?.csrfToken || '').trim();
    if (direct) return direct;
    try {
      const ls = String(localStorage.getItem('agy_session_csrf_token') || '').trim();
      if (ls) return ls;
    } catch {}
    try {
      const scripts = document.querySelectorAll?.('script') || [];
      for (const s of scripts) {
        const txt = String(s?.textContent || '');
        if (!txt.includes('__APP_CONFIG__')) continue;
        const m = txt.match(/__APP_CONFIG__\s*=\s*(\{[\s\S]*?\});/);
        if (m) {
          const parsed = JSON.parse(m[1]);
          if (parsed?.csrfToken) return String(parsed.csrfToken).trim();
        }
      }
    } catch {}
    return '';
  }

  async function parseLanguageServerError(resp) {
    const status = Number(resp?.status || 0);
    let rawText = '';
    let parsed = null;
    try {
      if (typeof resp?.text === 'function') {
        rawText = String(await resp.text() || '').trim();
        if (rawText) {
          try { parsed = JSON.parse(rawText); } catch {}
        }
      } else if (typeof resp?.json === 'function') {
        parsed = await resp.json().catch(() => null);
        if (parsed && typeof parsed === 'object') {
          rawText = JSON.stringify(parsed);
        }
      }
    } catch {}
    const code = String(parsed?.code || parsed?.error?.code || '').trim();
    const msg = String(
      parsed?.message
      || parsed?.error?.message
      || (typeof parsed?.error === 'string' ? parsed.error : '')
      || parsed?.detail
      || ''
    ).trim();
    const parts = [`HTTP ${status || 'ERR'}`];
    if (code) parts.push(`(${code})`);
    const detail = msg || (rawText && !rawText.startsWith('<') ? rawText.slice(0, 240) : '');
    const message = detail ? `${parts.join(' ')}: ${detail}` : parts.join(' ');
    return { status, code, detail, rawText: rawText.slice(0, 400), message };
  }

  async function resolveDefaultModelForOptimize(signal) {
    if (
      promptOptState.cacheModel.primary
      && Array.isArray(promptOptState.cacheModel.candidates)
      && promptOptState.cacheModel.candidates.length > 0
      && (Date.now() - promptOptState.cacheModel.fetchedAt) < 60000
    ) {
      return promptOptState.cacheModel;
    }
    const csrf = resolveLanguageServerCsrfToken();
    const headers = {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1'
    };
    if (csrf) headers['x-codeium-csrf-token'] = csrf;
    const resp = await fetch('/exa.language_server_pb.LanguageServerService/GetUserStatus', {
      method: 'POST',
      headers,
      body: '{}',
      signal
    });
    if (!resp.ok) {
      const parsedErr = await parseLanguageServerError(resp);
      const err = new Error(parsedErr.message);
      err.status = parsedErr.status;
      err.rawBody = parsedErr.rawText;
      throw err;
    }
    const payload = await resp.json();
    const cfgData = payload?.userStatus?.cascadeModelConfigData;
    if (cfgData) cacheDefaultModelFromConfigData(cfgData);
    return promptOptState.cacheModel;
  }

  function clearPromptOptUndoState({ clearHint = true } = {}) {
    promptOptState.canUndo = false;
    promptOptState.backupText = '';
    promptOptState.optimizedText = '';
    promptOptState.undoHintActive = false;
    if (clearHint) hideQuickToast('prompt-opt-undo');
  }

  function syncPromptOptimizerUI() {
    const btn = document.getElementById(PROMPT_OPT_BTN_ID);
    const undoBtn = document.getElementById(PROMPT_OPT_UNDO_ID);
    const wrap = document.getElementById(PROMPT_OPT_WRAP_ID);
    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    if (wrap && wrap.getAttribute('data-ag-theme') !== theme) {
      wrap.setAttribute('data-ag-theme', theme);
    }

    const ed = getComposerEditor();
    const curText = ed ? getComposerText(ed) : '';
    const hasText = curText.trim().length > 0;
    if (!hasText && !promptOptState.loading) {
      clearPromptOptUndoState();
    } else if (promptOptState.undoHintActive && !promptOptState.loading && curText !== promptOptState.optimizedText) {
      promptOptState.undoHintActive = false;
      promptOptState.optimizedText = '';
      hideQuickToast('prompt-opt-undo');
    }

    if (btn) {
      if (promptOptState.loading) {
        btn.disabled = false;
        btn.setAttribute('data-loading', 'true');
        btn.innerHTML = `<span class="ag-opt-spin"></span><span>${tr('优化中…', 'Optimizing…')}</span>`;
        btn.title = tr('正在优化提示词，点击可立即取消', 'Optimizing prompt, click to cancel');
      } else {
        btn.removeAttribute('data-loading');
        btn.disabled = !hasText;
        btn.innerHTML = `${PROMPT_OPT_SPARKLE_SVG}<span>${tr('优化', 'Optimize')}</span>`;
        btn.title = hasText
          ? tr('优先使用轻量快速模型优化输入框内的提示词（支持多模型自动回退）', 'Optimize prompt using a fast lightweight model with automatic fallback')
          : tr('先输入提示词草稿，点击快速优化', 'Enter a prompt draft first');
      }
    }

    if (undoBtn) {
      undoBtn.hidden = !(promptOptState.canUndo && !promptOptState.loading && hasText && promptOptState.backupText);
      undoBtn.innerHTML = `${PROMPT_OPT_UNDO_SVG}<span>${tr('撤回', 'Undo')}</span>`;
      undoBtn.title = tr('撤回优化，恢复原始草稿', 'Undo optimization and restore original draft');
    }
  }

  function ensurePromptOptimizerControls() {
    if (disposed) return;
    ensureDocStyle();
    const composer = document.querySelector('.surface-composer');
    if (!composer) return;
    const footer = composer.querySelector('.agy-composer-footer') || document.querySelector('.agy-composer-footer');
    if (!footer) return;

    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    const mountParent = footer.parentElement || composer;

    let wrap = document.getElementById(PROMPT_OPT_WRAP_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = PROMPT_OPT_WRAP_ID;
      wrap.className = 'ag-prompt-opt-wrap';

      const optBtn = document.createElement('button');
      optBtn.id = PROMPT_OPT_BTN_ID;
      optBtn.type = 'button';
      optBtn.className = 'ag-prompt-opt-btn';
      optBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      optBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void optimizeComposerPrompt();
      });

      const undoBtn = document.createElement('button');
      undoBtn.id = PROMPT_OPT_UNDO_ID;
      undoBtn.type = 'button';
      undoBtn.className = 'ag-prompt-undo-btn';
      undoBtn.hidden = true;
      undoBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void undoPromptOptimize();
      });

      wrap.appendChild(optBtn);
      wrap.appendChild(undoBtn);
    }

    if (wrap.getAttribute('data-ag-theme') !== theme) {
      wrap.setAttribute('data-ag-theme', theme);
    }
    if (wrap.getAttribute('data-position') !== 'above-send') {
      wrap.setAttribute('data-position', 'above-send');
    }

    if (wrap.parentElement !== mountParent || wrap.nextElementSibling !== footer) {
      mountParent.insertBefore(wrap, footer);
    }

    try {
      const sendBtn = footer.querySelector(
        '[data-testid="input-send-button"], [data-testid="send-button"], .agy-send-button, button[aria-label*="Send"], button[aria-label*="发送"], [data-testid="input-cancel-button"]'
      ) || footer.querySelector('button:last-of-type');
      if (sendBtn && typeof mountParent.getBoundingClientRect === 'function' && typeof sendBtn.getBoundingClientRect === 'function') {
        const pRect = mountParent.getBoundingClientRect();
        const sRect = sendBtn.getBoundingClientRect();
        if (pRect && sRect && pRect.width > 0 && sRect.width > 0 && pRect.right >= sRect.right) {
          const rightOffset = Math.max(8, Math.min(48, Math.round(pRect.right - sRect.right)));
          wrap.style.paddingRight = `${rightOffset}px`;
        }
      }
    } catch {}

    syncPromptOptimizerUI();
  }

  async function undoPromptOptimize() {
    if (!promptOptState.canUndo || !promptOptState.backupText || promptOptState.loading) return false;
    const orig = promptOptState.backupText;
    clearPromptOptUndoState();
    const ok = await fillComposerText(orig);
    syncPromptOptimizerUI();
    if (ok) showQuickToast(tr('↩ 已恢复原始提示词', '↩ Restored original draft'));
    return ok;
  }

  async function optimizeComposerPrompt() {
    if (promptOptState.loading) {
      promptOptState.userCancelled = true;
      if (promptOptState.abortCtrl) {
        try { promptOptState.abortCtrl.abort(); } catch {}
      }
      promptOptState.loading = false;
      promptOptState.abortCtrl = null;
      syncPromptOptimizerUI();
      showQuickToast(tr('已取消提示词优化', 'Prompt optimization cancelled'));
      return { ok: false, cancelled: true };
    }

    const ed = getComposerEditor();
    const rawText = getComposerText(ed);
    const trimmed = rawText.trim();
    if (!trimmed) {
      showQuickToast(tr('先输入提示词草稿，再点击优化', 'Enter a prompt draft first'));
      syncPromptOptimizerUI();
      return { ok: false, error: 'empty' };
    }

    let slashPrefix = '';
    let draftBody = trimmed;
    const slashMatch = trimmed.match(/^(\/[a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/);
    if (slashMatch) {
      slashPrefix = slashMatch[1];
      draftBody = (slashMatch[2] || '').trim();
      if (!draftBody) {
        showQuickToast(tr('当前仅包含斜杠命令，无需优化', 'Only slash command present'));
        return { ok: false, error: 'slash-only' };
      }
    }

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let overallTimedOut = false;
    const timeoutId = ctrl ? setTimeout(() => {
      overallTimedOut = true;
      try { ctrl.abort(); } catch {}
    }, 45000) : null;
    promptOptState.loading = true;
    promptOptState.abortCtrl = ctrl;
    promptOptState.userCancelled = false;
    promptOptState.undoHintActive = false;
    promptOptState.optimizedText = '';
    hideQuickToast('prompt-opt-undo');
    syncPromptOptimizerUI();

    const attempts = [];
    const csrf = resolveLanguageServerCsrfToken();

    try {
      const modelInfo = await resolveDefaultModelForOptimize(ctrl ? ctrl.signal : undefined);
      const rawCandidates = Array.isArray(modelInfo?.candidates) && modelInfo.candidates.length > 0
        ? modelInfo.candidates
        : [modelInfo?.primary, modelInfo?.fallback]
            .filter(Boolean)
            .map((m) => ({ model: m, label: m, modelId: '' }));
      const candidates = [];
      const seenModels = new Set();
      for (const c of rawCandidates) {
        const modelEnum = String(c?.model || '').trim();
        if (!modelEnum || seenModels.has(modelEnum)) continue;
        seenModels.add(modelEnum);
        candidates.push({
          model: modelEnum,
          label: String(c?.label || c?.modelId || modelEnum),
          modelId: String(c?.modelId || '')
        });
      }
      if (!candidates.length) {
        throw new Error(tr('未能读取可用模型列表', 'Failed to resolve available models'));
      }

      const effCsrf = resolveLanguageServerCsrfToken() || csrf;
      const headers = {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1'
      };
      if (effCsrf) headers['x-codeium-csrf-token'] = effCsrf;
      const prompt = buildPromptOptimizeInstruction(draftBody);

      const callGenerate = async (modelEnum, hasMoreFallbacks) => {
        const canSubAbort = typeof AbortController === 'function' && hasMoreFallbacks;
        const attemptCtrl = canSubAbort ? new AbortController() : null;
        let attemptTimedOut = false;
        let onOverallAbort = null;
        let attemptTimer = null;
        if (attemptCtrl) {
          if (ctrl?.signal) {
            if (ctrl.signal.aborted) {
              attemptCtrl.abort();
            } else {
              onOverallAbort = () => { try { attemptCtrl.abort(); } catch {} };
              ctrl.signal.addEventListener('abort', onOverallAbort, { once: true });
            }
          }
          attemptTimer = setTimeout(() => {
            attemptTimedOut = true;
            try { attemptCtrl.abort(); } catch {}
          }, 18000);
        }
        try {
          const resp = await fetch('/exa.language_server_pb.LanguageServerService/GetModelResponse', {
            method: 'POST',
            headers,
            body: JSON.stringify({ prompt, model: modelEnum }),
            signal: attemptCtrl ? attemptCtrl.signal : (ctrl ? ctrl.signal : undefined)
          });
          if (!resp.ok) {
            const parsedErr = await parseLanguageServerError(resp);
            const err = new Error(parsedErr.message);
            err.status = parsedErr.status;
            err.code = parsedErr.code;
            err.detail = parsedErr.detail;
            err.rawBody = parsedErr.rawText;
            throw err;
          }
          return await resp.json();
        } catch (err) {
          if (attemptTimedOut && !promptOptState.userCancelled && !overallTimedOut) {
            const te = new Error(tr('单次响应超时 (18s)', 'Model timed out (18s)'));
            te.status = 408;
            te.isAttemptTimeout = true;
            throw te;
          }
          throw err;
        } finally {
          if (attemptTimer) clearTimeout(attemptTimer);
          if (onOverallAbort && ctrl?.signal) {
            try { ctrl.signal.removeEventListener('abort', onOverallAbort); } catch {}
          }
        }
      };

      let optimized = '';
      let usedCandidate = null;

      for (let i = 0; i < candidates.length; i++) {
        if (promptOptState.userCancelled || promptOptState.abortCtrl !== ctrl || overallTimedOut) break;
        const cand = candidates[i];
        const hasMoreFallbacks = i < candidates.length - 1;
        try {
          const resPayload = await callGenerate(cand.model, hasMoreFallbacks);
          if (promptOptState.userCancelled || promptOptState.abortCtrl !== ctrl) {
            return { ok: false, cancelled: true };
          }
          const cleaned = cleanOptimizedPromptOutput(resPayload?.response || '', slashPrefix);
          if (!cleaned) {
            const emptyErr = new Error(tr('模型未返回有效优化文本', 'Empty model response'));
            emptyErr.status = 200;
            throw emptyErr;
          }
          optimized = cleaned;
          usedCandidate = cand;
          break;
        } catch (err) {
          const isUserAbort = promptOptState.userCancelled || promptOptState.abortCtrl !== ctrl;
          if (isUserAbort) return { ok: false, cancelled: true };
          const isOverallAbort = overallTimedOut && (err?.name === 'AbortError' || ctrl?.signal?.aborted);
          attempts.push({
            model: cand.model,
            label: cand.label,
            status: Number(err?.status || 0),
            detail: String(err?.detail || ''),
            error: isOverallAbort ? tr('请求超时 (45s)', 'Request timed out (45s)') : String(err?.message || 'failed'),
            rawBody: String(err?.rawBody || '')
          });
          if (isOverallAbort) break;
          if (err?.status === 401 || err?.status === 403) break;
        }
      }

      if (promptOptState.userCancelled || promptOptState.abortCtrl !== ctrl) {
        return { ok: false, cancelled: true };
      }

      if (!optimized || !usedCandidate) {
        const lastAttempt = attempts[attempts.length - 1];
        const summary = lastAttempt
          ? `${lastAttempt.error}${attempts.length > 1 ? tr(`（已尝试 ${attempts.length} 个模型）`, ` (${attempts.length} models tried)`) : ''}`
          : (overallTimedOut ? tr('请求超时 (45s)', 'Request timed out (45s)') : tr('请稍后重试', 'Please retry'));
        const detail = attempts.length > 0
          ? attempts.map((a) => `${a.label || a.model}: ${a.error}`).join(' | ')
          : summary;
        const failErr = new Error(summary);
        failErr.detail = detail;
        failErr.lastAttempt = lastAttempt || null;
        throw failErr;
      }

      promptOptState.lastError = null;
      promptOptState.backupText = rawText;
      promptOptState.canUndo = true;
      promptOptState.loading = false;
      promptOptState.abortCtrl = null;

      const filled = await fillComposerText(optimized);
      if (filled) {
        const curEd = getComposerEditor();
        promptOptState.optimizedText = curEd ? getComposerText(curEd) : optimized;
        promptOptState.undoHintActive = true;
      } else {
        promptOptState.optimizedText = '';
        promptOptState.undoHintActive = false;
      }
      syncPromptOptimizerUI();
      if (filled) {
        showQuickToast(
          tr('提示词已优化（可点击 ↩ 撤回）', 'Prompt optimized (click ↩ Undo to revert)'),
          { persistent: true, tag: 'prompt-opt-undo' }
        );
      }
      return { ok: filled, text: optimized, model: usedCandidate.model, attempts };
    } catch (err) {
      const isUserCancel = Boolean(promptOptState.userCancelled);
      const isTimeoutAbort = !isUserCancel && overallTimedOut;
      const isSilentAbort = isUserCancel || (!isTimeoutAbort && (err?.name === 'AbortError' || ctrl?.signal?.aborted));
      const errMsg = isTimeoutAbort
        ? tr('请求超时 (45s)，请稍后重试', 'Request timed out (45s)')
        : String(err?.message || tr('请稍后重试', 'Please retry'));
      const fullDetail = String(err?.detail || errMsg);

      promptOptState.loading = false;
      promptOptState.abortCtrl = null;
      syncPromptOptimizerUI();

      if (!isSilentAbort) {
        promptOptState.lastError = {
          at: Date.now(),
          pathname: String(globalThis.location?.pathname || ''),
          hasCsrf: Boolean(resolveLanguageServerCsrfToken() || csrf),
          message: errMsg,
          detail: fullDetail,
          attempts
        };
        try { console.warn('[AG-Enhancer] 提示词优化失败:', promptOptState.lastError); } catch {}
        const lastAttempt = err?.lastAttempt || attempts[attempts.length - 1] || null;
        const st = Number(lastAttempt?.status || err?.status || 0);
        let reasonLabel = tr('服务响应异常', 'Service error');
        if (isTimeoutAbort || st === 408 || /timed out|超时/i.test(errMsg)) {
          reasonLabel = tr('请求超时，请稍后重试', 'Request timed out');
        } else if (st === 401 || st === 403) {
          reasonLabel = tr('登录状态失效，请重试', 'Authentication expired');
        } else if (st === 429 || /resource_exhausted|quota/i.test(errMsg)) {
          reasonLabel = tr('请求过于频繁或额度不足', 'Rate limited or quota exhausted');
        } else if (st >= 500 || /internal|unavailable/i.test(errMsg)) {
          reasonLabel = tr('模型服务暂不可用', 'Model service unavailable');
        }
        const rawDetail = String(lastAttempt?.detail || '').trim()
          || errMsg.replace(/^HTTP\s+\d+(?:\s*\([^)]*\))?\s*:\s*/i, '').replace(/（已尝试\s*\d+\s*个模型）|\(\d+\s*models tried\)/g, '').trim();
        const triedHint = attempts.length > 1
          ? tr(`（已尝试 ${attempts.length} 个模型，悬停看详情）`, ` (${attempts.length} models tried, hover for details)`)
          : tr('（悬停看详情）', ' (hover for details)');
        const toastMsg = rawDetail
          ? tr(`优化失败（${reasonLabel}）：${rawDetail}${triedHint}`, `Optimize failed (${reasonLabel}): ${rawDetail}${triedHint}`)
          : tr(`优化失败：${reasonLabel}${triedHint}`, `Optimize failed: ${reasonLabel}${triedHint}`);
        showQuickToast(toastMsg, {
          isError: true,
          durationMs: 7000,
          title: tr(`优化失败详情：${fullDetail}`, `Optimize error details: ${fullDetail}`)
        });
      }
      return {
        ok: false,
        cancelled: isSilentAbort,
        error: errMsg,
        detail: fullDetail,
        attempts
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (promptOptState.abortCtrl === ctrl) {
        promptOptState.loading = false;
        promptOptState.abortCtrl = null;
        syncPromptOptimizerUI();
      }
    }
  }

  // ==================== 思考过程与侧边栏中文化 ====================

  const thoughtZhCache = new Map();
  const sidebarZhCache = new Map();
  const sidebarPendingIds = new Set();
  const sidebarRawTitleMap = new Map();
  const sidebarUserRenamedIds = new Set();
  let localizeTimer = null;
  let localizeMutationObserver = null;
  let thinkingShellTimerRunning = false;
  let thinkingReRunNeeded = false;
  let lastThinkingCascadeId = '';
  const keepExpandedThinkingKeys = new Set();
  const userCollapsedThinkingKeys = new Set();
  const thinkingScrollTopMap = new Map();
  const thinkingReexpandCooldown = new Map();
  let guardingThinking = false;

  function findThinkingFiberNode(trigger) {
    if (!trigger) return null;
    try {
      const fiberKey = Object.keys(trigger).find((k) => k.startsWith('__reactFiber$'));
      let f = fiberKey ? trigger[fiberKey] : null;
      for (let i = 0; i < 8 && f; i++) {
        const p = f.memoizedProps;
        if (p && 'isActive' in p && 'autoScroll' in p && 'trigger' in p) {
          return f;
        }
        f = f.return;
      }
    } catch {}
    return null;
  }

  function getThinkingTriggerKey(trigger) {
    if (!trigger) return '';
    try {
      const fiberKey = Object.keys(trigger).find((k) => k.startsWith('__reactFiber$'));
      let f = fiberKey ? trigger[fiberKey] : null;
      for (let i = 0; i < 14 && f; i++) {
        const p = f.memoizedProps;
        if (p) {
          const metaIdx = p.metadata?.sourceTrajectoryStepInfo?.stepIndex;
          if (metaIdx !== undefined && metaIdx !== null) return `step:${metaIdx}`;
          if (p.stepIndex !== undefined && p.stepIndex !== null) return `step:${p.stepIndex}`;
        }
        f = f.return;
      }
    } catch {}
    return trigger.id ? `id:${trigger.id}` : '';
  }

  function resetThinkingPrevActiveHook(fiber) {
    if (!fiber) return false;
    try {
      const h0 = fiber.memoizedState;
      const h1 = h0?.next;
      const h2 = h1?.next;
      if (!h0 || !h2 || !h2.queue) return false;
      if (h0.memoizedState === true && h2.memoizedState === true) {
        h2.memoizedState = false;
        h2.baseState = false;
        return true;
      }
    } catch {}
    return false;
  }

  function disarmThinkingAutoCollapse(trigger) {
    const f = findThinkingFiberNode(trigger);
    if (!f) return false;
    let changed = resetThinkingPrevActiveHook(f);
    if (f.alternate) {
      changed = resetThinkingPrevActiveHook(f.alternate) || changed;
    }
    return changed;
  }

  function applyCachedThoughtsSync(container) {
    if (!container) return 0;
    let restored = 0;
    const roots = container.querySelectorAll('[data-markdown-root]');
    for (const root of roots) {
      const blocks = root.querySelectorAll('p, li');
      for (const el of blocks) {
        if (el.querySelector('p, li, ul, ol')) continue;
        const curText = (el.textContent || '').trim();
        if (!curText) continue;
        const cached = thoughtZhCache.get(curText);
        if (cached) {
          applyThoughtTranslation(el, curText, cached);
          restored++;
        }
      }
    }
    return restored;
  }

  function bindThinkingScrollRecorder(trigger, key) {
    if (!trigger || !key) return;
    const scrollBox = trigger.nextElementSibling;
    if (!scrollBox || scrollBox.dataset.agScrollBound === key) return;
    scrollBox.dataset.agScrollBound = key;
    scrollBox.addEventListener('scroll', () => {
      if (disposed) return;
      thinkingScrollTopMap.set(key, scrollBox.scrollTop);
    }, { passive: true });
  }

  function guardExpandedThinkingBlocks() {
    if (disposed || guardingThinking) return 0;
    guardingThinking = true;
    try {
      const curCascadeId = getSessionIdFromLocation() || '';
      if (curCascadeId !== lastThinkingCascadeId) {
        lastThinkingCascadeId = curCascadeId;
        keepExpandedThinkingKeys.clear();
        userCollapsedThinkingKeys.clear();
        thinkingScrollTopMap.clear();
        thinkingReexpandCooldown.clear();
      }
      const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
      const now = Date.now();
      let restoredCount = 0;
      for (const trigger of triggers) {
        const key = getThinkingTriggerKey(trigger);
        if (!key) continue;
        const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
          if (!userCollapsedThinkingKeys.has(key)) {
            keepExpandedThinkingKeys.add(key);
            disarmThinkingAutoCollapse(trigger);
            bindThinkingScrollRecorder(trigger, key);
          }
          continue;
        }
        if (keepExpandedThinkingKeys.has(key) && !userCollapsedThinkingKeys.has(key)) {
          const lastAttempt = thinkingReexpandCooldown.get(key) || 0;
          if (now - lastAttempt < 120) continue;
          thinkingReexpandCooldown.set(key, now);
          trigger.click();
          restoredCount++;
          requestAnimationFrame(() => {
            if (disposed) return;
            disarmThinkingAutoCollapse(trigger);
            bindThinkingScrollRecorder(trigger, key);
            if (trigger.parentElement) applyCachedThoughtsSync(trigger.parentElement);
            const savedTop = thinkingScrollTopMap.get(key);
            const scrollBox = trigger.nextElementSibling;
            if (scrollBox && typeof savedTop === 'number' && savedTop > 0) {
              scrollBox.scrollTop = savedTop;
            }
            localizeThinkingShells();
            void translateExpandedThoughts();
          });
        }
      }
      if (restoredCount > 0) updateThinkToggleLabel();
      return restoredCount;
    } finally {
      guardingThinking = false;
    }
  }

  async function postToLiveHost(route, payload) {
    const live = window.__AGContextMeterLive;
    if (!live?.port || !live?.token) return null;
    try {
      const resp = await fetch(`http://127.0.0.1:${live.port}${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AG-Context-Token': live.token
        },
        body: JSON.stringify(payload || {})
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (route === '/remote-info' && data && data.disabled) return data;
      return (data && typeof data === 'object') ? data : null;
    } catch {
      return null;
    }
  }

  function translateThinkingShellText(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    let m;
    if ((m = trimmed.match(/^Thought for (\d+(?:\.\d+)?)s$/))) {
      return raw.replace(trimmed, `已思考 ${m[1]} 秒`);
    }
    if ((m = trimmed.match(/^Thinking for (\d+(?:\.\d+)?)s$/))) {
      return raw.replace(trimmed, `思考中 (${m[1]} 秒)`);
    }
    if ((m = trimmed.match(/^Thinking(\.{0,3})$/))) {
      return raw.replace(trimmed, `思考中${m[1]}`);
    }
    if (trimmed === 'Thought Process') {
      return raw.replace(trimmed, uiLang === 'zh-TW' ? '思考過程' : '思考过程');
    }
    return null;
  }

  function revertThinkingShellText(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    let m;
    if ((m = trimmed.match(/^已思考\s*(\d+(?:\.\d+)?)\s*秒$/))) {
      return raw.replace(trimmed, `Thought for ${m[1]}s`);
    }
    if ((m = trimmed.match(/^思考中\s*\(\s*(\d+(?:\.\d+)?)\s*秒\s*\)$/))) {
      return raw.replace(trimmed, `Thinking for ${m[1]}s`);
    }
    if ((m = trimmed.match(/^思考中(\.{0,3})$/))) {
      return raw.replace(trimmed, `Thinking${m[1]}`);
    }
    if (/^思考[过過]程$/.test(trimmed)) {
      return raw.replace(trimmed, 'Thought Process');
    }
    return null;
  }

  function revertEnhancerTranslations() {
    let reverted = 0;
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (const btn of triggers) {
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const rev = revertThinkingShellText(node.nodeValue);
        if (rev && rev !== node.nodeValue) {
          node.nodeValue = rev;
          reverted++;
        }
      }
    }
    const translatedBlocks = document.querySelectorAll('[data-ag-zh-done="1"]');
    for (const elNode of translatedBlocks) {
      const origSrc = elNode.dataset?.agZhSrc;
      if (origSrc) {
        if (elNode.children?.length > 0) {
          for (const childEl of elNode.children) {
            if (childEl.style?.display === 'none') childEl.style.display = '';
          }
        }
        updateSingleTextSafely(elNode, origSrc);
        reverted++;
      }
      elNode.removeAttribute('data-ag-zh-done');
      elNode.removeAttribute('data-ag-zh-pending');
    }
    const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    for (const row of rows) {
      const span = row.querySelector('span.truncate');
      if (!span) continue;
      const reactTitle = getSidebarReactTitle(span);
      if (reactTitle && (span.textContent || '').trim() !== reactTitle) {
        updateSingleTextSafely(span, reactTitle);
        if (span.getAttribute('title') === reactTitle) span.removeAttribute('title');
        reverted++;
      }
    }
    return reverted;
  }

  function localizeThinkingShells() {
    if (disposed || uiLang === 'en') return 0;
    let changedCount = 0;
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (const btn of triggers) {
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const translated = translateThinkingShellText(node.nodeValue);
        if (translated && translated !== node.nodeValue) {
          node.nodeValue = translated;
          changedCount++;
        }
      }
    }
    return changedCount;
  }

  function updateSingleTextSafely(el, nextText) {
    // 优先复用原有 Text 节点而不增删子节点，防止影响 React 的 DOM diff 引用
    const directTexts = [];
    for (const ch of el.childNodes) {
      if (ch.nodeType === Node.TEXT_NODE) directTexts.push(ch);
    }
    if (el.children.length === 0) {
      if (directTexts.length > 0) {
        directTexts[0].nodeValue = nextText;
        for (let i = 1; i < directTexts.length; i++) {
          directTexts[i].nodeValue = '';
        }
      } else {
        el.textContent = nextText;
      }
      return;
    }

    // 含内联元素（如 code/strong）的段落，先隐藏元素子节点并在保留首个文本节点中写入译文
    if (directTexts.length > 0) {
      for (const childEl of el.children) {
        childEl.style.display = 'none';
      }
      directTexts[0].nodeValue = nextText;
      for (let i = 1; i < directTexts.length; i++) {
        directTexts[i].nodeValue = '';
      }
      return;
    }

    // 若完全无直属文本节点（例如 <li><strong>...</strong></li>），找首个后代文本节点写入并隐藏其余兄弟分支
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const firstDescText = walker.nextNode();
    if (firstDescText) {
      firstDescText.nodeValue = nextText;
      let extra;
      while ((extra = walker.nextNode())) {
        extra.nodeValue = '';
      }
    } else {
      el.textContent = nextText;
    }
  }

  function applyThoughtTranslation(el, rawSrc, zhText) {
    if (!el || !zhText) return;
    el.setAttribute('data-ag-zh-done', '1');
    el.dataset.agZhSrc = rawSrc;
    el.dataset.agZhText = zhText;
    if (!el.title) el.title = rawSrc;
    updateSingleTextSafely(el, zhText);
  }

  function shouldTranslateThoughtElement(text) {
    if (!text || text.length < 8) return false;
    const zhCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const enWords = (text.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
    return zhCount < 2 && enWords >= 3;
  }

  async function translateExpandedThoughts() {
    if (disposed || uiLang === 'en') return 0;
    if (thinkingShellTimerRunning) {
      thinkingReRunNeeded = true;
      return 0;
    }
    thinkingShellTimerRunning = true;
    try {
      const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
      const candidates = [];
      for (const trigger of triggers) {
        const triggerText = (trigger.textContent || '').trim();
        const isStreaming = /^(Thinking|思考中)/.test(triggerText);
        const container = trigger.parentElement;
        if (!container) continue;
        const roots = container.querySelectorAll('[data-markdown-root]');
        for (const root of roots) {
          const blocks = Array.from(root.querySelectorAll('p, li'));
          for (let idx = 0; idx < blocks.length; idx++) {
            const el = blocks[idx];
            // 仅处理叶子文本块，避免同时覆盖包含子段落的 li
            if (el.querySelector('p, li, ul, ol')) continue;
            if (el.getAttribute('data-ag-zh-pending') === '1') continue;
            // 流式输出中的最后一个含子元素的段落暂缓，防止与流式 Markdown 渲染竞争
            if (isStreaming && idx === blocks.length - 1 && el.children.length > 0) continue;

            const curText = (el.textContent || '').trim();
            if (el.getAttribute('data-ag-zh-done') === '1') {
              const cachedDone = el.dataset.agZhSrc ? thoughtZhCache.get(el.dataset.agZhSrc) : null;
              if (cachedDone && curText === el.dataset.agZhSrc) {
                applyThoughtTranslation(el, el.dataset.agZhSrc, cachedDone);
              }
              continue;
            }

            if (!shouldTranslateThoughtElement(curText)) continue;
            const cached = thoughtZhCache.get(curText);
            if (cached) {
              applyThoughtTranslation(el, curText, cached);
              continue;
            }
            candidates.push({ el, raw: curText });
          }
        }
      }

      if (!candidates.length) return 0;

      const batch = [];
      const uniqueTexts = [];
      const seenTexts = new Set();
      for (const item of candidates) {
        if (!seenTexts.has(item.raw)) {
          if (uniqueTexts.length >= 25) continue;
          seenTexts.add(item.raw);
          uniqueTexts.push(item.raw);
        }
        item.el.setAttribute('data-ag-zh-pending', '1');
        batch.push(item);
      }

      const res = await postToLiveHost('/translate-zh', {
        texts: uniqueTexts,
        targetLang: uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN'
      });
      const map = res?.translations || {};
      let updated = 0;
      for (const item of batch) {
        item.el.removeAttribute('data-ag-zh-pending');
        const zh = map[item.raw];
        if (zh) {
          thoughtZhCache.set(item.raw, zh);
          applyThoughtTranslation(item.el, item.raw, zh);
          updated++;
        }
      }

      // 若还有剩余未翻译段落，调度继续翻译
      if (candidates.length > batch.length) {
        scheduleLocalization();
      }
      return updated;
    } finally {
      thinkingShellTimerRunning = false;
      if (thinkingReRunNeeded && !disposed) {
        thinkingReRunNeeded = false;
        setTimeout(() => {
          if (!disposed) void translateExpandedThoughts();
        }, 30);
      }
    }
  }

  function getSidebarReactTitle(span) {
    if (!span) return '';
    try {
      const propKey = Object.keys(span).find((k) => k.startsWith('__reactProps$'));
      if (propKey && typeof span[propKey]?.children === 'string') {
        const raw = span[propKey].children.trim();
        if (raw) return raw;
      }
    } catch {}
    return (span.textContent || '').trim();
  }

  function shouldAutoTranslateSidebarTitle(title) {
    if (!title) return false;
    if (/[\u4e00-\u9fff]/.test(title)) return false;
    const enWords = (title.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
    return enWords >= 3;
  }

  function applySidebarTitleDom(row, rawTitle, zhTitle) {
    const span = row?.querySelector('span.truncate');
    if (!span || !zhTitle) return false;
    const cur = (span.textContent || '').trim();
    if (cur === zhTitle) return false;
    if (!span.title && rawTitle) span.title = rawTitle;
    updateSingleTextSafely(span, zhTitle);
    return true;
  }

  function extractSidebarRowId(row) {
    if (!row) return '';
    const attrId = (row.getAttribute('data-cascade-id') || '').trim();
    if (attrId) return attrId;
    const href = row.querySelector?.('a[href*="/c/"]')?.getAttribute('href') || '';
    const m = href.match(/\/c\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  function escapeCssIdent(v) {
    return (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(v)
      : String(v).replace(/["\\]/g, '\\$&');
  }

  function findSidebarRowById(id) {
    if (!id) return null;
    const direct = document.querySelector(`[data-testid="conversation-row-sidebar"][data-cascade-id="${escapeCssIdent(id)}"]`);
    if (direct) return direct;
    const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    for (const row of rows) {
      if (extractSidebarRowId(row) === id) return row;
    }
    return null;
  }

  async function localizeSidebarConversations() {
    if (disposed || uiLang === 'en') return 0;
    const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    const needLocalize = [];
    const seenNeed = new Set();
    let appliedCount = 0;

    for (const row of rows) {
      const id = extractSidebarRowId(row);
      if (!id) continue;
      if (row.querySelector('input, textarea, [contenteditable="true"]')) continue;
      const span = row.querySelector('span.truncate');
      if (!span) continue;
      const reactTitle = getSidebarReactTitle(span);
      if (!reactTitle) continue;
      const domTitle = (span.textContent || '').trim();

      const prevRaw = sidebarRawTitleMap.get(id);
      if (prevRaw !== undefined && prevRaw !== reactTitle) {
        sidebarUserRenamedIds.add(id);
        sidebarZhCache.delete(id);
        sidebarRawTitleMap.set(id, reactTitle);
      } else if (prevRaw === undefined) {
        sidebarRawTitleMap.set(id, reactTitle);
      }

      if (sidebarUserRenamedIds.has(id) || !shouldAutoTranslateSidebarTitle(reactTitle)) {
        if (domTitle !== reactTitle) {
          updateSingleTextSafely(span, reactTitle);
          appliedCount++;
        }
        if (span.hasAttribute('title')) {
          span.removeAttribute('title');
        }
        continue;
      }

      const cached = sidebarZhCache.get(id);
      if (cached) {
        if (applySidebarTitleDom(row, reactTitle, cached)) appliedCount++;
        continue;
      }

      if (sidebarPendingIds.has(id) || seenNeed.has(id)) continue;
      seenNeed.add(id);
      needLocalize.push({ id, title: reactTitle });
    }

    if (!needLocalize.length) return appliedCount;

    for (const it of needLocalize) sidebarPendingIds.add(it.id);
    try {
      const res = await postToLiveHost('/localize-conversations', {
        items: needLocalize,
        targetLang: uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN'
      });
      const titles = res?.titles || {};
      for (const [id, zhTitle] of Object.entries(titles)) {
        if (!zhTitle || sidebarUserRenamedIds.has(id)) continue;
        sidebarZhCache.set(id, zhTitle);
        const row = findSidebarRowById(id);
        if (row) {
          const rawTitle = needLocalize.find((x) => x.id === id)?.title || '';
          if (applySidebarTitleDom(row, rawTitle, zhTitle)) appliedCount++;
        }
      }
      return appliedCount;
    } finally {
      for (const it of needLocalize) sidebarPendingIds.delete(it.id);
    }
  }

  function scheduleLocalization() {
    if (disposed || uiLang === 'en' || localizeTimer) return;
    localizeTimer = setTimeout(() => {
      localizeTimer = null;
      if (disposed) return;
      localizeThinkingShells();
      void translateExpandedThoughts();
      void localizeSidebarConversations();
    }, 250);
  }

  function startLocalizationObserver() {
    if (localizeMutationObserver || !document.body) return;
    localizeMutationObserver = new MutationObserver((mutations) => {
      if (disposed) return;
      let fastExpand = false;
      let needGuardThinking = false;
      let needSchedule = false;
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.attributeName !== 'aria-expanded') continue;
          const target = m.target;
          if (target?.getAttribute?.('data-testid') === 'thinking-collapsible-trigger') {
            if (target.getAttribute('aria-expanded') === 'true') {
              fastExpand = true;
            } else {
              needGuardThinking = true;
            }
          }
          needSchedule = true;
        } else {
          needGuardThinking = true;
          needSchedule = true;
        }
      }
      if (needGuardThinking) {
        guardExpandedThinkingBlocks();
      }
      if (fastExpand) {
        setTimeout(() => {
          if (disposed) return;
          localizeThinkingShells();
          void translateExpandedThoughts();
        }, 30);
      } else if (needSchedule) {
        scheduleLocalization();
      }
    });
    localizeMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-expanded']
    });
  }

  // ==================== 右侧边栏文件内联编辑器 ====================

  function getFileViewerContext() {
    const header =
      document.querySelector('[aria-label="File Viewer header"], [aria-label="文件查看器标题栏"]') ||
      Array.from(document.querySelectorAll('.group\\/file-row')).find((el) => el.querySelector('[data-uri]')) ||
      null;
    if (!header) return null;
    const uriNodes = header.querySelectorAll('[data-uri]');
    const lastUriNode = uriNodes[uriNodes.length - 1];
    const fileUri = lastUriNode?.getAttribute('data-uri') || '';
    const actionRow = header.querySelector('.flex.items-center.gap-1.shrink') || header.lastElementChild;
    const bodyContainer = header.nextElementSibling;
    return { header, fileUri, actionRow, bodyContainer };
  }

  function updateFileEditorStatusBar(text) {
    if (text !== undefined) fileEditorState.statusText = text;
    const wrap = document.getElementById(FILE_EDITOR_WRAP_ID);
    const leftEl = wrap?.querySelector('.ag-fedit-status-left');
    if (leftEl) {
      const prefix = fileEditorState.dirty ? '● 未保存' : '已同步';
      const detail = fileEditorState.statusText || (fileEditorState.filePath || '');
      leftEl.textContent = `${prefix} · ${detail}`;
      leftEl.title = fileEditorState.filePath || '';
    }
  }

  function restoreHiddenViewerChildren() {
    document.querySelectorAll('[data-ag-editor-host="1"]').forEach((hostEl) => {
      hostEl.removeAttribute('data-ag-editor-host');
    });
    document.querySelectorAll('[data-ag-hidden-by-editor="1"]').forEach((el) => {
      el.style.display = el.dataset.agPrevDisplay || '';
      delete el.dataset.agPrevDisplay;
      el.removeAttribute('data-ag-hidden-by-editor');
    });
  }

  /** 隐藏文件查看器原有的预览子节点，保留内联编辑器容器 */
  function hideNativeViewerChildren(bodyContainer) {
    if (!bodyContainer) return;
    if (bodyContainer.getAttribute('data-ag-editor-host') !== '1') {
      bodyContainer.setAttribute('data-ag-editor-host', '1');
    }
    for (const child of Array.from(bodyContainer.children)) {
      if (child.id === FILE_EDITOR_WRAP_ID) continue;
      if (child.getAttribute('data-ag-hidden-by-editor') !== '1' || child.style.display !== 'none') {
        if (!('agPrevDisplay' in child.dataset)) {
          child.dataset.agPrevDisplay = child.style.display || '';
        }
        child.setAttribute('data-ag-hidden-by-editor', '1');
        child.style.display = 'none';
      }
    }
  }

  /** 在编辑态持续保护编辑器 DOM 不被 React 重渲染覆盖或脱离宿主 */
  function syncFileEditorHostDom(ctx) {
    if (!fileEditorState.active || !ctx?.bodyContainer) return;
    hideNativeViewerChildren(ctx.bodyContainer);
    if (activeEditorWrapEl && activeEditorWrapEl.parentElement !== ctx.bodyContainer) {
      ctx.bodyContainer.appendChild(activeEditorWrapEl);
    }
  }

  function exitFileEditor(shouldRefresh = true) {
    if (activeEditorWrapEl) {
      safeRemove(activeEditorWrapEl);
      activeEditorWrapEl = null;
    }
    safeRemove(document.getElementById(FILE_EDITOR_WRAP_ID));
    restoreHiddenViewerChildren();
    const ctx = getFileViewerContext();
    fileEditorState.active = false;
    fileEditorState.filePath = '';
    fileEditorState.dirty = false;
    fileEditorState.saving = false;
    fileEditorState.loading = false;
    fileEditorState.savedOnce = false;
    fileEditorState.statusText = '';
    renderFileEditorControls(ctx);
    if (shouldRefresh && ctx?.header) {
      const refreshBtn = ctx.header.querySelector('[data-testid="file-view-refresh"]');
      if (refreshBtn) {
        try { refreshBtn.click(); } catch {}
      }
    }
  }

  async function saveFileEditor() {
    if (!fileEditorState.active || fileEditorState.saving) return false;
    const textarea = document.getElementById('ag-inline-file-textarea');
    if (!textarea || !fileEditorState.fileUri) return false;
    fileEditorState.saving = true;
    renderFileEditorControls(getFileViewerContext());
    updateFileEditorStatusBar('正在保存...');
    try {
      const res = await postToLiveHost('/write-local-file', {
        path: fileEditorState.fileUri,
        content: textarea.value
      });
      if (!res || !res.ok) {
        updateFileEditorStatusBar(`保存失败: ${res?.error || '本地服务未连接'}`);
        showQuickToast(`保存失败: ${res?.error || '本地服务未连接'}`, { isError: true });
        return false;
      }
      fileEditorState.dirty = false;
      fileEditorState.savedOnce = true;
      updateFileEditorStatusBar(`已保存 (${res.bytes} 字节)`);
      showQuickToast('文件已保存');
      return true;
    } finally {
      fileEditorState.saving = false;
      renderFileEditorControls(getFileViewerContext());
    }
  }

  async function enterFileEditor() {
    const ctx = getFileViewerContext();
    if (!ctx || !ctx.fileUri || !ctx.bodyContainer) {
      showQuickToast('未检测到当前打开的本地文件');
      return;
    }
    if (fileEditorState.loading) return;
    fileEditorState.loading = true;
    renderFileEditorControls(ctx);
    try {
      const res = await postToLiveHost('/read-local-file', { path: ctx.fileUri });
      if (!res || !res.ok) {
        showQuickToast(`无法编辑: ${res?.error || '读取文件失败'}`);
        return;
      }
      // 再次确认用户未在等待期间关闭面板
      const curCtx = getFileViewerContext();
      if (!curCtx || curCtx.fileUri !== ctx.fileUri || !curCtx.bodyContainer) return;

      const { host } = getMeterHostAndShadow();
      const theme = resolveSurfaceTheme(host);

      hideNativeViewerChildren(curCtx.bodyContainer);

      let wrap = document.getElementById(FILE_EDITOR_WRAP_ID);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = FILE_EDITOR_WRAP_ID;
        wrap.setAttribute('data-ag-theme', theme);

        const statusbar = document.createElement('div');
        statusbar.className = 'ag-fedit-statusbar';
        const statusLeft = document.createElement('span');
        statusLeft.className = 'ag-fedit-status-left';
        statusLeft.style.overflow = 'hidden';
        statusLeft.style.textOverflow = 'ellipsis';
        statusLeft.style.whiteSpace = 'nowrap';
        const statusRight = document.createElement('span');
        statusRight.textContent = tr('⌘S / Ctrl+S 保存 · Tab 缩进', '⌘S / Ctrl+S Save · Tab Indent');
        statusRight.style.flexShrink = '0';
        statusbar.appendChild(statusLeft);
        statusbar.appendChild(statusRight);

        const textarea = document.createElement('textarea');
        textarea.id = 'ag-inline-file-textarea';
        textarea.spellcheck = false;
        textarea.value = res.content;
        textarea.addEventListener('input', () => {
          if (!fileEditorState.dirty) {
            fileEditorState.dirty = true;
            renderFileEditorControls(getFileViewerContext());
          }
          updateFileEditorStatusBar('有未保存修改');
        });
        textarea.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            e.stopPropagation();
            void saveFileEditor();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const val = textarea.value;
            textarea.value = val.slice(0, start) + '  ' + val.slice(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            if (!fileEditorState.dirty) {
              fileEditorState.dirty = true;
              renderFileEditorControls(getFileViewerContext());
            }
            updateFileEditorStatusBar('有未保存修改');
          }
        });

        wrap.appendChild(statusbar);
        wrap.appendChild(textarea);
        curCtx.bodyContainer.appendChild(wrap);
      } else {
        wrap.setAttribute('data-ag-theme', theme);
        const textarea = wrap.querySelector('#ag-inline-file-textarea');
        if (textarea) textarea.value = res.content;
      }

      activeEditorWrapEl = wrap;
      fileEditorState.active = true;
      fileEditorState.fileUri = ctx.fileUri;
      fileEditorState.filePath = res.filePath || '';
      fileEditorState.dirty = false;
      fileEditorState.savedOnce = false;
      fileEditorState.statusText = res.filePath || '';
      updateFileEditorStatusBar(res.filePath || '');

      const textareaEl = document.getElementById('ag-inline-file-textarea');
      if (textareaEl) textareaEl.focus();
    } finally {
      fileEditorState.loading = false;
      renderFileEditorControls(getFileViewerContext());
    }
  }

  function renderFileEditorControls(ctx) {
    if (!ctx || !ctx.actionRow || !ctx.fileUri || !/^file:\/\//i.test(ctx.fileUri)) {
      safeRemove(document.getElementById(FILE_EDITOR_CONTROLS_ID));
      return;
    }
    const { host } = getMeterHostAndShadow();
    const theme = resolveSurfaceTheme(host);
    let controls = document.getElementById(FILE_EDITOR_CONTROLS_ID);
    if (!controls) {
      controls = document.createElement('div');
      controls.id = FILE_EDITOR_CONTROLS_ID;
    }
    if (controls.getAttribute('data-ag-theme') !== theme) {
      controls.setAttribute('data-ag-theme', theme);
    }
    if (controls.parentElement !== ctx.actionRow || controls !== ctx.actionRow.firstElementChild) {
      ctx.actionRow.insertBefore(controls, ctx.actionRow.firstChild);
    }

    const modeKey = [
      fileEditorState.active ? 'edit' : 'view',
      fileEditorState.loading ? 'loading' : '',
      fileEditorState.saving ? 'saving' : '',
      fileEditorState.dirty ? 'dirty' : ''
    ].join(':');
    if (controls.getAttribute('data-ag-mode-key') === modeKey) {
      const wrap = document.getElementById(FILE_EDITOR_WRAP_ID);
      if (wrap && wrap.getAttribute('data-ag-theme') !== theme) {
        wrap.setAttribute('data-ag-theme', theme);
      }
      return;
    }
    controls.setAttribute('data-ag-mode-key', modeKey);
    controls.textContent = '';

    if (!fileEditorState.active) {
      const editBtn = document.createElement('button');
      editBtn.id = 'ag-fedit-toggle';
      editBtn.type = 'button';
      editBtn.className = 'ag-fedit-btn';
      editBtn.textContent = fileEditorState.loading ? tr('读取中…', 'Loading…') : tr('编辑', 'Edit');
      editBtn.title = tr('在侧边栏直接编辑当前文件', 'Edit current file inline');
      editBtn.addEventListener('mousedown', (e) => e.preventDefault());
      editBtn.addEventListener('click', () => { void enterFileEditor(); });
      controls.appendChild(editBtn);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.id = 'ag-fedit-save';
      saveBtn.type = 'button';
      saveBtn.className = 'ag-fedit-btn';
      saveBtn.setAttribute('data-primary', 'true');
      saveBtn.textContent = fileEditorState.saving ? tr('保存中…', 'Saving…') : (fileEditorState.dirty ? tr('保存*', 'Save*') : tr('保存', 'Save'));
      saveBtn.title = tr('保存更改到硬盘 (⌘S / Ctrl+S)', 'Save changes to disk (⌘S / Ctrl+S)');
      saveBtn.addEventListener('mousedown', (e) => e.preventDefault());
      saveBtn.addEventListener('click', () => { void saveFileEditor(); });

      const doneBtn = document.createElement('button');
      doneBtn.id = 'ag-fedit-done';
      doneBtn.type = 'button';
      doneBtn.className = 'ag-fedit-btn';
      doneBtn.textContent = tr('完成', 'Done');
      doneBtn.title = tr('退出编辑并返回预览（自动刷新最新内容）', 'Exit editor and return to preview');
      doneBtn.addEventListener('mousedown', (e) => e.preventDefault());
      doneBtn.addEventListener('click', () => { exitFileEditor(true); });

      controls.appendChild(saveBtn);
      controls.appendChild(doneBtn);
    }
  }

  function ensureFileViewerEditor() {
    if (disposed) return;
    ensureDocStyle();
    const ctx = getFileViewerContext();
    if (!ctx) {
      if (fileEditorState.active) exitFileEditor(false);
      else safeRemove(document.getElementById(FILE_EDITOR_CONTROLS_ID));
      return;
    }
    if (fileEditorState.active && fileEditorState.fileUri && ctx.fileUri !== fileEditorState.fileUri) {
      exitFileEditor(false);
    }
    if (fileEditorState.active) {
      syncFileEditorHostDom(ctx);
    }
    renderFileEditorControls(ctx);
  }

  // ==================== Cmd+点击使用系统浏览器打开链接 ====================

  function normalizeExternalUrlCandidate(raw) {
    const trimmed = String(raw || '').trim().replace(/[.,;:!?'"`）)\]}]+$/g, '');
    if (!/^(?:https?:\/\/|mailto:)/i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        return parsed.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  function extractExternalUrlFromTarget(target) {
    const el = target instanceof Element ? target : target?.parentElement;
    if (!el) return null;
    if (el.closest(`textarea, input, [contenteditable="true"], #${QUICK_BAR_ID}, #${CHAT_NAV_ID}, #${FILE_EDITOR_CONTROLS_ID}, #${FILE_EDITOR_WRAP_ID}`)) {
      return null;
    }
    const anchor = el.closest('a[href]');
    if (anchor) {
      const rawHref = (anchor.getAttribute('href') || '').trim();
      return normalizeExternalUrlCandidate(rawHref);
    }
    // 跳过文件引用胶囊或普通按钮（避免劫持内部操作）
    if (el.closest('button, [data-uri]')) return null;
    const codeEl = el.closest('code');
    if (codeEl) {
      const match = (codeEl.textContent || '').match(/(https?:\/\/[^\s<>"'`)\]]+)/i);
      return match ? normalizeExternalUrlCandidate(match[1]) : null;
    }
    const textHost = el.closest('span, p, li, td');
    if (textHost && (textHost.textContent || '').length <= 500) {
      const match = (textHost.textContent || '').match(/(https?:\/\/[^\s<>"'`)\]]+)/i);
      if (match) return normalizeExternalUrlCandidate(match[1]);
    }
    return null;
  }

  async function openExternalUrlInSystemBrowser(url, opts) {
    const safeUrl = normalizeExternalUrlCandidate(url);
    if (!safeUrl) return { ok: false, error: '无效的外部链接' };
    const dryRun = Boolean(opts && opts.dryRun);
    const res = await postToLiveHost('/open-external-url', { url: safeUrl, dryRun });
    if (res && res.ok) {
      if (!dryRun) showQuickToast(tr('已用系统浏览器打开链接', 'Opened in system browser'));
      return res;
    }
    if (!dryRun && typeof window.contextMeterAPI?.openBrowserUrl === 'function') {
      try {
        const ipcRes = await window.contextMeterAPI.openBrowserUrl(safeUrl);
        if (ipcRes && ipcRes.ok) {
          showQuickToast(tr('已用系统浏览器打开链接', 'Opened in system browser'));
          return { ...ipcRes, fallback: 'contextMeterAPI' };
        }
      } catch {
        // ignore fallback error
      }
    }
    if (!dryRun && typeof window.electronNative?.openExternal === 'function') {
      try {
        window.electronNative.openExternal(safeUrl);
        showQuickToast(tr('已用系统浏览器打开链接', 'Opened in system browser'));
        return { ok: true, url: safeUrl, fallback: 'electronNative' };
      } catch {
        // ignore fallback error
      }
    }
    if (!dryRun && typeof window.open === 'function') {
      try {
        const opened = window.open(safeUrl, '_blank', 'noopener,noreferrer');
        if (opened) {
          showQuickToast(tr('已用系统浏览器打开链接', 'Opened in system browser'));
          return { ok: true, url: safeUrl, fallback: 'windowOpen' };
        }
      } catch {
        // ignore fallback error
      }
    }
    if (!dryRun) showQuickToast(tr('未能打开外部链接', 'Failed to open external link'), { isError: true });
    return { ok: false, error: '打开失败' };
  }

  function getOrderedSidebarConversationRows() {
    return Array.from(document.querySelectorAll('[data-testid="conversation-row-sidebar"]'))
      .filter((row) => Boolean(extractSidebarRowId(row)));
  }

  function isSidebarRowActive(row, currentId = getSessionIdFromLocation() || '') {
    if (!row) return false;
    const id = extractSidebarRowId(row);
    const cls = String(row.className || '');
    return Boolean(
      (currentId && id === currentId) ||
      row.getAttribute('data-selected') === 'true' ||
      row.getAttribute('aria-current') === 'true' ||
      row.getAttribute('data-active') === 'true' ||
      /\bbg-accent\b|\bbg-secondary\b/.test(cls)
    );
  }

  function getSidebarRowDisplayTitle(row) {
    if (!row) return '';
    const span = row.querySelector('span.truncate');
    const id = extractSidebarRowId(row);
    return (span?.textContent || row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim() || id.slice(0, 8);
  }

  function syncSidebarShortcutBadges() {
    if (disposed) return 0;
    ensureDocStyle();
    const allRows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    let idx = 0;
    for (const row of allRows) {
      const hasId = Boolean(extractSidebarRowId(row));
      if (hasId && idx < 9) {
        const label = `⌘${idx + 1}`;
        if (row.getAttribute('data-ag-shortcut') !== label) {
          row.setAttribute('data-ag-shortcut', label);
        }
        idx += 1;
      } else if (row.hasAttribute('data-ag-shortcut')) {
        row.removeAttribute('data-ag-shortcut');
      }
    }
    return idx;
  }

  function switchSidebarConversationByIndex(targetIndex) {
    const rows = getOrderedSidebarConversationRows();
    if (!rows.length) {
      return { ok: false, reason: 'empty' };
    }
    if (targetIndex < 0 || targetIndex >= rows.length) {
      showQuickToast(tr(`当前仅有 ${rows.length} 个对话`, `Only ${rows.length} conversation(s)`));
      return { ok: false, reason: 'out-of-range', total: rows.length };
    }
    const row = rows[targetIndex];
    const id = extractSidebarRowId(row);
    const title = getSidebarRowDisplayTitle(row).slice(0, 36);
    if (isSidebarRowActive(row, getSessionIdFromLocation() || '')) {
      showQuickToast(tr(`已在对话 #${targetIndex + 1}：${title}`, `Already in #${targetIndex + 1}: ${title}`));
      return { ok: true, alreadyActive: true, index: targetIndex, id, title };
    }
    const clickTarget = row.querySelector('a[href]') || row;
    clickTarget.click();
    showQuickToast(tr(`已切换至 #${targetIndex + 1}：${title}`, `Switched to #${targetIndex + 1}: ${title}`));
    return { ok: true, alreadyActive: false, index: targetIndex, id, title };
  }

  function cycleSidebarConversation(delta) {
    const rows = getOrderedSidebarConversationRows();
    if (!rows.length) {
      return { ok: false, reason: 'empty' };
    }
    if (rows.length === 1) {
      return switchSidebarConversationByIndex(0);
    }
    const currentId = getSessionIdFromLocation() || '';
    const curIdx = rows.findIndex((r) => isSidebarRowActive(r, currentId));
    const step = delta < 0 ? -1 : 1;
    const nextIdx = curIdx >= 0
      ? (curIdx + step + rows.length) % rows.length
      : (step > 0 ? 0 : rows.length - 1);
    return switchSidebarConversationByIndex(nextIdx);
  }

  function syncCmdModifierState(active) {
    if (active) {
      syncSidebarShortcutBadges();
      document.documentElement.setAttribute('data-ag-cmd-down', '1');
    } else {
      document.documentElement.removeAttribute('data-ag-cmd-down');
    }
  }

  // ==================== 全局事件与定时巡检 ====================

  function onDocClick(e) {
    if (!popoverOpen && !remotePopoverOpen) return;
    const { sr } = getMeterHostAndShadow();
    if (!sr) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (popoverOpen) {
      const btn = sr.getElementById(QUOTA_BADGE_ID);
      const pop = sr.getElementById(QUOTA_POPOVER_ID);
      if (!(btn && path.includes(btn)) && !(pop && path.includes(pop))) {
        toggleQuotaPopover(false);
      }
    }
    if (remotePopoverOpen) {
      const rBtn = sr.getElementById(REMOTE_BADGE_ID);
      const rPop = sr.getElementById(REMOTE_POPOVER_ID);
      if (!(rBtn && path.includes(rBtn)) && !(rPop && path.includes(rPop))) {
        toggleRemotePopover(false);
      }
    }
  }

  function onWindowClickCapture(e) {
    if (e.isTrusted && !e.metaKey && !e.ctrlKey && !e.altKey && e.button === 0) {
      if (e.target?.closest?.('[data-testid="input-send-button"], [aria-label="Send"], [aria-label="发送"]')) {
        lastUserSubmitAt = Date.now();
        clearPromptOptUndoState();
        hideNextStepGhost();
        syncPromptOptimizerUI();
      }
      const thinkTrigger = e.target?.closest?.('[data-testid="thinking-collapsible-trigger"]');
      if (thinkTrigger) {
        const key = getThinkingTriggerKey(thinkTrigger);
        if (key) {
          const curExpanded = thinkTrigger.getAttribute('aria-expanded') === 'true';
          if (curExpanded) {
            userCollapsedThinkingKeys.add(key);
            keepExpandedThinkingKeys.delete(key);
          } else {
            userCollapsedThinkingKeys.delete(key);
            keepExpandedThinkingKeys.add(key);
          }
        }
      }
    }
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0 || e.altKey) return;
    const url = extractExternalUrlFromTarget(e.target);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
    void openExternalUrlInSystemBrowser(url);
  }

  function onDocKeydown(e) {
    syncCmdModifierState(Boolean(e.metaKey || e.ctrlKey));
    if (e.key === 'Escape' && (popoverOpen || remotePopoverOpen)) {
      if (popoverOpen) toggleQuotaPopover(false);
      if (remotePopoverOpen) toggleRemotePopover(false);
      return;
    }
    if (disposed || e.isComposing || isComposerComposing) return;
    const target = (e.target && e.target.nodeType === 1) ? e.target : e.target?.parentElement;
    const inShortcutSafeField = Boolean(
      target?.closest?.('[data-testid="conversation-row-sidebar"] input, [data-testid="conversation-row-sidebar"] textarea, #ag-inline-file-textarea')
    );
    if (!inShortcutSafeField) {
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const codeMatch = /^Digit([1-9])$/.exec(String(e.code || ''));
        const digit = /^[1-9]$/.test(String(e.key || ''))
          ? Number(e.key)
          : (codeMatch ? Number(codeMatch[1]) : 0);
        if (digit >= 1 && digit <= 9) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          switchSidebarConversationByIndex(digit - 1);
          return;
        }
      }
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '[' || e.key === '{' || e.code === 'BracketLeft') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          cycleSidebarConversation(-1);
          return;
        }
        if (e.key === ']' || e.key === '}' || e.code === 'BracketRight') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          cycleSidebarConversation(1);
          return;
        }
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        cycleSidebarConversation(e.shiftKey ? -1 : 1);
        return;
      }
    }
    const ed = getComposerEditor();
    if (!ed || !target || !ed.contains(target)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !isComposerEmpty(ed) && ed.getAttribute('aria-expanded') !== 'true') {
      lastUserSubmitAt = Date.now();
      clearPromptOptUndoState();
      hideNextStepGhost();
      syncPromptOptimizerUI();
      return;
    }
    if (!nextStepState.visible || isAssistantBusy() || !isComposerEmpty(ed) || ed.getAttribute('aria-expanded') === 'true') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      void acceptNextStepSuggestion();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (nextStepState.candidates.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        cycleNextStepSuggestion(e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      nextStepState.dismissedSig = nextStepState.replySig;
      hideNextStepGhost();
    }
  }

  function onDocCompositionStart(e) {
    const ed = getComposerEditor();
    const target = (e.target && e.target.nodeType === 1) ? e.target : e.target?.parentElement;
    if (!ed || !target || !ed.contains(target)) return;
    isComposerComposing = true;
    hideNextStepGhost();
  }

  function onDocCompositionEnd(e) {
    const ed = getComposerEditor();
    const target = (e.target && e.target.nodeType === 1) ? e.target : e.target?.parentElement;
    if (!ed || !target || !ed.contains(target)) return;
    isComposerComposing = false;
    setTimeout(() => {
      if (!disposed) ensureNextStepGhost();
    }, 0);
  }

  function onDocInput(e) {
    if (disposed) return;
    const ed = getComposerEditor();
    const target = (e.target && e.target.nodeType === 1) ? e.target : e.target?.parentElement;
    if (!ed || !target || !ed.contains(target)) return;
    syncPromptOptimizerUI();
    if (isComposerComposing || !isComposerEmpty(ed)) {
      hideNextStepGhost();
    } else {
      setTimeout(() => {
        if (!disposed) ensureNextStepGhost();
      }, 0);
    }
  }

  function onDocKeyup(e) {
    syncCmdModifierState(Boolean(e.metaKey || e.ctrlKey));
  }

  function onWindowBlur() {
    syncCmdModifierState(false);
  }

  function onWindowResize() {
    positionChatNavFloat(document.getElementById(CHAT_NAV_ID));
  }

  function applyEnhancerFeatureVisibility() {
    if (disposed) return;
    if (!featureFlags.showQuickBar) {
      hideQuickBarTooltip();
      safeRemove(document.getElementById(QUICK_BAR_ID));
    } else {
      ensureQuickCapsuleBar();
    }
    if (!featureFlags.showChatNav) {
      safeRemove(document.getElementById(CHAT_NAV_ID));
    } else {
      ensureChatNavFloat();
    }
    const { sr } = getMeterHostAndShadow();
    if (sr) {
      const qBtn = sr.getElementById(QUOTA_BADGE_ID);
      if (qBtn) qBtn.hidden = featureFlags.showTopbarQuota === false;
      if (featureFlags.showTopbarQuota === false) toggleQuotaPopover(false);
      const rBtn = sr.getElementById(REMOTE_BADGE_ID);
      if (rBtn) rBtn.hidden = featureFlags.showTopbarRemote === false;
      if (featureFlags.showTopbarRemote === false) toggleRemotePopover(false);
    }
  }

  function syncRemotePairData(data) {
    if (disposed || !data || typeof data !== 'object') return remotePairState;
    remotePairState.data = data;
    remotePairState.error = '';
    updateRemoteBtnLanguage({ skipRender: true });
    const nodes = ensureQuotaStylesAndNodes();
    if (remotePopoverOpen && nodes?.remotePopover) {
      renderRemotePopoverContent(nodes.remotePopover);
      positionRemotePopover();
    }
    scheduleTunnelStartingPoll();
    return remotePairState;
  }

  function onRemoteStateChanged(ev) {
    if (disposed) return;
    const data = ev?.detail?.data;
    if (data && typeof data === 'object') {
      syncRemotePairData(data);
    }
  }

  // ==================== macOS Dock 未读与待审批状态采集 ====================

  const DOCK_IDLE_STABLE_MS = 1200;
  const DOCK_HEARTBEAT_MS = 5000;
  const dockStateTracker = {
    windowId: 'win-' + Math.random().toString(36).slice(2, 10),
    lastTrackedCid: '',
    armed: false,
    armedCid: '',
    idleSince: null,
    activeUnreadCount: 0,
    activeUnreadCid: '',
    bgBusyIds: new Set(),
    bgCompletedUnreadIds: new Set(),
    domUnreadIds: new Set(),
    unreadIds: [],
    unreadCount: 0,
    approvalCount: 0,
    highRisk: false,
    running: false,
    lastFocused: true,
    lastSentSig: '',
    lastSentAt: 0
  };

  function recomputeDockUnreadSummary() {
    const unionUnread = new Set([
      ...dockStateTracker.domUnreadIds,
      ...dockStateTracker.bgCompletedUnreadIds
    ]);
    if (dockStateTracker.activeUnreadCid) {
      unionUnread.add(dockStateTracker.activeUnreadCid);
    }
    dockStateTracker.unreadIds = Array.from(unionUnread).slice(0, 200);
    dockStateTracker.unreadCount = unionUnread.size;
    dockStateTracker.activeUnreadCount = dockStateTracker.activeUnreadCid ? 1 : 0;
  }

  function isWindowActiveFocused() {
    try {
      if (typeof document === 'undefined') return true;
      const notHidden = !document.hidden;
      if (typeof document.hasFocus === 'function') {
        return Boolean(document.hasFocus()) && notHidden;
      }
      return notHidden;
    } catch {
      return true;
    }
  }

  function resolveApprovalCardScope(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.cardScope) return item.cardScope;
    if (item.cardKey) return item.cardKey;
    if (item.cardId) return item.cardId;
    const btn = item.btn;
    if (!btn || typeof btn !== 'object') return null;
    if (typeof btn.closest === 'function') {
      const hit = btn.closest('[role="dialog"], [role="alertdialog"], [data-testid="tool-group-collapsible"], [data-testid="turn-cards-container"], [data-testid="agent-response"]');
      if (hit) return hit;
    }
    const p1 = btn.parentElement || null;
    if (p1 && p1 !== document.body && p1 !== document.documentElement && p1.tagName !== 'MAIN') {
      return p1;
    }
    return null;
  }

  function countDistinctPendingApprovals(approvals, prompts) {
    const approvalList = Array.isArray(approvals) ? approvals.filter(Boolean) : [];
    const promptList = Array.isArray(prompts) ? prompts.filter(Boolean) : [];

    const grouped = new Map();
    const ungrouped = [];
    for (const item of approvalList) {
      const scope = resolveApprovalCardScope(item);
      if (scope) {
        let bucket = grouped.get(scope);
        if (!bucket) {
          bucket = [];
          grouped.set(scope, bucket);
        }
        bucket.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    // 同一确认卡片上的「Allow + Reject」等多按钮只计 1 个待审批；无卡片归属时优先统计 approve，只有 reject 时保底计 1
    let buttonApprovalCount = grouped.size;
    if (ungrouped.length > 0) {
      const approveCount = ungrouped.filter((item) => item?.kind === 'approve').length;
      buttonApprovalCount += approveCount > 0 ? approveCount : 1;
    }

    const promptCount = promptList.length;
    const highRisk = approvalList.some((a) => Boolean(a?.highRisk))
      || promptList.some((p) => Boolean(p?.highRisk));

    return {
      approvalCount: buttonApprovalCount + promptCount,
      highRisk
    };
  }

  function reportDockOffline() {
    dockStateTracker.lastSentSig = 'offline';
    void postToLiveHost('/dock-state', {
      windowId: dockStateTracker.windowId,
      offline: true
    });
  }

  function reportDockStateIfNeeded(force = false, now = Date.now()) {
    if (disposed || !dockBadgeEnabled) return false;
    const curNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const unreadIds = Array.isArray(dockStateTracker.unreadIds)
      ? dockStateTracker.unreadIds.slice(0, 200)
      : [];
    const payload = {
      windowId: dockStateTracker.windowId,
      unreadCount: dockStateTracker.unreadCount,
      unreadIds,
      approvalCount: dockStateTracker.approvalCount,
      highRisk: dockStateTracker.highRisk,
      running: dockStateTracker.running,
      locale: uiLang === 'en' ? 'en' : (uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN')
    };
    const sig = `${payload.unreadCount}|${unreadIds.join(',')}|${payload.approvalCount}|${payload.highRisk ? 1 : 0}|${payload.running ? 1 : 0}|${payload.locale}`;
    const changed = sig !== dockStateTracker.lastSentSig;
    const heartbeatDue = (curNow - dockStateTracker.lastSentAt) >= DOCK_HEARTBEAT_MS;
    if (!force && !changed && !heartbeatDue) return false;
    dockStateTracker.lastSentSig = sig;
    dockStateTracker.lastSentAt = curNow;
    void postToLiveHost('/dock-state', payload);
    return true;
  }

  function updateDockUnreadTracker(now = Date.now(), opts = null) {
    if (mobileBgSwitchDepth > 0 && !opts?.forceDuringBgSwitch) {
      return dockStateTracker;
    }
    const curNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const activeCid = (opts && typeof opts.activeCid === 'string')
      ? opts.activeCid
      : (getSessionIdFromLocation() || '');
    const activeBusy = (opts && typeof opts.activeBusy === 'boolean')
      ? opts.activeBusy
      : Boolean(detectAssistantBusySignal());
    const focused = (opts && typeof opts.focused === 'boolean')
      ? opts.focused
      : isWindowActiveFocused();

    const wasFocused = dockStateTracker.lastFocused;
    dockStateTracker.lastFocused = focused;

    // 切会话时清空旧会话的忙闲武装，避免跨对话串扰
    if (activeCid !== dockStateTracker.lastTrackedCid) {
      dockStateTracker.lastTrackedCid = activeCid;
      dockStateTracker.armed = false;
      dockStateTracker.armedCid = '';
      dockStateTracker.idleSince = null;
      if (focused && activeCid) {
        dockStateTracker.domUnreadIds.delete(activeCid);
        dockStateTracker.bgCompletedUnreadIds.delete(activeCid);
        if (dockBadgeAutoClear !== false && dockStateTracker.activeUnreadCid === activeCid) {
          dockStateTracker.activeUnreadCid = '';
        }
      }
    }

    // 当前活跃对话由忙转闲，稳定满 1200ms 后计入未读（仅在窗口失焦/隐藏时）
    if (activeBusy) {
      dockStateTracker.armed = true;
      dockStateTracker.armedCid = activeCid;
      dockStateTracker.idleSince = null;
    } else if (dockStateTracker.armed && dockStateTracker.armedCid === activeCid) {
      if (dockStateTracker.idleSince === null) {
        dockStateTracker.idleSince = curNow;
      } else if (curNow - dockStateTracker.idleSince >= DOCK_IDLE_STABLE_MS) {
        dockStateTracker.armed = false;
        dockStateTracker.armedCid = '';
        dockStateTracker.idleSince = null;
        if (!focused) {
          dockStateTracker.activeUnreadCid = activeCid || '__active__';
        }
      }
    }

    // 侧边栏后台并发对话与原生蓝点未读：仅当存在侧边栏 DOM 行（或测试显式注入）时对比更新，防止侧栏折叠误清零
    const sidebarConvs = (opts && Array.isArray(opts.sidebarConversations))
      ? opts.sidebarConversations
      : (getOrderedSidebarConversationRows().length > 0 ? collectSidebarConversations(60) : null);

    if (Array.isArray(sidebarConvs)) {
      const nextBgBusyIds = new Set();
      const nextDomUnreadIds = new Set();
      for (const conv of sidebarConvs) {
        const cid = String(conv?.id || '').trim();
        if (!cid) continue;
        const isFocusedActive = Boolean(focused && activeCid && cid === activeCid);
        if (!isFocusedActive && conv.domUnread === true) {
          nextDomUnreadIds.add(cid);
        }
        if (activeCid && cid === activeCid) {
          if (focused || conv.domUnread === false) {
            dockStateTracker.bgCompletedUnreadIds.delete(cid);
          }
          continue;
        }
        if (conv.domBusy) {
          nextBgBusyIds.add(cid);
          dockStateTracker.bgCompletedUnreadIds.delete(cid);
        } else {
          if (conv.domUnread === false) {
            dockStateTracker.bgCompletedUnreadIds.delete(cid);
          }
          if (dockStateTracker.bgBusyIds.has(cid)) {
            dockStateTracker.bgCompletedUnreadIds.add(cid);
          }
        }
      }
      dockStateTracker.bgBusyIds = nextBgBusyIds;
      dockStateTracker.domUnreadIds = nextDomUnreadIds;
    }

    // 从后台切回聚焦时自动清除普通未读，保留待审批与高危告警以及其余后台未读
    if (focused && !wasFocused && dockBadgeAutoClear !== false) {
      dockStateTracker.activeUnreadCid = '';
      if (activeCid) {
        dockStateTracker.domUnreadIds.delete(activeCid);
        dockStateTracker.bgCompletedUnreadIds.delete(activeCid);
      }
    }

    const approvals = (opts && Array.isArray(opts.approvals))
      ? opts.approvals
      : findApprovalCandidateButtons();
    const prompts = (opts && Array.isArray(opts.prompts))
      ? opts.prompts
      : findInteractivePromptCards();
    const approvalSummary = countDistinctPendingApprovals(approvals, prompts);

    dockStateTracker.approvalCount = approvalSummary.approvalCount;
    dockStateTracker.highRisk = approvalSummary.highRisk;
    recomputeDockUnreadSummary();
    dockStateTracker.running = Boolean(activeBusy || dockStateTracker.bgBusyIds.size > 0);
    return dockStateTracker;
  }

  function handleDockWindowFocusChange(forceClear = false) {
    if (disposed) return false;
    const focused = isWindowActiveFocused();
    dockStateTracker.lastFocused = Boolean(focused || forceClear);
    if (!(focused || forceClear) || dockBadgeAutoClear === false) {
      return false;
    }
    const curCid = getSessionIdFromLocation() || dockStateTracker.lastTrackedCid || '';
    let changed = false;
    if (dockStateTracker.activeUnreadCid) {
      dockStateTracker.activeUnreadCid = '';
      changed = true;
    }
    if (curCid && dockStateTracker.domUnreadIds.delete(curCid)) {
      changed = true;
    }
    if (curCid && dockStateTracker.bgCompletedUnreadIds.delete(curCid)) {
      changed = true;
    }
    if (changed) {
      recomputeDockUnreadSummary();
      reportDockStateIfNeeded(true);
    }
    return changed;
  }

  function onWindowFocusForDock() {
    if (disposed) return;
    const notHidden = (typeof document === 'undefined') ? true : !document.hidden;
    handleDockWindowFocusChange(notHidden);
  }

  function onVisibilityChangeForDock() {
    if (disposed) return;
    handleDockWindowFocusChange(false);
  }

  function onWindowBeforeUnloadForDock() {
    if (disposed) return;
    reportDockOffline();
  }

  function getDockStateSnapshot() {
    return {
      windowId: dockStateTracker.windowId,
      enabled: dockBadgeEnabled,
      autoClear: dockBadgeAutoClear,
      unreadCount: dockStateTracker.unreadCount,
      activeUnreadCount: dockStateTracker.activeUnreadCount,
      domUnreadIds: Array.from(dockStateTracker.domUnreadIds),
      bgCompletedUnreadIds: Array.from(dockStateTracker.bgCompletedUnreadIds),
      unreadIds: [...dockStateTracker.unreadIds],
      bgBusyIds: Array.from(dockStateTracker.bgBusyIds),
      approvalCount: dockStateTracker.approvalCount,
      highRisk: dockStateTracker.highRisk,
      running: dockStateTracker.running,
      locale: uiLang === 'en' ? 'en' : (uiLang === 'zh-TW' ? 'zh-TW' : 'zh-CN'),
      activeCid: dockStateTracker.lastTrackedCid,
      armed: dockStateTracker.armed,
      armedCid: dockStateTracker.armedCid,
      idleSince: dockStateTracker.idleSince ?? 0,
      focused: dockStateTracker.lastFocused,
      lastSentSig: dockStateTracker.lastSentSig,
      lastSentAt: dockStateTracker.lastSentAt
    };
  }

  function tickDockStateForTest(opts = {}) {
    if (disposed) return getDockStateSnapshot();
    const options = (opts && typeof opts === 'object') ? opts : {};
    if (typeof options.enabled === 'boolean') dockBadgeEnabled = options.enabled;
    if (typeof options.dockBadgeEnabled === 'boolean') dockBadgeEnabled = options.dockBadgeEnabled;
    if (typeof options.autoClear === 'boolean') dockBadgeAutoClear = options.autoClear;
    if (typeof options.dockBadgeAutoClear === 'boolean') dockBadgeAutoClear = options.dockBadgeAutoClear;
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    if (dockBadgeEnabled) {
      updateDockUnreadTracker(now, options);
      if (options.triggerFocus) {
        handleDockWindowFocusChange(true);
      } else {
        reportDockStateIfNeeded(Boolean(options.forceReport), now);
      }
    }
    return getDockStateSnapshot();
  }

  function onSuitePrefsChanged(ev) {
    const prevLang = uiLang;
    const prevDockEnabled = dockBadgeEnabled;
    const prevDockAutoClear = dockBadgeAutoClear;
    syncSuitePrefsFromStorage(ev?.detail || null);
    if (!autoCompactEnabled) autoCompactState.idleSince = 0;
    if (!dockBadgeEnabled) {
      if (prevDockEnabled || dockStateTracker.lastSentSig !== 'offline') {
        reportDockOffline();
      }
    } else if (!prevDockEnabled) {
      dockStateTracker.lastSentSig = '';
      dockStateTracker.lastSentAt = 0;
      updateDockUnreadTracker(Date.now());
      reportDockStateIfNeeded(true);
    } else if (!prevDockAutoClear && dockBadgeAutoClear && isWindowActiveFocused()) {
      handleDockWindowFocusChange(false);
    } else if (prevLang !== uiLang) {
      reportDockStateIfNeeded(false);
    }
    applyEnhancerFeatureVisibility();
    if (!ghostSuggestEnabled) hideNextStepGhost();
    else ensureNextStepGhost();
    if (featureFlags.showQuickActions !== false) {
      ensureQuickCapsuleBar();
      const quickBar = document.getElementById(QUICK_BAR_ID);
      if (quickBar) syncQuickBarActionButtons(quickBar);
    }
    updateQuickBarLanguage();
    if (featureFlags.showChatNav !== false) ensureChatNavFloat();
    updateChatNavLanguage();
    syncPromptOptimizerUI();
    scanHighRiskCommands();
    renderFileEditorControls(getFileViewerContext());
    const { host } = getMeterHostAndShadow();
    const panelTheme = resolveHostTheme(host);
    document.getElementById(QUICK_BAR_TOOLTIP_ID)?.setAttribute('data-ag-theme', panelTheme);
    document.getElementById(NEXT_STEP_TOOLTIP_ID)?.setAttribute('data-ag-theme', panelTheme);
    updateAutoAcceptBtn();
    updateRemoteBtnLanguage();
    renderQuotaUI();
    if (uiLang === 'en') {
      revertEnhancerTranslations();
    } else if (prevLang !== uiLang) {
      if (prevLang !== 'en') {
        thoughtZhCache.clear();
        sidebarZhCache.clear();
        revertEnhancerTranslations();
      }
      localizeThinkingShells();
      scheduleLocalization();
    }
  }

  window.addEventListener('ag-suite-prefs-changed', onSuitePrefsChanged);
  window.addEventListener('ag-remote-state-changed', onRemoteStateChanged);
  window.addEventListener('click', onWindowClickCapture, true);
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onDocKeydown, true);
  document.addEventListener('keyup', onDocKeyup, true);
  document.addEventListener('input', onDocInput, true);
  document.addEventListener('compositionstart', onDocCompositionStart, true);
  document.addEventListener('compositionend', onDocCompositionEnd, true);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('focus', onWindowFocusForDock);
  document.addEventListener('visibilitychange', onVisibilityChangeForDock);
  window.addEventListener('beforeunload', onWindowBeforeUnloadForDock);

  let lastQuotaFetchAt = 0;
  function tickEnhancer() {
    if (disposed) return;
    applyEnhancerFeatureVisibility();
    ensurePromptOptimizerControls();
    ensureNextStepGhost();
    ensureFileViewerEditor();
    scanHighRiskCommands();
    if (dockBadgeEnabled) {
      updateDockUnreadTracker(Date.now());
      reportDockStateIfNeeded(false);
    }
    renderQuotaUI();
    guardExpandedThinkingBlocks();
    localizeThinkingShells();
    scheduleLocalization();
    syncSidebarShortcutBadges();
    runAutoAcceptTick();
    runAutoCompactTick();
    if (featureFlags.showTopbarQuota !== false && Date.now() - lastQuotaFetchAt >= 30000) {
      lastQuotaFetchAt = Date.now();
      void refreshQuota({ silent: true });
    }
    if (featureFlags.showTopbarRemote !== false && !remotePopoverOpen && Date.now() - lastRemoteFetchAt >= 10000) {
      lastRemoteFetchAt = Date.now();
      void refreshRemotePairInfo(false);
    }
  }

  const enhancerTimer = setInterval(tickEnhancer, 1000);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(enhancerTimer);
    clearRemotePollTimer();
    reportDockOffline();
    if (toastTimer) clearTimeout(toastTimer);
    if (quickAutoSendLockTimer) {
      clearTimeout(quickAutoSendLockTimer);
      quickAutoSendLockTimer = null;
    }
    quickAutoSendInFlight = false;
    quickAutoSendLockUntil = 0;
    if (promptOptState.abortCtrl) {
      try { promptOptState.abortCtrl.abort(); } catch {}
      promptOptState.abortCtrl = null;
    }
    promptOptState.loading = false;
    if (remotePairState.tunnelPollTimer) {
      clearTimeout(remotePairState.tunnelPollTimer);
      remotePairState.tunnelPollTimer = null;
    }
    if (localizeTimer) {
      clearTimeout(localizeTimer);
      localizeTimer = null;
    }
    if (localizeMutationObserver) {
      localizeMutationObserver.disconnect();
      localizeMutationObserver = null;
    }
    document.removeEventListener('click', onDocClick, true);
    window.removeEventListener('ag-suite-prefs-changed', onSuitePrefsChanged);
    window.removeEventListener('ag-remote-state-changed', onRemoteStateChanged);
    window.removeEventListener('click', onWindowClickCapture, true);
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('keyup', onDocKeyup, true);
    document.removeEventListener('input', onDocInput, true);
    document.removeEventListener('compositionstart', onDocCompositionStart, true);
    document.removeEventListener('compositionend', onDocCompositionEnd, true);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('focus', onWindowFocusForDock);
    document.removeEventListener('visibilitychange', onVisibilityChangeForDock);
    window.removeEventListener('beforeunload', onWindowBeforeUnloadForDock);
    syncCmdModifierState(false);
    hideNextStepGhost();
    hideQuickBarTooltip();
    safeRemove(document.getElementById(NEXT_STEP_TOOLTIP_ID));
    safeRemove(document.getElementById(QUICK_BAR_TOOLTIP_ID));
    safeRemove(document.getElementById(NEXT_STEP_GHOST_ID));
    safeRemove(document.getElementById(PROMPT_OPT_WRAP_ID));
    if (fileEditorState.active) exitFileEditor(false);
    safeRemove(document.getElementById(FILE_EDITOR_CONTROLS_ID));
    safeRemove(document.getElementById(FILE_EDITOR_WRAP_ID));
    restoreHiddenViewerChildren();
    try { (globalThis.__AGContextMeter || window.__AGContextMeter)?.setHostElevated?.(false); } catch {}
    const { sr } = getMeterHostAndShadow();
    if (sr) {
      safeRemove(sr.getElementById(REMOTE_BADGE_ID));
      safeRemove(sr.getElementById(REMOTE_POPOVER_ID));
      safeRemove(sr.getElementById(QUOTA_BADGE_ID));
      safeRemove(sr.getElementById(QUOTA_POPOVER_ID));
      safeRemove(sr.getElementById(QUOTA_STYLE_ID));
    }
    safeRemove(document.getElementById(QUICK_BAR_ID));
    safeRemove(document.getElementById(CHAT_NAV_ID));
    document.querySelectorAll('.ag-risk-banner').forEach(safeRemove);
    document.querySelectorAll('[data-ag-risk-card]').forEach((el) => el.removeAttribute('data-ag-risk-card'));
    document.querySelectorAll('[data-ag-shortcut]').forEach((el) => el.removeAttribute('data-ag-shortcut'));
    safeRemove(document.getElementById(DOC_STYLE_ID));
    autoCompactState.inFlightMap.clear();
    autoCompactState.lastFiredMap.clear();
  }

  // ==================== 手机端极速遥控面板数据桥接 (v1.6.9) ====================

  const MOBILE_APPROVE_RE = /^(?:proceed|accept(?:\s+all|\s+changes|\s+step)?|allow(?:\s+once|\s+always|\s+all|\s+for\s+(?:this\s+)?session)?|run(?:\s+command)?|approve|confirm|submit|continue|继续|接受|全部接受|接受更改|接受此步骤|允许|允许一次|允许本次|始终允许|本会话允许|运行|批准|确认|提交)(?:\s+\([^)]+\))?$/i;
  const MOBILE_REJECT_RE = /^(?:reject|deny|cancel|discard|decline|abort|skip|拒绝|取消|丢弃|中止|跳过)(?:\s+\([^)]+\))?$/i;

  function findApprovalCandidateButtons() {
    const container = document.querySelector('main') || document.body;
    if (!container) return [];
    const results = [];
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.closest(`#${QUICK_BAR_ID}, #${CHAT_NAV_ID}, #${METER_HOST_ID}, .surface-composer, [data-agy-hans-ui], [data-agy-context-capsule], [data-testid="thinking-collapsible-trigger"], [data-testid="conversation-row-sidebar"]`)) {
        continue;
      }
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      if (btn.offsetWidth <= 0 || btn.offsetHeight <= 0) continue;
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || label.length > 32) continue;

      let kind = '';
      if (MOBILE_REJECT_RE.test(label)) {
        kind = 'reject';
      } else if (MOBILE_APPROVE_RE.test(label)) {
        kind = 'approve';
      }
      if (!kind) continue;

      const cardScope = btn.closest('[data-testid="turn-cards-container"], [data-testid="agent-response"], [role="dialog"], [data-testid="tool-group-collapsible"]') || btn.parentElement?.parentElement;
      const riskEl = cardScope ? ((typeof cardScope.matches === 'function' && cardScope.matches('[data-ag-risk-card="high"]')) ? cardScope : cardScope.querySelector?.('[data-ag-risk-card="high"]')) : null;
      const riskBanner = cardScope?.querySelector('.ag-risk-banner');
      const highRisk = Boolean(riskEl || riskBanner);
      const riskText = (riskBanner?.textContent || '').trim();

      let contextText = '';
      if (cardScope) {
        const codeNode = cardScope.querySelector('pre, code');
        const rawCtx = (codeNode?.textContent || cardScope.innerText || '').replace(/\s+/g, ' ').trim();
        contextText = rawCtx.slice(0, 240);
      }

      results.push({ btn, label, kind, highRisk, riskText, contextText });
    }
    return results;
  }

  function collectPendingApprovals() {
    return findApprovalCandidateButtons().map((item, index) => ({
      index,
      label: item.label,
      kind: item.kind,
      highRisk: item.highRisk,
      riskText: item.riskText,
      contextText: item.contextText
    }));
  }

  function isExcludedSuiteOrNavNode(el) {
    if (!el || typeof el.closest !== 'function') return true;
    return Boolean(el.closest(
      `#${QUICK_BAR_ID}, #${CHAT_NAV_ID}, #${METER_HOST_ID}, .surface-composer, [data-agy-hans-ui], [data-agy-context-capsule], [data-testid="conversation-row-sidebar"], [data-testid="settings-sidebar"], .settings-modal-backdrop`
    ));
  }

  function isVisiblePromptControl(el) {
    if (!el) return false;
    if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof el.offsetWidth === 'number' && typeof el.offsetHeight === 'number') {
      if (el.offsetWidth <= 0 && el.offsetHeight <= 0) {
        const isNativeInput = el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox');
        if (!isNativeInput) return false;
      }
    }
    return true;
  }

  function readPromptOptionLabel(ctrl, root) {
    if (!ctrl) return '';
    const aria = String(ctrl.getAttribute?.('aria-label') || '').trim();
    if (aria) return aria;
    const tag = String(ctrl.tagName || '').toUpperCase();
    if (tag === 'INPUT') {
      const wrapLabel = typeof ctrl.closest === 'function' ? ctrl.closest('label') : null;
      if (wrapLabel) {
        const txt = String(wrapLabel.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      }
      const id = ctrl.getAttribute?.('id');
      if (id && root && typeof root.querySelectorAll === 'function') {
        const labels = Array.from(root.querySelectorAll('label[for]'));
        const lbl = labels.find((candidate) => candidate.getAttribute?.('for') === id) || null;
        const txt = String(lbl?.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      }
      const sibTxt = String(ctrl.parentElement?.textContent || '').replace(/\s+/g, ' ').trim();
      if (sibTxt) return sibTxt;
    }
    return String(ctrl.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isPromptControlSelected(ctrl) {
    if (!ctrl) return false;
    if (typeof ctrl.checked === 'boolean' && String(ctrl.tagName || '').toUpperCase() === 'INPUT') {
      return ctrl.checked;
    }
    const ariaChecked = ctrl.getAttribute?.('aria-checked');
    if (ariaChecked === 'true') return true;
    const ariaSelected = ctrl.getAttribute?.('aria-selected');
    if (ariaSelected === 'true') return true;
    return ctrl.getAttribute?.('data-state') === 'checked' || ctrl.getAttribute?.('data-selected') === 'true';
  }

  const PERSISTENT_ALLOW_LABEL_RE = /^(?:allow\s+(?:always|all|for\s+(?:this\s+)?session)|accept\s+all|始终允许|本会话允许|全部接受)(?:\s|$|\()/i;

  function findInteractivePromptCards() {
    const roots = [];
    const seenRoots = new Set();
    const pushRoot = (el) => {
      if (!el || seenRoots.has(el) || isExcludedSuiteOrNavNode(el)) return;
      seenRoots.add(el);
      roots.push(el);
    };

    // 1. 先扫描系统确认弹窗 ([role="dialog"], [role="alertdialog"])
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    for (const dlg of dialogs) {
      if (!isVisiblePromptControl(dlg)) continue;
      pushRoot(dlg);
    }

    // 2. 再扫描主对话区内的交互式选择卡片（优先命中外层弹窗/提问卡/表单，避免被内层 radiogroup 截断）
    const main = document.querySelector('main') || document.body;
    if (main) {
      const choiceControls = main.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="radiogroup"]');
      for (const ctrl of choiceControls) {
        if (isExcludedSuiteOrNavNode(ctrl)) continue;
        if (ctrl.disabled || ctrl.getAttribute?.('aria-disabled') === 'true') continue;
        const card = ctrl.closest?.('[role="dialog"], [role="alertdialog"], [data-testid="ask-question-card"], [data-testid="user-question-card"], form')
          || ctrl.closest?.('[data-testid="turn-cards-container"], [data-testid="agent-response"], [role="radiogroup"]')
          || ctrl.parentElement?.parentElement;
        if (card) pushRoot(card);
      }
      // 2b. 扫描官方编号确认选择卡片（如 "Allow write access to this path?"：含 1..N 编号选项行 + Submit/Skip 等按钮）
      const submitBtns = main.querySelectorAll('button');
      for (const btn of submitBtns) {
        if (isExcludedSuiteOrNavNode(btn) || !isVisiblePromptControl(btn)) continue;
        const btnLabel = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (!btnLabel || btnLabel.length > 28 || !/^(?:submit|confirm|allow|approve|skip|提交|确认|允许|跳过)(?:\s*[↵↩])?$/i.test(btnLabel)) continue;
        let cur = btn.parentElement;
        for (let depth = 0; cur && cur !== main && cur !== document.body && depth < 6; depth++, cur = cur.parentElement) {
          if (isExcludedSuiteOrNavNode(cur)) break;
          const numberedRows = Array.from(cur.querySelectorAll('button, [role="option"], [role="menuitem"], [tabindex]')).filter((el) => {
            if (el === btn || isExcludedSuiteOrNavNode(el) || !isVisiblePromptControl(el)) return false;
            const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
            return /^[1-9]\s+\S/.test(txt) && txt.length <= 160;
          });
          if (numberedRows.length >= 2) {
            pushRoot(cur);
            break;
          }
        }
      }
    }

    // 去除被其他候选根容器包含的内层重复容器
    const topRoots = roots.filter((r) => !roots.some((other) => other !== r && typeof other.contains === 'function' && other.contains(r)));

    const cards = [];
    for (const root of topRoots) {
      if (isExcludedSuiteOrNavNode(root) || !isVisiblePromptControl(root)) continue;
      const rawControls = Array.from(root.querySelectorAll(
        'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]'
      )).filter((c) => !isExcludedSuiteOrNavNode(c) && !c.disabled && c.getAttribute?.('aria-disabled') !== 'true');

      const options = [];
      const seenOptLabels = new Set();
      const optionElSet = new Set();
      let hasCheckbox = false;
      for (const ctrl of rawControls) {
        const label = readPromptOptionLabel(ctrl, root).slice(0, 160);
        if (!label || seenOptLabels.has(label)) continue;
        seenOptLabels.add(label);
        const isChk = (String(ctrl.tagName || '').toUpperCase() === 'INPUT' && ctrl.type === 'checkbox')
          || ctrl.getAttribute?.('role') === 'checkbox';
        if (isChk) hasCheckbox = true;
        optionElSet.add(ctrl);
        options.push({
          index: options.length,
          el: ctrl,
          label,
          selected: isPromptControlSelected(ctrl),
          kind: isChk ? 'checkbox' : 'radio'
        });
      }

      // 若未找到标准 radio/checkbox，回退提取编号选项行（1 Yes... / 2 Yes... / 3 ...）
      if (options.length < 2) {
        const numberedCandidates = Array.from(root.querySelectorAll('button, [role="option"], [role="menuitem"], [tabindex]')).filter((el) => {
          if (isExcludedSuiteOrNavNode(el) || !isVisiblePromptControl(el)) return false;
          if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
          const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
          return /^[1-9]\s+\S/.test(txt) && txt.length <= 160;
        });
        if (numberedCandidates.length >= 2) {
          for (const el of numberedCandidates) {
            const label = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (!label || seenOptLabels.has(label)) continue;
            seenOptLabels.add(label);
            optionElSet.add(el);
            const selected = isPromptControlSelected(el)
              || el.getAttribute?.('aria-selected') === 'true'
              || el.getAttribute?.('data-selected') === 'true'
              || el.getAttribute?.('data-active') === 'true';
            options.push({
              index: options.length,
              el,
              label,
              selected,
              kind: 'radio'
            });
          }
        }
      }

      const rawButtons = Array.from(root.querySelectorAll('button')).filter((b) => {
        if (optionElSet.has(b) || isExcludedSuiteOrNavNode(b)) return false;
        if (!isVisiblePromptControl(b)) return false;
        const isBtnDisabled = Boolean(b.disabled || b.getAttribute?.('aria-disabled') === 'true');
        // 若卡片内有可用选项（如待勾选后才启用的 Submit 按钮），保留初始禁用的提交/确认按钮；纯弹窗无选项时仍过滤禁用按钮
        if (isBtnDisabled && options.length < 2) return false;
        const r = b.getAttribute?.('role');
        if (r === 'radio' || r === 'checkbox') return false;
        const lbl = String(b.textContent || '').replace(/\s+/g, ' ').trim();
        return Boolean(lbl && lbl.length <= 48);
      });

      const actions = [];
      const seenBtnLabels = new Set();
      for (const btn of rawButtons) {
        const label = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (!label || seenBtnLabels.has(label)) continue;
        seenBtnLabels.add(label);
        let kind = 'secondary';
        if (MOBILE_REJECT_RE.test(label)) kind = 'reject';
        else if (MOBILE_APPROVE_RE.test(label) || btn.getAttribute?.('type') === 'submit') kind = 'primary';
        const btnDisabled = Boolean(btn.disabled || btn.getAttribute?.('aria-disabled') === 'true');
        const isPersistentAllow = kind === 'primary' && PERSISTENT_ALLOW_LABEL_RE.test(label);
        actions.push({ index: actions.length, el: btn, label, kind, disabled: btnDisabled, isPersistentAllow });
      }

      const isDialog = root.getAttribute?.('role') === 'dialog' || root.getAttribute?.('role') === 'alertdialog';
      const isDedicatedPromptContainer = Boolean(
        root.getAttribute?.('role') === 'radiogroup'
        || String(root.tagName || '').toUpperCase() === 'FORM'
        || root.getAttribute?.('data-testid') === 'ask-question-card'
        || root.getAttribute?.('data-testid') === 'user-question-card'
      );
      const hasConfirmAction = actions.some((a) => a.kind === 'primary' || a.kind === 'reject');
      // 严禁把普通消息内无操作按钮的 Markdown 任务清单/复选框误判为待确认选择框：
      // 1) 系统弹窗：需至少有可见操作按钮；
      // 2) 对话区内选择卡：至少 2 个启用选项，且（具备明确确认/取消按钮，或属于专用提问/单选容器且含可用操作/单选控件）
      if (isDialog) {
        if (actions.length === 0 && options.length < 2) continue;
      } else {
        if (options.length < 2) continue;
        if (!hasConfirmAction && !(isDedicatedPromptContainer && !hasCheckbox)) continue;
      }

      const otherInput = Array.from(root.querySelectorAll('input[type="text"], input:not([type]), textarea')).find((inp) => {
        if (isExcludedSuiteOrNavNode(inp)) return false;
        if (inp.disabled || inp.readOnly) return false;
        const t = String(inp.type || 'text').toLowerCase();
        return t === 'text' || t === 'search' || String(inp.tagName || '').toUpperCase() === 'TEXTAREA';
      }) || null;

      const headingEl = root.querySelector('h1, h2, h3, h4, legend, [role="heading"], [data-testid="question-title"]');
      const title = String(headingEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
        || (isDialog ? '系统确认' : '请选择确认项');

      const descParts = [];
      const seenDesc = new Set([title]);
      const descNodes = Array.from(root.querySelectorAll('p, pre, code, [data-testid="question-description"]'));
      for (const dNode of descNodes) {
        if (dNode.closest?.('button, label, [role="option"], [role="menuitem"], .ag-risk-banner')) continue;
        if (dNode.tagName === 'CODE' && dNode.closest?.('pre')) continue;
        const txt = String(dNode.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || seenDesc.has(txt)) continue;
        seenDesc.add(txt);
        descParts.push(txt);
      }
      const description = descParts.join('\n').slice(0, 480);

      const codeTexts = Array.from(root.querySelectorAll('pre, code')).map((c) => String(c.textContent || '').trim()).filter(Boolean);
      const riskScanText = [title, description, ...codeTexts].filter(Boolean).join('\n');
      const riskHits = detectHighRiskLabels(riskScanText);
      const domRiskBanner = root.querySelector?.('.ag-risk-banner') || root.closest?.('[data-testid="turn-cards-container"]')?.querySelector?.('.ag-risk-banner');
      const hasDomRiskCard = Boolean(
        root.getAttribute?.('data-ag-risk-card') === 'high'
        || root.closest?.('[data-ag-risk-card="high"]')
        || root.querySelector?.('[data-ag-risk-card="high"], .ag-risk-banner')
      );
      const highRisk = Boolean(hasDomRiskCard || riskHits.length > 0);
      const riskText = String(domRiskBanner?.textContent || '').trim()
        || (riskHits.length ? `🛡️ 高危命令预警：检测到 ${riskHits.slice(0, 3).join('、')}，请人工核对` : (hasDomRiskCard ? '🛡️ 高危操作确认，请人工核对' : ''));

      const kind = options.length >= 2 ? 'choice' : 'dialog';
      const promptKey = `p${cards.length}|${kind}|${title}|${description}|${options.map((o) => o.label).join('\u001f')}|${actions.map((a) => a.label).join('\u001f')}`;

      cards.push({
        index: cards.length,
        root,
        id: promptKey,
        promptKey,
        kind,
        title,
        description,
        highRisk,
        riskText,
        multiSelect: hasCheckbox,
        options,
        otherInput,
        hasOtherInput: Boolean(otherInput),
        otherPlaceholder: String(otherInput?.getAttribute?.('placeholder') || '').trim().slice(0, 80),
        otherValue: String(otherInput?.value || ''),
        actions
      });
    }
    return cards;
  }

  function collectPendingPrompts() {
    return findInteractivePromptCards().map((card) => ({
      index: card.index,
      id: card.id,
      promptKey: card.promptKey,
      kind: card.kind,
      title: card.title,
      description: card.description,
      highRisk: Boolean(card.highRisk),
      riskText: String(card.riskText || ''),
      multiSelect: card.multiSelect,
      options: card.options.map(({ index, label, selected, kind }) => ({ index, label, selected, kind })),
      hasOtherInput: card.hasOtherInput,
      otherPlaceholder: card.otherPlaceholder,
      otherValue: card.otherValue,
      actions: card.actions.map(({ index, label, kind, isPersistentAllow }) => ({ index, label, kind, isPersistentAllow: Boolean(isPersistentAllow) }))
    }));
  }

  function extractQueueFiberEntries(cardEl) {
    try {
      const fk = Object.keys(cardEl || {}).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? cardEl[fk] : null;
      for (let depth = 0; depth < 8 && f; depth += 1, f = f.return) {
        const p = f.memoizedProps || {};
        const arr = Array.isArray(p.queuedUserInputs)
          ? p.queuedUserInputs
          : (Array.isArray(p.pendingUserInputs) ? p.pendingUserInputs : null);
        if (!arr || !arr.length) continue;
        return arr.map((item, idx) => {
          const msgId = String(item?.msgId || item?.id || item?.messageId || '').trim();
          const step = item?.step || item?.userInput || item || {};
          const stepItems = Array.isArray(step.items) ? step.items : [];
          const text = stepItems.map((it) => String(it?.text || '')).join('').trim()
            || String(step.text || item?.text || '').trim();
          const rawMedia = Array.isArray(step.media)
            ? step.media
            : (Array.isArray(step.images)
              ? step.images
              : (Array.isArray(item?.media) ? item.media : []));
          const attachments = rawMedia.map((m) => {
            const mimeType = String(m?.mimeType || m?.mime_type || 'image/png').trim() || 'image/png';
            const rawInline = String(m?.inlineData || m?.inline_data || m?.base64Data || m?.base64_data || m?.data || '').trim();
            const inlineData = rawInline
              ? (/^data:/i.test(rawInline) ? rawInline : `data:${mimeType};base64,${rawInline}`)
              : '';
            const thumbSrc = String(m?.uri || m?.url || m?.thumbnail || '').trim();
            const previewUrl = (thumbSrc && !thumbSrc.startsWith('data:image/svg')) ? thumbSrc : inlineData;
            const name = String(m?.displayName || m?.name || (/^image\//i.test(mimeType) ? 'image.png' : 'attachment')).trim();
            const isImage = /^image\//i.test(mimeType) || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name) || Boolean(previewUrl);
            return {
              name,
              mimeType,
              size: Number(m?.size || 0),
              isImage,
              previewUrl,
              inlineData
            };
          }).filter((att) => att.previewUrl || att.inlineData || att.name);
          const imgs = attachments
            .filter((att) => att.isImage && att.previewUrl && !att.previewUrl.startsWith('data:image/svg'))
            .map((att) => ({
              src: att.previewUrl,
              alt: att.name || '图片'
            }));
          return { msgId, text, images: imgs, attachments, idx };
        });
      }
    } catch {}
    return [];
  }

  function findQueuedMessagesDomEntries() {
    const main = document.querySelector('main') || document.body;
    if (!main) return [];

    let cardRoot = Array.from(main.querySelectorAll('[data-testid="queued-messages-card"]'))
      .find((el) => !isExcludedSuiteOrNavNode(el) && isVisiblePromptControl(el)) || null;

    if (!cardRoot) {
      const headerNodes = Array.from(main.querySelectorAll('[data-testid*="queue" i], div, span, p, h3, h4')).filter((el) => {
        if (isExcludedSuiteOrNavNode(el) || !isVisiblePromptControl(el)) return false;
        if (el.closest?.('[data-testid="agent-response"], [data-testid="user-message"], [data-markdown-root]')) return false;
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 100) return false;
        return /^(?:Queued Messages\b|排队消息|排队中的消息|佇列訊息|佇列中的訊息)/i.test(txt)
          || /^(?:Sends after agent finishes working|将在代理完成后发送|將在\s*Agent\s*完成後傳送)/i.test(txt);
      });
      if (!headerNodes.length) return [];
      for (const h of headerNodes) {
        let cur = h;
        for (let depth = 0; cur && cur !== main && cur !== document.body && depth < 5; depth++, cur = cur.parentElement) {
          if (isExcludedSuiteOrNavNode(cur)) break;
          const fullTxt = String(cur.textContent || '').replace(/\s+/g, ' ').trim();
          if (fullTxt.length > 12 && fullTxt.length < 4000 && cur.querySelectorAll('button').length >= 1) {
            cardRoot = cur;
            const hasActionBtns = Array.from(cur.querySelectorAll('button')).some((b) => {
              const tid = String(b.getAttribute?.('data-testid') || '');
              if (tid === 'queued-messages-expand-button') return false;
              const meta = `${b.getAttribute?.('aria-label') || ''} ${b.getAttribute?.('title') || ''} ${b.textContent || ''}`;
              return /send|edit|delete|remove|trash|queue|发送|编辑|删除|撤回/i.test(meta);
            });
            if (hasActionBtns) break;
          }
        }
        if (cardRoot) break;
      }
    }
    if (!cardRoot) return [];

    const fiberItems = extractQueueFiberEntries(cardRoot);
    const stripHeaderNoise = (raw) => String(raw || '')
      .replace(/\s+/g, ' ')
      .replace(/^(?:Queued Messages\b|排队消息|排队中的消息|佇列訊息|佇列中的訊息)\s*\d*\s*(?:Sends after agent finishes working|将在代理完成后发送|將在\s*Agent\s*完成後傳送)?/i, '')
      .trim();

    const isExpandBtn = (b) => {
      const tid = String(b?.getAttribute?.('data-testid') || '');
      if (tid === 'queued-messages-expand-button') return true;
      const aria = String(b?.getAttribute?.('aria-label') || '');
      return /^(?:Collapse queued messages|Expand queued messages|收起排队消息|展开排队消息|收合佇列訊息|收起佇列訊息|展開佇列訊息)$/i.test(aria);
    };

    const pickDecoratorBtns = (rowEl) => {
      const decRoot = rowEl.querySelector?.('[data-testid="queued-decorators"]') || rowEl;
      const btns = Array.from(decRoot.querySelectorAll('button')).filter((b) => !isExcludedSuiteOrNavNode(b) && !isExpandBtn(b));
      let sendBtn = btns.find((b) => /send|now|immediate|arrow_forward|立即发送|发送/i.test(`${b.getAttribute?.('aria-label') || ''} ${b.getAttribute?.('title') || ''} ${b.textContent || ''}`)) || null;
      let editBtn = btns.find((b) => /\bedit\b|编辑|修改/i.test(`${b.getAttribute?.('aria-label') || ''} ${b.getAttribute?.('title') || ''} ${b.textContent || ''}`)) || null;
      let deleteBtn = btns.find((b) => /delete|remove|trash|cancel|删除|撤回|移除/i.test(`${b.getAttribute?.('aria-label') || ''} ${b.getAttribute?.('title') || ''} ${b.textContent || ''}`)) || null;
      if (btns.length >= 3 && (!sendBtn || !editBtn || !deleteBtn)) {
        sendBtn = sendBtn || btns[0];
        editBtn = editBtn || btns[1];
        deleteBtn = deleteBtn || btns[2];
      } else if (btns.length === 2) {
        if (!sendBtn && btns[0] !== editBtn && btns[0] !== deleteBtn) sendBtn = btns[0];
        if (!deleteBtn && btns[1] !== sendBtn && btns[1] !== editBtn) deleteBtn = btns[1];
      } else if (btns.length === 1 && !sendBtn && !editBtn && !deleteBtn) {
        deleteBtn = btns[0];
      }
      return { sendBtn, editBtn, deleteBtn };
    };

    const entries = [];
    const seenRowEls = new Set();
    const decoratorNodes = Array.from(cardRoot.querySelectorAll('[data-testid="queued-decorators"]'))
      .filter((d) => !isExcludedSuiteOrNavNode(d));
    let rowCandidates = [];
    if (decoratorNodes.length) {
      rowCandidates = decoratorNodes.map((d) => {
        const p1 = d.parentElement;
        const p2 = p1?.parentElement;
        const dTxt = String(d.textContent || '').trim();
        const p1Txt = String(p1?.textContent || '').trim();
        const p1HasOnlyDec = Boolean(p1 && p1 !== cardRoot && p1Txt === dTxt && !(p1.querySelectorAll('img')?.length));
        if (p1HasOnlyDec && p2 && p2 !== cardRoot) return p2;
        return (p1 && p1 !== cardRoot) ? p1 : d;
      }).filter(Boolean);
    } else {
      rowCandidates = Array.from(cardRoot.querySelectorAll('[data-testid*="queue-item" i], [data-testid*="queued-message" i], li, [role="listitem"]'))
        .filter((el) => !isExcludedSuiteOrNavNode(el) && !isExpandBtn(el));
    }
    const fallbackRows = (rowCandidates.length ? rowCandidates : Array.from(cardRoot.children).slice(1))
      .filter((el) => !isExcludedSuiteOrNavNode(el) && !isExpandBtn(el));

    const inspectRow = (rowEl, rowIdx) => {
      if (!rowEl || seenRowEls.has(rowEl) || isExcludedSuiteOrNavNode(rowEl) || isExpandBtn(rowEl)) return;
      seenRowEls.add(rowEl);
      const cloneTxt = (() => {
        const dec = rowEl.querySelector?.('[data-testid="queued-decorators"]');
        if (!dec || dec === rowEl) return rowEl.textContent || '';
        const raw = String(rowEl.textContent || '');
        const decTxt = String(dec.textContent || '');
        return decTxt && raw.endsWith(decTxt) ? raw.slice(0, raw.length - decTxt.length) : raw;
      })();
      const rawTxt = stripHeaderNoise(cloneTxt);
      const imgs = Array.from(rowEl.querySelectorAll('img')).map((img) => ({
        src: String(img.getAttribute?.('src') || img.src || '').trim(),
        alt: String(img.getAttribute?.('alt') || '').trim()
      })).filter((im) => im.src && !im.src.startsWith('data:image/svg'));
      const fiberRec = fiberItems[entries.length] || fiberItems[rowIdx] || null;
      const finalText = rawTxt || fiberRec?.text || '';
      const finalImgs = imgs.length ? imgs : (fiberRec?.images || []);
      const domAttachments = imgs.map((im, imIdx) => {
        const mimeMatch = im.src.match(/^data:([^;,\s]+);base64,/i);
        return {
          name: im.alt || `image-${imIdx + 1}.png`,
          mimeType: mimeMatch ? mimeMatch[1].toLowerCase() : 'image/png',
          size: 0,
          isImage: true,
          previewUrl: im.src,
          inlineData: mimeMatch ? im.src : ''
        };
      });
      const finalAttachments = (Array.isArray(fiberRec?.attachments) && fiberRec.attachments.length)
        ? fiberRec.attachments
        : domAttachments;
      if (!finalText && !finalImgs.length && !finalAttachments.length) return;
      const { sendBtn, editBtn, deleteBtn } = pickDecoratorBtns(rowEl);
      entries.push({
        domIndex: entries.length,
        stepIndex: -1,
        messageId: fiberRec?.msgId || '',
        source: 'dom',
        text: finalText || ((finalImgs.length || finalAttachments.length) ? `[图片 ×${finalImgs.length || finalAttachments.length}]` : ''),
        images: finalImgs.slice(0, 6),
        attachments: finalAttachments.slice(0, 10),
        hasMedia: Boolean(finalImgs.length || finalAttachments.length),
        status: 'QUEUED',
        hasEdit: Boolean(editBtn),
        sendBtn,
        editBtn,
        deleteBtn
      });
    };

    fallbackRows.forEach((r, idx) => inspectRow(r, idx));
    if (!entries.length && fiberItems.length) {
      fiberItems.forEach((fi, idx) => {
        const atts = Array.isArray(fi.attachments) ? fi.attachments.slice(0, 10) : [];
        const imgs = (fi.images || []).slice(0, 6);
        entries.push({
          domIndex: idx,
          stepIndex: -1,
          messageId: fi.msgId || '',
          source: 'dom',
          text: fi.text || ((imgs.length || atts.length) ? `[图片 ×${imgs.length || atts.length}]` : ''),
          images: imgs,
          attachments: atts,
          hasMedia: Boolean(imgs.length || atts.length),
          status: 'QUEUED',
          hasEdit: false,
          sendBtn: null,
          editBtn: null,
          deleteBtn: null
        });
      });
    } else if (!entries.length) {
      const wholeTxt = stripHeaderNoise(cardRoot.textContent || '');
      if (wholeTxt) inspectRow(cardRoot, 0);
    }
    return entries;
  }

  function findQueuedMessagesExpandButton() {
    const main = document.querySelector('main') || document.body;
    if (!main) return null;
    const cardRoot = Array.from(main.querySelectorAll('[data-testid="queued-messages-card"]'))
      .find((el) => !isExcludedSuiteOrNavNode(el) && isVisiblePromptControl(el)) || main;
    const candidates = Array.from(cardRoot.querySelectorAll('[data-testid="queued-messages-expand-button"], button'))
      .filter((b) => !isExcludedSuiteOrNavNode(b) && isVisiblePromptControl(b));
    return candidates.find((b) => {
      const tid = String(b.getAttribute?.('data-testid') || '');
      const aria = String(b.getAttribute?.('aria-label') || '').trim();
      const expanded = String(b.getAttribute?.('aria-expanded') || '').trim().toLowerCase();
      if (expanded === 'true') return false;
      if (/^(?:Collapse queued messages|收起排队消息|收合佇列訊息|收起佇列訊息)$/i.test(aria)) return false;
      if (tid === 'queued-messages-expand-button') return true;
      return /^(?:Expand queued messages|展开排队消息|展開佇列訊息)$/i.test(aria);
    }) || null;
  }

  async function ensureQueuedMessagesExpanded(initialEntries, requiredBtnKey) {
    const hasNeededBtn = (list) => {
      if (!Array.isArray(list) || !list.length) return false;
      if (requiredBtnKey === 'editOrDelete') {
        return list.some((e) => Boolean(e?.editBtn || e?.deleteBtn));
      }
      return list.some((e) => Boolean(e?.[requiredBtnKey]));
    };
    let entries = Array.isArray(initialEntries) ? initialEntries : findQueuedMessagesDomEntries();
    if (!entries.length || hasNeededBtn(entries)) return entries;
    const expandBtn = findQueuedMessagesExpandButton();
    if (!expandBtn) return entries;
    try {
      expandBtn.click();
    } catch {
      return entries;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((r) => setTimeout(r, 40));
      const refreshed = findQueuedMessagesDomEntries();
      if (hasNeededBtn(refreshed)) return refreshed;
      if (refreshed.length) entries = refreshed;
    }
    return entries;
  }

  function collectQueuedMessagesFromDom() {
    return findQueuedMessagesDomEntries().map(({ domIndex, stepIndex, messageId, source, text, images, hasMedia, status, hasEdit }) => ({
      domIndex,
      stepIndex,
      ...(messageId ? { messageId } : {}),
      source,
      text,
      images,
      ...(hasMedia ? { hasMedia: true } : {}),
      status,
      ...(hasEdit ? { hasEdit: true } : {})
    }));
  }

  function setNativePromptInputValue(inputEl, value) {
    if (!inputEl) return false;
    const strVal = String(value ?? '');
    try {
      const proto = String(inputEl.tagName || '').toUpperCase() === 'TEXTAREA'
        ? window.HTMLTextAreaElement?.prototype
        : window.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (typeof setter === 'function') setter.call(inputEl, strVal);
      else inputEl.value = strVal;
    } catch {
      inputEl.value = strVal;
    }
    try {
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
    return true;
  }

  function cleanUserMessageText(raw) {
    let s = String(raw || '').replace(/\r\n/g, '\n').trim();
    s = s.replace(/^(?:You said|你说)\s*/i, '');
    s = s.replace(/\n+(?:just\s+now|刚刚|\d+\s*(?:second|minute|hour|day|sec|min|hr)s?\s*ago|\d+\s*[smhd]\s*ago|\d+\s*(?:秒|分钟|小时|天)前)\s*$/i, '');
    return s.trim();
  }

  const MD_ALLOWED_TAGS = new Set([
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'DEL',
    'CODE', 'PRE', 'BLOCKQUOTE', 'HR', 'BR',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'
  ]);
  const MD_SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'SVG', 'MATH', 'ANNOTATION']);

  function sanitizeMarkdownNodeToHtml(node, depth = 0, budget = null) {
    if (!node || budget?.exceeded) return '';
    if (budget) {
      budget.nodes += 1;
      if (budget.nodes > budget.maxNodes || budget.chars > budget.maxChars) {
        budget.exceeded = true;
        return '';
      }
    }
    const charge = (n) => {
      if (budget && n > 0) {
        budget.chars += n;
        if (budget.chars > budget.maxChars) {
          budget.exceeded = true;
          return false;
        }
      }
      return true;
    };
    const emit = (s) => (charge(s ? s.length : 0) ? s : '');
    const emitEscapedText = (raw) => {
      const str = String(raw || '');
      if (budget && str.length > (budget.maxChars - budget.chars)) {
        budget.exceeded = true;
        return '';
      }
      return emit(escapeHtml(str));
    };
    if (node.nodeType === Node.TEXT_NODE) {
      return emitEscapedText(node.nodeValue);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    if (MD_SKIP_TAGS.has(tag)) return '';
    if (depth > 24) {
      if (budget) budget.exceeded = true;
      return '';
    }

    const cls = typeof node.className === 'string' ? node.className : '';
    if (cls.includes('katex-mathml') || (cls.includes('pointer-events-none') && cls.includes('sticky'))) {
      return '';
    }
    if (tag === 'BDI' && cls.includes('context-scope-mention')) {
      const txt = (node.textContent || '').trim();
      return txt ? emit(`<code class="md-pill">${escapeHtml(txt)}</code>`) : '';
    }
    if (tag === 'BUTTON') {
      if (cls.includes('inline-pill')) {
        const txt = (node.textContent || '').trim();
        return txt ? emit(`<code class="md-pill">${escapeHtml(txt)}</code>`) : '';
      }
      return '';
    }

    if (tag === 'HR') return emit('<hr>');
    if (tag === 'BR') return emit('<br>');

    let inner = '';
    for (const child of node.childNodes) {
      if (budget?.exceeded) return '';
      inner += sanitizeMarkdownNodeToHtml(child, depth + 1, budget);
    }
    if (budget?.exceeded) return '';

    if (tag === 'A') {
      const rawHref = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(rawHref)) {
        const escHref = escapeHtml(rawHref);
        return charge(escHref.length + 43) ? `<a href="${escHref}" target="_blank" rel="noopener">${inner}</a>` : '';
      }
      return inner;
    }

    if (tag === 'DIV' && cls.includes('markdown-alert')) {
      return charge(42) ? `<blockquote class="md-alert">${inner}</blockquote>` : '';
    }
    if (tag === 'TABLE') {
      return charge(46) ? `<div class="md-table-wrap"><table>${inner}</table></div>` : '';
    }
    if (MD_ALLOWED_TAGS.has(tag)) {
      const lower = tag.toLowerCase();
      return charge(lower.length * 2 + 5) ? `<${lower}>${inner}</${lower}>` : '';
    }
    return inner;
  }

  function extractSanitizedMarkdownHtml(mdRoots, maxHtmlChars = 260000, maxNodes = 8000) {
    if (!Array.isArray(mdRoots) || !mdRoots.length) return '';
    const budget = { chars: 0, maxChars: maxHtmlChars, nodes: 0, maxNodes, exceeded: false };
    let out = '';
    for (const root of mdRoots) {
      if (budget.exceeded) return '';
      const piece = sanitizeMarkdownNodeToHtml(root, 0, budget).trim();
      if (budget.exceeded) return '';
      if (!piece) continue;
      out += piece;
    }
    return budget.exceeded ? '' : out;
  }

  function collectBoundedNodeText(roots, maxChars = 200000, maxNodes = 8000, maxDepth = 24, shouldSkipNode = null) {
    const list = Array.isArray(roots) ? roots : (roots ? [roots] : []);
    if (!list.length) return { text: '', truncated: false, nodesVisited: 0 };
    const budget = { chars: 0, maxChars, nodes: 0, maxNodes, truncated: false };
    const rootParts = [];

    const walk = (node, depth, chunks) => {
      if (!node || budget.truncated) return;
      budget.nodes += 1;
      if (budget.nodes > budget.maxNodes) {
        budget.truncated = true;
        return;
      }
      const nType = node.nodeType;
      if (nType === 3) {
        const val = String(node.nodeValue || '');
        if (!val) return;
        const rem = budget.maxChars - budget.chars;
        if (val.length > rem) {
          if (rem > 0) chunks.push(val.slice(0, rem));
          budget.chars = budget.maxChars;
          budget.truncated = true;
          return;
        }
        chunks.push(val);
        budget.chars += val.length;
        return;
      }
      if (nType !== 1) return;
      if (MD_SKIP_TAGS.has(node.tagName)) return;
      if (typeof shouldSkipNode === 'function' && shouldSkipNode(node)) return;
      if (depth > maxDepth) {
        budget.truncated = true;
        return;
      }
      const children = node.childNodes;
      if (children && children.length > 0) {
        for (let i = 0; i < children.length; i++) {
          if (budget.truncated) return;
          walk(children[i], depth + 1, chunks);
        }
        return;
      }
      // 仅对无 childNodes 的极简桩节点兜底，仍受字符预算硬截断
      const leafText = String(node.textContent || node.innerText || '');
      if (!leafText) return;
      const rem = budget.maxChars - budget.chars;
      if (leafText.length > rem) {
        if (rem > 0) chunks.push(leafText.slice(0, rem));
        budget.chars = budget.maxChars;
        budget.truncated = true;
        return;
      }
      chunks.push(leafText);
      budget.chars += leafText.length;
    };

    for (let i = 0; i < list.length; i++) {
      if (budget.truncated) break;
      const rootChunks = [];
      walk(list[i], 0, rootChunks);
      const piece = rootChunks.join('').trim();
      if (piece) rootParts.push(piece);
    }

    const joined = rootParts.join('\n\n').trim();
    return {
      text: budget.truncated ? `${joined.slice(0, maxChars)}…` : joined,
      truncated: budget.truncated,
      nodesVisited: budget.nodes
    };
  }

  function collectRecentMessages(limit = 60) {
    const viewport = getScrollViewport() || document.querySelector('main') || document.body;
    if (!viewport) return [];
    const MAX_DOM_MSG_CHARS = 200000;
    const MAX_DOM_THOUGHT_CHARS = 32000;
    const MAX_DOM_HTML_CHARS = 260000;
    const capText = (s, maxLen) => (s && s.length > maxLen ? `${s.slice(0, maxLen)}…` : s);
    const nodes = Array.from(viewport.querySelectorAll('[data-testid="user-message"], [data-testid="agent-response"]'));
    const slice = nodes.slice(-Math.max(1, limit));
    const out = [];
    let turnThoughts = [];
    let turnThoughtLabel = '';
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

    const flushPendingDomThoughts = (tag) => {
      if (!turnThoughts.length && !turnThoughtLabel) {
        turnAssistantIndices = [];
        return;
      }
      if (turnAssistantIndices.length) {
        const lastIdx = turnAssistantIndices[turnAssistantIndices.length - 1];
        clearEarlierTurnThoughts();
        const thoughts = turnThoughts.slice();
        out[lastIdx].thoughtLabel = (turnThoughtLabel || tr('思考过程', 'Thinking')).slice(0, 120);
        out[lastIdx].thoughtText = thoughts.join('\n\n');
        out[lastIdx].thoughts = thoughts;
        out[lastIdx].thoughtCount = Math.max(thoughts.length, turnThoughtLabel ? 1 : 0);
      } else {
        const thoughts = turnThoughts.slice();
        out.push({
          id: `a-think-${tag}`,
          role: 'assistant',
          text: '',
          html: '',
          thoughtLabel: (turnThoughtLabel || tr('思考过程', 'Thinking')).slice(0, 120),
          thoughtText: thoughts.join('\n\n'),
          thoughts,
          thoughtCount: Math.max(thoughts.length, turnThoughtLabel ? 1 : 0),
          highRisk: false,
          riskText: ''
        });
      }
      turnThoughts = [];
      turnThoughtLabel = '';
      turnAssistantIndices = [];
    };

    for (let i = 0; i < slice.length; i++) {
      const node = slice[i];
      const testId = node.getAttribute('data-testid');
      if (testId === 'user-message') {
        const contentNode = node.querySelector('[data-testid="user-message-content"]') || node;
        const domAtts = [];
        const seenAtt = new Set();
        const imgEls = Array.from(node.querySelectorAll('img'));
        for (const imgEl of imgEls) {
          const src = String(imgEl.getAttribute?.('src') || imgEl.src || '').trim();
          if (!src) continue;
          const alt = String(imgEl.getAttribute?.('alt') || imgEl.alt || '').trim() || 'image.png';
          if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(src) && src.length <= 512 * 1024) {
            if (!seenAtt.has(src)) {
              seenAtt.add(src);
              domAtts.push({ kind: 'image', name: alt, inlineUrl: src });
            }
          } else if (/^file:\/\//i.test(src)) {
            let localPath = src.replace(/^file:\/\//i, '');
            try { localPath = decodeURIComponent(localPath); } catch {}
            if (localPath && !seenAtt.has(localPath)) {
              seenAtt.add(localPath);
              domAtts.push({ kind: 'image', name: alt, path: localPath, uri: src });
            }
          }
        }
        const userBounded = collectBoundedNodeText([contentNode], MAX_DOM_MSG_CHARS + 512, 8000);
        let rawUserText = cleanUserMessageText(userBounded.text);
        if (domAtts.length && rawUserText) {
          const attNames = new Set(domAtts.map((a) => String(a.name || '').trim().toLowerCase()).filter(Boolean));
          rawUserText = rawUserText
            .split('\n')
            .filter((line) => {
              const t = line.trim().toLowerCase();
              if (!t) return true;
              if (attNames.has(t)) return false;
              if (/^(?:image|screenshot|clipboard|paste)(?:[-_\s]?\d+)?\.(?:png|jpe?g|webp|gif)$/i.test(t)) return false;
              return true;
            })
            .join('\n')
            .trim();
        }
        const text = capText(rawUserText, MAX_DOM_MSG_CHARS);
        if (!text && !domAtts.length) continue;
        flushPendingDomThoughts(i);
        out.push({ id: `u-${i}`, role: 'user', text, ...(domAtts.length ? { attachments: domAtts } : {}) });
        continue;
      }

      const triggers = Array.from(node.querySelectorAll('[data-testid="thinking-collapsible-trigger"]'));
      const thoughtLabel = triggers.map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
      const thoughtChunks = [];
      for (const trg of triggers) {
        if (trg.getAttribute('aria-expanded') === 'true') {
          const panel = trg.parentElement?.nextElementSibling;
          const zhNode = panel?.querySelector?.('[data-ag-thought-zh]') || trg.nextElementSibling;
          const txt = capText((zhNode?.innerText || panel?.innerText || '').trim(), MAX_DOM_THOUGHT_CHARS);
          if (txt) thoughtChunks.push(txt);
        }
      }
      const mdRoots = Array.from(node.querySelectorAll('[data-markdown-root]')).filter((m) => (
        !m.closest('[data-testid="user-message"]') &&
        !m.closest('[data-testid="thinking-collapsible-trigger"]') &&
        !m.parentElement?.previousElementSibling?.matches?.('[data-testid="thinking-collapsible-trigger"]')
      ));
      const isMarkdownUiChromeNode = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const tag = String(el.tagName || '').toUpperCase();
        const cls = typeof el.className === 'string' ? el.className : '';
        if (cls.includes('katex-mathml') || cls.includes('markdown-alert-title')) return true;
        if (cls.includes('pointer-events-none') && cls.includes('sticky')) return true;
        if (tag === 'BUTTON' && !cls.includes('inline-pill')) return true;
        return false;
      };
      const mdBounded = collectBoundedNodeText(mdRoots, MAX_DOM_MSG_CHARS, 8000, 24, isMarkdownUiChromeNode);
      const overTextCap = mdBounded.truncated;
      let replyText = mdBounded.text;
      // 文本提取阶段已受字符与节点双预算早停；超限时直接跳过 HTML 序列化（完整长文由服务端轨迹通道渲染）
      const replyHtml = overTextCap ? '' : extractSanitizedMarkdownHtml(mdRoots, MAX_DOM_HTML_CHARS);
      const isStepProgressNode = (el) => {
        if (!el || el.nodeType !== 1 || typeof el.getAttribute !== 'function') return false;
        return el.getAttribute('data-step-list') === 'true'
          || el.getAttribute('data-testid') === 'worked-for-collapsible';
      };
      if (!replyText && !triggers.length) {
        const fallbackBounded = collectBoundedNodeText(
          [node],
          MAX_DOM_MSG_CHARS,
          4000,
          24,
          (el) => isStepProgressNode(el) || isMarkdownUiChromeNode(el)
        );
        const cloneText = capText(fallbackBounded.text
          .replace(/^(?:Agent\s+(?:said|working)|智能体(?:回复|正在处理))\s*\n*/i, '')
          .replace(/^Worked\s+for\s+\S+(?:\s+in\s+this\s+step)?\s*\n*/i, '')
          .trim(), MAX_DOM_MSG_CHARS);
        if (cloneText && !/^(?:Agent\s+working|Worked\s+for|Running\s+)/i.test(cloneText)) {
          replyText = cloneText;
        }
      }
      const riskBanner = node.querySelector('.ag-risk-banner');
      const highRisk = Boolean(node.querySelector('[data-ag-risk-card="high"]') || riskBanner);

      if (!replyText && !replyHtml && !thoughtLabel && !thoughtChunks.length && !highRisk) {
        continue;
      }

      if (thoughtChunks.length) turnThoughts.push(...thoughtChunks);
      if (thoughtLabel && !turnThoughtLabel) turnThoughtLabel = thoughtLabel;

      if (!replyText && !replyHtml && !highRisk) {
        continue;
      }

      clearEarlierTurnThoughts();
      const mergedThoughts = turnThoughts.slice();
      const effectiveLabel = turnThoughtLabel || (mergedThoughts.length ? tr('思考过程', 'Thinking') : '');

      out.push({
        id: `a-${i}`,
        role: 'assistant',
        text: replyText,
        html: replyHtml,
        thoughtLabel: effectiveLabel.slice(0, 120),
        thoughtText: mergedThoughts.join('\n\n'),
        thoughts: mergedThoughts,
        thoughtCount: Math.max(mergedThoughts.length, effectiveLabel ? 1 : 0),
        highRisk,
        riskText: (riskBanner?.textContent || '').trim()
      });
      turnAssistantIndices.push(out.length - 1);
    }
    flushPendingDomThoughts('end');
    return out;
  }

  function toSafeNumber(v) {
    if (typeof v === 'bigint') return Number(v);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function findTanStackRouter() {
    try {
      const anchors = [
        document.querySelector('[data-testid="new-conversation-button"]'),
        document.querySelector('[data-testid="conversation-list-sidebar"]'),
        document.querySelector('a[href^="/c/"]')
      ].filter(Boolean);
      for (const el of anchors) {
        const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        let f = fk ? el[fk] : null;
        for (let d = 0; d < 45 && f; d++) {
          let ctx = f.dependencies?.firstContext;
          let guard = 0;
          while (ctx && guard++ < 20) {
            const v = ctx.memoizedValue;
            if (v && typeof v === 'object' && (typeof v.history?.push === 'function' || (typeof v.navigate === 'function' && typeof v.parseLocation === 'function'))) {
              return v;
            }
            ctx = ctx.next;
          }
          f = f.return;
        }
      }
    } catch {}
    return null;
  }

  function triggerNativeProjectNewChat(projectId) {
    try {
      const listEl = document.querySelector('[data-testid="conversation-list-sidebar"]');
      if (!listEl) return null;
      const fk = Object.keys(listEl).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? listEl[fk] : null;
      for (let d = 0; d < 6 && f; d++) {
        const renderer = f.memoizedProps?.customHeaderRenderer;
        if (typeof renderer === 'function') {
          const el = renderer({ id: `header-${projectId}`, type: 'header' });
          if (typeof el?.props?.onAddClick === 'function') {
            el.props.onAddClick({ stopPropagation() {}, preventDefault() {} });
            return { triggered: true, method: 'sidebar-header-action' };
          }
        }
        f = f.return;
      }
    } catch {}
    return null;
  }

  const cascadeSummaryMap = new Map();
  let lastCascadeSummaryFetchAt = 0;
  let cascadeSummaryInflight = false;

  function extractProjectNameFromUri(rawUri) {
    if (!rawUri || typeof rawUri !== 'string') return '';
    let clean = rawUri.replace(/^file:\/\//i, '').replace(/[\\/]+$/, '');
    try { clean = decodeURIComponent(clean); } catch {}
    const parts = clean.split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  async function refreshCascadeTrajectorySummaries() {
    if (disposed || cascadeSummaryInflight) return;
    const csrf = resolveLanguageServerCsrfToken();
    if (!csrf) return;
    cascadeSummaryInflight = true;
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => { try { controller.abort(); } catch {} }, 4000) : null;
      try {
        const resp = await fetch('/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'x-codeium-csrf-token': csrf
          },
          body: '{}',
          signal: controller ? controller.signal : undefined
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const summaries = data?.trajectorySummaries;
        if (!summaries || typeof summaries !== 'object') return;
        for (const [cid, meta] of Object.entries(summaries)) {
          if (!cid || !meta || typeof meta !== 'object') continue;
          const title = String(meta.summary || '').trim();
          const ws0 = Array.isArray(meta.workspaces) ? meta.workspaces[0] : null;
          const proj = extractProjectNameFromUri(ws0?.workspaceFolderAbsoluteUri || ws0?.gitRootAbsoluteUri || '');
          const mtime = meta.lastModifiedTime ? (Date.parse(meta.lastModifiedTime) || 0) : 0;
          cascadeSummaryMap.set(cid, { id: cid, title, project: proj, mtime });
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      // 忽略后台摘要拉取失败
    } finally {
      cascadeSummaryInflight = false;
    }
  }

  function findSidebarFiberProps() {
    const list = document.querySelector('[data-testid="conversation-list-sidebar"]');
    if (!list) return null;
    try {
      const fk = Object.keys(list).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? list[fk] : null;
      for (let d = 0; d < 12 && f; d++) {
        if (Array.isArray(f.memoizedProps?.items)) return f.memoizedProps;
        f = f.return;
      }
    } catch {}
    return null;
  }

  const PERMISSION_DEFAULT_LABELS = {
    turbo: '无限',
    auto: '自动',
    default: '默认',
    request_review: '请求审核'
  };

  function resolvePermissionStateFromDom(permBtn) {
    const rawText = (permBtn?.textContent || '').replace(/\s+/g, ' ').trim();
    const presetAttr = String(permBtn?.getAttribute?.('data-perm-preset') || '').trim().toLowerCase();
    const aria = String(permBtn?.getAttribute?.('aria-label') || '').trim();
    const svgEl = permBtn?.querySelector?.('svg');
    const svgSig = String(svgEl?.innerHTML || svgEl?.querySelector?.('path')?.getAttribute?.('d') || '');

    let key = '';
    if (presetAttr === 'turbo' || presetAttr === 'auto' || presetAttr === 'default' || presetAttr === 'request_review') {
      key = presetAttr;
    } else {
      const combined = `${rawText} ${aria}`.toLowerCase();
      if (/(?:turbo|无限|unrestricted)/i.test(combined)) key = 'turbo';
      else if (/(?:request_review|review|请求审核|请求审查|审核|审查)/i.test(combined)) key = 'request_review';
      else if (/(?:\bauto\b|自动)/i.test(combined)) key = 'auto';
      else if (/(?:\bdefault\b|默认)/i.test(combined)) key = 'default';
      else if (svgSig.includes('502.92-344.77')) key = 'turbo';
      else if (svgSig.includes('595.58-384.51')) key = 'request_review';
      else if (svgSig.includes('252.31-100')) key = 'default';
      else if (svgSig.includes('480-100.77')) key = 'auto';
      else key = 'unknown';
    }
    const label = rawText || PERMISSION_DEFAULT_LABELS[key] || '未知';
    return { permissionKey: key, permissionLabel: label };
  }

  function readDesktopAppNavigationState() {
    const router = findTanStackRouter();
    const hasRouter = Boolean(router && router.state);
    const routerReady = Boolean(hasRouter && !router.state.isLoading && router.state.status !== 'pending');
    const routePath = String(router?.state?.location?.pathname || location?.pathname || '');
    const searchVal = router?.state?.location?.search;
    const routeProjectId = (searchVal && typeof searchVal === 'object' && searchVal.project)
      ? String(searchVal.project).trim()
      : getProjectIdFromLocation();

    let matchedCascadeId = '';
    if (Array.isArray(router?.state?.matches)) {
      for (let i = router.state.matches.length - 1; i >= 0; i--) {
        const cid = router.state.matches[i]?.params?.cascadeId;
        if (cid) {
          matchedCascadeId = String(cid);
          break;
        }
      }
    }

    let hasInputProps = false;
    let inExistingConversation = false;
    let inputCascadeId = '';
    let isConvoLoading = false;
    try {
      const compHost = document.querySelector('.surface-composer') || getComposerEditor();
      if (compHost) {
        const fk = Object.keys(compHost).find((k) => k.startsWith('__reactFiber$'));
        let f = fk ? compHost[fk] : null;
        for (let i = 0; i < 16 && f; i++) {
          const p = f.memoizedProps;
          if (p && typeof p === 'object' && ('inExistingConversation' in p || 'handleSubmit' in p)) {
            hasInputProps = true;
            inExistingConversation = Boolean(p.inExistingConversation);
            inputCascadeId = String(p.cascadeId || '');
            isConvoLoading = Boolean(p.isConvoLoading);
            break;
          }
          f = f.return;
        }
      }
    } catch {}

    let domSelectedProjectId = '';
    try {
      const selProj = document.querySelector('[data-active-project-id]')
        || document.querySelector('[data-testid="new-convo-project-trigger"][data-project-id]')
        || Array.from(document.querySelectorAll('[data-project-id]')).find((n) => n.getAttribute('data-selected') === 'true' || n.getAttribute('aria-pressed') === 'true');
      if (selProj) {
        domSelectedProjectId = String(selProj.getAttribute('data-active-project-id') || selProj.getAttribute('data-project-id') || '').trim();
      }
    } catch {}

    let activeDomRowId = '';
    try {
      const rows = getOrderedSidebarConversationRows();
      const activeRow = rows.find((r) => isSidebarRowActive(r, ''));
      if (activeRow) activeDomRowId = extractSidebarRowId(activeRow);
    } catch {}

    return {
      hasRouter,
      routerReady,
      routePath,
      routeProjectId,
      matchedCascadeId,
      hasComposer: Boolean(getComposerEditor()),
      hasInputProps,
      inExistingConversation,
      inputCascadeId,
      isConvoLoading,
      domSelectedProjectId,
      activeDomRowId
    };
  }

  async function waitForVerifiedNavigationState(kind, targetValue, timeoutMs = 1200) {
    const start = Date.now();
    let lastState = readDesktopAppNavigationState();
    const isMatched = (st) => {
      if (kind === 'new') {
        const pid = String(targetValue || '').trim();
        if (st.hasRouter || st.hasInputProps) {
          const inputLandingOk = st.hasInputProps && st.inExistingConversation === false && !st.isConvoLoading && !st.inputCascadeId;
          const routerLandingOk = st.hasRouter && st.routerReady && st.routePath === '/' && !st.matchedCascadeId;
          const projectOk = !pid || st.routeProjectId === pid || st.domSelectedProjectId === pid;
          return st.hasComposer && (inputLandingOk || routerLandingOk) && projectOk;
        }
        return st.hasComposer && !st.activeDomRowId && (!pid || st.domSelectedProjectId === pid);
      }
      if (kind === 'switch') {
        const cid = String(targetValue || '').trim();
        if (!cid) return false;
        if (st.hasRouter || st.hasInputProps) {
          const routerSwitched = st.hasRouter && st.routerReady && st.matchedCascadeId === cid;
          const inputSwitched = st.hasInputProps && st.inExistingConversation === true && st.inputCascadeId === cid && !st.isConvoLoading;
          return routerSwitched || inputSwitched;
        }
        return st.activeDomRowId === cid;
      }
      return false;
    };

    while (Date.now() - start <= timeoutMs) {
      lastState = readDesktopAppNavigationState();
      if (isMatched(lastState)) return { ok: true, state: lastState };
      await new Promise((r) => setTimeout(r, 40));
    }
    return { ok: false, state: lastState };
  }

  async function navigateSpaRoute(targetHref, options = {}) {
    const href = String(targetHref || '/').trim() || '/';
    const cMatch = href.match(/^\/c\/([^/?#]+)/);
    const pId = parseProjectIdFromHref(href);
    let method = '';

    if (cMatch) {
      const cid = cMatch[1];
      const row = findSidebarRowById(cid);
      const link = row?.querySelector('a[href]')
        || document.querySelector(`a[href="/c/${escapeCssIdent(cid)}"]`)
        || document.querySelector(`a[href*="/c/${escapeCssIdent(cid)}"]`)
        || row;
      if (link && typeof link.click === 'function') {
        link.click();
        method = 'dom-link';
      }
    } else if (pId) {
      if (options.preferNativeProjectAction) {
        const nativeRes = triggerNativeProjectNewChat(pId);
        if (nativeRes?.triggered) method = nativeRes.method;
      }
      if (!method) {
        const projLink = document.querySelector(`a[href="/?project=${escapeCssIdent(pId)}"]`)
          || Array.from(document.querySelectorAll('a[href*="project="]')).find((a) => parseProjectIdFromHref(a.getAttribute('href')) === pId);
        if (projLink && typeof projLink.click === 'function') {
          projLink.click();
          method = 'dom-link';
        }
      }
    } else if (href === '/') {
      const newBtn = document.querySelector('a[data-testid="new-conversation-button"], [data-testid="new-conversation-button"] a, [data-testid="new-conversation-button"]');
      if (newBtn && typeof newBtn.click === 'function') {
        newBtn.click();
        method = 'dom-link';
      }
    }

    if (!method) {
      const router = findTanStackRouter();
      if (router) {
        try {
          if (typeof router.history?.push === 'function') {
            router.history.push(href);
            method = 'router-history';
          } else if (typeof router.navigate === 'function') {
            if (pId) await router.navigate({ to: '/', search: { project: pId } });
            else await router.navigate({ to: href, search: {} });
            method = 'router-navigate';
          }
        } catch {}
      }
    }

    if (!method && typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
      try {
        window.history.pushState({}, '', href);
        const ev = typeof PopStateEvent === 'function' ? new PopStateEvent('popstate') : new Event('popstate');
        window.dispatchEvent(ev);
        method = 'popstate-dispatch';
      } catch {}
    }

    if (!method) {
      return { ok: false, error: '未找到可用的桌面端导航控制接口' };
    }
    return { ok: true, method };
  }

  function extractSidebarStoreCatalog() {
    const projectMap = new Map();
    const convs = [];
    const seenConv = new Set();

    const addProject = (raw) => {
      const id = String(raw?.id || '').trim();
      const name = String(raw?.name || raw?.label || '').trim();
      if (!id || !name) return;
      if (name === 'swarm/swarm_board') return;
      const prev = projectMap.get(id);
      if (!prev) {
        projectMap.set(id, {
          id,
          name,
          kind: String(raw?.kind || 'project'),
          isCollapsed: Boolean(raw?.isCollapsed)
        });
      } else if (raw?.isCollapsed !== undefined) {
        prev.isCollapsed = Boolean(raw.isCollapsed);
      }
    };

    try {
      const listEl = document.querySelector('[data-testid="conversation-list-sidebar"]');
      if (listEl) {
        const fk = Object.keys(listEl).find((k) => k.startsWith('__reactFiber$'));
        let f = fk ? listEl[fk] : null;
        const collapsedById = new Map();
        const convGroupMap = new Map();

        // 从虚拟列表 items 读取当前折叠态与会话归属映射
        const uMc = f?.return;
        if (Array.isArray(uMc?.memoizedProps?.items)) {
          for (const it of uMc.memoizedProps.items) {
            if (!it || typeof it !== 'object') continue;
            if (it.type === 'header' && typeof it.id === 'string' && it.id.startsWith('header-')) {
              collapsedById.set(it.id.slice(7), Boolean(it.isCollapsed));
            } else if (it.type === 'row' && it.cascadeId && it.groupId) {
              convGroupMap.set(String(it.cascadeId), String(it.groupId));
            }
          }
        }

        // 向上查找包含完整项目分组（含折叠组内全量会话）的 Hook 状态
        let groups = null;
        for (let d = 0; d < 16 && f; d++) {
          let st = f.memoizedState;
          let guard = 0;
          while (st && guard++ < 30) {
            const val = st.memoizedState;
            if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object'
              && typeof val[0].id === 'string' && (Array.isArray(val[0].entries) || Array.isArray(val[0].conversationIds))) {
              groups = val;
              break;
            }
            st = st.next;
          }
          if (groups) break;
          f = f.return;
        }

        if (Array.isArray(groups)) {
          for (const g of groups) {
            if (!g || typeof g !== 'object') continue;
            const gId = String(g.id || '').trim();
            const gName = String(g.label || '').trim();
            if (!gId || gName === 'swarm/swarm_board') continue;
            const entries = Array.isArray(g.entries) ? g.entries : [];
            if ((gId === 'outside-of-project' || gId === 'standalone') && entries.length === 0) continue;
            addProject({
              id: gId,
              name: gName || gId,
              kind: g.kind || 'project',
              isCollapsed: collapsedById.get(gId)
            });
            for (const entry of entries) {
              const cid = String(entry?.cascadeId || entry?.conversation?.conversationId || '').trim();
              if (!cid || seenConv.has(cid)) continue;
              seenConv.add(cid);
              const rawSummary = String(entry?.conversation?.summary || '').replace(/\s+/g, ' ').trim();
              const cachedZh = (uiLang !== 'en' && !sidebarUserRenamedIds.has(cid)) ? sidebarZhCache.get(cid) : '';
              const pid = String(entry?.projectId || convGroupMap.get(cid) || gId).trim();
              convs.push({
                id: cid,
                projectId: pid,
                projectName: gName || '',
                title: (cachedZh || rawSummary || cid.slice(0, 8)).slice(0, 80),
                timeKey: toSafeNumber(entry?.timeKey),
                workspaceUri: String(entry?.workspaceUriStr || '')
              });
            }
          }
        }
      }
    } catch {}

    // DOM 项目标题栏回退与补充（兼容无 React Fiber 的环境及测试 DOM）
    try {
      const headers = document.querySelectorAll('[data-testid="project-header"]');
      for (const btn of headers) {
        const name = String(btn.getAttribute('data-project-label') || btn.textContent || '').replace(/\s+/g, ' ').trim();
        const wrap = btn.parentElement?.parentElement || btn.parentElement;
        const projLink = wrap?.querySelector?.('a[href*="project="]');
        const pid = parseProjectIdFromHref(projLink?.getAttribute?.('href')) || btn.getAttribute('data-project-id') || '';
        if (!pid || !name) continue;
        addProject({
          id: pid,
          name,
          kind: 'project',
          isCollapsed: btn.getAttribute('aria-expanded') === 'false'
        });
      }
    } catch {}

    return {
      projects: Array.from(projectMap.values()),
      conversations: convs
    };
  }

  function collectSidebarConversations(limit = 0, preloadedStoreCatalog = null) {
    const maxItems = Number(limit) > 0 ? Number(limit) : Infinity;
    const currentId = getSessionIdFromLocation() || '';
    const rows = getOrderedSidebarConversationRows();
    const list = [];
    const byId = new Map();
    const domProjectMap = new Map();

    // 从当前渲染序列追踪 DOM 行所属的项目头（用于无 Fiber 时的 DOM 分组推断）
    try {
      const nodes = document.querySelectorAll('[data-testid="project-header"], [data-testid="conversation-row-sidebar"]');
      let activeHeaderPid = '';
      for (const n of nodes) {
        if (n.getAttribute('data-testid') === 'project-header') {
          const wrap = n.parentElement?.parentElement || n.parentElement;
          const pLink = wrap?.querySelector?.('a[href*="project="]');
          activeHeaderPid = parseProjectIdFromHref(pLink?.getAttribute?.('href')) || n.getAttribute('data-project-id') || '';
        } else {
          const cid = extractSidebarRowId(n);
          if (cid && activeHeaderPid) domProjectMap.set(cid, activeHeaderPid);
        }
      }
    } catch {}

    const storeCatalog = preloadedStoreCatalog || extractSidebarStoreCatalog();
    const storeById = new Map(storeCatalog.conversations.map((c) => [c.id, c]));

    for (const row of rows) {
      const id = extractSidebarRowId(row);
      if (!id || byId.has(id)) continue;
      const storeMeta = storeById.get(id);
      const title = getSidebarRowDisplayTitle(row);
      const active = isSidebarRowActive(row, currentId);
      const domBusy = Boolean(row.querySelector('[data-testid="status-loading-spinner"], button[aria-label*="停止"], button[aria-label*="Stop"]'));
      const domUnread = Boolean(row.querySelector('[data-testid="status-unread-dot"]'));
      const pinned = row.getAttribute('data-pinned') === 'true';
      const item = {
        id,
        title: title.slice(0, 80),
        active,
        projectId: storeMeta?.projectId || domProjectMap.get(id) || '',
        projectName: storeMeta?.projectName || '',
        domBusy,
        domUnread,
        pinned,
        timeKey: toSafeNumber(storeMeta?.timeKey)
      };
      byId.set(id, item);
      list.push(item);
      if (list.length >= maxItems) break;
    }

    for (const sc of storeCatalog.conversations) {
      if (list.length >= maxItems) break;
      if (byId.has(sc.id)) continue;
      const item = {
        id: sc.id,
        title: sc.title,
        active: Boolean(currentId && sc.id === currentId),
        projectId: sc.projectId || '',
        projectName: sc.projectName || '',
        domBusy: false,
        domUnread: false,
        pinned: false,
        timeKey: toSafeNumber(sc.timeKey)
      };
      byId.set(sc.id, item);
      list.push(item);
    }

    return list;
  }

  function collectSidebarProjectGroups(limit = 60) {
    const currentId = getSessionIdFromLocation() || '';
    const domRows = getOrderedSidebarConversationRows();
    const domRowMap = new Map();
    for (const row of domRows) {
      const id = extractSidebarRowId(row);
      if (!id) continue;
      domRowMap.set(id, {
        title: getSidebarRowDisplayTitle(row),
        active: isSidebarRowActive(row, currentId)
      });
    }

    const resolveConvTitle = (cid) => (
      domRowMap.get(cid)?.title
      || sidebarZhCache.get(cid)
      || sidebarRawTitleMap.get(cid)
      || cascadeSummaryMap.get(cid)?.title
      || `对话 ${cid.slice(0, 8)}`
    );

    const groups = [];
    const groupById = new Map();
    const ensureGroup = (gid, name, count = 0, isCollapsed = false) => {
      const key = String(gid || `name:${name}`).trim();
      if (groupById.has(key)) return groupById.get(key);
      const grp = {
        id: String(gid || ''),
        key,
        name: String(name || '未命名项目').trim() || '未命名项目',
        count: Number(count) || 0,
        isCollapsed: Boolean(isCollapsed),
        active: false,
        conversations: []
      };
      groups.push(grp);
      groupById.set(key, grp);
      return grp;
    };

    const fiberProps = findSidebarFiberProps();
    const fiberItems = Array.isArray(fiberProps?.items) ? fiberProps.items : null;
    if (fiberItems && fiberItems.some((x) => x && (x.type === 'header' || x.type === 'row'))) {
      let curGrp = null;
      for (const it of fiberItems) {
        if (!it || typeof it !== 'object') continue;
        if (it.type === 'header') {
          const gid = String(it.id || '').replace(/^header-/, '') || String(it.label || '未命名项目');
          curGrp = ensureGroup(gid, it.label || '未命名项目', it.count || 0, Boolean(it.isCollapsed));
        } else if (it.type === 'row') {
          const cid = String(it.cascadeId || it.id || '').trim();
          if (!cid) continue;
          const targetGrp = (it.groupId && groupById.get(String(it.groupId))) || curGrp || ensureGroup('default', '默认项目');
          if (targetGrp.conversations.some((c) => c.id === cid)) continue;
          const domMeta = domRowMap.get(cid);
          const active = Boolean(domMeta?.active || (currentId && cid === currentId));
          targetGrp.conversations.push({
            id: cid,
            title: resolveConvTitle(cid).slice(0, 80),
            active,
            project: targetGrp.name
          });
        }
      }
      if (cascadeSummaryMap.size > 0) {
        const summariesSorted = Array.from(cascadeSummaryMap.values()).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        for (const grp of groups) {
          if (grp.conversations.length > 0 && grp.conversations.length >= grp.count) continue;
          for (const meta of summariesSorted) {
            if (!meta || meta.project !== grp.name) continue;
            if (grp.conversations.some((c) => c.id === meta.id)) continue;
            grp.conversations.push({
              id: meta.id,
              title: resolveConvTitle(meta.id).slice(0, 80),
              active: Boolean(domRowMap.get(meta.id)?.active || (currentId && meta.id === currentId)),
              project: grp.name
            });
          }
        }
      }
    } else {
      const container = document.querySelector('[data-testid="conversation-list-sidebar"]') || document;
      const nodes = container.querySelectorAll('[data-testid="project-header"], [data-testid="conversation-row-sidebar"]');
      let curGrp = null;
      for (const node of nodes) {
        const tid = node.getAttribute?.('data-testid');
        if (tid === 'project-header') {
          const pname = (node.textContent || '').replace(/\s+/g, ' ').trim() || '未命名项目';
          curGrp = ensureGroup(`dom:${pname}`, pname);
        } else if (tid === 'conversation-row-sidebar') {
          const cid = extractSidebarRowId(node);
          if (!cid) continue;
          const targetGrp = curGrp || ensureGroup('dom:默认项目', '默认项目');
          if (targetGrp.conversations.some((c) => c.id === cid)) continue;
          const active = isSidebarRowActive(node, currentId);
          targetGrp.conversations.push({
            id: cid,
            title: getSidebarRowDisplayTitle(node).slice(0, 80),
            active,
            project: targetGrp.name
          });
        }
      }
    }

    let projectGroups = groups.filter((g) => g.conversations.length > 0 || g.count > 0);
    if (!projectGroups.length && groups.length) projectGroups = groups;

    const flatConversations = [];
    for (const grp of projectGroups) {
      grp.count = Math.max(grp.count || 0, grp.conversations.length);
      grp.active = grp.conversations.some((c) => c.active);
      for (const conv of grp.conversations) {
        if (flatConversations.length < limit || conv.active) {
          if (!flatConversations.some((c) => c.id === conv.id)) {
            flatConversations.push(conv);
          }
        }
      }
    }
    return { projectGroups, conversations: flatConversations.slice(0, limit) };
  }

  function getModelSelectorContext() {
    try {
      const btn = document.querySelector('[data-testid="model-selector-trigger"]');
      if (!btn) return null;
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? btn[fk] : null;
      for (let i = 0; i < 28 && f; i++) {
        const v = f.memoizedProps?.value;
        if (v && typeof v.setSelectedModel === 'function' && Array.isArray(v.modelOptions)) {
          return v;
        }
        f = f.return;
      }
    } catch {}
    return null;
  }

  function getPermissionPresetsMeta() {
    return [
      { key: 'turbo', label: '⚡ 无限 (Turbo)' },
      { key: 'auto', label: '🛡️ 自动 (Auto)' },
      { key: 'default', label: '🔒 默认 (Default)' },
      { key: 'request_review', label: '👁️ 请求审核 (Review)' }
    ];
  }

  function collectDesktopContextPanelData(sr, pulseEl, contextBadge, model) {
    const ctxData = pulseEl?.__ctxUsageData || null;
    const readText = (id) => (sr?.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
    const usedText = readText('key-used');
    const limitText = readText('key-limit');
    const remainingText = readText('key-remaining');
    const keyBadge = readText('key-badge');
    const speedVal = readText('speed-val');
    const durationText = readText('speed-duration');
    const ttftText = readText('speed-ttft');
    const outputTokensText = readText('speed-tokens');
    const roundCostText = readText('round-cost-text');
    const sessionCostText = readText('session-cost-text');
    const pctText = readText('badge-pct-val') || contextBadge || '';
    const pctMatch = pctText.match(/(\d+(?:\.\d+)?)\s*%/);
    const usagePercent = ctxData && typeof ctxData.usagePercent === 'number'
      ? Number(ctxData.usagePercent)
      : (pctMatch ? Number(pctMatch[1]) : null);
    const speedMatch = speedVal.match(/(\d+(?:\.\d+)?)/);
    const durMatch = durationText.match(/(\d+(?:\.\d+)?)/);
    return {
      usedTokens: ctxData && typeof ctxData.contextUsed === 'number' ? ctxData.contextUsed : null,
      limitTokens: ctxData && typeof ctxData.contextLimit === 'number' ? ctxData.contextLimit : null,
      usagePercent,
      cacheHitRate: ctxData && typeof ctxData.cacheHitRate === 'number' ? ctxData.cacheHitRate : null,
      tokPerSec: ctxData && typeof ctxData.tokPerSec === 'number'
        ? ctxData.tokPerSec
        : (speedMatch ? Number(speedMatch[1]) : null),
      lastDurationSec: ctxData && typeof ctxData.lastDurationSec === 'number'
        ? ctxData.lastDurationSec
        : (durMatch ? Number(durMatch[1]) : null),
      outputTokens: ctxData && typeof ctxData.outputTokens === 'number' ? ctxData.outputTokens : null,
      modelDisplayName: ctxData?.modelDisplayName || model || '',
      contextBadge: contextBadge || '',
      usedText,
      limitText,
      remainingText,
      keyBadge,
      speedText: speedVal,
      durationText,
      ttftText,
      outputTokensText,
      roundCostText,
      sessionCostText
    };
  }

  function collectDesktopUsageSummary(sr) {
    const hist = window.__AGContextMeterHistory || null;
    const sum = hist?.summary || null;
    const badgeText = (sr?.getElementById('badge-tokens')?.textContent || '').replace(/\s+/g, ' ').trim();
    const refCost = hist?.referenceCost || hist?.costEstimate || null;
    return {
      todayTokens: Number(sum?.todayTokens || 0) || 0,
      sevenDayTokens: Number(sum?.sevenDayTokens || 0) || 0,
      thirtyDayTokens: Number(sum?.thirtyDayTokens || 0) || 0,
      totalTokens: Number(sum?.totalTokens || 0) || 0,
      sessionCount: Number(sum?.sessionCount || 0) || 0,
      totalCostUsd: Number(refCost?.totalUsd ?? sum?.totalCostUsd ?? 0) || 0,
      badgeText
    };
  }

  function parseRpcDurationSec(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (!raw || typeof raw !== 'string') return null;
    const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*(ms|s)?$/i);
    if (!m) return null;
    const val = Number(m[1]);
    if (!Number.isFinite(val)) return null;
    return String(m[2] || '').toLowerCase() === 'ms' ? val / 1000 : val;
  }

  function formatRpcTokensShort(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v >= 1000000) return `${(v / 1000000).toFixed(v >= 10000000 ? 1 : 2).replace(/\.0+$/, '')}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  }

  async function callLanguageServerRpc(method, body = {}, timeoutMs = 4500) {
    const csrf = resolveLanguageServerCsrfToken();
    if (!csrf) throw new Error('缺少语言服务凭证 (csrfToken)');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs) : null;
    try {
      const resp = await fetch(`/exa.language_server_pb.LanguageServerService/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': csrf
        },
        body: JSON.stringify(body || {}),
        signal: controller ? controller.signal : undefined
      });
      if (!resp.ok) throw new Error(`RPC ${method} HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  function isStopHookBlockedSystemStep(step, prevStep = null, steps = null, stepIndex = -1) {
    if (!step || typeof step !== 'object') return false;
    const type = String(step.type || '');
    if (type && type !== 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE') return false;
    const sysMsg = step.systemMessage;
    if (sysMsg && typeof sysMsg === 'object') {
      return /^\s*Stop hook blocked termination(?::|\b)/i.test(String(sysMsg.message || ''));
    }
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

  function extractMessagesFromTrajectorySteps(steps, limit = 20) {
    const list = Array.isArray(steps) ? steps : [];
    const out = [];
    let turnThoughts = [];
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

    const flushPendingThoughts = (idxTag) => {
      if (!turnThoughts.length) {
        turnAssistantIndices = [];
        return;
      }
      const thoughts = turnThoughts.slice();
      if (turnAssistantIndices.length) {
        const lastIdx = turnAssistantIndices[turnAssistantIndices.length - 1];
        clearEarlierTurnThoughts();
        out[lastIdx].thoughtLabel = tr('思考过程', 'Thinking');
        out[lastIdx].thoughtText = thoughts.join('\n\n');
        out[lastIdx].thoughts = thoughts;
        out[lastIdx].thoughtCount = thoughts.length;
      } else {
        out.push({
          id: `rpc-think-${idxTag}`,
          role: 'assistant',
          text: '',
          html: '',
          thoughtLabel: tr('思考过程', 'Thinking'),
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

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || typeof s !== 'object') continue;
      if (s.userInput) {
        if (isQueuedTrajectoryUserStep(s)) continue;
        const u = s.userInput;
        const text = String(
          u.userResponse ||
          (Array.isArray(u.items) ? u.items.map((item) => item?.text || '').filter(Boolean).join('\n') : '') ||
          ''
        ).trim();
        const atts = [];
        const collectRpcMedia = (arr, forceImg) => {
          if (!Array.isArray(arr)) return;
          for (const m of arr) {
            if (!m || typeof m !== 'object') continue;
            const rawUri = String(m.uri || m.fileUri || m.path || m.absoluteUri || '').trim();
            let localPath = rawUri.startsWith('file://') ? rawUri.replace(/^file:\/\//i, '') : (rawUri.startsWith('/') ? rawUri : '');
            if (localPath) { try { localPath = decodeURIComponent(localPath); } catch {} }
            const mime = String(m.mimeType || m.mime_type || 'image/png').trim().toLowerCase();
            const rawB64 = String(m.base64Data || m.base64_data || m.inlineData || m.inline_data || m.thumbnail || m.data || '').trim();
            let inlineUrl = '';
            if (rawB64 && rawB64.length <= 512 * 1024 && /^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(mime)) {
              inlineUrl = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(rawB64) ? rawB64 : `data:${mime};base64,${rawB64.replace(/\s+/g, '')}`;
            }
            const isImg = forceImg || Boolean(inlineUrl) || /^image\//i.test(mime) || /\.(?:png|jpe?g|webp|gif)$/i.test(localPath);
            if (!localPath && !inlineUrl) continue;
            atts.push({
              kind: isImg ? 'image' : 'file',
              name: String(m.displayName || m.name || (localPath ? localPath.split('/').pop() : 'image.png')),
              ...(localPath ? { path: localPath } : {}),
              ...(inlineUrl ? { inlineUrl } : {})
            });
          }
        };
        collectRpcMedia(u.media, false);
        collectRpcMedia(u.images, true);
        if (text || atts.length) {
          flushPendingThoughts(i);
          out.push({ id: `rpc-u-${i}`, role: 'user', text: text.slice(0, 4000), html: '', ...(atts.length ? { attachments: atts } : {}) });
        }
      } else if (s.plannerResponse) {
        const pr = s.plannerResponse;
        const text = String(pr.modifiedResponse || pr.response || '').trim();
        const thoughtText = String(pr.thinking || pr.thought || '').trim();
        if (thoughtText) turnThoughts.push(thoughtText);
        const hasToolCalls = Array.isArray(pr.toolCalls) && pr.toolCalls.length > 0;
        const blockedByStopHook = !hasToolCalls && isStopHookBlockedSystemStep(list[i + 1], s, list, i + 1);
        if (text && !blockedByStopHook) {
          clearEarlierTurnThoughts();
          const thoughts = turnThoughts.slice();
          out.push({
            id: `rpc-a-${i}`,
            role: 'assistant',
            text: text.slice(0, 4000),
            html: '',
            thoughtLabel: thoughts.length ? tr('思考过程', 'Thinking') : '',
            thoughtText: thoughts.join('\n\n'),
            thoughts,
            thoughtCount: thoughts.length,
            highRisk: false,
            riskText: ''
          });
          turnAssistantIndices.push(out.length - 1);
        }
      } else if (s.errorMessage) {
        const errObj = s.errorMessage.error || s.errorMessage || {};
        const errText = String(errObj.modelErrorMessage || errObj.shortError || errObj.fullError || '').trim();
        if (errText) {
          flushPendingThoughts(i);
          out.push({
            id: `rpc-e-${i}`,
            role: 'assistant',
            text: errText.slice(0, 2000),
            html: '',
            thoughtLabel: '',
            thoughtText: '',
            thoughts: [],
            thoughtCount: 0,
            highRisk: true,
            riskText: tr('步骤异常', 'Step Error')
          });
        }
      }
    }
    flushPendingThoughts('end');
    return out.slice(-limit);
  }

  function cloneSidebarWithActiveConversation(conversations, projectGroups, activeId) {
    const nextConvs = (Array.isArray(conversations) ? conversations : []).map((c) => ({
      ...c,
      active: Boolean(activeId && c.id === activeId)
    }));
    const nextGroups = (Array.isArray(projectGroups) ? projectGroups : []).map((g) => ({
      ...g,
      conversations: (Array.isArray(g.conversations) ? g.conversations : []).map((c) => ({
        ...c,
        active: Boolean(activeId && c.id === activeId)
      }))
    }));
    return { conversations: nextConvs, projectGroups: nextGroups };
  }

  function getMobileSnapshot() {
    const sessionId = getSessionIdFromLocation() || '';
    if (resolveLanguageServerCsrfToken() && (Date.now() - lastCascadeSummaryFetchAt) >= 20000) {
      lastCascadeSummaryFetchAt = Date.now();
      void refreshCascadeTrajectorySummaries();
    }
    const storeCatalog = extractSidebarStoreCatalog();
    const conversations = collectSidebarConversations(0, storeCatalog);
    const { projectGroups } = collectSidebarProjectGroups(60);
    const activeConv = conversations.find((c) => c.active);
    const busySignal = detectAssistantBusySignal();
    const busy = Boolean(busySignal);
    const locProjectId = getProjectIdFromLocation();
    const currentProjectId = locProjectId || activeConv?.projectId || '';
    const matchedProj = storeCatalog.projects.find((p) => p.id === currentProjectId);
    const currentProjectName = activeConv?.projectName || matchedProj?.name || '';
    const isNewConversation = !sessionId;
    const { sr } = getMeterHostAndShadow();
    const contextBadge = (
      sr?.getElementById('amount')?.textContent ||
      sr?.getElementById('badge-pct-val')?.textContent ||
      sr?.getElementById('badge')?.textContent ||
      ''
    ).replace(/\s+/g, ' ').trim();
    const speedBadge = (sr?.getElementById('badge-speed')?.textContent || '').replace(/\s+/g, ' ').trim();
    const pulseEl = document.querySelector('[data-agy-context-capsule="1"]');
    const rawPulse = (pulseEl?.textContent || speedBadge || '').replace(/\s+/g, ' ').trim();
    const speedMatch = rawPulse.match(/(\d+(?:\.\d+)?\s*tok\/s)/i);
    const ratioMatch = contextBadge.match(/(\d+(?:\.\d+)?[KM]?\s*\(\d+(?:\.\d+)?%\))/);
    const pulseText = [speedMatch ? speedMatch[1] : '', ratioMatch ? ratioMatch[1] : contextBadge].filter(Boolean).join(' · ') || rawPulse;
    const modelCtx = getModelSelectorContext();
    const model = modelCtx?.selectedModel?.label || detectCurrentModelText();
    const EFFORT_ORDER = { xhigh: 1, high: 2, medium: 3, low: 4 };
    const rawModels = Array.isArray(modelCtx?.modelOptions)
      ? modelCtx.modelOptions.filter((o) => o && !o.disabled && o.label)
      : [];
    const familyOrder = new Map();
    const parsedModels = rawModels.map((o, idx) => {
      const label = String(o.label);
      const m = label.match(/^(.*?)\s*\((XHigh|High|Medium|Low)\)\s*$/i);
      const family = m ? m[1].trim().toLowerCase() : label.trim().toLowerCase();
      const effort = m ? (EFFORT_ORDER[m[2].toLowerCase()] || 9) : 0;
      if (!familyOrder.has(family)) familyOrder.set(family, idx);
      return {
        label,
        modelId: String(o.modelId || ''),
        selected: Boolean(o.label === modelCtx?.selectedModel?.label),
        familyRank: familyOrder.get(family),
        effortRank: effort,
        origIdx: idx
      };
    });
    parsedModels.sort((a, b) => (a.familyRank - b.familyRank) || (a.effortRank - b.effortRank) || (a.origIdx - b.origIdx));
    const modelOptions = parsedModels.map(({ label, modelId, selected }) => ({ label, modelId, selected }));
    const permBtn = document.querySelector('[data-testid="permissions-selector-trigger"]');
    const { permissionKey, permissionLabel } = resolvePermissionStateFromDom(permBtn);
    const pendingApprovals = collectPendingApprovals();
    const pendingPrompts = collectPendingPrompts();
    const queuedMessages = collectQueuedMessagesFromDom();
    const messages = collectRecentMessages(60);
    const suggestions = !busy ? computeNextStepCandidates().candidates : [];
    const contextPanel = collectDesktopContextPanelData(sr, pulseEl, contextBadge, model);
    const usageSummary = collectDesktopUsageSummary(sr);

    if (activeConv) {
      if (pendingApprovals.length > 0 || pendingPrompts.length > 0) activeConv.status = 'waiting';
      else if (busy) activeConv.status = 'running';
    }

    const title = activeConv?.title
      || (isNewConversation ? (currentProjectName ? `新建对话 · ${currentProjectName}` : '新建对话') : (document.title || 'Antigravity'));

    return {
      ok: true,
      version: '1.8.0',
      timestamp: Date.now(),
      sessionId,
      activeConversationId: sessionId,
      desktopSessionId: sessionId,
      isolated: false,
      isNewConversation,
      currentProjectId,
      currentProjectName,
      title,
      busy,
      busySignal,
      strongDomBusy: busySignal === 'cancel-btn' || busySignal === 'thinking' || busySignal === 'spinner' || busySignal === 'recent-submit',
      autoAccept: autoAcceptEnabled,
      model,
      modelOptions,
      permissionKey,
      permissionLabel,
      permissionOptions: getPermissionPresetsMeta(),
      contextBadge,
      pulseText,
      contextPanel,
      usageSummary,
      quota: {
        activePoolKey: quotaState.activePoolKey,
        gemini: quotaState.gemini,
        claude: quotaState.claude,
        lastFetchedAt: quotaState.lastFetchedAt
      },
      pendingApprovals,
      pendingPrompts,
      queuedMessages,
      suggestions,
      messages,
      projects: storeCatalog.projects,
      conversations,
      projectGroups
    };
  }

  async function fetchIsolatedConversationSnapshot(baseSnap, reqConvId) {
    try {
      const full = await callLanguageServerRpc('GetCascadeTrajectory', {
        cascadeId: reqConvId,
        trajectoryVerbosity: 3
      }, 4500);
      const trajectory = full?.trajectory;
      if (!trajectory || typeof trajectory !== 'object') {
        throw new Error('未取得目标会话历史');
      }
      const steps = Array.isArray(trajectory.steps) ? trajectory.steps.slice() : [];
      const expected = Number(full?.numTotalSteps ?? steps.length);
      if (expected > steps.length) {
        let offset = Math.max(steps.length, expected - 80);
        for (let n = 0; n < 4 && offset < expected; n++) {
          const page = await callLanguageServerRpc('GetCascadeTrajectorySteps', {
            cascadeId: reqConvId,
            stepOffset: offset,
            trajectoryVerbosity: 3
          }, 3500).catch(() => null);
          const chunk = Array.isArray(page?.steps) ? page.steps : [];
          if (!chunk.length) break;
          steps.push(...chunk);
          offset += chunk.length;
        }
      }

      const genCount = Number(full?.numTotalGeneratorMetadata ?? trajectory.generatorMetadata?.length ?? 0);
      let genList = Array.isArray(trajectory.generatorMetadata) ? trajectory.generatorMetadata : [];
      if (genCount > 0) {
        const tail = await callLanguageServerRpc('GetCascadeTrajectoryGeneratorMetadata', {
          cascadeId: reqConvId,
          generatorMetadataOffset: Math.max(0, genCount - 3),
          includeMessages: false
        }, 3000).catch(() => null);
        if (Array.isArray(tail?.generatorMetadata) && tail.generatorMetadata.length) {
          genList = tail.generatorMetadata;
        }
      }

      let validMeta = null;
      for (let i = genList.length - 1; i >= 0; i--) {
        const cand = genList[i];
        if (cand && (cand.chatModel || cand.usage)) {
          validMeta = cand;
          break;
        }
      }

      const cm = validMeta?.chatModel || null;
      const u = cm?.usage || validMeta?.usage || {};
      const input = Number(u.inputTokens || 0) || 0;
      const cached = Number(u.cacheReadTokens || 0) || 0;
      const output = Number(u.outputTokens || 0) || 0;
      const ctxMeta = cm?.chatStartMetadata?.contextWindowMetadata || {};
      const usedTokens = (input + cached + output) || Number(ctxMeta.estimatedTokensUsed || 0) || 0;
      const limitTokens = Number(ctxMeta.maxContextTokens || 0) || 0;
      const usagePercent = limitTokens > 0
        ? Number(((usedTokens / limitTokens) * 100).toFixed(1))
        : null;
      const cacheHitRate = (input + cached) > 0
        ? (cached / (input + cached)) * 100
        : null;
      const ttft = parseRpcDurationSec(cm?.timeToFirstToken);
      const streaming = parseRpcDurationSec(cm?.streamingDuration);
      const dur = (ttft != null && streaming != null)
        ? Number((ttft + streaming).toFixed(2))
        : (streaming != null ? Number(streaming.toFixed(2)) : (ttft != null ? Number(ttft.toFixed(2)) : null));
      const tokPerSec = (output > 0 && dur && dur > 0)
        ? Number((output / dur).toFixed(1))
        : null;
      const isolatedModel = cm?.modelDisplayName || cm?.responseModel || cm?.model || baseSnap.model || '';
      const isolatedContextBadge = limitTokens > 0
        ? `${formatRpcTokensShort(usedTokens)}/${formatRpcTokensShort(limitTokens)} (${usagePercent ?? 0}%)`
        : (usedTokens > 0 ? formatRpcTokensShort(usedTokens) : '独立视图');
      const isolatedPulseText = [
        tokPerSec ? `${tokPerSec} tok/s` : '',
        isolatedContextBadge
      ].filter(Boolean).join(' · ');

      const messages = extractMessagesFromTrajectorySteps(steps, 20);
      const lastStep = steps.length ? steps[steps.length - 1] : null;
      const trajStatusStr = String(trajectory.status || '').trim();
      const isTrajTerminalIdle = /IDLE|CANCELED|CANCELLED|COMPLETED|DONE/i.test(trajStatusStr);
      const busy = isTrajTerminalIdle
        ? false
        : (/RUNNING|IN_PROGRESS|ACTIVE|EXECUTING/i.test(trajStatusStr) ||
          /RUNNING|PENDING|GENERATING/i.test(String(lastStep?.status || '')));

      let lastAssistantText = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].text) {
          lastAssistantText = messages[i].text;
          break;
        }
      }
      const suggestions = !busy
        ? computeNextStepCandidatesFromText(reqConvId, lastAssistantText, usagePercent || 0, steps.length).candidates
        : [];
      const cloned = cloneSidebarWithActiveConversation(baseSnap.conversations, baseSnap.projectGroups, reqConvId);
      const matchedConv = cloned.conversations.find((c) => c.id === reqConvId);
      const matchedGroup = (cloned.projectGroups || []).find((g) => (g.conversations || []).some((c) => c.id === reqConvId)) || null;
      const targetProjectId = String(matchedConv?.projectId || matchedGroup?.id || trajectory?.trajectoryMetadata?.projectId || '').trim();
      const targetProjectName = String(matchedConv?.projectName || matchedGroup?.name || '').trim();
      const title = matchedConv?.title || cascadeSummaryMap.get(reqConvId)?.title || String(trajectory.summary || '').trim() || `会话 ${reqConvId.slice(0, 8)}`;

      return {
        ...baseSnap,
        sessionId: reqConvId,
        activeConversationId: reqConvId,
        desktopSessionId: baseSnap.sessionId || '',
        isolated: true,
        isNewConversation: false,
        currentProjectId: targetProjectId,
        currentProjectName: targetProjectName,
        title,
        busy,
        model: isolatedModel,
        contextBadge: isolatedContextBadge,
        pulseText: isolatedPulseText,
        contextPanel: {
          usedTokens: usedTokens || null,
          limitTokens: limitTokens || null,
          usagePercent,
          cacheHitRate,
          tokPerSec,
          lastDurationSec: dur,
          outputTokens: output || null,
          modelDisplayName: isolatedModel,
          contextBadge: isolatedContextBadge,
          usedText: usedTokens > 0 ? formatRpcTokensShort(usedTokens) : '—',
          limitText: limitTokens > 0 ? formatRpcTokensShort(limitTokens) : '—',
          remainingText: limitTokens > usedTokens ? formatRpcTokensShort(limitTokens - usedTokens) : (limitTokens > 0 ? '0' : '—'),
          keyBadge: `${usagePercent ?? '--'}%`,
          speedText: tokPerSec ? `${tokPerSec} tok/s` : '—',
          durationText: dur != null ? `${dur}s` : '—',
          ttftText: ttft != null ? `${ttft}s` : '—',
          outputTokensText: output > 0 ? `${output}` : '—',
          roundCostText: '',
          sessionCostText: ''
        },
        pendingApprovals: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.pendingApprovals || []) : [],
        pendingPrompts: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.pendingPrompts || []) : [],
        queuedMessages: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.queuedMessages || []) : [],
        suggestions,
        messages,
        conversations: cloned.conversations,
        projectGroups: cloned.projectGroups
      };
    } catch (err) {
      const cloned = cloneSidebarWithActiveConversation(baseSnap.conversations, baseSnap.projectGroups, reqConvId);
      const matchedConv = cloned.conversations.find((c) => c.id === reqConvId);
      const matchedGroup = (cloned.projectGroups || []).find((g) => (g.conversations || []).some((c) => c.id === reqConvId)) || null;
      const targetProjectId = String(matchedConv?.projectId || matchedGroup?.id || '').trim();
      const targetProjectName = String(matchedConv?.projectName || matchedGroup?.name || '').trim();
      const title = matchedConv?.title || cascadeSummaryMap.get(reqConvId)?.title || `会话 ${reqConvId.slice(0, 8)}`;
      return {
        ...baseSnap,
        sessionId: reqConvId,
        activeConversationId: reqConvId,
        desktopSessionId: baseSnap.sessionId || '',
        isolated: true,
        isolatedError: true,
        historySource: 'isolated_error',
        isNewConversation: false,
        currentProjectId: targetProjectId,
        currentProjectName: targetProjectName,
        title,
        busy: false,
        pendingApprovals: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.pendingApprovals || []) : [],
        pendingPrompts: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.pendingPrompts || []) : [],
        queuedMessages: (reqConvId && reqConvId === (baseSnap.sessionId || '')) ? (baseSnap.queuedMessages || []) : [],
        suggestions: [],
        messages: [],
        contextBadge: '读取失败',
        pulseText: '',
        contextPanel: null,
        conversations: cloned.conversations,
        projectGroups: cloned.projectGroups,
        isolationWarning: err?.message || '无法独立读取该会话'
      };
    }
  }

  async function getMobileSnapshotAsync(opts = {}) {
    const baseSnap = getMobileSnapshot();
    const reqConvId = String(opts?.conversationId || '').trim();
    if (!reqConvId || reqConvId === (baseSnap.sessionId || '') || reqConvId === '__new__') {
      return {
        ...baseSnap,
        activeConversationId: baseSnap.sessionId || '',
        desktopSessionId: baseSnap.sessionId || '',
        isolated: false
      };
    }
    return await fetchIsolatedConversationSnapshot(baseSnap, reqConvId);
  }

  async function switchToConversationInternal(rawTargetId) {
    const targetId = String(rawTargetId || '').trim();
    if (!targetId) return { ok: false, error: '缺少会话 ID' };
    if (targetId === 'new') {
      const newBtn = document.querySelector('a[data-testid="new-conversation-button"], [data-testid="new-conversation-button"] a, [data-testid="new-conversation-button"]');
      if (!newBtn) return { ok: false, error: '未找到新建对话按钮' };
      newBtn.click();
      await new Promise((r) => setTimeout(r, 180));
      return { ok: true, id: 'new' };
    }
    let row = findSidebarRowById(targetId);
    let link = row?.querySelector('a[href]') || document.querySelector(`a[href*="/c/${escapeCssIdent(targetId)}"]`);
    let clickTarget = link || row;
    if (!clickTarget) {
      const props = findSidebarFiberProps();
      const rowItem = props?.items?.find((x) => x && x.type === 'row' && (x.cascadeId === targetId || x.id === targetId));
      if (rowItem?.groupId) {
        const hdrItem = props.items.find((x) => x && x.type === 'header' && (x.id === `header-${rowItem.groupId}` || x.id === rowItem.groupId));
        if (hdrItem?.isCollapsed) {
          const domHdr = Array.from(document.querySelectorAll('[data-testid="project-header"]'))
            .find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === String(hdrItem.label || '').trim());
          if (domHdr) domHdr.click();
          else if (typeof props.onToggleCollapseSection === 'function') props.onToggleCollapseSection(hdrItem.collapseId || hdrItem.id);
          await new Promise((r) => setTimeout(r, 140));
          row = findSidebarRowById(targetId);
          link = row?.querySelector('a[href]') || document.querySelector(`a[href*="/c/${escapeCssIdent(targetId)}"]`);
          clickTarget = link || row;
        }
      }
    }
    if (clickTarget) {
      clickTarget.click();
      await new Promise((r) => setTimeout(r, 180));
      return { ok: true, id: targetId, pathname: location.pathname };
    }
    if (typeof window.history?.pushState === 'function') {
      window.history.pushState(null, '', `/c/${encodeURIComponent(targetId)}`);
      if (typeof PopStateEvent === 'function') {
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        window.dispatchEvent(new Event('popstate'));
      }
      await new Promise((r) => setTimeout(r, 180));
      return { ok: true, id: targetId, pathname: location.pathname, method: 'history' };
    }
    return { ok: false, error: '未在侧边栏找到该会话' };
  }

  function findComposerAttachmentRemoveButtons() {
    const composerEl = document.querySelector('.surface-composer');
    if (!composerEl) return [];
    const composerScope = composerEl.parentElement || composerEl;
    const isSuiteOverlayNode = (el) => Boolean(el?.closest?.(`#${QUICK_BAR_ID}, #${CHAT_NAV_ID}, #${METER_HOST_ID}, [data-agy-hans-ui], [data-agy-context-capsule]`));
    return Array.from(composerScope.querySelectorAll('button')).filter((btn) => {
      if (isSuiteOverlayNode(btn)) return false;
      const meta = `${btn.getAttribute?.('aria-label') || ''} ${btn.getAttribute?.('title') || ''} ${btn.textContent || ''}`.trim();
      const isRemoveBtn = /^(?:×|✕|x)$/i.test(meta) || /remove|delete|close|clear|移除|删除|取消附件/i.test(meta);
      if (!isRemoveBtn) return false;
      const container = btn.parentElement;
      if (!container) return false;
      return Boolean(container.querySelector('img') || /\.(?:png|jpe?g|webp|gif|pdf|txt|md|json|csv|zip|docx?|xlsx?|js|ts|py)/i.test(container.textContent || '') || container.getAttribute?.('data-testid')?.match(/attach|file|image|media/i));
    });
  }

  async function executeMobileActionCore(action, payload) {
    if (action === 'send') {
      const text = String(payload?.text || '').trim();
      const pendingUploads = Array.isArray(payload?.pendingUploads) ? payload.pendingUploads : [];
      if (!text && !pendingUploads.length) return { ok: false, error: '发送内容不能为空' };
      const beforeRemoveBtns = pendingUploads.length > 0 ? new Set(findComposerAttachmentRemoveButtons()) : null;
      let injectedCount = 0;
      const rollbackNewlyInjected = () => {
        if (!beforeRemoveBtns || injectedCount <= 0) return;
        const newlyAdded = findComposerAttachmentRemoveButtons().filter((b) => !beforeRemoveBtns.has(b));
        for (let i = newlyAdded.length - 1; i >= 0; i -= 1) {
          try { newlyAdded[i].click(); } catch {}
        }
      };
      try {
        if (pendingUploads.length > 0) {
          for (const att of pendingUploads) {
            const upRes = await injectUploadedFileToDesktopComposer(att?.name, att?.mimeType, att?.base64);
            if (!upRes?.ok) {
              rollbackNewlyInjected();
              return { ok: false, error: upRes?.error || '恢复附件注入桌面输入框失败，已回滚本次已注入附件并取消发送' };
            }
            injectedCount += 1;
          }
          await new Promise((r) => setTimeout(r, 60));
        }
        if (text) {
          const filled = await fillComposerText(text);
          if (!filled) {
            rollbackNewlyInjected();
            return { ok: false, error: '未能填入输入框' };
          }
        }
        const submitRes = await submitCurrentComposer({ allowEnterOnDisabled: true, checkBusyOnEnter: false });
        if (!submitRes?.ok) {
          rollbackNewlyInjected();
        }
        return submitRes;
      } catch (err) {
        rollbackNewlyInjected();
        throw err;
      }
    }

    if (action === 'fill') {
      const ok = await fillComposerText(String(payload?.text || ''));
      return { ok };
    }

    if (action === 'stop') {
      const cancelBtn =
        document.querySelector('.surface-composer [data-testid="input-cancel-button"]') ||
        document.querySelector('[data-testid="input-cancel-button"]');
      if (!cancelBtn || cancelBtn.disabled) return { ok: false, error: '当前未在执行中' };
      cancelBtn.click();
      return { ok: true };
    }

    if (action === 'toggle-auto-accept') {
      autoAcceptEnabled = !autoAcceptEnabled;
      updateAutoAcceptBtn();
      showQuickToast(autoAcceptEnabled ? '自动确认已开启（仅限安全确认按钮）' : '自动确认已关闭');
      if (autoAcceptEnabled) runAutoAcceptTick();
      return { ok: true, autoAccept: autoAcceptEnabled };
    }

    if (action === 'click-approval') {
      const candidates = findApprovalCandidateButtons();
      if (!candidates.length) return { ok: false, error: '当前没有待审批操作' };
      const reqLabel = String(payload?.label || '').trim();
      const reqIndex = Number.isInteger(payload?.index) ? payload.index : -1;
      let picked = null;
      if (reqLabel) {
        picked = candidates.find((c) => c.label === reqLabel) || null;
      }
      if (!picked && reqIndex >= 0 && reqIndex < candidates.length) {
        picked = candidates[reqIndex];
      }
      if (!picked) return { ok: false, error: '目标审批按钮已消失或已处理' };
      picked.btn.click();
      return { ok: true, label: picked.label, kind: picked.kind };
    }

    if (action === 'respond-prompt') {
      const cards = findInteractivePromptCards();
      if (!cards.length) return { ok: false, error: '当前没有待确认选择框' };
      const reqKey = String(payload?.promptKey || payload?.promptId || '').trim();
      const pIdx = Number.isInteger(payload?.promptIndex) ? payload.promptIndex : -1;
      let card = null;
      if (reqKey) {
        card = cards.find((c) => c.promptKey === reqKey || c.id === reqKey) || null;
        if (!card) return { ok: false, error: '目标确认选择框已消失或已变更' };
      } else if (pIdx >= 0 && pIdx < cards.length) {
        card = cards[pIdx];
      } else {
        return { ok: false, error: '目标确认选择框已消失或索引失效' };
      }

      // 在修改任何选项/输入前先原子校验目标操作按钮是否存在，防止失败时留下半成品状态
      const reqActionLabel = String(payload?.actionLabel || '').trim();
      const reqActionIdx = Number.isInteger(payload?.actionIndex) ? payload.actionIndex : -1;
      let targetBtn = null;
      if (reqActionLabel) {
        targetBtn = card.actions.find((a) => a.label === reqActionLabel) || null;
      }
      if (!targetBtn && reqActionIdx >= 0 && reqActionIdx < card.actions.length) {
        targetBtn = card.actions[reqActionIdx];
      }
      if ((reqActionLabel || reqActionIdx >= 0) && !targetBtn?.el) {
        return { ok: false, error: '目标确认按钮已消失或不可用' };
      }

      const desiredIndices = Array.isArray(payload?.selectedIndices)
        ? new Set(payload.selectedIndices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0))
        : null;
      const desiredLabels = Array.isArray(payload?.selectedLabels)
        ? new Set(payload.selectedLabels.map((s) => String(s || '').trim()).filter(Boolean))
        : null;

      if ((desiredIndices || desiredLabels) && card.options.length > 0) {
        for (const opt of card.options) {
          const wantSelected = Boolean(
            (desiredIndices && desiredIndices.has(opt.index))
            || (desiredLabels && desiredLabels.has(opt.label))
          );
          const curSelected = isPromptControlSelected(opt.el);
          if (card.multiSelect) {
            if (wantSelected !== curSelected) {
              opt.el.click();
            }
          } else if (wantSelected && !curSelected) {
            opt.el.click();
          }
        }
      }

      if (payload?.otherText !== undefined && card.otherInput) {
        setNativePromptInputValue(card.otherInput, String(payload.otherText || ''));
      }

      if (targetBtn?.el) {
        if (targetBtn.el.disabled || targetBtn.el.getAttribute?.('aria-disabled') === 'true') {
          return { ok: false, error: '目标确认按钮当前仍处于禁用状态，请先完成必选项' };
        }
        if (targetBtn.kind !== 'reject') {
          const otherReq = Boolean(card.otherInput && (card.otherInput.required || card.otherInput.getAttribute?.('required') !== null));
          if (otherReq && !String(card.otherInput.value || '').trim()) {
            return { ok: false, error: String(card.otherInput.validationMessage || '').trim() || '请先填写必填项后再提交' };
          }
          if (card.otherInput && typeof card.otherInput.checkValidity === 'function' && !card.otherInput.checkValidity()) {
            return { ok: false, error: String(card.otherInput.validationMessage || '').trim() || '输入内容未通过校验，请修改后重试' };
          }
          const formEl = String(card.root?.tagName || '').toUpperCase() === 'FORM'
            ? card.root
            : card.root?.querySelector?.('form');
          if (formEl && typeof formEl.checkValidity === 'function' && !formEl.checkValidity()) {
            return { ok: false, error: '表单存在未通过校验的必填项，请完善后重试' };
          }
        }
        targetBtn.el.click();
      }

      return {
        ok: true,
        promptId: card.id,
        promptKey: card.promptKey,
        actionLabel: targetBtn?.label || '',
        selectedCount: desiredIndices ? desiredIndices.size : (desiredLabels ? desiredLabels.size : 0)
      };
    }

    if (action === 'expand-project') {
      const groupId = String(payload?.groupId || '').trim();
      const groupName = String(payload?.name || '').trim();
      const headers = Array.from(document.querySelectorAll('[data-testid="project-header"]'));
      const domHdr = groupName ? headers.find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === groupName) : null;
      const props = findSidebarFiberProps();
      const hdrItem = props?.items?.find((x) =>
        x && x.type === 'header' && (
          (groupId && (String(x.id || '') === groupId || String(x.id || '') === `header-${groupId}`))
          || (groupName && String(x.label || '').trim() === groupName)
        )
      );
      if (hdrItem?.isCollapsed) {
        if (domHdr) {
          domHdr.click();
        } else if (typeof props?.onToggleCollapseSection === 'function') {
          props.onToggleCollapseSection(hdrItem.collapseId || hdrItem.id || groupId);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return { ok: true, groupId, name: groupName };
    }

    if (action === 'new-conversation' || (action === 'switch-conversation' && String(payload?.id || '').trim() === 'new')) {
      const projectId = String(payload?.projectId || '').trim();
      const skipProject = !projectId || projectId === 'ungrouped' || projectId === 'outside-of-project' || projectId === 'standalone';
      const expectedPid = skipProject ? '' : projectId;
      const targetHref = skipProject ? '/' : `/?project=${encodeURIComponent(projectId)}`;
      const nav = await navigateSpaRoute(targetHref, { preferNativeProjectAction: Boolean(expectedPid) });
      if (!nav.ok) return { ok: false, error: nav.error || '新建对话导航失败' };
      const verified = await waitForVerifiedNavigationState('new', expectedPid, 1200);
      if (!verified.ok) {
        return {
          ok: false,
          error: expectedPid ? `桌面端未进入目标项目新建对话状态: ${expectedPid}` : '桌面端未进入新建对话状态',
          method: nav.method,
          verifiedState: verified.state
        };
      }
      return {
        ok: true,
        id: 'new',
        projectId: expectedPid,
        method: nav.method,
        pathname: location?.pathname || '/',
        search: location?.search || '',
        verifiedState: verified.state
      };
    }

    if (action === 'switch-conversation') {
      const targetId = String(payload?.id || '').trim();
      if (!targetId) return { ok: false, error: '缺少会话 ID' };
      const nav = await navigateSpaRoute(`/c/${targetId}`);
      if (!nav.ok) return { ok: false, error: nav.error || '未找到该会话的跳转入口' };
      const verified = await waitForVerifiedNavigationState('switch', targetId, 1200);
      if (!verified.ok) {
        return {
          ok: false,
          error: `桌面端未切换至目标会话状态: ${targetId}`,
          method: nav.method,
          verifiedState: verified.state
        };
      }
      return {
        ok: true,
        id: targetId,
        method: nav.method,
        pathname: location?.pathname || `/c/${targetId}`,
        verifiedState: verified.state
      };
    }

    if (action === 'toggle-thinking') {
      const toggled = toggleAllThinking();
      return { ok: true, toggled };
    }

    if (action === 'refresh-quota') {
      await refreshQuota();
      return {
        ok: true,
        quota: {
          activePoolKey: quotaState.activePoolKey,
          gemini: quotaState.gemini,
          claude: quotaState.claude,
          lastFetchedAt: quotaState.lastFetchedAt
        }
      };
    }

    if (action === 'select-model') {
      const targetLabel = String(payload?.label || '').trim();
      const targetModelId = String(payload?.modelId || '').trim();
      const modelCtx = getModelSelectorContext();
      if (!modelCtx || !Array.isArray(modelCtx.modelOptions)) {
        return { ok: false, error: '未找到桌面端模型选择器' };
      }
      const picked = modelCtx.modelOptions.find((o) =>
        o && !o.disabled && (
          (targetLabel && o.label === targetLabel) ||
          (targetModelId && o.modelId === targetModelId)
        )
      );
      if (!picked) {
        return { ok: false, error: `未找到目标模型: ${targetLabel || targetModelId}` };
      }
      modelCtx.setSelectedModel(picked);
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, model: picked.label };
    }

    if (action === 'select-permission') {
      const preset = String(payload?.preset || '').trim();
      if (!preset) return { ok: false, error: '缺少权限预设名称' };
      const permBtn = document.querySelector('[data-testid="permissions-selector-trigger"]');
      if (!permBtn) return { ok: false, error: '未找到桌面端权限选择器' };
      if (permBtn.getAttribute('aria-disabled') === 'true' || permBtn.disabled) {
        return { ok: false, error: '当前会话不允许切换权限预设' };
      }

      let menuCtx = null;
      try {
        const fk = Object.keys(permBtn).find((k) => k.startsWith('__reactFiber$'));
        let f = fk ? permBtn[fk] : null;
        for (let i = 0; i < 20 && f; i++) {
          const v = f.memoizedProps?.value;
          if (v && typeof v.setIsOpen === 'function' && 'open' in v) {
            menuCtx = v;
            break;
          }
          f = f.return;
        }
      } catch {}

      if (menuCtx) menuCtx.setIsOpen(true);
      else permBtn.click();

      let opt = null;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 40));
        opt = document.querySelector(`[data-testid="permissions-preset-option-${CSS.escape(preset)}"]`);
        if (opt) break;
      }
      if (!opt) {
        if (menuCtx) menuCtx.setIsOpen(false);
        return { ok: false, error: `权限选项不可用: ${preset}` };
      }
      if (opt.getAttribute('aria-disabled') === 'true' || opt.hasAttribute('disabled')) {
        if (menuCtx) menuCtx.setIsOpen(false);
        return { ok: false, error: `该权限预设当前被锁定: ${preset}` };
      }
      opt.click();
      await new Promise((r) => setTimeout(r, 90));
      if (menuCtx && menuCtx.open) {
        menuCtx.setIsOpen(false);
      }
      const resolved = resolvePermissionStateFromDom(permBtn);
      const nextKey = resolved.permissionKey !== 'unknown' ? resolved.permissionKey : preset;
      return { ok: true, preset, permissionKey: nextKey, permissionLabel: resolved.permissionLabel };
    }

    async function injectUploadedFileToDesktopComposer(fileName, mimeType, rawB64) {
      const rawStr = String(rawB64 || '').trim();
      if (!rawStr) return { ok: false, error: '缺少附件数据' };
      const dataUrlMatch = rawStr.match(/^data:([^;,\s]+);base64,([\s\S]+)$/i);
      const cleanB64 = (dataUrlMatch ? dataUrlMatch[2] : rawStr.replace(/^data:[^;]+;base64,/, '')).replace(/\s+/g, '');
      if (!cleanB64) return { ok: false, error: '缺少附件数据' };
      const resolvedMime = String(dataUrlMatch?.[1] || mimeType || 'image/jpeg').trim() || 'image/jpeg';
      const resolvedName = String(fileName || `mobile-${Date.now()}.jpg`).trim();

      let bytes;
      try {
        const binStr = atob(cleanB64);
        bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      } catch {
        return { ok: false, error: '图片数据解析失败，请重新选择图片' };
      }

      const inp =
        document.querySelector('.surface-composer input[type="file"]') ||
        document.querySelector('input[type="file"][multiple]') ||
        document.querySelector('input[type="file"]');
      if (!inp) return { ok: false, error: '未找到桌面端文件上传控件' };

      const file = new File([bytes], resolvedName, { type: resolvedMime });
      const dt = new DataTransfer();
      dt.items.add(file);
      try {
        Object.defineProperty(inp, 'files', { configurable: true, writable: true, value: dt.files });
      } catch {
        inp.files = dt.files;
      }

      const pk = Object.keys(inp).find((k) => k.startsWith('__reactProps$'));
      if (pk && typeof inp[pk]?.onChange === 'function') {
        inp[pk].onChange({ target: inp, currentTarget: inp });
      } else {
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 90));
      return { ok: true, name: file.name, mimeType: resolvedMime, size: file.size };
    }

    if (action === 'upload-image') {
      const rawB64 = String(payload?.base64 || '').trim();
      if (!rawB64) return { ok: false, error: '缺少图片数据' };
      return await injectUploadedFileToDesktopComposer(
        String(payload?.name || `mobile-${Date.now()}.jpg`).trim(),
        String(payload?.mimeType || 'image/jpeg').trim() || 'image/jpeg',
        rawB64
      );
    }

    if (action === 'remove-uploaded-attachment') {
      const clearAll = payload?.clearAll === true;
      const reqName = String(payload?.name || '').trim().toLowerCase();
      const reqIdx = Number.isInteger(payload?.index) ? payload.index : -1;
      const composerEl = document.querySelector('.surface-composer');
      if (!composerEl) {
        return { ok: false, removed: 0, error: '未找到桌面端输入区域，已取消删除以防误删' };
      }
      const candidates = findComposerAttachmentRemoveButtons();
      if (!candidates.length) {
        return clearAll
          ? { ok: true, removed: 0 }
          : { ok: false, removed: 0, error: '桌面端当前未找到可移除的附件' };
      }
      if (clearAll) {
        let removed = 0;
        for (let i = candidates.length - 1; i >= 0; i--) {
          try { candidates[i].click(); removed += 1; } catch {}
        }
        return { ok: true, removed };
      }
      const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const matchesBtnName = (b) => {
        if (!reqName) return true;
        const box = b.parentElement;
        const imgAlt = normName(box?.querySelector?.('img')?.getAttribute?.('alt'));
        if (imgAlt && imgAlt === reqName) return true;
        const aria = normName(b.getAttribute?.('aria-label'))
          .replace(/^(?:remove|delete|close|clear|移除|删除|取消附件)\s*[:：-]?\s*/i, '')
          .trim();
        if (aria && aria === reqName) return true;
        const boxTxt = normName(box?.textContent)
          .replace(/[×✕]\s*$/g, '')
          .trim();
        if (boxTxt && boxTxt === reqName) return true;
        return false;
      };
      let targetBtn = null;
      if (reqName) {
        // 同名多附件场景优先按 index + 精确名称命中，避免误删前一个同名项；其次按精确名称命中
        if (reqIdx >= 0 && reqIdx < candidates.length && matchesBtnName(candidates[reqIdx])) {
          targetBtn = candidates[reqIdx];
        }
        if (!targetBtn) {
          targetBtn = candidates.find(matchesBtnName) || null;
        }
        if (!targetBtn) {
          return { ok: false, removed: 0, error: '未在桌面端找到匹配的附件，已取消删除以防误删' };
        }
      } else {
        if (reqIdx >= 0 && reqIdx < candidates.length) {
          targetBtn = candidates[reqIdx];
        } else {
          return { ok: false, removed: 0, error: '目标附件索引已失效，已取消删除以防误删' };
        }
      }
      try {
        targetBtn.click();
        return { ok: true, removed: 1 };
      } catch (err) {
        return { ok: false, error: err?.message || '移除桌面端附件失败' };
      }
    }

    const normQueuedText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const stripQueuedMediaSuffix = (s) => normQueuedText(s)
      .replace(/(?:\s*\[附带\s*\d+\s*张图片\]|\s*\[图片附件\]|\s*\[图片\s*×\d+\])+$/g, '')
      .trim();

    const resolveStrictQueuedDomTarget = (entries, reqPayload, actionVerb) => {
      if (!Array.isArray(entries) || !entries.length) {
        return { ok: false, error: '当前没有排队中的消息' };
      }
      const reqMsgId = String(reqPayload?.messageId || '').trim();
      if (reqMsgId) {
        const matched = entries.find((e) => e.messageId && e.messageId === reqMsgId) || null;
        if (!matched) {
          return { ok: false, error: `目标排队消息已变化或不存在，已取消${actionVerb}以防误操作` };
        }
        return { ok: true, target: matched };
      }
      const expQueueCount = Number(reqPayload?.expectedQueueCount);
      if (Number.isInteger(expQueueCount) && expQueueCount > 0 && entries.length !== expQueueCount) {
        return { ok: false, error: `桌面排队数量已变化，已取消${actionVerb}以防索引移位误操作` };
      }
      const hasReqIdx = Number.isInteger(reqPayload?.domIndex);
      const reqIdx = hasReqIdx ? reqPayload.domIndex : -1;
      const reqText = normQueuedText(reqPayload?.text);
      const reqTextCore = stripQueuedMediaSuffix(reqText);
      const matchesEntryText = (entry) => {
        const et = normQueuedText(entry?.text);
        if (!reqText) return true;
        if (et === reqText) return true;
        const etCore = stripQueuedMediaSuffix(et);
        if (reqTextCore) return Boolean(etCore && etCore === reqTextCore);
        return !etCore && ((Array.isArray(entry?.images) && entry.images.length > 0) || Boolean(entry?.hasMedia) || /\[(?:图片附件|图片\s*×\d+)\]/.test(et));
      };
      if (hasReqIdx) {
        if (reqIdx < 0 || reqIdx >= entries.length) {
          return { ok: false, error: `目标排队索引越界，已取消${actionVerb}以防误操作` };
        }
        const indexedTarget = entries[reqIdx];
        if (reqText && !matchesEntryText(indexedTarget)) {
          return { ok: false, error: `目标排队消息文本已变化，已取消${actionVerb}以防误操作` };
        }
        return { ok: true, target: indexedTarget };
      }
      if (reqText) {
        const textMatches = entries.filter((e) => matchesEntryText(e));
        if (textMatches.length === 1) {
          return { ok: true, target: textMatches[0] };
        }
        return {
          ok: false,
          error: textMatches.length > 1
            ? `存在多条相同文本排队消息，无法确认唯一目标，已取消${actionVerb}`
            : `目标排队消息文本未匹配，已取消${actionVerb}以防误操作`
        };
      }
      if (entries.length === 1) {
        return { ok: true, target: entries[0] };
      }
      return { ok: false, error: `多条排队消息缺少唯一目标标识，已取消${actionVerb}以防误操作` };
    };

    if (action === 'send-queued-dom') {
      const entries = await ensureQueuedMessagesExpanded(findQueuedMessagesDomEntries(), 'sendBtn');
      if (!entries.length) return { ok: false, error: '当前没有排队中的消息' };
      if (payload?.sendAll === true) {
        let sentCount = 0;
        for (const entry of entries) {
          if (entry?.sendBtn) {
            entry.sendBtn.click();
            sentCount += 1;
          }
        }
        if (!sentCount) return { ok: false, error: '未找到桌面端排队消息发送按钮' };
        return { ok: true, source: 'dom', sentCount };
      }
      const resolved = resolveStrictQueuedDomTarget(entries, payload, '发送');
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const target = resolved.target;
      if (!target?.sendBtn) return { ok: false, error: '未找到桌面端排队消息发送按钮' };
      target.sendBtn.click();
      return { ok: true, source: 'dom', sentCount: 1 };
    }

    if (action === 'edit-queued-dom') {
      const entries = await ensureQueuedMessagesExpanded(findQueuedMessagesDomEntries(), 'editOrDelete');
      const resolved = resolveStrictQueuedDomTarget(entries, payload, '编辑');
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const target = resolved.target;
      const rawAtts = (Array.isArray(target.attachments) && target.attachments.length)
        ? target.attachments
        : (Array.isArray(target.images) ? target.images.map((im, idx) => {
            const srcStr = String(im?.src || '').trim();
            const m = srcStr.match(/^data:([^;,\s]+);base64,/i);
            return {
              name: String(im?.alt || `image-${idx + 1}.png`).trim(),
              mimeType: m ? m[1].toLowerCase() : 'image/png',
              size: 0,
              isImage: true,
              previewUrl: srcStr,
              inlineData: m ? srcStr : ''
            };
          }) : []);
      const hasMedia = Boolean(
        payload?.hasMedia ||
        target.hasMedia ||
        rawAtts.length > 0 ||
        /\[(?:附带\s*\d+\s*张图片|图片附件|图片\s*×\d+)\]/.test(String(target.text || ''))
      );
      const cleanText = hasMedia ? stripQueuedMediaSuffix(target.text || '') : String(target.text || '');
      if (!hasMedia) {
        if (target.editBtn) {
          target.editBtn.click();
          return { ok: true, source: 'dom', nativeEditRestored: true, editedText: cleanText };
        }
        if (!target.deleteBtn) return { ok: false, error: '未找到桌面端排队消息编辑/删除按钮' };
        target.deleteBtn.click();
        return { ok: true, source: 'dom', editedText: cleanText };
      }
      const editedAttachments = rawAtts
        .map((att, idx) => {
          const rawPrev = String(att?.previewUrl || att?.inlineData || '').trim();
          const safePrev = /^blob:/i.test(rawPrev) ? '' : rawPrev;
          const mimeType = String(att?.mimeType || 'image/png').trim() || 'image/png';
          return {
            name: String(att?.name || `image-${idx + 1}.png`).trim(),
            mimeType,
            size: Number(att?.size || 0),
            isImage: att?.isImage !== false,
            previewUrl: safePrev
          };
        })
        .filter((att) => Boolean(att.previewUrl || att.name));
      const isBgSwitch = payload?._isBackgroundSwitch === true;
      const inlineRestoreList = rawAtts
        .map((att, idx) => {
          const inlineB64 = String(att?.inlineData || (String(att?.previewUrl || '').startsWith('data:') ? att.previewUrl : '')).trim();
          if (!/^data:([^;,\s]+);base64,[A-Za-z0-9+/=\s]+$/i.test(inlineB64)) return null;
          return {
            name: String(att?.name || `image-${idx + 1}.png`).trim(),
            mimeType: String(att?.mimeType || 'image/png').trim(),
            base64: inlineB64
          };
        });
      const allInlineRecoverable = rawAtts.length > 0 && !inlineRestoreList.some((x) => !x);
      if (isBgSwitch) {
        if (!allInlineRecoverable) {
          return {
            ok: false,
            mediaRecoveryUnavailable: true,
            error: '后台会话切回桌面原会话会清空临时输入区附件，当前无法无损提取完整附件数据，已取消撤回以避免丢失附件'
          };
        }
        const clickBtn = target.editBtn || target.deleteBtn;
        if (!clickBtn) return { ok: false, error: '未找到桌面端排队消息编辑/删除按钮' };
        clickBtn.click();
        return {
          ok: true,
          source: 'dom',
          editedText: cleanText,
          editedAttachments: inlineRestoreList.map((item) => ({
            name: item.name,
            mimeType: item.mimeType,
            size: 0,
            isImage: /^image\//i.test(item.mimeType),
            previewUrl: /^image\//i.test(item.mimeType) ? item.base64 : ''
          })),
          stageableAttachments: inlineRestoreList
        };
      }
      if (target.editBtn) {
        if (!editedAttachments.length) {
          return { ok: false, mediaRecoveryUnavailable: true, error: '该排队消息包含媒体附件，但未能获取可恢复的附件元数据，已取消撤回以避免丢失附件' };
        }
        target.editBtn.click();
        return {
          ok: true,
          source: 'dom',
          nativeEditRestored: true,
          editedText: cleanText,
          editedAttachments
        };
      }
      if (!target.deleteBtn) return { ok: false, error: '未找到桌面端排队消息编辑/删除按钮' };
      if (!allInlineRecoverable) {
        return { ok: false, mediaRecoveryUnavailable: true, error: '该排队消息包含媒体附件且无原生编辑按钮，无法完整恢复附件数据，已取消撤回以避免丢失附件' };
      }
      const beforeRemoveBtns = new Set(findComposerAttachmentRemoveButtons());
      const rollbackEditInjected = () => {
        const newlyAdded = findComposerAttachmentRemoveButtons().filter((b) => !beforeRemoveBtns.has(b));
        for (const btn of newlyAdded) {
          try { btn.click(); } catch {}
        }
      };
      const restoredMeta = [];
      for (let i = 0; i < inlineRestoreList.length; i += 1) {
        const item = inlineRestoreList[i];
        const upRes = await injectUploadedFileToDesktopComposer(item.name, item.mimeType, item.base64);
        if (!upRes?.ok) {
          rollbackEditInjected();
          return {
            ok: false,
            mediaRecoveryUnavailable: true,
            error: upRes?.error || '恢复附件至桌面端输入框失败，已取消删除原排队消息'
          };
        }
        restoredMeta.push({
          name: upRes.name || item.name,
          mimeType: upRes.mimeType || item.mimeType,
          size: Number(upRes.size || 0),
          isImage: /^image\//i.test(upRes.mimeType || item.mimeType),
          previewUrl: item.base64
        });
      }
      target.deleteBtn.click();
      return {
        ok: true,
        source: 'dom',
        editedText: cleanText,
        editedAttachments: restoredMeta
      };
    }

    if (action === 'delete-queued-dom') {
      const entries = await ensureQueuedMessagesExpanded(findQueuedMessagesDomEntries(), 'deleteBtn');
      const resolved = resolveStrictQueuedDomTarget(entries, payload, '删除');
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const target = resolved.target;
      if (!target.deleteBtn) return { ok: false, error: '未找到桌面端排队消息删除按钮' };
      target.deleteBtn.click();
      return { ok: true, source: 'dom' };
    }

    return { ok: false, error: `未知操作: ${action}` };
  }

  let mobileActionQueue = Promise.resolve();
  let mobileBgSwitchDepth = 0;

  function performMobileAction(payload) {
    const run = mobileActionQueue.then(() => performMobileActionInner(payload));
    mobileActionQueue = run.catch(() => {});
    return run;
  }

  async function performMobileActionInner(payload) {
    const action = String(payload?.action || '').trim();
    if (!action) return { ok: false, error: '缺少 action 参数' };

    const scopedActions = ['send', 'fill', 'stop', 'click-approval', 'respond-prompt', 'select-model', 'select-permission', 'upload-image', 'remove-uploaded-attachment', 'send-queued-dom', 'edit-queued-dom', 'delete-queued-dom'];
    const reqConvId = String(payload?.conversationId || '').trim();
    const prevConvId = getSessionIdFromLocation() || '';

    // 方案 B：隔离态新建对话草稿在首次发送时才按需切桌面新建并发送，结束后自动恢复桌面原会话或原新对话页
    if (action === 'send' && reqConvId === '__new__' && payload?.draftNewIsolated === true) {
      mobileBgSwitchDepth += 1;
      const draftProjectId = String(payload?.draftProjectId || payload?.projectId || '').trim();
      const prevSearch = String(location?.search || '');
      let prevProjectId = parseProjectIdFromHref(prevSearch);
      if (!prevProjectId && typeof getActiveProjectMeta === 'function') {
        try { prevProjectId = String(getActiveProjectMeta()?.id || '').trim(); } catch {}
      }
      let createdConversationId = '';
      let actionOutcome = null;
      let actionThrown = null;
      let restoreDesktopOk = true;
      let restoreDesktopError = '';
      try {
        const navNew = await executeMobileActionCore('new-conversation', { projectId: draftProjectId });
        if (!navNew?.ok) {
          actionOutcome = navNew || { ok: false, error: '新建对话失败' };
        } else {
          await new Promise((r) => setTimeout(r, 120));
          const pendingUploads = Array.isArray(payload?.draftPendingUploads) ? payload.draftPendingUploads : [];
          let uploadFailedOutcome = null;
          if (pendingUploads.length > 0) {
            for (const att of pendingUploads) {
              const upRes = await executeMobileActionCore('upload-image', att);
              if (!upRes?.ok) {
                uploadFailedOutcome = upRes || { ok: false, error: '草稿附件上传失败，请重试' };
                break;
              }
            }
            if (!uploadFailedOutcome) {
              await new Promise((r) => setTimeout(r, 60));
            }
          }
          if (uploadFailedOutcome) {
            actionOutcome = uploadFailedOutcome;
          } else {
            const sendRes = await executeMobileActionCore('send', payload);
            if (!sendRes?.ok) {
              actionOutcome = sendRes || { ok: false, error: '发送消息失败' };
            } else {
              // 等待新会话 ID 出现在路由中，便于远程端绑定到新对话
              const maxPoll = Number(payload?._testPollTries) > 0 ? Number(payload._testPollTries) : 15;
              const pollGap = Number(payload?._testPollDelayMs) >= 0 ? Number(payload._testPollDelayMs) : 100;
              for (let i = 0; i < maxPoll; i++) {
                const curId = getSessionIdFromLocation() || '';
                if (curId && curId !== prevConvId && curId !== '__new__') {
                  createdConversationId = curId;
                  break;
                }
                if (pollGap > 0) await new Promise((r) => setTimeout(r, pollGap));
              }
              actionOutcome = {
                ...sendRes,
                createdConversationId,
                projectId: draftProjectId
              };
            }
          }
        }
      } catch (err) {
        actionThrown = err;
      } finally {
        if (payload?.restoreDesktop !== false) {
          try {
            const curId = getSessionIdFromLocation() || '';
            if (prevConvId) {
              if (curId !== prevConvId) {
                await new Promise((r) => setTimeout(r, 60));
                let r = await executeMobileActionCore('switch-conversation', { id: prevConvId });
                if (!r?.ok) {
                  r = await switchToConversationInternal(prevConvId);
                }
                if (r && r.ok === false) {
                  restoreDesktopOk = false;
                  restoreDesktopError = String(r.error || '未能恢复桌面原会话');
                }
              }
            } else {
              const curPid = parseProjectIdFromHref(String(location?.search || ''));
              if (curId || curPid !== prevProjectId) {
                await new Promise((r) => setTimeout(r, 60));
                const r = await executeMobileActionCore('new-conversation', { projectId: prevProjectId });
                if (r && r.ok === false) {
                  restoreDesktopOk = false;
                  restoreDesktopError = String(r.error || '未能恢复桌面原新对话页');
                }
              }
            }
          } catch (restoreErr) {
            restoreDesktopOk = false;
            restoreDesktopError = String(restoreErr?.message || restoreErr || '恢复桌面窗口异常');
          }
        }
        mobileBgSwitchDepth = Math.max(0, mobileBgSwitchDepth - 1);
      }
      if (actionThrown) {
        return {
          ok: false,
          error: String(actionThrown?.message || actionThrown || '发送消息异常'),
          restoreDesktopOk,
          ...(restoreDesktopError ? { restoreDesktopError } : {})
        };
      }
      return {
        ...(actionOutcome || { ok: false, error: '未知错误' }),
        restoreDesktopOk,
        ...(restoreDesktopError ? { restoreDesktopError } : {})
      };
    }

    const needsSwitch = Boolean(
      scopedActions.includes(action) &&
      reqConvId &&
      reqConvId !== '__new__' &&
      reqConvId !== prevConvId
    );

    if (!needsSwitch) {
      return await executeMobileActionCore(action, payload);
    }

    mobileBgSwitchDepth += 1;
    try {
      const sw = await switchToConversationInternal(reqConvId);
      if (!sw?.ok) return sw;
      await new Promise((r) => setTimeout(r, 150));

      return await executeMobileActionCore(action, { ...payload, _isBackgroundSwitch: true });
    } finally {
      try {
        if (prevConvId && prevConvId !== reqConvId && payload?.restoreDesktop !== false) {
          await new Promise((r) => setTimeout(r, 120));
          await switchToConversationInternal(prevConvId).catch(() => {});
        }
      } finally {
        mobileBgSwitchDepth = Math.max(0, mobileBgSwitchDepth - 1);
      }
    }
  }

    globalThis.__AGEnhancer = {
    version: '1.7.9',
    isAlive: () => {
      if (disposed) return false;
      const { sr } = getMeterHostAndShadow();
      return Boolean(sr && sr.getElementById(QUOTA_BADGE_ID) && sr.getElementById(REMOTE_BADGE_ID));
    },
    refreshQuota,
    toggleQuotaPopover,
    closeQuotaPopover: () => toggleQuotaPopover(false),
    toggleRemotePopover,
    closeRemotePopover: () => toggleRemotePopover(false),
    configureRemoteTunnel,
    refreshBrainStats,
    scanHighRiskCommands,
    toggleAllThinking,
    guardExpandedThinkingBlocks,
    enterFileEditor,
    saveFileEditor,
    exitFileEditor,
    isAssistantBusy,
    computeNextStepCandidatesFromText,
    truncateNextStepText,
    ensureNextStepGhost,
    acceptNextStepSuggestion,
    cycleNextStepSuggestion,
    getNextStepState: () => ({ ...nextStepState, candidates: [...nextStepState.candidates] }),
    ensurePromptOptimizerControls,
    optimizeComposerPrompt,
    undoPromptOptimize,
    getLastPromptOptError: () => (promptOptState.lastError
      ? { ...promptOptState.lastError, attempts: [...(promptOptState.lastError.attempts || [])] }
      : null),
    getPromptOptModels: () => ({
      ...promptOptState.cacheModel,
      candidates: [...(promptOptState.cacheModel.candidates || [])]
    }),
    syncRemotePairData,
    getMobileSnapshot,
    getMobileSnapshotAsync,
    performMobileAction,
    extractExternalUrlFromTarget,
    openExternalUrlInSystemBrowser,
    getBrainStats: () => latestBrainStats,
    getAutoAccept: () => autoAcceptEnabled,
    setAutoAccept: (val) => {
      autoAcceptEnabled = Boolean(val);
      try { localStorage.setItem('ag_suite_auto_accept', autoAcceptEnabled ? 'true' : 'false'); } catch {}
      if (autoAcceptEnabled) runAutoAcceptTick();
    },
    getGhostSuggest: () => ghostSuggestEnabled,
    setGhostSuggest: (val) => {
      ghostSuggestEnabled = Boolean(val);
      try { localStorage.setItem('ag_suite_ghost_suggest', ghostSuggestEnabled ? 'true' : 'false'); } catch {}
      if (!ghostSuggestEnabled) hideNextStepGhost();
      else ensureNextStepGhost();
    },
    getAutoCompact: () => autoCompactEnabled,
    setAutoCompact: (val) => {
      autoCompactEnabled = Boolean(val);
      try { localStorage.setItem('ag_suite_auto_compact', autoCompactEnabled ? 'true' : 'false'); } catch {}
      if (!autoCompactEnabled) autoCompactState.idleSince = 0;
    },
    getQuickBuiltinAutoSend: () => quickBuiltinAutoSendEnabled,
    setQuickBuiltinAutoSend: (val) => {
      quickBuiltinAutoSendEnabled = Boolean(val);
      try { localStorage.setItem('ag_suite_quick_builtin_autosend', quickBuiltinAutoSendEnabled ? 'true' : 'false'); } catch {}
      const bar = document.getElementById(QUICK_BAR_ID);
      if (bar) syncQuickBarActionButtons(bar);
    },
    runAutoCompactTick,
    getFeatureFlags: () => ({ ...featureFlags }),
    getQuickPool: () => ({ ...quickPoolState }),
    fillComposerText,
    parseQuotaSummaryGroups,
    exportMarkdown,
    localizeSidebarConversations,
    localizeThinkingShells,
    translateExpandedThoughts,
    syncSidebarShortcutBadges,
    switchConversationByIndex: switchSidebarConversationByIndex,
    cycleConversation: cycleSidebarConversation,
    countDistinctPendingApprovals,
    getDockStateSnapshot,
    tickDockStateForTest,
    dispose
  };

  applyEnhancerFeatureVisibility();
  ensurePromptOptimizerControls();
  ensureNextStepGhost();
  ensureFileViewerEditor();
  syncSidebarShortcutBadges();
  scanHighRiskCommands();
  renderQuotaUI();
  guardExpandedThinkingBlocks();
  startLocalizationObserver();
  if (uiLang !== 'en') {
    localizeThinkingShells();
    void translateExpandedThoughts();
    void localizeSidebarConversations();
  } else {
    revertEnhancerTranslations();
  }
  lastQuotaFetchAt = Date.now();
  lastRemoteFetchAt = Date.now();
  if (featureFlags.showTopbarQuota !== false) void refreshQuota({ silent: true });
  if (featureFlags.showTopbarRemote !== false) void refreshRemotePairInfo(false);
})();
