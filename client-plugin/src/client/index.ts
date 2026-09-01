/**
 * 浏览器半：样式注入 + 'root' 槽注册 + terminal.chat 子槽。
 *
 * 'root' 由外壳（dsh-client-runtime）内置声明为唯一单槽；本插件在禁用默认
 * ui-layout 的部署中注册 'root' 接管终端界面，并配合
 * deploy/web-terminal.patch.yml 禁用其余默认 web UI 行（见包 README 的安装步骤）。
 *
 * P0 对话接入：
 *  - TerminalRoot 注册 root 时声明子槽 terminal.chat（single / session-maybe）；
 *  - ChatPanel 经 slots.inject 在 terminal.chat 声明后注册进该槽，获得框架
 *    useSession/sessionId 座位；
 *  - send/cancel/newSession 回调在 inject 工厂里闭包 apply ctx（sessions /
 *    workspaces 服务），组件永不接触 ctx。
 */
import type {
  ChatOps,
  ClientContext,
  FileReferenceCandidateLike,
  ModelDirectoryLike,
  ObservableSnapshotLike,
  PermissionSelectLike,
  PluginEntryLike,
  PromptPart,
  RootOps,
  SessionFaceLike,
  SkillEntryLike,
} from '../contract.js'
import { registerThsConversation, type ConversationRegistriesLike } from '../conversation/nodes.js'
import { findModelSelection } from '../lib/model-directory.js'
import { TERMINAL_CSS } from './styles.generated.js'
import { TerminalRoot } from './TerminalRoot.js'
import { ChatPanel } from '../components/ChatPanel.js'

const STYLE_TAG_ID = 'tonghuashun/global.css'

/** Services required by the terminal plugin (runtime-provided). */
export const inject = ['slots', 'sessions', 'workspaces', 'conversationEvents', 'conversationViews', 'connection', 'remote', 'remote.pluginInventory']

/** 无会话时等待 startSession 落地的超时。 */
const SESSION_WAIT_MS = 10000

/** 当前列表快照里的 current 会话 id。 */
function currentSessionId(ctx: ClientContext): string | undefined {
  return ctx.sessions.list.getSnapshot().current
}

/** 解析会话行为面（优先绑定注入时的 sessionId，回退当前会话）。 */
function sessionFaceOf(ctx: ClientContext, boundSessionId: string | undefined): SessionFaceLike | undefined {
  const id = boundSessionId ?? currentSessionId(ctx)
  return id !== undefined ? ctx.sessions.binding(id)?.session : undefined
}

/** 当前会话的 permissions 投影读面（缺失 = 环境未提供权限服务）。 */
function permissionFaceOf(ctx: ClientContext, boundSessionId: string | undefined): ObservableSnapshotLike<unknown> | undefined {
  return sessionFaceOf(ctx, boundSessionId)?.projections?.faceOf('permissions')
}

/** 防御式读取投影值为 PermissionSelectLike；结构不合法返回 undefined。 */
function permissionSelectOf(ctx: ClientContext, boundSessionId: string | undefined): PermissionSelectLike | undefined {
  const value = permissionFaceOf(ctx, boundSessionId)?.getSnapshot()
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as { currentValue?: unknown; options?: unknown }
  if (typeof candidate.currentValue !== 'string') return undefined
  const options: { value: string; name: string; description?: string }[] = []
  if (Array.isArray(candidate.options)) {
    for (const raw of candidate.options) {
      if (raw === null || typeof raw !== 'object') continue
      const option = raw as { value?: unknown; name?: unknown; description?: unknown }
      if (typeof option.value !== 'string' || typeof option.name !== 'string') continue
      options.push({
        value: option.value,
        name: option.name,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
      })
    }
  }
  return { options, currentValue: candidate.currentValue }
}

/**
 * 等一个当前会话出现（无会话时触发 startSession）。startSession 是异步落地
 * （连接/新建空白会话后 open），因此订阅列表直到 current 出现或超时。
 * @param ctx - apply 闭包的客户端上下文。
 * @returns 会话 id；超时（无工作区等）返回 undefined。
 */
function waitForSession(ctx: ClientContext): Promise<string | undefined> {
  const existing = currentSessionId(ctx)
  if (existing !== undefined) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const finish = (): string | undefined => {
      clearTimeout(timer)
      unsubscribe()
      return currentSessionId(ctx)
    }
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      if (currentSessionId(ctx) !== undefined) resolve(finish())
    })
    const timer = setTimeout(() => resolve(undefined), SESSION_WAIT_MS)
    ctx.workspaces.startSession()
  })
}

/** ChatPanel inject 面：纯回调，会话在调用时刻解析（注入面缓存不产生陈旧会话）。 */
function makeChatOps(ctx: ClientContext, boundSessionId: string | undefined): ChatOps {
  return {
    async send(text, mode = 'queue', files) {
      let face = sessionFaceOf(ctx, boundSessionId)
      if (face === undefined) {
        const id = await waitForSession(ctx)
        face = id !== undefined ? ctx.sessions.binding(id)?.session : undefined
      }
      if (face === undefined) return false
      const parts: PromptPart[] = []
      for (const file of files ?? []) {
        if (!file.type.startsWith('image/')) continue
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        const chunk = 0x8000
        for (let offset = 0; offset < bytes.length; offset += chunk) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
        }
        parts.push({
          type: 'image',
          mediaType: file.type,
          data: btoa(binary),
          ...(file.name === '' ? {} : { name: file.name }),
        })
      }
      parts.push({ type: 'text', text })
      const result = await face.prompt(parts, mode)
      return result.ok
    },
    cancel() {
      void sessionFaceOf(ctx, boundSessionId)?.cancel()
    },
    newSession() {
      ctx.workspaces.startSession()
    },
    async command(line) {
      const face = sessionFaceOf(ctx, boundSessionId)
      if (face === undefined) return false
      const result = await face.command(line)
      return result.ok
    },
    loadModelDirectory() {
      return loadModelsOf(ctx, boundSessionId)
    },
    async selectModel(model) {
      const directory = await loadModelsOf(ctx, boundSessionId)
      if (directory === null) return false
      const selection = findModelSelection(directory, model)
      if (selection === null) return false
      const sessionId = boundSessionId ?? currentSessionId(ctx)
      if (sessionId === undefined) return false
      const connection = ctx.get?.('connection') as ConnectionHandleLike | undefined
      const select = connection?.api?.sessions?.selectModel
      if (select === undefined) return false
      try {
        const response = await select(
          {
            sessionId,
            provider: selection.provider,
            model: selection.model,
            ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
          },
          new AbortController().signal,
        )
        return response.result.ok
      } catch {
        return false
      }
    },
    async updateQueue(itemId, action) {
      const face = sessionFaceOf(ctx, boundSessionId)
      if (face?.updateQueue === undefined) return false
      const result = await face.updateQueue(itemId, action)
      return result.ok
    },
    permissionSelect() {
      return permissionSelectOf(ctx, boundSessionId)
    },
    subscribePermission(fn) {
      return permissionFaceOf(ctx, boundSessionId)?.subscribe(fn) ?? (() => {})
    },
  }
}

/** 连接层 unary RPC 的响应信封：{ result: ok/value | error }（dsh-host-apiproxy 结构）。 */
type RpcResponseLike<T> = Promise<{
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string } }
}>

/** DSH connection 服务的最小结构（skills / settings / sessions.models RPC）。 */
interface ConnectionHandleLike {
  api?: {
    skills?: {
      list(
        req: { sessionId: string },
        signal?: AbortSignal,
      ): RpcResponseLike<{ skills: readonly SkillEntryLike[] }>
    }
    settings?: {
      openDocument(
        req: Record<string, never>,
        signal?: AbortSignal,
      ): RpcResponseLike<{ opened: boolean }>
    }
    /** 模型目录与选择走连接层 RPC，而不是 /model 斜杠命令（ui-model-selection 被 overlay 禁用）。 */
    sessions?: {
      models(
        req: { sessionId: string },
        signal?: AbortSignal,
      ): RpcResponseLike<ModelDirectoryLike>
      selectModel(
        req: { sessionId: string; provider: string; model: string; reasoningEffort?: string },
        signal?: AbortSignal,
      ): RpcResponseLike<{ selected: { provider: string; model: string } }>
    }
  }
}

/** 从 connection 服务读取会话模型目录；服务不可用时返回 null。 */
async function loadModelsOf(ctx: ClientContext, boundSessionId: string | undefined): Promise<ModelDirectoryLike | null> {
  const sessionId = boundSessionId ?? currentSessionId(ctx)
  if (sessionId === undefined) return null
  const connection = ctx.get?.('connection') as ConnectionHandleLike | undefined
  const models = connection?.api?.sessions?.models
  if (models === undefined) return null
  try {
    const { result } = await models({ sessionId }, new AbortController().signal)
    if (!result.ok) return null
    return {
      current: result.value.current ?? null,
      groups: result.value.groups ?? [],
    }
  } catch {
    return null
  }
}

/** DSH remote 服务的最小结构（pluginInventory / fileReferences RPC）。 */
interface RemoteLike {
  pluginInventory?: {
    list(): Promise<{ ok: boolean; value?: { entries: readonly PluginEntryLike[] }; error?: unknown }>
  }
  /** 主机文件索引（dsh-file-reference remote 面）；profile 未装配时缺省。 */
  fileReferences?: {
    list(
      agentId: string,
      query: string,
      signal?: AbortSignal,
    ): Promise<{ ok: boolean; value?: readonly FileReferenceCandidateLike[]; error?: unknown }>
  }
}

/** root inject 面：会话切换/新建/打开路径回调（TerminalRoot → TopBar 会话下拉）。 */
function makeRootOps(ctx: ClientContext): RootOps {
  return {
    openSession(id) {
      ctx.sessions.open(id)
    },
    newSession() {
      ctx.workspaces.startSession()
    },
    openPath(path) {
      return ctx.workspaces.openPath(path)
    },
    async command(line) {
      const id = currentSessionId(ctx)
      const face = id !== undefined ? ctx.sessions.binding(id)?.session : undefined
      if (face === undefined) return false
      const result = await face.command(line)
      return result.ok
    },
    async listSkills() {
      const sessionId = currentSessionId(ctx)
      if (sessionId === undefined) return []
      const connection = ctx.get?.('connection') as ConnectionHandleLike | undefined
      const list = connection?.api?.skills?.list
      if (list === undefined) return []
      const response = await list({ sessionId })
      return response.result.ok ? response.result.value.skills : []
    },
    async listPlugins() {
      const remote = ctx.get?.('remote') as RemoteLike | undefined
      const list = remote?.pluginInventory?.list
      if (list === undefined) return []
      const result = await list()
      return result.ok ? (result.value?.entries ?? []) : []
    },
    async openSettingsDocument() {
      const connection = ctx.get?.('connection') as ConnectionHandleLike | undefined
      const open = connection?.api?.settings?.openDocument
      if (open === undefined) return false
      const response = await open({}, new AbortController().signal)
      return response.result.ok
    },
    async searchWorkspaceFiles(query, signal) {
      const sessionId = currentSessionId(ctx)
      if (sessionId === undefined) return null
      let remote: RemoteLike | undefined
      try {
        remote = ctx.get?.('remote') as RemoteLike | undefined
      } catch {
        return null
      }
      // remote 是 cordis 代理：未注册的命名空间 getter 可能抛错（如 profile 禁用了
      // ui-reference），所以 namespace 访问本身也要防御，而不是只判 undefined。
      let list: ((agentId: string, query: string, signal?: AbortSignal) => Promise<{ ok: boolean; value?: readonly FileReferenceCandidateLike[]; error?: unknown }>) | undefined
      try {
        list = remote?.fileReferences?.list
      } catch {
        return null
      }
      if (list === undefined) return null
      const result = await list(sessionId, query, signal)
      return result.ok ? (result.value ?? []) : null
    },
  }
}

/** 槽位冲突（热重载时旧 fiber 尚未释放 root / terminal.chat）的判定。 */
function isSlotOccupancyError(error: unknown): boolean {
  return error instanceof Error
    && (/already has a registration/.test(error.message) || /is already declared/.test(error.message))
}

/** 热重载冲突重试参数：旧 fiber 的 disposer 通常在下一次事件循环内落地。 */
const ROOT_RETRY_BASE_MS = 100
const ROOT_RETRY_MAX_MS = 1000
const ROOT_RETRY_ATTEMPTS = 12

/**
 * 注册 root + terminal.chat。'root' 是 single 槽，本插件固定 priority=-1
 * （lowest renders）遮蔽内置 ui-layout；热重载时新 fiber 可能在旧 fiber
 * disposer 生效前先跑 apply，同 priority 的第二次注册会抛
 * "already has a registration"。这里不每次换 priority（那样会遗留一串影子
 * 条目），而是退避重试到旧条目真正释放；注册成功后的根释放器同时撤掉
 * 子槽贡献。非冲突错误照常抛出，让 loader 审计可见。
 * @param ctx - client root context.
 * @returns 释放器：取消在途重试并释放已注册的 root/chat 条目。
 */
function registerTerminalRoot(ctx: ClientContext): () => void {
  let alive = true
  let dispose: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0

  const attempt = (): void => {
    if (!alive) return
    let disposeRoot: (() => void) | undefined
    try {
      disposeRoot = ctx.slots.register(
        {
          name: 'root',
          priority: -1,
          children: {
            'terminal.chat': { kind: 'single', scope: 'session-maybe' },
          },
          inject: () => makeRootOps(ctx),
        },
        TerminalRoot,
      )
      // 等待 root 条目声明 terminal.chat 后注册 ChatPanel（声明倒塌时自动移除）。
      const disposeChat = ctx.slots.inject(
        'terminal.chat',
        () =>
          ctx.slots.register(
            {
              name: 'terminal.chat',
              inject: (sessionId) => makeChatOps(ctx, sessionId),
            },
            ChatPanel,
          ),
      )
      let settled = false
      dispose = () => {
        if (settled) return
        settled = true
        disposeChat()
        disposeRoot?.()
      }
    } catch (error) {
      disposeRoot?.()
      if (!isSlotOccupancyError(error)) throw error
      attempts += 1
      if (attempts >= ROOT_RETRY_ATTEMPTS) {
        console.error('client-tonghuashun: root slot is still occupied after retries; keeping the existing terminal', error)
        return
      }
      const delay = Math.min(ROOT_RETRY_MAX_MS, ROOT_RETRY_BASE_MS * 2 ** (attempts - 1))
      timer = setTimeout(attempt, delay)
    }
  }

  attempt()
  return () => {
    alive = false
    if (timer !== undefined) clearTimeout(timer)
    dispose?.()
  }
}

/**
 * Registers the terminal into the runtime's 'root' slot and the chat panel
 * into the declared 'terminal.chat' child slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // 注入样式（幂等；loader 卸载本插件时会移除 data-plugin 标记的 style 标签）。
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'client-tonghuashun'
    tag.dataset.pluginCss = STYLE_TAG_ID
    tag.textContent = TERMINAL_CSS
    document.head.appendChild(tag)
  }

  ctx.effect(
    () => registerTerminalRoot(ctx),
    'client-tonghuashun: terminal root registration',
  )

  // 注册会话节点定义 + chat 视图构建器：ui-conversation 被 overlay 禁用后
  // 快照无人装配，本插件自供精简实现（见 conversation/nodes.ts）。
  ctx.effect(
    () => registerThsConversation(ctx as unknown as ConversationRegistriesLike),
    'client-tonghuashun: conversation definitions + chat view',
  )
}
