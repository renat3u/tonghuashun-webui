/**
 * Incremental session fold: walks a session's durable event log once and emits
 * one {@link UsageRecord} per finalized assistant turn that carries provider
 * usage, plus one tool-call timestamp per `tool/call` event.
 *
 * The fold is pure and structural: every field is validated defensively
 * because the event log is foreign data at this boundary. Unknown event types
 * are skipped — the meter reads, it never reconstructs, so an unrecognized
 * record cannot corrupt accounting.
 */

import type { FoldCursor, MeterSession, UsageRecord } from './types.js'

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

/** Sum the disjoint provider usage buckets (dsh token-meter semantics). */
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
    + (usage.reasoningTokens ?? 0)
}

/**
 * Fold every event after `cursor.consumed`, mutating and returning the cursor.
 *
 * @param session - the session whose log tail is folded.
 * @param cursor - the previous fold position (start at `{ consumed: 0 }`).
 * @param onRecord - called once per usage-carrying assistant turn.
 * @param onToolCall - called with the event time and session cwd for every `tool/call`.
 * @returns the advanced cursor (the same object passed in).
 */
export function foldSession(
  session: MeterSession,
  cursor: FoldCursor,
  onRecord: (record: UsageRecord) => void,
  onToolCall: (ts: number, cwd: string | undefined) => void = () => {},
): FoldCursor {
  const events = session.events
  const id = session.header.id
  const cwd = session.header.cwd

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
    } else if (event.type === 'tool/call') {
      onToolCall(event.time, cwd)
    } else if (event.type === 'assistant/message' && data !== null) {
      const usage = asRecord(data.usage)
      if (usage !== null) {
        const inputTokens = num(usage.inputTokens)
        const outputTokens = num(usage.outputTokens)
        const turn = num(data.turn)
        const step = num(data.step)
        if (inputTokens !== null && outputTokens !== null && turn !== null && step !== null) {
          onRecord({
            ts: event.time,
            sessionId: id,
            ...(cwd !== undefined ? { cwd } : {}),
            ...(cursor.provider !== undefined ? { provider: cursor.provider } : {}),
            ...(cursor.model !== undefined ? { model: cursor.model } : {}),
            turn,
            step,
            inputTokens,
            outputTokens,
            cacheReadTokens: num(usage.cacheReadTokens) ?? 0,
            cacheWriteTokens: num(usage.cacheWriteTokens) ?? 0,
            reasoningTokens: num(usage.reasoningTokens) ?? 0,
          })
        }
      }
    }

    cursor.consumed = i + 1
  }
  return cursor
}
