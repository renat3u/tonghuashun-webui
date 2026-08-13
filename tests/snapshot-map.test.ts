import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byModelToFlow,
  daySeriesToCandles,
  daySeriesToPoints,
  mapSnapshot,
  minuteSeriesToIntraday,
  minuteSeriesToTape,
  minuteToHours,
  wsCode,
  wsName,
  type Snapshot,
  type SnapshotDay,
} from '../client-plugin/src/bridge/snapshot'

function day(date: string, tokens: number, byWorkspace: Record<string, number> = {}): SnapshotDay {
  return {
    date,
    tokens,
    inputTokens: tokens,
    outputTokens: 0,
    byWorkspace,
    workspaceSessions: {},
    workspaceToolCalls: {},
    byModel: { 'deepseek-v4-pro': tokens },
    sessions: 1,
    toolCalls: 0,
  }
}

const SNAP: Snapshot = {
  generatedAt: 1000,
  totalTokens: 20000,
  today: { ...day('2026-08-13', 8000, { 'E:\\WSL': 6000, 'E:\\WSL\\a': 2000 }), byModel: { a: 6000, b: 2000 } },
  minuteSeries: [
    { minute: '09:30', tokens: 100, inputTokens: 90, outputTokens: 10 },
    { minute: '09:31', tokens: 200, inputTokens: 180, outputTokens: 20 },
  ],
  daySeries: [
    day('2026-08-12', 5000, { 'E:\\WSL': 4000 }),
    day('2026-08-13', 8000, { 'E:\\WSL': 6000, 'E:\\WSL\\a': 2000 }),
  ],
  workspaces: [
    { cwd: 'E:\\WSL', tokens: 6000, sessions: 2, toolCalls: 3 },
    { cwd: 'E:\\WSL\\a', tokens: 2000, sessions: 1, toolCalls: 0 },
  ],
  models: [{ model: 'a', tokens: 6000 }],
}

test('minuteToHours 解析小数小时', () => {
  assert.equal(minuteToHours('09:30'), 9.5)
  assert.equal(minuteToHours('13:00'), 13)
  assert.equal(minuteToHours('bad'), 0)
})

test('wsCode 稳定且区分 cwd', () => {
  assert.equal(wsCode('E:\\WSL'), wsCode('E:\\WSL'))
  assert.match(wsCode('E:\\WSL'), /^WS\d{3}$/)
  assert.notEqual(wsCode('E:\\WSL'), wsCode('E:\\other'))
})

test('wsName 取 basename', () => {
  assert.equal(wsName('E:\\WSL'), 'WSL')
  assert.equal(wsName('E:\\WSL\\tonghuashun-harness\\'), 'tonghuashun-harness')
  assert.equal(wsName('/'), '/')
})

test('daySeriesToCandles: open = 前一日收盘', () => {
  const candles = daySeriesToCandles([day('2026-08-12', 5000), day('2026-08-13', 8000)])
  assert.equal(candles.length, 2)
  assert.equal(candles[0].o, 5000)
  assert.equal(candles[1].o, 5000)
  assert.equal(candles[1].c, 8000)
  assert.equal(candles[1].h, 8000)
  assert.equal(candles[1].l, 5000)
})

test('minuteSeriesToIntraday / ToTape', () => {
  const points = minuteSeriesToIntraday(SNAP.minuteSeries)
  assert.equal(points.length, 2)
  assert.equal(points[0].t, 9.5)
  assert.equal(points[1].p, 200)
  assert.equal(points[1].avg, 150)
  const tape = minuteSeriesToTape(SNAP.minuteSeries)
  assert.equal(tape.length, 2)
  assert.equal(tape[0].time, '09:31') // 最新在前
  assert.equal(tape[0].delta, 100)
})

test('byModelToFlow 排序与占比', () => {
  const flow = byModelToFlow({ a: 6000, b: 2000 })
  assert.equal(flow[0].name, 'a')
  assert.equal(flow[0].share, 75)
  assert.equal(flow[1].share, 25)
})

test('mapSnapshot 完整映射（关注项目/指数/日K/分时）', () => {
  const live = mapSnapshot(SNAP)
  assert.equal(live.instruments.length, 2)
  assert.equal(live.instruments[0].name, 'WSL')
  assert.equal(live.instruments[0].tokens, 6000)
  assert.equal(live.instruments[0].prevTokens, 4000)
  assert.equal(live.instruments[0].pct, 50)
  assert.equal(live.daily.length, 2)
  assert.equal(live.tape[0].time, '09:31')
  assert.equal(live.tokenFlow[0].name, 'a')
  assert.equal(live.indices[0].name, 'DSH指数')
  assert.equal(live.indices[0].value, 20000)
  assert.equal(live.fiveDay.length, 2)
})

test('daySeriesToPoints 截取近 N 日', () => {
  const points = daySeriesToPoints([day('2026-08-10', 1), day('2026-08-11', 2), day('2026-08-12', 3), day('2026-08-13', 4)], 2)
  assert.equal(points.length, 2)
  assert.equal(points[1].p, 4)
})
