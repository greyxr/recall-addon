import { PACK_SIZE, slotLetter } from '../game.ts'
import type { Game, Item } from '../game.ts'
import { directionTo, distance, findPath, index, point, same } from '../grid.ts'
import type { Point } from '../grid.ts'
import type { Agent, Session } from '../session.ts'
import type { ToolInput } from '../tools.ts'
import { observe } from '../view.ts'

type Decision = [tool: string, input: ToolInput]

function stepToward(game: Game, goal: (i: number) => boolean, blocked: Set<number>): Point | null {
  const route = (avoid: Set<number>) => findPath(index(game.player.pos), i => game.known[i] && game.walkable(i) && !avoid.has(i), goal)
  const path = route(blocked) ?? route(new Set())
  return path ? point(path[0]) : null
}

function move(game: Game, to: Point, note: string): Decision {
  return ['move', { direction: directionTo(game.player.pos, to), note }]
}

function slotOf(game: Game, wanted: (item: Item) => boolean): string | null {
  const i = game.player.pack.findIndex(wanted)
  return i < 0 ? null : slotLetter(i)
}

export function decide(game: Game): Decision {
  const p = game.player
  const seen = observe(game)
  const blocked = new Set(seen.monsters.map(m => index(m.pos)))
  const hurt = p.hp <= p.maxHp * 0.35

  const upgrade = slotOf(game, item =>
    (item.kind === 'weapon' && item.power > (p.weapon?.power ?? 0)) || (item.kind === 'armor' && item.power > (p.armor?.power ?? 0)),
  )
  if (upgrade) return ['use', { slot: upgrade, note: 'equip an upgrade' }]

  const mapping = slotOf(game, item => item.kind === 'mapping')
  if (mapping) return ['use', { slot: mapping, note: 'read the map' }]

  const adjacent = seen.monsters.filter(m => distance(m.pos, p.pos) === 1).sort((a, b) => a.hp - b.hp)[0]
  if (hurt) {
    const potion = slotOf(game, item => item.kind === 'potion')
    if (potion && (adjacent || seen.monsters.some(m => m.awake))) return ['use', { slot: potion, note: `heal at ${p.hp}/${p.maxHp} HP` }]
    const teleport = slotOf(game, item => item.kind === 'teleport')
    if (teleport && adjacent) return ['use', { slot: teleport, note: 'escape' }]
  }
  if (adjacent) return move(game, adjacent.pos, `fight the ${adjacent.kind.name}`)

  const threat = seen.monsters.filter(m => m.awake).sort((a, b) => distance(a.pos, p.pos) - distance(b.pos, p.pos))[0]
  if (threat) {
    const step = stepToward(game, i => i === index(threat.pos), new Set([...blocked].filter(i => i !== index(threat.pos))))
    if (step) return move(game, step, `engage the ${threat.kind.name}`)
  }

  const here = game.itemAt(index(p.pos))
  const packFull = p.pack.length >= PACK_SIZE
  if (here && (here.kind === 'heart' || !packFull)) return ['pickup', { note: `take the ${here.name}` }]

  if (p.hp < p.maxHp * 0.6 && !seen.monsters.length) return ['wait', { note: 'rest' }]

  const wanted = seen.items.filter(item => item.kind === 'gold' || item.kind === 'heart' || !packFull)
  const loot = new Set(wanted.map(item => index(item.pos!)))
  const toLoot = stepToward(game, i => loot.has(i), blocked)
  if (toLoot) return move(game, toLoot, 'collect loot')

  if (!seen.explored) {
    const toFrontier = stepToward(game, i => game.isFrontier(i), blocked)
    if (toFrontier) return move(game, toFrontier, 'explore')
  }

  if (seen.stairs) {
    if (same(seen.stairs, p.pos)) return ['descend', { note: 'go deeper' }]
    const target = index(seen.stairs)
    const toStairs = stepToward(game, i => i === target, blocked)
    if (toStairs) return move(game, toStairs, 'head for the stairs')
  }

  return ['wait', { note: 'nothing to do' }]
}

export const explorer: Agent = {
  name: 'explorer',
  async play(session: Session) {
    while (!session.done) {
      const [tool, input] = decide(session.game)
      session.call(tool, input)
    }
  },
}
