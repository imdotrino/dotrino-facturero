// Estado compartido de la interfaz. Los pilares (identidad, almacén) y las llaves de firma
// NO viven aquí: un Proxy reactivo de Vue rompe el postMessage de los iframes y el uso
// de una CryptoKey. Aquí solo hay datos planos.
import { reactive } from 'vue'
import { listIssuers, listBuyers, listProducts } from './lib/repo.js'
import { storedSignatures, onSignerChange } from './lib/signature.js'
import { readyIssuers } from './lib/issuers.js'
import { getStore } from './services/store.js'
import { errorText } from './i18n.js'

export const state = reactive({
  booting: true,
  bootError: null,
  issuers: [],
  signatures: [],
  buyers: [],
  products: [],
  toast: null,
})

/** Emisores con los que se puede facturar ahora mismo (datos completos y firma cargada). */
export function usableIssuers () {
  return readyIssuers(state.issuers, state.signatures)
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
  const [issuers, signatures, buyers, products] = await Promise.all([listIssuers(), storedSignatures(), listBuyers(), listProducts()])
  state.issuers = issuers
  state.signatures = signatures
  state.buyers = buyers
  state.products = products
}

onSignerChange(() => {
  storedSignatures().then((s) => { state.signatures = s }).catch((e) => toast(errorText(e), 'error'))
})

let toastTimer = null
export function toast (message, kind = 'info') {
  state.toast = { message, kind }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { state.toast = null }, kind === 'error' ? 7000 : 3000)
}
