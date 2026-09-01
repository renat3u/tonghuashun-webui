/**
 * Workspace git index for the 最近变更 / git tree / LOC panes.
 *
 * The meter bundle reads git repositories directly on the host (no shell
 * interpolation — `git` is executed with an argv list). A DSH workspace is a
 * project FOLDER, not necessarily one repository: the index discovers every
 * nested git repository under the workspace (bounded scan, skipping
 * `node_modules`/build caches) and merges their commits into one view.
 * Nested repository paths are prefixed with the repository's workspace-relative
 * directory, so `sub/project/src/a.ts` remains unambiguous in the merged rows.
 *
 * Results are cached per workspace with a short TTL; file-mutating tool calls
 * invalidate the affected workspace so the next snapshot poll re-reads it.
 *
 * A workspace that contains no git repository (or where git is unavailable)
 * yields `null`: clients show an explicit empty state and never fall back to
 * invented data.
 */
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspaceChange, WorkspaceLocDay, WorkspaceTreeEntry } from './types.js'

const execFileAsync = promisify(execFile)

/** Maximum git subprocess wall time per command. */
const GIT_TIMEOUT_MS = 4000
/** `git log` reads this many commits per repository for change rows + LOC history. */
const HISTORY_COMMITS = 2000
/** Maximum recent-change rows served for one workspace. */
const MAX_CHANGES = 24
/** Maximum change rows that carry an inline unified diff. */
const MAX_DIFF_ROWS = 6
/** Inline diff truncation (characters) before the "…(截断)" marker. */
const DIFF_MAX_CHARS = 2600
/** LOC history window (days). */
const LOC_WINDOW_DAYS = 180
/** Cache TTL for successful reads (also the fingerprint re-check interval). */
const DEFAULT_TTL_MS = 30_000
/** Negative-cache TTL (no git repository / git failure). */
const FAILURE_TTL_MS = 60_000
/** Nested-repository discovery bounds: directory depth. */
const SCAN_MAX_DEPTH = 8
/** Nested-repository discovery bounds: directories read per workspace. */
const SCAN_MAX_DIRS = 3000
/** Directories that are never project repositories and may be huge. */
const SCAN_SKIP = new Set([
  '.git',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  'coverage',
  '__pycache__',
  'venv',
  '.venv',
])

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
  /** Repository-relative file path for `git show <hash> -- <path>`. */
  repoPath: string
}

/** One discovered repository inside a workspace folder. */
export interface GitRepoRef {
  /** Absolute repository root used as `git -C` cwd. */
  root: string
  /** Workspace-relative directory prefix ('' for the workspace root itself). */
  prefix: string
}

/** A fingerprint of all repositories whose history feeds one cached view. */
interface RepoFingerprint {
  root: string
  prefix: string
  head: string
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

function toPosixPath(value: string): string {
  return value === sep ? value : value.split(sep).join('/')
}

/** Join a nested repository prefix with a repository-relative git path. */
function prefixPath(prefix: string, path: string): string {
  return prefix.length === 0 ? path : `${prefix}/${path}`
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

/**
 * Recent change rows: one row per committed file, newest first.
 * `prefix` makes nested-repository paths workspace-relative.
 */
export function buildChanges(commits: readonly GitCommit[], prefix = ''): PendingChange[] {
  const rows: PendingChange[] = []
  for (const commit of commits) {
    for (const file of commit.files) {
      rows.push({
        hash: commit.hash,
        repoPath: file.path,
        row: {
          ts: commit.ts,
          time: localTime(commit.ts),
          path: prefixPath(prefix, file.path),
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

/** Verify one directory is a git repository with at least one commit. */
async function hasHead(root: string, git: GitRunner): Promise<boolean> {
  const text = await git(root, ['rev-parse', 'HEAD'])
  return text !== null && text.trim().length > 0
}

/**
 * Discover every git repository under a workspace folder (including the
 * workspace root itself). The scan is bounded in depth and directory count and
 * skips dependency/build directories; `.git` files (worktrees/submodules) are
 * recognized. A discovered repository must have at least one commit.
 * @param cwd - workspace folder to scan.
 * @param git - git runner (injected in tests).
 * @returns repository roots with workspace-relative prefixes, path-ascending.
 */
export async function discoverGitRoots(cwd: string, git: GitRunner = runGit): Promise<GitRepoRef[]> {
  const base = resolve(cwd)
  const found = new Map<string, GitRepoRef>()
  const queue: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }]
  let scanned = 0
  while (queue.length > 0 && scanned < SCAN_MAX_DIRS) {
    const item = queue.shift()
    if (item === undefined) break
    scanned += 1
    let entries
    try {
      entries = await readdir(item.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git') {
        const root = item.dir
        if (!found.has(root) && await hasHead(root, git)) {
          found.set(root, { root, prefix: toPosixPath(relative(base, root)) })
        }
        continue
      }
      if (SCAN_SKIP.has(entry.name) || item.depth >= SCAN_MAX_DEPTH) continue
      // Symlinked directories can escape the workspace or create cycles; skip them.
      if (entry.isDirectory()) queue.push({ dir: resolve(item.dir, entry.name), depth: item.depth + 1 })
    }
  }
  return [...found.values()].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
}

/** Merge daily LOC series from multiple repositories (same date sums). */
function mergeLocSeries(series: readonly WorkspaceLocDay[][]): WorkspaceLocDay[] {
  const byDate = new Map<string, { added: number; deleted: number }>()
  for (const rows of series) {
    for (const day of rows) {
      const target = byDate.get(day.date) ?? { added: 0, deleted: 0 }
      target.added += day.added
      target.deleted += day.deleted
      byDate.set(day.date, target)
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({ date, added: day.added, deleted: day.deleted, net: day.added - day.deleted }))
}

/** Merge git trees from multiple repositories (same path sums). */
function mergeTrees(trees: readonly WorkspaceTreeEntry[][]): WorkspaceTreeEntry[] {
  const rows = new Map<string, WorkspaceTreeEntry>()
  for (const tree of trees) {
    for (const row of tree) {
      const target = rows.get(row.path)
      if (target === undefined) rows.set(row.path, { ...row })
      else {
        target.add += row.add
        target.del += row.del
        target.directory = target.directory === true || row.directory === true
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Partial git view collected from one repository. */
interface RepoView {
  changes: WorkspaceChange[]
  gitTree: WorkspaceTreeEntry[]
  locSeries: WorkspaceLocDay[]
}

/** Merge per-repository views into one workspace view. */
function mergeRepoViews(views: readonly RepoView[]): WorkspaceGitView {
  // Same-timestamp rows keep the source order (git log already newest-first);
  // stable sort preserves that order across multiple repositories too.
  const changes = views
    .flatMap((view) => view.changes)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_CHANGES)
  return {
    changes,
    gitTree: mergeTrees(views.map((view) => view.gitTree)),
    locSeries: mergeLocSeries(views.map((view) => view.locSeries)),
  }
}

/**
 * Cached, per-workspace git view with in-flight deduplication.
 *
 * The TTL only governs how often the repository fingerprint is re-read (a
 * bounded directory scan plus cheap `git rev-parse HEAD` per discovered
 * repository); the expensive `git log --numstat` re-read happens only when a
 * repository appeared/disappeared or its HEAD moved. Committing is the only
 * thing that changes committed history, so a large workspace is not re-walked
 * every TTL window.
 */
export class WorkspaceGitIndex {
  private readonly cache = new Map<string, { at: number; repos: RepoFingerprint[]; value: WorkspaceGitView }>()
  private readonly failures = new Map<string, { at: number }>()
  private readonly inflight = new Map<string, Promise<{ repos: RepoFingerprint[]; value: WorkspaceGitView } | null>>()

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly git: GitRunner = runGit,
    private readonly discover: (cwd: string, git: GitRunner) => Promise<GitRepoRef[]> = discoverGitRoots,
  ) {}

  /**
   * Read (or serve from cache) the aggregated git view for one workspace;
   * null = no readable repository under it. `now` is the caller's clock (the
   * snapshot's `generatedAt`) and is used for both TTL checks and cache
   * stamps, so the two never disagree.
   */
  async view(cwd: string, now = Date.now()): Promise<WorkspaceGitView | null> {
    const hit = this.cache.get(cwd)
    if (hit !== undefined) {
      if (now - hit.at < this.ttlMs) return hit.value
      // TTL elapsed: only the fingerprint is re-read, not the whole log.
      const repos = await this.inspect(cwd)
      if (repos !== null && sameFingerprints(repos, hit.repos)) {
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
    const collected = await pending
    if (collected === null) {
      this.failures.set(cwd, { at: now })
      this.cache.delete(cwd)
    } else {
      this.cache.set(cwd, { at: now, repos: collected.repos, value: collected.value })
    }
    return collected === null ? null : collected.value
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

  /** Discover repositories and read their HEAD fingerprints. */
  private async inspect(cwd: string): Promise<RepoFingerprint[] | null> {
    const refs = await this.discover(cwd, this.git)
    const repos = await Promise.all(refs.map(async (ref) => {
      const head = await this.readHead(ref.root)
      return head === null ? undefined : { root: ref.root, prefix: ref.prefix, head }
    }))
    const live = repos.filter((repo): repo is RepoFingerprint => repo !== undefined)
    return live.length > 0 ? live : null
  }

  /** Read one repository's history and prefix its paths for the workspace. */
  private async collectRepo(ref: GitRepoRef): Promise<RepoView | null> {
    const historyText = await this.git(ref.root, [
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

    const pending = buildChanges(commits, ref.prefix)
    const diffs = await Promise.all(pending.slice(0, MAX_DIFF_ROWS).map(async ({ row, hash, repoPath }) => {
      const text = await this.git(ref.root, ['show', hash, '--format=', '--no-ext-diff', '--unified=3', '--', repoPath])
      if (text === null || text.length === 0) return row
      return { ...row, diff: truncateDiff(text) }
    }))
    const changes = [...diffs, ...pending.slice(MAX_DIFF_ROWS).map(({ row }) => row)]

    const treeText = await this.git(ref.root, ['show', 'HEAD', '--numstat', '--pretty=format:', '--no-renames'])
    const treeFiles = treeText === null ? [] : parseNumstat(treeText)
    return {
      changes,
      gitTree: treeFiles.length > 0
        ? buildGitTree(treeFiles.map((file) => ({ ...file, path: prefixPath(ref.prefix, file.path) })))
        : [],
      locSeries: foldLocDays(commits),
    }
  }

  /** Discover, read, and merge every repository under one workspace. */
  private async collect(cwd: string): Promise<{ repos: RepoFingerprint[]; value: WorkspaceGitView } | null> {
    const repos = await this.inspect(cwd)
    if (repos === null) return null
    const views = await Promise.all(repos.map((repo) => this.collectRepo({ root: repo.root, prefix: repo.prefix })))
    const live = views.filter((view): view is RepoView => view !== null)
    if (live.length === 0) return null
    return { repos, value: mergeRepoViews(live) }
  }
}

function sameFingerprints(left: readonly RepoFingerprint[], right: readonly RepoFingerprint[]): boolean {
  return left.length === right.length
    && left.every((repo, index) => {
      const other = right[index]
      return other !== undefined
        && repo.root === other.root
        && repo.prefix === other.prefix
        && repo.head === other.head
    })
}
