export const MIN = 60e3
export const DAY = 864e5

export function schedule(card, grade, now = Date.now()) {
  let { interval = 0, ease = 2.5, reps = 0, lapses = 0 } = card
  if (grade === 1) {
    return { ...card, interval: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, lapses: lapses + (reps > 0), due: now + 10 * MIN, seen: now }
  }
  if (reps === 0) interval = [0, 0, 1, 1, 4][grade]
  else interval *= [0, 0, 1.2, ease, ease * 1.3][grade]
  if (grade === 2) ease = Math.max(1.3, ease - 0.15)
  if (grade === 4) ease += 0.15
  interval = Math.max(1, Math.round(interval))
  return { ...card, interval, ease, reps: reps + 1, lapses, due: now + interval * DAY, seen: now }
}

export function span(ms) {
  const m = Math.round(ms / MIN)
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d`
  if (d < 365) return `${Math.round(d / 30)}mo`
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`
}

export function preview(card, now = Date.now()) {
  return [1, 2, 3, 4].map(g => span(schedule(card, g, now).due - now))
}
