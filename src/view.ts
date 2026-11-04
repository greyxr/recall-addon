import { GLYPHS } from './content.ts'
import { WALL } from './floor.ts'
import type { Game, Item, Monster } from './game.ts'
import { slotLetter } from './game.ts'
import { HEIGHT, WIDTH, index, neighbors, same } from './grid.ts'
import type { Point } from './grid.ts'

export type Observation = {
  pos: Point
  monsters: Monster[]
  items: Item[]
  stairs: Point | null
  explored: boolean
}

export function observe(game: Game): Observation {
  const stairs = game.floor.stairs && game.known[index(game.floor.stairs)] ? game.floor.stairs : null
  return {
    pos: game.player.pos,
    monsters: game.monsters.filter(m => game.visible.has(index(m.pos))),
    items: game.items.filter(item => item.pos && game.known[index(item.pos)]),
    stairs,
    explored: !game.known.some((_, i) => game.isFrontier(i)),
  }
}

function rock(game: Game, i: number): boolean {
  return game.floor.tiles[i] === WALL && !neighbors(i).some(n => game.walkable(n))
}

function render(game: Game, show: (i: number) => boolean, showMonster: (m: Monster) => boolean): string[] {
  const grid = game.floor.tiles.map((tile, i) => (show(i) && !rock(game, i) ? tile : ' '))
  for (const item of game.items) if (item.pos && show(index(item.pos))) grid[index(item.pos)] = GLYPHS[item.kind]
  for (const m of game.monsters) if (showMonster(m)) grid[index(m.pos)] = m.kind.glyph
  grid[index(game.player.pos)] = '@'
  const rows: string[] = []
  for (let y = 0; y < HEIGHT; y++) rows.push(grid.slice(y * WIDTH, (y + 1) * WIDTH).join(''))
  return rows
}

export function renderKnown(game: Game): string[] {
  return render(game, i => game.known[i], m => game.visible.has(index(m.pos)))
}

export function renderTruth(game: Game): string[] {
  return render(game, () => true, () => true)
}

function relative(from: Point, to: Point): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const parts = [dy < 0 ? `${-dy} north` : dy > 0 ? `${dy} south` : '', dx > 0 ? `${dx} east` : dx < 0 ? `${-dx} west` : '']
  return parts.filter(Boolean).join(', ') || 'here'
}

function gridText(rows: string[]): string {
  const tens = Array.from({ length: WIDTH }, (_, x) => Math.floor(x / 10)).join('')
  const ones = Array.from({ length: WIDTH }, (_, x) => x % 10).join('')
  const body = rows.map((row, y) => `${String(y).padStart(2, '0')} ${row}`.trimEnd())
  return [`   ${tens}`, `   ${ones}`, ...body].join('\n')
}

export function describe(game: Game): string {
  const p = game.player
  const o = observe(game)
  const gear = (item: Item | null, base: string) => (item ? `${item.name}, +${item.power}` : base)
  const lines = [
    `Depth ${game.depth} of ${game.maxDepth} | turn ${game.turn} | HP ${p.hp}/${p.maxHp} | level ${p.level} (xp ${p.xp}/${p.level * 8}) | attack ${game.attackPower} (${gear(p.weapon, 'fists')}) | defense ${game.defense} (${gear(p.armor, 'no armor')}) | gold ${p.gold}`,
    `Pack: ${p.pack.map((item, i) => `${slotLetter(i)}) ${item.name}${item.power && item.kind !== 'gold' ? ` +${item.power}` : ''}`).join(', ') || 'empty'}`,
    '',
    gridText(renderKnown(game)),
    '',
  ]
  const seen = [
    ...o.monsters.map(m => `${m.kind.name} ${m.kind.glyph} at (${m.pos.x},${m.pos.y}) ${relative(p.pos, m.pos)}, ${m.hp}/${m.maxHp} HP, ${m.awake ? 'awake' : 'asleep'}`),
    ...o.items.map(item => `${item.kind === 'gold' ? `${item.power} gold` : item.name} ${GLYPHS[item.kind]} at (${item.pos!.x},${item.pos!.y}) ${relative(p.pos, item.pos!)}`),
  ]
  lines.push(`You are at (${p.pos.x},${p.pos.y}).`)
  lines.push(seen.length ? `Known: ${seen.join('; ')}.` : 'No monsters or items in view.')
  const here = game.itemAt(index(p.pos))
  if (here) lines.push(`You are standing on: ${here.name}.`)
  if (o.stairs) lines.push(same(o.stairs, p.pos) ? 'You are standing on the stairs down.' : `Stairs down > at (${o.stairs.x},${o.stairs.y}) ${relative(p.pos, o.stairs)}.`)
  else if (game.depth < game.maxDepth) lines.push('Stairs down: not found yet.')
  lines.push(o.explored ? 'This floor is fully explored.' : 'Unexplored areas remain.')
  if (game.status === 'won') lines.push('You won the game.')
  if (game.status === 'dead') lines.push(`You are dead (${game.cause}).`)
  return lines.join('\n')
}

