/**
 * 真实工作区 → 终端“关注项目”行的映射。
 *
 * 优先使用 DSH workspace/session 列表作为主数据源，再用 meter 快照补充
 * Token/工具调用统计；没有真实工作区时返回空数组，由上层决定是否回退模拟。
 */
import { wsCode, wsName, type Snapshot } from '../bridge/snapshot'
import type { SessionListStateLike, WorkspaceListStateLike } from '../contract'

/** 左栏“关注项目”一行的 UI 结构。 */
export interface WorkspaceRow {
  /** 工作区稳定 id（点击时用于定位）。 */
  id: string
  /** 股票式代码，由 cwd 哈希生成。 */
  code: string
  /** 显示名（title 优先，回退目录 basename）。 */
  name: string
  /** 工作区绝对路径。 */
  cwd: string
  /** meter 快照中的 Token 累计；无 meter 数据时为 0。 */
  tokens: number
  /** 工作区下会话数（meter 优先，缺失时用 session 列表计数）。 */
  sessions: number
  /** 工具调用次数。 */
  toolCalls: number
  /** 是否有任一关联会话正在运行。 */
  running: boolean
  /** 工作区下关联的会话 id。 */
  sessionIds: readonly string[]
}

/**
 * 从真实 DSH workspace/session 列表构建关注项目行。
 * @param workspaces - `useWorkspaces` 快照。
 * @param sessions - `useSessions` 快照。
 * @param live - meter `/tonghuashun/snapshot` 快照，可为空。
 */
export function buildWorkspaceRows(
  workspaces: WorkspaceListStateLike,
  sessions: SessionListStateLike,
  live: Snapshot | null,
): WorkspaceRow[] {
  return workspaces.items.map((ws) => {
    const wsSessions = ws.sessionIds
      .map((id) => sessions.byId[id])
      .filter((s) => s !== undefined)
    const liveWs = live?.workspaces.find((w) => w.cwd === ws.path)
    return {
      id: ws.workspaceId,
      code: wsCode(ws.path),
      name: ws.title || wsName(ws.path),
      cwd: ws.path,
      tokens: liveWs?.tokens ?? 0,
      sessions: liveWs?.sessions ?? wsSessions.length,
      toolCalls: liveWs?.toolCalls ?? 0,
      running: wsSessions.some((s) => s.running),
      sessionIds: ws.sessionIds,
    }
  })
}

/**
 * 把 meter git 数据的相对路径拼回工作区绝对路径。
 * 兼容 POSIX 与 Windows 分隔符；`rel` 为绝对路径时原样返回。
 */
export function joinWorkspacePath(cwd: string, rel: string): string {
  if (rel.length === 0) return cwd
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const base = cwd.replace(/[\\/]+$/, '')
  const child = rel.replace(/^[\\/]+/, '')
  return `${base}${sep}${child}`
}
