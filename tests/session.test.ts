import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { explorer } from '../src/agents/explorer.ts'
import { random } from '../src/agents/random.ts'
import { parseSeeds, summarize } from '../src/bench.ts'
import { WIDTH } from '../src/grid.ts'
import { Session, saveReplay } from '../src/session.ts'
import type { Frame } from '../src/session.ts'

test('look is free and shows the map', () => {
  const session = new Session({ seed: 1, agent: 'test' })
  const text = session.call('look')
  assert.equal(session.game.turn, 0)
  assert.match(text, /Depth 1 of 8/)
  assert.match(text, /@/)
})

test('the primitive toolset has no travel, explore or rest', () => {
  const names = new Session({ seed: 1, agent: 'test', toolset: 'primitive' }).tools().map(t => t.name)
  assert.deepEqual(names, ['look', 'move', 'wait', 'pickup', 'use', 'descend'])
  assert.match(new Session({ seed: 1, agent: 'test', toolset: 'primitive' }).call('explore'), /Unknown tool/)
})

test('explore walks until something new appears', () => {
  const session = new Session({ seed: 1, agent: 'test' })
  const text = session.call('explore')
  assert.match(text, /Walked \d+ steps?\./)
  assert.ok(session.game.turn > 0)
})

test('travel follows a known route and rejects unknown squares', () => {
  const session = new Session({ seed: 1, agent: 'test' })
  assert.match(session.call('travel', { x: 0, y: 0 }), /not a known open square/)
  const game = session.game
  const target = game.known.findIndex((known, i) => known && game.walkable(i) && i !== game.player.pos.y * WIDTH + game.player.pos.x)
  const text = session.call('travel', { x: target % WIDTH, y: Math.floor(target / WIDTH) })
  assert.match(text, /Walked/)
})

test('replays record every turn as row deltas and rebuild exactly', () => {
  const session = new Session({ seed: 2, agent: 'test' })
  session.call('explore', { note: 'scout' })
  const frames = session.replay.frames
  assert.equal(frames.length, session.game.turn + 1)
  assert.equal(frames[1].thought, 'scout')
  let rows: string[] = []
  for (const frame of frames as Frame[]) rows = frame.view.map((row, i) => row ?? rows[i])
  assert.ok(rows.join('').includes('@'))
})

test('runs end at the turn limit', async () => {
  const session = new Session({ seed: 3, agent: 'random', maxTurns: 50 })
  await random.play(session)
  assert.ok(session.done)
  assert.equal(session.game.turn, 50)
  assert.match(session.call('wait'), /GAME OVER/)
})

test('the explorer baseline gets deep on every seed', async () => {
  for (let seed = 1; seed <= 4; seed++) {
    const session = new Session({ seed, agent: 'explorer' })
    await explorer.play(session)
    assert.ok(session.game.deepest >= 2, `seed ${seed} reached depth ${session.game.deepest}`)
  }
})

test('replays are saved with an index entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-'))
  const session = new Session({ seed: 1, agent: 'claude:x/y', maxTurns: 5 })
  session.call('wait')
  const file = saveReplay(dir, session.finish())
  assert.match(file, /claude_x_y-seed1\.json$/)
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  assert.equal(index.length, 1)
  assert.equal(index[0].result.turns, 1)
})

test('seed lists and summaries', () => {
  assert.deepEqual(parseSeeds('1-3,7'), [1, 2, 3, 7])
  const result = { score: 300, deepest: 3, won: false, dead: true, cause: 'x', turns: 10, calls: 10, gold: 0, kills: 0, level: 1 }
  const [summary] = summarize([
    { agent: 'a', seed: 1, file: 'f', result },
    { agent: 'a', seed: 2, file: 'g', result: { ...result, score: 500, won: true, dead: false } },
  ])
  assert.equal(summary.meanScore, 400)
  assert.equal(summary.wins, 1)
  assert.equal(summary.deaths, 1)
})
