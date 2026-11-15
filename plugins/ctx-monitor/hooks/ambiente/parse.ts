import type { Container, Git, Porta, SessaoLocal } from '../../types'

// Portas efêmeras (>= 32768) são quase sempre ruído de apps como Steam e torrent.
const PORTA_EFEMERA = 32768

/** Lê a saída de `ss -ltnpH` e devolve uma linha por porta com processo conhecido. */
export function parsePortas(saida: string): Porta[] {
  const vistas = new Map<number, Porta>()
  for (const linha of saida.split('\n')) {
    const campos = linha.trim().split(/\s+/)
    if (campos.length < 6) continue
    const local = campos[3] ?? ''
    const sep = local.lastIndexOf(':')
    const porta = Number(local.slice(sep + 1))
    const proc = /\(\("([^"]+)",pid=(\d+)/.exec(linha)
    if (!proc || !Number.isInteger(porta) || porta >= PORTA_EFEMERA || vistas.has(porta)) continue
    vistas.set(porta, { porta, endereco: local.slice(0, sep), processo: proc[1] ?? "", pid: Number(proc[2]) })
  }
  return [...vistas.values()].sort((a, b) => a.porta - b.porta)
}

/** Lê `docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'`. */
export function parseContainers(saida: string): Container[] {
  return saida
    .split('\n')
    .filter(l => l.includes('\t'))
    .map(l => {
      const [nome = '', status = '', portas = ''] = l.split('\t')
      // Só a parte IPv4 de cada mapeamento, sem repetir o [::].
      const curtas = [...new Set([...portas.matchAll(/:(\d+)->/g)].map(m => m[1]))].join(',')
      return { nome, status, portas: curtas }
    })
}

/** Devolve [usadaMb, totalMb] a partir de /proc/meminfo. */
export function parseMemoria(meminfo: string): [number, number] {
  const kb = (chave: string) => Number(new RegExp(`^${chave}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0)
  const total = kb('MemTotal')
  return [Math.round((total - kb('MemAvailable')) / 1024), Math.round(total / 1024)]
}

/** Tempos agregados da linha `cpu` de /proc/stat; ocioso é só o campo idle, como na waybar. */
export function parseCpuStat(stat: string): { ocioso: number; total: number } | undefined {
  const tempos = /^cpu\s+(.+)$/m.exec(stat)?.[1]?.trim().split(/\s+/).map(Number)
  if (!tempos || tempos.length < 4 || tempos.some(Number.isNaN)) return undefined
  return { ocioso: tempos[3] ?? 0, total: tempos.reduce((a, b) => a + b, 0) }
}

/** Temperatura do pacote da CPU (coretemp) a partir de `sensors -j`. */
export function parseCpuTemp(json: string): number | undefined {
  try {
    const dados = JSON.parse(json) as Record<string, Record<string, Record<string, number>>>
    for (const [chip, leituras] of Object.entries(dados)) {
      if (!chip.startsWith('coretemp')) continue
      const pacote = leituras['Package id 0']
      if (pacote) return pacote.temp1_input
    }
  } catch {
    // sensors indisponível ou saída inválida: sem temperatura.
  }
  return undefined
}

/** Lê `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseGpu(saida: string) {
  const [uso, temp, memUsadaMb, memTotalMb] = (saida.split('\n')[0] ?? '').split(',').map(s => Number(s.trim()))
  if ([uso, temp, memUsadaMb, memTotalMb].some(v => v === undefined || Number.isNaN(v))) return undefined
  return { uso: uso!, temp: temp!, memUsadaMb: memUsadaMb!, memTotalMb: memTotalMb! }
}

/** Lê os JSON de ~/.claude/sessions (um por linha) e devolve as sessões, a mais recente primeiro. */
export function parseSessoes(saida: string): SessaoLocal[] {
  const sessoes: SessaoLocal[] = []
  for (const linha of saida.split('\n')) {
    try {
      const s = JSON.parse(linha) as Record<string, unknown>
      if (typeof s.sessionId !== 'string') continue
      sessoes.push({
        id: s.sessionId,
        nome: typeof s.name === 'string' ? s.name : s.sessionId.slice(0, 8),
        cwd: typeof s.cwd === 'string' ? s.cwd : '',
        status: typeof s.status === 'string' ? s.status : '?',
        atualizadaEm: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      })
    } catch {
      // Linha vazia ou arquivo sendo reescrito: ignora.
    }
  }
  return sessoes.sort((a, b) => b.atualizadaEm - a.atualizadaEm)
}

/** Junta `git rev-parse --abbrev-ref HEAD` e `git rev-list --left-right --count HEAD...@{u}`. */
export function parseGit(branch: string, contagem: string): Git | undefined {
  const nome = branch.trim()
  if (!nome) return undefined
  const [frente, atras] = contagem.trim().split(/\s+/).map(Number)
  return { branch: nome, frente: frente || 0, atras: atras || 0 }
}
