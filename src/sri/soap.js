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

export const ENDPOINTS = Object.freeze({
  1: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/',
  2: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/',
})

export function receptionEnvelope (xmlBase64) {
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">' +
    '<soapenv:Header/><soapenv:Body><ec:validarComprobante>' +
    `<xml>${xmlBase64}</xml>` +
    '</ec:validarComprobante></soapenv:Body></soapenv:Envelope>'
}

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
 * @returns {{ found: number, authorizations: Array<{ state: string, number: string, date: string, environment: string, document: string, messages: SriMessage[] }> }}
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
 * @typedef {{ id: string, message: string, info: string, type: string }} SriMessage
 */
function readMessages (node) {
  return children(child(node, 'mensajes'), 'mensaje').map((m) => ({
    id: childText(m, 'identificador'),
    message: childText(m, 'mensaje'),
    info: childText(m, 'informacionAdicional'),
    type: childText(m, 'tipo'),
  }))
}

function parseSoap (text, Parser) {
  if (!Parser) throw codeError('no-xml-parser', 'no DOMParser available')
  let doc
  try {
    doc = new Parser().parseFromString(text, 'text/xml')
  } catch (e) {
    throw codeError('sri-bad-response', `the SRI answered something that is not XML: ${String(text).slice(0, 200)}`, e)
  }
  if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw codeError('sri-bad-response', `the SRI answered something that is not XML: ${String(text).slice(0, 200)}`)
  }
  const fault = first(doc, 'Fault')
  if (fault) throw codeError('sri-fault', `SOAP fault: ${childText(fault, 'faultstring') || fault.textContent}`)
  return doc
}

const localName = (n) => n.localName || String(n.nodeName).replace(/^.*:/, '')

function elementChildren (node) {
  if (!node) return []
  return Array.from(node.childNodes || []).filter((n) => n.nodeType === 1)
}

function child (node, name) {
  return elementChildren(node).find((n) => localName(n) === name) || null
}

function children (node, name) {
  return elementChildren(node).filter((n) => localName(n) === name)
}

function childText (node, name) {
  const c = child(node, name)
  return c ? c.textContent.trim() : ''
}

function first (doc, name) {
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) return all[i]
  return null
}

/**
 * Hace la llamada. `fetchImpl` se inyecta en las pruebas.
 * @param {'1'|'2'} environment
 * @param {'RecepcionComprobantesOffline'|'AutorizacionComprobantesOffline'} service
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
    if (e?.name === 'AbortError') throw e
    throw codeError('sri-unreachable', `could not reach the SRI (${service}): ${e?.message || e}`, e)
  }
  const text = await res.text()
  // Un fallo SOAP llega con 500 y cuerpo XML: se deja pasar para leer su faultstring.
  if (!res.ok && !/Fault/.test(text)) throw codeError('sri-http', `the SRI answered HTTP ${res.status} (${service})`)
  return text
}

function codeError (code, message, cause) {
  const e = new Error(message, cause ? { cause } : undefined)
  e.code = code
  return e
}
