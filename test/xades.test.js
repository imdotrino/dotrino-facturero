// La firma se comprueba con herramientas que NO comparten código con src/sri/xades.js:
// xml-crypto (canonicalización y verificación XMLDSig) y node:crypto. Si el formato
// canónico que escribimos a mano se desvía de C14N, los digests dejan de coincidir aquí.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import forge from 'node-forge'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml, C14nCanonicalization } from 'xml-crypto'
import { openP12, selectSigningPair, issuerRfc2253 } from '../src/sri/p12.js'
import { signDocument, signingTime, NS_DS } from '../src/sri/xades.js'
import { buildInvoiceXml } from '../src/sri/xml.js'
import { buildAccessKey } from '../src/sri/accessKey.js'
import { issuer, draft } from './fixtures/drafts.js'
import { makePki } from './helpers/certs.js'
import { xsdValidate } from './helpers/xsd.js'

const pki = makePki({
  leaves: [
    { name: 'JUAN PEREZ FIRMA', keyUsage: 'digitalSignature,nonRepudiation' },
    { name: 'JUAN PEREZ CIFRADO', keyUsage: 'keyEncipherment,dataEncipherment' },
    { name: 'OTRA FIRMA', keyUsage: 'digitalSignature' },
  ],
})
after(() => pki.cleanup())

function invoiceRoot () {
  const accessKey = buildAccessKey({ date: '16/09/2026', docType: '01', ruc: issuer.ruc, environment: '1', establishment: '001', emissionPoint: '001', sequential: 123, numericCode: '12345678' })
  return buildInvoiceXml({ issuer, draft, accessKey, sequential: '000000123', issueDate: '16/09/2026' })
}

function verifyIndependently (signedXml, certPem) {
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml')
  const signature = doc.getElementsByTagNameNS(NS_DS, 'Signature')[0]
  const sig = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null })
  sig.loadSignature(signature)
  const ok = sig.checkSignature(signedXml)
  return { ok, references: sig.getReferences?.() }
}

for (const legacy of [false, true]) {
  test(`signs an invoice that verifies independently (${legacy ? 'legacy 3DES/RC2' : 'AES/PBES2'} .p12)`, async () => {
    const bytes = pki.p12({ key: 0, certs: [0], password: 'clave ñ 123', legacy })
    const { signer, info } = await openP12(bytes, 'clave ñ 123')
    assert.equal(info.holder, 'JUAN PEREZ FIRMA')

    const signed = await signDocument(invoiceRoot(), signer)
    const { ok } = verifyIndependently(signed, pki.certPem(0))
    assert.equal(ok, true, 'xml-crypto rejected the signature')

    // El documento firmado sigue cumpliendo el XSD (que admite ds:Signature).
    const r = xsdValidate(signed)
    assert.equal(r.ok, true, r.output)
  })
}

test('digests of the fragments include their inherited namespaces', async () => {
  const bytes = pki.p12({ key: 0, certs: [0], password: 'x' })
  const { signer } = await openP12(bytes, 'x')
  const signed = await signDocument(invoiceRoot(), signer)
  const doc = new DOMParser().parseFromString(signed, 'text/xml')
  const c14n = new C14nCanonicalization()
  const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('base64')
  const byId = (id) => [...doc.getElementsByTagName('*')].find((n) => n.getAttribute('Id') === id)
  const refs = [...doc.getElementsByTagNameNS(NS_DS, 'Reference')]
  assert.equal(refs.length, 3)
  for (const ref of refs.slice(1)) {
    const node = byId(ref.getAttribute('URI').slice(1))
    const ancestorNamespaces = []
    for (let p = node.parentNode; p && p.attributes; p = p.parentNode) {
      for (const a of [...p.attributes]) {
        if (a.name.startsWith('xmlns:')) ancestorNamespaces.push({ prefix: a.name.slice(6), namespaceURI: a.value })
      }
    }
    const canon = c14n.process(node, { ancestorNamespaces })
    const expected = ref.getElementsByTagNameNS(NS_DS, 'DigestValue')[0].textContent
    assert.equal(sha1(canon), expected, `digest of ${ref.getAttribute('URI')}`)
  }

  // RSA-SHA1 sobre SignedInfo canónico, con node:crypto.
  const signedInfo = doc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0]
  const canonSI = c14n.process(signedInfo, { ancestorNamespaces: [{ prefix: 'ds', namespaceURI: NS_DS }] })
  const value = doc.getElementsByTagNameNS(NS_DS, 'SignatureValue')[0].textContent
  assert.equal(crypto.verify('sha1', Buffer.from(canonSI, 'utf8'), pki.certPem(0), Buffer.from(value, 'base64')), true)
})

test('certificate data in the signature: serial in decimal, issuer in RFC 2253', async () => {
  const bytes = pki.p12({ key: 0, certs: [0], password: 'x' })
  const { signer } = await openP12(bytes, 'x')
  const x509 = new crypto.X509Certificate(pki.certPem(0))
  assert.equal(signer.serialNumber, BigInt('0x' + x509.serialNumber).toString())
  assert.ok(signer.serialNumber.length > 40, '20-byte serials must not lose precision')
  assert.equal(signer.issuerName, 'EMAILADDRESS=ca@example.com,CN=AC DE PRUEBA,OU=CERTIFICACION,O=ENTIDAD DE PRUEBA\\, S.A.,C=EC')
  assert.equal(signer.certificateSha1, crypto.createHash('sha1').update(x509.raw).digest('base64'))
  assert.equal(Buffer.from(signer.modulus, 'base64')[0] !== 0, true)
  assert.equal(signer.exponent, 'AQAB')
})

test('the signing key is chosen by usage, never by position', () => {
  const load = (i) => ({
    key: forge.pki.privateKeyFromPem(require('node:fs').readFileSync(`${pki.dir}/leaf${i}.key`, 'utf8')),
    cert: forge.pki.certificateFromPem(pki.certPem(i)),
  })
  const firma = load(0)
  const cifrado = load(1)
  const otra = load(2)
  const ca = forge.pki.certificateFromPem(require('node:fs').readFileSync(`${pki.dir}/ca.pem`, 'utf8'))
  const now = new Date()

  // Como el .p12 del Banco Central: la llave de cifrado y su certificado van PRIMERO.
  const bce = selectSigningPair({
    keyBags: [{ key: cifrado.key }, { key: firma.key }],
    certBags: [{ cert: cifrado.cert }, { cert: firma.cert }, { cert: ca }],
  }, now)
  assert.equal(bce.cert.subject.getField('CN').value, 'JUAN PEREZ FIRMA')

  // Dos llaves de firma sin nombre: no se elige una al azar.
  assert.throws(() => selectSigningPair({
    keyBags: [{ key: firma.key }, { key: otra.key }],
    certBags: [{ cert: firma.cert }, { cert: otra.cert }],
  }, now), { code: 'ambiguous-p12' })

  // …pero si una se llama «Signing Key», esa.
  const named = selectSigningPair({
    keyBags: [{ key: otra.key, attributes: { friendlyName: ['Decryption Key'] } }, { key: firma.key, attributes: { friendlyName: ['Signing Key'] } }],
    certBags: [{ cert: firma.cert }, { cert: otra.cert }],
  }, now)
  assert.equal(named.cert.subject.getField('CN').value, 'JUAN PEREZ FIRMA')

  // Una llave sin su certificado no sirve.
  assert.throws(() => selectSigningPair({ keyBags: [{ key: firma.key }], certBags: [{ cert: otra.cert }] }, now), { code: 'no-matching-pair' })
})

test('wrong password and expired certificate stop with a code', async () => {
  const bytes = pki.p12({ key: 0, certs: [0], password: 'buena' })
  await assert.rejects(openP12(bytes, 'mala'), { code: 'bad-password' })
  await assert.rejects(openP12(bytes, 'buena', { now: new Date(Date.now() + 400 * 86400_000) }), { code: 'certificate-expired' })
  await assert.rejects(openP12(new Uint8Array([1, 2, 3]), 'x'), { code: 'bad-p12' })
})

test('a change after signing breaks the verification', async () => {
  const bytes = pki.p12({ key: 0, certs: [0], password: 'x' })
  const { signer } = await openP12(bytes, 'x')
  const signed = await signDocument(invoiceRoot(), signer)
  const tampered = signed.replace('<importeTotal>30.35</importeTotal>', '<importeTotal>3.35</importeTotal>')
  assert.notEqual(tampered, signed)
  let ok
  try { ok = verifyIndependently(tampered, pki.certPem(0)).ok } catch { ok = false }
  assert.equal(ok, false)
  // Y firmado con otra llave tampoco pasa por el certificado de la primera.
  const other = await openP12(pki.p12({ key: 2, certs: [2], password: 'x' }), 'x')
  const signedByOther = await signDocument(invoiceRoot(), other.signer)
  try { ok = verifyIndependently(signedByOther, pki.certPem(0)).ok } catch { ok = false }
  assert.equal(ok, false)
})

test('the schema check is not vacuous', () => {
  const broken = '<?xml version="1.0" encoding="UTF-8"?>' + invoiceRoot().replace('<codDoc>01</codDoc>', '')
  assert.equal(xsdValidate(broken).ok, false)
})

test('signing time carries the local offset', () => {
  assert.match(signingTime(new Date()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
})

function require (m) {
  return process.getBuiltinModule(m)
}
