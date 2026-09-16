<script setup>
import { ref, computed, onMounted } from 'vue'
import { t, errorText } from '../i18n.js'
import { toast } from '../state.js'
import { getInvoice } from '../lib/repo.js'
import { submitInvoice, checkAuthorization } from '../lib/emit.js'
import { gunzipText, downloadBlob } from '../lib/bytes.js'
import { money, sriDateTime } from '../lib/format.js'
import { VAT_RATES } from '../sri/catalog.js'
import RidePrint from './RidePrint.vue'

const props = defineProps({ invoiceRef: { type: Object, required: true } })
const emit = defineEmits(['close', 'correct'])

const invoice = ref(null)
const loading = ref(true)
const busy = ref(false)
const printing = ref(false)

const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File(['x'], 'x.xml', { type: 'application/xml' })] })

const authorized = computed(() => invoice.value?.status === 'authorized')
const correctable = computed(() => ['returned', 'rejected', 'signed'].includes(invoice.value?.status))
const resendable = computed(() => ['signed', 'returned', 'rejected'].includes(invoice.value?.status))
const checkable = computed(() => invoice.value?.status === 'received')
const buyerName = computed(() => invoice.value.draft.buyer.idType === '07' ? 'CONSUMIDOR FINAL' : invoice.value.draft.buyer.name)
const vatLabel = (code) => t(`vat.${VAT_RATES.find((v) => v.code === code).key}`)

async function load () {
  loading.value = true
  try {
    invoice.value = await getInvoice(props.invoiceRef.day, props.invoiceRef.accessKey)
  } catch (e) {
    console.error('[facturero] detail:', e)
    toast(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

async function run (fn) {
  busy.value = true
  try {
    invoice.value = await fn(invoice.value)
    if (invoice.value.lastError) toast(errorText(invoice.value.lastError), 'error')
  } catch (e) {
    console.error('[facturero] detail action:', e)
    toast(errorText(e), 'error')
  } finally {
    busy.value = false
  }
}

const check = () => run((inv) => checkAuthorization(inv))
const resend = () => run((inv) => submitInvoice(inv))

function fileBase () {
  return `${invoice.value.number}_${invoice.value.accessKey}`
}

async function authorizedFile () {
  return new File([await gunzipText(invoice.value.authorizedXmlGz)], `${fileBase()}.xml`, { type: 'application/xml' })
}

async function download () {
  try {
    const file = await authorizedFile()
    downloadBlob(file, file.name)
  } catch (e) {
    console.error('[facturero] download:', e)
    toast(errorText(e), 'error')
  }
}

async function share () {
  try {
    const file = await authorizedFile()
    await navigator.share({ files: [file], title: `Factura ${invoice.value.number}` })
  } catch (e) {
    if (e?.name === 'AbortError') return
    console.error('[facturero] share:', e)
    toast(errorText(e), 'error')
  }
}

function print () {
  printing.value = true
}

onMounted(async () => {
  await load()
  // Al abrir una que espera respuesta, se consulta una vez.
  if (invoice.value?.status === 'received') check()
})
</script>

<template>
  <section class="stack" data-testid="invoice-detail">
    <button class="btn ghost small back" data-testid="detail-back" @click="emit('close')">‹ {{ t('detail.back') }}</button>

    <p v-if="loading" class="muted center">…</p>
    <p v-else-if="!invoice" class="muted center">{{ t('detail.notFound') }}</p>

    <template v-else>
      <header class="card detail-head">
        <div>
          <h2>{{ t('detail.number') }} {{ invoice.number }}</h2>
          <p class="muted">{{ invoice.issueDate }} · {{ buyerName }}</p>
        </div>
        <div class="inv-side">
          <strong class="big">{{ money(invoice.totals.total) }}</strong>
          <span class="chip" :class="invoice.status" data-testid="detail-status">{{ t(`status.${invoice.status}`) }}</span>
        </div>
      </header>

      <p v-if="invoice.status === 'received'" class="banner">{{ t('detail.received') }}</p>

      <div v-if="invoice.lastError" class="banner error" role="alert" data-testid="last-error">
        <strong>{{ t('detail.lastError') }}:</strong> {{ errorText(invoice.lastError) }}
        <small class="block muted">{{ invoice.lastError.message }}</small>
      </div>

      <section v-if="invoice.messages?.length" class="card" data-testid="sri-messages">
        <h3>{{ t('detail.sriMessages') }}</h3>
        <ul class="messages">
          <li v-for="(m, i) in invoice.messages" :key="i" :class="m.type === 'ERROR' ? 'problem' : ''">
            <strong>{{ m.id }} · {{ m.message }}</strong>
            <span v-if="m.info" class="block small">{{ m.info }}</span>
          </li>
        </ul>
      </section>

      <div class="actions wrap">
        <button class="btn" :disabled="busy || !checkable" data-testid="check-authorization" @click="check">{{ t('detail.check') }}</button>
        <button class="btn" :disabled="busy || !resendable" data-testid="resend" @click="resend">{{ t('detail.resend') }}</button>
        <button class="btn" :disabled="busy || !correctable" data-testid="correct" @click="emit('correct', invoice)">{{ t('detail.correct') }}</button>
      </div>
      <div class="actions wrap">
        <button class="btn primary" :disabled="!authorized" :title="authorized ? '' : t('detail.onlyAuthorized')" data-testid="download-xml" @click="download">{{ t('detail.download') }}</button>
        <button class="btn" :disabled="!authorized" :title="authorized ? '' : t('detail.onlyAuthorized')" data-testid="print-ride" @click="print">{{ t('detail.print') }}</button>
        <button class="btn" :disabled="!authorized || !canShareFiles" :title="!authorized ? t('detail.onlyAuthorized') : (!canShareFiles ? t('detail.shareUnsupported') : '')" data-testid="share" @click="share">{{ t('detail.share') }}</button>
      </div>
      <p v-if="!authorized" class="muted small">{{ t('detail.onlyAuthorized') }}</p>

      <dl class="card facts">
        <dt>{{ t('detail.accessKey') }}</dt><dd class="mono" data-testid="access-key">{{ invoice.accessKey }}</dd>
        <template v-if="invoice.authorization">
          <dt>{{ t('detail.authorizedAt') }}</dt><dd>{{ sriDateTime(invoice.authorization.date) }}</dd>
        </template>
        <dt>{{ t('detail.environment') }}</dt><dd>{{ invoice.environment === '2' ? t('detail.envProd') : t('detail.envTest') }}</dd>
      </dl>

      <section class="card">
        <table class="lines-table">
          <thead>
            <tr><th>{{ t('form.description') }}</th><th class="num">{{ t('form.quantity') }}</th><th class="num">{{ t('form.unitPrice') }}</th><th class="num">{{ t('form.lineTotal') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in invoice.totals.lines" :key="i">
              <td>{{ l.description }} <span class="muted small">({{ vatLabel(l.vat.code) }})</span></td>
              <td class="num">{{ Number(l.quantity) }}</td>
              <td class="num">{{ Number(l.unitPrice) }}</td>
              <td class="num">{{ l.subtotal }}</td>
            </tr>
          </tbody>
        </table>
        <div class="totals">
          <div v-for="tax in invoice.totals.taxes" :key="`b${tax.code}`" class="total-row"><span>{{ t('form.subtotalAt', { label: vatLabel(tax.code) }) }}</span><span>{{ money(tax.base) }}</span></div>
          <div class="total-row"><span>{{ t('form.discountTotal') }}</span><span>{{ money(invoice.totals.totalDiscount) }}</span></div>
          <div v-for="tax in invoice.totals.taxes.filter((x) => x.rate !== '0')" :key="`v${tax.code}`" class="total-row"><span>{{ t('form.vatAt', { label: vatLabel(tax.code) }) }}</span><span>{{ money(tax.value) }}</span></div>
          <div class="total-row grand"><span>{{ t('form.total') }}</span><span>{{ money(invoice.totals.total) }}</span></div>
        </div>
      </section>

      <RidePrint v-if="printing" :invoice="invoice" @done="printing = false" />
    </template>
  </section>
</template>
