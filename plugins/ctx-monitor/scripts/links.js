#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { configDir } = require('./config');

(async () => {
  const { createMessageCollector, markdownLinks } = await import('./links-core.mjs');
  const session = process.argv[2];
  if (!/^[\w-]{1,128}$/.test(session ?? '')) throw new Error('Informe o ID da sessão atual.');
  const registry = path.join(configDir(), 'ctx-monitor', 'sessions', `${session}.json`);
  if (!fs.existsSync(registry)) throw new Error('Sessão não registrada. Reabra o Claude Code com o plugin habilitado.');
  const { transcript } = JSON.parse(fs.readFileSync(registry, 'utf8'));
  const messages = createMessageCollector();
  const lines = readline.createInterface({ input: fs.createReadStream(transcript), crlfDelay: Infinity });
  for await (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!['user', 'assistant'].includes(row.type) || !row.message) continue;
    const content = row.message.content;
    const message = { role: row.type, text: '', toolUses: [], toolResults: [] };
    if (typeof content === 'string') message.text = content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === 'text') message.text += (message.text ? '\n' : '') + block.text;
      if (block.type === 'tool_use') message.toolUses.push({ tool_use_id: block.id, tool: block.name });
      if (block.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content
          : (block.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
        message.toolResults.push({ tool_use_id: block.tool_use_id, text });
      }
    }
    messages.consume(message);
  }
  console.log(markdownLinks(messages.list()));
})().catch(error => { console.error(`ctx-monitor: ${error.message}`); process.exitCode = 1; });
