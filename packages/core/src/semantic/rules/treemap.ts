import type { Block } from '../../extract.js';
import {
  type AccDescrState,
  CONSUME_LINE,
  precedingIndent,
  scanAccDescr,
} from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * A treemap-beta row, shaped after Mermaid's own grammar:
 *
 * ```
 * Section: name=STRING2 (':::' classSelector=ID2)?
 * Leaf:    name=STRING2 (':' | ',') value=NUMBER2 (':::' classSelector=ID2)?
 * NUMBER2: [0-9_.,]+      ID2: [a-zA-Z_][a-zA-Z0-9_]*
 * ```
 *
 * Whether the row carries a value is the whole distinction between the two
 * productions, and three details of that half are each easy to miss — and a row
 * this misses is a row every treemap rule goes blind on. The separator may be a
 * comma (`"A", 30`) as well as a colon. A leaf's `:::class` follows its value
 * rather than preceding it, and `"A":::big: 5` really is a parse error. And a
 * value is a run of digits, `.`, `_`, and `,` rather than a plain number — see
 * {@link treemapValue}.
 *
 * The name has to be quoted (a bare `Root` is a parse error) in either style,
 * and carries no sign: a `-5` dies in the lexer before semantics run, which is
 * why `treemap-zero-value` covers only the zero half of what
 * `sankey-non-positive-value` covers.
 *
 * Captures [1]=double-quoted name, [2]=single-quoted name, [3]=raw value.
 */
const TREEMAP_ROW_RE =
  /^(?:"([^"]*)"|'([^']*)')(?:\s*[:,]\s*([\d_.,]+))?(?::{3}[a-zA-Z_]\w*)?\s*(?:%%.*)?$/;

/**
 * Read a raw treemap value the way Mermaid does: drop the digit-group commas,
 * then `parseFloat`, which stops at the first `_`. So `1,000` is 1000 while
 * `1_000` is 1, and `0.`, `0_0`, and `0,0` are all zero — forms
 * `treemap-zero-value` would otherwise miss.
 */
function treemapValue(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ''));
}

interface TreemapRow {
  /** The quoted name, which is what the box renders as. */
  name: string;
  /**
   * The value when the row carries one, `null` when it does not — which is
   * exactly Mermaid's `Leaf`/`Section` split. May be `NaN` for a value Mermaid
   * reads as one too, so test it for `0` rather than for finiteness.
   */
  value: number | null;
  /** 1-indexed body line. */
  line: number;
  /** Leading-whitespace width. Mermaid counts characters, so a tab is 1. */
  indent: number;
  /** Body line of the row this one nests under, or `null` at top level. */
  parentLine: number | null;
}

function isTreemap(block: Block): boolean {
  return block.type === 'treemap-beta';
}

/**
 * Scan a treemap-beta body into a flat row list with parent links.
 *
 * Nesting mirrors Mermaid's own `buildHierarchy`: a row's parent is the nearest
 * preceding row with a strictly smaller indent — but only value-less rows are
 * eligible. Mermaid types any row carrying a value as a `Leaf` and never
 * pushes it onto the parent stack, so rows indented under a valued row silently
 * re-parent to the section above it instead. `treemap-branch-with-value` is the
 * rule for that; reproducing the same stack here keeps every other rule's idea
 * of "sibling" matching what actually renders.
 *
 * An `accDescr { … }` block is prose and Mermaid reads no rows out of it, but
 * it ends at the first `}` and the rest of that line goes on lexing:
 * `accDescr { d } "A"` declares a row, indented by the gap after the brace
 * (probe, mermaid 11.15.0). So the scan resumes at an offset rather than
 * skipping the line, and takes the row's indent from that offset.
 */
function parseTreemapRows(lines: string[], headerLine: number): TreemapRow[] {
  const rows: TreemapRow[] = [];
  const stack: { indent: number; line: number }[] = [];
  const accDescr: AccDescrState = { open: false };

  for (let i = headerLine; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('%%')) continue;

    const verdict = scanAccDescr(accDescr, lines, i, true);
    if (verdict === CONSUME_LINE) continue;
    const scanFrom = verdict ?? 0;

    const rest = raw.slice(scanFrom);
    const trimmed = rest.trim();
    const match = TREEMAP_ROW_RE.exec(trimmed);
    if (match === null) continue;

    // Where the row token itself starts, so its indent is the run before it —
    // the line's own indent for an ordinary row, the gap after `}` for a tail.
    const start = scanFrom + (rest.length - rest.trimStart().length);
    const indent = precedingIndent(raw, start);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const line = i + 1;
    const value = match[3] === undefined ? null : treemapValue(match[3]);
    rows.push({
      name: match[1] ?? match[2],
      value,
      line,
      indent,
      parentLine: stack.length > 0 ? stack[stack.length - 1].line : null,
    });
    if (value === null) stack.push({ indent, line });
  }

  return rows;
}

export const treemapZeroValue: Rule = {
  id: 'treemap-zero-value',
  appliesTo: isTreemap,
  evaluate: ({ lines, headerLine }) =>
    parseTreemapRows(lines, headerLine)
      .filter((row) => row.value === 0)
      .map((row) => ({
        message: `treemap leaf "${row.name}" has a value of 0 and renders as an invisible (zero-area) rectangle.`,
        line: row.line,
      })),
};

export const treemapNoLeaves: Rule = {
  id: 'treemap-no-leaves',
  appliesTo: isTreemap,
  evaluate: ({ lines, headerLine }) => {
    const rows = parseTreemapRows(lines, headerLine);
    if (rows.some((row) => row.value !== null)) return [];
    return [
      {
        message:
          'treemap-beta has no row carrying a value and renders empty; every rectangle is sized from leaf values, so section rows alone draw nothing.',
        line: headerLine,
      },
    ];
  },
};

export const treemapDuplicateSibling: Rule = {
  id: 'treemap-duplicate-sibling',
  appliesTo: isTreemap,
  evaluate: ({ lines, headerLine, fileLine }) => {
    // key: `${parentLine}\0${name}` -> first line seen
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const row of parseTreemapRows(lines, headerLine)) {
      const key = `${row.parentLine ?? 'root'}\0${row.name}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, row.line);
        continue;
      }
      findings.push({
        message: `treemap node "${row.name}" duplicates a sibling (first on line ${fileLine(first)}); two identically labeled boxes render under the same parent.`,
        line: row.line,
      });
    }

    return findings;
  },
};

export const treemapBranchWithValue: Rule = {
  id: 'treemap-branch-with-value',
  appliesTo: isTreemap,
  evaluate: ({ lines, headerLine }) => {
    const rows = parseTreemapRows(lines, headerLine);
    const findings: RuleFinding[] = [];

    // Only the row immediately below could have been a child, since anything
    // further down is separated by a row at this depth or shallower.
    for (let i = 0; i + 1 < rows.length; i++) {
      const row = rows[i];
      if (row.value === null || rows[i + 1].indent <= row.indent) continue;
      findings.push({
        message: `treemap node "${row.name}" carries a value and has rows indented under it; Mermaid types any valued row as a leaf, so those rows attach to the enclosing section and render as its siblings rather than its children.`,
        line: row.line,
      });
    }

    return findings;
  },
};
