/**
 * @deepseek-ai/dsh-tonghuashun-meter — the 同花顺harness data bundle.
 *
 * Host half of the terminal-frontend plugin:
 *  1. collects every finalized assistant turn's provider token usage from the
 *     session event bus (`session/event` → `assistant/message`),
 *  2. records it to `usage.jsonl` and day aggregates to `days.json` under
 *     `$DSH_HOME/tonghuashun`,
 *  3. serves the aggregated snapshot at `GET /tonghuashun/snapshot` when the
 *     web server (dsh web composition) is present.
 *
 * Capture is incremental from plugin load: sessions seen for the first time
 * start at their current log tail, so records are never re-counted across
 * restarts and pre-install history is intentionally not backfilled.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the webServer Context declaration from dsh-host-webserver.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { UsageAggregator } from './aggregate.js'
import { foldSession, type FoldCursor } from './fold.js'
import { createStore, resolveDataDir } from './store.js'
import type { MeterSession } from './types.js'

export const name = '@deepseek-ai/dsh-tonghuashun-meter'

export const inject: string[] = []

export interface Config {
  /** Override the data directory (default `$DSH_HOME/tonghuashun`). */
  dataDir?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted when a session's durable log grows (dsh session bus). */
    'session/event'(session: MeterSession): void
  }
}

export function apply(ctx: Context, config: Config = {}): () => void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = createStore(dataDir, (message, cause) => ctx.logger.warn(message, cause))
  const aggregator = new UsageAggregator()
  const cursors = new WeakMap<object, FoldCursor>()
  ctx.logger.info(`tonghuashun-meter: loaded, dataDir=${dataDir}`)

  // Boot: merge persisted day aggregates back so the day series survives restarts.
  void store.loadDays().then((days) => {
    for (const day of days) aggregator.foldDay(day)
  })

  const disposeEvent = ctx.on('session/event', (session: MeterSession) => {
    // First sight starts at the current log tail: everything already durable
    // was captured by an earlier run of the plugin (or predates it).
    let cursor = cursors.get(session)
    if (cursor === undefined) {
      cursor = { consumed: session.events.length }
      cursors.set(session, cursor)
    }
    foldSession(
      session,
      cursor,
      (record) => {
        aggregator.fold(record)
        void store.appendUsage([record])
      },
      (ts, cwd) => aggregator.countToolCall(ts, cwd),
    )
    store.commitDays(aggregator.dayRows())
  })

  // Web composition: serve the snapshot the terminal frontend consumes.
  // Conditional injection waits for the webServer service when it exists
  // (ordering-independent) and never activates in headless compositions.
  ctx.inject(['webServer'], (c) => {
    c.effect(
      () => c.webServer.register({
        kind: 'exact',
        path: '/tonghuashun/snapshot',
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('allow', 'GET, HEAD')
            res.end()
            return
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(aggregator.snapshot(Date.now())))
        },
      }),
      'tonghuashun-meter: /tonghuashun/snapshot route',
    )
    c.logger.info('tonghuashun-meter: /tonghuashun/snapshot route registered')
  })

  return () => {
    disposeEvent()
    void store.flush()
  }
}
