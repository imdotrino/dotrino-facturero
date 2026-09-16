// Identidad = vault id.dotrino.com (@dotrino/identity), única fuente de identidad del
// ecosistema. Aquí es imprescindible, no un adorno: la firma electrónica se guarda
// sellada con la llave de este perfil y el almacén se separa por perfil (dos negocios
// en el mismo aparato no mezclan sus facturas). Sin identidad no se sigue.
import { Identity } from '@dotrino/identity'

let connecting = null

export function getIdentity () {
  if (!connecting) {
    connecting = Identity.connect().catch((e) => {
      connecting = null
      const err = new Error(`identity vault unreachable: ${e?.message || e}`, { cause: e })
      err.code = 'identity-unreachable'
      throw err
    })
  }
  return connecting
}
