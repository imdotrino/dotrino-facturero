// De punta a punta, en un navegador de verdad y contra el SRI de PRUEBAS (necesita red):
// un emisor con su firma → su copia (con la misma firma y otra serie) → elegir el emisor al
// facturar → respuesta del SRI en pantalla → recargar y que todo siga ahí.
//
// La app se sirve desde dist/ bajo https://facturero.dotrino.com, así la identidad y el
// almacén (iframes de *.dotrino.com) contestan como en producción, y el SRI recibe el
// mismo Origin que en producción.
//
// La firma es un certificado generado en el momento, que NINGUNA entidad acredita: el
// SRI la recibe y la rechaza en autorización con el error 39 («no existe un certificado
// root registrado»). Eso es exactamente lo que se espera aquí. Que el SRI la AUTORICE
// solo se puede comprobar con una firma real.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { makePki } from '../helpers/certs.js'

const ORIGIN = 'https://facturero.dotrino.com'
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
}
const PASSWORD = 'clave ñ 1'

const pki = makePki({ leaves: [{ name: 'FIRMA DE PRUEBA FACTURERO', keyUsage: 'digitalSignature,nonRepudiation' }] })
const dir = await mkdtemp(join(tmpdir(), 'facturero-e2e-'))
const p12Path = join(dir, 'firma.p12')
await writeFile(p12Path, pki.p12({ key: 0, certs: [0], password: PASSWORD }))

const browser = await chromium.launch()
after(async () => { await browser.close(); pki.cleanup() })

async function openApp () {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block', locale: 'es-EC' })
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    let path = new URL(route.request().url()).pathname
    if (!extname(path)) path = '/index.html'
    try {
      const body = await readFile(join(DIST, path))
      return route.fulfill({ status: 200, contentType: TYPES[extname(path)] || 'application/octet-stream', body })
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      return route.fulfill({ status: 404, body: 'not found' })
    }
  })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  await page.goto(ORIGIN + '/')
  await page.getByTestId('invoice-list').waitFor({ timeout: 30_000 })
  return { ctx, page, problems }
}

test('issuers with their own signature, choosing the issuer when invoicing, SRI test environment, persistence', { timeout: 180_000 }, async () => {
  const { ctx, page, problems } = await openApp()
  const sequential = String(100000 + Math.floor(Math.random() * 800000))
  const card = (name) => page.getByTestId('issuer-item').filter({ hasText: name })

  // --- primer emisor, con su firma dentro del mismo formulario
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('add-issuer').click()
  const form = page.getByTestId('new-issuer')
  await form.getByTestId('issuer-ruc').fill('1760013210001')
  await form.getByTestId('issuer-legal-name').fill('PRUEBAS SERVICIO DE RENTAS INTERNAS')
  await form.getByTestId('issuer-trade-name').fill('Tienda Uno')
  await form.getByTestId('issuer-matrix-address').fill('Av. Amazonas y Colón')
  await form.getByTestId('issuer-next-sequential').fill(sequential)
  // Sin firma no se guarda.
  await form.getByTestId('save-issuer').click()
  await form.getByTestId('issuer-signature').getByText('Obligatorio').waitFor()
  // Con la contraseña mala tampoco, y no queda un emisor a medias.
  await form.getByTestId('signature-file').setInputFiles(p12Path)
  await form.getByTestId('signature-password').fill('mala')
  await form.getByTestId('save-issuer').click()
  await form.getByTestId('signature-error').filter({ hasText: 'contraseña' }).waitFor()
  assert.equal(await page.getByTestId('issuer-item').count(), 0)
  await form.getByTestId('signature-password').fill(PASSWORD)
  await form.getByTestId('save-issuer').click()
  await card('Tienda Uno').waitFor({ timeout: 20_000 })
  assert.match(await card('Tienda Uno').getByTestId('issuer-signature-summary').innerText(), /FIRMA DE PRUEBA FACTURERO/)
  assert.match(await card('Tienda Uno').getByTestId('signature-state').innerText(), /Desbloqueada/)

  // --- duplicarlo: la copia lleva la firma del original y choca por serie hasta cambiarla
  await card('Tienda Uno').getByTestId('duplicate-issuer').click()
  const copy = page.getByTestId('new-issuer')
  assert.match(await copy.getByTestId('issuer-signature-kept').innerText(), /FIRMA DE PRUEBA FACTURERO/)
  await copy.getByTestId('issuer-trade-name').fill('Tienda Dos')
  await copy.getByTestId('save-issuer').click()
  await copy.getByText('compartirían la numeración').waitFor()
  await copy.getByTestId('issuer-emission-point').fill('002')
  await copy.getByTestId('issuer-next-sequential').fill(sequential)
  await copy.getByTestId('save-issuer').click()
  await card('Tienda Dos').waitFor()
  assert.equal(await page.getByTestId('issuer-item').count(), 2)
  assert.match(await card('Tienda Dos').getByTestId('signature-state').innerText(), /Desbloqueada/)

  // --- cada emisor se bloquea por su cuenta
  await card('Tienda Uno').getByTestId('lock').click()
  await card('Tienda Uno').getByTestId('signature-state').filter({ hasText: 'Bloqueada' }).waitFor()
  assert.match(await card('Tienda Dos').getByTestId('signature-state').innerText(), /Desbloqueada/)

  // --- factura: con dos emisores listos, se elige
  await page.getByTestId('tab-new').click()
  const select = page.getByTestId('issuer-select')
  assert.equal(await select.inputValue(), '')
  assert.equal(await page.getByTestId('emit').isDisabled(), true)
  const dos = await select.locator('option', { hasText: 'Tienda Dos' }).getAttribute('value')
  await select.selectOption(dos)
  assert.match(await page.getByTestId('next-number').innerText(), new RegExp(`001-002-${sequential.padStart(9, '0')}`))
  await page.getByTestId('test-env').waitFor()
  await page.getByTestId('buyer-id').fill('1710034065')
  await page.getByTestId('buyer-name').fill('Juan Pérez')
  await page.getByTestId('buyer-email').fill('juan@example.com')
  await page.getByTestId('line-description').fill('Servicio de prueba')
  await page.getByTestId('line-quantity').fill('2')
  await page.getByTestId('line-unit-price').fill('10')
  assert.equal(await page.getByTestId('grand-total').innerText(), '$ 23.00')
  await page.getByTestId('emit').click()

  // --- respuesta del SRI: recibida y no autorizada por la cadena de confianza
  const detail = page.getByTestId('invoice-detail')
  await detail.waitFor({ timeout: 30_000 })
  await page.getByTestId('detail-status').filter({ hasText: /No autorizada|En espera/ }).waitFor({ timeout: 60_000 })
  if (await page.getByTestId('detail-status').innerText() === 'En espera') {
    await page.getByTestId('check-authorization').click()
    await page.getByTestId('detail-status').filter({ hasText: 'No autorizada' }).waitFor({ timeout: 60_000 })
  }
  const messages = await page.getByTestId('sri-messages').innerText()
  assert.match(messages, /39 · FIRMA INVALIDA/)
  assert.match(messages, /certificado root/)
  assert.match(await detail.innerText(), new RegExp(`001-002-${sequential.padStart(9, '0')}`))
  assert.match(await page.getByTestId('detail-issuer').innerText(), /Tienda Dos/)
  const accessKey = await page.getByTestId('access-key').innerText()
  assert.match(accessKey, /^\d{49}$/)
  assert.equal(accessKey.slice(24, 30), '001002')
  assert.equal(await page.getByTestId('download-xml').isDisabled(), true)
  assert.equal(await page.getByTestId('correct').isDisabled(), false)

  // --- recargar: la factura sigue, el emisor elegido se queda y las firmas se bloquean
  await page.reload()
  await page.getByTestId('invoice-list').waitFor({ timeout: 30_000 })
  const item = page.locator(`[data-access-key="${accessKey}"]`)
  await item.waitFor({ timeout: 15_000 })
  assert.match(await item.innerText(), /No autorizada/)
  assert.match(await item.innerText(), /Tienda Dos/)
  await page.getByTestId('issuer-filter').waitFor()
  await page.getByTestId('tab-new').click()
  // El borrador se lee del almacén al abrir el formulario: se espera a que llegue.
  await page.waitForFunction((id) => document.querySelector('[data-testid=issuer-select]')?.value === id, dos, { timeout: 10_000 })
  await page.getByTestId('tab-settings').click()
  assert.match(await card('Tienda Uno').getByTestId('signature-state').innerText(), /Bloqueada/)
  assert.match(await card('Tienda Dos').getByTestId('signature-state').innerText(), /Bloqueada/)
  assert.match(await card('Tienda Uno').innerText(), new RegExp(`001-001-${sequential.padStart(9, '0')}`))
  assert.match(await card('Tienda Dos').innerText(), new RegExp(`001-002-${String(Number(sequential) + 1).padStart(9, '0')}`))

  // --- desbloquear después de recargar: solo el emisor que se pide
  await card('Tienda Dos').getByTestId('unlock').click()
  await page.getByTestId('unlock-password').fill('mala')
  await page.getByTestId('unlock-submit').click()
  await page.getByTestId('unlock-error').waitFor()
  await page.getByTestId('unlock-password').fill(PASSWORD)
  await page.getByTestId('unlock-submit').click()
  await card('Tienda Dos').getByTestId('signature-state').filter({ hasText: 'Desbloqueada' }).waitFor({ timeout: 20_000 })
  assert.match(await card('Tienda Uno').getByTestId('signature-state').innerText(), /Bloqueada/)

  // --- quitar un emisor se lleva su firma; el otro queda como estaba
  await card('Tienda Uno').getByTestId('remove-issuer').click()
  await page.getByTestId('confirm-remove-yes').click()
  await card('Tienda Uno').waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('issuer-item').count(), 1)
  assert.match(await card('Tienda Dos').getByTestId('signature-state').innerText(), /Desbloqueada/)

  // Los únicos errores de consola aceptables son los que la app registra a propósito al
  // probar la contraseña mala.
  const unexpected = problems.filter((p) => !/bad-password|does not open this signature file/.test(p))
  assert.deepEqual(unexpected, [])
  await ctx.close()
})
