import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Game, MAX_DEPTH } from './game.ts'
import type { Action } from './game.ts'
import { HEIGHT, WIDTH } from './grid.ts'
import { TOOLS } from './tools.ts'
import type { Tool, ToolInput, Toolset } from './tools.ts'
import { describe, renderKnown, renderTruth } from './view.ts'

export type Frame = {
  turn: number
  depth: number
  hp: number
  maxHp: number
  level: number
  gold: number
  action: string
  thought?: string
  messages: string[]
  view: (string | null)[]
  truth: (string | null)[]
}

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null }

export type Result = {
  score: number
  deepest: number
  won: boolean
  dead: boolean
  cause: string | null
  turns: number
  calls: number
  gold: number
  kills: number
  level: number
  usage?: Usage
}

export type Replay = {
  version: 1
  agent: string
  model: string | null
  seed: number
  toolset: Toolset
  maxDepth: number
  maxTurns: number
  width: number
  height: number
  started: string
  result: Result | null
  frames: Frame[]
}

export type SessionOptions = {
  seed: number
  agent: string
  model?: string | null
  toolset?: Toolset
  maxTurns?: number
  maxDepth?: number
}

export type Agent = { name: string; model?: string; play(session: Session): Promise<void> }

export const DEFAULT_MAX_TURNS = 3000

function delta(rows: string[], previous: string[]): (string | null)[] {
  return rows.map((row, i) => (row === previous[i] ? null : row))
}

export class Session {
  readonly game: Game
  readonly replay: Replay
  readonly toolset: Toolset
  readonly maxTurns: number
  calls = 0
  usage: Usage | undefined
  private label = 'start'
  private thought: string | undefined
  private lastView: string[] = []
  private lastTruth: string[] = []

  constructor(options: SessionOptions) {
    this.toolset = options.toolset ?? 'full'
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
    this.game = new Game(options.seed, options.maxDepth ?? MAX_DEPTH)
    this.replay = {
      version: 1,
      agent: options.agent,
      model: options.model ?? null,
      seed: options.seed,
      toolset: this.toolset,
      maxDepth: this.game.maxDepth,
      maxTurns: this.maxTurns,
      width: WIDTH,
      height: HEIGHT,
      started: new Date().toISOString(),
      result: null,
      frames: [],
    }
    this.record()
  }

  get done(): boolean {
    return this.game.status !== 'playing' || this.game.turn >= this.maxTurns
  }

  tools(): Tool[] {
    return TOOLS.filter(tool => this.toolset === 'full' || tool.primitive)
  }

  call(name: string, input: ToolInput = {}, thought?: string): string {
    const tool = this.tools().find(t => t.name === name)
    if (!tool) return `Unknown tool "${name}". Available tools: ${this.tools().map(t => t.name).join(', ')}.`
    if (this.done) return this.summary()
    this.calls++
    this.label = tool.label(input)
    this.thought = [thought, typeof input.note === 'string' ? input.note : ''].filter(Boolean).join('\n') || undefined
    const text = tool.run(this, input)
    return this.done ? `${text}\n\n${this.summary()}` : text
  }

  step(action: Action): string[] {
    this.game.act(action)
    this.record()
    return this.game.messages
  }

  observation(): string {
    return describe(this.game)
  }

  summary(): string {
    const g = this.game
    const end = g.status === 'won' ? 'You won!' : g.status === 'dead' ? `You died: ${g.cause}.` : `The turn limit (${this.maxTurns}) was reached.`
    return `GAME OVER. ${end} Final score ${g.score} (deepest depth ${g.deepest}, gold ${g.player.gold}, kills ${g.kills}, turns ${g.turn}).`
  }

  result(): Result {
    const g = this.game
    return {
      score: g.score,
      deepest: g.deepest,
      won: g.status === 'won',
      dead: g.status === 'dead',
      cause: g.cause,
      turns: g.turn,
      calls: this.calls,
      gold: g.player.gold,
      kills: g.kills,
      level: g.player.level,
      ...(this.usage ? { usage: this.usage } : {}),
    }
  }

  finish(): Replay {
    this.replay.result = this.result()
    return this.replay
  }

  private record() {
    const g = this.game
    const view = renderKnown(g)
    const truth = renderTruth(g)
    this.replay.frames.push({
      turn: g.turn,
      depth: g.depth,
      hp: g.player.hp,
      maxHp: g.player.maxHp,
      level: g.player.level,
      gold: g.player.gold,
      action: this.label,
      ...(this.thought ? { thought: this.thought } : {}),
      messages: [...g.messages],
      view: delta(view, this.lastView),
      truth: delta(truth, this.lastTruth),
    })
    this.thought = undefined
    this.lastView = view
    this.lastTruth = truth
  }
}

export type IndexEntry = { file: string; agent: string; model: string | null; seed: number; toolset: Toolset; started: string; result: Result }

export function saveReplay(dir: string, replay: Replay): string {
  mkdirSync(dir, { recursive: true })
  const stamp = replay.started.replace(/[-:]/g, '').replace(/\..*/, '')
  const file = `${stamp}-${replay.agent.replace(/[^\w.-]+/g, '_')}-seed${replay.seed}.json`
  writeFileSync(join(dir, file), JSON.stringify(replay))
  const indexPath = join(dir, 'index.json')
  let entries: IndexEntry[] = []
  try {
    entries = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {}
  const { agent, model, seed, toolset, started } = replay
  entries.push({ file, agent, model, seed, toolset, started, result: replay.result! })
  writeFileSync(indexPath, JSON.stringify(entries, null, 1))
  return join(dir, file)
}
