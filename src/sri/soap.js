// Servicios web del SRI (esquema offline): recepción y autorización.
//
// Se llaman DIRECTAMENTE desde el navegador: la factura firmada va del aparato al SRI
// sin pasar por ningún servidor de Dotrino. Funciona porque el SRI contesta el POST con
// `Access-Control-Allow-Origin: *`, pero su cortafuegos rechaza la petición previa
// (OPTIONS) que el navegador haría con `Content-Type: text/xml` o con una cabecera
// `SOAPAction`. Por eso va como `text/plain` y sin cabeceras propias.
//
// Ese comportamiento NO está documentado por el SRI (comprobado el 2026-09-16). Si lo
// cambian, el envío falla con `sri-unreachable` y se dice en pantalla: no hay un camino
// alternativo escondido.

import { codeError, messageOf } from '../lib/errors.js'
/** @typedef {import('../types').SriMessage} SriMessage */

/** @type {Readonly<Record<string, string>>} */
export const ENDPOINTS = Object.freeze({
  1: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/',
  2: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/',
})

/** @param {string} xmlBase64 */
export function receptionEnvelope (xmlBase64) {
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">' +
    '<soapenv:Header/><soapenv:Body><ec:validarComprobante>' +
    `<xml>${xmlBase64}</xml>` +
    '</ec:validarComprobante></soapenv:Body></soapenv:Envelope>'
}

/** @param {string} accessKey */
export function authorizationEnvelope (accessKey) {
  if (!/^\d{49}$/.test(accessKey)) throw codeError('bad-access-key', `access key must be 49 digits, got «${accessKey}»`)
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">' +
    '<soapenv:Header/><soapenv:Body><ec:autorizacionComprobante>' +
    `<claveAccesoComprobante>${accessKey}</claveAccesoComprobante>` +
    '</ec:autorizacionComprobante></soapenv:Body></soapenv:Envelope>'
}

/**
 * @param {string} text  respuesta SOAP
 * @param {typeof DOMParser} Parser
 * @returns {{ state: 'RECIBIDA'|'DEVUELTA', messages: SriMessage[] }}
 */
export function parseReception (text, Parser = globalThis.DOMParser) {
  const doc = parseSoap(text, Parser)
  const answer = first(doc, 'RespuestaRecepcionComprobante')
  if (!answer) throw codeError('sri-bad-response', 'reception response without RespuestaRecepcionComprobante')
  const state = childText(answer, 'estado')
  if (state !== 'RECIBIDA' && state !== 'DEVUELTA') throw codeError('sri-bad-response', `unexpected reception state: ${state}`)
  const messages = []
  for (const c of children(child(answer, 'comprobantes'), 'comprobante')) {
    messages.push(...readMessages(c))
  }
  return { state, messages }
}

/**
 * @param {string} text  respuesta SOAP
 * @param {typeof DOMParser} [Parser]
 * @returns {{ found: number, authorizations: import('../types').Authorization[] }}
 */
export function parseAuthorization (text, Parser = globalThis.DOMParser) {
  const doc = parseSoap(text, Parser)
  const answer = first(doc, 'RespuestaAutorizacionComprobante')
  if (!answer) throw codeError('sri-bad-response', 'authorization response without RespuestaAutorizacionComprobante')
  const found = Number(childText(answer, 'numeroComprobantes') || '0')
  const authorizations = children(child(answer, 'autorizaciones'), 'autorizacion').map((a) => ({
    state: childText(a, 'estado'),
    number: childText(a, 'numeroAutorizacion'),
    date: childText(a, 'fechaAutorizacion'),
    environment: childText(a, 'ambiente'),
    document: childText(a, 'comprobante'),
    messages: readMessages(a),
  }))
  return { found, authorizations }
}

/**
 * @param {Element | null} node
 * @returns {SriMessage[]}
 */
function readMessages (node) {
  return children(child(node, 'mensajes'), 'mensaje').map((m) => ({
    id: childText(m, 'identificador'),
    message: childText(m, 'mensaje'),
    info: childText(m, 'informacionAdicional'),
    type: childText(m, 'tipo'),
  }))
}

/**
 * @param {string} text
 * @param {typeof DOMParser | undefined} Parser
 * @returns {Document}
 */
function parseSoap (text, Parser) {
  if (!Parser) throw codeError('no-xml-parser', 'no DOMParser available')
  let doc
  try {
    doc = new Parser().parseFromString(text, 'text/xml')
  } catch (e) {
    throw codeError('sri-bad-response', `the SRI answered something that is not XML: ${String(text).slice(0, 200)}`, { cause: e })
  }
  if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw codeError('sri-bad-response', `the SRI answered something that is not XML: ${String(text).slice(0, 200)}`)
  }
  const fault = first(doc, 'Fault')
  if (fault) throw codeError('sri-fault', `SOAP fault: ${childText(fault, 'faultstring') || fault.textContent}`)
  return doc
}

const localName = (/** @type {Element} */ n) => n.localName || String(n.nodeName).replace(/^.*:/, '')

/**
 * @param {Element | null} node
 * @returns {Element[]}
 */
function elementChildren (node) {
  if (!node) return []
  return /** @type {Element[]} */ (Array.from(node.childNodes || []).filter((n) => n.nodeType === 1))
}

/**
 * @param {Element | null} node
 * @param {string} name
 */
function child (node, name) {
  return elementChildren(node).find((n) => localName(n) === name) || null
}

/**
 * @param {Element | null} node
 * @param {string} name
 */
function children (node, name) {
  return elementChildren(node).filter((n) => localName(n) === name)
}

/**
 * @param {Element | null} node
 * @param {string} name
 */
function childText (node, name) {
  const c = child(node, name)
  return c ? c.textContent.trim() : ''
}

/**
 * @param {Document} doc
 * @param {string} name
 */
function first (doc, name) {
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) return all[i]
  return null
}

/**
 * Hace la llamada. `fetchImpl` se inyecta en las pruebas.
 * @param {string} environment  '1' pruebas, '2' producción (se comprueba)
 * @param {'RecepcionComprobantesOffline'|'AutorizacionComprobantesOffline'} service
 * @param {string} envelope
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function callSri (environment, service, envelope, { fetchImpl = globalThis.fetch, signal } = {}) {
  const base = ENDPOINTS[environment]
  if (!base) throw codeError('bad-environment', `unknown environment: ${environment}`)
  let res
  try {
    res = await fetchImpl(base + service, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: envelope,
      signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    throw codeError('sri-unreachable', `could not reach the SRI (${service}): ${messageOf(e)}`, { cause: e })
  }
  const text = await res.text()
  // Un fallo SOAP llega con 500 y cuerpo XML: se deja pasar para leer su faultstring.
  if (!res.ok && !/Fault/.test(text)) throw codeError('sri-http', `the SRI answered HTTP ${res.status} (${service})`)
  return text
}

