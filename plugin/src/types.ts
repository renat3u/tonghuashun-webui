/**
 * Wire and storage types for the tonghuashun meter.
 *
 * These are structural subsets of the dsh session model: the plugin only reads
 * session headers, event envelopes, `request/header` (model attribution), and
 * `assistant/message` (provider token usage). Defining them locally keeps the
 * pure folds testable without the dsh monorepo at runtime.
 */

/** Provider-reported token buckets (dsh TokenUsage). */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** One recorded consumption sample: one finalized assistant turn. */
export interface UsageRecord {
  /** Source event epoch ms. */
  ts: number
  sessionId: string
  /** Session project directory (workspace), when the header records one. */
  cwd?: string
  provider?: string
  model?: string
  turn: number
  step: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** Structural subset of a dsh Session the meter reads. */
export interface MeterSession {
  header: {
    id: string
    cwd?: string
  }
  events: readonly MeterEvent[]
}

/** Structural subset of the dsh session event envelope. */
export interface MeterEvent {
  type: string
  seq: number
  /** Unix epoch milliseconds. */
  time: number
  data: unknown
  ignorable?: true
  /** `assistant/message` 引用的源 chunk seq；token 时间线分摊用，结构子集。 */
  sourceEventSeqs?: number[]
}

/** Per-session fold position: consumed events plus token timeline state. */
export interface FoldCursor {
  consumed: number
  provider?: string
  model?: string
  /** 最近一次 `request/header` 的事件时间（输入/cache token 的归属时刻）。 */
  requestTs?: number
  /** 当前 model step 的起点与流式 chunk 权重。 */
  step?: {
    turn: number
    step: number
    ts: number
    chunks: TimedTokenWeight[]
  }
}

/** 一个流式 chunk 在 token 时间线中的权重（按字符长度估算 token 数）。 */
export interface TimedTokenWeight {
  ts: number
  kind: 'output' | 'reasoning'
  weight: number
}

/** Per-minute consumption stat (分时成交). */
export interface MinuteStat {
  /** Local 'HH:MM'. */
  minute: string
  tokens: number
  inputTokens: number
  outputTokens: number
}

/** One day's full minute series (used by the 5-day chart). */
export interface DayMinuteSeries {
  /** Local 'YYYY-MM-DD'. */
  date: string
  minutes: MinuteStat[]
}

/** Per-model detailed token buckets for one day. */
export interface ModelTokenDetail {
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** Per-day consumption stat (日 K). */
export interface DayStat {
  /** Local 'YYYY-MM-DD'. */
  date: string
  tokens: number
  inputTokens: number
  outputTokens: number
  /** Workspace cwd -> tokens. */
  byWorkspace: Record<string, number>
  /** Workspace cwd -> distinct session count. */
  workspaceSessions: Record<string, number>
  /** Workspace cwd -> tool call count. */
  workspaceToolCalls: Record<string, number>
  /** Model id -> tokens. */
  byModel: Record<string, number>
  /** Model id -> detailed buckets. */
  byModelDetail?: Record<string, ModelTokenDetail>
  /** Distinct sessions that consumed tokens this day. */
  sessions: number
  /** Tool calls recorded this day. */
  toolCalls: number
}

/** Aggregated workspace (关注项目). */
export interface WorkspaceStat {
  cwd: string
  tokens: number
  sessions: number
  toolCalls: number
  /**
   * Recent committed changes read from the workspace git repository
   * (newest first). Absent when the workspace is not a git repository or
   * git is unavailable — clients must show an empty state, never invent data.
   */
  changes?: WorkspaceChange[]
  /** File tree of the latest commit. */
  gitTree?: WorkspaceTreeEntry[]
  /** Per-day LOC history (added/deleted/net) folded from recent commits. */
  locSeries?: WorkspaceLocDay[]
}

/** One committed file change (最近变更 row). */
export interface WorkspaceChange {
  /** Commit epoch ms. */
  ts: number
  /** Local 'HH:MM' display time. */
  time: string
  /** Workspace-relative path (forward slashes). */
  path: string
  /** Commit subject. */
  msg: string
  add: number
  del: number
  /** Optional truncated unified diff for the row (never synthesized). */
  diff?: string
}

/** One row of the latest commit's file tree. */
export interface WorkspaceTreeEntry {
  /** Directory depth (0 = workspace root level). */
  depth: number
  /** Workspace-relative path; directory rows end with '/'. */
  path: string
  add: number
  del: number
  /** True when the row aggregates a directory rather than one file. */
  directory?: boolean
}

/** One day of net LOC movement for the K-line volume pane. */
export interface WorkspaceLocDay {
  /** Local 'YYYY-MM-DD'. */
  date: string
  added: number
  deleted: number
  net: number
}

/** Aggregated model. */
export interface ModelStat {
  model: string
  tokens: number
}

/** The JSON payload served at GET /tonghuashun/snapshot. */
export interface Snapshot {
  /** Server epoch ms when the snapshot was built. */
  generatedAt: number
  /** Total tokens recorded since the collector started. */
  totalTokens: number
  /** Today's aggregate, null before the first record of the day. */
  today: DayStat | null
  /** Today's per-minute series, ascending. */
  minuteSeries: MinuteStat[]
  /** Recent days' minute series for the 5-day chart; oldest first, may be empty. */
  minuteSeriesByDay?: DayMinuteSeries[]
  /** Per-day series, ascending. */
  daySeries: DayStat[]
  workspaces: WorkspaceStat[]
  models: ModelStat[]
}
