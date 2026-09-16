// Productos y servicios registrados. Como los compradores, son de todos los emisores.
//
// Los campos siguen la tabla 12 de la ficha técnica («parametrizar los productos o
// servicios»): código principal, código auxiliar opcional, nombre, valor unitario y la
// tarifa de IVA. La unidad de medida es opcional y va en el detalle (`unidadMedida`).
// Elegir un producto en una línea de la factura COPIA sus datos a la línea: cambiar el
// producto después no toca las facturas ni los borradores.

import { cleanText } from '../sri/invoice.js'
import { parseDecimal, format } from '../sri/decimal.js'
import { VAT_RATES, DEFAULT_VAT_CODE } from '../sri/catalog.js'

export const EMPTY_PRODUCT = Object.freeze({ code: '', auxCode: '', description: '', unit: '', unitPrice: '', vatCode: DEFAULT_VAT_CODE })

export function normalizeProduct (p) {
  return {
    ...(p.key ? { key: p.key } : {}),
    code: cleanText(p.code),
    auxCode: cleanText(p.auxCode),
    description: cleanText(p.description),
    unit: cleanText(p.unit),
    unitPrice: String(p.unitPrice ?? '').trim().replace(',', '.'),
    vatCode: p.vatCode,
  }
}

/** Lo que impide registrar un producto. `[{ path, code }]`. */
export function productProblems (product, products = []) {
  const p = normalizeProduct(product)
  const problems = []
  const add = (path, code) => problems.push({ path, code })
  if (!p.code) add('product.code', 'required')
  else if (p.code.length > 25) add('product.code', 'too-long')
  if (p.auxCode.length > 25) add('product.auxCode', 'too-long')
  if (!p.description) add('product.description', 'required')
  else if (p.description.length > 300) add('product.description', 'too-long')
  if (p.unit.length > 50) add('product.unit', 'too-long')
  try {
    parseDecimal(p.unitPrice)
  } catch (e) {
    if (e.code !== 'bad-decimal') throw e
    add('product.unitPrice', 'bad-number')
  }
  if (!VAT_RATES.some((v) => v.code === p.vatCode && !v.historic)) add('product.vatCode', 'required')
  if (p.code && products.some((o) => o.key !== p.key && o.code === p.code)) add('product.code', 'duplicate-product')
  return problems
}

export function searchProducts (products, query) {
  const q = cleanText(query).toLowerCase()
  return products
    .filter((p) => !q || `${p.code} ${p.auxCode} ${p.description}`.toLowerCase().includes(q))
    .sort((a, b) => a.description.localeCompare(b.description))
}

/** Lo que el producto pone en una línea de factura (cantidad y descuento no son suyos). */
export function lineFromProduct (product) {
  return {
    productKey: product.key,
    code: product.code,
    auxCode: product.auxCode,
    description: product.description,
    unit: product.unit,
    unitPrice: format(parseDecimal(product.unitPrice), 6).replace(/\.?0+$/, ''),
    vatCode: product.vatCode,
  }
}
