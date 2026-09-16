<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, issuerReady, toast } from '../state.js'
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

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const text = new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))
  return text.charAt(0).toUpperCase() + text.slice(1)
})
const isCurrentMonth = computed(() => month.value >= ecuadorMonth())

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return invoices.value
  return invoices.value.filter((i) => `${i.number} ${buyerName(i)} ${i.draft.buyer.id}`.toLowerCase().includes(q))
})
const authorized = computed(() => invoices.value.filter((i) => i.status === 'authorized'))

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
    const files = []
    for (const inv of authorized.value) {
      files.push({ name: `${inv.number}_${inv.accessKey}.xml`, data: await gunzipText(inv.authorizedXmlGz), date: new Date(inv.createdAt) })
    }
    const ruc = state.issuer?.ruc || 'facturas'
    downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `facturas_${ruc}_${month.value}.zip`)
  } catch (e) {
    console.error('[facturero] zip:', e)
    toast(errorText(e), 'error')
  }
}

watch(month, load)
onMounted(load)
</script>

<template>
  <section class="stack" data-testid="invoice-list">
    <div v-if="!issuerReady() || !state.signature" class="card readiness" data-testid="readiness">
      <p v-if="!issuerReady()">{{ t('ready.noIssuer') }}</p>
      <p v-if="!state.signature">{{ t('ready.noSignature') }}</p>
      <button class="btn primary" data-testid="go-settings" @click="emit('settings')">{{ t('ready.goSettings') }}</button>
    </div>

    <div class="month-bar">
      <button class="btn icon" :aria-label="t('list.prevMonth')" :title="t('list.prevMonth')" data-testid="prev-month" @click="month = shiftMonth(month, -1)">‹</button>
      <h2 class="month">{{ monthLabel }}</h2>
      <button class="btn icon" :aria-label="t('list.nextMonth')" :title="t('list.nextMonth')" :disabled="isCurrentMonth" data-testid="next-month" @click="month = shiftMonth(month, 1)">›</button>
    </div>

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
