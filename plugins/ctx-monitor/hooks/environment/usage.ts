import type { SessionMeasureInput } from 'claude-code'

import type { Usage } from '../../types'

type Reading = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>

export const pick = ({ context, rateLimits, cost }: Reading, total: number | null, cacheRead: number | null = null): Usage => ({
  context: context.percent ?? null,
  tokens: context.tokens ?? null,
  window: context.window,
  cacheRead,
  session: rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? null,
  week: rateLimits.find(l => l.kind === 'seven_day')?.percentUsed ?? null,
  cost: cost?.usd ?? null,
  total,
})

// The session cost only grows; if it dropped, a /clear restarted the session from zero.
export const accumulate = (total: number, last: number, cost: number): number =>
  total + (cost >= last ? cost - last : cost)
