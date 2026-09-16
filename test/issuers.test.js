import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issuerName, sameSeries, issuerProblems, readyIssuers } from '../src/lib/issuers.js'
import { issuer as base } from './fixtures/drafts.js'

const firma = { fingerprint: 'huella-1', info: { holder: 'JUAN' } }
const pruebas = { ...base, id: 'a', environment: '1', signature: 'huella-1' }
const produccion = { ...base, id: 'b', environment: '2', signature: 'huella-1' }
const otroRuc = { ...base, id: 'c', ruc: '1710034065001', legalName: 'JUAN PEREZ', tradeName: '', environment: '1', signature: 'huella-1' }

test('the same RUC in test and production are two separate series', () => {
  assert.equal(sameSeries(pruebas, produccion), false)
  assert.equal(sameSeries(pruebas, { ...pruebas, id: 'x' }), true)
  assert.equal(sameSeries(pruebas, { ...pruebas, id: 'x', emissionPoint: '002' }), false)
  const issuers = [pruebas, produccion, otroRuc]
  assert.deepEqual(readyIssuers(issuers, [firma]).map((i) => i.id), ['a', 'b', 'c'])
})

test('a repeated series is a problem for the copy, not a silent second counter', () => {
  const copia = { ...pruebas, id: 'd' }
  const problems = issuerProblems(copia, { issuers: [pruebas, copia], signatures: [firma] })
  assert.deepEqual(problems, [{ path: 'issuer.establishment', code: 'duplicate-series' }])
  // Un emisor nuevo (sin id) también choca con la serie de uno guardado.
  const nuevo = { ...pruebas, id: undefined }
  assert.deepEqual(issuerProblems(nuevo, { issuers: [pruebas], signatures: [firma] }).map((p) => p.code), ['duplicate-series'])
})

test('without a signature, or with one that is no longer saved, the issuer cannot invoice', () => {
  const sinFirma = { ...pruebas, signature: '' }
  assert.deepEqual(issuerProblems(sinFirma, { issuers: [sinFirma], signatures: [firma] }), [{ path: 'issuer.signature', code: 'required' }])
  assert.deepEqual(issuerProblems(pruebas, { issuers: [pruebas], signatures: [] }), [{ path: 'issuer.signature', code: 'signature-missing' }])
  assert.deepEqual(readyIssuers([pruebas, sinFirma], [firma]).map((i) => i.id), ['a'])
})

test('the issuer data rules still apply', () => {
  const malo = { ...pruebas, ruc: '123', nextSequential: '0' }
  const codes = issuerProblems(malo, { issuers: [malo], signatures: [firma] }).map((p) => `${p.path}:${p.code}`).sort()
  assert.deepEqual(codes, ['issuer.nextSequential:bad-sequential', 'issuer.ruc:bad-ruc'])
})

test('issuer name: trade name, then legal name', () => {
  assert.equal(issuerName(pruebas), 'Mi Tienda & Café <Centro>')
  assert.equal(issuerName(otroRuc), 'JUAN PEREZ')
})
