<script setup>
import { ref, reactive, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { toast } from '../state.js'
import { saveProduct } from '../lib/repo.js'
import { EMPTY_PRODUCT, productProblems, normalizeProduct } from '../lib/products.js'
import { VAT_RATES } from '../sri/catalog.js'

const props = defineProps({
  product: { type: Object, default: null },   // null = nuevo
  products: { type: Array, required: true },
})
const emit = defineEmits(['saved', 'cancel'])

const form = reactive({ ...EMPTY_PRODUCT, ...(props.product || {}) })
const saving = ref(false)
const showProblems = ref(false)
const vatOptions = VAT_RATES.filter((v) => !v.historic)

const problems = computed(() => productProblems(form, props.products))
const problemAt = (field) => {
  if (!showProblems.value) return ''
  const p = problems.value.find((x) => x.path === `product.${field}`)
  return p ? t(`problems.${p.code}`) : ''
}

async function submit () {
  showProblems.value = true
  if (problems.value.length) {
    toast(t('errors.invalid-draft'), 'error')
    return
  }
  saving.value = true
  try {
    emit('saved', await saveProduct(normalizeProduct(form)))
  } catch (e) {
    console.error('[facturero] save product:', e)
    toast(errorText(e), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="stack" novalidate data-testid="product-form" @submit.prevent="submit">
    <fieldset class="grid" :disabled="saving">
      <label class="field">
        <span>{{ t('products.code') }}</span>
        <input v-model.trim="form.code" maxlength="25" autocomplete="off" data-testid="product-code" />
        <small v-if="problemAt('code')" class="problem">{{ problemAt('code') }}</small>
      </label>
      <label class="field">
        <span>{{ t('products.auxCode') }} <span class="muted">({{ t('buyers.optional') }})</span></span>
        <input v-model.trim="form.auxCode" maxlength="25" autocomplete="off" data-testid="product-aux-code" />
        <small v-if="problemAt('auxCode')" class="problem">{{ problemAt('auxCode') }}</small>
      </label>
      <label class="field wide">
        <span>{{ t('form.description') }}</span>
        <input v-model="form.description" maxlength="300" autocomplete="off" data-testid="product-description" />
        <small v-if="problemAt('description')" class="problem">{{ problemAt('description') }}</small>
      </label>
      <label class="field">
        <span>{{ t('form.unitPrice') }}</span>
        <input v-model.trim="form.unitPrice" inputmode="decimal" data-testid="product-unit-price" />
        <small v-if="problemAt('unitPrice')" class="problem">{{ problemAt('unitPrice') }}</small>
      </label>
      <label class="field">
        <span>{{ t('form.vat') }}</span>
        <select v-model="form.vatCode" data-testid="product-vat">
          <option v-for="v in vatOptions" :key="v.code" :value="v.code">{{ t(`vat.${v.key}`) }}</option>
        </select>
        <small v-if="problemAt('vatCode')" class="problem">{{ problemAt('vatCode') }}</small>
      </label>
      <label class="field">
        <span>{{ t('products.unit') }} <span class="muted">({{ t('buyers.optional') }})</span></span>
        <input v-model="form.unit" maxlength="50" autocomplete="off" data-testid="product-unit" />
        <small v-if="problemAt('unit')" class="problem">{{ problemAt('unit') }}</small>
      </label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn ghost" :disabled="saving" data-testid="cancel-product" @click="emit('cancel')">{{ t('form.cancel') }}</button>
      <button type="submit" class="btn primary" :disabled="saving" data-testid="save-product">{{ t('settings.save') }}</button>
    </div>
  </form>
</template>
