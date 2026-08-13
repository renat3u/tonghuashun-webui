import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assistantDefinition,
  commandDefinition,
  messageDefinition,
  ThsChatBuilder,
  toolDefinition,
  turnErrorDefinition,
  type ThsSessionEvent,
  type ThsViewNode,
} from '../client-plugin/src/conversation/nodes'

function ev(type: string, seq: number, data: Record<string, unknown>, surfaceOp?: unknown): ThsSessionEvent {
  return { type, seq, time: seq * 1000, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) }
}

test('messageDefinition 只接受 append 用户消息，跳过压缩检查点', () => {
  assert.deepEqual(
    messageDefinition.match(ev('user/message', 1, { id: 'm1', content: [], source: { kind: 'user' } }, 'append')),
    { id: 'm1', role: 'start' },
  )
  assert.equal(messageDefinition.match(ev('user/message', 2, { id: 'm2', content: [], source: { kind: 'plugin', plugin: 'compact' } }, 'append')), null)
  assert.equal(messageDefinition.match(ev('user/message', 3, { id: 'm3', content: [], source: { kind: 'user' } })), null)
  assert.equal(messageDefinition.match(ev('assistant/chunk', 4, {})), null)
})

test('assistantDefinition 按 step 开局、chunk/message 更新', () => {
  assert.deepEqual(
    assistantDefinition.match(ev('step/start', 1, { turn: 1, step: 1 })),
    { id: '1:1', role: 'start' },
  )
  assert.deepEqual(
    assistantDefinition.match(ev('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } })),
    { id: '1:1', role: 'update' },
  )
  assert.deepEqual(
    assistantDefinition.match(ev('assistant/message', 3, { turn: 1, step: 1, message: { content: [] }, usage: {} }, 'append')),
    { id: '1:1', role: 'update' },
  )
  assert.equal(assistantDefinition.match(ev('turn/start', 0, { turn: 1 })), null)
})

test('toolDefinition / commandDefinition / turnErrorDefinition 匹配规则', () => {
  assert.deepEqual(
    toolDefinition.match(ev('tool/call', 1, { callId: 'c1', name: 'read', arguments: '{}', turn: 1, step: 1 })),
    { id: 'c1', role: 'start' },
  )
  assert.deepEqual(
    toolDefinition.match(ev('tool/result', 2, { message: { source: { callId: 'c1' }, content: [] } })),
    { id: 'c1', role: 'update' },
  )
  assert.deepEqual(
    commandDefinition.match(ev('command/run', 3, { commandId: 'cmd1', name: 'status' })),
    { id: 'cmd1', role: 'start' },
  )
  assert.deepEqual(
    commandDefinition.match(ev('command/done', 4, { commandId: 'cmd1', kind: 'success' })),
    { id: 'cmd1', role: 'update' },
  )
  assert.deepEqual(
    turnErrorDefinition.match(ev('turn/start', 5, { turn: 2 })),
    { id: '2', role: 'start' },
  )
  assert.deepEqual(
    turnErrorDefinition.match(ev('turn/end', 6, { turn: 2, reason: { kind: 'error', error: { code: 'X', message: 'boom' } } })),
    { id: '2', role: 'update' },
  )
  assert.equal(turnErrorDefinition.match(ev('turn/end', 7, { turn: 3, reason: { kind: 'completed' } })), null)
})

function viewNode(key: string, kind: string, anchorSeq: number, data: unknown, visibility: 'visible' | 'hidden' = 'visible'): ThsViewNode {
  return { key, kind, id: key, target: 'chat', anchorSeq, location: { kind: 'unresolved' }, visibility, data }
}

test('ThsChatBuilder: replace 折叠 nodes/partial/order', () => {
  const builder = new ThsChatBuilder()
  const user = viewNode('u', 'user', 10, { node: { kind: 'user', seq: 10, time: 0, content: [{ type: 'text', text: 'hi' }] } })
  const running = viewNode('a:run', 'assistant', 20, {
    node: { kind: 'assistant', seq: 20, time: 1000, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'thinking' }] },
    running: true,
    turn: 1,
    step: 1,
  })
  const final = viewNode('a:final', 'assistant', 30, {
    node: { kind: 'assistant', seq: 30, time: 2000, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'done' }] },
  })
  const tool = viewNode('t', 'tool', 25, {
    node: { kind: 'tool-result', seq: 25, time: 1500, callId: 'c1', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: 'ok' }], isError: false },
  })
  const hidden = viewNode('a:empty', 'assistant', 5, {
    node: { kind: 'assistant', seq: 5, time: 0, turn: 0, step: 0, blocks: [] },
    running: true,
    turn: 0,
    step: 0,
  }, 'hidden')

  const snap = builder.replace({ nodes: [hidden, user, running, tool, final], timeline: {} }) as ReturnType<ThsChatBuilder['snapshot']>

  // anchorSeq: user=10, running=20, tool=25, final=30；hidden 不出现在 order
  assert.deepEqual(snap.order, ['u', 'a:run', 't', 'a:final'])
  assert.deepEqual(
    snap.legacy.nodes.map((n) => n.kind),
    ['user', 'tool-result', 'assistant'],
  )
  assert.equal(snap.legacy.partial?.turn, 1)
  assert.deepEqual(snap.legacy.partial?.blocks, [{ kind: 'reasoning', text: 'thinking' }])
})

test('ThsChatBuilder: apply 增量替换 partial 与 nodes', () => {
  const builder = new ThsChatBuilder()
  const running = viewNode('a', 'assistant', 10, {
    node: { kind: 'assistant', seq: 10, time: 0, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'part' }] },
    running: true,
    turn: 1,
    step: 1,
  })
  builder.replace({ nodes: [running], timeline: {} })
  const final = viewNode('a', 'assistant', 11, {
    node: { kind: 'assistant', seq: 11, time: 100, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'final' }] },
  })
  const snap = builder.apply({ upserts: [final], timeline: {} }) as ReturnType<ThsChatBuilder['snapshot']>
  assert.equal(snap.legacy.partial, null)
  assert.deepEqual(snap.legacy.nodes.map((n) => n.kind), ['assistant'])
  const node = snap.legacy.nodes[0]
  assert.equal(node?.kind, 'assistant')
})
