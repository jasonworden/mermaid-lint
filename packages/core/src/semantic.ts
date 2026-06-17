import type { Block } from './extract.js';

export interface SemanticWarning {
  rule: string;
  message: string;
  line?: number;
}

// Covers the seven most common flowchart node shapes (most-specific first).
// Groups: [1]=id, then exactly one of [2]-[8] contains the label text.
const NODE_DECL_RE =
  /\b([A-Za-z_][\w-]*)(?:\[\[([^\]]*)\]\]|\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/g;

function extractLabel(m: RegExpExecArray): string {
  for (let i = 2; i < m.length; i++) {
    if (m[i] !== undefined) return m[i].trim();
  }
  return '';
}

function checkDuplicateIds(block: Block): SemanticWarning[] {
  const seen = new Map<string, { label: string; line: number }>();
  const warnings: SemanticWarning[] = [];
  const lines = block.body.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.trimStart().startsWith('%%')) continue;

    NODE_DECL_RE.lastIndex = 0;
    for (;;) {
      const m = NODE_DECL_RE.exec(line);
      if (m === null) break;
      const id = m[1];
      const label = extractLabel(m);
      const bodyLine = lineIdx + 1; // 1-based

      const prior = seen.get(id);
      if (prior === undefined) {
        seen.set(id, { label, line: bodyLine });
      } else if (prior.label !== label) {
        warnings.push({
          rule: 'duplicate-id',
          message: `node "${id}" declared with label "${prior.label}" (line ${prior.line}) and "${label}" (line ${bodyLine})`,
          line: bodyLine,
        });
      }
    }
  }

  return warnings;
}

function isSuppressed(body: string, rule: string): boolean {
  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('%%')) continue;
    const directive = trimmed.slice(2).trim();
    if (directive === 'mermaid-lint-disable') return true;
    if (directive === `mermaid-lint-disable ${rule}`) return true;
  }
  return false;
}

export function checkSemantics(block: Block): SemanticWarning[] {
  if (block.type !== 'flowchart' && block.type !== 'graph') return [];
  if (isSuppressed(block.body, 'duplicate-ids')) return [];
  return checkDuplicateIds(block);
}
