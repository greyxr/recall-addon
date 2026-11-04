#!/usr/bin/env node
import { parseArgs } from 'node:util'
import type { Effort } from './agents/claude.ts'
import { bench, parseSeeds, summarize, table } from './bench.ts'
import { MAX_DEPTH } from './game.ts'
import { serveStdio } from './mcp.ts'
import { play } from './play.ts'
import { serve } from './serve.ts'
import { DEFAULT_MAX_TURNS } from './session.ts'
import type { Toolset } from './tools.ts'

const USAGE = `dungeon-bench <command> [options]

Commands
  play                     Play in the terminal.
  bench                    Run agents on seeds and print a leaderboard.
  mcp                      Serve the game over MCP on stdio.
  serve                    Open the replay viewer at http://localhost:<port>.

Options
  --seed <n>               Seed for play and mcp (default 1).
  --seeds <list>           Seeds for bench, like 1-10 or 1,4,9 (default 1-5).
  --agents <list>          explorer, random, claude, or model ids (default explorer,random).
  --toolset <full|primitive>  primitive removes travel, explore and rest (default full).
  --max-turns <n>          Game turn limit per run (default ${DEFAULT_MAX_TURNS}).
  --max-depth <n>          Depth of the Heart (default ${MAX_DEPTH}).
  --model <id>             Model for the claude agent (default claude-opus-5-5).
  --effort <level>         low, medium, high, xhigh or max (default medium).
  --budget <dollars>       Spend cap per Claude run (default 5).
  --max-calls <n>          Tool call cap per Claude run (default 600).
  --out <dir>              Where replays go (default runs).
  --port <n>               Port for serve (default 8080).
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '1-5' },
    agents: { type: 'string', default: 'explorer,random' },
    toolset: { type: 'string', default: 'full' },
    'max-turns': { type: 'string', default: String(DEFAULT_MAX_TURNS) },
    'max-depth': { type: 'string', default: String(MAX_DEPTH) },
    model: { type: 'string' },
    effort: { type: 'string', default: 'medium' },
    budget: { type: 'string', default: '5' },
    'max-calls': { type: 'string', default: '600' },
    out: { type: 'string', default: 'runs' },
    port: { type: 'string', default: '8080' },
    help: { type: 'boolean', short: 'h' },
  },
})

const toolset = values.toolset as Toolset
if (toolset !== 'full' && toolset !== 'primitive') throw new Error('--toolset must be full or primitive')

const game = {
  seed: Number(values.seed),
  toolset,
  maxTurns: Number(values['max-turns']),
  maxDepth: Number(values['max-depth']),
  out: values.out,
}

switch (values.help ? 'help' : positionals[0]) {
  case 'play':
    await play(game)
    break
  case 'mcp':
    await serveStdio(game)
    break
  case 'serve':
    serve(values.out, Number(values.port))
    console.log(`Replay viewer: http://localhost:${values.port}`)
    break
  case 'bench': {
    const rows = await bench({
      ...game,
      agents: values.agents.split(',').map(a => a.trim()),
      seeds: parseSeeds(values.seeds),
      claude: {
        model: values.model,
        effort: values.effort as Effort,
        budget: Number(values.budget),
        maxCalls: Number(values['max-calls']),
      },
      log: line => console.log(line),
    })
    console.log(`\n${table(summarize(rows))}\n\nReplays in ${values.out}/. View them with: dungeon-bench serve`)
    break
  }
  default:
    console.log(USAGE)
}
