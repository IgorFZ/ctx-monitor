import type { Container, Git, Gpu, LocalSession, Port } from '../../types'

// Ephemeral ports are almost always noise from apps like Steam and torrent clients.
const LINUX_EPHEMERAL = 32768
const WINDOWS_EPHEMERAL = 49152
// Windows services that always listen; they would bury the ports a developer cares about.
const WINDOWS_SYSTEM = new Set(['System', 'svchost', 'lsass', 'wininit', 'services', 'spoolsv', 'Idle'])

const byPort = (ports: Port[]) => ports.sort((a, b) => a.port - b.port)

/** Reads `ss -ltnpH` output and returns one row per port with a known process. */
export function parsePorts(output: string): Port[] {
  const seen = new Map<number, Port>()
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 6) continue
    const local = fields[3] ?? ''
    const sep = local.lastIndexOf(':')
    const port = Number(local.slice(sep + 1))
    const proc = /\(\("([^"]+)",pid=(\d+)/.exec(line)
    if (!proc || !Number.isInteger(port) || port >= LINUX_EPHEMERAL || seen.has(port)) continue
    seen.set(port, { port, address: local.slice(0, sep), process: proc[1] ?? '', pid: Number(proc[2]) })
  }
  return byPort([...seen.values()])
}

/** Reads `docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'`. */
export function parseContainers(output: string): Container[] {
  return output
    .split('\n')
    .filter(l => l.includes('\t'))
    .map(l => {
      const [name = '', status = '', ports = ''] = l.trim().split('\t')
      // Only the host port of each mapping, without repeating the [::] one.
      const short = [...new Set([...ports.matchAll(/:(\d+)->/g)].map(m => m[1]))].join(',')
      return { name, status, ports: short }
    })
}

/** Returns [usedMb, totalMb] from /proc/meminfo. */
export function parseMemory(meminfo: string): [number, number] {
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0)
  const total = kb('MemTotal')
  return [Math.round((total - kb('MemAvailable')) / 1024), Math.round(total / 1024)]
}

/** Aggregate times from the `cpu` line of /proc/stat; idle is the idle field alone. */
export function parseCpuStat(stat: string): { idle: number; total: number } | undefined {
  const times = /^cpu\s+(.+)$/m.exec(stat)?.[1]?.trim().split(/\s+/).map(Number)
  if (!times || times.length < 4 || times.some(Number.isNaN)) return undefined
  return { idle: times[3] ?? 0, total: times.reduce((a, b) => a + b, 0) }
}

/** CPU package temperature (coretemp) from `sensors -j`. */
export function parseCpuTemp(json: string): number | undefined {
  try {
    const data = JSON.parse(json) as Record<string, Record<string, Record<string, number>>>
    for (const [chip, readings] of Object.entries(data)) {
      if (!chip.startsWith('coretemp')) continue
      const pkg = readings['Package id 0']
      if (pkg) return pkg.temp1_input
    }
  } catch {
    // sensors missing or invalid output: no temperature.
  }
  return undefined
}

/** Reads `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseGpu(output: string): Gpu | undefined {
  const [usage, temp, memUsedMb, memTotalMb] = (output.split('\n')[0] ?? '').split(',').map(s => Number(s.trim()))
  if ([usage, temp, memUsedMb, memTotalMb].some(v => v === undefined || Number.isNaN(v))) return undefined
  return { usage: usage!, temp: temp!, memUsedMb: memUsedMb!, memTotalMb: memTotalMb! }
}

/** Reads the session files from ~/.claude/sessions (one per line), newest first. */
export function parseSessions(output: string): LocalSession[] {
  const sessions: LocalSession[] = []
  for (const line of output.split('\n')) {
    try {
      const s = JSON.parse(line) as Record<string, unknown>
      if (typeof s.sessionId !== 'string') continue
      sessions.push({
        id: s.sessionId,
        name: typeof s.name === 'string' ? s.name : s.sessionId.slice(0, 8),
        cwd: typeof s.cwd === 'string' ? s.cwd : '',
        status: typeof s.status === 'string' ? s.status : '?',
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      })
    } catch {
      // Empty line or a file being rewritten: skip it.
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Combines `git rev-parse --abbrev-ref HEAD` and `git rev-list --left-right --count HEAD...@{u}`. */
export function parseGit(branch: string, counts: string): Git | undefined {
  const name = branch.trim()
  if (!name) return undefined
  const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
  return { branch: name, ahead: ahead || 0, behind: behind || 0 }
}

/**
 * Windows has no /proc, ss or sh: one PowerShell call reads CPU, memory, listening ports and the
 * live Claude Code sessions (a session file is named after its process id) and prints them as JSON.
 */
export const WINDOWS_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$names = @{}
Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName }
$ports = @(Get-NetTCPConnection -State Listen | ForEach-Object {
  [pscustomobject]@{ port = [int]$_.LocalPort; address = $_.LocalAddress; pid = [int]$_.OwningProcess; process = $names[[int]$_.OwningProcess] }
})
$dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$sessions = @(Get-ChildItem (Join-Path $dir 'sessions') -Filter *.json | Where-Object { $names.ContainsKey([int]$_.BaseName) } | ForEach-Object { Get-Content -Raw $_.FullName })
[pscustomobject]@{ cpu = $cpu; memTotalKb = $os.TotalVisibleMemorySize; memFreeKb = $os.FreePhysicalMemory; ports = $ports; sessions = $sessions } | ConvertTo-Json -Compress -Depth 4`

export type WindowsReading = { cpuUsage: number; ramUsedMb: number; ramTotalMb: number; ports: Port[]; sessions: LocalSession[] }

/** Reads WINDOWS_SCRIPT's output; undefined when PowerShell failed or printed something else. */
export function parseWindows(output: string): WindowsReading | undefined {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(output) as Record<string, unknown>
  } catch {
    return undefined
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const totalKb = num(data.memTotalKb)
  const seen = new Map<number, Port>()
  for (const raw of Array.isArray(data.ports) ? data.ports : []) {
    const p = raw as Record<string, unknown>
    const port = num(p.port)
    const process = typeof p.process === 'string' ? p.process : ''
    if (!port || port >= WINDOWS_EPHEMERAL || !process || WINDOWS_SYSTEM.has(process) || seen.has(port)) continue
    seen.set(port, { port, address: typeof p.address === 'string' ? p.address : '', process, pid: num(p.pid) })
  }
  const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.replace(/\r?\n/g, ' '))
    .join('\n')
  return {
    cpuUsage: Math.round(num(data.cpu)),
    ramUsedMb: Math.round((totalKb - num(data.memFreeKb)) / 1024),
    ramTotalMb: Math.round(totalKb / 1024),
    ports: byPort([...seen.values()]),
    sessions: parseSessions(sessions),
  }
}
