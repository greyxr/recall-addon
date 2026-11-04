import Anthropic from '@anthropic-ai/sdk'
import type { Agent, Session, Usage } from '../session.ts'
import type { ToolInput } from '../tools.ts'

type MessageParam = Anthropic.Beta.BetaMessageParam
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming
type Message = Anthropic.Beta.BetaMessage

export type MessagesClient = { beta: { messages: { create(params: CreateParams): Promise<Message> } } }

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ClaudeOptions = {
  model?: string
  effort?: Effort
  budget?: number
  maxCalls?: number
  client?: MessagesClient
}

export const DEFAULT_MODEL = 'claude-opus-5-5'

const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'])

export function systemPrompt(maxDepth: number): string {
  return [
    'You are playing Dungeon Bench, a turn-based roguelike, through tools.',
    `Goal: reach depth ${maxDepth} and pick up the Heart of the Deep (*), or get as deep as you can. Dying ends the run.`,
    'Score: 100 per deepest depth reached, +1 per gold, +5 per kill, +1000 for winning.',
    'Map legend: @ you, # wall, . floor, > stairs down, $ gold, ! potion, ? scroll, ) weapon, [ armor, * the Heart, letters are monsters. Unseen squares are blank.',
    'Coordinates are (x, y): x grows east (right), y grows south (down).',
    'Every action returns what happened and your updated view. Monsters act after each of your turns.',
    'Play until the game ends. Do not stop to ask questions; there is no one to answer them.',
  ].join('\n')
}

export function cost(model: string, usage: Omit<Usage, 'cost'>): number | null {
  const price = PRICES[model]
  if (!price) return null
  const total =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite
  return total / 1e6
}

function thoughtOf(message: Message): string {
  return message.content
    .map(block => (block.type === 'thinking' ? block.thinking : block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function claudeAgent(options: ClaudeOptions = {}): Agent {
  const model = options.model ?? DEFAULT_MODEL
  const effort = options.effort ?? 'medium'
  const budget = options.budget ?? 5
  const maxCalls = options.maxCalls ?? 600

  return {
    name: model,
    model,
    async play(session: Session) {
      const client: MessagesClient = options.client ?? new Anthropic()
      const tools = session.tools().map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.schema }))
      const fallback = SERVER_FALLBACK_MODELS.has(model)
      const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }
      const messages: MessageParam[] = [
        { role: 'user', content: `New game, seed ${session.game.seed}. Here is your starting view.\n\n${session.observation()}` },
      ]
      session.usage = usage
      let nudges = 0

      while (!session.done && session.calls < maxCalls && (usage.cost ?? 0) < budget) {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: systemPrompt(session.game.maxDepth),
          tools,
          messages,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort },
          cache_control: { type: 'ephemeral' },
          context_management: { edits: [{ type: 'compact_20260112' }] },
          betas: fallback ? ['compact-2026-01-12', 'server-side-fallback-2026-07-01'] : ['compact-2026-01-12'],
          ...(fallback ? { fallbacks: 'default' as const } : {}),
        })

        usage.inputTokens += response.usage.input_tokens
        usage.outputTokens += response.usage.output_tokens
        usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0
        usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0
        usage.cost = cost(model, usage)

        messages.push({ role: 'assistant', content: response.content })
        if (response.stop_reason === 'refusal') break

        const calls = response.content.filter(block => block.type === 'tool_use')
        if (!calls.length) {
          if (++nudges > 3) break
          messages.push({ role: 'user', content: 'The game is still running. Keep playing by calling a tool.' })
          continue
        }
        nudges = 0
        const thought = thoughtOf(response)
        messages.push({
          role: 'user',
          content: calls.map((call, i) => ({
            type: 'tool_result' as const,
            tool_use_id: call.id,
            content: session.call(call.name, call.input as ToolInput, i === 0 ? thought : undefined),
          })),
        })
      }
    },
  }
}
