<script setup>
import { ref, computed } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { removeIssuer } from '../lib/repo.js'
import { issuerName, issuerProblems } from '../lib/issuers.js'
import { importSignature, forgetSignature, lock } from '../lib/signature.js'
import { requestUnlock } from './UnlockDialog.vue'
import IssuerForm from './IssuerForm.vue'

// Una sola edición abierta a la vez: el id del emisor, 'new', o null.
const editing = ref(null)
const draftIssuer = ref(null)   // lo que abre el formulario (existente o copia)

const addingSignature = ref(false)
const file = ref(null)
const fileInput = ref(null)
const password = ref('')
const importing = ref(false)
const signatureError = ref('')
const info = ref(false)

const confirm = ref(null)       // { kind: 'issuer'|'signature', target }

const fmtDate = (iso) => new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'long' }).format(new Date(iso))
const signatureOf = (fp) => state.signatures.find((s) => s.fingerprint === fp) || null
const usedBy = (fp) => state.issuers.filter((i) => i.signature === fp)
const problemsOf = (issuer) => issuerProblems(issuer, { issuers: state.issuers, signatures: state.signatures })
const nextNumber = (i) => `${i.establishment}-${i.emissionPoint}-${String(i.nextSequential).padStart(9, '0')}`
const sortedIssuers = computed(() => [...state.issuers].sort((a, b) =>
  issuerName(a).localeCompare(issuerName(b)) || a.environment.localeCompare(b.environment)))

function edit (issuer) {
  draftIssuer.value = issuer
  editing.value = issuer.id
}

function duplicate (issuer) {
  const { id, ...copy } = issuer
  draftIssuer.value = { ...copy, nextSequential: 1 }
  editing.value = 'new'
}

function addIssuer () {
  draftIssuer.value = null
  editing.value = 'new'
}

async function onSaved () {
  editing.value = null
  draftIssuer.value = null
  await refreshSettings()
  toast(t('settings.saved'))
}

function onFile (e) {
  file.value = e.target.files?.[0] || null
  signatureError.value = ''
}

async function submitSignature () {
  importing.value = true
  signatureError.value = ''
  try {
    await importSignature(file.value, password.value)
    password.value = ''
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    addingSignature.value = false
    await refreshSettings()
    toast(t('settings.saved'))
  } catch (e) {
    console.error('[facturero] import signature:', e)
    signatureError.value = errorText(e)
  } finally {
    importing.value = false
  }
}

async function confirmed () {
  const c = confirm.value
  confirm.value = null
  try {
    if (c.kind === 'issuer') await removeIssuer(c.target.id)
    else await forgetSignature(c.target.fingerprint)
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] remove:', e)
    toast(errorText(e), 'error')
  }
}
</script>

<template>
  <div class="stack" data-testid="settings">
    <section class="card stack" data-testid="issuers-section">
      <h2>{{ t('settings.issuers') }}</h2>
      <p v-if="state.issuers.length === 0 && editing !== 'new'" class="muted" data-testid="no-issuers">{{ t('settings.noIssuers') }}</p>

      <ul class="plain-list">
        <li v-for="issuer in sortedIssuers" :key="issuer.id" class="sub-card" :data-issuer-id="issuer.id" data-testid="issuer-item">
          <IssuerForm
            v-if="editing === issuer.id"
            :issuer="draftIssuer" :issuers="state.issuers" :signatures="state.signatures"
            @saved="onSaved" @cancel="editing = null"
          />
          <template v-else>
            <div class="row between">
              <strong>{{ issuerName(issuer) }}</strong>
              <span class="chip" :class="issuer.environment === '2' ? 'authorized' : 'test'">{{ issuer.environment === '2' ? t('settings.envProd') : t('settings.envTest') }}</span>
            </div>
            <p class="muted small">RUC {{ issuer.ruc }} · {{ t('settings.nextInvoice') }} {{ nextNumber(issuer) }}</p>
            <p class="small">
              {{ t('settings.signature') }}:
              <template v-if="signatureOf(issuer.signature)">{{ signatureOf(issuer.signature).info.holder }}</template>
              <span v-else class="problem">{{ t('settings.noSignatureAssigned') }}</span>
            </p>
            <p v-if="signatureOf(issuer.signature)?.info.ruc && signatureOf(issuer.signature).info.ruc !== issuer.ruc" class="banner warn">{{ t('settings.rucDiffers') }}</p>
            <ul v-if="problemsOf(issuer).length" class="problems" data-testid="issuer-problems">
              <li v-for="p in problemsOf(issuer)" :key="p.path + p.code" class="problem">{{ t(`settings.fields.${p.path.replace('issuer.', '')}`) }}: {{ t(`problems.${p.code}`) }}</li>
            </ul>
            <div class="actions wrap">
              <button class="btn small" :disabled="editing !== null" data-testid="edit-issuer" @click="edit(issuer)">✎ {{ t('settings.edit') }}</button>
              <button class="btn small" :disabled="editing !== null" data-testid="duplicate-issuer" @click="duplicate(issuer)">{{ t('settings.duplicate') }}</button>
              <button class="btn small danger" :disabled="editing !== null" data-testid="remove-issuer" @click="confirm = { kind: 'issuer', target: issuer }">✕ {{ t('settings.remove') }}</button>
            </div>
          </template>
        </li>
      </ul>

      <div v-if="editing === 'new'" class="sub-card" data-testid="new-issuer">
        <h3>{{ draftIssuer ? t('settings.duplicateTitle') : t('settings.newIssuer') }}</h3>
        <IssuerForm :issuer="draftIssuer" :issuers="state.issuers" :signatures="state.signatures" @saved="onSaved" @cancel="editing = null" />
      </div>
      <button class="btn" :disabled="editing !== null" data-testid="add-issuer" @click="addIssuer">+ {{ t('settings.addIssuer') }}</button>
    </section>

    <section class="card stack" data-testid="signature-section">
      <h2 class="label-row">
        <span>{{ t('settings.signatures') }}</span>
        <button type="button" class="i" :aria-expanded="info" :aria-label="t('settings.info')" @click="info = !info">i</button>
      </h2>
      <p v-if="info" class="info-text">{{ t('settings.passwordInfo') }}</p>
      <p v-if="state.signatures.length === 0 && !addingSignature" class="muted">{{ t('settings.noSignatures') }}</p>

      <ul class="plain-list">
        <li v-for="s in state.signatures" :key="s.fingerprint" class="sub-card" :data-fingerprint="s.fingerprint" data-testid="signature-item">
          <div class="row between">
            <strong>{{ s.info.holder }}</strong>
            <span class="chip" :class="s.unlocked ? 'authorized' : 'signed'" data-testid="signature-state">{{ s.unlocked ? t('settings.unlocked') : t('settings.locked') }}</span>
          </div>
          <dl class="facts small" data-testid="signature-info">
            <dt>{{ t('settings.certIssuer') }}</dt><dd>{{ s.info.issuer }}</dd>
            <dt>{{ t('settings.validTo') }}</dt><dd>{{ fmtDate(s.info.validTo) }}</dd>
            <template v-if="s.info.ruc"><dt>{{ t('settings.certRuc') }}</dt><dd>{{ s.info.ruc }}</dd></template>
            <dt>{{ t('settings.usedBy') }}</dt><dd>{{ usedBy(s.fingerprint).map(issuerName).join(', ') || '—' }}</dd>
          </dl>
          <div class="actions wrap">
            <button class="btn small" :disabled="s.unlocked" data-testid="unlock" @click="requestUnlock(s)">{{ t('settings.unlock') }}</button>
            <button class="btn small" :disabled="!s.unlocked" data-testid="lock" @click="lock(s.fingerprint)">{{ t('settings.lock') }}</button>
            <button class="btn small danger" :disabled="usedBy(s.fingerprint).length > 0" :title="usedBy(s.fingerprint).length ? t('settings.signatureInUse') : ''" data-testid="forget-signature" @click="confirm = { kind: 'signature', target: s }">✕ {{ t('settings.remove') }}</button>
          </div>
          <p v-if="usedBy(s.fingerprint).length" class="muted small">{{ t('settings.signatureInUse') }}</p>
        </li>
      </ul>

      <form v-if="addingSignature" class="sub-card stack" data-testid="signature-form" @submit.prevent="submitSignature">
        <label class="field">
          <span>{{ t('settings.file') }}</span>
          <input ref="fileInput" type="file" accept=".p12,.pfx,application/x-pkcs12" data-testid="signature-file" @change="onFile" />
        </label>
        <label class="field">
          <span>{{ t('settings.password') }}</span>
          <input v-model="password" type="password" autocomplete="off" data-testid="signature-password" />
        </label>
        <p v-if="signatureError" class="problem" role="alert" data-testid="signature-error">{{ signatureError }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" :disabled="importing" @click="addingSignature = false">{{ t('form.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="importing || !file || !password" data-testid="import-signature">{{ t('settings.import') }}</button>
        </div>
      </form>
      <button class="btn" :disabled="addingSignature" data-testid="add-signature" @click="addingSignature = true">+ {{ t('settings.addSignature') }}</button>
    </section>

    <div v-if="confirm" class="modal-backdrop" @click.self="confirm = null">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('settings.removeConfirm')" data-testid="confirm-remove">
        <h2>{{ confirm.kind === 'issuer' ? t('settings.removeIssuerTitle', { name: issuerName(confirm.target) }) : t('settings.removeSignatureTitle', { name: confirm.target.info.holder }) }}</h2>
        <p>{{ confirm.kind === 'issuer' ? t('settings.removeIssuerBody') : t('settings.removeSignatureBody') }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="confirm = null">{{ t('form.cancel') }}</button>
          <button type="button" class="btn danger" data-testid="confirm-remove-yes" @click="confirmed">{{ t('settings.remove') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
