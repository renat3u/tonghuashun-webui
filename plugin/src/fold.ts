/**
 * Incremental session fold: walks a session's durable event log once and emits
 * {@link UsageRecord}s that carry provider token usage, plus one tool-call
 * timestamp per `tool/call` event.
 *
 * The fold is pure and structural: every field is validated defensively
 * because the event log is foreign data at this boundary. Unknown event types
 * are skipped — the meter reads, it never reconstructs, so an unrecognized
 * record cannot corrupt accounting.
 *
 * Token timing: provider usage is reported once at `assistant/message`, but
 * that single timestamp would push an entire turn into one minute bucket.
 * The fold therefore tracks `step/start` / `request/header` / `assistant/chunk`
 * events and distributes the finalized usage over the step's real timeline:
 * input + cache buckets at request time, output/reasoning across the
 * streamed delta chunks (falling back to an even spread over the step
 * duration). Totals are preserved exactly with largest-remainder rounding.
 */

import type { FoldCursor, MeterSession, TimedTokenWeight, UsageRecord } from './types.js'

export type { FoldCursor, MeterSession, UsageRecord } from './types.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Sum the disjoint provider usage buckets. `reasoningTokens` is deliberately
 * excluded: adapters already include reasoning output in `outputTokens`
 * (same semantics as `@deepseek-ai/dsh-token-meter`).
 */
export function usageTokens(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}): number {
  return usage.inputTokens
    + usage.outputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
}

/** All token buckets of one finalized assistant turn. */
interface UsageBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

const MINUTE_MS = 60_000

/** A timestamp with an integer allocation of one bucket. */
interface TimedAllocation {
  ts: number
  tokens: number
}

/**
 * Allocate an integer token total across weighted timestamps exactly
 * (floor + largest fractional remainder), preserving the sum.
 * @param total - non-negative integer bucket total.
 * @param weights - non-empty positive-weight timeline.
 * @returns per-timestamp allocations, combined and ascending.
 */
function allocateTokens(total: number, weights: readonly TimedTokenWeight[]): TimedAllocation[] {
  if (total <= 0 || weights.length === 0) return []
  const positive = weights.filter((item) => item.weight > 0)
  const items = positive.length > 0 ? positive : weights
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0)
  if (weightSum <= 0) return [{ ts: items[0]?.ts ?? 0, tokens: total }]

  const raw = items.map((item) => ({ ts: item.ts, value: (total * item.weight) / weightSum }))
  const byTs = new Map<number, { floor: number; fraction: number }>()
  for (const item of raw) {
    const current = byTs.get(item.ts) ?? { floor: 0, fraction: 0 }
    current.floor += Math.floor(item.value)
    current.fraction += item.value - Math.floor(item.value)
    byTs.set(item.ts, current)
  }
  const entries = [...byTs.entries()].map(([ts, value]) => ({ ts, tokens: value.floor, fraction: value.fraction }))
  let remaining = total - entries.reduce((sum, entry) => sum + entry.tokens, 0)
  for (const entry of [...entries].sort((a, b) => b.fraction - a.fraction)) {
    if (remaining <= 0) break
    entry.tokens += 1
    remaining -= 1
  }
  return entries
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => a.ts - b.ts)
}

/** Even minute-by-minute span weights between two timestamps. */
function spanWeights(startTs: number, endTs: number): TimedTokenWeight[] {
  const start = startTs <= endTs ? startTs : endTs
  const end = startTs <= endTs ? endTs : startTs
  if (end - start < MINUTE_MS) return [{ ts: start, kind: 'output' as const, weight: Math.max(1, end - start) }]
  const first = Math.floor(start / MINUTE_MS) * MINUTE_MS
  const last = Math.floor(end / MINUTE_MS) * MINUTE_MS
  const weights: TimedTokenWeight[] = []
  for (let bucket = first; bucket <= last; bucket += MINUTE_MS) {
    const from = Math.max(start, bucket)
    const to = Math.min(end, bucket + MINUTE_MS)
    if (to > from) weights.push({ ts: bucket, kind: 'output' as const, weight: to - from })
  }
  return weights
}

/** Weight one streaming chunk by estimated token count (chars / 4, minimum 1). */
function chunkWeightOf(data: Record<string, unknown>, ts: number): TimedTokenWeight | null {
  const chunk = asRecord(data.chunk)
  if (chunk === null) return null
  const type = str(chunk.type)
  if (type === 'text-delta') {
    const text = str(chunk.text) ?? ''
    return { ts, kind: 'output', weight: Math.max(1, Math.round(text.length / 4)) }
  }
  if (type === 'reasoning-delta') {
    const text = str(chunk.text) ?? ''
    return { ts, kind: 'reasoning', weight: Math.max(1, Math.round(text.length / 4)) }
  }
  if (type === 'tool-call-delta') {
    const args = str(chunk.argumentsDelta) ?? ''
    return { ts, kind: 'output', weight: Math.max(1, Math.round(args.length / 4)) }
  }
  return null
}

/**
 * Fold every event after `cursor.consumed`, mutating and returning the cursor.
 *
 * @param session - the session whose log tail is folded.
 * @param cursor - the previous fold position (start at `{ consumed: 0 }`).
 * @param onRecord - called once per usage-carrying time slice (a turn may emit
 *   several slices so minute buckets reflect the real request/stream timeline).
 * @param onToolCall - called with the event time, session cwd, and tool name for every `tool/call`.
 * @returns the advanced cursor (the same object passed in).
 */
export function foldSession(
  session: MeterSession,
  cursor: FoldCursor,
  onRecord: (record: UsageRecord) => void,
  onToolCall: (ts: number, cwd: string | undefined, toolName: string | undefined) => void = () => {},
): FoldCursor {
  const events = session.events
  const id = session.header.id
  const cwd = session.header.cwd

  /** Emit one UsageRecord with the session/model attribution shared by a step. */
  const emit = (ts: number, turn: number, step: number, buckets: UsageBuckets): void => {
    const totalBuckets = buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.reasoningTokens
    if (totalBuckets <= 0) return
    onRecord({
      ts,
      sessionId: id,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(cursor.provider !== undefined ? { provider: cursor.provider } : {}),
      ...(cursor.model !== undefined ? { model: cursor.model } : {}),
      turn,
      step,
      inputTokens: buckets.inputTokens,
      outputTokens: buckets.outputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      cacheWriteTokens: buckets.cacheWriteTokens,
      reasoningTokens: buckets.reasoningTokens,
    })
  }

  /** Distribute one finalized turn over the tracked step timeline. */
  const emitDistributed = (eventTime: number, turn: number, step: number, buckets: UsageBuckets): void => {
    const stepInfo = cursor.step
    const startTs = cursor.requestTs ?? stepInfo?.ts ?? eventTime
    const safeStart = Math.min(startTs, eventTime)

    // Prompt-side buckets happen once, when the request is assembled.
    const byTs = new Map<number, UsageBuckets>()
    const add = (ts: number, key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens', amount: number): void => {
      if (amount <= 0) return
      const current = byTs.get(ts) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      }
      current[key] += amount
      byTs.set(ts, current)
    }
    add(safeStart, 'inputTokens', buckets.inputTokens)
    add(safeStart, 'cacheReadTokens', buckets.cacheReadTokens)
    add(safeStart, 'cacheWriteTokens', buckets.cacheWriteTokens)

    // Stream-side buckets follow the real chunk timeline; without chunks the
    // fallback still spreads them over the step duration instead of one point.
    const outputWeights = stepInfo?.chunks.filter((item) => item.kind === 'output') ?? []
    const reasoningWeights = stepInfo?.chunks.filter((item) => item.kind === 'reasoning') ?? []
    const outputTimeline = outputWeights.length > 0 ? outputWeights : spanWeights(safeStart, eventTime)
    const reasoningTimeline = reasoningWeights.length > 0 ? reasoningWeights : spanWeights(safeStart, eventTime)
    for (const allocation of allocateTokens(buckets.outputTokens, outputTimeline)) {
      add(allocation.ts, 'outputTokens', allocation.tokens)
    }
    for (const allocation of allocateTokens(buckets.reasoningTokens, reasoningTimeline)) {
      add(allocation.ts, 'reasoningTokens', allocation.tokens)
    }

    for (const [ts, slice] of [...byTs.entries()].sort(([a], [b]) => a - b)) {
      emit(ts, turn, step, slice)
    }
  }

  for (let i = cursor.consumed; i < events.length; i++) {
    const event = events[i]
    if (event === undefined) break
    const data = asRecord(event.data)

    if (event.type === 'request/header' && data !== null) {
      const header = asRecord(data.header)
      const config = header === null ? null : asRecord(header.config)
      if (config !== null) {
        const provider = str(config.provider)
        const model = str(config.model)
        if (provider !== null) cursor.provider = provider
        if (model !== null) cursor.model = model
      }
      cursor.requestTs = event.time
    } else if (event.type === 'step/start' && data !== null) {
      const turn = num(data.turn)
      const step = num(data.step)
      if (turn !== null && step !== null) {
        cursor.step = { turn, step, ts: event.time, chunks: [] }
      }
    } else if (event.type === 'assistant/chunk' && data !== null) {
      const turn = num(data.turn)
      const step = num(data.step)
      if (turn !== null && step !== null && cursor.step?.turn === turn && cursor.step.step === step) {
        const weight = chunkWeightOf(data, event.time)
        if (weight !== null) cursor.step.chunks.push(weight)
      }
    } else if (event.type === 'step/end' && data !== null) {
      const turn = num(data.turn)
      const step = num(data.step)
      if (turn !== null && step !== null && (cursor.step === undefined || (cursor.step.turn === turn && cursor.step.step === step))) {
        cursor.step = undefined
        cursor.requestTs = undefined
      }
    } else if (event.type === 'tool/call') {
      const toolName = data === null ? undefined : (str(data.name) ?? undefined)
      onToolCall(event.time, cwd, toolName)
    } else if (event.type === 'assistant/message' && data !== null) {
      const usage = asRecord(data.usage)
      if (usage !== null) {
        const inputTokens = num(usage.inputTokens)
        const outputTokens = num(usage.outputTokens)
        const turn = num(data.turn)
        const step = num(data.step)
        if (inputTokens !== null && outputTokens !== null && turn !== null && step !== null) {
          const buckets: UsageBuckets = {
            inputTokens,
            outputTokens,
            cacheReadTokens: num(usage.cacheReadTokens) ?? 0,
            cacheWriteTokens: num(usage.cacheWriteTokens) ?? 0,
            reasoningTokens: num(usage.reasoningTokens) ?? 0,
          }
          if (cursor.step?.turn === turn && cursor.step.step === step) {
            emitDistributed(event.time, turn, step, buckets)
          } else {
            // 热插入/游标从日志尾部开始时没有 step 起点，保持单点归属。
            emit(event.time, turn, step, buckets)
          }
          cursor.step = undefined
          cursor.requestTs = undefined
        }
      }
    }

    cursor.consumed = i + 1
  }
  return cursor
}
