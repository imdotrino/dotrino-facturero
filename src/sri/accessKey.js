// Clave de acceso del SRI: 49 dígitos que identifican un comprobante electrónico.
//
//   fecha emisión ddmmaaaa (8) · tipo de comprobante (2) · RUC (13) · ambiente (1)
//   · serie = establecimiento (3) + punto de emisión (3) · secuencial (9)
//   · código numérico (8) · tipo de emisión (1) · dígito verificador (1)
//
// El dígito verificador es módulo 11 con pesos 2..7 de derecha a izquierda
// (ficha técnica de comprobantes electrónicos, esquema offline).

export const DOC_TYPES = Object.freeze({
  invoice: '01',
  creditNote: '04',
  debitNote: '05',
  waybill: '06',
  withholding: '07',
})

export const ENVIRONMENTS = Object.freeze({ test: '1', production: '2' })

const EMISSION_NORMAL = '1'

export function mod11 (digits) {
  if (!/^\d+$/.test(digits)) throw codeError('bad-digits', `mod11 needs digits, got «${digits}»`)
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight
    weight = weight === 7 ? 2 : weight + 1
  }
  const dv = 11 - (sum % 11)
  if (dv === 11) return 0
  if (dv === 10) return 1
  return dv
}

/**
 * @param {object} p
 * @param {Date|string} p.date       fecha de emisión (Date, o 'dd/mm/aaaa')
 * @param {string} p.docType         '01' factura…
 * @param {string} p.ruc             13 dígitos
 * @param {'1'|'2'} p.environment    1 pruebas, 2 producción
 * @param {string} p.establishment   3 dígitos
 * @param {string} p.emissionPoint   3 dígitos
 * @param {string|number} p.sequential hasta 9 dígitos
 * @param {string} [p.numericCode]   8 dígitos; si falta se genera al azar
 */
export function buildAccessKey (p) {
  const date = typeof p.date === 'string' ? p.date.replaceAll('/', '') : ddmmyyyy(p.date)
  const parts = {
    date: exact(date, 8, 'date'),
    docType: exact(p.docType, 2, 'docType'),
    ruc: exact(p.ruc, 13, 'ruc'),
    environment: exact(p.environment, 1, 'environment'),
    establishment: exact(p.establishment, 3, 'establishment'),
    emissionPoint: exact(p.emissionPoint, 3, 'emissionPoint'),
    sequential: exact(String(p.sequential).padStart(9, '0'), 9, 'sequential'),
    numericCode: exact(p.numericCode ?? randomDigits(8), 8, 'numericCode'),
  }
  if (!['1', '2'].includes(parts.environment)) throw codeError('bad-environment', `environment must be 1 or 2, got ${parts.environment}`)
  const body = parts.date + parts.docType + parts.ruc + parts.environment +
    parts.establishment + parts.emissionPoint + parts.sequential + parts.numericCode + EMISSION_NORMAL
  return body + mod11(body)
}

/** Descompone una clave de acceso y comprueba su dígito verificador. */
export function parseAccessKey (key) {
  if (!/^\d{49}$/.test(key)) throw codeError('bad-access-key', `access key must be 49 digits, got «${key}»`)
  const valid = mod11(key.slice(0, 48)) === Number(key[48])
  return {
    date: `${key.slice(0, 2)}/${key.slice(2, 4)}/${key.slice(4, 8)}`,
    docType: key.slice(8, 10),
    ruc: key.slice(10, 23),
    environment: key[23],
    establishment: key.slice(24, 27),
    emissionPoint: key.slice(27, 30),
    sequential: key.slice(30, 39),
    numericCode: key.slice(39, 47),
    emissionType: key[47],
    checkDigit: key[48],
    valid,
  }
}

export function ddmmyyyy (d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw codeError('bad-date', `not a valid date: ${d}`)
  return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear()
}

function exact (value, len, name) {
  const s = String(value ?? '')
  if (s.length !== len || !/^\d+$/.test(s)) throw codeError('bad-' + name, `${name} must be ${len} digits, got «${s}»`)
  return s
}

function randomDigits (n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => String(b % 10)).join('')
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
