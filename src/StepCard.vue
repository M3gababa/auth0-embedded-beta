<script setup>
import { highlightJson } from './jsonUtils'

defineProps({
  number: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  method: { type: String, required: true },
  url: { type: String, required: true },
  requestBody: { type: String, required: true },
  status: { type: String, default: 'idle' }, // idle | loading | success | error
  statusCode: { type: [Number, String, null], default: null },
  response: { type: [Object, Array, null], default: null },
  error: { type: String, default: '' },
  canSync: { type: Boolean, default: true }
})

const emit = defineEmits(['update:requestBody', 'send', 'sync'])

function onBodyInput(e) {
  emit('update:requestBody', e.target.value)
}
</script>

<template>
  <div class="step">
    <div class="step-header">
      <div
        class="step-badge"
        :class="{ success: status === 'success', error: status === 'error', loading: status === 'loading' }"
      >
        {{ status === 'success' ? '✓' : status === 'error' ? '✕' : number }}
      </div>
      <div>
        <p class="step-title">{{ title }}</p>
        <p class="step-meta">{{ method }} {{ url }}</p>
      </div>
    </div>
    <div class="step-body">
      <p class="step-desc">{{ description }}</p>

      <div class="step-inputs">
        <slot name="inputs" />
      </div>

      <div class="field">
        <label>Request body (editable JSON — sent as-is)</label>
        <textarea :value="requestBody" @input="onBodyInput" rows="6"></textarea>
      </div>

      <div style="display: flex; gap: 10px">
        <button v-if="canSync" class="secondary" type="button" @click="$emit('sync')">
          Sync from previous step
        </button>
        <button type="button" :disabled="status === 'loading'" @click="$emit('send')">
          {{ status === 'loading' ? 'Sending…' : 'Send request' }}
        </button>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="io-grid" v-if="response">
        <div class="io-block">
          <h4>Response {{ statusCode ? `(${statusCode})` : '' }}</h4>
          <pre v-html="highlightJson(response)"></pre>
        </div>
        <div class="io-block">
          <slot name="extract" />
        </div>
      </div>
    </div>
  </div>
</template>
