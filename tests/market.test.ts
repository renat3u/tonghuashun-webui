import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMarket,
  genDaily,
  genIntraday,
  genFiveDay,
  genChanges,
  genGitTree,
  genTokenFlow,
  genTapeSeed,
  tradingMinutes,
  aggregateWeekly,
  aggregateMonthly,
  ma,
  baseMinuteOf,
  STORY_LAST_DAY,
  type Candle,
} from '../client-plugin/src/lib/market'

test('ma 计算与前置 null 对齐', () => {
  const out = ma([1, 2, 3, 4, 5], 3)
  assert.deepEqual(out, [null, null, 2, 3, 4])
})

function makeDaily(n: number): Candle[] {
  const out: Candle[] = []
  const start = new Date(2026, 0, 5) // 周一
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i * 7) // 每周一
    out.push({ t: d.getTime(), o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, loc: 100 })
  }
  return out
}

test('aggregateWeekly 按周聚合 OHLC', () => {
  const daily = makeDaily(6)
  // 手工构造同一周内的两根
  const mon = daily[0]
  const tue: Candle = { t: mon.t + 86400000, o: 10, h: 13, l: 8, c: 12, loc: 50 }
  const weeks = aggregateWeekly([mon, tue])
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].o, mon.o)
  assert.equal(weeks[0].h, 13)
  assert.equal(weeks[0].l, 8)
  assert.equal(weeks[0].c, 12)
  assert.equal(weeks[0].loc, 150)
})

test('aggregateMonthly 按自然月聚合', () => {
  const jan = makeDaily(2)
  const feb = [{ t: new Date(2026, 1, 3).getTime(), o: 20, h: 25, l: 19, c: 24, loc: 10 }]
  const months = aggregateMonthly([...jan.slice(0, 2), ...feb])
  assert.equal(months.length, 2)
  assert.equal(months[1].o, 20)
  assert.equal(months[1].c, 24)
})

test('tradingMinutes 覆盖两段交易时间', () => {
  const mins = tradingMinutes()
  assert.ok(mins.includes(9.5))
  assert.ok(mins.includes(11.5))
  assert.ok(mins.includes(13))
  assert.ok(mins.includes(15))
  // 中间午休
  assert.ok(!mins.some((t) => t > 11.5 && t < 13))
})

test('genDaily 末根收在今日消耗、代码变更等于重构量', () => {
  const daily = genDaily('DSH001', 4.13e9, 6.14e9, -10000)
  assert.equal(daily.length, 110)
  const last = daily[daily.length - 1]
  assert.equal(last.c, 6.14e9)
  assert.equal(last.o, 4.13e9)
  assert.equal(last.loc, -10000)
  assert.equal(last.t, STORY_LAST_DAY)
  // 确定性
  const again = genDaily('DSH001', 4.13e9, 6.14e9, -10000)
  assert.deepEqual(daily, again)
  // 非重构日也有正有负的代码变更
  const other = genDaily('CORE01', 5.48e8, 5.503e8, 14)
  assert.equal(other.length, 110)
})

test('genIntraday 端点对齐且均值有限', () => {
  const pts = genIntraday('CORE01', 5.48e8 / 240, false)
  assert.equal(pts[0].t, 9.5)
  assert.equal(pts[pts.length - 1].t, 15)
  for (const p of pts) {
    assert.ok(p.p > 0)
    assert.ok(Number.isFinite(p.avg))
    assert.ok(p.vol !== 0)
  }
  // 重构日尾盘：Token 飙升 + 代码量被砸（负 vol）
  const crash = genIntraday('DSH001', 4.13e9 / 240, true)
  const tail = crash.slice(-6)
  assert.ok(tail.every((p) => p.vol < 0))
  assert.ok(crash[crash.length - 1].p > crash[0].p * 3)
})

test('genFiveDay 覆盖 5 个交易日', () => {
  const daily = genDaily('CORE01', 5.48e8, 5.503e8, 14)
  const pts = genFiveDay('CORE01', daily, 5.48e8 / 240)
  assert.equal(pts.length, 5 * 24)
  assert.ok(Number.isFinite(pts[pts.length - 1].avg))
})

test('genChanges 重构日为大删除提交（红增绿删）', () => {
  const rows = genChanges('DSH001', true)
  assert.ok(rows.length >= 6)
  const first = rows[0]
  assert.equal(first.path, 'src/chart/LocPane.tsx')
  assert.ok(first.del > first.add)
  const other = genChanges('CORE01', false)
  assert.equal(other.length, 6)
  assert.ok(other.every((r) => r.add >= 0 && r.del >= 0))
})

test('genGitTree 结构合理', () => {
  const tree = genGitTree('DSH001', true)
  assert.ok(tree.some((t) => t.depth === 0))
  assert.ok(tree.some((t) => t.depth === 1))
  const other = genGitTree('CORE01', false)
  assert.ok(other.length >= 4)
})

test('genTokenFlow 占比接近 100', () => {
  const flow = genTokenFlow('DSH001', 6.14e9, true)
  const sum = flow.reduce((s, f) => s + f.share, 0)
  assert.ok(Math.abs(sum - 100) < 0.5)
  assert.ok(flow.length === 4)
  const flow2 = genTokenFlow('CORE01', 5.503e8, false)
  const sum2 = flow2.reduce((s, f) => s + f.share, 0)
  assert.ok(Math.abs(sum2 - 100) < 0.5)
})

test('genTapeSeed 末笔为尾盘烧穿（DSH001）', () => {
  const base = 4.13e9 / 240
  const tape = genTapeSeed('DSH001', base, true)
  const last = tape[tape.length - 1]
  assert.equal(last.time, '15:00')
  assert.ok(last.tokens > tape[0].tokens * 10)
  assert.ok(last.delta > 0)
  const tape2 = genTapeSeed('CORE01', 5.48e8 / 240, false)
  assert.ok(tape2.every((t) => t.tokens > 0))
  assert.ok(tape2.every((t) => Number.isFinite(t.delta)))
})

test('baseMinuteOf = 昨日总消耗 / 240', () => {
  const m = buildMarket()
  const dsh = m.instruments.find((x) => x.code === 'DSH001')
  assert.ok(dsh)
  assert.equal(baseMinuteOf(dsh), dsh.prevToken / 240)
})

test('buildMarket 数据齐全且总数一致', () => {
  const m = buildMarket()
  assert.ok(m.instruments.length >= 10)
  assert.equal(m.indices.length, 3)
  for (const ins of m.instruments) {
    assert.equal(m.daily.get(ins.code)?.length, 110)
    assert.ok((m.intraday.get(ins.code)?.length ?? 0) > 200)
    assert.equal(m.fiveDay.get(ins.code)?.length, 120)
    assert.ok((m.tape.get(ins.code)?.length ?? 0) >= 8)
    assert.ok((m.changes.get(ins.code)?.length ?? 0) >= 6)
    assert.ok((m.tokenFlow.get(ins.code)?.length ?? 0) === 4)
    assert.ok((m.gitTree.get(ins.code)?.length ?? 0) >= 4)
  }
})
