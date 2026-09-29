# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A Vue 3 + Vite single-page app that walks through Auth0's embedded/native
auth flow (`/e/authorize`) step by step, for debugging tenant/connection
configuration. See README.md for the full flow and usage.

## Architecture

- All flow state lives in `src/App.vue` as plain `reactive`/`ref` objects —
  no Pinia/Vuex, no router. Five steps (`step1`..`step5`), each created via
  `makeStep()`, plus a shared `pipeline` object that carries values handed
  off between steps (`authSession`, `authorizationCode`, `accessToken`).
- `src/StepCard.vue` is purely presentational: it renders one step's
  request editor + response viewer and emits `send`/`sync`/`update:requestBody`.
  Don't put flow logic in it — it has no knowledge of Auth0 semantics.
- `runStep()` in `App.vue` is the generic request runner all steps go
  through. Its key design point: HTTP status alone doesn't mean
  success/failure for `/e/authorize` — intermediate steps return 403 with
  an `auth_session` and that's progress. Each call site passes its own
  `isProgress(json, res)` predicate rather than relying on `res.ok`. If you
  add a step, follow this pattern rather than checking `res.ok` directly.
- `/e/authorize` and `/oauth/token` (native flow) don't send CORS headers, so
  calls must go through a server-side proxy at `/api/auth0-proxy/*`, which
  forwards to `https://<domain>` (domain from the `x-auth0-domain` header).
  Two implementations share that same path: `vite.config.js`'s
  `auth0ProxyPlugin` (dev-server middleware, `vite dev` only) and
  `api/auth0-proxy/[...path].js` (Vercel serverless function, used once
  deployed/built). Keep both in sync if the forwarding logic changes.

## Conventions already in place

- Request bodies are stored as pretty-printed JSON strings (not objects) in
  each step's `requestBody`, edited directly in a `<textarea>`, and
  `JSON.parse`d right before sending. Keep this "editable raw JSON" model —
  it's intentional, so users can hand-edit requests before sending.
- `syncStepN()` functions rebuild a step's `requestBody` from current
  `config`/`pipeline` state. They're called both on config changes and
  after a previous step succeeds. When adding fields that affect a step's
  body, wire them into the corresponding `syncStepN`, not just the initial
  `makeStep(...)` call.
- Tenant config persists to `localStorage` (`STORAGE_KEY` in `App.vue`) via
  a `deep: true` watcher. Tokens/OTP/pipeline state are intentionally NOT
  persisted — don't add them to `defaultConfig`/`STORAGE_KEY`.
- JWT decoding (`decodeJwt` in `src/jsonUtils.js`) is display-only —
  base64url decode + `JSON.parse`, no signature verification. Don't add
  verification logic here; this tool is explicitly a debugger, not a
  client.

## Commands

```bash
npm install
npm run dev       # starts Vite + the CORS proxy at localhost:5173
npm run build
npm run preview
```

There are no tests and no linter configured in this repo currently.
