import { article } from './content.ts'
import { DIRECTION_NAMES, directionTo, findPath, inBounds, index, point } from './grid.ts'
import type { Direction } from './grid.ts'
import type { Session } from './session.ts'
import { observe } from './view.ts'

export type Toolset = 'full' | 'primitive'

export type ToolInput = Record<string, unknown>

export type JsonSchema = { type: 'object'; properties: Record<string, object>; required: string[]; additionalProperties: false }

export type Tool = {
  name: string
  description: string
  schema: JsonSchema
  primitive: boolean
  label(input: ToolInput): string
  run(session: Session, input: ToolInput): string
}

const NOTE = { type: 'string', description: 'Optional one-line reason for this action. Shown in the replay viewer.' }
const WALK_LIMIT = 200

function schema(properties: Record<string, object> = {}, required: string[] = []): JsonSchema {
  return { type: 'object', properties: { ...properties, note: NOTE }, required, additionalProperties: false }
}

function report(session: Session, messages: string[]): string {
  return `${messages.join(' ') || 'Done.'}\n\n${session.observation()}`
}

function interruptions(session: Session): () => string | null {
  const game = session.game
  const start = observe(game)
  const monsters = new Set(start.monsters.map(m => m.id))
  const items = new Set(start.items.map(i => i.id))
  let hp = game.player.hp
  return () => {
    const now = observe(game)
    const hurt = game.player.hp < hp
    hp = game.player.hp
    if (session.done) return 'the game ended'
    if (hurt) return 'you were hurt'
    const monster = now.monsters.find(m => !monsters.has(m.id))
    if (monster) return `${article(monster.kind.name)} came into view`
    const item = now.items.find(i => !items.has(i.id))
    if (item) return `you spotted ${item.kind === 'gold' ? 'gold' : article(item.name)}`
    return null
  }
}

function walk(session: Session, nextStep: () => number | string): string {
  const game = session.game
  const interrupted = interruptions(session)
  const messages: string[] = []
  let steps = 0
  let reason = `Stopped after ${WALK_LIMIT} steps.`
  while (steps < WALK_LIMIT) {
    const next = nextStep()
    if (typeof next === 'string') {
      reason = next
      break
    }
    const depth = game.depth
    messages.push(...session.step({ type: 'move', direction: directionTo(game.player.pos, point(next))! }))
    steps++
    const stop = interrupted()
    if (stop) {
      reason = `Stopped: ${stop}.`
      break
    }
    if (game.depth !== depth) break
  }
  return report(session, [`Walked ${steps} step${steps === 1 ? '' : 's'}.`, ...messages, reason])
}

function routeTo(session: Session, goal: (i: number) => boolean): number[] | null {
  const game = session.game
  const blocked = new Set(observe(game).monsters.map(m => index(m.pos)))
  return findPath(index(game.player.pos), i => game.known[i] && game.walkable(i) && !blocked.has(i), goal)
}

export const TOOLS: Tool[] = [
  {
    name: 'look',
    description: 'Show your stats, pack, the map of everything you have seen, and the monsters and items you know about. Free: does not take a turn.',
    schema: schema(),
    primitive: true,
    label: () => 'look',
    run: session => session.observation(),
  },
  {
    name: 'move',
    description: 'Step one square (n, s, e, w, ne, nw, se, sw). North is up (y decreases). Moving into a monster attacks it. Walking onto gold picks it up. Takes one turn.',
    schema: schema({ direction: { type: 'string', enum: DIRECTION_NAMES } }, ['direction']),
    primitive: true,
    label: input => `move ${input.direction}`,
    run: (session, input) => report(session, session.step({ type: 'move', direction: input.direction as Direction })),
  },
  {
    name: 'wait',
    description: 'Do nothing for one turn.',
    schema: schema(),
    primitive: true,
    label: () => 'wait',
    run: session => report(session, session.step({ type: 'wait' })),
  },
  {
    name: 'pickup',
    description: 'Pick up the item you are standing on. Picking up the Heart of the Deep (*) wins the game. Takes one turn.',
    schema: schema(),
    primitive: true,
    label: () => 'pickup',
    run: session => report(session, session.step({ type: 'pickup' })),
  },
  {
    name: 'use',
    description: 'Use an item from your pack by its slot letter: drink a potion, read a scroll, or equip a weapon or armor (the old one goes back in your pack). Takes one turn.',
    schema: schema({ slot: { type: 'string', pattern: '^[a-h]$' } }, ['slot']),
    primitive: true,
    label: input => `use ${input.slot}`,
    run: (session, input) => report(session, session.step({ type: 'use', slot: String(input.slot) })),
  },
  {
    name: 'descend',
    description: 'Go down the stairs (>) you are standing on. Takes one turn.',
    schema: schema(),
    primitive: true,
    label: () => 'descend',
    run: session => report(session, session.step({ type: 'descend' })),
  },
  {
    name: 'travel',
    description: 'Walk the shortest known route to a map coordinate, one turn per step. Stops early if a monster comes into view, you are hurt, or you spot an item.',
    schema: schema({ x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } }, ['x', 'y']),
    primitive: false,
    label: input => `travel (${input.x},${input.y})`,
    run: (session, input) => {
      const target = { x: Number(input.x), y: Number(input.y) }
      const game = session.game
      if (!inBounds(target) || !game.known[index(target)] || !game.walkable(index(target))) {
        return report(session, [`(${target.x},${target.y}) is not a known open square.`])
      }
      return walk(session, () => {
        if (index(game.player.pos) === index(target)) return 'Arrived.'
        return routeTo(session, i => i === index(target))?.[0] ?? 'No known route.'
      })
    },
  },
  {
    name: 'explore',
    description: 'Walk toward the nearest unexplored area, one turn per step. Stops early if a monster comes into view, you are hurt, you spot an item, or the floor is fully explored.',
    schema: schema(),
    primitive: false,
    label: () => 'explore',
    run: session =>
      walk(session, () => routeTo(session, i => session.game.isFrontier(i))?.[0] ?? 'Nothing left to explore that can be reached.'),
  },
  {
    name: 'rest',
    description: 'Wait until fully healed (you regain 1 HP every 8 turns). Stops if a monster comes into view or you are hurt. Not possible with monsters in view.',
    schema: schema(),
    primitive: false,
    label: () => 'rest',
    run: session => {
      const game = session.game
      if (observe(game).monsters.length) return report(session, ['You cannot rest with monsters in view.'])
      const interrupted = interruptions(session)
      const messages: string[] = []
      const start = game.turn
      let reason = 'You feel fully rested.'
      while (game.player.hp < game.player.maxHp && game.turn - start < WALK_LIMIT) {
        messages.push(...session.step({ type: 'wait' }))
        const stop = interrupted()
        if (stop) {
          reason = `Stopped: ${stop}.`
          break
        }
      }
      return report(session, [`Rested ${game.turn - start} turns.`, ...messages, reason])
    },
  },
]
