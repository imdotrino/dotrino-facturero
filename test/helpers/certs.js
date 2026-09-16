// Certificados de prueba generados con openssl en cada ejecución. Ningún .p12 vive en
// el repo: ni los de prueba (el .gitignore los rechaza).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (cwd, args) => execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Crea una CA y hasta dos certificados finales firmados por ella.
 * @param {object} o
 * @param {string} [o.issuerSubject]  sujeto de la CA (formato openssl, `/C=EC/O=…`)
 * @param {Array<{ name: string, keyUsage: string, days?: number, startDaysAgo?: number }>} o.leaves
 */
export function makePki ({ issuerSubject = '/C=EC/O=ENTIDAD DE PRUEBA\\, S.A./OU=CERTIFICACION/CN=AC DE PRUEBA/emailAddress=ca@example.com', leaves }) {
  const dir = mkdtempSync(join(tmpdir(), 'facturero-pki-'))
  run(dir, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '3650',
    '-subj', issuerSubject, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
  leaves.forEach((leaf, i) => {
    writeFileSync(join(dir, `leaf${i}.cnf`), `basicConstraints=CA:FALSE\nkeyUsage=critical,${leaf.keyUsage}\n`)
    run(dir, ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `leaf${i}.key`, '-out', `leaf${i}.csr`,
      '-subj', `/C=EC/serialNumber=1712345678/CN=${leaf.name}`])
    run(dir, ['x509', '-req', '-in', `leaf${i}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', `leaf${i}.pem`, '-days', String(leaf.days ?? 365), '-extfile', `leaf${i}.cnf`, '-set_serial', '0x' + 'A1B2C3D4E5F607182930415263748596071829' + String(i).padStart(2, '0')])
  })
  return {
    dir,
    /**
     * openssl solo mete UNA llave por .p12; los casos de varias llaves se prueban
     * directamente sobre `selectSigningPair`.
     * @param {object} o
     * @param {number} o.key        índice de la llave
     * @param {number[]} o.certs    índices de los certificados finales a incluir (más la CA)
     * @param {string} o.password
     * @param {boolean} [o.legacy]  3DES + RC2-40 (como los .p12 viejos)
     */
    p12 ({ key, certs, password, legacy = false }) {
      const certPem = certs.map((c) => readFileSync(join(dir, `leaf${c}.pem`), 'utf8')).join('') + readFileSync(join(dir, 'ca.pem'), 'utf8')
      writeFileSync(join(dir, 'in.pem'), readFileSync(join(dir, `leaf${key}.key`), 'utf8') + certPem)
      const out = `out-${Date.now()}-${Math.random().toString(36).slice(2)}.p12`
      const args = ['pkcs12', '-export', '-in', 'in.pem', '-out', out, '-passout', `pass:${password}`]
      if (legacy) args.push('-legacy')
      run(dir, args)
      return new Uint8Array(readFileSync(join(dir, out)))
    },
    certPem: (i) => readFileSync(join(dir, `leaf${i}.pem`), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}
