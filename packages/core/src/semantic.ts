import { extractEdges } from './edges.js';
import { type Block, bodyLineToFileLine } from './extract.js';
import { locateHeader } from './header.js';
import {
  type EmittedSeverity,
  RULE_DEFAULTS,
  type ResolvedRules,
  type RuleId,
} from './rules.js';
import { type SuppressionIndex, buildSuppressionIndex } from './suppress.js';

/**
 * A semantic finding raised by {@link checkSemantics} — a diagram that parses
 * but violates a higher-level rule. Distinct from a syntax error. Carries the
 * rule's resolved {@link EmittedSeverity}.
 *
 * @public
 */
export interface SemanticWarning {
  /** Stable rule id, e.g. `'duplicate-ids'`. */
  rule: RuleId;
  /**
   * Human-readable description of the finding. Any line number quoted in here
   * is a **file** line, unlike `line` below — message text is read beside a
   * `file:line` position, while `line` feeds suppression and the adapter's own
   * mapping. Map `line` with {@link bodyLineToFileLine} to compare the two.
   */
  message: string;
  /** 1-indexed line within the diagram body, when known. */
  line?: number;
  /** Resolved severity for this finding (`'warn'` or `'error'`). */
  severity: EmittedSeverity;
}

// ---------------------------------------------------------------------------
// Internal rule types
// ---------------------------------------------------------------------------

interface RuleContext {
  block: Block;
  lines: string[];
  /** 1-indexed body line of the diagram header (see `locateHeader`). */
  headerLine: number;
  /** Trimmed text of that header line, or `''` when there is none. */
  headerText: string;
  /**
   * Turn a body line into the file line to *name in a message*. Every rule
   * that writes "on line N" must route through this: a raw body line is a
   * different coordinate space from the `file:line` prefix the message is
   * printed behind, and inside a Markdown fence the two disagree (#137).
   *
   * `RuleFinding.line` deliberately stays body-relative — suppression indexes
   * body lines, and the adapter maps positions itself.
   */
  fileLine(bodyLine: number): number;
}

interface RuleFinding {
  message: string;
  line?: number;
}

interface Rule {
  id: RuleId;
  appliesTo(block: Block): boolean;
  evaluate(ctx: RuleContext): RuleFinding[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Covers the seven most common flowchart node shapes (most-specific first).
// Groups: [1]=id, then exactly one of [2]-[8] contains the label text.
// \w at the start allows numeric IDs (e.g. 1[Start]).
const NODE_DECL_RE =
  /\b(\w[\w-]*)(?:\[\[([^\]]*)\]\]|\(\(([^)]*)\)\)|\(\[([^\]]*)\]\)|\{\{([^}]*)\}\}|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/g;

// Mermaid flowchart direction tokens that may follow `flowchart`/`graph`.
const DIRECTION_RE = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/;

function extractLabel(m: RegExpExecArray): string {
  for (let i = 2; i < m.length; i++) {
    if (m[i] !== undefined) return m[i].trim();
  }
  return '';
}

function isFlowchartOrGraph(block: Block): boolean {
  return block.type === 'flowchart' || block.type === 'graph';
}

/**
 * Count of leading whitespace characters (each counts as one column). The
 * mindmap, treemap, kanban, and ishikawa hierarchies are all indentation-based, and
 * Mermaid measures their indent in characters — a tab counts as one, same as a
 * space.
 */
function indentWidth(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
}

function parseCsvCells(raw: string): string[] | null {
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

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * Mermaid only honors frontmatter that opens the body, so anything before it —
 * a `%%` comment or even a blank line — silently disables the block.
 *
 * `appliesTo` is a type check rather than a scan. Since #132 taught
 * `locateHeader` to skip a leading, terminated frontmatter block, a well-formed
 * frontmatter diagram types as its real keyword; `'---'` is left meaning
 * "frontmatter present but misplaced or unterminated" and nothing else.
 *
 * `headerLine === 1` is the unterminated case — nothing precedes the `---`, and
 * the parser already rejects it with "Diagrams beginning with --- are not
 * valid", so staying silent here avoids double-reporting the same body.
 *
 * Note that a `%% mermaid-lint-disable-next-line` above the frontmatter would
 * suppress this finding while itself being the content that breaks the render.
 * The escape hatch that actually works is a file-scope
 * `<!-- mermaid-lint-disable-file -->` directive, which lives outside the body.
 *
 * @see https://github.com/jasonworden/mermaid-lint/issues/123
 */
const frontmatterMustBeFirst: Rule = {
  id: 'frontmatter-must-be-first',
  appliesTo: (block) => block.type === '---',
  evaluate: ({ lines, headerLine }) => {
    // Nothing precedes the `---`: unterminated frontmatter, already a syntax
    // error. Reporting it here would say the same thing twice.
    if (headerLine === 1) return [];

    // The two remedies differ in kind, so they are worth distinguishing: a
    // comment should be moved (it carries information), blank lines deleted.
    const [cause, remedy] = lines
      .slice(0, headerLine - 1)
      .some((l) => l.trim().startsWith('%%'))
      ? [
          'a `%%` comment precedes it',
          'move the comment below the closing `---`',
        ]
      : ['a blank line precedes it', 'delete the blank lines above it'];

    return [
      {
        message: `YAML frontmatter must open the diagram, but ${cause}. Mermaid only strips frontmatter at the very start of a body, so this parses but fails to render — ${remedy}.`,
        line: headerLine,
      },
    ];
  },
};

const preferFlowchart: Rule = {
  id: 'prefer-flowchart',
  appliesTo: (block) => block.type === 'graph',
  evaluate: ({ headerLine }) => [
    {
      message:
        'use `flowchart` instead of `graph`: `graph` is legacy Mermaid syntax. `flowchart` is the current keyword and enables per-subgraph `direction` control.',
      line: headerLine,
    },
  ],
};

const requireDirection: Rule = {
  id: 'require-direction',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ block, headerLine, headerText }) => {
    if (DIRECTION_RE.test(headerText)) return [];
    return [
      {
        message: `\`${block.type}\` has no direction and defaults to \`TD\`. Prefer an explicit direction, e.g. \`${block.type} TD\`, to make layout intent clear.`,
        line: headerLine,
      },
    ];
  },
};

/**
 * Strip the trailing colon `radar-beta:` is allowed to carry. Radar is the only
 * diagram whose grammar accepts a colon after the keyword — `xychart-beta:` and
 * `treemap-beta:` are both parse errors — and `detectDiagramType` reports the
 * header verbatim, so the colon reaches `block.type`. Every `-beta` suffix test
 * goes through here so that form is not silently exempt from the beta rules.
 */
function stripHeaderColon(type: string): string {
  return type.endsWith(':') ? type.slice(0, -1) : type;
}

const noExperimental: Rule = {
  id: 'no-experimental',
  appliesTo: (block) => stripHeaderColon(block.type).endsWith('-beta'),
  evaluate: ({ block, headerLine }) => [
    {
      message: `\`${block.type}\` is an experimental Mermaid diagram type. Its syntax is unstable and may break on a Mermaid upgrade; prefer a stable diagram type where possible.`,
      line: headerLine,
    },
  ],
};

// ---------------------------------------------------------------------------
// Experimental diagram helpers and rules
// ---------------------------------------------------------------------------

interface XychartSeries {
  kind: 'line' | 'bar';
  length: number;
  line: number;
}

interface ParsedXychart {
  hasXAxis: boolean;
  xAxisLabelCount?: number;
  hasYAxis: boolean;
  series: XychartSeries[];
}

const XYCHART_X_AXIS_RE = /^\s*x-axis\b/;
const XYCHART_Y_AXIS_RE = /^\s*y-axis\b/;
const XYCHART_CATEGORICAL_X_AXIS_RE =
  /^\s*x-axis(?:\s+(?:"[^"]+"|[^\[\n]+?))?\s*\[(.*)\]\s*$/;
const XYCHART_SERIES_RE = /^\s*(line|bar)\s*\[(.*)\]\s*$/;

function isXychart(block: Block): boolean {
  return block.type === 'xychart-beta';
}

function commaItemCount(value: string): number {
  return parseCsvCells(value)?.length ?? 0;
}

function parseXychart(lines: string[]): ParsedXychart {
  const parsed: ParsedXychart = {
    hasXAxis: false,
    hasYAxis: false,
    series: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;

    if (XYCHART_X_AXIS_RE.test(trimmed)) {
      parsed.hasXAxis = true;
      const categorical = XYCHART_CATEGORICAL_X_AXIS_RE.exec(trimmed);
      if (categorical !== null) {
        parsed.xAxisLabelCount = commaItemCount(categorical[1]);
      }
      continue;
    }

    if (XYCHART_Y_AXIS_RE.test(trimmed)) {
      parsed.hasYAxis = true;
      continue;
    }

    const series = XYCHART_SERIES_RE.exec(trimmed);
    if (series === null) continue;
    parsed.series.push({
      kind: series[1] as XychartSeries['kind'],
      length: commaItemCount(series[2]),
      line: i + 1,
    });
  }

  return parsed;
}

const xychartMissingXAxis: Rule = {
  id: 'xychart-missing-x-axis',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0 || chart.hasXAxis) return [];
    return [
      {
        message:
          'xychart-beta has data series but no `x-axis`; add an explicit axis so the horizontal scale and labels are clear.',
        line: headerLine,
      },
    ];
  },
};

const xychartMissingYAxis: Rule = {
  id: 'xychart-missing-y-axis',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0 || chart.hasYAxis) return [];
    return [
      {
        message:
          'xychart-beta has data series but no `y-axis`; add an explicit axis so the vertical scale and units are clear.',
        line: headerLine,
      },
    ];
  },
};

const xychartNoSeries: Rule = {
  id: 'xychart-no-series',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    if (parseXychart(lines).series.length > 0) return [];
    return [
      {
        message:
          'xychart-beta has no data series and renders no data; add at least one `line [...]` or `bar [...]` series.',
        line: headerLine,
      },
    ];
  },
};

const xychartSeriesLengthMismatch: Rule = {
  id: 'xychart-series-length-mismatch',
  appliesTo: isXychart,
  evaluate: ({ lines, fileLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0) return [];

    const findings: RuleFinding[] = [];
    if (chart.xAxisLabelCount !== undefined) {
      for (const series of chart.series) {
        if (series.length === chart.xAxisLabelCount) continue;
        findings.push({
          message: `${series.kind} series has ${series.length} values but the categorical \`x-axis\` defines ${chart.xAxisLabelCount} labels; these lengths should match.`,
          line: series.line,
        });
      }
      return findings;
    }

    const [first, ...rest] = chart.series;
    for (const series of rest) {
      if (series.length === first.length) continue;
      findings.push({
        message: `${series.kind} series has ${series.length} values but the first series on line ${fileLine(first.line)} has ${first.length}; xychart-beta series should use the same length.`,
        line: series.line,
      });
    }
    return findings;
  },
};

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

const radarNoCurves: Rule = {
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

const radarCurveLengthMismatch: Rule = {
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

const radarDuplicateAxis: Rule = {
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

// ---------------------------------------------------------------------------
// Treemap helpers and rules
// ---------------------------------------------------------------------------

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

/** The opening line of a multi-line `accDescr { … }` block. */
const TREEMAP_ACC_DESCR_RE = /^accDescr\s*\{/;

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
 */
function parseTreemapRows(lines: string[], headerLine: number): TreemapRow[] {
  const rows: TreemapRow[] = [];
  const stack: { indent: number; line: number }[] = [];
  let inAccDescr = false;

  for (let i = headerLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;

    // An `accDescr { … }` block is prose. Mermaid does not read rows out of it,
    // so neither should we.
    if (inAccDescr) {
      if (trimmed.endsWith('}')) inAccDescr = false;
      continue;
    }
    if (TREEMAP_ACC_DESCR_RE.test(trimmed)) {
      inAccDescr = !trimmed.endsWith('}');
      continue;
    }

    const match = TREEMAP_ROW_RE.exec(trimmed);
    if (match === null) continue;

    const indent = indentWidth(lines[i]);
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

const treemapZeroValue: Rule = {
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

const treemapNoLeaves: Rule = {
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

const treemapDuplicateSibling: Rule = {
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

const treemapBranchWithValue: Rule = {
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

// ---------------------------------------------------------------------------
// Wardley map helpers and rules
// ---------------------------------------------------------------------------

interface WardleyDeclaration {
  /** Quote-stripped, as mermaid's `resolveNodeId` would see it. */
  name: string;
  line: number;
}

interface WardleyReference {
  name: string;
  line: number;
  /** Reads directly into the message, so it is phrased for a reader. */
  kind: 'link source' | 'link target' | 'evolve target';
}

interface WardleyCoordinate {
  value: number;
  line: number;
}

interface ParsedWardley {
  /** Top-level `component` rows — the only orphan candidates. */
  components: WardleyDeclaration[];
  /** `anchor` rows; they become nodes too, so they count against an empty map. */
  anchors: WardleyDeclaration[];
  /** Node ids exactly as `getNode` sees them — what an `evolve` must name. */
  nodeIds: Set<string>;
  /** Node ids plus the labels `resolveNodeId` falls back to — the link path. */
  resolvableNames: Set<string>;
  references: WardleyReference[];
  /** Names reached by a link, an `evolve`, or a pipeline. */
  referenced: Set<string>;
  /** Every value that reaches mermaid's `toPercent`. */
  coordinates: WardleyCoordinate[];
}

/** Mermaid's `WARDLEY_NUMBER`: a bare integer does not lex as a coordinate. */
const WARDLEY_NUMBER = String.raw`[0-9]+\.[0-9]+`;
/** Mermaid's `CoordinateValue`: annotations additionally accept a bare integer. */
const WARDLEY_COORD = String.raw`[0-9]+(?:\.[0-9]+)?`;

// Each coordinate pattern anchors on the *first* bracket group only. A
// component row may carry a trailing `label [10, -20]`, and `size [800, 600]`
// is a canvas dimension — neither passes through `toPercent`, so neither is a
// coordinate.
const WARDLEY_COMPONENT_RE = new RegExp(
  `^component\\s+(.+?)\\s*\\[\\s*(${WARDLEY_NUMBER})\\s*,\\s*(${WARDLEY_NUMBER})\\s*\\]`,
);
/** Inside a pipeline a component carries only its evolution. */
const WARDLEY_PIPELINE_MEMBER_RE = new RegExp(
  `^component\\s+(.+?)\\s*\\[\\s*(${WARDLEY_NUMBER})\\s*\\]`,
);
const WARDLEY_ANCHOR_RE = new RegExp(
  `^anchor\\s+(.+?)\\s*\\[\\s*(${WARDLEY_NUMBER})\\s*,\\s*(${WARDLEY_NUMBER})\\s*\\]`,
);
const WARDLEY_NOTE_RE = new RegExp(
  `^note\\s+(.+?)\\s*\\[\\s*(${WARDLEY_NUMBER})\\s*,\\s*(${WARDLEY_NUMBER})\\s*\\]`,
);
const WARDLEY_ACCELERATOR_RE = new RegExp(
  `^(?:de)?accelerator\\s+(.+?)\\s*\\[\\s*(${WARDLEY_NUMBER})\\s*,\\s*(${WARDLEY_NUMBER})\\s*\\]`,
);
const WARDLEY_ANNOTATIONS_RE = new RegExp(
  `^annotations\\s*\\[\\s*(${WARDLEY_COORD})\\s*,\\s*(${WARDLEY_COORD})\\s*\\]`,
);
/** The leading index is not a coordinate, so it is matched and discarded. */
const WARDLEY_ANNOTATION_RE = new RegExp(
  `^annotation\\s+[0-9]+\\s*,\\s*\\[\\s*(${WARDLEY_COORD})\\s*,\\s*(${WARDLEY_COORD})\\s*\\]`,
);
const WARDLEY_EVOLVE_RE = new RegExp(
  `^evolve\\s+(.+?)\\s+(${WARDLEY_NUMBER})\\s*$`,
);
const WARDLEY_PIPELINE_RE = /^pipeline\s+(.+?)\s*\{/;
/**
 * `ACC_DESCR`'s brace form spans newlines as a single lexer token, so every
 * line up to the matching `}` is opaque description text — never statements
 * — the same way a pipeline body is a different parsing context. Only the
 * brace form needs tracking; the colon form (`accDescr: text`) is one line
 * and already falls under `WARDLEY_KEYWORD_RE` below.
 */
const WARDLEY_ACC_DESCR_OPEN_RE = /^accDescr\s*\{/;
/**
 * The `\s*` between `accDescr` and its brace spans newlines, so the brace may
 * sit on a later line and the block still opens. Matching that needs a
 * lookahead from a bare `accDescr` row rather than a single-line pattern.
 */
const WARDLEY_ACC_DESCR_BARE_RE = /^accDescr$/;

// Any row opening with a keyword is a statement, never a link. This is what
// keeps `evolution Genesis -> Custom` from being read as a link to `Custom`.
const WARDLEY_KEYWORD_RE =
  /^(?:component|anchor|note|evolve|evolution|pipeline|accelerator|deaccelerator|annotations?|size|title|accTitle|accDescr)\b/;

// The three patterns below are sticky: they are only ever tried at positions
// `execOutsideWardleyString` has cleared as being outside a quoted name.
/** Mermaid's `SINGLE_LINE_COMMENT` opener. */
const WARDLEY_COMMENT_RE = /%%/y;
/**
 * Longest-first, so a dashed arrow never matches as `->` and `+'x'>` never as
 * `>`. Mermaid's `LINK_ARROW` admits exactly one or two leading dashes, so the
 * two are folded into `-{1,2}>` — greedy, hence still longest-first. Spelling
 * them as a quantifier rather than a literal also matches how `edges.ts` writes
 * flowchart arrows (`-{2,}>`), which keeps CodeQL's `js/bad-tag-filter` from
 * reading a Mermaid arrow as an HTML comment terminator.
 */
const WARDLEY_LINK_SEP_RE = /\+'[^']*'(?:<>|<|>)|-\.->|-{1,2}>|\+(?:<>|<|>)|>/y;
/** A `;`-prefixed link annotation runs to end of line. */
const WARDLEY_LINK_LABEL_RE = /;/y;
/** A port may trail the target: `A -> B+<`. */
const WARDLEY_TRAILING_PORT_RE = /\+(?:<>|<|>)$/;
/**
 * `fromPort` and `arrow` are independently optional in mermaid's grammar
 * (`from fromPort? arrow? to toPort?`), so `A+<> -> B` is valid: a bare
 * source port with its own arrow following. `WARDLEY_LINK_SEP_RE` finds the
 * *first* separator token, which is the port, leaving the arrow stuck to the
 * front of the target text. Only the `\+(?:<>|<|>)` alternative can match a
 * port rather than a full arrow, so whenever that happens the target text is
 * unconditionally checked for a leading arrow and it is stripped if found.
 * An ordinary `A -> B` never has one here — its separator already consumed
 * the arrow — so this never mis-fires on the common case.
 */
const WARDLEY_LEADING_ARROW_RE = /^\s*(?:-\.->|-{1,2}>|>)\s*/;

function isWardley(block: Block): boolean {
  return stripHeaderColon(block.type) === 'wardley-beta';
}

/**
 * Normalize a name the way mermaid's value converter does. `component "Cup of
 * Tea"` and a later bare `Cup of Tea -> Kettle` name the same node, so the
 * quotes have to come off before anything is compared.
 */
function wardleyName(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(trimmed);
  return (quoted?.[1] ?? quoted?.[2] ?? trimmed).trim();
}

/**
 * First match of a sticky pattern that begins outside a quoted name. Mermaid's
 * `STRING` terminal is `"([^"\\]|\\.)*"`, so it swallows `%%`, `;`, `>` and
 * every other structural character alike: inside quotes they are ordinary
 * text, and none of them can be located with a plain scan over the whole line.
 * Returns `null` when the pattern never matches outside a string.
 */
function execOutsideWardleyString(
  pattern: RegExp,
  raw: string,
): RegExpExecArray | null {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    // Tried before the quote opens, so a `+'label'>` arrow annotation matches
    // whole rather than being mistaken for the start of a quoted name.
    pattern.lastIndex = i;
    const match = pattern.exec(raw);
    if (match !== null) return match;
    if (ch === '"' || ch === "'") quote = ch;
  }
  return null;
}

/**
 * Strip a trailing `%% comment` — mermaid's `SINGLE_LINE_COMMENT` is a hidden
 * terminal that can start anywhere on a line, not just in the opening column.
 */
function stripWardleyComment(raw: string): string {
  const comment = execOutsideWardleyString(WARDLEY_COMMENT_RE, raw);
  return comment === null ? raw : raw.slice(0, comment.index);
}

function parseWardleyLink(
  trimmed: string,
): { from: string; to: string } | null {
  const label = execOutsideWardleyString(WARDLEY_LINK_LABEL_RE, trimmed);
  const body = label === null ? trimmed : trimmed.slice(0, label.index);
  const sep = execOutsideWardleyString(WARDLEY_LINK_SEP_RE, body);
  // `index === 0` means the row opens with an arrow and has no source.
  if (sep === null || sep.index === 0) return null;

  const from = wardleyName(body.slice(0, sep.index));
  const to = wardleyName(
    body
      .slice(sep.index + sep[0].length)
      .replace(WARDLEY_LEADING_ARROW_RE, '')
      .replace(WARDLEY_TRAILING_PORT_RE, ''),
  );
  if (from === '' || to === '') return null;
  return { from, to };
}

/**
 * Scan a wardley-beta body for its declarations, references, and coordinates.
 *
 * Pipeline blocks are tracked with a cursor because a `component` row means
 * something different inside one: a single evolution coordinate, and a node
 * whose id is synthetic (`parent_child`) while its label stays bare.
 */
export function parseWardley(lines: string[]): ParsedWardley {
  const parsed: ParsedWardley = {
    components: [],
    anchors: [],
    nodeIds: new Set(),
    resolvableNames: new Set(),
    references: [],
    referenced: new Set(),
    coordinates: [],
  };
  let pipelineParent: string | null = null;
  let inAccDescr = false;

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const trimmed = stripWardleyComment(lines[i]).trim();
    if (trimmed === '') continue;

    if (inAccDescr) {
      if (trimmed.includes('}')) inAccDescr = false;
      continue;
    }

    const accDescrOpen = WARDLEY_ACC_DESCR_OPEN_RE.exec(trimmed);
    if (accDescrOpen !== null) {
      // A same-line `accDescr { ... }` closes immediately; otherwise every
      // following line is interior text until the matching `}` shows up.
      const openIdx = trimmed.indexOf('{');
      if (trimmed.indexOf('}', openIdx) === -1) inAccDescr = true;
      continue;
    }

    if (WARDLEY_ACC_DESCR_BARE_RE.test(trimmed)) {
      // Only whitespace may separate the keyword from its brace, so anything
      // else on the next non-blank line means this row never lexed as an
      // `accDescr` at all and the following lines are ordinary statements.
      const next = lines.slice(i + 1).find((later) => later.trim() !== '');
      if (next?.trim().startsWith('{')) inAccDescr = true;
      continue;
    }

    if (pipelineParent !== null) {
      if (trimmed.startsWith('}')) {
        pipelineParent = null;
        continue;
      }
      const member = WARDLEY_PIPELINE_MEMBER_RE.exec(trimmed);
      if (member === null) continue;
      const name = wardleyName(member[1]);
      // A pipeline member is registered under the synthetic id alone, with the
      // bare name kept only as its label. Links run through `resolveNodeId`,
      // which falls back to a label scan, so both spellings reach it; an
      // `evolve` runs through the bare `getNode`, which does not, so only the
      // synthetic id resolves and `evolve <bare name>` is dropped in silence.
      parsed.resolvableNames.add(name);
      parsed.nodeIds.add(`${pipelineParent}_${name}`);
      parsed.resolvableNames.add(`${pipelineParent}_${name}`);
      // A pipeline member is structurally attached to its parent, never orphaned.
      parsed.referenced.add(name);
      parsed.coordinates.push({ value: Number(member[2]), line });
      continue;
    }

    const pipeline = WARDLEY_PIPELINE_RE.exec(trimmed);
    if (pipeline !== null) {
      pipelineParent = wardleyName(pipeline[1]);
      // Recorded as a reference for the orphan rule only. It is not pushed to
      // `references`: mermaid already rejects a pipeline whose parent does not
      // exist, so `wardley-undefined-component` would only double-report.
      parsed.referenced.add(pipelineParent);
      continue;
    }

    const component = WARDLEY_COMPONENT_RE.exec(trimmed);
    if (component !== null) {
      const name = wardleyName(component[1]);
      parsed.components.push({ name, line });
      parsed.nodeIds.add(name);
      parsed.resolvableNames.add(name);
      parsed.coordinates.push(
        { value: Number(component[2]), line },
        { value: Number(component[3]), line },
      );
      continue;
    }

    const anchor = WARDLEY_ANCHOR_RE.exec(trimmed);
    if (anchor !== null) {
      const name = wardleyName(anchor[1]);
      parsed.anchors.push({ name, line });
      parsed.nodeIds.add(name);
      parsed.resolvableNames.add(name);
      parsed.coordinates.push(
        { value: Number(anchor[2]), line },
        { value: Number(anchor[3]), line },
      );
      continue;
    }

    const evolve = WARDLEY_EVOLVE_RE.exec(trimmed);
    if (evolve !== null) {
      const name = wardleyName(evolve[1]);
      parsed.references.push({ name, line, kind: 'evolve target' });
      parsed.referenced.add(name);
      parsed.coordinates.push({ value: Number(evolve[2]), line });
      continue;
    }

    // Coordinate-only rows. The order between `annotations` and `annotation`
    // is arbitrary, not load-bearing: `WARDLEY_ANNOTATION_RE` requires a
    // digit right after the keyword, so it can never match `annotations`.
    // Both annotation forms run through `toCoordinates` like any other row, so
    // their bare integers are real coordinates and count toward the mixed
    // scale — `annotations [1, 4]` is one fraction and one percentage.
    const placed =
      WARDLEY_NOTE_RE.exec(trimmed) ??
      WARDLEY_ACCELERATOR_RE.exec(trimmed) ??
      WARDLEY_ANNOTATIONS_RE.exec(trimmed) ??
      WARDLEY_ANNOTATION_RE.exec(trimmed);
    if (placed !== null) {
      // The last two captures are the coordinate pair in every one of these.
      const pair = placed.slice(-2);
      for (const value of pair) {
        parsed.coordinates.push({ value: Number(value), line });
      }
      continue;
    }

    // A malformed statement row is skipped rather than misread as a link.
    if (WARDLEY_KEYWORD_RE.test(trimmed)) continue;

    const link = parseWardleyLink(trimmed);
    if (link === null) continue;
    parsed.references.push(
      { name: link.from, line, kind: 'link source' },
      { name: link.to, line, kind: 'link target' },
    );
    parsed.referenced.add(link.from);
    parsed.referenced.add(link.to);
  }

  return parsed;
}

const wardleyUndefinedComponent: Rule = {
  id: 'wardley-undefined-component',
  appliesTo: isWardley,
  evaluate: ({ lines }) => {
    const parsed = parseWardley(lines);
    const findings: RuleFinding[] = [];

    for (const ref of parsed.references) {
      const resolvable =
        ref.kind === 'evolve target' ? parsed.nodeIds : parsed.resolvableNames;
      if (resolvable.has(ref.name)) continue;
      const dropped = ref.kind === 'evolve target' ? 'evolution arrow' : 'link';
      findings.push({
        message: `wardley-beta ${ref.kind} \`${ref.name}\` is not a declared component or anchor; Mermaid drops the ${dropped} silently rather than reporting an error.`,
        line: ref.line,
      });
    }

    return findings;
  },
};

// Anchors are not candidates: a user-need marker with no dependency drawn from
// it is normal, so including them would fire on correct maps. Pipeline members
// are excluded too — `parseWardley` marks them referenced, since they are
// structurally attached to their parent.
const wardleyOrphanComponent: Rule = {
  id: 'wardley-orphan-component',
  appliesTo: isWardley,
  evaluate: ({ lines }) => {
    const parsed = parseWardley(lines);
    return parsed.components
      .filter((component) => !parsed.referenced.has(component.name))
      .map((component) => ({
        message: `wardley-beta component \`${component.name}\` is declared but never linked, evolved, or placed in a pipeline; it renders as an isolated dot with no relationship to the rest of the map.`,
        line: component.line,
      }));
  },
};

const wardleyNoComponents: Rule = {
  id: 'wardley-no-components',
  appliesTo: isWardley,
  evaluate: ({ lines, headerLine }) => {
    const parsed = parseWardley(lines);
    // Components and anchors are the only rows mermaid turns into nodes; a
    // pipeline cannot exist without a parent component, so this covers it too.
    if (parsed.components.length > 0 || parsed.anchors.length > 0) return [];
    return [
      {
        message:
          'wardley-beta declares no components or anchors and renders an empty map; add at least one `component name [visibility, evolution]`.',
        line: headerLine,
      },
    ];
  },
};

const wardleyMixedCoordinateScale: Rule = {
  id: 'wardley-mixed-coordinate-scale',
  appliesTo: isWardley,
  evaluate: ({ lines }) => {
    const { coordinates } = parseWardley(lines);
    const decimal = coordinates.filter((coord) => coord.value <= 1);
    const percentage = coordinates.filter((coord) => coord.value > 1);
    if (decimal.length === 0 || percentage.length === 0) return [];

    // Point at the minority spelling: those are the rows most likely to be the
    // mistake. A tie goes to the percentage form because 0-1 decimals are the
    // canonical Wardley notation and what Mermaid's own examples use.
    const [first] = percentage.length <= decimal.length ? percentage : decimal;
    const reading = first.value <= 1 ? 'a fraction' : 'a percentage';

    return [
      {
        message: `wardley-beta mixes coordinate notations — ${decimal.length} in 0-1 decimal form and ${percentage.length} in 0-100 percentage form; \`${first.value}\` here is read as ${reading}, so use one notation for the whole map.`,
        line: first.line,
      },
    ];
  },
};

// `component` and `anchor` share one namespace: both register through
// `addNode` under their bare name, and `WardleyBuilder.addNode` merges by id
// (`{...existing, ...node}`). So a repeated name collapses into one node with
// the last coordinates winning — and since components are processed after
// anchors, a component silently takes over an anchor of the same name.
// Pipeline members are excluded: their id is synthetic (`parent_child`), so a
// top-level `component Electric` and an `Electric` inside a pipeline really are
// two nodes.
const wardleyDuplicateComponent: Rule = {
  id: 'wardley-duplicate-component',
  appliesTo: isWardley,
  evaluate: ({ lines, fileLine }) => {
    const parsed = parseWardley(lines);
    const declarations = [...parsed.components, ...parsed.anchors].sort(
      (a, b) => a.line - b.line,
    );

    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const declaration of declarations) {
      const first = seen.get(declaration.name);
      if (first === undefined) {
        seen.set(declaration.name, declaration.line);
        continue;
      }
      findings.push({
        message: `wardley-beta component or anchor \`${declaration.name}\` is declared more than once (first on line ${fileLine(first)}); Mermaid merges them into one node and the last coordinates win.`,
        line: declaration.line,
      });
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// Event modeling helpers and rules
// ---------------------------------------------------------------------------

/**
 * The five model entity types, folded onto the short spelling. Four of them
 * have a long form as well (`command`, `event`, `readmodel`, `processor`) and
 * mermaid treats the two spellings as one type, so both are normalized here
 * and nothing downstream has to know a type has two names.
 */
type EventModelingEntityType = 'ui' | 'cmd' | 'evt' | 'rmo' | 'pcr';

interface EventModelingFrame {
  /**
   * Kept as written rather than as a number: mermaid resolves a `->>` source
   * by matching the name text, so `0` and `00` are two different frames.
   */
  id: string;
  /** `tf` or `rf`, normalized off the long forms. `rf` resets the timeline. */
  kind: 'tf' | 'rf';
  type: EventModelingEntityType;
  /** The entity identifier, possibly qualified (`Screen.Login`). */
  name: string;
  /** The line the frame keyword sits on — a frame may run past it. */
  line: number;
}

interface EventModelingReference {
  /** The frame id named after `->>`. */
  sourceId: string;
  /**
   * The line of the id itself, not of its arrow. The two can differ — `->>`
   * and its id may sit on separate lines — and the id is what a message names.
   */
  line: number;
  /** The referencing frame: its id, and the type the flow table keys on. */
  frameId: string;
  frameType: EventModelingEntityType;
}

interface ParsedEventModeling {
  frames: EventModelingFrame[];
  references: EventModelingReference[];
}

/** One lexeme plus the line it came from. */
interface EventModelingToken {
  text: string;
  line: number;
}

function isEventModeling(block: Block): boolean {
  return block.type === 'eventmodeling';
}

/** Frame openers, mapped onto the kind they declare. */
const EVENTMODELING_FRAME_KEYWORDS = new Map<string, 'tf' | 'rf'>([
  ['tf', 'tf'],
  ['timeframe', 'tf'],
  ['rf', 'rf'],
  ['resetframe', 'rf'],
]);

const EVENTMODELING_ENTITY_TYPES = new Map<string, EventModelingEntityType>([
  ['ui', 'ui'],
  ['cmd', 'cmd'],
  ['command', 'cmd'],
  ['evt', 'evt'],
  ['event', 'evt'],
  ['rmo', 'rmo'],
  ['readmodel', 'rmo'],
  ['pcr', 'pcr'],
  ['processor', 'pcr'],
]);

/** The source arrow. Compared as text, so no pattern is involved. */
const EVENTMODELING_ARROW = '->>';

/**
 * The three comment openers. `%%` and `//` run to end of line; the block form
 * is one lexer token that may span lines, so it needs its own closer.
 *
 * Sticky: it is only ever tried at positions `execOutsideEventModelingData` has
 * cleared as being outside an inline data payload.
 */
const EVENTMODELING_COMMENT_OPEN_RE = /%%|\/\/|\/\*/y;

/**
 * The delimiters of `EM_DATA_INLINE` — `/\{(.*)\}|"(.*)"|'(.*)'/`, the optional
 * payload that closes an `EmTimeFrame` or `EmResetFrame` — mapped to the closer
 * each one wants.
 */
const EVENTMODELING_DATA_CLOSERS = new Map([
  ['{', '}'],
  ['"', '"'],
  ["'", "'"],
]);

/**
 * Where each payload closer last appears on a line, keyed by the opener that
 * wants it.
 *
 * The closer that matters is the *last* one, not the first: every branch of
 * `EM_DATA_INLINE` closes on a greedy `.*`, so a payload runs to the final
 * closer and a second pair does not start a second payload.
 *
 * Hoisted to three `lastIndexOf` calls per line rather than being recomputed at
 * every scan position, which is what an earlier draft did. `lastIndexOf` does
 * not depend on where the scan has got to, and calling it per character made
 * both payload scans quadratic in line length: a line of unterminated `{` cost
 * ~9s at 200k characters, and the cost is paid twice per line, by the comment
 * stripper and by the tokenizer. Diagram bodies come from users, so that is the
 * same denial-of-service shape `parseFileDirectives` was fixed for. One pass per
 * line also restores the parallel to `execOutsideWardleyString`, which is a
 * single linear walk.
 */
function eventModelingDataEnds(raw: string): ReadonlyMap<string, number> {
  const ends = new Map<string, number>();
  for (const [opener, closer] of EVENTMODELING_DATA_CLOSERS) {
    ends.set(opener, raw.lastIndexOf(closer));
  }
  return ends;
}

/**
 * Index of the closer of the inline data payload opening at `raw[i]`, or `-1`
 * when no payload opens there. `ends` comes from `eventModelingDataEnds` for
 * this same line.
 *
 * A payload's contents are free text, so nothing inside one is code: not a
 * comment opener, and not a frame statement either. An earlier pass held that
 * no eventmodeling free text can carry frame tokens because `note` does not
 * parse. `note` indeed does not — but inline data does, and it is the carrier.
 * Do not re-derive the older conclusion from `note`.
 *
 * `EM_DATA_INLINE` cannot span a newline, so an opener with no closer after it
 * never lexed as a payload at all — for the quote forms that is the
 * unpaired-quote case, where the line's last closer is the opener itself.
 */
function eventModelingDataEnd(
  raw: string,
  i: number,
  ends: ReadonlyMap<string, number>,
): number {
  const close = ends.get(raw[i]);
  return close !== undefined && close > i ? close : -1;
}

/**
 * First comment opener that begins outside an inline data payload, or `null`
 * when every opener on the line sits inside one.
 *
 * Both failure directions were measured against mermaid 11.15.0, which accepts
 * each of them: a `/` `*` inside a payload silenced every frame below it, and a
 * payload pair opening and closing a phantom block comment across two rows made
 * the frame between them vanish and `eventmodeling-undefined-frame` fire at
 * severity `error` on a diagram mermaid draws correctly.
 *
 * This is the eventmodeling counterpart of `execOutsideWardleyString`, which
 * exists for the same class of bug: a `%%` inside a quoted name is syntax, not a
 * comment. Kept parallel rather than generalized because the run being skipped
 * is a different construct — a payload is also spelled with braces, and being a
 * single-line terminal it only counts as a payload when its closer is on the
 * same line, a rule that would be wrong for wardley's newline-free `STRING`.
 * Folding both into one helper would take more parameters than it saves lines.
 */
function execOutsideEventModelingData(raw: string): RegExpExecArray | null {
  const ends = eventModelingDataEnds(raw);
  for (let i = 0; i < raw.length; i++) {
    EVENTMODELING_COMMENT_OPEN_RE.lastIndex = i;
    const match = EVENTMODELING_COMMENT_OPEN_RE.exec(raw);
    if (match !== null) return match;

    const close = eventModelingDataEnd(raw, i, ends);
    // The loop's own step lands past the closer.
    if (close !== -1) i = close;
  }
  return null;
}

/**
 * Blank out every inline data payload on a line, one space per masked
 * character.
 *
 * Payload text is free text, so a frame statement written inside one is text:
 * `tf 1 ui A "tf 2 cmd B"` declares one frame and not two. Left tokenized, the
 * phantom `2` breaks both eventmodeling rules that read ids, in the same two
 * directions as an unmasked comment opener. It satisfies a `->> 2` that mermaid
 * itself drops, so `eventmodeling-undefined-frame` says nothing about a missing
 * arrow (a false negative on an `error` rule); and it collides with a real
 * frame `2` declared elsewhere, so `eventmodeling-duplicate-frame-id` reports a
 * duplicate on a body that has only one (a false positive).
 *
 * Spaces rather than a slice because cutting the span out would join the text
 * on either side of it into one token: mermaid lexes `Screen"a"Login` as two
 * identifiers, and a slice would hand the walk `ScreenLogin`. Every token after
 * a payload therefore keeps its column as well as its line.
 *
 * Expects a line the comment stripper has already run over: a delimiter written
 * inside a comment would otherwise pair with a real one and mask live code
 * between them.
 */
function maskEventModelingData(raw: string): string {
  const ends = eventModelingDataEnds(raw);
  let masked = '';
  for (let i = 0; i < raw.length; i++) {
    const close = eventModelingDataEnd(raw, i, ends);
    if (close === -1) {
      masked += raw[i];
      continue;
    }
    masked += ' '.repeat(close - i + 1);
    i = close;
  }
  return masked;
}

/**
 * One match per token. Anything else in a body — braces, quotes, the `[[ ]]`
 * of a data reference — is passed over by the scan, which is all a frame walk
 * needs: nothing between two frames can change how either one reads. That holds
 * only because the delimiters are stripped of their *contents* first, by
 * `maskEventModelingData`; run over a raw line this pattern happily reads a
 * frame statement out of a data payload.
 *
 * Whitespace is not a token boundary in mermaid's lexer, so `Screen->>2` is
 * three tokens and the arrow is matched first to keep it out of the name. Its
 * dash sits in a character class rather than being written bare: CodeQL's
 * `js/bad-tag-filter` reads a literal dash-arrow inside a pattern as an HTML
 * comment terminator (the same reason `WARDLEY_LINK_SEP_RE` spells its arrows
 * as quantifiers).
 */
const EVENTMODELING_TOKEN_RE = /[-]>>|[A-Za-z_][\w.]*|[0-9]+/g;

/** A frame id is a bare integer; `0` is a valid one. */
const EVENTMODELING_ID_RE = /^[0-9]+$/;

/**
 * `accDescr`'s brace form is a single terminal spanning newlines, so every
 * line up to the matching `}` is description text and never a statement.
 */
const EVENTMODELING_ACC_DESCR_OPEN_RE = /^accDescr\s*\{/;
/** The brace may sit on a later line, which only a lookahead can see. */
const EVENTMODELING_ACC_DESCR_BARE_RE = /^accDescr$/;
/**
 * Metadata rows are whole-line terminals, so their text never reaches the
 * token stream. None of the three parsed in any form tried against mermaid
 * 11.15 — this is a defensive skip, not a supported path.
 *
 * The keyword is closed with a lookahead over the identifier alphabet rather
 * than with `\b`, which would end the word at the `.` of a qualified name and
 * so swallow a continuation line reading `title.Bar` as metadata.
 */
const EVENTMODELING_META_RE = /^(?:title|accTitle|accDescr)(?![\w.])/;

/**
 * Blank out the comments in a body, one output entry per input line so the
 * line numbers a token reports stay true.
 *
 * All three forms are hidden terminals, so a comment may open anywhere a token
 * boundary can — mid-statement included, which is why openers are found with
 * `execOutsideEventModelingData` rather than a plain scan. The block form is
 * the reason this is a whole-body pass rather than a per-line strip: it closes
 * on a later line, so the state has to carry across the loop.
 *
 * The pass starts at the header because mermaid removes frontmatter before its
 * lexer ever runs, so a `/*` in a YAML title is title text and must not open a
 * block comment that blanks the diagram below it. The header line itself is
 * lexer input, so it is scanned rather than skipped. Preceding lines are
 * blanked instead of sliced away to keep every token's reported line true.
 */
function stripEventModelingComments(
  lines: string[],
  headerLine: number,
): string[] {
  const stripped: string[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < headerLine) {
      stripped.push('');
      continue;
    }

    let rest = lines[i];
    let kept = '';

    while (rest !== '') {
      if (inBlockComment) {
        const close = rest.indexOf('*/');
        if (close === -1) break;
        inBlockComment = false;
        rest = rest.slice(close + 2);
        continue;
      }

      const open = execOutsideEventModelingData(rest);
      if (open === null) {
        kept += rest;
        break;
      }
      kept += rest.slice(0, open.index);
      // `%%` and `//` swallow the rest of the line; only the block form can
      // hand code back after it closes.
      if (open[0] !== '/*') break;
      inBlockComment = true;
      rest = rest.slice(open.index + 2);
    }

    stripped.push(kept);
  }

  return stripped;
}

/**
 * Flatten a comment-stripped body into `{ text, line }` records.
 *
 * A statement spans lines arbitrarily — `tf 1` / `ui` / `Screen` on three
 * separate lines parses, and so does a bare `->> 1` — because mermaid's `EM_WS`
 * is a hidden terminal that swallows a newline like any other whitespace. A
 * line-oriented scan cannot see those statements at all, so the body becomes
 * one stream and each token carries only the line it was written on.
 */
function tokenizeEventModeling(lines: string[]): EventModelingToken[] {
  const tokens: EventModelingToken[] = [];
  let inAccDescr = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;

    if (inAccDescr) {
      if (trimmed.includes('}')) inAccDescr = false;
      continue;
    }

    if (EVENTMODELING_ACC_DESCR_OPEN_RE.test(trimmed)) {
      // A same-line `accDescr { ... }` closes immediately; otherwise the block
      // runs until the matching `}` shows up.
      const openIdx = trimmed.indexOf('{');
      if (trimmed.indexOf('}', openIdx) === -1) inAccDescr = true;
      continue;
    }

    if (EVENTMODELING_ACC_DESCR_BARE_RE.test(trimmed)) {
      // Only whitespace may separate the keyword from its brace, so anything
      // else on the next non-blank line means this row never lexed as an
      // `accDescr` and the lines after it are ordinary statements.
      const next = lines.slice(i + 1).find((later) => later.trim() !== '');
      if (next?.trim().startsWith('{')) inAccDescr = true;
      continue;
    }

    if (EVENTMODELING_META_RE.test(trimmed)) continue;

    // Masked here rather than in `stripEventModelingComments` because the
    // `accDescr` gates above read braces of their own, and a description block's
    // opening `{` is not an inline payload.
    for (const match of maskEventModelingData(trimmed).matchAll(
      EVENTMODELING_TOKEN_RE,
    )) {
      tokens.push({ text: match[0], line: i + 1 });
    }
  }

  return tokens;
}

/**
 * Walk an eventmodeling body for its frame declarations and `->>` references.
 *
 * The walk is over tokens rather than lines because a frame statement is not a
 * line: see `tokenizeEventModeling`. On a frame keyword the head reads as
 * `<id> <type> <name>`, then zero or more `->> <id>` pairs — multi-source is
 * repeated arrows, since both the comma- and space-separated spellings are
 * parse errors.
 *
 * `headerLine` is the 1-indexed body line of the header (see `locateHeader`);
 * the walk ignores everything above it, which is frontmatter mermaid strips
 * before lexing. Lines keep their body numbering regardless.
 */
export function parseEventModeling(
  lines: string[],
  headerLine: number,
): ParsedEventModeling {
  const parsed: ParsedEventModeling = { frames: [], references: [] };
  const tokens = tokenizeEventModeling(
    stripEventModelingComments(lines, headerLine),
  );

  for (let i = 0; i < tokens.length; i++) {
    const kind = EVENTMODELING_FRAME_KEYWORDS.get(tokens[i].text);
    if (kind === undefined) continue;
    if (i + 3 >= tokens.length) continue;

    // All three head parts are mandatory, so a frame missing any of them never
    // parsed and belongs to the syntax linter, not here. The cursor is left on
    // the keyword rather than skipped past the malformed run — the very next
    // token may open a frame that does read.
    const id = tokens[i + 1];
    const type = EVENTMODELING_ENTITY_TYPES.get(tokens[i + 2].text);
    const name = tokens[i + 3];
    if (!EVENTMODELING_ID_RE.test(id.text)) continue;
    if (type === undefined) continue;
    // An arrow, an id, or a frame keyword in the name slot means the head ran
    // short and the token belongs to whatever comes next. A frame keyword
    // especially: mermaid's lexer hands it to the parser as a keyword and not
    // as an identifier, so `tf 2 ui` followed by `tf 3 ui Good` never named an
    // entity `tf` — it is one broken frame and one good one.
    if (
      name.text === EVENTMODELING_ARROW ||
      EVENTMODELING_ID_RE.test(name.text) ||
      EVENTMODELING_FRAME_KEYWORDS.has(name.text)
    )
      continue;

    parsed.frames.push({
      id: id.text,
      kind,
      type,
      name: name.text,
      line: tokens[i].line,
    });

    let cursor = i + 4;
    while (
      cursor + 1 < tokens.length &&
      tokens[cursor].text === EVENTMODELING_ARROW &&
      EVENTMODELING_ID_RE.test(tokens[cursor + 1].text)
    ) {
      parsed.references.push({
        sourceId: tokens[cursor + 1].text,
        line: tokens[cursor + 1].line,
        frameId: id.text,
        frameType: type,
      });
      cursor += 2;
    }
    // `cursor` is the first token past this frame; the loop's own step lands on
    // it, so a frame is never re-read as part of the one that follows.
    i = cursor - 1;
  }

  return parsed;
}

/**
 * Which source types a frame of each type may draw from, transcribed from
 * mermaid's own `EventModelingValidator`. That validator ships but never runs:
 * `parse` skips validation entirely, so every flow below is enforced here or
 * nowhere. `cmd` is the only target with two legal sources.
 *
 * A `Record` rather than a `Map` because the key is a closed union — every type
 * has an entry and `tsc` says so, which spares the lookup an unreachable
 * `undefined` branch.
 */
const EVENTMODELING_ALLOWED_SOURCES: Record<
  EventModelingEntityType,
  readonly EventModelingEntityType[]
> = {
  cmd: ['ui', 'pcr'],
  evt: ['cmd'],
  rmo: ['evt'],
  pcr: ['rmo'],
  ui: ['rmo'],
};

/**
 * How a type is named in a message. Four of the five have a long spelling too
 * and `parseEventModeling` folds both onto the short one, so a message echoing
 * only what it parsed would read as though it were correcting an author who
 * wrote `command`. Naming both spellings keeps the message about the type
 * rather than about the token.
 */
const EVENTMODELING_TYPE_LABELS: Record<EventModelingEntityType, string> = {
  ui: 'ui',
  cmd: 'cmd/command',
  evt: 'evt/event',
  rmo: 'rmo/readmodel',
  pcr: 'pcr/processor',
};

const eventmodelingUndefinedFrame: Rule = {
  id: 'eventmodeling-undefined-frame',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine }) => {
    const { frames, references } = parseEventModeling(lines, headerLine);
    const declared = new Set(frames.map((frame) => frame.id));

    return references
      .filter((ref) => !declared.has(ref.sourceId))
      .map((ref) => ({
        message: `eventmodeling frame \`${ref.frameId}\` names \`${ref.sourceId}\` as a source but no frame declares that id; Mermaid drops the relation silently rather than reporting an error, so the arrow never renders.`,
        line: ref.line,
      }));
  },
};

// `tf` and `rf` declare into one shared id namespace — `tf 1` followed by
// `rf 1` parses — so a mixed pair collides just as two `tf`s would, and the
// rule keys on the id alone rather than on the id and kind together.
//
// Mermaid neither drops the second declaration nor picks one to resolve
// against: it renders every frame with the id, and dispatches one relation per
// frame whose name matches a `->>`. So `tf 1 ui A` / `tf 1 ui B` / `tf 2 cmd C
// ->> 1` draws two boxes and two arrows where one of each was meant (render
// probe, mermaid 11.15.0: two relation `<path>`s against one for the
// distinct-id control).
const eventmodelingDuplicateFrameId: Rule = {
  id: 'eventmodeling-duplicate-frame-id',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const { frames } = parseEventModeling(lines, headerLine);
    // `parseEventModeling` walks the body front to back, so the frames arrive
    // in source order and the first one seen for an id is the first declared.
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const frame of frames) {
      const first = seen.get(frame.id);
      if (first === undefined) {
        seen.set(frame.id, frame.line);
        continue;
      }
      findings.push({
        message: `eventmodeling frame id \`${frame.id}\` is declared by more than one \`tf\` or \`rf\` frame (first on line ${fileLine(first)}); Mermaid renders them all and matches a later \`->> ${frame.id}\` against every one of them, drawing a duplicate arrow per matching frame instead of the single one intended.`,
        line: frame.line,
      });
    }

    return findings;
  },
};

// A `->>` resolves against *every* frame carrying the id, not against one of
// them, so the flow check runs over all of them: mermaid dispatches one
// relation per matching frame, and a first-wins check would miss a violation
// that is genuinely drawn. `tf 1 ui A` / `tf 1 evt B` / `tf 2 cmd C ->> 1`
// draws two relations, and the second is the illegal `cmd` ← `evt` one.
//
// The finding is still one per reference rather than one per matching frame:
// the author wrote a single arrow, and three findings for it would be noise.
//
// Nothing here claims the bad relation renders. An `rf` frame's `->>` draws no
// relation at all — `decidePositionRelation` bails on a reset frame, measured
// as zero relation `<path>`s against one for the same diagram with `tf` — yet
// the rule fires on `rf` all the same, because mermaid registers this check for
// `EmResetFrame` too. What every case does share is that the check never runs,
// so that is all the message asserts.
const eventmodelingInvalidFlow: Rule = {
  id: 'eventmodeling-invalid-flow',
  appliesTo: isEventModeling,
  evaluate: ({ lines, headerLine }) => {
    const { frames, references } = parseEventModeling(lines, headerLine);

    const framesById = new Map<string, EventModelingFrame[]>();
    for (const frame of frames) {
      const group = framesById.get(frame.id);
      if (group === undefined) framesById.set(frame.id, [frame]);
      else group.push(frame);
    }

    const findings: RuleFinding[] = [];

    for (const ref of references) {
      const matches = framesById.get(ref.sourceId);
      // An undeclared source is `eventmodeling-undefined-frame`'s finding, and
      // there is no type to judge the flow against anyway.
      if (matches === undefined) continue;

      const allowed = EVENTMODELING_ALLOWED_SOURCES[ref.frameType];
      // Distinct types only, in declaration order: two illegal frames of the
      // same type are one thing to say, not two.
      const illegal = [
        ...new Set(
          matches
            .map((frame) => frame.type)
            .filter((type) => !allowed.includes(type)),
        ),
      ];
      if (illegal.length === 0) continue;

      const target = EVENTMODELING_TYPE_LABELS[ref.frameType];
      const sources = illegal
        .map((type) => EVENTMODELING_TYPE_LABELS[type])
        .join(' and ');
      const legal = allowed
        .map((type) => EVENTMODELING_TYPE_LABELS[type])
        .join(' or ');
      // Only the illegal types are named above, so a duplicated id needs the
      // extra sentence to explain why a legal frame of the same id does not
      // make the finding wrong.
      const ambiguity =
        matches.length > 1
          ? ` Frame id \`${ref.sourceId}\` is declared more than once and Mermaid matches all of them, so this source is reached regardless of the others.`
          : '';

      findings.push({
        message: `eventmodeling frame \`${ref.frameId}\` (${target}) is sourced from frame \`${ref.sourceId}\` (${sources}), but ${target} may only be sourced from ${legal}; Mermaid ships a validator that forbids this flow, but never runs it, so nothing reports it.${ambiguity}`,
        line: ref.line,
      });
    }

    return findings;
  },
};

interface SankeyLink {
  source: string;
  target: string;
  value: number;
  line: number;
}

function isSankey(block: Block): boolean {
  return block.type === 'sankey-beta';
}

function parseSankeyLinks(lines: string[]): SankeyLink[] {
  const links: SankeyLink[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;
    const parts = parseCsvCells(raw);
    if (parts === null || parts.length !== 3) continue;

    const source = parts[0].trim();
    const target = parts[1].trim();
    const value = Number(parts[2].trim());
    if (source === '' || target === '' || !Number.isFinite(value)) continue;

    links.push({ source, target, value, line: i + 1 });
  }
  return links;
}

const sankeyNonPositiveValue: Rule = {
  id: 'sankey-non-positive-value',
  appliesTo: isSankey,
  evaluate: ({ lines }) =>
    parseSankeyLinks(lines)
      .filter((link) => link.value <= 0)
      .map((link) => ({
        message: `sankey link \`${link.source}\` → \`${link.target}\` has a non-positive value (${link.value}); sankey flows should be greater than 0.`,
        line: link.line,
      })),
};

const sankeyDuplicateLink: Rule = {
  id: 'sankey-duplicate-link',
  appliesTo: isSankey,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const link of parseSankeyLinks(lines)) {
      const key = `${link.source}\u0000${link.target}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, link.line);
        continue;
      }
      findings.push({
        message: `sankey link \`${link.source} -> ${link.target}\` is declared more than once (first on line ${fileLine(first)}); repeated source/target rows are usually copy-paste duplicates.`,
        line: link.line,
      });
    }

    return findings;
  },
};

const sankeySelfLoop: Rule = {
  id: 'sankey-self-loop',
  appliesTo: isSankey,
  evaluate: ({ lines }) =>
    parseSankeyLinks(lines)
      .filter((link) => link.source === link.target)
      .map((link) => ({
        message: `sankey link \`${link.source}\` → \`${link.target}\` is a self-loop, which is usually unintentional.`,
        line: link.line,
      })),
};

const BLOCK_DECL_RE = /^\s*[A-Za-z_][\w-]*(?:\s*\[[^\]]*])?(?::\d+)?\s*$/;
const PACKET_FIELD_RE =
  /^\s*(\+?\d+(?:\s*-\s*\d+)?)\s*:\s*(?:"([^"]*)"|'([^']*)')\s*(?:%%.*)?$/;

interface PacketField {
  range: string;
  label: string;
  line: number;
}

function isPacket(block: Block): boolean {
  return block.type === 'packet-beta';
}

function collectPacketFields(lines: string[]): PacketField[] {
  const fields: PacketField[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const field = PACKET_FIELD_RE.exec(raw);
    if (field === null) continue;
    fields.push({
      range: field[1].replace(/\s+/g, ''),
      label: field[2] ?? field[3] ?? '',
      line: i + 1,
    });
  }
  return fields;
}

const blockNoBlocks: Rule = {
  id: 'block-no-blocks',
  appliesTo: (block) => block.type === 'block-beta',
  evaluate: ({ lines, headerLine }) => {
    if (
      lines.some((line) => {
        const trimmed = line.trim();
        return trimmed !== 'block-beta' && BLOCK_DECL_RE.test(trimmed);
      })
    ) {
      return [];
    }
    return [
      {
        message:
          'block-beta has no blocks and renders empty; add at least one block declaration.',
        line: headerLine,
      },
    ];
  },
};

const packetNoFields: Rule = {
  id: 'packet-no-fields',
  appliesTo: isPacket,
  evaluate: ({ lines, headerLine }) => {
    if (collectPacketFields(lines).length > 0) return [];
    return [
      {
        message:
          'packet-beta has no field rows (no fields); it parses but renders as an empty packet.',
        line: headerLine,
      },
    ];
  },
};

const packetEmptyLabels: Rule = {
  id: 'packet-empty-labels',
  appliesTo: isPacket,
  evaluate: ({ lines }) =>
    collectPacketFields(lines)
      .filter((field) => field.label.trim() === '')
      .map((field) => ({
        message: `packet field \`${field.range}\` has an empty label and will render as a blank field.`,
        line: field.line,
      })),
};

const duplicateIds: Rule = {
  id: 'duplicate-ids',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, { label: string; line: number }>();
    const findings: RuleFinding[] = [];

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
          findings.push({
            message: `node "${id}" declared with label "${prior.label}" (line ${fileLine(prior.line)}) and "${label}" (line ${fileLine(bodyLine)})`,
            line: bodyLine,
          });
        }
      }
    }

    return findings;
  },
};

const noDuplicateNodeDeclarations: Rule = {
  id: 'no-duplicate-node-declarations',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, { label: string; line: number }>();
    const findings: RuleFinding[] = [];

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
        } else if (prior.label === label) {
          findings.push({
            message: `node \`${id}\` is declared with the same label more than once (first on line ${fileLine(prior.line)}); duplicate declarations are usually copy-paste noise.`,
            line: bodyLine,
          });
        }
      }
    }

    return findings;
  },
};

const noDuplicateEdges: Rule = {
  id: 'no-duplicate-edges',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const edges = extractEdges(lines);
    const seen = new Map<string, number>(); // key -> firstLine
    const findings: RuleFinding[] = [];

    for (const e of edges) {
      const key = `${e.source} ${e.target} ${e.label ?? ''}`;
      const firstLine = seen.get(key);
      if (firstLine === undefined) {
        seen.set(key, e.line);
      } else {
        findings.push({
          message: `duplicate edge: \`${e.source}\` → \`${e.target}\` is defined more than once (first on line ${fileLine(firstLine)}); duplicate edges render stacked and are usually a copy-paste mistake.`,
          line: e.line,
        });
      }
    }

    return findings;
  },
};

const noSelfLoop: Rule = {
  id: 'no-self-loop',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const edges = extractEdges(lines);
    const findings: RuleFinding[] = [];

    for (const e of edges) {
      if (e.source === e.target) {
        findings.push({
          message: `node \`${e.source}\` has an edge to itself (self-loop), which is almost always unintentional.`,
          line: e.line,
        });
      }
    }

    return findings;
  },
};

const noEmptyLabels: Rule = {
  id: 'no-empty-labels',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        const label = extractLabel(m);
        if (label === '') {
          findings.push({
            message: `node \`${id}\` has an empty label and will render as a blank shape.`,
            line: lineIdx + 1,
          });
        }
      }
    }

    return findings;
  },
};

// Known blind spot: a node used only via subgraph membership (not connected by
// any explicit edge) will appear as an orphan here even though it is not truly
// isolated in the rendered output. This is why `no-orphan-nodes` defaults to
// `off` — users must explicitly opt in.
const noOrphanNodes: Rule = {
  id: 'no-orphan-nodes',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const edges = extractEdges(lines);
    const referenced = new Set<string>();
    for (const e of edges) {
      referenced.add(e.source);
      referenced.add(e.target);
    }

    // Track first declaration line per id
    const declared = new Map<string, number>(); // id -> first declaration line
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        if (!declared.has(id)) {
          declared.set(id, lineIdx + 1);
        }
      }
    }

    // Emit findings for declared nodes that are never referenced in an edge,
    // sorted by first declaration line.
    const orphans = [...declared.entries()]
      .filter(([id]) => !referenced.has(id))
      .sort(([, a], [, b]) => a - b);

    return orphans.map(([id, line]) => ({
      message: `node \`${id}\` is declared but never connected by an edge; it will not appear in most rendered layouts.`,
      line,
    }));
  },
};

// ---------------------------------------------------------------------------
// Requirement diagram helpers and rules
// ---------------------------------------------------------------------------

interface RequirementDefinition {
  kind: 'requirement' | 'element';
  line: number;
  name: string;
}

interface RequirementRelationship {
  endpoints: [string, string];
  line: number;
}

interface ParsedRequirementDiagram {
  definitions: RequirementDefinition[];
  ids: Array<{ line: number; value: string }>;
  relationships: RequirementRelationship[];
}

const REQUIREMENT_OPEN_RE = /^\s*(requirement|element)\s+(.+?)\s*\{\s*$/;
const REQUIREMENT_ID_RE = /^\s*id\s*:\s*(.+?)\s*$/;

function normalizeRequirementName(raw: string): string {
  const withoutClass = raw.replace(/\s*:::[A-Za-z0-9_-]+\s*$/, '').trim();
  if (
    withoutClass.startsWith('"') &&
    withoutClass.endsWith('"') &&
    withoutClass.length >= 2
  ) {
    return withoutClass.slice(1, -1).trim();
  }
  return withoutClass;
}

function parseRequirementRelationship(
  line: string,
): RequirementRelationship['endpoints'] | null {
  const trimmed = line.trim();

  const forwardArrow = trimmed.lastIndexOf('->');
  if (forwardArrow !== -1) {
    const left = trimmed.slice(0, forwardArrow).trim();
    const right = trimmed.slice(forwardArrow + 2).trim();
    const relationStart = left.lastIndexOf(' - ');
    if (relationStart === -1) return null;

    const source = normalizeRequirementName(left.slice(0, relationStart));
    const relation = left.slice(relationStart + 3).trim();
    const target = normalizeRequirementName(right);
    if (source !== '' && relation !== '' && target !== '') {
      return [source, target];
    }
    return null;
  }

  const reverseArrow = trimmed.indexOf('<-');
  if (reverseArrow !== -1) {
    const left = trimmed.slice(0, reverseArrow).trim();
    const right = trimmed.slice(reverseArrow + 2).trim();
    const relationEnd = right.indexOf(' - ');
    if (relationEnd === -1) return null;

    const source = normalizeRequirementName(left);
    const relation = right.slice(0, relationEnd).trim();
    const target = normalizeRequirementName(right.slice(relationEnd + 3));
    if (source !== '' && relation !== '' && target !== '') {
      return [source, target];
    }
  }

  return null;
}

function parseRequirementDiagram(lines: string[]): ParsedRequirementDiagram {
  const definitions: RequirementDefinition[] = [];
  const ids: ParsedRequirementDiagram['ids'] = [];
  const relationships: RequirementRelationship[] = [];
  let openBlock: RequirementDefinition['kind'] | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const bodyLine = lineIdx + 1;
    if (line.trimStart().startsWith('%%')) continue;

    const opening = REQUIREMENT_OPEN_RE.exec(line);
    if (opening !== null) {
      const kind = opening[1] as RequirementDefinition['kind'];
      const name = normalizeRequirementName(opening[2]);
      definitions.push({ kind, line: bodyLine, name });
      openBlock = kind;
      continue;
    }

    if (openBlock === 'requirement') {
      const id = REQUIREMENT_ID_RE.exec(line);
      if (id !== null) {
        ids.push({ line: bodyLine, value: id[1].trim() });
      }
    }

    if (line.trim() === '}') {
      openBlock = null;
      continue;
    }

    const relationship = parseRequirementRelationship(line);
    if (relationship !== null) {
      relationships.push({ endpoints: relationship, line: bodyLine });
    }
  }

  return { definitions, ids, relationships };
}

const requirementDuplicateName: Rule = {
  id: 'requirement-duplicate-name',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines, fileLine }) => {
    const parsed = parseRequirementDiagram(lines);
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const definition of parsed.definitions) {
      const firstLine = seen.get(definition.name);
      if (firstLine === undefined) {
        seen.set(definition.name, definition.line);
        continue;
      }

      findings.push({
        message: `requirement/element name \`${definition.name}\` is declared more than once (first on line ${fileLine(firstLine)}); relationship and style targets become ambiguous.`,
        line: definition.line,
      });
    }

    return findings;
  },
};

const requirementDuplicateId: Rule = {
  id: 'requirement-duplicate-id',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines, fileLine }) => {
    const parsed = parseRequirementDiagram(lines);
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const id of parsed.ids) {
      const firstLine = seen.get(id.value);
      if (firstLine === undefined) {
        seen.set(id.value, id.line);
        continue;
      }

      findings.push({
        message: `requirement id \`${id.value}\` is declared more than once (first on line ${fileLine(firstLine)}); duplicate ids make requirement references ambiguous.`,
        line: id.line,
      });
    }

    return findings;
  },
};

const requirementUndefinedReference: Rule = {
  id: 'requirement-undefined-reference',
  appliesTo: (block) => block.type === 'requirementDiagram',
  evaluate: ({ lines }) => {
    const parsed = parseRequirementDiagram(lines);
    const definedNames = new Set(
      parsed.definitions.map((definition) => definition.name),
    );
    const findings: RuleFinding[] = [];

    for (const relationship of parsed.relationships) {
      for (const endpoint of relationship.endpoints) {
        if (!definedNames.has(endpoint)) {
          findings.push({
            message: `relationship endpoint \`${endpoint}\` does not match any defined requirement or element name.`,
            line: relationship.line,
          });
        }
      }
    }

    return findings;
  },
};

// Sequence & class diagram helpers and rules
// ---------------------------------------------------------------------------

/**
 * Sequence message regex. Captures:
 *   [1] SRC participant token
 *   [2] arrow (->  -->  ->>  -->>  -x  --x  -)  --))
 *   [3] optional '+' or '-' activation shorthand
 *   [4] TGT participant token
 * Participant tokens are word characters only; the colon+text after TGT is
 * intentionally not captured (not needed).
 */
const SEQ_MSG_RE =
  /^\s*([A-Za-z0-9_]+)\s*(->>?|-->>?|-x|--x|-\)|--\))\s*([+-])?\s*([A-Za-z0-9_]+)\s*:/;

/** Explicit `activate X` / `deactivate X` line (possibly indented). */
const SEQ_ACTIVATE_RE = /^\s*(activate|deactivate)\s+([A-Za-z0-9_]+)\s*$/;

/** Participant / actor declaration: `participant X` or `participant X as Alias`. */
const SEQ_PARTICIPANT_RE =
  /^\s*(?:participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+\S+)?\s*$/;

const noActivateWithoutDeactivate: Rule = {
  id: 'no-activate-without-deactivate',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines }) => {
    // count[participant] = current activation depth
    const count = new Map<string, number>();
    // firstOpenLine[participant] = line index (1-based) of earliest still-open activation
    const firstOpenLine = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      // Explicit activate / deactivate keyword
      const explicit = SEQ_ACTIVATE_RE.exec(raw);
      if (explicit !== null) {
        const keyword = explicit[1];
        const participant = explicit[2];
        if (keyword === 'activate') {
          const prev = count.get(participant) ?? 0;
          count.set(participant, prev + 1);
          if (prev === 0) firstOpenLine.set(participant, bodyLine);
        } else {
          // deactivate
          const prev = count.get(participant) ?? 0;
          if (prev <= 0) {
            findings.push({
              message: `\`deactivate\` for \`${participant}\` has no matching \`activate\`.`,
              line: bodyLine,
            });
            count.set(participant, 0);
          } else {
            count.set(participant, prev - 1);
            if (prev - 1 === 0) firstOpenLine.delete(participant);
          }
        }
        continue;
      }

      // Shorthand +/- on message arrow
      const msg = SEQ_MSG_RE.exec(raw);
      if (msg !== null) {
        const src = msg[1];
        const suffix = msg[3]; // '+' | '-' | undefined
        const tgt = msg[4];

        if (suffix === '+') {
          // activate TGT
          const prev = count.get(tgt) ?? 0;
          count.set(tgt, prev + 1);
          if (prev === 0) firstOpenLine.set(tgt, bodyLine);
        } else if (suffix === '-') {
          // deactivate SRC
          const prev = count.get(src) ?? 0;
          if (prev <= 0) {
            findings.push({
              message: `\`deactivate\` for \`${src}\` has no matching \`activate\`.`,
              line: bodyLine,
            });
            count.set(src, 0);
          } else {
            count.set(src, prev - 1);
            if (prev - 1 === 0) firstOpenLine.delete(src);
          }
        }
      }
    }

    // Any participant with count > 0 is dangling
    for (const [participant, depth] of count) {
      if (depth > 0) {
        findings.push({
          message: `participant \`${participant}\` is activated but never deactivated (dangling activation bar).`,
          line: firstOpenLine.get(participant),
        });
      }
    }

    return findings;
  },
};

const preferExplicitParticipants: Rule = {
  id: 'prefer-explicit-participants',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines }) => {
    const declared = new Set<string>(); // declared ids seen so far
    const reported = new Set<string>(); // ids already emitted a finding for
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      // Check for participant/actor declaration first
      const decl = SEQ_PARTICIPANT_RE.exec(raw);
      if (decl !== null) {
        declared.add(decl[1]);
        continue;
      }

      // Check for message reference
      const msg = SEQ_MSG_RE.exec(raw);
      if (msg !== null) {
        const src = msg[1];
        const tgt = msg[4];
        for (const id of [src, tgt]) {
          if (!declared.has(id) && !reported.has(id)) {
            reported.add(id);
            findings.push({
              message: `participant \`${id}\` is used in a message before being declared; Mermaid auto-creates it. Declare it with \`participant ${id}\` for explicit ordering.`,
              line: bodyLine,
            });
          }
        }
      }
    }

    return findings;
  },
};

const sequenceDuplicateParticipant: Rule = {
  id: 'sequence-duplicate-participant',
  appliesTo: (block) => block.type === 'sequenceDiagram',
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = SEQ_PARTICIPANT_RE.exec(raw);
      if (decl === null) continue;
      const id = decl[1];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, i + 1);
      } else {
        findings.push({
          message: `participant \`${id}\` is declared more than once (first on line ${fileLine(first)}); duplicate declarations make participant ordering and labels ambiguous.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

/**
 * Class member syntax supported:
 *   Block:  `class Foo {` … member lines … `}`
 *   Inline: `Foo : +int bar()` or `Foo : bar()`
 * A method is any member line containing `(...)`. The signature key is
 * `name(params)` with internal whitespace collapsed.
 */
const CLASS_OPEN_RE = /^\s*class\s+([A-Za-z_]\w*)\s*\{/;
const CLASS_CLOSE_RE = /^\s*\}/;
const CLASS_INLINE_RE = /^\s*([A-Za-z_]\w*)\s*:/;
const CLASS_DECL_RE = /^\s*class\s+([A-Za-z_]\w*)\b/;
const METHOD_RE = /([A-Za-z_]\w*)\s*\(([^)]*)\)/;

const classDuplicateClass: Rule = {
  id: 'class-duplicate-class',
  appliesTo: (block) => block.type === 'classDiagram',
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = CLASS_DECL_RE.exec(raw);
      if (decl === null) continue;
      const name = decl[1];
      const first = seen.get(name);
      if (first === undefined) {
        seen.set(name, i + 1);
      } else {
        findings.push({
          message: `class \`${name}\` is declared more than once (first on line ${fileLine(first)}); Mermaid merges class declarations, which is usually a copy-paste mistake.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

const noDuplicateMethods: Rule = {
  id: 'no-duplicate-methods',
  appliesTo: (block) => block.type === 'classDiagram',
  evaluate: ({ lines, fileLine }) => {
    // methods[className][signature] = first bodyLine
    const methods = new Map<string, Map<string, number>>();
    const findings: RuleFinding[] = [];
    let currentClass: string | null = null;

    const getClassMap = (cls: string): Map<string, number> => {
      let m = methods.get(cls);
      if (m === undefined) {
        m = new Map();
        methods.set(cls, m);
      }
      return m;
    };

    const checkMember = (cls: string, memberLine: string, bodyLine: number) => {
      const mMethod = METHOD_RE.exec(memberLine);
      if (mMethod === null) return; // attribute, not a method
      const name = mMethod[1];
      const params = mMethod[2].trim().replace(/\s+/g, ' ');
      const key = `${name}(${params})`;
      const classMap = getClassMap(cls);
      const firstLine = classMap.get(key);
      if (firstLine === undefined) {
        classMap.set(key, bodyLine);
      } else {
        findings.push({
          message: `method \`${key}\` is declared more than once on class \`${cls}\` (first on line ${fileLine(firstLine)}).`,
          line: bodyLine,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const bodyLine = i + 1;
      if (raw.trimStart().startsWith('%%')) continue;

      if (currentClass !== null) {
        // Inside a class block
        if (CLASS_CLOSE_RE.test(raw)) {
          currentClass = null;
        } else {
          checkMember(currentClass, raw.trim(), bodyLine);
        }
        continue;
      }

      // Check for block opening
      const open = CLASS_OPEN_RE.exec(raw);
      if (open !== null) {
        currentClass = open[1];
        continue;
      }

      // Check for inline member: `Foo : member`
      const inline = CLASS_INLINE_RE.exec(raw);
      if (inline !== null) {
        const cls = inline[1];
        // Member is everything after the first `:`
        const colonIdx = raw.indexOf(':');
        if (colonIdx !== -1) {
          const member = raw.slice(colonIdx + 1).trim();
          checkMember(cls, member, bodyLine);
        }
      }
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// Pie chart helpers and rules
// ---------------------------------------------------------------------------

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

const pieDuplicateLabel: Rule = {
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

const pieZeroValue: Rule = {
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

const pieNoData: Rule = {
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

// ---------------------------------------------------------------------------
// State diagram helpers and rules
// ---------------------------------------------------------------------------

/**
 * A state-diagram transition: `src --> tgt` with an optional `: label`. Both
 * endpoints may be the `[*]` start/end pseudostate or a plain state id. State
 * diagrams only ever use the `-->` arrow, so a line containing it is
 * unambiguously a transition — declarations (`state X { `, `state "d" as Y`),
 * `direction`, and `note` lines never match. Captures [1]=source, [2]=target,
 * [3]=label (the text after `:`, trimmed; `undefined` when absent).
 */
const STATE_TRANSITION_RE =
  /^\s*(\[\*\]|[A-Za-z0-9_]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_]+)\s*(?::\s*(.*\S))?\s*$/;

/**
 * Opening line of a composite state: `state Foo {` (optionally `state "desc" as
 * Foo {`). The brace must end the line — the inline single-line form is not a
 * composite. Captures [1]=quoted-or-bare name, [2]=`as` alias (when present).
 */
const STATE_COMPOSITE_OPEN_RE =
  /^\s*state\s+("[^"]*"|[A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*\{\s*$/;

/** A lone closing brace for a composite state block. */
const STATE_COMPOSITE_CLOSE_RE = /^\s*\}\s*$/;

/** Explicit state declaration: `state Foo` or `state "Description" as Foo`. */
const STATE_DECL_RE =
  /^\s*state\s+(?:"[^"]*"\s+as\s+)?([A-Za-z0-9_]+)(?:\s*(?:\{|$))/;

interface StateTransition {
  source: string;
  target: string;
  label: string;
  line: number;
}

function parseStateTransitions(lines: string[]): StateTransition[] {
  const transitions: StateTransition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const m = STATE_TRANSITION_RE.exec(raw);
    if (m === null) continue;
    transitions.push({
      source: m[1],
      target: m[2],
      label: m[3] ?? '',
      line: i + 1,
    });
  }
  return transitions;
}

function isState(block: Block): boolean {
  return block.type === 'stateDiagram' || block.type === 'stateDiagram-v2';
}

const stateDuplicateState: Rule = {
  id: 'state-duplicate-state',
  appliesTo: isState,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const decl = STATE_DECL_RE.exec(raw);
      if (decl === null) continue;
      const id = decl[1];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, i + 1);
      } else {
        findings.push({
          message: `state \`${id}\` is declared more than once (first on line ${fileLine(first)}); duplicate state declarations make labels and composite bodies ambiguous.`,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};

const stateDuplicateTransition: Rule = {
  id: 'state-duplicate-transition',
  appliesTo: isState,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // key -> first line
    const findings: RuleFinding[] = [];
    for (const t of parseStateTransitions(lines)) {
      const key = `${t.source} ${t.target} ${t.label}`;
      const firstLine = seen.get(key);
      if (firstLine === undefined) {
        seen.set(key, t.line);
      } else {
        findings.push({
          message: `duplicate transition: \`${t.source}\` → \`${t.target}\` is defined more than once (first on line ${fileLine(firstLine)}); duplicate transitions render stacked and are usually a copy-paste mistake.`,
          line: t.line,
        });
      }
    }
    return findings;
  },
};

// A composite state with no body renders as an empty container box. Brace depth
// is tracked with a stack so nested composites are handled; a nested composite
// counts as content for its parent.
const stateEmptyComposite: Rule = {
  id: 'state-empty-composite',
  appliesTo: isState,
  evaluate: ({ lines }) => {
    interface Frame {
      name: string;
      line: number;
      hasContent: boolean;
    }
    const stack: Frame[] = [];
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;

      const open = STATE_COMPOSITE_OPEN_RE.exec(raw);
      if (open !== null) {
        // The composite itself is content for any enclosing composite.
        if (stack.length > 0) stack[stack.length - 1].hasContent = true;
        const name = (open[2] ?? open[1]).replace(/^"|"$/g, '');
        stack.push({ name, line: i + 1, hasContent: false });
        continue;
      }

      if (STATE_COMPOSITE_CLOSE_RE.test(raw)) {
        const frame = stack.pop();
        if (frame !== undefined && !frame.hasContent) {
          findings.push({
            message: `composite state \`${frame.name}\` has an empty body and renders as an empty box; add its substates or remove the braces.`,
            line: frame.line,
          });
        }
        continue;
      }

      // Any other non-blank line is body content for the innermost composite.
      if (raw.trim().length > 0 && stack.length > 0) {
        stack[stack.length - 1].hasContent = true;
      }
    }

    return findings;
  },
};

const stateSelfTransition: Rule = {
  id: 'state-self-transition',
  appliesTo: isState,
  evaluate: ({ lines }) =>
    parseStateTransitions(lines)
      .filter((t) => t.source === t.target && t.source !== '[*]')
      .map((t) => ({
        message: `state \`${t.source}\` has a transition to itself (\`${t.source} --> ${t.source}\`); self-transitions are valid in state machines but are sometimes unintentional.`,
        line: t.line,
      })),
};

// ---------------------------------------------------------------------------
// Entity-relationship (ER) diagram helpers and rules
// ---------------------------------------------------------------------------

/**
 * An ER relationship line: `LEFT <cardinality> RIGHT : label`. The cardinality
 * is two "outer" symbols (`|`, `}`, `o`) + the identifying/non-identifying line
 * (`--` or `..`) + two "inner" symbols (`|`, `{`, `o`) — e.g. `||--o{`,
 * `}o..o{`. Entity names are bare tokens (alphanumerics, `_`, `-`) or quoted.
 * The trailing `:` label is required by Mermaid, so this never matches a
 * declaration. Captures [1]=left entity, [2]=right entity.
 */
const ER_RELATIONSHIP_RE =
  /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s+[|}o]{2}(?:--|\.\.)[o|{]{2}\s+("[^"]*"|[A-Za-z0-9_-]+)\s*:/;

/**
 * The prose-cardinality relationship form Mermaid also accepts, e.g.
 * `CUSTOMER one to zero or more ORDER : places` (equivalent to `||--o{`). The
 * `to` keyword separates the two cardinality phrases; `[^:]*` keeps the match
 * on the relationship's own line and anchors to the first `:` (the label).
 * Captures [1]=left entity, [2]=right entity.
 */
const ER_PROSE_RELATIONSHIP_RE =
  /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s+[^:]*\bto\b[^:]*\s+("[^"]*"|[A-Za-z0-9_-]+)\s*:/;

/**
 * Opening line of an entity attribute block: `ENTITY {` (brace ends the line).
 * The single-line form (`ENTITY { string name }`) and the v11 alias-bracket
 * form (`ENTITY["Display"] { … }`) are intentionally not matched — they are
 * uncommon and only cause missed detections (never false positives).
 */
const ER_BLOCK_OPEN_RE = /^\s*("[^"]*"|[A-Za-z0-9_-]+)\s*\{\s*$/;

/** A lone closing brace for an entity block. */
const ER_BLOCK_CLOSE_RE = /^\s*\}\s*$/;

/**
 * An attribute line inside an entity block: `type name [keys] [comment]`. The
 * second token is the attribute name (the first is its type). Names may contain
 * hyphens (`string first-name`), matching the entity-name charset.
 */
const ER_ATTRIBUTE_RE = /^\s*\S+\s+([A-Za-z0-9_-]+)/;

/** A relationship endpoint pair, or `null` when the line is not a relationship. */
function parseErRelationship(
  line: string,
): { left: string; right: string } | null {
  const m =
    ER_RELATIONSHIP_RE.exec(line) ?? ER_PROSE_RELATIONSHIP_RE.exec(line);
  if (m === null) return null;
  return { left: unquoteEntity(m[1]), right: unquoteEntity(m[2]) };
}

/** Strip surrounding double-quotes from a quoted entity name. */
function unquoteEntity(token: string): string {
  return token.replace(/^"|"$/g, '');
}

function isEr(block: Block): boolean {
  return block.type === 'erDiagram';
}

const erDuplicateAttribute: Rule = {
  id: 'er-duplicate-attribute',
  appliesTo: isEr,
  evaluate: ({ lines, fileLine }) => {
    const findings: RuleFinding[] = [];
    let entity: string | null = null;
    let attrs = new Map<string, number>(); // attribute name -> first line
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;

      if (entity === null) {
        const open = ER_BLOCK_OPEN_RE.exec(raw);
        if (open !== null) {
          entity = unquoteEntity(open[1]);
          attrs = new Map();
        }
        continue;
      }

      // Inside an entity block (ER entities don't nest).
      if (ER_BLOCK_CLOSE_RE.test(raw)) {
        entity = null;
        continue;
      }
      const attr = ER_ATTRIBUTE_RE.exec(raw);
      if (attr === null) continue;
      const name = attr[1];
      const first = attrs.get(name);
      if (first === undefined) {
        attrs.set(name, i + 1);
      } else {
        findings.push({
          message: `attribute \`${name}\` is declared more than once on entity \`${entity}\` (first on line ${fileLine(first)}).`,
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

const erDuplicateEntity: Rule = {
  id: 'er-duplicate-entity',
  appliesTo: isEr,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // entity -> first block-open line
    const findings: RuleFinding[] = [];
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      if (inBlock) {
        if (ER_BLOCK_CLOSE_RE.test(raw)) inBlock = false;
        continue;
      }
      const open = ER_BLOCK_OPEN_RE.exec(raw);
      if (open === null) continue;
      inBlock = true;
      const entity = unquoteEntity(open[1]);
      const first = seen.get(entity);
      if (first === undefined) {
        seen.set(entity, i + 1);
      } else {
        findings.push({
          message: `entity \`${entity}\` has its attribute block defined more than once (first on line ${fileLine(first)}); Mermaid merges them, so this is usually a copy-paste mistake.`,
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

// Mirror of `no-orphan-nodes` for ER: an entity with a defined attribute block
// that never appears in a relationship renders as an isolated box. Off by
// default (opt-in) — a lone reference table is sometimes intentional.
const erStandaloneEntity: Rule = {
  id: 'er-standalone-entity',
  appliesTo: isEr,
  evaluate: ({ lines }) => {
    const related = new Set<string>();
    const blocks = new Map<string, number>(); // entity -> first block-open line
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      if (inBlock) {
        if (ER_BLOCK_CLOSE_RE.test(raw)) inBlock = false;
        continue;
      }
      const rel = parseErRelationship(raw);
      if (rel !== null) {
        related.add(rel.left);
        related.add(rel.right);
        continue;
      }
      const open = ER_BLOCK_OPEN_RE.exec(raw);
      if (open !== null) {
        inBlock = true;
        const entity = unquoteEntity(open[1]);
        if (!blocks.has(entity)) blocks.set(entity, i + 1);
      }
    }
    return [...blocks.entries()]
      .filter(([entity]) => !related.has(entity))
      .sort(([, a], [, b]) => a - b)
      .map(([entity, line]) => ({
        message: `entity \`${entity}\` has a defined attribute block but no relationship; it renders as an isolated box.`,
        line,
      }));
  },
};

// Gantt chart helpers and rules
// ---------------------------------------------------------------------------

/**
 * Lines that open a gantt directive rather than declare a task. A task is
 * `name : metadata`; these keywords never are — even when their own text
 * contains a colon (e.g. `title Project: Phase 1`, or a `click t1 call cb(a:b)`
 * interaction) — so they are filtered out before the task-line check, which
 * keys only on the presence of a `:`.
 */
const GANTT_KEYWORD_RE =
  /^(?:gantt|title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|section|click)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const GANTT_SECTION_RE = /^section\s+(.+?)\s*$/;

/**
 * Status tags that may precede a task's positional metadata fields. Mermaid
 * extracts these first, so they don't count toward the [id?, start, end]
 * positions. (`vert` is the newer vertical-marker tag.)
 */
const GANTT_TAGS = new Set(['active', 'done', 'crit', 'milestone', 'vert']);

/** A task field that references other tasks: `after <ids>` or `until <ids>`. */
const GANTT_DEP_RE = /^(?:after|until)\s+(.+)$/;

interface GanttTask {
  /** Explicit task id, or `null` when Mermaid auto-generates one. */
  id: string | null;
  /** Ids referenced via `after`/`until`. */
  deps: string[];
  /** 1-indexed body line of the task. */
  line: number;
}

/**
 * Parse a task's metadata (everything after the first `:`). Mirrors Mermaid's
 * positional grammar: the status tags are extracted first, then the remaining
 * comma fields are positionally `[id?, start, end]`. Mermaid only reads an
 * explicit id when three positional fields are present (otherwise the id is
 * auto-generated and invisible here); an `after <id>` / `until <id>` field (in
 * the start/end slots) references other tasks, and may name several
 * space-separated ids. The id slot is only taken from a plain token, never an
 * `after`/`until` phrase, so a 3-field `id, after x, 5d` task still yields id.
 */
function parseGanttMeta(data: string): { id: string | null; deps: string[] } {
  const fields = data
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const positional = fields.filter((f) => !GANTT_TAGS.has(f));

  const deps: string[] = [];
  for (const field of positional) {
    const m = GANTT_DEP_RE.exec(field);
    if (m === null) continue;
    for (const ref of m[1].split(/\s+/)) {
      if (ref.length > 0) deps.push(ref);
    }
  }

  let id: string | null = null;
  if (positional.length >= 3 && /^[A-Za-z0-9_-]+$/.test(positional[0])) {
    id = positional[0];
  }
  return { id, deps };
}

/** True when a trimmed line declares a task (`name : metadata`). */
function isGanttTaskLine(trimmed: string): boolean {
  if (GANTT_KEYWORD_RE.test(trimmed)) return false;
  const colon = trimmed.indexOf(':');
  if (colon === -1) return false;
  return trimmed.slice(0, colon).trim().length > 0;
}

function parseGanttTasks(lines: string[]): GanttTask[] {
  const tasks: GanttTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (!isGanttTaskLine(trimmed)) continue;
    const meta = parseGanttMeta(trimmed.slice(trimmed.indexOf(':') + 1));
    tasks.push({ id: meta.id, deps: meta.deps, line: i + 1 });
  }
  return tasks;
}

function isGantt(block: Block): boolean {
  return block.type === 'gantt';
}

const ganttDuplicateTaskId: Rule = {
  id: 'gantt-duplicate-task-id',
  appliesTo: isGantt,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>(); // id -> first line
    const findings: RuleFinding[] = [];
    for (const task of parseGanttTasks(lines)) {
      if (task.id === null) continue;
      const first = seen.get(task.id);
      if (first === undefined) {
        seen.set(task.id, task.line);
      } else {
        findings.push({
          message: `task id \`${task.id}\` is defined more than once (first on line ${fileLine(first)}); \`after\`/\`until\` references to it are ambiguous.`,
          line: task.line,
        });
      }
    }
    return findings;
  },
};

// Collect every defined id first (a two-pass over the block), so a task that
// references a dependency declared later in the chart is not flagged — only
// references to ids that no task defines anywhere.
const ganttUndefinedDependency: Rule = {
  id: 'gantt-undefined-dependency',
  appliesTo: isGantt,
  evaluate: ({ lines }) => {
    const tasks = parseGanttTasks(lines);
    const defined = new Set<string>();
    for (const t of tasks) {
      if (t.id !== null) defined.add(t.id);
    }
    const findings: RuleFinding[] = [];
    for (const t of tasks) {
      for (const dep of t.deps) {
        if (defined.has(dep)) continue;
        findings.push({
          message: `task references undefined dependency \`${dep}\`; no task declares the id \`${dep}\`, so Mermaid places this task at the chart start.`,
          line: t.line,
        });
      }
    }
    return findings;
  },
};

const ganttEmptySection: Rule = {
  id: 'gantt-empty-section',
  appliesTo: isGantt,
  evaluate: ({ lines }) => {
    interface Section {
      name: string;
      line: number;
      hasTask: boolean;
    }
    const findings: RuleFinding[] = [];
    let current: Section | null = null;

    const flush = () => {
      if (current !== null && !current.hasTask) {
        findings.push({
          message: `section \`${current.name}\` has no tasks and renders as an empty section header.`,
          line: current.line,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

      const sec = GANTT_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasTask: false };
        continue;
      }
      if (current !== null && !current.hasTask && isGanttTaskLine(trimmed)) {
        current.hasTask = true;
      }
    }
    flush();
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Journey helpers and rules
// ---------------------------------------------------------------------------

/**
 * Lines that open a journey directive rather than declare a task. A task is
 * `name: score: actors`, so directives with free text must be filtered before
 * the task-line check.
 */
const JOURNEY_KEYWORD_RE =
  /^(?:journey|userJourney|title|section|accTitle|accDescr)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const JOURNEY_SECTION_RE = /^section\s+(.+?)\s*$/;

/** A journey task line. Captures [1]=task name, [2]=happiness score, [3]=actors. */
const JOURNEY_TASK_RE = /^(.+?)\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(.*))?$/;

interface JourneyTask {
  name: string;
  score: number;
  actors: string[];
  line: number;
}

function isJourney(block: Block): boolean {
  return block.type === 'journey' || block.type === 'userJourney';
}

function parseJourneyTasks(lines: string[]): JourneyTask[] {
  const tasks: JourneyTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (JOURNEY_KEYWORD_RE.test(trimmed)) continue;
    const m = JOURNEY_TASK_RE.exec(trimmed);
    if (m === null) continue;
    tasks.push({
      name: m[1].trim(),
      score: Number(m[2]),
      actors:
        m[3] === undefined
          ? []
          : m[3]
              .split(',')
              .map((actor) => actor.trim())
              .filter((actor) => actor.length > 0),
      line: i + 1,
    });
  }
  return tasks;
}

function isJourneyTaskLine(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.startsWith('%%')) return false;
  if (JOURNEY_KEYWORD_RE.test(trimmed)) return false;
  return JOURNEY_TASK_RE.test(trimmed);
}

const journeyEmptySection: Rule = {
  id: 'journey-empty-section',
  appliesTo: isJourney,
  evaluate: ({ lines }) => {
    interface Section {
      name: string;
      line: number;
      hasTask: boolean;
    }
    const findings: RuleFinding[] = [];
    let current: Section | null = null;

    const flush = () => {
      if (current !== null && !current.hasTask) {
        findings.push({
          message: `section \`${current.name}\` has no tasks and renders as an empty section header.`,
          line: current.line,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

      const sec = JOURNEY_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasTask: false };
        continue;
      }
      if (current !== null && !current.hasTask && isJourneyTaskLine(trimmed)) {
        current.hasTask = true;
      }
    }
    flush();
    return findings;
  },
};

const journeyScoreOutOfRange: Rule = {
  id: 'journey-score-out-of-range',
  appliesTo: isJourney,
  evaluate: ({ lines }) =>
    parseJourneyTasks(lines)
      .filter((task) => task.score < 1 || task.score > 5)
      .map((task) => ({
        message: `journey task \`${task.name}\` has score ${task.score}; Mermaid journey scores should be between 1 and 5.`,
        line: task.line,
      })),
};

const journeyTaskWithoutActor: Rule = {
  id: 'journey-task-without-actor',
  appliesTo: isJourney,
  evaluate: ({ lines }) =>
    parseJourneyTasks(lines)
      .filter((task) => task.actors.length === 0)
      .map((task) => ({
        message: `journey task \`${task.name}\` has no actors; it renders without an owner lane and is usually incomplete.`,
        line: task.line,
      })),
};

const journeyNoTasks: Rule = {
  id: 'journey-no-tasks',
  appliesTo: isJourney,
  evaluate: ({ lines, headerLine }) => {
    if (parseJourneyTasks(lines).length > 0) return [];
    return [
      {
        message:
          'journey has no tasks; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Mindmap helpers and rules
// ---------------------------------------------------------------------------

/**
 * Depth at which `mindmap-deep-nesting` starts flagging. The root node is
 * depth 1, so a node at depth 6 is the fifth level below the root.
 */
const MINDMAP_MAX_DEPTH = 5;

/** A trailing `:::className` decorator on a mindmap node. */
const MINDMAP_CLASS_RE = /\s*:::[\w-]+\s*$/;

/** Opening→closing delimiter pairs for the six mindmap node shapes. */
const MINDMAP_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['((', '))'], // circle
  ['))', '(('], // bang
  ['{{', '}}'], // hexagon
  [')', '('], // cloud
  ['[', ']'], // square
  ['(', ')'], // rounded
];

interface MindmapNode {
  /** Display text (shape wrapper, leading id, and `:::class` stripped). */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** Root is depth 1; each indentation level adds one. */
  depth: number;
  /** Body line of the parent node, or `null` for the root. */
  parentLine: number | null;
}

function isMindmap(block: Block): boolean {
  return block.type === 'mindmap';
}

/**
 * Extract a mindmap node's display text. A node may carry an optional leading
 * id and one of six shape wrappers (`id((circle))`, `id[square]`, …) plus a
 * trailing `:::class`; the visible text is what sits inside the wrapper, or the
 * whole token when the node is plain text.
 */
function mindmapNodeText(trimmed: string): string {
  const s = trimmed.replace(MINDMAP_CLASS_RE, '').trim();
  const idMatch = /^[\w-]+/.exec(s);
  const afterId = idMatch === null ? s : s.slice(idMatch[0].length);
  for (const [open, close] of MINDMAP_SHAPES) {
    if (
      afterId.length >= open.length + close.length &&
      afterId.startsWith(open) &&
      afterId.endsWith(close)
    ) {
      return afterId.slice(open.length, afterId.length - close.length).trim();
    }
  }
  return s;
}

/**
 * Parse a mindmap body into a flat node list with parent links. Hierarchy is
 * indentation-based: a deeper-indented line is a child of the nearest shallower
 * line. The leading `mindmap` keyword, blank lines, `%%` comments, and `::icon`
 * decorator lines are skipped.
 */
function parseMindmapNodes(lines: string[]): MindmapNode[] {
  const nodes: MindmapNode[] = [];
  const stack: { indent: number; line: number }[] = [];
  let seenKeyword = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (!seenKeyword) {
      // The first content line is the `mindmap` keyword itself.
      seenKeyword = true;
      continue;
    }
    if (trimmed.startsWith('::')) continue; // `::icon(...)` decorator

    const indent = indentWidth(lines[i]);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parentLine = stack.length > 0 ? stack[stack.length - 1].line : null;
    nodes.push({
      text: mindmapNodeText(trimmed),
      line: i + 1,
      depth: stack.length + 1,
      parentLine,
    });
    stack.push({ indent, line: i + 1 });
  }
  return nodes;
}

const mindmapDuplicateSibling: Rule = {
  id: 'mindmap-duplicate-sibling',
  appliesTo: isMindmap,
  evaluate: ({ lines, fileLine }) => {
    const findings: RuleFinding[] = [];
    // key: `${parentLine}\0${text}` -> first line seen
    const seen = new Map<string, number>();
    for (const node of parseMindmapNodes(lines)) {
      const key = `${node.parentLine ?? 'root'}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, node.line);
      } else {
        findings.push({
          message: `mindmap node \`${node.text}\` duplicates a sibling (first on line ${fileLine(first)}); two identical branches render under the same parent.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};

const mindmapNoNodes: Rule = {
  id: 'mindmap-no-nodes',
  appliesTo: isMindmap,
  evaluate: ({ lines, headerLine }) => {
    if (parseMindmapNodes(lines).length > 0) return [];
    return [
      {
        message:
          'mindmap has no nodes; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

const mindmapDeepNesting: Rule = {
  id: 'mindmap-deep-nesting',
  appliesTo: isMindmap,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];
    for (const node of parseMindmapNodes(lines)) {
      if (node.depth > MINDMAP_MAX_DEPTH) {
        findings.push({
          message: `mindmap node \`${node.text}\` is nested ${node.depth} levels deep (beyond ${MINDMAP_MAX_DEPTH}); deeply nested branches are hard to read.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Kanban helpers and rules
// ---------------------------------------------------------------------------

/**
 * A kanban node's id: the run of text before the first shape opener, `@` shape
 * -data marker, or brace. This is mermaid's own `NODE_ID` charset
 * (`[^\(\[\n\)\{\}@]+`) spelled as its complement, so `t1[Card]`, `t1(Card)`,
 * `t1))Card((` and `t1@{ … }` all yield `t1` — and `]` really is legal inside
 * an id, since mermaid's charset does not exclude it.
 */
const KANBAN_NODE_ID_RE = /^[^([){}@]+/;

/**
 * Characters a kanban node's shape wrapper may open with (mermaid's
 * `NODE_DSTART`) and close with (`NODE_DEND`). The two sets are deliberately
 * not mirror images: `[` only ever opens and `]` only ever closes, while the
 * cloud and bang shapes invert the parentheses (`)Card(`, `))Card((`). They are
 * scanned as runs rather than matched as pairs, because mermaid's own
 * `NODE_DESCR` is a complement charset that accepts mismatched delimiters.
 */
const KANBAN_WRAP_OPEN = '([){}';
const KANBAN_WRAP_CLOSE = '()]{}';

interface KanbanNode {
  /** Node id, as mermaid derives it. */
  id: string;
  /** 1-indexed body line. */
  line: number;
}

interface KanbanColumn extends KanbanNode {
  cards: KanbanNode[];
}

/** Which kind of node a declaration is — the two share one id namespace. */
type KanbanNodeKind = 'column' | 'card';

interface KanbanDeclaration extends KanbanNode {
  kind: KanbanNodeKind;
}

function isKanban(block: Block): boolean {
  return block.type === 'kanban';
}

/**
 * Derive the id mermaid will give a kanban node, or `null` when the line
 * declares no node. A node carries an explicit id (`t1[Card]`) or is written
 * bare, in which case mermaid uses the text itself — the whole line for a plain
 * node, the label for a wrapped one (`[Card]` is the node `Card`).
 *
 * The id is deliberately not trimmed or comment-stripped: mermaid's `NODE_ID`
 * swallows both, so `t1 [Card]` really is the node `t1 ` and a bare
 * `Card %% note` really is the node `Card %% note`. Normalizing either here
 * would report a collision mermaid does not have.
 */
function kanbanNodeId(trimmed: string): string | null {
  const id = KANBAN_NODE_ID_RE.exec(trimmed)?.[0];
  return id ?? kanbanWrappedLabel(trimmed);
}

/**
 * The label of a node written without an id — `[Card]`, `((Card))`,
 * `))Card((`, optionally trailed by `@{ … }` shape data — which mermaid then
 * uses as that node's id. `null` when the line opens no wrapper or never closes
 * one, meaning it declares no node.
 *
 * Deliberately a pointer scan rather than the obvious
 * `/^[([){}]+(.*?)[()\]{}]+…$/`. That regex puts three quantifiers over
 * overlapping character sets in a row, which backtracks *cubically* whenever
 * the match fails — and failing is the common case here, since this is reached
 * for every line starting with one of those characters. A line of 4 000 `(`
 * took 25s in the regex; the scan below is O(n) because each pointer only ever
 * moves one way. Diagram bodies come from user documents and `checkSemantics`
 * runs ahead of any parse, so a body that never parses still reaches this.
 */
function kanbanWrappedLabel(trimmed: string): string | null {
  let start = 0;
  while (start < trimmed.length && KANBAN_WRAP_OPEN.includes(trimmed[start])) {
    start++;
  }
  if (start === 0) return null;

  let end = trimmed.length;
  // An `@{ … }` tail sits outside the wrapper, so it only counts as one when
  // the wrapper closes just before it — `@{` inside a label is ordinary text
  // to mermaid, whose `NODE_DESCR` admits both characters.
  const tail = trimmed.lastIndexOf('@{');
  if (tail > start) {
    let beforeTail = tail;
    while (beforeTail > start && /\s/.test(trimmed[beforeTail - 1])) {
      beforeTail--;
    }
    if (KANBAN_WRAP_CLOSE.includes(trimmed[beforeTail - 1])) end = beforeTail;
  }

  const closeEnd = end;
  while (end > start && KANBAN_WRAP_CLOSE.includes(trimmed[end - 1])) end--;
  if (end === closeEnd || end === start) return null;
  return trimmed.slice(start, end);
}

/**
 * Walk a kanban body for its columns and their cards. Hierarchy is
 * indentation-based but only one level deep: the first node's indentation fixes
 * the column level, every node at that indentation opens a new column, and
 * every more-indented node is a card of the column above it — regardless of how
 * much deeper it sits, since mermaid's `getSection` only compares against the
 * column level rather than tracking a stack. A node *less* indented than the
 * column level makes mermaid throw ("Items without section detected"), so the
 * syntax pass reports it and no such body reaches here; it is read as a column
 * so the parse still terminates.
 *
 * Skipped: everything up to and including the `kanban` header (which
 * `headerLine` locates, so a frontmatter block cannot be mistaken for a node),
 * blank lines, `%%` comment lines, `::icon(…)` decorators, and the interior of
 * a multi-line `@{ … }` shape-data block.
 */
function parseKanban(lines: string[], headerLine: number): KanbanColumn[] {
  const columns: KanbanColumn[] = [];
  let columnIndent: number | null = null;
  let inShapeData = false;

  for (let i = headerLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inShapeData) {
      if (trimmed.includes('}')) inShapeData = false;
      continue;
    }
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (trimmed.startsWith('::')) continue; // `::icon(...)` decorator
    // An `@{` with no `}` after it opens a shape-data block that runs on until
    // one closes it; those interior lines declare nothing.
    const shapeData = trimmed.indexOf('@{');
    if (shapeData !== -1 && !trimmed.includes('}', shapeData)) {
      inShapeData = true;
    }

    const id = kanbanNodeId(trimmed);
    if (id === null) continue;

    const indent = indentWidth(lines[i]);
    // The first node's own indentation becomes the column level, so that node
    // always takes the `else` branch and there is always a column to push onto.
    columnIndent ??= indent;
    if (indent > columnIndent) {
      columns[columns.length - 1].cards.push({ id, line: i + 1 });
    } else {
      columns.push({ id, line: i + 1, cards: [] });
    }
  }
  return columns;
}

/**
 * Flatten {@link parseKanban} into the one ordered stream of id declarations
 * mermaid itself works from: each column, then its cards. Columns and cards
 * register through the same `addNode` and surface the same way as DOM ids, so
 * collisions are decided over this single stream rather than per node kind.
 */
function kanbanDeclarations(
  lines: string[],
  headerLine: number,
): KanbanDeclaration[] {
  const declarations: KanbanDeclaration[] = [];
  for (const column of parseKanban(lines, headerLine)) {
    declarations.push({ id: column.id, line: column.line, kind: 'column' });
    for (const card of column.cards) {
      declarations.push({ id: card.id, line: card.line, kind: 'card' });
    }
  }
  return declarations;
}

/**
 * Report every `kind` declaration whose id an earlier declaration already
 * holds, naming that holder. Both duplicate rules are this same walk over the
 * one namespace, differing only in which kind of declaration they answer for —
 * so each of the four collision directions lands with exactly one rule and the
 * two need no knowledge of each other. A colliding declaration does not become
 * a holder, which is what makes every repeat cite the first.
 */
function kanbanCollisions(
  lines: string[],
  headerLine: number,
  kind: KanbanNodeKind,
  message: (node: KanbanDeclaration, holder: KanbanDeclaration) => string,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const holders = new Map<string, KanbanDeclaration>();
  for (const node of kanbanDeclarations(lines, headerLine)) {
    const holder = holders.get(node.id);
    if (holder === undefined) {
      holders.set(node.id, node);
    } else if (node.kind === kind) {
      findings.push({ message: message(node, holder), line: node.line });
    }
  }
  return findings;
}

/**
 * The consequence every kanban id collision has *except* column-on-column:
 * both nodes render — nothing in a kanban references a node id, so no relation
 * is lost — but the renderer derives each node's DOM id from it
 * (`<svg-id>-<node-id>`), leaving two elements in the document under one id.
 */
function kanbanCollidingIdsClause(
  holder: KanbanDeclaration,
  fileLine: (bodyLine: number) => number,
): string {
  const noun = holder.kind === 'column' ? 'a column' : 'a card';
  return `is already used by ${noun} on line ${fileLine(holder.line)}; both nodes render, but Mermaid emits each node's id as a DOM id, so the document carries that id twice and \`getElementById\`, an \`#id\` selector, a fragment link, or a click handler reaches only one of them.`;
}

const kanbanDuplicateColumn: Rule = {
  id: 'kanban-duplicate-column',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine, fileLine }) =>
    kanbanCollisions(lines, headerLine, 'column', (column, holder) =>
      // Two *columns* is the severe case and gets its own sentence: `getData`
      // hands each of them every card whose `parentId` matches, and the
      // renderer re-filters that already-duplicated list per column. Against an
      // earlier card there is no fan-out, only the shared id collision.
      holder.kind === 'column'
        ? `kanban column id \`${column.id}\` is already declared on line ${fileLine(holder.line)}; Mermaid hands every card declared under either column to both of them, so each card renders several times over, in a column its author did not put it in.`
        : `kanban column id \`${column.id}\` ${kanbanCollidingIdsClause(holder, fileLine)}`,
    ),
};

const kanbanDuplicateTaskId: Rule = {
  id: 'kanban-duplicate-task-id',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine, fileLine }) =>
    kanbanCollisions(
      lines,
      headerLine,
      'card',
      (card, holder) =>
        `kanban task id \`${card.id}\` ${kanbanCollidingIdsClause(holder, fileLine)}`,
    ),
};

const kanbanEmptyColumn: Rule = {
  id: 'kanban-empty-column',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine }) =>
    parseKanban(lines, headerLine)
      .filter((column) => column.cards.length === 0)
      .map((column) => ({
        message: `kanban column \`${column.id}\` has no cards; it renders as a header over an empty column.`,
        line: column.line,
      })),
};

const kanbanNoColumns: Rule = {
  id: 'kanban-no-columns',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine }) => {
    if (parseKanban(lines, headerLine).length > 0) return [];
    return [
      {
        message:
          'kanban has no columns; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Venn helpers and rules
// ---------------------------------------------------------------------------

/**
 * The `set` / `union` keyword opening a venn-beta statement. Mermaid's lexer
 * matches every keyword case-insensitively (`SET A` parses), so this does too.
 */
const VENN_STATEMENT_RE = /^(?:set|union)\b/i;

/**
 * One venn identifier: Mermaid's `IDENTIFIER` or its `STRING`. Anchored and
 * applied to a moving slice rather than scanned globally, so the identifier
 * list is read left to right exactly as the parser reads it.
 */
const VENN_IDENTIFIER_RE = /^(?:[A-Za-z_][A-Za-z0-9\-_]*|"[^"]*")/;

/**
 * Mermaid's `NUMERIC`, after the `:` that introduces an explicit size. The
 * sign is part of the token — unlike treemap, where a `-5` dies in the lexer.
 * Captures [1]=the numeric text.
 */
const VENN_SIZE_RE = /^:\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/;

/**
 * Normalize an identifier the way `vennDB.normalizeText` does: trim, then drop
 * a surrounding pair of double quotes. This is what makes `set "A"` and
 * `set A` the same set, and it runs before anything is compared.
 */
function vennNormalize(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

interface VennStatement {
  kind: 'set' | 'union';
  /** Normalized identifiers, in source order (Mermaid sorts; order is ours). */
  identifiers: string[];
  /** The explicit `: value`, or `null` when the statement carries none. */
  size: number | null;
  /** 1-indexed body line. */
  line: number;
}

function isVenn(block: Block): boolean {
  return block.type === 'venn-beta';
}

/**
 * Scan a venn-beta body into its `set` and `union` statements.
 *
 * A statement is the keyword, then an identifier list, then an optional
 * `[label]`, then an optional `: size`. The parts are consumed in that order by
 * a single left-to-right pass rather than by one regex over the whole line: a
 * combined pattern would stack quantifiers over overlapping character sets and
 * backtrack super-linearly on the failing path, which a diagram body
 * (arbitrary user input, scanned before any parse) can reach. The scan is
 * O(line length).
 *
 * The grammar is *not* line-oriented, which is the trap here. `document` is a
 * list of `line`s and `line` is `statement | NEWLINE` — a newline is a line of
 * its own, not a statement terminator — so several statements may share one
 * physical line. `set A set B` really does declare two sets, and `set A set A`
 * really is the duplicate `venn-duplicate-set` exists for. Hence the inner
 * loop, which keeps reading statements until the line stops yielding them.
 *
 * A line that does not *open* with `set` or `union` is skipped whole rather
 * than scanned for one further in. Mermaid's `title` swallows the rest of its
 * line (`title\s[^#\n;]+`), so a `set` inside it is title text, not a
 * declaration — scanning forward would invent a set the diagram never had.
 * Skipping may miss a statement trailing some other keyword; that direction
 * costs a finding, the other direction invents one.
 */
function parseVennStatements(
  lines: string[],
  headerLine: number,
): VennStatement[] {
  const statements: VennStatement[] = [];

  for (let i = headerLine; i < lines.length; i++) {
    let rest = lines[i].trim();

    for (;;) {
      // A `%%` here opens a comment running to end of line. Reached only
      // between statements: a `%%` *inside* a label was consumed with it, the
      // way the lexer consumes `["50%% off"]` as one token.
      if (rest.startsWith('%%')) break;

      const keyword = VENN_STATEMENT_RE.exec(rest);
      if (keyword === null) break;

      const kind = keyword[0].toLowerCase() as 'set' | 'union';
      rest = rest.slice(keyword[0].length);
      const identifiers: string[] = [];

      for (;;) {
        rest = rest.trimStart();
        const identifier = VENN_IDENTIFIER_RE.exec(rest);
        if (identifier === null) break;
        identifiers.push(vennNormalize(identifier[0]));
        rest = rest.slice(identifier[0].length).trimStart();
        // Only a `union` takes more than one identifier; a comma after a `set`
        // identifier is a parse error, so stop and let the syntax pass have it.
        if (kind !== 'union' || !rest.startsWith(',')) break;
        rest = rest.slice(1);
      }
      if (identifiers.length === 0) break;

      // An optional `[label]`. The lexer tries `["…"]` before `[…]`, and the
      // quoted form's body is `[^"]*` — so a `]` is legal inside it and the
      // token ends at the first `"]`, not the first `]`. Ending a quoted label
      // early would leave its tail in `rest`, where `set A["]: -5"]` reads as
      // a size of -5 the diagram never had.
      if (rest.startsWith('[')) {
        const quoted = rest.startsWith('["');
        const close = quoted ? rest.indexOf('"]', 2) : rest.indexOf(']');
        // Unterminated: a lexical error, so leave the line to the syntax pass.
        if (close === -1) break;
        rest = rest.slice(close + (quoted ? 2 : 1)).trimStart();
      }

      const size = VENN_SIZE_RE.exec(rest);
      if (size !== null) rest = rest.slice(size[0].length).trimStart();

      statements.push({
        kind,
        identifiers,
        size: size === null ? null : Number.parseFloat(size[1]),
        line: i + 1,
      });
    }
  }

  return statements;
}

const vennDuplicateSet: Rule = {
  id: 'venn-duplicate-set',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const statement of parseVennStatements(lines, headerLine)) {
      if (statement.kind !== 'set') continue;
      const id = statement.identifiers[0];
      const first = seen.get(id);
      if (first === undefined) {
        seen.set(id, statement.line);
        continue;
      }
      findings.push({
        message: `venn set \`${id}\` is declared more than once (first on line ${fileLine(first)}); Mermaid adds a second circle coincident with the first rather than replacing it, and both draw the last label, so an earlier one never renders.`,
        line: statement.line,
      });
    }

    return findings;
  },
};

const vennNonPositiveSize: Rule = {
  id: 'venn-non-positive-size',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) =>
    parseVennStatements(lines, headerLine)
      .filter((statement) => statement.size !== null && statement.size <= 0)
      .map((statement) => {
        // Only the consequence differs between the two kinds; the subject
        // reads the same, since a `set` always carries exactly one identifier.
        const consequence =
          statement.kind === 'set'
            ? 'a size of 0 removes the set and every intersection over it from the diagram, and a negative one distorts the layout.'
            : 'venn areas should be greater than 0, and a negative one throws out of the layout so nothing renders.';
        return {
          message: `venn ${statement.kind} \`${statement.identifiers.join(', ')}\` has a non-positive size (${statement.size}); ${consequence}`,
          line: statement.line,
        };
      }),
};

const vennSingleSet: Rule = {
  id: 'venn-single-set',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) => {
    const sets = parseVennStatements(lines, headerLine).filter(
      (statement) => statement.kind === 'set',
    );
    const distinct = new Set(sets.map((statement) => statement.identifiers[0]));
    if (distinct.size !== 1) return [];

    // Every declaration names that one set, so the first is both the name to
    // report and the line to report it on.
    const [first] = sets;
    return [
      {
        message: `venn-beta declares only one set (\`${first.identifiers[0]}\`); it renders as a single circle, with nothing to intersect.`,
        line: first.line,
      },
    ];
  },
};

const vennSelfUnion: Rule = {
  id: 'venn-self-union',
  appliesTo: isVenn,
  evaluate: ({ lines, headerLine }) => {
    const findings: RuleFinding[] = [];

    for (const statement of parseVennStatements(lines, headerLine)) {
      if (statement.kind !== 'union') continue;
      // A `seen` set rather than `indexOf`, which rescans from the head per
      // element and so is quadratic on the path that finds *nothing* — a union
      // of distinct identifiers, which is the well-formed case every clean
      // diagram takes. Measured at 20 000 distinct identifiers: 255ms via
      // `indexOf`, 2ms here.
      const seen = new Set<string>();
      let repeated: string | undefined;
      for (const id of statement.identifiers) {
        if (seen.has(id)) {
          repeated = id;
          break;
        }
        seen.add(id);
      }
      if (repeated === undefined) continue;
      findings.push({
        message: `venn union names \`${repeated}\` more than once; Mermaid does not deduplicate the list, so the set is intersected with itself and draws a spurious extra region.`,
        line: statement.line,
      });
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// treeView-beta helpers and rules
// ---------------------------------------------------------------------------

/**
 * A metadata statement that swallows the rest of its line. Each takes free text
 * that may itself be quoted — `title "Releases"` stores the title as the
 * literal `"Releases"` — so a node scan that did not skip these lines would
 * read the diagram's own caption as a node.
 *
 * The two boundaries differ because mermaid's terminals do. `TITLE` ends with
 * an *empty* alternative, so `title` only consumes the line when a space or tab
 * follows it: `title"p"` lexes as an empty title and then a node `p`, and
 * skipping that line would lose a node mermaid renders. `accTitle` and
 * `accDescr` have no such alternative — without their `:` or `{` they are a
 * lexer error — so a plain word boundary is enough for them.
 */
const TREEVIEW_META_RE = /^(?:title(?=[\t ]|$)|(?:accTitle|accDescr)(?![\w-]))/;

/** The opening line of a multi-line `accDescr { … }` block. */
const TREEVIEW_ACC_DESCR_OPEN_RE = /^accDescr\s*\{/;

/** A bare `accDescr` whose `{` opens on a later line. */
const TREEVIEW_ACC_DESCR_BARE_RE = /^accDescr$/;

/**
 * The `treeView-beta` keyword that opens the body, with any indent before it.
 * Matched to find where to *resume* scanning, not to validate: mermaid's
 * grammar takes a label right after the keyword, so `treeView-beta "root"`
 * declares a node on the header line itself.
 */
const TREEVIEW_HEADER_RE = /^[\t ]*treeView-beta/;

/**
 * A quoted treeView label. Mermaid's `STRING2` terminal accepts either quote
 * style and has no escape, so a label runs to the next matching quote; an
 * unquoted word is a lexer error, not a node, which is why every treeView rule
 * keys on quoted text alone.
 *
 * Groups: exactly one of [1] (double-quoted) or [2] (single-quoted) holds the
 * label. The whitespace before a label is what mermaid measures as its indent,
 * but it is counted by {@link treeViewIndent} rather than captured here: a
 * leading `([ \t]*)` re-scans the whole run at every start position it fails
 * from, which is quadratic on a line of nothing but spaces — 80 000 of them
 * took ~2.8s. Diagram bodies are user input and `checkSemantics` runs ahead of
 * any parse, so an unparseable body still reaches this.
 */
const TREEVIEW_LABEL_RE = /"([^"]*)"|'([^']*)'/g;

/**
 * Count the whitespace immediately before a label. Mermaid's `INDENTATION`
 * terminal matches wherever it sits, so this is a node's indent whether the
 * label opens its line or follows another on the same one.
 */
function treeViewIndent(line: string, start: number): number {
  let n = start;
  while (n > 0 && (line[n - 1] === ' ' || line[n - 1] === '\t')) n--;
  return start - n;
}

interface TreeViewNode {
  /** Label text, quotes stripped. */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** Index of the parent in the node list, or `null` for a top-level node. */
  parent: number | null;
}

function isTreeView(block: Block): boolean {
  return block.type === 'treeView-beta';
}

/**
 * Scan a treeView-beta body into a flat node list with parent links.
 *
 * Hierarchy is a plain stack over an indent measured in characters: mermaid's
 * `addNode` pops while `level <= top.level`, so a strictly-deeper indent is a
 * child and anything else re-parents up the stack. The *size* of the step never
 * survives — indenting a child by twelve spaces builds the same tree as
 * indenting it by one — which is why there is no `treeview-indent-jump` rule.
 *
 * Indent is per *node*, not per line. Mermaid's `INDENTATION` terminal matches
 * the whitespace immediately before a label wherever it sits, so a second label
 * on the same line takes the single space between them as its indent and lands
 * as a shallow sibling rather than beside its line-mate. Rare, but it is what
 * mermaid does, so the scan walks labels rather than lines.
 *
 * For the same reason the scan is offset-based rather than line-based: three
 * constructs end mid-line and leave the remainder lexing normally, so each one
 * yields a `scanFrom` to resume at instead of skipping the whole line. The
 * header keyword is one (`treeView-beta "root"` declares a node), an
 * `accDescr { … }` block's closing `}` is another (`accDescr { d } "p"`
 * declares `p`), and `title` with no space after it is the third.
 */
function parseTreeViewNodes(
  lines: string[],
  headerLine: number,
): TreeViewNode[] {
  const nodes: TreeViewNode[] = [];
  const stack: { indent: number; index: number }[] = [];
  let inAccDescr = false;

  for (let i = headerLine - 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // Offset of `trimmed` within `raw`, so an index found in the former can be
    // mapped back onto the latter — the label scan and the indent count both
    // need real column positions.
    const lead = raw.length - raw.trimStart().length;
    // Where the rest of this line starts lexing as nodes. Zero for an ordinary
    // node line; past the keyword or a closing `}` for the mid-line cases.
    let scanFrom = 0;

    if (i === headerLine - 1) {
      // The header line carries the keyword, and may carry a node after it.
      const header = TREEVIEW_HEADER_RE.exec(raw);
      if (header === null) continue;
      scanFrom = header[0].length;
    } else {
      if (trimmed === '' || trimmed.startsWith('%%')) continue;

      // An `accDescr { … }` block is prose; mermaid reads no nodes out of it,
      // but it stops at the first `}` and keeps lexing what follows.
      if (inAccDescr) {
        const close = trimmed.indexOf('}');
        if (close === -1) continue;
        inAccDescr = false;
        scanFrom = lead + close + 1;
      } else if (TREEVIEW_ACC_DESCR_OPEN_RE.test(trimmed)) {
        const close = trimmed.indexOf('}', trimmed.indexOf('{'));
        if (close === -1) {
          inAccDescr = true;
          continue;
        }
        scanFrom = lead + close + 1;
      } else if (TREEVIEW_ACC_DESCR_BARE_RE.test(trimmed)) {
        // Only whitespace may separate the keyword from its brace, so anything
        // else on the next non-blank line means this was never an `accDescr`.
        // Walked with an index rather than `lines.slice(i + 1).find(…)`: the
        // slice copies the whole remaining body, so a diagram that is nothing
        // but bare `accDescr` lines re-copies it once per line — quadratic, and
        // reachable, since `checkSemantics` runs ahead of any parse.
        let next = i + 1;
        while (next < lines.length && lines[next].trim() === '') next++;
        if (next < lines.length && lines[next].trim().startsWith('{')) {
          inAccDescr = true;
        }
        continue;
      } else if (TREEVIEW_META_RE.test(trimmed)) {
        continue;
      }
    }

    TREEVIEW_LABEL_RE.lastIndex = scanFrom;
    let match = TREEVIEW_LABEL_RE.exec(raw);
    while (match !== null) {
      const indent = treeViewIndent(raw, match.index);
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      nodes.push({
        text: match[1] ?? match[2],
        line: i + 1,
        parent: stack.length > 0 ? stack[stack.length - 1].index : null,
      });
      stack.push({ indent, index: nodes.length - 1 });
      match = TREEVIEW_LABEL_RE.exec(raw);
    }
  }

  return nodes;
}

const treeviewNoNodes: Rule = {
  id: 'treeview-no-nodes',
  appliesTo: isTreeView,
  evaluate: ({ lines, headerLine }) => {
    if (parseTreeViewNodes(lines, headerLine).length > 0) return [];
    return [
      {
        message:
          'treeView-beta has no nodes; it parses but renders as an empty tree. Node labels must be quoted — a bare word is a lexer error, not a node.',
        line: headerLine,
      },
    ];
  },
};

const treeviewDuplicateSibling: Rule = {
  id: 'treeview-duplicate-sibling',
  appliesTo: isTreeView,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const findings: RuleFinding[] = [];
    const nodes = parseTreeViewNodes(lines, headerLine);
    // key: `${parent index}\0${text}` -> index of the first node seen
    const seen = new Map<string, number>();
    for (const [index, node] of nodes.entries()) {
      const key = `${node.parent ?? 'root'}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
      } else {
        findings.push({
          message: `treeView node \`${node.text}\` duplicates a sibling (first on line ${fileLine(nodes[first].line)}); both branches render under the same parent, so the tree draws a distinction it does not have.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Ishikawa helpers and rules
// ---------------------------------------------------------------------------

/**
 * Depth at which `ishikawa-deep-nesting` starts flagging. The problem is depth
 * 1 and its categories are depth 2, so a node at depth 6 is the fourth level
 * below its category. Equal to {@link MINDMAP_MAX_DEPTH} and not shared
 * with it: the two agree by coincidence of taste, and retuning one should not
 * move the other.
 */
const ISHIKAWA_MAX_DEPTH = 5;

/** Depth of a category — the problem's own children, which draw the bones. */
const ISHIKAWA_CATEGORY_DEPTH = 2;

interface IshikawaNode {
  /** The line's trimmed text, which is all Mermaid keeps (see below). */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** The problem is depth 1; each level below it adds one. */
  depth: number;
  /** Body line of the parent node, or `null` for the problem. */
  parentLine: number | null;
}

function isIshikawa(block: Block): boolean {
  return block.type === 'ishikawa-beta';
}

/**
 * Parse an ishikawa body into a flat node list with parent links, replicating
 * `IshikawaDB.addNode` rather than reusing {@link parseMindmapNodes}. The two
 * hierarchies look alike but resolve differently, in two ways that change what
 * the rules see:
 *
 * - **The problem is never popped.** `addNode`'s pop loop guards on
 *   `stack.length > 1`, so every node after the first is a descendant of the
 *   first no matter how it is indented — two problems at the same indent make
 *   the second a *category* of the first, and outdenting past the problem does
 *   the same. A stack-of-indents parser would report a second root instead.
 * - **`baseLevel` is set by the second node**, not the first, so the problem's
 *   own indent is never read. An unindented problem line therefore works.
 *
 * Indent is measured in characters (a tab counts as one, as in
 * {@link indentWidth}), and an indent jump of several levels at once is
 * normalized to a single level rather than creating phantom ones.
 *
 * A node's text is its trimmed line — the grammar is `SPACELIST TEXT` with
 * `TEXT` as `[^\n]+`, so there are no shape wrappers, no leading ids, and no
 * directives (`title X` parses as a *node*). Inner whitespace is therefore
 * significant, quotes are part of the label, and on a *body* line a trailing
 * `%% note` is part of the text: `TEXT` has already swallowed it by then, so
 * only an own-line `%%` is a comment there.
 *
 * Two things sit between this and mermaid's label, both shared with the other
 * indentation-based families and neither reachable by ordinary input: mermaid
 * reads a *preprocessed* body, so an inline `%%{...}%%` is deleted from the
 * middle of a line (see `preprocess.ts`) where this keeps it; and it runs each
 * label through `common.sanitizeText`, which is a no-op under the default
 * config. Both make a rule miss a duplicate rather than invent one.
 *
 * The header line is read too. `ishikawa-beta Problem` lexes as
 * `ISHIKAWA SPACELIST TEXT` and makes `Problem` the root, so skipping the
 * header wholesale would lose it and make a diagram with causes look like one
 * without. Its indent is unread, per `baseLevel` above, so only its text
 * matters — and there the `%%` rule *does* apply, because the lexer is sitting
 * at whitespace rather than mid-`TEXT` (see the check below).
 */
function parseIshikawaNodes({
  lines,
  headerLine,
  headerText,
}: RuleContext): IshikawaNode[] {
  const nodes: IshikawaNode[] = [];
  // Mirrors `IshikawaDB.stack`: the problem enters at level 0 and stays put,
  // which is what the `stack.length > 1` pop guard below protects.
  const stack: { level: number; line: number }[] = [];
  let baseLevel: number | undefined;

  const push = (text: string, line: number, rawLevel: number): void => {
    let level = 0;
    if (stack.length > 0) {
      baseLevel ??= rawLevel;
      level = Math.max(1, rawLevel - baseLevel + 1);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
    }
    nodes.push({
      text,
      line,
      depth: stack.length + 1,
      parentLine: stack[stack.length - 1]?.line ?? null,
    });
    stack.push({ level, line });
  };

  // Text trailing the keyword on the header line, if any, is the problem. Its
  // indent is passed as 0 and never read — `baseLevel` is seeded by the node
  // after it.
  //
  // A `%%` tail is a comment, not a node: the lexer's comment rule (`\s*%%.*`)
  // is tried before its `TEXT` rule, and on this line it is sitting at the
  // whitespace after the keyword rather than mid-`TEXT`, so the comment rule
  // wins and declares nothing. Without this check the comment becomes the
  // problem, which both invents a finding against it and pushes every real
  // node down a level.
  const afterKeyword = headerText.replace(/^\S+/, '').trim();
  if (afterKeyword.length > 0 && !afterKeyword.startsWith('%%')) {
    push(afterKeyword, headerLine, 0);
  }

  for (let i = headerLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    push(trimmed, i + 1, indentWidth(lines[i]));
  }
  return nodes;
}

/** Lines of the nodes that some other node hangs off — i.e. the non-leaves. */
function ishikawaParentLines(nodes: IshikawaNode[]): Set<number> {
  return new Set(
    nodes
      .map((node) => node.parentLine)
      .filter((line): line is number => line !== null),
  );
}

const ishikawaNoCauses: Rule = {
  id: 'ishikawa-no-causes',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    const nodes = parseIshikawaNodes(ctx);
    // No nodes at all is a different diagram — one with no problem to name.
    // `ishikawa-beta\n` parses and renders empty, but #147 leaves that case to
    // a follow-up rule rather than folding it in here.
    const problem = nodes[0];
    if (problem === undefined || ishikawaParentLines(nodes).has(problem.line)) {
      return [];
    }
    return [
      {
        message: `ishikawa problem \`${problem.text}\` has no causes; it renders as the problem head above a zero-length spine.`,
        line: problem.line,
      },
    ];
  },
};

const ishikawaEmptyCategory: Rule = {
  id: 'ishikawa-empty-category',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    const nodes = parseIshikawaNodes(ctx);
    const parents = ishikawaParentLines(nodes);
    return nodes
      .filter(
        (node) =>
          node.depth === ISHIKAWA_CATEGORY_DEPTH && !parents.has(node.line),
      )
      .map((node) => ({
        message: `ishikawa category \`${node.text}\` has no causes; its bone draws at a fifth of full length with nothing attached.`,
        line: node.line,
      }));
  },
};

const ishikawaDeepNesting: Rule = {
  id: 'ishikawa-deep-nesting',
  appliesTo: isIshikawa,
  evaluate: (ctx) =>
    parseIshikawaNodes(ctx)
      .filter((node) => node.depth > ISHIKAWA_MAX_DEPTH)
      .map((node) => ({
        message: `ishikawa node \`${node.text}\` is nested ${node.depth} levels deep (beyond ${ISHIKAWA_MAX_DEPTH}); deeply nested causes render, but stop communicating.`,
        line: node.line,
      })),
};

const ishikawaDuplicateSibling: Rule = {
  id: 'ishikawa-duplicate-sibling',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    // Destructured rather than called as `ctx.fileLine` so the citation stays
    // in the shape semantic.test.ts's source scan polices.
    const { fileLine } = ctx;
    const findings: RuleFinding[] = [];
    // key: `${parentLine}\0${text}` -> first line seen
    const seen = new Map<string, number>();
    for (const node of parseIshikawaNodes(ctx)) {
      if (node.parentLine === null) continue;
      const key = `${node.parentLine}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, node.line);
      } else {
        findings.push({
          message: `ishikawa node \`${node.text}\` duplicates a sibling (first on line ${fileLine(first)}); the same cause renders twice under one parent.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Timeline helpers and rules
// ---------------------------------------------------------------------------

/**
 * Lines that open a timeline directive rather than declare a time period.
 * Everything else (a `period : event : event` line, or a `: event`
 * continuation line) is a period entry.
 */
const TIMELINE_KEYWORD_RE = /^(?:timeline|title|section)\b/;

/** A `section Name` line. Captures [1]=section name (trimmed). */
const TIMELINE_SECTION_RE = /^section\s+(.+?)\s*$/;

function isTimeline(block: Block): boolean {
  return block.type === 'timeline';
}

/** True when a trimmed line is a time-period entry (not a keyword/comment). */
function isTimelineEntry(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.startsWith('%%')) return false;
  return !TIMELINE_KEYWORD_RE.test(trimmed);
}

const timelineEmptySection: Rule = {
  id: 'timeline-empty-section',
  appliesTo: isTimeline,
  evaluate: ({ lines }) => {
    interface Section {
      name: string;
      line: number;
      hasEntry: boolean;
    }
    const findings: RuleFinding[] = [];
    let current: Section | null = null;

    const flush = () => {
      if (current !== null && !current.hasEntry) {
        findings.push({
          message: `section \`${current.name}\` has no entries and renders as an empty section header.`,
          line: current.line,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;

      const sec = TIMELINE_SECTION_RE.exec(trimmed);
      if (sec !== null) {
        flush();
        current = { name: sec[1], line: i + 1, hasEntry: false };
        continue;
      }
      if (current !== null && !current.hasEntry && isTimelineEntry(trimmed)) {
        current.hasEntry = true;
      }
    }
    flush();
    return findings;
  },
};

// A period line is `period : event : event…`; the colon-separated fields after
// the first are events. A blank event (a trailing `:`, or `: :`) renders an
// empty event bubble. The period slot (field 0) is ignored — a leading-colon
// continuation line has an empty field 0 by design, not an empty event.
const timelineEmptyEvent: Rule = {
  id: 'timeline-empty-event',
  appliesTo: isTimeline,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!isTimelineEntry(trimmed)) continue;
      const fields = trimmed.split(':');
      if (fields.length < 2) continue; // a bare period with no events
      const hasEmptyEvent = fields
        .slice(1)
        .some((event) => event.trim().length === 0);
      if (hasEmptyEvent) {
        findings.push({
          message:
            'time period has an empty event (a blank `:` field); it renders as an empty event bubble.',
          line: i + 1,
        });
      }
    }
    return findings;
  },
};

const timelineNoEntries: Rule = {
  id: 'timeline-no-entries',
  appliesTo: isTimeline,
  evaluate: ({ lines, headerLine }) => {
    let hasSection = false;
    let hasEntry = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (TIMELINE_SECTION_RE.test(trimmed)) hasSection = true;
      else if (isTimelineEntry(trimmed)) hasEntry = true;
    }
    if (hasSection || hasEntry) return [];
    return [
      {
        message:
          'timeline has no sections or time periods; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Git graph helpers and rules
// ---------------------------------------------------------------------------

/** A quoted `id: "…"` attribute on a commit/merge line. Captures [1]=id. */
const GITGRAPH_ID_RE = /\bid:\s*"([^"]*)"/;

/** A quoted `tag: "…"` attribute on a commit/merge line. Captures [1]=tag. */
const GITGRAPH_TAG_RE = /\btag:\s*"([^"]*)"/;

function isGitGraph(block: Block): boolean {
  return block.type === 'gitGraph';
}

/**
 * Lines that declare a graph node carrying an optional `id:`/`tag:`. A
 * `cherry-pick id: "…"` line *references* an existing commit id rather than
 * declaring one, so it is deliberately excluded — counting it would
 * double-count a valid id and produce a false duplicate.
 */
function isGitGraphNodeLine(trimmed: string): boolean {
  return /^(?:commit|merge)\b/.test(trimmed);
}

/**
 * Collect every `id:`/`tag:` value from commit/merge lines, keyed to the first
 * body line each appeared on, and flag any that recur. Shared by the
 * duplicate-id and duplicate-tag rules.
 */
function findGitGraphDuplicates(
  lines: string[],
  re: RegExp,
  describe: (value: string, first: number) => string,
): RuleFinding[] {
  const seen = new Map<string, number>();
  const findings: RuleFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('%%') || !isGitGraphNodeLine(trimmed)) continue;
    const m = re.exec(trimmed);
    if (m === null) continue;
    const value = m[1];
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, i + 1);
    } else {
      findings.push({ message: describe(value, first), line: i + 1 });
    }
  }
  return findings;
}

const gitgraphDuplicateCommitId: Rule = {
  id: 'gitgraph-duplicate-commit-id',
  appliesTo: isGitGraph,
  evaluate: ({ lines, fileLine }) =>
    findGitGraphDuplicates(
      lines,
      GITGRAPH_ID_RE,
      (value, first) =>
        `commit id \`${value}\` is used more than once (first on line ${fileLine(first)}); commit ids must be unique, and \`merge\`/\`cherry-pick\` references to it are ambiguous.`,
    ),
};

const gitgraphDuplicateTag: Rule = {
  id: 'gitgraph-duplicate-tag',
  appliesTo: isGitGraph,
  evaluate: ({ lines, fileLine }) =>
    findGitGraphDuplicates(
      lines,
      GITGRAPH_TAG_RE,
      (value, first) =>
        `tag \`${value}\` is used more than once (first on line ${fileLine(first)}); two commits render with the same tag, usually a copy-paste mistake.`,
    ),
};

const gitgraphNoCommits: Rule = {
  id: 'gitgraph-no-commits',
  appliesTo: isGitGraph,
  evaluate: ({ lines, headerLine }) => {
    const hasCommit = lines.some((l) => /^commit\b/.test(l.trim()));
    if (hasCommit) return [];
    return [
      {
        message:
          'gitGraph has no commits; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Architecture-beta helpers and rules
// ---------------------------------------------------------------------------

const ARCHITECTURE_DECL_RE =
  /^\s*(service|group|junction)\s+([A-Za-z0-9_][\w-]*)\b/;
const ARCHITECTURE_EDGE_RE =
  /^\s*([A-Za-z0-9_][\w-]*)(\{group\})?\s*:\s*([TBLR])\s*(<)?--(>)?\s*([TBLR])\s*:\s*([A-Za-z0-9_][\w-]*)(\{group\})?\s*$/;

interface ArchitectureDeclaration {
  line: number;
}

interface ArchitectureEdge {
  leftId: string;
  leftGroup: boolean;
  leftPort: string;
  operator: string;
  rightPort: string;
  rightId: string;
  rightGroup: boolean;
  line: number;
}

function isArchitecture(block: Block): boolean {
  return block.type === 'architecture-beta';
}

function collectArchitectureDeclarations(
  lines: string[],
): ArchitectureDeclaration[] {
  const declarations: ArchitectureDeclaration[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    if (ARCHITECTURE_DECL_RE.test(raw)) {
      declarations.push({ line: i + 1 });
    }
  }
  return declarations;
}

function collectArchitectureEdges(lines: string[]): ArchitectureEdge[] {
  const edges: ArchitectureEdge[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const edge = ARCHITECTURE_EDGE_RE.exec(raw);
    if (edge === null) continue;
    edges.push({
      leftId: edge[1],
      leftGroup: edge[2] === '{group}',
      leftPort: edge[3],
      operator: `${edge[4] ?? ''}--${edge[5] ?? ''}`,
      rightPort: edge[6],
      rightId: edge[7],
      rightGroup: edge[8] === '{group}',
      line: i + 1,
    });
  }
  return edges;
}

function formatArchitectureEdge(edge: ArchitectureEdge): string {
  const left = `${edge.leftId}${edge.leftGroup ? '{group}' : ''}:${edge.leftPort}`;
  const right = `${edge.rightPort}:${edge.rightId}${edge.rightGroup ? '{group}' : ''}`;
  return `${left} ${edge.operator} ${right}`;
}

const architectureNoElements: Rule = {
  id: 'architecture-no-elements',
  appliesTo: isArchitecture,
  evaluate: ({ lines, headerLine }) => {
    if (collectArchitectureDeclarations(lines).length > 0) return [];
    return [
      {
        message:
          'architecture-beta has no elements (no declared elements), groups, or junctions; it parses but renders empty.',
        line: headerLine,
      },
    ];
  },
};

const architectureNoEdges: Rule = {
  id: 'architecture-no-edges',
  appliesTo: isArchitecture,
  evaluate: ({ lines, headerLine }) => {
    if (collectArchitectureDeclarations(lines).length === 0) return [];
    if (collectArchitectureEdges(lines).length > 0) return [];
    return [
      {
        message:
          'architecture-beta declares elements but has no edges; it renders as disconnected symbols and is usually incomplete.',
        line: headerLine,
      },
    ];
  },
};

const architectureDuplicateEdge: Rule = {
  id: 'architecture-duplicate-edge',
  appliesTo: isArchitecture,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const edge of collectArchitectureEdges(lines)) {
      const key = [
        edge.leftId,
        edge.leftGroup ? 'group' : '',
        edge.leftPort,
        edge.operator,
        edge.rightPort,
        edge.rightId,
        edge.rightGroup ? 'group' : '',
      ].join('\u0000');
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, edge.line);
        continue;
      }
      findings.push({
        message: `architecture edge \`${formatArchitectureEdge(edge)}\` is declared more than once (first on line ${fileLine(first)}); repeated exact edges are usually a copy-paste mistake.`,
        line: edge.line,
      });
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// Quadrant chart helpers and rules
// ---------------------------------------------------------------------------

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

const quadrantDuplicatePoint: Rule = {
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

const quadrantNoPoints: Rule = {
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

const quadrantMissingXAxis: Rule = {
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

const quadrantMissingYAxis: Rule = {
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

const quadrantDuplicateQuadrant: Rule = {
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

const C4_DECL_RE =
  /^\s*(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemDb_Ext|Container|Container_Ext|ContainerDb|ContainerDb_Ext|ContainerQueue|ContainerQueue_Ext|Component|Component_Ext|ComponentDb|ComponentDb_Ext|ComponentQueue|ComponentQueue_Ext|Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary)\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_REL_RE =
  /^\s*(?:Bi)?Rel(?:_[A-Za-z0-9]+)?\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_UPDATE_ELEMENT_STYLE_RE =
  /^\s*UpdateElementStyle\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,/;
const C4_UPDATE_REL_STYLE_RE =
  /^\s*UpdateRelStyle\s*\(\s*([A-Za-z0-9_][\w-]*)\s*,\s*([A-Za-z0-9_][\w-]*)\s*,/;

interface C4Declaration {
  id: string;
  line: number;
}

interface C4EndpointReference {
  source: string;
  target: string;
  line: number;
}

function isC4Context(block: Block): boolean {
  return block.type === 'C4Context';
}

function collectC4Declarations(lines: string[]): C4Declaration[] {
  const declarations: C4Declaration[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const decl = C4_DECL_RE.exec(raw);
    if (decl === null) continue;
    declarations.push({ id: decl[1], line: i + 1 });
  }
  return declarations;
}

function collectC4Ids(lines: string[]): Set<string> {
  return new Set(collectC4Declarations(lines).map((decl) => decl.id));
}

function collectC4RelationshipEndpoints(
  lines: string[],
): C4EndpointReference[] {
  const references: C4EndpointReference[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const rel = C4_REL_RE.exec(raw);
    if (rel === null) continue;
    references.push({ source: rel[1], target: rel[2], line: i + 1 });
  }
  return references;
}

function collectC4RelationshipStyleEndpoints(
  lines: string[],
): C4EndpointReference[] {
  const references: C4EndpointReference[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const rel = C4_UPDATE_REL_STYLE_RE.exec(raw);
    if (rel === null) continue;
    references.push({ source: rel[1], target: rel[2], line: i + 1 });
  }
  return references;
}

const c4DuplicateId: Rule = {
  id: 'c4-duplicate-id',
  appliesTo: isC4Context,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const decl of collectC4Declarations(lines)) {
      const first = seen.get(decl.id);
      if (first === undefined) {
        seen.set(decl.id, decl.line);
      } else {
        findings.push({
          message: `C4 element or boundary id \`${decl.id}\` is declared more than once (first on line ${fileLine(first)}); C4 ids share one namespace, so duplicate declarations are ambiguous.`,
          line: decl.line,
        });
      }
    }

    return findings;
  },
};

const c4UndefinedRelationshipEndpoint: Rule = {
  id: 'c4-undefined-relationship-endpoint',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (const ref of collectC4RelationshipEndpoints(lines)) {
      if (!ids.has(ref.source)) {
        findings.push({
          message: `C4 relationship references undefined source id \`${ref.source}\`; declare the element before relating it.`,
          line: ref.line,
        });
      }
      if (!ids.has(ref.target)) {
        findings.push({
          message: `C4 relationship references undefined target id \`${ref.target}\`; declare the element before relating it.`,
          line: ref.line,
        });
      }
    }

    return findings;
  },
};

const c4UndefinedElementStyle: Rule = {
  id: 'c4-undefined-element-style',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trimStart().startsWith('%%')) continue;
      const style = C4_UPDATE_ELEMENT_STYLE_RE.exec(raw);
      if (style === null) continue;
      const id = style[1];
      if (ids.has(id)) continue;
      findings.push({
        message: `C4 UpdateElementStyle references undefined id \`${id}\`; declare the element or boundary before styling it.`,
        line: i + 1,
      });
    }

    return findings;
  },
};

const c4UndefinedRelationshipStyleEndpoint: Rule = {
  id: 'c4-undefined-relationship-style-endpoint',
  appliesTo: isC4Context,
  evaluate: ({ lines }) => {
    const ids = collectC4Ids(lines);
    const findings: RuleFinding[] = [];

    for (const ref of collectC4RelationshipStyleEndpoints(lines)) {
      if (!ids.has(ref.source)) {
        findings.push({
          message: `C4 UpdateRelStyle references undefined source id \`${ref.source}\`; declare the element before styling its relationship.`,
          line: ref.line,
        });
      }
      if (!ids.has(ref.target)) {
        findings.push({
          message: `C4 UpdateRelStyle references undefined target id \`${ref.target}\`; declare the element before styling its relationship.`,
          line: ref.line,
        });
      }
    }

    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule registry — order determines output order (behavior-preserving)
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  // First: "this will not render at all" outranks any finding about the
  // diagram's contents.
  frontmatterMustBeFirst,
  preferFlowchart,
  requireDirection,
  noExperimental,
  xychartMissingXAxis,
  xychartMissingYAxis,
  xychartNoSeries,
  xychartSeriesLengthMismatch,
  radarNoCurves,
  radarCurveLengthMismatch,
  radarDuplicateAxis,
  treemapZeroValue,
  treemapNoLeaves,
  treemapDuplicateSibling,
  treemapBranchWithValue,
  sankeyNonPositiveValue,
  sankeyDuplicateLink,
  sankeySelfLoop,
  blockNoBlocks,
  packetNoFields,
  packetEmptyLabels,
  architectureNoElements,
  architectureNoEdges,
  architectureDuplicateEdge,
  duplicateIds,
  noDuplicateNodeDeclarations,
  noDuplicateEdges,
  noSelfLoop,
  noEmptyLabels,
  noOrphanNodes,
  noActivateWithoutDeactivate,
  preferExplicitParticipants,
  sequenceDuplicateParticipant,
  classDuplicateClass,
  noDuplicateMethods,
  pieDuplicateLabel,
  pieZeroValue,
  pieNoData,
  stateDuplicateState,
  stateDuplicateTransition,
  stateEmptyComposite,
  stateSelfTransition,
  erDuplicateAttribute,
  erDuplicateEntity,
  erStandaloneEntity,
  requirementDuplicateName,
  requirementDuplicateId,
  requirementUndefinedReference,
  ganttDuplicateTaskId,
  ganttUndefinedDependency,
  ganttEmptySection,
  journeyEmptySection,
  journeyScoreOutOfRange,
  journeyTaskWithoutActor,
  journeyNoTasks,
  mindmapDuplicateSibling,
  mindmapNoNodes,
  mindmapDeepNesting,
  timelineEmptySection,
  timelineEmptyEvent,
  timelineNoEntries,
  gitgraphDuplicateCommitId,
  gitgraphDuplicateTag,
  gitgraphNoCommits,
  quadrantDuplicatePoint,
  quadrantNoPoints,
  quadrantMissingXAxis,
  quadrantMissingYAxis,
  quadrantDuplicateQuadrant,
  c4DuplicateId,
  c4UndefinedRelationshipEndpoint,
  c4UndefinedElementStyle,
  c4UndefinedRelationshipStyleEndpoint,
  wardleyUndefinedComponent,
  wardleyOrphanComponent,
  wardleyNoComponents,
  wardleyMixedCoordinateScale,
  wardleyDuplicateComponent,
  eventmodelingUndefinedFrame,
  eventmodelingDuplicateFrameId,
  eventmodelingInvalidFlow,
  kanbanDuplicateColumn,
  kanbanDuplicateTaskId,
  kanbanEmptyColumn,
  kanbanNoColumns,
  vennDuplicateSet,
  vennNonPositiveSize,
  vennSingleSet,
  vennSelfUnion,
  treeviewNoNodes,
  treeviewDuplicateSibling,
  ishikawaNoCauses,
  ishikawaEmptyCategory,
  ishikawaDeepNesting,
  ishikawaDuplicateSibling,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run every semantic rule over a parsed {@link Block} and return all findings.
 * Each rule decides its own applicability (by diagram type), reads its severity
 * from `rules` (skipping when `off`), and honors suppression directives via the
 * supplied (or freshly built) {@link SuppressionIndex}.
 *
 * @param block - The block to inspect.
 * @param rules - Resolved per-rule severities. Defaults to {@link RULE_DEFAULTS}.
 * @param index - Suppression index to consult. Callers that already built one
 *   (`blockToDiagnostics`) pass it in so directives are parsed once; direct
 *   callers get one built here.
 * @returns Any {@link SemanticWarning}s found (empty when none apply).
 * @public
 */
export function checkSemantics(
  block: Block,
  rules: ResolvedRules = RULE_DEFAULTS,
  index?: SuppressionIndex,
): SemanticWarning[] {
  const lines = block.body.split('\n');
  const suppression =
    index ?? buildSuppressionIndex(lines, block.fileDirectives);
  const header = locateHeader(lines);
  const ctx: RuleContext = {
    block,
    lines,
    headerLine: header.line,
    headerText: header.text,
    fileLine: (bodyLine) => bodyLineToFileLine(block, bodyLine),
  };
  const out: SemanticWarning[] = [];

  for (const rule of RULES) {
    const severity = rules[rule.id];
    if (severity === 'off') continue;
    if (!rule.appliesTo(block)) continue;
    for (const f of rule.evaluate(ctx)) {
      if (suppression.isSuppressed(rule.id, f.line)) continue;
      out.push({ rule: rule.id, severity, message: f.message, line: f.line });
    }
  }

  return out;
}
