import { type Block, bodyLineToFileLine } from '../extract.js';
import { locateHeader } from '../header.js';
import {
  type EmittedSeverity,
  RULE_DEFAULTS,
  type ResolvedRules,
  type RuleId,
} from '../rules.js';
import { type SuppressionIndex, buildSuppressionIndex } from '../suppress.js';
import { RULES } from './registry.js';
import type { RuleContext } from './types.js';

// Re-exported for the rule tests, which drive these parsers directly
// rather than through `checkSemantics`.
export { parseEventModeling } from './rules/eventmodeling.js';
export { parseWardley } from './rules/wardley.js';

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
