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
