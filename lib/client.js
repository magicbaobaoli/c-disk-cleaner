/**
 * dsh-cleaner — 浏览器半边（显示名 C Disk Cleaner）
 *
 * 右上角一枚小垃圾桶按钮，随时可以点一下清缓存：
 *   - 可拖动（位置记住），可钉死、可变成纯图标、可贴右边缘
 *   - 右键出快捷菜单：形态切换 / 立即清理 / 设置 / 隐藏
 *   - 清理时按钮周围亮红光；清完转绿光并闪 5 下提醒
 *   - 面板从按钮「蹦」出来；拖动按钮时面板实时跟随
 *   - 关闭面板不影响清理：清理任务在模块级状态里跑，后台继续
 *   - 清完自动回到按钮旁显示结果
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
    /** 名字只影响界面与市场展示；包名保持 dsh-cleaner，否则 profile 接线会断。 */
    const DISPLAY_NAME = 'C Disk Cleaner'
    const MODES = ['float', 'icon', 'fixed', 'rail']

    // ── 文案 ────────────────────────────────────────────────────────────────
    const LEX = {
      zh: {
        'app.name': DISPLAY_NAME,
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
        'panel.bgHint': '关闭面板不会中断清理，会一直在后台跑完。',
        'panel.safe': '白名单路径，删前逐条校验',
        'panel.retry': '重试',
        'panel.restart': '面板已更新，但宿主还是旧版本。完全退出 DSH 再打开一次。',
        'panel.offline': '拿不到宿主响应，稍后再试。',
        'panel.runningOther': '正在清理中，完成后会告诉你结果。',
        'group.dsh': 'DSH 自身',
        'group.dev': '开发工具缓存',
        'group.system': '系统与其它软件',
        'menu.float': '可拖动的按钮',
        'menu.icon': '变成纯图标',
        'menu.fixed': '固定在右上角',
        'menu.rail': '贴到右边缘',
        'menu.rescan': '立即统计并清理',
        'menu.hide': '隐藏（重启 DSH 后回来）',
        'menu.settings': '设置…',
        'menu.show': '显示按钮',
        'menu.title': '清理缓存选项',
        'set.title': '缓存清理',
        'set.desc': 'C Disk Cleaner 一直在等你按。下面这些都能改，改完立刻生效。',
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
        'set.anchored': '按钮居中',
        'set.anchored.desc': '钉在窗口正中。想自己摆位置就关掉它，然后直接拖动按钮。',
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
        'app.name': DISPLAY_NAME,
        'button.title': 'Clean',
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
        'panel.bgHint': 'Closing this panel does not stop cleaning — it keeps going in the background.',
        'panel.safe': 'Whitelisted paths, re-checked before every delete',
        'panel.retry': 'Retry',
        'panel.restart': 'The panel updated but the host is still the old build. Quit DSH completely and reopen it.',
        'panel.offline': 'No response from the host. Try again shortly.',
        'panel.runningOther': 'Cleaning in progress — the result will pop up when it finishes.',
        'group.dsh': 'DSH itself',
        'group.dev': 'Developer caches',
        'group.system': 'System and other apps',
        'menu.float': 'Draggable button',
        'menu.icon': 'Compact icon only',
        'menu.fixed': 'Pin to top-right',
        'menu.rail': 'Dock to right edge',
        'menu.rescan': 'Scan and clean now',
        'menu.hide': 'Hide (back after DSH restarts)',
        'menu.settings': 'Settings…',
        'menu.show': 'Show button',
        'menu.title': 'Cache cleaner options',
        'set.title': 'Cache cleaner',
        'set.desc': 'C Disk Cleaner waits here for you. Everything below takes effect immediately.',
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
        'set.anchored': 'Center the button',
        'set.anchored.desc': 'Pin it to the middle of the window. Turn this off to place it yourself by dragging.',
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

    const formatBytes = (bytes) => {
      const n = Number(bytes)
      if (!Number.isFinite(n) || n <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
      const value = n / Math.pow(1024, index)
      return (index === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[index]
    }

    // ── 共享状态 ────────────────────────────────────────────────────────────

    function createEmitter() {
      const listeners = new Set()
      return {
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        notify() {
          for (const fn of [...listeners]) {
            try { fn() } catch { /* 单个订阅者出错不影响别人 */ }
          }
        },
      }
    }

    const configStore = {
      config: null,
      hidden: false,
      ...createEmitter(),
      setConfig(next) { this.config = next; this.notify() },
      setHidden(value) {
        this.hidden = value
        try { window.sessionStorage.setItem(HIDE_KEY, value ? '1' : '0') } catch { /* 隐私模式 */ }
        this.notify()
      },
      async load() {
        try { this.hidden = window.sessionStorage.getItem(HIDE_KEY) === '1' } catch { this.hidden = false }
        try {
          const response = await fetch('/dsh-cleaner/config', { cache: 'no-store', credentials: 'same-origin' })
          const body = await response.json()
          this.setConfig(body.config)
        } catch {
          this.setConfig({ mode: 'float', x: null, y: null, opacity: 0.82, showEmpty: false, autoExpand: false, anchored: true, disabled: [] })
        }
      },
      async save(patch) {
        // 先本地生效（点击立刻有反馈），再落盘；失败就回滚到服务器那份。
        this.setConfig({ ...(this.config || {}), ...patch })
        try {
          const response = await fetch('/dsh-cleaner/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
            cache: 'no-store',
            credentials: 'same-origin',
          })
          const body = await response.json()
          if (body && body.config) this.setConfig(body.config)
          return true
        } catch {
          try {
            const body = await (await fetch('/dsh-cleaner/config', { cache: 'no-store', credentials: 'same-origin' })).json()
            this.setConfig(body.config)
          } catch { /* 拿不回来就保持乐观值 */ }
          return false
        }
      },
    }

    /**
     * 清理任务。
     *
     * 关键：它活在模块作用域，**不属于面板组件**。面板关掉、被卸载，
     * 这个任务照样一项一项往下跑 —— 用户点掉窗口不会中断清理。
     * 面板只是它的一个订阅者。
     */
    const job = {
      phase: 'idle', // idle | running | done
      total: 0,
      done: 0,
      freed: 0,
      skipped: 0,
      rows: {}, // id -> { label, bytes, state: 'pending'|'cleaning'|'done' }
      message: '',
      messageKind: 'ok',
      /** 完成后的绿光闪烁窗口：这段时间内按钮亮绿。 */
      celebrateUntil: 0,
      autoShowAt: 0,
      ...createEmitter(),

      get running() { return this.phase === 'running' },
      /**
       * 总进度 0..1。
       *
       * 注意不能只写 done/total：只有一项要清时，done 在整段清理里一直是 0，
       * 火箭就会停在起点一动不动（用户看到的就是「火箭不动」）。
       * 所以把「正在清的这一项」算成半格：开跑先给 0.5 格，跑完给满格。
       */
      get progress() {
        if (this.total <= 0) return 0
        const finished = Math.min(this.done, this.total)
        return Math.min(1, (finished + (this.phase === 'running' ? 0.5 : 0)) / this.total)
      },

      reset() {
        this.phase = 'idle'
        this.total = 0
        this.done = 0
        this.freed = 0
        this.skipped = 0
        this.rows = {}
        this.message = ''
        this.messageKind = 'ok'
        this.autoShowAt = 0
        this.notify()
      },

      /** 逐项清理：一次一项，前端因此能准确显示「正在清哪一项」。 */
      async run(queue, t) {
        if (this.phase === 'running') return
        this.phase = 'running'
        this.total = queue.length
        this.done = 0
        this.freed = 0
        this.skipped = 0
        this.message = ''
        this.messageKind = 'ok'
        this.rows = {}
        for (const item of queue) this.rows[item.id] = { label: item.label, bytes: item.bytes, state: 'pending' }
        this.notify()

        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index]
          const startedAt = Date.now()
          this.rows[item.id] = { ...this.rows[item.id], state: 'cleaning' }
          this.notify()
          try {
            const result = await requestJson('/clean-item?id=' + encodeURIComponent(item.id), { method: 'POST' })
            this.freed += Number(result.freed || 0)
            this.skipped += Number(result.skipped || 0)
            this.rows[item.id] = { ...this.rows[item.id], state: 'done', freed: Number(result.freed || 0) }
          } catch {
            this.skipped += 1
            this.rows[item.id] = { ...this.rows[item.id], state: 'done', freed: 0 }
          }
          this.done = index + 1
          // 每项至少亮 240ms：几 KB 的小项删除是毫秒级的，不压节奏根本看不清。
          const elapsed = Date.now() - startedAt
          if (elapsed < 240) await new Promise((resolve) => setTimeout(resolve, 240 - elapsed))
          this.notify()
        }

        this.phase = 'done'
        this.message = this.freed === 0 && this.skipped === 0
          ? t('panel.nothing')
          : t('panel.done') + '：' + t('panel.freed') + ' ' + formatBytes(this.freed) +
            (this.skipped > 0 ? ' · ' + this.skipped + ' ' + t('panel.skipped') : '')
        this.messageKind = 'ok'
        // 绿光闪 5 下（约 2.6s），之后恢复常态。
        this.celebrateUntil = Date.now() + 2600
        // 给浮层一个「把面板拉出来」的窗口，让用户看到结果。
        this.autoShowAt = Date.now() + 3000
        this.notify()
        setTimeout(() => { this.celebrateUntil = 0; this.notify() }, 2700)
      },
    }

    const useStore = (store) => {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((value) => value + 1)), [store])
      return store
    }

    // ── 主题 ────────────────────────────────────────────────────────────────

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

    /** 垃圾桶：最直白地表达「清理」。 */
    function TrashIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.85,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M4 6.5h16' }),
        h('path', { d: 'M9.5 6.5V4.8c0-.72.58-1.3 1.3-1.3h2.4c.72 0 1.3.58 1.3 1.3v1.7' }),
        h('path', { d: 'M6.2 6.5l.85 12.1c.05.78.7 1.4 1.49 1.4h6.92c.79 0 1.44-.62 1.49-1.4l.85-12.1' }),
        h('path', { d: 'M10.2 10.5v6M13.8 10.5v6' })
      )
    }

    function Spinner() {
      return h('span', { 'data-dc-spin': '' }, h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2.4, strokeLinecap: 'round',
      }, h('path', { d: 'M12 3a9 9 0 1 0 9 9' })))
    }

    function CheckIcon() {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M20 6 9 17l-5-5' }))
    }

    /** 小火箭（带火焰），用于面板外框的总进度。 */
    function RocketIcon() {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M12 2.6c2.6 2.2 3.9 5.1 3.9 8.6 0 1.9-.5 3.7-1.4 5.3H9.5A11 11 0 0 1 8.1 11.2c0-3.5 1.3-6.4 3.9-8.6Z',
          fill: 'currentColor', opacity: '.92',
        }),
        h('circle', { cx: 12, cy: 9.2, r: 1.55, fill: 'var(--dc-panel-bg, #fff)' }),
        h('path', { d: 'M9.4 14.6 7.1 17.2l1-3.1M14.6 14.6l2.3 2.6-1-3.1', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        // 火焰
        h('path', { className: 'dc-flame', d: 'M12 16.2c1.15 1.15 1.7 2.2 1.7 3.15 0 1.2-.76 2.05-1.7 2.05s-1.7-.85-1.7-2.05c0-.95.55-2 1.7-3.15Z', fill: '#ff6b3d' })
      )
    }

    function ModeGlyph(props) {
      const kind = props.kind
      const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true' }
      if (kind === 'icon') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8 }))
      if (kind === 'fixed') {
        return h('svg', { ...common, strokeLinecap: 'round' }, h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3 }), h('path', { d: 'M14 3.5v4h6' }))
      }
      if (kind === 'rail') {
        return h('svg', { ...common, strokeLinecap: 'round' }, h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3 }), h('path', { d: 'M16.5 3.5v17' }))
      }
      return h('svg', { ...common, strokeLinecap: 'round' }, h('path', { d: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4' }), h('circle', { cx: 12, cy: 12, r: 4 }))
    }

    // ── 工具 ────────────────────────────────────────────────────────────────

    async function requestJson(path, init) {
      const response = await fetch('/dsh-cleaner' + path, { cache: 'no-store', credentials: 'same-origin', ...init })
      const text = await response.text()
      let body
      try { body = JSON.parse(text) } catch { body = { error: text } }
      if (!response.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
      return body
    }

    const viewport = () => ({
      w: typeof window === 'undefined' ? 1440 : window.innerWidth,
      h: typeof window === 'undefined' ? 900 : window.innerHeight,
    })

    function clampPosition(x, y, size) {
      const { w, h: height } = viewport()
      const width = size && size.w ? size.w : 80
      const height2 = size && size.h ? size.h : 36
      return {
        x: Math.min(Math.max(4, x), Math.max(4, w - width - 4)),
        y: Math.min(Math.max(4, y), Math.max(4, height - height2 - 4)),
      }
    }

    function defaultPosition(shape) {
      const { w } = viewport()
      const width = shape === 'icon' ? 36 : 92
      return { x: Math.max(8, w - width - 18), y: 56 }
    }

    // ── 样式 ────────────────────────────────────────────────────────────────

    const CSS = [
      '[data-dc-root]{position:fixed;inset:0;z-index:9999;pointer-events:none}',
      '[data-dc-root]>*{pointer-events:auto}',

      // 按钮本体
      '[data-dc-btn]{position:absolute;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:var(--dc-surface);color:inherit;cursor:pointer;backdrop-filter:blur(14px) saturate(1.4);-webkit-backdrop-filter:blur(14px) saturate(1.4);box-shadow:0 2px 12px rgba(0,0,0,.14);font-size:12px;font-weight:500;font-family:inherit;transition:background .16s,border-color .16s,box-shadow .16s,transform .16s;touch-action:none;user-select:none}',
      '[data-dc-btn]:hover{background:var(--dc-surface-hover);border-color:var(--dc-accent);box-shadow:0 4px 18px rgba(0,0,0,.2)}',
      '[data-dc-btn]:active{transform:scale(.97)}',
      '[data-dc-btn][data-dragging]{cursor:grabbing;box-shadow:0 10px 28px rgba(0,0,0,.3);transition:none}',
      '[data-dc-btn][data-busy]{cursor:progress}',
      '[data-dc-btn] [data-dc-glyph]{display:inline-flex;width:16px;height:16px;flex:none}',
      '[data-dc-btn] svg{width:100%;height:100%;display:block}',
      '[data-dc-btn][data-shape="icon"]{width:36px;height:36px;padding:0;border-radius:50%;justify-content:center}',
      '[data-dc-btn][data-shape="icon"] [data-dc-glyph]{width:17px;height:17px}',
      '[data-dc-btn][data-shape="rail"]{right:0;top:50%;transform:translateY(-50%);left:auto;width:26px;height:auto;min-height:96px;padding:12px 0;border-radius:12px 0 0 12px;border-right:none;writing-mode:vertical-rl;letter-spacing:.14em;font-size:10.5px;flex-direction:column;gap:8px}',
      '[data-dc-btn][data-shape="rail"]:active{transform:translateY(-50%) scale(.97)}',

      // 氛围灯：清理中红光呼吸，完成后绿光 + 闪 5 下
      '@keyframes dc-red-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,74,58,.55),0 2px 12px rgba(0,0,0,.16)}50%{box-shadow:0 0 0 9px rgba(255,74,58,0),0 2px 22px rgba(255,74,58,.5)}}',
      '[data-dc-btn][data-glow]{will-change:box-shadow}',
      '[data-dc-btn][data-glow="red"]{border-color:rgba(255,90,70,.85);animation:dc-red-pulse 1.5s ease-in-out infinite}',
      '[data-dc-btn][data-glow="red"] [data-dc-glyph]{color:#ff5a46}',
      '@keyframes dc-green-blink{0%,100%{box-shadow:0 0 0 0 rgba(58,214,130,0),0 2px 12px rgba(0,0,0,.14)}45%{box-shadow:0 0 0 8px rgba(58,214,130,.32),0 2px 22px rgba(58,214,130,.75)}}',
      '[data-dc-btn][data-glow="green"]{border-color:rgba(58,214,130,.9);animation:dc-green-blink .52s ease-in-out 5}',
      '[data-dc-btn][data-glow="green"] [data-dc-glyph]{color:#3ad682}',
      '@keyframes dc-breathe{0%,100%{box-shadow:0 2px 12px rgba(0,0,0,.14)}50%{box-shadow:0 2px 18px var(--dc-glow)}}',
      '[data-dc-btn][data-hint]:not([data-glow]){animation:dc-breathe 3.4s ease-in-out infinite}',

      // 面板
      '[data-dc-panel]{position:fixed;display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));background:var(--dc-panel-bg);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);color:inherit;box-shadow:0 20px 60px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.04) inset;overflow:hidden}',
      // 只做透明度渐变：不做位移/缩放，避免「从某个方向飞出来」的观感。
      '@keyframes dc-fade-in{from{opacity:0}to{opacity:1}}',
      '[data-dc-panel][data-anim="in"]{animation:dc-fade-in .12s ease-out}',
      '@keyframes dc-fade-out{to{opacity:0}}',
      '[data-dc-panel][data-anim="out"]{animation:dc-fade-out .1s ease-in forwards}',

      '[data-dc-head]{padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.18));position:relative}',
      '[data-dc-head] h3{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '[data-dc-disk]{font-size:11.5px;font-weight:500;opacity:.8;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '[data-dc-disk] b{font-weight:600;opacity:1}',
      '[data-dc-sub]{margin:5px 0 0;font-size:11px;line-height:1.5;opacity:.55}',

      '[data-dc-tools]{display:flex;align-items:center;gap:12px;padding:9px 16px 3px;font-size:11px}',
      '[data-dc-tools] button{background:none;border:none;padding:0;color:inherit;font-family:inherit;font-size:11px;opacity:.5;cursor:pointer;transition:opacity .12s}',
      '[data-dc-tools] button:hover:not(:disabled){opacity:.95}',
      '[data-dc-tools] button:disabled{opacity:.22;cursor:default}',
      '[data-dc-tools] .dc-total{margin-left:auto;opacity:.5;font-variant-numeric:tabular-nums}',

      '[data-dc-body]{padding:4px 6px 6px;overflow:auto;flex:1;min-height:44px;position:relative}',
      '[data-dc-group]{font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.38;padding:9px 10px 3px}',

      // 行
      '[data-dc-row]{position:relative;display:flex;align-items:flex-start;gap:9px;padding:7px 10px;border-radius:10px;cursor:pointer;transition:background .13s,opacity .3s,transform .3s;overflow:hidden}',
      '[data-dc-row]:hover{background:color-mix(in srgb, currentColor 6%, transparent)}',
      '[data-dc-row] input{position:relative;z-index:1;margin:2px 0 0;flex:none;accent-color:var(--dc-accent);cursor:inherit}',
      '[data-dc-text]{position:relative;z-index:1;flex:1;min-width:0}',
      '[data-dc-label]{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;line-height:1.35}',
      '[data-dc-tag]{font-size:9px;font-weight:600;padding:1px 5px;border-radius:5px;background:color-mix(in srgb, currentColor 11%, transparent);opacity:.62;flex:none}',
      '[data-dc-tag][data-optional]{opacity:.4}',
      '[data-dc-note]{font-size:10.5px;line-height:1.45;opacity:.5;margin-top:1px;overflow-wrap:anywhere}',
      '[data-dc-size]{position:relative;z-index:1;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.85;padding-top:1px;flex:none;transition:opacity .3s}',
      '[data-dc-size][data-lower]{text-decoration:underline dotted;opacity:.6}',

      // 正在清的行：陨石从左向右飞过（拖尾）
      '[data-dc-row][data-state="cleaning"]{background:color-mix(in srgb, #ff5a46 12%, transparent)}',
      '[data-dc-row][data-state="cleaning"]::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent 0%,rgba(255,120,80,.16) 45%,transparent 100%);animation:dc-row-sheen 1.1s linear infinite}',
      '@keyframes dc-row-sheen{0%{transform:translateX(-60%)}100%{transform:translateX(60%)}}',
      '.dc-meteor{position:absolute;left:0;top:0;bottom:0;width:100%;pointer-events:none;overflow:hidden;z-index:0}',
      '.dc-meteor i{position:absolute;top:50%;left:0;width:7px;height:7px;margin-top:-3.5px;border-radius:50%;background:#ff7a4d;box-shadow:0 0 8px 2px rgba(255,110,60,.75);will-change:transform,opacity;animation:dc-meteor-fly .95s cubic-bezier(.35,0,.65,1) infinite}',
      '.dc-meteor i::before{content:"";position:absolute;right:100%;top:50%;transform:translateY(-50%);width:46px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(255,140,90,.85))}',
      '@keyframes dc-meteor-fly{0%{transform:translate3d(-12px,0,0);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translate3d(calc(var(--dc-row-w, 320px) + 12px),0,0);opacity:0}}',
      '[data-dc-row][data-state="done"]{opacity:0;transform:translateX(10px);pointer-events:none}',
      '[data-dc-tick]{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:#3ad682;opacity:0;z-index:1}',
      '[data-dc-row][data-state="done"] [data-dc-tick]{opacity:1}',
      '[data-dc-row][data-state="done"] [data-dc-size]{opacity:0}',

      // 面板外框：火箭绕一圈（4 段，每段 25%）
      '.dc-orbit{position:absolute;inset:0;pointer-events:none;z-index:5;border-radius:16px;overflow:hidden;opacity:0;transition:opacity .25s}',
      '[data-dc-panel][data-cleaning] .dc-orbit{opacity:1}',
      // 面板外圈：走过的部分亮起来，一眼能看出总进度到哪了。
      ".dc-ring{position:absolute;inset:0;border-radius:16px;pointer-events:none;z-index:4;opacity:0;transition:opacity .25s;background:conic-gradient(from 0deg, rgba(255,122,77,.95) calc(var(--dc-ring,0) * 1turn), rgba(255,122,77,.10) 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:2px;contain:paint}",
      '[data-dc-panel][data-cleaning] .dc-ring{opacity:1}',
      '.dc-orbit .dc-rocket{position:absolute;left:0;top:0;width:16px;height:16px;will-change:transform;color:#ff7a4d;filter:drop-shadow(0 0 6px rgba(255,110,60,.85));transform:translate3d(0,0,0)}',
      '.dc-orbit .dc-rocket svg{width:100%;height:100%;overflow:visible}',
      '@keyframes dc-flame-flicker{0%,100%{transform:scaleY(.9) scaleX(1);opacity:.9}35%{transform:scaleY(1.3) scaleX(.9);opacity:1}70%{transform:scaleY(1.05) scaleX(1.08);opacity:.75}}',
      '.dc-orbit .dc-flame{transform-origin:12px 16px;animation:dc-flame-flicker .22s ease-in-out infinite;will-change:transform,opacity}',
      // 剩下的进度条也画在边上，让「还剩多少」不用看数字
      '.dc-orbit .dc-trail{position:absolute;inset:0;border-radius:16px;border:2px solid transparent;background:linear-gradient(90deg,rgba(255,122,77,.55),rgba(255,122,77,.15)) border-box;-webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:.5}',

      '[data-dc-msg]{padding:0 16px;font-size:11.5px;line-height:1.5;color:#3ad682;overflow-wrap:anywhere}',
      '[data-dc-msg][data-kind="err"]{color:#e06a63}',
      '[data-dc-msg]:not(:empty){padding:9px 16px 0}',

      '[data-dc-foot]{display:flex;align-items:center;gap:8px;padding:12px 16px 14px;position:relative;z-index:6}',
      '[data-dc-foot] .dc-hint{font-size:10px;opacity:.36;flex:1;line-height:1.4}',
      '[data-dc-foot] button{font-size:12px;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4));background:transparent;color:inherit;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,border-color .14s,transform .1s}',
      '[data-dc-foot] button:hover:not(:disabled){border-color:var(--dc-accent)}',
      '[data-dc-foot] button:active:not(:disabled){transform:scale(.97)}',
      '[data-dc-foot] button[data-primary]{background:var(--dc-accent);border-color:var(--dc-accent);color:#fff;font-weight:500;box-shadow:0 2px 10px var(--dc-glow)}',
      '[data-dc-foot] button[data-primary]:hover:not(:disabled){filter:brightness(1.08)}',
      '[data-dc-foot] button:disabled{opacity:.42;cursor:default}',

      // 右键菜单
      '[data-dc-menu]{position:fixed;z-index:10000;min-width:208px;padding:5px;border-radius:11px;border:1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));background:var(--dc-panel-bg);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);box-shadow:0 16px 44px rgba(0,0,0,.3);animation:dc-menu-in .13s ease-out}',
      '@keyframes dc-menu-in{from{opacity:0;transform:scale(.97) translateY(-3px)}to{opacity:1;transform:none}}',
      '[data-dc-menu] button{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;border-radius:7px;background:none;color:inherit;font-family:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '[data-dc-menu] button:hover{background:color-mix(in srgb, currentColor 8%, transparent)}',
      '[data-dc-menu] button[data-active]{color:var(--dc-accent);font-weight:500}',
      '[data-dc-menu] button[data-danger]{color:#e06a63}',
      '[data-dc-menu] .dc-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l3, rgba(128,128,128,.22))}',
      '[data-dc-menu] .dc-check{width:12px;flex:none;opacity:.9}',

      '[data-dc-spin]{animation:dc-spin 1s linear infinite;display:inline-flex}',
      '@keyframes dc-spin{to{transform:rotate(360deg)}}',

      // 设置页
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
      '[data-dcs] .dcs-saved{font-size:11px;color:#3ad682;opacity:0;transition:opacity .2s}',
      '[data-dcs] .dcs-saved[data-show]{opacity:1}',

      // 动效偏好
      '@media (prefers-reduced-motion: reduce){',
      '[data-dc-panel][data-anim]{animation:none!important}',
      '[data-dc-btn][data-glow]{animation:none!important}',
      '[data-dc-btn][data-hint]{animation:none!important}',
      '[data-dc-row][data-state="cleaning"]::before{animation:none;opacity:.4}',
      '.dc-meteor i{animation:none;opacity:0}',
      '.dc-orbit .dc-flame{animation:none}',
      '}',
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

    // ── 触发按钮 ────────────────────────────────────────────────────────────

    function Trigger(props) {
      const t = props.t
      const mode = props.mode
      const shape = mode === 'rail' ? 'rail' : mode === 'icon' ? 'icon' : 'float'
      const draggable = mode === 'float' || mode === 'icon'
      const ref = React.useRef(null)
      const drag = React.useRef(null)
      /** 拖动过就吞掉紧随其后的 click —— 否则「拖一下」会被当成「点一下」把面板关掉。 */
      const suppressClick = React.useRef(false)
      /**
       * 拖动中的实时坐标。
       *
       * 必须走到 state 里：拖居中的按钮时，React 每次重渲染都会把 style 重新
       * 应用成 `left:50%; transform:translate(-50%,-50%)`，把拖动时命令式写进去的
       * left/top 覆盖掉 —— 表现就是「拖了但一松手又回中间」。
       * 放一份到 state，渲染时优先用它，重渲染就稳定了。
       */
      const [dragPos, setDragPos] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      /** 指向最新的 move/up 实现：pointerdown 时同步挂 window 监听要用它，避开 TDZ。 */
      const handlersRef = React.useRef({ move: () => {}, up: () => {}, detach: () => {} })
      /**
       * 拖动开始就通知父组件把面板收起来，松手再弹出来。
       *
       * 早先的做法是「拖动中每帧把坐标喂给面板，面板跟着重排」—— 那是卡顿的根源：
       * 每个 pointermove 都要 setState → 重渲染 → 量面板尺寸 → 再 setState，
       * 一帧里干了几轮布局，主线程直接堵住。收起面板之后，拖动期间只剩
       * 「改一个元素的 left/top」，是纯合成层操作，跟手且不抖。
       */
      const onPointerDown = (event) => {
        if (!draggable || event.button !== 0) return
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
        if (props.onDragStart) props.onDragStart()
        try { element.setPointerCapture(event.pointerId) } catch { /* 靠 window 兜底 */ }
        // 同步挂 window 监听。不能引用后面的 const（TDZ），所以通过 ref 调用；
        // 也不能等到 useEffect —— 第一次 pointermove 会赶在 effect 之前到，直接丢。
        const api = handlersRef.current
        const onMove = (e) => api.move(e)
        const onUp = (e) => { api.detach(); api.up(e) }
        api.detach = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        setDragging(true)
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
        element.style.transform = 'none'
        element.setAttribute('data-dragging', '')
        setDragPos(next)
      }

      const finishDrag = (event) => {
        const state = drag.current
        if (state === null) return
        if (state.pointerId !== event.pointerId) return
        drag.current = null
        setDragging(false)
        if (handlersRef.current.detach) handlersRef.current.detach()
        const element = ref.current
        if (element === null) return
        // 一定要放开指针捕获：不放开的话指针会被这个按钮长期抓住，
        // 后续点击别处（点面板外面关面板）都送不到目标元素。
        try {
          if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        } catch { /* 已自动释放 */ }
        element.removeAttribute('data-dragging')
        if (!state.moved) return
        // 标记：这次交互是拖动，不是点击。click 事件紧随其后，会被吞掉。
        suppressClick.current = true
        const rect = element.getBoundingClientRect()
        const next = clampPosition(rect.left, rect.top, { w: rect.width, h: rect.height })
        element.style.left = next.x + 'px'
        element.style.top = next.y + 'px'
        // 手动拖过就关掉「居中」：否则下次渲染又会把 left/top 写回 50%，
        // 拖完的位置立刻被覆盖，看起来像「拖了但没记住」。
        // 先别清 dragPos：onMoved 的落盘是异步的，立刻清掉会让按钮闪回原位。
        // 等父组件把新坐标写进 props.position 后再交给它接管。
        void props.onMoved(next.x, next.y)
        if (props.onDragEnd) props.onDragEnd()
      }

      handlersRef.current = { move: onPointerMove, up: finishDrag, detach: handlersRef.current.detach }

      // 定位优先级：rail（CSS 贴边）> 拖动中的实时坐标 > 记忆坐标 > 窗口正中 > 右上角默认。
      const style = {}
      if (mode === 'rail') {
        /* rail 由 CSS 定位 */
      } else if (dragPos !== null) {
        style.left = dragPos.x + 'px'
        style.top = dragPos.y + 'px'
      } else if (props.position !== null) {
        style.left = props.position.x + 'px'
        style.top = props.position.y + 'px'
      } else if (props.anchored !== false) {
        // 居中：left/top 各 50%，再用 transform 抵消自身尺寸 —— 按钮尺寸变了也不用重算。
        style.left = '50%'
        style.top = '50%'
        style.transform = 'translate(-50%, -50%)'
      } else {
        const fallback = defaultPosition(shape)
        style.left = fallback.x + 'px'
        style.top = fallback.y + 'px'
      }

      return h('button', {
        ref: (node) => {
          ref.current = node
          if (props.anchorRef) props.anchorRef.current = node
        },
        type: 'button',
        'data-dc-btn': '',
        'data-shape': shape,
        'data-glow': props.glow || undefined,
        'data-hint': props.hint ? '' : undefined,
        'data-busy': props.busy ? '' : undefined,
        style,
        title: t('button.hint'),
        'aria-label': t('button.title'),
        onPointerDown,
        onPointerMove,
        onClick: (event) => {
          if (suppressClick.current) {
            // 刚刚是拖动收尾，这次 click 不是「点击」，丢弃。
            suppressClick.current = false
            return
          }
          event.preventDefault()
          props.onActivate()
        },
        onContextMenu: (event) => {
          event.preventDefault()
          event.stopPropagation()
          suppressClick.current = false
          props.onMenu({ x: event.clientX, y: event.clientY })
        },
      },
        h('span', { 'data-dc-glyph': '' }, props.busy ? h(Spinner) : h(TrashIcon)),
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
        const { w, h: height } = viewport()
        if (element === null) {
          setSpot({ left: props.at.x, top: props.at.y })
          return
        }
        const rect = element.getBoundingClientRect()
        setSpot({
          left: Math.min(props.at.x, Math.max(6, w - rect.width - 6)),
          top: Math.min(props.at.y, Math.max(6, height - rect.height - 6)),
        })
      }, [props.at])

      React.useEffect(() => {
        const close = () => props.onClose()
        const onKey = (event) => { if (event.key === 'Escape') props.onClose() }
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
        onClick: () => { props.onClose(); onClick() },
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

    // ── 火箭绕框 ────────────────────────────────────────────────────────────

    /**
     * 进度 p ∈ [0,1) → 火箭在面板外框上的位置与朝向（纯函数，好测）。
     *
     * 路线（顺时针）：左边缘 ↓ → 底边 → → 右边缘 ↑ → 顶边 ←，每段 25%。
     * 朝向就是该段的行进方向：SVG 本体默认朝上，所以 下=180、右=90、上=0、左=-90。
     * 坐标夹在「面板内减 16px」范围内，否则会被 overflow:hidden 裁掉。
     */
    function orbitPlacement(p, w, hgt, size = 16) {
      const spanX = Math.max(0, w - size)
      const spanY = Math.max(0, hgt - size)
      const clamped = Math.min(0.9999, Math.max(0, p))
      const seg = Math.floor(clamped * 4)
      const local = clamped * 4 - seg
      let x = 0
      let y = 0
      if (seg === 0) { x = 0; y = local * spanY }
      else if (seg === 1) { x = local * spanX; y = spanY }
      else if (seg === 2) { x = spanX; y = spanY - local * spanY }
      else { x = spanX - local * spanX; y = 0 }
      return { x, y, seg, heading: [180, 90, 0, -90][seg] }
    }

    /**
     * 面板外框的总进度：小火箭绕一圈，每段 25%。
     *
     * 三点讲究：
     *  1. **朝向**：火箭的 SVG 默认朝上，所以角度 = 该段的行进方向。
     *     向下走 → 180°，向右 → 90°，向上 → 0°，向左 → -90°。
     *     四个角用最短路径插值，转弯才顺，不会突然翻转。
     *  2. **平滑**：显示进度 displayRef 每帧朝目标进度缓动（指数逼近），
     *     而不是直接把 0→1 的跳变画出来 —— 后端一项一项清，进度是台阶式的，
     *     直接画会一顿一顿。
     *  3. **零布局**：只改一个元素的 transform，不碰 width/height/left/top。
     */
    function OrbitRocket(props) {
      const ref = React.useRef(null)
      const targetRef = React.useRef(0)
      const shownRef = React.useRef(0)
      targetRef.current = props.progress

      React.useEffect(() => {
        let raf = 0
        let last = 0
        const tick = (now) => {
          const host = ref.current
          const rocket = host && host.querySelector('.dc-rocket')
          const panel = host && host.parentElement
          if (host !== null && host !== undefined && rocket !== null && rocket !== undefined && panel !== null && panel !== undefined) {
            const w = panel.clientWidth
            const hgt = panel.clientHeight
            if (w > 0 && hgt > 0) {
              // 缓动：每秒收敛约 12 倍，60fps 下每帧走 1 - e^(-12*dt)。
              const dt = last === 0 ? 1 / 60 : Math.min(0.1, (now - last) / 1000)
              last = now
              const k = 1 - Math.exp(-12 * dt)
              shownRef.current += (targetRef.current - shownRef.current) * k
              if (Math.abs(targetRef.current - shownRef.current) < 0.0004) shownRef.current = targetRef.current

              const p = Math.min(0.9999, Math.max(0, shownRef.current))
              const place = orbitPlacement(p, w, hgt)

              // 朝向插值：
              //  - targetAngle 是「想转到哪」（跟着当前段走）；
              //  - shownAngle 是「现在转到哪」，逐帧朝 target 收敛。
              // 早先的 bug：把已经插值过的角度又写回 dataset 当 prev 用，
              // 于是 delta 永远算成 0 —— 火箭停在 180° 一动不动。
              // 现在用独立的 shownAngle 变量保持连续性，dataset 只用来跨帧保存。
              const targetAngle = place.heading
              let shownAngle = host.dataset.dcAngle !== undefined ? Number(host.dataset.dcAngle) : targetAngle
              let delta = ((targetAngle - shownAngle + 540) % 360) - 180
              if (Math.abs(delta) < 0.3) delta = 0
              shownAngle += delta * Math.min(1, k * 2.4)
              host.dataset.dcAngle = String(shownAngle)
              rocket.style.transform = `translate3d(${place.x}px, ${place.y}px, 0) rotate(${shownAngle}deg)`
              host.style.setProperty('--dc-ring', String(p))
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [])

      return h('div', { ref, className: 'dc-orbit', 'aria-hidden': 'true' },
        h('span', { className: 'dc-rocket' }, h(RocketIcon))
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
        state === 'cleaning' ? h('span', { className: 'dc-meteor', 'aria-hidden': 'true' }, h('i', null)) : null,
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
      const config = props.config
      const showEmpty = config && config.showEmpty === true

      const [items, setItems] = React.useState([])
      const [disk, setDisk] = React.useState(null)
      const [phase, setPhase] = React.useState('idle')
      const [chosen, setChosen] = React.useState(() => new Set())
      const [message, setMessage] = React.useState('')
      const [messageKind, setMessageKind] = React.useState('ok')
      const [spot, setSpot] = React.useState(null)
      const alive = React.useRef(true)
      const panelRef = React.useRef(null)
      const bodyRef = React.useRef(null)
      const measureRef = React.useRef(null)

      const busy = phase === 'scanning' || job.running

      React.useEffect(() => () => { alive.current = false }, [])

      /**
       * 面板落位：视口正中。
       *
       * 之前是「贴在按钮下方、右对齐」，但按钮可以拖到屏幕任何角落，
       * 面板跟着贴边会从最右侧/最上方冒出来，观感很怪。居中之后位置稳定、
       * 可预期，也不受按钮形态（贴边 rail / 纯图标）影响。
       */
      const place = React.useCallback(() => {
        const element = panelRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        const { w, h: height } = viewport()
        const top = Math.max(8, Math.round((height - rect.height) / 2))
        const left = Math.max(8, Math.round((w - rect.width) / 2))
        // 逐行陨石要知道自己能飞多远
        if (bodyRef.current !== null) bodyRef.current.style.setProperty('--dc-row-w', Math.max(120, rect.width - 32) + 'px')
        setSpot({ left, top, width: rect.width })
      }, [])

      // 首次挂载 + 内容变化时重新落位
      React.useLayoutEffect(() => { place() }, [place, items.length])
      // 面板尺寸被内容撑变时也重新落位
      React.useEffect(() => {
        const element = panelRef.current
        if (element === null || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => place())
        observer.observe(element)
        return () => observer.disconnect()
      }, [place])
      React.useEffect(() => {
        const onResize = () => place()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [place])

      // 点面板外面关面板 —— 但清理任务不受影响，继续在后台跑。
      //
      // 依赖必须是稳定引用：早先这里写 [props]，而 props 每次渲染都是新对象，
      // effect 于是不停重跑、每次都重新 setTimeout 挂监听 —— 监听永远处于
      // 「还没挂上」的状态，点外面根本关不掉。
      const closeRef = React.useRef(props.onClose)
      const isTriggerRef = React.useRef(props.isTrigger)
      closeRef.current = props.onClose
      isTriggerRef.current = props.isTrigger
      React.useEffect(() => {
        const onDown = (event) => {
          const element = panelRef.current
          if (element === null) return
          const target = event.target
          if (element.contains(target)) return
          if (isTriggerRef.current && isTriggerRef.current(target)) return
          closeRef.current()
        }
        // 延后一拍再挂，避免「打开面板的那次点击」立刻把它关掉。
        const id = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0)
        return () => { clearTimeout(id); window.removeEventListener('pointerdown', onDown, true) }
      }, [])

      const applyScan = React.useCallback((data) => {
        if (!alive.current) return
        const list = Array.isArray(data.items) ? data.items : []
        // 0 字节的项默认不显示；有内容才列出来，避免面板每次都一大片。
        const visible = showEmpty ? list : list.filter((item) => Number(item.bytes) > 0)
        setItems(visible)
        setDisk(data.disk || null)
        setChosen(new Set(visible.filter((item) => item.defaultOn !== false).map((item) => item.id)))
        setPhase('ready')
      }, [showEmpty])

      const scan = React.useCallback(async (force) => {
        setPhase('scanning')
        // 只有用户主动「重新统计」才清空提示；清理结束后的自动刷新要保留「已释放」结果。
        if (force) setMessage('')
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
      }, [applyScan, t])

      React.useEffect(() => { scan(false) }, [scan])

      // 把任务状态同步到面板：包括「面板被关掉后重开」的情况 ——
      // 消息一直在 job 里，不随组件卸载丢失。
      const lastMessageRef = React.useRef('')
      React.useEffect(() => {
        if (job.phase === 'idle') return
        setMessageKind(job.messageKind)
        setMessage(job.message)
        if (job.phase === 'done' && job.message !== lastMessageRef.current) {
          lastMessageRef.current = job.message
          // 刷新统计但保留结果文案（scan 不再无条件清空消息）。
          void scan(false)
        }
      }, [job.phase, job.message, scan])

      const toggleOne = (id) => {
        setChosen((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      const selectAll = (on) => setChosen(on ? new Set(items.map((item) => item.id)) : new Set())

      const startClean = () => {
        const queue = items.filter((item) => chosen.has(item.id))
        if (queue.length === 0 || job.running) return
        setMessage('')
        void job.run(queue, t)
      }

      const totalSelected = items.filter((item) => chosen.has(item.id)).reduce((sum, item) => sum + Number(item.bytes || 0), 0)
      const groups = GROUP_ORDER
        .map((group) => ({ group, rows: items.filter((item) => item.group === group) }))
        .filter((entry) => entry.rows.length > 0)

      const diskLabel = disk && Number.isFinite(Number(disk.free))
        ? h('span', { 'data-dc-disk': '' }, t('panel.disk') + ' ', h('b', null, formatBytes(disk.free)))
        : null

      const primaryLabel = job.running
        ? t('panel.cleaning') + ' ' + job.done + '/' + job.total + (job.freed > 0 ? ' · ' + formatBytes(job.freed) : '')
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
              state: (job.rows[item.id] && job.rows[item.id].state) || 'idle',
              onToggle: toggleOne,
            }))
          ))

      return h('div', {
        ref: panelRef,
        'data-dc-panel': '',
        'data-anim': props.anim || undefined,
        'data-cleaning': job.running ? '' : undefined,
        role: 'dialog',
        'aria-label': t('panel.title'),
        style: spot === null
          ? { left: 0, top: 0, width: 404, visibility: 'hidden' }
          : { left: spot.left, top: spot.top, width: 404, maxHeight: 'min(80vh, 700px)' },
        onContextMenu: (event) => event.preventDefault(),
      },
        job.running ? h('div', { className: 'dc-ring', 'aria-hidden': 'true' }) : null,
        job.running ? h(OrbitRocket, { progress: job.progress }) : null,
        h('div', { 'data-dc-head': '' },
          h('h3', null, t('panel.title'), diskLabel),
          h('p', { 'data-dc-sub': '' }, job.running ? t('panel.bgHint') : t('panel.subtitle'))
        ),
        h('div', { 'data-dc-tools': '' },
          h('button', { type: 'button', disabled: busy || items.length === 0, onClick: () => selectAll(true) }, t('panel.selectAll')),
          h('button', { type: 'button', disabled: busy || chosen.size === 0, onClick: () => selectAll(false) }, t('panel.selectNone')),
          h('button', { type: 'button', disabled: busy, onClick: () => scan(true) }, t('panel.rescan')),
          h('span', { className: 'dc-total' }, job.running ? job.done + '/' + job.total : formatBytes(totalSelected))
        ),
        h('div', { 'data-dc-body': '', ref: (node) => { bodyRef.current = node; measureRef.current = node } }, body),
        h('div', { 'data-dc-msg': '', 'data-kind': messageKind }, message),
        h('div', { 'data-dc-foot': '' },
          h('span', { className: 'dc-hint' }, job.running ? t('panel.runningOther') : t('panel.safe')),
          h('button', { type: 'button', onClick: props.onClose }, t('panel.close')),
          h('button', {
            type: 'button',
            'data-primary': '',
            disabled: busy || chosen.size === 0,
            onClick: startClean,
          }, primaryLabel)
        )
      )
    }

    // ── 浮层根 ──────────────────────────────────────────────────────────────

    function CleanerOverlay(props) {
      const t = props.t
      const configState = useStore(configStore)
      const jobState = useStore(job)
      const config = configState.config
      const [open, setOpen] = React.useState(false)
      const [anim, setAnim] = React.useState('in')
      const [menuAt, setMenuAt] = React.useState(null)
      const triggerRef = React.useRef(null)
      const autoTried = React.useRef(false)
      const closeTimer = React.useRef(null)
      /** 拖动前面板是不是开着的 —— 必须和别的 hook 放一起，放到早退之后会打乱 hook 顺序（React #310）。 */
      const wasOpenBeforeDrag = React.useRef(false)

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
            if (Number(data.totalBytes || 0) > 0) setOpen(true)
          } catch { /* 自动展开失败就算了 */ }
        })()
        return () => { cancelled = true }
      }, [config])

      // 后台清理结束后：把面板拉出来给用户看结果（如果它本来没开）。
      // 用 job 自己的「本次已通知过没有」标志，避免 ref 在多次渲染之间被覆盖。
      const draggingRef = React.useRef(false)
      React.useEffect(() => {
        if (jobState.phase !== 'done') return
        if (jobState.autoShowAt === 0) return
        if (Date.now() > jobState.autoShowAt) return
        // 正在拖动时不要在用户手底下把面板弹出来
        if (draggingRef.current) return
        setOpen((wasOpen) => (wasOpen ? wasOpen : true))
      }, [jobState.phase, jobState.autoShowAt])

      const openPanel = () => {
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null }
        setAnim('in')
        setOpen(true)
      }
      const closePanel = () => {
        // 播放「收回」动画再卸载，直接从 DOM 里消失会很突兀。
        setAnim('out')
        if (closeTimer.current !== null) clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => { setOpen(false); setAnim('in'); closeTimer.current = null }, 160)
      }
      React.useEffect(() => () => { if (closeTimer.current !== null) clearTimeout(closeTimer.current) }, [])

      if (config === null) return null
      if (configState.hidden) return null

      const mode = config.mode || 'float'
      const position = config.x === null || config.y === null ? null : { x: config.x, y: config.y }
      const vars = themeVars(config.opacity)

      const anchor = () => {
        const element = triggerRef.current
        if (element === null) {
          const fallback = defaultPosition('float')
          return { left: fallback.x, top: fallback.y, right: fallback.x + 92, bottom: fallback.y + 34 }
        }
        const rect = element.getBoundingClientRect()
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      }

      const isTrigger = (target) => {
        const element = triggerRef.current
        return element !== null && (element === target || element.contains(target))
      }

      const activate = () => {
        setMenuAt(null)
        if (open) closePanel()
        else openPanel()
      }

      /**
       * 拖动开始：把面板收掉（不留残余），松手再弹回来。
       *
       * 这让拖动期间完全不做布局计算 —— 面板不在 DOM 里，只剩按钮自身改 left/top，
       * 于是拖起来跟手。顺手记下「本来是开着的」，松手后按原状态恢复。
       */
      const onDragStart = () => {
        draggingRef.current = true
        wasOpenBeforeDrag.current = open
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null }
        // 立刻卸载，不走 160ms 的收起动画：拖动期间面板必须马上消失，
        // 否则「拖动时它还挂着」会让人以为面板在跟着抖。
        setAnim('in')
        setOpen(false)
      }
      const onDragEnd = () => {
        draggingRef.current = false
        const shouldReopen = wasOpenBeforeDrag.current
        wasOpenBeforeDrag.current = false
        if (!shouldReopen) return
        // 等一帧再开：松手瞬间 onMoved 还在落盘，直接 setOpen 会和
        // 「坐标写回 props」撞在一起，偶发不弹或弹了又关。
        requestAnimationFrame(() => {
          setAnim('in')
          setOpen(true)
        })
      }

      const glow = jobState.phase === 'running'
        ? 'red'
        : jobState.celebrateUntil > Date.now() ? 'green' : undefined

      return h('div', { 'data-dc-root': '', 'data-mode': mode, style: vars },
        open ? h(Panel, {
          t,
          config,
          anim,
          isTrigger,
          onClose: closePanel,
        }) : null,
        h(Trigger, {
          t,
          mode,
          position,
          busy: jobState.phase === 'running',
          glow,
          hint: !open && jobState.phase !== 'running',
          anchorRef: triggerRef,
          anchored: config.anchored !== false,
          onActivate: activate,
          onMenu: (at) => setMenuAt(at),
          onMoved: (x, y) => { void configState.save({ x, y, anchored: false }) },
          onDragStart,
          onDragEnd,
        }),
        menuAt !== null ? h(ContextMenu, {
          t,
          at: menuAt,
          mode,
          onClose: () => setMenuAt(null),
          onMode: (next) => { void configState.save({ mode: next }) },
          onHide: () => { closePanel(); configState.setHidden(true) },
          onCleanNow: () => { openPanel() },
          onSettings: () => { openPanel() },
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
      const configState = useStore(configStore)
      const config = configState.config
      const [targets, setTargets] = React.useState(null)
      const [savedFlash, setSavedFlash] = React.useState(false)

      React.useEffect(() => { if (config === null) void configState.load() }, [config, configState])
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
      const save = (patch) => { void configState.save(patch).then((ok) => { if (ok) flash() }) }

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
          h('span', { className: 'dcs-target-meta' }, Number(item.bytes) > 0 ? formatBytes(item.bytes) : t('set.target.empty'))
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
          row(t('set.anchored'), t('set.anchored.desc'),
            h(Switch, { value: config.anchored !== false, onChange: (value) => save({ anchored: value }) })),
          row(t('set.position.value'),
            config.x === null || config.y === null ? '—' : Math.round(config.x) + ', ' + Math.round(config.y),
            h('button', { type: 'button', onClick: () => save({ x: null, y: null }) }, t('set.position.reset')))
        ),

        h('div', { className: 'dcs-card' },
          h('h4', null, t('set.opacity')),
          h('p', { className: 'dcs-desc' }, t('set.opacity.desc')),
          h('div', { className: 'dcs-row' },
            h('div', { className: 'dcs-row-main' },
              h('input', {
                type: 'range', min: 35, max: 100, step: 1,
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
              h('div', { className: 'dcs-row-title' }, configState.hidden ? t('set.visibility.off') : t('set.visibility.on'))),
            h('button', {
              type: 'button',
              'data-primary': configState.hidden ? '' : undefined,
              onClick: () => configState.setHidden(false),
            }, t('menu.show')))
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
                .then((body) => { if (body && body.config) configState.setConfig(body.config); flash() })
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
      } catch { /* 保持默认 */ }
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

      void configStore.load()

      const Overlay = () => h(CleanerOverlay, { t })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-cleaner.floating',
        order: 90,
        locale: NS,
      }, Overlay))

      const Settings = () => {
        React.useEffect(() => { if (configStore.config === null) void configStore.load() }, [])
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
        return h('span', { style: { display: 'inline-flex', width: '1em', height: '1em' } }, h(TrashIcon))
      }))
    }

    exports.apply = apply
    exports.inject = inject
    exports.__internals = { LEX, formatBytes, themeVars, clampPosition, configStore, job, DISPLAY_NAME, orbitPlacement }
    return module.exports
  },
})
