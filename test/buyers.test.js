import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FINAL_CONSUMER, FINAL_CONSUMER_KEY, buyerProblems, resolveBuyer, searchBuyers, buyerSnapshot } from '../src/lib/buyers.js'
import { validate } from '../src/sri/invoice.js'
import { issuer, draft } from './fixtures/drafts.js'

const juan = { key: 'k1', idType: '05', id: '1710034065', name: 'Juan Pérez', email: 'juan@example.com', phone: '', address: '' }
const empresa = { key: 'k2', idType: '04', id: '1760013210001', name: 'Servicio de Rentas', email: 'sri@example.com', phone: '', address: 'Quito' }

test('final consumer carries the values of the SRI table 6', () => {
  assert.deepEqual(
    { idType: FINAL_CONSUMER.idType, id: FINAL_CONSUMER.id, name: FINAL_CONSUMER.name },
    { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' })
  assert.equal(resolveBuyer(FINAL_CONSUMER_KEY, []), FINAL_CONSUMER)
})

test('a registered buyer needs ID and name; email, phone and address are optional (an email that is given must look like one)', () => {
  assert.deepEqual(buyerProblems(juan, []), [])
  const codes = buyerProblems({ idType: '05', id: '1710034066', name: '', email: '' }, []).map((p) => `${p.path}:${p.code}`)
  assert.deepEqual(codes, ['buyer.id:bad-cedula', 'buyer.name:required'])
  assert.deepEqual(buyerProblems({ ...juan, key: undefined, id: '1710034073', email: '' }, [juan]), [])
  assert.deepEqual(buyerProblems({ ...juan, email: 'no-es-correo' }, []).map((p) => p.code), ['bad-email'])
  assert.deepEqual(buyerProblems({ ...empresa, id: '1760013210000' }, []).map((p) => p.code), ['bad-ruc'])
  assert.deepEqual(buyerProblems({ idType: '06', id: 'AB123456', name: 'Visitante', email: 'v@example.com' }, []), [])
})

test('final consumer cannot be registered, and the same ID cannot be registered twice', () => {
  assert.deepEqual(buyerProblems({ ...FINAL_CONSUMER, key: undefined, email: 'x@example.com' }, []).map((p) => p.code), ['required'])
  assert.deepEqual(buyerProblems({ ...juan, key: undefined }, [juan]).map((p) => p.code), ['duplicate-buyer'])
  // Editarse a sí mismo no choca.
  assert.deepEqual(buyerProblems(juan, [juan]), [])
})

test('search: final consumer first, then by name', () => {
  assert.deepEqual(searchBuyers([juan, empresa], '').map((b) => b.key), [FINAL_CONSUMER_KEY, 'k1', 'k2'])
  assert.deepEqual(searchBuyers([juan, empresa], 'rentas').map((b) => b.key), ['k2'])
  assert.deepEqual(searchBuyers([juan, empresa], '171003').map((b) => b.key), ['k1'])
  assert.deepEqual(searchBuyers([juan, empresa], 'consumidor').map((b) => b.key), [FINAL_CONSUMER_KEY])
  assert.equal(resolveBuyer('borrado', [juan]), null)
})

test('the invoice keeps a copy of the buyer, and the USD 50 limit still applies to final consumer', () => {
  const fc = { ...draft, buyerKey: FINAL_CONSUMER_KEY, buyer: buyerSnapshot(FINAL_CONSUMER) }
  assert.equal('key' in fc.buyer, false)
  assert.deepEqual(validate(fc, issuer), [])
  const big = structuredClone(fc)
  big.lines[0].unitPrice = '100'
  assert.deepEqual(validate(big, issuer), [{ path: 'buyer.idType', code: 'final-consumer-limit' }])
  const identified = { ...big, buyerKey: 'k1', buyer: buyerSnapshot(juan) }
  assert.deepEqual(validate(identified, issuer), [])
})
