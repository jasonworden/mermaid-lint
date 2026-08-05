import {
  ALL_FENCE_MARKERS,
  type FenceMarker,
  makeFenceCloseRe,
  makeGenericFenceOpenRe,
} from './fences.js';
import { ALL_RULE_IDS } from './rules.js';

/**
 * Scope of a suppression directive.
 *
 * - `range-start` / `range-end` — `%% mermaid-lint-disable` / `-enable`
 * - `next-line` — applies to the next non-directive body line
 * - `diagram` — the whole diagram, wherever the directive sits
 * - `file` — every Mermaid block in the document (`<!-- ... -->`)
 *
 * @public
 */
export type DirectiveKind =
  | 'range-start'
  | 'range-end'
  | 'next-line'
  | 'diagram'
  | 'file';

/** A problem detected while parsing a directive. @public */
export type DirectiveProblem =
  | { kind: 'missing-reason' }
  | { kind: 'empty-rules' }
  /**
   * Both a reason and rule ids are absent (e.g. a bare `%% mermaid-lint-disable`).
   * Reported as one diagnostic instead of both `missing-reason` and
   * `empty-rules` — see {@link parseDirective}.
   */
  | { kind: 'empty-directive' }
  | { kind: 'unmatched-enable' }
  | { kind: 'syntax-rule-at-line-scope' }
  | { kind: 'unknown-rule'; rule: string }
  /**
   * The keyword only makes sense at the other scope: a `-disable-file`
   * written as a `%%` diagram comment (`expected: 'file'`), or a line/range/
   * diagram-scope keyword written as an `<!-- -->` HTML comment
   * (`expected: 'body'`). `keyword` is the full matched keyword, e.g.
   * `mermaid-lint-disable-file`.
   */
  | { kind: 'wrong-scope'; keyword: string; expected: 'body' | 'file' };

/** A parsed suppression directive. @public */
export interface Directive {
  kind: DirectiveKind;
  /** Rule ids named by the directive, or `'all'` for the wildcard. */
  rules: readonly string[] | 'all';
  /** Free text after the first `:`. Empty when absent. */
  reason: string;
  /**
   * 1-indexed line where the directive starts: a body line for `%%`
   * directives, or the real 1-indexed document line for a `<!-- -->`
   * file-scope directive (see {@link parseFileDirectives}).
   */
  line: number;
  /** Anything wrong with the directive; empty when well-formed. */
  problems: DirectiveProblem[];
}

/** Rule id reserved for syntax errors from the parser. @public */
export const SYNTAX_RULE_ID = 'mermaid';

/**
 * Rule ids excluded from the `all` wildcard, alongside {@link SYNTAX_RULE_ID}:
 * the meta-rules that police the suppression-directive layer itself
 * (`suppression-unknown-rule`, `suppression-unused`, `suppression-malformed`).
 * A blanket "disable all rules for this diagram" should not be able to
 * silence the diagnostics that report broken directives - they stay
 * suppressible only by naming them explicitly, or via the `rules` config.
 *
 * Listed as string literals rather than derived from {@link ALL_RULE_IDS}:
 * these ids are members of it, so deriving the exclusion from it would be
 * circular. Naming them explicitly in a directive still works — only the
 * `all` wildcard skips them.
 *
 * @public
 */
export const RULE_IDS_EXCLUDED_FROM_ALL: ReadonlySet<string> = new Set([
  SYNTAX_RULE_ID,
  'suppression-unknown-rule',
  'suppression-unused',
  'suppression-malformed',
]);

const KINDS: ReadonlyArray<[string, DirectiveKind]> = [
  // Longest first: `-disable-next-line` must win over `-disable`.
  ['mermaid-lint-disable-next-line', 'next-line'],
  ['mermaid-lint-disable-diagram', 'diagram'],
  ['mermaid-lint-disable-file', 'file'],
  ['mermaid-lint-disable', 'range-start'],
  ['mermaid-lint-enable', 'range-end'],
];

const KNOWN_RULES = new Set<string>([...ALL_RULE_IDS, SYNTAX_RULE_ID]);

/**
 * Parse one directive body (everything after the `mermaid-lint-` keyword),
 * shared by the `%%` and `<!-- -->` forms.
 */
function parseDirective(
  kind: DirectiveKind,
  rest: string,
  line: number,
): Directive {
  const colon = rest.indexOf(':');
  const rawRules = (colon === -1 ? rest : rest.slice(0, colon)).trim();
  const reason = colon === -1 ? '' : rest.slice(colon + 1).trim();
  const problems: DirectiveProblem[] = [];

  // `enable` ends a suppression rather than creating one, so it needs no reason.
  const missingReason = kind !== 'range-end' && reason.length === 0;

  let rules: readonly string[] | 'all';
  let emptyRules = false;
  // `unknown-rule`/`syntax-rule-at-line-scope` problems, held back until after
  // the missing-reason/empty-rules problem(s) below so message order stays
  // stable regardless of which branch fires.
  const laterProblems: DirectiveProblem[] = [];
  if (rawRules === 'all') {
    rules = 'all';
  } else {
    const ids = rawRules.split(/[,\s]+/).filter((s) => s.length > 0);
    if (ids.includes('all')) {
      // The grammar doesn't define `all` mixed with named ids (e.g.
      // `all duplicate-ids`). Treating the whole list as unknown-rule noise
      // would be misleading, since `all` is a valid wildcard just written
      // redundantly alongside other ids. The least surprising reading: `all`
      // anywhere in the list means the wildcard, and the other named ids are
      // redundant but harmless, so no problem is reported for them.
      rules = 'all';
    } else {
      rules = ids;
      emptyRules = ids.length === 0;
      for (const id of ids) {
        if (!KNOWN_RULES.has(id))
          laterProblems.push({ kind: 'unknown-rule', rule: id });
      }
      // A parse failure is not reliably attributable to one line, so the
      // syntax rule id is only honored at diagram/file scope.
      if (
        ids.includes(SYNTAX_RULE_ID) &&
        (kind === 'next-line' || kind === 'range-start' || kind === 'range-end')
      ) {
        laterProblems.push({ kind: 'syntax-rule-at-line-scope' });
      }
    }
  }

  // A bare `%% mermaid-lint-disable` — no rules, no reason — is the single
  // most likely typo when migrating from the old grammar (see the module
  // doc's link to the pre-directive grammar). Reporting `missing-reason` and
  // `empty-rules` as two separate diagnostics on the same line would be the
  // noisiest possible landing for exactly that mistake, so collapse them into
  // one `empty-directive` problem when both apply.
  if (missingReason && emptyRules) {
    problems.push({ kind: 'empty-directive' });
  } else {
    if (missingReason) problems.push({ kind: 'missing-reason' });
    if (emptyRules) problems.push({ kind: 'empty-rules' });
  }
  problems.push(...laterProblems);

  return { kind, rules, reason, line, problems };
}

/**
 * Match `text` against every known directive keyword. Unlike a plain
 * yes/no match, this also reports a keyword match that isn't `allowed` in the
 * current context (e.g. `-disable-file` found in a `%%` body comment) — the
 * caller turns that into a `wrong-scope` problem instead of silently
 * dropping it. Returns `null` only when no keyword matches at all (i.e. this
 * genuinely isn't a directive).
 */
function matchKind(
  text: string,
  allowed: (k: DirectiveKind) => boolean,
): {
  keyword: string;
  kind: DirectiveKind;
  rest: string;
  allowed: boolean;
} | null {
  for (const [keyword, kind] of KINDS) {
    if (!text.startsWith(keyword)) continue;
    const rest = text.slice(keyword.length);
    // Guard against `mermaid-lint-disablefoo` matching `mermaid-lint-disable`.
    // Checked before the `allowed` test so a wrong-scope report is only
    // produced for a genuine keyword boundary match.
    if (rest.length > 0 && !/^[\s:]/.test(rest)) continue;
    return { keyword, kind, rest, allowed: allowed(kind) };
  }
  return null;
}

/**
 * Build the inert `Directive` for a keyword matched in the wrong context
 * (e.g. `-disable-file` inside a `%%` body comment). Carries no rules/reason
 * — the keyword boundary matched, but the directive can never apply — and a
 * single `wrong-scope` problem naming where it does belong.
 */
function wrongScopeDirective(
  keyword: string,
  kind: DirectiveKind,
  expected: 'body' | 'file',
  line: number,
): Directive {
  return {
    kind,
    rules: [],
    reason: '',
    line,
    problems: [{ kind: 'wrong-scope', keyword, expected }],
  };
}

/**
 * Parse every `%%` suppression directive in a diagram body.
 *
 * @param lines - Body lines, already split on `\n`.
 * @returns Directives in source order, each with a 1-indexed body line.
 * @public
 */
export function parseBodyDirectives(lines: string[]): Directive[] {
  const out: Directive[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith('%%')) continue;
    // `%%{init: ...}%%` is a mermaid config directive, not a comment.
    const body = trimmed.slice(2).trim();
    if (body.startsWith('{')) continue;
    const matched = matchKind(body, (k) => k !== 'file');
    if (!matched) continue;
    if (!matched.allowed) {
      // Only `-disable-file` is disallowed here (it's HTML-comment-only) —
      // report where it actually belongs instead of silently dropping it.
      out.push(
        wrongScopeDirective(matched.keyword, matched.kind, 'file', i + 1),
      );
      continue;
    }
    out.push(parseDirective(matched.kind, matched.rest, i + 1));
  }
  return out;
}

/**
 * Every HTML comment in `text`, as `{ index, inner }` where `index` is the
 * offset of the opening `<!--` and `inner` is the text between the delimiters.
 *
 * Scanned with `indexOf` rather than a regex. The obvious
 * `/<!--([\s\S]*?)-->/g` backtracks polynomially on input like
 * `<!--a<!--a<!--a…` that never closes: the lazy body re-scans from every
 * `<!--` position. This runs over arbitrary user documents, so that is a real
 * denial-of-service vector rather than a theoretical one. Linear scanning has
 * no such cliff and matches the regex's semantics exactly — first `<!--` to the
 * next `-->`, then resume after it.
 */
function htmlComments(text: string): Array<{ index: number; inner: string }> {
  const out: Array<{ index: number; inner: string }> = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) break;
    const close = text.indexOf('-->', open + 4);
    // An unterminated comment ends the scan: nothing after it can close.
    if (close === -1) break;
    out.push({ index: open, inner: text.slice(open + 4, close) });
    from = close + 3;
  }
  return out;
}

// Every directive keyword, longest-first (inherited from KINDS). Scanning for
// all of them — not just `-disable-file` — is what lets a keyword used at the
// wrong scope (e.g. `-disable-next-line` in an HTML comment) be recognized
// and reported instead of silently ignored (see `wrong-scope`).
const ALL_KEYWORDS: readonly string[] = KINDS.map(([keyword]) => keyword);

/** 1-indexed line containing character `offset` in `text`. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10 /* '\n' */) line++;
  }
  return line;
}

/**
 * Half-open `[start, end)` character-offset ranges in `text` for CommonMark
 * inline code spans (`` `...` ``) on a single line. Spans are matched by
 * equal-length backtick runs, per CommonMark; a run with no matching close on
 * the same line is not a span and is ignored (good enough for documentation
 * prose — inline spans essentially never intentionally cross lines).
 */
function inlineCodeSpanRanges(line: string): Array<[number, number]> {
  const runs: Array<{ start: number; end: number }> = [];
  for (const m of line.matchAll(/`+/g)) {
    runs.push({ start: m.index, end: m.index + m[0].length });
  }
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < runs.length) {
    const open = runs[i];
    const openLen = open.end - open.start;
    let j = i + 1;
    while (j < runs.length && runs[j].end - runs[j].start !== openLen) j++;
    if (j < runs.length) {
      ranges.push([open.start, runs[j].end]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return ranges;
}

/**
 * Half-open `[start, end)` character-offset ranges in `text` that fall inside
 * a fenced code block (any language — reuses {@link makeGenericFenceOpenRe},
 * not the mermaid-only fence matcher) or an inline code span. `parseFileDirectives`
 * ignores an `<!-- -->` comment that starts inside one of these ranges, so a
 * directive shown as a *documentation example* — inside a fenced block or an
 * inline code span — is never mistaken for a live one.
 *
 * Reuses the same fence-open/close regex construction as
 * {@link extractMermaidBlocks} (via `fences.ts`) so fence recognition — variable-
 * length fences, backtick vs. tilde, indentation — never drifts between the
 * two scanners.
 */
function codeRanges(
  text: string,
  fences: readonly FenceMarker[],
): Array<[number, number]> {
  const openRe = makeGenericFenceOpenRe(fences);
  if (!openRe) return [];

  const lines = text.split('\n');
  const lineStarts: number[] = [0];
  for (const line of lines) {
    lineStarts.push(lineStarts[lineStarts.length - 1] + line.length + 1);
  }

  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    const m = openRe.exec(lines[i]);
    if (!m) {
      for (const [s, e] of inlineCodeSpanRanges(lines[i])) {
        ranges.push([lineStarts[i] + s, lineStarts[i] + e]);
      }
      i++;
      continue;
    }
    const indent = m[1];
    const marker = m[2];
    const closeRe = makeFenceCloseRe(indent, marker);
    const start = lineStarts[i];
    i++;
    while (i < lines.length && !closeRe.test(lines[i])) i++;
    // Unclosed fence: everything to end of document is inside it.
    const end =
      i < lines.length ? lineStarts[i] + lines[i].length : text.length;
    ranges.push([start, end]);
    i++;
  }
  return ranges;
}

function isInRange(
  offset: number,
  ranges: readonly [number, number][],
): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Parse every `<!-- mermaid-lint-disable-file ... -->` directive in a Markdown
 * document. Document-level directives carry the real 1-indexed document line
 * the directive keyword starts on (not the line of any particular Mermaid
 * block) — they apply to every block regardless of position.
 *
 * An HTML comment whose opening `<!--` falls inside a fenced code block or an
 * inline code span is skipped entirely — see {@link codeRanges}. That is what
 * keeps documentation *showing* the directive syntax (e.g. this project's own
 * README) from being parsed as a live directive.
 *
 * A single HTML comment may pack more than one directive (e.g. copy-pasted
 * blocks or several independent suppressions). Each occurrence of any
 * directive keyword starts its own directive; the text between consecutive
 * occurrences (and from the last occurrence to the end of the comment) is
 * that directive's rule list and reason. This avoids silently folding a
 * second directive into the first one's `reason` string. Keywords other than
 * `-disable-file` are also scanned for here (not skipped) so a keyword used
 * at the wrong scope — e.g. `<!-- mermaid-lint-disable-next-line ... -->` —
 * is reported via `wrong-scope` instead of silently doing nothing.
 *
 * @param text - Full document contents.
 * @returns Document-level directives in source order.
 * @public
 */
export function parseFileDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  const ranges = codeRanges(text, ALL_FENCE_MARKERS);
  for (const m of htmlComments(text)) {
    if (isInRange(m.index, ranges)) continue;
    const inner = m.inner;
    // Absolute offset of `inner[0]` in `text`: the match start plus the
    // length of the opening `<!--`.
    const innerOffset = m.index + 4;
    const starts = new Set<number>();
    for (const keyword of ALL_KEYWORDS) {
      let idx = inner.indexOf(keyword);
      while (idx !== -1) {
        starts.add(idx);
        idx = inner.indexOf(keyword, idx + keyword.length);
      }
    }
    const sortedStarts = [...starts].sort((a, b) => a - b);
    for (let i = 0; i < sortedStarts.length; i++) {
      const end =
        i + 1 < sortedStarts.length ? sortedStarts[i + 1] : inner.length;
      const slice = inner.slice(sortedStarts[i], end).trim();
      const matched = matchKind(slice, (k) => k === 'file');
      if (!matched) continue;
      const line = lineAt(text, innerOffset + sortedStarts[i]);
      if (!matched.allowed) {
        out.push(
          wrongScopeDirective(matched.keyword, matched.kind, 'body', line),
        );
        continue;
      }
      out.push(parseDirective(matched.kind, matched.rest, line));
    }
  }
  return out;
}

/**
 * Resolved suppression state for one block. Built once per
 * `blockToDiagnostics` call and queried per finding.
 *
 * @public
 */
export interface SuppressionIndex {
  /** Every directive parsed for this block, body then document scope. */
  readonly directives: readonly Directive[];
  /**
   * Whether `ruleId` is suppressed at `line`.
   *
   * Querying marks the matching directive used, so `unused()` reflects what
   * actually fired. Pass `undefined` for a finding with no line.
   */
  isSuppressed(ruleId: string, line: number | undefined): boolean;
  /** Well-formed directives that never suppressed anything. */
  unused(): Directive[];
  /**
   * Whether `directive` ever matched a query on *this* index.
   *
   * The per-directive form of what `unused()` answers in bulk, for the one
   * case `unused()` can't serve: a file-scope directive is queried once per
   * block index, so no single index knows whether it fired document-wide.
   * Feed the answers to {@link unusedFileDirectives}.
   */
  isUsed(directive: Directive): boolean;
}

/**
 * File-scope directives that suppressed nothing anywhere in the document.
 *
 * The document-wide counterpart to {@link SuppressionIndex.unused}, which
 * excludes file scope precisely because one index can't answer this (see the
 * exclusion in {@link buildSuppressionIndex}). Both apply the same
 * well-formedness rule — a directive carrying a problem is inert and already
 * reported as broken, so it is never also "unused" — and keeping that rule
 * here, next to `unused()`, is what stops the two definitions from drifting.
 *
 * The `kind` guard mirrors `unused()`'s: a keyword used at the wrong scope
 * parses to a `Directive` whose kind is the scope it *asked* for, so it can
 * appear in this list without being a real file directive. It always carries
 * a `wrong-scope` problem too, so the guard is belt-and-braces.
 *
 * @param fileDirectives - The document's file-scope directives.
 * @param used - Every directive that fired on any index — union the block
 *   indices' {@link SuppressionIndex.isUsed} answers with the document-scope
 *   one, since a file directive naming a meta-rule can suppress another file
 *   directive's problem.
 * @returns The file directives to report as `suppression-unused`.
 * @internal
 */
export function unusedFileDirectives(
  fileDirectives: readonly Directive[],
  used: ReadonlySet<Directive>,
): Directive[] {
  return fileDirectives.filter(
    (d) => d.kind === 'file' && d.problems.length === 0 && !used.has(d),
  );
}

/**
 * Does this directive name `ruleId`? `all` excludes the syntax rule and the
 * suppression meta-rules (see {@link RULE_IDS_EXCLUDED_FROM_ALL}).
 */
function names(directive: Directive, ruleId: string): boolean {
  if (directive.rules === 'all') return !RULE_IDS_EXCLUDED_FROM_ALL.has(ruleId);
  return directive.rules.includes(ruleId);
}

/** The next line a `next-line` directive targets, skipping further directives. */
function nextTargetLine(lines: string[], directiveLine: number): number {
  for (let i = directiveLine; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('%%')) continue;
    if (trimmed.length === 0) continue;
    return i + 1;
  }
  return directiveLine + 1;
}

/**
 * Match `range-start`/`range-end` directives, one rule id at a time.
 *
 * Ranges are scoped per rule id, not per directive: a `disable` covering
 * several rules (explicitly, or via `all`) can be partially closed by an
 * `enable` that only names some of them, leaving the range open for the
 * rest. Within a single rule id, an `enable` drains every currently-open
 * `disable` for that rule at once - not just the innermost - so two stacked
 * same-rule disables are both closed by one enable. This matters because the
 * rule id a user names most explicitly (a repeated or nested disable for it)
 * is the one that must not silently stay suppressed when they ask to
 * re-enable it.
 *
 * A `range-start` that carries problems (e.g. a missing reason) is inert,
 * same as {@link SuppressionIndex.isSuppressed} treats it: it's skipped
 * entirely here so it can never be "closed" by an enable in place of a
 * well-formed one.
 *
 * Also flags, in place, any well-formed `range-end` directive that closed no
 * range for any rule it names. A `range-end` that already carries a problem
 * (its rule list failed to parse) is skipped here too - it cannot have
 * matched anything, and it's already reported once; piling on
 * `unmatched-enable` would double-report the same mistake. Note this check
 * is per-directive, not per-rule: an enable naming two rules where only one
 * of them actually closes something is still considered matched and reports
 * nothing, by design.
 *
 * MUTATES `d.problems` on affected `range-end` directives in place (in
 * addition to returning the end-line map). Safe only because
 * {@link buildSuppressionIndex} re-parses fresh `Directive` objects on every
 * call - nothing here is cached or shared across calls.
 *
 * @param body - Directives parsed from the diagram body (document-level
 *   directives don't participate in ranges).
 * @returns For each `range-start` directive, the exclusive end line per
 *   rule id it names. A rule id mapped to `Infinity` (or a `range-start`
 *   absent from the outer map) runs to the end of the body.
 */
function matchRanges(
  body: readonly Directive[],
): Map<Directive, Map<string, number>> {
  const rangeDirectives = body.filter(
    (d) => d.kind === 'range-start' || d.kind === 'range-end',
  );

  // The universe of rule ids ranges can be scoped to: every known semantic
  // rule (so `all` has something concrete to expand to), plus any literal
  // id - typo or not - a directive actually names, so two directives that
  // happen to agree on the same unknown id still match each other.
  const ruleUniverse = new Set<string>(ALL_RULE_IDS);
  for (const d of rangeDirectives) {
    if (d.rules === 'all') continue;
    for (const r of d.rules) ruleUniverse.add(r);
  }

  const ends = new Map<Directive, Map<string, number>>();
  const closedSomething = new Set<Directive>();
  const setEnd = (opener: Directive, ruleId: string, line: number) => {
    let perRule = ends.get(opener);
    if (!perRule) {
      perRule = new Map();
      ends.set(opener, perRule);
    }
    perRule.set(ruleId, line);
  };

  for (const ruleId of ruleUniverse) {
    const stack: Directive[] = [];
    for (const d of rangeDirectives) {
      if (!names(d, ruleId)) continue;
      if (d.kind === 'range-start') {
        // A problem-carrying opener is inert (see isSuppressed), so it must
        // never occupy the stack in place of a well-formed one.
        if (d.problems.length > 0) continue;
        stack.push(d);
        continue;
      }
      // Drain every currently-open disable for this rule id, not just the
      // innermost - see the drain-all rationale in the function doc above.
      if (stack.length > 0) {
        for (const opener of stack) setEnd(opener, ruleId, d.line);
        stack.length = 0;
        closedSomething.add(d);
      }
    }
    // Anything left on the stack never closed for this rule id.
    for (const opener of stack)
      setEnd(opener, ruleId, Number.POSITIVE_INFINITY);
  }

  for (const d of rangeDirectives) {
    // Skip enables that already carry a problem - see the function doc.
    if (
      d.kind === 'range-end' &&
      d.problems.length === 0 &&
      !closedSomething.has(d)
    ) {
      d.problems.push({ kind: 'unmatched-enable' });
    }
  }

  return ends;
}

/**
 * Build the suppression index for a diagram body plus any document-level
 * directives attached to its block.
 *
 * @param bodyLines - Diagram body split on `\n`.
 * @param fileDirectives - Document-level directives (see `parseFileDirectives`).
 * @returns A queryable {@link SuppressionIndex}.
 * @public
 */
export function buildSuppressionIndex(
  bodyLines: string[],
  fileDirectives: readonly Directive[] = [],
): SuppressionIndex {
  const body = parseBodyDirectives(bodyLines);
  const directives = [...body, ...fileDirectives];
  const used = new Set<Directive>();
  // matchRanges also mutates problems onto `body`'s range-end directives in
  // place (see its doc comment). That's safe here only because `body` is
  // freshly parsed above on every call - never cached or reused.
  const rangeEnds = matchRanges(body);

  const isSuppressed = (ruleId: string, line: number | undefined): boolean => {
    let hit = false;
    for (const d of directives) {
      if (d.problems.length > 0) continue;
      if (!names(d, ruleId)) continue;

      let matches = false;
      if (d.kind === 'diagram' || d.kind === 'file') {
        // Matches unconditionally, including `line === undefined`. A
        // structural error (unclosed fence, empty block) carries no line for
        // exactly that reason, so a file- or diagram-scope directive naming
        // `mermaid` also quiets those - a document-wide "quiet mermaid
        // errors" is intended to cover them too, not just parse errors that
        // happen to have a location.
        matches = true;
      } else if (d.kind === 'next-line' && line !== undefined) {
        matches = nextTargetLine(bodyLines, d.line) === line;
      } else if (d.kind === 'range-start' && line !== undefined) {
        const end = rangeEnds.get(d)?.get(ruleId) ?? Number.POSITIVE_INFINITY;
        matches = line >= d.line && line < end;
      }

      // Deliberately no early `break`/`return` on the first hit: every
      // matching directive gets marked used, so `unused()` depends only on
      // the set of queries that ever ran, never on directive order. Do not
      // "optimize" this into an early return.
      if (matches) {
        used.add(d);
        hit = true;
      }
    }
    return hit;
  };

  return {
    directives,
    isSuppressed,
    unused: () =>
      directives.filter(
        (d) =>
          // range-end (enable) directives are never added to `used` - only
          // openers/scoped directives are queried by isSuppressed - so they
          // are excluded categorically here rather than by checking `used`.
          d.kind !== 'range-end' &&
          // File-scope directives are excluded too, but for a different
          // reason: the same `fileDirectives` array is attached to every
          // block in the document (see extract.ts), and `blockToDiagnostics`
          // runs once per block. If `unused` counted them, a single stale
          // `-disable-file` would be reported once per block instead of once
          // for the document. Whether one suppressed nothing *document-wide*
          // is a question no single block's index can answer - `lintMarkdown`
          // answers it by unioning `isUsed` across every block's index and
          // reports it there, exactly once. This exclusion is what keeps that
          // the only place it's reported.
          d.kind !== 'file' &&
          d.problems.length === 0 &&
          !used.has(d),
      ),
    isUsed: (d) => used.has(d),
  };
}
