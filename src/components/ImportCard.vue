<script setup>
// Un importador: se elige el archivo, se ve fila por fila qué entra, y solo entonces se
// guarda. Nada se guarda al elegir el archivo.
import { ref, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { readSheet } from '../import/xls.js'
import { importBuyers, importProducts } from '../import/factureroMovil.js'
import { saveMany } from '../lib/repo.js'

const props = defineProps({
  kind: { type: String, required: true },   // 'buyers' | 'products'
})

const fileInput = ref(null)
const fileName = ref('')
const preview = ref(null)     // { items }
const error = ref('')
const busy = ref(false)
const done = ref(null)        // cuántos se importaron

const counts = computed(() => {
  const c = { new: 0, exists: 0, invalid: 0, skip: 0 }
  for (const i of preview.value?.items || []) c[i.status]++
  return c
})
const label = (item) => props.kind === 'buyers'
  ? { name: item.buyer.name, id: item.buyer.id }
  : { name: item.product.description, id: item.product.code }

async function onFile (e) {
  const file = e.target.files?.[0]
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
    const items = preview.value.items.filter((i) => i.status === 'new').map((i) => (props.kind === 'buyers' ? i.buyer : i.product))
    done.value = await saveMany(props.kind, items)
    await refreshSettings()
    preview.value = null
    if (fileInput.value) fileInput.value.value = ''
  } catch (err) {
    console.error('[facturero] import save:', err)
    toast(errorText(err), 'error')
  } finally {
    busy.value = false
  }
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" :disabled="busy" @click="preview = null; fileInput.value = ''">{{ t('form.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="busy || counts.new === 0" data-testid="import-confirm" @click="confirm">
          {{ t(`import.${kind}.confirm`, { count: counts.new }) }}
        </button>
      </div>
    </template>
  </div>
</template>
