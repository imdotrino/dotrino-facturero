<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, usableIssuers, toast } from '../state.js'
import { issuerName } from '../lib/issuers.js'
import { listInvoices } from '../lib/repo.js'
import { ecuadorMonth, shiftMonth } from '../lib/dates.js'
import { gunzipText, downloadBlob } from '../lib/bytes.js'
import { zipStore } from '../lib/zip.js'
import { money } from '../lib/format.js'

const emit = defineEmits(['open', 'new', 'settings'])

const month = ref(ecuadorMonth())
const invoices = ref([])
const loading = ref(false)
const query = ref('')
const issuerFilter = ref('')   // '' = todos los emisores

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const text = new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
  return text.charAt(0).toUpperCase() + text.slice(1)
})
const isCurrentMonth = computed(() => month.value >= ecuadorMonth())

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  return invoices.value
    .filter((i) => !issuerFilter.value || i.issuerId === issuerFilter.value)
    .filter((i) => !q || `${i.number} ${buyerName(i)} ${i.draft.buyer.id} ${issuerName(i.issuer)} ${i.issuer.ruc}`.toLowerCase().includes(q))
})
// La descarga del mes respeta el filtro de emisor, no la búsqueda.
const authorized = computed(() => invoices.value.filter((i) => i.status === 'authorized' && (!issuerFilter.value || i.issuerId === issuerFilter.value)))

function buyerName (i) {
  return i.draft.buyer.idType === '07' ? 'CONSUMIDOR FINAL' : i.draft.buyer.name
}

async function load () {
  loading.value = true
  try {
    invoices.value = await listInvoices(month.value)
  } catch (e) {
    console.error('[facturero] list:', e)
    toast(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

async function downloadMonth () {
  try {
    // Una carpeta por RUC y ambiente: las de pruebas no se mezclan con las que valen.
    const files = []
    for (const inv of authorized.value) {
      const folder = `${inv.issuer.ruc}_${inv.environment === '2' ? 'produccion' : 'pruebas'}`
      files.push({ name: `${folder}/${inv.number}_${inv.accessKey}.xml`, data: await gunzipText(inv.authorizedXmlGz), date: new Date(inv.createdAt) })
    }
    const scope = issuerFilter.value ? state.issuers.find((i) => i.id === issuerFilter.value)?.ruc : 'todos'
    downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `facturas_${scope}_${month.value}.zip`)
  } catch (e) {
    console.error('[facturero] zip:', e)
    toast(errorText(e), 'error')
  }
}

watch(month, load)
// Facturas que llegan de la bóveda (emitidas en otro aparato): se vuelve a leer el mes.
watch(() => state.invoicesVersion, load)
onMounted(load)
</script>

<template>
  <section class="stack" data-testid="invoice-list">
    <div v-if="usableIssuers().length === 0" class="card readiness" data-testid="readiness">
      <p v-if="state.issuers.length === 0">{{ t('ready.noIssuer') }}</p>
      <p v-else>{{ t('ready.noUsableIssuer') }}</p>
      <button class="btn primary" data-testid="go-settings" @click="emit('settings')">{{ t('ready.goSettings') }}</button>
    </div>

    <div class="month-bar">
      <button class="btn icon" :aria-label="t('list.prevMonth')" :title="t('list.prevMonth')" data-testid="prev-month" @click="month = shiftMonth(month, -1)">‹</button>
      <h2 class="month">{{ monthLabel }}</h2>
      <button class="btn icon" :aria-label="t('list.nextMonth')" :title="t('list.nextMonth')" :disabled="isCurrentMonth" data-testid="next-month" @click="month = shiftMonth(month, 1)">›</button>
    </div>

    <select v-if="state.issuers.length > 1" v-model="issuerFilter" :aria-label="t('list.issuerFilter')" data-testid="issuer-filter">
      <option value="">{{ t('list.allIssuers') }}</option>
      <option v-for="i in state.issuers" :key="i.id" :value="i.id">{{ issuerName(i) }} · {{ i.ruc }} · {{ i.environment === '2' ? t('settings.envProd') : t('settings.envTest') }}</option>
    </select>

    <div class="row">
      <input v-model="query" class="grow" type="search" :placeholder="t('list.search')" :aria-label="t('list.search')" data-testid="search" />
      <button class="btn primary" data-testid="new-invoice" @click="emit('new')">{{ t('tabs.new') }}</button>
    </div>

    <p v-if="!loading && invoices.length === 0" class="muted center" data-testid="empty">{{ t('list.empty') }}</p>

    <ul class="invoice-list">
      <li v-for="inv in visible" :key="inv.accessKey">
        <button class="invoice-item card" :data-access-key="inv.accessKey" data-testid="invoice-item" @click="emit('open', { day: inv.day, accessKey: inv.accessKey })">
          <span class="inv-main">
            <strong>{{ inv.number }}</strong>
            <span class="muted">{{ inv.issueDate }} · {{ buyerName(inv) }}</span>
            <span class="muted small">{{ issuerName(inv.issuer) }}<template v-if="inv.environment === '1'"> · <span class="chip test">{{ t('settings.envTest') }}</span></template></span>
          </span>
          <span class="inv-side">
            <strong>{{ money(inv.totals.total) }}</strong>
            <span class="chip" :class="inv.status" data-testid="invoice-status">{{ t(`status.${inv.status}`) }}</span>
          </span>
        </button>
      </li>
    </ul>

    <button class="btn ghost" :disabled="authorized.length === 0" :title="authorized.length === 0 ? t('list.downloadMonthNone') : ''" data-testid="download-month" @click="downloadMonth">
      {{ t('list.downloadMonth') }}
    </button>
    <p v-if="authorized.length === 0 && invoices.length > 0" class="muted small center">{{ t('list.downloadMonthNone') }}</p>
  </section>
</template>
