/**
 * Workspace git index for the 最近变更 / git tree / LOC panes.
 *
 * The meter bundle reads each session workspace's git repository directly on
 * the host (no shell interpolation — `git` is executed with an argv list).
 * Results are cached per workspace with a short TTL; file-mutating tool calls
 * invalidate the affected workspace so the next snapshot poll re-reads it.
 *
 * A workspace that is not a git repository (or where git is unavailable)
 * yields `null`: clients show an explicit empty state and never fall back to
 * invented data.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceChange, WorkspaceLocDay, WorkspaceTreeEntry } from './types.js'

const execFileAsync = promisify(execFile)

/** Maximum git subprocess wall time per command. */
const GIT_TIMEOUT_MS = 4000
/** `git log` reads this many commits for change rows + LOC history. */
const HISTORY_COMMITS = 2000
/** Maximum recent-change rows served for one workspace. */
const MAX_CHANGES = 24
/** Maximum change rows that carry an inline unified diff. */
const MAX_DIFF_ROWS = 6
/** Inline diff truncation (characters) before the "…(截断)" marker. */
const DIFF_MAX_CHARS = 2600
/** LOC history window (days). */
const LOC_WINDOW_DAYS = 180
/** Cache TTL for successful reads (also the HEAD re-check interval). */
const DEFAULT_TTL_MS = 30_000
/** Negative-cache TTL (not a git repository / git failure). */
const FAILURE_TTL_MS = 60_000

/** Structural value attached to one workspace row in the snapshot. */
export interface WorkspaceGitView {
  changes: WorkspaceChange[]
  gitTree: WorkspaceTreeEntry[]
  locSeries: WorkspaceLocDay[]
}

interface GitFileStat {
  path: string
  add: number
  del: number
}

interface GitCommit {
  hash: string
  ts: number
  subject: string
  files: GitFileStat[]
}

interface PendingChange {
  row: WorkspaceChange
  hash: string
}

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<string | null>

/** Run git with an argv list and bounded resources; never throws. */
export async function runGit(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch {
    return null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

function localTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse `git log --pretty=format:%x1e%H%x1f%ct%x1f%s --numstat`. */
export function parseHistory(text: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const block of text.split('\x1e')) {
    const lines = block.split('\n')
    const header = lines.shift()
    if (header === undefined || header.length === 0) continue
    const parts = header.split('\x1f')
    const hash = parts[0]
    const seconds = Number(parts[1])
    const subject = parts[2] ?? ''
    if (hash === undefined || hash.length === 0 || !Number.isFinite(seconds)) continue
    const files: GitFileStat[] = []
    for (const line of lines) {
      const tab = line.split('\t')
      const add = Number(tab[0])
      const del = Number(tab[1])
      const path = tab[2]
      if (path === undefined || path.length === 0 || !Number.isFinite(add) || !Number.isFinite(del)) continue
      files.push({ path: path.replaceAll('\\', '/'), add, del })
    }
    if (files.length > 0) commits.push({ hash, ts: seconds * 1000, subject, files })
  }
  return commits
}

/** Parse `git show HEAD --numstat --pretty=format:`. */
export function parseNumstat(text: string): GitFileStat[] {
  const files: GitFileStat[] = []
  for (const line of text.split('\n')) {
    const tab = line.split('\t')
    const add = Number(tab[0])
    const del = Number(tab[1])
    const path = tab[2]
    if (path === undefined || path.length === 0 || !Number.isFinite(add) || !Number.isFinite(del)) continue
    files.push({ path: path.replaceAll('\\', '/'), add, del })
  }
  return files
}

/** Fold commit file stats into daily LOC buckets (newest first). */
export function foldLocDays(commits: readonly GitCommit[], now = Date.now()): WorkspaceLocDay[] {
  const byDate = new Map<string, { added: number; deleted: number }>()
  for (const commit of commits) {
    const date = localDay(commit.ts)
    const day = byDate.get(date) ?? { added: 0, deleted: 0 }
    for (const file of commit.files) {
      day.added += file.add
      day.deleted += file.del
    }
    byDate.set(date, day)
  }
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - LOC_WINDOW_DAYS)
  const cutoffKey = localDay(cutoff.getTime())
  return [...byDate.entries()]
    .filter(([date]) => date >= cutoffKey)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({
      date,
      added: day.added,
      deleted: day.deleted,
      net: day.added - day.deleted,
    }))
}

/** Build the latest commit's tree with aggregated directory rows. */
export function buildGitTree(files: readonly GitFileStat[]): WorkspaceTreeEntry[] {
  const rows = new Map<string, WorkspaceTreeEntry>()
  for (const file of files) {
    const existing = rows.get(file.path)
    if (existing === undefined) {
      rows.set(file.path, { depth: file.path.split('/').length - 1, path: file.path, add: file.add, del: file.del })
    } else {
      existing.add += file.add
      existing.del += file.del
    }
    const parts = file.path.split('/')
    let prefix = ''
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (part === undefined) continue
      prefix += `${part}/`
      const dir = rows.get(prefix)
      if (dir === undefined) {
        rows.set(prefix, { depth: i, path: prefix, add: file.add, del: file.del, directory: true })
      } else {
        dir.add += file.add
        dir.del += file.del
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Recent change rows: one row per committed file, newest first. */
export function buildChanges(commits: readonly GitCommit[]): PendingChange[] {
  const rows: PendingChange[] = []
  for (const commit of commits) {
    for (const file of commit.files) {
      rows.push({
        hash: commit.hash,
        row: {
          ts: commit.ts,
          time: localTime(commit.ts),
          path: file.path,
          msg: commit.files.length > 1 ? `${commit.subject}（${commit.files.length} 个文件）` : commit.subject,
          add: file.add,
          del: file.del,
        },
      })
      if (rows.length >= MAX_CHANGES) return rows
    }
  }
  return rows
}

function truncateDiff(text: string): string {
  if (text.length <= DIFF_MAX_CHARS) return text
  return `${text.slice(0, DIFF_MAX_CHARS)}\n…(截断)`
}

/**
 * Cached, per-workspace git view with in-flight deduplication.
 *
 * The TTL only governs how often `git rev-parse HEAD` runs (cheap); the
 * expensive `git log --numstat` re-read happens only when HEAD actually moved.
 * Committing is the only thing that changes committed history, so a large
 * repository is no longer re-walked every TTL window.
 */
export class WorkspaceGitIndex {
  private readonly cache = new Map<string, { at: number; head: string | null; value: WorkspaceGitView }>()
  private readonly failures = new Map<string, { at: number }>()
  private readonly inflight = new Map<string, Promise<WorkspaceGitView | null>>()

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly git: GitRunner = runGit,
  ) {}

  /**
   * Read (or serve from cache) the git view for one workspace; null = unavailable.
   * `now` is the caller's clock (the snapshot's `generatedAt`) and is used for
   * both TTL checks and cache stamps, so the two never disagree.
   */
  async view(cwd: string, now = Date.now()): Promise<WorkspaceGitView | null> {
    const hit = this.cache.get(cwd)
    if (hit !== undefined) {
      if (now - hit.at < this.ttlMs) return hit.value
      // TTL elapsed: only the HEAD fingerprint is re-read, not the whole log.
      const head = await this.readHead(cwd)
      if (head !== null && head === hit.head) {
        hit.at = now
        return hit.value
      }
    }
    const miss = this.failures.get(cwd)
    if (miss !== undefined && now - miss.at < FAILURE_TTL_MS) return null
    let pending = this.inflight.get(cwd)
    if (pending === undefined) {
      pending = this.collect(cwd).finally(() => { this.inflight.delete(cwd) })
      this.inflight.set(cwd, pending)
    }
    const value = await pending
    if (value === null) {
      this.failures.set(cwd, { at: now })
      this.cache.delete(cwd)
    } else {
      this.cache.set(cwd, { at: now, head: await this.readHead(cwd), value })
    }
    return value
  }

  /** Drop one workspace's cache, or all caches when cwd is omitted. */
  invalidate(cwd?: string): void {
    if (cwd === undefined) {
      this.cache.clear()
      this.failures.clear()
      return
    }
    this.cache.delete(cwd)
    this.failures.delete(cwd)
  }

  /** Current commit id; null when unavailable (not a repo / no commits). */
  private async readHead(cwd: string): Promise<string | null> {
    const text = await this.git(cwd, ['rev-parse', 'HEAD'])
    if (text === null) return null
    const head = text.trim()
    return head.length > 0 ? head : null
  }

  private async collect(cwd: string): Promise<WorkspaceGitView | null> {
    const historyText = await this.git(cwd, [
      'log',
      `--max-count=${HISTORY_COMMITS}`,
      '--pretty=format:%x1e%H%x1f%ct%x1f%s',
      '--numstat',
      '--no-renames',
      '--no-merges',
    ])
    if (historyText === null) return null
    const commits = parseHistory(historyText)
    if (commits.length === 0) return null

    const pending = buildChanges(commits)
    const diffs = await Promise.all(pending.slice(0, MAX_DIFF_ROWS).map(async ({ row, hash }) => {
      const text = await this.git(cwd, ['show', hash, '--format=', '--no-ext-diff', '--unified=3', '--', row.path])
      if (text === null || text.length === 0) return row
      return { ...row, diff: truncateDiff(text) }
    }))
    const changes = [...diffs, ...pending.slice(MAX_DIFF_ROWS).map(({ row }) => row)]

    const treeText = await this.git(cwd, ['show', 'HEAD', '--numstat', '--pretty=format:', '--no-renames'])
    const treeFiles = treeText === null ? [] : parseNumstat(treeText)
    return {
      changes,
      gitTree: treeFiles.length > 0 ? buildGitTree(treeFiles) : [],
      locSeries: foldLocDays(commits),
    }
  }
}
