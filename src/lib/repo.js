// Qué guarda la app en el almacén del usuario y con qué forma.
//
//   facturero.settings            { id: 'issuer', … }       datos del emisor + siguiente secuencial
//                                 { id: 'signature', … }    la firma electrónica, SELLADA (signature.js)
//   facturero.invoices.aaaa-mm-dd una entrada por factura; id = clave de acceso
//
// Las facturas van en un hilo POR DÍA de emisión. El almacén recorta cada hilo a un tope
// (1000 por defecto, y el de la app que sincronice) descartando lo más viejo sin avisar,
// y las facturas hay que conservarlas 7 años: un hilo por día deja ese tope muy lejos.
//
// Escribir con el mismo id actualiza la entrada (el almacén fusiona por id).

import { getStore } from '../services/store.js'

const SETTINGS = 'facturero.settings'
const INVOICES_PREFIX = 'facturero.invoices.'

export const EMPTY_ISSUER = Object.freeze({
  ruc: '',
  legalName: '',
  tradeName: '',
  matrixAddress: '',
  establishmentAddress: '',
  establishment: '001',
  emissionPoint: '001',
  nextSequential: 1,
  keepsAccounting: false,
  specialTaxpayer: '',
  withholdingAgent: '',
  rimpe: '',
  environment: '1',
})

async function readSetting (id) {
  const store = await getStore()
  const entries = await store.listThread(SETTINGS)
  return entries.find((e) => e.id === id) || null
}

async function writeSetting (id, value) {
  const store = await getStore()
  // JSON: lo que llega de Vue puede ser un Proxy reactivo, y postMessage no lo clona.
  const plain = JSON.parse(JSON.stringify(value))
  return store.appendMessage(SETTINGS, { ...plain, id, ts: Date.now() })
}

export async function loadIssuer () {
  const e = await readSetting('issuer')
  if (!e) return null
  const { id, ts, ...issuer } = e
  return issuer
}

export function saveIssuer (issuer) {
  return writeSetting('issuer', issuer)
}

export function loadSignatureRecord () {
  return readSetting('signature')
}

export function saveSignatureRecord (record) {
  return writeSetting('signature', record)
}

export async function removeSignatureRecord () {
  const store = await getStore()
  return store.removeMessage(SETTINGS, 'signature')
}

/** Borrador de la factura a medio escribir: sobrevive a una recarga de la página. */
export async function loadDraft () {
  const e = await readSetting('draft')
  return e ? e.draft : null
}

export function saveDraft (draft) {
  return writeSetting('draft', { draft })
}

export async function clearDraft () {
  const store = await getStore()
  return store.removeMessage(SETTINGS, 'draft')
}

export async function saveInvoice (invoice) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.day || '')) throw codeError('bad-invoice', `invoice without a valid day: ${invoice.day}`)
  const store = await getStore()
  const plain = JSON.parse(JSON.stringify(invoice))
  return store.appendMessage(INVOICES_PREFIX + invoice.day, { ...plain, id: invoice.accessKey, ts: Date.now() })
}

/** Facturas de un mes ('aaaa-mm'), la más reciente primero. */
export async function listInvoices (month) {
  const store = await getStore()
  const keys = (await store.listThreadKeys()).filter((k) => k.startsWith(INVOICES_PREFIX + month))
  const all = []
  for (const key of keys) all.push(...await store.listThread(key))
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getInvoice (day, accessKey) {
  const store = await getStore()
  const entries = await store.listThread(INVOICES_PREFIX + day)
  return entries.find((e) => e.id === accessKey) || null
}

/** Meses con facturas, el más reciente primero. */
export async function listMonths () {
  const store = await getStore()
  const months = new Set((await store.listThreadKeys())
    .filter((k) => k.startsWith(INVOICES_PREFIX))
    .map((k) => k.slice(INVOICES_PREFIX.length, INVOICES_PREFIX.length + 7)))
  return [...months].sort().reverse()
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
