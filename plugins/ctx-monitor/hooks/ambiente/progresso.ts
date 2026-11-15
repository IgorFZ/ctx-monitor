import type { ModelCompleteResult } from 'claude-code'

export const describe = (reply: ModelCompleteResult): string =>
  reply.isAnswered ? 'ok' : reply.reason === 'api-error' ? `erro da API ${reply.status}` : reply.reason

export const ESTIMATE_PROMPT = (request: string) => `Você estima quanto tempo um agente de programação (Claude Code) leva para \
concluir um pedido, contando ler arquivos, pensar, editar e rodar comandos. Perguntas simples levam de 5 a 30 segundos; \
mudanças pequenas, de 1 a 3 minutos; features e investigações, de 5 a 20 minutos.

Pedido:
<pedido>
${request}
</pedido>

Responda só com o número inteiro de segundos.`

/** Lê os segundos da resposta do modelo e limita a um intervalo plausível. */
export const parseEstimate = (text: string): number | null => {
  const match = text.match(/\d+/)
  if (!match) return null
  const seconds = Math.min(Math.max(Number(match[0]), 5), 3600)
  return seconds * 1000
}

export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds}s`
  return seconds === 0 ? `${minutes}m` : `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** Fração da barra: para em 95% até o turno acabar, para não dizer que terminou antes da hora. */
export const fraction = (elapsedMs: number, estimateMs: number): number =>
  Math.min(elapsedMs / estimateMs, 0.95)
