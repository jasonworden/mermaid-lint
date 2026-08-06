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
  | 'xychart-missing-x-axis'
  | 'xychart-missing-y-axis'
  | 'xychart-no-series'
  | 'xychart-series-length-mismatch'
  | 'radar-no-curves'
  | 'radar-curve-length-mismatch'
  | 'radar-duplicate-axis'
  | 'treemap-zero-value'
  | 'treemap-no-leaves'
  | 'treemap-duplicate-sibling'
  | 'treemap-branch-with-value'
  | 'sankey-non-positive-value'
  | 'sankey-duplicate-link'
  | 'sankey-self-loop'
  | 'block-no-blocks'
  | 'packet-no-fields'
  | 'packet-empty-labels'
  | 'architecture-no-elements'
  | 'architecture-no-edges'
  | 'architecture-duplicate-edge'
  | 'no-duplicate-edges'
  | 'no-self-loop'
  | 'no-empty-labels'
  | 'no-orphan-nodes'
  | 'no-duplicate-node-declarations'
  | 'no-activate-without-deactivate'
  | 'prefer-explicit-participants'
  | 'sequence-duplicate-participant'
  | 'class-duplicate-class'
  | 'no-duplicate-methods'
  | 'pie-duplicate-label'
  | 'pie-zero-value'
  | 'pie-no-data'
  | 'state-duplicate-state'
  | 'state-duplicate-transition'
  | 'state-empty-composite'
  | 'state-self-transition'
  | 'er-duplicate-attribute'
  | 'er-duplicate-entity'
  | 'er-standalone-entity'
  | 'gantt-duplicate-task-id'
  | 'gantt-undefined-dependency'
  | 'gantt-empty-section'
  | 'requirement-duplicate-name'
  | 'requirement-duplicate-id'
  | 'requirement-undefined-reference'
  | 'journey-empty-section'
  | 'journey-score-out-of-range'
  | 'journey-task-without-actor'
  | 'journey-no-tasks'
  | 'mindmap-duplicate-sibling'
  | 'mindmap-no-nodes'
  | 'mindmap-deep-nesting'
  | 'timeline-empty-section'
  | 'timeline-empty-event'
  | 'timeline-no-entries'
  | 'gitgraph-duplicate-commit-id'
  | 'gitgraph-duplicate-tag'
  | 'gitgraph-no-commits'
  | 'quadrant-duplicate-point'
  | 'quadrant-no-points'
  | 'quadrant-missing-x-axis'
  | 'quadrant-missing-y-axis'
  | 'quadrant-duplicate-quadrant'
  | 'c4-duplicate-id'
  | 'c4-undefined-relationship-endpoint'
  | 'c4-undefined-element-style'
  | 'c4-undefined-relationship-style-endpoint'
  | 'wardley-undefined-component'
  | 'wardley-orphan-component'
  | 'wardley-no-components'
  | 'wardley-mixed-coordinate-scale'
  | 'wardley-duplicate-component'
  | 'eventmodeling-undefined-frame'
  | 'eventmodeling-duplicate-frame-id'
  | 'eventmodeling-invalid-flow'
  | 'kanban-duplicate-column'
  | 'kanban-duplicate-task-id'
  | 'kanban-empty-column'
  | 'kanban-no-columns'
  | 'venn-duplicate-set'
  | 'venn-non-positive-size'
  | 'venn-single-set'
  | 'venn-self-union'
  | 'venn-no-sets'
  | 'venn-duplicate-union'
  | 'treeview-no-nodes'
  | 'treeview-duplicate-sibling'
  | 'ishikawa-no-causes'
  | 'ishikawa-empty-category'
  | 'ishikawa-deep-nesting'
  | 'ishikawa-duplicate-sibling'
  | 'frontmatter-must-be-first'
  | 'suppression-unknown-rule'
  | 'suppression-unused'
  | 'suppression-malformed';

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
 * Scope labels used in docs/semantic-rules.md's Rule Reference table.
 *
 * @internal
 */
export type RuleDocsScope =
  | 'all'
  | 'architecture-beta'
  | 'block-beta'
  | 'classDiagram'
  | 'C4Context'
  | 'erDiagram'
  | 'eventmodeling'
  | 'flowchart / graph'
  | 'gantt'
  | 'gitGraph'
  | 'graph'
  | 'ishikawa-beta'
  | 'journey'
  | 'kanban'
  | 'mindmap'
  | 'packet-beta'
  | 'pie'
  | 'quadrantChart'
  | 'radar-beta'
  | 'requirementDiagram'
  | 'sankey-beta'
  | 'sequenceDiagram'
  | 'stateDiagram'
  | 'timeline'
  | 'treemap-beta'
  | 'treeView-beta'
  | 'venn-beta'
  | 'wardley-beta'
  | 'xychart-beta';

/**
 * Diagram keywords used by README.md's Diagram types table.
 *
 * @internal
 */
export type ReadmeDiagramKeyword =
  | 'architecture-beta'
  | 'block-beta'
  | 'C4Context'
  | 'classDiagram'
  | 'erDiagram'
  | 'eventmodeling'
  | 'flowchart'
  | 'gantt'
  | 'gitGraph'
  | 'graph'
  | 'ishikawa-beta'
  | 'journey'
  | 'kanban'
  | 'mindmap'
  | 'packet-beta'
  | 'pie'
  | 'quadrantChart'
  | 'radar-beta'
  | 'requirementDiagram'
  | 'sankey-beta'
  | 'sequenceDiagram'
  | 'stateDiagram-v2'
  | 'timeline'
  | 'treemap-beta'
  | 'treeView-beta'
  | 'venn-beta'
  | 'wardley-beta'
  | 'xychart-beta';

/**
 * Documentation metadata for a semantic rule.
 *
 * @internal
 */
export interface RuleMetadata {
  /** Default severity for the rule. */
  defaultSeverity: RuleSeverity;
  /** Exact Scope label expected in docs/semantic-rules.md. */
  docsScope: RuleDocsScope;
  /** README Diagram types keywords whose Related rules cell should list it. */
  readmeDiagramKeywords: readonly ReadmeDiagramKeyword[];
}

/**
 * Internal metadata for each rule. This is the source of truth for the public
 * {@link RULE_DEFAULTS} map and for documentation coverage tests.
 * `duplicate-ids` is `error` (a conflicting
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
 * The requirement-diagram rules are all advisory `warn`:
 * `requirement-duplicate-name` (the same requirement/element name defined more
 * than once — relationships and styling target names, so duplicates are
 * ambiguous), `requirement-duplicate-id` (the same requirement `id:` used more
 * than once), and `requirement-undefined-reference` (a relationship endpoint
 * whose requirement/element name is never defined in the diagram).
 *
 * The journey rules are all advisory `warn`: `journey-empty-section` (a
 * `section` with no tasks — renders as an empty section header),
 * `journey-score-out-of-range` (a task happiness score outside Mermaid's
 * documented 1-5 range), and `journey-no-tasks` (a `journey` with no tasks —
 * parses but renders an empty diagram).
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
 * The architecture-beta rules are all advisory `warn`:
 * `architecture-no-elements` (a diagram with no declared services, groups, or
 * junctions — parses but renders empty), `architecture-no-edges` (declared
 * symbols but no connections — usually incomplete), and
 * `architecture-duplicate-edge` (the same architecture connection repeated
 * between the same endpoints and ports — a copy-paste smell).
 *
 * The packet-beta rules are all advisory `warn`: `packet-no-fields` (a packet
 * with no field rows — parses but renders empty) and `packet-empty-labels`
 * (a field label that is empty or whitespace-only, which renders blank).
 *
 * The sankey-beta rules are all advisory `warn`: `sankey-duplicate-link`
 * (the same source/target link row repeated — usually a copy-paste mistake)
 * and `sankey-self-loop` (a row whose source and target are the same after
 * trimming, which is usually accidental).
 *
 * The xychart-beta rules are all advisory `warn`: `xychart-no-series`
 * (an xychart-beta with no `bar` or `line` rows — parses but renders no data)
 * and `xychart-series-length-mismatch` (a categorical x-axis list whose label
 * count does not match a bar/line series item count).
 *
 * The radar-beta rules are all advisory `warn`: `radar-no-curves` (axes but no
 * `curve` rows — renders an empty grid, the analogue of `xychart-no-series`),
 * `radar-curve-length-mismatch` (a positional curve whose value count does not
 * match the declared axis count, which renders a misaligned polygon), and
 * `radar-duplicate-axis` (two spokes rendering the same label). The length rule
 * deliberately skips the keyed `{axis: value}` curve form: Mermaid rejects an
 * incomplete keyed curve as a parse error, so there is nothing left to warn
 * about. A negative curve value is likewise not a rule — Mermaid's lexer
 * rejects it.
 *
 * The treemap-beta rules are all advisory `warn`: `treemap-zero-value` (a leaf
 * whose value is `0`, which renders as a zero-area rectangle — the analogue of
 * `pie-zero-value`), `treemap-no-leaves` (no row carries a `: value`, so the
 * diagram has no area to draw), `treemap-duplicate-sibling` (two rows rendering
 * the same label under one parent, the analogue of `mindmap-duplicate-sibling`),
 * and `treemap-branch-with-value` (a row that carries a value *and* has rows
 * indented under it — Mermaid types any valued row as a leaf and never nests
 * under it, so those rows silently re-parent). The zero rule is deliberately
 * narrower than `sankey-non-positive-value`: `sankey-beta` accepts a negative
 * link value, but a negative treemap value dies in the lexer, so only the zero
 * half is reachable here.
 *
 * The quadrantChart rules are all advisory `warn`: `quadrant-duplicate-point`
 * (two data points with the same label — renders overlapping markers, usually
 * a copy-paste mistake), `quadrant-no-points` (a quadrantChart with axis or
 * quadrant labels but no data points — parses but renders an empty plot, the
 * analogue of `pie-no-data`), and `quadrant-duplicate-quadrant` (the same
 * quadrant region — `quadrant-1` through `quadrant-4` — labeled more than once;
 * Mermaid silently keeps the last, dropping the earlier label). A point whose
 * x/y is outside `[0, 1]` is intentionally *not* a rule here: Mermaid's grammar
 * rejects it as a syntax error, so the parser already catches it.
 *
 * The experimental-diagram rules are all advisory `warn`: the xychart rules
 * catch missing axes, missing series, and length mismatches Mermaid accepts;
 * the sankey rules catch non-positive link values and self-loops; and the
 * block/packet/architecture rules flag parser-valid diagrams that otherwise
 * render empty.
 *
 * The wardley-beta rules cover the coordinate space and reference integrity,
 * the two things a Wardley map can get wrong while still parsing.
 * `wardley-undefined-component` (`warn`) catches a link endpoint or `evolve`
 * target naming a component that was never declared — mermaid drops both
 * silently, the renderer filtering links whose endpoints have no position and
 * populateDb skipping an unresolvable `evolve`. It deliberately ignores the
 * `pipeline <parent>` reference, which mermaid validates itself.
 *
 * `wardley-orphan-component` (`off`) reports a component no link, `evolve`, or
 * pipeline reaches. It defaults to `off` for the same reason as
 * `no-orphan-nodes`: an isolated component is a legitimate thing to put on a
 * Wardley map. Anchors are excluded — they are user-need markers that stand
 * alone by design.
 *
 * `wardley-no-components` (`warn`) is the analogue of `radar-no-curves`: a map
 * with neither a `component` nor an `anchor` renders as an empty grid. Notes
 * and accelerators do not count — components and anchors are the two rows that
 * become nodes.
 *
 * `wardley-mixed-coordinate-scale` (`warn`) replaces the coordinate rule issue
 * #129 proposed. Mermaid's `toPercent` reads a value at or below 1 as a 0-1
 * fraction and anything above it as a 0-100 percentage, throwing past 100, and
 * its coordinate terminals reject a sign outright and accept a bare integer
 * only for `annotations` / `annotation`, where that same range check catches it
 * — so nothing can land outside the unit square and still parse, and an
 * out-of-range rule has nothing to catch. What is left is the ambiguity: a map
 * that spells some coordinates one way and some the other has at least one
 * value that does not mean what its author intended. The finding points at
 * the minority spelling, ties going to the percentage form, since 0-1
 * decimals are the canonical Wardley notation.
 *
 * `wardley-duplicate-component` (`warn`) keys on the shared component/anchor
 * namespace, because that is the namespace Mermaid itself uses: both register
 * through `addNode` under their bare name, and the builder merges by id, so a
 * repeated name collapses into one node with the last coordinates winning.
 * Pipeline members are exempt — their id is synthetic (`parent_child`), so they
 * cannot collide with a top-level component. `warn` rather than `error`,
 * since a restatement is occasionally deliberate and the last-wins behavior is
 * well defined even when it surprises.
 *
 * The eventmodeling rules cover the same two families of mistake as the
 * wardley-beta ones — reference integrity and reachability — plus one more
 * that mermaid ships a validator for but never runs.
 * `eventmodeling-undefined-frame` catches a `->>` naming a frame id that no
 * frame declares; Mermaid drops the relation silently rather than reporting
 * an error (render probe, mermaid 11.15.0: the relation `<path>` count goes
 * from 1 to 0), so the arrow the author wrote never appears. It is `error`
 * rather than `warn` — the one departure from the all-`warn` precedent set by
 * the other diagram-type rules — because an undeclared source meets the bar
 * above: it is unambiguously wrong and renders nothing, the same class of
 * certainty as `frontmatter-must-be-first`.
 *
 * `eventmodeling-duplicate-frame-id` (`warn`) catches two frames sharing an
 * id. `tf` and `rf` declare into one shared id namespace, so a mixed pair
 * collides just as two `tf`s would. Mermaid renders every frame with the id
 * and matches a later `->> <id>` against all of them, drawing a duplicate
 * arrow per matching frame instead of the single one intended.
 *
 * `eventmodeling-invalid-flow` (`warn`) catches a frame sourced from a type
 * mermaid's own `EventModelingValidator` forbids: `cmd`/`command` may only be
 * sourced from `ui` or `pcr`/`processor`; `evt`/`event` from `cmd`/`command`;
 * `rmo`/`readmodel` from `evt`/`event`; `pcr`/`processor` from
 * `rmo`/`readmodel`; and `ui` from `rmo`/`readmodel`. Mermaid ships that
 * validator but never runs it at parse time, so nothing reports the
 * violation without this rule.
 *
 * The kanban rules key on the single id namespace mermaid gives the type:
 * columns and cards both register through `addNode` and both surface their id
 * as a DOM id, `<svg-id>-<node-id>`. A node's id is its explicit id
 * (`t1[Card]`), or the text itself when written bare — never its label, so two
 * columns *labelled* `Todo` under distinct ids do not collide.
 *
 * The two duplicate rules split that namespace by the *offending* declaration
 * rather than by the pair of kinds involved, so all four collision directions
 * land with exactly one rule: `kanban-duplicate-column` (`warn`) reports any
 * column whose id is already taken, `kanban-duplicate-task-id` (`warn`) any
 * card. Both nodes always render — nothing in a kanban references a node id, so
 * no relation is lost — and the shared consequence is a document carrying one
 * DOM id twice, which breaks `getElementById`, `#id` selectors, fragment links,
 * and click handlers.
 *
 * Two *columns* is the severe case, and the only one whose damage goes past the
 * id: `getData` gives each colliding column every card whose `parentId`
 * matches, and the renderer then re-filters that already-duplicated list per
 * column, so every card is drawn many times over and appears in columns its
 * author never put it in (render probe, mermaid 11.15.0: two `Todo` columns
 * holding one card each draw four copies of each card).
 *
 * `kanban-empty-column` (`warn`) catches a column with no cards, which renders
 * as a header over empty space — the kanban counterpart of
 * `gantt-empty-section` and `journey-empty-section`.
 *
 * `kanban-no-columns` (`warn`) catches a board with no columns at all, which
 * renders as an empty diagram — the counterpart of `mindmap-no-nodes` and
 * `wardley-no-components`. #149 ruled this rule out on the grounds that an
 * empty kanban is already a parse error; it is not. `kanban\n` parses clean,
 * as do a body of blank lines and one of only `%%` comments. Only `kanban`
 * with no trailing newline fails, which is a jison artifact no fenced or
 * `.mmd` diagram produces. Note that kanban's grammar has no `title` token,
 * so `title Board` declares an ordinary column and this rule stays silent on
 * it — pinned in `mermaid-behavior.test.ts`, since a bump that added the
 * keyword would turn that into a false negative.
 *
 * The ishikawa-beta rules cover the fishbone's structure, which its db never
 * validates — `addNode` normalizes an indent and clamps it, and nothing else.
 * `ishikawa-no-causes` (`warn`) flags a problem with no categories under it:
 * the renderer draws the head, then a spine of *zero* length, so the diagram is
 * a label and nothing more. `ishikawa-empty-category` (`warn`) flags a category
 * with no causes, which draws its bone at one-fifth length (`lineLen = length *
 * (children.length ? 1 : 0.2)`) — a labeled stub. It is scoped to categories
 * because a childless *cause* is a leaf, which is the point of the diagram.
 * `ishikawa-duplicate-sibling` (`warn`) is the analogue of
 * `mindmap-duplicate-sibling`. `ishikawa-deep-nesting` follows
 * `mindmap-deep-nesting` in defaulting to `off`: seven levels render fine, they
 * just stop communicating, and a rule that is a matter of taste should not warn
 * by default.
 *
 * An empty `ishikawa-beta` is *not* covered, though it is reachable on exactly
 * the terms `kanban-no-columns` above was: `ishikawa-beta\n` parses clean and
 * only the no-trailing-newline form fails. #147 excludes it, so it is left for
 * the same follow-up treatment kanban got rather than widened into here;
 * `mermaid-behavior.test.ts` pins the parse so the exclusion stays a choice.
 *
 * The venn-beta rules are advisory `warn` apart from `venn-no-sets`. Three of
 * the six turn on the one thing `vennDB` does not do: `addSubsetData` pushes
 * onto `subsets` without ever deduplicating, either across statements or
 * within one identifier list.
 *
 * `venn-duplicate-set` catches the same set declared twice. The second push
 * adds a circle rather than replacing the first — render probe, mermaid
 * 11.15.0: a two-set diagram goes from 3 regions to 4, the extra one drawn
 * coincident with the original, so nothing looks wrong until the styling or
 * the label does. The label is where it bites: `addSubsetData` records each
 * declaration's own label, but both circles draw the *last* one, so
 * `set A["First"]` followed by `set A["Second"]` renders `Second` twice and
 * `First` nowhere. Identifiers are compared after `normalizeText`, which
 * strips surrounding double quotes, so `set "A"` and `set A` collide.
 *
 * `venn-non-positive-size` catches an explicit `: value` of zero or less, on
 * either a `set` or a `union` — the venn counterpart of `pie-zero-value` and
 * `sankey-non-positive-value`. Unlike treemap, a sign survives the lexer
 * (`NUMERIC` is `[+-]?…`), so both halves are reachable, and each of the four
 * cases is a defect: a zero-sized set erases itself *and* every union over it
 * (3 regions to 1, logging `area A,B not represented on screen`); a
 * zero-sized union parks its label off-canvas; a negative set size distorts
 * the geometry; and a negative union size throws out of the layout, so
 * nothing renders at all.
 *
 * `venn-single-set` catches a diagram declaring one distinct set. It renders —
 * one circle, correctly — but a Venn diagram with nothing to intersect states
 * nothing a label could not, so this is advisory in the spirit of
 * `er-standalone-entity`.
 *
 * `venn-self-union` catches an identifier repeated inside one `union`, as in
 * `union A, A`. The list is sorted but never deduplicated, so the pair reaches
 * the layout as a genuine two-element subset and draws a spurious extra region
 * over the set's own circle. It is the venn counterpart of `sankey-self-loop`.
 * A union naming an *undeclared* set is deliberately not a rule here:
 * `vennDB.validateUnionIdentifiers` throws `unknown set identifier: …`, and it
 * validates in source order, so a forward reference is already an error too —
 * both are the syntax pass's, not ours.
 *
 * `venn-no-sets` catches a body declaring no `set` at all — `venn-beta` alone,
 * or carrying only a `title`, a `style`, or comments. It is the only no-data
 * rule whose subject does not render: `pie-no-data`, `treemap-no-leaves`,
 * `quadrant-no-points`, and `packet-no-fields` each render an empty frame,
 * whereas venn's renderer reaches into an undefined layout and throws
 * `Cannot read properties of undefined (reading 'set')` — render probe,
 * mermaid 11.15.0. That is the `error` criterion below, so this rule is
 * `error`. A body with a `union` but no `set` never gets here:
 * `validateUnionIdentifiers` throws `unknown set identifier: …` in the syntax
 * pass, so "no sets" and "no statements" coincide.
 *
 * `venn-duplicate-union` catches the same intersection declared twice, and is
 * the venn counterpart of `sankey-duplicate-link`. `addSubsetData` sorts each
 * identifier list but never deduplicates across statements, so `union B, A`
 * collides with `union A, B` as surely as a verbatim repeat does — render
 * probe: a two-set diagram goes from 3 regions to 4 either way, the extra one
 * drawn over the original. As with `venn-duplicate-set` the label is where it
 * bites, and it is the last *label-bearing* declaration that wins: both
 * regions draw it, so `union A, B["First"]` followed by `union A, B["Second"]`
 * renders `Second` twice and `First` nowhere. Sizes do not merge either — two
 * `: value`s for one region both reach the layout solver as constraints on the
 * same area. Identifiers are compared after `normalizeText` (so `union "A", B`
 * collides with `union A, B`) but are case-sensitive, since mermaid never
 * folds case: `set a` and `set A` are two sets, and the unions over them are
 * two unions.
 *
 * The treeView-beta rules are both advisory `warn`. `treeview-no-nodes` flags
 * a bare `treeView-beta` header, which parses clean and renders the synthetic
 * `/` root and nothing else. It is not the only reachable empty-diagram case
 * in the #131 batch, as this paragraph once claimed: `kanban-no-columns`
 * above covers the same shape, and an empty `ishikawa-beta` parses too — only
 * the no-trailing-newline form of either dies in the lexer, which no fenced or
 * `.mmd` diagram is. `treeview-duplicate-sibling` is the direct analogue of
 * `mindmap-duplicate-sibling` — two identical labels under one parent both
 * render, so the tree claims a distinction it does not draw.
 *
 * Both key on quoted labels, because that is all the grammar accepts: a bare
 * `root` after the header is a lexer error, not a node.
 *
 * #148 also proposed a `treeview-indent-jump` rule and asked for a call on it.
 * It is not implemented, because the defect it describes is not observable.
 * mermaid's `addNode` takes the indent as a raw *character count* and pops a
 * stack while `level <= top.level`, so any strictly-greater indent is exactly
 * one level deeper and the magnitude is discarded: indenting a child by three
 * "levels" renders byte-for-byte identically to indenting it by one (render
 * probe, mermaid 11.15.0). There is no grammatical indent unit to measure a
 * jump against, so a rule would have to infer one from the rest of the body —
 * which the mindmap, treemap, and kanban rules all decline to do.
 *
 * `frontmatter-must-be-first` is `error`, joining `duplicate-ids`,
 * `eventmodeling-undefined-frame`, and `venn-no-sets` as the only
 * non-advisory rules: a diagram whose frontmatter is preceded by anything does
 * not render at all, so there is no judgment call to defer to the user.
 *
 * @internal
 */
export const RULE_METADATA = {
  'duplicate-ids': {
    defaultSeverity: 'error',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'prefer-flowchart': {
    defaultSeverity: 'warn',
    docsScope: 'graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'require-direction': {
    defaultSeverity: 'warn',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-experimental': {
    defaultSeverity: 'warn',
    docsScope: 'all',
    readmeDiagramKeywords: [
      'xychart-beta',
      'sankey-beta',
      'block-beta',
      'packet-beta',
      'architecture-beta',
      'radar-beta',
      'treemap-beta',
      'venn-beta',
      'ishikawa-beta',
      'wardley-beta',
      'treeView-beta',
    ],
  },
  'xychart-missing-x-axis': {
    defaultSeverity: 'warn',
    docsScope: 'xychart-beta',
    readmeDiagramKeywords: ['xychart-beta'],
  },
  'xychart-missing-y-axis': {
    defaultSeverity: 'warn',
    docsScope: 'xychart-beta',
    readmeDiagramKeywords: ['xychart-beta'],
  },
  'xychart-no-series': {
    defaultSeverity: 'warn',
    docsScope: 'xychart-beta',
    readmeDiagramKeywords: ['xychart-beta'],
  },
  'xychart-series-length-mismatch': {
    defaultSeverity: 'warn',
    docsScope: 'xychart-beta',
    readmeDiagramKeywords: ['xychart-beta'],
  },
  'radar-no-curves': {
    defaultSeverity: 'warn',
    docsScope: 'radar-beta',
    readmeDiagramKeywords: ['radar-beta'],
  },
  'radar-curve-length-mismatch': {
    defaultSeverity: 'warn',
    docsScope: 'radar-beta',
    readmeDiagramKeywords: ['radar-beta'],
  },
  'radar-duplicate-axis': {
    defaultSeverity: 'warn',
    docsScope: 'radar-beta',
    readmeDiagramKeywords: ['radar-beta'],
  },
  'treemap-zero-value': {
    defaultSeverity: 'warn',
    docsScope: 'treemap-beta',
    readmeDiagramKeywords: ['treemap-beta'],
  },
  'treemap-no-leaves': {
    defaultSeverity: 'warn',
    docsScope: 'treemap-beta',
    readmeDiagramKeywords: ['treemap-beta'],
  },
  'treemap-duplicate-sibling': {
    defaultSeverity: 'warn',
    docsScope: 'treemap-beta',
    readmeDiagramKeywords: ['treemap-beta'],
  },
  'treemap-branch-with-value': {
    defaultSeverity: 'warn',
    docsScope: 'treemap-beta',
    readmeDiagramKeywords: ['treemap-beta'],
  },
  'sankey-non-positive-value': {
    defaultSeverity: 'warn',
    docsScope: 'sankey-beta',
    readmeDiagramKeywords: ['sankey-beta'],
  },
  'sankey-duplicate-link': {
    defaultSeverity: 'warn',
    docsScope: 'sankey-beta',
    readmeDiagramKeywords: ['sankey-beta'],
  },
  'sankey-self-loop': {
    defaultSeverity: 'warn',
    docsScope: 'sankey-beta',
    readmeDiagramKeywords: ['sankey-beta'],
  },
  'block-no-blocks': {
    defaultSeverity: 'warn',
    docsScope: 'block-beta',
    readmeDiagramKeywords: ['block-beta'],
  },
  'packet-no-fields': {
    defaultSeverity: 'warn',
    docsScope: 'packet-beta',
    readmeDiagramKeywords: ['packet-beta'],
  },
  'packet-empty-labels': {
    defaultSeverity: 'warn',
    docsScope: 'packet-beta',
    readmeDiagramKeywords: ['packet-beta'],
  },
  'architecture-no-elements': {
    defaultSeverity: 'warn',
    docsScope: 'architecture-beta',
    readmeDiagramKeywords: ['architecture-beta'],
  },
  'architecture-no-edges': {
    defaultSeverity: 'warn',
    docsScope: 'architecture-beta',
    readmeDiagramKeywords: ['architecture-beta'],
  },
  'architecture-duplicate-edge': {
    defaultSeverity: 'warn',
    docsScope: 'architecture-beta',
    readmeDiagramKeywords: ['architecture-beta'],
  },
  'no-duplicate-edges': {
    defaultSeverity: 'warn',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-self-loop': {
    defaultSeverity: 'warn',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-empty-labels': {
    defaultSeverity: 'warn',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-orphan-nodes': {
    defaultSeverity: 'off',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-duplicate-node-declarations': {
    defaultSeverity: 'warn',
    docsScope: 'flowchart / graph',
    readmeDiagramKeywords: ['flowchart', 'graph'],
  },
  'no-activate-without-deactivate': {
    defaultSeverity: 'warn',
    docsScope: 'sequenceDiagram',
    readmeDiagramKeywords: ['sequenceDiagram'],
  },
  'prefer-explicit-participants': {
    defaultSeverity: 'off',
    docsScope: 'sequenceDiagram',
    readmeDiagramKeywords: ['sequenceDiagram'],
  },
  'sequence-duplicate-participant': {
    defaultSeverity: 'warn',
    docsScope: 'sequenceDiagram',
    readmeDiagramKeywords: ['sequenceDiagram'],
  },
  'class-duplicate-class': {
    defaultSeverity: 'warn',
    docsScope: 'classDiagram',
    readmeDiagramKeywords: ['classDiagram'],
  },
  'no-duplicate-methods': {
    defaultSeverity: 'warn',
    docsScope: 'classDiagram',
    readmeDiagramKeywords: ['classDiagram'],
  },
  'pie-duplicate-label': {
    defaultSeverity: 'warn',
    docsScope: 'pie',
    readmeDiagramKeywords: ['pie'],
  },
  'pie-zero-value': {
    defaultSeverity: 'warn',
    docsScope: 'pie',
    readmeDiagramKeywords: ['pie'],
  },
  'pie-no-data': {
    defaultSeverity: 'warn',
    docsScope: 'pie',
    readmeDiagramKeywords: ['pie'],
  },
  'state-duplicate-state': {
    defaultSeverity: 'warn',
    docsScope: 'stateDiagram',
    readmeDiagramKeywords: ['stateDiagram-v2'],
  },
  'state-duplicate-transition': {
    defaultSeverity: 'warn',
    docsScope: 'stateDiagram',
    readmeDiagramKeywords: ['stateDiagram-v2'],
  },
  'state-empty-composite': {
    defaultSeverity: 'warn',
    docsScope: 'stateDiagram',
    readmeDiagramKeywords: ['stateDiagram-v2'],
  },
  'state-self-transition': {
    defaultSeverity: 'off',
    docsScope: 'stateDiagram',
    readmeDiagramKeywords: ['stateDiagram-v2'],
  },
  'er-duplicate-attribute': {
    defaultSeverity: 'warn',
    docsScope: 'erDiagram',
    readmeDiagramKeywords: ['erDiagram'],
  },
  'er-duplicate-entity': {
    defaultSeverity: 'warn',
    docsScope: 'erDiagram',
    readmeDiagramKeywords: ['erDiagram'],
  },
  'er-standalone-entity': {
    defaultSeverity: 'off',
    docsScope: 'erDiagram',
    readmeDiagramKeywords: ['erDiagram'],
  },
  'gantt-duplicate-task-id': {
    defaultSeverity: 'warn',
    docsScope: 'gantt',
    readmeDiagramKeywords: ['gantt'],
  },
  'gantt-undefined-dependency': {
    defaultSeverity: 'warn',
    docsScope: 'gantt',
    readmeDiagramKeywords: ['gantt'],
  },
  'gantt-empty-section': {
    defaultSeverity: 'warn',
    docsScope: 'gantt',
    readmeDiagramKeywords: ['gantt'],
  },
  'requirement-duplicate-name': {
    defaultSeverity: 'warn',
    docsScope: 'requirementDiagram',
    readmeDiagramKeywords: ['requirementDiagram'],
  },
  'requirement-duplicate-id': {
    defaultSeverity: 'warn',
    docsScope: 'requirementDiagram',
    readmeDiagramKeywords: ['requirementDiagram'],
  },
  'requirement-undefined-reference': {
    defaultSeverity: 'warn',
    docsScope: 'requirementDiagram',
    readmeDiagramKeywords: ['requirementDiagram'],
  },
  'journey-empty-section': {
    defaultSeverity: 'warn',
    docsScope: 'journey',
    readmeDiagramKeywords: ['journey'],
  },
  'journey-score-out-of-range': {
    defaultSeverity: 'warn',
    docsScope: 'journey',
    readmeDiagramKeywords: ['journey'],
  },
  'journey-task-without-actor': {
    defaultSeverity: 'warn',
    docsScope: 'journey',
    readmeDiagramKeywords: ['journey'],
  },
  'journey-no-tasks': {
    defaultSeverity: 'warn',
    docsScope: 'journey',
    readmeDiagramKeywords: ['journey'],
  },
  'mindmap-duplicate-sibling': {
    defaultSeverity: 'warn',
    docsScope: 'mindmap',
    readmeDiagramKeywords: ['mindmap'],
  },
  'mindmap-no-nodes': {
    defaultSeverity: 'warn',
    docsScope: 'mindmap',
    readmeDiagramKeywords: ['mindmap'],
  },
  'mindmap-deep-nesting': {
    defaultSeverity: 'off',
    docsScope: 'mindmap',
    readmeDiagramKeywords: ['mindmap'],
  },
  'timeline-empty-section': {
    defaultSeverity: 'warn',
    docsScope: 'timeline',
    readmeDiagramKeywords: ['timeline'],
  },
  'timeline-empty-event': {
    defaultSeverity: 'warn',
    docsScope: 'timeline',
    readmeDiagramKeywords: ['timeline'],
  },
  'timeline-no-entries': {
    defaultSeverity: 'warn',
    docsScope: 'timeline',
    readmeDiagramKeywords: ['timeline'],
  },
  'gitgraph-duplicate-commit-id': {
    defaultSeverity: 'warn',
    docsScope: 'gitGraph',
    readmeDiagramKeywords: ['gitGraph'],
  },
  'gitgraph-duplicate-tag': {
    defaultSeverity: 'warn',
    docsScope: 'gitGraph',
    readmeDiagramKeywords: ['gitGraph'],
  },
  'gitgraph-no-commits': {
    defaultSeverity: 'warn',
    docsScope: 'gitGraph',
    readmeDiagramKeywords: ['gitGraph'],
  },
  'quadrant-duplicate-point': {
    defaultSeverity: 'warn',
    docsScope: 'quadrantChart',
    readmeDiagramKeywords: ['quadrantChart'],
  },
  'quadrant-no-points': {
    defaultSeverity: 'warn',
    docsScope: 'quadrantChart',
    readmeDiagramKeywords: ['quadrantChart'],
  },
  'quadrant-missing-x-axis': {
    defaultSeverity: 'warn',
    docsScope: 'quadrantChart',
    readmeDiagramKeywords: ['quadrantChart'],
  },
  'quadrant-missing-y-axis': {
    defaultSeverity: 'warn',
    docsScope: 'quadrantChart',
    readmeDiagramKeywords: ['quadrantChart'],
  },
  'quadrant-duplicate-quadrant': {
    defaultSeverity: 'warn',
    docsScope: 'quadrantChart',
    readmeDiagramKeywords: ['quadrantChart'],
  },
  'c4-duplicate-id': {
    defaultSeverity: 'warn',
    docsScope: 'C4Context',
    readmeDiagramKeywords: ['C4Context'],
  },
  'c4-undefined-relationship-endpoint': {
    defaultSeverity: 'warn',
    docsScope: 'C4Context',
    readmeDiagramKeywords: ['C4Context'],
  },
  'c4-undefined-element-style': {
    defaultSeverity: 'warn',
    docsScope: 'C4Context',
    readmeDiagramKeywords: ['C4Context'],
  },
  'c4-undefined-relationship-style-endpoint': {
    defaultSeverity: 'warn',
    docsScope: 'C4Context',
    readmeDiagramKeywords: ['C4Context'],
  },
  'wardley-undefined-component': {
    defaultSeverity: 'warn',
    docsScope: 'wardley-beta',
    readmeDiagramKeywords: ['wardley-beta'],
  },
  'wardley-orphan-component': {
    defaultSeverity: 'off',
    docsScope: 'wardley-beta',
    readmeDiagramKeywords: ['wardley-beta'],
  },
  'wardley-no-components': {
    defaultSeverity: 'warn',
    docsScope: 'wardley-beta',
    readmeDiagramKeywords: ['wardley-beta'],
  },
  'wardley-mixed-coordinate-scale': {
    defaultSeverity: 'warn',
    docsScope: 'wardley-beta',
    readmeDiagramKeywords: ['wardley-beta'],
  },
  'wardley-duplicate-component': {
    defaultSeverity: 'warn',
    docsScope: 'wardley-beta',
    readmeDiagramKeywords: ['wardley-beta'],
  },
  'eventmodeling-undefined-frame': {
    defaultSeverity: 'error',
    docsScope: 'eventmodeling',
    readmeDiagramKeywords: ['eventmodeling'],
  },
  'eventmodeling-duplicate-frame-id': {
    defaultSeverity: 'warn',
    docsScope: 'eventmodeling',
    readmeDiagramKeywords: ['eventmodeling'],
  },
  'eventmodeling-invalid-flow': {
    defaultSeverity: 'warn',
    docsScope: 'eventmodeling',
    readmeDiagramKeywords: ['eventmodeling'],
  },
  'kanban-duplicate-column': {
    defaultSeverity: 'warn',
    docsScope: 'kanban',
    readmeDiagramKeywords: ['kanban'],
  },
  'kanban-duplicate-task-id': {
    defaultSeverity: 'warn',
    docsScope: 'kanban',
    readmeDiagramKeywords: ['kanban'],
  },
  'kanban-empty-column': {
    defaultSeverity: 'warn',
    docsScope: 'kanban',
    readmeDiagramKeywords: ['kanban'],
  },
  'kanban-no-columns': {
    defaultSeverity: 'warn',
    docsScope: 'kanban',
    readmeDiagramKeywords: ['kanban'],
  },
  'venn-duplicate-set': {
    defaultSeverity: 'warn',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'venn-non-positive-size': {
    defaultSeverity: 'warn',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'venn-single-set': {
    defaultSeverity: 'warn',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'venn-self-union': {
    defaultSeverity: 'warn',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'venn-no-sets': {
    defaultSeverity: 'error',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'venn-duplicate-union': {
    defaultSeverity: 'warn',
    docsScope: 'venn-beta',
    readmeDiagramKeywords: ['venn-beta'],
  },
  'treeview-no-nodes': {
    defaultSeverity: 'warn',
    docsScope: 'treeView-beta',
    readmeDiagramKeywords: ['treeView-beta'],
  },
  'treeview-duplicate-sibling': {
    defaultSeverity: 'warn',
    docsScope: 'treeView-beta',
    readmeDiagramKeywords: ['treeView-beta'],
  },
  'ishikawa-no-causes': {
    defaultSeverity: 'warn',
    docsScope: 'ishikawa-beta',
    readmeDiagramKeywords: ['ishikawa-beta'],
  },
  'ishikawa-empty-category': {
    defaultSeverity: 'warn',
    docsScope: 'ishikawa-beta',
    readmeDiagramKeywords: ['ishikawa-beta'],
  },
  'ishikawa-deep-nesting': {
    defaultSeverity: 'off',
    docsScope: 'ishikawa-beta',
    readmeDiagramKeywords: ['ishikawa-beta'],
  },
  'ishikawa-duplicate-sibling': {
    defaultSeverity: 'warn',
    docsScope: 'ishikawa-beta',
    readmeDiagramKeywords: ['ishikawa-beta'],
  },
  // Document-shape rule. Like the directive-correctness rules below it
  // describes the body rather than any one diagram type, so it carries no
  // README diagram keywords.
  'frontmatter-must-be-first': {
    defaultSeverity: 'error',
    docsScope: 'all',
    readmeDiagramKeywords: [],
  },
  // Directive-correctness rules. They describe the suppression comments
  // themselves rather than any diagram type, so they carry no README diagram
  // keywords — the README Diagram types table stays untouched.
  'suppression-unknown-rule': {
    defaultSeverity: 'warn',
    docsScope: 'all',
    readmeDiagramKeywords: [],
  },
  'suppression-unused': {
    defaultSeverity: 'warn',
    docsScope: 'all',
    readmeDiagramKeywords: [],
  },
  'suppression-malformed': {
    defaultSeverity: 'warn',
    docsScope: 'all',
    readmeDiagramKeywords: [],
  },
} satisfies Record<RuleId, RuleMetadata>;

/** Every known rule id, derived from the metadata table. */
export const ALL_RULE_IDS = Object.keys(RULE_METADATA) as RuleId[];

function defaultsFromMetadata(): ResolvedRules {
  const defaults = {} as ResolvedRules;
  for (const id of ALL_RULE_IDS) {
    defaults[id] = RULE_METADATA[id].defaultSeverity;
  }
  return defaults;
}

/** Default severity for each rule, derived from the metadata table. */
export const RULE_DEFAULTS: ResolvedRules = defaultsFromMetadata();

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
