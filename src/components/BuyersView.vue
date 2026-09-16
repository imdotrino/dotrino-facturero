<script setup>
import { ref, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { removeBuyer } from '../lib/repo.js'
import { searchBuyers, FINAL_CONSUMER_KEY } from '../lib/buyers.js'
import { BUYER_ID_TYPES } from '../sri/catalog.js'
import BuyerForm from './BuyerForm.vue'

const query = ref('')
const editing = ref(null)     // clave del comprador, 'new', o null
const toRemove = ref(null)

const shown = computed(() => searchBuyers(state.buyers, query.value))
const idTypeLabel = (code) => t(`idTypes.${BUYER_ID_TYPES.find((it) => it.code === code).key}`)

async function onSaved () {
  editing.value = null
  await refreshSettings()
  toast(t('settings.saved'))
}

async function confirmRemove () {
  const buyer = toRemove.value
  toRemove.value = null
  try {
    await removeBuyer(buyer.key)
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] remove buyer:', e)
    toast(errorText(e), 'error')
  }
}
</script>

<template>
  <section class="stack" data-testid="buyers-view">
    <div class="row">
      <input v-model="query" class="grow" type="search" :placeholder="t('list.search')" :aria-label="t('list.search')" data-testid="buyers-search" />
      <button class="btn primary" :disabled="editing !== null" data-testid="add-buyer" @click="editing = 'new'">+ {{ t('buyers.add') }}</button>
    </div>

    <div v-if="editing === 'new'" class="card" data-testid="new-buyer">
      <h3>{{ t('buyers.new') }}</h3>
      <BuyerForm :buyers="state.buyers" @saved="onSaved" @cancel="editing = null" />
    </div>

    <ul class="plain-list">
      <li v-for="b in shown" :key="b.key" class="card" :data-buyer-key="b.key" data-testid="buyer-item">
        <BuyerForm v-if="editing === b.key" :buyer="b" :buyers="state.buyers" @saved="onSaved" @cancel="editing = null" />
        <template v-else>
          <div class="row between">
            <strong>{{ b.name }}</strong>
            <span v-if="b.key === FINAL_CONSUMER_KEY" class="chip">{{ t('buyers.default') }}</span>
          </div>
          <p class="muted small">{{ idTypeLabel(b.idType) }} {{ b.id }}<template v-if="b.email"> · {{ b.email }}</template><template v-if="b.phone"> · {{ b.phone }}</template></p>
          <p v-if="b.address" class="muted small">{{ b.address }}</p>
          <p v-if="b.key === FINAL_CONSUMER_KEY" class="muted small">{{ t('buyers.finalConsumerNote') }}</p>
          <div class="actions wrap">
            <button class="btn small" :disabled="b.key === FINAL_CONSUMER_KEY || editing !== null" data-testid="edit-buyer" @click="editing = b.key">✎ {{ t('settings.edit') }}</button>
            <button class="btn small danger" :disabled="b.key === FINAL_CONSUMER_KEY || editing !== null" data-testid="remove-buyer" @click="toRemove = b">✕ {{ t('settings.remove') }}</button>
          </div>
        </template>
      </li>
    </ul>
    <p v-if="state.buyers.length === 0" class="muted center" data-testid="no-buyers">{{ t('buyers.none') }}</p>

    <div v-if="toRemove" class="modal-backdrop" @click.self="toRemove = null">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('buyers.removeTitle', { name: toRemove.name })" data-testid="confirm-remove-buyer">
        <h2>{{ t('buyers.removeTitle', { name: toRemove.name }) }}</h2>
        <p>{{ t('buyers.removeBody') }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="toRemove = null">{{ t('form.cancel') }}</button>
          <button type="button" class="btn danger" data-testid="confirm-remove-buyer-yes" @click="confirmRemove">{{ t('settings.remove') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
