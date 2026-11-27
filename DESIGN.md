# C Disk Cleaner (dsh-cleaner) 设计交接

## 一、目标

DSH 右上角常驻一枚小刷子：可拖动、可钉住、可变成纯图标、可贴右边缘；
点开是清理面板，逐项显示缓存大小，勾选后一键清理并显示真实释放量。
形态与行为都在 设置 → 缓存清理 里可调，右键还有快捷菜单。

## 二、上一版为什么没做出来（根本原因，务必记住）

上一版文件、接线、路由全对，但 `lib/client.js` 的工厂函数**末尾漏了
`return module.exports`**。宿主拿到 `undefined` 就当导入失败：

```
web boot: warning: 1 entry did not activate
dsh-cleaner: import failed (see console for the import error)
```

于是整个浏览器半边不挂载 —— 按钮、面板、样式全不存在。host 路由却是 200 正常，
所以从 `/dsh-cleaner/targets` 看一切正常，很容易误判成「slot 注册签名不对」。

**教训**：client bundle 的 `factory` 必须 `return module.exports`。
排查 UI 不出现时，先去页面控制台搜 `import failed`，不要先怀疑 slot API。

## 三、架构

1. **Host**（`lib/index.js`，ESM，`export apply(ctx, config)`）
   `ctx.inject(['webServer'], cb)` → 注册 `/dsh-cleaner/*` 前缀路由。
   负责扫描、逐项清理、偏好持久化。**删除路径全部由服务端拼出。**
2. **Client**（`lib/client.js`，`window.__ModuleLoader__.load({ id, factory })`）
   `require('react')`，注册三处 slot（见下）。**工厂必须 return module.exports。**
3. **组合层**（`cordis.patch.yml`）：`insert` 一行 id/name=dsh-cleaner。
4. **接线**：profile 的 package.json 用 `link:` + `node_modules` junction。

### Client 注册的三处

| slot | id | 作用 |
| --- | --- | --- |
| `shell.overlay` | `dsh-cleaner.floating` | 右上角浮层（按钮 + 面板 + 右键菜单） |
| `settings.section` | `dsh-cleaner` | 设置里的一页「缓存清理」 |
| `settings.section.icon` | `dsh-cleaner` | 该页在设置导航里的刷子图标 |

## 四、Host 设计

### 目标定义 `definitions()`

每次调用重新解析（配置可能变、目录可能重建）：

| id | 分组 | roots | 默认勾选 |
| --- | --- | --- | --- |
| dsh-search | dsh | `$DSH_HOME/cache/dsh-claude-style/search` | 是 |
| dsh-image | dsh | `$DSH_HOME/cache/dsh-image-gen/inspiration` | 是 |
| dsh-spill | dsh | `%TEMP%/dsh-subprocess-*`、`dsh-spill-*`（filter） | 是 |
| uv | dev | `%LOCALAPPDATA%/uv/cache` | 是 |
| npm | dev | `%LOCALAPPDATA%/npm-cache` | 是 |
| pnpm | dev | `%LOCALAPPDATA%/pnpm/store` | 是 |
| pip | dev | `%LOCALAPPDATA%/pip/cache` | 是 |
| temp-old | system | `%TEMP%` 里 mtime > 7 天的条目（filter） | 否 |
| updater-installers | system | `%LOCALAPPDATA%/*-updater/installer.exe`，mtime > 3 天（filter） | 否 |

`roots[].filter(name, full, info)` 把「整目录」收窄成「目录里符合条件的条目」。

### 安全边界

- `inside(path, root)`：resolve 后 `p === r || p.startsWith(r + sep)`，**删除前每一条都过一遍**。
- 只删 roots 里的内容，**不删 roots 目录本身**。
- 绝不删：`cache/attachments/request-images`（旧对话图片）、会话、凭证、笔记、设置、插件本体。
- 删不动的（被占用）跳过并计数，不中断。
- `guard()`：Origin/Referer 校验。拿不到 origin 时放行（避免面板打不开）。

### 偏好持久化

`$DSH_HOME/dsh-cleaner/config.json`。所有入参都过 `normalizeConfig()`：
非法形态回落默认、坐标夹 ±20000、不透明度夹 0.35–1、`disabled` 只接受已知目标 id。
**坐标传非数字必须回落到 `null`**（曾经错误地变成 0，会把按钮推出屏幕）。

### 性能

- 扫描总预算 `SCAN_BUDGET_MS = 9000`，全扫描共享（曾按每项 2.5s 给，
  结果 pnpm 4.3 万文件被截断成 756MB，实际 2.1GB）。实测全量 ~4.6s / 3.9GB 准确。
- `/scan` 缓存 60 秒；`?force=1` 绕过。
- `/clean-item` 单项预算 120s；批量 120s。
- `diskBefore`/`diskAfter` 用 `statfs`，面板显示「C 盘可用 +Y」是真实差值。

### 端点

- `GET/POST/DELETE /dsh-cleaner/config`
- `GET /dsh-cleaner/targets`（不返回绝对路径）
- `GET /dsh-cleaner/scan[?force=1]`
- `POST /dsh-cleaner/clean-item?id=<id>` ← **面板逐项动画的数据源**
- `POST /dsh-cleaner/clean[?id=a&id=b]`

## 五、Client 设计

### 定位

根容器 `position:fixed; inset:0; z-index:9999; pointer-events:none`，
里面每个元素自己开 `pointer-events:auto`。按钮 `position:absolute`，
所以 `left/top` 生效，能拖到任意位置。

**踩过的坑**：
- 第一版根容器只有 `position:fixed` 没有尺寸，按钮是 static 子元素 → 渲染在 0,0。
- 第二版用 `<span style="display:contents">` 包裹按钮来拿 ref 当锚点 →
  该元素 `getBoundingClientRect()` 全是 0，面板跑到左上角。
  现在把 ref 直接挂在按钮上（`anchorRef` prop）。

### 四种形态

| mode | 样子 | 能否拖动 |
| --- | --- | --- |
| `float` | 圆角胶囊 + 刷子 + 文字 | 能，位置存 config.x/y |
| `icon` | 36px 圆图标 | 能 |
| `fixed` | 同 float，但忽略拖动 | 不能 |
| `rail` | 贴右边缘竖条，`writing-mode:vertical-rl` | 不能（CSS 定位） |

### 拖动

pointerdown/move/up + `setPointerCapture`。位移 < 3px 视为点击不视为拖动；
结束时把坐标夹回视口并 `POST /config` 持久化。

### 右键菜单

`position:fixed` 的浮层，挂 `window` 的 `pointerdown`/`keydown`/`resize` 关闭
（capture 阶段，避免点菜单项自己被先关掉）。菜单项：四种形态、立即清理、设置、隐藏。

### 隐藏

`sessionStorage['dsh-cleaner:hidden']`。这样「隐藏后直到下次打开 DSH」，
不用服务端参与，也不会永久丢失入口（设置页里能看到当前隐藏状态并叫回来）。

### 零字节过滤与自动展开

- `/scan` 返回原始列表，client 侧 `showEmpty=false` 时过滤掉 `bytes === 0`。
- 只有 `autoExpand=true` 且**确实有东西可清**时才自动开面板；默认不开。
- 下次缓存长出来，自动重新出现在列表里。

### 清理动画

`clean()` 逐项调 `/clean-item`，一项一个来回，于是前端准确知道「现在在清哪一项」：

- 当前行 `data-state="cleaning"`：高亮 + 底部扫光条（`@keyframes dc-sweep`）
- 完成后 `data-state="done"`：淡出 + 打勾
- 面板顶部 `[data-dc-total]` 总进度条
- 按钮文案变成 `清理中 3/5 · 1.2 GB`
- **每项至少停留 240ms（`MIN_DWELL`）**：npm 缓存只有几 KB 时删除是毫秒级的，
  不压节奏用户根本看不清清了哪一项。

### 半透明

所有表面用 `color-mix(in srgb, var(--dsw-alias-bg-base) <opacity>%, transparent)`
+ `backdrop-filter: blur(22px) saturate(1.6)`。默认 0.82，设置里 35%–100% 可调。

### 共享状态

client 内部有个极小的 `store`（`config` + `hidden` + 订阅者），
浮层和设置页都订阅它 —— 在设置里改形态，右上角按钮立刻变。

## 六、测试

```sh
node test/client.test.mjs   # 49 项
node test/host.test.mjs     # 60 项
node test/e2e.mjs           # 27 项（需 DSH 在 7651 运行）
```

- client：工厂返回 exports（就是第一次的 bug）、三处 slot 注册、首屏渲染、
  拖动/右键 handler 存在、隐藏态不渲染、设置页含四形态与滑块、中英文案一一对应。
- host：白名单外零字节不动、目录本身保留、默认不勾的不删、伪造 id 不越权、
  配置持久化与非法值清洗、`/clean-item` 只清指定项。
- e2e：真实 Chrome。用 CDP 的 `Fetch.enable` 把 `/dsh-cleaner/*` 转发到
  「本地另起的、用磁盘最新代码的 host」，因此**不重启 DSH 也能验完整链路**。
  覆盖：按钮位置、半透明、真实鼠标拖动 + 坐标持久化、右键菜单、纯图标切换、
  0 字节不显示、逐项清理动画。

### 访问受保护 GUI 的方法

GUI 根页 401 是要浏览器 cookie。cookie 名 = `dsh-auth-` + base64url(sha256(host))，
值 = `v1.<base64url(payload)>.<hmac-sha256(body)>`，密钥在
`$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session.secret`。
`test/e2e.mjs` 的 `cookieFor()` 就是这段（只读、只发给自己本机）。

## 七、当前状态（2026-11-27）

- 版本 0.3.0。49 + 60 + 27 项测试全绿。
- 四种形态、拖动记忆、右键菜单、隐藏、设置页、半透明、逐项清理动画
  全部在真实 GUI 里截图确认过。
- **host 半边需用户完全退出 DSH 再打开才生效**；client 刷新页面即可。

## 八、下一步建议

1. 用户重启 DSH 后确认新形态与新面板。
2. 想扩清理目标：改 `definitions()`，同步 README/本文件/隐私审计。
3. 若控制台再出现 `import failed`，先查 client 工厂有没有 `return module.exports`。
4. 隐私审计：提交前 grep 个人路径/凭据/会话 ID/笔记 ID。测试脚本里**不要写死
   用户绝对路径**，用 `import.meta.url` 推导（这一版已经踩过并修好）。
