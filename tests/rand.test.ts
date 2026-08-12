import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, seedFromString, jitter } from '../client-plugin/src/lib/rand'

test('mulberry32 同种子序列确定', () => {
  const a = mulberry32(20260809)
  const b = mulberry32(20260809)
  const seqA = Array.from({ length: 8 }, () => a())
  const seqB = Array.from({ length: 8 }, () => b())
  assert.deepEqual(seqA, seqB)
})

test('mulberry32 输出落在 [0,1)', () => {
  const r = mulberry32(42)
  for (let i = 0; i < 1000; i++) {
    const v = r()
    assert.ok(v >= 0 && v < 1)
  }
})

test('seedFromString 稳定且区分大小写', () => {
  const a = seedFromString('DSH001')
  const b = seedFromString('DSH001')
  assert.equal(a, b)
  assert.notEqual(a, seedFromString('dsh001'))
  assert.notEqual(seedFromString('a'), seedFromString('b'))
})

test('jitter 范围不超过 scale', () => {
  const r = mulberry32(7)
  for (let i = 0; i < 1000; i++) {
    const v = jitter(r, 3)
    assert.ok(v >= -3 && v <= 3)
  }
})
