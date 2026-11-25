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
    '暂时无法连接更新服务器，请检查网络或代理设置后重试': 'Unable to reach the update server; check your network or proxy and try again'
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
    ['p-det-subtier-readonly', 'p-det-country', 'p-det-region', 'p-det-currency'].forEach(id => {
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
    const chkQuickBuiltinAutoSend = el('set-quick-builtin-autosend');
    const chkEngLbl = el('set-english-labels');
    if (chkAuto) chkAuto.checked = Boolean(suiteEnhancerPrefs.autoAccept);
    if (chkGhost) chkGhost.checked = Boolean(suiteEnhancerPrefs.ghostSuggest);
    if (chkCompact) chkCompact.checked = suiteEnhancerPrefs.autoCompact !== false;
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

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('ag-suite-prefs-changed', ev => {
        if (ev?.detail && ('locale' in ev.detail || 'hansCode' in ev.detail || 'capsuleLang' in ev.detail)) {
          const incoming = findSupportedLocaleEntry(ev.detail.locale || ev.detail.hansCode || ev.detail.capsuleLang);
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
      });
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
        '请手动打开「系统设置 → 隐私与安全性 → 辅助功能」，在列表中开启 Antigravity（若是用终端启动则开启对应终端）的权限',
        'Open System Settings → Privacy & Security → Accessibility manually and enable permission for Antigravity (or your terminal if launched from terminal).',
        'warn',
        false
      );
      return;
    }
    try {
      const res = await invokeHostBridge('/dock-badge-open-ax', {}, 'dockBadgeOpenAx');
      if (res && res.ok) {
        setDockBadgeStatusNote(
          '已打开「系统设置 → 隐私与安全性 → 辅助功能」，请在列表中开启 Antigravity（若是用终端启动则开启对应终端）的权限，几秒后自动生效',
          'Opened System Settings → Privacy & Security → Accessibility. Enable permission for Antigravity (or your terminal if launched from terminal); it takes effect in a few seconds.',
          'warn',
          false
        );
      } else {
        setDockBadgeStatusNote(
          '未能自动打开系统设置，请手动前往「系统设置 → 隐私与安全性 → 辅助功能」，开启 Antigravity（或对应终端）的权限',
          'Could not open System Settings automatically. Manually open System Settings → Privacy & Security → Accessibility and enable permission for Antigravity.',
          'warn',
          false
        );
      }
    } catch {
      setDockBadgeStatusNote(
        '无法打开系统设置，请手动前往「系统设置 → 隐私与安全性 → 辅助功能」，开启 Antigravity（或对应终端）的权限',
        'Unable to open System Settings. Manually open System Settings → Privacy & Security → Accessibility and enable permission for Antigravity.',
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

  el('btn-reset-feature-toggles')?.addEventListener('click', () => {
    void setSuiteFeatureFlags({ ...DEFAULT_SUITE_FEATURE_FLAGS });
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
