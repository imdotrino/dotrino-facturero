// Aritmética decimal exacta para importes del SRI. Nada de coma flotante: 0.1 + 0.2 no
// da 0.3, y un centavo de diferencia es un error 52 («error en diferencias»).
//
// Los valores viajan como BigInt en millonésimas (6 decimales, lo máximo que acepta
// el SRI en cantidad y precio unitario). El redondeo es «mitad hacia arriba», el
// habitual en facturación; todos los importes son no negativos.

const SCALE = 1_000_000n

export function parseDecimal (value, { field = 'value' } = {}) {
  const s = typeof value === 'number' ? numberToString(value) : String(value ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw codeError('bad-decimal', `${field}: «${value}» is not a non-negative decimal with up to 6 places`)
  const [int, frac = ''] = s.split('.')
  return BigInt(int) * SCALE + BigInt(frac.padEnd(6, '0'))
}

/** Producto de dos valores escalados, redondeado a 6 decimales. */
export function mul (a, b) {
  return divRound(a * b, SCALE)
}

/** Redondea un valor escalado a `places` decimales (sigue escalado). */
export function round (value, places) {
  const step = 10n ** BigInt(6 - places)
  return divRound(value, step) * step
}

/** Porcentaje: base × tarifa / 100, redondeado a 2 decimales. */
export function percent (base, rate) {
  return round(divRound(base * rate, 100n * SCALE), 2)
}

export function format (value, places) {
  const r = round(value, places)
  const int = r / SCALE
  const frac = (r % SCALE).toString().padStart(6, '0').slice(0, places)
  return places > 0 ? `${int}.${frac}` : `${int}`
}

export function sum (values) {
  return values.reduce((a, b) => a + b, 0n)
}

function divRound (n, d) {
  if (n < 0n) throw codeError('negative-amount', 'amounts cannot be negative')
  return (n + d / 2n) / d
}

function numberToString (n) {
  if (!Number.isFinite(n)) return String(n)
  // toFixed evita la notación científica de números pequeños (1e-7).
  return n.toFixed(6).replace(/\.?0+$/, '')
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
