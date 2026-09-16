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

/** Los datos del emisor y que no repita la serie de otro. `[{ path, code }]`. */
export function issuerDataProblems (issuer, issuers = []) {
  const problems = []
  const add = (path, code) => problems.push({ path, code })
  validateIssuer({ ...issuer, nextSequential: Number(issuer.nextSequential) }, add)
  if (issuers.some((other) => other.id !== issuer.id && sameSeries(other, issuer))) add('issuer.establishment', 'duplicate-series')
  return problems
}

/**
 * Lo que impide facturar con un emisor: sus datos, la serie, y que tenga su firma cargada.
 * `signatures` son las firmas guardadas, cada una con su `issuerId`.
 */
export function issuerProblems (issuer, { issuers = [], signatures = [] } = {}) {
  const problems = issuerDataProblems(issuer, issuers)
  if (!signatures.some((s) => s.issuerId === issuer.id)) problems.push({ path: 'issuer.signature', code: 'required' })
  return problems
}

/** Emisores con los que se puede facturar ahora mismo. */
export function readyIssuers (issuers, signatures) {
  return issuers.filter((i) => issuerProblems(i, { issuers, signatures }).length === 0)
}
