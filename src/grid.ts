export const WIDTH = 48
export const HEIGHT = 20

export type Point = { x: number; y: number }

export const DIRECTIONS = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
  ne: { x: 1, y: -1 },
  nw: { x: -1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
} as const satisfies Record<string, Point>

export type Direction = keyof typeof DIRECTIONS

export const DIRECTION_NAMES = Object.keys(DIRECTIONS) as Direction[]

export function index(p: Point): number {
  return p.y * WIDTH + p.x
}

export function point(i: number): Point {
  return { x: i % WIDTH, y: Math.floor(i / WIDTH) }
}

export function inBounds(p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < WIDTH && p.y < HEIGHT
}

export function add(p: Point, d: Point): Point {
  return { x: p.x + d.x, y: p.y + d.y }
}

export function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

export function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

export function directionTo(from: Point, to: Point): Direction | null {
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  return DIRECTION_NAMES.find(name => DIRECTIONS[name].x === dx && DIRECTIONS[name].y === dy) ?? null
}

export function neighbors(i: number): number[] {
  const p = point(i)
  const out: number[] = []
  for (const name of DIRECTION_NAMES) {
    const n = add(p, DIRECTIONS[name])
    if (inBounds(n)) out.push(index(n))
  }
  return out
}

export function line(from: Point, to: Point): Point[] {
  const points: Point[] = []
  const dx = Math.abs(to.x - from.x)
  const dy = -Math.abs(to.y - from.y)
  const sx = from.x < to.x ? 1 : -1
  const sy = from.y < to.y ? 1 : -1
  let err = dx + dy
  let { x, y } = from
  while (x !== to.x || y !== to.y) {
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
    points.push({ x, y })
  }
  return points
}

export function fieldOfView(opaque: (i: number) => boolean, origin: Point, radius: number): Set<number> {
  const visible = new Set([index(origin)])
  const edge: Point[] = []
  for (let k = -radius; k <= radius; k++) {
    edge.push({ x: origin.x + k, y: origin.y - radius }, { x: origin.x + k, y: origin.y + radius })
    edge.push({ x: origin.x - radius, y: origin.y + k }, { x: origin.x + radius, y: origin.y + k })
  }
  for (const target of edge) {
    for (const p of line(origin, target)) {
      if (!inBounds(p) || (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2 > radius * radius + radius) break
      visible.add(index(p))
      if (opaque(index(p))) break
    }
  }
  return visible
}

export function findPath(start: number, passable: (i: number) => boolean, goal: (i: number) => boolean): number[] | null {
  const previous = new Map<number, number>([[start, -1]])
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current !== start && goal(current)) {
      const path = [current]
      for (let step = previous.get(current)!; step !== start; step = previous.get(step)!) path.push(step)
      return path.reverse()
    }
    for (const next of neighbors(current)) {
      if (previous.has(next) || (!passable(next) && !goal(next))) continue
      previous.set(next, current)
      queue.push(next)
    }
  }
  return null
}
