/**
 * 真实 DSH 会话快照 -> 终端 UI 模型（对话气泡 / Trajectory 行）的纯映射。
 *
 * 无 React、无订阅：ChatPanel 用 useSession 座位取快照后，经这里把
 * ConversationNode 序列折叠成 ConvMessage[] / TrajStep[]。
 */
import type { ConvMessage, Segment, TagKind, TrajStep } from '../data/trajectory'
import type {
  AssistantBlockLike,
  AssistantMessageNodeLike,
  ConversationNodeLike,
  ConversationSnapshotLike,
} from '../contract'

/** 截断长文本（追加省略号）。 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\u2026` : text
}

/** epoch ms -> 'HH:MM:SS'。 */
export function timeOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 工具名 -> 轨迹标签映射（未知工具归入 think）。 */
const TOOL_TAG: Record<string, TagKind> = {
  read: 'read',
  glob: 'read',
  grep: 'read',
  web_search: 'read',
  bash: 'bash',
  pwsh: 'bash',
  run_code: 'bash',
  shell: 'bash',
  edit: 'edit',
  write: 'edit',
  todo_write: 'edit',
  skill: 'skill',
}

/** 由工具名取轨迹标签。 */
export function tagForTool(name: string): TagKind {
  return TOOL_TAG[name] ?? 'think'
}

/** 用户/工具结果的内容块 -> 纯文本（非文本块忽略）。 */
export function textOfContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === 'text' && b.text !== undefined)
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

/** 助手块的纯文本部分（气泡正文，不含 reasoning）。 */
export function textOfBlocks(blocks: readonly AssistantBlockLike[]): string {
  return blocks
    .filter((b) => b.kind === 'text' && b.text !== undefined)
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

/** 助手块的 reasoning 部分（轨迹 think 行）。 */
export function reasoningOfBlocks(blocks: readonly AssistantBlockLike[]): string {
  return blocks
    .filter((b) => b.kind === 'reasoning' && b.text !== undefined)
    .map((b) => b.text ?? '')
    .join('\n')
    .trim()
}

/** 流式中的部分文本（气泡与 think 行共用）。 */
export function partialTextOf(snapshot: ConversationSnapshotLike): string {
  return textOfBlocks(snapshot.partial?.blocks ?? [])
}

/** 流式中的部分 reasoning。 */
export function partialReasoningOf(snapshot: ConversationSnapshotLike): string {
  return reasoningOfBlocks(snapshot.partial?.blocks ?? [])
}

/** 最近一次助手消息的模型（welcome 横幅 Model 行）。 */
export function lastModelOf(snapshot: ConversationSnapshotLike): string | null {
  for (let i = snapshot.nodes.length - 1; i >= 0; i--) {
    const node = snapshot.nodes[i]
    if (node.kind === 'assistant' && node.provenance?.model) return node.provenance.model
  }
  return null
}

/**
 * 节点 -> 对话气泡（用户/助手/steering/错误）。
 *
 * 注：本插件自带的 conversation definitions（../conversation/nodes.ts）目前不产出
 * `steering` 节点——运行中被 admit 的用户补充在事件层仍是 `user/message`。这里的
 * steering 分支是对上游可能新增该节点类型的防御，不是死代码；等 DSH 明确 steer
 * 事件形态后再决定是否在 definition 侧区分。
 */
export function nodesToMessages(nodes: readonly ConversationNodeLike[]): ConvMessage[] {
  const out: ConvMessage[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'user': {
        const text = textOfContent(node.content)
        if (text) out.push({ id: node.seq, role: 'user', text })
        break
      }
      case 'steering': {
        const text = textOfContent(node.content)
        if (text) out.push({ id: node.seq, role: 'user', text: `\u3014补充\u3015${text}` })
        break
      }
      case 'assistant': {
        const text = textOfBlocks(node.blocks)
        const body = text || reasoningOfBlocks(node.blocks)
        if (body) {
          out.push({ id: node.seq, role: 'assistant', text: node.interrupted === true ? '\u3014已停止\u3015' + body : body })
        }
        break
      }
      case 'turn-error':
        out.push({ id: node.seq, role: 'assistant', text: `\u26a0 回合失败：${node.message}` })
        break
      default:
        break
    }
  }
  return out
}

/** 工具结果内容 -> 详情摘要（bash 输出 / 编辑 diff 等）。 */
function detailOf(content: readonly { type: string; text?: string }[]): string | undefined {
  const text = textOfContent(content)
  return text ? truncate(text, 600) : undefined
}

/** 工具调用行 body（工具名 + 参数摘要）。 */
function toolBody(name: string, argsRaw: string | null | undefined): Segment[] {
  const body: Segment[] = [{ kind: 'hl', text: name }]
  if (argsRaw) body.push({ kind: 'text', text: ` ${truncate(argsRaw, 120)}` })
  return body
}

/** 节点 -> 轨迹行（reasoning->think；工具->按名映射；命令->bash；其余中文叙述）。 */
export function nodesToSteps(nodes: readonly ConversationNodeLike[]): TrajStep[] {
  const out: TrajStep[] = []
  for (const node of nodes) {
    switch (node.kind) {
      case 'assistant': {
        const reasoning = reasoningOfBlocks(node.blocks)
        if (reasoning) {
          out.push({
            id: node.seq,
            time: timeOf(node.time),
            tag: 'think',
            body: [{ kind: 'text', text: truncate(reasoning, 200) }],
            detail: reasoning.length > 200 ? reasoning : undefined,
          })
        }
        break
      }
      case 'tool-result': {
        const name = node.call?.name ?? 'tool'
        out.push({
          id: node.seq,
          time: timeOf(node.time),
          tag: tagForTool(name),
          body: toolBody(name, node.call?.argsRaw),
          detail: node.isError
            ? truncate(`\u26a0 ${textOfContent(node.content)}`, 600)
            : detailOf(node.content),
        })
        break
      }
      case 'command':
        out.push({
          id: node.seq,
          time: timeOf(node.time),
          tag: 'bash',
          body: [{ kind: 'text', text: `/${node.name ?? 'command'}${node.args ?? ''}` }],
          detail: node.outcome?.text ? truncate(node.outcome.text, 600) : undefined,
        })
        break
      case 'turn-error':
        out.push({ id: node.seq, time: timeOf(node.time), tag: 'bash', body: [], zh: `\u26a0 回合失败：${node.message}` })
        break
      case 'context':
        out.push({
          id: node.seq,
          time: timeOf(node.time),
          tag: 'think',
          body: [],
          zh: `上下文注入：${truncate(textOfContent(node.content), 60)}`,
        })
        break
      case 'compaction':
        out.push({
          id: node.seq,
          time: timeOf(node.time),
          tag: 'think',
          body: [],
          zh: node.summary ? `历史压缩：${truncate(node.summary, 80)}` : '历史压缩检查点',
        })
        break
      case 'steering':
        out.push({
          id: node.seq,
          time: timeOf(node.time),
          tag: 'think',
          body: [],
          zh: `用户补充（steer）：${truncate(textOfContent(node.content), 80)}`,
        })
        break
      default:
        break
    }
  }
  return out
}

/** 会话快照 -> 流式 think 行（partial reasoning，id 用负值避开节点 seq）。 */
export function partialStepOf(snapshot: ConversationSnapshotLike): TrajStep | null {
  const reasoning = partialReasoningOf(snapshot)
  if (!reasoning) return null
  return {
    id: -1,
    time: timeOf(Date.now()),
    tag: 'think',
    body: [{ kind: 'text', text: truncate(reasoning, 200) }],
  }
}

/** 最近一条助手消息（含中断标记）。 */
export function lastAssistantOf(nodes: readonly ConversationNodeLike[]): AssistantMessageNodeLike | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (node.kind === 'assistant') return node
  }
  return null
}
