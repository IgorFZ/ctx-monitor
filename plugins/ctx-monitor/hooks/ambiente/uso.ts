import type { SessionMeasureInput } from 'claude-code'

import type { Uso } from '../../types'

type Leitura = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>

export const pick = ({ context, rateLimits, cost }: Leitura, total: number | null, cacheLido: number | null = null): Uso => ({
  context: context.percent ?? null,
  tokens: context.tokens ?? null,
  janela: context.window,
  cacheLido,
  session: rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? null,
  week: rateLimits.find(l => l.kind === 'seven_day')?.percentUsed ?? null,
  cost: cost?.usd ?? null,
  total,
})

// O custo da sessão só cresce; se caiu, foi um /clear e a sessão recomeçou do zero.
export const accumulate = (total: number, last: number, cost: number): number =>
  total + (cost >= last ? cost - last : cost)
