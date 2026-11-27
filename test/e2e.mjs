/**
 * 端到端验收：真实浏览器里的 client + 磁盘上最新代码起的 host。
 *
 * 为什么这样测：host 半边只在 DSH 启动时加载一次，改完必须重启 DSH 才生效；
 * 但 client 半边每次刷新页面都从磁盘重新读。用 CDP 的 Fetch 拦截把
 * `/dsh-cleaner/*` 转发到本文件里起的 host，就能在不重启 DSH 的前提下
 * 跑完整条链路（真实 React 渲染 + 真实新 host 响应）。
 *
 * 跑法：node test/e2e.mjs            # 全部检查
 *       node test/e2e.mjs --keep     # 保留截图
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, createHmac } from 'node:crypto'

const GUI = 'http://127.0.0.1:7651/'
const HOST_PORT = 7721
const CDP_PORT = 9451
const KEEP = process.argv.includes('--keep')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ── 1. 用磁盘上最新代码起 host ──────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
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
const hostServer = createServer((req, res) => hostHandler(req, res))
await new Promise((resolve) => hostServer.listen(HOST_PORT, '127.0.0.1', resolve))

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
const logs = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const waiter = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)))
    else waiter.resolve(msg.result)
    return
  }
  if (msg.method === 'Fetch.requestPaused') {
    const { requestId, request } = msg.params
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/dsh-cleaner/')) {
      void send('Fetch.continueRequest', { requestId }, sessionId)
      return
    }
    const headers = Object.entries(request.headers)
      .filter(([name]) => name.toLowerCase() !== 'host')
      .map(([name, value]) => ({ name, value }))
    void send('Fetch.continueRequest', {
      requestId,
      url: `http://127.0.0.1:${HOST_PORT}${url.pathname}${url.search}`,
      headers,
    }, sessionId)
    return
  }
  logs.push(msg)
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
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (method, params) => send(method, params, sessionId)

await S('Page.enable')
await S('Runtime.enable')
await S('Network.enable')
await S('Fetch.enable', { patterns: [{ urlPattern: '*/dsh-cleaner/*' }] })

const cookie = cookieFor(new URL(GUI).host)
await S('Network.setCookie', { name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true })
await S('Page.navigate', { url: GUI })
await new Promise((resolve) => setTimeout(resolve, 15000))

async function ev(expression) {
  const outcome = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (outcome.exceptionDetails) {
    return { ERR: String(outcome.exceptionDetails.exception?.description || outcome.exceptionDetails.text).slice(0, 300) }
  }
  return outcome.result.value
}

/** 关掉 DSH 自己的欢迎/预览弹窗，否则它会整片遮住按钮。 */
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

await dismissModals()
check('DSH 弹窗已清掉（不遮住测试目标）', (await ev(`document.querySelectorAll('[role="dialog"][aria-modal="true"]').length`)) === 0)

// ── 3. 按钮：渲染、位置、透明、可拖动 ──────────────────────────────────────
check('刷子按钮出现在页面上', (await ev(`!!document.querySelector('[data-dc-btn]')`)) === true)
check('按钮文字正确', (await ev(`(document.querySelector('[data-dc-btn]')||{}).textContent.trim()`) ) === '清理缓存',
  await ev(`(document.querySelector('[data-dc-btn]')||{}).textContent.trim()`))

const btnRect = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()`)
check('按钮在视口内', btnRect !== null && btnRect.x > 0 && btnRect.y > 0, JSON.stringify(btnRect))

const hit = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && (el === b || b.contains(el)) ? 'button' : (el ? el.tagName : 'none') })()`)
check('按钮可被鼠标命中（没被别的东西盖住）', hit === 'button', String(hit))

// 半透明：面板和按钮都必须用 color-mix + backdrop-filter，不能是 100% 实心
const translucent = await ev(`(() => {
  const css = (document.getElementById('dsh-cleaner-style') || {}).textContent || ''
  return {
    backdrop: css.includes('backdrop-filter'),
    colorMix: css.includes('color-mix'),
    panelVar: css.includes('--dc-panel-bg'),
  }
})()`)
check('按钮与面板用毛玻璃（backdrop-filter）', translucent.backdrop === true)
check('面板底色由不透明度算出（color-mix）', translucent.colorMix === true && translucent.panelVar === true)

// 拖动：用真实鼠标事件，把按钮拖到别处，再确认位置被记住
const dragStart = btnRect
await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x + 20, y: dragStart.y + 12, button: 'left', clickCount: 1 })
for (let step = 1; step <= 6; step += 1) {
  await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x + 20 - step * 22, y: dragStart.y + 12 + step * 14, button: 'left' })
}
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x + 20 - 132, y: dragStart.y + 12 + 84, button: 'left', clickCount: 1 })
await new Promise((resolve) => setTimeout(resolve, 1200))

const moved = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) } })()`)
check('按钮能被拖动到新位置', Math.abs(moved.x - dragStart.x) > 40, `从 ${dragStart.x},${dragStart.y} 到 ${moved.x},${moved.y}`)

const persisted = await (await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`)).json()
check('拖动后的坐标被持久化', persisted.config.x !== null && Math.abs(persisted.config.x - moved.x) <= 2,
  `保存 ${persisted.config.x},${persisted.config.y}；实际 ${moved.x},${moved.y}`)

// ── 4. 右键菜单 ────────────────────────────────────────────────────────────
const nowRect = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y } })()`)
await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: nowRect.x + 16, y: nowRect.y + 14, button: 'right', clickCount: 1 })
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nowRect.x + 16, y: nowRect.y + 14, button: 'right', clickCount: 1 })
await new Promise((resolve) => setTimeout(resolve, 700))

const menu = await ev(`(() => { const m = document.querySelector('[data-dc-menu]'); if (!m) return null; return { items: Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()), rect: (() => { const r = m.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })() } })()`)
check('右键弹出菜单', menu !== null)
check('菜单含四种形态', menu !== null && ['可拖动的按钮', '变成纯图标', '固定在右上角', '贴到右边缘'].every((label) => menu.items.some((item) => item.includes(label))),
  menu && menu.items.join(' | '))
check('菜单含隐藏', menu !== null && menu.items.some((item) => item.includes('隐藏')))
check('菜单在视口内', menu !== null && menu.rect.x >= 0 && menu.rect.y >= 0 && menu.rect.x + menu.rect.w <= 1440, menu && JSON.stringify(menu.rect))

// 切到纯图标
await ev(`(() => { const buttons = Array.from(document.querySelectorAll('[data-dc-menu] button')); const target = buttons.find((b) => b.textContent.includes('纯图标')); if (target) target.click(); return true })()`)
await new Promise((resolve) => setTimeout(resolve, 1200))
const iconShape = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); if (!b) return null; const r = b.getBoundingClientRect(); return { shape: b.getAttribute('data-shape'), w: Math.round(r.width), text: b.textContent.trim() } })()`)
check('纯图标形态生效（圆形、无文字）', iconShape !== null && iconShape.shape === 'icon' && iconShape.w <= 40 && iconShape.text === '',
  JSON.stringify(iconShape))

// 切回浮动
await (await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'float' }),
}))
await ev(`window.dispatchEvent(new Event('focus'))`)
await S('Page.reload')
await new Promise((resolve) => setTimeout(resolve, 13000))
await dismissModals()

// ── 5. 面板：0 字节不显示、半透明、逐项动画 ────────────────────────────────
check('刷新后按钮仍在', (await ev(`!!document.querySelector('[data-dc-btn]')`)) === true)

const rect2 = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect2.x, y: rect2.y, button: 'left', clickCount: 1 })
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect2.x, y: rect2.y, button: 'left', clickCount: 1 })
await new Promise((resolve) => setTimeout(resolve, 9000))

const panel = await ev(`(() => {
  const p = document.querySelector('[data-dc-panel]')
  if (!p) return null
  const r = p.getBoundingClientRect()
  const css = getComputedStyle(p)
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
    backdrop: css.backdropFilter || css.webkitBackdropFilter || '',
    rows: Array.from(document.querySelectorAll('[data-dc-row]')).map((row) => ({
      label: (row.querySelector('[data-dc-label] span') || {}).textContent,
      size: (row.querySelector('[data-dc-size]') || {}).textContent,
    })),
  }
})()`)
check('点一下能打开面板', panel !== null)
check('面板在视口内', panel !== null && panel.rect.y >= 0 && panel.rect.bottom <= 900, panel && JSON.stringify(panel.rect))
check('面板真的是半透明毛玻璃', panel !== null && String(panel.backdrop).includes('blur'), panel && panel.backdrop)
check('没有 0 字节的项（默认隐藏）', panel !== null && panel.rows.every((row) => !/^0 B$/.test(String(row.size))),
  panel && panel.rows.map((row) => `${row.label}=${row.size}`).join(', '))
check('至少列出了真有内容的项', panel !== null && panel.rows.length > 0, panel && String(panel.rows.length))

// 逐项清理动画：点清理，抓一帧「正在清理哪一项」
const cleanBtn = await ev(`(() => { const b = document.querySelector('[data-dc-foot] button[data-primary]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.textContent.trim(), disabled: b.disabled } })()`)
check('清理按钮可用', cleanBtn !== null && cleanBtn.disabled === false, cleanBtn && cleanBtn.label)

// 只留最小的一项，避免真删掉大缓存（用户机器上 pnpm 有 2GB）。
// 注意：0 字节的项默认不显示，所以先自己造一点真实内容，保证一定有可清的小项。
const { mkdir, writeFile: writeProbe } = await import('node:fs/promises')
const { join: joinPath } = await import('node:path')
const probeDir = joinPath(homedir(), '.dsh', 'cache', 'dsh-image-gen', 'inspiration', 'e2e-probe')
await mkdir(probeDir, { recursive: true })
await writeProbe(joinPath(probeDir, 'probe.bin'), Buffer.alloc(4096, 7))

await ev(`(() => { const b = document.querySelector('[data-dc-foot] button[data-primary]'); return true })()`)
// 内容变了要重新统计，才能看到新造的这一项
const rescan = await ev(`(() => { const buttons = Array.from(document.querySelectorAll('[data-dc-tools] button')); const b = buttons.find((x) => x.textContent.includes('重新统计')); if (b) b.click(); return !!b })()`)
void rescan
await new Promise((resolve) => setTimeout(resolve, 9000))

const picked = await ev(`(() => {
  const wanted = []
  for (const row of document.querySelectorAll('[data-dc-row]')) {
    const label = (row.querySelector('[data-dc-label] span') || {}).textContent || ''
    const box = row.querySelector('input')
    const want = label.includes('缩略')
    if (!box.disabled && box.checked !== want) row.click()
    if (want) wanted.push(label)
  }
  return wanted
})()`)
check('测试选中了真实存在的小项', Array.isArray(picked) && picked.length > 0, JSON.stringify(picked))

const cleanBtn2 = await ev(`(() => { const b = document.querySelector('[data-dc-foot] button[data-primary]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled } })()`)
check('清理按钮可点', cleanBtn2 !== null && cleanBtn2.disabled === false, cleanBtn2 && String(cleanBtn2.disabled))

await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: cleanBtn2.x, y: cleanBtn2.y, button: 'left', clickCount: 1 })
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cleanBtn2.x, y: cleanBtn2.y, button: 'left', clickCount: 1 })

// 清理可能极快（几毫秒），所以用高频率轮询抓帧，而不是每 180ms 看一眼。
let sawCleaning = false
let cleaningLabel = ''
let sawProgress = false
let sawAnyResult = false
for (let i = 0; i < 150; i += 1) {
  const snapshot = await ev(`(() => {
    const row = document.querySelector('[data-dc-row][data-state="cleaning"]')
    const doneRow = document.querySelector('[data-dc-row][data-state="done"]')
    const primary = document.querySelector('[data-dc-foot] button[data-primary]')
    const msg = document.querySelector('[data-dc-msg]')
    return {
      cleaning: row ? (row.querySelector('[data-dc-label] span') || {}).textContent : null,
      done: doneRow !== null,
      primary: primary ? primary.textContent.trim() : null,
      msg: msg ? msg.textContent.trim() : '',
    }
  })()`)
  if (snapshot) {
    if (snapshot.cleaning) {
      sawCleaning = true
      cleaningLabel = snapshot.cleaning
    }
    if (snapshot.done) sawAnyResult = true
    if (snapshot.primary && /\d+\/\d+/.test(snapshot.primary)) sawProgress = true
    if (snapshot.msg) sawAnyResult = true
  }
  if (sawCleaning && sawProgress && sawAnyResult) break
  await new Promise((resolve) => setTimeout(resolve, 40))
}
check('清理时能看出正在清哪一项（行高亮）', sawCleaning === true, cleaningLabel)
check('清理按钮显示 x/y 进度', sawProgress === true)
check('清理中出现完成态或被清空', sawAnyResult === true)

await new Promise((resolve) => setTimeout(resolve, 4000))
const done = await ev(`(() => { const m = document.querySelector('[data-dc-msg]'); return m ? m.textContent.trim() : null })()`)
check('清理后有结果反馈', typeof done === 'string' && done.length > 0, done)

const shot = await S('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(here, '..', '.tmp-e2e.png'), Buffer.from(shot.data, 'base64'))

// 恢复默认配置，别把测试状态留给用户
await fetch(`http://127.0.0.1:${HOST_PORT}/dsh-cleaner/config`, { method: 'DELETE' })

ws.close()
chrome.kill()
hostServer.close()
if (!KEEP) {
  try { rmSync(join(here, '..', '.tmp-e2e.png')) } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.error('\n失败项：')
  for (const result of failed) console.error(`  - ${result.name} ${result.detail}`)
  process.exitCode = 1
}
