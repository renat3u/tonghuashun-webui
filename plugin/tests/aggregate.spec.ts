import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UsageAggregator, dayKey, minuteKey, todayKey } from '../src/aggregate.js'
import type { DayStat, UsageRecord } from '../src/types.js'

function record(partial: Partial<UsageRecord> & Pick<UsageRecord, 'ts'>): UsageRecord {
  return {
    sessionId: 's1',
    turn: 1,
    step: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    ...partial,
  }
}

/** 本地时间 10:30 的 epoch ms。 */
function atLocal(hours: number, minutes: number, dayOffset = 0): number {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hours, minutes, 0, 0)
  return d.getTime()
}

test('minuteKey / dayKey 取本地时间', () => {
  const ts = atLocal(10, 30)
  assert.equal(minuteKey(ts), '10:30')
  assert.equal(dayKey(ts), todayKey(Date.now()))
})

test('fold 累计分钟桶与总量', () => {
  const agg = new UsageAggregator()
  agg.fold(record({ ts: atLocal(10, 30), sessionId: 'a', cwd: '/w1', model: 'm1' }))
  agg.fold(record({ ts: atLocal(10, 30), sessionId: 'b', cwd: '/w1', model: 'm1' }))
  agg.fold(record({ ts: atLocal(10, 31), sessionId: 'a', cwd: '/w2', inputTokens: 0, outputTokens: 0 }))
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.totalTokens, 150 + 150)
  assert.equal(snap.minuteSeries.length, 2)
  assert.equal(snap.minuteSeries[0]?.minute, '10:30')
  assert.equal(snap.minuteSeries[0]?.tokens, 300)
})

test('按天 / 工作区 / 模型分桶', () => {
  const agg = new UsageAggregator()
  agg.fold(record({ ts: atLocal(9, 0), sessionId: 'a', cwd: '/w1', model: 'm1', inputTokens: 100, outputTokens: 0 }))
  agg.fold(record({ ts: atLocal(9, 30, -1), sessionId: 'b', cwd: '/w2', model: 'm2', inputTokens: 0, outputTokens: 60 }))
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.daySeries.length, 2)
  const today = snap.today
  assert.ok(today)
  assert.equal(today.tokens, 100)
  assert.equal(today.byWorkspace['/w1'], 100)
  assert.equal(today.byModel['m1'], 100)
  assert.equal(today.sessions, 1)
  const ws = snap.workspaces.find((w) => w.cwd === '/w1')
  assert.ok(ws)
  assert.equal(ws.tokens, 100)
  assert.equal(ws.sessions, 1)
  const models = snap.models.map((m) => m.model).sort()
  assert.deepEqual(models, ['m1', 'm2'])
})

test('toolCall 计数归属当天与工作区', () => {
  const agg = new UsageAggregator()
  agg.countToolCall(atLocal(11, 0), '/w1')
  agg.countToolCall(atLocal(11, 1), '/w1')
  agg.countToolCall(atLocal(11, 2), undefined)
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.today?.toolCalls, 3)
  assert.equal(snap.today?.workspaceToolCalls['/w1'], 2)
  assert.equal(snap.today?.workspaceToolCalls['(no cwd)'], 1)
  const ws = snap.workspaces.find((w) => w.cwd === '/w1')
  assert.equal(ws?.toolCalls, 2)
})

test('foldDay 合并持久化历史，重启后日线连续', () => {
  const agg = new UsageAggregator()
  const yesterday = dayKey(atLocal(12, 0, -1))
  const history: DayStat = {
    date: yesterday,
    tokens: 1000,
    inputTokens: 800,
    outputTokens: 200,
    byWorkspace: { '/w1': 1000 },
    workspaceSessions: { '/w1': 3 },
    workspaceToolCalls: { '/w1': 5 },
    byModel: { m1: 1000 },
    sessions: 3,
    toolCalls: 5,
  }
  agg.foldDay(history)
  agg.fold(record({ ts: atLocal(13, 0), sessionId: 'a', cwd: '/w1' }))
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.daySeries.length, 2)
  assert.equal(snap.daySeries[0]?.date, yesterday)
  assert.equal(snap.daySeries[0]?.tokens, 1000)
  assert.equal(snap.totalTokens, 1000 + 150)
  const ws = snap.workspaces.find((w) => w.cwd === '/w1')
  assert.equal(ws?.tokens, 1150)
  assert.equal(ws?.sessions, 3)
  assert.equal(ws?.toolCalls, 5)
})

test('foldDayToolCalls 只补工具调用/会话数，不重复加 token', () => {
  const agg = new UsageAggregator()
  const ts = atLocal(15, 0)
  agg.fold(record({ ts, sessionId: 's1', cwd: '/w1', model: 'm1' }))
  const today = todayKey(ts)
  const day: DayStat = {
    date: today,
    tokens: 9999,
    inputTokens: 0,
    outputTokens: 0,
    byWorkspace: { '/w1': 9999 },
    workspaceSessions: { '/w1': 3 },
    workspaceToolCalls: { '/w1': 5 },
    byModel: { m1: 9999 },
    sessions: 3,
    toolCalls: 5,
  }
  agg.foldDayToolCalls(day)
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.totalTokens, 150) // 只来自 usage record
  assert.equal(snap.today?.tokens, 150)
  assert.equal(snap.today?.toolCalls, 5)
  assert.equal(snap.today?.workspaceToolCalls['/w1'], 5)
  const ws = snap.workspaces.find((w) => w.cwd === '/w1')
  assert.equal(ws?.tokens, 150)
  assert.equal(ws?.toolCalls, 5)
  assert.equal(ws?.sessions, 3)
})

test('重复折叠同一会话的同一天不重复计 sessions', () => {
  const agg = new UsageAggregator()
  agg.fold(record({ ts: atLocal(14, 0), sessionId: 's1' }))
  agg.fold(record({ ts: atLocal(14, 30), sessionId: 's1' }))
  agg.fold(record({ ts: atLocal(14, 40), sessionId: 's2' }))
  const snap = agg.snapshot(Date.now())
  assert.equal(snap.today?.sessions, 2)
})
