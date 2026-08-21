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
}

/** Per-session fold position: consumed events plus the latest model attribution. */
export interface FoldCursor {
  consumed: number
  provider?: string
  model?: string
}

/** Per-minute consumption stat (分时成交). */
export interface MinuteStat {
  /** Local 'HH:MM'. */
  minute: string
  tokens: number
  inputTokens: number
  outputTokens: number
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
  /** Per-day series, ascending. */
  daySeries: DayStat[]
  workspaces: WorkspaceStat[]
  models: ModelStat[]
}
