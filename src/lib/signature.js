// La firma electrónica de cada emisor.
//
// - Cada emisor lleva SU firma: se carga con el emisor, se desbloquea por emisor y se va
//   con él. Si dos emisores usan el mismo archivo (pruebas y producción del mismo RUC), cada
//   uno tiene su copia, y duplicar un emisor duplica también su firma.
// - El archivo .p12 se guarda en el almacén SELLADO con la llave de cifrado de este
//   perfil (`id.encrypt` para uno mismo): en el almacén y en su respaldo solo hay bytes
//   que únicamente abre esta identidad. Encima sigue protegido por su contraseña.
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

/** Sella y guarda la firma abierta como la de ese emisor, y la deja desbloqueada. */
export async function attachSignature (issuerId, opened) {
  const id = await getIdentity()
  const encPub = await id.getEncryptionPubkey()
  const publickey = id.me?.publickey
  if (!encPub || !publickey) throw codeError('identity-without-keys', 'the active profile has no encryption key')
  const plaintext = bytesToBase64(opened.bytes)
  const envelope = await id.encrypt([{ token: publickey, publickey, encryptionPubkey: encPub }], plaintext)

  // El cifrado del vault omite en silencio a un destinatario que no pudo envolver. Antes
  // de guardar se abre el sello: si no abre aquí, no abrirá nunca.
  const check = await id.decrypt(encPub, publickey, envelope)
  if (check?.plaintext !== plaintext) throw codeError('seal-check-failed', 'the sealed signature could not be opened right after sealing it')

  await saveSignatureRecord(issuerId, { envelope, sealedBy: encPub, info: opened.info, fileName: opened.fileName })
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
  let opened
  try {
    opened = await id.decrypt(r.sealedBy, id.me?.publickey, r.envelope)
  } catch (e) {
    throw codeError('seal-not-for-this-device', `the saved signature cannot be opened on this device: ${e?.message || e}`, e)
  }
  const { openP12 } = await import('../sri/p12.js')
  const { signer, info } = await openP12(base64ToBytes(opened.plaintext), password)
  if (info.fingerprint !== r.info.fingerprint) throw codeError('signature-mismatch', 'the opened file is not the saved signature')
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
