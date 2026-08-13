/**
 * 与 dsh-tonghuashun-meter 插件的 HTTP 数据契约（plugin/ 目录）。
 *
 * 当本前端嵌入 dsh web（同源）或插件部署在同一主机时，`fetchSnapshot()` 拉取
 * `GET /tonghuashun/snapshot` 返回的聚合快照；`Snapshot` 类型与插件的
 * `src/types.ts` 保持一致（wire 单一来源见 plugin/README.md）。
 */
import type { Candle, FlowRow, IndexQuote, IntradayPoint, TapeRow } from '../lib/market'

export interface SnapshotDay {
  date: string
  tokens: number
  inputTokens: number
  outputTokens: number
  byWorkspace: Record<string, number>
  workspaceSessions: Record<string, number>
  workspaceToolCalls: Record<string, number>
  byModel: Record<string, number>
  sessions: number
  toolCalls: number
}

export interface SnapshotMinute {
  minute: string
  tokens: number
  inputTokens: number
  outputTokens: number
}

export interface Snapshot {
  generatedAt: number
  totalTokens: number
  today: SnapshotDay | null
  minuteSeries: SnapshotMinute[]
  daySeries: SnapshotDay[]
  workspaces: { cwd: string; tokens: number; sessions: number; toolCalls: number }[]
  models: { model: string; tokens: number }[]
}

export async function fetchSnapshot(timeoutMs = 3000): Promise<Snapshot | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch('/tonghuashun/snapshot', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return null
      const data: unknown = await res.json()
      return data as Snapshot
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

// ---------- P1：快照 -> 终端行情模型（纯映射） ----------

/** 关注项目行（左栏/右栏数据源）。 */
export interface LiveInstrumentRow {
  code: string
  name: string
  cwd: string
  tokens: number
  sessions: number
  toolCalls: number
  prevTokens: number
  pct: number
}

/** 快照映射产物（useMarketEngine 的 live 面）。 */
export interface LiveMarket {
  instruments: LiveInstrumentRow[]
  daily: Candle[]
  intraday: IntradayPoint[]
  fiveDay: IntradayPoint[]
  tape: TapeRow[]
  tokenFlow: FlowRow[]
  indices: IndexQuote[]
  totalTokens: number
  todayTokens: number
}

export function wsCode(cwd: string): string {
  let hash = 0
  for (let i = 0; i < cwd.length; i++) {
    hash = (hash * 31 + cwd.charCodeAt(i)) | 0
  }
  return `WS${String(100 + Math.abs(hash) % 900)}`
}

export function wsName(cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
  return base === '' ? cwd : base
}

export function minuteToHours(minute: string): number {
  const [h, m] = minute.split(':')
  const hour = Number(h)
  const min = Number(m)
  if (!Number.isFinite(hour) || !Number.isFinite(min)) return 0
  return hour + min / 60
}

export function daySeriesToCandles(series: readonly SnapshotDay[]): Candle[] {
  return series.map((day, index) => {
    const prev = index > 0 ? series[index - 1]?.tokens ?? day.tokens : day.tokens
    const t = Date.parse(day.date)
    return {
      t: Number.isFinite(t) ? t : 0,
      o: prev,
      h: Math.max(prev, day.tokens),
      l: Math.min(prev, day.tokens),
      c: day.tokens,
      loc: 0,
    }
  })
}

export function minuteSeriesToIntraday(series: readonly SnapshotMinute[]): IntradayPoint[] {
  let sum = 0
  return series.map((minute, index) => {
    sum += minute.tokens
    return {
      t: minuteToHours(minute.minute),
      p: minute.tokens,
      avg: index === 0 ? minute.tokens : sum / (index + 1),
      vol: 0,
    }
  })
}

export function minuteSeriesToTape(series: readonly SnapshotMinute[]): TapeRow[] {
  const rows: TapeRow[] = []
  for (let i = series.length - 1; i >= 0; i--) {
    const minute = series[i]
    if (minute === undefined) continue
    const older = series[i - 1]
    rows.push({
      time: minute.minute,
      tokens: minute.tokens,
      delta: minute.tokens - (older?.tokens ?? minute.tokens),
    })
  }
  return rows
}

export function daySeriesToPoints(series: readonly SnapshotDay[], count = 5): IntradayPoint[] {
  return series.slice(-count).map((day) => ({
    t: Number.isFinite(Date.parse(day.date)) ? Date.parse(day.date) : 0,
    p: day.tokens,
    avg: 0,
    vol: 0,
  }))
}

export function byModelToFlow(byModel: Record<string, number>): FlowRow[] {
  const entries = Object.entries(byModel).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, tokens]) => sum + tokens, 0)
  return entries.map(([name, tokens]) => ({
    name,
    tokens,
    share: total > 0 ? (tokens / total) * 100 : 0,
  }))
}

export function workspacesToInstruments(
  workspaces: readonly { cwd: string; tokens: number; sessions: number; toolCalls: number }[],
  daySeries: readonly SnapshotDay[],
): LiveInstrumentRow[] {
  const yesterday = daySeries[daySeries.length - 2]
  return [...workspaces]
    .sort((a, b) => b.tokens - a.tokens)
    .map((ws) => {
      const prevTokens = yesterday?.byWorkspace[ws.cwd] ?? 0
      return {
        code: wsCode(ws.cwd),
        name: wsName(ws.cwd),
        cwd: ws.cwd,
        tokens: ws.tokens,
        sessions: ws.sessions,
        toolCalls: ws.toolCalls,
        prevTokens,
        pct: prevTokens > 0 ? ((ws.tokens - prevTokens) / prevTokens) * 100 : 0,
      }
    })
}

export function mapSnapshot(snap: Snapshot): LiveMarket {
  const instruments = workspacesToInstruments(snap.workspaces, snap.daySeries)
  const yesterday = snap.daySeries[snap.daySeries.length - 2]
  const todayTokens = snap.today?.tokens ?? 0
  const yesterdayTokens = yesterday?.tokens ?? 0
  const indices: IndexQuote[] = [
    {
      name: 'DSH指数',
      value: snap.totalTokens,
      change: snap.totalTokens - yesterdayTokens,
      pct: yesterdayTokens > 0 ? ((snap.totalTokens - yesterdayTokens) / yesterdayTokens) * 100 : 0,
    },
    {
      name: '今日消耗',
      value: todayTokens,
      change: todayTokens - yesterdayTokens,
      pct: yesterdayTokens > 0 ? ((todayTokens - yesterdayTokens) / yesterdayTokens) * 100 : 0,
      decimals: 0,
    },
    {
      name: '活跃工作区',
      value: snap.workspaces.length,
      change: 0,
      pct: 0,
      decimals: 0,
    },
  ]
  return {
    instruments,
    daily: daySeriesToCandles(snap.daySeries),
    intraday: minuteSeriesToIntraday(snap.minuteSeries),
    fiveDay: daySeriesToPoints(snap.daySeries),
    tape: minuteSeriesToTape(snap.minuteSeries),
    tokenFlow: byModelToFlow(snap.today?.byModel ?? {}),
    indices,
    totalTokens: snap.totalTokens,
    todayTokens,
  }
}
