import type { Block } from '../../extract.js';
import { type AccDescrState, scanAccDescr } from '../helpers.js';
import { stripHeaderColon } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

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
  const accDescr: AccDescrState = { open: false };
  // The `accDescr` scan reads comment-stripped lines, the same text the rest of
  // this loop sees: a bare `accDescr %% note` is still a bare `accDescr`, and
  // the block's own lookahead must agree with that.
  const stripped = lines.map(stripWardleyComment);

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const trimmed = stripped[i].trim();
    if (trimmed === '') continue;

    // Wardley takes one statement per line — `component A […] component B […]`
    // is a parse error — so nothing can follow a block's closing `}` and the
    // whole line is always consumed.
    if (scanAccDescr(accDescr, stripped, i, false) !== null) continue;

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

export const wardleyUndefinedComponent: Rule = {
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
export const wardleyOrphanComponent: Rule = {
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

export const wardleyNoComponents: Rule = {
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

export const wardleyMixedCoordinateScale: Rule = {
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
export const wardleyDuplicateComponent: Rule = {
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
