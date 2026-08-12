/**
 * Durable storage for the meter: an append-only `usage.jsonl` record log and a
 * small rewritten `days.json` day-aggregate file, both under the plugin's data
 * directory (default `$DSH_HOME/tonghuashun`).
 *
 * Storage failures degrade the plugin to in-memory accounting instead of
 * failing the harness fiber: a telemetry collector must not take the agent
 * down because its disk filled up. Every failure is reported to the caller's
 * warn sink once per operation.
 */

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DayStat, UsageRecord } from './types.js'

const DAYS_VERSION = 1
/** Debounce window for days.json rewrites (batch persistence). */
const COMMIT_DELAY_MS = 200

export type WarnSink = (message: string, cause?: unknown) => void

export interface Store {
  /** Load persisted day rows ([] when none exist yet). */
  loadDays(): Promise<DayStat[]>
  /** Append usage records to the record log. */
  appendUsage(records: UsageRecord[]): Promise<void>
  /** Schedule a debounced rewrite of the day aggregates. */
  commitDays(days: DayStat[]): void
  /** Flush any pending rewrite (called on disposal). */
  flush(): Promise<void>
  /** The resolved data directory. */
  readonly dataDir: string
}

/**
 * Resolve the data directory: explicit config wins, then `DSH_HOME`, then the
 * platform home directory.
 * @param configDataDir - the plugin's `config.dataDir` value, if provided.
 */
export function resolveDataDir(configDataDir: unknown): string {
  if (configDataDir !== undefined) {
    if (typeof configDataDir !== 'string' || configDataDir.length === 0) {
      throw new Error('tonghuashun-meter: config.dataDir must be a non-empty string')
    }
    return configDataDir
  }
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tonghuashun')
}

interface DaysFile {
  version: typeof DAYS_VERSION
  days: DayStat[]
}

function parseDaysFile(text: string): DayStat[] {
  const parsed = JSON.parse(text) as DaysFile
  if (typeof parsed !== 'object' || parsed === null) throw new Error('days.json root is not an object')
  if (parsed.version !== DAYS_VERSION) throw new Error(`days.json version ${String(parsed.version)} is not supported`)
  if (!Array.isArray(parsed.days)) throw new Error('days.json days is not an array')
  return parsed.days as DayStat[]
}

export function createStore(dataDir: string, warn: WarnSink = () => {}): Store {
  const usagePath = join(dataDir, 'usage.jsonl')
  const daysPath = join(dataDir, 'days.json')
  let days: DayStat[] = []
  let timer: NodeJS.Timeout | undefined

  const ensureDir = async (): Promise<void> => {
    try {
      await mkdir(dirname(usagePath), { recursive: true })
    } catch (error) {
      warn('tonghuashun-meter: cannot create data directory, storage disabled', error)
      throw error
    }
  }

  const store: Store = {
    dataDir,

    async loadDays() {
      try {
        const text = await readFile(daysPath, 'utf8')
        days = parseDaysFile(text)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') warn('tonghuashun-meter: cannot read days.json, starting from empty history', error)
      }
      return days
    },

    async appendUsage(records) {
      if (records.length === 0) return
      try {
        await ensureDir()
        const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
        await appendFile(usagePath, body, 'utf8')
      } catch (error) {
        warn('tonghuashun-meter: cannot append usage records', error)
      }
    },

    commitDays(next) {
      days = next
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void writeDays()
      }, COMMIT_DELAY_MS)
    },

    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      await writeDays()
    },
  }

  async function writeDays(): Promise<void> {
    try {
      await ensureDir()
      await writeFile(daysPath, JSON.stringify({ version: DAYS_VERSION, days } satisfies DaysFile, null, 1), 'utf8')
    } catch (error) {
      warn('tonghuashun-meter: cannot write days.json', error)
    }
  }

  return store
}
