const $ = id => document.getElementById(id)
const embedded = globalThis.DUNGEON_BENCH_DATA

const state = { frames: [], replay: null, cursor: 0, timer: null }

const escape = text => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
const runLabel = entry => (entry.toolset === 'primitive' ? `${entry.agent} (primitive)` : entry.agent)
const outcome = result => (result.won ? 'won' : result.dead ? 'dead' : 'limit')

async function loadIndex() {
  if (embedded) return embedded.index
  try {
    const response = await fetch('runs/index.json', { cache: 'no-store' })
    return response.ok ? await response.json() : []
  } catch {
    return []
  }
}

async function loadReplay(file) {
  if (embedded) return embedded.replays[file]
  const response = await fetch(`runs/${encodeURIComponent(file)}`)
  return response.json()
}

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === name)
  for (const panel of document.querySelectorAll('.panel')) panel.classList.toggle('active', panel.id === name)
  if (name !== 'replay') pause()
}

function summarize(entries) {
  const groups = Map.groupBy(entries, runLabel)
  return [...groups]
    .map(([agent, runs]) => {
      const costs = runs.map(r => r.result.usage?.cost).filter(c => typeof c === 'number')
      return {
        agent,
        runs: runs.length,
        score: mean(runs.map(r => r.result.score)),
        depth: mean(runs.map(r => r.result.deepest)),
        wins: runs.filter(r => r.result.won).length,
        deaths: runs.filter(r => r.result.dead).length,
        turns: mean(runs.map(r => r.result.turns)),
        cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      }
    })
    .sort((a, b) => b.score - a.score)
}

function renderBoard(entries) {
  $('board-empty').hidden = entries.length > 0
  $('matrix-title').hidden = $('matrix-hint').hidden = entries.length === 0
  if (!entries.length) return
  const rows = summarize(entries)
  const best = Math.max(...rows.map(r => r.score))
  $('summary').innerHTML =
    '<tr><th>Agent</th><th>Runs</th><th>Mean score</th><th>Mean depth</th><th>Wins</th><th>Deaths</th><th>Mean turns</th><th>Cost</th></tr>' +
    rows
      .map(
        r => `<tr>
          <td class="mono">${escape(r.agent)}</td>
          <td>${r.runs}</td>
          <td>${r.score.toFixed(0)}<span class="bar" style="width:${Math.round((r.score / best) * 80)}px"></span></td>
          <td>${r.depth.toFixed(2)}</td>
          <td>${r.wins}</td>
          <td>${r.deaths}</td>
          <td>${r.turns.toFixed(0)}</td>
          <td>${r.cost === null ? '—' : `$${r.cost.toFixed(2)}`}</td>
        </tr>`,
      )
      .join('')

  const seeds = [...new Set(entries.map(e => e.seed))].sort((a, b) => a - b)
  const latest = new Map(entries.map(e => [`${runLabel(e)}|${e.seed}`, e]))
  $('matrix').innerHTML =
    `<tr><th>Agent</th>${seeds.map(s => `<th>${s}</th>`).join('')}</tr>` +
    rows
      .map(
        r => `<tr><td class="mono">${escape(r.agent)}</td>${seeds
          .map(seed => {
            const entry = latest.get(`${r.agent}|${seed}`)
            if (!entry) return '<td></td>'
            const res = entry.result
            const title = `score ${res.score}, depth ${res.deepest}, ${res.won ? 'won' : res.cause ?? 'turn limit'}`
            return `<td class="cell"><button class="run ${outcome(res)}" data-file="${escape(entry.file)}" title="${escape(title)}">${res.won ? '★' : res.deepest}</button></td>`
          })
          .join('')}</tr>`,
      )
      .join('')
}

function expand(replay) {
  let view = []
  let truth = []
  return replay.frames.map(frame => {
    view = frame.view.map((row, i) => row ?? view[i])
    truth = frame.truth.map((row, i) => row ?? truth[i])
    return { ...frame, view, truth }
  })
}

function glyphClass(ch) {
  if (ch === '@') return 'p'
  if (/[a-zA-Z]/.test(ch)) return 'm'
  if (ch === '$' || ch === '*') return 'g'
  if ('!?)['.includes(ch)) return 'i'
  if (ch === '>') return 's'
  if (ch === '#') return 'w'
  return ''
}

function renderMap(frame) {
  const god = $('god').checked
  const rows = god ? frame.truth : frame.view
  $('map').innerHTML = rows
    .map((row, y) =>
      [...row]
        .map((ch, x) => {
          const hidden = god && ch !== ' ' && frame.view[y][x] === ' '
          const cls = [glyphClass(ch), hidden ? 'u' : ''].filter(Boolean).join(' ')
          return cls ? `<span class="${cls}">${escape(ch)}</span>` : escape(ch)
        })
        .join(''),
    )
    .join('\n')
}

function renderSide(frame) {
  const stat = (value, name) => `<div class="stat"><b>${value}</b><span>${name}</span></div>`
  $('stats').innerHTML =
    stat(`${frame.depth}/${state.replay.maxDepth}`, 'depth') +
    stat(`${frame.hp}/${frame.maxHp}`, 'hp') +
    stat(frame.level, 'level') +
    stat(frame.gold, 'gold') +
    stat(frame.turn, 'turn') +
    stat(`${state.cursor + 1}/${state.frames.length}`, 'frame') +
    `<div class="hpbar"><div style="width:${(100 * frame.hp) / frame.maxHp}%"></div></div>`
  $('action').textContent = frame.action
  let thought = ''
  for (let i = state.cursor; i >= 0 && !thought; i--) thought = state.frames[i].thought ?? ''
  $('thought').textContent = thought

  const lines = []
  for (let i = Math.max(0, state.cursor - 60); i <= state.cursor; i++) {
    for (const message of state.frames[i].messages) lines.push({ turn: state.frames[i].turn, message, current: i === state.cursor })
  }
  $('log').innerHTML = lines
    .slice(-30)
    .map(l => `<li class="${l.current ? '' : 'old'}"><span class="muted">${l.turn}</span> ${escape(l.message)}</li>`)
    .join('')
  $('log').scrollTop = $('log').scrollHeight
  $('turn').textContent = `turn ${frame.turn}`
}

function renderChart() {
  const frames = state.frames
  const n = Math.max(frames.length - 1, 1)
  const x = i => (600 * i) / n
  const bands = []
  let from = 0
  for (let i = 1; i <= frames.length; i++) {
    if (i === frames.length || frames[i].depth !== frames[from].depth) {
      const odd = frames[from].depth % 2 ? 'odd' : ''
      bands.push(`<rect class="band ${odd}" x="${x(from)}" y="0" width="${Math.max(x(i - 1) - x(from), 1)}" height="90"/>`)
      bands.push(`<text x="${x(from) + 3}" y="11">D${frames[from].depth}</text>`)
      from = i
    }
  }
  const points = frames.map((f, i) => `${x(i).toFixed(1)},${(86 - (78 * f.hp) / f.maxHp).toFixed(1)}`).join(' ')
  $('chart').innerHTML = `${bands.join('')}<polyline class="hp" points="${points}"/><line id="cursor" class="cursor" x1="0" x2="0" y1="0" y2="90"/>`
}

function seek(i) {
  state.cursor = Math.max(0, Math.min(state.frames.length - 1, i))
  const frame = state.frames[state.cursor]
  $('scrub').value = state.cursor
  renderMap(frame)
  renderSide(frame)
  const cx = (600 * state.cursor) / Math.max(state.frames.length - 1, 1)
  $('cursor')?.setAttribute('x1', cx)
  $('cursor')?.setAttribute('x2', cx)
  if (state.cursor === state.frames.length - 1) pause()
}

function play() {
  if (state.cursor >= state.frames.length - 1) seek(0)
  pause()
  state.timer = setInterval(() => seek(state.cursor + 1), 1000 / Number($('speed').value))
  $('toggle').textContent = '❚❚'
}

function pause() {
  clearInterval(state.timer)
  state.timer = null
  $('toggle').textContent = '▶'
}

function openReplay(replay, file) {
  state.replay = replay
  state.frames = expand(replay)
  const r = replay.result
  const cost = r?.usage?.cost
  const summary = r
    ? `score ${r.score} · depth ${r.deepest} · ${r.won ? 'won' : r.dead ? r.cause : 'turn limit'} · ${r.turns} turns · ${r.calls} calls${typeof cost === 'number' ? ` · $${cost.toFixed(2)}` : ''}`
    : ''
  $('run-title').innerHTML = `${escape(replay.agent)} <span class="muted">· seed ${replay.seed} · ${replay.toolset} tools · ${escape(summary)}</span>`
  $('scrub').max = state.frames.length - 1
  $('replay-empty').hidden = true
  $('player').hidden = false
  renderChart()
  showTab('replay')
  seek(0)
  if (file) history.replaceState(null, '', `#replay=${encodeURIComponent(file)}`)
}

async function openFile(file) {
  openReplay(await loadReplay(file), file)
}

function wire() {
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showTab(tab.dataset.tab))
  $('matrix').addEventListener('click', event => {
    const file = event.target.closest('[data-file]')?.dataset.file
    if (file) openFile(file)
  })
  $('scrub').addEventListener('input', event => seek(Number(event.target.value)))
  $('toggle').addEventListener('click', () => (state.timer ? pause() : play()))
  $('prev').addEventListener('click', () => seek(state.cursor - 1))
  $('next').addEventListener('click', () => seek(state.cursor + 1))
  $('speed').addEventListener('change', () => state.timer && play())
  $('god').addEventListener('change', () => seek(state.cursor))
  $('chart').addEventListener('click', event => {
    const box = event.currentTarget.getBoundingClientRect()
    seek(Math.round(((event.clientX - box.left) / box.width) * (state.frames.length - 1)))
  })
  $('file').addEventListener('change', async event => {
    const file = event.target.files[0]
    if (file) openReplay(JSON.parse(await file.text()))
  })
  document.addEventListener('keydown', event => {
    if (!state.frames.length || !$('replay').classList.contains('active') || event.target.matches('input[type=file], select')) return
    const jump = event.shiftKey ? 10 : 1
    if (event.key === ' ') state.timer ? pause() : play()
    else if (event.key === 'ArrowLeft') seek(state.cursor - jump)
    else if (event.key === 'ArrowRight') seek(state.cursor + jump)
    else if (event.key === 'Home') seek(0)
    else if (event.key === 'End') seek(state.frames.length - 1)
    else return
    event.preventDefault()
  })
}

wire()
renderBoard(await loadIndex())
const linked = new URLSearchParams(location.hash.slice(1)).get('replay')
if (linked) openFile(linked)
