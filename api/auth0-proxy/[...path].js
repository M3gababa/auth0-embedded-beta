export default async function handler(req, res) {
  const domain = req.headers['x-auth0-domain']
  if (!domain) {
    res.status(400).send('Missing x-auth0-domain header')
    return
  }

  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path

  try {
    const upstream = await fetch(`https://${domain}/${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body)
    })
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(text)
  } catch (e) {
    res.status(502).json({ error: 'proxy_error', error_description: e.message })
  }
}
