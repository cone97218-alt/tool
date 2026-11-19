// SillyTavern (TavernHelper / JS-Slash-Runner) 远程全局脚本
// 功能：在 Chat Completion 请求发出前，将上下文/预设打包塞入 tools[i].function.description
// 入口注入到酒馆「魔法棒菜单（#extensionsMenu）」，不常态占用屏幕

(() => {
  const VERSION = '1.2.1';
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

    // 最多保留几条历史日志
    maxLogs: 20,
  };

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

  function updateWandLabel() {
    const label = parentDoc.getElementById('ctx2tool-wand-label');
    if (label) {
      label.textContent = CONFIG.enabled ? '上下文转工具 (开)' : '上下文转工具 (关)';
    }
  }

  function openPanel() {
    const backdrop = parentDoc.getElementById('ctx2tool-backdrop');
    const panel = parentDoc.getElementById('ctx2tool-panel');
    if (!backdrop || !panel) return;
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
      listEl.textContent = '日志记录已关闭（可在「配置面板」中开启）。';
      return;
    }

    if (logs.length === 0) {
      listEl.textContent = '暂无日志，发送一条消息后会显示在这里。';
      return;
    }

    listEl.innerHTML = logs
      .map((item) => {
        const color =
          item.level === 'ERR' ? '#ff6b6b' : item.level === 'WARN' ? '#ffd166' : '#7ae582';
        const detailHtml = item.detail
          ? `<details style="margin-top:4px;"><summary style="color:#9ec5fe;cursor:pointer;">展开详情</summary><div style="margin-top:4px;color:#ccc;white-space:pre-wrap;">${escapeHtml(item.detail)}</div></details>`
          : '';
        return `
          <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed rgba(255,255,255,0.12);">
            <div><span style="color:${color};font-weight:bold;">[${item.time} ${item.level}]</span> ${escapeHtml(item.summary)}</div>
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
    btnSettings.style.background = isSettings ? 'rgba(158,197,254,0.25)' : 'transparent';
    btnLogs.style.background = !isSettings ? 'rgba(158,197,254,0.25)' : 'transparent';

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
      // 点击后自动收起魔法棒菜单
      menu.style.display = 'none';
      openPanel();
    };

    menu.appendChild(item);
    updateWandLabel();
  }

  function initUI() {
    // 清理旧版悬浮按钮与面板
    parentDoc.getElementById('ctx2tool-float-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-panel')?.remove();
    parentDoc.getElementById('ctx2tool-backdrop')?.remove();
    parentDoc.getElementById('ctx2tool-panel')?.remove();

    // 遮罩层（点空白处关闭）
    const backdrop = parentDoc.createElement('div');
    backdrop.id = 'ctx2tool-backdrop';
    Object.assign(backdrop.style, {
      display: 'none',
      position: 'fixed',
      inset: '0',
      zIndex: '99999',
      background: 'rgba(0, 0, 0, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      boxSizing: 'border-box',
    });

    backdrop.onclick = (e) => {
      if (e.target === backdrop) closePanel();
    };

    const panel = parentDoc.createElement('div');
    panel.id = 'ctx2tool-panel';
    Object.assign(panel.style, {
      width: '100%',
      maxWidth: '460px',
      maxHeight: '80vh',
      background: 'rgba(20, 20, 24, 0.97)',
      color: '#eaeaea',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '12px',
      padding: '14px',
      fontSize: '13px',
      overflowY: 'auto',
      boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
      wordBreak: 'break-all',
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.14);">
        <strong>ContextToTool v${VERSION}</strong>
        <button id="ctx2tool-close" style="padding:4px 10px;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">关闭</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="ctx2tool-tabbtn-settings" style="flex:1;padding:6px;font-size:13px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);color:#fff;cursor:pointer;">配置面板</button>
        <button id="ctx2tool-tabbtn-logs" style="flex:1;padding:6px;font-size:13px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);color:#fff;cursor:pointer;">运行日志</button>
      </div>

      <div id="ctx2tool-tab-settings" style="line-height:1.6;">
        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span>启用上下文转工具描述</span>
          <input id="ctx2tool-cfg-enabled" type="checkbox" style="width:18px;height:18px;" />
        </label>

        <div style="margin-bottom:10px;">
          <div style="margin-bottom:4px;">打包模式</div>
          <select id="ctx2tool-cfg-mode" style="width:100%;padding:6px;border-radius:6px;background:#2b2b32;color:#fff;border:1px solid rgba(255,255,255,0.2);">
            <option value="all">all（除最后一条外全部打包）</option>
            <option value="all_with_placeholder">all_with_placeholder（全部打包 + 占位消息）</option>
            <option value="system_only">system_only（仅打包 system，保留聊天记录）</option>
          </select>
        </div>

        <div id="ctx2tool-placeholder-wrap" style="margin-bottom:10px;">
          <div style="margin-bottom:4px;">messages 留底内容（留空即发空消息，或填引导词）</div>
          <input id="ctx2tool-cfg-placeholder" type="text" placeholder="留空即空消息 &quot;&quot;，或填如：请使用工具" style="width:100%;box-sizing:border-box;padding:6px;border-radius:6px;background:#2b2b32;color:#fff;border:1px solid rgba(255,255,255,0.2);" />
        </div>

        <div style="margin-bottom:10px;">
          <div style="margin-bottom:4px;">工具名称（仅字母/数字/下划线）</div>
          <input id="ctx2tool-cfg-toolname" type="text" style="width:100%;box-sizing:border-box;padding:6px;border-radius:6px;background:#2b2b32;color:#fff;border:1px solid rgba(255,255,255,0.2);" />
        </div>

        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span>附加 tool_choice: none（禁调用）</span>
          <input id="ctx2tool-cfg-disablecall" type="checkbox" style="width:18px;height:18px;" />
        </label>

        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span>开启日志记录</span>
          <input id="ctx2tool-cfg-enablelog" type="checkbox" style="width:18px;height:18px;" />
        </label>

        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span>开启顶部弹窗提示（Toast）</span>
          <input id="ctx2tool-cfg-showtoast" type="checkbox" style="width:18px;height:18px;" />
        </label>

        <div style="display:flex;gap:8px;">
          <button id="ctx2tool-save" style="flex:1;padding:8px;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-weight:bold;cursor:pointer;">保存配置</button>
          <button id="ctx2tool-reset" style="padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#ddd;cursor:pointer;">恢复默认</button>
        </div>
      </div>

      <div id="ctx2tool-tab-logs" style="display:none;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button id="ctx2tool-clear-logs" style="padding:3px 10px;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">清空日志</button>
        </div>
        <div id="ctx2tool-log-list" style="white-space:pre-wrap;line-height:1.45;font-size:12px;"></div>
      </div>
    `;

    backdrop.appendChild(panel);
    parentDoc.body.appendChild(backdrop);

    parentDoc.getElementById('ctx2tool-close').onclick = closePanel;
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
