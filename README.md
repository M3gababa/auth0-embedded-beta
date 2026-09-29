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

Browsers can't call `https://your-tenant.auth0.com/e/authorize` (or
`/oauth/token`, for this native flow) directly from `fetch` — Auth0 doesn't
send CORS headers for these native/embedded endpoints. Requests are routed
through a server-side proxy at `/api/auth0-proxy/*`, which forwards to
`https://<domain>` (read from the `x-auth0-domain` header). There are two
implementations behind that same path, so the frontend code doesn't need to
care which environment it's running in:

- **Local dev**: the Vite dev server (`vite.config.js`) exposes an
  `auth0ProxyPlugin` middleware.
- **Deployed (e.g. Vercel)**: `api/auth0-proxy/[...path].js` is a serverless
  function that does the same forward. Vercel picks up anything under `api/`
  automatically — no extra config needed.

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
- Vite, with a small custom plugin for the CORS proxy in dev
- A single Vercel serverless function for the same proxy when deployed

## Project structure

```
index.html          entry HTML
api/auth0-proxy/     Vercel serverless function (production CORS proxy)
src/main.js          mounts the app
src/App.vue          all flow/state logic + the 5 step definitions
src/StepCard.vue      presentational card: request editor + response viewer
src/jsonUtils.js      JSON syntax highlighting + JWT decoding helpers
src/style.css         dark theme styling
```
