// La firma electrónica de cada emisor.
//
// - Cada emisor lleva SU firma: se carga con el emisor, se desbloquea por emisor y se va
//   con él. Si dos emisores usan el mismo archivo (pruebas y producción del mismo RUC), cada
//   uno tiene su copia, y duplicar un emisor duplica también su firma.
// - El archivo .p12 se guarda en el almacén SELLADO. Con cuenta en una bóveda va con la
//   LLAVE DE CONTENIDO DEL PERFIL (`sealContent`), que tienen todos los aparatos de la
//   cuenta: así la firma abre en cualquiera de ellos. Sin esa llave (perfil sin bóveda) va
//   con la llave de cifrado de ESTE aparato, que es el único que hay. Encima sigue
//   protegida por su contraseña.
//
//   Hasta 2026-09-30 iba SIEMPRE con la llave del aparato, y la tarjeta de Ajustes
//   prometía «los recuperas desde otro aparato de tu cuenta»: el sobre se respaldaba en la
//   bóveda, pero solo lo abría el aparato que lo selló. Cuando ese navegador se borró, la
//   firma quedó en la bóveda sin que nadie pudiera abrirla. Un registro viejo que todavía
//   abre en su aparato se vuelve a sellar con la llave del perfil al desbloquearlo.
// - La contraseña NO se guarda nunca. Se pide al desbloquear, abre el archivo, y lo que
//   queda en memoria es la llave importada a WebCrypto como no extraíble. Recargar la
//   página vuelve a cerrar todas.
// - Si algo no cuadra (no hay identidad, el sello no abre, el archivo no es de firma) se
//   para con un código: no hay camino que guarde el archivo sin sellar.

import { getIdentity } from '../services/identity.js'
import { listSignatureRecords, getSignatureRecord, saveSignatureRecord } from './repo.js'
import { bytesToBase64, base64ToBytes } from './bytes.js'

/** issuerId → firmador desbloqueado. No se expone a Vue: un Proxy rompe la CryptoKey. */
const signers = new Map()
const listeners = new Set()

export function currentSigner (issuerId) {
  return signers.get(issuerId) || null
}

export function onSignerChange (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function changed () {
  for (const fn of listeners) fn()
}

export function lock (issuerId) {
  signers.delete(issuerId)
  changed()
}

/** Las firmas guardadas, una por emisor, con lo que se puede enseñar de cada una. */
export async function storedSignatures () {
  return (await listSignatureRecords()).map((r) => ({
    issuerId: r.issuerId,
    info: r.info,
    fileName: r.fileName,
    savedAt: r.ts,
    unlocked: signers.has(r.issuerId),
  }))
}

/**
 * Abre el archivo con su contraseña, SIN guardar nada: así una contraseña equivocada se
 * sabe antes de guardar el emisor. Lo que devuelve se pasa a `attachSignature`.
 */
export async function openSignatureFile (file, password) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { openP12 } = await import('../sri/p12.js')
  const { signer, info } = await openP12(bytes, password)
  return { bytes, signer, info, fileName: file.name }
}

/**
 * Sella el archivo: con la llave del perfil si la hay (abre en todos los aparatos de la
 * cuenta), y si no, con la de este aparato. Antes de devolver se abre el sello: si no abre
 * aquí, no abrirá nunca, y se para en vez de guardar algo inservible.
 */
async function seal (id, plaintext) {
  if (typeof id.contentKey === 'function' && await id.contentKey()) {
    const envelope = await id.sealContent(plaintext)
    if (await id.openContent(envelope) !== plaintext) throw codeError('seal-check-failed', 'the sealed signature could not be opened right after sealing it')
    return { envelope, seal: 'profile' }
  }
  const encPub = await id.getEncryptionPubkey()
  const publickey = id.me?.publickey
  if (!encPub || !publickey) throw codeError('identity-without-keys', 'the active profile has no encryption key')
  const envelope = await id.encrypt([{ token: publickey, publickey, encryptionPubkey: encPub }], plaintext)
  // El cifrado del vault omite en silencio a un destinatario que no pudo envolver.
  const check = await id.decrypt(encPub, publickey, envelope)
  if (check?.plaintext !== plaintext) throw codeError('seal-check-failed', 'the sealed signature could not be opened right after sealing it')
  return { envelope, seal: 'device', sealedBy: encPub }
}

/** Sella y guarda la firma abierta como la de ese emisor, y la deja desbloqueada. */
export async function attachSignature (issuerId, opened) {
  const id = await getIdentity()
  const sealed = await seal(id, bytesToBase64(opened.bytes))
  await saveSignatureRecord(issuerId, { ...sealed, info: opened.info, fileName: opened.fileName })
  signers.set(issuerId, opened.signer)
  changed()
  return opened.info
}

/**
 * Da al emisor nuevo la misma firma que el original (ya sellada: no hace falta volver a
 * pedir el archivo). Si el original estaba desbloqueado, la copia también.
 */
export async function copySignature (fromIssuerId, toIssuerId) {
  const r = await getSignatureRecord(fromIssuerId)
  await saveSignatureRecord(toIssuerId, r)
  if (signers.has(fromIssuerId)) signers.set(toIssuerId, signers.get(fromIssuerId))
  changed()
}

/** Abre con su contraseña la firma guardada de un emisor. */
export async function unlockSignature (issuerId, password) {
  const r = await getSignatureRecord(issuerId)
  const id = await getIdentity()
  let plaintext
  try {
    plaintext = r.seal === 'profile'
      ? await id.openContent(r.envelope)
      // Sin `seal`: registro anterior a 2026-09-30, sellado con la llave del aparato.
      : (await id.decrypt(r.sealedBy, id.me?.publickey, r.envelope))?.plaintext
  } catch (e) {
    throw codeError(r.seal === 'profile' ? 'seal-no-profile-key' : 'seal-not-for-this-device', `the saved signature cannot be opened on this device: ${e?.message || e}`, e)
  }
  if (!plaintext) throw codeError('seal-not-for-this-device', 'the saved signature opened empty on this device')
  const { openP12 } = await import('../sri/p12.js')
  const { signer, info } = await openP12(base64ToBytes(plaintext), password)
  if (info.fingerprint !== r.info.fingerprint) throw codeError('signature-mismatch', 'the opened file is not the saved signature')
  // Un registro sellado al aparato, ahora que abrió, pasa a la llave del perfil si la hay:
  // desde aquí lo abre cualquier aparato de la cuenta.
  if (r.seal !== 'profile') {
    const sealed = await seal(id, plaintext)
    if (sealed.seal === 'profile') await saveSignatureRecord(issuerId, { envelope: sealed.envelope, seal: 'profile', info: r.info, fileName: r.fileName })
  }
  signers.set(issuerId, signer)
  changed()
  return info
}

/** Se llama al quitar un emisor: su firma deja de estar en memoria. */
export function forgetSigner (issuerId) {
  signers.delete(issuerId)
  changed()
}

function codeError (code, message, cause) {
  const e = new Error(message, cause ? { cause } : undefined)
  e.code = code
  return e
}
