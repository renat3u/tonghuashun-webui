/**
 * DSH 桥接层
 *
 * 本前端有两种数据来源：
 *  1. 独立运行（当前默认）：`src/lib/useMarketEngine.ts` 的确定性模拟行情
 *  2. 嵌入 DSH Web 外壳（`dsh web` 会注入 `window.__DSH_BOOT__`）：
 *     会话/轨迹经 slots + useSession 真实接入；行情/LOC/最近变更经
 *     `/tonghuashun/snapshot`（meter 插件）真实接入。
 *
 * 下面的 `DshProvider.onTrajectory` / `locSeries` 是旧数据面：对话轨迹已由
 * ChatPanel 的真实会话节点替换，K 线 LOC 已由快照 `workspaces[].locSeries`
 * 替换，当前无调用方，保留仅为历史契约参考。
 *
 * 接入步骤见 src/bridge/README.md。
 */

/** @deprecated 轨迹已由 ChatPanel 的真实会话节点映射，不再使用。 */
export interface TrajectoryEvent {
  seq: number
  ts: number
  kind: 'think' | 'read' | 'bash' | 'skill' | 'edit'
  text: string
  detail?: string
}

/** @deprecated LOC 历史已由 snapshot `workspaces[].locSeries` 映射，不再使用。 */
export interface LocSample {
  /** 交易日 epoch ms */
  t: number
  /** 当日代码量（行） */
  loc: number
  /** 变更（+新增 / -删除） */
  delta: number
}

/** 数据提供者契约：真实 DSH 环境与 mock 环境实现同一接口（旧数据面）。 */
export interface DshProvider {
  readonly live: boolean
  readonly version: string
  sessionId(): string | null
  /** @deprecated 无调用方；真实轨迹来自会话节点快照。 */
  onTrajectory(cb: (ev: TrajectoryEvent) => void): () => void
  /** @deprecated 无调用方；真实 LOC 来自 meter 快照。 */
  locSeries(code: string): Promise<LocSample[]>
}

interface DshBootShape {
  version?: string
  session?: { id?: string }
  [key: string]: unknown
}

declare global {
  interface Window {
    __DSH_BOOT__?: unknown
  }
}

export function isLiveBridge(): boolean {
  return typeof window !== 'undefined' && window.__DSH_BOOT__ != null
}

function readBoot(): DshBootShape | null {
  if (!isLiveBridge()) return null
  const boot = window.__DSH_BOOT__ as DshBootShape
  return boot && typeof boot === 'object' ? boot : null
}

/** 真实 DSH 环境 provider：消费 window.__DSH_BOOT__ 注入的服务 */
class LiveProvider implements DshProvider {
  readonly live = true
  readonly version: string
  private boot: DshBootShape | null

  constructor() {
    this.boot = readBoot()
    this.version = this.boot?.version ?? '0.0.0'
  }

  sessionId(): string | null {
    return this.boot?.session?.id ?? null
  }

  /** @deprecated 真实轨迹已由 ChatPanel 会话节点快照提供。 */
  onTrajectory(cb: (ev: TrajectoryEvent) => void): () => void {
    void cb
    return () => {}
  }

  /** @deprecated 真实 LOC 历史由 `/tonghuashun/snapshot` 的 locSeries 字段提供。 */
  async locSeries(): Promise<LocSample[]> {
    return []
  }
}

/** mock provider：独立运行时返回空流，行情仍由 useMarketEngine 提供 */
class MockProvider implements DshProvider {
  readonly live = false
  readonly version = 'mock'

  sessionId(): string | null {
    return 'th-20260807-0945'
  }

  onTrajectory(): () => void {
    return () => {}
  }

  async locSeries(): Promise<LocSample[]> {
    return []
  }
}

let cached: DshProvider | null = null

export function createProvider(): DshProvider {
  if (!cached) cached = isLiveBridge() ? new LiveProvider() : new MockProvider()
  return cached
}
