// Cálculo y validación de una factura antes de firmarla.
//
// Regla de cálculo: el impuesto se calcula por línea (base × tarifa, redondeado a 2
// decimales) y los totales son la SUMA de las líneas. Así cada total cuadra con sus
// detalles, que es lo que revisa el SRI antes de responder con el error 52.

import { parseDecimal, mul, round, percent, format, sum } from './decimal.js'
import { vatRate, BUYER_ID_TYPES, PAYMENT_METHODS, FINAL_CONSUMER_ID, FINAL_CONSUMER_MAX, RIMPE_LEGENDS } from './catalog.js'

const LIMITS = { name: 300, address: 300, description: 300, code: 25, extra: 300, id: 20, email: 300 }

/** Colapsa espacios y saltos de línea: el XSD no admite saltos en ningún campo de texto. */
export function cleanText (value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * Los correos de un campo: uno o varios, separados por coma, punto y coma o espacios (así los
 * guarda Facturero Móvil). En la factura van juntos en un solo campo adicional.
 */
export function splitEmails (text) {
  const parts = cleanText(text).split(/[,;\s]+/).filter(Boolean)
  return { valid: parts.filter((p) => EMAIL_RE.test(p)), invalid: parts.filter((p) => !EMAIL_RE.test(p)) }
}

export const joinEmails = (list) => list.join(', ')

/** `''` si el campo de correo está bien (vacío también vale), o el código del problema. */
export function emailProblem (text) {
  const value = cleanText(text)
  if (!value) return ''
  if (splitEmails(value).invalid.length) return 'bad-email'
  return value.length > LIMITS.email ? 'too-long' : ''
}

/**
 * Calcula líneas y totales. Lanza con `code` si un número no es válido; `validate`
 * convierte eso en problemas por campo para la interfaz.
 */
export function computeInvoice (draft) {
  const lines = (draft.lines || []).map((line, i) => {
    const quantity = parseDecimal(line.quantity, { field: `lines[${i}].quantity` })
    const unitPrice = parseDecimal(line.unitPrice, { field: `lines[${i}].unitPrice` })
    const discount = round(parseDecimal(line.discount || '0', { field: `lines[${i}].discount` }), 2)
    const gross = round(mul(quantity, unitPrice), 2)
    if (discount > gross) {
      const e = new Error(`lines[${i}]: discount is larger than the line amount`)
      e.code = 'discount-exceeds'
      throw e
    }
    const base = gross - discount
    const rate = vatRate(line.vatCode)
    const value = percent(base, parseDecimal(rate.rate))
    return {
      code: cleanText(line.code),
      auxCode: cleanText(line.auxCode),
      description: cleanText(line.description),
      unit: cleanText(line.unit),
      quantity: format(quantity, 6),
      unitPrice: format(unitPrice, 6),
      discount: format(discount, 2),
      subtotal: format(base, 2),
      vat: { code: rate.code, rate: rate.rate, base: format(base, 2), value: format(value, 2) },
      raw: { base, discount, value },
    }
  })

  const byCode = new Map()
  for (const l of lines) {
    const t = byCode.get(l.vat.code) || { code: l.vat.code, rate: l.vat.rate, base: 0n, value: 0n }
    t.base += l.raw.base
    t.value += l.raw.value
    byCode.set(l.vat.code, t)
  }
  const taxes = [...byCode.values()]
    .sort((a, b) => Number(a.code) - Number(b.code))
    .map((t) => ({ code: t.code, rate: t.rate, base: format(t.base, 2), value: format(t.value, 2), raw: t }))

  const totalWithoutTaxes = sum(lines.map((l) => l.raw.base))
  const totalDiscount = sum(lines.map((l) => l.raw.discount))
  const vatTotal = sum(lines.map((l) => l.raw.value))
  const tip = round(parseDecimal(draft.tip || '0', { field: 'tip' }), 2)
  const total = totalWithoutTaxes + vatTotal + tip

  return {
    lines: lines.map(({ raw, ...l }) => l),
    taxes: taxes.map(({ raw, ...t }) => t),
    totalWithoutTaxes: format(totalWithoutTaxes, 2),
    totalDiscount: format(totalDiscount, 2),
    vatTotal: format(vatTotal, 2),
    tip: format(tip, 2),
    total: format(total, 2),
  }
}

/**
 * Lo que impide emitir. Devuelve `[{ path, code }]`; lista vacía = se puede firmar.
 * No corrige nada por su cuenta: dice qué falta.
 */
export function validate (draft, issuer) {
  const problems = []
  const add = (path, code) => problems.push({ path, code })

  validateIssuer(issuer, add)

  const buyer = draft.buyer || {}
  if (!BUYER_ID_TYPES.some((t) => t.code === buyer.idType)) add('buyer.idType', 'required')
  const id = cleanText(buyer.id)
  if (buyer.idType === '07') {
    if (id !== FINAL_CONSUMER_ID) add('buyer.id', 'final-consumer-id')
  } else if (buyer.idType === '05') {
    if (!isCedula(id)) add('buyer.id', 'bad-cedula')
  } else if (buyer.idType === '04') {
    if (!isRuc(id)) add('buyer.id', 'bad-ruc')
  } else if (buyer.idType) {
    if (!id || id.length > LIMITS.id) add('buyer.id', 'required')
  }
  if (!cleanText(buyer.name)) add('buyer.name', 'required')
  else if (cleanText(buyer.name).length > LIMITS.name) add('buyer.name', 'too-long')
  if (cleanText(buyer.address).length > LIMITS.address) add('buyer.address', 'too-long')
  if (emailProblem(buyer.email)) add('buyer.email', emailProblem(buyer.email))

  const lines = draft.lines || []
  if (lines.length === 0) add('lines', 'no-lines')
  lines.forEach((line, i) => {
    const d = cleanText(line.description)
    if (!d) add(`lines[${i}].description`, 'required')
    else if (d.length > LIMITS.description) add(`lines[${i}].description`, 'too-long')
    if (cleanText(line.code).length > LIMITS.code) add(`lines[${i}].code`, 'too-long')
    if (cleanText(line.auxCode).length > LIMITS.code) add(`lines[${i}].auxCode`, 'too-long')
    if (cleanText(line.unit).length > 50) add(`lines[${i}].unit`, 'too-long')
    checkDecimal(line.quantity, `lines[${i}].quantity`, add, { positive: true })
    checkDecimal(line.unitPrice, `lines[${i}].unitPrice`, add)
    checkDecimal(line.discount || '0', `lines[${i}].discount`, add)
    try { vatRate(line.vatCode) } catch { add(`lines[${i}].vatCode`, 'required') }
  })
  checkDecimal(draft.tip || '0', 'tip', add)

  const payment = (draft.payments || [])[0]
  if (!payment || !PAYMENT_METHODS.some((p) => p.code === payment.method)) add('payments', 'required')

  if (problems.length === 0) {
    let totals
    try {
      totals = computeInvoice(draft)
    } catch (e) {
      if (e.code !== 'discount-exceeds') throw e
      add('lines', 'discount-exceeds')
      return problems
    }
    if (buyer.idType === '07' && parseDecimal(totals.total) > parseDecimal(FINAL_CONSUMER_MAX)) add('buyer.idType', 'final-consumer-limit')
    if (parseDecimal(totals.total) === 0n) add('lines', 'zero-total')
  }
  return problems
}

export function validateIssuer (issuer, add) {
  if (!issuer) { add('issuer', 'required'); return }
  if (!/^\d{10}001$/.test(issuer.ruc || '')) add('issuer.ruc', 'bad-ruc')
  if (!cleanText(issuer.legalName)) add('issuer.legalName', 'required')
  if (!cleanText(issuer.matrixAddress)) add('issuer.matrixAddress', 'required')
  if (!/^\d{3}$/.test(issuer.establishment || '') || issuer.establishment === '000') add('issuer.establishment', 'bad-series')
  if (!/^\d{3}$/.test(issuer.emissionPoint || '') || issuer.emissionPoint === '000') add('issuer.emissionPoint', 'bad-series')
  const seq = Number(issuer.nextSequential)
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999_999) add('issuer.nextSequential', 'bad-sequential')
  if (!['1', '2'].includes(issuer.environment)) add('issuer.environment', 'required')
  if (issuer.rimpe && !RIMPE_LEGENDS[issuer.rimpe]) add('issuer.rimpe', 'required')
  if (issuer.withholdingAgent && !/^[1-9]\d{0,7}$/.test(issuer.withholdingAgent)) add('issuer.withholdingAgent', 'bad-resolution')
  if (issuer.specialTaxpayer && !/^[A-Za-z0-9]{3,13}$/.test(issuer.specialTaxpayer)) add('issuer.specialTaxpayer', 'bad-resolution')
}

/** Cédula ecuatoriana: provincia 01–24 o 30, tercer dígito < 6 y módulo 10. */
export function isCedula (id) {
  if (!/^\d{10}$/.test(id)) return false
  const province = Number(id.slice(0, 2))
  if (!((province >= 1 && province <= 24) || province === 30)) return false
  if (Number(id[2]) >= 6) return false
  let total = 0
  for (let i = 0; i < 9; i++) {
    let v = Number(id[i]) * (i % 2 === 0 ? 2 : 1)
    if (v > 9) v -= 9
    total += v
  }
  return (10 - (total % 10)) % 10 === Number(id[9])
}

/**
 * RUC: 13 dígitos terminados en 001. El de persona natural es su cédula y se comprueba;
 * el de sociedades y entidades públicas no, porque los RUC nuevos ya no cumplen el
 * módulo 11 de antes y rechazaríamos uno válido.
 */
export function isRuc (id) {
  if (!/^\d{10}001$/.test(id)) return false
  if (Number(id[2]) < 6) return isCedula(id.slice(0, 10))
  return true
}

function checkDecimal (value, path, add, { positive = false } = {}) {
  let v
  try {
    v = parseDecimal(value, { field: path })
  } catch (e) {
    if (e.code !== 'bad-decimal') throw e
    add(path, 'bad-number')
    return
  }
  if (positive && v === 0n) add(path, 'must-be-positive')
}
