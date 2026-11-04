import { claudeAgent } from './agents/claude.ts'
import type { ClaudeOptions } from './agents/claude.ts'
import { explorer } from './agents/explorer.ts'
import { random } from './agents/random.ts'
import { Session, saveReplay } from './session.ts'
import type { Agent, Result } from './session.ts'
import type { Toolset } from './tools.ts'

export type BenchOptions = {
  agents: string[]
  seeds: number[]
  out: string
  toolset: Toolset
  maxTurns: number
  maxDepth: number
  claude: ClaudeOptions
  log?: (line: string) => void
}

export type Row = { agent: string; seed: number; file: string; result: Result }

export type Summary = {
  agent: string
  runs: number
  meanScore: number
  meanDepth: number
  wins: number
  deaths: number
  meanTurns: number
  cost: number | null
}

export function makeAgent(name: string, claude: ClaudeOptions): Agent {
  if (name === 'explorer') return explorer
  if (name === 'random') return random
  if (name === 'claude') return claudeAgent(claude)
  if (name.startsWith('claude')) return claudeAgent({ ...claude, model: name.replace(/^claude:/, '') })
  throw new Error(`Unknown agent "${name}". Use explorer, random, claude, or a model id like claude-sonnet-5-5.`)
}

export function parseSeeds(spec: string): number[] {
  return spec.split(',').flatMap(part => {
    const [from, to] = part.split('-').map(Number)
    if (Number.isNaN(from)) throw new Error(`Bad seed list "${spec}"`)
    return to === undefined ? [from] : Array.from({ length: to - from + 1 }, (_, i) => from + i)
  })
}

export function summarize(rows: Row[]): Summary[] {
  const groups = Map.groupBy(rows, row => row.agent)
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  return [...groups].map(([agent, runs]) => {
    const costs = runs.map(r => r.result.usage?.cost).filter((c): c is number => typeof c === 'number')
    return {
      agent,
      runs: runs.length,
      meanScore: mean(runs.map(r => r.result.score)),
      meanDepth: mean(runs.map(r => r.result.deepest)),
      wins: runs.filter(r => r.result.won).length,
      deaths: runs.filter(r => r.result.dead).length,
      meanTurns: mean(runs.map(r => r.result.turns)),
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    }
  }).sort((a, b) => b.meanScore - a.meanScore)
}

export function table(summaries: Summary[]): string {
  const header = ['agent', 'runs', 'score', 'depth', 'wins', 'deaths', 'turns', 'cost']
  const rows = summaries.map(s => [
    s.agent,
    String(s.runs),
    s.meanScore.toFixed(0),
    s.meanDepth.toFixed(2),
    String(s.wins),
    String(s.deaths),
    s.meanTurns.toFixed(0),
    s.cost === null ? '-' : `$${s.cost.toFixed(2)}`,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  return [header, ...rows].map(r => r.map((cell, i) => cell.padEnd(widths[i])).join('  ')).join('\n')
}

export async function bench(options: BenchOptions): Promise<Row[]> {
  const log = options.log ?? (() => {})
  const rows: Row[] = []
  for (const name of options.agents) {
    const agent = makeAgent(name, options.claude)
    for (const seed of options.seeds) {
      const session = new Session({ seed, agent: agent.name, model: agent.model, toolset: options.toolset, maxTurns: options.maxTurns, maxDepth: options.maxDepth })
      try {
        await agent.play(session)
      } catch (error) {
        log(`${agent.name} seed ${seed} stopped with an error: ${(error as Error).message}`)
      }
      const file = saveReplay(options.out, session.finish())
      const result = session.replay.result!
      rows.push({ agent: agent.name, seed, file, result })
      const outcome = result.won ? 'won' : result.dead ? result.cause : 'out of turns'
      log(`${agent.name.padEnd(18)} seed ${String(seed).padEnd(4)} score ${String(result.score).padEnd(5)} depth ${result.deepest}  ${outcome}`)
    }
  }
  return rows
}
