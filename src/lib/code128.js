// Código de barras Code 128 en SVG, para la clave de acceso del RIDE. Hecho en el
// aparato: la clave de acceso identifica una factura del usuario y no tiene por qué
// salir hacia un servicio de imágenes.
//
// La clave tiene 49 dígitos: los pares van en el juego C (un símbolo por cada dos
// dígitos) y el dígito suelto en el juego B.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

export { PATTERNS }

/** Valores de símbolo (sin el de control ni el de parada) para un texto ASCII imprimible. */
export function encodeValues (text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw codeError('bad-code128-text', 'code128: only printable ASCII is supported')
  const values = []
  let set = null
  let i = 0
  while (i < text.length) {
    const run = digitRun(text, i)
    // El juego C compensa a partir de 4 dígitos seguidos (o 2 al principio o al final).
    const useC = run >= 4 || (run >= 2 && run === text.length - i && (i === 0 || set === 'C'))
    if (useC) {
      if (set !== 'C') { values.push(set === null ? START_C : CODE_C); set = 'C' }
      const pairs = Math.floor(run / 2)
      for (let p = 0; p < pairs; p++, i += 2) values.push(Number(text.slice(i, i + 2)))
    } else {
      if (set !== 'B') { values.push(set === null ? START_B : CODE_B); set = 'B' }
      values.push(text.charCodeAt(i) - 32)
      i++
    }
  }
  return values
}

export function checksum (values) {
  let sum = values[0]
  for (let i = 1; i < values.length; i++) sum += values[i] * i
  return sum % 103
}

/** Anchos de barras y espacios alternados, empezando por barra. */
export function modules (text) {
  const values = encodeValues(text)
  const all = [...values, checksum(values), STOP]
  return all.map((v) => PATTERNS[v]).join('')
}

/**
 * @param {string} text
 * @param {{ height?: number, quiet?: number }} [opts]  en unidades de módulo
 */
export function code128Svg (text, { height = 40, quiet = 10 } = {}) {
  const widths = modules(text)
  let x = quiet
  let rects = ''
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i])
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`
    x += w
  }
  const total = x + quiet
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${text}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
}

function digitRun (text, from) {
  let n = 0
  while (from + n < text.length && text.charCodeAt(from + n) >= 48 && text.charCodeAt(from + n) <= 57) n++
  return n
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
