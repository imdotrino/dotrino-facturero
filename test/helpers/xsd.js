import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const XSD = new URL('../fixtures/xsd/factura_V1.1.0.xsd', import.meta.url).pathname

/** Valida contra el XSD oficial del SRI con xmllint, sin red. */
export function xsdValidate (xml) {
  const dir = mkdtempSync(join(tmpdir(), 'facturero-xsd-'))
  const file = join(dir, 'doc.xml')
  writeFileSync(file, xml)
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, file], { stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true }
  } catch (e) {
    return { ok: false, output: String(e.stderr) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
