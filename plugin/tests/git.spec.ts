import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildChanges,
  buildGitTree,
  foldLocDays,
  parseHistory,
  parseNumstat,
  WorkspaceGitIndex,
} from '../src/git.js'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function fakeCommit(hash: string, seconds: number, subject: string, files: [string, number, number][]) {
  return { hash, ts: seconds * 1000, subject, files: files.map(([path, add, del]) => ({ path, add, del })) }
}

test('parseHistory 解析提交头与 numstat 文件', () => {
  const text = [
    '\x1eaaa111\x1f1700000000\x1finit',
    '10\t2\tsrc/a.ts',
    '3\t0\tpackage.json',
    '',
    '\x1ebbb222\x1f1700003600\x1fsecond',
    '0\t8\tsrc/a.ts',
    '',
  ].join('\n')
  const commits = parseHistory(text)
  assert.equal(commits.length, 2)
  assert.equal(commits[0]?.subject, 'init')
  assert.equal(commits[0]?.files.length, 2)
  assert.equal(commits[1]?.files[0]?.path, 'src/a.ts')
  // Windows 路径统一为 /
  assert.deepEqual(parseHistory('\x1eccc\x1f1\x1fwin\n1\t0\tsrc\\b.ts\n')[0]?.files[0]?.path, 'src/b.ts')
})

test('parseNumstat 跳过空行与非法行', () => {
  assert.deepEqual(parseNumstat('12\t4\ta.ts\n0\t0\t\nbad\n'), [
    { path: 'a.ts', add: 12, del: 4 },
  ])
})

test('buildChanges 按文件展开并携带提交信息', () => {
  const commits = [
    fakeCommit('h1', 1700000000, 'feat', [['src/a.ts', 10, 2], ['src/b.ts', 3, 1]]),
    fakeCommit('h2', 1699990000, 'fix', [['README.md', 1, 0]]),
  ]
  const rows = buildChanges(commits)
  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.row.path, 'src/a.ts')
  assert.equal(rows[0]?.hash, 'h1')
  assert.match(rows[0]?.row.msg ?? '', /2 个文件/)
  assert.match(rows[0]?.row.time ?? '', /^\d{2}:\d{2}$/)
})

test('buildGitTree 聚合目录行且目录排在文件前', () => {
  const tree = buildGitTree([
    { path: 'src/components/A.tsx', add: 30, del: 2 },
    { path: 'src/lib/a.ts', add: 10, del: 0 },
    { path: 'package.json', add: 1, del: 1 },
  ])
  const src = tree.find((row) => row.path === 'src/')
  const components = tree.find((row) => row.path === 'src/components/')
  assert.ok(src?.directory)
  assert.equal(src?.add, 40)
  assert.equal(components?.add, 30)
  assert.ok(tree.indexOf(src as never) < tree.indexOf(tree.find((row) => row.path === 'src/components/A.tsx') as never))
})

test('foldLocDays 按本地日聚合近 180 天净变更', () => {
  const now = new Date(2026, 7, 13, 12).getTime()
  const days = foldLocDays([
    fakeCommit('h1', now / 1000, 'a', [['a.ts', 10, 4]]),
    fakeCommit('h2', now / 1000 - 86_400, 'b', [['a.ts', 3, 8]]),
  ], now)
  assert.equal(days.length, 2)
  assert.equal(days[0]?.net, -5)
  assert.equal(days[1]?.net, 6)
})

test('WorkspaceGitIndex 读取真实仓库（git 可用时）', { skip: !hasGit }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ths-git-'))
  try {
    git(dir, 'init')
    git(dir, 'config', 'user.email', 'test@example.invalid')
    git(dir, 'config', 'user.name', 'test')
    writeFileSync(join(dir, 'README.md'), 'hello\n')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'initial')
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'second commit')

    const index = new WorkspaceGitIndex(60_000)
    const view = await index.view(dir, Date.now())
    assert.ok(view)
    assert.ok(view.changes.length >= 2)
    assert.equal(view.changes[0]?.path, 'src/a.ts')
    assert.equal(view.changes[0]?.add, 1)
    assert.match(view.changes[0]?.msg ?? '', /second commit/)
    assert.ok(view.gitTree.length >= 2)
    assert.ok(view.gitTree.find((row) => row.path === 'src/'))
    assert.ok(view.gitTree.find((row) => row.path === 'src/a.ts'))
    assert.ok(view.locSeries.length >= 1)
    assert.ok(view.locSeries.reduce((sum, day) => sum + day.net, 0) > 0)
    // 服务端直读：HEAD 树覆盖到修改后的文件内容
    const diff = view.changes[0]?.diff
    assert.ok(diff)
    assert.match(diff, /\+export const b/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WorkspaceGitIndex 对非 git 目录返回 null 并负缓存', { skip: !hasGit }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ths-nogit-'))
  try {
    const index = new WorkspaceGitIndex(60_000)
    assert.equal(await index.view(dir, Date.now()), null)
    assert.equal(await index.view(dir, Date.now()), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
