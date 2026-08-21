/**
 * 会话节点定义 + chat 视图构建器（终端插件自有的最小实现）。
 *
 * 0812 快照里 ConversationSnapshot.nodes/partial 由「会话节点定义」装配：
 * 运行时 ConversationNodeAssembler 把事件窗口喂给每个注册的 Definition
 * （match/start/update/buildViewNode），再交给目标视图构建器（replace/apply）
 * 产出快照；ui-conversation 被 overlay 禁用后没有任何定义注册，snapshot 退化为
 * 空。因此本插件自带一套精简定义（消息/助手流式/工具/命令/回合错误）与
 * chat 视图构建器，产出结构上与 ConversationNodeLike 一致的 nodes 和 partial。
 *
 * 纯函数、无 React；组件侧的映射见 ../lib/session-map.ts。
 */
import type { AssistantBlockLike, ContentBlockLike, ConversationNodeLike, PartialAssistantLike } from '../contract'

// ---------- 引擎面的结构镜像（真实面见 runtime contract/conversation.ts） ----------

/** 会话事件（结构子集；surfaceOp 标记位于事件信封顶层）。 */
export interface ThsSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: unknown
}

/** Definition 对单事件的接受结果。 */
export interface ThsMatchResult {
  id: string
  role: 'start' | 'update'
}

/** 被接受的一次匹配。 */
export interface ThsMatch {
  event: ThsSessionEvent
  role: 'start' | 'update'
  location: ThsLocation
}

/** 引擎持有的上下文（结构子集）。 */
export interface ThsNodeContext<State> {
  key: string
  kind: string
  id: string
  matches: readonly ThsMatch[]
  start: ThsMatch | undefined
  state: State | undefined
  current: ReadonlyMap<string, ThsViewNode | null>
}

/** 视图节点（结构子集；anchorSeq 为渲染排序位）。 */
export interface ThsViewNode {
  key: string
  kind: string
  id: string
  target: string
  anchorSeq: number
  location: ThsLocation | undefined
  visibility: 'visible' | 'hidden'
  data: unknown
}

/** 回合/步骤边界（结构子集）。 */
export interface ThsLocation {
  kind: 'session' | 'turn' | 'step' | 'unresolved'
  turn?: { turn: number; status: string; end?: { seq: number; time: number } }
  step?: { step: number; status: string; end?: { seq: number; time: number } }
}

/** 节点定义（结构子集）。 */
export interface ThsDefinition<State> {
  kind: string
  target?: string
  match(event: ThsSessionEvent): ThsMatchResult | null
  start(context: ThsNodeContext<State>, match: ThsMatch): State
  update(context: ThsNodeContext<State> & { state: State }, match: ThsMatch): State
  publication?(match: ThsMatch): 'none' | 'animation-frame' | 'immediate'
  buildViewNode?(context: ThsNodeContext<State>): ThsViewNode | null
}

/** 视图构建器（结构子集）。 */
export interface ThsViewBuilder {
  empty: unknown
  replace(input: { nodes: readonly ThsViewNode[]; timeline: unknown }): unknown
  apply(input: { upserts: readonly ThsViewNode[]; timeline: unknown }): unknown
}

/** 注册面（runtime conversationEvents / conversationViews 的结构子集）。 */
export interface ConversationRegistriesLike {
  conversationEvents: { register(definition: ThsDefinition<unknown>): () => void }
  conversationViews: { register(definition: { target: string; create(): ThsViewBuilder }): () => void }
}

/** 引擎持有的上下文键（与 runtime conversationContextKey 同构）。 */
export function contextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}

/** 取最近事件的边界（start 优先）。 */
function contextLocation(context: ThsNodeContext<unknown>): ThsLocation | undefined {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** 封闭边界（回合或步骤已结束）→ 中断合成 seq/time。 */
function closedBoundary(location: ThsLocation | undefined): { seq: number; time: number } | undefined {
  if (location === undefined) return undefined
  if (location.kind === 'step' && location.step?.status === 'closed' && location.step.end !== undefined) {
    return location.step.end
  }
  if ((location.kind === 'step' || location.kind === 'turn')
    && location.turn?.status === 'closed' && location.turn.end !== undefined) {
    return location.turn.end
  }
  return undefined
}

// ---------- 事件数据读取（带类型守卫的访问器） ----------

interface UserMessageData {
  id: unknown
  content: readonly ContentBlockLike[]
  source: { kind: string; plugin?: string }
}

function asUserMessage(event: ThsSessionEvent): UserMessageData | null {
  if (event.type !== 'user/message' || event.surfaceOp !== 'append') return null
  const data = event.data as unknown as UserMessageData
  if (data.source === undefined || typeof data.source !== 'object') return null
  // 压缩检查点（plugin 注入的替换消息）不进对话流
  if (data.source.kind === 'plugin' && data.source.plugin === 'compact') return null
  return data
}

interface AssistantChunkData { turn: number; step: number; chunk: Record<string, unknown> }
interface AssistantMessageData {
  turn: number
  step: number
  message: { id: unknown; content: readonly ContentBlockLike[] }
  usage: unknown
}

function asAssistantChunk(event: ThsSessionEvent): AssistantChunkData | null {
  if (event.type !== 'assistant/chunk') return null
  const data = event.data as unknown as AssistantChunkData
  if (typeof data.turn !== 'number' || typeof data.step !== 'number') return null
  return data
}

function asAssistantMessage(event: ThsSessionEvent): AssistantMessageData | null {
  if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') return null
  const data = event.data as unknown as AssistantMessageData
  if (typeof data.turn !== 'number' || typeof data.step !== 'number') return null
  return data
}

interface ToolCallData { callId: unknown; name: string; arguments: unknown; turn: number; step: number }
interface ToolResultData {
  message: { source: { callId: unknown }; content: readonly { content: unknown; isError?: boolean }[] }
  error?: unknown
  meta?: unknown
}

function asToolCall(event: ThsSessionEvent): ToolCallData | null {
  if (event.type !== 'tool/call') return null
  const data = event.data as unknown as ToolCallData
  if (typeof data.name !== 'string') return null
  return data
}

function asToolResult(event: ThsSessionEvent): ToolResultData | null {
  if (event.type !== 'tool/result') return null
  const data = event.data as unknown as ToolResultData
  if (data.message === undefined || data.message.source === undefined) return null
  return data
}

interface CommandRunData { commandId: unknown; name: string; args?: string }
interface CommandDoneData { commandId: unknown; kind: string; text?: string }

function asCommandRun(event: ThsSessionEvent): CommandRunData | null {
  if (event.type !== 'command/run') return null
  const data = event.data as unknown as CommandRunData
  if (data.commandId === undefined) return null
  return data
}

function asCommandDone(event: ThsSessionEvent): CommandDoneData | null {
  if (event.type !== 'command/done') return null
  const data = event.data as unknown as CommandDoneData
  if (data.commandId === undefined) return null
  return data
}

interface TurnEndData { turn: number; reason: { kind: string; error?: { code: string; message: string } } }

function asTurnEndError(event: ThsSessionEvent): TurnEndData | null {
  if (event.type !== 'turn/end') return null
  const data = event.data as unknown as TurnEndData
  if (typeof data.turn !== 'number') return null
  if (data.reason === undefined || data.reason.kind !== 'error') return null
  return data
}

// ---------- 内容块归一 ----------

/** 核心块 → UI 块分类（与 runtime toAssistantBlock 同构的子集）。 */
export function toAssistantBlock(block: ContentBlockLike): AssistantBlockLike {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text ?? '' }
    case 'reasoning': return { kind: 'reasoning', text: block.text ?? '' }
    case 'tool-call': {
      const args = block as ContentBlockLike & { id?: unknown; name?: string; arguments?: unknown }
      return {
        kind: 'tool-call',
        callId: args.id !== undefined ? String(args.id) : '',
        name: typeof args.name === 'string' ? args.name : '',
        argsRaw: typeof args.arguments === 'string' ? args.arguments : JSON.stringify(args.arguments ?? ''),
      }
    }
    default: return { kind: 'other' }
  }
}

/** 工具结果内容 → 文本块序列（字符串直接包成 text 块）。 */
export function resultBlocks(content: unknown): readonly ContentBlockLike[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content.filter((b) => b !== null && typeof b === 'object') as ContentBlockLike[]
  if (content !== null && typeof content === 'object' && 'type' in (content as object)) {
    return [content as ContentBlockLike]
  }
  return []
}

// ---------- Definition 1：用户消息 / 上下文注入 ----------

export interface ThsMessageState {
  kind: 'user' | 'context'
  seq: number
  time: number
  content: readonly ContentBlockLike[]
}

/** 用户消息（含 steer 期间入队）与上下文注入的 Definition。 */
export const messageDefinition: ThsDefinition<ThsMessageState> = {
  kind: 'ths-message',
  target: 'chat',
  match: (event) => {
    const data = asUserMessage(event)
    return data === null ? null : { id: String(data.id), role: 'start' }
  },
  start: (_context, match) => {
    const data = asUserMessage(match.event)
    if (data === null) throw new Error('ths-message start requires user/message')
    return {
      kind: data.source.kind === 'user' ? 'user' : 'context',
      seq: match.event.seq,
      time: match.event.time,
      content: data.content,
    }
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    const state = context.state ?? fallbackMessage(context)
    if (state === undefined) return null
    const node: ConversationNodeLike = {
      kind: state.kind,
      seq: state.seq,
      time: state.time,
      content: state.content,
    }
    return chatViewNode(context, state.kind, state.seq, node)
  },
}

function fallbackMessage(context: ThsNodeContext<ThsMessageState>): ThsMessageState | undefined {
  for (const match of context.matches) {
    const data = asUserMessage(match.event)
    if (data !== null) {
      return {
        kind: data.source.kind === 'user' ? 'user' : 'context',
        seq: match.event.seq,
        time: match.event.time,
        content: data.content,
      }
    }
  }
  return undefined
}

// ---------- Definition 2：助手流式 / 定稿 / 中断 ----------

export interface ThsAssistantState {
  turn: number
  step: number
  /** 槽位数组（undefined = 尚未开始）。 */
  blocks: readonly (AssistantBlockLike | undefined)[]
  firstVisibleSeq: number | undefined
  firstVisibleTime: number | undefined
  hidden: boolean
  final: ThsMatch | undefined
}

function initialState(turn: number, step: number): ThsAssistantState {
  return { turn, step, blocks: [], firstVisibleSeq: undefined, firstVisibleTime: undefined, hidden: false, final: undefined }
}

function hasVisibleContent(blocks: readonly AssistantBlockLike[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'tool-call') return false
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text !== undefined && block.text.trim() !== ''
    return true
  })
}

function updateChunk(state: ThsAssistantState, match: ThsMatch): ThsAssistantState {
  const data = asAssistantChunk(match.event)
  if (data === null) return state
  const chunk = data.chunk
  const blocks = [...state.blocks]
  switch (chunk.type) {
    case 'block-start':
      blocks[chunk.index as number] = { kind: String(chunk.blockType) }
      break
    case 'text-delta': {
      const previous = blocks[chunk.index as number]
      blocks[chunk.index as number] = { kind: 'text', text: (previous?.kind === 'text' ? previous.text : '') + String(chunk.text ?? '') }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index as number]
      blocks[chunk.index as number] = { kind: 'reasoning', text: (previous?.kind === 'reasoning' ? previous.text : '') + String(chunk.text ?? '') }
      break
    }
    case 'block-end': {
      const block = chunk.block as ContentBlockLike
      blocks[chunk.index as number] = toAssistantBlock(block)
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index as number]
      const base = previous?.kind === 'tool-call'
        ? previous
        : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
      blocks[chunk.index as number] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id ?? ''),
        name: typeof chunk.name === 'string' ? chunk.name : base.name,
        argsRaw: base.argsRaw + String(chunk.argumentsDelta ?? ''),
      }
      break
    }
    default:
      return state
  }
  const compact = blocks.filter((b): b is AssistantBlockLike => b !== undefined)
  const visible = hasVisibleContent(compact)
  return {
    ...state,
    blocks,
    hidden: visible ? false : state.hidden,
    ...visible && state.firstVisibleSeq === undefined
      ? { firstVisibleSeq: match.event.seq, firstVisibleTime: match.event.time }
      : {},
  }
}

/** 窗口截断时的状态重建。 */
function fallbackAssistant(context: ThsNodeContext<ThsAssistantState>): ThsAssistantState | undefined {
  let state: ThsAssistantState | undefined
  for (const match of context.matches) {
    const data = asAssistantChunk(match.event)
    if (data !== null) {
      state ??= initialState(data.turn, data.step)
      state = updateChunk(state, match)
      continue
    }
    const message = asAssistantMessage(match.event)
    if (message !== null) {
      state ??= initialState(message.turn, message.step)
      state = {
        ...state,
        blocks: message.message.content.map(toAssistantBlock),
        hidden: false,
        final: match,
      }
    }
  }
  return state
}

interface AssistantProjection {
  readonly anchorSeq: number
  readonly visible: boolean
  readonly settled: ConversationNodeLike | null
}

/** 投影：定稿 → 最终节点；运行中 → 部分节点（中断由封闭边界合成）。 */
function projectAssistant(context: ThsNodeContext<ThsAssistantState>): AssistantProjection | undefined {
  const state = context.state ?? fallbackAssistant(context)
  if (state === undefined) return undefined
  const final = state.final
  let settled: ConversationNodeLike | null = null
  let anchorSeq: number = state.firstVisibleSeq ?? context.matches[0]?.event.seq ?? 0
  if (final !== undefined) {
    const data = asAssistantMessage(final.event)
    if (data !== null) {
      settled = {
        kind: 'assistant',
        seq: final.event.seq,
        time: final.event.time,
        turn: data.turn,
        step: data.step,
        blocks: data.message.content.map(toAssistantBlock),
      }
      anchorSeq = final.event.seq
    }
  } else {
    const boundary = closedBoundary(contextLocation(context))
    if (boundary !== undefined && hasVisibleContent(compactOf(state))) {
      settled = {
        kind: 'assistant',
        seq: boundary.seq - 0.9,
        time: boundary.time,
        turn: state.turn,
        step: state.step,
        blocks: compactOf(state),
        interrupted: true,
      }
      anchorSeq = boundary.seq - 0.9
    }
  }
  const visible = settled !== null || hasVisibleContent(compactOf(state))
  return { anchorSeq, visible, settled }
}

function compactOf(state: ThsAssistantState): AssistantBlockLike[] {
  return state.blocks.filter((b): b is AssistantBlockLike => b !== undefined)
}

/** 助手流式/定稿/中断 Definition（step/start 开局，chunk 累积，message 定稿）。 */
export const assistantDefinition: ThsDefinition<ThsAssistantState> = {
  kind: 'ths-assistant',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') {
      const data = event.data as { turn?: unknown; step?: unknown }
      if (typeof data.turn !== 'number' || typeof data.step !== 'number') return null
      return { id: `${data.turn}:${data.step}`, role: 'start' }
    }
    if (event.type === 'assistant/chunk') {
      const data = asAssistantChunk(event)
      if (data === null) return null
      return { id: `${data.turn}:${data.step}`, role: 'update' }
    }
    if (event.type === 'assistant/message') {
      const data = asAssistantMessage(event)
      if (data === null) return null
      return { id: `${data.turn}:${data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('ths-assistant start requires step/start')
    const data = match.event.data as { turn: number; step: number }
    return initialState(data.turn, data.step)
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/chunk') return updateChunk(context.state, match)
    const message = asAssistantMessage(match.event)
    if (message !== null) {
      return {
        ...context.state,
        blocks: message.message.content.map(toAssistantBlock),
        hidden: false,
        final: match,
      }
    }
    return context.state
  },
  publication: (match) => {
    if (match.event.type !== 'assistant/chunk') return 'immediate'
    const type = (match.event.data.chunk as Record<string, unknown> | undefined)?.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildViewNode: (context) => {
    const projected = projectAssistant(context)
    if (projected === undefined) return null
    const state = context.state ?? fallbackAssistant(context)
    if (projected.settled === null && !projected.visible) {
      // 从未 materialize 过的隐藏上下文允许返回 null；已 materialize 则返回同键隐藏节点
      const current = context.current.get('chat')
      if (state?.hidden === true || current === undefined || current === null) return null
    }
    const settled = projected.settled !== null && projected.settled.kind === 'assistant' ? projected.settled : null
    const node: ConversationNodeLike = {
      kind: 'assistant',
      seq: settled?.seq ?? projected.anchorSeq,
      time: settled?.time ?? state?.firstVisibleTime ?? context.matches[0]?.event.time ?? 0,
      turn: settled?.turn ?? state?.turn ?? 0,
      step: settled?.step ?? state?.step ?? 0,
      blocks: settled !== null ? settled.blocks : compactOf(state ?? initialState(0, 0)),
      ...settled?.interrupted === true ? { interrupted: true as const } : {},
    }
    return chatViewNode(context, 'assistant', projected.anchorSeq, node, {
      visibility: projected.visible ? 'visible' : 'hidden',
      running: projected.settled === null,
    })
  },
}

// ---------- Definition 3：工具调用 ↔ 结果 ----------

export interface ThsToolState {
  call: { name: string; argsRaw: string } | null
  result: { seq: number; time: number; content: readonly ContentBlockLike[]; isError: boolean } | null
  anchorSeq: number
}

/** 工具生命周期 Definition（call 开局，result 定稿；截断窗口由 fallback 重建）。 */
export const toolDefinition: ThsDefinition<ThsToolState> = {
  kind: 'ths-tool',
  target: 'chat',
  match: (event) => {
    const call = asToolCall(event)
    if (call !== null) return { id: String(call.callId), role: 'start' }
    const result = asToolResult(event)
    if (result !== null) return { id: String(result.message.source.callId), role: 'update' }
    return null
  },
  start: (_context, match) => {
    const call = asToolCall(match.event)
    if (call === null) throw new Error('ths-tool start requires tool/call')
    return {
      call: { name: call.name, argsRaw: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? '') },
      result: null,
      anchorSeq: match.event.seq,
    }
  },
  update: (context, match) => {
    const result = asToolResult(match.event)
    if (result === null) return context.state
    const first = result.message.content[0]
    return {
      ...context.state,
      result: {
        seq: match.event.seq,
        time: match.event.time,
        content: first === undefined ? [] : resultBlocks(first.content),
        isError: first?.isError === true,
      },
      anchorSeq: match.event.seq,
    }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackTool(context)
    if (state === undefined || state.result === null) return null
    const node: ConversationNodeLike = {
      kind: 'tool-result',
      seq: state.result.seq,
      time: state.result.time,
      callId: context.id,
      call: state.call,
      content: state.result.content,
      isError: state.result.isError,
    }
    return chatViewNode(context, 'tool', state.anchorSeq, node)
  },
}

function fallbackTool(context: ThsNodeContext<ThsToolState>): ThsToolState | undefined {
  let state: ThsToolState | undefined
  for (const match of context.matches) {
    const call = asToolCall(match.event)
    if (call !== null) {
      state = {
        call: { name: call.name, argsRaw: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? '') },
        result: null,
        anchorSeq: match.event.seq,
      }
      continue
    }
    const result = asToolResult(match.event)
    if (result !== null && state !== undefined) {
      const first = result.message.content[0]
      state = {
        ...state,
        result: {
          seq: match.event.seq,
          time: match.event.time,
          content: first === undefined ? [] : resultBlocks(first.content),
          isError: first?.isError === true,
        },
        anchorSeq: match.event.seq,
      }
    }
  }
  return state
}

// ---------- Definition 4：斜杠命令 ----------

export interface ThsCommandState {
  node: ConversationNodeLike
  anchorSeq: number
}

/** 命令生命周期 Definition（run 开局，done 定稿）。 */
export const commandDefinition: ThsDefinition<ThsCommandState> = {
  kind: 'ths-command',
  target: 'chat',
  match: (event) => {
    const run = asCommandRun(event)
    if (run !== null) return { id: String(run.commandId), role: 'start' }
    const done = asCommandDone(event)
    if (done !== null) return { id: String(done.commandId), role: 'update' }
    return null
  },
  start: (_context, match) => {
    const run = asCommandRun(match.event)
    if (run === null) throw new Error('ths-command start requires command/run')
    const node: ConversationNodeLike = {
      kind: 'command',
      seq: match.event.seq,
      time: match.event.time,
      name: run.name,
      args: run.args ?? null,
      outcome: null,
    }
    return { node, anchorSeq: match.event.seq }
  },
  update: (context, match) => {
    const done = asCommandDone(match.event)
    if (done === null) return context.state
    const previous = context.state.node
    const node: ConversationNodeLike = previous.kind === 'command'
      ? {
          kind: 'command',
          seq: previous.seq,
          time: previous.time,
          name: previous.name,
          args: previous.args,
          outcome: {
            kind: done.kind,
            ...done.text === undefined ? {} : { text: done.text },
          },
        }
      : previous
    return { node, anchorSeq: context.state.anchorSeq }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackCommand(context)
    if (state === undefined) return null
    return chatViewNode(context, 'command', state.anchorSeq, state.node)
  },
}

function fallbackCommand(context: ThsNodeContext<ThsCommandState>): ThsCommandState | undefined {
  let state: ThsCommandState | undefined
  for (const match of context.matches) {
    const run = asCommandRun(match.event)
    if (run !== null) {
      state = {
        node: { kind: 'command', seq: match.event.seq, time: match.event.time, name: run.name, args: run.args ?? null, outcome: null },
        anchorSeq: match.event.seq,
      }
      continue
    }
    const done = asCommandDone(match.event)
    if (done !== null && state !== undefined && state.node.kind === 'command') {
      state = {
        ...state,
        node: {
          ...state.node,
          outcome: { kind: done.kind, ...done.text === undefined ? {} : { text: done.text } },
        },
      }
    }
  }
  return state
}

// ---------- Definition 5：回合错误 ----------

export interface ThsTurnErrorState {
  turn: number
  failure: { seq: number; time: number; message: string } | null
  anchorSeq: number
}

/** 回合失败 Definition（turn/start 开局，turn/end(error) 定稿）。 */
export const turnErrorDefinition: ThsDefinition<ThsTurnErrorState> = {
  kind: 'ths-turn-error',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') {
      const data = event.data as { turn?: unknown }
      return typeof data.turn === 'number' ? { id: String(data.turn), role: 'start' } : null
    }
    const end = asTurnEndError(event)
    return end === null ? null : { id: String(end.turn), role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('ths-turn-error start requires turn/start')
    return { turn: (match.event.data as { turn: number }).turn, failure: null, anchorSeq: match.event.seq }
  },
  update: (context, match) => {
    const end = asTurnEndError(match.event)
    if (end === null) return context.state
    const message = end.reason.error?.message ?? `turn ${end.turn} failed`
    return { ...context.state, failure: { seq: match.event.seq, time: match.event.time, message }, anchorSeq: match.event.seq }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackTurnError(context)
    if (state === undefined || state.failure === null) return null
    const node: ConversationNodeLike = {
      kind: 'turn-error',
      seq: state.failure.seq,
      time: state.failure.time,
      message: state.failure.message,
    }
    return chatViewNode(context, 'turn-error', state.anchorSeq, node)
  },
}

function fallbackTurnError(context: ThsNodeContext<ThsTurnErrorState>): ThsTurnErrorState | undefined {
  let state: ThsTurnErrorState | undefined
  for (const match of context.matches) {
    if (match.event.type === 'turn/start') {
      state = { turn: (match.event.data as { turn: number }).turn, failure: null, anchorSeq: match.event.seq }
      continue
    }
    const end = asTurnEndError(match.event)
    if (end !== null && state !== undefined) {
      state = {
        ...state,
        failure: { seq: match.event.seq, time: match.event.time, message: end.reason.error?.message ?? `turn ${end.turn} failed` },
        anchorSeq: match.event.seq,
      }
    }
  }
  return state
}

// ---------- Definition 6：压缩检查点 ----------

export interface ThsCompactionState {
  node: ConversationNodeLike
  anchorSeq: number
}

function compactionSummaryOf(event: ThsSessionEvent): string {
  const data = event.data as { summary?: unknown }
  if (typeof data.summary === 'string') return data.summary
  if (Array.isArray(data.summary)) {
    return data.summary
      .map((block) => {
        if (typeof block === 'string') return block
        if (block !== null && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .filter((text) => text.length > 0)
      .join('\n')
  }
  return ''
}

/** 压缩检查点 Definition（compaction/summary 定稿为一个 checkpoint 节点）。 */
export const compactionDefinition: ThsDefinition<ThsCompactionState> = {
  kind: 'ths-compaction',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'compaction/summary') return null
    const data = event.data as { compactionId?: unknown }
    const id = data.compactionId !== undefined ? String(data.compactionId) : `seq:${event.seq}`
    return { id, role: 'start' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'compaction/summary') throw new Error('ths-compaction start requires compaction/summary')
    const summary = compactionSummaryOf(match.event)
    return {
      node: {
        kind: 'compaction',
        seq: match.event.seq,
        time: match.event.time,
        summary: summary || '(压缩摘要)',
      },
      anchorSeq: match.event.seq,
    }
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    return chatViewNode(context, 'compaction', state.anchorSeq, state.node)
  },
}

// ---------- chat 视图构建器 ----------

/** 本插件 chat 视图节点的 data 载体（ConversationNodeLike + 流式标记）。 */
export interface ThsChatNodeData {
  node: ConversationNodeLike
  /** 尚未定稿的流式助手（供 legacy.partial）。 */
  running?: boolean
  turn?: number
  step?: number
}

/** 本插件 chat 视图快照（runtime 读取 order/nodes/legacy 三个面）。 */
export interface ThsChatSnapshot {
  order: readonly string[]
  nodes: {
    get(key: string): ThsViewNode | undefined
    values(): readonly ThsViewNode[]
  }
  legacy: {
    nodes: readonly ConversationNodeLike[]
    turnTimings: ReadonlyMap<number, unknown>
    turnEnds: ReadonlyMap<number, number>
    partial: PartialAssistantLike | null
    runningCalls: readonly never[]
  }
}

const EMPTY_NODES: readonly never[] = []

function emptySnapshot(): ThsChatSnapshot {
  return {
    order: EMPTY_NODES,
    nodes: { get: () => undefined, values: () => EMPTY_NODES },
    legacy: {
      nodes: EMPTY_NODES,
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: null,
      runningCalls: EMPTY_NODES,
    },
  }
}

/** 单节点对 legacy 的贡献。 */
interface LegacyContribution {
  readonly anchorSeq: number
  readonly node: ConversationNodeLike | null
  readonly partial: PartialAssistantLike | null
}

function legacyContribution(viewNode: ThsViewNode): LegacyContribution {
  const data = viewNode.data as ThsChatNodeData
  const node = data.node
  if (viewNode.visibility === 'hidden' && node.kind !== 'assistant') {
    return { anchorSeq: viewNode.anchorSeq, node: null, partial: null }
  }
  switch (node.kind) {
    case 'assistant':
      if (data.running === true) {
        // 隐藏的流式节点（尚无可见内容）不贡献 partial
        if (viewNode.visibility !== 'visible') {
          return { anchorSeq: viewNode.anchorSeq, node: null, partial: null }
        }
        return {
          anchorSeq: viewNode.anchorSeq,
          node: null,
          partial: { turn: data.turn ?? 0, step: data.step ?? 0, blocks: node.blocks },
        }
      }
      return { anchorSeq: viewNode.anchorSeq, node, partial: null }
    case 'tool-result':
    case 'user':
    case 'context':
    case 'command':
    case 'turn-error':
    case 'compaction':
      return { anchorSeq: viewNode.anchorSeq, node, partial: null }
    default:
      return { anchorSeq: viewNode.anchorSeq, node: null, partial: null }
  }
}

function chatViewNode(
  context: ThsNodeContext<unknown>,
  kind: string,
  anchorSeq: number,
  node: ConversationNodeLike,
  options: { visibility?: 'visible' | 'hidden'; running?: boolean } = {},
): ThsViewNode {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: contextLocation(context),
    visibility: options.visibility ?? 'visible',
    data: {
      node,
      ...options.running === true && node.kind === 'assistant'
        ? { running: true as const, turn: node.turn, step: node.step }
        : {},
    },
  }
}

/** 按 anchorSeq 排序的可见节点。 */
function orderedVisible(nodes: readonly ThsViewNode[]): ThsViewNode[] {
  return nodes
    .filter((node) => node.visibility === 'visible')
    .sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key))
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** chat 视图构建器：只维护 order / nodes 表 / legacy 三面。 */
export class ThsChatBuilder implements ThsViewBuilder {
  private byKey = new Map<string, ThsViewNode>()
  private order: readonly string[] = EMPTY_NODES
  private contributions = new Map<string, LegacyContribution>()
  private legacyNodes: readonly ConversationNodeLike[] = EMPTY_NODES
  private legacyPartial: PartialAssistantLike | null = null
  readonly empty: ThsChatSnapshot = emptySnapshot()

  private rebuild(input: { nodes: readonly ThsViewNode[] }): ThsChatSnapshot {
    this.byKey = new Map(input.nodes.map((node) => [node.key, node]))
    this.order = orderedVisible(input.nodes).map((node) => node.key)
    this.contributions = new Map(input.nodes.map((node) => [node.key, legacyContribution(node)]))
    this.rebuildLegacy()
    return this.snapshot()
  }

  private upsert(input: { upserts: readonly ThsViewNode[] }): ThsChatSnapshot {
    let changed = false
    for (const node of input.upserts) {
      if (this.byKey.get(node.key) === node) continue
      this.byKey.set(node.key, node)
      this.contributions.set(node.key, legacyContribution(node))
      changed = true
    }
    if (!changed) return this.snapshot()
    this.order = [...orderedVisible([...this.byKey.values()]).map((node) => node.key)]
    this.rebuildLegacy()
    return this.snapshot()
  }

  private rebuildLegacy(): void {
    const nodes = [...this.contributions.values()]
      .flatMap((contribution) => contribution.node === null ? [] : [contribution.node])
      .sort((left, right) => left.seq - right.seq)
    if (!sameReferences(this.legacyNodes, nodes)) this.legacyNodes = nodes
    const partials = [...this.contributions.values()]
      .filter((contribution) => contribution.partial !== null)
      .sort((left, right) => left.anchorSeq - right.anchorSeq)
    const partial = partials[partials.length - 1]?.partial ?? null
    if (this.legacyPartial?.blocks !== partial?.blocks) this.legacyPartial = partial
  }

  replace(input: { nodes: readonly ThsViewNode[]; timeline: unknown }): ThsChatSnapshot {
    return this.rebuild(input)
  }

  apply(input: { upserts: readonly ThsViewNode[]; timeline: unknown }): ThsChatSnapshot {
    return this.upsert(input)
  }

  snapshot(): ThsChatSnapshot {
    const order = this.order
    const byKey = this.byKey
    const nodes = this.legacyNodes
    const partial = this.legacyPartial
    return {
      order,
      nodes: {
        get: (key) => byKey.get(key),
        values: () => [...byKey.values()],
      },
      legacy: {
        nodes,
        turnTimings: new Map(),
        turnEnds: new Map(),
        partial,
        runningCalls: EMPTY_NODES,
      },
    }
  }
}

/** 全部定义（注册顺序即 engine 匹配顺序）。 */
export const THS_DEFINITIONS: readonly ThsDefinition<unknown>[] = [
  messageDefinition,
  assistantDefinition,
  toolDefinition,
  commandDefinition,
  turnErrorDefinition,
  compactionDefinition,
]

/**
 * 注册节点定义与 chat 视图构建器。
 * @param registries - runtime 的 conversationEvents / conversationViews 面。
 * @returns 全部释放器。
 */
export function registerThsConversation(registries: ConversationRegistriesLike): () => void {
  const disposers: (() => void)[] = []
  for (const definition of THS_DEFINITIONS) {
    disposers.push(registries.conversationEvents.register(definition as never))
  }
  disposers.push(registries.conversationViews.register({
    target: 'chat',
    create: () => new ThsChatBuilder(),
  }))
  return () => {
    for (const dispose of disposers) void dispose()
  }
}
