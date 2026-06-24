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
  evaluate: ({ lines }) => {
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
          message: `attribute \`${name}\` is declared more than once on entity \`${entity}\` (first on line ${first}).`,
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
  evaluate: ({ lines }) => {
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
          message: `entity \`${entity}\` has its attribute block defined more than once (first on line ${first}); Mermaid merges them, so this is usually a copy-paste mistake.`,
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

// ---------------------------------------------------------------------------
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
  evaluate: ({ lines }) => {
    const seen = new Map<string, number>(); // id -> first line
    const findings: RuleFinding[] = [];
    for (const task of parseGanttTasks(lines)) {
      if (task.id === null) continue;
      const first = seen.get(task.id);
      if (first === undefined) {
        seen.set(task.id, task.line);
      } else {
        findings.push({
          message: `task id \`${task.id}\` is defined more than once (first on line ${first}); \`after\`/\`until\` references to it are ambiguous.`,
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

/** Count of leading whitespace characters (each counts as one column). */
function indentWidth(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
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
  evaluate: ({ lines }) => {
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
          message: `mindmap node \`${node.text}\` duplicates a sibling (first on line ${first}); two identical branches render under the same parent.`,
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
  evaluate: ({ lines }) => {
    if (parseMindmapNodes(lines).length > 0) return [];
    return [
      {
        message:
          'mindmap has no nodes; it parses but renders as an empty diagram.',
        line: 1,
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
  evaluate: ({ lines }) => {
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
        line: 1,
      },
    ];
  },
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
  erDuplicateAttribute,
  erDuplicateEntity,
  erStandaloneEntity,
  ganttDuplicateTaskId,
  ganttUndefinedDependency,
  ganttEmptySection,
  mindmapDuplicateSibling,
  mindmapNoNodes,
  mindmapDeepNesting,
  timelineEmptySection,
  timelineEmptyEvent,
  timelineNoEntries,
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
