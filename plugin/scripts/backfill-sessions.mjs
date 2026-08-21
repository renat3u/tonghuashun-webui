/**
 * Historical backfill for the tonghuashun meter.
 *
 * Scans local DSH session logs under `$DSH_HOME/sessions` and folds them into
 * the meter's local store (`$DSH_HOME/tonghuashun/usage.jsonl` + `days.json`).
 *
 * This is an explicit, local-only operation. It never uploads anything and
 * prints only aggregate counts — no session ids, workspace paths, or model
 * names are written to stdout.
 *
 * Usage:
 *   npm run backfill
 *   # or: node scripts/backfill-sessions.mjs
 */
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'
import { UsageAggregator } from '../lib/aggregate.js'
import { foldSession } from '../lib/fold.js'

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const sessionsRoot = join(dshHome, 'sessions')
const dataDir = join(dshHome, 'tonghuashun')

const ZSTD_MAGIC = 0xfd2fb528

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

function* walkSessionLogs(root) {
  if (!existsSync(root)) return
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const full = join(root, dir.name)
    for (const sub of readdirSync(full, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const p = join(full, sub.name, 'session.jsonl.zstd')
      try {
        statSync(p)
        yield p
      } catch {
        // not every session directory carries a log
      }
    }
  }
}

const usagePath = join(dataDir, 'usage.jsonl')
if (existsSync(usagePath)) rmSync(usagePath)

const store = createStore(dataDir)
const agg = new UsageAggregator()
const records = []
let sessionCount = 0
let recordCount = 0

for (const path of walkSessionLogs(sessionsRoot)) {
  const events = decodeLog(path)
  const header = events.find((e) => e.type === 'session') ?? {}
  const session = {
    header: { id: header.id ?? '(unknown)', cwd: header.cwd },
    events,
  }
  const localRecords = []
  foldSession(
    session,
    { consumed: 0 },
    (r) => {
      localRecords.push(r)
      records.push(r)
    },
    (ts, cwd) => agg.countToolCall(ts, cwd),
  )
  for (const r of localRecords) agg.fold(r)
  sessionCount += 1
  recordCount += localRecords.length
}

await store.appendUsage(records)
store.commitDays(agg.dayRows())
await store.flush()

const snap = agg.snapshot(Date.now())
// 只输出聚合计数，不输出任何路径、会话 id、工作区名或模型名。
console.log(`session logs scanned: ${sessionCount}`)
console.log(`usage records: ${recordCount}`)
console.log(`tool calls: ${snap.today?.toolCalls ?? 0}`)
console.log(`total tokens: ${snap.totalTokens}`)
console.log(`day series: ${snap.daySeries.length}`)
console.log(`minute series: ${snap.minuteSeries.length}`)
console.log('backfill complete')
