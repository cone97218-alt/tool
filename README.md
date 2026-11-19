# st-context-to-tool

SillyTavern（酒馆助手 / TavernHelper）远程全局脚本：将上下文与预设打包塞进 `tools[].function.description`，支持手机端弹窗和悬浮日志面板。

## 在酒馆助手里使用（自动更新）

在 **酒馆助手 -> 脚本 -> 全局脚本** 中新建一个脚本，填入下面代码即可（把 `cone97218-alt/tool` 替换成实际地址）：

### 方式 A：一行 `import`（最简）

```javascript
import(`https://cdn.jsdelivr.net/gh/cone97218-alt/tool@main/index.js?t=${Date.now()}`);
```

### 方式 B：带自定义配置 + 多节点自动回退（推荐，适合手机端网络）

```javascript
// 可选：在这里覆盖默认配置，远程更新后仍保留你的个人设置
window.CTX2TOOL_CONFIG = {
  mode: 'all',             // 'all' | 'all_with_placeholder' | 'system_only'
  disableToolCall: false,
  showToast: true,
  showMobilePanel: true,
};

const urls = [
  'https://cdn.jsdelivr.net/gh/cone97218-alt/tool@main/index.js',
  'https://fastly.jsdelivr.net/gh/cone97218-alt/tool@main/index.js',
  'https://raw.githubusercontent.com/cone97218-alt/tool/main/index.js',
];

(async () => {
  for (const url of urls) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const code = await res.text();
      (0, eval)(code);
      return;
    } catch (_) {}
  }
  toastr?.error('所有远程节点均加载失败，请检查网络或仓库地址', 'ContextToTool');
})();
```

## 自动更新机制

- 每次你 `push` 到 GitHub 的 `main` / `master` 分支时，仓库内置的 GitHub Action（`.github/workflows/purge-cache.yml`）会自动刷新 jsDelivr 的 CDN 缓存。
- 手机端刷新酒馆页面即可自动拉取最新版（可通过悬浮面板标题或顶部弹窗里的版本号 `v1.0.0` 确认）。
