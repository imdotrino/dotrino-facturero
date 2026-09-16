<script setup>
import { ref, reactive, computed } from 'vue'
import { t, errorText } from '../i18n.js'
import { toast } from '../state.js'
import { saveBuyer } from '../lib/repo.js'
import { EMPTY_BUYER, REGISTRABLE_ID_TYPES, buyerProblems, normalizeBuyer } from '../lib/buyers.js'
import { BUYER_ID_TYPES } from '../sri/catalog.js'

const props = defineProps({
  buyer: { type: Object, default: null },   // null = nuevo
  buyers: { type: Array, required: true },
})
const emit = defineEmits(['saved', 'cancel'])

const form = reactive({ ...EMPTY_BUYER, ...(props.buyer || {}) })
const saving = ref(false)
const showProblems = ref(false)
const idTypes = BUYER_ID_TYPES.filter((it) => REGISTRABLE_ID_TYPES.includes(it.code))

const problems = computed(() => buyerProblems(form, props.buyers))
const problemAt = (field) => {
  if (!showProblems.value) return ''
  const p = problems.value.find((x) => x.path === `buyer.${field}`)
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
    emit('saved', await saveBuyer(normalizeBuyer(form)))
  } catch (e) {
    console.error('[facturero] save buyer:', e)
    toast(errorText(e), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="stack" novalidate data-testid="buyer-form" @submit.prevent="submit">
    <fieldset class="grid" :disabled="saving">
      <label class="field">
        <span>{{ t('form.idType') }}</span>
        <select v-model="form.idType" data-testid="buyer-id-type">
          <option v-for="it in idTypes" :key="it.code" :value="it.code">{{ t(`idTypes.${it.key}`) }}</option>
        </select>
      </label>
      <label class="field">
        <span>{{ t('form.id') }}</span>
        <input v-model.trim="form.id" autocomplete="off" data-testid="buyer-id" />
        <small v-if="problemAt('id')" class="problem">{{ problemAt('id') }}</small>
      </label>
      <label class="field wide">
        <span>{{ t('form.name') }}</span>
        <input v-model="form.name" autocomplete="off" data-testid="buyer-name" />
        <small v-if="problemAt('name')" class="problem">{{ problemAt('name') }}</small>
      </label>
      <label class="field">
        <span>{{ t('form.email') }}</span>
        <input v-model.trim="form.email" type="email" autocomplete="off" data-testid="buyer-email" />
        <small v-if="problemAt('email')" class="problem">{{ problemAt('email') }}</small>
      </label>
      <label class="field">
        <span>{{ t('form.phone') }} <span class="muted">({{ t('buyers.optional') }})</span></span>
        <input v-model.trim="form.phone" type="tel" autocomplete="off" data-testid="buyer-phone" />
      </label>
      <label class="field wide">
        <span>{{ t('form.address') }} <span class="muted">({{ t('buyers.optional') }})</span></span>
        <input v-model="form.address" autocomplete="off" data-testid="buyer-address" />
        <small v-if="problemAt('address')" class="problem">{{ problemAt('address') }}</small>
      </label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn ghost" :disabled="saving" data-testid="cancel-buyer" @click="emit('cancel')">{{ t('form.cancel') }}</button>
      <button type="submit" class="btn primary" :disabled="saving" data-testid="save-buyer">{{ t('settings.save') }}</button>
    </div>
  </form>
</template>
