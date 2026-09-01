/**
 * Pure aggregation over {@link UsageRecord}s: per-minute, per-day, per-workspace,
 * and per-model buckets, plus the snapshot shape the HTTP endpoint serves.
 *
 * Day keys are local-time 'YYYY-MM-DD'; minute buckets are keyed by
 * 'YYYY-MM-DD HH:MM' internally so replaying history cannot pile yesterday's
 * 09:30 onto today's 09:30 — the snapshot exposes only the requested day's
 * minutes, still as bare 'HH:MM' (wire format unchanged).
 * `foldDay` merges persisted day rows back into the live aggregator after a
 * restart, so the day series survives process boundaries. Workspace-level
 * session and tool-call counts live inside the day rows and merge with them.
 */

import type { DayMinuteSeries, DayStat, MinuteStat, ModelStat, Snapshot, UsageRecord, WorkspaceStat } from './types.js'

const pad = (n: number) => String(n).padStart(2, '0')

export function minuteKey(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Internal minute bucket key: day-scoped so history never lands on today. */
export function dayMinuteKey(ts: number): string {
  return `${dayKey(ts)} ${minuteKey(ts)}`
}

export function todayKey(now: number): string {
  return dayKey(now)
}

export class UsageAggregator {
  /** Keyed by {@link dayMinuteKey}; the snapshot slices out one day. */
  private readonly minutes = new Map<string, MinuteStat>()
  private readonly days = new Map<string, DayStat>()
  private readonly workspaces = new Map<string, WorkspaceStat>()
  private readonly models = new Map<string, ModelStat>()
  /** Per-day distinct session ids, for the day sessions count. */
  private readonly daySessions = new Map<string, Set<string>>()
  /** Per-day per-workspace distinct session ids. */
  private readonly dayWorkspaceSessions = new Map<string, Map<string, Set<string>>>()
  /** Workspace cwd -> all distinct session ids seen live (workspace sessions count). */
  private readonly workspaceSessionIds = new Map<string, Set<string>>()
  private total = 0

  private ensureDay(date: string): DayStat {
    const existing = this.days.get(date)
    if (existing !== undefined) return existing
    const day: DayStat = {
      date,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      byWorkspace: {},
      workspaceSessions: {},
      workspaceToolCalls: {},
      byModel: {},
      byModelDetail: {},
      sessions: 0,
      toolCalls: 0,
    }
    this.days.set(date, day)
    return day
  }

  private markWorkspaceSession(date: string, cwd: string, sessionId: string): void {
    let perDay = this.dayWorkspaceSessions.get(date)
    if (perDay === undefined) {
      perDay = new Map()
      this.dayWorkspaceSessions.set(date, perDay)
    }
    let ids = perDay.get(cwd)
    if (ids === undefined) {
      ids = new Set()
      perDay.set(cwd, ids)
    }
    if (!ids.has(sessionId)) {
      ids.add(sessionId)
      const day = this.ensureDay(date)
      day.workspaceSessions[cwd] = ids.size
    }
  }

  /** Fold one usage record into every bucket. */
  fold(record: UsageRecord): void {
    const date = dayKey(record.ts)
    const minute = minuteKey(record.ts)
    const bucket = dayMinuteKey(record.ts)
    // reasoningTokens 已包含在 outputTokens 中，只用于明细，不进入总量
    // （与 @deepseek-ai/dsh-token-meter 的 usageTokens 口径一致）。
    const tokens = record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens

    const m = this.minutes.get(bucket)
    if (m === undefined) {
      this.minutes.set(bucket, { minute, tokens, inputTokens: record.inputTokens, outputTokens: record.outputTokens })
    } else {
      m.tokens += tokens
      m.inputTokens += record.inputTokens
      m.outputTokens += record.outputTokens
    }

    const day = this.ensureDay(date)
    day.tokens += tokens
    day.inputTokens += record.inputTokens
    day.outputTokens += record.outputTokens
    const cwd = record.cwd ?? '(no cwd)'
    day.byWorkspace[cwd] = (day.byWorkspace[cwd] ?? 0) + tokens
    this.markWorkspaceSession(date, cwd, record.sessionId)
    if (record.model !== undefined) {
      day.byModel[record.model] = (day.byModel[record.model] ?? 0) + tokens
      const details = day.byModelDetail ??= {}
      const detail = details[record.model] ??= {
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      }
      detail.tokens += tokens
      detail.inputTokens += record.inputTokens
      detail.outputTokens += record.outputTokens
      detail.cacheReadTokens += record.cacheReadTokens
      detail.cacheWriteTokens += record.cacheWriteTokens
      detail.reasoningTokens += record.reasoningTokens
    }

    let sessions = this.daySessions.get(date)
    if (sessions === undefined) {
      sessions = new Set()
      this.daySessions.set(date, sessions)
    }
    if (!sessions.has(record.sessionId)) {
      sessions.add(record.sessionId)
      day.sessions += 1
    }

    // Distinct sessions per workspace: a workspace running five sessions used
    // to report 1 until a restart merged the persisted day rows.
    let wsSessionIds = this.workspaceSessionIds.get(cwd)
    if (wsSessionIds === undefined) {
      wsSessionIds = new Set()
      this.workspaceSessionIds.set(cwd, wsSessionIds)
    }
    wsSessionIds.add(record.sessionId)

    const ws = this.workspaces.get(cwd)
    if (ws === undefined) {
      this.workspaces.set(cwd, { cwd, tokens, sessions: wsSessionIds.size, toolCalls: 0 })
    } else {
      ws.tokens += tokens
      ws.sessions = Math.max(ws.sessions, wsSessionIds.size)
    }

    if (record.model !== undefined) {
      const model = this.models.get(record.model)
      if (model === undefined) this.models.set(record.model, { model: record.model, tokens })
      else model.tokens += tokens
    }

    this.total += tokens
  }

  /** Count one tool call on its local day, attributed to its workspace. */
  countToolCall(ts: number, cwd: string | undefined): void {
    const date = dayKey(ts)
    const key = cwd ?? '(no cwd)'
    const day = this.ensureDay(date)
    day.toolCalls += 1
    day.workspaceToolCalls[key] = (day.workspaceToolCalls[key] ?? 0) + 1
    const ws = this.workspaces.get(key)
    if (ws === undefined) {
      this.workspaces.set(key, { cwd: key, tokens: 0, sessions: 0, toolCalls: 1 })
    } else {
      ws.toolCalls += 1
    }
  }

  /** Merge a persisted day row (from days.json) back into the live buckets. */
  foldDay(day: DayStat): void {
    const current = this.ensureDay(day.date)
    current.tokens += day.tokens
    current.inputTokens += day.inputTokens
    current.outputTokens += day.outputTokens
    for (const [cwd, tokens] of Object.entries(day.byWorkspace)) {
      current.byWorkspace[cwd] = (current.byWorkspace[cwd] ?? 0) + tokens
    }
    for (const [cwd, count] of Object.entries(day.workspaceSessions)) {
      current.workspaceSessions[cwd] = Math.max(current.workspaceSessions[cwd] ?? 0, count)
    }
    for (const [cwd, count] of Object.entries(day.workspaceToolCalls)) {
      current.workspaceToolCalls[cwd] = (current.workspaceToolCalls[cwd] ?? 0) + count
    }
    for (const [model, tokens] of Object.entries(day.byModel)) {
      current.byModel[model] = (current.byModel[model] ?? 0) + tokens
    }
    if (day.byModelDetail !== undefined) {
      const currentDetails = current.byModelDetail ??= {}
      for (const [model, detail] of Object.entries(day.byModelDetail)) {
        const target = currentDetails[model] ??= {
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        }
        target.tokens += detail.tokens
        target.inputTokens += detail.inputTokens
        target.outputTokens += detail.outputTokens
        target.cacheReadTokens += detail.cacheReadTokens
        target.cacheWriteTokens += detail.cacheWriteTokens
        target.reasoningTokens += detail.reasoningTokens
      }
    }
    current.sessions += day.sessions
    current.toolCalls += day.toolCalls
    this.total += day.tokens

    for (const [cwd, tokens] of Object.entries(day.byWorkspace)) {
      const ws = this.workspaces.get(cwd)
      if (ws === undefined) {
        this.workspaces.set(cwd, {
          cwd,
          tokens,
          sessions: day.workspaceSessions[cwd] ?? 0,
          toolCalls: day.workspaceToolCalls[cwd] ?? 0,
        })
      } else {
        ws.tokens += tokens
        ws.sessions = Math.max(ws.sessions, day.workspaceSessions[cwd] ?? 0)
        ws.toolCalls += day.workspaceToolCalls[cwd] ?? 0
      }
    }
    for (const [model, tokens] of Object.entries(day.byModel)) {
      const m = this.models.get(model)
      if (m === undefined) this.models.set(model, { model, tokens })
      else m.tokens += tokens
    }
  }

  /**
   * Merge only persisted tool-call / workspace-session counters after replaying
   * `usage.jsonl`. Unlike {@link foldDay}, this does not add tokens again — the
   * usage record log is the token source of truth when it exists.
   */
  foldDayToolCalls(day: DayStat): void {
    const current = this.ensureDay(day.date)
    current.toolCalls += day.toolCalls
    for (const [cwd, count] of Object.entries(day.workspaceToolCalls)) {
      current.workspaceToolCalls[cwd] = (current.workspaceToolCalls[cwd] ?? 0) + count
      const sessions = day.workspaceSessions[cwd] ?? 0
      const ws = this.workspaces.get(cwd)
      if (ws === undefined) {
        this.workspaces.set(cwd, { cwd, tokens: 0, sessions, toolCalls: count })
      } else {
        ws.sessions = Math.max(ws.sessions, sessions)
        ws.toolCalls += count
      }
    }
  }

  /** Persistable day rows, ascending by date. */
  dayRows(): DayStat[] {
    return [...this.days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  /** One day's minute series, ascending ('HH:MM' as on the wire). */
  minuteRows(date: string): MinuteStat[] {
    const prefix = `${date} `
    const rows: MinuteStat[] = []
    for (const [key, stat] of this.minutes) {
      if (key.startsWith(prefix)) rows.push(stat)
    }
    return rows.sort((a, b) => (a.minute < b.minute ? -1 : a.minute > b.minute ? 1 : 0))
  }

  /** Recent days' minute series (oldest first); skips days without minute buckets. */
  minuteRowsByDay(dates: readonly string[]): DayMinuteSeries[] {
    const rows: DayMinuteSeries[] = []
    for (const date of dates) {
      const minutes = this.minuteRows(date)
      if (minutes.length > 0) rows.push({ date, minutes })
    }
    return rows
  }

  /** Build the wire snapshot for GET /tonghuashun/snapshot. */
  snapshot(now: number): Snapshot {
    const date = todayKey(now)
    const today = this.days.get(date) ?? null
    const daySeries = this.dayRows()
    const recentDates = daySeries.slice(-5).map((day) => day.date)
    return {
      generatedAt: now,
      totalTokens: this.total,
      today,
      // Only today's minutes: the intraday pane means "today", and replaying
      // history would otherwise stack every past day onto the same clock slots.
      minuteSeries: this.minuteRows(date),
      // 5日图使用真实分钟桶，而不是把每个日总量摊成假曲线。
      minuteSeriesByDay: this.minuteRowsByDay(recentDates),
      daySeries,
      workspaces: [...this.workspaces.values()].sort((a, b) => b.tokens - a.tokens),
      models: [...this.models.values()].sort((a, b) => b.tokens - a.tokens),
    }
  }
}
