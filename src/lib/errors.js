/** @typedef {import('../types').CodedError} CodedError */

/**
 * Un error con `code`: quien lo recibe decide por el código, no por la frase.
 * `extra` añade campos (p. ej. `problems`); `extra.cause` va como causa del Error.
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 * @returns {CodedError}
 */
export function codeError (code, message, extra) {
  const { cause, ...rest } = extra || {}
  /** @type {CodedError} */
  const e = new Error(message, cause !== undefined ? { cause } : undefined)
  e.code = code
  return Object.assign(e, rest)
}

/**
 * El `code` de algo lanzado (un `catch` recibe `unknown`), o `undefined` si no trae.
 * @param {unknown} e
 * @returns {string | undefined}
 */
export function codeOf (e) {
  const c = e && typeof e === 'object' && 'code' in e ? e.code : undefined
  return typeof c === 'string' ? c : undefined
}

/**
 * Lo que se cuenta de algo lanzado: su `message`, o el valor tal cual si no lo trae
 * (lo mismo que `${e?.message || e}`).
 * @param {unknown} e
 */
export function messageOf (e) {
  const m = e && typeof e === 'object' && 'message' in e ? e.message : undefined
  return String(m || e)
}
