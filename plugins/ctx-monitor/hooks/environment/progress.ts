import type { ModelCompleteResult } from 'claude-code'

export const describe = (reply: ModelCompleteResult): string =>
  reply.isAnswered ? 'ok' : reply.reason === 'api-error' ? `API error ${reply.status}` : reply.reason

export const ESTIMATE_PROMPT = (request: string) => `You estimate how long a coding agent (Claude Code) takes to \
finish a request, counting reading files, thinking, editing and running commands. Simple questions take 5 to 30 seconds; \
small changes, 1 to 3 minutes; features and investigations, 5 to 20 minutes.

Request:
<request>
${request}
</request>

Answer with the whole number of seconds only.`

/** Reads the seconds from the model's reply and clamps them to a plausible range. */
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

/** Bar fraction: stops at 95% until the turn ends, so it never claims to be done early. */
export const fraction = (elapsedMs: number, estimateMs: number): number =>
  Math.min(elapsedMs / estimateMs, 0.95)
