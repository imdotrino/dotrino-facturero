// Estado compartido de la interfaz. Los pilares (identidad, almacén) y la llave de firma
// NO viven aquí: un Proxy reactivo de Vue rompe el postMessage de los iframes y el uso
// de una CryptoKey. Aquí solo hay datos planos.
import { reactive } from 'vue'
import { loadIssuer } from './lib/repo.js'
import { storedSignature, onSignerChange } from './lib/signature.js'
import { validate } from './sri/invoice.js'
import { getStore } from './services/store.js'
import { errorText } from './i18n.js'

export const state = reactive({
  booting: true,
  bootError: null,
  issuer: null,
  signature: null,
  toast: null,
})

export function issuerReady () {
  if (!state.issuer) return false
  const problems = []
  // Solo los problemas del emisor: el borrador va aparte.
  validate({ buyer: {}, lines: [], payments: [] }, state.issuer).forEach((p) => { if (p.path.startsWith('issuer')) problems.push(p) })
  return problems.length === 0
}

export async function boot () {
  state.booting = true
  state.bootError = null
  try {
    await getStore()
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] boot:', e)
    state.bootError = e
  } finally {
    state.booting = false
  }
}

export async function refreshSettings () {
  state.issuer = await loadIssuer()
  state.signature = await storedSignature()
}

onSignerChange(() => {
  storedSignature().then((s) => { state.signature = s }).catch((e) => toast(errorText(e), 'error'))
})

let toastTimer = null
export function toast (message, kind = 'info') {
  state.toast = { message, kind }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { state.toast = null }, kind === 'error' ? 7000 : 3000)
}
