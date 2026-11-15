import { expect, test } from 'claude-code/testing'

import {
  parseContainers,
  parseCpuStat,
  parseCpuTemp,
  parseGit,
  parseGpu,
  parseMemory,
  parsePorts,
  parseSessions,
  parseWindows,
} from '../../../hooks/environment/collect'

test('ports: drops ephemeral, processless and duplicate ports', () => {
  const ss = [
    'LISTEN 0 32 192.168.122.1:53 0.0.0.0:*',
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20))',
    'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=42,fd=21))',
    'LISTEN 0 128 127.0.0.1:45735 0.0.0.0:* users:(("steam",pid=9,fd=87))',
  ].join('\n')
  expect(parsePorts(ss)).toEqual([{ port: 3000, address: '127.0.0.1', process: 'node', pid: 42 }])
})

test('containers: ports without repeating IPv6, Windows line endings included', () => {
  const out = 'erp-api\tUp 1 minute\t0.0.0.0:3333->3333/tcp, [::]:3333->3333/tcp\r\n'
  expect(parseContainers(out)).toEqual([{ name: 'erp-api', status: 'Up 1 minute', ports: '3333' }])
})

test('memory, cpu and gpu', () => {
  expect(parseMemory('MemTotal:  2097152 kB\nMemAvailable:  1048576 kB\n')).toEqual([1024, 2048])
  expect(parseCpuTemp('{"coretemp-isa-0000":{"Package id 0":{"temp1_input":53}}}')).toBe(53)
  expect(parseCpuTemp('garbage')).toBe(undefined)
  expect(parseCpuStat('cpu  10 0 5 80 5 0 0 0 0 0\ncpu0 1 2 3 4\n')).toEqual({ idle: 80, total: 100 })
  expect(parseCpuStat('garbage')).toBe(undefined)
  expect(parseGpu('6, 52, 3078, 12288')).toEqual({ usage: 6, temp: 52, memUsedMb: 3078, memTotalMb: 12288 })
  expect(parseGpu('')).toBe(undefined)
})

test('sessions: skips bad lines and sorts newest first', () => {
  const output = [
    '{"sessionId":"aaaaaaaa-1","name":"erp-3f","cwd":"/p/erp","status":"idle","updatedAt":1}',
    'garbage',
    '{"sessionId":"bbbbbbbb-2","cwd":"/p/x","status":"busy","updatedAt":5}',
  ].join('\n')
  expect(parseSessions(output)).toEqual([
    { id: 'bbbbbbbb-2', name: 'bbbbbbbb', cwd: '/p/x', status: 'busy', updatedAt: 5 },
    { id: 'aaaaaaaa-1', name: 'erp-3f', cwd: '/p/erp', status: 'idle', updatedAt: 1 },
  ])
})

test('git: branch with and without upstream', () => {
  expect(parseGit('staging\n', '0\t826\n')).toEqual({ branch: 'staging', ahead: 0, behind: 826 })
  expect(parseGit('main\r\n', '')).toEqual({ branch: 'main', ahead: 0, behind: 0 })
  expect(parseGit('', '')).toBeUndefined()
})

test('windows: reads the PowerShell reading and drops system and ephemeral ports', () => {
  const session = '{\r\n  "sessionId": "cccccccc-3",\r\n  "cwd": "C:\\\\work\\\\app",\r\n  "status": "idle",\r\n  "updatedAt": 7\r\n}'
  const output = JSON.stringify({
    cpu: 12.6,
    memTotalKb: 33440796,
    memFreeKb: 9994164,
    ports: [
      { port: 49676, address: '::', pid: 1268, process: 'services' },
      { port: 5357, address: '::', pid: 4, process: 'System' },
      { port: 135, address: '0.0.0.0', pid: 1100, process: 'svchost' },
      { port: 5173, address: '::1', pid: 3100, process: 'node' },
      { port: 5173, address: '127.0.0.1', pid: 3100, process: 'node' },
      { port: 8080, address: '0.0.0.0', pid: 900, process: null },
    ],
    sessions: [session],
  })
  expect(parseWindows(output)).toEqual({
    cpuUsage: 13,
    ramUsedMb: 22897,
    ramTotalMb: 32657,
    ports: [{ port: 5173, address: '::1', process: 'node', pid: 3100 }],
    sessions: [{ id: 'cccccccc-3', name: 'cccccccc', cwd: 'C:\\work\\app', status: 'idle', updatedAt: 7 }],
  })
  expect(parseWindows('')).toBeUndefined()
  expect(parseWindows('{"cpu":null}')).toEqual({ cpuUsage: 0, ramUsedMb: 0, ramTotalMb: 0, ports: [], sessions: [] })
})
