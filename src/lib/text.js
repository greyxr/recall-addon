const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves`.split(' '))

export const WORD = /[\p{L}\p{N}]+/gu

export function fold(s) {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

export function stem(w) {
  if (w.length < 4 || /\d/.test(w)) return w
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (/(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/[^su]s$/.test(w) && !w.endsWith('is')) return w.slice(0, -1)
  const m = w.match(/^(.{3,}?)(ing|ed)$/)
  if (!m) return w
  return /([^aeioulsz])\1$/.test(m[1]) ? m[1].slice(0, -1) : m[1]
}

export function tokens(text) {
  return fold(text).match(WORD) ?? []
}

export function keep(t) {
  return t.length > 1 && t.length < 32 && !STOP.has(t)
}

export function terms(text) {
  return tokens(text).filter(keep).map(stem)
}

export function count(text) {
  const tf = {}
  for (const t of terms(text)) tf[t] = (tf[t] ?? 0) + 1
  return tf
}

export function snippet(text, match, size = 36) {
  const words = [...text.matchAll(WORD)]
  if (!words.length) return []
  const hit = words.map(w => {
    const raw = fold(w[0])
    return match(raw, stem(raw))
  })
  let best = 0, sum = 0, top = -1
  for (let i = 0; i < words.length; i++) {
    sum += hit[i] - (i >= size ? hit[i - size] : 0)
    if (sum > top) top = sum, best = Math.max(0, i - size + 1)
  }
  const first = Math.max(0, best - 4)
  const last = Math.min(words.length - 1, first + size - 1)
  const out = []
  let pos = words[first].index
  for (let i = first; i <= last; i++) {
    if (!hit[i]) continue
    const w = words[i]
    if (w.index > pos) out.push({ text: text.slice(pos, w.index) })
    out.push({ text: w[0], hit: true })
    pos = w.index + w[0].length
  }
  const end = words[last].index + words[last][0].length
  if (end > pos) out.push({ text: text.slice(pos, end) })
  for (const s of out) s.text = s.text.replace(/\s+/g, ' ')
  if (first > 0) out.unshift({ text: '… ' })
  if (last < words.length - 1) out.push({ text: ' …' })
  return out
}
