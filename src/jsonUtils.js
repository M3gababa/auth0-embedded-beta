export function highlightJson(value) {
  if (value === null || value === undefined) return ''
  const json = JSON.stringify(value, null, 2)
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string'
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean'
      } else if (/null/.test(match)) {
        cls = 'json-null'
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : ''
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  const binary = atob(base64)
  const percentEncoded = binary
    .split('')
    .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
  return decodeURIComponent(percentEncoded)
}

export function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return {
      header: JSON.parse(base64UrlDecode(parts[0])),
      payload: JSON.parse(base64UrlDecode(parts[1]))
    }
  } catch {
    return null
  }
}
