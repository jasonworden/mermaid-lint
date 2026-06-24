# Spec: Semantic Rule Documentation Coverage

**Generated:** 2026-06-24 | **Status:** Draft
**Request:** "/one-shot-spec make sure agent gov knows to update
- docs/semantic-rules.md
- README 
when adding/removing/editing rules.
for new rules, and add a test that the doc + README cover all rules. REAMDE per diagram table must have all rules that apply to that rule (maybe the rule file/definition should have a frontmater tag or something that it can use as S-o-T

this test should be able to ran locally and be ran on CI for all PRs"

---

## What

Add governance and automated coverage checks so semantic rule changes cannot
forget the rule reference docs or the README diagram matrix. The implementation
will make core rule metadata the source of truth for documentation coverage,
then add a Vitest test that fails when `docs/semantic-rules.md` or the README
diagram table omits, mislabels, or over-lists semantic rules.

## Why

Semantic rules are now documented in several places: the TypeScript rule
registry, `docs/semantic-rules.md`, markdownlint descriptions, and the README
"Diagram types" table. The user wants agent governance to explicitly remind
contributors to update `docs/semantic-rules.md` and `README.md`, and wants an
automated local/CI check so future rule additions, removals, or edits do not
silently leave public docs stale.

## Acceptance Criteria

> Observable, testable. Each criterion should be verifiable by a human or
> automated test without knowing the implementation.

- [ ] `AGENTS.md` explicitly says that adding, removing, renaming, or changing a
  semantic rule requires updating `docs/semantic-rules.md` and the README
  "Diagram types" related-rules column.
- [ ] Core exposes typed semantic rule documentation metadata that maps every
  `RuleId` to the documentation facts needed for coverage checks, including
  default severity, docs scope, and README diagram-table applicability.
- [ ] `RuleId`, `RULE_DEFAULTS`, `ALL_RULE_IDS`, and the new metadata stay
  exhaustive at compile time, so adding or removing a rule creates a TypeScript
  error or test failure until metadata is updated.
- [ ] A Vitest test parses `docs/semantic-rules.md` and asserts the rule
  reference table contains exactly all semantic rules from the source of truth.
- [ ] The same test asserts every `docs/semantic-rules.md` row has the expected
  default severity and scope from the source of truth.
- [ ] A Vitest test parses the README "Diagram types" table and asserts each
  listed rule id is known.
- [ ] A Vitest test asserts each README diagram row's related-rules column
  exactly matches the source-of-truth rule list for that diagram keyword.
- [ ] README rows with no applicable semantic rules continue to use `-`, and
  the test treats that as an empty list.
- [ ] The coverage test runs locally through `pnpm test`.
- [ ] The coverage test runs in CI for all PRs through the existing
  `.github/workflows/ci.yml` `test` job, without adding a separate workflow.

## Out of Scope

- Auto-generating `docs/semantic-rules.md` or the README from metadata.
- Changing semantic rule behavior, severities, or emitted diagnostics.
- Adding new semantic rules.
- Reworking the README diagram table layout beyond what the test needs.
- Requiring a docs-only PR to run VS Code e2e differently from current CI.
- Updating package versions, unless the eventual implementation also changes a
  public API in a way the repo's existing versioning policy requires.

## Technical Approach

Introduce a small typed metadata source in `packages/core/src/rules.ts`, adjacent
to the current semantic rule registry. Prefer a TypeScript object over
"frontmatter" comments: it is type-checkable, importable from tests, and can
serve as a source of truth without fragile comment parsing. The recommended
shape is a `RULE_METADATA` or similarly named `Record<RuleId, RuleMetadata>`
whose entries include a short description, docs scope label, and README diagram
keywords where the rule should appear.

Keep the docs human-authored for now. The test should parse the Markdown tables
and compare them to metadata, rather than regenerating files. This preserves the
README and docs prose style while making drift visible immediately.

Put the new coverage test in the existing Vitest suite, likely
`packages/core/test/rule-docs.test.ts`, because `pnpm test` already runs in CI
for all PRs. The test can read Markdown files from the repo root with `fs`, use
simple table parsers scoped to the known headings, and compare normalized rule
ids, default severities, scope strings, and README diagram keyword mappings.

Update `AGENTS.md` under "Conventions" with a short governance bullet. It should
tell agents and contributors that rule changes require the metadata, docs, and
README table to stay in sync, and that `pnpm test` enforces this.

## Files Likely Affected

```
AGENTS.md
README.md
docs/semantic-rules.md
packages/core/src/rules.ts
packages/core/test/rule-docs.test.ts       NEW
packages/core/test/rules.test.ts           MAYBE, if metadata affects defaults tests
packages/markdownlint/index.ts             MAYBE, if descriptions are deduplicated through metadata
```

---

## Assumptions

> **Inferred without explicit confirmation.** Review each row before
> implementation begins. If any assumption is wrong, correct the spec.

| # | Assumption | Confidence | Basis |
|---|-----------|------------|-------|
| 1 | The source of truth should be typed data in `packages/core/src/rules.ts`, not comment frontmatter. | High | User suggested "frontmater tag or something"; TypeScript metadata is safer and fits the existing typed rule registry. |
| 2 | The coverage test should run as part of Vitest, not as a separate CI workflow. | High | Existing CI already runs `pnpm test` on every PR, and the user asked for local + CI coverage. |
| 3 | The README "Diagram types" related-rules column should be tested for exact equality per diagram row, not just "contains at least". | High | User said the table "must have all rules that apply"; exact equality also catches stale removed rules. |
| 4 | `docs/semantic-rules.md` should keep its human-written table, with tests guarding coverage. | Med | This is lower churn than generated docs and preserves current docs style. |
| 5 | README rows with `-` in the related-rules column mean no applicable rules. | High | Current README convention uses `-` for rows with no related rules. |
| 6 | `no-experimental` should map to the experimental beta diagram rows in README, not every Mermaid diagram row. | High | The rule applies to experimental diagram types; current README already lists it only on beta rows. |
| 7 | `docs/semantic-rules.md` "Scope" strings can remain display labels such as `flowchart / graph` or `all`, while README coverage uses diagram keywords. | High | The docs reference and README matrix have different audiences and current formats. |
| 8 | The eventual implementation can add a new test file without changing package scripts because Vitest auto-discovers `*.test.ts`. | High | Existing `pnpm test` runs `vitest run`. |
| 9 | This spec should not fast-forward the dirty primary checkout or clean unrelated untracked files. | High | Current working tree contains unrelated untracked local artifacts. |

## Open Questions

> **Unresolved.** BLOCKING questions must be answered before implementation.
> NON-BLOCKING questions have a stated default assumption; implementation can
> proceed, but the user may want to weigh in.

- **[NON-BLOCKING]** Should metadata also replace
  `packages/markdownlint/index.ts` `RULE_DESCRIPTIONS`?
  Default assumed: no for the first implementation, unless it is a very small
  cleanup. Markdownlint already has a `Record<RuleId, string>` exhaustiveness
  check, and the user specifically asked for `docs/semantic-rules.md` and
  README coverage.

- **[NON-BLOCKING]** Should the docs/README tables be generated from metadata
  instead of tested?
  Default assumed: no. A guard test is simpler, keeps docs readable, and still
  fails CI when a contributor forgets an update.

- **[NON-BLOCKING]** Should `RULE_DEFAULTS` be derived from metadata?
  Default assumed: yes if the resulting code stays simple. This reduces one
  duplication point, but the implementation may keep `RULE_DEFAULTS` explicit
  with a type/test guard if deriving it makes public typings noisier.

## Risks & Dependencies

- **Markdown parsing fragility:** Table parsers can become brittle if the docs
  structure changes. Mitigation: scope parsing to stable headings and fail with
  clear messages that explain the expected table format.
- **Metadata duplication:** If metadata includes long descriptions, it can
  duplicate docs prose. Mitigation: keep metadata focused on coverage facts,
  not full documentation paragraphs.
- **Public API shape:** `packages/core/src/rules.ts` exports public types today.
  Adding exported metadata may become part of the public API. Mitigation: either
  document it intentionally or keep it internal and import it only from tests
  through package source paths.
- **All/experimental applicability:** Rules such as `no-experimental` do not map
  cleanly to every row in the README. Mitigation: metadata should distinguish
  docs scope labels from README diagram keywords.
- **Dirty primary checkout:** The current primary repo has unrelated untracked
  files and local `main` is behind `origin/main`. Implementation should happen
  in a fresh worktree from `origin/main` to avoid mixing concerns.
