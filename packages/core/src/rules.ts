/**
 * The semantic-rule registry: stable rule ids, severities, their defaults, and
 * the resolution of user config into a concrete per-rule severity map.
 *
 * Severity follows Biome's model (https://biomejs.dev/linter/): it is per-rule,
 * `style` rules default to `warn`, and `error` is reserved for findings that are
 * unambiguously wrong with negligible false-positive risk. `strict` is not part
 * of resolution — it stays an exit-code/reporting concern that escalates `warn`
 * findings.
 *
 * @module
 */

/**
 * Severity a rule can be configured to: `off` disables it, `warn` reports a
 * non-fatal finding, `error` reports a finding that fails the run (exit 1)
 * regardless of `strict`.
 *
 * @public
 */
export type RuleSeverity = 'off' | 'warn' | 'error';

/**
 * The severity an emitted finding can carry — a rule resolved to `off` emits
 * nothing, so a finding is always `warn` or `error`.
 *
 * @public
 */
export type EmittedSeverity = 'warn' | 'error';

/**
 * Stable id of a semantic rule.
 *
 * @public
 */
export type RuleId =
  | 'duplicate-ids'
  | 'prefer-flowchart'
  | 'require-direction'
  | 'no-experimental'
  | 'no-duplicate-edges'
  | 'no-self-loop'
  | 'no-empty-labels'
  | 'no-orphan-nodes'
  | 'no-activate-without-deactivate'
  | 'prefer-explicit-participants'
  | 'no-duplicate-methods'
  | 'pie-duplicate-label'
  | 'pie-zero-value'
  | 'pie-no-data';

/**
 * User-facing `rules` configuration: a partial map of rule id to desired
 * severity. Omitted rules fall back to {@link RULE_DEFAULTS}.
 *
 * @public
 */
export type RulesConfig = Partial<Record<RuleId, RuleSeverity>>;

/**
 * A fully-resolved severity for every rule, as consumed by the semantic engine.
 *
 * @public
 */
export type ResolvedRules = Record<RuleId, RuleSeverity>;

/**
 * Default severity for each rule. `duplicate-ids` is `error` (a conflicting
 * duplicate id silently drops a label — wrong output); `no-duplicate-edges`,
 * `no-self-loop`, and `no-empty-labels` are advisory `warn`; `no-orphan-nodes`
 * defaults to `off` (opt-in) due to false-positive risk from subgraph-only
 * members and legend nodes; the original four are `warn` except `duplicate-ids`.
 *
 * The sequence/class rules follow the same pattern: `no-activate-without-deactivate`
 * (`warn`) catches dangling activation bars in sequence diagrams;
 * `prefer-explicit-participants` defaults to `off` because Mermaid's
 * auto-create pattern is intentional and widely used — opt in to enforce it;
 * `no-duplicate-methods` (`warn`) catches duplicate method signatures in class
 * diagrams.
 *
 * The pie rules are all advisory `warn`: `pie-duplicate-label` (two slices with
 * the same label — a copy-paste mistake), `pie-zero-value` (a `0`-valued slice
 * that renders invisibly), and `pie-no-data` (a pie chart with no slices).
 *
 * @public
 */
export const RULE_DEFAULTS: ResolvedRules = {
  'duplicate-ids': 'error',
  'prefer-flowchart': 'warn',
  'require-direction': 'warn',
  'no-experimental': 'warn',
  'no-duplicate-edges': 'warn',
  'no-self-loop': 'warn',
  'no-empty-labels': 'warn',
  'no-orphan-nodes': 'off',
  'no-activate-without-deactivate': 'warn',
  'prefer-explicit-participants': 'off',
  'no-duplicate-methods': 'warn',
  'pie-duplicate-label': 'warn',
  'pie-zero-value': 'warn',
  'pie-no-data': 'warn',
};

/** Every known rule id, derived from the defaults table. */
export const ALL_RULE_IDS = Object.keys(RULE_DEFAULTS) as RuleId[];

/**
 * Type guard for a {@link RuleSeverity} string, for validating config input.
 *
 * @param value - The value to test.
 * @returns `true` if `value` is `'off'`, `'warn'`, or `'error'`.
 * @public
 */
export function isRuleSeverity(value: unknown): value is RuleSeverity {
  return value === 'off' || value === 'warn' || value === 'error';
}

/**
 * Resolve user configuration into a concrete severity for every rule.
 *
 * - `semantic: false` is a hard override that disables every rule (it backs the
 *   `--no-semantic` flag and the `semantic: false` config key).
 * - Otherwise the user's `rules` map is layered over {@link RULE_DEFAULTS}.
 *
 * @param opts - `rules` (per-rule overrides) and `semantic` (master switch).
 * @returns A {@link ResolvedRules} with a severity for every known rule.
 * @public
 */
export function resolveRules(
  opts: {
    rules?: RulesConfig;
    semantic?: boolean;
  } = {},
): ResolvedRules {
  if (opts.semantic === false) {
    const allOff = {} as ResolvedRules;
    for (const id of ALL_RULE_IDS) allOff[id] = 'off';
    return allOff;
  }
  return { ...RULE_DEFAULTS, ...(opts.rules ?? {}) };
}
