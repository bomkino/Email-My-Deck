// Serve a built site the way Cloudflare Pages does: static files plus the
// headers from its `_headers` file (so the shipped CSP is what gets tested).
// Usage: node scripts/serve-dist.mjs [dir=dist] [port=5173]
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

/** `extra` maps URL paths to local files served alongside the site (test fixtures only). */
export async function serveDist(dir = 'dist', port = 5173, host = '127.0.0.1', extra = new Map()) {
  const root = resolve(dir)
  const rules = parseHeaders(await readFile(join(root, '_headers'), 'utf8').catch(() => ''))
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (extra.has(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.end(await readFile(extra.get(url.pathname)))
      return
    }
    let path = normalize(decodeURIComponent(url.pathname))
    if (path.endsWith('/')) path += 'index.html'
    const file = join(root, path)
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(rules, url.pathname) })
      response.end(body)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise((done) => server.listen(port, host, done))
  return server
}

function parseHeaders(text) {
  const rules = []
  let current = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), set: [], unset: [] }
      rules.push(current)
      continue
    }
    const entry = line.trim()
    if (entry.startsWith('!')) {
      current?.unset.push(entry.slice(1).trim().toLowerCase())
      continue
    }
    const colon = entry.indexOf(':')
    current?.set.push([entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()])
  }
  return rules
}

function matches(pattern, path) {
  const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return regex.test(path)
}

// Like Pages: every matching rule applies; repeated headers are joined with commas; `! Name` removes one.
function headersFor(rules, path) {
  const headers = new Map()
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue
    for (const name of rule.unset) headers.delete(name)
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase()
      headers.set(key, headers.has(key) ? `${headers.get(key)}, ${value}` : value)
    }
  }
  return Object.fromEntries(headers)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = 'dist', port = '5173'] = process.argv.slice(2)
  await serveDist(dir, Number(port))
  console.log(`Serving ${dir} with its _headers at http://127.0.0.1:${port}/`)
}
