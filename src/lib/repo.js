// Qué guarda la app en el almacén del usuario y con qué forma.
//
//   facturero.settings            { id: 'issuer:<uuid>', … }      un emisor: RUC, serie, ambiente y
//                                                                   siguiente secuencial
//                                 { id: 'signature:<uuid>', … }   la firma electrónica DE ESE emisor,
//                                                                   SELLADA (mismo uuid)
//                                 { id: 'logo:<uuid>', logo }     el logo de ese emisor para su RIDE,
//                                                                   ya reducido (ver lib/logo.js)
//                                 { id: 'draft', draft }          la factura a medio escribir (el
//                                                                   formulario, autoguardado)
//   facturero.drafts              un borrador GUARDADO por entrada; id = uuid. El usuario lo
//                                 aparta para terminarlo luego (ver lib/drafts.js)
//   facturero.buyers              un comprador registrado por entrada; id = uuid. Son de
//                                 todos los emisores («consumidor final» no se guarda: es fijo)
//   facturero.products            un producto o servicio por entrada; id = uuid. También de
//                                 todos los emisores
//   facturero.invoices.aaaa-mm-dd una entrada por factura; id = clave de acceso
//
// Puede haber varios emisores (varios RUC, cada uno en pruebas o en producción), y cada uno
// lleva SU firma: se carga con el emisor y se va con él.
//
// Las facturas van en un hilo POR DÍA de emisión, las de todos los emisores juntas (cada
// una lleva su `issuerId` y una copia del emisor tal como estaba al emitirla). El almacén
// recorta cada hilo a un tope descartando lo más viejo sin avisar, y las facturas hay que
// conservarlas 7 años: un hilo por día deja ese tope muy lejos.
//
// Escribir con el mismo id actualiza la entrada (el almacén fusiona por id).

import { getStore } from '../services/store.js'
import { isBlankDraft, toSaved } from './drafts.js'

const SETTINGS = 'facturero.settings'
const INVOICES_PREFIX = 'facturero.invoices.'
const BUYERS = 'facturero.buyers'
const PRODUCTS = 'facturero.products'
const DRAFTS = 'facturero.drafts'
const ISSUER_PREFIX = 'issuer:'
const SIGNATURE_PREFIX = 'signature:'
const LOGO_PREFIX = 'logo:'

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

async function settings () {
  const store = await getStore()
  return store.listThread(SETTINGS)
}

async function writeSetting (id, value) {
  const store = await getStore()
  // JSON: lo que llega de Vue puede ser un Proxy reactivo, y postMessage no lo clona.
  const plain = JSON.parse(JSON.stringify(value))
  return store.appendMessage(SETTINGS, { ...plain, id, ts: Date.now() })
}

async function removeSetting (id) {
  const store = await getStore()
  return store.removeMessage(SETTINGS, id)
}

// ---------- emisores ----------

const toIssuer = ({ id, ts, ...rest }) => ({ ...rest, id: id.slice(ISSUER_PREFIX.length) })

export async function listIssuers () {
  return (await settings()).filter((e) => e.id.startsWith(ISSUER_PREFIX)).map(toIssuer)
}

export async function getIssuer (issuerId) {
  const e = (await settings()).find((x) => x.id === ISSUER_PREFIX + issuerId)
  if (!e) throw codeError('issuer-not-found', `there is no issuer ${issuerId}`)
  return toIssuer(e)
}

/** Guarda un emisor. Sin `id` es uno nuevo. Devuelve el emisor con su id. */
export async function saveIssuer (issuer) {
  const { id, ...data } = issuer
  const issuerId = id || crypto.randomUUID()
  await writeSetting(ISSUER_PREFIX + issuerId, data)
  return { ...data, id: issuerId }
}

/** Quita el emisor, su firma y su logo. Las facturas ya emitidas se quedan (llevan su copia). */
export async function removeIssuer (issuerId) {
  await removeSetting(LOGO_PREFIX + issuerId)
  await removeSetting(SIGNATURE_PREFIX + issuerId)
  return removeSetting(ISSUER_PREFIX + issuerId)
}

// ---------- la firma de cada emisor ----------

/** Registros de firma, cada uno con el `issuerId` al que pertenece. */
export async function listSignatureRecords () {
  return (await settings())
    .filter((e) => e.id.startsWith(SIGNATURE_PREFIX))
    .map((e) => ({ ...e, issuerId: e.id.slice(SIGNATURE_PREFIX.length) }))
}

export async function getSignatureRecord (issuerId) {
  const e = (await settings()).find((x) => x.id === SIGNATURE_PREFIX + issuerId)
  if (!e) throw codeError('no-signature', `the issuer ${issuerId} has no signature`)
  return e
}

export function saveSignatureRecord (issuerId, { envelope, seal, info, fileName }) {
  return writeSetting(SIGNATURE_PREFIX + issuerId, { envelope, seal, info, fileName })
}

// ---------- el logo de cada emisor ----------

// Aparte del emisor y no dentro: el emisor se reescribe en cada factura (sube el secuencial),
// y el logo no tiene por qué viajar otra vez a la bóveda cada vez.
export async function listLogos () {
  return (await settings())
    .filter((e) => e.id.startsWith(LOGO_PREFIX))
    .map((e) => ({ ...e.logo, issuerId: e.id.slice(LOGO_PREFIX.length) }))
}

export function saveLogo (issuerId, { dataUrl, width, height }) {
  return writeSetting(LOGO_PREFIX + issuerId, { logo: { dataUrl, width, height } })
}

export function removeLogo (issuerId) {
  return removeSetting(LOGO_PREFIX + issuerId)
}

// ---------- compradores ----------

// El comprador va ANIDADO en la entrada: su `id` es el número de identificación, y el `id`
// de la entrada es la clave del almacén. Juntos, uno pisaba al otro.
export async function listBuyers () {
  const store = await getStore()
  return (await store.listThread(BUYERS)).map((e) => ({ ...e.buyer, key: e.id }))
}

/** Guarda un comprador. Sin `key` es uno nuevo. Devuelve el comprador con su clave. */
export async function saveBuyer (buyer) {
  const { key, ...data } = JSON.parse(JSON.stringify(buyer))
  const entryId = key || crypto.randomUUID()
  const store = await getStore()
  await store.appendMessage(BUYERS, { id: entryId, ts: Date.now(), buyer: data })
  return { ...data, key: entryId }
}

export async function removeBuyer (key) {
  const store = await getStore()
  return store.removeMessage(BUYERS, key)
}

// ---------- productos ----------

// Anidado por la misma razón que el comprador: el `id` de la entrada es del almacén.
export async function listProducts () {
  const store = await getStore()
  return (await store.listThread(PRODUCTS)).map((e) => ({ ...e.product, key: e.id }))
}

export async function saveProduct (product) {
  const { key, ...data } = JSON.parse(JSON.stringify(product))
  const entryId = key || crypto.randomUUID()
  const store = await getStore()
  await store.appendMessage(PRODUCTS, { id: entryId, ts: Date.now(), product: data })
  return { ...data, key: entryId }
}

/**
 * Guarda muchos de una vez (una sola escritura del almacén en vez de una por fila).
 * @param {'buyers'|'products'} kind
 */
export async function saveMany (kind, items) {
  const thread = kind === 'buyers' ? BUYERS : PRODUCTS
  const field = kind === 'buyers' ? 'buyer' : 'product'
  const now = Date.now()
  const entries = JSON.parse(JSON.stringify(items)).map(({ key, ...data }) => ({ id: key || crypto.randomUUID(), ts: now, [field]: data }))
  const store = await getStore()
  await store.importThreads({ [thread]: entries }, 'merge')
  return entries.length
}

export async function removeProduct (key) {
  const store = await getStore()
  return store.removeMessage(PRODUCTS, key)
}

// ---------- borrador ----------

// La última escritura del borrador. El formulario lo guarda al desmontarse sin esperar, y
// leerlo justo después (p. ej. «Continuar» un guardado) podía adelantarse a esa escritura y
// perder lo último que se escribió. Leer espera a que termine; si falló, ya lo dijo quien
// la lanzó.
let draftWrite = Promise.resolve()

function trackDraftWrite (p) {
  draftWrite = p.catch(() => {})
  return p
}

/** Borrador de la factura a medio escribir: sobrevive a una recarga de la página. */
export async function loadDraft () {
  await draftWrite
  const e = (await settings()).find((x) => x.id === 'draft')
  return e ? e.draft : null
}

export function saveDraft (draft) {
  return trackDraftWrite(writeSetting('draft', { draft }))
}

export function clearDraft () {
  return trackDraftWrite(removeSetting('draft'))
}

// ---------- borradores guardados ----------

/** Los borradores guardados, el más reciente primero: `{ key, savedAt, draft }`. */
export async function listSavedDrafts () {
  const store = await getStore()
  return (await store.listThread(DRAFTS))
    .map((e) => ({ key: e.id, savedAt: e.savedAt, draft: e.draft }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

/** Guarda un borrador. Con `key` actualiza ese; sin él, es uno nuevo. Devuelve la clave. */
export async function saveSavedDraft (draft, key) {
  const entryId = key || crypto.randomUUID()
  const store = await getStore()
  const now = Date.now()
  await store.appendMessage(DRAFTS, { id: entryId, ts: now, savedAt: now, draft: toSaved(draft) })
  return entryId
}

export async function removeSavedDraft (key) {
  const store = await getStore()
  return store.removeMessage(DRAFTS, key)
}

/**
 * Pone un borrador en el formulario. Si en el formulario había otro con algo escrito, no se
 * pierde: se guarda antes en Borradores (en su sitio si venía de uno guardado).
 * `savedKey` dice de qué borrador guardado viene; sin él, es uno nuevo.
 */
export async function openInForm (draft, savedKey) {
  const current = await loadDraft()
  if (!isBlankDraft(current) && (!savedKey || current.savedKey !== savedKey)) await saveSavedDraft(current, current.savedKey)
  await saveDraft(savedKey ? { ...draft, savedKey } : draft)
}

export function resumeSavedDraft (saved) {
  return openInForm(saved.draft, saved.key)
}

// ---------- facturas ----------

export async function saveInvoice (invoice) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.day || '')) throw codeError('bad-invoice', `invoice without a valid day: ${invoice.day}`)
  const store = await getStore()
  const plain = JSON.parse(JSON.stringify(invoice))
  return store.appendMessage(INVOICES_PREFIX + invoice.day, { ...plain, id: invoice.accessKey, ts: Date.now() })
}

/** Facturas de un mes ('aaaa-mm') de todos los emisores, la más reciente primero. */
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

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
