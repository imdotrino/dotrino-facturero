// Pedir un importador: va por el mismo relevo que «Solicita una app» y «Contacto» del
// ecosistema (@dotrino/feedback, un Worker que lo reenvía por correo a Dotrino), firmado
// con la identidad del perfil para que el correo diga quién lo pide.
//
// Con archivo, el cuerpo es el archivo tal cual y los datos van en la cabecera
// X-Dotrino-Feedback (ver dotrino-feedback/src/attachment.js); sin archivo, el JSON de
// siempre. El tope lo decide el Worker: 5 MB.
import { getIdentity } from './identity.js'

export const FEEDBACK_URL = 'https://feedback.dotrino.com/'
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const ATTACHMENT_EXTENSIONS = ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'txt', 'xml', 'json', 'pdf', 'zip']

export function attachmentProblem (file) {
  if (!file) return null
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
  if (!ATTACHMENT_EXTENSIONS.includes(ext)) return 'attachment-type'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'attachment-too-large'
  if (file.size === 0) return 'attachment-empty'
  return null
}

/**
 * @param {{ text: string, contact: string, locale: string, file?: File|null, fetchImpl?: typeof fetch }} p
 */
export async function requestImporter ({ text, contact, locale, file = null, fetchImpl = fetch }) {
  const problem = attachmentProblem(file)
  if (problem) throw codeError(problem, `attachment rejected: ${problem}`)
  const id = await getIdentity()
  const ts = Date.now()
  const signed = await id.signData({ op: 'app-request', text, ts })
  const signature = typeof signed === 'string' ? signed : signed?.signature
  if (!signature) throw codeError('feedback-unsigned', 'the identity did not return a signature')
  const meta = {
    text,
    app: 'facturero-importador',
    locale,
    contact,
    pubkey: id.me?.publickey || '',
    nickname: id.me?.nickname || '',
    ts,
    signature,
  }
  let res
  try {
    res = file
      ? await fetchImpl(FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Dotrino-Feedback': base64url(JSON.stringify({ ...meta, filename: file.name })) },
        body: file,
      })
      : await fetchImpl(FEEDBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      })
  } catch (e) {
    throw codeError('feedback-unreachable', `could not reach the feedback relay: ${e?.message || e}`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw codeError(res.status === 413 ? 'attachment-too-large' : res.status === 429 ? 'feedback-rate-limited' : 'feedback-failed',
      `the feedback relay answered ${res.status}: ${body.error || ''}`)
  }
}

function base64url (s) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
