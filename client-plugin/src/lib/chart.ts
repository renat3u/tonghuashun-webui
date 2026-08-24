/**
 * K 线图纯计算辅助：把“空数组安全取值 / 空态文案”从组件中抽出，
 * 便于用 Node 单元测试直接覆盖曾经导致黑屏的空数据回归场景。
 */
import { fmtDateSlash, fmtTime } from './format'
import type { Candle, IntradayPoint } from './market'

export type ChartModeKey = 'intraday' | 'fiveday' | 'daily' | 'weekly' | 'monthly'

export interface LineInfo {
  time: string
  p: number
  avg: number
  vol: number
}

export interface CandleInfo {
  date: string
  o: number
  h: number
  l: number
  c: number
  chg: number
  loc: number
}

/** 线图信息条：空数组返回 null，避免 points[n-1] 为 undefined 后访问 p.t 崩溃。 */
export function lineInfoOf(
  points: readonly IntradayPoint[],
  hover: number,
  intraday: boolean,
): LineInfo | null {
  const n = points.length
  if (n === 0) return null
  const idx = hover >= 0 && hover < n ? hover : n - 1
  const p = points[idx]
  if (p === undefined) return null
  const time = intraday ? fmtTime(p.t % 24) : fmtDateSlash(new Date(p.t))
  return { time, p: p.p, avg: p.avg, vol: p.vol }
}

/** 蜡烛图信息条：空数组返回 null。 */
export function candleInfoOf(candles: readonly Candle[], hover: number): CandleInfo | null {
  const n = candles.length
  if (n === 0) return null
  const idx = hover >= 0 && hover < n ? hover : n - 1
  const k = candles[idx]
  if (k === undefined) return null
  // 开盘为 0（当日无消耗）时环比无意义，按 0 处理避免 NaN/Infinity 上屏
  const chg = k.o !== 0 ? ((k.c - k.o) / k.o) * 100 : 0
  return {
    date: fmtDateSlash(new Date(k.t)),
    o: k.o,
    h: k.h,
    l: k.l,
    c: k.c,
    chg,
    loc: k.loc,
  }
}

/** 各视图空态文案。 */
export function chartEmptyText(mode: ChartModeKey): string {
  switch (mode) {
    case 'intraday':
      return '暂无分时数据，等待真实行情…'
    case 'fiveday':
      return '暂无5日数据，等待真实行情…'
    case 'daily':
      return '暂无日K数据，等待真实行情…'
    case 'weekly':
      return '暂无周K数据，等待真实行情…'
    case 'monthly':
      return '暂无月K数据，等待真实行情…'
  }
}
