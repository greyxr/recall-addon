import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const VIEWER = resolve(import.meta.dirname, '..', 'viewer')

function inside(root: string, path: string): string | null {
  const full = resolve(root, normalize(path).replace(/^([/\\])+/, ''))
  return full.startsWith(root + sep) && existsSync(full) && statSync(full).isFile() ? full : null
}

export function serve(runs: string, port: number) {
  const runsRoot = resolve(runs)
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    const file = path.startsWith('/runs/') ? inside(runsRoot, path.slice(6)) : inside(VIEWER, path === '/' ? 'index.html' : path)
    if (!file) {
      response.writeHead(path === '/runs/index.json' ? 200 : 404, { 'content-type': TYPES['.json'] })
      return response.end(path === '/runs/index.json' ? '[]' : '"not found"')
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    createReadStream(file).pipe(response)
  })
  server.listen(port, '127.0.0.1')
  return server
}

