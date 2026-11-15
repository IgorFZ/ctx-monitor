import type { SessionMessage } from 'claude-code';

export type FileAction = 'created' | 'edited' | 'read' | 'deleted' | 'commands';
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };
export type FileEntry = {
  path: string;
  /** What Claude did to it, most significant first: created, edited, deleted, read. */
  action: FileAction;
  reads: number;
  writes: number;
  /** Content before the session's first write; null for a created file, undefined when unknown. */
  original?: string | null;
  /** Each write's own hunks, in order: the fallback when the original is unknown. */
  hunks: Hunk[];
};

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function pathOf(input: Record<string, unknown>): string | undefined {
  return str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
}

/** Paths a Bash command removes with rm or git rm (flags and globs left out). */
export function removedPaths(command: string): string[] {
  const paths: string[] = [];
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const words = segment.trim().split(/\s+/);
    const at = words[0] === 'git' && words[1] === 'rm' ? 2 : words[0] === 'rm' ? 1 : -1;
    if (at < 0) continue;
    for (const word of words.slice(at)) {
      if (!word || word.startsWith('-') || /[*?$`|<>]/.test(word)) continue;
      paths.push(word.replace(/^['"]|['"]$/g, ''));
    }
  }
  return paths;
}

type ToolUse = { tool: string; input: Record<string, unknown>; result?: unknown; isError?: true };

/** Builds the file list one tool call at a time: from the transcript, then live as calls finish. */
export function createFileLog() {
  const files = new Map<string, FileEntry>();
  const entry = (path: string) => {
    const f = files.get(path) ?? { path, action: 'read' as FileAction, reads: 0, writes: 0, hunks: [] };
    // Most recently touched last, so the list reverses into newest first.
    files.delete(path);
    files.set(path, f);
    return f;
  };
  function consume(use: ToolUse) {
    if (use.isError) return;
    const path = pathOf(use.input);
    if (path && READ_TOOLS.has(use.tool)) entry(path).reads++;
    if (path && WRITE_TOOLS.has(use.tool)) {
      const result = (use.result ?? {}) as Record<string, unknown>;
      if (result.staged === true) return;
      const f = entry(path);
      f.writes++;
      if (f.original === undefined && 'originalFile' in result) {
        f.original = typeof result.originalFile === 'string' ? result.originalFile : null;
      }
      if (result.type === 'create' && f.writes === 1) f.original = null;
      if (Array.isArray(result.structuredPatch)) f.hunks.push(...(result.structuredPatch as Hunk[]));
      f.action = f.original === null ? 'created' : 'edited';
    }
    if (use.tool === 'Bash') {
      for (const removed of removedPaths(str(use.input.command) ?? '')) {
        const known = [...files.keys()].find(p => p === removed || p.endsWith(`/${removed}`) || p.endsWith(`\\${removed}`));
        if (known) files.get(known)!.action = 'deleted';
      }
    }
  }
  return { consume, list: () => [...files.values()].reverse() };
}

/** Every file the session read or changed through Claude's own tools, newest first. */
export function collectFiles(messages: SessionMessage[]): FileEntry[] {
  const log = createFileLog();
  for (const message of messages) for (const use of message.toolUses ?? []) log.consume(use);
  return log.list();
}

/** Splits text into lines the way a diff counts them, a trailing newline ending the last line. */
const lines = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

// Past this many cells the LCS table would cost too much; the caller falls back to the write hunks.
const MAX_CELLS = 4_000_000;

/**
 * A unified diff (hunks only) from `before` to `after`, with `context` lines around each change;
 * undefined when the files are too large to compare here, '' when they are equal.
 */
export function unifiedDiff(before: string, after: string, context = 3): string | undefined {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return '';
  if (n * m > MAX_CELLS) return undefined;

  // LCS lengths from the end, so the walk below goes forward.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[start + i] === b[start + j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  type Op = { kind: ' ' | '-' | '+'; text: string; oldNo: number; newNo: number };
  const ops: Op[] = [];
  for (let k = 0; k < start; k++) ops.push({ kind: ' ', text: a[k]!, oldNo: k + 1, newNo: k + 1 });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ kind: ' ', text: a[start + i]!, oldNo: start + i + 1, newNo: start + j + 1 }); i++; j++;
    } else if (i < n && (j === m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      // Removals before additions, as git prints them.
      ops.push({ kind: '-', text: a[start + i]!, oldNo: start + i + 1, newNo: start + j }); i++;
    } else {
      ops.push({ kind: '+', text: b[start + j]!, oldNo: start + i, newNo: start + j + 1 }); j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ kind: ' ', text: a[endA + k]!, oldNo: endA + k + 1, newNo: endB + k + 1 });
  }

  // Group the changes into hunks with their context, merging hunks whose context touches.
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  const out: string[] = [];
  let h = 0;
  while (h < changed.length) {
    const from = Math.max(0, changed[h]! - context);
    let to = changed[h]!;
    while (h < changed.length && changed[h]! <= to + 2 * context + 1) to = changed[h++]!;
    to = Math.min(ops.length - 1, to + context);
    const slice = ops.slice(from, to + 1);
    const oldLines = slice.filter(op => op.kind !== '+').length;
    const newLines = slice.filter(op => op.kind !== '-').length;
    // A side with no lines in the hunk names the line before it, as unified diffs do.
    const oldStart = slice.find(op => op.kind !== '+')?.oldNo ?? slice[0]!.oldNo;
    const newStart = slice.find(op => op.kind !== '-')?.newNo ?? slice[0]!.newNo;
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    for (const op of slice) out.push(`${op.kind}${op.text}`);
  }
  return out.join('\n');
}

/** The write hunks as one diff text, for a file whose original content is unknown. */
export function hunksDiff(hunks: Hunk[]): string {
  return hunks
    .map(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'))
    .join('\n');
}

/** Added and removed line counts of a diff text. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** `git status --porcelain=v1 -z` → paths changed or untracked (renames give the new path). */
export function parseGitStatus(output: string): string[] {
  const paths: string[] = [];
  const fields = output.split('\0');
  for (let k = 0; k < fields.length; k++) {
    const field = fields[k]!;
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (status.includes('R') || status.includes('C')) k++;
  }
  return paths;
}
