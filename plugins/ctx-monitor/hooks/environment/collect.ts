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

/**
 * AMD GPUs on Linux, from the amdgpu driver's sysfs (no ROCm needed): one line per card,
 * `<busy %> <vram used bytes> <vram total bytes> <edge temp in millidegrees or ->`.
 */
export const AMD_SYSFS = 'for d in /sys/class/drm/card[0-9]*/device; do [ "$(cat "$d/vendor" 2>/dev/null)" = 0x1002 ] || continue; ' +
  't=$(cat "$d"/hwmon/hwmon*/temp1_input 2>/dev/null | head -n1); ' +
  'echo "$(cat "$d/gpu_busy_percent") $(cat "$d/mem_info_vram_used") $(cat "$d/mem_info_vram_total") ${t:--}"; done 2>/dev/null; true'

/** Reads AMD_SYSFS output; the busiest card when there are several. */
export function parseAmdSysfs(output: string): Gpu | undefined {
  const cards = output.split('\n').flatMap(line => {
    const [busy, used, total, temp] = line.trim().split(/\s+/)
    const values = [busy, used, total].map(Number)
    if (values.some(v => !Number.isFinite(v)) || !total) return []
    const [usage, usedBytes, totalBytes] = values as [number, number, number]
    const celsius = temp && temp !== '-' ? Number(temp) / 1000 : undefined
    return [{
      usage,
      memUsedMb: Math.round(usedBytes / 1048576),
      memTotalMb: Math.round(totalBytes / 1048576),
      ...(celsius !== undefined && Number.isFinite(celsius) ? { temp: Math.round(celsius) } : {}),
    }]
  })
  return cards.sort((a, b) => b.usage - a.usage)[0]
}

/**
 * Any vendor's GPU on Windows (AMD and Intel have no nvidia-smi): 3D engine use and dedicated
 * memory from performance counters, the total from the display driver's registry key.
 * Windows exposes no GPU temperature without vendor tools. Prints JSON, or nothing without a GPU.
 */
export const WINDOWS_GPU_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$card = Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq 'OK' } | Select-Object -First 1
if ($card) {
  $samples = (Get-Counter -Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage', '\\GPU Adapter Memory(*)\\Dedicated Usage').CounterSamples
  $usage = ($samples | Where-Object { $_.Path -like '*engtype_3d*' } | Measure-Object CookedValue -Sum).Sum
  $used = ($samples | Where-Object { $_.Path -like '*dedicated usage' } | Measure-Object CookedValue -Maximum).Maximum
  $total = (Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | Where-Object { $_.DriverDesc -eq $card.Name -and $_.'HardwareInformation.qwMemorySize' } | Select-Object -First 1).'HardwareInformation.qwMemorySize'
  [pscustomobject]@{ name = $card.Name; usage = $usage; usedBytes = $used; totalBytes = $total } | ConvertTo-Json -Compress
}`

/** Reads WINDOWS_GPU_SCRIPT's JSON, alone (WSL) or as the `gpu` field of WINDOWS_SCRIPT's. */
export function parseWindowsGpu(value: unknown): Gpu | undefined {
  let data = value
  if (typeof value === 'string') {
    try { data = JSON.parse(value) } catch { return undefined }
  }
  if (!data || typeof data !== 'object') return undefined
  const g = data as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (typeof g.name !== 'string' || !num(g.totalBytes)) return undefined
  return {
    name: g.name,
    usage: Math.min(100, Math.round(num(g.usage))),
    memUsedMb: Math.round(num(g.usedBytes) / 1048576),
    memTotalMb: Math.round(num(g.totalBytes) / 1048576),
  }
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
$gpu = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { $null } else { & { ${WINDOWS_GPU_SCRIPT} } | ConvertFrom-Json }
$sessions = @(Get-ChildItem (Join-Path $dir 'sessions') -Filter *.json | Where-Object { $names.ContainsKey([int]$_.BaseName) } | ForEach-Object { Get-Content -Raw $_.FullName })
[pscustomobject]@{ cpu = $cpu; memTotalKb = $os.TotalVisibleMemorySize; memFreeKb = $os.FreePhysicalMemory; ports = $ports; sessions = $sessions; gpu = $gpu } | ConvertTo-Json -Compress -Depth 4`

export type WindowsReading = { cpuUsage: number; ramUsedMb: number; ramTotalMb: number; ports: Port[]; sessions: LocalSession[]; gpu?: Gpu }

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
    ...(parseWindowsGpu(data.gpu) ? { gpu: parseWindowsGpu(data.gpu) } : {}),
  }
}
