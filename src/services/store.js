// Almacén del usuario (@dotrino/store, obligatorio §4), separado por PERFIL.
//
// El store es un singleton del módulo: el primero que lo conecta decide si va con
// identidad. La moneda de support del topbar lo conecta SIN identidad para contar la
// apertura, y si gana esa carrera todo lo de esta app caería en el espacio común, sin
// perfil. Por eso el topbar va con `support-no-count`, la apertura se registra aquí, y
// antes de devolver el store se comprueba que quedó en el perfil activo.
import { Store } from '@dotrino/store'
import { getIdentity } from './identity.js'

const APP_ID = 'facturero.dotrino.com'

let connecting = null

export function getStore () {
  if (!connecting) {
    connecting = connect().catch((e) => {
      connecting = null
      throw e
    })
  }
  return connecting
}

async function connect () {
  const identity = await getIdentity()
  let store
  try {
    store = await Store.connect({ identity })
  } catch (e) {
    const err = new Error(`store unreachable: ${e?.message || e}`, { cause: e })
    err.code = 'store-unreachable'
    throw err
  }
  const profile = await identity.currentProfile()
  if (!profile?.id || store._profileId !== profile.id) {
    const err = new Error(`the store is not bound to the active profile (store: ${store._profileId}, profile: ${profile?.id})`)
    err.code = 'store-profile-mismatch'
    throw err
  }
  // Los hilos de facturas son por día (ver repo.js); el tope por hilo se sube por si un
  // día de mucho movimiento pasa de las 1000 del valor por defecto.
  await store.setMaxPerThread(50000)
  store.recordOpen(APP_ID).catch((e) => console.error('[facturero] recordOpen:', e))
  return store
}
