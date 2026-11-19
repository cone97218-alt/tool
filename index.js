// SillyTavern (TavernHelper / JS-Slash-Runner) 远程全局脚本
// 功能：在 Chat Completion 请求发出前，将上下文/预设打包塞入 tools[i].function.description
// 入口注入魔法棒菜单（#extensionsMenu），可选注入 QR 栏快捷日志按钮（#qr--bar）

(() => {
  const VERSION = '1.5.0';
  const STORAGE_KEY = 'ctx2tool_settings_v1';
  const MAX_PROMPT_LOGS = 5;

  const DEFAULT_CONFIG = {
    enabled: true,
    mode: 'all_with_placeholder', // 'all_with_placeholder' | 'all' | 'all_copy_last' | 'system_only'
    placeholderRole: 'user', // 'user' | 'system' | 'assistant'
    placeholderText: '',
    toolName: 'context_preset',
    disableToolCall: false,
    enableLog: true,
    showQrLogBtn: false,
    showToast: true,
    theme: 'dark', // 'dark' | 'light'
  };

  const ICON_SUN =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>';

  const ICON_MOON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>';

  const ICON_INFO =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

  const ICON_LOG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line></svg>';

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
  const promptLogs = []; // 仅保留最近 5 条完整提示词记录
  let activeTab = 'settings'; // 'settings' | 'logs'
  let selectedLogIdx = 0;
  let showMetaBox = false;
  let wandTimer = null;
  let qrTimer = null;
  let qrObserver = null;

  if (typeof globalThis.__ctx2toolCleanup === 'function') {
    try {
      globalThis.__ctx2toolCleanup();
    } catch (_) {}
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addPromptLog(entry) {
    if (!CONFIG.enableLog && entry.level !== 'ERR') return;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    promptLogs.unshift({ time, ...entry });
    if (promptLogs.length > MAX_PROMPT_LOGS) promptLogs.pop();
    selectedLogIdx = 0;

    console.log(`[ContextToTool v${VERSION}][${entry.level}] ${entry.summary}`);
    renderLogView();
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
        padding: 10px;
        box-sizing: border-box;
      }

      #ctx2tool-panel {
        --c2t-bg: #16171c;
        --c2t-surface: #21232b;
        --c2t-text: #eef0f4;
        --c2t-muted: #8f96a3;
        --c2t-border: rgba(255, 255, 255, 0.11);
        --c2t-accent: #3b82f6;
        --c2t-accent-text: #ffffff;
        --c2t-switch-off: #393d4a;
        --c2t-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
        --c2t-err: #f87171;

        width: 100%;
        max-width: 440px;
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        background: var(--c2t-bg);
        color: var(--c2t-text);
        border: 1px solid var(--c2t-border);
        border-radius: 14px;
        padding: 12px;
        font-size: 13px;
        box-shadow: var(--c2t-shadow);
        box-sizing: border-box;
        transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      }

      #ctx2tool-panel.logs-mode {
        max-width: 600px;
        height: 88vh;
        max-height: 88vh;
      }

      #ctx2tool-panel[data-theme="light"] {
        --c2t-bg: #ffffff;
        --c2t-surface: #f2f4f7;
        --c2t-text: #1e293b;
        --c2t-muted: #64748b;
        --c2t-border: rgba(15, 23, 42, 0.11);
        --c2t-accent: #2563eb;
        --c2t-accent-text: #ffffff;
        --c2t-switch-off: #cbd5e1;
        --c2t-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
        --c2t-err: #dc2626;
      }

      #ctx2tool-panel .c2t-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-title {
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #ctx2tool-panel .c2t-ver {
        font-size: 11px;
        color: var(--c2t-muted);
        background: var(--c2t-surface);
        padding: 1px 6px;
        border-radius: 999px;
      }

      #ctx2tool-panel .c2t-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      #ctx2tool-panel .c2t-icon-btn {
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid var(--c2t-border);
        background: var(--c2t-surface);
        color: var(--c2t-text);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-icon-btn.active {
        border-color: var(--c2t-accent);
        color: var(--c2t-accent);
      }

      #ctx2tool-panel .c2t-icon-btn:active {
        transform: scale(0.94);
      }

      #ctx2tool-panel .c2t-tabs {
        display: flex;
        gap: 4px;
        background: var(--c2t-surface);
        padding: 3px;
        border-radius: 9px;
        margin-bottom: 10px;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-tab-btn {
        flex: 1;
        padding: 6px 8px;
        font-size: 13px;
        font-weight: 500;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--c2t-muted);
        cursor: pointer;
      }

      #ctx2tool-panel .c2t-tab-btn.active {
        background: var(--c2t-bg);
        color: var(--c2t-text);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }

      #ctx2tool-tab-settings {
        overflow-y: auto;
        min-height: 0;
      }

      #ctx2tool-panel .c2t-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 7px 0;
        gap: 12px;
      }

      #ctx2tool-panel .c2t-field {
        margin-bottom: 10px;
      }

      #ctx2tool-panel .c2t-label {
        display: block;
        margin-bottom: 4px;
        color: var(--c2t-muted);
        font-size: 12px;
      }

      #ctx2tool-panel .c2t-input,
      #ctx2tool-panel .c2t-select {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px;
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
        width: 38px;
        height: 20px;
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
        width: 14px;
        height: 14px;
        left: 3px;
        top: 3px;
        background: #ffffff;
        border-radius: 50%;
        transition: transform 0.2s ease;
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
        margin-top: 12px;
      }

      #ctx2tool-panel .c2t-btn-primary {
        flex: 1;
        padding: 8px 12px;
        border-radius: 8px;
        border: none;
        background: var(--c2t-accent);
        color: var(--c2t-accent-text);
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }

      #ctx2tool-panel .c2t-btn-secondary {
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid var(--c2t-border);
        background: var(--c2t-surface);
        color: var(--c2t-text);
        font-size: 13px;
        cursor: pointer;
      }

      #ctx2tool-tab-logs {
        display: none;
        flex: 1;
        min-height: 0;
        flex-direction: column;
        gap: 8px;
      }

      #ctx2tool-panel .c2t-log-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-log-pills {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      #ctx2tool-panel .c2t-pill {
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        border-radius: 7px;
        border: 1px solid var(--c2t-border);
        background: var(--c2t-surface);
        color: var(--c2t-muted);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      #ctx2tool-panel .c2t-pill.active {
        background: var(--c2t-accent);
        border-color: var(--c2t-accent);
        color: var(--c2t-accent-text);
      }

      #ctx2tool-panel .c2t-log-tools {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      #ctx2tool-panel .c2t-meta-box {
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--c2t-surface);
        border: 1px solid var(--c2t-border);
        color: var(--c2t-muted);
        font-size: 11px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 24vh;
        overflow-y: auto;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-reader {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--c2t-surface);
        border: 1px solid var(--c2t-border);
        color: var(--c2t-text);
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
      }

      #ctx2tool-panel .c2t-log-foot {
        font-size: 11px;
        color: var(--c2t-muted);
        display: flex;
        justify-content: space-between;
        flex-shrink: 0;
      }

      #ctx2tool-panel .c2t-empty {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--c2t-muted);
        font-size: 13px;
      }

      #ctx2tool-qr-log-btn {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        padding: 4px 7px;
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
    if (themeBtn) themeBtn.innerHTML = safeTheme === 'dark' ? ICON_SUN : ICON_MOON;
  }

  function updateWandLabel() {
    const label = parentDoc.getElementById('ctx2tool-wand-label');
    if (label) {
      label.textContent = CONFIG.enabled ? '上下文转工具 (开)' : '上下文转工具 (关)';
    }
  }

  function removeQrLogBtn() {
    if (qrTimer) {
      clearTimeout(qrTimer);
      qrTimer = null;
    }
    if (qrObserver) {
      qrObserver.disconnect();
      qrObserver = null;
    }
    parentDoc.getElementById('ctx2tool-qr-log-btn')?.remove();
  }

  function mountQrLogBtn(retry = 0) {
    if (!CONFIG.showQrLogBtn) {
      removeQrLogBtn();
      return;
    }

    const qrBar = parentDoc.getElementById('qr--bar');
    if (!qrBar) {
      if (retry < 30) {
        qrTimer = setTimeout(() => mountQrLogBtn(retry + 1), 400);
      }
      return;
    }

    const container = qrBar.querySelector('.qr--buttons') || qrBar;
    if (!parentDoc.getElementById('ctx2tool-qr-log-btn')) {
      const btn = parentDoc.createElement('div');
      btn.id = 'ctx2tool-qr-log-btn';
      btn.className = 'qr--button menu_button interactable';
      btn.innerHTML = ICON_LOG;
      btn.onclick = (e) => {
        e.stopPropagation();
        openPanel('logs');
      };
      container.appendChild(btn);
    }

    if (!qrObserver) {
      qrObserver = new MutationObserver(() => {
        if (CONFIG.showQrLogBtn && !parentDoc.getElementById('ctx2tool-qr-log-btn')) {
          mountQrLogBtn(0);
        }
      });
      qrObserver.observe(qrBar, { childList: true, subtree: true });
    }
  }

  function syncQrLogBtn() {
    if (CONFIG.showQrLogBtn) {
      mountQrLogBtn(0);
    } else {
      removeQrLogBtn();
    }
  }

  function openPanel(tab) {
    const backdrop = parentDoc.getElementById('ctx2tool-backdrop');
    if (!backdrop) return;
    syncSettingsUI();
    switchTab(tab || activeTab);
    backdrop.style.display = 'flex';
  }

  function closePanel() {
    const backdrop = parentDoc.getElementById('ctx2tool-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  function renderLogView() {
    const pillsEl = parentDoc.getElementById('ctx2tool-log-pills');
    const metaEl = parentDoc.getElementById('ctx2tool-meta-box');
    const readerEl = parentDoc.getElementById('ctx2tool-reader');
    const footEl = parentDoc.getElementById('ctx2tool-log-foot');
    const infoBtn = parentDoc.getElementById('ctx2tool-info-btn');
    if (!pillsEl || !readerEl || !metaEl || !footEl) return;

    if (selectedLogIdx >= promptLogs.length) selectedLogIdx = 0;

    pillsEl.innerHTML = promptLogs
      .map(
        (_, i) =>
          `<button type="button" class="c2t-pill ${i === selectedLogIdx ? 'active' : ''}" data-log-idx="${i}">${i + 1}</button>`,
      )
      .join('');

    pillsEl.querySelectorAll('.c2t-pill').forEach((btn) => {
      btn.onclick = () => {
        selectedLogIdx = Number(btn.getAttribute('data-log-idx'));
        renderLogView();
      };
    });

    if (infoBtn) infoBtn.classList.toggle('active', showMetaBox);

    if (promptLogs.length === 0) {
      metaEl.style.display = 'none';
      readerEl.className = 'c2t-empty';
      readerEl.textContent = CONFIG.enableLog ? '暂无记录' : '日志已关闭';
      footEl.innerHTML = '';
      return;
    }

    const cur = promptLogs[selectedLogIdx];
    metaEl.style.display = showMetaBox && cur.meta ? 'block' : 'none';
    if (cur.meta) metaEl.textContent = cur.meta;

    readerEl.className = 'c2t-reader';
    readerEl.textContent = cur.fullPrompt || cur.summary;
    if (cur.level === 'ERR') {
      readerEl.style.color = 'var(--c2t-err)';
    } else {
      readerEl.style.color = '';
    }

    footEl.innerHTML = `<span>${escapeHtml(cur.time)} · ${escapeHtml(cur.summary)}</span><span>${selectedLogIdx + 1}/${promptLogs.length}</span>`;
  }

  function syncSettingsUI() {
    const enabledEl = parentDoc.getElementById('ctx2tool-cfg-enabled');
    const modeEl = parentDoc.getElementById('ctx2tool-cfg-mode');
    const placeholderWrap = parentDoc.getElementById('ctx2tool-placeholder-wrap');
    const placeholderRoleEl = parentDoc.getElementById('ctx2tool-cfg-placeholder-role');
    const placeholderEl = parentDoc.getElementById('ctx2tool-cfg-placeholder');
    const toolNameEl = parentDoc.getElementById('ctx2tool-cfg-toolname');
    const disableCallEl = parentDoc.getElementById('ctx2tool-cfg-disablecall');
    const enableLogEl = parentDoc.getElementById('ctx2tool-cfg-enablelog');
    const showQrEl = parentDoc.getElementById('ctx2tool-cfg-showqr');
    const showToastEl = parentDoc.getElementById('ctx2tool-cfg-showtoast');

    if (!enabledEl) return;
    enabledEl.checked = !!CONFIG.enabled;
    modeEl.value = CONFIG.mode;
    placeholderRoleEl.value = CONFIG.placeholderRole || 'user';
    placeholderEl.value = CONFIG.placeholderText;
    placeholderWrap.style.display = CONFIG.mode === 'all_with_placeholder' ? 'block' : 'none';
    toolNameEl.value = CONFIG.toolName;
    disableCallEl.checked = !!CONFIG.disableToolCall;
    enableLogEl.checked = !!CONFIG.enableLog;
    showQrEl.checked = !!CONFIG.showQrLogBtn;
    showToastEl.checked = !!CONFIG.showToast;
    applyTheme(CONFIG.theme);
    updateWandLabel();
  }

  function switchTab(tab) {
    activeTab = tab;
    const panel = parentDoc.getElementById('ctx2tool-panel');
    const settingsBody = parentDoc.getElementById('ctx2tool-tab-settings');
    const logsBody = parentDoc.getElementById('ctx2tool-tab-logs');
    const btnSettings = parentDoc.getElementById('ctx2tool-tabbtn-settings');
    const btnLogs = parentDoc.getElementById('ctx2tool-tabbtn-logs');
    if (!settingsBody || !logsBody || !panel) return;

    const isSettings = tab === 'settings';
    panel.classList.toggle('logs-mode', !isSettings);
    settingsBody.style.display = isSettings ? 'block' : 'none';
    logsBody.style.display = isSettings ? 'none' : 'flex';
    btnSettings.classList.toggle('active', isSettings);
    btnLogs.classList.toggle('active', !isSettings);

    if (!isSettings) renderLogView();
  }

  function injectWandMenuItem(retry = 0) {
    parentDoc.getElementById('ctx2tool-wand-item')?.remove();

    const menu = parentDoc.getElementById('extensionsMenu');
    if (!menu) {
      if (retry < 30) {
        wandTimer = setTimeout(() => injectWandMenuItem(retry + 1), 300);
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
      openPanel('settings');
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
        <button id="ctx2tool-tabbtn-settings" class="c2t-tab-btn" type="button">配置</button>
        <button id="ctx2tool-tabbtn-logs" class="c2t-tab-btn" type="button">日志</button>
      </div>

      <div id="ctx2tool-tab-settings">
        <div class="c2t-row">
          <span>启用</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-enabled" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-field" style="margin-top:6px;">
          <label class="c2t-label" for="ctx2tool-cfg-mode">打包模式</label>
          <select id="ctx2tool-cfg-mode" class="c2t-select">
            <option value="all_with_placeholder">全部打包 + 自定义留底</option>
            <option value="all">保留原最后一条（身份跟随预设）</option>
            <option value="all_copy_last">全部打包 + 原最后一条留底</option>
            <option value="system_only">仅打包 system</option>
          </select>
        </div>

        <div id="ctx2tool-placeholder-wrap">
          <div class="c2t-field">
            <label class="c2t-label" for="ctx2tool-cfg-placeholder-role">留底身份</label>
            <select id="ctx2tool-cfg-placeholder-role" class="c2t-select">
              <option value="user">user</option>
              <option value="system">system</option>
              <option value="assistant">assistant</option>
            </select>
          </div>

          <div class="c2t-field">
            <label class="c2t-label" for="ctx2tool-cfg-placeholder">留底内容</label>
            <input id="ctx2tool-cfg-placeholder" class="c2t-input" type="text" placeholder="留空即空消息" />
          </div>
        </div>

        <div class="c2t-field">
          <label class="c2t-label" for="ctx2tool-cfg-toolname">工具名称</label>
          <input id="ctx2tool-cfg-toolname" class="c2t-input" type="text" />
        </div>

        <div class="c2t-row">
          <span>tool_choice: none</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-disablecall" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-row">
          <span>记录日志</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-enablelog" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-row">
          <span>QR 栏快捷日志</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-showqr" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-row">
          <span>顶部弹窗</span>
          <label class="c2t-switch">
            <input id="ctx2tool-cfg-showtoast" type="checkbox" />
            <span class="c2t-slider"></span>
          </label>
        </div>

        <div class="c2t-actions">
          <button id="ctx2tool-save" class="c2t-btn-primary" type="button">保存</button>
          <button id="ctx2tool-reset" class="c2t-btn-secondary" type="button">重置</button>
        </div>
      </div>

      <div id="ctx2tool-tab-logs">
        <div class="c2t-log-bar">
          <div id="ctx2tool-log-pills" class="c2t-log-pills"></div>
          <div class="c2t-log-tools">
            <button id="ctx2tool-info-btn" class="c2t-icon-btn" type="button">${ICON_INFO}</button>
            <button id="ctx2tool-copy-btn" class="c2t-icon-btn" type="button">${ICON_COPY}</button>
            <button id="ctx2tool-clear-logs" class="c2t-icon-btn" type="button">${ICON_TRASH}</button>
          </div>
        </div>
        <div id="ctx2tool-meta-box" class="c2t-meta-box" style="display:none;"></div>
        <div id="ctx2tool-reader" class="c2t-empty"></div>
        <div id="ctx2tool-log-foot" class="c2t-log-foot"></div>
      </div>
    `;

    backdrop.appendChild(panel);
    parentDoc.body.appendChild(backdrop);

    parentDoc.getElementById('ctx2tool-close').onclick = closePanel;
    parentDoc.getElementById('ctx2tool-theme-toggle').onclick = () => {
      applyTheme(CONFIG.theme === 'dark' ? 'light' : 'dark');
      saveConfig(CONFIG);
    };

    parentDoc.getElementById('ctx2tool-tabbtn-settings').onclick = () => switchTab('settings');
    parentDoc.getElementById('ctx2tool-tabbtn-logs').onclick = () => switchTab('logs');

    parentDoc.getElementById('ctx2tool-info-btn').onclick = () => {
      showMetaBox = !showMetaBox;
      renderLogView();
    };

    parentDoc.getElementById('ctx2tool-copy-btn').onclick = async () => {
      const cur = promptLogs[selectedLogIdx];
      const text = cur?.fullPrompt || cur?.summary;
      if (!text) return;
      try {
        await (parentWin.navigator?.clipboard || navigator.clipboard).writeText(text);
        if (typeof toastr !== 'undefined') toastr.success('已复制', `ContextToTool v${VERSION}`);
      } catch (_) {
        const ta = parentDoc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        parentDoc.body.appendChild(ta);
        ta.select();
        parentDoc.execCommand('copy');
        ta.remove();
        if (typeof toastr !== 'undefined') toastr.success('已复制', `ContextToTool v${VERSION}`);
      }
    };

    parentDoc.getElementById('ctx2tool-clear-logs').onclick = () => {
      promptLogs.length = 0;
      selectedLogIdx = 0;
      renderLogView();
    };

    parentDoc.getElementById('ctx2tool-cfg-mode').onchange = (e) => {
      const wrap = parentDoc.getElementById('ctx2tool-placeholder-wrap');
      if (wrap) wrap.style.display = e.target.value === 'all_with_placeholder' ? 'block' : 'none';
    };

    // QR 栏开关实时生效并保存
    parentDoc.getElementById('ctx2tool-cfg-showqr').onchange = (e) => {
      CONFIG.showQrLogBtn = e.target.checked;
      saveConfig(CONFIG);
      syncQrLogBtn();
    };

    parentDoc.getElementById('ctx2tool-save').onclick = () => {
      const rawName = (parentDoc.getElementById('ctx2tool-cfg-toolname').value || '').trim();
      const safeToolName = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_CONFIG.toolName;
      const rawPlaceholder = parentDoc.getElementById('ctx2tool-cfg-placeholder').value;

      CONFIG = Object.assign({}, CONFIG, {
        enabled: parentDoc.getElementById('ctx2tool-cfg-enabled').checked,
        mode: parentDoc.getElementById('ctx2tool-cfg-mode').value,
        placeholderRole: parentDoc.getElementById('ctx2tool-cfg-placeholder-role').value || 'user',
        placeholderText: rawPlaceholder,
        toolName: safeToolName,
        disableToolCall: parentDoc.getElementById('ctx2tool-cfg-disablecall').checked,
        enableLog: parentDoc.getElementById('ctx2tool-cfg-enablelog').checked,
        showQrLogBtn: parentDoc.getElementById('ctx2tool-cfg-showqr').checked,
        showToast: parentDoc.getElementById('ctx2tool-cfg-showtoast').checked,
      });

      saveConfig(CONFIG);
      syncSettingsUI();
      syncQrLogBtn();
      if (typeof toastr !== 'undefined') {
        toastr.success('已保存', `ContextToTool v${VERSION}`);
      }
    };

    parentDoc.getElementById('ctx2tool-reset').onclick = () => {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (_) {}
      CONFIG = Object.assign({}, DEFAULT_CONFIG);
      syncSettingsUI();
      syncQrLogBtn();
      if (typeof toastr !== 'undefined') {
        toastr.info('已重置', `ContextToTool v${VERSION}`);
      }
    };

    injectWandMenuItem();
    syncSettingsUI();
    syncQrLogBtn();
    switchTab('settings');
  }

  const handler = (data) => {
    if (!CONFIG.enabled) return;

    try {
      if (!data || !Array.isArray(data.messages) || data.messages.length === 0) return;

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
        remaining = [{ role: CONFIG.placeholderRole || 'user', content: CONFIG.placeholderText }];
      } else if (CONFIG.mode === 'all_copy_last') {
        toPack = [...data.messages];
        remaining = [data.messages[data.messages.length - 1]];
      } else {
        if (data.messages.length <= 1) return;
        toPack = data.messages.slice(0, -1);
        remaining = [data.messages[data.messages.length - 1]];
      }

      if (toPack.length === 0) return;

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

      const summary = `${toPack.length} 条 · ${packedText.length} 字`;
      const meta =
        `模式: ${CONFIG.mode} | 来源: ${data.chat_completion_source ?? '未知'}\n` +
        `工具: ${CONFIG.toolName} (${data.tools.length}) | tool_choice: ${data.tool_choice ?? '未设置'}\n` +
        `messages:\n${JSON.stringify(remaining, null, 2)}`;

      addPromptLog({ level: 'OK', summary, meta, fullPrompt: packedText });

      if (CONFIG.showToast && typeof toastr !== 'undefined') {
        toastr.info(summary, `ContextToTool v${VERSION}`);
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      addPromptLog({
        level: 'ERR',
        summary: `出错: ${errMsg}`,
        meta: err?.stack || '',
        fullPrompt: err?.stack || errMsg,
      });
      if (typeof toastr !== 'undefined') {
        toastr.error(errMsg, `ContextToTool v${VERSION}`);
      }
    }
  };

  initUI();
  eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);

  globalThis.__ctx2toolCleanup = () => {
    if (wandTimer) clearTimeout(wandTimer);
    removeQrLogBtn();
    if (typeof eventRemoveListener === 'function') {
      eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);
    }
    parentDoc.getElementById('ctx2tool-style')?.remove();
    parentDoc.getElementById('ctx2tool-wand-item')?.remove();
    parentDoc.getElementById('ctx2tool-float-btn')?.remove();
    parentDoc.getElementById('ctx2tool-backdrop')?.remove();
    parentDoc.getElementById('ctx2tool-panel')?.remove();
  };

  if (CONFIG.showToast && typeof toastr !== 'undefined') {
    toastr.success(`v${VERSION}`, 'ContextToTool');
  }
})();
