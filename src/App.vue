<script setup>
import { ref, watch, onMounted } from 'vue'
import '@dotrino/topbar'
import { useBackLayer } from '@dotrino/nav/vue'
import { lang, setLang, t, errorText } from './i18n.js'
import { state, boot } from './state.js'
import { getIdentity } from './services/identity.js'
import { getReputation } from './services/reputation.js'
import InvoiceList from './components/InvoiceList.vue'
import InvoiceForm from './components/InvoiceForm.vue'
import InvoiceDetail from './components/InvoiceDetail.vue'
import SettingsView from './components/SettingsView.vue'
import BuyersView from './components/BuyersView.vue'
import UnlockDialog from './components/UnlockDialog.vue'

const TABS = ['invoices', 'new', 'buyers', 'settings']
// La pestaña sobrevive a un refresco; abrir la app de cero vuelve a Facturas (§4).
const TAB_KEY = 'facturero.tab'

const tab = ref(readTab())
const openInvoice = ref(null)       // { day, accessKey }
const correcting = ref(null)        // factura que se está corrigiendo
const detailOpen = ref(false)
const topbar = ref(null)

useBackLayer(detailOpen)
watch(detailOpen, (open) => { if (!open) openInvoice.value = null })

function readTab () {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return TABS.includes(v) ? v : 'invoices'
  } catch {
    return 'invoices'
  }
}

function setTab (name) {
  tab.value = name
  detailOpen.value = false
  try { sessionStorage.setItem(TAB_KEY, name) } catch { /* modo privado */ }
}

function showInvoice (target) {
  openInvoice.value = target
  detailOpen.value = true
}

function onEmitted (invoice) {
  correcting.value = null
  setTab('invoices')
  showInvoice({ day: invoice.day, accessKey: invoice.accessKey })
}

function startCorrection (invoice) {
  correcting.value = invoice
  setTab('new')
}

function onLang (e) {
  setLang(e.detail.lang)
}

onMounted(() => {
  boot()
  // Identidad del topbar (§6.1), después del primer pintado.
  getIdentity().then(async (id) => {
    topbar.value.identity = id
    topbar.value.reputation = await getReputation()
  }).catch((e) => console.error('[facturero] topbar identity:', e))
})
</script>

<template>
  <dotrino-topbar
    ref="topbar"
    brand="Facturero"
    icon="./icon.svg"
    support-repo="imdotrino/dotrino-facturero"
    support-discord="https://discord.gg/D648uq7cth"
    profile
    @dotrino-lang="onLang"
  >
    <dotrino-install slot="end" class="cc-install sm" :lang="lang"></dotrino-install>
  </dotrino-topbar>

  <nav class="tabs" role="tablist">
    <button
      v-for="name in TABS" :key="name" role="tab" class="tab"
      :aria-selected="tab === name && !detailOpen" :data-testid="`tab-${name}`"
      @click="setTab(name)"
    >{{ t(`tabs.${name}`) }}</button>
  </nav>

  <main class="main">
    <p v-if="state.booting" class="muted center">{{ t('boot.loading') }}</p>

    <div v-else-if="state.bootError" class="card error-card" role="alert">
      <p>{{ errorText(state.bootError) }}</p>
      <button class="btn" data-testid="boot-retry" @click="boot">{{ t('boot.retry') }}</button>
    </div>

    <template v-else>
      <InvoiceDetail
        v-if="detailOpen && openInvoice"
        :key="openInvoice.accessKey"
        :invoice-ref="openInvoice"
        @close="detailOpen = false"
        @correct="startCorrection"
      />
      <InvoiceList v-else-if="tab === 'invoices'" @open="showInvoice" @new="setTab('new')" @settings="setTab('settings')" />
      <InvoiceForm
        v-else-if="tab === 'new'"
        :correcting="correcting"
        @emitted="onEmitted"
        @cancel-correction="correcting = null; setTab('invoices')"
        @settings="setTab('settings')"
      />
      <BuyersView v-else-if="tab === 'buyers'" />
      <SettingsView v-else-if="tab === 'settings'" />
    </template>
  </main>

  <UnlockDialog />

  <div v-if="state.toast" class="toast" :class="state.toast.kind" role="status" data-testid="toast">{{ state.toast.message }}</div>
</template>
