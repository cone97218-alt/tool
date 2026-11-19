# st-context-to-tool

SillyTavern（酒馆助手 / TavernHelper）远程全局脚本：将上下文与预设打包塞进 `tools[].function.description`，入口注入魔法棒菜单，支持手机端配置面板与日志查看。

## 在酒馆助手里使用（实时自动更新）

在 **酒馆助手 -> 脚本 -> 全局脚本** 中新建一个脚本，粘贴下面代码并开启即可（优先直连 GitHub Raw，不通时自动按最新 Commit SHA 走 jsDelivr，彻底绕开 CDN 旧缓存）：

```javascript
const REPO = 'cone97218-alt/tool';
const BRANCH = 'main';
const FILE = 'index.js';

(async () => {
  const tryLoad = async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    (0, eval)(code);
  };

  // 1. 优先直接拉取 GitHub Raw（更新最快，无 jsDelivr 缓存延迟）
  try {
    await tryLoad(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}?t=${Date.now()}`);
    return;
  } catch (_) {}

  // 2. Raw 不通时，先取最新 commit SHA 再走 jsDelivr（精准命中最新版，不吃 @main 旧缓存）
  try {
    const meta = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      cache: 'no-store',
    }).then((r) => r.json());
    const ref = meta?.sha || BRANCH;
    for (const host of ['cdn.jsdelivr.net', 'fastly.jsdelivr.net']) {
      try {
        await tryLoad(`https://${host}/gh/${REPO}@${ref}/${FILE}`);
        return;
      } catch (_) {}
    }
  } catch (_) {}

  toastr?.error('远程脚本加载失败，请检查网络', 'ContextToTool');
})();
```
