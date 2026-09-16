<script setup>
import { ref, reactive, computed } from 'vue'
import { t, errorText, lang } from '../i18n.js'
import { toast } from '../state.js'
import { EMPTY_ISSUER, saveIssuer } from '../lib/repo.js'
import { issuerProblems } from '../lib/issuers.js'
import { cleanText } from '../sri/invoice.js'

const props = defineProps({
  issuer: { type: Object, default: null },       // null = nuevo
  issuers: { type: Array, required: true },
  signatures: { type: Array, required: true },
})
const emit = defineEmits(['saved', 'cancel'])

const initial = props.issuer
  ? { ...EMPTY_ISSUER, ...props.issuer }
  // Con una sola firma cargada, un emisor nuevo nace con ella elegida.
  : { ...EMPTY_ISSUER, signature: props.signatures.length === 1 ? props.signatures[0].fingerprint : '' }
const form = reactive(initial)
const saving = ref(false)
const showProblems = ref(false)
const info = ref(false)

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

const problems = computed(() => issuerProblems(normalized(), { issuers: props.issuers, signatures: props.signatures }))
const problemAt = (field) => {
  if (!showProblems.value) return ''
  const p = problems.value.find((x) => x.path === `issuer.${field}`)
  return p ? t(`problems.${p.code}`) : ''
}

const fmtDate = (iso) => new Intl.DateTimeFormat(lang.value === 'es' ? 'es-EC' : 'en-US', { dateStyle: 'medium' }).format(new Date(iso))

async function submit () {
  showProblems.value = true
  if (problems.value.length) {
    toast(t('errors.invalid-draft'), 'error')
    return
  }
  saving.value = true
  try {
    const saved = await saveIssuer(normalized())
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
      <label class="field wide">
        <span>{{ t('settings.signatureForIssuer') }}</span>
        <select v-model="form.signature" :disabled="signatures.length === 0" data-testid="issuer-signature">
          <option value="">{{ t('settings.chooseSignature') }}</option>
          <option v-for="s in signatures" :key="s.fingerprint" :value="s.fingerprint">{{ s.info.holder }} · {{ t('settings.validTo') }} {{ fmtDate(s.info.validTo) }}</option>
        </select>
        <small v-if="signatures.length === 0" class="muted">{{ t('settings.noSignaturesYet') }}</small>
        <small v-if="problemAt('signature')" class="problem">{{ problemAt('signature') }}</small>
      </label>
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
    </fieldset>
    <div class="actions">
      <button type="button" class="btn ghost" :disabled="saving" data-testid="cancel-issuer" @click="emit('cancel')">{{ t('form.cancel') }}</button>
      <button type="submit" class="btn primary" :disabled="saving" data-testid="save-issuer">{{ t('settings.save') }}</button>
    </div>
  </form>
</template>
