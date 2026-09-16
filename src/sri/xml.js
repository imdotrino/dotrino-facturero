// XML de la factura (esquema 1.1.0 del SRI), escrito YA en forma canónica
// (C14N 20010315): sin espacios entre etiquetas, sin etiquetas vacías abreviadas y con
// el escapado exacto de C14N. Así el digest del comprobante es el SHA-1 de esta misma
// cadena, sin necesitar un canonicalizador en el navegador.
//
// Si alguna vez se toca el formato de salida, la prueba que valida la firma con una
// canonicalización independiente (xml-crypto) es la que avisa.

import { computeInvoice, cleanText } from './invoice.js'
import { RIMPE_LEGENDS, TAX_VAT, FINAL_CONSUMER_ID, FINAL_CONSUMER_NAME } from './catalog.js'

export const INVOICE_VERSION = '1.1.0'
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

/** Escapado de texto de C14N. */
export function escapeText (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
}

/** Escapado de atributo de C14N. */
export function escapeAttr (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')
}

const el = (name, text) => `<${name}>${escapeText(text)}</${name}>`
const opt = (name, text) => (text === undefined || text === null || text === '' ? '' : el(name, text))

/**
 * @param {object} p
 * @param {object} p.issuer      datos del emisor (ver src/lib/store.js)
 * @param {object} p.draft       comprador, líneas y pago
 * @param {string} p.accessKey   clave de acceso de 49 dígitos
 * @param {string} p.sequential  9 dígitos
 * @param {string} p.issueDate   dd/mm/aaaa (la misma que va en la clave)
 * @returns {string} el elemento <factura> canónico, sin declaración XML
 */
export function buildInvoiceXml ({ issuer, draft, accessKey, sequential, issueDate }) {
  const t = computeInvoice(draft)
  const buyer = draft.buyer
  const finalConsumer = buyer.idType === '07'

  const infoTributaria = '<infoTributaria>' +
    el('ambiente', issuer.environment) +
    el('tipoEmision', '1') +
    el('razonSocial', cleanText(issuer.legalName)) +
    opt('nombreComercial', cleanText(issuer.tradeName)) +
    el('ruc', issuer.ruc) +
    el('claveAcceso', accessKey) +
    el('codDoc', '01') +
    el('estab', issuer.establishment) +
    el('ptoEmi', issuer.emissionPoint) +
    el('secuencial', sequential) +
    el('dirMatriz', cleanText(issuer.matrixAddress)) +
    opt('agenteRetencion', issuer.withholdingAgent) +
    opt('contribuyenteRimpe', issuer.rimpe ? RIMPE_LEGENDS[issuer.rimpe] : '') +
    '</infoTributaria>'

  const totalConImpuestos = '<totalConImpuestos>' + t.taxes.map((tax) =>
    '<totalImpuesto>' +
    el('codigo', TAX_VAT) +
    el('codigoPorcentaje', tax.code) +
    el('baseImponible', tax.base) +
    el('valor', tax.value) +
    '</totalImpuesto>').join('') + '</totalConImpuestos>'

  const pagos = '<pagos>' + (draft.payments || []).slice(0, 1).map((p) =>
    '<pago>' + el('formaPago', p.method) + el('total', t.total) + '</pago>').join('') + '</pagos>'

  const infoFactura = '<infoFactura>' +
    el('fechaEmision', issueDate) +
    opt('dirEstablecimiento', cleanText(issuer.establishmentAddress)) +
    opt('contribuyenteEspecial', issuer.specialTaxpayer) +
    el('obligadoContabilidad', issuer.keepsAccounting ? 'SI' : 'NO') +
    el('tipoIdentificacionComprador', buyer.idType) +
    el('razonSocialComprador', finalConsumer ? FINAL_CONSUMER_NAME : cleanText(buyer.name)) +
    el('identificacionComprador', finalConsumer ? FINAL_CONSUMER_ID : cleanText(buyer.id)) +
    opt('direccionComprador', cleanText(buyer.address)) +
    el('totalSinImpuestos', t.totalWithoutTaxes) +
    el('totalDescuento', t.totalDiscount) +
    totalConImpuestos +
    el('propina', t.tip) +
    el('importeTotal', t.total) +
    el('moneda', 'DOLAR') +
    pagos +
    '</infoFactura>'

  const detalles = '<detalles>' + t.lines.map((l) =>
    '<detalle>' +
    opt('codigoPrincipal', l.code) +
    el('descripcion', l.description) +
    el('cantidad', l.quantity) +
    el('precioUnitario', l.unitPrice) +
    el('descuento', l.discount) +
    el('precioTotalSinImpuesto', l.subtotal) +
    '<impuestos><impuesto>' +
    el('codigo', TAX_VAT) +
    el('codigoPorcentaje', l.vat.code) +
    el('tarifa', l.vat.rate) +
    el('baseImponible', l.vat.base) +
    el('valor', l.vat.value) +
    '</impuesto></impuestos>' +
    '</detalle>').join('') + '</detalles>'

  const extra = additionalFields(buyer)
  const infoAdicional = extra.length === 0
    ? ''
    : '<infoAdicional>' + extra.map(([name, value]) =>
      `<campoAdicional nombre="${escapeAttr(name)}">${escapeText(value)}</campoAdicional>`).join('') + '</infoAdicional>'

  return `<factura id="comprobante" version="${INVOICE_VERSION}">` +
    infoTributaria + infoFactura + detalles + infoAdicional + '</factura>'
}

function additionalFields (buyer) {
  const out = []
  const email = cleanText(buyer.email)
  const phone = cleanText(buyer.phone)
  if (email) out.push(['Email', email])
  if (phone) out.push(['Teléfono', phone])
  return out
}

export function toBase64Utf8 (text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
