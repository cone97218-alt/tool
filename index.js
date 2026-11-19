// SillyTavern (TavernHelper / JS-Slash-Runner) 远程全局脚本
// 功能：在 Chat Completion 请求发出前，将上下文/预设打包塞入 tools[i].function.description
// 入口注入到酒馆「魔法棒菜单（#extensionsMenu）」，支持日间/夜间双主题一键切换

(() => {
  const VERSION = '1.3.0';
  const STORAGE_KEY = 'ctx2tool_settings_v1';

  const DEFAULT_CONFIG = {
    // 总开关：关闭后不拦截、不修改任何请求
    enabled: true,

    // 'all_with_placeholder' = 连最后一条也全部塞进工具描述（messages 留空消息或自定义占位）
    // 'all'                  = 除最后一条外全部塞进工具描述（最后一条留在 messages）
    // 'system_only'          = 只把 system 消息塞进工具描述，保留聊天记录
    mode: 'all_with_placeholder',

    // mode 为 'all_with_placeholder' 时填入 messages 的内容（支持留空 ""、空格或自定义文本）
    placeholderText: '',

    // 工具名称（只允许字母、数字、下划线）
    toolName: 'context_preset',

    // 是否禁止模型主动调用该工具（附加 tool_choice: 'none'）
    disableToolCall: false,

    // 是否记录日志（关闭后不记录、不输出日志）
    enableLog: true,

    // 是否弹出顶部 toastr 简短提示
    showToast: true,

    // 面板主题：'dark' | 'light'
    theme: 'dark',

    // 最多保留几条历史日志
    maxLogs: 20,
  };

  const ICON_SUN =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>';

  const ICON_MOON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  const parentWin = window.parent || window;
  const parentDoc = parentWin.document || document;
  const storage = parentWin.localStorage || localStorage;

  function loadConfig() {
    let saved = {};
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    return Object.assign({}, DEFAULT_CONFIG, globalThis.CTX2TOOL_CONFIG || {}, saved);
  }

  function saveConfig(cfg) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  let CONFIG = loadConfig();
  const logs = [];
  let activeTab = 'settings'; // 'settings' | 'logs'
  let injectTimer = null;

  // 防止重复注册监听器与重复创建 UI
  if (typeof globalThis.__ctx2toolCleanup === 'function') {
    try {
      globalThis.__ctx2toolCleanup();
    } catch (_) {}
  }

  function addLog(level, summary, detail = '') {
    if (!CONFIG.enableLog && level !== 'ERR') return;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift({ time, level, summary, detail });
    if (logs.length > CONFIG.maxLogs) logs.pop();

    console.log(`[ContextToTool v${VERSION}][${level}] ${summary}`, detail || '');
    renderLogList();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectStyles() {
    parentDoc.getElementById('ctx2tool-style')?.remove();
    const style = parentDoc.createElement('style');
    style.id = 'ctx2tool-style';
    style.textContent = `
      #ctx2tool-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(0, 0, 0, 0.52);
        backdrop-filter: blur(3px);
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
      }

      #ctx2tool-panel {
        --c2t-bg: #18191e;
        --c2t-surface: #22242c;
        --c2t-surface-hover: #2b2e38;
        --c2t-text: #f1f3f5;
        --c2t-muted: #9aa1ae;
        --c2t-border: rgba(255, 255, 255, 0.12);
        --c2t-accent: #3b82f6;
        --c2t-accent-text: #ffffff;
        --c2t-switch-off: #3a3e4c;
        --c2t-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
        --c2t-ok: #4ade80;
        --c2t-warn: #facc15;
        --c2t-err: #f87171;
        --c2t-link: #60a5fa;

        width: 100%;
        max-width: 440px;
        max-height: 82vh;
        background: var(--c2t-bg);
        color: var(--c2t-text);
        border: 1px solid var(--c2t-border);
        border-radius: 16px;
        padding: 16px;
        font-size: 13px;
        overflow-y: auto;
        box-shadow: var(--c2t-shadow);
        word-break: break-all;
        box-sizing: border-box;
        transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      }

      #ctx2tool-panel[data-theme="light"] {
        --c2t-bg: #ffffff;
        --c2t-surface: #f3f5f8;
        --c2t-surface-hover: #e7ebf2;
        --c2t-text: #1e293b;
        --c2t-muted: #64748b;
        --c2t-border: rgba(15, 23, 42, 0.12);
        --c2t-accent: #2563eb;
        --c2t-accent-text: #ffffff;
        --c2t-switch-off: #cbd5e1;
        --c2t-shadow: 0 12px 36px rgba(15, 23, 42, 0.18);
        --c2t-ok: #16a34a;
        --c2t-warn: #ca8a04;
        --c2t-err: #dc2626;
        --c2t-link: #2563eb;
      }

      #ctx2tool-panel .c2t-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--c2t-border);
      }

      #ctx2tool-panel .c2t-title {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #ctx2tool-panel .c2t-ver {
        font-size: 11px;
        color: var(--c2t-muted);
        background: var(--c2t-surface);
        padding: 2px 6px;
        border-radius: 999px;
      }

      #ctx2tool-panel .c2t-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #ctx2tool-panel .c2t-icon-btn {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid var(--c2t-border);
        background: var(--c2t-surface);
        color: var(--c2t-text);
        cursor: pointer;
        padding: 0;
        transition: background 0.15s ease, transform 0.1s ease;
      }

      #ctx2tool-panel .c2t-icon-btn:active {
        transform: scale(0.94);
      }

      #ctx2tool-panel .c2t-tabs {
        display: flex;
        gap: 6px;
        background: var(--c2t-surface);
        padding: 4px;
        border-radius: 10px;
        margin-bottom: 14px;
      }

      #ctx2tool-panel .c2t-tab-btn {
        flex: 1;
        padding: 7px 10px;
        font-size: 13px;
        font-weight: 500;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--c2t-muted);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }

      #ctx2tool-panel .c2t-tab-btn.active {
        background: var(--c2t-bg);
        color: var(--c2t-text);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      }

      #ctx2tool-panel .c2t-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        gap: 12px;
      }

      #ctx2tool-panel .c2t-field {
        margin-bottom: 12px;
      }

      #ctx2tool-panel .c2t-label {
        display: block;
        margin-bottom: 5px;
        color: var(--c2t-muted);
        font-size: 12px;
      }

      #ctx2tool-panel .c2t-input,
      #ctx2tool-panel .c2t-select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--c2t-surface);
        color: var(--c2t-text);
        border: 1px solid var(--c2t-border);
        font-size: 13px;
        outline: none;
      }

      #ctx2tool-panel .c2t-input:focus,
      #ctx2tool-panel .c2t-select:focus {
        border-color: var(--c2t-accent);
      }

      #ctx2tool-panel .c2t-switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 22px;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      #ctx2tool-panel .c2t-slider {
        position: absolute;
        inset: 0;
        cursor: pointer;
        background: var(--c2t-switch-off);
        border-radius: 999px;
        transition: background 0.2s ease;
      }

      #ctx2tool-panel .c2t-slider::before {
        content: "";
        position: absolute;
        width: 16px;
        height: 16px;
        left: 3px;
        top: 3px;
        background: #ffffff;
        border-radius: 50%;
        transition: transform 0.2s ease;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      }

      #ctx2tool-panel .c2t-switch input:checked + .c2t-slider {
        background: var(--c2t-accent);
      }

      #ctx2tool-panel .c2t-switch input:checked + .c2t-slider::before {
        transform: translateX(18px);
      }

      #ctx2tool-panel .c2t-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }

      #ctx2tool-panel .c2t-btn-primary {
        flex: 1;
        padding: 9px 12px;
        border-radius: 9px;
        border: none;
        background: var(--c2t-accent);
        color: var(--c2t-accent-text);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }

      #ctx2tool-panel .c2t-btn-secondary {
        padding: 9px 14px;
        border-radius: 9px;
        border: 1px solid var(--c2t-border);
        background: var(--c2t-surface);
        color: var(--c2t-text);
        font-size: 13px;
        cursor: pointer;
      }

      #ctx2tool-panel .c2t-log-item {
        padding: 8px 10px;
        margin-bottom: 8px;
        border-radius: 8px;
        background: var(--c2t-surface);
        border: 1px solid var(--c2t-border);
        font-size: 12px;
        line-height: 1.5;
      }

      #ctx2tool-panel .c2t-log-detail {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--c2t-border);
        color: var(--c2t-muted);
        white-space: pre-wrap;
      }

      #ctx2tool-panel .c2t-empty {
        text-align: center;
        color: var(--c2t-muted);
        padding: 24px 8px;
      }
    `;
    parentDoc.head.appendChild(style);
  }

  function applyTheme(theme) {
    const safeTheme = theme === 'light' ? 'light' : 'dark';
    CONFIG.theme = safeTheme;
    const panel = parentDoc.getElementById('ctx2tool-panel');
    const themeBtn = parentDoc.getElementById('ctx2tool-theme-toggle');
    if (panel) panel.setAttribute('data-theme', safeTheme);
    if (themeBtn) {
      themeBtn.innerHTML = safeTheme === 'dark' ? ICON_SUN : ICON_MOON;
    }
  }

  function updateWandLabel() {
    const label = parentDoc.getElementById('ctx2tool-wand-label');
    if (label) {
      label.textContent = CONFIG.enabled ? '上下文转工具 (开)' : '上下文转工具 (关)';
    }
  }

  function openPanel() {
    const backdrop = parentDoc.getElementById('ctx2tool-backdrop');
    if (!backdrop) return;
    syncSettingsUI();
    switchTab(activeTab);
    backdrop.style.display = 'flex';
  }

  function closePanel() {
    const backdrop = parentDoc.getElementById('ctx2tool-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  function renderLogList() {
    const listEl = parentDoc.getElementById('ctx2tool-log-list');
    if (!listEl) return;

    if (!CONFIG.enableLog && logs.length === 0) {
      listEl.innerHTML = '<div class="c2t-empty">日志记录已关闭（可在「配置面板」中开启）</div>';
      return;
    }

    if (logs.length === 0) {
      listEl.innerHTML = '<div class="c2t-empty">暂无日志，发送一条消息后会显示在这里</div>';
      return;
    }

    listEl.innerHTML = logs
      .map((item) => {
        const colorVar =
          item.level === 'ERR'
            ? 'var(--c2t-err)'
            : item.level === 'WARN'
              ? 'var(--c2t-warn)'
              : 'var(--c2t-ok)';
        const detailHtml = item.detail
          ? `<details style="margin-top:4px;"><summary style="color:var(--c2t-link);cursor:pointer;">展开详情</summary><div class="c2t-log-detail">${escapeHtml(item.detail)}</div></details>`
          : '';
        return `
          <div class="c2t-log-item">
            <div><span style="color:${colorVar};font-weight:600;">[${item.time} ${item.level}]</span> ${escapeHtml(item.summary)}</div>
            ${detailHtml}
          </div>
        `;
      })
      .join('');
  }

  function syncSettingsUI() {
    const enabledEl = parentDoc.getElementById('ctx2tool-cfg-enabled');
    const modeEl = parentDoc.getElementById('ctx2tool-cfg-mode');
    const placeholderWrap = parentDoc.getElementById('ctx2tool-placeholder-wrap');
    const placeholderEl = parentDoc.getElementById('ctx2tool-cfg-placeholder');
    const toolNameEl = parentDoc.getElementById('ctx2tool-cfg-toolname');
    const disableCallEl = parentDoc.getElementById('ctx2tool-cfg-disablecall');
    const enableLogEl = parentDoc.getElementById('ctx2tool-cfg-enablelog');
    const showToastEl = parentDoc.getElementById('ctx2tool-cfg-showtoast');

    if (!enabledEl) return;
    enabledEl.checked = !!CONFIG.enabled;
    modeEl.value = CONFIG.mode;
    placeholderEl.value = CONFIG.placeholderText;
    placeholderWrap.style.display = CONFIG.mode === 'all_with_placeholder' ? 'block' : 'none';
    toolNameEl.value = CONFIG.toolName;
    disableCallEl.checked = !!CONFIG.disableToolCall;
    enableLogEl.checked = !!CONFIG.enableLog;
    showToastEl.checked = !!CONFIG.showToast;
    applyTheme(CONFIG.theme);
    updateWandLabel();
  }

  function switchTab(tab) {
    activeTab = tab;
    const settingsBody = parentDoc.getElementById('ctx2tool-tab-settings');
    const logsBody = parentDoc.getElementById('ctx2tool-tab-logs');
    const btnSettings = parentDoc.getElementById('ctx2tool-tabbtn-settings');
    const btnLogs = parentDoc.getElementById('ctx2tool-tabbtn-logs');
    if (!settingsBody || !logsBody) return;

    const isSettings = tab === 'settings';
    settingsBody.style.display = isSettings ? 'block' : 'none';
    logsBody.style.display = isSettings ? 'none' : 'block';
    btnSettings.classList.toggle('active', isSettings);
    btnLogs.classList.toggle('active', !isSettings);

    if (!isSettings) renderLogList();
  }

  function injectWandMenuItem(retry = 0) {
    parentDoc.getElementById('ctx2tool-wand-item')?.remove();

    const menu = parentDoc.getElementById('extensionsMenu');
    if (!menu) {
      if (retry < 30) {
        injectTimer = setTimeout(() => injectWandMenuItem(retry + 1), 300);
      }
      return;
    }

    const item = parentDoc.createElement('div');
    item.id = 'ctx2tool-wand-item';
    item.className = 'list-group-item flex-container flexGap5';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div class="fa-solid fa-wrench extensionsMenuExtensionButton"></div>
      <span id="ctx2tool-wand-label"></span>
    `;

    item.onclick = (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      openPanel();
    };

    menu.appendChild(item);
    updateWandLabel();
  }

  function initUI() {
    parentDoc.getElementById('ctx2tool-float-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-panel')?.remove();
    parentDoc.getElementById('ctx2tool-backdrop')?.remove();
    parentDoc.getElementById('ctx2tool-panel')?.remove();

    injectStyles();

    const backdrop = parentDoc.createElement('div');
    backdrop.id = 'ctx2tool-backdrop';
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closePanel();
    };

    const panel = parentDoc.createElement('div');
    panel.id = 'ctx2tool-panel';
    panel.setAttribute('data-theme', CONFIG.theme === 'light' ? 'light' : 'dark');

    panel.innerHTML = `
      <div class="c2t-header">
        <div class="c2t-title">
          <span>ContextToTool</span>
          <span class="c2t-ver">v${VERSION}</span>
        </div>
        <div class="c2t-header-actions">
          <button id="ctx2tool-theme-toggle" class="c2t-icon-btn" type="button"></button>
          <button id="ctx2tool-close" class="c2t-icon-btn" type="button">${ICON_CLOSE}</button>
        </div>
      </div>

      <div class="c2t-tabs">
        <button id="ctx2tool-tabbtn-settings" class="c2t-tab-btn" type="button">配置面板</button>
        <button id="ctx2tool-tabbtn-logs" class="c2t-tab-btn" type="button">运行日志</button>
      </div>

      <div id="ctx2tool-tab-settings">
        <div class="c2t-row">
          <span>启用上下文转工具描述</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-enabled" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-field" style="margin-top:8px;">
          <label class="c2t-label" for="ctx2tool-cfg-mode">打包模式</label>
          <select id="ctx2tool-cfg-mode" class="c2t-select">
            <option value="all_with_placeholder">all_with_placeholder（全部打包 + 留底消息）</option>
            <option value="all">all（除最后一条外全部打包）</option>
            <option value="system_only">system_only（仅打包 system，保留聊天记录）</option>
          </select>
        </div>

        <div id="ctx2tool-placeholder-wrap" class="c2t-field">
          <label class="c2t-label" for="ctx2tool-cfg-placeholder">messages 留底内容（留空即空消息，或填引导词）</label>
          <input id="ctx2tool-cfg-placeholder" class="c2t-input" type="text" placeholder="留空即空消息 &quot;&quot;，或填如：请使用工具" />
        </div>

        <div class="c2t-field">
          <label class="c2t-label" for="ctx2tool-cfg-toolname">工具名称（仅字母/数字/下划线）</label>
          <input id="ctx2tool-cfg-toolname" class="c2t-input" type="text" />
        </div>

        <div class="c2t-row">
          <span>附加 tool_choice: none（禁调用）</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-disablecall" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-row">
          <span>开启日志记录</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-enablelog" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-row">
          <span>开启顶部弹窗提示（Toast）</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-showtoast" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-actions">
          <button id="ctx2tool-save" class="c2t-btn-primary" type="button">保存配置</button>
          <button id="ctx2tool-reset" class="c2t-btn-secondary" type="button">恢复默认</button>
        </div>
      </div>

      <div id="ctx2tool-tab-logs" style="display:none;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button id="ctx2tool-clear-logs" class="c2t-btn-secondary" style="padding:5px 10px;font-size:12px;" type="button">清空日志</button>
        </div>
        <div id="ctx2tool-log-list"></div>
      </div>
    `;

    backdrop.appendChild(panel);
    parentDoc.body.appendChild(backdrop);

    parentDoc.getElementById('ctx2tool-close').onclick = closePanel;
    parentDoc.getElementById('ctx2tool-theme-toggle').onclick = () => {
      const nextTheme = CONFIG.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      saveConfig(CONFIG);
    };

    parentDoc.getElementById('ctx2tool-tabbtn-settings').onclick = () => switchTab('settings');
    parentDoc.getElementById('ctx2tool-tabbtn-logs').onclick = () => switchTab('logs');
    parentDoc.getElementById('ctx2tool-clear-logs').onclick = () => {
      logs.length = 0;
      renderLogList();
    };

    parentDoc.getElementById('ctx2tool-cfg-mode').onchange = (e) => {
      const wrap = parentDoc.getElementById('ctx2tool-placeholder-wrap');
      if (wrap) wrap.style.display = e.target.value === 'all_with_placeholder' ? 'block' : 'none';
    };

    parentDoc.getElementById('ctx2tool-save').onclick = () => {
      const rawName = (parentDoc.getElementById('ctx2tool-cfg-toolname').value || '').trim();
      const safeToolName = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_CONFIG.toolName;
      const rawPlaceholder = parentDoc.getElementById('ctx2tool-cfg-placeholder').value;

      CONFIG = Object.assign({}, CONFIG, {
        enabled: parentDoc.getElementById('ctx2tool-cfg-enabled').checked,
        mode: parentDoc.getElementById('ctx2tool-cfg-mode').value,
        placeholderText: rawPlaceholder,
        toolName: safeToolName,
        disableToolCall: parentDoc.getElementById('ctx2tool-cfg-disablecall').checked,
        enableLog: parentDoc.getElementById('ctx2tool-cfg-enablelog').checked,
        showToast: parentDoc.getElementById('ctx2tool-cfg-showtoast').checked,
      });

      saveConfig(CONFIG);
      syncSettingsUI();
      addLog(
        'OK',
        `配置已保存（启用:${CONFIG.enabled ? '是' : '否'} | 模式:${CONFIG.mode} | 日志:${CONFIG.enableLog ? '开' : '关'}）`,
      );
      if (typeof toastr !== 'undefined') {
        toastr.success('配置已保存并生效', `ContextToTool v${VERSION}`);
      }
    };

    parentDoc.getElementById('ctx2tool-reset').onclick = () => {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (_) {}
      CONFIG = Object.assign({}, DEFAULT_CONFIG);
      syncSettingsUI();
      addLog('OK', '已恢复默认配置');
      if (typeof toastr !== 'undefined') {
        toastr.info('已恢复默认配置', `ContextToTool v${VERSION}`);
      }
    };

    injectWandMenuItem();
    syncSettingsUI();
    switchTab('settings');
  }

  const handler = (data) => {
    if (!CONFIG.enabled) return;

    try {
      if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
        addLog('WARN', '跳过：messages 为空');
        return;
      }

      let toPack = [];
      let remaining = [];

      if (CONFIG.mode === 'system_only') {
        for (const msg of data.messages) {
          if (msg.role === 'system') {
            toPack.push(msg);
          } else {
            remaining.push(msg);
          }
        }
        if (remaining.length === 0) {
          remaining.push(toPack.pop());
        }
      } else if (CONFIG.mode === 'all_with_placeholder') {
        toPack = [...data.messages];
        remaining = [{ role: 'user', content: CONFIG.placeholderText }];
      } else {
        if (data.messages.length <= 1) {
          addLog('WARN', '跳过：messages 只有 1 条，未打包');
          return;
        }
        toPack = data.messages.slice(0, -1);
        remaining = [data.messages[data.messages.length - 1]];
      }

      if (toPack.length === 0) {
        addLog('WARN', '跳过：没有匹配到需要打包的消息');
        return;
      }

      const packedText = toPack
        .map((m) => {
          const content =
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content
                    .map((p) => (typeof p === 'string' ? p : p.text ?? JSON.stringify(p)))
                    .join('\n')
                : JSON.stringify(m.content);
          return `[${m.role}]\n${content}`;
        })
        .join('\n\n');

      const injectedTool = {
        type: 'function',
        function: {
          name: CONFIG.toolName,
          description: packedText,
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      };

      const existingTools = Array.isArray(data.tools)
        ? data.tools.filter((t) => t?.function?.name !== CONFIG.toolName)
        : [];

      data.tools = [...existingTools, injectedTool];
      data.messages = remaining;

      if (CONFIG.disableToolCall) {
        data.tool_choice = 'none';
      }

      const summary = `打包 ${toPack.length} 条 → 工具描述（${packedText.length} 字），messages 剩 ${remaining.length} 条`;
      const previewHead = packedText.slice(0, 300);
      const previewTail = packedText.length > 600 ? `\n...\n${packedText.slice(-300)}` : '';
      const detail =
        `版本: v${VERSION} | 模式: ${CONFIG.mode}\n` +
        `API来源: ${data.chat_completion_source ?? '未知'}\n` +
        `工具名: ${CONFIG.toolName} | 工具数: ${data.tools.length} | tool_choice: ${data.tool_choice ?? '未设置'}\n` +
        `保留的 messages:\n${JSON.stringify(remaining, null, 2)}\n\n` +
        `description 预览:\n${previewHead}${previewTail}`;

      addLog('OK', summary, detail);
      if (CONFIG.showToast && typeof toastr !== 'undefined') {
        toastr.info(summary, `ContextToTool v${VERSION}`);
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      addLog('ERR', `执行出错: ${errMsg}`, err?.stack || '');
      if (typeof toastr !== 'undefined') {
        toastr.error(errMsg, `ContextToTool v${VERSION} 出错`);
      }
    }
  };

  initUI();
  eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);

  globalThis.__ctx2toolCleanup = () => {
    if (injectTimer) clearTimeout(injectTimer);
    if (typeof eventRemoveListener === 'function') {
      eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);
    }
    parentDoc.getElementById('ctx2tool-style')?.remove();
    parentDoc.getElementById('ctx2tool-wand-item')?.remove();
    parentDoc.getElementById('ctx2tool-float-btn')?.remove();
    parentDoc.getElementById('ctx2tool-backdrop')?.remove();
    parentDoc.getElementById('ctx2tool-panel')?.remove();
  };

  addLog('OK', `v${VERSION} 已加载（模式: ${CONFIG.mode}）`);
  if (CONFIG.showToast && typeof toastr !== 'undefined') {
    toastr.success(`v${VERSION} 已加载（点击魔法棒菜单打开配置）`, 'ContextToTool');
  }
})();
