import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const PROXY_PREFIX = '/auth0-proxy'

function auth0ProxyPlugin() {
  return {
    name: 'auth0-domain-proxy',
    configureServer(server) {
      server.middlewares.use(PROXY_PREFIX, async (req, res) => {
        const domain = req.headers['x-auth0-domain']
        if (!domain) {
          res.statusCode = 400
          res.end('Missing x-auth0-domain header')
          return
        }

        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)

        try {
          const upstream = await fetch(`https://${domain}${req.url}`, {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body: body.length ? body : undefined
          })
          const text = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.end(text)
        } catch (e) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: 'proxy_error', error_description: e.message }))
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), auth0ProxyPlugin()],
  server: {
    port: 5173
  }
})
