<script setup>
import { reactive, ref, computed, watch } from 'vue'
import StepCard from './StepCard.vue'
import { highlightJson, decodeJwt } from './jsonUtils'

const STORAGE_KEY = 'auth0-embedded-debugger:config'

const defaultConfig = {
  domain: '',
  clientId: '',
  connection: '',
  audience: '',
  scope:
    'create:me:authentication_methods update:me:authentication_methods read:me:authentication_methods read:me:connected_accounts delete:me:authentication_methods create:me:connected_accounts offline_access read:me:factors',
  factor: 'email', // 'email' | 'phone'
  identifier: ''
}

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...defaultConfig, ...saved }
  } catch {
    return { ...defaultConfig }
  }
}

const config = reactive(loadConfig())

watch(
  config,
  (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  },
  { deep: true }
)

const cleanDomain = computed(() => config.domain.replace(/^https?:\/\//, '').replace(/\/$/, ''))
const baseUrl = computed(() => `https://${cleanDomain.value}`)
// /e/authorize and /oauth/token (native flow) don't send CORS headers, so requests are routed
// through a server-side proxy: the Vite dev middleware (vite.config.js) locally, or the
// api/auth0-proxy serverless function once deployed. Same path both ways.
const proxyBaseUrl = computed(() => '/api/auth0-proxy')

// -------- shared pipeline state (values steps hand off to each other) --------
const pipeline = reactive({
  authSession: '',
  authorizationCode: '',
  accessToken: null,
  nextActions: []
})

const decodedAccessToken = computed(() => decodeJwt(pipeline.accessToken?.access_token))
const decodedIdToken = computed(() => decodeJwt(pipeline.accessToken?.id_token))

function makeStep(initialBody) {
  return reactive({
    requestBody: initialBody,
    status: 'idle', // idle | loading | success | error
    statusCode: null,
    response: null,
    error: ''
  })
}

function identifyAction() {
  return config.factor === 'phone' ? 'action:identify:phone:v1' : 'action:identify:email:v1'
}
function challengeAction() {
  return config.factor === 'phone' ? 'action:challenge:phone:v1' : 'action:challenge:email:v1'
}
function identifierField() {
  return config.factor === 'phone' ? 'phone_number' : 'email'
}

// ---- Step 1: init ----
const step1 = makeStep(
  JSON.stringify(
    {
      client_id: config.clientId,
      capabilities: ['action:identify:email:v1', 'action:identify:phone:v1'],
      connection: config.connection,
      audience: config.audience,
      scope: config.scope
    },
    null,
    2
  )
)

function refreshStep1Body() {
  step1.requestBody = JSON.stringify(
    {
      client_id: config.clientId,
      capabilities: ['action:identify:email:v1', 'action:identify:phone:v1'],
      connection: config.connection,
      audience: config.audience,
      scope: config.scope
    },
    null,
    2
  )
}

function saveConfig() {
  refreshStep1Body()
  syncStep2()
  syncStep3()
  syncStep4()
}

// ---- Step 2: identify ----
// changes 29/09/2026: added client_id to the payload.
const step2 = makeStep(
  JSON.stringify(
    {
      client_id: config.clientId,
      action: identifyAction(),
      [identifierField()]: config.identifier,
      auth_session: ''
    },
    null,
    2
  )
)

function syncStep2() {
  step2.requestBody = JSON.stringify(
    {
      client_id: config.clientId,
      action: identifyAction(),
      [identifierField()]: config.identifier,
      auth_session: pipeline.authSession
    },
    null,
    2
  )
}

// ---- Step 3: challenge ----
// changes 29/09/2026: added client_id to the payload; added index (the user's enrolled
// factor to challenge — always 0 for a first authentication).
const step3 = makeStep(
  JSON.stringify(
    {
      client_id: config.clientId,
      action: challengeAction(),
      index: 0,
      auth_session: ''
    },
    null,
    2
  )
)

function syncStep3() {
  step3.requestBody = JSON.stringify(
    {
      client_id: config.clientId,
      action: challengeAction(),
      index: 0,
      auth_session: pipeline.authSession
    },
    null,
    2
  )
}

// ---- Step 4: verify ----
// changes 07/10/2026: changed type to "oob" (Out-Of-Band — covers SMS, voice, push
// notifications, and email).
//
// changes 29/09/2026: added client_id to the payload; added type (the authenticator type
// being verified — full list of accepted values not yet identified, "totp" confirmed working).
const otp = ref('')
const step4 = makeStep(
  JSON.stringify(
    {
      client_id: config.clientId,
      action: 'action:verify:otp:v1',
      type: 'oob',
      otp: '',
      auth_session: ''
    },
    null,
    2
  )
)

function syncStep4() {
  step4.requestBody = JSON.stringify(
    {
      client_id: config.clientId,
      action: 'action:verify:otp:v1',
      type: 'oob',
      otp: otp.value,
      auth_session: pipeline.authSession
    },
    null,
    2
  )
}

// ---- Step 5: token exchange ----
const step5 = makeStep(
  JSON.stringify(
    {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code: ''
    },
    null,
    2
  )
)

function syncStep5() {
  step5.requestBody = JSON.stringify(
    {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code: pipeline.authorizationCode
    },
    null,
    2
  )
}

// -------- generic request runner --------
// /e/authorize is a multi-step state machine: intermediate steps respond with HTTP 403
// ("insufficient_authorization") plus an updated auth_session and a `next` array of
// actions to try — that's expected progress, not a failure. Only the final verify call
// returns 200 with an authorization_code. `isProgress` lets each step define what counts
// as "this step worked, move on" independently of the HTTP status code.
async function runStep(step, url, { isProgress, afterSuccess } = {}) {
  step.status = 'loading'
  step.error = ''
  step.response = null
  step.statusCode = null

  let parsedBody
  try {
    parsedBody = JSON.parse(step.requestBody)
  } catch (e) {
    step.status = 'error'
    step.error = `Request body is not valid JSON: ${e.message}`
    return
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth0-domain': cleanDomain.value
      },
      body: JSON.stringify(parsedBody)
    })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text }
    }

    step.statusCode = res.status
    step.response = json

    const progressed = isProgress ? isProgress(json, res) : res.ok

    if (!progressed) {
      step.status = 'error'
      step.error = json.error_description || json.error || `Request failed with status ${res.status}`
      return
    }

    step.status = 'success'
    afterSuccess?.(json)
  } catch (e) {
    step.status = 'error'
    step.error = `Network error: ${e.message}. Make sure the dev server or deployed proxy is reachable (requests are proxied server-side to avoid browser CORS) and the domain is correct.`
  }
}

function sendStep1() {
  runStep(step1, `${proxyBaseUrl.value}/e/authorize`, {
    isProgress: (json) => Boolean(json.auth_session),
    afterSuccess: (json) => {
      pipeline.authSession = json.auth_session
      pipeline.nextActions = json.next || []
      syncStep2()
    }
  })
}

function sendStep2() {
  runStep(step2, `${proxyBaseUrl.value}/e/authorize`, {
    isProgress: (json) => Boolean(json.auth_session),
    afterSuccess: (json) => {
      pipeline.authSession = json.auth_session
      pipeline.nextActions = json.next || []
      syncStep3()
    }
  })
}

function sendStep3() {
  runStep(step3, `${proxyBaseUrl.value}/e/authorize`, {
    isProgress: (json) => Boolean(json.auth_session),
    afterSuccess: (json) => {
      pipeline.authSession = json.auth_session
      pipeline.nextActions = json.next || []
      syncStep4()
    }
  })
}

function sendStep4() {
  runStep(step4, `${proxyBaseUrl.value}/e/authorize`, {
    isProgress: (json) => Boolean(json.auth_session || json.authorization_code),
    afterSuccess: (json) => {
      if (json.auth_session) {
        pipeline.authSession = json.auth_session
        pipeline.nextActions = json.next || []
      }
      if (json.authorization_code) {
        pipeline.authorizationCode = json.authorization_code
        syncStep5()
      }
    }
  })
}

function sendStep5() {
  runStep(step5, `${proxyBaseUrl.value}/oauth/token`, {
    afterSuccess: (json) => {
      pipeline.accessToken = json
    }
  })
}

function resetAll() {
  config.domain = ''
  config.clientId = ''
  config.connection = ''
  config.audience = ''
  config.identifier = ''
  config.factor = 'email'
  otp.value = ''

  pipeline.authSession = ''
  pipeline.authorizationCode = ''
  pipeline.accessToken = null
  pipeline.nextActions = []
  ;[step1, step2, step3, step4, step5].forEach((s) => {
    s.status = 'idle'
    s.statusCode = null
    s.response = null
    s.error = ''
  })
  refreshStep1Body()
  syncStep2()
  syncStep3()
  syncStep4()
  syncStep5()
}

// -------- URL-driven prefill (e.g. links generated by demoPlatform scripts) --------
// Query params matching defaultConfig keys (domain, clientId, connection, audience, scope,
// factor, identifier) override whatever's in localStorage. This only fills the form and
// refreshes step 1's request body — it never submits anything, that's still manual.
function applyUrlParams(cfg) {
  const params = new URLSearchParams(window.location.search)
  let applied = false
  for (const key of Object.keys(defaultConfig)) {
    if (params.has(key)) {
      cfg[key] = params.get(key)
      applied = true
    }
  }
  return applied
}

if (applyUrlParams(config)) {
  saveConfig()
}
</script>

<template>
  <p class="change-note">
    <strong>BETA</strong> — the Embedded feature is currently under development. Changes to the
    API may and will happen, and they will break this testing app.
  </p>

  <div class="top-bar">
    <div>
      <h1>Auth0 Embedded Login — Flow Debugger</h1>
      <p class="subtitle">
        Walk through the embedded/native authentication API (<code>/e/authorize</code>) step by
        step: init → identify → challenge → verify → token exchange. Each step is fired manually
        so you can inspect the exact request/response.
      </p>
    </div>
    <button class="secondary" type="button" @click="resetAll">Reset flow</button>
  </div>

  <div class="panel">
    <h2>Tenant &amp; client configuration</h2>
    <p class="change-note">
      <strong>changes 07/10/2026</strong> — the client used for this flow must have
      <strong>embedded_authorize</strong> enabled (set via the Management API; not yet exposed
      in the Dashboard UI).
    </p>
    <div class="step-inputs">
      <div class="field">
        <label>Auth0 domain</label>
        <input v-model="config.domain" type="text" placeholder="your-tenant.auth0.com" />
      </div>
      <div class="field">
        <label>
          Client ID
          <span class="field-hint">(First-Party, Native, CORS/Web Origins enabled for this app)</span>
        </label>
        <input v-model="config.clientId" type="text" placeholder="client_id" />
      </div>
    </div>
    <div class="step-inputs">
      <div class="field">
        <label>Connection</label>
        <input v-model="config.connection" type="text" />
      </div>
      <div class="field">
        <label>Audience
          <span class="field-hint">(Optional)</span>
        </label>
        <input v-model="config.audience" type="text" />
      </div>
    </div>
    <div class="field">
      <label>Scope</label>
      <input v-model="config.scope" type="text" />
    </div>
    <div class="step-inputs" style="align-items: center">
      <div class="field">
        <label>Identify factor</label>
        <div class="radio-row">
          <label><input type="radio" value="email" v-model="config.factor" /> Email OTP</label>
          <label><input type="radio" value="phone" v-model="config.factor" /> SMS OTP</label>
        </div>
      </div>
      <p class="change-note" style="margin: 0; flex: 1">
        The selected database connection must have only <strong>passwordless email or SMS</strong>
        enabled for this to work currently. Support for password is in progress.
      </p>
    </div>
    <div class="field">
      <label>{{ config.factor === 'phone' ? 'Phone number' : 'Email address' }}</label>
      <input v-model="config.identifier" type="text" />
    </div>
    <button type="button" @click="saveConfig">Save &amp; apply to step 1</button>
  </div>

  <!-- STEP 1 -->
  <StepCard
    :number="1"
    title="Init — start an embedded authorize session"
    description="Starts a new embedded authentication session for this client/connection. The tenant responds with an auth_session token that must be threaded through every subsequent call. Nothing is sent about the user yet — capabilities just tell Auth0 which identify methods this app supports."
    method="POST"
    :url="`${baseUrl}/e/authorize`"
    v-model:requestBody="step1.requestBody"
    :status="step1.status"
    :statusCode="step1.statusCode"
    :response="step1.response"
    :error="step1.error"
    :canSync="false"
    @send="sendStep1"
  >
    <template #extract>
      <h4>Auth0-suggested next action(s)</h4>
      <p class="extract-row" v-if="pipeline.nextActions.length">
        {{ pipeline.nextActions.map((a) => a.action).join(', ') }}
      </p>
      <p class="extract-row" v-else>(none yet)</p>
      <h4 style="margin-top: 12px">auth_session forwarded</h4>
      <p class="extract-row">{{ pipeline.authSession || '(none yet)' }}</p>
    </template>
  </StepCard>

  <!-- STEP 2 -->
  <StepCard
    :number="2"
    title="Identify — declare who is logging in"
    description="Sends the user's identifier (email or phone) along with the current auth_session. Auth0 looks up/creates the identity for this connection and returns an updated auth_session reflecting that an identity has been attached to the flow."
    method="POST"
    :url="`${baseUrl}/e/authorize`"
    v-model:requestBody="step2.requestBody"
    :status="step2.status"
    :statusCode="step2.statusCode"
    :response="step2.response"
    :error="step2.error"
    changeNote="<strong>changes 29/09/2026</strong> — Added <strong>client_id</strong> to the payload."
    @sync="syncStep2"
    @send="sendStep2"
  >
    <template #extract>
      <h4>Auth0-suggested next action(s)</h4>
      <p class="extract-row" v-if="pipeline.nextActions.length">
        {{ pipeline.nextActions.map((a) => a.action).join(', ') }}
      </p>
      <p class="extract-row" v-else>(none yet)</p>
      <h4 style="margin-top: 12px">auth_session forwarded</h4>
      <p class="extract-row">{{ pipeline.authSession || '(none yet)' }}</p>
    </template>
  </StepCard>

  <!-- STEP 3 -->
  <StepCard
    :number="3"
    title="Challenge — trigger the OTP"
    description="Asks Auth0 to actually send a one-time code to the identified email/phone. This is the step that causes the real email or SMS to land in the user's inbox. The returned auth_session now expects a verify call."
    method="POST"
    :url="`${baseUrl}/e/authorize`"
    v-model:requestBody="step3.requestBody"
    :status="step3.status"
    :statusCode="step3.statusCode"
    :response="step3.response"
    :error="step3.error"
    changeNote="<strong>changes 29/09/2026</strong> — Added <strong>client_id</strong> to the payload; added <strong>index</strong> (the user's enrolled factor to challenge — always 0 for first authentication)."
    @sync="syncStep3"
    @send="sendStep3"
  >
    <template #extract>
      <h4>Auth0-suggested next action(s)</h4>
      <p class="extract-row" v-if="pipeline.nextActions.length">
        {{ pipeline.nextActions.map((a) => a.action).join(', ') }}
      </p>
      <p class="extract-row" v-else>(none yet)</p>
      <h4 style="margin-top: 12px">auth_session forwarded</h4>
      <p class="extract-row">{{ pipeline.authSession || '(none yet)' }}</p>
    </template>
  </StepCard>

  <!-- STEP 4 -->
  <StepCard
    :number="4"
    title="Verify — submit the OTP code"
    description="Submits the code the user received via email/SMS along with the auth_session. If correct, Auth0 considers the login complete and returns a short-lived authorization_code, which is what gets exchanged for real tokens next."
    method="POST"
    :url="`${baseUrl}/e/authorize`"
    v-model:requestBody="step4.requestBody"
    :status="step4.status"
    :statusCode="step4.statusCode"
    :response="step4.response"
    :error="step4.error"
    changeNote="<strong>changes 07/10/2026</strong> — Changed <strong>type</strong> to <strong>oob</strong> (Out-Of-Band — covers SMS, voice, push notifications, and email).<br /><br /><strong>changes 29/09/2026</strong> — Added <strong>client_id</strong> to the payload; added <strong>type</strong> (authenticator type being verified — list of accepted values not yet identified, &quot;totp&quot; confirmed working)."
    @sync="syncStep4"
    @send="sendStep4"
  >
    <template #inputs>
      <div class="field">
        <label>OTP code received</label>
        <input v-model="otp" type="text" placeholder="123456" @input="syncStep4" />
      </div>
    </template>
    <template #extract>
      <h4>authorization_code forwarded</h4>
      <p class="extract-row">{{ pipeline.authorizationCode || '(none yet)' }}</p>
    </template>
  </StepCard>

  <!-- STEP 5 -->
  <StepCard
    :number="5"
    title="Token exchange — get real tokens"
    description="Standard OAuth2 authorization_code grant against /oauth/token. Trades the one-time authorization_code from step 4 for the actual access_token / id_token / refresh_token the app will use to call APIs."
    method="POST"
    :url="`${baseUrl}/oauth/token`"
    v-model:requestBody="step5.requestBody"
    :status="step5.status"
    :statusCode="step5.statusCode"
    :response="step5.response"
    :error="step5.error"
    @sync="syncStep5"
    @send="sendStep5"
  >
    <template #extract>
      <template v-if="decodedAccessToken">
        <h4>Decoded access_token</h4>
        <p class="extract-row" style="margin-bottom: 6px">header</p>
        <pre v-html="highlightJson(decodedAccessToken.header)"></pre>
        <p class="extract-row" style="margin: 10px 0 6px">payload</p>
        <pre v-html="highlightJson(decodedAccessToken.payload)"></pre>
      </template>
      <template v-else-if="decodedIdToken">
        <h4>Decoded id_token</h4>
        <p class="extract-row" style="margin-bottom: 6px">
          access_token isn't a JWT (likely opaque) — showing id_token instead
        </p>
        <p class="extract-row" style="margin-bottom: 6px">header</p>
        <pre v-html="highlightJson(decodedIdToken.header)"></pre>
        <p class="extract-row" style="margin: 10px 0 6px">payload</p>
        <pre v-html="highlightJson(decodedIdToken.payload)"></pre>
      </template>
      <template v-else>
        <h4>Tokens received</h4>
        <p class="extract-row">(none yet)</p>
      </template>
    </template>
  </StepCard>
</template>
