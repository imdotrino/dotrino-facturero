// Emitir, enviar y consultar una factura.
//
// Estados de una factura guardada:
//   signed      firmada, todavía sin respuesta de recepción (p. ej. sin conexión)
//   returned    DEVUELTA en recepción: se corrige y se reenvía con la misma clave
//   received    RECIBIDA, esperando autorización (el SRI tiene hasta 24 h)
//   authorized  AUTORIZADO: es la factura válida
//   rejected    NO AUTORIZADO: se corrige y se reenvía con la misma clave
//
// El secuencial se reserva ANTES de firmar: un fallo a medio camino deja un hueco en la
// numeración, nunca dos facturas con el mismo número.

import { buildAccessKey } from '../sri/accessKey.js'
import { buildInvoiceXml, toBase64Utf8 } from '../sri/xml.js'
import { signDocument } from '../sri/xades.js'
import { computeInvoice, validate } from '../sri/invoice.js'
import { receptionEnvelope, authorizationEnvelope, parseReception, parseAuthorization, callSri } from '../sri/soap.js'
import { loadIssuer, saveIssuer, saveInvoice } from './repo.js'
import { currentSigner } from './signature.js'
import { ecuadorToday } from './dates.js'
import { gzipText, gunzipText } from './bytes.js'

/** Esperas entre consultas de autorización tras una recepción, en ms. */
export const AUTHORIZATION_WAITS = [2500, 4000, 8000]

/** Mensajes de recepción que significan «ya lo tengo»: se pasa a consultar. */
const ALREADY_RECEIVED = new Set(['43', '70'])

export async function emitInvoice (draft, { onProgress = () => {} } = {}) {
  const issuer = await loadIssuer()
  const problems = validate(draft, issuer)
  if (problems.length) throw codeError('invalid-draft', 'the invoice has problems', { problems })
  const signer = currentSigner()
  if (!signer) throw codeError('signature-locked', 'the signature is locked')

  const { issueDate, day } = ecuadorToday()
  const seq = Number(issuer.nextSequential)
  await saveIssuer({ ...issuer, nextSequential: seq + 1 })
  const sequential = String(seq).padStart(9, '0')

  const accessKey = buildAccessKey({
    date: issueDate,
    docType: '01',
    ruc: issuer.ruc,
    environment: issuer.environment,
    establishment: issuer.establishment,
    emissionPoint: issuer.emissionPoint,
    sequential,
  })

  const invoice = {
    accessKey,
    day,
    issueDate,
    sequential,
    number: `${issuer.establishment}-${issuer.emissionPoint}-${sequential}`,
    environment: issuer.environment,
    createdAt: Date.now(),
    issuer,
    draft: JSON.parse(JSON.stringify(draft)),
    totals: computeInvoice(draft),
    status: 'signed',
    messages: [],
    history: [],
  }
  onProgress('signing')
  invoice.signedXmlGz = await gzipText(await signDocument(buildInvoiceXml({ issuer, draft, accessKey, sequential, issueDate }), signer))
  await saveInvoice(invoice)
  return submitInvoice(invoice, { onProgress })
}

/**
 * Corrige una factura DEVUELTA o NO AUTORIZADA: misma clave, mismo número y misma fecha
 * (ficha técnica §5.10), con los datos del comprador y las líneas nuevos.
 */
export async function correctInvoice (invoice, draft, { onProgress = () => {} } = {}) {
  if (!['returned', 'rejected', 'signed'].includes(invoice.status)) throw codeError('not-correctable', `an invoice in state ${invoice.status} cannot be corrected`)
  const issuer = await loadIssuer()
  for (const k of ['ruc', 'establishment', 'emissionPoint', 'environment']) {
    if (issuer[k] !== invoice.issuer[k]) throw codeError('issuer-changed', `the issuer ${k} changed since this invoice was numbered`)
  }
  const problems = validate(draft, { ...issuer, nextSequential: 1 })
  if (problems.length) throw codeError('invalid-draft', 'the invoice has problems', { problems })
  const signer = currentSigner()
  if (!signer) throw codeError('signature-locked', 'the signature is locked')

  onProgress('signing')
  const updated = {
    ...invoice,
    issuer,
    draft: JSON.parse(JSON.stringify(draft)),
    totals: computeInvoice(draft),
    signedXmlGz: await gzipText(await signDocument(buildInvoiceXml({
      issuer, draft, accessKey: invoice.accessKey, sequential: invoice.sequential, issueDate: invoice.issueDate,
    }), signer)),
    status: 'signed',
    messages: [],
  }
  await saveInvoice(updated)
  return submitInvoice(updated, { onProgress })
}

/** Envía a recepción y, si la recibe, consulta la autorización. */
export async function submitInvoice (invoice, { onProgress = () => {} } = {}) {
  onProgress('sending')
  const signedXml = await gunzipText(invoice.signedXmlGz)
  let reception
  try {
    reception = parseReception(await callSri(invoice.environment, 'RecepcionComprobantesOffline', receptionEnvelope(toBase64Utf8(signedXml))))
  } catch (e) {
    return recordError(invoice, e)
  }
  const ids = reception.messages.map((m) => m.id)
  const received = reception.state === 'RECIBIDA' || ids.some((id) => ALREADY_RECEIVED.has(id))
  const next = {
    ...invoice,
    status: received ? 'received' : 'returned',
    messages: reception.messages,
    lastError: null,
    history: [...(invoice.history || []), { at: Date.now(), step: 'reception', state: reception.state, messages: reception.messages }],
  }
  await saveInvoice(next)
  if (!received) return next
  return checkAuthorization(next, { waits: AUTHORIZATION_WAITS, onProgress })
}

/**
 * Consulta la autorización. Con `waits`, espera y reintenta mientras el SRI no la tenga;
 * si se acaban las esperas, la factura queda «received» para consultarla más tarde.
 */
export async function checkAuthorization (invoice, { waits = [0], onProgress = () => {} } = {}) {
  let current = invoice
  for (const wait of waits) {
    onProgress('authorizing')
    if (wait) await sleep(wait)
    let answer
    try {
      answer = parseAuthorization(await callSri(current.environment, 'AutorizacionComprobantesOffline', authorizationEnvelope(current.accessKey)))
    } catch (e) {
      return recordError(current, e)
    }
    const auth = pickAuthorization(answer.authorizations)
    if (!auth || auth.state === 'EN PROCESO') continue
    if (auth.state === 'AUTORIZADO') {
      // Sin número o sin comprobante no hay RIDE ni XML válidos que entregar: se para.
      if (!auth.number || !auth.document) return recordError(current, codeError('sri-bad-response', 'authorized without authorization number or document'))
      current = {
        ...current,
        status: 'authorized',
        messages: auth.messages,
        lastError: null,
        authorization: { number: auth.number, date: auth.date, environment: auth.environment },
        authorizedXmlGz: await gzipText(authorizedXml(auth)),
        history: [...(current.history || []), { at: Date.now(), step: 'authorization', state: auth.state, messages: auth.messages }],
      }
      await saveInvoice(current)
      return current
    }
    if (auth.state === 'NO AUTORIZADO') {
      current = {
        ...current,
        status: 'rejected',
        messages: auth.messages,
        lastError: null,
        history: [...(current.history || []), { at: Date.now(), step: 'authorization', state: auth.state, messages: auth.messages }],
      }
      await saveInvoice(current)
      return current
    }
    return recordError(current, codeError('sri-bad-response', `unexpected authorization state: ${auth.state}`))
  }
  current = { ...current, lastCheckAt: Date.now() }
  await saveInvoice(current)
  return current
}

/** Si hay varias (se corrigió y reenvió), vale la autorizada; si no, la más reciente. */
export function pickAuthorization (list) {
  if (!list.length) return null
  return list.find((a) => a.state === 'AUTORIZADO') ||
    [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
}

/** El XML que se conserva y se entrega al comprador: la autorización con el comprobante. */
export function authorizedXml (auth) {
  if (auth.document.includes(']]>')) throw codeError('sri-bad-response', 'the authorized document cannot be wrapped in CDATA')
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<autorizacion>' +
    `<estado>${esc(auth.state)}</estado>` +
    `<numeroAutorizacion>${esc(auth.number)}</numeroAutorizacion>` +
    `<fechaAutorizacion>${esc(auth.date)}</fechaAutorizacion>` +
    `<ambiente>${esc(auth.environment)}</ambiente>` +
    `<comprobante><![CDATA[${auth.document}]]></comprobante>` +
    '<mensajes/>' +
    '</autorizacion>'
}

async function recordError (invoice, e) {
  if (!e?.code || !/^sri-/.test(e.code)) throw e
  const next = { ...invoice, lastError: { code: e.code, message: e.message, at: Date.now() } }
  await saveInvoice(next)
  return next
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function codeError (code, message, extra) {
  const e = new Error(message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}
