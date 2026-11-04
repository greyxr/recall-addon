export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 1
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }
}

export function mix(...parts: number[]): number {
  let hash = 2166136261
  for (const part of parts) {
    hash ^= part >>> 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
