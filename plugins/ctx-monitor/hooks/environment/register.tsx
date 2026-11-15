import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, Timer } from 'claude-code'

import type { Gpu, Snapshot } from '../../types'
import {
  AMD_SYSFS,
  parseContainers,
  parseCpuStat,
  parseCpuTemp,
  parseGit,
  parseGpu,
  parseMemory,
  parsePorts,
  parseSessions,
  parseAmdSysfs,
  parseWindows,
  parseWindowsGpu,
  WINDOWS_GPU_SCRIPT,
  WINDOWS_SCRIPT,
} from './collect'
import { describe, ESTIMATE_PROMPT, formatDuration, fraction, parseEstimate } from './progress'
import { accumulate, pick } from './usage'

const PANE = 'ctx-monitor-environment'
// An engine action with no handler of its own mounted; its chord (ctrl+x ctrl+x) lives in ~/.claude/keybindings.json.
const TOGGLE_ACTION = 'app:toggleReplTab'
// Starting PowerShell costs about a second on Windows, so it polls less often there.
const INTERVAL_MS = { linux: 1000, windows: 3000 }

const isOpen = atom({ plugin: 'ctx-monitor', key: 'isOpen' } as const, false)
const snapshot = atom({ plugin: 'ctx-monitor', key: 'snapshot' } as const, null)
const usage = atom({ plugin: 'ctx-monitor', key: 'usage' } as const, {
  context: null,
  tokens: null,
  window: null,
  cacheRead: null,
  session: null,
  week: null,
  cost: null,
  total: null,
})
const progress = atom({ plugin: 'ctx-monitor', key: 'progress' } as const, {
  startedAt: null,
  now: 0,
  estimateMs: null,
  estimateError: null,
})

async function initialTotal($: EngineInterface, currentCost: number): Promise<number> {
  const stored = await $.store.get('totalUsd')
  if (typeof stored === 'number') return stored
  await $.store.set('totalUsd', currentCost)
  return currentCost
}

let timer: { cancel: () => void } | undefined
// Opens by itself once per load; if the person closes it by hand, it stays closed.
let autoOpened = false
// The session's last cost already added to the total; starts over on each module load.
let lastCost = 0
let tick: Timer | null = null
let estimating: AbortController | null = null
let windows: boolean | undefined
let wsl: boolean | undefined
// On WSL the GPU is virtual, so it is read from Windows; each call takes seconds, so it is cached.
const WSL_GPU_MS = 5000
let wslGpu: { at: number; gpu: Gpu | undefined; pending?: Promise<void> } = { at: 0, gpu: undefined }

async function isWindows($: EngineInterface): Promise<boolean> {
  windows ??= (await $.env.get('OS')) === 'Windows_NT'
  return windows
}

async function isWsl($: EngineInterface): Promise<boolean> {
  wsl ??= Boolean(await $.env.get('WSL_DISTRO_NAME'))
  return wsl
}

/** The WSL host's GPU, refreshed in the background so a slow PowerShell never holds a collection. */
function wslHostGpu($: EngineInterface): Gpu | undefined {
  if (!wslGpu.pending && Date.now() - wslGpu.at > WSL_GPU_MS) {
    wslGpu.pending = run($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_GPU_SCRIPT], 15000)
      .then(output => { wslGpu = { at: Date.now(), gpu: parseWindowsGpu(output.trim()) } })
  }
  return wslGpu.gpu
}

async function run($: EngineInterface, argv: string[], timeoutMs = 5000): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    // Missing or stuck command: its section stays empty.
    return ''
  }
}

// Live sessions only: the file of a session that crashed is left behind in ~/.claude/sessions.
const LIVE_SESSIONS =
  'for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/sessions/*.json; do p=$(basename "$f" .json); [ -d /proc/$p ] && { cat "$f"; echo; }; done; true'

let previousCpu: { idle: number; total: number } | undefined

async function collect($: EngineInterface): Promise<Snapshot> {
  const cwd = await $.session.cwd()
  const onWindows = await isWindows($)
  const [model, sessionId, branch, counts, gpu, docker] = await Promise.all([
    $.session.model(),
    $.session.id(),
    run($, ['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']),
    run($, ['git', '-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    run($, ['nvidia-smi', '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']),
    run($, ['docker', 'ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}']),
  ])
  const common = {
    cwd,
    git: parseGit(branch, counts),
    model,
    sessionId,
    containers: parseContainers(docker),
    updatedAt: Date.now(),
  }

  if (onWindows) {
    const output = await run($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], 10000)
    const reading = parseWindows(output)
    return {
      ...common,
      gpu: parseGpu(gpu) ?? reading?.gpu,
      cpuUsage: reading?.cpuUsage ?? 0,
      ramUsedMb: reading?.ramUsedMb ?? 0,
      ramTotalMb: reading?.ramTotalMb ?? 0,
      ports: reading?.ports ?? [],
      sessions: reading?.sessions ?? [],
    }
  }

  const [stat, meminfo, sensors, ss, sessions, amd] = await Promise.all([
    run($, ['cat', '/proc/stat']),
    run($, ['cat', '/proc/meminfo']),
    run($, ['sensors', '-j']),
    run($, ['ss', '-ltnpH']),
    run($, ['sh', '-c', LIVE_SESSIONS]),
    run($, ['sh', '-c', AMD_SYSFS]),
  ])
  const [ramUsedMb, ramTotalMb] = parseMemory(meminfo)
  // Non-idle share of the time between two /proc/stat readings.
  const currentCpu = parseCpuStat(stat)
  const deltaTotal = currentCpu && previousCpu ? currentCpu.total - previousCpu.total : 0
  const cpuUsage =
    currentCpu && previousCpu && deltaTotal > 0
      ? Math.round((100 * (deltaTotal - (currentCpu.idle - previousCpu.idle))) / deltaTotal)
      : 0
  if (currentCpu) previousCpu = currentCpu
  const nvidia = parseGpu(gpu)
  return {
    ...common,
    gpu: nvidia ?? parseAmdSysfs(amd) ?? ((await isWsl($)) ? wslHostGpu($) : undefined),
    sessions: parseSessions(sessions),
    cpuUsage,
    ramUsedMb,
    ramTotalMb,
    cpuTemp: parseCpuTemp(sensors),
    ports: parsePorts(ss),
  }
}

// A slow collection (docker, nvidia-smi, PowerShell) must not stack another on top of it.
let collecting = false

async function refresh($: EngineInterface) {
  if (collecting) return
  collecting = true
  try {
    const snap = await collect($)
    await update($, snapshot, () => snap)
  } finally {
    collecting = false
  }
}

function bar(frac: number, width = 10) {
  const filled = Math.round(Math.min(1, Math.max(0, frac)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function tempColor(t?: number) {
  if (t === undefined) return undefined
  return t >= 80 ? 'red' : t >= 65 ? 'yellow' : 'green'
}

function fracColor(f: number) {
  return f >= 0.9 ? 'red' : f >= 0.7 ? 'yellow' : 'green'
}

async function open($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Environment', columns: 44 })
  await update($, isOpen, () => true)
  timer?.cancel()
  timer = $.clock.every((await isWindows($)) ? INTERVAL_MS.windows : INTERVAL_MS.linux, () => void refresh($))
  await refresh($)
}

// The mod's own $.ui.close does not fire the ui.close hook (reentrancy), so whoever closes calls this.
async function closed($: EngineInterface) {
  timer?.cancel()
  timer = undefined
  await update($, isOpen, () => false)
}

/** session.start part of the sidebar; the hook in index.ts combines each feature's parts. */
export async function startEnvironment($: EngineInterface) {
  await $.command.register({ name: 'environment', description: 'Opens the environment sidebar: usage, progress, PC, ports and containers' })
  // A measurement taken before the mod loaded does not come back: read the current value. The cost the
  // session already had is not added to the total (it was added before a reload).
  const reading = await $.session.usage()
  lastCost = reading.cost?.usd ?? 0
  const total = await initialTotal($, lastCost)
  await update($, usage, () => pick(reading, total))
}

/** turn.complete part of the sidebar: stops the request's clock and estimate. */
export async function completeTurnEnvironment($: EngineInterface) {
  tick?.cancel()
  tick = null
  estimating?.abort()
  estimating = null
  await update($, progress, p => ({ ...p, startedAt: null }))
}

/** With the sidebar closed, the band above the prompt gets the button the shortcut presses to reopen it. */
export async function bandEnvironment($: EngineInterface, e: RenderInput<'AbovePrompt'>, beneath: RenderElement): Promise<RenderElement> {
  // Reads the layout from the band's first draw and opens the sidebar only where it docks beside the chat.
  if (!autoOpened && e.viewport?.isFullscreen === true) {
    autoOpened = true
    // A draw cannot write state: open outside the render, on the clock's next tick.
    const deferred = $.clock.every(10, () => {
      deferred.cancel()
      void open($)
    })
  }
  if (e.surface !== 'terminal' || e.props.hasSurvey || (await read($, isOpen))) return beneath
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {beneath}
      <Button key="toggle" action={TOGGLE_ACTION} plain dimColor label="ctrl+x ctrl+x · environment" onPress={() => void open($)} />
    </Box>
  )
}

export const registerEnvironment: Register = on => {
  // shortcut: two sessions open at once can lose an increment of the total (the read and the write
  // are not atomic); switch to a lock if that ever matters.
  on('session.measure', async ($, e, next) => {
    let total = (await read($, usage)).total
    if (e.changed.includes('cost') && e.cost) {
      const stored = await $.store.get('totalUsd')
      total = accumulate(typeof stored === 'number' ? stored : 0, lastCost, e.cost.usd)
      lastCost = e.cost.usd
      await $.store.set('totalUsd', total)
    }
    let cache = (await read($, usage)).cacheRead
    if (e.changed.includes('context')) {
      // 'summary' estimates locally and sends no counting request.
      const latest = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
      cache = latest?.context.breakdown?.apiUsage?.cache_read_input_tokens ?? cache
    }
    await update($, usage, () => pick(e, total, cache))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, progress, () => ({ startedAt, now: startedAt, estimateMs: null, estimateError: null }))

    tick?.cancel()
    tick = $.clock.every(1000, () => {
      void $.clock.now().then(now => update($, progress, p => ({ ...p, now })))
    })

    // Does not hold the request waiting for the estimate: it arrives when it arrives.
    estimating?.abort()
    const controller = new AbortController()
    estimating = controller
    void $.model
      .complete(
        { model: 'haiku', prompt: ESTIMATE_PROMPT(e.text), maxTokens: 64, effort: 'low', timeoutMs: 20_000 },
        { signal: controller.signal },
      )
      .then(reply => {
        if (controller.signal.aborted) return
        const estimateMs = reply.isAnswered ? parseEstimate(reply.text) : null
        const estimateError =
          estimateMs !== null ? null : reply.isAnswered ? `reply without a number: "${reply.text.slice(0, 40)}"` : describe(reply)
        return update($, progress, p => (p.startedAt === startedAt ? { ...p, estimateMs, estimateError } : p))
      })
      .catch((error: unknown) =>
        update($, progress, p =>
          p.startedAt === startedAt ? { ...p, estimateError: error instanceof Error ? error.message : String(error) } : p,
        ),
      )

    return next(e)
  })

  on('command.run', { command: 'environment' }, async ($, e) => {
    await open($)
    // Only the fullscreen layout docks the pane beside the conversation (from 110 columns).
    if (e.presentation?.isFullscreen === false)
      return { text: 'Sidebar opened above the prompt. To dock it beside the chat, start with CLAUDE_CODE_NO_FLICKER=1 claude in a terminal at least 110 columns wide.' }
    return { text: 'Environment sidebar opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      autoOpened = true
      await closed($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const u = await read($, usage)
    const pr = await read($, progress)

    const meter = (label: string, pct: number | null) =>
      pct === null ? (
        <Text dimColor>{label.padEnd(9)}—</Text>
      ) : (
        <Text>
          <Text dimColor>{label.padEnd(9)}</Text>
          <Text color={fracColor(pct / 100)}>{bar(pct / 100)}</Text> {pct}%
        </Text>
      )
    const usd = (v: number | null) => (v === null ? '—' : `US$ ${v.toFixed(2)}`)
    const elapsed = pr.startedAt === null ? 0 : Math.max(pr.now - pr.startedAt, 0)
    const late = pr.estimateMs !== null && elapsed > pr.estimateMs

    const progressBlock = (
      <Box flexDirection="column">
        <Text bold>Progress</Text>
        {pr.startedAt === null ? (
          <Text dimColor>No request in progress.</Text>
        ) : pr.estimateMs === null ? (
          <Text>
            {formatDuration(elapsed)}
            <Text dimColor>{pr.estimateError === null ? ' · estimating…' : ` · no estimate (${pr.estimateError})`}</Text>
          </Text>
        ) : (
          <Text>
            <Text color={late ? 'yellow' : 'cyan'}>{bar(fraction(elapsed, pr.estimateMs), 12)}</Text> {formatDuration(elapsed)}
            <Text dimColor> of ~{formatDuration(pr.estimateMs)}{late ? ' (over)' : ''}</Text>
          </Text>
        )}
        <Text> </Text>
      </Box>
    )
    if (!s)
      return (
        <Box flexDirection="column">
          <Text dimColor>Collecting…</Text>
          <Text> </Text>
          {progressBlock}
        </Box>
      )

    const cpuFrac = s.cpuUsage / 100
    const ramFrac = s.ramTotalMb ? s.ramUsedMb / s.ramTotalMb : 0
    const gb = (mb: number) => (mb / 1024).toFixed(1)

    const kill = (pid: number, name: string) => async () => {
      const argv = (await isWindows($)) ? ['taskkill', '/PID', String(pid), '/F'] : ['kill', String(pid)]
      const r = await $.process.run(argv).catch(() => undefined)
      $.ui.toast(r?.exitCode === 0 ? `${name} (${pid}) stopped` : `Could not stop ${name} (${pid})`)
      await refresh($)
    }
    const stop = (name: string) => async () => {
      $.ui.toast(`Stopping ${name}…`)
      const r = await $.process.run(['docker', 'stop', name], { timeoutMs: 30000 }).catch(() => undefined)
      $.ui.toast(r?.exitCode === 0 ? `${name} stopped` : `Could not stop ${name}`)
      await refresh($)
    }

    const n = (v: number) => v.toLocaleString('en-US')
    const label = (r: string) => <Text dimColor>{r.padEnd(9)}</Text>
    const current = s.sessions.find(x => x.id === s.sessionId)
    const others = s.sessions.filter(x => x.id !== s.sessionId)
    const base = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p
    const statusColor = (st: string) => (st === 'busy' ? 'yellow' : st === 'idle' ? 'green' : undefined)

    return (
      <Box flexDirection="column">
        {/* Hidden: only there so the ctrl+x ctrl+x shortcut has something to press. */}
        <Box display="none"><Button key="toggle" action={TOGGLE_ACTION} plain dimColor label="close · ctrl+x ctrl+x" onPress={async () => { await $.ui.close({ id: PANE }); await closed($) }} /></Box>
        <Text bold>PC</Text>
        <Text>
          CPU <Text color={fracColor(cpuFrac)}>{bar(cpuFrac)}</Text> {s.cpuUsage}%
          {s.cpuTemp !== undefined && <Text color={tempColor(s.cpuTemp)}> {Math.round(s.cpuTemp)}°C</Text>}
        </Text>
        <Text>
          RAM <Text color={fracColor(ramFrac)}>{bar(ramFrac)}</Text> {gb(s.ramUsedMb)}/{gb(s.ramTotalMb)} GB
        </Text>
        {s.gpu && (
          <Text>
            GPU <Text color={fracColor(s.gpu.usage / 100)}>{bar(s.gpu.usage / 100)}</Text> {s.gpu.usage}%
            {s.gpu.temp !== undefined && <Text color={tempColor(s.gpu.temp)}> {s.gpu.temp}°C</Text>}
          </Text>
        )}
        {s.gpu && (
          <Text>
            VRAM <Text color={fracColor(s.gpu.memTotalMb ? s.gpu.memUsedMb / s.gpu.memTotalMb : 0)}>{bar(s.gpu.memTotalMb ? s.gpu.memUsedMb / s.gpu.memTotalMb : 0, 9)}</Text> {gb(s.gpu.memUsedMb)}/{gb(s.gpu.memTotalMb)} GB
          </Text>
        )}
        {s.gpu?.name && <Text dimColor>    {s.gpu.name}</Text>}

        <Text> </Text>
        <Text bold>Workspace</Text>
        <Text>{label('Path')}{s.cwd}</Text>
        {s.git && (
          <Text>
            {label('Branch')}<Text color="magenta">⎇ {s.git.branch}</Text>
            {s.git.behind > 0 && <Text dimColor> ↓{s.git.behind}</Text>}
            {s.git.ahead > 0 && <Text dimColor> ↑{s.git.ahead}</Text>}
          </Text>
        )}

        <Text> </Text>
        <Text bold>Model</Text>
        <Text>{label('Active')}{s.model}</Text>
        <Text>
          {label('Context')}
          {u.window === null ? '—' : `${u.tokens === null ? '—' : n(u.tokens)} / ${n(u.window)}`}
          {u.context !== null && <Text color={fracColor(u.context / 100)}> ({u.context}%)</Text>}
        </Text>
        <Text>{label('Cost')}{usd(u.cost)}</Text>
        <Text>{label('Total')}{usd(u.total)}</Text>
        <Text>
          {label('Cache')}
          {u.cacheRead === null ? '—' : `${n(u.cacheRead)} read`}
          {u.cacheRead !== null && u.tokens ? <Text dimColor> ({Math.round((u.cacheRead / u.tokens) * 100)}%)</Text> : null}
        </Text>
        {meter('Session', u.session)}
        {meter('Week', u.week)}

        <Text> </Text>
        <Text bold>Current session</Text>
        <Text>{label('Status')}<Text color={statusColor(current?.status ?? '')}>● {current?.status ?? '—'}</Text></Text>
        <Text>{label('Title')}{current?.name ?? '—'}</Text>
        <Text>{label('Id')}{s.sessionId.slice(0, 13)}</Text>

        <Text> </Text>
        <Text bold>Sessions ({others.length})</Text>
        {others.length === 0 && <Text dimColor>No other open sessions.</Text>}
        {others.map(x => (
          <Text key={`session-${x.id}`}>
            <Text color={statusColor(x.status)}>● </Text>{x.name} <Text dimColor>{base(x.cwd)}</Text>
          </Text>
        ))}

        <Text> </Text>
        {progressBlock}
        <Text bold>Ports</Text>
        {s.ports.length === 0 && <Text dimColor>No ports with a visible process.</Text>}
        {s.ports.map(p => (
          <Box flexDirection="row" key={`port-${p.port}`}>
            <Text>
              :{p.port} <Text dimColor>{p.process} ({p.pid})</Text>{' '}
            </Text>
            <Button key={`kill-${p.port}`} label="kill" dimColor onPress={kill(p.pid, p.process)} />
          </Box>
        ))}

        <Text> </Text>
        <Text bold>Containers</Text>
        {s.containers.length === 0 && <Text dimColor>No running containers.</Text>}
        {s.containers.map(c => (
          <Box flexDirection="row" key={`ctr-${c.name}`}>
            <Text>
              {c.name} <Text dimColor>{c.ports && `:${c.ports}`}</Text>
              {c.status.includes('unhealthy') && <Text color="red"> unhealthy</Text>}{' '}
            </Text>
            <Button key={`stop-${c.name}`} label="stop" dimColor onPress={stop(c.name)} />
          </Box>
        ))}
      </Box>
    )
  })
}
