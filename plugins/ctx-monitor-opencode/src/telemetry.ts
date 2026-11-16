import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { k } = require('../../../shared/format.js');
const { getAiMemoryStatus } = require('../../../shared/ai-memory.js');

export interface OpenCodeUsageSummary {
  model: string;
  usedTokens: number;
  contextLimit: number;
  percentage: number | null;
  cacheReadTokens: number;
  costUsd: number;
}

export function summarizeSessionUsage(
  messages: ReadonlyArray<Record<string, any>>,
  providers: ReadonlyArray<Record<string, any>> = [],
): OpenCodeUsageSummary {
  const assistantMsgs = messages.filter((m) => m?.role === 'assistant');
  const latest = assistantMsgs.at(-1);
  const modelId = latest?.modelID ?? latest?.model?.modelID ?? 'model --';
  const providerId = latest?.providerID ?? latest?.model?.providerID;

  let contextLimit = 0;
  for (const p of providers) {
    if (providerId && p?.id !== providerId) continue;
    const modelMeta = p?.models?.[modelId];
    if (modelMeta?.limit?.context) {
      contextLimit = Number(modelMeta.limit.context);
      break;
    }
  }

  const tokens = latest?.tokens ?? {};
  const input = Number(tokens.input ?? 0);
  const cacheRead = Number(tokens.cache?.read ?? 0);
  const output = Number(tokens.output ?? 0);
  const usedTokens = input + cacheRead + output;
  const percentage = contextLimit > 0 ? Math.min(100, Math.round((usedTokens / contextLimit) * 100)) : null;

  let costUsd = 0;
  for (const m of assistantMsgs) {
    if (Number.isFinite(m?.cost)) costUsd += Number(m.cost);
  }

  return {
    model: String(modelId),
    usedTokens,
    contextLimit,
    percentage,
    cacheReadTokens: cacheRead,
    costUsd,
  };
}

export function formatUsageBar(pct: number | null, width = 10): string {
  if (pct == null || !Number.isFinite(pct)) return 'ctx --';
  const p = Math.max(0, Math.floor(pct));
  const filled = Math.round((Math.min(100, p) / 100) * width);
  return `${'━'.repeat(filled)}${'─'.repeat(width - filled)} ${p}%`;
}

export function readMachineStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMemPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;
  const [load1] = os.loadavg();
  const cpus = os.cpus().length || 1;
  return {
    cpuLoad: Number(load1.toFixed(2)),
    cpus,
    memUsedPct: usedMemPct,
    memUsedLabel: `${k(Math.round((totalMem - freeMem) / (1024 * 1024)))}M/${k(Math.round(totalMem / (1024 * 1024)))}M`,
  };
}

export function readAiMemorySummary(sessionId = 'opencode') {
  const st = getAiMemoryStatus(sessionId);
  if (st.missing) return null;
  const queue = st.ok ? st.spool?.pending : st.pending;
  return {
    online: Boolean(st.ok),
    pages: Number(st.counts?.pages_latest ?? 0),
    queue: Number(queue ?? 0),
  };
}

export function extractUrlsFromParts(parts: ReadonlyArray<Record<string, any>>): string[] {
  const urls = new Set<string>();
  const rx = /https?:\/\/[^\s<>"'`)\]]+/g;
  for (const part of parts) {
    const candidates = [part?.text, part?.output, part?.state?.output, part?.state?.input && JSON.stringify(part.state.input)];
    for (const chunk of candidates) {
      if (typeof chunk !== 'string') continue;
      for (const match of chunk.match(rx) ?? []) {
        urls.add(match.replace(/[.,;:!?]+$/, ''));
      }
    }
  }
  return Array.from(urls);
}
