/**
 * DSH 桥接层
 *
 * 本前端有两种数据来源：
 *  1. 独立运行（当前默认）：`src/lib/useMarketEngine.ts` 的确定性模拟行情
 *  2. 嵌入 DSH Web 外壳（`dsh web` 会注入 `window.__DSH_BOOT__`）：
 *     通过本模块的 provider 消费真实会话 / 轨迹 / 代码量事件流。
 *
 * 接入步骤见 src/bridge/README.md。
 */

/** Trajectory 工具调用事件（对应 DSH session 事件流） */
export interface TrajectoryEvent {
  seq: number
  ts: number
  kind: 'think' | 'read' | 'bash' | 'skill' | 'edit'
  text: string
  detail?: string
}

/** 代码量时间序列采样（K 线数据源） */
export interface LocSample {
  /** 交易日 epoch ms */
  t: number
  /** 当日代码量（行） */
  loc: number
  /** 变更（+新增 / -删除） */
  delta: number
}

/** 数据提供者契约：真实 DSH 环境与 mock 环境实现同一接口 */
export interface DshProvider {
  readonly live: boolean
  readonly version: string
  sessionId(): string | null
  /** 订阅轨迹事件，返回取消订阅函数 */
  onTrajectory(cb: (ev: TrajectoryEvent) => void): () => void
  /** 拉取指定包的代码量日线 */
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

  onTrajectory(cb: (ev: TrajectoryEvent) => void): () => void {
    // TODO(dsh): 订阅 window.__DSH_BOOT__ 暴露的 session 事件总线，
    // 把 tool_call / think / edit 事件映射为 TrajectoryEvent。
    void cb
    return () => {}
  }

  async locSeries(): Promise<LocSample[]> {
    // TODO(dsh): 通过 session-query 服务读取仓库 LOC 历史。
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
