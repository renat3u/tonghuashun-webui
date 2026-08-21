import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candleInfoOf, chartEmptyText, lineInfoOf } from '../client-plugin/src/lib/chart'
import type { Candle, IntradayPoint } from '../client-plugin/src/lib/market'

test('lineInfoOf 空数组返回 null（分时/5日黑屏回归）', () => {
  assert.equal(lineInfoOf([], 0, true), null)
  assert.equal(lineInfoOf([], -1, false), null)
})

test('lineInfoOf 空数组不会访问 undefined 点', () => {
  const empty: IntradayPoint[] = []
  // 曾经: points[n-1] 为 undefined -> 读取 p.t 抛 TypeError
  assert.doesNotThrow(() => lineInfoOf(empty, -1, true))
})

test('lineInfoOf 使用悬停点或末点', () => {
  const points: IntradayPoint[] = [
    { t: 9.5, p: 10, avg: 10, vol: 1 },
    { t: 9.516666666666667, p: 12, avg: 11, vol: 2 },
  ]
  const first = lineInfoOf(points, 0, true)
  assert.equal(first?.p, 10)
  assert.equal(first?.time, '09:30')
  const last = lineInfoOf(points, 99, true)
  assert.equal(last?.p, 12)
})

test('candleInfoOf 空数组返回 null', () => {
  const empty: Candle[] = []
  assert.equal(candleInfoOf(empty, -1), null)
  assert.doesNotThrow(() => candleInfoOf(empty, -1))
})

test('candleInfoOf 计算涨跌幅与变更行数', () => {
  const candles: Candle[] = [
    { t: new Date(2026, 7, 7).getTime(), o: 100, h: 120, l: 90, c: 110, loc: -42 },
  ]
  const info = candleInfoOf(candles, 0)
  assert.equal(info?.date, '2026/08/07')
  assert.equal(info?.chg, 10)
  assert.equal(info?.loc, -42)
})

test('chartEmptyText 各视图有明确空态文案', () => {
  assert.match(chartEmptyText('intraday'), /分时/)
  assert.match(chartEmptyText('fiveday'), /5日/)
  assert.match(chartEmptyText('daily'), /日K/)
  assert.match(chartEmptyText('weekly'), /周K/)
  assert.match(chartEmptyText('monthly'), /月K/)
})
