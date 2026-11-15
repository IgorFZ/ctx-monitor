import { expect, test } from 'claude-code/testing'

import { formatDuration, fraction, parseEstimate } from '../../../hooks/ambiente/progresso'
import { accumulate, pick } from '../../../hooks/ambiente/uso'

test('separa contexto, janelas e custo', () => {
  expect(pick({
    context: { window: 200000, percent: 12 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 41 },
      { kind: 'five_hour', percentUsed: 23.5 },
    ],
    cost: { usd: 1.234 },
  }, 10)).toEqual({ context: 12, tokens: null, janela: 200000, cacheLido: null, session: 23.5, week: 41, cost: 1.234, total: 10 })
  expect(pick({ context: { window: 200000 }, rateLimits: [] }, null))
    .toEqual({ context: null, tokens: null, janela: 200000, cacheLido: null, session: null, week: null, cost: null, total: null })
})

test('o total soma só o que a sessão gastou desde a última leitura', () => {
  expect(accumulate(10, 1, 1.5)).toBe(10.5)
  expect(accumulate(10, 1.5, 1.5)).toBe(10)
  expect(accumulate(10, 3, 0.25)).toBe(10.25) // depois de um /clear
})

test('estimativa: lê segundos, formata e não chega ao fim antes da hora', () => {
  expect(parseEstimate('Cerca de 45 segundos')).toBe(45_000)
  expect(parseEstimate('1')).toBe(5_000)
  expect(parseEstimate('99999')).toBe(3_600_000)
  expect(parseEstimate('não sei')).toBeNull()
  expect(formatDuration(100_000)).toBe('1m40s')
  expect(fraction(90_000, 60_000)).toBe(0.95)
})
