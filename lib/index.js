/**
 * dsh-cleaner — host 半边
 *
 * 在 DSH webServer 上挂 /dsh-cleaner/*，负责三件事：
 *   1. 扫描「可清理目标」的占用（/targets、/scan）
 *   2. 逐项清理（/clean-item），逐项返回释放量，供面板做「正在清理哪一项」的动画
 *   3. 持久化用户偏好（/config）：浮动位置、显示模式、透明度、隐藏、目标开关
 *
 * 安全边界（重要）：
 *  - 能被删掉的路径全部由本进程用已知位置拼出来；浏览器只能传「目标 id」，
 *    永远传不了路径，所以这个接口不可能是任意文件删除器。
 *  - 每个目标声明自己的 roots；删除前逐条再走一次 inside() 白名单校验。
 *  - 只删 roots 里的「内容」，不删 roots 目录本身；$DSH_HOME 里的会话、
 *    附件图片（旧对话里的图）、凭证、设置、插件本体一律不碰。
 *  - 删不动的文件（被占用）跳过并计数，不中断整体流程。
 */
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { readdirSync as readdirSyncNative } from 'node:fs'

const ROUTE_PREFIX = '/dsh-cleaner'

/** 一次完整扫描的总时间预算；超时的那一项标 partial，面板照常可用。 */
const SCAN_BUDGET_MS = 9000
/** 单项清理预算。 */
const CLEAN_ITEM_BUDGET_MS = 120000
/** 扫描结果缓存多久；面板反复开关不该反复爬盘。 */
const SCAN_TTL_MS = 60000
const DAY = 24 * 60 * 60 * 1000

function env(name) {
  return process.env[name] || ''
}

function dshHome() {
  return resolve(env('DSH_HOME') || join(homedir(), '.dsh'))
}

function localAppData() {
  return resolve(env('LOCALAPPDATA') || join(homedir(), 'AppData', 'Local'))
}

function tempDir() {
  return resolve(env('TEMP') || env('TMP') || tmpdir())
}

/** 配置目录：跟随 $DSH_HOME，卸载 DSH 时自然一起走。 */
function configPath() {
  return join(dshHome(), 'dsh-cleaner', 'config.json')
}

/** 白名单校验：p 必须等于 root 或落在 root 里面。 */
function inside(path, root) {
  const p = resolve(path)
  const r = resolve(root)
  return p === r || p.startsWith(r + sep)
}

// ── 用户偏好 ────────────────────────────────────────────────────────────────

const MODES = ['float', 'icon', 'fixed', 'rail']

const DEFAULTS = Object.freeze({
  /** float=可拖动带文字；icon=可拖动纯图标；fixed=钉在右上角；rail=贴右边缘竖条。 */
  mode: 'float',
  /** float/icon 模式下记住的坐标（视口像素，左上角原点）；null=默认右上角。 */
  x: null,
  y: null,
  /** 面板不透明度 0.35–1。 */
  opacity: 0.82,
  /** 是否显示 0 字节（没有可清理内容）的条目。默认不显示，避免每次弹开一大片。 */
  showEmpty: false,
  /** 打开面板时，若确实有可清理内容才自动展开。默认 false：不要每次都弹开。 */
  autoExpand: false,
  /** 用户关掉的目标 id。 */
  disabled: [],
})

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function knownIds() {
  return definitions().map((target) => target.id)
}

/** 坐标：null/undefined/非数字一律当作「没记住位置」，让面板用默认右上角。 */
function normalizeCoordinate(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(20000, Math.max(-20000, n)))
}

/** 把外部传来的配置清洗成安全值：类型不对就回落到默认，绝不原样信任。 */
function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const config = {
    mode: MODES.includes(source.mode) ? source.mode : DEFAULTS.mode,
    x: normalizeCoordinate(source.x),
    y: normalizeCoordinate(source.y),
    opacity: clampNumber(source.opacity, 0.35, 1, DEFAULTS.opacity),
    showEmpty: source.showEmpty === true,
    autoExpand: source.autoExpand === true,
    disabled: [],
  }
  if (Array.isArray(source.disabled)) {
    const allowed = new Set(knownIds())
    config.disabled = [...new Set(source.disabled.filter((id) => typeof id === 'string' && allowed.has(id)))]
  }
  return config
}

let configCache = null

async function readConfig() {
  if (configCache !== null) return configCache
  try {
    const text = await readFile(configPath(), 'utf8')
    configCache = normalizeConfig(JSON.parse(text))
  } catch {
    configCache = normalizeConfig({})
  }
  return configCache
}

async function writeConfig(patch) {
  const current = await readConfig()
  const next = normalizeConfig({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
  configCache = next
  const file = configPath()
  await mkdir(join(dshHome(), 'dsh-cleaner'), { recursive: true })
  await writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

// ── 扫描与清理 ──────────────────────────────────────────────────────────────

/** 递归量一个条目（文件或目录）的字节数与文件数；超时只影响精度，不影响删除。 */
async function measure(target, deadline) {
  let bytes = 0
  let files = 0
  let complete = true
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (Date.now() > deadline) {
        complete = false
        return
      }
      const full = join(dir, entry.name)
      try {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile()) {
          const info = await stat(full)
          bytes += info.size
          files += 1
        }
      } catch {
        /* 不可读条目忽略 */
      }
    }
  }
  let info
  try {
    info = await stat(target)
  } catch {
    return { bytes: 0, files: 0, complete: true }
  }
  if (info.isFile()) return { bytes: info.size, files: 1, complete: true }
  if (!info.isDirectory()) return { bytes: 0, files: 0, complete: true }
  await walk(target)
  return { bytes, files, complete }
}

/** %LOCALAPPDATA% 下所有 *-updater 目录（各 Electron 软件自己的更新器）。 */
function updaterRoots() {
  const local = localAppData()
  let entries
  try {
    entries = readdirSyncNative(local, { withFileTypes: true })
  } catch {
    return []
  }
  const roots = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.toLowerCase().endsWith('-updater')) continue
    roots.push({
      path: join(local, entry.name),
      // 只删更新器留下的安装包本体，其它文件（日志、配置）不动。
      filter: (name, _full, info) =>
        name.toLowerCase() === 'installer.exe' && Date.now() - info.mtimeMs > 3 * DAY,
    })
  }
  return roots
}

/**
 * 目标定义。
 *  - roots[].filter(name, full, info) 把「整目录」收窄成「目录里符合条件的条目」。
 *  - defaultOn=false 的条目默认不勾选：它们会影响下次安装速度，或属于别的软件。
 */
function definitions() {
  const home = dshHome()
  const local = localAppData()
  const temp = tempDir()
  return [
    {
      id: 'dsh-search',
      group: 'dsh',
      label: 'DSH 搜索缓存',
      note: '搜索索引缓存，删掉后重新建索引。',
      defaultOn: true,
      roots: [{ path: join(home, 'cache', 'dsh-claude-style', 'search') }],
    },
    {
      id: 'dsh-image',
      group: 'dsh',
      label: 'DSH 图片缩略缓存',
      note: '图片预览缩略图，重新打开图片会自动重建。',
      defaultOn: true,
      roots: [{ path: join(home, 'cache', 'dsh-image-gen', 'inspiration') }],
    },
    {
      id: 'dsh-spill',
      group: 'dsh',
      label: 'DSH 溢出日志',
      note: '命令输出落盘的临时日志，任务结束后就没用了。',
      defaultOn: true,
      roots: [
        {
          path: temp,
          filter: (name) => name.startsWith('dsh-subprocess-') || name.startsWith('dsh-spill-'),
        },
      ],
    },
    {
      id: 'uv',
      group: 'dev',
      label: 'uv 包缓存',
      note: 'Python 依赖下载与构建缓存，通常几个 GB，用到时自动重新下载。',
      defaultOn: true,
      roots: [{ path: join(local, 'uv', 'cache') }],
    },
    {
      id: 'npm',
      group: 'dev',
      label: 'npm 缓存',
      note: 'npm 下载缓存，可安全重建。',
      defaultOn: true,
      roots: [{ path: join(local, 'npm-cache') }],
    },
    {
      id: 'pnpm',
      group: 'dev',
      label: 'pnpm 存储',
      note: 'pnpm 全局包内容存储。已装好的依赖仍然可用（硬链接各自独立），只影响下次安装的下载量。',
      defaultOn: true,
      roots: [{ path: join(local, 'pnpm', 'store') }],
    },
    {
      id: 'pip',
      group: 'dev',
      label: 'pip 缓存',
      note: 'pip 下载的 wheel 缓存，可安全重建。',
      defaultOn: true,
      roots: [{ path: join(local, 'pip', 'cache') }],
    },
    {
      id: 'temp-old',
      group: 'system',
      label: '临时文件（7 天前）',
      note: '系统临时目录里超过 7 天没动过的东西。正在用的文件删不掉，会自动跳过。',
      defaultOn: false,
      roots: [
        {
          path: temp,
          filter: (_name, _full, info) => Date.now() - info.mtimeMs > 7 * DAY,
        },
      ],
    },
    {
      id: 'updater-installers',
      group: 'system',
      label: '其他软件残留安装包',
      note: '各软件更新器下载后没删掉的 installer.exe，常常几百 MB 一个，下次更新会重新下载。',
      defaultOn: false,
      roots: updaterRoots(),
    },
  ]
}

/** 只保留用户没关掉的目标。 */
function enabledTargets(disabled) {
  const off = new Set(Array.isArray(disabled) ? disabled : [])
  return definitions().filter((target) => !off.has(target.id))
}

async function diskSpace() {
  try {
    const info = await statfs(dshHome())
    const blockSize = Number(info.bsize) || 0
    return {
      free: Number(info.bavail) * blockSize,
      total: Number(info.blocks) * blockSize,
    }
  } catch {
    return null
  }
}

/** 扫描一个目标：只统计 roots 里（或被 filter 选中的）内容。 */
async function scanTarget(target, deadline) {
  let bytes = 0
  let files = 0
  let partial = false
  let exists = false
  for (const root of target.roots) {
    let info
    try {
      info = await stat(root.path)
    } catch {
      continue
    }
    if (!info.isDirectory()) continue
    exists = true
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (Date.now() > deadline) {
        partial = true
        break
      }
      const full = join(root.path, entry.name)
      let entryInfo
      try {
        entryInfo = await stat(full)
      } catch {
        continue
      }
      if (root.filter !== undefined) {
        let keep = false
        try {
          keep = root.filter(entry.name, full, entryInfo) === true
        } catch {
          keep = false
        }
        if (!keep) continue
      }
      const size = await measure(full, deadline)
      bytes += size.bytes
      files += size.files
      if (!size.complete) partial = true
      if (Date.now() > deadline) {
        partial = true
        break
      }
    }
    if (partial) break
  }
  return { exists, bytes, files, partial }
}

/** 删除一个目标里符合条件的内容；返回释放字节、删掉的条目数、跳过数。 */
async function cleanTarget(target, deadline) {
  let freed = 0
  let removed = 0
  let skipped = 0
  let timedOut = false
  for (const root of target.roots) {
    let info
    try {
      info = await stat(root.path)
    } catch {
      continue
    }
    if (!info.isDirectory()) continue
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      skipped += 1
      continue
    }
    for (const entry of entries) {
      if (Date.now() > deadline) {
        timedOut = true
        break
      }
      const full = join(root.path, entry.name)
      // 删除前每一条都必须确实落在 root 里面。
      if (!inside(full, root.path)) {
        skipped += 1
        continue
      }
      let entryInfo
      try {
        entryInfo = await stat(full)
      } catch {
        continue
      }
      if (root.filter !== undefined) {
        let keep = false
        try {
          keep = root.filter(entry.name, full, entryInfo) === true
        } catch {
          keep = false
        }
        if (!keep) continue
      }
      const size = await measure(full, Math.min(deadline, Date.now() + 15000))
      try {
        await rm(full, { recursive: true, force: true, maxRetries: 2 })
        freed += size.bytes
        removed += 1
      } catch {
        skipped += 1
      }
    }
    if (timedOut) break
  }
  return { freed, removed, skipped, timedOut }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function normalized(value) {
  let s = String(value || '').trim()
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

let ctxHost = null

/** Origin / Referer 校验：只接受本面板自己发起的请求。拿不到 origin 时放行，避免面板打不开。 */
function guard(req, res) {
  let expected = null
  try {
    const service = ctxHost && ctxHost.webServer
    if (service && typeof service.getOrigin === 'function') expected = service.getOrigin()
  } catch {
    expected = null
  }
  const want = normalized(expected)
  if (want === '') return true
  const origin = normalized(req.headers && req.headers.origin)
  if (origin === '' || origin === want) return true
  const referer = normalized(req.headers && req.headers.referer)
  if (referer !== '' && referer.startsWith(want)) return true
  send(res, 403, { error: 'forbidden' })
  return false
}

/** 读 JSON body（配置写入用）；上限 64KB，避免被灌爆。 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 65536) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

let scanCache = { at: 0, payload: null }

export function apply(ctx, config) {
  const options = config && typeof config === 'object' ? config : {}
  const extraExcluded = new Set(Array.isArray(options.exclude) ? options.exclude : [])

  ctx.inject(['webServer'], (httpCtx) => {
    ctxHost = httpCtx

    const handler = async (req, res) => {
      let url
      try {
        url = new URL(req.url ?? '/', 'http://internal')
      } catch {
        return send(res, 400, { error: 'bad url' })
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] !== 'dsh-cleaner') return send(res, 404, { error: 'not found' })
      if (!guard(req, res)) return
      const action = parts[1] || 'targets'
      const method = (req.method || 'GET').toUpperCase()

      try {
        // ── 偏好读写 ─────────────────────────────────────────────────────
        if (action === 'config' && method === 'GET') {
          return send(res, 200, { config: await readConfig(), modes: MODES, defaults: DEFAULTS })
        }
        if (action === 'config' && method === 'POST') {
          const patch = await readJsonBody(req)
          const saved = await writeConfig(patch)
          return send(res, 200, { config: saved })
        }
        if (action === 'config' && method === 'DELETE') {
          configCache = null
          await writeConfig(DEFAULTS)
          return send(res, 200, { config: await readConfig() })
        }

        // ── 目标列表 ─────────────────────────────────────────────────────
        if (action === 'targets' && method === 'GET') {
          const prefs = await readConfig()
          const items = []
          for (const target of enabledTargets(prefs.disabled)) {
            if (extraExcluded.has(target.id)) continue
            let exists = false
            for (const root of target.roots) {
              try {
                const info = await stat(root.path)
                if (info.isDirectory()) {
                  exists = true
                  break
                }
              } catch {
                /* 不存在 */
              }
            }
            items.push({
              id: target.id,
              group: target.group,
              label: target.label,
              note: target.note,
              defaultOn: target.defaultOn,
              exists,
            })
          }
          return send(res, 200, { targets: items, disk: await diskSpace() })
        }

        // ── 扫描 ─────────────────────────────────────────────────────────
        if ((action === 'scan' || action === 'preview') && method === 'GET') {
          const force = url.searchParams.get('force') === '1'
          const fresh = Date.now() - scanCache.at < SCAN_TTL_MS && scanCache.payload !== null
          if (fresh && !force) return send(res, 200, { ...scanCache.payload, cached: true })

          const prefs = await readConfig()
          const started = Date.now()
          const items = []
          // 预算在整个扫描期间共享：前面的项很快时，后面的项能多用一点时间，
          // 但总时长不会失控（pnpm 有几万个文件，单独给每项 2.5s 会把它截断）。
          const deadline = started + SCAN_BUDGET_MS
          for (const target of enabledTargets(prefs.disabled)) {
            if (extraExcluded.has(target.id)) continue
            const size = await scanTarget(target, deadline)
            items.push({
              id: target.id,
              group: target.group,
              label: target.label,
              note: target.note,
              defaultOn: target.defaultOn,
              exists: size.exists,
              bytes: size.bytes,
              files: size.files,
              partial: size.partial,
            })
          }
          const payload = {
            items,
            totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
            tookMs: Date.now() - started,
            disk: await diskSpace(),
          }
          scanCache = { at: Date.now(), payload }
          return send(res, 200, { ...payload, cached: false })
        }

        // ── 单项清理：面板靠它做「正在清理哪一项」的进度 ──────────────────
        if (action === 'clean-item' && method === 'POST') {
          const id = url.searchParams.get('id') || ''
          const prefs = await readConfig()
          const target = enabledTargets(prefs.disabled).find((candidate) => candidate.id === id)
          if (target === undefined) return send(res, 200, { id, freed: 0, removed: 0, skipped: 0, missing: true })
          const before = await diskSpace()
          const result = await cleanTarget(target, Date.now() + CLEAN_ITEM_BUDGET_MS)
          scanCache = { at: 0, payload: null }
          return send(res, 200, {
            id: target.id,
            label: target.label,
            freed: result.freed,
            removed: result.removed,
            skipped: result.skipped,
            timedOut: result.timedOut,
            diskBefore: before,
            diskAfter: await diskSpace(),
          })
        }

        // ── 批量清理（无参=默认勾选项；?id= 指定）────────────────────────
        if (action === 'clean' && method === 'POST') {
          const prefs = await readConfig()
          const wanted = new Set(url.searchParams.getAll('id'))
          const pool = enabledTargets(prefs.disabled).filter((target) => !extraExcluded.has(target.id))
          const chosen = wanted.size > 0 ? pool.filter((target) => wanted.has(target.id)) : pool.filter((target) => target.defaultOn !== false)
          const before = await diskSpace()
          const started = Date.now()
          const deadline = started + CLEAN_ITEM_BUDGET_MS
          const results = []
          for (const target of chosen) {
            const result = await cleanTarget(target, deadline)
            results.push({
              id: target.id,
              label: target.label,
              freed: result.freed,
              removed: result.removed,
              skipped: result.skipped,
              timedOut: result.timedOut,
            })
          }
          scanCache = { at: 0, payload: null }
          return send(res, 200, {
            results,
            totalFreed: results.reduce((sum, item) => sum + item.freed, 0),
            totalRemoved: results.reduce((sum, item) => sum + item.removed, 0),
            totalSkipped: results.reduce((sum, item) => sum + item.skipped, 0),
            tookMs: Date.now() - started,
            diskBefore: before,
            diskAfter: await diskSpace(),
          })
        }

        return send(res, 404, { error: 'unknown action' })
      } catch (error) {
        return send(res, 500, { error: String(error && error.message ? error.message : error) })
      }
    }

    httpCtx.effect(
      () => httpCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
      'dsh-cleaner: cache APIs',
    )
  })
}
