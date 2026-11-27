/**
 * dsh-cleaner — 浏览器半边
 *
 * 右上角一枚小刷子：
 *   - 可以拖到任意位置（自动记住），或钉死、或变成纯图标、或贴到右边缘
 *   - 右键出快捷菜单：切换形态 / 隐藏 / 更多设置
 *   - 点开是清理面板：逐项显示大小、勾选、一键清理，清理时逐项播放进度
 *   - 0 字节的项默认不显示；只有真的有东西可清时才自动展开
 *
 * 这是 `__ModuleLoader__.load` 工厂（与所有 DSH client bundle 同形），不是 ES 模块。
 * 注意：工厂必须 `return module.exports`，否则宿主报 "import failed"，整个 UI 不挂载。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cleaner',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-cleaner'
    const STYLE_ID = 'dsh-cleaner-style'
    const GROUP_ORDER = ['dsh', 'dev', 'system']
    const HIDE_KEY = 'dsh-cleaner:hidden'
    const MODES = [
      { id: 'float', icon: 'float' },
      { id: 'icon', icon: 'icon' },
      { id: 'fixed', icon: 'fixed' },
      { id: 'rail', icon: 'rail' },
    ]

    // ── 文案 ────────────────────────────────────────────────────────────────
    const LEX = {
      zh: {
        'button.title': '清理缓存',
        'button.hint': '一键清理 DSH 缓存，释放 C 盘空间',
        'panel.title': '清理缓存',
        'panel.subtitle': '只删可安全重建的缓存。会话、笔记、设置、凭证不碰。',
        'panel.disk': 'C 盘可用',
        'panel.scanning': '正在统计…',
        'panel.clean': '立即清理',
        'panel.cleaning': '清理中',
        'panel.rescan': '重新统计',
        'panel.close': '关闭',
        'panel.selectAll': '全选',
        'panel.selectNone': '全不选',
        'panel.nothing': '很干净，没有可清理的缓存。',
        'panel.defaultOn': '建议',
        'panel.optional': '可选',
        'panel.sizeLower': '统计超时，实际更大',
        'panel.freed': '已释放',
        'panel.skipped': '个文件被占用，已跳过',
        'panel.done': '清理完成',
        'panel.closing': '正在清理',
        'panel.safe': '白名单路径，删前逐条校验',
        'panel.retry': '重试',
        'panel.restart': '面板已更新，但宿主还是旧版本。完全退出 DSH 再打开一次。',
        'panel.offline': '拿不到宿主响应，稍后再试。',
        'panel.settingsHint': '更多选项：设置 → 缓存清理',
        'group.dsh': 'DSH 自身',
        'group.dev': '开发工具缓存',
        'group.system': '系统与其它软件',
        'menu.icon': '变成纯图标',
        'menu.float': '可拖动的按钮',
        'menu.fixed': '固定在右上角',
        'menu.rail': '贴到右边缘',
        'menu.rescan': '立即统计并清理',
        'menu.hide': '隐藏（重启 DSH 后回来）',
        'menu.settings': '设置…',
        'menu.show': '显示按钮',
        'menu.title': '刷子选项',
        'set.title': '缓存清理',
        'set.desc': '这个小刷子一直在等你按。下面这些都能改，改完立刻生效。',
        'set.mode': '显示形态',
        'set.mode.float': '浮动按钮',
        'set.mode.float.desc': '可以拖到桌面任意位置，带文字。',
        'set.mode.icon': '纯图标',
        'set.mode.icon.desc': '只有一个小圆图标，可以拖动，最省地方。',
        'set.mode.fixed': '固定在右上角',
        'set.mode.fixed.desc': '钉住不动，避免误拖。',
        'set.mode.rail': '贴右边缘',
        'set.mode.rail.desc': '右侧边缘一条竖标，不挡内容。',
        'set.position': '位置',
        'set.position.desc': '浮动或图标形态下可以随意拖动；这里可以一键复位。',
        'set.position.reset': '复位到右上角',
        'set.position.value': '当前位置',
        'set.opacity': '面板不透明度',
        'set.opacity.desc': '调低能让背后的内容透出来，不那么挡视线。',
        'set.visibility': '显示按钮',
        'set.visibility.desc': '右键菜单里隐藏后，从这里或右键菜单把它叫回来。',
        'set.visibility.on': '显示',
        'set.visibility.off': '当前已隐藏',
        'set.behavior': '行为',
        'set.autoExpand': '有东西可清时自动展开',
        'set.autoExpand.desc': '关闭后（默认）只显示按钮，点一下才展开面板，不占地方。',
        'set.showEmpty': '显示 0 字节的项',
        'set.showEmpty.desc': '关闭后（默认）只列出确实有内容的目标。',
        'set.targets': '清理目标',
        'set.targets.desc': '关掉的项既不会出现在面板里，也不会被清理。',
        'set.target.empty': '这一项目前是 0 字节',
        'set.reset': '恢复全部默认设置',
        'set.reset.confirm': '确认恢复默认？位置、形态、透明度和目标开关都会重置。',
        'set.saved': '已保存',
        'set.loading': '读取设置…',
      },
      en: {
        'button.title': 'Clean caches',
        'button.hint': 'Clean DSH caches and free up space on C:',
        'panel.title': 'Clean caches',
        'panel.subtitle': 'Only rebuildable caches. Chats, notes, settings and credentials are never touched.',
        'panel.disk': 'C: free',
        'panel.scanning': 'Measuring…',
        'panel.clean': 'Clean now',
        'panel.cleaning': 'Cleaning',
        'panel.rescan': 'Recheck',
        'panel.close': 'Close',
        'panel.selectAll': 'All',
        'panel.selectNone': 'None',
        'panel.nothing': 'Nothing to clean — all clear.',
        'panel.defaultOn': 'Suggested',
        'panel.optional': 'Optional',
        'panel.sizeLower': 'Timed out; actually larger',
        'panel.freed': 'Freed',
        'panel.skipped': 'files were in use and skipped',
        'panel.done': 'Done',
        'panel.closing': 'Cleaning',
        'panel.safe': 'Whitelisted paths, re-checked before every delete',
        'panel.retry': 'Retry',
        'panel.restart': 'The panel updated but the host is still the old build. Quit DSH completely and reopen it.',
        'panel.offline': 'No response from the host. Try again shortly.',
        'panel.settingsHint': 'More options: Settings → Cache cleaner',
        'group.dsh': 'DSH itself',
        'group.dev': 'Developer caches',
        'group.system': 'System and other apps',
        'menu.icon': 'Compact icon only',
        'menu.float': 'Draggable button',
        'menu.fixed': 'Pin to top-right',
        'menu.rail': 'Dock to right edge',
        'menu.rescan': 'Scan and clean now',
        'menu.hide': 'Hide (back after DSH restarts)',
        'menu.settings': 'Settings…',
        'menu.show': 'Show button',
        'menu.title': 'Brush options',
        'set.title': 'Cache cleaner',
        'set.desc': 'The little brush waits here for you. Everything below takes effect immediately.',
        'set.mode': 'Appearance',
        'set.mode.float': 'Draggable button',
        'set.mode.float.desc': 'Drag it anywhere; shows a label.',
        'set.mode.icon': 'Icon only',
        'set.mode.icon.desc': 'A small round icon, draggable, minimal footprint.',
        'set.mode.fixed': 'Pinned top-right',
        'set.mode.fixed.desc': 'Stays put — cannot be dragged by accident.',
        'set.mode.rail': 'Right edge rail',
        'set.mode.rail.desc': 'A slim vertical tab on the right edge that covers nothing.',
        'set.position': 'Position',
        'set.position.desc': 'Draggable in float or icon mode; reset it here.',
        'set.position.reset': 'Reset to top-right',
        'set.position.value': 'Current',
        'set.opacity': 'Panel opacity',
        'set.opacity.desc': 'Lower it to let the content behind show through.',
        'set.visibility': 'Visibility',
        'set.visibility.desc': 'After hiding it from the context menu, bring it back here.',
        'set.visibility.on': 'Visible',
        'set.visibility.off': 'Currently hidden',
        'set.behavior': 'Behaviour',
        'set.autoExpand': 'Auto-open when there is something to clean',
        'set.autoExpand.desc': 'Off by default: the button stays collapsed until you click it.',
        'set.showEmpty': 'Show entries that are 0 bytes',
        'set.showEmpty.desc': 'Off by default: only targets with real content are listed.',
        'set.targets': 'Cleanup targets',
        'set.targets.desc': 'A disabled target never appears in the panel and is never cleaned.',
        'set.target.empty': 'Currently 0 bytes',
        'set.reset': 'Restore all defaults',
        'set.reset.confirm': 'Restore defaults? Position, appearance, opacity and target switches all reset.',
        'set.saved': 'Saved',
        'set.loading': 'Loading settings…',
      },
    }

    function formatBytes(bytes) {
      const n = Number(bytes)
      if (!Number.isFinite(n) || n <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
      const value = n / Math.pow(1024, index)
      return (index === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[index]
    }

    // ── 共享状态：浮层和设置页读写同一份配置 ─────────────────────────────────

    const store = {
      config: null,
      hidden: false,
      listeners: new Set(),
      notify() {
        for (const listener of [...this.listeners]) {
          try {
            listener()
          } catch {
            /* 单个订阅者出错不影响别人 */
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      setConfig(next) {
        this.config = next
        this.notify()
      },
      setHidden(value) {
        this.hidden = value
        try {
          window.sessionStorage.setItem(HIDE_KEY, value ? '1' : '0')
        } catch {
          /* 隐私模式下 sessionStorage 可能不可用 */
        }
        this.notify()
      },
      async load() {
        // 隐藏标记放 sessionStorage：DSH 关掉再开就自动回来，正好是「直到下次打开」。
        try {
          store.hidden = window.sessionStorage.getItem(HIDE_KEY) === '1'
        } catch {
          store.hidden = false
        }
        try {
          const response = await fetch('/dsh-cleaner/config', { cache: 'no-store', credentials: 'same-origin' })
          const body = await response.json()
          store.setConfig(body.config)
        } catch {
          store.setConfig({ mode: 'float', x: null, y: null, opacity: 0.82, showEmpty: false, autoExpand: false, disabled: [] })
        }
      },
      async save(patch) {
        // 先本地生效（点击立刻有反馈），再落盘；失败就回滚到服务器那份。
        const optimistic = { ...(store.config || {}), ...patch }
        store.setConfig(optimistic)
        try {
          const response = await fetch('/dsh-cleaner/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
            cache: 'no-store',
            credentials: 'same-origin',
          })
          const body = await response.json()
          if (body && body.config) store.setConfig(body.config)
          return true
        } catch {
          try {
            const response = await fetch('/dsh-cleaner/config', { cache: 'no-store', credentials: 'same-origin' })
            const body = await response.json()
            store.setConfig(body.config)
          } catch {
            /* 拿不回来就保持乐观值 */
          }
          return false
        }
      },
    }

    /** 订阅共享状态的 hook。 */
    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((value) => value + 1)), [])
      return store
    }

    // ── 样式 ────────────────────────────────────────────────────────────────

    const CSS = [
      // 根容器铺满视口但不拦截点击（pointer-events:none），里面每个元素自己开 pointer-events。
      // 这样按钮可以用 left/top 绝对定位到任意位置，面板也能自由摆。
      '[data-dc-root]{position:fixed;inset:0;z-index:9999;pointer-events:none}',
      '[data-dc-root]>*{pointer-events:auto}',

      // 触发按钮：三种形态共用一个基础样式。position:absolute 让 left/top 生效。
      '[data-dc-btn]{position:absolute;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:var(--dc-surface);color:inherit;cursor:pointer;backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);box-shadow:0 2px 12px rgba(0,0,0,.14);font-size:12px;font-weight:500;font-family:inherit;transition:background .16s,border-color .16s,box-shadow .16s,transform .16s;touch-action:none;user-select:none}',
      '[data-dc-btn]:hover{background:var(--dc-surface-hover);border-color:var(--dc-accent);box-shadow:0 4px 18px rgba(0,0,0,.2)}',
      '[data-dc-btn]:active{transform:scale(.97)}',
      '[data-dc-btn][data-dragging]{cursor:grabbing;box-shadow:0 10px 28px rgba(0,0,0,.3);transition:none}',
      '[data-dc-btn][data-busy]{cursor:progress}',
      '[data-dc-btn] [data-dc-glyph]{display:inline-flex;width:16px;height:16px;flex:none}',
      '[data-dc-btn] svg{width:100%;height:100%;display:block}',
      '[data-dc-btn][data-shape="icon"]{width:36px;height:36px;padding:0;border-radius:50%;justify-content:center}',
      '[data-dc-btn][data-shape="icon"] [data-dc-glyph]{width:17px;height:17px}',
      // rail：贴右边缘的竖条，由 CSS 定位，不参与拖动。
      '[data-dc-btn][data-shape="rail"]{right:0;top:50%;transform:translateY(-50%);left:auto;width:26px;height:auto;min-height:96px;padding:12px 0;border-radius:12px 0 0 12px;border-right:none;writing-mode:vertical-rl;letter-spacing:.14em;font-size:10.5px;flex-direction:column;gap:8px}',
      '[data-dc-btn][data-shape="rail"]:active{transform:translateY(-50%) scale(.97)}',

      // 手指/闲时轻轻呼吸一下，提示这里能按（尊重减少动效偏好）。
      '@keyframes dc-breathe{0%,100%{box-shadow:0 2px 12px rgba(0,0,0,.14)}50%{box-shadow:0 2px 18px var(--dc-glow)}}',
      '[data-dc-btn][data-hint]{animation:dc-breathe 3.4s ease-in-out infinite}',

      // 面板：固定定位，由 JS 算出坐标；半透明 + 毛玻璃。
      '[data-dc-panel]{position:fixed;display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));background:var(--dc-panel-bg);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);color:inherit;box-shadow:0 20px 60px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.04) inset;overflow:hidden;animation:dc-panel-in .18s cubic-bezier(.2,.9,.3,1.05)}',
      '@keyframes dc-panel-in{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion: reduce){[data-dc-panel]{animation:none}[data-dc-btn]{transition:none}[data-dc-btn][data-hint]{animation:none}}',

      '[data-dc-head]{padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.18));position:relative}',
      // 清理时在面板顶部走一条总进度条，配合行内的扫光，进度一眼可见。
      '[data-dc-total]{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden;opacity:0;transition:opacity .2s}',
      '[data-dc-total][data-on]{opacity:1}',
      '[data-dc-total] i{display:block;height:100%;background:var(--dc-accent);transition:width .32s cubic-bezier(.3,.8,.4,1);box-shadow:0 0 8px var(--dc-glow)}',
      '[data-dc-head] h3{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '[data-dc-disk]{font-size:11.5px;font-weight:500;opacity:.8;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '[data-dc-disk] b{font-weight:600;opacity:1}',
      '[data-dc-sub]{margin:5px 0 0;font-size:11px;line-height:1.5;opacity:.55}',

      '[data-dc-tools]{display:flex;align-items:center;gap:12px;padding:9px 16px 3px;font-size:11px}',
      '[data-dc-tools] button{background:none;border:none;padding:0;color:inherit;font-family:inherit;font-size:11px;opacity:.5;cursor:pointer;transition:opacity .12s}',
      '[data-dc-tools] button:hover:not(:disabled){opacity:.95}',
      '[data-dc-tools] button:disabled{opacity:.22;cursor:default}',
      '[data-dc-tools] .dc-total{margin-left:auto;opacity:.5;font-variant-numeric:tabular-nums}',

      '[data-dc-body]{padding:4px 6px 6px;overflow:auto;flex:1;min-height:44px}',
      '[data-dc-group]{font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.38;padding:9px 10px 3px}',

      // 条目
      '[data-dc-row]{position:relative;display:flex;align-items:flex-start;gap:9px;padding:7px 10px;border-radius:10px;cursor:pointer;transition:background .13s,opacity .3s,transform .3s}',
      '[data-dc-row]:hover{background:color-mix(in srgb, currentColor 6%, transparent)}',
      '[data-dc-row] input{margin:2px 0 0;flex:none;accent-color:var(--dc-accent);cursor:inherit}',
      '[data-dc-text]{flex:1;min-width:0}',
      '[data-dc-label]{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;line-height:1.35}',
      '[data-dc-tag]{font-size:9px;font-weight:600;padding:1px 5px;border-radius:5px;background:color-mix(in srgb, currentColor 11%, transparent);opacity:.62;flex:none}',
      '[data-dc-tag][data-optional]{opacity:.4}',
      '[data-dc-note]{font-size:10.5px;line-height:1.45;opacity:.5;margin-top:1px;overflow-wrap:anywhere}',
      '[data-dc-size]{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.85;padding-top:1px;flex:none;transition:opacity .3s}',
      '[data-dc-size][data-lower]{text-decoration:underline dotted;opacity:.6}',

      // 清理中的项：高亮 + 底部扫光进度条
      '[data-dc-row][data-state="cleaning"]{background:color-mix(in srgb, var(--dc-accent) 14%, transparent)}',
      '[data-dc-row][data-state="cleaning"]::after{content:"";position:absolute;left:10px;right:10px;bottom:2px;height:2px;border-radius:2px;background:color-mix(in srgb, var(--dc-accent) 25%, transparent);overflow:hidden}',
      '[data-dc-row][data-state="cleaning"]::before{content:"";position:absolute;left:10px;bottom:2px;height:2px;width:34%;border-radius:2px;background:var(--dc-accent);animation:dc-sweep 1.05s ease-in-out infinite}',
      '@keyframes dc-sweep{0%{transform:translateX(0);opacity:.5}50%{opacity:1}100%{transform:translateX(190%);opacity:.5}}',
      '[data-dc-row][data-state="done"]{opacity:0;transform:translateX(10px);pointer-events:none}',
      '[data-dc-row][data-state="done"] [data-dc-size]{opacity:0}',
      '[data-dc-tick]{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:#3fa463;opacity:0}',
      '[data-dc-row][data-state="done"] [data-dc-tick]{opacity:1}',
      '@media (prefers-reduced-motion: reduce){[data-dc-row][data-state="cleaning"]::before{animation:none;width:100%}}',

      '[data-dc-msg]{padding:0 16px;font-size:11.5px;line-height:1.5;color:#3fa463;overflow-wrap:anywhere}',
      '[data-dc-msg][data-kind="err"]{color:#e06a63}',
      '[data-dc-msg]:not(:empty){padding:9px 16px 0}',

      '[data-dc-foot]{display:flex;align-items:center;gap:8px;padding:12px 16px 14px}',
      '[data-dc-foot] .dc-hint{font-size:10px;opacity:.36;flex:1;line-height:1.4}',
      '[data-dc-foot] button{font-size:12px;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:transparent;color:inherit;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,border-color .14s,transform .1s}',
      '[data-dc-foot] button:hover:not(:disabled){border-color:var(--dc-accent)}',
      '[data-dc-foot] button:active:not(:disabled){transform:scale(.97)}',
      '[data-dc-foot] button[data-primary]{background:var(--dc-accent);border-color:var(--dc-accent);color:#fff;font-weight:500;box-shadow:0 2px 10px var(--dc-glow)}',
      '[data-dc-foot] button[data-primary]:hover:not(:disabled){filter:brightness(1.08)}',
      '[data-dc-foot] button:disabled{opacity:.42;cursor:default}',

      // 右键菜单
      '[data-dc-menu]{position:fixed;z-index:10000;min-width:196px;padding:5px;border-radius:11px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));background:var(--dc-panel-bg);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);box-shadow:0 16px 44px rgba(0,0,0,.3);animation:dc-menu-in .13s ease-out}',
      '@keyframes dc-menu-in{from{opacity:0;transform:scale(.97) translateY(-3px)}to{opacity:1;transform:none}}',
      '[data-dc-menu] button{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;border-radius:7px;background:none;color:inherit;font-family:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '[data-dc-menu] button:hover{background:color-mix(in srgb, currentColor 8%, transparent)}',
      '[data-dc-menu] button[data-active]{color:var(--dc-accent);font-weight:500}',
      '[data-dc-menu] button[data-danger]{color:#e06a63}',
      '[data-dc-menu] .dc-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l3, rgba(128,128,128,.22))}',
      '[data-dc-menu] .dc-check{width:12px;flex:none;opacity:.9}',

      '[data-dc-spin]{animation:dc-spin 1s linear infinite;display:inline-flex}',
      '@keyframes dc-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){[data-dc-spin]{animation:none}}',

      // ── 设置页 ──
      '[data-dcs]{display:flex;flex-direction:column;gap:16px;max-width:620px;padding:2px 2px 28px;font-size:13px}',
      '[data-dcs] .dcs-intro{margin:0;font-size:12.5px;line-height:1.6;opacity:.62}',
      '[data-dcs] .dcs-card{border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.25));border-radius:12px;padding:14px 16px;background:color-mix(in srgb, currentColor 2.5%, transparent)}',
      '[data-dcs] .dcs-card>h4{margin:0 0 3px;font-size:12.5px;font-weight:600}',
      '[data-dcs] .dcs-desc{margin:0 0 11px;font-size:11.5px;line-height:1.55;opacity:.55}',
      '[data-dcs] .dcs-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px}',
      '[data-dcs] .dcs-mode{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3));background:transparent;color:inherit;font-family:inherit;cursor:pointer;text-align:left;transition:border-color .14s,background .14s}',
      '[data-dcs] .dcs-mode:hover{border-color:color-mix(in srgb, var(--dc-accent) 60%, transparent)}',
      '[data-dcs] .dcs-mode[data-active]{border-color:var(--dc-accent);background:color-mix(in srgb, var(--dc-accent) 9%, transparent)}',
      '[data-dcs] .dcs-mode .dcs-mode-name{font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px}',
      '[data-dcs] .dcs-mode .dcs-mode-desc{font-size:10.5px;line-height:1.45;opacity:.55}',
      '[data-dcs] .dcs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.14))}',
      '[data-dcs] .dcs-row:last-child{border-bottom:none;padding-bottom:0}',
      '[data-dcs] .dcs-row-main{min-width:0;flex:1}',
      '[data-dcs] .dcs-row-title{font-size:12.5px;font-weight:500}',
      '[data-dcs] .dcs-row-desc{font-size:11px;line-height:1.5;opacity:.5;margin-top:2px}',
      '[data-dcs] .dcs-row button{font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:transparent;color:inherit;font-family:inherit;cursor:pointer;white-space:nowrap}',
      '[data-dcs] .dcs-row button:hover{border-color:var(--dc-accent)}',
      '[data-dcs] .dcs-row button[data-primary]{background:var(--dc-accent);border-color:var(--dc-accent);color:#fff}',
      '[data-dcs] input[type="range"]{width:172px;accent-color:var(--dc-accent);cursor:pointer}',
      '[data-dcs] .dcs-opacity-val{font-size:11.5px;font-variant-numeric:tabular-nums;opacity:.6;min-width:42px;text-align:right}',
      '[data-dcs] .dcs-target{display:flex;align-items:center;gap:9px;padding:6px 0}',
      '[data-dcs] .dcs-target input{accent-color:var(--dc-accent);cursor:pointer}',
      '[data-dcs] .dcs-target-label{font-size:12px;flex:1}',
      '[data-dcs] .dcs-target-meta{font-size:10.5px;opacity:.45;font-variant-numeric:tabular-nums}',
      '[data-dcs] .dcs-switch{position:relative;width:38px;height:21px;flex:none;border-radius:999px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:color-mix(in srgb, currentColor 8%, transparent);cursor:pointer;transition:background .16s,border-color .16s;padding:0}',
      '[data-dcs] .dcs-switch::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:currentColor;opacity:.55;transition:transform .16s,opacity .16s}',
      '[data-dcs] .dcs-switch[data-on]{background:var(--dc-accent);border-color:var(--dc-accent)}',
      '[data-dcs] .dcs-switch[data-on]::after{transform:translateX(17px);background:#fff;opacity:1}',
      '[data-dcs] .dcs-final{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px}',
      '[data-dcs] .dcs-final button{font-size:11.5px;padding:5px 11px;border-radius:8px;border:1px solid color-mix(in srgb, #e06a63 45%, transparent);background:transparent;color:#e06a63;font-family:inherit;cursor:pointer}',
      '[data-dcs] .dcs-saved{font-size:11px;color:#3fa463;opacity:0;transition:opacity .2s}',
      '[data-dcs] .dcs-saved[data-show]{opacity:1}',
    ].join(String.fromCharCode(10))

    const injectCss = () => {
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        const existing = document.getElementById(STYLE_ID)
        if (existing !== null) existing.remove()
      }
    }

    /** 主题变量：面板底色由不透明度算出来，强调色沿用 DSH 的蓝色。 */
    function themeVars(opacity) {
      const alpha = Math.round(Math.min(1, Math.max(0.35, Number(opacity) || 0.82)) * 100)
      return {
        '--dc-accent': '#4a7dff',
        '--dc-glow': 'rgba(74,125,255,.28)',
        '--dc-surface': `color-mix(in srgb, var(--dsw-alias-bg-base, #fff) ${alpha}%, transparent)`,
        '--dc-surface-hover': `color-mix(in srgb, var(--dsw-alias-bg-base, #fff) ${Math.min(100, alpha + 10)}%, transparent)`,
        '--dc-panel-bg': `color-mix(in srgb, var(--dsw-alias-bg-base, #fff) ${alpha}%, transparent)`,
      }
    }

    // ── 图标 ────────────────────────────────────────────────────────────────

    function BrushIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M9.5 14.5 3 21' }),
        h('path', { d: 'M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L11 18l-4.2 1.2L8 15Z' }),
        h('path', { d: 'M15.5 5.5 18.5 8.5' })
      )
    }

    function Spinner() {
      return h('span', { 'data-dc-spin': '' }, h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2.4, strokeLinecap: 'round',
      }, h('path', { d: 'M12 3a9 9 0 1 0 9 9' })))
    }

    function CheckIcon() {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M20 6 9 17l-5-5' }))
    }

    function ModeGlyph(props) {
      const kind = props.kind
      if (kind === 'icon') {
        return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true' },
          h('circle', { cx: 12, cy: 12, r: 8 }))
      }
      if (kind === 'fixed') {
        return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
          h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3 }),
          h('path', { d: 'M14 3.5v4h6' }))
      }
      if (kind === 'rail') {
        return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': 'true' },
          h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3 }),
          h('path', { d: 'M16.5 3.5v17' }))
      }
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4' }),
        h('circle', { cx: 12, cy: 12, r: 4 }))
    }

    // ── 工具 ────────────────────────────────────────────────────────────────

    async function requestJson(path, init) {
      const response = await fetch('/dsh-cleaner' + path, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
      })
      const text = await response.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        body = { error: text }
      }
      if (!response.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
      return body
    }

    const viewport = () => ({
      w: typeof window === 'undefined' ? 1440 : window.innerWidth,
      h: typeof window === 'undefined' ? 900 : window.innerHeight,
    })

    /** 把坐标夹回视口内，避免拖到外面找不回来。 */
    function clampPosition(x, y, size) {
      const { w, hgt } = { w: viewport().w, hgt: viewport().h }
      const width = size && size.w ? size.w : 80
      const height = size && size.h ? size.h : 36
      return {
        x: Math.min(Math.max(4, x), Math.max(4, w - width - 4)),
        y: Math.min(Math.max(4, y), Math.max(4, hgt - height - 4)),
      }
    }

    function defaultPosition(shape) {
      const { w } = viewport()
      const width = shape === 'icon' ? 36 : 82
      return { x: Math.max(8, w - width - 18), y: 56 }
    }

    // ── 触发按钮 ────────────────────────────────────────────────────────────

    function Trigger(props) {
      const t = props.t
      const mode = props.mode
      const shape = mode === 'icon' || mode === 'rail' ? mode === 'rail' ? 'rail' : 'icon' : 'float'
      const draggable = mode === 'float' || mode === 'icon'
      const ref = React.useRef(null)
      const drag = React.useRef(null)

      const onPointerDown = (event) => {
        if (!draggable) return
        if (event.button !== 0) return
        const element = ref.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: rect.left,
          originY: rect.top,
          moved: false,
        }
        try {
          element.setPointerCapture(event.pointerId)
        } catch {
          /* 某些环境不支持捕获，靠 window 监听兜底 */
        }
      }

      const onPointerMove = (event) => {
        const state = drag.current
        if (state === null || state.pointerId !== event.pointerId) return
        const dx = event.clientX - state.startX
        const dy = event.clientY - state.startY
        if (!state.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        state.moved = true
        const element = ref.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        const next = clampPosition(state.originX + dx, state.originY + dy, { w: rect.width, h: rect.height })
        element.style.left = next.x + 'px'
        element.style.top = next.y + 'px'
        element.style.right = 'auto'
        element.style.transform = 'none'
        element.setAttribute('data-dragging', '')
      }

      const finishDrag = (event) => {
        const state = drag.current
        if (state === null) return
        if (state.pointerId !== event.pointerId) return
        drag.current = null
        const element = ref.current
        if (element === null) return
        element.removeAttribute('data-dragging')
        if (!state.moved) return
        const rect = element.getBoundingClientRect()
        const next = clampPosition(rect.left, rect.top, { w: rect.width, h: rect.height })
        void props.onMoved(next.x, next.y)
      }

      const style = {}
      if (mode === 'rail') {
        // rail 由 CSS 固定到右边缘，不需要坐标
      } else if (props.position !== null) {
        style.left = props.position.x + 'px'
        style.top = props.position.y + 'px'
      } else {
        const fallback = defaultPosition(shape)
        style.left = fallback.x + 'px'
        style.top = fallback.y + 'px'
      }

      return h('button', {
        ref: (node) => {
          ref.current = node
          // 面板定位要量这个按钮的真实矩形；display:contents 的包装元素量出来全是 0。
          if (props.anchorRef) props.anchorRef.current = node
        },
        type: 'button',
        'data-dc-btn': '',
        'data-shape': shape,
        'data-hint': props.hint ? '' : undefined,
        'data-busy': props.busy ? '' : undefined,
        style,
        title: t('button.hint'),
        'aria-label': t('button.title'),
        onPointerDown,
        onPointerMove,
        onPointerUp: finishDrag,
        onPointerCancel: finishDrag,
        onLostPointerCapture: finishDrag,
        onClick: (event) => {
          // 拖动结束时浏览器仍会派发 click，用它来判断是不是「真的点了一下」。
          if (event.detail === 0) return
          const state = drag.current
          if (state !== null && state.moved) return
          props.onActivate()
        },
        onContextMenu: (event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onMenu({ x: event.clientX, y: event.clientY })
        },
      },
        h('span', { 'data-dc-glyph': '' }, props.busy ? h(Spinner) : h(BrushIcon)),
        // float 和 rail 带文字；icon 只有图标（最省地方）。
        shape === 'icon' ? null : h('span', null, t('button.title'))
      )
    }

    // ── 右键菜单 ────────────────────────────────────────────────────────────

    function ContextMenu(props) {
      const t = props.t
      const ref = React.useRef(null)
      const [spot, setSpot] = React.useState(null)

      React.useEffect(() => {
        const element = ref.current
        if (element === null) {
          setSpot({ left: props.at.x, top: props.at.y })
          return
        }
        const rect = element.getBoundingClientRect()
        const { w, h: height } = viewport()
        setSpot({
          left: Math.min(props.at.x, Math.max(6, w - rect.width - 6)),
          top: Math.min(props.at.y, Math.max(6, height - rect.height - 6)),
        })
      }, [props.at])

      React.useEffect(() => {
        const close = () => props.onClose()
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('pointerdown', close, true)
        window.addEventListener('keydown', onKey)
        window.addEventListener('resize', close)
        return () => {
          window.removeEventListener('pointerdown', close, true)
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', close)
        }
      }, [props])

      const item = (label, onClick, options) => h('button', {
        key: label,
        type: 'button',
        'data-active': options && options.active ? '' : undefined,
        'data-danger': options && options.danger ? '' : undefined,
        onPointerDown: (event) => event.stopPropagation(),
        onClick: () => {
          props.onClose()
          onClick()
        },
      },
        h('span', { className: 'dc-check' }, options && options.active ? h(CheckIcon) : null),
        label
      )

      return h('div', {
        ref,
        'data-dc-menu': '',
        role: 'menu',
        style: spot === null ? { left: props.at.x, top: props.at.y, visibility: 'hidden' } : { left: spot.left, top: spot.top },
        onPointerDown: (event) => event.stopPropagation(),
        onContextMenu: (event) => event.preventDefault(),
      },
        item(t('menu.float'), () => props.onMode('float'), { active: props.mode === 'float' }),
        item(t('menu.icon'), () => props.onMode('icon'), { active: props.mode === 'icon' }),
        item(t('menu.fixed'), () => props.onMode('fixed'), { active: props.mode === 'fixed' }),
        item(t('menu.rail'), () => props.onMode('rail'), { active: props.mode === 'rail' }),
        h('div', { className: 'dc-sep', key: 'sep1' }),
        item(t('menu.rescan'), () => props.onCleanNow()),
        item(t('menu.settings'), () => props.onSettings()),
        h('div', { className: 'dc-sep', key: 'sep2' }),
        item(t('menu.hide'), () => props.onHide(), { danger: true })
      )
    }

    // ── 清理面板 ────────────────────────────────────────────────────────────

    function TargetRow(props) {
      const t = props.t
      const item = props.item
      const state = props.state || 'idle'
      return h('label', {
        'data-dc-row': '',
        'data-state': state,
        title: item.partial ? t('panel.sizeLower') : undefined,
      },
        h('input', {
          type: 'checkbox',
          checked: props.checked,
          disabled: props.busy,
          onChange: () => props.onToggle(item.id),
        }),
        h('div', { 'data-dc-text': '' },
          h('div', { 'data-dc-label': '' },
            h('span', null, item.label),
            item.defaultOn === false
              ? h('span', { 'data-dc-tag': '', 'data-optional': '' }, t('panel.optional'))
              : h('span', { 'data-dc-tag': '' }, t('panel.defaultOn'))
          ),
          h('div', { 'data-dc-note': '' }, item.note)
        ),
        h('div', { 'data-dc-size': '', 'data-lower': item.partial ? '' : undefined },
          formatBytes(item.bytes) + (item.partial ? '+' : '')),
        h('span', { 'data-dc-tick': '' }, h(CheckIcon))
      )
    }

    function Panel(props) {
      const t = props.t
      const [items, setItems] = React.useState([])
      const [disk, setDisk] = React.useState(null)
      const [phase, setPhase] = React.useState('idle')
      const [chosen, setChosen] = React.useState(() => new Set())
      const [message, setMessage] = React.useState('')
      const [messageKind, setMessageKind] = React.useState('ok')
      const [rowState, setRowState] = React.useState({})
      const [cleaningId, setCleaningId] = React.useState(null)
      const [progress, setProgress] = React.useState({ done: 0, total: 0 })
      const [freedSoFar, setFreedSoFar] = React.useState(0)
      const alive = React.useRef(true)
      const panelRef = React.useRef(null)
      const [spot, setSpot] = React.useState(null)
      const config = props.config
      const showEmpty = config && config.showEmpty === true

      React.useEffect(() => () => { alive.current = false }, [])

      // 面板定位：贴着按钮放，超出视口就翻到另一侧。
      const place = React.useCallback(() => {
        const element = panelRef.current
        if (element === null) return
        const anchor = props.anchor()
        const rect = element.getBoundingClientRect()
        const { w, h: height } = viewport()
        const gap = 8
        let left = anchor.right - rect.width
        let top = anchor.bottom + gap
        if (top + rect.height > height - 8) {
          const above = anchor.top - rect.height - gap
          top = above > 8 ? above : Math.max(8, height - rect.height - 8)
        }
        if (left < 8) left = 8
        if (left + rect.width > w - 8) left = Math.max(8, w - rect.width - 8)
        setSpot({ left, top })
      }, [props])

      React.useLayoutEffect(() => {
        place()
      }, [place, items.length, phase])

      React.useEffect(() => {
        const onResize = () => place()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [place])

      const applyScan = (data) => {
        if (!alive.current) return
        const list = Array.isArray(data.items) ? data.items : []
        // 0 字节的项默认不显示；有内容才列出来，避免面板每次都一大片。
        const visible = showEmpty ? list : list.filter((item) => Number(item.bytes) > 0)
        setItems(visible)
        setDisk(data.disk || null)
        setChosen(new Set(visible.filter((item) => item.defaultOn !== false).map((item) => item.id)))
        setPhase('ready')
      }

      const scan = React.useCallback(async (force) => {
        setPhase('scanning')
        setMessage('')
        try {
          const data = await requestJson('/scan' + (force ? '?force=1' : ''))
          applyScan(data)
          return data
        } catch (error) {
          if (!alive.current) return null
          setPhase('idle')
          setMessageKind('err')
          const text = String(error && error.message ? error.message : error)
          setMessage(/404/.test(text) ? t('panel.restart') : (text || t('panel.offline')))
          return null
        }
      }, [showEmpty, t])

      React.useEffect(() => {
        scan(false)
      }, [scan])

      const toggleOne = (id) => {
        setChosen((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const selectAll = (on) => {
        setChosen(on ? new Set(items.map((item) => item.id)) : new Set())
      }

      /**
       * 逐项清理：一次只清一项，前端知道「现在正在清哪一项」，
       * 于是能给出逐项的进度动画，而不是干等一个黑盒。
       *
       * 每项至少让「正在清理」这一帧亮 MIN_DWELL 毫秒：像 npm 缓存只有几 KB 时，
       * 删除本身是毫秒级的，如果不压住节奏，用户根本看不清到底清了哪一项。
       */
      const MIN_DWELL = 240
      const clean = async () => {
        const queue = items.filter((item) => chosen.has(item.id))
        if (queue.length === 0) return
        setPhase('cleaning')
        setMessage('')
        setRowState({})
        setFreedSoFar(0)
        setProgress({ done: 0, total: queue.length })

        let freedTotal = 0
        let skippedTotal = 0
        const states = {}
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index]
          const startedAt = Date.now()
          setCleaningId(item.id)
          states[item.id] = 'cleaning'
          setRowState({ ...states })
          setProgress({ done: index, total: queue.length })
          try {
            const result = await requestJson('/clean-item?id=' + encodeURIComponent(item.id), { method: 'POST' })
            freedTotal += Number(result.freed || 0)
            skippedTotal += Number(result.skipped || 0)
            setFreedSoFar(freedTotal)
          } catch {
            skippedTotal += 1
          }
          if (!alive.current) return
          // 补足最短停留时间，让这一项的状态变化真的被看见。
          const elapsed = Date.now() - startedAt
          if (elapsed < MIN_DWELL) {
            await new Promise((resolve) => setTimeout(resolve, MIN_DWELL - elapsed))
          }
          if (!alive.current) return
          states[item.id] = 'done'
          setRowState({ ...states })
          setProgress({ done: index + 1, total: queue.length })
          // 让「已完成」这一帧先画出来，动画才有节奏感。
          await new Promise((resolve) => setTimeout(resolve, 180))
          if (!alive.current) return
        }
        setCleaningId(null)

        const freedText = formatBytes(freedTotal)
        setMessageKind('ok')
        setMessage(freedTotal === 0 && skippedTotal === 0
          ? t('panel.nothing')
          : t('panel.done') + '：' + t('panel.freed') + ' ' + freedText +
            (skippedTotal > 0 ? ' · ' + skippedTotal + ' ' + t('panel.skipped') : ''))

        // 清理后重新统计；已完成的项淡出，剩下的重新出现。
        try {
          const refreshed = await requestJson('/scan?force=1')
          if (!alive.current) return
          applyScan(refreshed)
        } catch {
          if (!alive.current) return
          setPhase('ready')
        }
        setRowState({})
        setFreedSoFar(0)
        setProgress({ done: 0, total: 0 })
      }

      const busy = phase === 'scanning' || phase === 'cleaning'
      const totalSelected = items
        .filter((item) => chosen.has(item.id))
        .reduce((sum, item) => sum + Number(item.bytes || 0), 0)

      const groups = GROUP_ORDER
        .map((group) => ({ group, rows: items.filter((item) => item.group === group) }))
        .filter((entry) => entry.rows.length > 0)

      const diskLabel = disk && Number.isFinite(Number(disk.free))
        ? h('span', { 'data-dc-disk': '' }, t('panel.disk') + ' ', h('b', null, formatBytes(disk.free)))
        : null

      const primaryLabel = phase === 'cleaning'
        ? t('panel.cleaning') + ' ' + progress.done + '/' + progress.total +
          (freedSoFar > 0 ? ' · ' + formatBytes(freedSoFar) : '')
        : t('panel.clean') + (totalSelected > 0 ? ' · ' + formatBytes(totalSelected) : '')

      const body = phase === 'scanning' && items.length === 0
        ? h('div', { 'data-dc-group': '' }, t('panel.scanning'))
        : groups.length === 0
          ? h('div', { 'data-dc-group': '' }, t('panel.nothing'))
          : groups.map((entry) => h('div', { key: entry.group },
            h('div', { 'data-dc-group': '' }, t('group.' + entry.group)),
            entry.rows.map((item) => h(TargetRow, {
              key: item.id,
              t,
              item,
              checked: chosen.has(item.id),
              busy,
              state: rowState[item.id] || 'idle',
              onToggle: toggleOne,
            }))
          ))

      return h('div', {
        ref: panelRef,
        'data-dc-panel': '',
        role: 'dialog',
        'aria-label': t('panel.title'),
        style: spot === null
          ? { left: 0, top: 0, width: 400, visibility: 'hidden' }
          : { left: spot.left, top: spot.top, width: 400, maxHeight: 'min(78vh, 660px)' },
        onContextMenu: (event) => event.preventDefault(),
      },
        h('div', { 'data-dc-head': '' },
          h('h3', null, t('panel.title'), diskLabel),
          h('p', { 'data-dc-sub': '' }, t('panel.subtitle')),
          h('div', {
            'data-dc-total': '',
            'data-on': phase === 'cleaning' ? '' : undefined,
          }, h('i', { style: { width: progress.total > 0 ? Math.round((progress.done / progress.total) * 100) + '%' : '0%' } }))
        ),
        h('div', { 'data-dc-tools': '' },
          h('button', { type: 'button', disabled: busy || items.length === 0, onClick: () => selectAll(true) }, t('panel.selectAll')),
          h('button', { type: 'button', disabled: busy || chosen.size === 0, onClick: () => selectAll(false) }, t('panel.selectNone')),
          h('button', { type: 'button', disabled: busy, onClick: () => scan(true) }, t('panel.rescan')),
          h('span', { className: 'dc-total' }, phase === 'cleaning'
            ? progress.done + '/' + progress.total
            : formatBytes(totalSelected))
        ),
        h('div', { 'data-dc-body': '' }, body),
        h('div', { 'data-dc-msg': '', 'data-kind': messageKind }, message),
        h('div', { 'data-dc-foot': '' },
          h('span', { className: 'dc-hint' }, t('panel.safe')),
          h('button', {
            type: 'button',
            disabled: phase === 'cleaning',
            onClick: props.onClose,
          }, t('panel.close')),
          h('button', {
            type: 'button',
            'data-primary': '',
            disabled: busy || chosen.size === 0,
            onClick: clean,
          }, primaryLabel)
        )
      )
    }

    // ── 浮层根 ──────────────────────────────────────────────────────────────

    function CleanerOverlay(props) {
      const t = props.t
      const state = useStore()
      const config = state.config
      const [open, setOpen] = React.useState(false)
      const [menuAt, setMenuAt] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const triggerRef = React.useRef(null)
      const autoTried = React.useRef(false)

      // 首次拿到配置后：如果用户开了「自动展开」且确实有东西可清，才展开。
      React.useEffect(() => {
        if (config === null || autoTried.current) return
        autoTried.current = true
        if (config.autoExpand !== true) return
        let cancelled = false
        void (async () => {
          try {
            const data = await requestJson('/scan')
            if (cancelled) return
            const total = Number(data.totalBytes || 0)
            if (total > 0) setOpen(true)
          } catch {
            /* 自动展开失败就算了，用户点一下就是 */
          }
        })()
        return () => { cancelled = true }
      }, [config])

      if (config === null) return null
      if (state.hidden) return null

      const mode = config.mode || 'float'
      const position = config.x === null || config.y === null ? null : { x: config.x, y: config.y }
      const vars = themeVars(config.opacity)

      const anchor = () => {
        const element = triggerRef.current
        if (element === null) {
          const fallback = defaultPosition('float')
          return { left: fallback.x, top: fallback.y, right: fallback.x + 82, bottom: fallback.y + 34 }
        }
        const rect = element.getBoundingClientRect()
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      }

      const activate = () => {
        setMenuAt(null)
        setOpen((value) => !value)
      }

      return h('div', {
        'data-dc-root': '',
        'data-mode': mode,
        style: vars,
      },
        open ? h(Panel, {
          t,
          config,
          anchor,
          onClose: () => setOpen(false),
        }) : null,
        h(Trigger, {
            t,
            mode,
            position,
            busy,
            hint: !open,
            anchorRef: triggerRef,
            onActivate: activate,
            onMenu: (at) => setMenuAt(at),
            onMoved: (x, y) => { void state.save({ x, y }) },
          }),
        menuAt !== null ? h(ContextMenu, {
          t,
          at: menuAt,
          mode,
          onClose: () => setMenuAt(null),
          onMode: (next) => { void state.save({ mode: next }) },
          onHide: () => {
            setOpen(false)
            state.setHidden(true)
          },
          onCleanNow: () => setOpen(true),
          onSettings: () => {
            // DSH 的设置入口没有对外暴露的打开 API；给一句准确的指引。
            setOpen(true)
            setBusy(false)
          },
        }) : null
      )
    }

    // ── 设置页 ──────────────────────────────────────────────────────────────

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'dcs-switch',
        'data-on': props.value ? '' : undefined,
        role: 'switch',
        'aria-checked': props.value ? 'true' : 'false',
        onClick: () => props.onChange(!props.value),
      })
    }

    function SettingsPage(props) {
      const t = props.t
      const state = useStore()
      const config = state.config
      const [targets, setTargets] = React.useState(null)
      const [savedFlash, setSavedFlash] = React.useState(false)

      React.useEffect(() => {
        if (config !== null) return
        void state.load()
      }, [config, state])

      React.useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const data = await requestJson('/scan')
            if (!cancelled) setTargets(Array.isArray(data.items) ? data.items : [])
          } catch {
            if (!cancelled) setTargets([])
          }
        })()
        return () => { cancelled = true }
      }, [])

      const flash = () => {
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1400)
      }

      const save = (patch) => {
        void state.save(patch).then((ok) => { if (ok) flash() })
      }

      if (config === null) return h('div', { 'data-dcs': '' }, h('p', { className: 'dcs-intro' }, t('set.loading')))

      const vars = themeVars(config.opacity)
      const disabled = new Set(Array.isArray(config.disabled) ? config.disabled : [])
      const modeList = [
        { id: 'float', label: t('set.mode.float'), desc: t('set.mode.float.desc') },
        { id: 'icon', label: t('set.mode.icon'), desc: t('set.mode.icon.desc') },
        { id: 'fixed', label: t('set.mode.fixed'), desc: t('set.mode.fixed.desc') },
        { id: 'rail', label: t('set.mode.rail'), desc: t('set.mode.rail.desc') },
      ]

      const row = (title, desc, control) => h('div', { className: 'dcs-row' },
        h('div', { className: 'dcs-row-main' },
          h('div', { className: 'dcs-row-title' }, title),
          h('div', { className: 'dcs-row-desc' }, desc)
        ),
        control
      )

      const targetRows = (targets || []).map((item) => {
        const on = !disabled.has(item.id)
        return h('label', { className: 'dcs-target', key: item.id },
          h('input', {
            type: 'checkbox',
            checked: on,
            onChange: () => {
              const next = new Set(disabled)
              if (on) next.add(item.id)
              else next.delete(item.id)
              save({ disabled: [...next] })
            },
          }),
          h('span', { className: 'dcs-target-label' }, item.label),
          h('span', { className: 'dcs-target-meta' },
            Number(item.bytes) > 0 ? formatBytes(item.bytes) : t('set.target.empty'))
        )
      })

      return h('div', { 'data-dcs': '', style: vars },
        h('p', { className: 'dcs-intro' }, t('set.desc')),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.mode')),
          h('div', { className: 'dcs-modes' },
            modeList.map((mode) => h('button', {
              key: mode.id,
              type: 'button',
              className: 'dcs-mode',
              'data-active': config.mode === mode.id ? '' : undefined,
              onClick: () => save({ mode: mode.id }),
            },
              h('span', { className: 'dcs-mode-name' },
                h('span', { style: { display: 'inline-flex', width: 13, height: 13 } }, h(ModeGlyph, { kind: mode.id })),
                mode.label),
              h('span', { className: 'dcs-mode-desc' }, mode.desc)
            ))
          )
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.position')),
          h('p', { className: 'dcs-desc' }, t('set.position.desc')),
          row(
            t('set.position.value'),
            config.x === null || config.y === null ? '—' : Math.round(config.x) + ', ' + Math.round(config.y),
            h('button', {
              type: 'button',
              onClick: () => save({ x: null, y: null }),
            }, t('set.position.reset'))
          )
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.opacity')),
          h('p', { className: 'dcs-desc' }, t('set.opacity.desc')),
          h('div', { className: 'dcs-row' },
            h('div', { className: 'dcs-row-main' },
              h('input', {
                type: 'range',
                min: 35,
                max: 100,
                step: 1,
                value: Math.round(config.opacity * 100),
                onChange: (event) => save({ opacity: Number(event.target.value) / 100 }),
              })
            ),
            h('span', { className: 'dcs-opacity-val' }, Math.round(config.opacity * 100) + '%')
          )
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.visibility')),
          h('p', { className: 'dcs-desc' }, t('set.visibility.desc')),
          h('div', { className: 'dcs-row' },
            h('div', { className: 'dcs-row-main' },
              h('div', { className: 'dcs-row-title' }, state.hidden ? t('set.visibility.off') : t('set.visibility.on'))
            ),
            h('button', {
              type: 'button',
              'data-primary': state.hidden ? '' : undefined,
              onClick: () => state.setHidden(false),
            }, t('menu.show'))
          )
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.behavior')),
          row(t('set.autoExpand'), t('set.autoExpand.desc'),
            h(Switch, { value: config.autoExpand === true, onChange: (value) => save({ autoExpand: value }) })),
          row(t('set.showEmpty'), t('set.showEmpty.desc'),
            h(Switch, { value: config.showEmpty === true, onChange: (value) => save({ showEmpty: value }) }))
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.targets')),
          h('p', { className: 'dcs-desc' }, t('set.targets.desc')),
          targetRows
        ),

        h('div', { className: 'dcs-final' },
          h('button', {
            type: 'button',
            onClick: () => {
              if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('set.reset.confirm'))) return
              void fetch('/dsh-cleaner/config', { method: 'DELETE', cache: 'no-store', credentials: 'same-origin' })
                .then((response) => response.json())
                .then((body) => {
                  if (body && body.config) state.setConfig(body.config)
                  flash()
                })
                .catch(() => {})
            },
          }, t('set.reset')),
          h('span', { className: 'dcs-saved', 'data-show': savedFlash ? '' : undefined }, t('set.saved'))
        )
      )
    }

    // ── 接线 ────────────────────────────────────────────────────────────────

    let localeCtx = null
    let locale = 'zh'

    function translator() {
      try {
        const service = localeCtx && localeCtx.locale
        if (service && typeof service === 'object') {
          if (typeof service.current === 'string' && service.current !== '') locale = service.current
          else if (typeof service.locale === 'string' && service.locale !== '') locale = service.locale
          else if (typeof service.resolve === 'function') locale = service.resolve() || 'zh'
        }
      } catch {
        /* 保持默认 */
      }
      const dictionary = LEX[locale] || LEX.zh
      return (key) => dictionary[key] || LEX.zh[key] || key
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      localeCtx = ctx
      const t = translator()
      const disposeCss = injectCss()
      ctx.effect(() => disposeCss, 'dsh-cleaner: styles')
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, LEX), 'dsh-cleaner: locale dictionaries')
      }

      // 共享配置在浮层和设置页都会用到，启动时读一次即可。
      void store.load()

      const Overlay = () => h(CleanerOverlay, { t })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-cleaner.floating',
        order: 90,
        locale: NS,
      }, Overlay))

      const Settings = () => {
        React.useEffect(() => {
          if (store.config === null) void store.load()
        }, [])
        return h(SettingsPage, { t })
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-cleaner',
        order: 47,
        label: () => t('set.title'),
        locale: NS,
      }, Settings))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'dsh-cleaner',
        order: 47,
        label: () => t('set.title'),
      }, function SettingsIcon() {
        return h('span', { style: { display: 'inline-flex', width: '1em', height: '1em' } }, h(BrushIcon))
      }))
    }

    exports.apply = apply
    exports.inject = inject
    exports.__internals = { LEX, formatBytes, themeVars, clampPosition, store }
    return module.exports
  },
})
