// Abre un archivo de firma electrónica (.p12 / .pfx) y deja lista la llave para firmar.
//
// WebCrypto no descifra PKCS#12 (3DES, RC2-40 y PBES2 de los certificados que se emiten
// en Ecuador), así que el archivo se abre con node-forge. En cuanto se tiene la llave,
// se importa a WebCrypto como NO extraíble y es esa la que firma: la contraseña y el
// material de la llave no se guardan en ningún sitio.
//
// Un .p12 puede traer varias llaves y certificados (el del Banco Central trae uno de
// cifrado y otro de firma, más la cadena). No se toma el primero: se empareja cada llave
// con su certificado y se elige el de firma. Si no se puede decidir, se para y se dice.

import forge from 'node-forge'
import { bytesToBase64, bytesToBinary, binaryToBytes } from '../lib/bytes.js'
import { codeError, messageOf } from '../lib/errors.js'

/** Una llave del archivo, ya leída. @typedef {{ key: forge.pki.rsa.PrivateKey, attributes: forge.pkcs12.Bag['attributes'] }} KeyBag */
/** Un certificado del archivo. @typedef {{ cert: forge.pki.Certificate, attributes: forge.pkcs12.Bag['attributes'] }} CertBag */

const OID_KEY_BAG = forge.pki.oids.keyBag
const OID_SHROUDED_KEY_BAG = forge.pki.oids.pkcs8ShroudedKeyBag
const OID_CERT_BAG = forge.pki.oids.certBag

/**
 * @param {Uint8Array} bytes   contenido del archivo
 * @param {string} password
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ signer: import('../types').Signer, info: import('../types').CertificateInfo }>}
 */
export async function openP12 (bytes, password, { now = new Date() } = {}) {
  const pair = selectSigningPair(readP12(bytes, password), now)
  const { key, cert } = pair

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const pkcs8Der = forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes()
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', binaryToBytes(pkcs8Der), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['sign'])

  const certBytes = binaryToBytes(certDer)
  const certificateSha1 = bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-1', certBytes)))

  return {
    signer: {
      privateKey,
      certificate: bytesToBase64(certBytes),
      certificateSha1,
      issuerName: issuerRfc2253(cert),
      serialNumber: BigInt('0x' + cert.serialNumber).toString(),
      modulus: bigIntegerToBase64(key.n),
      exponent: bigIntegerToBase64(key.e),
    },
    info: certificateInfo(cert, certificateSha1),
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {string} password
 * @returns {{ keyBags: KeyBag[], certBags: CertBag[] }}
 */
function readP12 (bytes, password) {
  let p12
  // PKCS#12 usa la contraseña con DOS codificaciones (RFC 7292, apéndice B.1): como
  // BMPString para el MAC y para 3DES/RC2, y en UTF-8 para PBES2 (AES, el formato por
  // defecto de OpenSSL 3). forge le pasa a PBES2 un byte por carácter, así que una
  // contraseña con ñ o tildes no abría ningún .p12 moderno. Mientras se lee el archivo,
  // PBES2 recibe la contraseña en UTF-8; lo demás sigue igual. Es síncrono: nada más
  // puede usar forge entre el cambio y la restauración.
  const pbes2 = forge.pki.pbe.getCipherForPBES2
  forge.pki.pbe.getCipherForPBES2 = (oid, params, pw) => pbes2(oid, params, forge.util.encodeUtf8(pw))
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytesToBinary(bytes)))
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password)
  } catch (e) {
    const msg = messageOf(e)
    if (/MAC could not be verified|Invalid password/i.test(msg)) throw codeError('bad-password', 'the password does not open this signature file', { cause: e })
    if (/unsupported|not supported/i.test(msg)) throw codeError('unsupported-p12', `this signature file uses an algorithm that cannot be opened here: ${msg}`, { cause: e })
    throw codeError('bad-p12', `not a valid .p12 file: ${msg}`, { cause: e })
  } finally {
    forge.pki.pbe.getCipherForPBES2 = pbes2
  }
  /** @type {KeyBag[]} */
  const keyBags = []
  for (const b of [
    ...(p12.getBags({ bagType: OID_SHROUDED_KEY_BAG })[OID_SHROUDED_KEY_BAG] || []),
    ...(p12.getBags({ bagType: OID_KEY_BAG })[OID_KEY_BAG] || []),
  ]) if (b.key) keyBags.push({ key: b.key, attributes: b.attributes })
  /** @type {CertBag[]} */
  const certBags = []
  for (const b of p12.getBags({ bagType: OID_CERT_BAG })[OID_CERT_BAG] || []) if (b.cert) certBags.push({ cert: b.cert, attributes: b.attributes })
  if (keyBags.length === 0) throw codeError('no-key', 'the signature file has no private key (or it could not be decrypted)')
  if (certBags.length === 0) throw codeError('no-certificate', 'the signature file has no certificate')
  return { keyBags, certBags }
}

/** Empareja llaves y certificados por módulo y elige el de firma. */
/**
 * @param {{ keyBags: KeyBag[], certBags: CertBag[] }} bags
 * @param {Date} now
 */
export function selectSigningPair ({ keyBags, certBags }, now) {
  /** @type {Array<{ key: forge.pki.rsa.PrivateKey, cert: forge.pki.Certificate, keyName: string, certName: string }>} */
  const pairs = []
  for (const kb of keyBags) {
    if (!kb.key.n) continue // no es RSA
    for (const cb of certBags) {
      const pub = /** @type {forge.pki.rsa.PublicKey} */ (cb.cert.publicKey)
      if (pub?.n && pub.n.compareTo(kb.key.n) === 0 && pub.e.compareTo(kb.key.e) === 0) {
        pairs.push({ key: kb.key, cert: cb.cert, keyName: friendlyName(kb), certName: friendlyName(cb) })
      }
    }
  }
  if (pairs.length === 0) throw codeError('no-matching-pair', 'no private key in the file matches any of its certificates')

  let candidates = pairs.filter((p) => !isCa(p.cert))
  if (candidates.length === 0) throw codeError('no-matching-pair', 'the only key in the file belongs to a certification authority')

  const signing = candidates.filter((p) => canSign(p.cert))
  if (signing.length > 0) candidates = signing

  if (candidates.length > 1) {
    const named = candidates.filter((p) => /sign|firma|verification/i.test(p.keyName + ' ' + p.certName))
    if (named.length === 1) candidates = named
  }
  if (candidates.length > 1) throw codeError('ambiguous-p12', `the file has ${candidates.length} signing keys and none is marked as the signing one`)

  const pair = candidates[0]
  const { notBefore, notAfter } = pair.cert.validity
  if (now < notBefore) throw codeError('certificate-not-yet-valid', `the certificate is valid from ${notBefore.toISOString()}`)
  if (now > notAfter) throw codeError('certificate-expired', `the certificate expired on ${notAfter.toISOString()}`)
  return pair
}

/** @param {forge.pki.Certificate} cert */
function isCa (cert) {
  const bc = /** @type {{ cA?: boolean } | undefined} */ (cert.getExtension('basicConstraints'))
  return Boolean(bc && bc.cA)
}

/** @param {forge.pki.Certificate} cert */
function canSign (cert) {
  const ku = /** @type {{ digitalSignature?: boolean, nonRepudiation?: boolean } | undefined} */ (cert.getExtension('keyUsage'))
  // Sin extensión keyUsage el certificado no restringe el uso.
  if (!ku) return true
  return Boolean(ku.digitalSignature || ku.nonRepudiation)
}

/** @param {KeyBag | CertBag} bag */
function friendlyName (bag) {
  return String(bag.attributes?.friendlyName?.[0] || '')
}

/**
 * Emisor en RFC 2253 (del más específico al país), como lo lee el validador del SRI
 * (MITyC, `X500Principal`): el correo va como EMAILADDRESS y no como E.
 */
/** @param {forge.pki.Certificate} cert */
export function issuerRfc2253 (cert) {
  return cert.issuer.attributes
    .slice()
    .reverse()
    .map((a) => {
      const name = a.shortName === 'E' ? 'EMAILADDRESS' : (a.shortName || a.type)
      return `${name}=${escapeRdnValue(String(a.value ?? ''))}`
    })
    .join(',')
}

/** @param {string} v */
function escapeRdnValue (v) {
  let out = v.replace(/([,+"\\<>;])/g, '\\$1')
  if (out.startsWith(' ') || out.startsWith('#')) out = '\\' + out
  if (out.endsWith(' ') && !out.endsWith('\\ ')) out = out.slice(0, -1) + '\\ '
  return out
}

/**
 * @param {forge.pki.Certificate} cert
 * @param {string} fingerprint
 * @returns {import('../types').CertificateInfo}
 */
function certificateInfo (cert, fingerprint) {
  const subject = (/** @type {string} */ short) => cert.subject.getField(short)?.value || ''
  const issuer = (/** @type {string} */ short) => cert.issuer.getField(short)?.value || ''
  return {
    holder: subject('CN'),
    issuer: issuer('O') || issuer('CN'),
    validFrom: cert.validity.notBefore.toISOString(),
    validTo: cert.validity.notAfter.toISOString(),
    ruc: findRuc(cert),
    fingerprint,
  }
}

/**
 * Las entidades de certificación de Ecuador meten el RUC en extensiones propias (OIDs
 * distintos por entidad). Se busca un número con forma de RUC en ellas; es solo para
 * mostrarlo, nunca para decidir nada.
 */
/** @param {forge.pki.Certificate} cert */
function findRuc (cert) {
  for (const ext of cert.extensions || []) {
    if (typeof ext.value !== 'string') continue
    const m = ext.value.match(/\d{10}001/)
    if (m) return m[0]
  }
  return null
}

/** @param {forge.jsbn.BigInteger} n */
function bigIntegerToBase64 (n) {
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  return bytesToBase64(binaryToBytes(forge.util.hexToBytes(hex)))
}

