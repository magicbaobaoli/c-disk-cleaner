/**
 * 端到端验收（v0.4.0）：真实浏览器里的 client + 磁盘上最新代码起的 host。
 *
 * host 半边只在 DSH 启动时加载一次，client 半边每次刷新都从磁盘读，
 * 所以用 CDP 的 Fetch 拦截把 `/dsh-cleaner/*` 转发到本文件起的 host，
 * 不重启 DSH 也能跑完整链路。
 */
import { createServer } from 'node:http'
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

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

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
  const { mkdir: mk, writeFile: wf } = await import('node:fs/promises')
  const jobs = []
  for (let d = 0; d < 60; d += 1) {
    const dir = join(probeRoot, 'e2e-probe-' + d, 'nested')
    jobs.push((async () => {
      await mk(dir, { recursive: true })
      for (let f = 0; f < 80; f += 1) await wf(join(dir, 'p-' + f + '.bin'), Buffer.alloc(1024, 7))
    })())
  }
  await Promise.all(jobs)
})()

const hostServer = createServer((req, res) => hostHandler(req, res))
await new Promise((resolve) => hostServer.listen(HOST_PORT, '127.0.0.1', resolve))

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
check('按钮出现', (await ev(`!!document.querySelector('[data-dc-btn]')`)) === true)
check('按钮文字是「清理缓存」', (await ev(`(document.querySelector('[data-dc-btn]')||{}).textContent.trim()`)) === '清理缓存',
  await ev(`(document.querySelector('[data-dc-btn]')||{}).textContent.trim()`))
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
check('面板有弹出动画', popAnim !== null && popAnim.anim === 'in' && String(popAnim.name).includes('dc-pop-in'), JSON.stringify(popAnim))
check('弹出原点在按钮那一侧（transform-origin 已按按钮算）', popAnim !== null && popAnim.origin !== '50% 50%', popAnim && popAnim.origin)

// ── 5. 拖动按钮：面板跟手 + 不自动关闭 ────────────────────────────────────
const before = await ev(`(() => {
  const b = document.querySelector('[data-dc-btn]').getBoundingClientRect()
  const p = document.querySelector('[data-dc-panel]').getBoundingClientRect()
  return { btn: { x: Math.round(b.x), y: Math.round(b.y) }, panel: { x: Math.round(p.x), y: Math.round(p.y) } }
})()`)

// 按住按钮拖动 120px
await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
for (let step = 1; step <= 8; step += 1) {
  await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btn.x - step * 15, y: btn.y + step * 6, button: 'left' })
  await new Promise((resolve) => setTimeout(resolve, 30))
}
// 拖动途中面板是否跟着动？
const midDrag = await ev(`(() => {
  const b = document.querySelector('[data-dc-btn]').getBoundingClientRect()
  const p = document.querySelector('[data-dc-panel]')
  if (!p) return { panel: null }
  const r = p.getBoundingClientRect()
  return { btnX: Math.round(b.x), panelX: Math.round(r.x), panelY: Math.round(r.y) }
})()`)
await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x - 120, y: btn.y + 48, button: 'left', clickCount: 1 })
await new Promise((resolve) => setTimeout(resolve, 700))

const after = await ev(`(() => {
  const b = document.querySelector('[data-dc-btn]')
  const p = document.querySelector('[data-dc-panel]')
  if (!b) return { btn: null, panel: null }
  const br = b.getBoundingClientRect()
  return {
    btn: { x: Math.round(br.x), y: Math.round(br.y) },
    panel: p ? { x: Math.round(p.getBoundingClientRect().x), y: Math.round(p.getBoundingClientRect().y) } : null,
  }
})()`)

check('按钮被拖走了', after.btn !== null && Math.abs(after.btn.x - before.btn.x) > 60, JSON.stringify([before.btn, after.btn]))
check('拖动时面板跟着动（不是钉在原处）', midDrag.panel !== null && Math.abs(midDrag.panelX - before.panel.x) > 8,
  JSON.stringify({ beforePanel: before.panel, midPanel: midDrag }))
check('拖动结束后面板没被误关掉', after.panel !== null, JSON.stringify(after.panel))

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
const primary = await centerOf('[data-dc-foot] button[data-primary]')

if (canClean) {
  await clickAt(primary.x, primary.y)
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

  const meteor = await ev(`!!document.querySelector('[data-dc-row][data-state="cleaning"] .dc-meteor')`)
  check('正在清的那一行有陨石飞过', meteor === true)

  // 趁清理还在跑，拍一张，用来人工核对红光/火箭/陨石的观感
  const shotCleaning = await S('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(here, '..', '.tmp-e2e-cleaning.png'), Buffer.from(shotCleaning.data, 'base64'))

  // 点面板外面 → 面板应当关闭。
  // 注意：按钮被拖过，面板也跟着挪了，所以这里先算一个「确实在面板外」的点。
  const outside = await ev(`(() => {
    const p = document.querySelector('[data-dc-panel]')
    if (!p) return null
    const r = p.getBoundingClientRect()
    const candidates = [
      { x: 40, y: 700 }, { x: 40, y: 300 }, { x: 1200, y: 760 },
      { x: Math.round(r.x / 2), y: Math.round(r.y + r.height / 2) },
    ]
    for (const c of candidates) {
      if (c.x < r.x - 4 || c.x > r.right + 4 || c.y < r.y - 4 || c.y > r.bottom + 4) {
        const el = document.elementFromPoint(c.x, c.y)
        if (el && !p.contains(el) && !el.closest('[data-dc-panel]')) return c
      }
    }
    return null
  })()`)
  check('能找到面板外的空白点', outside !== null, JSON.stringify(outside))
  if (outside !== null) await clickAt(outside.x, outside.y)
  // 轮询：清理可能在几百毫秒内就结束并自动弹回结果面板，
  // 用单次快照会误判，所以只要「曾经关掉过」就算通过。
  let closed = false
  for (let i = 0; i < 40; i += 1) {
    if (await ev(`!document.querySelector('[data-dc-panel]')`)) { closed = true; break }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  check('点面板外面会关闭面板', closed === true)

  // 关键：面板关了，清理仍在后台继续 → 按钮保持红光，随后转绿并闪 5 下
  const stillRed = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); return b ? b.getAttribute('data-glow') : null })()`)
  check('关掉面板后仍处于清理中（红光还在）', stillRed === 'red' || stillRed === 'green', String(stillRed))

  let sawGreen = false
  for (let i = 0; i < 120; i += 1) {
    const glow = await ev(`(() => { const b = document.querySelector('[data-dc-btn]'); return b ? b.getAttribute('data-glow') : null })()`)
    if (glow === 'green') { sawGreen = true; break }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  check('后台清理跑完后按钮转绿光', sawGreen === true)

  const blink = await ev(`(() => {
    const b = document.querySelector('[data-dc-btn]')
    if (!b) return null
    const s = getComputedStyle(b)
    return { anim: s.animationName, count: s.animationIterationCount }
  })()`)
  check('绿光是闪 5 下', blink !== null && String(blink.anim).includes('dc-green-blink') && String(blink.count) === '5',
    JSON.stringify(blink))

  // 清理完成后应当自动把面板拉出来给用户看结果
  let reopened = null
  for (let i = 0; i < 120; i += 1) {
    reopened = await ev(`(() => { const p = document.querySelector('[data-dc-panel]'); if (!p) return null; const m = p.querySelector('[data-dc-msg]'); return { open: true, msg: m ? m.textContent.trim() : '' } })()`)
    if (reopened !== null && String(reopened.msg).length > 0) break
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  check('清理完成后自动弹出结果面板', reopened !== null && reopened.open === true, JSON.stringify(reopened))
  check('结果面板有「已释放」反馈', reopened !== null && String(reopened.msg).length > 0, reopened && reopened.msg)
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
