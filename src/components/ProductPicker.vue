<script setup>
// Elegir un producto registrado para una línea de la factura. Copia sus datos a la línea
// (código, descripción, precio, IVA, unidad); cantidad y descuento siguen siendo de la línea.
import { ref, computed, nextTick } from 'vue'
import { t } from '../i18n.js'
import { state } from '../state.js'
import { searchProducts } from '../lib/products.js'
import { money } from '../lib/format.js'

const emit = defineEmits(['choose', 'close'])
const query = ref('')
const input = ref(null)
const matches = computed(() => searchProducts(state.products, query.value).slice(0, 30))
nextTick(() => input.value?.focus())
</script>

<template>
  <div class="sub-card stack wide" data-testid="product-picker">
    <input ref="input" v-model="query" type="search" :placeholder="t('products.searchPlaceholder')" :aria-label="t('list.search')" data-testid="product-search" />
    <ul class="plain-list picker-list">
      <li v-for="p in matches" :key="p.key">
        <button type="button" class="picker-item" :data-product-key="p.key" data-testid="product-option" @click="emit('choose', p)">
          <strong>{{ p.description }}</strong>
          <span class="muted small">{{ p.code }} · {{ money(p.unitPrice) }}</span>
        </button>
      </li>
    </ul>
    <p v-if="state.products.length === 0" class="muted small">{{ t('products.none') }}</p>
    <p v-else-if="matches.length === 0" class="muted small">{{ t('buyers.noMatches') }}</p>
    <div class="actions">
      <button type="button" class="btn ghost small" @click="emit('close')">{{ t('form.cancel') }}</button>
    </div>
  </div>
</template>
