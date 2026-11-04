import { HEART, WARDEN, goldFor, itemFor, monsterFor } from './content.ts'
import type { ItemSpec, MonsterKind } from './content.ts'
import { HEIGHT, WIDTH, findPath, index } from './grid.ts'
import type { Point } from './grid.ts'
import { Rng, mix } from './rng.ts'

export type Rect = { x: number; y: number; w: number; h: number }

export type Floor = {
  depth: number
  tiles: string[]
  rooms: Rect[]
  start: Point
  stairs: Point | null
  monsters: { kind: MonsterKind; pos: Point }[]
  items: { spec: ItemSpec; pos: Point }[]
}

export const WALL = '#'
export const FLOOR = '.'
export const STAIRS = '>'

function overlaps(a: Rect, b: Rect, margin: number): boolean {
  return a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h
}

function center(r: Rect): Point {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) }
}

function carve(tiles: string[], from: Point, to: Point) {
  for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) tiles[index({ x, y })] = FLOOR
  }
}

function corridor(tiles: string[], rng: Rng, a: Point, b: Point) {
  const corner = rng.chance(0.5) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
  carve(tiles, a, corner)
  carve(tiles, corner, b)
}

function cells(r: Rect): Point[] {
  const out: Point[] = []
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y })
  return out
}

export function generateFloor(seed: number, depth: number, maxDepth: number): Floor {
  const rng = new Rng(mix(seed, depth, 0xf100))
  const tiles = new Array<string>(WIDTH * HEIGHT).fill(WALL)
  const rooms: Rect[] = []
  for (let tries = 0; rooms.length < 9 && tries < 400; tries++) {
    const w = rng.int(4, 10)
    const h = rng.int(3, 6)
    const room = { x: rng.int(1, WIDTH - w - 1), y: rng.int(1, HEIGHT - h - 1), w, h }
    if (!rooms.some(other => overlaps(other, room, 2))) rooms.push(room)
  }
  rooms.sort((a, b) => a.x - b.x)
  for (const room of rooms) carve(tiles, { x: room.x, y: room.y }, { x: room.x + room.w - 1, y: room.y + room.h - 1 })
  for (let i = 1; i < rooms.length; i++) corridor(tiles, rng, center(rooms[i - 1]), center(rooms[i]))
  for (let i = 0; i < 2; i++) corridor(tiles, rng, center(rng.pick(rooms)), center(rng.pick(rooms)))

  const startRoom = rng.int(0, rooms.length - 1)
  const start = center(rooms[startRoom])
  const travel = (p: Point) => findPath(index(start), i => tiles[i] !== WALL, i => i === index(p))?.length ?? 0
  const others = rooms.filter((_, i) => i !== startRoom)
  const goal = center(others.reduce((best, room) => (travel(center(room)) > travel(center(best)) ? room : best)))
  const last = depth >= maxDepth

  const taken = new Set([index(start), index(goal)])
  const place = (rooms: Rect[]): Point | null => {
    for (let tries = 0; tries < 50; tries++) {
      const p = rng.pick(cells(rng.pick(rooms)))
      if (!taken.has(index(p))) {
        taken.add(index(p))
        return p
      }
    }
    return null
  }

  const monsters: Floor['monsters'] = []
  for (let i = 0; i < 3 + Math.floor(depth * 1.5); i++) {
    const pos = place(others)
    if (pos) monsters.push({ kind: monsterFor(rng, depth), pos })
  }
  const items: Floor['items'] = []
  for (let i = rng.int(2, 4); i > 0; i--) {
    const pos = place(rooms)
    if (pos) items.push({ spec: itemFor(rng, depth), pos })
  }
  for (let i = rng.int(2, 4); i > 0; i--) {
    const pos = place(rooms)
    if (pos) items.push({ spec: goldFor(rng, depth), pos })
  }

  if (last) {
    items.push({ spec: HEART, pos: goal })
    const around = cells({ x: goal.x - 1, y: goal.y - 1, w: 3, h: 3 }).filter(p => tiles[index(p)] === FLOOR && !taken.has(index(p)))
    if (around.length) monsters.push({ kind: WARDEN, pos: rng.pick(around) })
  } else {
    tiles[index(goal)] = STAIRS
  }

  return { depth, tiles, rooms, start, stairs: last ? null : goal, monsters, items }
}

