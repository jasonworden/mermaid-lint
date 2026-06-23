import { extractEdges } from './edges.js';
import type { Block } from './extract.js';
import {
  type EmittedSeverity,
  RULE_DEFAULTS,
  type ResolvedRules,
  type RuleId,
} from './rules.js';

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
  /** Human-readable description of the finding. */
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

/** First non-blank, non-comment line of a diagram body, or `''`. */
function firstKeywordLine(lines: string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    return trimmed;
  }
  return '';
}

function isFlowchartOrGraph(block: Block): boolean {
  return block.type === 'flowchart' || block.type === 'graph';
}

// ---------------------------------------------------------------------------
// Suppression (computed once per checkSemantics call)
// ---------------------------------------------------------------------------

interface Suppression {
  all: boolean;
  ids: Set<RuleId>;
}

function parseSuppression(lines: string[]): Suppression {
  const ids = new Set<RuleId>();
  let all = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('%%')) continue;
    const directive = trimmed.slice(2).trim();
    if (directive === 'mermaid-lint-disable') {
      all = true;
    } else if (directive.startsWith('mermaid-lint-disable ')) {
      ids.add(directive.slice('mermaid-lint-disable '.length) as RuleId);
    }
  }
  return { all, ids };
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

const preferFlowchart: Rule = {
  id: 'prefer-flowchart',
  appliesTo: (block) => block.type === 'graph',
  evaluate: ({ block }) => [
    {
      message:
        'use `flowchart` instead of `graph`: `graph` is legacy Mermaid syntax. `flowchart` is the current keyword and enables per-subgraph `direction` control.',
      line: 1,
    },
  ],
};

const requireDirection: Rule = {
  id: 'require-direction',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ block, lines }) => {
    if (DIRECTION_RE.test(firstKeywordLine(lines))) return [];
    return [
      {
        message: `\`${block.type}\` has no direction and defaults to \`TD\`. Prefer an explicit direction, e.g. \`${block.type} TD\`, to make layout intent clear.`,
        line: 1,
      },
    ];
  },
};

const noExperimental: Rule = {
  id: 'no-experimental',
  appliesTo: (block) => block.type.endsWith('-beta'),
  evaluate: ({ block }) => [
    {
      message: `\`${block.type}\` is an experimental Mermaid diagram type. Its syntax is unstable and may break on a Mermaid upgrade; prefer a stable diagram type where possible.`,
      line: 1,
    },
  ],
};

const duplicateIds: Rule = {
  id: 'duplicate-ids',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
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
            message: `node "${id}" declared with label "${prior.label}" (line ${prior.line}) and "${label}" (line ${bodyLine})`,
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
  evaluate: ({ lines }) => {
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
          message: `duplicate edge: \`${e.source}\` → \`${e.target}\` is defined more than once (first on line ${firstLine}); duplicate edges render stacked and are usually a copy-paste mistake.`,
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
const METHOD_RE = /([A-Za-z_]\w*)\s*\(([^)]*)\)/;

const noDuplicateMethods: Rule = {
  id: 'no-duplicate-methods',
  appliesTo: (block) => block.type === 'classDiagram',
  evaluate: ({ lines }) => {
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
          message: `method \`${key}\` is declared more than once on class \`${cls}\` (first on line ${firstLine}).`,
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
  evaluate: ({ lines }) => {
    const seen = new Map<string, number>(); // label -> first line
    const findings: RuleFinding[] = [];
    for (const slice of parsePieSlices(lines)) {
      const firstLine = seen.get(slice.label);
      if (firstLine === undefined) {
        seen.set(slice.label, slice.line);
      } else {
        findings.push({
          message: `pie slice "${slice.label}" is defined more than once (first on line ${firstLine}); duplicate labels render as separate slices and are usually a copy-paste mistake.`,
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
  evaluate: ({ lines }) => {
    if (parsePieSlices(lines).length > 0) return [];
    return [
      {
        message:
          'pie chart has no data slices and renders empty; add at least one `"label" : value` row.',
        line: 1,
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

const stateDuplicateTransition: Rule = {
  id: 'state-duplicate-transition',
  appliesTo: isState,
  evaluate: ({ lines }) => {
    const seen = new Map<string, number>(); // key -> first line
    const findings: RuleFinding[] = [];
    for (const t of parseStateTransitions(lines)) {
      const key = `${t.source} ${t.target} ${t.label}`;
      const firstLine = seen.get(key);
      if (firstLine === undefined) {
        seen.set(key, t.line);
      } else {
        findings.push({
          message: `duplicate transition: \`${t.source}\` → \`${t.target}\` is defined more than once (first on line ${firstLine}); duplicate transitions render stacked and are usually a copy-paste mistake.`,
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
// Rule registry — order determines output order (behavior-preserving)
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  preferFlowchart,
  requireDirection,
  noExperimental,
  duplicateIds,
  noDuplicateEdges,
  noSelfLoop,
  noEmptyLabels,
  noOrphanNodes,
  noActivateWithoutDeactivate,
  preferExplicitParticipants,
  noDuplicateMethods,
  pieDuplicateLabel,
  pieZeroValue,
  pieNoData,
  stateDuplicateTransition,
  stateEmptyComposite,
  stateSelfTransition,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run every semantic rule over a parsed {@link Block} and return all findings.
 * Each rule decides its own applicability (by diagram type), reads its severity
 * from `rules` (skipping when `off`), and honors an in-diagram
 * `%% mermaid-lint-disable [rule]` directive.
 *
 * @param block - The block to inspect.
 * @param rules - Resolved per-rule severities. Defaults to {@link RULE_DEFAULTS}.
 * @returns Any {@link SemanticWarning}s found (empty when none apply).
 * @public
 */
export function checkSemantics(
  block: Block,
  rules: ResolvedRules = RULE_DEFAULTS,
): SemanticWarning[] {
  const lines = block.body.split('\n');
  const suppression = parseSuppression(lines);
  const ctx: RuleContext = { block, lines };
  const out: SemanticWarning[] = [];

  for (const rule of RULES) {
    const severity = rules[rule.id];
    if (severity === 'off') continue;
    if (suppression.all || suppression.ids.has(rule.id)) continue;
    if (!rule.appliesTo(block)) continue;
    for (const f of rule.evaluate(ctx)) {
      out.push({ rule: rule.id, severity, message: f.message, line: f.line });
    }
  }

  return out;
}
