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
 * restarts.
 *
 * Historical backfill is provided as an explicit local script
 * (`scripts/backfill-sessions.mjs`). The plugin replays `usage.jsonl` on boot,
 * so backfilled history is served after a restart without leaving the machine.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the webServer Context declaration from dsh-host-webserver.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { UsageAggregator } from './aggregate.js'
import { foldSession, type FoldCursor } from './fold.js'
import { WorkspaceGitIndex } from './git.js'
import { createStore, resolveDataDir } from './store.js'
import type { MeterSession, Snapshot, WorkspaceStat } from './types.js'

/** Tool calls that may change files on disk; they invalidate the git cache. */
const FILE_MUTATING_TOOLS = new Set(['edit', 'write', 'str_replace_editor', 'bash', 'tool-fs'])

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

/** Attach cached git views to the snapshot's workspace rows (never throws). */
async function attachGitViews(snapshot: Snapshot, gitIndex: WorkspaceGitIndex): Promise<Snapshot> {
  const workspaces: WorkspaceStat[] = await Promise.all(snapshot.workspaces.map(async (workspace) => {
    const view = await gitIndex.view(workspace.cwd, snapshot.generatedAt)
    if (view === null) return workspace
    return { ...workspace, changes: view.changes, gitTree: view.gitTree, locSeries: view.locSeries }
  }))
  return { ...snapshot, workspaces }
}

export function apply(ctx: Context, config: Config = {}): () => void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = createStore(dataDir, (message, cause) => ctx.logger.warn(message, cause))
  const aggregator = new UsageAggregator()
  const gitIndex = new WorkspaceGitIndex()
  const cursors = new WeakMap<object, FoldCursor>()
  // 不输出具体 dataDir，避免在日志中暴露本机路径。
  ctx.logger.info('tonghuashun-meter: loaded')

  // Boot: replay the raw usage log when present (token/minutes/models source of
  // truth), then merge only tool-call counters from days.json to avoid double
  // counting. If no usage log exists, fall back to persisted day aggregates.
  //
  // Live events that arrive while the replay is still reading are buffered, not
  // folded: a record appended before `loadUsage()` resolves would also appear in
  // the file it reads and be counted twice.
  let replaying = true
  const pending: MeterSession[] = []
  void (async () => {
    try {
      const [days, usage] = await Promise.all([store.loadDays(), store.loadUsage()])
      if (usage.length > 0) {
        for (const record of usage) aggregator.fold(record)
        for (const day of days) aggregator.foldDayToolCalls(day)
      } else {
        for (const day of days) aggregator.foldDay(day)
      }
    } finally {
      replaying = false
      for (const session of pending.splice(0)) consume(session)
      store.commitDays(aggregator.dayRows())
    }
  })()

  /** Fold a session's new events into the aggregator and durable log. */
  function consume(session: MeterSession): void {
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
      (ts, cwd, toolName) => {
        aggregator.countToolCall(ts, cwd)
        if (toolName !== undefined && FILE_MUTATING_TOOLS.has(toolName)) {
          gitIndex.invalidate(cwd)
        }
      },
    )
    store.commitDays(aggregator.dayRows())
  }

  const disposeEvent = ctx.on('session/event', (session: MeterSession) => {
    if (replaying) {
      // Record the cursor now so buffered sessions still start at the tail they
      // had when first seen, then fold once the replay finishes.
      if (!cursors.has(session)) cursors.set(session, { consumed: session.events.length })
      if (!pending.includes(session)) pending.push(session)
      return
    }
    consume(session)
  })

  // Web composition: serve the snapshot the terminal frontend consumes.
  // Conditional injection waits for the webServer service when it exists
  // (ordering-independent) and never activates in headless compositions.
  ctx.inject(['webServer'], (c) => {
    c.effect(
      () => c.webServer.register({
        kind: 'exact',
        path: '/tonghuashun/snapshot',
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('allow', 'GET, HEAD')
            res.end()
            return
          }
          const base = aggregator.snapshot(Date.now())
          // git 读取失败时保留基础快照（前端对缺失字段显示空态）。
          let snapshot = base
          try {
            snapshot = await attachGitViews(base, gitIndex)
          } catch (error) {
            ctx.logger.warn('tonghuashun-meter: git index failed', error)
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(snapshot))
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
