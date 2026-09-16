// Importadores de los reportes que exporta Facturero Móvil (app.factureromovil.com):
// «Reporte de clientes» y «Reporte-Bienes». Convierten las filas de la hoja en compradores
// y productos, y dicen de cada fila si entra, si ya existe o qué le falta.
//
// Las columnas se buscan por su encabezado, no por su posición: así un reporte con una
// columna de más o de menos sigue funcionando, y uno que no es el esperado se rechaza.

import { buyerProblems, normalizeBuyer } from '../lib/buyers.js'
import { productProblems, normalizeProduct } from '../lib/products.js'
import { VAT_RATES } from '../sri/catalog.js'

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Busca la fila de encabezados: la primera que contiene todas las columnas requeridas.
 * @returns {{ headerRow: number, col: Record<string, number> }}
 */
function locate (rows, columns) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r].map(fold)
    const col = {}
    for (const [name, test] of Object.entries(columns)) {
      const i = cells.findIndex(test)
      if (i >= 0) col[name] = i
    }
    const required = Object.entries(columns).filter(([, t]) => t.required).map(([n]) => n)
    if (required.every((n) => n in col)) return { headerRow: r, col }
  }
  const e = new Error('the file does not have the expected columns')
  e.code = 'import-wrong-report'
  throw e
}

const is = (...names) => Object.assign((c) => names.includes(c), { required: true })
const optional = (...names) => (c) => names.includes(c)

// ---------- clientes ----------

const ID_TYPES = {
  ruc: '04',
  cedula: '05',
  pasaporte: '06',
  'identificacion del exterior': '08',
  'consumidor final': '07',
}

/**
 * @param {string[][]} rows
 * @param {object[]} registered compradores ya guardados
 * @returns {{ items: Array<{ row: number, buyer: object, status: 'new'|'exists'|'invalid', problems: object[] }> }}
 */
export function importBuyers (rows, registered) {
  const { headerRow, col } = locate(rows, {
    name: is('razon social', 'nombre', 'nombres'),
    idType: is('tipo identificacion'),
    id: is('identificacion'),
    address: optional('direccion'),
    phone: optional('telefonos', 'telefono'),
    email: optional('email', 'correo', 'correo electronico'),
  })
  const items = []
  const seen = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cell = (k) => (col[k] === undefined ? '' : String(rows[r][col[k]] ?? '').trim())
    if (!cell('name') && !cell('id')) continue
    const typeCode = ID_TYPES[fold(cell('idType'))]
    const buyer = normalizeBuyer({
      idType: typeCode || '',
      // Excel guarda la identificación como texto con un apóstrofo delante.
      id: cell('id').replace(/^'/, ''),
      name: cell('name'),
      email: cell('email'),
      phone: cell('phone'),
      address: cell('address'),
    })
    if (typeCode === '07') {
      items.push({ row: r + 1, buyer, status: 'skip', problems: [{ path: 'buyer.idType', code: 'import-final-consumer' }] })
      continue
    }
    const same = (b) => b.idType === buyer.idType && b.id === buyer.id
    if (registered.some(same)) {
      items.push({ row: r + 1, buyer, status: 'exists', problems: [] })
      continue
    }
    const problems = buyerProblems(buyer, registered)
    if (!typeCode) problems.unshift({ path: 'buyer.idType', code: 'import-unknown-id-type' })
    if (seen.some(same)) problems.push({ path: 'buyer.id', code: 'import-duplicate-row' })
    const status = problems.length ? 'invalid' : 'new'
    if (status === 'new') seen.push(buyer)
    items.push({ row: r + 1, buyer, status, problems })
  }
  return { items }
}

// ---------- bienes y servicios ----------

const VAT_BY_TEXT = { '15': '4', '5': '5', '0': '0', '13': '10', '8': '8', 'no objeto de iva': '6', 'no objeto': '6', exento: '7', 'exento de iva': '7' }

export function importProducts (rows, registered) {
  const { headerRow, col } = locate(rows, {
    code: is('cod principal', 'codigo principal', 'codigo'),
    auxCode: optional('cod auxiliar', 'codigo auxiliar'),
    // «Descipcion», con la errata tal como la exporta Facturero Móvil.
    description: Object.assign((c) => /^desc/.test(c), { required: true }),
    price: is('valor', 'precio', 'valor unitario', 'precio unitario'),
    unit: optional('unid medida', 'unidad de medida', 'unidad'),
    vat: is('tarifa iva'),
    ice: optional('tarifa ice'),
    status: optional('estado'),
  })
  const items = []
  const seen = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cell = (k) => (col[k] === undefined ? '' : String(rows[r][col[k]] ?? '').trim())
    if (!cell('code') && !cell('description')) continue
    const vatKey = fold(cell('vat')).replace(/\s*$/, '')
    const vatCode = VAT_BY_TEXT[vatKey]
    const product = normalizeProduct({
      code: cell('code'),
      auxCode: cell('auxCode'),
      description: cell('description'),
      unit: cell('unit'),
      unitPrice: cell('price').replace(/,/g, ''),
      vatCode: vatCode || '',
    })
    const pre = []
    if (!vatCode) pre.push({ path: 'product.vatCode', code: VAT_RATES.some((v) => v.historic && fold(v.rate) === vatKey) ? 'import-historic-vat' : 'import-unknown-vat' })
    if (cell('ice')) pre.push({ path: 'product.ice', code: 'import-ice' })
    if (col.status !== undefined && fold(cell('status')) !== 'activo') {
      items.push({ row: r + 1, product, status: 'skip', problems: [{ path: 'product.status', code: 'import-inactive' }] })
      continue
    }
    const same = (p) => p.code === product.code
    if (registered.some(same)) {
      items.push({ row: r + 1, product, status: 'exists', problems: [] })
      continue
    }
    // Un problema por campo: la tarifa desconocida ya lo dice, no hace falta «obligatorio» encima.
    const problems = [...pre, ...productProblems(product, registered)]
      .filter((p, i, all) => all.findIndex((q) => q.path === p.path) === i)
    if (seen.some(same)) problems.push({ path: 'product.code', code: 'import-duplicate-row' })
    const status = problems.length ? 'invalid' : 'new'
    if (status === 'new') seen.push(product)
    items.push({ row: r + 1, product, status, problems })
  }
  return { items }
}
