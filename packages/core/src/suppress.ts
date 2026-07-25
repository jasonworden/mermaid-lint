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
