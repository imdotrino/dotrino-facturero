// Borradores guardados, en un navegador de verdad (la identidad y el almacén son los iframes de
// producción, así que necesita red; el SRI no hace falta): guardar → aparece en Facturas →
// continuar → guardar otra vez lo actualiza en su sitio → eliminar con confirmación.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ORIGIN = 'https://facturero.dotrino.com'
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
}

const browser = await chromium.launch()
after(() => browser.close())

test('save a draft, continue it, save it again in place, delete it', { timeout: 120_000 }, async () => {
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
  await page.goto(ORIGIN + '/')
  await page.getByTestId('invoice-list').waitFor({ timeout: 30_000 })
  assert.equal(await page.getByTestId('saved-drafts').count(), 0)

  await page.getByTestId('tab-new').click()
  const save = page.getByTestId('save-draft')
  assert.equal(await save.isDisabled(), true, 'an empty form cannot be saved')
  await page.getByTestId('line-description').fill('Corte de cabello')
  await page.getByTestId('line-unit-price').fill('8')
  await save.click()

  // Vuelve a Facturas con el borrador en la lista, y el formulario queda vacío.
  const item = page.getByTestId('saved-draft')
  await item.waitFor()
  assert.equal(await item.count(), 1)
  assert.match(await item.innerText(), /\$ 9\.20/)

  await item.getByTestId('resume-draft').click()
  await page.getByTestId('from-saved-draft').waitFor()
  assert.equal(await page.getByTestId('line-description').inputValue(), 'Corte de cabello')
  await page.getByTestId('line-unit-price').fill('10')
  await page.getByTestId('save-draft').click()

  // Mismo borrador, actualizado: no uno nuevo.
  await page.getByTestId('invoice-list').waitFor()
  await page.getByText('$ 11.50').waitFor()
  assert.equal(await page.getByTestId('saved-draft').count(), 1)

  // Sobrevive a recargar la página.
  await page.reload()
  await page.getByTestId('saved-draft').waitFor({ timeout: 30_000 })

  // Continuar otro con algo a medias en el formulario no lo pierde: se guarda como borrador.
  await page.getByTestId('tab-new').click()
  await page.getByTestId('line-description').fill('A medias')
  await page.getByTestId('tab-invoices').click()
  await page.getByTestId('saved-draft').first().getByTestId('resume-draft').click()
  await page.getByTestId('from-saved-draft').waitFor()
  assert.equal(await page.getByTestId('line-description').inputValue(), 'Corte de cabello')
  await page.getByTestId('tab-invoices').click()
  await page.getByTestId('saved-draft').filter({ hasText: 'A medias' }).waitFor()
  assert.equal(await page.getByTestId('saved-draft').count(), 2)

  for (let n = 2; n > 0; n--) {
    await page.getByTestId('saved-draft').first().getByTestId('remove-draft').click()
    await page.getByTestId('remove-draft-confirm').click()
    await page.waitForFunction((want) => document.querySelectorAll('[data-testid=saved-draft]').length === want, n - 1)
  }
  assert.deepEqual(problems, [])
  await ctx.close()
})
