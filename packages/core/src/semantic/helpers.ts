import type { Block } from '../extract.js';

// Covers the seven most common flowchart node shapes (most-specific first).
// Groups: [1]=id, then exactly one of [2]-[8] contains the label text.
// \w at the start allows numeric IDs (e.g. 1[Start]).
export const NODE_DECL_RE =
  /\b(\w[\w-]*)(?:\[\[([^\]]*)\]\]|\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/g;

// Mermaid flowchart direction tokens that may follow `flowchart`/`graph`.
export const DIRECTION_RE = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/;

export function extractLabel(m: RegExpExecArray): string {
  for (let i = 2; i < m.length; i++) {
    if (m[i] !== undefined) return m[i].trim();
  }
  return '';
}

export function isFlowchartOrGraph(block: Block): boolean {
  return block.type === 'flowchart' || block.type === 'graph';
}

export function isGantt(block: Block): boolean {
  return block.type === 'gantt';
}

/**
 * Count of leading whitespace characters (each counts as one column). The
 * mindmap, treemap, kanban, and ishikawa hierarchies are all indentation-based, and
 * Mermaid measures their indent in characters — a tab counts as one, same as a
 * space.
 */
export function indentWidth(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
}

/**
 * Count the whitespace run immediately *before* `start`. Mermaid's indentation
 * terminals match wherever they sit rather than only at a line's start, so a
 * statement that follows something else on its line is indented by the gap in
 * between — `accDescr { d } "A"` indents `"A"` by one. For a token that does
 * open its line this is {@link indentWidth}; the two only diverge mid-line.
 */
export function precedingIndent(line: string, start: number): number {
  let n = start;
  while (n > 0 && (line[n - 1] === ' ' || line[n - 1] === '\t')) n--;
  return start - n;
}

/** Mutable cursor for {@link scanAccDescr}, one per body scan. */
export interface AccDescrState {
  /** True while inside a block whose `}` has not arrived yet. */
  open: boolean;
}

/** The opening line of an `accDescr { … }` block. */
const ACC_DESCR_OPEN_RE = /^accDescr\s*\{/;

/** A bare `accDescr` whose `{` opens on a later line. */
export const ACC_DESCR_BARE_RE = /^accDescr$/;

/**
 * What a caller should do with a line, once the `accDescr` scan has seen it.
 * `null` means the line is not part of a block and should be handled normally;
 * {@link CONSUME_LINE} means skip it entirely; any other number is an offset
 * into the raw line at which real statements resume.
 */
export const CONSUME_LINE = -1;

/**
 * Advance an `accDescr { … }` block scan by one line, and say what is left of
 * that line to read.
 *
 * Four diagram types need this and none of them can share a single answer,
 * because their grammars differ in one respect: whether a statement may follow
 * the block's closing `}` on the same line. `treemap-beta` and `treeView-beta`
 * allow it — `accDescr { d } "A"` declares a row — so they pass
 * `statementMayFollow` and resume at the returned offset. `wardley-beta` and
 * `eventmodeling` reject two statements on one line outright, so nothing can
 * follow the brace and they consume the whole line. All four were probed
 * against mermaid 11.15.0 and are pinned in `mermaid-behavior.test.ts`.
 *
 * The lookahead for the bare form walks an index rather than
 * `lines.slice(i + 1).find(…)`: the slice copies the whole remaining body, so a
 * body of nothing but bare `accDescr` lines re-copies it once per line —
 * quadratic, and reachable, since `checkSemantics` runs ahead of any parse.
 */
export function scanAccDescr(
  state: AccDescrState,
  lines: string[],
  i: number,
  statementMayFollow: boolean,
): number | null {
  const raw = lines[i];
  const trimmed = raw.trim();
  // Offset of `trimmed` within `raw`, so an index found in the former maps
  // back onto the latter.
  const lead = raw.length - raw.trimStart().length;

  const resumeAfter = (closeInTrimmed: number): number =>
    statementMayFollow ? lead + closeInTrimmed + 1 : CONSUME_LINE;

  if (state.open) {
    const close = trimmed.indexOf('}');
    if (close === -1) return CONSUME_LINE;
    state.open = false;
    return resumeAfter(close);
  }

  if (ACC_DESCR_OPEN_RE.test(trimmed)) {
    const close = trimmed.indexOf('}', trimmed.indexOf('{'));
    if (close === -1) {
      state.open = true;
      return CONSUME_LINE;
    }
    return resumeAfter(close);
  }

  if (ACC_DESCR_BARE_RE.test(trimmed)) {
    // Only whitespace may separate the keyword from its brace, so anything
    // else on the next non-blank line means this never lexed as an `accDescr`
    // and the lines after it are ordinary statements.
    let next = i + 1;
    while (next < lines.length && lines[next].trim() === '') next++;
    if (next < lines.length && lines[next].trim().startsWith('{')) {
      state.open = true;
    }
    return CONSUME_LINE;
  }

  return null;
}

export function parseCsvCells(raw: string): string[] | null {
  if (raw === '') return [];

  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (inQuotes) return null;
  cells.push(current);
  return cells;
}

/**
 * Strip the trailing colon `radar-beta:` is allowed to carry. Radar is the only
 * diagram whose grammar accepts a colon after the keyword — `xychart-beta:` and
 * `treemap-beta:` are both parse errors — and `detectDiagramType` reports the
 * header verbatim, so the colon reaches `block.type`. Every `-beta` suffix test
 * goes through here so that form is not silently exempt from the beta rules.
 */
export function stripHeaderColon(type: string): string {
  return type.endsWith(':') ? type.slice(0, -1) : type;
}

export function commaItemCount(value: string): number {
  return parseCsvCells(value)?.length ?? 0;
}
