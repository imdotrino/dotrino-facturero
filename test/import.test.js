import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readSheet, readHtmlTable } from '../src/import/xls.js'
import { importBuyers, importProducts } from '../src/import/factureroMovil.js'
import { productProblems, lineFromProduct } from '../src/lib/products.js'

// Archivos SINTÉTICOS con la forma de los reportes de Facturero Móvil: los .xls de clientes
// los genera LibreOffice (Excel 97-2003 de verdad) y el de bienes es una tabla HTML como la
// que exporta Facturero Móvil. Ningún dato real entra al repo.
const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/import/${name}`, import.meta.url)))

test('Excel 97-2003, small workbook (lives in the mini stream)', () => {
  const rows = readSheet(fixture('clientes-pequeno.xls'))
  assert.deepEqual(rows[0], ['FACTURERO MÓVIL'])
  assert.deepEqual(rows[3], ['No', 'Razon social', 'Tipo identificacion', 'Identificacion', 'Direccion', 'Telefonos', 'Email', 'Observaciones'])
  assert.equal(rows[4][1], 'ÑANDÚ COMERCIAL S.A.')
  assert.equal(rows[4][0], '1')
})

test('Excel 97-2003, larger workbook (regular sectors), 300 rows', () => {
  const rows = readSheet(fixture('clientes-grande.xls'))
  assert.equal(rows.length, 304)
  assert.deepEqual(rows[303].slice(0, 4), ['300', 'Cliente de prueba número 300', 'Pasaporte', "'P0000300"])
  const { items } = importBuyers(rows, [])
  assert.equal(items.length, 300)
  assert.ok(items.every((i) => i.status === 'new'))
})

test('clients report: each row says whether it goes in and why not', () => {
  const rows = readSheet(fixture('clientes-pequeno.xls'))
  const registered = [{ key: 'k', idType: '08', id: 'AB123456', name: 'Ya estaba', email: 'x@example.com' }]
  const summary = importBuyers(rows, registered).items.map((i) => [i.buyer.name, i.buyer.idType, i.buyer.id, i.status, i.problems.map((p) => p.code)])
  assert.deepEqual(summary, [
    ['ÑANDÚ COMERCIAL S.A.', '04', '1790011674001', 'new', []],          // apóstrofo de Excel quitado
    ['Juan Pérez', '05', '1710034065', 'new', []],
    ['Sin Correo Cía.', '04', '1790011674001', 'invalid', ['import-duplicate-row']],    // sin correo entraría: lo frena la fila repetida
    ['Visitante', '08', 'AB123456', 'exists', []],
    ['Correo Malo', '06', 'P998877', 'invalid', ['bad-email']],
    ['CONSUMIDOR FINAL', '07', '9999999999999', 'skip', ['import-final-consumer']],
  ])
})

test('goods report (HTML table): two tables, entities, VAT rates, inactive, ICE, repeated code', () => {
  const rows = readSheet(fixture('bienes.xls'))
  const { items } = importProducts(rows, [])
  const summary = items.map((i) => [i.product.code, i.status, i.problems.map((p) => p.code)])
  assert.deepEqual(summary, [
    ['SRV-001', 'new', []],
    ['LIB-002', 'new', []],
    ['VIE-003', 'invalid', ['import-historic-vat']],
    ['INA-004', 'skip', ['import-inactive']],
    ['ICE-005', 'invalid', ['import-ice']],
    ['SRV-001', 'invalid', ['import-duplicate-row']],
  ])
  assert.deepEqual(items[0].product, { code: 'SRV-001', auxCode: 'AUX-1', description: 'Consultoría & soporte <remoto>', unit: 'Horas', unitPrice: '133.93', vatCode: '4' })
  assert.equal(items[1].product.unitPrice, '1000.50')
  assert.equal(items[1].product.vatCode, '0')
})

test('a file that is not the expected report is rejected, and xlsx is said to be unsupported', () => {
  assert.throws(() => importBuyers(readSheet(fixture('bienes.xls')), []), { code: 'import-wrong-report' })
  assert.throws(() => importProducts(readSheet(fixture('clientes-pequeno.xls')), []), { code: 'import-wrong-report' })
  assert.throws(() => readSheet(new Uint8Array([0x50, 0x4B, 3, 4])), { code: 'unsupported-format' })
  assert.throws(() => readSheet(new TextEncoder().encode('hola')), { code: 'unsupported-format' })
})

test('html cells: colspan fills columns and &amp;lt; stays literal', () => {
  assert.deepEqual(readHtmlTable('<table><tr><td colspan="2">a &amp;lt; b</td><td>c</td></tr></table>'), [['a &lt; b', '', 'c']])
})

test('products: required fields, unique code, and what a product puts on an invoice line', () => {
  const p = { key: 'p1', code: 'SRV-001', auxCode: '', description: 'Consultoría', unit: 'Horas', unitPrice: '133.9300', vatCode: '4' }
  assert.deepEqual(productProblems(p, [p]), [])
  assert.deepEqual(productProblems({ ...p, key: undefined }, [p]).map((x) => x.code), ['duplicate-product'])
  assert.deepEqual(productProblems({ code: '', description: '', unitPrice: 'x', vatCode: '2' }, []).map((x) => `${x.path}:${x.code}`),
    ['product.code:required', 'product.description:required', 'product.unitPrice:bad-number', 'product.vatCode:required'])
  assert.deepEqual(lineFromProduct(p), { productKey: 'p1', code: 'SRV-001', auxCode: '', description: 'Consultoría', unit: 'Horas', unitPrice: '133.93', vatCode: '4' })
})
