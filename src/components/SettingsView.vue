<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { state, refreshSettings, toast } from '../state.js'
import { EMPTY_ISSUER, saveIssuer } from '../lib/repo.js'
import { validateIssuer, cleanText } from '../sri/invoice.js'
import { importSignature, forgetSignature, lock } from '../lib/signature.js'
import { requestUnlock } from './UnlockDialog.vue'

const form = reactive({ ...EMPTY_ISSUER, ...(state.issuer || {}) })
const savingIssuer = ref(false)
const showIssuerProblems = ref(false)
const info = ref(null) // clave de la (i) abierta

const file = ref(null)
const fileInput = ref(null)
const password = ref('')
const importing = ref(false)
const signatureError = ref('')
const replacing = ref(false)
const forgetOpen = ref(false)

watch(() => state.issuer, (v) => { if (v) Object.assign(form, EMPTY_ISSUER, v) })

const issuerProblems = computed(() => {
  const out = []
  validateIssuer({ ...form, nextSequential: Number(form.nextSequential) }, (path, code) => out.push({ path, code }))
  return out
})
const problemAt = (field) => {
  if (!showIssuerProblems.value) return ''
  const p = issuerProblems.value.find((x) => x.path === `issuer.${field}`)
  return p ? t(`problems.${p.code}`) : ''
}
const dirty = computed(() => JSON.stringify(normalized()) !== JSON.stringify(state.issuer ? { ...EMPTY_ISSUER, ...state.issuer } : EMPTY_ISSUER))

function normalized () {
  return {
    ...EMPTY_ISSUER,
    ...form,
    ruc: cleanText(form.ruc),
    legalName: cleanText(form.legalName),
    tradeName: cleanText(form.tradeName),
    matrixAddress: cleanText(form.matrixAddress),
    establishmentAddress: cleanText(form.establishmentAddress),
    establishment: cleanText(form.establishment),
    emissionPoint: cleanText(form.emissionPoint),
    nextSequential: Number(form.nextSequential),
    specialTaxpayer: cleanText(form.specialTaxpayer),
    withholdingAgent: cleanText(form.withholdingAgent),
  }
}

async function submitIssuer () {
  showIssuerProblems.value = true
  if (issuerProblems.value.length) {
    toast(t('errors.invalid-draft'), 'error')
    return
  }
  savingIssuer.value = true
  try {
    await saveIssuer(normalized())
    await refreshSettings()
    showIssuerProblems.value = false
    toast(t('settings.saved'))
  } catch (e) {
    console.error('[facturero] save issuer:', e)
    toast(errorText(e), 'error')
  } finally {
    savingIssuer.value = false
  }
}

function toggleInfo (key) {
  info.value = info.value === key ? null : key
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
    replacing.value = false
    await refreshSettings()
    toast(t('settings.saved'))
  } catch (e) {
    console.error('[facturero] import signature:', e)
    signatureError.value = errorText(e)
  } finally {
    importing.value = false
  }
}

async function forget () {
  forgetOpen.value = false
  try {
    await forgetSignature()
    await refreshSettings()
  } catch (e) {
    console.error('[facturero] forget signature:', e)
    toast(errorText(e), 'error')
  }
}

const fmtDate = (iso) => new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'long' }).format(new Date(iso))
const rucDiffers = computed(() => state.signature?.info?.ruc && state.issuer?.ruc && state.signature.info.ruc !== state.issuer.ruc)
</script>

<template>
  <div class="stack" data-testid="settings">
    <form class="card" novalidate data-testid="issuer-form" @submit.prevent="submitIssuer">
      <h2>{{ t('settings.issuer') }}</h2>
      <fieldset class="grid" :disabled="savingIssuer">
        <label class="field">
          <span>{{ t('settings.ruc') }}</span>
          <input v-model.trim="form.ruc" inputmode="numeric" maxlength="13" autocomplete="off" data-testid="issuer-ruc" />
          <small v-if="problemAt('ruc')" class="problem">{{ problemAt('ruc') }}</small>
        </label>
        <label class="field wide">
          <span>{{ t('settings.legalName') }}</span>
          <input v-model="form.legalName" autocomplete="organization" data-testid="issuer-legal-name" />
          <small v-if="problemAt('legalName')" class="problem">{{ problemAt('legalName') }}</small>
        </label>
        <label class="field wide">
          <span>{{ t('settings.tradeName') }}</span>
          <input v-model="form.tradeName" autocomplete="off" data-testid="issuer-trade-name" />
        </label>
        <label class="field wide">
          <span>{{ t('settings.matrixAddress') }}</span>
          <input v-model="form.matrixAddress" autocomplete="street-address" data-testid="issuer-matrix-address" />
          <small v-if="problemAt('matrixAddress')" class="problem">{{ problemAt('matrixAddress') }}</small>
        </label>
        <label class="field wide">
          <span>{{ t('settings.establishmentAddress') }}</span>
          <input v-model="form.establishmentAddress" autocomplete="off" data-testid="issuer-establishment-address" />
        </label>
        <label class="field">
          <span>{{ t('settings.establishment') }}</span>
          <input v-model.trim="form.establishment" inputmode="numeric" maxlength="3" data-testid="issuer-establishment" />
          <small v-if="problemAt('establishment')" class="problem">{{ problemAt('establishment') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.emissionPoint') }}</span>
          <input v-model.trim="form.emissionPoint" inputmode="numeric" maxlength="3" data-testid="issuer-emission-point" />
          <small v-if="problemAt('emissionPoint')" class="problem">{{ problemAt('emissionPoint') }}</small>
        </label>
        <div class="field">
          <span class="label-row">
            <label for="next-seq">{{ t('settings.nextSequential') }}</label>
            <button type="button" class="i" :aria-expanded="info === 'seq'" :aria-label="t('settings.info')" @click="toggleInfo('seq')">i</button>
          </span>
          <input id="next-seq" v-model.trim="form.nextSequential" inputmode="numeric" data-testid="issuer-next-sequential" />
          <small v-if="info === 'seq'" class="info-text">{{ t('settings.nextSequentialInfo') }}</small>
          <small v-if="problemAt('nextSequential')" class="problem">{{ problemAt('nextSequential') }}</small>
        </div>
        <label class="field check wide">
          <input v-model="form.keepsAccounting" type="checkbox" data-testid="issuer-keeps-accounting" />
          <span>{{ t('settings.keepsAccounting') }}</span>
        </label>
        <label class="field">
          <span>{{ t('settings.specialTaxpayer') }}</span>
          <input v-model.trim="form.specialTaxpayer" autocomplete="off" data-testid="issuer-special-taxpayer" />
          <small v-if="problemAt('specialTaxpayer')" class="problem">{{ problemAt('specialTaxpayer') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.withholdingAgent') }}</span>
          <input v-model.trim="form.withholdingAgent" inputmode="numeric" autocomplete="off" data-testid="issuer-withholding-agent" />
          <small v-if="problemAt('withholdingAgent')" class="problem">{{ problemAt('withholdingAgent') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.rimpe') }}</span>
          <select v-model="form.rimpe" data-testid="issuer-rimpe">
            <option value="">{{ t('settings.rimpeNone') }}</option>
            <option value="entrepreneur">{{ t('settings.rimpeEntrepreneur') }}</option>
            <option value="popular">{{ t('settings.rimpePopular') }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('settings.environment') }}</span>
          <select v-model="form.environment" data-testid="issuer-environment">
            <option value="1">{{ t('settings.envTest') }}</option>
            <option value="2">{{ t('settings.envProd') }}</option>
          </select>
        </label>
        <p v-if="form.environment === '2'" class="banner warn wide">{{ t('settings.envProdWarning') }}</p>
      </fieldset>
      <div class="actions">
        <button type="submit" class="btn primary" :disabled="savingIssuer || !dirty" data-testid="save-issuer">{{ t('settings.save') }}</button>
      </div>
    </form>

    <section class="card" data-testid="signature-section">
      <h2 class="label-row">
        <span>{{ t('settings.signature') }}</span>
        <button type="button" class="i" :aria-expanded="info === 'sig'" :aria-label="t('settings.info')" @click="toggleInfo('sig')">i</button>
      </h2>
      <p v-if="info === 'sig'" class="info-text">{{ t('settings.passwordInfo') }}</p>

      <template v-if="state.signature && !replacing">
        <dl class="facts" data-testid="signature-info">
          <dt>{{ t('settings.holder') }}</dt><dd>{{ state.signature.info.holder }}</dd>
          <dt>{{ t('settings.certIssuer') }}</dt><dd>{{ state.signature.info.issuer }}</dd>
          <dt>{{ t('settings.validTo') }}</dt><dd>{{ fmtDate(state.signature.info.validTo) }}</dd>
          <template v-if="state.signature.info.ruc">
            <dt>{{ t('settings.certRuc') }}</dt><dd>{{ state.signature.info.ruc }}</dd>
          </template>
        </dl>
        <p v-if="rucDiffers" class="banner warn">{{ t('settings.rucDiffers') }}</p>
        <p class="chip" :class="state.signature.unlocked ? 'authorized' : 'signed'" data-testid="signature-state">
          {{ state.signature.unlocked ? t('settings.unlocked') : t('settings.locked') }}
        </p>
        <div class="actions wrap">
          <button type="button" class="btn" :disabled="state.signature.unlocked" data-testid="unlock" @click="requestUnlock()">{{ t('settings.unlock') }}</button>
          <button type="button" class="btn" :disabled="!state.signature.unlocked" data-testid="lock" @click="lock()">{{ t('settings.lock') }}</button>
          <button type="button" class="btn" data-testid="replace-signature" @click="replacing = true">{{ t('settings.replace') }}</button>
          <button type="button" class="btn danger" data-testid="forget-signature" @click="forgetOpen = true">{{ t('settings.forget') }}</button>
        </div>
      </template>

      <form v-else class="stack" data-testid="signature-form" @submit.prevent="submitSignature">
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
          <button v-if="replacing" type="button" class="btn ghost" @click="replacing = false">{{ t('form.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="importing || !file || !password" data-testid="import-signature">{{ t('settings.import') }}</button>
        </div>
      </form>
    </section>

    <div v-if="forgetOpen" class="modal-backdrop" @click.self="forgetOpen = false">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('settings.forgetConfirm')">
        <h2>{{ t('settings.forgetConfirm') }}</h2>
        <p>{{ t('settings.forgetBody') }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="forgetOpen = false">{{ t('form.cancel') }}</button>
          <button type="button" class="btn danger" data-testid="confirm-forget" @click="forget">{{ t('settings.forget') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
