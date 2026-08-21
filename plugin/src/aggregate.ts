/**
 * Pure aggregation over {@link UsageRecord}s: per-minute, per-day, per-workspace,
 * and per-model buckets, plus the snapshot shape the HTTP endpoint serves.
 *
 * Day keys are local-time 'YYYY-MM-DD'; minute keys are local 'HH:MM'.
 * `foldDay` merges persisted day rows back into the live aggregator after a
 * restart, so the day series survives process boundaries. Workspace-level
 * session and tool-call counts live inside the day rows and merge with them.
 */

import type { DayStat, MinuteStat, ModelStat, Snapshot, UsageRecord, WorkspaceStat } from './types.js'

const pad = (n: number) => String(n).padStart(2, '0')

export function minuteKey(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey(now: number): string {
  return dayKey(now)
}

export class UsageAggregator {
  private readonly minutes = new Map<string, MinuteStat>()
  private readonly days = new Map<string, DayStat>()
  private readonly workspaces = new Map<string, WorkspaceStat>()
  private readonly models = new Map<string, ModelStat>()
  /** Per-day distinct session ids, for the day sessions count. */
  private readonly daySessions = new Map<string, Set<string>>()
  /** Per-day per-workspace distinct session ids. */
  private readonly dayWorkspaceSessions = new Map<string, Map<string, Set<string>>>()
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
    const tokens = record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.reasoningTokens

    const m = this.minutes.get(minute)
    if (m === undefined) {
      this.minutes.set(minute, { minute, tokens, inputTokens: record.inputTokens, outputTokens: record.outputTokens })
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

    const ws = this.workspaces.get(cwd)
    if (ws === undefined) {
      this.workspaces.set(cwd, { cwd, tokens, sessions: 1, toolCalls: 0 })
    } else {
      ws.tokens += tokens
      ws.sessions = Math.max(ws.sessions, 1)
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

  /** Persistable day rows, ascending by date. */
  dayRows(): DayStat[] {
    return [...this.days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  /** Build the wire snapshot for GET /tonghuashun/snapshot. */
  snapshot(now: number): Snapshot {
    const today = this.days.get(todayKey(now)) ?? null
    return {
      generatedAt: now,
      totalTokens: this.total,
      today,
      minuteSeries: [...this.minutes.values()].sort((a, b) => (a.minute < b.minute ? -1 : 1)),
      daySeries: this.dayRows(),
      workspaces: [...this.workspaces.values()].sort((a, b) => b.tokens - a.tokens),
      models: [...this.models.values()].sort((a, b) => b.tokens - a.tokens),
    }
  }
}
