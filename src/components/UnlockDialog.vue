<script>
import { reactive } from 'vue'
import { unlockSignature } from '../lib/signature.js'

const prompt = reactive({ open: false, busy: false, error: '', resolve: null, reject: null })

/** Pide la contraseña y desbloquea. Resuelve `true` si se desbloqueó, `false` si se canceló. */
export function requestUnlock () {
  return new Promise((resolve) => {
    Object.assign(prompt, { open: true, busy: false, error: '', resolve })
  })
}
</script>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useBackLayer } from '@dotrino/nav/vue'
import { t, errorText } from '../i18n.js'

const password = ref('')
const input = ref(null)
const open = ref(false)
useBackLayer(open)

watch(() => prompt.open, (v) => {
  open.value = v
  if (v) nextTick(() => input.value?.focus())
})
watch(open, (v) => { if (!v && prompt.open) finish(false) })

function finish (ok) {
  password.value = ''
  prompt.open = false
  open.value = false
  const resolve = prompt.resolve
  prompt.resolve = null
  resolve?.(ok)
}

async function submit () {
  prompt.busy = true
  prompt.error = ''
  try {
    await unlockSignature(password.value)
    finish(true)
  } catch (e) {
    console.error('[facturero] unlock:', e)
    prompt.error = errorText(e)
  } finally {
    prompt.busy = false
  }
}
</script>

<template>
  <div v-if="prompt.open" class="modal-backdrop" @click.self="finish(false)">
    <form class="modal card" role="dialog" aria-modal="true" :aria-label="t('unlock.title')" data-testid="unlock-dialog" @submit.prevent="submit">
      <h2>{{ t('unlock.title') }}</h2>
      <label class="field">
        <span>{{ t('unlock.password') }}</span>
        <input ref="input" v-model="password" type="password" autocomplete="off" data-testid="unlock-password" />
      </label>
      <p v-if="prompt.error" class="problem" role="alert" data-testid="unlock-error">{{ prompt.error }}</p>
      <div class="actions">
        <button type="button" class="btn ghost" @click="finish(false)">{{ t('unlock.cancel') }}</button>
        <button type="submit" class="btn primary" :disabled="prompt.busy || !password" data-testid="unlock-submit">{{ t('unlock.submit') }}</button>
      </div>
    </form>
  </div>
</template>
