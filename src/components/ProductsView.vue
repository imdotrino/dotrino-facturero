<script setup>
import { ref, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { removeProduct } from '../lib/repo.js'
import { searchProducts } from '../lib/products.js'
import { VAT_RATES } from '../sri/catalog.js'
import { money } from '../lib/format.js'
import ProductForm from './ProductForm.vue'

const query = ref('')
const editing = ref(null)     // clave del producto, 'new', o null
const toRemove = ref(null)

const shown = computed(() => searchProducts(state.products, query.value))
const vatLabel = (code) => t(`vat.${VAT_RATES.find((v) => v.code === code).key}`)

async function onSaved () {
  editing.value = null
  await refreshSettings()
  toast(t('settings.saved'))
}

async function confirmRemove () {
  const product = toRemove.value
  toRemove.value = null
  try {
    await removeProduct(product.key)
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] remove product:', e)
    toast(errorText(e), 'error')
  }
}
</script>

<template>
  <section class="stack" data-testid="products-view">
    <div class="row">
      <input v-model="query" class="grow" type="search" :placeholder="t('list.search')" :aria-label="t('list.search')" data-testid="products-search" />
      <button class="btn primary" :disabled="editing !== null" data-testid="add-product" @click="editing = 'new'">+ {{ t('products.add') }}</button>
    </div>

    <div v-if="editing === 'new'" class="card" data-testid="new-product">
      <h3>{{ t('products.new') }}</h3>
      <ProductForm :products="state.products" @saved="onSaved" @cancel="editing = null" />
    </div>

    <p v-if="state.products.length === 0 && editing !== 'new'" class="muted center" data-testid="no-products">{{ t('products.none') }}</p>
    <p v-else-if="shown.length === 0" class="muted center">{{ t('buyers.noMatches') }}</p>

    <ul class="plain-list">
      <li v-for="p in shown" :key="p.key" class="card" :data-product-key="p.key" data-testid="product-item">
        <ProductForm v-if="editing === p.key" :product="p" :products="state.products" @saved="onSaved" @cancel="editing = null" />
        <template v-else>
          <div class="row between">
            <strong>{{ p.description }}</strong>
            <strong>{{ money(p.unitPrice) }}</strong>
          </div>
          <p class="muted small">{{ p.code }}<template v-if="p.auxCode"> · {{ p.auxCode }}</template> · {{ t('form.vat') }} {{ vatLabel(p.vatCode) }}<template v-if="p.unit"> · {{ p.unit }}</template></p>
          <div class="actions wrap">
            <button class="btn small" :disabled="editing !== null" data-testid="edit-product" @click="editing = p.key">✎ {{ t('settings.edit') }}</button>
            <button class="btn small danger" :disabled="editing !== null" data-testid="remove-product" @click="toRemove = p">✕ {{ t('settings.remove') }}</button>
          </div>
        </template>
      </li>
    </ul>

    <div v-if="toRemove" class="modal-backdrop" @click.self="toRemove = null">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('products.removeTitle', { name: toRemove.description })" data-testid="confirm-remove-product">
        <h2>{{ t('products.removeTitle', { name: toRemove.description }) }}</h2>
        <p>{{ t('products.removeBody') }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="toRemove = null">{{ t('form.cancel') }}</button>
          <button type="button" class="btn danger" data-testid="confirm-remove-product-yes" @click="confirmRemove">{{ t('settings.remove') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
