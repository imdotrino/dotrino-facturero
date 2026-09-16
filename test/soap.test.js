import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import { receptionEnvelope, authorizationEnvelope, parseReception, parseAuthorization, callSri, ENDPOINTS } from '../src/sri/soap.js'
import { pickAuthorization, authorizedXml } from '../src/lib/emit.js'
import { zipStore, crc32 } from '../src/lib/zip.js'

// Respuestas tal como las devolvió celcer.sri.gob.ec el 2026-09-16.
const RECIBIDA = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>RECIBIDA</estado><comprobantes/></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse></soap:Body></soap:Envelope>'
const DEVUELTA = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>N/A</claveAcceso><mensajes><mensaje><identificador>35</identificador><mensaje>ARCHIVO NO CUMPLE ESTRUCTURA XML</mensaje><informacionAdicional>Se encontró el siguiente error en la estructura del comprobante: No se ha encontrado información en el tag claveAcceso.</informacionAdicional><tipo>ERROR</tipo></mensaje></mensajes></comprobante></comprobantes></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse></soap:Body></soap:Envelope>'
const NO_AUTORIZADO = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>1609202601176001321000110010010009404212344783611</claveAccesoConsultada><numeroComprobantes>1</numeroComprobantes><autorizaciones><autorizacion><estado>NO AUTORIZADO</estado><fechaAutorizacion>2026-09-16T07:50:56-05:00</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="1.1.0"></factura>]]></comprobante><mensajes><mensaje><identificador>39</identificador><mensaje>FIRMA INVALIDA</mensaje><informacionAdicional>La validacion de la cadena de confianza ha fallado</informacionAdicional><tipo>ERROR</tipo></mensaje></mensajes></autorizacion></autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>'
const NINGUNA = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>1609202601176001321000110010010000001231234567813</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>'

test('reception answers', () => {
  assert.deepEqual(parseReception(RECIBIDA, DOMParser), { state: 'RECIBIDA', messages: [] })
  const d = parseReception(DEVUELTA, DOMParser)
  assert.equal(d.state, 'DEVUELTA')
  assert.deepEqual(d.messages[0], {
    id: '35',
    message: 'ARCHIVO NO CUMPLE ESTRUCTURA XML',
    info: 'Se encontró el siguiente error en la estructura del comprobante: No se ha encontrado información en el tag claveAcceso.',
    type: 'ERROR',
  })
})

test('authorization answers, including the nested <mensaje><mensaje>', () => {
  const a = parseAuthorization(NO_AUTORIZADO, DOMParser)
  assert.equal(a.found, 1)
  assert.equal(a.authorizations[0].state, 'NO AUTORIZADO')
  assert.equal(a.authorizations[0].messages[0].id, '39')
  assert.equal(a.authorizations[0].messages[0].message, 'FIRMA INVALIDA')
  assert.match(a.authorizations[0].document, /^<\?xml/)
  assert.deepEqual(parseAuthorization(NINGUNA, DOMParser), { found: 0, authorizations: [] })
})

test('faults and garbage stop with a code', () => {
  const fault = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Unmarshalling Error</faultstring></soap:Fault></soap:Body></soap:Envelope>'
  assert.throws(() => parseReception(fault, DOMParser), { code: 'sri-fault' })
  assert.throws(() => parseReception('<html><title>Request Rejected</title></html>', DOMParser), { code: 'sri-bad-response' })
  assert.throws(() => parseAuthorization('no es xml <', DOMParser), { code: 'sri-bad-response' })
})

test('the request goes as text/plain with no custom headers (no CORS preflight)', async () => {
  let seen
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(RECIBIDA, { status: 200 }) }
  const body = receptionEnvelope('PHg+')
  assert.equal(await callSri('1', 'RecepcionComprobantesOffline', body, { fetchImpl }), RECIBIDA)
  assert.equal(seen.url, ENDPOINTS[1] + 'RecepcionComprobantesOffline')
  assert.equal(seen.init.method, 'POST')
  assert.deepEqual(seen.init.headers, { 'Content-Type': 'text/plain;charset=UTF-8' })
  assert.match(seen.init.body, /<xml>PHg\+<\/xml>/)

  await assert.rejects(callSri('1', 'X', body, { fetchImpl: async () => { throw new TypeError('Failed to fetch') } }), { code: 'sri-unreachable' })
  await assert.rejects(callSri('1', 'X', body, { fetchImpl: async () => new Response('<html>Request Rejected</html>', { status: 403 }) }), { code: 'sri-http' })
  await assert.rejects(callSri('3', 'X', body, { fetchImpl }), { code: 'bad-environment' })
  assert.throws(() => authorizationEnvelope('123'), { code: 'bad-access-key' })
})

test('the authorized one wins; otherwise the latest', () => {
  const list = [
    { state: 'NO AUTORIZADO', date: '2026-09-16T08:00:00-05:00' },
    { state: 'AUTORIZADO', date: '2026-09-16T07:00:00-05:00' },
    { state: 'NO AUTORIZADO', date: '2026-09-16T09:00:00-05:00' },
  ]
  assert.equal(pickAuthorization(list).state, 'AUTORIZADO')
  assert.equal(pickAuthorization([list[0], list[2]]).date, '2026-09-16T09:00:00-05:00')
  assert.equal(pickAuthorization([]), null)
})

test('the authorized XML wraps the document and parses back', () => {
  const xml = authorizedXml({ state: 'AUTORIZADO', number: '123', date: '2026-09-16T08:10:11-05:00', environment: 'PRUEBAS', document: '<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante"/>' })
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  assert.equal(doc.getElementsByTagName('estado')[0].textContent, 'AUTORIZADO')
  assert.match(doc.getElementsByTagName('comprobante')[0].textContent, /<factura id="comprobante"\/>/)
  assert.throws(() => authorizedXml({ state: 'AUTORIZADO', number: '1', date: 'x', environment: 'x', document: 'a]]>b' }), { code: 'sri-bad-response' })
})

test('zip: CRC-32 and a structure that unzip accepts', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926)
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'facturero-zip-'))
  try {
    const file = join(dir, 'x.zip')
    writeFileSync(file, zipStore([{ name: 'a.xml', data: '<a>ñ</a>' }, { name: 'b.xml', data: '<b/>' }]))
    // Python trae zipfile en la librería estándar: comprueba CRC y cabeceras.
    const out = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read("a.xml").decode())', file]).toString().trim()
    assert.equal(out, '<a>ñ</a>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
