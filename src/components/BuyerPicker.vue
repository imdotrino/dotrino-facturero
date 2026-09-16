<script setup>
// El comprador de la factura: se elige de los registrados (consumidor final por defecto),
// o se registra uno nuevo aquí mismo y queda elegido.
import { ref, computed } from 'vue'
import { t } from '../i18n.js'
import { state, refreshSettings } from '../state.js'
import { searchBuyers, resolveBuyer } from '../lib/buyers.js'
import { BUYER_ID_TYPES } from '../sri/catalog.js'
import BuyerForm from './BuyerForm.vue'

const props = defineProps({
  modelValue: { type: String, required: true },   // clave del comprador
  problem: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const creating = ref(false)
const query = ref('')

const selected = computed(() => resolveBuyer(props.modelValue, state.buyers))
const matches = computed(() => searchBuyers(state.buyers, query.value).slice(0, 30))
const idTypeLabel = (code) => t(`idTypes.${BUYER_ID_TYPES.find((it) => it.code === code).key}`)

function choose (key) {
  emit('update:modelValue', key)
  open.value = false
  creating.value = false
  query.value = ''
}

async function onCreated (buyer) {
  await refreshSettings()
  choose(buyer.key)
}
</script>

<template>
  <div class="stack" data-testid="buyer-picker">
    <div class="row between">
      <div v-if="selected" data-testid="buyer-selected">
        <strong>{{ selected.name }}</strong>
        <p class="muted small">{{ idTypeLabel(selected.idType) }} {{ selected.id }}<template v-if="selected.email"> · {{ selected.email }}</template></p>
      </div>
      <p v-else class="problem" data-testid="buyer-missing">{{ t('buyers.missing') }}</p>
      <button type="button" class="btn small" :disabled="disabled" :aria-expanded="open" data-testid="change-buyer" @click="open = !open; creating = false">
        {{ open ? t('form.cancel') : t('buyers.change') }}
      </button>
    </div>
    <small v-if="problem" class="problem" data-testid="buyer-problem">{{ problem }}</small>

    <div v-if="open" class="sub-card stack">
      <template v-if="!creating">
        <input v-model="query" type="search" :placeholder="t('buyers.searchPlaceholder')" :aria-label="t('list.search')" data-testid="buyer-search" />
        <ul class="plain-list picker-list">
          <li v-for="b in matches" :key="b.key">
            <button type="button" class="picker-item" :aria-pressed="b.key === modelValue" :data-buyer-key="b.key" data-testid="buyer-option" @click="choose(b.key)">
              <strong>{{ b.name }}</strong>
              <span class="muted small">{{ idTypeLabel(b.idType) }} {{ b.id }}</span>
            </button>
          </li>
        </ul>
        <p v-if="matches.length === 0" class="muted small">{{ t('buyers.noMatches') }}</p>
        <button type="button" class="btn" data-testid="create-buyer" @click="creating = true">+ {{ t('buyers.add') }}</button>
      </template>
      <BuyerForm v-else :buyers="state.buyers" @saved="onCreated" @cancel="creating = false" />
    </div>
  </div>
</template>
