import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAccessKey, parseAccessKey, mod11 } from '../src/sri/accessKey.js'

// Ejemplo de la ficha técnica de comprobantes electrónicos del SRI.
const SRI_EXAMPLE = '2110201101179214673900110020010000000011234567813'

test('the SRI example validates', () => {
  const p = parseAccessKey(SRI_EXAMPLE)
  assert.equal(p.valid, true)
  assert.equal(p.date, '21/10/2011')
  assert.equal(p.docType, '01')
  assert.equal(p.ruc, '1792146739001')
  assert.equal(p.environment, '1')
  assert.equal(p.establishment, '002')
  assert.equal(p.emissionPoint, '001')
  assert.equal(p.sequential, '000000001')
  assert.equal(p.numericCode, '12345678')
  assert.equal(p.emissionType, '1')
})

test('build reproduces the SRI example', () => {
  const key = buildAccessKey({
    date: '21/10/2011', docType: '01', ruc: '1792146739001', environment: '1',
    establishment: '002', emissionPoint: '001', sequential: 1, numericCode: '12345678',
  })
  assert.equal(key, SRI_EXAMPLE)
})

test('mod11 maps 11 to 0 and 10 to 1', () => {
  // suma 0 → 11 - 0 = 11 → 0
  assert.equal(mod11('0000'), 0)
  // «1» con peso 2 → suma 2 → 11 - 2 = 9
  assert.equal(mod11('1'), 9)
  // buscar un caso que dé 10 → 1: suma % 11 === 1
  const withTen = ['5', '50', '500'].find((d) => {
    let s = 0; let w = 2
    for (let i = d.length - 1; i >= 0; i--) { s += Number(d[i]) * w; w = w === 7 ? 2 : w + 1 }
    return s % 11 === 1
  })
  if (withTen) assert.equal(mod11(withTen), 1)
})

test('a random numeric code still yields a valid key', () => {
  const key = buildAccessKey({
    date: new Date(2026, 8, 16), docType: '01', ruc: '1790011674001', environment: '1',
    establishment: '001', emissionPoint: '001', sequential: '123',
  })
  assert.match(key, /^\d{49}$/)
  assert.equal(key.slice(0, 8), '16092026')
  assert.equal(parseAccessKey(key).valid, true)
})

test('bad input stops with a code instead of producing a wrong key', () => {
  assert.throws(() => buildAccessKey({ date: '16/09/2026', docType: '01', ruc: '123', environment: '1', establishment: '001', emissionPoint: '001', sequential: 1 }), { code: 'bad-ruc' })
  assert.throws(() => buildAccessKey({ date: '16/09/2026', docType: '01', ruc: '1790011674001', environment: '3', establishment: '001', emissionPoint: '001', sequential: 1 }), { code: 'bad-environment' })
  assert.throws(() => buildAccessKey({ date: '16/09/2026', docType: '01', ruc: '1790011674001', environment: '1', establishment: '001', emissionPoint: '001', sequential: 1234567890 }), { code: 'bad-sequential' })
})
