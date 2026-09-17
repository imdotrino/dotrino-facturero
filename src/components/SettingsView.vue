<script setup>
import { ref, computed } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { removeIssuer } from '../lib/repo.js'
import { issuerName, issuerProblems } from '../lib/issuers.js'
import { lock, forgetSigner } from '../lib/signature.js'
import { requestUnlock } from './UnlockDialog.vue'
import IssuerForm from './IssuerForm.vue'
import BackupCard from './BackupCard.vue'

// Una sola edición abierta a la vez: el id del emisor, 'new', o null.
const editing = ref(null)
const formIssuer = ref(null)    // el emisor que se edita, o los datos de la copia
const copyFrom = ref(null)      // el original, si es una copia
const toRemove = ref(null)
const info = ref(false)

const fmtDate = (iso) => new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'long' }).format(new Date(iso))
const signatureOf = (issuer) => state.signatures.find((s) => s.issuerId === issuer.id) || null
const logoOf = (issuer) => state.logos.find((l) => l.issuerId === issuer.id) || null
const problemsOf = (issuer) => issuerProblems(issuer, { issuers: state.issuers, signatures: state.signatures })
const nextNumber = (i) => `${i.establishment}-${i.emissionPoint}-${String(i.nextSequential).padStart(9, '0')}`
const sortedIssuers = computed(() => [...state.issuers].sort((a, b) =>
  issuerName(a).localeCompare(issuerName(b)) || a.environment.localeCompare(b.environment)))

function edit (issuer) {
  formIssuer.value = issuer
  copyFrom.value = null
  editing.value = issuer.id
}

function duplicate (issuer) {
  const { id, ...copy } = issuer
  formIssuer.value = { ...copy, nextSequential: 1 }
  copyFrom.value = issuer
  editing.value = 'new'
}

function addIssuer () {
  formIssuer.value = null
  copyFrom.value = null
  editing.value = 'new'
}

function close () {
  editing.value = null
  formIssuer.value = null
  copyFrom.value = null
}

async function onSaved () {
  close()
  await refreshSettings()
  toast(t('settings.saved'))
}

async function confirmRemove () {
  const issuer = toRemove.value
  toRemove.value = null
  try {
    await removeIssuer(issuer.id)
    forgetSigner(issuer.id)
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] remove issuer:', e)
    toast(errorText(e), 'error')
  }
}
</script>

<template>
  <div class="stack" data-testid="settings">
    <BackupCard />
    <section class="card stack" data-testid="issuers-section">
      <h2 class="label-row">
        <span>{{ t('settings.issuers') }}</span>
        <button type="button" class="i" :aria-expanded="info" :aria-label="t('settings.info')" @click="info = !info">i</button>
      </h2>
      <p v-if="info" class="info-text">{{ t('settings.issuersInfo') }}</p>
      <p v-if="state.issuers.length === 0 && editing !== 'new'" class="muted" data-testid="no-issuers">{{ t('settings.noIssuers') }}</p>

      <ul class="plain-list">
        <li v-for="issuer in sortedIssuers" :key="issuer.id" class="sub-card" :data-issuer-id="issuer.id" data-testid="issuer-item">
          <IssuerForm
            v-if="editing === issuer.id"
            :issuer="formIssuer" :issuers="state.issuers" :signatures="state.signatures" :logos="state.logos"
            @saved="onSaved" @cancel="close"
          />
          <template v-else>
            <div class="row between">
              <span class="row">
                <img v-if="logoOf(issuer)" :src="logoOf(issuer).dataUrl" alt="" class="logo-thumb" data-testid="issuer-logo-thumb" />
                <strong>{{ issuerName(issuer) }}</strong>
              </span>
              <span class="chip" :class="issuer.environment === '2' ? 'authorized' : 'test'">{{ issuer.environment === '2' ? t('settings.envProd') : t('settings.envTest') }}</span>
            </div>
            <p class="muted small">RUC {{ issuer.ruc }} · {{ t('settings.nextInvoice') }} {{ nextNumber(issuer) }}</p>

            <div v-if="signatureOf(issuer)" class="row between" data-testid="issuer-signature-summary">
              <span class="small">
                {{ t('settings.signature') }}: <strong>{{ signatureOf(issuer).info.holder }}</strong>
                · {{ t('settings.validTo') }} {{ fmtDate(signatureOf(issuer).info.validTo) }}
              </span>
              <span class="chip" :class="signatureOf(issuer).unlocked ? 'authorized' : 'signed'" data-testid="signature-state">
                {{ signatureOf(issuer).unlocked ? t('settings.unlocked') : t('settings.locked') }}
              </span>
            </div>
            <p v-if="signatureOf(issuer)?.info.ruc && signatureOf(issuer).info.ruc !== issuer.ruc" class="banner warn">{{ t('settings.rucDiffers') }}</p>

            <ul v-if="problemsOf(issuer).length" class="problems" data-testid="issuer-problems">
              <li v-for="p in problemsOf(issuer)" :key="p.path + p.code" class="problem">{{ t(`settings.fields.${p.path.replace('issuer.', '')}`) }}: {{ t(`problems.${p.code}`) }}</li>
            </ul>

            <div class="actions wrap">
              <button class="btn small" :disabled="!signatureOf(issuer) || signatureOf(issuer).unlocked" data-testid="unlock" @click="requestUnlock(signatureOf(issuer))">{{ t('settings.unlock') }}</button>
              <button class="btn small" :disabled="!signatureOf(issuer)?.unlocked" data-testid="lock" @click="lock(issuer.id)">{{ t('settings.lock') }}</button>
              <button class="btn small" :disabled="editing !== null" data-testid="edit-issuer" @click="edit(issuer)">✎ {{ t('settings.edit') }}</button>
              <button class="btn small" :disabled="editing !== null" data-testid="duplicate-issuer" @click="duplicate(issuer)">{{ t('settings.duplicate') }}</button>
              <button class="btn small danger" :disabled="editing !== null" data-testid="remove-issuer" @click="toRemove = issuer">✕ {{ t('settings.remove') }}</button>
            </div>
          </template>
        </li>
      </ul>

      <div v-if="editing === 'new'" class="sub-card" data-testid="new-issuer">
        <h3>{{ copyFrom ? t('settings.duplicateTitle', { name: issuerName(copyFrom) }) : t('settings.newIssuer') }}</h3>
        <IssuerForm :issuer="formIssuer" :copy-from="copyFrom" :issuers="state.issuers" :signatures="state.signatures" :logos="state.logos" @saved="onSaved" @cancel="close" />
      </div>
      <button class="btn" :disabled="editing !== null" data-testid="add-issuer" @click="addIssuer">+ {{ t('settings.addIssuer') }}</button>
    </section>

    <div v-if="toRemove" class="modal-backdrop" @click.self="toRemove = null">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('settings.removeIssuerTitle', { name: issuerName(toRemove) })" data-testid="confirm-remove">
        <h2>{{ t('settings.removeIssuerTitle', { name: issuerName(toRemove) }) }}</h2>
        <p>{{ t('settings.removeIssuerBody') }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="toRemove = null">{{ t('form.cancel') }}</button>
          <button type="button" class="btn danger" data-testid="confirm-remove-yes" @click="confirmRemove">{{ t('settings.remove') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
