<script setup>
// Un importador: se elige el archivo, se ve fila por fila qué entra, y solo entonces se
// guarda. Nada se guarda al elegir el archivo.
import { ref, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { readSheet } from '../import/xls.js'
import { importBuyers, importProducts } from '../import/factureroMovil.js'
import { saveMany } from '../lib/repo.js'

/** @import { PropType } from 'vue' */
/** @typedef {import('../types').ImportedBuyer | import('../types').ImportedProduct} ImportedItem */

const props = defineProps({
  kind: { type: /** @type {PropType<'buyers' | 'products'>} */ (String), required: true },
})

const fileInput = ref(/** @type {HTMLInputElement | null} */ (null))
const fileName = ref('')
const preview = ref(/** @type {{ items: ImportedItem[] } | null} */ (null))
const error = ref('')
const busy = ref(false)
const done = ref(/** @type {number | null} */ (null))        // cuántos se importaron

const counts = computed(() => {
  const c = { new: 0, exists: 0, invalid: 0, skip: 0 }
  for (const i of preview.value?.items || []) c[i.status]++
  return c
})
const label = (/** @type {ImportedItem} */ item) => 'buyer' in item
  ? { name: item.buyer.name, id: item.buyer.id }
  : { name: item.product.description, id: item.product.code }

/** @param {Event} e */
async function onFile (e) {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0]
  preview.value = null
  error.value = ''
  done.value = null
  if (!file) return
  fileName.value = file.name
  try {
    const rows = readSheet(new Uint8Array(await file.arrayBuffer()))
    preview.value = props.kind === 'buyers' ? importBuyers(rows, state.buyers) : importProducts(rows, state.products)
  } catch (err) {
    console.error('[facturero] import read:', err)
    error.value = errorText(err)
  }
}

async function confirm () {
  busy.value = true
  try {
    if (!preview.value) throw new Error('facturero: nothing to import')
    const items = preview.value.items.filter((i) => i.status === 'new').map((i) => ('buyer' in i ? i.buyer : i.product))
    done.value = await saveMany(props.kind, items)
    await refreshSettings()
    preview.value = null
    clearFile()
  } catch (err) {
    console.error('[facturero] import save:', err)
    toast(errorText(err), 'error')
  } finally {
    busy.value = false
  }
}

function clearFile () {
  if (fileInput.value) fileInput.value.value = ''
}

function cancelPreview () {
  preview.value = null
  clearFile()
}
</script>

<template>
  <div class="sub-card stack" :data-testid="`import-${kind}`">
    <div>
      <strong>{{ t(`import.${kind}.title`) }}</strong>
      <p class="muted small">{{ t(`import.${kind}.file`) }}</p>
    </div>
    <input ref="fileInput" type="file" accept=".xls,.html,.htm" :disabled="busy" data-testid="import-file" @change="onFile" />
    <p v-if="error" class="problem" role="alert" data-testid="import-error">{{ error }}</p>
    <p v-if="done !== null" class="banner" role="status" data-testid="import-done">{{ t('import.done', { count: done }) }}</p>

    <template v-if="preview">
      <p class="small" data-testid="import-summary">
        {{ t('import.summary', { file: fileName, new: counts.new, exists: counts.exists, invalid: counts.invalid + counts.skip }) }}
      </p>
      <div class="table-scroll">
        <table class="lines-table" data-testid="import-preview">
          <thead>
            <tr><th>{{ t('import.row') }}</th><th>{{ t(`import.${kind}.name`) }}</th><th>{{ t(`import.${kind}.id`) }}</th><th>{{ t('import.status') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in preview.items" :key="item.row" :class="`import-${item.status}`" data-testid="import-row">
              <td>{{ item.row }}</td>
              <td>{{ label(item).name }}</td>
              <td class="nowrap">{{ label(item).id }}</td>
              <td>
                <span class="chip" :class="{ authorized: item.status === 'new', rejected: item.status === 'invalid' }">{{ t(`import.statuses.${item.status}`) }}</span>
                <span v-for="p in item.problems" :key="p.path + p.code" class="block small problem">{{ t(`import.fields.${p.path.split('.')[1]}`) }}: {{ t(`problems.${p.code}`) }}</span>
                <span v-for="n in item.notes || []" :key="'note' + n.path + n.code" class="block small muted" data-testid="import-note">{{ t(`import.fields.${n.path.split('.')[1]}`) }}: {{ t(`problems.${n.code}`) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" :disabled="busy" @click="cancelPreview">{{ t('form.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="busy || counts.new === 0" data-testid="import-confirm" @click="confirm">
          {{ t(`import.${kind}.confirm`, { count: counts.new }) }}
        </button>
      </div>
    </template>
  </div>
</template>
