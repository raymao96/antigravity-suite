(() => {
  if (typeof window === 'undefined') return;
  const PATCH_FINGERPRINT = 'app-2.35.1-20261127-r50-zhtw22';
  const fingerprint = window.__antigravityZhPatchRequestedFingerprint || PATCH_FINGERPRINT;
  if (window.__antigravityZhPatchInstalled === true && window.__observedDocument === document && window.__antigravityZhPatchFingerprint === fingerprint) return;
  const updating = window.__antigravityZhPatchInstalled === true && window.__observedDocument === document;
  if (typeof window.__antigravityZhPatchCleanup === 'function') window.__antigravityZhPatchCleanup();
  if (Array.isArray(window.__antigravityZhPatchCleanups)) {
    for (const cleanupFn of window.__antigravityZhPatchCleanups.splice(0)) {
      try { if (typeof cleanupFn === 'function') cleanupFn(); } catch {}
    }
  }
  window.__antigravityZhPatchInstalled = true;
  window.__observedDocument = document;
  window.__antigravityZhPatchFingerprint = fingerprint;
  let observer;
  let cancelled = false;
  let flushScheduler;
  let removeToggleUI = null;
  let removePreferenceSync = null;
  let removeSuitePrefsListener = null;
  let ideNlsChanges = [];
  const cleanupRegistry = Array.isArray(window.__antigravityZhPatchCleanups)
    ? window.__antigravityZhPatchCleanups
    : (window.__antigravityZhPatchCleanups = []);
  const cleanupInstance = () => {
    cancelled = true;
    observer?.disconnect();
    window.removeEventListener('DOMContentLoaded', run);
    flushScheduler?.cancel();
    restoreIdeNlsMessages();
    restoreNativeArrayMap();
    removePreferenceSync?.();
    removeSuitePrefsListener?.();
    removeToggleUI?.();
    if (window.__antigravityZhSetLang === setLang) delete window.__antigravityZhSetLang;
    if (window.__antigravityZhGetLang) delete window.__antigravityZhGetLang;
    if (window.__antigravityZhSetEnglishLabels === setEnglishLabels) delete window.__antigravityZhSetEnglishLabels;
    if (window.__antigravityZhGetEnglishLabels) delete window.__antigravityZhGetEnglishLabels;
  };
  window.__antigravityZhPatchCleanup = cleanupInstance;
  cleanupRegistry.push(cleanupInstance);

  // ===== 中英切换：记录每个被改写节点的原文，切回英文时按原样还原 =====
  // WeakMap 挂在 window 上，词库热更新后新实例仍能还原旧实例翻译过的节点。
  const LANG_KEY = 'antigravityHansLang';
  const SUITE_LOCALE_KEY = 'ag_suite_locale';
  const POS_KEY = 'antigravityHansTogglePosV2';
  const originals = window.__antigravityZhOriginals ||
    (window.__antigravityZhOriginals = { texts: new WeakMap(), attrs: new WeakMap() });

  // 偏好持久化（localStorage）
  function loadPref(key) {
    try { return window.localStorage?.getItem(key) ?? null; } catch (_e) { return null; } // data: 页面无 localStorage
  }
  function savePref(key, value) {
    try { window.localStorage?.setItem(key, value); } catch (_e) { /* ignore */ }
  }

  function resolveInitialHansLang() {
    const hansSaved = String(loadPref(LANG_KEY) || '').trim();
    if (/^en/i.test(hansSaved)) return 'en';
    if (/^(?:zh-tw|zh-hant|zh-hk|tw)\b/i.test(hansSaved)) return 'zh-TW';
    const suiteSaved = String(loadPref(SUITE_LOCALE_KEY) || '').trim();
    if (suiteSaved) {
      if (/^(?:zh-tw|zh-hant|zh-hk|tw)\b/i.test(suiteSaved)) return 'zh-TW';
      if (/^(?:zh|cn)/i.test(suiteSaved)) return 'zh';
      return hansSaved === 'zh' ? 'zh' : (hansSaved === 'zh-TW' ? 'zh-TW' : 'en');
    }
    return 'zh-TW';
  }
  let lang = resolveInitialHansLang();
  let originalDocLang = null;

  function isChineseLang(code = lang) {
    return code === 'zh' || code === 'zh-TW';
  }

  const __AG_ZH_TW_PHRASE_MAP = {"哪里":"哪裡","这里":"這裡","导航面包屑":"麵包屑導覽","面包屑":"麵包屑","左右并排布局":"左右並排版面設定","布局":"排版","串口":"序列埠","设备":"裝置","設備":"裝置","智能芯片":"智慧型方塊","芯片":"晶片","浏览器扩展":"瀏覽器擴充功能","导航":"導覽","導航":"導覽","访问":"存取","訪問":"存取","访问我们":"造訪我們","訪問我們":"造訪我們","存储桶":"儲存桶","存儲桶":"儲存桶","连接方式":"連線方式","电脑端":"電腦端","手机远程":"手機遠端","配对口令":"配對碼","运行时":"執行環境","软链":"符號連結","自启":"自動啟動","重试":"重試","就绪":"就緒","公网":"公開網路","内网":"內部網路","打印手机":"顯示手機","免改盘":"免改包","终端命令":"終端機指令","重新加载":"重新載入","检测连接":"偵測連線","多路复用器":"多工器","正则表达式":"正規表示式","未检测到":"未偵測到","自动默认":"自動預設","配置文件":"設定檔","命令提示符":"命令提示字元","每条命令都需要审核":"每條指令都需要核准","每条命令均需审批":"每條指令都需要核准","执行敏感操作前先询问":"執行敏感動作前先詢問","在执行敏感操作前询问":"執行敏感動作前先詢問","对敏感操作请求授权许可":"執行敏感動作前需取得授權","由安全智能体决定是否运行命令":"由安全 Agent 決定是否執行指令","自动判断是否运行命令":"自動判斷是否執行指令","自动决定是否运行命令":"自動判斷是否執行指令","不受限制地运行所有命令":"不受限制地執行所有指令","无限制运行所有命令":"不受限制地執行所有指令","敏感操作":"敏感動作","执行命令":"執行指令","运行命令":"執行指令","命令执行":"指令執行","命令面板":"指令面板","命令选择器":"指令選擇器","命令状态":"指令狀態","命令访问权限":"指令存取權限","复制命令":"複製指令","完整命令":"完整指令","输入命令":"輸入指令","搜索命令":"搜尋指令","斜杠命令":"斜線指令","子系统":"子系統","文件夹":"資料夾","复选框":"核取方塊","下拉框":"下拉選單","工具栏":"工具列","侧边栏":"側邊欄","状态栏":"狀態列","标题栏":"標題列","地址栏":"網址列","活动栏":"活動列","导航栏":"導覽列","标签页":"分頁","对话框":"對話方塊","剪贴板":"剪貼簿","快捷键":"快速鍵","回车":"Enter","回車":"Enter","命令行":"命令列","控制台":"主控台","客户端":"用戶端","桌面端":"桌面版","移动端":"行動版","网页端":"網頁版","服务器端":"伺服器端","服务器":"伺服器","占位符":"預留位置","通配符":"萬用字元","分辨率":"解析度","返回值":"回傳值","字符串":"字串","智能体":"Agent","热力图":"熱度圖","快捷提示词":"常用提示詞","快捷操作栏":"常用工具列","快捷按钮":"指令按鈕","快捷指令":"常用指令","快捷口令":"常用指令","快捷方式":"捷徑","快捷":"快速","按点击付费":"按點擊付費","点击":"點選","日常高频":"日常常用","追问对齐":"追問釐清","全部对齐":"全部釐清","提炼经验":"歸納經驗","提炼":"歸納","深度攻坚":"深度解題","复杂攻坚":"複雜任務","攻坚":"突破","定时任务":"排程任務","定时计划":"排程計畫","定时巡检":"排程巡檢","定时轮询":"排程輪詢","定时运行":"排程執行","定时后台":"背景排程","定时器":"計時器","5h 滚动窗口":"5 小時限額","5h 滚动":"5 小時限額","滚动窗口":"分時段","滚动条":"捲軸","滚动":"捲動","周边":"周邊","周邊":"周邊","周围":"周圍","周圍":"周圍","周全":"周全","周密":"周密","周到":"周到","圆周":"圓周","圓周":"圓周","周长":"周長","周長":"周長","周知":"周知","免审核":"免審核","待审批":"待審核","二进制":"二進位","自定义":"自訂","只读":"唯讀","仅限":"僅限","仅显示":"僅顯示","仅用于":"僅用於","默认值":"預設值","初始化":"初始化","上下文":"上下文","响应式":"響應式","高危":"高風險","审批":"審核","菜单":"選單","弹窗":"彈出視窗","浮窗":"懸浮視窗","窗口":"視窗","屏幕":"螢幕","鼠标":"滑鼠","图标":"圖示","角标":"徽章","标签":"標籤","书签":"書籤","字体":"字型","内存":"記憶體","缓存":"快取","软件":"軟體","硬件":"硬體","文档":"文件","文件":"檔案","默认":"預設","设置":"設定","配置":"設定","终端":"終端機","重启":"重新啟動","刷新":"重新整理","卸载":"解除安裝","新建":"新增","添加":"新增","保存":"儲存","加载":"載入","导入":"匯入","导出":"匯出","搜索":"搜尋","查找":"尋找","替换":"取代","撤销":"復原","重置":"重設","清空":"清理","清除":"清理","过滤":"篩選","拖拽":"拖曳","粘贴":"貼上","拷贝":"複製","复制":"複製","重复":"重複","复杂":"複雜","复用":"重複使用","回复":"回覆","恢复":"恢復","复原":"復原","复核":"複核","复盘":"覆盤","复现":"重現","修复":"修復","支持":"支援","兼容":"相容","数据":"資料","元数据":"中繼資料","调用":"呼叫","连接器":"連接器","连接":"連線","创建":"建立","响应":"回應","内置":"內建","全局":"全域","本地":"本機","本机":"本機","远程":"遠端","远端":"遠端","后台":"背景","前台":"前景","实时":"即時","异步":"非同步","并发送":"並傳送","并发布":"並發布","并发现":"並發現","并发展":"並發展","并发起":"並發起","并发":"並行","合并":"合併","并行":"平行","并排":"並排","通过":"透過","用户":"使用者","登录":"登入","注销":"登出","账号":"帳號","账户":"帳戶","链接":"連結","视频":"影片","音频":"音訊","图像":"影像","文本":"文字","字符":"字元","字节":"位元組","信息":"資訊","消息":"訊息","反馈":"回饋","交互":"互動","崩溃":"當機","卡死":"卡住","报错":"錯誤","超时":"逾時","端口":"連接埠","域名":"網域","协议":"通訊協定","网络":"網路","带宽":"頻寬","磁盘":"磁碟","硬盘":"硬碟","插件":"外掛","汉化":"中文化","代码":"程式碼","项目":"專案","仓库":"儲存庫","归档":"封存","运行":"執行","调试":"除錯","今天想构建什么？":"今天想打造什麼？","构建":"建置","组件":"元件","模块":"模組","依赖":"相依套件","变量":"變數","常量":"常數","函数":"函式","接口":"介面","数组":"陣列","对象":"物件","布尔":"布林","回调":"回呼","进程":"處理程序","處理程序":"處理程序","线程":"執行緒","队列":"佇列","缩进":"縮排","后缀":"副檔名","套餐方案":"方案","套餐":"方案","概览":"總覽","积分":"點數","润色":"潤飾","剩余":"剩餘","占用":"佔用","兜底":"備援","启用":"啟用","启动":"啟動","开启":"開啟","禁用":"停用","地址":"位址","网址":"網址","打印":"列印","检测":"偵測","校验":"驗證","渲染":"算繪","高亮":"醒目提示","折叠":"摺疊","计划":"計畫","脚本":"指令碼","程序":"程式","内核":"核心","批注":"註解","教程":"教學","联系":"聯絡","关系":"關係","体系":"體系","系统":"系統","在线":"線上","离线":"離線","帮助":"說明","定制":"客製","制作":"製作","录制":"錄製","绘制":"繪製","控制":"控制","限制":"限制","强制":"強制","机制":"機制","干预":"干預","干預":"干預","干扰":"干擾","干擾":"干擾","干净":"乾淨","回滚":"還原","邮箱":"電子郵件","昵称":"暱稱","头像":"大頭貼","令牌":"權杖","密钥":"金鑰","汇总":"彙總","游戏":"遊戲","下游":"下游","上游":"上游","台币":"新台幣","中国台湾":"台灣","台湾":"台灣","占位":"預留位置","独占":"獨佔","其余":"其餘","多余":"多餘","轻松":"輕鬆","宽松":"寬鬆","松开":"放開","切换":"切換","刷新并":"重新整理並","当前":"目前","里面":"裡面","界面":"介面","页面":"頁面","面板":"面板","桌面":"桌面","下面":"下方","上面":"上方","后面":"後方","前面":"前方","全面":"全面","方面":"方面","浏览":"瀏覽","浏览器":"瀏覽器","编辑":"編輯","编辑器":"編輯器","评论":"留言","发送":"傳送","跳过":"略過","暂停":"暫停","继续":"繼續","取消":"取消","确定":"確定","确认":"確認","关闭":"關閉","打开":"開啟","删除":"刪除","移除":"移除","隐藏":"隱藏","显示":"顯示","展开":"顯示","收起":"摺疊","收拢":"摺疊","折叠态":"摺疊狀態","同步":"同步","上传":"上傳","下载":"下載","更新":"更新","升级":"升級","安装":"安裝","权限":"權限","隐私":"隱私","安全":"安全","异常":"異常","失败":"失敗","成功":"成功","警告":"警告","提示":"提示","通知":"通知","状态":"狀態","统计":"統計","分析":"分析","历史":"歷史","日历":"行事曆","工作区":"工作區","工作台":"工作台","工作流":"工作流程","工作流程":"工作流程","任务":"任務","会话":"工作階段","对话":"對話","聊天":"聊天","标题":"標題","内容":"內容","详情":"詳細資訊","列表":"清單","表单":"表單","按钮":"按鈕","开关":"開關","选项":"選項","参数":"參數","属性":"屬性","格式":"格式","样式":"樣式","主题":"佈景主題","配色":"配色","强调色":"強調色","浅色":"淺色","深色":"深色","暗色":"深色","亮色":"淺色","预览":"預覽","草稿":"草稿","快照":"快照","提交":"提交","分支":"分支","差异":"差異","冲突":"衝突","拉取":"拉取","推送":"推送","克隆":"複製","模型":"模型","推理":"推理","思考":"思考","额度":"額度","配额":"配額","订阅":"訂閱","费用":"費用","价格":"價格","汇率":"匯率","货币":"貨幣","国家":"國家","地区":"地區","语言":"語言","简体中文":"簡體中文","繁体中文":"繁體中文","英文":"英文","原文":"原文","译文":"譯文","翻译":"翻譯","词典":"詞典","词库":"詞庫","日志":"日誌","记录":"記錄","规则":"規則","策略":"策略","模式":"模式","档位":"等級","级别":"層級","阈值":"門檻值","上限":"上限","下限":"下限","速率":"速率","速度":"速度","延迟":"延遲","耗时":"耗時","时长":"時間長度","分钟":"分鐘","小时":"小時","秒":"秒","毫秒":"毫秒","自动":"自動","手动":"手動","批量":"批次","单次":"單次","全局脚本":"全域指令碼","环境变量":"環境變數","代理":"代理","隧道":"通道","扫码":"掃碼","二维码":"QR Code","蓝牙":"藍牙","触控":"觸控","辅助功能":"輔助使用","系统设置":"系統設定","偏好设置":"偏好設定","常见":"常見","推荐":"推薦","必开":"必開","可选":"選用","其他":"其他","未知":"未知","暂无":"暫無","未提供":"未提供","未填写":"未填寫","已启用":"已啟用","已停用":"已停用","已关闭":"已關閉","已保存":"已儲存","已复制":"已複製","已连接":"已連線","未连接":"未連線","正在":"正在","完成":"完成","准备":"準備","知识工作":"日常辦公","常规":"一般","编程语言":"程式語言","编程":"程式開發","获取":"取得","流式":"串流","高级":"進階","许可证":"授權條款","凭据":"憑證","性能":"效能","全屏":"全螢幕","激活":"啟用","质量":"品質","代码补全":"程式碼自動完成","自动补全":"自動完成","补全":"自動完成","转写":"轉錄","首选项":"偏好設定","网关":"閘道","录屏":"螢幕錄製","光标":"游標","剪切":"剪下","集群":"叢集","扩展程序":"擴充功能","扩展市场":"擴充功能市集","已安装扩展":"已安裝擴充功能","扩展名":"副檔名","取消固定":"取消釘選","已固定":"已釘選","固定此对话":"釘選此對話","固定对话":"釘選對話","仅固定会话":"僅釘選對話","自动固定":"自動釘選","排队消息":"佇列訊息","排队":"佇列","适用于代理模式":"適用於 Agent 模式","没有正在运行的代理":"沒有正在執行的 Agent","个代理正在运行":"個 Agent 正在執行","将在代理完成后发送":"將在 Agent 完成後傳送","局域网":"區域網路","批准":"核准","核准":"核准","获准":"獲准","獲准":"獲准","准许":"准許","准許":"准許","允准":"允准","准予":"准予","不准":"不准","周期":"週期","新台币":"新台幣","币种":"幣別","按已返回用量估算":"依實際用量估算","已返回用量":"實際回傳用量","仅返回":"僅回傳","未返回":"未回傳","已返回":"已回傳","模型返回":"模型回傳","服务端返回":"伺服器回傳","状态返回":"狀態回傳","自动跟随当前模型":"自動跟隨目前模型","侧栏：模型额度卡":"側欄：模型額度卡","自定义本地字体":"自訂本機字型","侧边栏模型额度":"側邊欄模型額度","纯白 / 炭黑":"純白／炭黑","顶栏配额胶囊":"頂欄配額膠囊","当前模型组":"目前模型群組","其他模型组":"其他模型群組","固定仅显示":"固定僅顯示","连续进度条":"連續進度條","精简刻度":"精簡刻度","进度细线":"進度細線","迷你五段":"迷你五段","迷你圆环":"迷你圓環","双列横条":"雙列橫條","路由死锁":"路由死鎖","开启完整":"開啟完整","额度全满":"額度全滿","发起旁路提问，不打断主会话":"提出延伸問題，不中斷主要對話","新建旁路提问":"新增延伸提問","将截图添加到会话":"將截圖加入對話","检查元素并添加评论":"檢查元素並新增留言","退出元素检查模式":"離開元素檢查模式","查看网站信息":"檢視網站資訊","查看全部说明":"查閱完整說明","查看更多结果":"顯示更多結果","查看更多":"瀏覽更多","查看全部":"顯示全部","查看文档":"查閱文件","查閱文件":"查閱文件","查看发行说明":"閱讀發行說明","查看套餐方案":"瀏覽方案","查看方案":"瀏覽方案","查看模型用量":"查詢模型用量","查看用量":"查詢用量","查看忙闲状态":"查詢忙閒狀態","查看":"檢視","订阅方案与档位覆盖 · 可手动指定套餐或保持自动检测":"手動指定訂閱方案與等級，或維持自動偵測","订阅方案与档位覆盖":"指定訂閱方案與等級","跟随当前登录账号":"依目前登入的帳號判定","每周基础配额":"每週基本額度","入门配额":"入門額度","5h 基准配额":"5 小時基準額度","Pro 配额":"Pro 額度","搜索订阅方案":"搜尋訂閱方案","未找到匹配的订阅方案":"找不到符合的訂閱方案","子档未定":"尚未確認等級","子档未知":"尚未確認等級","待选子档":"請選擇 Ultra 等級","已自动识别":"已自動辨識","自动识别":"自動辨識","未识别/默认":"無法辨識，使用預設值","地区参考价":"地區參考價格","套餐可用":"方案可用","当前套餐无权访问该模型":"目前方案無法使用此模型","请求中断":"請求已中斷","最近一次生成请求已中断，无法仅凭此记录确定取消来源或当前请求状态":"最近一次生成請求已中斷。單憑這筆記錄無法判斷取消來源或目前的請求狀態","共享池":"共用額度池","取消置顶":"取消釘選","五段格":"五段格","双圆环":"雙圓環","仪表盘":"儀表板","纯文字":"純文字","后重置":"後重設","点阵":"點陣","炭黑":"炭黑","置顶":"釘選","“":"「","”":"」","‘":"『","’":"』","修改提交成功":"已修改提交","自动展开代码更改概览":"自動顯示程式碼更改總覽","当智能体完成回复生成时，自动展开代码更改概览工具栏。":"當 Agent 完成回覆生成時，自動顯示程式碼更改總覽工具列。","提交成功":"已提交","连接失败":"無法連線","连接成功":"已連線","展开（按住 Shift 点击可展开下方所有层级）":"顯示（按住 Shift 點選可顯示下方所有層級）","全部展开":"全部顯示","全部展开文件夹":"全部顯示資料夾","展开排队中的消息":"顯示佇列中的訊息","展开子智能体":"顯示子 Agent","添加插件失败。":"無法新增外掛。","添加插件失败。请重试。":"無法新增外掛。請重試。","修改提交失败":"無法修改提交","归档工作区失败":"無法封存工作區","构建失败":"無法建置","提交失败":"無法提交","继续操作失败":"無法繼續操作","复制失败：":"無法複製：","创建 CitC 克隆工作区失败":"無法建立 CitC 複製工作區","创建终端失败":"無法建立終端機","创建工作区失败。":"無法建立工作區。","创建工作树失败":"無法建立工作樹","删除会话失败":"無法刪除工作階段","编辑失败":"無法編輯","执行失败":"無法執行","派生分支会话失败":"無法派生分支工作階段","生成提交信息失败":"無法生成提交資訊","打印文档失败":"無法列印文件","打印文档失败：":"無法列印文件：","继续执行失败":"無法繼續執行","推送失败":"無法推送","读取失败":"無法讀取","读取文件内容失败":"無法讀取檔案內容","重命名会话失败":"無法重命名工作階段","重新验证斜杠命令失败：":"無法重新驗證斜線指令：","保存项目失败":"無法儲存專案","启动多候选对决模式失败":"無法啟動多候選對決模式","启动会话失败":"無法啟動工作階段","停止智能体失败":"無法停止 Agent ","停止会话失败":"無法停止工作階段","模型摘要生成失败":"無法模型摘要生成","项目根目录":"專案最上層資料夾","推送成功":"已推送","收起部分资源":"摺疊部分資源","认证成功，正在继续...":"已完成認證，正在繼續...","已成功导入项目：":"已匯入專案：","测试失败":"無法測試","展开代码块":"顯示程式碼塊","验证失败，请检查要求后重试。":"無法驗證，請檢查要求後重試。","工作区已成功归档":"工作區已封存","加载媒体失败":"無法載入媒體","加载图片失败":"無法載入圖片","上传 HTML 产物至 Google Drive 失败":"無法上傳 HTML 產物至 Google Drive ","加载执行轨迹失败":"無法載入執行軌跡","加载 MCP 服务失败":"無法載入 MCP 服務","获取可用 MCP 服务失败：":"無法取得可用 MCP 服務：","打开 MCP 配置文件失败":"無法開啟 MCP 設定檔","保存项目设置失败：":"無法儲存專案設定：","保存设置失败：":"無法儲存設定：","删除智能体失败：":"無法刪除 Agent ：","删除插件失败。":"無法刪除外掛。","删除插件失败，请重试。":"無法刪除外掛，請重試。","删除技能失败。":"無法刪除技能。","删除技能失败，请重试。":"無法刪除技能，請重試。","获取技能路径失败：":"無法取得技能路徑：","加载自定义智能体失败":"無法載入自訂 Agent ","加载 hooks.json 失败：":"無法載入 hooks.json ：","加载更多插件失败，请重试。":"無法載入更多外掛，請重試。","加载插件失败，请重试。":"無法載入外掛，請重試。","加载插件失败":"無法載入外掛","加载技能路径失败：":"無法載入技能路徑：","加载自定义扩展失败，请重试。":"無法載入自訂擴展，請重試。","打开智能体配置文件失败":"無法開啟 Agent 設定檔","打开智能体配置失败：":"無法開啟 Agent 設定：","打开插件配置文件失败":"無法開啟外掛設定檔","移除智能体失败：":"無法移除 Agent ：","移除插件失败：":"無法移除外掛：","切换智能体状态失败：":"無法切換 Agent 狀態：","切换插件状态失败：":"無法切換外掛狀態：","切换插件状态失败，请重试。":"無法切換外掛狀態，請重試。","更新智能体失败：":"無法更新 Agent ：","启用后，当智能体完成回复生成时，“变更概览”工具栏将自动展开。":"啟用後，當 Agent 完成回覆生成時，「變更總覽」工具列將自動顯示。","在组合包中收起":"在組合包中摺疊","在插件中收起":"在外掛中摺疊","检查此项目的许可证失败":"無法檢查此專案的授權條款","切换全屏模式失败":"無法切換全螢幕模式","解析设置失败，请修复后重启。":"無法解析設定，請修復後重新啟動。","展开或收起语言列表":"顯示或摺疊語言清單","创建自动化任务失败。":"無法建立自動化任務。","在 Google Workspace 中收起":"在 Google Workspace 中摺疊","根目录":"最上層資料夾","无项目关联":"尚未配對專案","选择要关联的项目":"選擇要配對的專案","当前对话未关联项目文件夹":"目前對話尚未配對專案資料夾","未关联调用":"尚未配對呼叫","此步骤未关联任何模型调用。":"此步驟尚未配對任何模型呼叫。","使用 Antigravity 需要关联一个 Google Cloud 项目。":"使用 Antigravity 需要配對 Google Cloud 專案。","没有可用于打开 MCP 配置文件的关联程序":"沒有可用來開啟 MCP 設定檔的程式","此项目关联了其他工作区。":"此專案已配對其他工作區。","projectOrder 必须是项目 ID 数组":"projectOrder 應為專案 ID 陣列","projectOrder 包含非字符串的项目 ID":"projectOrder 包含非字串格式的專案 ID","projectOrder 不能为空":"請至少提供一個專案 ID","未提供有效的可排序项目 ID":"未提供有效的專案 ID，無法排序","复制失败，请检查剪贴板权限":"無法複製，請檢查剪貼簿權限","保存项目顺序失败":"無法儲存專案順序","长消息与代码块折叠":"長訊息與程式碼區塊摺疊","超长代码块与历史长回复自动折叠（保留开头摘要，生成中与最新回复保持展开），支持随时一键展开或收起":"自動摺疊過長的程式碼區塊與先前的長回覆（保留開頭摘要，生成中及最新回覆保持顯示），可隨時一鍵顯示或摺疊","展开代码":"顯示程式碼","收起代码":"摺疊程式碼","展开消息":"顯示訊息","收起消息":"摺疊訊息","展开全文":"顯示全文","收起长回复":"摺疊長回覆","无效的本地路径":"本機路徑無效","路径格式不合法":"路徑格式無效","读取路径信息失败":"無法讀取路徑資訊","打开系统文件管理器失败":"無法開啟系統檔案管理器","项目文件":"專案檔案","本会话变更与产物":"本次對話的變更與產出","当前对话未绑定项目工作区目录，已拦截跨项目目录访问":"目前對話尚未配對專案工作區資料夾，已阻擋跨專案資料夾存取","工作区根目录":"工作區最上層資料夾","无效的工作区根目录路径":"工作區最上層資料夾路徑無效","指定的工作区根目录不存在或无法访问":"指定的工作區最上層資料夾不存在或無法存取","指定的工作区根不是目录":"指定的工作區最上層路徑不是資料夾","指定的工作区根目录不属于当前会话所属项目":"指定的工作區最上層資料夾不屬於目前對話的專案","目标目录超出当前所选工作区根目录边界，禁止静默跨工作区访问":"目標資料夾超出目前所選工作區最上層資料夾的範圍，禁止在未提示的情況下跨工作區存取","提交信息不能为空":"請填寫提交資訊","启用插件 $1 失败":"無法啟用外掛 $1","写入 MCP 配置失败：$1":"無法寫入 MCP 設定：$1","加载技能失败：$1":"無法載入技能：$1","扫描技能配置文件失败：$1":"無法掃描技能設定檔：$1","加载第 $1 页失败：$2":"無法載入第 $1 頁：$2","加载第 $1 页的文本图层失败：$2":"無法載入第 $1 頁的文字圖層：$2","文本图层渲染失败：$1":"無法算繪文字圖層：$1","初始化文本图层失败：$1":"無法初始化文字圖層：$1","该项目共挂载":"此專案共掛載","个工作区文件夹，请选择要浏览的目录":"個工作區資料夾，請選擇要瀏覽的目錄","该对话不属于任何本地项目目录，或所属项目尚未挂载工作区文件夹":"此對話不屬於任何本機專案資料夾，或所屬專案尚未掛載工作區資料夾","全部目录":"全部資料夾","返回上级目录":"返回上一層資料夾","上级":"上一層","复制所在文件夹路径":"複製所在資料夾路徑","复制含行号路径":"複製含行號的路徑","文件路径操作菜单":"檔案路徑操作選單","已复制所在文件夹":"已複製所在資料夾","已复制含行号路径":"已複製含行號的路徑","禁止访问敏感密钥或凭证目录":"禁止存取敏感金鑰或憑證資料夾","未指定要浏览的项目工作区目录":"請指定要瀏覽的專案工作區資料夾","禁止跨项目浏览非当前会话所属的工作区目录":"禁止跨專案瀏覽不屬於目前對話的工作區資料夾","您的 Antigravity 使用情况将与所提供的项目关联。":"您的 Antigravity 使用情況將配對至所提供的專案。","已关联项目":"已配對專案"};
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
    res = res.replace(/(?<!\\[A-Za-z])(?<=[A-Za-z])(?=\p{Script=Han})|(?<=\p{Script=Han})(?=[A-Za-z])/gu, ' ');
    if (__AG_ZH_TW_CACHE.size >= 8000) { const fk = __AG_ZH_TW_CACHE.keys().next().value; if (fk !== undefined) __AG_ZH_TW_CACHE.delete(fk); }
    __AG_ZH_TW_CACHE.set(input, res);
    return res;
  }
  function convertToZhTW(text) {
    if (typeof text !== 'string' || !text) return text;
    if (typeof window !== 'undefined' && typeof window.__AG_ZH_TW_CONVERT__ === 'function') {
      return window.__AG_ZH_TW_CONVERT__(text);
    }
    return typeof convertZhCNToZhTWFallback === 'function' ? convertZhCNToZhTWFallback(text) : text;
  }

  function formatZhText(text) {
    if (lang !== 'zh-TW' || typeof text !== 'string') return text;
    if (text === '固定') return '釘選';
    return convertToZhTW(text);
  }

  // 自定义翻译名单（由启动器从 custom-translations.txt 注入）：[[原文, 译文], ...]
  // 整段文本与原文一致（忽略大小写和首尾空白）时优先使用；译文为空表示保留英文原文。
  const customTranslations = new Map();
  for (const item of Array.isArray(window.__antigravityZhCustom) ? window.__antigravityZhCustom : []) {
    if (!Array.isArray(item)) continue;
    const key = String(item[0] ?? '').trim().toLowerCase();
    const target = String(item[1] ?? '').trim();
    if (!key) continue;
    customTranslations.set(key, target);
  }

  // 内置预设「选项名保留英文」：默认关闭，可在悬浮按钮菜单（双击或右键）中勾选。
  // 仅包含选项名 / 档位名，说明文字照常汉化；custom-translations.txt 的个人规则优先于预设。
  const ENGLISH_LABELS_KEY = 'antigravityHansEnglishLabels';
  const englishLabelsPreset = new Set([
    // 对话权限预设菜单
    'This Conversation', 'Request Review', 'Default', 'Auto', 'Turbo',
    // 模型推理强度档位
    'High', 'Medium', 'Low',
  ].map((item) => item.toLowerCase()));
  let englishLabels = loadPref(ENGLISH_LABELS_KEY) === '1';

  // 写入译文并记录原文。若节点当前值不是上次写入的译文，说明应用自己更新了文本，以当前值为新原文。
  function writeText(node, value) {
    const finalValue = formatZhText(value);
    const prev = node.nodeValue;
    if (finalValue === prev) return;
    const record = originals.texts.get(node);
    if (record && record.zh === prev) record.zh = finalValue;
    else originals.texts.set(node, { orig: prev, zh: finalValue });
    node.nodeValue = finalValue;
  }

  function writeAttr(element, name, value) {
    const finalValue = formatZhText(value);
    const prev = element.getAttribute(name);
    if (finalValue === prev) return;
    let map = originals.attrs.get(element);
    if (!map) originals.attrs.set(element, (map = new Map()));
    const record = map.get(name);
    if (record && record.zh === prev) record.zh = finalValue;
    else map.set(name, { orig: prev, zh: finalValue });
    element.setAttribute(name, finalValue);
  }

  function restoreTrackedNode(node) {
    const text = originals.texts.get(node);
    if (text) {
      // 仅还原仍是本脚本译文的节点；已被应用改写的内容保持不动。
      if (node.nodeValue === text.zh) node.nodeValue = text.orig;
      originals.texts.delete(node);
    }
    const attrs = originals.attrs.get(node);
    if (attrs) {
      for (const [name, record] of attrs) {
        if (node.getAttribute(name) === record.zh) node.setAttribute(name, record.orig);
      }
      originals.attrs.delete(node);
    }
    node.__zh_patched = false;
    node.__zh_patched_fp = '';
  }

  const zhToEnFallback = new Map();
  function restoreOriginals(includePreTranslated = false) {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const hadTrackedText = originals.texts.has(node);
      const hadTrackedAttrs = originals.attrs.has(node);
      restoreTrackedNode(node);
      if (!includePreTranslated) continue;
      if (!hadTrackedText && node.nodeType === Node.TEXT_NODE && !shouldSkip(node) && isInAntigravityContainer(node)) {
        const cur = node.nodeValue || '';
        const trimmed = cur.trim();
        if (trimmed && /[\u4e00-\u9fa5]/.test(trimmed)) {
          const en = zhToEnFallback.get(trimmed);
          if (en) {
            const lead = cur.slice(0, cur.indexOf(trimmed));
            const tail = cur.slice(cur.indexOf(trimmed) + trimmed.length);
            node.nodeValue = lead + en + tail;
          }
        }
      } else if (!hadTrackedAttrs && node.nodeType === Node.ELEMENT_NODE && !shouldSkip(node) && isInAntigravityContainer(node)) {
        for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
          const curA = node.getAttribute?.(attr);
          if (!curA || !/[\u4e00-\u9fa5]/.test(curA)) continue;
          const enA = zhToEnFallback.get(curA.trim());
          if (enA) node.setAttribute(attr, enA);
        }
      }
    }
  }

  /*
   * Visual Studio Code Localization Packs
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * MIT License
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  // VS Code localization data: microsoft/vscode-loc commit 1f1da543, MIT; additional Antigravity translations.
  // Entries are [index, original, translation].
  const ideNlsSupplement = [
    [147,"Extensions","扩展"],
    [148,"Integrated Terminal","集成终端"],
    [149,"Chat","聊天"],
    [150,"Telemetry","遥测"],
    [151,"Update","更新"],
    [366,"Hover is enabled.","悬停已启用。"],
    [367,"Hover is disabled.","悬停已禁用。"],
    [368,"Hover is shown when holding `{0}` or `Alt` (the opposite modifier of `#editor.multiCursorModifier#`)","按住 `{0}` 或 `Alt` (`#editor.multiCursorModifier#` 的相反修饰键)时显示悬停"],
    [459,"Controls whether inline suggestions are suppressed when in snippet mode.","控制在代码片段模式下是否抑制内联建议。"],
    [462,"Controls whether to send request information from the inline suggestion provider.","控制是否从内联建议提供者处发送请求信息。"],
    [467,"Controls whether long distance inline suggestions are shown.","控制是否显示长距离内联建议。"],
    [731,"Background color for the highlight of line at the cursor position when the editor is not focused.","编辑器未聚焦时，光标所在行的高亮背景色。"],
    [808,"Whether the context is a multi diff editor","上下文是否为多个差异编辑器"],
    [946,"Go to Offset...","转到偏移量..."],
    [1176,"Explain and Fix Problem","解释并修复问题"],
    [1294,"Copy","复制"],
    [1295,"Copied to clipboard","已复制到剪贴板"],
    [1305,"Explain and Fix","解释并修复"],
    [1339,"Triggers an inline suggestion in the editor.","在编辑器中触发内联建议。"],
    [1340,"Options for triggering inline suggestions.","触发内联建议的选项。"],
    [1341,"No inline suggestion is available.","无内联建议可用。"],
    [1356,"Accept Inline Suggestion Alternative Action","接受内联建议的替代操作"],
    [1361,"Whether an alternative action for the inline suggestion is visible.","内联建议的替代操作是否可见。"],
    [1370,"Whether debounce should be disabled for inline suggestions","是否禁用内联建议的防抖"],
    [1374,"Whether any custom {0} completion UI is currently shown","当前是否显示任何自定义 {0} 补全界面"],
    [1390,"Snooze","推迟"],
    [1392,"Inline Suggestion","内联建议"],
    [1393,"{0} 1 occurrence","{0}（出现 1 次）"],
    [1394,"{0} {1} occurrences","{0}（出现 {1} 次）"],
    [1395,"{0} show occurrences","按 {0} 显示出现位置"],
    [1511,"Open a text editor first to go to a line or an offset.","先打开文本编辑器然后跳转到行或偏移量。"],
    [1512,"Current position: line {0}, column {1}. {2}","当前位置: 第 {0} 行，第 {1} 列。{2}"],
    [1513,"Use Zero-Based Offset","使用从零开始的偏移量"],
    [1514,"Open a text editor first to go to a line or an offset.","先打开文本编辑器然后跳转到行或偏移量。"],
    [1515,"Type a character position to go to (from 0 to {0}).","键入要转到的字符位置(从 0 到 {0})。"],
    [1516,"Type a character position to go to (from 1 to {0}).","键入要转到的字符位置(从 1 到 {0})。"],
    [1517,"Press 'Enter' to go to line {0} at column {1}.","按 \"Enter\" 键转到第 {0} 行，第 {1} 列。"],
    [1518,"Type a line number to go to (from 1 to {0}).","键入要转到的行号(从 1 到 {0})。"],
    [1519,"Press 'Enter' to go to line {0} or enter colon : to add a column number.","按 \"Enter\" 键转到第 {0} 行，或输入冒号 : 以添加列号。"],
    [1520,"Press 'Enter' to go to line {0} or enter a column number (from 1 to {1}).","按 \"Enter\" 键跳转到第 {0} 行，或输入列号(从 1 到 {1})。"],
    [1521,"Press 'Enter' to go to line {0} at column {1}.","按 \"Enter\" 键转到第 {0} 行，第 {1} 列。"],
    [1640,"True when focus is in the debug console, false otherwise.","焦点位于调试控制台时为 true，否则为 false。"],
    [1672,"Accept suggestion","接受建议"],
    [1848,"Send Analytics","发送分析数据"],
    [1849,"Upload Error","上传错误"],
    [1850,"Log Observability Data","记录可观测性数据"],
    [1851,"Login with Redirect","使用重定向登录"],
    [1901,"&&Select folder","选择文件夹(&S)"],
    [2142,"Hold {0} key to mouse over","按住 {0} 键将鼠标悬停"],
    [2143,"Loading...","正在加载..."],
    [2144,"Agent Window","智能体窗口"],
    [2145,"When enabled, will open a special window on startup which is a special, non-code-editor window for interfacing with {0}'s agent-first experience.","启用后，启动时会打开一个专用的非代码编辑器窗口，用于使用 {0} 的智能体优先体验。"],
    [2148,"{0} Version: {1}\nVSCode OSS Version: {2}\nCommit: {3}\nDate: {4}\nElectron: {5}\nChromium: {6}\nNode.js: {7}\nV8: {8}\nOS: {9}\nLanguage Server CL: {10}","{0} 版本：{1}\nVSCode OSS 版本：{2}\n提交：{3}\n日期：{4}\nElectron：{5}\nChromium：{6}\nNode.js：{7}\nV8：{8}\n操作系统：{9}\n语言服务器 CL：{10}"],
    [2150,"Automatically show hidden windows after 10 seconds","10 秒后自动显示隐藏的窗口"],
    [2208,"&&Workspace","&&工作区"],
    [2250,"Unable to install the shell command '{0}'.","无法安装 Shell 命令 '{0}'。"],
    [2255,"Unable to uninstall the shell command '{0}'.","无法卸载 Shell 命令 '{0}'。"],
    [2256,"Unable to find shell script at '{0}'","找不到位于 '{0}' 的 Shell 脚本"],
    [2275,"Remove from Recently Used","从最近使用中移除"],
    [2329,"Controls whether system certificates should be loaded using Node.js built-in support. Reload the window after changing this setting. When during [remote development](https://aka.ms/vscode-remote) the {0} setting is disabled this setting can be configured in the local and the remote settings separately.","控制是否应使用 Node.js 内置支持加载系统证书。更改此设置后请重新加载窗口。在[远程开发](https://aka.ms/vscode-remote)期间禁用 {0} 设置时，可在本地设置和远程设置中分别配置此设置。"],
    [2332,"Controls the interval in seconds for checking network interface changes to invalidate the proxy cache. Set to -1 to disable. When during [remote development](https://aka.ms/vscode-remote) the {0} setting is disabled this setting can be configured in the local and the remote settings separately.","控制检查网络接口更改以使代理缓存失效的时间间隔(秒)。设置为 -1 可禁用。在[远程开发](https://aka.ms/vscode-remote)期间禁用 {0} 设置时，可在本地设置和远程设置中分别配置此设置。"],
    [2337,"To manage how {0} stores code snippet telemetry, visit your [IDE Account Settings]({1}).\n","要管理 {0} 存储代码片段遥测数据的方式，请访问 [IDE 账号设置]({1})。\n"],
    [2402,"The background color used in stark buttons.","醒目按钮使用的背景色。"],
    [2403,"The foreground color used in stark buttons.","醒目按钮使用的前景色。"],
    [2404,"The background color used in stark buttons when hovered.","鼠标悬停在醒目按钮上时使用的背景色。"],
    [2405,"A subtler version of list hover background.","较柔和的列表悬停背景色。"],
    [2406,"Lighter background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本较浅的背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2407,"Darker background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本较深的背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2408,"Fallback background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本的备用背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2409,"Lighter background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本较浅的背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2410,"Darker background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本较深的背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2411,"Fallback background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.","插入文本的备用背景色。该颜色不能不透明，以免遮盖底层装饰。"],
    [2644,"Scrollbar track background color.","滚动条轨道背景色。"],
    [2747,"A new version of Jetski is available.\n\nCurrent version: {0}\nNewest version: {1}\n\nWe recommend using go/jetski-linux-installer.\n\nNote: If you already updated but still see this message, you may have stale Jetski processes running. Kill them with: pkill jetski.","有可用的 Jetski 新版本。\n\n当前版本：{0}\n最新版本：{1}\n\n建议使用 go/jetski-linux-installer。\n\n注意：如果更新后仍看到此消息，可能有旧的 Jetski 进程正在运行。可使用以下命令结束它们：pkill jetski。"],
    [2750,"Instructions to update...","更新说明..."],
    [2751,"Update is available","有可用更新"],
    [2752,"A new version of the IDE is available ({0}).\n\nIf you originally installed the IDE via your system's package manager (eg. apt), you can get the new version through your standard system update process.\n\nIf you originally installed Antigravity with the tarball, you can manually download the new tarball from the instructions below.","有可用的 IDE 新版本（{0}）。\n\n如果最初通过系统的软件包管理器（如 apt）安装 IDE，可以通过常规系统更新获取新版本。\n\n如果最初使用 tar 包安装 Antigravity，可以按照以下说明手动下载新的 tar 包。"],
    [2828,"Override the reconnection grace time window in seconds. Defaults to 10800 (3 hours).","替代重新连接宽限期窗口(秒)。默认值为 10800 秒(3 小时)。"],
    [2846,"Copy URIs & Proceed","复制 URI 并继续"],
    [2847,"Failed to copy redirect URIs to clipboard.","未能将重定向 URI 复制到剪贴板。"],
    [2899,"Authentication session for {0} removed, stopping server","已移除 {0} 的身份验证会话，正在停止服务器"],
    [2941,"Contribute views containers to Secondary Activity Bar","将视图容器添加到辅助活动栏"],
    [2956,"The view will expanded even if the container forces it to be collapsed.","即使容器强制折叠，该视图也会展开。"],
    [2970,"Contributes views to Agent Sessions container in the Activity bar. To contribute to this container, the 'chatSessionsProvider' API proposal must be enabled.","向活动栏中的 Agent Sessions 容器提供视图。要提供给此容器，必须启用 \"chatSessionsProvider\" API 建议。"],
    [2979,"View container '{0}' requires 'enabledApiProposals: [\"chatSessionsProvider\"]'.","视图容器 \"{0}\" 需要 \"enabledApiProposals: [\"chatSessionsProvider\"]\"。"],
    [3022,"Accessibility settings","辅助功能设置"],
    [3023,"Advanced settings are hidden by default in the Settings editor unless the user chooses to show advanced settings.","高级设置在设置编辑器中默认隐藏，除非用户选择显示高级设置。"],
    [3024,"Experimental settings are subject to change and may be removed in future releases.","实验性设置可能会发生变更，且可能在未来版本中移除。"],
    [3025,"Preview settings can be used to try out new features before they are finalized.","预览设置可在新功能最终确定前用于试用这些功能。"],
    [3026,"Telemetry settings","遥测设置"],
    [3027,"Settings that use online services","使用联机服务的设置"],
    [3140,"Provide &&Feedback","提供&&反馈"],
    [3176,"Move Secondary Side Bar Left","将辅助侧边栏移至左侧"],
    [3177,"Move Secondary Side Bar Right","将辅助侧边栏移至右侧"],
    [3192,"Show Primary Side Bar","显示主侧边栏"],
    [3228,"Secondary Activity Bar","辅助活动栏"],
    [3322,"Folder Opened in a Window","已在窗口中打开文件夹"],
    [3323,"Workspace Opened in a Window","已在窗口中打开工作区"],
    [3324,"Folder Opened in Active Window","已在活动窗口中打开文件夹"],
    [3325,"Workspace Opened in Active Window","已在活动窗口中打开工作区"],
    [3404,"Hide Menu","隐藏菜单"],
    [3405,"Secondary Activity Bar Position","辅助活动栏位置"],
    [3406,"&&Default","&&默认"],
    [3408,"&&Top","&&顶部"],
    [3410,"&&Bottom","&&底部"],
    [3411,"Bottom","底部"],
    [3412,"&&Hidden","&&隐藏"],
    [3413,"Hidden","隐藏"],
    [3414,"Secondary Activity Bar Position","辅助活动栏位置"],
    [3415,"Secondary Activity Bar Position","辅助活动栏位置"],
    [3416,"Secondary Activity Bar Position","辅助活动栏位置"],
    [3417,"Move Secondary Activity Bar to Side","将辅助活动栏移至侧面"],
    [3418,"Move Secondary Activity Bar to Top","将辅助活动栏移至顶部"],
    [3419,"Move Secondary Activity Bar to Bottom","将辅助活动栏移至底部"],
    [3420,"Hide Secondary Activity Bar","隐藏辅助活动栏"],
    [3427,"Hide Secondary Side Bar","隐藏辅助侧边栏"],
    [3428,"Show Secondary Side Bar","显示辅助侧边栏"],
    [3874,"Show All Recent Folders {0}","显示所有最近的文件夹 {0}"],
    [3882,"Installing {0}...","正在安装 {0}..."],
    [3883,"{0} installed successfully!","{0} 安装成功！"],
    [3884,"Failed to install {0}: {1}","安装 {0} 失败：{1}"],
    [3989,"Add to .gitignore","添加到 .gitignore"],
    [3990,"No .gitignore file exists in the workspace","工作区中不存在 .gitignore 文件"],
    [3991,"Cannot read .gitignore","无法读取 .gitignore"],
    [3992,"File is already in .gitignore","文件已在 .gitignore 中"],
    [3993,"Failed to add file to .gitignore: {0}","无法将文件添加到 .gitignore：{0}"],
    [4020,"You are not signed in to any accounts","你尚未登录任何账号"],
    [4031,"You are not signed in to any accounts","你尚未登录任何账号"],
    [4161,"&&Workspace","&&工作区"],
    [4327,"Navigate between open files using three-finger swipe horizontally. Note that System Preferences > Trackpad > More Gestures must be set to 'Swipe with two or three fingers'.","通过使用三指水平滑动来切换打开的文件。请注意，“系统首选项”>“触控板”>“更多手势”必须设置为“用两指或三指滑动”。"],
    [4359,"Controls whether the command palette shows 'Ask in Chat' option at the bottom.","控制命令面板底部是否显示“在聊天中询问”选项。"],
    [4386,"Controls the location of the Secondary Activity Bar relative to the Secondary Side Bar.","控制辅助活动栏相对于辅助侧边栏的位置。"],
    [4387,"Show the Secondary Activity Bar on the side of the Secondary Side Bar.","在辅助侧边栏的侧面显示辅助活动栏。"],
    [4388,"Show the Secondary Activity Bar on top of the Secondary Side Bar.","在辅助侧边栏的顶部显示辅助活动栏。"],
    [4389,"Show the Secondary Activity Bar at the bottom of the Secondary Side Bar.","在辅助侧边栏的底部显示辅助活动栏。"],
    [4390,"Hide the Secondary Activity Bar in the Secondary Side Bar.","在辅助侧边栏中隐藏辅助活动栏。"],
    [4749,"Provide information about how to open the chat terminal output in the Accessible View.","介绍如何在辅助视图中打开聊天终端输出。"],
    [4956,"{0}: Explain and Fix Problem","{0}：解释并修复问题"],
    [4957,"{0}: Send Prompt to Agent Panel","{0}：将提示发送到智能体面板"],
    [4972,"{0} Plugin Page","{0} 插件页面"],
    [4973,"{0} Configure MCP Page","{0} MCP 配置页面"],
    [4974,"{0}: Manage MCP Servers","{0}：管理 MCP 服务器"],
    [4975,"MCP icon used in Antigravity MCP editor pages.","Antigravity MCP 编辑器页面中使用的 MCP 图标。"],
    [4983,"Reset Manager Onboarding","重置管理器入门设置"],
    [4985,"Reset Manager Onboarding state.","重置管理器入门设置的状态。"],
    [4987,"Welcome to {0}","欢迎使用 {0}"],
    [4988,"Extension '{0}' cannot register plugin with invalid name '{1}'.","扩展“{0}”无法注册名称无效的插件“{1}”。"],
    [4989,"Extension '{0}' cannot register plugin '{1}' without path.","扩展“{0}”无法注册缺少路径的插件“{1}”。"],
    [4990,"Extension '{0}' plugin '{1}' path resolves outside the extension.","扩展“{0}”的插件“{1}”路径解析后位于扩展目录之外。"],
    [4991,"Extension '{0}' plugin '{1}' path is not a directory.","扩展“{0}”的插件“{1}”路径不是目录。"],
    [4992,"Failed to install plugin '{0}' from extension '{1}': {2}","无法从扩展“{1}”安装插件“{0}”：{2}"],
    [4993,"Contributes plugins for Antigravity agent. Plugins are copied to ~/.gemini/<ideName>/plugins/ when the extension is installed.","为 Antigravity 智能体提供插件。安装扩展时，插件会复制到 ~/.gemini/<ideName>/plugins/。"],
    [4994,"Unique identifier for the plugin. Must be unique within this extension. Will be prefixed with extension ID when stored.","插件的唯一标识符，必须在此扩展内唯一。存储时会加上扩展 ID 前缀。"],
    [4995,"Relative path to the plugin folder within the extension.","插件文件夹在扩展内的相对路径。"],
    [4996,"(Optional) Human-readable description of what the plugin does.","（可选）供人阅读的插件功能说明。"],
    [4997,"Contributes plugins for Antigravity agent. Each plugin folder is copied to `~/.gemini/<ideName>/plugins/<extensionId>.<pluginName>/` when the extension is installed.\\n\\n**Expected plugin folder structure:**\\n\\n```\\nplugins/my-plugin/\\n  skills/             # Agent skills\\n    my-skill/\\n      SKILL.md\\n  mcp_config.json     # MCP server definitions (optional)\\n```\\n\\nWhen the extension is uninstalled, the plugin folder is automatically removed.","为 Antigravity 智能体提供插件。安装扩展时，每个插件文件夹都会复制到 `~/.gemini/<ideName>/plugins/<extensionId>.<pluginName>/`。\\n\\n**预期的插件文件夹结构：**\\n\\n```\\nplugins/my-plugin/\\n  skills/             # Agent skills\\n    my-skill/\\n      SKILL.md\\n  mcp_config.json     # MCP server definitions (optional)\\n```\\n\\n卸载扩展时，插件文件夹会自动移除。"],
    [5000,"Failed to open Antigravity settings: {0}","无法打开 Antigravity 设置：{0}"],
    [5001,"Open {0} Settings Page With Setting ID","使用设置 ID 打开 {0} 设置页面"],
    [5003,"Open {0} User Settings","打开 {0} 用户设置"],
    [5011,"Open the {0} quick settings panel.","打开 {0} 快捷设置面板。"],
    [5014,"Open the {0} quick settings panel.","打开 {0} 快捷设置面板。"],
    [5039,"Select an account to manage","选择要管理的帐户"],
    [5040,"There are no active accounts.","没有活动帐户。"],
    [5041,"Manage '{0}'","管理 \"{0}\""],
    [5042,"Select an action","选择操作"],
    [5043,"Manage Trusted Extensions","管理受信任扩展"],
    [5044,"Sign Out","退出登录"],
    [5045,"Manage Accounts","管理帐户"],
    [5046,"Accounts","帐户"],
    [5057,"View extension details","查看扩展详细信息"],
    [5174,"To remove attached contexts, focus an attachment and press Delete or Backspace.","若要移除附加的上下文，请聚焦附件并按 Delete 或 Backspace。"],
    [5177,"To return to the last chat response you focused, invoke the Focus Last Focused Chat Response command{0}.","若要返回到聚焦的上一个聊天响应，请调用“聚焦上个聚焦的聊天响应”命令 {0}。"],
    [5182,"To navigate to the next user prompt in the conversation, invoke the Next User Prompt command{0}.","若要导航到对话中的下一个用户提示，请调用“下一个用户提示”命令 {0}。"],
    [5183,"To navigate to the previous user prompt in the conversation, invoke the Previous User Prompt command{0}.","若要导航到对话中的上一个用户提示，请调用“上一个用户提示”命令 {0}。"],
    [5185,"If there are any hidden chat terminals, you can view them by invoking the View Hidden Chat Terminals command{0}.","如果有任何隐藏的聊天终端，可以通过调用“查看隐藏聊天终端”命令 {0} 来查看它们。"],
    [5186,"To focus the last chat terminal that ran a tool, invoke the Focus Most Recent Chat Terminal command{0}.","若要聚焦运行工具的上一个聊天终端，请调用“聚焦最近聊天终端”命令{0}。"],
    [5187,"To focus the output from the last chat terminal tool, invoke the Focus Most Recent Chat Terminal Output command{0}.","若要聚焦上一个聊天终端工具的输出，请调用“聚焦最近聊天终端输出”命令 {0}。"],
    [5265,"Sessions Orientation","会话排列方向"],
    [5279,"Focus Last Focused Chat List Item","聚焦上次聚焦的聊天列表项"],
    [5291,"Edit/manage the tool approval and confirmation preferences for AI chat agents.","编辑/管理 AI 聊天智能体的工具审批和确认首选项。"],
    [5292,"Show Sessions","显示会话"],
    [5293,"Show Chat Title","显示聊天标题"],
    [5295,"Stacked","上下排列"],
    [5296,"Side by Side","并排"],
    [5297,"Show Welcome","显示欢迎界面"],
    [5298,"New {0}","新建 {0}"],
    [5299,"A chat session is in progress. It will continue running in the background.","有一个聊天会话正在进行，它将继续在后台运行。"],
    [5300,"Open Agent Sessions","打开智能体会话"],
    [5319,"Terminal","终端"],
    [5329,"Continue Chat in...","继续聊天..."],
    [5332,"Continue in {0}","在 {0} 后继续"],
    [5333,"Continue In","继续于"],
    [5334,"Continue in {0}","在 {0} 后继续"],
    [5335,"Continue In","继续于"],
    [5336,"Continue in...","继续于..."],
    [5337,"Continue Chat in...","继续聊天..."],
    [5340,"Copy Math Source","复制数学源代码"],
    [5343,"Accept Request","接受请求"],
    [5352,"Send to Agent","发送给智能体"],
    [5361,"Open Picker","打开选取器"],
    [5392,"New Chat","新建聊天"],
    [5393,"New Chat","新建聊天"],
    [5394,"New Chat","新建聊天"],
    [5396,"Undo Last Request","撤消上一个请求"],
    [5397,"Redo Last Request","恢复上一个请求"],
    [5398,"Redo","恢复"],
    [5399,"Reapply discarded workspace changes and chat","重新应用放弃的工作区更改和聊天"],
    [5400,"Next User Prompt","下一个用户提示"],
    [5401,"Previous User Prompt","上一个用户提示"],
    [5421,"Combined Sessions View","合并的会话视图"],
    [5440,"Select tools for this custom agent","为此自定义智能体选择工具"],
    [5441,"The selected tools are configured by the '{0}' custom agent. Changes to the tools will be applied to the custom agent file as well.","所选工具由“{0}”自定义智能体配置。对工具的更改也将应用于自定义智能体文件。"],
    [5442,"Select tools for this custom agent","为此自定义智能体选择工具"],
    [5443,"The selected tools are configured by the '{0}' custom agent. Changes to the tools will only be used for this session and will not change the '{0}' custom agent.","所选工具由“{0}”自定义智能体配置。对工具的更改将仅应用于本会话，并且不会更改 \"{0}\" 自定义智能体。"],
    [5445,"The selected tools will be applied globally for all chat sessions that use the default agent.","所选工具将全局应用于使用默认智能体的所有聊天会话。"],
    [5448,"Skip","跳过"],
    [5481,"Filter Agent Sessions","筛选智能体会话"],
    [5482,"Filter Agent Sessions","筛选智能体会话"],
    [5483,"Local","本地"],
    [5484,"Background","背景"],
    [5485,"Cloud","云"],
    [5486,"Foreground color for the read indicator in an agent session.","智能体会话中已读指示器的前景色。"],
    [5487,"Archive chat with pending edits?","归档包含待处理编辑的聊天吗？"],
    [5488,"You have pending changes in this chat session.","此聊天会话中有待处理的更改。"],
    [5489,"Open as Editor","作为编辑器打开"],
    [5490,"Open to the Side","在侧边打开"],
    [5493,"Unarchive","取消归档"],
    [5496,"Refresh Agent Sessions","刷新智能体会话"],
    [5497,"Find Agent Session","查找智能体会话"],
    [5498,"Refresh Agent Sessions","刷新智能体会话"],
    [5499,"Find Agent Session","查找智能体会话"],
    [5500,"Show Agent Sessions Sidebar","显示智能体会话侧边栏"],
    [5501,"Hide Agent Sessions Sidebar","隐藏智能体会话侧边栏"],
    [5504,"Failed","失败"],
    [5508,"Refreshing agent sessions...","正在刷新智能体会话..."],
    [5509,"New Session","新建会话"],
    [5510,"New Session","新建会话"],
    [5511,"New Session","新建会话"],
    [5512,"New Local Session","新建本地会话"],
    [5513,"New Background Session","新建后台会话"],
    [5514,"New Cloud Session","新建云会话"],
    [5515,"New {0}","新建 {0}"],
    [5517,"{0} files","{0} 个文件"],
    [5518,"Working...","正在运行..."],
    [5519,"Failed after {0}.","{0} 后失败。"],
    [5520,"Finished in {0}.","在 {0} 后完成。"],
    [5521,"Failed","失败"],
    [5522,"Finished","已完成"],
    [5523,"Agent Sessions","智能体会话"],
    [5524,"{0} agent sessions","{0} 个智能体会话"],
    [5530,"Current file context","当前文件上下文"],
    [5562,"Controls which URLs are automatically approved when requested by chat tools. Keys are URL patterns and values can be `true` to approve both requests and responses, `false` to deny, or an object with `approveRequest` and `approveResponse` properties for granular control.\n\nExamples:\n- `\"https://example.com\": true` - Approve all requests to example.com\n- `\"https://*.example.com\": true` - Approve all requests to any subdomain of example.com\n- `\"https://example.com/api/*\": { \"approveRequest\": true, \"approveResponse\": false }` - Approve requests but not responses for example.com/api paths","控制在聊天工具请求时哪些 URL 会得到自动批准。键是 URL 模式，值可以是 `true` 以表示批准请求和响应，可以是 `false` 以表示拒绝，还可以是包含 `approveRequest` 和 `approveResponse` 属性的对象，以用于进行细粒度控制。\r\n\r\n示例:\r\n- `\"https://example.com\": true` - 批准对 example.com 的所有请求\r\n- `\"https://*.example.com\": true` - 批准对 example.com 任意子域的所有请求\r\n- `\"https://example.com/api/*\": { \"approveRequest\": true, \"approveResponse\": false }` - 批准对 example.com/api 路径的请求，但不批准响应"],
    [5563,"Controls which tools are eligible for automatic approval. Tools set to 'false' will always present a confirmation and will never offer the option to auto-approve. The default behavior (or setting a tool to 'true') may result in the tool offering auto-approval options.","控制哪些工具有资格获得自动批准。设置为 `false` 的工具将始终提出确认，且从不提供自动批准选项。默认行为(或将工具设置为 `true`)可能使工具提供自动批准选项。"],
    [5564,"Controls which tools are eligible for automatic approval. Tools set to 'false' will always present a confirmation and will never offer the option to auto-approve. The default behavior (or setting a tool to 'true') may result in the tool offering auto-approval options.","控制哪些工具有资格获得自动批准。设置为 `false` 的工具将始终提出确认，且从不提供自动批准选项。默认行为(或将工具设置为 `true`)可能使工具提供自动批准选项。"],
    [5565,"Controls whether background throttling is suspended when a chat request is in progress, allowing the chat session to continue even when the window is not in focus.","控制进行聊天请求时是否暂停后台限流，让聊天会话在窗口未聚焦时也能继续。"],
    [5571,"Show welcome banner when chat is empty.","聊天为空时显示欢迎横幅。"],
    [5572,"Show chat agent sessions when chat is empty or to the side when chat view is wide enough.","聊天为空时显示聊天智能体会话；聊天视图足够宽时在侧边显示。"],
    [5573,"Automatically determine the orientation based on available space.","根据可用空间自动确定排列方向。"],
    [5574,"Display sessions vertically stacked unless a chat session is visible.","除非有聊天会话可见，否则垂直堆叠显示会话。"],
    [5575,"Display sessions side by side if space is sufficient.","空间足够时并排显示会话。"],
    [5576,"Controls the orientation of the chat agent sessions view when it is shown alongside the chat.","控制聊天智能体会话视图与聊天并排显示时的排列方向。"],
    [5577,"Show the title of the chat above the chat in the chat view.","在聊天视图的聊天内容上方显示聊天标题。"],
    [5578,"Controls whether a chat session should present the user with an OS notification when a response is received while the window is not in focus. This includes a window badge as well as notification toast.","控制在窗口未处于焦点且接收到响应时，聊天会话是否应向用户呈现 OS 通知。这包括窗口徽章和通知横幅。"],
    [5605,"When applying edits, show a progress animation in the code block pill. If disabled, shows the progress percentage instead.","应用编辑时，在代码块药丸形状中显示进度动画。如果禁用，则改为显示进度百分比。"],
    [5606,"Show status widget for free tier users.","向免费层级用户显示状态小组件。"],
    [5607,"Show status widget for anonymous users.","向匿名用户显示状态小组件。"],
    [5608,"Controls which user type should see the status widget in new chat sessions when quota is exceeded.","控制额度超出时，哪些用户类型会在新聊天会话中看到状态小组件。"],
    [5611,"Enables the default Marketplace for Model Context Protocol (MCP) servers.","为模型上下文协议(MCP)服务器启用默认商城。"],
    [5620,"This setting is deprecated and will be removed in future releases. Chat modes are now called custom agents and are located in `.github/agents`","此设置已弃用，将在未来的版本中移除。聊天模式现称为自定义智能体，位于 `.github/agents` 中"],
    [5623,"Use nested AGENTS.MD files","使用嵌套的 AGENTS.MD 文件"],
    [5624,"Controls whether instructions from nested `AGENTS.MD` files found in the workspace are listed in all chat requests. The language model can load these skills on-demand if the `read` tool is available.","控制是否在所有聊天请求中列出在工作区中找到的嵌套 `AGENTS.MD` 文件中的指令。如果 `read` 工具可用，语言模型可以按需加载这些技能。"],
    [5625,"Use Claude skills","使用 Claude 技能"],
    [5626,"Controls whether Claude skills found in the workspace and user home directories under `.claude/skills` are listed in all chat requests. The language model can load these skills on-demand if the `read` tool is available.","控制是否在所有聊天请求中列出在 `.claude/skills` 下的工作区和用户主目录中找到的 Claude 技能。如果 `read` 工具可用，语言模型可以按需加载这些技能。"],
    [5629,"Controls whether to show the todo list widget above the chat input. When enabled, the widget displays todo items created by the agent and updates as progress is made.","控制是否在聊天输入上方显示待办事项列表小组件。启用后，小组件显示智能体创建的待办事项，并随进度更新。"],
    [5631,"When enabled, todo items include detailed descriptions for implementation context. This provides more information but uses additional tokens and may slow down responses.","启用后，待办事项包含实现上下文的详细描述。这会提供更多信息，但同时会使用额外的令牌，可能导致响应变慢。"],
    [5636,"Controls whether to use an LLM to generate summary titles for thinking sections.","控制是否使用大语言模型为思考部分生成摘要标题。"],
    [5637,"Tool calls are shown separately, not collapsed into thinking.","工具调用单独显示，不折叠到思考内容中。"],
    [5638,"Tool calls are collapsed into thinking sections when thinking is present.","有思考内容时，将工具调用折叠到思考部分。"],
    [5639,"Tool calls are always collapsed, even without thinking.","始终折叠工具调用，即使没有思考内容也是如此。"],
    [5640,"Controls how tool calls are displayed in relation to thinking sections.","启用后，可折叠的思考部分将根据所选模式添加工具调用。"],
    [5644,"Controls whether the last session is restored in panel after restart.","控制重启后是否在面板中恢复上一次会话。"],
    [5645,"Controls whether the chat panel automatically exits after delegating a request to another session.","控制将请求委派给另一个会话后，聊天面板是否自动退出。"],
    [5646,"Enables the unification of GitHub Copilot extensions. When enabled, all GitHub Copilot functionality is served from the GitHub Copilot Chat extension. When disabled, the GitHub Copilot and GitHub Copilot Chat extensions operate independently.","启用统一 GitHub Copilot 扩展。启用后，所有 GitHub Copilot 功能均通过 GitHub Copilot 聊天助手扩展提供。禁用时，GitHub Copilot 和 GitHub Copilot 聊天助手扩展独立运行。"],
    [5647,"Whether the runSubagent tool is able to use custom agents. When enabled, the tool can take the name of a custom agent, but it must be given the exact name of the agent.","runSubagent 工具是否能使用自定义智能体。启用后，工具可获取自定义智能体的名称，但必须获得智能体的准确名称。"],
    [5654,"Approve results of tool","审批工具的结果"],
    [5657,"Details: {0}","详细信息: {0}"],
    [5669,"Chat: {0}","聊天: {0}"],
    [5670,"Untitled Chat","无标题聊天"],
    [5671,"New chat response.","新建聊天响应。"],
    [5681,"Terminal command, {0}","终端命令，{0}"],
    [5682,"Command: {0}, exit code: {1}","命令: {0}，退出代码: {1}"],
    [5683,"Command","命令"],
    [5684,"Output:","输出:"],
    [5685,"Click to focus this command in the terminal.","单击聚焦终端中的此命令。"],
    [5712,"Enable more AI features","启用更多 AI 功能"],
    [5720,"Chat: {0}","聊天: {0}"],
    [5721,"Untitled Chat","无标题聊天"],
    [5725,"Applying edits","正在应用编辑"],
    [5728,"Edited","已编辑"],
    [5734,"Skip?","是否跳过?"],
    [5735,"Activating MCP extensions...","正在激活 MCP 扩展..."],
    [5736,"Starting MCP servers {0}...","正在启动 MCP 服务器 {0}..."],
    [5742,"Open Changes","打开更改"],
    [5745,"Auto approved by {0}","已由 {0} 自动审批"],
    [5746,"Auto approved for this session","已对此会话自动审批"],
    [5747,"Auto approved for this workspace","已对此工作区自动审批"],
    [5748,"Auto approved for this profile","已对此配置文件自动审批"],
    [5749,"Edit","编辑"],
    [5751,"Waiting for tool '{0}' to respond...","等待工具 \"{0}\" 响应..."],
    [5753,"Manage Paid Premium Requests","管理付费高级请求"],
    [5756,"Click to Retry","单击以重试"],
    [5764,"current mode","当前模式"],
    [5765,"Proceed from {0}","从 {0} 继续"],
    [5767,"More options for {0}","{0} 的更多选项"],
    [5768,"Continue in {0}","在 {0} 中继续"],
    [5772,"Finished thinking and invoked {0} tool{1}","已完成思考并调用 {0} 个工具"],
    [5773,"Finished Thinking","思考完成"],
    [5782,"Chat Todo List","聊天待办事项列表"],
    [5783,"Cannot clear todos while a task is in progress","任务正在进行时，无法清除待办事项"],
    [5785,"Collapse Todos","折叠待办事项"],
    [5786,"Expand Todos","展开待办事项"],
    [5787,"Todos ({0}/{1})","待办事项({0}/{1})"],
    [5790,"Todos ({0}/{1})","待办事项({0}/{1})"],
    [5796,"Failed to save {0}: {1}","未能保存 {0}: {1}"],
    [5797,"Saving resources...","正在保存资源..."],
    [5798,"Saved resources to {0}","已将资源保存到 {0}"],
    [5799,"Pick folder to save resources","选取文件夹以保存资源"],
    [5800,"Save As...","另存为..."],
    [5802,"Skip","跳过"],
    [5807,"Auto approved by {0}","已由 {0} 自动审批"],
    [5808,"Auto approved for this session","已对此会话自动审批"],
    [5809,"Auto approved for this workspace","已对此工作区自动审批"],
    [5810,"Auto approved for this profile","已对此配置文件自动审批"],
    [5811,"Edit","编辑"],
    [5816,"All commands will be auto approved for this session","此会话的所有命令将得到自动批准"],
    [5817,"Disable","禁用"],
    [5818,"Allow","允许"],
    [5819,"Skip","跳过"],
    [5826,"Terminal output for {0}","{0} 的终端输出"],
    [5827,"Command: {0}","命令: {0}"],
    [5828,"No output was produced by the command.","命令未生成任何输出。"],
    [5829,"Command output is no longer available.","命令输出不再可用。"],
    [5830,"No output was produced by the command.","命令未生成任何输出。"],
    [5831,"Output truncated.","输出已截断。"],
    [5832,"No output was produced by the command.","命令未生成任何输出。"],
    [5833,"No output was produced by the command.","命令未生成任何输出。"],
    [5834,"Terminal is no longer available.","终端不再可用。"],
    [5835,"Command information is not available.","命令信息不可用。"],
    [5836,"Show Output","显示输出"],
    [5837,"Hide Output","隐藏输出"],
    [5838,"Show Output","显示输出"],
    [5839,"Show and Focus Terminal","显示并聚焦终端"],
    [5840,"Focus Terminal","聚焦终端"],
    [5841,"Focus Terminal","聚焦终端"],
    [5842,"Allow and Review","允许和审阅"],
    [5845,"Allow and Skip Reviewing Result","允许并跳过审阅结果"],
    [5851,"Allow","允许"],
    [5852,"Skip Results","跳过结果"],
    [5853,"Approve Tool Result","审批工具结果"],
    [5854,"No results to display","没有可显示的结果"],
    [5855,"No displayable results","无可显示结果"],
    [5856,"Contributes chat context integrations to the chat widget.","向聊天小组件提供聊天上下文集成。"],
    [5857,"A unique identifier for this item.","此项的唯一标识符。"],
    [5858,"The icon associated with this chat context item.","与此聊天上下文项关联的图标。"],
    [5859,"A user-friendly name for this item which is used for display in menus.","此项的用户友好名称，用于在菜单中显示。"],
    [5880,"All Session Changes","所有会话更改"],
    [5896,"View All Changes","查看所有更改"],
    [5917,"Keep","保留"],
    [5918,"Undo","撤消"],
    [5926,"The current editor is currently being modified","当前编辑器正在被修改"],
    [5930,"The cursor is inside a change range made by chat editing.","光标位于聊天编辑所做的更改范围内。"],
    [5971,"Loading...","正在加载..."],
    [5982,"{0} line {1}","{0} 第 {1} 行"],
    [5983,"{0} lines {1} to {2}","{0} 第 {1} 至 {2} 行"],
    [6007,"1 file ready to merge","1 个文件可合并"],
    [6008,"{0} files ready to merge","{0} 个文件可合并"],
    [6010,"Worktree Changes","工作树更改"],
    [6030,"Chat Management Editor","聊天管理编辑器"],
    [6031,"Models Management Editor","模型管理编辑器"],
    [6032,"Manage Language Models","管理语言模型"],
    [6033,"Clear Models Search Results","清除模型搜索结果"],
    [6034,"The color of the Chat Management editor splitview sash border.","聊天管理编辑器拆分视图窗体边框的颜色。"],
    [6035,"Usage","使用情况"],
    [6036,"Models","模型"],
    [6037,"Sections","部分"],
    [6039,"Free","免费"],
    [6040,"Upgrade to Copilot Pro+","升级到 Copilot Pro+"],
    [6041,"Upgrade to Copilot Pro","升级到 Copilot Pro"],
    [6042,"Upgrade to Copilot Pro","升级到 Copilot Pro"],
    [6043,"Use AI Features","使用 AI 功能"],
    [6044,"Enable more AI Features","启用更多 AI 功能"],
    [6045,"Enable AI Features","启用 AI 功能"],
    [6046,"Sign in to use AI Features","登录以使用 AI 功能"],
    [6052,"Icon of the AI Management editor label.","AI 管理编辑器标签的图标。"],
    [6053,"Icon of the Models Management editor label.","模型管理编辑器标签的图标。"],
    [6054,"Manage Copilot","管理 Copilot"],
    [6055,"Language Models","语言模型"],
    [6056,"Visible","可见"],
    [6057,"Hidden","隐藏"],
    [6058,"Multiplier","乘数"],
    [6059,"Context Size","上下文大小"],
    [6060,"Input","输入"],
    [6061,"Output","输出"],
    [6062,"Capabilities","功能"],
    [6063,"Tools","工具"],
    [6064,"Vision","视觉"],
    [6065,"Agent Mode","智能体模式"],
    [6066,"Filter","筛选器"],
    [6067,"Group by {0}","按 {0} 分组"],
    [6068,"Filter by {0}","按 {0} 筛选"],
    [6069,"Filter by {0}","按 {0} 筛选"],
    [6070,"Filter by {0}","按 {0} 筛选"],
    [6071,"Visible","可见"],
    [6072,"Hidden","已隐藏"],
    [6073,"Tools","工具"],
    [6074,"Vision","视觉"],
    [6075,"Agent Mode","智能体模式"],
    [6076,"Provider","提供商"],
    [6077,"Visibility","可见性"],
    [6079,"Expand","展开"],
    [6080,"Collapse","折叠"],
    [6081,"Hide","隐藏"],
    [6082,"Show","显示"],
    [6083,"Hide in the chat model picker","在聊天模型选取器中隐藏"],
    [6084,"Show in the chat model picker","在聊天模型选取器中显示"],
    [6085,"This model is hidden in the chat model picker","此模型在聊天模型选取器中隐藏"],
    [6086,"Every chat message counts {0} towards your premium model request quota","每条聊天消息计入你的高级模型请求额度 {0}"],
    [6087,"Context Size","上下文大小"],
    [6088,"Input","输入"],
    [6089,"Output","输出"],
    [6090,"Tools","工具"],
    [6091,"Vision","视觉"],
    [6092,"Manage {0}...","管理 {0}..."],
    [6093,"Type to search...","键入以搜索..."],
    [6094,"Clear Search","清除搜索"],
    [6096,"Add Models...","添加模型..."],
    [6097,"Name","名称"],
    [6098,"Provider","提供商"],
    [6099,"Context Size","上下文大小"],
    [6100,"Capabilities","功能"],
    [6101,"Multiplier","乘数"],
    [6102,"{0} Models","{0} 提供程序"],
    [6103,"Visible Models","可见模型"],
    [6104,"Hidden Models","隐藏的模型"],
    [6105,"{0} from {1}","{0}，来自 {1}"],
    [6106,"Context size: {0} input tokens and {1} output tokens","上下文大小：{0} 个输入 Token，{1} 个输出 Token"],
    [6107,"Capabilities: {0}","功能：{0}"],
    [6108,"Every chat message counts {0} towards your premium model request quota","每条聊天消息计入你的高级模型请求额度 {0}"],
    [6109,"This model is visible in the chat model picker","此模型在聊天模型选择器中可见"],
    [6110,"This model is hidden in the chat model picker","此模型在聊天模型选择器中隐藏"],
    [6111,"Language Models","语言模型"],
    [6112,"Manage {0}...","管理 {0}..."],
    [6113,"Inline Suggestions","内联建议"],
    [6114,"Chat messages","聊天消息"],
    [6115,"Inline Suggestions","内联建议"],
    [6116,"Chat messages","聊天消息"],
    [6117,"Premium requests","高级请求"],
    [6118,"Additional paid premium requests enabled.","已启用其他付费高级请求。"],
    [6119,"Allowance resets {0}.","限额重置为 {0}。"],
    [6120,"Included","已包含"],
    [6121,"Included","已包含"],
    [6122,"Limited","受限"],
    [6165,"By continuing with {0} Copilot, you agree to {1}'s [Terms]({2}) and [Privacy Statement]({3})","继续使用 {0} Copilot 即表示你同意 {1} 的[条款]({2})和[隐私声明]({3})"],
    [6166,"Approve results of {0}? Result: ","是否批准 {0} 的结果?结果:"],
    [6173,"Icon identifier (codicon ID) for the chat session editor tab. For example, \"$(github)\" or \"$(cloud)\".","聊天会话编辑器选项卡的图标标识符(codicon ID)。例如 \"$(github)\" 或 \"$(cloud)\"。"],
    [6174,"Icon path when a light theme is used","使用浅色主题时的图标路径"],
    [6175,"Icon path when a dark theme is used","使用深色主题时的图标路径"],
    [6176,"Order in which this item should be displayed.","此项的显示顺序。"],
    [6177,"Alternative identifiers for backward compatibility.","用于向后兼容的备用标识符。"],
    [6178,"Title text to display in the chat welcome view for this session type.","要在此会话类型的聊天欢迎视图中显示的标题文本。"],
    [6179,"Message text (supports markdown) to display in the chat welcome view for this session type.","要在此会话类型的聊天欢迎视图中显示的消息文本(支持 Markdown)。"],
    [6180,"Tips text (supports markdown and theme icons) to display in the chat welcome view for this session type.","要在此会话类型的聊天欢迎视图中显示的提示文本(支持 Markdown 和主题图标)。"],
    [6181,"Placeholder text to display in the chat input box for this session type.","要在此会话类型的聊天输入框中显示的占位符文本。"],
    [6185,"Whether this chat session supports attaching MCP resources.","此聊天会话是否支持附加 MCP 资源。"],
    [6186,"Whether this chat session supports attaching images.","此聊天会话是否支持附加图像。"],
    [6187,"Whether this chat session supports attaching search results.","此聊天会话是否支持附加搜索结果。"],
    [6188,"Whether this chat session supports attaching instructions.","此聊天会话是否支持附加指令。"],
    [6189,"Whether this chat session supports attaching source control changes.","此聊天会话是否支持附加源代码管理更改。"],
    [6190,"Whether this chat session supports attaching problems.","此聊天会话是否支持附加问题。"],
    [6191,"Whether this chat session supports attaching symbols.","此聊天会话是否支持附加符号。"],
    [6192,"Commands available for this chat session, which the user can invoke with a `/`.","可用于此聊天会话的命令，用户可使用 `/` 进行调用。"],
    [6193,"A short name by which this command is referred to in the UI, e.g. `fix` or `explain` for commands that fix an issue or explain code. The name should be unique among the commands provided by this participant.","在 UI 中引用此命令时使用的短名称，例如使用 `fix` 或 `explain` 引用可修复问题或解释代码的命令。名称在此参与者提供的命令中应是唯一的。"],
    [6194,"A description of this command.","此命令的说明。"],
    [6195,"A condition which must be true to enable this command.","启用命令时必须为 true 的条件。"],
    [6196,"Whether delegation is supported. Default is false. Note that enabling this is experimental and may not be respected at all times.","是否支持委派。默认值为 true。"],
    [6197,"Create chat session","创建聊天会话"],
    [6200,"Waiting for confirmation: {0}","正在等待确认：{0}"],
    [6202,"New {0} with Prompt","新建带提示的 {0}"],
    [6204,"New {0}","新建 {0}"],
    [6205,"Pick Option","选择选项"],
    [6208,"Agent Sessions","智能体会话"],
    [6209,"Agent Sessions","智能体会话"],
    [6210,"1 session","1 个会话"],
    [6211,"{0} sessions","{0} 个会话"],
    [6212,"Last Activity: {0}","上一个活动: {0}"],
    [6214,"History","历史记录"],
    [6216,"More...","更多..."],
    [6222,"Chat setup failed. Would you like to try again?","聊天设置失败。要重试吗？"],
    [6224,"Explain","解释"],
    [6226,"Code Review","代码审查"],
    [6227,"Generate Docs","生成文档"],
    [6228,"Generate Tests","生成测试"],
    [6229,"Enabling AI features","正在启用 AI 功能"],
    [6230,"Disabling AI features","正在禁用 AI 功能"],
    [6231,"Use AI Features with Copilot for free...","通过 Copilot 免费使用 AI 功能..."],
    [6232,"Sign in to use AI features","登录以使用 AI 功能"],
    [6233,"Sign in to use AI features...","登录以使用 AI 功能..."],
    [6234,"Upgrade to GitHub Copilot Pro","升级到 GitHub Copilot Pro"],
    [6236,"Manage GitHub Copilot Overages","管理 GitHub Copilot 超额用量"],
    [6238,"Learn How to Hide AI Features","了解如何隐藏 AI 功能"],
    [6239,"Getting chat ready...","正在准备聊天..."],
    [6240,"Failed to sign in to {0}. Would you like to try again?","登录 {0} 失败。要重试吗？"],
    [6241,"You must be signed in to use AI features.","必须登录才能使用 AI 功能。"],
    [6243,"An error occurred while setting up chat. Would you like to try again?","设置聊天时发生错误。要重试吗？"],
    [6245,"What is your {0} instance?","你的 {0} 实例是什么？"],
    [6246,"i.e. \"octocat\" or \"https://octocat.ghe.com\"...","例如 \"octocat\" 或 \"https://octocat.ghe.com\"..."],
    [6247,"Will resolve to {0}","将解析为 {0}"],
    [6248,"You must enter a valid {0} instance (i.e. \"octocat\" or \"https://octocat.ghe.com\")","必须输入有效的 {0} 实例（例如 \"octocat\" 或 \"https://octocat.ghe.com\"）"],
    [6250,"Scaffold a new workspace in VS Code","在 VS Code 中搭建新工作区"],
    [6251,"You need to set up GitHub Copilot and be signed in to use Chat.","需要设置 GitHub Copilot 并登录才能使用聊天。"],
    [6252,"You need to trust this workspace to use Chat.","需要信任此工作区才能使用聊天。"],
    [6253,"Getting chat ready...","正在准备聊天..."],
    [6254,"Failed to get a response. Please try again.","获取回复失败。请重试。"],
    [6255,"Chat is almost ready...","聊天即将准备就绪..."],
    [6256,"Chat took too long to get ready. Please ensure that the extension `{0}` is installed and enabled.","准备聊天耗时过长。请确保已安装并启用扩展 `{0}`。"],
    [6257,"Chat took too long to get ready. Please ensure you are signed in to {0} and that the extension `{1}` is installed and enabled.","准备聊天耗时过长。请确保已登录 {0}，并已安装和启用扩展 `{1}`。"],
    [6258,"Signing in to {0}...","正在登录 {0}..."],
    [6259,"Getting chat ready...","正在准备聊天..."],
    [6260,"Chat setup failed.","聊天设置失败。"],
    [6261,"Generate","生成"],
    [6262,"Modify","修改"],
    [6264,"Explain","解释"],
    [6265,"Modify","修改"],
    [6266,"Generate","生成"],
    [6267,"Explain","解释"],
    [6269,"Ask questions about VS Code","询问有关 VS Code 的问题"],
    [6270,"Ask about your workspace","询问有关工作区的问题"],
    [6271,"Ask how to do something in the terminal","询问如何在终端中执行操作"],
    [6272,"AI features are currently only supported in trusted workspaces.","AI 功能目前仅在受信任的工作区中受支持。"],
    [6273,"Continue with {0}","使用 {0} 继续"],
    [6274,"Continue with {0}","使用 {0} 继续"],
    [6275,"Continue with {0}","使用 {0} 继续"],
    [6276,"Continue with {0}","使用 {0} 继续"],
    [6277,"Use AI Features","使用 AI 功能"],
    [6278,"Skip for now","暂时跳过"],
    [6279,"Start using AI Features","开始使用 AI 功能"],
    [6280,"Enable more AI features","启用更多 AI 功能"],
    [6281,"Sign in to use AI Features","登录以使用 AI 功能"],
    [6282,"Start using AI Features","开始使用 AI 功能"],
    [6283,"By continuing, you agree to {0}'s [Terms]({1}) and [Privacy Statement]({2}).","继续操作即表示你同意 {0} 的[条款]({1})和[隐私声明]({2})。"],
    [6284,"By continuing, you agree to {0}'s [Terms]({1}) and [Privacy Statement]({2}). {3} Copilot may show [public code]({4}) suggestions and use your data to improve the product. You can change these [settings]({5}) anytime.","继续操作即表示你同意 {0} 的[条款]({1})和[隐私声明]({2})。{3} Copilot 可能显示[公共代码]({4})建议，并使用你的数据改进产品。你可以随时更改这些[设置]({5})。"],
    [6285,"Gauge foreground color.","仪表前景色。"],
    [6286,"Gauge background color.","仪表背景色。"],
    [6287,"Gauge border color.","仪表边框颜色。"],
    [6288,"Gauge warning foreground color.","仪表警告前景色。"],
    [6289,"Gauge warning background color.","仪表警告背景色。"],
    [6290,"Gauge error foreground color.","仪表错误前景色。"],
    [6291,"Gauge error background color.","仪表错误背景色。"],
    [6292,"Copilot Usage","Copilot 用量"],
    [6293,"Manage Chat","管理聊天"],
    [6294,"Manage Chat","管理聊天"],
    [6295,"Inline Suggestions","内联建议"],
    [6296,"Chat messages","聊天消息"],
    [6297,"Premium requests","高级请求"],
    [6298,"Allowance resets {0}.","额度将于 {0} 重置。"],
    [6299,"Upgrade to GitHub Copilot Pro","升级到 GitHub Copilot Pro"],
    [6300,"Copilot Usage","Copilot 用量"],
    [6301,"Limited","有限"],
    [6302,"Inline Suggestions","内联建议"],
    [6303,"Limited","有限"],
    [6304,"Chat messages","聊天消息"],
    [6305,"Agent Sessions","智能体会话"],
    [6306,"View Agent Sessions","查看智能体会话"],
    [6307,"View Agent Sessions","查看智能体会话"],
    [6308,"$(loading~spin) {0} in progress","$(loading~spin) {0} 正在进行"],
    [6309,"Inline Suggestions","内联建议"],
    [6312,"Model: {0}","模型：{0}"],
    [6316,"By continuing with {0} Copilot, you agree to {1}'s [Terms]({2}) and [Privacy Statement]({3})","继续使用 {0} Copilot 即表示你同意 {1} 的[条款]({2})和[隐私声明]({3})"],
    [6317,"Set up Copilot to use AI features.","设置 Copilot 以使用 AI 功能。"],
    [6318,"Sign in to enable more Copilot AI features.","登录以启用更多 Copilot AI 功能。"],
    [6319,"Enable Copilot to use AI features.","启用 Copilot 以使用 AI 功能。"],
    [6320,"Sign in to use Copilot AI features.","登录以使用 Copilot AI 功能。"],
    [6321,"Use AI Features","使用 AI 功能"],
    [6322,"Enable more AI Features","启用更多 AI 功能"],
    [6323,"Enable AI Features","启用 AI 功能"],
    [6324,"Sign in to use AI Features","登录以使用 AI 功能"],
    [6327,"Manage paid premium requests","管理付费高级请求"],
    [6328,"Included","已包含"],
    [6329,"+{0} requests","+{0} 次请求"],
    [6331,"Additional paid premium requests enabled.","已启用额外的付费高级请求。"],
    [6332,"Additional paid premium requests disabled.","已禁用额外的付费高级请求。"],
    [6333,"All files","所有文件"],
    [6335,"Next edit suggestions","下一处编辑建议"],
    [6336,"Cancel Snooze","取消暂时隐藏"],
    [6337,"Hide suggestions for 5 min","隐藏建议 5 分钟"],
    [6338,"Hide inline suggestions for 5 min","隐藏内联建议 5 分钟"],
    [6340,"Inline suggestions are hidden for the remaining duration","在剩余时间内隐藏内联建议"],
    [6341,"+5 min","+5 分钟"],
    [6342,"Snooze additional 5 min","再暂时隐藏 5 分钟"],
    [6343,"Currently selected","当前已选择"],
    [6344,"Select a model for {0}","为 {0} 选择模型"],
    [6345,"Copilot status","Copilot 状态"],
    [6346,"Finish Setup","完成设置"],
    [6347,"Copilot disabled","Copilot 已禁用"],
    [6348,"{0} agent sessions in progress","{0} 个智能体会话正在进行"],
    [6349,"1 agent session in progress","1 个智能体会话正在进行"],
    [6350,"Signed out","已退出登录"],
    [6351,"Chat quota reached","已达到聊天额度上限"],
    [6352,"Inline suggestions quota reached","已达到内联建议额度上限"],
    [6353,"Quota reached","已达到额度上限"],
    [6354,"Inline suggestions disabled","内联建议已禁用"],
    [6355,"Inline suggestions snoozed","内联建议已暂时隐藏"],
    [6356,"Copilot Status","Copilot 状态"],
    [6357,"You've reached the limit for chat messages. Try Copilot Pro for free.","你已达到聊天消息上限。免费试用 Copilot Pro。"],
    [6360,"You've reached the limit for chat messages.","你已达到聊天消息上限。"],
    [6363,"Recent Sessions","最近的会话"],
    [6364,"All Sessions","所有会话"],
    [6365,"Show All Sessions","显示所有会话"],
    [6366,"Show Recent Sessions","显示最近的会话"],
    [6367,"Recent Sessions","最近的会话"],
    [6368,"All Sessions","所有会话"],
    [6369,"Show All Sessions","显示所有会话"],
    [6370,"Show Recent Sessions","显示最近的会话"],
    [6372,"{0} Agent Session","{0} 智能体会话"],
    [6373,"Chat: {0}","聊天：{0}"],
    [6420,"without approval","未经审批"],
    [6421,"without reviewing result","不查看结果"],
    [6422,"Allow in this Session","在此会话中允许"],
    [6423,"Allow this tool to run in this session without confirmation.","允许此工具在此会话中运行而无需确认。"],
    [6424,"Allow in this Workspace","此工作区中允许"],
    [6425,"Allow this tool to run in this workspace without confirmation.","允许此工具在此工作区中运行而无需确认。"],
    [6426,"Always Allow","始终允许"],
    [6427,"Always allow this tool to run without confirmation.","始终允许此工具运行而无需确认。"],
    [6428,"Allow Tools from {0} in this Session","允许此会话中来自 {0} 的工具"],
    [6429,"Allow all tools from this server to run in this session without confirmation.","允许此服务器中的所有工具在此会话中运行，无需确认。"],
    [6430,"Allow Tools from {0} in this Workspace","允许此工作区中来自 {0} 的工具"],
    [6431,"Allow all tools from this server to run in this workspace without confirmation.","允许此服务器中的所有工具在此工作区中运行，无需确认。"],
    [6432,"Always Allow Tools from {0}","始终允许来自 {0} 的工具"],
    [6433,"Always allow all tools from this server to run without confirmation.","始终允许此服务器中的所有工具运行，无需确认。"],
    [6434,"Allow Without Review in this Session","在此会话中允许，无需审核"],
    [6435,"Allow results from this tool to be sent without confirmation in this session.","允许在此会话中发送此工具的结果，无需确认。"],
    [6436,"Allow Without Review in this Workspace","在此工作区中允许，无需审核"],
    [6437,"Allow results from this tool to be sent without confirmation in this workspace.","允许在此工作区中发送此工具的结果，无需确认。"],
    [6438,"Always Allow Without Review","始终允许，无需审核"],
    [6439,"Always allow results from this tool to be sent without confirmation.","始终允许发送此工具的结果，无需确认。"],
    [6440,"Allow Tools from {0} Without Review in this Session","允许此会话中来自 {0} 的工具，无需审核"],
    [6441,"Allow results from all tools from this server to be sent without confirmation in this session.","允许在此会话中发送来自此服务器的所有工具的结果，无需确认。"],
    [6442,"Allow Tools from {0} Without Review in this Workspace","允许此工作区中来自 {0} 的工具，无需审核"],
    [6443,"Allow results from all tools from this server to be sent without confirmation in this workspace.","允许在此工作区中发送来自此服务器的所有工具的结果，无需确认。"],
    [6444,"Always Allow Tools from {0} Without Review","始终允许来自 {0} 的工具，无需审核"],
    [6445,"Always allow results from all tools from this server to be sent without confirmation.","始终允许发送来自此服务器的所有工具的结果，无需确认。"],
    [6446,"Continue without reviewing any tool results","继续，无需审核任何工具结果"],
    [6447,"Run any tool without approval","在未经批准的情况下运行任何工具"],
    [6448,"Configure for this workspace only","仅为此工作区配置"],
    [6449,"Configure session tool approvals","配置会话工具审批"],
    [6450,"Configure workspace tool approvals","配置工作区工具审批"],
    [6451,"Configure global tool approvals","配置全局工具审批"],
    [6452,"Use VS Code features","使用 VS Code 功能"],
    [6453,"Execute code and applications on your machine","在你的计算机上执行代码和应用程序"],
    [6454,"Read files in your workspace","读取工作区中的文件"],
    [6455,"Allow tool to execute?","允许工具执行吗?"],
    [6456,"Run the '{0}' tool?","是否运行 \"{0}\" 工具?"],
    [6457,"Auto approval for '{0}' is restricted via {1}.","“{0}”的自动审批通过“{1}”受到限制。"],
    [6458,"Auto approval for '{0}' is restricted via {1}.","“{0}”的自动审批通过“{1}”受到限制。"],
    [6468,"Add Premium Models","添加高级模型"],
    [6470,"Add Premium Models","添加高级模型"],
    [6483,"Select the custom agents to open and configure visibility in the agent picker","在智能体选取器中选择要打开并配置可见性的自定义智能体"],
    [6485,"Custom Agents","自定义智能体"],
    [6487,"Configure Custom Agents...","配置自定义智能体..."],
    [6488,"Configure Custom Agents...","配置自定义智能体..."],
    [6494,"New Custom Agent...","新建自定义智能体..."],
    [6501,"Enter the name of the agent file","输入智能体文件的名称"],
    [6504,"Enter a new name of the agent file","输入智能体文件的新名称"],
    [6509,"Select a location to create the agent file in...","选择创建智能体文件的位置..."],
    [6512,"Select a location to move the agent file to...","选择要将智能体文件移动到的位置..."],
    [6515,"Select a location to copy the agent file to...","选择要将智能体文件复制到的位置..."],
    [6518,"Learn how to configure custom agents","了解如何配置自定义智能体"],
    [6521,"No agent source folders found.","找不到智能体来源文件夹。"],
    [6522,"Show help on prompt files","显示有关提示文件的帮助"],
    [6523,"Show help on instruction files","显示有关指令文件的帮助"],
    [6524,"Show help on custom agent files","显示有关自定义智能体文件的帮助"],
    [6528,"Create new custom agent...","创建新的自定义智能体..."],
    [6533,"Hidden from chat view agent picker. Click to show.","对聊天视图的智能体选取器隐藏。单击以显示。"],
    [6534,"Hide from agent picker","在智能体选取器中隐藏"],
    [6536,"Workspace","工作区"],
    [6537,"Agent Instructions","智能体指令"],
    [6538,"Extensions","扩展"],
    [6539,"User Data","用户数据"],
    [6540,"{0} (hidden)","{0} (隐藏)"],
    [6541,"Hidden from chat view agent picker","对聊天视图的智能体选取器隐藏"],
    [6552,"An external application wants to create a custom agent with content from a URL. Do you want to continue by selecting a destination folder and name?","外部应用程序想要创建包含 URL 内容的自定义智能体。是否要通过选择目标文件夹和名称继续操作?"],
    [6562,"Save As Prompt File","另存为提示文件"],
    [6563,"Save as prompt file","另存为提示文件"],
    [6564,"Save As Agent File","另存为智能体文件"],
    [6565,"Save as agent file","另存为智能体文件"],
    [6566,"Save As Instructions File","另存为指令文件"],
    [6567,"Save as instructions file","另存为指令文件"],
    [6586,"Suggested Actions","建议的操作"],
    [6587,"Suggested prompt: {0}, {1}","建议的提示: {0}，{1}"],
    [6590,"Edit Prompt File","编辑提示文件"],
    [6622,"True when focus is in the chat terminal output region.","当焦点位于聊天终端输出区域时为 True。"],
    [6623,"The 'kind' of the current agent.","当前智能体的“类型”。"],
    [6628,"True when the chat agent supports attachments.","当聊天智能体支持附件时为 true。"],
    [6636,"True when the chat is in a contributed chat session that has available 'models' to display.","当聊天处于参与的聊天会话中且该会话有可用的“模型”显示时为 True。"],
    [6640,"True when the current chat session has no requests.","当前聊天会话没有请求时为 true。"],
    [6646,"True when a chat elicitation request is pending.","当聊天诱导请求挂起时为 true。"],
    [6648,"True when the chat has custom agents available.","如果聊天具有可用的自定义智能体，则为 True。"],
    [6649,"True when agent mode is disabled by organization policy.","组织策略禁用智能体模式时为 true。"],
    [6651,"True when the chat session viewer uses the new combined style.","聊天会话查看器使用新的合并样式时为 true。"],
    [6652,"If the agent sessions view in the chat view is limited to show recent sessions only.","聊天视图中的智能体会话视图是否仅显示最近的会话。"],
    [6653,"Orientation of the agent sessions view in the chat view.","聊天视图中智能体会话视图的排列方向。"],
    [6654,"Position of the agent sessions view in the chat view.","聊天视图中智能体会话视图的位置。"],
    [6655,"The type of the current agent session item.","当前智能体会话项的类型。"],
    [6656,"True when the current agent session item has changes.","当前智能体会话项有更改时为 true。"],
    [6657,"True when the agent session item is archived.","智能体会话项已归档时为 true。"],
    [6658,"True when the agent session item is read.","智能体会话项已读时为 true。"],
    [6659,"True when the agent session is currently active (not deletable).","智能体会话当前处于活动状态（不可删除）时为 true。"],
    [6660,"True when focusing a KaTeX math element.","聚焦 KaTeX 数学元素时为 true。"],
    [6661,"Changes to {0} files","对 {0} 个文件的更改"],
    [6676,"New Chat","新建聊天"],
    [6677,"Delete","删除"],
    [6678,"Allow requests to {0}","允许请求 {0}"],
    [6679,"Allow responses from {0}","允许来自 {0} 的响应"],
    [6680,"Allow requests to...","允许请求..."],
    [6681,"Configure URL Approvals...","配置 URL 审批..."],
    [6682,"Select URL pattern to approve","选择要批准的 URL 模式"],
    [6683,"Make requests without confirmation","无需确认即发出请求"],
    [6684,"Allow responses without confirmation","无需确认即允许响应"],
    [6685,"Approve all","全部批准"],
    [6686,"Deny all","全部拒绝"],
    [6687,"requests","请求"],
    [6688,"responses","回复"],
    [6689,"Approves {0}","批准 {0}"],
    [6690,"No approvals","无审批"],
    [6691,"More Options...","更多选项..."],
    [6692,"Open settings","打开设置"],
    [6698,"Condition which must be true to show this language model chat provider in the Manage Models list.","必须为 true 才能在“管理模型”列表中显示此语言模型聊天提供程序的条件。"],
    [6708,"{0} of {1} binary data","{0} 二进制数据(共 {1})"],
    [6710,"Contributes {0} for chat prompts.","为聊天提示提供 {0}。"],
    [6711,"Identifier for this file. Must be unique within this extension for this contribution point.","此文件的标识符。对于此贡献点，在此扩展中必须唯一。"],
    [6712,"Path to the file relative to the extension root.","文件相对于扩展根目录的路径。"],
    [6713,"(Optional) Description of the file.","(可选)文件说明。"],
    [6714,"Extension '{0}' cannot register {1} entry with invalid name '{2}'.","扩展 \"{0}\" 无法注册具有无效名称 \"{2}\" 的 {1} 项。"],
    [6715,"Extension '{0}' cannot register {1} entry '{2}' without path.","扩展 \"{0}\" 无法注册没有路径的 {1} 项 \"{2}\"。"],
    [6716,"Extension '{0}' cannot register {1} entry '{2}' without description.","扩展 \"{0}\" 无法注册没有描述的 {1} 项 \"{2}\"。"],
    [6717,"Extension '{0}' {1} entry '{2}' path resolves outside the extension.","扩展 \"{0}\" 的 {1} 项 \"{2}\" 路径解析在扩展之外。"],
    [6718,"Failed to register {0} entry '{1}': {2}","未能注册 {0} 项 \"{1}\": {2}"],
    [6723,"Instructions for the workspace","针对工作区的指令"],
    [6724,"Instructions for folder '{0}'","针对文件夹 \"{0}\" 的指令"],
    [6726,"Rename to 'agent'","重命名为 \"agent\""],
    [6727,"Migrate to custom agent file","迁移到自定义智能体文件"],
    [6728,"Update to '{0}'","更新到 \"{0}\""],
    [6729,"Expand to {0} tools","展开为 {0} 个工具"],
    [6730,"Update all tool names","更新所有工具名称"],
    [6731,"Add Prompt Header","添加提示标头"],
    [6732,"Handoff Example","转接"],
    [6733,"The name of the instruction file as shown in the UI. If not set, the name is derived from the file name.","UI 中显示的指令文件的名称。如果未设置，则名称从文件名派生。"],
    [6734,"The description of the instruction file. It can be used to provide additional context or information about the instructions and is passed to the language model as part of the prompt.","指令文件的说明。它可用于提供有关指令的其他上下文或信息，并传递到语言模型作为提示的一部分。"],
    [6735,"One or more glob pattern (separated by comma) that describe for which files the instructions apply to. Based on these patterns, the file is automatically included in the prompt, when the context contains a file that matches one or more of these patterns. Use `**` when you want this file to always be added.\nExample: `**/*.ts`, `**/*.js`, `client/**`","一个或多个 glob 模式(用逗号分隔)，用于描述指令应用于哪些文件。根据这些模式，当上下文包含与其中一个或多个模式匹配的文件时，该文件会自动包含在提示中。如果希望始终添加此文件，请使用 `**`。\r\n示例: `**/*.ts`、`**/*.js`、`client/**`"],
    [6736,"The name of the agent as shown in the UI.","智能体在 UI 中显示的名称。"],
    [6737,"The description of the custom agent, what it does and when to use it.","有关自定义智能体及其作用和使用时机的说明。"],
    [6738,"The argument-hint describes what inputs the custom agent expects or supports.","参数提示描述自定义智能体期望或支持的输入。"],
    [6739,"Specify the model that runs this custom agent.","指定运行此自定义智能体的模型。"],
    [6740,"The set of tools that the custom agent has access to.","自定义智能体可访问的工具集。"],
    [6741,"The target to which the header attributes like tools apply to. Possible values are `github-copilot` and `vscode`.","标头属性(如工具)应用的目标。可能的值为 `github-copilot` 和 `vscode`。"],
    [6742,"Whether the agent can be used as a subagent.","该智能体是否可用作子智能体。"],
    [6743,"The name of the prompt. This is also the name of the slash command that will run this prompt.","提示的名称。这也是将运行此提示的 / 命令的名称。"],
    [6744,"The description of the reusable prompt, what it does and when to use it.","有关可重用提示及其作用和使用时机的说明。"],
    [6745,"The argument-hint describes what inputs the prompt expects or supports.","参数提示描述提示期望或支持的输入。"],
    [6746,"The model to use in this prompt.","要在此提示中使用的模型。"],
    [6747,"The tools to use in this prompt.","要在此提示中使用的工具。"],
    [6748,"ToolSet: {0}\n\n","工具集: {0}\r\n\r\n"],
    [6749,"Note: This attribute is not used when target is github-copilot.","注意: 当目标是 github-copilot 时，不使用此属性。"],
    [6750,"- Name: {0}","- 名称: {0}"],
    [6751,"- Family: {0}","- 系列: {0}"],
    [6752,"- Vendor: {0}","- 供应商: {0}"],
    [6753,"Built-in agent","内置智能体"],
    [6754,"Custom agent","自定义智能体"],
    [6755,"The agent to use when running this prompt.","运行此提示时要使用的智能体。"],
    [6756,"**Built-in agents:**","**内置智能体:**"],
    [6757,"**Custom agents:**","**自定义智能体:**"],
    [6758,"Custom agent","自定义智能体"],
    [6759,"Possible handoff actions when the agent has completed its task.","智能体完成任务后可能的转接操作。"],
    [6760,"Note: This attribute is not used when target is github-copilot.","注意: 当目标是 github-copilot 时，不使用此属性。"],
    [6761,"Chat modes have been renamed to agents. Please move this file to {0}","聊天模式已重命名为智能体。请将此文件移动到 {0}"],
    [6762,"Chat modes have been renamed to agents. Please move the file to {0}","聊天模式已重命名为智能体。请将该文件移动到 {0}"],
    [6763,"Invalid file reference '{0}'.","无效的文件引用“{0}”。"],
    [6764,"File '{0}' not found at '{1}'.","在“{1}”中找不到文件“{0}”。"],
    [6765,"Tool or toolset '{0}' has been renamed, use '{1}' instead.","工具或工具集 \"{0}\" 已重命名，请改用 \"{1}\"。"],
    [6766,"Tool or toolset '{0}' has been renamed, use the following tools instead: {1}","工具或工具集 '{0}' 已重命名，请改用以下工具：{1}"],
    [6767,"Unknown tool or toolset '{0}'.","未知工具或工具集“{0}”。"],
    [6768,"Tool or toolset '{0}' also needs to be enabled in the header.","工具或工具集 \"{0}\" 也需要在标头中启用。"],
    [6769,"Attribute '{0}' is not supported in prompt files. Supported: {1}.","提示文件中不支持属性“{0}”。受支持: {1}。"],
    [6770,"Attribute '{0}' is not supported in custom GitHub Copilot agent files. Supported: {1}.","自定义 GitHub Copilot 智能体文件中不支持属性 \"{0}\"。受支持: {1}。"],
    [6771,"Attribute '{0}' is ignored when running locally in VS Code.","在 VS Code 本地运行时忽略属性 \"{0}\"。"],
    [6772,"Attribute '{0}' is not supported in VS Code agent files. Supported: {1}.","VS Code 智能体文件中不支持属性 \"{0}\"。受支持: {1}。"],
    [6773,"Attribute '{0}' is not supported in instructions files. Supported: {1}.","指令文件中不支持属性“{0}”。受支持: {1}。"],
    [6774,"The 'name' attribute must be a string.","\"name\" 属性必须是字符串。"],
    [6775,"The 'name' attribute must not be empty.","\"name\" 属性不得为空。"],
    [6776,"The 'description' attribute must be a string.","\"description\" 属性必须是字符串。"],
    [6777,"The 'description' attribute should not be empty.","\"description\" 属性不得为空。"],
    [6778,"The 'argument-hint' attribute must be a string.","\"argument-hint\" 属性必须是字符串。"],
    [6779,"The 'argument-hint' attribute should not be empty.","\"argument-hint\" 属性不得为空。"],
    [6780,"The 'model' attribute must be a string.","\"model\" 属性必须是字符串。"],
    [6781,"The 'model' attribute must be a non-empty string.","\"model\" 属性必须是非空字符串。"],
    [6782,"Unknown model '{0}'.","未知模型 \"{0}\"。"],
    [6783,"Model '{0}' is not suited for agent mode.","模型“{0}”不适用于代理模式。"],
    [6784,"The 'mode' attribute has been deprecated. The 'agent' attribute is used instead.","\"mode\" 属性已弃用。改用 \"agent\" 属性。"],
    [6785,"The 'mode' attribute has been deprecated. Please rename it to 'agent'.","\"mode\" 属性已弃用。请将其重命名为 \"agent\"。"],
    [6786,"The '{0}' attribute must be a string.","\"{0}\" 属性必须是字符串。"],
    [6787,"The '{0}' attribute must be a non-empty string.","\"{0}\" 属性必须是非空字符串。"],
    [6788,"Unknown agent '{0}'. Available agents: {1}.","未知智能体 \"{0}\"。可用智能体: {1}。"],
    [6789,"The 'tools' attribute is only supported when using agents. Attribute will be ignored.","在使用智能体时仅支持 \"tools\" 属性。将忽略属性。"],
    [6790,"The 'tools' attribute must be an array.","\"tools\" 属性必须是数组。"],
    [6791,"Each tool name in the 'tools' attribute must be a string.","\"tools\" 属性中的每个工具名称都必须是字符串。"],
    [6792,"Tool or toolset '{0}' has been renamed, use '{1}' instead.","工具或工具集 \"{0}\" 已重命名，请改用 \"{1}\"。"],
    [6793,"Tool or toolset '{0}' has been renamed, use the following tools instead: {1}","工具或工具集 '{0}' 已重命名，请改用以下工具：{1}"],
    [6794,"Unknown tool '{0}'.","未知工具 \"{0}\"。"],
    [6795,"The 'applyTo' attribute must be a string.","\"applyTo\" 属性必须是字符串。"],
    [6796,"The 'applyTo' attribute must be a valid glob pattern.","\"applyTo\" 属性必须是有效的 glob 模式。"],
    [6797,"The 'applyTo' attribute must be a valid glob pattern.","\"applyTo\" 属性必须是有效的 glob 模式。"],
    [6798,"The 'applyTo' attribute must be a valid glob pattern.","\"applyTo\" 属性必须是有效的 glob 模式。"],
    [6799,"The 'excludeAgent' attribute must be an array.","\"excludeAgent\" 属性必须是数组。"],
    [6800,"The 'handoffs' attribute must be an array.","\"handoffs\" 属性必须是数组。"],
    [6801,"Each handoff in the 'handoffs' attribute must be an object with 'label', 'agent', 'prompt' and optional 'send'.","\"handoffs\" 属性中的每个转接必须是包含 \"label\"、\"agent\"、\"prompt\" 和(可选) \"send\" 的对象。"],
    [6802,"The 'label' property in a handoff must be a non-empty string.","转接中的 \"label\" 属性必须是非空字符串。"],
    [6803,"The 'agent' property in a handoff must be a non-empty string.","转接中的 \"agent\" 属性必须是非空字符串。"],
    [6804,"The 'prompt' property in a handoff must be a string.","转接中的 \"prompt\" 属性必须是字符串。"],
    [6805,"The 'send' property in a handoff must be a boolean.","转接中的 \"send\" 属性必须是布尔值。"],
    [6806,"The 'showContinueOn' property in a handoff must be a boolean.","移交中的 'showContinueOn' 属性必须是布尔值。"],
    [6807,"Unknown property '{0}' in handoff object. Supported properties are 'label', 'agent', 'prompt' and optional 'send', 'showContinueOn'.","转接对象中的未知属性 \"{0}\"。支持的属性为 \"label\"、\"agent\"、\"prompt\" 和(可选) \"send\"。"],
    [6808,"Missing required properties {0} in handoff object.","转接对象中缺少的必需属性 {0}。"],
    [6809,"The 'infer' attribute must be a boolean.","'infer' 属性必须是布尔值。"],
    [6810,"The 'target' attribute must be a string.","\"target\" 属性必须是字符串。"],
    [6811,"The 'target' attribute must be a non-empty string.","\"target\" 属性必须是非空字符串。"],
    [6812,"The 'target' attribute must be one of: {0}.","\"target\" 属性必须是以下项之一: {0}。"],
    [6813,"User Data","用户数据"],
    [6814,"Extension: {0}","扩展: {0}"],
    [6853,"Run Subagent","运行子智能体"],
    [6854,"Run a task within an isolated subagent context to enable efficient organization of tasks and context window management.","在隔离的子智能体上下文中运行任务，以便高效组织任务并管理上下文窗口。"],
    [6855,"Delegate tasks to other agents","将任务委派给其他智能体"],
    [6942,"Write your global rules for Agent here","在此编写智能体的全局规则"],
    [6943,"[[Click]] to add this file to .gitignore","[[点击]]将此文件添加到 .gitignore"],
    [6944,"This file should contain a JSON object specifying your MCP config.","此文件应包含一个指定 MCP 配置的 JSON 对象。"],
    [6971,"Go to Offset","转到偏移"],
    [6973,"Go to Offset...","转到偏移..."],
    [7086,"Editor overview ruler decoration color for comment threads with draft comments. This color should be opaque.","编辑器概述标尺修饰颜色，用于草稿评论的评论线程。此颜色应不透明。"],
    [7089,"Editor gutter decoration color for commenting glyphs for comment threads with draft comments.","编辑器装订线修饰颜色，用于草稿评论的评论线程的评论字形。"],
    [7342,"End ({1}) should be greater than Start ({0})","结束位置 ({1}) 应大于起始位置 ({0})"],
    [7537,"Debug Session...","调试会话..."],
    [7538,"Select debug data to attach","选择要附加的调试数据"],
    [7539,"Expression Value...","表达式值..."],
    [7540,"Watch Expressions","监视表达式"],
    [7541,"All variables in {0}","{0} 中的所有变量"],
    [7542,"Type an expression to evaluate...","输入要计算的表达式..."],
    [7543,"No active debug session","没有活动的调试会话"],
    [7544,"No result","无结果"],
    [7545,"Evaluation error","求值错误"],
    [7613,"&&ToggleSource","&&切换源"],
    [7898,"To customize Run and Debug [create a launch.json file]({0}).","要自定义运行和调试，请[创建一个 launch.json 文件]({0})。"],
    [7899,"To customize Run and Debug, [open a folder]({0}) and create a launch.json file.","要自定义运行和调试，请[打开文件夹]({0})并创建一个 launch.json 文件。"],
    [8039,"Search loaded scripts by name","按名称搜索已加载的脚本"],
    [8283,"Controls the timeout in milliseconds for HTTP requests made when fetching extensions from the Marketplace","控制从商城获取扩展时发出 HTTP 请求的超时时间(毫秒)"],
    [8405,"{0} for the Web","用于 Web 的 {0}"],
    [8535,"All GitHub Copilot functionality is now being served from the GitHub Copilot Chat extension. To temporarily opt out of this extension unification, toggle the {0} setting.","所有 GitHub Copilot 功能现在均通过 GitHub Copilot 对话助手扩展提供。若要暂时选择退出统一此扩展，请切换 {0} 设置。"],
    [8722,"Some extensions are disabled because they are not allowed by your system administrator.","由于系统管理员不允许，部分扩展已被禁用。"],
    [8723,"Some extensions are disabled because they are configured not to be allowed.","由于配置不允许，部分扩展已被禁用。"],
    [8759,"This extension is not compatible with {0}.","此扩展与 {0} 不兼容。"],
    [9338,"Response was empty","响应为空"],
    [9342,"Generate code","编辑、重构和生成代码"],
    [9343,"Modify selected code","修改所选代码"],
    [9344,"Working...","正在运行..."],
    [9345,"Fix the attached problems","修复附加的问题"],
    [9346,"Fix the attached problem","修复附加的问题"],
    [9347,"Inline Chat to Panel Chat","从内联聊天到面板聊天"],
    [9348,"Do you want to continue in Chat view?","是否要在“聊天”视图中继续操作?"],
    [9349,"Do you want to continue in Chat view?","是否要在“聊天”视图中继续操作?"],
    [9350,"Inline chat is designed for making single-file code changes. Continue your request in the Chat view or rephrase it for inline chat.","内联聊天旨在进行单文件代码更改。在“聊天”视图中继续你的请求，或重新表述请求来进行内联聊天。"],
    [9351,"Continue in Chat view","在“聊天”视图中继续"],
    [9352,"Cancel","取消"],
    [9353,"Don't ask again","不再询问"],
    [9354,"Reset Choice for 'Move Inline Chat to Panel Chat'","“将内联聊天移至面板聊天”的重置选择"],
    [9355,"Thank you for your feedback!","感谢提供反馈！"],
    [9358,"By continuing with {0} Copilot, you agree to {1}'s [Terms]({2}) and [Privacy Statement]({3})","继续使用 {0} Copilot 即表示你同意 {1} 的[条款]({2})和[隐私声明]({3})"],
    [9372,"Whether an agent for notebook cells exists","是否存在适用于笔记本单元格的智能体"],
    [9373,"Whether an agent for notebook cells exists","是否存在适用于笔记本单元格的智能体"],
    [9456,"{0} handles feedback outside of Github.","{0} 在 Github 以外处理反馈。"],
    [9457,"Thanks you for helping us improve {0}! To open the issue/feedback reporter for {0}, click the button below.","感谢你帮助我们改进 {0}！要打开 {0} 的问题或反馈报告工具，请点击下方按钮。"],
    [9544,"{0} Artifacts View","{0} 产物视图"],
    [9545,"{0} Artifacts View","{0} 产物视图"],
    [9548,"&&Reload","&&重新加载"],
    [9549,"{0} Review Changes","{0} 审核更改"],
    [9550,"Clear and Disable Workbench Tracing","清除并禁用工作台跟踪"],
    [9551,"(Re)Enable Workbench Tracing","（重新）启用工作台跟踪"],
    [9631,"Language Packs","语言包"],
    [9662,"Download {0} Diagnostics","下载 {0} 诊断信息"],
    [9664,"Get {0} Diagnostics","获取 {0} 诊断信息"],
    [9666,"Open {0} Extension Logs Folder","打开 {0} 扩展日志文件夹"],
    [9683,"Foreground color for note alerts in markdown.","Markdown 中“备注”提示的前景色。"],
    [9684,"Foreground color for tip alerts in markdown.","Markdown 中“使用技巧”提示的前景色。"],
    [9685,"Foreground color for important alerts in markdown.","Markdown 中“重要信息”提示的前景色。"],
    [9686,"Foreground color for warning alerts in markdown.","Markdown 中“警告”提示的前景色。"],
    [9687,"Foreground color for caution alerts in markdown.","Markdown 中“注意”提示的前景色。"],
    [9847,"Browse MCP Servers","浏览 MCP 服务器"],
    [9858,"Skip Current Autostart","跳过当前自动启动"],
    [9899,"Select the configuration target","选择配置目标"],
    [9923,"Authorization Required","需要授权"],
    [9924,"Open this URL?","是否打开此 URL?"],
    [9926,"Open {0}","打开 {0}"],
    [9928,"This will open {0}","这将打开 {0}"],
    [9930,"Open URL","打开 URL"],
    [9988,"<Empty>","<空>"],
    [9990,"Go back ↩","返回 ↩"],
    [9994,"Install in Workspace","在工作区中安装"],
    [9996,"Workspace Folder","工作区文件夹"],
    [9997,"Workspace","工作区"],
    [9998,"Choose where to install the MCP server","选择 MCP 服务器的安装位置"],
    [9999,"Install (Remote)","安装(远程)"],
    [10000,"Install in {0}","在 {0} 中安装"],
    [10072,"Open Settings","打开“设置”"],
    [10074,"This feature is currently in preview. You can disable it anytime using the setting {0}.","此功能目前为预览版。可以随时通过设置 {0} 将其禁用。"],
    [10075,"Enable MCP Servers Marketplace","启用 MCP 服务器商城"],
    [10076,"Enable MCP Servers Marketplace","启用 MCP 服务器商城"],
    [10077,"Enable MCP Servers Marketplace?","是否启用 MCP 服务器商城?"],
    [10078,"This feature is currently in preview. You can disable it anytime using the setting {0}.","此功能目前为预览版。可以随时通过设置 {0} 将其禁用。"],
    [10079,"Enable","启用"],
    [10080,"Cancel","取消"],
    [10081,"No MCP Servers found.","找不到 MCP 服务器。"],
    [10097,"This MCP Server is disabled because MCP servers are configured to be disabled in the Editor. Please check your [settings]({0}).","此 MCP 服务器处于禁用状态，因为在编辑器中已将 MCP 服务器配置为禁用。请检查你的 [设置]({0})。"],
    [10098,"This MCP Server is disabled because it is configured to be disabled in the Editor. Please check your [settings]({0}).","此 MCP 服务器处于禁用状态，因为它在编辑器中配置为禁用。请检查你的 [设置]({0})。"],
    [10099,"This MCP Server is disabled because it is configured to be disabled in the Editor. Please check your [settings]({0}).","此 MCP 服务器处于禁用状态，因为它在编辑器中配置为禁用。请检查你的 [设置]({0})。"],
    [10103,"Expected 'when' to be a non-empty string.","\"when\" 应为非空字符串。"],
    [10110,"Antigravity configurations (`~/.codeium/antigravity/mcp_config.json`)","Antigravity 配置 (`~/.codeium/antigravity/mcp_config.json`)"],
    [10133,"Condition which must be true to enable this collection.","启用此集合时必须为 true 的条件。"],
    [10345,"Go to Next Change","转到下一个更改"],
    [10346,"Go to Previous Change","转到上一个更改"],
    [10410,"Find Next","查找下一个"],
    [10411,"Find Previous","查找上一个"],
    [10494,"Save Image","保存图像"],
    [10495,"Image Files","图像文件"],
    [10815,"Mimetypes","MIME 类型"],
    [10843,"Icon to save content to disk","用于将内容保存到磁盘的图标"],
    [11076,"General editor, workbench, and feature preferences","常规编辑器、工作台和功能首选项"],
    [11078,"Open Antigravity settings panel","打开 Antigravity 设置面板"],
    [11079,"Select Settings to Open","选择要打开的设置"],
    [11169,"{0} Settings","{0} 设置"],
    [11201,"Advanced","高级"],
    [11229,"Advanced","高级"],
    [11304,"Stable","稳定"],
    [11305,"Show stable settings","显示稳定版设置"],
    [11306,"Preview","预览"],
    [11307,"Show preview settings","显示预览设置"],
    [11308,"Experimental","实验性"],
    [11309,"Show experimental settings","显示实验版设置"],
    [11310,"Advanced","高级"],
    [11311,"Show advanced settings","显示高级设置"],
    [11380,"Advanced setting: this setting is intended for advanced scenarios and configurations. Only modify this if you know what it does.","高级设置: 此设置适用于高级场景和配置。只有在了解其作用时才修改。"],
    [11426,"Ask in Chat: {0}","在聊天中提问: {0}"],
    [11427,"Configure visibility","配置可见性"],
    [11812,"Multiple repositories can be selected at the same time.","可同时选择多个存储库。"],
    [11813,"Only one repository can be selected at a time.","一次只能选择一个存储库。"],
    [11814,"Controls the selection mode of the repositories in the Source Control Repositories view.","控制“源代码管理存储库”视图中存储库的选择模式。"],
    [11815,"Controls whether to show repository artifacts in the Source Control Repositories view. This feature is experimental and only works when {0} is set to `{1}`.","控制是否在“源代码管理存储库”视图中显示存储库工件。此功能是试验性的，仅当 {0} 设置为 `{1}` 时生效。"],
    [11828,"Controls whether to show incoming changes in the Source Control Graph view.","控制是否在“源代码管理图”视图中显示传入的更改。"],
    [11829,"Controls whether to show outgoing changes in the Source Control Graph view.","控制是否在“源代码管理图”视图中显示传出的更改。"],
    [11838,"Resolve Conflicts with AI","使用 AI 解决冲突"],
    [11880,"Incoming Changes","传入的更改"],
    [11881,"Outgoing Changes","传出的更改"],
    [11900,"Incoming Changes","传入的更改"],
    [11901,"Outgoing Changes","传出的更改"],
    [11913,"Incoming Changes","传入的更改"],
    [11914,"Outgoing Changes","传出的更改"],
    [11927,"Select Single Repository","选择单个存储库"],
    [11928,"Select Multiple Repositories","选择多个存储库"],
    [11984,"{0} ↔ {1} (Replace Preview)","{0} ↔ {1}（替换预览）"],
    [12381,"Task \"{0}\" finished in {1}.","任务 \"{0}\" 已在 {1} 中完成。"],
    [12382,"Task finished in {0}.","任务已在 {0} 中完成。"],
    [12383,"{0}m {1}s","{0} 分钟 {1} 秒"],
    [12384,"{0}m","{0} 分钟"],
    [12385,"{0}s","{0} 秒"],
    [12525,"Controls the minimum task runtime in milliseconds before showing an OS notification when the task finishes while the window is not in focus. Set to -1 to disable notifications. Set to 0 to always show notifications. This includes a window badge as well as notification toast.","控制在任务已完成且窗口未聚焦的情况下，距离显示 OS 通知的最短任务运行时间(毫秒)。设置为 -1 可禁用通知。设置为 0 则始终显示通知。这包括窗口徽章和通知横幅。"],
    [12624,"Controls whether to preserve the task name in the terminal after task completion.","控制在任务完成后是否在终端中保留任务名称。"],
    [12907,"Copy Selection (No Warning)","复制所选内容（不显示警告）"],
    [13012,"Show hidden chat terminals","显示隐藏的聊天终端"],
    [13013,"{0} Hidden Terminal","{0} 个隐藏终端"],
    [13014,"{0} Hidden Terminals","{0} 个隐藏终端"],
    [13015,"Show 1 hidden chat terminal","显示 1 个隐藏的聊天终端"],
    [13016,"Show {0} hidden chat terminals","显示 {0} 个隐藏的聊天终端"],
    [13048,"Attach To Chat","附加到聊天"],
    [13059,"Unknown","未知"],
    [13060,"Running","正在运行"],
    [13066,"Command executed {0} ","命令已执行 {0}"],
    [13075,"Defines terminal completion providers that will be registered when the extension activates.","定义扩展激活时将注册的终端补全提供程序。"],
    [13076,"A description of what the completion provider does. This will be shown in the settings UI.","对补全提供程序的作用的描述。该描述会显示在“设置”UI 中。"],
    [13091,"Highlight below the word for which a hover is shown. The color must not be opaque so as not to hide underlying decorations.","在下面突出显示悬停的字词。颜色必须透明，以免隐藏下面的修饰效果。"],
    [13246,"Configures the duration in milliseconds to wait for shell integration after launch before declaring it's not there. Set to {0} to wait the minimum time (500ms), the default value {1} means the wait time is variable based on whether shell integration injection is enabled and whether it's a remote window. Consider setting this to a small value if you intentionally disabled shell integration, or a large value if your shell starts very slowly.","配置启动后等待 shell 集成的时长(毫秒)，超过该时间则声明其不存在。设置为 {0} 以等待最短时间(500ms)，默认值 {1} 表示等待时间会根据是否启用 shell 集成注入及是否为远程窗口而变化。如果有意禁用 shell 集成，建议将其设置为较小的值；如果 shell 启动非常慢，建议将其设置为较大的值。"],
    [13247,"When shell integration is enabled, enables quick fixes for terminal commands that appear as a lightbulb or sparkle icon to the left of the prompt.","启用 shell 集成后，会为提示符左侧显示为灯泡或闪光图标的终端命令启用快速修复。"],
    [13256,"Simulated latency in milliseconds applied to all calls made to the pty host. This is useful for testing terminal behavior under high latency conditions.","对 pty 主机发出的所有调用都应用了模拟延迟(毫秒)。这有助于测试终端在高延迟情况下的行为。"],
    [13257,"Simulated startup delay in milliseconds for the pty host process. This is useful for testing terminal initialization under slow startup conditions.","pty 主机进程的模拟启动延迟(毫秒)。这有助于测试终端在缓慢启动情况下的初始化表现。"],
    [13258,"Enable developer mode for the terminal. This shows additional debug information and visualizations for shell integration sequences.","为终端启用开发人员模式。这会显示额外的调试信息和 shell 集成序列的可视化内容。"],
    [13261,"Whether a terminal in the Agent panel is focused.","智能体面板中的终端是否已聚焦。"],
    [13289,"Focus Terminal","聚焦终端"],
    [13307,"Reveal Command in Terminal","在终端中显示命令"],
    [13351,"Whether there are any chat terminals.","是否存在聊天终端。"],
    [13352,"Whether there are any hidden chat terminals.","是否存在隐藏的聊天终端。"],
    [13369,"Chat: Focus Most Recent Terminal","聊天：聚焦最近的终端"],
    [13370,"Chat: Focus Most Recent Terminal Output","聊天：聚焦最近的终端输出"],
    [13384,"View Hidden Chat Terminals","查看隐藏的聊天终端"],
    [13385,"Terminal","终端"],
    [13386,"Last: {0}","上次: {0}"],
    [13387,"Select a chat terminal to show and focus","选择要显示并聚焦的聊天终端"],
    [13388,"Chat Terminals","聊天终端"],
    [13394,"Allow All Commands in this Session","允许此会话中的所有命令"],
    [13395,"Allow this tool to run in this session without confirmation.","允许此工具在此会话中运行而无需确认。"],
    [13400,"Auto approved for this session","已对此会话自动审批"],
    [13401,"Disable","禁用"],
    [13402,"Web content may contain malicious code or attempt prompt injection attacks.","Web 内容可能包含恶意代码或尝试提示注入攻击。"],
    [13403,"View rule in settings","在设置中查看规则"],
    [13404,"Auto approved by setting {0}","已通过设置 {0} 自动审批"],
    [13405,"View settings","查看设置"],
    [13406,"Auto approved by rule {0}","已通过规则 {0} 自动审批"],
    [13407,"Auto approved by rule {0}","已通过规则 {0} 自动审批"],
    [13408,"Auto approved by rules {0}","已通过规则 {0} 自动审批"],
    [13409,"Auto approval denied by rule {0}","已通过规则 {0} 拒绝自动审批"],
    [13410,"Auto approval denied by rule {0}","已通过规则 {0} 拒绝自动审批"],
    [13411,"Auto approval denied by rules {0}","已通过规则 {0} 拒绝自动审批"],
    [13412,"File write operations detected that cannot be auto approved: {0}","检测到无法自动批准的文件写入操作: {0}"],
    [13413,"File write operations detected: {0}","检测到文件写入操作: {0}"],
    [13434,"Confirm Terminal Command","确认终端命令"],
    [13435,"Tool for confirming terminal commands","用于确认终端命令的工具"],
    [13451,"A task `{0}` with command `{1}`{2} will be created.","将创建任务 `{0}`，命令为 `{1}`{2}。"],
    [13461,"Task not found: `{0}`","找不到任务：`{0}`"],
    [13462,"The task `{0}` is already running.","任务 `{0}` 已在运行。"],
    [13463,"Task started but no terminal was found for: `{0}`","任务已启动，但未找到 `{0}` 对应的终端。"],
    [13464,"Task started but no terminal was found for: `{0}`","任务已启动，但未找到 `{0}` 对应的终端。"],
    [13465,"Task not found: `{0}`","找不到任务：`{0}`"],
    [13466,"The task is already running.","任务已在运行。"],
    [13467,"`{0}` is already running.","`{0}` 已在运行。"],
    [13468,"`{0}` was already running.","`{0}` 原本已在运行。"],
    [13469,"Running `{0}`","正在运行 `{0}`"],
    [13470,"Started `{0}`","已启动 `{0}`"],
    [13471,"Ran `{0}`","已运行 `{0}`"],
    [13472,"Allow task run?","是否允许任务运行?"],
    [13473,"Allow to run the task `{0}`?","是否允许运行任务 `{0}`?"],
    [13480,"A path to a shell executable.","shell 可执行文件的路径。"],
    [13481,"Controls whether to allow auto approval in the run in terminal tool.","控制在终端工具中的运行中是否允许自动审批。"],
    [13482,"Controls whether to allow auto approval in the run in terminal tool.","控制在终端工具中的运行中是否允许自动审批。"],
    [13487,"Note that there's a default set of rules to allow and also deny commands. Consider setting {0} to {1} to ignore all default rules to ensure there are no conflicts with your own rules. Do this at your own risk, the default denial rules are designed to protect you against running dangerous commands.","请注意，系统有一组默认规则用于允许和拒绝命令。建议将 {0} 设置为 {1} ，以忽略所有默认规则，确保不会与你自己的规则发生冲突。这样做需要自行承担风险，默认的拒绝规则旨在防止你运行危险命令。"],
    [13504,"Whether to ignore the built-in default auto-approve rules used by the run in terminal tool as defined in {0}. When this setting is enabled, the run in terminal tool will ignore any rule that comes from the default set but still follow rules defined in the user, remote and workspace settings. Use this setting at your own risk; the default auto-approve rules are designed to protect you against running dangerous commands.","是否如 {0} 中所定义，忽略终端工具中的运行使用的内置默认自动批准规则。启用此设置后，终端工具中的运行将忽略默认规则集中的所有规则，但仍会遵循用户设置、远程设置和工作区设置中定义的规则。使用此设置需要自行承担风险，默认自动批准规则旨在防止你运行危险命令。"],
    [13505,"Allow all detected file writes.","允许所有检测到的文件写入。"],
    [13506,"Block file writes detected outside the workspace. This depends on the shell integration feature working correctly to determine the current working directory of the terminal.","阻止在工作区外检测到的文件写入。这依赖于 shell 集成功能正常工作，以确定终端的当前工作目录。"],
    [13507,"Block all detected file writes.","阻止所有检测到的文件写入。"],
    [13508,"Controls whether detected file write operations are blocked in the run in terminal tool. When detected, this will require explicit approval regardless of whether the command would normally be auto approved. Note that this cannot detect all possible methods of writing files, this is what is currently detected:\n\n- File redirection (detected via the bash or PowerShell tree sitter grammar)","控制是否在终端工具的运行过程中阻止检测到的文件写入操作。此类操作在被检测到时，无论命令是否通常会自动批准，都需要获得明确批准。请注意，这无法检测所有可能的文件写入方式，目前检测到的方式包括:\r\n\r\n- 文件重定向(通过 bash 或 PowerShell 的 tree sitter 语法检测)"],
    [13510,"Use {0} instead","请改用 {0}"],
    [13511,"The terminal profile to use on Linux for chat agent's run in terminal tool.","在 Linux 上的聊天智能体在终端工具中运行所使用的终端配置文件。"],
    [13512,"The terminal profile to use on macOS for chat agent's run in terminal tool.","在 macOS 上的聊天智能体在终端工具中运行所使用的终端配置文件。"],
    [13513,"The terminal profile to use on Windows for chat agent's run in terminal tool.","在 Windows 上的聊天智能体在终端工具中运行所使用的终端配置文件。"],
    [13515,"Where to show the output from the run in terminal tool session.","在终端工具会话中显示运行输出的位置。"],
    [13516,"Reveal the terminal when running the command.","运行命令时显示终端。"],
    [13517,"Do not reveal the terminal automatically.","不自动显示终端。"],
    [13640,"Trigger Suggest","触发建议"],
    [13690,"The foreground color for a plaintext suggestion. These icons will appear in the terminal suggest widget.","纯文本建议的前景色。这些图标将显示在终端建议小组件中。"],
    [13709,"Icon for plain text suggestions in the terminal suggest widget.","终端建议小组件中纯文本建议的图标。"],
    [13737,"Controls whether a space is automatically inserted after accepting a suggestion and re-trigger suggestions. Folders and symbolic link folders will never have a trailing space added.","控制在接受建议并重新触发建议后是否自动插入空格。文件夹和符号链接文件夹从不添加尾随空格。"],
    [13739,"Show suggestions from {0}.","显示来自 {0} 的建议。"],
    [13741,"Controls which suggestions automatically show up while typing. Suggestion providers are enabled by default.","控制在键入时自动显示哪些建议。建议提供程序默认启用。"],
    [13750,"Would you like to enable the speech extension?","是否要启用语音扩展?"],
    [13751,"Enable Extension","启用扩展"],
    [13752,"Would you like to install 'VS Code Speech' extension from 'Microsoft'?","是否要从 \"Microsoft\" 安装 \"VS Code Speech\" 扩展?"],
    [13753,"Install Extension","安装扩展"],
    [13754,"Microphone support requires this extension.","麦克风支持需要此扩展。"],
    [13778,"Go to Next Uncovered Line","转到未覆盖的下一行"],
    [13779,"Go to Previous Uncovered Line","转到未覆盖的上一行"],
    [13786,"Navigate to the next line that is not covered by tests.","导航到测试未覆盖的下一行。"],
    [13787,"Navigate to the previous line that is not covered by tests.","导航到测试未覆盖的上一行。"],
    [13911,"Toggle Tree Position","切换树位置"],
    [14075,"Controls the layout of the Test Results view.","控制“测试结果”视图的布局。"],
    [14076,"Show the test run tree on the right side with details on the left.","在右侧显示测试运行树，在左侧显示详细信息。"],
    [14077,"Show the test run tree on the left side with details on the right.","在左侧显示测试运行树，在右侧显示详细信息。"],
    [14628,"Onboarding","入门"],
    [14709,"Accept an Autocomplete","接受自动补全"],
    [14710,"Tab to accept an Autocomplete","按 Tab 接受自动补全"],
    [14711,"Trigger Command","触发命令"],
    [14712,"Trigger Command","触发命令"],
    [14715,"Open Documentation","打开文档"],
    [14716,"Open Documentation","打开文档"],
    [14717,"Finish IDE Setup","完成 IDE 设置"],
    [14718,"Finish IDE Setup","完成 IDE 设置"],
    [14719,"Sign in to {0}","登录 {0}"],
    [14720,"Sign in to {0}","登录 {0}"],
    [14721,"Accept an Autocomplete","接受自动补全"],
    [14722,"Tab to accept an Autocomplete","按 Tab 接受自动补全"],
    [14723,"Trigger Command","触发命令"],
    [14724,"Trigger Command","触发命令"],
    [14749,"By continuing with {0} Copilot, you agree to {1}'s [Terms]({2}) and [Privacy Statement]({3})","继续使用 {0} Copilot 即表示你同意 {1} 的[条款]({2})和[隐私声明]({3})"],
    [14931,"If you'd like to explore an untrusted workspace with the agent, we recommend enabling strict mode via the settings window. See the [strict mode docs](https://antigravity.google/docs/strict-mode) for details.","如果想让智能体探索不受信任的工作区，建议在设置窗口中启用严格模式。详情请参阅[严格模式文档](https://antigravity.google/docs/strict-mode)。"],
    [15070,"Show Content Tracing","显示内容跟踪"],
    [15083,"Close Active Window","关闭活动窗口"],
    [15092,"Close Other Windows","关闭其他窗口"],
    [15176,"Migrate Old Settings","迁移旧设置"],
    [15177,"Migrate Old Conversations","迁移旧对话"],
    [15214,"{0} on {1} will soon stop receiving updates. Consider upgrading your macOS version.","{1} 上的 {0} 将很快停止接收更新。请考虑升级 macOS 版本。"],
    [15248,"The Source Control repository menu","源代码管理存储库菜单"],
    [15257,"The Source Control artifact group context menu","源代码管理工件组上下文菜单"],
    [15258,"The Source Control artifact context menu","源代码管理工件上下文菜单"],
    [15300,"A prominent button overlaying the multi diff editor","覆盖在多差异编辑器上的醒目按钮"],
    [15306,"The Chat Editing widget toolbar menu for session changes.","用于会话更改的聊天编辑小组件工具栏菜单。"],
    [15308,"Menu for new chat sessions.","新建聊天会话菜单。"],
    [15536,"Folder path","文件夹路径"],
    [15649,"{0} for the Web","用于 Web 的 {0}"],
    [16329,"Settings dropdown icon.","设置下拉菜单图标。"],
  ];

  // Only patch untranslated entries in the verified IDE 2.6.0 workbench layout.
  // English source checks prevent overwriting a different language pack or a new IDE version.
  function applyIdeNlsMessages() {
    if (!window.location?.pathname?.endsWith('workbench.html') ||
        typeof window._VSCODE_NLS_LANGUAGE !== 'string' ||
        window._VSCODE_NLS_LANGUAGE.toLowerCase() !== 'zh-cn') return;
    const messages = window._VSCODE_NLS_MESSAGES;
    if (!Array.isArray(messages) || messages.length !== 16558 ||
        messages[3864] !== 'Used to represent onboardingsteps which have not been completed' ||
        messages[3865] !== 'Used to represent onboarding steps which have been completed' ||
        messages[3866] !== 'Code with Agent') return;
    for (const [index, original, translated] of ideNlsSupplement) {
      if (messages[index] !== original) continue;
      const custom = customTranslations.get(original.trim().toLowerCase());
      const replacement = custom === undefined ? formatZhText(translated) : (custom || original);
      if (replacement === original) continue;
      try {
        messages[index] = replacement;
        if (messages[index] === replacement) ideNlsChanges.push({ messages, index, original, translated: replacement });
      } catch (_e) { /* Some workbenches may expose read-only localization data. */ }
    }
  }

  function restoreIdeNlsMessages() {
    for (const { messages, index, original, translated } of ideNlsChanges) {
      try { if (messages[index] === translated) messages[index] = original; } catch (_e) { /* ignore */ }
    }
    ideNlsChanges = [];
  }

  const phrases = new Map([
    ["How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.", "介绍如何管理和创建插件。插件通过命名空间将技能、智能体、规则、MCP 服务器和钩子打包为一个整体，以便安装、启用和停用。当用户需要启用、停用、安装、卸载或创建插件，或者希望把新自定义项打包为插件时使用此技能。/plugin 斜杠命令也会触发此技能。不要将其用于底层自定义系统本身，例如发现根目录、加载优先级，或在插件外独立编写技能、智能体、规则、钩子或 MCP 服务器；这些情况请参阅自定义指南技能。"],
    ["How to write and run a dynamic workflow script with the `run_workflow` tool: a Python script that orchestrates many agents with `agent`, `parallel`, `pipeline`, and `phase`. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows).", "介绍如何使用 `run_workflow` 工具编写和运行动态工作流脚本：通过 Python 脚本中的 `agent`、`parallel`、`pipeline` 和 `phase` 协调多个智能体。当任务可分成多个独立或分阶段的智能体工作（例如按文件、模块、缺陷或审查角度分发后再汇总），或者用户要求使用工作流时使用此技能。不要将其用于单个委派任务（请使用子智能体）或旧版工作流文件（请参阅 migrate-workflows）。"],
    ["Teamwork Graph CLI is Atlassian's agent-first interface to your entire work context: Jira issues, Confluence pages, Bitbucket PRs, along with your connected third-party data sources. Purpose-built for coding agents like Antigravity (terminal or desktop), and powered by Atlassian's context graph. Try: \"draft a Jira issue from this PR and link it to the epic.\" Run /twg-setup after install to connect Atlassian Teamwork Graph CLI to Antigravity.", "Teamwork Graph CLI 是 Atlassian 面向智能体的工作上下文接口，可访问 Jira 问题、Confluence 页面、Bitbucket 拉取请求和已连接的第三方数据源。它基于 Atlassian 上下文图谱，专为 Antigravity 等终端或桌面编程智能体构建。试着说：“根据此拉取请求起草 Jira 问题并将其关联到史诗任务。”安装后运行 /twg-setup，将 Atlassian Teamwork Graph CLI 连接到 Antigravity。"],
    ["Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.", "提供 Google Antigravity (AGY) 的全面指南、快速参考与站点地图，包括 Antigravity CLI (agy)、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及自定义项（技能、规则、MCP、Sidecar）。当用户询问如何使用、配置或自定义 Antigravity、AGY、agy CLI、Antigravity IDE 或 Antigravity 2.0 时激活此技能。"],
    ["Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin. Use when the user wants to bring over, import, or migrate their setup or config from another agent or tool. Don't use for installing Marketplace plugins or authoring a new plugin from scratch (use the plugin skill).", "将用户在其他编码智能体（Claude Code、Codex、Cursor、Gemini CLI）中的 MCP 服务器、技能、斜杠命令、子智能体和指令文件迁移到一个新的 Antigravity 插件。当用户希望从其他智能体或工具导入或迁移其设置、配置时使用。不要用于安装插件市场中的插件或从头创建新插件（请使用 plugin 技能）。"],
    ["Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.", "在每个分组中，模型共享每周限额和 5 小时限额。额度的消耗与 Token 的成本成比例。因此，使用较短的任务或更具性价比的模型可以让限额维持更久。5 小时限额平滑了总体需求，以便在所有用户之间公平地分配全局容量，而您的每周限额则直接与您的个人套餐等级挂钩。"],
    ["Allow the agent to automatically view and edit files outside the current workspace. Use with caution: this gives the agent access to additional potentially-relevant information, but also allows the agent to access credential files, secrets, and other files outside of the workspace that could be targeted in prompt injection attacks or other exploits by malicious actors.", "允许智能体自动查看和编辑当前工作区之外的文件。请谨慎使用：此操作虽可让智能体获取更多潜在相关上下文，但也会使其能够访问工作区外的凭据、机密文件等，可能在提示词注入攻击或其他恶意漏洞利用中带来风险。"],
    ["When enabled, Agent can use browser tools to open URLs, read web pages, and interact with browser content. This allows the Agent access to important (and often critical) knowledge and methods of validation, but any browser integration does increase exposure to external malicious parties for security exploits.", "启用后，智能体可以使用浏览器工具打开 URL、读取网页并与浏览器内容交互。这能让智能体获取重要知识和验证方式，但任何浏览器集成都可能增加遭受外部恶意利用的风险。"],
    ["Give each Best of N fork its own clone of your Git repository instead of a copy-on-write overlay. Each fork is then a real repository, so commits it makes are kept when you choose it as the winner. Forks take longer to create, and the wait grows with the size of your repository. See go/jetski-best-of-n.", "为每个 Best of N 分支提供独立的 Git 仓库克隆，而非写时复制叠加层。每个分支都是真实仓库，因此在您将其选为优胜方案后会保留其提交记录。创建分支耗时更长，且等待时间随仓库体积增加。"],
    ["Let the agent use browser tools to open URLs, read web pages, and interact with browser content. This allows the agent access to important (and often critical) knowledge and methods of validation, but any browser integration does increase exposure to external malicious parties for security exploits.", "允许智能体使用浏览器工具打开网址、读取网页并与网页内容交互。这能让智能体获取重要（甚至关键）的信息与验证手段，但任何浏览器集成都会增加遭受外部恶意攻击与漏洞利用的风险。"],
    ["Let the agent use browser tools to open URLs, read web pages, and interact with browser content. This gives the agent access to important (and often critical) knowledge and methods of validation, but any browser integration does increase exposure to external malicious parties for security exploits.", "允许智能体使用浏览器工具打开 URL、读取网页并与浏览器内容交互。这能让智能体获取重要知识和验证方式，但任何浏览器集成都可能增加遭受外部恶意利用的风险。"],
    ["(Preview & Quota Heavy) Run a swarm: several agents working in parallel on one task, each in its own conversation, collaborating through a shared message board. Use when the work splits into pieces that can be done at the same time, or when a second pair of eyes should check the first pair's work.", "（预览版，额度消耗较高）启动智能体群组：多个智能体并行处理同一项任务，各自使用独立对话，并通过共享消息板协作。当工作可拆分成同时进行的部分，或需要其他智能体复核结果时使用。"],
    ["Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy.", "查找与当前任务相关的界面插件面板，并在对话中提供一键按钮，用于打开或切换侧边面板。当正在运行的界面插件面板有助于用户完成当前工作，或用户刚启用新的界面插件面板、需要快捷打开方式时使用。"],
    ["When enabled, your UI will be slightly modified to ensure more consistent demos. This is only recommended for demo purposes. In most cases, you can run \"Antigravity: Start Demo Mode\" and \"Antigravity: Stop Demo Mode\" to control this switch and update your ~/.gemini/antigravity data directory.", "启用后，您的界面将稍作修改以确保演示的一致性。仅建议用于演示目的。在大多数情况下，您可以运行 “Antigravity: Start Demo Mode” 和 “Antigravity: Stop Demo Mode” 来控制此开关并更新您的 ~/.gemini/antigravity 数据目录。"],
    ["Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here:", "Google 无法控制第三方开发工具的可用性或功能。连接到您的 Antigravity 实例的第三方开发工具中的数据可能会与 Google 共享。Google 将按照以下 Google 隐私权政策保护此类数据："],
    ["Interactive guide to design and create a scheduled background automation. Use this skill when the user wants to create an automated or recurring scheduled task (e.g. \"summarize my emails every morning\", \"every Monday send me a to-do list\"). Also triggered by the /automation slash command.", "设计并创建定时后台自动化任务的交互式指南。当用户希望创建自动执行或定期运行的任务时使用此技能（例如“每天早上汇总我的邮件”“每周一给我发送待办事项清单”）。/automation 斜杠命令也会触发此技能。"],
    ["The agent never asks for confirmation before executing terminal commands (except those in the Deny list). This provides the agent with the maximum ability to operate over long periods without intervention, but also has the highest risk of the agent executing an unsafe terminal command.", "智能体在执行终端命令前从不请求确认（拒绝列表中的命令除外）。这能让智能体在无需干预的情况下最大程度地长时间自主运行，但也具有执行不安全终端命令的最高风险。"],
    ["Agent auto-executes commands matched by an allow list entry. For Unix shells, an allow list entry matches a command if its space-separated tokens form a prefix of the command's tokens. For PowerShell, the entry tokens may match any contiguous subsequence of the command tokens.", "智能体将自动执行与允许列表条目匹配的命令。对于 Unix Shell，如果允许列表条目的空格分隔令牌是该命令令牌的前缀，则匹配。对于 PowerShell，条目令牌可匹配命令令牌的任意连续子序列。"],
    ["How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.", "介绍如何在对话中内嵌或以独立产物形式呈现丰富的交互式 HTML 组件。需要向用户展示图表、数据可视化、交互控件、教学演示，或纯文本和 Markdown 之外的其他丰富视觉内容时使用此技能。"],
    ["Give each Best of N fork a full clone of your workspace, including its local commit history. Choosing a winner then gives your workspace that fork's state, so the commits it made are kept. Forks take longer to create than the default CitC clone. See go/jetski-best-of-n.", "为每个 Best of N 分支提供包含本地提交历史的完整工作区克隆。选出优胜方案后，工作区将采用该分支的状态并保留其提交记录。创建耗时比默认 CitC 克隆更长。"],
    ["Slightly modify your UI to ensure more consistent demos. This is only recommended for demo purposes. In most cases, you can run \"Antigravity: Start Demo Mode\" and \"Antigravity: Stop Demo Mode\" to control this switch and update your ~/.gemini/antigravity data directory.", "微调界面以确保演示效果更加一致。仅建议用于演示目的。大多数情况下，您可以运行“Antigravity: Start Demo Mode”和“Antigravity: Stop Demo Mode”来控制此开关并更新 ~/.gemini/antigravity 数据目录。"],
    ["Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.", "Google Antigravity 自定义系统的全面指南与参考。用于解释自定义项的工作原理、加载优先级、发现机制，并指导技能、规则、插件、钩子及 MCP 服务器的创建。"],
    ["Give your AI agent 600,000+ real app screens, and the skills to use them. Includes the Mobbin MCP and a skill that redesigns your screen from patterns real apps ship, in your own design system, with the references behind every change.", "为人工智能智能体提供超过 60 万个真实应用界面及使用这些界面的技能。包含 Mobbin MCP 和一项技能，可根据真实应用采用的模式，使用您自己的设计系统重新设计界面，并提供每项更改的参考依据。"],
    ["Show a floating notification card when background conversations need your input. Answer questions, approve commands, and grant permissions without leaving your current conversation. Share feedback at go/inline-actions-feedback.", "当后台对话需要您输入时显示浮动通知卡片。无需离开当前对话即可回答问题、批准命令和授予权限。可在 go/inline-actions-feedback 分享反馈。"],
    ["ONLY for the native-swarm worker whose brief says it is the monitor. On a timer, it checks whether the whole swarm has stalled and calls on the one member who can unstick it. Coordinators and other workers: do not load this.", "仅供任务说明中被指定为监控员的原生 Swarm 成员使用。它会定时检查整个群组是否停滞，并请能解除阻碍的成员介入。协调员和其他成员不要加载此技能。"],
    ["AI coding agents are known to have certain security risks, including autonomous code execution, data exfiltration, prompt injection and supply chain risks. Ensure that you monitor and verify all actions taken by the agent.", "AI 编程智能体存在一定的安全风险，包括自主执行代码、数据外传、提示词注入和供应链风险。请确保监控并核实智能体执行的所有操作。"],
    ["Accept payments and grow your business. Stripe's official MCP server enables AI agents to manage customers, products, prices, payment links, invoices, subscriptions, and refunds, as well as search Stripe documentation.", "接受付款并拓展业务。Stripe 官方 MCP 服务器支持人工智能智能体管理客户、产品、价格、付款链接、发票、订阅和退款，并搜索 Stripe 文档。"],
    ["Controls whether terminal commands require your approval before running.  Note: A change to this setting will only apply to new messages sent to the agent. In-progress responses will use the previous setting value.", "控制终端命令在执行前是否需要你的审批。注意：此设置的更改仅适用于向智能体发送的新消息，进行中的响应将继续使用先前的设置。"],
    ["Useful for tasks that require file access across your full machine. The agent has full read and write access to all local files, but all proposed terminal commands require manual review and approval before running.", "适用于需要在整机范围内访问文件的任务。智能体对所有本地文件具有完全读写权限，但在执行任何终端命令前均需手动审查与批准。"],
    ["The breakdown below shows token usage from customizations like rules, skills, and MCP. If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.", "下方明细显示规则、技能和 MCP 等自定义项的 Token 使用量。超出预算时，大型规则会降级为路径指针，大型自定义项会被自动排除。"],
    ["You are logged in using Application Default Credentials (ADC). To log out, undo any changes to ~/.gemini/config/config.json (or unset AGY_ADC_AUTH if launched from terminal) and restart the application.", "你使用应用默认凭据（ADC）登录。如需退出，请撤销对 ~/.gemini/config/config.json 的修改（如果从终端启动，也可取消设置 AGY_ADC_AUTH），然后重启应用。"],
    ["Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.", "自动将全局及工作区配置中的旧工作流迁移为新版技能。会扫描已有工作流、创建目标 SKILL.md 文件，并安全归档旧工作流文件。"],
    ["A high-risk mode that disables all safety barriers. The agent operates with full system access, auto-executes all terminal commands, and reads or writes to all local files without review prompts.", "一种禁用所有安全屏障的高风险模式。智能体将以完全系统访问权限运行，自动执行所有终端命令，读写所有本地文件，且不弹出审查提示。"],
    ["When toggled on, Antigravity IDE will use your AI credits to fulfill model requests once you're out of model quota. Antigravity IDE will always use your model quota first before using AI credits.", "开启后，当模型额度用完时，Antigravity IDE 将使用 AI 积分完成模型请求。Antigravity IDE 始终会先使用模型额度，再使用 AI 积分。"],
    ["Useful for typical development with an emphasis on security. It prioritizes safety over speed by requiring manual approval for all terminal commands and files outside the project directory.", "适用于注重安全性的常规开发场景。通过对所有终端命令和项目目录之外的文件访问强制要求手动审批，安全性优先于速度。"],
    ["Agent asks for permission before executing commands matched by a deny list entry. The deny list follows the same matching rules as the allow list and takes precedence over the allow list.", "在执行与拒绝列表条目匹配的命令前，智能体会先请求权限。拒绝列表遵循与允许列表相同的匹配规则，且优先级高于允许列表。"],
    ["When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.", "开启后，当模型额度用完时，Antigravity 将使用 AI 积分完成模型请求。Antigravity 始终会先使用模型额度，再使用 AI 积分。"],
    ["Enforce settings that prevent the agent from autonomously running targeted exploits and require human review for all agent actions. Visit antigravity.google/docs/strict-mode for details.", "强制启用安全设置，防止智能体自主执行针对性的漏洞利用，并要求所有智能体操作均经过人工审核。详情请访问 antigravity.google/docs/strict-mode。"],
    ["Try out early-stage features before they ship. These may be changed or removed at any time. These features are experimental, and we make no guarantees about performance or functionality.", "在正式发布前试用早期功能。这些功能可能随时更改或移除，属于实验性质，我们不对其性能或功能作任何保证。"],
    ["Automated safeguards help to protect your conversations from insecure or unsafe content. That being said, users should be aware of potential agentic risks, including data exfiltration.", "自动安全措施有助于保护对话免受不安全内容的影响。用户仍应了解智能体可能带来的风险，包括数据外传。"],
    ["View your available model quota and AI credits. Model quota refreshes periodically based on your plan. Enable AI Credit Overages to continue using models when your quota is exhausted.", "查看可用的模型额度和 AI 积分。模型额度会根据你的套餐定期刷新。启用 AI 积分超额使用后，可在额度耗尽时继续使用模型。"],
    ["Agent skills for Neo4j graph database — write Cypher queries, design graph models, use drivers, run imports, build GraphRAG pipelines, run GDS algorithms, and manage Aura instances.", "用于 Neo4j 图数据库的智能体技能：编写 Cypher 查询、设计图模型、使用驱动、导入数据、构建 GraphRAG 流程、运行 GDS 算法和管理 Aura 实例。"],
    ["Databricks skills for the CLI, Apps, Lakebase, Model Serving, Lakeflow Jobs, Spark Declarative Pipelines, Declarative Automation Bundles (DABs), and classic-to-serverless migration.", "适用于 Databricks 命令行、应用、Lakebase、模型服务、Lakeflow 作业、Spark 声明式流水线、声明式自动化包以及从经典架构迁移到无服务器架构的技能。"],
    ["Terminal commands automatically proceed inside the sandbox. A command that needs to leave the sandbox proceeds only if an agent judges it reversible, and otherwise requests review.", "终端命令会在沙盒内自动继续执行。需要脱离沙盒的命令仅在智能体判断其可逆时才会继续执行，否则会请求审核。"],
    ["Adds an Autonomous Mode switch to the modes dropdown below the input box. Turns sent with it on run non-interactively: the agent does not ask questions or request new permissions.", "在输入框下方的模式下拉菜单中添加“自主模式”开关。开启后发送的轮次将以非交互方式运行：智能体不会提问或请求新权限。"],
    ["Please describe the feature you'd like to see. The more detailed the requirements, the easier it will be for our team to incorporate your ideas. Some helpful information includes:", "请描述你希望增加的功能。需求越详细，我们的团队就越容易采纳你的想法。以下信息可能有帮助："],
    ["Sets the `workspaceUri` URL parameter and reloads, repointing the active workspace. Pick a folder from an existing project or enter a custom URI (e.g. file:///path/to/workspace).", "设置 `workspaceUri` URL 参数并重新加载以重定向活动工作区。请从现有项目中选择文件夹，或输入自定义 URI（例如 file:///path/to/workspace）。"],
    ["Your Antigravity use will be associated with provided project. Make sure you trust the project ID before proceeding. Account activity and data may be logged by your organization.", "你的 Antigravity 使用将与所提供的项目关联。继续之前，请确认你信任该项目 ID。你的组织可能会记录账号活动和数据。"],
    ["Verify that these licenses were provided by your administrator and that you trust the project ID before proceeding. Account activity and data may be logged by your organization.", "继续之前，请确认这些许可证由管理员提供，且你信任该项目 ID。你的组织可能会记录账号活动和数据。"],
    ["Use the IDE's shell integration to detect and report terminal command execution. When disabled, the agent uses its own shell. Restart the application for this to take effect.", "使用 IDE 的 Shell 集成来检测并报告终端命令执行情况。禁用时，智能体将使用自带 Shell。重启应用后生效。"],
    ["When enabled, Agent is given awareness of lint errors created by its edits and may fix them without explicit user prompting. Note that this may increase Agent's tool usage.", "启用后，智能体将获悉其编辑产生的 Lint 错误，并可在用户未明确要求的情况下修复这些错误。请注意，这可能增加智能体的工具使用量。"],
    ["Build applications with the Gemini Interactions API and Live API, including text, image, video, and speech generation, managed agents, and real-time multimodal streaming.", "使用 Gemini Interactions API 和 Live API 构建应用，支持文本、图像、视频和语音生成、托管智能体及实时多模态流。"],
    ["Permanently delete your remote conversations, projects, scheduled tasks, connected plugins and settings. Data in the desktop app and your Google account are not affected.", "永久删除你的远程会话、项目、定时任务、已连接的插件及设置。桌面客户端本地数据及你的 Google 账号不受影响。"],
    ["When Turbo mode is on, the agent will automatically capture screenshots in the Browser without explicit user input. You can toggle this setting in Antigravity's settings.", "开启 Turbo 模式后，智能体将在浏览器中自动截图，无需用户明确操作。你可以在 Antigravity 设置中调整此项。"],
    ["The agent never asks for review. This maximizes the autonomy of the agent, but also has the highest risk of the agent operating over unsafe or injected artifact content.", "智能体从不请求审核。这能最大限度提高自主性，但智能体处理不安全或被注入恶意内容的产物时执行操作的风险也最高。"],
    ["The breakdown below shows token usage from customizations like skills, rules, and MCP. If the budget is exceeded, large customizations will be truncated automatically.", "下面的明细展示技能、规则和 MCP 等自定义内容的 Token 使用量。如果超出预算，较大的自定义内容会被自动截断。"],
    ["Agent never asks for review. This maximizes the autonomy of the Agent, but also has the highest risk of the Agent operating over unsafe or injected Artifact content.", "智能体从不请求审核。这能最大限度提高自主性，但智能体处理不安全或被注入恶意内容的产物时执行操作的风险也最高。"],
    ["Connect Antigravity to your Notion workspace with the Notion MCP server, plus skills for research, documentation, meeting prep, specs, trackers, and project updates.", "通过 Notion MCP 服务器将 Antigravity 连接到 Notion 工作区，并使用研究、文档、会议准备、规格说明、跟踪和项目更新技能。"],
    ["Allow Tab to view and edit the files in .gitignore. Use with caution if your .gitignore lists files containing credentials, secrets, or other sensitive information.", "允许 Tab 键查看和编辑 .gitignore 中的文件。如果您的 .gitignore 列出了包含凭据、机密或其他敏感信息的文件，请谨慎使用。"],
    ["Orchestrates Android development tasks including project creation, deployment, SDK management, and environment diagnostics using the `android` command-line tool.", "使用 android 命令行工具协调 Android 开发任务，包括项目创建、部署、SDK 管理和环境诊断。"],
    ["Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.", "配置浏览器子智能体。它需要安装 Google Chrome。你可以在对话输入框中输入 /browser 来调用浏览器子智能体。"],
    ["Connect Antigravity to Dropbox to search, inspect, summarize, share, collect uploads, organize folders, and clean up files with confirmation for write actions.", "将 Antigravity 连接到 Dropbox，以搜索、查看、总结和共享文件，收集上传内容并整理文件夹；写入操作需要确认。"],
    ["Deploy, configure, monitor, and troubleshoot apps, databases, and infrastructure on Railway from Antigravity with Railway's agent skill and hosted MCP server.", "通过 Railway 智能体技能和托管 MCP 服务器，在 Antigravity 中部署、配置、监控和排查 Railway 上的应用、数据库及基础设施。"],
    ["Logs each telemetry event to the browser's DevTools console as it fires, with the click or key that caused it. Stays on across reloads until you turn it off.", "在每个遥测事件触发时将其连同触发它的点击或按键实时输出到浏览器的 DevTools 控制台。跨页面刷新保持生效，直到手动关闭。"],
    ["A permanent Chief of Staff conversation in the sidebar that manages your other conversations: delegate tasks, check status, and read results from one place.", "在侧边栏保留一个统筹助手对话，集中管理其他对话：分派任务、检查状态并查看结果。"],
    ["Add Auth0 authentication to any app: login, MFA, SSO, Organizations, RBAC, custom domains, and branding. Debug auth errors and migrate from other providers.", "为应用添加 Auth0 身份验证，包括登录、多因素认证、单点登录、组织、基于角色的访问控制、自定义域名和品牌设置；排查身份验证错误并从其他提供商迁移。"],
    ["Free users and Google AI Plus users receive the minimum base limits on Antigravity. You can upgrade to Google AI Pro or above to receive higher rate limits.", "免费用户和 Google AI Plus 用户可获得 Antigravity 的最低基础额度。升级到 Google AI Pro 或更高版本可获得更高的速率限制。"],
    ["Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP server.", "通过技能和 MCP 服务器，使用真实 Dynatrace 数据调查生产问题，包括问题及根因、日志、指标、链路追踪和漏洞。"],
    ["Build, publish, and manage WordPress.com and Jetpack-connected sites. Draft posts, edit blocks, check traffic stats, moderate comments, and manage plugins.", "构建、发布和管理 WordPress.com 及连接 Jetpack 的网站，起草文章、编辑区块、查看流量统计、审核评论并管理插件。"],
    ["Build and deploy on Netlify: functions, edge functions, blobs, database, identity, forms, image CDN, caching, and AI Gateway, plus the Netlify MCP server.", "在 Netlify 上构建和部署，使用函数、边缘函数、对象存储、数据库、身份、表单、图像 CDN、缓存、AI 网关及 Netlify MCP 服务器。"],
    ["Uploaded project files and in-chat attachments are stored on Google servers and mounted into your cloud sandbox so your agent can read and work with them.", "上传的项目文件和聊天附件存储在 Google 服务器上，并挂载到你的云端沙盒中，以便智能体读取与处理。"],
    ["Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:", "请详细描述问题。您的反馈越具体，我们的团队就能越快处理您的请求。一些有用的信息包括："],
    ["Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the application menu.", "有新版本可用时自动提示重启应用。禁用后，你可以通过应用程序菜单手动检查更新。"],
    ["When enabled, the agent will be able to access its knowledge base to inform its responses and automatically generate knowledge items in the background.", "启用后，智能体将能够访问其知识库以辅助生成回复，并在后台自动生成知识项。"],
    ["SEO workflows on live Semrush data: keyword research, site audits, backlinks, competitor, traffic and market analytics, PPC, and AI brand visibility.", "基于实时 Semrush 数据执行搜索引擎优化工作流，包括关键词研究、网站审计、反向链接、竞争对手、流量和市场分析、按点击付费广告及人工智能品牌可见度。"],
    ["Use the official CrowdStrike-hosted MCP server to work across Falcon: detections, cases, threat intel, SIEM, hosts, vulnerabilities, cloud, and more.", "使用 CrowdStrike 官方托管的 MCP 服务器处理 Falcon 中的检测、案件、威胁情报、安全信息与事件管理、主机、漏洞和云资源等。"],
    ["Search Intercom conversations, contacts, and companies, spot support trends, and install the Intercom Messenger with secure identity verification.", "搜索 Intercom 对话、联系人和公司，发现支持趋势，并安装具有安全身份验证的 Intercom Messenger。"],
    ["Please describe your auth or billing issue. More details will help our support team resolve your issue quicker. Some helpful information includes:", "请描述你的身份验证或计费问题。更多细节有助于支持团队更快解决问题。以下信息可能有帮助："],
    ["Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.", "当有新版本可用时，自动提示您重启应用。禁用后，您可以从应用菜单中手动检查更新。"],
    ["Plan and track work in monday.com from Antigravity: create, update and assign items, write docs, and build forms that turn requests into items.", "在 Antigravity 中规划和跟踪 monday.com 工作：创建、更新及分配事项，编写文档，并创建将请求转为事项的表单。"],
    ["Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.", "查询最新文档，将指定版本的文档和代码示例直接从源代码仓库引入大语言模型上下文。"],
    ["Build and deploy Base44 full-stack apps: CLI project management, JavaScript/TypeScript SDK development, and production troubleshooting skills.", "构建和部署 Base44 全栈应用，包括命令行项目管理、JavaScript/TypeScript SDK 开发和生产环境排查技能。"],
    ["Specifies the agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.", "指定智能体请求审核产物时的行为。产物是智能体创建的文档，用于提供更丰富的对话体验。"],
    ["You should not enter any sensitive information on this site (for example, passwords or credit cards), because it could be stolen by attackers.", "你不应在此网站上输入任何敏感信息（例如密码或信用卡号），因为这些信息可能被攻击者窃取。"],
    ["Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.", "与 GitHub 交互的指南；当命令因智能体运行环境的限制而失败时，向用户请求权限。"],
    ["Git-on-Borg repository used when creating a new Cog workspace from your initial prompt (e.g., chromium/src or android/platform/superproject).", "用于根据你的初始提示创建 Cog 工作区的 Git-on-Borg 仓库（例如 chromium/src 或 android/platform/superproject）。"],
    ["Give your agent a real browser: navigate, click, type, screenshot, and extract data from any site, locally or on Browserbase cloud browsers.", "为智能体提供真实浏览器，在本地或 Browserbase 云浏览器中导航、点击、输入、截图并提取网站数据。"],
    ["Note: A change to this setting will only apply to new messages sent to the agent. In-progress responses will use the previous setting value.", "注意：对此设置的更改仅适用于发送给智能体的新消息。正在进行的回复仍使用之前的设置值。"],
    ["Remove individual uploaded files or connected resources in Project Settings, or delete a project or conversation to remove its stored files.", "你可以在项目设置中移除单独上传的文件或关联的资源，也可直接删除项目或会话以清理其存储的文件。"],
    ["Rules and customization token budgets exceeded. Large rules are demoted to path pointers and large customizations are excluded from context.", "规则和自定义项的 Token 预算均已超出。较大的规则会降级为路径引用，较大的自定义项将从上下文中排除。"],
    ["Build and deploy web apps and AI agents on Vercel with skills for Next.js, AI SDK, and cloud services, plus the official Vercel MCP server.", "使用 Next.js、AI SDK 和云服务技能以及官方 Vercel MCP 服务器，在 Vercel 上构建和部署网页应用与人工智能智能体。"],
    ["Changes the base URL for marketplace search results. You must restart Antigravity IDE to use the new marketplace after changing this value.", "更改插件市场搜索结果的基准 URL。更改此值后，您必须重启 Antigravity IDE 才能使用新的插件市场。"],
    ["Specifies Agent's behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.", "指定智能体在请求审核产物时的行为。产物是智能体创建的文档，用于提供更丰富的对话体验。"],
    ["The product development system for teams and agents. Manage issues, projects, and documents across your Linear workspace from Antigravity.", "面向团队和智能体的产品开发系统。在 Antigravity 中管理 Linear 工作区的问题、项目和文档。"],
    ["Files, folders, and repositories you connect are accessible to your agent in this project, including during background or scheduled runs.", "你关联的文件、文件夹与代码仓库在当前项目中均可供智能体访问，包括后台任务或定时运行期间。"],
    ["Connect your agent to invideo's AI-native video editor. It trims, grades and mixes on a real timeline while you watch every change land.", "将智能体连接到 invideo 的人工智能视频编辑器，在真实时间线上剪辑、调色和混音，并实时查看每项更改。"],
    ["Note: A change to this setting will only apply to new messages sent to Agent. In-progress responses will use the previous setting value.", "注意：对此设置的更改将仅适用于发送给智能体的新消息。正在进行的回复将使用之前的设置值。"],
    ["Search and read your Wispr Flow meeting notes, transcripts, scratchpad notes, and calendar events. Read-only access to your own account.", "搜索和阅读 Wispr Flow 会议笔记、转录、草稿笔记和日历活动；仅对您自己的账户提供只读访问。"],
    ["Artifacts like Google Docs, PDFs, Office documents (Word, Excel, PowerPoint), etc. Everything else the agent creates is under Artifacts.", "产物包括 Google 文档、PDF 和 Office 文档（Word、Excel、PowerPoint）等。智能体创建的其他内容也位于产物中。"],
    ["Changes the base URL for marketplace search results. You must restart Antigravity to use the new marketplace after changing this value.", "更改插件市场搜索结果的基准 URL。更改此值后，您必须重启 Antigravity 才能使用新的插件市场。"],
    ["Build Wix apps and headless sites, and manage Wix stores, bookings, CMS and more, with Wix CLI skills and the official Wix MCP server.", "使用 Wix CLI 技能和官方 Wix MCP 服务器构建 Wix 应用与无头网站，管理商店、预约和内容管理系统等。"],
    ["Configure allowed and denied URLs for the browser subagent. It runs in the built-in browser, so no separate browser install is needed.", "配置浏览器子智能体允许和拒绝访问的网址。它在内置浏览器中运行，因此无需单独安装浏览器。"],
    ["Create and send proposals, quotes, and contracts for e-signature. Track signing progress and identify documents that need follow-up.", "创建并发送提案、报价和合同以供电子签署，跟踪签署进度并找出需要跟进的文档。"],
    ["Changes the base URL on each extension page. You must restart Antigravity IDE to use the new marketplace after changing this value.", "更改每个插件页面的基准 URL。更改此值后，您必须重启 Antigravity IDE 才能使用新的插件市场。"],
    ["Manage your Bigin CRM from Antigravity: review pipelines, find contacts and deals, log calls, plan follow-ups, and email customers.", "在 Antigravity 中管理 Bigin 客户关系系统：查看销售流程，查找联系人和交易，记录通话，安排跟进并给客户发送邮件。"],
    ["Changes the base URL on each extension page. You must restart Antigravity to use the new marketplace after changing this value.", "更改每个插件页面的基准 URL。更改此值后，您必须重启 Antigravity 才能使用新的插件市场。"],
    ["Enable fine-grained GitHub permissions and define the org, repository, and resource-level access the agent is allowed to use.", "启用细粒度 GitHub 权限，并定义允许智能体使用的组织、仓库和资源级访问权限。"],
    ["When enabled, Agent is given awareness of lint errors created by its edits and may fix them without explicit user prompting.", "启用后，智能体将获悉其编辑产生的 Lint 错误，并可在用户未明确要求的情况下修复这些错误。"],
    ["A chunk is a section of the page. Long pages are chunked so that only the sections that are relevant to your query are read.", "分块是页面的一个部分。较长页面会被分成多个部分，只读取与你的查询相关的部分。"],
    ["Sign in to an app once and your agent can use it on any device. Open an app to see the account it uses or to disconnect it.", "登录一次应用后，智能体即可在任何设备上使用它。打开应用可以查看所用账号或断开连接。"],
    ["Services this plugin connects to on your behalf. Credentials stay on this machine and are only sent to the domains listed.", "此插件代表你连接的服务。凭据保留在本机，只会发送到所列域名。"],
    ["Turn Figma designs into production code, map components with Code Connect, and create or edit Figma files in Antigravity.", "将 Figma 设计转换为生产代码，使用 Code Connect 映射组件，并在 Antigravity 中创建或编辑 Figma 文件。"],
    ["What should the agent do on each run? For example: summarize new bugs assigned to me and anything that changed overnight.", "智能体每次运行时应该做什么？例如：汇总分配给我的新错误和昨晚发生的变更。"],
    ["Choose a predefined security preset for the agent. This controls terminal auto-execution policy, and file access policy.", "为智能体选择预设安全策略。它会控制终端自动执行策略和文件访问策略。"],
    ["This shortcut is reserved by browser tabs and may not trigger in Web mode. It works in the Desktop Hub or installed PWA.", "此快捷键已被浏览器标签页占用，在网页模式下可能无法触发。在桌面客户端或已安装的 PWA 中可正常使用。"],
    ["Always auto-execute commands unless they are in your deny list. This also allows Agent to auto-execute Browser controls.", "始终自动执行命令，拒绝列表中的命令除外。此设置也允许智能体自动执行浏览器操作。"],
    ["Request Review - Agent always asks for confirmation before executing terminal commands (except those in the Allow List)", "请求审核——智能体在执行终端命令前始终请求确认（允许列表中的命令除外）"],
    ["Always Proceed - Agent never asks for confirmation before executing terminal commands (except those in the Deny List)", "始终继续——智能体在执行终端命令前从不请求确认（拒绝列表中的命令除外）"],
    ["Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).", "浏览器用户资料目录的自定义路径。留空则使用默认路径（~/.gemini/antigravity-browser-profile）。"],
    ["No models are available for your current project or account. Please check your project settings and IAM permissions.", "当前项目或账户没有可用的模型。请检查您的项目设置和 IAM 权限。"],
    ["This page is taking longer than expected to load, or it may be blocking embedded views (via X-Frame-Options or CSP).", "此页面加载时间超出预期，或者它通过 X-Frame-Options 或 CSP 阻止了嵌入式视图。"],
    ["You currently don't have any MCP Servers installed. Add an MCP server above or add a custom one via the MCP Config.", "您当前还没有安装任何 MCP 服务器。请在上方添加 MCP 服务器，或通过 MCP 配置文件添加自定义服务器。"],
    ["Connect to your managed Looker MCP server to explore data, run saved Looks, build dashboards, and validate LookML.", "连接到托管的 Looker MCP 服务器，以探索数据、运行已保存的 Look、构建仪表盘并验证 LookML。"],
    ["Recommended: 64,000–256,000 tokens. Actual compaction threshold may differ since max output tokens are subtracted.", "建议范围：64,000–256,000 个 Token。由于会减去最大输出 Token 数，实际压缩阈值可能有所不同。"],
    ["Show how full the context window is next to the send button. Click it for a breakdown and to see your model quota.", "在发送按钮旁显示上下文窗口的使用进度。点击可查看明细及模型配额。"],
    ["The app will be accessible from the menu bar and will keep running in the background when all windows are closed.", "应用可从菜单栏访问，并会在所有窗口关闭后继续在后台运行。"],
    ["A nickname for identifying this application in the companion website. Changing this will restart the connection.", "用于在配套网站中标识此应用的昵称。更改此项将重新建立连接。"],
    ["By default, agents work in folders you choose and ask before sensitive changes. Adjust this anytime in Settings.", "默认情况下，智能体仅在你选定的文件夹中工作，并在执行敏感更改前请求确认。你可随时在设置中调整此项。"],
    ["When enabled, 'Explain and Fix' actions will continue in the current conversation instead of starting a new one.", "启用后，“解释并修复”操作将在当前对话中继续，而不是开始新对话。"],
    ["Go to the machine you are controlling and quit Antigravity. It installs pending updates the next time it starts.", "请在你控制的电脑上退出 Antigravity。下次启动时会安装待处理的更新。"],
    ["Prototype, build & run modern apps that users love with Firebase's backend, AI, and operational infrastructure.", "借助 Firebase 的后端、人工智能和运维基础设施，设计、构建和运行现代应用。"],
    ["Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer", "使用 Chrome DevTools 和 Puppeteer 在 Chrome 中进行可靠的自动化、深度调试和性能分析"],
    ["We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.", "我们建议附上日志。附上日志将有助于 Antigravity 团队处理并优先解决您的反馈。"],
    ["When enabled, the Changes Overview toolbar will automatically expand when Agent finishes generating a response.", "启用后，Changes Overview 工具栏将在智能体完成回复生成时自动展开。"],
    ["A shell setup script run before every command the agent executes in this project. Overrides the global script.", "在智能体于当前项目中执行每条命令前所运行的 Shell 初始化脚本。该设置会覆盖全局脚本。"],
    ["Projects serve as your workspace where your agents work. Each project has its own file scope and permissions. ", "项目是智能体工作的工作区。每个项目都有自己的文件范围和权限。"],
    ["Terminal command automatically proceeds if the command runs inside the sandbox. Otherwise, it requests review.", "如果终端命令在沙盒内运行，则会自动继续执行；否则会请求审核。"],
    ["Install or enable the Google Drive plugin in Customizations to search files with @drive: or paste Drive links", "在“自定义配置”中安装或启用 Google 云端硬盘插件，即可使用 @drive: 搜索文件或直接粘贴云端硬盘链接"],
    ["Find plugins - bundles of skills, agents, MCP servers, UI extensions and more, and install them in one click.", "查找包含技能、智能体、MCP 服务器、界面扩展等内容的插件，并一键安装。"],
    ["Autonomous mode active: the agent works independently and does not ask questions or request new permissions.", "自主模式已开启：智能体将独立工作，不会提问或请求新权限。"],
    ["Agents run in a secure sandbox that restricts access to external resources outside of your trusted folders.", "智能体会在安全沙盒中运行，限制其访问受信任文件夹之外的外部资源。"],
    ["Give the agent awareness of lint errors created by its edits so it can fix them without explicit prompting.", "让智能体感知编辑引入的 Lint 错误，以便无需额外提示即可修复。"],
    ["The agent always asks for confirmation before executing terminal commands (except those in the Allow list).", "智能体在执行终端命令前始终请求确认（允许列表中的命令除外）。"],
    ["Prototype, build & run modern apps users love with Firebase's backend, AI, and operational infrastructure.", "利用 Firebase 的后端、AI 和运营基础设施，原型设计、构建和运行深受用户喜爱的现代应用。"],
    ["Terminal commands always require review and the agent cannot access files outside of its given workspaces.", "终端命令始终需要审核，且智能体无法访问其给定工作区之外的文件。"],
    ["Attackers might be able to see the images you're looking at on this site and trick you by modifying them.", "攻击者可能能够看到你在此网站上浏览的图片，并通过篡改图片来诱骗你。"],
    ["Simulate a different host (Electron, desktop or mobile Web, Extension, remote control, or installed PWA).", "模拟不同的宿主环境（Electron、桌面或移动端网页、浏览器扩展、远程控制或已安装的 PWA）。"],
    ["When enabled, the values below replace the auto-detected OS, host, and user type used for feature gating.", "启用后，下方设置将覆盖系统自动检测到的操作系统、宿主环境与用户群体类型，用于功能灰度与限制模拟。"],
    ["Your information (for example, passwords or credit card numbers) is private when it is sent to this site.", "发送到此网站时，你的信息（例如密码或信用卡号）是私密且受保护的。"],
    ["Select the workspace type that will be used for new conversations started with the New Workspace option.", "选择通过“新建工作区”选项启动新会话时所使用的工作区类型。"],
    ["AI Credits are used when you've exceeded your model quota. Keep track of your current AI Credits in the", "当超出模型配额时将使用 AI 积分。你可以在此处跟踪当前的 AI 积分余额："],
    ["The agent works with autonomy-enhancing features and does not ask questions or request new permissions.", "智能体使用自主增强功能运行，不会提问或请求新权限。"],
    ["This Google Cloud project is not supported. Input a different project, or sign in with another account.", "不支持此 Google Cloud 项目。请输入其他项目，或使用其他账号登录。"],
    ["Developer-only tools. These settings are stored locally in this browser and do not affect other users.", "仅限开发者工具。这些设置保存在当前浏览器本地，不会影响其他用户。"],
    ["to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.", "安装 Google Chrome。您可以在对话输入框中输入 /browser 来调用浏览器子智能体。"],
    ["VCS used when creating a new workspace, including workspaces generated based off your initial prompt.", "创建新工作区（包括根据初始提示词生成的工作区）时使用的 VCS。"],
    ["When enabled, Agent will show browser notifications when user action is needed or execution finishes.", "启用后，当需要用户操作或执行完成时，智能体将显示浏览器通知。"],
    ["When enabled, Agent will use IDE's shell integration to detect and report terminal command execution.", "启用后，智能体将使用 IDE 的 Shell 集成来检测并报告终端命令的执行。"],
    ["When toggled on, Antigravity IDE collects usage data to help Google enhance performance and features.", "开启后，Antigravity IDE 将收集使用数据，以帮助 Google 提升性能和功能。"],
    ["Download this site as an app to get notified when the agent needs your attention or completes a task.", "将此网站作为应用安装，以便在智能体需要关注或完成任务时收到通知。"],
    ["Continue your work from another device with Remote Control. Scan the QR code or open the link below.", "通过远程控制从其他设备继续你的工作。扫描二维码或打开下方链接。"],
    ["Keep the app accessible from the menu bar and running in the background when all windows are closed.", "所有窗口关闭后，仍保持应用在菜单栏中可用并在后台继续运行。"],
    ["Run the app against a Linux environment. Connecting relaunches the app into the selected WSL distro.", "在 Linux 环境中运行应用。连接后会将应用重启到所选的 WSL 发行版。"],
    ["The app is currently connected to a WSL distro. Reopening locally relaunches it directly on Windows.", "应用当前已连接到 WSL 发行版。在本地重新打开将直接在 Windows 上重新启动该应用。"],
    ["Modify scoped permissions, folders, and agent settings like Sandbox and Terminal Command Execution.", "修改作用域权限、文件夹，以及沙盒和终端命令执行等智能体设置。"],
    ["Requires manual review for all terminal commands and file accesses outside of the working folders.", "所有终端命令以及工作文件夹之外的文件访问均需人工审查。"],
    ["When toggled on, Antigravity collects usage data to help Google enhance performance and features.", "开启后，Antigravity 会收集使用数据，帮助 Google 改进性能和功能。"],
    ["Automatically expand the Changes Overview toolbar when the agent finishes generating a response.", "智能体完成回复生成时，自动展开更改概览工具栏。"],
    ["Payments, CRM, accounting, data, identity, customer support, marketing, and workflow automation.", "支付、客户关系管理、会计、数据、身份、客户支持、营销和工作流自动化。"],
    ["Select one of the three options. Agent settings and permissions can be further customized below.", "选择以下三个选项之一。智能体设置和权限可在下方进一步自定义。"],
    ["This conversation grew too large, so the history before this point may be missing or incomplete.", "此对话内容过长，因此该节点之前的历史记录可能缺失或不完整。"],
    ["This page is blocked in the built-in browser by your organization's Context-Aware Access policy.", "此页面因组织的上下文感知访问政策而被内置浏览器阻止。"],
    ["Describe what you want. Your agent plans and builds it, and brings in other agents when needed.", "描述你的诉求。智能体会制定计划并着手构建，必要时还会引入其他智能体协同工作。"],
    ["These allowed domain rules are set by your organization's administrator and cannot be removed.", "这些允许访问的域名规则由你所在组织的管理员设定，无法自行移除。"],
    ["This conversation is also open in another app. Sending messages from both may cause conflicts.", "此对话同时在另一个应用中打开。从两端发送消息可能会导致冲突。"],
    ["Grant read access to workflow runs and allow dispatching workflows on specific files and refs.", "授予读取工作流运行记录的权限，并允许运行指定文件和引用的工作流。"],
    ["These settings can only be changed on the computer running the app, not from a remote session.", "这些设置只能在运行应用的电脑上更改，不能从远程会话更改。"],
    ["Here's how uploaded files, attachments, and connected resources work in your cloud environment", "了解上传的文件、附件及连接的资源如何在云端环境中工作"],
    ["All terminal commands require review. The agent can read or write to any file in the machine.", "所有终端命令均需人工审查。智能体可以读写本机中的任意文件。"],
    ["Continue \"Explain and Fix\" actions in the current conversation instead of starting a new one.", "在当前对话中继续执行“解释并修复”操作，而不是开启新对话。"],
    ["Opens in the in-app preview pane. Some sites don't support iframe embedding and may not load.", "在应用内预览窗格中打开。部分网站不支持内嵌框架，可能无法加载。"],
    ["Run a prompt on a schedule, like a morning summary of yesterday's changes. Runs show up here.", "按计划运行提示词，例如每天早晨汇总昨天的更改。运行记录会显示在这里。"],
    ["Confirm the command is safe to run outside of the sandbox with full network and disk access.", "确认该命令可在沙盒外安全运行，并拥有完整网络和磁盘访问权限。"],
    ["Workflows are saved prompts that Agent can follow. To trigger a workflow, type \"/\" in Agent.", "工作流是智能体可以遵循的已保存提示词。要触发工作流，请在智能体中输入“/”。"],
    ["Your agent's ability to execute commands is also controlled by enterprise security policies.", "你的智能体执行命令的权限同时受企业安全策略管控。"],
    ["Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires", "配置浏览器子智能体（通过 /browser 调用）允许和拒绝访问的网址。需要"],
    ["Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.", "基于 Google 开发平台构建应用，包括 Android、Chrome、Gemini 和 Google Cloud。"],
    ["Enter the configuration values this MCP server needs. Saving restarts the server with them.", "请输入此 MCP 服务器所需的配置值。保存后将以此配置重启服务器。"],
    ["Turn this on for some sick beats. The more Tab suggestions you accept in a row, the better.", "开启后可听到节奏音效；连续接受的 Tab 建议越多，效果越好。"],
    ["Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).", "Chrome DevTools Protocol 远程调试端口号。留空则使用默认值（9222）。"],
    ["Try out early-stage features before they ship. These may change or be removed at any time.", "在正式发布前试用早期功能。这些功能可能随时更改或移除。"],
    ["When enabled, the agent will be able to access past conversations to inform its responses.", "启用后，智能体将能够访问历史对话以辅助其生成回复。"],
    ["Optional branch or ref used when creating a new Cog workspace (defaults to main if unset).", "创建新 Cog 工作区时可选的分支或引用（未设置时默认为 main）。"],
    ["Controls whether the agent can run custom JavaScript to automate complex browser actions.", "控制智能体是否可以运行自定义 JavaScript 来自动化复杂浏览器操作。"],
    ["You are logged in using environment credentials and cannot sign out from the application.", "你使用环境凭据登录，无法在应用中退出登录。"],
    ["You can prompt the model to try again or start a new conversation if the error persists.", "你可以提示模型重试；如果错误仍然存在，请开始新对话。"],
    ["A label for this computer when you connect from another device. Changing it reconnects.", "从其他设备连接时用于标识这台电脑的名称。更改该名称将重新建立连接。"],
    ["Choose whether to be notified when the agent needs your attention or completes a task.", "选择是否在智能体需要您关注或完成任务时收到通知。"],
    ["Create, edit, review, resize, and brand-check Canva designs with the Canva MCP server.", "使用 Canva MCP 服务器创建、编辑、审阅和调整 Canva 设计，并检查品牌一致性。"],
    ["When enabled, Antigravity will play a sound when Agent finishes generating a response.", "启用后，Antigravity 会在智能体完成回复生成时播放提示音。"],
    ["When enabled, the agent will include default customizations, including default skills.", "启用后，智能体将包含默认自定义项（包括默认技能）。"],
    ["Agent can retrieve console logs from the browser and return it for further processing.", "智能体可以读取浏览器控制台日志并返回，以供后续处理。"],
    ["This error is likely temporary. You can prompt the model to try again after some time.", "此错误可能是暂时的。稍后可以提示模型重试。"],
    ["Comment on the plan before your agent starts, and get a walkthrough when it finishes.", "在智能体开始前审查并批注计划，并在完成后获取详细的演练讲解。"],
    ["The agent asks for permission before executing commands matched by a deny list entry.", "智能体在执行匹配拒绝列表条目的命令前，会先请求权限。"],
    ["The browser subagent can be invoked by typing /browser in the conversation input box.", "你可以在对话输入框中输入 /browser 来调用浏览器子智能体。"],
    ["Receive product updates, tips, and promotions from Google Antigravity IDE via email.", "通过电子邮件接收来自 Google Antigravity IDE 的产品更新、技巧和促销活动。"],
    ["Customization token budget exceeded. Large customizations are excluded from context.", "自定义项的 Token 预算已超出。较大的自定义项将从上下文中排除。"],
    ["Allow Gemini to notify you when the agent needs your attention or completes a task.", "允许 Gemini 在智能体需要您关注或完成任务时向您发送通知。"],
    ["Predict the location of your next edit and navigates you there with a tab keypress.", "预测您下一次编辑的位置，并在按下 Tab 键时导航至该处。"],
    ["This skill came from the marketplace, so you can add it again whenever you need it.", "此技能来自市场，你可以在需要时再次添加。"],
    ["Match when the issue component equals or is under the given Buganizer component ID.", "当问题组件等于指定 Buganizer 组件 ID 或位于其下时匹配。"],
    ["You cannot sign out from Remote Control. Please sign out on your local application.", "无法通过远程控制退出登录。请在本地应用中退出登录。"],
    ["Predict the location of your next edit and navigate you there with a tab keypress.", "预测您下一次编辑的位置，并在按下 Tab 键时导航至该处。"],
    ["Predict the location of your next edit and navigates you there with a tab keypress", "预测下一处编辑位置，按 Tab 键可跳转到该位置"],
    ["Are you sure you want to delete this side question? This action cannot be undone.", "确定要删除此副问题吗？此操作无法撤销。"],
    ["Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.", "连接 Google Workspace，包括文档、表格、演示文稿、云端硬盘和日历。"],
    ["To modify notification settings, open your operating system's system preferences.", "要修改通知设置，请打开操作系统的系统设置。"],
    ["What functionality you expect your account tier to have available that is missing", "你期望当前账号套餐提供但尚未提供的功能"],
    ["Are you sure you want to delete this conversation? This action cannot be undone.", "确定要删除此对话吗？此操作无法撤销。"],
    ["Receive product updates, tips, and promotions from Google Antigravity via email.", "通过电子邮件接收 Google Antigravity 的产品更新、技巧和促销信息。"],
    ["Cannot revert messages before or at the point where Best of N mode was triggered", "无法回退到触发 Best of N 模式时或之前的消息"],
    ["Which workspace the New Conversation button and keyboard shortcut start you in.", "通过“新会话”按钮及键盘快捷键新建会话时所默认进入的工作区。"],
    ["Compact the conversation now (summarize history to free up the context window).", "立即压缩对话（概括历史记录以释放上下文窗口空间）。"],
    ["Reflect on recent successes or corrections to capture reusable skills or rules.", "回顾近期的成功经验或修正，提炼可复用的技能或规则。"],
    ["Configures how the agent tries to access files outside of its working folders.", "配置智能体如何访问工作文件夹之外的文件。"],
    ["No model specified for Battle Mode, falling back to use current selected model", "对战模式未指定模型，已回退为使用当前选中的模型"],
    ["Browser is currently being operated by this conversation in another Hub window", "此对话正在另一个主窗口中操作浏览器"],
    ["Google Cloud SDK detected. Install Google Extensions to enhance your workflow.", "检测到 Google Cloud SDK。安装 Google 扩展以增强工作流程。"],
    ["Background tasks and terminals agents left running, across all conversations.", "所有会话中由智能体启动并保持运行的后台任务与终端。"],
    ["You can upgrade to a Google AI Ultra plan to receive the highest rate limits.", "你可以升级到 Google AI Ultra 套餐以获得最高速率限制。"],
    ["Uploaded files and connected resources are mounted in your cloud environment.", "上传的文件和连接的资源会挂载到你的云端环境中。"],
    ["Allow reading workflow runs (list, view, watch) across the whole repository.", "允许读取整个仓库的工作流运行记录（列表、查看、监听）。"],
    ["Show browser notifications when your action is needed or execution finishes.", "需要你操作或执行结束时，显示浏览器通知。"],
    ["These MCP allowlist rules are enforced by your organization's administrator.", "这些 MCP 白名单规则由你所在组织的管理员强制实施。"],
    ["Ignore events triggered by the automation owner to avoid self-trigger loops.", "忽略由自动化任务所有者触发的事件，以避免自触发循环。"],
    ["Rewinds the conversation only. Files in this workspace stay as they are now.", "仅回退对话，此工作区内的文件保持当前状态。"],
    ["Check pending conversations in the last 3 days that require action from me.", "检查最近 3 天内需要我处理的待办对话。"],
    ["Configure built-in browser, link opening, and browser subagent preferences.", "配置内置浏览器、链接打开方式及浏览器子智能体首选项。"],
    ["Ignore events emitted by automated review or robot accounts (groupagent-*).", "忽略由自动审查或机器人账号 (groupagent-*) 发出的事件。"],
    ["Send messages with the keyboard's Enter key instead of starting a new line.", "按 Enter 键发送消息，而不是换行。"],
    ["Show system notifications when your action is needed or the agent finishes.", "当需要你采取操作或智能体完成任务时弹出系统通知。"],
    ["This conversation is not on disk. Delete it to remove it from your sidebar.", "此对话不在磁盘上。将其删除即可从侧边栏移除。"],
    ["Use Add MCP to browse the store, or add a custom server via the MCP config.", "使用“添加 MCP”浏览商店，或通过 MCP 配置文件添加自定义服务器。"],
    ["I prefer an immediate single response to prioritize productivity right now.", "我现在希望立即获得单个回复，以提高效率。"],
    ["Clear visited URLs and autocomplete suggestions from the built-in browser.", "清除内置浏览器中访问过的网址和自动补全建议。"],
    ["AI-powered code review and review-comment autofix, powered by CodeRabbit.", "由 CodeRabbit 提供支持的人工智能代码审查和审查意见自动修复。"],
    ["Google3 chats will be regrouped into their workspaces in the sidebar. See", "Google3 聊天将在侧边栏中重新按其工作区分组。请参阅"],
    ["Hook will only trigger if the tool name matches run_command or view_file.", "仅当工具名称匹配 run_command 或 view_file 时触发钩子。"],
    ["Plan work, track issues, sign documents, and manage your notes and files.", "规划工作、跟踪问题、签署文档并管理笔记和文件。"],
    ["Setup may take over 5 minutes. Please keep this screen open during setup.", "配置可能需要 5 分钟以上，请在此过程中保持此界面打开。"],
    ["This prompt is straightforward and does not need alternative comparisons.", "此提示较为直接，无需比较其他方案。"],
    ["Configure workspace-specific permissions, resources, and customizations.", "配置工作区专属的权限、资源和自定义项。"],
    ["Controls whether terminal commands require your approval before running.", "控制终端命令在执行前是否需要你的审批。"],
    ["Enable telemetry in Settings before changing per-conversation telemetry.", "在调整单会话遥测前，请先在设置中启用遥测。"],
    ["Model must be available on the Gemini API and use the gemini-api scheme.", "模型必须可在 Gemini API 中使用，并使用 gemini-api 模式。"],
    ["options. Agent settings and permissions can be further customized below.", "项之一。智能体设置和权限可在下方进一步自定义。"],
    ["Plugins are packaged collections of skills and MCPs to help the Agent in", "插件是技能与 MCP 的打包集合，用于在以下方面协助智能体："],
    ["Toggle if a confirmation is shown when using the \"Reload Window\" button.", "使用“重新加载窗口”按钮时是否显示确认提示。"],
    ["You can upgrade to a Google AI Ultra plan to receive higher rate limits.", "您可以升级到 Google AI Ultra 套餐以获得更高的速率限制。"],
    ["The Agent attempted to interact with some sites that are not allowlisted", "智能体尝试与未加入允许列表的网站交互"],
    ["Use this if your admin gave you a WIF config. Paste it below to sign in.", "如果管理员提供了 WIF 配置，请将其粘贴到下方以登录。"],
    ["Path to the Chrome/Chromium executable. Leave empty for auto-detection.", "Chrome/Chromium 可执行文件路径。留空则自动检测。"],
    ["Sign up for newsletters, tips and tricks, and other notifications about", "订阅简报、使用技巧及相关通知"],
    ["This plugin requires authentication before the agent can use its tools.", "此插件需要先完成身份验证，智能体方可使用其工具。"],
    ["VCS used when generating a new workspace based off your initial prompt.", "根据您的初始提示词生成新工作区时使用的 VCS。"],
    ["Contact your administrator to set up Gemini Enterprise for this project", "请联系管理员，为此项目设置 Gemini Enterprise"],
    ["This project uses Firebase. Do you want to download the Firebase skill?", "此项目使用 Firebase。要下载 Firebase 技能吗？"],
    ["Inherits from global settings. Local permissions have higher priority.", "继承全局设置。本地权限优先级更高。"],
    ["Jetski Chat configuration is not available in the current environment.", "当前环境中无法使用 Jetski Chat 配置。"],
    ["Open in current window, Continue conversation in the current workspace", "在当前窗口打开，并在当前工作区继续对话"],
    ["When enabled, sandboxed commands are allowed to make network requests.", "启用后，允许沙盒中的命令发起网络请求。"],
    ["Rules token budget exceeded. Large rules are demoted to path pointers.", "规则的 Token 预算已超出。较大的规则会降级为路径引用。"],
    ["Send a message in the main conversation first to start a side question", "请先在主对话中发送一条消息，然后再发起副问题"],
    ["Agent settings and permissions for conversations outside of projects.", "为项目外对话配置智能体设置和权限。"],
    ["Configure a chat bot so you can use Jetski directly from Google Chat.", "配置聊天机器人，以便直接从 Google Chat 使用 Jetski。"],
    ["Google3 chats will be regrouped into their workspaces in the sidebar.", "Google3 聊天将在侧边栏中重新按其工作区分组。"],
    ["Keep your coding agent up to date with the latest web best practices.", "让您的编码智能体始终与最新的 Web 最佳实践保持同步。"],
    ["Sync newly created JJ worktrees to head when starting a conversation.", "开始对话时将新建的 JJ 工作树同步到最新提交。"],
    ["Please sign in using the Antigravity sidebar panel to view this page.", "请使用 Antigravity 侧边栏登录以查看此页面。"],
    ["A snapshot was saved before running. To restore your previous output:", "运行前已保存快照。要恢复之前的输出："],
    ["Get notified when the agent needs your attention or completes a task.", "在智能体需要关注或完成任务时接收通知。"],
    ["Match when any modified file path starts with the given depot prefix.", "当任何已修改文件的路径以指定仓库前缀开头时匹配。"],
    ["Match when push_def equals or is a child of the given PushDef prefix.", "当 push_def 等于指定 PushDef 前缀或为其子项时匹配。"],
    ["Failed to unarchive project: project management feature not available", "恢复已归档项目失败：项目管理功能不可用"],
    ["APIs, services, and tools to build, test, secure, and run your apps.", "用于构建、测试、保护和运行应用的 API、服务与工具。"],
    ["Configure agent execution, queued message delivery, and permissions.", "配置智能体执行、排队消息发送以及权限。"],
    ["The conversation could not be loaded because its data was not found.", "无法加载该对话，因为未找到其数据。"],
    ["Pick order sets the harness for each response; the rest run control.", "选择顺序决定每个回复使用的执行框架；其余回复作为对照运行。"],
    ["Allows the agent to access files outside of your current workspace.", "允许智能体访问当前工作区之外的文件。"],
    ["An error occurred while submitting your feedback. Please try again.", "提交反馈时出错，请重试。"],
    ["External tools the agent can invoke via the Model Context Protocol.", "智能体可通过模型上下文协议 (MCP) 调用的外部工具。"],
    ["Save rule to always allow a one-time administrator (UAC) elevation?", "保存规则以始终允许一次性管理员 (UAC) 提权？"],
    ["Save rule to always allow running this command outside the sandbox?", "保存规则以始终允许在沙盒外运行此命令？"],
    ["Let's tailor the experience for you. What best describes your work?", "让我们为你定制体验。哪项最能描述你的工作？"],
    ["Configure what the agent can do in local and remote conversations.", "配置智能体在本地和远程对话中可以执行的操作。"],
    ["Intended primarily for previewing local development servers (e.g.,", "主要用于预览本地开发服务器（例如："],
    ["Scan the code to open this device in Remote Control, or copy link.", "扫描二维码以在远程控制中打开此设备，或复制链接。"],
    ["To modify editor settings, open Settings within the editor window.", "要修改编辑器设置，请在编辑器窗口中打开设置。"],
    ["View archived in the sidebar (![filter](icon://filter_list) menu).", "在侧边栏的归档列表中查看（![filter](icon://filter_list) 菜单）。"],
    ["Read access to code, refs, commits, and other repository contents.", "读取代码、引用、提交及其他仓库内容的权限。"],
    ["Error: Artifacts from remote conversations are not available here.", "错误：此处无法使用远程对话中的产物。"],
    ["Bring the full power of Google Data Cloud to your intelligent IDE.", "将 Google Data Cloud 的强大功能引入你的智能 IDE。"],
    ["This request is not well-suited for parallel Best-of-N generation.", "此请求不太适合并行生成多个备选结果。"],
    ["Chief of Staff is listening — open the Chief of Staff conversation", "统筹助手正在聆听——打开统筹助手对话"],
    ["Run an instruction on a recurring schedule or as a one-time timer.", "按周期计划或一次性定时执行一条指令。"],
    ["A shell setup script run before every command the agent executes.", "在智能体执行每条命令前所运行的 Shell 初始化脚本。"],
    ["Commands the agent can run outside the sandbox in this workspace.", "智能体在此工作区中可在沙盒外运行的命令。"],
    ["Show \"Edit\" and \"Chat\" buttons when selecting text in the editor.", "在编辑器中选择文本时显示“编辑”和“聊天”按钮。"],
    ["Voice recording is unavailable while the Chief of Staff mic is on", "统筹助手的麦克风开启时无法录音"],
    ["Create a new project using normal folders and/or citc workspaces.", "创建使用普通文件夹和／或 CitC 工作区的新项目。"],
    ["Ask a quick question without interrupting the main conversation.", "提出简短问题，无需中断主会话。"],
    ["Folder where files downloaded in the built-in browser are saved.", "内置浏览器下载文件的保存文件夹。"],
    ["Let the agent access past conversations to inform its responses.", "允许智能体参考历史对话来生成回复。"],
    ["Replace the default browser right-click menu with quick actions.", "使用快捷操作菜单替换浏览器默认的右键菜单。"],
    ["Simulate a different user cohort (Google, External, Enterprise).", "模拟不同的用户群体类型（Google 内部、外部公开用户、企业客户）。"],
    ["The agent auto-executes commands matched by an allow list entry.", "智能体会自动执行匹配允许列表条目的命令。"],
    ["The conversation was compacted to fit within the context window.", "对话已压缩以适应上下文窗口。"],
    ["This extension has no declared permissions requiring user input.", "此扩展未声明需要用户确认的权限。"],
    ["Full interface for coding, developer tools, and managing agents.", "完整界面，适合编程、使用开发者工具和管理智能体。"],
    ["Cannot start best-of-N mode: background tasks are still running.", "无法启动 Best of N 模式：仍有后台任务运行中。"],
    ["Add an MCP server above or add a custom one via the MCP Config.", "在上方添加 MCP 服务器，或通过 MCP 配置添加自定义服务器。"],
    ["Agent settings and permissions can be further customized below.", "智能体设置和权限可在下方进一步自定义。"],
    ["Agents have full access to your machine and external resources.", "智能体可完整访问你的电脑和外部资源。"],
    ["Allow/deny agent write access to specific files or directories.", "允许或拒绝智能体写入指定文件或目录。"],
    ["Configure allowed and denied URLs for browser action execution.", "配置允许和拒绝浏览器执行操作的 URL。"],
    ["Configure tab completion, suggestions, and navigation behavior.", "配置 Tab 补全、建议和导航行为。"],
    ["Developer-only tools. These settings do not affect other users.", "仅限开发者使用的工具设置。这些设置不会影响其他用户。"],
    ["Highlight newly inserted text after accepting a Tab completion.", "在接受 Tab 补全后高亮显示新插入的文本。"],
    ["Manage settings specific to Google CitC workspaces development.", "管理特定于 Google CitC 工作区开发的设置。"],
    ["Open files in the background if the agent creates or edits them", "智能体创建或编辑文件时，在后台打开这些文件"],
    ["Your administrator has disabled MCP servers for this workspace.", "你的管理员已在此工作区中禁用了 MCP 服务器。"],
    ["What you would like to see to address this gap in your workflow", "你希望如何弥补工作流中的这一缺口"],
    ["Simplified interface for research, writing, and everyday tasks.", "精简界面，适合研究、写作和日常任务。"],
    ["Never auto-execute commands unless they are in your allow list.", "从不自动执行命令，允许列表中的命令除外。"],
    ["Used to represent onboardingsteps which have not been completed", "用于表示尚未完成的入门步骤"],
    ["Allow/deny agent read access to specific files or directories.", "允许或拒绝智能体读取指定文件或目录。"],
    ["Also includes Global Permissions when working in this project.", "在此项目中工作时还包括“全局权限”。"],
    ["Customize Agent to get a better, more personalized experience.", "自定义智能体，获得更好、更个性化的体验。"],
    ["Inherits your Global Permissions when working in this project.", "在此项目中工作时继承您的全局权限。"],
    ["Optimize the interface and terminal output for screen readers.", "针对屏幕阅读器优化界面交互与终端输出。"],
    ["Play a sound when your action is needed or the agent finishes.", "当需要你采取操作或智能体完成任务时播放提示音。"],
    ["The conversation was compacted while generating this response.", "生成此响应的过程中会话已被压缩。"],
    ["Ask a side question without interrupting the main conversation", "发起旁路提问，不打断主会话"],
    ["Your Antigravity use will be associated with provided project.", "你的 Antigravity 使用将与所提供的项目关联。"],
    ["Tip: Complex tasks get better results with multiple responses.", "提示：复杂任务使用多个回复通常会得到更好的结果。"],
    ["A license or project selection is required to use Antigravity.", "使用 Antigravity 需要许可证或选择项目。"],
    ["Invoke a team of agents to autonomously tackle large projects.", "调用智能体团队自主处理大型项目。"],
    ["Cannot start best-of-N mode: some subagents are still running.", "无法启动 Best of N 模式：仍有子智能体运行中。"],
    ["Allow opening pull requests and grant access to specific PRs.", "允许创建拉取请求并授予对特定 PR 的访问权限。"],
    ["Browse and enable plugins from the Build With Google catalog.", "从 Build With Google 目录中浏览并启用插件。"],
    ["Configure allowed and denied paths for file reads and writes.", "配置允许和拒绝读写的文件路径。"],
    ["Credential expires in less than 1 week. Click to refresh TDAT", "凭据将在 1 周内过期。点击刷新 TDAT"],
    ["External tools the agent can call via Model Context Protocol.", "智能体可通过 Model Context Protocol 调用的外部工具。"],
    ["Hook will only trigger if the tool name starts with browser_.", "仅当工具名称以 browser_ 开头时触发钩子。"],
    ["The agent will wait for you to install the browser extension.", "智能体会等待你安装浏览器扩展。"],
    ["There was an error with your authentication. To log in, click", "身份验证过程中发生错误。若要登录，请点击"],
    ["This migration may mess up your settings, chats, and sidebar.", "此迁移可能会影响您的设置、聊天记录和侧边栏。"],
    ["Request Review - Collaborate with the agent to complete tasks", "请求审核——与智能体协作完成任务"],
    ["Allow/deny agent browser file downloads from specific sites.", "允许或拒绝智能体浏览器从特定网站下载文件。"],
    ["Credential valid (> 1 week remaining). Click to refresh TDAT", "凭据有效（剩余超过 1 周）。点击刷新 TDAT"],
    ["Disables all safety barriers for maximal iteration velocity.", "禁用所有安全屏障，以最大程度提高迭代速度。"],
    ["Hook will only trigger if the tool name matches run_command.", "仅当工具名称匹配 run_command 时触发钩子。"],
    ["Prevent the computer from sleeping while the app is running.", "在应用运行期间阻止计算机进入睡眠状态。"],
    ["This setting cannot be changed while strict mode is enabled.", "启用严格模式时无法更改此设置。"],
    ["Grant create, update, or delete access to specific branches.", "授予对指定分支的创建、更新或删除权限。"],
    ["Used to represent onboarding steps which have been completed", "用于表示已完成的入门步骤"],
    ["Invoke the Boost multi-agent orchestrator for complex tasks.", "调用 Boost 多智能体协调器处理复杂任务。"],
    ["A full copy of this workspace, uncommitted changes included.", "此工作区的完整副本，包括未提交的更改。"],
    ["Allow/deny agent browser actuation access to specific URLs.", "允许或拒绝智能体浏览器针对特定网址执行页面操作。"],
    ["Configure the agent's visual theme and display preferences.", "配置智能体的视觉主题与界面显示偏好。"],
    ["Manage how Best of N sets up the workspace its arms run in.", "管理 Best of N 如何配置其各分支运行所在的工作区。"],
    ["Open files in the background if Agent creates or edits them", "当智能体创建或编辑文件时，在后台打开这些文件"],
    ["Play a sound when the agent finishes generating a response.", "智能体完成回复生成时播放提示音。"],
    ["Allow creating issues and grant access to specific issues.", "允许创建议题并授予对特定议题的访问权限。"],
    ["Remote Control isn't active on this instance. Enable it in", "当前实例未启用远程控制。请在以下位置启用："],
    ["Restricts agent tools to a secure, isolated local sandbox.", "将智能体工具限制在安全隔离的本地沙盒中。"],
    ["Terminal commands the agent can execute in this workspace.", "智能体在此工作区中可执行的终端命令。"],
    ["Using the Google Antigravity Python SDK to build AI agents", "使用 Google Antigravity Python SDK 构建人工智能智能体"],
    ["It was already sent or couldn't be removed from the queue.", "该消息已发送，或无法从队列中移除。"],
    ["Allow/deny agent read access to specific URLs or domains.", "允许或拒绝智能体读取指定 URL 或域名。"],
    ["Configure global allowed and denied resource permissions.", "配置全局允许和拒绝的资源权限。"],
    ["Thank you! Your feedback has been submitted successfully.", "感谢您的反馈！您的反馈已成功提交。"],
    ["Type / and select plan to have the agent generate a plan.", "输入 / 并选择 plan 让智能体生成计划。"],
    ["Your session has expired. Please log back in to continue.", "会话已过期，请重新登录后继续。"],
    ["No matching project folders. Apply to use the custom URI.", "没有匹配的项目文件夹。点击“应用”以使用自定义 URI。"],
    ["Your sign-in needs an update. Sign in again to use Voice.", "登录状态需要更新。请重新登录以使用语音功能。"],
    ["Agent can scroll on browser pages to access more content.", "智能体可以滚动浏览器页面以访问更多内容。"],
    ["A comma-separated list like repo-a, repo-b, or * for all.", "使用逗号分隔的列表，例如 repo-a、repo-b，或使用 * 表示全部。"],
    ["Enable navigation suggestions that predict your next edit", "启用预测下一处编辑位置的导航建议"],
    ["Cannot revert to a message that was cleared to save space", "无法回退到为节省空间而清除的消息"],
    ["Clone current workspace into a new independent workspace", "将当前工作区克隆到全新的独立工作区中"],
    ["Configure allowed and denied URLs for browser actuation.", "配置允许和拒绝浏览器执行操作的 URL。"],
    ["Configure link opening and built-in browser preferences.", "配置链接打开方式和内置浏览器偏好设置。"],
    ["Core tools and knowledge required to develop for Android", "开发 Android 应用所需的核心工具与知识"],
    ["Inline PDF preview is not available in this environment.", "当前环境下暂不支持内嵌 PDF 预览。"],
    ["Manage project folders, agent settings, and permissions.", "管理项目文件夹、智能体设置和权限。"],
    ["Save rule to always allow executing actions on this URL?", "保存规则以始终允许在此 URL 上执行操作？"],
    ["Scan the code to open this device in Remote Control, or ", "扫描二维码以在远程控制中打开此设备，或 "],
    ["Select a model using the model selector in the input box", "使用输入框中的模型选择器选择模型"],
    ["Type / and select plan to have the agent generate a plan", "输入 / 并选择 plan 让智能体生成计划"],
    ["Attackers might be trying to steal your information from", "攻击者可能正试图从以下网站窃取你的信息："],
    ["Trigger multiple response variants from the same prompt.", "使用同一提示词生成多个不同的回复。"],
    ["No project selected or project management not available.", "未选择项目，或项目管理不可用。"],
    ["Cannot revert a message sent while the agent was running", "无法回退到智能体运行时发送的消息"],
    ["Access and clone GitHub repositories in remote projects", "在远程项目中访问和克隆 GitHub 仓库"],
    ["Allow/deny agent command execution outside the sandbox.", "允许或拒绝智能体在沙盒之外执行命令。"],
    ["Automatically reproduce bugs, trace causes, test fixes.", "自动复现缺陷、追踪根本原因并测试修复方案。"],
    ["Draft documents, emails, and notes that sound like you.", "起草符合你语言风格的文档、电子邮件与备忘笔记。"],
    ["Include default customizations, such as default skills.", "包含默认自定义项，例如默认技能。"],
    ["Manage your plan, credentials, and general preferences.", "管理你的订阅计划、账号凭据与常规偏好设置。"],
    ["Scan the code to open this device in Remote Control, or", "扫描二维码以在远程控制中打开此设备，或"],
    ["This project overrides your global permission settings.", "此项目覆盖了您的全局权限设置。"],
    ["This subagent was killed and can no longer be messaged.", "此子智能体已终止，无法再向其发送消息。"],
    ["A comma-separated list like org-a, org-b, or * for all.", "使用逗号分隔的列表，例如 org-a、org-b，或使用 * 表示全部。"],
    ["Always Proceed - Trust the agent to do tasks end-to-end", "始终继续——信任智能体独立完成整个任务"],
    ["AI may make mistakes. Double-check all generated code.", "AI 可能会出错，请仔细核对生成的代码。"],
    ["Allow full browser script execution without prompting.", "允许完整的浏览器脚本执行而无需提示。"],
    ["Choose how much detail is shown during a conversation.", "选择对话过程中显示的详细程度。"],
    ["Configure the maximum width of the conversation panel.", "配置对话面板的最大宽度。"],
    ["for more information (this migration is experimental).", "了解更多信息（此迁移为实验性功能）。"],
    ["Sidebar after conversations are regrouped by workspace", "按工作区分组后的对话侧边栏"],
    ["URLs the agent can perform actions on via the browser.", "智能体可以通过浏览器执行操作的 URL。"],
    ["No rate card for this model; showing comparable rates.", "此模型没有费率表；当前显示的是可比费率。"],
    ["A few things to know, and a couple settings to review.", "请了解以下事项，并检查几项设置。"],
    ["Open Google Chrome on the machine running Antigravity.", "在运行 Antigravity 的电脑上打开 Google Chrome。"],
    ["There was an unexpected issue setting up your account.", "设置账号时出现意外问题。"],
    ["A Google Cloud project is required to use Antigravity.", "使用 Antigravity 需要 Google Cloud 项目。"],
    ["Cannot start best-of-N mode while the agent is running", "智能体运行时无法启动 Best of N 模式"],
    ["This project is associated with a different workspace.", "此项目关联到其他工作区。"],
    ["Choose between the Default and Project 4K experience.", "在默认体验与 Project 4K 体验之间选择。"],
    ["Configure default behaviors, skills, and MCP servers.", "配置默认行为、技能和 MCP 服务器。"],
    ["Curated collection of agent skills for science tasks.", "精选的科学任务智能体技能集。"],
    ["Deploy and host your apps, sites, and their backends.", "部署和托管应用、网站及其后端。"],
    ["Manage your conversations from the companion website.", "从配套网站管理您的对话。"],
    ["Modify permissions for file, terminal, and MCP tools.", "修改文件、终端和 MCP 工具的权限。"],
    ["This option is disabled while strict mode is enabled.", "启用严格模式时此选项已禁用。"],
    ["Failed to load your customizations. Please try again.", "加载自定义项失败，请重试。"],
    ["Discard changes (revert file to last committed state)", "放弃更改（将文件还原到上次提交的状态）"],
    ["Ask about your code or any topic, get clear answers.", "针对你的代码或任意话题提问，获取清晰解答。"],
    ["Configure external tools via Model Context Protocol.", "配置通过 Model Context Protocol 使用的外部工具。"],
    ["Keyboard shortcuts for quick navigation and control.", "用于快速导航与控制的键盘快捷键。"],
    ["Research, writing, and everyday tasks, without code.", "适用于研究、写作与日常任务（不含代码工具）。"],
    ["Save rule to always allow write access to this path?", "保存规则以始终允许写入此路径？"],
    ["The full developer experience with code and tooling.", "包含代码与开发工具的完整开发者体验。"],
    ["View archived in the sidebar (Display options menu).", "可在侧边栏（显示选项菜单）中查看已归档内容。"],
    ["Running processes are killed. This cannot be undone.", "运行中的进程将被终止。此操作无法撤销。"],
    ["Connect an account so the agent can run automations.", "连接账号，让智能体能够运行自动化任务。"],
    ["Install the server first to see the available tools.", "请先安装服务器，再查看可用工具。"],
    ["Create a new workflow file in the current workspace.", "在当前工作区中创建新的工作流文件。"],
    ["Run until the specified goal is completely finished.", "持续运行，直到指定目标完全完成。"],
    ["Configure hooks that run on agent lifecycle events.", "配置在智能体生命周期事件上运行的钩子。"],
    ["Exploring files, running commands, editing artifact", "正在探索文件、运行命令、编辑产物"],
    ["Modify permissions for 文件, terminal, and MCP tools.", "修改文件、终端和 MCP 工具的权限。"],
    ["Prompt for approval before running browser scripts.", "运行浏览器脚本前请求批准。"],
    ["Quickly add and update imports with a tab keypress.", "按下 Tab 键快速添加和更新导入。"],
    ["Requesting a one-time administrator (UAC) elevation", "正在请求一次性管理员 (UAC) 提权"],
    ["Save rule to always allow read access to this path?", "保存规则以始终允许读取此路径？"],
    ["Search for MCP servers to add to your configuration", "搜索要添加到配置中的 MCP 服务器"],
    ["Using the Antigravity Python SDK to build AI agents", "使用 Antigravity Python SDK 构建 AI 智能体"],
    ["Whether the agent asks you to review its documents.", "智能体是否请求您审核其生成的文档。"],
    ["You currently don't have any MCP Servers installed.", "您当前还没有安装任何 MCP 服务器。"],
    ["Custom models are only supported on Linux machines.", "自定义模型仅支持 Linux 计算机。"],
    ["Why are you opting out of auto-triggered Best-of-N?", "为什么要退出自动触发的 Best of N？"],
    ["Keeps working in this workspace. Nothing is copied.", "继续在此工作区工作，不复制任何内容。"],
    ["? This will remove it from your MCP configuration.", "？这将把它从您的 MCP 配置中移除。"],
    ["Aborted due to condition callback returning false.", "由于条件回调返回 false，操作已中止。"],
    ["Allow sandboxed commands to make network requests.", "允许沙盒中的命令发起网络请求。"],
    ["Configure editor-specific behaviors and shortcuts.", "配置编辑器特有的行为和快捷键。"],
    ["Configure the default width of markdown artifacts.", "配置 Markdown 产物的默认宽度。"],
    ["Custom agents are not available in Best of N mode.", "Best of N 模式下暂不支持自定义智能体。"],
    ["GitHub API rate limit exceeded. Try again shortly.", "GitHub API 请求频率超出限制。请稍后重试。"],
    ["Save rule to always allow access to this resource?", "保存规则以始终允许访问此资源？"],
    ["URLs the agent can read or open in this workspace.", "智能体在此工作区中可读取或打开的 URL。"],
    ["What quota or feature is being incorrectly limited", "哪些配额或功能被错误地限制了"],
    ["Error: No artifact URI provided in URL parameters.", "错误：URL 参数中未提供产物 URI。"],
    ["Whether it never connects or is intermittent/flaky", "它是从未连接成功，还是连接间歇性不稳定"],
    ["Ask questions, report issues, and discuss features", "提问、报告问题并讨论功能"],
    ["Agent Decides - Assist the agent to complete tasks", "由智能体决定——协助智能体完成任务"],
    ["Create a project whose conversations run remotely.", "创建对话在远程运行的项目。"],
    ["Dev mode: Localhost server automatically detected", "开发模式：已自动检测到 Localhost 本地服务器"],
    ["Display and preserve intermediate thinking steps.", "显示并保留中间思考步骤。"],
    ["Hand off a feature and come back to working code.", "交付功能需求，稍后即可获得可运行的完整代码。"],
    ["New standalone conversation, outside of projects.", "新建独立对话，不属于任何项目。"],
    ["No keyboard shortcuts found matching your filter.", "未找到符合当前筛选条件的快捷键。"],
    ["Paths the agent can modify inside this workspace.", "智能体在此工作区中可修改的路径。"],
    ["Timed out waiting for the update to be installed.", "等待安装更新超时。"],
    ["Disabled. Open Details to finish setup or enable.", "已禁用。打开详情以完成设置或启用。"],
    ["Connect an account so the agent can use this app.", "连接账号，让智能体能够使用此应用。"],
    ["The agent was prevented from accessing some sites", "已阻止智能体访问某些网站"],
    ["For Antigravity Business consumption options, see", "有关 Antigravity Business 的用量选项，请参阅"],
    ["Creating workspace for the forked conversation...", "正在为派生对话创建工作区..."],
    ["The server returned no conversation to fork into.", "服务器未返回可供派生的对话。"],
    ["Choose where links open by default when clicked.", "选择点击链接时默认在哪里打开。"],
    ["Display and preserve intermediate thinking steps", "显示并保留中间思考步骤"],
    ["Files modified by the agent in this conversation", "智能体在此对话中修改的文件"],
    ["Import feature is not available in this context.", "当前上下文中无法使用导入功能。"],
    ["Require review for all browser script execution.", "所有浏览器脚本执行都需要审核。"],
    ["Run terminal commands with sandbox restrictions.", "在沙盒限制环境中运行终端命令。"],
    ["There may be agents or background tasks running.", "可能仍有智能体或后台任务正在运行。"],
    ["URLs the agent can actuate on in this workspace.", "智能体在此工作区中可执行操作的 URL。"],
    ["URLs the agent can actuate on using the browser.", "智能体可通过浏览器执行操作的 URL。"],
    ["Uses your local files and tools. Schedules only.", "使用本地文件和工具，仅支持定时运行。"],
    ["Keeps working in this folder. Nothing is copied.", "继续在此文件夹中工作，不会复制任何内容。"],
    ["Please fill out all required values to continue.", "请填写所有必填项后继续。"],
    ["Creating worktree for the forked conversation...", "正在为派生对话创建工作树..."],
    ["Failed to resolve permissions. Please try again.", "解析权限失败，请重试。"],
    ["Absolute path to the Chrome/Chromium executable", "Chrome 可执行文件的绝对路径"],
    ["Allow a one-time administrator (UAC) elevation?", "允许一次性管理员 (UAC) 提权？"],
    ["Allow running this command outside the sandbox?", "允许在沙盒外运行此命令？"],
    ["Are you sure you want to delete this hook card?", "确定要删除此钩子卡片吗？"],
    ["Commands the agent can run outside the sandbox.", "智能体可在沙盒外运行的命令。"],
    ["Configure allowed commands outside the sandbox.", "配置允许在沙盒外运行的命令。"],
    ["Curated collection of agent skills for science.", "为科学领域精心挑选的智能体技能集合。"],
    ["Disabled. Open the plugin page to finish setup.", "已禁用。打开插件页面以完成配置。"],
    ["Paths the agent can read inside this workspace.", "智能体在此工作区中可读取的路径。"],
    ["Project 4K interface without developer tooling.", "专为非开发工具场景设计的 Project 4K 极简界面。"],
    ["Save rule to always allow running this command?", "保存规则以始终允许运行此命令？"],
    ["Select light, dark, or inherit system settings.", "选择浅色、深色或继承系统设置。"],
    ["URLs the agent can read or open in the browser.", "智能体可以在浏览器中读取或打开的 URL。"],
    ["How this feature would help you and other users", "此功能将如何帮助你和其他用户"],
    ["Settings for conversations outside of projects.", "项目之外的对话设置。"],
    ["Whatever the voice-engine-addr flag serves you.", "使用由 voice-engine-addr 参数提供的语音引擎。"],
    ["Failed to update permissions. Please try again.", "更新权限失败，请重试。"],
    ["Your AI credits balance is too low to continue.", "你的 AI 积分余额不足，无法继续。"],
    ["Automations do not inherit Global Permissions.", "自动化任务不继承全局权限。"],
    ["Check availability, schedule events, and RSVP.", "查看空闲时间、安排活动并回复活动邀请。"],
    ["Configure allowed and denied URLs for reading.", "配置允许和拒绝读取的 URL。"],
    ["Continue conversation in the current workspace", "在当前工作区继续对话"],
    ["Controls permissions for remote conversations.", "控制远程对话的权限。"],
    ["Save rule to always allow using this MCP tool?", "保存规则以始终允许使用此 MCP 工具？"],
    ["Close split view and go to forked conversation", "关闭分屏视图并转到派生的对话"],
    ["Your changes were not saved. Please try again.", "更改未保存，请重试。"],
    ["This link wants to open an app on your device.", "此链接请求打开你设备上的应用。"],
    ["Encountered an error while running the plugin.", "运行插件时出错。"],
    ["Change VCS in General settings, under Advanced", "在“常规”设置的“高级”部分更改版本控制系统"],
    ["Show AI autocomplete suggestions in the editor", "在编辑器中显示 AI 自动补全建议"],
    ["Cannot revert messages with file diff comments", "无法回退包含文件差异评论的消息"],
    ["This conversation is in a different workspace.", "此对话位于其他工作区。"],
    ["? This removes it from your config directory.", "？这会将它从您的配置目录中移除。"],
    ["Any error messages seen when trying to log in", "尝试登录时看到的任何错误信息"],
    ["Are you sure you want to delete the workspace", "确定要删除工作区"],
    ["Are you sure you want to delete this handler?", "确定要删除此处理程序吗？"],
    ["Choose the experience that fits how you work.", "选择适合您工作方式的体验模式。"],
    ["This option is disabled by your organization.", "此选项已被您所在的组织禁用。"],
    ["This setting is managed by your organization.", "此设置由您所在的组织管理。"],
    ["to ask for content changes for legal reasons.", "申请出于法律原因的内容变更。"],
    ["Ask the agent to diagnose and fix this server", "让智能体诊断并修复此服务器"],
    ["Image rendering blocked (strict mode enabled)", "图片渲染已阻止（已启用严格模式）"],
    ["Too many requests, please try again in a bit!", "请求过于频繁，请稍后重试！"],
    ["Cannot revert messages with artifact comments", "无法回退包含产物评论的消息"],
    ["Agent needs permission to execute JavaScript", "智能体需要权限才能执行 JavaScript"],
    ["Conversation copied as Markdown to clipboard", "对话已作为 Markdown 复制到剪贴板"],
    ["Please list the steps to reproduce the issue", "请列出复现此问题的步骤"],
    ["Preview is not available for this file type.", "此类文件暂不支持预览。"],
    ["Quickly add and update imports with Tab key.", "按下 Tab 键快速添加和更新导入。"],
    ["Search conversations (by name or Cascade ID)", "搜索对话（按名称或 Cascade ID）"],
    ["Stored and mounted in your cloud environment", "存储并挂载到你的云端环境中"],
    ["Microphone blocked in browser site settings.", "麦克风已在浏览器网站设置中被阻止。"],
    ["Select text in the artifact to add a comment", "选择产物中的文本以添加评论"],
    ["Some non-image binary content was truncated.", "部分非图像二进制内容已被截断。"],
    ["Here's how you and your agents work together", "了解你与智能体如何协作"],
    ["Collaborate with the agent to complete tasks", "与智能体协作完成任务"],
    ["The agent has encountered an internal error.", "智能体遇到了内部错误。"],
    ["% of the customization budget is available.", "% 的自定义预算可用。"],
    ["broadcast Go Live, Click to run live server", "广播 Go Live，点击运行实时服务器"],
    ["Configure the browser subagent. It requires", "配置浏览器子智能体。它需要"],
    ["Configure when follow-up messages are sent.", "配置何时发送后续消息。"],
    ["Connected Google Drive and GitHub resources", "已关联的 Google 云端硬盘与 GitHub 资源"],
    ["Manage fine-grained permissions for GitHub.", "管理针对 GitHub 的细粒度权限配置。"],
    ["No active terminals. Click + to create one.", "暂无活动终端。点击 + 创建一个。"],
    ["No customizations found for this workspace.", "此工作区没有找到自定义内容。"],
    ["Save rule to always allow reading this URL?", "保存规则以始终允许读取此 URL？"],
    ["to back up your data and run the migration.", "备份数据并运行迁移。"],
    ["Work with local agents from another device.", "从其他设备连接并使用本地智能体。"],
    ["Conversation is not open in this Hub window", "此对话未在当前主窗口中打开"],
    ["Are you sure you want to reload the window?", "确定要重新加载窗口吗？"],
    ["Google3 projects are deprecated. Learn more", "Google3 项目已弃用。了解详情"],
    ["Paused. Resume it to schedule the next run.", "已暂停。恢复后将安排下次执行。"],
    ["Antigravity would like to use the browser.", "Antigravity 想要使用浏览器。"],
    ["Confirmation required to execute this step", "执行此步骤需要确认"],
    ["Failed to inspect license for this project", "检查当前项目的许可证信息失败"],
    ["Failed to validate the saved GitHub token.", "验证已保存的 GitHub 令牌失败。"],
    ["Folder no longer exists or is unavailable.", "文件夹不再存在或不可用。"],
    ["Hook will trigger if any tool is executed.", "当执行任何工具时均会触发钩子。"],
    ["Input device for voice mode and dictation.", "语音模式和语音输入使用的设备。"],
    ["Search, upload, download, and share files.", "搜索、上传、下载和共享文件。"],
    ["Show suggestions when typing in the editor", "在编辑器中输入时显示建议"],
    ["Enable this plugin to manage its accounts.", "启用此插件以管理其账号。"],
    ["Failed to parse settings. Fix and restart.", "解析设置失败，请修复后重新启动。"],
    ["Refreshed credentials for all automations.", "已刷新所有自动化任务的凭据。"],
    ["Allow Tab to access .gitignore exclusions", "Tab 键访问 .gitignore 排除文件"],
    ["Ask anything, @ to mention, / for actions", "想问什么都可以，@ 引用，/ 执行动作"],
    ["Credential expired. Click to refresh TDAT", "凭据已过期。点击刷新 TDAT"],
    ["Interrupt the agent and send immediately.", "打断智能体并立即发送。"],
    ["projectManagementService is not available", "项目管理服务当前不可用"],
    ["Sign in to finish setting up this plugin.", "登录以完成此插件的配置。"],
    ["Type absolute path or navigate folders...", "输入绝对路径或浏览文件夹..."],
    ["No internet. Agent features may not work.", "没有网络连接，智能体功能可能无法使用。"],
    ["Missing a repository? Configure on GitHub", "缺少仓库？在 GitHub 上配置"],
    ["Type a voice variant name, such as rev27.", "输入语音变体名称，例如 rev27。"],
    ["Restores workspace and chat to this point", "将工作区和聊天恢复到此时的状态"],
    ["Finish onboarding to start using the IDE.", "完成入门设置后即可开始使用 IDE。"],
    ["Could not apply the selected permissions.", "无法应用选定的权限。"],
    ["Cannot revert messages with file comments", "无法回退包含文件评论的消息"],
    ["Your quota for this model is running low.", "你对此模型的额度即将用完。"],
    ["Commands and files these agents can use.", "这些智能体可调用的命令与文件。"],
    ["Configure AI models and view your quota.", "配置 AI 模型并查看额度。"],
    ["Controls the actions the agent can take.", "控制智能体可以执行的操作。"],
    ["Enter a URL (e.g. http://localhost:8080)", "输入网址（例如 http://localhost:8080）"],
    ["Explore other marketplace customizations", "探索更多应用市场自定义内容"],
    ["Organization Allowed Domains (Read-Only)", "组织允许的域名（只读）"],
    ["Terminal commands the agent can execute.", "智能体可执行的终端命令。"],
    ["Attaching logs requires an email address", "附加日志需要提供电子邮件地址"],
    ["Creating projects for your conversations", "正在为你的对话创建项目"],
    ["A project with this name already exists.", "已存在同名项目。"],
    ["Only this conversation uses this preset.", "仅当前对话使用此预设。"],
    ["Block all browser JavaScript execution.", "阻止所有浏览器 JavaScript 执行。"],
    ["Cancel questionnaire and stop the agent", "取消问卷并停止智能体"],
    ["Explain and Fix in Current Conversation", "在当前对话中解释并修复"],
    ["Failed to upload HTML artifact to Drive", "上传 HTML 产物至云端硬盘失败"],
    ["GCP Project ID for enterprise features.", "适用于企业级功能的 GCP 项目 ID。"],
    ["Local permissions have higher priority.", "本地权限优先级更高。"],
    ["Manually customize individual settings.", "手动自定义各项设置。"],
    ["Rules help guide the behavior of Agent.", "规则用于指导智能体的行为。"],
    ["Security agent decides if commands run.", "由安全智能体决定是否运行命令。"],
    ["Paste the code shown after you sign in.", "粘贴登录后显示的代码。"],
    ["Files and resources in cloud workspaces", "云工作区中的文件与资源"],
    ["The remote shared a link for this push.", "远程端为此次推送提供了链接。"],
    ["Plan carefully before executing a task.", "执行任务前先仔细规划。"],
    ["Telemetry is off for this conversation.", "此对话的遥测功能已关闭。"],
    ["Telemetry is off for all conversations.", "所有对话的遥测功能均已关闭。"],
    ["Allow/deny specific terminal commands.", "允许或拒绝指定终端命令。"],
    ["Google Drive integration not available", "Google 云端硬盘集成不可用"],
    ["No (tell the agent what to do instead)", "否（告诉智能体改做什么）"],
    ["Organization MCP Allowlist (Read-Only)", "组织 MCP 允许列表（只读）"],
    ["Run all commands without restrictions.", "不受限制地运行所有命令。"],
    ["Use theme to be imported with settings", "随设置导入时使用的主题"],
    ["Choose where terminal sessions appear.", "选择终端会话的显示位置。"],
    ["Each plugin can be managed on its own.", "每个插件都可以单独管理。"],
    ["Microphone blocked in system settings.", "麦克风已在系统设置中被阻止。"],
    ["No content available for this resource", "此资源没有可用内容"],
    ["A group with this name already exists.", "已存在同名分组。"],
    ["Pricing is based on public API pricing", "定价以公开 API 价格为基础"],
    ["Trust the agent to do tasks end-to-end", "信任智能体独立完成整个任务"],
    ["Automatically decide if commands run.", "自动判断是否运行命令。"],
    ["example: source ~/.jetski_shell_setup", "示例：source ~/.jetski_shell_setup"],
    ["Include Jetski Default Customizations", "包含 Jetski 默认自定义项"],
    ["Manage your notification preferences.", "管理您的通知偏好设置。"],
    ["Open the agent panel on window reload", "窗口重新加载时打开智能体面板"],
    ["Outside of folders file access policy", "文件夹外访问策略"],
    ["Read, edit, and export presentations.", "阅读、编辑和导出演示文稿。"],
    ["Read, write, and format spreadsheets.", "读取、写入电子表格并设置格式。"],
    ["Select where to open the conversation", "选择在哪里打开对话"],
    ["Set the rules, define the boundaries.", "设定规则，划定边界。"],
    ["Share your referral link with friends", "与好友分享你的推荐链接"],
    ["Drag to resize, double-click to reset", "拖动以调整大小，双击以重置"],
    ["What should the agent do on each run?", "每次运行时智能体应该做什么？"],
    ["Add them to allow future interactions", "将其加入允许列表，以便以后进行交互"],
    ["Couldn't delete your data. Try again.", "无法删除数据，请重试。"],
    ["Couldn't load Google Drive link title", "无法加载 Google 云端硬盘链接标题"],
    ["New models have been enabled for you!", "已为你启用新模型！"],
    ["Failed to create CitC clone workspace", "创建 CitC 克隆工作区失败"],
    ["The current trigger rate is too high.", "当前触发频率过高。"],
    ["Invoke a browser agent for web tasks.", "调用浏览器智能体处理网页任务。"],
    ["AI Credits Used to Generate Response", "已使用 AI 积分生成回复"],
    ["Allow executing actions on this URL?", "允许在此 URL 上执行操作？"],
    ["Configure allowed terminal commands.", "配置允许的终端命令。"],
    ["Did restarting the desktop app help?", "重启桌面应用是否有助于解决问题？"],
    ["Manage your model quota and credits.", "管理您的模型额度与积分。"],
    ["Scan the code to open this device in", "扫描二维码以在远程控制中打开此设备"],
    ["There are no customizations enabled.", "没有启用任何自定义项。"],
    ["No customizations match your search.", "没有与搜索条件匹配的自定义项。"],
    ["Manage project folders and settings.", "管理项目文件夹和设置。"],
    ["Authenticated via Enterprise Gateway", "已通过企业网关身份验证"],
    ["Agent encountered an internal error.", "智能体遇到内部错误。"],
    ["(tell the agent what to do instead)", "（告诉智能体改做什么）"],
    ["Are you sure you want to delete the", "确定要删除"],
    ["Browser Javascript Execution Policy", "浏览器 JavaScript 执行策略"],
    ["Browser JavaScript Execution Policy", "浏览器 JavaScript 执行策略"],
    ["By using this app, you agree to its", "使用本应用即表示你同意其"],
    ["Describe the bug you encountered...", "描述您遇到的错误..."],
    ["Downloading the Antigravity binary…", "正在下载 Antigravity 程序…"],
    ["Enter command (e.g., git, blaze)...", "输入命令（例如 git、blaze）..."],
    ["Loading workspace customizations...", "正在加载工作区自定义项..."],
    ["Manage and delete your data anytime", "随时管理并删除你的数据"],
    ["Queue until after the current turn.", "排队直到当前轮次结束后发送。"],
    ["Set how fast Tab suggestions appear", "设置 Tab 建议的显示速度"],
    ["Simulate running on a different OS.", "模拟在不同的操作系统上运行。"],
    ["Couldn't mark conversations as read", "无法将对话标记为已读"],
    ["Chief of Staff voice mode is active", "统筹助手语音模式已开启"],
    ["Keep All Chat Edits in this Session", "保留此会话中的所有聊天编辑"],
    ["Chief of Staff voice message failed", "统筹助手语音消息发送失败"],
    ["Importing project from AI Studio...", "正在从 AI Studio 导入项目..."],
    ["Creating the forked conversation...", "正在创建派生对话..."],
    ["Telemetry is turned off in settings", "遥测功能已在设置中关闭"],
    ["all commands without restrictions.", "无限制运行所有命令。"],
    ["Build with Antigravity IDE Plugins", "使用 Antigravity IDE 插件构建"],
    ["to have the agent generate a plan.", "让智能体生成计划。"],
    ["Search for files in the project...", "在项目中搜索文件..."],
    ["Design, creative, and media tools.", "设计、创意和媒体工具。"],
    ["Remove from history (Shift+Delete)", "从历史记录中移除 (Shift+Delete)"],
    ["Finish signing in in your browser.", "请在浏览器中完成登录。"],
    ["Drag to select a region to comment", "拖动选择要评论的区域"],
    ["Fetched network requests for page.", "已获取页面的网络请求。"],
    ["Unable to resolve audio source URL", "无法解析音频源 URL"],
    ["File Tree Component is not loaded.", "文件树组件尚未加载。"],
    ["Sends after agent finishes working", "在智能体完成工作后发送"],
    ["Enter Google Cloud Project Details", "输入 Google Cloud 项目详情"],
    ["Failed to load shared conversation", "加载共享对话失败"],
    ["Assist the agent to complete tasks", "协助智能体完成任务"],
    ["Create a new global workflow file.", "创建新的全局工作流文件。"],
    ["扫描二维码以在此设备上打开 Remote Control, or ", "扫描二维码以在远程控制中打开此设备，或 "],
    ["all commands without restrictions", "无限制运行所有命令"],
    ["Click to learn more about sources", "点击了解更多关于来源的信息"],
    ["Configure GitHub access policies.", "配置 GitHub 访问策略。"],
    ["Failed to Generate Commit Message", "生成提交说明失败"],
    ["Initializing virtual environments", "正在初始化虚拟环境"],
    ["No plugin loads from this folder.", "此文件夹中未加载任何插件。"],
    ["Open Agent panel on window reload", "窗口重新加载时打开智能体面板"],
    ["Productivity & Project Management", "效率与项目管理"],
    ["Telemetry is disabled in Settings", "遥测功能已在设置中禁用"],
    ["The agent always asks for review.", "智能体始终请求审核。"],
    ["to have the agent generate a plan", "让智能体生成计划"],
    ["Use full Git clones for Best of N", "为 Best of N 使用完整 Git 克隆"],
    ["Use full VCS clones for Best of N", "为 Best of N 使用完整 VCS 克隆"],
    ["Why did you choose this response?", "您为什么选择此回复？"],
    ["Docs, Sheets, Slides, and folders", "文档、表格、幻灯片和文件夹"],
    ["Fetched network request for page.", "已获取页面的网络请求。"],
    ["This chat's environment is paused", "此对话的环境已暂停"],
    ["Sidecar feature is not available.", "Sidecar 功能不可用。"],
    ["Pairs (arm order may be shuffled)", "配对（分组顺序可能会打乱）"],
    ["Discover helpful skills & plugins", "发现有用的技能与插件"],
    ["Chief of Staff voice mode stopped", "统筹助手语音模式已停止"],
    ["Unlock the power of agent swarms.", "充分发挥智能体群组的能力。"],
    ["扫描二维码以此设备上打开 Remote Control, or ", "扫描二维码以在远程控制中打开此设备，或 "],
    ["扫描二维码以在此设备上打开 Remote Control, or", "扫描二维码以在远程控制中打开此设备，或"],
    ["Allow write access to this path?", "允许写入此路径？"],
    ["Ask before sensitive operations.", "执行敏感操作前先询问。"],
    ["Connecting to language server...", "正在连接语言服务..."],
    ["Daily conversation limit reached", "已达到每日会话上限"],
    ["Every command requires approval.", "每条命令都需要审核。"],
    ["Folders these agents can access.", "这些智能体可访问的文件夹。"],
    ["How loud Antigravity's voice is.", "调整 Antigravity 语音的音量。"],
    ["Manage Antigravity app settings.", "管理 Antigravity 应用设置。"],
    ["Mark This Conversation as Unread", "将此对话标为未读"],
    ["Select one of the three options.", "选择以下三个选项之一。"],
    ["Set the speed of tab suggestions", "设置 Tab 建议的显示速度"],
    ["This command ran in the sandbox.", "此命令已在沙盒中运行。"],
    ["Toggle Between Light/Dark Themes", "切换浅色或深色主题"],
    ["Taking longer than usual to load", "加载时间比平时更长"],
    ["Sign in with a different account", "使用其他账号登录"],
    ["For example: Morning bug summary", "例如：早间缺陷汇总"],
    ["The branch was pushed to GitLab.", "分支已推送到 GitLab。"],
    ["The change was pushed to Gerrit.", "变更已推送到 Gerrit。"],
    ["What is missing in your workflow", "你的工作流中缺少什么"],
    ["Use Google Cloud project instead", "改用 Google Cloud 项目"],
    ["Importing shared conversation...", "正在导入共享对话..."],
    ["Fork conversation in this folder", "在此文件夹中派生对话"],
    ["Max tokens until compaction info", "触发压缩前的最大 Token 数信息"],
    ["Interview me to align on a plan.", "通过提问与我就计划达成一致。"],
    ["? This action cannot be undone.", "？此操作无法撤销。"],
    ["扫描二维码以此设备上打开 Remote Control, or", "扫描二维码以在远程控制中打开此设备，或"],
    ["Agent Non-Workspace File Access", "智能体访问工作区外文件"],
    ["Allow read access to this path?", "允许读取此路径？"],
    ["Are you sure you want to delete", "确定要删除"],
    ["Enter file or directory path...", "输入文件或目录路径..."],
    ["Error loading Browser recording", "加载浏览器录制内容时出错"],
    ["Folder has more than 1000 files", "文件夹包含超过 1000 个文件"],
    ["No quota information available.", "暂无可用的配额信息。"],
    ["Open search in external browser", "在外部浏览器中打开搜索"],
    ["Search by name or Cascade ID...", "按名称或 Cascade ID 搜索..."],
    ["Set the volume of agent sounds.", "设置智能体提示音的音量。"],
    ["Split Conversation Horizontally", "水平拆分对话"],
    ["Terminal Command Auto Execution", "终端命令自动执行"],
    ["User cancelled agent execution.", "用户已取消智能体执行。"],
    ["Welcome to the new Antigravity!", "欢迎使用新版 Antigravity！"],
    ["Open the page in system browser", "在系统浏览器中打开页面"],
    ["Continue with different account", "使用其他账号继续"],
    ["This bundle has no plugins yet.", "此插件包中还没有插件。"],
    ["Select or enter a workspace URI", "选择或输入工作区 URI"],
    ["Failed to create remote project", "创建远程项目失败"],
    ["Prompt to run when triggered...", "输入触发时要运行的提示词..."],
    ["Best of N mode is not available", "Best of N 模式不可用"],
    ["Reset all shortcuts to defaults", "将所有快捷键恢复为默认值"],
    ["Dismiss IWA installation banner", "关闭 IWA 安装提示"],
    ["Add screenshot to conversation", "将截图添加到会话"],
    ["Allow access to this resource?", "允许访问此资源？"],
    ["Are you sure you want to quit?", "确定要退出吗？"],
    ["Attach a screenshot (optional)", "附上截图（可选）"],
    ["Attach Antigravity server logs", "附上 Antigravity 服务端日志"],
    ["Attach Antigravity Server Logs", "附上 Antigravity 服务端日志"],
    ["Build with one agent or a team", "单智能体或多智能体团队协同构建"],
    ["Enable notifications for Agent", "为智能体启用通知"],
    ["Enable Notifications for Agent", "启用智能体系统通知"],
    ["Getting started with a Project", "开始使用项目"],
    ["Mark This Conversation as Read", "将此对话标为已读"],
    ["Refresh quota and credits data", "刷新额度和积分数据"],
    ["Terminal & Tooling Permissions", "终端与工具权限"],
    ["The full developer experience.", "面向开发者的完整全功能体验。"],
    ["Toggle Maximize Auxiliary Pane", "切换最大化辅助窗格"],
    ["Your connection is not private", "你的连接不是私密连接"],
    ["Auto-assignment not configured", "未配置自动分配"],
    ["Delete All Remote Agents Data?", "删除所有远程智能体数据？"],
    ["Create a Plugin with the Agent", "使用智能体创建插件"],
    ["Explore the plugin marketplace", "浏览插件市场"],
    ["Could not create Cog workspace", "无法创建 Cog 工作区"],
    ["Failed to delete side question", "删除副问题失败"],
    ["Sending transcribed message...", "正在发送转录后的消息..."],
    ["Setup script ran successfully.", "设置脚本运行成功。"],
    ["Screenshot must be under 10 MB", "截图必须小于 10 MB"],
    ["Connect your account to browse", "连接账号以浏览"],
    ["Apps connected to your account", "已连接到你账号的应用"],
    ["Failed to start Best of N mode", "启动 Best of N 模式失败"],
    ["To use the agent, please login", "请登录以使用智能体"],
    ["Enable tab in gitignored files", "在 Git 忽略的文件中启用 Tab"],
    ["Dismiss artifact update notice", "关闭产物更新通知"],
    ["Show the welcome screen again.", "重新显示欢迎界面。"],
    ["Select a model to send message", "请选择用于发送消息的模型"],
    ["Agent always asks for review.", "智能体始终请求审核。"],
    ["Agent terminated due to error", "智能体因错误而终止"],
    ["Browser Actuation Permissions", "浏览器操作权限"],
    ["e.g. \"My Custom Gemini Model\"", "例如“我的自定义 Gemini 模型”"],
    ["Enable Sandbox Mode (Preview)", "启用沙盒模式（预览）"],
    ["Failed to delete conversation", "删除对话失败"],
    ["Failed to rename conversation", "重命名对话失败"],
    ["Managed by Enterprise Gateway", "由企业网关托管"],
    ["New Conversation in Workspace", "在工作区中新建对话"],
    ["Requires manual confirmation.", "需要手动确认。"],
    ["Review plans and walkthroughs", "审查计划与演练讲解"],
    ["Run in your current workspace", "在当前工作区中运行"],
    ["See more in Build with Google", "查看“使用 Google 构建”中的更多内容"],
    ["Split Conversation Vertically", "垂直拆分对话"],
    ["The voice used in Voice mode.", "语音模式使用的声音。"],
    ["Undo changes up to this point", "撤销到此处的更改"],
    ["Workspace URI query parameter", "工作区 URI 查询参数"],
    ["Click to view or edit comment", "点击查看或编辑评论"],
    ["Delete All Remote Agents Data", "删除所有远程智能体数据"],
    ["Enable the plugin to sign in.", "启用此插件后即可登录。"],
    ["Keeps your checkout untouched", "保持当前检出状态不变"],
    ["Failed to start side question", "启动副问题失败"],
    ["Failed to revert conversation", "恢复对话失败"],
    ["Set at least one scope filter", "至少设置一个范围筛选条件"],
    ["Too many environments running", "运行中的环境过多"],
    ["Active Tasks & Conversations:", "活跃任务与对话："],
    ["Boolean AND, OR, and negation", "布尔与、或及取反"],
    ["Failed to refresh credentials", "刷新凭据失败"],
    ["e.g., main or refs/heads/main", "例如 main 或 refs/heads/main"],
    ["Create a Fig shared workspace", "创建 Fig 共享工作区"],
    ["Address CLs needing attention", "处理需要关注的更改列表"],
    ["Allow List Terminal Commands", "终端命令允许列表"],
    ["Auto-Expand Changes Overview", "自动展开更改概览"],
    ["Baseline model quota reached", "已达基础模型额度上限"],
    ["Better instruction following", "指令遵循更准确"],
    ["Download the Antigravity IDE", "下载 Antigravity IDE"],
    ["Enter tool name or server...", "输入工具名称或服务器..."],
    ["Failed to send side question", "发送副问题失败"],
    ["Failed to start conversation", "启动对话失败"],
    ["Loading available plugins...", "正在加载可用插件..."],
    ["Manage application settings.", "管理应用设置。"],
    ["Only stored on your machine.", "仅存储在你的本地计算机上。"],
    ["Previous match (Shift+Enter)", "上一个匹配项 (Shift+Enter)"],
    ["Restart Main Language Server", "重启主语言服务"],
    ["Resume it to load this file.", "恢复该会话以加载此文件。"],
    ["Select Model to Send Message", "选择用于发送消息的模型"],
    ["Select Previous Conversation", "选择上一个对话"],
    ["Share Conversation (Preview)", "分享对话（预览）"],
    ["Sidebar grouped by workspace", "侧边栏已按工作区分组"],
    ["Steps to reproduce the issue", "重现此问题的步骤"],
    ["The other model hallucinated", "另一个模型出现了幻觉"],
    ["This page is going away soon", "此页面即将停用"],
    ["View archived in the sidebar", "在侧边栏查看已归档内容"],
    ["Couldn't edit queued message", "无法编辑排队中的消息"],
    ["No compatible devices found.", "未找到兼容的设备。"],
    ["No matching resources found.", "未找到匹配的资源。"],
    ["Loading installed plugins...", "正在加载已安装的插件..."],
    ["Provide Google Cloud Project", "提供 Google Cloud 项目"],
    ["Nothing is running right now", "当前没有正在运行的内容"],
    ["Error while editing notebook", "编辑笔记本时出错"],
    ["Error while reading notebook", "读取笔记本时出错"],
    ["Could not load the app view:", "无法加载应用视图："],
    ["Open extracted DOM in editor", "在编辑器中打开提取的 DOM"],
    ["Loading Browser recording...", "正在加载浏览器录制内容..."],
    ["Dismiss service announcement", "关闭服务公告"],
    ["GitHub Personal Access Token", "GitHub 个人访问令牌"],
    ["managed by your organization", "由你的组织管理"],
    ["Keep Chat Edits in this File", "保留此文件中的聊天编辑"],
    ["Undo Chat Edits in this File", "撤销此文件中的聊天编辑"],
    ["Refresh Custom Agent Configs", "刷新自定义智能体配置"],
    ["Workspace folder suggestions", "工作区文件夹建议"],
    ["Reset post-onboarding state.", "重置入门后的状态。"],
    ["Welcome to Cider with Jetski", "欢迎使用 Cider with Jetski"],
    ["Review pending conversations", "审核待处理的对话"],
    ["Allow running this command?", "允许运行此命令？"],
    ["Automatic Check for Updates", "自动检查更新"],
    ["Clearer writing & artifacts", "表述与产物更清晰"],
    ["Confirm Browser Interaction", "确认浏览器交互"],
    ["Context and Quota Indicator", "上下文与配额指示器"],
    ["Deny List Terminal Commands", "终端命令拒绝列表"],
    ["Enter avatar URL (optional)", "输入头像 URL（可选）"],
    ["Explore the new Antigravity", "探索新版 Antigravity"],
    ["Extension (Antigravity IDE)", "扩展 (Antigravity IDE)"],
    ["Failed to fork conversation", "创建分支对话失败"],
    ["Failed to stop conversation", "停止对话失败"],
    ["Gemini 4 Argon Weekly Limit", "Gemini 4 Argon 周额度"],
    ["Generate CitC Workspace VCS", "生成 CitC 工作区 VCS"],
    ["Max Tokens Until Compaction", "触发压缩的最大 Token 数"],
    ["New Conversation in Project", "在项目中新建对话"],
    ["Paths the agent can modify.", "智能体可修改的路径。"],
    ["Read, draft, and edit docs.", "阅读、起草和编辑文档。"],
    ["Show Remote Control QR code", "显示远程控制二维码"],
    ["Skills Configuration Error:", "技能配置错误："],
    ["Terms of Service & Data Use", "服务条款与数据使用"],
    ["Toggle Environment Selector", "切换环境选择器"],
    ["Windows Subsystem for Linux", "适用于 Linux 的 Windows 子系统"],
    ["Clear cookies and site data", "清除 Cookie 和网站数据"],
    ["Enter authorization code...", "输入授权码..."],
    ["Finalizing transcription...", "正在完成转录..."],
    ["Image preview not available", "图片预览不可用"],
    ["Daily environment time used", "每日环境使用时间已用尽"],
    ["This may take a few minutes", "这可能需要几分钟"],
    ["Use Regular Expression (.*)", "使用正则表达式 (.*)"],
    ["Search for conversations...", "搜索对话..."],
    ["Failed to create workspace.", "创建工作区失败。"],
    ["Configure Worktree Branches", "配置工作树分支"],
    ["Reset Post-Onboarding Setup", "重置入门后的设置"],
    ["Generate personalized rules", "生成个性化规则"],
    ["Open Command Center Default", "打开默认命令中心"],
    ["Administrator access (UAC)", "管理员权限 (UAC)"],
    ["Agent Auto-Fix Lint Errors", "智能体自动修复 Lint 错误"],
    ["Allow using this MCP tool?", "允许使用此 MCP 工具？"],
    ["Browser tools (browser_.*)", "浏览器工具 (browser_.*)"],
    ["Click to copy full command", "点击复制完整命令"],
    ["Cloud Hosting & Deployment", "云托管与部署"],
    ["Copy conversation markdown", "复制对话 Markdown"],
    ["Copy Conversation Markdown", "复制对话的 Markdown 内容"],
    ["Copy full URL to clipboard", "复制完整 URL 到剪贴板"],
    ["Don't show this for 2 days", "2 天内不再显示"],
    ["No automations configured.", "尚未配置任何自动化。"],
    ["No conversations available", "暂无可用对话"],
    ["Open Trajectory Debug View", "打开执行轨迹调试视图"],
    ["Open with External Browser", "使用外部浏览器打开"],
    ["Search MCP servers by name", "按名称搜索 MCP 服务器"],
    ["Sidebar grouped by project", "侧边栏已按项目分组"],
    ["This site can’t be reached", "无法访问此网站"],
    ["Toggle Maximize Side Panel", "切换最大化侧边栏面板"],
    ["Uploading to Google Drive…", "正在上传到 Google 云端硬盘…"],
    ["Continue with Google Cloud", "使用 Google Cloud 继续"],
    ["Having trouble signing in?", "登录遇到问题？"],
    ["No matching plugins found.", "未找到匹配的插件。"],
    ["Conversation limit reached", "已达到对话数量上限"],
    ["Model Summarization Failed", "模型摘要生成失败"],
    ["Join the Google Chat space", "加入 Google Chat 空间"],
    ["Work in an ABFS workspace.", "在 ABFS 工作区中工作。"],
    ["Workspace URI to switch to", "要切换到的工作区 URI"],
    ["Resize side question panel", "调整侧边问题面板大小"],
    ["Workspace mismatch actions", "工作区不匹配时的操作"],
    ["Search for content to open", "搜索要打开的内容"],
    ["Create New Global Workflow", "创建新的全局工作流"],
    ["Reset to default shortcuts", "将快捷键恢复为默认值"],
    ["Core AI Systems is hiring!", "Core AI Systems 正在招聘！"],
    ["Your This Computer setting", "您在“此电脑”中的设置"],
    ["Antigravity Starter Quota", "Antigravity 起始配额"],
    ["Archive this conversation", "归档此对话"],
    ["Archive This Conversation", "归档此对话"],
    ["Browser User Profile Path", "浏览器用户资料路径"],
    ["Build With Google Plugins", "使用 Google 插件构建"],
    ["Built with Google Plugins", "使用 Google 插件构建"],
    ["Enable AI Credit Overages", "启用 AI 积分超额使用"],
    ["Enter bot name (optional)", "输入机器人名称（可选）"],
    ["Failed to create terminal", "创建终端失败"],
    ["Five Hour Limit Remaining", "剩余 5 小时限额"],
    ["Local Windows environment", "本地 Windows 环境"],
    ["MCP Authentication Error:", "MCP 身份验证错误："],
    ["Open Conversation History", "打开对话历史"],
    ["Other (write your answer)", "其他（输入您的回答）"],
    ["Paths the agent can read.", "智能体可读取的路径。"],
    ["Project validation failed", "项目验证失败"],
    ["Project-Specific Settings", "项目专属设置"],
    ["Refresh gcert Credentials", "刷新 gcert 凭据"],
    ["Search conversations with", "点击左上角的"],
    ["Select Python Interpreter", "选择 Python 解释器"],
    ["Skills and Rules Settings", "技能与规则设置"],
    ["Something else (optional)", "其他原因（可选）"],
    ["Sync JJ Worktrees to Head", "将 JJ 工作树同步到最新提交"],
    ["Toggle Agent (Ctrl+Alt+B)", "切换智能体 (Ctrl+Alt+B)"],
    ["Loading customizations...", "正在加载自定义项..."],
    ["Agent Hooks Configuration", "智能体钩子配置"],
    ["Enable Recommended Skills", "启用推荐技能"],
    ["No files or folders found", "未找到文件或文件夹"],
    ["Open in full conversation", "在完整对话中打开"],
    ["Failed to load some diffs", "部分差异加载失败"],
    ["Connecting to terminal...", "正在连接终端..."],
    ["Failed to get annotations", "获取批注失败"],
    ["Failed to create worktree", "创建工作树失败"],
    ["Link copied to clipboard.", "链接已复制到剪贴板。"],
    ["Artifact updated by agent", "产物已由智能体更新"],
    ["Couldn't switch accounts:", "无法切换账号："],
    ["Error fetching MCP prompt", "获取 MCP 提示词失败"],
    ["Open Folder (Interactive)", "打开文件夹（交互式）"],
    ["Work in a CitC workspace.", "在 CitC 工作区中工作。"],
    ["What counts as a document", "哪些内容算作文档"],
    ["Run in a new git worktree", "在新的 Git 工作树中运行"],
    ["Any relevant information", "任何相关信息"],
    ["Commands Outside Sandbox", "沙盒外命令执行"],
    ["Complete Onboarding Step", "完成引导步骤"],
    ["Conversation unavailable", "对话不可用"],
    ["Current sidebar grouping", "当前侧边栏分组方式"],
    ["Default Cog Branch / Ref", "默认 Cog 分支 / 引用"],
    ["Search Recent Workspaces", "搜索最近的工作区"],
    ["Updated sidebar grouping", "已更新侧边栏分组方式"],
    ["Notification Preferences", "通知偏好设置"],
    ["Open in external browser", "在外部浏览器中打开"],
    ["Open in Built-in Browser", "在内置浏览器中打开"],
    ["Discard unstaged changes", "放弃未暂存的更改"],
    ["Search customizations...", "搜索自定义项..."],
    ["Select Next Conversation", "选择下一个对话"],
    ["Rename This Conversation", "重命名此对话"],
    ["Include unstaged changes", "包含未暂存的更改"],
    ["MCP Configuration Error:", "MCP 配置错误："],
    ["Editor-Specific Settings", "编辑器专属设置"],
    ["Enable Shell Integration", "启用 Shell 集成"],
    ["Import AI Studio Project", "导入 AI Studio 项目"],
    ["Launching the browser...", "正在启动浏览器..."],
    ["No MCP servers installed", "未安装 MCP 服务器"],
    ["Open Conversation Picker", "打开对话选择器"],
    ["Project name. E.g. Tasks", "项目名称，例如 Tasks"],
    ["Workspace Command Access", "工作区命令访问"],
    ["Your Plan: Google AI Pro", "你的套餐：Google AI Pro"],
    ["Design, Creative & Media", "设计、创意与媒体"],
    ["Failed to load resources", "加载资源失败"],
    ["Business Account Sign In", "商务账号登录"],
    ["Could not create project", "无法创建项目"],
    ["Fork in Shared Workspace", "在共享工作区中派生"],
    ["Loading conversations...", "正在加载对话..."],
    ["Loading Notebook View...", "正在加载笔记本视图..."],
    ["Failed to render diagram", "渲染图表失败"],
    ["Resolving permissions...", "正在解析权限..."],
    ["No token data available.", "没有可用的 Token 数据。"],
    ["Uploaded to Google Drive", "已上传到 Google 云端硬盘"],
    ["Error rendering playback", "渲染回放时出错"],
    ["View could not be opened", "无法打开视图"],
    ["CEL Expression Reference", "CEL 表达式参考"],
    ["Remote Control Instances", "远程控制实例"],
    ["view full search results", "查看完整搜索结果"],
    ["Antigravity Tab Settings", "Antigravity 标签页设置"],
    ["Duplicate workspace name", "工作区名称重复"],
    ["Failed to resolve folder", "无法定位文件夹"],
    ["Enable Tab Sounds (Beta)", "启用 Tab 音效（测试版）"],
    ["Work in a Cog workspace.", "在 Cog 工作区中工作。"],
    ["Show Conversation Picker", "显示对话选择器"],
    ["Next: Review Permissions", "下一步：审核权限"],
    ["Advanced Command Access", "高级命令访问"],
    ["Agent execution failed.", "智能体执行失败。"],
    ["Allow reading this URL?", "允许读取此 URL？"],
    ["Automatic update checks", "自动检查更新"],
    ["Back to Scheduled Tasks", "返回定时任务"],
    ["Browser Actuation Rules", "浏览器操作规则"],
    ["Copy error to clipboard", "将错误复制到剪贴板"],
    ["Customize Global Skills", "自定义全局技能"],
    ["Deny setting up browser", "拒绝设置浏览器"],
    ["Edit Conversation Title", "编辑对话标题"],
    ["Enable Demo Mode (Beta)", "启用演示模式（测试版）"],
    ["Enable Sounds for Agent", "启用智能体提示音"],
    ["Enable Terminal Sandbox", "启用终端沙盒"],
    ["Insufficient AI Credits", "AI 积分不足"],
    ["Markdown Artifact Width", "Markdown 产物宽度"],
    ["Marketplace Gallery URL", "插件市场列表 URL"],
    ["New Conversation Button", "新会话按钮"],
    ["Open Keyboard Shortcuts", "打开键盘快捷键"],
    ["Open System Preferences", "打开系统设置"],
    ["Open Workspace Selector", "打开工作区选择器"],
    ["Plugin Operation Error:", "插件操作错误："],
    ["Powered by Gemini Live.", "由 Gemini Live 提供支持。"],
    ["Previous Side Panel Tab", "上一个侧边栏标签页"],
    ["Queued Message Delivery", "排队消息发送"],
    ["Search conversations...", "搜索对话..."],
    ["Standalone Conversation", "独立对话"],
    ["Toggle Project Selector", "切换项目选择器"],
    ["Unpin This Conversation", "取消固定此对话"],
    ["Create a project first.", "请先创建项目。"],
    ["More cloud environments", "更多云端环境"],
    ["Conversation Unarchived", "对话已取消归档"],
    ["Open in Antigravity IDE", "在 Antigravity IDE 中打开"],
    ["Optional boolean filter", "可选布尔筛选条件"],
    ["Failed to load comments", "加载评论失败"],
    ["Authentication Required", "需要身份验证"],
    ["Close Tabs to the Right", "关闭右侧标签页"],
    ["Show or Hide Extensions", "显示或隐藏扩展"],
    ["UI view does not exist.", "界面视图不存在。"],
    ["No extensions available", "没有可用扩展"],
    ["Use Advanced SSO Config", "使用高级 SSO 配置"],
    ["Google Cloud Project ID", "Google Cloud 项目 ID"],
    ["Search file contents...", "搜索文件内容..."],
    ["Workspace setup warning", "工作区设置警告"],
    ["Log in to use the agent", "登录以使用智能体"],
    ["No resources added yet.", "尚未添加资源。"],
    ["Show Whitespace Changes", "显示空白字符更改"],
    ["Hide Whitespace Changes", "隐藏空白字符更改"],
    ["Refresh all credentials", "刷新所有凭据"],
    ["Create a new rule file.", "创建新规则文件。"],
    ["This page isn’t working", "此页面无法正常运行"],
    ["Amend and Upload Failed", "修订并上传失败"],
    ["Updates to your sidebar", "侧边栏更新"],
    ["Fork Environment Notice", "派生环境提示"],
    ["Announcements and tips", "公告和提示"],
    ["Antigravity - Settings", "Antigravity - 设置"],
    ["Artifact Review Policy", "产物审核策略"],
    ["Auto-Open Edited Files", "自动打开已编辑文件"],
    ["Background Task Output", "后台任务输出"],
    ["Better solution & code", "方案与代码质量更好"],
    ["Cancel Sending Message", "取消发送消息"],
    ["Copy the trajectory ID", "复制轨迹 ID"],
    ["Default Cog Repository", "默认 Cog 仓库"],
    ["Default Customizations", "默认自定义项"],
    ["Edit permission target", "编辑权限目标"],
    ["Highlight After Accept", "接受后高亮"],
    ["Loading MCP servers...", "正在加载 MCP 服务器..."],
    ["Loading token usage...", "正在加载 Token 用量..."],
    ["Marketplace Search URL", "插件市场列表 URL"],
    ["Model Context Protocol", "模型上下文协议 (MCP)"],
    ["More thorough research", "调研更全面深入"],
    ["Move Conversation Down", "下移对话"],
    ["My Custom Gemini Model", "我的自定义 Gemini 模型"],
    ["No conversations found", "未找到对话"],
    ["No more older messages", "没有更早的消息了"],
    ["Open Browser (Preview)", "打开浏览器 (预览)"],
    ["Open in Remote Control", "在远程控制中打开"],
    ["Opening URL in Browser", "正在浏览器中打开 URL"],
    ["Pick at most 2 reasons", "最多选择 2 个原因"],
    ["quota and credits data", "额度和积分数据"],
    ["Search across files...", "跨文件搜索..."],
    ["Show Selection Actions", "显示选择操作"],
    ["Toggle Developer Tools", "切换开发者工具"],
    ["Toggle Voice Recording", "切换语音录制"],
    ["Weekly Limit Remaining", "剩余周额度"],
    ["Delete all recordings?", "删除所有录音？"],
    ["Authentication expired", "身份验证已过期"],
    ["Attach terminal output", "附加终端输出"],
    ["Plugin update required", "需要更新插件"],
    ["Work in a New Worktree", "在新工作树中工作"],
    ["Waiting for user input", "正在等待用户输入"],
    ["This chat is archived.", "此对话已归档。"],
    ["Open side-by-side view", "打开并排视图"],
    ["When something happens", "发生事件时"],
    ["Full output written to", "完整输出已写入"],
    ["No resources available", "没有可用资源"],
    ["Remote agents are busy", "远程智能体正忙"],
    ["Close Tabs to the Left", "关闭左侧标签页"],
    ["Side Pane UI Available", "侧边面板界面可用"],
    ["This cannot be undone.", "此操作无法撤销。"],
    ["Search for commands...", "搜索命令..."],
    ["Duplicate project name", "项目名称重复"],
    ["Upload to Google Drive", "上传到 Google Drive"],
    ["Failed to save project", "保存项目失败"],
    ["Copy this subtree JSON", "复制此子树的 JSON"],
    ["Conversation Telemetry", "对话遥测"],
    ["Previous side question", "上一个侧边问题"],
    ["Minimize side question", "最小化侧边问题"],
    ["Use regular expression", "使用正则表达式"],
    ["Refresh customizations", "刷新自定义项"],
    ["Model selector loading", "正在加载模型选择器"],
    ["Show Browser Allowlist", "显示浏览器允许列表"],
    ["Sync and Upload Failed", "同步并上传失败"],
    ["Playback speed (< / >)", "播放速度（< / >）"],
    ["Sent to Chief of Staff", "已发送给统筹助手"],
    ["Custom flag to turn on", "要启用的自定义标志"],
    ["Actuation Permissions", "操作权限"],
    ["Allow in Conversation", "在本次对话中允许"],
    ["At mention code block", "@ 引用代码块"],
    ["At Mention Code Block", "@ 引用代码块"],
    ["Auto-Execution Policy", "自动执行策略"],
    ["Claude and GPT models", "Claude 和 GPT 模型"],
    ["Claude and GPT Models", "Claude 和 GPT 模型"],
    ["Confirm Window Reload", "确认重新加载窗口"],
    ["Conversation Archived", "对话已归档"],
    ["Copy Config File Path", "复制配置文件路径"],
    ["Default Workspace VCS", "默认工作区 VCS"],
    ["Enable Remote Control", "启用远程控制"],
    ["Experimental features", "实验性功能"],
    ["Experimental Features", "实验性功能"],
    ["File path breadcrumbs", "文件路径导航面包屑"],
    ["Installed MCP Servers", "已安装的 MCP 服务器"],
    ["Model quota exhausted", "模型额度已耗尽"],
    ["More feedback options", "更多反馈选项"],
    ["Notification Settings", "通知设置"],
    ["Open project settings", "打开项目设置"],
    ["Opened URL in Browser", "已在浏览器中打开 URL"],
    ["Pin this conversation", "固定此对话"],
    ["Pin This Conversation", "固定此对话"],
    ["Previous Aux Pane Tab", "上一个辅助窗格标签页"],
    ["Regroup Google3 Chats", "重新对 Google3 聊天分组"],
    ["Run in a new worktree", "在新的 Worktree 中运行"],
    ["Sandbox Allow Network", "允许沙盒访问网络"],
    ["Search automations...", "搜索自动化..."],
    ["Start Voice Recording", "开始语音录制"],
    ["Suggestions in Editor", "编辑器内联建议"],
    ["Terminal: Add to Chat", "终端：添加到对话"],
    ["Toggle Auxiliary Pane", "切换辅助面板"],
    ["Toggle Model Selector", "切换模型选择器"],
    ["Toggle Overview Panel", "切换概览面板"],
    ["Workspace File Access", "工作区文件访问"],
    ["View site information", "查看网站信息"],
    ["Cookies and site data", "Cookie 和网站数据"],
    ["Open Image in New Tab", "在新标签页中打开图片"],
    ["Embedding Limitations", "嵌入限制"],
    ["Reset All to Defaults", "全部恢复默认值"],
    ["Save audio recordings", "保存录音"],
    ["Set up authentication", "设置身份验证"],
    ["Other sign-in options", "其他登录方式"],
    ["Verification required", "需要验证"],
    ["Complete verification", "完成验证"],
    ["No plugins available.", "没有可用的插件。"],
    ["Enter project name...", "输入项目名称..."],
    ["Fork in New Workspace", "在新工作区中派生"],
    ["No previous worktrees", "没有以前的工作树"],
    ["No environments found", "未找到环境"],
    ["Runs on this computer", "在此电脑上运行"],
    ["Binary file not shown", "不显示二进制文件"],
    ["Open in Notebook View", "在笔记本视图中打开"],
    ["No browser pages open", "没有打开的浏览器页面"],
    ["Failed to fetch diffs", "获取差异失败"],
    ["Failed to render math", "渲染数学公式失败"],
    ["Target text in PDF...", "在 PDF 中查找文本..."],
    ["Something went wrong!", "出现问题！"],
    ["Pull request creation", "创建拉取请求"],
    ["Choose a Subscription", "选择订阅"],
    ["Fallback Summary Used", "已使用备用摘要"],
    ["View network requests", "查看网络请求"],
    ["Match Whole Word (ab)", "全词匹配 (ab)"],
    ["What's in this bundle", "此插件包包含的内容"],
    ["Loading trajectory...", "正在加载执行轨迹..."],
    ["Prohibited Use Policy", "禁止使用政策"],
    ["Google Privacy Policy", "Google 隐私权政策"],
    ["troubleshooting guide", "故障排除指南"],
    ["No folders added yet.", "尚未添加文件夹。"],
    ["Google3 Configuration", "Google3 配置"],
    ["Trajectory Debug View", "轨迹调试视图"],
    ["Copy raw string value", "复制原始字符串值"],
    ["Send Terminal to Chat", "将终端发送到聊天"],
    ["Refresh custom agents", "刷新自定义智能体"],
    ["Customizations source", "自定义项来源"],
    ["Reason for opting out", "选择退出的原因"],
    ["Select Default Branch", "选择默认分支"],
    ["Resize terminal panes", "调整终端窗格大小"],
    ["Chief of Staff canvas", "统筹助手画布"],
    ["Delete ABFS Workspace", "删除 ABFS 工作区"],
    ["[Dev] GCP Project ID", "[开发] GCP 项目 ID"],
    ["Advanced File Access", "高级文件访问"],
    ["Agent Auto-Fix Lints", "智能体自动修复 Lint 错误"],
    ["Archive conversation", "归档对话"],
    ["Archive Conversation", "归档对话"],
    ["Cancel questionnaire", "取消问卷"],
    ["Collapse All Folders", "折叠所有文件夹"],
    ["Command Setup Script", "命令初始化脚本"],
    ["Comment on Selection", "评论选中内容"],
    ["Conversation History", "对话历史"],
    ["Copy Conversation ID", "复制对话 ID"],
    ["Create Cloud Project", "创建云端项目"],
    ["Custom Context Menus", "自定义右键菜单"],
    ["Customizations views", "自定义视图"],
    ["Dismiss notification", "关闭通知"],
    ["Download Diagnostics", "下载诊断信息"],
    ["Enable Browser Tools", "启用浏览器工具"],
    ["Enable Notifications", "启用通知"],
    ["Enter device name...", "输入设备名称…"],
    ["Enter URL pattern...", "输入 URL 匹配模式..."],
    ["Equalize Split Panes", "均分拆分窗格"],
    ["Error Loading Models", "加载模型出错"],
    ["Find in Conversation", "在对话中查找"],
    ["Go Explorer: Refresh", "Go 资源管理器: 刷新"],
    ["Marketplace Item URL", "插件市场单项 URL"],
    ["Move Conversation Up", "上移对话"],
    ["Network Access Rules", "网络访问规则"],
    ["No conversations yet", "暂无对话"],
    ["No updates available", "当前已是最新版本"],
    ["Open Agent on Reload", "重新加载时打开智能体"],
    ["Open Command Palette", "打开命令面板"],
    ["Open Editor Settings", "打开编辑器设置"],
    ["Open in Preview Pane", "在预览窗格中打开"],
    ["Other Customizations", "其他自定义项"],
    ["Pinned Conversations", "已固定对话"],
    ["Remote Control Issue", "远程控制问题"],
    ["Restore Conversation", "恢复对话"],
    ["Search all convos...", "搜索全部对话..."],
    ["Search Conversations", "搜索对话"],
    ["Search workspaces...", "搜索工作区…"],
    ["Stop Voice Recording", "停止语音录制"],
    ["Tab Gitignore Access", "Tab 键访问 .gitignore 排除文件"],
    ["Untracked (Unstaged)", "未跟踪（未暂存）"],
    ["Workspace + Worktree", "工作区与工作树"],
    ["Workspace Web Access", "工作区网页访问"],
    ["Yes, allow this time", "是，仅允许本次"],
    ["Open Link in New Tab", "在新标签页中打开链接"],
    ["Embedded web preview", "嵌入式网页预览"],
    ["Settings Unavailable", "设置不可用"],
    ["Continue with Google", "使用 Google 账号继续"],
    ["No Plugins Available", "没有可用的插件"],
    ["MCP Servers Disabled", "MCP 服务器已禁用"],
    ["Browse MCP resources", "浏览 MCP 资源"],
    ["Loading worktrees...", "正在加载工作树..."],
    ["Capture Console Logs", "捕获控制台日志"],
    ["Failed to stop agent", "停止智能体失败"],
    ["Delete Side Question", "删除副问题"],
    ["Blocked, needs input", "已阻止，需要输入"],
    ["Open Antigravity IDE", "打开 Antigravity IDE"],
    ["Where should it run?", "应该在哪里运行？"],
    ["No changes to review", "没有需要审查的更改"],
    ["Creating terminal...", "正在创建终端..."],
    ["Standalone Terminals", "独立终端"],
    ["Failed to load image", "加载图片失败"],
    ["Unsandboxed commands", "沙盒外命令"],
    ["Something went wrong", "出现问题"],
    ["Select another model", "选择其他模型"],
    ["Select Billing Model", "选择计费方式"],
    ["Setup script failed.", "设置脚本运行失败。"],
    ["View network request", "查看网络请求"],
    ["Knowledge Generation", "知识生成"],
    ["Paste a code instead", "改为粘贴代码"],
    ["Switch IDE Workspace", "切换 IDE 工作区"],
    ["Harness per Response", "每个回复的执行框架"],
    ["Software Engineering", "软件工程"],
    ["Voice engine address", "语音引擎地址"],
    ["Antigravity Settings", "Antigravity 设置"],
    ["Create a JJ worktree", "创建 JJ 工作树"],
    ["Active Browser pages", "活动的浏览器页面"],
    ["Refresh skills paths", "刷新技能路径"],
    ["Copy section content", "复制章节内容"],
    ["Add Context to Agent", "向智能体添加上下文"],
    ["View or edit comment", "查看或编辑评论"],
    ["Available workspaces", "可用工作区"],
    ["Show or Hide Plugins", "显示或隐藏插件"],
    ["Open Chat with Agent", "打开与智能体的聊天"],
    ["Quick Settings Panel", "快捷设置面板"],
    ["ABFS mount directory", "ABFS 挂载目录"],
    ["Coordinator settings", "协调员设置"],
    ["Advanced Web Access", "高级网页访问"],
    ["Agent security mode", "智能体安全模式"],
    ["App update required", "需要更新应用程序"],
    ["CitC Workspace Type", "CitC 工作区类型"],
    ["Conversation picker", "对话选择器"],
    ["Custom Agent Error:", "自定义智能体错误："],
    ["Delete Conversation", "删除对话"],
    ["Extension (VS Code)", "扩展 (VS Code)"],
    ["Failed to read file", "读取文件失败"],
    ["Follow the guide at", "请按照以下指南"],
    ["Load older messages", "加载更早的消息"],
    ["Loading Antigravity", "正在加载 Antigravity"],
    ["Model quota reached", "模型额度已达上限"],
    ["Modern Web Guidance", "现代 Web 开发指南"],
    ["Network Permissions", "网络权限"],
    ["Next Side Panel Tab", "下一个侧边栏标签页"],
    ["No active terminals", "无活动终端"],
    ["No background tasks", "无后台任务"],
    ["No Models Available", "暂无可用模型"],
    ["Open in Code Search", "在代码搜索中打开"],
    ["Open in Preview Tab", "在预览标签页中打开"],
    ["Open Project Picker", "打开项目选择器"],
    ["Open System Browser", "在系统浏览器中打开"],
    ["Other Conversations", "其他对话"],
    ["Parent Conversation", "父对话"],
    ["Permission Settings", "权限设置"],
    ["Pinned Conversation", "已固定对话"],
    ["Plugins in Featured", "精选插件"],
    ["Remote Control link", "远程控制链接"],
    ["Rename Conversation", "重命名对话"],
    ["Revert file changes", "还原文件更改"],
    ["Search shortcuts...", "搜索快捷键..."],
    ["Use Global Settings", "使用全局设置"],
    ["Write and edit docs", "编写与编辑文档"],
    ["Certificate details", "证书详情"],
    ["No recent downloads", "没有最近的下载"],
    ["Select your license", "选择许可证"],
    ["Enable Sandbox Mode", "启用沙盒模式"],
    ["Filter resources...", "筛选资源..."],
    ["Search Google Drive", "搜索 Google 云端硬盘"],
    ["Currently installed", "当前已安装"],
    ["No skills available", "没有可用技能"],
    ["No project selected", "未选择项目"],
    ["No workspaces open.", "没有打开的工作区。"],
    ["No projects created", "尚未创建项目"],
    ["Loading subagent...", "正在加载子智能体..."],
    ["No events recorded.", "没有事件记录。"],
    ["When should it run?", "应该何时运行？"],
    ["Preview unavailable", "预览不可用"],
    ["Unable to load PDF:", "无法加载 PDF："],
    ["No matching results", "没有匹配的结果"],
    ["GitHub Repositories", "GitHub 仓库"],
    ["Loading licenses...", "正在加载许可证..."],
    ["Upload Debug Bundle", "上传调试包"],
    ["Error while editing", "编辑时出错"],
    ["Error while viewing", "查看时出错"],
    ["Select an option...", "选择一个选项..."],
    ["Code Change Summary", "代码更改摘要"],
    ["Snooze for 24 Hours", "稍后提醒 24 小时"],
    ["Number of responses", "回复数量"],
    ["Reload this window.", "重新加载此窗口。"],
    ["Google One Referral", "Google One 推荐计划"],
    ["Get More AI Credits", "获取更多 AI 积分"],
    ["Copied to clipboard", "已复制到剪贴板"],
    ["Uploading to Drive…", "正在上传到 Google Drive…"],
    ["Connect to Cloudtop", "连接到 Cloudtop"],
    ["Create New Workflow", "创建新工作流"],
    ["Open Issue Reporter", "打开问题报告工具"],
    ["Upload Chain Failed", "上传链失败"],
    ["ABFS workspace name", "ABFS 工作区名称"],
    ["Citc workspace name", "CitC 工作区名称"],
    ["Clicking in Browser", "正在浏览器中点击"],
    ["Typing into Browser", "正在浏览器中输入"],
    ["Dragging in Browser", "正在浏览器中拖动"],
    ["Show 1 earlier step", "显示更早的 1 个步骤"],
    ["Needs your approval", "需要你的批准"],
    ["Forked conversation", "派生的对话"],
    ["Add inline comment", "添加行内批注"],
    ["Add Scheduled Task", "添加定时任务"],
    ["Agent Conversation", "智能体对话"],
    ["Agent Host Address", "智能体主机地址"],
    ["Alphabetical (A-Z)", "按字母顺序 (A-Z)"],
    ["Analyzing Task Log", "正在分析任务日志"],
    ["Any error messages", "任何错误信息"],
    ["Autocomplete Speed", "补全速度"],
    ["Best of N Settings", "Best of N 设置"],
    ["Build new features", "构建全新功能"],
    ["Chrome Binary Path", "Chrome 可执行文件路径"],
    ["Clear search (Esc)", "清除搜索 (Esc)"],
    ["Close Terminal Tab", "关闭终端标签页"],
    ["Conversation Steps", "对话步骤"],
    ["Conversation Width", "对话宽度"],
    ["Copy trajectory ID", "复制轨迹 ID"],
    ["Create New Project", "创建新项目"],
    ["Create with Prompt", "通过提示词创建"],
    ["Creating a Project", "正在创建项目"],
    ["Delete Permanently", "永久删除"],
    ["Expand All Folders", "展开所有文件夹"],
    ["Getting scripts...", "正在获取脚本…"],
    ["GitHub Permissions", "GitHub 权限"],
    ["global permissions", "全局权限"],
    ["Global permissions", "全局权限"],
    ["Global Permissions", "全局权限"],
    ["Go Forward in Pane", "在窗格中前进"],
    ["Group By Workspace", "按工作区分组"],
    ["Insert in terminal", "插入到终端"],
    ["Insert in Terminal", "插入到终端"],
    ["Keyboard shortcuts", "键盘快捷键"],
    ["Keyboard Shortcuts", "键盘快捷键"],
    ["Marketplace notice", "插件市场说明"],
    ["MCP Install Error:", "MCP 安装错误："],
    ["MCP Restart Error:", "MCP 重启错误："],
    ["Mute Voice Speaker", "将语音扬声器静音"],
    ["New Scheduled Task", "新建定时任务"],
    ["Next match (Enter)", "下一个匹配项 (Enter)"],
    ["No answer provided", "未提供回答"],
    ["Open in New Window", "在新窗口中打开"],
    ["Outside of Project", "项目外"],
    ["Permission Details", "权限详情"],
    ["Plan Review Policy", "计划审核策略"],
    ["Previous Worktrees", "以前的工作树"],
    ["Proceed in Sandbox", "在沙盒中继续"],
    ["Project + Worktree", "项目与工作树"],
    ["Screen Reader Mode", "屏幕阅读器模式"],
    ["Search projects...", "搜索项目..."],
    ["Select Environment", "选择环境"],
    ["Sort Conversations", "排序对话"],
    ["Steps to Reproduce", "重现步骤"],
    ["Stop All Subagents", "停止全部子智能体"],
    ["Toggle File Viewer", "切换文件查看器"],
    ["Undo to this point", "撤销到此处"],
    ["Unpin Conversation", "取消固定对话"],
    ["Verbose agent chat", "详细智能体聊天"],
    ["Verbose Agent Chat", "详细智能体聊天"],
    ["Workspace Creation", "工作区创建"],
    ["Workspace Settings", "工作区设置"],
    ["Permanently delete", "永久删除"],
    ["Open in Side Panel", "在侧边面板中打开"],
    ["Copy Image Address", "复制图片地址"],
    ["Terminal Placement", "终端位置"],
    ["Remote Agents Data", "远程智能体数据"],
    ["Account connected.", "账号已连接。"],
    ["Loading plugins...", "正在加载插件..."],
    ["Configured servers", "已配置的服务器"],
    ["New Remote Project", "新建远程项目"],
    ["Capture Screenshot", "截取屏幕"],
    ["Stop Side Question", "停止副问题"],
    ["What should it do?", "它应该做什么？"],
    ["No events recorded", "没有事件记录"],
    ["Execution Identity", "执行身份"],
    ["File Diff Comments", "文件差异评论"],
    ["Write a comment...", "输入评论..."],
    ["Working Directory:", "工作目录："],
    ["Failed to continue", "继续操作失败"],
    ["Rendering playback", "正在渲染回放"],
    ["Playback available", "回放可用"],
    ["Terms and Privacy:", "条款与隐私："],
    ["Customize Sections", "自定义分区"],
    ["Click to view more", "点击查看更多"],
    ["Stream and control", "流式传输与控制"],
    ["Migrate with Agent", "使用智能体迁移"],
    ["Click to Open Docs", "点击打开文档"],
    ["e.g., chromium/src", "例如 chromium/src"],
    ["Enterprise Gateway", "企业网关"],
    ["Open settings menu", "打开设置菜单"],
    ["Copy email address", "复制电子邮件地址"],
    ["Configure Branches", "配置分支"],
    ["Available licenses", "可用许可证"],
    ["Signed-in accounts", "已登录的账号"],
    ["Open Browser Setup", "打开浏览器设置"],
    ["Conversation turns", "对话轮次"],
    ["Next side question", "下一个侧边问题"],
    ["Close skills panel", "关闭技能面板"],
    ["Open Fig Workspace", "打开 Fig 工作区"],
    ["Manage Permissions", "管理权限"],
    ["Searched for files", "已搜索文件"],
    ["Clicked in Browser", "已在浏览器中点击"],
    ["Typed into Browser", "已在浏览器中输入"],
    ["Dragged in Browser", "已在浏览器中拖动"],
    ["Semantic searching", "正在语义搜索"],
    ["Hide earlier steps", "隐藏更早的步骤"],
    ["Idle Guard Warning", "空闲保护提醒"],
    ["No folder selected", "未选择文件夹"],
    ["Added to allowlist", "已添加到允许列表"],
    ["Review permissions", "审查权限"],
    ["Remote Permissions", "远程权限"],
    ["Add to Chat/Quote", "添加到聊天/引用"],
    ["Advanced Settings", "高级设置"],
    ["Analyzed Task Log", "已分析任务日志"],
    ["Archive / Restore", "归档 / 恢复"],
    ["Automatic updates", "自动检查更新"],
    ["Automatic Updates", "自动检查更新"],
    ["Build With Google", "使用 Google 构建"],
    ["Cancel Generation", "取消生成"],
    ["Check for Updates", "检查更新"],
    ["Continue Response", "继续回复"],
    ["Copy Project Name", "复制项目名称"],
    ["Copy sign-in link", "复制登录链接"],
    ["Copy to clipboard", "复制到剪贴板"],
    ["Delete MCP Server", "删除 MCP 服务器"],
    ["Download Location", "下载位置"],
    ["Edit Custom Model", "编辑自定义模型"],
    ["Expected behavior", "预期行为"],
    ["Extension (Cider)", "扩展 (Cider)"],
    ["File Access Rules", "文件访问规则"],
    ["Fork Conversation", "创建分支对话"],
    ["Global Permission", "全局权限"],
    ["Local Permissions", "本地权限"],
    ["Move to New Group", "移至新分组"],
    ["Next Aux Pane Tab", "下一个辅助窗格标签页"],
    ["No agents running", "没有正在运行的代理"],
    ["No Model Selected", "未选择模型"],
    ["No projects found", "未找到项目"],
    ["Open Commit Graph", "打开提交历史图"],
    ["Open Conversation", "打开对话"],
    ["Open in Side Pane", "在侧边窗格中打开"],
    ["Permission preset", "权限预设"],
    ["Permission Preset", "权限预设"],
    ["Previous Pane Tab", "上一个面板标签页"],
    ["Previous question", "上一题"],
    ["Proceed with Plan", "按计划继续"],
    ["Record voice memo", "录制语音备忘"],
    ["Remove from Group", "从分组中移除"],
    ["Remove from Split", "从拆分视图中移除"],
    ["Remove From Split", "从拆分视图中移除"],
    ["Reopen Closed Tab", "重新打开已关闭的标签页"],
    ["Research anything", "研究与调研"],
    ["Select one of the", "选择以下"],
    ["Selection Actions", "选择操作"],
    ["Setup Jetski Chat", "配置 Jetski 聊天"],
    ["Sort Conversation", "排序对话"],
    ["Terminal Commands", "终端命令"],
    ["Toggle Side Panel", "切换侧边栏面板"],
    ["Copy Link Address", "复制链接地址"],
    ["Sign in required.", "需要登录。"],
    ["No sign-in needed", "无需登录"],
    ["Context Providers", "上下文提供程序"],
    ["Search connectors", "搜索连接器"],
    ["Managed by plugin", "由插件管理"],
    ["Conversation name", "对话名称"],
    ["Current workspace", "当前工作区"],
    ["Archive Workspace", "归档工作区"],
    ["No matching files", "没有匹配的文件"],
    ["Loading events...", "正在加载事件..."],
    ["Artifact Comments", "产物评论"],
    ["Browser downloads", "浏览器下载"],
    ["Failed to proceed", "无法继续"],
    ["Loading models...", "正在加载模型..."],
    ["Suggested plugin:", "推荐插件："],
    ["Read URL rejected", "读取 URL 的请求被拒绝"],
    ["No instances yet.", "暂无实例。"],
    ["Click to copy URL", "点击复制 URL"],
    ["Unmount workspace", "卸载工作区"],
    ["Remount workspace", "重新挂载工作区"],
    ["View Stacked Diff", "查看上下排列的差异"],
    ["Search Extensions", "搜索扩展"],
    ["2x playback speed", "2 倍播放速度"],
    ["Google Extensions", "Google 扩展"],
    ["This Conversation", "当前对话"],
    ["Taking Screenshot", "正在截图"],
    ["Semantic searched", "已完成语义搜索"],
    ["Goal Verification", "目标验证"],
    ["Command execution", "命令执行"],
    ["Analyzing content", "正在分析内容"],
    ["Run (unsandboxed)", "运行（不在沙盒中）"],
    ["Add Custom Model", "添加自定义模型"],
    ["Auth and Billing", "身份验证与账单"],
    ["Background Tasks", "后台任务"],
    ["Best of N Models", "Best of N 模型"],
    ["Browser CDP Port", "浏览器 CDP 端口"],
    ["Built-in Browser", "内置浏览器"],
    ["External Browser", "外部浏览器"],
    ["Browsing History", "浏览历史记录"],
    ["Browser Subagent", "浏览器子智能体"],
    ["Cancel All Tasks", "取消全部任务"],
    ["Commit succeeded", "提交成功"],
    ["Create a Project", "创建项目"],
    ["Enable Demo Mode", "启用演示模式"],
    ["Enable Telemetry", "启用遥测"],
    ["Failed to Commit", "提交失败"],
    ["File Permissions", "文件权限"],
    ["General Feedback", "一般反馈"],
    ["Group By Project", "按项目分组"],
    ["in the top left.", "可搜索对话。"],
    ["Installed Skills", "已安装技能"],
    ["Keep In Menu Bar", "保留在菜单栏"],
    ["Mark All as Read", "全部标为已读"],
    ["Marketing Emails", "营销邮件"],
    ["New conversation", "新建对话"],
    ["New Conversation", "新建对话"],
    ["New Terminal Tab", "新建终端标签页"],
    ["No conversations", "暂无对话"],
    ["Open File Search", "打开文件搜索"],
    ["Open Preferences", "打开偏好设置"],
    ["Pin conversation", "固定对话"],
    ["Pin Conversation", "固定对话"],
    ["Project Detected", "检测到项目"],
    ["Project Settings", "项目设置"],
    ["Provide Feedback", "提供反馈"],
    ["Purchase Credits", "购买积分"],
    ["Replace With New", "替换为新对话"],
    ["Scroll to bottom", "滚动到底部"],
    ["Scroll to Bottom", "滚动到底部"],
    ["Search shortcuts", "搜索快捷键"],
    ["Send Immediately", "立即发送"],
    ["Sign-in required", "需要登录"],
    ["Start Voice mode", "启动语音模式"],
    ["Terms of Service", "服务条款"],
    ["to be installed.", "已安装。"],
    ["Toggle file diff", "切换文件差异视图"],
    ["Tool permissions", "工具权限"],
    ["Tool Permissions", "工具权限"],
    ["Update Available", "有可用更新"],
    ["Vetted (Preview)", "安全审核（预览）"],
    ["Interface Layout", "界面布局"],
    ["Remove from list", "从列表中移除"],
    ["Reset to Default", "恢复默认值"],
    ["Sign in required", "需要登录"],
    ["Loading hooks...", "正在加载钩子..."],
    ["See more results", "查看更多结果"],
    ["Select workspace", "选择工作区"],
    ["Nothing said yet", "还没有内容"],
    ["Conversation Log", "对话日志"],
    ["Screen Recording", "屏幕录制"],
    ["No instructions.", "没有指令。"],
    ["Admin escalation", "管理员提权"],
    ["Loading media...", "正在加载媒体..."],
    ["Close Other Tabs", "关闭其他标签页"],
    ["Document Answers", "文档答案"],
    ["New Agent Script", "新建智能体脚本"],
    ["Unknown Notebook", "未知笔记本"],
    ["Default (Mendel)", "默认（Mendel）"],
    ["Project Required", "需要项目"],
    ["License Required", "需要许可证"],
    ["Delete workspace", "删除工作区"],
    ["Go to Definition", "转到定义"],
    ["Copy description", "复制描述"],
    ["Copy schema JSON", "复制架构 JSON"],
    ["Confirm dismiss?", "确认关闭？"],
    ["Close Logs Modal", "关闭日志窗口"],
    ["Cancel recording", "取消录制"],
    ["Match whole word", "全字匹配"],
    ["Clone Repository", "克隆仓库"],
    ["Generate Project", "生成项目"],
    ["Reset Onboarding", "重置入门设置"],
    ["New CLs Uploaded", "已上传多个新的更改列表"],
    ["ABFS branch name", "ABFS 分支名称"],
    ["Open Swarm Board", "打开 Swarm 消息板"],
    ["Invoked subagent", "已调用子智能体"],
    ["Analyzed content", "已分析内容"],
    ["Open Source Code", "打开源代码"],
    ["Video attachment", "视频附件"],
    ["Image attachment", "图片附件"],
    ["Creating Fork...", "正在派生..."],
    ["Add to allowlist", "添加到允许列表"],
    ["No upcoming run.", "没有即将执行的任务。"],
    [", or copy link.", "，或复制链接。"],
    ["1 agent running", "1 个代理正在运行"],
    ["Actual behavior", "实际行为"],
    ["Actuation Rules", "操作规则"],
    ["Add MCP Servers", "添加 MCP 服务器"],
    ["Allowed Domains", "允许的域名"],
    ["Amend succeeded", "修改提交成功"],
    ["and select plan", "并选择 plan"],
    ["Archive project", "归档项目"],
    ["Autonomous Mode", "自主模式"],
    ["Background Task", "后台任务"],
    ["Code with Agent", "与智能体协作编码"],
    ["Command Palette", "命令面板"],
    ["Copy debug info", "复制调试信息"],
    ["Delete Terminal", "删除终端"],
    ["Developer Tools", "开发工具"],
    ["Display Options", "显示选项"],
    ["Editor Settings", "编辑器设置"],
    ["Failed to Amend", "修改提交失败"],
    ["Faster response", "响应速度更快"],
    ["Feature Request", "功能请求"],
    ["Five Hour Limit", "5 小时限额"],
    ["Fold code block", "折叠代码块"],
    ["For help, visit", "如需帮助，请访问"],
    ["GitHub Policies", "GitHub 策略"],
    ["global settings", "全局设置"],
    ["Go Back in Pane", "在窗格中后退"],
    ["Import success:", "导入成功："],
    ["Layout Controls", "布局控制"],
    ["Message history", "消息历史"],
    ["Missing Folders", "缺失文件夹"],
    ["No file changes", "无文件更改"],
    ["Open MCP Config", "打开 MCP 配置"],
    ["Package Outline", "包大纲"],
    ["Project deleted", "项目已删除"],
    ["Project Folders", "项目文件夹"],
    ["Project General", "项目常规"],
    ["Project options", "项目选项"],
    ["Queued Messages", "排队消息"],
    ["Quote Selection", "引用选中内容"],
    ["Remove Shortcut", "移除快捷键"],
    ["Scheduled Tasks", "定时任务"],
    ["Search files...", "搜索文件..."],
    ["Search Projects", "搜索项目"],
    ["Search tasks...", "搜索任务..."],
    ["Security Preset", "安全预设"],
    ["Thought Process", "思考过程"],
    ["to be installed", "已安装"],
    ["Toggle Terminal", "切换终端"],
    ["Tool Permission", "工具权限"],
    ["Open in New Tab", "在新标签页中打开"],
    ["Cancel download", "取消下载"],
    ["Paste auth code", "粘贴授权码"],
    ["Sign-in failed:", "登录失败："],
    ["Restart sign-in", "重新开始登录"],
    ["Action required", "需要操作"],
    ["Remove resource", "移除资源"],
    ["Unauthenticated", "未完成身份验证"],
    ["Loading apps...", "正在加载应用..."],
    ["Remote Projects", "远程项目"],
    ["Conversation ID", "对话 ID"],
    ["Select Worktree", "选择工作树"],
    ["Filter files...", "筛选文件..."],
    ["Find References", "查找引用"],
    ["Empty directory", "空目录"],
    ["Needs attention", "需要关注"],
    ["Change schedule", "更改计划"],
    ["Loading logs...", "正在加载日志..."],
    ["Browser actions", "浏览器操作"],
    ["Show in Sidebar", "在侧边栏中显示"],
    ["Remote branches", "远程分支"],
    ["Section header:", "章节标题："],
    ["Session Summary", "会话摘要"],
    ["Needs reconnect", "需要重新连接"],
    ["Match Case (Aa)", "区分大小写 (Aa)"],
    ["Start it again.", "重新启动它。"],
    ["Search branches", "搜索分支"],
    ["Text attachment", "文本附件"],
    ["List resources:", "列出资源："],
    ["Enable Overages", "启用超额用量"],
    ["Invite a Friend", "邀请好友"],
    ["Open in Preview", "在预览中打开"],
    ["Export Artifact", "导出产物"],
    ["View Split Diff", "查看并排的差异"],
    ["About embedding", "关于嵌入"],
    ["Plugin metadata", "插件元数据"],
    ["Edit task title", "编辑任务标题"],
    ["Remind me later", "稍后提醒我"],
    ["Create New Rule", "创建新规则"],
    ["New CL Uploaded", "已上传新的更改列表"],
    ["Took Screenshot", "已截图"],
    ["Generated media", "生成的媒体"],
    [", or copy link", "，或复制链接"],
    ["Add automation", "添加自动化"],
    ["Add MCP Server", "添加 MCP 服务器"],
    ["Added (Staged)", "已添加（已暂存）"],
    ["Agent Behavior", "智能体行为"],
    ["Agent response", "智能体回复"],
    ["Always Proceed", "始终继续"],
    ["Auto (Preview)", "自动（预览）"],
    ["Auto Execution", "自动执行"],
    ["Branch Changes", "分支更改"],
    ["Chief of Staff", "统筹助手"],
    ["Copy File Name", "复制文件名"],
    ["Copy File Path", "复制文件路径"],
    ["Create Project", "创建项目"],
    ["Customizations", "自定义"],
    ["Delete comment", "删除评论"],
    ["Delete Handler", "删除处理程序"],
    ["Delete Project", "删除项目"],
    ["Download files", "下载文件"],
    ["Failed to Push", "推送失败"],
    ["Go to Projects", "前往项目"],
    ["Import failed:", "导入失败："],
    ["Inherit Global", "继承全局设置"],
    ["Inline Actions", "内联操作"],
    ["inline comment", "行内批注"],
    ["Input required", "需要输入"],
    ["Local Checkout", "本地检出"],
    ["Mark as Unread", "标记为未读"],
    ["Merge Conflict", "合并冲突"],
    ["Missing Folder", "缺失文件夹"],
    ["Models & Usage", "模型与用量"],
    ["Modified Files", "已修改的文件"],
    ["Mute Voice Mic", "将语音麦克风静音"],
    ["No MCP Servers", "没有 MCP 服务器"],
    ["Not in Project", "未在项目中"],
    ["Open Launchpad", "打开启动台"],
    ["Open window...", "打开窗口..."],
    ["Open Workspace", "打开工作区"],
    ["Opened browser", "已打开浏览器"],
    ["Proceeded with", "已执行"],
    ["Project picker", "项目选择器"],
    ["Push succeeded", "推送成功"],
    ["Refresh skills", "刷新技能"],
    ["Remote Control", "远程控制"],
    ["Request Review", "请求审核"],
    ["Require Review", "需要审核"],
    ["Reset zoom (0)", "重置缩放 (0)"],
    ["Review Changes", "审核更改"],
    ["Select Project", "选择项目"],
    ["Setup required", "需要配置"],
    ["Show in folder", "在文件夹中显示"],
    ["Skills & Rules", "技能与规则"],
    ["Split Terminal", "拆分终端"],
    ["Staged Changes", "已暂存的更改"],
    ["Stop execution", "停止执行"],
    ["System default", "系统默认"],
    ["Toggle Sidebar", "切换侧边栏"],
    ["Typeahead menu", "自动补全菜单"],
    ["Unstage change", "取消暂存更改"],
    ["View Changelog", "查看更新日志"],
    ["Back to safety", "返回安全页面"],
    ["Previous match", "上一个匹配项"],
    ["Not configured", "未配置"],
    ["Go to Accounts", "前往账号"],
    ["All Workspaces", "所有工作区"],
    ["Filter rows...", "筛选行..."],
    ["File not found", "未找到文件"],
    ["Side Questions", "副问题"],
    ["Subagent ended", "子智能体已结束"],
    ["Stop Recording", "停止录制"],
    ["Task not found", "未找到任务"],
    ["Submit comment", "提交评论"],
    ["Tool arguments", "工具参数"],
    ["Open allowlist", "打开允许列表"],
    ["Connect GitHub", "连接 GitHub"],
    ["Issue creation", "创建问题"],
    ["Select License", "选择许可证"],
    ["Invalid embed:", "无效的嵌入内容："],
    ["Error Details:", "错误详情："],
    ["Trajectory ID:", "执行轨迹 ID："],
    ["Sign in needed", "需要登录"],
    ["Close (Escape)", "关闭 (Escape)"],
    ["Proceed Anyway", "仍然继续"],
    ["Create a token", "创建令牌"],
    ["Read resource:", "读取资源："],
    ["Files to edit:", "要编辑的文件："],
    ["Run visibility", "运行记录可见性"],
    ["Knowledge Work", "知识工作"],
    ["Manage License", "管理许可证"],
    ["Signing Out...", "正在退出登录..."],
    ["Command Center", "命令中心"],
    ["Collapse Diffs", "折叠差异"],
    ["Close Settings", "关闭设置"],
    ["Delete command", "删除命令"],
    ["Plugin details", "插件详情"],
    ["Model URL info", "模型 URL 信息"],
    ["Context window", "上下文窗口"],
    ["Search results", "搜索结果"],
    ["GoB Repository", "GoB 仓库"],
    ["Workspace Name", "工作区名称"],
    ["Confirm & Save", "确认并保存"],
    ["Site Allowlist", "网站允许列表"],
    ["Access grants", "访问授权"],
    ["Agent Decides", "由智能体决定"],
    ["Agent options", "智能体选项"],
    ["All tools (*)", "所有工具 (*)"],
    ["Allow options", "允许选项"],
    ["Archived Only", "仅显示已归档"],
    ["Back to Agent", "返回智能体"],
    ["Chat Settings", "聊天设置"],
    ["CitC Settings", "CitC 设置"],
    ["Context Menus", "上下文菜单"],
    ["Conversations", "对话"],
    ["Custom Agents", "自定义智能体"],
    ["Customization", "自定义项"],
    ["Debug and fix", "调试与修复"],
    ["Default Light", "默认浅色"],
    ["Delete plugin", "删除插件"],
    ["Edit Shortcut", "编辑快捷键"],
    ["Enter to Send", "按 Enter 发送"],
    ["Every weekday", "每个工作日"],
    ["Feedback Type", "反馈类型"],
    ["File explorer", "文件浏览器"],
    ["Files Changed", "已更改的文件"],
    ["Gemini Models", "Gemini 模型"],
    ["Give Feedback", "提供反馈"],
    ["Good response", "好评"],
    ["Inherits from", "继承自"],
    ["Inline Widget", "内联组件"],
    ["Invalid Media", "无效的媒体文件"],
    ["Link Settings", "链接设置"],
    ["Manage Skills", "管理技能"],
    ["Maximize Pane", "最大化窗格"],
    ["Message input", "消息输入框"],
    ["Model Credits", "模型积分"],
    ["Move to Group", "移至分组"],
    ["New Workspace", "新建工作区"],
    ["Next Pane Tab", "下一个面板标签页"],
    ["Next question", "下一题"],
    ["Notifications", "通知"],
    ["Open in Cider", "在 Cider 中打开"],
    ["Open Links In", "打开链接的方式"],
    ["Open Settings", "打开设置"],
    ["Open Terminal", "打开终端"],
    ["Page contents", "页面内容"],
    ["Prevent Sleep", "阻止计算机睡眠"],
    ["Project Agent", "项目智能体"],
    ["Reload Window", "重新加载窗口"],
    ["Review Policy", "审核策略"],
    ["Select branch", "选择分支"],
    ["Send Feedback", "发送反馈"],
    ["Stop Subagent", "停止子智能体"],
    ["Tab to Import", "按下 Tab 导入"],
    ["Table options", "表格选项"],
    ["This Computer", "此电脑"],
    ["Toggle Editor", "切换编辑器"],
    ["UI Extensions", "界面扩展"],
    ["Previous Page", "上一页"],
    ["Accessibility", "无障碍"],
    ["United States", "美国"],
    ["Pay As You Go", "按量付费"],
    ["Not Signed In", "未登录"],
    ["Sign in again", "重新登录"],
    ["Needs re-auth", "需要重新验证"],
    ["Not connected", "未连接"],
    ["Add Hook Card", "添加钩子卡片"],
    ["New hook name", "新钩子名称"],
    ["Active Skills", "已启用的技能"],
    ["Runs remotely", "远程运行"],
    ["Download File", "下载文件"],
    ["Side Question", "副问题"],
    ["Not scheduled", "未安排"],
    ["On a schedule", "按计划"],
    ["Recent Events", "最近事件"],
    ["Export as PDF", "导出为 PDF"],
    ["File Comments", "文件评论"],
    ["Kill Terminal", "终止终端"],
    ["Render failed", "渲染失败"],
    ["Unknown error", "未知错误"],
    ["Pull Requests", "拉取请求"],
    ["Workflow runs", "工作流运行"],
    ["Choose Region", "选择区域"],
    ["Other License", "其他许可证"],
    ["Still running", "仍在运行"],
    ["Press keys...", "请按下快捷键..."],
    ["Not available", "不可用"],
    ["Image Answers", "图片答案"],
    ["Cleared Count", "已清除数量"],
    ["Only Archived", "仅已归档"],
    ["Context usage", "上下文使用量"],
    ["CEL Reference", "CEL 参考"],
    ["Organizations", "组织"],
    ["Target Tools:", "目标工具："],
    ["Host Endpoint", "主机端点"],
    ["documentation", "文档"],
    ["Dismiss error", "关闭错误提示"],
    ["Copy thinking", "复制思考内容"],
    ["Billing model", "计费模式"],
    ["Create plugin", "创建插件"],
    ["Sidecar error", "Sidecar 错误"],
    ["Media actions", "媒体操作"],
    ["View comments", "查看评论"],
    ["Close Sidebar", "关闭侧边栏"],
    ["Refresh rules", "刷新规则"],
    ["New Fig Share", "新建 Fig 共享"],
    ["Browser steps", "浏览器步骤"],
    ["Using browser", "正在使用浏览器"],
    ["Used MCP tool", "已使用 MCP 工具"],
    ["Add Shortcut", "添加快捷键"],
    ["AI Shortcuts", "AI 快捷方式"],
    ["Always Allow", "始终允许"],
    ["App Settings", "应用设置"],
    ["Bad response", "差评"],
    ["Browser Task", "浏览器任务"],
    ["Chime volume", "提示音音量"],
    ["Close Folder", "关闭文件夹"],
    ["Confirm Quit", "确认退出"],
    ["Confirm Undo", "确认撤销"],
    ["Conversation", "对话"],
    ["Copy Command", "复制命令"],
    ["Copy Content", "复制内容"],
    ["Custom Order", "自定义顺序"],
    ["Default Dark", "默认深色"],
    ["Delete Skill", "删除技能"],
    ["Disable Task", "禁用任务"],
    ["Edit comment", "编辑评论"],
    ["Execute URLs", "允许操作的网址"],
    ["Find in Pane", "在面板中查找"],
    ["Full machine", "整机访问模式"],
    ["Full Machine", "整机访问模式"],
    ["Instructions", "指令"],
    ["Last Updated", "最近更新"],
    ["Manage Hooks", "管理钩子"],
    ["Mark as Read", "标记为已读"],
    ["More actions", "更多操作"],
    ["More options", "更多选项"],
    ["More Plugins", "更多插件"],
    ["Multi-select", "多选"],
    ["New Worktree", "新建工作树"],
    ["No subagents", "无子智能体"],
    ["Open Preview", "打开预览"],
    ["or copy link", "或复制链接"],
    ["Overview tab", "概览标签页"],
    ["Recent Files", "最近文件"],
    ["Record Audio", "录制音频"],
    ["Rename Group", "重命名分组"],
    ["Restart Task", "重启任务"],
    ["Select Model", "选择模型"],
    ["Send message", "发送消息"],
    ["Show details", "显示详情"],
    ["Stage change", "暂存更改"],
    ["Terminal tab", "终端标签页"],
    ["Toggle Agent", "切换智能体"],
    ["Undo To Here", "撤销到此处"],
    ["User message", "用户消息"],
    ["Voice volume", "语音音量"],
    ["Weekly Limit", "周额度"],
    ["Zoom out (-)", "缩小 (-)"],
    ["Clear Search", "清除搜索"],
    ["Download PDF", "下载 PDF"],
    ["Subscription", "订阅"],
    ["Stop Editing", "停止编辑"],
    ["Authenticate", "身份验证"],
    ["Upload Files", "上传文件"],
    ["Browse rules", "浏览规则"],
    ["Replace with", "替换为"],
    ["Project Name", "项目名称"],
    ["Copy Message", "复制消息"],
    ["Mention Page", "提及页面"],
    ["Switch Roles", "切换角色"],
    ["Change model", "更改模型"],
    ["Repeat every", "重复间隔"],
    ["No documents", "没有文档"],
    ["New Terminal", "新建终端"],
    ["Add Terminal", "添加终端"],
    ["Denied Sites", "已拒绝的网站"],
    ["Path copied!", "路径已复制！"],
    ["Drag to move", "拖动以移动"],
    ["Access rules", "访问规则"],
    ["Accounts tab", "账号标签页"],
    ["Sent Message", "已发送消息"],
    ["Use Existing", "使用现有项"],
    ["Repositories", "代码仓库"],
    ["Fork warning", "派生警告"],
    ["Bottom Panel", "底部面板"],
    ["Voice engine", "语音引擎"],
    ["Tab Settings", "标签页设置"],
    ["See Activity", "查看活动记录"],
    ["Collapse All", "全部折叠"],
    ["Expand Diffs", "展开差异"],
    ["Viewing Diff", "正在查看差异"],
    ["Fuzzy search", "模糊搜索"],
    ["Search flags", "搜索标志"],
    ["Remove audio", "移除音频"],
    ["Back to home", "返回首页"],
    ["Select Agent", "选择智能体"],
    ["Clear filter", "清除筛选条件"],
    ["Show More...", "显示更多..."],
    ["Yes, install", "是，安装"],
    ["Report Issue", "报告问题"],
    ["Branch / Ref", "分支 / 引用"],
    ["Limited time", "限时提供"],
    ["Searched web", "已搜索网页"],
    ["Accept Step", "接受此步骤"],
    ["Add context", "添加上下文"],
    ["Add Handler", "添加处理程序"],
    ["Add to Chat", "添加到对话"],
    ["Agent Edits", "智能体编辑"],
    ["App version", "应用版本"],
    ["Application", "应用"],
    ["Automations", "自动化"],
    ["breadcrumbs", "路径导航"],
    ["Cancel step", "取消此步骤"],
    ["Cancel Task", "取消任务"],
    ["Chat Layout", "聊天布局"],
    ["Code Search", "代码搜索"],
    ["Copy prompt", "复制提示词"],
    ["Custom View", "自定义视图"],
    ["Danger Zone", "危险操作"],
    ["Decorations", "标记"],
    ["Delete Hook", "删除钩子"],
    ["Delete Task", "删除任务"],
    ["Description", "描述"],
    ["Device Name", "设备名称"],
    ["Enable Task", "启用任务"],
    ["Environment", "环境"],
    ["File Access", "文件访问"],
    ["File Picker", "文件选择器"],
    ["File Viewer", "文件查看器"],
    ["File Writes", "文件写入"],
    ["Focus Input", "聚焦输入框"],
    ["Full access", "完整访问权限"],
    ["Get Started", "开始使用"],
    ["In Progress", "进行中"],
    ["Jetski Chat", "Jetski 聊天"],
    ["Last 7 days", "最近 7 天"],
    ["Last Prompt", "上次提示词"],
    ["Light Theme", "浅色主题"],
    ["Marketplace", "插件市场"],
    ["MCP Servers", "MCP 服务器"],
    ["Model Quota", "模型额度"],
    ["Modified in", "已在"],
    ["New Project", "新建项目"],
    ["No Subtitle", "无副标题"],
    ["Only Unread", "仅显示未读"],
    ["Open Folder", "打开文件夹"],
    ["or join the", "或加入"],
    ["Permissions", "权限"],
    ["Quick Start", "快速开始"],
    ["Recommended", "推荐"],
    ["Reject Step", "拒绝此步骤"],
    ["Setting up…", "正在配置…"],
    ["Split Right", "向右拆分"],
    ["Strict Mode", "严格模式"],
    ["Suggestions", "建议"],
    ["Tab to Jump", "按下 Tab 跳转"],
    ["Thinking...", "思考中..."],
    ["Token Usage", "Token 使用量"],
    ["Unavailable", "不可用"],
    ["Write Files", "写入文件"],
    ["Zoom in (+)", "放大 (+)"],
    ["Open in Tab", "在标签页中打开"],
    ["Close (Esc)", "关闭 (Esc)"],
    ["Web Preview", "网页预览"],
    ["Valid until", "有效期至"],
    ["Open Search", "打开搜索"],
    ["Connections", "连接"],
    ["Log back in", "重新登录"],
    ["Empty table", "空表"],
    ["Voice speed", "语速"],
    ["Open in Hub", "在主窗口中打开"],
    ["No runs yet", "尚无运行记录"],
    ["Tool Output", "工具输出"],
    ["Close Panel", "关闭面板"],
    ["Read access", "读取权限"],
    ["Uncommitted", "未提交"],
    ["Project ID:", "项目 ID："],
    ["Get API key", "获取 API 密钥"],
    ["Page title:", "页面标题："],
    ["User Intent", "用户意图"],
    ["Remote only", "仅远程"],
    ["Definition:", "定义："],
    ["Copy output", "复制输出"],
    ["Address bar", "地址栏"],
    ["Dismiss Tip", "关闭提示"],
    ["Start voice", "开始语音"],
    ["No branches", "没有分支"],
    ["No shortcut", "无快捷键"],
    ["Browser Use", "浏览器操作"],
    ["+ Add Hook", "+ 添加钩子"],
    ["Add Folder", "添加文件夹"],
    ["Allow once", "允许一次"],
    ["Always Ask", "始终询问"],
    ["and select", "并选择"],
    ["Appearance", "外观"],
    ["Automation", "自动化"],
    ["Avatar URL", "头像 URL"],
    ["Background", "背景色"],
    ["Bug Report", "错误报告"],
    ["chat space", "聊天群组"],
    ["CitC Clone", "CitC 克隆"],
    ["Compacting", "正在压缩上下文"],
    ["Copy Image", "复制图片"],
    ["Copy value", "复制值"],
    ["Dark Theme", "深色主题"],
    ["Date Added", "添加日期"],
    ["Deprecated", "已弃用"],
    ["Edit Model", "编辑模型"],
    ["Voice mode", "语音模式"],
    ["Microphone", "麦克风"],
    ["Loading...", "正在加载..."],
    ["Yes, allow", "是，允许"],
    ["UI Actions", "界面操作"],
    ["Models Tab", "模型标签页"],
    ["Setting up", "正在配置"],
    ["View Usage", "查看用量"],
    ["View plans", "查看套餐"],
    ["Legal Help", "法律帮助"],
    ["Select All", "全选"],
    ["New Window", "新建窗口"],
    ["Split Down", "向下拆分"],
    ["Review tab", "审核标签页"],
    ["Permission", "权限"],
    ["File Reads", "文件读取"],
    ["Foreground", "前景色"],
    ["Go Forward", "前进"],
    ["Learn more", "了解更多"],
    ["Navigation", "导航"],
    ["No Project", "无项目"],
    ["Quick Open", "快速打开"],
    ["Read Files", "读取文件"],
    ["Reset Zoom", "重置缩放"],
    ["Tab Import", "按下 Tab 导入"],
    ["Turbo mode", "无限模式"],
    ["View Debug", "查看调试信息"],
    ["Working...", "正在工作..."],
    ["Workspaces", "工作区"],
    ["Your Plan:", "您的套餐："],
    ["Every hour", "每小时"],
    ["Every week", "每周"],
    ["Full Error", "完整错误信息"],
    ["Thumbnails", "缩略图"],
    ["Next match", "下一个匹配项"],
    ["Chat Input", "聊天输入"],
    ["Recordings", "录音"],
    ["Disconnect", "断开连接"],
    ["Repository", "代码仓库"],
    ["Connectors", "连接器"],
    ["Group name", "分组名称"],
    ["Send reply", "发送回复"],
    ["Switch mic", "切换麦克风"],
    ["No uploads", "没有上传内容"],
    ["No results", "没有结果"],
    ["Image URL:", "图片 URL："],
    ["Local only", "仅本地"],
    ["WIF Config", "WIF 配置"],
    ["Create New", "新建"],
    ["Conditions", "条件"],
    ["To update:", "更新方法："],
    ["Side Panel", "侧边面板"],
    ["Settings -", "设置 -"],
    ["Expand All", "全部展开"],
    ["Go to Test", "转到测试"],
    ["First page", "第一页"],
    ["Reload app", "重新加载应用"],
    ["Match case", "区分大小写"],
    ["Extensions", "扩展"],
    ["Actuation", "操作"],
    ["Add Model", "添加模型"],
    ["Artifacts", "产物列表"],
    ["Automatic", "自动"],
    ["Close Tab", "关闭标签页"],
    ["Completed", "已完成"],
    ["Configure", "配置"],
    ["copy link", "复制链接"],
    ["Copy path", "复制路径"],
    ["Customize", "自定义"],
    ["Developer", "开发者"],
    ["Every day", "每天"],
    ["Execution", "执行"],
    ["Full Logs", "完整日志"],
    ["How often", "重复频率"],
    ["Installed", "已安装"],
    ["Knowledge", "知识库"],
    ["Launchpad", "启动台"],
    ["MCP Tools", "MCP 工具"],
    ["New Group", "新建分组"],
    ["Read URLs", "读取 URL"],
    ["regrouped", "重新分组"],
    ["Remaining", "剩余"],
    ["Sandboxed", "沙盒化"],
    ["Scheduled", "定时运行"],
    ["Searching", "正在搜索"],
    ["See Plans", "查看套餐"],
    ["Selection", "选择"],
    ["Shortcuts", "快捷键"],
    ["Subagents", "子智能体"],
    ["Subtitles", "副标题"],
    ["Tab Speed", "Tab 补全速度"],
    ["Terminals", "终端"],
    ["Try Again", "重试"],
    ["View Diff", "查看差异"],
    ["View Logs", "查看日志"],
    ["Workflows", "工作流"],
    ["Workspace", "工作区"],
    ["Downloads", "下载列表"],
    ["Not Found", "未找到"],
    ["Issued to", "颁发给"],
    ["Issued by", "颁发者"],
    ["Next Page", "下一页"],
    ["Connected", "已连接"],
    ["Untracked", "未跟踪"],
    ["Open File", "打开文件"],
    ["Task Logs", "任务日志"],
    ["Triggered", "已触发"],
    ["Empty log", "空日志"],
    ["Documents", "文档"],
    ["Open Diff", "打开差异"],
    ["Keep Open", "保持打开"],
    ["Full View", "完整视图"],
    ["Open link", "打开链接"],
    ["Location:", "位置："],
    ["Used for:", "用于："],
    ["Alt text:", "替代文本："],
    ["Error ID:", "错误 ID："],
    ["Agent ID:", "智能体 ID："],
    ["Step Type", "步骤类型"],
    ["Last Used", "上次使用"],
    ["Valid CEL", "有效的 CEL"],
    ["View Page", "查看页面"],
    ["Your Plan", "你的套餐"],
    ["Resources", "资源"],
    ["Show Less", "收起"],
    ["Last page", "最后一页"],
    ["End voice", "结束语音"],
    ["More info", "更多信息"],
    ["Changelog", "更新日志"],
    ["Stop Task", "停止任务"],
    ["[MODIFY]", "[修改]"],
    ["Advanced", "高级"],
    ["Archived", "已归档"],
    ["Bot Name", "机器人名称"],
    ["Built In", "内置"],
    ["Business", "商务"],
    ["Commands", "命令"],
    ["Comments", "评论"],
    ["Continue", "继续"],
    ["Contrast", "对比度"],
    ["Disabled", "已禁用"],
    ["Download", "下载"],
    ["Explored", "已探索"],
    ["Featured", "精选"],
    ["Feedback", "反馈"],
    ["Group By", "分组方式"],
    ["Maximize", "最大化"],
    ["Mentions", "提及"],
    ["Minimize", "最小化"],
    ["Modified", "已修改"],
    ["Nickname", "昵称"],
    ["Open App", "打开应用"],
    ["Open IDE", "打开 IDE"],
    ["Open URL", "打开 URL"],
    ["Overview", "概览"],
    ["Planning", "规划"],
    ["Previous", "上一步"],
    ["Projects", "项目"],
    ["Searched", "已搜索"],
    ["searches", "搜索"],
    ["See less", "收起"],
    ["See more", "查看更多"],
    ["Settings", "设置"],
    ["Show all", "显示全部"],
    ["Sign Out", "退出登录"],
    ["Starting", "正在启动"],
    ["Terminal", "终端"],
    ["Thinking", "思考中"],
    ["tokens (", "Token ("],
    ["Untitled", "未命名"],
    ["Validate", "验证"],
    ["Worktree", "工作树"],
    ["Zoom Out", "缩小"],
    ["Security", "安全"],
    ["Fit Mode", "适应模式"],
    ["Accounts", "账号"],
    ["Send Now", "立即发送"],
    ["Schedule", "计划"],
    ["Next run", "下次运行"],
    ["Last run", "上次运行"],
    ["All runs", "所有运行记录"],
    ["Artifact", "产物"],
    ["License:", "许可证："],
    ["Protocol", "协议"],
    ["Excluded", "已排除"],
    ["Timeout:", "超时："],
    ["Command:", "命令："],
    ["Matcher:", "匹配条件："],
    ["Domains:", "域名："],
    ["Details:", "详情："],
    ["Payload:", "数据："],
    ["Auto Pin", "自动固定"],
    ["No links", "没有链接"],
    ["Optional", "可选"],
    ["Voice on", "语音已开启"],
    ["Read URL", "已读取 URL"],
    ["Account", "账户"],
    ["Actions", "操作"],
    ["Add MCP", "添加 MCP"],
    ["Archive", "归档"],
    ["Blocked", "已阻止"],
    ["Browser", "浏览器"],
    ["Change…", "更改…"],
    ["Confirm", "确认"],
    ["Connect", "连接"],
    ["Context", "上下文"],
    ["Decline", "拒绝"],
    ["Default", "默认"],
    ["Deleted", "已删除"],
    ["Discard", "放弃"],
    ["Dismiss", "忽略"],
    ["Display", "显示"],
    ["Enabled", "已启用"],
    ["Folders", "文件夹"],
    ["General", "常规"],
    ["Go Back", "后退"],
    ["History", "历史"],
    ["Install", "安装"],
    ["Loading", "正在加载"],
    ["New Tab", "新建标签页"],
    ["Not set", "未设置"],
    ["Pending", "等待中"],
    ["Plugin:", "插件："],
    ["Plugins", "插件"],
    ["Preview", "预览"],
    ["Proceed", "继续"],
    ["Profile", "配置文件"],
    ["Project", "项目"],
    ["Refresh", "刷新"],
    ["Release", "松开"],
    ["Renamed", "已重命名"],
    ["Restore", "恢复"],
    ["Running", "运行中"],
    ["Sidebar", "侧边栏"],
    ["Skipped", "已跳过"],
    ["Sort By", "排序方式"],
    ["Sources", "来源"],
    ["Stopped", "已停止"],
    ["Trigger", "触发条件"],
    ["Updater", "更新程序"],
    ["Upgrade", "升级"],
    ["Verbose", "详细"],
    ["Version", "版本"],
    ["Working", "正在工作"],
    ["Zoom In", "放大"],
    ["Forward", "前进"],
    ["Members", "成员"],
    ["Options", "选项"],
    ["Website", "网站"],
    ["Bundles", "插件包"],
    ["Runs as", "运行身份"],
    ["Uploads", "上传内容"],
    ["Scopes:", "权限范围："],
    ["Add All", "全部添加"],
    ["Offline", "离线"],
    ["Helpers", "辅助函数"],
    ["Machine", "计算机"],
    ["Details", "详情"],
    ["Sign In", "登录"],
    ["Changes", "更改"],
    ["Suggest", "建议"],
    ["Run Now", "立即运行"],
    ["Accent", "强调色"],
    ["Accept", "接受"],
    ["Agents", "智能体"],
    ["Cancel", "取消"],
    ["Change", "更改"],
    ["Commit", "提交"],
    ["Copied", "已复制"],
    ["Create", "创建"],
    ["Custom", "自定义"],
    ["Delete", "删除"],
    ["Edited", "已编辑"],
    ["Editor", "编辑器"],
    ["Errors", "错误"],
    ["Export", "导出"],
    ["Filter", "筛选"],
    ["Folder", "文件夹"],
    ["Global", "全局"],
    ["Inline", "内联"],
    ["Log in", "登录"],
    ["Manage", "管理"],
    ["Medium", "中"],
    ["Models", "模型"],
    ["Narrow", "窄"],
    ["Notice", "提示"],
    ["Output", "输出"],
    ["Picker", "选择器"],
    ["Pinned", "已固定"],
    ["Preset", "预设"],
    ["Prompt", "提示词"],
    ["Recent", "最近使用"],
    ["Reject", "拒绝"],
    ["Reload", "重新加载"],
    ["Remote", "远程"],
    ["Remove", "移除"],
    ["Rename", "重命名"],
    ["Review", "审核"],
    ["Search", "搜索"],
    ["Skills", "技能"],
    ["Snooze", "稍后提醒"],
    ["Source", "来源"],
    ["Status", "状态"],
    ["Strict", "严格"],
    ["Strong", "严格"],
    ["Submit", "提交"],
    ["System", "系统"],
    ["Value:", "当前值："],
    ["Viewer", "查看器"],
    ["Volume", "音量"],
    ["Window", "窗口"],
    ["Branch", "分支"],
    ["Author", "作者"],
    ["Europe", "欧洲"],
    ["Themes", "主题"],
    ["Hourly", "每小时"],
    ["Weekly", "每周"],
    ["Events", "事件"],
    ["Title:", "标题："],
    ["Issues", "问题"],
    ["Got it", "知道了"],
    ["Online", "在线"],
    ["Uptime", "运行时长"],
    ["Set up", "设置"],
    ["Fields", "字段"],
    ["Target", "目标"],
    ["Saved!", "已保存！"],
    ["After", "分组后"],
    ["Agent", "智能体"],
    ["Allow", "允许"],
    ["Amend", "修改提交"],
    ["Apply", "应用"],
    ["Block", "阻止"],
    ["Clear", "清除"],
    ["Close", "关闭"],
    ["Email", "邮箱"],
    ["Error", "错误"],
    ["files", "文件"],
    ["Go to", "转到"],
    ["Hooks", "钩子"],
    ["Light", "浅色"],
    ["Local", "本地"],
    ["Media", "媒体"],
    ["menu)", "菜单)"],
    ["Model", "模型"],
    ["Queue", "排队"],
    ["Quota", "额度"],
    ["Quote", "引用"],
    ["Ready", "就绪"],
    ["Reset", "重置"],
    ["Retry", "重试"],
    ["Rules", "规则"],
    ["Setup", "配置"],
    ["Sound", "声音"],
    ["Start", "开始"],
    ["Theme", "主题"],
    ["Turbo", "无限"],
    ["Usage", "用量"],
    ["Visit", "访问"],
    ["Voice", "语音"],
    ["Owner", "所有者"],
    ["Paste", "粘贴"],
    ["Daily", "每天"],
    ["Scope", "范围"],
    ["Goals", "目标"],
    ["Links", "链接"],
    ["Where", "位置"],
    ["Unpin", "取消固定"],
    ["Cloud", "云端"],
    ["Debug", "调试"],
    [", or", "，或"],
    ["Auto", "自动"],
    ["Back", "返回"],
    ["Chat", "对话"],
    ["Copy", "复制"],
    ["Dark", "深色"],
    ["Deny", "拒绝"],
    ["Done", "完成"],
    ["Edit", "编辑"],
    ["Fast", "快"],
    ["File", "文件"],
    ["Fill", "铺满"],
    ["Font", "字体"],
    ["Help", "帮助"],
    ["High", "高"],
    ["Hold", "按住"],
    ["Idle", "空闲"],
    ["Labs", "实验室"],
    ["Logs", "日志"],
    ["More", "更多"],
    ["Name", "名称"],
    ["Next", "下一步"],
    ["None", "无"],
    ["Open", "打开"],
    ["Pane", "窗格"],
    ["Plan", "套餐"],
    ["Push", "推送"],
    ["Quit", "退出"],
    ["Read", "读取"],
    ["Skip", "跳过"],
    ["Slow", "慢"],
    ["Stop", "停止"],
    ["Time", "时间"],
    ["Tool", "工具"],
    ["Type", "类型"],
    ["Undo", "撤销"],
    ["View", "查看"],
    ["Wide", "宽"],
    ["Seek", "跳转进度"],
    ["Save", "保存"],
    ["Task", "任务"],
    ["When", "时间"],
    ["Docs", "文档"],
    ["Fork", "派生"],
    ["Zoom", "缩放"],
    ["Find", "查找"],
    ["Add", "添加"],
    ["App", "应用"],
    ["Low", "低"],
    ["New", "新增"],
    ["now", "刚刚"],
    ["Now", "当前"],
    ["Off", "关闭"],
    ["Pin", "固定"],
    ["Ran", "已运行"],
    ["Run", "运行"],
    ["Use", "使用"],
    ["Cut", "剪切"],
    ["at", "于"],
    ["No", "否"],
    ["On", "开启"],
  ]);

  // 根据长度倒序排序
  const sortedPhrases = Array.from(phrases.entries()).sort((a, b) => b[0].length - a[0].length);

  // 小写词汇索引，便于精准匹配大小写差异
  const lowerPhrases = new Map();
  for (const [k, v] of phrases.entries()) {
    lowerPhrases.set(k.toLowerCase(), v);
  }

  // v3.3.48 (Antigravity 2.32.1) 增量精确词典：仅写入 O(1) 精确查找表，不进入线性子串扫描
  const extraExactPhrases = [["\"Always Proceed\"","“总是直接继续”"],["(Archived)","（已归档）"],["+ Add folder","+ 添加文件夹"],["+ Add Project Folder","+ 添加项目文件夹"],["+ New","+ 新建"],["+ New Chat","+ 新建对话"],["1 Comment","1 条评论"],["2. Make sure that your selected workspace is synced to head. This ensures that the installed skills are available in your workspace.","2. 请确保您所选的工作区已同步至最新提交（Head）。这可确保安装的技能在您的工作区中可用。"],["A copy of the workspace snapshot recorded at this step.","在此步骤记录的工作区快照副本。"],["A new version is available.","发现新版本可用。"],["Aborted","已中止"],["About","关于"],["about 1 hour","约 1 小时"],["About Antigravity","关于 Antigravity"],["Accept all","全部接受"],["Accept Changes","接受更改"],["Accept Suggestion","接受建议"],["Account Details","账户详情"],["Action","操作"],["Active","活跃"],["Active Browser page","活动浏览器页面"],["Activity Bar","活动栏"],["Add a message...","输入消息..."],["Add Comment","添加评论"],["Add context browser","添加到上下文"],["Add Context Picker","添加上下文"],["Add Context Server","添加上下文服务"],["Add Context Servers","添加上下文服务"],["Add context...","添加上下文..."],["Add Denied Path","添加禁止路径"],["Add project folder","添加项目文件夹"],["Add recent remote workspace","添加最近使用的远程工作区"],["Add to context","添加到上下文"],["Add Workspace","添加工作区"],["Adding...","正在添加..."],["Advanced Search","高级搜索"],["Agent cannot modify files outside of the workspace in strict mode.","在严格模式下，智能体不能修改工作区以外的文件。"],["Agent finished","智能体已完成"],["Agent Script","智能体脚本"],["Agent Script Command Configuration","智能体脚本命令配置"],["Agent Settings","智能体设置"],["Agent Stopped","智能体已停止"],["All","全部"],["All automations run as Flash","所有自动化任务均以 Flash 模型运行"],["All automations run as Flash.","所有自动化任务均以 Flash 模型运行。"],["All changes since origin/main","自 origin/main 以来的全部更改"],["All changes since origin/main.","自 origin/main 以来的全部更改。"],["All changes since origin/master","自 origin/master 以来的全部更改"],["All conversations","全部会话"],["All Files","所有文件"],["All plugins run as Flash","所有插件均以 Flash 模型运行"],["All plugins run as Flash.","所有插件均以 Flash 模型运行。"],["Also includes","也包含"],["Also includes global settings when working in this project","在此项目中工作时也包含全局设置"],["Also includes global settings when working in this project.","在此项目中工作时也包含全局设置。"],["Alt+Enter On empty prompt, sends next in queue","Alt+Enter 在输入框为空时发送队列中的下一条消息"],["Alt+Enter Queues after the turn","Alt+Enter 轮次结束后进入排队"],["Alt+Enter Sends immediately","Alt+Enter 立即发送"],["Alternatively, request the agent to add the skills:","或者，请求智能体添加所需技能："],["Always","始终"],["Always Require Approval","始终需要审批"],["Always run","始终运行"],["An error occurred while checking the port. Please try again.","检查端口时发生错误，请重试。"],["Analyzed","已分析"],["Analyzing","正在分析"],["Analyzing...","正在分析..."],["Antigravity Agent","Antigravity 智能体"],["API Endpoint","API 端点接口"],["API Key","API 密钥"],["API Key is configured","API 密钥已配置"],["App Data Directory","应用数据保存路径"],["Approve","批准"],["Approved","已批准"],["Archive Environment","归档环境"],["Are you sure you want to delete this project?","您确定要删除此项目吗？"],["Are you sure you want to mark 1 conversation as read? This action cannot be undone.","您确定要将 1 个会话标记为已读吗？此操作无法撤销。"],["around","大约"],["Attach a screenshot","附上屏幕截图"],["Attach screenshot (optional)","附上屏幕截图（可选）"],["Attach screenshots","附上屏幕截图"],["Audio File","音频文件"],["Authenticated","已认证"],["Authenticating...","正在认证..."],["Auto (detected)","自动 (已检测)"],["Auto Check for Updates","自动检查更新"],["Auto Update","自动更新"],["Auto-Approve Safe Actions","自动批准安全操作"],["Auto-Captured","自动捕获"],["Automatically check for updates","自动检查更新"],["Automatically download and install updates","自动下载并安装更新"],["Automation credentials expired","自动化凭据已过期"],["Automation credentials expiring soon","自动化凭据即将过期"],["Automation saved","自动化已保存"],["Autonomous","自主模式"],["Autonomous Execution","自主执行模式"],["Autopush","Autopush 自动推送版"],["Awaiting Authentication...","正在等待认证..."],["Bad clarification","澄清提问不当"],["Balanced","平衡模式"],["Base URL","基础请求 URL"],["Battle mode","对决模式"],["Battle Mode Infos","对决模式信息"],["Battle Mode Overrides","对决模式参数重载"],["Battle Mode requires at least one commit in the Git repository","对决模式要求 Git 仓库中至少包含一次提交"],["Battle Mode requires at least one commit in the Git repository.","对决模式要求 Git 仓库中至少包含一次提交。"],["Best of N","多候选对决"],["Best of N mode","多候选对决模式"],["Best-of-N","多候选对决 (Best-of-N)"],["Best-of-N Ended","多选最优模式已结束"],["Best-of-N mode","多候选对决模式"],["Best-of-N Started","多选最优模式已开始"],["Beta","测试版 (Beta)"],["Better code quality","代码质量更高"],["Binary file","二进制文件"],["Block all browser JavaScript execution","禁止执行所有浏览器 JavaScript 脚本"],["Blocked on Your Input","等待您的输入反馈"],["Blocked Terminal Commands","已阻止的终端命令"],["Both are bad","两项均表现不佳"],["Both are good","两项均表现优秀"],["Both were bad","两项均表现不佳"],["Both were good","两项均表现优秀"],["Branch main","分支 main"],["Branch name can only contain letters, numbers, underscores, dashes, dots, and slashes","分支名称只能包含字母、数字、下划线、横线、点和斜杠"],["Browse","浏览"],["Browse the Marketplace","浏览插件市场"],["Browser Agent Settings","浏览器智能体设置"],["Browser Automation","浏览器自动化"],["Browser Launch Args","浏览器启动参数"],["Browser Settings","浏览器设置"],["Browser settings have moved","浏览器设置已迁移"],["Browser settings have moved to the Browser section of General settings","浏览器设置已迁移至“通用设置”中的“浏览器”板块"],["Browser settings have moved to the Browser section of General settings.","浏览器设置已迁移至“通用设置”中的“浏览器”板块。"],["Browser settings have moved to the Browser section of General settings. Go to General settings","浏览器设置已迁移至“通用设置”中的“浏览器”板块。前往通用设置"],["Browser settings have moved to the Browser section of General settings. Go to General settings.","浏览器设置已迁移至“通用设置”中的“浏览器”板块。前往通用设置。"],["Browser tools are disabled in the Antigravity Android desktop app.","浏览器工具在 Antigravity Android 桌面应用中已禁用。"],["Browser tools are not available in the Antigravity Android desktop app.","浏览器工具在 Antigravity Android 桌面应用中不可用。"],["Browser Viewport Height","浏览器视口高度"],["Build applications with the Gemini Interactions API and Live API including text generation, multi-turn chat, streaming, function calling, managed agents, and real-time audio and video.","使用 Gemini Interactions API 和 Live API 构建应用，包括文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频。"],["Building","正在构建"],["Built-in Skills","内置技能"],["Bundled With the App","应用内置随附"],["By step type","按步骤类型"],["By using this app, you agree to its Terms of Service","使用此应用即表示您同意其服务条款"],["Bypass Proxy For","以下地址不使用代理"],["Cache","缓存"],["Cancel (Cmd+D)","取消 (Cmd+D)"],["Cancel (Ctrl+D)","取消 (Ctrl+D)"],["Canceled","已取消"],["Canceling","正在取消"],["Candidate","候选方案"],["Candidate 1","候选方案 1"],["Candidate 2","候选方案 2"],["Candidate A","候选方案 A"],["Candidate B","候选方案 B"],["Candidate C","候选方案 C"],["Candidates","候选方案"],["Cannot parse folder URI.","无法解析文件夹 URI。"],["Cannot reroll a turn that was cleared to save space","无法重新生成为节省空间已清除的轮次"],["Cannot revert this message","无法撤回此消息"],["Cannot send message to subagent.","无法向子智能体发送消息。"],["Cannot store content under the reserved new-tab id","无法在保留的 new-tab ID 下存储内容"],["Capturing","正在截取"],["Chat anyways","仍然对话"],["Check again","再次检查"],["Check for Updates Automatically","自动检查软件更新"],["Check for Updates on Startup","启动时检查更新"],["Check for Updates...","检查更新..."],["Checked command status","已检查命令状态"],["Checking command status","正在检查命令状态"],["Checking for updates...","正在检查更新..."],["Checking for updates…","正在检查更新..."],["Checking...","正在检查..."],["Checkpoint","检查点"],["Child Subagent","下级子智能体"],["Choose the product skin that fits how you work.","选择适合您工作方式的产品界面风格。"],["Choose winner","选择优胜方案"],["CL details unavailable","CL 详情不可用"],["Cleanup Script","清理脚本"],["Clear all","全部清除"],["Clear Cache","清理缓存"],["Clear Cache and Reload","清理缓存并重新加载"],["Clear Chat History","清空对话历史"],["Clear Conversation","清空会话"],["Clear History","清除历史"],["Clear queue","清空队列"],["Clear Terminal","清空终端"],["CLI Project","CLI 项目"],["Client","客户端"],["Close side panel","关闭侧面板"],["Close Window","关闭窗口"],["Cmd+Enter Queues after the turn","Cmd+Enter 轮次结束后进入排队"],["Cmd+Enter Sends immediately","Cmd+Enter 立即发送"],["Code search is not available.","代码搜索不可用。"],["Code snippet","代码片段"],["Collapse","折叠"],["Collapse (shift+click to collapse every level below)","折叠（按住 Shift 点击可折叠下方所有层级）"],["Collapse queued messages","折叠排队中的消息"],["Collapse subagents","折叠子智能体"],["Collapse toast","折叠通知提示"],["Command picker","命令选择器"],["Comment","评论"],["Commented on:","评论于："],["Communication","沟通表达"],["Compact Mode","紧凑模式"],["companion website","配套网页端"],["Configuration","配置"],["Configure automations","配置自动化"],["Configure browser subagent","配置浏览器子智能体"],["Configure browser subagent .","配置浏览器子智能体。"],["Configure browser subagent.","配置浏览器子智能体。"],["Configure Terminal Settings","配置终端设置"],["Configure the browser subagent","配置浏览器子智能体"],["Configure the browser subagent .","配置浏览器子智能体。"],["Configure the browser subagent.","配置浏览器子智能体。"],["Configure the browser subagent. It requires Google Chrome to be installed.","配置浏览器子智能体。需要系统中已安装 Google Chrome 浏览器。"],["Confirm the command is safe to run","确认该命令可安全运行"],["Conflict","冲突"],["Connection","连接"],["Connection Failed","连接失败"],["Connection Successful","连接成功"],["Console logs","控制台日志"],["Context browser","上下文浏览器"],["Context Length Limit","上下文长度上限"],["Continue with Advanced SSO","通过高级 SSO 继续"],["Continuous Execution","连续执行模式"],["Continuous Mode","持续模式"],["Controls the actions the agent can take","控制智能体可以执行的操作"],["Conversation Sharing","会话共享"],["Copied error","已复制错误信息"],["Copied error to clipboard","已复制错误信息到剪贴板"],["Copied!","已复制！"],["Copy as Markdown","复制为 Markdown"],["copy code","复制代码"],["Copy error","复制错误信息"],["Copy error messages","复制错误消息"],["Copy Last Response","复制最后一条回复"],["Copy project","复制项目"],["Copy project path","复制项目路径"],["Copy Sidecar ID","复制 Sidecar ID"],["Copy the folder elsewhere first if you might want it back.","如果后续可能还需要该内容，请先将文件夹备份至其他位置。"],["Copy workspace","复制工作区"],["Correct code","代码准确无误"],["Correctness","准确性"],["Create Automation","创建自动化"],["Create conversation","新建会话"],["Create fork in current workspace","在当前工作区中创建分支副本"],["Create fork in new workspace","在全新工作区中创建分支副本"],["Create fork in shared workspace","在共享工作区中创建分支副本"],["Create Group","创建分组"],["Create new conversation","新建会话"],["Created","创建于"],["Created a new branch on GitHub.","已在 GitHub 上创建新分支。"],["Credentials for one or more automations have expired.","一个或多个自动化的凭据已过期。"],["Credentials for one or more automations expire in less than a week.","一个或多个自动化的凭据将在不到一周内过期。"],["Created a new branch on Origin.","已在远程源 (Origin) 上创建新分支。"],["Created outline","已创建大纲"],["Creating","正在创建"],["Creating environment...","正在创建环境..."],["Ctrl+Enter Queues after the turn","Ctrl+Enter 轮次结束后进入排队"],["Ctrl+Enter Sends immediately","Ctrl+Enter 立即发送"],["Current Page","当前页面"],["Current Plan","当前套餐"],["Cursor Blinking","光标闪烁样式"],["Custom for this project","为此项目单独配置"],["Custom Skills","自定义技能"],["Custom System Prompt","自定义系统提示词"],["Custom Title Bar","自定义标题栏"],["customization budget is available","自定义扩展预算可用"],["customization budget is available.","自定义扩展预算可用。"],["Customization Rules","自定义规则"],["Customization token budget exceeded. Large customizations will be truncated.","已超出自定义扩展的 Token 预算。超长自定义项将被截断。"],["Cycle detected","检测到循环"],["Daily Request Limit","每日请求上限"],["Debug Console","调试控制台"],["Debug Mode","调试模式"],["Default Execution Mode","默认执行模式"],["Delete agent","删除智能体"],["Delete Automation","删除自动化"],["Delete Group","删除分组"],["Delete server","删除服务"],["Delete this project","删除此项目"],["Delete this project.","删除此项目。"],["Deleting","正在删除"],["Deselect All","取消全选"],["DevTools port is still closed. Please make sure Chrome is running with remote debugging enabled.","DevTools 端口仍处于关闭状态。请确保 Chrome 正在运行且已启用远程调试。"],["Did what I wanted","符合预期诉求"],["Diff Options","差异选项"],["Directories","目录"],["Directory","目录"],["Disable","禁用"],["Disable Plugin","禁用插件"],["Disable Recommended Skills","禁用推荐技能"],["Discard Changes","放弃所有更改"],["Disconnected","已断开连接"],["Discover Skills","发现技能"],["Dismiss announcement","关闭公告"],["Dismiss Skills","忽略技能提示"],["Dismiss text selection notice","关闭文本选择通知"],["Dismiss toast","忽略通知提示"],["Document","文档"],["Download SVG","下载 SVG"],["Download Updates Automatically","自动下载更新包"],["Downloading Update","正在下载更新"],["Downloading update...","正在下载更新..."],["Downloading update…","正在下载更新..."],["Downloading...","正在下载..."],["Draft","草稿"],["Edit Automation","编辑自动化"],["Edit config","编辑配置"],["Edit title","编辑标题"],["Editing","正在编辑"],["Elegant code","代码优雅整洁"],["Empty message","空消息"],["Empty pie chart","饼图无数据"],["Enable","启用"],["Enable Best-of-2","启用双候选对决 (Best-of-2)"],["Enable Browser Tool","启用浏览器工具"],["Enable Chat","启用对话"],["Enable Personal Customizations","启用个人自定义设置"],["Enable Plugin","启用插件"],["Enable Thinking Mode","开启深度思考模式"],["Enabling...","正在启用..."],["End battle mode","结束对决模式"],["Enlarged Mermaid diagram","放大的 Mermaid 流程图"],["Enter a prompt for the agent to run","输入供智能体执行的提示词"],["Enter a prompt for the agent to run...","输入供智能体执行的提示词..."],["Enter authorization code","输入授权码"],["Enter automation name","输入自动化名称"],["Enter automation name...","输入自动化名称..."],["Enter command...","输入命令..."],["Enter Queues after the turn","Enter 轮次结束后进入排队"],["Enter Sends immediately","Enter 立即发送"],["Enter target...","输入目标..."],["Environment Actions","环境操作"],["Environment Variables","环境变量配置"],["Error during tool execution","工具执行期间出错"],["Error editing file","编辑文件出错"],["Error editing notebook","编辑笔记本出错"],["Error reading notebook","读取笔记本出错"],["Error viewing file","查看文件出错"],["Error while analyzing directory","分析目录时出错"],["Error while running command","运行命令时出错"],["Error while searching","搜索时出错"],["Error while searching filesystem","搜索文件系统时出错"],["Error while searching the web","网页搜索时出错"],["Error while semantic searching","语义搜索时出错"],["Errored","出错"],["Every month","每月"],["Excellent tool usage","工具调用出色"],["Exceptional work","表现极其出色"],["Executed","已执行"],["Executing","正在执行"],["Execution ID","执行 ID"],["Execution Metadata","执行元数据"],["Execution Mode","执行模式"],["Execution Progress","执行进度"],["Exit","退出"],["Expand","展开"],["Expand (shift+click to expand every level below)","展开（按住 Shift 点击可展开下方所有层级）"],["Expand queued messages","展开排队中的消息"],["Expand subagents","展开子智能体"],["Experimental","实验性功能"],["Expert at reviewing Flutter code for accessibility (a11y) issues. Invoke this agent to perform an a11y review of a codebase, pending changes, or PR.","擅长审查 Flutter 代码中的无障碍 (a11y) 问题。调用此智能体对代码库、待定更改或 PR 进行无障碍审查。"],["Explorer","资源管理器"],["Exploring","正在探索"],["Export Logs","导出日志记录"],["Extracted DOM elements","已提取 DOM 元素"],["Extracting DOM elements","正在提取 DOM 元素"],["Failed","失败"],["Failed to add plugin.","添加插件失败。"],["Failed to add plugin. Please try again.","添加插件失败。请重试。"],["Failed to archive workspace","归档工作区失败"],["Failed to build","构建失败"],["Failed to copy:","复制失败："],["Failed to edit","编辑失败"],["Failed to execute","执行失败"],["Failed to mark all as read","无法全部标记为已读"],["Failed to print document","打印文档失败"],["Failed to print document:","打印文档失败："],["Failed to read","读取失败"],["Failed to read file content","读取文件内容失败"],["Failed to revalidate slash commands:","重新验证斜杠命令失败："],["Features","功能"],["Fetched network request","已获取网络请求"],["Fetched network requests","已获取网络请求"],["Fetching network request","正在获取网络请求"],["Fetching network requests","正在获取网络请求"],["Fewer bugs","更少缺陷"],["File attachment","文件附件"],["File changed","已修改文件"],["File edits","文件编辑"],["File location","文件位置"],["Files modified by the agent in this conversation.","智能体在此会话中修改的文件。"],["Finalizing...","正在完成..."],["Finish","完成"],["finished","已完成"],["Focus Chat Input","聚焦对话输入框"],["Folder doesn't exist","文件夹不存在"],["Follow-up Messages","追问消息"],["for conversations outside of projects.","用于项目外会话。"],["for quick navigation and control.","用于快速导航和操作控制。"],["Forgot context","遗忘上下文信息"],["Forked from","派生自"],["Found in This Workspace","在当前工作区中找到"],["Found references to","找到相关引用："],["Frequency","执行频率"],["Frequency Penalty","频率惩罚度"],["Friday","周五"],["from AI Studio","（来自 AI Studio）"],["Function Calling","函数调用支持"],["Generate a link that lets any Googler load a read-only copy of a conversation. Sharing exports the conversation history to your public x20 folder, so it needs that folder to be readable by others.","生成一个链接，允许任何 Googler 加载该会话的只读副本。分享会将对话历史导出到您的公共 x20 文件夹，因此需要该文件夹对他人可读。"],["Generate Share Link","生成分享链接"],["Generated image","生成的图片"],["Generated image preview","生成图片预览"],["Generating Link","正在生成链接"],["Generations","生成记录"],["Generic Tool","通用工具"],["Global Rules","全局规则"],["Go","前往"],["Go to General settings","前往通用设置"],["Go to Home","返回首页"],["Goal","目标"],["Good questions","提问精准得当"],["Grasped nuance","精准把握细节"],["Group Actions","分组操作"],["Hacky/lazy code","代码粗糙敷衍"],["Hallucinated","产生幻觉捏造事实"],["Headless Mode","无头模式"],["Help improve the product by sending anonymous usage data","通过发送匿名使用数据帮助改进产品"],["Helpful explanation","解释清晰有帮助"],["Hide","隐藏"],["Hide breakdown","隐藏明细"],["Hide details","隐藏详情"],["Hide Error","隐藏错误"],["Hide tools","隐藏工具"],["Hide sidebar","隐藏侧边栏"],["Hide side panel","隐藏侧面板"],["High Contrast","高对比度"],["Highly independent","高度自主独立"],["Hooks Management","钩子管理"],["Host","主机地址"],["HTTP Proxy","HTTP 代理"],["HTTPS Proxy","HTTPS 代理"],["If enabled, you can manage your conversations from the companion website.","启用后，您可以从配套网站管理您的会话。"],["Ignored","忽略指令要求"],["Ignored Files","忽略的文件列表"],["Images","图片"],["Implementation Plan","实施方案文档"],["In a rush","赶时间"],["Inactive","未激活 / 空闲"],["Included Automatically in google3","在 google3 中自动包含"],["Incomplete / Gave up","半途而废 / 未完成"],["Info","提示"],["Inherit","继承"],["Inherit from System","继承系统主题"],["Inherit General","继承通用设置"],["Inherit global settings","继承全局设置"],["Inherited from global","继承自全局"],["Inherited from global settings","继承自全局设置"],["Inherits default settings","继承默认设置"],["Inherits General settings","继承“通用”设置"],["Inherits General settings.","继承“通用”设置。"],["Inherits your \"General\" settings when working in this project","在此项目中工作时，继承您的“通用”设置"],["Inherits your “General” settings when working in this project","在此项目中工作时，继承您的“通用”设置"],["Inherits your \"General\" settings when working in this project.","在此项目中工作时，继承您的“通用”设置。"],["Inherits your “General” settings when working in this project.","在此项目中工作时，继承您的“通用”设置。"],["Inherits your default settings","继承您的默认设置"],["Inherits your general settings","继承您的“通用”设置"],["Inherits your General settings.","继承您的“通用”设置。"],["Inline Diff","内联对比"],["inside of project","项目内"],["Inside of workspace","工作区内"],["Insiders","Insiders 体验版"],["Inspected commit","已检查提交"],["Install Antigravity IDE to run and edit your workspace scripts","安装 Antigravity IDE 以运行和编辑您的工作区脚本"],["Install Antigravity IDE to run and edit your workspace scripts.","安装 Antigravity IDE 以运行和编辑您的工作区脚本。"],["Install IDE","安装 IDE"],["Install IDE Extension","安装 IDE 插件"],["Install Update","安装更新"],["Installation","安装"],["Installed by You","由您安装"],["Installed Plugins","已安装插件"],["Installing","安装中"],["Installing Update","正在安装更新"],["Instruction","指令"],["Integration skill and tools for Google Maps Platform APIs","用于 Google Maps Platform API 的集成技能与工具"],["Intent understanding","意图理解问题"],["Interface Scale","界面比例"],["Internal search","内部搜索"],["Interrupt the agent and send immediately","打断智能体并立即发送"],["Invalid tool call","无效的工具调用"],["It requires","需要安装"],["It requires Google Chrome to be installed","需要安装 Google Chrome 才能运行"],["It requires Google Chrome to be installed.","需要安装 Google Chrome 才能运行。"],["It's a tie","势均力敌（平局）"],["JavaScript execution disabled in strict mode","严格模式下已禁用 JavaScript 执行"],["JavaScript Result","JavaScript 执行结果"],["JSON attachment","JSON 附件"],["just now","刚刚"],["Keep Antigravity running in the background","在后台保持 Antigravity 运行"],["Keep Changes","保留修改"],["Keep computer awake","保持电脑处于唤醒状态"],["Keyboard shortcuts for quick navigation and control","用于快速导航与控制的键盘快捷键"],["Kick off work on your computer and continue working with your agents from your phone or another device. Turn on Remote Control in app settings.","在您的计算机上开启工作，并通过手机或其他设备继续与您的智能体协同。可在应用设置中开启远程控制。"],["Killed","已终止"],["Lacked initiative","缺乏主动性"],["Laziness","偷懒敷衍"],["Link","链接"],["All Links","所有链接"],["Related Links","相关链接"],["Useful Links","常用链接"],["Shared Links","共享链接"],["Learn more about","了解更多关于"],["Learn more about Default","了解“默认”预设的详情"],["Learn more by visiting our","欲了解更多信息，请访问我们的"],["Learn more.","了解更多。"],["Leave a comment","留下评论"],["Line Height","行高"],["Listed in Your Config","在您的配置中列出"],["Load Global Rules","加载全局规则"],["Load Project Rules","加载项目规则"],["Loading added plugins...","正在加载已添加的插件..."],["Location","位置"],["Log","日志"],["Logged in as","当前登录身份："],["Main Agent","主智能体"],["Manage remote sessions","管理远程会话"],["Manage Sidecars","管理伴随服务"],["Manage Subscription","管理订阅"],["Manifest Changes","清单更改"],["Manual","手动"],["Manually Captured","手动捕获"],["Manually customize individual settings","手动自定义各项设置"],["Manually Rejected","手动拒绝"],["Mark 1 conversation as read","将 1 个会话标记为已读"],["Mark 1 conversation as read.","将 1 个会话标记为已读。"],["mark read","标记为已读"],["mark unread","标记为未读"],["Max Autonomy","最大自主性"],["Max Output Tokens","最大输出 Token 数"],["Media Files","媒体文件"],["Memory","内存"],["Mention","提及"],["Mermaid diagram","Mermaid 流程图"],["Message Delivery","消息传递策略"],["Minimize Pane","最小化面板"],["Misunderstood","误解用户意图"],["Modes","模式"],["Modified files:","已修改的文件："],["Monday","周一"],["Monthly","每月"],["More accurate","更准确"],["More comprehensive","更全面详尽"],["More creative","更有创意"],["Move Down","下移"],["Move Up","上移"],["Moved Mouse in Browser","已在浏览器中移动鼠标"],["Moving Mouse in Browser","正在浏览器中移动鼠标"],["Navigate to","导航至"],["Network","网络"],["Never","从不"],["Never Proceed Automatically","从不自动继续"],["Never run","从未运行"],["New Automation","新建自动化"],["New Chat","新建对话"],["Next Change","下一处变更"],["Next Suggestion","下一项建议"],["Nightly","开发版 (Nightly)"],["No artifacts generated","暂未生成任何产物"],["No automations","暂无自动化任务"],["No automations configured","尚未配置任何自动化任务"],["No automations.","暂无自动化任务。"],["No conversation selected","未选择会话"],["No files changed","未修改任何文件"],["No files changed.","未修改任何文件。"],["No folders added yet","暂未添加任何文件夹"],["No groups yet","暂无分组"],["No Javascript Result Output","无 JavaScript 结果输出"],["No matching flags","无匹配的实验特性标记"],["No project folders added yet","暂未添加任何项目文件夹"],["No project folders added yet.","暂未添加任何项目文件夹。"],["No projects yet","暂无项目"],["No Proxy","不使用代理"],["No results found","未找到结果"],["No results found.","未找到结果。"],["No skills used","未使用任何技能"],["No skills used.","未使用任何技能。"],["Non-technical","非技术模式"],["Not running","未运行"],["Not suitable for Best-of-N","不适用于多选最优模式"],["of the customization budget is available","的自定义扩展预算可用"],["of the customization budget is available.","的自定义扩展预算可用。"],["On empty prompt, sends next in queue","在输入框为空时，发送队列中的下一条消息"],["Open Antigravity","打开 Antigravity"],["Open full view","打开完整视图"],["Open in Browser","在浏览器中打开"],["Open in File Explorer","在文件资源管理器中打开"],["Open Log Directory","打开日志保存目录"],["Open sidebar","打开侧边栏"],["Open side panel","打开侧面板"],["Opt-out","退出体验"],["or copy link.","或复制链接。"],["Organization ID","组织 ID"],["Other reason","其他原因"],["outside of projects","项目外"],["outside of projects.","项目外。"],["Outside of workspace","工作区外"],["Overfixated","过度钻牛角尖"],["Override feature environment","替换特性环境"],["Override global settings","覆盖全局设置"],["Overview Button","概览按钮"],["Overview Panel","概览面板"],["Overwrite if exists","若存在则覆盖"],["Panel","面板"],["Paste plain text","粘贴为纯文本"],["Paste code here","在此处粘贴代码"],["Pattern","模式"],["Pause queue","暂停队列"],["PDF attachment","PDF 附件"],["Permanently delete this project","永久删除此项目"],["Permanently delete this project.","永久删除此项目。"],["Pick a winner","评选优胜方案"],["Pie chart must contain at least one positive data slice","饼图必须包含至少一个正数值数据切片"],["Pinned Chats Only","仅固定会话"],["Planning Mode","规划模式"],["Please select a winner","请选择一个优胜方案"],["Please verify your account, then sign in again to continue. Learn more by visiting our","请先验证您的账号，然后重新登录以继续。欲了解更多信息，请访问我们的"],["plugin","插件"],["Plugin is disabled","插件已禁用"],["Plugin Manager","插件管理器"],["Port","端口"],["Post-Tool Execution Hook","工具执行后钩子"],["Pre-Tool Execution Hook","工具执行前钩子"],["Preferences","首选项"],["Presence Penalty","存在惩罚度"],["Press Alt+Enter to queue","按 Alt+Enter 排队"],["Press Enter to send","按 Enter 发送"],["Press Shift+Enter for new line","按 Shift+Enter 换行"],["Previous Change","上一处变更"],["Previous Suggestion","上一项建议"],["Previous toast","上一条通知提示"],["Proactive solution","主动提供解决方案"],["Proactively connect to running Dart/Flutter apps and trigger hot reload or hot restart upon editing .dart files under lib/.","主动连接到正在运行的 Dart/Flutter 应用，并在编辑 lib/ 下的 .dart 文件时触发热重载或热重启。"],["Problems","问题"],["Processing","处理中"],["Product Skin","产品界面风格"],["Project already exists","项目已存在"],["Project ID","项目 ID"],["Project Root","项目根目录"],["Project Rules","项目规则"],["Prompt for approval before running browser scripts","在运行浏览器脚本前提示以征得批准"],["Prompt to execute on schedule...","按计划执行的提示词..."],["Prompt too simple","提示词过于简单"],["Proxy","代理"],["Proxy Configuration","代理网络配置"],["Proxy Settings","代理设置"],["Python Script","Python 脚本"],["Quality","完成质量"],["Questions","问题"],["Queue Delivery","排队消息发送"],["Queue for Next Turn","排队至下一轮"],["Queue message","排队消息"],["Queue messages","排队消息"],["Queue until after the current turn","排队等待，直至当前轮次结束"],["Queued message","排队中的消息"],["Queued message deleted","已删除排队中的消息"],["Queued Messages Behavior","排队消息处理行为"],["Queues after the turn","轮次结束后进入排队"],["Quit Antigravity","退出 Antigravity"],["Quote Ctrl+L","引用 Ctrl+L"],["Ran command","已运行命令"],["Rate Limit","速率限制"],["Rate Limits","速率限制"],["Read Browser Page in Browser","已读取浏览器页面"],["Read page","读取页面"],["Read URL content?","是否读取 URL 内容？"],["Read-Only Paths","只读路径列表"],["Read-Write Paths","读写路径列表"],["Reading","正在读取"],["Reading Browser Page in Browser","正在读取浏览器页面"],["Reading page","正在读取页面"],["Recent Workspaces","最近工作区"],["Reconnecting","正在重新连接"],["Recording","录音中"],["Redo","重做"],["Refreshed Browser page","已刷新浏览器页面"],["Refreshing Browser page","正在刷新浏览器页面"],["Refreshing...","正在刷新..."],["Reject all","全部拒绝"],["Reject Changes","拒绝更改"],["Reject Suggestion","拒绝建议"],["Rejected","已拒绝"],["Relaxed","宽松"],["Release Notes","发行说明"],["Reload Skills","重新加载技能库"],["Remote Control, or","远程控制，或"],["Remote Debugging Port","远程调试端口"],["Remote session","远程会话"],["Remote sessions","远程会话列表"],["Removing...","正在移除..."],["Rename Terminal","重命名终端"],["Report an Issue","报告问题"],["Requested changes","请求修改"],["Require Confirmation for Commands","执行命令时需要用户确认"],["requires Google Chrome to be installed","需要安装 Google Chrome 才能运行"],["requires Google Chrome to be installed.","需要安装 Google Chrome 才能运行。"],["Reset All Settings","重置所有设置至默认值"],["Reset to preset","重置为预设"],["Resets in 2h 35m","2 小时 35 分钟后重置"],["Resets in 2h 35m.","2 小时 35 分钟后重置。"],["Resets in 4d 13h","4 天 13 小时后重置"],["Resets in 4d 13h.","4 天 13 小时后重置。"],["Resets in less than a minute","不到 1 分钟后重置"],["Resets in less than a minute.","不到 1 分钟后重置。"],["Resets soon","即将重置"],["Resets soon.","即将重置。"],["Resized Browser window","已调整浏览器窗口大小"],["Resizing Browser window","正在调整浏览器窗口大小"],["Response A","回答 A"],["Response A was better","回答 A 表现更优"],["Response B","回答 B"],["Response B was better","回答 B 表现更优"],["Restart Sidecar","重启伴随服务"],["Restart to apply update","重启以应用更新"],["Restart to apply updates","重启以应用更新"],["Restart to Update","重启以更新"],["Restore Defaults","恢复默认设置"],["Restore Pane","还原面板"],["Restore split view","恢复分栏视图"],["Resume","恢复"],["Resume queue","恢复队列"],["Retrieved Browser Pages","已获取浏览器页面列表"],["Retrieved Console Logs from Browser","已从浏览器获取控制台日志"],["Retrieving Browser Pages","正在获取浏览器页面列表"],["Retrieving Console Logs from Browser","正在从浏览器获取控制台日志"],["Retry Connection","重试连接"],["Reveal in File Explorer","在文件资源管理器中显示"],["Reveal in Finder","在访达中显示"],["Revert and redo turn, best of N:","撤回并重做本轮（多候选对决 Best-of-N）："],["Revert Changes","撤回修改"],["Revoke","撤销"],["Rule Files","规则文件"],["Rule Priority","规则优先级"],["Run and Debug","运行与调试"],["run as Flash","均以 Flash 模型运行"],["run as Flash.","均以 Flash 模型运行。"],["Run automation","运行自动化"],["Run command","运行命令"],["Run in background","在后台保持运行"],["Run in Isolated Environment","在隔离环境中运行"],["s run as Flash","均以 Flash 模型运行"],["s run as Flash.","均以 Flash 模型运行。"],["Same Project","同一项目"],["Saturday","周六"],["Save All","全部保存"],["Save Automation","保存自动化"],["Save Comment","保存评论"],["Save Image","保存图片"],["Save Video","保存视频"],["Saving...","正在保存..."],["Screenshot","截图"],["Scrolled down in Browser","已在浏览器中向下滚动"],["Scrolled in Browser","已在浏览器中滚动页面"],["Scrolled up in Browser","已在浏览器中向上滚动"],["Scrolling down in Browser","正在浏览器中向下滚动"],["Scrolling in Browser","正在浏览器中滚动页面"],["Scrolling up in Browser","正在浏览器中向上滚动"],["Search conversations based on their contents","基于内容搜索会话"],["Search conversations based on their contents.","基于内容搜索会话。"],["Search file contents","搜索文件内容"],["Search is still indexing your conversations, so results may be incomplete","搜索服务仍在为您的对话建立索引，结果可能不完整"],["Search is still indexing your conversations, so results may be incomplete.","搜索服务仍在为您的对话建立索引，结果可能不完整。"],["Search past workspaces...","搜索历史工作区..."],["Search past worktrees...","搜索历史工作树..."],["Search tabs, files, plugins, subagents, artifacts, tasks...","搜索标签页、文件、插件、子智能体、产物文档、任务..."],["Search tabs, files, subagents, artifacts, tasks...","搜索标签页、文件、子智能体、产物、任务..."],["Searched files","已搜索文件"],["Searching...","正在搜索..."],["Section","分区"],["Sections","分区"],["See all","查看全部"],["Select","选择"],["Select a winner to continue","选择一个优胜方案以继续"],["Select an option","选择一个选项"],["Select category to search...","选择要搜索的类别..."],["Select Day","选择日期"],["Select Default Profile","选择默认配置文件"],["Select Hour","选择时间"],["Select modes","选择模式"],["Select Project to associate","选择要关联的项目"],["Select winner","选择优胜方案"],["Select workspace...","选择工作区..."],["Selected Option in Browser","已在浏览器中选择选项"],["Selected region","选定区域"],["Selecting Option in Browser","正在浏览器中选择选项"],["Send command input?","是否发送命令输入？"],["Send feedback as","以此身份发送反馈"],["Send message immediately","立即发送消息"],["Send next message in queue","发送队列中的下一条消息"],["Sends after agent","智能体结束后发送"],["Sends after agent finishes","智能体结束后发送"],["Sends immediately","立即发送"],["Server","服务器"],["Set API Key","设置 API 密钥"],["Setup Script","项目初始化脚本"],["Share","分享"],["Shares this repository, with a working copy of its own. Uncommitted changes stay behind.","共享此代码仓库，并拥有自己的工作副本。未提交的更改将保留在原处。"],["Sharing this conversation will export its history. Anyone with the link will be able to load and view it.","分享此会话将导出其历史记录。任何拥有链接的人都可以加载和查看。"],["Shift+Enter Queues after the turn","Shift+Enter 轮次结束后进入排队"],["Shift+Enter Sends immediately","Shift+Enter 立即发送"],["Show","显示"],["Show All Commands","显示所有命令面板"],["Show all resources","显示全部资源"],["Show Diff","显示差异对比"],["Show Error","显示错误"],["Show fewer resources","收起部分资源"],["Show in Explorer","在文件资源管理器中显示"],["Show in File Explorer","在文件资源管理器中显示"],["Show in File Manager","在文件管理器中显示"],["Show in Finder","在访达中显示"],["Show JavaScript Result","显示 JavaScript 结果"],["Show Line Numbers","显示行号"],["Show more","显示更多"],["Show more results","显示更多结果"],["Show settings anyway","仍然显示设置"],["Show sidebar","显示侧边栏"],["Show side panel","显示侧面板"],["Side by Side Diff","并排对比"],["Side Question:","旁路提问："],["Sidebar on Left","侧边栏靠左"],["Sidebar on Right","侧边栏靠右"],["Sidebar Position","侧边栏位置"],["Sidecar Logs","伴随服务日志"],["Sidecar Port","伴随服务端口"],["Sidecar Services","伴随服务管理"],["Sidecars","伴随服务"],["Sign in with business account","使用企业账号登录"],["Signed in as","当前登录身份："],["Signing in...","登录中..."],["Simplified interface without developer tooling.","无开发者工具的简化界面。"],["Simulated Key Press in Browser","已在浏览器中模拟按键"],["Simulating Key Press in Browser","正在浏览器中模拟按键"],["Skill Custom Paths","技能自定义路径"],["Skill Directory","技能目录"],["Skill Parameters","技能参数"],["Skill used","已使用技能"],["Skills & rules settings","技能与规则设置"],["Skills Management","技能管理"],["Skills used","已使用技能"],["Skin","界面风格"],["Skip survey","跳过问卷"],["Skipping...","正在跳过..."],["Smooth Scrolling","平滑滚动"],["Some older conversations are not searchable. Clear up large conversations to remediate.","部分较早的会话无法被搜索。清理体积较大的会话可解决此问题。"],["Something went wrong.","出错了。"],["Sort","排序"],["Sort Projects","项目排序"],["Sort Workspaces","工作区排序"],["Source Control","源代码管理"],["Split","分屏"],["Split Diff","分屏差异"],["Split Left","向左拆分"],["Split Up","向上拆分"],["Stable","稳定版"],["Staged","已暂存"],["Staged index changes and working tree changes","暂存区索引更改与工作区更改"],["Staged index changes and working tree changes.","暂存区索引更改与工作区更改。"],["Stale info","信息陈旧过时"],["Standalone Conversations","独立会话"],["Start battle mode","开启对决模式"],["Start Sidecar","启动伴随服务"],["Status Bar","状态栏"],["Status Bar Visibility","状态栏可见性"],["Stop automation","停止自动化"],["Stop Generating","停止生成"],["Stop Generation","停止生成"],["Stop Recording and Send","停止录制并发送"],["Stop Sequences","停止序列"],["Stop Sidecar","停止伴随服务"],["Stopped after","停止于"],["Storage","存储空间"],["Streaming","流式输出"],["Streaming Generation","正在流式生成"],["Subagent","子智能体"],["Subagent Conversation","子智能体会话"],["Submit Appeal","提交申诉"],["Submit feedback","提交反馈"],["Submitted","已提交"],["Submitting...","正在提交..."],["Success","成功"],["Success, Continuing...","认证成功，正在继续..."],["Successfully imported project:","已成功导入项目："],["Sunday","周日"],["Suspend","暂停"],["Switch Account","切换账户"],["System Instructions","系统指令"],["System Message","系统消息"],["System Prompt","系统提示词"],["Table of contents","目录大纲"],["Task Log","任务日志"],["Team of subagents to do long running work","由多个子智能体协作完成长周期任务"],["Telemetry & Analytics","遥测与分析"],["Tell us more about your choice","详细说明您的选择"],["Tell us more about your choice (optional)","详细说明您的选择（可选）"],["Temperature","采样温度"],["Test failed","测试失败"],["Testing","正在测试"],["Thank you for your feedback","感谢您的反馈"],["Thank you for your feedback!","感谢您的反馈！"],["Thanks for helping make Gemini better! This is a critical part of evaluating and improving our models.","感谢您帮助我们让 Gemini 变得更好！这是评估与改进模型的关键环节。"],["Thanks for your feedback!","感谢您的反馈！"],["the customization budget is available","自定义扩展预算可用"],["the customization budget is available.","自定义扩展预算可用。"],["The Google3 project is deprecated","Google3 项目已弃用"],["The server returned no conversation to fork into","服务器未返回可供分支的对话"],["Thinking Budget","思考预算"],["Thinking Budget (Tokens)","思考预算 (Token 数)"],["Thinking for","正在思考"],["Thinking Process","思考流程"],["This action cannot be undone.","此操作不可撤销。"],["This is very dangerous and we do not recommend doing this","这非常危险，我们不建议这样做"],["This is very dangerous and we do not recommend doing this.","这非常危险，我们不建议这样做。"],["This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assistant, allowing you to easily interact with your database, analyze your data, and optimize your database workload.","此插件为在 Google Cloud 上工作的数据工程师和数据库从业者提供专业技能套件。它充当专家助手，让您轻松与数据库交互、分析数据并优化数据库工作负载。"],["Thorough research","调研深入全面"],["Thorough testing","测试全面彻底"],["Thought","思考"],["Thursday","周四"],["Tie","平局"],["Time to First Token (TTFT)","首 Token 响应时间 (TTFT)"],["Timed","已计时"],["Timed out","已超时"],["Timed out waiting for the updated instance to load.","等待更新后的实例加载超时。"],["Timeout","超时"],["Timer expired","定时器已到期"],["timer has expired","定时器已到期"],["to add to Agent","以添加到智能体"],["to upload","以上传"],["To use browser tools, you need to enable remote debugging:","要使用浏览器工具，您需要启用远程调试："],["today","今天"],["Toggle","切换"],["Toggle Artifacts","切换产物面板显示"],["Toggle Full Screen","切换全屏"],["Toggle Fullscreen","切换全屏"],["Tokens","Token 统计"],["Tokens Used","已用 Token"],["Too many surveys","问卷调查过多"],["Tool Call Generation","正在生成工具调用"],["Tool Execution","工具执行中"],["Top P Sampling","Top P 采样值"],["Troubleshoot","故障排查"],["Try Remote Control","体验远程控制"],["Tuesday","周二"],["Type to search for code across your workspace.","输入内容以在工作区中搜索代码。"],["Under-researched","调研不够深入"],["Undercommunicated","沟通说明不足"],["Understanding Intent","意图理解"],["Undo restores your entire workspace to its state at this point.","撤销会将整个工作区恢复到此节点的状态。"],["Unfold code block","展开代码块"],["Unified Diff","统一差异"],["Uninstalling...","正在卸载..."],["Unknown","未知"],["Unknown edit","未知编辑"],["Unknown Environment","未知环境"],["Unknown file edit","未知文件编辑"],["Unknown Workspace","未知工作区"],["Unnamed","未命名"],["Unnamed resource","未命名资源"],["Unnamed rule","未命名规则"],["Unread","未读"],["Unstaged Changes","未暂存的更改"],["Untitled Conversation","无标题会话"],["Update Anyway","仍然更新"],["Update Channel","更新通道"],["Updated","更新于"],["Upload","上传"],["Upload to Agent","上传至智能体"],["Use business account","使用企业账号"],["Used context well","善用上下文信息"],["Used tool","已使用工具"],["User Global Rules","用户全局规则"],["User Prompt Hook","用户提示词钩子"],["User uploaded image","用户上传的图片"],["Using this option will attempt to revert all changes in this turn and redo the turn using N parallel trajectories. This will discard any changes made in this turn in order to redo it.","使用此选项将尝试撤回本轮中的所有更改，并使用 N 条并行轨迹重新执行本轮。为完成重做，本轮已产生的所有更改将被丢弃。"],["Validation failed. Please verify requirements and try again.","验证失败，请检查要求后重试。"],["Variables","变量"],["Verify","验证"],["Verify API Connection","验证 API 连接"],["View child subagents","查看下级子智能体"],["View documentation","查看文档"],["View Inline Diff","行内对比"],["View Log File","查看日志文件"],["View Release Notes","查看发行说明"],["View Unified Diff","统一对比"],["View Usage Details","查看用量详情"],["Viewed","已查看"],["Vision Support","视觉多模态支持"],["Waiting","等待中"],["Walkthrough","完成总结文档"],["Warning","警告"],["We apologize for the inconvenience. Please try again later.","给您带来不便，我们深表歉意。请稍后重试。"],["Wednesday","周三"],["Weekdays","工作日"],["Weekends","周末"],["Welcome back!","欢迎回来！"],["Welcome to","欢迎使用"],["What did you like about this response?","您喜欢这条回复的哪些方面？"],["When debug mode is on, you can see additional information about each steps in the conversation.","开启调试模式后，您可以查看会话中每个步骤的详细诊断信息。"],["when working in this project","在此项目中工作时"],["when working in this project.","在此项目中工作时。"],["Why are you opting out?","您为什么选择退出？"],["Why did you choose this winner?","您为什么选择此优胜方案？"],["Why did you prefer this response?","您为什么更青睐此回答？"],["Window Controls","窗口控制按钮"],["Winner","优胜方案"],["Winner survey","优胜方案评选调查"],["Word Wrap","自动换行"],["Working Changes","工作区变更"],["Workspace Actions","工作区操作"],["Workspace archived successfully","工作区已成功归档"],["Workspace CL Status","工作区 CL 状态"],["Workspace File Explorer","工作区文件资源管理器"],["Workspace name can only contain letters, numbers, underscores, and dashes","工作区名称只能包含字母、数字、下划线和横线"],["Workspace Rules","工作区规则"],["Workspaces are not available for this project","此项目不支持工作区"],["Worktrees are a git feature. This folder is shared as is.","工作树 (Worktrees) 是一项 Git 特性。此文件夹将按原样共享。"],["Worktrees are available for Git repositories","Git 仓库支持使用工作树 (Worktrees)"],["Worktrees are not available for this project","此项目不支持工作树 (Worktrees)"],["write-in","自行填写"],["(write-in)","(自行填写)"],["yesterday","昨天"],["You are on the latest version","您当前已是最新版本"],["You cannot modify Remote Control settings from Remote Control. Please modify these settings on your local application.","您无法在远程控制端修改远程控制设置。请在本地客户端应用中修改这些设置。"],["You've reached the maximum number of turns for this battle. End battle mode to continue.","您已达到本次对决的最大轮次上限。请结束对决模式以继续。"],["No commits to push","无待推送的提交"],["No commits to pull","无待拉取的提交"],["Ignore Whitespace Changes","忽略空白字符更改"],["Ignore Whitespace","忽略空白字符"],["Send message Enter","发送消息 Enter"],["Send message (Enter)","发送消息 (Enter)"],["Send message Return","发送消息 Return"],["Send message (Return)","发送消息 (Return)"],["Send message Ctrl+Enter","发送消息 Ctrl+Enter"],["Send message (Ctrl+Enter)","发送消息 (Ctrl+Enter)"],["Send message Cmd+Enter","发送消息 Cmd+Enter"],["Send message (Cmd+Enter)","发送消息 (Cmd+Enter)"],["All changes since the branch point","自原分支分叉点以来的全部更改"],["True changes vs the parent workspace","相对于父工作区的实际更改"],["Play (k)","播放 (k)"],["Pause (k)","暂停 (k)"],["Back 5s (←)","后退 5 秒 (←)"],["Forward 5s (→)","快进 5 秒 (→)"],["Mute (m)","静音 (m)"],["Unmute (m)","取消静音 (m)"],["Fullscreen (f)","全屏 (f)"],["Exit fullscreen (f)","退出全屏 (f)"],["Previous (←)","上一个 (←)"],["Next (→)","下一个 (→)"],["Download video","下载视频"],["Download image","下载图片"],["Failed to load media","加载媒体失败"],["Enlarged media","放大查看媒体"],["Unable to resolve PDF source URL","无法解析 PDF 源 URL"],["does not exist.","不存在。"],["do not exist.","不存在。"],["Fix with Agent","使用智能体修复"],["Paste code","粘贴授权码"],["Authorization Required","需要授权"],["Folder is empty","文件夹为空"],["Folder is larger than 20MB","文件夹大小超过 20MB"],["Zipping","正在压缩"],["Add folder path","添加文件夹路径"],["Add Resource","添加资源"],["Back to resource menu","返回资源菜单"],["Enter directory path...","输入目录路径..."],["Show temporary and forked workspaces","显示临时与分叉工作区"],["What best describes you?","哪一项最符合您的身份？"],["We'll tailor the experience to you.","我们将为您量身定制使用体验。"],["General work","通用办公"],["Get Anything Done with","借助以下工具搞定一切："],["Get Anything Done with Antigravity","借助 Antigravity 搞定一切"],["Debug bundle uploaded!","调试诊断包已上传！"],["Can't open the Drive link?","无法打开云端硬盘链接？"],["Download the bundle manually and share it instead:","请改为手动下载诊断包并分享："],["Uploads logs, settings, and conversation summaries to your Drive.","将日志、设置与会话摘要上传至您的 Google Drive。"],["Trajectory Stats","轨迹统计信息"],["Failed to load trajectory","加载执行轨迹失败"],["No cascade ID provided","未提供会话流 (Cascade) ID"],["Step Timing","步骤耗时"],["Sender Agent","发送方智能体"],["Step Preview","步骤预览"],["Excluded Step","已排除的步骤"],["This step is visible in the standard conversation view, but was excluded from the messages sent to the model.","此步骤在标准会话视图中可见，但已从发送给模型的消息上下文中排除。"],["Select a step in the timeline to inspect","在时间线中选择一个步骤以查看详情"],["Active Context Start","活跃上下文起点"],["Collapse idle","折叠空闲时段"],["By kind","按类别"],["By phase","按阶段"],["Emphasize","高亮强调"],["No steps with timestamps to place on a timeline.","没有带时间戳的步骤可供在时间线上展示。"],["← Parent","← 父级"],["Side-by-Side","左右并排"],["Side-by-side layout","左右并排布局"],["Stacked","上下堆叠"],["Stacked layout","上下堆叠布局"],["Debug view layout","调试视图布局"],["Double-click to reset panel sizes","双击以重置面板大小"],["Fit the whole trajectory","适应完整轨迹视图"],["Arguments Schema","参数结构 (Schema)"],["Artifact Name","产物名称"],["Unused Capacity","未用容量"],["Tool Defs","工具定义"],["No execution metadata available for this step.","此步骤无可用的执行元数据。"],["No Invocation Metadata","无调用元数据"],["No Invocation Associated","未关联调用"],["This step is not associated with an invocation.","此步骤未关联任何模型调用。"],["No Prompt or Tools Data","无提示词或工具数据"],["Prompt and tools metadata for this invocation has been cleared to save space. Full details are only preserved for the latest invocation.","为节省空间，本次调用的提示词与工具元数据已被清理。完整详情仅保留在最新一次调用中。"],["Time spent by the language model generating and streaming the tool call.","语言模型生成并流式输出该工具调用所花费的时间。"],["Time spent waiting in queue for previous tools to complete or move to background before execution began.","开始执行前在队列中等待前置工具完成或转入后台所花费的时间。"],["Non-model response token counts are estimations. The model API does not return per-message token counts.","非模型回复的 Token 数量为估算值。模型 API 不会返回单条消息的精确 Token 计数。"],["Back to Automations","返回自动化列表"],["when working in these conversations.","在此类会话中工作时。"],["when working in these conversations","在此类会话中工作时"],["when working in","在此工作中"],["when working","工作中"],["in this project.","此项目中。"],["in this project","此项目中"],["this project.","此项目中。"],["this project","此项目中"],["in these conversations.","此类会话中。"],["in these conversations","此类会话中"],["these conversations.","此类会话中。"],["these conversations","此类会话中"],["View archived in the sidebar (▾ menu).","可在侧边栏查看已归档会话（▾ 菜单）。"],["View archived in the sidebar (▾ menu)","可在侧边栏查看已归档会话（▾ 菜单）"],["View archived in the sidebar (▼ menu).","可在侧边栏查看已归档会话（▼ 菜单）。"],["View archived in the sidebar (▼ menu)","可在侧边栏查看已归档会话（▼ 菜单）"],["(▾ menu).","（▾ 菜单）。"],["(▾ menu)","（▾ 菜单）"],["▾ menu)","▾ 菜单）"],["▾ menu","▾ 菜单"],["(▼ menu).","（▼ 菜单）。"],["(▼ menu)","（▼ 菜单）"],["▼ menu)","▼ 菜单）"],["▼ menu","▼ 菜单"],["View archived","查看已归档"],["View archived conversations","查看已归档会话"],["Show archived","显示已归档"],["Show archived conversations","显示已归档会话"],["Hide archived","隐藏已归档"],["Hide archived conversations","隐藏已归档会话"],["Archived conversations","已归档会话"],["Active conversations","活跃会话"],["Unarchive","取消归档"],["Unarchive conversation","取消归档会话"],["Unarchive this conversation","取消归档此会话"],["Restore from archive","从归档中恢复"],["Filter conversations","筛选会话"],["Filter conversations...","筛选会话..."],["Search Across Conversations","跨会话搜索"],["Search across conversations.","跨会话搜索。"],["Search Across Conversations...","跨会话搜索..."],["Search Across All Conversations","跨所有会话搜索"],["Search across all conversations...","跨所有会话搜索..."],["Drop to add to group","拖放以添加至分组"],["Accept Focused Change","接受当前选中的更改"],["Reject Focused Change","拒绝当前选中的更改"],["Manage Data Sharing & Telemetry","管理数据共享与遥测"],["Sidebar Updates","侧边栏更新"],["This is a preview of the plugin","这是该插件的预览版"],["Open plugin page","打开插件页面"],["Sidecar View","Sidecar 视图"],["Creating Sidecar","正在创建 Sidecar"],["No method available to manage sidecar","无可用方法来管理 Sidecar"],["Auto-assignment","自动分配"],["Auto Assignment","自动分配"],["Creating Cloud Project","正在创建云端项目"],["Other Projects","其他项目"],["Unknown Project","未知项目"],["No license available for this project and location","此项目和位置暂无可用许可证"],["Select Google Drive files or folders","选择 Google 云端硬盘文件或文件夹"],["View File","查看文件"],["Directory Viewer","目录查看器"],["Virtual File Viewer","虚拟文件查看器"],["Artifact Viewer","产物查看器"],["Browser Subagent Viewer","浏览器子智能体查看器"],["Selected model does not support this media type","所选模型不支持此媒体类型"],["Select a model in the model selector","在模型选择器中选择模型"],["Agent is analyzing videos","智能体正在分析视频"],["No extensions available.","暂无可用扩展。"],["Search tabs, files, extensions, subagents, artifacts, tasks...","搜索标签页、文件、扩展、子智能体、产物、任务..."],["Search tabs, files, extensions, subagents, artifacts, tasks","搜索标签页、文件、扩展、子智能体、产物、任务"],["Click to respond to the questions.","点击以回答问题。"],["Click to respond to the question.","点击以回答问题。"],["The agent is waiting for your input.","智能体正在等待您的输入。"],["Waiting for your input","正在等待您的输入"],["Side question answered.","旁支问题已回答。"],["Voice disconnected.","语音已断开连接。"],["Audio file size exceeds 20MB limit","音频文件大小超过 20MB 限制"],["Audio streaming transcription not available","音频流式转录不可用"],["Streaming audio feature is not available","音频流式传输功能不可用"],["Type any voice server address.","输入任何语音服务器地址。"],["Amend staged changes into the current commit","将暂存的更改追加合并至当前提交 (Amend)"],["Stage and amend all changes into the current commit","暂存并追加合并所有更改至当前提交"],["Commit staged changes","提交暂存的更改"],["Stage and commit all changes","暂存并提交所有更改"],["Commit message cannot be empty","提交信息不能为空"],["No commit to amend","没有可供追加合并的提交"],["Git commit","Git 提交"],["Open preview in embedded pane","在嵌入式窗格中打开预览"],["Setting up WSL:","正在准备 WSL 环境："],["Installing into","正在安装至"],["Update: Mode","更新策略"],["Failed to start host bridge server:","启动宿主桥接服务失败："],["Failed to close host bridge server:","关闭宿主桥接服务失败："],["Failed to close session connections:","关闭会话连接失败："],["Language Server process is not running.","语言服务器进程未在运行。"],["5h limit","5 小时限额"],["5h limit.","5 小时限额。"],["5h rate limit","5 小时速率限制"],["Script aborted by host","脚本已被宿主中止"],["Script execution failed","脚本执行失败"],["Worker execution failed","Worker 执行失败"],["Script execution has already finished","脚本执行已完成"],["Script return value is not JSON-serializable","脚本返回值无法被 JSON 序列化"],["Failed to initialize pageFacadeBundle","初始化 pageFacadeBundle 失败"],["Failed to compile modelScript","编译 modelScript 失败"],["Invalid Worker outcome","无效的 Worker 执行结果"],["Requesting sender WebContents was destroyed","请求发送方 WebContents 已销毁"],["Requesting sender renderer process exited","请求发送方渲染进程已退出"],["Requesting sender WebContents navigated","请求发送方 WebContents 已导航跳转"],["Script jail WebContents was destroyed","脚本沙箱 WebContents 已销毁"],["Script jail returned an invalid bootstrap response","脚本沙箱返回了无效的引导响应"],["Script jail session has unexpected preload scripts registered","脚本沙箱会话注册了非预期的预加载脚本"],["Unauthorized script-jail sender: WebContents is missing or destroyed","未授权的脚本沙箱发送方：WebContents 缺失或已销毁"],["Unauthorized script-jail sender: subframe cannot invoke script jail","未授权的脚本沙箱发送方：子框架无法调用脚本沙箱"],["Unauthorized script-jail sender: WebContents is not an active Hub BrowserWindow","未授权的脚本沙箱发送方：WebContents 不是活动状态的 Hub BrowserWindow"],["Remote Checkout","远程检出"],["Background Commands","后台命令"],["Search tabs, files, extensions, subagents, artifacts, commands...","搜索标签页、文件、扩展、子智能体、产物、命令..."],["Search tabs, files, extensions, subagents, artifacts, commands","搜索标签页、文件、扩展、子智能体、产物、命令"],["Search tabs, files, extensions, subagents, artifacts, command...","搜索标签页、文件、扩展、子智能体、产物、命令..."],["Search tabs, files, extensions, subagents, artifacts, command","搜索标签页、文件、扩展、子智能体、产物、命令"],["Includes Global Permissions when working in this project.","在此项目中工作时包含全局权限。"],["Includes Global Permissions when working in this project","在此项目中工作时包含全局权限"],["\"Allow remote debugging for this browser instance\"","“为此浏览器实例允许远程调试”"],["1 task running","1 个运行中的任务"],["Access a file outside workspace","访问工作区外部的文件"],["Access to the browser agent tools is blocked by your organization's admin controls policy.","您的组织管理员控制策略已阻止访问浏览器智能体工具。"],["Active MCP Servers","运行中的 MCP 服务"],["Activity bar background color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏中处于活动状态项的背景颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏背景颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏活动项的边框颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar border color separating to the side bar. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏与侧边栏之间的分隔边框颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar focus border color for the active item. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏活动项获得焦点时的边框颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar item foreground color when it is active. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏项处于活动状态时的前景文本颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity bar item foreground color when it is inactive. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏项处于非活动状态时的前景文本颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity notification badge background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏通知角标的背景颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Activity notification badge foreground color. The activity bar is showing on the far left or right and allows to switch between views of the side bar.","活动栏通知角标的前景文本颜色。活动栏显示在最左侧或最右侧，用于在侧边栏的视图之间进行切换。"],["Add Allowed Path","添加允许路径"],["Add an MCP server above","在上方添加一个 MCP 服务"],["Agent Security Settings","智能体安全设置"],["Agent always asks for review before proceeding.","在继续执行前，智能体始终请求审查确认。"],["Agent permissions preset selector","智能体权限预设选择器"],["Agent will always ask to review in strict mode.","在严格模式下，智能体将始终请求审查确认。"],["Allow Cookie Access","允许访问 Cookie"],["Allow Form Input","允许表单数据输入"],["Allow Page Navigation","允许页面跳转导航"],["Allow Path","允许访问路径"],["Allow Screenshots","允许截取屏幕截图"],["Allow commands outside workspace sandbox","允许在工作区沙箱外执行命令"],["Allowed Terminal Commands","允许的终端命令"],["Artifacts are created when the agent performs more complex, longer running tasks while in Planning mode.","当智能体在规划模式下执行更复杂、耗时较长的任务时，将创建产物文档。"],["Artifacts are files the agent creates during a conversation to help perform longer running tasks and allow the user to provide high-level feedback. Click to open in editor.","产物是智能体在会话期间创建的文件，用于协助执行长任务并允许用户提供高层级审查反馈。点击可在编辑器中打开。"],["Ask Before Proceeding","继续前始终询问"],["Ask every time","每次都询问"],["Ask first","先询问"],["Ask for permission for sensitive operations.","对敏感操作请求授权许可。"],["Autonomous mode active: the agent works independently, and does not ask questions or request new permissions.","自主模式已激活：智能体将独立工作，不询问问题也不请求新权限。"],["Dark preview","深色预览"],["Deny Path","禁止访问路径"],["Document Access","文档访问权限"],["Enable All MCP Tools","启用所有 MCP 工具"],["Grant administrator access for","授予管理员权限于"],["Grant permission","授予权限"],["In autonomous mode, the agent works with autonomy-enhancing features, and does not ask questions or request new permissions.","在自主模式下，智能体启用增强自主性功能，不询问问题也不请求新权限。"],["Keep computer awake while tasks are running","在任务执行期间保持电脑处于唤醒状态"],["Light preview","浅色预览"],["MCP Config","MCP 配置"],["MCP Error","MCP 错误"],["MCP Server Status","MCP 服务状态"],["MCP Tool Call Review","MCP 工具调用审查"],["MCP Tool:","MCP 工具："],["Manage project folders, agent settings and permissions","管理项目文件夹、智能体设置与权限"],["Manage project folders, agent settings and permissions.","管理项目文件夹、智能体设置与权限。"],["Manage project folders, agent settings, and permissions","管理项目文件夹、智能体设置与权限"],["Model Context Protocol Servers","模型上下文协议 (MCP) 服务"],["Modify permissions for file, terminal, and MCP tools","修改文件、终端及 MCP 工具的访问权限"],["No tasks running","暂无运行中的任务"],["Pick a suggestion below to get started, or ask me anything.","选择下方的建议开始，或直接向我提问。"],["Policy","策略"],["Privacy Policy","隐私政策"],["Refresh MCP servers","刷新 MCP 服务"],["Strict Security","严格安全"],["Subagent Tasks","子智能体任务列表"],["Task Breakdown","任务分解"],["The browser subagent has been disabled by your administrator.","浏览器子智能体已被您的管理员禁用。"],["Whether the agent asks you to review its documents","智能体在创建产物文档时是否请求您审查"],["to browse the store, or add a custom server via the MCP config","浏览应用商店，或通过 MCP 配置文件添加自定义服务"],["to browse the store, or add a custom server via the MCP config.","浏览应用商店，或通过 MCP 配置文件添加自定义服务。"],["Configure MCP Server","配置 MCP 服务"],["Enter the required configuration values to install this MCP server.","输入安装此 MCP 服务所需的配置参数。"],["Could not determine MCP config file path. Please check your home directory settings.","无法确定 MCP 配置文件路径，请检查您的用户主目录设置。"],["Could not read MCP config file","无法读取 MCP 配置文件"],["Could not determine MCP config file path","无法确定 MCP 配置文件路径"],["Failed to load MCP servers","加载 MCP 服务失败"],["Failed to fetch available MCP servers:","获取可用 MCP 服务失败："],["No method available to open MCP config file","没有可用于打开 MCP 配置文件的关联程序"],["Failed to open MCP config file","打开 MCP 配置文件失败"],["No MCP servers yet. Use Add to browse the store.","暂无 MCP 服务。使用“添加”浏览应用商店。"],["Unnamed MCP server","未命名 MCP 服务"],["Install this plugin to see the commands it adds, along with its skills, agents and MCP servers.","安装此插件以查看其添加的命令，以及其包含的技能、智能体和 MCP 服务。"],["Error while running MCP tool","运行 MCP 工具时出错"],["MCP tool","MCP 工具"],["Execute an MCP tool call","执行 MCP 工具调用"],["Plugins are packaged collections of skills and MCPs to help the Agent","插件是技能与 MCP 的打包集合，用于辅助智能体"],["Use Add MCP to browse the store.","使用“添加 MCP”浏览应用商店。"],["These MCP allowlist rules are enforced by your organization","这些 MCP 允许名单规则由您的组织强制执行"],["using this MCP tool","使用此 MCP 工具"],["Inherit Global Permissions","继承全局权限"],["Project Permissions","项目权限"],["Inherited from Global Permissions","继承自全局权限"],["Override Global Permissions","覆盖全局权限"],["Project-specific permissions","项目专属权限"],["ask","询问"],["Vetted","已审查"],["Always Deny","始终拒绝"],["⚠️ Warning: \"Always Proceed\" is enabled without sandbox protection. This is very dangerous and we do not recommend doing this.","⚠️ 警告：“总是直接继续”在无沙箱保护的情况下已启用。这非常危险，我们不建议这样做。"],["Warning: \"Always Proceed\" is enabled without sandbox protection. This is very dangerous and we do not recommend doing this.","警告：“总是直接继续”在无沙箱保护的情况下已启用。这非常危险，我们不建议这样做。"],["Warning: \"Always Proceed\" is enabled without sandbox protection.","警告：“总是直接继续”在无沙箱保护的情况下已启用。"],["⚠️ Warning: \"Always Proceed\" is enabled without sandbox protection.","⚠️ 警告：“总是直接继续”在无沙箱保护的情况下已启用。"],["is enabled without sandbox protection.","在无沙箱保护的情况下已启用。"],["is enabled without sandbox protection","在无沙箱保护的情况下已启用"],["without sandbox protection","无沙箱保护"],["without sandbox protection.","无沙箱保护。"],["Inherits your Global Permissions","继承您的全局权限"],["Inherits your Global Permissions.","继承您的全局权限。"],["Inherits your Global Permissions when working in this project","在此项目中工作时，继承您的全局权限"],["Inherits your Global Permissions when working in these conversations","在此类会话中工作时，继承您的全局权限"],["Inherits your Global Permissions when working in these conversations.","在此类会话中工作时，继承您的全局权限。"],["Also includes Global Permissions","也包含全局权限"],["Also includes Global Permissions.","也包含全局权限。"],["Also includes Global Permissions when working in this project","在此项目中工作时也包含全局权限"],["Also includes Global Permissions when working in this project. Learn more.","在此项目中工作时也包含全局权限。了解更多。"],["Also includes Global Permissions when working in these conversations","在此类会话中工作时也包含全局权限"],["Also includes Global Permissions when working in these conversations.","在此类会话中工作时也包含全局权限。"],["Also includes Global Permissions when working in these conversations. Learn more.","在此类会话中工作时也包含全局权限。了解更多。"],["Search tasks","搜索任务"],["No scheduled tasks configured.","尚未配置任何定时任务。"],["No scheduled tasks configured","尚未配置任何定时任务"],["No scheduled tasks.","暂无定时任务。"],["No scheduled tasks","暂无定时任务"],["Edit Scheduled Task","编辑定时任务"],["Delete Scheduled Task","删除定时任务"],["Scheduled Task","定时任务"],["Enter scheduled task name...","输入定时任务名称..."],["Enter scheduled task name","输入定时任务名称"],["All scheduled tasks run as Flash.","所有定时任务均以 Flash 模型运行。"],["All scheduled tasks run as Flash","所有定时任务均以 Flash 模型运行"],["scheduled tasks run as Flash.","定时任务均以 Flash 模型运行。"],["scheduled tasks run as Flash","定时任务均以 Flash 模型运行"],["Save Scheduled Task","保存定时任务"],["Run task now","立即运行任务"],["Pause Task","暂停任务"],["Resume Task","恢复任务"],["In review","审查中"],["Execute JavaScript Policy","执行 JavaScript 策略"],["The agent always asks for review","智能体始终请求审查"],["Allow full browser script execution.","允许执行完整的浏览器脚本。"],["Allow full browser script execution","允许执行完整的浏览器脚本"],["Validated with GitHub and stored, together with your username, in","已通过 GitHub 验证，并与您的用户名一起安全存储在"],[". It is not visible in the agent's sandbox and is shared across all your projects.","中。它在智能体沙箱内不可见，并在您的所有项目间共享。"],["Hide token","隐藏令牌"],["Show token","显示令牌"],["Agent can","智能体可以"],["Remove policy","移除策略"],["Agent can run","智能体可运行"],["Workflow files","工作流文件"],["at ref","于分支/引用 (ref)"],["Workflow refs","工作流引用 (refs)"],["Delete repository policy","删除仓库策略"],["Contents","仓库内容"],["Toggle this on to enable read access on contents.","开启后允许读取仓库内容。"],["Toggle this on to allow creating new issues.","开启后允许创建新的 Issue。"],["Issue numbers","Issue 编号"],["Issue actions","Issue 操作权限"],["+ Add issue policy","+ 添加 Issue 策略"],["Toggle this on to allow creating new pull requests.","开启后允许创建新的拉取请求 (PR)。"],["Pull request numbers","PR 编号"],["Pull request actions","PR 操作权限"],["+ Add pull request policy","+ 添加拉取请求策略"],["Branch names","分支名称"],["Branch actions","分支操作权限"],["+ Add branch policy","+ 添加分支策略"],["+ Add workflow run policy","+ 添加工作流运行策略"],["Delete organization policy","删除组织策略"],["+ Add Repository policy","+ 添加代码仓库策略"],["+ Add Organization policy","+ 添加组织策略"],["Allow Gemini to notify you when the agent needs your attention or completes a task","允许 Gemini 在智能体需要您关注或完成任务时发送系统通知"],["Choose whether to be notified when the agent needs your attention or completes a task","选择是否在智能体需要您关注或完成任务时接收通知"],["This workspace overrides your global permission settings.","此工作区已覆盖您的全局权限设置。"],["Failed to save project settings:","保存项目设置失败："],["Failed to save settings:","保存设置失败："],["Grant the selected actions on the listed issue numbers — a comma-separated list like 1, 2, 3, or * for all.","对列出的议题 (Issue) 编号授予所选操作权限——以逗号分隔的列表（如 1, 2, 3），或填 * 代表全部。"],["Grant the selected actions on the listed pull request numbers — a comma-separated list like 1, 2, 3, or * for all.","对列出的拉取请求 (PR) 编号授予所选操作权限——以逗号分隔的列表（如 1, 2, 3），或填 * 代表全部。"],["Grant the selected actions on the listed branch names — a comma-separated list like main, dev, prod (glob patterns like fix-* allowed), or * for all.","对列出的分支名称授予所选操作权限——以逗号分隔的列表（如 main, dev, prod，支持 fix-* 等通配符），或填 * 代表全部。"],["Each rule lets the agent run the listed workflow files on the listed refs — each a comma-separated list like ci.yml, deploy.yml and main, dev (glob patterns like fix-* allowed), or * for all. Both fields must be set for a rule to grant anything.","每条规则允许智能体在指定的分支引用上运行指定的工作流文件——均使用逗号分隔列表，如 ci.yml, deploy.yml 与 main, dev（支持 fix-* 等通配符），或填 * 代表全部。两个字段必须同时填写方能生效。"],["Agent permissions preset selector, current: Request Review","智能体权限预设选择器，当前：请求审查"],["Agent permissions preset selector, current: Default","智能体权限预设选择器，当前：默认"],["Agent permissions preset selector, current: Turbo","智能体权限预设选择器，当前：无限"],["Agent permissions preset selector, current: Autonomous","智能体权限预设选择器，当前：自主模式"],["Google does not control the availability or functionality of third-party developer tools. Your data from third-party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here:","Google 不控制第三方开发者工具的可用性或功能。您在连接到 Antigravity 实例的第三方开发者工具中的数据可能会与 Google 共享。Google 将依据其隐私权政策保护此类数据，详见："],["See more in Google Workspace","在 Google Workspace 中查看更多"],["See less in Google Workspace","在 Google Workspace 中收起"],["See less in Build with Google","在使用 Google 构建中收起"],["See more in Design, Creative & Media","在设计、创意与媒体中查看更多"],["See less in Design, Creative & Media","在设计、创意与媒体中收起"],["See more in Productivity & Project Management","在生产力与项目管理中查看更多"],["See less in Productivity & Project Management","在生产力与项目管理中收起"],["See more in Cloud Hosting & Deployment","在云托管与部署中查看更多"],["See less in Cloud Hosting & Deployment","在云托管与部署中收起"],["See more in Developer Tools","在开发者工具中查看更多"],["See less in Developer Tools","在开发者工具中收起"],["See more in Business","在商务中查看更多"],["See less in Business","在商务中收起"],["See more in More Plugins","在更多插件中查看更多"],["See less in More Plugins","在更多插件中收起"],["Search and retrieve official documentation across Google Cloud, Gemini, Android, Firebase, Flutter, and Web. Requires Google Cloud credentials (ADC) or an API key.","搜索并获取 Google Cloud、Gemini、Android、Firebase、Flutter 和 Web 的官方文档。需要 Google Cloud 凭据（ADC）或 API 密钥。"],["Google Cloud guidance for coding agents: first-project onboarding, authentication and credential selection, and safety-critical validation for gcloud CLI commands. Includes the Google Developer Knowledge MCP server for grounded, up-to-date Google Cloud documentation.","为编程智能体提供 Google Cloud 指南，涵盖首个项目的上手流程、身份验证与凭据选择，以及 gcloud CLI 命令的安全校验。内置 Google Developer Knowledge MCP 服务器，可查询最新官方文档。"],["Official Trello plugin with the Trello MCP server and a skill for boards, lists, cards, checklists, Inbox, and Planner.","Trello 官方插件，包含 MCP 服务器及用于看板、列表、卡片、清单、收件箱与计划器的技能。"],["Use Datadog directly in Antigravity through a preconfigured Datadog MCP server. Query logs, metrics, traces, dashboards, and more through natural conversation. This plugin is in preview.","通过预配置的 Datadog MCP 服务器在 Antigravity 中查询日志、指标、链路追踪与仪表板。此插件处于预览阶段。"],["Packaged workflows for SCA remediation, AI SAST triage, CI/CD posture, malware response, findings review, Endor Labs setup, and more.","提供软件成分分析修复、AI 静态分析初筛、CI/CD 安全状况检查、恶意软件响应、发现审查及 Endor Labs 配置流程。"],["Triage Exabeam New-Scale alerts and cases end to end: gather the evidence, map MITRE, reach a verdict, and record it behind an approval step.","处理 Exabeam New-Scale 告警和事件，收集证据、映射 MITRE 框架、作出判断，并在获得批准后记录结果。"],["Build and debug pipelines, manage deployments, investigate security findings, and operate Harness with connected tools and reusable workflow skills.","通过已连接的工具和可复用流程技能构建及调试流水线、管理部署、调查安全发现并操作 Harness。"],["Search the web and read any page as clean markdown with Keenable, a search engine built for AI agents. Keyless: no signup or API key needed.","使用面向 AI 智能体的 Keenable 搜索网页，并将页面提取为简洁的 Markdown。无需注册或 API 密钥。"],["Ask a question of the live web and get a table back. Keenable SELECT runs many searches, reads the pages and extracts the fields you need in one call. Sign in with a Keenable account.","向实时网络提出问题并获取表格结果。一次调用可执行多次搜索、读取网页并提取所需字段。需要登录 Keenable。"],["Create, run and debug Leapwork Play tests and runlists, build agents, and hand work to Play's AI workflows, right from Antigravity.","在 Antigravity 中创建、运行并调试 Leapwork Play 测试和运行列表，构建智能体，并将工作交给 Play 的 AI 流程。"],["Official Antigravity plugin for MongoDB Atlas (hosted MCP Server + Skills). Connect to the MongoDB-hosted Atlas MCP server, explore data, manage collections, optimize queries, generate reliable code, implement best practices, develop advanced features, and more.","MongoDB Atlas 官方插件，提供托管 MCP 服务器和技能。连接 Atlas 后可探索数据、管理集合、优化查询、生成代码并采用最佳实践。"],["Search the live web and fetch page content with Parallel's hosted MCP server. Free access with no Parallel account, API key, or Parallel CLI required.","使用 Parallel 托管的 MCP 服务器搜索实时网络并获取网页内容。免费使用，无需 Parallel 账号、API 密钥或 CLI。"],["Agent plugin for PingOne multi-tenant. Includes skills and a remote MCP server that lets AI agents configure and monitor your PingOne environments.","面向 PingOne 多租户环境的智能体插件，提供技能与远程 MCP 服务器，用于配置和监控环境。"],["Equip Antigravity with specialized Postman skills for the complete API lifecycle. Discover, design, test, document, mock, monitor, and improve APIs through agent-friendly, filesystem-first workflows.","通过 Postman 技能管理 API 生命周期，涵盖发现、设计、测试、文档编写、模拟、监控和改进。流程以文件为基础，便于智能体操作。"],["Query your SentinelOne Singularity Console from Antigravity through a self-hosted, read-only Purple AI MCP server. Requires an active console deployment, your console URL, and an API token.","通过自托管的只读 Purple AI MCP 服务器，在 Antigravity 中查询 SentinelOne Singularity 控制台。需要可用的控制台、其地址和 API 令牌。"],["Official Supabase plugin for Antigravity with Supabase skills and MCP access for project management, database work, auth, storage, and Postgres best practices.","Supabase 官方 Antigravity 插件，提供项目管理、数据库、认证、存储及 Postgres 最佳实践技能，并支持 MCP 访问。"],["Make your coding agent a better engineer","提升编程智能体的工程实践能力。"],["Unity's official plugin for Antigravity, with curated skills for game development, monetization, and performance optimization.","Unity 官方 Antigravity 插件，精选游戏开发、商业化和性能优化技能。"],["Investigate files, URLs, domains and IP addresses with VirusTotal threat intelligence, analysis and submission recovery.","利用 VirusTotal 的威胁情报、分析结果及历史提交记录调查文件、URL、域名和 IP 地址。"],["Connect 9,000+ apps to your AI workflow. Discover, enable, and execute Zapier actions and workflows directly from your client.","将 9,000 多款应用接入 AI 工作流，直接在客户端查找、启用并执行 Zapier 操作和流程。"],["Run Zoho Books from Antigravity: invoicing, bills, banking, journals, projects, items, taxes, customization and automation.","通过 Antigravity 使用 Zoho Books，处理发票、账单、银行业务、会计分录、项目、商品、税务、自定义和自动化。"],["Build on Zoho CRM v8: REST API, Deluge functions, ClientScript, widgets, COQL and connections, with live CRM data through your Zoho MCP server.","在 Zoho CRM v8 上开发，支持 REST API、Deluge 函数、ClientScript、小组件、COQL 和连接，并通过 Zoho MCP 服务器访问实时 CRM 数据。"],["Zoho Desk plugin for Antigravity. Review, prioritize, and update Zoho Desk tickets directly from Antigravity through Zoho Desk MCP and includes a Ticket Prioritization Agent for triage and priority updates.","通过 Zoho Desk MCP 在 Antigravity 中查看、排序和更新工单。包含用于初筛和调整优先级的工单智能体。"],["Connect Zoho Projects to Antigravity to turn tasks and issues into working code. Access project context, investigate bugs, and update work items as you develop.","将 Zoho Projects 接入 Antigravity，把任务和问题落实到代码。开发期间可获取项目上下文、排查故障并更新工作项。"],["Search, read, draft, and send emails in Gmail.","搜索、阅读、起草和发送 Gmail 邮件。"],["Query Arize AX projects, traces, datasets, and experiments from Antigravity, with skills for tracing, evals, and prompt optimization.","在 Antigravity 中查询 Arize AX 项目、链路追踪、数据集和实验，并使用追踪、评估和提示词优化技能。"],["Turn an idea into a website, dashboard, report, or small web tool you can share. Build it in your conversation, or bring something you already made, and publish it with Spacefast.","将想法制作成可分享的网站、仪表板、报告或小型 Web 工具。可在对话中创建或导入已有作品，再通过 Spacefast 发布。"],[". Learn more about skills at","。了解更多关于技能的信息，请访问"],["**STOP AND VERIFY**: Before running any command or tool that results in irreversible data loss, you MUST obtain explicit user consent. When in doubt, ask. It is better to wait for confirmation than to accidentally delete production data or critical project assets. Use this for: - SQL: DROP TABLE/VIEW/SCHEMA/DATABASE, TRUNCATE, or broad DELETE (missing WHERE or using 1=1). - Cloud Storage: gsutil rm or gcloud storage rm targeting production data or critical buckets. - Infrastructure: gcloud projects delete, deleting Spanner/BigQuery/Dataproc resources, deleting secrets, or KMS key destruction.","【停止并核实】：在运行任何会导致不可逆数据丢失的命令或工具前，必须获得用户的明确同意。如有疑问请先询问，涵盖 SQL（DROP/TRUNCATE/无条件 DELETE）、Cloud Storage 生产数据删除以及 GCP 项目、Spanner、BigQuery、Dataproc 资源或密钥销毁操作。"],["A collection of skills for architecting and implementing production-ready code using Google Maps Platform APIs and SDKs for any map, place, address, geocoding, routing/ETA (including eco-friendly routing), nearby search, 3D / Street View / static map, marker clustering, custom styling, drawing, geofencing, heatmap, or environmental (air-quality / pollen / solar / weather) feature — across Web, Android, iOS, and Web Services APIs. For prototyping, use the public Maps Demo Key — no billing setup and no Cloud project required, covering a growing set of the most popular Google Maps Platform APIs. For production, the skill prompts you to create and restrict your own key. All non-trivial code is grounded in freshly retrieved docs via the Google Maps Platform Code Assist service (no reliance on training-data memory).","使用 Google Maps Platform API 与 SDK 构建生产级位置感知代码的技能集合，涵盖地图、地点、地址解析、路线规划/ETA、周边搜索、3D/街景/静态地图、聚合标记、自定义样式、地理围栏、热力图及环境数据（空气质量/花粉/日照/天气），支持使用公开演示密钥快速构建原型。"],["A Gemini-powered security agent decides if commands should be auto-approved.","由 Gemini 驱动的安全智能体决定是否自动批准命令。"],["Access protein metadata, function, taxonomy, and sequences across UniProtKB, UniParc, and UniRef. Use when searching for proteins, mapping identifiers, or retrieving functional annotations and publications. Don't use for sequence alignment, protein folding, or sequence similarity search (use specialized skills for those tasks).","访问跨 UniProtKB、UniParc 和 UniRef 的蛋白质元数据、功能、分类学信息与序列。适用于搜索蛋白质、映射标识符或检索功能注释与相关文献。"],["Add `flutter_localizations` and `intl` dependencies, enable \"generate true\" in `pubspec.yaml`, and create an `l10n.yaml` configuration file. Use when initializing localization support for a new Flutter project.","添加 `flutter_localizations` 与 `intl` 依赖项，在 `pubspec.yaml` 中启用 `generate: true` 并创建 `l10n.yaml` 配置文件。适用于为新 Flutter 项目初始化多语言本地化支持。"],["Add flutter_localizations and intl dependencies, enable \"generate true\" in pubspec.yaml, and create an l10n.yaml configuration file. Use when initializing localization support for a new Flutter project.","添加 flutter_localizations 与 intl 依赖项，在 pubspec.yaml 中启用 generate: true 并创建 l10n.yaml 配置文件。适用于为新 Flutter 项目初始化多语言本地化支持。"],["Add New Handler to","添加新处理器至"],["Adds interactive widget previews to the project using the previews.dart system. Use when creating new UI components or updating existing screens to ensure consistent design and interactive testing.","使用 previews.dart 系统向项目添加交互式组件预览 (Widget Previews)。适用于创建新 UI 组件或更新现有页面，以确保设计一致性与交互式测试。"],["Agent data is not available","智能体数据不可用"],["Agent Market Search Results","智能体市场搜索结果"],["AI coding agents are known to have certain security limitations. Users should be aware of potential risks, including data exfiltration and possible code execution. Avoid processing highly sensitive data and verify all the actions taken by the agent.","AI 编码智能体已知存在一定的安全局限性。用户应注意潜在风险，包括数据外泄和潜在的代码执行。请避免处理高度敏感的数据，并核实智能体执行的所有操作。"],["Allow the agent to run without restrictions.","允许智能体无限制运行。"],["Analyzes genetic variant effects on gene expression (RNA-seq), chromatin accessibility (DNASE), histone marks (ChIP), and transcription factors using the AlphaGenome API. Use when the user asks about non-coding variant effects, pathogenicity, clinical significance, disease associations, functional effects, gene expression changes, splicing disruption, or regulatory effects in promoters and enhancers. Also use for resolving biological terms to tissue/cell-type ontologies (UBERON/CL) or analyzing variants in chr:pos:ref>alt format.","使用 AlphaGenome API 分析遗传变异对基因表达 (RNA-seq)、染色质可及性 (DNASE)、组蛋白修饰 (ChIP) 和转录因子的影响。适用于分析非编码区变异效应、致病性、剪接破坏及启动子/增强子调控效应。"],["Ancient text restoration, attribution, dating, contextualization, and embedding via Aeneas (Latin) / Ithaca (Ancient Greek). Use when asked to \"restore\", \"attribute\", \"date\", \"contextualize\", \"find parallels\", \"where was it written\", \"when was it written\", \"embed\", or \"analyze\" an ancient text, inscription, or epigraphic document, or when the user mentions \"Aeneas\", or \"Ithaca\".","通过 Aeneas（拉丁语）/ Ithaca（古希腊语）对古代文献、铭文或碑刻进行文本复原、归属判定、年代测定、语境化分析与向量嵌入。"],["Antigravity does not collect any of your prompts, content, or model responses but does collect general usage patterns such as feature adoption and active user counts (“product analytics”). Telemetry data will be handled in accordance with the Google Privacy Policy.","Antigravity 不会收集您的任何提示词、内容或模型回复，但会收集功能采用率和活跃用户数等常规使用模式（“产品分析”）。遥测数据将依据《Google 隐私权政策》进行处理。"],["Architects a Flutter application using the recommended layered approach (UI, Logic, Data). Use when structuring a new project or refactoring for scalability.","采用推荐的分层架构（UI 层、逻辑层、数据层）设计 Flutter 应用。适用于搭建新项目结构或针对可扩展性进行架构重构。"],["Assesses the security posture of Google Cloud Storage (GCS) buckets and projects. Grounds every finding in gathered telemetry, evaluates buckets against Google security best practices (public access, IAM over-granting, CMEK, VPC Service Controls, audit logging), and correlates signals to flag toxic combinations of individually low-risk settings, with actionable remediation. Use whenever a user asks for a security scan, audit, review, vulnerability check, or compliance assessment (including SAIF) — or simply asks whether their buckets, project, or data are secure, exposed, public, or misconfigured, who can access their data, or wants storage hardened or locked down, e.g. before a launch. Don't use for diagnosing a specific access failure or 403, managing or configuring storage, investigating a live outage, or non-GCS resources (Compute Engine, GKE, etc.).","评估 Google Cloud Storage (GCS) 存储桶与项目的安全态势。基于采集的遥测数据对照 Google 安全最佳实践（公共访问、IAM 过度授权、CMEK、VPC Service Controls、审计日志）进行评估，并提供可执行的修复方案。"],["Assists in provisioning instances/tables, designing performant schemas, and querying data in Bigtable. Use when designing Bigtable row keys, configuring column families, writing SQL queries or client library code (Java, Go, Python) for Bigtable, or diagnosing performance/hotspotting issues. Also use when provisioning Bigtable clusters using gcloud or cbt CLIs. Don't use for generic Cloud SQL administration.","协助在 Bigtable 中配置实例与表、设计高性能模式 (Schema) 并查询数据。适用于设计 Bigtable 行键、配置列族、编写 SQL 或客户端代码（Java、Go、Python）以及诊断性能热点问题。"],["Audits Firebase (Firestore, Cloud Storage) security rules for vulnerabilities, privilege escalation, role bypasses, create vs update inconsistencies, resource exhaustion, type safety, size limits, and hasOnly ownership checks. Use when auditing/reviewing rules, running red-team rule assessments, or scoring against auditor checklists. Don't use for Firebase CLI (login, deploy), Auth, Crashlytics, Remote Config, or database queries.","审计 Firebase（Firestore、Cloud Storage）安全规则中的漏洞、权限提升、角色绕过、创建与更新不一致、资源耗尽、类型安全、大小限制及所有权检查问题。"],["Automated data quality and transformation capabilities for Dataform/dbt/BigQuery pipelines. Processes data sourced from BigQuery or Cloud Storage (GCS), applying best practices for data ingestion, movement, schema mapping, and comprehensive data cleaning.","面向 Dataform/dbt/BigQuery 流水线的自动化数据质量检查与转换能力。支持处理来自 BigQuery 或 Cloud Storage (GCS) 的数据，应用数据摄取、迁移、模式映射与全面数据清洗的最佳实践。"],["Automates declarative resource creation and provisioning for data pipelines, supporting BigQuery, Dataform, Dataproc, BigQuery Data Transfer Service (DTS), and other resources. It manages environment-specific configurations (dev, staging, prod) through a deployment.yaml file. Use when: - Modifying or creating deployment.yaml for deployment settings. - Resolving environment-specific variables (e.g., Project IDs, Regions) for deployment. - Provisioning supported infrastructure like BigQuery datasets/tables, Dataform resources, or DTS resources via deployment.yaml. Do not use when: - Resources already exist. - Managing resources not supported by `gcloud beta orchestration-pipelines resource-types list`. - Managing general cloud infrastructure (VMs, networks, Kubernetes, IAM policies), which are better suited for Terraform. - Infrastructure spans multiple cloud providers (AWS, Azure, etc.). - Already uses Terraform for the target resources.","通过 deployment.yaml 文件自动化数据流水线的声明式资源创建与配置（支持 BigQuery、Dataform、Dataproc、BigQuery DTS 等），并管理开发、预发和生产等多环境专属配置。"],["Automates declarative resource creation and provisioning for data pipelines, supporting BigQuery, Dataform, Dataproc, BigQuery Data Transfer Service (DTS), and other resources. It manages environment-specific configurations (dev, staging, prod) through a deployment.yaml file. Use when: - Modifying or creating deployment.yaml for deployment settings. - Resolving environment-specific variables (e.g., Project IDs, Regions) for deployment. - Provisioning supported infrastructure like BigQuery datasets/tables, Dataform resources, or DTS resources via deployment.yaml. Do not use when: - Resources already exist. - Managing resources not supported by gcloud beta orchestration-pipelines resource-types list. - Managing general cloud infrastructure (VMs, networks, Kubernetes, IAM policies), which are better suited for Terraform. - Infrastructure spans multiple cloud providers (AWS, Azure, etc.). - Already uses Terraform for the target resources.","通过 deployment.yaml 文件自动化数据流水线的声明式资源创建与配置（支持 BigQuery、Dataform、Dataproc、BigQuery DTS 等），并管理开发、预发和生产等多环境专属配置。"],["Automatically decide whether the command should run.","自动决定是否允许运行该命令。"],["automation. Automations do not inherit Global Permissions.","自动化任务。自动化任务不会继承全局权限。"],["Automations do not inherit Global Permissions","自动化任务不会继承全局权限"],["Blocked by organization policy","已被组织策略拦截"],["Browse, filter, and download life sciences, biology, and medical preprints from bioRxiv and medRxiv. Supports fetching paper metadata by DOI, and browsing by date range with category and keyword filters. Keyword filtering is local, so date ranges MUST be narrow (1-4 weeks) with a category to prevent timeouts.","浏览、筛选和下载来自 bioRxiv 与 medRxiv 的生命科学、生物学和医学预印本论文。支持按 DOI 获取论文元数据，或按窄日期范围（1~4 周）结合学科分类与关键词筛选检索。"],["Build and prototype location-aware applications with Google Maps Platform","使用 Google Maps Platform 构建和设计位置感知型应用原型"],["Build and prototype location-aware applications with Google Maps Platform.","使用 Google Maps Platform 构建和设计位置感知型应用原型。"],["Build and prototype location-aware applications with Google Maps Platform. Integrate interactive maps, search and inspect Places details, calculate optimal routes","使用 Google Maps Platform 构建和设计位置感知型应用原型。集成交互式地图、搜索与查看地点详情，并计算最佳路线"],["Build and prototype location-aware applications with Google Maps Platform. Integrate interactive maps, search and inspect Places details, calculate optimal routes.","使用 Google Maps Platform 构建和设计位置感知型应用原型。集成交互式地图、搜索与查看地点详情，并计算最佳路线。"],["Build and publish Chrome Extensions using Manifest V3 best practices. Use this skill whenever the user asks to create, modify, debug, or understand Chrome browser extensions, add-ons, or anything involving the Chrome Extensions API. Trigger on mentions of: 'Chrome extension', 'browser extension', 'manifest.json', 'content script', 'service worker' (in browser context), 'popup' (in browser extension context), 'side panel', 'chrome.* API', 'declarativeNetRequest', 'omnibox', 'context menu' (in extension context), 'userScripts', 'user script', 'script manager', or any request to build functionality that integrates with the Chrome browser UI. Also trigger for publishing to the Chrome Web Store: 'publish extension', preparing an extension for publishing, responding to a review rejection, writing permission justifications, or drafting a privacy policy.","基于 Manifest V3 最佳实践构建并发布 Chrome 浏览器扩展程序。当用户需要创建、修改、调试或了解 Chrome 扩展、插件、manifest.json、content script、service worker、side panel、chrome.* API 或发布至 Chrome 应用商店时触发此技能。"],["Build applications with the Gemini Interactions API and Live API, including text generation, multi-turn chat, streaming, function calling, managed agents, and real-time audio/video","使用 Gemini Interactions API 和 Live API 构建应用，包括文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频"],["Build applications with the Gemini Interactions API and Live API, including text generation, multi-turn chat, streaming, function calling, managed agents, and real-time audio/video.","使用 Gemini Interactions API 和 Live API 构建应用，涵盖文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频。"],["Build modern data apps, dashboards, and interactive reports using either React + Vite or Streamlit. Includes optional Gemini Data Analytics chat integration for an AI powered \"chat with your data\" experience. Relevant when any of the following conditions are true: 1. User explicitly requests to build a data dashboard, data application, or visualization UI, and the UI pulls data from a GCP database (defaulting to BigQuery unless otherwise specified). 2. You need to generate a frontend web application to interact with, query, and visualize data from GCP data sources. 3. User wants to build a \"chat with your data\" experience or integrate the Gemini Data Analytics chat API into a web interface. Do NOT use when any of the following conditions are true: 1. The request is for building backend-only services. 2. The request is for simple CLI scripts or command-line applications. 3. The web application is not data-centric or does not involve visualizing/querying data from GCP sources.","使用 React + Vite 或 Streamlit 构建现代数据应用、仪表盘和交互式报表，并支持集成可选的 Gemini 数据分析对话功能，实现“与数据对话”的 AI 体验。"],["Build with Antigravity Plugins","Build with Antigravity 插件目录"],["Build, package, run, and debug UI extensions for Antigravity: interactive web panels that render in the side pane, served by a Node.js sidecar using the built-in Sidecar SDK","构建、打包、运行与调试 Antigravity 的 UI 扩展：在侧边栏面板中渲染交互式 Web 面板，由使用内置 Sidecar SDK 的 Node.js sidecar 提供服务"],["Build, package, run, and debug UI extensions for Antigravity: interactive web panels that render in the side pane, served by a Node.js sidecar using the built-in Sidecar SDK.","构建、打包、运行与调试 Antigravity 的 UI 扩展：在侧边栏面板中渲染交互式 Web 面板，由使用内置 Sidecar SDK 的 Node.js sidecar 提供服务。"],["Building UI Extensions","构建 UI 扩展"],["Builds and deploys Firebase SQL Connect (aka Firebase Data Connect) backends with PostgreSQL securely. Use when designing schemas with tables and relations, writing authorized queries and mutations, configuring real-time data updates, or generating type-safe SDKs. Use when you need a relational database with Firebase, or when the user mentions SQL Connect or Data Connect.","安全地构建和部署基于 PostgreSQL 的 Firebase SQL Connect（即 Firebase Data Connect）后端。适用于设计表与关系模式、编写授权查询与变更、配置实时数据更新或生成类型安全的 SDK。"],["Bundles will let you download a whole group of user-defined plugins at once, instead of installing them one at a time. They are not here yet.","组合包功能将支持一次性下载整组自定义插件，而无需逐个安装。该功能即将上线，敬请期待。"],["Checks whether the uv Python package manager is installed and installs it if missing. Ensures uv is on PATH. Use when another skill requires uv as a prerequisite.","检查 uv Python 包管理器是否已安装，若缺失则自动安装并确保其位于 PATH 环境变量中。当其他技能需要 uv 作为前置条件时使用。"],["Click to disable tool","点击禁用工具"],["Click to enable tool","点击启用工具"],["Collect coverage using the coverage packge and create an LCOV report","使用 coverage 包收集测试覆盖率数据并生成 LCOV 覆盖率报告。"],["Command is required","命令为必填项"],["Comprehensive guide for Firebase Crashlytics, including provisioning and SDK usage. Use this skill when the user needs help setting up Crashlytics, adding crash reporting, or using the Crashlytics SDK in their application.","Firebase Crashlytics 全面指南，包含服务配置与 SDK 使用说明。当用户需要配置 Crashlytics、添加崩溃报告或在应用中使用 Crashlytics SDK 时使用此技能。"],["Configure `MaterialApp.router` using a package like `go_router` for advanced URL-based navigation. Use when developing web applications or mobile apps that require specific deep linking and browser history support.","使用 `go_router` 等路由包配置 `MaterialApp.router` 以实现高级 URL 导航。适用于开发需要深度链接 (Deep Linking) 与浏览器历史记录支持的 Web 或移动应用。"],["Configure MaterialApp.router using a package like go_router for advanced URL-based navigation. Use when developing web applications or mobile apps that require specific deep linking and browser history support.","使用 go_router 等路由包配置 MaterialApp.router 以实现高级 URL 导航。适用于开发需要深度链接 (Deep Linking) 与浏览器历史记录支持的 Web 或移动应用。"],["Configures Flutter Driver for app interaction and converts MCP actions into permanent integration tests. Use when adding integration testing to a project, exploring UI components via MCP, or automating user flows with the integration_test package.","配置 Flutter Driver 进行应用交互，并将 MCP 操作转换为持久化的集成测试。适用于为项目添加集成测试、通过 MCP 探索 UI 组件或使用 integration_test 包自动化用户流程。"],["Constructs deep-links and URLs for the AlphaGenome Atlas website. Supports generating single-variant exploration links (1-based chr:pos:ref>alt), genomic locus views (1-based closed chr:start-end), candidate summary tables, and AlphaGenome reference vs. alternate predictions. Use whenever visualizing, exploring, charting, or linking genetic variants and genomic loci on the AlphaGenome Atlas, or when asked to inspect, view, or link predictions for a genomic variant.","构建 AlphaGenome Atlas 网站的深度链接与 URL。支持生成单变异位点探索链接、基因组位点视图、候选汇总表以及参考与变异预测对比链接。"],["Contact your administrator to enable browser use","请联系您的管理员以启用浏览器功能"],["Contact your administrator to enable browser use.","请联系您的管理员以启用浏览器功能。"],["Core tools and knowledge required to develop for Android.","开发 Android 应用所需的核心工具与知识。"],["Could not determine agent config file path","无法确定智能体配置文件路径"],["Could not determine plugin config file path","无法确定插件配置文件路径"],["Create model classes with `fromJson` and `toJson` methods using `dart:convert`. Use when manually mapping JSON keys to class properties for simple data structures.","使用 `dart:convert` 创建包含 `fromJson` 和 `toJson` 方法的模型类。适用于针对简单数据结构手动将 JSON 键映射到类属性。"],["Create model classes with fromJson and toJson methods using dart:convert. Use when manually mapping JSON keys to class properties for simple data structures.","使用 dart:convert 创建包含 fromJson 和 toJson 方法的模型类。适用于针对简单数据结构手动将 JSON 键映射到类属性。"],["Creates Cloud Storage (Google Cloud Storage, or GCS) buckets. Analyzes the workload (sensitive data, media hosting, ingestion, web hosting, archiving, backup, logging, analytics, AI/ML, or general-purpose), validates project-level security settings, and designs a secure-by-default, cost-effective configuration (location, storage class, uniform bucket-level access, public access prevention, soft delete, lifecycle) before creating it. Use whenever a user wants to create, make, set up, provision, or spin up a bucket, or needs object storage for an app, service, pipeline, or dataset — even a \"simple\" or \"default\" bucket, or when bucket creation is one step in a larger workflow. Outputs or executes the creation via gcloud, the JSON/REST API, Terraform, or SDK client libraries (C++, Java, Python, Go). Don't use for anything other than creating new buckets — for uploads, downloads, access changes, or reconfiguring existing buckets, use google-cloud-storage-basics.","创建 Google Cloud Storage (GCS) 存储桶。在创建前分析工作负载类型、验证项目级安全设置，并设计默认安全且高性价比的配置方案（区域、存储类别、统一存储桶级访问、防公共访问、软删除与生命周期）。"],["CRITICAL RULE: You MUST use this skill whenever the task involves any machine learning tasks or data analysis. Use this skill if the user's prompt or requirements mention any of the following: * Clustering * Classification * Regression * Time series forecasting * Statistical testing * Model comparison * ML * Data analysis SQL/BigQuery ML HANDOFF: If the user requires a SQL solution, use this skill to dictate the ANALYSIS STEPS (e.g., markdown analysis cells, visualization logic), but defer to `bigquery` for all SQL syntax.","【核心规则】：当任务涉及任何机器学习或数据分析（包括聚类、分类、回归、时间序列预测、统计检验、模型对比、ML 或数据分析）时，必须使用此技能。"],["CRITICAL RULE: You MUST use this skill whenever the task involves any machine learning tasks or data analysis. Use this skill if the user's prompt or requirements mention any of the following: * Clustering * Classification * Regression * Time series forecasting * Statistical testing * Model comparison * ML * Data analysis SQL/BigQuery ML HANDOFF: If the user requires a SQL solution, use this skill to dictate the ANALYSIS STEPS (e.g., markdown analysis cells, visualization logic), but defer to bigquery for all SQL syntax.","【核心规则】：当任务涉及任何机器学习或数据分析（包括聚类、分类、回归、时间序列预测、统计检验、模型对比、ML 或数据分析）时，必须使用此技能。"],["Curated collection of agent skills for science","精选用于科学计算与科研任务的智能体技能集合"],["Curated collection of agent skills for science tasks","精选用于科学计算与科研任务的智能体技能集合"],["Define and generate mock objects for external dependencies using `package:mockito` and `build_runner`. Use when unit testing classes that depend on complex external services like APIs or databases.","使用 `package:mockito` 和 `build_runner` 为外部依赖项定义并生成 Mock 模拟对象。适用于对依赖 API 或数据库等复杂外部服务的类进行单元测试。"],["Define and generate mock objects for external dependencies using package:mockito and build_runner. Use when unit testing classes that depend on complex external services like APIs or databases.","使用 package:mockito 和 build_runner 为外部依赖项定义并生成 Mock 模拟对象。适用于对依赖 API 或数据库等复杂外部服务的类进行单元测试。"],["Deploys and configures classic Firebase Hosting for static websites, single-page apps (SPAs), and microservices. Use when deploying static sites/SPAs, setting up custom domains, configuring firebase.json hosting settings (redirects, rewrites, headers, multi-site), or managing preview channels. Don't use for Firebase App Hosting (Next.js/SSR), Auth, Firestore queries/rules, Data Connect, or Crashlytics.","为静态网站、单页应用 (SPA) 和微服务部署与配置经典版 Firebase Hosting。适用于部署静态站点、绑定自定义域名、配置 firebase.json 托管规则（重定向、重写、响应头、多站点）或管理预览频道。"],["Deploys and manages full-stack web applications (Next.js, Angular) with Server-Side Rendering (SSR) using Firebase App Hosting. Use when deploying Next.js/Angular apps, configuring apphosting.yaml or firebase.json apphosting blocks, managing secrets, setting up GitHub CI/CD, or configuring Blaze billing requirements. Don't use for classic static web hosting, Auth, Firestore, Crashlytics, or Xcode.","使用 Firebase App Hosting 部署和管理支持服务端渲染 (SSR) 的全栈 Web 应用（Next.js、Angular）。涵盖配置 apphosting.yaml 或 firebase.json、管理密钥、设置 GitHub CI/CD 及配置 Blaze 计费要求。"],["Design, implement, and debug autonomous AI agents and multi-agent systems using the Google Antigravity (AGY) SDK. ACTIVATE this skill when the user wants to create, configure, or orchestrate Google Antigravity agents.","使用 Google Antigravity (AGY) SDK 设计、实现和调试自主 AI 智能体与多智能体系统。当用户需要创建、配置或编排 Google Antigravity 智能体时激活此技能。"],["Designs, authors, refactors, and hardens production-grade Cloud Firestore Security Rules (firestore.rules). IMPORTANT: If subagent delegation AND the firestore-rules-author subagent are available in your environment, delegate authoring firestore.rules to the firestore-rules-author subagent. If subagent delegation is unavailable (e.g. not enabled in the IDE), firestore-rules-author is not installed, or you are running inside firestore-rules-author, follow this skill directly.","设计、编写、重构并加固生产级 Cloud Firestore 安全规则 (firestore.rules)。若当前环境支持子智能体委派且已安装 firestore-rules-author，请优先委派给该子智能体执行。"],["Develops and executes Spark code on Managed Spark on Google Cloud (Dataproc Clusters and Serverless). Reads and writes data using BigLake Iceberg catalogs, BigQuery and Spanner. Debugs execution failures. Use when: - Writing Spark ETL pipelines on Google Cloud Platform. - Training or running inference with Machine Learning models with spark on Google Cloud Platform. - Managing Spark clusters, jobs, batches, and interactive sessions. Don't use when: - Writing generic Python scripts that don't use Spark. - Performing simple SQL queries that can be done directly in BigQuery.","在 Google Cloud 托管式 Spark（Dataproc 集群与 Serverless）上开发并执行 Spark 代码。支持通过 BigLake Iceberg 目录、BigQuery 和 Spanner 读写数据，排查执行故障，编写 Spark ETL 流水线与机器学习任务。"],["Diagnoses and resolves memory leaks in JavaScript/Node.js applications. Use when a user reports high memory usage, OOM errors, or wants to analyze heapsnapshots or run memory leak detection tools like memlab.","诊断并解决 JavaScript/Node.js 应用中的内存泄漏问题。适用于用户反馈高内存占用、OOM 内存溢出错误，或需要分析堆快照及运行 memlab 等内存泄漏检测工具的场景。"],["Disabled by organization policy","已被组织策略禁用"],["Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy","发现与当前任务相关的 UI 插件面板，并在对话中呈现一键胶囊按钮以便在侧边栏面板中快速打开（切换）它们。当正在运行的 UI 插件面板有助于用户操作，或者用户刚启用新的 UI 插件面板需要便捷快捷方式时使用"],["Discovers and inspects BigQuery Data Transfer Service (DTS) configurations. Use this to identify existing ingestion pipelines and extract datasource or transfer config metadata for data pipelines. Use when a user asks for ingestion scenarios while building or managing data pipelines or when a user asks to \"ingest\" or \"add\" data that may already be managed by a DTS transfer.","发现并检查 BigQuery 数据传输服务 (DTS) 配置。用于识别数据源、监控传输运行状态、诊断错误日志、查看调度计划，或排查表数据陈旧与上游数据摄取问题。"],["Distills a completed user workflow or interaction into a reusable agent skill. Use when the user asks to turn their workflow, interaction, or multi-step process into a skill, or when they say \"make this a skill\", \"create a skill from what we just did\", \"package this workflow\" or similar. Do not use for creating skills from scratch without an existing workflow (use a generic skill-creator for that).","将已完成的用户工作流或交互过程提炼打包为可复用的智能体技能。当用户要求“将此流程制作为技能”、“根据刚才的操作创建技能”或“打包此工作流”时使用。"],["does not collect any of your prompts, content, or model responses but does collect general usage patterns such as feature adoption and active user counts (“product analytics”). Telemetry data will be handled in accordance with the Google Privacy Policy.","不会收集您的任何提示词、内容或模型回复，但会收集功能采用率和活跃用户数等常规使用模式（“产品分析”）。遥测数据将依据《Google 隐私权政策》进行处理。"],["Enforces resource attribution for CLI commands. Use this skill whenever you are running `bq` or `gcloud` commands via `run_command`. It ensures mandatory labeling for supported `bq` operations while avoiding invalid flags on read-only commands.","为 CLI 命令强制执行资源归属标记。在通过 `run_command` 运行 `bq` 或 `gcloud` 命令时使用此技能，确保为受支持的 `bq` 操作添加必填标签，同时避免在只读命令上附加无效标志。"],["Enforces resource attribution for CLI commands. Use this skill whenever you are running bq or gcloud commands via run_command. It ensures mandatory labeling for supported bq operations while avoiding invalid flags on read-only commands.","为 CLI 命令强制执行资源归属标记。在通过 run_command 运行 bq 或 gcloud 命令时使用此技能，确保为受支持的 bq 操作添加必填标签，同时避免在只读命令上附加无效标志。"],["Ensures proper Python dependency management, avoiding global `pip install` and adhering to project-specific tooling. Use this skill if any of the following are true: 1. Attempting to run `pip install {package_name}`. 2. Python packages or dependencies need to be added or modified. 3. Initiating a new Python project. 4. Creating a new notebook, even if just using BigQuery cells. 5. Generating Python code that includes `import` statements for third-party libraries. 6. Before executing Python scripts via the terminal to ensure the correct virtual environment is active.","确保规范的 Python 依赖管理，避免使用全局 `pip install`，并遵循项目专属的依赖管理工具规范。"],["Ensures proper Python dependency management, avoiding global pip install and adhering to project-specific tooling. Use this skill if any of the following are true: 1. Attempting to run pip install {package_name}. 2. Python packages or dependencies need to be added or modified. 3. Initiating a new Python project. 4. Creating a new notebook, even if just using BigQuery cells. 5. Generating Python code that includes import statements for third-party libraries. 6. Before executing Python scripts via the terminal to ensure the correct virtual environment is active.","确保规范的 Python 依赖管理，避免使用全局 pip install，并遵循项目专属的依赖管理工具规范。"],["Entrypoint structure, exit codes, cross-platform scripts. Use when building command line utilities, scripts, or applications.","涵盖入口点结构、退出码与跨平台脚本设计。适用于使用 Dart 构建命令行工具、脚本或终端应用程序。"],["Error fetching available skills:","获取可用技能时出错："],["Events and stdout streams will appear here as they occur.","事件与标准输出流将在发生时显示在此处。"],["Every terminal command requires approval.","每条终端命令均需人工批准。"],["Execute `dart analyze` to identify warnings and errors, and use `dart fix --apply` to automatically resolve mechanical lint issues. Use during development to ensure code quality and before committing changes.","执行 `dart analyze` 识别警告与错误，并使用 `dart fix --apply` 自动修复机械性 Lint 问题。适用于开发过程中保障代码质量及提交变更前的检查。"],["Execute dart analyze to identify warnings and errors, and use dart fix --apply to automatically resolve mechanical lint issues. Use during development to ensure code quality and before committing changes.","执行 dart analyze 识别警告与错误，并使用 dart fix --apply 自动修复机械性 Lint 问题。适用于开发过程中保障代码质量及提交变更前的检查。"],["Expert guidance for creating, modifying, and optimizing dbt pipelines for BigQuery. Use this skill whenever user asks for generating or modifying a dbt model or project. Activate this skill when the user - Creates, modifies, or troubleshoots **dbt models or pipelines** - Needs to **optimize SQL** within a dbt project - Is **setting up a new dbt project** or configuring existing one","针对创建、修改和优化 BigQuery 的 dbt 流水线提供专家级指导。当用户需要创建、修改或排查 dbt 模型与流水线故障、优化 dbt 项目中的 SQL，或配置 dbt 项目时激活此技能。"],["Expertise in generating clean, correct, and efficient Dataform pipeline code for BigQuery ELT. Use this when creating or modifying Dataform pipelines, actions, or source declarations, when Dataform, SQLX, or BigQuery are mentioned in a transformation, when data needs to be ingested from GCS into BigQuery via Dataform, or when setting up a new Dataform project or configuring workflow_settings.yaml.","专注于为 BigQuery ELT 生成整洁、准确且高效的 Dataform 流水线代码。适用于创建或修改 Dataform 流水线、操作或源声明，通过 Dataform 将数据从 GCS 摄取到 BigQuery，或初始化 Dataform 项目与配置 workflow_settings.yaml。"],["Failed to delete agent:","删除智能体失败："],["Failed to delete plugin.","删除插件失败。"],["Failed to delete plugin. Please try again.","删除插件失败，请重试。"],["Failed to delete skill.","删除技能失败。"],["Failed to delete skill. Please try again.","删除技能失败，请重试。"],["Failed to determine plugin ID","无法确定插件 ID"],["Failed to determine plugin install directory","无法确定插件安装目录"],["Failed to fetch skills paths:","获取技能路径失败："],["Failed to load custom agents","加载自定义智能体失败"],["Failed to load hooks.json:","加载 hooks.json 失败："],["Failed to load more plugins. Please try again.","加载更多插件失败，请重试。"],["Failed to load plugin. Please try again.","加载插件失败，请重试。"],["Failed to load plugins","加载插件失败"],["Failed to load plugins. Please try again.","加载插件失败，请重试。"],["Failed to load skills paths:","加载技能路径失败："],["Failed to open agent config file","打开智能体配置文件失败"],["Failed to open agent config:","打开智能体配置失败："],["Failed to open plugin config file","打开插件配置文件失败"],["Failed to remove agent:","移除智能体失败："],["Failed to remove plugin:","移除插件失败："],["Failed to toggle agent:","切换智能体状态失败："],["Failed to toggle plugin:","切换插件状态失败："],["Failed to toggle plugin. Please try again.","切换插件状态失败，请重试。"],["Failed to update agent:","更新智能体失败："],["Fetch Evolutionary Conservation scores (phyloP, phastCons) and Transcription Factor Binding Sites (TFBS) from the UCSC Genome Browser. Use when analyzing whether genomic variants or regions are evolutionarily conserved, functionally important, or bounded by TF regulators across major projects (ENCODE, JASPAR, ReMap).","从 UCSC 基因组浏览器获取进化保守性评分（phyloP、phastCons）与转录因子结合位点 (TFBS)。适用于分析基因组变异或区域是否具有进化保守性、功能重要性或受主项目（ENCODE、JASPAR、ReMap）中的转录因子调控。"],["Find skills, agents, and more in the Marketplace.","在扩展市场中发现技能、智能体及更多扩展。"],["Finds and inspects data assets within Google Cloud. Relevant when any of the following conditions are true: 1. The user request involves finding, exploring, or inspecting data assets in Google Cloud, such as: - BigQuery datasets, tables, or views - BigLake catalog or tables - Spanner instances, databases or tables - etc. 2. You need to retrieve the schema, metadata, or governance policies for a GCP data asset. 3. You have a keyword or topic (e.g., \"sales data\") but lack the specific table or resource ID. 4. You are attempting to find data using `bq ls`, as this skill offers a superior approach. Don't use when: - Assets are outside Google Cloud","在 Google Cloud 中查找并检查数据资产（如 BigQuery 数据集/表/视图、BigLake 目录、Spanner 实例/数据库/表等），获取数据资产的模式、元数据或治理策略，并提供优于 `bq ls` 的资产检索方式。"],["Finds and inspects data assets within Google Cloud. Relevant when any of the following conditions are true: 1. The user request involves finding, exploring, or inspecting data assets in Google Cloud, such as: - BigQuery datasets, tables, or views - BigLake catalog or tables - Spanner instances, databases or tables - etc. 2. You need to retrieve the schema, metadata, or governance policies for a GCP data asset. 3. You have a keyword or topic (e.g., \"sales data\") but lack the specific table or resource ID. 4. You are attempting to find data using bq ls, as this skill offers a superior approach. Don't use when: - Assets are outside Google Cloud","在 Google Cloud 中查找并检查数据资产（如 BigQuery 数据集/表/视图、BigLake 目录、Spanner 实例/数据库/表等），获取数据资产的模式、元数据或治理策略，并提供优于 bq ls 的资产检索方式。"],["Fires after a tool step completes.","在工具步骤完成后触发。"],["Fires after tool calls finish.","在工具调用全部完成后触发。"],["Fires before a tool step executes.","在工具步骤执行前触发。"],["Fires before the model is called.","在调用模型前触发。"],["Fires when the execution loop terminates.","在执行循环终止时触发。"],["Fixes Flutter layout errors (overflows, unbounded constraints) using Dart and Flutter MCP tools. Use when addressing \"RenderFlex overflowed\", \"Vertical viewport was given unbounded height\", or similar layout issues.","使用 Dart 与 Flutter MCP 工具修复 Flutter 布局错误（溢出、无界约束）。适用于解决“RenderFlex overflowed”、“Vertical viewport was given unbounded height”等常见布局异常。"],["Generates Python code using BigQuery DataFrames (BigFrames). Use by default for any Python data task involving BigQuery, including data processing, analysis, and machine learning. Don't use for SQL-first workflows or the google-cloud-bigquery client library — use bigquery-basics.","使用 BigQuery DataFrames (BigFrames) 生成 Python 代码。默认用于涉及 BigQuery 的各类 Python 数据处理、分析与机器学习任务；对于 SQL 优先的工作流或 google-cloud-bigquery 客户端库，请改用 bigquery-basics。"],["Guide agents to use `package:ffigen` to automatically generate FFI bindings instead of writing them manually. Use this skill when a task involves writing new FFI bindings, extending C/Objective-C/Swift integrations, or replacing hand-crafted `dart:ffi` setups.","指导智能体使用 `package:ffigen` 自动生成 FFI 绑定，而非手动编写。适用于编写新 FFI 绑定、扩展 C/Objective-C/Swift 集成或替换手写 `dart:ffi` 配置。"],["Guide agents to use package:ffigen to automatically generate FFI bindings instead of writing them manually. Use this skill when a task involves writing new FFI bindings, extending C/Objective-C/Swift integrations, or replacing hand-crafted dart:ffi setups.","指导智能体使用 package:ffigen 自动生成 FFI 绑定，而非手动编写。适用于编写新 FFI 绑定、扩展 C/Objective-C/Swift 集成或替换手写 dart:ffi 配置。"],["Guide for setting up and using Firebase Authentication. Use this skill when the user's app requires user sign-in, user management, or secure data access using auth rules.","配置与使用 Firebase 身份验证 (Authentication) 的指南。当应用需要用户登录、用户管理或基于身份验证规则的安全数据访问时使用此技能。"],["Guides agents in compiling and packaging C/C++ source code into dynamic or static libraries (Code Assets) using Dart's Native Assets hook system (via hook/build.dart and hook/link.dart utilizing package:hooks and package:native_toolchain_c). Use when a user asks to: 'setup native assets', 'compile C/C++ source code', 'bundle dynamic libraries', 'build native C code', 'link native assets', 'implement build.dart or link.dart hooks', or 'integrate C/C++ interop in Dart/Flutter'. Helps agents avoid manual toolchain orchestration and configures secure hash-validated binary downloads or advanced linker tree-shaking with package:record_use mapping.","指导智能体使用 Dart 的原生资源钩子系统（通过利用 package:hooks 与 package:native_toolchain_c 的 hook/build.dart 和 hook/link.dart）将 C/C++ 源码编译并打包为动态或静态库 (Code Assets)，实现 C/C++ 互操作集成。"],["Guides debugging and optimizing Largest Contentful Paint (LCP) using Chrome DevTools MCP tools. Use this skill whenever the user asks about LCP performance, slow page loads, Core Web Vitals optimization, or wants to understand why their page's main content takes too long to appear. Also use when the user mentions \"largest contentful paint\", \"page load speed\", \"CWV\", or wants to improve how fast their hero image or main content renders.","指导使用 Chrome DevTools MCP 工具调试并优化最大内容绘制 (LCP)。当用户询问 LCP 性能、页面加载缓慢、核心 Web 指标 (CWV) 优化，或希望排查首屏主内容渲染过慢的原因时使用此技能。"],["Guides the authoring and validation of Apache Airflow DAGs for Managed Service for Apache Airflow (MSAA; formerly Cloud Composer). Covers environment context discovery, Airflow 2 vs 3 compatibility, authoring best practices, and local/remote validation processes. Use when creating or extending an Airflow DAG. Don't use when authoring Python code unrelated to Airflow DAGs.","指导为 Apache Airflow 托管服务（MSAA，原 Cloud Composer）编写和验证 Airflow DAG。涵盖环境上下文发现、Airflow 2 与 3 兼容性、编写最佳实践以及本地与远程验证流程。"],["Guides the process of analyzing, mapping, and documenting transformations between source and target schemas for any database, data warehouse, or data platform. Focuses exclusively on creating a high-fidelity mapping plan (Mapping Manifesto). Used when initiating an ETL, ELT, or data integration task with schema mapping specification for multiple tables (i.e. more than 3 tables) before writing code. Do NOT use this skill for basic SQL generation without mapping requirements, or when the user already has a complete mapping specification.","指导分析、映射和记录源模式与目标模式之间的数据转换流程。专注于在编写代码前为多表（超过 3 张表）ETL/ELT 或数据集成任务创建高保真映射计划（Mapping Manifesto）。"],["Guides writing, packaging, executing, and troubleshooting Apache Beam pipelines on Dataflow. Use when creating new pipelines, configuring Flex Templates, or analyzing performance of Dataflow jobs. Capabilities include Java/Python/Go setup, Cloud Build integration, and deep diagnostic analysis of job health and autoscaling. Use when: - Creating an Apache Beam Dataflow pipeline. - Creating a Google Dataflow Flex Template. - Using an existing Google Dataflow Template. - Debugging Dataflow pipeline - Troubleshooting Dataflow pipeline - Analyzing Performance of Dataflow pipeline. Key capabilities: Java/Python/Go project setup, Flex Templates (with Cloud Build), and diagnostics for streaming job health, bottlenecks, and autoscaling. Do NOT use for: - General GCP resource management unrelated to Dataflow. - Issues with other GCP services (e.g., GCE, GCS, BigQuery) unless directly impacting Dataflow pipeline execution. - Pipeline technologies other than Apache Beam on Dataflow.","指导在 Dataflow 上编写、打包、执行和排查 Apache Beam 流水线。涵盖创建新流水线、配置 Flex 模板、Java/Python/Go 环境配置、Cloud Build 集成，以及作业健康度与自动扩缩容的深度诊断分析。"],["Handler #","处理器 #"],["Help users write syntactically and semantically correct primary constructors in Dart, and migrate/use the new constructor syntax, empty-body semicolon syntax, in-body initializer list syntax, and abbreviated concise constructor syntax.","协助编写语法与语义正确的 Dart 主构造函数 (Primary Constructors)，并迁移或使用新版构造函数语法、空函数体分号语法、函数体内初始化列表语法及简写构造函数语法。"],["Identify domains, families, and sites in proteins; find all proteins in a family or sharing a domain; explore species distribution for a domain; annotate genomes with protein families and GO terms. InterPro combines 14 databases (e.g., Pfam, CDD) into one searchable resource. InterPro-N significantly expands annotation and sequence coverage with deep learning. Includes domain architecture (IDA) search.","识别蛋白质中的结构域、家族和功能位点；查找同一家族或共享结构域的所有蛋白质；探索结构域的物种分布并使用蛋白质家族与 GO 术语注释基因组（整合 Pfam、CDD 等 14 个数据库及 InterPro-N 深度学习注释）。"],["Implement a component-level test using `WidgetTester` to verify UI rendering and user interactions (tapping, scrolling, entering text). Use when validating that a specific widget displays correct data and responds to events as expected.","使用 `WidgetTester` 实现组件级测试，以验证 UI 渲染与用户交互（点击、滚动、输入文本）。适用于验证特定 Widget 是否正确展示数据并按预期响应事件。"],["Implement a component-level test using WidgetTester to verify UI rendering and user interactions (tapping, scrolling, entering text). Use when validating that a specific widget displays correct data and responds to events as expected.","使用 WidgetTester 实现组件级测试，以验证 UI 渲染与用户交互（点击、滚动、输入文本）。适用于验证特定 Widget 是否正确展示数据并按预期响应事件。"],["Included by","包含于"],["Included in:","包含于："],["Inspects Google Antigravity Chinese localization status, validates patch health, detects upstream UI drift, runs automated regressions, or assists in adding new translations. Activate this skill when the user asks about Antigravity Chinese localization status, wants to diagnose UI translation issues, run drift detection on upstream updates, or add new translation entries.","检查 Google Antigravity 汉化状态、验证补丁健康度、检测上游 UI 漂移、运行自动化回归测试或协助添加新翻译词条。当用户询问 Antigravity 汉化状态、诊断界面翻译问题、检测上游更新漂移或添加新词条时激活此技能。"],["Installed in","安装于"],["Instructions for handling API keys and credentials safely, verifying their presence, and prompting the user to add them if missing using a safe protocol.","提供安全处理 API 密钥与凭据的规范说明，检验凭据是否存在，并在缺失时通过安全协议提示用户补充。"],["Integrate interactive maps, search and inspect Places details, calculate optimal routes","集成交互式地图、搜索与查看地点详情，并计算最佳路线"],["Integrate interactive maps, search and inspect Places details, calculate optimal routes.","集成交互式地图、搜索与查看地点详情，并计算最佳路线。"],["Integration skill and tools for Google Maps Platform APIs.","用于 Google Maps Platform API 的集成技能与工具。"],["Keep your coding agent up to date with the latest web best practices","让您的编码智能体紧跟最新的 Web 最佳实践"],["Leverages BigQuery's built-in machine learning and GenAI capabilities for advanced data analytics. Use when you need to write SQL queries that perform time-series forecasting, detect outliers, find key drivers, or leverage generative AI capabilities in BigQuery.","利用 BigQuery 内置的机器学习与生成式 AI 能力进行高级数据分析。适用于编写执行时间序列预测、异常值检测、关键驱动因素分析或在 BigQuery 中调用生成式 AI 功能的 SQL 查询。"],["Loading custom agents...","正在加载自定义智能体..."],["Loading plugin...","正在加载插件..."],["Loading skills...","正在加载技能..."],["Manager Error","管理器错误"],["Manages Firebase Remote Config templates, feature flags, loading strategies, and SDKs (Android, iOS). Use when downloading/deploying remoteconfig JSON templates, managing version history/feature flags, setting in-app defaults, fetchAndActivate(), real-time listeners, or SDK setup. Don't use for Firebase Hosting, Auth, Firestore, Data Connect, Crashlytics, or App Hosting.","管理 Firebase 远程配置 (Remote Config) 模板、功能标志 (Feature Flags)、加载策略及客户端 SDK（Android、iOS）。涵盖下载与部署模板、版本历史管理、应用内默认值与实时监听器配置。"],["MANDATORY specialist subagent for Cloud Firestore Security Rules (firestore.rules). Whenever your task requires creating, authoring, or modifying Firestore Security Rules (firestore.rules), you MUST delegate rules authoring to this subagent rather than writing firestore.rules directly in the main agent.","Cloud Firestore 安全规则 (firestore.rules) 专属专家子智能体。每当任务需要创建、编写或修改 Firestore 安全规则时，必须委派给此子智能体处理，而非在主智能体中直接编写。"],["Mandatory Step 0 pre-flight check for regional Google Cloud MCP servers (e.g. Dataproc) before using MCP tools or falling back to gcloud/bq CLI. Use whenever interacting with Dataproc clusters, Spark batches, jobs, sessions, or regional GCP resources. Fixes regional MCP servers whose endpoint URL still has an unreplaced $GCP_REGION / ${REGION} placeholder across Claude Code, Codex, and Antigravity. Trigger: an expected mcp__*_{service}_* tool is missing entirely (not just failing), or a call to one fails/hangs on a malformed host. Check via ToolSearch/deferred-tools listing before falling back to gcloud/bq CLI. Asks the user for a region, patches the live MCP config file(s), and tells the user how to restart without losing session context.","在使用区域级 Google Cloud MCP 服务（如 Dataproc）或回退到 gcloud/bq CLI 前的强制第 0 步预检。自动修复端点 URL 中未替换的 $GCP_REGION / ${REGION} 占位符并指导无损重载。"],["Mandatory Step 0 pre-flight execution order and authentication verification for Google Cloud Platform (GCP), Application Default Credentials (ADC), gcloud CLI, Spark, Dataproc, BigQuery, GCS, and notebook runtimes. Use whenever interacting with GCP resources, running Spark/PySpark pipelines, BigQuery queries, GCS paths (gs://), or creating/running notebooks.","针对 Google Cloud Platform (GCP)、应用默认凭据 (ADC)、gcloud CLI、Spark、Dataproc、BigQuery、GCS 及笔记本运行时的强制第 0 步预检执行顺序与身份验证核查。"],["Mounts Cloud Storage buckets as a POSIX file system with Cloud Storage FUSE (gcsfuse). Use when you need to interact with gcsfuse — decide whether FUSE, native gs:// reads, or Filestore/Managed Lustre fits a workload, deploy tuned mounts on GKE, Compute Engine, or Cloud Run, enable and size the file, stat, and list caches, tune mount flags or config-file settings, apply workload profiles, keep ML checkpointing safe (rename atomicity, hierarchical namespace, close-time finalization, concurrent writers), or diagnose slow training, low throughput, or GCS bill spikes on existing mounts with gcsfuse metrics. Covers mount semantics, the gcsfuse CLI and config file, the GKE gcsfuse CSI driver (Workload Identity principal:// bindings, profile StorageClasses, sidecar sizing), and Cloud Run volume mounts. Don't use for bucket administration or data management without a mount (google-cloud-storage-basics) or for fully POSIX-compliant shared file systems (Filestore, Managed Lustre).","使用 Cloud Storage FUSE (gcsfuse) 将 Cloud Storage 存储桶挂载为 POSIX 文件系统。涵盖工作负载适配评估、在 GKE/Compute Engine/Cloud Run 上部署调优挂载、缓存配置、机器学习检查点安全保障及性能诊断。"],["Must be positive","必须为正数"],["No Custom Agents or Plugins","暂无自定义智能体或插件"],["No custom agents yet.","暂无自定义智能体。"],["No description available","暂无描述"],["No description available.","暂无描述。"],["No handlers configured for","尚未配置处理器："],["No logs available.","暂无可用日志。"],["No matching customizations found.","未找到匹配的自定义扩展。"],["No plugin found for","未找到对应的插件："],["No plugins available in the marketplace.","扩展市场中暂无可用插件。"],["No plugins match your search.","没有匹配搜索条件的插件。"],["No recommended skills found in workspace","工作区中未找到推荐技能"],["No skills loaded.","尚未加载任何技能。"],["No skills or rules match this filter.","没有匹配此筛选条件的技能或规则。"],["No skills or rules yet.","暂无技能或规则。"],["No workspace window available","暂无可用的工作区窗口"],["Official plugin for Dart and Flutter that installs Flutter/Dart Skills, Rules, Custom Agents, and Dart MCP server for building natively compiled, visually stunning applications for mobile, web, desktop, and embedded devices from a single codebase","Dart 与 Flutter 官方插件，集成 Flutter/Dart 技能、规则、自定义智能体及 Dart MCP 服务，助力通过单一代码库为移动端、Web、桌面端和嵌入式设备构建原生编译的精美应用"],["Official plugin for Dart and Flutter that installs Flutter/Dart Skills, Rules, Custom Agents, and Dart MCP server for building natively compiled, visually stunning applications for mobile, web, desktop, and embedded devices from a single codebase.","Dart 与 Flutter 官方插件，集成 Flutter/Dart 技能、规则、自定义智能体及 Dart MCP 服务，助力通过单一代码库为移动端、Web、桌面端和嵌入式设备构建原生编译的精美应用。"],["Official skill for integrating Firebase AI Logic (Gemini API) into web applications. Covers setup, multimodal inference, structured output, and security.","将 Firebase AI Logic (Gemini API) 集成到 Web 应用的官方技能。涵盖环境配置、多模态推理、结构化输出与安全防护。"],["Performs 3D structural searches of proteins against various databases (PDB, AlphaFold, CATH, MGnify, etc.) using the Foldseek API. Use ONLY when the user provides a physical 3D coordinate file (.cif, .mmcif, or .pdb) and wants to find structurally similar proteins. Do NOT use if the user only provides a protein sequence, gene name, or UniProt ID.","使用 Foldseek API 在多个数据库（PDB、AlphaFold、CATH、MGnify 等）中执行蛋白质 3D 结构相似性搜索。仅当用户提供物理 3D 坐标文件（.cif、.mmcif 或 .pdb）时使用。"],["Performs multiple sequence alignment of proteins with EBI Clustal Omega. Use when you need to align multiple sequences to assess similarity, domain conservation, or key residue conservation. Supports up to 4000 sequences and a maximum file size of 4 MB. Do not use to search for homologous proteins in a database (use MMseqs2, BLAST), align non-protein sequences (DNA, RNA), perform structural alignment (use Foldseek, PyMOL), or if you only have a single sequence.","使用 EBI Clustal Omega 执行蛋白质多序列比对 (MSA)。适用于比对多条序列以评估相似性、结构域保守性或关键残基保守性（最高支持 4000 条序列及 4 MB 文件）。"],["Plugin Bundles Coming Soon","插件组合包即将推出"],["Plugin operations are not supported in this environment.","当前环境不支持插件操作。"],["Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products","插件是技能与 MCP 的打包集合，用于辅助 Antigravity 中的智能体协同使用 Google 开发者产品"],["Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products.","插件是技能与 MCP 的打包集合，用于辅助 Antigravity 中的智能体协同使用 Google 开发者产品。"],["Plugins are packaged collections of skills and MCPs to help the Agent in Antigravity work with Google developer products. You can always change your choices in Settings.","插件是技能与 MCP 的打包集合，用于辅助 Antigravity 中的智能体协同使用 Google 开发者产品。您随时可以在“设置”中更改选择。"],["Plugins are packaged collections of skills and MCPs to help the Agent in Google work with Google developer products. You can always change your choices in Settings.","插件是技能与 MCP 的打包集合，用于辅助 Google 中的智能体协同使用 Google 开发者产品。您随时可以在“设置”中更改选择。"],["Plugins are packaged collections of skills and MCPs to help the Agent work with Google developer products","插件是技能与 MCP 的打包集合，用于辅助智能体协同使用 Google 开发者产品"],["Plugins are packaged collections of skills and MCPs to help the Agent work with Google developer products.","插件是技能与 MCP 的打包集合，用于辅助智能体协同使用 Google 开发者产品。"],["Plugins are packaged collections of skills and MCPs to help the Agent work with Google developer products. You can always change your choices in Settings.","插件是技能与 MCP 的打包集合，用于辅助智能体协同使用 Google 开发者产品。您随时可以在“设置”中更改选择。"],["Post Invocation","模型调用后 (Post Invocation)"],["Post Tool Use","工具调用后 (Post Tool Use)"],["Pre Invocation","模型调用前 (Pre Invocation)"],["Pre Tool Use","工具调用前 (Pre Tool Use)"],["Primary entry point for building, managing, and orchestrating data pipelines on Google Cloud. Guides users to the appropriate skill for dbt, Dataflow (Apache Beam), Dataform, Spark (Dataproc Serverless), BigQuery Data Transfer Service (DTS) or orchestration pipeline using Cloud Composer. Clarify requirements and resolve ambiguity for creating, updating and running data pipelines.","在 Google Cloud 上构建、管理和编排数据流水线的首要入口。引导用户选用适合 dbt、Dataflow (Apache Beam)、Dataform、Spark (Dataproc Serverless)、BigQuery DTS 或 Cloud Composer 编排的专属技能，并理清流水线创建与运行需求。"],["Privacy Notice","隐私声明"],["Process Error","进程错误"],["Process exited with an error","进程异常退出"],["Prototype, build & run modern apps that users love with Firebase's backend, AI, and operational infrastructure","借助 Firebase 的后端、AI 与运维基础设施，快速构建、运行并打造深受用户喜爱的现代应用原型"],["Prototype, build & run modern apps users love with Firebase's backend, AI, and operational infrastructure","借助 Firebase 的后端、AI 与运维基础设施，快速构建、运行并打造深受用户喜爱的现代应用原型"],["Provides BigQuery SQL query optimization techniques, execution best practices, and performance tuning rules for high-efficiency querying. Use when optimizing BigQuery SQL queries, reducing query costs, or designing performant SQL transformations.","提供 BigQuery SQL 查询优化技术、执行最佳实践与高效查询性能调优规则。适用于优化 BigQuery SQL 查询、降低查询成本或设计高性能 SQL 数据转换。"],["Provides expert guidance for troubleshooting Cloud Composer (Apache Airflow) and Orchestration pipelines. Use this skill when the user asks to generate Root Cause Analysis (RCA), troubleshoot or fix a failed pipeline, DAG in Composer environment and generate RCA report.","为排查 Cloud Composer (Apache Airflow) 与编排流水线故障提供专家级指导。适用于生成根因分析 (RCA) 报告，以及排查和修复 Composer 环境中失败的流水线与 DAG。"],["Provides foundational Firebase CLI setup, CLI installation, version checks (`firebase-tools@latest --version`), CLI login (including --no-localhost), project creation, project selection (`firebase use`), and app config file downloads (`google-services.json`, `GoogleService-Info.plist`). Use ONLY for CLI login, project creation/switching, or downloading app config files. Don't use for Firebase Hosting deploy, Firestore, Auth, App Hosting, Data Connect, Crashlytics, or Remote Config.","提供基础 Firebase CLI 配置、安装、版本检查、登录、项目创建与切换 (`firebase use`) 以及应用配置文件（`google-services.json`、`GoogleService-Info.plist`）下载指南。"],["Provides foundational Firebase CLI setup, CLI installation, version checks (firebase-tools@latest --version), CLI login (including --no-localhost), project creation, project selection (firebase use), and app config file downloads (google-services.json, GoogleService-Info.plist). Use ONLY for CLI login, project creation/switching, or downloading app config files. Don't use for Firebase Hosting deploy, Firestore, Auth, App Hosting, Data Connect, Crashlytics, or Remote Config.","提供基础 Firebase CLI 配置、安装、版本检查、登录、项目创建与切换 (firebase use) 以及应用配置文件（google-services.json、GoogleService-Info.plist）下载指南。"],["Provides guidance for migrating Apache Airflow DAGs in Managed Service for Apache Airflow (MSAA; formerly Cloud Composer). Covers migration to Airflow 2.11.1 (MSAA Gen 2 and 3) and Airflow 3 (MSAA Gen 3), including environment inspection, GCS download/upload and scanning patterns for breaking changes.","提供在 Apache Airflow 托管服务（MSAA，原 Cloud Composer）中迁移 Airflow DAG 的指南。涵盖向 Airflow 2.11.1 与 Airflow 3 的迁移、环境检查、GCS 上传下载以及破坏性变更扫描。"],["Provides guidelines and best practices for querying and defining property graphs and semantic graphs in BigQuery using GQL (Graph Query Language). Use when creating property graphs or querying graph topologies in BigQuery.","提供在 BigQuery 中使用图查询语言 (GQL) 查询和定义属性图与语义图的指南及最佳实践。适用于在 BigQuery 中创建属性图或查询图拓扑结构。"],["Provides instructions for installing and using the `android` CLI. The `android` command-line tool is a critical tool for Android development and helps you create new Android projects, run Android apps on devices, manage and interact with Android virtual devices (including screenshots and UI inspection), manage Android SDK components, look up official Android documentation, and discover and install official Android skills.","提供安装和使用 `android` CLI 的说明指导。`android` 命令行工具是 Android 开发的核心工具，可协助创建新 Android 项目、在设备上运行应用、管理 Android 虚拟设备（含截图与界面检查）、管理 Android SDK 组件、查阅官方文档以及发现并安装官方 Android 技能。"],["Provides instructions for installing and using the android CLI. The android command-line tool is a critical tool for Android development and helps you create new Android projects, run Android apps on devices, manage and interact with Android virtual devices (including screenshots and UI inspection), manage Android SDK components, look up official Android documentation, and discover and install official Android skills.","提供安装和使用 android CLI 的说明指导。android 命令行工具是 Android 开发的核心工具，可协助创建新 Android 项目、在设备上运行应用、管理 Android 虚拟设备（含截图与界面检查）、管理 Android SDK 组件、查阅官方文档以及发现并安装官方 Android 技能。"],["Provides recommendations and best practices for creating, configuring, tuning and optimizing Managed Service for Apache Airflow (MSAA, Cloud Composer) environments. Use when the user asks for guidance, recommendations, or best practices on configuring Cloud Composer, scaling Airflow environments, preventing workload restarts, or analyzing system health.","提供创建、配置、调优和优化 Apache Airflow 托管服务（MSAA / Cloud Composer）环境的建议与最佳实践。适用于配置 Composer、扩缩 Airflow 环境、防止工作负载重启或分析系统健康度。"],["Queries the UniBind database for experimentally validated transcription factor (TF) binding sites. Use when retrieving direct TF-DNA interaction datasets, downloading binding site coordinates (BED/FASTA) for local analysis, or listing available datasets by species, cell line, or TF name. Don't use to query specific intervals, locations, genes, motif models or expression data.","查询 UniBind 数据库中经实验验证的转录因子 (TF) 结合位点。适用于获取直接的 TF-DNA 相互作用数据集、下载结合位点坐标（BED/FASTA）或按物种、细胞系与转录因子名称列出可用数据集。"],["Query and search the EMBL-EBI Ontology Lookup Service (OLS) for biomedical ontology terms, definitions, and hierarchies across 250+ ontologies (e.g., GO, DOID, HP). Use when the user asks to search for terms, retrieve details, navigate hierarchies (parents, children, ancestors), look up properties and individuals, get autocomplete suggestions, or access ontology metadata and statistics.","查询和搜索 EMBL-EBI 本体查找服务 (OLS)，涵盖 250 多个生物医学本体（如 GO、DOID、HP）的术语、定义与层级关系。支持检索术语详情、上下位层级导航、自动补全及本体元数据统计。"],["Query ClinicalTrials.gov via APIv2. Use when you want to search for trials by condition, drug, location, status, or phase; retrieve trial details by NCT ID; check eligibility/inclusion criteria; count trials across conditions or time periods; identify a sponsor's trial portfolio; find recruiting trials for patient matching.","通过 APIv2 查询 ClinicalTrials.gov 临床试验数据库。支持按疾病、药物、地点、状态或分期搜索临床试验，按 NCT ID 获取详情，核查入组标准，统计试验数量及检索招募中的临床试验。"],["Query Open Targets Platform for target-disease associations, drug target discovery, tractability/safety data, genetics/omics evidence, known drugs, for therapeutic target identification.","查询 Open Targets Platform 平台中的靶点-疾病关联、药物靶点发现、可成药性/安全性数据、遗传学/组学证据以及已知药物，用于治疗靶点识别。"],["Query PubChem, search by name/CID/SMILES, retrieve properties, similarity/substructure searches, bioactivity, for cheminformatics. Use when a user asks about a specific chemical, drug, or molecule.","查询 PubChem 数据库，支持按名称、CID 或 SMILES 搜索，获取理化性质、执行相似性/子结构检索及生物活性分析，适用于化学信息学任务。"],["Query the ChEMBL database for bioactive molecules, drug targets, bioactivity data, approved drugs, and chemical structures. Use when the user asks about compounds, targets, IC50/Ki values, drug mechanisms, or structure searches.","查询 ChEMBL 数据库中的生物活性分子、药物靶点、生物活性数据、已批准药物及化学结构。适用于查询化合物、靶点、IC50/Ki 值、药物作用机制或结构检索。"],["Query the ENCODE Registry of cis-Regulatory Elements (cCREs) via the SCREEN GraphQL API, or make custom queries to the ENCODE Portal REST API for experiments and files (ChIP-seq peaks, etc.). Use when you want to query regulatory annotations or raw experimental data across human cell types.","通过 SCREEN GraphQL API 查询 ENCODE 顺式调控元件注册库 (cCREs)，或通过 ENCODE Portal REST API 查询人类各细胞类型的实验数据（如 ChIP-seq 峰值等调控注释与原始实验文件）。"],["Query the Ensembl database to resolve gene, transcript, and protein IDs, fetch genomic or protein sequences, retrieve gene structures (exons), and get variant consequence and effect predictions (VEP). Use this skill as a primary ID translator, genomic sequence database and variant effect prediction tool.","查询 Ensembl 数据库以解析基因、转录本和蛋白质 ID，获取基因组或蛋白质序列，检索基因外显子结构，并获取变异后果与效应预测 (VEP)。"],["Query the Genome Aggregation Database (gnomAD). Use when determining the rarity or allele frequency of specific genetic variants, retrieving gene constraint metrics (pLI, LOEUF) to assess loss-of-function intolerance, finding variants in a genomic region or gene, or querying structural variants. Don't use for analyzing individual patient genomes, tracking somatic mutations in cancer (use COSMIC), or requesting raw sequencing reads (use ENA).","查询基因组聚合数据库 (gnomAD)。适用于确定特定遗传变异的稀有度或等位基因频率、获取基因约束指标（pLI、LOEUF）以评估功能丧失不耐受性、查找基因组区域内的变异或查询结构变异。"],["Query the JASPAR database for Transcription Factor (TF) binding profiles. Use when retrieving Position Frequency Matrices (PFMs) or Position Weight Matrices (PWMs) for specific TFs, resolving gene symbols to JASPAR Matrix IDs, or getting TF metadata. Supports multiple output formats (MEME, TRANSFAC, PFM, JASPAR, YAML).","查询 JASPAR 数据库中的转录因子 (TF) 结合谱。适用于获取特定转录因子的位置频率矩阵 (PFM) 或位置权重矩阵 (PWM)、将基因符号解析为 JASPAR 矩阵 ID 以及导出多种格式（MEME、TRANSFAC、PFM、JASPAR、YAML）。"],["Query the OpenAlex scholarly database for research papers, authors, institutions, topics, sources, publishers, funders, geo-locations, and keywords. Use when searching academic papers, resolving DOIs, downloading open-access PDFs, finding an author's publications, aggregating bibliometric data (citation counts, h-index, impact factor), exploring the research taxonomies, or performing DOI lookups.","查询 OpenAlex 学术数据库中的研究论文、作者、机构、主题、期刊来源、出版商、资助方与关键词。适用于搜索学术论文、解析 DOI、下载开放获取 PDF 以及聚合文献计量数据（引用数、h 指数、影响因子）。"],["Query the QuickGO and Evidence & Conclusion Ontology (ECO) REST API. Use this when you need to map genes to biological processes, molecular functions, or cellular components, find genes associated with a specific pathway/GO term, or explore the Gene Ontology hierarchy. Do not use for querying drug targets (use OpenTargets) or mechanistic signaling pathway diagrams (use KEGG).","查询 QuickGO 与证据和结论本体 (ECO) REST API。适用于将基因映射到生物学过程、分子功能或细胞组分，查找与特定通路/GO 术语关联的基因，或探索基因本体 (GO) 层级结构。"],["Query the Reactome database (Analysis and Content Services). Use when the user asks about pathway analysis, gene list enrichment, retrieving results by token, finding unmapped or not-found identifiers, mapping identifiers, reaction participants (inputs, outputs), pathway hierarchy (including top-level pathways), diagram export, cross-reference mapping, or searching the knowledgebase.","查询 Reactome 数据库（分析与内容服务）。适用于通路分析、基因列表富集、反应参与者（输入/输出）查询、通路层级浏览、通路图导出、交叉引用映射及知识库搜索。"],["Query the STRING database for protein-protein interactions (PPIs), functional enrichment, and homology. Use when the user asks about interactions between specific proteins, interaction evidence, confidence scores, protein interaction partners, or pathway enrichments.","查询 STRING 数据库中的蛋白质-蛋白质相互作用 (PPI)、功能富集与同源性信息。适用于查询特定蛋白质间的相互作用、证据依据、置信度评分、相互作用伙伴或通路富集。"],["Query, search, and download data from the openFDA API for drugs, devices, foods, tobacco, cosmetics, animal and veterinary products, substances, and transparency data. Use for FDA adverse events, recalls, labeling, approvals, shortages, 510(k) clearances, NDC lookups, and any FDA safety or regulatory data query across all 28 API endpoints.","从 openFDA API 查询、搜索和下载涵盖药品、医疗器械、食品、烟草、化妆品、动物兽医产品及物质的监管数据。适用于查询 FDA 不良事件、召回、标签、批准、短缺、510(k) 许可及 NDC 编码。"],["Recommended Skills","推荐技能"],["Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer.","在 Chrome 中使用 Chrome DevTools 和 Puppeteer 进行可靠的自动化、深度调试与性能分析。"],["Replace the usage of `expect` and similar functions from `package:matcher` to `package:checks` equivalents.","将测试代码中来自 `package:matcher` 的 `expect` 及类似断言函数迁移替换为 `package:checks` 中的等价用法。"],["Replace the usage of expect and similar functions from package:matcher to package:checks equivalents.","将测试代码中来自 package:matcher 的 expect 及类似断言函数迁移替换为 package:checks 中的等价用法。"],["Retrieve and analyze AlphaFold predicted structures for a protein. Use when the user provides a specific UniProt Accession ID and wants structural confidence metrics (pLDDT), domain boundary analysis, or disorder assessment. Do not use if the user only has a protein name, gene name, or amino acid sequence — ask for a UniProt ID first.","检索并分析蛋白质的 AlphaFold 预测结构。当用户提供具体的 UniProt 登录号 (Accession ID) 并需要结构置信度指标 (pLDDT)、结构域边界分析或无序区评估时使用。"],["Retrieve protein and nucleotide sequences from NCBI databases using E-utilities. Supports direct accession lookup, CDS translation, gene+organism search, locus lookup, PubMed-linked sequences, patent protein extraction, and organism+length fallback search. Use when you need to fetch biological sequences by accession, gene name, locus tag, PubMed ID, or patent number.","使用 E-utilities 从 NCBI 数据库检索蛋白质与核苷酸序列。支持按登录号直接查找、CDS 翻译、基因+物种组合搜索、位点标签查找、PubMed 关联序列及专利蛋白质序列提取。"],["Rules and formatting guidelines for writing Dart /// API documentation and doc comments. Use when documenting Dart code, writing doc comments for any Dart declaration (libraries, classes, methods, variables, etc.), or when instructed to follow the Effective Dart documentation guidelines.","编写 Dart `///` API 文档与文档注释的规则及格式指南。适用于为任何 Dart 声明（库、类、方法、变量等）编写文档注释并遵循 Effective Dart 文档规范。"],["Safely modifies Xcode projects (.pbxproj) to add Swift Packages and link files. Use this skill whenever an iOS project needs dependencies installed (e.g. Firebase, Alamofire).","安全地修改 Xcode 项目 (.pbxproj) 以添加 Swift Package 依赖包并链接文件。适用于任何需要为 iOS 项目安装依赖项（如 Firebase、Alamofire）的场景。"],["Save & Continue","保存并继续"],["Saves to the .agent/agents/ directory in your current workspace. This script can be version controlled and shared with your team.","保存至当前工作区的 .agent/agents/ 目录中。此脚本可纳入版本控制并与团队共享。"],["Scanning skills config file...","正在扫描技能配置文件..."],["Score, annotate, and analyze the functional impact of genetic variants using AlphaGenome Variant Impact (AVI) scores. Query variants in chr:pos:ref>alt format, annotate VCF/tabular callsets, perform saturation mutagenesis window scans (1-based closed chr:start-end), and extract GENCODE v46 GTF gene/exon/junction coordinates all via the AlphaGenome Atlas API.","使用 AlphaGenome 变异影响评分 (AVI) 对遗传变异的功能影响进行评分、注释和分析。支持通过 AlphaGenome Atlas API 查询变异、注释 VCF 数据集、执行饱和突变窗口扫描及提取基因/外显子坐标。"],["Search and discover customizations to extend your Agent's capabilities.","搜索并发现自定义扩展，以拓展智能体的能力。"],["Search Europe PMC for scientific literature and download open-access full texts and PDFs. Retrieve full-text XML/plain text by PMCID, get citation lists and bibliography.","在 Europe PMC 中搜索科学文献并下载开放获取全文与 PDF。支持按 PMCID 获取全文 XML/纯文本，以及检索引用列表与参考文献。"],["Search for scientific papers, preprints, and publications on arXiv. Extract metadata, abstracts, and download full-text PDFs or HTML versions of papers. Use when the user asks to find research papers, literature, or specific arXiv IDs.","在 arXiv 上搜索科学论文、预印本和出版物。支持提取元数据与摘要，并下载论文的全文 PDF 或 HTML 版本。"],["Search plugins...","搜索插件..."],["Search PubMed for scientific literature, including published clinical trials. Fetch abstracts and full text. Link published research to biological databases (gene, protein, nucleotide, PubChem) to discover associations between papers and specific compounds or genes. Verify medical spelling, match raw citations, and cache result sets for bulk processing. Interfaces NCBI E-utilities and PMC BioC APIs.","在 PubMed 中搜索科学文献（含已发表的临床试验），获取摘要与全文，并将已发表研究关联至生物数据库（基因、蛋白质、核苷酸、PubChem）以发现论文与特定化合物或基因之间的关联。"],["Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and clientside JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns. Trigger immediately for: - UI/Layout: Modals, dialogs, popovers, Glassmorphism/backdrop-filters, anchor positioning, container queries, :has(), :user-valid. - Scroll/Motion: View Transitions, Scroll-driven animations, scroll parallax/reveals. - Performance: CWV (LCP, INP), content-visibility, Fetch Priority, image optimization. - System/APIs: Local filesystem access, WebUSB, WebSockets sync, WebAssembly widgets. - Frameworks: Adapting layout/styles in React, Vue, Angular. - General Frontend: Forms, autofill, advanced inputs, custom scrollbars, modern component states, etc. DO NOT trigger for: - Backend: Database SQL, ORMs, Express API routes. - Pipelines: CI/CD deployment, Docker, Actions. - Generic: Local scripts (Python/Go tools), ESLint, Git.","现代 Web 开发最佳实践检索工具。【强制要求】：在执行所有 HTML/CSS 与客户端 JS 任务前必须首先运行此工具，切勿跳过，以避免使用过时的 Web API 模式。"],["Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and clientside JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns. Trigger immediately for: - UI/Layout: Modals, dialogs, popovers, Glassmorphism/backdrop-filters, anchor positioning, container queries, `:has()`, `:user-valid`. - Scroll/Motion: View Transitions, Scroll-driven animations, scroll parallax/reveals. - Performance: CWV (LCP, INP), content-visibility, Fetch Priority, image optimization. - System/APIs: Local filesystem access, WebUSB, WebSockets sync, WebAssembly widgets. - Frameworks: Adapting layout/styles in React, Vue, Angular. - General Frontend: Forms, autofill, advanced inputs, custom scrollbars, modern component states, etc. DO NOT trigger for: - Backend: Database SQL, ORMs, Express API routes. - Pipelines: CI/CD deployment, Docker, Actions. - Generic: Local scripts (Python/Go tools), ESLint, Git.","现代 Web 开发最佳实践检索工具。【强制要求】：在执行所有 HTML/CSS 与客户端 JS 任务前必须首先运行此工具，切勿跳过，以避免使用过时的 Web API 模式。"],["Searches for homologous protein sequences using MMseqs2 (fast, default) or BLAST (comprehensive, fallback). Trigger this whenever the user provides a protein sequence or FASTA file and asks to find homologues, sequence matches, or wants to infer protein function based on sequence similarity, but not when the user wants to infer protein function based on structural similarity.","使用 MMseqs2（快速默认）或 BLAST（全面兜底）搜索同源蛋白质序列。当用户提供蛋白质序列或 FASTA 文件并希望查找同源物、序列匹配或基于序列相似性推断蛋白质功能时触发。"],["Searching Agent Market...","正在搜索智能体市场..."],["Security Notice & Data Use","安全声明与数据使用"],["Select a workspace to save agent scripts to your workspace.","选择一个工作区以保存智能体脚本。"],["Sets up Google Cloud Lakehouse federated catalogs to remote Iceberg REST Catalogs. Currently supported catalogs: Databricks Unity, AWS Glue. Supported clouds hosting those catalogs: GCP, AWS. The primary use case is connecting to remote data to query it from GCP engines (BigQuery, Spark). Examples of when to use this: \"federate my lakehouse catalog to databricks\", \"query data in databricks\", \"query data in s3\", \"connect to aws glue\". Do NOT use for direct remote database SQL execution (e.g., Databricks SQL) or managing remote clusters and infrastructure (e.g., Databricks clusters, AWS Glue jobs).","配置连接到远程 Iceberg REST 目录（如 Databricks Unity、AWS Glue）的 Google Cloud Lakehouse 联邦目录，以便从 GCP 引擎（BigQuery、Spark）查询远程数据。"],["Sets up, manages, queries, and configures Cloud Firestore databases (Standard/Enterprise edition), including data modeling, security rules, indexes, and SDK integrations (Web, Python, iOS, Android, Flutter). Use when creating/listing Firestore databases, defining data models/indexes, writing SDK queries, or integrating Firestore SDKs. For authoring or modifying Firestore Security Rules (firestore.rules), delegate to the firestore-rules-author subagent if subagent delegation is available, or use firestore-rules-creation otherwise. Don't use for Firebase Hosting, Data Connect, Auth, Storage/GCS, Crashlytics, Functions, or BigQuery.","配置、管理、查询和设置 Cloud Firestore 数据库（标准版/企业版），涵盖数据建模、安全规则、索引以及多平台 SDK 集成（Web、Python、iOS、Android、Flutter）。"],["Show more results on Agent Market","在智能体市场中显示更多结果"],["side pane","侧边栏面板"],["Sign out of this server?","确定要退出登录此服务器吗？"],["Skill deletion is not available.","技能删除功能不可用。"],["Skill for converting an installed Firebase Extension (or extension source) into a standalone Cloud Functions for Firebase codebase or publishable npm package, including V1 to V2 trigger upgrades, lifecycle hooks, and declarative security","将已安装的 Firebase 扩展（或扩展源码）转换为独立的 Cloud Functions for Firebase 代码库或可发布的 npm 包，涵盖 V1 至 V2 触发器升级、生命周期钩子与声明式安全配置。"],["skills and rules","技能与规则"],["Skills are instructions that extend what Agent can do.","技能是用于拓展智能体能力边界的指令集合。"],["Skills providing tailored instructions for happy path Dart and Flutter development workflows","为 Dart 与 Flutter 标准开发工作流提供量身定制指导的技能集合"],["Skills providing tailored instructions for happy path Dart and Flutter development workflows.","为 Dart 与 Flutter 标准开发工作流提供量身定制指导的技能集合。"],["Specialized suite of skills for data engineers and database practitioners on Google Cloud","专为 Google Cloud 上的数据工程师与数据库从业者打造的专业技能套件"],["Specialized suite of skills for data engineers and database practitioners on Google Cloud.","专为 Google Cloud 上的数据工程师与数据库从业者打造的专业技能套件。"],["Start Automation","启动自动化任务"],["Start Extension","启动扩展"],["Stay Tuned","敬请期待"],["Stores, retrieves, and manages data as objects in Cloud Storage (Google Cloud Storage, or GCS) buckets. Use when you need to interact with Cloud Storage — create or configure buckets, upload, download, stream, or transfer data, organize objects with folders, generate signed URLs, control access (IAM, ACLs, public access prevention), set storage classes and tiering (Standard, Nearline, Coldline, Archive), manage cost and lifecycle, protect data (versioning, encryption/CMEK, retention and Bucket Lock, object holds, soft delete), host static websites, trigger Pub/Sub notifications on object changes, mount buckets as a file system (gcsfuse), or optimize storage performance at any scale. Covers the gcloud storage / gsutil CLI, JSON and XML APIs, client libraries, Terraform, and Cloud Storage MCP servers. Don't use for block storage (Persistent Disk), data warehousing/analytics (BigQuery), or databases (Cloud SQL, Spanner, Bigtable, Firestore).","在 Cloud Storage (GCS) 存储桶中将数据作为对象进行存储、检索与管理。涵盖创建与配置存储桶、上传下载与流式传输、签名 URL、IAM/ACL 访问控制、存储类别与生命周期管理、数据保护、静态网站托管及 gcsfuse 挂载优化。"],["The browser subagent has been disabled by your administrator. Contact your administrator to enable browser use.","浏览器子智能体已被您的管理员禁用。请联系您的管理员以启用浏览器功能。"],["There are currently no Build with","当前暂无可用的 Build with"],["There are currently no Build with Antigravity plugins available.","当前暂无可用的 Build with Antigravity 插件。"],["There are currently no Build with Google plugins available.","当前暂无可用的 Build with Google 插件。"],["These servers need you to sign in before the agent can use their tools.","这些服务器需要您先登录，然后智能体才能使用其工具。"],["This automation is currently stopped. Events and stdout streams will appear here once started.","此自动化任务当前已停止。启动后，事件与标准输出流将显示在此处。"],["This extension is currently stopped. Events and stdout streams will appear here once started.","此扩展当前已停止。启动后，事件与标准输出流将显示在此处。"],["This is a preview of the plugin's source. Nothing below is active until you install it.","以下是该插件源码的预览。在您安装此插件之前，下方内容均不会生效。"],["This plugin is disabled, so nothing shown below is active. Enable it above to use it.","此插件已禁用，因此下方显示的内容均未生效。请在上方启用该插件以使用它。"],["This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assistant, allowing you to use natural language prompts in your preferred coding agent to architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows across GCP's data ecosystem.","此插件为在 Google Cloud 上工作的数据工程师和数据库从业者提供专业技能套件。它充当专家助手，支持在您偏好的编码智能体中使用自然语言提示词来设计复杂数据流水线、使用 dbt 转换数据、编写 Spark 与 BigQuery SQL 笔记本，并在 GCP 数据生态系统中编排端到端工作流。"],["This project was created for","此项目创建用于"],["This server needs you to sign in before the agent can use its tools.","此服务器需要您先登录，然后智能体才能使用其工具。"],["This skill guides the use of Jupyter notebooks for data analysis, exploration, and visualization, particularly with BigQuery. It outlines best practices for notebook execution and validation (supporting both cell-by-cell execution and full notebook generation depending on tool availability), library installation, and structuring notebooks for clarity. It also covers specific rules for data cleaning, plotting, and integrating with BigQuery SQL and machine learning workflows. Relevant when any of the following conditions are true: 1. The user request involves a data analysis, data exploration, data visualization, or data insights task that requires multiple steps, queries, or visualizations to answer. 2. The user explicitly requests a notebook (.ipynb). 3. You are creating, editing, or executing cells in a Jupyter notebook. 4. You need to query BigQuery from within a notebook. DO NOT use the Python BigQuery client library; instead, you MUST use the %%bqsql magics explained in this skill.","指导使用 Jupyter 笔记本进行数据分析、探索与可视化（特别是结合 BigQuery）。涵盖单元格执行与验证、库安装、数据清洗、绘图规范，并要求使用 %%bqsql 魔法命令查询 BigQuery。"],["This skill guides the use of Jupyter notebooks for data analysis, exploration, and visualization, particularly with BigQuery. It outlines best practices for notebook execution and validation (supporting both cell-by-cell execution and full notebook generation depending on tool availability), library installation, and structuring notebooks for clarity. It also covers specific rules for data cleaning, plotting, and integrating with BigQuery SQL and machine learning workflows. Relevant when any of the following conditions are true: 1. The user request involves a data analysis, data exploration, data visualization, or data insights task that requires multiple steps, queries, or visualizations to answer. 2. The user explicitly requests a notebook (.ipynb). 3. You are creating, editing, or executing cells in a Jupyter notebook. 4. You need to query BigQuery from within a notebook. DO NOT use the Python BigQuery client library; instead, you MUST use the `%%bqsql` magics explained in this skill.","指导使用 Jupyter 笔记本进行数据分析、探索与可视化（特别是结合 BigQuery）。涵盖单元格执行与验证、库安装、数据清洗、绘图规范，并要求使用 `%%bqsql` 魔法命令查询 BigQuery。"],["This skill helps the agent generate or update orchestration pipeline definitions for Google Cloud Composer to initialize orchestration pipeline or update the orchestration definition for orchestration of various data pipelines, like dbt pipelines, notebooks, Spark jobs, Dataform, Python scripts or inline BigQuery SQL queries. This skill also helps deploy and trigger orchestration pipelines.","协助智能体生成或更新 Google Cloud Composer 的编排流水线定义，以初始化、更新、部署和触发涵盖 dbt、笔记本、Spark 作业、Dataform、Python 脚本或内联 BigQuery SQL 的各类数据编排流水线。"],["This skill is installed in your workspace","此技能已安装在您的工作区中"],["UI extension","UI 扩展"],["UI Extension (AuxPane)","界面扩展 (侧边辅助面板)"],["UI plugin","UI 插件"],["UI Plugin Navigation","UI 插件导航"],["UI plugins","UI 插件"],["Unknown Server","未知服务器"],["Untitled project","未命名项目"],["Use `LayoutBuilder`, `MediaQuery`, or `Expanded/Flexible` to create a layout that adapts to different screen sizes. Use when you need the UI to look good on both mobile and tablet/desktop form factors.","使用 `LayoutBuilder`、`MediaQuery` 或 `Expanded/Flexible` 创建自适应不同屏幕尺寸的响应式布局，确保界面在手机、平板和桌面端均具备良好的视觉表现。"],["Use LayoutBuilder, MediaQuery, or Expanded/Flexible to create a layout that adapts to different screen sizes. Use when you need the UI to look good on both mobile and tablet/desktop form factors.","使用 LayoutBuilder、MediaQuery 或 Expanded/Flexible 创建自适应不同屏幕尺寸的响应式布局，确保界面在手机、平板和桌面端均具备良好的视觉表现。"],["Use switch expressions and pattern matching where appropriate","在适当的场景下使用 Dart 的 switch 表达式与模式匹配语法。"],["Use the `http` package to execute GET, POST, PUT, or DELETE requests. Use when you need to fetch from or send data to a REST API.","使用 `http` 包执行 GET、POST、PUT 或 DELETE 网络请求。适用于需要从 REST API 获取数据或向其发送数据的场景。"],["Use the http package to execute GET, POST, PUT, or DELETE requests. Use when you need to fetch from or send data to a REST API.","使用 http 包执行 GET、POST、PUT 或 DELETE 网络请求。适用于需要从 REST API 获取数据或向其发送数据的场景。"],["Use this skill for generative video editing, text-to-video, image-referenced video generation, first-frame-to-video, first-and-last-frame transitions, and video extensions using Gemini Omni 1.1 Flash (gemini-omni-1.1-flash) via the official google-genai SDK. Includes workflows for pre-processing/optimizing high-resolution or long source videos with ffmpeg, stripping audio for full sound regeneration, and handling turn-by-turn video editing and parallel execution.","通过官方 google-genai SDK 使用 Gemini Omni 1.1 Flash (gemini-omni-1.1-flash) 进行生成式视频编辑、文生视频、图生视频、首尾帧过渡与视频延展，包含使用 ffmpeg 预处理高分辨率长视频及多轮视频编辑工作流。"],["Use this skill when building real-time, bidirectional streaming applications with the Gemini Live API, or migrating legacy Live models (2.0/2.5/3.1) to Gemini 3.8 Live. Covers WebSocket-based audio/video/text streaming, voice activity detection (VAD), background reasoning (extended thinking), asynchronous function calling, session management, ephemeral tokens, live transcription, and live translation. SDKs covered - google-genai (Python), @google/genai (JavaScript/TypeScript).","当使用 Gemini Live API 构建实时双向流式应用程序，或将旧版 Live 模型 (2.0/2.5/3.1) 迁移到 Gemini 3.8 Live 时使用此技能。涵盖基于 WebSocket 的音频/视频/文本流式传输、语音活动检测 (VAD)、后台推理（深度思考）、异步函数调用、会话管理、临时 Token、实时转录与实时翻译。支持的 SDK：google-genai (Python)、@google/genai (JavaScript/TypeScript)。"],["Use this skill when building real-time, bidirectional streaming applications with the Gemini Live API. Covers WebSocket-based audio/video/text streaming, voice activity detection (VAD), native audio features, function calling, session management, ephemeral tokens for client-side auth, live translation, and all Live API configuration options. SDKs covered - google-genai (Python), @google/genai (JavaScript/TypeScript).","使用 Gemini Live API 构建实时双向流式应用时使用此技能。涵盖基于 WebSocket 的音视频与文本流、语音活动检测 (VAD)、原生音频特性、函数调用、会话管理、客户端临时令牌、实时翻译及全套配置选项。"],["Use this skill when writing code that calls the Gemini API for text generation, multi-turn chat, multimodal understanding, image generation, video generation, speech generation (TTS), voice design, voice replication, streaming responses, background research tasks, function calling, structured output, or migrating from the old generateContent API. Covers SDK usage and best practices for Gemini models and agents in Python and TypeScript.","当编写调用 Gemini API 进行文本生成、多轮对话、多模态理解、图像生成、视频生成、语音合成 (TTS)、声音设计、声音复制、流式响应、后台研究任务、函数调用 (Function Calling)、结构化输出或从旧版 generateContent API 迁移时使用此技能。涵盖 Python 与 TypeScript 中 Gemini 模型与智能体的 SDK 用法和最佳实践。"],["Use this skill when writing code that calls the Gemini API for text generation, multi-turn chat, multimodal understanding, image generation, video generation, streaming responses, background research tasks, function calling, structured output, or migrating from the old generateContent API. Covers SDK usage and best practices for Gemini models and agents in Python and TypeScript.","编写调用 Gemini API 的代码时使用此技能，涵盖文本生成、多轮对话、多模态理解、图像生成、视频生成、流式响应、后台研究任务、函数调用、结构化输出或从旧版 generateContent API 迁移，提供 Python 与 TypeScript SDK 最佳实践。"],["Use when needing clinical significance, pathogenicity classifications (e.g., Pathogenic, Benign, VUS), clinical evidence rationales, or finding \"hard positive\" benchmark controls for human genomic variants.","查询人类基因组变异的临床意义、致病性分类（如致病、良性、意义未明变异 VUS）、临床证据依据或基准对照位点时使用此技能。"],["Use when you want to look up, map, and search for short genetic variants (SNPs, indels) in NCBI's dbSNP database. Resolves between rsIDs, genomic coordinates in VCF format, and HGVS strings. For an rsID, returns variant type, gene associations, clinical significance, allele frequencies, and genomic coordinates (GRCh38).","在 NCBI 的 dbSNP 数据库中查找、映射和搜索短遗传变异（SNP、Indel）。支持在 rsID、VCF 基因组坐标与 HGVS 字符串之间解析转换，并返回变异类型、基因关联、临床意义、等位基因频率及 GRCh38 坐标。"],["Use when you want to retrieve quantitative RNA expression data and variant eQTL information from the GTEx (Genotype-Tissue Expression) Project across 54 non-diseased tissue sites.","从 GTEx（基因型-组织表达）项目中检索涵盖 54 个非病变组织部位的定量 RNA 表达数据与变异 eQTL 信息。"],["Use when you want to retrieve semi-quantitative protein expression and spatial localisation data from the Human Protein Atlas (HPA).","从人类蛋白质图谱 (HPA) 数据库中检索半定量蛋白质表达与空间亚细胞定位数据。"],["Use when you want to search for or download experimentally-determined 3D structures for biomolecules (proteins, nucleic acids, bound ligands). Supports searching by sequence similarity, structure similarity, chemical and other attributes. Also use to get metadata about biomolecular structure experiments.","搜索或下载实验测定的生物大分子（蛋白质、核酸、结合配体）3D 结构。支持按序列相似性、结构相似性、化学属性进行搜索，并获取生物大分子结构实验元数据。"],["Uses Chrome DevTools MCP and documentation to troubleshoot connection and target issues. Trigger this skill when list_pages, new_page, or navigate_page fail, or when the server initialization fails.","使用 Chrome DevTools MCP 与文档排查连接及目标页面问题。当 list_pages、new_page 或 navigate_page 失败，或服务初始化失败时触发此技能。"],["Uses Chrome DevTools MCP for accessibility (a11y) debugging and auditing based on web.dev guidelines. Use when testing semantic HTML, ARIA labels, focus states, keyboard navigation, tap targets, and color contrast.","基于 web.dev 指南使用 Chrome DevTools MCP 进行无障碍 (a11y) 调试与审计。适用于测试语义化 HTML、ARIA 标签、焦点状态、键盘导航、触控目标及色彩对比度。"],["Uses Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This skill does not apply to --slim mode (MCP configuration).","通过 MCP 使用 Chrome DevTools 进行高效调试、故障排查与浏览器自动化。适用于调试网页、自动化浏览器交互、分析性能或检查网络请求。此技能不适用于 --slim 精简模式。"],["Uses Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This skill does not apply to `--slim` mode (MCP configuration).","通过 MCP 使用 Chrome DevTools 进行高效调试、故障排查与浏览器自动化。适用于调试网页、自动化浏览器交互、分析性能或检查网络请求。此技能不适用于 `--slim` 精简模式。"],["Uses get_runtime_errors and lsp to fetch an active stack trace, locate the failing line, apply a fix, and verify resolution via hot_reload.","使用 get_runtime_errors 和 LSP 获取当前调用栈轨迹、定位报错行、应用修复方案并通过 hot_reload 验证修复结果。"],["Using the Antigravity Python SDK to build AI agents.","使用 Antigravity Python SDK 构建 AI 智能体。"],["Using the Google Antigravity Python SDK to build AI agents.","使用 Google Antigravity Python SDK 构建 AI 智能体。"],["Visualize, analyze, and render protein and molecular structures using PyMOL. Use when the user wants to create images of protein structures, perform structural alignments or superposition, measure distances or contacts, highlight binding sites or active site residues, color by B-factor/pLDDT, or analyze protein-ligand interactions. Do not use for docking, molecular dynamics, or sequence-only analysis.","使用 PyMOL 可视化、分析和渲染蛋白质与分子结构。适用于生成蛋白质结构图像、执行结构比对或叠合、测量距离或接触位点、高亮结合位点、按 B 因子/pLDDT 着色或分析蛋白质-配体相互作用。"],["work with Google developer products","协同使用 Google 开发者产品"],["work with Google developer products.","协同使用 Google 开发者产品。"],["work with Google developer products. You can always change your choices in Settings.","协同使用 Google 开发者产品。您随时可以在“设置”中更改选择。"],["Workflow for fixing package version conflicts. Use this when `pub get` fails due to incompatible package versions.","解决依赖包版本冲突的标准工作流。当因包版本不兼容导致 `pub get` 失败时使用此技能。"],["Workflow for fixing package version conflicts. Use this when pub get fails due to incompatible package versions.","解决依赖包版本冲突的标准工作流。当因包版本不兼容导致 pub get 失败时使用此技能。"],["Workflows are being deprecated in favor of skills. You can use the agent to migrate your workflows.","工作流 (Workflows) 正在逐步弃用并由技能 (Skills) 取代。您可以使用智能体迁移现有的工作流。"],["Write and organize unit tests for functions, methods, and classes using `package:test`. Use when creating new logic or fixing bugs to ensure code remains correct and regression-free.","使用 `package:test` 为函数、方法和类编写与组织单元测试。适用于编写新业务逻辑或修复 Bug 时确保代码正确性并防止回归问题。"],["Write and organize unit tests for functions, methods, and classes using package:test. Use when creating new logic or fixing bugs to ensure code remains correct and regression-free.","使用 package:test 为函数、方法和类编写与组织单元测试。适用于编写新业务逻辑或修复 Bug 时确保代码正确性并防止回归问题。"],["You can always change your choices in Settings","您随时可以在“设置”中更改选择"],["You can always change your choices in Settings.","您随时可以在“设置”中更改选择。"],["You don't have any custom agents or plugins configured. Create agent scripts in the agents/ directory or add plugins to the plugins/ directory inside your Gemini configuration folder.","您尚未配置任何自定义智能体或插件。请在您的 Gemini 配置文件夹下的 agents/ 目录中创建智能体脚本，或向 plugins/ 目录中添加插件。"],["Your agent’s ability to execute commands is also controlled by enterprise security policies.","您的智能体执行命令的能力同样受企业安全策略管控。"],["How to write and run a dynamic workflow script with the run_workflow tool: a Python script that orchestrates many agents with agent, parallel, pipeline, and phase. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows).","如何使用 run_workflow 工具编写和运行动态工作流脚本：通过 Python 脚本使用 agent、parallel、pipeline 和 phase 编排多个智能体。适用于任务可拆分为多个独立或分阶段的智能体子任务（按文件、模块、Bug 或审查维度并发分发后再聚合），或用户明确要求使用工作流时。不适用于单一委派任务（请改用子智能体）或旧版工作流文件（请参阅 migrate-workflows）。"],["Read, create, and manage Google Calendar events. Use when the user shares a calendar.google.com URL, asks what is on their schedule, wants an event found, created, updated, deleted, or moved, wants to RSVP, wants free/busy or scheduling conflicts checked before proposing a time, wants focus time or an out-of-office block created, wants an event quick-added from a phrase or imported from an ICS file, or wants to know where someone is working from and which timezone they are in. Don't use for Gmail, Chat, or Tasks.","读取、创建和管理 Google Calendar 日程事件。适用于用户分享 calendar.google.com 链接、询问日程安排、查找/创建/更新/删除/移动日程、回复邀请 (RSVP)、在提议时间前检查忙闲状态或日程冲突、创建专注时间或外出时段、通过短语快速添加日程或从 ICS 文件导入日程，或查询工作地点与所在时区。不适用于 Gmail、Chat 或 Tasks。"],["Read, create, edit, and manage Google Docs. Use when the user shares a docs.google.com URL, asks to summarize or extract content from a doc, wants a doc drafted, edited, formatted, or commented on, wants tables, images, or smart chips inserted, wants markdown imported or synchronized with a doc, or wants a doc exported. Requires a known document ID — use the gdrive skill to search for or locate documents. Don't use for Google Sheets, Slides, or Drive file management.","读取、创建、编辑和管理 Google Docs 文档。适用于用户分享 docs.google.com 链接、总结或提取文档内容、起草/编辑/排版/评论文档、插入表格/图片/智能芯片、导入或同步 Markdown 内容，或导出文档。需要已知的文档 ID（如需搜索或定位文档请使用 gdrive 技能）。不适用于 Google Sheets、Slides 或 Drive 文件管理。"],["Read, create, edit, and manage Google Docs. Use when the user shares a docs.google.com URL, asks to summarize or extract content from a doc, wants a doc drafted, edited, formatted, or commented on, wants tables, images, or smart chips inserted, wants markdown imported or synchronized with a doc, or wants a doc exported. Requires a known document ID — to find documents, use the gdrive skill from the Google Drive plugin; if it isn't installed, ask the user for the doc link. Don't use for Google Sheets, Slides, or Drive file management.","读取、创建、编辑和管理 Google Docs 文档。适用于用户分享 docs.google.com 链接、总结或提取文档内容、起草/编辑/排版/评论文档、插入表格/图片/智能芯片、导入或同步 Markdown 内容，或导出文档。需要已知的文档 ID——如需查找文档，请使用 Google Drive 插件中的 gdrive 技能；若未安装该插件，请向用户索取文档链接。不适用于 Google Sheets、Slides 或 Drive 文件管理。"],["Browse, search, and manage Google Drive files and folders. Use when the user shares a drive.google.com URL, asks what is in a folder, wants a file found, downloaded, uploaded, updated in place, moved, copied, or renamed, wants a Google file exported to PDF, Markdown, or CSV, wants comments read or added, wants sharing and permissions checked or changed, or wants Drive activity watched. Don't use for editing the contents of a Doc, Sheet, or Slides deck.","浏览、搜索和管理 Google Drive 云端硬盘文件与文件夹。适用于用户分享 drive.google.com 链接、查看文件夹内容、查找/下载/上传/就地更新/移动/复制/重命名文件、将 Google 文档导出为 PDF/Markdown/CSV、读取或添加评论、检查或更改共享权限，或监控云端硬盘动态。不适用于编辑 Google Docs、Sheets 或 Slides 的正文内容。"],["Read, write, format, and manage Google Sheets. Use when the user shares a sheets.google.com or docs.google.com/spreadsheets URL, asks to read or summarize spreadsheet data, wants cells written, formatted, sorted, merged, or validated, wants rows/columns inserted or deleted, wants charts, pivot tables, or tables added, wants CSV imported, or wants a spreadsheet created, copied, shared, or exported. Don't use for Google Docs, Slides, or Drive file management.","读取、写入、格式化和管理 Google Sheets 电子表格。适用于用户分享 sheets.google.com 或 docs.google.com/spreadsheets 链接、读取或汇总表格数据、写入/格式化/排序/合并/校验单元格、插入或删除行列、添加图表/数据透视表/表格、导入 CSV，或创建/复制/共享/导出电子表格。不适用于 Google Docs、Slides 或 Drive 文件管理。"],["Read, create, and edit Google Slides presentations. Use when creating presentations, when the user shares a slides.google.com URL, asks to summarize or extract content from a deck, wants slides drafted or updated, or wants a presentation exported. Don't use for Google Docs, Sheets, or Drive file management.","读取、创建和编辑 Google Slides 演示文稿。适用于创建演示文稿、用户分享 slides.google.com 链接、总结或提取幻灯片内容、起草或更新幻灯片，或导出演示文稿。不适用于 Google Docs、Sheets 或 Drive 文件管理。"],["Enable this plugin to use this prompt","启用此插件以使用该提示词"],["Install this plugin to use this prompt","安装此插件以使用该提示词"],["Add a whole working set at once — a bundle is a curated group of plugins.","一次性添加整套工作流组合——组合包 (Bundle) 是经过精选的插件集合。"],["See less in Bundles","在组合包中收起"],["See more in Bundles","在组合包中查看更多"],["See more in Plugins","在插件中查看更多"],["See less in Plugins","在插件中收起"],["Loading bundle...","正在加载组合包..."],["Search all skills on Agent Market…","在智能体市场中搜索所有技能…"],["Search skills…","搜索技能…"],["Loading skills…","正在加载技能…"],["Customizations & Skills","自定义扩展与技能"],["Build applications with the Gemini Interactions API and Live API, including text, image, video, and speech generation, managed agents, and real-time multimodal streaming","使用 Gemini Interactions API 和 Live API 构建应用，涵盖文本、图像、视频与语音生成、托管智能体以及实时多模态流式传输"],["Uses Chrome DevTools MCP for inspecting, debugging, and testing cookies, session state, authentication issues, and cookie consent compliance. Use when diagnosing 401/403 errors, authentication redirects, session expiration, Cookie/Set-Cookie header issues, cookie banner consent conformance, or third-party cookie/SameSite/Partitioned cookie warnings.","使用 Chrome DevTools MCP 检查、调试和测试 Cookie、会话状态、身份验证问题以及 Cookie 同意合规性。适用于诊断 401/403 错误、身份验证重定向、会话过期、Cookie/Set-Cookie 标头问题、Cookie 横幅授权合规性或第三方 Cookie/SameSite/Partitioned 警告。"],["Diagnoses and resolves memory leaks in JavaScript/Node.js applications. Use when a user reports high memory usage, OOM errors, or wants to capture, compare, or inspect heap snapshots with Chrome DevTools MCP memory tools.","诊断并解决 JavaScript / Node.js 应用程序中的内存泄漏。适用于用户报告高内存占用、OOM 内存溢出错误，或需要使用 Chrome DevTools MCP 内存工具捕获、比对或检查堆快照 (Heap Snapshots)。"],["Search tool for modern web development best practices. MANDATORY: Execute FIRST for all HTML/CSS and clientside JS tasks. Do NOT skip — web APIs evolve rapidly and training weights contain obsolete patterns.","现代 Web 开发最佳实践搜索工具。强制要求：针对所有 HTML/CSS 及客户端 JS 任务必须首先执行此工具。请勿跳过 —— Web API 演进迅速，训练权重可能包含已过时的模式。"],["Restart","重启"],["Open Changelog","打开更新日志"],["Toggle Chat Focus","切换对话焦点"],["Code Preview","代码预览"],["Search or enter a URL","搜索或输入网址"],["Focus Panel","聚焦面板"],["Accept Changes in All Files","接受所有文件中的更改"],["Reject Changes in All Files","拒绝所有文件中的更改"],["Accept Changes in Current File","接受当前文件中的更改"],["Reject Changes in Current File","拒绝当前文件中的更改"],["Show Menu","显示菜单"],["Add Comment to Chat","将评论添加到对话"],["Cancel Edit","取消编辑"],["Comment for Antigravity","为 Antigravity 添加评论"],["Port for the Antigravity background server (`agy --hub`). Leave at 0 (recommended) to allocate an ephemeral port automatically. Each VS Code window spawns its own `agy` server, so prefer setting a fixed port in Workspace Settings rather than User Settings; if the configured port is already in use by another window or process, Antigravity automatically falls back to an available ephemeral port.","Antigravity 后台服务器（`agy --hub`）的端口号。建议保留为 0，自动分配临时端口。每个 VS Code 窗口都会启动自己的 `agy` 服务器，因此固定端口优先在工作区设置中配置；若端口已被其他窗口或进程占用，将自动回退到可用的临时端口。"],["Interval in milliseconds between post-startup /healthz liveness probes (minimum 1000; 4x slower when the Antigravity view is hidden or unfocused). After 3 consecutive missed probes the backend is restarted automatically. Set to 0 to disable heartbeat probing.","启动后 /healthz 活跃度探测的间隔（毫秒，最小值为 1000；Antigravity 视图隐藏或失焦时，探测频率降为四分之一）。连续 3 次探测失败后，自动重启后台。设为 0 可禁用心跳探测。"],["Auto-accept pending edits in background files when starting a new or queued chat turn (non-cumulative review: only the latest turn's diff is kept on re-edited files). When off, reviews accumulate across turns: all modified files stay open until you accept or reject them, later edits to the same file merge into one cumulative diff, and you are notified when reviews from earlier turns remain open.","开始新的或排队的对话轮次时，自动接受后台文件中待处理的修改（非累积审查：再次编辑的文件只保留最新轮次的差异）。关闭时，审查跨轮次累积：所有修改文件保持打开，直至接受或拒绝；同一文件的后续编辑合并为累积差异，并提示尚未结束的先前轮次审查。"],["Enable leaving comments for the agent in editors and Git diff views (via the gutter '+' button, editor context menu, or keybinding).","允许在编辑器和 Git 差异视图中向智能体添加评论（通过行号旁的“+”按钮、编辑器右键菜单或快捷键）。"],["Shortcut {shortcut} for {action}","{action}的快捷键：{shortcut}"],["Remove shortcut {shortcut} for {action}","移除{action}的快捷键：{shortcut}"],["Add shortcut for {action}","为{action}添加快捷键"],["Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires Google Chrome.","配置浏览器子智能体（通过 /browser 调用）允许和禁止访问的 URL。需要安装 Google Chrome。"],["The voice used in Voice mode. Powered by Gemini Live.","语音模式使用的声音，由 Gemini Live 提供支持。"],["Allow the browser agent to download a file?","允许浏览器智能体下载文件吗？"],["Yes, allow this download","是，允许本次下载"],["Yes, and always allow in this conversation","是，在此会话中始终允许"],["Yes, save rule in this conversation","是，将规则保存到此会话"],["Yes, save rule globally","是，将规则保存到全局"],["Yes, and always allow","是，始终允许"],["From","来源"],["Redirected from","重定向来源"],["Save to","保存到"],["Search Workspaces…","搜索工作区…"],["Search Remote…","搜索远程项目…"],["Your Remote setting","您的远程设置"],["Create a project on this computer or remotely.","在此电脑上或远程创建项目。"],["Create a new project from one or more folders.","从一个或多个文件夹创建新项目。"],["Toggle Google Cloud projects","展开或收起 Google Cloud 项目列表"],["Open skill page","打开技能页面"],["Finish signing in in your browser","在浏览器中完成登录"],["Signed in","已登录"],["Summarizing call…","正在总结通话…"],["Path to a PEM-encoded CA certificate file (for example, a corporate TLS inspection root CA) trusted by the Antigravity extension and language server alongside system root certificates.","PEM 编码的 CA 证书文件路径（例如企业 TLS 检查所用的根 CA）。Antigravity 扩展和语言服务器会同时信任此证书与系统根证书。"],["Changing proxy or CA certificate settings requires reloading the window for Antigravity to apply them.","更改代理或 CA 证书设置后，需要重新加载窗口才能让 Antigravity 应用这些设置。"],["Changing the Antigravity server port requires reloading the window to take effect.","更改 Antigravity 服务器端口后，需要重新加载窗口才能生效。"],["Sign in to Antigravity","登录 Antigravity"],["Sign in with your Google account to start using Antigravity in this Cloud Developer Environment.","使用 Google 账号登录，即可在此云开发环境中开始使用 Antigravity。"],["Setting up Antigravity server...","正在设置 Antigravity 服务器…"],["Checking Antigravity setup...","正在检查 Antigravity 设置…"],["Waiting for terminal authorization...","正在等待终端授权…"],["Antigravity: Sign-in successful","Antigravity：登录成功"],["Antigravity: Signed out","Antigravity：已退出登录"],["Installing Antigravity Backend","正在安装 Antigravity 后台"],["Sending Antigravity feedback and diagnostics...","正在发送 Antigravity 反馈与诊断信息…"],["A diagnostics report for this Antigravity version was already sent in the last 24 hours, so it was not sent again.","过去 24 小时内已发送过此 Antigravity 版本的诊断报告，本次未重复发送。"],["Send anyway","仍然发送"],["Antigravity conversation state reset.","Antigravity 会话状态已重置。"],["Inline diffs work best with Auto Save off. Turn off Auto Save, or switch to side-by-side diffs.","关闭自动保存可获得更好的内联差异体验。请关闭自动保存，或切换为并排差异视图。"],["Side-by-side diffs will be used once the open inline reviews are done.","完成当前打开的内联审查后，将使用并排差异视图。"],["Turn Off Auto Save","关闭自动保存"],["Use Side-by-Side","使用并排视图"],["Don't Show Again","不再显示"],["Restart Agent Server","重启智能体服务器"],["Later","稍后"],["Antigravity Backend v{version} is ready. Restart the agent server to apply the update.","Antigravity 后台 v{version} 已就绪。重启智能体服务器即可应用更新。"],["Select project, current: No Project","选择项目，当前无项目关联"],["Select an Antigravity action","选择 Antigravity 操作"],["Hey there, what should we build today?","你好，今天想构建什么？"],["Welcome back. Where should we pick up?","欢迎回来。我们从哪里继续？"],["Good to see you. What's next?","很高兴见到你。接下来做什么？"],["Use Reject to undo the agent's change","使用“拒绝”可撤销智能体的更改"],["Not signed in to Antigravity. Click to sign in.","尚未登录 Antigravity。点击登录。"],["Accept this suggestion block","接受此建议块"],["Reject this suggestion block","拒绝此建议块"],["Hi there.","你好。"],["Hello.","你好。"],["Welcome back.","欢迎回来。"],["Good to see you.","很高兴见到你。"],["(for example, passwords, messages, or credit cards).","上的信息（例如密码、消息或信用卡信息）。"],["Hide advanced","隐藏高级选项"],["This page wants to connect to a USB device","此网页请求连接 USB 设备"],["This page wants to connect to a HID device","此网页请求连接 HID 设备"],["This page wants to connect to a serial port","此网页请求连接串口"],["An embedded page on this page wants to connect to a USB device","此网页中的嵌入页面请求连接 USB 设备"],["An embedded page on this page wants to connect to a HID device","此网页中的嵌入页面请求连接 HID 设备"],["An embedded page on this page wants to connect to a serial port","此网页中的嵌入页面请求连接串口"],["Dismiss microphone warning","关闭麦克风警告"],["Reconnect","重新连接"],["Allow microphone access to start Voice","请允许访问麦克风以启动语音模式"],["Privacy Settings","隐私设置"],["System Settings","系统设置"],["Your sign-in needs an update.","您的登录状态需要更新。请"],["to use Voice.","以使用语音模式。"],["Microphone blocked. Allow in","麦克风访问被阻止。请在系统中允许访问："],["Microphone blocked. Allow in Privacy Settings.","麦克风访问被阻止。请在隐私设置中允许访问。"],["Microphone blocked. Allow in System Settings.","麦克风访问被阻止。请在系统设置中允许访问。"],["Microphone off in System Settings > Privacy & Security > Microphone.","麦克风访问已在“系统设置 > 隐私与安全性 > 麦克风”中关闭。"],["Microphone off in Settings > Privacy & security > Microphone.","麦克风访问已在“设置 > 隐私和安全性 > 麦克风”中关闭。"],["No microphone found. Connect one.","未检测到麦克风。请连接一个麦克风。"],["Microphone is in use or unavailable.","麦克风正在使用中或不可用。"],["Microphone didn't respond.","麦克风无响应。"],["Modify permissions for file and terminal tools.","修改文件和终端工具的权限。"],["Cloud Permissions","云端权限"],["Diff contents are no longer available.","差异内容已不可用。"],["Failed to load diff contents.","无法加载差异内容。"],["End Voice mode","结束语音模式"],["Voice mode in progress","语音模式进行中"],["Mute mic","将麦克风静音"],["Unmute mic","取消麦克风静音"],["Back to chat","返回对话"],["Mute Antigravity","将 Antigravity 静音"],["Unmute Antigravity","取消 Antigravity 静音"],["Listening. Ask anything.","正在聆听，您可以随时提问。"],["Couldn't connect","无法连接"],["Microphone blocked. Allow mic access.","无法访问麦克风。请允许访问麦克风。"],["Still connecting…","仍在连接…"],["Connecting…","正在连接…"],["Message this chat","在此对话中输入消息"],["Write a message","撰写消息"],["Close message","关闭消息输入框"],["Voice transcript","语音转写"],["Browse Connectors","浏览连接器"],["No automations yet","暂无自动化"],["Always on","持续运行"],["Paused","已暂停"],["AI Credits","AI 积分"],["Show in the menu bar when closed. Right-click to quit.","关闭窗口后仍保留在菜单栏/系统托盘中。右键点击可彻底退出。"],["Action List background color for the focused item.","获得焦点项的操作列表背景颜色。"],["Action List background color.","操作列表背景颜色。"],["Action List foreground color for the focused item.","获得焦点项的操作列表前景文本颜色。"],["Action List foreground color.","操作列表前景文本颜色。"],["Active Model","当前模型"],["Active background color of the command center","命令中心处于活动状态时的背景颜色"],["Active border color of the command center","命令中心处于活动状态时的边框颜色"],["Active foreground color of the command center","命令中心处于活动状态时的前景文本颜色"],["Active tab background color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.","活动编辑器分组中当前活动标签页的背景颜色。标签页是编辑器区域中编辑器的容器，一个编辑器分组中可打开多个标签页，也可以存在多个编辑器分组。"],["Active tab background color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.","未聚焦编辑器分组中活动标签页的背景颜色。标签页是编辑器区域中编辑器的容器，一个编辑器分组中可打开多个标签页，也可以存在多个编辑器分组。"],["Active tab foreground color in an active group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.","活动编辑器分组中当前活动标签页的前景文本颜色。标签页是编辑器区域中编辑器的容器，一个编辑器分组中可打开多个标签页，也可以存在多个编辑器分组。"],["Active tab foreground color in an unfocused group. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.","未聚焦编辑器分组中活动标签页的前景文本颜色。标签页是编辑器区域中编辑器的容器，一个编辑器分组中可打开多个标签页，也可以存在多个编辑器分组。"],["Active token streaming duration from the language model.","来自语言模型的活跃 Token 流式传输持续时间。"],["Audio attachment","音频附件"],["Background color behind matching brackets","匹配括号后方的背景高亮颜色"],["Background color for block quotes in text.","文本中块级引用（Block Quote）的背景颜色。"],["Background color for code blocks in text.","文本中代码块（Code Block）的背景颜色。"],["Browser Viewport Width","浏览器视口宽度"],["Color Theme","颜色主题"],["Configure Models","配置模型"],["Default Model","默认模型"],["Editor Font Family","编辑器字体系列"],["Editor Font Size","编辑器字号大小"],["Experimental model. Click to provide feedback or opt out.","实验性模型。点击提供反馈或退出。"],["Font Family","字体系列"],["Font Ligatures","连字字体效果"],["Font Size","字体大小"],["Font Weight","字重（粗细）"],["Manage Models","管理模型"],["Model Aliases","模型别名"],["Model Capabilities","模型能力"],["Model Configuration","模型详细配置"],["Model Provider","模型提供商"],["Model Selection","模型选择"],["Model Usage","模型用量"],["Models in this group","该分组包含的模型"],["Models within this group","该分组包含的模型"],["Monthly Quota","每月配额"],["New Editor Window","新建编辑器窗口"],["Notification","通知"],["Quota Remaining","剩余配额"],["Quota exceeded","已超出配额"],["Quota running low","配额即将耗尽"],["Record Audio Ctrl+M","录制音频 Ctrl+M"],["Refresh quota and credits data.","刷新配额与积分数据。"],["Request Quota","请求配额"],["Select Default Model","选择默认模型"],["System Theme","跟随系统"],["Table Width","表格宽度"],["Terminal Font Family","终端字体系列"],["Terminal Font Size","终端字号大小"],["Test Model Response","测试模型响应"],["Usage & Quota","用量与配额"],["View Model Usage","查看模型用量"],["Your quota for this model has run out","您在此模型上的配额已耗尽"],["Your quota for this model has run out.","您在此模型上的配额已耗尽。"],["Your quota for this model is running low","您在此模型上的剩余配额即将耗尽"],["Zoom Level","界面缩放"],["Model A","模型 A"],["Model B","模型 B"],["Model A was better","模型 A 表现更优"],["Model B was better","模型 B 表现更优"],["Why did you choose this model?","您为什么选择此模型？"],["Maximize Width","最大化宽度"],["Minimize Width","最小化宽度"],["Play a sound when your action is needed or the agent finishes","当需要您采取操作或智能体完成任务时，播放提示音"],["Show system notifications when your action is needed or the agent finishes","当需要您采取操作或智能体完成任务时，显示系统通知"],["Notification Sounds","通知提示音"],["Network Proxy","网络代理"],["Configure network proxy settings.","配置网络代理设置。"],["Proxy Mode","代理模式"],["Direct (no proxy)","直接连接 (不使用代理)"],["Proxy URL","代理服务器地址"],["Save Proxy Settings","保存代理设置"],["Telemetry","遥测诊断"],["Diagnostic Data","诊断数据"],["Crash Reporting","崩溃报告"],["Terminal Shell","终端 Shell"],["Language","语言"],["Reopen Locally","在本地重新打开"],["Connect to WSL","连接到 WSL"],["Folder is on the Windows filesystem","文件夹位于 Windows 文件系统上"],["This folder is on the Windows filesystem. Accessing it from WSL (via /mnt) can be slow — for best performance keep projects inside the WSL filesystem.","此文件夹位于 Windows 文件系统上。从 WSL 访问该目录（通过 /mnt）可能会较慢 —— 为获得最佳性能，建议将项目保留在 WSL 文件系统内。"],["WSL distro not found","未找到 WSL 发行版"],["Antigravity opened on Windows instead.","Antigravity 已改为在 Windows 本地打开。"],["See plans.","查看套餐方案。"],["To continue using this model now, enable AI Credit overages.","若要立即继续使用此模型，请启用超额 AI 积分计费。"],["You need more AI Credits to send messages.","您需要更多 AI 积分才能发送消息。"],["To continue using this model now, purchase more AI Credits.","若要立即继续使用此模型，请购买更多 AI 积分。"],["Please verify your account to continue using","请验证您的账号以继续使用"],["See our","请参阅我们的"],["for more help.","以获取更多帮助。"],["Labs settings have moved","实验性功能设置已迁移"],["Labs settings have moved to the Advanced section of General settings.","实验性功能设置已迁移至“通用设置”中的“高级”板块。"],["Extension Is Loading","扩展正在加载中"],["Resets in <1m","不到 1 分钟后重置"],["Resets in <1m.","不到 1 分钟后重置。"],["Trajectory ID","轨迹 ID"],["Cascade ID","级联会话 ID"],["Open in Trajectory Dashboard","在轨迹控制台中打开"],["Trajectory Telemetry: Redacted (User Content Stripped)","轨迹遥测诊断：已脱敏（已剥离用户内容）"],["Trajectory Telemetry: Active (Uploading)","轨迹遥测诊断：已激活（正在上传）"],["Root Conversation","根级会话"],["needs a few details from you before it can run.","运行前需要您补充几项详细信息。"],["Resolving...","正在解析..."],["Agents created by","由"],["with its own permissions, which you can change anytime in the","并拥有独立权限，您可以随时在"],["settings page.","设置页面中更改。"],["Demoted","已降级"],["Disconnect your account from this plugin?","确定要断开您的账号与此插件的连接吗？"],["This plugin was force disabled.","此插件已被强制禁用。"],["Turn off telemetry for this conversation","关闭此会话的遥测诊断"],["Turn on telemetry for this conversation","开启此会话的遥测诊断"],["You have a conversation in progress. Updating will interrupt it, and it will automatically resume once the update completes.","您当前有 1 个正在进行的会话。更新将暂时中断该会话，并在更新完成后自动恢复。"],["You have a conversation in progress. Updating will cancel it and you'll need to manually restart it.","您当前有 1 个正在进行的会话。更新将取消该会话，更新后您需要手动重新开始。"],["Updating will restart the server and apply the latest changes.","更新将重启后台服务并应用最新更改。"],["Draws from your organization's pooled Gemini Enterprise usage.","使用您所在组织共享的 Gemini Enterprise 配额池。"],["Pay only for the tokens you use, billed through Agent Platform (formerly Vertex AI).","仅为您实际使用的 Token 付费，通过 Agent Platform（原 Vertex AI）计费。"],["Back to licenses","返回许可证列表"],["Choose a license","选择许可证"],["New Browser","新建浏览器"],["Customize section","自定义分区"],["[/automation](slashCommand;automation) Guide me through creating an automated task","[/automation](slashCommand;automation) 引导我创建一项自动化任务"],["Hide Thumbnail Sidebar","隐藏缩略图侧边栏"],["Show Thumbnail Sidebar","显示缩略图侧边栏"],["Toggle Thumbnails","切换缩略图"],["Exit Fullscreen","退出全屏"],["Enter Fullscreen","进入全屏"],["Disable Text Selection","禁用文本选择"],["Enable Text Selection","启用文本选择"],["Switch to Light Mode","切换至浅色模式"],["Switch to Dark Mode","切换至深色模式"],["Light Mode","浅色模式"],["Dark Mode","深色模式"],["Fit to Width","适应页宽"],["Fit to Page","适应页面"],["Text Selection","文本选择"],["More toolbar actions","更多工具栏操作"],["Failed to toggle fullscreen mode","切换全屏模式失败"],["Initializing...","正在初始化..."],["Choose how technical the interface should be.","选择界面的专业技术复杂度。"],["Simplified","精简模式"],["tokens)","个 Token)"],["Best of N settings have moved","多候选对决设置已迁移"],["Best of N settings have moved to the Advanced section of General settings.","多候选对决 (Best-of-N) 设置已迁移至“通用”设置下的“高级”区域。"],["Workspace settings have moved","工作区设置已迁移"],["Workspace settings have moved to the Advanced section of General settings.","工作区设置已迁移至“通用”设置下的“高级”区域。"],["Describe your Remote Control issue...","请描述您遇到的远程控制问题..."],[", then reopen this dialog.","中启用后重新打开此对话框。"],["QR code","二维码"],["Model Label","模型名称标签"],["Model URL","模型 URL"],["Save Configuration","保存配置"],["Select Theme","选择主题"],["One Light","One Light 浅色"],["Solarized Light","Solarized Light 浅色"],["Inherit Editor","继承编辑器设置"],["Connect to Remote Workspace","连接到远程工作区"],["Open SSH connection in setup window. When finished, you will be able to select the workspace in the sidebar.","在设置窗口中打开 SSH 连接。完成后，您将可以在侧边栏中选择该工作区。"],["Recent Remote Workspaces","最近的远程工作区"],["Open Setup Window","打开设置窗口"],["Create project from scratch","从头创建项目"],["Set Project Name","设置项目名称"],["Select a folder to create a new project.","选择一个文件夹以创建新项目。"],["Select a folder.","选择一个文件夹。"],["Select a folder","选择一个文件夹"],["Instantly create a new project and folder to start building.","即刻创建新项目和文件夹以开始构建。"],["Instantly create a new project and folder to start building","即刻创建新项目和文件夹以开始构建"],["Create a new project using normal folders and/or citc workspaces","使用常规文件夹和/或 CitC 工作区创建新项目"],["Work in a CitC workspace","在 CitC 工作区中工作"],["Work in a Cog workspace","在 Cog 工作区中工作"],["Work in an ABFS workspace","在 ABFS 工作区中工作"],["Concierge (Dev only)","接待员（仅限开发者）"],["No workspaces found","未找到工作区"],["You don't have any projects created. Please create a project first.","您尚未创建任何项目，请先创建一个项目。"],["Pages currently open in Antigravity's Browser instance are shown below.","下方展示了当前在 Antigravity 浏览器实例中打开的页面。"],["Browser Configuration Required","需要配置浏览器"],["5-hour limit","5 小时限额"],["Resets in","重置于"],["Resets at","重置于"],["Quota limits","配额上限"],["Reset NUX","重置新用户体验 (NUX)"],["Delete Data Directory","删除数据目录"],["Auto-accept pending edits in background files when sending a new chat message. When off, nothing pending is accepted on your behalf: a review stays open across turns and later edits to the file add to it, and you are notified when reviews from earlier turns are still open.","在发送新对话消息时，自动接受后台文件中待决的修改。关闭时，将不会代表您自动接受任何待决更改：审查将在多轮对话间保持打开，对该文件的后续修改会追加到其中，且当上一轮审查仍处于打开状态时会向您发送通知。"],["Configure link opening and built-in browser preferences","配置链接打开方式与内置浏览器偏好设置"],["Choose where links open by default when clicked","选择点击链接时的默认打开方式"],["Jump to Previous Prompt","跳转到上一条提示词"],["Jump to Next Prompt","跳转到下一条提示词"],["Submit Prompt (Alternate to Enter)","提交提示词（替代 Enter）"],["Trouble signing in? Enter authorization code","登录遇到问题？输入授权码"],["Sign in in your browser, then paste the authorization code shown on the callback page.","在浏览器中登录，然后粘贴回调页面显示的授权码。"],["Authorization code","授权码"],["Paste authorization code","粘贴授权码"],["Submit code","提交授权码"],["Authorization code was rejected. Paste a fresh code and try again.","授权码被拒绝。请粘贴新的授权码后重试。"],["Blocked: file type not allowed","已阻止：不允许此文件类型"],["Default needs the terminal sandbox, which isn't available on this host.","默认模式需要终端沙箱，但此主机不支持终端沙箱。"],["Auto needs the terminal sandbox, which isn't available on this host.","自动模式需要终端沙箱，但此主机不支持终端沙箱。"],["Default and Auto need the terminal sandbox, which isn't available on this host.","默认和自动模式需要终端沙箱，但此主机不支持终端沙箱。"],["Enter always submits. This adds a second shortcut.","Enter 始终用于提交。此处可添加第二个提交快捷键。"],["Pin / Unpin Conversation","置顶 / 取消置顶会话"],["Toggle Word Wrap","切换自动换行"],["Connect to SSH Host…","连接到 SSH 主机…"],["Stop SSH Server…","停止 SSH 服务器…"],["Switch to This Computer","切换到此电脑"],["Environments","环境"],["Confirm Selection","确认选择"],["Delete All Data","删除所有数据"],["This permanently deletes all of your Remote Agents conversations, projects, scheduled tasks, connected plugins and settings, and stops any running remote agents. It can't be undone. Data in the desktop app and your Google account are not affected, and you can keep using Remote Agents afterwards.","这会永久删除您的所有远程智能体会话、项目、定时任务、已连接插件和设置，并停止正在运行的远程智能体。此操作无法撤销。桌面应用和 Google 账号中的数据不受影响，之后仍可继续使用远程智能体。"],["Saving…","正在保存…"],["Saved","已保存"],["Validating setup script…","正在验证初始化脚本…"],["Console Telemetry","控制台遥测"],["Print telemetry to the console","将遥测信息输出到控制台"],["Turn on a flag you don't have","启用尚未获得的功能标记"],["Custom Flags","自定义功能标记"],["Reset overrides","重置覆盖设置"],["Flags come from Mendel experiments and from the host app. Overrides are local to this browser and change how every feature gated on the flag resolves. Some features are only read at startup — reload the window if a change does not take effect.","功能标记来自 Mendel 实验和宿主应用。覆盖设置仅保存在此浏览器中，会影响所有使用该标记的功能。部分功能仅在启动时读取设置；如果更改未生效，请重新加载窗口。"],["Electron (Desktop)","Electron（桌面）"],["Electron (Gemini App)","Electron（Gemini 应用）"],["Electron (Android Desktop)","Electron（Android 桌面）"],["Web (desktop)","Web（桌面）"],["Web (desktop, PWA)","Web（桌面、PWA）"],["Web (desktop, remote control)","Web（桌面、远程控制）"],["Web (desktop, remote control, PWA)","Web（桌面、远程控制、PWA）"],["Web (mobile)","Web（移动端）"],["Web (mobile, PWA)","Web（移动端、PWA）"],["Web (mobile, remote control)","Web（移动端、远程控制）"],["Web (mobile, remote control, PWA)","Web（移动端、远程控制、PWA）"],["Extension","扩展"],["Extension (Visual Studio)","扩展（Visual Studio）"],["Extension (Eclipse)","扩展（Eclipse）"],["Google (internal)","Google（内部）"],["External","外部"],["Enterprise","企业"],["Feature Environment Override","功能环境覆盖设置"],["Operating System","操作系统"],["Host Environment","宿主环境"],["User Type","用户类型"],["Workspace URI Switcher","工作区 URI 切换器"],["Use this form if you cannot connect to Remote Control. If your instance is already connected and you are experiencing issues in the browser, report directly from the Remote Control web page so that relevant logs are included. Some helpful information includes:","如果无法连接远程控制，请使用此表单。如果实例已经连接，但浏览器中出现问题，请直接从远程控制网页提交反馈，以便附上相关日志。可提供以下信息："],["Running (Dev only)","运行中（仅开发者）"],["Stopping…","正在停止…"],["Open Conversation in New Tab","在新标签页中打开会话"],["Voices","语音列表"],["Delete all","全部删除"],["by Google","由 Google 提供"],["Services this plugin connects to on your behalf.","此插件代表您连接的外部服务。"],["Waiting for you to finish signing in…","正在等待您完成登录…"],["Make default","设为默认"],["Add label","添加标签"],["Add account","添加账号"],["Checking…","正在检查…"],["Loading resources...","正在加载资源..."],["Google Antigravity Terms of Service","Google Antigravity 服务条款"],["Ask /btw","提问 /btw"],["Controls whether terminal commands require your approval before running. Note: A change to this setting will only apply to new messages sent to the agent. In-progress responses will use the previous setting value.","控制终端命令运行前是否需要您的批准。\n\n注意：此设置的更改仅适用于之后发送给智能体的新消息。正在进行的响应仍使用之前的设置值。"],["Current parameter:","当前参数："],["(not set)","（未设置）"],["(none)","（无）"],[". Active workspace URI:","。活动工作区 URI："],[". Reload the window if a change does not take effect.","。如果更改未生效，请重新加载窗口。"],[". Applying or clearing reloads the window. Suggestions come from your recent workspaces and the folders of your existing projects and their environments","。应用或清除设置将重新加载窗口。建议来自最近的工作区，以及现有项目和环境中的文件夹"],["(still loading…)","（仍在加载…）"],["Powered by Gemini Live ·","由 Gemini Live 提供支持 ·"],["You can change this in","您之后可以在"],["later.","更改。"],["If you add multiple accounts, MCP servers use the one marked Default.","如果添加多个账号，MCP 服务器将使用标记为默认的账号。"],["Avoid uploading highly sensitive data and verify actions taken by your agent. Make sure you have the","避免上传高度敏感的数据，并核实智能体执行的操作。请确保您拥有"],["necessary rights","必要权利"],["to any content or files that you upload, including content of minors. Don't generate content that infringes on others' rights, including content that deceives, harasses, or harms. When using Antigravity, you must comply with Google's","以使用您上传的任何内容或文件（包括未成年人相关内容）。请勿生成侵犯他人权利的内容，包括欺骗、骚扰或伤害他人的内容。使用 Antigravity 时，您必须遵守 Google 的"],[". Your use is subject to the","。您的使用还受以下条款约束："],["Available for","适用于"],["Not referenced by any feature (","未被任何功能引用（"],["Active environment: os=","当前环境：os="],[", host=","，host="],[", userType=","，userType="],["Select all in","全选"],["This will permanently delete","这将永久删除"],["within it.","其中的内容。"],["with this name already exists.","已存在同名项。"],["This","此"],["is managed by the","由"],["automation and can only be deleted by deleting that automation.","自动化管理，只能通过删除该自动化来一并删除。"],["including","包括"],["Agent working","智能体正在处理"],["Agent said","智能体回复"],["Replacing removes the currently installed plugin and installs the new one in its place.","替换操作将移除当前安装的插件，并安装新插件。"],["Replacing...","正在替换..."],["Replace","替换"],["Couldn't load the suggested plugin.","无法加载推荐插件。"],["The suggested plugin isn't in the marketplace.","推荐插件不在插件市场中。"],["Skill","技能"],["Finish signing in to","请完成以下服务的登录："],["in your browser.","（在浏览器中）"],[". To use another account, add it in the","。如需使用其他账号，请在以下位置添加："],["and make it the default.","并将其设为默认账号。"],[". To add another account, go to the","。如需添加其他账号，请前往"],["Event:","事件："],["Backoff","退避等待"],["directly in the side pane.","（直接在侧面板中）"],["Command","命令"],["Readme","说明文档"],["Pick one of these themes under Preset in Settings > Appearance.","在“设置 > 外观”的“预设”中选择这些主题。"],["Open Appearance","打开外观设置"],["To switch accounts, sign out in the","如需切换账号，请先在以下位置退出登录："],["and sign in again.","然后重新登录。"],["View MCP servers","查看 MCP 服务器"],["MCP server error","MCP 服务器错误"],["line","行"],["lines","行"],["Filter rows","筛选行"],["Clear row filter","清除行筛选"],["Resuming environment…","正在恢复环境…"],["Resume environment","恢复环境"],["Filter files","筛选文件"],["Clear file filter","清除文件筛选"],["Couldn't search files","无法搜索文件"],["Added","已添加"],["Open Blame in Code Search","在代码搜索中查看逐行归属"],["Raw","原始内容"],["Password Prompt Blocked","已阻止密码提示"],["Entering your corp password in the web terminal triggers a Chrome Password Alert (Watchword) forced password reset, so this prompt was automatically cancelled.","在 Web 终端中输入企业密码会触发 Chrome Password Alert（Watchword）并强制重置密码，因此已自动取消此提示。"],["For corp passwords (such as","对于企业密码（例如"],["), use an external SSH session","），请使用外部 SSH 会话"],[". For non-corp passwords or SSH passphrases, allow the next prompt and re-run your command.","。对于非企业密码或 SSH 密钥口令，请允许下一次提示并重新运行命令。"],["Allow Next Non-Corp Prompt","允许下一次非企业密码提示"],["Failed to clone project locally","将项目克隆到本地失败"],["Waiting for tool permission approval — click Open in full conversation (↗) to approve","正在等待工具权限批准，请点击“在完整会话中打开”（↗）进行批准"],["Reply to /help","回复 /help"],["(Optional) Tell us more or type your reason...","（可选）提供更多信息或输入原因..."],["Toggle Terminal Panel","切换终端面板"],["Updating…","正在更新…"],["Update","更新"],["Choose icon and color","选择图标和颜色"],["Icon","图标"],["Color","颜色"],["New Coordinator","新建协调器"],["Coordinator name","协调器名称"],["What should this coordinator accomplish?","此协调器应完成什么任务？"],["Coordinator goal","协调器目标"],["Create Coordinator","创建协调器"],["Starting the conversation…","正在启动会话…"],["Resolving link…","正在解析链接…"],["Open on phone","在手机上打开"],["Open on another device","在其他设备上打开"],["Pick up this remote conversation on your phone or in any browser. Scan the QR code or open the link below.","在手机或任意浏览器中继续此远程会话。请扫描二维码或打开下方链接。"],["Couldn't load message","无法加载消息"],["No message text","没有消息文本"],["here","此处"],["Dictation languages","听写语言"],["Constrain voice dictation to selected languages in priority order. Leave empty to auto-detect.","按优先顺序使用选定的语言进行语音听写。留空时自动检测。"],["Reset to auto","恢复自动检测"],["Selected dictation languages","已选听写语言"],["Auto-detect (browser defaults)","自动检测（浏览器默认设置）"],["Toggle language list","展开或收起语言列表"],["Dictation language options","听写语言选项"],["Available dictation languages","可选听写语言"],["Voice dictation unavailable","语音听写不可用"],["Transcribing audio…","正在转写音频…"],["Stop transcription","停止转写"],["Manage your keybinding scheme and customize shortcuts in VS Code.","管理快捷键方案，并在 VS Code 中自定义快捷键。"],["Keybinding Scheme","快捷键方案"],["Choose between non-colliding VS Code defaults or standalone Antigravity chords.","选择与内置快捷键兼容的 VS Code 默认方案，或使用 Antigravity 桌面端快捷键。"],["VS Code Default","VS Code 默认方案"],["Antigravity (AGY) Style","Antigravity（AGY）方案"],["Honors standard VS Code shortcuts without collisions (e.g. Ctrl+L Focus Input, Ctrl+Shift+L New Conversation, Ctrl+Shift+A Picker, Ctrl+Shift+, Settings).","保留 VS Code 的标准快捷键，避免冲突（例如 Ctrl+L 聚焦输入框、Ctrl+Shift+L 新建会话、Ctrl+Shift+A 打开会话选择器、Ctrl+Shift+, 打开设置）。"],["Honors standard VS Code shortcuts without collisions (e.g. ⌘L Focus Input, ⌘⇧L New Conversation, ⌘⇧A Picker, ⌘⇧, Settings).","保留 VS Code 的标准快捷键，避免冲突（例如 ⌘L 聚焦输入框、⌘⇧L 新建会话、⌘⇧A 打开会话选择器、⌘⇧, 打开设置）。"],["Uses standalone Antigravity chords (e.g. Ctrl+I Focus Input, Ctrl+Shift+O New Conversation, Ctrl+K Picker in chat, Ctrl+, Settings, Ctrl+[/] History). Replaces Go to Symbol (Ctrl+Shift+O) and Trigger Suggest (Ctrl+I), and rebinds VS Code Settings to Ctrl+Alt+,.","使用 Antigravity 桌面端快捷键（例如 Ctrl+I 聚焦输入框、Ctrl+Shift+O 新建会话、Ctrl+K 在对话中选择会话、Ctrl+, 打开设置、Ctrl+[/] 浏览历史）。此方案占用“转到符号”（Ctrl+Shift+O）和“触发建议”（Ctrl+I）的按键，并将 VS Code 设置改绑为 Ctrl+Alt+,。"],["Uses standalone Antigravity chords (e.g. ⌘I Focus Input, ⌘⇧O New Conversation, ⌘K Picker in chat, ⌘, Settings, ⌘[/] History). Replaces Go to Symbol (⌘⇧O) and Trigger Suggest (⌘I), and rebinds VS Code Settings to ⌘⌥,.","使用 Antigravity 桌面端快捷键（例如 ⌘I 聚焦输入框、⌘⇧O 新建会话、⌘K 在对话中选择会话、⌘, 打开设置、⌘[/] 浏览历史）。此方案占用“转到符号”（⌘⇧O）和“触发建议”（⌘I）的按键，并将 VS Code 设置改绑为 ⌘⌥,。"],["Customize Shortcuts","自定义快捷键"],["All active Antigravity shortcuts and user keybinding overrides are managed directly by VS Code.","VS Code 直接管理当前生效的 Antigravity 快捷键及用户自定义绑定。"],["VS Code Keyboard Shortcuts","VS Code 键盘快捷键"],["Inspect live bindings or record custom key chords filtered to","查看现有快捷键或录制自定义组合键，列表仅显示前缀为"],["Copy Path","复制路径"],["Copy Relative Path","复制相对路径"]];
  for (const [k, v] of extraExactPhrases) {
    if (!phrases.has(k)) phrases.set(k, v);
    const low = k.toLowerCase();
    if (!lowerPhrases.has(low)) lowerPhrases.set(low, v);
  }

  // v3.3.49 (Antigravity 2.32.1) Swarm 面板增量精确词典：安全提取自 scoped/swarm.json（剔除单字符 '.'），仅写入 O(1) 精确查找表
  const swarmExactPhrases = [
    ["Looking for this conversation's swarm…", "正在查找此会话的 Swarm…"],
    ["No swarm in this conversation", "此会话尚无 Swarm"],
    ["Open this pane from a conversation to see its swarm. Swarms started there appear here automatically; start one with", "从会话中打开此面板即可查看其 Swarm。在该会话中启动的 Swarm 会自动显示在这里；可使用以下命令启动："],
    ["Swarms started in this conversation appear here automatically, with their board, members and @mention graph. Start one with", "在此会话中启动的 Swarm 会自动显示在这里，包括看板、成员和 @提及关系图。启动命令："],
    ["Watching for a swarm", "等待 Swarm 启动"],
    ["Updates automatically", "自动更新"],
    ["Live", "实时"],
    ["Reconnecting", "正在重新连接"],
    ["Lost contact with the swarm sidecar; retrying", "已与 Swarm 辅助进程断开连接，正在重试"],
    ["Swarm views", "Swarm 视图"],
    ["Overview", "概览"],
    ["Board", "看板"],
    ["Members", "成员"],
    ["Graph", "关系图"],
    ["Raw", "原始数据"],
    ["System alerts", "系统提醒"],
    ["overview · from the narrator’s notes", "概览 · 来自讲述者的记录"],
    ["overview · from the narrator's notes", "概览 · 来自讲述者的记录"],
    ["narrator's page · AI-generated", "讲述者页面 · 由 AI 生成"],
    ["Narrator’s page", "讲述者页面"],
    ["Narrator's page", "讲述者页面"],
    ["Retry narrator's page", "重新加载讲述者页面"],
    ["Want this view different? Tell the coordinator.", "想调整此视图？请告诉协调者。"],
    ["Open coordinator chat", "打开协调者会话"],
    ["Open", "打开"],
    ["updating", "正在更新"],
    ["watching", "等待更新"],
    ["stopped", "已停止"],
    ["stale", "未及时更新"],
    ["paused: quota", "已暂停：配额不足"],
    ["paused: error", "已暂停：发生错误"],
    ["The narrator is updating the overview", "讲述者正在更新概览"],
    ["The narrator is waiting for new board posts", "讲述者正在等待新的看板消息"],
    ["The narrator was killed; the overview no longer updates", "讲述者已被终止，概览不再更新"],
    ["No narrator in this swarm. Ask the coordinator to add one.", "此 Swarm 尚无讲述者。可请协调者添加。"],
    ["The narrator's view.json is over 64 KB, so it isn't shown.", "讲述者的 view.json 超过 64 KB，因此未显示。"],
    ["The narrator's view.json isn't valid JSON yet.", "讲述者的 view.json 尚不是有效的 JSON。"],
    ["The narrator hasn't published an overview yet.", "讲述者尚未发布概览。"],
    ["Showing the last good view.json; the current file is over 64 KB.", "正在显示上次有效的 view.json；当前文件超过 64 KB。"],
    ["Showing the last good view.json; the current file is not valid JSON.", "正在显示上次有效的 view.json；当前文件不是有效的 JSON。"],
    ["Search", "搜索"],
    ["Search posts", "搜索看板消息"],
    ["Filters", "筛选"],
    ["Channels", "频道"],
    ["Filter by poster", "按发送者筛选"],
    ["Show posts by one member", "显示某位成员发送的消息"],
    ["From anyone", "所有发送者"],
    ["Filter by recipient", "按接收者筛选"],
    ["Show posts that call on one member", "显示提及某位成员的消息"],
    ["To anyone", "所有接收者"],
    ["To no one", "未提及任何人"],
    ["To @all", "提及 @all"],
    ["Filter by channel", "按频道筛选"],
    ["Show posts in one channel", "显示某个频道中的消息"],
    ["All channels", "所有频道"],
    ["Keep the newest post in view", "始终显示最新消息"],
    ["Follow", "跟随最新消息"],
    ["Show or hide each member's posts", "显示或隐藏各成员的消息"],
    ["No posts match", "没有匹配的消息"],
    ["Try a different search or member filter.", "请尝试其他搜索条件或成员筛选条件。"],
    ["Clear filters", "清除筛选"],
    ["No posts yet", "暂无消息"],
    ["Posts to the swarm board will appear here as members talk.", "成员交流时，看板消息会显示在这里。"],
    ["New", "新消息"],
    ["Latest", "最新消息"],
    ["Show more", "展开更多"],
    ["Show less", "收起"],
    ["not on roster", "不在成员列表中"],
    ["Not on the roster", "不在成员列表中"],
    ["Replay", "回放"],
    ["Jump to start", "跳转到开头"],
    ["Previous post (←)", "上一条消息（←）"],
    ["Previous post", "上一条消息"],
    ["Play / pause replay (space)", "播放 / 暂停回放（空格键）"],
    ["Play replay", "播放回放"],
    ["Pause replay", "暂停回放"],
    ["Next post (→)", "下一条消息（→）"],
    ["Next post", "下一条消息"],
    ["Replay position", "回放位置"],
    ["Scrub through board posts", "拖动以浏览看板消息"],
    ["Show everything and follow live", "显示全部内容并跟随实时更新"],
    ["Hide killed and inactive members from the graph", "在关系图中隐藏已终止及不活跃的成员"],
    ["Hide inactive", "隐藏不活跃成员"],
    ["Draw @all as an edge to every member", "将 @all 显示为连接各成员的连线"],
    ["Expand @all", "展开 @all"],
    ["Replay pacing", "回放节奏"],
    ["Even pacing", "均匀间隔"],
    ["Real-time gaps", "实际时间间隔"],
    ["Replay speed", "回放速度"],
    ["Who @mentions whom", "成员之间的 @提及关系"],
    ["@mention, width = count", "@提及，线宽表示次数"],
    ["via @all", "通过 @all"],
    ["posted with no mention", "未提及任何人的消息"],
    ["@all posts, drawn by Expand @all", "@all 消息，可通过“展开 @all”显示连线"],
    ["File", "文件"],
    ["Copy to clipboard", "复制到剪贴板"],
    ["Copy", "复制"],
    ["Copied", "已复制"],
    ["Copy failed", "复制失败"],
    ["Search members", "搜索成员"],
    ["Active", "活跃成员"],
    ["Team", "团队成员"],
    ["Standing by", "待命成员"],
    ["Retired", "已退出成员"],
    ["Coordinator · Working", "协调者 · 工作中"],
    ["Working", "工作中"],
    ["Stuck", "受阻"],
    ["Error", "错误"],
    ["Your swarm is starting", "Swarm 正在启动"],
    ["One goal", "一个目标"],
    ["The coordinator splits it into tasks.", "协调者将目标拆分为任务。"],
    ["Many workers", "多位执行者"],
    ["Each takes a task, and they run in parallel.", "每位执行者负责一项任务，并行开展工作。"],
    ["One board", "一个共享看板"],
    ["Updates land here. You step in only when asked.", "进展会汇集到这里。需要您参与时才会请您介入。"],
    ["Waiting for the first update", "等待首次更新"],
    // v3.3.52 (Antigravity 2.33.0) Swarm 画面查看器增量词条（Previous/Next 在 translateScopedNavigation 中按作用域限定）
    ["Compare then and now", "对比前后画面"],
    ["Scrub through progress", "拖动查看进度"],
    ["Filter by worker", "按执行成员筛选"],
    ["All workers", "所有执行成员"],
    ["Frames", "画面列表"]
  ];
  for (const [k, v] of swarmExactPhrases) {
    if (!phrases.has(k)) phrases.set(k, v);
    const low = k.toLowerCase();
    if (!lowerPhrases.has(low)) lowerPhrases.set(low, v);
  }

  // v3.3.52 (Antigravity 2.33.0) SSH / GitHub PR / 查找栏 / 初始化脚本精确词条：仅写入 O(1) 精确查找表
  const desktop233ExactPhrases = [
    ["Open SSH Host", "打开 SSH 主机"],
    ["Connect to SSH Host", "连接到 SSH 主机"],
    ["SSH Host…", "SSH 主机…"],
    ["SSH host", "SSH 主机"],
    ["Create a project on a machine you reach over SSH. It opens in that host's own window.", "在可通过 SSH 访问的主机上创建项目，项目会在该主机的独立窗口中打开。"],
    ["Enter [user@]host[:port], or pick a host from your SSH config.", "输入 [user@]host[:port]，或从 SSH 配置中选择主机。"],
    ["Then create the project in its window.", "然后在该主机的窗口中创建项目。"],
    ["A host can't contain spaces.", "主机名不能包含空格。"],
    ["SSH Config", "SSH 配置"],
    ["SSH config:", "SSH 配置："],
    ["~/.ssh/config (default)", "~/.ssh/config（默认）"],
    ["Choose File…", "选择文件…"],
    ["Use Default", "使用默认配置"],
    ["Remove from Recent", "从最近使用中移除"],
    ["Hide from this list", "从此列表中隐藏"],
    ["Show in the list again", "重新在列表中显示"],
    ["Hidden hosts", "隐藏的主机"],
    ["1 hidden host", "1 台隐藏主机"],
    ["Loading hosts…", "正在加载主机…"],
    ["Loading Hosts…", "正在加载主机…"],
    ["Couldn't load your SSH hosts", "无法加载 SSH 主机"],
    ["Couldn't load your SSH hosts. You can still type one.", "无法加载 SSH 主机。仍可手动输入主机地址。"],
    ["No matching hosts", "没有匹配的主机"],
    ["No hosts in ~/.ssh/config yet", "~/.ssh/config 中尚无主机"],
    ["Pull Requests", "拉取请求 (PR)"],
    ["Connect GitHub", "连接 GitHub"],
    ["GitHub: not signed in", "GitHub：未登录"],
    ["Connect GitHub: Run gh auth login in a terminal", "连接 GitHub：请在终端运行 gh auth login"],
    ["Copy gh auth login command", "复制 gh auth login 命令"],
    ["Grant repository access", "授予仓库访问权限"],
    ["GitHub Repositories", "GitHub 仓库"],
    ["Loading Repositories…", "正在加载仓库…"],
    ["No matching repositories", "没有匹配的仓库"],
    ["No repositories found", "未找到仓库"],
    ["Insert into main conversation", "插入主会话"],
    ["Side Question Selection", "对所选内容发起旁路提问"],
    ["Unarchive the main conversation to insert", "取消归档主会话后即可插入"],
    ["Previous Match (Shift+Enter)", "上一处匹配（Shift+Enter）"],
    ["Next Match (Enter)", "下一处匹配（Enter）"],
    ["Use Regular Expression (.*)", "使用正则表达式（.*）"],
    ["0 results", "0 个结果"],
    ["managed by your organization", "由您的组织管理"],
    ["Terminal sandbox is not supported in this environment", "此环境不支持终端沙盒"],
    ["Checking availability…", "正在检查可用性…"],
    ["Saving setup routine", "正在保存环境初始化脚本"],
    ["Canceled saving setup routine", "已取消保存环境初始化脚本"],
    ["Saved setup routine", "已保存环境初始化脚本"],
    ["Deleting setup routine", "正在删除环境初始化脚本"],
    ["Canceled deletion of setup routine", "已取消删除环境初始化脚本"],
    ["Deleted setup routine", "已删除环境初始化脚本"],
    ["Open in settings", "在设置中打开"]
  ];
  for (const [k, v] of desktop233ExactPhrases) {
    if (!phrases.has(k)) phrases.set(k, v);
    const low = k.toLowerCase();
    if (!lowerPhrases.has(low)) lowerPhrases.set(low, v);
  }

  // v3.3.56–v3.3.57 (Antigravity 2.34.0) 沙箱/权限/编排器/输入框/侧栏/快捷键精确词条：仅写入 O(1) 精确查找表
  const desktop234ExactPhrases = [
    ["Enable terminal sandbox","启用终端沙箱"],
    ["Terminal command auto execution","终端命令自动执行"],
    ["File writes","文件写入"],
    ["Commands outside sandbox","沙箱外命令"],
    ["File access rules","文件访问规则"],
    ["Network access rules","网络访问规则"],
    ["Enable sandbox mode","启用沙箱模式"],
    ["Security preset","安全预设"],
    ["Add note","添加备注"],
    ["In chat","在会话中查看"],
    ["Answered:","已回答："],
    ["Replaced by newer request","已被新请求替代"],
    ["Expired · Action not taken","已过期 · 未执行操作"],
    ["Ask to retry","请求重试"],
    ["Select one or more options","请选择一项或多项"],
    ["Runtime permission","运行时权限"],
    ["Permission approval scope","权限批准范围"],
    ["Tell the agent what to do instead...","告诉智能体改做什么…"],
    ["Deny with note","拒绝并附上备注"],
    ["Open System Settings ↗","打开系统设置 ↗"],
    ["Reopen ↗","重新打开 ↗"],
    ["Screen locked: agents can't use this Mac until you unlock it","屏幕已锁定。请解锁 Mac 后再由智能体操作。"],
    ["This plugin is currently stopped. Events and stdout streams will appear here once started.","此插件已停止。启动后，此处会显示事件和标准输出。"],
    ["Start Plugin","启动插件"],
    ["Filter plugins","筛选插件"],
    ["Category","类别"],
    ["Plugins Options","插件选项"],
    ["Input Box","输入框"],
    ["Enter to send","按 Enter 发送"],
    ["Choose which key sends a message in the chat composer.","选择在对话输入框中发送消息的快捷键。"],
    ["Press Cmd+Enter to send, Enter for a new line.","按 Cmd+Enter 发送，按 Enter 换行。"],
    ["Press Ctrl+Enter to send, Enter for a new line.","按 Ctrl+Enter 发送，按 Enter 换行。"],
    ["Press Enter to send, Shift+Enter for a new line.","按 Enter 发送，按 Shift+Enter 换行。"],
    ["Command setup script","命令初始化脚本"],
    ["Default workspace VCS","默认工作区版本控制系统"],
    ["Default Cog repository","默认 Cog 仓库"],
    ["Default Cog branch / ref","默认 Cog 分支或引用"],
    ["Sync JJ worktrees to head","将 JJ 工作树同步到最新修订"],
    ["Setup script","初始化脚本"],
    ["Orchestrator Settings","编排器设置"],
    ["Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster, cheaper executor gives high quality for fewer tokens.","选择编排器使用的模型。搭配能力更强的编排模型与速度更快、成本更低的执行模型，可以用更少的 Token 获得高质量结果。"],
    ["Orchestrator Model","编排模型"],
    ["Plans the work, makes design decisions, and reviews the result. Pick a top-tier model. You can also pick one per conversation from the Orchestrator row in the model menu.","负责规划工作、作出设计决策并审查结果。请选择能力较强的模型。也可在模型菜单的 Orchestrator 一栏中为当前会话单独选择。"],
    ["Executor Model","执行模型"],
    ["Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.","按计划执行搜索、编辑、构建和测试。请选择速度更快、成本更低的模型。"],
    ["New conversation button","新建会话按钮"],
    ["Signing out…","正在退出登录…"],
    ["Describe your changes","描述你的更改"],
    ["Describe your changes, or leave empty to auto-generate","描述你的更改，或留空以自动生成"],
    ["Reply","回复"],
    ["Telemetry is turned off for your account.","你的账号已关闭遥测。"],
    ["Unsent draft","未发送的草稿"],
    ["Messages now send immediately. Configure in","消息现在会立即发送。可在以下位置配置"],
    ["Instead of queueing, try asking the agent to do something after the current task.","你可以让智能体在当前任务结束后执行下一项工作。"],
    ["Thinking effort","推理强度"],
    ["Controls how much time and quota the model spends reasoning before responding. Higher effort improves accuracy on hard problems, at the cost of slower responses and higher quota use.","控制模型在回复前用于推理的时间和额度。提高推理强度有助于更准确地处理难题，同时也会增加响应时间和额度消耗。"],
    ["Edits the conversation title","编辑会话标题"],
    ["Manual Order","手动排序"],
    ["Show 5","显示 5 项"],
    ["Show 10","显示 10 项"],
    ["Customize Sidebar","自定义侧栏"],
    ["Idle Conversations","空闲会话"],
    ["Only applies when grouped by status","仅在按状态分组时适用"],
    ["Show Automation Conversations","显示自动化会话"],
    ["Show Plugin Conversations","显示插件会话"],
    ["Any time","不限时间"],
    ["Filter and Sort","筛选和排序"],
    ["Last Activity","上次活动"],
    ["Needs Input","等待输入"],
    ["Failed to create automation.","创建自动化任务失败。"],
    ["New automation","新建自动化任务"],
    ["Create automation","创建自动化任务"],
    ["No sign-in required. This app is ready to use.","无需登录，可以直接使用此应用。"],
    ["Managed by application menu","由应用菜单管理"],
    ["Terminal: Select All","终端：全选"]
  ];
  for (const [k, v] of desktop234ExactPhrases) {
    if (!phrases.has(k)) phrases.set(k, v);
    const low = k.toLowerCase();
    if (!lowerPhrases.has(low)) lowerPhrases.set(low, v);
  }

  // v3.3.58–v3.3.60 (Antigravity 2.34.0) 扩展市场与排队词条补充及空格修正（覆盖旧值）
  const desktop234V3360ExactPhrases = [
    ["Queued messages", "排队消息"],
    ["Plugins in Featured", "精选插件"],
    ["Clear category", "清除分类筛选"],
    ["Most popular first", "按热门程度排序"],
    ["Most popular matches first", "匹配结果按热门程度排序"],
    ["Sign in required.", "需要登录。"],
    ["Error:", "错误："],
    ["Connect to Google Workspace, including Docs, Sheets, Slides, Drive, Calendar, and Gmail.", "连接 Google Workspace，可使用文档、表格、演示文稿、云端硬盘、日历和 Gmail。"],
    ["See more in Google Workspace", "在 Google Workspace 中查看更多"],
    ["See less in Google Workspace", "在 Google Workspace 中收起"],
    ["Agent skills, databases, and interactive viewers for scientific research.", "面向科研的智能体技能、数据库和交互式查看器。"]
  ];
  for (const [k, v] of desktop234V3360ExactPhrases) {
    phrases.set(k, v);
    lowerPhrases.set(k.toLowerCase(), v);
  }

  // v3.3.61–v3.3.63 (Antigravity 2.35.0) 设置/排队/克隆/自动化/外观预设增量精确词典：仅写入 O(1) 精确查找表
  const desktop235V3363ExactPhrases = [
    ["Runs on this machine", "在此电脑上运行"],
    ["Runs in a cloud environment", "在云端环境中运行"],
    ["Sends after agent finishes working.", "智能体结束工作后发送。"],
    ["Sends after background work finishes.", "后台工作完成后发送。"],
    ["Agent finished. Queued messages send after background work finishes.", "智能体已完成工作。后台工作结束后将发送排队消息。"],
    ["Message queued. Sends after agent finishes working. Actions available: Send Now, Edit, Delete.", "消息已排队，智能体结束工作后发送。可立即发送、编辑或删除。"],
    ["Message queued. Sends after background work finishes. Actions available: Send Now, Edit, Delete.", "消息已排队，后台工作完成后发送。可立即发送、编辑或删除。"],
    ["Model cannot be changed while the agent is running", "智能体运行期间无法更改模型"],
    ["Switch to default text direction", "切换为默认文字方向"],
    ["Switch to RTL text direction", "切换为从右到左的文字方向"],
    ["Search Repositories…", "搜索仓库…"],
    ["Search Projects…", "搜索项目…"],
    ["Clone from Remote", "从远程克隆"],
    ["Clone locally", "在本机克隆"],
    ["Clone from This Computer", "从此电脑克隆"],
    ["Clone did not return a valid folder path.", "克隆未返回有效的文件夹路径。"],
    ["This side question isn't available in this conversation.", "此会话中无法查看这条旁路提问。"],
    ["Permissions cannot be changed while the agent is running", "智能体运行期间无法更改权限"],
    ["Prevent sleep", "阻止系统休眠"],
    ["Keep in menu bar", "保持在菜单栏/托盘"],
    ["Device name", "设备名称"],
    ["Notification settings", "通知设置"],
    ["Conversation steps", "对话步骤"],
    ["Font size", "字体大小"],
    ["Conversation width", "对话面板宽度"],
    ["Screen reader mode", "屏幕阅读器模式"],
    ["Enable notifications for agent", "启用智能体系统通知"],
    ["Enable sounds for agent", "启用智能体提示音"],
    ["Enable AI credit overages", "启用超额 AI 积分计费"],
    ["Open links in", "链接打开方式"],
    ["Download location", "下载位置"],
    ["Browsing history", "浏览历史"],
    ["Browser actuation rules", "浏览器操作执行规则"],
    ["Enable telemetry", "启用遥测诊断"],
    ["Marketing emails", "营销与产品动态邮件"],
    ["Custom context menus", "自定义右键菜单"],
    ["Terminal placement", "终端位置"],
    ["Markdown artifact width", "Markdown 产物文档宽度"],
    ["Browser JavaScript execution policy", "浏览器 JavaScript 执行策略"],
    ["Automatic check for updates", "自动检查更新"],
    ["Required", "必填"],
    ["Where it runs", "运行位置"],
    ["System UI", "系统界面字体"],
    ["Legacy Dark", "旧版深色"],
    ["Legacy Light", "旧版浅色"],
    ["Runs even when your computer is off. Schedules and events.", "电脑关机后仍可运行，支持定时和事件触发。"],
    ["Runs even when your computer is off. Schedules only.", "电脑关机后仍可运行，仅支持定时运行。"]
  ];
  for (const [k, v] of desktop235V3363ExactPhrases) {
    if (!phrases.has(k)) phrases.set(k, v);
    const low = k.toLowerCase();
    if (!lowerPhrases.has(low)) lowerPhrases.set(low, v);
  }

  // v3.3.64 (Antigravity 2.35.1) 内置浏览器按钮、旁路提问草稿与标签页菜单增量精确词条
  const desktop2351V3364ExactPhrases = [
    ["Inspect element to comment", "检查元素并添加评论"],
    ["Exit inspect element mode (Esc)", "退出元素检查模式（Esc）"]
  ];
  for (const [k, v] of desktop2351V3364ExactPhrases) {
    phrases.set(k, v);
    lowerPhrases.set(k.toLowerCase(), v);
  }

  // 经核验的官方与合作插件简介映射（仅在 React Fiber 溯源匹配官方插件时启用）
  const OFFICIAL_PLUGIN_DESCRIPTIONS = {
    "Core tools and knowledge required to develop for Android.": {
      "plugin": "android-cli-plugin",
      "translation": "开发 Android 应用所需的核心工具与知识。"
    },
    "Query Arize AX projects, traces, datasets, and experiments from Antigravity, with skills for tracing, evals, and prompt optimization.": {
      "plugin": "arize-skills",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Antigravity 中查询 Arize AX 项目、链路追踪、数据集和实验，并使用追踪、评估和提示词优化技能。"
    },
    "Teamwork Graph CLI is Atlassian's agent-first interface to your entire work context: Jira issues, Confluence pages, Bitbucket PRs, along with your connected third-party data sources. Purpose-built for coding agents like Antigravity (terminal or desktop), and powered by Atlassian's context graph. Try: \"draft a Jira issue from this PR and link it to the epic.\" Run /twg-setup after install to connect Atlassian Teamwork Graph CLI to Antigravity.": {
      "plugin": "atlassian-twg-cli",
      "marketplace": "antigravity-plugins-partners",
      "translation": "Teamwork Graph CLI 是 Atlassian 为智能体设计的入口，可访问 Jira 事项、Confluence 页面、Bitbucket 拉取请求及已连接的第三方数据源。由 Atlassian 上下文图谱提供支持，面向 Antigravity 等终端或桌面编程智能体。可试用「根据这个拉取请求起草 Jira 事项，并关联到 Epic」。安装后运行 /twg-setup，将 Teamwork Graph CLI 连接到 Antigravity。"
    },
    "Add Auth0 authentication to any app: login, MFA, SSO, Organizations, RBAC, custom domains, and branding. Debug auth errors and migrate from other providers.": {
      "plugin": "auth0",
      "marketplace": "antigravity-plugins-partners",
      "translation": "为应用接入 Auth0 登录、多因素认证、单点登录、组织管理、基于角色的访问控制、自定义域名和品牌设置。支持排查认证错误与迁移。"
    },
    "Build and deploy Base44 full-stack apps: CLI project management, JavaScript/TypeScript SDK development, and production troubleshooting skills.": {
      "plugin": "base44",
      "marketplace": "antigravity-plugins-partners",
      "translation": "构建并部署 Base44 全栈应用，包含 CLI 项目管理、JavaScript/TypeScript SDK 开发和生产故障排查技能。"
    },
    "Investigate incidents, check who's on call, and query logs, metrics, traces, errors and RUM in Better Stack. Build dashboards and manage uptime monitors.": {
      "plugin": "betterstack",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Better Stack 中调查事件、查看值班人员，查询日志、指标、链路追踪、错误和真实用户监控（RUM）数据。还可构建仪表板和管理可用性监控。"
    },
    "Give your agent a real browser: navigate, click, type, screenshot, and extract data from any site, locally or on Browserbase cloud browsers.": {
      "plugin": "browse",
      "marketplace": "antigravity-plugins-partners",
      "translation": "为智能体提供本地或 Browserbase 云端浏览器，支持浏览、点击、输入、截图和提取网页数据。"
    },
    "Create, edit, review, resize, and brand-check Canva designs with the Canva MCP server.": {
      "plugin": "canva",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Canva MCP 服务器创建、编辑、审查和调整设计尺寸，并检查设计是否符合品牌规范。"
    },
    "RDKit cheminformatics, reaction and property tools, plus ChEMBL and PubChem, to work with molecules, their properties, and bioactivity data.": {
      "plugin": "chemistry",
      "translation": "借助 RDKit 化学信息学、反应与性质分析工具以及 ChEMBL 和 PubChem，研究分子、分子性质和生物活性数据。"
    },
    "Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer": {
      "plugin": "chrome-devtools-plugin",
      "translation": "在 Chrome 中使用 Chrome DevTools 和 Puppeteer 进行可靠的自动化、深度调试与性能分析"
    },
    "Add authentication and user management with Clerk. Skills for setup, frameworks, organizations, billing, webhooks, and testing, plus the Clerk MCP server.": {
      "plugin": "clerk",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Clerk 接入身份验证和用户管理。包含初始配置、框架、组织、计费、Webhook 和测试技能，以及 Clerk MCP 服务器。"
    },
    "Connect Antigravity to your ClickUp workspace — manage tasks, track time, and collaborate with your team without switching context.": {
      "plugin": "clickup",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将 Antigravity 连接到 ClickUp 工作区，无需切换应用即可管理任务、追踪工时并与团队协作。"
    },
    "Build, deploy and manage apps on Cloudflare Workers, storage and AI, with platform skills and the Cloudflare API through one MCP server.": {
      "plugin": "cloudflare",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Cloudflare Workers、存储和 AI 服务上构建、部署并管理应用。通过同一个 MCP 服务器使用平台技能和 Cloudflare API。"
    },
    "CodeRabbit is the governance and control layer for agentic software development helping developers trust AI written code.": {
      "plugin": "coderabbit",
      "marketplace": "antigravity-plugins-partners",
      "translation": "CodeRabbit 为智能体参与的软件开发提供治理和管控，帮助开发者建立对 AI 所写代码的信心。"
    },
    "AI-powered code review, review-comment autofix, and repository configuration, powered by CodeRabbit.": {
      "plugin": "coderabbit",
      "marketplace": "antigravity-plugins-partners",
      "translation": "借助 CodeRabbit 进行 AI 代码审查，按审查评论自动修复代码，并配置代码仓库。"
    },
    "Up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your coding agent's context.": {
      "plugin": "context7",
      "marketplace": "antigravity-plugins-partners",
      "translation": "查询最新文档，直接从源代码仓库获取与版本匹配的文档和代码示例，补充到编程智能体的上下文中。"
    },
    "Use the official CrowdStrike-hosted MCP server to work across Falcon: detections, cases, threat intel, SIEM, hosts, vulnerabilities, cloud, and more.": {
      "plugin": "crowdstrike",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 CrowdStrike 托管的官方 MCP 服务器使用 Falcon，涵盖检测、事件、威胁情报、SIEM、主机、漏洞和云安全。"
    },
    "This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assistant, allowing you to use natural language prompts in your preferred coding agent to architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows across GCP's data ecosystem.": {
      "plugin": "data-agent-kit-plugin",
      "translation": "此插件为在 Google Cloud 上工作的数据工程师和数据库从业者提供专业技能套件。它充当专家助手，支持在您偏好的编码智能体中使用自然语言提示词来设计复杂数据流水线、使用 dbt 转换数据、编写 Spark 与 BigQuery SQL 笔记本，并在 GCP 数据生态系统中编排端到端工作流。"
    },
    "Databricks skills for the CLI, Apps, Lakebase, Model Serving, Lakeflow Jobs, Spark Declarative Pipelines, Declarative Automation Bundles (DABs), and classic-to-serverless migration.": {
      "plugin": "databricks",
      "marketplace": "antigravity-plugins-partners",
      "translation": "提供 Databricks CLI、Apps、Lakebase、Model Serving、Lakeflow Jobs、Spark 声明式流水线、声明式自动化包（DAB），以及从经典计算迁移到无服务器计算的技能。"
    },
    "Use Datadog directly in Antigravity through a preconfigured Datadog MCP server. Query logs, metrics, traces, dashboards, and more through natural conversation. This plugin is in preview.": {
      "plugin": "datadog",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过预配置的 Datadog MCP 服务器在 Antigravity 中查询日志、指标、链路追踪与仪表板。此插件处于预览阶段。"
    },
    "Build, test, and debug Docusign integrations with developer skills for authentication, template-based signing, envelope status, and troubleshooting.": {
      "plugin": "docusign",
      "marketplace": "antigravity-plugins-partners",
      "translation": "构建、测试和调试 Docusign 集成。开发技能涵盖身份验证、基于模板的签署、信封状态和故障排查。"
    },
    "Connect Antigravity to Dropbox to search, inspect, summarize, share, collect uploads, organize folders, and clean up files with confirmation for write actions.": {
      "plugin": "dropbox",
      "marketplace": "antigravity-plugins-partners",
      "translation": "连接 Antigravity 与 Dropbox 后，可搜索、查看、总结和共享文件，收集上传内容，整理文件夹并清理文件。写入操作需要确认。"
    },
    "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP server.": {
      "plugin": "dynatrace",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过技能和 MCP 服务器访问实际 Dynatrace 数据，排查生产问题及根因，并查看日志、指标、链路追踪和漏洞。"
    },
    "Develop ideas with context and review documents with fresh eyes.": {
      "plugin": "egm",
      "translation": "结合上下文拓展想法，从新的角度审阅文档。"
    },
    "Packaged workflows for SCA remediation, AI SAST triage, CI/CD posture, malware response, findings review, Endor Labs setup, and more.": {
      "plugin": "endor-labs-agent-kit",
      "marketplace": "antigravity-plugins-partners",
      "translation": "提供软件成分分析修复、AI 静态分析初筛、CI/CD 安全状况检查、恶意软件响应、发现审查及 Endor Labs 配置流程。"
    },
    "Turn Figma designs into production code, map components with Code Connect, and create or edit Figma files in Antigravity.": {
      "plugin": "figma",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将 Figma 设计转为可用代码，通过 Code Connect 映射组件，并在 Antigravity 中创建或编辑 Figma 文件。"
    },
    "Prototype, build & run modern apps that users love with Firebase's backend, AI, and operational infrastructure.": {
      "plugin": "firebase",
      "translation": "使用 Firebase 的后端、AI 和运维基础设施，制作原型、构建并运行用户喜爱的现代应用。"
    },
    "Official plugin for Dart and Flutter that installs Flutter/Dart Skills, Rules, Custom Agents, and Dart MCP server for building natively compiled, visually stunning applications for mobile, web, desktop, and embedded devices from a single codebase": {
      "plugin": "flutter",
      "translation": "Dart 与 Flutter 官方插件，集成 Flutter/Dart 技能、规则、自定义智能体及 Dart MCP 服务，助力通过单一代码库为移动端、Web、桌面端和嵌入式设备构建原生编译的精美应用"
    },
    "Check availability, schedule events, and RSVP.": {
      "plugin": "gcalendar",
      "translation": "查看忙闲状态、安排活动并回复邀请（RSVP）。"
    },
    "Read, draft, and edit docs.": {
      "plugin": "gdocs",
      "translation": "读取、起草和编辑文档。"
    },
    "Search, upload, download, and share files.": {
      "plugin": "gdrive",
      "translation": "搜索、上传、下载和共享文件。"
    },
    "Build applications and shell workflows with the Gemini Interactions API, Decisions API, Live API, and Gemini API CLI, including text, image, video, and speech generation, managed agents, and real-time multimodal streaming.": {
      "plugin": "gemini-api",
      "translation": "使用 Gemini Interactions API、Decisions API、Live API 和 Gemini API CLI 构建应用及 Shell 工作流，支持文本、图像、视频和语音生成、托管智能体与实时多模态流式传输。"
    },
    "Build applications and shell workflows with the Gemini Interactions API, Decisions API, Live API, Genie 4 interactive worlds, and Gemini API CLI, including text, image, video, speech, and music generation, managed agents, and real-time multimodal streaming.": {
      "plugin": "gemini-api",
      "translation": "使用 Gemini Interactions API、Decisions API、Live API、Genie 4 交互世界和 Gemini API CLI 构建应用及 Shell 工作流，支持文本、图像、视频、语音和音乐生成、托管智能体与实时多模态流式传输。"
    },
    "AlphaGenome and major genetics databases to analyze DNA variants, gene regulation, and links between genes and disease.": {
      "plugin": "genomics",
      "translation": "通过 AlphaGenome 和主要遗传学数据库分析 DNA 变异、基因调控以及基因与疾病的关联。"
    },
    "Search, read, draft, and send emails in Gmail.": {
      "plugin": "gmail",
      "translation": "搜索、阅读、起草和发送 Gmail 邮件。"
    },
    "Integration skill and tools for Google Maps Platform APIs": {
      "plugin": "google_maps_platform",
      "translation": "用于 Google Maps Platform API 的集成技能与工具"
    },
    "Using the Google Antigravity Python SDK to build AI agents": {
      "plugin": "google-antigravity-sdk",
      "translation": "使用 Google Antigravity Python SDK 构建 AI 智能体"
    },
    "Google Cloud guidance for coding agents: first-project onboarding, authentication and credential selection, and safety-critical validation for gcloud CLI commands. Includes the Google Developer Knowledge MCP server for grounded, up-to-date Google Cloud documentation.": {
      "plugin": "google-cloud-developer",
      "translation": "为编程智能体提供 Google Cloud 指南，涵盖首个项目的上手流程、身份验证与凭据选择，以及 gcloud CLI 命令的安全校验。内置 Google Developer Knowledge MCP 服务器，可查询最新官方文档。"
    },
    "Search and retrieve official documentation across Google Cloud, Gemini, Android, Firebase, Flutter, and Web. Requires Google Cloud credentials (ADC) or an API key.": {
      "plugin": "google-developer-knowledge",
      "translation": "搜索并获取 Google Cloud、Gemini、Android、Firebase、Flutter 和 Web 的官方文档。需要 Google Cloud 凭据（ADC）或 API 密钥。"
    },
    "Search and retrieve official Google Health API documentation on developers.google.com/health through the Google Health Developer MCP server.": {
      "plugin": "google-health-developer",
      "translation": "通过 Google Health Developer MCP 服务器，在 developers.google.com/health 搜索并查阅 Google Health API 官方文档。"
    },
    "Search official Google Home, Matter, and OpenThread documentation and query Cloud-to-cloud user feedback integration diagnostics through the Google Home Developer MCP server.": {
      "plugin": "google-home-developer",
      "translation": "通过 Google Home Developer MCP 服务器搜索 Google Home、Matter 和 OpenThread 官方文档，并查询云到云集成中用户反馈的诊断信息。"
    },
    "Query Grafana Cloud metrics, logs, traces and profiles, manage dashboards, alerts and incidents, and ask Grafana Assistant through the hosted MCP server.": {
      "plugin": "grafana-cloud-mcp",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过托管的 MCP 服务器查询 Grafana Cloud 指标、日志、链路追踪与性能剖析数据，管理仪表板、告警和事件，并向 Grafana Assistant 提问。"
    },
    "The AI notepad for meetings. Connect to your meeting history and use your conversation context to get things done.": {
      "plugin": "granola",
      "marketplace": "antigravity-plugins-partners",
      "translation": "面向会议的 AI 记事本。连接会议历史，利用对话上下文处理工作。"
    },
    "Read, write, and format spreadsheets.": {
      "plugin": "gsheets",
      "translation": "读取、写入和格式化电子表格。"
    },
    "Read, edit, and export presentations.": {
      "plugin": "gslides",
      "translation": "读取、编辑和导出演示文稿。"
    },
    "Build and debug pipelines, manage deployments, investigate security findings, and operate Harness with connected tools and reusable workflow skills.": {
      "plugin": "harness-antigravity",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过已连接的工具和可复用流程技能构建及调试流水线、管理部署、调查安全发现并操作 Harness。"
    },
    "Respond to and investigate incidents, manage on-call schedules and escalations, and write runbooks and skills. Bundles the official incident.io MCP server.": {
      "plugin": "incident-io",
      "marketplace": "antigravity-plugins-partners",
      "translation": "响应和调查事件，管理值班安排与升级流程，并撰写运行手册和技能。内含官方 incident.io MCP 服务器。"
    },
    "Search Intercom conversations, contacts, and companies, spot support trends, and install the Intercom Messenger with secure identity verification.": {
      "plugin": "intercom",
      "marketplace": "antigravity-plugins-partners",
      "translation": "搜索 Intercom 会话、联系人和公司，识别客服趋势，并安装带安全身份验证的 Intercom Messenger。"
    },
    "Connect your agent to invideo's AI-native video editor. It trims, grades and mixes on a real timeline while you watch every change land.": {
      "plugin": "invideo",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将智能体连接到 invideo 的 AI 视频编辑器，在实际时间线上剪辑、调色和混音，可实时查看改动。"
    },
    "Search the web and read any page as clean markdown with Keenable, a search engine built for AI agents. Keyless: no signup or API key needed.": {
      "plugin": "keenable",
      "marketplace": "antigravity-plugins-partners",
      "translation": "使用面向 AI 智能体的 Keenable 搜索网页，并将页面提取为简洁的 Markdown。无需注册或 API 密钥。"
    },
    "Ask a question of the live web and get a table back. Keenable SELECT runs many searches, reads the pages and extracts the fields you need in one call. Sign in with a Keenable account.": {
      "plugin": "keenable-select",
      "marketplace": "antigravity-plugins-partners",
      "translation": "向实时网络提出问题并获取表格结果。一次调用可执行多次搜索、读取网页并提取所需字段。需要登录 Keenable。"
    },
    "Create, run and debug Leapwork Play tests and runlists, build agents, and hand work to Play's AI workflows, right from Antigravity.": {
      "plugin": "leapwork-play",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Antigravity 中创建、运行并调试 Leapwork Play 测试和运行列表，构建智能体，并将工作交给 Play 的 AI 流程。"
    },
    "Salaries, jobs & career advice. Levels.fyi is your career companion to ensure you get paid fairly and find jobs you'll love.": {
      "plugin": "levels-fyi",
      "marketplace": "antigravity-plugins-partners",
      "translation": "薪资、职位与职业建议。Levels.fyi 帮助您争取公平薪酬，找到心仪的工作。"
    },
    "Real salaries and company levels from Levels.fyi: check if an offer is fair, compare offers, find jobs with pay shown and add your own salary.": {
      "plugin": "levels-fyi",
      "marketplace": "antigravity-plugins-partners",
      "translation": "查看 Levels.fyi 的实际薪资和公司职级，评估或比较录用条件、查找公开薪资的职位，并提交自己的薪资信息。"
    },
    "The product development system for teams and agents. Manage issues, projects, and documents across your Linear workspace from Antigravity.": {
      "plugin": "linear",
      "marketplace": "antigravity-plugins-partners",
      "translation": "面向团队和智能体的产品开发系统。通过 Antigravity 管理 Linear 工作区中的事项、项目与文档。"
    },
    "Connect to your managed Looker MCP server to explore data, run saved Looks, build dashboards, and validate LookML.": {
      "plugin": "looker",
      "translation": "连接托管的 Looker MCP 服务器以探索数据、运行已保存的 Look、制作仪表板并验证 LookML。"
    },
    "Research US case law, statutes, and regulations, plus live dockets from federal and state courts. A Midpage account is required.": {
      "plugin": "midpage",
      "marketplace": "antigravity-plugins-partners",
      "translation": "研究美国判例法、成文法和法规，并查阅联邦及州法院的最新案件案卷。需要 Midpage 账号。"
    },
    "Give your AI agent 600,000+ real app screens, and the skills to use them. Includes the Mobbin MCP and a skill that redesigns your screen from patterns real apps ship, in your own design system, with the references behind every change.": {
      "plugin": "mobbin",
      "marketplace": "antigravity-plugins-partners",
      "translation": "提供 60 多万张真实应用界面和配套技能。包含 Mobbin MCP，可参考已上线应用的设计模式，在您自己的设计系统中改进界面，并给出各项改动的参考来源。"
    },
    "Keep your coding agent up to date with the latest web best practices.": {
      "plugin": "modern-web-guidance-plugin",
      "translation": "让您的编码智能体紧跟最新的 Web 最佳实践。"
    },
    "Plan and track work in monday.com from Antigravity: create, update and assign items, write docs, and build forms that turn requests into items.": {
      "plugin": "monday",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Antigravity 在 monday.com 中计划和跟踪工作，创建、更新和分配工作项，撰写文档，并用表单将请求转为工作项。"
    },
    "Official Antigravity plugin for MongoDB Atlas (hosted MCP Server + Skills). Connect to the MongoDB-hosted Atlas MCP server, explore data, manage collections, optimize queries, generate reliable code, implement best practices, develop advanced features, and more.": {
      "plugin": "mongodb-atlas",
      "marketplace": "antigravity-plugins-partners",
      "translation": "适用于 MongoDB Atlas 的 Antigravity 官方插件，包含托管的 MCP 服务器和技能。连接 MongoDB 托管的 Atlas MCP 服务器后，可以探索数据、管理集合、优化查询、生成可靠代码、遵循最佳实践并开发高级功能。"
    },
    "Build, test, and manage n8n workflows and Agents through your instance MCP server. Use official skills for node setup, credentials, and debugging.": {
      "plugin": "n8n-skills",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 n8n 实例的 MCP 服务器构建、测试和管理工作流与智能体。使用官方技能设置节点、配置凭据和排查问题。"
    },
    "Agent skills for Neo4j graph database — write Cypher queries, design graph models, use drivers, run imports, build GraphRAG pipelines, run GDS algorithms, and manage Aura instances.": {
      "plugin": "neo4j",
      "marketplace": "antigravity-plugins-partners",
      "translation": "为 Neo4j 图数据库提供智能体技能，支持编写 Cypher 查询、建模、使用驱动程序、导入数据、构建 GraphRAG、运行 GDS 算法和管理 Aura 实例。"
    },
    "Build and deploy on Netlify: functions, edge functions, blobs, database, identity, forms, image CDN, caching, and AI Gateway, plus the Netlify MCP server.": {
      "plugin": "netlify",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Netlify 上构建和部署项目，支持函数、边缘函数、Blob 存储、数据库、身份服务、表单、图片 CDN、缓存和 AI Gateway，并提供 Netlify MCP 服务器。"
    },
    "Connect Antigravity to your Notion workspace with the Notion MCP server, plus skills for research, documentation, meeting prep, specs, trackers, and project updates.": {
      "plugin": "notion",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Notion MCP 服务器连接工作区，并使用研究、文档编写、会议准备、规格说明、跟踪和项目更新技能。"
    },
    "Create and send proposals, quotes, and contracts for e-signature. Track signing progress and identify documents that need follow-up.": {
      "plugin": "pandadoc",
      "marketplace": "antigravity-plugins-partners",
      "translation": "创建并发送提案、报价单及合同以供电子签署。跟踪签署进度，找出需要跟进的文档。"
    },
    "Search the live web and fetch page content with Parallel's hosted MCP server. Free access with no Parallel account, API key, or Parallel CLI required.": {
      "plugin": "parallel",
      "marketplace": "antigravity-plugins-partners",
      "translation": "使用 Parallel 托管的 MCP 服务器搜索实时网络并获取网页内容。免费使用，无需 Parallel 账号、API 密钥或 CLI。"
    },
    "Agent plugin for PingOne multi-tenant. Includes skills and a remote MCP server that lets AI agents configure and monitor your PingOne environments.": {
      "plugin": "ping-identity-pingone",
      "marketplace": "antigravity-plugins-partners",
      "translation": "面向 PingOne 多租户环境的智能体插件，提供技能与远程 MCP 服务器，用于配置和监控环境。"
    },
    "Equip Antigravity with specialized Postman skills for the complete API lifecycle. Discover, design, test, document, mock, monitor, and improve APIs through agent-friendly, filesystem-first workflows.": {
      "plugin": "postman",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Postman 技能管理 API 生命周期，涵盖发现、设计、测试、文档编写、模拟、监控和改进。流程以文件为基础，便于智能体操作。"
    },
    "Set up Qodo, explore code and repository history, review local changes, and resolve pull-request findings directly from Antigravity.": {
      "plugin": "qodo",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Antigravity 中设置 Qodo、浏览代码和仓库历史、审查本地变更并处理拉取请求中发现的问题。"
    },
    "Deploy, configure, monitor, and troubleshoot apps, databases, and infrastructure on Railway from Antigravity with Railway's agent skill and hosted MCP server.": {
      "plugin": "railway",
      "marketplace": "antigravity-plugins-partners",
      "translation": "借助 Railway 智能体技能和托管 MCP 服务器，在 Antigravity 中部署、配置、监控和排查应用、数据库及基础设施。"
    },
    "Robotics skills for any robot: 3D perception, collision-free motion planning, visual servoing, robot bring-up, sim2real, agent iteration, MuJoCo simulation, SimReady 3D asset authoring and physics auditing, and a live MuJoCo Studio 3D web sidecar.": {
      "plugin": "robotics",
      "translation": "为各类机器人提供技能，涵盖 3D 感知、无碰撞运动规划、视觉伺服、机器人启动调试、仿真到现实的迁移、智能体迭代、MuJoCo 仿真、SimReady 三维资产制作和物理属性审计，以及实时 MuJoCo Studio 3D 网页面板。"
    },
    "Skills for integrating the Scandit Data Capture SDK: product selection, docs and implementation guides for barcode scanning, ID capture and smart label capture.": {
      "plugin": "scandit-sdk",
      "marketplace": "antigravity-plugins-partners",
      "translation": "提供集成 Scandit Data Capture SDK 的技能，涵盖产品选型、文档与实施指南，适用于条码扫描、证件采集和智能标签采集。"
    },
    "Antigravity for science highlights, and an overview of the main science plugins.": {
      "plugin": "science-overview",
      "translation": "了解 Antigravity 的科研功能及主要科研插件。"
    },
    "Search scientific papers, clinical trials, FDA records, and historical texts.": {
      "plugin": "scientific-literature",
      "translation": "搜索科研论文、临床试验、FDA 记录和历史文献。"
    },
    "SEO workflows on live Semrush data: keyword research, site audits, backlinks, competitor, traffic and market analytics, PPC, and AI brand visibility.": {
      "plugin": "semrush",
      "marketplace": "antigravity-plugins-partners",
      "translation": "基于实时 Semrush 数据开展 SEO 工作，涵盖关键词研究、网站审计、外链、竞争对手、流量、市场、PPC 和 AI 品牌曝光分析。"
    },
    "Query your SentinelOne Singularity Console from Antigravity through a self-hosted, read-only Purple AI MCP server. Requires an active console deployment, your console URL, and an API token.": {
      "plugin": "sentinelone-purple-mcp",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过自托管的只读 Purple AI MCP 服务器，在 Antigravity 中查询 SentinelOne Singularity 控制台。需要可用的控制台、其地址和 API 令牌。"
    },
    "Set up Sentry monitoring, investigate production errors, and configure alerts and releases with expert skills and live context from your Sentry projects.": {
      "plugin": "sentry",
      "marketplace": "antigravity-plugins-partners",
      "translation": "借助专业技能和 Sentry 项目的实时上下文，设置监控、排查生产错误并配置告警和发布版本。"
    },
    "Triage Exabeam New-Scale alerts and cases end to end: gather the evidence, map MITRE, reach a verdict, and record it behind an approval step.": {
      "plugin": "soc",
      "marketplace": "antigravity-plugins-partners",
      "translation": "处理 Exabeam New-Scale 告警和事件，收集证据、映射 MITRE 框架、作出判断，并在获得批准后记录结果。"
    },
    "SonarQube is the AI code quality and security verification platform used by millions of developers to catch bugs, vulnerabilities, and leaked secrets. This plugin enforces those standards in the agent coding loop: 7,500+ distinct issue types, secrets scanning, agentic analysis, and quality gates across 40+ languages.": {
      "plugin": "sonarqube",
      "marketplace": "antigravity-plugins-partners",
      "translation": "SonarQube 是 AI 代码质量与安全验证平台，数百万开发者用它发现缺陷、漏洞和泄露的密钥。此插件在智能体编程流程中应用这些标准，覆盖 40 多种语言，提供 7,500 多种问题类型、密钥扫描、智能体分析和质量门禁。"
    },
    "Turn an idea into a website, dashboard, report, or small web tool you can share. Build it in chat or bring your own work, and publish it with Spacefast.": {
      "plugin": "spacefast",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将想法变成可分享的网站、仪表板、报告或小型 Web 工具。可在对话中构建，也可导入已有成果，再通过 Spacefast 发布。"
    },
    "Accept payments and grow your business. Stripe's official MCP server enables AI agents to manage customers, products, prices, payment links, invoices, subscriptions, and refunds, as well as search Stripe documentation.": {
      "plugin": "stripe",
      "marketplace": "antigravity-plugins-partners",
      "translation": "使用 Stripe 收款并发展业务。官方 MCP 服务器支持管理客户、产品、价格、付款链接、发票、订阅和退款，以及搜索 Stripe 文档。"
    },
    "AlphaFold, 3D visualization tools, and protein databases to explore protein structures, sequences, pathways, and drug interactions.": {
      "plugin": "structural-biology",
      "translation": "借助 AlphaFold、三维可视化工具和蛋白质数据库，探索蛋白质的结构、序列、通路及药物相互作用。"
    },
    "Official Supabase plugin for Antigravity with Supabase skills and MCP access for project management, database work, auth, storage, and Postgres best practices.": {
      "plugin": "supabase",
      "marketplace": "antigravity-plugins-partners",
      "translation": "Supabase 官方 Antigravity 插件，提供项目管理、数据库、认证、存储及 Postgres 最佳实践技能，并支持 MCP 访问。"
    },
    "Make your coding agent a better engineer": {
      "plugin": "superpowers",
      "marketplace": "antigravity-plugins-partners",
      "translation": "提升编程智能体的工程实践能力。"
    },
    "Unlock the power of agent swarms.": {
      "plugin": "swarm",
      "builtin": true,
      "translation": "发挥多智能体协作的优势。"
    },
    "Web search, content extraction, website crawling, URL discovery, and deep research for Antigravity via Tavily's hosted MCP server and skills.": {
      "plugin": "tavily",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Tavily 托管的 MCP 服务器和技能，在 Antigravity 中搜索网页、提取内容、抓取网站、发现网址并进行深入研究。"
    },
    "Run, debug and triage tests on the TestMu AI cloud, plus Kane CLI for browser and mobile test automation and Rook CLI for testing AI agents.": {
      "plugin": "testmu-ai",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 TestMu AI 云平台运行、调试和初步排查测试。包含用于浏览器和移动端自动化测试的 Kane CLI，以及用于测试 AI 智能体的 Rook CLI。"
    },
    "Official Trello plugin with the Trello MCP server and a skill for boards, lists, cards, checklists, Inbox, and Planner.": {
      "plugin": "trello",
      "marketplace": "antigravity-plugins-partners",
      "translation": "Trello 官方插件，包含 MCP 服务器及用于看板、列表、卡片、清单、收件箱与计划器的技能。"
    },
    "Unity's official plugin for Antigravity, with curated skills for game development, monetization, and performance optimization.": {
      "plugin": "unity",
      "marketplace": "antigravity-plugins-partners",
      "translation": "Unity 官方 Antigravity 插件，精选游戏开发、商业化和性能优化技能。"
    },
    "Build and deploy web apps and AI agents on Vercel with skills for Next.js, AI SDK, and cloud services, plus the official Vercel MCP server.": {
      "plugin": "vercel-plugin",
      "marketplace": "antigravity-plugins-partners",
      "translation": "使用 Next.js、AI SDK 和云服务技能，在 Vercel 构建并部署 Web 应用与 AI 智能体。包含 Vercel 官方 MCP 服务器。"
    },
    "Investigate files, URLs, domains and IP addresses with VirusTotal threat intelligence, analysis and submission recovery.": {
      "plugin": "virustotal",
      "marketplace": "antigravity-plugins-partners",
      "translation": "利用 VirusTotal 的威胁情报、分析结果及历史提交记录调查文件、URL、域名和 IP 地址。"
    },
    "Search and read your Wispr Flow meeting notes, transcripts, scratchpad notes, and calendar events. Read-only access to your own account.": {
      "plugin": "wispr-flow",
      "marketplace": "antigravity-plugins-partners",
      "translation": "搜索并阅读 Wispr Flow 会议笔记、转写、便笺和日历事件。仅对自己的账号提供只读访问。"
    },
    "Build Wix apps and headless sites, and manage Wix stores, bookings, CMS and more, with Wix CLI skills and the official Wix MCP server.": {
      "plugin": "wix",
      "marketplace": "antigravity-plugins-partners",
      "translation": "使用 Wix CLI 技能和官方 MCP 服务器构建 Wix 应用和无头网站，管理商店、预约和 CMS 等功能。"
    },
    "Build, publish, and manage WordPress.com and Jetpack-connected sites. Draft posts, edit blocks, check traffic stats, moderate comments, and manage plugins.": {
      "plugin": "wordpress",
      "marketplace": "antigravity-plugins-partners",
      "translation": "构建、发布和管理 WordPress.com 与连接 Jetpack 的网站。支持起草文章、编辑区块、查看流量、审核评论和管理插件。"
    },
    "Automate workflows across 10,000+ apps. Run one-off actions or build automations for YouTube, Instagram, Gmail, Facebook Pages, LinkedIn, Slack, Pinterest.": {
      "plugin": "zapier",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 1 万款以上的应用之间实现工作流自动化。可为 YouTube、Instagram、Gmail、Facebook 公共主页、LinkedIn、Slack 和 Pinterest 执行单次操作或创建自动化流程。"
    },
    "Connect 9,000+ apps to your AI workflow. Discover, enable, and execute Zapier actions and workflows directly from your client.": {
      "plugin": "zapier",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将 9,000 多款应用接入 AI 工作流，直接在客户端查找、启用并执行 Zapier 操作和流程。"
    },
    "Manage your Bigin CRM from Antigravity: review pipelines, find contacts and deals, log calls, plan follow-ups, and email customers.": {
      "plugin": "zoho-bigin",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Antigravity 中管理 Bigin CRM，查看销售流程，查找联系人和商机，记录通话，安排跟进并给客户发邮件。"
    },
    "Build on Zoho CRM v8: REST API, Deluge functions, ClientScript, widgets, COQL and connections, with live CRM data through your Zoho MCP server.": {
      "plugin": "zoho-crm-plugin",
      "marketplace": "antigravity-plugins-partners",
      "translation": "在 Zoho CRM v8 上开发，支持 REST API、Deluge 函数、ClientScript、小组件、COQL 和连接，并通过 Zoho MCP 服务器访问实时 CRM 数据。"
    },
    "Zoho Desk plugin for Antigravity. Review, prioritize, and update Zoho Desk tickets directly from Antigravity through Zoho Desk MCP and includes a Ticket Prioritization Agent for triage and priority updates.": {
      "plugin": "zoho-desk-antigravity",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Zoho Desk MCP 在 Antigravity 中查看、排序和更新工单。包含用于初筛和调整优先级的工单智能体。"
    },
    "Connect Zoho Projects to Antigravity to turn tasks and issues into working code. Access project context, investigate bugs, and update work items as you develop.": {
      "plugin": "zoho-projects",
      "marketplace": "antigravity-plugins-partners",
      "translation": "将 Zoho Projects 接入 Antigravity，把任务和问题落实到代码。开发期间可获取项目上下文、排查故障并更新工作项。"
    },
    "Run Zoho Books from Antigravity: invoicing, bills, banking, journals, projects, items, taxes, customization and automation.": {
      "plugin": "zohobooks-antigravity",
      "marketplace": "antigravity-plugins-partners",
      "translation": "通过 Antigravity 使用 Zoho Books，处理发票、账单、银行业务、会计分录、项目、商品、税务、自定义和自动化。"
    }
  };
  {
    const canonicalZhToEn = [
      ['新增', 'New'],
      ['新建', 'New'],
      ['新建会话', 'New Conversation'],
      ['自动化', 'Automations'],
      ['自定义扩展', 'Customizations'],
      ['项目列表', 'Projects'],
      ['设置', 'Settings'],
      ['扩展', 'Extensions'],
      ['扩展插件', 'Extensions'],
      ['收件箱', 'Inbox'],
      ['文件列表', 'Files'],
      ['概览', 'Overview'],
      ['无限', 'Turbo'],
      ['无限模式', 'Turbo mode'],
      ['极速', 'Turbo'],
      ['极速模式', 'Turbo mode'],
      ['智能体权限预设选择器，当前：极速', 'Agent permissions preset selector, current: Turbo'],
      ['智能体权限预设选择器，当前：无限', 'Agent permissions preset selector, current: Turbo'],
      ['智能规划', 'Planning'],
      ['快速执行', 'Fast'],
      ['日常辦公', 'Knowledge Work'],
      ['标准', 'Default'],
      ['自动', 'Auto'],
      ['请求审核', 'Request Review'],
      ['始终继续', 'Always Proceed']
    ];
    for (const [k, v] of phrases.entries()) {
      const trimmedV = String(v || '').trim();
      if (!trimmedV || !k) continue;
      if (!zhToEnFallback.has(trimmedV)) zhToEnFallback.set(trimmedV, k);
    }
    for (const [zhK, enV] of canonicalZhToEn) {
      zhToEnFallback.set(zhK, enV);
    }
  }

  // 词条正则缓存
  const regexCache = new Map();
  function getPhraseRegex(source) {
    let cached = regexCache.get(source);
    if (!cached) {
      const escaped = source.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
      const startsWord = /^[A-Za-z0-9]/.test(source);
      const endsWord = /[A-Za-z0-9]$/.test(source);
      cached = new RegExp((startsWord ? '(?<![A-Za-z0-9])' : '') + escaped + (endsWord ? '(?![A-Za-z0-9])' : ''), 'g');
      regexCache.set(source, cached);
    }
    return cached;
  }

  const traditionalSkillDescriptions = new Map([
    ["Manage local Antigravity conversations programmatically over HTTP+JSON: create a new conversation (with an optional initial prompt), list conversations, read conversation metadata and run state, rename, archive, pin, star, tag, or group conversations, and delete conversations. Use when the user asks to list, rename, pin, star, archive, delete, or start conversations, including the current one, or when a script, plugin, or automation needs to manage conversations outside of subagent tool calls.", "透過 HTTP+JSON 以程式管理本機 Antigravity 工作階段：建立工作階段（可附初始提示詞）、列出工作階段、讀取中繼資料及執行狀態、重新命名、封存、釘選、加上星號、標籤或分組，以及刪除工作階段。當使用者要求列出、重新命名、釘選、加星號、封存、刪除或建立工作階段（包含目前的工作階段）時使用；也適用於指令碼、外掛或自動化程式需要在子代理工具呼叫之外管理工作階段。"],
    ["Build, package, and debug MCP Apps for Antigravity: MCP server tools whose results render as interactive UI in the conversation, in the side pane, or full-page from the sidebar. Use when adding a UI to an MCP tool, building or theming the app itself, packaging it as a plugin, or debugging an app that doesn't render or behave as expected.", "為 Antigravity 建置、封裝及除錯 MCP App。MCP App 是其工具結果可在工作階段、側邊窗格或側欄開啟的全頁畫面中呈現互動介面的 MCP 伺服器工具。當需要為 MCP 工具加入介面、建置或設定 App 主題、將 App 封裝為外掛，或除錯無法正常呈現或運作的 App 時使用。"],
    ["ONLY for the coordinator of an active /swarm session. What the coordinator writes so the Swarm UI's Overview can show the swarm's goal, its groups of work and a screenshot timeline; load it before you brief and add the first workers. Outside /swarm, do not load this.", "僅供進行中的 /swarm 工作階段協調者使用。本技能說明協調者應寫入哪些資訊，讓 Swarm 介面的「總覽」顯示群組目標、工作分組及螢幕截圖時間軸；請在簡報並加入第一批工作成員之前載入。在 /swarm 之外請勿載入。"],
    ["ONLY for the native-swarm worker whose brief says it is the narrator. It watches the board and keeps the facts behind the user's Overview (view.json) current. Coordinators and other workers: do not load this.", "僅供任務說明中指定為敘述者的原生 Swarm 成員使用。此成員會監看共用看板，並持續更新使用者「總覽」（view.json）所依據的資訊。協調者與其他成員請勿載入此技能。"],
  ]);

  // 精准独立词汇匹配（支持快捷键与末尾标点），防止短词在长句中误伤
  function matchExactPhrase(trimmed) {
    if (lang === 'zh-TW' && traditionalSkillDescriptions.has(trimmed)) return traditionalSkillDescriptions.get(trimmed);
    if (lang === 'zh-TW' && trimmed === 'Knowledge Work') return '日常辦公';
    if (phrases.has(trimmed)) return phrases.get(trimmed);
    const low = trimmed.toLowerCase();
    if (lowerPhrases.has(low)) return lowerPhrases.get(low);

    // 快捷键: 如 Save (Ctrl+S) 或 Save (⌘S)
    const scMatch = trimmed.match(/^(.+?)\s*\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\+?([^)]*)\)$/i);
    if (scMatch) {
      const prefix = scMatch[1].trim();
      if (phrases.has(prefix)) return phrases.get(prefix) + ` (${scMatch[2]}${scMatch[3] ? '+' + scMatch[3] : ''})`;
      if (lowerPhrases.has(prefix.toLowerCase())) return lowerPhrases.get(prefix.toLowerCase()) + ` (${scMatch[2]}${scMatch[3] ? '+' + scMatch[3] : ''})`;
    }
    // 常见标点：冒号、省略号、问号、感叹号
    const puncMatch = trimmed.match(/^(.+?)([:：\?？!！…]+|\.{3,})$/);
    if (puncMatch) {
      const prefix = puncMatch[1].trim();
      if (phrases.has(prefix)) return phrases.get(prefix) + puncMatch[2];
      if (lowerPhrases.has(prefix.toLowerCase())) return lowerPhrases.get(prefix.toLowerCase()) + puncMatch[2];
    }
    return null;
  }

  const progressVerbs = {
    exploring: '正在探索', explored: '已探索',
    editing: '正在编辑', edited: '已编辑',
    running: '正在运行', ran: '已运行',
    searching: '正在搜索', searched: '已搜索',
    reading: '正在读取', read: '已读取'
  };
  const progressNouns = new Map([
    ['file', ['文件', '个']], ['files', ['文件', '个']],
    ['folder', ['文件夹', '个']], ['folders', ['文件夹', '个']],
    ['command', ['命令', '个']], ['commands', ['命令', '个']],
    ['artifact', ['产物', '个']], ['artifacts', ['产物', '个']],
    ['search', ['搜索', '次']], ['searches', ['搜索', '次']],
    ['task', ['任务', '个']], ['tasks', ['任务', '个']],
    ['page', ['网页', '个']], ['pages', ['网页', '个']],
    ['image', ['图片', '张']], ['images', ['图片', '张']],
    ['action', ['操作', '项']], ['actions', ['操作', '项']],
  ]);
  const progressPartRegex = /^(exploring|explored|editing|edited|running|ran|searching|searched|reading|read)(?:\s*(?:(\d+)\s+)?(files?|folders?|commands?|artifacts?|searches?|tasks?|pages?|images?|actions?))?$/i;

  // 智能体任务动态状态栏（例如：Exploring files, running commands ⌵）
  function translateAgentProgress(str) {
    if (!str) return null;
    const clean = str.trim().replace(/\s*[⌵▼▾ˇ⌄\u2304\u25be\u25bc\u25bd]\s*$/, '').trim();

    const parts = clean.split(/\s*,\s*/);
    if (parts.length === 0) return null;

    const translatedParts = [];
    for (const part of parts) {
      const m = part.trim().match(progressPartRegex);
      if (!m) return null;
      const verbKey = m[1].toLowerCase();
      const v = progressVerbs[verbKey] || m[1];
      const count = m[2];
      const nounRaw = m[3];
      if (!nounRaw) {
        if (!/^(exploring|explored|editing|edited)$/.test(verbKey)) return null;
        translatedParts.push(v);
        continue;
      }
      const nounKey = nounRaw.toLowerCase();
      const nounEntry = progressNouns.get(nounKey);
      const n = nounEntry ? nounEntry[0] : nounRaw;
      const unit = nounEntry ? nounEntry[1] : '个';
      if (count !== undefined) {
        translatedParts.push(`${v} ${count} ${unit}${n}`);
      } else {
        translatedParts.push(`${v}${n}`);
      }
    }

    const trailingSuffix = str.endsWith(clean) ? '' : str.slice(str.indexOf(clean) + clean.length);
    return translatedParts.join('，') + trailingSuffix;
  }

  function formatRelativeTime(str) {
    if (!str) return str;
    return str
      .replace(/(\d+)\s*years?\b/gi, (_m, n) => n + ' 年')
      .replace(/(\d+)\s*months?\b/gi, (_m, n) => n + ' 个月')
      .replace(/(\d+)\s*weeks?\b/gi, (_m, n) => n + ' 周')
      .replace(/(\d+)\s*days?\b/gi, (_m, n) => n + ' 天')
      .replace(/(\d+)\s*hours?\b/gi, (_m, n) => n + ' 小时')
      .replace(/(\d+)\s*minutes?\b/gi, (_m, n) => n + ' 分钟')
      .replace(/(\d+)\s*seconds?\b/gi, (_m, n) => n + ' 秒')
      .replace(/,\s*/g, ' ')
      .trim();
  }

  // 仅格式化已确认模板中完整的日期字段，不改写路径、名称等用户数据。
  const englishMonths = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const englishDateRegex = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/;
  function localizeEnglishDates(str) {
    return str.replace(englishDateRegex, (match, month, day, year) => {
      const m = englishMonths[month.slice(0, month.toLowerCase() === 'sept' ? 4 : 3).toLowerCase()];
      const d = Number(day);
      if (!m || d < 1 || d > 31) return match;
      return year ? `${year} 年 ${m} 月 ${d} 日` : `${m} 月 ${d} 日`;
    });
  }

  function formatShortDuration(str) {
    return str
      .trim()
      .replace(/(\d+)\s*d\b/gi, '$1 天')
      .replace(/(\d+)\s*h\b/gi, '$1 小时')
      .replace(/(\d+)\s*m\b/gi, '$1 分钟')
      .replace(/(\d+)\s*s\b/gi, '$1 秒')
      .replace(/\s+/g, ' ');
  }

  const permissionScopes = {
    'when not in a project': '不在项目中时',
    'in this conversation': '在此对话中',
    'in this project': '在此项目中',
    'in this workspace': '在此工作区',
    globally: '全局',
  };
  const permissionActions = {
    'read access to this path': '读取此路径',
    'write access to this path': '写入此路径',
    'reading this URL': '读取此 URL',
    'executing actions on this URL': '在此 URL 上执行操作',
    'running this command outside the sandbox': '在沙盒外运行此命令',
    'running this command': '运行此命令',
    'using this MCP tool': '使用此 MCP 工具',
    'run (unsandboxed)': '在沙盒外运行',
    'grant administrator access for': '授予管理员权限',
    run: '运行',
    read: '读取',
    write: '写入',
    use: '使用',
    access: '访问',
  };

  // 权限目标属于数据：只翻译模板，并立即返回，禁止后续规则改写命令/路径。
  function translatePermission(value) {
    const text = value.trim();
    // MutationObserver 会再次观察到翻译后的文本；二次处理也须保持目标不变。
    if (/^(正在请求权限：|智能体需要权限才能|是，并.*(?:保存|始终允许)|保存规则以始终允许\s|与您配置的询问权限冲突：|需要手动确认：|允许\s)/s.test(text)) return value;
    let m, translated;
    if ((m = text.match(/^Requesting permission to (running this command outside the sandbox|running this command|read access to this path|write access to this path|reading this URL|executing actions on this URL|using this MCP tool|run \(unsandboxed\)|grant administrator access for|run|read|write|use|access) ([\s\S]+)$/))) {
      translated = '正在请求权限：' + permissionActions[m[1]] + ' ' + m[2];
    } else if ((m = text.match(/^Agent needs permission to execute JavaScript on ([\s\S]+)$/))) {
      translated = '智能体需要权限才能在 ' + m[1] + ' 上执行 JavaScript';
    } else if ((m = text.match(/^Agent needs permission to act on ([\s\S]+)$/))) {
      translated = '智能体需要权限才能操作 ' + m[1];
    } else if ((m = text.match(/^Yes, save rule for '([\s\S]*)' (when not in a project|in this conversation|in this project|in this workspace|globally)$/))) {
      translated = `是，并${permissionScopes[m[2]]}保存 '${m[1]}' 的规则`;
    } else if ((m = text.match(/^Yes, save rule (when not in a project|in this conversation|in this project|in this workspace|globally)$/))) {
      translated = `是，并${permissionScopes[m[1]]}保存规则`;
    } else if ((m = text.match(/^Yes, and always allow '([\s\S]*)'(?: (when not in a project|in this conversation|in this project|in this workspace|globally))?$/))) {
      translated = `是，并${permissionScopes[m[2]] || ''}始终允许 '${m[1]}'`;
    } else if ((m = text.match(/^Yes, and always allow(?: (when not in a project|in this conversation|in this project|in this workspace|globally))?$/))) {
      translated = `是，并${permissionScopes[m[1]] || ''}始终允许`;
    } else if ((m = text.match(/^Conflicts with your configured Ask permission: ([\s\S]+)$/))) {
      translated = '与您配置的询问权限冲突：' + m[1];
    } else if ((m = text.match(/^Requires manual confirmation: ([\s\S]+)$/))) {
      translated = '需要手动确认：' + m[1];
    } else if (!phrases.has(text) && !lowerPhrases.has(text.toLowerCase()) && (m = text.match(/^Save rule to always allow ([\s\S]+)\?$/))) {
      translated = '保存规则以始终允许 ' + m[1] + '？';
    } else if (!phrases.has(text) && !lowerPhrases.has(text.toLowerCase()) && (m = text.match(/^Allow ([\s\S]+)$/)) && !/^(?:Non-Flow|[a-z]+ing\s|[a-z]+\s+to\s)/i.test(m[1])) {
      translated = '允许 ' + m[1];
    } else if (/^(Requesting permission to |Agent needs permission to |Yes, (?:save rule|and always allow)|Conflicts with your configured Ask permission: |Requires manual confirmation: )/.test(text)) {
      return value; // 新版未知权限模板保留原文，不能冒险翻译其中的目标。
    } else {
      return null;
    }
    return value.replace(text, () => translated); // 回调避免目标中的 $& / $' 被当作替换指令。
  }

  // 工具步骤中的查询、URL、文件模式和工具名是变量，整体匹配后立即返回。
  const activityPrefixes = [
    ['Read URL: ', '已读取 URL：'], ['Searched web: ', '已搜索网页：'],
    ['Searched for files: ', '已搜索文件：'], ['Invoked subagent: ', '已调用子智能体：'],
    ['Used MCP tool: ', '已使用 MCP 工具：'], ['Forked from ', '派生自 '],
  ];
  function translateActivity(value) {
    const text = value.trim();
    if (/^(?:已读取 URL：|已搜索网页：|已搜索文件：|已调用子智能体：|已使用 MCP 工具：|派生自 )/.test(text) ||
        /^正在使用浏览器(?: · [\s\S]+)?（\d+ 秒）$/.test(text)) return value;
    for (const [prefix, translated] of activityPrefixes) {
      if (text.startsWith(prefix) && text.length > prefix.length) {
        return value.replace(text, () => translated + text.slice(prefix.length));
      }
    }
    const browser = text.match(/^Using browser(?: · ([\s\S]+))? \((\d+)s\)$/);
    if (browser) return value.replace(text, () => `正在使用浏览器${browser[1] ? ` · ${browser[1]}` : ''}（${browser[2]} 秒）`);
    const earlier = text.match(/^Show (\d+) earlier steps$/);
    if (earlier) return value.replace(text, () => `显示更早的 ${earlier[1]} 个步骤`);
    return null;
  }

  // 动态变量与模板匹配（仅针对含捕获组、时间、计算等动态规则）
  const dynamicPatterns = [

    // 只翻译示例前缀，保留多行占位符中的 Shell 命令。
    [/^(\s*)example:(\r?\n)source ~\/\.jetski_shell_setup(\s*)$/i, (_m, before, newline, after) => `${before}示例：${newline}source ~/.jetski_shell_setup${after}`],

    // 动态时间与耗时
    [/Worked for ((?:\d+\s*[dhms]\b\s*)+)/gi, (_m, dur) => '已工作 ' + formatShortDuration(dur)],
    [/Stopped after ((?:\d+\s*[dhms]\b\s*)+)/gi, (_m, dur) => '工作 ' + formatShortDuration(dur) + '后停止'],
    [/Thought for ((?:\d+\s*[dhms]\b\s*)+)/gi, (_m, dur) => '已思考 ' + formatShortDuration(dur)],
    [/Thinking for ((?:\d+\s*[dhms]\b\s*)+)/gi, (_m, dur) => '已思考 ' + formatShortDuration(dur)],
    [/Compacting \u00b7 ((?:\d+\s*[dhms]\b\s*)+)/gi, (_m, dur) => '正在压缩上下文 · ' + formatShortDuration(dur)],
    [/Fold lines (\d+)-(\d+)/g, '折叠第 $1-$2 行'],
    [/(\d+)\s*minutes?\s*ago\b/gi, '$1 分钟前'],
    [/(\d+)\s*hours?\s*ago\b/gi, '$1 小时前'],
    [/(\d+)\s*days?\s*ago\b/gi, '$1 天前'],
    [/(\d+)\s*weeks?\s*ago\b/gi, '$1 周前'],
    [/(\d+)\s*months?\s*ago\b/gi, '$1 个月前'],
    [/(\d+)\s*years?\s*ago\b/gi, '$1 年前'],
    [/^about (\d+\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?))$/gi, (_m, dur) => '大约 ' + formatRelativeTime(dur)],
    [/^over (\d+\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?))$/gi, (_m, dur) => '超过 ' + formatRelativeTime(dur)],
    [/^almost (\d+\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?))$/gi, (_m, dur) => '将近 ' + formatRelativeTime(dur)],
    [/^Don't show this for (\d+)\s*days?$/gi, '$1 天内不再显示'],
    [/Refreshes in (.+)/gi, (_m, time) => `${formatRelativeTime(time)}后刷新`],
    [/You have used (some|all) of your (weekly|5-hour) limit, it will (?:fully )?refresh in (.+?)\.?$/gi, (_m, qty, type, time) => {
      const isAll = qty.toLowerCase() === 'all';
      const typeZh = type.toLowerCase() === 'weekly' ? '周' : ' 5 小时';
      const action = isAll ? '已用尽' : '已使用部分';
      return `您${action}${typeZh}额度，将在 ${formatRelativeTime(time)}后完全刷新。`;
    }],
    [/^(\d+\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?)(?:,\s*\d+\s*(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?))*)$/gi, (_m, dur) => formatRelativeTime(dur)],

    // 动态用量与数量词
    [/(\d+(?:\.\d+)?)% of the customization budget is available\./g, '自定义预算还剩 $1%。'],
    [/(\d+)\s*agents running/g, '$1 个代理正在运行'],
    [/See all \((\d+)\)/g, '查看全部 ($1)'],
    [/^Send all \((\d+)\)$/g, '全部发送 ($1)'],
    [/Modified in (\d+)\s*(?:projects?|项目)/gi, '已在 $1 个项目中自定义'],
    [/^(\d+)\s*projects?$/i, '$1 个项目'],
    [/Show (\d+)\s*breakdowns?/gi, '显示 $1 个明细'],
    [/Load older messages, showing (\d+) of (\d+)/g, '加载更早的消息，显示 $1 / $2'],
    [/No more older messages, showing (\d+) of (\d+)/g, '没有更早的消息了，显示 $1 / $2'],
    [/showing (\d+) of (\d+)/gi, '显示 $1 / $2'],
    [/^Folder has more than (\d+)\s*files?$/gi, '文件夹包含超过 $1 个文件'],
    [/^(\d+)\s*files?\s+changed$/gi, '$1 个文件已更改'],
    [/(\d+) files?, (\d+) folders?/gi, '$1 个文件, $2 个文件夹'],
    [/(\d+) files?, (\d+) searches?/gi, '$1 个文件, $2 次搜索'],
    [/^(\d+)\s*folders?$/gi, '$1 个文件夹'],
    [/^(\d+)\s*files?$/gi, '$1 个文件'],
    [/^(\d+)\s*searches?$/gi, '$1 次搜索'],
    [/^(\d+)\s*search\b$/gi, '$1 次搜索'],
    [/^(\d+)\s*tokens?$/gi, '$1 个 Token'],
    [/^(\d+)d$/g, '$1天'],
    [/^(\d+)m$/g, '$1分钟'],
    [/^(\d+)s$/g, '$1秒'],

    // 动态下拉与控件参数
    [/Toggle Agent(\s*\([^)]+\))?/g, '切换智能体$1'],
    [/^Toggle (.+)$/g, '切换 $1'],
    [/^(\d+)\s*mo$/gi, '$1 个月前'],
    [/^See (\d+) more$/g, '查看其余 $1 个'],
    [/^Install (.+)$/g, '安装 $1'],
    [/^More actions for (.+)$/g, '$1 的更多操作'],
    [/Select (Next|Previous) (Conversation|对话)/g, (_m, dir) => `选择${dir === 'Next' ? '下一个' : '上一个'}对话`],
    [/^Select model, current: (.+)$/g, (_m, name) => '选择模型，当前：' + name.replace(/\b(High|Medium|Low)\b/g, (label) => phrases.get(label) ?? label)],
    [/^Select project, current: (.+)$/g, (_m, name) => '选择项目，当前：' + (matchExactPhrase(name) ?? name)],
    [/^Agent permissions preset selector, current: (.+)$/g, (_m, name) => '智能体权限预设选择器，当前：' + (matchExactPhrase(name) ?? name)],
    [/^Inherits your (?:Global Permissions|全局权限) when working in these conversations\.$/g, '在这些对话中工作时继承您的全局权限。'],
    [/^(Rules|Skills): (\d+) tokens$/g, (_m, type, count) => `${type === 'Rules' ? '规则' : '技能'}：${count} 个 Token`],
    [/Your Plan:\s*(.+)/g, '你的套餐：$1'],
    [/Autocomplete Speed:\s*(.+)/g, '补全速度: $1'],
    [/Send feedback as (.+)/g, '以 $1 发送反馈'],
    [/Gemini ([^(]+) \((High|Medium|Low)\)/g, (_match, model, effort) => {
      const efforts = { High: '高', Medium: '中', Low: '低' };
      return 'Gemini ' + model.trim() + ' (' + (efforts[effort] ?? effort) + ')';
    }],
    [/^(Learn more|了解更多) about\s*(.+)$/g, '了解更多关于 $2'],

    // yiheng8023/antigravity-chinese v3.3.48 (2.32.1) 新增整行锚定动态规则 (239 条)
    [new RegExp("^Start Best-of-(\\d+)$", "i"), "启动 Best-of-$1"],
    [new RegExp("^No MCP servers found for \"(.*)\"$", "i"), "未找到匹配“$1”的 MCP 服务器"],
    [new RegExp("^Permanently delete (.+) including (\\d+) conversations?\\.$", "i"), "永久删除 $1 及其中的 $2 个会话。"],
    [new RegExp("^(\\d+) selected$", "i"), "已选 $1 项"],
    [new RegExp("^(\\d+) plugins available\\.$", "i"), "有 $1 个可用插件"],
    [new RegExp("^(\\d+) resources$", "i"), "$1 项资源"],
    [new RegExp("^Work locally on (.+)$", "i"), "在 $1 上本地工作"],
    [new RegExp("^Worktree from (.+?), and reuse (.+)$", "i"), "从 $1 创建工作树，并复用 $2"],
    [new RegExp("^(\\d+) on for this conversation$", "i"), "本会话已启用 $1 项"],
    [new RegExp("^(\\d+) on$", "i"), "已启用 $1 项"],
    [new RegExp("^(\\d+) tool$", "i"), "$1 个工具"],
    [new RegExp("^View archived in the sidebar\\s*\\((.*?)\\s*menu\\)\\.?$", "i"), "可在侧边栏查看已归档会话（$1 菜单）。"],
    [new RegExp("^(\\d+)\\s+turns?$", "i"), "$1 个轮次"],
    [new RegExp("^(?:Turn|turn)\\s+(\\d+)$", "i"), "第 $1 轮"],
    [new RegExp("^(\\d+)\\s+of\\s+(\\d+)$", "i"), "第 $1 轮（共 $2 轮）"],
    [new RegExp("^\\((\\d+)\\s+image\\s+attachments?\\)$", "i"), "($1 个图片附件)"],
    [new RegExp("^(\\d+)\\s+image\\s+attachments?$", "i"), "$1 个图片附件"],
    [new RegExp("^\\((\\d+)\\s+attachments?\\)$", "i"), "($1 个附件)"],
    [new RegExp("^(\\d+)\\s+attachments?$", "i"), "$1 个附件"],
    [new RegExp("^\\((\\d+)\\s+file\\s+attachments?\\)$", "i"), "($1 个文件附件)"],
    [new RegExp("^(\\d+)\\s+file\\s+attachments?$", "i"), "$1 个文件附件"],
    [new RegExp("^Background Commands\\s+(\\d+)\\s*>$", "i"), "后台命令 $1 >"],
    [new RegExp("^Background Commands\\s+(\\d+)$", "i"), "后台命令 $1"],
    [new RegExp("^Background Commands\\s*\\((\\d+)\\)$", "i"), "后台命令 ($1)"],
    [new RegExp("^Thought\\s+for\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已思考 $1 小时 $2 分 $3 秒"],
    [new RegExp("^Thought\\s+for\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m$", "i"), "已思考 $1 小时 $2 分钟"],
    [new RegExp("^Thought\\s+for\\s+(\\d+)\\s*h$", "i"), "已思考 $1 小时"],
    [new RegExp("^Thought\\s+for\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已思考 $1 分 $2 秒"],
    [new RegExp("^Thought\\s+for\\s+(\\d+)\\s*m$", "i"), "已思考 $1 分钟"],
    [new RegExp("^Thought\\s+for\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已思考 $1 秒"],
    [new RegExp("^See all\\s+(\\d+)$", "i"), "查看全部 $1 项"],
    [new RegExp("^\\((\\d+)\\s+subagents?\\)$", "i"), "($1 个子智能体)"],
    [new RegExp("^(\\d+)\\s+subagents?$", "i"), "$1 个子智能体"],
    [new RegExp("^(\\d+)\\s+seconds?\\s+ago$", "i"), "$1 秒前"],
    [new RegExp("^(\\d+)[sS]\\s+ago$", "i"), "$1 秒前"],
    [new RegExp("^([\\d\\.]+)% of the customization budget is available\\.$", "i"), "$1% 的自定义扩展预算可用。"],
    [new RegExp("^Show (\\d+) breakdowns?$", "i"), "显示 $1 项明细"],
    [new RegExp("^Hide (\\d+) breakdowns?$", "i"), "隐藏 $1 项明细"],
    [new RegExp("^You have used some of your weekly limit, it will fully refresh in (.+)\\.$", "i"), "您已消耗了部分每周额度，将在 $1 后完全重置刷新。"],
    [new RegExp("^You have used some of your 5 hour limit, it will fully refresh in (.+)\\.$", "i"), "您已消耗了部分 5 小时额度，将在 $1 后完全重置刷新。"],
    [new RegExp("^You have hit your 5-hour limit, so the weekly limit does not currently apply\\. Your 5-hour limit will refresh in (.+)\\.$", "i"), "您已达到 5 小时上限，因此每周额度当前不适用。您的 5 小时额度将在 $1 后重置刷新。"],
    [new RegExp("^You have hit your 5-hour limit, it will refresh in (.+)\\. If on a supported paid plan, you can use AI credits in the interim\\.$", "i"), "您已达到 5 小时上限，将在 $1 后重置刷新。如果使用的是支持的付费套餐，您可以在此期间使用 AI 积分。"],
    [new RegExp("^(\\d+) files? changed$", "i"), "$1 个文件已修改"],
    [new RegExp("^(\\d+) insertions?\\(\\+\\)$", "i"), "$1 行新增(+)"],
    [new RegExp("^(\\d+) deletions?\\(-\\)$", "i"), "$1 行删除(-)"],
    [new RegExp("^Step (\\d+) of (\\d+)$", "i"), "第 $1 步（共 $2 步）"],
    [new RegExp("^Task (\\d+) running$", "i"), "正在运行任务 $1"],
    [new RegExp("^Saved at (\\d{1,2}:\\d{2}(?::\\d{2})?)$", "i"), "已于 $1 保存"],
    [new RegExp("^(\\d+) active subagents?$", "i"), "$1 个运行中的子智能体"],
    [new RegExp("^Created (\\d+) files?$", "i"), "已创建 $1 个文件"],
    [new RegExp("^Modified (\\d+) files?$", "i"), "已修改 $1 个文件"],
    [new RegExp("^Thinking for (\\d+)s$", "i"), "已思考 $1 秒"],
    [new RegExp("^Stopped after (\\d+) steps?$", "i"), "已在 $1 步后停止"],
    [new RegExp("^(\\d+(?:\\.\\d+)?)% of the customization budget is available\\.?$", "i"), "$1% 的自定义扩展预算可用。"],
    [new RegExp("^Permanently delete (.*?)\\.?$", "i"), "永久删除 $1。"],
    [new RegExp("^(Enter|Alt\\+Enter|Shift\\+Enter|Ctrl\\+Enter|Cmd\\+Enter)\\s+Queues after the turn$", "i"), "$1 轮次结束后进入排队"],
    [new RegExp("^(Enter|Alt\\+Enter|Shift\\+Enter|Ctrl\\+Enter|Cmd\\+Enter)\\s+Sends immediately$", "i"), "$1 立即发送"],
    [new RegExp("^(Enter|Alt\\+Enter|Shift\\+Enter|Ctrl\\+Enter|Cmd\\+Enter)\\s+On empty prompt,\\s*sends next in queue$", "i"), "$1 在输入框为空时发送队列中的下一条消息"],
    [new RegExp("^Models\\s+within\\s+this\\s+group:?\\s*(.*)$", "i"), "该分组包含的模型：$1"],
    [new RegExp("^Sends\\s+after\\s+agent\\s+finishes\\s+working[。.]?$", "i"), "智能体结束工作后发送"],
    [new RegExp("^Select\\s+Project(\\s+(?:Ctrl|Cmd|Alt|Shift)\\+[\\w;:,\\/\\+\\-]+)?$", "i"), "选择项目$1"],
    [new RegExp("^Select\\s+Model(\\s+(?:Ctrl|Cmd|Alt|Shift)\\+[\\w;:,\\/\\+\\-]+)?$", "i"), "选择模型$1"],
    [new RegExp("^Quick\\s+Start$", "i"), "快速入门"],
    [new RegExp("^Cancel\\s*\\(((?:Ctrl|Cmd|Alt|Shift)\\+[\\w\\+\\-]+)\\)$", "i"), "取消 ($1)"],
    [new RegExp("^Good\\s+response$", "i"), "优质回答"],
    [new RegExp("^Bad\\s+response$", "i"), "不佳回答"],
    [new RegExp("^(\\d+)\\s+tasks?\\s+running$", "i"), "$1 个运行中的任务"],
    [new RegExp("^Explored\\s+(\\d+)\\s+files?$", "i"), "已浏览探索 $1 个文件"],
    [new RegExp("^Ran\\s+(\\d+)\\s+commands?$", "i"), "已运行 $1 个命令"],
    [new RegExp("^Explored\\s+(\\d+)\\s+tasks?$", "i"), "已查看 $1 个任务"],
    [new RegExp("^Timed\\s+(\\d+)\\s+seconds?$", "i"), "已计时 $1 秒"],
    [new RegExp("^Timed\\s+(\\d+)\\s+minutes?$", "i"), "已计时 $1 分钟"],
    [new RegExp("^Whether\\s+the\\s+agent\\s+asks\\s+you\\s+to\\s+review\\s+its\\s+documents[。.]?$", "i"), "智能体在创建产物文档时是否请求您审查。"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已运行 $1 小时 $2 分 $3 秒"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m$", "i"), "已运行 $1 小时 $2 分钟"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*h$", "i"), "已运行 $1 小时"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已运行 $1 分 $2 秒"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*m$", "i"), "已运行 $1 分钟"],
    [new RegExp("^Worked\\s+for\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "已运行 $1 秒"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "在 $1 小时 $2 分 $3 秒后停止"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m$", "i"), "在 $1 小时 $2 分钟后停止"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*h$", "i"), "在 $1 小时后停止"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "在 $1 分 $2 秒后停止"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*m$", "i"), "在 $1 分钟后停止"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+(?:\\.\\d+)?)\\s*s$", "i"), "在 $1 秒后停止"],
    [new RegExp("^Message\\s+from\\s+(.+)$", "i"), "来自 $1 的消息"],
    [new RegExp("^Executing\\s+task:\\s+(.+)$", "i"), "正在执行任务: $1"],
    [new RegExp("^Record Audio(\\s+Ctrl\\+[A-Za-z])$", "i"), "录制音频$1"],
    [new RegExp("^New Terminal(\\s+Ctrl\\+Shift\\+.*?)$", "i"), "新建终端$1"],
    [new RegExp("^Add Terminal(\\s+Ctrl\\+Shift\\+.*?)$", "i"), "添加终端$1"],
    [new RegExp("^Add Context(\\s+.*)$", "i"), "添加上下文$1"],
    [new RegExp("^(\\d+)\\s+agents?\\s+running$", "i"), "$1 个运行中的智能体"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:d|days?)[,\\s]+(\\d+)\\s*(?:h|hours?)[,\\s]+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 天 $2 小时 $3 分钟后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:d|days?)[,\\s]+(\\d+)\\s*(?:h|hours?)[。.]?$", "i"), "$1 天 $2 小时后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:h|hours?)[,\\s]+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 小时 $2 分钟后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:m|mins?|minutes?)[,\\s]+(\\d+)\\s*(?:s|secs?|seconds?)[。.]?$", "i"), "$1 分 $2 秒后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:d|days?)[。.]?$", "i"), "$1 天后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:h|hours?)[。.]?$", "i"), "$1 小时后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 分钟后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+(\\d+)\\s*(?:s|secs?|seconds?)[。.]?$", "i"), "$1 秒后重置"],
    [new RegExp("^[Rr]esets?\\s+in\\s+a\\s+few\\s+seconds[。.]?$", "i"), "几秒后重置"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:d|days?)[,\\s]+(\\d+)\\s*(?:h|hours?)[,\\s]+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 天 $2 小时 $3 分钟后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:d|days?)[,\\s]+(\\d+)\\s*(?:h|hours?)[。.]?$", "i"), "$1 天 $2 小时后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:h|hours?)[,\\s]+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 小时 $2 分钟后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:m|mins?|minutes?)[,\\s]+(\\d+)\\s*(?:s|secs?|seconds?)[。.]?$", "i"), "$1 分 $2 秒后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:d|days?)[。.]?$", "i"), "$1 天后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:h|hours?)[。.]?$", "i"), "$1 小时后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:m|mins?|minutes?)[。.]?$", "i"), "$1 分钟后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+in\\s+(\\d+)\\s*(?:s|secs?|seconds?)[。.]?$", "i"), "$1 秒后重置刷新"],
    [new RegExp("^[Rr]efreshes?\\s+soon[。.]?$", "i"), "即将重置刷新"],
    [new RegExp("^scheduled\\s+tasks\\s+run\\s+as\\s+(.+?)[。.]?$", "i"), "定时任务均以 $1 模型运行。"],
    [new RegExp("^Search\\s+conversations[\\.…]*$", "i"), "搜索会话..."],
    [new RegExp("^Failed\\s+to\\s+revalidate\\s+slash\\s+commands:[\\s]*(.*)$", "i"), "重新验证斜杠命令失败：$1"],
    [new RegExp("^Mark\\s+all\\s+(\\d+)\\s+conversations\\s+as\\s+read$", "i"), "将全部 $1 个会话标记为已读"],
    [new RegExp("^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read$", "i"), "将 $1 个会话标记为已读"],
    [new RegExp("^Are\\s+you\\s+sure\\s+you\\s+want\\s+to\\s+mark\\s+all\\s+(\\d+)\\s+conversations\\s+as\\s+read\\?\\s+This\\s+action\\s+cannot\\s+be\\s+undone\\.?$", "i"), "您确定要将全部 $1 个会话标记为已读吗？此操作无法撤销。"],
    [new RegExp("^Are\\s+you\\s+sure\\s+you\\s+want\\s+to\\s+mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read\\?\\s+This\\s+action\\s+cannot\\s+be\\s+undone\\.?$", "i"), "您确定要将 $1 个会话标记为已读吗？此操作无法撤销。"],
    [new RegExp("^(\\d+)\\s+active\\s+conversations?$", "i"), "$1 个活跃会话"],
    [new RegExp("^(\\d+)\\s+archived\\s+conversations?$", "i"), "$1 个已归档会话"],
    [new RegExp("^(\\d+)\\s+tools?\\s+enabled$", "i"), "已启用 $1 个工具"],
    [new RegExp("^Plugin:\\s*(.*)$", "i"), "插件: $1"],
    [new RegExp("^Build with (.+) Plugins$", "i"), "Build with $1 插件目录"],
    [new RegExp("^Plugins are packaged collections of skills and MCPs to help the Agent in (.+?) work with Google developer products\\.\\s*You can always change your choices in Settings\\.?$", "i"), "插件是技能与 MCP 的打包集合，用于辅助 $1 中的智能体协同使用 Google 开发者产品。您随时可以在“设置”中更改选择。"],
    [new RegExp("^There are currently no Build with (.+) plugins available\\.?$", "i"), "当前暂无可用的 Build with $1 插件。"],
    [new RegExp("^(\\d+)\\s+tools?\\s+disabled$", "i"), "已禁用 $1 个工具"],
    [new RegExp("^Disable\\s+(.+)\\s+tool\\s+for\\s+(.+)$", "i"), "为 $2 禁用 $1 工具"],
    [new RegExp("^Enable\\s+(.+)\\s+tool\\s+for\\s+(.+)$", "i"), "为 $2 启用 $1 工具"],
    [new RegExp("^Auth code for (.+)$", "i"), "$1 的授权码"],
    [new RegExp("^The (.+) MCP server requires configuration parameters before it can be started\\.?$", "i"), "$1 MCP 服务需要先配置参数才能启动。"],
    [new RegExp("^Failed to enable plugin (.+)$", "i"), "启用插件 $1 失败"],
    [new RegExp("^Failed to update agent:\\s*(.+)$", "i"), "更新智能体失败：$1"],
    [new RegExp("^Failed to remove agent:\\s*(.+)$", "i"), "移除智能体失败：$1"],
    [new RegExp("^Failed to remove plugin:\\s*(.+)$", "i"), "移除插件失败：$1"],
    [new RegExp("^Failed to toggle plugin:\\s*(.+)$", "i"), "切换插件状态失败：$1"],
    [new RegExp("^Error updating agent:\\s*(.+)$", "i"), "更新智能体出错：$1"],
    [new RegExp("^Failed to write MCP config:\\s*(.+)$", "i"), "写入 MCP 配置失败：$1"],
    [new RegExp("^Unnamed [Aa]gent (\\d+)$", "i"), "未命名智能体 $1"],
    [new RegExp("^Unnamed [Ss]kill (\\d+)$", "i"), "未命名技能 $1"],
    [new RegExp("^UI Extension (\\d+)$", "i"), "界面扩展 $1"],
    [new RegExp("^Automation (\\d+)$", "i"), "自动化任务 $1"],
    [new RegExp("^Rule (\\d+)$", "i"), "规则 $1"],
    [new RegExp("^Your\\s+plan's\\s+baseline\\s+quota\\s+will\\s+refresh\\s+on\\s+(.+?)\\.\\s+You\\s+can\\s+upgrade\\s+to\\s+a\\s+Google\\s+AI\\s+Ultra\\s+plan\\s+to\\s+receive\\s+higher\\s+rate\\s+limits[。.]?$", "i"), "您的套餐基础配额将于 $1 重置刷新。您可以升级至 Google AI Ultra 以获取更高的请求配额与速率上限。"],
    [new RegExp("^Your\\s+plan's\\s+baseline\\s+quota\\s+will\\s+refresh\\s+on\\s+(.+?)\\.\\s+To\\s+continue\\s+using\\s+this\\s+model\\s+now,\\s*enable\\s+AI\\s+Credit\\s+overages[。.]?$", "i"), "您的套餐基础配额将于 $1 重置刷新。若要立即继续使用此模型，请启用超额 AI 积分计费。"],
    [new RegExp("^Your\\s+plan's\\s+baseline\\s+quota\\s+will\\s+refresh\\s+on\\s+([^.。]+)[。.]?$", "i"), "您的套餐基础配额将于 $1 重置刷新。"],
    [new RegExp("^(?:Model|Your)\\s+quota\\s+will\\s+refresh\\s+on\\s+([^.。]+)[。.]?$", "i"), "您的模型配额将于 $1 重置刷新。"],
    [new RegExp("^You\\s+need\\s+at\\s+least\\s+(\\d+)\\s+AI\\s+Credits\\s+to\\s+send\\s+messages[。.]?$", "i"), "您至少需要 $1 点 AI 积分才能发送消息。"],
    [new RegExp("^To\\s+continue\\s+using\\s+(.+?)\\s+now,\\s*purchase\\s+more\\s+AI\\s+Credits[。.]?$", "i"), "若要立即继续使用 $1，请购买更多 AI 积分。"],
    [new RegExp("^To\\s+continue\\s+using\\s+(.+?)\\s+now,\\s*enable\\s+AI\\s+Credit\\s+overages[。.]?$", "i"), "若要立即继续使用 $1，请启用超额 AI 积分计费。"],
    [new RegExp("^Available\\s+AI\\s+Credits:\\s*(.+)$", "i"), "可用 AI 积分：$1"],
    [new RegExp("^Shared\\s+with:\\s*(.+)$", "i"), "共享模型：$1"],
    [new RegExp("^Your\\s+Plan:\\s*(.+)$", "i"), "当前方案：$1"],
    [new RegExp("^(\\d+)\\s+models\\s+selected$", "i"), "已选择 $1 个模型"],
    [new RegExp("^You have (\\d+) conversations in progress\\. Updating will interrupt them, and they will automatically resume once the update completes\\.$", "i"), "您当前有 $1 个正在进行的会话。更新将暂时中断这些会话，并在更新完成后自动恢复。"],
    [new RegExp("^You have (\\d+) conversations in progress\\. Updating will cancel them and you'll need to manually restart them\\.$", "i"), "您当前有 $1 个正在进行的会话。更新将取消这些会话，更新后您需要手动重新开始。"],
    [new RegExp("^Review permissions for (.+)$", "i"), "审查 $1 的权限"],
    [new RegExp("^(.+) needs a few details from you before it can run\\.$", "i"), "$1 运行前需要您补充几项详细信息。"],
    [new RegExp("^Agents created by (.+) run in a dedicated (?:project|workspace) with its own permissions, which you can change anytime in the (?:project|workspace) settings page\\. On top of those defaults, (.+) requests the access below\\.$", "i"), "由 $1 创建的智能体将在专属工作区中运行并拥有独立权限，您可以随时在设置页面中更改。除默认权限外，$2 还请求以下访问权限。"],
    [new RegExp("^Agents created by (.+) run in a dedicated (?:project|workspace) with its own permissions, which you can change anytime in the (?:project|workspace) settings page\\.$", "i"), "由 $1 创建的智能体将在专属工作区中运行并拥有独立权限，您可以随时在设置页面中更改。"],
    [new RegExp("^On top of those defaults, (.+) requests the access below\\.$", "i"), "除默认权限外，$1 还请求以下访问权限。"],
    [new RegExp("^Failed to load skills:\\s*(.+)$", "i"), "加载技能失败：$1"],
    [new RegExp("^Failed to scan skills config file:\\s*(.+)$", "i"), "扫描技能配置文件失败：$1"],
    [new RegExp("^Failed to load page (\\d+):\\s*(.+)$", "i"), "加载第 $1 页失败：$2"],
    [new RegExp("^Failed to load text layer for page (\\d+):\\s*(.+)$", "i"), "加载第 $1 页的文本图层失败：$2"],
    [new RegExp("^Text layer render failed:\\s*(.+)$", "i"), "文本图层渲染失败：$1"],
    [new RegExp("^Failed to initialize text layer:\\s*(.+)$", "i"), "初始化文本图层失败：$1"],
    [new RegExp("^Tool Definition:\\s*(.+)$", "i"), "工具定义：$1"],
    [new RegExp("^Invocation:\\s*(.+)$", "i"), "调用：$1"],
    [new RegExp("^([\\d,]+)\\s*\\/\\s*([\\d,]+)\\s*tokens\\s*\\(([\\d.]+%)\\)$", "i"), "$1 / $2 个 Token ($3)"],
    [new RegExp("^\\(([\\d,]+)\\s*tokens\\)\\s*([\\d.]+%)$", "i"), "($1 个 Token) $2"],
    [new RegExp("^\\(([\\d,]+)\\s*tokens\\)$", "i"), "($1 个 Token)"],
    [new RegExp("^Unused capacity:\\s*([\\d,]+)\\s*tokens$", "i"), "未用容量：$1 个 Token"],
    [new RegExp("^Rules:\\s*([\\d,]+)\\s*tokens$", "i"), "规则：$1 个 Token"],
    [new RegExp("^Skills:\\s*([\\d,]+)\\s*tokens$", "i"), "技能：$1 个 Token"],
    [new RegExp("^Subagents:\\s*([\\d,]+)\\s*tokens$", "i"), "子智能体：$1 个 Token"],
    [new RegExp("^MCP Tools:\\s*([\\d,]+)\\s*tokens$", "i"), "MCP 工具：$1 个 Token"],
    [new RegExp("^MCP Servers:\\s*([\\d,]+)\\s*tokens$", "i"), "MCP 服务：$1 个 Token"],
    [new RegExp("^System Prompt:\\s*([\\d,]+)\\s*tokens$", "i"), "系统提示词：$1 个 Token"],
    [new RegExp("^Customizations:\\s*([\\d,]+)\\s*tokens$", "i"), "自定义扩展：$1 个 Token"],
    [new RegExp("^Other Customizations:\\s*([\\d,]+)\\s*tokens$", "i"), "其他自定义扩展：$1 个 Token"],
    [new RegExp("^(\\d+)\\s+demoted$", "i"), "$1 项已降级"],
    [new RegExp("^(\\d+)\\s+excluded$", "i"), "$1 项已排除"],
    [new RegExp("^(\\d+)\\s+tools?\\s+excluded$", "i"), "已排除 $1 个工具"],
    [new RegExp("^(\\d+)\\s+tools$", "i"), "$1 个工具"],
    [new RegExp("^Show\\s+(\\d+)\\s+breakdowns?$", "i"), "显示 $1 项明细"],
    [new RegExp("^(\\d+)\\s+rules?\\s+exceeded the rules budget and (?:was|were) demoted from full inline content to a file-path pointer\\.$", "i"), "$1 条规则超出规则预算，已从完整内联内容降级为文件路径指针。"],
    [new RegExp("^(\\d+)\\s+items?\\s+in\\s+(.+?)\\s+exceeded the customization budget and (?:was|were) excluded from context\\.$", "i"), "$2 中的 $1 个项目超出自定义扩展预算，已从上下文中排除。"],
    [new RegExp("^Exceeded the rules token budget\\. Full rule content \\(([\\d,]+)\\s*tokens\\) was replaced with a lightweight file-path pointer in context\\.$", "i"), "已超出规则 Token 预算。完整规则内容（$1 个 Token）已在上下文中替换为轻量级文件路径指针。"],
    [new RegExp("^All tools in this MCP server \\(([\\d,]+)\\s*tokens\\) exceeded the customization budget and were excluded from context\\.$", "i"), "此 MCP 服务中的所有工具（$1 个 Token）均超出自定义扩展预算，已从上下文中排除。"],
    [new RegExp("^(\\d+)\\s+tools?\\s+in this MCP server \\(([\\d,]+)\\s*tokens\\) exceeded the customization budget and were excluded from context\\.$", "i"), "此 MCP 服务中的 $1 个工具（$2 个 Token）超出自定义扩展预算，已从上下文中排除。"],
    [new RegExp("^Exceeded the customization token budget \\(([\\d,]+)\\s*tokens\\) and was excluded from context\\.$", "i"), "已超出自定义扩展 Token 预算（$1 个 Token），已从上下文中排除。"],
    [new RegExp("^Worked\\s+for\\s+(\\d+)\\s*d\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m$", "i"), "已工作 $1 天 $2 小时 $3 分钟"],
    [new RegExp("^Stopped\\s+after\\s+(\\d+)\\s*d\\s+(\\d+)\\s*h\\s+(\\d+)\\s*m$", "i"), "在 $1 天 $2 小时 $3 分钟后停止"],
    [new RegExp("^Send\\s+feedback\\s+as\\s+(.+)$", "i"), "以 $1 身份发送反馈"],
    [new RegExp("^All changes since\\s+(.+)$", "i"), "自 $1 以来的全部更改"],
    [new RegExp("^(\\d+)\\s+commits?\\s+to\\s+push$", "i"), "$1 个待推送的提交"],
    [new RegExp("^(\\d+)\\s+commits?\\s+to\\s+pull$", "i"), "$1 个待拉取的提交"],
    [new RegExp("^Send\\s+[mM]essage\\s+(Enter|Return|Ctrl\\+Enter|Cmd\\+Enter|↵)$", "i"), "发送消息 $1"],
    [new RegExp("^Send\\s+[mM]essage\\s+\\((Enter|Return|Ctrl\\+Enter|Cmd\\+Enter|↵)\\)$", "i"), "发送消息 ($1)"],
    [new RegExp("^Playback speed ([0-9.]+)x$", "i"), "播放倍速 $1x"],
    [new RegExp("^Zoom (\\d+)%, reset to fit$", "i"), "缩放 $1%，点击重置为适应屏幕"],
    [new RegExp("^Enlarged media:\\s*(.+)$", "i"), "放大查看媒体：$1"],
    [new RegExp("^Fix with Agent:\\s*(.+)$", "i"), "使用智能体修复：$1"],
    [new RegExp("^Error restarting (.+?):\\s*(.+)$", "i"), "重启 $1 时出错：$2"],
    [new RegExp("^Zipping\\s+(.+?)(?:…|\\.\\.\\.)?$", "i"), "正在压缩 $1…"],
    [new RegExp("^Retrying transcription \\(attempt (\\d+)\\)…$", "i"), "正在重试转写（第 $1 次）…"],
    [new RegExp("^Could not attach folder \"(.+?)\":\\s*Folder is empty$", "i"), "无法附加文件夹“$1”：文件夹为空"],
    [new RegExp("^Could not attach folder \"(.+?)\":\\s*Folder has more than 1000 files$", "i"), "无法附加文件夹“$1”：文件夹包含超过 1000 个文件"],
    [new RegExp("^Could not attach folder \"(.+?)\":\\s*Folder is larger than 20MB$", "i"), "无法附加文件夹“$1”：文件夹大小超过 20MB"],
    [new RegExp("^Could not attach folder \"(.+?)\":\\s*(.+)$", "i"), "无法附加文件夹“$1”：$2"],
    [new RegExp("^Could not open folder:\\s*(.+)$", "i"), "无法打开文件夹：$1"],
    [new RegExp("^Search for \"(.+?)\" in the Marketplace$", "i"), "在扩展市场中搜索“$1”"],
    [new RegExp("^No plugins found for \"(.+?)\"\\.$", "i"), "未找到与“$1”相关的插件。"],
    [new RegExp("^(\\d+) matching bundles?$", "i"), "$1 个匹配的组合包"],
    [new RegExp("^Get Anything Done with\\s+(.+)$", "i"), "借助 $1 搞定一切"],
    [new RegExp("^Select\\s+(.+?)\\s+Theme$", "i"), "选择 $1 主题"],
    [new RegExp("^(\\d+(?:\\.\\d+)?)%\\s+left$", "i"), "剩余 $1%"],
    [new RegExp("^(\\d+)\\s*h\\s+limit$", "i"), "$1 小时限额"],
    [new RegExp("^(\\d+)\\s*d\\s+limit$", "i"), "$1 天限额"],
    [new RegExp("^(\\d+)\\s*m\\s+limit$", "i"), "$1 分钟限额"],
    [new RegExp("^(\\d+)\\s*s\\s+limit$", "i"), "$1 秒限额"],
    [new RegExp("^(\\d+)\\s*h\\s+rate\\s+limit$", "i"), "$1 小时速率限制"],
    [new RegExp("^(\\d+)\\s*d\\s+rate\\s+limit$", "i"), "$1 天速率限制"],
    [new RegExp("^Welcome back, (.+)\\. Where should we pick up\\?$", "i"), "欢迎回来，$1。我们从哪里继续？"],
    [new RegExp("^Hey (.+), what should we build today\\?$", "i"), "你好，$1，今天想构建什么？"],
    [new RegExp("^Good to see you, (.+)\\. What's next\\?$", "i"), "很高兴见到你，$1。接下来做什么？"],
    [new RegExp("^Voice speed, (\\d+(?:\\.\\d+)?)x$", "i"), "语速：$1 倍"],
    [new RegExp("^Voice mode, (\\d+:\\d{2})$", "i"), "语音模式，$1"],
    [new RegExp("^Open Voice transcript, (.+)$", "i"), "打开语音转写，$1"],
    [new RegExp("^Yes, allow downloads from (.+) for this run$", "i"), "是，允许本次运行从 $1 下载"],
    [new RegExp("^Yes, allow downloads from (.+) in this conversation$", "i"), "是，允许此会话从 $1 下载"],
    [new RegExp("^Yes, always allow downloads from (.+)$", "i"), "是，始终允许从 $1 下载"],
    [new RegExp("^Proceed to (.+) \\(unsafe\\)$", "i"), "继续前往 $1（不安全）"],
    [new RegExp("^Site data cleared for (.+)\\.$", "i"), "已清除 $1 的网站数据。"],
    [new RegExp("^Could not clear site data for (.+)\\.$", "i"), "无法清除 $1 的网站数据。"],
    [new RegExp("^An embedded page at (https?://\\S+) wants to connect to a (USB|HID) device$", "i"), "来自 $1 的嵌入页面请求连接 $2 设备"],
    [new RegExp("^An embedded page at (https?://\\S+) wants to connect to a serial port$", "i"), "来自 $1 的嵌入页面请求连接串口"],
    [new RegExp("^(https?://\\S+) wants to connect to a (USB|HID) device$", "i"), "$1 请求连接 $2 设备"],
    [new RegExp("^(https?://\\S+) wants to connect to a serial port$", "i"), "$1 请求连接串口"],
    [new RegExp("^Version (\\d+\\.\\d+\\.\\d+(?:[-+][A-Za-z0-9.-]+)?)$", "i"), "版本 $1"],
    [new RegExp("^(\\d+) MCP servers? failed to start$", "i"), "$1 个 MCP 服务器启动失败"],
    [new RegExp("^Select Sidebar Item ([1-9])$"), "选择侧栏第 $1 项"],
    [new RegExp("^Show (\\d+) More$"), "再显示 $1 项"],
    [new RegExp("^See (\\d+) more plugins$"), "再查看 $1 个插件"],
  ];

  const patternsPost = [
    // 动态选项与操作
    [/^([^\x00-\xff]+)\s+options$/gi, '$1 选项'],
    [/^(?:(\b(?:Overview|Review|Terminal|Console|Output|Problems|Debug)\b)|([^\x00-\xff]+))\s+tab$/gi, '$1$2 标签页'],
    [/(?:刷新|Refresh)\s*MCP\s*servers?/gi, '刷新 MCP 服务器'],
    [/\btokens\)/gi, 'Token)'],
    // 量词与时间单位补齐（仅在已含中文的半翻译文本中补齐单位，避免破坏未知英文长句）
    [/(\d+)\s*搜索/g, '$1 次搜索'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*days?\b/gi, '$1 天'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*hours?\b/gi, '$1 小时'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*minutes?\b/gi, '$1 分钟'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*seconds?\b/gi, '$1 秒'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*weeks?\b/gi, '$1 周'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*months?\b/gi, '$1 个月'],
    [/(?<=[\u4e00-\u9fff][^\n]*?)(\d+)\s*years?\b/gi, '$1 年'],

    // 模型可用性与公告提示（模型名原样保留，只格式化完整的日期字段）
    [/^([\w .-]+?) is now available on paid Pro and Ultra plans\. Third-party model access will no longer be available on your current plan starting on (.+?)\.$/gi, (_m, model, date) => `${model} 已面向付费 Pro 与 Ultra 套餐开放。自 ${localizeEnglishDates(date)} 起，您当前使用的套餐将不再提供第三方模型访问。`],
    [/^([\w .-]+?) is currently available to Ultra and paid Pro plan subscribers\.$/gi, (_m, model) => `${model} 目前仅向 Ultra 及付费 Pro 套餐订阅用户开放。`],
    [/^([\w .-]+?) is currently available to Ultra plan subscribers\.$/gi, (_m, model) => `${model} 目前向 Ultra 套餐订阅用户开放。`],
    [/^GPT-OSS will be removed from Antigravity on (.+?)\.$/gi, (_m, date) => `GPT-OSS 将于 ${localizeEnglishDates(date)} 从 Antigravity 中移除。`],
  ];

  function replacePhrase(value, source, target) {
    const pattern = getPhraseRegex(source);
    return value.replace(pattern, target);
  }

  // 核心翻译流水线：精准完全匹配优先 -> 动态进度栏 -> 长句及复合短语子串 -> 动态变量规则
  function translate(value) {
    if (!value || !/[A-Za-z]/.test(value)) return value;
    if (customTranslations.size) {
      const whole = value.trim();
      const custom = customTranslations.get(whole.toLowerCase());
      if (custom !== undefined) return custom ? value.replace(whole, () => custom) : value;
    }
    if (englishLabels && englishLabelsPreset.has(value.trim().toLowerCase())) return value;
    // 项目名称属于数据；完整删除模板须先于通用词条处理。
    // 观察器重处理译文时，也不能改写名称中的英文。
    if (/^永久删除项目“[\s\S]*”及其中的 \d+ 个活跃对话。$/.test(value.trim())) return value;
    const deletion = value.trim().match(/^Permanently delete ([\s\S]+) including (\d+) active conversations?\.$/);
    if (deletion) return value.replace(value.trim(), () => `永久删除项目“${deletion[1]}”及其中的 ${deletion[2]} 个活跃对话。`);
    const permission = translatePermission(value);
    if (permission !== null) return permission;
    const activity = translateActivity(value);
    if (activity !== null) return activity;
    const trimmed = value.trim();

    // 文件夹路径和产品名称是变量，先处理已确认的完整控件模板。
    if (/^(?:无法定位文件夹：[\s\S]*|请在 .+ 面板中登录。|登录后即可使用 .+！)$/.test(trimmed)) return value;
    const folderFailure = trimmed.match(/^Failed to resolve folder: ([\s\S]+)$/);
    if (folderFailure) return value.replace(trimmed, () => '无法定位文件夹：' + folderFailure[1]);
    const panelSignIn = trimmed.match(/^Sign in from the ([^\r\n]{1,100}) panel\.$/);
    if (panelSignIn) return value.replace(trimmed, () => `请在 ${panelSignIn[1]} 面板中登录。`);
    const productSignIn = trimmed.match(/^Sign in to use ([^\r\n]{1,100})!$/);
    if (productSignIn) return value.replace(trimmed, () => `登录后即可使用 ${productSignIn[1]}！`);

    // 项目摘要中的数量由应用生成；只匹配已确认的完整模板。
    const conversationCounts = trimmed.match(/^(\d+) (active|archived) conversations?(?: and (\d+) archived conversations?)?$/);
    if (conversationCounts && !(conversationCounts[2] === 'archived' && conversationCounts[3])) {
      let result = `${conversationCounts[1]} 个${conversationCounts[2] === 'active' ? '活跃' : '已归档'}对话`;
      if (conversationCounts[3]) result += `和 ${conversationCounts[3]} 个已归档对话`;
      return value.replace(trimmed, () => result);
    }

    // 排队消息的悬浮提示由运行时快捷键和说明组成，按键本身必须保留。
    const deliveryShortcut = trimmed.match(/^(Enter|Alt\+Enter|⏎|⌥⏎) (Queues after the turn|Sends immediately)$/);
    if (deliveryShortcut) {
      const description = deliveryShortcut[2] === 'Queues after the turn' ? '当前轮次结束后排队发送' : '立即发送';
      return value.replace(trimmed, () => `${deliveryShortcut[1]} ${description}`);
    }
    const emptyPromptShortcut = trimmed.match(/^(Alt\+Enter|⌥⏎) On empty prompt, sends next in queue$/);
    if (emptyPromptShortcut) {
      return value.replace(trimmed, () => `${emptyPromptShortcut[1]} 提示词为空时发送队列中的下一条消息`);
    }

    // 市场分类与插件名称是变量，仅转换明确的控件模板。
    const marketAction = (!phrases.has(trimmed) && !lowerPhrases.has(trimmed.toLowerCase()))
      ? trimmed.match(/^(See more in|Details for) (.+)$/)
      : null;
    if (marketAction) {
      const name = matchExactPhrase(marketAction[2]) ?? marketAction[2];
      const label = marketAction[1] === 'See more in' ? `查看更多：${name}` : `查看详情：${name}`;
      return value.replace(trimmed, () => label);
    }
    if (/^(?:查看更多|查看详情)：/.test(trimmed)) return value;

    // 快捷键说明中的按键和动作可能包含用户配置；只翻译已知动作，原样保留按键。
    const shortcut = trimmed.match(/^(Shortcut|Remove shortcut) (.+?) for (.+)$/);
    if (shortcut) {
      const action = matchExactPhrase(shortcut[3]) ?? shortcut[3];
      return value.replace(trimmed, () => `${shortcut[1] === 'Shortcut' ? '快捷键' : '移除快捷键'} ${shortcut[2]}：${action}`);
    }
    const addShortcut = trimmed.match(/^Add shortcut for (.+)$/);
    if (addShortcut) return value.replace(trimmed, () => `添加快捷键：${matchExactPhrase(addShortcut[1]) ?? addShortcut[1]}`);
    if (/^(?:快捷键|移除快捷键|添加快捷键)[： ]/.test(trimmed)) return value;

    // 首页问候语的用户名是用户数据，先整体处理并在重复扫描时保持不变。
    const greeting = trimmed.match(/^Hi ([\s\S]+?), what can we get done today\?$/);
    if (greeting) return value.replace(trimmed, () => `你好，${greeting[1]}，今天想完成什么？`);
    if (/^你好，[\s\S]+，今天想完成什么？$/.test(trimmed)) return value;

    // 启动浮窗中的发行版名称也属于变量，不能交给数量/短语规则改写。
    let wsl;
    if ((wsl = trimmed.match(/^Setting up WSL: ([\s\S]+)$/))) return value.replace(trimmed, () => '正在设置 WSL：' + wsl[1]);
    if ((wsl = trimmed.match(/^Installing into ([\s\S]+)…$/))) return value.replace(trimmed, () => '正在安装到 ' + wsl[1] + '…');
    if (/^(正在设置 WSL：|正在安装到 )/.test(trimmed)) return value;

    // 1. 精准完全匹配（独立按钮、菜单项、短词、快捷键与标点，彻底杜绝短词在未知长句中途破坏）
    const exact = matchExactPhrase(trimmed);
    if (exact) {
      return value.replace(trimmed, exact);
    }

    // 时间筛选完整翻译，兼容旧词库已经留下的 "Last 7 天" 等半翻译标签。
    const recentDays = trimmed.match(/^Last\s+(\d+)\s*(?:days?|天)$/i);
    if (recentDays) return value.replace(trimmed, () => `最近 ${recentDays[1]} 天`);

    // 2. 动态任务进度栏解析（例如 "Exploring files, running commands ⌵"）
    const progress = translateAgentProgress(value);
    if (progress) {
      return progress;
    }

    // 3. 长句及复合短语子串匹配（仅长度 > 15 的词条允许子串替换，短词禁止中途单点替换）
    let next = value;
    for (const [source, target] of sortedPhrases) {
      // 删除按钮文案不能作为子串处理，否则会改写无法识别的项目删除提示。
      if (source.length > 15 && source !== 'Permanently delete') {
        next = replacePhrase(next, source, target);
      }
    }

    // 4. 处理动态变量与模板规则
    for (const [pattern, target] of dynamicPatterns) {
      next = next.replace(pattern, target);
    }

    // 5. 后置微调与插值收尾
    for (const [pattern, target] of patternsPost) {
      next = next.replace(pattern, target);
    }

    return next;
  }

  // 仅用于应用生成的 aria-label 模板。名称、路径、URL 和账号均原样保留，
  // 并在命中后立即返回，避免通用短语或数量规则再次改写变量。
  const dynamicAriaLabels = [
    [/^Playback speed (\d+(?:\.\d+)?)x$/, (_m, n) => `播放速度：${n}x`, '播放速度：'],
    [/^Zoom (\d+(?:\.\d+)?)%, reset to fit$/, (_m, n) => `缩放：${n}%，重置为适应窗口`, '缩放：'],
    [/^Open ([\s\S]+) skill$/, (_m, name) => `打开技能：${name}`, '打开技能：'],
    [/^([\s\S]+)\. View site information$/, (_m, site) => `查看网站信息：${site}`, '查看网站信息：'],
    [/^([\s\S]+) download progress$/, (_m, name) => `下载进度：${name}`, '下载进度：'],
    [/^Show ([\s\S]+) in folder$/, (_m, name) => `在文件夹中显示：${name}`, '在文件夹中显示：'],
    [/^Remove ([\s\S]+) from list$/, (_m, name) => `从列表中移除：${name}`, '从列表中移除：'],
    [/^Stop (\d+) selected$/, (_m, count) => `停止所选的 ${count} 项`, '停止所选的 '],
    [/^Recording shortcut for ([\s\S]+)\. Press keys to bind, Enter to save, Escape to cancel\.$/, (_m, name) => `正在为 ${name} 录制快捷键。按下按键绑定，按 Enter 保存，按 Escape 取消。`, '正在为 '],
    [/^Remove shortcut ([\s\S]+?) for ([\s\S]+)$/, (_m, key, action) => `移除快捷键 ${key}：${matchExactPhrase(action) ?? action}`, '移除快捷键 '],
    [/^Add shortcut for ([\s\S]+)$/, (_m, action) => `添加快捷键：${matchExactPhrase(action) ?? action}`, '添加快捷键：'],
    [/^Shortcut ([\s\S]+?) for ([\s\S]+)$/, (_m, key, action) => `快捷键 ${key}：${matchExactPhrase(action) ?? action}`, '快捷键 '],
    [/^Reset ([\s\S]+) to default$/, (_m, name) => `恢复默认设置：${name}`, '恢复默认设置：'],
    [/^Toggle ([\s\S]+)$/, (_m, name) => `切换：${name}`, '切换：'],
    [/^([\s\S]+), voice (\d+) of (\d+)$/, (_m, name, n, total) => `语音：${name}（${n} / ${total}）`, '语音：'],
    [/^Auth code for ([\s\S]+)$/, (_m, name) => `授权码：${name}`, '授权码：'],
    [/^Authorization code for ([\s\S]+)$/, (_m, name) => `授权代码：${name}`, '授权代码：'],
    [/^Make ([\s\S]+) the default ([\s\S]+) account$/, (_m, name, provider) => `设为默认账号：${name}（${provider}）`, '设为默认账号：'],
    [/^Label for ([\s\S]+)$/, (_m, name) => `标签：${name}`, '标签：'],
    [/^Sign in to ([\s\S]+) on this computer$/, (_m, name) => `在此电脑上登录：${name}`, '在此电脑上登录：'],
    [/^Sign in to ([\s\S]+) remotely$/, (_m, name) => `远程登录：${name}`, '远程登录：'],
    [/^More for ([\s\S]+)$/, (_m, name) => `更多操作：${name}`, '更多操作：'],
    [/^Edit ([\s\S]+) name$/, (_m, name) => `编辑名称：${name}`, '编辑名称：'],
    [/^Version ([\s\S]+)$/, (_m, version) => `版本：${version}`, '版本：'],
    [/^(\d+) lines added, (\d+) lines removed$/, (_m, added, removed) => `新增 ${added} 行，删除 ${removed} 行`, '新增 '],
    [/^Go to slide (\d+)$/, (_m, n) => `转到幻灯片 ${n}`, '转到幻灯片 '],
    [/^Opens external link: ([\s\S]+)$/, (_m, url) => `打开外部链接：${url}`, '打开外部链接：'],
    [/^View Diff for ([\s\S]+)$/, (_m, name) => `查看差异：${name}`, '查看差异：'],
    [/^Open URL in system browser: ([\s\S]+)$/, (_m, url) => `在系统浏览器中打开网址：${url}`, '在系统浏览器中打开网址：'],
    [/^Cost summary: ([\s\S]+)$/, (_m, cost) => `费用摘要：${cost}`, '费用摘要：'],
    [/^\+(\d+) more$/, (_m, count) => `还有 ${count} 项`, '还有 '],
    [/^Edit comment: ([\s\S]+)$/, (_m, comment) => `编辑评论：${comment}`, '编辑评论：'],
    [/^Fix with Agent: ([\s\S]+)$/, (_m, name) => `使用智能体修复：${name}`, '使用智能体修复：'],
    [/^More actions for ([\s\S]+)$/, (_m, name) => `更多操作：${name}`, '更多操作：'],
    [/^Account this MCP server uses: ([\s\S]+)$/, (_m, name) => `此 MCP 服务器使用的账号：${name}`, '此 MCP 服务器使用的账号：'],
    [/^(Enable|Disable) ([\s\S]+) tool for ([\s\S]+)$/, (_m, action, tool, owner) => `${action === 'Enable' ? '启用' : '停用'}工具：${tool}（${owner}）`, '启用工具：'],
    [/^Where the agent runs, current: ([\s\S]+)$/, (_m, name) => `智能体运行位置：${name}`, '智能体运行位置：'],
    [/^Select project, current: ([\s\S]+)$/, (_m, name) => `选择项目，当前：${matchExactPhrase(name) ?? name}`, '选择项目，当前：'],
    [/^Remove context from ([\s\S]+)$/, (_m, name) => `移除上下文：${name}`, '移除上下文：'],
    [/^Question (\d+) of (\d+)$/, (_m, n, total) => `问题 ${n} / ${total}`, '问题 '],
    [/^Select harnesses, current: ([\s\S]+)$/, (_m, name) => `选择执行框架，当前：${name}`, '选择执行框架，当前：'],
    [/^Run ([\s\S]+) now$/, (_m, name) => `立即运行：${name}`, '立即运行：'],
    [/^Filter skills and rules: ([\s\S]+)$/, (_m, query) => `筛选技能和规则：${query}`, '筛选技能和规则：'],
    [/^Plugins in ([\s\S]+)$/, (_m, name) => `插件所在位置：${name}`, '插件所在位置：'],
    [/^Switch environment \(([\s\S]+)\)$/, (_m, name) => `切换环境：${name}`, '切换环境：'],
    [/^Go to turn (\d+) of (\d+)$/, (_m, n, total) => `转到第 ${n} / ${total} 轮`, '转到第 '],
    [/^Turn (\d+) of (\d+)$/, (_m, n, total) => `第 ${n} / ${total} 轮`, '第 '],
    [/^Open Subagent: ([\s\S]+)$/, (_m, name) => `打开子智能体：${name}`, '打开子智能体：'],
    [/^([\s\S]+)\. Switch mic$/, (_m, name) => `切换麦克风：${name}`, '切换麦克风：'],
    [/^([\s\S]+)\. Show in ([\s\S]+)$/, (_m, name, location) => `显示来源：${name}（${location}）`, '显示来源：'],
    [/^([\s\S]+) CEL values$/, (_m, name) => `CEL 值：${name}`, 'CEL 值：'],
    [/^Scroll to: ([\s\S]+) on page (\d+)$/, (_m, name, n) => `滚动到第 ${n} 页：${name}`, '滚动到第 '],
    [/^Page (\d+) failed to load$/, (_m, n) => `第 ${n} 页加载失败`, '第 '],
    [/^Go to page (\d+)$/, (_m, n) => `转到第 ${n} 页`, '转到第 '],
    [/^Sign in to ([\s\S]+)$/, (_m, name) => `登录：${name}`, '登录：'],
    [/^Install ([\s\S]+)$/, (_m, name) => `安装：${name}`, '安装：'],
    [/^Reconnect ([\s\S]+)$/, (_m, name) => `重新连接：${name}`, '重新连接：'],
    [/^Disconnect ([\s\S]+)$/, (_m, name) => `断开连接：${name}`, '断开连接：'],
    [/^Connect ([\s\S]+)$/, (_m, name) => `连接：${name}`, '连接：'],
    [/^Open ([\s\S]+)$/, (_m, name) => `打开：${name}`, '打开：'],
    [/^View ([\s\S]+)$/, (_m, name) => `查看：${name}`, '查看：'],
    [/^Close ([\s\S]+)$/, (_m, name) => `关闭：${name}`, '关闭：'],
    [/^Cancel ([\s\S]+)$/, (_m, name) => `取消：${name}`, '取消：'],
    [/^Stop ([\s\S]+)$/, (_m, name) => `停止：${name}`, '停止：'],
    [/^Remove ([\s\S]+)$/, (_m, name) => `移除：${name}`, '移除：'],
    [/^Delete ([\s\S]+)$/, (_m, name) => `删除：${name}`, '删除：'],
    [/^Enable ([\s\S]+)$/, (_m, name) => `启用：${name}`, '启用：'],
    [/^Restart ([\s\S]+)$/, (_m, name) => `重新启动：${name}`, '重新启动：'],
    [/^Add ([\s\S]+)$/, (_m, name) => `添加：${name}`, '添加：'],
  ];

  function translateAriaLabel(value) {
    if (!value || !/[A-Za-z]/.test(value)) return null;
    const text = value.trim();
    if (text.startsWith('停用工具：')) return value;
    if (dynamicAriaLabels.some(([, , prefix]) => text.startsWith(prefix))) return value;
    // 完整静态词条优先，避免把“Open File”等控件的后半段误当成变量。
    if (matchExactPhrase(text)) return null;
    for (const [pattern, render] of dynamicAriaLabels) {
      const match = text.match(pattern);
      if (match) return value.replace(text, () => render(...match));
    }
    return null;
  }

  // 项目删除说明由普通文本和两个 strong 节点组成；只接受已确认的结构。
  function projectDeletionParts(element) {
    if (!element || element.tagName !== 'SPAN' || !element.childNodes) return null;
    const nodes = Array.from(element.childNodes);
    let index = 0;
    const prefix = nodes[index++];
    if (prefix?.nodeType !== Node.TEXT_NODE || !/^(?:Permanently delete|永久删除)$/.test((prefix.nodeValue || '').trim())) return null;
    if (nodes[index]?.nodeType === Node.TEXT_NODE && !(nodes[index].nodeValue || '').trim()) index++;
    const name = nodes[index++];
    if (name?.nodeType !== Node.ELEMENT_NODE || name.tagName !== 'STRONG') return null;
    let join = null;
    if (nodes[index]?.nodeType === Node.TEXT_NODE && /^(?:including|包含)$/.test((nodes[index].nodeValue || '').trim())) {
      join = nodes[index++];
      const count = nodes[index++];
      if (count?.nodeType !== Node.ELEMENT_NODE || count.tagName !== 'STRONG') return null;
    }
    const punctuation = nodes[index++];
    if (punctuation?.nodeType !== Node.TEXT_NODE || !/^[.。]$/.test((punctuation.nodeValue || '').trim()) || index !== nodes.length) return null;
    return { name, join, punctuation };
  }

  // 自动化管理说明中的 strong 是用户命名的自动化，不得翻译。
  function automationManagedParts(element) {
    if (!element || element.tagName !== 'SPAN' || !element.childNodes) return null;
    const nodes = Array.from(element.childNodes).filter((node) =>
      node.nodeType !== Node.TEXT_NODE || (node.nodeValue || '').trim());
    if (nodes.length !== 5) return null;
    const [prefix, kind, join, name, suffix] = nodes;
    if (prefix?.nodeType !== Node.TEXT_NODE || !/^(?:This|此)$/.test((prefix.nodeValue || '').trim())) return null;
    if (kind?.nodeType !== Node.TEXT_NODE || !/^(?:project|workspace|项目|工作区)$/i.test((kind.nodeValue || '').trim())) return null;
    if (join?.nodeType !== Node.TEXT_NODE || !/^(?:is managed by the|由自动化“)$/.test((join.nodeValue || '').trim())) return null;
    if (name?.nodeType !== Node.ELEMENT_NODE || name.tagName !== 'STRONG') return null;
    if (suffix?.nodeType !== Node.TEXT_NODE || !/^(?:automation and can only be deleted by deleting that automation\.|”管理，只能通过删除该自动化来删除此(?:项目|工作区)。)$/.test((suffix.nodeValue || '').trim())) return null;
    return { prefix, kind, join, name, suffix };
  }

  const protectedCustomizationNameSelector = [
    '[data-testid="workspace-customizations-view"] span[data-tooltip-id].text-sm.font-medium.truncate',
    '[data-testid="workspace-customizations-view"] .group.flex.items-start.justify-between span.font-medium.truncate',
  ].join(', ');

  function restoreProtectedCustomizationNames() {
    for (const element of document.querySelectorAll(protectedCustomizationNameSelector)) {
      restoreTrackedNode(element);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) restoreTrackedNode(node);
    }
  }

  function isProtectedMentionLabel(element) {
    const label = element?.closest?.('[data-testid="menu-option-label"]');
    return !!label?.closest?.('[data-mention-menu]') &&
      !label.closest?.('[data-testid="menu-category-row"]');
  }

  function isPullRequestLink(el) {
    return Boolean(
      el &&
      el.tagName === 'A' &&
      /^https?:\/\/(?:github\.com|depot\.code\.corp\.goog)\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*(?:[/?#]|$)/i.test(el.getAttribute?.('href') || '')
    );
  }

  function hasPullRequestCardHeader(el) {
    const header = el?.firstElementChild;
    return Boolean(
      header &&
      header.classList?.contains('text-compact') &&
      header.classList?.contains('gap-1.5') &&
      isPullRequestLink(header.querySelector?.('a[href]'))
    );
  }

  function isRemoteMetadataElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const testId = el.getAttribute?.('data-testid');
    if (testId === 'ssh-config-file-name') return Boolean(el.hasAttribute?.('tabindex'));
    const classes = el.classList;
    if (el.tagName === 'SPAN' && classes?.contains('truncate') && el.closest?.('[data-ssh-host]')) return true;
    if (classes?.contains('whitespace-pre-line') && el.closest?.('[data-testid="ssh-connect-error"]')) return true;

    // PR 卡片共享同一槽位渲染仓库标题、正文与作者名，保护用户/仓库元信息不被误译
    if (el.tagName === 'DIV' && classes?.contains('text-compact') &&
        (classes?.contains('-mt-1') || classes?.contains('font-medium')) && hasPullRequestCardHeader(el.parentElement)) return true;
    if (classes?.contains('line-clamp-4') && classes?.contains('whitespace-pre-wrap') && hasPullRequestCardHeader(el.parentElement)) return true;
    if (el.tagName === 'SPAN' && classes?.contains('break-words') && classes?.contains('min-w-0') &&
        el.parentElement?.classList?.contains('grid-cols-[auto_1fr]') && hasPullRequestCardHeader(el.parentElement.parentElement)) return true;
    return isPullRequestLink(el) && Boolean(el.closest?.('.text-compact.gap-1\\.5') || el.hasAttribute?.('data-item-id'));
  }

  function isProjectDeletionDetails(el) {
    return Boolean(
      el?.classList?.contains('flex-1') &&
      el.parentElement?.querySelector?.(':scope > .shrink-0 > [data-testid="delete-project-button"]')
    );
  }

  function isProjectDeletionDescription(el) {
    const wrapper = el?.parentElement;
    return Boolean(
      el?.tagName === 'SPAN' &&
      wrapper?.classList?.contains('whitespace-pre-wrap') &&
      isProjectDeletionDetails(wrapper.parentElement)
    );
  }

  const MCP_APP_STATUS_LABELS = {
    'mcp-app-pane-loading': ['Loading', '正在加载'],
    'mcp-app-pane-error': ['Could not load', '无法加载'],
    'mcp-app-view-error': ['Could not load the app view:', '无法加载应用视图：']
  };

  function getMcpAppStatusLabel(el) {
    const testId = el?.getAttribute?.('data-testid');
    if (testId && Array.isArray(MCP_APP_STATUS_LABELS[testId])) return MCP_APP_STATUS_LABELS[testId];
    if (el?.classList?.contains('shimmer-text-content') && el.closest?.('[data-testid="mcp-app-pane-loading"]')) {
      return MCP_APP_STATUS_LABELS['mcp-app-pane-loading'];
    }
    return null;
  }

  function hasClasses(el, ...classes) {
    return Boolean(el?.classList && classes.every((cls) => el.classList.contains(cls)));
  }

  function restoreAttrByName(element, attrName) {
    const attrs = originals.attrs.get(element);
    const record = attrs?.get(attrName);
    if (!record) return;
    if (element.getAttribute?.(attrName) === record.zh) {
      if (record.orig == null) element.removeAttribute?.(attrName);
      else element.setAttribute?.(attrName, record.orig);
    }
    attrs.delete(attrName);
    if (attrs.size === 0) originals.attrs.delete(element);
  }

  function hasPluginDetailDialogTarget(detail) {
    if (!detail) return false;
    if (detail.getAttribute?.('data-testid') === 'plugin-detail') return true;
    if (detail.querySelector?.('h1.text-xl.font-medium.truncate, [data-testid="doc-row-modal"]')) return true;
    if (detail.querySelectorAll) {
      for (const h1 of detail.querySelectorAll('h1')) {
        if (hasClasses(h1, 'text-xl', 'font-medium', 'truncate')) return true;
      }
    }
    return false;
  }

  function getOfficialPluginDescSlotElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    let target = el;
    if (target.tagName === 'SPAN' && hasClasses(target, 'font-semibold', 'text-foreground')) {
      target = target.parentElement;
      if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
    }
    if (!hasClasses(target, 'text-muted-foreground')) return null;
    if (target.tagName === 'P' && hasClasses(target, 'line-clamp-3') && target.hasAttribute?.('title') &&
        target.closest?.('[role="tabpanel"]')?.closest?.('[data-testid="featured-carousel"]')) {
      return { el: target, kind: 'featured' };
    }
    if (target.tagName === 'DIV' && hasClasses(target, 'text-sm', 'line-clamp-2', 'mt-1') &&
        target.closest?.('[data-testid="workspace-customizations-view"]')?.closest?.('[data-testid="project-customizations-content"]')) {
      return { el: target, kind: 'settings' };
    }
    if (target.tagName === 'DIV' && hasClasses(target, 'text-sm', 'truncate')) {
      const card = target.closest?.('[data-testid="customization-card"]');
      if (card?.hasAttribute?.('data-card-name')) return { el: target, kind: 'card' };
    }
    if (target.tagName === 'P' && hasClasses(target, 'leading-relaxed') &&
        target.getAttribute?.('data-testid') !== 'third-party-tools-disclaimer' &&
        target.closest?.('[data-testid="plugin-detail"]')) {
      return { el: target, kind: 'detail' };
    }
    return null;
  }

  function isProtectedPluginMetadataElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.closest?.('[data-testid="third-party-tools-disclaimer"]')) return false;
    for (let cur = element; cur && cur.nodeType === Node.ELEMENT_NODE; cur = cur.parentElement) {
      if (cur.tagName === 'IMG' && cur.closest?.('[data-testid="featured-carousel-member-tile"]')) return true;
      const card = cur.closest?.('[data-testid="customization-card"]');
      if (card?.hasAttribute?.('data-card-name')) {
        if ((cur.tagName === 'DIV' && (hasClasses(cur, 'font-medium', 'text-foreground', 'truncate') ||
            hasClasses(cur, 'text-sm', 'text-muted-foreground', 'truncate'))) || cur.tagName === 'IMG') {
          return true;
        }
      }
      const tabPanel = cur.closest?.('[role="tabpanel"]');
      if (tabPanel?.closest?.('[data-testid="featured-carousel"]')) {
        if ((cur.tagName === 'H3' && hasClasses(cur, 'font-semibold', 'truncate')) ||
            (cur.tagName === 'P' && hasClasses(cur, 'text-muted-foreground', 'line-clamp-3') && cur.hasAttribute?.('title'))) {
          return true;
        }
      }
      if ((cur.tagName === 'H1' && hasClasses(cur, 'text-xl', 'font-medium', 'truncate')) ||
          (cur.tagName === 'P' && hasClasses(cur, 'text-muted-foreground', 'leading-relaxed') &&
            cur.getAttribute?.('data-testid') !== 'third-party-tools-disclaimer') ||
          (cur.tagName === 'SPAN' && (hasClasses(cur, 'font-medium', 'flex-shrink-0') ||
            (hasClasses(cur, 'text-muted-foreground', 'truncate') && cur.hasAttribute?.('title'))))) {
        const detail = cur.closest?.('[data-testid="plugin-detail"], [role="dialog"]');
        if (detail && hasPluginDetailDialogTarget(detail)) return true;
      }
      if (cur.tagName === 'DIV' && hasClasses(cur, 'text-sm', 'text-muted-foreground', 'line-clamp-2', 'mt-1') &&
          cur.closest?.('[data-testid="workspace-customizations-view"]')?.closest?.('[data-testid="project-customizations-content"]')) {
        return true;
      }
      const tid = cur.getAttribute?.('data-testid');
      if (tid === 'customization-card' || tid === 'plugin-detail' || tid === 'workspace-customizations-view' ||
          cur.getAttribute?.('role') === 'dialog' || cur.tagName === 'BODY') {
        break;
      }
    }
    return false;
  }

  const officialDescTextMeta = new WeakMap();
  const officialDescTitleMeta = new WeakMap();

  function hasCatalogPluginOrigin(origin, entry) {
    const marketplace = entry.marketplace ?? 'antigravity-plugins-official';
    return origin?.marketplace === marketplace && origin.id === marketplace + '/plugin/' + entry.plugin;
  }

  function hasInstalledPluginOrigin(plugin, entry) {
    if (plugin?.$typeName !== 'exa.language_server_pb.Plugin' || plugin.name !== entry.plugin ||
        plugin.isGlobal !== true) return false;
    return entry.builtin
      ? plugin.isBuiltin === true
      : plugin.isBuiltin === false && hasCatalogPluginOrigin(plugin.installedFrom, entry);
  }

  function isSettingsPluginDescriptionFiber(fiber, source, entry) {
    const row = fiber.return?.return?.return;
    const owner = row?.return;
    const plugin = owner?.memoizedProps?.plugin;
    return fiber.memoizedProps?.children === source && owner?.key === entry.plugin &&
      row.memoizedProps?.deleteTitle === 'Delete plugin' && row.memoizedProps.description === source &&
      hasInstalledPluginOrigin(plugin, entry) && row.memoizedProps.path === plugin.path && plugin.description === source;
  }

  function isCardPluginDescriptionFiber(fiber, card, source, entry) {
    if (fiber.memoizedProps?.children?.props?.text !== source) return false;
    let container = fiber.return;
    while (container && container.stateNode !== card) container = container.return;
    const owner = container?.return;
    const props = owner?.memoizedProps;
    if (props?.description !== source || props.name !== card.getAttribute?.('data-card-name')) return false;
    if (card.closest?.('[data-testid="customizations-marketplace"]')) {
      return (props.to === '/customizations/marketplaces/$marketplace/plugins/$pluginId' ||
        props.to === '/customizations/plugins/$pluginId') && hasCatalogPluginOrigin(props.search, entry);
    }
    if (!card.closest?.('[data-testid="customizations-installed-plugins"]')?.closest?.('[data-testid="customizations-installed"]')) {
      return false;
    }
    for (let list = owner?.return; list; list = list.return) {
      const plugins = list.memoizedProps?.plugins;
      if (!Array.isArray(plugins)) continue;
      const matches = plugins.filter((plugin) => (plugin?.path || plugin?.name) === owner.key);
      const plugin = matches[0];
      return matches.length === 1 && hasInstalledPluginOrigin(plugin, entry) && plugin.description === source &&
        (plugin.displayName || plugin.name) === props.name;
    }
    return false;
  }

  function isDetailPluginDescriptionFiber(fiber, source, entry) {
    const header = fiber.return?.return;
    if (fiber.memoizedProps?.children !== source || header?.memoizedProps?.description !== source) return false;
    for (let footer = header?.sibling; footer; footer = footer.sibling) {
      const fields = footer.memoizedProps;
      if (!fields || !Object.hasOwn(fields, 'installedPlugin') || !Object.hasOwn(fields, 'catalogEntry') ||
          !Object.hasOwn(fields, 'pluginPreview')) continue;
      const plugin = fields.installedPlugin;
      if (plugin && !hasInstalledPluginOrigin(plugin, entry)) return false;
      if (plugin?.description) return plugin.description === source;
      const catalog = fields.catalogEntry;
      return catalog?.kind?.case === 'plugin' && catalog.description === source && hasCatalogPluginOrigin(catalog, entry);
    }
    return false;
  }

  function isFeaturedPluginDescriptionFiber(fiber, source, entry) {
    const member = fiber.return?.return?.memoizedProps?.member;
    return fiber.memoizedProps?.children === source && fiber.memoizedProps?.title === source &&
      member?.description === source && member.item?.kind?.case === 'plugin' &&
      member.item.description?.trim() === source && hasCatalogPluginOrigin(member.item, entry);
  }

  function hasVerifiedOfficialPluginDescription(el, source, entry) {
    const slot = getOfficialPluginDescSlotElement(el);
    if (!slot) return false;
    const card = slot.kind === 'card' ? el.closest?.('[data-testid="customization-card"]') : null;
    const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key && el[key];
    let verified = false;
    for (let i = 0; fiber && i < 2; i++, fiber = fiber.alternate) {
      let top = fiber;
      while (top.return) top = top.return;
      if (top.tag !== 3 || top.stateNode?.current !== top) continue;
      if (fiber.stateNode !== el) return false;
      if (slot.kind === 'settings') verified = isSettingsPluginDescriptionFiber(fiber, source, entry);
      else if (slot.kind === 'card') verified = isCardPluginDescriptionFiber(fiber, card, source, entry);
      else if (slot.kind === 'featured') verified = isFeaturedPluginDescriptionFiber(fiber, source, entry);
      else verified = isDetailPluginDescriptionFiber(fiber, source, entry);
      if (!verified) return false;
    }
    return verified;
  }

  function translateOfficialPluginDescription(el) {
    const slot = getOfficialPluginDescSlotElement(el);
    if (!slot) return false;
    const target = slot.el;
    const texts = [];
    let source = '';
    let primary = null;
    let hasTranslation = false;
    const children = target.childNodes ? Array.from(target.childNodes) : [];
    for (const child of children) {
      let text = null;
      if (child.nodeType === Node.TEXT_NODE) {
        text = child;
      } else if (child.tagName === 'SPAN' && hasClasses(child, 'font-semibold', 'text-foreground')) {
        const inner = child.firstChild;
        if (inner && inner.nodeType === Node.TEXT_NODE && !inner.nextSibling) text = inner;
      }
      if (!text) return false;
      const tracked = originals.texts.get(text);
      source += (tracked && tracked.zh === text.nodeValue) ? tracked.orig : (text.nodeValue || '');
      if (officialDescTextMeta.get(text)) hasTranslation = true;
      if (!primary && text === child) primary = text;
      texts.push(text);
    }
    const entry = Object.hasOwn(OFFICIAL_PLUGIN_DESCRIPTIONS, source) ? OFFICIAL_PLUGIN_DESCRIPTIONS[source] : null;
    if (entry && hasVerifiedOfficialPluginDescription(target, source, entry)) {
      primary = primary || texts[0];
      if (primary) {
        for (let i = 0; i < texts.length; i++) {
          const nextVal = texts[i] === primary ? entry.translation : '';
          if (texts[i].nodeValue !== nextVal) writeText(texts[i], nextVal);
          officialDescTextMeta.set(texts[i], true);
          texts[i].__zh_patched = true;
          texts[i].__zh_patched_fp = fingerprint;
        }
        target.__zh_patched = true;
        target.__zh_patched_fp = fingerprint;
      }
      const title = target.getAttribute?.('title');
      const titleTracked = originals.attrs.get(target)?.get('title');
      if (slot.kind === 'featured' && title != null &&
          (title === source || (titleTracked && title === titleTracked.zh && titleTracked.orig === source))) {
        if (title !== entry.translation) writeAttr(target, 'title', entry.translation);
        officialDescTitleMeta.set(target, true);
      } else if (officialDescTitleMeta.get(target)) {
        restoreAttrByName(target, 'title');
        officialDescTitleMeta.delete(target);
      }
      return true;
    }
    if (hasTranslation) {
      for (const textNode of texts) {
        restoreTrackedNode(textNode);
        officialDescTextMeta.delete(textNode);
      }
    }
    if (officialDescTitleMeta.get(target)) {
      restoreAttrByName(target, 'title');
      officialDescTitleMeta.delete(target);
    }
    return false;
  }

  function shouldSkipSubtree(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;

    // 保护 SSH 主机名、配置文件名及 GitHub/depot PR 卡片中的仓库远程元数据
    if (isRemoteMetadataElement(element)) return true;

    // 协调员欢迎语中的项目名由用户提供，即使与词条同名也不翻译。
    if (element.closest('[data-testid="coordinator-welcome"] strong')) return true;

    // 删除说明中的项目/自动化名称是用户数据，即使与词条同名也不能翻译。
    const strong = element.closest('strong');
    if (strong && ((!strong.previousElementSibling && isProjectDeletionDescription(strong.parentElement)) ||
        projectDeletionParts(strong.parentElement)?.name === strong ||
        automationManagedParts(strong.parentElement)?.name === strong)) return true;

    // 设置页和自定义项页的列表名称均为用户数据，描述和按钮仍可翻译。
    if (element.closest(protectedCustomizationNameSelector)) return true;

    // 斜杠命令、技能、文件等建议项的标签是实际名称；保留分类标题的翻译。
    if (isProtectedMentionLabel(element)) return true;

    // 跳过代码与编辑区（textarea 放到下方输入区规则中，保留自身 placeholder/aria-label 翻译）
    if (element.closest('script, style, code, pre, .xterm, .monaco-editor, [data-agy-hans-ui], #ag-quick-capsule-bar, #ag-context-meter, [data-agy-context-capsule], #__agy_ctx_capsule_tooltip__, #ag-chat-nav-float, .ag-risk-banner, #ag-file-editor-controls, #ag-inline-file-editor-wrap, #ag-quota, #ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu, [data-ag-enhancer]')) {
      return true;
    }

    // MCP App 状态节点仅允许前缀容器自身的首文本节点参与翻译，子元素中的应用名与诊断信息保持原文
    if (element.closest('[data-testid="mcp-app-pane-loading"], [data-testid="mcp-app-pane-error"], [data-testid="mcp-app-view-error"]') &&
        !getMcpAppStatusLabel(element)) {
      return true;
    }

    // 这些界面节点显示用户自定义名称或资源，而不是固定控件文案。
    if (element.closest('[data-testid="file-title-name"], [data-testid="branch-pill-label"], [data-testid="branch-repo-label"], [data-testid="automation-name"], [data-testid="webview-download-filename"], [data-testid="side-question-tab-header-name"], [data-testid="subagent-tab-header-title"], [data-testid="project-selector-item"] span[title], [data-testid="branch-option"] span[title], [data-testid="project-selector-github-repo-item"], [data-testid="resource-link"], [data-testid="image-strip-tile"], [data-testid="image-strip-viewer-caption"], [data-testid="image-strip-viewer-thumbnail"], [data-testid="model-selector-orchestrator-model"]')) {
      return true;
    }

    // 模型按推理强度分组行中的标签与徽标（如 "New"）保留原文
    const modelGroupItem = element.closest('.agy-overlay-item');
    if (modelGroupItem?.firstElementChild?.firstElementChild?.getAttribute?.('data-testid') === 'model-selector-effort-group') {
      return true;
    }

    // 跳过输入框与文本域的正文/子节点，但允许元素自身属性（placeholder、aria-label）翻译
    if (node.nodeType === Node.TEXT_NODE) {
      if (element.closest('[contenteditable]:not([contenteditable="false"]), input, textarea')) {
        return true;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const parent = node.parentElement;
      if (parent && parent.closest('[contenteditable]:not([contenteditable="false"]), input, textarea')) {
        return true;
      }
    }

    // 跳过会话标题与面包屑（用户或模型生成的自定义会话名与文件路径）
    if (element.closest('[data-testid="breadcrumb-segment"], nav [class*="breadcrumb"], [data-uri]')) {
      return true;
    }

    // 跳过用户输入
    if (element.closest('[data-testid="user-input-step"], [data-testid="user-message-content"], [aria-label="User message"], [aria-label="用户消息"]')) {
      return true;
    }

    return false;
  }

  function isSettingsProjectNameElement(element) {
    const row = element.closest('button[data-testid]');
    if (row?.getAttribute('data-testid')?.startsWith('settings-nav-item-') &&
        row.closest('[data-testid="settings-sidebar"]')) {
      const heading = row.parentElement?.parentElement?.previousElementSibling?.querySelector('h2');
      const text = heading?.firstChild;
      const label = originals.texts.get(text)?.orig ?? heading?.textContent;
      return /^(?:Projects|專案(?:管理)?|项目(?:管理)?)$/.test(label?.trim() || '');
    }
    const name = element.closest('span');
    const edit = name?.nextElementSibling;
    return !!(name?.closest('.settings-modal-backdrop h2, .settings-modal-container h2') &&
      edit?.tagName === 'BUTTON' && /^(?:Edit (?:project|workspace) name$|(?:编辑名称|編輯名稱)[:：])/i.test(
        edit.getAttribute('aria-label') || ''));
  }

  function isSettingsEditableValue(element) {
    // 权限列表把已保存的值渲染为带 title 的文本，旁边才是编辑和移除按钮。
    const value = element.closest('span[title]');
    if (!value?.closest('.settings-modal-backdrop, .settings-modal-container')) return false;
    const actions = value.nextElementSibling;
    const edit = actions?.firstElementChild;
    const remove = edit?.nextElementSibling;
    return edit?.tagName === 'BUTTON' && remove?.tagName === 'BUTTON' &&
      /^(?:Edit|编辑|編輯)$/i.test(edit.getAttribute('aria-label') || '') &&
      /^(?:Remove|移除|删除|刪除)$/i.test(remove.getAttribute('aria-label') || '');
  }

  function getNativeReactProps(element) {
    const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
    return key && element[key];
  }

  function isSelectedProjectName(node, element) {
    if (node.nodeType !== Node.TEXT_NODE || element.tagName !== 'SPAN' || !element.classList.contains('truncate') ||
        element.parentElement?.getAttribute('data-testid') !== 'project-selector-trigger') return false;

    const label = getNativeReactProps(element)?.children ?? originals.texts.get(node)?.orig ?? node.nodeValue;
    if (typeof label !== 'string' || !/^(?:No Project|Select Project|Select Workspace|New Workspace)$/.test(label)) return true;

    // 占位文案也可能是自訂名稱；對話路由帶有實際專案 ID 時保留原文。
    const projectId = new URLSearchParams(location.search).get('project');
    return Boolean(projectId && !/^(?:outside-of-project|standalone|ungrouped)$/.test(projectId));
  }

  function restoreProtectedValue(node, element) {
    if (originals.texts.has(node) || originals.attrs.has(node)) restoreTrackedNode(node);
    // 舊版熱更新可能已丟失原文記錄；只從已識別的原生欄位讀取 React 提供的原值。
    const props = getNativeReactProps(element);
    if (node.nodeType === Node.TEXT_NODE && node === element.firstChild && !node.nextSibling &&
        typeof props?.children === 'string' && node.nodeValue !== props.children) {
      node.nodeValue = props.children;
    } else if (node.nodeType === Node.ELEMENT_NODE && typeof props?.title === 'string' &&
        element.getAttribute('title') !== props.title) {
      element.setAttribute('title', props.title);
    }
  }

  function shouldSkip(node, restoreProtected = false) {
    if (shouldSkipSubtree(node)) return true;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;

    if (isSelectedProjectName(node, element) || isSettingsProjectNameElement(element) || isSettingsEditableValue(element)) {
      if (restoreProtected) restoreProtectedValue(node, element);
      return true;
    }

    // 自定义项列表的名称及未核验插件卡片元数据保持原文；经校验的官方插件简介由专用通道处理。
    if (element.matches?.('span[data-tooltip-id].text-sm.font-medium.truncate') &&
        element.closest('[data-testid="workspace-customizations-view"]')) return true;
    if (isProtectedPluginMetadataElement(element)) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      // React 将 SSH 别名/路径拆分为紧邻固定英文前缀后的独立文本节点，保留其原样（例如主机名为 "Open" 时）
      const previous = node.previousSibling;
      if (previous && previous.nodeType === Node.TEXT_NODE && element.classList &&
          (element.classList.contains('text-foreground') || element.classList.contains('text-muted-foreground'))) {
        const trackedPrev = originals.texts.get(previous);
        const prefix = (trackedPrev && trackedPrev.zh === previous.nodeValue ? trackedPrev.orig : (previous.nodeValue || '')).trim();
        if ((prefix === "Couldn't connect to" && element.closest?.('[data-testid="ssh-connect-error"]')) ||
            (prefix === 'No hosts in' && element.closest?.('[data-testid="ssh-connect-dialog"]'))) {
          return true;
        }
      }
      const project = element.closest('[data-testid="project-header"][data-project-label], [data-testid="project-selector-item"][data-project-name]');
      const projectName = project?.getAttribute?.('data-project-label') ?? project?.getAttribute?.('data-project-name');
      if (projectName != null && (node.nodeValue || '').trim() === projectName.trim()) return true;
    }

    // 跳过侧边栏会话历史列表中的会话名称（保留行内操作按钮）；注意 2.34+ 主对话容器 div[data-testid="conversation-view"] 自身也带有 data-cascade-id，不得误伤对话内控件
    const historyItem = element.closest('[data-testid="conversation-row-sidebar"], [data-cascade-id]:not([data-testid="conversation-view"]), .past-conversations, .conversation-list, .history-list, .conversations-list, [data-testid="history-list"], [data-testid="past-conversations"], .conversation-item, .convo-item, .history-item, [class*="history-item"], [class*="convo-item"]');
    if (historyItem) {
      const isActionBtn = element.closest('button[aria-label], button[title], [class*="delete"], [class*="pin"], [class*="archive"]');
      const isHistoryMeta = node.nodeType === Node.TEXT_NODE && element.closest('span.text-xs');
      if (!isActionBtn && !isHistoryMeta) return true;
    }

    // 跳过回复正文（保留控件、折叠步骤栏、变更概览与系统提示卡片）
    const agentResponse = element.closest('[data-testid="agent-response"], [aria-label="Agent response"], [aria-label="智能体回复"]');
    if (agentResponse) {
      if (node.nodeType === Node.ELEMENT_NODE && element === agentResponse) return false;
      if (element.closest('[data-markdown-root]')) return true;
      const isInteractive = element.closest('button, [role="button"], [class*="action"], [class*="button-container"], [data-testid="cleared-step-notice"], .files-changed-header, [data-testid="thinking-collapsible-trigger"], [data-testid="worked-for-collapsible"], [data-testid="tool-group-collapsible"], [data-testid="changed-files-card-header"], [data-testid="changed-files-card-review"], [data-testid="cascade-system-message-toolbar"], [data-testid="inline-card-expiry"], [data-testid="mcp-app-pane-loading"], [data-testid="mcp-app-pane-error"], [data-testid="mcp-app-view-error"]');
      if (!isInteractive) return true;
    }

    return false;
  }

  const antigravityContainerSelector = [
    '[class*="antigravity"]',
    '[id*="antigravity"]',
    '[class*="jetski"]',
    '[id*="jetski"]',
    '.client-experience-pill',
    '.diff-hunk-widget',
    '.keep-changes',
    '.discard-changes',
    '.monaco-dialog-box',
    '.dialog-box',
    '[role="dialog"]',
    '.inline-chat-widget',
    '.inline-chat-overflow',
    '.monaco-hover',
    '.monaco-hover-content',
    '.context-view',
    '.monaco-select-box',
    '.monaco-menu',
    '.quick-input-widget',
    '.notification-toast',
    '.notifications-toasts',
    // VS Code/Antigravity IDE 设置页是异步渲染的，页面本身不一定带有
    // antigravity/jetski 类名；显式纳入设置容器，避免 Settings 页面被白名单过滤。
    '.settings-editor',
    '.settings-body',
    '[class*="settings"]',
    '[id*="settings"]',
    '#workbench\\.parts\\.titlebar .titlebar-right',
    '#workbench\\.parts\\.titlebar .action-label',
    '#workbench\\.parts\\.titlebar .action-nudge-button',
    // 仅匹配 IDE 的全局 Antigravity 设置标签，避免改写普通文件标签。
    '.tabs-container .tab[data-resource-name="global"][aria-label="Antigravity Settings"]',
    '.tabs-container .tab[data-resource-name="global"][aria-label="Antigravity 设置"]',
    '.antigravity-welcome-container',
    '[class*="welcome"]',
    '[class*="agent"]',
    '[id*="agent"]',
    // 状态栏与辅助栏标题属原生外壳，不带 antigravity 类名
    '.part.statusbar',
    '.statusbar-item',
    '.part.auxiliarybar .composite.title',
    '.part.auxiliarybar .title-label',
    // 输入框补全等弹层挂在 body 下，和 .monaco-workbench 同级
    '.monaco-workbench ~ div',
    '.entrance-title',
    '[role="listbox"]',
    '[role="option"]'
  ].join(', ');

  function isInAntigravityContainer(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;

    // 主窗口白名单
    const isMainWindow = window.location.pathname.endsWith('workbench.html') ||
      window.location.href.indexOf('/workbench.html') >= 0 ||
      window.location.href.indexOf('\\workbench.html') >= 0;
    if (!isMainWindow) return true;

    return !!element.closest(antigravityContainerSelector);
  }

  // React 把部分说明文案拆成多个文本节点，按中文语序重写各节点以保留行内链接。
  const composedSentences = [
    {
      // 项目类型由应用单独渲染，不包含用户填写的项目名。
      match: /^(?:A\s+|已存在同名)(?:project|workspace|项目|工作区)(?:\s+with this name already exists\.|。)$/i,
      nodes: new Map([
        ['A', '已存在同名'], ['project', '项目'], ['workspace', '工作区'],
        ['with this name already exists.', '。'],
      ]),
    },
    {
      // 链接仍由应用管理，仅改写周围文本和标点。
      match: /^(?:For Antigravity Business consumption options, see|有关 Antigravity Business 的用量选项，请参阅)\s*(?:documentation|文档)[.。]$/,
      nodes: new Map([
        ['For Antigravity Business consumption options, see', '有关 Antigravity Business 的用量选项，请参阅'],
        ['.', '。'],
      ]),
    },
    {
      match: /^Open (?:Antigravity|Antigravity IDE) panel$/,
      nodes: new Map([['Open', '打开 '], ['panel', ' 面板']]),
    },
    {
      // 空状态标题可能被 React 拆成三个节点：No / Automations / yet。
      match: /^(?:No|否)\s+(?:Automations|自动化)\s+yet$/i,
      nodes: new Map([
        ['No', '暂无'], ['否', '暂无'], ['yet', ''],
      ]),
    },
    {
      match: /^Also includes (?:Global Permissions|全局权限) when working in these conversations\./,
      nodes: new Map([
        ['Also includes', '在这些对话中工作时，还包括'],
        ['when working', ''],
        ['in these conversations', ''],
        ['.', '。'],
      ]),
    },
    {
      match: /^Also includes (?:Global Permissions|全局权限) when working in this project\.(?: (?:Learn more\.|了解更多[。.]?))?$/,
      nodes: new Map([
        ['Also includes', '在此项目中工作时，还包括'],
        ['when working', ''],
        ['in this project', ''],
        ['.', '。'],
        ['when working in this project.', '。'],
      ]),
    },
    {
      match: /^Select one of the (?:two|three) options\. Agent settings and permissions can be further customized below\./,
      nodes: new Map([
        ['Select one of the', '选择以下'],
        ['two', '两'],
        ['three', '三'],
        ['options. Agent settings and permissions can be further customized below.', '项之一。智能体设置和权限可在下方进一步自定义。'],
      ]),
    },
  ];

  function translateComposedElement(element) {
    const managed = automationManagedParts(element);
    if (managed) {
      const kind = /^(?:workspace|工作区)$/i.test((managed.kind.nodeValue || '').trim()) ? '工作区' : '项目';
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && !(node.nodeValue || '').trim() && node.nodeValue) writeText(node, '');
      }
      for (const [node, text] of [[managed.prefix, '此'], [managed.kind, kind], [managed.join, '由自动化“'], [managed.suffix, `”管理，只能通过删除该自动化来删除此${kind}。`]]) {
        if (node.nodeValue !== text) writeText(node, text);
        node.__zh_patched = true;
        node.__zh_patched_fp = fingerprint;
      }
      return true;
    }
    const deletion = projectDeletionParts(element);
    if (deletion) {
      if (deletion.join && (deletion.join.nodeValue || '').trim() === 'including') {
        writeText(deletion.join, ' 包含 ');
        deletion.join.__zh_patched = true;
        deletion.join.__zh_patched_fp = fingerprint;
      }
      if ((deletion.punctuation.nodeValue || '').trim() === '.') {
        writeText(deletion.punctuation, '。');
        deletion.punctuation.__zh_patched = true;
        deletion.punctuation.__zh_patched_fp = fingerprint;
      }
      return true;
    }
    // 组合句都至少需要 3 个文本节点；叶子元素直接跳过，避免读取整棵子树的 textContent。
    if (!element.childNodes || element.childNodes.length < 3) return false;
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    const rule = composedSentences.find((item) => item.match.test(text));
    if (!rule) return false;
    for (const child of element.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const key = (child.nodeValue || '').trim();
      if (!key) {
        // 中文句子不保留节点间空白
        if (child.nodeValue) writeText(child, '');
        child.__zh_patched = true;
        child.__zh_patched_fp = fingerprint;
        continue;
      }
      if (!rule.nodes.has(key)) continue;
      writeText(child, rule.nodes.get(key));
      child.__zh_patched = true;
      child.__zh_patched_fp = fingerprint;
    }
    return true;
  }

  function translateScopedNavigation(element, value) {
    const text = value.trim();
    const match = text.match(/^(Next|Previous)(\s*\([←→]\))?$/);
    if (!match) return null;
    if (!match[2] && element.closest?.('.o2-tvstage > .o2-tvnav')) {
      return value.replace(text, () => (match[1] === 'Next' ? '下一帧' : '上一帧'));
    }
    const testId = match[1] === 'Next' ? 'media-modal-next' : 'media-modal-previous';
    if (!element.closest?.(`[data-testid="${testId}"]`) && !element.closest?.('.carousel')) return null;
    const label = (match[1] === 'Next' ? '下一项' : '上一项') + (match[2] || '');
    return value.replace(text, () => label);
  }

  function translateMarketplaceCategory(element, value) {
    if (!element || !value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (trimmed === 'Science') {
      const inChip = Boolean(element.closest?.('[data-testid="marketplace-category-option-science"], [data-testid="marketplace-category-chip"]'));
      const inShelfHeading = Boolean(
        element.closest?.('[data-testid="customizations-marketplace"]') &&
        ((element.tagName === 'SECTION' && element.hasAttribute?.('aria-label')) ||
          (element.tagName === 'H2' && element.parentElement?.tagName === 'DIV' &&
            element.parentElement?.parentElement?.tagName === 'SECTION' &&
            element.parentElement?.parentElement?.hasAttribute?.('aria-label')))
      );
      if (inChip || inShelfHeading) return value.replace(trimmed, () => '科研');
    }
    if (element.tagName === 'BUTTON' && (trimmed === 'See more in Science' || trimmed === 'See less in Science')) {
      const sec = element.closest?.('section');
      if (sec?.hasAttribute?.('aria-label') && sec.closest?.('[data-testid="customizations-marketplace"]')) {
        return value.replace(trimmed, () => (trimmed === 'See more in Science' ? '在科研中查看更多' : '在科研中收起'));
      }
    }
    return null;
  }

  function translateFeaturedAttribute(element, attr, value) {
    if (!element || !value) return null;
    const name = element.getAttribute?.('data-member-name');
    if (name && element.getAttribute?.('data-testid') === 'featured-carousel-member-tile') {
      if (attr === 'title') return value;
      if (attr === 'aria-label') {
        if (value.startsWith(name + ', ')) {
          const rawTail = value.slice(name.length + 2);
          const status = matchExactPhrase(rawTail) ?? (() => {
            const tr = translate(rawTail);
            return tr !== rawTail ? tr : null;
          })();
          return status ? (name + '，' + status) : value;
        }
        return value;
      }
    }
    if (attr !== 'aria-label') return null;
    const action = value.match(/^(Details for|Adding|Add) (.+)$/);
    if (action && element.closest?.('[data-testid="featured-carousel"]')) {
      const labels = { 'Details for': '查看详情：', Adding: '正在添加 ', Add: '添加 ' };
      return labels[action[1]] + action[2];
    }
    return null;
  }

  function isSideQuestionDraftTitle(element) {
    return element?.getAttribute?.('data-testid') === 'side-question-tab-header-title' ||
      Boolean(element?.closest?.('button[data-tab-id="side_question__draft"]'));
  }

  function translateScopedControlText(element, value) {
    if (!element || !value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const testId = element.getAttribute?.('data-testid');

    if (trimmed === 'New Side Question' && isSideQuestionDraftTitle(element)) {
      return value.replace(trimmed, () => '新建旁路提问');
    }

    const marketCat = translateMarketplaceCategory(element, value);
    if (marketCat !== null) return marketCat;

    if (trimmed.endsWith(' left') && element.closest?.('[data-testid="inline-card-expiry"]')) {
      const remaining = trimmed.match(/^(\d+)([ms]) left$/);
      if (remaining) return value.replace(trimmed, () => `剩余 ${remaining[1]} ${remaining[2] === 'm' ? '分钟' : '秒'}`);
    }
    if (trimmed === 'Delete project' && element.tagName === 'SPAN' && isProjectDeletionDetails(element.parentElement?.parentElement)) {
      return value.replace(trimmed, () => '删除项目');
    }
    if (trimmed === 'Welcome to Antigravity!' && element.tagName === 'DIV' && element.classList?.contains('entrance-title')) {
      return value.replace(trimmed, () => '欢迎使用 Antigravity！');
    }
    if (trimmed === 'SSH Host' && element.closest?.('[data-testid="project-selector-ssh-host-trigger"]')) {
      return value.replace(trimmed, () => 'SSH 主机');
    }
    if (trimmed === 'commands.' && element.firstElementChild?.tagName === 'CODE' &&
        element.firstElementChild.textContent === 'antigravity.' &&
        ((originals.texts.get(element.firstChild)?.orig || element.firstChild?.nodeValue || '').trim() ===
          'Inspect live bindings or record custom key chords filtered to')) {
      return value.replace(trimmed, () => '的命令。');
    }
    if (element.classList?.contains('text-muted-foreground') && element.closest?.('[data-testid="ssh-connect-dialog"]')) {
      if (trimmed === 'No hosts in') return value.replace(trimmed, () => '尚无主机记录，配置文件：');
      if (trimmed === 'yet. Type one above.') return value.replace(trimmed, () => '。可在上方手动输入。');
    }
    if (element.classList?.contains('text-foreground') && element.closest?.('[data-testid="ssh-connect-error"]') &&
        trimmed === "Couldn't connect to") {
      return value.replace(trimmed, () => '无法连接到');
    }
    if (element.tagName === 'SPAN' && element.classList?.contains('whitespace-nowrap') &&
        element.closest?.('[data-testid="github-hover-auth-actions"]') && trimmed === 'in a terminal') {
      return value.replace(trimmed, () => '（在终端中）');
    }
    if (element.tagName === 'SPAN' && element.classList?.contains('text-muted-foreground') &&
        element.parentElement?.classList?.contains('grid-cols-[auto_1fr]') &&
        hasPullRequestCardHeader(element.parentElement.parentElement) && trimmed === 'Author') {
      return value.replace(trimmed, () => '作者');
    }
    if (testId === 'find-bar-match-count') {
      const matchCount = trimmed.match(/^(\d+) of (\d+\+?)$/);
      if (matchCount) return value.replace(trimmed, () => `第 ${matchCount[1]} 项，共 ${matchCount[2]} 项`);
    }
    if (testId === 'ssh-connect-hidden-hosts-toggle') {
      const hidden = trimmed.match(/^(\d+) hidden hosts?$/);
      if (hidden) return value.replace(trimmed, () => `${hidden[1]} 台隐藏主机`);
    }
    if (testId === 'ssh-connect-host-group-label') {
      const config = trimmed.match(/^SSH Config \((.+)\)$/);
      if (config) return value.replace(trimmed, () => `SSH 配置（${config[1]}）`);
    }
    if (element.classList?.contains('z-10') && element.parentElement?.classList?.contains('text-compact') &&
        hasPullRequestCardHeader(element.parentElement.parentElement?.parentElement)) {
      const state = { Open: '开放', Closed: '已关闭', Merged: '已合并', Draft: '草稿' }[trimmed];
      if (typeof state === 'string') return value.replace(trimmed, () => state);
    }
    if (trimmed === 'at' && element.matches?.('span.text-muted-foreground.select-none') &&
        element.closest?.('[data-testid="automation-schedule-editor"]')) {
      return value.replace(trimmed, () => '于');
    }
    if (testId === 'queued-messages-status' && trimmed.startsWith('Waiting on ') &&
        trimmed.length > 'Waiting on '.length) {
      return value.replace(trimmed, () => '正在等待 ' + trimmed.slice('Waiting on '.length));
    }
    if ((trimmed === 'Your plan' || trimmed === 'Your plan:' || trimmed.startsWith('Your plan: ')) &&
        element.classList?.contains('font-medium') && element.closest?.('.settings-modal-container')) {
      return value.replace(trimmed, () => (trimmed === 'Your plan' ? '当前方案' : '当前方案：' + trimmed.slice('Your plan:'.length).trimStart()));
    }
    if (trimmed.endsWith(' (disabled by admin)') &&
        element.closest?.('[data-testid^="permissions-"], button[data-testid="permissions-selector-trigger"], button.agy-select-trigger, [data-select-popup] [role="option"].agy-overlay-item')) {
      const preset = trimmed.slice(0, -' (disabled by admin)'.length);
      if (preset === 'Auto' || preset === 'Turbo' || preset === 'Default' || preset === 'Request Review') {
        return value.replace(trimmed, () => (matchExactPhrase(preset) ?? preset) + '（管理员已禁用）');
      }
    }
    return null;
  }

  // 菜单搜索会把匹配片段拆成多个高亮节点；只重组已核对的内置命令说明。
  const slashMenuDescriptions = new Map([
    ['btw', 'Ask a quick question without interrupting the main conversation.'],
    ['goal', 'Run until the specified goal is completely finished.'],
    ['compact', 'Compact the conversation now (summarize history to free up the context window).'],
    ['schedule', 'Run an instruction on a recurring schedule or as a one-time timer.'],
    ['browser', 'Invoke a browser agent for web tasks.'],
    ['plan', 'Plan carefully before executing a task.'],
    ['grill-me', 'Interview me to align on a plan.'],
    ['teamwork', 'Invoke a team of agents to autonomously tackle large projects.'],
    ['learn', 'Reflect on recent successes or corrections to capture reusable skills or rules.'],
    ['boost', 'Invoke the Boost multi-agent orchestrator for complex tasks.'],
  ]);
  const translatedSlashDescriptions = new WeakMap();

  function originalMenuText(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    const current = nodes.map((node) => node.nodeValue || '').join('');
    const source = nodes.map((node) => {
      const record = originals.texts.get(node);
      return record && record.zh === node.nodeValue ? record.orig : (node.nodeValue || '');
    }).join('');
    return { nodes, current, source };
  }

  // 协调员欢迎语逐词拆为 span；只改写已确认的固定文案，保留 strong 中的项目名。
  const translatedCoordinatorParagraphs = new WeakMap();
  const coordinatorIntro = ". I coordinate the work for this project. Ask me a question or hand me a task, and I'll answer directly or start workers that run in parallel.";
  const coordinatorFollow = "You can follow the workers in the Dashboard, and I'll post an update when something finishes or needs you.";
  function coordinatorOriginal(node) {
    const record = originals.texts.get(node);
    return record && record.zh === node.nodeValue ? record.orig : (node.nodeValue || '');
  }
  function rewriteCoordinatorNodes(nodes, value) {
    nodes.forEach((node, index) => {
      const next = index === 0 ? value : '';
      if (node.nodeValue !== next) writeText(node, next);
      node.__zh_patched = true;
      node.__zh_patched_fp = fingerprint;
    });
  }
  function restoreCoordinatorParagraph(paragraph) {
    const nodes = translatedCoordinatorParagraphs.get(paragraph);
    if (!nodes) return;
    for (const node of nodes) restoreTrackedNode(node);
    translatedCoordinatorParagraphs.delete(paragraph);
  }
  function translateCoordinatorWelcome(element) {
    if (!element.matches?.('[data-testid="coordinator-welcome"]')) return false;
    const paragraphs = element.querySelectorAll?.(':scope > p');
    if (!paragraphs || paragraphs.length !== 2) return false;
    let translated = false;
    const first = paragraphs[0];
    const names = first.querySelectorAll?.('strong');
    if (names?.length === 1) {
      const name = names[0];
      const nodes = originalMenuText(first).nodes;
      const firstName = nodes.findIndex((node) => name.contains(node));
      let lastName = firstName;
      while (lastName + 1 < nodes.length && name.contains(nodes[lastName + 1])) lastName++;
      const before = nodes.slice(0, firstName);
      const after = nodes.slice(lastName + 1);
      const matches = firstName > 0 && after.length &&
        before.map(coordinatorOriginal).join('') === 'Welcome to ' &&
        after.map(coordinatorOriginal).join('') === coordinatorIntro;
      if (matches) {
        rewriteCoordinatorNodes(before, '欢迎来到 ');
        rewriteCoordinatorNodes(after, '。我是本项目的协调员。你可以向我提问或交给我任务，我会直接回答，或启动并行工作的成员。');
        translatedCoordinatorParagraphs.set(first, [...before, ...after]);
        translated = true;
      } else restoreCoordinatorParagraph(first);
    } else restoreCoordinatorParagraph(first);
    const second = paragraphs[1];
    const nodes = originalMenuText(second).nodes;
    if (nodes.length && nodes.map(coordinatorOriginal).join('') === coordinatorFollow) {
      rewriteCoordinatorNodes(nodes, '你可以在控制面板中查看各成员的进展；有任务完成或需要你参与时，我会发布更新。');
      translatedCoordinatorParagraphs.set(second, nodes);
      translated = true;
    } else restoreCoordinatorParagraph(second);
    return translated;
  }

  function translateKnownSlashDescription(element) {
    if (!element.matches?.('[data-testid="menu-option-description"]') ||
        !element.closest?.('[data-mention-menu]')) return false;
    const row = element.closest?.('[role="option"]');
    const label = row?.querySelector?.('[data-testid="menu-option-label"]');
    if (!label) return false;
    const command = originalMenuText(label).source.trim();
    const expected = slashMenuDescriptions.get(command);
    if (!expected) return false;
    const { nodes, current, source } = originalMenuText(element);
    if (!nodes.length) return false;
    const previous = translatedSlashDescriptions.get(element);
    if (previous?.command === command && previous.rendered === current) {
      for (const node of nodes) {
        node.__zh_patched = true;
        node.__zh_patched_fp = fingerprint;
      }
      return true;
    }
    const text = source.trim();
    const matches = text === expected ||
      (text.startsWith('…') && text.length >= 20 && expected.includes(text.slice(1)));
    const translated = matches ? phrases.get(expected) : null;
    if (!translated) {
      if (previous) for (const node of nodes) restoreTrackedNode(node);
      translatedSlashDescriptions.delete(element);
      return false;
    }
    const rendered = formatZhText(source.replace(text, () => translated));
    nodes.forEach((node, index) => {
      const value = index === 0 ? rendered : '';
      if (node.nodeValue !== value) writeText(node, value);
      node.__zh_patched = true;
      node.__zh_patched_fp = fingerprint;
    });
    translatedSlashDescriptions.set(element, { command, rendered });
    return true;
  }

  function translateScopedPlaceholder(element, attr, value) {
    if (attr !== 'placeholder' || element?.tagName !== 'INPUT') return null;
    if (value === 'Search Hosts…' && element.parentElement?.getAttribute?.('data-testid') === 'project-selector-ssh-host-search') {
      return '搜索主机…';
    }
    if (value === 'Search languages to add (e.g. English, Spanish, 中文, yue)...' &&
        element.getAttribute?.('data-testid') === 'dictation-languages-search-input') {
      return '搜索要添加的语言（例如 English、Spanish、中文、yue）…';
    }
    return null;
  }

  function translateScopedAriaLabel(element, attr, value) {
    if (attr !== 'aria-label' || !value) return null;
    const trimmed = value.trim();
    if (element.getAttribute?.('data-testid') === 'url-security-indicator' &&
        trimmed.endsWith('. View site information')) {
      const siteInfoLabel = matchExactPhrase('View site information');
      if (siteInfoLabel) return value.replace(trimmed, () => trimmed.slice(0, -'. View site information'.length) + '。' + siteInfoLabel);
    }
    if (trimmed.startsWith('Reset ') && trimmed.endsWith(' to default') &&
        element.closest?.('[data-testid^="shortcut-row-"]')) {
      const action = trimmed.slice('Reset '.length, -' to default'.length);
      const actionZh = matchExactPhrase(action);
      if (actionZh) return value.replace(trimmed, () => '将' + actionZh + '恢复为默认设置');
    }
    if (element.matches?.('button[data-testid="permissions-selector-trigger"]') &&
        trimmed.startsWith('Agent permissions preset: ')) {
      const locked = trimmed.match(/^Agent permissions preset: ([^,]+), ([\s\S]+)$/);
      if (locked) {
        const presetLabel = matchExactPhrase(locked[1]) ?? locked[1];
        const reasonZh = matchExactPhrase(locked[2]) ?? locked[2];
        return value.replace(trimmed, () => `智能体权限预设：${presetLabel}，${reasonZh}`);
      }
    }
    return null;
  }

  function translateScopedTitle(element, attr, value) {
    if (attr !== 'title' || !value) return null;
    const trimmed = value.trim();
    if (trimmed === 'New Side Question' && isSideQuestionDraftTitle(element)) {
      return value.replace(trimmed, () => '新建旁路提问');
    }
    if (element.getAttribute?.('data-testid') === 'queued-messages-status') {
      if (trimmed.startsWith('Waiting on ') && trimmed.length > 'Waiting on '.length) {
        return value.replace(trimmed, () => '正在等待 ' + trimmed.slice('Waiting on '.length));
      }
    }
    return null;
  }

  function resolveElementAttrTranslation(element, attr, sourceValue) {
    return translateScopedAriaLabel(element, attr, sourceValue) ??
      translateScopedTitle(element, attr, sourceValue) ??
      translateScopedPlaceholder(element, attr, sourceValue) ??
      translateMarketplaceCategory(element, sourceValue) ??
      translateFeaturedAttribute(element, attr, sourceValue) ??
      translateScopedNavigation(element, sourceValue) ??
      (attr === 'aria-label' ? translateAriaLabel(sourceValue) : null) ??
      translate(sourceValue);
  }

  function translateElement(element) {
    if (shouldSkip(element, true)) return;
    if (!isInAntigravityContainer(element)) return;
    translateComposedElement(element);
    translateCoordinatorWelcome(element);
    translateKnownSlashDescription(element);
    for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute?.(attr);
      if (!value) continue;
      const tracked = originals.attrs.get(element)?.get(attr);
      if (tracked && tracked.zh === value) {
        if (tracked.orig && tracked.orig !== value) {
          const retranslated = resolveElementAttrTranslation(element, attr, tracked.orig);
          if (retranslated && formatZhText(retranslated) !== value) writeAttr(element, attr, retranslated);
        }
        continue;
      }
      const translated = resolveElementAttrTranslation(element, attr, value);
      if (translated && formatZhText(translated) !== value) writeAttr(element, attr, translated);
    }
  }

  // “Type” 在筛选/详情中表示类型，在计划提示里是“输入”。
  function translateTextValue(node) {
    const value = node.nodeValue || '';
    const tracked = originals.texts.get(node);
    if (tracked && tracked.zh === value) {
      if (tracked.orig && tracked.orig !== value) {
        const mcpTracked = node.parentElement ? getMcpAppStatusLabel(node.parentElement) : null;
        if (mcpTracked) {
          if (node !== node.parentElement.firstChild) return tracked.orig;
          const t = tracked.orig.trim();
          return t === mcpTracked[0] ? tracked.orig.replace(t, () => mcpTracked[1]) : tracked.orig;
        }
        const scopedRetranslated = node.parentElement
          ? (translateScopedControlText(node.parentElement, tracked.orig) ?? translateScopedNavigation(node.parentElement, tracked.orig))
          : null;
        const retranslated = scopedRetranslated !== null ? scopedRetranslated : translate(tracked.orig);
        if (retranslated && formatZhText(retranslated) !== value) return retranslated;
      }
      return value;
    }
    const mcpStatus = node.parentElement ? getMcpAppStatusLabel(node.parentElement) : null;
    if (mcpStatus) {
      if (node !== node.parentElement.firstChild) return value;
      const t = value.trim();
      return t === mcpStatus[0] ? value.replace(t, () => mcpStatus[1]) : value;
    }
    if (value.trim() === 'Type' && node.parentElement?.closest('[data-testid="plan-command-fyi-alert"]')) {
      return value.replace('Type', '输入');
    }
    if (value.trim() === 'Next' && node.parentElement?.nextElementSibling?.matches('[data-testid="automation-next-run"]')) {
      return value.replace('Next', '下次');
    }
    const scoped = node.parentElement ? translateScopedControlText(node.parentElement, value) : null;
    if (scoped !== null) return scoped;
    const navigation = node.parentElement ? translateScopedNavigation(node.parentElement, value) : null;
    if (navigation !== null) return navigation;
    return translate(value);
  }

  function translateNode(root) {
    if (!root) return;
    if (shouldSkipSubtree(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const parentEl = root.parentElement;
      if (parentEl && isProtectedPluginMetadataElement(parentEl)) {
        if (isInAntigravityContainer(parentEl)) translateOfficialPluginDescription(parentEl);
        return;
      }
      if (officialDescTextMeta.get(root)) {
        restoreTrackedNode(root);
        officialDescTextMeta.delete(root);
      }
      if (shouldSkip(root, true)) return;
      if (!isInAntigravityContainer(root)) return;
      if (root.__zh_patched_fp === fingerprint) return;
      const val = root.nodeValue || '';
      const tracked = originals.texts.get(root);
      const translated = translateTextValue(root);
      if (translated && formatZhText(translated) !== val) {
        writeText(root, translated);
      } else if (!(tracked && tracked.zh === val) && lang === 'zh-TW' && /[\u4e00-\u9fff]/.test(val) && formatZhText(val) !== val) {
        writeText(root, val);
      }
      root.__zh_patched = true;
      root.__zh_patched_fp = fingerprint;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (isProtectedPluginMetadataElement(root)) {
        if (isInAntigravityContainer(root)) translateOfficialPluginDescription(root);
      } else if (!shouldSkip(root, true) && root.__zh_patched_fp !== fingerprint) {
        // 节点可能先被插入、后被 React/Vue 补上容器 class。未处于目标容器时
        // 不能标记为已处理，否则后续容器就绪后不会再翻译它的子树。
        if (isInAntigravityContainer(root)) {
          translateElement(root);
          root.__zh_patched = true;
          root.__zh_patched_fp = fingerprint;
        }
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (shouldSkipSubtree(node)) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        const parentEl = node.parentElement;
        if (parentEl && isProtectedPluginMetadataElement(parentEl)) {
          if (isInAntigravityContainer(parentEl)) translateOfficialPluginDescription(parentEl);
          continue;
        }
        if (officialDescTextMeta.get(node)) {
          restoreTrackedNode(node);
          officialDescTextMeta.delete(node);
        }
        if (shouldSkip(node, true)) continue;
        if (!isInAntigravityContainer(node)) continue;
        if (node.__zh_patched_fp === fingerprint) continue;
        const val = node.nodeValue || '';
        const translated = translateTextValue(node);
        if (translated && formatZhText(translated) !== val) writeText(node, translated);
        node.__zh_patched = true;
        node.__zh_patched_fp = fingerprint;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (isProtectedPluginMetadataElement(node)) {
          if (isInAntigravityContainer(node)) translateOfficialPluginDescription(node);
          continue;
        }
        if (shouldSkip(node, true)) continue;
        if (node.__zh_patched_fp === fingerprint) continue;
        if (!isInAntigravityContainer(node)) continue;
        translateElement(node);
        node.__zh_patched = true;
        node.__zh_patched_fp = fingerprint;
      }
    }
  }

  // 把同一轮内的多个变更批次累积到一个定时器，避免每个 MutationObserver 回调各建一个 timer。
  function createFlushScheduler(flush) {
    let timer = null;
    let priorityNodes = [];
    let nodes = [];
    let elements = [];
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      priorityNodes = [];
      nodes = [];
      elements = [];
    };
    const schedule = (newNodes, newElements, newPriorityNodes = []) => {
      for (const node of newPriorityNodes) priorityNodes.push(node);
      for (const node of newNodes) nodes.push(node);
      for (const element of newElements) elements.push(element);
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const batchPriorityNodes = priorityNodes;
        const batchNodes = nodes;
        const batchElements = elements;
        priorityNodes = [];
        nodes = [];
        elements = [];
        flush(batchNodes, batchElements, batchPriorityNodes);
      }, 0);
    };
    return { schedule, cancel };
  }

  const LEGACY_PERMISSION_ZH_UPGRADES = new Map([
    ['极速', '无限'],
    ['极速模式', '无限模式'],
    ['智能体权限预设选择器，当前：极速', '智能体权限预设选择器，当前：无限']
  ]);
  const LEGACY_PERMISSION_ATTRS = [
    'title',
    'placeholder',
    'aria-label',
    'aria-description',
    'aria-placeholder',
    'alt',
    'data-tooltip'
  ];

  function isSkippedLegacyPermissionNode(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'CODE' || tag === 'PRE') {
      return true;
    }
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('#ag-context-meter, #ag-suite-capsule, #ag-suite-settings-panel, #ag-quota, #ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-font-menu, [data-ag-enhancer], [data-testid="user-input-step"], .prose, code, pre, script, style, textarea, input, [contenteditable="true"]')) {
      return true;
    }
    return false;
  }

  function upgradeLegacyPermissionLabels() {
    if (!document || !document.documentElement) return;
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 1) {
        if (isSkippedLegacyPermissionNode(node)) continue;
        if (typeof shouldSkip === 'function' && shouldSkip(node)) continue;
        if (typeof isInAntigravityContainer === 'function' && !isInAntigravityContainer(node)) continue;
        for (let i = 0; i < LEGACY_PERMISSION_ATTRS.length; i++) {
          const attr = LEGACY_PERMISSION_ATTRS[i];
          if (!node.hasAttribute(attr)) continue;
          const rawAttr = node.getAttribute(attr);
          if (!rawAttr) continue;
          const replacement = LEGACY_PERMISSION_ZH_UPGRADES.get(rawAttr.trim());
          if (replacement) {
            const lead = rawAttr.match(/^\s*/)[0];
            const tail = rawAttr.match(/\s*$/)[0];
            node.setAttribute(attr, lead + formatZhText(replacement) + tail);
          }
        }
      } else if (node.nodeType === 3 && node.nodeValue) {
        const parent = node.parentElement;
        if (isSkippedLegacyPermissionNode(parent)) continue;
        if (typeof shouldSkip === 'function' && shouldSkip(node)) continue;
        const isInMenuPopup = Boolean(
          parent &&
          parent.closest &&
          parent.closest('[role="menu"], [role="listbox"], [role="menuitem"], [role="option"], [data-radix-popper-content-wrapper]')
        );
        if (!isInMenuPopup && typeof isInAntigravityContainer === 'function' && !isInAntigravityContainer(node)) continue;
        const trimmedVal = node.nodeValue.trim();
        const replacement = LEGACY_PERMISSION_ZH_UPGRADES.get(trimmedVal)
          || (isInMenuPopup && trimmedVal === '新建' ? '新增' : null);
        if (replacement) {
          const lead = node.nodeValue.match(/^\s*/)[0];
          const tail = node.nodeValue.match(/\s*$/)[0];
          node.nodeValue = lead + formatZhText(replacement) + tail;
          node.__zh_patched = true;
          node.__zh_patched_fp = fingerprint;
        }
      }
    }
  }

  function applyChinese(resetMarks) {
    if (originalDocLang === null) {
      const rawDocLang = String(document.documentElement.lang || '').trim();
      originalDocLang = (!rawDocLang || /^zh/i.test(rawDocLang)) ? 'en' : rawDocLang;
    }
    document.documentElement.lang = lang === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    if (resetMarks) {
      // 更新规则时恢复旧版误译的名称，再跳过这些节点。
      restoreProtectedCustomizationNames();
      const stale = document.createTreeWalker(document, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = stale.nextNode(); node; node = stale.nextNode()) {
        node.__zh_patched = false;
        node.__zh_patched_fp = '';
      }
    }
    upgradeLegacyPermissionLabels();
    translateNode(document);
  }

  function normalizeHansLang(next) {
    const raw = String(next ?? '').trim().toLowerCase();
    if (!raw) return 'zh-TW';
    if (raw === 'zh-tw' || raw === 'zh-hant' || raw === 'zh-hk' || raw === 'tw' || raw.startsWith('zh-tw-') || raw.startsWith('zh-hant-')) return 'zh-TW';
    if (raw === 'zh' || raw.startsWith('zh-') || raw === 'cn') return 'zh';
    return 'en';
  }

  function setLang(next, persist = true) {
    next = normalizeHansLang(next);
    if (cancelled || next === lang) return;
    lang = next;
    if (persist) {
      savePref(LANG_KEY, next);
      const curSuiteLoc = String(loadPref(SUITE_LOCALE_KEY) || '').trim();
      if (!curSuiteLoc || /^(?:zh(?:-cn|-tw|-hans|-hant|-hk)?|cn|tw|en(?:-[a-z0-9]+)?)$/i.test(curSuiteLoc)) {
        savePref(SUITE_LOCALE_KEY, next === 'en' ? 'en' : (next === 'zh-TW' ? 'zh-TW' : 'zh-CN'));
      }
    }
    if (next === 'en') {
      flushScheduler?.cancel();
      restoreNativeArrayMap();
      restoreIdeNlsMessages();
      restoreOriginals(true);
      document.documentElement.lang = (originalDocLang && !/^zh/i.test(originalDocLang)) ? originalDocLang : 'en';
    } else {
      flushScheduler?.cancel();
      restoreIdeNlsMessages();
      restoreOriginals(true);
      installNativeArrayMapPatch();
      applyIdeNlsMessages();
      applyChinese(true);
    }
    updateToggleUI();
    broadcastPreferenceState();
  }

  // 开关「选项名保留英文」预设；中文状态下先还原再按新规则重译，英文状态下仅记录偏好
  function setEnglishLabels(next, persist = true) {
    next = !!next;
    if (cancelled || next === englishLabels) return;
    englishLabels = next;
    if (persist) savePref(ENGLISH_LABELS_KEY, next ? '1' : '0');
    if (isChineseLang()) {
      flushScheduler?.cancel();
      restoreOriginals();
      applyChinese(true);
    }
    updateToggleUI();
    broadcastPreferenceState();
  }

  // IDE 的智能体 iframe 与工作台属于不同来源，不能依赖跨来源 storage 事件。
  // 父窗口只响应本机 iframe 的状态请求；子页面只接受来自顶层窗口的状态。
  const preferencePeers = new Map();
  const preferenceRequest = 'antigravity-hans-preferences-request';
  const preferenceState = 'antigravity-hans-preferences-state';
  function sendPreferenceState(peer, origin) {
    try {
      if (peer.closed) { preferencePeers.delete(peer); return; }
      peer.postMessage({ type: preferenceState, lang, englishLabels }, origin);
    }
    catch (_e) { preferencePeers.delete(peer); }
  }
  function broadcastPreferenceState() {
    for (const [peer, origin] of preferencePeers) sendPreferenceState(peer, origin);
  }
  function startPreferenceSync() {
    let topWindow;
    try { topWindow = window.top; } catch (_e) { /* unavailable in restricted frames */ }
    const isFrame = !!topWindow && topWindow !== window;
    const isWorkbench = !isFrame && /\/(?:workbench|workbench-jetski-agent)\.html$/.test(window.location?.pathname || '');
    const isAgentFrame = isFrame && window.location?.protocol === 'http:' &&
      window.location?.hostname === '127.0.0.1' &&
      (window.location.pathname === '/' || window.location.pathname === '/settings-standalone');
    const onStorage = (e) => {
      if (e.key === LANG_KEY) setLang(e.newValue, false);
      else if (e.key === ENGLISH_LABELS_KEY) setEnglishLabels(e.newValue === '1', false);
    };
    const onMessage = (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (isAgentFrame && e.source === topWindow &&
          (e.origin === 'vscode-file://vscode-app' || e.origin === 'null') && data.type === preferenceState &&
          (data.lang === 'en' || data.lang === 'zh' || data.lang === 'zh-TW') && typeof data.englishLabels === 'boolean') {
        setLang(data.lang, false);
        setEnglishLabels(data.englishLabels, false);
      } else if (!isFrame && data.type === preferenceRequest && e.source &&
          ((isWorkbench && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(e.origin)) ||
           /^plugin:\/\/swarm--swarm_board-[a-z0-9]{5}$/i.test(e.origin))) {
        for (const peer of preferencePeers.keys()) {
          try { if (peer.closed) preferencePeers.delete(peer); } catch (_e) { preferencePeers.delete(peer); }
        }
        if (preferencePeers.size < 100 || preferencePeers.has(e.source)) {
          preferencePeers.set(e.source, e.origin);
          sendPreferenceState(e.source, e.origin);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    let timer = null;
    if (isAgentFrame) {
      const requestState = () => {
        try { topWindow.postMessage({ type: preferenceRequest }, '*'); } catch (_e) { /* parent unavailable */ }
      };
      requestState();
      // 重发请求以覆盖父窗口稍后注入或重载的情况。
      timer = setInterval(requestState, 3000);
    }
    removePreferenceSync = () => {
      if (timer !== null) clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
      preferencePeers.clear();
    };
  }

  // ===== 悬浮切换按钮（可拖动，位置与偏好经 savePref 持久化） =====
  // 单击：中英切换；双击或右键：打开选项菜单
  let toggleButton = null;
  let optionsMenu = null;
  let refreshMenu = null;

  function updateToggleUI() {
    refreshMenu?.();
    if (!toggleButton) return;
    // 按钮显示“点击后将切换到的语言”
    toggleButton.textContent = isChineseLang() ? 'EN' : '中';
    const tip = (isChineseLang() ? '单击切换为英文' : '单击切换为中文') + '；双击或右键打开选项（Antigravity-Hans）';
    toggleButton.title = tip;
    toggleButton.setAttribute('aria-label', tip);
  }

  function closeOptionsMenu() {
    optionsMenu?.remove();
    optionsMenu = null;
    refreshMenu = null;
  }

  function openOptionsMenu() {
    if (!toggleButton) return;
    if (optionsMenu) { closeOptionsMenu(); return; }
    const menu = document.createElement('div');
    menu.setAttribute('data-agy-hans-ui', '');
    menu.setAttribute('role', 'menu');
    Object.assign(menu.style, {
      position: 'fixed', zIndex: '2147483647', minWidth: '220px', maxWidth: '280px', padding: '6px',
      borderRadius: '10px', background: 'rgba(32,33,36,0.96)', color: '#e8eaed',
      border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      font: '13px/1.4 system-ui, -apple-system, sans-serif', userSelect: 'none',
    });
    menu.style.setProperty('-webkit-app-region', 'no-drag');

    const makeRow = (role, onSelect) => {
      const row = document.createElement('div');
      row.setAttribute('role', role);
      row.tabIndex = 0;
      Object.assign(row.style, { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 8px', borderRadius: '6px', cursor: 'pointer', outline: 'none' });
      const mark = document.createElement('span');
      Object.assign(mark.style, { width: '16px', flex: '0 0 16px', textAlign: 'center' });
      const body = document.createElement('span');
      row.append(mark, body);
      const highlight = (on) => { row.style.background = on ? 'rgba(255,255,255,0.08)' : 'transparent'; };
      row.addEventListener('pointerenter', () => highlight(true));
      row.addEventListener('pointerleave', () => highlight(document.activeElement === row));
      row.addEventListener('focus', () => highlight(true));
      row.addEventListener('blur', () => highlight(false));
      row.addEventListener('click', (e) => { e.stopPropagation(); onSelect(); });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } });
      return { row, mark, body };
    };
    const zh = makeRow('menuitemradio', () => setLang('zh'));
    zh.body.textContent = '中文';
    const en = makeRow('menuitemradio', () => setLang('en'));
    en.body.textContent = 'English';
    const divider = document.createElement('div');
    Object.assign(divider.style, { height: '1px', margin: '4px 6px', background: 'rgba(255,255,255,0.12)' });
    const labels = makeRow('menuitemcheckbox', () => setEnglishLabels(!englishLabels));
    const title = document.createElement('div');
    title.textContent = '选项名保留英文';
    const hint = document.createElement('div');
    hint.textContent = '权限模式、模型等级等保留英文，说明仍为中文（中文状态下生效）';
    Object.assign(hint.style, { fontSize: '11px', opacity: '0.65', marginTop: '2px' });
    labels.body.append(title, hint);
    menu.append(zh.row, en.row, divider, labels.row);

    refreshMenu = () => {
      zh.mark.textContent = isChineseLang() ? '●' : '○';
      en.mark.textContent = lang === 'en' ? '●' : '○';
      zh.row.setAttribute('aria-checked', String(isChineseLang()));
      en.row.setAttribute('aria-checked', String(lang === 'en'));
      labels.mark.textContent = englishLabels ? '☑' : '☐';
      labels.row.setAttribute('aria-checked', String(englishLabels));
    };
    refreshMenu();

    document.body.appendChild(menu);
    optionsMenu = menu;
    positionOptionsMenu();
    zh.row.focus?.({ preventScroll: true });
  }

  // 默认显示在按钮左上方，并限制在可见区域内；窗口缩放时重新定位
  function positionOptionsMenu() {
    if (!optionsMenu || !toggleButton) return;
    const b = toggleButton.getBoundingClientRect();
    const m = optionsMenu.getBoundingClientRect();
    let left = b.right - m.width;
    let top = b.top - m.height - 8;
    if (top < 4) top = b.bottom + 8;
    left = Math.max(4, Math.min(left, window.innerWidth - m.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - m.height - 4));
    optionsMenu.style.left = left + 'px';
    optionsMenu.style.top = top + 'px';
  }

  // 语言切换已统一迁移至 Antigravity Suite 统一设置面板中的下拉菜单，不再渲染独立悬浮圆形图标
  function mountToggleUI() {
    try {
      document.querySelectorAll?.('[data-agy-hans-ui]')?.forEach?.((node) => node.remove());
    } catch (_e) { /* ignore */ }
    closeOptionsMenu();
    toggleButton = null;
    removeToggleUI = () => {
      try {
        document.querySelectorAll?.('[data-agy-hans-ui]')?.forEach?.((node) => node.remove());
      } catch (_e) { /* ignore */ }
      closeOptionsMenu();
      toggleButton = null;
    };
  }

  const hasOwn = Object.prototype.hasOwnProperty;
  const SKIP_NATIVE_MENU_ID_RE =
    /^(?:project-(?!new$|remove$)|workspace-(?!new$|remove$)|worktree-(?!new$|remove$)|group-(?!new$|remove$)|message-timestamp$)/;

  function isNativeContextMenuEntry(item) {
    if (!item || typeof item !== 'object' || item.constructor !== Object) return false;
    if (item.type === 'separator') return true;
    return (
      (typeof item.label === 'string' || item.label === undefined) &&
      hasOwn.call(item, 'accelerator') &&
      ((hasOwn.call(item, 'checked') && hasOwn.call(item, 'disabled') && !('onClick' in item)) ||
        (hasOwn.call(item, 'click') && hasOwn.call(item, 'enabled') && typeof item.click === 'function'))
    );
  }

  function translateNativeMenuItemLabel(rawLabel, itemId) {
    if (!rawLabel || typeof rawLabel !== 'string') return rawLabel;
    if (itemId && SKIP_NATIVE_MENU_ID_RE.test(String(itemId))) return rawLabel;
    if (itemId === 'pin' && rawLabel === 'Pin') return lang === 'zh-TW' ? '釘選' : '置顶';
    if (itemId === 'pin' && rawLabel === 'Unpin') return lang === 'zh-TW' ? '取消釘選' : '取消置顶';
    const next = translate(rawLabel);
    return typeof next === 'string' ? formatZhText(next) : rawLabel;
  }

  function restoreNativeArrayMap() {
    if (window.__ag_orig_array_map && Array.prototype.map !== window.__ag_orig_array_map) {
      try {
        Object.defineProperty(Array.prototype, 'map', {
          value: window.__ag_orig_array_map,
          writable: true,
          configurable: true,
          enumerable: false
        });
      } catch (_e) { /* ignore */ }
    }
  }

  function installNativeArrayMapPatch() {
    const origArrayMap =
      typeof window.__ag_orig_array_map === 'function' && !window.__ag_orig_array_map.__agPatchedArrayMap
        ? window.__ag_orig_array_map
        : !Array.prototype.map.__agPatchedArrayMap
          ? Array.prototype.map
          : null;
    if (!origArrayMap) return;
    window.__ag_orig_array_map = origArrayMap;

    const patchedArrayMap = function map(callback) {
      const res = arguments.length > 1
        ? origArrayMap.call(this, callback, arguments[1])
        : origArrayMap.call(this, callback);
      if (cancelled || !isChineseLang()) return res;
      if (!Array.isArray(res)) return res;
      const len = res.length;
      if (len === 0 || len > 64) return res;
      let probe = null;
      for (let i = 0; i < len; i++) {
        const cand = res[i];
        if (!cand || typeof cand !== 'object' || cand.constructor !== Object) return res;
        if (cand.type === 'separator') continue;
        probe = cand;
        break;
      }
      if (!probe || !hasOwn.call(probe, 'accelerator') || !isNativeContextMenuEntry(probe)) {
        return res;
      }
      try {
        for (let i = 0; i < len; i++) {
          const entry = res[i];
          if (entry && isNativeContextMenuEntry(entry) && typeof entry.label === 'string' && entry.label) {
            entry.label = translateNativeMenuItemLabel(entry.label, entry.id);
          }
        }
      } catch (_e) { /* ignore */ }
      return res;
    };
    patchedArrayMap.__agPatchedArrayMap = true;

    try {
      Object.defineProperty(Array.prototype, 'map', {
        value: patchedArrayMap,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (_e) { /* ignore */ }
  }

  function run() {
    if (cancelled) return;
    if (isChineseLang()) {
      if (updating) restoreOriginals(true);
      installNativeArrayMapPatch();
      applyIdeNlsMessages();
      applyChinese(updating);
    } else {
      restoreNativeArrayMap();
      restoreOriginals(true);
      if (document.documentElement.lang && /^zh/i.test(document.documentElement.lang)) {
        document.documentElement.lang = 'en';
      }
    }
    // 对外提供统一设置面板与控制台调用接口
    window.__antigravityZhSetLang = setLang;
    window.__antigravityZhGetLang = () => lang;
    window.__antigravityZhSetEnglishLabels = setEnglishLabels;
    window.__antigravityZhGetEnglishLabels = () => englishLabels;
    startPreferenceSync();

    const onSuitePrefsChanged = (ev) => {
      const detail = ev?.detail;
      if (!detail || typeof detail !== 'object') return;
      const nextLocale = detail.hansCode || detail.locale || detail.capsuleLang;
      if (typeof nextLocale === 'string' && nextLocale.trim()) {
        setLang(nextLocale, false);
      }
      if (typeof detail.englishLabels === 'boolean') {
        setEnglishLabels(detail.englishLabels, false);
      }
    };
    window.addEventListener('ag-suite-prefs-changed', onSuitePrefsChanged);
    removeSuitePrefsListener = () => {
      window.removeEventListener('ag-suite-prefs-changed', onSuitePrefsChanged);
    };

    let isTranslatingSync = false;
    flushScheduler = createFlushScheduler((batchNodes, batchElements, batchPriorityNodes = []) => {
      if (cancelled || !isChineseLang()) return;
      isTranslatingSync = true;
      try {
        // 新挂载的设置侧栏优先于待处理子树，避免打开设置时短暂闪烁英文
        for (const node of batchPriorityNodes) {
          if (node && node.isConnected !== false) translateNode(node);
        }
        for (const node of batchNodes) translateNode(node);
        for (const element of batchElements) translateElement(element);
      } finally {
        isTranslatingSync = false;
      }
    });

    observer = new MutationObserver((mutations) => {
      if (!isChineseLang() || isTranslatingSync) return;
      const priorityNodesToTranslate = [];
      const nodesToTranslate = [];
      const elementsToTranslate = [];

      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const target = mutation.target;
          target.__zh_patched = false;
          target.__zh_patched_fp = '';
          const parent = target.parentElement;
          const welcome = parent?.closest?.('[data-testid="coordinator-welcome"]');
          if (welcome) {
            welcome.__zh_patched = false;
            welcome.__zh_patched_fp = '';
            nodesToTranslate.push(welcome);
            continue;
          }
          const description = parent?.closest?.('[data-testid="menu-option-description"]');
          if (description?.closest?.('[data-mention-menu]')) {
            description.__zh_patched = false;
            description.__zh_patched_fp = '';
            nodesToTranslate.push(description);
          } else if (parent && (projectDeletionParts(parent) || automationManagedParts(parent) || getOfficialPluginDescSlotElement(parent))) {
            const slotEl = getOfficialPluginDescSlotElement(parent)?.el || parent;
            slotEl.__zh_patched = false;
            slotEl.__zh_patched_fp = '';
            nodesToTranslate.push(slotEl);
          } else {
            nodesToTranslate.push(target);
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target;
          target.__zh_patched = false;
          target.__zh_patched_fp = '';
          // 容器身份变化时要重新扫描整个子树；仅翻译属性本身会漏掉此前
          // 因未命中白名单而尚未处理的 Settings 子节点。
          if (mutation.attributeName === 'class' || mutation.attributeName === 'id' ||
              mutation.attributeName === 'role' || mutation.attributeName === 'data-testid') {
            nodesToTranslate.push(target);
          } else {
            elementsToTranslate.push(target);
          }
        } else {
          const welcome = mutation.target.nodeType === Node.ELEMENT_NODE &&
            mutation.target.closest?.('[data-testid="coordinator-welcome"]');
          if (welcome) {
            welcome.__zh_patched = false;
            welcome.__zh_patched_fp = '';
            nodesToTranslate.push(welcome);
            continue;
          }
          const description = mutation.target.nodeType === Node.ELEMENT_NODE &&
            mutation.target.closest?.('[data-testid="menu-option-description"]');
          if (description?.closest?.('[data-mention-menu]')) {
            description.__zh_patched = false;
            description.__zh_patched_fp = '';
            nodesToTranslate.push(description);
            continue;
          }
          const officialSlot = mutation.target.nodeType === Node.ELEMENT_NODE ? getOfficialPluginDescSlotElement(mutation.target)?.el : null;
          if (officialSlot) {
            officialSlot.__zh_patched = false;
            officialSlot.__zh_patched_fp = '';
            nodesToTranslate.push(officialSlot);
          } else if (mutation.target.nodeType === Node.ELEMENT_NODE &&
              (projectDeletionParts(mutation.target) || automationManagedParts(mutation.target))) {
            mutation.target.__zh_patched = false;
            mutation.target.__zh_patched_fp = '';
            nodesToTranslate.push(mutation.target);
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList?.contains('settings-modal-backdrop') ||
                  node.matches?.('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]') ||
                  node.closest?.('.settings-modal-backdrop, [role="dialog"]')) {
                const sidebar = node.querySelector?.('[data-testid="settings-sidebar"]');
                if (sidebar) priorityNodesToTranslate.push(sidebar);
                priorityNodesToTranslate.push(node);
                continue;
              }
            }
            nodesToTranslate.push(node);
          }
        }
      }

      if (priorityNodesToTranslate.length > 0) {
        isTranslatingSync = true;
        try {
          for (const node of priorityNodesToTranslate) {
            if (node && node.isConnected !== false) translateNode(node);
          }
        } finally {
          isTranslatingSync = false;
        }
      }

      if (nodesToTranslate.length > 0 || elementsToTranslate.length > 0) {
        flushScheduler.schedule(nodesToTranslate, elementsToTranslate, []);
      }
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // 监听容器身份变化。Settings 页面经常先挂载空节点，再异步补 class/id。
      attributeFilter: ['aria-label', 'title', 'placeholder', 'alt', 'class', 'id', 'role', 'data-testid'],
    });
    mountToggleUI();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
