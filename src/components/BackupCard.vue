<script setup>
// Dónde están guardados tus datos: en tu bóveda, o solo en este navegador y por qué.
import { ref, computed } from 'vue'
import { t, hasText, errorText, lang } from '../i18n.js'
import { state, syncBackup, toast } from '../state.js'

const busy = ref(false)
const info = ref(false)

const status = computed(() => state.backup)
const backed = computed(() => status.value?.state === 'synced' && status.value.pending === 0)
const inProgress = computed(() => status.value?.state === 'syncing' || (status.value?.state === 'synced' && status.value.pending > 0))

// Sin identidad o sin bóveda enlazada no hay nada que sincronizar: el botón se ve, pero apagado.
const cannotSync = computed(() => !status.value || status.value.state === 'off' || status.value.state === 'syncing')

const headline = computed(() => {
  const s = status.value
  if (!s) return t('backup.checking')
  if (s.state === 'syncing') return t('backup.syncing')
  // Recién guardado: los cambios esperan un momento para subir juntos.
  if (s.state === 'synced' && s.pending > 0) return t('backup.saving')
  return backed.value ? t('backup.backed') : t('backup.localOnly')
})

const reason = computed(() => {
  const s = status.value
  if (!s || s.state === 'syncing' || s.state === 'synced') return ''
  if (s.state === 'off') return hasText(`backup.off.${s.reason}`) ? t(`backup.off.${s.reason}`) : s.reason
  if (s.state === 'error') {
    return hasText(`backup.errors.${s.error?.code}`) ? t(`backup.errors.${s.error.code}`) : t('backup.errors.other', { message: s.error?.message })
  }
  return ''
})

const lastSync = computed(() => {
  const at = status.value?.lastSyncAt
  if (!at) return ''
  return new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
})

async function syncNow () {
  busy.value = true
  try {
    await syncBackup()
  } catch (e) {
    console.error('[facturero] sync backup:', e)
    toast(hasText(`backup.errors.${e?.code}`) ? t(`backup.errors.${e.code}`) : errorText(e), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card stack" data-testid="backup">
    <h2 class="label-row">
      <span>{{ t('backup.title') }}</span>
      <button type="button" class="i" :aria-expanded="info" :aria-label="t('settings.info')" @click="info = !info">i</button>
    </h2>
    <p v-if="info" class="info-text">{{ t('backup.info') }}</p>

    <div class="row between">
      <strong data-testid="backup-headline">{{ headline }}</strong>
      <span class="chip" :class="backed ? 'authorized' : inProgress ? 'signed' : 'rejected'" :data-state="status?.state" data-testid="backup-state">
        {{ backed ? '✓' : inProgress ? '…' : '!' }}
      </span>
    </div>
    <p v-if="reason" class="small" data-testid="backup-reason">{{ reason }}</p>
    <p v-if="status?.pending" class="small" data-testid="backup-pending">{{ t('backup.pending', { count: status.pending }) }}</p>
    <p v-if="status?.tooLarge?.length" class="banner warn" data-testid="backup-too-large">{{ t('backup.tooLarge', { count: status.tooLarge.length }) }}</p>
    <p v-if="lastSync" class="muted small" data-testid="backup-last">{{ t('backup.lastSync', { when: lastSync }) }}</p>
    <p v-if="status?.state === 'off' && status.reason === 'not-paired'" class="small">
      <a :href="`https://wiki.dotrino.com/${lang === 'es' ? '' : 'en/'}vault/emparejar/`" target="_blank" rel="noopener">{{ t('backup.howToLink') }}</a>
    </p>

    <div class="actions">
      <button type="button" class="btn small" :disabled="cannotSync || busy" data-testid="backup-sync" @click="syncNow">
        {{ busy ? t('backup.syncing') : t('backup.syncNow') }}
      </button>
    </div>
  </section>
</template>
