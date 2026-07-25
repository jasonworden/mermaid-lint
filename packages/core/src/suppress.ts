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
  | { kind: 'unmatched-enable' }
  | { kind: 'syntax-rule-at-line-scope' }
  | { kind: 'unknown-rule'; rule: string };

/** A parsed suppression directive. @public */
export interface Directive {
  kind: DirectiveKind;
  /** Rule ids named by the directive, or `'all'` for the wildcard. */
  rules: readonly string[] | 'all';
  /** Free text after the first `:`. Empty when absent. */
  reason: string;
  /** 1-indexed body line (`0` for document-level directives). */
  line: number;
  /** Anything wrong with the directive; empty when well-formed. */
  problems: DirectiveProblem[];
}

/** Rule id reserved for syntax errors from the parser. @public */
export const SYNTAX_RULE_ID = 'mermaid';

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
  if (kind !== 'range-end' && reason.length === 0) {
    problems.push({ kind: 'missing-reason' });
  }

  let rules: readonly string[] | 'all';
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
      if (ids.length === 0) problems.push({ kind: 'empty-rules' });
      for (const id of ids) {
        if (!KNOWN_RULES.has(id))
          problems.push({ kind: 'unknown-rule', rule: id });
      }
      // A parse failure is not reliably attributable to one line, so the
      // syntax rule id is only honored at diagram/file scope.
      if (
        ids.includes(SYNTAX_RULE_ID) &&
        (kind === 'next-line' || kind === 'range-start' || kind === 'range-end')
      ) {
        problems.push({ kind: 'syntax-rule-at-line-scope' });
      }
    }
  }

  return { kind, rules, reason, line, problems };
}

function matchKind(
  text: string,
  allowed: (k: DirectiveKind) => boolean,
): { kind: DirectiveKind; rest: string } | null {
  for (const [keyword, kind] of KINDS) {
    if (!text.startsWith(keyword)) continue;
    if (!allowed(kind)) return null;
    const rest = text.slice(keyword.length);
    // Guard against `mermaid-lint-disablefoo` matching `mermaid-lint-disable`.
    if (rest.length > 0 && !/^[\s:]/.test(rest)) continue;
    return { kind, rest };
  }
  return null;
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
    out.push(parseDirective(matched.kind, matched.rest, i + 1));
  }
  return out;
}

const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;

// Keyword for file-scoped directives, pulled from KINDS so this stays in
// sync if the keyword table ever changes.
const FILE_DIRECTIVE_KEYWORD = KINDS.find(([, k]) => k === 'file')?.[0] ?? '';

/**
 * Parse every `<!-- mermaid-lint-disable-file ... -->` directive in a Markdown
 * document. Document-level directives carry line `0` — they apply to every
 * block regardless of position.
 *
 * A single HTML comment may pack more than one directive (e.g. copy-pasted
 * blocks or several independent suppressions). Each occurrence of the
 * `mermaid-lint-disable-file` keyword starts its own directive; the text
 * between consecutive occurrences (and from the last occurrence to the end
 * of the comment) is that directive's rule list and reason. This avoids
 * silently folding a second directive into the first one's `reason` string.
 *
 * @param text - Full document contents.
 * @returns Document-level directives in source order.
 * @public
 */
export function parseFileDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  for (const m of text.matchAll(HTML_COMMENT_RE)) {
    const inner = m[1];
    const starts: number[] = [];
    let idx = inner.indexOf(FILE_DIRECTIVE_KEYWORD);
    while (idx !== -1) {
      starts.push(idx);
      idx = inner.indexOf(
        FILE_DIRECTIVE_KEYWORD,
        idx + FILE_DIRECTIVE_KEYWORD.length,
      );
    }
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : inner.length;
      const slice = inner.slice(starts[i], end).trim();
      const matched = matchKind(slice, (k) => k === 'file');
      if (!matched) continue;
      out.push(parseDirective(matched.kind, matched.rest, 0));
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
}

/** Does this directive name `ruleId`? `all` excludes the syntax rule. */
function names(directive: Directive, ruleId: string): boolean {
  if (directive.rules === 'all') return ruleId !== SYNTAX_RULE_ID;
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
 * rest. Within a single rule id, opens and closes pair up LIFO (innermost
 * first) like nested brackets, so two stacked same-rule disables need two
 * enables to fully close - the first enable only closes the inner one.
 *
 * Also flags, in place, any `range-end` directive that closed no range for
 * any rule it names.
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
        stack.push(d);
        continue;
      }
      const opener = stack.pop();
      if (opener) {
        setEnd(opener, ruleId, d.line);
        closedSomething.add(d);
      }
    }
    // Anything left on the stack never closed for this rule id.
    for (const opener of stack)
      setEnd(opener, ruleId, Number.POSITIVE_INFINITY);
  }

  for (const d of rangeDirectives) {
    if (d.kind === 'range-end' && !closedSomething.has(d)) {
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
  const rangeEnds = matchRanges(body);

  const isSuppressed = (ruleId: string, line: number | undefined): boolean => {
    let hit = false;
    for (const d of directives) {
      if (d.problems.length > 0) continue;
      if (!names(d, ruleId)) continue;

      let matches = false;
      if (d.kind === 'diagram' || d.kind === 'file') {
        matches = true;
      } else if (d.kind === 'next-line' && line !== undefined) {
        matches = nextTargetLine(bodyLines, d.line) === line;
      } else if (d.kind === 'range-start' && line !== undefined) {
        const end = rangeEnds.get(d)?.get(ruleId) ?? Number.POSITIVE_INFINITY;
        matches = line >= d.line && line < end;
      }

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
          d.kind !== 'range-end' &&
          d.kind !== 'file' &&
          d.problems.length === 0 &&
          !used.has(d),
      ),
  };
}
