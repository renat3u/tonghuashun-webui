/**
 * 实时行情引擎（Token 版）
 *
 * 数据来源两套：
 *  1. 模拟：确定性种子 + 心跳引擎（独立运行 / 快照拉取失败时的回退）。
 *  2. 真实：轮询 /tonghuashun/snapshot（dsh web 内嵌时），经 bridge/snapshot.ts
 *     的 mapSnapshot 映射为 LiveMarket，覆盖报价/分时/日K/流向/指数；
 *     最近变更与 git tree 仍无真实事件源，保留模拟数据。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { mulberry32 } from './rand'
import { fmtClock } from './format'
import {
  baseMinuteOf,
  buildMarket,
  type ChangeRow,
  type FlowRow,
  type Instrument,
  type MarketStatic,
  type TapeRow,
} from './market'
import { fetchSnapshot, mapSnapshot, type LiveMarket, type Snapshot } from '../bridge/snapshot'
import { isLiveBridge } from '../bridge'

export interface LiveQuote {
  code: string
  last: number
  pct: number
  change: number
  high: number
  low: number
  open: number
}

export interface MarketEngine {
  static: MarketStatic
  /** code -> 实时报价（Token 消耗，随心跳更新） */
  quotes: Map<string, LiveQuote>
  /** 当前工作区的分时成交（每分钟 Token 消耗，新笔在前） */
  tape: TapeRow[]
  /** 当前工作区最近代码变更（新条目在前；live 模式仍为模拟并标注） */
  changes: ChangeRow[]
  /** 当前工作区 Token 流向 */
  tokenFlow: FlowRow[]
  indices: MarketStatic['indices']
  /** 引擎心跳计数（用于驱动图表刷新） */
  tick: number
  /** 真实时钟字符串 */
  clock: string
  /** 是否使用真实快照数据（false = 模拟行情） */
  live: boolean
}

const TAPE_CAP = 60
const CHANGES_CAP = 30

function nextPrice(rand: () => number, last: number): number {
  // 小幅随机游走（价格 = 今日 Token 消耗总量）
  const step = Math.max(1, last * 0.00015)
  return Math.round(last + step * (rand() - 0.5))
}

const LIVE_PATHS = [
  'src/lib/market.ts',
  'src/components/KLineChart.tsx',
  'src/components/QuotePanel.tsx',
  'tests/market.test.ts',
  'src/bridge/index.ts',
  'src/styles/global.css',
]

/**
 * 轮询 /tonghuashun/snapshot；仅在内嵌 dsh web（window.__DSH_BOOT__ 存在）时启动，
 * 失败返回 null（引擎回退模拟行情）。
 * @param intervalMs - 轮询间隔。
 * @returns 最近一次快照（null = 尚无数据）。
 */
export function useSnapshotPoller(intervalMs = 5000): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (!isLiveBridge()) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const next = await fetchSnapshot(3000)
      if (!alive) return
      if (next !== null) setSnapshot(next)
      timer = setTimeout(poll, intervalMs)
    }
    void poll()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [intervalMs])
  return snapshot
}

/** LiveMarket -> MarketStatic（live 模式下 changes/gitTree 只用真实 git 数据，缺失即空态）。 */
function marketStaticFromLive(live: LiveMarket, fallback: MarketStatic): MarketStatic {
  // 真实 DSH 尚无工作区/会话时，快照 workspaces 为空；先回退到模拟行情，
  // 避免终端首屏因空列表崩溃，等工作区数据到达后再切到 live 面。
  if (live.instruments.length === 0) return fallback

  const instruments: Instrument[] = live.instruments.map((row, index) => ({
    code: row.code,
    name: row.name,
    sector: '工作区',
    hot: index === 0,
    prevToken: row.prevTokens,
    last: row.tokens,
    open: row.tokens,
    high: Math.max(row.tokens, row.prevTokens),
    // 无昨日数据（prevTokens=0）时最低价不下探到 0：取当前值
    low: row.prevTokens > 0 ? Math.min(row.tokens, row.prevTokens) : row.tokens,
    pct: row.pct,
    change: row.tokens - row.prevTokens,
    locDelta: 0,
    commitCount: row.toolCalls,
    locTotal: 0,
    changeRate: 0,
    contextTtm: 0,
    totalToken: live.totalTokens,
    sessions: row.sessions,
    seed: 0,
  }))
  const daily = new Map<string, typeof live.daily>()
  const intraday = new Map<string, typeof live.intraday>()
  const fiveDay = new Map<string, typeof live.fiveDay>()
  const tape = new Map<string, TapeRow[]>()
  const tokenFlow = new Map<string, FlowRow[]>()
  for (const ins of instruments) {
    daily.set(ins.code, live.dailyByWorkspace.get(ins.code) ?? live.daily)
    intraday.set(ins.code, live.intraday)
    fiveDay.set(ins.code, live.fiveDay)
    tape.set(ins.code, live.tape)
    tokenFlow.set(ins.code, live.tokenFlow)
  }
  return {
    instruments,
    daily,
    intraday,
    fiveDay,
    tape,
    // live 模式绝不回退模拟变更/文件树：meter 未采集 git 时为空数组。
    changes: live.changesByWorkspace,
    tokenFlow,
    gitTree: live.gitTreeByWorkspace,
    indices: live.indices,
  }
}

export function useMarketEngine(selectedCode: string, live?: Snapshot | null): MarketEngine {
  const [staticData] = useState(() => buildMarket())
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(() => {
    const m = new Map<string, LiveQuote>()
    for (const ins of staticData.instruments) {
      m.set(ins.code, {
        code: ins.code,
        last: ins.last,
        pct: ins.pct,
        change: ins.change,
        high: ins.high,
        low: ins.low,
        open: ins.open,
      })
    }
    return m
  })
  const [tape, setTape] = useState<TapeRow[]>(() => [...staticData.tape.get(selectedCode) ?? []])
  const [changes, setChanges] = useState<ChangeRow[]>(() => [...staticData.changes.get(selectedCode) ?? []])
  const [tokenFlow, setTokenFlow] = useState<FlowRow[]>(() => staticData.tokenFlow.get(selectedCode)?.map((f) => ({ ...f })) ?? [])
  const [indices, setIndices] = useState(() => staticData.indices.map((ix) => ({ ...ix })))
  const [tick, setTick] = useState(0)
  const [clock, setClock] = useState(() => fmtClock(new Date()))

  const randRef = useRef(mulberry32(Date.now() & 0xffffffff))
  const lastPriceRef = useRef(0)
  const liveRef = useRef<LiveMarket | null>(null)
  liveRef.current = live === undefined || live === null ? null : mapSnapshot(live)

  // 每秒刷新时钟（live 与模拟共用）
  useEffect(() => {
    const id = setInterval(() => setClock(fmtClock(new Date())), 1000)
    return () => clearInterval(id)
  }, [])

  // 每 1.2s 一次行情心跳（live 模式只走 tick；模拟模式才随机游走）
  const tickRef = useRef(0)
  useEffect(() => {
    const id = setInterval(() => {
      const rand = randRef.current
      tickRef.current += 1
      const heartbeat = tickRef.current
      setTick(heartbeat)
      if (liveRef.current !== null) return

      // 1) 选中工作区：今日 Token 消耗微扰 + 每分钟消耗成交
      const ins = staticData.instruments.find((x) => x.code === selectedCode)
      if (ins) {
        const base = lastPriceRef.current || ins.last
        const n = nextPrice(rand, base)
        lastPriceRef.current = n
        setQuotes((prev) => {
          const next = new Map(prev)
          const cur = next.get(selectedCode)
          if (!cur) return next
          const change = n - ins.prevToken
          next.set(selectedCode, {
            ...cur,
            last: n,
            change,
            pct: (change / ins.prevToken) * 100,
            high: Math.max(cur.high, n),
            low: Math.min(cur.low, n),
          })
          return next
        })
        // 每分钟 Token 消耗（~每 12s 模拟一分钟）
        if (heartbeat % 10 === 1) {
          const baseMinute = baseMinuteOf(ins)
          setTape((prev) => {
            const tokens = Math.round(baseMinute * (0.55 + rand() * 0.5))
            const row: TapeRow = {
              time: fmtClock(new Date()).slice(0, 5),
              tokens,
              delta: tokens - (prev[0]?.tokens ?? Math.round(baseMinute)),
            }
            return [row, ...prev].slice(0, TAPE_CAP)
          })
        }
        // 2) 最近代码变更（~每 7s 偶发一笔新提交）
        if (heartbeat % 6 === 1 && rand() > 0.4) {
          setChanges((prev) => {
            const path = LIVE_PATHS[Math.floor(rand() * LIVE_PATHS.length)]
            const row: ChangeRow = {
              time: fmtClock(new Date()).slice(0, 5),
              path,
              msg: '实时提交',
              add: Math.round(rand() * 120),
              del: Math.round(rand() * 60),
            }
            return [row, ...prev].slice(0, CHANGES_CAP)
          })
        }
        // 3) Token 流向抖动
        if (heartbeat % 5 === 0) {
          setTokenFlow((prev) => prev.map((f) => ({ ...f, tokens: f.tokens * (0.98 + rand() * 0.04) })))
        }
      }

      // 4) 指数跳动
      setIndices((prev) =>
        prev.map((ix, i) => {
          const drift = i === 0 ? 60 : i === 1 ? 12 : 0.12
          const change = ix.change + (rand() - 0.5) * drift * (i === 0 ? 1 : 0.4)
          return { ...ix, value: ix.value + (rand() - 0.5) * drift * 0.12, change, pct: (change / (ix.value || 1)) * 100 * (i === 0 ? 1 : 0.6) }
        }),
      )
    }, 1200)
    return () => clearInterval(id)
  }, [selectedCode, staticData])

  // 切换工作区时重置各面板
  useEffect(() => {
    setTape([...staticData.tape.get(selectedCode) ?? []])
    setChanges([...staticData.changes.get(selectedCode) ?? []])
    setTokenFlow(staticData.tokenFlow.get(selectedCode)?.map((f) => ({ ...f })) ?? [])
    lastPriceRef.current = staticData.instruments.find((x) => x.code === selectedCode)?.last ?? 0
  }, [selectedCode, staticData])

  // live 模式：报价/分时/流向/指数全部来自快照（tick 仅驱动图表刷新）。
  // useMemo 以 `live` prop 为依赖：每次快照轮询到新对象都会重映射，避免只消费首帧。
  return useMemo(() => {
    const liveMarket = live === undefined || live === null ? null : mapSnapshot(live)
    if (liveMarket === null) {
      return { static: staticData, quotes, tape, changes, tokenFlow, indices, tick, clock, live: false }
    }
    const liveStatic = marketStaticFromLive(liveMarket, staticData)
    const liveQuotes = new Map<string, LiveQuote>()
    for (const ins of liveStatic.instruments) {
      liveQuotes.set(ins.code, {
        code: ins.code,
        last: ins.last,
        pct: ins.pct,
        change: ins.change,
        high: ins.high,
        low: ins.low,
        open: ins.open,
      })
    }
    return {
      static: liveStatic,
      quotes: liveQuotes,
      tape: liveStatic.tape.get(selectedCode) ?? [],
      changes: liveStatic.changes.get(selectedCode) ?? [],
      tokenFlow: liveStatic.tokenFlow.get(selectedCode) ?? [],
      indices: liveStatic.indices,
      tick,
      clock,
      live: true,
    }
  }, [live, staticData, quotes, tape, changes, tokenFlow, indices, tick, clock, selectedCode])
}

/** 由引擎取某工作区实时报价；回退到静态数据 */
export function quoteFor(engine: MarketEngine, code: string): { last: number; pct: number; change: number; high: number; low: number; open: number } {
  const live = engine.quotes.get(code)
  if (live) return live
  const ins = engine.static.instruments.find((x) => x.code === code)
  if (ins) return { last: ins.last, pct: ins.pct, change: ins.change, high: ins.high, low: ins.low, open: ins.open }
  return { last: 0, pct: 0, change: 0, high: 0, low: 0, open: 0 }
}
