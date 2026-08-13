import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lastModelOf,
  nodesToMessages,
  nodesToSteps,
  partialStepOf,
  partialTextOf,
  tagForTool,
  textOfBlocks,
  textOfContent,
  timeOf,
  truncate,
} from '../client-plugin/src/lib/session-map'
import type { ConversationNodeLike, ConversationSnapshotLike } from '../client-plugin/src/contract'

test('truncate 截断并追加省略号', () => {
  assert.equal(truncate('hello', 10), 'hello')
  assert.equal(truncate('hello world', 5), 'hello…')
})

test('timeOf epoch ms -> HH:MM:SS', () => {
  const d = new Date(2026, 7, 12, 9, 5, 7)
  assert.equal(timeOf(d.getTime()), '09:05:07')
})

test('tagForTool 映射已知工具，未知归 think', () => {
  assert.equal(tagForTool('read'), 'read')
  assert.equal(tagForTool('grep'), 'read')
  assert.equal(tagForTool('web_search'), 'read')
  assert.equal(tagForTool('pwsh'), 'bash')
  assert.equal(tagForTool('run_code'), 'bash')
  assert.equal(tagForTool('edit'), 'edit')
  assert.equal(tagForTool('write'), 'edit')
  assert.equal(tagForTool('skill'), 'skill')
  assert.equal(tagForTool('mystery-tool'), 'think')
})

test('textOfContent 只取文本块', () => {
  assert.equal(
    textOfContent([
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'b' },
    ]),
    'a\nb',
  )
})

test('textOfBlocks / reasoningOfBlocks 分离助手输出', () => {
  const blocks = [
    { kind: 'reasoning', text: 'thinking...' },
    { kind: 'text', text: 'answer' },
    { kind: 'tool-call', name: 'read' },
  ]
  assert.equal(textOfBlocks(blocks), 'answer')
  assert.equal(textOfBlocks(blocks.map((b) => ({ ...b, text: undefined }))), '')
})

test('nodesToMessages 折叠用户/助手/steering/错误', () => {
  const nodes: ConversationNodeLike[] = [
    { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: '帮我看看' }] },
    { kind: 'assistant', seq: 2, time: 1, blocks: [{ kind: 'text', text: '好的' }] },
    { kind: 'steering', seq: 3, time: 2, content: [{ type: 'text', text: '顺便改一下' }] },
    { kind: 'turn-error', seq: 4, time: 3, message: 'boom' },
  ]
  const msgs = nodesToMessages(nodes)
  assert.equal(msgs.length, 4)
  assert.deepEqual(
    msgs.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  )
  assert.match(msgs[2].text, /补充/)
  assert.match(msgs[3].text, /回合失败：boom/)
})

test('nodesToSteps 按类型映射轨迹行', () => {
  const nodes: ConversationNodeLike[] = [
    { kind: 'assistant', seq: 1, time: 1000, blocks: [{ kind: 'reasoning', text: '先读代码' }] },
    { kind: 'tool-result', seq: 2, time: 2000, callId: 'c1', call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' }, content: [{ type: 'text', text: 'ok' }], isError: false },
    { kind: 'tool-result', seq: 3, time: 3000, callId: 'c2', call: { name: 'run_code', argsRaw: '' }, content: [{ type: 'text', text: 'done' }], isError: false },
    { kind: 'tool-result', seq: 4, time: 4000, callId: 'c3', call: { name: 'edit', argsRaw: '' }, content: [{ type: 'text', text: 'diff' }], isError: false },
    { kind: 'tool-result', seq: 5, time: 5000, callId: 'c4', call: { name: 'skill', argsRaw: '' }, content: [], isError: false },
    { kind: 'command', seq: 6, time: 6000, name: 'status', args: '', outcome: { kind: 'success', text: 'ok' } },
    { kind: 'context', seq: 7, time: 7000, content: [{ type: 'text', text: 'ctx' }] },
    { kind: 'compaction', seq: 8, time: 8000, summary: '摘要' },
  ]
  const steps = nodesToSteps(nodes)
  const tags = steps.map((s) => s.tag)
  // 六个事件行 + context/compaction 两条中文叙述行
  assert.deepEqual(tags, ['think', 'read', 'bash', 'edit', 'skill', 'bash', 'think', 'think'])
  assert.equal(steps[6].zh !== undefined, true) // context
  assert.match(steps[7].zh ?? '', /历史压缩/)
  assert.equal(steps[1].detail, 'ok')
})

test('partialStepOf 只在有 partial reasoning 时产生流式行', () => {
  const base: ConversationSnapshotLike = {
    sessionId: 's1',
    nodes: [],
    partial: null,
    running: false,
    openState: 'open',
    promptError: null,
    removed: false,
    blank: false,
  }
  assert.equal(partialStepOf(base), null)
  assert.equal(partialTextOf(base), '')
  const withReasoning: ConversationSnapshotLike = {
    ...base,
    running: true,
    partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'streaming...' }, { kind: 'text', text: 'answer so far' }] },
  }
  assert.equal(partialTextOf(withReasoning), 'answer so far')
  assert.equal(partialStepOf(withReasoning)?.tag, 'think')
})

test('lastModelOf 取最近一条助手消息的模型', () => {
  const nodes: ConversationNodeLike[] = [
    { kind: 'assistant', seq: 1, time: 0, blocks: [], provenance: { provider: 'a', model: 'm1' } },
    { kind: 'assistant', seq: 2, time: 1, blocks: [], provenance: { provider: 'b', model: 'm2' } },
  ]
  const snap: ConversationSnapshotLike = {
    sessionId: 's',
    nodes,
    partial: null,
    running: false,
    openState: 'open',
    promptError: null,
    removed: false,
    blank: false,
  }
  assert.equal(lastModelOf(snap), 'm2')
})
