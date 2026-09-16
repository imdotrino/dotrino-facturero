// Almacén del usuario (@dotrino/store, obligatorio §4), separado por PERFIL.
//
// El store es un singleton del módulo. Hasta @dotrino/store 0.9.0, si la moneda de support
// lo abría primero SIN identidad, `connect({ identity })` devolvía ese mismo almacén sin
// perfil y todo lo de esta app caía en el espacio común. Desde 0.10.0 el almacén adopta
// la identidad; aun así se comprueba que quedó en el perfil activo antes de usarlo, porque
// con facturas de por medio mezclar dos negocios no es un fallo que se pueda notar tarde.
import { Store } from '@dotrino/store'
import { getIdentity } from './identity.js'

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
    // «Sin perfil» u «otro perfil» no son «no contesta»: se arreglan distinto, y el
    // código no se pierde al envolver.
    if (e?.code === 'store-no-profile' || e?.code === 'store-identity-mismatch') throw e
    const err = new Error(`store unreachable: ${e?.message || e}`, { cause: e })
    err.code = 'store-unreachable'
    throw err
  }
  const profile = await identity.currentProfile()
  if (!profile?.id || store.profileId !== profile.id) {
    const err = new Error(`the store is not bound to the active profile (store: ${store.profileId}, profile: ${profile?.id})`)
    err.code = 'store-profile-mismatch'
    throw err
  }
  // Los hilos de facturas son por día (ver repo.js); el tope por hilo se sube por si un
  // día de mucho movimiento pasa de las 1000 del valor por defecto.
  await store.setMaxPerThread(50000)
  return store
}
