<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { t, errorText } from '../i18n.js'
import { state, usableIssuers, refreshSettings, toast } from '../state.js'
import { computeInvoice, validate } from '../sri/invoice.js'
import { VAT_RATES, DEFAULT_VAT_CODE, BUYER_ID_TYPES, PAYMENT_METHODS, FINAL_CONSUMER_ID, FINAL_CONSUMER_NAME } from '../sri/catalog.js'
import { emitInvoice, correctInvoice } from '../lib/emit.js'
import { currentSigner } from '../lib/signature.js'
import { issuerName } from '../lib/issuers.js'
import { loadDraft, saveDraft, clearDraft } from '../lib/repo.js'
import { money } from '../lib/format.js'
import { requestUnlock } from './UnlockDialog.vue'

const props = defineProps({ correcting: { type: Object, default: null } })
const emit = defineEmits(['emitted', 'cancel-correction', 'settings'])

const vatOptions = VAT_RATES.filter((v) => !v.historic)

const emptyLine = () => ({ code: '', description: '', quantity: '1', unitPrice: '', discount: '', vatCode: DEFAULT_VAT_CODE })
const emptyDraft = (issuerId = '') => ({
  issuerId,
  buyer: { idType: '05', id: '', name: '', email: '', phone: '', address: '' },
  lines: [emptyLine()],
  payments: [{ method: '01' }],
  tip: '0',
})

const draft = reactive(emptyDraft())
const showProblems = ref(false)
const busy = ref(false)
const progress = ref('')
const confirm = reactive({ open: false, resolve: null })
const loaded = ref(false)

const finalConsumer = computed(() => draft.buyer.idType === '07')
const choices = computed(() => usableIssuers())
const issuer = computed(() => state.issuers.find((i) => i.id === draft.issuerId) || null)
const ready = computed(() => Boolean(issuer.value) && choices.value.some((i) => i.id === issuer.value.id))

const problems = computed(() => [
  ...(issuer.value ? [] : [{ path: 'issuerId', code: 'required' }]),
  ...validate(draft, issuer.value).filter((p) => !p.path.startsWith('issuer')),
])
const problemAt = (path) => {
  if (!showProblems.value) return ''
  const p = problems.value.find((x) => x.path === path)
  return p ? t(`problems.${p.code}`) : ''
}
const generalProblems = computed(() => showProblems.value
  ? problems.value.filter((p) => ['lines', 'payments'].includes(p.path) || (p.path === 'buyer.idType' && p.code !== 'required'))
  : [])

const totals = computed(() => {
  try {
    return computeInvoice(draft)
  } catch (e) {
    if (!['bad-decimal', 'discount-exceeds', 'unknown-vat-code'].includes(e.code)) throw e
    return null
  }
})

const vatLabel = (code) => t(`vat.${VAT_RATES.find((v) => v.code === code).key}`)
const lineSubtotal = (i) => totals.value?.lines[i]?.subtotal ?? '—'

function replaceDraft (d) {
  Object.assign(draft, emptyDraft(), JSON.parse(JSON.stringify(d)))
}

// Si el emisor del borrador ya no sirve (se borró o quedó incompleto) y solo hay uno con
// el que se puede facturar, ese queda elegido. Con varios, elige el usuario.
function pickIssuer () {
  if (props.correcting) return
  if (choices.value.some((i) => i.id === draft.issuerId)) return
  draft.issuerId = choices.value.length === 1 ? choices.value[0].id : ''
}

watch(() => draft.buyer.idType, (type, prev) => {
  if (type === '07') {
    draft.buyer.id = FINAL_CONSUMER_ID
    draft.buyer.name = FINAL_CONSUMER_NAME
  } else if (prev === '07') {
    draft.buyer.id = ''
    draft.buyer.name = ''
  }
})

// El borrador se guarda al dejar de escribir, y lo pendiente se guarda ya al salir del
// formulario: cambiar de pestaña o emitir no puede perder lo último que se escribió.
let saveTimer = null
function saveNow () {
  clearTimeout(saveTimer)
  saveTimer = null
  return saveDraft(draft).catch((e) => { console.error('[facturero] draft:', e); toast(errorText(e), 'error') })
}
watch(draft, () => {
  if (!loaded.value || props.correcting) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 800)
}, { deep: true })
onBeforeUnmount(() => { if (saveTimer) saveNow() })

onMounted(async () => {
  try {
    if (props.correcting) replaceDraft({ ...props.correcting.draft, issuerId: props.correcting.issuerId })
    else {
      const saved = await loadDraft()
      if (saved) replaceDraft(saved)
      pickIssuer()
    }
  } catch (e) {
    console.error('[facturero] load draft:', e)
    toast(errorText(e), 'error')
  } finally {
    loaded.value = true
  }
})

function addLine () {
  draft.lines.push(emptyLine())
}

function removeLine (i) {
  draft.lines.splice(i, 1)
}

async function reset () {
  replaceDraft(emptyDraft(draft.issuerId))
  showProblems.value = false
  await clearDraft().catch((e) => toast(errorText(e), 'error'))
}

function askConfirm () {
  return new Promise((resolve) => { Object.assign(confirm, { open: true, resolve }) })
}

function answerConfirm (ok) {
  confirm.open = false
  confirm.resolve?.(ok)
  confirm.resolve = null
}

async function submit () {
  showProblems.value = true
  if (problems.value.length) {
    toast(t('errors.invalid-draft'), 'error')
    return
  }
  if (!currentSigner(issuer.value.id)) {
    const signature = state.signatures.find((s) => s.issuerId === issuer.value.id)
    const unlocked = await requestUnlock(signature)
    if (!unlocked) return
  }
  if (issuer.value.environment === '2' && !(await askConfirm())) return

  busy.value = true
  const onProgress = (step) => { progress.value = t(`form.progress.${step}`) }
  try {
    const invoice = props.correcting
      ? await correctInvoice(props.correcting, draft, { onProgress })
      : await emitInvoice(draft, { onProgress })
    if (!props.correcting) {
      // El siguiente borrador sigue con el mismo emisor, y se guarda ya.
      replaceDraft(emptyDraft(draft.issuerId))
      showProblems.value = false
      await saveNow()
    }
    await refreshSettings()
    emit('emitted', invoice)
  } catch (e) {
    console.error('[facturero] emit:', e)
    toast(errorText(e), 'error')
  } finally {
    busy.value = false
    progress.value = ''
  }
}
</script>

<template>
  <form class="stack" data-testid="invoice-form" novalidate @submit.prevent="submit">
    <div v-if="correcting" class="banner" data-testid="correcting">
      <span>{{ t('form.correcting', { number: correcting.number }) }}</span>
      <button type="button" class="btn ghost small" @click="emit('cancel-correction')">{{ t('form.cancelCorrection') }}</button>
    </div>

    <div v-if="choices.length === 0" class="card readiness" data-testid="needs-issuer">
      <p>{{ t('form.needsIssuer') }}</p>
      <button type="button" class="btn primary" @click="emit('settings')">{{ t('ready.goSettings') }}</button>
    </div>

    <fieldset class="card" :disabled="busy">
      <legend>{{ t('form.issuer') }}</legend>
      <select v-model="draft.issuerId" :disabled="Boolean(correcting) || choices.length === 0" :aria-label="t('form.issuer')" data-testid="issuer-select">
        <option value="">{{ t('form.chooseIssuer') }}</option>
        <!-- Al corregir, el emisor es el de la factura aunque hoy no sirva para emitir. -->
        <option v-if="correcting && issuer && !choices.some((c) => c.id === issuer.id)" :value="issuer.id">{{ issuerName(issuer) }} · RUC {{ issuer.ruc }}</option>
        <option v-for="i in choices" :key="i.id" :value="i.id">
          {{ issuerName(i) }} · RUC {{ i.ruc }} · {{ i.establishment }}-{{ i.emissionPoint }} · {{ i.environment === '2' ? t('settings.envProd') : t('settings.envTest') }}
        </option>
      </select>
      <small v-if="problemAt('issuerId')" class="problem">{{ problemAt('issuerId') }}</small>
      <p v-if="issuer?.environment === '1'" class="banner warn" data-testid="test-env">{{ t('testEnvironment') }}</p>
      <p v-if="issuer" class="muted small" data-testid="next-number">{{ t('form.nextNumber', { number: `${issuer.establishment}-${issuer.emissionPoint}-${String(issuer.nextSequential).padStart(9, '0')}` }) }}</p>
    </fieldset>

    <fieldset class="card" :disabled="busy">
      <legend>{{ t('form.buyer') }}</legend>
      <div class="grid">
        <label class="field">
          <span>{{ t('form.idType') }}</span>
          <select v-model="draft.buyer.idType" data-testid="buyer-id-type">
            <option v-for="it in BUYER_ID_TYPES" :key="it.code" :value="it.code">{{ t(`idTypes.${it.key}`) }}</option>
          </select>
          <small v-if="problemAt('buyer.idType')" class="problem">{{ problemAt('buyer.idType') }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.id') }}</span>
          <input v-model.trim="draft.buyer.id" :disabled="finalConsumer" inputmode="text" autocomplete="off" data-testid="buyer-id" />
          <small v-if="problemAt('buyer.id')" class="problem">{{ problemAt('buyer.id') }}</small>
        </label>
        <label class="field wide">
          <span>{{ t('form.name') }}</span>
          <input v-model="draft.buyer.name" :disabled="finalConsumer" autocomplete="off" data-testid="buyer-name" />
          <small v-if="problemAt('buyer.name')" class="problem">{{ problemAt('buyer.name') }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.email') }}</span>
          <input v-model.trim="draft.buyer.email" type="email" autocomplete="off" data-testid="buyer-email" />
          <small v-if="problemAt('buyer.email')" class="problem">{{ problemAt('buyer.email') }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.phone') }}</span>
          <input v-model.trim="draft.buyer.phone" type="tel" autocomplete="off" data-testid="buyer-phone" />
        </label>
        <label class="field wide">
          <span>{{ t('form.address') }}</span>
          <input v-model="draft.buyer.address" autocomplete="off" data-testid="buyer-address" />
          <small v-if="problemAt('buyer.address')" class="problem">{{ problemAt('buyer.address') }}</small>
        </label>
      </div>
    </fieldset>

    <fieldset class="card" :disabled="busy">
      <legend>{{ t('form.lines') }}</legend>
      <div v-for="(line, i) in draft.lines" :key="i" class="line" :data-line="i" data-testid="line">
        <label class="field wide">
          <span>{{ t('form.description') }}</span>
          <input v-model="line.description" autocomplete="off" data-testid="line-description" />
          <small v-if="problemAt(`lines[${i}].description`)" class="problem">{{ problemAt(`lines[${i}].description`) }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.code') }}</span>
          <input v-model.trim="line.code" autocomplete="off" data-testid="line-code" />
          <small v-if="problemAt(`lines[${i}].code`)" class="problem">{{ problemAt(`lines[${i}].code`) }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.quantity') }}</span>
          <input v-model.trim="line.quantity" inputmode="decimal" data-testid="line-quantity" />
          <small v-if="problemAt(`lines[${i}].quantity`)" class="problem">{{ problemAt(`lines[${i}].quantity`) }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.unitPrice') }}</span>
          <input v-model.trim="line.unitPrice" inputmode="decimal" data-testid="line-unit-price" />
          <small v-if="problemAt(`lines[${i}].unitPrice`)" class="problem">{{ problemAt(`lines[${i}].unitPrice`) }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.discount') }}</span>
          <input v-model.trim="line.discount" inputmode="decimal" placeholder="0" data-testid="line-discount" />
          <small v-if="problemAt(`lines[${i}].discount`)" class="problem">{{ problemAt(`lines[${i}].discount`) }}</small>
        </label>
        <label class="field">
          <span>{{ t('form.vat') }}</span>
          <select v-model="line.vatCode" data-testid="line-vat">
            <option v-for="v in vatOptions" :key="v.code" :value="v.code">{{ t(`vat.${v.key}`) }}</option>
          </select>
        </label>
        <div class="line-foot">
          <span class="muted">{{ t('form.lineTotal') }}: <strong>{{ lineSubtotal(i) }}</strong></span>
          <button type="button" class="btn ghost small" :disabled="draft.lines.length === 1" :aria-label="t('form.removeLine')" data-testid="remove-line" @click="removeLine(i)">✕ {{ t('form.removeLine') }}</button>
        </div>
      </div>
      <button type="button" class="btn ghost" data-testid="add-line" @click="addLine">+ {{ t('form.addLine') }}</button>
    </fieldset>

    <fieldset class="card" :disabled="busy">
      <legend>{{ t('form.payment') }}</legend>
      <select v-model="draft.payments[0].method" :aria-label="t('form.payment')" data-testid="payment-method">
        <option v-for="p in PAYMENT_METHODS" :key="p.code" :value="p.code">{{ t(`payments.${p.key}`) }}</option>
      </select>
    </fieldset>

    <section class="card totals" data-testid="totals">
      <h3>{{ t('form.totals') }}</h3>
      <template v-if="totals">
        <div v-for="tax in totals.taxes" :key="`b${tax.code}`" class="total-row"><span>{{ t('form.subtotalAt', { label: vatLabel(tax.code) }) }}</span><span>{{ money(tax.base) }}</span></div>
        <div class="total-row"><span>{{ t('form.discountTotal') }}</span><span>{{ money(totals.totalDiscount) }}</span></div>
        <div v-for="tax in totals.taxes.filter((x) => x.rate !== '0')" :key="`v${tax.code}`" class="total-row"><span>{{ t('form.vatAt', { label: vatLabel(tax.code) }) }}</span><span>{{ money(tax.value) }}</span></div>
        <div class="total-row grand"><span>{{ t('form.total') }}</span><span data-testid="grand-total">{{ money(totals.total) }}</span></div>
      </template>
      <p v-else class="muted">—</p>
    </section>

    <ul v-if="generalProblems.length" class="problems" role="alert">
      <li v-for="p in generalProblems" :key="p.path + p.code" class="problem">{{ t(`problems.${p.code}`) }}</li>
    </ul>

    <p v-if="progress" class="banner" role="status" data-testid="progress">{{ progress }}</p>

    <div class="actions sticky">
      <button v-if="!correcting" type="button" class="btn ghost" :disabled="busy" data-testid="clear-draft" @click="reset">{{ t('form.clear') }}</button>
      <button type="submit" class="btn primary" :disabled="busy || !ready" :title="!ready ? t('form.chooseIssuer') : ''" data-testid="emit">
        {{ correcting ? t('form.resend') : t('form.emit') }}
      </button>
    </div>

    <div v-if="confirm.open" class="modal-backdrop" @click.self="answerConfirm(false)">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="t('form.confirmTitle')" data-testid="confirm-dialog">
        <h2>{{ t('form.confirmTitle') }}</h2>
        <p>{{ t('form.confirmBody', { total: money(totals?.total ?? '0.00'), buyer: draft.buyer.name, issuer: issuer ? issuerName(issuer) : '' }) }}</p>
        <div class="actions">
          <button type="button" class="btn ghost" @click="answerConfirm(false)">{{ t('form.cancel') }}</button>
          <button type="button" class="btn primary" data-testid="confirm-emit" @click="answerConfirm(true)">{{ t('form.confirm') }}</button>
        </div>
      </div>
    </div>
  </form>
</template>
