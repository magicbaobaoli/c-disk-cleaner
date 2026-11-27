# dsh-cleaner

DSH 右上角常驻一枚小刷子：可以拖到任意位置、钉死、变成纯图标、或贴到右边缘。点开就能看各项缓存占多大，勾选后一键清理，并显示真实释放量和 C 盘可用空间变化。

## 功能

**按钮形态**（右键菜单切换，或 设置 → 缓存清理）

- **浮动按钮** — 可拖到桌面任意位置，带文字，位置自动记住
- **纯图标** — 只有一个小圆图标，可拖动，最省地方
- **固定在右上角** — 钉住不动，避免误拖
- **贴右边缘** — 右侧一条竖标，不挡内容

**右键菜单**：切换形态、立即统计并清理、打开设置、隐藏

**隐藏**：右键隐藏后，直到下次打开 DSH 才回来（标记存在 `sessionStorage`）。想立刻叫回来就 设置 → 缓存清理 → 显示。

**半透明面板**：默认 82% 不透明 + 毛玻璃，背景内容能透出来，不那么挡视线。设置里 35%–100% 可调。

**清理动画**：逐项清理，正在清的那一行高亮 + 底部扫光，面板顶部还有一条总进度条，按钮上显示 `3/5`。每项至少停留 240ms，几 KB 的小项也看得清。

**面板只显示真占地方的东西**：0 字节的项默认不列出来；下次再长出来会自动出现。默认不自动展开面板，点一下才开。

## 清理范围

默认勾选（可安全重建）：

| 分组 | 目标 | 说明 |
| --- | --- | --- |
| DSH 自身 | DSH 搜索缓存 | 索引缓存，删后自动重建 |
| DSH 自身 | DSH 图片缩略缓存 | 缩略图，重新打开图片会重建 |
| DSH 自身 | DSH 溢出日志 | 命令输出落盘的临时日志 |
| 开发工具 | uv 包缓存 | Python 依赖缓存，通常几个 GB |
| 开发工具 | npm 缓存 | 下载缓存 |
| 开发工具 | pnpm 存储 | 全局包内容存储 |
| 开发工具 | pip 缓存 | wheel 缓存 |

默认不勾选（会影响下次安装速度，或属于别的软件）：

- **临时文件（7 天前）** — 系统临时目录里超过 7 天没动过的东西
- **其他软件残留安装包** — 各 Electron 软件更新器留下的 `installer.exe`，常年几百 MB

**绝不删除**：`$DSH_HOME/cache/attachments/request-images`（旧对话里的图片）、会话、凭证、笔记、设置、插件本体。

## 安全机制

- 所有可删路径都由 host 用已知位置拼出来，浏览器只能传「目标 id」，传不了路径 —— 这个接口不可能是任意文件删除器。
- 每个目标声明自己的 roots，删除前逐条再走一次 `inside()` 白名单校验。
- 只删 roots 里的内容，**不删 roots 目录本身**，避免破坏应用对目录结构的预期。
- 删不动的、正在被占用的文件跳过并计数，不中断整体流程。
- 面板显示的是事后重新统计的真实数字，不是估算。

## 安装

```sh
# 在 DSH profile 的目录里
pnpm add link:<本目录绝对路径>
```

再把 `dsh-cleaner` 加进 profile `package.json` 的 `dsh.profile.bundles`，重启 DSH。

**改完 host 半边必须完全退出 DSH 再打开**（host 只在启动时加载一次）；client 半边刷新页面即可生效。

## 配置

偏好存在 `$DSH_HOME/dsh-cleaner/config.json`，也可在 设置 → 缓存清理 里改：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `float` | `float` / `icon` / `fixed` / `rail` |
| `x`, `y` | `null` | 浮动位置（视口像素），`null` = 默认右上角 |
| `opacity` | `0.82` | 面板不透明度，0.35–1 |
| `showEmpty` | `false` | 是否列出 0 字节的项 |
| `autoExpand` | `false` | 有东西可清时是否自动展开面板 |
| `disabled` | `[]` | 关掉的清理目标 id |

host 会把所有传入值清洗一遍：非法形态回落默认、坐标夹在 ±20000、不透明度夹在 0.35–1、`disabled` 只接受已知目标 id。

## HTTP 接口

- `GET /dsh-cleaner/config` → `{ config, modes, defaults }`
- `POST /dsh-cleaner/config` → 局部更新
- `DELETE /dsh-cleaner/config` → 恢复默认
- `GET /dsh-cleaner/targets` → 目标列表 + 磁盘可用（不返回绝对路径）
- `GET /dsh-cleaner/scan[?force=1]` → 各项大小（60 秒缓存）
- `POST /dsh-cleaner/clean-item?id=<id>` → 清一项（面板动画数据源）
- `POST /dsh-cleaner/clean[?id=a&id=b]` → 批量清理

## 测试

```sh
node test/client.test.mjs   # 49 项：工厂返回值、slot 注册、按钮渲染、设置页、文案完整
node test/host.test.mjs     # 60 项：白名单、配置持久化、逐项清理、路径穿越
node test/e2e.mjs           # 27 项：真实浏览器 + 真实新 host（需 DSH 在 7651 运行）
```

`test/e2e.mjs` 用 CDP 拦截浏览器里 client 的 `/dsh-cleaner/*` 请求，转发到「磁盘上最新代码起的 host」，从而在不重启 DSH 的前提下跑完整链路（真实 React 渲染 + 真实新 host 响应、真实鼠标拖动/右键/点击）。

## License

MIT
