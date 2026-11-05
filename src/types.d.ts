// Las formas de datos de facturero: lo que se guarda en el almacén (ver lib/repo.js), lo
// que se escribe en el formulario y lo que contesta el SRI. Solo tipos: en ejecución no
// existe; el código lo usa por JSDoc (`import('../types').Issuer`).

/** Un problema de validación: en qué campo y qué le pasa. */
export interface Problem { path: string; code: string }
/** Cómo se apunta un problema mientras se valida. */
export type AddProblem = (path: string, code: string) => void

/** Un error de la app o de un pilar: se decide por `code`, no por la frase. */
export interface CodedError extends Error {
  code?: string
  problems?: Problem[]
  issuerId?: string
}

/** Los datos de un emisor (un RUC con su serie). */
export interface IssuerData {
  ruc: string
  legalName: string
  tradeName: string
  matrixAddress: string
  establishmentAddress: string
  establishment: string
  emissionPoint: string
  /** Número; el formulario lo puede dejar como texto. */
  nextSequential: number | string
  keepsAccounting: boolean
  specialTaxpayer: string
  withholdingAgent: string
  /** '' o una clave de RIMPE_LEGENDS ('entrepreneur' | 'popular'). */
  rimpe: string
  /** '1' pruebas, '2' producción. */
  environment: string
}
export interface Issuer extends IssuerData { id: string }

/** Lo que se sabe de un certificado de firma, sin la llave (ver sri/p12.js). */
export interface CertificateInfo {
  /** CN del titular. */
  holder: string
  /** Organización o CN del emisor. */
  issuer: string
  /** ISO. */
  validFrom: string
  validTo: string
  /** RUC que viaja en el certificado, si trae uno. Solo para mostrarlo. */
  ruc: string | null
  /** SHA-1 del certificado (base64). */
  fingerprint: string
}

/** El firmador ya abierto (ver sri/xades.js). */
export interface Signer {
  /** RSASSA-PKCS1-v1_5 con SHA-1, no extraíble. */
  privateKey: CryptoKey
  /** DER del certificado en base64. */
  certificate: string
  certificateSha1: string
  /** Emisor del certificado en RFC 2253. */
  issuerName: string
  /** Número de serie en decimal. */
  serialNumber: string
  modulus: string
  exponent: string
}

/** El sobre de la firma tal como está en el almacén (sellado con la llave de la cuenta). */
export interface SignatureRecord {
  id: string
  ts: number
  issuerId: string
  envelope: { t: 'dotrino-cek'; gen: number; iv: string; ct: string }
  seal: string
  info: CertificateInfo
  fileName: string
}

/** Lo que la interfaz sabe de cada firma guardada. */
export interface StoredSignature {
  issuerId: string
  info: CertificateInfo
  fileName: string
  savedAt: number
  unlocked: boolean
}

export interface Logo { dataUrl: string; width: number; height: number }
export interface IssuerLogo extends Logo { issuerId: string }

/** Un comprador. `key` es la clave del registro; `id`, su identificación. */
export interface Buyer {
  key?: string
  idType: string
  id: string
  name: string
  email: string
  phone: string
  address: string
}

/** Un comprador ya registrado: siempre con su clave. */
export type StoredBuyer = Buyer & { key: string }

/** Un producto o servicio registrado. */
export interface Product {
  key?: string
  code: string
  auxCode: string
  description: string
  unit: string
  unitPrice: string
  vatCode: string
}

/** Un producto ya registrado: siempre con su clave. */
export type StoredProduct = Product & { key: string }

/** Una línea del formulario: textos tal como se escribieron. */
export interface DraftLine {
  productKey?: string
  code: string
  auxCode: string
  description: string
  unit: string
  quantity: string | number
  unitPrice: string | number
  discount: string | number
  vatCode: string
}

export interface Payment { method: string }

/** La factura a medio escribir. */
export interface Draft {
  issuerId: string
  buyerKey: string
  lines: DraftLine[]
  payments: Payment[]
  tip: string | number
  /** Si viene de un borrador guardado, su clave. */
  savedKey?: string
  /** Los datos del comprador copiados al emitir (sin `key`). */
  buyer?: Partial<Buyer>
}

/** El borrador con el comprador ya resuelto: lo que se valida, se calcula y se firma. */
export type DraftWithBuyer = Draft & { buyer: Partial<Buyer> }

/** Un borrador guardado aparte. */
export interface SavedDraft { key: string; savedAt: number; draft: Draft }

export interface ComputedLine {
  code: string
  auxCode: string
  description: string
  unit: string
  quantity: string
  unitPrice: string
  discount: string
  subtotal: string
  vat: { code: string; rate: string; base: string; value: string }
}
export interface ComputedTax { code: string; rate: string; base: string; value: string }
/** Líneas y totales ya calculados, en texto con sus decimales. */
export interface Totals {
  lines: ComputedLine[]
  taxes: ComputedTax[]
  totalWithoutTaxes: string
  totalDiscount: string
  vatTotal: string
  tip: string
  total: string
}

/** Un mensaje del SRI. */
export interface SriMessage { id: string; message: string; info: string; type: string }

export interface Authorization {
  state: string
  number: string
  date: string
  environment: string
  document: string
  messages: SriMessage[]
}

export type InvoiceStatus = 'signed' | 'returned' | 'received' | 'authorized' | 'rejected'

export interface HistoryStep { at: number; step: 'reception' | 'authorization'; state: string; messages: SriMessage[] }

/** Una factura emitida, tal como se guarda (id = clave de acceso). */
export interface Invoice {
  id?: string
  ts?: number
  accessKey: string
  /** aaaa-mm-dd: el hilo del almacén donde vive. */
  day: string
  /** dd/mm/aaaa. */
  issueDate: string
  sequential: string
  number: string
  environment: string
  createdAt: number
  issuerId: string
  /** Copia del emisor tal como estaba al emitirla. */
  issuer: Issuer
  /** El borrador tal como se emitió, con el comprador copiado. */
  draft: DraftWithBuyer
  totals: Totals
  status: InvoiceStatus
  messages: SriMessage[]
  history: HistoryStep[]
  signedXmlGz?: string
  authorizedXmlGz?: string
  authorization?: { number: string; date: string; environment: string }
  lastError?: { code: string; message: string; at: number } | null
  lastCheckAt?: number
}

/** Qué pasa con una fila al importar. */
export type ImportStatus = 'new' | 'exists' | 'invalid' | 'skip'
/** Una fila de un reporte importado, ya convertida. */
interface ImportedRow {
  row: number
  status: ImportStatus
  problems: Problem[]
  /** Lo que se cambió para que la fila entre (hoy, solo en compradores). */
  notes?: Problem[]
}
export interface ImportedBuyer extends ImportedRow { buyer: Buyer; notes: Problem[] }
export interface ImportedProduct extends ImportedRow { product: Product }

/** Un árbol de textos de i18n: hojas de texto, ramas, o `null` mientras se rellena. */
export interface MessageTree { [key: string]: string | MessageTree | null }

/** El estado compartido de la interfaz (state.js): solo datos planos. */
export interface AppState {
  booting: boolean
  bootError: unknown
  issuers: Issuer[]
  signatures: StoredSignature[]
  buyers: StoredBuyer[]
  products: StoredProduct[]
  logos: IssuerLogo[]
  drafts: SavedDraft[]
  backup: import('@dotrino/store').VaultBackupStatus | null
  invoicesVersion: number
  toast: { message: string; kind: string } | null
}

/** Por dónde va una emisión (para enseñarlo). */
export type EmitStep = 'signing' | 'sending' | 'authorizing'
export type OnProgress = (step: EmitStep) => void
