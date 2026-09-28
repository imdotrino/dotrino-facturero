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

/**
 * «Copiar como nueva»: el borrador de una factura ya emitida, para emitir otra igual. Una
 * enviada no se toca; esto solo trae sus datos al formulario, sin número ni fecha.
 *
 * El comprador se busca por su clave y, si ya no está (se borró o la factura es de antes de
 * guardarla), por su identificación. Si no aparece, queda sin elegir y el formulario lo pide:
 * caer en consumidor final sería facturarle a otro.
 */
export function draftFromInvoice (invoice, buyers) {
  const d = invoice.draft
  const snapshot = d.buyer || {}
  let buyerKey = ''
  if (snapshot.idType === '07') buyerKey = FINAL_CONSUMER_KEY
  else if (d.buyerKey && buyers.some((b) => b.key === d.buyerKey)) buyerKey = d.buyerKey
  else buyerKey = buyers.find((b) => b.idType === snapshot.idType && b.id === snapshot.id)?.key || ''
  return JSON.parse(JSON.stringify({
    issuerId: invoice.issuerId,
    buyerKey,
    lines: d.lines,
    payments: d.payments,
    tip: d.tip ?? '0',
  }))
}

/** Lo que se guarda: el borrador sin el marcador de a qué guardado pertenece. */
export function toSaved (draft) {
  const { savedKey, ...rest } = JSON.parse(JSON.stringify(draft))
  return rest
}
