<script setup>
import { ref, computed } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { requestImporter, attachmentProblem, MAX_ATTACHMENT_BYTES } from '../services/feedback.js'
import ImportCard from './ImportCard.vue'

const text = ref('')
const contact = ref('')
const file = ref(null)
const fileInput = ref(null)
const status = ref('idle')    // idle | sending | sent | error
const sendError = ref('')
const showProblems = ref(false)

const maxMb = MAX_ATTACHMENT_BYTES / (1024 * 1024)
const fileProblem = computed(() => attachmentProblem(file.value))
const problems = computed(() => ({
  text: text.value.trim() ? '' : t('problems.required'),
  contact: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value.trim()) ? '' : t(contact.value.trim() ? 'problems.bad-email' : 'problems.required'),
  file: fileProblem.value ? t(`problems.${fileProblem.value}`, { max: maxMb }) : '',
}))
const valid = computed(() => !problems.value.text && !problems.value.contact && !problems.value.file)

function onFile (e) {
  file.value = e.target.files?.[0] || null
}

async function send () {
  showProblems.value = true
  if (!valid.value) return
  status.value = 'sending'
  sendError.value = ''
  try {
    await requestImporter({ text: text.value.trim(), contact: contact.value.trim(), locale: lang.value, file: file.value })
    status.value = 'sent'
    text.value = ''
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    showProblems.value = false
  } catch (e) {
    console.error('[facturero] request importer:', e)
    status.value = 'error'
    sendError.value = errorText(e)
  }
}
</script>

<template>
  <div class="stack" data-testid="import-view">
    <section class="card stack">
      <h2>{{ t('import.fromFactureroMovil') }}</h2>
      <ImportCard kind="buyers" />
      <ImportCard kind="products" />
    </section>

    <form class="card stack" novalidate data-testid="request-importer" @submit.prevent="send">
      <h2>{{ t('import.request.title') }}</h2>
      <label class="field">
        <span>{{ t('import.request.what') }}</span>
        <textarea v-model="text" rows="3" maxlength="2000" :placeholder="t('import.request.whatPlaceholder')" :disabled="status === 'sending'" data-testid="request-text"></textarea>
        <small v-if="showProblems && problems.text" class="problem">{{ problems.text }}</small>
      </label>
      <label class="field">
        <span>{{ t('import.request.contact') }}</span>
        <input v-model.trim="contact" type="email" autocomplete="email" :disabled="status === 'sending'" data-testid="request-contact" />
        <small v-if="showProblems && problems.contact" class="problem">{{ problems.contact }}</small>
      </label>
      <label class="field">
        <span>{{ t('import.request.file', { max: maxMb }) }}</span>
        <input ref="fileInput" type="file" accept=".xls,.xlsx,.xlsm,.ods,.csv,.txt,.xml,.json,.pdf,.zip" :disabled="status === 'sending'" data-testid="request-file" @change="onFile" />
        <small v-if="problems.file" class="problem" data-testid="request-file-problem">{{ problems.file }}</small>
      </label>
      <p class="banner warn">{{ t('import.request.warning') }}</p>
      <p v-if="status === 'sent'" class="banner" role="status" data-testid="request-sent">{{ t('import.request.sent') }}</p>
      <p v-if="status === 'error'" class="problem" role="alert" data-testid="request-error">{{ sendError }}</p>
      <div class="actions">
        <button type="submit" class="btn primary" :disabled="status === 'sending'" data-testid="request-send">{{ status === 'sending' ? t('import.request.sending') : t('import.request.send') }}</button>
      </div>
    </form>
  </div>
</template>
