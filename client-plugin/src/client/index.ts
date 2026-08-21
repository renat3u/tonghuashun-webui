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
import type { ChatOps, ClientContext, RootOps, SessionFaceLike } from '../contract.js'
import { registerThsConversation, type ConversationRegistriesLike } from '../conversation/nodes.js'
import { TERMINAL_CSS } from './styles.generated.js'
import { TerminalRoot } from './TerminalRoot.js'
import { ChatPanel } from '../components/ChatPanel.js'

const STYLE_TAG_ID = 'tonghuashun/global.css'

/** Services required by the terminal plugin (runtime-provided). */
export const inject = ['slots', 'sessions', 'workspaces', 'conversationEvents', 'conversationViews']

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
    async send(text, mode = 'queue') {
      let face = sessionFaceOf(ctx, boundSessionId)
      if (face === undefined) {
        const id = await waitForSession(ctx)
        face = id !== undefined ? ctx.sessions.binding(id)?.session : undefined
      }
      if (face === undefined) return false
      const result = await face.prompt([{ type: 'text', text }], mode)
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
    () =>
      ctx.slots.register(
        {
          name: 'root',
          children: {
            'terminal.chat': { kind: 'single', scope: 'session-maybe' },
          },
          inject: () => makeRootOps(ctx),
        },
        TerminalRoot,
      ),
    'client-tonghuashun: terminal root registration',
  )

  // 等待 root 条目声明 terminal.chat 后注册 ChatPanel（声明倒塌时自动移除）。
  ctx.slots.inject(
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

  // 注册会话节点定义 + chat 视图构建器：ui-conversation 被 overlay 禁用后
  // 快照无人装配，本插件自供精简实现（见 conversation/nodes.ts）。
  ctx.effect(
    () => registerThsConversation(ctx as unknown as ConversationRegistriesLike),
    'client-tonghuashun: conversation definitions + chat view',
  )
}
