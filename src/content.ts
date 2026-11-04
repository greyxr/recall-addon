import type { Rng } from './rng.ts'

export type MonsterKind = {
  name: string
  glyph: string
  hp: number
  attack: number
  defense: number
  xp: number
  depths: [number, number]
  slow?: boolean
  erratic?: boolean
  regenerates?: boolean
}

export const MONSTERS: MonsterKind[] = [
  { name: 'rat', glyph: 'r', hp: 4, attack: 2, defense: 0, xp: 1, depths: [1, 3] },
  { name: 'bat', glyph: 'b', hp: 3, attack: 2, defense: 0, xp: 1, depths: [1, 4], erratic: true },
  { name: 'slime', glyph: 's', hp: 9, attack: 3, defense: 0, xp: 2, depths: [2, 5], slow: true },
  { name: 'goblin', glyph: 'g', hp: 8, attack: 4, defense: 1, xp: 3, depths: [2, 6] },
  { name: 'zombie', glyph: 'z', hp: 16, attack: 5, defense: 1, xp: 5, depths: [3, 8], slow: true },
  { name: 'orc', glyph: 'o', hp: 15, attack: 6, defense: 2, xp: 6, depths: [4, 8] },
  { name: 'wraith', glyph: 'W', hp: 18, attack: 8, defense: 2, xp: 9, depths: [6, 8] },
  { name: 'troll', glyph: 'T', hp: 30, attack: 10, defense: 3, xp: 12, depths: [7, 8], regenerates: true },
]

export const WARDEN: MonsterKind = { name: 'warden', glyph: 'G', hp: 50, attack: 11, defense: 4, xp: 25, depths: [8, 8] }

export type ItemKind = 'gold' | 'potion' | 'mapping' | 'teleport' | 'weapon' | 'armor' | 'heart'

export const GLYPHS: Record<ItemKind, string> = {
  gold: '$',
  potion: '!',
  mapping: '?',
  teleport: '?',
  weapon: ')',
  armor: '[',
  heart: '*',
}

export type ItemSpec = { kind: ItemKind; name: string; power: number }

const WEAPONS = [
  { name: 'dagger', power: 1 },
  { name: 'short sword', power: 2 },
  { name: 'long sword', power: 4 },
  { name: 'war axe', power: 6 },
]

const ARMORS = [
  { name: 'leather armor', power: 1 },
  { name: 'chain mail', power: 2 },
  { name: 'scale mail', power: 3 },
  { name: 'plate armor', power: 4 },
]

function tiered<T>(rng: Rng, table: T[], depth: number): T {
  const tier = Math.min(table.length - 1, Math.floor((depth - 1) / 2) + rng.int(0, 1))
  return table[tier]
}

export function monsterFor(rng: Rng, depth: number): MonsterKind {
  return rng.pick(MONSTERS.filter(m => depth >= m.depths[0] && depth <= m.depths[1]))
}

export function itemFor(rng: Rng, depth: number): ItemSpec {
  const roll = rng.next()
  if (roll < 0.4) return { kind: 'potion', name: 'healing potion', power: 0 }
  if (roll < 0.55) return { kind: 'mapping', name: 'scroll of mapping', power: 0 }
  if (roll < 0.65) return { kind: 'teleport', name: 'scroll of teleport', power: 0 }
  if (roll < 0.83) return { kind: 'weapon', ...tiered(rng, WEAPONS, depth) }
  return { kind: 'armor', ...tiered(rng, ARMORS, depth) }
}

export function goldFor(rng: Rng, depth: number): ItemSpec {
  return { kind: 'gold', name: 'gold', power: rng.int(3, 8 + depth * 4) }
}

export const HEART: ItemSpec = { kind: 'heart', name: 'Heart of the Deep', power: 0 }

export function article(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
}
