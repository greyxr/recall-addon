import { DIRECTION_NAMES } from '../grid.ts'
import { Rng, mix } from '../rng.ts'
import type { Agent, Session } from '../session.ts'

export const random: Agent = {
  name: 'random',
  async play(session: Session) {
    const rng = new Rng(mix(session.game.seed, 0xd1ce))
    while (!session.done) {
      const roll = rng.next()
      if (roll < 0.05) session.call('pickup')
      else if (roll < 0.1) session.call('descend')
      else session.call('move', { direction: rng.pick(DIRECTION_NAMES) })
    }
  },
}
