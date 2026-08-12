import type { Block } from '../../extract.js';
import { commaItemCount, parseCsvCells, stripHeaderColon } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

interface RadarAxis {
  /** What the spoke renders as: the explicit `["…"]` label, else the id. */
  label: string;
  line: number;
}

interface RadarCurve {
  /**
   * `true` for the `{axis: value}` form. Mermaid checks those itself — an
   * incomplete keyed curve is a parse error ("Missing entry for axis b") — so
   * the length rule skips them rather than double-reporting.
   */
  keyed: boolean;
  valueCount: number;
  line: number;
}

interface ParsedRadar {
  axes: RadarAxis[];
  curves: RadarCurve[];
}

const RADAR_AXIS_RE = /^axis\s+(.+)$/;
const RADAR_CURVE_RE = /^curve\b[^{]*\{(.*)\}\s*$/;
/** `m[Math]` — quotes are already stripped by {@link parseCsvCells}. */
const RADAR_AXIS_LABEL_RE = /^[^[\]]*\[(.*)\]$/;

function isRadar(block: Block): boolean {
  return stripHeaderColon(block.type) === 'radar-beta';
}

function radarAxisLabel(cell: string): string {
  const trimmed = cell.trim();
  return (RADAR_AXIS_LABEL_RE.exec(trimmed)?.[1] ?? trimmed).trim();
}

/**
 * Scan a radar-beta body for its axes and curves.
 *
 * Axes accumulate across every `axis` row rather than resetting per row —
 * `axis a, b` followed by `axis c, d` declares four spokes, so the count the
 * length rule compares against is the total.
 */
function parseRadar(lines: string[]): ParsedRadar {
  const parsed: ParsedRadar = { axes: [], curves: [] };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;

    const axis = RADAR_AXIS_RE.exec(trimmed);
    if (axis !== null) {
      for (const cell of parseCsvCells(axis[1]) ?? []) {
        parsed.axes.push({ label: radarAxisLabel(cell), line: i + 1 });
      }
      continue;
    }

    const curve = RADAR_CURVE_RE.exec(trimmed);
    if (curve === null) continue;
    parsed.curves.push({
      keyed: curve[1].includes(':'),
      valueCount: commaItemCount(curve[1]),
      line: i + 1,
    });
  }

  return parsed;
}

export const radarNoCurves: Rule = {
  id: 'radar-no-curves',
  appliesTo: isRadar,
  evaluate: ({ lines, headerLine }) => {
    if (parseRadar(lines).curves.length > 0) return [];
    return [
      {
        message:
          'radar-beta has no `curve` rows and renders an empty grid; add at least one `curve name{...}`.',
        line: headerLine,
      },
    ];
  },
};

export const radarCurveLengthMismatch: Rule = {
  id: 'radar-curve-length-mismatch',
  appliesTo: isRadar,
  evaluate: ({ lines }) => {
    const radar = parseRadar(lines);
    if (radar.axes.length === 0) return [];

    const findings: RuleFinding[] = [];
    for (const curve of radar.curves) {
      if (curve.keyed || curve.valueCount === radar.axes.length) continue;
      findings.push({
        message: `radar-beta curve has ${curve.valueCount} values but ${radar.axes.length} axes are declared; Mermaid renders a misaligned polygon rather than reporting an error.`,
        line: curve.line,
      });
    }
    return findings;
  },
};

export const radarDuplicateAxis: Rule = {
  id: 'radar-duplicate-axis',
  appliesTo: isRadar,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // label -> first line
    const findings: RuleFinding[] = [];
    for (const axis of parseRadar(lines).axes) {
      const firstLine = seen.get(axis.label);
      if (firstLine === undefined) {
        seen.set(axis.label, axis.line);
        continue;
      }
      // A single `axis` row declares many axes, so the duplicate is often on
      // the row being reported — naming that same line back would just be
      // noise. Only cite the first sighting when it is a different row.
      const origin =
        firstLine === axis.line
          ? ''
          : ` (first on line ${fileLine(firstLine)})`;
      findings.push({
        message: `radar-beta axis "${axis.label}" is declared more than once${origin}; duplicate spokes render identical labels and are usually a copy-paste mistake.`,
        line: axis.line,
      });
    }
    return findings;
  },
};
