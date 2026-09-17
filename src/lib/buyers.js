// Compradores registrados. Son de todos los emisores: un cliente no es de un RUC.
//
// «Consumidor final» no se registra: es fijo, no se edita ni se borra, y es el comprador
// por defecto de cada factura (ficha técnica §9.10: «Entre la lista de clientes se encuentra
// el "Consumidor final", para que por defecto se identifique en ventas a consumidores
// finales»). Sus valores son los de la tabla 6: tipo 07, 13 nueves, CONSUMIDOR FINAL.
//
// Lo que se pide al registrar un comprador: identificación y nombres o razón social. Correo,
// teléfono y dirección son opcionales. El correo NO es obligatorio (dueño, 2026-09-16): la
// tabla 13 de la ficha que lo marcaba así es la del registro de clientes del sistema gratuito
// del SRI, no una regla de la factura —el XSD lo trae como campo adicional opcional y el SRI
// autoriza sin él—, y facturero no manda correos. Si viene, se valida que tenga forma de correo;
// puede traer varios separados por comas.

import { cleanText, isCedula, isRuc, splitEmails, joinEmails, emailProblem } from '../sri/invoice.js'
import { FINAL_CONSUMER_ID, FINAL_CONSUMER_NAME } from '../sri/catalog.js'

export const FINAL_CONSUMER_KEY = 'final-consumer'

export const FINAL_CONSUMER = Object.freeze({
  key: FINAL_CONSUMER_KEY,
  idType: '07',
  id: FINAL_CONSUMER_ID,
  name: FINAL_CONSUMER_NAME,
  email: '',
  phone: '',
  address: '',
})

export const EMPTY_BUYER = Object.freeze({ idType: '05', id: '', name: '', email: '', phone: '', address: '' })

/** Los tipos que se pueden registrar: todos menos consumidor final, que es fijo. */
export const REGISTRABLE_ID_TYPES = Object.freeze(['05', '04', '06', '08'])

export function normalizeBuyer (b) {
  return {
    ...(b.key ? { key: b.key } : {}),
    idType: b.idType,
    id: cleanText(b.id),
    name: cleanText(b.name),
    email: tidyEmails(b.email),
    phone: cleanText(b.phone),
    address: cleanText(b.address),
  }
}

/** Varios correos bien escritos quedan como «a@b.com, c@d.com»; si alguno falla se deja tal cual, para señalarlo. */
function tidyEmails (text) {
  const { valid, invalid } = splitEmails(text)
  return invalid.length ? cleanText(text) : joinEmails(valid)
}

/** Lo que impide registrar un comprador. `[{ path, code }]`. */
export function buyerProblems (buyer, buyers = []) {
  const b = normalizeBuyer(buyer)
  const problems = []
  const add = (path, code) => problems.push({ path, code })
  if (!REGISTRABLE_ID_TYPES.includes(b.idType)) add('buyer.idType', 'required')
  if (b.idType === '05' && !isCedula(b.id)) add('buyer.id', 'bad-cedula')
  else if (b.idType === '04' && !isRuc(b.id)) add('buyer.id', 'bad-ruc')
  else if (!b.id) add('buyer.id', 'required')
  else if (b.id.length > 20) add('buyer.id', 'too-long')
  if (!b.name) add('buyer.name', 'required')
  else if (b.name.length > 300) add('buyer.name', 'too-long')
  if (emailProblem(b.email)) add('buyer.email', emailProblem(b.email))
  if (b.address.length > 300) add('buyer.address', 'too-long')
  if (b.id && buyers.some((o) => o.key !== b.key && o.idType === b.idType && o.id === b.id)) add('buyer.id', 'duplicate-buyer')
  return problems
}

/** El comprador de una clave, o null si ya no existe. */
export function resolveBuyer (key, buyers) {
  if (key === FINAL_CONSUMER_KEY) return FINAL_CONSUMER
  return buyers.find((b) => b.key === key) || null
}

/** Búsqueda por nombre, identificación o correo; consumidor final siempre primero. */
export function searchBuyers (buyers, query) {
  const q = cleanText(query).toLowerCase()
  const matches = buyers
    .filter((b) => !q || `${b.name} ${b.id} ${b.email}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
  const fc = !q || `${FINAL_CONSUMER.name} ${FINAL_CONSUMER.id} consumidor final`.toLowerCase().includes(q)
  return fc ? [FINAL_CONSUMER, ...matches] : matches
}

/** Los datos del comprador que se copian en la factura (sin la clave del registro). */
export function buyerSnapshot (buyer) {
  const { key, ...data } = buyer
  return { ...data }
}
