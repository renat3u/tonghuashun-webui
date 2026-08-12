import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore, resolveDataDir } from '../src/store.js'
import type { DayStat, UsageRecord } from '../src/types.js'

function usage(ts: number): UsageRecord {
  return {
    ts,
    sessionId: 's1',
    turn: 1,
    step: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

test('resolveDataDir：显式配置优先，缺省落在 DSH_HOME/tonghuashun', () => {
  const explicit = resolveDataDir('/tmp/ths')
  assert.equal(explicit, '/tmp/ths')
  assert.throws(() => resolveDataDir(''), /non-empty string/)
  assert.throws(() => resolveDataDir(42), /non-empty string/)
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/fake-dsh'
  assert.ok(resolveDataDir(undefined).endsWith(join('fake-dsh', 'tonghuashun')))
  process.env.DSH_HOME = old
})

test('appendUsage 写入 usage.jsonl；loadDays 从 days.json 恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ths-meter-'))
  const store = createStore(dir)
  try {
    assert.deepEqual(await store.loadDays(), [])
    await store.appendUsage([usage(1000), usage(2000)])
    const lines = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0] ?? '{}').ts, 1000)

    const day: DayStat = {
      date: '2026-08-12',
      tokens: 30,
      inputTokens: 20,
      outputTokens: 10,
      byWorkspace: { '/w': 30 },
      workspaceSessions: { '/w': 1 },
      workspaceToolCalls: { '/w': 2 },
      byModel: { m1: 30 },
      sessions: 1,
      toolCalls: 2,
    }
    store.commitDays([day])
    await store.flush()

    const store2 = createStore(dir)
    const days = await store2.loadDays()
    assert.equal(days.length, 1)
    assert.equal(days[0]?.tokens, 30)
    assert.equal(days[0]?.workspaceToolCalls['/w'], 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('损坏的 days.json 被忽略并告警（不抛给调用方）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ths-meter-'))
  try {
    await import('node:fs/promises').then(({ writeFile }) => writeFile(join(dir, 'days.json'), '{broken', 'utf8'))
    const warnings: string[] = []
    const store = createStore(dir, (message) => warnings.push(message))
    const days = await store.loadDays()
    assert.deepEqual(days, [])
    assert.ok(warnings.length >= 1)
    assert.match(warnings[0] ?? '', /days\.json/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('数据目录不可写时降级为内存记账且不抛', async () => {
  // 用一个文件的子路径作为 dataDir，mkdir 必然失败
  const dir = await mkdtemp(join(tmpdir(), 'ths-meter-'))
  const blocker = join(dir, 'blocker')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(blocker, 'x', 'utf8'))
  try {
    const warnings: string[] = []
    const store = createStore(join(blocker, 'sub'), (message) => warnings.push(message))
    await store.appendUsage([usage(1)]) // 不应抛
    await store.flush()
    assert.ok(warnings.length >= 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
