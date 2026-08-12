/**
 * Real-session smoke: decodes a dsh session log (session.jsonl.zstd,
 * concatenated frames) and runs the plugin's fold + aggregation over the real
 * events, proving the collection pipeline against production-shaped data.
 *
 * Usage: node scripts/smoke-real-session.mjs [path/to/session.jsonl.zstd]
 * Defaults to the largest session under $DSH_HOME/sessions.
 * Requires `npm run build` first (imports ../lib).
 */

import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { foldSession } from '../lib/fold.js'
import { UsageAggregator } from '../lib/aggregate.js'

const ZSTD_MAGIC = 0xfd2fb528

/** Scan concatenated zstd frames (content-size present or block walk). */
function scanFrames(buffer) {
  const frames = []
  let off = 0
  while (off + 4 <= buffer.length) {
    if (buffer.readUInt32LE(off) !== ZSTD_MAGIC) {
      off += 1
      continue
    }
    const start = off
    off += 4
    const desc = buffer[off]
    off += 1
    const fcsFlag = desc >> 6
    const single = (desc >> 5) & 1
    const checksum = (desc >> 3) & 1
    const dictFlag = desc & 3
    if (!single) off += 1
    off += dictFlag === 1 ? 1 : dictFlag === 2 ? 2 : dictFlag === 3 ? 4 : 0
    const fcsBytes = fcsFlag === 0 ? 0 : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
    let contentSize = 0
    for (let i = 0; i < fcsBytes; i++) contentSize += buffer[off++] * 2 ** (8 * i)
    if (fcsFlag !== 0) {
      off += contentSize + (checksum ? 4 : 0)
      frames.push({ start, end: off })
    } else {
      let last = false
      while (!last) {
        const size = (buffer[off] >> 3) | (buffer[off + 1] << 5) | (buffer[off + 2] << 13)
        last = (buffer[off] & 1) === 1
        off += 3 + size
      }
      if (checksum) off += 4
      frames.push({ start, end: off })
    }
  }
  return frames
}

function decodeLog(path) {
  const buffer = readFileSync(path)
  const lines = []
  for (const { start, end } of scanFrames(buffer)) {
    const text = zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line))
    }
  }
  return lines
}

function pickDefaultSession() {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  let best = null
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const sub of readdirSync(join(root, dir.name), { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const p = join(root, dir.name, sub.name, 'session.jsonl.zstd')
      try {
        const size = statSync(p).size
        if (best === null || size > best.size) best = { p, size }
      } catch {
        // not every session directory carries a log
      }
    }
  }
  if (best === null) throw new Error('no session.jsonl.zstd found under ' + root)
  return best.p
}

const path = process.argv[2] ?? pickDefaultSession()
console.log('== decoding', path)
const events = decodeLog(path)
const header = events.find((e) => e.type === 'session') ?? {}
const session = {
  header: { id: header.id ?? '(unknown)', cwd: header.cwd },
  events,
}

const records = []
const toolCalls = []
foldSession(session, { consumed: 0 }, (r) => records.push(r), (ts) => toolCalls.push(ts))
const agg = new UsageAggregator()
for (const r of records) agg.fold(r)
for (const ts of toolCalls) agg.countToolCall(ts, session.header.cwd)

console.log(`events: ${events.length} | usage records: ${records.length} | tool calls: ${toolCalls.length}`)
console.log(`session: ${session.header.id} cwd=${session.header.cwd ?? '(none)'}`)
for (const r of records) {
  console.log(`  turn ${r.turn}/${r.step} ${new Date(r.ts).toISOString()} ${r.model ?? '(no model)'} in=${r.inputTokens} out=${r.outputTokens} cacheR=${r.cacheReadTokens} reason=${r.reasoningTokens}`)
}
const snap = agg.snapshot(Date.now())
console.log('totalTokens:', snap.totalTokens)
console.log('today:', snap.today ? `${snap.today.date} tokens=${snap.today.tokens} sessions=${snap.today.sessions} toolCalls=${snap.today.toolCalls}` : '(none)')
console.log('minuteSeries:', JSON.stringify(snap.minuteSeries))
console.log('workspaces:', JSON.stringify(snap.workspaces))
console.log('models:', JSON.stringify(snap.models))
console.log(records.length > 0 ? 'SMOKE OK' : 'SMOKE WARN: no usage records in this log')
