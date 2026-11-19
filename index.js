// SillyTavern (TavernHelper / JS-Slash-Runner) 远程全局脚本
// 功能：在 Chat Completion 请求发出前，将上下文/预设打包塞入 tools[i].function.description
// 并提供手机端 toastr 提示与悬浮日志面板

(() => {
  const VERSION = '1.0.0';

  // 允许在酒馆助手的加载器里通过 window.CTX2TOOL_CONFIG 覆盖默认配置
  const DEFAULT_CONFIG = {
    // 'all'                  = 除最后一条外全部塞进工具描述（最后一条留在 messages）
    // 'all_with_placeholder' = 连最后一条也全部塞进工具描述（messages 用占位符顶住）
    // 'system_only'          = 只把 system 消息塞进工具描述，保留聊天记录
    mode: 'all',

    // mode 为 'all_with_placeholder' 时填入 messages 的占位内容
    placeholderText: '.',

    // 工具名称（只允许字母、数字、下划线）
    toolName: 'context_preset',

    // 是否禁止模型主动调用该工具（如中转/模型报 400 不支持 tool_choice，保持 false）
    disableToolCall: false,

    // 手机端：每次发请求时是否弹出 toastr 简短提示
    showToast: true,

    // 手机端：是否显示右下角悬浮「工具日志」按钮（调通后可改为 false 隐藏）
    showMobilePanel: true,

    // 悬浮面板最多保留几条历史日志
    maxLogs: 20,
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, globalThis.CTX2TOOL_CONFIG || {});
  const logs = [];
  const parentDoc = window.parent?.document || document;

  // 防止重复注册监听器（例如手动重载脚本时）
  if (typeof globalThis.__ctx2toolCleanup === 'function') {
    try {
      globalThis.__ctx2toolCleanup();
    } catch (_) {}
  }

  function addLog(level, summary, detail = '') {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift({ time, level, summary, detail });
    if (logs.length > CONFIG.maxLogs) logs.pop();

    console.log(`[ContextToTool v${VERSION}][${level}] ${summary}`, detail || '');
    renderLogList();
  }

  function initMobilePanel() {
    parentDoc.getElementById('ctx2tool-log-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-panel')?.remove();

    if (!CONFIG.showMobilePanel) return;

    const btn = parentDoc.createElement('button');
    btn.id = 'ctx2tool-log-btn';
    btn.textContent = '工具日志';
    Object.assign(btn.style, {
      position: 'fixed',
      right: '12px',
      bottom: '80px',
      zIndex: '99999',
      padding: '6px 10px',
      fontSize: '12px',
      color: '#fff',
      background: 'rgba(30, 30, 30, 0.78)',
      border: '1px solid rgba(255, 255, 255, 0.25)',
      borderRadius: '16px',
      backdropFilter: 'blur(4px)',
      cursor: 'pointer',
    });

    const panel = parentDoc.createElement('div');
    panel.id = 'ctx2tool-log-panel';
    Object.assign(panel.style, {
      display: 'none',
      position: 'fixed',
      left: '4vw',
      right: '4vw',
      bottom: '125px',
      maxHeight: '60vh',
      zIndex: '99999',
      background: 'rgba(20, 20, 24, 0.95)',
      color: '#eaeaea',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '10px',
      padding: '10px',
      fontSize: '12px',
      overflowY: 'auto',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      wordBreak: 'break-all',
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.15);">
        <strong>ContextToTool v${VERSION}</strong>
        <div>
          <button id="ctx2tool-clear" style="margin-right:6px;padding:2px 8px;font-size:12px;">清空</button>
          <button id="ctx2tool-close" style="padding:2px 8px;font-size:12px;">关闭</button>
        </div>
      </div>
      <div id="ctx2tool-log-list" style="white-space:pre-wrap;line-height:1.45;"></div>
    `;

    btn.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      renderLogList();
    };

    parentDoc.body.appendChild(btn);
    parentDoc.body.appendChild(panel);

    parentDoc.getElementById('ctx2tool-clear').onclick = () => {
      logs.length = 0;
      renderLogList();
    };
    parentDoc.getElementById('ctx2tool-close').onclick = () => {
      panel.style.display = 'none';
    };
  }

  function renderLogList() {
    const listEl = parentDoc.getElementById('ctx2tool-log-list');
    if (!listEl) return;

    if (logs.length === 0) {
      listEl.textContent = '暂无日志，发送一条消息后会显示在这里。';
      return;
    }

    listEl.innerHTML = logs
      .map((item) => {
        const color =
          item.level === 'ERR' ? '#ff6b6b' : item.level === 'WARN' ? '#ffd166' : '#7ae582';
        const escapedDetail = item.detail
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `
          <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed rgba(255,255,255,0.12);">
            <div><span style="color:${color};font-weight:bold;">[${item.time} ${item.level}]</span> ${item.summary}</div>
            ${
              escapedDetail
                ? `<details style="margin-top:4px;"><summary style="color:#9ec5fe;">展开详情</summary><div style="margin-top:4px;color:#ccc;">${escapedDetail}</div></details>`
                : ''
            }
          </div>
        `;
      })
      .join('');
  }

  const handler = (data) => {
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
        `工具数: ${data.tools.length}（tool_choice: ${data.tool_choice ?? '未设置'}）\n` +
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

  initMobilePanel();
  eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);

  globalThis.__ctx2toolCleanup = () => {
    if (typeof eventRemoveListener === 'function') {
      eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, handler);
    }
    parentDoc.getElementById('ctx2tool-log-btn')?.remove();
    parentDoc.getElementById('ctx2tool-log-panel')?.remove();
  };

  addLog('OK', `v${VERSION} 已加载（模式: ${CONFIG.mode}）`);
  if (CONFIG.showToast && typeof toastr !== 'undefined') {
    toastr.success(`v${VERSION} 已加载（模式: ${CONFIG.mode}）`, 'ContextToTool');
  }
})();
