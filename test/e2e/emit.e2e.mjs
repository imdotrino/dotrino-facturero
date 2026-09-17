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

const IMPORT_FIXTURES = fileURLToPath(new URL('../fixtures/import/', import.meta.url))

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
  // Un navegador recién estrenado no tiene bóveda: se dice dónde están los datos y por qué,
  // y «Sincronizar ahora» se ve pero apagado.
  const backup = page.getByTestId('backup')
  await backup.getByTestId('backup-state').and(page.locator('[data-state="off"]')).waitFor({ timeout: 30_000 })
  assert.equal(await backup.getByTestId('backup-headline').innerText(), 'Solo en este navegador')
  assert.equal(await backup.getByTestId('backup-reason').innerText(), 'Este perfil no está enlazado a una bóveda.')
  assert.equal(await backup.getByTestId('backup-sync').isDisabled(), true)
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

  // --- compradores: consumidor final es fijo; los demás se registran (el correo es opcional)
  await page.getByTestId('tab-buyers').click()
  const fcItem = page.locator('[data-buyer-key="final-consumer"]')
  await fcItem.waitFor()
  assert.equal(await fcItem.getByTestId('edit-buyer').isDisabled(), true)
  assert.equal(await fcItem.getByTestId('remove-buyer').isDisabled(), true)
  await page.getByTestId('add-buyer').click()
  const newBuyer = page.getByTestId('new-buyer')
  await newBuyer.getByTestId('buyer-id').fill('1710034066')
  await newBuyer.getByTestId('buyer-name').fill('Juan Pérez')
  await newBuyer.getByTestId('save-buyer').click()
  await newBuyer.getByText('La cédula no es válida').waitFor()
  assert.equal(await newBuyer.getByText('Obligatorio').count(), 0, 'sin correo no falta nada: es opcional')
  await newBuyer.getByTestId('buyer-id').fill('1710034065')
  await newBuyer.getByTestId('save-buyer').click()
  await page.getByTestId('buyer-item').filter({ hasText: 'Juan Pérez' }).waitFor()

  // --- importar desde Facturero Móvil (archivos sintéticos con la forma de los reportes)
  await page.getByTestId('tab-import').click()
  const clients = page.getByTestId('import-buyers')
  await clients.getByTestId('import-file').setInputFiles(join(IMPORT_FIXTURES, 'clientes-pequeno.xls'))
  await clients.getByTestId('import-preview').waitFor()
  // Juan ya estaba registrado; entran dos, dos no (sin correo y correo malo) y consumidor
  // final se omite.
  assert.match(await clients.getByTestId('import-summary').innerText(), /2 nuevos, 1 ya registrados, 3 que no entran/)
  await clients.getByTestId('import-confirm').click()
  await clients.getByTestId('import-done').filter({ hasText: '2' }).waitFor()
  const goods = page.getByTestId('import-products')
  await goods.getByTestId('import-file').setInputFiles(join(IMPORT_FIXTURES, 'bienes.xls'))
  await goods.getByTestId('import-preview').waitFor()
  assert.match(await goods.getByTestId('import-summary').innerText(), /2 nuevos, 0 ya registrados, 4 que no entran/)
  await goods.getByTestId('import-confirm').click()
  await goods.getByTestId('import-done').filter({ hasText: '2' }).waitFor()
  await page.getByTestId('tab-products').click()
  await page.getByTestId('product-item').filter({ hasText: 'SRV-001' }).waitFor()
  assert.equal(await page.getByTestId('product-item').count(), 2)

  // --- pedir otro importador, con archivo: se intercepta el relevo (no sale ningún correo)
  let relayed = null
  await ctx.route('https://feedback.dotrino.com/**', async (route) => {
    const req = route.request()
    relayed = { headers: req.headers(), body: req.postDataBuffer() }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: { 'Access-Control-Allow-Origin': ORIGIN } })
  })
  await page.getByTestId('tab-import').click()
  const request = page.getByTestId('request-importer')
  await request.getByTestId('request-send').click()
  await request.getByText('Obligatorio').first().waitFor()
  const sample = join(dir, 'muestra.csv')
  await writeFile(sample, 'codigo,nombre\n1,Cliente de otro sistema\n')
  await request.getByTestId('request-text').fill('Necesito importar los clientes de mi sistema anterior')
  await request.getByTestId('request-contact').fill('yo@example.com')
  await request.getByTestId('request-file').setInputFiles(sample)
  await request.getByTestId('request-send').click()
  await request.getByTestId('request-sent').waitFor({ timeout: 20_000 })
  assert.equal(relayed.headers['content-type'], 'application/octet-stream')
  const meta = JSON.parse(Buffer.from(relayed.headers['x-dotrino-feedback'].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  assert.equal(meta.text, 'Necesito importar los clientes de mi sistema anterior')
  assert.equal(meta.contact, 'yo@example.com')
  assert.equal(meta.filename, 'muestra.csv')
  assert.equal(meta.app, 'facturero-importador')
  assert.ok(meta.signature && meta.pubkey, 'the request goes signed by the profile')
  assert.equal(relayed.body.toString('utf8'), 'codigo,nombre\n1,Cliente de otro sistema\n')
  // Un archivo que pasa del tope ni se intenta enviar.
  const big = join(dir, 'grande.pdf')
  await writeFile(big, Buffer.alloc(1024 * 1024 + 1))
  relayed = null
  await request.getByTestId('request-file').setInputFiles(big)
  await request.getByTestId('request-file-problem').filter({ hasText: '1 MB' }).waitFor()
  await request.getByTestId('request-send').click()
  assert.equal(relayed, null)

  // --- factura: con dos emisores listos, se elige
  await page.getByTestId('tab-new').click()
  const select = page.getByTestId('issuer-select')
  assert.equal(await select.inputValue(), '')
  assert.equal(await page.getByTestId('emit').isDisabled(), true)
  const dos = await select.locator('option', { hasText: 'Tienda Dos' }).getAttribute('value')
  await select.selectOption(dos)
  assert.match(await page.getByTestId('next-number').innerText(), new RegExp(`001-002-${sequential.padStart(9, '0')}`))
  await page.getByTestId('test-env').waitFor()

  // El comprador empieza en consumidor final, que solo llega a USD 50.
  assert.match(await page.getByTestId('buyer-selected').innerText(), /CONSUMIDOR FINAL/)
  await page.getByTestId('line-description').fill('Servicio de prueba')
  await page.getByTestId('line-quantity').fill('2')
  await page.getByTestId('line-unit-price').fill('50')
  await page.getByTestId('emit').click()
  await page.getByTestId('buyer-problem').filter({ hasText: 'USD 50' }).waitFor()
  await page.getByTestId('line-unit-price').fill('10')
  assert.equal(await page.getByTestId('grand-total').innerText(), '$ 23.00')

  // Se busca a Juan (registrado antes)…
  await page.getByTestId('change-buyer').click()
  // por su cédula: la identificación tiene que haberse guardado
  await page.getByTestId('buyer-search').fill('1710034065')
  assert.equal(await page.getByTestId('buyer-option').count(), 1)
  // …pero la factura va para una compradora nueva, registrada aquí mismo.
  await page.getByTestId('create-buyer').click()
  const inline = page.getByTestId('buyer-picker').getByTestId('buyer-form')
  await inline.getByTestId('buyer-id-type').selectOption('06')
  await inline.getByTestId('buyer-id').fill('PA123456')
  await inline.getByTestId('buyer-name').fill('María Visitante')
  await inline.getByTestId('buyer-email').fill('maria@example.com')
  await inline.getByTestId('save-buyer').click()
  await page.getByTestId('buyer-selected').filter({ hasText: 'María Visitante' }).waitFor()
  assert.match(await page.getByTestId('buyer-selected').innerText(), /PA123456/)

  // La línea toma un producto importado: código, código auxiliar, unidad, precio e IVA.
  await page.getByTestId('choose-product').click()
  await page.getByTestId('product-search').fill('SRV')
  await page.getByTestId('product-option').first().click()
  assert.equal(await page.getByTestId('line-description').inputValue(), 'Consultoría & soporte <remoto>')
  assert.equal(await page.getByTestId('line-unit-price').inputValue(), '133.93')
  assert.equal(await page.getByTestId('line-code').inputValue(), 'SRV-001')
  assert.match(await page.getByTestId('line-extra').innerText(), /AUX-1 · Horas/)
  // cantidad 2 → 267.86 + IVA 15% 40.18 = 308.04
  assert.equal(await page.getByTestId('grand-total').innerText(), '$ 308.04')
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
  assert.match(await detail.innerText(), /María Visitante/)
  assert.match(await detail.innerText(), /Consultoría & soporte <remoto>/)
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
  assert.match(await item.innerText(), /María Visitante/)
  await page.getByTestId('issuer-filter').waitFor()
  await page.getByTestId('tab-new').click()
  // El borrador se lee del almacén al abrir el formulario: se espera a que llegue.
  await page.waitForFunction((id) => document.querySelector('[data-testid=issuer-select]')?.value === id, dos, { timeout: 10_000 })
  // La factura siguiente vuelve a consumidor final; María queda registrada.
  assert.match(await page.getByTestId('buyer-selected').innerText(), /CONSUMIDOR FINAL/)
  await page.getByTestId('tab-buyers').click()
  await page.getByTestId('buyer-item').filter({ hasText: 'María Visitante' }).waitFor()
  // consumidor final + Juan + los dos importados + María
  assert.equal(await page.getByTestId('buyer-item').count(), 5)
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
