import { article } from './content.ts'
import type { ItemSpec, MonsterKind } from './content.ts'
import { FLOOR, STAIRS, WALL, generateFloor } from './floor.ts'
import type { Floor } from './floor.ts'
import { DIRECTIONS, DIRECTION_NAMES, HEIGHT, WIDTH, add, distance, fieldOfView, findPath, inBounds, index, neighbors, point } from './grid.ts'
import type { Direction, Point } from './grid.ts'
import { Rng, mix } from './rng.ts'

export type Item = ItemSpec & { id: number; pos: Point | null }

export type Monster = { id: number; kind: MonsterKind; pos: Point; hp: number; maxHp: number; awake: boolean }

export type Player = {
  pos: Point
  hp: number
  maxHp: number
  attack: number
  level: number
  xp: number
  gold: number
  weapon: Item | null
  armor: Item | null
  pack: Item[]
}

export type Action =
  | { type: 'move'; direction: Direction }
  | { type: 'wait' }
  | { type: 'pickup' }
  | { type: 'use'; slot: string }
  | { type: 'descend' }

export type Status = 'playing' | 'dead' | 'won'

export const MAX_DEPTH = 8
export const SIGHT = 7
export const PACK_SIZE = 8
export const CHASE_RANGE = 24
export const REGEN_TURNS = 8

export const slotLetter = (i: number) => String.fromCharCode(97 + i)

export class Game {
  readonly seed: number
  readonly maxDepth: number
  readonly player: Player
  floor: Floor
  known: boolean[] = []
  visible = new Set<number>()
  monsters: Monster[] = []
  items: Item[] = []
  turn = 0
  kills = 0
  deepest = 1
  status: Status = 'playing'
  cause: string | null = null
  messages: string[] = []
  private rng: Rng
  private nextId = 1

  constructor(seed: number, maxDepth = MAX_DEPTH) {
    this.seed = seed
    this.maxDepth = maxDepth
    this.rng = new Rng(mix(seed, 0xc0ffee))
    this.player = { pos: { x: 0, y: 0 }, hp: 20, maxHp: 20, attack: 3, level: 1, xp: 0, gold: 0, weapon: null, armor: null, pack: [] }
    this.floor = this.enter(1)
  }

  get depth(): number {
    return this.floor.depth
  }

  get score(): number {
    return this.deepest * 100 + this.player.gold + this.kills * 5 + (this.status === 'won' ? 1000 : 0)
  }

  get attackPower(): number {
    return this.player.attack + (this.player.weapon?.power ?? 0)
  }

  get defense(): number {
    return this.player.armor?.power ?? 0
  }

  walkable(i: number): boolean {
    return this.floor.tiles[i] !== WALL
  }

  monsterAt(i: number): Monster | undefined {
    return this.monsters.find(m => index(m.pos) === i)
  }

  itemAt(i: number): Item | undefined {
    return this.items.find(item => item.pos && index(item.pos) === i)
  }

  isFrontier(i: number): boolean {
    return this.known[i] && this.walkable(i) && neighbors(i).some(n => !this.known[n])
  }

  act(action: Action): boolean {
    this.messages = []
    if (this.status !== 'playing') {
      this.messages.push('The game is over.')
      return false
    }
    const spent = this.perform(action)
    if (spent) this.endTurn()
    return spent
  }

  private enter(depth: number): Floor {
    this.floor = generateFloor(this.seed, depth, this.maxDepth)
    this.known = new Array<boolean>(WIDTH * HEIGHT).fill(false)
    this.monsters = this.floor.monsters.map(m => ({ id: this.nextId++, kind: m.kind, pos: { ...m.pos }, hp: m.kind.hp, maxHp: m.kind.hp, awake: false }))
    this.items = this.floor.items.map(i => ({ ...i.spec, id: this.nextId++, pos: { ...i.pos } }))
    this.player.pos = { ...this.floor.start }
    this.deepest = Math.max(this.deepest, depth)
    this.look()
    return this.floor
  }

  private look() {
    this.visible = fieldOfView(i => this.floor.tiles[i] === WALL, this.player.pos, SIGHT)
    for (const i of this.visible) this.known[i] = true
  }

  private perform(action: Action): boolean {
    switch (action.type) {
      case 'move':
        return this.move(action.direction)
      case 'wait':
        return true
      case 'pickup':
        return this.pickup()
      case 'use':
        return this.use(action.slot)
      case 'descend':
        return this.descend()
    }
  }

  private move(direction: Direction): boolean {
    const step = DIRECTIONS[direction]
    if (!step) {
      this.messages.push(`"${direction}" is not a direction.`)
      return false
    }
    const target = add(this.player.pos, step)
    if (!inBounds(target) || !this.walkable(index(target))) {
      this.messages.push('A wall blocks the way.')
      return false
    }
    const monster = this.monsterAt(index(target))
    if (monster) {
      this.strike(monster)
      return true
    }
    this.player.pos = target
    const item = this.itemAt(index(target))
    if (item?.kind === 'gold') {
      this.player.gold += item.power
      this.items = this.items.filter(i => i !== item)
      this.messages.push(`You pick up ${item.power} gold.`)
    } else if (item) {
      this.messages.push(`You see ${article(item.name)} here.`)
    }
    if (this.floor.tiles[index(target)] === STAIRS) this.messages.push('There are stairs down here.')
    return true
  }

  private roll(attack: number, defense: number): number {
    if (!this.rng.chance(0.8)) return 0
    return Math.max(1, this.rng.int(1, attack) - this.rng.int(0, defense))
  }

  private strike(monster: Monster) {
    monster.awake = true
    const damage = this.roll(this.attackPower, monster.kind.defense)
    const name = monster.kind.name
    if (!damage) return this.messages.push(`You miss the ${name}.`)
    monster.hp -= damage
    if (monster.hp > 0) return this.messages.push(`You hit the ${name} for ${damage}.`)
    this.messages.push(`You kill the ${name}.`)
    this.monsters = this.monsters.filter(m => m !== monster)
    this.kills++
    this.gainXp(monster.kind.xp)
  }

  private gainXp(xp: number) {
    const p = this.player
    p.xp += xp
    while (p.xp >= p.level * 8) {
      p.xp -= p.level * 8
      p.level++
      p.maxHp += 4
      p.hp += 4
      p.attack++
      this.messages.push(`You reach level ${p.level}.`)
    }
  }

  private pickup(): boolean {
    const item = this.itemAt(index(this.player.pos))
    if (!item) {
      this.messages.push('There is nothing here to pick up.')
      return false
    }
    if (item.kind !== 'heart' && this.player.pack.length >= PACK_SIZE) {
      this.messages.push('Your pack is full.')
      return false
    }
    this.items = this.items.filter(i => i !== item)
    item.pos = null
    if (item.kind === 'heart') {
      this.status = 'won'
      this.messages.push('You lift the Heart of the Deep. You win!')
      return true
    }
    this.player.pack.push(item)
    this.messages.push(`You pick up the ${item.name} (${slotLetter(this.player.pack.length - 1)}).`)
    return true
  }

  private use(slot: string): boolean {
    const p = this.player
    const i = (slot ?? '').toLowerCase().charCodeAt(0) - 97
    const item = p.pack[i]
    if (!item) {
      this.messages.push(`There is no item in slot "${slot}".`)
      return false
    }
    const consume = () => p.pack.splice(i, 1)
    switch (item.kind) {
      case 'potion': {
        const before = p.hp
        p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp / 2) + 5)
        consume()
        this.messages.push(`You drink the healing potion and recover ${p.hp - before} HP.`)
        break
      }
      case 'mapping':
        this.floor.tiles.forEach((tile, t) => {
          if (tile !== WALL || neighbors(t).some(n => this.walkable(n))) this.known[t] = true
        })
        consume()
        this.messages.push('You read the scroll. The layout of this floor is revealed.')
        break
      case 'teleport': {
        const open = this.floor.tiles.flatMap((tile, t) => (tile === FLOOR && !this.monsterAt(t) && !this.itemAt(t) ? [t] : []))
        p.pos = point(this.rng.pick(open))
        consume()
        this.look()
        this.messages.push('You read the scroll and vanish. You reappear elsewhere on the floor.')
        break
      }
      case 'weapon':
      case 'armor': {
        const old = item.kind === 'weapon' ? p.weapon : p.armor
        if (item.kind === 'weapon') p.weapon = item
        else p.armor = item
        if (old) p.pack[i] = old
        else consume()
        this.messages.push(`You equip the ${item.name}${old ? ` and stow the ${old.name}` : ''}.`)
        break
      }
      default:
        this.messages.push(`You can't use the ${item.name}.`)
        return false
    }
    return true
  }

  private descend(): boolean {
    if (this.floor.tiles[index(this.player.pos)] !== STAIRS) {
      this.messages.push('There are no stairs here.')
      return false
    }
    this.enter(this.depth + 1)
    this.messages.push(`You descend to depth ${this.depth}.`)
    return true
  }

  private endTurn() {
    this.turn++
    this.look()
    if (this.status !== 'playing') return
    for (const monster of [...this.monsters]) {
      this.monsterTurn(monster)
      if (this.status !== 'playing') return
    }
    const p = this.player
    if (this.turn % REGEN_TURNS === 0 && p.hp < p.maxHp) p.hp++
  }

  private free(i: number): boolean {
    return this.walkable(i) && !this.monsterAt(i) && i !== index(this.player.pos)
  }

  private monsterTurn(m: Monster) {
    if (m.kind.regenerates && m.hp < m.maxHp && this.turn % 2 === 0) m.hp++
    if (m.kind.slow && this.turn % 2 === 1) return
    if (!m.awake) {
      if (this.visible.has(index(m.pos)) && this.rng.chance(0.5)) m.awake = true
      return
    }
    if (distance(m.pos, this.player.pos) === 1) return this.hitPlayer(m)
    if (m.kind.erratic && this.rng.chance(0.5)) {
      const target = add(m.pos, DIRECTIONS[this.rng.pick(DIRECTION_NAMES)])
      if (inBounds(target) && this.free(index(target))) m.pos = target
      return
    }
    const goal = index(this.player.pos)
    const path = findPath(index(m.pos), i => this.free(i), i => i === goal)
    if (path && path.length > 1 && path.length <= CHASE_RANGE) m.pos = point(path[0])
  }

  private hitPlayer(m: Monster) {
    const damage = this.roll(m.kind.attack, this.defense)
    if (!damage) return this.messages.push(`The ${m.kind.name} misses you.`)
    const p = this.player
    p.hp = Math.max(0, p.hp - damage)
    this.messages.push(`The ${m.kind.name} hits you for ${damage}.`)
    if (p.hp > 0) return
    this.status = 'dead'
    this.cause = `killed by ${article(m.kind.name)} on depth ${this.depth}`
    this.messages.push('You die.')
  }
}
