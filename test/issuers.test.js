import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issuerName, sameSeries, issuerProblems, issuerDataProblems, readyIssuers } from '../src/lib/issuers.js'
import { issuer as base } from './fixtures/drafts.js'

// Cada emisor lleva SU firma: la firma dice de qué emisor es.
const firmaDe = (issuerId) => ({ issuerId, info: { holder: 'JUAN' } })
const pruebas = { ...base, id: 'a', environment: '1' }
const produccion = { ...base, id: 'b', environment: '2' }
const otroRuc = { ...base, id: 'c', ruc: '1710034065001', legalName: 'JUAN PEREZ', tradeName: '', environment: '1' }
const firmas = [firmaDe('a'), firmaDe('b'), firmaDe('c')]

test('the same RUC in test and production are two separate series', () => {
  assert.equal(sameSeries(pruebas, produccion), false)
  assert.equal(sameSeries(pruebas, { ...pruebas, id: 'x' }), true)
  assert.equal(sameSeries(pruebas, { ...pruebas, id: 'x', emissionPoint: '002' }), false)
  const issuers = [pruebas, produccion, otroRuc]
  assert.deepEqual(readyIssuers(issuers, firmas).map((i) => i.id), ['a', 'b', 'c'])
})

test('a repeated series is a problem for the copy, not a silent second counter', () => {
  const copia = { ...pruebas, id: 'd' }
  const problems = issuerProblems(copia, { issuers: [pruebas, copia], signatures: [...firmas, firmaDe('d')] })
  assert.deepEqual(problems, [{ path: 'issuer.establishment', code: 'duplicate-series' }])
  // Un emisor nuevo (sin id) también choca con la serie de uno guardado.
  const nuevo = { ...pruebas, id: undefined }
  assert.deepEqual(issuerDataProblems(nuevo, [pruebas]).map((p) => p.code), ['duplicate-series'])
})

test('the signature is the issuer’s own: another issuer’s signature does not count', () => {
  assert.deepEqual(issuerProblems(pruebas, { issuers: [pruebas], signatures: [] }), [{ path: 'issuer.signature', code: 'required' }])
  assert.deepEqual(issuerProblems(pruebas, { issuers: [pruebas, produccion], signatures: [firmaDe('b')] }), [{ path: 'issuer.signature', code: 'required' }])
  assert.deepEqual(readyIssuers([pruebas, produccion], [firmaDe('b')]).map((i) => i.id), ['b'])
})

test('the issuer data rules still apply', () => {
  const malo = { ...pruebas, ruc: '123', nextSequential: '0' }
  const codes = issuerProblems(malo, { issuers: [malo], signatures: firmas }).map((p) => `${p.path}:${p.code}`).sort()
  assert.deepEqual(codes, ['issuer.nextSequential:bad-sequential', 'issuer.ruc:bad-ruc'])
})

test('issuer name: trade name, then legal name', () => {
  assert.equal(issuerName(pruebas), 'Mi Tienda & Café <Centro>')
  assert.equal(issuerName(otroRuc), 'JUAN PEREZ')
})
