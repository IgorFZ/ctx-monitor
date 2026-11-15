export type Port = { port: number; address: string; process: string; pid: number }
export type Container = { name: string; status: string; ports: string }
export type LocalSession = { id: string; name: string; cwd: string; status: string; updatedAt: number }
export type Git = { branch: string; ahead: number; behind: number }
export type Gpu = { usage: number; temp: number; memUsedMb: number; memTotalMb: number }
export type Snapshot = {
  cwd: string
  git?: Git
  model: string
  sessionId: string
  sessions: LocalSession[]
  /** Whole-CPU usage in %. */
  cpuUsage: number
  ramUsedMb: number
  ramTotalMb: number
  cpuTemp?: number
  gpu?: Gpu
  ports: Port[]
  containers: Container[]
  updatedAt: number
}
export type Usage = {
  context: number | null
  tokens: number | null
  window: number | null
  cacheRead: number | null
  session: number | null
  week: number | null
  cost: number | null
  total: number | null
}
export type Progress = {
  /** When the request started; null when no work is in progress. */
  startedAt: number | null
  now: number
  /** The model's estimate; null while it has not answered or if it failed. */
  estimateMs: number | null
  /** Why the estimate did not arrive, when it did not. */
  estimateError: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-monitor': { snapshot: Snapshot | null; usage: Usage; progress: Progress; isOpen: boolean }
  }
}
