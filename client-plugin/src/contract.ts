/**
 * 本地结构类型：镜像 dsh 客户端运行时（@deepseek-ai/dsh-client-runtime +
 * @deepseek-ai/dsh-client-ui-slots + @deepseek-ai/dsh-client-web）在 root 槽
 * 注册路径上的公开契约。
 *
 * 独立构建（out-of-tree）不解析 monorepo 包类型，因此这里用与真实签名
 * 逐一对应的结构声明；运行时由外壳提供的真实服务满足。改动前对照
 * packages/client/runtime、packages/client/ui-slots 与 packages/client/web 的
 * SlotMap / register / sessions / workspaces。
 *
 * DSH 0.1.1-rc.1：dsh-client-runtime 内置 'root' 单槽；ui-layout 被禁用后
 * 本插件直接注册 root 接管界面，无需再提供 layout 占位服务。
 * P0 对话接入：root 声明子槽 terminal.chat（single / session-maybe），
 * ChatPanel 注册进该槽获得框架 useSession 座位；send/cancel/newSession
 * 回调经 inject 面下发。
 */

import type { ReactElement, ReactNode } from 'react'

/** 纯文本 prompt 内容块（dsh PromptContentPart 的结构子集）。 */
export interface PromptTextPart {
  type: 'text'
  text: string
}

/** RPC 结果面（dsh RpcResult 的结构子集：业务失败时 ok=false）。 */
export interface RpcResultLike {
  ok: boolean
}

/** 用户消息内容块（dsh-llm ContentBlock 的结构子集）。 */
export interface ContentBlockLike {
  type: string
  text?: string
}

/** 助手输出块（dsh AssistantBlock 的结构子集）。 */
export interface AssistantBlockLike {
  kind: string
  text?: string
  name?: string
  argsRaw?: string
  callId?: string
}

/** 模型溯源（dsh AssistantProvenanceView 的结构子集）。 */
export interface AssistantProvenanceLike {
  provider: string
  model: string
}

/** 已定稿用户消息节点。 */
export interface UserMessageNodeLike {
  kind: 'user'
  seq: number
  /** Unix epoch ms。 */
  time: number
  content: readonly ContentBlockLike[]
}

/** 已定稿（或中断冻结）助手消息节点。 */
export interface AssistantMessageNodeLike {
  kind: 'assistant'
  seq: number
  time: number
  blocks: readonly AssistantBlockLike[]
  provenance?: AssistantProvenanceLike
  interrupted?: true
  /** 所属回合/步骤（本插件节点定义附加）。 */
  turn?: number
  step?: number
}

/** 运行中被 admit 的用户补充消息。 */
export interface SteeringMessageNodeLike {
  kind: 'steering'
  seq: number
  time: number
  content: readonly ContentBlockLike[]
}

/** 上下文注入节点。 */
export interface ContextMessageNodeLike {
  kind: 'context'
  seq: number
  time: number
  content: readonly ContentBlockLike[]
}

/** 工具结果节点（与在窗工具调用头配对）。 */
export interface ToolResultNodeLike {
  kind: 'tool-result'
  seq: number
  time: number
  callId: string
  call: { name: string; argsRaw: string } | null
  content: readonly ContentBlockLike[]
  isError: boolean
}

/** 斜杠命令生命周期节点。 */
export interface CommandNodeLike {
  kind: 'command'
  seq: number
  time: number
  name: string | null
  args: string | null
  outcome: { kind: string; text?: string } | null
}

/** 压缩检查点节点。 */
export interface CompactionSummaryNodeLike {
  kind: 'compaction'
  seq: number
  time: number
  summary: string | null
}

/** 回合失败节点。 */
export interface TurnErrorNodeLike {
  kind: 'turn-error'
  seq: number
  time: number
  message: string
}

/** 输出 token 上限终止节点。 */
export interface TurnMaxTokensNodeLike {
  kind: 'turn-max-tokens'
  seq: number
  time: number
}

/** 模型重试节点。 */
export interface ModelRetryNodeLike {
  kind: 'model-retry'
  seq: number
  time: number
}

/** 未知表面事件回退节点。 */
export interface UnknownSurfaceNodeLike {
  kind: 'unknown'
  seq: number
  time: number
  type: string
}

/** 对话节点联合（结构子集；kind 判别）。 */
export type ConversationNodeLike =
  | UserMessageNodeLike
  | AssistantMessageNodeLike
  | SteeringMessageNodeLike
  | ContextMessageNodeLike
  | ToolResultNodeLike
  | CommandNodeLike
  | CompactionSummaryNodeLike
  | TurnErrorNodeLike
  | TurnMaxTokensNodeLike
  | ModelRetryNodeLike
  | UnknownSurfaceNodeLike

/** 流式中的助手输出。 */
export interface PartialAssistantLike {
  turn: number
  step: number
  blocks: readonly AssistantBlockLike[]
}

/** 会话快照（dsh ConversationSnapshot 的结构子集）。 */
export interface ConversationSnapshotLike {
  sessionId: string
  nodes: readonly ConversationNodeLike[]
  partial: PartialAssistantLike | null
  running: boolean
  openState: string
  promptError: { op: string; error: { code: string; message: string } } | null
  removed: boolean
  blank: boolean
}

/** 会话行为面（dsh SessionFace 的结构子集）。 */
export interface SessionFaceLike {
  sessionId: string
  prompt(content: readonly PromptTextPart[], mode: 'queue' | 'steer'): Promise<RpcResultLike>
  cancel(): Promise<RpcResultLike>
  getSnapshot(): ConversationSnapshotLike
  subscribe(fn: () => void): () => void
}

/** 会话装配句柄（dsh SessionBinding 的结构子集）。 */
export interface SessionBindingLike {
  sessionId: string
  session: SessionFaceLike
}

/** 会话列表行（dsh SessionSummary 的结构子集）。 */
export interface SessionSummaryLike {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  running: boolean
  blank: boolean
  updatedAt: number
}

/** 会话列表快照（dsh SessionListState 的结构子集）。 */
export interface SessionListStateLike {
  ids: string[]
  byId: Record<string, SessionSummaryLike>
  current: string | undefined
  phase: string
}

/** 最小可观察快照源。 */
export interface ObservableSnapshotLike<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** 选择器钩子（框架 seat；useSessions/useSession 的结构镜像）。 */
export type SnapshotSelectorHook<T> = <S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S

/** 会话可缺选择器钩子（session-maybe seat）。 */
export type MaybeSnapshotSelectorHook<T> = <S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S | undefined

/** sessions 服务面（dsh ISessions 的结构子集）。 */
export interface ISessionsLike {
  list: ObservableSnapshotLike<SessionListStateLike>
  open(id: string): void
  clear(): void
  binding(id: string): SessionBindingLike | undefined
}

/** 工作区行（dsh WorkspaceView 的结构子集）。 */
export interface WorkspaceViewLike {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

/** 工作区列表快照（dsh WorkspaceListState 的结构子集）。 */
export interface WorkspaceListStateLike {
  items: readonly WorkspaceViewLike[]
  state: string
  phase: string
  baselinesReady: boolean
  recentWorkspaceId: string | undefined
}

/** workspaces 服务面（dsh IWorkspaces 的结构子集）。 */
export interface IWorkspacesLike {
  list: ObservableSnapshotLike<WorkspaceListStateLike>
  startSession(): void
  openPath(path: string): Promise<void>
}

/** ChatPanel 注册项的 inject 面：纯回调，闭包持有 apply ctx。 */
export interface ChatOps {
  /**
   * 发送一条消息；无当前会话时先走新建会话流程。
   * @param text - 消息文本。
   * @param mode - queue 追加回合（默认）；steer 打断运行中回合。
   * @returns 是否被接受（业务/传输失败为 false，同时落在 snapshot.promptError）。
   */
  send(text: string, mode?: 'queue' | 'steer'): Promise<boolean>
  /** 取消当前运行中的回合。 */
  cancel(): void
  /** 新建会话（走 workspaces.startSession）。 */
  newSession(): void
}

/** root 注册项的 inject 面。 */
export interface RootOps {
  /** 打开指定会话。 */
  openSession(id: string): void
  /** 新建会话。 */
  newSession(): void
  /** 用系统默认应用打开一个路径（文件/目录）。 */
  openPath(path: string): Promise<void>
}

/** ChatPanel 槽的 owner 面（TerminalRoot 经 renderSlot 下传）。 */
export interface ChatOwnerProps {
  selectedName: string
  sessionTitle?: string
  sessionCwd?: string
}

/** ChatPanel 收到的会话标准 seat（session-maybe 作用域的结构镜像）。 */
export interface ChatStandardProps {
  useSession: MaybeSnapshotSelectorHook<ConversationSnapshotLike>
  sessionId: string | undefined
}

/** ChatPanel 完整 props = owner 面 + 标准 seat + inject 面。 */
export interface ChatPanelProps extends ChatOwnerProps, ChatStandardProps, ChatOps {}

/** root 组件 props = 全局 seat（useSessions/useWorkspaces）+ renderSlot + root inject 面。 */
export interface RootProps extends RootOps {
  useSessions: SnapshotSelectorHook<SessionListStateLike>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListStateLike>
  renderSlot: (key: 'terminal.chat', owner: ChatOwnerProps) => ReactNode
}

/** root 注册参数：终端界面声明子槽 terminal.chat（single / session-maybe）。 */
export interface RootRegisterOptions {
  name: 'root'
  children: {
    'terminal.chat': { kind: 'single'; scope: 'session-maybe' }
  }
  inject: () => RootOps
}

/** terminal.chat 注册参数：inject 工厂按声明收到当前 sessionId（可缺）。 */
export interface ChatRegisterOptions {
  name: 'terminal.chat'
  inject: (sessionId?: string) => ChatOps
}

/** SlotsService 的注册面（ctx.slots）。 */
export interface SlotsLike {
  register(options: RootRegisterOptions, component: (props: RootProps) => ReactElement): () => void
  register(options: ChatRegisterOptions, component: (props: ChatPanelProps) => ReactElement): () => void
  /** 等待某个槽被声明后执行回调（回调返回释放器）；声明倒塌时移除贡献。 */
  inject(key: string, callback: () => () => void): () => void
}

/** 会话节点定义注册面（runtime conversationEvents 的结构子集）。 */
export interface ConversationEventsLike {
  register(definition: unknown): () => void
}

/** 会话视图构建器注册面（runtime conversationViews 的结构子集）。 */
export interface ConversationViewsLike {
  register(definition: { target: string; create(): unknown }): () => void
}

/** 客户端 fiber 上下文：插件通过声明注入获得这些服务。 */
export interface ClientContext {
  slots: SlotsLike
  sessions: ISessionsLike
  workspaces: IWorkspacesLike
  conversationEvents: ConversationEventsLike
  conversationViews: ConversationViewsLike
  /** cordis 效果：返回释放器；fiber 销毁时执行。 */
  effect(effect: () => () => void, label?: string): void
}
