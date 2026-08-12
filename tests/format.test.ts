import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmt, fmtPct, fmtLoc, fmtToken, dirClass, fmtDateSlash, fmtTime } from '../client-plugin/src/lib/format'

test('fmt 千分位', () => {
  assert.equal(fmt(1234567), '1,234,567')
  assert.equal(fmt(0), '0')
  assert.equal(fmt(-8314), '-8,314')
})

test('fmtPct 带符号', () => {
  assert.equal(fmtPct(2.31), '+2.31%')
  assert.equal(fmtPct(-0.86), '-0.86%')
  assert.equal(fmtPct(0), '0.00%')
})

test('fmtLoc 万/亿缩写', () => {
  assert.equal(fmtLoc(10000), '1.00万')
  assert.equal(fmtLoc(-10000), '-1.00万')
  assert.equal(fmtLoc(220133000000), '2201.33亿')
  assert.equal(fmtLoc(8340), '8,340')
})

test('fmtToken Token 数量缩写', () => {
  assert.equal(fmtToken(4.13e9), '41.30亿')
  assert.equal(fmtToken(9.42e7), '9,420万')
  assert.equal(fmtToken(3.25e6), '325万')
  assert.equal(fmtToken(2.0448e12), '20,448.00亿')
  assert.equal(fmtToken(412), '412')
  assert.equal(fmtToken(-5.5e8), '-5.50亿')
})

test('dirClass 红涨绿跌', () => {
  assert.equal(dirClass(1), 'c-up')
  assert.equal(dirClass(-1), 'c-down')
  assert.equal(dirClass(0), 'c-flat')
})

test('日期与分时格式化', () => {
  assert.equal(fmtDateSlash(new Date(2026, 7, 7)), '2026/08/07')
  assert.equal(fmtTime(9.5), '09:30')
  assert.equal(fmtTime(15), '15:00')
})
