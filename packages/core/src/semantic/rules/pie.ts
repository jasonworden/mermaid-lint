import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * A pie data row: `"label" : value`. Mermaid's pie grammar accepts both
 * double- and single-quoted labels and a signed number, so this matches either
 * quote style and an optional leading `-` (a negative value parses but renders
 * incorrectly; it is matched here so it still counts as a slice, but only the
 * zero case is flagged — see `pie-zero-value`). Captures [1]=double-quoted
 * label, [2]=single-quoted label, [3]=value.
 */
const PIE_SLICE_RE = /^\s*(?:"([^"]*)"|'([^']*)')\s*:\s*(-?\d+(?:\.\d+)?)\s*$/;

interface PieSlice {
  label: string;
  value: number;
  line: number;
}

function parsePieSlices(lines: string[]): PieSlice[] {
  const slices: PieSlice[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const m = PIE_SLICE_RE.exec(raw);
    if (m === null) continue;
    slices.push({ label: m[1] ?? m[2], value: Number(m[3]), line: i + 1 });
  }
  return slices;
}

function isPie(block: Block): boolean {
  return block.type === 'pie';
}

export const pieDuplicateLabel: Rule = {
  id: 'pie-duplicate-label',
  appliesTo: isPie,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // label -> first line
    const findings: RuleFinding[] = [];
    for (const slice of parsePieSlices(lines)) {
      const firstLine = seen.get(slice.label);
      if (firstLine === undefined) {
        seen.set(slice.label, slice.line);
      } else {
        findings.push({
          message: `pie slice "${slice.label}" is defined more than once (first on line ${fileLine(firstLine)}); duplicate labels render as separate slices and are usually a copy-paste mistake.`,
          line: slice.line,
        });
      }
    }
    return findings;
  },
};

export const pieZeroValue: Rule = {
  id: 'pie-zero-value',
  appliesTo: isPie,
  evaluate: ({ lines }) =>
    parsePieSlices(lines)
      .filter((slice) => slice.value === 0)
      .map((slice) => ({
        message: `pie slice "${slice.label}" has a value of 0 and renders as an invisible (zero-area) slice.`,
        line: slice.line,
      })),
};

export const pieNoData: Rule = {
  id: 'pie-no-data',
  appliesTo: isPie,
  evaluate: ({ lines, headerLine }) => {
    if (parsePieSlices(lines).length > 0) return [];
    return [
      {
        message:
          'pie chart has no data slices and renders empty; add at least one `"label" : value` row.',
        line: headerLine,
      },
    ];
  },
};
