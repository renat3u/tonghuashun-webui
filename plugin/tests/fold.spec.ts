import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldSession, usageTokens } from '../src/fold.js'
import type { FoldCursor, MeterEvent, MeterSession, UsageRecord } from '../src/types.js'

function session(events: MeterEvent[], cwd?: string): MeterSession {
  return { header: { id: 's1', ...(cwd !== undefined ? { cwd } : {}) }, events }
}

function event(type: string, seq: number, time: number, data: unknown): MeterEvent {
  return { type, seq, time, data }
}

function usageEvent(seq: number, time: number, usage: Record<string, unknown>): MeterEvent {
  return event('assistant/message', seq, time, { turn: 2, step: 3, usage })
}

const USAGE = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 5 }

test('usageTokens 合计所有不相交桶', () => {
  assert.equal(usageTokens(USAGE), 165)
  assert.equal(usageTokens({ inputTokens: 1, outputTokens: 2 }), 3)
})

test('从游标之后开始折叠并推进游标', () => {
  const events = [
    usageEvent(0, 1000, USAGE),
    usageEvent(1, 2000, { inputTokens: 1, outputTokens: 1 }),
  ]
  const records: UsageRecord[] = []
  const cursor: FoldCursor = { consumed: 1 }
  foldSession(session(events), cursor, (r) => records.push(r))
  assert.equal(cursor.consumed, 2)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.ts, 2000)
})

test('assistant/message 带 usage 时生成记录，字段完整', () => {
  const events = [
    event('request/header', 0, 500, { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } } }),
    usageEvent(1, 1000, USAGE),
  ]
  const records: UsageRecord[] = []
  foldSession(session(events, 'E:\\WSL'), { consumed: 0 }, (r) => records.push(r))
  assert.equal(records.length, 1)
  const r = records[0]
  assert.ok(r)
  assert.equal(r.sessionId, 's1')
  assert.equal(r.cwd, 'E:\\WSL')
  assert.equal(r.provider, 'deepseek-official')
  assert.equal(r.model, 'deepseek-v4-pro')
  assert.equal(r.turn, 2)
  assert.equal(r.step, 3)
  assert.equal(r.inputTokens, 100)
  assert.equal(r.outputTokens, 50)
  assert.equal(r.cacheReadTokens, 10)
  assert.equal(r.cacheWriteTokens, 0)
  assert.equal(r.reasoningTokens, 5)
})

test('缺 usage / 缺必填数字时不生成记录，但游标仍推进', () => {
  const events = [
    usageEvent(0, 1000, { inputTokens: 'bad', outputTokens: 1 }),
    event('assistant/message', 1, 1100, { turn: 1, step: 1 }),
    usageEvent(2, 1200, USAGE),
  ]
  const records: UsageRecord[] = []
  const cursor = foldSession(session(events), { consumed: 0 }, (r) => records.push(r))
  assert.equal(cursor.consumed, 3)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.ts, 1200)
})

test('tool/call 事件回调携带时间与 cwd，未知事件跳过', () => {
  const events = [
    event('tool/call', 0, 700, {}),
    event('some/unknown', 1, 800, {}),
    event('tool/call', 2, 900, {}),
  ]
  const calls: [number, string | undefined][] = []
  foldSession(session(events, '/proj'), { consumed: 0 }, () => {}, (ts, cwd) => calls.push([ts, cwd]))
  assert.deepEqual(calls, [[700, '/proj'], [900, '/proj']])
})

test('tool/call 事件回调同时携带工具名（缺失时为 undefined）', () => {
  const events = [
    event('tool/call', 0, 700, { name: 'edit' }),
    event('tool/call', 1, 800, { name: 'read' }),
    event('tool/call', 2, 900, {}),
  ]
  const calls: [number, string | undefined, string | undefined][] = []
  foldSession(session(events, '/proj'), { consumed: 0 }, () => {}, (ts, cwd, name) => calls.push([ts, cwd, name]))
  assert.deepEqual(calls, [[700, '/proj', 'edit'], [800, '/proj', 'read'], [900, '/proj', undefined]])
})

test('后续 request/header 更新模型归属', () => {
  const events = [
    event('request/header', 0, 500, { header: { config: { model: 'm1' } } }),
    usageEvent(1, 1000, USAGE),
    event('request/header', 2, 1500, { header: { config: { provider: 'p2', model: 'm2' } } }),
    usageEvent(3, 2000, USAGE),
  ]
  const records: UsageRecord[] = []
  foldSession(session(events), { consumed: 0 }, (r) => records.push(r))
  const first = records[0]
  const second = records[1]
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.model, 'm1')
  assert.equal(second.model, 'm2')
  assert.equal(second.provider, 'p2')
})
