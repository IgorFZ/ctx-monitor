export type Porta = { porta: number; endereco: string; processo: string; pid: number }
export type Container = { nome: string; status: string; portas: string }
export type SessaoLocal = { id: string; nome: string; cwd: string; status: string; atualizadaEm: number }
export type Git = { branch: string; frente: number; atras: number }
export type Snapshot = {
  cwd: string
  git?: Git
  modelo: string
  sessaoId: string
  sessoes: SessaoLocal[]
  /** Uso da CPU inteira em %, como o módulo cpu da waybar. */
  cpuUso: number
  ramUsadaMb: number
  ramTotalMb: number
  cpuTemp?: number
  gpu?: { uso: number; temp: number; memUsadaMb: number; memTotalMb: number }
  portas: Porta[]
  containers: Container[]
  atualizadoEm: number
}
export type Uso = {
  context: number | null
  tokens: number | null
  janela: number | null
  cacheLido: number | null
  session: number | null
  week: number | null
  cost: number | null
  total: number | null
}
export type Progresso = {
  /** Quando o pedido começou; null quando não há trabalho em andamento. */
  startedAt: number | null
  now: number
  /** Estimativa do modelo; null enquanto ele ainda não respondeu ou se falhou. */
  estimateMs: number | null
  /** Por que a estimativa não veio, quando não veio. */
  estimateError: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-monitor': { snapshot: Snapshot | null; uso: Uso; progresso: Progresso; aberta: boolean }
  }
}
