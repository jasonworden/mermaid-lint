import {
  ALL_RULE_IDS,
  type Diagnostic,
  type FenceMarker,
  RULE_DEFAULTS,
  type ResolvedRules,
  type RuleId,
  extractMermaidBlocks,
  fixBlockBody,
  isFenceMarker,
  lintMarkdown,
} from '@mermaid-lint/core';
import type { Rule, RuleOnError, RuleParams } from 'markdownlint';

// One markdownlint rule per core check (mirroring ESLint / textlint / markdownlint
// itself, which all use one rule per check rather than severity buckets). Each
// rule's NAME mirrors its core rule id (`mermaid-<id>`, plus `mermaid-syntax` for
// the parse check), so there's no separate numbering scheme to maintain — the
// only stability contract is core's rule ids, which the CLI already depends on.
//
// markdownlint has no severity levels (a rule reports or it doesn't) and a rule
// runs only when registered in `customRules` and enabled in config. So core's
// `off`/`warn`/`error` axis collapses to "registered + enabled" here: the shared
// validation runs every core rule, and each markdownlint rule surfaces only the
// diagnostics tagged with its own `ruleId`. Which checks you get is decided by
// which rules you register — not by a config map.

/**
 * Force every core semantic rule to a surfacing severity for the shared pass.
 * Severity is irrelevant downstream — each rule filters by `ruleId` and reports
 * whatever it owns — so registration, not severity, is the real gate.
 */
const ALL_ON: ResolvedRules = Object.fromEntries(
  ALL_RULE_IDS.map((id) => [id, 'error']),
) as ResolvedRules;

/**
 * Read an optional `fences` array from a rule's markdownlint config, e.g.
 * `{ "mermaid-syntax": { "fences": ["backtick"] } }`. Invalid values fall back
 * to the CommonMark default (both backtick and tilde) so a typo never silently
 * disables linting.
 */
function readFences(config: unknown): FenceMarker[] | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const { fences } = config as { fences?: unknown };
  if (!Array.isArray(fences) || !fences.every(isFenceMarker)) return undefined;
  return fences;
}

// Shared, memoized validation. markdownlint invokes each registered rule's
// function independently for a file, but validation (merman WASM + the mermaid.js
// fallback) is expensive — re-running it per rule would be an N× cliff. markdownlint
// passes the SAME `lines` array reference to every rule for a given file, so we
// key an in-flight-Promise cache on that reference (via WeakMap, so the entry is
// GC'd with the file) with a small per-`fences` sub-map. Net: one validation —
// and one document join — per file, no matter how many rules are registered.
const validationCache = new WeakMap<
  readonly string[],
  Map<string, Promise<Diagnostic[]>>
>();

function validateDocument(
  name: string,
  lines: readonly string[],
  fences: FenceMarker[] | undefined,
): Promise<Diagnostic[]> {
  let byFences = validationCache.get(lines);
  if (!byFences) {
    byFences = new Map();
    validationCache.set(lines, byFences);
  }
  const key = fences ? [...fences].sort().join(',') : '*';
  let pending = byFences.get(key);
  if (!pending) {
    pending = lintMarkdown(
      name,
      lines.join('\n'),
      fences ? { fences } : {},
      ALL_ON,
    );
    byFences.set(key, pending);
  }
  return pending;
}

/** Report every diagnostic tagged with `ruleId` through markdownlint's onError. */
function reportMatching(
  diagnostics: Diagnostic[],
  ruleId: string,
  lines: readonly string[],
  onError: RuleOnError,
): void {
  for (const d of diagnostics) {
    if (d.ruleId !== ruleId) continue;
    const errorLine = lines[d.line - 1] ?? '';
    const rangeLength = errorLine.length - d.column + 1;
    onError({
      lineNumber: d.line,
      detail: d.message,
      ...(rangeLength > 0 ? { range: [d.column, rangeLength] } : {}),
    });
  }
}

/**
 * A whole-line replacement at an absolute (1-indexed) document line: delete the
 * current line content and insert the mechanically-fixed version.
 */
interface LineFix {
  /** The document line as it currently reads (what gets deleted). */
  original: string;
  /** The corrected line content to insert. */
  fixed: string;
}

/**
 * markdownlint `fixInfo` that replaces a whole line: delete the entire current
 * line content from column 1 and insert the corrected text in its place. Both
 * autofix paths in `syntaxRule` (a fix riding on a parse error, and a standalone
 * auto-fixable finding) emit exactly this shape, so they share one builder.
 */
function wholeLineFixInfo(currentLine: string, fixed: string) {
  return { editColumn: 1, deleteCount: currentLine.length, insertText: fixed };
}

/**
 * Compute the mechanical, body-local autofixes for every Mermaid block in the
 * document, keyed by absolute document line. Only the syntax check offers fixes
 * — these are the same corrections the CLI's `--fix` applies (normalizing
 * flowchart arrows, inserting missing sequence-message colons), never anything
 * that changes a diagram's meaning.
 *
 * `fixBlockBody` is line-count preserving, so each changed body line maps to
 * exactly one document line; structural fixes (closing an unclosed fence) are
 * intentionally left to the CLI and skipped here.
 */
function computeBlockFixes(
  name: string,
  lines: readonly string[],
  fences: FenceMarker[] | undefined,
): Map<number, LineFix> {
  const fixes = new Map<number, LineFix>();
  const blocks = extractMermaidBlocks(
    name,
    lines.join('\n'),
    fences ? { fences } : {},
  );
  // Body line offset mirrors core's markdown-adapter `toAbsLine`: a fenced
  // block's body starts the line after its opener; a whole-file `.mmd` body
  // starts at line 1.
  const isMmd = name.endsWith('.mmd');
  for (const block of blocks) {
    const fixedBody = fixBlockBody(block.body);
    if (fixedBody === block.body) continue;
    const original = block.body.split('\n');
    const fixed = fixedBody.split('\n');
    // Guard: only map fixes when the rewrite preserved the line count, so a
    // changed line lines up one-to-one with a document line.
    if (original.length !== fixed.length) continue;
    const bodyOffset = isMmd ? block.line - 1 : block.line;
    for (let k = 0; k < original.length; k++) {
      if (original[k] !== fixed[k]) {
        fixes.set(bodyOffset + k + 1, {
          original: original[k],
          fixed: fixed[k],
        });
      }
    }
  }
  return fixes;
}

/**
 * Build a markdownlint rule that surfaces the diagnostics core tags with a given
 * `ruleId`. `parser: 'none'` skips markdownlint's markdown-it requirement (core
 * does its own extraction); `asynchronous: true` lets it await core's validator.
 */
function makeRule(name: string, ruleId: string, description: string): Rule {
  return {
    names: [name],
    description,
    tags: ['mermaid-diagram', 'code'],
    parser: 'none',
    asynchronous: true,
    function: async (
      params: RuleParams,
      onError: RuleOnError,
    ): Promise<void> => {
      const fences = readFences(params.config);
      const diagnostics = await validateDocument(
        params.name,
        params.lines,
        fences,
      );
      reportMatching(diagnostics, ruleId, params.lines, onError);
    },
  };
}

/** One-line description per semantic rule, for markdownlint's rule listing. */
const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  'duplicate-ids': 'Mermaid: node id reused with a conflicting label',
  'prefer-flowchart':
    "Mermaid: prefer 'flowchart' over the legacy 'graph' keyword",
  'require-direction': 'Mermaid: diagram has no explicit direction',
  'no-experimental': 'Mermaid: experimental diagram type with unstable syntax',
  'no-duplicate-edges': 'Mermaid: the same edge is defined more than once',
  'no-self-loop': 'Mermaid: a node has an edge to itself',
  'no-empty-labels': 'Mermaid: a node has an empty label',
  'no-orphan-nodes': 'Mermaid: a node is declared but never connected',
  'no-activate-without-deactivate':
    'Mermaid: activation without a matching deactivation',
  'prefer-explicit-participants':
    'Mermaid: participant used before being declared',
  'no-duplicate-methods': 'Mermaid: a class declares a duplicate method',
  'pie-duplicate-label': 'Mermaid: a pie slice label is defined more than once',
  'pie-zero-value': 'Mermaid: a pie slice has a value of 0',
  'pie-no-data': 'Mermaid: a pie chart has no data slices',
};

/**
 * The parse / "won't render" check. Surfaces core's `ruleId: 'mermaid'` errors
 * and, uniquely among the rules, offers `markdownlint --fix` autofixes for the
 * mechanically-correctable ones (arrows, missing colons) via core's shared
 * `fixBlockBody`. A fix rides on the parse error when both land on the same line;
 * but the parser often reports a block's error on its header line (e.g. the
 * `flowchart LR` line) while the correctable token sits a line or two below, so
 * most fixes surface instead as their own findings — each naming the concrete
 * `before → after` edit — so a single `--fix` pass corrects the whole block.
 */
const syntaxRule: Rule = {
  names: ['mermaid-syntax'],
  description: 'Mermaid diagram syntax validation',
  tags: ['mermaid-diagram', 'code'],
  parser: 'none',
  asynchronous: true,
  function: async (params: RuleParams, onError: RuleOnError): Promise<void> => {
    const fences = readFences(params.config);
    const diagnostics = await validateDocument(
      params.name,
      params.lines,
      fences,
    );
    const fixes = computeBlockFixes(params.name, params.lines, fences);

    for (const d of diagnostics) {
      if (d.ruleId !== 'mermaid') continue;
      const errorLine = params.lines[d.line - 1] ?? '';
      const rangeLength = errorLine.length - d.column + 1;
      const fix = fixes.get(d.line);
      if (fix) fixes.delete(d.line);
      onError({
        lineNumber: d.line,
        detail: d.message,
        ...(rangeLength > 0 ? { range: [d.column, rangeLength] } : {}),
        ...(fix ? { fixInfo: wholeLineFixInfo(errorLine, fix.fixed) } : {}),
      });
    }

    // Auto-fixable lines the parser didn't flag at this exact line (its error
    // usually lands on the block header, not the offending token): surface each
    // as its own fixable finding, naming the concrete edit `--fix` will make so
    // the message is self-explanatory without the parser's context.
    for (const [lineNumber, fix] of fixes) {
      const errorLine = params.lines[lineNumber - 1] ?? '';
      onError({
        lineNumber,
        detail: `Mermaid: auto-fixable syntax — \`${fix.original.trim()}\` → \`${fix.fixed.trim()}\` (run with --fix)`,
        range: [1, Math.max(errorLine.length, 1)],
        fixInfo: wholeLineFixInfo(errorLine, fix.fixed),
      });
    }
  },
};

const semanticRules = Object.fromEntries(
  ALL_RULE_IDS.map((id) => [
    id,
    makeRule(`mermaid-${id}`, id, RULE_DESCRIPTIONS[id]),
  ]),
) as Record<RuleId, Rule>;

/**
 * Every rule, addressable by id for cherry-picking:
 * `rules.syntax`, `rules['no-self-loop']`, …
 */
export const rules: { syntax: Rule } & Record<RuleId, Rule> = {
  syntax: syntaxRule,
  ...semanticRules,
};

/** Syntax + every core rule, including the `off`-by-default ones. */
export const all: Rule[] = [
  syntaxRule,
  ...ALL_RULE_IDS.map((id) => semanticRules[id]),
];

/**
 * Syntax + every core rule whose default severity isn't `off` (i.e. core's
 * default-on set). Excludes the higher-false-positive `off`-by-default rules
 * (`no-orphan-nodes`, `prefer-explicit-participants`) — opt into those via `all`
 * or by registering them individually.
 */
export const recommended: Rule[] = [
  syntaxRule,
  ...ALL_RULE_IDS.filter((id) => RULE_DEFAULTS[id] !== 'off').map(
    (id) => semanticRules[id],
  ),
];

// Default export is the `recommended` array. A markdownlint custom-rule module
// may export an array of rules, so `customRules: ["@mermaid-lint/markdownlint"]`
// registers this set directly with zero config.
export default recommended;
