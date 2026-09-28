// Borradores guardados: facturas a medio hacer que el usuario aparta para terminarlas luego.
//
// Distinto del borrador de trabajo (`draft` en facturero.settings), que es el formulario tal
// como quedó y se autoguarda. Un borrador de trabajo que se abrió desde uno guardado lleva
// `savedKey`: guardar otra vez lo actualiza en su sitio, y emitirlo lo quita de la lista.

import { FINAL_CONSUMER_KEY } from './buyers.js'

/** Un borrador sin nada escrito: consumidor final y líneas vacías. Guardarlo no sirve de nada. */
export function isBlankDraft (draft) {
  if (!draft) return true
  if (draft.buyerKey && draft.buyerKey !== FINAL_CONSUMER_KEY) return false
  return (draft.lines || []).every((l) => !['code', 'auxCode', 'description', 'unitPrice', 'discount'].some((k) => String(l[k] ?? '').trim()))
}

/** Lo que se guarda: el borrador sin el marcador de a qué guardado pertenece. */
export function toSaved (draft) {
  const { savedKey, ...rest } = JSON.parse(JSON.stringify(draft))
  return rest
}
