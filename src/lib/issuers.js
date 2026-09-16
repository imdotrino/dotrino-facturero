// Reglas sobre la LISTA de emisores. Sin almacén ni interfaz, para poder probarlas.

import { validateIssuer, cleanText } from '../sri/invoice.js'

/** Nombre corto de un emisor para listas y selectores. */
export function issuerName (issuer) {
  return cleanText(issuer.tradeName) || cleanText(issuer.legalName) || issuer.ruc || '—'
}

/**
 * Dos emisores con el mismo RUC, serie y ambiente comparten numeración: cada uno llevaría
 * su propio contador y el SRI rechazaría la segunda factura con el mismo número (45).
 */
export function sameSeries (a, b) {
  return a.ruc === b.ruc && a.establishment === b.establishment &&
    a.emissionPoint === b.emissionPoint && a.environment === b.environment
}

/**
 * Lo que impide usar un emisor para facturar: sus datos, la firma que tiene asignada y que
 * no repita la serie de otro. `[{ path, code }]`.
 */
export function issuerProblems (issuer, { issuers = [], signatures = [] } = {}) {
  const problems = []
  const add = (path, code) => problems.push({ path, code })
  validateIssuer({ ...issuer, nextSequential: Number(issuer.nextSequential) }, add)
  if (!issuer.signature) add('issuer.signature', 'required')
  else if (!signatures.some((s) => s.fingerprint === issuer.signature)) add('issuer.signature', 'signature-missing')
  if (issuers.some((other) => other.id !== issuer.id && sameSeries(other, issuer))) add('issuer.establishment', 'duplicate-series')
  return problems
}

/** Emisores con los que se puede facturar ahora mismo. */
export function readyIssuers (issuers, signatures) {
  return issuers.filter((i) => issuerProblems(i, { issuers, signatures }).length === 0)
}
