// De punta a punta, en un navegador de verdad y contra el SRI de PRUEBAS (necesita red):
// datos del emisor → cargar firma → emitir → respuesta del SRI en pantalla → recargar y
// que todo siga ahí.
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

test('issuer, signature, emission to the SRI test environment, and persistence', { timeout: 180_000 }, async () => {
  const { ctx, page, problems } = await openApp()
  const sequential = String(100000 + Math.floor(Math.random() * 800000))

  // --- ajustes del emisor
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('issuer-ruc').fill('1760013210001')
  await page.getByTestId('issuer-legal-name').fill('PRUEBAS SERVICIO DE RENTAS INTERNAS')
  await page.getByTestId('issuer-trade-name').fill('Facturero E2E')
  await page.getByTestId('issuer-matrix-address').fill('Av. Amazonas y Colón')
  await page.getByTestId('issuer-next-sequential').fill(sequential)
  await page.getByTestId('save-issuer').click()
  await page.getByTestId('toast').filter({ hasText: 'Guardado' }).waitFor()

  // --- firma: contraseña mala primero, luego la buena
  await page.getByTestId('signature-file').setInputFiles(p12Path)
  await page.getByTestId('signature-password').fill('mala')
  await page.getByTestId('import-signature').click()
  await page.getByTestId('signature-error').filter({ hasText: 'contraseña' }).waitFor()
  await page.getByTestId('signature-password').fill(PASSWORD)
  await page.getByTestId('import-signature').click()
  await page.getByTestId('signature-info').filter({ hasText: 'FIRMA DE PRUEBA FACTURERO' }).waitFor({ timeout: 20_000 })
  assert.match(await page.getByTestId('signature-state').innerText(), /Desbloqueada/)

  // --- factura
  await page.getByTestId('tab-new').click()
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
  let status = await page.getByTestId('detail-status').innerText()
  if (status === 'En espera') {
    await page.getByTestId('check-authorization').click()
    await page.getByTestId('detail-status').filter({ hasText: 'No autorizada' }).waitFor({ timeout: 60_000 })
    status = 'No autorizada'
  }
  const messages = await page.getByTestId('sri-messages').innerText()
  assert.match(messages, /39 · FIRMA INVALIDA/)
  assert.match(messages, /certificado root/)
  const accessKey = await page.getByTestId('access-key').innerText()
  assert.match(accessKey, /^\d{49}$/)
  assert.equal(await page.getByTestId('download-xml').isDisabled(), true)
  assert.equal(await page.getByTestId('correct').isDisabled(), false)

  // --- recargar: la factura sigue, y la firma queda bloqueada
  await page.reload()
  await page.getByTestId('invoice-list').waitFor({ timeout: 30_000 })
  const item = page.locator(`[data-access-key="${accessKey}"]`)
  await item.waitFor({ timeout: 15_000 })
  assert.match(await item.innerText(), /No autorizada/)
  await page.getByTestId('tab-settings').click()
  assert.match(await page.getByTestId('signature-state').innerText(), /Bloqueada/)

  // --- desbloquear después de recargar: el sello abre con la identidad del perfil
  await page.getByTestId('unlock').click()
  await page.getByTestId('unlock-password').fill('mala')
  await page.getByTestId('unlock-submit').click()
  await page.getByTestId('unlock-error').waitFor()
  await page.getByTestId('unlock-password').fill(PASSWORD)
  await page.getByTestId('unlock-submit').click()
  await page.getByTestId('signature-state').filter({ hasText: 'Desbloqueada' }).waitFor({ timeout: 20_000 })

  // Los únicos errores de consola aceptables son los que la app registra a propósito al
  // probar la contraseña mala.
  const unexpected = problems.filter((p) => !/bad-password|does not open this signature file/.test(p))
  assert.deepEqual(unexpected, [])
  await ctx.close()
})
