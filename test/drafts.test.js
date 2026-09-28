import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBlankDraft, toSaved } from '../src/lib/drafts.js'
import { FINAL_CONSUMER_KEY } from '../src/lib/buyers.js'

const emptyLine = { code: '', auxCode: '', description: '', unit: '', quantity: '1', unitPrice: '', discount: '', vatCode: '4' }
const blank = { issuerId: 'i1', buyerKey: FINAL_CONSUMER_KEY, lines: [emptyLine], payments: [{ method: '01' }], tip: '0' }

test('a fresh draft (final consumer, empty line) is blank; the issuer, quantity or VAT do not count', () => {
  assert.equal(isBlankDraft(blank), true)
  assert.equal(isBlankDraft(null), true)
  assert.equal(isBlankDraft({ ...blank, lines: [{ ...emptyLine, quantity: '3', vatCode: '0' }] }), true)
})

test('a chosen buyer or anything written in a line makes it worth saving', () => {
  assert.equal(isBlankDraft({ ...blank, buyerKey: 'k1' }), false)
  assert.equal(isBlankDraft({ ...blank, lines: [{ ...emptyLine, description: 'Corte' }] }), false)
  assert.equal(isBlankDraft({ ...blank, lines: [emptyLine, { ...emptyLine, unitPrice: '5' }] }), false)
  assert.equal(isBlankDraft({ ...blank, lines: [{ ...emptyLine, description: '   ' }] }), true)
})

test('what is saved drops the marker of the saved draft it came from', () => {
  assert.deepEqual(toSaved({ ...blank, savedKey: 'abc' }), blank)
})

test('copy as new: same issuer, lines and payment; the buyer by key, else by ID, else left to choose', async () => {
  const { draftFromInvoice } = await import('../src/lib/drafts.js')
  const lines = [{ code: 'A', auxCode: '', description: 'Corte', unit: '', quantity: '1', unitPrice: '8', discount: '', vatCode: '4' }]
  const juan = { key: 'k1', idType: '05', id: '1710034065', name: 'Juan' }
  const inv = (draft) => ({ issuerId: 'i1', number: '001-001-000000101', draft: { lines, payments: [{ method: '19' }], tip: '0', ...draft } })

  const byKey = draftFromInvoice(inv({ buyerKey: 'k1', buyer: { idType: '05', id: '1710034065' } }), [juan])
  assert.deepEqual(byKey, { issuerId: 'i1', buyerKey: 'k1', lines, payments: [{ method: '19' }], tip: '0' })
  assert.equal(draftFromInvoice(inv({ buyerKey: 'gone', buyer: { idType: '05', id: '1710034065' } }), [juan]).buyerKey, 'k1')
  assert.equal(draftFromInvoice(inv({ buyer: { idType: '05', id: '0000000000' } }), [juan]).buyerKey, '')
  assert.equal(draftFromInvoice(inv({ buyerKey: FINAL_CONSUMER_KEY, buyer: { idType: '07', id: '9999999999999' } }), []).buyerKey, FINAL_CONSUMER_KEY)
  assert.notEqual(byKey.lines, lines, 'a copy, not the same array')
})
