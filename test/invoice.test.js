import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInvoice, validate, isCedula, isRuc } from '../src/sri/invoice.js'
import { parseDecimal, format, mul, percent } from '../src/sri/decimal.js'
import { buildInvoiceXml, XML_DECLARATION } from '../src/sri/xml.js'
import { buildAccessKey } from '../src/sri/accessKey.js'
import { issuer, draft } from './fixtures/drafts.js'
import { xsdValidate } from './helpers/xsd.js'

test('decimal arithmetic is exact and rounds half up', () => {
  assert.equal(format(parseDecimal('0.1') + parseDecimal('0.2'), 2), '0.30')
  assert.equal(format(mul(parseDecimal('3'), parseDecimal('0.1')), 2), '0.30')
  assert.equal(format(parseDecimal('2.005'), 2), '2.01')
  assert.equal(format(parseDecimal('2.004999'), 2), '2.00')
  assert.equal(format(percent(parseDecimal('0.10'), parseDecimal('15')), 2), '0.02') // 0.015 → 0.02
  assert.equal(format(parseDecimal('7,5'), 2), '7.50')
  assert.throws(() => parseDecimal('-1'), { code: 'bad-decimal' })
  assert.throws(() => parseDecimal('1.1234567'), { code: 'bad-decimal' })
  assert.throws(() => parseDecimal('abc'), { code: 'bad-decimal' })
})

test('totals are the sum of the lines', () => {
  const t = computeInvoice(draft)
  // 2 × 10 = 20.00 → IVA 3.00
  assert.deepEqual(t.lines[0].vat, { code: '4', rate: '15', base: '20.00', value: '3.00' })
  // 1 × 7.333333 = 7.33 − 0.33 = 7.00 al 0%
  assert.equal(t.lines[1].subtotal, '7.00')
  assert.equal(t.lines[1].vat.value, '0.00')
  // 3 × 0.1 = 0.30 → IVA 0.045 → 0.05
  assert.equal(t.lines[2].vat.value, '0.05')
  assert.deepEqual(t.taxes, [
    { code: '0', rate: '0', base: '7.00', value: '0.00' },
    { code: '4', rate: '15', base: '20.30', value: '3.05' },
  ])
  assert.equal(t.totalWithoutTaxes, '27.30')
  assert.equal(t.totalDiscount, '0.33')
  assert.equal(t.vatTotal, '3.05')
  assert.equal(t.total, '30.35')
})

test('validation reports what is missing instead of guessing', () => {
  assert.deepEqual(validate(draft, issuer), [])

  const bad = structuredClone(draft)
  bad.buyer = { idType: '05', id: '1710034066', name: '' }
  bad.lines[0].quantity = '0'
  bad.lines[1].unitPrice = 'diez'
  bad.payments = []
  const codes = validate(bad, { ...issuer, ruc: '123', establishment: '000' }).map((p) => `${p.path}:${p.code}`)
  assert.deepEqual(codes.sort(), [
    'buyer.id:bad-cedula',
    'buyer.name:required',
    'issuer.establishment:bad-series',
    'issuer.ruc:bad-ruc',
    'lines[0].quantity:must-be-positive',
    'lines[1].unitPrice:bad-number',
    'payments:required',
  ])
})

test('final consumer: fixed id and a USD 50 limit', () => {
  const fc = structuredClone(draft)
  fc.buyer = { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' }
  assert.deepEqual(validate(fc, issuer), [])
  fc.lines[0].unitPrice = '100'
  assert.deepEqual(validate(fc, issuer), [{ path: 'buyer.idType', code: 'final-consumer-limit' }])
})

test('a discount larger than the line is a problem, not an exception', () => {
  const d = structuredClone(draft)
  d.lines[0].discount = '25'
  assert.deepEqual(validate(d, issuer), [{ path: 'lines', code: 'discount-exceeds' }])
})

test('cedula and RUC checks', () => {
  assert.equal(isCedula('1710034065'), true)
  assert.equal(isCedula('1710034064'), false)
  assert.equal(isCedula('2610034065'), false) // provincia 26 no existe
  assert.equal(isRuc('1710034065001'), true)
  assert.equal(isRuc('1760013210001'), true) // entidad pública: sin módulo
  assert.equal(isRuc('1710034065000'), false)
})

test('the invoice XML validates against the official SRI schema', () => {
  const accessKey = buildAccessKey({ date: '16/09/2026', docType: '01', ruc: issuer.ruc, environment: '1', establishment: '001', emissionPoint: '001', sequential: 123, numericCode: '12345678' })
  const xml = buildInvoiceXml({ issuer, draft, accessKey, sequential: '000000123', issueDate: '16/09/2026' })
  assert.match(xml, /<nombreComercial>Mi Tienda &amp; Café &lt;Centro&gt;<\/nombreComercial>/)
  assert.match(xml, /<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE<\/contribuyenteRimpe>/)
  const r = xsdValidate(XML_DECLARATION + xml)
  assert.equal(r.ok, true, r.output)
})
