#!/usr/bin/env node
// Input: { columns, tasks }. Output: one JSON line { id, content } per task.
const { C, paint, clean, k, separator, width, fit, context } = require('./format');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(input); } catch { return; }
  if (!data || !Array.isArray(data.tasks)) return;
  const columns = Math.max(1, Number(data.columns) || 120);
  for (const task of data.tasks) {
    if (!task || typeof task.id !== 'string') continue;
    const name = clean(task.name ?? task.agentType ?? 'agent');
    const model = clean(task.model ? task.model.replace(/^claude-/, '') : 'model --');
    const effort = task.effort == null ? '' : ` · ${clean(task.effort)}`;
    const pct = task.contextWindowSize && task.tokenCount != null
      ? task.tokenCount / task.contextWindowSize * 100 : null;
    const tokens = pct == null ? `tokens ${k(task.tokenCount)}`
      : context(pct, task.tokenCount, task.contextWindowSize, columns >= 90 ? 8 : 0, true);
    const metadata = model + effort + separator + tokens;
    const label = fit(name, Math.max(1, columns - width(metadata) - 3));
    let content = paint(C.cyan, label) + separator + metadata;
    // The UI already draws the running indicator to the left of the line.
    const description = clean(task.label ?? task.description ?? '');
    if (description && columns - width(content) > 16) {
      content += separator + fit(description, columns - width(content) - 3);
    }
    process.stdout.write(JSON.stringify({ id: task.id, content: fit(content, columns) }) + '\n');
  }
});
