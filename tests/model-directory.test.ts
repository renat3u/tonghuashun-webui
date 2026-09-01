import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findModelSelection, modelOptionIds } from '../client-plugin/src/lib/model-directory'
import type { ModelDirectoryLike } from '../client-plugin/src/contract'

const DIRECTORY: ModelDirectoryLike = {
  current: { provider: 'p1', model: 'm1' },
  groups: [
    {
      id: 'p1',
      name: 'Provider 1',
      models: [
        { id: 'm1', name: 'Model One', reasoning: { defaultEffort: 'high' } },
        { id: 'm2', name: 'Model Two' },
      ],
    },
    {
      id: 'p2',
      name: 'Provider 2',
      models: [{ id: 'm1', name: 'Other One' }],
    },
  ],
}

test('findModelSelection 支持 model id / 显示名 / provider+id', () => {
  assert.deepEqual(findModelSelection(DIRECTORY, 'm2'), { provider: 'p1', model: 'm2' })
  assert.deepEqual(findModelSelection(DIRECTORY, 'Model Two'), { provider: 'p1', model: 'm2' })
  assert.deepEqual(findModelSelection(DIRECTORY, 'p2/m1'), { provider: 'p2', model: 'm1' })
  // 同名时第一个分组优先；带默认 reasoning 时一并返回。
  assert.deepEqual(findModelSelection(DIRECTORY, 'm1'), { provider: 'p1', model: 'm1', reasoningEffort: 'high' })
  assert.equal(findModelSelection(DIRECTORY, 'missing'), null)
  assert.equal(findModelSelection(DIRECTORY, '  '), null)
})

test('modelOptionIds 目录可用时只列目录模型，缺失时才回退历史 id', () => {
  // 目录已加载：不混入 meter 快照里不可选择的历史模型 id。
  assert.deepEqual(modelOptionIds(DIRECTORY, ['m1', 'old-model']), ['m1', 'm2'])
  assert.deepEqual(modelOptionIds(null, ['a', 'a', 'b']), ['a', 'b'])
  assert.deepEqual(modelOptionIds({ current: null, groups: [] }), [])
})
