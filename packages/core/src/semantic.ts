import type { Block } from './extract.js';

/**
 * A non-fatal semantic finding (e.g. a duplicate node id) raised by
 * {@link checkSemantics}, distinct from a syntax error.
 *
 * @public
 */
export interface SemanticWarning {
  /** Stable rule name, e.g. `'duplicate-ids'`. */
  rule: string;
  /** Human-readable description of the finding. */
  message: string;
  /** 1-indexed line within the diagram body, when known. */
  line?: number;
}

// Covers the seven most common flowchart node shapes (most-specific first).
// Groups: [1]=id, then exactly one of [2]-[8] contains the label text.
// \w at the start allows numeric IDs (e.g. 1[Start]).
const NODE_DECL_RE =
  /\b(\w[\w-]*)(?:\[\[([^\]]*)\]\]|\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/g;

function extractLabel(m: RegExpExecArray): string {
  for (let i = 2; i < m.length; i++) {
    if (m[i] !== undefined) return m[i].trim();
  }
  return '';
}

function checkDuplicateIds(lines: string[]): SemanticWarning[] {
  const seen = new Map<string, { label: string; line: number }>();
  const warnings: SemanticWarning[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.trimStart().startsWith('%%')) continue;

    NODE_DECL_RE.lastIndex = 0;
    for (;;) {
      const m = NODE_DECL_RE.exec(line);
      if (m === null) break;
      const id = m[1];
      const label = extractLabel(m);
      const bodyLine = lineIdx + 1;

      const prior = seen.get(id);
      if (prior === undefined) {
        seen.set(id, { label, line: bodyLine });
      } else if (prior.label !== label) {
        warnings.push({
          rule: 'duplicate-ids',
          message: `node "${id}" declared with label "${prior.label}" (line ${prior.line}) and "${label}" (line ${bodyLine})`,
          line: bodyLine,
        });
      }
    }
  }

  return warnings;
}

function isSuppressed(lines: string[], rule: string): boolean {
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('%%')) continue;
    const directive = trimmed.slice(2).trim();
    if (directive === 'mermaid-lint-disable') return true;
    if (directive === `mermaid-lint-disable ${rule}`) return true;
  }
  return false;
}

/**
 * Run semantic checks on a {@link Block}. Currently flags duplicate flowchart
 * node ids declared with conflicting labels; only `flowchart`/`graph` diagrams
 * are checked, and an in-diagram `%% mermaid-lint-disable` directive suppresses
 * findings.
 *
 * @param block - The block to inspect.
 * @returns Any {@link SemanticWarning}s found (empty when none apply).
 * @public
 */
export function checkSemantics(block: Block): SemanticWarning[] {
  if (block.type !== 'flowchart' && block.type !== 'graph') return [];
  const lines = block.body.split('\n');
  if (isSuppressed(lines, 'duplicate-ids')) return [];
  return checkDuplicateIds(lines);
}
