import { expect, test } from 'claude-code/testing'

import { parseContainers, parseCpuStat, parseCpuTemp, parseGit, parseGpu, parseMemoria, parsePortas, parseSessoes } from '../../../hooks/ambiente/parse'

test('portas: filtra efêmeras, sem processo e duplicadas', () => {
  const ss = [
    'LISTEN 0 32 192.168.122.1:53 0.0.0.0:*',
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20))',
    'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=42,fd=21))',
    'LISTEN 0 128 127.0.0.1:45735 0.0.0.0:* users:(("steam",pid=9,fd=87))',
  ].join('\n')
  expect(parsePortas(ss)).toEqual([{ porta: 3000, endereco: '127.0.0.1', processo: 'node', pid: 42 }])
})

test('containers: portas sem duplicar IPv6', () => {
  const out = 'erp-api\tUp 1 minute\t0.0.0.0:3333->3333/tcp, [::]:3333->3333/tcp\n'
  expect(parseContainers(out)).toEqual([{ nome: 'erp-api', status: 'Up 1 minute', portas: '3333' }])
})

test('memória, cpu e gpu', () => {
  expect(parseMemoria('MemTotal:  2097152 kB\nMemAvailable:  1048576 kB\n')).toEqual([1024, 2048])
  expect(parseCpuTemp('{"coretemp-isa-0000":{"Package id 0":{"temp1_input":53}}}')).toBe(53)
  expect(parseCpuTemp('lixo')).toBe(undefined)
  expect(parseCpuStat('cpu  10 0 5 80 5 0 0 0 0 0\ncpu0 1 2 3 4\n')).toEqual({ ocioso: 80, total: 100 })
  expect(parseCpuStat('lixo')).toBe(undefined)
  expect(parseGpu('6, 52, 3078, 12288')).toEqual({ uso: 6, temp: 52, memUsadaMb: 3078, memTotalMb: 12288 })
  expect(parseGpu('')).toBe(undefined)
})

test('sessões: ignora linhas ruins e ordena pela mais recente', () => {
  const saida = [
    '{"sessionId":"aaaaaaaa-1","name":"erp-3f","cwd":"/p/erp","status":"idle","updatedAt":1}',
    'lixo',
    '{"sessionId":"bbbbbbbb-2","cwd":"/p/x","status":"busy","updatedAt":5}',
  ].join('\n')
  expect(parseSessoes(saida)).toEqual([
    { id: 'bbbbbbbb-2', nome: 'bbbbbbbb', cwd: '/p/x', status: 'busy', atualizadaEm: 5 },
    { id: 'aaaaaaaa-1', nome: 'erp-3f', cwd: '/p/erp', status: 'idle', atualizadaEm: 1 },
  ])
})

test('git: branch com e sem upstream', () => {
  expect(parseGit('staging\n', '0\t826\n')).toEqual({ branch: 'staging', frente: 0, atras: 826 })
  expect(parseGit('main\n', '')).toEqual({ branch: 'main', frente: 0, atras: 0 })
  expect(parseGit('', '')).toBeUndefined()
})
