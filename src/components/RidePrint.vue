<script setup>
// RIDE: la representación impresa de la factura electrónica (ficha técnica, Anexo 2).
// Se arma en HTML y se imprime con el diálogo del navegador, que también guarda en PDF:
// ni librería de PDF ni servicio externo. Solo existe para facturas AUTORIZADAS: un RIDE
// sin número de autorización no tiene validez.
import { computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { t } from '../i18n.js'
import { state } from '../state.js'
import { code128Svg } from '../lib/code128.js'
import { sriDateTime } from '../lib/format.js'
import { VAT_RATES, RIMPE_LEGENDS, PAYMENT_METHODS } from '../sri/catalog.js'

const props = defineProps({ invoice: { type: Object, required: true } })
const emit = defineEmits(['done'])

const inv = computed(() => props.invoice)
const issuer = computed(() => inv.value.issuer)
// El logo es el que el emisor tiene HOY: la factura no guarda una copia (pesaría en cada una).
// Si el emisor ya no existe, el RIDE sale sin logo.
const logo = computed(() => state.logos.find((l) => l.issuerId === inv.value.issuerId) || null)
const buyer = computed(() => inv.value.draft.buyer)
const finalConsumer = computed(() => buyer.value.idType === '07')
const barcode = computed(() => code128Svg(inv.value.accessKey, { height: 50 }))

// El RIDE va en español: es un documento tributario ecuatoriano.
const VAT_ES = { 4: '15%', 5: '5%', 0: '0%', 6: 'NO OBJETO DE IVA', 7: 'EXENTO DE IVA', 10: '13%', 8: '8%', 2: '12%', 3: '14%' }
const PAY_ES = { '01': 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO', 15: 'COMPENSACIÓN DE DEUDAS', 16: 'TARJETA DE DÉBITO', 17: 'DINERO ELECTRÓNICO', 18: 'TARJETA PREPAGO', 19: 'TARJETA DE CRÉDITO', 20: 'OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO', 21: 'ENDOSO DE TÍTULOS' }
const payment = computed(() => {
  const code = inv.value.draft.payments[0].method
  if (!PAYMENT_METHODS.some((p) => p.code === code)) throw new Error(`unknown payment method in invoice: ${code}`)
  return PAY_ES[code]
})

// Subtotales por tarifa, en el orden del Anexo 2: primero las que tienen IVA.
const subtotalRows = computed(() => {
  const byCode = Object.fromEntries(inv.value.totals.taxes.map((x) => [x.code, x]))
  return VAT_RATES.filter((v) => byCode[v.code]).map((v) => ({ label: VAT_ES[v.code], base: byCode[v.code].base, value: byCode[v.code].value, rate: v.rate }))
})

function afterPrint () {
  emit('done')
}

onMounted(async () => {
  window.addEventListener('afterprint', afterPrint)
  await nextTick()
  window.print()
})
onBeforeUnmount(() => window.removeEventListener('afterprint', afterPrint))
</script>

<template>
  <Teleport to="body">
    <div class="ride-print" lang="es">
      <div class="ride">
        <div class="ride-top">
          <div class="ride-box ride-issuer">
            <img v-if="logo" :src="logo.dataUrl" alt="" class="ride-logo" />
            <h1>{{ issuer.tradeName || issuer.legalName }}</h1>
            <p v-if="issuer.tradeName"><strong>{{ issuer.legalName }}</strong></p>
            <p><strong>{{ t('ride.matrix') }}:</strong> {{ issuer.matrixAddress }}</p>
            <p v-if="issuer.establishmentAddress"><strong>{{ t('ride.branch') }}:</strong> {{ issuer.establishmentAddress }}</p>
            <p v-if="issuer.specialTaxpayer"><strong>{{ t('ride.special') }}</strong> {{ issuer.specialTaxpayer }}</p>
            <p><strong>{{ t('ride.accounting') }}:</strong> {{ issuer.keepsAccounting ? 'SI' : 'NO' }}</p>
            <p v-if="issuer.withholdingAgent"><strong>{{ t('ride.withholding') }}</strong> {{ issuer.withholdingAgent }}</p>
            <p v-if="issuer.rimpe"><strong>{{ RIMPE_LEGENDS[issuer.rimpe] }}</strong></p>
          </div>
          <div class="ride-box ride-doc">
            <p class="ride-ruc"><strong>R.U.C.:</strong> {{ issuer.ruc }}</p>
            <p class="ride-title">{{ t('ride.invoice') }}</p>
            <p><strong>{{ t('ride.no') }}</strong> {{ inv.number }}</p>
            <p><strong>{{ t('ride.authNumber') }}</strong></p>
            <p class="mono">{{ inv.authorization.number }}</p>
            <p><strong>{{ t('ride.authDate') }}:</strong> {{ sriDateTime(inv.authorization.date) }}</p>
            <p><strong>{{ t('ride.environment') }}:</strong> {{ inv.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS' }}</p>
            <p><strong>{{ t('ride.emission') }}:</strong> {{ t('ride.normal') }}</p>
            <p><strong>{{ t('ride.accessKey') }}</strong></p>
            <div class="ride-barcode" v-html="barcode"></div>
            <p class="mono ride-key">{{ inv.accessKey }}</p>
          </div>
        </div>

        <div class="ride-box ride-buyer">
          <p><strong>{{ t('ride.buyer') }}:</strong> {{ finalConsumer ? 'CONSUMIDOR FINAL' : buyer.name }}</p>
          <p><strong>{{ t('ride.buyerId') }}:</strong> {{ finalConsumer ? '9999999999999' : buyer.id }}</p>
          <p><strong>{{ t('ride.issueDate') }}:</strong> {{ inv.issueDate }}</p>
          <p v-if="buyer.address"><strong>{{ t('ride.address') }}:</strong> {{ buyer.address }}</p>
        </div>

        <table class="ride-table">
          <thead>
            <tr>
              <th>{{ t('ride.code') }}</th><th>{{ t('ride.auxCode') }}</th><th>{{ t('ride.qty') }}</th><th>{{ t('ride.description') }}</th>
              <th>{{ t('ride.unitPrice') }}</th><th>{{ t('ride.discount') }}</th><th>{{ t('ride.total') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in inv.totals.lines" :key="i">
              <td>{{ l.code }}</td>
              <td>{{ l.auxCode }}</td>
              <td class="num">{{ l.quantity.replace(/\.?0+$/, '') }}</td>
              <td>{{ l.description }}<template v-if="l.unit"> ({{ l.unit }})</template></td>
              <td class="num">{{ l.unitPrice.replace(/(\.\d\d\d*?)0+$/, '$1') }}</td>
              <td class="num">{{ l.discount }}</td>
              <td class="num">{{ l.subtotal }}</td>
            </tr>
          </tbody>
        </table>

        <div class="ride-bottom">
          <div class="ride-left">
            <div v-if="buyer.email || buyer.phone" class="ride-box">
              <p><strong>{{ t('ride.extra') }}</strong></p>
              <p v-if="buyer.email">Email: {{ buyer.email }}</p>
              <p v-if="buyer.phone">Teléfono: {{ buyer.phone }}</p>
            </div>
            <table class="ride-table">
              <thead><tr><th>{{ t('ride.payment') }}</th><th>{{ t('ride.value') }}</th></tr></thead>
              <tbody><tr><td>{{ payment }}</td><td class="num">{{ inv.totals.total }}</td></tr></tbody>
            </table>
          </div>
          <table class="ride-table ride-totals">
            <tbody>
              <tr v-for="row in subtotalRows" :key="`s${row.label}`"><td>{{ t('ride.subtotalAt', { label: row.label }) }}</td><td class="num">{{ row.base }}</td></tr>
              <tr><td>{{ t('ride.subtotal') }}</td><td class="num">{{ inv.totals.totalWithoutTaxes }}</td></tr>
              <tr><td>{{ t('ride.discountTotal') }}</td><td class="num">{{ inv.totals.totalDiscount }}</td></tr>
              <tr v-for="row in subtotalRows.filter((r) => r.rate !== '0')" :key="`v${row.label}`"><td>{{ t('ride.vatAt', { label: row.label }) }}</td><td class="num">{{ row.value }}</td></tr>
              <tr><td>{{ t('ride.tip') }}</td><td class="num">{{ inv.totals.tip }}</td></tr>
              <tr class="grand"><td>{{ t('ride.grandTotal') }}</td><td class="num">{{ inv.totals.total }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>
</template>
