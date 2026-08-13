import { declutter } from './declutter.js';
import { EXPLAIN_RULES } from './rules.js';
import type { ExplainInput, Explanation } from './rules.js';

export type { ExplainInput, Explanation } from './rules.js';

/**
 * Translate one parser failure into a message that names the defect.
 *
 * Tier 1 first: every rule in {@link EXPLAIN_RULES}, in the table's own order,
 * which is load-bearing (see the comment there) and is never re-sorted here.
 * A rule is asked to `confirm` only when its token signature matches, and the
 * first `confirm` that returns an explanation wins outright — its suggestion
 * and `fixable` flag included.
 *
 * When every rule either fails to match or declines, Tier 2 declutters
 * mermaid's own wording instead. Declining is cheap by design; that is what
 * lets a rule refuse to guess.
 *
 * Pure: no mermaid import, no filesystem, no side effects. Everything it reads
 * about the failure is in `input`.
 *
 * @internal
 */
export function explainParseError(input: ExplainInput): Explanation {
  // The line mermaid blamed, which is what `confirm` re-reads. Absent when the
  // signal chain resolved no position — rules that need the source then see an
  // empty line and decline, which is the correct outcome.
  const sourceLine =
    input.line === undefined
      ? ''
      : (input.body.split('\n')[input.line - 1] ?? '');

  for (const rule of EXPLAIN_RULES) {
    if (!rule.matches(input)) continue;
    const explanation = rule.confirm(sourceLine, input);
    if (explanation !== undefined) return explanation;
  }

  return declutter(input);
}
