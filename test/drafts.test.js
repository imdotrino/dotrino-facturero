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
