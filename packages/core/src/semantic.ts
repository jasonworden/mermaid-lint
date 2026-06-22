import type { Block } from './extract.js';
import {
  type EmittedSeverity,
  RULE_DEFAULTS,
  type ResolvedRules,
  type RuleId,
  type RuleSeverity,
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

/** Whether `lines` carries a `%% mermaid-lint-disable [rule]` directive. */
function isSuppressed(lines: string[], rule: RuleId): boolean {
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('%%')) continue;
    const directive = trimmed.slice(2).trim();
    if (directive === 'mermaid-lint-disable') return true;
    if (directive === `mermaid-lint-disable ${rule}`) return true;
  }
  return false;
}

/**
 * Resolve whether a rule is active for these lines, returning its emitted
 * severity, or `null` if it is `off` or suppressed in-diagram.
 */
function activeSeverity(
  rules: ResolvedRules,
  lines: string[],
  rule: RuleId,
): EmittedSeverity | null {
  const severity: RuleSeverity = rules[rule];
  if (severity === 'off') return null;
  if (isSuppressed(lines, rule)) return null;
  return severity;
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

function checkDuplicateIds(
  block: Block,
  lines: string[],
  rules: ResolvedRules,
): SemanticWarning[] {
  if (block.type !== 'flowchart' && block.type !== 'graph') return [];
  const severity = activeSeverity(rules, lines, 'duplicate-ids');
  if (severity === null) return [];

  const seen = new Map<string, { label: string; line: number }>();
  const warnings: SemanticWarning[] = [];

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
        warnings.push({
          rule: 'duplicate-ids',
          message: `node "${id}" declared with label "${prior.label}" (line ${prior.line}) and "${label}" (line ${bodyLine})`,
          line: bodyLine,
          severity,
        });
      }
    }
  }

  return warnings;
}

function checkPreferFlowchart(
  block: Block,
  lines: string[],
  rules: ResolvedRules,
): SemanticWarning[] {
  if (block.type !== 'graph') return [];
  const severity = activeSeverity(rules, lines, 'prefer-flowchart');
  if (severity === null) return [];
  return [
    {
      rule: 'prefer-flowchart',
      message:
        'use `flowchart` instead of `graph`: `graph` is legacy Mermaid syntax. `flowchart` is the current keyword and enables per-subgraph `direction` control.',
      line: 1,
      severity,
    },
  ];
}

function checkRequireDirection(
  block: Block,
  lines: string[],
  rules: ResolvedRules,
): SemanticWarning[] {
  if (block.type !== 'flowchart' && block.type !== 'graph') return [];
  const severity = activeSeverity(rules, lines, 'require-direction');
  if (severity === null) return [];
  if (DIRECTION_RE.test(firstKeywordLine(lines))) return [];
  return [
    {
      rule: 'require-direction',
      message: `\`${block.type}\` has no direction and defaults to \`TD\`. Prefer an explicit direction, e.g. \`${block.type} TD\`, to make layout intent clear.`,
      line: 1,
      severity,
    },
  ];
}

function checkNoExperimental(
  block: Block,
  lines: string[],
  rules: ResolvedRules,
): SemanticWarning[] {
  if (!block.type.endsWith('-beta')) return [];
  const severity = activeSeverity(rules, lines, 'no-experimental');
  if (severity === null) return [];
  return [
    {
      rule: 'no-experimental',
      message: `\`${block.type}\` is an experimental Mermaid diagram type. Its syntax is unstable and may break on a Mermaid upgrade; prefer a stable diagram type where possible.`,
      line: 1,
      severity,
    },
  ];
}

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
  return [
    ...checkPreferFlowchart(block, lines, rules),
    ...checkRequireDirection(block, lines, rules),
    ...checkNoExperimental(block, lines, rules),
    ...checkDuplicateIds(block, lines, rules),
  ];
}
