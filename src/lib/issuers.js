// Reglas sobre la LISTA de emisores. Sin almacén ni interfaz, para poder probarlas.

import { validateIssuer, cleanText } from '../sri/invoice.js'

/** @typedef {import('../types').Issuer} Issuer */
/** @typedef {import('../types').IssuerData} IssuerData */
/** @typedef {import('../types').Problem} Problem */

/** Nombre corto de un emisor para listas y selectores. */
/** @param {IssuerData} issuer */
export function issuerName (issuer) {
  return cleanText(issuer.tradeName) || cleanText(issuer.legalName) || issuer.ruc || '—'
}

/** El número que llevará su próxima factura: `001-001-000000123`. */
/** @param {IssuerData} issuer */
export function nextNumber (issuer) {
  return `${issuer.establishment}-${issuer.emissionPoint}-${String(issuer.nextSequential).padStart(9, '0')}`
}

/**
 * Dos emisores con el mismo RUC, serie y ambiente comparten numeración: cada uno llevaría
 * su propio contador y el SRI rechazaría la segunda factura con el mismo número (45).
 */
/**
 * @param {IssuerData} a
 * @param {IssuerData} b
 */
export function sameSeries (a, b) {
  return a.ruc === b.ruc && a.establishment === b.establishment &&
    a.emissionPoint === b.emissionPoint && a.environment === b.environment
}

/** Los datos del emisor y que no repita la serie de otro. `[{ path, code }]`. */
/**
 * @param {IssuerData & { id?: string }} issuer
 * @param {Issuer[]} [issuers]
 * @returns {Problem[]}
 */
export function issuerDataProblems (issuer, issuers = []) {
  /** @type {Problem[]} */
  const problems = []
  /** @type {import('../types').AddProblem} */
  const add = (path, code) => { problems.push({ path, code }) }
  validateIssuer({ ...issuer, nextSequential: Number(issuer.nextSequential) }, add)
  if (issuers.some((other) => other.id !== issuer.id && sameSeries(other, issuer))) add('issuer.establishment', 'duplicate-series')
  return problems
}

/**
 * Lo que impide facturar con un emisor: sus datos, la serie, y que tenga su firma cargada.
 * `signatures` son las firmas guardadas, cada una con su `issuerId`.
 */
/**
 * @param {Issuer} issuer
 * @param {{ issuers?: Issuer[], signatures?: Array<{ issuerId: string }> }} [lists]
 * @returns {Problem[]}
 */
export function issuerProblems (issuer, { issuers = [], signatures = [] } = {}) {
  const problems = issuerDataProblems(issuer, issuers)
  if (!signatures.some((s) => s.issuerId === issuer.id)) problems.push({ path: 'issuer.signature', code: 'required' })
  return problems
}

/** Emisores con los que se puede facturar ahora mismo. */
/**
 * @param {Issuer[]} issuers
 * @param {Array<{ issuerId: string }>} signatures
 */
export function readyIssuers (issuers, signatures) {
  return issuers.filter((i) => issuerProblems(i, { issuers, signatures }).length === 0)
}
