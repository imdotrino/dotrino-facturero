// Firma XAdES-BES que acepta el SRI (ficha técnica §6: RSA-SHA1, enveloped, C14N
// 20010315). La plantilla es la de bryancalisto/ec-sri-invoice-signer, probada contra
// el SRI con firmas de Uanataca, Security Data, Lazzate y el Banco Central.
//
// Todo va en forma canónica desde el principio. Lo delicado es que los tres fragmentos
// que se resumen (SignedInfo, KeyInfo, SignedProperties) viven dentro de <ds:Signature>
// y HEREDAN sus namespaces: al calcular su digest tienen que llevar declarados los
// namespaces que tienen en el documento (ds, y además xades en SignedProperties). Sin
// eso el SRI contesta «FIRMA INVALIDA» (39) en la autorización, no en la recepción.

import { escapeText, escapeAttr } from './xml.js'

export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#'
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const SIGNED_PROPERTIES_TYPE = 'http://uri.etsi.org/01903#SignedProperties'

const DS_DECL = ` xmlns:ds="${NS_DS}"`
const DS_XADES_DECL = ` xmlns:ds="${NS_DS}" xmlns:xades="${NS_XADES}"`

/**
 * @typedef {object} Signer
 * @property {CryptoKey} privateKey   RSASSA-PKCS1-v1_5 con SHA-1, no extraíble
 * @property {string} certificate     DER del certificado en base64
 * @property {string} certificateSha1 SHA-1 del DER en base64
 * @property {string} issuerName      emisor del certificado en RFC 2253
 * @property {string} serialNumber    número de serie en decimal
 * @property {string} modulus         módulo RSA en base64 (big-endian, sin cero inicial)
 * @property {string} exponent        exponente RSA en base64
 */

/**
 * Firma un comprobante. `rootXml` es el elemento raíz canónico (sin declaración XML) y
 * `rootName` su nombre ('factura'). Devuelve el documento completo, con declaración.
 *
 * @param {string} rootXml
 * @param {Signer} signer
 * @param {{ rootName?: string, now?: Date, uuid?: () => string }} [opts]
 */
export async function signDocument (rootXml, signer, { rootName = 'factura', now = new Date(), uuid = () => crypto.randomUUID() } = {}) {
  const closing = `</${rootName}>`
  if (!rootXml.startsWith(`<${rootName} `) || !rootXml.endsWith(closing)) {
    throw codeError('bad-document', `expected a <${rootName}> root element`)
  }
  if (!rootXml.includes('id="comprobante"')) throw codeError('bad-document', 'the root element needs id="comprobante"')

  const ids = {
    signature: `Signature-${uuid()}`,
    signedInfo: `SignedInfo-${uuid()}`,
    documentRef: `DocumentRef-${uuid()}`,
    signedPropertiesRef: `SignedPropertiesRef-${uuid()}`,
    signedProperties: `SignedProperties-${uuid()}`,
    certificateRef: `CertificateRef-${uuid()}`,
    certificate: `Certificate-${uuid()}`,
    signatureValue: `SignatureValue-${uuid()}`,
    object: `SignatureObject-${uuid()}`,
  }

  const keyInfo = (ns) =>
    `<ds:KeyInfo${ns} Id="${ids.certificate}">` +
    '<ds:X509Data>' +
    `<ds:X509Certificate>${signer.certificate}</ds:X509Certificate>` +
    '</ds:X509Data>' +
    '<ds:KeyValue><ds:RSAKeyValue>' +
    `<ds:Modulus>${signer.modulus}</ds:Modulus>` +
    `<ds:Exponent>${signer.exponent}</ds:Exponent>` +
    '</ds:RSAKeyValue></ds:KeyValue>' +
    '</ds:KeyInfo>'

  const signedProperties = (ns) =>
    `<xades:SignedProperties${ns} Id="${ids.signedProperties}">` +
    '<xades:SignedSignatureProperties>' +
    `<xades:SigningTime>${signingTime(now)}</xades:SigningTime>` +
    '<xades:SigningCertificate><xades:Cert>' +
    '<xades:CertDigest>' +
    `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${signer.certificateSha1}</ds:DigestValue>` +
    '</xades:CertDigest>' +
    '<xades:IssuerSerial>' +
    `<ds:X509IssuerName>${escapeText(signer.issuerName)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${signer.serialNumber}</ds:X509SerialNumber>` +
    '</xades:IssuerSerial>' +
    '</xades:Cert></xades:SigningCertificate>' +
    '</xades:SignedSignatureProperties>' +
    '<xades:SignedDataObjectProperties>' +
    `<xades:DataObjectFormat ObjectReference="#${ids.documentRef}">` +
    '<xades:Description>Firma digital</xades:Description>' +
    '<xades:MimeType>text/xml</xades:MimeType>' +
    '<xades:Encoding>UTF-8</xades:Encoding>' +
    '</xades:DataObjectFormat>' +
    '</xades:SignedDataObjectProperties>' +
    '</xades:SignedProperties>'

  const documentDigest = await sha1Base64(rootXml)
  const signedPropertiesDigest = await sha1Base64(signedProperties(DS_XADES_DECL))
  const keyInfoDigest = await sha1Base64(keyInfo(DS_DECL))

  const signedInfo = (ns) =>
    `<ds:SignedInfo${ns} Id="${ids.signedInfo}">` +
    `<ds:CanonicalizationMethod Algorithm="${C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA1}"></ds:SignatureMethod>` +
    `<ds:Reference Id="${ids.documentRef}" URI="#comprobante">` +
    `<ds:Transforms><ds:Transform Algorithm="${ENVELOPED}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${documentDigest}</ds:DigestValue>` +
    '</ds:Reference>' +
    `<ds:Reference Id="${ids.signedPropertiesRef}" Type="${escapeAttr(SIGNED_PROPERTIES_TYPE)}" URI="#${ids.signedProperties}">` +
    `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>` +
    '</ds:Reference>' +
    `<ds:Reference Id="${ids.certificateRef}" URI="#${ids.certificate}">` +
    `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${keyInfoDigest}</ds:DigestValue>` +
    '</ds:Reference>' +
    '</ds:SignedInfo>'

  const signatureValue = await rsaSha1Base64(signer.privateKey, signedInfo(DS_DECL))

  const signature =
    `<ds:Signature${DS_DECL} Id="${ids.signature}">` +
    signedInfo('') +
    `<ds:SignatureValue Id="${ids.signatureValue}">${signatureValue}</ds:SignatureValue>` +
    keyInfo('') +
    `<ds:Object Id="${ids.object}">` +
    `<xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#${ids.signature}">` +
    signedProperties('') +
    '</xades:QualifyingProperties>' +
    '</ds:Object>' +
    '</ds:Signature>'

  return '<?xml version="1.0" encoding="UTF-8"?>' + rootXml.slice(0, -closing.length) + signature + closing
}

/** Hora de firma con el desfase local del aparato: 2026-09-16T10:20:30.123-05:00 */
export function signingTime (d) {
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

async function sha1Base64 (text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return bytesToBase64(new Uint8Array(digest))
}

async function rsaSha1Base64 (key, text) {
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(text))
  return bytesToBase64(new Uint8Array(sig))
}

export function bytesToBase64 (bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
