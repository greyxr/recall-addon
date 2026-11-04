import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WALL, generateFloor } from '../src/floor.ts'
import { Game } from '../src/game.ts'
import { DIRECTION_NAMES, findPath, index } from '../src/grid.ts'
import { Rng } from '../src/rng.ts'

function fingerprint(game: Game): string {
  return JSON.stringify([game.turn, game.depth, game.player, game.monsters.map(m => [m.id, m.pos, m.hp]), game.items.map(i => i.id)])
}

function playRandomly(seed: number, steps: number): Game {
  const game = new Game(seed)
  const rng = new Rng(seed)
  for (let i = 0; i < steps && game.status === 'playing'; i++) game.act({ type: 'move', direction: rng.pick(DIRECTION_NAMES) })
  return game
}

test('the same seed and actions always produce the same game', () => {
  assert.equal(fingerprint(playRandomly(42, 300)), fingerprint(playRandomly(42, 300)))
  assert.notEqual(fingerprint(playRandomly(42, 300)), fingerprint(playRandomly(43, 300)))
})

test('floors do not depend on how earlier floors were played', () => {
  assert.deepEqual(generateFloor(9, 3, 8).tiles, generateFloor(9, 3, 8).tiles)
  assert.notDeepEqual(generateFloor(9, 3, 8).tiles, generateFloor(9, 4, 8).tiles)
})

test('every open square, the stairs, and every item are reachable from the start', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (let depth = 1; depth <= 8; depth++) {
      const floor = generateFloor(seed, depth, 8)
      const start = index(floor.start)
      const reachable = (target: number) => target === start || findPath(start, i => floor.tiles[i] !== WALL, i => i === target) !== null
      floor.tiles.forEach((tile, i) => {
        if (tile !== WALL) assert.ok(reachable(i), `seed ${seed} depth ${depth} square ${i}`)
      })
      if (depth < 8) assert.ok(floor.stairs, `seed ${seed} depth ${depth} has stairs`)
      else assert.ok(floor.items.some(item => item.spec.kind === 'heart'), `seed ${seed} has the Heart`)
    }
  }
})

test('walking into a wall costs no turn', () => {
  const game = new Game(1)
  const direction = DIRECTION_NAMES.find(d => !game.act({ type: 'move', direction: d }))
  if (!direction) return
  const turn = game.turn
  game.act({ type: 'move', direction })
  assert.equal(game.turn, turn)
  assert.match(game.messages.join(' '), /wall/)
})

test('fighting a monster eventually kills it and grants xp', () => {
  const game = new Game(3)
  const monster = game.monsters[0]
  monster.pos = { x: game.player.pos.x + 1, y: game.player.pos.y }
  game.player.hp = 999
  game.player.maxHp = 999
  for (let i = 0; i < 100 && game.monsters.includes(monster); i++) game.act({ type: 'move', direction: 'e' })
  assert.ok(!game.monsters.includes(monster))
  assert.equal(game.kills, 1)
})

test('potions heal, gear equips, and stairs lead down', () => {
  const game = new Game(5)
  const p = game.player
  p.hp = 5
  p.pack.push({ id: 900, kind: 'potion', name: 'healing potion', power: 0, pos: null })
  p.pack.push({ id: 901, kind: 'weapon', name: 'war axe', power: 6, pos: null })
  game.act({ type: 'use', slot: 'a' })
  assert.ok(p.hp > 5)
  game.act({ type: 'use', slot: 'a' })
  assert.equal(p.weapon?.name, 'war axe')
  assert.equal(game.attackPower, p.attack + 6)
  p.pos = { ...game.floor.stairs! }
  game.act({ type: 'descend' })
  assert.equal(game.depth, 2)
  assert.equal(game.deepest, 2)
})

test('picking up the Heart wins', () => {
  const game = new Game(2, 1)
  const heart = game.items.find(item => item.kind === 'heart')!
  game.monsters = []
  game.player.pos = { ...heart.pos! }
  game.act({ type: 'pickup' })
  assert.equal(game.status, 'won')
  assert.ok(game.score >= 1100)
})

test('dying ends the game with a cause', () => {
  const game = new Game(4)
  const monster = game.monsters[0]
  monster.pos = { x: game.player.pos.x + 1, y: game.player.pos.y }
  monster.awake = true
  game.player.hp = 1
  for (let i = 0; i < 200 && game.status === 'playing'; i++) game.act({ type: 'wait' })
  assert.equal(game.status, 'dead')
  assert.match(game.cause!, /killed by an? \w+ on depth 1/)
  assert.equal(game.act({ type: 'wait' }), false)
})
