import { createInterface } from 'node:readline'
import { Session, saveReplay } from './session.ts'
import type { SessionOptions } from './session.ts'
import type { ToolInput } from './tools.ts'
import { systemPrompt } from './agents/claude.ts'

type Request = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, any> }

class RpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export const PROTOCOL_VERSION = '2025-06-18'

const NEW_GAME = {
  name: 'new_game',
  description: 'Abandon the current game (it is still scored and saved) and start a new one. Uses the next seed unless one is given.',
  inputSchema: { type: 'object', properties: { seed: { type: 'integer' } }, additionalProperties: false },
}

export type McpOptions = Omit<SessionOptions, 'agent'> & { out: string }

export function createServer(options: McpOptions, log: (line: string) => void = () => {}) {
  let client = 'mcp'
  let seed = options.seed
  let session = new Session({ ...options, seed, agent: client })
  let saved = false

  const save = () => {
    if (saved || session.calls === 0) return
    saved = true
    const file = saveReplay(options.out, session.finish())
    log(`saved ${file}`)
  }

  const start = (next: number) => {
    save()
    seed = next
    session = new Session({ ...options, seed, agent: client })
    saved = false
  }

  const text = (body: string, isError = false) => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError } : {}) })

  async function handle(request: Request): Promise<unknown> {
    const params = request.params ?? {}
    switch (request.method) {
      case 'initialize':
        client = `mcp:${params.clientInfo?.name ?? 'client'}`
        start(seed)
        return {
          protocolVersion: params.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'dungeon-bench', version: '0.1.0' },
          instructions: systemPrompt(session.game.maxDepth),
        }
      case 'ping':
        return {}
      case 'tools/list':
        return {
          tools: [
            ...session.tools().map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.schema })),
            NEW_GAME,
          ],
        }
      case 'tools/call': {
        const name = String(params.name)
        const args = (params.arguments ?? {}) as ToolInput
        if (name === NEW_GAME.name) {
          start(typeof args.seed === 'number' ? args.seed : seed + 1)
          return text(`New game, seed ${seed}.\n\n${session.observation()}`)
        }
        if (!session.tools().some(tool => tool.name === name)) return text(`Unknown tool "${name}".`, true)
        const result = session.call(name, args)
        if (session.done) save()
        return text(result)
      }
      default:
        throw new RpcError(-32601, `Method not found: ${request.method}`)
    }
  }

  async function receive(line: string): Promise<object | null> {
    let request: Request
    try {
      request = JSON.parse(line)
    } catch {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
    }
    if (request.id === undefined || request.id === null) return null
    try {
      return { jsonrpc: '2.0', id: request.id, result: await handle(request) }
    } catch (error) {
      const code = error instanceof RpcError ? error.code : -32603
      return { jsonrpc: '2.0', id: request.id, error: { code, message: (error as Error).message } }
    }
  }

  return { receive, save, get session() { return session } }
}

export async function serveStdio(options: McpOptions) {
  const server = createServer(options, line => process.stderr.write(`${line}\n`))
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (!line.trim()) continue
    const response = await server.receive(line)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
  server.save()
}
