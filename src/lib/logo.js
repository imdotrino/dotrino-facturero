// El logo de un emisor, para la cabecera de su RIDE.
//
// Va al almacén con el resto de los ajustes, así que se reduce EN EL APARATO antes de
// guardarlo: una foto de 3 MB serían 3 MB en cada copia a la bóveda, y en un RIDE no se ve
// mejor que una de 600 px. Se dibuja sobre blanco —el papel es blanco— y se guarda en el
// formato que menos pese de los que el navegador sepa escribir.

export const LOGO_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'])
export const LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024
/** Lo que puede ocupar el logo ya reducido (su data URL). */
export const LOGO_MAX_BYTES = 150 * 1024
const MAX_WIDTH = 600
const MAX_HEIGHT = 300

function codeError (code, message) {
  return Object.assign(new Error(message), { code })
}

/** Lee la imagen, la reduce y devuelve `{ dataUrl, width, height }`. Lanza con `code`. */
export async function prepareLogo (file) {
  if (!LOGO_TYPES.includes(file.type)) throw codeError('logo-bad-type', `unsupported logo type: ${file.type || 'unknown'}`)
  if (file.size > LOGO_MAX_FILE_BYTES) throw codeError('logo-file-too-large', `logo file is ${file.size} bytes`)
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (e) {
    throw codeError('logo-unreadable', `the image could not be read: ${e.message}`)
  }
  const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  for (const [type, quality] of [['image/png'], ['image/webp', 0.9], ['image/jpeg', 0.9], ['image/webp', 0.7], ['image/jpeg', 0.7]]) {
    const dataUrl = canvas.toDataURL(type, quality)
    // Un navegador que no sabe escribir ese formato devuelve PNG: no cuenta como intento.
    if (!dataUrl.startsWith(`data:${type}`)) continue
    if (dataUrl.length <= LOGO_MAX_BYTES) return { dataUrl, width, height }
  }
  throw codeError('logo-too-large', `the logo does not fit in ${LOGO_MAX_BYTES} bytes even reduced`)
}
