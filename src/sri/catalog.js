// Tablas de la ficha técnica de comprobantes electrónicos (esquema offline, v2.34).
// Los textos que ve el usuario viven en i18n; aquí solo los códigos.

/** Tabla 17: tarifas de IVA (`codigoPorcentaje`). `rate` en porcentaje. */
export const VAT_RATES = Object.freeze([
  { code: '4', rate: '15', key: 'vat15' },
  { code: '5', rate: '5', key: 'vat5' },
  { code: '0', rate: '0', key: 'vat0' },
  { code: '6', rate: '0', key: 'vatNotSubject' },
  { code: '7', rate: '0', key: 'vatExempt' },
  { code: '10', rate: '13', key: 'vat13' },
  { code: '8', rate: '8', key: 'vatDifferentiated' },
  // Solo para leer comprobantes históricos: el IVA general es 15% desde abril de 2024.
  { code: '2', rate: '12', key: 'vat12', historic: true },
  { code: '3', rate: '14', key: 'vat14', historic: true },
])

export const DEFAULT_VAT_CODE = '4'

/** Tabla 16: impuestos. */
export const TAX_VAT = '2'

/** Tabla 6: tipo de identificación del comprador. */
export const BUYER_ID_TYPES = Object.freeze([
  { code: '05', key: 'idCedula' },
  { code: '04', key: 'idRuc' },
  { code: '06', key: 'idPassport' },
  { code: '07', key: 'idFinalConsumer' },
  { code: '08', key: 'idForeign' },
])

export const FINAL_CONSUMER_ID = '9999999999999'
export const FINAL_CONSUMER_NAME = 'CONSUMIDOR FINAL'
/** Monto máximo de una factura a consumidor final (Decreto 586, desde el 10/11/2022). */
export const FINAL_CONSUMER_MAX = '50.00'

/** Tabla 24: formas de pago. */
export const PAYMENT_METHODS = Object.freeze([
  { code: '01', key: 'payCash' },
  { code: '16', key: 'payDebit' },
  { code: '19', key: 'payCredit' },
  { code: '20', key: 'payOtherFinancial' },
  { code: '17', key: 'payElectronicMoney' },
  { code: '18', key: 'payPrepaid' },
  { code: '15', key: 'payCompensation' },
  { code: '21', key: 'payEndorsement' },
])

/** Anexo 22: leyendas RIMPE. */
export const RIMPE_LEGENDS = Object.freeze({
  entrepreneur: 'CONTRIBUYENTE RÉGIMEN RIMPE',
  popular: 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE',
})

export function vatRate (code) {
  const r = VAT_RATES.find((v) => v.code === code)
  if (!r) throw codeError('unknown-vat-code', `unknown VAT percentage code: ${code}`)
  return r
}

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
