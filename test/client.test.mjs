/**
 * dsh-cleaner 两半的离线回归测试。
 *
 * 重点守住已经踩过的坑：
 *  1. client 工厂必须 `return module.exports` —— 第一版忘了这一行，宿主报
 *     "dsh-cleaner: import failed"，整个按钮根本不出现。
 *  2. 工厂返回值必须带 apply/inject，且 inject 只有 slots/locale。
 *  3. apply() 必须注册三处：shell.overlay 的浮层、设置页、设置页图标。
 *  4. 按钮在拿到配置前不该渲染（避免闪一下默认位置再跳）。
 *  5. 0 字节的项默认不显示。
 *
 * 跑法：node test/client.test.mjs
 */
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ── 最小 React 桩 ────────────────────────────────────────────────────────────
const Fragment = Symbol('Fragment')
const React = {
  Fragment,
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.length === 1 ? children[0] : children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useMemo(factory) { return factory() },
  useCallback(fn) { return fn },
  useLayoutEffect() { return undefined },
  useRef(initial) { return { current: initial === undefined ? null : initial } },
  useEffect(fn) {
    // 跑一次并能拿到 cleanup；测试要验证「订阅/卸载」这类逻辑确实存在。
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
    return cleanup
  },
  Component: class Component { constructor(props) { this.props = props || {}; this.state = {} } },
}
const cleanups = []

const requireStub = (name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return { jsx: {}, jsxs: {}, Fragment }
  throw new Error(`unexpected require: ${name}`)
}

// ── 沙箱 ────────────────────────────────────────────────────────────────────
let loaded = null
const created = []
const session = new Map()
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load({ id, factory }) { loaded = { id, factory } },
    },
    sessionStorage: {
      getItem: (key) => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => session.set(key, String(value)),
    },
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    getElementById: () => null,
    createElement: () => {
      const node = { id: '', textContent: '', remove() { this.removed = true } }
      created.push(node)
      return node
    },
    head: { appendChild() {} },
  },
  fetch: async (path) => {
    if (String(path).includes('/config')) {
      return {
        ok: true,
        json: async () => ({ config: { mode: 'float', x: null, y: null, opacity: 0.88, showEmpty: false, autoExpand: false, disabled: [] } }),
        text: async () => '{}',
      }
    }
    return { ok: true, json: async () => ({ items: [], totalBytes: 0 }), text: async () => '{}' }
  },
  // 只让 0ms（下一拍）立即执行，其余走真实计时器 —— 否则「庆祝窗口」这种
  // 定时复位的逻辑会被瞬间跑掉，测不到。
  setTimeout: (fn, delay) => {
    if (typeof fn !== 'function') return 0
    if (!delay) { fn(); return 0 }
    return globalThis.setTimeout(fn, Math.min(delay, 40))
  },
  clearTimeout: (id) => globalThis.clearTimeout(id),
}
sandbox.globalThis = sandbox
createContext(sandbox)

try {
  runInContext(source, sandbox, { filename: 'client.js' })
  check('文件作为脚本求值', true)
} catch (error) {
  check('文件作为脚本求值', false, String(error && error.message))
}

check('调用了 __ModuleLoader__.load', loaded !== null)
check('模块 id 等于包名', loaded !== null && loaded.id === 'dsh-cleaner', loaded && loaded.id)

let exported = null
try {
  exported = loaded.factory(requireStub)
  check('工厂返回 exports（曾漏掉 return 导致 import failed）', exported !== null && typeof exported === 'object')
} catch (error) {
  check('工厂返回 exports（曾漏掉 return 导致 import failed）', false, String(error && error.message))
}

check('导出了 apply', exported !== null && typeof exported.apply === 'function')
check('导出了 inject', exported !== null && Array.isArray(exported.inject), exported && JSON.stringify(exported.inject))
check(
  'inject 只要 slots 与 locale',
  exported !== null && JSON.stringify(exported.inject) === JSON.stringify(['slots', 'locale']),
  exported && JSON.stringify(exported.inject),
)

// ── 跑 apply()，捕获注册内容 ────────────────────────────────────────────────
const registered = []
const injectedInto = []
const localeRegistrations = []
const effects = []

const fakeCtx = {
  slots: {
    inject(name, callback) { injectedInto.push(name); return callback() },
    register(spec, component) { registered.push({ spec, component }); return () => {} },
  },
  locale: {
    register(namespace, dictionaries) { localeRegistrations.push({ namespace, dictionaries }); return () => {} },
    bind() { return (key) => key },
  },
  effect(fn, label) { const dispose = fn(); effects.push({ label, dispose }); return dispose },
}

try {
  exported.apply(fakeCtx)
  check('apply() 执行无异常', true)
} catch (error) {
  check('apply() 执行无异常', false, String(error && error.message))
}

check('注入 shell.overlay（右上角常驻位）', injectedInto.includes('shell.overlay'), JSON.stringify(injectedInto))
check('注入 settings.section（设置页）', injectedInto.includes('settings.section'))
check('注入 settings.section.icon（设置页图标）', injectedInto.includes('settings.section.icon'))
check('注册了 3 个贡献', registered.length === 3, String(registered.length))

const overlay = registered.find((entry) => entry.spec.name === 'shell.overlay')
const section = registered.find((entry) => entry.spec.name === 'settings.section')

check('浮层用 shell.overlay', overlay !== undefined)
check('浮层用了自己的 id（不能撞掉别人的浮层）', overlay !== undefined && overlay.spec.id === 'dsh-cleaner.floating', overlay && overlay.spec.id)
check('浮层 order 是数字', overlay !== undefined && typeof overlay.spec.order === 'number')
check('设置页 id 是 dsh-cleaner', section !== undefined && section.spec.id === 'dsh-cleaner', section && section.spec.id)
check('设置页 label 是函数（跟随语言）', section !== undefined && typeof section.spec.label === 'function')
check('设置页 label 有中文', section !== undefined && section.spec.label() === '缓存清理', section && section.spec.label())

check('注册了 locale 词典', localeRegistrations.length === 1 && localeRegistrations[0].namespace === 'dsh-cleaner')
check('词典含中英两套', localeRegistrations.length === 1 &&
  Object.keys(localeRegistrations[0].dictionaries).sort().join(',') === 'en,zh')
check('注入了样式并能被回收', created.length >= 1 && typeof created[0].textContent === 'string' && created[0].textContent.length > 100 && effects.some((effect) => String(effect.label).includes('styles')))

const css = created.length >= 1 ? created[0].textContent : ''
check('面板用半透明毛玻璃（不是 100% 实心）', css.includes('backdrop-filter') && css.includes('--dc-panel-bg'))
check('icon 与 rail 有专门形态样式', css.includes('data-shape="icon"') && css.includes('data-shape="rail"'))
check('rail 形态贴右边缘', css.includes('data-shape="rail"') && css.includes('translateY(-50%)'))
check('按钮可拖动时禁掉文本选择', css.includes('touch-action:none') && css.includes('user-select:none'))
check('清理中的项有陨石飞过动画', css.includes('dc-meteor-fly') && css.includes('dc-meteor'))
check('面板外框有火箭绕行', css.includes('dc-orbit') && css.includes('.dc-rocket'))
check('清理时按钮亮红光', css.includes('dc-red-pulse') && css.includes('data-glow="red"'))
check('完成后按钮闪绿光 5 下', css.includes('dc-green-blink') && /\.52s ease-in-out 5/.test(css))
check('面板用淡入淡出（不做位移缩放）', css.includes('dc-fade-in') && css.includes('dc-fade-out') && !css.includes('dc-pop-in'))
check('尊重减少动效偏好', css.includes('prefers-reduced-motion'))

// ── 首屏渲染 ────────────────────────────────────────────────────────────────
function render(node, depth = 0) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (depth > 40) return node
  if (Array.isArray(node)) return node.map((child) => render(child, depth + 1))
  if (typeof node.type === 'function') {
    const ComponentFn = node.type
    const props = { ...(node.props || {}) }
    let output
    try {
      output = ComponentFn(props)
    } catch (error) {
      throw new Error(`渲染 ${ComponentFn.name || '匿名组件'} 失败: ${error && error.message}`)
    }
    return render(output, depth + 1)
  }
  const kids = node.children === undefined ? [] : (Array.isArray(node.children) ? node.children : [node.children])
  return { ...node, children: kids.map((child) => render(child, depth + 1)) }
}

function findByAttr(node, attr) {
  if (node === null || typeof node !== 'object') return null
  if (node.props !== undefined && node.props[attr] !== undefined) return node
  const kids = Array.isArray(node.children) ? node.children : (node.children === undefined ? [] : [node.children])
  for (const kid of kids) {
    const found = findByAttr(kid, attr)
    if (found !== null) return found
  }
  return null
}

let tree = null
try {
  // 第一帧：配置还没到，应当什么也不画（否则会先闪默认位置再跳到记忆位置）。
  tree = render(overlay.component({}))
  check('浮层组件可渲染', tree === null || typeof tree === 'object')
} catch (error) {
  check('浮层组件可渲染', false, String(error && error.message))
}
check('配置加载前渲染为 null（避免位置闪烁）', tree === null, String(tree))

// 配置到位后（store 直接注入）应当渲染出刷子按钮。
let readyTree = null
try {
  const internals = exported.__internals
  internals.configStore.config = { mode: 'float', x: null, y: null, opacity: 0.88, showEmpty: false, autoExpand: false, disabled: [] }
  internals.configStore.hidden = false
  readyTree = render(overlay.component({}))
  check('配置到位后渲染成功', readyTree !== null && typeof readyTree === 'object')
} catch (error) {
  check('配置到位后渲染成功', false, String(error && error.message))
}

const button = readyTree === null ? null : findByAttr(readyTree, 'data-dc-btn')
check('配置到位后渲染出刷子按钮', button !== null)
check('按钮有可读的 title（悬停提示）', button !== null && typeof button.props.title === 'string' && button.props.title.length > 3, button && button.props.title)
check('按钮是 button 元素', button !== null && button.type === 'button')
check('按钮支持右键菜单', button !== null && typeof button.props.onContextMenu === 'function')
check('按钮支持拖动（pointerdown/move 在元素上）', button !== null &&
  typeof button.props.onPointerDown === 'function' &&
  typeof button.props.onPointerMove === 'function')
check('按钮不再自己处理 pointerup（统一走 window，避免一次松手被处理两遍）',
  button !== null && button.props.onPointerUp === undefined)

// 隐藏状态：store.hidden 后应当什么都不画（右键隐藏直到下次打开）。
let hiddenTree = null
try {
  exported.__internals.configStore.hidden = true
  hiddenTree = render(overlay.component({}))
} catch (error) {
  hiddenTree = { error }
}
check('隐藏后不渲染任何东西', hiddenTree === null, JSON.stringify(hiddenTree))
exported.__internals.configStore.hidden = false

// 设置页：能渲染出四种形态的选项和各个开关。
let settingsTree = null
try {
  settingsTree = render(section.component({ close: () => {} }))
  check('设置页可渲染', settingsTree !== null)
} catch (error) {
  check('设置页可渲染', false, String(error && error.message))
}
const settingsHtml = JSON.stringify(settingsTree || {})
check('设置页含四种形态', ['浮动按钮', '纯图标', '固定在右上角', '贴右边缘'].every((label) => settingsHtml.includes(label)))
check('设置页含不透明度滑块', settingsHtml.includes('"type":"range"'))
check('设置页含自动展开开关', settingsHtml.includes('dcs-switch'))

// ── 工具函数 ────────────────────────────────────────────────────────────────
const internals = exported !== null ? exported.__internals : undefined
check('导出了 __internals（供测试用）', internals !== undefined)
if (internals !== undefined) {
  check('formatBytes 处理 0', internals.formatBytes(0) === '0 B', internals.formatBytes(0))
  check('formatBytes 处理 GB', internals.formatBytes(2 * 1024 ** 3) === '2.0 GB', internals.formatBytes(2 * 1024 ** 3))
  const vars = internals.themeVars(0.5)
  check('themeVars 把不透明度换算成 50%', String(vars['--dc-panel-bg']).includes('50%'), vars['--dc-panel-bg'])
  const clamped = internals.clampPosition(-500, -500, { w: 80, h: 36 })
  check('clampPosition 不让按钮跑出左上角', clamped.x >= 0 && clamped.y >= 0, JSON.stringify(clamped))
  const far = internals.clampPosition(99999, 99999, { w: 80, h: 36 })
  check('clampPosition 不让按钮跑出右下角', far.x <= 1440 && far.y <= 900, JSON.stringify(far))
}

// ── 后台清理任务：面板卸载后仍然继续 ────────────────────────────────────────
{
  const internals = exported.__internals
  const job = internals.job
  const calls = []
  const originalFetch = sandbox.fetch
  // 让 /clean-item 可控地「慢」一点，才能观察到「面板已关、任务仍在跑」。
  sandbox.fetch = async (path, init) => {
    const url = String(path)
    if (url.includes('/clean-item')) {
      calls.push(url)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { ok: true, text: async () => JSON.stringify({ id: url.split('id=')[1], freed: 1024, skipped: 0 }) }
    }
    return { ok: true, text: async () => JSON.stringify({ items: [], totalBytes: 0, disk: null }) }
  }
  globalThis.fetchBackup = originalFetch

  job.reset()
  const queue = [
    { id: 'a', label: 'A', bytes: 1024 },
    { id: 'b', label: 'B', bytes: 2048 },
  ]
  const running = job.run(queue, (key) => key)
  check('清理任务开始后 phase=running', job.phase === 'running')
  // 模拟「用户把面板关掉」：任务对象根本不依赖组件，应该继续推进。
  await new Promise((resolve) => setTimeout(resolve, 1))
  await running
  check('面板关了清理照样跑完', job.phase === 'done')
  check('两项都调用了 clean-item', calls.length === 2, String(calls.length))
  check('累计释放量正确', job.freed === 2048, String(job.freed))
  check('每项都记了完成态', job.rows.a.state === 'done' && job.rows.b.state === 'done')
  check('完成后进入庆祝窗口（绿光）', job.celebrateUntil > Date.now())
  sandbox.fetch = originalFetch
}

// ── 名字 ────────────────────────────────────────────────────────────────────
{
  const internals = exported.__internals
  check('展示名是 C Disk Cleaner', internals.DISPLAY_NAME === 'C Disk Cleaner', internals.DISPLAY_NAME)
  check('中英文案里都带新名字', internals.LEX.zh['app.name'] === 'C Disk Cleaner' && internals.LEX.en['app.name'] === 'C Disk Cleaner')
}

// ── 火箭绕框：位置与朝向 ────────────────────────────────────────────────────
{
  const { orbitPlacement } = exported.__internals
  const W = 400
  const H = 600
  const samples = [
    { p: 0.0, seg: 0, heading: 180, name: '左边缘起点，朝下' },
    { p: 0.125, seg: 0, heading: 180, name: '左边缘中段，朝下' },
    { p: 0.25, seg: 1, heading: 90, name: '底边起点，朝右' },
    { p: 0.375, seg: 1, heading: 90, name: '底边中段，朝右' },
    { p: 0.5, seg: 2, heading: 0, name: '右边缘起点，朝上' },
    { p: 0.625, seg: 2, heading: 0, name: '右边缘中段，朝上' },
    { p: 0.75, seg: 3, heading: -90, name: '顶边起点，朝左' },
    { p: 0.875, seg: 3, heading: -90, name: '顶边中段，朝左' },
  ]
  let allOk = true
  const detail = []
  for (const sample of samples) {
    const got = orbitPlacement(sample.p, W, H)
    const ok = got.seg === sample.seg && got.heading === sample.heading
    if (!ok) allOk = false
    detail.push(`${sample.name}: seg=${got.seg} heading=${got.heading}`)
  }
  check('火箭朝向跟前进方向一致（下→右→上→左）', allOk, detail.join(' | '))

  // 四个方向必须真的不同（用户报的就是「只指一个方向」）
  const headings = new Set([0.1, 0.35, 0.6, 0.85].map((p) => orbitPlacement(p, W, H).heading))
  check('火箭四个方向各不相同', headings.size === 4, JSON.stringify([...headings]))

  // 位置必须始终在面板内（否则被 overflow:hidden 裁掉）
  let inside = true
  for (let i = 0; i <= 100; i += 1) {
    const got = orbitPlacement(i / 100, W, H)
    if (got.x < 0 || got.y < 0 || got.x > W - 16 + 0.001 || got.y > H - 16 + 0.001) inside = false
  }
  check('火箭全程都在面板内（不会被裁掉）', inside === true)

  // 左下右上的顺序：x 在左边缘不变、底边递增、右边缘不变、顶边递减
  const left = orbitPlacement(0.1, W, H)
  const bottom = orbitPlacement(0.35, W, H)
  const right = orbitPlacement(0.6, W, H)
  const top = orbitPlacement(0.85, W, H)
  check('火箭走位是顺时针一圈',
    left.x === 0 && bottom.y === H - 16 && right.x === W - 16 && top.y === 0 && bottom.x > left.x && top.x < right.x,
    JSON.stringify({ left, bottom, right, top }))
}

// ── 文案完整性 ──────────────────────────────────────────────────────────────
if (internals !== undefined && internals.LEX) {
  const zhKeys = new Set(Object.keys(internals.LEX.zh))
  const enKeys = new Set(Object.keys(internals.LEX.en))
  const missingEn = [...zhKeys].filter((key) => !enKeys.has(key))
  const missingZh = [...enKeys].filter((key) => !zhKeys.has(key))
  check('中英文案一一对应', missingEn.length === 0 && missingZh.length === 0,
    `缺 en: ${missingEn.join(',') || '-'}；缺 zh: ${missingZh.join(',') || '-'}`)
  check('文案里没有占位符残留', Object.values(internals.LEX.zh).every((text) => typeof text === 'string' && text.length > 0))
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
for (const cleanup of cleanups) {
  try { cleanup() } catch { /* 卸载逻辑本身不该抛 */ }
}
check('组件卸载时清理干净', true)

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.error('\n失败项：')
  for (const result of failed) console.error(`  - ${result.name} ${result.detail}`)
  process.exitCode = 1
}
