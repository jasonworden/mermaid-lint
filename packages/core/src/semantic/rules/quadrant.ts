import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * A data-point line: `<label>: [x, y]`, with an optional `:::class` suffix on
 * the label and optional trailing styling (`radius:`/`color:`/…). Captures
 * [1]=label text (before any `:::class`). The `[` after the colon is what
 * distinguishes a point from `x-axis`/`y-axis`/`title`/`quadrant-N`/`classDef`
 * lines, none of which use bracketed coordinates. Coordinates outside `[0, 1]`
 * don't need matching here — Mermaid's grammar rejects them as a syntax error,
 * so the parser already catches them upstream.
 */
const QUADRANT_POINT_RE = /^(.+?)(?::::[\w-]+)?:\s*\[/;

/** A quadrant-region label: `quadrant-1` … `quadrant-4`. Captures [1]=N. */
const QUADRANT_REGION_RE = /^quadrant-([1-4])\b/;

const QUADRANT_X_AXIS_RE = /^x-axis\b/;
const QUADRANT_Y_AXIS_RE = /^y-axis\b/;

function isQuadrantChart(block: Block): boolean {
  return block.type === 'quadrantChart';
}

/** A non-blank, non-comment body line carries a point if the regex matches. */
function isQuadrantPointLine(trimmed: string): boolean {
  return !trimmed.startsWith('%%') && QUADRANT_POINT_RE.test(trimmed);
}

/**
 * Collect a keyed value from each matching line, keyed to the first body line
 * it appeared on, and flag any that recur. Shared by the duplicate-point and
 * duplicate-quadrant rules (comment lines are skipped).
 */
function findQuadrantDuplicates(
  lines: string[],
  re: RegExp,
  key: (m: RegExpExecArray) => string,
  describe: (value: string, first: number) => string,
): RuleFinding[] {
  const seen = new Map<string, number>();
  const findings: RuleFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('%%')) continue;
    const m = re.exec(trimmed);
    if (m === null) continue;
    const value = key(m);
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, i + 1);
    } else {
      findings.push({ message: describe(value, first), line: i + 1 });
    }
  }
  return findings;
}

export const quadrantDuplicatePoint: Rule = {
  id: 'quadrant-duplicate-point',
  appliesTo: isQuadrantChart,
  evaluate: ({ lines, fileLine }) =>
    findQuadrantDuplicates(
      lines,
      QUADRANT_POINT_RE,
      (m) => m[1].trim(),
      (value, first) =>
        `data point \`${value}\` is defined more than once (first on line ${fileLine(first)}); the points render overlapping, usually a copy-paste mistake.`,
    ),
};

export const quadrantNoPoints: Rule = {
  id: 'quadrant-no-points',
  appliesTo: isQuadrantChart,
  evaluate: ({ lines, headerLine }) => {
    if (lines.some((l) => isQuadrantPointLine(l.trim()))) return [];
    return [
      {
        message:
          'quadrantChart has no data points; it parses but renders an empty plot.',
        line: headerLine,
      },
    ];
  },
};

export const quadrantMissingXAxis: Rule = {
  id: 'quadrant-missing-x-axis',
  appliesTo: isQuadrantChart,
  evaluate: ({ lines, headerLine }) => {
    const hasPoint = lines.some((l) => isQuadrantPointLine(l.trim()));
    if (!hasPoint) return [];
    const hasAxis = lines.some((l) => QUADRANT_X_AXIS_RE.test(l.trim()));
    if (hasAxis) return [];
    return [
      {
        message:
          'quadrantChart has data points but no `x-axis` label; Mermaid renders default axis text, which hides the chart intent.',
        line: headerLine,
      },
    ];
  },
};

export const quadrantMissingYAxis: Rule = {
  id: 'quadrant-missing-y-axis',
  appliesTo: isQuadrantChart,
  evaluate: ({ lines, headerLine }) => {
    const hasPoint = lines.some((l) => isQuadrantPointLine(l.trim()));
    if (!hasPoint) return [];
    const hasAxis = lines.some((l) => QUADRANT_Y_AXIS_RE.test(l.trim()));
    if (hasAxis) return [];
    return [
      {
        message:
          'quadrantChart has data points but no `y-axis` label; Mermaid renders default axis text, which hides the chart intent.',
        line: headerLine,
      },
    ];
  },
};

export const quadrantDuplicateQuadrant: Rule = {
  id: 'quadrant-duplicate-quadrant',
  appliesTo: isQuadrantChart,
  evaluate: ({ lines, fileLine }) =>
    findQuadrantDuplicates(
      lines,
      QUADRANT_REGION_RE,
      (m) => m[1],
      (value, first) =>
        `quadrant-${value} is labeled more than once (first on line ${fileLine(first)}); Mermaid keeps only the last, silently dropping the earlier label.`,
    ),
};
