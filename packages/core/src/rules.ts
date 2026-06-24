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
  | 'pie-no-data'
  | 'state-duplicate-transition'
  | 'state-empty-composite'
  | 'state-self-transition'
  | 'er-duplicate-attribute'
  | 'er-duplicate-entity'
  | 'er-standalone-entity'
  | 'gantt-duplicate-task-id'
  | 'gantt-undefined-dependency'
  | 'gantt-empty-section'
  | 'mindmap-duplicate-sibling'
  | 'mindmap-no-nodes'
  | 'mindmap-deep-nesting'
  | 'timeline-empty-section'
  | 'timeline-empty-event'
  | 'timeline-no-entries'
  | 'gitgraph-duplicate-commit-id'
  | 'gitgraph-duplicate-tag'
  | 'gitgraph-no-commits';

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
 * The state-diagram rules: `state-duplicate-transition` (`warn`) flags an
 * identical `src --> tgt : label` transition declared twice (renders stacked, a
 * copy-paste mistake); `state-empty-composite` (`warn`) flags a `state X { }`
 * composite state with no body (renders as an empty box); `state-self-transition`
 * defaults to `off` because a state transitioning to itself is valid and common
 * in real state machines (an event handled without changing state) — opt in to
 * flag it, unlike the flowchart `no-self-loop` which is on by default.
 *
 * The ER-diagram rules: `er-duplicate-attribute` (`warn`) flags the same
 * attribute name declared twice inside one entity block; `er-duplicate-entity`
 * (`warn`) flags an entity whose attribute block is defined more than once
 * (Mermaid silently merges them — a copy-paste smell); `er-standalone-entity`
 * defaults to `off` (opt-in, like `no-orphan-nodes`) because an entity with a
 * defined block but no relationship is sometimes intentional.
 *
 * The gantt rules are all advisory `warn`: `gantt-duplicate-task-id` (two tasks
 * declared with the same explicit id — makes `after`/`until` references
 * ambiguous), `gantt-undefined-dependency` (a task whose `after`/`until`
 * references an id no task defines — Mermaid places it at the chart start),
 * and `gantt-empty-section` (a `section` with no tasks — renders as an empty
 * header).
 *
 * The mindmap rules: `mindmap-duplicate-sibling` (`warn`) flags two child nodes
 * under the same parent with identical text (renders two identical branches — a
 * copy-paste mistake); `mindmap-no-nodes` (`warn`) flags a `mindmap` with only
 * the keyword and no nodes (parses but renders an empty diagram); and
 * `mindmap-deep-nesting` defaults to `off` because nesting depth is a matter of
 * taste — opt in to flag nodes nested beyond a fixed depth threshold.
 *
 * The timeline rules are all advisory `warn`: `timeline-empty-section` (a
 * `section` with no time-period entries — renders an empty section header),
 * `timeline-empty-event` (a time period with a blank event field, e.g. a
 * trailing `:` or `: :` — renders an empty event bubble), and
 * `timeline-no-entries` (a `timeline` with no sections and no time periods —
 * parses but renders an empty diagram).
 *
 * The gitGraph rules are all advisory `warn`: `gitgraph-duplicate-commit-id`
 * (the same explicit `id:` on more than one commit — renders but makes
 * `merge`/`cherry-pick` references ambiguous), `gitgraph-duplicate-tag` (the
 * same `tag:` used twice — a copy-paste mistake), and `gitgraph-no-commits` (a
 * `gitGraph` with no commits — parses but renders an empty diagram).
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
  'state-duplicate-transition': 'warn',
  'state-empty-composite': 'warn',
  'state-self-transition': 'off',
  'er-duplicate-attribute': 'warn',
  'er-duplicate-entity': 'warn',
  'er-standalone-entity': 'off',
  'gantt-duplicate-task-id': 'warn',
  'gantt-undefined-dependency': 'warn',
  'gantt-empty-section': 'warn',
  'mindmap-duplicate-sibling': 'warn',
  'mindmap-no-nodes': 'warn',
  'mindmap-deep-nesting': 'off',
  'timeline-empty-section': 'warn',
  'timeline-empty-event': 'warn',
  'timeline-no-entries': 'warn',
  'gitgraph-duplicate-commit-id': 'warn',
  'gitgraph-duplicate-tag': 'warn',
  'gitgraph-no-commits': 'warn',
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
