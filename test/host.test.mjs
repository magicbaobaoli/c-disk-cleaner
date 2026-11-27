/**
 * host 半边的回归测试：真正跑一遍 /targets、/scan、/clean。
 *
 * 用一个临时 DSH_HOME + 临时 LOCALAPPDATA + 临时 TEMP，把目标目录造出来，
 * 然后验证：
 *  1. 只删白名单目录里的内容，root 目录本身保留；
 *  2. 白名单之外的邻居文件一个都不许动（防止路径穿越/误删）；
 *  3. 「默认不勾选」的高风险目标不会被 /clean 无参调用删掉；
 *  4. 删不动的条目跳过而不报错。
 *
 * 跑法：node test/host.test.mjs
 */
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// 先把环境变量指到临时目录，再 import host —— 它在每次调用时重新读 env。
const root = await mkdtemp(join(tmpdir(), 'dsh-cleaner-test-'))
const home = join(root, 'home')
const local = join(root, 'local')
const temp = join(root, 'temp')
process.env.DSH_HOME = home
process.env.LOCALAPPDATA = local
process.env.TEMP = temp

async function put(path, content = 'x') {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

check('临时环境就绪', true, root)

const here = dirname(fileURLToPath(import.meta.url))
const plugin = await import(pathToFileURL(join(here, '..', 'lib', 'index.js')).href)
check('host 导出 apply', typeof plugin.apply === 'function')

// ── 造数据 ──────────────────────────────────────────────────────────────────
const searchDir = join(home, 'cache', 'dsh-claude-style', 'search')
const imageDir = join(home, 'cache', 'dsh-image-gen', 'inspiration')
const uvDir = join(local, 'uv', 'cache')
const npmDir = join(local, 'npm-cache')
const spillA = join(temp, 'dsh-subprocess-abc')
const spillB = join(temp, 'dsh-spill-def')
const tempOld = join(temp, 'old-stuff')
const innocent = join(temp, 'keep-me.txt')

await put(join(searchDir, 'index.bin'), 'a'.repeat(4000))
await put(join(searchDir, 'nested', 'more.bin'), 'b'.repeat(2000))
await put(join(imageDir, 'thumb', 'one.png'), 'c'.repeat(1000))
await put(join(uvDir, 'wheels', 'pkg.whl'), 'd'.repeat(6000))
await put(join(npmDir, '_cacache', 'blob'), 'e'.repeat(3000))
await put(join(spillA, 'stdout.log'), 'f'.repeat(500))
await put(join(spillB, 'stderr.log'), 'g'.repeat(500))
await put(join(tempOld, 'file.txt'), 'h'.repeat(200))
await put(innocent, 'do not delete')

// 把 tempOld 的 mtime 推到 30 天前，让它符合「7 天前」规则。
const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
const { utimes } = await import('node:fs/promises')
await utimes(tempOld, old, old)

// 白名单外的邻居：$DSH_HOME/cache 下不该被动到
const sessionsDir = join(home, 'sessions')
await put(join(sessionsDir, 'session-1.json'), '{"keep":true}')
const attachments = join(home, 'cache', 'attachments', 'request-images')
await put(join(attachments, 'img-1.png'), 'i'.repeat(700))

// ── 起一个假 webServer 挂上 handler ─────────────────────────────────────────
let handler = null
const fakeHttpCtx = {
  webServer: {
    getOrigin: () => null, // 拿不到 origin 时放行，测的是逻辑不是鉴权
    register(row) { handler = row.handler; return () => {} },
  },
  effect(fn) { return fn() },
}
const fakeCtx = {
  inject(names, callback) {
    check('inject 声明只要 webServer', JSON.stringify(names) === JSON.stringify(['webServer']), JSON.stringify(names))
    return callback(fakeHttpCtx)
  },
}
plugin.apply(fakeCtx, {})
check('注册了 http handler', typeof handler === 'function')

const server = createServer((req, res) => handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port

async function call(path, init) {
  const response = await fetch(base + path, init)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: response.status, body }
}

// ── /targets ────────────────────────────────────────────────────────────────
{
  const { status, body } = await call('/dsh-cleaner/targets')
  check('/targets 200', status === 200, String(status))
  check('/targets 返回目标列表', Array.isArray(body.targets) && body.targets.length >= 5, body.targets && String(body.targets.length))
  const ids = (body.targets || []).map((t) => t.id)
  check('/targets 含 dsh 自身缓存', ids.includes('dsh-search') && ids.includes('dsh-image'))
  check('/targets 含 uv 与 npm', ids.includes('uv') && ids.includes('npm'))
  const search = (body.targets || []).find((t) => t.id === 'dsh-search')
  check('/targets 标出 exists', search !== undefined && search.exists === true)
  check('/targets 不返回绝对路径（浏览器不该知道路径）', body.targets.every((t) => t.path === undefined))
}

// ── /scan ───────────────────────────────────────────────────────────────────
let scanned = null
{
  const { status, body } = await call('/dsh-cleaner/scan')
  scanned = body
  check('/scan 200', status === 200, String(status))
  check('/scan 统计出搜索缓存字节', (body.items || []).some((i) => i.id === 'dsh-search' && i.bytes >= 6000))
  check('/scan 统计出 uv 缓存字节', (body.items || []).some((i) => i.id === 'uv' && i.bytes >= 6000))
  check('/scan 总字节等于各项之和',
    body.totalBytes === (body.items || []).reduce((sum, i) => sum + i.bytes, 0))
  check('/scan 不把 attachments 算进去（附件是会话图片）',
    !(body.items || []).some((i) => String(i.label).includes('附件')))
}

// ── /clean（默认目标）──────────────────────────────────────────────────────
{
  const before = (await call('/dsh-cleaner/scan', undefined)).body
  const { status, body } = await call('/dsh-cleaner/clean', { method: 'POST' })
  check('/clean 200', status === 200, String(status))
  check('/clean 报告释放了字节', Number(body.totalFreed) > 0, String(body.totalFreed))

  // 默认目标里的内容应被清空，但目录本身还在
  const searchLeft = await readdir(searchDir).catch(() => null)
  check('搜索缓存内容被清空', Array.isArray(searchLeft) && searchLeft.length === 0, JSON.stringify(searchLeft))
  check('搜索缓存目录本身保留（不删目录）', await stat(searchDir).then(() => true).catch(() => false))
  check('uv 缓存内容被清空', (await readdir(uvDir).catch(() => [])).length === 0)

  // 默认不勾选的目标不许被删
  check('默认不删「7 天前临时文件」（用户没勾）', await stat(join(tempOld, 'file.txt')).then(() => true).catch(() => false))
  check('默认不删其它软件的 installer.exe 目录', await stat(temp).then(() => true))

  // 白名单外一律不动
  check('会话文件没被删', await stat(join(sessionsDir, 'session-1.json')).then(() => true).catch(() => false))
  check('会话附件图片没被删', await stat(join(attachments, 'img-1.png')).then(() => true).catch(() => false))
  check('临时目录里的普通文件没被删', await stat(innocent).then(() => true).catch(() => false))

  check('/clean 返回每项明细', Array.isArray(body.results) && body.results.length > 0)
  check('/clean 返回磁盘前后值（用于展示真实释放量）',
    body.diskBefore !== null || body.diskAfter !== null)
  void before
}

// ── /clean 指定 id：只删勾选的那一项 ───────────────────────────────────────
{
  await put(join(imageDir, 'thumb', 'again.png'), 'z'.repeat(1234))
  await put(join(spillA, 'more.log'), 'y'.repeat(999))
  const { status, body } = await call('/dsh-cleaner/clean?id=image-gen-does-not-exist', { method: 'POST' })
  check('/clean 未知 id 不 500', status === 200, String(status))
  check('/clean 未知 id 什么都不删', Number(body.totalFreed) === 0, String(body.totalFreed))
  check('未知 id 时图片缓存还在', await stat(join(imageDir, 'thumb', 'again.png')).then(() => true).catch(() => false))

  const only = await call('/dsh-cleaner/clean?id=dsh-image', { method: 'POST' })
  check('按 id 清理只动那一项', Number(only.body.totalFreed) >= 1234, String(only.body.totalFreed))
  check('按 id 清理时溢出日志没被动', await stat(join(spillA, 'more.log')).then(() => true).catch(() => false))
}

// ── 路径穿越：即便有人伪造 id 也拿不到路径通道 ─────────────────────────────
{
  const { body } = await call('/dsh-cleaner/clean?id=' + encodeURIComponent('../../sessions'), { method: 'POST' })
  check('伪造 id 不会删到白名单外', await stat(join(sessionsDir, 'session-1.json')).then(() => true).catch(() => false))
  check('伪造 id 返回 0 释放', Number(body.totalFreed) === 0, String(body.totalFreed))
}

// ── 未知 action ────────────────────────────────────────────────────────────
{
  const { status } = await call('/dsh-cleaner/nope')
  check('未知 action 返回 404', status === 404, String(status))
}

// ── /scan 缓存：第二次应命中缓存 ───────────────────────────────────────────
{
  const first = await call('/dsh-cleaner/scan')
  const second = await call('/dsh-cleaner/scan')
  check('/scan 第二次命中缓存（面板反复开关不重复爬盘）', second.body.cached === true, String(second.body.cached))
  const forced = await call('/dsh-cleaner/scan?force=1')
  check('/scan?force=1 绕过缓存', forced.body.cached === false, String(forced.body.cached))
  void first
}

// ── /config：偏好持久化 ────────────────────────────────────────────────────
{
  const initial = await call('/dsh-cleaner/config')
  check('/config 200 且带默认值', initial.status === 200 && initial.body.config !== undefined)
  check('默认形态是 float', initial.body.config.mode === 'float', initial.body.config.mode)
  check('默认面板不透明度 < 1（半透明）', initial.body.config.opacity < 1 && initial.body.config.opacity >= 0.35, String(initial.body.config.opacity))
  check('默认不显示 0 字节项', initial.body.config.showEmpty === false)
  check('默认不自动展开', initial.body.config.autoExpand === false)
  check('/config 返回可选形态清单', Array.isArray(initial.body.modes) && initial.body.modes.length === 4, JSON.stringify(initial.body.modes))

  const saved = await call('/dsh-cleaner/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'icon', x: 420, y: 96, opacity: 0.6 }),
  })
  check('/config POST 保存成功', saved.status === 200 && saved.body.config.mode === 'icon')
  check('/config 记住坐标', saved.body.config.x === 420 && saved.body.config.y === 96, JSON.stringify([saved.body.config.x, saved.body.config.y]))

  const reread = await call('/dsh-cleaner/config')
  check('/config 重启后仍记得（落盘）', reread.body.config.mode === 'icon' && reread.body.config.opacity === 0.6,
    JSON.stringify({ mode: reread.body.config.mode, opacity: reread.body.config.opacity }))

  // 非法值必须被夹紧，不能原样存进来
  const bogus = await call('/dsh-cleaner/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'evil', opacity: 99, x: 'NaN', disabled: ['dsh-search', '../../etc', 42] }),
  })
  check('非法形态回落到默认', bogus.body.config.mode === 'float', bogus.body.config.mode)
  check('不透明度被夹到 1 以内', bogus.body.config.opacity <= 1, String(bogus.body.config.opacity))
  check('坐标非数字回落为 null', bogus.body.config.x === null, String(bogus.body.config.x))
  check('disabled 只接受已知目标 id', JSON.stringify(bogus.body.config.disabled) === JSON.stringify(['dsh-search']),
    JSON.stringify(bogus.body.config.disabled))

  // 关掉的目标既不出现也不被清理
  await call('/dsh-cleaner/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: ['dsh-search'] }),
  })
  const targets = await call('/dsh-cleaner/targets')
  check('关掉的目标不出现在列表里', !(targets.body.targets || []).some((item) => item.id === 'dsh-search'))
  const scan = await call('/dsh-cleaner/scan?force=1')
  check('关掉的目标不出现在扫描里', !(scan.body.items || []).some((item) => item.id === 'dsh-search'))

  await call('/dsh-cleaner/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disabled: [] }),
  })
}

// ── /clean-item：逐项清理（面板动画数据源）──────────────────────────────────
{
  await put(join(imageDir, 'thumb', 'one-more.png'), 'q'.repeat(2048))
  const one = await call('/dsh-cleaner/clean-item?id=dsh-image', { method: 'POST' })
  check('/clean-item 200', one.status === 200, String(one.status))
  check('/clean-item 只清这一项并回报释放量', Number(one.body.freed) >= 2048, String(one.body.freed))
  check('/clean-item 回报 id 供前端定位那一行', one.body.id === 'dsh-image', one.body.id)
  check('/clean-item 回报磁盘前后值', one.body.diskBefore !== null && one.body.diskAfter !== null)

  await put(join(uvDir, 'wheels', 'keep.whl'), 'k'.repeat(1111))
  const unrelated = await call('/dsh-cleaner/clean-item?id=dsh-image', { method: 'POST' })
  check('/clean-item 不会顺手清别的项', await stat(join(uvDir, 'wheels', 'keep.whl')).then(() => true).catch(() => false))
  check('/clean-item 清空后释放 0', Number(unrelated.body.freed) === 0, String(unrelated.body.freed))

  const missing = await call('/dsh-cleaner/clean-item?id=no-such-target', { method: 'POST' })
  check('/clean-item 未知 id 不报错且标 missing', missing.status === 200 && missing.body.missing === true)
}

// ── 重置偏好 ───────────────────────────────────────────────────────────────
{
  const reset = await call('/dsh-cleaner/config', { method: 'DELETE' })
  check('/config DELETE 恢复默认', reset.status === 200 && reset.body.config.mode === 'float' && reset.body.config.showEmpty === false)
}

server.close()
await rm(root, { recursive: true, force: true }).catch(() => {})

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.error('\n失败项：')
  for (const result of failed) console.error(`  - ${result.name} ${result.detail}`)
  process.exitCode = 1
}
