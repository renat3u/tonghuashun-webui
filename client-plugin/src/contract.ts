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

/** 图片 prompt 内容块（dsh PromptContentPart 的 image 子集）。 */
export interface PromptImagePart {
  type: 'image'
  mediaType: string
  data: string
  name?: string
}

/** prompt 内容块联合。 */
export type PromptPart = PromptTextPart | PromptImagePart

/** 会话队列中的一条待处理消息（dsh QueuedMessage 的结构子集）。 */
export interface QueuedMessageLike {
  id: string
  messageId: string
  placement: 'queued' | 'steering' | 'context'
  preview: string
  text: string | null
}

/** 队列操作（dsh QueueAction 的结构子集）。 */
export type QueueActionLike =
  | { kind: 'edit'; content: readonly PromptPart[] }
  | { kind: 'remove' }
  | { kind: 'steer' }

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
  /** 会话 pending queue（真实 DSH 运行时提供）。 */
  queue?: readonly QueuedMessageLike[]
}

/** 权限预设投影值（dsh PermissionSelect 的结构子集）。 */
export interface PermissionSelectLike {
  options: readonly { value: string; name: string; description?: string }[]
  currentValue: string
}

/** 会话投影读面（dsh ProjectionsFace 的结构子集）。 */
export interface ProjectionsFaceLike {
  faceOf(key: string): ObservableSnapshotLike<unknown>
}

/** 会话行为面（dsh SessionFace 的结构子集）。 */
export interface SessionFaceLike {
  sessionId: string
  prompt(content: readonly PromptPart[], mode: 'queue' | 'steer'): Promise<RpcResultLike>
  cancel(): Promise<RpcResultLike>
  command(line: string): Promise<RpcResultLike>
  updateQueue?(itemId: string, action: QueueActionLike): Promise<RpcResultLike>
  /** 键寻址投影（permissions 等）；真实 DSH 运行时提供。 */
  projections?: ProjectionsFaceLike
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
  /** 直接子代理目录（可选：真实 DSH 运行时提供）。 */
  subagentsByParent?: Readonly<Record<string, {
    entries: readonly {
      kind: 'child' | 'diagnostic'
      id: string
      activity?: 'running' | 'inactive'
      hasChildren?: boolean
      mode?: 'one-shot' | 'continuable'
      label?: string
    }[]
    parentAvailable: boolean
  }>>
  /** 每会话后台任务（可选：真实 DSH 运行时提供）。 */
  jobsBySession?: Readonly<Record<string, readonly {
    id: string
    kind: string
    label: string
    status: string
    detail?: string
    startedAt: number
    finishedAt?: number
  }[]>>
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
   * @param files - 可选的图片附件（真实 DSH 会随 prompt 上传）。
   * @returns 是否被接受（业务/传输失败为 false，同时落在 snapshot.promptError）。
   */
  send(text: string, mode?: 'queue' | 'steer', files?: readonly File[]): Promise<boolean>
  /** 取消当前运行中的回合。 */
  cancel(): void
  /** 新建会话（走 workspaces.startSession）。 */
  newSession(): void
  /** 执行一条斜杠命令（如 /model deepseek-v4）。 */
  command(line: string): Promise<boolean>
  /** 对 pending queue 做编辑/移除/steer。 */
  updateQueue?(itemId: string, action: QueueActionLike): Promise<boolean>
  /** 读取当前会话的权限预设投影（无投影服务时为 undefined）。 */
  permissionSelect?(): PermissionSelectLike | undefined
  /** 订阅当前会话权限投影变化；返回取消订阅函数。 */
  subscribePermission?(fn: () => void): () => void
}

/** 左侧导航可打开的终端内面板。 */
export type TerminalPanelKind = 'skills' | 'plugins' | 'settings'

/** DSH skill.list 的行结构子集。 */
export interface SkillEntryLike {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

/** DSH pluginInventory 的行结构子集。 */
export interface PluginEntryLike {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase?: string | null
}

/** 文件索引候选（dsh FileReferenceCandidate 的结构子集）。 */
export interface FileReferenceCandidateLike {
  /** 相对当前会话工作区的路径。 */
  path: string
  kind: 'file' | 'directory'
}

/** root 注册项的 inject 面。 */
export interface RootOps {
  /** 打开指定会话。 */
  openSession(id: string): void
  /** 新建会话。 */
  newSession(): void
  /** 用系统默认应用打开一个路径（文件/目录）。 */
  openPath(path: string): Promise<void>
  /** 对当前会话执行一条斜杠命令。 */
  command(line: string): Promise<boolean>
  /** 读取当前会话可用的技能目录（非 DSH 环境可缺省）。 */
  listSkills?(): Promise<readonly SkillEntryLike[]>
  /** 读取当前 Loader 插件清单（非 DSH 环境可缺省）。 */
  listPlugins?(): Promise<readonly PluginEntryLike[]>
  /** 用系统默认应用打开 DSH 设置文档（非 DSH 环境可缺省）。 */
  openSettingsDocument?(): Promise<boolean>
  /**
   * 通过 DSH fileReferences 索引搜索当前工作区文件；
   * 服务不可用时返回 null（独立运行模式）。
   */
  searchWorkspaceFiles?(query: string, signal?: AbortSignal): Promise<readonly FileReferenceCandidateLike[] | null>
}

/** ChatPanel 槽的 owner 面（TerminalRoot 经 renderSlot 下传）。 */
export interface ChatOwnerProps {
  selectedName: string
  sessionTitle?: string
  sessionCwd?: string
  /** 真实快照中的模型列表，供模型切换弹层展示。 */
  modelOptions?: readonly string[]
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
  /** cordis 服务查找：读取已注入的 connection / remote 等服务。 */
  get?<T>(key: string): T | undefined
}
