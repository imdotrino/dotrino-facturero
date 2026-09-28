<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, usableIssuers, refreshDrafts, toast } from '../state.js'
import { issuerName } from '../lib/issuers.js'
import { listInvoices, resumeSavedDraft, removeSavedDraft } from '../lib/repo.js'
import { resolveBuyer, buyerSnapshot } from '../lib/buyers.js'
import { computeInvoice } from '../sri/invoice.js'
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

// ---------- borradores guardados ----------

const removing = ref('')   // clave del borrador que pide confirmar que se quita

function draftBuyer (d) {
  return resolveBuyer(d.buyerKey, state.buyers)?.name || '—'
}

function draftLines (d) {
  return (d.lines || []).map((l) => l.description.trim()).filter(Boolean).join(' · ')
}

function draftIssuer (d) {
  const i = state.issuers.find((x) => x.id === d.issuerId)
  return i ? issuerName(i) : ''
}

function draftTotal (d) {
  const b = resolveBuyer(d.buyerKey, state.buyers)
  try {
    return money(computeInvoice({ ...d, buyer: b ? buyerSnapshot(b) : {} }).total)
  } catch (e) {
    if (!['bad-decimal', 'discount-exceeds', 'unknown-vat-code'].includes(e.code)) throw e
    return '—'
  }
}

function savedAt (ms) {
  return new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(new Date(ms))
}

async function resume (saved) {
  try {
    await resumeSavedDraft(saved)
    await refreshDrafts()
    emit('new')
  } catch (e) {
    console.error('[facturero] resume draft:', e)
    toast(errorText(e), 'error')
  }
}

async function removeDraft (key) {
  removing.value = ''
  try {
    await removeSavedDraft(key)
    await refreshDrafts()
  } catch (e) {
    console.error('[facturero] remove draft:', e)
    toast(errorText(e), 'error')
  }
}

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

    <section v-if="state.drafts.length" class="stack" data-testid="saved-drafts">
      <h2 class="drafts-title">{{ t('list.drafts') }}</h2>
      <ul class="invoice-list">
        <li v-for="d in state.drafts" :key="d.key" class="invoice-item card draft-item" :data-draft-key="d.key" data-testid="saved-draft">
          <span class="inv-main">
            <strong>{{ draftBuyer(d.draft) }}</strong>
            <span v-if="draftLines(d.draft)" class="draft-lines">{{ draftLines(d.draft) }}</span>
            <span class="muted">{{ t('list.draftSavedAt', { date: savedAt(d.savedAt) }) }}</span>
            <span v-if="draftIssuer(d.draft)" class="muted small">{{ draftIssuer(d.draft) }}</span>
          </span>
          <span class="inv-side">
            <strong>{{ draftTotal(d.draft) }}</strong>
            <span v-if="removing === d.key" class="row">
              <button class="btn ghost small" data-testid="remove-draft-cancel" @click="removing = ''">{{ t('form.cancel') }}</button>
              <button class="btn small danger" data-testid="remove-draft-confirm" @click="removeDraft(d.key)">{{ t('list.removeDraftConfirm') }}</button>
            </span>
            <span v-else class="row">
              <button class="btn ghost small" :aria-label="t('list.removeDraft')" data-testid="remove-draft" @click="removing = d.key">{{ t('list.removeDraft') }}</button>
              <button class="btn primary small" data-testid="resume-draft" @click="resume(d)">{{ t('list.resumeDraft') }}</button>
            </span>
          </span>
        </li>
      </ul>
    </section>

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
