// Emisor y borradores de ejemplo. El RUC es el del SRI que usa la propia ficha técnica
// en sus ejemplos; la cédula del comprador es ficticia pero pasa el módulo 10.

export const issuer = {
  ruc: '1760013210001',
  legalName: 'PRUEBAS SERVICIO DE RENTAS INTERNAS',
  tradeName: 'Mi Tienda & Café <Centro>',
  matrixAddress: 'Av. Amazonas N1-23 y Colón',
  establishmentAddress: 'Av. Amazonas N1-23 y Colón',
  establishment: '001',
  emissionPoint: '001',
  nextSequential: 123,
  keepsAccounting: false,
  specialTaxpayer: '',
  withholdingAgent: '',
  rimpe: 'entrepreneur',
  environment: '1',
}

export const draft = {
  buyer: { idType: '05', id: '1710034065', name: 'Juan Pérez Ñuño', email: 'juan@example.com', address: 'Quito', phone: '0999999999' },
  lines: [
    { code: 'SKU-1', description: 'Servicio de ejemplo', quantity: '2', unitPrice: '10', discount: '0', vatCode: '4' },
    { code: '', description: 'Libro "Ecuador" > 0%', quantity: '1', unitPrice: '7.333333', discount: '0.33', vatCode: '0' },
    { code: 'X', description: 'Tres a 0,1', quantity: '3', unitPrice: '0.1', discount: '', vatCode: '4' },
  ],
  payments: [{ method: '01' }],
  tip: '0',
}
