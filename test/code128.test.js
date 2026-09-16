import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PATTERNS, encodeValues, checksum, modules, code128Svg } from '../src/lib/code128.js'

test('pattern table: 107 unique symbols, 11 modules each, even bar count', () => {
  assert.equal(PATTERNS.length, 107)
  assert.equal(new Set(PATTERNS).size, 107)
  PATTERNS.forEach((p, i) => {
    const total = [...p].reduce((a, c) => a + Number(c), 0)
    assert.equal(total, i === 106 ? 13 : 11, `symbol ${i}`)
    const bars = Number(p[0]) + Number(p[2]) + Number(p[4]) + (p[6] ? Number(p[6]) : 0)
    assert.equal(bars % 2, 0, `symbol ${i} bars`)
  })
})

test('49 digits: set C for 24 pairs, then set B for the last digit', () => {
  const key = '2110201101179214673900110020010000000011234567813'
  const v = encodeValues(key)
  assert.equal(v[0], 105) // Start C
  assert.equal(v.length, 1 + 24 + 1 + 1)
  assert.equal(v[1], 21)
  assert.equal(v[25], 100) // Code B
  assert.equal(v[26], '3'.charCodeAt(0) - 32)
})

test('checksum follows the weighted sum mod 103', () => {
  // Start B, «A»(33): 104 + 33*1 = 137 → 137 % 103 = 34
  assert.equal(checksum([104, 33]), 34)
})

test('modules and svg are consistent', () => {
  const m = modules('12')
  // Start C + «12» + checksum + stop = 3*6 + 7 caracteres
  assert.equal(m.length, 25)
  const svg = code128Svg('12')
  assert.match(svg, /^<svg /)
  assert.throws(() => encodeValues('ñ'), { code: 'bad-code128-text' })
})
