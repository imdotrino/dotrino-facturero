<script setup>
import { ref, reactive, computed } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { toast } from '../state.js'
import { EMPTY_ISSUER, saveIssuer } from '../lib/repo.js'
import { issuerDataProblems, issuerName } from '../lib/issuers.js'
import { openSignatureFile, attachSignature, copySignature } from '../lib/signature.js'
import { saveLogo, removeLogo } from '../lib/repo.js'
import { prepareLogo, LOGO_TYPES, LOGO_MAX_FILE_BYTES } from '../lib/logo.js'
import { cleanText } from '../sri/invoice.js'

const props = defineProps({
  issuer: { type: Object, default: null },        // null = nuevo
  copyFrom: { type: Object, default: null },      // emisor original al duplicar
  issuers: { type: Array, required: true },
  signatures: { type: Array, required: true },
  logos: { type: Array, required: true },
})
const emit = defineEmits(['saved', 'cancel'])

const form = reactive({ ...EMPTY_ISSUER, ...(props.issuer || {}) })
const saving = ref(false)
const showProblems = ref(false)
const info = ref(false)

// La firma: la que ya tiene el emisor, o la del original si es una copia. Si no hay
// ninguna, o se pide reemplazarla, se carga un archivo.
const current = computed(() => props.signatures.find((s) => s.issuerId === props.issuer?.id) || null)
const source = computed(() => props.copyFrom ? props.signatures.find((s) => s.issuerId === props.copyFrom.id) || null : null)
const kept = computed(() => current.value || source.value)
const replacing = ref(false)
const needsFile = computed(() => !kept.value || replacing.value)
const file = ref(null)
const password = ref('')
const signatureError = ref('')

// El logo: el que ya tiene, el del original si es una copia, o uno nuevo ya reducido. Se
// reduce al elegirlo, para ver cómo queda y avisar antes de guardar si no sirve.
const currentLogo = computed(() => props.logos.find((l) => l.issuerId === props.issuer?.id) || null)
const sourceLogo = computed(() => props.copyFrom ? props.logos.find((l) => l.issuerId === props.copyFrom.id) || null : null)
const newLogo = ref(null)
const dropLogo = ref(false)
const logoError = ref('')
const logoInput = ref(null)
const shownLogo = computed(() => newLogo.value || (dropLogo.value ? null : currentLogo.value || sourceLogo.value))
const logoMaxMb = LOGO_MAX_FILE_BYTES / (1024 * 1024)

async function onLogo (e) {
  const picked = e.target.files?.[0]
  logoError.value = ''
  if (!picked) return
  try {
    newLogo.value = await prepareLogo(picked)
    dropLogo.value = false
  } catch (err) {
    console.error('[facturero] logo:', err)
    logoError.value = errorText(err)
    if (logoInput.value) logoInput.value.value = ''
  }
}

function clearLogo () {
  newLogo.value = null
  dropLogo.value = true
  if (logoInput.value) logoInput.value.value = ''
}

function onFile (e) {
  file.value = e.target.files?.[0] || null
  signatureError.value = ''
}

function normalized () {
  return {
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

const problems = computed(() => [
  ...issuerDataProblems(normalized(), props.issuers),
  ...(needsFile.value && !(file.value && password.value) ? [{ path: 'issuer.signature', code: 'required' }] : []),
])
const problemAt = (field) => {
  if (!showProblems.value) return ''
  const p = problems.value.find((x) => x.path === `issuer.${field}`)
  return p ? t(`problems.${p.code}`) : ''
}

const fmtDate = (iso) => new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'long' }).format(new Date(iso))

async function submit () {
  showProblems.value = true
  signatureError.value = ''
  if (problems.value.length) {
    toast(t('errors.invalid-draft'), 'error')
    return
  }
  saving.value = true
  try {
    // Primero se abre el archivo: con la contraseña equivocada no se guarda nada.
    let opened = null
    if (needsFile.value) {
      try {
        opened = await openSignatureFile(file.value, password.value)
      } catch (e) {
        console.error('[facturero] open signature:', e)
        signatureError.value = errorText(e)
        return
      }
    }
    const saved = await saveIssuer(normalized())
    if (opened) await attachSignature(saved.id, opened)
    else if (!current.value && source.value) await copySignature(props.copyFrom.id, saved.id)
    if (newLogo.value) await saveLogo(saved.id, newLogo.value)
    else if (dropLogo.value) { if (currentLogo.value) await removeLogo(saved.id) }
    else if (!currentLogo.value && sourceLogo.value) await saveLogo(saved.id, sourceLogo.value)
    password.value = ''
    emit('saved', saved)
  } catch (e) {
    console.error('[facturero] save issuer:', e)
    toast(errorText(e), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="stack issuer-form" novalidate data-testid="issuer-form" @submit.prevent="submit">
    <fieldset class="grid" :disabled="saving">
      <label class="field">
        <span>{{ t('settings.ruc') }}</span>
        <input v-model.trim="form.ruc" inputmode="numeric" maxlength="13" autocomplete="off" data-testid="issuer-ruc" />
        <small v-if="problemAt('ruc')" class="problem">{{ problemAt('ruc') }}</small>
      </label>
      <label class="field">
        <span>{{ t('settings.environment') }}</span>
        <select v-model="form.environment" data-testid="issuer-environment">
          <option value="1">{{ t('settings.envTest') }}</option>
          <option value="2">{{ t('settings.envProd') }}</option>
        </select>
      </label>
      <p v-if="form.environment === '2'" class="banner warn wide">{{ t('settings.envProdWarning') }}</p>
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
          <label :for="`next-seq-${issuer?.id || 'new'}`">{{ t('settings.nextSequential') }}</label>
          <button type="button" class="i" :aria-expanded="info" :aria-label="t('settings.info')" @click="info = !info">i</button>
        </span>
        <input :id="`next-seq-${issuer?.id || 'new'}`" v-model.trim="form.nextSequential" inputmode="numeric" data-testid="issuer-next-sequential" />
        <small v-if="info" class="info-text">{{ t('settings.nextSequentialInfo') }}</small>
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

      <div class="field wide sub-card" data-testid="issuer-logo">
        <span class="label-row">{{ t('settings.logo') }}</span>
        <img v-if="shownLogo" :src="shownLogo.dataUrl" :alt="t('settings.logo')" class="logo-preview" data-testid="issuer-logo-preview" />
        <p v-else class="muted small">{{ t('settings.noLogo') }}</p>
        <label class="field">
          <span>{{ t('settings.logoFile', { max: logoMaxMb }) }}</span>
          <input ref="logoInput" type="file" :accept="LOGO_TYPES.join(',')" data-testid="issuer-logo-file" @change="onLogo" />
        </label>
        <div class="actions wrap">
          <button type="button" class="btn small ghost" :disabled="!shownLogo" data-testid="issuer-logo-remove" @click="clearLogo">{{ t('settings.removeLogo') }}</button>
        </div>
        <p v-if="logoError" class="problem" role="alert" data-testid="issuer-logo-error">{{ logoError }}</p>
      </div>

      <div class="field wide sub-card" data-testid="issuer-signature">
        <span class="label-row">{{ t('settings.signature') }}</span>
        <template v-if="kept && !replacing">
          <p data-testid="issuer-signature-kept">
            <strong>{{ kept.info.holder }}</strong> · {{ t('settings.validTo') }} {{ fmtDate(kept.info.validTo) }}
          </p>
          <p v-if="!current && source" class="muted small">{{ t('settings.signatureCopied', { name: issuerName(copyFrom) }) }}</p>
          <div class="actions wrap">
            <button type="button" class="btn small" data-testid="replace-signature" @click="replacing = true">{{ t('settings.replaceSignature') }}</button>
          </div>
        </template>
        <template v-else>
          <label class="field">
            <span>{{ t('settings.file') }}</span>
            <input type="file" accept=".p12,.pfx,application/x-pkcs12" data-testid="signature-file" @change="onFile" />
          </label>
          <label class="field">
            <span>{{ t('settings.password') }}</span>
            <input v-model="password" type="password" autocomplete="off" data-testid="signature-password" />
          </label>
          <small class="info-text">{{ t('settings.passwordNotStored') }}</small>
          <div v-if="kept" class="actions wrap">
            <button type="button" class="btn small ghost" @click="replacing = false; file = null; password = ''">{{ t('settings.keepSignature') }}</button>
          </div>
        </template>
        <small v-if="problemAt('signature')" class="problem">{{ problemAt('signature') }}</small>
        <p v-if="signatureError" class="problem" role="alert" data-testid="signature-error">{{ signatureError }}</p>
      </div>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn ghost" :disabled="saving" data-testid="cancel-issuer" @click="emit('cancel')">{{ t('form.cancel') }}</button>
      <button type="submit" class="btn primary" :disabled="saving" data-testid="save-issuer">{{ t('settings.save') }}</button>
    </div>
  </form>
</template>
