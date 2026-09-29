# Auth0 Embedded Login — Flow Debugger

A single-page Vue 3 app for stepping through Auth0's embedded/native
authentication API (`/e/authorize`) one call at a time, so you can inspect
the exact request and response at each stage of the flow.

The flow modeled is:

```
init → identify → challenge → verify (OTP) → token exchange
```

Each step is a card showing the method, URL, an editable JSON request body,
and the raw response. Values returned by one step (`auth_session`,
`authorization_code`, tokens) are automatically threaded into the next
step's request body, but every step is fired manually so nothing happens
without you clicking "Send request".

## Why this exists

`/e/authorize` is a multi-step state machine: intermediate steps respond
with HTTP 403 (`insufficient_authorization`) plus an updated `auth_session`
and a `next` array of suggested actions — that's expected progress, not a
failure. Only the final verify call returns 200 with an
`authorization_code`. This tool makes that state machine visible instead of
opaque, which is useful when debugging connection/action configuration on a
tenant.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL, fill in:

- **Auth0 domain** — e.g. `your-tenant.auth0.com`
- **Client ID**
- **Connection**
- **Audience** / **Scope** (defaults to the scopes needed for MFA
  enrollment/management)
- **Identify factor** — email or SMS OTP, plus the identifier itself

then click **Save & apply to step 1**, and walk through steps 1–5, sending
each request and checking the response before moving to the next.

## CORS proxy

Browsers can't call `https://your-tenant.auth0.com/e/authorize` directly
from `fetch` due to CORS. The Vite dev server (`vite.config.js`) exposes a
`/auth0-proxy` middleware that forwards requests server-side to
`https://<domain>` (read from the `x-auth0-domain` header), sidestepping
CORS entirely. This proxy only runs in `vite dev` — it is dev-tooling, not
something meant to be deployed.

## Token decoding

Step 5's response is inspected client-side: if `access_token` is a JWT it's
decoded and pretty-printed (header + payload); if not (e.g. an opaque
token), `id_token` is decoded instead. Decoding is local `base64url` +
`JSON.parse` — no signature verification, this is a debugging aid only.

## Persistence

Tenant/client configuration (domain, client ID, connection, audience,
scope, factor, identifier) is saved to `localStorage` so you don't have to
re-enter it between sessions. No tokens or OTPs are persisted.

## Stack

- Vue 3 (`<script setup>`, no router, no state library — a handful of
  `reactive`/`ref` objects)
- Vite, with a small custom plugin for the CORS proxy above
- No backend beyond the dev-server proxy

## Project structure

```
index.html          entry HTML
src/main.js          mounts the app
src/App.vue          all flow/state logic + the 5 step definitions
src/StepCard.vue      presentational card: request editor + response viewer
src/jsonUtils.js      JSON syntax highlighting + JWT decoding helpers
src/style.css         dark theme styling
```
