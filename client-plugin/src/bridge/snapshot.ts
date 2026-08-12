/**
 * 与 dsh-tonghuashun-meter 插件的 HTTP 数据契约（plugin/ 目录）。
 *
 * 当本前端嵌入 dsh web（同源）或插件部署在同一主机时，`fetchSnapshot()` 拉取
 * `GET /tonghuashun/snapshot` 返回的聚合快照；`Snapshot` 类型与插件的
 * `src/types.ts` 保持一致（wire 单一来源见 plugin/README.md）。
 */

/** 服务端日聚合（与插件 DayStat 同构）。 */
export interface SnapshotDay {
  date: string
  tokens: number
  inputTokens: number
  outputTokens: number
  byWorkspace: Record<string, number>
  workspaceSessions: Record<string, number>
  workspaceToolCalls: Record<string, number>
  byModel: Record<string, number>
  sessions: number
  toolCalls: number
}

/** 服务端分钟桶（分时成交数据源）。 */
export interface SnapshotMinute {
  minute: string
  tokens: number
  inputTokens: number
  outputTokens: number
}

/** GET /tonghuashun/snapshot 的响应体。 */
export interface Snapshot {
  generatedAt: number
  totalTokens: number
  today: SnapshotDay | null
  minuteSeries: SnapshotMinute[]
  daySeries: SnapshotDay[]
  workspaces: { cwd: string; tokens: number; sessions: number; toolCalls: number }[]
  models: { model: string; tokens: number }[]
}

/** 拉取插件快照；插件未部署/未加载时返回 null（前端回退到模拟行情）。 */
export async function fetchSnapshot(timeoutMs = 3000): Promise<Snapshot | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch('/tonghuashun/snapshot', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return null
      const data: unknown = await res.json()
      return data as Snapshot
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/**
 * TODO(dsh): 把 Snapshot 映射进 useMarketEngine 的数据模型：
 *  - minuteSeries   → 分时成交（每分钟 Token 消耗）
 *  - daySeries      → K 线日 K（tokens 为收盘价，累加历史 days.json 恢复）
 *  - workspaces     → 左栏关注项目（cwd 为名称，tokens 为消耗量）
 *  - today.byModel  → token 流向
 * 映射完成后，LiveProvider 在 window.__DSH_BOOT__ 存在且 fetch 成功时切换为真实数据。
 */
