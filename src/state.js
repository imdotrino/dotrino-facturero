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
  // Respaldo del almacén en la bóveda (`store.vault` de @dotrino/store). Se lee y se escribe
  // siempre en el navegador; esto dice si además está a salvo en la bóveda, y si no, por qué.
  backup: null,
  // Sube cuando llegan facturas de la bóveda: la lista la mira para recargarse.
  invoicesVersion: 0,
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
    const store = await getStore()
    watchBackup(store)
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] boot:', e)
    state.bootError = e
  } finally {
    state.booting = false
  }
}

let watching = false

function watchBackup (store) {
  state.backup = store.vault
  if (watching) return
  watching = true
  store.on('vault', (status) => {
    state.backup = status
    if (status.state !== 'synced' || status.changed.length === 0) return
    // Lo que llegó de otro aparato: se recarga lo que cambió, no la app entera.
    const mine = status.changed.filter((k) => k.startsWith('facturero.'))
    if (mine.some((k) => k.startsWith('facturero.invoices.'))) state.invoicesVersion++
    if (mine.some((k) => !k.startsWith('facturero.invoices.'))) {
      refreshSettings().catch((e) => {
        console.error('[facturero] refresh after vault sync:', e)
        toast(errorText(e), 'error')
      })
    }
  })
}

/** «Sincronizar ahora». Lanza con el código del almacén si no se pudo. */
export async function syncBackup () {
  const store = await getStore()
  state.backup = await store.vaultSync()
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
