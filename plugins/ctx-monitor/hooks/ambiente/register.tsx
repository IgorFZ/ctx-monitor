import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, Timer } from 'claude-code'

import type { Snapshot } from '../../types'
import { parseContainers, parseCpuStat, parseCpuTemp, parseGit, parseGpu, parseMemoria, parsePortas, parseSessoes } from './parse'
import { describe, ESTIMATE_PROMPT, formatDuration, fraction, parseEstimate } from './progresso'
import { accumulate, pick } from './uso'

const PANE = 'ambiente'
// Ação do motor sem handler próprio montado; o atalho dela (ctrl+x ctrl+x) fica em ~/.claude/keybindings.json.
const ACAO_ALTERNAR = 'app:toggleReplTab'
const aberta = atom({ plugin: 'ctx-monitor', key: 'aberta' } as const, false)
const INTERVALO_MS = 1000
const snapshot = atom({ plugin: 'ctx-monitor', key: 'snapshot' } as const, null)
const uso = atom({ plugin: 'ctx-monitor', key: 'uso' } as const, {
  context: null,
  tokens: null,
  janela: null,
  cacheLido: null,
  session: null,
  week: null,
  cost: null,
  total: null,
})
const progresso = atom({ plugin: 'ctx-monitor', key: 'progresso' } as const, {
  startedAt: null,
  now: 0,
  estimateMs: null,
  estimateError: null,
})
async function totalInicial($: EngineInterface, custoAtual: number): Promise<number> {
  const guardado = await $.store.get('totalUsd')
  if (typeof guardado === 'number') return guardado
  await $.store.set('totalUsd', custoAtual)
  return custoAtual
}

let timer: { cancel: () => void } | undefined
// Abre sozinha uma vez por carga; se a pessoa fechar à mão, não reabre.
let autoAberta = false

async function rodar($: EngineInterface, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    // Comando ausente ou travado: a seção correspondente fica vazia.
    return ''
  }
}

// Só sessões vivas: o arquivo de uma sessão que caiu fica para trás em ~/.claude/sessions.
const SESSOES_VIVAS =
  'for f in "$HOME"/.claude/sessions/*.json; do p=$(basename "$f" .json); [ -d /proc/$p ] && { cat "$f"; echo; }; done; true'

let cpuAnterior: { ocioso: number; total: number } | undefined

async function coletar($: EngineInterface): Promise<Snapshot> {
  const cwd = await $.session.cwd()
  const [modelo, sessaoId, branch, contagem, sessoes] = await Promise.all([
    $.session.model(),
    $.session.id(),
    rodar($, ['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']),
    rodar($, ['git', '-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    rodar($, ['sh', '-c', SESSOES_VIVAS]),
  ])
  const [stat, meminfo, sensors, gpu, ss, docker] = await Promise.all([
    rodar($, ['cat', '/proc/stat']),
    rodar($, ['cat', '/proc/meminfo']),
    rodar($, ['sensors', '-j']),
    rodar($, ['nvidia-smi', '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']),
    rodar($, ['ss', '-ltnpH']),
    rodar($, ['docker', 'ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}']),
  ])
  const [ramUsadaMb, ramTotalMb] = parseMemoria(meminfo)
  // Mesma conta do módulo cpu da waybar: fração não ociosa entre duas leituras de /proc/stat.
  const cpuAtual = parseCpuStat(stat)
  const dTotal = cpuAtual && cpuAnterior ? cpuAtual.total - cpuAnterior.total : 0
  const cpuUso = cpuAtual && cpuAnterior && dTotal > 0 ? Math.round((100 * (dTotal - (cpuAtual.ocioso - cpuAnterior.ocioso))) / dTotal) : 0
  if (cpuAtual) cpuAnterior = cpuAtual
  return {
    cwd,
    git: parseGit(branch, contagem),
    modelo,
    sessaoId,
    sessoes: parseSessoes(sessoes),
    cpuUso,
    ramUsadaMb,
    ramTotalMb,
    cpuTemp: parseCpuTemp(sensors),
    gpu: parseGpu(gpu),
    portas: parsePortas(ss),
    containers: parseContainers(docker),
    atualizadoEm: Date.now(),
  }
}

// A 1s, uma coleta lenta (docker, nvidia-smi) não pode empilhar outra por cima.
let coletando = false

async function atualizar($: EngineInterface) {
  if (coletando) return
  coletando = true
  try {
    const snap = await coletar($)
    await update($, snapshot, () => snap)
  } finally {
    coletando = false
  }
}

function barra(frac: number, largura = 10) {
  const cheio = Math.round(Math.min(1, Math.max(0, frac)) * largura)
  return '█'.repeat(cheio) + '░'.repeat(largura - cheio)
}

function corTemp(t?: number) {
  if (t === undefined) return undefined
  return t >= 80 ? 'red' : t >= 65 ? 'yellow' : 'green'
}

function corFrac(f: number) {
  return f >= 0.9 ? 'red' : f >= 0.7 ? 'yellow' : 'green'
}

async function abrir($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Ambiente', columns: 44 })
  await update($, aberta, () => true)
  timer?.cancel()
  timer = $.clock.every(INTERVALO_MS, () => void atualizar($))
  await atualizar($)
}

// O $.ui.close do próprio mod não dispara o hook ui.close (reentrada), então quem fecha chama isto.
async function fechada($: EngineInterface) {
  timer?.cancel()
  timer = undefined
  await update($, aberta, () => false)
}

// Último custo da sessão já somado ao total; recomeça a cada carga do módulo.
let ultimoCusto = 0
let tick: Timer | null = null
let estimando: AbortController | null = null

/** Parte de session.start da barra; o hook em index.ts junta as partes de cada recurso. */
export async function iniciarAmbiente($: EngineInterface) {
  await $.command.register({ name: 'ambiente', description: 'Abre a barra de ambiente: uso, progresso, PC, portas e containers' })
  // A medição que passou antes do mod carregar não volta: lê o valor atual. O custo que a
  // sessão já tinha não entra no total (já foi somado antes de uma recarga).
  const leitura = await $.session.usage()
  ultimoCusto = leitura.cost?.usd ?? 0
  const total = await totalInicial($, ultimoCusto)
  await update($, uso, () => pick(leitura, total))
}

/** Parte de turn.complete da barra: para o relógio e a estimativa do pedido. */
export async function concluirTurnoAmbiente($: EngineInterface) {
  tick?.cancel()
  tick = null
  estimando?.abort()
  estimando = null
  await update($, progresso, p => ({ ...p, startedAt: null }))
}

/** Com a barra fechada, a faixa acima do prompt ganha o botão que o atalho aperta para reabri-la. */
export async function faixaAmbiente($: EngineInterface, e: RenderInput<'AbovePrompt'>, beneath: RenderElement): Promise<RenderElement> {
  // Lê o layout pelo primeiro desenho da faixa e abre a barra só onde ela vira lateral.
  if (!autoAberta && e.viewport?.isFullscreen === true) {
    autoAberta = true
    // Desenho não pode gravar estado: abre fora do render, no próximo tique do relógio.
    const adiado = $.clock.every(10, () => {
      adiado.cancel()
      void abrir($)
    })
  }
  if (e.surface !== 'terminal' || e.props.hasSurvey || (await read($, aberta))) return beneath
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {beneath}
      <Button key="alternar" action={ACAO_ALTERNAR} plain dimColor label="ctrl+x ctrl+x · ambiente" onPress={() => void abrir($)} />
    </Box>
  )
}

export const registerAmbiente: Register = on => {

  // shortcut: duas sessões abertas ao mesmo tempo podem perder um incremento do total
  // (leitura e escrita não são atômicas); trocar por um lock se isso virar problema.
  on('session.measure', async ($, e, next) => {
    let total = (await read($, uso)).total
    if (e.changed.includes('cost') && e.cost) {
      const guardado = await $.store.get('totalUsd')
      total = accumulate(typeof guardado === 'number' ? guardado : 0, ultimoCusto, e.cost.usd)
      ultimoCusto = e.cost.usd
      await $.store.set('totalUsd', total)
    }
    let cache = (await read($, uso)).cacheLido
    if (e.changed.includes('context')) {
      // 'summary' estima localmente e não manda request de contagem.
      const lido = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
      cache = lido?.context.breakdown?.apiUsage?.cache_read_input_tokens ?? cache
    }
    await update($, uso, () => pick(e, total, cache))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, progresso, () => ({ startedAt, now: startedAt, estimateMs: null, estimateError: null }))

    tick?.cancel()
    tick = $.clock.every(1000, () => {
      void $.clock.now().then(now => update($, progresso, p => ({ ...p, now })))
    })

    // Não segura o pedido esperando a estimativa: ela chega quando chegar.
    estimando?.abort()
    const controller = new AbortController()
    estimando = controller
    void $.model
      .complete(
        { model: 'haiku', prompt: ESTIMATE_PROMPT(e.text), maxTokens: 64, effort: 'low', timeoutMs: 20_000 },
        { signal: controller.signal },
      )
      .then(reply => {
        if (controller.signal.aborted) return
        const estimateMs = reply.isAnswered ? parseEstimate(reply.text) : null
        const estimateError =
          estimateMs !== null ? null : reply.isAnswered ? `resposta sem número: "${reply.text.slice(0, 40)}"` : describe(reply)
        return update($, progresso, p => (p.startedAt === startedAt ? { ...p, estimateMs, estimateError } : p))
      })
      .catch((error: unknown) =>
        update($, progresso, p =>
          p.startedAt === startedAt ? { ...p, estimateError: error instanceof Error ? error.message : String(error) } : p,
        ),
      )

    return next(e)
  })

  on('command.run', { command: 'ambiente' }, async ($, e) => {
    await abrir($)
    // Só o layout fullscreen encaixa o painel ao lado da conversa (a partir de 110 colunas).
    if (e.presentation?.isFullscreen === false)
      return { text: 'Barra aberta acima do prompt. Para tê-la na lateral, inicie com CLAUDE_CODE_NO_FLICKER=1 claude e use o terminal com 110 colunas ou mais.' }
    return { text: 'Barra de ambiente aberta.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      autoAberta = true
      await fechada($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const u = await read($, uso)
    const pr = await read($, progresso)

    const medidor = (rotulo: string, pct: number | null) =>
      pct === null ? (
        <Text dimColor>{rotulo.padEnd(9)}—</Text>
      ) : (
        <Text>
          <Text dimColor>{rotulo.padEnd(9)}</Text>
          <Text color={corFrac(pct / 100)}>{barra(pct / 100)}</Text> {pct}%
        </Text>
      )
    const usd = (v: number | null) => (v === null ? '—' : `US$ ${v.toFixed(2)}`)
    const decorrido = pr.startedAt === null ? 0 : Math.max(pr.now - pr.startedAt, 0)
    const atrasado = pr.estimateMs !== null && decorrido > pr.estimateMs

    const blocoProgresso = (
      <Box flexDirection="column">
        <Text bold>Progresso</Text>
        {pr.startedAt === null ? (
          <Text dimColor>Nenhum pedido em andamento.</Text>
        ) : pr.estimateMs === null ? (
          <Text>
            {formatDuration(decorrido)}
            <Text dimColor>{pr.estimateError === null ? ' · estimando…' : ` · sem estimativa (${pr.estimateError})`}</Text>
          </Text>
        ) : (
          <Text>
            <Text color={atrasado ? 'yellow' : 'cyan'}>{barra(fraction(decorrido, pr.estimateMs), 12)}</Text> {formatDuration(decorrido)}
            <Text dimColor> de ~{formatDuration(pr.estimateMs)}{atrasado ? ' (passou)' : ''}</Text>
          </Text>
        )}
        <Text> </Text>
      </Box>
    )
    if (!s)
      return (
        <Box flexDirection="column">
          <Text dimColor>Coletando…</Text>
          <Text> </Text>
          {blocoProgresso}
        </Box>
      )

    const cpuFrac = s.cpuUso / 100
    const ramFrac = s.ramTotalMb ? s.ramUsadaMb / s.ramTotalMb : 0
    const gb = (mb: number) => (mb / 1024).toFixed(1)

    const matar = (pid: number, nome: string) => async () => {
      const r = await $.process.run(['kill', String(pid)]).catch(() => undefined)
      $.ui.toast(r?.exitCode === 0 ? `${nome} (${pid}) encerrado` : `Não consegui encerrar ${nome} (${pid})`)
      await atualizar($)
    }
    const parar = (nome: string) => async () => {
      $.ui.toast(`Parando ${nome}…`)
      const r = await $.process.run(['docker', 'stop', nome], { timeoutMs: 30000 }).catch(() => undefined)
      $.ui.toast(r?.exitCode === 0 ? `${nome} parado` : `Não consegui parar ${nome}`)
      await atualizar($)
    }

    const n = (v: number) => v.toLocaleString('pt-BR')
    const rotulo = (r: string) => <Text dimColor>{r.padEnd(9)}</Text>
    const atual = s.sessoes.find(x => x.id === s.sessaoId)
    const outras = s.sessoes.filter(x => x.id !== s.sessaoId)
    const base = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p
    const corStatus = (st: string) => (st === 'busy' ? 'yellow' : st === 'idle' ? 'green' : undefined)

    return (
      <Box flexDirection="column">
        {/* Escondido: só existe para o atalho ctrl+x ctrl+x ter o que apertar. */}
        <Box display="none"><Button key="alternar" action={ACAO_ALTERNAR} plain dimColor label="fechar · ctrl+x ctrl+x" onPress={async () => { await $.ui.close({ id: PANE }); await fechada($) }} /></Box>
        <Text bold>PC</Text>
        <Text>
          CPU <Text color={corFrac(cpuFrac)}>{barra(cpuFrac)}</Text> {s.cpuUso}%
          {s.cpuTemp !== undefined && <Text color={corTemp(s.cpuTemp)}> {Math.round(s.cpuTemp)}°C</Text>}
        </Text>
        <Text>
          RAM <Text color={corFrac(ramFrac)}>{barra(ramFrac)}</Text> {gb(s.ramUsadaMb)}/{gb(s.ramTotalMb)} GB
        </Text>
        {s.gpu && (
          <Text>
            GPU <Text color={corFrac(s.gpu.uso / 100)}>{barra(s.gpu.uso / 100)}</Text> {s.gpu.uso}%
            <Text color={corTemp(s.gpu.temp)}> {s.gpu.temp}°C</Text> {gb(s.gpu.memUsadaMb)}/{gb(s.gpu.memTotalMb)} GB
          </Text>
        )}

        <Text> </Text>
        <Text bold>Workspace</Text>
        <Text>{rotulo('Caminho')}{s.cwd}</Text>
        {s.git && (
          <Text>
            {rotulo('Branch')}<Text color="magenta">⎇ {s.git.branch}</Text>
            {s.git.atras > 0 && <Text dimColor> ↓{s.git.atras}</Text>}
            {s.git.frente > 0 && <Text dimColor> ↑{s.git.frente}</Text>}
          </Text>
        )}

        <Text> </Text>
        <Text bold>Modelo</Text>
        <Text>{rotulo('Ativo')}{s.modelo}</Text>
        <Text>
          {rotulo('Contexto')}
          {u.janela === null ? '—' : `${u.tokens === null ? '—' : n(u.tokens)} / ${n(u.janela)}`}
          {u.context !== null && <Text color={corFrac(u.context / 100)}> ({u.context}%)</Text>}
        </Text>
        <Text>{rotulo('Custo')}{usd(u.cost)}</Text>
        <Text>{rotulo('Total')}{usd(u.total)}</Text>
        <Text>
          {rotulo('Cache')}
          {u.cacheLido === null ? '—' : `${n(u.cacheLido)} lidos`}
          {u.cacheLido !== null && u.tokens ? <Text dimColor> ({Math.round((u.cacheLido / u.tokens) * 100)}%)</Text> : null}
        </Text>
        {medidor('Sessão', u.session)}
        {medidor('Semana', u.week)}

        <Text> </Text>
        <Text bold>Sessão atual</Text>
        <Text>{rotulo('Status')}<Text color={corStatus(atual?.status ?? '')}>● {atual?.status ?? '—'}</Text></Text>
        <Text>{rotulo('Título')}{atual?.nome ?? '—'}</Text>
        <Text>{rotulo('Id')}{s.sessaoId.slice(0, 13)}</Text>

        <Text> </Text>
        <Text bold>Sessões ({outras.length})</Text>
        {outras.length === 0 && <Text dimColor>Nenhuma outra sessão aberta.</Text>}
        {outras.map(x => (
          <Text key={`sessao-${x.id}`}>
            <Text color={corStatus(x.status)}>● </Text>{x.nome} <Text dimColor>{base(x.cwd)}</Text>
          </Text>
        ))}

        <Text> </Text>
        {blocoProgresso}
        <Text bold>Portas</Text>
        {s.portas.length === 0 && <Text dimColor>Nenhuma porta com processo visível.</Text>}
        {s.portas.map(p => (
          <Box flexDirection="row" key={`porta-${p.porta}`}>
            <Text>
              :{p.porta} <Text dimColor>{p.processo} ({p.pid})</Text>{' '}
            </Text>
            <Button key={`kill-${p.porta}`} label="matar" dimColor onPress={matar(p.pid, p.processo)} />
          </Box>
        ))}

        <Text> </Text>
        <Text bold>Containers</Text>
        {s.containers.length === 0 && <Text dimColor>Nenhum container rodando.</Text>}
        {s.containers.map(c => (
          <Box flexDirection="row" key={`ctr-${c.nome}`}>
            <Text>
              {c.nome} <Text dimColor>{c.portas && `:${c.portas}`}</Text>
              {c.status.includes('unhealthy') && <Text color="red"> unhealthy</Text>}{' '}
            </Text>
            <Button key={`stop-${c.nome}`} label="parar" dimColor onPress={parar(c.nome)} />
          </Box>
        ))}

      </Box>
    )
  })
}
