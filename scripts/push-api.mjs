#!/usr/bin/env node
/**
 * 用 GitHub REST API 推送仓库内容（不走 git smart-HTTP）。
 *
 * 为什么：国内网络下 api.github.com 通常通畅，而 git 走的
 * `.../info/refs?service=git-receive-pack` 会被间歇性阻断
 * （表现为 Recv failure: Connection was reset）。改用 Git Data API
 * 逐个上传 blob、拼 tree、建 commit、移动 ref，效果与 git push 等价。
 *
 * 用法：node scripts/push-api.mjs [--dry]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'

const REPO_DIR = process.cwd()
const TOKEN_FILE = join(REPO_DIR, '..', '.github-token.txt')
const DRY = process.argv.includes('--dry')

const token = readFileSync(TOKEN_FILE, 'utf8').trim()
const git = (args) => execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' }).trim()

const remote = git(['remote', 'get-url', 'origin'])
const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote)
if (!match) throw new Error(`读不出仓库坐标：${remote}`)
const [, owner, repo] = match
console.log(`仓库：${owner}/${repo}`)

const IGNORED = new Set(['.git', 'node_modules', '.DS_Store'])
const TEXT_EXT = /\.(md|js|mjs|cjs|json|yml|yaml|txt|svg|css|html)$/i

async function api(path, init = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'dsh-cleaner-push',
          ...(init.headers || {}),
        },
      })
      const text = await response.text()
      let body
      try { body = JSON.parse(text) } catch { body = text }
      if (!response.ok) throw new Error(`${path} -> ${response.status} ${String(text).slice(0, 300)}`)
      return body
    } catch (error) {
      if (attempt === 5) throw error
      console.log(`  重试 ${attempt}/5（${String(error.message).slice(0, 90)}）`)
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt))
    }
  }
  return null
}

/** 收集要被提交的文件（跟 .gitignore 一致：只提交 git 已跟踪的）。 */
function trackedFiles() {
  const output = git(['ls-files', '-z'])
  return output.split('\0').filter(Boolean)
}

function isBinary(path) {
  return !TEXT_EXT.test(path)
}

const files = trackedFiles()
console.log(`待推送 ${files.length} 个文件`)

if (DRY) {
  for (const file of files) console.log('  ', file, statSync(join(REPO_DIR, file)).size + 'B')
  process.exit(0)
}

// 1) 取仓库当前 HEAD（可能是空的）
let parentSha = null
let baseTreeSha = null
try {
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`)
  parentSha = ref.object.sha
  const commit = await api(`/repos/${owner}/${repo}/git/commits/${parentSha}`)
  baseTreeSha = commit.tree.sha
  console.log(`已有 HEAD：${parentSha.slice(0, 8)}`)
} catch {
  console.log('仓库还是空的，先用 Contents API 起一个初始提交')
  // 空仓库上 Git Data API 会 409（"Git Repository is empty"）：
  // 没有第一个 commit 就没有可挂 blob/tree 的地方。
  // Contents API 能直接对空仓库写入并自动建首个提交，用它开个口子。
  const seedPath = '.gitignore'
  const seedContent = readFileSync(join(REPO_DIR, seedPath)).toString('base64')
  await api(`/repos/${owner}/${repo}/contents/${seedPath}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'chore: init', content: seedContent, branch: 'main' }),
  })
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`)
  parentSha = ref.object.sha
  const commit = await api(`/repos/${owner}/${repo}/git/commits/${parentSha}`)
  baseTreeSha = commit.tree.sha
  console.log(`初始提交：${parentSha.slice(0, 8)}`)
}

// 2) 逐个上传 blob
const tree = []
for (const file of files) {
  const content = readFileSync(join(REPO_DIR, file))
  const payload = { content: content.toString('base64'), encoding: 'base64' }
  const blob = await api(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  tree.push({ path: file.split(sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha })
  console.log(`  blob ${file} (${content.length}B)`)
}

// 3) 拼 tree
const treeBody = { tree }
if (baseTreeSha !== null) treeBody.base_tree = baseTreeSha
const newTree = await api(`/repos/${owner}/${repo}/git/trees`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(treeBody),
})
console.log(`tree：${newTree.sha.slice(0, 8)}`)

// 4) 建 commit
const message = git(['log', '-1', '--pretty=%B'])
const commitBody = { message, tree: newTree.sha, parents: parentSha === null ? [] : [parentSha] }
const newCommit = await api(`/repos/${owner}/${repo}/git/commits`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(commitBody),
})
console.log(`commit：${newCommit.sha.slice(0, 8)}`)

// 5) 移动 ref
if (parentSha === null) {
  await api(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 'refs/heads/main', sha: newCommit.sha }),
  })
} else {
  await api(`/repos/${owner}/${repo}/git/refs/heads/main`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  })
}

console.log(`\n推送完成：https://github.com/${owner}/${repo}`)
console.log(`提交：${newCommit.sha}`)

// 顺手把默认分支设成 main（新仓库默认可能是 master）
try {
  await api(`/repos/${owner}/${repo}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ default_branch: 'main' }),
  })
  console.log('默认分支已设为 main')
} catch (error) {
  console.log(`默认分支设置失败（不影响代码）：${String(error.message).slice(0, 120)}`)
}
