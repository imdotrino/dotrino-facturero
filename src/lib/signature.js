// Las firmas electrónicas del usuario (puede tener varias; cada emisor usa una).
//
// - El archivo .p12 se guarda en el almacén SELLADO con la llave de cifrado de este
//   perfil (`id.encrypt` para uno mismo): en el almacén y en su respaldo solo hay bytes
//   que únicamente abre esta identidad. Encima sigue protegido por su contraseña.
// - La contraseña NO se guarda nunca. Se pide al desbloquear, abre el archivo, y lo que
//   queda en memoria es la llave importada a WebCrypto como no extraíble. Recargar la
//   página vuelve a cerrar todas.
// - Cada firma se identifica por su huella (SHA-1 del certificado) y se desbloquea sola.
// - Si algo no cuadra (no hay identidad, el sello no abre, el archivo no es de firma) se
//   para con un código: no hay camino que guarde el archivo sin sellar.

import { getIdentity } from '../services/identity.js'
import { listSignatureRecords, getSignatureRecord, saveSignatureRecord, removeSignatureRecord } from './repo.js'
import { bytesToBase64, base64ToBytes } from './bytes.js'

/** huella → firmador desbloqueado. No se expone a Vue: un Proxy rompe la CryptoKey. */
const signers = new Map()
const listeners = new Set()

export function currentSigner (fingerprint) {
  return signers.get(fingerprint) || null
}

export function isUnlocked (fingerprint) {
  return signers.has(fingerprint)
}

export function onSignerChange (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function changed () {
  for (const fn of listeners) fn()
}

export function lock (fingerprint) {
  signers.delete(fingerprint)
  changed()
}

/** Las firmas guardadas, con lo que se puede enseñar de cada una. */
export async function storedSignatures () {
  return (await listSignatureRecords()).map((r) => ({
    fingerprint: r.info.fingerprint,
    info: r.info,
    fileName: r.fileName,
    savedAt: r.ts,
    unlocked: signers.has(r.info.fingerprint),
  }))
}

/**
 * Comprueba el archivo con su contraseña, lo sella y lo guarda. Deja la firma
 * desbloqueada para esta sesión. Devuelve sus datos visibles.
 */
export async function importSignature (file, password) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { openP12 } = await import('../sri/p12.js')
  const { signer, info } = await openP12(bytes, password)

  const id = await getIdentity()
  const encPub = await id.getEncryptionPubkey()
  const publickey = id.me?.publickey
  if (!encPub || !publickey) throw codeError('identity-without-keys', 'the active profile has no encryption key')
  const plaintext = bytesToBase64(bytes)
  const envelope = await id.encrypt([{ token: publickey, publickey, encryptionPubkey: encPub }], plaintext)

  // El cifrado del vault omite en silencio a un destinatario que no pudo envolver. Antes
  // de guardar se abre el sello: si no abre aquí, no abrirá nunca.
  const check = await id.decrypt(encPub, publickey, envelope)
  if (check?.plaintext !== plaintext) throw codeError('seal-check-failed', 'the sealed signature could not be opened right after sealing it')

  await saveSignatureRecord({ envelope, sealedBy: encPub, info, fileName: file.name })
  signers.set(info.fingerprint, signer)
  changed()
  return info
}

/** Abre una firma guardada con su contraseña. */
export async function unlockSignature (fingerprint, password) {
  const r = await getSignatureRecord(fingerprint)
  const id = await getIdentity()
  let opened
  try {
    opened = await id.decrypt(r.sealedBy, id.me?.publickey, r.envelope)
  } catch (e) {
    throw codeError('seal-not-for-this-device', `the saved signature cannot be opened on this device: ${e?.message || e}`, e)
  }
  const { openP12 } = await import('../sri/p12.js')
  const { signer, info } = await openP12(base64ToBytes(opened.plaintext), password)
  if (info.fingerprint !== fingerprint) throw codeError('signature-mismatch', 'the opened file is not the saved signature')
  signers.set(fingerprint, signer)
  changed()
  return info
}

export async function forgetSignature (fingerprint) {
  await removeSignatureRecord(fingerprint)
  signers.delete(fingerprint)
  changed()
}

function codeError (code, message, cause) {
  const e = new Error(message, cause ? { cause } : undefined)
  e.code = code
  return e
}
