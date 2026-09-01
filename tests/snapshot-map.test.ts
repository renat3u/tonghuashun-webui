import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byModelToFlow,
  daySeriesToCandles,
  daySeriesToPoints,
  isSnapshotLike,
  mapSnapshot,
  minuteSeriesByDayToIntraday,
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
  assert.match(wsCode('E:\\WSL'), /^WS[0-9A-Z]{4}$/)
  assert.notEqual(wsCode('E:\\WSL'), wsCode('E:\\other'))
})

test('wsCode 桶空间足够宽：大量工作区不撞码', () => {
  const codes = new Set<string>()
  for (let i = 0; i < 2000; i++) codes.add(wsCode(`/home/dev/workspace-${i}`))
  // 3 位十进制（900 桶）下 2000 个路径必然大量碰撞；36^4 空间应保持极低碰撞
  assert.ok(codes.size > 1900, `碰撞过多：${codes.size}/2000`)
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
  // 分时主图是当日累计消耗；分时成交（每分钟流量）由 tape 单独表达。
  assert.equal(points[0].p, 100)
  assert.equal(points[1].p, 300)
  assert.equal(points[1].avg, 150)
  const tape = minuteSeriesToTape(SNAP.minuteSeries)
  assert.equal(tape.length, 2)
  assert.equal(tape[0].time, '09:31') // 最新在前
  assert.equal(tape[0].delta, 100)
})

test('minuteSeriesByDayToIntraday 用真实分钟桶生成 5 日累计曲线', () => {
  const points = minuteSeriesByDayToIntraday([
    { date: '2026-08-12', minutes: [{ minute: '09:30', tokens: 100, inputTokens: 100, outputTokens: 0 }] },
    { date: '2026-08-13', minutes: [
      { minute: '09:31', tokens: 200, inputTokens: 200, outputTokens: 0 },
      { minute: '09:32', tokens: 300, inputTokens: 300, outputTokens: 0 },
    ] },
  ])
  assert.equal(points.length, 3)
  assert.equal(points[0].p, 100)
  assert.equal(points[2].p, 600)
  assert.equal(points[2].avg, 200)
  const withHistory = mapSnapshot({ ...SNAP, minuteSeriesByDay: [
    { date: '2026-08-12', minutes: SNAP.minuteSeries },
    { date: '2026-08-13', minutes: SNAP.minuteSeries },
  ] })
  assert.equal(withHistory.fiveDay.length, 4)
  assert.equal(withHistory.fiveDay[0].p, 100)
  assert.equal(withHistory.fiveDay[3].p, 600)
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

test('mapSnapshot 映射真实 changes / gitTree / locSeries（无 git 数据时空态）', () => {
  const withGit: Snapshot = {
    ...SNAP,
    workspaces: SNAP.workspaces.map((ws) => ws.cwd === 'E:\\WSL'
      ? {
          ...ws,
          changes: [{ ts: 1000, time: '14:30', path: 'src/a.ts', msg: 'feat', add: 3, del: 1, diff: '+a' }],
          gitTree: [{ depth: 0, path: 'src/', add: 3, del: 1, directory: true }, { depth: 1, path: 'src/a.ts', add: 3, del: 1 }],
          locSeries: [{ date: '2026-08-13', added: 3, deleted: 1, net: 2 }],
        }
      : ws),
  }
  const live = mapSnapshot(withGit)
  const code = wsCode('E:\\WSL')
  const changes = live.changesByWorkspace.get(code) ?? []
  assert.equal(changes.length, 1)
  assert.equal(changes[0]?.path, 'src/a.ts')
  assert.equal(changes[0]?.diff, '+a')
  const tree = live.gitTreeByWorkspace.get(code) ?? []
  assert.equal(tree[0]?.directory, true)
  assert.equal(tree[1]?.depth, 1)
  assert.equal(live.dailyByWorkspace.get(code)?.[1]?.loc, 2)
  // 无 git 数据的工作区：空数组而不是模拟数据
  const other = live.changesByWorkspace.get(wsCode('E:\\WSL\\a')) ?? []
  assert.deepEqual(other, [])
  assert.deepEqual(live.gitTreeByWorkspace.get(wsCode('E:\\WSL\\a')) ?? [], [])
})

test('daySeriesToPoints 截取近 N 日', () => {
  const points = daySeriesToPoints([day('2026-08-10', 1), day('2026-08-11', 2), day('2026-08-12', 3), day('2026-08-13', 4)], 2)
  assert.equal(points.length, 2)
  // 窗口内累计：3 + 4。
  assert.equal(points[0].p, 3)
  assert.equal(points[1].p, 7)
})

test('daySeriesToPoints 均值为滚动均值（不再恒为 0 压扁纵轴）', () => {
  const points = daySeriesToPoints([day('2026-08-12', 100), day('2026-08-13', 300)], 2)
  assert.equal(points[0].p, 100)
  assert.equal(points[0].avg, 100)
  assert.equal(points[1].p, 400)
  assert.equal(points[1].avg, 200)
  // 纵轴下界取 min(p, avg)：均值不为 0，5 日图不会被拉到 0
  assert.ok(points.every((p) => p.avg > 0))
})

test('workspacesToInstruments 的 pct 用当日对昨日，而不是累计对昨日', () => {
  const live = mapSnapshot({
    ...SNAP,
    // 累计 tokens 远大于当日桶：旧口径会把环比算成 +150%
    workspaces: [{ cwd: 'E:\\WSL', tokens: 10000, sessions: 2, toolCalls: 3 }],
  })
  // 当日 6000 对昨日 4000 = +50%
  assert.equal(live.instruments[0].pct, 50)
  assert.equal(live.instruments[0].prevTokens, 4000)
})

test('isSnapshotLike 拒绝畸形响应', () => {
  assert.equal(isSnapshotLike(SNAP), true)
  assert.equal(isSnapshotLike(null), false)
  assert.equal(isSnapshotLike('nope'), false)
  assert.equal(isSnapshotLike({ generatedAt: 1, totalTokens: 1 }), false)
  assert.equal(isSnapshotLike({ ...SNAP, daySeries: 'bad' }), false)
  assert.equal(isSnapshotLike({ ...SNAP, workspaces: undefined }), false)
})
