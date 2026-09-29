// Logs land in Vercel's function logs (Project > Logs). Request/response bodies are not
// logged in full since they can carry OTP codes and tokens — only shape-level info
// (keys sent, whether progress fields came back) plus status/timing.
export default async function handler(req, res) {
  const domain = req.headers['x-auth0-domain']
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path
  const startedAt = Date.now()

  if (!domain) {
    console.warn(`[auth0-proxy] ${req.method} /${path} - missing x-auth0-domain header`)
    res.status(400).send('Missing x-auth0-domain header')
    return
  }

  console.log(
    `[auth0-proxy] -> ${req.method} https://${domain}/${path} body_keys=${
      req.body ? Object.keys(req.body).join(',') : '(none)'
    }`
  )

  try {
    const upstream = await fetch(`https://${domain}/${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body)
    })
    const text = await upstream.text()
    const durationMs = Date.now() - startedAt

    let responseKeys = '(unparseable)'
    try {
      responseKeys = Object.keys(JSON.parse(text)).join(',') || '(empty)'
    } catch {
      // response wasn't JSON, keep the placeholder
    }

    console.log(
      `[auth0-proxy] <- ${req.method} /${path} status=${upstream.status} duration_ms=${durationMs} response_keys=${responseKeys}`
    )

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(text)
  } catch (e) {
    console.error(`[auth0-proxy] x ${req.method} /${path} error=${e.message}`)
    res.status(502).json({ error: 'proxy_error', error_description: e.message })
  }
}
