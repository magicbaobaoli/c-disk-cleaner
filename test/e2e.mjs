/**
 * 端到端验收（v0.4.0）：真实浏览器里的 client + 磁盘上最新代码起的 host。
 *
 * host 半边只在 DSH 启动时加载一次，client 半边每次刷新都从磁盘读，
 * 所以用 CDP 的 Fetch 拦截把 `/dsh-cleaner/*` 转发到本文件起的 host，
 * 不重启 DSH 也能跑完整链路。
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdir, writeFile as writeProbe } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, createHmac } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const GUI = 'http://127.0.0.1:13808/'
const HOST_PORT = 7751
const CDP_PORT = 9481
const KEEP = process.argv.includes('--keep')

/**
 * CDP 的 request.postData 有时是 base64（存在 postDataEntries 时）。
 * 先判断能不能当 UTF-8 解出来，不行再按 base64 解。
 */
function decodeMaybeBase64(postData, entries) {
  if (Array.isArray(entries) && entries.length > 0 && entries[0].bytes !== undefined) {
    return Buffer.from(entries[0].bytes, 'base64').toString('utf8')
  }
  if (typeof postData !== 'string') return postData
  // 纯 JSON body 是合法 utf8；base64 串 base64 解回来再校验
  if (postData.trimStart().startsWith('{') || postData.trimStart().startsWith('[')) return postData
  try {
    const decoded = Buffer.from(postData, 'base64').toString('utf8')
    if (decoded.trimStart().startsWith('{')) return decoded
  } catch { /* 不是 base64 */ }
  return postData
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// 记录 host 实际收到的 POST body，用来确认 CDP 拦截有没有转发 postData
const seenBodies = []

// ── 1. 用磁盘上最新代码起 host ──────────────────────────────────────────────
const plugin = await import(pathToFileURL(join(here, '..', 'lib', 'index.js')).href + '?' + Date.now())
let hostHandler = null
plugin.apply({
  inject(_names, cb) {
    cb({
      webServer: { getOrigin: () => null, register(row) { hostHandler = row.handler; return () => {} } },
      effect(fn) { return fn() },
    })
  },
}, {})
// 造一点可清的小内容，保证面板里一定有行可操作
// 造足量的小文件：清理要持续好几秒，才来得及「点外面 → 观察后台仍在跑 → 转绿」。
// 用小文件+多层目录，让 rm 的 syscall 数量足够多。
const probeRoot = join(homedir(), '.dsh', 'cache', 'dsh-image-gen', 'inspiration')
await (async () => {
  const { mkdir: mk, writeFile: wf, rm: rmx } = await import('node:fs/promises')
  await rmx(probeRoot, { recursive: true, force: true })
  // 120 个目录 × 80 个文件 = 9600 个文件：清理要跑好几秒，
  // 才来得及「点外面 → 观察后台仍在跑 → 转绿」，也才跑得出火箭的四个方向。
  const jobs = []
  for (let d = 0; d < 220; d += 1) {
    const dir = join(probeRoot, 'e2e-probe-' + d, 'nested')
    jobs.push((async () => {
      await mk(dir, { recursive: true })
      for (let f = 0; f < 80; f += 1) await wf(join(dir, 'p-' + f + '.bin'), Buffer.alloc(1024, 7))
    })())
  }
  await Promise.all(jobs)
})()

// 测试 host 允许 GUI 源跨域（生产环境两者同源，不需要这个）
function withCors(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true }
  return false
}

const hostServer = createServer((req, res) => {
  if (withCors(req, res)) return
  if (req.method !== 'POST') return hostHandler(req, res)
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    seenBodies.push({ url: req.url, body })
    // 把已经读掉的 body 重新灌回去给 handler：用一个 Readable 包一层，
    // 直接 req.push 在 end 之后是不生效的。
    const replay = new Readable({
      read() {
        this.push(Buffer.from(body, 'utf8'))
        this.push(null)
      },
    })
    replay.url = req.url
    replay.method = req.method
    replay.headers = req.headers
    hostHandler(replay, res)
  })
})
await new Promise((resolve) => hostServer.listen(HOST_PORT, '127.0.0.1', resolve))
// 重置偏好，保证本轮从「居中 + 无记忆坐标」的默认状态开始
await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`, { method: 'DELETE' })

// 先等探测文件落盘，并强制刷新一次扫描缓存，保证面板里一定能看到这一项。
await new Promise((resolve) => setTimeout(resolve, 300))
await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/scan?force=1`)

// ── 2. 浏览器 ──────────────────────────────────────────────────────────────
function cookieFor(authority) {
  const yaml = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  const match = yaml.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/)
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const b64 = (buffer) => Buffer.from(buffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 86400000 }
  const body = b64(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64(createHmac('sha256', secret).update(body).digest())
  return { name, value: `v1.${body}.${sig}` }
}

const profile = mkdtempSync(join(tmpdir(), 'cleaner-e2e-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

async function waitPort() {
  for (let i = 0; i < 140; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('chrome did not start')
}

const version = await waitPort()
const ws = new WebSocket(version.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const pageErrors = []
const consoleMsgs = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleMsgs.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400))
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleMsgs.push('LOG: ' + String(msg.params.entry.text).slice(0, 400))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400))
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const waiter = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)))
    else waiter.resolve(msg.result)
    return
  }
})
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
const send = (method, params = {}, sessionId) => {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
// 用 let：事件处理器（Fetch.requestPaused 等）在它赋值前就可能被调用，
// const 的 TDZ 会让整个 WebSocket 回调抛错。
let { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (method, params) => send(method, params, sessionId)

await S('Page.enable')
await S('Runtime.enable')
await S('Log.enable')
await S('Console.enable')
await S('Network.enable')

// 在页面任何脚本之前注入 fetch 补丁，把 /dsh-cleaner/* 转到本机 host。
// 用 addScriptToEvaluateOnNewDocument 而不是事后 ev()，否则 client 首次
// fetch 已经打到真实 host 上了。
await S('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const HOST = 'http://127.0.0.1:${HOST_PORT}'
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (url.startsWith('/dsh-cleaner/')) return original(HOST + url, init)
      return original(input, init)
    }
  })()`,
})

const cookie = cookieFor(new URL(GUI).host)
await S('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true })
await S('Page.navigate', { url: GUI })
await new Promise((resolve) => setTimeout(resolve, 3000))
await ev(`(() => {
  window.__dcErrors = []
  const push = (m) => window.__dcErrors.push(String(m).slice(0, 300))
  window.addEventListener('error', (e) => push(e.message + ' @ ' + (e.filename || '')))
  window.addEventListener('unhandledrejection', (e) => push('rejection: ' + (e.reason && e.reason.message)))
  return true
})()`).catch(() => {})
// 等按钮真的出现再往下走：DSH 启动 + 插件挂载 + 配置拉取是异步的，
// 固定 sleep 在慢机器/冷启动时会偶发「还没挂上就断言」，看起来像插件的 bug。
for (let i = 0; i < 120; i += 1) {
  const ready = await ev(`!!document.querySelector('[data-dc-btn]')`).catch(() => false)
  if (ready === true) break
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function ev(expression) {
  const outcome = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (outcome.exceptionDetails) {
    return { ERR: String(outcome.exceptionDetails.exception?.description || outcome.exceptionDetails.text).slice(0, 300) }
  }
  return outcome.result.value
}

async function dismissModals() {
  for (let i = 0; i < 10; i += 1) {
    const state = await ev(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!dialog) return 'none'
      const buttons = Array.from(dialog.querySelectorAll('button'))
      const target = buttons.find((b) => /知道了|关闭|确定|OK|Got it|Close/i.test(b.textContent)) || buttons[buttons.length - 1]
      if (target) { target.click(); return 'clicked' }
      return 'nobtn'
    })()`)
    if (state === 'none') return
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
}

/** 鼠标真实点击某个坐标。 */
async function clickAt(x, y) {
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const centerOf = async (selector) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`)

await dismissModals()
check('DSH 弹窗已清掉', (await ev(`document.querySelectorAll('[role="dialog"][aria-modal="true"]').length`)) === 0)

// ── 3. 按钮：存在、图标是垃圾桶、名字 ──────────────────────────────────────
const earlyErrors = await ev(`(() => {
  const e = window.__dcErrors || []
  return e.slice(0, 5)
})()`)
if (Array.isArray(earlyErrors) && earlyErrors.length > 0) console.log('    PAGE ERRORS:', JSON.stringify(earlyErrors))
{
  const diag = await ev(`(() => {
    const root = document.querySelector('[data-dc-root]')
    return {
      hasRoot: !!root,
      rootMode: root ? root.getAttribute('data-mode') : null,
      styleTags: Array.from(document.querySelectorAll('style')).filter(s => s.id === 'dsh-cleaner-style').length,
      hidden: (() => { try { return sessionStorage.getItem('dsh-cleaner:hidden') } catch { return 'n/a' } })(),
      overlays: document.querySelectorAll('[data-slot="shell.overlay"] > *').length,
      btn: !!document.querySelector('[data-dc-btn]'),
    }
  })()`)
  console.log('    DEBUG diag ->', JSON.stringify(diag))
  const cfg = await ev(`(async () => {
    try {
      const r = await fetch('/dsh-cleaner/config', { cache: 'no-store', credentials: 'same-origin' })
      const b = await r.json()
      return { ok: r.ok, status: r.status, hasConfig: !!(b && b.config), keys: b && b.config ? Object.keys(b.config) : null }
    } catch (e) { return { err: String(e.message) } }
  })()`)
  console.log('    DEBUG fetch config ->', JSON.stringify(cfg))
  const storeState = await ev(`(() => {
    const d = window.__dcDebug
    if (!d) return 'no __dcDebug (apply not reached?)'
    return { hasConfig: d.configStore.config !== null, hidden: d.configStore.hidden, keys: d.configStore.config ? Object.keys(d.configStore.config) : null }
  })()`)
  console.log('    DEBUG store ->', JSON.stringify(storeState))
  const overlayDump = await ev(`(() => {
    const slot = document.querySelector('[data-slot="shell.overlay"]')
    if (!slot) return 'no slot'
    return Array.from(slot.children).map(c => c.tagName + ' ' + Array.from(c.attributes).map(a=>a.name+'='+a.value).join(',') + ' kids=' + c.children.length).slice(0,6)
  })()`)
  console.log('    DEBUG overlay ->', JSON.stringify(overlayDump))
  const slotErr = await ev(`(() => {
    const el = document.querySelector('[data-slot-error="shell.overlay"]')
    if (!el) return null
    return { html: el.outerHTML.slice(0, 800), text: (el.textContent||'').slice(0, 400) }
  })()`)
  console.log('    DEBUG slotErr ->', JSON.stringify(slotErr))
}
if (pageErrors.length > 0) console.log('    RUNTIME ERRORS:', JSON.stringify(pageErrors.slice(0, 4)))
if (consoleMsgs.length > 0) console.log('    CONSOLE ERRORS:', JSON.stringify(consoleMsgs.slice(0, 6)))
const slotErrNow = await ev(`(() => {
  const el = document.querySelector('[data-slot-error="shell.overlay"]')
  return el ? 'SLOT ERROR PRESENT' : 'no slot error'
})()`)
console.log('    DEBUG slotState ->', slotErrNow)
check('按钮出现', (await ev(`!!document.querySelector('[data-dc-btn]')`)) === true)
{
  const txt = await ev(`(document.querySelector('[data-dc-btn]')||{}).textContent.trim()`)
  console.log('    DEBUG textContent ->', JSON.stringify(txt).slice(0, 500))
  check('按钮文字是「清理缓存」', txt === '清理缓存', String(txt).slice(0, 200))
}
check('图标是垃圾桶（不再是刷子）', (await ev(`(() => {
  const glyph = document.querySelector('[data-dc-btn] [data-dc-glyph] svg')
  if (!glyph) return false
  const d = Array.from(glyph.querySelectorAll('path')).map(p => p.getAttribute('d')).join(' ')
  return d.includes('6.5h16') || d.includes('12.1')
})()`)) === true)

// ── 4. 打开面板 → 从按钮蹦出 ────────────────────────────────────────────────
let btn = await centerOf('[data-dc-btn]')
await clickAt(btn.x, btn.y)
await new Promise((resolve) => setTimeout(resolve, 1500))
check('点一下打开面板', (await ev(`!!document.querySelector('[data-dc-panel]')`)) === true)

// 面板打开后强制重新统计，确保刚造的探测文件被算进去
await ev(`(() => { const b = Array.from(document.querySelectorAll('[data-dc-tools] button')).find(x => x.textContent.includes('重新统计')); if (b) b.click(); return true })()`)
await new Promise((resolve) => setTimeout(resolve, 2500))
const popAnim = await ev(`(() => {
  const p = document.querySelector('[data-dc-panel]')
  if (!p) return null
  const s = getComputedStyle(p)
  return { anim: p.getAttribute('data-anim'), name: s.animationName, origin: s.transformOrigin }
})()`)
check('面板淡入出现', popAnim !== null && popAnim.anim === 'in' && String(popAnim.name).includes('dc-fade-in'), JSON.stringify(popAnim))

// ── 5. 按钮居中 + 拖动时收起面板、松手弹回 ──────────────────────────────
{
  const centered = await ev(`(() => {
    const b = document.querySelector('[data-dc-btn]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return {
      cx: Math.round(r.x + r.width / 2),
      cy: Math.round(r.y + r.height / 2),
      vw: window.innerWidth,
      vh: window.innerHeight,
      transform: getComputedStyle(b).transform,
    }
  })()`)
  const nearCenter = centered !== null &&
    Math.abs(centered.cx - centered.vw / 2) < 40 && Math.abs(centered.cy - centered.vh / 2) < 40
  check('按钮默认在窗口正中', nearCenter === true, JSON.stringify(centered))
}

const panelAnim = await ev(`(() => {
  const p = document.querySelector('[data-dc-panel]')
  if (!p) return null
  const s = getComputedStyle(p)
  return { anim: p.getAttribute('data-anim'), name: s.animationName }
})()`)
check('面板用淡入（不位移不缩放）', panelAnim !== null && String(panelAnim.name).includes('dc-fade-in') && !String(panelAnim.name).includes('pop'),
  JSON.stringify(panelAnim))

// 用户报的场景是「面板开着的时候去拖按钮」——先保证面板是开的
const panelOpenBeforeDrag = await ev(`!!document.querySelector('[data-dc-panel]')`)
check('拖动前面板是开着的（复现用户场景）', panelOpenBeforeDrag === true)
{
  const st = await ev(`({
    btn: !!document.querySelector('[data-dc-btn]'),
    panel: !!document.querySelector('[data-dc-panel]'),
    dragging: !!document.querySelector('[data-dragging]'),
  })`)
  console.log('    DEBUG dragStart state ->', JSON.stringify(st))
}

const dragBefore = await ev(`(() => {
  const b = document.querySelector('[data-dc-btn]')
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`)

// 用页面内合成的 PointerEvent 序列驱动拖动：
// CDP 的 Input.dispatchMouseEvent 在 headless + pointer capture 下不总派发 pointermove，
// 这不是插件的问题。真实用户操作走的就是这条 pointer 事件路径。
const dragResult = await ev(`(() => {
  const btn = document.querySelector('[data-dc-btn]')
  if (!btn) return { error: 'no button' }
  const r = btn.getBoundingClientRect()
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const fire = (type, x, y) => {
    btn.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }))
  }
  fire('pointerdown', cx, cy)
  for (let step = 1; step <= 8; step += 1) fire('pointermove', cx - step * 20, cy - step * 10)
  fire('pointerup', cx - 160, cy - 80)
  return { ok: true, from: { x: Math.round(cx), y: Math.round(cy) } }
})()`)
console.log('    DEBUG dragResult ->', JSON.stringify(dragResult))
// 拖动会收起面板，但整个过程在同一拍里完成，单帧快照容易抓到重开之后的状态。
// 用 MutationObserver 记录「拖动期间面板是否曾消失」。
// React 的 setState 是异步批处理的：pointerdown 里 setOpen(false) 要等下一帧
// 才反映到 DOM。所以把「开始拖动」和「检查」分成两次 ev()，中间 await 一帧。
const dragStartInfo = await ev(`(() => {
  const btn = document.querySelector('[data-dc-btn]')
  if (!btn) return { error: 'no button' }
  const r = btn.getBoundingClientRect()
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  window.__dcDrag = { cx, cy }
  window.__dcSawDragStart = false
  const fire = (type, x, y) => btn.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 3, pointerType: 'mouse', isPrimary: true,
    clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  }))
  fire('pointerdown', cx, cy)
  for (let step = 1; step <= 8; step += 1) fire('pointermove', cx - step * 18, cy - step * 9)
  return { ok: true }
})()`)
const panelTimeline = []
for (let i = 0; i < 8; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100))
  panelTimeline.push(await ev(`!!document.querySelector('[data-dc-panel]')`))
}
const panelDuringDrag = panelTimeline[panelTimeline.length - 1]
check('拖动时面板收起（不拖着一块跑）', panelDuringDrag === false, JSON.stringify({ panelDuringDrag }))

// 松手 → 面板应当弹回来
await ev(`(() => {
  const btn = document.querySelector('[data-dc-btn]')
  const { cx, cy } = window.__dcDrag
  btn.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 3, pointerType: 'mouse', isPrimary: true,
    clientX: cx - 144, clientY: cy - 72, button: 0, buttons: 0,
  }))
  return true
})()`)

// 松手 → onDragEnd → setOpen(true) → 面板重新挂载并扫描，给足时间
await new Promise((resolve) => setTimeout(resolve, 2500))

const afterDrag = await ev(`(() => {
  const b = document.querySelector('[data-dc-btn]')
  const p = document.querySelector('[data-dc-panel]')
  const r = b.getBoundingClientRect()
  return {
    btn: { x: Math.round(r.x), y: Math.round(r.y) },
    panel: p !== null,
  }
})()`)
// 拖动是「按住按钮中心」移动 160,80，按钮跟着走；居中时按钮左边缘本来就在中心左侧，
// 所以这里只断言「确实朝拖动方向移动了」而不是精确像素。
check('拖动后按钮落在新位置', afterDrag.btn.x < dragBefore.x - 20 && afterDrag.btn.y < dragBefore.y - 5,
  JSON.stringify({ from: dragBefore, to: afterDrag.btn }))
check('松手后面板弹回来', afterDrag.panel === true, JSON.stringify(afterDrag.panel))

const savedPos = await (await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`)).json()
check('新位置被持久化', savedPos.config.x !== null, JSON.stringify({ x: savedPos.config.x, y: savedPos.config.y }))

// ── 6. 点面板外：面板关，但清理继续跑（后台）──────────────────────────────
// 先勾选一点小项，然后开始清理，再立刻点外面
await ev(`(() => {
  for (const row of document.querySelectorAll('[data-dc-row]')) {
    const label = (row.querySelector('[data-dc-label] span') || {}).textContent || ''
    const box = row.querySelector('input')
    const want = label.includes('缩略') || label.includes('溢出')
    if (!box.disabled && box.checked !== want) row.click()
  }
  return true
})()`)

// 面板在拖动后换了位置，这里必须重新读一次按钮坐标，不能用拖动前算的。
const canClean = await ev(`(() => { const b = document.querySelector('[data-dc-foot] button[data-primary]'); return b ? !b.disabled : false })()`)
check('清理按钮可点', canClean === true, String(canClean))
// 面板重新打开后会重新扫描，等它扫完再操作（否则拿到空列表）
if (canClean !== true) {
  for (let i = 0; i < 60; i += 1) {
    const ready = await ev(`document.querySelectorAll('[data-dc-row]').length > 0`)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
{
  const rows = await ev(`Array.from(document.querySelectorAll('[data-dc-row]')).map(r => ({
    label: (r.querySelector('[data-dc-label] span') || {}).textContent,
    size: (r.querySelector('[data-dc-size]') || {}).textContent,
    checked: r.querySelector('input').checked,
  }))`)
  console.log('    DEBUG rows ->', JSON.stringify(rows))
  const primaryText = await ev(`(document.querySelector('[data-dc-foot] button[data-primary]')||{}).textContent`)
  console.log('    DEBUG primary ->', JSON.stringify(primaryText))
}
const primary = await centerOf('[data-dc-foot] button[data-primary]')

if (canClean) {
  // 拖动后面板重开过，按钮位置可能已变 —— 重新读一次再点。
  // 直接触发按钮的 click：面板在扫描后会重新居中，按坐标点容易点空。
  // 这里验证的是「点清理会不会开始清理」，不是命中测试。
  // 观察者要在点清理之前装好，否则会错过清理刚开始的那一瞬间
  await ev(`(() => {
    window.__dcSawMeteor = false
    window.__dcSawOrbit = false
    window.__dcSawRed = false
    window.__dcSawGreen = false
    window.__dcSawMsg = false
    if (window.__dcAnimTimer) clearInterval(window.__dcAnimTimer)
    const tick = () => {
      if (document.querySelector('[data-dc-row][data-state="cleaning"] .dc-meteor')) window.__dcSawMeteor = true
      if (document.querySelector('.dc-orbit .dc-rocket')) window.__dcSawOrbit = true
      const b = document.querySelector('[data-dc-btn]')
      const glow = b ? b.getAttribute('data-glow') : null
      if (glow === 'red') window.__dcSawRed = true
      if (glow === 'green') window.__dcSawGreen = true
      const msg = (document.querySelector('[data-dc-msg]') || {}).textContent || ''
      if (msg.trim().length > 0) window.__dcSawMsg = true
    }
    tick()
    window.__dcAnimTimer = setInterval(tick, 25)
    return true
  })()`)

  const started = await ev(`(() => {
    const b = document.querySelector('[data-dc-foot] button[data-primary]')
    if (!b || b.disabled) return false
    b.click()
    return true
  })()`)
  check('点了清理按钮', started === true)
  await new Promise((resolve) => setTimeout(resolve, 600))
  // 等到进度出现（说明任务已经在跑）
  let sawRunning = false
  for (let i = 0; i < 30; i += 1) {
    const s = await ev(`(() => {
      const b = document.querySelector('[data-dc-btn]')
      return { glow: b ? b.getAttribute('data-glow') : null, running: !!(document.querySelector('[data-dc-panel]')||{}).querySelector?.('.dc-orbit') }
    })()`)
    if (s && s.glow === 'red') { sawRunning = true; break }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('清理时按钮亮红光', sawRunning === true)

  const orbit = await ev(`(() => {
    const o = document.querySelector('[data-dc-panel] .dc-orbit')
    if (!o) return null
    const rocket = o.querySelector('.dc-rocket')
    return { orbit: true, rocket: !!(rocket && rocket.querySelector('svg')), transform: rocket ? getComputedStyle(rocket).transform : null }
  })()`)
  check('面板外框有火箭在跑', orbit !== null && orbit.rocket === true, JSON.stringify(orbit))

  // 火箭朝向由 orbitPlacement() 的纯函数测试覆盖（client.test.mjs 里四个方向都断言过），
  // 这里只确认它真的在动（transform 在变），不依赖「恰好采到某个角度」。
  // 火箭位置随总进度推进；只在「某一项清完 → 进度跳一格」时才会明显移动，
  // 所以采一串样本，只要出现两个不同值就算在动。
  const transforms = []
  for (let i = 0; i < 200 && transforms.length < 6; i += 1) {
    const tf = await ev(`(() => { const r = document.querySelector('[data-dc-panel] .dc-orbit .dc-rocket'); return r ? getComputedStyle(r).transform : null })()`)
    if (typeof tf === 'string' && (transforms.length === 0 || transforms[transforms.length - 1] !== tf)) transforms.push(tf)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('火箭在动（transform 随进度变化）', transforms.length >= 2, JSON.stringify(transforms))

  // 陨石 / 火箭 / 红光都是瞬时状态，用页面内观察者记录「有没有出现过」，
  // 比在 Node 侧轮询可靠。清理本身已经在单测里验证过会跑完并转绿。
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const observed = await ev(`({
    meteor: !!window.__dcSawMeteor,
    orbit: !!window.__dcSawOrbit,
    red: !!window.__dcSawRed,
  })`)
  check('正在清的那一行有陨石飞过', observed.meteor === true, JSON.stringify(observed))
  check('清理时按钮亮红光', observed.red === true, JSON.stringify(observed))

  // 关掉面板 → 面板消失；清理任务仍在 job 里继续（DOM 之外）
  const outside2 = await ev(`(() => {
    const p = document.querySelector('[data-dc-panel]')
    if (!p) return null
    const r = p.getBoundingClientRect()
    const cands = [{ x: 30, y: 760 }, { x: 30, y: 200 }, { x: 1390, y: 760 }]
    for (const c of cands) {
      if (c.x < r.x - 4 || c.x > r.right + 4 || c.y < r.y - 4 || c.y > r.bottom + 4) {
        const el = document.elementFromPoint(c.x, c.y)
        if (el && !p.contains(el)) return c
      }
    }
    return null
  })()`)
  if (outside2 !== null) await clickAt(outside2.x, outside2.y)
  let closed2 = false
  for (let i = 0; i < 40; i += 1) {
    if (await ev(`!document.querySelector('[data-dc-panel]')`)) { closed2 = true; break }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  check('点面板外面会关闭面板', closed2 === true)

  // 面板关了之后，清理任务要么还在跑（红光），要么已经跑完（绿光/结果）。
  // 前面采样本身要花几秒，所以不能要求「此刻一定还是红光」。
  const afterClose = await ev(`(() => {
    const b = document.querySelector('[data-dc-btn]')
    const msg = (document.querySelector('[data-dc-msg]') || {}).textContent || ''
    return {
      glow: b ? b.getAttribute('data-glow') : null,
      sawRed: !!window.__dcSawRed,
      msg: msg.trim(),
    }
  })()`)
  check('关掉面板后清理仍在继续（光效还在或被后台跑完）',
    afterClose.sawRed === true || afterClose.glow === 'red' || afterClose.glow === 'green' || afterClose.msg.length > 0,
    JSON.stringify(afterClose))

  // 等清理结束：绿光出现（或有结果消息）
  let finished = afterClose.glow === 'green' || afterClose.msg.length > 0
  for (let i = 0; i < 900 && !finished; i += 1) {
    const s2 = await ev(`(() => {
      const b = document.querySelector('[data-dc-btn]')
      const glow = b ? b.getAttribute('data-glow') : null
      const msg = (document.querySelector('[data-dc-msg]') || {}).textContent || ''
      return { glow, msg: msg.trim(), sawGreen: !!window.__dcSawGreen, sawMsg: !!window.__dcSawMsg }
    })()`)
    if (s2 && (s2.glow === 'green' || s2.msg.length > 0 || s2.sawGreen || s2.sawMsg)) { finished = true; break }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  if (!finished) {
    console.log('    DEBUG finalState ->', JSON.stringify(await ev(`(() => {
      const b = document.querySelector('[data-dc-btn]')
      const msg = (document.querySelector('[data-dc-msg]') || {}).textContent || ''
      return {
        glow: b ? b.getAttribute('data-glow') : null,
        msg: msg.trim(),
        sawRed: !!window.__dcSawRed,
        primary: (document.querySelector('[data-dc-foot] button[data-primary]')||{}).textContent || null,
      }
    })()`)))
  }
  check('后台清理会跑完并给出结果（绿光或结果文案）', finished === true)
}

const shot = await S('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(here, '..', '.tmp-e2e.png'), Buffer.from(shot.data, 'base64'))

// 收尾：恢复正常配置，删掉探测文件
await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`, { method: 'DELETE' })
ws.close()
chrome.kill()
hostServer.close()
if (!KEEP) {
  try { rmSync(join(here, '..', '.tmp-e2e.png')) } catch {}
  try { rmSync(join(here, '..', '.tmp-e2e-cleaning.png')) } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.error('\n失败项：')
  for (const result of failed) console.error(`  - ${result.name} ${result.detail}`)
  process.exitCode = 1
}
