import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { claudeAgent, cost } from '../src/agents/claude.ts'
import type { MessagesClient } from '../src/agents/claude.ts'
import { createServer } from '../src/mcp.ts'
import { Session } from '../src/session.ts'

type Message = Anthropic.Beta.BetaMessage
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming

function reply(content: object[], stop: string): Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stop,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
  } as unknown as Message
}

function scripted(responses: Message[]): MessagesClient & { requests: CreateParams[] } {
  const requests: CreateParams[] = []
  return {
    requests,
    beta: {
      messages: {
        async create(params: CreateParams) {
          requests.push(structuredClone(params))
          return responses.shift() ?? reply([{ type: 'text', text: 'done' }], 'end_turn')
        },
      },
    },
  }
}

test('the Claude agent plays through tools, records its reasoning, and tracks cost', async () => {
  const client = scripted([
    reply(
      [
        { type: 'thinking', thinking: 'Scout first.', signature: 's' },
        { type: 'tool_use', id: 't1', name: 'explore', input: {} },
      ],
      'tool_use',
    ),
    reply([{ type: 'tool_use', id: 't2', name: 'move', input: { direction: 'n' } }, { type: 'tool_use', id: 't3', name: 'look', input: {} }], 'tool_use'),
  ])
  const session = new Session({ seed: 1, agent: 'claude-opus-5-5', maxTurns: 100 })
  await claudeAgent({ client, maxCalls: 3 }).play(session)

  assert.equal(session.calls, 3)
  assert.ok(session.replay.frames.some(f => f.thought === 'Scout first.'))
  const second = client.requests[1]
  const results = second.messages.at(-1)!.content as { type: string; tool_use_id: string; content: string }[]
  assert.equal(results[0].tool_use_id, 't1')
  assert.match(results[0].content, /Walked/)
  assert.deepEqual(second.betas, ['compact-2026-01-12', 'server-side-fallback-2026-07-01'])
  assert.equal(second.fallbacks, 'default')
  assert.equal(session.usage!.inputTokens, 200)
  assert.equal(session.usage!.cost, cost('claude-opus-5-5', session.usage!))
})

test('the Claude agent nudges a model that stops calling tools, then gives up', async () => {
  const client = scripted([])
  const session = new Session({ seed: 1, agent: 'claude-haiku-5-5' })
  await claudeAgent({ client, model: 'claude-haiku-5-5' }).play(session)
  assert.equal(client.requests.length, 4)
  assert.equal(client.requests[0].fallbacks, undefined)
  assert.equal(session.calls, 0)
})

test('the Claude agent stops at its budget', async () => {
  const client = scripted(Array.from({ length: 10 }, (_, i) => reply([{ type: 'tool_use', id: `t${i}`, name: 'wait', input: {} }], 'tool_use')))
  const session = new Session({ seed: 1, agent: 'claude-opus-5-5' })
  await claudeAgent({ client, budget: 0.002 }).play(session)
  assert.ok(client.requests.length < 10)
})

test('the MCP server speaks JSON-RPC and saves a replay when the game ends', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-'))
  const server = createServer({ seed: 5, out, maxTurns: 3 })
  const call = async (id: number, method: string, params?: object) => server.receive(JSON.stringify({ jsonrpc: '2.0', id, method, params })) as Promise<any>

  const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'tester' }, capabilities: {} })
  assert.equal(init.result.serverInfo.name, 'dungeon-bench')
  assert.match(init.result.instructions, /Heart of the Deep/)
  assert.equal(await server.receive(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null)

  const list = await call(2, 'tools/list')
  assert.ok(list.result.tools.some((t: { name: string }) => t.name === 'new_game'))
  assert.equal((await call(3, 'nope')).error.code, -32601)
  assert.equal(((await server.receive('{not json')) as any).error.code, -32700)

  for (let i = 0; i < 3; i++) await call(10 + i, 'tools/call', { name: 'wait', arguments: {} })
  const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
  assert.equal(index[0].agent, 'mcp:tester')
  assert.equal(index[0].result.turns, 3)

  const fresh = await call(20, 'tools/call', { name: 'new_game', arguments: { seed: 9 } })
  assert.match(fresh.result.content[0].text, /New game, seed 9/)
})

test('the MCP server runs over stdio', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-stdio-'))
  const child = spawn(process.execPath, ['src/cli.ts', 'mcp', '--seed', '2', '--out', out], { stdio: ['pipe', 'pipe', 'pipe'] })
  const lines: string[] = []
  child.stdout.setEncoding('utf8').on('data', chunk => lines.push(...chunk.split('\n').filter(Boolean)))
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'stdio' }, capabilities: {} } })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'move', arguments: { direction: 'e' } } })
  child.stdin.end()
  await new Promise(resolve => child.on('close', resolve))
  const responses = lines.map(line => JSON.parse(line))
  assert.deepEqual(responses.map(r => r.id), [1, 2])
  assert.match(responses[1].result.content[0].text, /Depth 1 of 8/)
  assert.equal(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))[0].agent, 'mcp:stdio')
})
