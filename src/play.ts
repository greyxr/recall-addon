import { emitKeypressEvents } from 'node:readline'
import { Session, saveReplay } from './session.ts'
import type { SessionOptions } from './session.ts'
import type { ToolInput } from './tools.ts'

const KEYS: Record<string, [string, ToolInput?]> = {
  k: ['move', { direction: 'n' }],
  j: ['move', { direction: 's' }],
  h: ['move', { direction: 'w' }],
  l: ['move', { direction: 'e' }],
  y: ['move', { direction: 'nw' }],
  u: ['move', { direction: 'ne' }],
  b: ['move', { direction: 'sw' }],
  n: ['move', { direction: 'se' }],
  up: ['move', { direction: 'n' }],
  down: ['move', { direction: 's' }],
  left: ['move', { direction: 'w' }],
  right: ['move', { direction: 'e' }],
  '.': ['wait'],
  g: ['pickup'],
  '>': ['descend'],
  x: ['explore'],
  r: ['rest'],
}

const PAINT: [RegExp, string][] = [
  [/@/, '1;33'],
  [/[a-zA-Z]/, '1;31'],
  [/[$*]/, '33'],
  [/[!?)[]/, '36'],
  [/>/, '1;32'],
  [/#/, '90'],
]

function paint(ch: string): string {
  const code = PAINT.find(([pattern]) => pattern.test(ch))?.[1]
  return code ? `\x1b[${code}m${ch}\x1b[0m` : ch
}

function colorize(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const map = line.match(/^(\d\d )(.*)$/)
      return map ? map[1] + [...map[2]].map(paint).join('') : line
    })
    .join('\n')
}

const HELP = 'move: hjkl yubn or arrows | . wait | g pickup | > descend | x explore | r rest | i then a-h: use item | q quit'

export async function play(options: Omit<SessionOptions, 'agent'> & { out: string }) {
  const session = new Session({ ...options, agent: 'human' })
  let screen = session.observation()
  let using = false
  const draw = () => process.stdout.write(`\x1b[2J\x1b[H${colorize(screen)}\n\n${using ? 'Use which item (a-h)?' : HELP}\n`)

  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode?.(true)
  draw()

  await new Promise<void>(resolve => {
    process.stdin.on('keypress', (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) return resolve()
      const name = str && /^[.>]$/.test(str) ? str : key.name ?? ''
      if (using) {
        using = false
        if (/^[a-h]$/.test(name)) screen = session.call('use', { slot: name })
      } else if (name === 'i') {
        using = true
      } else if (KEYS[name]) {
        screen = session.call(...KEYS[name])
      }
      draw()
      if (session.done) resolve()
    })
  })

  process.stdin.setRawMode?.(false)
  process.stdin.pause()
  const file = saveReplay(options.out, session.finish())
  process.stdout.write(`\n${session.summary()}\nReplay saved to ${file}\n`)
}
